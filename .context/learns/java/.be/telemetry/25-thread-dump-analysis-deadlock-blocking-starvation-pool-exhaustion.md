# Part 25 — Thread Dump Analysis: Deadlock, Blocking, Starvation, Pool Exhaustion

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> Module: JVM Troubleshooting / Runtime Forensics  
> Target: Java 8 sampai Java 25  
> Fokus: membaca thread dump sebagai bukti runtime untuk mendiagnosis deadlock, blocking, starvation, pool exhaustion, lock contention, virtual thread behavior, dan latency incident.

---

## 0. Posisi Part Ini Dalam Seri

Pada bagian sebelumnya kita sudah membahas toolkit JVM: `jcmd`, `jstack`, `jmap`, `jstat`, `jinfo`, `jhsdb`, dan Native Memory Tracking. Part ini mengambil salah satu artefak paling penting dari toolkit tersebut: **thread dump**.

Thread dump sering terlihat sederhana: daftar thread, state, dan stack trace. Tetapi pada level senior/top-tier, thread dump bukan hanya “stack trace semua thread”. Thread dump adalah **snapshot struktur eksekusi JVM pada satu titik waktu**.

Dari thread dump, kita bisa menjawab pertanyaan seperti:

- Apakah aplikasi benar-benar sibuk, atau hanya menunggu sesuatu?
- Apakah CPU tinggi karena thread aktif menghitung, spin, atau loop?
- Apakah latency tinggi karena thread blocked, waiting, parked, atau pool habis?
- Apakah semua request worker sedang menunggu database connection?
- Apakah ada deadlock?
- Apakah lock tertentu menjadi bottleneck?
- Apakah scheduler/thread pool tidak punya worker tersisa?
- Apakah virtual thread membantu, atau malah banyak pinned/blocking operation?
- Apakah incident berasal dari application code, framework, database pool, HTTP client, messaging client, GC, atau OS?

Thread dump adalah **runtime evidence**, bukan sekadar output command.

---

## 1. Learning Objectives

Setelah menyelesaikan Part 25, kamu diharapkan mampu:

1. Mengambil thread dump dengan aman di Java 8–25.
2. Memahami struktur thread dump klasik dan JSON virtual-thread dump.
3. Membedakan `RUNNABLE`, `BLOCKED`, `WAITING`, `TIMED_WAITING`, dan interpretasi praktisnya.
4. Membaca stack trace secara top-down dan bottom-up.
5. Mendiagnosis deadlock, lock contention, starvation, thread pool exhaustion, connection pool exhaustion, scheduler stuck, dan async pipeline stall.
6. Membedakan CPU-bound, IO-bound, lock-bound, pool-bound, dan queue-bound symptoms.
7. Menggunakan multiple thread dumps sebagai time-series evidence.
8. Menghubungkan thread dump dengan logs, metrics, traces, JFR, dan async-profiler.
9. Memahami perbedaan analisis platform thread dan virtual thread.
10. Membuat incident report berbasis thread dump yang defensible.

---

## 2. Thread Dump Mental Model

Thread dump adalah snapshot seluruh thread yang diketahui JVM pada saat pengambilan dump.

Secara konseptual:

```text
JVM Process
 ├── Thread A: name, id, state, stack, locks held, locks waited
 ├── Thread B: name, id, state, stack, locks held, locks waited
 ├── Thread C: name, id, state, stack, locks held, locks waited
 └── ...
```

Thread dump bukan timeline penuh. Ia tidak menjelaskan apa yang terjadi 10 detik lalu atau apa yang akan terjadi 10 detik lagi. Karena itu, satu thread dump sering tidak cukup.

Mental model yang benar:

```text
Single thread dump  = photograph
Multiple dumps      = motion inference
JFR/profiler        = sampled history
Logs/traces         = business/runtime timeline
Metrics             = aggregate pressure over time
```

Thread dump menjawab:

> “Pada saat ini, thread-thread JVM sedang berada di mana dan menunggu apa?”

Thread dump tidak langsung menjawab:

> “Kenapa dari awal bisa sampai ke kondisi ini?”

Untuk menjawab “kenapa”, kita butuh korelasi dengan signal lain.

---

## 3. Kapan Thread Dump Berguna?

Thread dump sangat berguna ketika gejala berkaitan dengan **execution availability**.

Contoh gejala:

| Gejala | Thread dump bisa membantu? | Kenapa |
|---|---:|---|
| Request latency naik | Ya | Melihat worker stuck/waiting/blocking |
| CPU tinggi | Ya | Melihat thread RUNNABLE dominan, loop, crypto, JSON, regex, logging |
| CPU rendah tetapi latency tinggi | Sangat ya | Biasanya wait/block/pool/dependency |
| Throughput turun | Ya | Worker exhaustion, DB pool wait, queue consumer stall |
| Aplikasi hang | Sangat ya | Deadlock, global lock, thread pool saturated |
| OOM Java heap | Tidak utama | Heap dump lebih tepat, tapi thread dump bisa menunjukkan creator/leak thread |
| Native thread OOM | Ya | Melihat jumlah thread dan pattern thread creation |
| DB pool exhausted | Sangat ya | Banyak thread waiting di pool acquire |
| Messaging backlog | Ya | Consumer thread stuck atau dead |
| Scheduler tidak jalan | Ya | Scheduler thread blocked/waiting |
| Virtual thread scalability issue | Ya, dengan JSON dump/JFR | Melihat banyak virtual thread waiting/pinned |

---

## 4. Cara Mengambil Thread Dump

### 4.1 Dengan `jcmd` — Pilihan Utama Modern

```bash
jcmd <pid> Thread.print > thread-dump-$(date +%Y%m%d-%H%M%S).txt
```

Untuk melihat diagnostic command yang tersedia:

```bash
jcmd <pid> help
jcmd <pid> help Thread.print
```

Di JDK modern, Oracle menyarankan penggunaan `jcmd` sebagai utility diagnostik utama dibanding utility lama seperti `jstack`, `jmap`, dan `jinfo` untuk banyak kebutuhan troubleshooting.

### 4.2 Dengan `jstack`

```bash
jstack <pid> > thread-dump.txt
```

Untuk force dump pada kondisi tertentu:

```bash
jstack -l <pid> > thread-dump-locks.txt
```

Catatan:

- `jstack` masih sering ada di environment lama.
- Untuk Java 8, `jstack` sangat umum digunakan.
- Untuk Java 11+, biasakan gunakan `jcmd` dulu.

### 4.3 Dengan Signal Linux

```bash
kill -3 <pid>
```

Output biasanya masuk ke stdout/stderr process.

Di container/Kubernetes, output bisa muncul di:

```bash
kubectl logs <pod>
```

Risiko:

- Tidak selalu mudah memisahkan output thread dump dari log aplikasi.
- Bisa membuat log besar.
- Tidak ideal untuk automation yang rapi.

### 4.4 Di Kubernetes

```bash
kubectl exec -it <pod> -- jcmd 1 Thread.print > thread-dump.txt
```

Jika PID bukan 1:

```bash
kubectl exec -it <pod> -- ps -ef
kubectl exec -it <pod> -- jcmd <pid> Thread.print
```

Jika image runtime tidak punya JDK tools, opsi:

1. Gunakan image yang menyertakan JDK tools untuk environment non-prod.
2. Gunakan ephemeral container untuk debugging.
3. Aktifkan diagnostic endpoint internal yang aman untuk dump terbatas.
4. Siapkan runbook untuk attach tool saat incident.

### 4.5 Untuk Virtual Threads

