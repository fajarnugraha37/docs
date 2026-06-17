# Part 15 — `Thread`, `ThreadGroup`, `ThreadLocal`, `InheritableThreadLocal`: Only the `java.lang` Angle

> Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
> File: `15-thread-threadlocal-inheritablethreadlocal-java-lang-angle.md`  
> Scope: Java 8 hingga Java 25  
> Fokus: `java.lang.Thread`, `ThreadGroup`, `ThreadLocal`, `InheritableThreadLocal`, dan kontrak runtime yang melekat pada eksekusi thread, tanpa mengulang materi concurrency penuh.

---

## 1. Tujuan Part Ini

Di seri concurrency sebelumnya, thread biasanya dibahas sebagai alat menjalankan kerja paralel, sinkronisasi, executor, lock, reactive, atau virtual thread secara luas.

Di part ini sudutnya lebih sempit tetapi lebih dalam:

**bagaimana `java.lang` mendefinisikan thread sebagai bagian dari kontrak runtime Java.**

Yang ingin kita kuasai:

1. memahami `Thread` sebagai **carrier eksekusi**, bukan hanya objek yang menjalankan `Runnable`;
2. memahami perbedaan antara:
   - thread sebagai object Java;
   - thread sebagai execution path;
   - platform thread sebagai OS-backed execution;
   - virtual thread sebagai JDK-managed execution;
3. memahami properti `Thread` yang sering berdampak production:
   - name;
   - daemon;
   - priority;
   - state;
   - interrupt status;
   - context class loader;
   - uncaught exception handler;
4. memahami `ThreadLocal` sebagai mekanisme **per-thread hidden state**;
5. memahami kenapa `ThreadLocal` sangat kuat sekaligus berbahaya pada:
   - servlet container;
   - thread pool;
   - async processing;
   - virtual threads;
   - class loader isolation;
   - request context;
   - security context;
   - tenant context;
   - logging MDC;
6. memahami `InheritableThreadLocal` dan jebakan inheritance context;
7. memahami status `ThreadGroup` sebagai API legacy;
8. mampu merancang aturan internal kapan context boleh implicit dan kapan harus explicit.

---

## 2. Mental Model Utama

### 2.1 Thread bukan cuma object; thread adalah execution carrier

`Thread` adalah object Java yang merepresentasikan satu thread of execution.

Namun object `Thread` dan eksekusi aktualnya bukan hal yang sama.

```java
Thread t = new Thread(() -> System.out.println("run"));
```

Pada baris ini, kita baru punya object `Thread`. Eksekusi belum berjalan.

```java
t.start();
```

Baru setelah `start()`, JVM menjadwalkan eksekusi `run()` pada thread baru.

Kesalahan umum:

```java
t.run(); // bukan membuat thread baru
```

Ini hanya method call biasa di current thread.

Mental model:

```text
Thread object
  |
  | start()
  v
Runtime execution path
  |
  | invokes run()
  v
Task body
```

---

### 2.2 Thread adalah boundary antara Java code dan scheduler

Thread berada di perbatasan antara:

```text
Java program model
  |
  v
JVM runtime
  |
  v
Operating system scheduler / JDK scheduler
```

Untuk platform thread, scheduling berkaitan erat dengan OS thread.

Untuk virtual thread, Java tetap memakai `java.lang.Thread`, tetapi execution-nya dimanage oleh JDK dan dipetakan ke carrier thread saat berjalan.

Artinya: **API-nya sama-sama `Thread`, tetapi cost model-nya berbeda.**

---

### 2.3 `ThreadLocal` adalah hidden parameter

`ThreadLocal` sering terlihat seperti variable global yang aman:

```java
static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();
```

Namun mental model yang lebih akurat:

```text
Function call:
  process(request)

Hidden implicit input:
  CURRENT_USER.get()
```

Jadi `ThreadLocal` adalah **parameter tersembunyi** yang ikut melekat pada thread.

Ini bermanfaat untuk context lintas call stack seperti request id atau transaction id, tetapi berbahaya bila:

- tidak dibersihkan;
- dipakai untuk business state;
- melewati async boundary;
- dipakai dalam thread pool;
- dipakai untuk security decision tanpa lifecycle ketat;
- dipakai di library tanpa dokumentasi.

---

### 2.4 Inheritable context bukan sama dengan propagated context

`InheritableThreadLocal` menyalin value dari parent thread ke child thread saat child thread dibuat.

```text
Parent thread has value
        |
        | create new child thread
        v
Child receives initial inherited value
```

Tetapi pada thread pool, worker thread biasanya dibuat sekali lalu dipakai ulang berkali-kali.

Akibatnya inheritance terjadi pada **thread creation**, bukan pada **task submission**.

```text
submit task A
submit task B
submit task C
        |
        v
same worker thread reused
```

Ini alasan `InheritableThreadLocal` sering menjadi sumber context leak.

---

## 3. Batas Cakupan: Apa yang Tidak Diulang

Part ini tidak akan mengulang panjang:

- memory model;
- synchronized/lock;
- executor design;
- CompletableFuture;
- reactive programming;
- fork/join;
- structured concurrency;
- detailed virtual thread scheduling;
- performance benchmarking concurrency.

Yang dibahas hanya bagian yang melekat pada `java.lang`:

- `Thread`;
- `ThreadGroup`;
- `ThreadLocal`;
- `InheritableThreadLocal`;
- beberapa enum/nested API terkait `Thread`;
- runtime implications.

---

## 4. `Thread` sebagai Kontrak Dasar Eksekusi

### 4.1 Membuat thread

Cara klasik:

```java
Thread thread = new Thread(() -> {
    System.out.println("Hello from " + Thread.currentThread().getName());
});

thread.start();
```

Cara dengan nama:

```java
Thread thread = new Thread(
    () -> System.out.println("processing"),
    "invoice-worker-1"
);

thread.start();
```

Sejak Java modern, `Thread` juga menyediakan builder API untuk platform dan virtual thread:

