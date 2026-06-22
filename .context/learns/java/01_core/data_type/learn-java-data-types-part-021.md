# learn-java-data-types-part-021.md

# Java Data Types — Part 021  
# Data Types and Java Memory Model: Visibility, Happens-Before, Final Fields, Volatile, Atomicity, dan Safe Publication

> Seri: **Advanced Java Data Types**  
> Bagian: **021**  
> Fokus: memahami bagaimana desain data type berinteraksi dengan Java Memory Model (JMM): shared variables, data race, visibility, ordering, happens-before, synchronized, volatile, final field semantics, safe publication, immutable objects, mutable objects, atomic classes, VarHandle-level thinking, concurrent collections, dan production-safe data sharing.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Java Memory Model Penting untuk Data Types](#2-kenapa-java-memory-model-penting-untuk-data-types)
3. [Mental Model: Thread Tidak Otomatis Melihat Dunia yang Sama](#3-mental-model-thread-tidak-otomatis-melihat-dunia-yang-sama)
4. [Shared Variable dan Data Race](#4-shared-variable-dan-data-race)
5. [Visibility vs Atomicity vs Ordering](#5-visibility-vs-atomicity-vs-ordering)
6. [Happens-Before: Konsep Utama JMM](#6-happens-before-konsep-utama-jmm)
7. [Program Order Rule](#7-program-order-rule)
8. [Monitor Lock: `synchronized`](#8-monitor-lock-synchronized)
9. [`volatile`: Visibility dan Ordering Tanpa Mutual Exclusion](#9-volatile-visibility-dan-ordering-tanpa-mutual-exclusion)
10. [`volatile` Bukan Atomic Compound Operation](#10-volatile-bukan-atomic-compound-operation)
11. [Final Field Semantics](#11-final-field-semantics)
12. [Safe Publication](#12-safe-publication)
13. [Unsafe Publication](#13-unsafe-publication)
14. [Immutable Object dan JMM](#14-immutable-object-dan-jmm)
15. [Mutable Object dan JMM](#15-mutable-object-dan-jmm)
16. [Volatile Reference vs Mutable Object Graph](#16-volatile-reference-vs-mutable-object-graph)
17. [Atomic Classes](#17-atomic-classes)
18. [`AtomicReference` dan Immutable State](#18-atomicreference-dan-immutable-state)
19. [LongAdder, AtomicLong, dan Counter Semantics](#19-longadder-atomiclong-dan-counter-semantics)
20. [Concurrent Collections dan Memory Consistency](#20-concurrent-collections-dan-memory-consistency)
21. [Thread Start, Join, Executor, dan CompletableFuture](#21-thread-start-join-executor-dan-completablefuture)
22. [Double-Checked Locking](#22-double-checked-locking)
23. [Initialization-on-Demand Holder](#23-initialization-on-demand-holder)
24. [Escape During Construction](#24-escape-during-construction)
25. [Arrays dan Mutable Collections dalam Shared State](#25-arrays-dan-mutable-collections-dalam-shared-state)
26. [Records, Final Fields, dan Mutable Components](#26-records-final-fields-dan-mutable-components)
27. [Data Types for Concurrency Boundaries](#27-data-types-for-concurrency-boundaries)
28. [JMM dan Caching](#28-jmm-dan-caching)
29. [JMM dan Event/Command Objects](#29-jmm-dan-eventcommand-objects)
30. [JMM dan Performance: False Sharing, Contention, Allocation](#30-jmm-dan-performance-false-sharing-contention-allocation)
31. [Testing Concurrency Bugs](#31-testing-concurrency-bugs)
32. [Production Failure Modes](#32-production-failure-modes)
33. [Best Practices](#33-best-practices)
34. [Decision Matrix](#34-decision-matrix)
35. [Latihan](#35-latihan)
36. [Ringkasan](#36-ringkasan)
37. [Referensi](#37-referensi)

---

# 1. Tujuan Bagian Ini

Data type tidak hidup di ruang hampa.

Dalam aplikasi production, data type sering:

- dibaca banyak thread;
- dimutasi oleh background job;
- disimpan di cache;
- dikirim ke executor;
- dipublish sebagai event;
- dibaca oleh HTTP request concurrent;
- dipakai di concurrent map;
- diupdate dengan retry/atomic operation.

Contoh bug:

```java
class Config {
    boolean enabled;
}

Config config = new Config();

Thread writer = new Thread(() -> config.enabled = true);
Thread reader = new Thread(() -> {
    while (!config.enabled) {
        // may loop longer than expected
    }
});
```

Tanpa happens-before relationship, reader tidak dijamin melihat update writer pada waktu yang kamu bayangkan.

Tujuan bagian ini:

- memahami JMM dari perspektif desain data type;
- membedakan visibility, atomicity, ordering;
- memahami happens-before;
- memahami `synchronized`, `volatile`, `final`;
- memahami safe publication;
- memahami immutable objects sebagai strategi concurrency;
- memahami kenapa volatile reference tidak membuat object graph immutable;
- memahami atomic classes dan concurrent collections;
- memahami failure modes production karena salah share mutable data.

---

# 2. Kenapa Java Memory Model Penting untuk Data Types

JLS Chapter 17 mendefinisikan Threads and Locks, termasuk Java Memory Model. JMM menjelaskan kapan write oleh satu thread dijamin terlihat oleh read di thread lain.

Jika data type hanya dipakai single-thread, kamu bisa berpikir sederhana.

Jika data type dishare antar thread, pertanyaan berubah:

```text
Apakah thread lain pasti melihat field yang sudah di-set?
Apakah object dipublish dengan aman?
Apakah update compound atomic?
Apakah mutable collection aman dibaca saat ditulis?
Apakah final field cukup?
Apakah volatile cukup?
```

## 2.1 Data type design affects concurrency

Immutable type:

```java
record CaseSnapshot(CaseId id, CaseStatus status, Instant updatedAt) {}
```

mudah dishare.

Mutable type:

```java
class CaseRecord {
    CaseStatus status;
    Instant updatedAt;
}
```

butuh ownership/synchronization.

## 2.2 JMM is not CPU cache detail only

JMM adalah kontrak bahasa Java yang memungkinkan JVM dan CPU melakukan optimization tetapi tetap memberi aturan kapan program concurrent dianggap benar.

## 2.3 Without synchronization, intuition fails

Compiler/JIT/CPU boleh melakukan reordering/optimization selama aturan JMM terpenuhi.

Dalam data race, hasil bisa mengejutkan.

## 2.4 Senior design principle

```text
Do not share mutable data without a synchronization story.
```

---

# 3. Mental Model: Thread Tidak Otomatis Melihat Dunia yang Sama

Jangan bayangkan semua thread selalu melihat memory global yang langsung konsisten.

Bayangkan:

```text
Thread A writes value.
Thread B may or may not see it immediately unless there is happens-before.
```

## 3.1 Visibility

Write di thread A terlihat oleh read di thread B hanya dijamin jika ada synchronization/happens-before.

## 3.2 Reordering

Operasi bisa tampak dieksekusi dalam urutan berbeda selama single-thread behavior tetap legal.

## 3.3 Local caching

JIT/CPU dapat menyimpan nilai di register/cache.

## 3.4 Synchronization creates order

`volatile`, `synchronized`, thread start/join, concurrent utilities, final fields, dan class initialization dapat membentuk visibility/order guarantees.

## 3.5 Practical rule

Jika object mutable dan dishare, pilih satu:

- jangan share;
- make immutable;
- guard with lock;
- use volatile for simple state publication;
- use atomic class;
- use concurrent collection;
- use message passing.

---

# 4. Shared Variable dan Data Race

JLS defines a data race in terms of conflicting accesses not ordered by happens-before.

Simplified:

```text
Ada dua thread mengakses variable yang sama.
Minimal satu adalah write.
Tidak ada happens-before ordering.
```

## 4.1 Example

```java
class Counter {
    int count;
}

Counter c = new Counter();

Thread t1 = new Thread(() -> c.count++);
Thread t2 = new Thread(() -> c.count++);
```

`count++` is not atomic and not synchronized.

## 4.2 Shared variable

Fields, array elements, and static fields can be shared variables.

Local variables are thread-confined unless captured/escaped through shared object.

## 4.3 Conflicting access

Read/write or write/write to same variable.

## 4.4 Data race outcome

A racy program may show:

- stale values;
- lost updates;
- surprising ordering;
- non-deterministic bugs.

## 4.5 Data-race-free ideal

If shared mutable accesses are properly ordered/synchronized, program is far easier to reason about.

---

# 5. Visibility vs Atomicity vs Ordering

Concurrency correctness has at least three dimensions.

## 5.1 Visibility

Can another thread see my write?

```java
volatile boolean running;
```

A volatile write becomes visible to subsequent volatile read of same field.

## 5.2 Atomicity

Is operation indivisible?

```java
count++ // read + add + write, not atomic
```

Use:

```java
AtomicInteger.incrementAndGet()
```

or lock.

## 5.3 Ordering

Can operations be observed/reordered?

```java
data = new Data(...);
ready = true;
```

Without proper ordering, reader may see `ready` but not data initialized as expected.

## 5.4 Common mistake

`volatile` solves visibility/order for field access, but not compound atomicity.

## 5.5 Design implication

For data type:

- immutable object solves most;
- synchronized guards compound invariants;
- volatile okay for simple flags/reference publication;
- atomic okay for independent single-variable state;
- lock needed for multi-field invariant.

---

# 6. Happens-Before: Konsep Utama JMM

Happens-before is the central relation in JMM.

If action A happens-before action B, then effects of A are visible to B and A is ordered before B for memory model purposes.

Java SE 25 `java.util.concurrent` package summary says results of write by one thread are guaranteed visible to read by another only if write happens-before read, and mentions synchronized, volatile, Thread.start, and Thread.join as constructs that form happens-before relationships.

## 6.1 Not wall-clock

Happens-before does not mean physically executed before in time only.

It is a memory ordering/visibility relation.

## 6.2 Transitive

If:

```text
A happens-before B
B happens-before C
```

then:

```text
A happens-before C
```

## 6.3 Why it matters

Without happens-before, thread B may not see thread A's writes reliably.

## 6.4 Practical examples

- Unlock happens-before subsequent lock on same monitor.
- Volatile write happens-before subsequent volatile read of same field.
- Thread.start happens-before actions in started thread.
- Actions in thread happen-before successful join return.
- Class initialization has safe publication effects.

## 6.5 Design goal

Create clear happens-before edges where shared mutable data crosses thread boundaries.

---

# 7. Program Order Rule

Within a single thread, actions appear in program order for happens-before relation.

```java
x = 1;
y = 2;
```

In the same thread, `x = 1` happens-before `y = 2`.

## 7.1 Single-thread semantics

JVM optimizations must preserve as-if-serial behavior in single thread.

## 7.2 Cross-thread not enough

Program order in writer thread alone does not guarantee reader sees writes unless synchronization connects threads.

## 7.3 Example

```java
data = "ready";
flag = true;
```

In writer thread, data write is before flag write.

But reader thread needs proper synchronization to rely on flag visibility implying data visibility.

## 7.4 Volatile flag pattern

```java
data = new Data(...);
ready = true; // volatile write
```

Reader:

```java
if (ready) { // volatile read
    use(data);
}
```

If `ready` is volatile, writes before volatile write become visible after volatile read.

## 7.5 Prefer immutable state reference

Often better:

```java
volatile Config config = new Config(...);
```

Publish whole immutable object.

---

# 8. Monitor Lock: `synchronized`

`synchronized` provides mutual exclusion and memory visibility.

```java
synchronized (lock) {
    shared = value;
}
```

## 8.1 Mutual exclusion

Only one thread can hold same monitor lock at a time.

## 8.2 Visibility

Unlock on monitor happens-before every subsequent lock on same monitor.

## 8.3 Guarding invariants

If multiple fields must be consistent, use same lock for all access.

```java
class Account {
    private long balance;
    private long reserved;

    synchronized void reserve(long amount) {
        if (balance - reserved < amount) throw ...
        reserved += amount;
    }

    synchronized Snapshot snapshot() {
        return new Snapshot(balance, reserved);
    }
}
```

## 8.4 Lock object

Prefer private final lock:

```java
private final Object lock = new Object();
```

instead of locking on public `this` if external code can interfere.

## 8.5 Synchronized method

```java
synchronized void update() {}
```

locks on `this`.

Static synchronized locks on class object.

## 8.6 Virtual threads note

Modern Java virtual thread behavior and synchronized interaction has evolved, but `synchronized` semantics remain JMM-relevant. For blocking/structured concurrency design, choose locks carefully.

---

# 9. `volatile`: Visibility dan Ordering Tanpa Mutual Exclusion

A volatile field provides visibility/order guarantees but not mutual exclusion.

```java
private volatile boolean running = true;
```

Writer:

```java
running = false;
```

Reader:

```java
while (running) {
    doWork();
}
```

## 9.1 Happens-before

A write to a volatile field happens-before every subsequent read of that same field.

Java SE 25 `java.util.concurrent` package summary states this explicitly and notes volatile reads/writes have similar memory consistency effects to entering/exiting monitors but without mutual exclusion.

## 9.2 Good use cases

- cancellation flag;
- readiness flag with immutable data;
- publishing immutable snapshot reference;
- simple state visible across threads.

## 9.3 Not for compound invariants

Bad:

```java
volatile int count;

count++; // not atomic
```

## 9.4 Volatile reference

```java
volatile Config config;
```

Publishing new immutable Config is good.

Mutating old config internals is not solved by volatile.

## 9.5 Volatile and performance

Volatile has memory ordering costs.

Use where semantics need it, not as decoration.

---

# 10. `volatile` Bukan Atomic Compound Operation

```java
volatile int count = 0;

void inc() {
    count++;
}
```

`count++` is:

```text
read count
add 1
write count
```

Two threads can lose update.

## 10.1 Fix with AtomicInteger

```java
AtomicInteger count = new AtomicInteger();

void inc() {
    count.incrementAndGet();
}
```

## 10.2 Fix with synchronized

```java
synchronized void inc() {
    count++;
}
```

## 10.3 Fix with LongAdder

For high-contention counters:

```java
LongAdder adder = new LongAdder();
adder.increment();
```

## 10.4 Multi-field update

AtomicInteger only protects one variable.

For invariant across fields, use lock or immutable state CAS.

## 10.5 Volatile okay for simple assignment

```java
volatile boolean enabled;
enabled = true;
```

Single write/read flag is okay.

---

# 11. Final Field Semantics

`final` fields have special memory model semantics.

If object is properly constructed and `this` does not escape during construction, other threads that see the object are guaranteed to see correctly initialized final fields.

## 11.1 Example

```java
final class User {
    private final UserId id;
    private final DisplayName name;

    User(UserId id, DisplayName name) {
        this.id = Objects.requireNonNull(id);
        this.name = Objects.requireNonNull(name);
    }
}
```

Final fields support safe immutable objects.

## 11.2 Final reference caveat

```java
private final List<String> values;
```

Final guarantees the reference assigned in constructor is visible, not that list content cannot mutate.

## 11.3 Proper construction

Do not let `this` escape:

```java
class Bad {
    Bad() {
        Registry.register(this); // bad
    }
}
```

Another thread might observe partially constructed object.

## 11.4 Records

Record components are final fields.

Good for immutable values if components immutable/defensively copied.

## 11.5 Benefit

Final fields are a core building block for safe immutable data types.

---

# 12. Safe Publication

Safe publication means making an object visible to other threads with proper happens-before guarantees.

## 12.1 Safe ways

Examples:

- store reference in volatile field;
- store in final field of properly constructed object;
- publish through synchronized block;
- publish through concurrent collection;
- initialize as static final during class initialization;
- start a thread after setting up data for it;
- complete a Future/CompletableFuture.

## 12.2 Static final

```java
static final Config DEFAULT_CONFIG = new Config(...);
```

Class initialization safely publishes it.

## 12.3 Volatile snapshot

```java
private volatile Config config = Config.defaultConfig();

void reload(Config newConfig) {
    config = newConfig;
}
```

If Config immutable, readers safe.

## 12.4 Concurrent collection

```java
map.put(key, value);
```

Concurrent collections provide memory consistency effects for operations.

## 12.5 Unsafe publication

```java
shared = new MutableObject(...);
```

to non-volatile field read by other threads without synchronization is unsafe.

## 12.6 Rule

Immutable object still needs to be published safely, though final fields help initialization safety. For visibility of reference update, use safe publication.

---

# 13. Unsafe Publication

Unsafe publication happens when object reference becomes visible without proper synchronization.

```java
class Holder {
    Data data;
}

holder.data = new Data(...); // no volatile/sync/final publication
```

Another thread reading `holder.data` might see stale/null/partially initialized behavior depending race.

## 13.1 Mutable static

```java
static Config config;

void reload() {
    config = new Config(...);
}
```

Readers without volatile/sync may not see latest config.

## 13.2 This escape

```java
class Listener {
    final String name;

    Listener(EventBus bus) {
        bus.register(this);
        this.name = "x";
    }
}
```

Other thread may call listener before constructor finishes.

## 13.3 Starting thread in constructor

```java
class Worker {
    Worker() {
        new Thread(this::run).start();
    }
}
```

`this` escapes.

## 13.4 Fix

- complete construction first;
- factory method starts thread after construction;
- final fields;
- volatile/sync publication;
- immutable design.

## 13.5 Design smell

If constructor has side effects that publish object, review carefully.

---

# 14. Immutable Object dan JMM

Immutable objects are easiest to share.

Requirements:

- class final or no mutation path;
- fields final;
- components immutable or defensively copied;
- no `this` escape during construction;
- safe publication.

## 14.1 Example

```java
public record CaseSnapshot(
    CaseId id,
    CaseStatus status,
    Instant updatedAt,
    List<Violation> violations
) {
    public CaseSnapshot {
        Objects.requireNonNull(id);
        Objects.requireNonNull(status);
        Objects.requireNonNull(updatedAt);
        violations = List.copyOf(violations);
    }
}
```

If components immutable, this is safe to share.

## 14.2 Thread safety

No synchronization needed for reading immutable object once safely published.

## 14.3 Stable hashCode

Immutable values are safe as map keys.

## 14.4 Cache friendly

Immutable cached data cannot be accidentally modified by readers.

## 14.5 Updates

Create new object.

```java
snapshot = new CaseSnapshot(...);
```

Publish via volatile/AtomicReference/concurrent map.

---

# 15. Mutable Object dan JMM

Mutable object shared across threads needs synchronization policy.

## 15.1 Lock-based

```java
final class MutableState {
    private final Object lock = new Object();
    private int value;

    int get() {
        synchronized (lock) {
            return value;
        }
    }

    void set(int value) {
        synchronized (lock) {
            this.value = value;
        }
    }
}
```

## 15.2 Volatile simple field

```java
private volatile boolean enabled;
```

Good for simple flag.

## 15.3 Atomic single state

```java
private final AtomicReference<State> state = new AtomicReference<>(initial);
```

## 15.4 Concurrent collection

```java
ConcurrentHashMap<Key, Value>
```

## 15.5 Thread confinement

Keep mutable object used by one thread only.

Example:

```java
StringBuilder local = new StringBuilder();
```

## 15.6 Ownership

Mutable shared object must have one of:

- lock owner;
- actor thread owner;
- concurrent data structure semantics;
- atomic transition semantics.

---

# 16. Volatile Reference vs Mutable Object Graph

This is a common trap.

```java
private volatile List<String> names = new ArrayList<>();
```

The reference update is volatile, but list operations are not thread-safe.

## 16.1 Bad

```java
names.add("x"); // mutates ArrayList unsafely
```

## 16.2 Good: immutable snapshot

```java
private volatile List<String> names = List.of();

void addName(String name) {
    var copy = new ArrayList<>(names);
    copy.add(name);
    names = List.copyOf(copy);
}
```

## 16.3 Good: concurrent collection

```java
private final CopyOnWriteArrayList<String> names = new CopyOnWriteArrayList<>();
```

if read-heavy write-rare.

## 16.4 Good: synchronized

```java
synchronized (lock) {
    names.add(name);
}
```

and synchronize reads too.

## 16.5 Rule

Volatile protects the variable slot, not the object graph.

---

# 17. Atomic Classes

`java.util.concurrent.atomic` provides classes for lock-free thread-safe programming on single variables; Java SE 25 atomic package docs say atomic class instances maintain values accessed and updated using methods otherwise available for fields with associated VarHandle atomic operations.

Examples:

```java
AtomicInteger
AtomicLong
AtomicBoolean
AtomicReference
AtomicLongArray
AtomicReferenceArray
LongAdder
LongAccumulator
```

## 17.1 AtomicInteger

```java
AtomicInteger count = new AtomicInteger();

count.incrementAndGet();
count.compareAndSet(expected, update);
```

## 17.2 AtomicReference

```java
AtomicReference<State> state = new AtomicReference<>(initial);
```

## 17.3 CAS

Compare-and-set:

```java
state.compareAndSet(oldState, newState)
```

Atomic if current reference equals expected.

## 17.4 Single variable

Atomic classes are excellent for single independent state.

For multiple-field invariants, consider immutable aggregate state in AtomicReference or locks.

## 17.5 ABA and complexity

Lock-free algorithms can be subtle.

Use high-level concurrent utilities when possible.

---

# 18. `AtomicReference` dan Immutable State

AtomicReference pairs well with immutable state object.

```java
record ConfigState(Map<String, String> values, Version version) {
    ConfigState {
        values = Map.copyOf(values);
    }
}
```

```java
AtomicReference<ConfigState> ref =
    new AtomicReference<>(new ConfigState(Map.of(), new Version(0)));
```

Update:

```java
void put(String key, String value) {
    ref.updateAndGet(old -> {
        Map<String, String> copy = new HashMap<>(old.values());
        copy.put(key, value);
        return new ConfigState(copy, old.version().next());
    });
}
```

## 18.1 Benefits

- atomic whole-state update;
- readers see consistent snapshot;
- no partial multi-field mutation;
- no locks for simple update.

## 18.2 Costs

- copy cost;
- contention retry;
- update function may run multiple times.

## 18.3 Update function purity

Because CAS may retry, function should be side-effect-free.

Bad:

```java
updateAndGet(old -> {
    sendEmail(); // may run multiple times
    return newState;
});
```

## 18.4 Snapshot read

```java
ConfigState snapshot = ref.get();
```

## 18.5 Great pattern

For small/medium read-heavy state, AtomicReference immutable snapshot is very powerful.

---

# 19. LongAdder, AtomicLong, dan Counter Semantics

## 19.1 AtomicLong

```java
AtomicLong count = new AtomicLong();
count.incrementAndGet();
```

Good for exact atomic counter with read-after-update semantics.

## 19.2 LongAdder

```java
LongAdder adder = new LongAdder();
adder.increment();
long sum = adder.sum();
```

Better under high contention for statistics counters.

## 19.3 Semantics difference

`LongAdder.sum()` not necessarily atomic snapshot with concurrent updates in same way you might expect for strict counters.

Use for metrics/statistics, not exact sequence numbers.

## 19.4 Sequence number

Use:

```java
AtomicLong.incrementAndGet()
```

for unique sequence.

## 19.5 Metrics

Use:

```java
LongAdder
```

for high-throughput counters.

## 19.6 Domain type

Wrap if semantics important:

```java
record Version(long value) {}
```

Do not expose raw counter meaning.

---

# 20. Concurrent Collections dan Memory Consistency

`java.util.concurrent` package summary describes memory consistency effects: actions in a thread before placing an object into a concurrent collection happen-before actions after access/removal of that element in another thread.

## 20.1 ConcurrentHashMap

```java
ConcurrentHashMap<Key, Value> map = new ConcurrentHashMap<>();
map.put(key, value);
Value v = map.get(key);
```

Operations provide concurrency semantics.

## 20.2 BlockingQueue

Producer:

```java
queue.put(command);
```

Consumer:

```java
Command command = queue.take();
```

Queue operation safely transfers object reference, assuming object itself is not mutated unsafely after enqueue.

## 20.3 Immutable messages

Best:

```java
record Command(...) {}
```

Producer should not mutate command after enqueue.

## 20.4 Concurrent collection not magic

If value object inside map is mutable and mutated without synchronization, still unsafe.

## 20.5 Atomic map operations

Use:

```java
compute
computeIfAbsent
merge
putIfAbsent
```

for compound map logic.

## 20.6 Values should be immutable when possible

```java
ConcurrentHashMap<CaseId, CaseSnapshot>
```

better than:

```java
ConcurrentHashMap<CaseId, MutableCaseRecord>
```

unless mutation policy clear.

---

# 21. Thread Start, Join, Executor, dan CompletableFuture

## 21.1 Thread.start

Actions before `Thread.start()` happen-before actions in started thread.

```java
Data data = new Data(...);
Thread t = new Thread(() -> use(data));
t.start();
```

Proper setup before start is visible.

## 21.2 Thread.join

All actions in a thread happen-before another thread successfully returns from `join()` on that thread.

```java
t.start();
t.join();
// now see effects from t, if data access otherwise safe by hb
```

## 21.3 Executor

Submitting tasks to executor uses concurrent queues and synchronization internally. Data handed to task should still be immutable or not mutated after submission.

## 21.4 Future/CompletableFuture

Completion safely publishes result to threads retrieving it via `get`/join-style APIs.

Still prefer immutable results.

## 21.5 Message passing

A powerful design:

```java
immutable command -> queue/executor -> handler
```

No shared mutable state.

---

# 22. Double-Checked Locking

Double-checked locking was broken before volatile semantics were fixed. Modern Java requires volatile.

```java
class Lazy {
    private static volatile Resource resource;

    static Resource get() {
        Resource r = resource;
        if (r == null) {
            synchronized (Lazy.class) {
                r = resource;
                if (r == null) {
                    r = new Resource();
                    resource = r;
                }
            }
        }
        return r;
    }
}
```

## 22.1 Why volatile needed

Prevents unsafe publication/reordering issues.

## 22.2 Prefer simpler alternatives

Use:

- static final;
- initialization-on-demand holder;
- dependency injection;
- memoizing supplier with proper library.

## 22.3 Avoid overusing lazy

Lazy initialization adds complexity.

## 22.4 If needed

Use proven pattern.

## 22.5 Resource immutability

The lazily initialized object should be safely constructed and thread-safe/immutable.

---

# 23. Initialization-on-Demand Holder

Lazy singleton pattern using class initialization.

```java
final class ConfigProvider {
    private ConfigProvider() {}

    static Config get() {
        return Holder.INSTANCE;
    }

    private static class Holder {
        static final Config INSTANCE = loadConfig();
    }
}
```

## 23.1 Why works

Class initialization is thread-safe and provides safe publication.

## 23.2 Good for static lazy immutable object

```java
static final Pattern
static final DateTimeFormatter
static final Config
```

## 23.3 Avoid for dependency-heavy app

In DI frameworks, prefer container lifecycle.

## 23.4 Error handling

If initialization fails, class initialization error behavior can be awkward.

## 23.5 Simpler than DCL

Often clearer than manual volatile + synchronized.

---

# 24. Escape During Construction

`this` escape during construction breaks final field guarantees and safe initialization.

## 24.1 Registering listener

```java
class MyListener {
    private final String name;

    MyListener(EventBus bus) {
        bus.register(this); // this escapes
        this.name = "x";
    }
}
```

## 24.2 Starting thread

```java
class Worker {
    Worker() {
        new Thread(this::run).start();
    }
}
```

## 24.3 Publishing to static

```java
class Foo {
    Foo() {
        Global.instance = this;
    }
}
```

## 24.4 Fix with factory

```java
static MyListener create(EventBus bus) {
    MyListener listener = new MyListener();
    bus.register(listener);
    return listener;
}
```

after full construction.

## 24.5 Constructor should construct

Avoid side effects that publish `this`.

---

# 25. Arrays dan Mutable Collections dalam Shared State

## 25.1 Array field

```java
private final byte[] bytes;
```

Final reference, mutable content.

## 25.2 Shared array

Concurrent reads/writes to array elements need synchronization/atomic arrays.

```java
AtomicIntegerArray
AtomicReferenceArray
```

## 25.3 Collection field

```java
private final List<Item> items = new ArrayList<>();
```

If accessed by multiple threads, guard with lock or use concurrent/immutable pattern.

## 25.4 Defensive snapshot

```java
List<Item> snapshot() {
    synchronized (lock) {
        return List.copyOf(items);
    }
}
```

## 25.5 Immutable publication

```java
volatile List<Item> items = List.of();
```

Replace list wholesale.

## 25.6 Rule

Never assume final collection field is thread-safe.

---

# 26. Records, Final Fields, dan Mutable Components

Records are final-ish value carriers, but not deep immutable.

```java
record Result(List<String> values) {}
```

If values mutable, record is not thread-safe by default.

## 26.1 Good record

```java
record Result(List<String> values) {
    Result {
        values = List.copyOf(values);
    }
}
```

## 26.2 Array record

```java
record Bytes(byte[] value) {}
```

Unsafe for sharing unless copied and equality fixed.

## 26.3 Record publication

Record with final immutable components, safely published, is excellent cross-thread data.

## 26.4 Generated accessors

Accessor exposes component reference.

Ensure component is safe to expose.

## 26.5 Rule

A record is concurrency-friendly only if its components are.

---

# 27. Data Types for Concurrency Boundaries

## 27.1 Command

```java
record CloseCaseCommand(CaseId caseId, OfficerId actorId, ClosureReason reason) {}
```

Immutable.

## 27.2 Event

```java
record CaseClosed(CaseId caseId, Instant occurredAt) {}
```

Immutable fact.

## 27.3 Snapshot

```java
record CaseSnapshot(CaseId id, CaseState state, Version version) {}
```

Immutable state view.

## 27.4 Mutable aggregate

```java
final class CaseAggregate {
    private final Object lock = new Object();
    private CaseState state;
}
```

Mutation guarded.

## 27.5 Atomic state

```java
AtomicReference<CaseState> state;
```

State variants immutable.

## 27.6 Queue boundary

Send immutable command/event through queue.

---

# 28. JMM dan Caching

## 28.1 Cache reference visibility

Cache stored in non-volatile field may be stale.

```java
Map<Key, Value> cache;
```

If replaced by one thread and read by another, need volatile/sync.

## 28.2 Concurrent cache

```java
ConcurrentHashMap<Key, Value>
```

## 28.3 Immutable values

Cache values should be immutable.

## 28.4 Cache key stability

Keys must have stable equals/hashCode.

## 28.5 Lazy cache initialization

Use `computeIfAbsent`.

```java
cache.computeIfAbsent(key, this::load);
```

Mapping function may be called under concurrency constraints; keep it safe.

## 28.6 Real cache library

For eviction/TTL/refresh, use mature cache library rather than ad hoc mutable maps.

---

# 29. JMM dan Event/Command Objects

## 29.1 Event immutability

Events published to async bus should be immutable.

Bad:

```java
class Event {
    List<String> payload;
}
```

with mutable list.

Good:

```java
record Event(List<String> payload) {
    Event {
        payload = List.copyOf(payload);
    }
}
```

## 29.2 Publish then mutate bug

```java
bus.publish(event);
event.payload().add(...); // if mutable, consumer may see changed event
```

## 29.3 Command immutability

Command submitted to executor should not be mutated after submit.

## 29.4 Correlation/context

Use immutable context object.

## 29.5 Outbox/event store

Persist immutable serialized event representation.

---

# 30. JMM dan Performance: False Sharing, Contention, Allocation

## 30.1 Contention

Many threads updating same atomic/lock cause contention.

## 30.2 LongAdder

Better for high-contention metrics counters.

## 30.3 False sharing

Independent hot fields on same cache line can cause performance degradation.

Usually low-level concern; use JDK/internal padding tools carefully.

## 30.4 Allocation vs locking

Immutable snapshots allocate more, but may reduce lock contention.

## 30.5 Copy cost

Copy-on-write not for write-heavy large data.

## 30.6 Benchmark

Use JMH for microbenchmarks and JFR for production profiling.

---

# 31. Testing Concurrency Bugs

Concurrency bugs are hard to test with ordinary unit tests.

## 31.1 Stress tests

Run many iterations and threads.

## 31.2 JCStress

OpenJDK JCStress is designed for concurrency stress tests and memory model experiments.

## 31.3 Avoid sleep-based tests

Sleeping does not establish happens-before.

## 31.4 Deterministic synchronization

Use:

- CountDownLatch;
- CyclicBarrier;
- Phaser;
- ExecutorService;
- Futures.

## 31.5 Test invariants

For shared data type, test:

- no lost updates;
- consistent snapshot;
- no mutable exposure;
- no CME under intended access;
- visibility after publish.

## 31.6 Code review matters

Many JMM bugs found by design review more than tests.

---

# 32. Production Failure Modes

## 32.1 Non-volatile stop flag

Worker never stops or stops late.

Fix:

```java
volatile boolean running
AtomicBoolean
interrupt
structured cancellation
```

## 32.2 Volatile counter lost updates

`volatile int count++`.

Fix:

```java
AtomicInteger
LongAdder
synchronized
```

## 32.3 Unsafe lazy singleton

Partially initialized object seen.

Fix:

- volatile DCL;
- holder pattern;
- static final;
- DI.

## 32.4 Mutable config map replaced unsafely

Some threads see old/null map.

Fix:

- volatile immutable snapshot;
- AtomicReference;
- synchronization.

## 32.5 Mutable object in ConcurrentHashMap

Map operations safe, object mutation not.

Fix:

- immutable values;
- per-value synchronization;
- atomic replacement.

## 32.6 Event object mutated after publish

Consumers see modified data.

Fix:

- immutable event;
- defensive copy.

## 32.7 Record with mutable list shared across threads

Record assumed safe, but list mutates.

Fix:

- List.copyOf;
- immutable elements.

## 32.8 `this` escape in constructor

Listener sees final fields null/default.

Fix:

- factory registration after construction.

## 32.9 Multi-field invariant with atomics

Two AtomicIntegers updated separately; reader sees inconsistent pair.

Fix:

- lock;
- AtomicReference immutable pair;
- synchronized snapshot.

## 32.10 Cache key mutable

Key hash changes; cache miss.

Fix:

- immutable key.

---

# 33. Best Practices

## 33.1 General

- Prefer immutable data types for shared data.
- Use final fields for immutable values.
- Do not let `this` escape during construction.
- Publish shared objects safely.
- Do not share mutable data without synchronization.
- Remember volatile is visibility/order, not compound atomicity.
- Use atomic classes for single-variable atomic state.
- Use locks for multi-field invariants.
- Use AtomicReference with immutable state for atomic whole-state updates.
- Use concurrent collections for concurrent map/queue use.
- Store immutable values inside concurrent collections when possible.
- Use defensive copy for arrays/collections in shared objects.
- Avoid mutable static state.
- Treat unchecked concurrency assumptions as bugs.

## 33.2 Data type design

- Commands/events/snapshots should be immutable.
- Entities can be mutable but mutation should be controlled and synchronized if shared.
- Records with mutable components need defensive copy.
- Cache keys must be immutable.
- Cache values should be immutable or copied.
- Volatile references should point to immutable snapshots.

## 33.3 Review checklist

For every shared data type ask:

```text
Is it immutable?
If mutable, who owns mutation?
Is it safely published?
Are all shared accesses synchronized/atomic?
Are compound invariants protected?
Are arrays/collections copied?
Can it be used as key safely?
Can consumers observe partial mutation?
```

---

# 34. Decision Matrix

| Need | Recommended |
|---|---|
| share read-only data across threads | immutable object + safe publication |
| update config read-heavy | volatile immutable snapshot / AtomicReference |
| simple cancellation flag | `volatile boolean` or `AtomicBoolean` |
| exact counter/sequence | `AtomicLong` |
| high-contention metrics counter | `LongAdder` |
| multi-field invariant | `synchronized`/lock or AtomicReference immutable aggregate |
| concurrent key-value map | `ConcurrentHashMap` |
| producer-consumer handoff | `BlockingQueue` with immutable messages |
| event object | immutable record + defensive copies |
| mutable entity shared | synchronized methods/lock or actor confinement |
| array shared across threads | copy, lock, or atomic array |
| lazy singleton | static holder / static final / volatile DCL |
| cache value | immutable snapshot |
| cache key | immutable value object |
| hot low-level concurrency | benchmark + specialized primitives |

---

# 35. Latihan

## Latihan 1 — Stop Flag

Implement worker loop with non-volatile boolean. Then fix with volatile/AtomicBoolean.

## Latihan 2 — Volatile Counter

Show lost updates with `volatile int count++`. Fix with AtomicInteger.

## Latihan 3 — Immutable Snapshot Config

Implement config holder:

```java
volatile Config config
```

where Config is immutable record with `Map.copyOf`.

## Latihan 4 — AtomicReference State

Create immutable `State(count, version)` and update with `AtomicReference.updateAndGet`.

## Latihan 5 — Multi-field Invariant

Model account `balance` and `reserved`. Show why two atomics can be inconsistent. Fix with lock or immutable pair.

## Latihan 6 — This Escape

Create class registering itself in constructor. Explain risk. Refactor to factory.

## Latihan 7 — Record Mutable Component

Create record with List. Share across threads and mutate source list. Fix with `List.copyOf`.

## Latihan 8 — ConcurrentHashMap Value Mutation

Store mutable list as value in ConcurrentHashMap. Mutate from two threads. Fix with immutable list replacement.

## Latihan 9 — BlockingQueue Command

Send immutable command through BlockingQueue. Ensure producer does not mutate after send.

## Latihan 10 — Cache Key

Use mutable list as key. Mutate after put. Fix with immutable key record.

## Latihan 11 — Safe Lazy

Implement initialization-on-demand holder singleton.

## Latihan 12 — JCStress Concept

Write a small racy publication example and reason what outcomes JMM may allow.

---

# 36. Ringkasan

Java Memory Model adalah aturan tentang bagaimana thread melihat read/write memory.

Untuk data type design, poin utamanya:

```text
Shared mutable data needs a synchronization story.
Immutable data plus safe publication is the easiest story.
```

Hal penting:

- Data race terjadi saat conflicting shared accesses tidak ordered by happens-before.
- Visibility, atomicity, dan ordering adalah hal berbeda.
- `synchronized` memberi mutual exclusion dan visibility.
- `volatile` memberi visibility/order, bukan compound atomicity.
- `final` fields membantu safe immutable object construction.
- Safe publication penting agar object terlihat benar oleh thread lain.
- Records aman dishare hanya jika components juga aman.
- Volatile reference tidak membuat mutable object graph thread-safe.
- Atomic classes cocok untuk single-variable state.
- AtomicReference + immutable state cocok untuk whole-state update.
- Concurrent collections menjaga operasi collection, bukan otomatis value mutability.
- Commands/events/snapshots sebaiknya immutable.
- Mutable entities harus punya controlled mutation dan synchronization jika shared.

Senior Java engineer melihat data type dan langsung bertanya:

```text
Apakah object ini bisa berubah?
Apakah dishare antar thread?
Bagaimana dipublish?
Apa happens-before edge-nya?
Apakah final/volatile/lock/atomic/concurrent collection cukup?
Apakah internal collection/array bocor?
```

Jika jawaban tidak jelas, production bug tinggal menunggu waktu.

---

# 37. Referensi

1. Java Language Specification SE 25 — Chapter 17: Threads and Locks  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html

2. Java Language Specification SE 25 — 17.4 Memory Model  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4

3. Java Language Specification SE 25 — 17.5 final Field Semantics  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5

4. Java SE 25 API — `java.util.concurrent` package summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/package-summary.html

5. Java SE 25 API — `java.util.concurrent.atomic` package summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html

6. Java SE 25 API — `AtomicReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html

7. Java SE 25 API — `AtomicLong`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicLong.html

8. Java SE 25 API — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

9. Java SE 25 API — `ConcurrentHashMap`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html

10. Java SE 25 API — `BlockingQueue`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

11. Java SE 25 API — `Thread`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html

12. Java SE 25 API — `Record`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Record.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-data-types-part-020.md">⬅️ Java Data Types — Part 020</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-data-types-part-022.md">Java Data Types — Part 022 ➡️</a>
</div>
