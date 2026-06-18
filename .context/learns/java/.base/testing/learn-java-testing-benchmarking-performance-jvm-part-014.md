# learn-java-testing-benchmarking-performance-jvm-part-014

# Concurrency Testing: Race, Visibility, Atomicity, Deadlock, dan jcstress

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `014`  
> Topik: concurrency correctness testing untuk Java 8 sampai Java 25  
> Fokus: race condition, visibility, atomicity, ordering, deadlock, liveness, deterministic async test, dan stress/litmus testing dengan jcstress

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi test design, assertion, test data, mocking, domain workflow, error handling, persistence, HTTP API, messaging, property-based testing, dan mutation testing.

Part ini masuk ke kelas bug yang berbeda:

```text
Bug biasa:
  input tertentu -> output salah

Bug concurrency:
  interleaving tertentu + timing tertentu + memory visibility tertentu -> output salah
```

Itulah alasan concurrency test tidak bisa diperlakukan seperti unit test biasa.

Unit test biasa sering hanya menjalankan:

```text
single JVM
single process
single test thread
single schedule
single timing
single CPU/memory condition
```

Padahal bug concurrency hidup pada variasi:

```text
thread interleaving
CPU reorder
compiler optimization
JIT optimization
memory visibility
lock acquisition order
scheduler timing
contention level
container CPU quota
GC/safepoint timing
```

Target part ini bukan membuat semua bug concurrency otomatis hilang. Targetnya adalah membangun kemampuan untuk:

1. Mengenali jenis bug concurrency.
2. Menentukan test apa yang realistis.
3. Menulis deterministic concurrency test untuk behavior level.
4. Menulis stress/litmus test untuk correctness primitive.
5. Memakai `jcstress` saat unit test biasa tidak cukup.
6. Menguji deadlock/liveness secara aman.
7. Memisahkan test correctness dari benchmark performance.
8. Membuat concurrency bug dapat direproduksi, didiagnosis, dan dicegah regresi.

---

## 1. Referensi Teknis Utama

Beberapa referensi penting untuk part ini:

- `jcstress` adalah harness eksperimental OpenJDK dan suite test untuk membantu riset correctness concurrency pada JVM, class library, dan hardware.
- Dokumentasi JUnit menyatakan parallel execution bersifat opt-in; secara default JUnit Jupiter menjalankan test secara sequential, tetapi dapat dikonfigurasi untuk menjalankan test secara concurrent.
- `ThreadMXBean` menyediakan API seperti `findDeadlockedThreads()` dan `findMonitorDeadlockedThreads()` untuk mendeteksi deadlock pada running application; dokumentasi Java terbaru juga mencatat keterbatasan deteksi untuk siklus yang melibatkan virtual threads.
- Untuk Java modern, concurrency testing perlu mempertimbangkan platform threads, virtual threads, structured concurrency, `CompletableFuture`, reactive/async boundary, executor behavior, dan container CPU constraints.

Catatan: di part ini kita tidak mengulang teori Java concurrency dasar secara penuh. Kita fokus pada **testing dan evidence model**.

---

## 2. Mental Model: Concurrency Bug adalah Bug pada Ruang Eksekusi, Bukan Sekadar Input

Pada test biasa, kita membayangkan function seperti ini:

```text
f(input) -> output
```

Pada concurrency, bentuk sebenarnya lebih dekat ke:

```text
f(input, schedule, memory_visibility, timing, contention, runtime_optimization) -> output
```

Artinya input yang sama bisa menghasilkan output berbeda jika:

- urutan thread berbeda,
- read/write terjadi pada waktu berbeda,
- write belum terlihat oleh thread lain,
- operasi non-atomic terpotong,
- lock diperoleh dalam urutan berbeda,
- task dijalankan oleh executor berbeda,
- JIT melakukan optimization berbeda setelah warmup,
- virtual thread dipin oleh blocking synchronized/foreign call,
- CPU quota membuat timing berubah.

Karena itu concurrency correctness tidak cukup dibuktikan dengan:

```java
@Test
void shouldWorkConcurrently() {
    service.doSomething();
    assertThat(result).isEqualTo(expected);
}
```

Concurrency test perlu menjawab:

```text
Apa shared state-nya?
Siapa writer?
Siapa reader?
Apa invariant yang harus selalu benar?
Apa operation yang harus atomic?
Apa ordering yang harus dijaga?
Apa visibility guarantee-nya?
Apa failure outcome yang dilarang?
Apa liveness property-nya?
Apa contention scenario-nya?
```

---

## 3. Taxonomy Bug Concurrency

### 3.1 Race Condition

Race condition terjadi ketika hasil program bergantung pada timing/urutan eksekusi antar thread.

Contoh klasik:

```java
final class UnsafeCounter {
    private int count;

    void increment() {
        count++;
    }

    int value() {
        return count;
    }
}
```

`count++` bukan satu operasi atomic. Secara konseptual:

```text
read count
add 1
write count
```

Dua thread bisa membaca nilai yang sama lalu menulis hasil yang sama. Akibatnya increment hilang.

Test biasa mungkin pass:

```java
@Test
void incrementsOnce() {
    UnsafeCounter counter = new UnsafeCounter();
    counter.increment();
    assertThat(counter.value()).isEqualTo(1);
}
```

Tapi test itu tidak membuktikan concurrency correctness.

---

### 3.2 Data Race

Data race terjadi ketika dua thread mengakses memory yang sama, setidaknya salah satunya write, tanpa synchronization/happens-before yang cukup.

Contoh:

```java
final class StopFlag {
    private boolean stopped;

    void stop() {
        stopped = true;
    }

    boolean isStopped() {
        return stopped;
    }
}
```

Jika satu thread memanggil `stop()` dan thread lain loop membaca `isStopped()`, thread reader tidak dijamin melihat perubahan jika field tidak `volatile` atau tidak dilindungi lock.

Masalahnya bukan hanya CPU cache. Java Memory Model memperbolehkan optimisasi tertentu jika tidak ada synchronization yang valid.

---

### 3.3 Visibility Failure

Visibility failure terjadi ketika write oleh satu thread tidak terlihat oleh thread lain pada waktu yang diasumsikan programmer.

Contoh lazy initialization buruk:

```java
final class LazyHolder {
    private ExpensiveObject object;

    ExpensiveObject get() {
        if (object == null) {
            object = new ExpensiveObject();
        }
        return object;
    }
}
```

Masalah:

- dua thread bisa membuat dua object,
- object reference bisa dipublikasikan tanpa visibility guarantee,
- state internal object bisa terlihat belum lengkap.

Solusi tergantung kebutuhan:

```java
final class SafeLazyHolder {
    private volatile ExpensiveObject object;

    ExpensiveObject get() {
        ExpensiveObject local = object;
        if (local == null) {
            synchronized (this) {
                local = object;
                if (local == null) {
                    local = new ExpensiveObject();
                    object = local;
                }
            }
        }
        return local;
    }
}
```

Namun solusi semacam ini harus diperlakukan hati-hati. Lebih sederhana sering lebih baik:

```java
final class SimpleLazyHolder {
    private final Supplier<ExpensiveObject> supplier;

    SimpleLazyHolder(Supplier<ExpensiveObject> supplier) {
        this.supplier = memoizeThreadSafely(supplier);
    }
}
```

Atau gunakan initialization-on-demand holder idiom untuk static singleton.

---

### 3.4 Atomicity Violation

Atomicity violation terjadi ketika beberapa operasi yang harus dilihat sebagai satu unit ternyata bisa diinterleave.

Contoh:

```java
final class Quota {
    private int remaining;

    Quota(int remaining) {
        this.remaining = remaining;
    }

    boolean tryAcquire() {
        if (remaining <= 0) {
            return false;
        }
        remaining--;
        return true;
    }
}
```

Invariant:

```text
remaining tidak boleh negatif
jumlah acquire sukses tidak boleh melebihi quota awal
```

Tanpa lock/atomic, dua thread bisa sama-sama melihat `remaining > 0` dan sama-sama mengurangi.

---

### 3.5 Ordering/Reordering Bug

Pada program concurrent, programmer sering mengasumsikan urutan operasi source code sama dengan urutan observasi antar thread. Itu tidak selalu benar tanpa happens-before.

Contoh message passing:

```java
final class MessageBox {
    int data;
    boolean ready;

    void writer() {
        data = 42;
        ready = true;
    }

    int reader() {
        if (ready) {
            return data;
        }
        return -1;
    }
}
```

Programmer mengira jika `ready == true`, maka `data == 42`. Tanpa `volatile`/lock, outcome aneh bisa terjadi secara teoritis/praktis tergantung platform dan optimization.

---

### 3.6 Check-Then-Act Race

Contoh umum:

```java
if (!map.containsKey(key)) {
    map.put(key, computeValue());
}
```

Pada `ConcurrentHashMap`, operasi individual thread-safe, tetapi komposisi `containsKey` lalu `put` bukan atomic.

