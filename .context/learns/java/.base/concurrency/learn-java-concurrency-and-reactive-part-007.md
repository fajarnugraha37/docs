# learn-java-concurrency-and-reactive-part-007.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 007  
# Java Memory Model Fundamentals: Visibility, Ordering, Atomicity, Happens-Before, Safe Publication, Final Fields, Volatile, Synchronization, and Data Races

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **007**  
> Fokus: memahami **Java Memory Model (JMM)** sebagai fondasi correctness dalam concurrent Java. Bagian ini membahas kenapa race condition bisa terjadi, kenapa satu thread bisa tidak melihat perubahan thread lain, kenapa instruction reordering legal, apa itu happens-before, apa bedanya visibility/ordering/atomicity, bagaimana `volatile`, `synchronized`, `final`, `Thread.start`, `Thread.join`, concurrent utilities, dan safe publication membuat program concurrent menjadi benar.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Java Memory Model Penting](#2-kenapa-java-memory-model-penting)
3. [Mental Model Naif yang Salah](#3-mental-model-naif-yang-salah)
4. [CPU Cache, Compiler, JIT, and Reordering](#4-cpu-cache-compiler-jit-and-reordering)
5. [Visibility](#5-visibility)
6. [Ordering](#6-ordering)
7. [Atomicity](#7-atomicity)
8. [Race Condition vs Data Race](#8-race-condition-vs-data-race)
9. [Correctly Synchronized Program](#9-correctly-synchronized-program)
10. [Happens-Before: Konsep Utama](#10-happens-before-konsep-utama)
11. [Program Order Rule](#11-program-order-rule)
12. [Monitor Lock Rule](#12-monitor-lock-rule)
13. [Volatile Rule](#13-volatile-rule)
14. [Thread Start Rule](#14-thread-start-rule)
15. [Thread Join Rule](#15-thread-join-rule)
16. [Transitivity](#16-transitivity)
17. [Final Field Semantics](#17-final-field-semantics)
18. [Safe Publication](#18-safe-publication)
19. [Unsafe Publication](#19-unsafe-publication)
20. [Immutable Objects and JMM](#20-immutable-objects-and-jmm)
21. [Volatile as Visibility and Ordering, Not Mutual Exclusion](#21-volatile-as-visibility-and-ordering-not-mutual-exclusion)
22. [Synchronized as Mutual Exclusion and Visibility](#22-synchronized-as-mutual-exclusion-and-visibility)
23. [Atomic Variables and Memory Effects](#23-atomic-variables-and-memory-effects)
24. [Concurrent Utilities and Memory Consistency Effects](#24-concurrent-utilities-and-memory-consistency-effects)
25. [VarHandle Memory Modes Overview](#25-varhandle-memory-modes-overview)
26. [Double-Checked Locking](#26-double-checked-locking)
27. [Publication Through Static Initialization](#27-publication-through-static-initialization)
28. [Publication Through Executor and Queue](#28-publication-through-executor-and-queue)
29. [Publication Through CompletableFuture/Future](#29-publication-through-completablefuturefuture)
30. [Common Broken Patterns](#30-common-broken-patterns)
31. [How Bugs Appear in Production](#31-how-bugs-appear-in-production)
32. [Testing JMM Bugs](#32-testing-jmm-bugs)
33. [Design Guidelines](#33-design-guidelines)
34. [Mini Case Study: Stop Flag That Never Stops](#34-mini-case-study-stop-flag-that-never-stops)
35. [Mini Case Study: Partially Constructed Object Escape](#35-mini-case-study-partially-constructed-object-escape)
36. [Mini Case Study: Counter Lost Updates](#36-mini-case-study-counter-lost-updates)
37. [Best Practices](#37-best-practices)
38. [Decision Matrix](#38-decision-matrix)
39. [Latihan](#39-latihan)
40. [Ringkasan](#40-ringkasan)
41. [Referensi](#41-referensi)

---

# 1. Tujuan Bagian Ini

Concurrency correctness di Java tidak cukup hanya dengan:

```text
pakai thread pool
pakai virtual thread
pakai CompletableFuture
pakai ConcurrentHashMap
```

Masalah paling fundamental adalah:

```text
Ketika satu thread menulis data dan thread lain membaca data,
apakah pembaca pasti melihat nilai yang benar?
```

Jawaban singkat:

```text
Tidak, kecuali ada aturan memory visibility yang benar.
```

Java Memory Model menjawab:

- nilai apa yang boleh dilihat oleh sebuah read;
- kapan write oleh satu thread terlihat oleh thread lain;
- reordering apa yang legal;
- apa arti synchronization;
- apa jaminan `volatile`;
- apa jaminan `synchronized`;
- apa jaminan `final`;
- apa arti happens-before;
- apa itu data race;
- apa itu safe publication.

Tanpa JMM, kita akan mudah menulis kode seperti:

```java
class Worker {
    private boolean running = true;

    void stop() {
        running = false;
    }

    void run() {
        while (running) {
            doWork();
        }
    }
}
```

Kode ini terlihat benar, tetapi dalam concurrent Java, thread yang menjalankan loop belum tentu melihat update `running = false`.

Target bagian ini:

```text
Mampu menjelaskan dan mendesain visibility, ordering, atomicity,
safe publication, dan happens-before dalam kode Java production.
```

---

# 2. Kenapa Java Memory Model Penting

JMM penting karena modern execution tidak sesederhana:

```text
thread A write variable
thread B immediately sees it
```

Ada banyak layer:

- compiler;
- JIT optimizer;
- CPU cache;
- store buffer;
- register;
- instruction reordering;
- memory barriers;
- OS scheduler;
- JVM synchronization primitives.

Java ingin memberi programmer model yang portable di banyak CPU/OS.

Tanpa aturan JMM, kode concurrent akan bergantung pada:

- arsitektur CPU;
- versi JVM;
- level optimisasi JIT;
- timing;
- mode debug;
- load production.

## 2.1 Local success does not prove correctness

Kode bisa “selalu berhasil” di local karena:

- single CPU;
- low contention;
- no JIT warmup;
- debug logging mengubah timing;
- thread scheduling kebetulan;
- x86 memory model lebih kuat dari beberapa arsitektur lain;
- race jarang muncul.

## 2.2 Correctness harus berdasarkan happens-before

Bukan berdasarkan:

```text
sepertinya urut
di laptop saya aman
saya sudah sleep 1 detik
biasanya terlihat
```

## 2.3 Main rule

```text
Concurrent correctness in Java must be reasoned using happens-before,
not intuition about line order across threads.
```

---

# 3. Mental Model Naif yang Salah

Mental model salah:

```text
Semua thread langsung membaca dan menulis main memory yang sama,
dengan urutan sesuai source code.
```

Jika itu benar, kode ini aman:

```java
class Shared {
    int value;
    boolean ready;
}

Shared shared = new Shared();

// Thread A
shared.value = 42;
shared.ready = true;

// Thread B
if (shared.ready) {
    System.out.println(shared.value);
}
```

Kita berharap output:

```text
42
```

Tetapi tanpa synchronization, thread B secara teori bisa melihat:

```text
ready == true
value == 0
```

Kenapa?

Karena tidak ada happens-before dari write di Thread A ke read di Thread B.

## 3.1 Source order bukan global order

Urutan dalam satu thread berbeda dengan visibility antar thread.

## 3.2 Main rule

```text
Line order in one thread does not automatically become visibility order in another thread.
```

---

# 4. CPU Cache, Compiler, JIT, and Reordering

Java dan CPU melakukan optimisasi selama hasil single-threaded tetap terlihat benar.

## 4.1 Compiler/JIT optimization

JIT bisa:

- cache variable di register;
- eliminate redundant reads;
- reorder independent operations;
- inline methods;
- hoist reads out of loops;
- remove seemingly unused writes.

## 4.2 CPU effects

CPU bisa:

- use per-core cache;
- buffer writes;
- execute out of order;
- delay visibility to other cores.

## 4.3 Reordering example

Source:

```java
x = 1;
ready = true;
```

Compiler/CPU/JVM may reorder if no happens-before and if single-thread semantics unaffected.

Thread lain bisa observe effects in surprising order.

## 4.4 Synchronization prevents unsafe assumptions

`volatile`, `synchronized`, locks, atomics, and concurrent utilities introduce ordering/visibility constraints.

## 4.5 Main rule

```text
The JVM and CPU may reorder operations unless the memory model constrains them.
```

---

# 5. Visibility

Visibility means:

```text
When one thread writes, another thread can see that write.
```

## 5.1 Visibility problem

```java
class Flag {
    boolean done = false;
}

// Thread A
done = true;

// Thread B
while (!done) {
    // wait
}
```

Thread B may never observe `done = true`.

## 5.2 Fix with volatile

```java
class Flag {
    volatile boolean done = false;
}
```

Now write to `done` happens-before subsequent reads of `done`.

## 5.3 Fix with synchronized

```java
synchronized (lock) {
    done = true;
}

synchronized (lock) {
    if (done) ...
}
```

Unlock happens-before later lock on same monitor.

## 5.4 Main rule

```text
Visibility requires a synchronization mechanism.
```

---

# 6. Ordering

Ordering means:

```text
Operations appear in a particular order to other threads.
```

## 6.1 Intra-thread order

Within one thread, Java preserves behavior as if operations happen in program order for that thread.

But other threads may observe writes differently unless synchronized.

## 6.2 Happens-before order

Happens-before provides cross-thread ordering.

If:

```text
A happens-before B
```

then effects of A are visible to B and A is ordered before B.

## 6.3 Main rule

```text
Ordering across threads is established by happens-before, not by source-code adjacency.
```

---

# 7. Atomicity

Atomicity means operation appears indivisible.

## 7.1 Non-atomic compound operation

```java
counter++;
```

Conceptually:

```text
read counter
add 1
write counter
```

Multiple threads can interleave.

## 7.2 Fix options

```java
synchronized
AtomicInteger
LongAdder
locks
single-thread ownership
```

## 7.3 Volatile is not enough for increment

```java
volatile int counter;

counter++; // still not atomic
```

Volatile gives visibility/order for reads/writes, not atomicity for compound operations.

## 7.4 Main rule

```text
Visibility does not imply atomicity.
Volatile read/write is visible, but read-modify-write still needs atomicity.
```

---

# 8. Race Condition vs Data Race

## 8.1 Race condition

A bug where result depends on timing/interleaving.

Example:

```java
if (!exists(id)) {
    insert(id);
}
```

Two threads can both see not exists.

## 8.2 Data race

A specific memory-model issue:

```text
two threads access same variable,
at least one is write,
and there is no happens-before ordering.
```

## 8.3 All data races are dangerous

Data race means program is not correctly synchronized and may exhibit surprising behavior.

## 8.4 Race condition without data race

Possible with higher-level logic.

Example:

```java
synchronized methods individually safe,
but check-then-act across calls not atomic.
```

## 8.5 Main rule

```text
Data race is a memory-safety/correctness smell.
Race condition is a broader timing-dependent logic bug.
```

---

# 9. Correctly Synchronized Program

The Java Memory Model gives strong guarantees for correctly synchronized programs.

A program is correctly synchronized if all conflicting accesses are ordered by happens-before.

## 9.1 Conflicting accesses

Two accesses conflict if:

- same variable;
- at least one write.

## 9.2 Correctly synchronized means

Every read/write conflict is protected by synchronization.

## 9.3 Sequential consistency intuition

For correctly synchronized programs, behavior is much easier to reason about: it appears as if operations are interleaved in a sequentially consistent way.

## 9.4 Main rule

```text
Write data-race-free code.
Then the JMM becomes your ally instead of your enemy.
```

---

# 10. Happens-Before: Konsep Utama

Happens-before is the central relation in JMM.

If:

```text
A happens-before B
```

then:

1. actions before/at A are visible to B;
2. A is ordered before B in memory model.

## 10.1 Happens-before is not wall-clock time

A can happen-before B even if we are reasoning abstractly.

It is a formal ordering relationship.

## 10.2 No happens-before

If no happens-before, JVM may allow reads to observe older values or surprising order.

## 10.3 Main rule

```text
To prove visibility, prove happens-before.
```

---

# 11. Program Order Rule

Within a thread, each action happens-before every action later in that same thread.

Example:

```java
x = 1;
y = 2;
```

Within the same thread:

```text
x = 1 happens-before y = 2
```

## 11.1 But program order alone is intra-thread

It does not automatically publish to other threads.

## 11.2 Main rule

```text
Program order gives order inside one thread,
but cross-thread visibility requires synchronization edge.
```

---

# 12. Monitor Lock Rule

A monitor unlock happens-before every subsequent lock on the same monitor.

Example:

```java
synchronized (lock) {
    shared.value = 42;
}
```

Later:

```java
synchronized (lock) {
    System.out.println(shared.value);
}
```

If second synchronized block enters after first exits, it sees writes before unlock.

## 12.1 Same lock required

This does not work if different lock objects are used.

Bad:

```java
synchronized (lockA) {
    value = 42;
}

synchronized (lockB) {
    read(value);
}
```

## 12.2 Synchronized gives two things

- mutual exclusion;
- visibility/order.

## 12.3 Main rule

```text
Synchronize both writer and reader on the same monitor.
```

---

# 13. Volatile Rule

A write to a volatile field happens-before every subsequent read of that same field.

Example:

```java
class State {
    int value;
    volatile boolean ready;
}

// Thread A
state.value = 42;
state.ready = true;

// Thread B
if (state.ready) {
    System.out.println(state.value); // guaranteed to see 42
}
```

Why?

```text
value write program-order before volatile write
volatile write happens-before volatile read
volatile read program-order before value read
transitivity gives visibility
```

## 13.1 Volatile is a publication signal

Volatile flag can publish prior writes.

## 13.2 Volatile does not lock

Multiple threads can still execute simultaneously.

## 13.3 Main rule

```text
Volatile is good for visibility signals and simple state,
not compound invariants requiring mutual exclusion.
```

---

# 14. Thread Start Rule

A call to `Thread.start()` on a thread happens-before any actions in the started thread.

Example:

```java
Worker worker = new Worker();
worker.config = config;

Thread thread = new Thread(worker);
thread.start();
```

The started thread sees writes before `start`.

## 14.1 Why this matters

Safe initial setup before start is visible to new thread.

## 14.2 Main rule

```text
Initialize thread/task state before start/submit.
```

---

# 15. Thread Join Rule

All actions in a thread happen-before another thread successfully returns from `join` on that thread.

Example:

```java
ResultHolder holder = new ResultHolder();

Thread thread = Thread.ofPlatform().start(() -> {
    holder.result = "done";
});

thread.join();

System.out.println(holder.result); // visible
```

## 15.1 Main rule

```text
join publishes completed thread effects to the joining thread.
```

---

# 16. Transitivity

Happens-before is transitive.

If:

```text
A happens-before B
B happens-before C
```

Then:

```text
A happens-before C
```

## 16.1 Volatile publication example

```java
data = new Data();
ready = true; // volatile
```

Reader:

```java
if (ready) {
    use(data);
}
```

Happens-before chain:

```text
write data
  -> program order
write volatile ready
  -> volatile rule
read volatile ready
  -> program order
read data
```

## 16.2 Main rule

```text
Most JMM reasoning is building a happens-before chain.
```

---

# 17. Final Field Semantics

`final` fields have special initialization safety.

If object is constructed properly and `this` does not escape during construction, other threads that obtain reference to the object after construction are guaranteed to see correct values of final fields.

Example:

```java
final class UserSnapshot {
    private final String id;
    private final String name;

    UserSnapshot(String id, String name) {
        this.id = id;
        this.name = name;
    }
}
```

## 17.1 Final fields help immutability

Final fields:

- cannot be reassigned after constructor;
- improve safe sharing;
- get special JMM treatment.

## 17.2 But final does not make referenced object immutable

```java
final List<String> items;
```

The reference is final, but list can still mutate.

## 17.3 Do not let `this` escape

Bad:

```java
class Bad {
    final int value;

    Bad(EventBus bus) {
        bus.register(this); // this escapes
        value = 42;
    }
}
```

Another thread may observe partially constructed object.

## 17.4 Main rule

```text
Final fields are powerful for safe immutable objects,
but only if construction is safe and contained.
```

---

# 18. Safe Publication

Safe publication means other threads obtain object reference in a way that guarantees visibility of its initialized state.

## 18.1 Safe publication mechanisms

Common safe publication:

- static initialization;
- storing into volatile field;
- storing under lock and reading under same lock;
- placing into thread-safe collection/queue with documented memory consistency;
- completing a `Future`/`CompletableFuture`;
- starting a thread after initialization;
- joining a thread before reading its result;
- final fields for immutable construction safety.

## 18.2 Example with volatile

```java
class Holder {
    private volatile Config config;

    void reload() {
        config = new Config(...);
    }

    Config current() {
        return config;
    }
}
```

## 18.3 Example with synchronized

```java
synchronized void set(Config config) {
    this.config = config;
}

synchronized Config get() {
    return config;
}
```

## 18.4 Example with queue

```java
blockingQueue.put(task);
Task task = blockingQueue.take();
```

Concurrent utilities generally define memory consistency effects.

## 18.5 Main rule

```text
Publishing a reference safely is as important as constructing the object correctly.
```

---

# 19. Unsafe Publication

Unsafe publication means one thread makes object visible without happens-before.

Example:

```java
class Registry {
    static Config config;
}

// Thread A
Registry.config = new Config(...);

// Thread B
Config c = Registry.config;
```

No volatile, no lock, no safe publication.

## 19.1 Possible symptoms

Thread B may see:

- null;
- stale reference;
- partially visible fields;
- default values;
- inconsistent nested state.

## 19.2 Especially dangerous with mutable objects

```java
class Config {
    Map<String, String> values;
}
```

If map is mutable and not safely published, chaos.

## 19.3 Main rule

```text
Never publish shared mutable state through plain unsynchronized fields.
```

---

# 20. Immutable Objects and JMM

Immutability is the easiest concurrency strategy.

## 20.1 Immutable object requirements

- class final or effectively final;
- fields final;
- no `this` escape during construction;
- mutable inputs defensively copied;
- mutable outputs not exposed;
- referenced objects immutable or copied.

## 20.2 Example

```java
public final class AppConfig {
    private final Map<String, String> values;

    public AppConfig(Map<String, String> values) {
        this.values = Map.copyOf(values);
    }

    public String get(String key) {
        return values.get(key);
    }
}
```

## 20.3 Publication still matters

Final field semantics help, but publishing reference through safe mechanism is still best.

## 20.4 Main rule

```text
Immutability minimizes synchronization needs, but does not excuse sloppy publication.
```

---

# 21. Volatile as Visibility and Ordering, Not Mutual Exclusion

Volatile is great for simple state.

## 21.1 Stop flag

```java
class Worker implements Runnable {
    private volatile boolean running = true;

    void stop() {
        running = false;
    }

    @Override
    public void run() {
        while (running) {
            doWork();
        }
    }
}
```

## 21.2 Publication flag

```java
data = loadedData;
ready = true; // volatile
```

## 21.3 Not for compound invariants

Bad:

```java
volatile int count;

void increment() {
    count++;
}
```

## 21.4 Not for multiple fields invariant

Bad:

```java
volatile int lower;
volatile int upper;

// invariant lower <= upper
```

Need lock or immutable snapshot.

## 21.5 Main rule

```text
Use volatile for independent state visibility,
not multi-step updates or multi-field invariants.
```

---

# 22. Synchronized as Mutual Exclusion and Visibility

`synchronized` gives:

- only one thread in critical section per monitor;
- visibility through monitor enter/exit.

## 22.1 Protect invariant

```java
class Range {
    private int lower;
    private int upper;

    synchronized void setLower(int value) {
        if (value > upper) throw new IllegalArgumentException();
        lower = value;
    }

    synchronized void setUpper(int value) {
        if (value < lower) throw new IllegalArgumentException();
        upper = value;
    }

    synchronized boolean contains(int value) {
        return lower <= value && value <= upper;
    }
}
```

## 22.2 Same lock

All accesses to guarded state must use same lock.

## 22.3 Main rule

```text
Use synchronized when you need both mutual exclusion and visibility for shared mutable invariants.
```

---

# 23. Atomic Variables and Memory Effects

Atomic classes:

- `AtomicInteger`;
- `AtomicLong`;
- `AtomicReference`;
- `AtomicBoolean`;
- `LongAdder`;
- others.

## 23.1 Atomic read-modify-write

```java
AtomicInteger counter = new AtomicInteger();

counter.incrementAndGet();
```

Atomic increment.

## 23.2 Compare-and-set

```java
state.compareAndSet(expected, updated);
```

## 23.3 Visibility

Atomic classes provide memory effects comparable to volatile for their operations.

## 23.4 Main rule

```text
Atomics solve simple atomic state transitions,
not arbitrary compound object invariants.
```

---

# 24. Concurrent Utilities and Memory Consistency Effects

The `java.util.concurrent` package documents memory consistency effects. Java SE 25 package docs state, among other rules, that actions in a thread before placing an object into a concurrent collection happen-before actions after access/removal of that element in another thread; submitting a `Runnable` to an `Executor` happens-before its execution begins; actions taken by asynchronous computation happen-before actions following `Future.get`; and releasing/acquiring synchronizers like `Semaphore`, `CountDownLatch`, or `CyclicBarrier` have defined memory consistency effects.

## 24.1 Executor submission

```java
command.field = 42;
executor.submit(command);
```

Actions before submission happen-before task execution.

## 24.2 Future get

```java
Future<Result> future = executor.submit(task);
Result result = future.get();
```

Task actions happen-before successful `get` returns.

## 24.3 BlockingQueue

Producer actions before `put` happen-before consumer actions after `take`.

## 24.4 Main rule

```text
Use high-level concurrency utilities.
They encode happens-before edges for common patterns.
```

---

# 25. VarHandle Memory Modes Overview

`VarHandle` provides access modes with different memory ordering effects.

Java SE 25 `VarHandle` docs describe it as a typed reference to variables supporting access modes such as plain read/write, volatile read/write, and compare-and-set.

## 25.1 Why it exists

VarHandle is lower-level than ordinary fields/atomics.

Useful for:

- library/framework internals;
- high-performance concurrent structures;
- off-heap/memory segment access;
- custom atomic algorithms.

## 25.2 Access mode categories

Conceptually:

- plain;
- opaque;
- acquire/release;
- volatile;
- compare-and-set;
- atomic get-and-update.

## 25.3 Application code caution

Most application code should prefer:

- `volatile`;
- locks;
- atomics;
- concurrent utilities;
- immutable design.

## 25.4 Main rule

```text
VarHandle is powerful but low-level.
Use it when you can reason precisely about memory ordering.
```

---

# 26. Double-Checked Locking

Classic lazy init:

```java
class Lazy {
    private static Helper helper;

    static Helper get() {
        if (helper == null) {
            synchronized (Lazy.class) {
                if (helper == null) {
                    helper = new Helper();
                }
            }
        }
        return helper;
    }
}
```

This was broken historically without volatile because reference assignment could be visible before object construction fully visible.

Correct modern version:

```java
class Lazy {
    private static volatile Helper helper;

    static Helper get() {
        Helper local = helper;
        if (local == null) {
            synchronized (Lazy.class) {
                local = helper;
                if (local == null) {
                    local = new Helper();
                    helper = local;
                }
            }
        }
        return local;
    }
}
```

## 26.1 Better alternatives

Static holder idiom:

```java
class Lazy {
    private static class Holder {
        static final Helper INSTANCE = new Helper();
    }

    static Helper get() {
        return Holder.INSTANCE;
    }
}
```

Enum singleton for singleton use case.

## 26.2 Main rule

```text
Double-checked locking requires volatile.
Prefer simpler safe initialization patterns when possible.
```

---

# 27. Publication Through Static Initialization

Class initialization is thread-safe.

Example:

```java
class ConfigHolder {
    static final Config CONFIG = loadConfig();
}
```

JVM guarantees class initialization happens safely.

## 27.1 Initialization-on-demand holder

```java
class ServiceRegistry {
    private static class Holder {
        static final Service INSTANCE = new Service();
    }

    static Service instance() {
        return Holder.INSTANCE;
    }
}
```

Lazy and thread-safe.

## 27.2 Main rule

```text
Static initialization is one of the simplest safe publication mechanisms.
```

---

# 28. Publication Through Executor and Queue

Executor submission creates memory consistency edge.

Example:

```java
Task task = new Task();
task.payload = payload;

executor.submit(task);
```

Actions before submission happen-before task execution.

## 28.1 Queue handoff

```java
queue.put(message);
```

Consumer:

```java
Message message = queue.take();
```

Producer writes before put are visible after take.

## 28.2 Main rule

```text
Executor and BlockingQueue are safe handoff mechanisms when used correctly.
```

---

# 29. Publication Through CompletableFuture/Future

`Future.get` has memory consistency effects: actions in asynchronous computation happen-before actions after `get` returns.

Example:

```java
Future<Result> future = executor.submit(() -> {
    resultHolder.value = 42;
    return resultHolder;
});

ResultHolder holder = future.get();
System.out.println(holder.value);
```

The value is visible after successful `get`.

## 29.1 CompletableFuture completion

CompletableFuture stages and completion also provide ordering for dependent stages as specified by CompletionStage semantics.

## 29.2 Main rule

```text
Future.get is not only waiting; it is also a memory visibility boundary.
```

---

# 30. Common Broken Patterns

## 30.1 Non-volatile stop flag

```java
boolean running = true;
```

Used across threads.

## 30.2 Unsafe singleton

```java
static Helper helper;
```

Lazy init without synchronization.

## 30.3 Publishing mutable object through plain field

```java
config = newConfig;
```

plain shared field.

## 30.4 Check-then-act without lock

```java
if (!map.containsKey(k)) {
    map.put(k, v);
}
```

on non-thread-safe map or non-atomic compound action.

## 30.5 Volatile increment

```java
volatile int count;
count++;
```

## 30.6 `this` escape in constructor

```java
listenerRegistry.register(this);
```

## 30.7 Reading guarded state outside lock

```java
synchronized void write() { ... }
int read() { return value; }
```

## 30.8 Main rule

```text
Most JMM bugs are caused by unsafely sharing mutable state.
```

---

# 31. How Bugs Appear in Production

JMM bugs often appear as:

## 31.1 Infinite loop

Stop flag not visible.

## 31.2 Null or default value

Partially visible object.

## 31.3 Lost update

Non-atomic increment.

## 31.4 Rare invalid state

Multi-field invariant read without lock.

## 31.5 Works with logging

Logging introduces synchronization/timing, hiding bug.

## 31.6 Fails only under load

More interleavings and JIT optimization.

## 31.7 Fails after warmup

JIT optimizes loop/read.

## 31.8 Main rule

```text
A concurrency bug disappearing during debugging is a warning sign, not proof.
```

---

# 32. Testing JMM Bugs

JMM bugs are hard to test.

## 32.1 Unit tests often miss them

Because race windows are tiny.

## 32.2 Stress tests help

Run many iterations, many threads.

## 32.3 jcstress

OpenJDK jcstress is designed to test concurrency correctness and memory model behavior.

## 32.4 Avoid sleep-based proof

Bad:

```java
Thread.sleep(100);
assertTrue(done);
```

## 32.5 Test with synchronization

Use latches/barriers to create interleavings.

## 32.6 Main rule

```text
Testing can reveal JMM bugs, but correctness should be proven by happens-before reasoning.
```

---

# 33. Design Guidelines

## 33.1 Prefer no sharing

Thread confinement.

## 33.2 Prefer immutable data

Final fields, defensive copies.

## 33.3 Use safe publication

Volatile, locks, static init, queues, futures.

## 33.4 Use high-level utilities

Executors, queues, atomics, latches.

## 33.5 Guard invariants with locks

Multiple fields require mutual exclusion.

## 33.6 Use volatile for simple flags/state

Stop flag, readiness signal.

## 33.7 Use atomics for counters/simple state transitions

AtomicInteger, AtomicReference.

## 33.8 Avoid custom lock-free algorithms

Unless expert and tested with jcstress.

## 33.9 Main rule

```text
Reduce shared mutable state first.
Synchronize what remains.
```

---

# 34. Mini Case Study: Stop Flag That Never Stops

## 34.1 Bug

```java
class Worker implements Runnable {
    private boolean running = true;

    void stop() {
        running = false;
    }

    public void run() {
        while (running) {
            doWork();
        }
    }
}
```

## 34.2 Why broken

No happens-before between `stop` write and loop read.

JIT may hoist `running` read or thread may not observe update.

## 34.3 Fix 1: volatile

```java
private volatile boolean running = true;
```

## 34.4 Fix 2: interrupt

```java
while (!Thread.currentThread().isInterrupted()) {
    doWork();
}
```

## 34.5 Fix 3: synchronized

Less common for simple stop flag.

## 34.6 Lesson

```text
Cross-thread flags require visibility.
```

---

# 35. Mini Case Study: Partially Constructed Object Escape

## 35.1 Bug

```java
class Service {
    private final Dependency dependency;

    Service(EventBus bus) {
        bus.register(this);
        this.dependency = new Dependency();
    }

    void onEvent(Event event) {
        dependency.handle(event);
    }
}
```

## 35.2 Problem

`this` escapes before constructor completes.

Another thread can call `onEvent` before `dependency` is assigned/visible.

## 35.3 Fix

Construct fully first, then register externally:

```java
Service service = new Service();
bus.register(service);
```

or factory:

```java
static Service create(EventBus bus) {
    Service service = new Service();
    bus.register(service);
    return service;
}
```

## 35.4 Lesson

```text
Do not let this escape during construction.
```

---

# 36. Mini Case Study: Counter Lost Updates

## 36.1 Bug

```java
class Counter {
    private int count;

    void increment() {
        count++;
    }

    int get() {
        return count;
    }
}
```

## 36.2 Problem

`count++` not atomic.

## 36.3 Fix 1: synchronized

```java
synchronized void increment() {
    count++;
}

synchronized int get() {
    return count;
}
```

## 36.4 Fix 2: AtomicInteger

```java
AtomicInteger count = new AtomicInteger();

void increment() {
    count.incrementAndGet();
}
```

## 36.5 Fix 3: LongAdder

For high-contention counters where exact immediate read less critical.

## 36.6 Lesson

```text
Atomicity requires atomic operation or lock.
```

---

# 37. Best Practices

## 37.1 Always ask: where is happens-before?

For any shared state.

## 37.2 Prefer immutability

Immutable objects are easier to share.

## 37.3 Use final fields

For object construction safety.

## 37.4 Do not let this escape

Especially in constructors.

## 37.5 Use volatile for simple flags

Stop/ready/config reference.

## 37.6 Use synchronized/locks for invariants

Multiple fields or compound actions.

## 37.7 Use atomics for simple atomic state

Counters, CAS state machine.

## 37.8 Use concurrent utilities for handoff

BlockingQueue, Executor, Future.

## 37.9 Avoid data races

No plain shared mutable fields.

## 37.10 Validate with stress tests

Especially low-level concurrency.

---

# 38. Decision Matrix

| Problem | Tool |
|---|---|
| Simple stop flag | `volatile boolean` or interrupt |
| Publish immutable config snapshot | volatile reference or static init |
| Protect multi-field invariant | `synchronized` / lock |
| Counter low/moderate contention | `AtomicLong` |
| Counter high contention | `LongAdder` |
| One-time safe lazy init | static holder |
| Lazy init with double-check | volatile + synchronized |
| Handoff producer-consumer | `BlockingQueue` |
| Async task result visibility | `Future.get` |
| Start worker after setup | `Thread.start` rule |
| Wait for worker result | `Thread.join` |
| Complex shared mutable object | redesign ownership or lock |
| Low-level memory ordering | `VarHandle`, advanced only |
| Need no sharing | thread confinement |
| Need read-mostly snapshot | immutable snapshot + volatile ref |

---

# 39. Latihan

## Latihan 1 — Happens-Before Chain

Jelaskan happens-before chain pada kode:

```java
data = new Data(42);
ready = true; // volatile
```

Reader:

```java
if (ready) use(data);
```

## Latihan 2 — Broken Stop Flag

Tulis worker dengan non-volatile flag, lalu perbaiki dengan volatile dan interrupt.

## Latihan 3 — Volatile Increment

Jelaskan kenapa `volatile int count; count++;` tidak aman.

## Latihan 4 — Safe Publication

Berikan tiga cara aman mempublish object config baru ke banyak reader.

## Latihan 5 — Final Field

Apa syarat agar final field semantics bekerja dengan aman?

## Latihan 6 — Constructor Escape

Cari bug dari class yang register listener di constructor.

## Latihan 7 — Lock Rule

Buat contoh writer dan reader yang synchronize pada lock yang sama.

## Latihan 8 — Executor Publication

Jelaskan kenapa data yang disiapkan sebelum `executor.submit(task)` terlihat oleh task.

## Latihan 9 — Future Visibility

Jelaskan kenapa setelah `future.get()` caller bisa melihat hasil task.

## Latihan 10 — Design Review

Review class dengan plain mutable shared fields dan usulkan strategi: immutable, volatile, lock, atomic, atau confinement.

---

# 40. Ringkasan

Java Memory Model adalah fondasi correctness dalam concurrent Java.

Core lessons:

- Cross-thread visibility tidak otomatis.
- Source-code order bukan global memory order.
- Compiler, JIT, dan CPU boleh reorder jika tidak dibatasi JMM.
- Visibility, ordering, dan atomicity adalah tiga hal berbeda.
- Data race terjadi ketika conflicting accesses tidak ordered by happens-before.
- Happens-before adalah konsep utama untuk membuktikan visibility.
- Program order berlaku dalam satu thread.
- Unlock happens-before subsequent lock pada monitor yang sama.
- Volatile write happens-before subsequent volatile read pada field yang sama.
- Thread start mempublish setup sebelum start ke thread baru.
- Thread join mempublish efek thread selesai ke joiner.
- Happens-before transitive.
- Final fields memberi initialization safety jika object dibangun dengan benar dan `this` tidak escape.
- Safe publication wajib untuk object yang dibaca thread lain.
- Volatile memberi visibility/order, bukan mutual exclusion.
- Synchronized memberi mutual exclusion dan visibility.
- Atomics memberi atomic operations untuk state sederhana.
- Concurrent utilities menyediakan memory consistency effects untuk handoff umum.
- VarHandle adalah tool advanced untuk memory ordering rendah level.
- Bugs JMM sering muncul hanya under load/warmup dan hilang saat debugging.
- Correctness harus dibuktikan dengan happens-before, bukan feeling.

Main rule:

```text
For every shared mutable state, ask:
What writes it?
What reads it?
What happens-before edge connects them?
If you cannot answer, the code is not concurrency-safe.
```

---

# 41. Referensi

1. Java Language Specification — Chapter 17: Threads and Locks  
   https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html

2. Java SE 25 — `java.util.concurrent` Package Summary, Memory Consistency Properties  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

3. Java SE 25 — `Thread`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

4. Java SE 25 — `Future`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/Future.html

5. Java SE 25 — `ExecutorService`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ExecutorService.html

6. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

7. Java SE 25 — `AtomicInteger`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html

8. Java SE 25 — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

9. Java SE 25 — `VarHandle`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/VarHandle.html

10. OpenJDK jcstress  
    https://openjdk.org/projects/code-tools/jcstress/

11. JSR-133 Java Memory Model and Thread Specification  
    https://www.cs.umd.edu/~pugh/java/memoryModel/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 006](./learn-java-concurrency-and-reactive-part-006.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 008](./learn-java-concurrency-and-reactive-part-008.md)