Untuk observasi virtual threads, JDK modern menyediakan format dump yang lebih cocok untuk jumlah thread besar.

Contoh:

```bash
jcmd <pid> Thread.dump_to_file -format=json /tmp/thread-dump.json
```

Ini penting karena aplikasi berbasis virtual threads bisa memiliki ribuan sampai jutaan virtual thread. Format klasik tidak selalu nyaman untuk dibaca manusia maupun diproses tool.

---

## 5. Jangan Ambil Satu Dump Saja

Satu dump bisa menipu.

Contoh:

- Thread sedang `WAITING` karena memang idle.
- Thread sedang `RUNNABLE` saat dump, tetapi hanya sesaat.
- Thread sedang menunggu DB, tetapi belum tentu DB root cause; bisa karena pool exhausted akibat leak.
- Thread sedang memegang lock, tetapi belum tentu lock bottleneck jika hanya satu snapshot.

Ambil minimal 3 dump:

```bash
jcmd <pid> Thread.print > td-1.txt
sleep 10
jcmd <pid> Thread.print > td-2.txt
sleep 10
jcmd <pid> Thread.print > td-3.txt
```

Untuk incident berat:

```bash
for i in 1 2 3 4 5 6; do
  ts=$(date +%Y%m%d-%H%M%S)
  jcmd <pid> Thread.print > thread-dump-$ts.txt
  sleep 10
done
```

Interpretasi:

| Pattern | Makna Awal |
|---|---|
| Thread sama terus di stack sama | Stuck/blocking/long-running |
| Banyak thread masuk stack sama | Bottleneck/shared dependency |
| Thread berubah stack terus | Progress terjadi |
| Semua worker waiting di pool acquire | Resource pool exhausted |
| Semua worker blocked lock sama | Lock contention/global monitor |
| CPU tinggi dan stack sama | Hot loop/hot method |
| CPU rendah dan banyak WAITING/TIMED_WAITING | Dependency wait/pool wait/idle |

---

## 6. Anatomy of a Thread Dump

Contoh sederhana:

```text
"http-nio-8080-exec-42" #142 daemon prio=5 os_prio=0 tid=0x00007f... nid=0x4a03 waiting on condition [0x00007f...]
   java.lang.Thread.State: TIMED_WAITING (parking)
        at jdk.internal.misc.Unsafe.park(Native Method)
        - parking to wait for  <0x0000000712ab1234> (a java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject)
        at java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:252)
        at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.awaitNanos(AbstractQueuedSynchronizer.java:1679)
        at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:...)
        at com.zaxxer.hikari.HikariDataSource.getConnection(HikariDataSource.java:...)
        at org.hibernate.engine.jdbc.connections.internal.DatasourceConnectionProviderImpl.getConnection(...)
        at com.example.caseapp.CaseRepository.findById(CaseRepository.java:87)
```

Bagian penting:

| Komponen | Makna |
|---|---|
| Thread name | Identitas operasional thread |
| Java thread id | ID internal JVM |
| daemon/non-daemon | Apakah thread mencegah JVM exit |
| priority | Jarang jadi root cause di aplikasi modern |
| `tid` | JVM native thread pointer |
| `nid` | Native OS thread id, berguna korelasi dengan `top -H` |
| state | State Java thread |
| stack | Lokasi eksekusi/menunggu |
| lock info | Lock yang dipegang atau ditunggu |

---

## 7. Thread States: Definisi vs Interpretasi Produksi

Java `Thread.State` memiliki state:

- `NEW`
- `RUNNABLE`
- `BLOCKED`
- `WAITING`
- `TIMED_WAITING`
- `TERMINATED`

Yang penting: nama state tidak selalu sama dengan interpretasi OS.

### 7.1 `RUNNABLE`

Definisi Java: thread sedang executing di JVM.

Namun secara praktis, `RUNNABLE` bisa berarti:

1. Benar-benar memakai CPU.
2. Sedang di native call/blocking IO tetapi JVM menganggap runnable.
3. Menunggu OS/network/disk dalam native operation.
4. Sedang eligible untuk run tetapi belum dijadwalkan CPU.

Contoh CPU-bound:

```text
java.lang.Thread.State: RUNNABLE
    at com.example.pricing.RuleEngine.evaluate(RuleEngine.java:231)
    at com.example.pricing.RuleEngine.evaluateAll(RuleEngine.java:144)
```

Contoh IO-bound tetapi terlihat `RUNNABLE`:

```text
java.lang.Thread.State: RUNNABLE
    at sun.nio.ch.SocketDispatcher.read0(Native Method)
    at sun.nio.ch.SocketDispatcher.read(SocketDispatcher.java:...)
    at sun.nio.ch.NioSocketImpl.tryRead(...)
```

Kesalahan umum:

> “Banyak RUNNABLE berarti CPU tinggi.”

Belum tentu. Validasi dengan:

```bash
top -H -p <pid>
ps -L -p <pid> -o pid,tid,pcpu,stat,comm
```

Lalu cocokkan native thread id (`nid`) dari hex ke decimal.

### 7.2 `BLOCKED`

`BLOCKED` berarti thread sedang menunggu monitor lock Java (`synchronized`).

Contoh:

```text
java.lang.Thread.State: BLOCKED (on object monitor)
    at com.example.Cache.get(Cache.java:42)
    - waiting to lock <0x000000071234abcd> (a com.example.Cache)
```

Makna praktis:

- Thread ingin masuk blok/method `synchronized`.
- Ada thread lain yang sedang memegang monitor tersebut.
- Jika banyak thread `BLOCKED` pada lock sama, ini lock contention kuat.

### 7.3 `WAITING`

`WAITING` berarti thread menunggu tanpa timeout.

Contoh:

```text
java.lang.Thread.State: WAITING (parking)
    at jdk.internal.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:...)
    at java.util.concurrent.locks.AbstractQueuedSynchronizer.acquire(...)
```

Bisa normal, bisa problem.

Normal:

- Idle worker.
- Scheduler menunggu task.
- Consumer menunggu message.

Problem:

- Menunggu future yang tidak akan complete.
- Menunggu latch yang tidak pernah countdown.
- Deadlock logical yang tidak terdeteksi JVM.

### 7.4 `TIMED_WAITING`

`TIMED_WAITING` berarti thread menunggu dengan timeout.

Contoh:

```text
java.lang.Thread.State: TIMED_WAITING (sleeping)
    at java.lang.Thread.sleep(Native Method)
```

Atau:

```text
java.lang.Thread.State: TIMED_WAITING (parking)
    at jdk.internal.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.parkNanos(...)
    at com.zaxxer.hikari.pool.HikariPool.getConnection(...)
```

Interpretasi:

- Bisa normal jika idle/polling.
- Bisa bottleneck jika banyak request thread timed waiting pada pool/dependency.

### 7.5 `TERMINATED`

Biasanya tidak muncul sebagai problem utama.

Jika banyak thread created/terminated cepat, thread dump saja kurang cukup. Gunakan:

- JFR thread events,
- OS process/thread count,
- metrics `jvm.threads.live`, `jvm.threads.started`,
- profiler/JFR.

---

## 8. Reading Strategy: Cara Membaca Thread Dump

Jangan membaca thread dump dari atas sampai bawah tanpa metode. Itu melelahkan dan mudah bias.

Gunakan langkah berikut.

### Step 1 — Identifikasi konteks incident

Pertanyaan awal:

1. Gejalanya apa?
2. CPU tinggi atau rendah?
3. Latency naik di endpoint mana?
4. Error rate naik di dependency mana?
5. Throughput turun total atau sebagian?
6. Apakah hanya satu instance atau semua instance?
7. Apakah ada deploy/config change?
8. Apakah thread dump diambil saat gejala sedang terjadi?