Solusi:

```java
map.computeIfAbsent(key, this::computeValue);
```

Tapi `computeIfAbsent` juga punya semantic detail yang harus dipahami: mapping function harus side-effect safe, tidak boleh mengasumsikan hanya sekali secara global untuk semua situasi desain, dan tidak boleh melakukan operasi yang bisa memicu deadlock/reentrancy buruk pada map yang sama.

---

### 3.7 Lost Update

Lost update adalah bentuk atomicity/race bug ketika dua update saling menimpa.

Contoh persistence:

```text
Thread A read version 1, balance 100
Thread B read version 1, balance 100
Thread A write balance 90
Thread B write balance 80
Final balance 80, update A hilang
```

Untuk database, solusi bisa:

- optimistic locking,
- pessimistic locking,
- atomic update SQL,
- serializable transaction,
- event sourcing/append-only model,
- command deduplication.

Testing lost update harus melibatkan concurrency nyata, bukan hanya sequential calls.

---

### 3.8 Deadlock

Deadlock terjadi ketika beberapa thread saling menunggu resource yang tidak akan pernah dilepas.

Contoh:

```java
final class DeadlockProneTransfer {
    void transfer(Account from, Account to, Money amount) {
        synchronized (from) {
            synchronized (to) {
                from.debit(amount);
                to.credit(amount);
            }
        }
    }
}
```

Jika thread 1 transfer A → B, sementara thread 2 transfer B → A:

```text
T1 holds A, waits B
T2 holds B, waits A
```

Solusi umum:

- lock ordering berdasarkan stable ID,
- tryLock dengan timeout,
- single-threaded actor per aggregate/account,
- database row lock ordering,
- avoid nested locks,
- use higher-level concurrency abstractions.

---

### 3.9 Livelock

Livelock terjadi ketika thread tetap aktif, tetapi tidak ada progress.

Contoh konsep:

```text
T1 sees conflict -> backs off
T2 sees conflict -> backs off
T1 retries exactly same time
T2 retries exactly same time
repeat forever
```

Solusi:

- randomized backoff,
- bounded retry,
- jitter,
- central coordination,
- queueing.

---

### 3.10 Starvation

Starvation terjadi ketika satu task/thread tidak pernah mendapatkan kesempatan progress karena resource terus diambil oleh pihak lain.

Contoh:

- thread pool penuh oleh long-running tasks,
- priority terlalu rendah,
- lock tidak fair dalam workload tertentu,
- queue tidak diproses karena consumer selalu sibuk dengan partition lain,
- virtual threads banyak tetapi pinning membuat carrier thread tertahan.

---

### 3.11 Thread Pool Exhaustion

Thread pool exhaustion sering muncul sebagai bug performance, tapi root-nya bisa correctness/liveness.

Contoh:

```java
ExecutorService pool = Executors.newFixedThreadPool(10);

CompletableFuture<String> f = CompletableFuture.supplyAsync(() -> {
    return callAnotherTaskAndBlock(pool);
}, pool);
```

Jika task di dalam pool menunggu task lain yang juga butuh pool yang sama, bisa terjadi starvation/deadlock pool.

---

## 4. Kenapa Unit Test Biasa Tidak Cukup

Unit test biasa biasanya:

```text
membuat object
memanggil method
assert output
selesai
```

Itu cocok untuk deterministic behavior. Tapi concurrency bug bisa membutuhkan ribuan/milion interleaving.

Contoh test buruk:

```java
@Test
void concurrentCounter_shouldReachExpectedValue() throws Exception {
    UnsafeCounter counter = new UnsafeCounter();
    ExecutorService executor = Executors.newFixedThreadPool(2);

    executor.submit(counter::increment);
    executor.submit(counter::increment);

    executor.shutdown();
    executor.awaitTermination(1, TimeUnit.SECONDS);

    assertThat(counter.value()).isEqualTo(2);
}
```

Masalah:

- hanya dua increment,
- timing tidak dikontrol,
- mungkin selalu pass di mesin lokal,
- failure tidak reproducible,
- tidak menjelaskan forbidden interleaving,
- bukan stress/litmus test.

Versi lebih baik untuk behavior-level:

```java
@Test
void counter_shouldNotLoseUpdates_underContention() throws Exception {
    int threads = 8;
    int incrementsPerThread = 100_000;
    SafeCounter counter = new SafeCounter();

    ExecutorService executor = Executors.newFixedThreadPool(threads);
    CountDownLatch start = new CountDownLatch(1);
    CountDownLatch done = new CountDownLatch(threads);

    for (int i = 0; i < threads; i++) {
        executor.submit(() -> {
            await(start);
            try {
                for (int j = 0; j < incrementsPerThread; j++) {
                    counter.increment();
                }
            } finally {
                done.countDown();
            }
        });
    }

    start.countDown();
    assertThat(done.await(10, TimeUnit.SECONDS)).isTrue();
    executor.shutdownNow();

    assertThat(counter.value()).isEqualTo(threads * incrementsPerThread);
}
```

Ini lebih baik, tapi tetap bukan bukti formal. Untuk primitive-level concurrency correctness, gunakan jcstress.

---

## 5. Evidence Ladder untuk Concurrency Testing

Concurrency testing punya beberapa lapisan evidence:

```text
1. Single-thread unit test
   Membuktikan behavior dasar tanpa concurrency.

2. Deterministic multi-thread test
   Membuktikan scenario concurrent yang dikontrol.

3. Stress test sederhana
   Meningkatkan peluang menemukan race/lost update.

4. jcstress/litmus test
   Mengeksplorasi interleaving/memory outcome untuk primitive atau komponen kecil.

5. Integration concurrency test
   Menguji database, lock, transaction, messaging, executor boundary.

6. Load/stress test system-level
   Menguji behavior saat contention, queueing, pool saturation, timeout, retry storm.

7. Production telemetry
   Mendeteksi symptom concurrency/liveness di real workload.
```

Tidak semua logic perlu jcstress. Gunakan jcstress untuk bagian yang:

- membuat primitive concurrent sendiri,
- bergantung pada `volatile`, CAS, `Atomic*`, `VarHandle`, lock-free algorithm,
- memiliki custom cache/lazy initialization,
- punya subtle publication/visibility guarantee,
- dipakai luas dan failure-nya mahal,
- sulit dibuktikan dengan integration test biasa.

---

## 6. Prinsip Desain Concurrency Test

### 6.1 Test Invariant, Bukan Timing

Jangan menulis test seperti:

```java
Thread.sleep(100);
assertThat(result).isEqualTo(expected);
```

Lebih baik:

```java
await().atMost(Duration.ofSeconds(2))
       .untilAsserted(() -> assertThat(repository.findStatus(id)).isEqualTo(PROCESSED));
```

Atau untuk pure Java tanpa Awaitility:

```java
boolean completed = done.await(2, TimeUnit.SECONDS);
assertThat(completed).isTrue();
```

Concurrency test harus punya invariant jelas:

```text
counter final value harus tepat
hanya satu command yang sukses
state tidak boleh melompat ilegal
audit event tidak boleh duplicate
idempotency record hanya satu
queue message akhirnya acknowledged atau DLQ
pool tidak boleh deadlock
```

---

### 6.2 Start Bersamaan, Finish Terkontrol

Gunakan `CountDownLatch` atau `CyclicBarrier` untuk membuat workers mulai bersamaan.

Pattern:

```java
CountDownLatch ready = new CountDownLatch(threads);
CountDownLatch start = new CountDownLatch(1);
CountDownLatch done = new CountDownLatch(threads);

for (int i = 0; i < threads; i++) {
    executor.submit(() -> {
        ready.countDown();
        await(start);
        try {
            operation.run();
        } finally {
            done.countDown();
        }
    });
}

assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
start.countDown();
assertThat(done.await(10, TimeUnit.SECONDS)).isTrue();
```

Tanpa start barrier, thread pertama mungkin selesai sebelum thread lain mulai.

---

### 6.3 Jangan Menelan Exception dari Worker Thread

Bug umum:

```java
executor.submit(() -> {
    assertThat(service.call()).isEqualTo(expected);
});
```

Jika `Future` tidak diambil, exception bisa tersembunyi.

Lebih baik:

```java
List<Future<?>> futures = new ArrayList<>();

for (int i = 0; i < threads; i++) {
    futures.add(executor.submit(task));
}

for (Future<?> future : futures) {
    future.get(10, TimeUnit.SECONDS);
}
```

Atau kumpulkan error:

```java
ConcurrentLinkedQueue<Throwable> failures = new ConcurrentLinkedQueue<>();

executor.submit(() -> {
    try {
        task.run();
    } catch (Throwable t) {
        failures.add(t);
    }
});

assertThat(failures).isEmpty();
```

---

### 6.4 Semua Test Concurrency Harus Punya Timeout

