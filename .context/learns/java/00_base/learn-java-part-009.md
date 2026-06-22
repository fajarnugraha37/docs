# Learn Java Part 009 — Java Memory Model dan Concurrency Fundamental

> Target pembaca: software engineer yang sudah nyaman membangun backend/distributed system, tetapi ingin memahami Java concurrency sampai level mental model, bukan sekadar hafal `Thread`, `ExecutorService`, atau `CompletableFuture`.
>
> Target versi: Java hingga **Java 25**.
>
> Status fitur penting:
>
> - **Virtual Threads** sudah final sejak Java 21.
> - **Scoped Values** final di Java 25.
> - **Structured Concurrency** masih **preview** di Java 25.
> - **Synchronize Virtual Threads without Pinning** hadir di JDK 24 dan menjadi bagian penting dari landscape Java 25.
>
> Catatan: materi ini fokus pada concurrency fundamental. Topik lock-free, atomics, `VarHandle`, dan memory barrier akan disentuh, tetapi pembahasan sangat dalam tentang JVM/JIT/GC akan dilanjutkan pada bagian JVM internal dan performance engineering.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model Besar: Concurrency di Java Itu Tentang Apa?](#2-mental-model-besar-concurrency-di-java-itu-tentang-apa)
3. [Process, Platform Thread, Virtual Thread, dan Scheduler](#3-process-platform-thread-virtual-thread-dan-scheduler)
4. [Thread Lifecycle dan Semantics Dasar](#4-thread-lifecycle-dan-semantics-dasar)
5. [Java Memory Model: Masalah yang Sebenarnya](#5-java-memory-model-masalah-yang-sebenarnya)
6. [Data Race, Race Condition, Atomicity, Visibility, Ordering](#6-data-race-race-condition-atomicity-visibility-ordering)
7. [Happens-Before: Konsep Paling Penting dalam Java Concurrency](#7-happens-before-konsep-paling-penting-dalam-java-concurrency)
8. [`synchronized`, Monitor, dan Intrinsic Lock](#8-synchronized-monitor-dan-intrinsic-lock)
9. [`wait`, `notify`, `notifyAll`: Low-Level Coordination](#9-wait-notify-notifyall-low-level-coordination)
10. [`volatile`: Visibility dan Ordering, Bukan Lock](#10-volatile-visibility-dan-ordering-bukan-lock)
11. [`final` Field Semantics dan Safe Immutable Object](#11-final-field-semantics-dan-safe-immutable-object)
12. [Safe Publication](#12-safe-publication)
13. [Atomic Classes, CAS, ABA, dan `LongAdder`](#13-atomic-classes-cas-aba-dan-longadder)
14. [`VarHandle`: Modern Low-Level Access](#14-varhandle-modern-low-level-access)
15. [Explicit Locks: `ReentrantLock`, `ReadWriteLock`, `StampedLock`](#15-explicit-locks-reentrantlock-readwritelock-stampedlock)
16. [Concurrent Collections dan Blocking Queues](#16-concurrent-collections-dan-blocking-queues)
17. [Executors dan Thread Pool Design](#17-executors-dan-thread-pool-design)
18. [`Future`, `Callable`, dan Cancellation](#18-future-callable-dan-cancellation)
19. [`CompletableFuture`: Composition, Execution, dan Trap](#19-completablefuture-composition-execution-dan-trap)
20. [ForkJoinPool dan Work-Stealing](#20-forkjoinpool-dan-work-stealing)
21. [Virtual Threads](#21-virtual-threads)
22. [Structured Concurrency](#22-structured-concurrency)
23. [Scoped Values](#23-scoped-values)
24. [Interruption, Timeout, dan Cancellation sebagai Design Primitive](#24-interruption-timeout-dan-cancellation-sebagai-design-primitive)
25. [Backpressure dan Bounded Concurrency](#25-backpressure-dan-bounded-concurrency)
26. [Common Failure Modes](#26-common-failure-modes)
27. [Concurrency Design Patterns](#27-concurrency-design-patterns)
28. [Production Diagnostics](#28-production-diagnostics)
29. [Decision Framework](#29-decision-framework)
30. [Code Review Checklist](#30-code-review-checklist)
31. [Latihan Bertahap](#31-latihan-bertahap)
32. [Mini Project: Case Processing Concurrent Engine](#32-mini-project-case-processing-concurrent-engine)
33. [Ringkasan Mental Model](#33-ringkasan-mental-model)
34. [Referensi Resmi](#34-referensi-resmi)

---

## 1. Tujuan Bagian Ini

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan bedanya **parallelism**, **concurrency**, dan **asynchrony**.
2. Menjelaskan kenapa program yang “jalan di laptop” bisa tetap salah secara memory model.
3. Menentukan kapan memakai:
   - plain object + single thread,
   - `synchronized`,
   - `volatile`,
   - atomic classes,
   - explicit lock,
   - queue,
   - executor,
   - virtual thread,
   - structured concurrency,
   - scoped values.
4. Mendesain thread pool tanpa membuat:
   - unbounded queue leak,
   - thread starvation,
   - deadlock,
   - lost cancellation,
   - runaway retry,
   - hidden blocking,
   - broken visibility.
5. Melakukan code review concurrency dengan bertanya:
   - state apa yang shared?
   - siapa owner state?
   - apa synchronization edge-nya?
   - apa invariant-nya?
   - apa cancellation path-nya?
   - apa backpressure path-nya?
   - bagaimana failure dipropagate?
6. Memahami concurrency bukan sekadar “membuat lebih cepat”, tetapi **mengontrol interleaving, visibility, lifecycle, dan resource pressure**.

---

## 2. Mental Model Besar: Concurrency di Java Itu Tentang Apa?

Concurrency di Java adalah pengelolaan banyak alur eksekusi yang berjalan secara overlapping.

Kesalahan umum engineer adalah menyamakan concurrency dengan “multi-threading agar cepat”. Itu terlalu sempit.

Concurrency sebenarnya mencakup:

| Dimensi | Pertanyaan utama |
|---|---|
| Execution | Task berjalan di thread mana? |
| Scheduling | Siapa yang menentukan kapan task berjalan? |
| Shared state | Data apa yang dibaca/ditulis lebih dari satu thread? |
| Visibility | Apakah write thread A terlihat oleh thread B? |
| Ordering | Apakah thread B melihat urutan write seperti yang dimaksud thread A? |
| Atomicity | Apakah operasi terlihat utuh atau bisa terinterleave? |
| Coordination | Bagaimana thread menunggu sinyal/event dari thread lain? |
| Lifecycle | Siapa yang membuat, menunggu, membatalkan, dan membersihkan task? |
| Capacity | Berapa banyak task boleh berjalan bersamaan? |
| Failure | Kalau satu task gagal, task lain diapakan? |
| Observability | Bagaimana kita tahu thread mana stuck, blocked, atau starving? |

### 2.1 Concurrency vs Parallelism vs Asynchrony

#### Concurrency

Concurrency berarti beberapa pekerjaan memiliki lifecycle yang overlap.

Contoh:

```java
handleRequestA();
handleRequestB();
handleRequestC();
```

Jika request A sedang menunggu database, request B bisa diproses. Ini concurrency.

#### Parallelism

Parallelism berarti pekerjaan benar-benar dieksekusi bersamaan di banyak core CPU.

Contoh:

```java
list.parallelStream()
    .map(this::cpuHeavyTransform)
    .toList();
```

Jika ada 8 core dan task CPU-bound dapat dipecah, parallelism bisa mempercepat throughput.

#### Asynchrony

Asynchrony berarti caller tidak menunggu secara blocking pada saat memulai operasi.

Contoh:

```java
CompletableFuture<User> future = fetchUserAsync(userId);
```

Asynchrony adalah model API/lifecycle. Eksekusinya tetap perlu thread/event loop/scheduler di bawahnya.

### 2.2 Rule of Thumb

| Workload | Model umum |
|---|---|
| CPU-bound | jumlah worker mendekati jumlah core |
| I/O-bound | concurrency bisa jauh lebih besar dari jumlah core |
| blocking request/response | virtual thread cocok |
| fan-out/fan-in request | structured concurrency cocok |
| event stream panjang | queue/consumer/backpressure cocok |
| shared mutable state tinggi | redesign ownership sebelum tambah lock |
| low-level counters | atomic/adder cocok |
| high contention read-mostly | immutable snapshot, copy-on-write, read-write lock, atau cache design |

### 2.3 Concurrency dan Invariant

Pada single-threaded code, invariant rusak biasanya karena urutan logic salah.

Pada concurrent code, invariant bisa rusak walaupun setiap method terlihat benar, karena method-method itu **interleave**.

Contoh:

```java
final class CaseCounter {
    private int openCases;

    void increment() {
        openCases++;
    }

    int get() {
        return openCases;
    }
}
```

`openCases++` terlihat satu operasi, tetapi secara konseptual:

```text
read openCases
add 1
write openCases
```

Jika dua thread menjalankan bersamaan:

```text
Thread A read 10
Thread B read 10
Thread A write 11
Thread B write 11
```

Expected: 12. Actual: 11.

Ini bukan masalah syntax. Ini masalah **atomicity**.

---

## 3. Process, Platform Thread, Virtual Thread, dan Scheduler

## 3.1 Process

Process adalah instance program yang dieksekusi oleh OS.

Satu JVM biasanya berjalan sebagai satu OS process.

Di dalam process JVM ada:

- Java heap,
- metaspace,
- thread stacks,
- native memory,
- JIT compiled code cache,
- GC threads,
- compiler threads,
- application threads,
- monitoring/JFR infrastructure.

Concurrency Java hidup di dalam process ini, tetapi scheduling platform thread bergantung pada OS.

## 3.2 Platform Thread

Platform thread adalah Java `Thread` yang secara praktis dipetakan ke OS thread.

Karakteristik:

- relatif mahal dibuat,
- punya native stack,
- dijadwalkan OS,
- cocok untuk pool berukuran terbatas,
- blocking berarti OS thread ikut tertahan,
- jumlahnya terbatas oleh memory dan OS scheduling overhead.

Contoh:

```java
Thread thread = Thread.ofPlatform()
    .name("case-worker-1")
    .start(() -> processCase("CASE-001"));

thread.join();
```

## 3.3 Virtual Thread

Virtual thread adalah `java.lang.Thread` yang ringan dan dijadwalkan oleh JVM, bukan langsung oleh OS.

Contoh:

```java
Thread thread = Thread.ofVirtual()
    .name("case-vt-", 0)
    .start(() -> processCase("CASE-001"));

thread.join();
```

Virtual thread tetap `Thread`, tetapi:

- jauh lebih murah dibuat,
- banyak virtual thread bisa berbagi sedikit platform thread,
- cocok untuk blocking I/O style,
- tidak cocok untuk mempercepat CPU-bound compute,
- tidak perlu dipool,
- lifecycle-nya sebaiknya task-per-thread.

Mental model:

```text
Platform thread:
  Java Thread ≈ OS thread

Virtual thread:
  Java Thread = task-like thread managed by JVM
  mounted onto carrier platform thread only while running
  unmounted while waiting/blocking in supported operations
```

## 3.4 Scheduler

Untuk platform thread:

```text
Java code -> platform thread -> OS scheduler -> CPU core
```

Untuk virtual thread:

```text
Java code -> virtual thread -> JVM scheduler -> carrier platform thread -> OS scheduler -> CPU core
```

Virtual thread bukan “green thread lama Java” dalam arti M:1. Virtual threads menggunakan model M:N: banyak virtual thread dijadwalkan ke sejumlah platform thread.

## 3.5 Blocking vs Parking

Perbedaan penting:

| Istilah | Arti |
|---|---|
| Blocking platform thread | OS thread tertahan |
| Parking virtual thread | virtual thread ditangguhkan; carrier bisa dipakai pekerjaan lain |
| Pinning | virtual thread tidak bisa unmount dari carrier dalam kondisi tertentu |
| Starvation | task tidak mendapat kesempatan running karena resource executor/scheduler habis |

Virtual thread bekerja sangat baik bila blocking operation mendukung parking/unmounting.

---

## 4. Thread Lifecycle dan Semantics Dasar

## 4.1 Membuat Thread

```java
Thread t = new Thread(() -> {
    System.out.println("running");
});

t.start();
```

Jangan memanggil `run()` langsung jika maksudnya membuat thread baru.

```java
t.run();   // ini hanya method call biasa di current thread
t.start(); // ini membuat thread dijadwalkan berjalan
```

## 4.2 `start()` dan `join()`

`start()` menciptakan hubungan happens-before dari thread yang memanggil `start()` ke tindakan awal di thread baru.

```java
final class Holder {
    int value;
}

Holder holder = new Holder();
holder.value = 42;

Thread t = new Thread(() -> {
    System.out.println(holder.value); // guaranteed melihat write sebelum start
});

t.start();
```

`join()` menciptakan hubungan happens-before dari semua action dalam thread yang selesai ke thread yang berhasil return dari `join()`.

```java
int[] result = new int[1];

Thread t = new Thread(() -> {
    result[0] = 42;
});

t.start();
t.join();

System.out.println(result[0]); // guaranteed melihat 42
```

## 4.3 Thread State

`Thread.State` secara API memiliki:

- `NEW`
- `RUNNABLE`
- `BLOCKED`
- `WAITING`
- `TIMED_WAITING`
- `TERMINATED`

Mental model:

| State | Makna umum |
|---|---|
| NEW | object thread dibuat, belum start |
| RUNNABLE | siap jalan atau sedang jalan |
| BLOCKED | menunggu monitor lock |
| WAITING | menunggu tanpa timeout |
| TIMED_WAITING | menunggu dengan timeout |
| TERMINATED | selesai |

Jangan mengandalkan state sebagai synchronization mechanism. Thread state berguna untuk diagnostics, bukan correctness.

## 4.4 Daemon Thread

Daemon thread tidak mencegah JVM exit.

Virtual thread selalu daemon.

Konsekuensinya: jangan bergantung pada virtual thread “menahan” aplikasi tetap hidup. Gunakan lifecycle management yang jelas, misalnya structured scope, executor close, atau main thread menunggu completion.

## 4.5 Naming Threads

Thread name penting untuk observability.

Buruk:

```java
new Thread(task).start();
```

Lebih baik:

```java
Thread.ofPlatform()
    .name("case-reindex-worker-", 0)
    .factory();
```

Atau untuk virtual thread:

```java
ThreadFactory factory = Thread.ofVirtual()
    .name("case-request-vt-", 0)
    .factory();
```

---

## 5. Java Memory Model: Masalah yang Sebenarnya

Java Memory Model atau JMM menjawab pertanyaan:

> Dalam program multi-threaded, nilai write mana yang boleh dilihat oleh read lain?

CPU dan compiler boleh melakukan optimisasi:

- instruction reordering,
- caching register,
- store buffer,
- load/store optimization,
- JIT inlining,
- lock elision,
- common subexpression,
- dead code elimination.

Tanpa aturan memory model, program multi-threaded tidak bisa dipahami secara portable.

## 5.1 Ilusi Single-Threaded

Di dalam satu thread, Java menjaga **intra-thread semantics**: seolah-olah statement berjalan sesuai urutan program.

Namun antar-thread, write/read dapat terlihat berbeda jika tidak ada synchronization.

Contoh broken:

```java
final class StopFlag {
    private boolean stop;

    void requestStop() {
        stop = true;
    }

    void runLoop() {
        while (!stop) {
            // work
        }
    }
}
```

Secara single-thread, ini masuk akal.

Secara multi-thread, thread yang menjalankan `runLoop()` boleh tidak pernah melihat update `stop = true` karena tidak ada happens-before edge.

Fix minimal:

```java
final class StopFlag {
    private volatile boolean stop;

    void requestStop() {
        stop = true;
    }

    void runLoop() {
        while (!stop) {
            // work
        }
    }
}
```

## 5.2 JMM Bukan JVM Implementation Detail Semata

JMM adalah kontrak bahasa. Tujuannya:

- memungkinkan optimisasi compiler/JIT/CPU,
- tetap memberi rule agar program yang benar tersinkronisasi dapat dipahami,
- memberi semantics untuk `volatile`, `synchronized`, `final`, `start`, `join`, dan API concurrency.

## 5.3 Correctly Synchronized Program

Sebuah program disebut bebas data race jika semua conflicting access ke shared variable diurutkan oleh happens-before.

Jika program correctly synchronized, behavior-nya lebih mudah dipahami seperti sequentially consistent.

Tapi jika ada data race, Java tidak otomatis “crash”. Ia bisa terlihat bekerja, lalu gagal hanya di load tinggi, CPU tertentu, JIT phase tertentu, atau setelah refactor.

Inilah yang membuat concurrency bug mahal.

---

## 6. Data Race, Race Condition, Atomicity, Visibility, Ordering

## 6.1 Data Race

Data race terjadi ketika:

1. dua thread mengakses variable yang sama,
2. setidaknya salah satunya write,
3. tidak ada happens-before relationship antara access tersebut.

Contoh:

```java
final class BrokenCounter {
    private int value;

    void increment() {
        value++;
    }

    int value() {
        return value;
    }
}
```

Jika `increment()` dipanggil banyak thread, ada data race.

## 6.2 Race Condition

Race condition lebih luas: correctness bergantung pada timing/interleaving.

Contoh:

```java
if (!processed.contains(id)) {
    process(id);
    processed.add(id);
}
```

Walaupun `processed` adalah concurrent set, logic check-then-act bisa race.

Fix:

```java
if (processed.add(id)) {
    process(id);
}
```

`add` menjadi operasi atomik semantik “claim id”.

## 6.3 Atomicity

Atomicity berarti operasi tidak terlihat setengah selesai.

Tidak atomic:

```java
count++;
```

Atomic dengan lock:

```java
synchronized (lock) {
    count++;
}
```

Atomic dengan atomic class:

```java
counter.incrementAndGet();
```

## 6.4 Visibility

Visibility berarti write oleh thread A dapat dilihat thread B.

Tidak guaranteed:

```java
boolean ready = false;
int data = 0;

// Thread A
data = 42;
ready = true;

// Thread B
if (ready) {
    System.out.println(data);
}
```

Thread B bisa melihat `ready == true`, tapi `data` belum terlihat sebagai 42 jika tidak ada synchronization.

Fix dengan volatile flag:

```java
volatile boolean ready = false;
int data = 0;

// Thread A
data = 42;
ready = true;

// Thread B
if (ready) {
    System.out.println(data); // jika melihat ready true, data write sebelumnya visible
}
```

## 6.5 Ordering

Ordering berarti urutan write/read yang terlihat antar-thread.

Tanpa synchronization, compiler/CPU/JIT bisa melakukan reordering selama single-thread semantics tetap valid.

Contoh classic:

```java
int x = 0;
int y = 0;
int r1 = 0;
int r2 = 0;

// Thread A
x = 1;
r1 = y;

// Thread B
y = 1;
r2 = x;
```

Mungkin terlihat mustahil bahwa `r1 == 0 && r2 == 0`, tetapi dalam memory model tanpa synchronization, hasil seperti ini dapat terjadi.

---

## 7. Happens-Before: Konsep Paling Penting dalam Java Concurrency

Happens-before adalah relasi yang menjamin visibility dan ordering tertentu.

Jangan artikan happens-before sebagai “secara real time pasti terjadi dulu”. Lebih tepat:

> Jika A happens-before B, maka efek A harus terlihat oleh B sesuai aturan JMM.

## 7.1 Sumber Happens-Before Penting

### Program Order Rule

Dalam satu thread, setiap action happens-before action berikutnya sesuai program order.

```java
int a = 1;
int b = a + 1;
```

### Monitor Lock Rule

Unlock pada monitor happens-before lock berikutnya pada monitor yang sama.

```java
synchronized (lock) {
    shared = 42;
}

// thread lain
synchronized (lock) {
    System.out.println(shared);
}
```

### Volatile Rule

Write ke volatile field happens-before read berikutnya terhadap field volatile yang sama.

```java
data = 42;
ready = true; // volatile write

// thread lain
if (ready) {  // volatile read
    use(data);
}
```

### Thread Start Rule

Call `start()` happens-before action di thread yang dimulai.

```java
config = loadConfig();

Thread t = new Thread(() -> use(config));
t.start();
```

### Thread Join Rule

Semua action dalam thread happens-before successful return dari `join()` pada thread lain.

```java
Thread t = new Thread(() -> result = compute());
t.start();
t.join();
use(result);
```

### Executor/Future Rule

Untuk `ExecutorService`, action sebelum submit task happens-before action task, dan action task happens-before result retrieved via `Future.get()`.

```java
input.prepare();

Future<Result> future = executor.submit(() -> process(input));

Result result = future.get();
```

## 7.2 Synchronization Edge vs Business Ordering

Happens-before adalah ordering teknis, bukan business ordering.

Contoh:

```java
submitApproval(caseId);
publishEvent(caseApprovedEvent);
```

Walaupun secara code event dipublish setelah approval, jika menggunakan async broker, consumer lain tetap butuh event version, idempotency, ordering key, atau state validation.

Jangan mencampuradukkan:

| Konsep | Level |
|---|---|
| happens-before | memory visibility dalam process |
| transaction order | database consistency |
| event order | messaging system |
| causal order | domain/business |
| wall-clock order | time |

Top-tier engineer memisahkan semua ini.

## 7.3 Rule Praktis

Jika ada shared mutable state, kamu harus bisa menjawab:

> Apa happens-before edge antara writer dan reader?

Jika jawabannya “mungkin karena executor”, “sepertinya karena biasanya cepat”, “karena field-nya private”, atau “karena cuma boolean”, maka desainnya belum aman.

---

## 8. `synchronized`, Monitor, dan Intrinsic Lock

## 8.1 Apa Itu `synchronized`?

`synchronized` memberi:

1. mutual exclusion,
2. visibility,
3. ordering via monitor enter/exit.

Contoh:

```java
final class SafeCounter {
    private int value;

    synchronized void increment() {
        value++;
    }

    synchronized int value() {
        return value;
    }
}
```

`increment()` dan `value()` memakai monitor object yang sama: `this`.

## 8.2 Synchronized Method vs Block

```java
synchronized void increment() {
    value++;
}
```

Setara secara konsep dengan:

```java
void increment() {
    synchronized (this) {
        value++;
    }
}
```

Static synchronized method lock pada `Class` object:

```java
static synchronized void globalOperation() {
    // lock on MyClass.class
}
```

## 8.3 Pilih Lock Object dengan Hati-Hati

Buruk:

```java
synchronized (this) {
    // state critical
}
```

Ini tidak selalu salah, tetapi external code bisa juga lock object yang sama jika object terekspos.

Lebih aman:

```java
final class CaseRegistry {
    private final Object lock = new Object();
    private final Map<String, CaseRecord> cases = new HashMap<>();

    CaseRecord get(String id) {
        synchronized (lock) {
            return cases.get(id);
        }
    }
}
```

## 8.4 Invariant Protection

Lock bukan melindungi variable satu per satu. Lock melindungi **invariant**.

Contoh invariant:

```text
openCount == number of records with status OPEN
```

Maka semua update ke `records` dan `openCount` harus berada dalam critical section yang sama.

```java
final class CaseStore {
    private final Object lock = new Object();
    private final Map<String, CaseRecord> records = new HashMap<>();
    private int openCount;

    void add(CaseRecord record) {
        synchronized (lock) {
            if (records.containsKey(record.id())) {
                throw new IllegalArgumentException("duplicate case");
            }
            records.put(record.id(), record);
            if (record.status() == Status.OPEN) {
                openCount++;
            }
        }
    }

    int openCount() {
        synchronized (lock) {
            return openCount;
        }
    }
}
```

## 8.5 Reentrancy

Java monitor lock bersifat reentrant.

```java
synchronized void outer() {
    inner();
}

synchronized void inner() {
    // same thread boleh masuk lagi
}
```

Reentrancy mempermudah desain OO, tetapi bisa menyembunyikan complexity. Jika method synchronized memanggil method lain yang juga synchronized, pikirkan lock ordering dan callback risk.

## 8.6 Jangan Call External Code Saat Memegang Lock

Buruk:

```java
synchronized (lock) {
    listener.onCaseApproved(caseId);
}
```

Kenapa berbahaya?

- listener bisa lambat,
- listener bisa call balik ke object ini,
- listener bisa acquire lock lain,
- bisa deadlock,
- bisa menahan critical section terlalu lama.

Lebih baik:

```java
List<Listener> snapshot;
synchronized (lock) {
    snapshot = List.copyOf(listeners);
}

for (Listener listener : snapshot) {
    listener.onCaseApproved(caseId);
}
```

## 8.7 Synchronized di Era Virtual Thread

Dulu, virtual thread dapat mengalami pinning pada beberapa penggunaan `synchronized`. JDK 24 memperbaiki hampir semua kasus virtual thread yang blocking di `synchronized` agar melepaskan platform thread.

Namun tetap desain yang baik:

- critical section harus kecil,
- jangan melakukan blocking I/O di dalam lock,
- jangan memanggil remote service di dalam lock,
- jangan menganggap lock sebagai rate limiter,
- gunakan semaphore/bulkhead untuk membatasi concurrency eksternal.

---

## 9. `wait`, `notify`, `notifyAll`: Low-Level Coordination

`wait/notify` adalah primitive lama untuk coordination pada monitor.

Saat ini, untuk kebanyakan aplikasi, gunakan abstraction lebih tinggi:

- `BlockingQueue`,
- `Semaphore`,
- `CountDownLatch`,
- `CyclicBarrier`,
- `Phaser`,
- `CompletableFuture`,
- structured concurrency,
- reactive stream/backpressure.

Namun kamu tetap perlu paham karena:

- legacy code banyak memakainya,
- interview/bug analysis sering menyentuhnya,
- beberapa library internal masih memakai pattern serupa.

## 9.1 Basic Rule

`wait`, `notify`, dan `notifyAll` harus dipanggil saat thread memegang monitor object tersebut.

```java
synchronized (lock) {
    lock.wait();
}
```

Jika tidak, akan throw `IllegalMonitorStateException`.

## 9.2 Always Wait in Loop

Buruk:

```java
synchronized (lock) {
    if (!ready) {
        lock.wait();
    }
    consume();
}
```

Benar:

```java
synchronized (lock) {
    while (!ready) {
        lock.wait();
    }
    consume();
}
```

Kenapa loop?

- spurious wakeup,
- condition bisa berubah lagi sebelum thread lanjut,
- notify bisa membangunkan thread yang condition-nya belum terpenuhi.

## 9.3 Producer Consumer Manual

```java
final class SingleSlot<T> {
    private T value;
    private boolean available;

    public synchronized void put(T item) throws InterruptedException {
        while (available) {
            wait();
        }
        value = item;
        available = true;
        notifyAll();
    }

    public synchronized T take() throws InterruptedException {
        while (!available) {
            wait();
        }
        T result = value;
        value = null;
        available = false;
        notifyAll();
        return result;
    }
}
```

Tetapi dalam production, gunakan:

```java
BlockingQueue<T> queue = new ArrayBlockingQueue<>(1000);
```

## 9.4 `notify` vs `notifyAll`

`notify()` membangunkan satu waiter arbitrarily.

`notifyAll()` membangunkan semua waiter.

Gunakan `notifyAll()` jika:

- ada lebih dari satu condition,
- kamu tidak yakin waiter mana yang tepat,
- correctness lebih penting daripada micro-optimization.

Lebih baik lagi: gunakan `Condition` dari `ReentrantLock` atau high-level concurrency utility.

---

## 10. `volatile`: Visibility dan Ordering, Bukan Lock

## 10.1 Apa yang Dijamin `volatile`?

`volatile` memberi:

- visibility: write terlihat oleh subsequent read,
- ordering: write/read volatile membentuk memory barrier tertentu,
- atomic read/write untuk variable tersebut.

Tapi `volatile` tidak memberi mutual exclusion.

## 10.2 Use Case Bagus: Stop Flag

```java
final class Worker implements Runnable {
    private volatile boolean stop;

    public void requestStop() {
        stop = true;
    }

    @Override
    public void run() {
        while (!stop) {
            doWork();
        }
    }
}
```

## 10.3 Use Case Bagus: One-Time Publication Flag

```java
final class Cache {
    private Map<String, Rule> rules;
    private volatile boolean initialized;

    void initialize() {
        Map<String, Rule> loaded = loadRules();
        rules = Map.copyOf(loaded);
        initialized = true;
    }

    Rule find(String key) {
        if (!initialized) {
            throw new IllegalStateException("not initialized");
        }
        return rules.get(key);
    }
}
```

Jika reader melihat `initialized == true`, write sebelumnya ke `rules` visible.

Namun ini hanya aman jika initialization dilakukan dengan discipline yang benar dan tidak ada concurrent reinitialization broken.

## 10.4 Use Case Buruk: Counter

Buruk:

```java
volatile int count;

void increment() {
    count++;
}
```

`count++` tetap read-modify-write, bukan atomic.

Gunakan:

```java
AtomicInteger count = new AtomicInteger();

void increment() {
    count.incrementAndGet();
}
```

## 10.5 Use Case Buruk: Compound Invariant

Buruk:

```java
volatile int openCount;
volatile int closedCount;
```

Jika invariant bergantung pada dua field sekaligus, `volatile` tidak cukup.

Gunakan lock atau immutable snapshot.

```java
record CaseStats(int open, int closed) {}

final class Stats {
    private volatile CaseStats stats = new CaseStats(0, 0);

    void update(CaseStats newStats) {
        stats = newStats;
    }

    CaseStats snapshot() {
        return stats;
    }
}
```

Immutable snapshot sering lebih baik daripada banyak volatile field.

## 10.6 Volatile Mental Model

`volatile` cocok ketika state:

- kecil,
- single variable,
- independent,
- update tidak bergantung pada current value,
- atau digunakan sebagai publication flag.

`volatile` tidak cocok ketika:

- ada check-then-act,
- ada read-modify-write,
- ada multi-field invariant,
- perlu blocking/waiting,
- perlu fairness,
- perlu transactional update.

---

## 11. `final` Field Semantics dan Safe Immutable Object

`final` bukan hanya “tidak bisa assign ulang”. Dalam concurrency, `final` field memiliki semantics khusus untuk safe initialization.

Contoh immutable object:

```java
public final class CaseId {
    private final String value;

    public CaseId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("blank case id");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }
}
```

Jika object dikonstruksi dengan benar dan reference-nya dipublish tanpa `this` leakage, thread lain yang melihat object itu memiliki guarantee lebih baik untuk melihat final fields yang sudah diinisialisasi.

## 11.1 This Leakage Merusak Final Semantics

Buruk:

```java
final class Broken {
    private final int value;

    Broken(Registry registry) {
        registry.register(this); // this escapes before constructor complete
        this.value = 42;
    }
}
```

Thread lain bisa melihat object sebelum construction selesai.

## 11.2 Immutable Tidak Sama dengan Deeply Immutable

```java
public final class CaseRules {
    private final List<String> rules;

    public CaseRules(List<String> rules) {
        this.rules = rules; // broken jika list dari luar mutable
    }

    public List<String> rules() {
        return rules; // exposes mutable list
    }
}
```

Lebih baik:

```java
public final class CaseRules {
    private final List<String> rules;

    public CaseRules(List<String> rules) {
        this.rules = List.copyOf(rules);
    }

    public List<String> rules() {
        return rules;
    }
}
```

## 11.3 Record dan Final Fields

Record component pada dasarnya final.

```java
public record CaseAssignment(String caseId, String officerId) {
    public CaseAssignment {
        if (caseId == null || caseId.isBlank()) {
            throw new IllegalArgumentException("blank caseId");
        }
        if (officerId == null || officerId.isBlank()) {
            throw new IllegalArgumentException("blank officerId");
        }
    }
}
```

Namun record tidak otomatis deep immutable. Jika component adalah mutable object, kamu tetap butuh defensive copy.

---

## 12. Safe Publication

Safe publication berarti object yang dibuat di satu thread dipublish ke thread lain dengan cara yang menjamin state yang diinisialisasi terlihat benar.

## 12.1 Cara Safe Publication

### Static Initialization

```java
final class RulesHolder {
    static final Map<String, Rule> RULES = loadRules();
}
```

Class initialization memberi synchronization guarantee.

### Volatile Reference

```java
private volatile Config config;

void reload() {
    config = loadConfig();
}

Config current() {
    return config;
}
```

### Lock

```java
private final Object lock = new Object();
private Config config;

void reload() {
    Config loaded = loadConfig();
    synchronized (lock) {
        config = loaded;
    }
}

Config current() {
    synchronized (lock) {
        return config;
    }
}
```

### Concurrent Collection

```java
ConcurrentHashMap<String, Rule> rules = new ConcurrentHashMap<>();

rules.put("A", rule);
Rule rule = rules.get("A");
```

Concurrent collections memiliki memory consistency effects untuk operasi terkait.

### Thread Start

```java
Config config = loadConfig();
Thread t = new Thread(() -> use(config));
t.start();
```

### Future Get

```java
Future<Config> future = executor.submit(this::loadConfig);
Config config = future.get();
```

## 12.2 Unsafe Publication

Buruk:

```java
class Holder {
    int a;
    int b;
}

class Registry {
    Holder holder;

    void init() {
        Holder h = new Holder();
        h.a = 1;
        h.b = 2;
        holder = h; // unsafe publication
    }
}
```

Thread lain bisa melihat `holder != null`, tetapi fields belum terlihat sesuai ekspektasi.

Fix:

```java
class Registry {
    private volatile Holder holder;

    void init() {
        Holder h = new Holder();
        h.a = 1;
        h.b = 2;
        holder = h;
    }
}
```

Lebih baik lagi gunakan immutable holder:

```java
record Holder(int a, int b) {}

class Registry {
    private volatile Holder holder;

    void init() {
        holder = new Holder(1, 2);
    }
}
```

## 12.3 Double-Checked Locking

Broken jika tanpa volatile:

```java
class BrokenLazy {
    private Expensive value;

    Expensive get() {
        if (value == null) {
            synchronized (this) {
                if (value == null) {
                    value = new Expensive();
                }
            }
        }
        return value;
    }
}
```

Benar:

```java
class Lazy {
    private volatile Expensive value;

    Expensive get() {
        Expensive result = value;
        if (result == null) {
            synchronized (this) {
                result = value;
                if (result == null) {
                    result = new Expensive();
                    value = result;
                }
            }
        }
        return result;
    }
}
```

Namun sering lebih baik gunakan holder idiom:

```java
final class LazyHolderExample {
    private LazyHolderExample() {}

    private static final class Holder {
        static final Expensive INSTANCE = new Expensive();
    }

    static Expensive instance() {
        return Holder.INSTANCE;
    }
}
```

---

## 13. Atomic Classes, CAS, ABA, dan `LongAdder`

## 13.1 AtomicInteger

```java
AtomicInteger counter = new AtomicInteger();

int next = counter.incrementAndGet();
```

Atomic classes memakai operasi atomic hardware seperti compare-and-swap pada banyak platform.

## 13.2 Compare-And-Set

```java
AtomicReference<Status> status = new AtomicReference<>(Status.NEW);

boolean accepted = status.compareAndSet(Status.NEW, Status.PROCESSING);
```

Ini cocok untuk state transition sederhana.

## 13.3 CAS Loop

```java
AtomicReference<CaseState> state = new AtomicReference<>(initial);

void transition(UnaryOperator<CaseState> update) {
    while (true) {
        CaseState current = state.get();
        CaseState next = update.apply(current);

        if (state.compareAndSet(current, next)) {
            return;
        }
    }
}
```

Masalah:

- update function harus pure/idempotent,
- jangan melakukan side effect di dalam CAS loop,
- contention tinggi bisa menyebabkan retry mahal.

Buruk:

```java
while (true) {
    CaseState current = state.get();
    auditLog.write("transition attempt"); // side effect bisa berkali-kali
    CaseState next = current.approve();
    if (state.compareAndSet(current, next)) {
        return;
    }
}
```

Benar:

```java
CaseState previous;
CaseState next;

while (true) {
    previous = state.get();
    next = previous.approve();
    if (state.compareAndSet(previous, next)) {
        break;
    }
}

auditLog.write("transition committed");
```

## 13.4 ABA Problem

ABA terjadi ketika value terlihat kembali ke nilai lama, tetapi sebenarnya sempat berubah.

```text
Thread A reads A
Thread B changes A -> B -> A
Thread A CAS A -> C succeeds
```

Untuk beberapa algoritma lock-free, ini salah karena state pernah berubah.

Solusi:

- `AtomicStampedReference`,
- versioned state,
- immutable state dengan version,
- lock jika correctness lebih penting daripada lock-free complexity.

Contoh versioned state:

```java
record VersionedCaseState(long version, CaseStatus status) {}

AtomicReference<VersionedCaseState> ref =
    new AtomicReference<>(new VersionedCaseState(0, CaseStatus.NEW));

boolean approve() {
    VersionedCaseState current = ref.get();

    VersionedCaseState next = new VersionedCaseState(
        current.version() + 1,
        CaseStatus.APPROVED
    );

    return ref.compareAndSet(current, next);
}
```

## 13.5 AtomicInteger vs LongAdder

`AtomicLong` bagus untuk counter dengan contention rendah/sedang.

`LongAdder` bagus untuk high-contention statistics counter.

```java
LongAdder requests = new LongAdder();

void onRequest() {
    requests.increment();
}

long total() {
    return requests.sum();
}
```

Trade-off:

| Type | Cocok untuk |
|---|---|
| `AtomicLong` | exact value, CAS update, moderate contention |
| `LongAdder` | high-contention counting/statistics |
| `LongAccumulator` | custom associative accumulation |

Jangan gunakan `LongAdder` jika kamu butuh immediate exact value untuk control flow critical.

---

## 14. `VarHandle`: Modern Low-Level Access

`VarHandle` adalah mechanism modern untuk akses variable/array/field dengan memory ordering mode yang eksplisit.

Banyak engineer aplikasi tidak perlu langsung memakai `VarHandle`, tetapi perlu tahu karena:

- library concurrency menggunakannya,
- menggantikan sebagian use case `Unsafe`,
- menyediakan access mode seperti opaque/acquire/release/volatile,
- relevan untuk high-performance libraries.

Contoh sederhana:

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

final class VarHandleExample {
    private int value;

    private static final VarHandle VALUE;

    static {
        try {
            VALUE = MethodHandles.lookup()
                .findVarHandle(VarHandleExample.class, "value", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    boolean compareAndSet(int expected, int update) {
        return VALUE.compareAndSet(this, expected, update);
    }

    int getVolatile() {
        return (int) VALUE.getVolatile(this);
    }

    void setRelease(int newValue) {
        VALUE.setRelease(this, newValue);
    }
}
```

## 14.1 Jangan Terlalu Cepat Pakai `VarHandle`

Urutan pilihan:

1. plain immutable design,
2. lock,
3. concurrent collection,
4. atomic classes,
5. `VarHandle`,
6. custom lock-free algorithm.

Jika kamu tidak bisa membuktikan correctness lock-free algorithm, jangan pakai hanya demi terlihat advanced.

---

## 15. Explicit Locks: `ReentrantLock`, `ReadWriteLock`, `StampedLock`

## 15.1 `ReentrantLock`

`ReentrantLock` memberi fitur lebih dari `synchronized`:

- `tryLock`,
- timed lock,
- interruptible lock acquisition,
- fairness option,
- multiple `Condition`.

```java
final class CaseIndex {
    private final ReentrantLock lock = new ReentrantLock();
    private final Map<String, CaseRecord> index = new HashMap<>();

    void put(CaseRecord record) {
        lock.lock();
        try {
            index.put(record.id(), record);
        } finally {
            lock.unlock();
        }
    }
}
```

Pattern wajib:

```java
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();
}
```

## 15.2 `tryLock`

```java
if (lock.tryLock()) {
    try {
        updateIndex();
    } finally {
        lock.unlock();
    }
} else {
    metrics.incrementSkippedLock();
}
```

Cocok untuk best-effort work.

## 15.3 Interruptible Lock

```java
lock.lockInterruptibly();
try {
    doWork();
} finally {
    lock.unlock();
}
```

Cocok jika cancellation responsiveness penting.

## 15.4 Condition

```java
final class BoundedBuffer<T> {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notEmpty = lock.newCondition();
    private final Condition notFull = lock.newCondition();

    private final Queue<T> queue = new ArrayDeque<>();
    private final int capacity;

    BoundedBuffer(int capacity) {
        this.capacity = capacity;
    }

    void put(T item) throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (queue.size() == capacity) {
                notFull.await();
            }
            queue.add(item);
            notEmpty.signal();
        } finally {
            lock.unlock();
        }
    }

    T take() throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (queue.isEmpty()) {
                notEmpty.await();
            }
            T item = queue.remove();
            notFull.signal();
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```

Dalam production, gunakan `ArrayBlockingQueue` kecuali butuh custom behavior.

## 15.5 `ReadWriteLock`

Cocok untuk:

- banyak reader,
- sedikit writer,
- read operation cukup mahal,
- write jarang,
- data tidak mudah dibuat immutable snapshot.

```java
final class RuleCache {
    private final ReadWriteLock rw = new ReentrantReadWriteLock();
    private final Map<String, Rule> rules = new HashMap<>();

    Rule get(String key) {
        rw.readLock().lock();
        try {
            return rules.get(key);
        } finally {
            rw.readLock().unlock();
        }
    }

    void reload(Map<String, Rule> newRules) {
        rw.writeLock().lock();
        try {
            rules.clear();
            rules.putAll(newRules);
        } finally {
            rw.writeLock().unlock();
        }
    }
}
```

Tetapi sering lebih sederhana:

```java
final class RuleCache {
    private volatile Map<String, Rule> rules = Map.of();

    Rule get(String key) {
        return rules.get(key);
    }

    void reload(Map<String, Rule> newRules) {
        rules = Map.copyOf(newRules);
    }
}
```

Immutable snapshot + volatile reference sering mengalahkan read-write lock untuk read-mostly config.

## 15.6 `StampedLock`

`StampedLock` mendukung optimistic read.

```java
final class Point {
    private final StampedLock lock = new StampedLock();
    private double x;
    private double y;

    double distanceFromOrigin() {
        long stamp = lock.tryOptimisticRead();
        double currentX = x;
        double currentY = y;

        if (!lock.validate(stamp)) {
            stamp = lock.readLock();
            try {
                currentX = x;
                currentY = y;
            } finally {
                lock.unlockRead(stamp);
            }
        }

        return Math.hypot(currentX, currentY);
    }

    void move(double dx, double dy) {
        long stamp = lock.writeLock();
        try {
            x += dx;
            y += dy;
        } finally {
            lock.unlockWrite(stamp);
        }
    }
}
```

Caution:

- tidak reentrant,
- lebih mudah salah,
- jangan dipakai jika `ReentrantReadWriteLock` cukup,
- cocok untuk kasus tertentu, bukan default.

---

## 16. Concurrent Collections dan Blocking Queues

## 16.1 `ConcurrentHashMap`

`ConcurrentHashMap` adalah workhorse untuk concurrent map.

```java
ConcurrentHashMap<String, CaseRecord> cases = new ConcurrentHashMap<>();

cases.put(case.id(), case);
CaseRecord found = cases.get(case.id());
```

## 16.2 Atomic Map Operations

Gunakan operasi atomik map untuk menghindari check-then-act race.

Buruk:

```java
if (!map.containsKey(id)) {
    map.put(id, create(id));
}
```

Lebih baik:

```java
map.computeIfAbsent(id, this::create);
```

Untuk claim:

```java
CaseRecord previous = map.putIfAbsent(id, newRecord);
if (previous != null) {
    throw new DuplicateCaseException(id);
}
```

## 16.3 `compute` Pitfall

Function di `compute` dipanggil saat internal synchronization map sedang berlangsung. Jangan melakukan blocking call berat atau call balik ke map secara kompleks.

Buruk:

```java
map.compute(id, (key, current) -> {
    remoteService.call(); // buruk
    return update(current);
});
```

Lebih baik pisahkan remote call di luar critical mutation jika memungkinkan.

## 16.4 BlockingQueue

`BlockingQueue` menggabungkan data structure + coordination + backpressure.

```java
BlockingQueue<CaseCommand> queue = new ArrayBlockingQueue<>(1000);

queue.put(command);  // block jika penuh
CaseCommand command = queue.take(); // block jika kosong
```

Ini jauh lebih aman daripada manual wait/notify.

## 16.5 Queue Pilihan

| Queue | Cocok untuk |
|---|---|
| `ArrayBlockingQueue` | bounded fixed capacity, predictable |
| `LinkedBlockingQueue` | optionally bounded, node allocation |
| `PriorityBlockingQueue` | priority ordering, unbounded by default |
| `SynchronousQueue` | handoff langsung producer-consumer |
| `DelayQueue` | task dengan delay |
| `LinkedTransferQueue` | advanced transfer/handoff |

## 16.6 Jangan Pakai Unbounded Queue Sembarangan

Unbounded queue terlihat stabil sampai memory habis.

Buruk:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
// factory default memakai unbounded LinkedBlockingQueue
```

Jika producer lebih cepat dari consumer, queue tumbuh tanpa batas.

Lebih baik desain explicit:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,
    10,
    0L,
    TimeUnit.MILLISECONDS,
    new ArrayBlockingQueue<>(1000),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

---

## 17. Executors dan Thread Pool Design

## 17.1 Executor

`Executor` memisahkan task submission dari mechanics eksekusi.

```java
Executor executor = command -> new Thread(command).start();

executor.execute(() -> processCase("CASE-001"));
```

Namun biasanya gunakan `ExecutorService`.

## 17.2 ExecutorService

`ExecutorService` menambahkan:

- `submit`,
- `Future`,
- shutdown,
- termination,
- invokeAll/invokeAny.

```java
try (ExecutorService executor = Executors.newFixedThreadPool(8)) {
    Future<Result> future = executor.submit(() -> compute());
    Result result = future.get();
}
```

Di Java modern, `ExecutorService` adalah `AutoCloseable`, sehingga bisa dipakai dengan try-with-resources.

## 17.3 Thread Pool Anatomy

Thread pool punya:

```text
producer -> task queue -> worker threads -> task execution
```

Parameter penting:

- core pool size,
- max pool size,
- keep alive,
- work queue,
- thread factory,
- rejection handler.

## 17.4 Sizing Thread Pool

Untuk CPU-bound:

```text
threads ≈ number of cores
```

Untuk blocking I/O-bound platform threads:

```text
threads ≈ cores * (1 + waitTime / computeTime)
```

Tapi rumus ini hanya starting point. Production tuning harus berdasarkan measurement:

- CPU utilization,
- queue depth,
- task duration,
- blocking ratio,
- p95/p99 latency,
- rejection count,
- GC pressure,
- downstream saturation.

## 17.5 Thread Pool Bukan Backpressure Otomatis

Jika queue unbounded, thread pool menyerap overload sampai memory habis.

Backpressure butuh:

- bounded queue,
- rejection policy,
- semaphore,
- rate limiter,
- caller-runs,
- timeout,
- load shedding,
- circuit breaker.

## 17.6 Rejection Policy

| Policy | Behavior |
|---|---|
| `AbortPolicy` | throw `RejectedExecutionException` |
| `CallerRunsPolicy` | caller menjalankan task |
| `DiscardPolicy` | drop silently |
| `DiscardOldestPolicy` | drop oldest queue item |

Default `AbortPolicy` sering benar untuk internal system karena overload harus terlihat.

`CallerRunsPolicy` memberi natural throttling, tapi hati-hati jika caller adalah event loop atau critical scheduler.

## 17.7 Thread Factory

Gunakan thread factory untuk naming dan uncaught exception handling.

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("case-worker-", 0)
    .uncaughtExceptionHandler((thread, error) -> {
        System.err.println("Uncaught in " + thread.getName() + ": " + error);
    })
    .factory();
```

## 17.8 Shutdown

Buruk:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
// no shutdown
```

Lebih baik:

```java
executor.shutdown();
if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
    executor.shutdownNow();
}
```

Dengan try-with-resources:

```java
try (ExecutorService executor = Executors.newFixedThreadPool(10)) {
    // submit tasks
}
```

---

## 18. `Future`, `Callable`, dan Cancellation

## 18.1 `Runnable` vs `Callable`

```java
Runnable runnable = () -> doWork();

Callable<Result> callable = () -> computeResult();
```

`Callable` dapat return result dan throw checked exception.

## 18.2 Future

```java
Future<Result> future = executor.submit(callable);

Result result = future.get();
```

`Future.get()`:

- blocking,
- mengembalikan result,
- membungkus exception dalam `ExecutionException`,
- dapat throw `InterruptedException`.

## 18.3 Timeout

```java
try {
    Result result = future.get(500, TimeUnit.MILLISECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
}
```

Timeout tanpa cancellation sering hanya memindahkan masalah.

## 18.4 Cancellation

```java
boolean cancelled = future.cancel(true);
```

`true` berarti may interrupt if running.

Tapi cancellation kooperatif. Task harus merespons interrupt.

Buruk:

```java
while (true) {
    doWork();
}
```

Lebih baik:

```java
while (!Thread.currentThread().isInterrupted()) {
    doWork();
}
```

Atau jika blocking method throw `InterruptedException`:

```java
try {
    queue.take();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

---

## 19. `CompletableFuture`: Composition, Execution, dan Trap

`CompletableFuture` adalah `Future` yang bisa diselesaikan eksplisit dan juga `CompletionStage` untuk dependent action.

## 19.1 Basic

```java
CompletableFuture<User> future =
    CompletableFuture.supplyAsync(() -> userClient.fetch(userId));
```

## 19.2 Transform

```java
CompletableFuture<String> name =
    future.thenApply(User::name);
```

## 19.3 Compose

Gunakan `thenCompose` untuk async flatMap.

```java
CompletableFuture<Account> account =
    userFuture.thenCompose(user -> accountClient.fetchAsync(user.accountId()));
```

Jika pakai `thenApply`, hasilnya nested:

```java
CompletableFuture<CompletableFuture<Account>> nested =
    userFuture.thenApply(user -> accountClient.fetchAsync(user.accountId()));
```

## 19.4 Combine

```java
CompletableFuture<CaseSummary> summary =
    caseFuture.thenCombine(officerFuture, CaseSummary::new);
```

## 19.5 Execution Trap: Async vs Non-Async

Non-async stage dapat berjalan di thread yang menyelesaikan stage sebelumnya.

```java
future.thenApply(this::transform);
```

Async stage tanpa executor memakai common pool secara default.

```java
future.thenApplyAsync(this::transform);
```

Untuk production, biasanya lebih baik explicit executor:

```java
future.thenApplyAsync(this::transform, appExecutor);
```

## 19.6 Blocking di Common Pool

Buruk:

```java
CompletableFuture.supplyAsync(() -> blockingHttpCall());
```

Jika tidak memberi executor, ini memakai common pool. Blocking task bisa mengganggu task lain yang juga memakai common pool, termasuk parallel stream.

Lebih baik:

```java
CompletableFuture.supplyAsync(
    () -> blockingHttpCall(),
    ioExecutor
);
```

Dengan virtual threads:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    CompletableFuture<Response> f =
        CompletableFuture.supplyAsync(() -> blockingHttpCall(), executor);
}
```

Namun untuk fan-out/fan-in di Java modern, structured concurrency sering lebih jelas.

## 19.7 Exception Handling

```java
future
    .thenApply(this::transform)
    .exceptionally(ex -> fallback());
```

`handle` menerima sukses/gagal:

```java
future.handle((value, error) -> {
    if (error != null) {
        return fallback();
    }
    return value;
});
```

`whenComplete` untuk side effect observability:

```java
future.whenComplete((value, error) -> {
    if (error != null) {
        metrics.incrementFailure();
    }
});
```

Jangan gunakan `whenComplete` untuk recovery karena ia tidak mengganti result kecuali throw exception baru.

## 19.8 Cancellation di CompletableFuture

`CompletableFuture.cancel` menyelesaikan future secara exceptional dengan `CancellationException`. Ia tidak selalu punya kontrol langsung atas computation yang sedang berjalan, terutama jika computation dibuat di tempat lain.

Karena itu cancellation `CompletableFuture` sering lebih lemah dibanding structured concurrency yang punya ownership task lebih jelas.

## 19.9 CompletableFuture Decision

Gunakan `CompletableFuture` jika:

- kamu membangun API asynchronous,
- perlu composition non-blocking,
- workflow continuation-based,
- integrasi library async.

Hindari jika:

- logic menjadi nested dan sulit dibaca,
- butuh lifecycle parent-child task yang jelas,
- cancellation/error propagation menjadi manual,
- kamu hanya melakukan blocking I/O fan-out/fan-in sederhana.

---

## 20. ForkJoinPool dan Work-Stealing

`ForkJoinPool` dirancang untuk task kecil yang bisa dipecah menjadi subtasks.

Contoh conceptual:

```java
class SumTask extends RecursiveTask<Long> {
    private final long[] array;
    private final int start;
    private final int end;

    SumTask(long[] array, int start, int end) {
        this.array = array;
        this.start = start;
        this.end = end;
    }

    @Override
    protected Long compute() {
        if (end - start <= 10_000) {
            long sum = 0;
            for (int i = start; i < end; i++) {
                sum += array[i];
            }
            return sum;
        }

        int mid = (start + end) >>> 1;
        SumTask left = new SumTask(array, start, mid);
        SumTask right = new SumTask(array, mid, end);

        left.fork();
        long rightResult = right.compute();
        long leftResult = left.join();

        return leftResult + rightResult;
    }
}
```

## 20.1 Work-Stealing Mental Model

Worker punya deque. Worker mengambil task sendiri. Jika habis, ia mencuri task dari worker lain.

Cocok:

- recursive divide-and-conquer,
- CPU-bound,
- task cukup kecil tapi tidak terlalu kecil,
- minim blocking.

Tidak cocok:

- blocking I/O berat,
- task panjang yang tidak split,
- hidden lock contention tinggi.

## 20.2 Common Pool

Common pool dipakai oleh:

- parallel stream,
- `CompletableFuture` async tanpa executor,
- beberapa framework/library.

Jangan jadikan common pool tempat sampah semua task.

---

## 21. Virtual Threads

Virtual threads adalah perubahan besar dalam Java modern.

Mereka memungkinkan kembali ke model sederhana:

```text
one request = one thread
one task = one thread
blocking code tetap readable
scalability mendekati async style untuk I/O-bound workload
```

## 21.1 Basic Usage

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> user = executor.submit(() -> fetchUser(userId));
    Future<String> cases = executor.submit(() -> fetchCases(userId));

    String result = user.get() + cases.get();
}
```

## 21.2 Jangan Pool Virtual Threads

Platform thread mahal, jadi dipool.

Virtual thread murah, jadi tidak perlu dipool.

Buruk:

```java
// Jangan membuat fixed pool berisi virtual threads untuk membatasi concurrency.
```

Jika ingin membatasi akses ke resource, gunakan semaphore.

```java
final class LimitedClient {
    private final Semaphore permits = new Semaphore(20);

    Response call(Request request) throws InterruptedException {
        permits.acquire();
        try {
            return remoteCall(request);
        } finally {
            permits.release();
        }
    }
}
```

## 21.3 Virtual Thread Cocok Untuk

- blocking HTTP client,
- JDBC call,
- file I/O tertentu,
- request-per-thread server model,
- fan-out I/O,
- task yang banyak menunggu.

## 21.4 Virtual Thread Tidak Membuat CPU-bound Lebih Cepat

Jika task CPU-bound:

```java
sortHugeArray();
compressLargeFile();
cryptoHeavyOperation();
imageProcessing();
```

Membuat jutaan virtual thread tidak membantu. CPU core tetap terbatas.

Gunakan:

- bounded platform pool,
- ForkJoinPool,
- parallel stream,
- vector API,
- algorithmic optimization.

## 21.5 Pinning

Pinning berarti virtual thread tidak bisa melepas carrier platform thread ketika blocking.

JDK 24 mengurangi hampir semua kasus pinning akibat blocking dalam `synchronized`, tetapi masih ada situasi native/foreign calls atau blocking tertentu yang bisa membuat virtual thread tidak scalable.

Rule tetap:

- jangan melakukan long blocking I/O di dalam critical section,
- jangan hold lock saat call remote,
- ukur dengan JFR/thread dump,
- gunakan library yang virtual-thread-friendly.

## 21.6 Virtual Threads dan ThreadLocal

Virtual threads mendukung `ThreadLocal`.

Tetapi hati-hati:

```java
static final ThreadLocal<ExpensiveObject> CACHE = new ThreadLocal<>();
```

Jika ada jutaan virtual thread, per-thread cache bisa mahal.

Virtual thread sebaiknya short-lived. Untuk request context immutable, gunakan Scoped Values bila cocok.

## 21.7 Virtual Thread Anti-Patterns

### Anti-pattern: virtual thread pool

```java
// Salah konsep: virtual thread tidak perlu dipool
```

### Anti-pattern: unlimited downstream calls

```java
for (Request r : requests) {
    Thread.startVirtualThread(() -> downstream.call(r));
}
```

Jika `requests` 1 juta, downstream bisa hancur.

Gunakan semaphore/batching/rate limiting.

### Anti-pattern: assume faster latency

Virtual thread meningkatkan scalability/throughput I/O-bound, bukan membuat satu remote call lebih cepat.

### Anti-pattern: ignore cancellation

Jutaan virtual thread yang stuck tetap masalah.

Gunakan timeout dan cancellation.

---

## 22. Structured Concurrency

Structured concurrency memperlakukan sekelompok task terkait sebagai satu unit kerja.

Masalah unstructured concurrency:

```java
Future<A> a = executor.submit(this::fetchA);
Future<B> b = executor.submit(this::fetchB);

return combine(a.get(), b.get());
```

Apa yang terjadi jika:

- `fetchA` gagal?
- `fetchB` masih running?
- parent request timeout?
- task child leak?
- result partial?
- thread dump ingin menunjukkan hubungan parent-child?

Structured concurrency mencoba membuat lifecycle task mengikuti struktur code.

## 22.1 Mental Model

```text
Parent scope starts
  fork child A
  fork child B
  wait/join children
  handle success/failure as one unit
Parent scope ends
  no child left behind
```

## 22.2 Status Java 25

Di Java 25, Structured Concurrency masih preview API.

Artinya:

- perlu `--enable-preview`,
- API bisa berubah di versi berikutnya,
- cocok untuk belajar/eksperimen atau production jika organisasi menerima preview risk,
- jangan publish library public API yang bergantung pada preview tanpa strategi migration.

## 22.3 Conceptual Example

API dapat berubah antar preview, jadi pahami mental modelnya:

```java
try (var scope = StructuredTaskScope.open()) {
    Subtask<User> user = scope.fork(() -> userClient.fetch(userId));
    Subtask<List<CaseRecord>> cases = scope.fork(() -> caseClient.fetchByUser(userId));

    scope.join();

    return new UserCaseView(user.get(), cases.get());
}
```

Tujuan:

- semua child task jelas milik scope,
- scope bertanggung jawab join/cancel,
- failure policy eksplisit,
- observability lebih baik.

## 22.4 Kapan Structured Concurrency Lebih Baik dari CompletableFuture

| Use case | Pilihan |
|---|---|
| fan-out/fan-in blocking I/O | structured concurrency |
| request lifecycle dengan timeout | structured concurrency |
| parent-child task ownership penting | structured concurrency |
| async API pipeline | CompletableFuture |
| library API already CompletionStage | CompletableFuture |
| event-driven callback style | CompletableFuture/reactive |

## 22.5 Failure Propagation

Dalam unstructured concurrency, failure sering tersebar.

Structured concurrency mendorong policy seperti:

- shutdown on failure,
- shutdown on success,
- collect all failures,
- cancel siblings when parent cancelled.

Ini sangat cocok untuk request handling:

```text
GET /dashboard
  fetch profile
  fetch permissions
  fetch cases
  fetch notifications

Jika permissions gagal, mungkin semua harus gagal.
Jika notifications gagal, mungkin fallback empty.
```

Policy harus domain-specific.

---

## 23. Scoped Values

Scoped Values adalah mekanisme untuk membagikan immutable contextual data dari caller ke callees dalam bounded dynamic scope.

Ini mirip “parameter tersembunyi yang aman dan bounded”, bukan global mutable context.

## 23.1 Masalah ThreadLocal

ThreadLocal sering digunakan untuk:

- request id,
- user id,
- tenant id,
- trace id,
- transaction context,
- security context.

Contoh:

```java
static final ThreadLocal<RequestContext> CONTEXT = new ThreadLocal<>();
```

Masalah:

- mutable,
- lifetime tidak jelas,
- lupa `remove()` menyebabkan leak,
- thread pool reuse bisa membocorkan context antar request,
- mahal jika jutaan virtual thread,
- dataflow tersembunyi.

## 23.2 ScopedValue Basic

```java
static final ScopedValue<RequestContext> REQUEST_CONTEXT =
    ScopedValue.newInstance();

void handle(Request request) {
    RequestContext context = new RequestContext(request.id(), request.userId());

    ScopedValue.where(REQUEST_CONTEXT, context)
        .run(() -> service.handle(request));
}

void insideService() {
    RequestContext context = REQUEST_CONTEXT.get();
}
```

Binding hanya hidup selama `run()`.

Setelah scope selesai, binding hilang.

## 23.3 Bounded Lifetime

Ini keunggulan besar.

```java
ScopedValue.where(USER_ID, "u-123").run(() -> {
    serviceA();
    serviceB();
});

// di luar sini USER_ID tidak bound
```

Tidak ada `set` arbitrary seperti `ThreadLocal`.

## 23.4 One-Way Data Flow

Scoped value cocok untuk:

```text
caller -> callee -> deeper callee
```

Tidak cocok untuk:

```text
callee -> caller mutable output
```

Jika callee perlu mengembalikan data, gunakan return value, object result, event, atau explicit collector.

## 23.5 Scoped Values dan Structured Concurrency

Scoped values dapat diwariskan ke child threads yang dibuat dengan structured concurrency.

Ini penting untuk request context:

```text
request handler binds context
  child task fetch A sees context
  child task fetch B sees context
scope ends, context gone
```

## 23.6 Kapan Pakai ScopedValue vs ThreadLocal

| Need | Pilihan |
|---|---|
| immutable request context | ScopedValue |
| bounded lifetime jelas | ScopedValue |
| child tasks perlu inherit context | ScopedValue + structured concurrency |
| mutable per-thread accumulator | ThreadLocal mungkin |
| legacy framework integration | ThreadLocal mungkin perlu |
| object pooling per platform thread | hati-hati; jangan untuk virtual threads |

---

## 24. Interruption, Timeout, dan Cancellation sebagai Design Primitive

## 24.1 Interrupt Bukan Kill

`interrupt()` tidak memaksa thread mati. Ia mengirim sinyal kooperatif.

```java
thread.interrupt();
```

Task harus merespons.

## 24.2 Pola Benar Menangani InterruptedException

Jika method tidak bisa throw `InterruptedException`:

```java
try {
    queue.take();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

Jangan swallow interrupt.

Buruk:

```java
catch (InterruptedException e) {
    // ignore
}
```

Ini membuat cancellation hilang.

## 24.3 Timeout Harus Propagate

Buruk:

```java
Result result = client.call(); // tanpa timeout
```

Lebih baik:

```java
Result result = client.call(Duration.ofMillis(500));
```

Atau:

```java
Future<Result> future = executor.submit(this::call);
try {
    return future.get(500, TimeUnit.MILLISECONDS);
} catch (TimeoutException e) {
    future.cancel(true);
    throw new DownstreamTimeoutException(e);
}
```

## 24.4 Timeout Budget

Dalam distributed system, setiap request punya budget.

```text
API timeout: 2s
  validation: 50ms
  DB: 300ms
  service A: 500ms
  service B: 500ms
  render/serialize: 100ms
  buffer: 550ms
```

Concurrency tanpa timeout budget akan membuat thread/task menumpuk saat downstream lambat.

## 24.5 Cancellation Policy

Tentukan:

- siapa boleh cancel?
- kapan cancel?
- apa yang terjadi pada child tasks?
- apakah partial result valid?
- apakah side effect sudah terjadi?
- apakah retry aman?
- apakah idempotency key dipakai?

---

## 25. Backpressure dan Bounded Concurrency

Concurrency memperbesar throughput sampai resource bottleneck tercapai. Setelah itu, concurrency tanpa backpressure hanya memperbesar antrian dan latency.

## 25.1 Little's Law Mental Model

Secara intuitif:

```text
concurrency ≈ throughput × latency
```

Jika latency downstream naik, jumlah in-flight request naik.

Jika tidak dibatasi, memory/thread/connection bisa habis.

## 25.2 Bounded Queue

```java
BlockingQueue<Command> queue = new ArrayBlockingQueue<>(10_000);
```

Jika penuh:

- block producer,
- reject,
- drop low-priority,
- shed load,
- retry later.

Pilihan harus business-aware.

## 25.3 Semaphore untuk Downstream Limit

```java
final class DownstreamBulkhead {
    private final Semaphore permits = new Semaphore(50);

    Response call(Request request) throws InterruptedException {
        if (!permits.tryAcquire(200, TimeUnit.MILLISECONDS)) {
            throw new TooManyConcurrentCallsException();
        }

        try {
            return httpClient.call(request);
        } finally {
            permits.release();
        }
    }
}
```

## 25.4 Virtual Threads Tetap Butuh Backpressure

Virtual thread membuat blocking murah, bukan downstream tak terbatas.

Jika service downstream hanya mampu 100 concurrent requests, kamu tetap harus batasi ke 100 atau kurang.

## 25.5 Backpressure Strategy

| Strategy | Cocok untuk |
|---|---|
| bounded queue | worker pipeline |
| semaphore | downstream concurrency limit |
| rate limiter | request per time window |
| circuit breaker | failing downstream |
| caller-runs | internal throttling |
| load shedding | non-critical traffic |
| priority queue | differentiated workload |
| bulkhead | isolasi resource |

---

## 26. Common Failure Modes

## 26.1 Lost Update

```java
count++;
```

Fix: lock/atomic.

## 26.2 Check-Then-Act Race

```java
if (!map.containsKey(key)) {
    map.put(key, value);
}
```

Fix: `putIfAbsent`, `computeIfAbsent`.

## 26.3 Unsafe Publication

```java
shared = new MutableObject(...);
```

Fix: final fields + safe publication mechanism.

## 26.4 Deadlock

```java
// Thread A
synchronized (lockA) {
    synchronized (lockB) {}
}

// Thread B
synchronized (lockB) {
    synchronized (lockA) {}
}
```

Fix:

- lock ordering,
- reduce lock scope,
- tryLock timeout,
- avoid nested locks,
- immutable/actor model.

## 26.5 Livelock

Threads aktif tetapi tidak progress karena saling merespons.

Contoh: dua worker terus saling yield/retry karena collision.

Fix:

- randomized backoff,
- central arbiter,
- lock ordering,
- bounded retry.

## 26.6 Starvation

Task tidak mendapat resource.

Penyebab:

- pool terlalu kecil,
- task blocking di pool CPU,
- unfair lock,
- priority inversion,
- common pool dipakai blocking I/O.

## 26.7 Thread Pool Deadlock

```java
ExecutorService executor = Executors.newFixedThreadPool(1);

Future<String> outer = executor.submit(() -> {
    Future<String> inner = executor.submit(() -> "inner");
    return inner.get();
});

outer.get();
```

Pool 1 thread menjalankan outer, inner tidak pernah jalan.

Fix:

- jangan submit nested blocking ke pool yang sama,
- gunakan separate executor,
- gunakan structured concurrency,
- gunakan virtual threads untuk task blocking,
- redesign composition.

## 26.8 Blocking in Event Loop

Jika memakai framework event-loop/reactive, blocking call di event loop menyebabkan global latency spike.

Fix:

- offload blocking work ke bounded executor,
- gunakan async non-blocking client,
- jangan campur model tanpa boundary jelas.

## 26.9 Missing Interrupt Handling

```java
catch (InterruptedException e) {
    log.warn("interrupted");
}
```

Fix:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 26.10 Unbounded Fan-Out

```java
for (CaseId id : ids) {
    executor.submit(() -> callDownstream(id));
}
```

Jika `ids` besar, overload.

Fix:

- batching,
- semaphore,
- bounded executor,
- structured concurrency with limit,
- stream windowing.

---

## 27. Concurrency Design Patterns

## 27.1 Thread Confinement

State hanya diakses oleh satu thread.

```java
final class SingleThreadedProcessor {
    private final ExecutorService executor =
        Executors.newSingleThreadExecutor();

    private final Map<String, CaseRecord> state = new HashMap<>();

    void submit(Command command) {
        executor.execute(() -> apply(command));
    }

    private void apply(Command command) {
        // only executor thread touches state
    }
}
```

Keunggulan:

- minim lock,
- invariant mudah,
- ordering jelas.

Kekurangan:

- throughput single lane,
- satu task lambat menahan berikutnya,
- perlu shard jika scale.

## 27.2 Immutable Snapshot

```java
final class RulesCache {
    private volatile Map<String, Rule> rules = Map.of();

    Rule get(String key) {
        return rules.get(key);
    }

    void reload(Map<String, Rule> newRules) {
        rules = Map.copyOf(newRules);
    }
}
```

Keunggulan:

- read tanpa lock,
- safe publication via volatile,
- invariant map konsisten.

Kekurangan:

- reload copy cost,
- tidak cocok untuk high-frequency writes besar.

## 27.3 Actor-ish Model

Setiap entity punya mailbox.

```text
Case CASE-001 mailbox:
  AssignOfficer
  RequestInfo
  Approve
  Close
```

Semua command untuk case yang sama diproses serial.

Keunggulan:

- state per aggregate tidak butuh lock,
- domain ordering jelas,
- cocok untuk state machine.

Kekurangan:

- routing/sharding complexity,
- mailbox backpressure,
- cross-entity transaction susah.

## 27.4 Bulkhead

Pisahkan executor/resource per workload.

```text
external-api-pool
report-generation-pool
email-sending-pool
case-transition-pool
```

Jangan biarkan report lambat menghabiskan semua worker request critical.

## 27.5 Producer-Consumer

```java
BlockingQueue<Command> queue = new ArrayBlockingQueue<>(1000);

producer -> queue -> consumers
```

Cocok untuk pipeline.

Pastikan:

- bounded queue,
- poison pill/shutdown,
- retry policy,
- DLQ,
- metrics queue depth,
- idempotency.

## 27.6 Fan-Out/Fan-In

```text
request
  -> fetch profile
  -> fetch cases
  -> fetch permissions
  -> combine
```

Modern Java:

- virtual threads untuk blocking calls,
- structured concurrency untuk lifecycle,
- timeout budget,
- cancellation siblings on failure.

## 27.7 Single Writer Principle

Satu state punya satu writer.

Readers bisa via immutable snapshot/event.

Ini mengurangi kebutuhan lock dan memperjelas invariant.

---

## 28. Production Diagnostics

## 28.1 Thread Dump

Gunakan:

```bash
jcmd <pid> Thread.print
```

Untuk virtual threads, gunakan thread dump format yang mendukung virtual thread grouping.

Contoh:

```bash
jcmd <pid> Thread.dump_to_file -format=json threads.json
```

Cari:

- deadlock,
- banyak thread BLOCKED pada lock sama,
- WAITING tanpa timeout,
- TIMED_WAITING pada downstream call,
- pool worker semua blocked,
- virtual thread jumlah ekstrem,
- common pool starvation.

## 28.2 JFR

Java Flight Recorder berguna untuk:

- thread park,
- monitor enter,
- socket read/write,
- allocation,
- CPU profiling,
- virtual thread events,
- lock contention,
- exception rate.

Start recording:

```bash
jcmd <pid> JFR.start name=case-profile settings=profile duration=60s filename=case-profile.jfr
```

## 28.3 Metrics

Minimal concurrency metrics:

- active threads,
- pool size,
- queue depth,
- task submitted/completed/failed,
- rejection count,
- task duration,
- wait duration,
- lock contention,
- downstream concurrency,
- timeout count,
- cancellation count.

## 28.4 Logs

Log untuk concurrency harus memiliki:

- request id,
- task id,
- thread name,
- case id,
- state version,
- timeout budget,
- attempt number,
- cancellation reason.

Namun jangan log terlalu banyak di hot path high concurrency.

## 28.5 Diagnosing Thread Pool Starvation

Gejala:

- latency naik,
- CPU rendah,
- queue depth naik,
- active worker penuh,
- thread dump menunjukkan worker blocking pada I/O atau `Future.get()`.

Fix:

- pisahkan blocking I/O pool,
- gunakan virtual threads,
- batasi downstream,
- hindari nested blocking,
- perbaiki timeout.

## 28.6 Diagnosing Deadlock

Gunakan thread dump.

Pattern:

```text
Thread A waiting to lock B, holding A
Thread B waiting to lock A, holding B
```

Fix:

- global lock ordering,
- reduce nested locking,
- use tryLock timeout,
- redesign state ownership.

---

## 29. Decision Framework

## 29.1 Pertanyaan Awal

Sebelum memilih primitive concurrency:

1. Apakah state perlu shared?
2. Bisa dibuat immutable?
3. Bisa dibuat thread-confined?
4. Bisa memakai queue/message passing?
5. Berapa banyak writer?
6. Apakah operation CPU-bound atau I/O-bound?
7. Apakah butuh ordering?
8. Apakah butuh cancellation?
9. Apa batas concurrency?
10. Apa failure policy?

## 29.2 Primitive Selection

| Problem | Pilihan awal |
|---|---|
| single shared counter | `AtomicLong` / `LongAdder` |
| stop flag | `volatile boolean` |
| lazy singleton | holder idiom |
| multi-field invariant | lock / immutable snapshot |
| read-mostly config | volatile immutable snapshot |
| producer-consumer | `BlockingQueue` |
| bounded downstream calls | `Semaphore` |
| CPU-bound parallelism | fixed pool / ForkJoinPool |
| blocking I/O per request | virtual threads |
| fan-out/fan-in request | structured concurrency |
| async composition API | `CompletableFuture` |
| request context | ScopedValue |
| legacy mutable per-thread context | ThreadLocal carefully |
| high-contention map | `ConcurrentHashMap` |
| exact state transition | `AtomicReference` CAS or lock |

## 29.3 Lock vs Atomic

Gunakan lock jika:

- invariant multi-field,
- update complex,
- failure handling complex,
- side effect perlu dilakukan setelah commit,
- correctness lebih penting dari micro-performance.

Gunakan atomic jika:

- state kecil,
- transition sederhana,
- side effect bisa dipisah,
- contention manageable,
- kamu bisa membuktikan CAS loop benar.

## 29.4 Virtual Thread vs Platform Pool

Gunakan virtual threads jika:

- banyak task I/O-bound,
- blocking API,
- request-per-task style,
- ingin stack trace readable,
- tidak ingin callback hell.

Gunakan platform bounded pool jika:

- CPU-bound,
- native library thread affinity,
- task jumlah kecil/panjang,
- butuh strict worker count,
- framework belum virtual-thread-friendly.

## 29.5 CompletableFuture vs Structured Concurrency

Gunakan `CompletableFuture` jika:

- API naturally async,
- perlu return `CompletionStage`,
- stage composition panjang,
- tidak ingin block current thread.

Gunakan structured concurrency jika:

- parent task membuat child tasks,
- child lifecycle harus bounded,
- failure/cancellation siblings penting,
- code blocking lebih readable,
- observability parent-child penting.

---

## 30. Code Review Checklist

## 30.1 Shared State

- [ ] State apa yang shared antar-thread?
- [ ] Apakah state mutable?
- [ ] Siapa owner state?
- [ ] Apakah bisa immutable/thread-confined?
- [ ] Apakah semua access melalui synchronization yang sama?

## 30.2 Happens-Before

- [ ] Apa happens-before edge writer ke reader?
- [ ] Apakah field perlu `volatile`?
- [ ] Apakah lock yang sama dipakai untuk read dan write?
- [ ] Apakah object dipublish dengan aman?
- [ ] Apakah constructor membocorkan `this`?

## 30.3 Atomicity

- [ ] Ada read-modify-write?
- [ ] Ada check-then-act?
- [ ] Ada multi-field invariant?
- [ ] Ada compound operation pada concurrent collection?
- [ ] Apakah side effect di dalam CAS loop?

## 30.4 Executor

- [ ] Queue bounded atau unbounded?
- [ ] Thread name jelas?
- [ ] Rejection policy eksplisit?
- [ ] Shutdown lifecycle jelas?
- [ ] Blocking task masuk pool yang tepat?
- [ ] Ada nested `Future.get()` di pool sama?
- [ ] Common pool dipakai untuk blocking?

## 30.5 Virtual Threads

- [ ] Virtual thread tidak dipool?
- [ ] Downstream concurrency tetap dibatasi?
- [ ] ThreadLocal usage dievaluasi?
- [ ] Blocking library compatible?
- [ ] Ada timeout/cancellation?

## 30.6 Cancellation

- [ ] `InterruptedException` tidak ditelan?
- [ ] Timeout membatalkan task?
- [ ] Parent cancellation propagate ke child?
- [ ] Retry punya max attempt dan backoff?
- [ ] Side effect idempotent?

## 30.7 Observability

- [ ] Thread/task punya nama/log context?
- [ ] Metrics queue depth/active/rejected tersedia?
- [ ] Timeout/cancel/failure dihitung?
- [ ] Thread dump bisa dibaca?
- [ ] JFR event cukup?

---

## 31. Latihan Bertahap

## 31.1 Latihan 1 — Broken Counter

Buat `BrokenCounter`:

```java
final class BrokenCounter {
    private int value;

    void increment() {
        value++;
    }

    int value() {
        return value;
    }
}
```

Run 10 thread, masing-masing increment 100_000 kali.

Observasi hasil.

Lalu buat versi:

- `synchronized`,
- `AtomicInteger`,
- `LongAdder`.

Bandingkan correctness dan throughput.

## 31.2 Latihan 2 — Stop Flag

Buat worker loop dengan plain boolean.

Lalu ubah menjadi `volatile`.

Analisis:

- kenapa plain boolean salah?
- kenapa volatile cukup untuk stop flag?
- kenapa volatile tidak cukup untuk counter?

## 31.3 Latihan 3 — Safe Publication

Buat mutable object yang dipublish tanpa volatile.

Lalu refactor menjadi:

- immutable record,
- volatile reference,
- lock-based getter/setter.

Jelaskan happens-before edge masing-masing.

## 31.4 Latihan 4 — Bounded Queue Worker

Buat producer-consumer:

- producer submit command,
- 4 worker consume,
- queue capacity 100,
- ketika penuh producer block atau reject.

Tambahkan metrics:

- queue depth,
- processed count,
- failed count.

## 31.5 Latihan 5 — Thread Pool Starvation

Buat fixed pool size 1.

Submit task yang di dalamnya submit task lain ke pool yang sama dan `get()`.

Amati deadlock/starvation.

Refactor dengan:

- separate executor,
- virtual thread executor,
- structured concurrency conceptual design.

## 31.6 Latihan 6 — Virtual Thread Fan-Out

Buat 1 request yang call 100 downstream mock services.

Batasi concurrency dengan semaphore 10.

Tambahkan timeout 500ms per call.

Bandingkan:

- platform fixed pool,
- virtual thread per task.

## 31.7 Latihan 7 — Scoped Value Context

Buat `RequestContext`:

```java
record RequestContext(String requestId, String userId) {}
```

Gunakan `ScopedValue` untuk membuat context available ke service dalam call chain.

Bandingkan dengan `ThreadLocal`.

## 31.8 Latihan 8 — Concurrent State Machine

Buat state machine case:

```text
NEW -> ASSIGNED -> IN_REVIEW -> APPROVED -> CLOSED
```

Implementasi:

1. lock-based,
2. `AtomicReference` versioned state.

Pastikan invalid transition rejected.

Tambahkan audit event hanya setelah commit sukses.

---

## 32. Mini Project: Case Processing Concurrent Engine

## 32.1 Tujuan

Bangun engine concurrent untuk memproses command case management.

Command:

```java
sealed interface CaseCommand permits AssignOfficer, RequestInfo, ApproveCase, CloseCase {
    String caseId();
    String commandId();
}

record AssignOfficer(String caseId, String commandId, String officerId) implements CaseCommand {}
record RequestInfo(String caseId, String commandId, String reason) implements CaseCommand {}
record ApproveCase(String caseId, String commandId) implements CaseCommand {}
record CloseCase(String caseId, String commandId) implements CaseCommand {}
```

State:

```java
enum CaseStatus {
    NEW,
    ASSIGNED,
    INFO_REQUESTED,
    APPROVED,
    CLOSED
}

record CaseState(
    String caseId,
    long version,
    CaseStatus status,
    String officerId
) {}
```

## 32.2 Requirements

1. Command untuk case yang sama harus diproses serial.
2. Command untuk case berbeda boleh parallel.
3. Duplicate `commandId` harus idempotent.
4. Invalid transition harus ditolak sebagai domain rejection.
5. Audit event hanya dibuat setelah transition sukses.
6. Engine punya bounded queue.
7. Worker bisa shutdown gracefully.
8. Timeout dan cancellation harus jelas.
9. Metrics minimal:
   - submitted,
   - processed,
   - rejected,
   - failed,
   - queue depth.
10. Thread name harus jelas.

## 32.3 Architecture Option A — Lock Per Case

```text
ConcurrentHashMap<caseId, CaseAggregate>
CaseAggregate has lock
Workers process commands from queue
Each command locks only its aggregate
```

Pros:

- mudah,
- correctness jelas,
- parallel antar case.

Cons:

- lock map lifecycle,
- aggregate cleanup,
- command ordering per case perlu dipikirkan.

## 32.4 Architecture Option B — Sharded Single Writer

```text
N shards
caseId hash -> shard
each shard has single-thread executor/queue
```

Pros:

- no lock per aggregate,
- ordering per case natural,
- invariant mudah.

Cons:

- hot case can bottleneck shard,
- shard rebalance susah,
- per-shard queue/backpressure.

## 32.5 Architecture Option C — Actor-ish Mailbox Per Case

```text
caseId -> mailbox
single processor per mailbox
```

Pros:

- paling domain-natural,
- isolated state,
- ordering jelas.

Cons:

- mailbox explosion,
- lifecycle cleanup,
- scheduling complexity.

## 32.6 Recommended for Learning

Mulai dengan Option B.

Alasan:

- jelas secara mental model,
- menghindari banyak lock,
- cocok untuk state machine,
- mirip partitioning Kafka by key,
- mudah di-observe.

## 32.7 Shard Worker Sketch

```java
final class CaseShard implements AutoCloseable {
    private final BlockingQueue<CaseCommand> queue;
    private final Thread worker;
    private final Map<String, CaseState> states = new HashMap<>();
    private final Set<String> processedCommandIds = new HashSet<>();
    private volatile boolean running = true;

    CaseShard(int shardId, int capacity) {
        this.queue = new ArrayBlockingQueue<>(capacity);
        this.worker = Thread.ofPlatform()
            .name("case-shard-" + shardId)
            .unstarted(this::runLoop);
        this.worker.start();
    }

    boolean submit(CaseCommand command, Duration timeout) throws InterruptedException {
        return queue.offer(command, timeout.toMillis(), TimeUnit.MILLISECONDS);
    }

    private void runLoop() {
        while (running || !queue.isEmpty()) {
            try {
                CaseCommand command = queue.poll(100, TimeUnit.MILLISECONDS);
                if (command != null) {
                    process(command);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Throwable error) {
                // log and continue only if safe
                error.printStackTrace();
            }
        }
    }

    private void process(CaseCommand command) {
        if (!processedCommandIds.add(command.commandId())) {
            return;
        }

        CaseState current = states.getOrDefault(
            command.caseId(),
            new CaseState(command.caseId(), 0, CaseStatus.NEW, null)
        );

        CaseState next = transition(current, command);

        states.put(command.caseId(), next);

        // emit audit after state update
        emitAudit(current, next, command);
    }

    private CaseState transition(CaseState current, CaseCommand command) {
        return switch (command) {
            case AssignOfficer assign -> {
                if (current.status() != CaseStatus.NEW) {
                    throw new IllegalStateException("case must be NEW");
                }
                yield new CaseState(
                    current.caseId(),
                    current.version() + 1,
                    CaseStatus.ASSIGNED,
                    assign.officerId()
                );
            }
            case RequestInfo request -> {
                if (current.status() != CaseStatus.ASSIGNED) {
                    throw new IllegalStateException("case must be ASSIGNED");
                }
                yield new CaseState(
                    current.caseId(),
                    current.version() + 1,
                    CaseStatus.INFO_REQUESTED,
                    current.officerId()
                );
            }
            case ApproveCase approve -> {
                if (current.status() != CaseStatus.ASSIGNED
                    && current.status() != CaseStatus.INFO_REQUESTED) {
                    throw new IllegalStateException("case must be ASSIGNED or INFO_REQUESTED");
                }
                yield new CaseState(
                    current.caseId(),
                    current.version() + 1,
                    CaseStatus.APPROVED,
                    current.officerId()
                );
            }
            case CloseCase close -> {
                if (current.status() != CaseStatus.APPROVED) {
                    throw new IllegalStateException("case must be APPROVED");
                }
                yield new CaseState(
                    current.caseId(),
                    current.version() + 1,
                    CaseStatus.CLOSED,
                    current.officerId()
                );
            }
        };
    }

    private void emitAudit(CaseState previous, CaseState next, CaseCommand command) {
        System.out.printf(
            "case=%s command=%s %s -> %s version=%d%n",
            command.caseId(),
            command.commandId(),
            previous.status(),
            next.status(),
            next.version()
        );
    }

    @Override
    public void close() throws InterruptedException {
        running = false;
        worker.interrupt();
        worker.join();
    }
}
```

Catatan:

- Ini sketch pembelajaran, bukan production final.
- `processedCommandIds` perlu retention policy.
- Error handling harus domain-specific.
- Audit event idealnya durable/outbox jika production.
- Untuk Java 25 pattern switch mungkin perlu memperhatikan status preview fitur tertentu tergantung bentuk pattern yang dipakai.

## 32.8 Engine

```java
final class CaseEngine implements AutoCloseable {
    private final CaseShard[] shards;

    CaseEngine(int shardCount, int capacityPerShard) {
        this.shards = new CaseShard[shardCount];
        for (int i = 0; i < shardCount; i++) {
            shards[i] = new CaseShard(i, capacityPerShard);
        }
    }

    boolean submit(CaseCommand command, Duration timeout) throws InterruptedException {
        return shard(command.caseId()).submit(command, timeout);
    }

    private CaseShard shard(String caseId) {
        int index = Math.floorMod(caseId.hashCode(), shards.length);
        return shards[index];
    }

    @Override
    public void close() throws Exception {
        for (CaseShard shard : shards) {
            shard.close();
        }
    }
}
```

## 32.9 Apa yang Dipelajari

Mini project ini mengajarkan:

- thread confinement,
- bounded queue,
- single writer per shard,
- domain ordering,
- idempotency,
- state transition invariant,
- shutdown,
- interrupt handling,
- metrics,
- audit after commit.

Ini jauh lebih berguna daripada sekadar membuat `Thread.sleep()` demo.

---

## 33. Ringkasan Mental Model

Java concurrency harus selalu dipikirkan dari empat lapisan:

```text
1. State
   Apa yang shared?
   Siapa owner?
   Apa invariant?

2. Synchronization
   Apa happens-before edge?
   Apakah atomicity cukup?
   Apakah visibility cukup?

3. Lifecycle
   Siapa membuat task?
   Siapa menunggu?
   Siapa membatalkan?
   Siapa membersihkan resource?

4. Capacity
   Berapa banyak task boleh jalan?
   Apa yang terjadi saat overload?
   Apakah ada backpressure?
```

Jangan mulai dari primitive.

Jangan bertanya:

```text
Pakai synchronized atau volatile?
```

Mulailah dari:

```text
State apa yang harus konsisten?
Siapa boleh mengubahnya?
Apa batas concurrency?
Apa failure policy?
```

Setelah itu, pilihan primitive menjadi lebih jelas.

## 33.1 Golden Rules

1. Shared mutable state adalah sumber complexity.
2. Immutable data mengurangi kebutuhan synchronization.
3. Thread confinement lebih mudah daripada lock.
4. Lock melindungi invariant, bukan field.
5. `volatile` bukan lock.
6. `Atomic*` bukan pengganti transaction.
7. Concurrent collection tidak otomatis membuat business logic atomic.
8. Executor harus bounded dan observable.
9. Virtual threads tidak menghapus kebutuhan backpressure.
10. Timeout tanpa cancellation belum cukup.
11. `InterruptedException` jangan ditelan.
12. Structured concurrency memberi lifecycle yang lebih sehat.
13. Scoped values lebih aman untuk immutable contextual data daripada ThreadLocal di banyak use case modern.
14. Jika tidak bisa menjelaskan happens-before edge, code belum aman.
15. Jika tidak bisa menjelaskan overload behavior, system belum production-ready.

---

## 34. Referensi Resmi

1. Java Language Specification SE 25 — Chapter 17: Threads and Locks  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html

2. Java SE 25 API — `java.lang.Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

3. Java SE 25 API — `java.util.concurrent` package  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

4. Java SE 25 API — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

5. Java SE 25 API — `CompletableFuture`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/CompletableFuture.html

6. JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

7. JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

8. JEP 505 — Structured Concurrency, Fifth Preview  
   https://openjdk.org/jeps/505

9. JEP 506 — Scoped Values  
   https://openjdk.org/jeps/506

10. Java SE 25 API — `ScopedValue`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html

11. Java SE 25 API — `ThreadLocal`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ThreadLocal.html

12. Java SE 25 API — `java.util.concurrent.atomic`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html

13. Java SE 25 API — `java.util.concurrent.locks`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/package-summary.html

---

## Penutup

Bagian ini adalah fondasi untuk memahami sistem Java modern.

Setelah ini, saat melihat code concurrency, jangan hanya bertanya:

```text
Apakah ini compile?
Apakah ini pernah gagal?
```

Tanyakan:

```text
Apa invariant-nya?
Apa synchronization edge-nya?
Apa lifecycle task-nya?
Apa cancellation path-nya?
Apa overload behavior-nya?
Apa bukti correctness-nya?
```

Itulah perbedaan antara engineer yang hanya bisa memakai API concurrency dan engineer yang bisa mendesain sistem concurrent yang benar, observable, dan tahan production failure.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-008.md">⬅️ Learn Java Part 008 — Error Handling, Exceptions, dan Reliability Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-part-010.md">Learn Java — Part 010 ➡️</a>
</div>