```java
Thread thread = Thread.ofPlatform()
    .name("platform-worker-", 1)
    .start(() -> {
        System.out.println(Thread.currentThread());
    });
```

Virtual thread:

```java
Thread thread = Thread.ofVirtual()
    .name("request-vt-", 1)
    .start(() -> {
        System.out.println(Thread.currentThread());
    });
```

Mental model:

```text
Java 8:
  new Thread(runnable, name)

Java 21+:
  Thread.ofPlatform()
  Thread.ofVirtual()
```

Tetapi untuk library yang harus mendukung Java 8, builder API tidak bisa dipakai langsung tanpa compatibility strategy.

---

### 4.2 `start()` vs `run()`

```java
Thread thread = new Thread(() -> {
    System.out.println(Thread.currentThread().getName());
});

thread.run();   // runs on current thread
thread.start(); // runs on new thread
```

`run()` adalah method biasa.

`start()` adalah lifecycle transition.

```text
NEW --start()--> RUNNABLE --> TERMINATED
```

`start()` hanya boleh dipanggil sekali.

```java
Thread t = new Thread(() -> {});
t.start();
t.start(); // IllegalThreadStateException
```

Production implication:

- jangan expose `Thread` object secara bebas;
- jangan membangun abstraction yang memungkinkan double-start;
- prefer `ExecutorService` untuk task orchestration;
- jika harus memakai raw `Thread`, buat lifecycle explicit.

---

### 4.3 `Thread.currentThread()`

```java
Thread current = Thread.currentThread();
```

Ini mengembalikan `Thread` object untuk execution path yang sedang berjalan.

Use cases:

- diagnostic;
- naming;
- context class loader;
- interrupt check;
- logging;
- framework internals.

Contoh:

```java
String threadName = Thread.currentThread().getName();
boolean interrupted = Thread.currentThread().isInterrupted();
ClassLoader cl = Thread.currentThread().getContextClassLoader();
```

Hindari memakai current thread untuk business logic kecuali benar-benar context-runtime.

---

## 5. Thread Name: Observability Contract

### 5.1 Nama thread adalah debugging API

Thread name bukan hanya kosmetik.

Dalam production, nama thread muncul di:

- log;
- thread dump;
- profiler;
- metrics;
- deadlock diagnostics;
- exception stack context;
- tracing tools.

Contoh buruk:

```text
Thread-1
Thread-2
Thread-3
```

Contoh lebih baik:

```text
http-nio-8080-exec-17
payment-reconciliation-3
audit-export-vt-1042
rabbitmq-consumer-case-update-2
```

### 5.2 Naming pattern

Gunakan pola:

```text
<subsystem>-<role>-<sequence>
```

Contoh:

```text
case-escalation-worker-1
email-dispatcher-7
xml-import-vt-153
```

Untuk virtual thread:

```java
ThreadFactory factory = Thread.ofVirtual()
    .name("xml-import-vt-", 0)
    .factory();
```

Untuk platform thread:

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("batch-worker-", 0)
    .daemon(false)
    .factory();
```

### 5.3 Failure mode: thread name mengandung data sensitif

Jangan:

```java
Thread.currentThread().setName("user-" + userEmail + "-request");
```

Karena thread name bisa muncul di:

- log;
- monitoring;
- heap dump;
- thread dump;
- support ticket;
- error report.

Gunakan correlation id non-sensitive.

---

## 6. Daemon Thread: Liveness Contract JVM

### 6.1 Apa itu daemon thread?

JVM akan tetap hidup selama masih ada non-daemon thread yang berjalan.

Daemon thread tidak menahan JVM agar tetap hidup.

```java
Thread t = new Thread(() -> {
    while (true) {
        doBackgroundWork();
    }
});

t.setDaemon(true);
t.start();
```

Jika semua non-daemon thread selesai, JVM dapat exit walaupun daemon thread masih berjalan.

### 6.2 Kapan daemon cocok?

Cocok untuk:

- background monitor;
- metrics poller;
- cache cleanup;
- best-effort watcher;
- helper thread yang tidak boleh mencegah shutdown.

Tidak cocok untuk:

- writing audit records;
- sending final notification;
- committing transaction;
- flushing critical queue;
- migration process;
- regulatory evidence persistence.

### 6.3 Failure mode

```java
Thread t = new Thread(() -> auditWriter.flushForever());
t.setDaemon(true);
t.start();
```

Risiko:

```text
Application shutdown
  -> daemon thread killed implicitly
  -> audit not flushed
  -> evidence gap
```

Rule:

> Critical work must not rely on daemon thread completion.

---

## 7. Priority: Jangan Dijadikan Control Mechanism

Java thread punya priority:

```java
thread.setPriority(Thread.NORM_PRIORITY);
```

Constants:

```java
Thread.MIN_PRIORITY
Thread.NORM_PRIORITY
Thread.MAX_PRIORITY
```

Tetapi thread priority:

- sangat bergantung OS/JVM;
- tidak portable;
- tidak boleh dipakai sebagai correctness mechanism;
- tidak menggantikan queueing, scheduling, rate limiting, atau backpressure.

Bad design:

```text
High priority approval thread should always win.
```

Better design:

```text
Separate queue
explicit scheduler
bounded executor
priority queue with policy
backpressure
timeout
observability
```

---

## 8. Thread State: Diagnostic, Not Business Logic

`Thread.State` berisi:

- `NEW`
- `RUNNABLE`
- `BLOCKED`
- `WAITING`
- `TIMED_WAITING`
- `TERMINATED`

Contoh:

```java
Thread.State state = thread.getState();
```

Gunanya:

- diagnostics;
- thread dump interpretation;
- monitoring;
- debugging deadlock/blocking.

Jangan membuat business logic berdasarkan `Thread.State`.

Contoh buruk:

```java
if (worker.getState() == Thread.State.WAITING) {
    // assume it is safe to mutate internal state
}
```

Thread state bersifat snapshot dan bisa berubah segera setelah dibaca.

Mental model:

```text
Thread state is an observation,
not a lock,
not a guarantee,
not a coordination primitive.
```

---

## 9. Interrupt: Cancellation Signal, Bukan Kill

### 9.1 Interrupt flag

Interrupt adalah sinyal kooperatif.

```java
thread.interrupt();
```

Target thread perlu mengecek:

```java
while (!Thread.currentThread().isInterrupted()) {
    doWork();
}
```

Atau blocking method dapat melempar `InterruptedException`.

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt(); // restore
    return;
}
```