Test concurrency tanpa timeout bisa membuat CI menggantung.

Contoh JUnit:

```java
@Test
void shouldCompleteWithoutDeadlock() {
    assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
        runConcurrentScenario();
    });
}
```

Namun hati-hati: `assertTimeoutPreemptively` menjalankan executable di thread berbeda dan bisa mengganggu thread-local/transaction context. Untuk Spring transaction test, lebih aman pakai timeout di latch/future dan cleanup eksplisit.

Pattern aman:

```java
boolean completed = done.await(5, TimeUnit.SECONDS);
assertThat(completed)
    .as("workers should complete; possible deadlock/starvation")
    .isTrue();
```

---

### 6.5 Bersihkan Executor

Selalu shutdown executor:

```java
ExecutorService executor = Executors.newFixedThreadPool(threads);
try {
    // test
} finally {
    executor.shutdownNow();
    executor.awaitTermination(5, TimeUnit.SECONDS);
}
```

Test yang meninggalkan thread bisa membuat suite flaky.

---

### 6.6 Pisahkan Correctness Test dari Performance Test

Jangan menulis assertion seperti:

```java
assertThat(duration).isLessThan(100);
```

kecuali memang test performance dengan environment terkontrol.

Concurrency correctness test harus menjawab:

```text
benar atau salah secara semantic
```

Benchmark/performance test menjawab:

```text
seberapa cepat/stabil pada workload tertentu
```

Keduanya berbeda.

---

## 7. Java 8–25 Compatibility Notes

### 7.1 Java 8

Java 8 masih banyak dipakai di enterprise legacy.

Fitur relevan:

- `ExecutorService`
- `ForkJoinPool`
- `CompletableFuture`
- `StampedLock`
- `LongAdder`
- `ConcurrentHashMap.computeIfAbsent`
- `Atomic*`
- `volatile`
- `synchronized`
- `ThreadMXBean`

Testing stack umum:

- JUnit 4 atau JUnit 5 Jupiter versi yang masih support Java 8.
- Mockito versi compatible Java 8.
- jcstress biasanya dijalankan sebagai tool/build terpisah.

### 7.2 Java 9–11

Relevan:

- module system bisa mempengaruhi reflection/test access,
- `VarHandle` diperkenalkan di Java 9,
- improved JVM logging,
- JDK tools berubah packaging-nya,
- Java 11 menjadi migration baseline enterprise.

`VarHandle` membuat memory ordering lebih eksplisit:

```java
varHandle.setRelease(...)
varHandle.getAcquire(...)
varHandle.compareAndSet(...)
```

Jika memakai `VarHandle`, concurrency correctness perlu diuji lebih hati-hati.

### 7.3 Java 17

Java 17 adalah baseline modern LTS yang sangat penting.

Implikasi:

- Banyak library modern mulai menjadikan Java 17 sebagai baseline.
- JUnit 6 membutuhkan Java 17+.
- Sealed classes/records dapat membantu membuat domain state lebih eksplisit, walau tidak otomatis menyelesaikan concurrency.

### 7.4 Java 21

Java 21 memperkenalkan virtual threads sebagai fitur final.

Implikasi testing:

- Banyak blocking IO bisa dijalankan dengan virtual threads.
- Test perlu membedakan platform thread vs virtual thread.
- ThreadLocal behavior tetap perlu hati-hati.
- Pinning bisa membuat scalability menurun.
- Deadlock/liveness masih mungkin terjadi; virtual threads bukan obat correctness.

Contoh executor virtual thread:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> future = executor.submit(() -> service.call());
    assertThat(future.get()).isEqualTo("OK");
}
```

### 7.5 Java 25

Untuk seri ini, Java 25 diperlakukan sebagai target modern yang perlu dicek untuk:

- library compatibility,
- JUnit 6 ecosystem,
- virtual thread behavior,
- JVM diagnostics,
- updated JDK tooling,
- runtime flag compatibility,
- behavior perubahan kecil pada scheduler/diagnostics/tooling.

Prinsipnya: concurrency test harus bisa dijalankan dalam matrix versi jika komponen dipakai lintas Java 8–25.

---

## 8. Deterministic Multi-Thread Test Patterns

### 8.1 Pattern: Concurrent Start Barrier

Gunakan untuk memaksa banyak worker mulai hampir bersamaan.

```java
static void runConcurrently(int threads, ThrowingRunnable task) throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(threads);
    CountDownLatch ready = new CountDownLatch(threads);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<?>> futures = new ArrayList<>();

    try {
        for (int i = 0; i < threads; i++) {
            futures.add(executor.submit(() -> {
                ready.countDown();
                start.await();
                task.run();
                return null;
            }));
        }

        if (!ready.await(5, TimeUnit.SECONDS)) {
            throw new AssertionError("Workers did not become ready in time");
        }

        start.countDown();

        for (Future<?> future : futures) {
            future.get(10, TimeUnit.SECONDS);
        }
    } finally {
        executor.shutdownNow();
        executor.awaitTermination(5, TimeUnit.SECONDS);
    }
}

@FunctionalInterface
interface ThrowingRunnable {
    void run() throws Exception;
}
```

Pemakaian:

```java
@Test
void idempotency_shouldAllowOnlyOneSuccessfulClaim() throws Exception {
    IdempotencyService service = new IdempotencyService();
    String key = "request-123";
    AtomicInteger successCount = new AtomicInteger();

    runConcurrently(16, () -> {
        if (service.tryClaim(key)) {
            successCount.incrementAndGet();
        }
    });

    assertThat(successCount.get()).isEqualTo(1);
}
```

---

### 8.2 Pattern: Controlled Interleaving with Latches

Kadang kita ingin memaksa urutan tertentu.

Contoh scenario:

```text
T1 mulai update dan berhenti di tengah
T2 mencoba membaca/update saat T1 belum commit
T1 lanjut
assert behavior
```

Kode:

```java
@Test
void secondCommand_shouldWaitOrFail_whenFirstCommandHoldsLock() throws Exception {
    CountDownLatch firstHasLock = new CountDownLatch(1);
    CountDownLatch allowFirstToFinish = new CountDownLatch(1);

    LockingCaseService service = new LockingCaseService(
        new Hook() {
            @Override
            public void afterLockAcquired() {
                firstHasLock.countDown();
                await(allowFirstToFinish);
            }
        }
    );

    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
        Future<?> first = executor.submit(() -> service.approve("CASE-1"));

        assertThat(firstHasLock.await(5, TimeUnit.SECONDS)).isTrue();

        Future<CommandResult> second = executor.submit(() -> service.reject("CASE-1"));

        // Depending on contract: timeout, conflict, blocked until release, etc.
        allowFirstToFinish.countDown();

        first.get(5, TimeUnit.SECONDS);
        CommandResult secondResult = second.get(5, TimeUnit.SECONDS);

        assertThat(secondResult).isEqualTo(CommandResult.CONFLICT);
    } finally {
        executor.shutdownNow();
    }
}
```

Ini bukan benchmark. Ini test contract concurrency.

---

### 8.3 Pattern: Multiple Attempts to Increase Interleaving Coverage

Untuk race yang sulit muncul:

```java
@Test
void unsafeCounter_mayLoseUpdates() throws Exception {
    for (int attempt = 0; attempt < 1_000; attempt++) {
        UnsafeCounter counter = new UnsafeCounter();

        runConcurrently(4, counter::increment);

        if (counter.value() != 4) {
            return; // race demonstrated
        }
    }

    fail("Race was not observed; this does not prove the counter is safe");
}
```

Test seperti ini bisa dipakai untuk demonstrasi edukatif, tetapi jangan dijadikan regression test utama karena bisa flaky.

Untuk regression correctness primitive, gunakan jcstress.

---

### 8.4 Pattern: Liveness Test dengan Progress Counter

Untuk memastikan worker tidak hang:

```java
@Test
void worker_shouldContinueMakingProgress() throws Exception {
    AtomicLong progress = new AtomicLong();
    AtomicBoolean stop = new AtomicBoolean(false);

    Thread worker = new Thread(() -> {
        while (!stop.get()) {
            service.doOneUnitOfWork();
            progress.incrementAndGet();
        }
    });

    worker.start();

    long before = progress.get();
    Thread.sleep(500);
    long after = progress.get();

    stop.set(true);
    worker.join(2_000);

    assertThat(after).isGreaterThan(before);
    assertThat(worker.isAlive()).isFalse();
}
```

Catatan: ini masih memakai `Thread.sleep`, tetapi untuk liveness/progress sampling kadang acceptable jika dipakai hati-hati. Untuk production-grade test, prefer fake scheduler/fake clock bila bisa.

---

## 9. Testing Atomicity

### 9.1 Atomicity pada In-Memory State

Contoh service:

```java
final class SlotAllocator {
    private final AtomicInteger remaining;

    SlotAllocator(int slots) {
        this.remaining = new AtomicInteger(slots);
    }