Tanpa konteks, thread dump mudah disalahartikan.

### Step 2 — Hitung distribusi thread state

Kelompokkan:

```text
RUNNABLE       : ?
BLOCKED        : ?
WAITING        : ?
TIMED_WAITING  : ?
NEW/TERMINATED : ?
```

Distribusi state bukan diagnosis final, tapi memberi arah.

### Step 3 — Kelompokkan berdasarkan thread name

Contoh kelompok:

- `http-nio-*`
- `http-bio-*`
- `qtp*` Jetty
- `XNIO-*` Undertow
- `ForkJoinPool.commonPool-worker-*`
- `pool-*`
- `scheduling-*`
- `HikariPool-*`
- `RabbitMQ-*`
- `kafka-*`
- `grpc-*`
- `OkHttp Dispatcher`
- `lettuce-*`
- `RMI TCP Connection-*`
- `Attach Listener`
- `Reference Handler`
- `Finalizer`
- `Signal Dispatcher`
- `GC Thread`, `G1 Conc`, `ZGC`, etc.

Thread name memberi tahu subsystem mana yang terdampak.

### Step 4 — Cari stack yang berulang

Jika 80 thread memiliki stack yang sama, itu lebih penting daripada satu thread unik.

Contoh repeated stack:

```text
com.zaxxer.hikari.pool.HikariPool.getConnection
org.hibernate.engine.jdbc.connections...
com.example.repository...
com.example.service...
```

Makna:

- Banyak request menunggu connection.
- Root cause belum tentu pool size kecil; bisa query lambat, transaction leak, DB lock, atau dependency downstream.

### Step 5 — Cari lock ownership

Untuk `BLOCKED`, cari:

```text
- waiting to lock <0x...>
```

Lalu cari thread yang punya:

```text
- locked <0x...>
```

Ini membantu menemukan pemegang lock.

### Step 6 — Bandingkan multiple dumps

Pertanyaan:

- Apakah thread yang sama masih di stack yang sama?
- Apakah lock owner berubah?
- Apakah jumlah waiter bertambah?
- Apakah worker pool makin penuh?
- Apakah stack repeated sama terus?

Jika sama terus, kemungkinan stuck/blocking.

Jika berubah, mungkin hanya lambat tetapi progress.

### Step 7 — Korelasikan dengan metrics

Minimal cek:

- CPU usage
- request latency
- request active/in-flight
- error rate
- DB pool active/idle/pending
- queue lag
- GC pause
- container CPU throttling
- thread count

Thread dump tanpa metrics sering kehilangan skala dampak.

---

## 9. Deadlock

### 9.1 Deadlock Definisi

Deadlock terjadi ketika dua atau lebih thread saling menunggu resource/lock yang dipegang oleh thread lain dalam siklus.

Contoh:

```text
Thread A holds Lock 1, waits Lock 2
Thread B holds Lock 2, waits Lock 1
```

JVM dapat mendeteksi deadlock monitor tertentu dan menampilkan bagian seperti:

```text
Found one Java-level deadlock:
=============================
"Thread-A":
  waiting to lock monitor 0x..., which is held by "Thread-B"
"Thread-B":
  waiting to lock monitor 0x..., which is held by "Thread-A"
```

### 9.2 Deadlock Contoh Kode

