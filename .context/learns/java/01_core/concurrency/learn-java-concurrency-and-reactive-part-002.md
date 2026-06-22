# learn-java-concurrency-and-reactive-part-002.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 002  
# Java Thread Fundamentals Deep Dive: Thread API, Lifecycle, Builder, Start vs Run, Join, Sleep, Interrupt, Daemon, Naming, Exception Handling, and Production Hygiene

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **002**  
> Fokus: memahami `java.lang.Thread` secara mendalam dari sudut Java modern: platform threads, virtual threads, lifecycle, builder API, `start()` vs `run()`, daemon/non-daemon, `join`, `sleep`, interrupt, thread state, naming, uncaught exception handler, priority, thread groups legacy, stop/suspend/resume deprecation, thread factory, dan hygiene production. Bagian ini tetap fokus pada fundamental Thread, belum membahas executor framework secara mendalam karena itu akan masuk part 004.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Thread sebagai Execution Context](#2-mental-model-thread-sebagai-execution-context)
3. [`Thread` di Java Modern](#3-thread-di-java-modern)
4. [Platform Thread vs Virtual Thread dari API `Thread`](#4-platform-thread-vs-virtual-thread-dari-api-thread)
5. [`Runnable` sebagai Unit Eksekusi](#5-runnable-sebagai-unit-eksekusi)
6. [`Thread.start()` vs `Thread.run()`](#6-threadstart-vs-threadrun)
7. [Thread Lifecycle](#7-thread-lifecycle)
8. [Java `Thread.State`](#8-java-threadstate)
9. [Creating Platform Threads](#9-creating-platform-threads)
10. [Creating Virtual Threads](#10-creating-virtual-threads)
11. [Thread Builder API](#11-thread-builder-api)
12. [Unstarted vs Started Threads](#12-unstarted-vs-started-threads)
13. [Thread Naming](#13-thread-naming)
14. [Daemon vs Non-Daemon Threads](#14-daemon-vs-non-daemon-threads)
15. [`join`: Waiting for Completion](#15-join-waiting-for-completion)
16. [`sleep`: Pausing Current Thread](#16-sleep-pausing-current-thread)
17. [Interrupt: Cooperative Cancellation Signal](#17-interrupt-cooperative-cancellation-signal)
18. [Interrupted Status](#18-interrupted-status)
19. [Handling `InterruptedException` Correctly](#19-handling-interruptedexception-correctly)
20. [Stopping Threads Safely](#20-stopping-threads-safely)
21. [Deprecated Thread Primitives: `stop`, `suspend`, `resume`](#21-deprecated-thread-primitives-stop-suspend-resume)
22. [Uncaught Exception Handler](#22-uncaught-exception-handler)
23. [Thread Priority](#23-thread-priority)
24. [Thread Identity and Current Thread](#24-thread-identity-and-current-thread)
25. [ThreadLocal Mention: Not Deep Dive Yet](#25-threadlocal-mention-not-deep-dive-yet)
26. [ThreadGroup: Legacy Awareness](#26-threadgroup-legacy-awareness)
27. [ThreadFactory](#27-threadfactory)
28. [Manual Threads vs Executors](#28-manual-threads-vs-executors)
29. [Manual Threads vs Virtual-Thread-per-Task Executor](#29-manual-threads-vs-virtual-thread-per-task-executor)
30. [Production Hygiene](#30-production-hygiene)
31. [Common Bugs](#31-common-bugs)
32. [Mini Case Study: Background Worker That Prevents Shutdown](#32-mini-case-study-background-worker-that-prevents-shutdown)
33. [Mini Case Study: Lost Interrupt Causing Slow Shutdown](#33-mini-case-study-lost-interrupt-causing-slow-shutdown)
34. [Mini Case Study: Uncaught Exception Silently Kills Worker](#34-mini-case-study-uncaught-exception-silently-kills-worker)
35. [Best Practices](#35-best-practices)
36. [Decision Matrix](#36-decision-matrix)
37. [Latihan](#37-latihan)
38. [Ringkasan](#38-ringkasan)
39. [Referensi](#39-referensi)

---

# 1. Tujuan Bagian Ini

Bagian sebelumnya membahas OS thread, JVM thread, scheduler, context switch, blocking, dan virtual thread secara konseptual.

Sekarang kita turun ke API utama Java:

```java
java.lang.Thread
```

Banyak engineer bisa memakai `Thread`, tetapi belum tentu memahami konsekuensi desainnya.

Contoh sederhana:

```java
Thread thread = new Thread(() -> doWork());
thread.start();
```

Pertanyaan yang harus bisa dijawab:

```text
Apa beda start() dan run()?
Kapan thread benar-benar selesai?
Apa arti join?
Apa bedanya sleep dan wait?
Apa yang terjadi kalau thread di-interrupt?
Apa itu interrupted status?
Kenapa InterruptedException tidak boleh ditelan?
Apa itu daemon thread?
Kenapa thread name penting?
Apa yang terjadi kalau Runnable melempar exception?
Kenapa Thread.stop berbahaya?
Kapan boleh membuat Thread manual?
Kapan harus memakai Executor?
Bagaimana virtual thread dibuat dengan API Thread?
```

Target bagian ini:

- memahami `Thread` sebagai execution context;
- memahami lifecycle thread;
- memahami API modern `Thread.Builder`;
- memahami platform vs virtual thread creation;
- memahami interrupt sebagai cooperative cancellation;
- memahami exception handling di thread;
- memahami production hygiene untuk thread manual;
- tahu kapan tidak membuat thread manual.

---

# 2. Mental Model: Thread sebagai Execution Context

Thread bukan sekadar object.

Thread adalah execution context yang menjalankan instruksi.

Dalam Java, thread menjalankan `Runnable`:

```java
Runnable task = () -> {
    System.out.println("Hello from " + Thread.currentThread());
};

Thread thread = new Thread(task);
thread.start();
```

Kita bisa memecah mental model:

```text
Runnable = apa yang dikerjakan
Thread   = konteks yang menjalankan
start()  = minta JVM menjadwalkan eksekusi
run()    = method task yang dieksekusi
```

## 2.1 Thread has lifetime

Thread tidak hidup selamanya.

```text
created -> started -> running/waiting/blocked -> terminated
```

## 2.2 Thread has identity

Thread punya:

- name;
- id/threadId;
- daemon flag;
- priority;
- state;
- uncaught exception handler;
- context class loader;
- ThreadLocal storage.

## 2.3 Thread is not automatically managed

Jika kamu membuat thread manual, kamu bertanggung jawab terhadap:

- naming;
- lifecycle;
- shutdown;
- exception handling;
- cancellation;
- resource cleanup;
- observability.

## 2.4 Main rule

```text
Creating a Thread means creating a lifecycle you must own.
```

---

# 3. `Thread` di Java Modern

Java SE 25 `Thread` adalah API untuk thread Java. Java Virtual Machine memungkinkan satu aplikasi memiliki beberapa thread of execution yang berjalan secara concurrent. Dokumentasi Java 25 juga mendefinisikan builder untuk membuat platform thread dan virtual thread.  

## 3.1 Thread implements Runnable?

`Thread` itself implements `Runnable`.

Tetapi dalam practice modern, lebih baik memisahkan:

```text
task = Runnable/Callable
execution = Thread/Executor
```

Bad design:

```java
class MyThread extends Thread {
    @Override
    public void run() {
        doWork();
    }
}
```

Better:

```java
Runnable task = this::doWork;
Thread thread = Thread.ofPlatform().start(task);
```

## 3.2 Why not extend Thread?

Karena inheritance menggabungkan dua concern:

- what work does;
- how work is executed.

Composition lebih fleksibel:

```java
Runnable task = new ImportJob(file);
Thread thread = Thread.ofVirtual().start(task);
```

Task yang sama bisa dijalankan:

- platform thread;
- virtual thread;
- executor;
- scheduled executor;
- tests.

## 3.3 Main rule

```text
Prefer passing Runnable/Callable to an execution mechanism over subclassing Thread.
```

---

# 4. Platform Thread vs Virtual Thread dari API `Thread`

Java modern punya builder:

```java
Thread.ofPlatform()
Thread.ofVirtual()
```

## 4.1 Platform thread

```java
Thread platformThread = Thread.ofPlatform()
    .name("platform-worker")
    .start(() -> doWork());
```

Platform thread biasanya mapped ke OS thread.

## 4.2 Virtual thread

```java
Thread virtualThread = Thread.ofVirtual()
    .name("virtual-worker")
    .start(() -> doWork());
```

Virtual thread adalah lightweight thread yang dijadwalkan oleh Java runtime.

## 4.3 Same Thread API, different execution cost

Keduanya adalah `Thread`.

Tetapi:

| Aspect | Platform Thread | Virtual Thread |
|---|---|---|
| Backing | OS thread | JVM scheduled over carrier threads |
| Cost | expensive | lightweight |
| Best for | bounded workers, CPU work | many blocking I/O tasks |
| Blocking | occupies OS thread | can unmount on supported blocking |
| Count | should be bounded | can be many, but still bounded by app/resource sanity |
| Pooling | common | usually no need to pool virtual threads |

## 4.4 Main rule

```text
Platform and virtual threads share much of the Java API,
but they have different scalability and resource models.
```

---

# 5. `Runnable` sebagai Unit Eksekusi

`Runnable` is simple:

```java
@FunctionalInterface
public interface Runnable {
    void run();
}
```

It returns nothing and cannot throw checked exceptions.

Example:

```java
Runnable task = () -> {
    System.out.println("Running");
};
```

## 5.1 Runnable limitations

- no result;
- no checked exception;
- exceptions become uncaught unless handled;
- cancellation must be designed separately.

If you need result:

```java
Callable<Result>
```

Usually used through executor:

```java
Future<Result> future = executor.submit(callable);
```

## 5.2 Runnable should be small and named

Bad:

```java
new Thread(() -> {
    // 300 lines of workflow
}).start();
```

Better:

```java
Runnable worker = new NotificationWorker(queue, sender, metrics);
Thread.ofPlatform()
    .name("notification-worker")
    .start(worker);
```

## 5.3 Main rule

```text
Runnable is the work. Thread is how the work runs.
Keep them conceptually separate.
```

---

# 6. `Thread.start()` vs `Thread.run()`

This is fundamental.

## 6.1 `start()`

`start()` asks JVM to start a new thread of execution.

```java
Thread thread = new Thread(() -> {
    System.out.println(Thread.currentThread().getName());
});

thread.start();
```

The task runs on new thread.

## 6.2 `run()`

`run()` is just an ordinary method call.

```java
thread.run();
```

The task runs on current thread.

## 6.3 Demonstration

```java
public class StartVsRunDemo {
    public static void main(String[] args) {
        Runnable task = () ->
            System.out.println("Running on " + Thread.currentThread().getName());

        Thread thread = new Thread(task, "worker");

        thread.run();   // runs on main
        thread.start(); // runs on worker
    }
}
```

Possible output:

```text
Running on main
Running on worker
```

## 6.4 Why this matters

Calling `run()` accidentally means no concurrency.

Tests may pass, but production behavior differs.

## 6.5 Main rule

```text
Use start() to create new execution.
Calling run() directly is just a normal method call.
```

---

# 7. Thread Lifecycle

Conceptual lifecycle:

```text
NEW
  -> STARTED/RUNNABLE
      -> RUNNING
      -> BLOCKED/WAITING/TIMED_WAITING
      -> RUNNABLE again
  -> TERMINATED
```

Java state model simplifies this.

## 7.1 Create

```java
Thread thread = Thread.ofPlatform().unstarted(task);
```

State: `NEW`.

## 7.2 Start

```java
thread.start();
```

JVM schedules it.

## 7.3 Execute

`run()` executes.

## 7.4 Block/wait

Thread may wait for:

- lock;
- I/O;
- sleep;
- join;
- park;
- condition;
- queue.

## 7.5 Terminate

Thread terminates when:

- `run()` completes normally;
- `run()` throws uncaught exception.

Java 25 `Thread` docs state a thread terminates if its `run` method completes normally or completes abruptly and the uncaught exception handling process occurs.  

## 7.6 Cannot restart

A terminated thread cannot be started again.

```java
thread.start();
thread.start(); // IllegalThreadStateException
```

## 7.7 Main rule

```text
A Thread object represents one execution lifetime.
It cannot be reused.
```

---

# 8. Java `Thread.State`

Java defines these states:

```java
Thread.State.NEW
Thread.State.RUNNABLE
Thread.State.BLOCKED
Thread.State.WAITING
Thread.State.TIMED_WAITING
Thread.State.TERMINATED
```

## 8.1 NEW

Created but not started.

## 8.2 RUNNABLE

Executing or ready to execute.

Important:

```text
RUNNABLE does not guarantee currently on CPU.
```

## 8.3 BLOCKED

Waiting to acquire monitor lock.

## 8.4 WAITING

Waiting indefinitely for another thread action.

Examples:

- `Object.wait()`;
- `Thread.join()`;
- `LockSupport.park()`.

## 8.5 TIMED_WAITING

Waiting with timeout.

Examples:

- `Thread.sleep`;
- timed `join`;
- timed `wait`;
- timed `park`.

## 8.6 TERMINATED

Execution finished.

## 8.7 State is diagnostic, not control API

Do not build fragile logic:

```java
if (thread.getState() == Thread.State.WAITING) {
    ...
}
```

Thread state can change immediately.

## 8.8 Main rule

```text
Thread.State is useful for observation and debugging,
not for precise synchronization logic.
```

---

# 9. Creating Platform Threads

Modern builder style:

```java
Thread thread = Thread.ofPlatform()
    .name("report-worker")
    .daemon(false)
    .start(() -> generateReport());
```

Unstarted:

```java
Thread thread = Thread.ofPlatform()
    .name("report-worker")
    .unstarted(() -> generateReport());

thread.start();
```

## 9.1 Classic constructor still exists

```java
Thread thread = new Thread(() -> generateReport(), "report-worker");
thread.start();
```

Builder is more explicit and consistent with virtual threads.

## 9.2 Thread factory

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("worker-", 0)
    .daemon(false)
    .factory();

Thread thread = factory.newThread(task);
thread.start();
```

Useful for executors.

## 9.3 Main rule

```text
For new code, prefer Thread.Builder or ThreadFactory over ad-hoc constructors.
```

---

# 10. Creating Virtual Threads

Direct:

```java
Thread thread = Thread.ofVirtual()
    .name("vt-task")
    .start(() -> callRemoteService());
```

Unstarted:

```java
Thread thread = Thread.ofVirtual()
    .name("vt-task")
    .unstarted(() -> callRemoteService());

thread.start();
```

Factory:

```java
ThreadFactory factory = Thread.ofVirtual()
    .name("vt-", 0)
    .factory();

Thread thread = factory.newThread(task);
thread.start();
```

Executor:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> result = executor.submit(() -> callRemoteService());
    System.out.println(result.get());
}
```

Java SE 25 `Executors` provides `newVirtualThreadPerTaskExecutor`, which creates an executor that starts a new virtual thread for each task.  

## 10.1 Should virtual threads be pooled?

Usually no.

Virtual threads are cheap and designed for thread-per-task.

Pooling virtual threads usually adds complexity without benefit.

Pool scarce resources instead:

- DB connections;
- HTTP connections;
- API quota;
- CPU-bound executor;
- semaphore for downstream.

## 10.2 Main rule

```text
Do not pool virtual threads to save threads.
Limit the resources that virtual-thread tasks consume.
```

---

# 11. Thread Builder API

Java 25 `Thread.Builder` creates threads or thread factories and can configure properties such as name and uncaught exception handler. `Thread.Builder.OfPlatform` also supports platform-specific settings such as daemon.  

## 11.1 Common methods

Conceptually:

```java
Thread.ofPlatform()
    .name("worker-", 0)
    .daemon(false)
    .uncaughtExceptionHandler(handler)
    .start(task);
```

```java
Thread.ofVirtual()
    .name("vt-", 0)
    .uncaughtExceptionHandler(handler)
    .start(task);
```

## 11.2 Name prefix with counter

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("email-worker-", 1)
    .factory();
```

Threads:

```text
email-worker-1
email-worker-2
email-worker-3
```

## 11.3 Builder advantage

- clear platform vs virtual;
- consistent naming;
- factory creation;
- exception handler setup;
- avoids constructor ambiguity.

## 11.4 Main rule

```text
Use builder API to make thread kind and configuration explicit.
```

---

# 12. Unstarted vs Started Threads

Builder supports:

```java
unstarted(task)
start(task)
```

## 12.1 `unstarted`

Creates thread object but does not start.

```java
Thread thread = Thread.ofVirtual()
    .name("prepare-then-start")
    .unstarted(task);

// configure/reference/pass somewhere

thread.start();
```

## 12.2 `start`

Creates and starts immediately.

```java
Thread thread = Thread.ofVirtual().start(task);
```

## 12.3 When unstarted is useful

- configure before start;
- store references;
- coordinate simultaneous start;
- tests;
- pass to code that starts later.

## 12.4 Risk

Creating many unstarted threads and never starting them is usually bad design.

## 12.5 Main rule

```text
Use unstarted only when you truly need control before scheduling.
```

---

# 13. Thread Naming

Thread names are not cosmetic.

Good names help:

- logs;
- thread dumps;
- JFR;
- debugging;
- incident response.

Bad:

```text
Thread-1
Thread-2
Thread-3
```

Good:

```text
payment-callback-1
case-export-worker-3
notification-sender-7
vt-case-fanout-1024
```

## 13.1 Naming platform workers

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("notification-worker-", 1)
    .factory();
```

## 13.2 Naming virtual threads

Virtual threads can be numerous, so use meaningful prefixes but avoid assuming every name is manually inspected.

```java
Thread.ofVirtual()
    .name("vt-case-query-", 0)
    .factory();
```

## 13.3 Include domain, not PII

Good:

```text
case-query-worker-12
```

Bad:

```text
user-fajar@example.com-thread
```

## 13.4 Main rule

```text
Thread names should identify responsibility, not sensitive data.
```

---

# 14. Daemon vs Non-Daemon Threads

Daemon flag affects JVM shutdown.

## 14.1 Non-daemon thread

JVM keeps running while non-daemon threads are alive.

## 14.2 Daemon thread

Daemon thread does not prevent JVM exit.

If only daemon threads remain, JVM may exit.

## 14.3 Example

```java
Thread daemon = Thread.ofPlatform()
    .daemon(true)
    .name("background-daemon")
    .start(() -> {
        while (true) {
            doBackgroundWork();
        }
    });
```

## 14.4 Use cases

Daemon can fit:

- background monitoring;
- best-effort cleanup;
- non-critical maintenance.

But be careful:

```text
daemon thread may be stopped abruptly when JVM exits
```

## 14.5 Virtual thread daemon status

Virtual threads are daemon threads. This means they do not keep JVM alive by themselves.

## 14.6 Main rule

```text
Use daemon only for work that does not need guaranteed completion.
```

---

# 15. `join`: Waiting for Completion

`join` makes current thread wait until target thread terminates.

```java
Thread worker = Thread.ofPlatform()
    .start(() -> doWork());

worker.join();
```

## 15.1 Why join matters

Without join, main thread may continue before worker finishes.

Example:

```java
Thread worker = Thread.ofVirtual().start(() -> System.out.println("Hello"));
worker.join();
```

Oracle virtual thread guide uses this pattern to wait for virtual thread completion in simple examples.  

## 15.2 Timed join

```java
worker.join(Duration.ofSeconds(2));
```

or older overloads.

## 15.3 Join can throw InterruptedException

```java
try {
    worker.join();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new RuntimeException("Interrupted while waiting for worker", e);
}
```

## 15.4 Join is not cancellation

`join` waits. It does not stop the worker.

## 15.5 Main rule

```text
join is coordination: wait for termination.
It is not a lifecycle management strategy by itself.
```

---

# 16. `sleep`: Pausing Current Thread

`sleep` pauses current thread for at least the given time, subject to scheduling.

```java
Thread.sleep(Duration.ofMillis(500));
```

## 16.1 Sleep does not release locks

Important:

```java
synchronized (lock) {
    Thread.sleep(1000); // lock still held
}
```

This can block other threads unnecessarily.

## 16.2 Sleep is not reliable coordination

Bad:

```java
Thread.sleep(1000);
assertTrue(done);
```

Better:

- latch;
- future;
- condition;
- awaitility-style wait;
- structured join.

## 16.3 Sleep responds to interrupt

If interrupted while sleeping, `InterruptedException` is thrown and interrupted status is cleared.

## 16.4 Main rule

```text
Use sleep for delay, not for robust synchronization.
```

---

# 17. Interrupt: Cooperative Cancellation Signal

Interrupt does not forcibly kill a thread.

It sends a signal:

```java
thread.interrupt();
```

The target thread must cooperate.

## 17.1 If target is blocked in interruptible method

Many blocking methods throw `InterruptedException`.

Examples:

- `Thread.sleep`;
- `Object.wait`;
- `Thread.join`;
- `BlockingQueue.take`;
- many concurrency utilities.

## 17.2 If target is running CPU code

Interrupt sets interrupted status.

Thread must check:

```java
while (!Thread.currentThread().isInterrupted()) {
    doChunk();
}
```

## 17.3 Example

```java
Thread worker = Thread.ofPlatform().start(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        doOneUnitOfWork();
    }
    cleanup();
});

worker.interrupt();
worker.join();
```

## 17.4 Main rule

```text
Interrupt is a cooperative cancellation mechanism,
not a forced termination mechanism.
```

---

# 18. Interrupted Status

Each thread has interrupted status.

## 18.1 `isInterrupted`

Checks status without clearing:

```java
boolean interrupted = thread.isInterrupted();
```

## 18.2 `Thread.interrupted`

Static method checks current thread and clears status:

```java
if (Thread.interrupted()) {
    // status is now cleared
}
```

Be careful.

## 18.3 InterruptedException clears status

When an interruptible blocking method throws `InterruptedException`, interrupted status is usually cleared.

Therefore if you cannot handle it fully, restore:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 18.4 Main rule

```text
If you catch InterruptedException and cannot complete cancellation there,
restore interrupt status.
```

---

# 19. Handling `InterruptedException` Correctly

Bad:

```java
try {
    Thread.sleep(1000);
} catch (InterruptedException e) {
    // ignore
}
```

This loses cancellation signal.

## 19.1 Good: propagate

```java
void runJob() throws InterruptedException {
    queue.take();
}
```

## 19.2 Good: restore and exit

```java
try {
    queue.take();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

## 19.3 Good: restore and wrap

```java
try {
    worker.join();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new JobCancelledException("Interrupted while waiting", e);
}
```

## 19.4 Bad: convert to RuntimeException without restoring

```java
catch (InterruptedException e) {
    throw new RuntimeException(e);
}
```

This may lose interrupt signal for outer layers.

## 19.5 Main rule

```text
InterruptedException means someone asked this thread to stop waiting.
Treat it as control flow, not noise.
```

---

# 20. Stopping Threads Safely

Safe stopping usually combines:

- interrupt;
- volatile/atomic stop flag;
- cooperative loop;
- closing blocking resources if interrupt not enough;
- timeout;
- join;
- cleanup.

## 20.1 Stop flag example

```java
final class Worker implements Runnable {
    private volatile boolean stop;

    void stop() {
        stop = true;
    }

    @Override
    public void run() {
        while (!stop && !Thread.currentThread().isInterrupted()) {
            doWork();
        }
        cleanup();
    }
}
```

## 20.2 Interrupt blocking operations

```java
Thread thread = Thread.ofPlatform().start(worker);

thread.interrupt();
thread.join(Duration.ofSeconds(5));
```

## 20.3 If blocking operation ignores interrupt

Sometimes close underlying resource.

Example:

```java
socket.close();
```

Oracle’s thread primitive deprecation note mentions that for a thread waiting on a known socket, closing the socket can cause the thread to return immediately, and no general technique works for all cases.  

## 20.4 Main rule

```text
Thread stopping is a protocol between requester and worker.
Design it explicitly.
```

---

# 21. Deprecated Thread Primitives: `stop`, `suspend`, `resume`

Old methods:

```java
thread.stop();
thread.suspend();
thread.resume();
```

are deprecated because they are unsafe.

## 21.1 Why `stop` is dangerous

It can kill thread while holding locks and leave objects in inconsistent state.

Example:

```text
thread updates account.debit
thread killed before account.credit
invariant broken
lock released
other threads see corrupted state
```

## 21.2 Why `suspend` is dangerous

It can suspend thread while holding lock, causing deadlock if resumer needs that lock.

## 21.3 What to use instead

- interrupt;
- cancellation flags;
- cooperative shutdown;
- executor shutdown;
- structured concurrency cancellation;
- resource close.

## 21.4 Main rule

```text
Never use stop/suspend/resume for normal application shutdown or cancellation.
```

---

# 22. Uncaught Exception Handler

If `Runnable.run()` throws an exception and nobody catches it, thread terminates.

Java’s `Thread.UncaughtExceptionHandler` is invoked when a thread is about to terminate due to uncaught exception; JVM queries the thread for its handler and invokes `uncaughtException(thread, throwable)`.  

## 22.1 Example

```java
Thread.UncaughtExceptionHandler handler = (thread, error) -> {
    System.err.println("Thread failed: " + thread.getName());
    error.printStackTrace();
};

Thread thread = Thread.ofPlatform()
    .name("worker")
    .uncaughtExceptionHandler(handler)
    .start(() -> {
        throw new RuntimeException("boom");
    });
```

## 22.2 Why important

Without handler:

- failure may only appear in stderr/log;
- worker silently dies;
- service stops processing queue;
- no alert.

## 22.3 For executors

Executor task exceptions are often captured in `Future`, not always uncaught handler.

This will be discussed later.

## 22.4 Main rule

```text
Every manually created long-lived thread needs an uncaught exception strategy.
```

---

# 23. Thread Priority

Java thread priority exists:

```java
thread.setPriority(Thread.NORM_PRIORITY);
```

Values:

```java
Thread.MIN_PRIORITY
Thread.NORM_PRIORITY
Thread.MAX_PRIORITY
```

## 23.1 Why avoid relying on it

Priority behavior depends on JVM/OS.

It is not a robust application-level scheduling tool.

## 23.2 Better alternatives

Use:

- separate executors;
- queues;
- rate limits;
- priority queues;
- backpressure;
- admission control.

## 23.3 Main rule

```text
Do not build correctness or important scheduling policy on Thread priority.
```

---

# 24. Thread Identity and Current Thread

Get current thread:

```java
Thread current = Thread.currentThread();
```

Useful for:

- logging;
- assertions;
- checking interrupt;
- debugging.

## 24.1 Thread name

```java
current.getName();
```

## 24.2 Is virtual?

Modern Java supports checking if thread is virtual:

```java
current.isVirtual();
```

## 24.3 Avoid logic based on thread identity

Bad:

```java
if (Thread.currentThread().getName().startsWith("http")) {
    ...
}
```

Use explicit context or configuration.

## 24.4 Main rule

```text
Thread identity is useful for diagnostics, not business logic.
```

---

# 25. ThreadLocal Mention: Not Deep Dive Yet

`ThreadLocal` stores data associated with current thread.

Example:

```java
static final ThreadLocal<String> CORRELATION_ID = new ThreadLocal<>();
```

This is common for:

- logging MDC;
- security context;
- tenant context;
- transaction context.

But ThreadLocal has risks:

- memory leak in pools;
- context leak between requests;
- high memory with many virtual threads;
- hidden dependencies.

We will deep dive in part 012.

## 25.1 Main rule

```text
ThreadLocal is part of thread identity and lifecycle.
Use with cleanup and caution.
```

---

# 26. ThreadGroup: Legacy Awareness

`ThreadGroup` exists historically to group threads.

But modern Java code rarely should rely on it for application design.

## 26.1 Why know it?

Uncaught exception fallback may involve thread group if no explicit handler is set.

Java docs for `Thread.UncaughtExceptionHandler` mention that if no handler is explicitly set, the thread’s `ThreadGroup` acts as handler.  

## 26.2 Better modern alternatives

- executors;
- thread factories;
- structured concurrency;
- explicit lifecycle objects;
- observability tools.

## 26.3 Main rule

```text
Know ThreadGroup exists, but do not use it as modern concurrency architecture.
```

---

# 27. ThreadFactory

`ThreadFactory` creates threads.

```java
ThreadFactory factory = Thread.ofPlatform()
    .name("job-worker-", 1)
    .daemon(false)
    .uncaughtExceptionHandler(handler)
    .factory();

Thread thread = factory.newThread(task);
thread.start();
```

## 27.1 Why ThreadFactory matters

Executors use thread factories.

Custom factory lets you control:

- name;
- daemon;
- priority;
- uncaught exception handler;
- platform vs virtual;
- context classloader if needed.

## 27.2 Virtual thread factory

```java
ThreadFactory virtualFactory = Thread.ofVirtual()
    .name("vt-worker-", 0)
    .factory();
```

## 27.3 Main rule

```text
ThreadFactory is the bridge between thread configuration and executor-managed execution.
```

---

# 28. Manual Threads vs Executors

Manual thread:

```java
Thread.ofPlatform().start(task);
```

Executor:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
executor.submit(task);
```

## 28.1 Manual thread okay for

- simple demo;
- one-off tool;
- dedicated long-lived thread with explicit lifecycle;
- very low-level infrastructure code.

## 28.2 Executor better for

- many tasks;
- pooling;
- lifecycle management;
- queueing;
- rejection;
- shutdown;
- metrics;
- result handling;
- scheduled execution.

## 28.3 Main rule

```text
If you are creating many threads or tasks, you probably need an Executor.
```

---

# 29. Manual Threads vs Virtual-Thread-per-Task Executor

Instead of:

```java
for (Task task : tasks) {
    Thread.ofVirtual().start(() -> process(task));
}
```

Prefer:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Task task : tasks) {
        executor.submit(() -> process(task));
    }
}
```

## 29.1 Why

- structured lifetime via try-with-resources;
- easier wait/shutdown;
- future result/exception handling;
- fewer ad-hoc references;
- cleaner ownership.

## 29.2 Still need resource guard

```java
Semaphore dbLimit = new Semaphore(50);
```

Virtual-thread-per-task executor does not limit downstream resource usage.

## 29.3 Main rule

```text
Virtual thread creation is cheap,
but task lifetime and resource pressure still need structure.
```

---

# 30. Production Hygiene

For every manually created thread, define:

## 30.1 Name

Meaningful and safe.

## 30.2 Daemon status

Should it keep JVM alive?

## 30.3 Exception handling

Uncaught handler or internal catch/report.

## 30.4 Cancellation

Interrupt? Stop flag? Resource close?

## 30.5 Shutdown

Who stops it? When? How long wait?

## 30.6 Resource cleanup

Close files/sockets/clients.

## 30.7 Observability

Logs, metrics, thread dump visibility.

## 30.8 Ownership

Which component owns thread lifecycle?

## 30.9 Main rule

```text
A production thread without lifecycle owner is a production leak.
```

---

# 31. Common Bugs

## 31.1 Calling `run()` instead of `start()`

No new thread.

## 31.2 Starting same thread twice

`IllegalThreadStateException`.

## 31.3 Swallowing InterruptedException

Shutdown/cancellation broken.

## 31.4 Non-daemon thread prevents JVM shutdown

Process hangs.

## 31.5 Daemon thread loses critical work

JVM exits before finishing.

## 31.6 No uncaught exception handler

Worker dies silently.

## 31.7 ThreadLocal not cleaned

Context/memory leak.

## 31.8 Creating unbounded platform threads

Native thread OOM.

## 31.9 Using sleep as synchronization

Flaky tests and race bugs.

## 31.10 Using Thread.stop

Data corruption.

---

# 32. Mini Case Study: Background Worker That Prevents Shutdown

## 32.1 Symptom

Application does not exit after main job completes.

## 32.2 Problem code

```java
Thread.ofPlatform()
    .name("metrics-pusher")
    .start(() -> {
        while (true) {
            pushMetrics();
            Thread.sleep(Duration.ofSeconds(10));
        }
    });
```

Non-daemon infinite thread keeps JVM alive.

## 32.3 Fix option 1: daemon if best-effort

```java
Thread.ofPlatform()
    .daemon(true)
    .name("metrics-pusher")
    .start(worker);
```

Only if safe to abandon.

## 32.4 Fix option 2: lifecycle stop

```java
final class MetricsPusher implements Runnable {
    private volatile boolean running = true;

    void stop() {
        running = false;
    }

    @Override
    public void run() {
        while (running && !Thread.currentThread().isInterrupted()) {
            pushMetrics();
            try {
                Thread.sleep(Duration.ofSeconds(10));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
```

## 32.5 Lesson

```text
Every long-lived thread needs shutdown protocol.
```

---

# 33. Mini Case Study: Lost Interrupt Causing Slow Shutdown

## 33.1 Symptom

Service shutdown takes 30 seconds or times out.

## 33.2 Problem code

```java
while (running) {
    try {
        Task task = queue.take();
        process(task);
    } catch (InterruptedException e) {
        // ignored
    }
}
```

## 33.3 Root cause

Interrupt signal swallowed. Thread continues waiting.

## 33.4 Fix

```java
while (running && !Thread.currentThread().isInterrupted()) {
    try {
        Task task = queue.take();
        process(task);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
cleanup();
```

## 33.5 Lesson

```text
InterruptedException is part of cancellation protocol.
Do not ignore it.
```

---

# 34. Mini Case Study: Uncaught Exception Silently Kills Worker

## 34.1 Symptom

Queue stops being processed. No obvious error in app health check.

## 34.2 Problem code

```java
Thread.ofPlatform()
    .name("email-worker")
    .start(() -> {
        while (true) {
            Email email = queue.take();
            sender.send(email); // throws RuntimeException
        }
    });
```

If `sender.send` throws unchecked exception, thread terminates.

## 34.3 Fix

Option 1: catch inside loop.

```java
while (!Thread.currentThread().isInterrupted()) {
    try {
        Email email = queue.take();
        sender.send(email);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    } catch (Exception e) {
        log.error("Email worker failed to process message", e);
        metrics.incrementFailure();
    }
}
```

Option 2: uncaught handler for fatal visibility.

```java
Thread.UncaughtExceptionHandler handler = (thread, error) ->
    log.error("Thread {} terminated unexpectedly", thread.getName(), error);
```

## 34.4 Lesson

```text
Long-lived workers should isolate per-item failures from worker lifecycle.
```

---

# 35. Best Practices

## 35.1 Prefer Runnable over extending Thread

Separate work from execution.

## 35.2 Use `start`, not `run`

Unless intentionally calling as normal method.

## 35.3 Name threads

Make diagnostics possible.

## 35.4 Do not start thread twice

Thread has one lifetime.

## 35.5 Use daemon carefully

Only for discardable background work.

## 35.6 Handle interrupts correctly

Restore status or propagate.

## 35.7 Avoid deprecated primitives

No `stop`, `suspend`, `resume`.

## 35.8 Use uncaught exception handlers

Especially manual long-lived threads.

## 35.9 Prefer executors for many tasks

Manual threads are low-level.

## 35.10 Prefer virtual-thread executor for many blocking tasks

But guard resources.

---

# 36. Decision Matrix

| Need | Recommended |
|---|---|
| One simple demo thread | `Thread.ofPlatform().start` |
| One dedicated background worker | Platform thread + lifecycle + handler |
| Many short blocking I/O tasks | Virtual-thread-per-task executor |
| Many CPU tasks | Bounded platform executor |
| Need scheduled periodic task | `ScheduledExecutorService` |
| Need result from task | `Callable` + Executor/Future |
| Need wait for one thread | `join` |
| Need cancellation | interrupt + cooperative logic |
| Need context propagation | explicit context / later ScopedValue |
| Need production task management | Executor/structured concurrency |
| Need many child tasks owned by one request | structured concurrency |
| Need non-blocking stream/backpressure | reactive model |

---

# 37. Latihan

## Latihan 1 — `start` vs `run`

Buat program yang mencetak nama thread saat memanggil `run()` dan `start()`.

## Latihan 2 — Thread Lifecycle

Buat thread unstarted, print state, start, join, print state akhir.

## Latihan 3 — Interrupt Sleep

Buat thread yang sleep 10 detik, interrupt dari main thread setelah 1 detik, handle `InterruptedException` dengan benar.

## Latihan 4 — Lost Interrupt

Perbaiki kode yang swallow `InterruptedException`.

## Latihan 5 — Daemon

Buat daemon thread dan non-daemon thread. Amati perbedaan JVM shutdown.

## Latihan 6 — Uncaught Exception Handler

Buat thread yang throw exception dan pasang handler yang mencetak thread name.

## Latihan 7 — Thread Factory

Buat ThreadFactory dengan prefix name dan daemon false.

## Latihan 8 — Virtual Thread

Buat 100 virtual threads yang sleep sebentar dan join semuanya.

## Latihan 9 — Stop Protocol

Desain worker dengan stop flag + interrupt.

## Latihan 10 — Manual vs Executor

Ambil kode manual thread loop dan refactor ke executor.

---

# 38. Ringkasan

Bagian ini membahas fundamental `Thread`.

Core lessons:

- `Thread` adalah execution context.
- `Runnable` adalah unit kerja.
- Prefer composition dengan Runnable daripada extend Thread.
- `start()` membuat execution baru; `run()` hanya method call biasa.
- Thread punya satu lifecycle dan tidak bisa di-restart.
- Java `Thread.State` berguna untuk diagnostics, bukan synchronization.
- Platform thread dan virtual thread berbagi API tetapi berbeda resource model.
- Builder API membuat thread creation eksplisit.
- Thread naming penting untuk observability.
- Daemon thread tidak menahan JVM hidup.
- Virtual threads adalah daemon.
- `join` menunggu thread selesai.
- `sleep` bukan synchronization.
- Interrupt adalah cooperative cancellation signal.
- `InterruptedException` tidak boleh ditelan.
- `stop/suspend/resume` deprecated dan berbahaya.
- Uncaught exception handler penting untuk manual threads.
- Thread priority bukan scheduling policy yang reliable.
- ThreadLocal perlu caution dan akan dibahas khusus.
- Manual thread harus punya owner, shutdown, cancellation, exception handling, dan metrics.
- Untuk banyak tasks, gunakan Executor.
- Untuk banyak blocking I/O tasks, virtual-thread-per-task executor sering lebih tepat.

Main rule:

```text
A Thread is a lifecycle-bearing execution context.
If you create it manually, you own its name, failure behavior,
cancellation, shutdown, and observability.
```

---

# 39. Referensi

1. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

2. Java SE 25 — `Thread.Builder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.Builder.html

3. Java SE 25 — `Thread.Builder.OfPlatform`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.Builder.OfPlatform.html

4. Java SE 25 — `Thread.UncaughtExceptionHandler`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.UncaughtExceptionHandler.html

5. Java SE 25 — `Thread.State`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html

6. Java SE 25 — `InterruptedException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/InterruptedException.html

7. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

8. Oracle Java SE Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

9. Java Thread Primitive Deprecation  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/doc-files/threadPrimitiveDeprecation.html

10. OpenJDK JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-concurrency-and-reactive-part-001.md">⬅️ Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 001</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-concurrency-and-reactive-part-003.md">Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 003 ➡️</a>
</div>