    boolean tryAcquire() {
        while (true) {
            int current = remaining.get();
            if (current <= 0) {
                return false;
            }
            if (remaining.compareAndSet(current, current - 1)) {
                return true;
            }
        }
    }

    int remaining() {
        return remaining.get();
    }
}
```

Test:

```java
@Test
void tryAcquire_shouldNeverAllowMoreThanInitialSlots() throws Exception {
    SlotAllocator allocator = new SlotAllocator(10);
    AtomicInteger acquired = new AtomicInteger();

    runConcurrently(100, () -> {
        if (allocator.tryAcquire()) {
            acquired.incrementAndGet();
        }
    });

    assertThat(acquired.get()).isEqualTo(10);
    assertThat(allocator.remaining()).isZero();
}
```

Invariant:

```text
successCount == initialSlots
remaining == 0
successCount + remaining == initialSlots
```

---

### 9.2 Atomicity pada Database Command

Contoh: hanya satu reviewer boleh claim case.

Contract:

```text
Untuk case_id yang sama, hanya satu claim aktif boleh berhasil.
```

Implementation bisa memakai unique constraint:

```sql
CREATE UNIQUE INDEX uq_case_claim_active
ON case_claim(case_id)
WHERE released_at IS NULL;
```

Test concurrency:

```java
@Test
void onlyOneReviewerCanClaimCase() throws Exception {
    String caseId = insertCase("CASE-100");
    AtomicInteger success = new AtomicInteger();
    ConcurrentLinkedQueue<Throwable> failures = new ConcurrentLinkedQueue<>();

    runConcurrently(20, () -> {
        try {
            ClaimResult result = claimService.claim(caseId, randomReviewerId());
            if (result == ClaimResult.CLAIMED) {
                success.incrementAndGet();
            }
        } catch (Throwable t) {
            failures.add(t);
        }
    });

    assertThat(failures).isEmpty();
    assertThat(success.get()).isEqualTo(1);
    assertThat(claimRepository.countActiveClaims(caseId)).isEqualTo(1);
}
```

Di sini test membuktikan:

- service menangani concurrent insert,
- database constraint benar,
- error conflict dimapping dengan benar,
- final state valid.

---

## 10. Testing Visibility

Visibility bug sering tidak reproducible dengan unit test biasa. Namun kita tetap bisa menulis test demonstratif dan jcstress test.

### 10.1 Demonstrasi Stop Flag Buruk

```java
final class UnsafeStopFlag {
    private boolean stopped;

    void stop() {
        stopped = true;
    }

    boolean isStopped() {
        return stopped;
    }
}
```

Test seperti ini tidak reliable:

```java
@Test
void unsafeStopFlag_mayNotStop() throws Exception {
    UnsafeStopFlag flag = new UnsafeStopFlag();
    AtomicLong iterations = new AtomicLong();

    Thread worker = new Thread(() -> {
        while (!flag.isStopped()) {
            iterations.incrementAndGet();
        }
    });

    worker.start();
    Thread.sleep(100);
    flag.stop();
    worker.join(1_000);

    assertThat(worker.isAlive()).isFalse();
}
```

Test ini bisa pass di banyak mesin, tetapi tidak membuktikan aman.

Solusi:

```java
final class SafeStopFlag {
    private volatile boolean stopped;

    void stop() {
        stopped = true;
    }

    boolean isStopped() {
        return stopped;
    }
}
```

Atau:

```java
final class AtomicStopFlag {
    private final AtomicBoolean stopped = new AtomicBoolean();

    void stop() {
        stopped.set(true);
    }

    boolean isStopped() {
        return stopped.get();
    }
}
```

---

### 10.2 Publication Test

Jika object dipublikasikan ke thread lain, pastikan state-nya aman.

Good pattern:

```java
final class ImmutableConfig {
    private final int maxRetry;
    private final Duration timeout;

    ImmutableConfig(int maxRetry, Duration timeout) {
        this.maxRetry = maxRetry;
        this.timeout = timeout;
    }

    int maxRetry() { return maxRetry; }
    Duration timeout() { return timeout; }
}
```

`final` fields punya initialization safety guarantee jika object tidak bocor dari constructor.

Bad pattern:

```java
final class EscapingThis {
    static volatile EscapingThis last;
    int value;

    EscapingThis() {
        last = this;        // this escapes too early
        value = 42;
    }
}
```

Testing publication issue dengan unit test biasa sulit. Untuk low-level publication, gunakan jcstress.

---

## 11. Testing Ordering

### 11.1 Message Passing Problem

Bug:

```java
final class MessagePassing {
    int data;
    boolean ready;

    void writer() {
        data = 42;
        ready = true;
    }

    int reader() {
        return ready ? data : -1;
    }
}
```

Jika contract mengharuskan reader tidak pernah melihat `ready == true` dengan `data == 0`, maka butuh synchronization:

```java
final class SafeMessagePassing {
    int data;
    volatile boolean ready;

    void writer() {
        data = 42;
        ready = true;
    }

    int reader() {
        return ready ? data : -1;
    }
}
```

Kenapa `volatile ready` cukup di sini?

Karena write ke `data` sebelum volatile write ke `ready`, dan read volatile `ready` yang melihat `true` membentuk visibility untuk write sebelumnya.

Namun ini harus dipahami spesifik. Tidak semua kasus cukup dengan satu volatile flag.

---

## 12. jcstress: Kapan dan Kenapa

### 12.1 Apa Itu jcstress

`jcstress` adalah harness untuk stress/litmus testing concurrency pada JVM. Ia bukan JUnit biasa.

Gunakan jcstress ketika ingin mengeksplorasi outcome dari interaksi kecil seperti:

```text
Actor 1 melakukan write/update
Actor 2 melakukan read/update
Arbiter mengamati final state
Outcome tertentu acceptable/forbidden/interesting
```

jcstress cocok untuk:

- memory visibility,
- instruction reordering,
- atomicity primitive,
- CAS loop,
- publication,
- lazy initialization,
- custom concurrent collection,
- lock-free data structure,
- `VarHandle` memory mode,
- JVM/hardware-sensitive behavior.

jcstress tidak cocok untuk:

- full application integration test,
- HTTP API test,
- DB migration test,
- load test,
- business workflow test besar,
- measuring throughput/latency.

Untuk performance microbenchmark gunakan JMH, bukan jcstress.

---

### 12.2 Struktur Dasar jcstress Test

Contoh konseptual:

```java
import org.openjdk.jcstress.annotations.Actor;
import org.openjdk.jcstress.annotations.Expect;
import org.openjdk.jcstress.annotations.JCStressTest;
import org.openjdk.jcstress.annotations.Outcome;
import org.openjdk.jcstress.annotations.State;
import org.openjdk.jcstress.infra.results.I_Result;

@JCStressTest
@Outcome(id = "1", expect = Expect.ACCEPTABLE, desc = "Reader saw initialized value")
@Outcome(id = "0", expect = Expect.ACCEPTABLE_INTERESTING, desc = "Reader did not see update")
@State
public class SimpleVisibilityTest {
    int x;

    @Actor
    public void writer() {
        x = 1;
    }

    @Actor
    public void reader(I_Result result) {
        result.r1 = x;
    }
}
```

Makna:

- `@State`: shared state untuk test.
- `@Actor`: operasi concurrent yang dijalankan oleh jcstress.
- `I_Result`: result dengan satu integer field.
- `@Outcome`: klasifikasi hasil.

Hasil tidak selalu “pass/fail” sederhana. Dalam concurrency, outcome bisa:

- acceptable,
- acceptable but interesting,
- forbidden,
- expected forbidden,
- unknown.

---

### 12.3 jcstress Test untuk Unsafe Counter

```java
import org.openjdk.jcstress.annotations.Actor;
import org.openjdk.jcstress.annotations.Arbiter;
import org.openjdk.jcstress.annotations.Expect;
import org.openjdk.jcstress.annotations.JCStressTest;
import org.openjdk.jcstress.annotations.Outcome;
import org.openjdk.jcstress.annotations.State;
import org.openjdk.jcstress.infra.results.I_Result;

@JCStressTest
@Outcome(id = "2", expect = Expect.ACCEPTABLE, desc = "Both increments visible")
@Outcome(id = "1", expect = Expect.FORBIDDEN, desc = "Lost update")
@State
public class UnsafeCounterStressTest {
    int count;

    @Actor
    public void actor1() {
        count++;
    }

    @Actor
    public void actor2() {
        count++;
    }

    @Arbiter
    public void arbiter(I_Result result) {
        result.r1 = count;
    }
}
```

Jika outcome `1` muncul, berarti lost update terjadi.

Versi aman:

```java
@JCStressTest
@Outcome(id = "2", expect = Expect.ACCEPTABLE, desc = "Both increments visible")
@State
public class AtomicCounterStressTest {
    AtomicInteger count = new AtomicInteger();

