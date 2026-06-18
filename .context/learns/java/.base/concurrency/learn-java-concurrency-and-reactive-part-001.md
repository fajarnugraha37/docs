# learn-java-concurrency-and-reactive-part-001.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 001  
# OS Threads, JVM Threads, Scheduling, Context Switching, and Blocking

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **001**  
> Fokus: memahami fondasi thread dari bawah: OS thread, JVM thread, platform thread, virtual thread, scheduler, context switch, stack, blocking, runnable/waiting/blocked states, CPU core, time slicing, dan kenapa model thread menentukan scalability aplikasi Java. Bagian ini menjadi pondasi sebelum masuk ke `Thread`, executors, virtual threads, structured concurrency, dan reactive programming.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Harus Memahami OS Thread](#2-kenapa-harus-memahami-os-thread)
3. [Process vs Thread](#3-process-vs-thread)
4. [Apa Itu OS Thread](#4-apa-itu-os-thread)
5. [Apa Itu JVM Thread](#5-apa-itu-jvm-thread)
6. [Platform Thread di Java](#6-platform-thread-di-java)
7. [Virtual Thread sebagai JVM-Managed Thread](#7-virtual-thread-sebagai-jvm-managed-thread)
8. [Carrier Thread](#8-carrier-thread)
9. [Thread Stack](#9-thread-stack)
10. [Program Counter, Registers, and Execution Context](#10-program-counter-registers-and-execution-context)
11. [CPU Core and Hardware Parallelism](#11-cpu-core-and-hardware-parallelism)
12. [OS Scheduler](#12-os-scheduler)
13. [Time Slicing](#13-time-slicing)
14. [Context Switching](#14-context-switching)
15. [Thread States: Conceptual vs Java States](#15-thread-states-conceptual-vs-java-states)
16. [Runnable Is Not Always Running](#16-runnable-is-not-always-running)
17. [Blocking](#17-blocking)
18. [Blocking I/O](#18-blocking-io)
19. [Blocking on Locks](#19-blocking-on-locks)
20. [Waiting, Sleeping, Parking](#20-waiting-sleeping-parking)
21. [Kernel Mode vs User Mode Overview](#21-kernel-mode-vs-user-mode-overview)
22. [Why Platform Threads Are Expensive](#22-why-platform-threads-are-expensive)
23. [Why Virtual Threads Are Lightweight](#23-why-virtual-threads-are-lightweight)
24. [Mounting and Unmounting Virtual Threads](#24-mounting-and-unmounting-virtual-threads)
25. [Pinning Overview](#25-pinning-overview)
26. [Thread-per-Request Scalability Revisited](#26-thread-per-request-scalability-revisited)
27. [CPU-Bound vs I/O-Bound from Scheduler Perspective](#27-cpu-bound-vs-io-bound-from-scheduler-perspective)
28. [Little’s Law Intuition for Threads](#28-littles-law-intuition-for-threads)
29. [What Happens When You Create Too Many Threads](#29-what-happens-when-you-create-too-many-threads)
30. [Diagnostics: What to Look at First](#30-diagnostics-what-to-look-at-first)
31. [Production Failure Modes](#31-production-failure-modes)
32. [Best Practices](#32-best-practices)
33. [Decision Matrix](#33-decision-matrix)
34. [Latihan](#34-latihan)
35. [Ringkasan](#35-ringkasan)
36. [Referensi](#36-referensi)

---

# 1. Tujuan Bagian Ini

Sebelum belajar API Java concurrency, kita harus memahami apa yang sebenarnya terjadi saat Java menjalankan banyak pekerjaan.

Kita sering menulis:

```java
new Thread(() -> doWork()).start();
```

atau:

```java
executor.submit(() -> callDatabase());
```

atau:

```java
Thread.ofVirtual().start(() -> callRemoteService());
```

Tetapi pertanyaan pentingnya:

```text
Siapa yang menjalankan kode itu?
Apakah benar-benar berjalan bersamaan?
Apa yang terjadi saat thread menunggu DB?
Apa yang terjadi saat thread menunggu lock?
Kenapa 100 thread masih masuk akal, tetapi 100.000 platform threads tidak?
Kenapa 100.000 virtual threads bisa masuk akal untuk I/O-bound work?
Kenapa virtual threads tidak otomatis membuat CPU-bound work lebih cepat?
```

Bagian ini menjawab dari pondasi:

- process;
- OS thread;
- JVM thread;
- platform thread;
- virtual thread;
- carrier thread;
- scheduler;
- stack;
- context switch;
- blocking;
- thread states;
- resource bottleneck.

Tujuan akhirnya:

```text
Kamu bisa membaca gejala production seperti thread pool penuh,
latency naik, CPU rendah tapi request lambat, DB pool habis,
atau virtual thread pinning dengan mental model yang benar.
```

---

# 2. Kenapa Harus Memahami OS Thread

Java developer bisa produktif tanpa tahu detail OS thread. Tetapi untuk menjadi engineer top-tier, kita perlu memahami “di bawah kap mesin”.

Alasannya:

## 2.1 Thread bukan abstraction gratis

Setiap thread membutuhkan:

- stack memory;
- scheduler bookkeeping;
- context switch cost;
- kernel/user coordination;
- CPU time;
- synchronization overhead.

## 2.2 Bottleneck sering bukan Java syntax

Masalah production sering terlihat sebagai:

```text
endpoint lambat
request timeout
thread pool full
CPU rendah
DB pool full
memory naik
GC sering
```

Akar masalah bisa:

- terlalu banyak platform threads;
- terlalu banyak blocking tasks;
- queue tanpa batas;
- lock contention;
- deadlock;
- OS context switch tinggi;
- DB connection pool starvation;
- virtual thread pinning;
- carrier thread bottleneck;
- blocking call di event loop.

## 2.3 Virtual threads membuat OS/JVM distinction makin penting

Dengan platform thread:

```text
Java Thread ~ OS Thread
```

Dengan virtual thread:

```text
Java Thread != always OS Thread
Virtual Thread runs on Carrier Platform Thread
```

Kalau mental model kita masih “satu Java thread = satu OS thread”, kita akan salah memahami Java modern.

## 2.4 Main rule

```text
To reason about Java concurrency performance,
separate Java-level task/thread from OS-level execution resource.
```

---

# 3. Process vs Thread

## 3.1 Process

Process adalah program yang sedang berjalan dengan resource sendiri.

Contoh:

```text
java -jar app.jar
```

OS membuat process untuk JVM.

Process punya:

- address space;
- heap;
- code segment;
- file descriptors;
- environment;
- process ID;
- threads.

## 3.2 Thread

Thread adalah execution path di dalam process.

Satu process bisa punya banyak thread.

Threads dalam process berbagi:

- heap;
- loaded classes;
- file descriptors;
- static fields;
- native resources.

Tetapi setiap thread punya execution context sendiri:

- stack;
- program counter;
- register state;
- thread-local state.

## 3.3 JVM process

Saat menjalankan Java app:

```text
OS process = JVM process
Inside JVM = many Java threads
```

Beberapa thread dibuat oleh aplikasi. Banyak juga dibuat JVM:

- GC threads;
- JIT compiler threads;
- signal dispatcher;
- reference handler;
- finalizer/cleaner;
- common pool workers;
- virtual thread scheduler carriers.

## 3.4 Main rule

```text
A Java application is one OS process containing many execution paths.
Those execution paths can be platform threads or virtual threads.
```

---

# 4. Apa Itu OS Thread

OS thread adalah unit scheduling yang dikenal oleh operating system.

OS scheduler memutuskan:

```text
thread mana berjalan
di CPU core mana
berapa lama
kapan preempt
kapan resume
```

## 4.1 OS thread memiliki stack

Stack menyimpan:

- method call frames;
- local variables;
- return addresses;
- partial execution state.

## 4.2 OS thread memiliki register context

Saat thread berhenti sementara, OS harus menyimpan register state agar nanti bisa dilanjutkan.

## 4.3 OS thread bisa blocked

Thread bisa blocked karena:

- menunggu I/O;
- menunggu lock;
- sleep;
- wait;
- park;
- syscall;
- page fault;
- resource unavailable.

## 4.4 OS thread adalah resource mahal

Tidak semahal process, tetapi tetap mahal.

Jika jumlah OS thread terlalu banyak:

- memory stack besar;
- scheduling overhead naik;
- context switching naik;
- CPU cache locality buruk;
- latency unpredictable;
- OS limit bisa tercapai.

## 4.5 Main rule

```text
OS threads are scarce relative to tasks.
Do not model every possible waiting task as a platform thread unless the scale is controlled.
```

---

# 5. Apa Itu JVM Thread

Di Java, `java.lang.Thread` merepresentasikan thread Java.

Tetapi sejak virtual threads, `Thread` bisa berarti:

- platform thread;
- virtual thread.

Java API tetap sama secara konsep:

```java
Thread current = Thread.currentThread();
```

Tetapi execution model berbeda.

## 5.1 Platform Java thread

Platform thread adalah Java `Thread` yang berjalan di OS thread.

## 5.2 Virtual Java thread

Virtual thread adalah Java `Thread` yang dijadwalkan oleh JVM dan dijalankan di atas carrier platform thread.

## 5.3 Kenapa API sama?

Supaya programmer tetap bisa memakai model thread Java:

- stack trace;
- interrupt;
- join;
- thread name;
- debugging;
- exception handling.

Tetapi implementation lebih ringan untuk virtual threads.

## 5.4 Main rule

```text
In modern Java, Thread is an API abstraction.
Its execution backing can be platform-managed or JVM-managed.
```

---

# 6. Platform Thread di Java

Platform thread adalah thin wrapper di atas OS thread.

Oracle Java documentation menjelaskan bahwa platform thread menjalankan Java code pada OS thread underlying-nya dan menangkap OS thread tersebut selama lifetime platform thread. Artinya, jumlah platform thread dibatasi oleh jumlah OS thread yang tersedia dan biaya OS thread.  

## 6.1 Platform thread creation

```java
Thread thread = Thread.ofPlatform()
    .name("platform-worker")
    .start(() -> {
        System.out.println(Thread.currentThread());
    });

thread.join();
```

Atau classic:

```java
Thread thread = new Thread(() -> doWork());
thread.start();
```

## 6.2 Platform thread lifetime

Selama hidupnya:

```text
Java platform thread owns one OS thread
```

Jika platform thread blocking:

```text
OS thread ikut blocked
```

## 6.3 Platform thread cocok untuk

- bounded worker pools;
- CPU-bound tasks;
- app server worker threads;
- event loop threads;
- scheduled background workers;
- native integration tertentu;
- long-running service threads.

## 6.4 Platform thread tidak cocok untuk

- jutaan waiting tasks;
- one platform thread per socket at massive scale;
- unbounded blocking fan-out;
- unbounded background jobs.

## 6.5 Main rule

```text
Platform threads are expensive enough that their number must be bounded and observed.
```

---

# 7. Virtual Thread sebagai JVM-Managed Thread

Virtual thread adalah thread Java yang ringan dan dijadwalkan oleh Java runtime, bukan langsung oleh OS sebagai satu OS thread per Java thread.

JEP 444 memperkenalkan virtual threads sebagai fitur final di Java 21 untuk memudahkan penulisan, pemeliharaan, dan observability aplikasi concurrent throughput tinggi.

## 7.1 Virtual thread creation

```java
Thread thread = Thread.ofVirtual()
    .name("virtual-worker")
    .start(() -> {
        System.out.println(Thread.currentThread());
    });

thread.join();
```

Executor:

```java
try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
    var future = executor.submit(() -> callRemoteService());
    String result = future.get();
}
```

## 7.2 Virtual thread is still a Thread

Virtual thread mendukung banyak operasi thread biasa:

- `Thread.currentThread`;
- `join`;
- interrupt;
- stack trace;
- uncaught exception handling;
- thread name.

## 7.3 Core difference

Platform thread:

```text
Java Thread owns OS thread for whole lifetime
```

Virtual thread:

```text
Java Thread is scheduled by JVM on carrier platform threads
```

## 7.4 Main rule

```text
Virtual threads are real Java threads, but not permanent OS threads.
```

---

# 8. Carrier Thread

Carrier thread adalah platform thread yang menjalankan virtual thread.

Mental model:

```text
VirtualThread A mounted on Carrier-1
VirtualThread A blocks on I/O
VirtualThread A unmounted
Carrier-1 runs VirtualThread B
```

## 8.1 Why carriers matter

Virtual threads do not run without platform threads. CPU still executes platform threads.

Virtual threads allow many waiting tasks to share fewer carrier threads.

## 8.2 Carrier is not your business thread

You should not rely on virtual thread staying on same carrier.

Virtual thread may resume on different carrier.

## 8.3 ThreadLocal implication

ThreadLocal belongs to Java thread abstraction, not carrier directly.

But large ThreadLocal usage on many virtual threads can create huge memory overhead.

## 8.4 Main rule

```text
Carrier threads are execution vehicles for virtual threads.
Do not design application logic around carrier identity.
```

---

# 9. Thread Stack

Stack represents nested method calls.

Example:

```java
controller()
  -> service()
      -> repository()
          -> jdbcCall()
```

Each call creates stack frame.

## 9.1 Platform thread stack

Platform thread stack is generally OS-managed memory. It has configured size, often much larger than what many tasks actually need.

If you create many platform threads, stack reservation becomes a big issue.

## 9.2 Virtual thread stack

Virtual thread stack is managed by JVM and can grow/shrink more flexibly. When unmounted, continuation state can be stored without occupying carrier stack the same way a blocked platform thread occupies OS thread stack.

## 9.3 Stack trace advantage

Compared with callback-heavy async code, virtual threads preserve natural stack traces.

This improves debugging.

## 9.4 Main rule

```text
Thread stack is part of the cost of concurrency.
Virtual threads reduce the cost of many mostly-waiting stacks.
```

---

# 10. Program Counter, Registers, and Execution Context

A running thread needs:

- current instruction location;
- CPU registers;
- stack pointer;
- local execution state.

When scheduler switches thread:

```text
save old thread context
load new thread context
resume
```

## 10.1 Why it matters

Context switching is not free.

Too many runnable platform threads can spend excessive time switching instead of doing useful work.

## 10.2 Virtual thread context

Virtual thread switching is managed by JVM when mount/unmount happens.

It is much cheaper for waiting I/O tasks than holding many blocked OS threads, but not free.

## 10.3 Main rule

```text
Every execution model has context management cost.
The goal is to minimize wasted context management relative to useful work.
```

---

# 11. CPU Core and Hardware Parallelism

A CPU core can execute instructions.

If machine has 8 cores, at a given instant, roughly 8 hardware execution slots are available, ignoring hyper-threading details.

If you have 100 runnable CPU-bound threads on 8 cores:

```text
only around 8 run at once
92 wait for CPU time
scheduler switches among them
```

## 11.1 More threads than cores

For CPU-bound work, more threads than cores does not create more CPU.

It can reduce throughput due to overhead.

## 11.2 I/O-bound exception

For I/O-bound work, many threads can make sense because most are waiting, not runnable.

## 11.3 Main rule

```text
Parallel CPU execution is limited by cores.
Concurrency level can exceed cores only when tasks spend significant time waiting.
```

---

# 12. OS Scheduler

OS scheduler decides which OS thread runs.

It considers:

- runnable threads;
- priority;
- time slice;
- blocking state;
- CPU affinity;
- fairness;
- system policy.

## 12.1 Java platform threads

Platform threads are scheduled by OS.

## 12.2 Java virtual threads

Virtual threads are scheduled by JVM onto carrier platform threads, and those carriers are scheduled by OS.

Two-level model:

```text
JVM scheduler: virtual thread -> carrier thread
OS scheduler: carrier thread -> CPU core
```

## 12.3 Main rule

```text
With virtual threads, Java introduces an additional scheduling layer above OS scheduling.
```

---

# 13. Time Slicing

If more runnable threads than CPU cores, scheduler gives each thread a time slice.

Example:

```text
Thread A runs for a bit
Thread B runs for a bit
Thread C runs for a bit
Thread A resumes
```

This creates illusion of simultaneous execution on one core.

## 13.1 Preemption

OS can pause a running thread even if it does not voluntarily yield.

## 13.2 Consequence

Any code can be interrupted between operations.

This matters for race conditions.

Example:

```java
counter++;
```

Thread can be preempted between read and write.

## 13.3 Main rule

```text
Never assume a multi-step operation is atomic just because it is one line of Java.
```

---

# 14. Context Switching

Context switch happens when CPU switches from one thread to another.

## 14.1 Cost components

- save/load registers;
- update scheduler state;
- CPU cache disruption;
- memory locality loss;
- kernel transitions in some cases.

## 14.2 When context switching increases

- too many runnable threads;
- lock contention;
- frequent blocking/unblocking;
- too many small tasks;
- thread pool oversubscription.

## 14.3 Why it hurts latency

A request may be ready to continue but waits for CPU scheduling.

## 14.4 Virtual threads

Virtual thread mount/unmount is not the same as OS thread context switch. It can be much cheaper for blocking waits, but carrier threads still use OS scheduling.

## 14.5 Main rule

```text
A high number of runnable CPU-bound threads causes context-switch overhead.
A high number of waiting virtual threads is usually less problematic.
```

---

# 15. Thread States: Conceptual vs Java States

Java `Thread.State` includes:

- `NEW`;
- `RUNNABLE`;
- `BLOCKED`;
- `WAITING`;
- `TIMED_WAITING`;
- `TERMINATED`.

## 15.1 NEW

Thread created but not started.

## 15.2 RUNNABLE

Thread is executing in JVM or ready to execute.

Important: RUNNABLE does not guarantee currently on CPU.

## 15.3 BLOCKED

Waiting to acquire monitor lock.

## 15.4 WAITING

Waiting indefinitely for another thread action.

Examples:

- `Object.wait`;
- `Thread.join`;
- `LockSupport.park`.

## 15.5 TIMED_WAITING

Waiting for bounded time.

Examples:

- `Thread.sleep`;
- timed `join`;
- timed wait;
- timed park.

## 15.6 TERMINATED

Finished execution.

## 15.7 OS states differ

OS has its own scheduling states. Java state is a JVM-level abstraction.

## 15.8 Main rule

```text
Java thread state is useful, but interpret it with JVM/OS context.
RUNNABLE is not always “using CPU right now”.
```

---

# 16. Runnable Is Not Always Running

This is a critical concept.

A thread in Java `RUNNABLE` state may be:

- actually running on CPU;
- ready to run, waiting for CPU;
- in native code;
- blocked in some OS-level operation represented as runnable by JVM/OS mapping.

## 16.1 Production implication

Thread dump showing many RUNNABLE threads does not automatically mean CPU saturated.

Check:

- CPU usage;
- thread stack traces;
- system calls;
- lock state;
- profiler output.

## 16.2 Main rule

```text
Thread state alone is not diagnosis.
Combine it with CPU, stack traces, locks, and resource metrics.
```

---

# 17. Blocking

Blocking means execution cannot proceed until something happens.

Examples:

```text
wait for DB result
wait for HTTP response
wait for file read
wait for lock
wait for queue item
wait for timer
wait for another thread
```

## 17.1 Platform thread blocking

If platform thread blocks, its OS thread is occupied.

## 17.2 Virtual thread blocking

If virtual thread blocks on supported operations, JVM can unmount it from carrier, freeing carrier.

## 17.3 Blocking is natural

Blocking code is not inherently bad.

The question:

```text
What resource is blocked?
How many can block?
Can they be cancelled?
Is there timeout?
```

## 17.4 Main rule

```text
Blocking is acceptable only when you understand what resource is occupied while waiting.
```

---

# 18. Blocking I/O

Blocking I/O examples:

```java
socket.read();
jdbcStatement.executeQuery();
fileInputStream.read();
httpClient.send(request, handler);
```

## 18.1 Platform thread cost

While waiting:

```text
platform thread + OS thread occupied
```

## 18.2 Virtual thread behavior

Virtual thread can usually unmount during blocking I/O, allowing carrier to run another virtual thread.

JEP 491 describes that virtual threads can be mounted and unmounted frequently and transparently, and that a virtual thread unmounts when performing blocking operations such as I/O; later it is mounted again to resume execution.

## 18.3 Resource still occupied

If waiting for DB query:

```text
DB connection is still occupied
query still running
transaction may hold locks
```

Virtual thread frees carrier thread, not DB resource.

## 18.4 Main rule

```text
Virtual threads reduce thread cost of blocking I/O,
but do not reduce external resource cost of blocking I/O.
```

---

# 19. Blocking on Locks

When thread tries to enter synchronized block and monitor is held:

```java
synchronized (lock) {
    // critical section
}
```

Other threads may become BLOCKED.

## 19.1 Lock contention

If many threads wait for same lock:

- throughput drops;
- latency increases;
- context switching may increase;
- virtual threads may be pinned/blocked depending lock/context and JDK behavior;
- critical section becomes bottleneck.

## 19.2 Lock granularity

Big lock:

```text
simple but low concurrency
```

Small locks:

```text
higher concurrency but harder correctness
```

## 19.3 Main rule

```text
Locks serialize execution.
A highly contended lock can erase the benefit of concurrency.
```

---

# 20. Waiting, Sleeping, Parking

## 20.1 Sleeping

```java
Thread.sleep(Duration.ofMillis(100));
```

Thread waits for time.

## 20.2 Waiting

```java
object.wait();
```

Thread waits for notification while releasing monitor.

## 20.3 Parking

Lower-level mechanism:

```java
LockSupport.park();
```

Used by many concurrency utilities.

## 20.4 Joining

```java
thread.join();
```

Current thread waits for another thread to finish.

## 20.5 Main rule

```text
Waiting is a coordination mechanism.
Every wait should have a reason, timeout, and wake-up/cancellation story.
```

---

# 21. Kernel Mode vs User Mode Overview

Modern OS separates:

- user mode: application code;
- kernel mode: OS privileged operations.

Some operations require kernel involvement:

- thread scheduling;
- blocking I/O;
- file descriptor operations;
- network system calls;
- futex/monitor parking.

## 21.1 Why it matters

Kernel transitions have overhead.

Non-blocking/event-loop systems can reduce some thread blocking overhead, but not all costs.

Virtual threads reduce need for many OS threads while preserving blocking style.

## 21.2 Main rule

```text
Concurrency performance is shaped by both JVM-level design and OS-level mechanics.
```

---

# 22. Why Platform Threads Are Expensive

Platform threads are expensive because:

## 22.1 OS stack

Each has stack reservation/commit behavior.

## 22.2 OS scheduler involvement

Each is scheduled by OS.

## 22.3 Context switching

Many runnable platform threads increase switch overhead.

## 22.4 Memory

Thousands of platform threads can consume significant memory.

## 22.5 Blocking cost

Blocked platform thread still occupies OS thread.

## 22.6 Practical limit

Actual limit depends on OS, JVM options, memory, stack size, and workload. But unbounded platform threads are not a production strategy.

## 22.7 Main rule

```text
Use platform threads as bounded execution resources, not one per arbitrary task at massive scale.
```

---

# 23. Why Virtual Threads Are Lightweight

Virtual threads are lightweight because they are managed by JVM and do not permanently own OS threads.

## 23.1 Many virtual threads

You can have many virtual threads because most waiting virtual threads do not occupy carrier threads.

## 23.2 Cheap blocking for I/O

When supported blocking operation happens, virtual thread can unmount.

## 23.3 Natural code

You can write direct blocking code instead of callback chains.

## 23.4 Still not free

Virtual threads still use memory and scheduling metadata.

Every virtual thread has:

- continuation state;
- stack chunks;
- Thread object;
- potential ThreadLocal data;
- captured context;
- application objects.

## 23.5 Main rule

```text
Virtual threads are lightweight, not weightless.
```

---

# 24. Mounting and Unmounting Virtual Threads

## 24.1 Mounting

A virtual thread is mounted when assigned to carrier and running.

```text
virtual thread -> carrier platform thread -> CPU
```

## 24.2 Unmounting

A virtual thread is unmounted when it cannot continue, typically due to supported blocking operation.

```text
virtual thread state stored
carrier freed
```

## 24.3 Resuming

When operation is ready:

```text
virtual thread scheduled again
mounted on carrier
continues
```

May resume on different carrier.

## 24.4 Why it matters

This is the reason blocking I/O with virtual threads can scale better than blocking I/O with platform thread per request.

## 24.5 Main rule

```text
Virtual thread scalability comes from unmounting during waits.
```

---

# 25. Pinning Overview

Pinning means virtual thread cannot unmount from carrier during a blocking operation.

If pinned and blocked:

```text
carrier platform thread is also stuck
```

## 25.1 Causes historically included

- blocking inside certain synchronized/native sections;
- foreign/native calls;
- certain monitor-related behavior depending on JDK version.

JEP 491 addresses synchronization of virtual threads without pinning, changing important behavior in newer Java versions, but pinning remains a concept engineers should understand because native/foreign or other situations can still matter.

## 25.2 Why pinning matters

If many virtual threads pin carriers:

- carrier pool saturated;
- virtual thread scalability drops;
- latency increases;
- looks like thread starvation.

## 25.3 Diagnostics

Look for:

- JFR virtual thread pinning events;
- thread dumps;
- long synchronized blocking regions;
- native calls;
- carrier utilization.

## 25.4 Main rule

```text
Virtual threads scale best when blocking operations can unmount.
Pinned blocking reduces them toward platform-thread-like behavior.
```

---

# 26. Thread-per-Request Scalability Revisited

## 26.1 Platform thread-per-request

If each request blocks on DB/HTTP:

```text
request count ≈ platform thread count
```

At high concurrency, thread pool saturates.

## 26.2 Virtual thread-per-request

```text
request count ≈ virtual thread count
carrier thread count remains much smaller
```

This can handle many more waiting requests.

## 26.3 Still limited by resource

If every request needs DB connection:

```text
max active DB queries ≈ DB pool size
```

Virtual threads let requests wait cheaply, but if too many wait:

- latency still grows;
- memory still used;
- timeouts still happen;
- DB may still be overloaded.

## 26.4 Main rule

```text
Virtual thread-per-request solves thread scarcity,
not end-to-end capacity planning.
```

---

# 27. CPU-Bound vs I/O-Bound from Scheduler Perspective

## 27.1 CPU-bound

Runnable most of the time.

Scheduler must share CPU.

Too many CPU-bound threads:

```text
context switch overhead
cache miss
lower throughput
```

## 27.2 I/O-bound

Waiting most of the time.

Concurrency can overlap waits.

Virtual threads excel when tasks are mostly waiting.

## 27.3 Mixed

Split:

- blocking I/O on virtual threads;
- CPU-heavy work on bounded CPU executor;
- external resource access guarded by semaphore/pool.

## 27.4 Main rule

```text
Virtual threads are for waiting concurrency.
CPU-bound work still needs bounded parallelism.
```

---

# 28. Little’s Law Intuition for Threads

Little’s Law:

```text
L = λ × W
```

Where:

- L = average number of items in system;
- λ = arrival rate;
- W = average time in system.

For services:

```text
concurrency ≈ throughput × latency
```

Example:

```text
1000 requests/sec
200 ms latency
concurrency ≈ 1000 × 0.2 = 200 active requests
```

If latency becomes 2s:

```text
1000 × 2 = 2000 active requests
```

This explains why downstream slowness explodes active concurrency.

## 28.1 Thread implication

With platform thread-per-request:

```text
active requests ≈ active platform threads
```

With virtual thread-per-request:

```text
active requests ≈ active virtual threads
```

Virtual threads handle larger L, but resource capacity still matters.

## 28.2 Main rule

```text
When latency rises, required concurrency rises.
Without backpressure, this can cascade into overload.
```

---

# 29. What Happens When You Create Too Many Threads

## 29.1 Too many platform threads

Symptoms:

- high memory;
- `OutOfMemoryError: unable to create native thread`;
- high context switching;
- degraded throughput;
- scheduler overhead;
- slow shutdown;
- harder diagnostics.

## 29.2 Too many virtual threads

Symptoms may differ:

- high heap from task objects/ThreadLocals/stacks;
- downstream pool starvation;
- too many queued waits;
- poor latency due to resource bottleneck;
- scheduler overhead if many runnable CPU-bound virtual threads;
- pinned carrier saturation.

## 29.3 Main rule

```text
Virtual threads raise the practical limit of concurrent waiting tasks,
but they do not remove the need for admission control.
```

---

# 30. Diagnostics: What to Look at First

When concurrency issue happens:

## 30.1 CPU usage

- high CPU: CPU-bound, spin, GC, context switch, serialization?
- low CPU but high latency: waiting on DB/HTTP/lock/queue?

## 30.2 Thread dump

Look for:

- many BLOCKED threads;
- waiting on same lock;
- thread pool worker stacks;
- DB calls;
- HTTP calls;
- parking;
- deadlock.

## 30.3 Executor metrics

- active threads;
- queue depth;
- completed tasks;
- rejected tasks.

## 30.4 DB pool metrics

- active;
- idle;
- pending/waiting;
- acquisition time.

## 30.5 Queue metrics

- depth;
- oldest item age;
- throughput.

## 30.6 JFR

Look for:

- thread park;
- monitor enter;
- virtual thread pinning;
- socket/file I/O;
- allocation;
- CPU hotspots.

## 30.7 Main rule

```text
First determine: running, waiting, blocked, queued, or resource-starved?
```

---

# 31. Production Failure Modes

## 31.1 Thread pool exhaustion

All worker threads blocked waiting for downstream.

## 31.2 DB connection starvation

Many threads/virtual threads wait for limited DB connections.

## 31.3 Lock contention

Many threads blocked on one monitor.

## 31.4 Context-switch storm

Too many runnable platform threads.

## 31.5 Native thread OOM

Too many platform threads.

## 31.6 Virtual thread memory pressure

Too many tasks/ThreadLocals/request contexts.

## 31.7 Carrier saturation due to pinning

Pinned virtual threads block carriers.

## 31.8 Blocking event loop

Reactive/non-blocking app blocks event loop thread.

## 31.9 Missing timeout

Threads wait forever.

## 31.10 Queue backlog

Producer faster than consumer.

---

# 32. Best Practices

## 32.1 Understand thread type

Know whether you are using platform or virtual threads.

## 32.2 Bound platform threads

Use fixed/bounded executors.

## 32.3 Guard external resources

Virtual threads still need DB/HTTP/semaphore limits.

## 32.4 Avoid long critical sections

Locks serialize and can cause contention.

## 32.5 Use timeouts

Every blocking external call should have timeout.

## 32.6 Observe queues and pools

No metrics, no confidence.

## 32.7 Use virtual threads for blocking I/O

Especially when code simplicity matters.

## 32.8 Use bounded CPU pools for CPU-bound work

Do not throw CPU-heavy unlimited tasks onto virtual threads.

## 32.9 Avoid ThreadLocal bloat

Especially with many virtual threads.

## 32.10 Diagnose with multiple signals

Thread dump + CPU + pool metrics + JFR.

---

# 33. Decision Matrix

| Situation | Platform Thread | Virtual Thread | Notes |
|---|---:|---:|---|
| Small number of long-running workers | Good | Usually unnecessary | Platform thread fine |
| CPU-bound computation | Good with bounded pool | Not ideal as unlimited tasks | Bound to CPU cores |
| Many blocking HTTP calls | Limited scalability | Good | Still use timeouts/bulkheads |
| Many JDBC calls | Thread-efficient | Good but DB pool limited | Guard connection pool |
| Event loop | Good | Not applicable | Must not block event loop |
| Millions of sleeping/waiting tasks | Bad | Possible with care | Watch memory/context |
| Native blocking call | Depends | May pin/limit | Diagnose |
| Synchronized hot lock | Contention problem | Still contention | Fix lock design |
| Request-per-task backend | Traditional but limited | Good fit | Java modern style |
| Reactive non-blocking pipeline | Event-loop platform threads | Usually not needed | Avoid blocking |

---

# 34. Latihan

## Latihan 1 — Explain Platform Thread

Jelaskan dengan kata-katamu sendiri:

```text
Kenapa platform thread dianggap wrapper atas OS thread?
```

## Latihan 2 — Runnable vs Running

Buat skenario di mana 100 Java threads berstatus RUNNABLE tetapi hanya 8 yang benar-benar berjalan.

## Latihan 3 — Diagnose Low CPU High Latency

Service latency tinggi, CPU rendah, thread dump banyak WAITING di DB pool. Apa dugaanmu?

## Latihan 4 — Virtual Thread Fit

Apakah virtual thread cocok untuk:

1. image resizing CPU-heavy;
2. 10.000 concurrent HTTP calls;
3. JDBC CRUD endpoint;
4. event loop Netty;
5. cryptographic hashing batch.

Jelaskan.

## Latihan 5 — Little’s Law

Jika service melayani 2000 rps dengan latency 250ms, berapa approximate concurrent requests?

## Latihan 6 — Blocking Resource

Untuk code berikut, resource apa yang occupied saat blocking?

```java
jdbcTemplate.query(...);
```

## Latihan 7 — Thread Dump Reading

Cari arti Java thread states:

- RUNNABLE;
- BLOCKED;
- WAITING;
- TIMED_WAITING.

Berikan contoh masing-masing.

## Latihan 8 — Too Many Threads

Sebutkan gejala terlalu banyak platform threads vs terlalu banyak virtual threads.

## Latihan 9 — Pinning Hypothesis

Apa gejala jika banyak virtual threads pinned pada carrier?

## Latihan 10 — Design Guard

Desain guard agar virtual-thread-per-request service tidak membanjiri DB pool.

---

# 35. Ringkasan

Bagian ini membangun fondasi OS/JVM thread.

Core lessons:

- Process berisi banyak thread.
- OS thread adalah unit scheduling OS.
- JVM thread adalah abstraction Java.
- Platform thread adalah Java thread yang membungkus OS thread.
- Virtual thread adalah Java thread ringan yang dijadwalkan JVM.
- Carrier thread menjalankan virtual threads.
- CPU core membatasi parallel execution.
- Scheduler memberi time slice dan melakukan context switch.
- Context switch tidak gratis.
- RUNNABLE tidak selalu berarti sedang berjalan di CPU.
- Blocking berarti task tidak bisa lanjut sampai event/resource tersedia.
- Platform thread blocking menahan OS thread.
- Virtual thread blocking bisa unmount pada operasi yang didukung.
- Virtual threads lightweight, bukan weightless.
- Pinning mengurangi manfaat virtual threads.
- Virtual threads membantu I/O-bound concurrency, bukan CPU-bound speedup.
- Resource eksternal seperti DB pool tetap bottleneck.
- Diagnosis concurrency harus melihat CPU, thread dump, pool metrics, queue metrics, DB metrics, dan JFR.

Main rule:

```text
A thread is not just a Java object.
It is an execution context interacting with scheduler, CPU, memory,
blocking operations, and external resource limits.
```

---

# 36. Referensi

1. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

2. Oracle Java SE 25 Guide — Virtual Threads  
   https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html

3. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

4. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

5. Java SE 25 — `Thread.State`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html

6. Java SE 25 — `Executors.newVirtualThreadPerTaskExecutor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Executors.html#newVirtualThreadPerTaskExecutor()

7. Java SE 25 — `LockSupport`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/LockSupport.html

8. Java SE 25 — `Thread.Builder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.Builder.html

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 000](./learn-java-concurrency-and-reactive-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 002](./learn-java-concurrency-and-reactive-part-002.md)