### 9.2 `isInterrupted()` vs `interrupted()`

```java
Thread.currentThread().isInterrupted();
```

Mengecek status tanpa clear.

```java
Thread.interrupted();
```

Mengecek dan clear status current thread.

Ini sering menyebabkan bug.

Bad:

```java
if (Thread.interrupted()) {
    log.info("interrupted");
}
// interrupt status now cleared
```

Better:

```java
if (Thread.currentThread().isInterrupted()) {
    log.info("interrupted");
}
```

Gunakan `Thread.interrupted()` hanya jika memang ingin consume signal.

### 9.3 Rule production

Jika menangkap `InterruptedException`, pilih salah satu:

1. propagate sebagai cancellation;
2. restore interrupt dan return;
3. restore interrupt dan throw domain/runtime exception yang tepat.

Jangan:

```java
catch (InterruptedException e) {
    // ignore
}
```

Karena itu memutus cancellation protocol.

---

## 10. Sleep, Yield, Join: Lifecycle Coordination Minimal

### 10.1 `sleep`

```java
Thread.sleep(Duration.ofSeconds(1));
```

atau di Java 8:

```java
Thread.sleep(1000);
```

`sleep`:

- tidak melepas monitor lock;
- bisa diinterrupt;
- bukan scheduling guarantee.

Bad:

```java
Thread.sleep(500); // wait until service is ready
```

Better:

```java
await readiness condition with timeout
```

### 10.2 `yield`

```java
Thread.yield();
```

`yield` adalah hint ke scheduler.

Jangan dipakai untuk correctness.

### 10.3 `join`

```java
thread.join();
```

Menunggu thread selesai.

Gunakan timeout jika production-sensitive:

```java
thread.join(5000);
if (thread.isAlive()) {
    thread.interrupt();
}
```

Namun raw `join` jarang ideal untuk aplikasi modern. Prefer higher-level lifecycle abstraction.

---

## 11. Context Class Loader: Plugin/Container Boundary

### 11.1 Apa itu context class loader?

Setiap thread punya context class loader:

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
```

Bisa diganti:

```java
Thread.currentThread().setContextClassLoader(customClassLoader);
```

Kenapa ini ada?

Karena class loading tidak selalu bisa mengikuti parent delegation biasa. Banyak framework perlu memuat class dari context aplikasi:

- servlet container;
- JNDI;
- SPI/service loader;
- XML parser factory;
- logging provider;
- plugin system;
- application server;
- dependency injection container.

### 11.2 Pattern aman mengganti context class loader

```java
Thread thread = Thread.currentThread();
ClassLoader previous = thread.getContextClassLoader();

try {
    thread.setContextClassLoader(pluginClassLoader);
    runPlugin();
} finally {
    thread.setContextClassLoader(previous);
}
```

Jangan lupa restore.

### 11.3 Failure mode: class loader leak

Jika thread pool worker menyimpan context class loader aplikasi lama, redeployment bisa leak.

```text
Container thread
  -> contextClassLoader points to old webapp classloader
  -> old classes cannot be GC'ed
  -> redeploy leak
```

Rule:

> Every temporary context class loader change must be restored in `finally`.

---

## 12. Uncaught Exception Handler

Jika thread melempar exception yang tidak ditangkap, JVM memanggil uncaught exception handler.

```java
Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
    System.err.println("Uncaught in " + thread.getName() + ": " + error);
});
```

Per-thread handler:

```java
Thread t = new Thread(() -> {
    throw new RuntimeException("boom");
});

t.setUncaughtExceptionHandler((thread, error) -> {
    logFailure(thread, error);
});

t.start();
```

### 12.1 Use cases

- log fatal failure in raw thread;
- mark component unhealthy;
- notify supervisor;
- emit metric;
- capture diagnostic event.

### 12.2 Tidak cukup untuk executor

Jika task dijalankan lewat `ExecutorService`, exception biasanya ditangkap oleh executor dan dikemas ke `Future`.

```java
Future<?> f = executor.submit(() -> {
    throw new RuntimeException("boom");
});

f.get(); // ExecutionException
```

Jadi uncaught handler bukan mekanisme universal.

### 12.3 Rule

Untuk raw thread:

```text
always define failure observation strategy
```

Untuk executor:

```text
observe Future/CompletionStage/afterExecute/error callbacks
```

---

## 13. `ThreadGroup`: Legacy API

`ThreadGroup` adalah API lama untuk mengelompokkan thread.

```java
ThreadGroup group = new ThreadGroup("workers");
Thread t = new Thread(group, () -> doWork(), "worker-1");
```

Masalah:

- desainnya berasal dari era awal Java;
- banyak method kurang reliable untuk kontrol modern;
- tidak cocok sebagai security boundary modern;
- beberapa method deprecated/for removal;
- virtual thread dan platform modern membuat modelnya makin kurang relevan.

Gunakan `ThreadGroup` terutama sebagai compatibility/legacy understanding.

Alternatif modern:

- `ExecutorService`;
- custom `ThreadFactory`;
- structured concurrency API jika tersedia dan sesuai versi;
- lifecycle-managed component;
- monitoring melalui JFR/thread dump/metrics;
- explicit ownership model.

### 13.1 Jangan gunakan `ThreadGroup` untuk counting yang presisi

Method seperti enumerate bersifat snapshot dan race-prone.

Bad:

```java
int count = group.activeCount();
```

Untuk production control, gunakan registry sendiri atau executor metrics.

---

## 14. `ThreadLocal`: Per-Thread State

### 14.1 Basic usage

```java
private static final ThreadLocal<String> CURRENT_REQUEST_ID = new ThreadLocal<>();