    @Actor
    public void actor1() {
        count.incrementAndGet();
    }

    @Actor
    public void actor2() {
        count.incrementAndGet();
    }

    @Arbiter
    public void arbiter(I_Result result) {
        result.r1 = count.get();
    }
}
```

---

### 12.4 jcstress Test untuk Message Passing

Unsafe:

```java
@JCStressTest
@Outcome(id = "-1", expect = Expect.ACCEPTABLE, desc = "Reader did not observe ready")
@Outcome(id = "42", expect = Expect.ACCEPTABLE, desc = "Reader observed ready and data")
@Outcome(id = "0", expect = Expect.FORBIDDEN, desc = "Reader observed ready but stale data")
@State
public class UnsafeMessagePassingStressTest {
    int data;
    boolean ready;

    @Actor
    public void writer() {
        data = 42;
        ready = true;
    }

    @Actor
    public void reader(I_Result result) {
        result.r1 = ready ? data : -1;
    }
}
```

Safe:

```java
@JCStressTest
@Outcome(id = "-1", expect = Expect.ACCEPTABLE, desc = "Reader did not observe ready")
@Outcome(id = "42", expect = Expect.ACCEPTABLE, desc = "Reader observed ready and data")
@Outcome(id = "0", expect = Expect.FORBIDDEN, desc = "Should not observe stale data after volatile ready")
@State
public class VolatileMessagePassingStressTest {
    int data;
    volatile boolean ready;

    @Actor
    public void writer() {
        data = 42;
        ready = true;
    }

    @Actor
    public void reader(I_Result result) {
        result.r1 = ready ? data : -1;
    }
}
```

---

### 12.5 jcstress untuk CAS-Based Slot Allocator

```java
@JCStressTest
@Outcome(id = "true, false, 0", expect = Expect.ACCEPTABLE, desc = "Actor1 acquired")
@Outcome(id = "false, true, 0", expect = Expect.ACCEPTABLE, desc = "Actor2 acquired")
@Outcome(id = "true, true, -1", expect = Expect.FORBIDDEN, desc = "Both acquired one slot")
@State
public class SlotAllocatorStressTest {
    AtomicInteger remaining = new AtomicInteger(1);

    boolean tryAcquire() {
        while (true) {
            int current = remaining.get();
            if (current <= 0) {
                return false;
            }
            if (remaining.compareAndSet(current, current - 1)) {
                return true;
            }
        }
    }

    @Actor
    public void actor1(ZZI_Result r) {
        r.r1 = tryAcquire();
    }

    @Actor
    public void actor2(ZZI_Result r) {
        r.r2 = tryAcquire();
    }

    @Arbiter
    public void arbiter(ZZI_Result r) {
        r.r3 = remaining.get();
    }
}
```

Catatan: class result seperti `ZZI_Result` tergantung tipe result jcstress. Untuk penggunaan nyata, cek result type yang tersedia di dependency jcstress.

---

## 13. Menjalankan jcstress

Struktur umum Maven sering memisahkan jcstress dari unit test biasa.

Contoh konseptual `pom.xml`:

```xml
<plugin>
    <groupId>org.openjdk.jcstress</groupId>
    <artifactId>jcstress-maven-plugin</artifactId>
    <version>${jcstress.version}</version>
</plugin>
```

Jalankan:

```bash
mvn clean install
java -jar target/jcstress.jar
```

Atau filter test tertentu:

```bash
java -jar target/jcstress.jar -t UnsafeCounterStressTest
```

Praktik team:

```text
Unit test:
  jalan di setiap PR

Integration test:
  jalan di PR/main sesuai modul

jcstress quick subset:
  jalan di PR untuk primitive kritikal

jcstress full:
  jalan nightly atau pre-release
```

Kenapa tidak semua jcstress jalan setiap PR?

Karena stress test bisa mahal. Tujuannya bukan menggantikan unit test, tapi memberi evidence tambahan untuk komponen concurrent yang kritikal.

---

## 14. Interpreting jcstress Result

Laporan jcstress biasanya menunjukkan outcome dan frekuensinya.

Jangan membaca frekuensi sebagai probabilitas bisnis.

Jika outcome forbidden muncul sekali saja, itu cukup menunjukkan bug.

```text
ACCEPTABLE:
  outcome sesuai contract

ACCEPTABLE_INTERESTING:
  outcome legal tapi perlu perhatian, misalnya menunjukkan weak visibility yang memang diizinkan

FORBIDDEN:
  outcome melanggar contract/JMM expectation
```

Pertanyaan saat membaca hasil:

```text
Apakah outcome list lengkap?
Apakah ada outcome tidak terduga?
Apakah forbidden outcome muncul?
Apakah acceptable_interesting memang benar acceptable?
Apakah test terlalu lemah?
Apakah actor merepresentasikan race nyata?
Apakah state bocor antar run?
Apakah result type benar?
Apakah running di JVM/version/CPU yang relevan?
```

---

## 15. Testing Deadlock

### 15.1 Deadlock Prevention Lebih Baik dari Deadlock Detection

Test terbaik untuk deadlock adalah test desain:

```text
Semua lock multi-resource harus diambil berdasarkan ordering stabil.
Tidak boleh lock object domain mutable langsung.
Tidak boleh nested lock lintas layer.
Tidak boleh blocking call saat memegang lock.
Tidak boleh memanggil external service saat memegang DB lock panjang.
```

Contoh safe ordering:

```java
final class SafeTransferService {
    void transfer(Account from, Account to, Money amount) {
        Account first = from.id().compareTo(to.id()) < 0 ? from : to;
        Account second = first == from ? to : from;

        synchronized (first) {
            synchronized (second) {
                from.debit(amount);
                to.credit(amount);
            }
        }
    }
}
```

Test:

```java
@Test
void oppositeTransfers_shouldNotDeadlock() throws Exception {
    Account a = new Account("A", Money.of(100));
    Account b = new Account("B", Money.of(100));
    SafeTransferService service = new SafeTransferService();

    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
        Future<?> f1 = executor.submit(() -> service.transfer(a, b, Money.of(10)));
        Future<?> f2 = executor.submit(() -> service.transfer(b, a, Money.of(20)));

        f1.get(5, TimeUnit.SECONDS);
        f2.get(5, TimeUnit.SECONDS);
    } finally {
        executor.shutdownNow();
    }

    assertThat(a.balance().plus(b.balance())).isEqualTo(Money.of(200));
}
```

---

### 15.2 Detecting Deadlock dengan ThreadMXBean

Contoh helper:

```java
static long[] findDeadlockedThreads() {
    ThreadMXBean bean = ManagementFactory.getThreadMXBean();
    long[] ids = bean.findDeadlockedThreads();
    return ids == null ? new long[0] : ids;
}
```

Test:

```java
@Test
void operation_shouldNotDeadlock() throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
        Future<?> f1 = executor.submit(() -> service.operationAThenB());
        Future<?> f2 = executor.submit(() -> service.operationBThenA());

        try {
            f1.get(3, TimeUnit.SECONDS);
            f2.get(3, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            long[] deadlocked = findDeadlockedThreads();
            assertThat(deadlocked)
                .as("deadlocked thread ids")
                .isEmpty();
            throw e;
        }
    } finally {
        executor.shutdownNow();
    }
}
```

Catatan penting:

- Deadlock detection bisa mahal.
- Jangan gunakan sebagai synchronization control aplikasi normal.
- Untuk virtual threads, pahami keterbatasan API JDK yang dipakai.
- Thread dump/JFR biasanya lebih informatif untuk diagnosis production.

---

## 16. Testing Executor, CompletableFuture, dan Async Boundary

### 16.1 Jangan Bergantung pada Common Pool secara Diam-Diam

Bug umum:

```java
CompletableFuture.supplyAsync(() -> service.call());
```

Tanpa executor eksplisit, ini memakai common pool. Dalam test dan production, itu bisa menyebabkan interference.

Lebih baik:

```java
CompletableFuture.supplyAsync(() -> service.call(), applicationExecutor);
```

Test:

```java
@Test
void asyncService_shouldUseConfiguredExecutor() throws Exception {
    RecordingExecutor executor = new RecordingExecutor();
    AsyncService service = new AsyncService(executor);

    CompletableFuture<String> future = service.computeAsync();

    assertThat(executor.submittedTaskCount()).isEqualTo(1);
    executor.runNext();

    assertThat(future.get(1, TimeUnit.SECONDS)).isEqualTo("done");
}
```

Recording executor:

```java
final class RecordingExecutor implements Executor {
    private final Queue<Runnable> tasks = new ArrayDeque<>();

    @Override
    public void execute(Runnable command) {
        tasks.add(command);
    }

    int submittedTaskCount() {
        return tasks.size();
    }