```java
public final class DeadlockDemo {
    private static final Object LOCK_A = new Object();
    private static final Object LOCK_B = new Object();

    public static void main(String[] args) {
        Thread t1 = new Thread(() -> {
            synchronized (LOCK_A) {
                sleep(100);
                synchronized (LOCK_B) {
                    System.out.println("t1 acquired both");
                }
            }
        }, "worker-a");

        Thread t2 = new Thread(() -> {
            synchronized (LOCK_B) {
                sleep(100);
                synchronized (LOCK_A) {
                    System.out.println("t2 acquired both");
                }
            }
        }, "worker-b");

        t1.start();
        t2.start();
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

Thread dump akan menunjukkan kedua thread `BLOCKED` pada lock yang saling terkait.

### 9.3 Root Cause Pattern

Deadlock sering muncul dari:

1. Lock ordering tidak konsisten.
2. Nested synchronized block.
3. Callback dipanggil saat lock masih dipegang.
4. External call saat lock masih dipegang.
5. Database lock + application lock bercampur.
6. Synchronized method pada service singleton.
7. In-memory cache lock terlalu besar.
8. Listener/event handler reentrant.

### 9.4 Fix Strategy

Prinsip fix:

1. Tentukan global lock ordering.
2. Hindari nested lock jika tidak perlu.
3. Jangan panggil external dependency saat memegang lock.
4. Perkecil critical section.
5. Pakai immutable snapshot.
6. Ganti global lock dengan finer-grained lock jika benar-benar perlu.
7. Pakai timeout/tryLock untuk menghindari wait tanpa batas.
8. Gunakan actor/single-writer model untuk state tertentu jika cocok.

Contoh lock ordering:

```java
public void transfer(Account from, Account to, BigDecimal amount) {
    Account first = from.id().compareTo(to.id()) < 0 ? from : to;
    Account second = first == from ? to : from;

    synchronized (first) {
        synchronized (second) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

---

## 10. BLOCKED: Lock Contention

Deadlock adalah kasus ekstrem. Yang lebih umum adalah **lock contention**.

### 10.1 Pattern di Thread Dump

```text
"http-nio-8080-exec-31" BLOCKED
    at com.example.config.DynamicConfig.get(DynamicConfig.java:44)
    - waiting to lock <0x000000071234abcd> (a com.example.config.DynamicConfig)

"http-nio-8080-exec-32" BLOCKED
    at com.example.config.DynamicConfig.get(DynamicConfig.java:44)
    - waiting to lock <0x000000071234abcd> (a com.example.config.DynamicConfig)

"http-nio-8080-exec-12" RUNNABLE
    at com.example.config.DynamicConfig.reload(DynamicConfig.java:80)
    - locked <0x000000071234abcd> (a com.example.config.DynamicConfig)
```

Makna:

- Banyak request worker menunggu monitor yang sama.
- Satu thread memegang lock saat melakukan pekerjaan lama.

### 10.2 Penyebab Umum

1. `synchronized` pada method service singleton.
2. Cache global dengan lock besar.
3. Lazy initialization yang berat.
4. Config reload blocking request path.
5. Logging appender/layout lock contention.
6. Serializer/formatter shared mutable object.
7. `SimpleDateFormat` lama yang diproteksi `synchronized`.
8. Single global map guarded by monitor.
9. Listener registry lock.

### 10.3 Diagnosis

Cek:

- Berapa banyak thread menunggu lock yang sama?
- Siapa lock owner?
- Owner sedang melakukan apa?
- Apakah owner berubah antar dump?
- Apakah critical section terlalu besar?
- Apakah lock di hot path?

### 10.4 Fix Strategy

Solusi tergantung kasus:

| Problem | Fix |
|---|---|
| Read-heavy shared config | Immutable snapshot + atomic reference |
| Global cache lock | ConcurrentHashMap / segmented lock |
| Lazy init berat | Eager init saat startup atau async warmup |
| Synchronized service method | Remove global lock, protect only mutable state |
| External call inside lock | Move external call outside critical section |
| Date formatter lama | `java.time.format.DateTimeFormatter` immutable |
| Counter synchronized | LongAdder/AtomicLong |

Contoh immutable snapshot:

```java
public final class RuntimeConfigStore {
    private final AtomicReference<RuntimeConfig> current = new AtomicReference<>(RuntimeConfig.empty());

    public RuntimeConfig get() {
        return current.get();
    }

    public void reload(RuntimeConfig newConfig) {
        current.set(newConfig);
    }
}
```

---

## 11. WAITING / TIMED_WAITING: Tidak Selalu Buruk

Banyak thread `WAITING` bukan otomatis incident.

Contoh normal:

```text
"pool-1-thread-1" WAITING (parking)
    at jdk.internal.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.park(...)
    at java.util.concurrent.ThreadPoolExecutor.getTask(...)
```

Ini bisa berarti worker idle menunggu task.

Yang penting bukan state saja, tetapi **where waiting**.

### 11.1 Waiting Normal

| Stack | Kemungkinan |
|---|---|
| `ThreadPoolExecutor.getTask` | Worker idle |
| `ScheduledThreadPoolExecutor$DelayedWorkQueue.take` | Scheduler menunggu jadwal |
| `LinkedBlockingQueue.take` | Consumer idle |
| `ReferenceQueue.remove` | JVM housekeeping |
| `Unsafe.park` pada ForkJoin idle | Normal jika tidak ada task |

### 11.2 Waiting Problem

| Stack | Kemungkinan Problem |
|---|---|
| `FutureTask.get` | Menunggu task yang stuck |
| `CompletableFuture.join` | Async dependency tidak complete |
| `CountDownLatch.await` | Latch tidak pernah countdown |
| `CyclicBarrier.await` | Peserta tidak lengkap |
| `HikariPool.getConnection` | Connection pool exhausted |
| HTTP client read/socket | Dependency lambat |
| `BlockingQueue.put` | Queue full/backpressure |
| `BlockingQueue.take` pada consumer utama saat backlog ada | Consumer wiring problem |

---

## 12. Thread Pool Exhaustion

Thread pool exhaustion terjadi ketika semua worker sibuk/stuck sehingga task baru antre atau timeout.

### 12.1 Gejala

- Latency naik.
- Throughput turun.
- Request timeout.
- Queue task naik.
- Active threads = max threads.
- CPU bisa tinggi atau rendah.

CPU rendah + pool penuh sering berarti worker menunggu dependency.

### 12.2 Tomcat Worker Exhaustion

Contoh stack:

```text
"http-nio-8080-exec-101" TIMED_WAITING (parking)
    at jdk.internal.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.parkNanos(...)
    at com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:...)
    at com.zaxxer.hikari.HikariDataSource.getConnection(...)
    at org.hibernate...
    at com.example.caseapp.CaseService.loadCase(...)
```

Jika hampir semua `http-nio-*` thread seperti ini:

```text
HTTP worker pool exhausted because workers are waiting for DB connections.
```

Namun root cause bisa:

1. DB lambat.
2. Query lambat.
3. Connection leak.
4. Transaction terlalu panjang.
5. Pool size terlalu kecil relatif concurrency.
6. Max HTTP threads terlalu besar dibanding DB pool.
7. External call dilakukan di dalam transaction.
8. Lock DB membuat connection tertahan.

### 12.3 Pool Sizing Trap

Misal:

```text
Tomcat max threads = 200
Hikari max pool    = 20
```

Jika 200 request masuk dan banyak yang butuh DB, 180 bisa menunggu connection.

Itu bukan selalu salah. Tapi jika timeout user 30s dan DB pool acquisition timeout 30s, sistem bisa menumpuk.

Rule of thumb yang lebih penting daripada angka:

```text
Concurrency admission harus selaras dengan downstream capacity.
```

Jika downstream DB hanya mampu 20 concurrent query sehat, membiarkan 200 request menunggu di worker thread sering memperburuk latency.

### 12.4 Fix Strategy

| Root Cause | Fix |
|---|---|
| Query lambat | Index/query tuning |
| Transaction panjang | Perkecil transaction scope |
| Connection leak | Leak detection + finally/try-with-resources |
| Pool terlalu kecil | Sizing berdasarkan DB capacity, bukan feeling |
| HTTP threads terlalu besar | Admission control / bulkhead |
| External call dalam transaction | Pindahkan keluar transaction |
| Lock DB | Diagnose DB lock/wait |
| No timeout | Set bounded timeout |

---

## 13. Connection Pool Exhaustion

Connection pool exhaustion adalah salah satu kasus thread dump paling umum di Java backend.

### 13.1 HikariCP Waiting Pattern

```text
java.lang.Thread.State: TIMED_WAITING (parking)
    at jdk.internal.misc.Unsafe.park(Native Method)
    at java.util.concurrent.locks.LockSupport.parkNanos(...)
    at java.util.concurrent.SynchronousQueue.poll(...)
    at com.zaxxer.hikari.util.ConcurrentBag.borrow(...)
    at com.zaxxer.hikari.pool.HikariPool.getConnection(...)
    at com.zaxxer.hikari.HikariDataSource.getConnection(...)
```

Interpretasi:

- Thread menunggu connection tersedia.
- Ini bukan bukti final bahwa pool size salah.
- Ini bukti bahwa demand pada saat itu melebihi availability connection.

### 13.2 Evidence yang Harus Dikumpulkan

Metrics:

```text
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.timeout
hikaricp.connections.max
```

Logs:

- connection timeout logs,
- slow query logs,
- transaction logs,
- error logs.

DB evidence:

- active sessions,
- wait events,
- blocking sessions,
- slow SQL,
- locks,
- CPU/IO.

Thread dump:

- siapa yang menunggu connection,
- stack service/repository mana,
- apakah semua endpoint sama atau endpoint tertentu.

### 13.3 Common Failure Chain

```text
One query becomes slow
 -> connections held longer
 -> pool active reaches max
 -> request threads wait for connection
 -> HTTP worker pool fills
 -> latency spikes
 -> retry from clients increases load
 -> more pool pressure
 -> error rate rises
```

### 13.4 Fix Hierarchy

Urutan investigasi:

1. Apakah ada leak?
2. Apakah ada query/transaction long-running?
3. Apakah DB sedang degraded?
4. Apakah concurrency terlalu tinggi?
5. Apakah timeout terlalu longgar?
6. Apakah retry memperparah?
7. Apakah pool size perlu diubah?

Jangan langsung menaikkan pool size tanpa tahu DB capacity.

---

## 14. ForkJoinPool and CompletableFuture Starvation

`CompletableFuture` default memakai `ForkJoinPool.commonPool()` untuk async task tertentu.

### 14.1 Starvation Pattern

```text
"ForkJoinPool.commonPool-worker-3" WAITING
    at java.util.concurrent.CompletableFuture.join(...)
    at com.example.BatchService.lambda$process$3(BatchService.java:88)
```

Atau banyak worker:

```text
ForkJoinPool.commonPool-worker-* waiting/joining
```

Masalah umum:

1. Blocking call dalam common pool.
2. Nested `CompletableFuture` yang saling menunggu.
3. Menggunakan common pool untuk IO-bound workloads.
4. Semua worker blocked menunggu task lain yang juga butuh worker sama.

### 14.2 Anti-Pattern

```java
List<CompletableFuture<Result>> futures = ids.stream()
    .map(id -> CompletableFuture.supplyAsync(() -> blockingHttpCall(id)))
    .toList();

return futures.stream()
    .map(CompletableFuture::join)
    .toList();
```

Masalah:

- Executor default tidak eksplisit.
- Blocking HTTP call memakai common pool.
- Sulit mengatur concurrency, timeout, cancellation, observability.

### 14.3 Better Pattern

```java
ExecutorService ioExecutor = Executors.newFixedThreadPool(32, r -> {
    Thread t = new Thread(r);
    t.setName("external-api-io-" + t.threadId());
    return t;
});

List<CompletableFuture<Result>> futures = ids.stream()
    .map(id -> CompletableFuture.supplyAsync(() -> blockingHttpCall(id), ioExecutor)
        .orTimeout(2, TimeUnit.SECONDS))
    .toList();
```

Untuk Java 21+ dengan virtual threads:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<Result>> futures = new ArrayList<>();
    for (String id : ids) {
        futures.add(executor.submit(() -> blockingHttpCall(id)));
    }
    for (Future<Result> future : futures) {
        results.add(future.get(2, TimeUnit.SECONDS));
    }
}
```

Tetap perlu:

- timeout,
- bounded external concurrency,
- rate limit,
- circuit breaker/bulkhead,
- trace/log correlation.

Virtual thread tidak menghilangkan downstream capacity limit.

---

## 15. Scheduler Thread Stuck

Scheduler sering hanya punya sedikit thread.

Jika scheduler thread stuck, job lain bisa tidak berjalan.

### 15.1 Pattern

```text
"scheduling-1" RUNNABLE
    at sun.nio.ch.SocketDispatcher.read0(Native Method)
    at ...
    at com.example.integration.ExternalClient.fetch(...)
    at com.example.scheduler.DailySyncJob.run(...)
```

Jika scheduler pool size 1, semua job lain tertunda.

### 15.2 Root Causes

1. Scheduler menjalankan job long-running secara langsung.
2. Tidak ada timeout pada external call.
3. Job overlap dan lock internal.
4. Transaction besar dalam scheduler.
5. Scheduler dipakai untuk orchestration dan execution sekaligus.

### 15.3 Better Design

```text
Scheduler thread
 -> trigger job execution record
 -> submit work to bounded executor/queue
 -> job worker executes with timeout, correlation id, job id
```

Logging fields:

```text
job.name
job.execution.id
job.trigger.time
job.scheduled.time
job.start.time
job.duration.ms
job.outcome
```

Thread naming:

```text
scheduler-trigger-*
batch-worker-*
external-sync-worker-*
```

Thread dump menjadi jauh lebih mudah dibaca.

---

## 16. Messaging Consumer Stall

Thread dump bisa menjelaskan kenapa queue backlog naik.

### 16.1 Consumer Thread Waiting on DB

```text
"rabbit-consumer-case-event-3" TIMED_WAITING
    at com.zaxxer.hikari.pool.HikariPool.getConnection(...)
    at com.example.caseevent.CaseEventConsumer.handle(...)
```

Interpretasi:

```text
Queue backlog mungkin bukan RabbitMQ problem.
Consumer stuck karena DB pool/dependency.
```

### 16.2 Consumer Thread Blocked on Lock

```text
"kafka-consumer-1" BLOCKED
    at com.example.projection.ProjectionUpdater.apply(...)
    - waiting to lock <0x...>
```

Interpretasi:

- Projection update serialized by global lock.
- Throughput consumer terbatas.

### 16.3 Consumer Idle While Backlog Exists

Jika metrics menunjukkan backlog tinggi, tetapi consumer thread `WAITING` pada `take/poll` idle, kemungkinan:

1. Consumer tidak subscribe queue/topic yang benar.
2. Consumer paused.
3. Partition assignment issue.
4. Prefetch/config issue.
5. Connection/channel problem.
6. Message tidak visible karena delay/dead-letter/routing.

Thread dump harus dikorelasikan dengan broker metrics/logs.

---

## 17. HTTP Client / External Dependency Blocking

### 17.1 Socket Read Pattern

```text
"http-nio-8080-exec-78" RUNNABLE
    at sun.nio.ch.SocketDispatcher.read0(Native Method)
    at sun.nio.ch.SocketDispatcher.read(...)
    at sun.nio.ch.NioSocketImpl.tryRead(...)
    at java.net.SocketInputStream.read(...)
    at okhttp3.internal.http1.Http1ExchangeCodec.readResponseHeaders(...)
```

Makna:

- Thread sedang menunggu response/read dari external dependency.
- State bisa terlihat `RUNNABLE`, tetapi secara praktis ini IO wait.

### 17.2 Apache HttpClient Pool Wait

```text
java.lang.Thread.State: WAITING
    at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(...)
    at org.apache.http.pool.AbstractConnPool.getPoolEntryBlocking(...)
```

Makna:

- Menunggu HTTP connection dari pool.
- Bisa karena pool kecil, downstream lambat, connection leak, no timeout.

### 17.3 Fix Checklist

1. Connect timeout ada?
2. Read/response timeout ada?
3. Connection request/acquire timeout ada?
4. Total deadline ada?
5. Pool max per route benar?
6. Retry bounded?
7. Circuit breaker ada?
8. Bulkhead per dependency ada?
9. Log dan trace external call punya dependency name dan duration?

---

## 18. Logging-Induced Blocking

Logging sendiri bisa menjadi root cause.

### 18.1 Synchronous File/Console Blocking

Pattern:

```text
"http-nio-8080-exec-44" BLOCKED
    at ch.qos.logback.core.OutputStreamAppender.subAppend(...)
    at ch.qos.logback.core.OutputStreamAppender.append(...)
    at ch.qos.logback.core.UnsynchronizedAppenderBase.doAppend(...)
    at ch.qos.logback.classic.Logger.callAppenders(...)
```

Atau Log4j2:

```text
at org.apache.logging.log4j.core.appender.OutputStreamManager.writeToDestination(...)
at org.apache.logging.log4j.core.appender.AbstractOutputStreamAppender.append(...)
```

Kemungkinan:

- stdout blocked,
- disk slow/full,
- network appender slow,
- log storm,
- appender lock contention,
- caller data/JSON serialization heavy.

### 18.2 Async Queue Saturation

Thread dump bisa menunjukkan application thread blocked saat async queue penuh.

Pertanyaan:

- Apakah async appender configured to block?
- Apakah logs dropped?
- Apakah logging rate naik karena error storm?
- Apakah log backend lambat?

Solusi bukan hanya “naikkan queue”. Jika log storm berasal dari repeated error, perbaiki level, rate-limit, sampling, atau deduplication.

---

## 19. Native Thread Exhaustion

Error:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Thread dump sebelum failure bisa menunjukkan banyak thread.

Penyebab:

1. Unbounded thread creation.
2. Executor dibuat per request.
3. Timer/scheduler dibuat per tenant/request.
4. HTTP client membuat dispatcher/thread pool per call.
5. Messaging consumers terlalu banyak.
6. Native stack size terlalu besar.
7. OS/container thread/process limit.

Anti-pattern:

```java
public void handle(Request request) {
    ExecutorService executor = Executors.newFixedThreadPool(10);
    executor.submit(() -> doWork(request));
}
```

Better:

```java
public final class WorkerService {
    private final ExecutorService executor;

    public WorkerService(ExecutorService executor) {
        this.executor = executor;
    }

    public CompletableFuture<Result> submit(Request request) {
        return CompletableFuture.supplyAsync(() -> doWork(request), executor);
    }
}
```

Untuk Java 21+ virtual threads, native thread exhaustion akibat per-task platform thread bisa berkurang, tetapi carrier threads, blocking native operations, memory, and downstream capacity tetap harus dikelola.

---

## 20. Virtual Threads: Cara Membaca Berbeda

Virtual threads mengubah skala concurrency.

Platform thread dump klasik mungkin tidak cukup nyaman untuk ribuan/million virtual threads. Gunakan JSON dump dan JFR events.

### 20.1 Apa yang Berubah?

Dengan virtual threads:

- Banyak blocking Java IO dapat dilakukan tanpa mengikat platform thread selama virtual thread unmounted.
- Stack per virtual thread lebih ringan daripada platform thread.
- Thread-per-request style menjadi lebih feasible.
- Thread dump perlu tooling/format yang bisa menangani jumlah sangat besar.

### 20.2 Apa yang Tidak Berubah?

Virtual threads tidak menghilangkan:

- DB connection limit,
- external API rate limit,
- lock contention,
- CPU bottleneck,
- memory pressure,
- transaction contention,
- queue backlog,
- bad retry storm,
- poor timeout design.

### 20.3 Virtual Thread Pinning

Pinning secara sederhana berarti virtual thread tidak bisa unmount dari carrier saat blocking tertentu, sehingga carrier platform thread ikut tertahan.

Penyebab historis umum:

- blocking di dalam `synchronized`,
- native/foreign call tertentu.

JDK terus memperbaiki observability dan behavior virtual threads. Untuk produksi, gunakan:

- JFR virtual thread events,
- JSON thread dump,
- metrics carrier/pool jika tersedia,
- async-profiler/JFR untuk CPU dan blocking profile.

### 20.4 Thread Dump Strategy for Virtual Threads

Gunakan:

```bash
jcmd <pid> Thread.dump_to_file -format=json /tmp/vthread-dump.json
```

Analisis:

- Berapa banyak virtual thread runnable/waiting?
- Stack paling dominan apa?
- Apakah banyak virtual thread menunggu DB pool?
- Apakah ada blocking di synchronized region?
- Apakah carrier threads penuh?
- Apakah latency disebabkan downstream capacity, bukan thread capacity?

---

## 21. Thread Name as Observability Design

Thread dump bagus jika thread name bagus.

Buruk:

```text
pool-1-thread-1
pool-2-thread-1
pool-3-thread-1
```

Baik:

```text
http-nio-8080-exec-42
case-event-consumer-3
email-dispatch-worker-7
onemap-client-io-12
batch-archival-worker-5
report-generation-worker-2
```

Thread factory:

```java
public final class NamedThreadFactory implements ThreadFactory {
    private final String prefix;
    private final AtomicInteger sequence = new AtomicInteger();

    public NamedThreadFactory(String prefix) {
        this.prefix = Objects.requireNonNull(prefix);
    }

    @Override
    public Thread newThread(Runnable runnable) {
        Thread thread = new Thread(runnable);
        thread.setName(prefix + "-" + sequence.incrementAndGet());
        thread.setDaemon(false);
        return thread;
    }
}
```

Executor:

```java
ExecutorService executor = new ThreadPoolExecutor(
    8,
    32,
    60,
    TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),
    new NamedThreadFactory("case-workflow-worker"),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

Thread naming adalah observability investment.

---

## 22. Correlating Thread Dump with OS CPU

Jika CPU tinggi, cari OS thread yang memakai CPU.

```bash
top -H -p <pid>
```

Misal `top` menunjukkan TID decimal `18947`.

Konversi ke hex:

```bash
printf '%x\n' 18947
```

Hasil:

```text
4a03
```

Cari di thread dump:

```text
nid=0x4a03
```

Jika stack:

```text
"http-nio-8080-exec-17" RUNNABLE nid=0x4a03
    at java.util.regex.Pattern$Loop.match(...)
    at java.util.regex.Pattern$GroupTail.match(...)
    at java.util.regex.Matcher.matches(...)
    at com.example.ValidationService.validate(...)
```

Maka CPU tinggi mungkin berasal dari regex validation.

Jika stack berubah-ubah cepat, gunakan async-profiler untuk sample yang lebih akurat.

---

## 23. Multiple Dump Analysis Patterns

### 23.1 Stuck Same Stack

```text
Dump 1: thread A at ExternalClient.call
Dump 2: thread A at ExternalClient.call
Dump 3: thread A at ExternalClient.call
```

Kemungkinan:

- external call stuck,
- no timeout,
- socket/read wait,
- dependency frozen.

### 23.2 Pool Wait Growth

```text
Dump 1: 20 threads waiting HikariPool.getConnection
Dump 2: 60 threads waiting HikariPool.getConnection
Dump 3: 140 threads waiting HikariPool.getConnection
```

Kemungkinan:

- DB pool exhaustion worsening,
- request arrival > completion,
- backpressure missing.

### 23.3 Lock Convoy

```text
Dump 1: 30 BLOCKED on lock X
Dump 2: 45 BLOCKED on lock X
Dump 3: 50 BLOCKED on lock X
```

Kemungkinan:

- lock contention hot path,
- owner slow,
- critical section too large.

### 23.4 Progressing but Slow

```text
Same thread names, different stacks across dumps.
```

Kemungkinan:

- work is progressing,
- latency due to CPU/load rather than stuck.

Gunakan profiler/metrics untuk detail.

---

## 24. Common Stack Pattern Catalog

### 24.1 Idle Executor Worker

```text
java.util.concurrent.ThreadPoolExecutor.getTask
java.util.concurrent.ThreadPoolExecutor.runWorker
```

Biasanya normal.

### 24.2 Waiting for DB Connection

```text
com.zaxxer.hikari.pool.HikariPool.getConnection
com.zaxxer.hikari.HikariDataSource.getConnection
```

Pool pressure/exhaustion.

### 24.3 Slow JDBC Query

```text
oracle.jdbc.driver.T4CPreparedStatement.executeForRows
com.zaxxer.hikari.pool.ProxyPreparedStatement.executeQuery
org.hibernate.engine.jdbc.internal.ResultSetReturnImpl.extract
```

Thread sedang menjalankan/menunggu query.

### 24.4 HTTP Client Read

```text
sun.nio.ch.SocketDispatcher.read0
okhttp3.internal...
org.apache.http.impl...
java.net.SocketInputStream.socketRead0
```

External dependency wait.

### 24.5 LockSupport Park

```text
jdk.internal.misc.Unsafe.park
java.util.concurrent.locks.LockSupport.park
```

Butuh stack bawah untuk tahu menunggu apa.

### 24.6 CompletableFuture Join

```text
java.util.concurrent.CompletableFuture.join
java.util.concurrent.CompletableFuture.get
```

Async dependency wait.

### 24.7 CountDownLatch Await

```text
java.util.concurrent.CountDownLatch.await
```

Menunggu signal. Jika tidak ada countdown, stuck.

### 24.8 Blocking Queue Put

```text
java.util.concurrent.ArrayBlockingQueue.put
```

Queue full/backpressure.

### 24.9 Blocking Queue Take

```text
java.util.concurrent.LinkedBlockingQueue.take
```

Consumer idle, atau wiring issue jika backlog ada.

### 24.10 Logging Appender

```text
ch.qos.logback.core.OutputStreamAppender
org.apache.logging.log4j.core.appender
```

Logging overhead/blocking.

### 24.11 Class Loading Lock

```text
java.lang.ClassLoader.loadClass
```

Classloading contention/startup/lazy init issue.

### 24.12 DNS Lookup

```text
java.net.InetAddress.getAllByName
```

DNS latency/cache issue.

---

## 25. Thread Dump and Java Frameworks

### 25.1 Servlet Containers

Tomcat:

```text
http-nio-8080-exec-*
```

Jetty:

```text
qtp*-*
```

Undertow/XNIO:

```text
XNIO-*-task-*
```

Important question:

```text
Are request workers doing useful work, waiting for DB, blocked on lock, or stuck in external IO?
```

### 25.2 Spring `@Async`

Default executor may be undesirable if not configured.

Thread dump clue:

```text
task-1
task-2
SimpleAsyncTaskExecutor-*
```

`SimpleAsyncTaskExecutor` historically can create many threads if misused.

Use bounded executor with clear name.

### 25.3 Spring Scheduler

Thread names:

```text
scheduling-1
```

If only one scheduler thread and job blocks, all schedules can be delayed.

### 25.4 Reactor / WebFlux

Thread names:

```text
reactor-http-nio-*
boundedElastic-*
parallel-*
```

Thread dump interpretation differs because event loop should not block.

Bad pattern:

```text
reactor-http-nio-* at BlockingRepository.find...
```

Means blocking call on event loop.

### 25.5 Messaging

RabbitMQ:

```text
AMQP Connection
rabbit-consumer-*
```

Kafka:

```text
kafka-consumer-*
```

Question:

- Are consumers polling?
- Are they processing?
- Are they stuck in DB/external API?
- Are they blocked on app lock?

---

## 26. Incident Playbook: Latency Spike with Low CPU

### 26.1 Symptom

```text
CPU              : 25%
HTTP p95 latency : 15s
HTTP errors      : timeout increasing
DB pool pending  : high
```

### 26.2 Thread Dump Pattern

```text
160 http-nio threads
120 TIMED_WAITING at HikariPool.getConnection
20 RUNNABLE at Oracle JDBC execute
10 WAITING in executor
10 normal framework threads
```

### 26.3 Initial Conclusion

```text
Request workers are not CPU-bound. They are waiting for DB connections.
```

### 26.4 Next Evidence

Collect:

- Hikari active/idle/pending/timeouts,
- DB active session/wait event,
- slow SQL,
- transaction duration,
- recent deploy,
- trace for slow endpoint,
- logs for connection timeout.

### 26.5 Likely Hypothesis

1. Query slowed down.
2. Connections held longer.
3. Pool saturated.
4. HTTP workers blocked waiting.
5. User latency increased.

### 26.6 Mitigation

Depending evidence:

- reduce concurrency to endpoint,
- disable expensive feature,
- kill/repair blocking DB session,
- tune SQL/index,
- reduce retry storm,
- lower timeout to fail fast,
- increase pool only if DB capacity allows.

---

## 27. Incident Playbook: High CPU

### 27.1 Symptom

```text
CPU: 95%
p95 latency: high
DB pool: normal
GC pause: normal
```

### 27.2 Thread Dump + OS CPU

1. Run `top -H -p <pid>`.
2. Find high CPU TID.
3. Convert to hex.
4. Match `nid=0x...`.
5. Inspect stack.

### 27.3 Possible Stacks

Regex:

```text
java.util.regex.Pattern$Loop.match
```

JSON serialization:

```text
com.fasterxml.jackson.databind.ser.BeanSerializer.serialize
```

Logging storm:

```text
ch.qos.logback.classic.spi.ThrowableProxy
```

Crypto:

```text
javax.crypto.Cipher.doFinal
```

Compression:

```text
java.util.zip.Deflater.deflateBytes
```

### 27.4 Next Step

Use async-profiler CPU mode:

```bash
asprof -e cpu -d 60 -f cpu.html <pid>
```

Thread dump identifies suspect. Profiler quantifies cost.

---

## 28. Incident Playbook: Deadlock

### 28.1 Symptom

```text
Some endpoints hang forever.
CPU low.
No DB pressure.
Thread dump says Found one Java-level deadlock.
```

### 28.2 Action

1. Save full dump.
2. Identify deadlocked threads.
3. Identify locks and owner/waiter cycle.
4. Map stack to code path.
5. Check recent code change.
6. Create minimal reproduction if possible.
7. Patch lock ordering/critical section.

### 28.3 Mitigation

Often requires restart to release deadlock.

But before restart, capture:

- multiple thread dumps,
- JFR if possible,
- logs around involved operations,
- request/trace IDs if available.

---

## 29. Incident Playbook: Thread Leak

### 29.1 Symptom

```text
Thread count grows over hours/days.
Eventually unable to create native thread or memory pressure.
```

### 29.2 Thread Dump Pattern

Thousands of:

```text
pool-1234-thread-1
pool-1235-thread-1
pool-1236-thread-1
```

Or:

```text
Timer-1234
```

### 29.3 Root Causes

1. Executor created per request and not shutdown.
2. Timer created per object/tenant.
3. HTTP client per request.
4. SDK client per request.
5. Scheduler per module instance.
6. Classloader leak after redeploy.

### 29.4 Fix

- Make executor/client lifecycle application-scoped.
- Use dependency injection singleton for expensive clients.
- Shutdown executor on lifecycle stop.
- Use bounded pools.
- Add thread metrics and alert.

---

## 30. Thread Dump Report Template

Gunakan template ini untuk incident report.

```markdown
# Thread Dump Analysis Report

## Context
- Service:
- Environment:
- Instance/pod:
- Time window:
- Trigger symptom:
- Dump files:

## Summary
- Main finding:
- Impacted subsystem:
- Confidence:

## Thread State Distribution
| State | Count | Notes |
|---|---:|---|
| RUNNABLE | | |
| BLOCKED | | |
| WAITING | | |
| TIMED_WAITING | | |

## Dominant Stack Patterns
| Count | Thread group | Stack pattern | Interpretation |
|---:|---|---|---|
| | | | |

## Lock Analysis
- Deadlock detected: yes/no
- Contended locks:
- Lock owner threads:
- Waiting threads:

## Pool/Dependency Analysis
- HTTP worker state:
- DB pool wait:
- HTTP client wait:
- Messaging consumer state:
- Scheduler state:

## Cross-Signal Correlation
- Metrics:
- Logs:
- Traces:
- JFR/profiler:

## Hypotheses
1.
2.
3.

## Conclusion

## Recommended Mitigation

## Recommended Permanent Fix

## Observability Improvements
```

---

## 31. Practical Lab 1 — Deadlock

### Goal

Membuat deadlock dan membaca thread dump.

### Steps

1. Jalankan `DeadlockDemo`.
2. Ambil dump:

```bash
jcmd <pid> Thread.print > deadlock.txt
```

3. Cari:

```text
Found one Java-level deadlock
```

4. Identifikasi:

- thread A,
- thread B,
- lock A,
- lock B,
- line code.

5. Fix dengan lock ordering.

Expected learning:

```text
Deadlock bukan ditebak dari gejala hang, tetapi dibuktikan dari cycle lock ownership.
```

---

## 32. Practical Lab 2 — Hikari Pool Exhaustion

### Goal

Mensimulasikan connection pool exhaustion.

### Setup Idea

- Hikari max pool = 2.
- Endpoint sleep dalam transaction selama 10 detik.
- Kirim 20 concurrent requests.

### Expected Thread Dump

Banyak request thread:

```text
TIMED_WAITING at HikariPool.getConnection
```

### Analysis

Jawab:

1. Berapa thread menunggu connection?
2. Berapa thread memegang connection?
3. Apakah CPU tinggi?
4. Apakah ini pool size problem atau transaction duration problem?
5. Mitigasi apa yang paling aman?

---

## 33. Practical Lab 3 — ForkJoinPool Starvation

### Goal

Melihat common pool blocking.

### Anti-pattern

Gunakan `CompletableFuture.supplyAsync` tanpa executor untuk blocking IO simulation.

```java
CompletableFuture.supplyAsync(() -> {
    sleep(30_000);
    return "done";
});
```

Buat banyak task, lalu ambil dump.

Cari:

```text
ForkJoinPool.commonPool-worker-*
```

### Fix

Gunakan dedicated executor atau virtual thread executor dengan bounded downstream concurrency.

---

## 34. Practical Lab 4 — Thread Leak

### Goal

Membuktikan executor per request menyebabkan thread leak.

### Bad Code

```java
@GetMapping("/bad")
public String bad() {
    ExecutorService executor = Executors.newSingleThreadExecutor();
    executor.submit(() -> sleep(60_000));
    return "ok";
}
```

Kirim request berulang.

Ambil dump dan hitung thread `pool-*`.

### Fix

Gunakan singleton executor dan lifecycle shutdown.

---

## 35. Production Checklist

Sebelum incident:

- [ ] Semua executor punya nama thread jelas.
- [ ] HTTP worker metrics tersedia.
- [ ] DB pool active/idle/pending/timeouts tersedia.
- [ ] Queue consumer metrics tersedia.
- [ ] Scheduler/job execution metrics tersedia.
- [ ] Thread count metrics tersedia.
- [ ] Runbook thread dump tersedia.
- [ ] Container image atau debug method mendukung `jcmd`.
- [ ] Permission attach sudah dipahami.
- [ ] Sensitive data handling untuk diagnostic artifact jelas.
- [ ] JFR emergency dump strategy tersedia.

Saat incident:

- [ ] Ambil minimal 3 thread dumps.
- [ ] Catat timestamp setiap dump.
- [ ] Catat pod/instance.
- [ ] Ambil metrics time window yang sama.
- [ ] Ambil relevant logs/traces.
- [ ] Jangan restart sebelum evidence minimal terkumpul, kecuali impact mengharuskan.
- [ ] Jika CPU tinggi, korelasikan `nid` dengan OS TID.
- [ ] Jika virtual threads, gunakan JSON dump/JFR jika memungkinkan.

Setelah incident:

- [ ] Buat thread dump analysis report.
- [ ] Tambahkan missing metrics/logs/traces.
- [ ] Perbaiki thread naming.
- [ ] Perbaiki timeout/backpressure/bulkhead.
- [ ] Tambahkan alert untuk early signal.

---

## 36. Common Mistakes

1. Menyimpulkan root cause dari satu dump.
2. Menganggap semua `RUNNABLE` berarti CPU-bound.
3. Menganggap semua `WAITING` buruk.
4. Tidak mencari repeated stack patterns.
5. Tidak membandingkan multiple dumps.
6. Tidak mencocokkan `nid` dengan OS CPU thread.
7. Langsung menaikkan thread pool tanpa cek downstream capacity.
8. Langsung menaikkan DB pool tanpa cek DB capacity.
9. Tidak membedakan pool exhaustion dan pool wait akibat slow dependency.
10. Tidak mengumpulkan dump sebelum restart.
11. Thread name buruk sehingga analisis lambat.
12. Tidak memperhitungkan virtual thread observability format.
13. Mengabaikan logging appender sebagai sumber blocking.
14. Tidak menyimpan diagnostic artifacts dengan aman.

---

## 37. Java 8–25 Notes

### Java 8

- `jstack` dan `jcmd Thread.print` umum digunakan.
- Tidak ada virtual threads.
- Banyak sistem masih menggunakan platform thread-per-request.
- Thread dump klasik biasanya cukup.

### Java 11

- `jcmd` makin menjadi default diagnostic interface.
- JFR tersedia open-source di JDK.
- Thread dump + JFR mulai menjadi kombinasi kuat.

### Java 17

- LTS penting di enterprise.
- Tooling JFR/JMC/diagnostic lebih matang.
- Banyak Spring Boot 3 migration menuju Java 17+.

### Java 21

- Virtual threads menjadi fitur final.
- Observability thread-per-request berubah skala.
- JSON virtual thread dump menjadi makin penting.

### Java 25

- Tooling virtual-thread observability makin penting.
- `jcmd` dan JFR tetap menjadi basis diagnosis modern.
- Aplikasi yang memakai virtual threads harus punya runbook berbeda dari platform-thread-only apps.

---

## 38. Mental Model Ringkas

Thread dump analysis bukan mencari “thread mana yang error”. Thread dump analysis adalah mencari **runtime bottleneck shape**.

Bentuk umum:

```text
CPU-bound
 -> banyak RUNNABLE benar-benar on-CPU
 -> validasi dengan OS TID/profiler

Lock-bound
 -> banyak BLOCKED pada lock sama
 -> cari owner dan critical section

Pool-bound
 -> banyak WAITING/TIMED_WAITING pada resource pool
 -> cek pool metrics dan downstream

IO-bound
 -> banyak stack socket/db/client read
 -> cek timeout/dependency metrics/traces

Queue-bound
 -> producer blocked put atau consumer idle/stuck
 -> cek queue depth/lag

Scheduler-bound
 -> scheduler thread stuck
 -> cek job execution and pool design

Thread-leak-bound
 -> thread count tumbuh, banyak thread group baru
 -> cek executor/client lifecycle
```

Top-tier engineer tidak berhenti pada “thread blocked”. Ia bertanya:

```text
Blocked on what?
Who owns it?
How many are affected?
Is it progressing?
What changed?
What signal confirms it?
What mitigation reduces blast radius safely?
What design prevents recurrence?
```

---

## 39. Summary

Pada Part 25, kita membangun kemampuan membaca thread dump sebagai runtime forensic artifact.

Key takeaways:

1. Thread dump adalah snapshot, bukan timeline.
2. Multiple dumps jauh lebih kuat daripada single dump.
3. State thread harus dibaca bersama stack, thread name, lock info, dan metrics.
4. `RUNNABLE` tidak selalu CPU-bound.
5. `WAITING` tidak selalu buruk.
6. `BLOCKED` pada lock sama adalah sinyal lock contention.
7. DB/HTTP/resource pool exhaustion sering terlihat sebagai banyak thread waiting/parking.
8. Thread pool exhaustion sering merupakan efek, bukan root cause.
9. Virtual threads mengubah skala dan format observability, tetapi tidak menghapus bottleneck downstream.
10. Thread naming adalah bagian dari observability design.
11. Thread dump harus dikorelasikan dengan logs, metrics, traces, JFR, dan profiler.

Part berikutnya akan masuk ke **Heap Dump and Memory Troubleshooting: Leak, Retention, Allocation, Native Memory**.

---

## 40. References

- Oracle Java SE 25 Troubleshooting Guide — Diagnostic Tools, `jcmd`, `Thread.print`, impact and usage.
- Oracle Java SE 25 API — `java.lang.Thread.State`.
- Oracle Java SE 25 Core Libraries — Virtual Threads.
- Oracle Java SE 21 Virtual Threads documentation — JSON thread dump via `jcmd Thread.dump_to_file -format=json`.
- OpenJDK JEP 444 — Virtual Threads.
- Oracle Java SE 8 Troubleshooting Guide — `jcmd` utility and thread diagnostics.
- async-profiler project documentation — CPU/wall/allocation/lock profiling correlation.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 24 — JVM Troubleshooting Toolkit: `jcmd`, `jstack`, `jmap`, `jstat`, `jhsdb`, `jinfo`](./24-jvm-troubleshooting-toolkit-jcmd-jstack-jmap-jstat-jhsdb-jinfo.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 26 — Heap Dump and Memory Troubleshooting: Leak, Retention, Allocation, Native Memory](./26-heap-dump-and-memory-troubleshooting-leak-retention-allocation-native-memory.md)