public static void setRequestId(String requestId) {
    CURRENT_REQUEST_ID.set(requestId);
}

public static String getRequestId() {
    return CURRENT_REQUEST_ID.get();
}

public static void clear() {
    CURRENT_REQUEST_ID.remove();
}
```

Usage:

```java
try {
    CURRENT_REQUEST_ID.set(requestId);
    handleRequest();
} finally {
    CURRENT_REQUEST_ID.remove();
}
```

Rule utama:

> Every `ThreadLocal.set()` in request/task scope must have a matching `remove()` in `finally`.

---

### 14.2 Kenapa `remove()` penting?

Pada thread pool, thread dipakai ulang.

```text
Request A runs on worker-1
  set user = Alice
  forget remove

Request B runs on worker-1
  reads user = Alice
```

Ini bisa menjadi:

- data leak;
- security bug;
- tenant isolation bug;
- audit attribution bug;
- wrong authorization decision;
- corrupted logging context.

### 14.3 ThreadLocalMap mental model

Secara konseptual:

```text
Thread
  -> ThreadLocalMap
       key: ThreadLocal object
       value: per-thread value
```

Masing-masing thread punya storage sendiri.

Tetapi value bisa tetap hidup selama thread hidup jika tidak dibersihkan.

Jika worker thread hidup berhari-hari, value juga bisa hidup berhari-hari.

---

## 15. Common `ThreadLocal` Use Cases

### 15.1 Correlation/request id

```java
public final class RequestContext {
    private static final ThreadLocal<String> REQUEST_ID = new ThreadLocal<>();

    private RequestContext() {}

    public static String requestId() {
        return REQUEST_ID.get();
    }

    public static Scope open(String requestId) {
        REQUEST_ID.set(requestId);
        return REQUEST_ID::remove;
    }

    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }
}
```

Usage:

```java
try (RequestContext.Scope ignored = RequestContext.open("req-123")) {
    service.handle();
}
```

This is safer because lifecycle is explicit.

### 15.2 Logging MDC-like context

Logging frameworks often use thread-local context.

Pattern:

```java
try {
    MDC.put("requestId", requestId);
    handle();
} finally {
    MDC.clear();
}
```

Risiko:

- async boundary loses MDC;
- thread pool reuses MDC;
- wrong request id in logs;
- sensitive data in MDC.

### 15.3 Transaction/session context

Frameworks may bind transaction/session to current thread.

This is powerful but dangerous if:

- operation hops threads;
- async code runs outside transaction thread;
- session leaks beyond request;
- nested context not restored.

### 15.4 Security context

Security frameworks often use thread-local authentication.

Risk:

```text
previous user remains on reused thread
  -> next request sees wrong authentication
  -> privilege leak
```

Security context cleanup must be non-negotiable.

---

## 16. Anti-Patterns with `ThreadLocal`

### 16.1 Business state hidden in ThreadLocal

Bad:

```java
public BigDecimal calculateTax(Order order) {
    Country country = CURRENT_COUNTRY.get();
    return taxTable.forCountry(country).calculate(order);
}
```

Better:

```java
public BigDecimal calculateTax(Order order, Country country) {
    return taxTable.forCountry(country).calculate(order);
}
```

ThreadLocal should not replace explicit domain parameters.

### 16.2 Mutable object stored and shared accidentally

```java
static final ThreadLocal<List<String>> EVENTS =
    ThreadLocal.withInitial(ArrayList::new);
```

If not cleared:

- list grows forever;
- stale events pollute next request;
- memory leak.

### 16.3 Library silently using ThreadLocal

A library that hides context in ThreadLocal makes call graph harder to reason about.

Better library design:

- document context lifecycle;
- provide `Scope`;
- provide cleanup;
- avoid implicit state when explicit state is feasible.

### 16.4 Using ThreadLocal for cache without bounds

```java
ThreadLocal<Map<String, Object>> CACHE = ThreadLocal.withInitial(HashMap::new);
```

In a large thread pool, this is:

```text
cache per thread * number of threads * unbounded keys
```

Dangerous.

---

## 17. `ThreadLocal.withInitial`

```java
private static final ThreadLocal<StringBuilder> BUFFER =
    ThreadLocal.withInitial(() -> new StringBuilder(1024));
```

This avoids null checks.

But do not assume it is always good.

### 17.1 Reusable buffer pattern

```java
StringBuilder sb = BUFFER.get();
sb.setLength(0);

try {
    sb.append("...");
    return sb.toString();
} finally {
    if (sb.capacity() > 64 * 1024) {
        BUFFER.remove();
    }
}
```

Why remove if too large?

Because one abnormal large request can permanently retain large buffer on that thread.

### 17.2 Virtual thread caution

ThreadLocal per virtual thread can be okay because virtual threads are cheap and often short-lived.

But if you create millions of virtual threads and each gets large ThreadLocal state, memory explodes.

Rule:

```text
Virtual thread reduces thread cost.
It does not make per-thread state free.
```

---

## 18. `InheritableThreadLocal`

### 18.1 Basic behavior

```java
private static final InheritableThreadLocal<String> TENANT =
    new InheritableThreadLocal<>();

TENANT.set("agency-a");

Thread child = new Thread(() -> {
    System.out.println(TENANT.get()); // agency-a
});

child.start();
```

Child thread receives initial value from parent.

### 18.2 Custom child value

```java
private static final InheritableThreadLocal<Map<String, String>> CONTEXT =
    new InheritableThreadLocal<>() {
        @Override
        protected Map<String, String> childValue(Map<String, String> parentValue) {
            return parentValue == null ? null : new HashMap<>(parentValue);
        }
    };
```

Important: clone/copy mutable values if needed.

### 18.3 Why dangerous in thread pools

```java
InheritableThreadLocal<String> USER = new InheritableThreadLocal<>();

ExecutorService pool = Executors.newFixedThreadPool(1);