    void runNext() {
        Runnable task = tasks.poll();
        if (task == null) {
            throw new AssertionError("No task submitted");
        }
        task.run();
    }
}
```

Ini membuat async test deterministic.

---

### 16.2 Testing CompletableFuture Failure

```java
@Test
void future_shouldPropagateFailure() {
    CompletableFuture<String> future = service.computeAsync("bad-input");

    assertThatThrownBy(() -> future.get(1, TimeUnit.SECONDS))
        .hasCauseInstanceOf(ValidationException.class);
}
```

Atau:

```java
CompletionException exception = assertThrows(
    CompletionException.class,
    () -> future.join()
);

assertThat(exception.getCause()).isInstanceOf(ValidationException.class);
```

---

### 16.3 Testing Cancellation

```java
@Test
void cancellation_shouldStopWorkAndNotPublishEvent() throws Exception {
    ControlledWorker worker = new ControlledWorker();
    AsyncProcessor processor = new AsyncProcessor(worker, eventPublisher);

    CompletableFuture<Void> future = processor.processAsync("job-1");

    assertThat(worker.started().await(1, TimeUnit.SECONDS)).isTrue();

    future.cancel(true);
    worker.allowExit();

    assertThat(future).isCancelled();
    assertThat(eventPublisher.publishedEvents()).isEmpty();
}
```

Cancellation semantics harus jelas. Banyak API Java tidak otomatis menghentikan kerja jika task tidak cooperative.

---

## 17. Testing Virtual Threads

Virtual threads mengubah biaya concurrency, bukan aturan correctness.

### 17.1 Apa yang Perlu Diuji

Untuk kode berbasis virtual threads:

```text
Apakah task blocking memang aman dijalankan di virtual thread?
Apakah ada pinning yang merusak scalability?
Apakah ThreadLocal dibersihkan?
Apakah timeout/cancellation bekerja?
Apakah resource pool tetap menjadi bottleneck?
Apakah synchronized section terlalu panjang?
Apakah executor lifecycle benar?
```

### 17.2 Test Dasar Virtual Thread Executor

```java
@Test
void service_shouldCompleteManyBlockingTasksWithVirtualThreads() throws Exception {
    try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
        List<Future<String>> futures = new ArrayList<>();

        for (int i = 0; i < 1_000; i++) {
            int index = i;
            futures.add(executor.submit(() -> service.blockingCall(index)));
        }

        for (Future<String> future : futures) {
            assertThat(future.get(5, TimeUnit.SECONDS)).startsWith("OK-");
        }
    }
}
```

Test ini membuktikan completion, bukan performance.

### 17.3 ThreadLocal Leak Test

```java
@Test
void requestContext_shouldNotLeakAcrossVirtualThreadTasks() throws Exception {
    RequestContextHolder holder = new RequestContextHolder();

    try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
        Future<String> f1 = executor.submit(() -> {
            holder.set("user-a");
            try {
                return holder.get();
            } finally {
                holder.clear();
            }
        });

        Future<String> f2 = executor.submit(() -> holder.getOrNull());

        assertThat(f1.get()).isEqualTo("user-a");
        assertThat(f2.get()).isNull();
    }
}
```

### 17.4 Pinning Awareness

Pinning bukan selalu correctness failure, tetapi bisa menjadi performance/liveness issue.

Contoh smell:

```java
synchronized (lock) {
    blockingNetworkCall();
}
```

Test correctness bisa pass, tetapi load test/profiling menunjukkan carrier thread pinned.

Untuk pinning, evidence utama biasanya:

- JFR events,
- JVM diagnostics,
- load test,
- async profiler/wall-clock profile,
- thread dump.

---

## 18. Testing Concurrent Collections Usage

### 18.1 ConcurrentHashMap Composite Operation

Bad:

```java
if (!map.containsKey(key)) {
    map.put(key, expensiveCreate(key));
}
```

Test:

```java
@Test
void cache_shouldCreateValueOnlyOncePerKey() throws Exception {
    AtomicInteger createCount = new AtomicInteger();
    Cache<String, String> cache = new Cache<>(key -> {
        createCount.incrementAndGet();
        return "value-" + key;
    });

    runConcurrently(50, () -> {
        assertThat(cache.get("A")).isEqualTo("value-A");
    });

    assertThat(createCount.get()).isEqualTo(1);
}
```

Implementation:

```java
final class Cache<K, V> {
    private final ConcurrentHashMap<K, V> map = new ConcurrentHashMap<>();
    private final Function<K, V> loader;

    Cache(Function<K, V> loader) {
        this.loader = loader;
    }

    V get(K key) {
        return map.computeIfAbsent(key, loader);
    }
}
```

Caveat: `computeIfAbsent` mapping function should be pure/idempotent-ish. Jangan taruh side effect berbahaya tanpa memahami semantic.

---

### 18.2 LongAdder vs AtomicLong Test

`LongAdder` bagus untuk high-contention counters, tetapi `sum()` bukan atomic snapshot terhadap concurrent update.

Test contract:

```java
@Test
void longAdderCounter_shouldEventuallyReachExpectedValueAfterAllWorkersDone() throws Exception {
    LongAdder adder = new LongAdder();
    int threads = 8;
    int perThread = 100_000;

    runConcurrently(threads, () -> {
        for (int i = 0; i < perThread; i++) {
            adder.increment();
        }
    });

    assertThat(adder.sum()).isEqualTo((long) threads * perThread);
}
```

Jangan assert exact `sum()` sambil workers masih berjalan kecuali contract memang eventual/approximate.

---

## 19. Testing Locking dengan ReentrantLock, ReadWriteLock, StampedLock

### 19.1 ReentrantLock dengan Timeout

```java
boolean tryUpdate() throws InterruptedException {
    if (!lock.tryLock(100, TimeUnit.MILLISECONDS)) {
        return false;
    }
    try {
        updateState();
        return true;
    } finally {
        lock.unlock();
    }
}
```

Test:

```java
@Test
void tryUpdate_shouldReturnFalseWhenLockUnavailable() throws Exception {
    lock.lock();
    try {
        boolean result = service.tryUpdate();
        assertThat(result).isFalse();
    } finally {
        lock.unlock();
    }
}
```

### 19.2 ReadWriteLock Contract

Test invariant:

```text
multiple readers boleh bersamaan
writer exclusive
reader tidak boleh melihat partial update
```

Gunakan hooks/latches untuk memaksa writer berhenti di tengah jika perlu.

### 19.3 StampedLock Caveat

`StampedLock` punya optimistic read. Test harus memastikan validation dilakukan.

Bad:

```java
long stamp = lock.tryOptimisticRead();
int x = this.x;
int y = this.y;
return new Point(x, y); // no validate
```

Good:

```java
long stamp = lock.tryOptimisticRead();
int x = this.x;
int y = this.y;
if (!lock.validate(stamp)) {
    stamp = lock.readLock();
    try {
        x = this.x;
        y = this.y;
    } finally {
        lock.unlockRead(stamp);
    }
}
return new Point(x, y);
```

Test invariant:

```text
Point snapshot tidak boleh punya x dari update lama dan y dari update baru jika update mengharuskan pair konsisten.
```

---

## 20. Testing Transaction Concurrency

### 20.1 Optimistic Locking

Contract:

```text
Dua update concurrent ke entity/version yang sama: satu berhasil, satu conflict.
```

Test:

```java
@Test
void concurrentUpdate_shouldCauseOptimisticLockConflict() throws Exception {
    CaseEntity created = repository.save(new CaseEntity("CASE-1", DRAFT));

    CountDownLatch bothLoaded = new CountDownLatch(2);
    CountDownLatch proceed = new CountDownLatch(1);

    ExecutorService executor = Executors.newFixedThreadPool(2);
    try {
        Future<UpdateResult> f1 = executor.submit(() -> updateAfterBarrier(created.id(), APPROVED, bothLoaded, proceed));
        Future<UpdateResult> f2 = executor.submit(() -> updateAfterBarrier(created.id(), REJECTED, bothLoaded, proceed));

        assertThat(bothLoaded.await(5, TimeUnit.SECONDS)).isTrue();
        proceed.countDown();

        List<UpdateResult> results = List.of(f1.get(), f2.get());

        assertThat(results).containsExactlyInAnyOrder(UpdateResult.SUCCESS, UpdateResult.CONFLICT);
    } finally {
        executor.shutdownNow();
    }
}
```

Ini test integration, bukan unit test.

### 20.2 Pessimistic Locking

Contract:

```text
Second transaction waits, times out, or returns conflict according to policy.
```

Test harus eksplisit terhadap policy:

```text
Option A: second waits until first commits
Option B: second fails fast
Option C: second times out
Option D: second retries
```

Jangan test “harus cepat” tanpa policy.

---

## 21. Testing Idempotency Under Concurrency

Idempotency sering gagal justru saat request concurrent dengan key sama.

Contract:

```text
Untuk idempotency key yang sama:
- hanya satu execution boleh melakukan side effect
- request lain harus return cached result, conflict, atau in-progress sesuai policy
- tidak boleh publish duplicate event
- tidak boleh create duplicate audit irreversible
```

Test:

```java
@Test
void sameIdempotencyKey_shouldExecuteSideEffectOnlyOnce() throws Exception {
    AtomicInteger sideEffects = new AtomicInteger();
    IdempotentCommandHandler handler = new IdempotentCommandHandler(
        idempotencyStore,
        command -> {
            sideEffects.incrementAndGet();
            return new CommandResult("APPROVED");
        }
    );

    List<CommandResult> results = Collections.synchronizedList(new ArrayList<>());

    runConcurrently(20, () -> {
        results.add(handler.handle("key-1", new ApproveCaseCommand("CASE-1")));
    });

    assertThat(sideEffects.get()).isEqualTo(1);
    assertThat(results).hasSize(20);
    assertThat(results).allSatisfy(result -> assertThat(result.status()).isEqualTo("APPROVED"));
}
```

Jika policy adalah conflict saat in-progress:

```text
successCount == 1
conflictCount == 19
sideEffects == 1
```

Policy harus jelas.

---

## 22. Testing Audit and Event Publication Under Concurrency

Concurrency test untuk audit/event harus memastikan:

```text
Tidak ada duplicate event ilegal.
Tidak ada missing event.
Event ordering sesuai aggregate/version.
Audit trail punya actor, timestamp, old state, new state, correlation id.
Rollback tidak meninggalkan audit irreversible kecuali memang policy-nya begitu.
```

Contoh:

```java
@Test
void concurrentStatusCommands_shouldEmitEventOnlyForSuccessfulTransition() throws Exception {
    String caseId = createCase(SUBMITTED);

    runConcurrently(2, () -> {
        try {
            service.approve(caseId, reviewerContext());
        } catch (ConflictException ignored) {
            // expected for loser command
        }
    });

    assertThat(caseRepository.findStatus(caseId)).isEqualTo(APPROVED);
    assertThat(eventStore.findByAggregateId(caseId))
        .extracting(Event::type)
        .containsExactly("CaseApproved");
    assertThat(auditRepository.findByEntityId(caseId))
        .filteredOn(a -> a.action().equals("APPROVE"))
        .hasSize(1);
}
```

---

## 23. Testing Scheduler Concurrency

Scheduler bug umum:

- job overlap,
- dua instance cluster menjalankan job sama,
- missed execution diproses dua kali,
- lock tidak dilepas saat failure,
- retry menghasilkan duplicate side effect.

Contract:

```text
Satu logical job hanya boleh aktif sekali per key/window.
```

Test:

```java
@Test
void scheduledJob_shouldNotOverlapForSameWindow() throws Exception {
    AtomicInteger active = new AtomicInteger();
    AtomicInteger maxActive = new AtomicInteger();

    ScheduledJob job = new ScheduledJob(lockService, () -> {
        int current = active.incrementAndGet();
        maxActive.updateAndGet(prev -> Math.max(prev, current));
        try {
            Thread.sleep(200);
        } finally {
            active.decrementAndGet();
        }
    });

    runConcurrently(5, () -> job.runForWindow(LocalDate.of(2026, 6, 16)));

    assertThat(maxActive.get()).isEqualTo(1);
}
```

Untuk production, lock biasanya DB/distributed lock. Maka integration test harus memakai dependency nyata.

---

## 24. Testing Message Consumer Concurrency

Message consumer biasanya punya concurrency lebih dari satu.

Risiko:

- duplicate delivery,
- out-of-order processing,
- race pada aggregate sama,
- ack sebelum commit,
- commit sebelum publish downstream,
- DLQ salah,
- retry storm.

Contract untuk aggregate-bound message:

```text
Messages untuk aggregate sama harus diproses serial atau conflict-safe.
```

Test idea:

```java
@Test
void duplicateMessage_shouldBeProcessedOnceEvenWithConcurrentConsumers() throws Exception {
    Message message = new Message("msg-1", "CASE-1", "APPROVE");

    runConcurrently(4, () -> consumer.handle(message));

    assertThat(caseRepository.findStatus("CASE-1")).isEqualTo(APPROVED);
    assertThat(inboxRepository.countByMessageId("msg-1")).isEqualTo(1);
    assertThat(eventPublisher.published()).hasSize(1);
}
```

---

## 25. Testing Cache Concurrency

Cache concurrency bug:

- stampede,
- duplicate load,
- stale overwrite,
- partial value visible,
- TTL race,
- invalidation race,
- memory leak due to never-removed futures.

### 25.1 Cache Stampede Test

```java
@Test
void cache_shouldCoalesceConcurrentLoadsForSameKey() throws Exception {
    AtomicInteger loadCount = new AtomicInteger();
    CoalescingCache<String, String> cache = new CoalescingCache<>(key -> {
        loadCount.incrementAndGet();
        Thread.sleep(100);
        return "value";
    });

    runConcurrently(50, () -> {
        assertThat(cache.get("A")).isEqualTo("value");
    });

    assertThat(loadCount.get()).isEqualTo(1);
}
```

### 25.2 Invalidation Race

Scenario:

```text
T1 loads old value slowly
T2 invalidates and writes new value
T1 finishes and overwrites cache with old value
```

Test must model interleaving with latches.

---

## 26. Concurrency Testing and Observability

Concurrency test yang gagal harus memberi diagnosis.

Tambahkan observability test hooks:

```text
correlation id
thread name
operation id
state transition id
lock acquisition log
retry attempt
idempotency decision
version number
message id
```

Contoh assertion failure yang bagus:

```java
assertThat(successCount.get())
    .as("exactly one concurrent claim should succeed for caseId=%s", caseId)
    .isEqualTo(1);