USER.set("alice");
pool.submit(() -> System.out.println(USER.get()));

USER.set("bob");
pool.submit(() -> System.out.println(USER.get()));
```

You might expect:

```text
alice
bob
```

But actual behavior can surprise because worker thread inheritance happened when worker was created, not when task was submitted.

### 18.4 Good uses

Limited use cases:

- creating one-off child thread with clear lifecycle;
- bootstrap context;
- diagnostic context in simple parent-child threading;
- controlled thread creation boundary.

Avoid for:

- request context in pools;
- tenant context in async;
- security context propagation;
- transaction context;
- generic framework context propagation.

---

## 19. Virtual Threads and `ThreadLocal`

### 19.1 Same `Thread` API, different cost model

Virtual threads are still represented by `java.lang.Thread`.

```java
Thread vt = Thread.ofVirtual().start(() -> {
    System.out.println(Thread.currentThread().isVirtual());
});
```

Key point:

```text
virtual thread:
  many logical threads
  cheap blocking
  still has ThreadLocal support
```

### 19.2 When ThreadLocal is okay with virtual threads

Good:

- small request id;
- short-lived context;
- cleared or naturally dies with virtual thread;
- no large retained object;
- no accidental inheritance;
- no long-lived pool reuse.

### 19.3 When ThreadLocal is risky with virtual threads

Bad:

```java
static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[1024 * 1024]);
```

If many virtual threads touch it:

```text
1 MB * many virtual threads = memory disaster
```

### 19.4 Virtual thread does not fix hidden dependency

Even if virtual threads reduce pool reuse leaks, ThreadLocal still hides dependency.

This remains a design question:

```text
Should this value be an explicit parameter?
Should it be request context?
Should it be propagated?
Should it be scoped?
```

---

## 20. Context Propagation: Explicit vs Implicit

### 20.1 Explicit context

```java
record RequestContext(String requestId, String tenantId, String userId) {}

service.handle(command, context);
```

Pros:

- visible dependency;
- testable;
- async-safe;
- no cleanup leak;
- no thread binding.

Cons:

- more parameters;
- may pollute lower-level APIs if overused;
- needs discipline.

### 20.2 Implicit thread-local context

```java
RequestContextHolder.current();
```

Pros:

- convenient;
- reduces plumbing;
- works with synchronous call stack;
- useful for infrastructure-level data.

Cons:

- hidden dependency;
- unsafe across async boundaries;
- cleanup required;
- harder testing;
- leak risks;
- context confusion.

### 20.3 Practical rule

Use explicit context for:

- tenant;
- user;
- authorization;
- business decision;
- audit attribution;
- regulatory decision;
- state transition.

ThreadLocal may be acceptable for:

- correlation id;
- logging metadata;
- tracing span;
- low-level framework session;
- request-scoped infrastructure context.

Even then, lifecycle must be explicit.

---

## 21. Scoped Context Pattern with `AutoCloseable`

A safer wrapper:

```java
public final class TenantContext {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private TenantContext() {}

    public static String currentTenant() {
        String tenant = CURRENT.get();
        if (tenant == null) {
            throw new IllegalStateException("No tenant context bound to current thread");
        }
        return tenant;
    }

    public static Scope bind(String tenant) {
        String previous = CURRENT.get();
        CURRENT.set(tenant);
        return () -> {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        };
    }

    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }
}
```

Usage:

```java
try (TenantContext.Scope scope = TenantContext.bind("agency-a")) {
    processRequest();
}
```

This supports nesting:

```text
outer tenant = agency-a
  inner tenant = agency-b
restore agency-a
```

This is safer than simple remove-only cleanup when nested context is legitimate.

---

## 22. ThreadLocal and Class Loader Leak

### 22.1 Typical container leak

```text
Application class defines:
  static ThreadLocal<MyAppObject>

Container thread stores:
  value = MyAppObject loaded by WebAppClassLoader

Redeploy:
  static field may be gone
  but thread still has ThreadLocalMap entry/value
  old classloader retained
```

Effects:

- memory leak;
- metaspace pressure;
- redeploy instability;
- stale config;
- weird ClassCastException;
- production degradation after multiple deploys.

### 22.2 Prevention

- always `remove()`;
- clear context in filters/interceptors;
- avoid storing application class instances in long-lived container thread locals;
- use framework-approved lifecycle hooks;
- avoid custom static ThreadLocal in shared libs unless strongly justified;
- test redeploy scenarios if running in container/application server.

---

## 23. ThreadLocal and Security Boundary

ThreadLocal is often used for security context.

Risk matrix:

| Scenario | Risk | Mitigation |
|---|---|---|
| Missing cleanup | user A appears in user B request | cleanup in finally |
| Async handoff | context disappears | explicit propagation |
| InheritableThreadLocal | stale inherited user | avoid for security context |
| Mutable auth object | privilege mutation | immutable principal |
| Library context | hidden authorization dependency | explicit security boundary |
| Logging context | PII leakage | store non-sensitive IDs |

### 23.1 Security context should be immutable

Bad:

```java
class CurrentUser {
    Set<String> roles;
}
```

Better:

```java
record CurrentUser(String userId, Set<String> roles) {
    public CurrentUser {
        roles = Set.copyOf(roles);
    }
}
```

---

## 24. ThreadLocal and Transaction Boundary

Thread-bound transaction is common in frameworks.

Mental model:

```text
begin transaction
  bind connection/session to current thread
  service call stack uses current resource
commit/rollback
  unbind