```

Jangan:

```java
assertTrue(ok);
```

Saat debugging concurrency, capture:

- thread dump on timeout,
- deadlocked thread ids,
- executor queue size,
- active thread count,
- lock owner if available,
- event/audit log,
- DB row versions,
- correlation ids.

---

## 27. Thread Dump on Test Timeout

Helper sederhana:

```java
static String threadDump() {
    ThreadMXBean bean = ManagementFactory.getThreadMXBean();
    ThreadInfo[] infos = bean.dumpAllThreads(true, true);
    StringBuilder sb = new StringBuilder();
    for (ThreadInfo info : infos) {
        sb.append(info).append('\n');
    }
    return sb.toString();
}
```

Gunakan saat timeout:

```java
boolean completed = done.await(5, TimeUnit.SECONDS);
if (!completed) {
    fail("Workers did not finish. Thread dump:\n" + threadDump());
}
```

Ini jauh lebih berguna daripada CI gagal tanpa informasi.

---

## 28. Anti-Patterns dalam Concurrency Testing

### 28.1 Menggunakan `Thread.sleep` sebagai Synchronization

Bad:

```java
Thread.sleep(100);
assertThat(done).isTrue();
```

Better:

```java
assertThat(latch.await(1, TimeUnit.SECONDS)).isTrue();
```

### 28.2 Tidak Mengambil `Future.get()`

Bad:

```java
executor.submit(() -> assertThat(service.call()).isEqualTo("OK"));
```

Exception bisa hilang.

### 28.3 Test Tanpa Timeout

Bad:

```java
future.get();
```

Better:

```java
future.get(5, TimeUnit.SECONDS);
```

### 28.4 Menganggap Concurrent Collection Membuat Semua Komposisi Atomic

`ConcurrentHashMap` thread-safe, tetapi kombinasi operasi bisa tetap race.

### 28.5 Menguji Performance dengan Unit Test Timing

Bad:

```java
assertThat(duration).isLessThan(10);
```

Gunakan JMH/load test untuk performance.

### 28.6 Menulis Lock-Free Code Tanpa jcstress

Jika menulis custom lock-free algorithm, unit test biasa hampir pasti tidak cukup.

### 28.7 Tidak Menentukan Contract untuk Concurrent Failure

Contoh ambiguous:

```text
Jika dua user approve case yang sama, apa yang harus terjadi?
```

Harus jelas:

```text
satu sukses, satu conflict
atau command kedua idempotently returns current approved state
atau command kedua rejected karena stale version
```

Tanpa contract, test tidak punya target.

### 28.8 Mengandalkan Flaky Test sebagai Bukti

Test yang kadang gagal menunjukkan ada masalah, tetapi bukan regression suite yang baik. Setelah menemukan bug, buat test lebih deterministik atau pindahkan ke jcstress.

---

## 29. Concurrency Test Review Checklist

Gunakan checklist ini saat review PR:

```text
[ ] Apa shared state yang diuji?
[ ] Apa invariant yang harus selalu benar?
[ ] Apakah workers benar-benar mulai bersamaan?
[ ] Apakah semua Future/exception dikumpulkan?
[ ] Apakah test punya timeout?
[ ] Apakah executor selalu shutdown?
[ ] Apakah assertion menjelaskan failure?
[ ] Apakah Thread.sleep diganti latch/await/fake clock jika memungkinkan?
[ ] Apakah test membedakan correctness vs performance?
[ ] Apakah DB transaction boundary realistis?
[ ] Apakah duplicate command/message diuji?
[ ] Apakah idempotency diuji under concurrency?
[ ] Apakah audit/event side effect diuji untuk duplicate/missing?
[ ] Apakah deadlock/liveness punya signal?
[ ] Apakah custom volatile/CAS/VarHandle logic punya jcstress test?
[ ] Apakah test dijalankan di Java version yang relevan?
[ ] Apakah virtual thread behavior diuji jika production memakai virtual threads?
```

---

## 30. Case Study: Concurrent Case Approval

### 30.1 Business Rule

```text
Case SUBMITTED boleh di-approve oleh reviewer.
Jika dua reviewer approve case yang sama secara concurrent:
- hanya satu approval command boleh sukses,
- final status harus APPROVED,
- audit APPROVE hanya satu,
- CaseApproved event hanya satu,
- loser command harus mendapat CONFLICT atau idempotent result sesuai policy.
```

### 30.2 Naive Implementation

```java
@Transactional
public ApprovalResult approve(String caseId, User reviewer) {
    CaseEntity entity = repository.findById(caseId).orElseThrow();

    if (entity.status() != SUBMITTED) {
        return ApprovalResult.conflict("Case is not submitted");
    }

    entity.approve(reviewer.id());
    repository.save(entity);
    audit.recordApprove(caseId, reviewer.id());
    eventPublisher.publish(new CaseApproved(caseId));

    return ApprovalResult.approved();
}
```

Masalah potensial:

- dua transaction membaca `SUBMITTED`,
- dua-duanya approve,
- duplicate audit,
- duplicate event,
- last write wins,
- optimistic lock tidak dipakai,
- event publish sebelum commit.

### 30.3 Safer Implementation Direction

Opsi:

1. Optimistic locking dengan version.
2. Atomic update SQL:

```sql
UPDATE cases
SET status = 'APPROVED', version = version + 1
WHERE id = ? AND status = 'SUBMITTED'
```

Jika affected rows = 1, sukses. Jika 0, conflict/idempotent.

3. Outbox event dalam transaction yang sama.
4. Audit insert hanya untuk successful transition.

### 30.4 Concurrency Test

```java
@Test
void concurrentApprove_shouldAllowOnlyOneSuccessfulTransition() throws Exception {
    String caseId = caseFixture.submittedCase();
    AtomicInteger approved = new AtomicInteger();
    AtomicInteger conflict = new AtomicInteger();

    runConcurrently(20, () -> {
        ApprovalResult result = approvalService.approve(caseId, randomReviewer());
        if (result.status() == ApprovalStatus.APPROVED) {
            approved.incrementAndGet();
        } else if (result.status() == ApprovalStatus.CONFLICT) {
            conflict.incrementAndGet();
        }
    });

    assertThat(approved.get()).isEqualTo(1);
    assertThat(conflict.get()).isEqualTo(19);
    assertThat(caseRepository.findStatus(caseId)).isEqualTo(APPROVED);
    assertThat(auditRepository.findByCaseIdAndAction(caseId, "APPROVE")).hasSize(1);
    assertThat(outboxRepository.findByAggregateIdAndType(caseId, "CaseApproved")).hasSize(1);
}
```

### 30.5 Stronger Evidence

Tambahkan:

- database integration test dengan real DB,
- repeat test di CI nightly,
- transaction isolation check,
- outbox consumer duplicate handling test,
- load test untuk p99/lock contention,
- alert untuk duplicate event/audit anomaly.

---

## 31. Case Study: Idempotent External Callback

### 31.1 Problem

External payment/document/signature provider mengirim callback yang sama berkali-kali.

Risiko:

- status update duplicate,
- audit duplicate,
- event duplicate,
- email duplicate,
- race antara callback dan manual action.

### 31.2 Contract

```text
For same provider_event_id:
- process exactly once semantically,
- duplicate callback returns OK without duplicate side effect,
- concurrent duplicate callback safe,
- final state consistent.
```

### 31.3 Test

```java
@Test
void duplicateProviderCallback_shouldBeSemanticallyProcessedOnce() throws Exception {
    ProviderCallback callback = new ProviderCallback(
        "provider-event-123",
        "CASE-1",
        "SIGNED"
    );

    runConcurrently(30, () -> callbackService.handle(callback));

    assertThat(inboxRepository.countByExternalId("provider-event-123")).isEqualTo(1);
    assertThat(caseRepository.findStatus("CASE-1")).isEqualTo(SIGNED);
    assertThat(auditRepository.findByExternalEventId("provider-event-123")).hasSize(1);
    assertThat(emailGateway.sentEmailsForCase("CASE-1")).hasSize(1);
}
```

### 31.4 Required Implementation Properties

- unique constraint on provider event id,
- transaction around inbox claim + state update + outbox insert,
- external email sent from outbox worker, not inside transaction directly,
- duplicate path reads stored outcome,
- retry path idempotent.

---

## 32. Tool Selection Matrix

```text
Need: test basic concurrent behavior
Use: JUnit + ExecutorService + CountDownLatch + Future.get timeout

Need: test async eventual result
Use: Awaitility or latch/fake clock

Need: test low-level memory visibility/CAS/volatile
Use: jcstress

Need: test performance of concurrent primitive
Use: JMH

Need: test DB locking/transaction race
Use: integration test + real DB/Testcontainers

Need: test message duplicate/out-of-order
Use: integration/component test + broker/Testcontainers/fake broker depending level

Need: detect deadlock in test
Use: Future timeout + ThreadMXBean/thread dump

Need: diagnose production lock/contention
Use: JFR, thread dump, async-profiler, metrics

Need: validate service under load/contention
Use: load/stress test, not unit test
```

---

## 33. Top 1% Engineer Notes

A strong Java engineer does not say:

```text
This is thread-safe because the test passed.
```

They say:

```text
The shared state is protected by this happens-before relationship.
This operation is atomic because the database constraint/CAS/lock covers the whole invariant.
This unit test verifies single-thread behavior.
This deterministic concurrency test verifies the business race.
This jcstress test verifies the low-level memory outcome.
This integration test verifies transaction behavior on the real database.
This load test validates liveness and saturation behavior.
This telemetry detects production regression.
```

Concurrency correctness is not a matter of confidence. It is a matter of **explicit invariants plus appropriate evidence**.

---

## 34. Practical Team Policy

For an enterprise Java codebase, adopt policy like this:

```text
1. No custom shared mutable state without clear ownership.
2. No static mutable cache without concurrency test.
3. No custom lazy initialization without volatile/lock proof or jcstress test.
4. No check-then-act on shared state without atomic primitive/lock/constraint.
5. No executor hidden inside service unless lifecycle/test strategy is clear.
6. No CompletableFuture common-pool usage in application code without explicit reason.
7. No Thread.sleep in test except documented liveness sampling.
8. All concurrency tests must have timeout and executor cleanup.
9. All DB concurrency rules must be backed by constraints or versioning.
10. Idempotency must be tested under concurrent duplicate request/message.
11. Audit/event side effects must be tested for duplicate/missing under concurrency.
12. Low-level volatile/CAS/VarHandle code needs jcstress or must be replaced by standard library abstraction.
```

---

## 35. Summary

Concurrency testing memerlukan cara berpikir berbeda dari unit test biasa.

Hal terpenting dari part ini:

1. Concurrency bug bergantung pada schedule, visibility, ordering, dan contention.
2. Unit test biasa hanya memberi evidence terbatas.
3. Test concurrency harus berbasis invariant, bukan timing.
4. Gunakan barrier/latch/future timeout agar multi-thread test lebih deterministik.
5. Jangan menelan exception worker thread.
6. Selalu cleanup executor.
7. Gunakan jcstress untuk low-level memory/atomicity/visibility test.
8. Gunakan integration test nyata untuk DB transaction/locking race.
9. Gunakan ThreadMXBean/thread dump untuk diagnosis deadlock test.
10. Virtual threads mengubah scalability, bukan aturan correctness.
11. Idempotency, audit, event, scheduler, dan message consumer harus diuji under concurrency.
12. Performance concurrency diuji dengan JMH/load test, bukan assertion timing unit test.

Part berikutnya akan membahas:

```text
Part 015 — Test Runtime Architecture: Build Tool, Parallel Test, Flakiness, dan CI Optimization
```

Status seri:

```text
Part 014 selesai.
Seri belum selesai.
Progress: 014 dari 031.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Mutation Testing dan Test Quality Measurement](./learn-java-testing-benchmarking-performance-jvm-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Test Runtime Architecture: Build Tool, Parallel Test, Flakiness, dan CI Optimization](./learn-java-testing-benchmarking-performance-jvm-part-015.md)