```

This works for synchronous execution.

It breaks when:

- work moves to another thread;
- callback runs later;
- CompletableFuture uses common pool;
- virtual thread boundary differs from framework expectation;
- transaction resource not unbound.

Bad:

```java
@Transactional
public void approve(CaseId id) {
    CompletableFuture.runAsync(() -> repository.update(id));
}
```

The async body may not run with the same transaction context.

Rule:

> Thread-bound transaction does not automatically cross thread boundary.

---

## 25. ThreadLocal and Logging MDC

MDC-style context is useful:

```text
requestId=...
traceId=...
tenantId=...
```

But design carefully.

### 25.1 Good MDC values

- request id;
- trace id;
- span id;
- non-sensitive tenant code if allowed;
- operation name;
- module name.

### 25.2 Bad MDC values

- password;
- token;
- full email;
- NRIC/NIK/passport;
- raw authorization header;
- full payload;
- detailed privilege set.

### 25.3 Cleanup filter

```java
try {
    MDC.put("requestId", requestId);
    chain.doFilter(request, response);
} finally {
    MDC.clear();
}
```

If nested MDC is used, restore previous values instead of clear all blindly.

---

## 26. Designing Raw Threads Safely

Although most applications should use executors, raw threads appear in:

- bootstrap logic;
- embedded server;
- background worker;
- low-level library;
- process supervision;
- test utility;
- custom runtime.

Checklist:

```text
[ ] thread has meaningful name
[ ] daemon choice is deliberate
[ ] uncaught exception is observed
[ ] shutdown path exists
[ ] interruption is respected
[ ] context class loader is correct/restored
[ ] ThreadLocal state is cleared
[ ] no sensitive data in thread name
[ ] lifecycle is documented
```

Example:

```java
public final class BackgroundWorker implements AutoCloseable {
    private final Thread thread;
    private volatile boolean running = true;

    public BackgroundWorker() {
        this.thread = Thread.ofPlatform()
            .name("case-background-worker")
            .daemon(false)
            .unstarted(this::runLoop);

        this.thread.setUncaughtExceptionHandler((t, e) -> {
            System.err.println("Fatal worker failure in " + t.getName());
            e.printStackTrace();
        });
    }

    public void start() {
        thread.start();
    }

    private void runLoop() {
        while (running && !Thread.currentThread().isInterrupted()) {
            try {
                doOneCycle();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (RuntimeException e) {
                // decide whether to continue or stop
                logRuntimeFailure(e);
            }
        }
    }

    private void doOneCycle() throws InterruptedException {
        Thread.sleep(1000);
    }

    private void logRuntimeFailure(RuntimeException e) {
        e.printStackTrace();
    }

    @Override
    public void close() throws InterruptedException {
        running = false;
        thread.interrupt();
        thread.join(5000);
        if (thread.isAlive()) {
            throw new IllegalStateException("Worker did not stop");
        }
    }
}
```

---

## 27. Java 8–25 Evolution Map

### Java 8 baseline

Core APIs available:

- `Thread`;
- `ThreadGroup`;
- `ThreadLocal`;
- `InheritableThreadLocal`;
- `Runnable`;
- interrupt;
- daemon;
- priority;
- context class loader;
- uncaught exception handler.

### Java 9+

Relevant runtime shift:

- module system affects class loading and reflection boundaries;
- platform class loader replaces some older assumptions;
- more attention to strong encapsulation;
- diagnostics improved across releases.

### Java 19/20 preview era

Virtual threads previewed before finalization.

Do not treat preview API as stable for Java 8–25 library baseline.

### Java 21+

Virtual threads finalized.

`Thread` API now clearly has:

- platform thread factory/builder;
- virtual thread factory/builder;
- `isVirtual()`.

### Java 25

Java 25 retains the modern `Thread` model and continues the post-Loom design direction. It also includes continued evolution around virtual thread behavior and synchronization improvements in the platform.

Compatibility rule:

```text
If your code must run on Java 8:
  do not statically reference Java 21+ Thread APIs.

If your code can require Java 21+:
  use Thread.ofVirtual/ofPlatform where appropriate.

If your library supports multiple runtimes:
  isolate modern API use behind reflection or multi-release JAR.
```

---

## 28. Failure Modes

### 28.1 Missing ThreadLocal cleanup

Symptom:

- wrong user in logs;
- wrong tenant;
- authorization leakage;
- test passes alone but fails in suite.

Root cause:

```java
CURRENT_USER.set(user);
// no remove
```

Fix:

```java
try {
    CURRENT_USER.set(user);
    handle();
} finally {
    CURRENT_USER.remove();
}
```

---

### 28.2 Swallowing interrupt

Bad:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    log.warn("ignored");
}
```

Effect:

- shutdown hangs;
- cancellation ignored;
- executor cannot stop gracefully.

Fix:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

---

### 28.3 Relying on thread priority

Symptom:

- works on dev machine;
- behaves differently in container/production.

Fix:

- explicit scheduling;
- queues;
- rate limiters;
- priority queue;
- separate executor.

---

### 28.4 Context class loader not restored

Bad:

```java
Thread.currentThread().setContextClassLoader(pluginCl);
run();
```

Fix:

```java
Thread current = Thread.currentThread();
ClassLoader old = current.getContextClassLoader();

try {
    current.setContextClassLoader(pluginCl);
    run();
} finally {
    current.setContextClassLoader(old);
}
```

---

### 28.5 InheritableThreadLocal with pooled executor

Symptom:

- stale user/tenant/request id appears in later task.

Fix:

- avoid `InheritableThreadLocal` for pools;
- use explicit context propagation;
- wrap task with capture/restore if needed;
- cleanup after task.

---

### 28.6 Daemon thread used for critical work

Symptom:

- data loss at shutdown;
- audit missing;
- queue not flushed.

Fix:

- non-daemon lifecycle-managed worker;
- graceful shutdown;
- timeout and health reporting.

---

### 28.7 Thread name contains PII

Symptom:

- PII in thread dump/logs.

Fix:

- use correlation id;
- keep names structural;
- do not include personal identifiers.

---

### 28.8 ThreadLocal large buffer retention

Symptom:

- memory grows after one large request;
- heap dump shows per-thread large arrays/builders.

Fix:

```java
if (buffer.capacity() > MAX_RETAINED_CAPACITY) {
    THREAD_LOCAL_BUFFER.remove();
}
```

---

## 29. Production Design Patterns

### 29.1 Request context filter

```java
public final class RequestContextFilter {
    public void doFilter(Request request, FilterChain chain) {
        String requestId = request.header("X-Request-ID")
            .orElseGet(RequestIds::newId);

        try (RequestContext.Scope ignored = RequestContext.open(requestId)) {
            chain.doFilter(request);
        }
    }
}
```

Key properties:

- context opened at boundary;
- context closed in `finally` through try-with-resources;
- no lower layer decides lifecycle.

---

### 29.2 Task wrapper with explicit context propagation

```java
record ExecutionContext(String requestId, String tenantId) {}

final class ContextAwareRunnable implements Runnable {
    private final ExecutionContext context;
    private final Runnable delegate;

    ContextAwareRunnable(ExecutionContext context, Runnable delegate) {
        this.context = context;
        this.delegate = delegate;
    }

    @Override
    public void run() {
        try (RequestContext.Scope ignored = RequestContext.open(context.requestId())) {
            TenantContext.Scope tenantScope = TenantContext.bind(context.tenantId());
            try (tenantScope) {
                delegate.run();
            }
        }
    }
}
```

This is explicit at submission boundary.

---

### 29.3 Named thread factory

```java
public final class NamedThreadFactory implements ThreadFactory {
    private final AtomicInteger sequence = new AtomicInteger();
    private final String prefix;
    private final boolean daemon;

    public NamedThreadFactory(String prefix, boolean daemon) {
        this.prefix = Objects.requireNonNull(prefix);
        this.daemon = daemon;
    }

    @Override
    public Thread newThread(Runnable runnable) {
        Thread thread = new Thread(runnable);
        thread.setName(prefix + sequence.incrementAndGet());
        thread.setDaemon(daemon);
        thread.setUncaughtExceptionHandler((t, e) -> {
            System.err.println("Uncaught exception in " + t.getName());
            e.printStackTrace();
        });
        return thread;
    }
}
```

Java 21+ alternative:

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("case-worker-", 1)
    .daemon(false)
    .factory();
```

---

### 29.4 ThreadLocal scope with nesting restore

```java
public final class ScopedValueLikeContext<T> {
    private final ThreadLocal<T> local = new ThreadLocal<>();

    public T getRequired() {
        T value = local.get();
        if (value == null) {
            throw new IllegalStateException("No context bound");
        }
        return value;
    }

    public Scope bind(T value) {
        T previous = local.get();
        local.set(value);
        return () -> {
            if (previous == null) {
                local.remove();
            } else {
                local.set(previous);
            }
        };
    }

    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }
}
```

---

## 30. Testing Strategies

### 30.1 Test cleanup

```java
@Test
void contextIsCleanedAfterScope() {
    assertNull(RequestContext.currentOrNull());

    try (var ignored = RequestContext.open("req-1")) {
        assertEquals("req-1", RequestContext.currentOrNull());
    }

    assertNull(RequestContext.currentOrNull());
}
```

### 30.2 Test nested restore

```java
@Test
void nestedContextRestoresPreviousValue() {
    try (var outer = TenantContext.bind("a")) {
        assertEquals("a", TenantContext.currentTenant());

        try (var inner = TenantContext.bind("b")) {
            assertEquals("b", TenantContext.currentTenant());
        }

        assertEquals("a", TenantContext.currentTenant());
    }
}
```

### 30.3 Test pooled thread leak

```java
@Test
void threadLocalDoesNotLeakAcrossTasks() throws Exception {
    ExecutorService executor = Executors.newFixedThreadPool(1);

    try {
        Future<?> first = executor.submit(() -> {
            try {
                CURRENT_USER.set("alice");
            } finally {
                CURRENT_USER.remove();
            }
        });

        first.get();

        Future<String> second = executor.submit(CURRENT_USER::get);
        assertNull(second.get());
    } finally {
        executor.shutdownNow();
    }
}
```

### 30.4 Test interrupt behavior

```java
@Test
void workerStopsOnInterrupt() throws Exception {
    Thread worker = new Thread(() -> {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                Thread.sleep(10_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    });

    worker.start();
    worker.interrupt();
    worker.join(1000);

    assertFalse(worker.isAlive());
}
```

---

## 31. Performance and Memory Considerations

### 31.1 Thread creation cost

Platform threads are relatively expensive.

Avoid:

```java
for (Task task : tasks) {
    new Thread(() -> process(task)).start();
}
```

Prefer:

- executor;
- bounded concurrency;
- virtual threads if workload is suitable and Java version permits;
- structured concurrency where appropriate.

### 31.2 ThreadLocal memory cost

Memory cost formula:

```text
number of live threads
  * number of ThreadLocal values touched
  * retained object size
```

For virtual threads:

```text
number of live virtual threads
  * values touched
  * retained object size
```

Virtual thread reduces thread cost, not object cost.

### 31.3 Context class loader retention

Any object graph reachable from a live thread can become long-lived.

Watch:

- context class loader;
- ThreadLocal values;
- uncaught exception handler closures;
- thread target Runnable;
- captured lambdas.

---

## 32. Security Considerations

### 32.1 Do not use thread identity as user identity

Bad:

```java
if (Thread.currentThread().getName().contains("admin")) {
    allow();
}
```

Thread names are diagnostics, not authority.

### 32.2 Clear sensitive context

Sensitive context includes:

- authentication;
- authorization;
- tenant;
- request metadata;
- correlation to user;
- locale if it affects legal/business rule;
- impersonation markers.

### 32.3 Prevent cross-request contamination

Every request/task boundary should have:

```text
initialize context
run work
clear/restore context
```

### 32.4 Avoid inheritable security context

Inherited context can create accidental privilege propagation.

For security, explicit propagation is safer and reviewable.

---

## 33. Design Heuristics

### 33.1 When to use ThreadLocal

Use ThreadLocal when:

- value is infrastructure context;
- value is tied to synchronous execution;
- lifecycle is clearly bounded;
- cleanup is guaranteed;
- hidden dependency is acceptable;
- async behavior is controlled.

Avoid ThreadLocal when:

- value is business input;
- value determines authorization;
- value crosses async boundaries;
- context must be auditable;
- lifecycle is unclear;
- library users cannot see dependency.

### 33.2 When to use InheritableThreadLocal

Use rarely.

Acceptable:

- controlled parent-child thread creation;
- diagnostic/bootstrap context;
- short-lived child thread.

Avoid:

- pools;
- async frameworks;
- request context;
- security context;
- tenant context;
- transaction context.

### 33.3 When to use raw Thread

Use raw `Thread` rarely.

Acceptable:

- low-level runtime component;
- explicit background worker;
- demonstration/test;
- custom embedding;
- process supervisor.

Prefer executor/structured lifecycle for application workloads.

---

## 34. Practical Runtime Checklist

Before approving code that uses `Thread`, ask:

```text
[ ] Is raw Thread necessary?
[ ] Is the name meaningful and non-sensitive?
[ ] Is daemon setting deliberate?
[ ] Is shutdown defined?
[ ] Is interrupt respected?
[ ] Is uncaught failure observed?
[ ] Is context class loader handled correctly?
[ ] Is lifecycle tested?
```

Before approving code that uses `ThreadLocal`, ask:

```text
[ ] Why is explicit parameter not better?
[ ] Is value infrastructure-only?
[ ] Is set/remove paired?
[ ] Is nesting handled?
[ ] Is async boundary handled?
[ ] Is pooled thread reuse tested?
[ ] Is value immutable or defensively copied?
[ ] Is sensitive data minimized?
[ ] Is class loader leak risk considered?
```

Before approving code that uses `InheritableThreadLocal`, ask:

```text
[ ] Is child thread creation controlled?
[ ] Is this not a thread pool?
[ ] Is inherited value immutable/copy-safe?
[ ] Is security context not accidentally inherited?
[ ] Is cleanup defined?
```

---

## 35. Thought Exercises

### Exercise 1 — Request context leak

You find this code:

```java
static final ThreadLocal<User> CURRENT_USER = new ThreadLocal<>();

void handle(Request request) {
    User user = authenticate(request);
    CURRENT_USER.set(user);

    service.process(request);
}
```

Questions:

1. What happens if `service.process` throws?
2. What happens on a fixed thread pool?
3. What is the worst security impact?
4. How would you redesign it?

Expected direction:

```java
void handle(Request request) {
    User user = authenticate(request);
    try (var ignored = UserContext.bind(user)) {
        service.process(request);
    }
}
```

---

### Exercise 2 — InheritableThreadLocal in executor

You see:

```java
static final InheritableThreadLocal<String> TENANT = new InheritableThreadLocal<>();

void submit(String tenant, Runnable task) {
    TENANT.set(tenant);
    executor.submit(task);
}
```

Questions:

1. Why might this fail?
2. When is the value inherited?
3. What happens with worker thread reuse?
4. What would explicit propagation look like?

---

### Exercise 3 — Virtual thread and large ThreadLocal

```java
static final ThreadLocal<byte[]> BUFFER =
    ThreadLocal.withInitial(() -> new byte[1024 * 1024]);
```

Then a virtual-thread-per-request server handles 100,000 concurrent requests.

Questions:

1. What is the memory risk?
2. Does virtual thread make this safe?
3. What alternatives exist?

---

### Exercise 4 — Context class loader plugin

```java
Thread.currentThread().setContextClassLoader(pluginLoader);
plugin.run();
```

Questions:

1. What happens if `plugin.run()` throws?
2. What might leak?
3. How should this be wrapped?

---

## 36. Ringkasan

`Thread` adalah bagian dari `java.lang` yang menghubungkan Java code dengan runtime execution. Ia bukan hanya primitive concurrency, tetapi juga membawa identitas operasional: name, daemon status, interrupt signal, state, context class loader, dan failure handler.

`ThreadLocal` adalah mekanisme powerful untuk state per-thread, tetapi harus dipahami sebagai hidden parameter. Ia cocok untuk infrastructure context yang lifecycle-nya jelas, bukan untuk business input utama. Dalam sistem production, `ThreadLocal` tanpa cleanup adalah sumber bug security, tenant isolation, audit, memory leak, dan observability corruption.

`InheritableThreadLocal` lebih berbahaya lagi karena inheritance terjadi saat thread dibuat, bukan saat task dikirim. Dengan thread pool, ini sering tidak sesuai intuisi. Untuk security/tenant/request context, explicit propagation biasanya lebih aman.

`ThreadGroup` adalah legacy API. Pahami untuk compatibility, tetapi jangan jadikan fondasi desain modern.

Mental model paling penting:

```text
Thread = execution carrier
Thread name = observability label
Interrupt = cooperative cancellation signal
ContextClassLoader = dynamic loading boundary
ThreadLocal = hidden per-thread parameter
InheritableThreadLocal = creation-time inherited hidden parameter
ThreadGroup = legacy grouping model
```

Jika bisa menjaga lifecycle, cleanup, propagation, dan observability dengan disiplin, penggunaan `java.lang.Thread*` bisa menjadi alat runtime yang kuat. Jika tidak, ia menjadi sumber bug paling sulit dilacak karena state-nya tersembunyi di balik current thread.

---

## 37. Referensi Resmi dan Lanjutan

- Java SE 25 API — `java.lang.Thread`
- Java SE 25 API — `java.lang.ThreadLocal`
- Java SE 25 API — `java.lang.InheritableThreadLocal`
- Java SE 25 API — `java.lang.ThreadGroup`
- Java SE 8 API — `java.lang.Thread`
- OpenJDK JEP 444 — Virtual Threads
- OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning
- Java Language Specification — Threads and Locks
- Java Virtual Machine Specification — runtime execution model

---

## 38. Status Seri

Progress:

```text
Part 15 dari 32 selesai.
```

Seri belum selesai.

Part berikutnya:

```text
Part 16 — StackTraceElement, StackWalker, Caller Sensitivity, and Observability
File: 16-stacktraceelement-stackwalker-caller-sensitive-observability.md
```
