# learn-java-concurrency-and-reactive-part-008.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 008  
# `volatile`, Atomic Variables, and CAS: Visibility, Atomicity, Lock-Free Updates, ABA, LongAdder, AtomicReference, and Production State Design

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **008**  
> Fokus: memperdalam mekanisme practical setelah Java Memory Model: `volatile`, atomic variables, compare-and-swap (CAS), `AtomicInteger`, `AtomicLong`, `AtomicBoolean`, `AtomicReference`, `AtomicStampedReference`, `LongAdder`, `LongAccumulator`, field updaters, VarHandle overview, memory effects, ABA problem, contention, false confidence in “lock-free”, dan pola production untuk counters, flags, state machines, config snapshots, dan concurrency-safe updates.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Recap dari Java Memory Model](#2-recap-dari-java-memory-model)
3. [Masalah yang Ingin Diselesaikan](#3-masalah-yang-ingin-diselesaikan)
4. [`volatile`: Mental Model](#4-volatile-mental-model)
5. [`volatile` untuk Visibility](#5-volatile-untuk-visibility)
6. [`volatile` untuk Ordering](#6-volatile-untuk-ordering)
7. [`volatile` Bukan Atomic Compound Operation](#7-volatile-bukan-atomic-compound-operation)
8. [Kapan `volatile` Cukup](#8-kapan-volatile-cukup)
9. [Kapan `volatile` Tidak Cukup](#9-kapan-volatile-tidak-cukup)
10. [`AtomicInteger`, `AtomicLong`, `AtomicBoolean`](#10-atomicinteger-atomiclong-atomicboolean)
11. [Read-Modify-Write Atomic Operations](#11-read-modify-write-atomic-operations)
12. [Compare-And-Swap / Compare-And-Set](#12-compare-and-swap--compare-and-set)
13. [CAS Loop](#13-cas-loop)
14. [Side-Effect-Free Update Functions](#14-side-effect-free-update-functions)
15. [`AtomicReference`](#15-atomicreference)
16. [Immutable Snapshot with `AtomicReference`](#16-immutable-snapshot-with-atomicreference)
17. [Lock-Free State Machine](#17-lock-free-state-machine)
18. [ABA Problem](#18-aba-problem)
19. [`AtomicStampedReference` and `AtomicMarkableReference`](#19-atomicstampedreference-and-atomicmarkablereference)
20. [`LongAdder`](#20-longadder)
21. [`LongAccumulator`](#21-longaccumulator)
22. [Atomic Arrays](#22-atomic-arrays)
23. [Atomic Field Updaters](#23-atomic-field-updaters)
24. [VarHandle Overview](#24-varhandle-overview)
25. [Memory Effects of Atomic Classes](#25-memory-effects-of-atomic-classes)
26. [Performance: Contention, CAS Failure, and Spinning](#26-performance-contention-cas-failure-and-spinning)
27. [Locks vs Atomics](#27-locks-vs-atomics)
28. [Volatile vs Atomic vs Synchronized](#28-volatile-vs-atomic-vs-synchronized)
29. [Counters in Production](#29-counters-in-production)
30. [Flags in Production](#30-flags-in-production)
31. [Config Reload Pattern](#31-config-reload-pattern)
32. [One-Time Initialization Pattern](#32-one-time-initialization-pattern)
33. [Rate Limit / Permit State Pattern](#33-rate-limit--permit-state-pattern)
34. [Metrics and Observability](#34-metrics-and-observability)
35. [Common Bugs](#35-common-bugs)
36. [Mini Case Study: Volatile Counter Bug](#36-mini-case-study-volatile-counter-bug)
37. [Mini Case Study: Config Snapshot Reload](#37-mini-case-study-config-snapshot-reload)
38. [Mini Case Study: Atomic State Transition](#38-mini-case-study-atomic-state-transition)
39. [Best Practices](#39-best-practices)
40. [Decision Matrix](#40-decision-matrix)
41. [Latihan](#41-latihan)
42. [Ringkasan](#42-ringkasan)
43. [Referensi](#43-referensi)

---

# 1. Tujuan Bagian Ini

Di part 007, kita membangun fondasi Java Memory Model:

- visibility;
- ordering;
- atomicity;
- happens-before;
- safe publication;
- final fields;
- synchronized;
- volatile;
- data race.

Sekarang kita masuk ke tool practical:

```java
volatile
AtomicInteger
AtomicLong
AtomicBoolean
AtomicReference
LongAdder
LongAccumulator
AtomicStampedReference
VarHandle
```

Target bagian ini:

```text
Mampu memilih antara volatile, atomic, synchronized, lock, immutable snapshot,
dan concurrent utility berdasarkan kebutuhan visibility, atomicity,
invariant, contention, dan readability.
```

Kita akan membahas pertanyaan seperti:

```text
Kapan volatile cukup?
Kenapa volatile int++ tetap salah?
Kenapa AtomicInteger bisa increment atomic?
Apa itu CAS?
Kenapa updateAndGet function harus side-effect-free?
Apa itu ABA problem?
Kapan LongAdder lebih baik dari AtomicLong?
Kapan synchronized lebih baik daripada atomic?
Apakah lock-free selalu lebih cepat?
Bagaimana desain state machine dengan AtomicReference?
Bagaimana reload config secara aman?
```

---

# 2. Recap dari Java Memory Model

Tiga konsep utama:

## 2.1 Visibility

Satu thread menulis, thread lain melihat.

## 2.2 Ordering

Operasi terlihat dalam urutan tertentu oleh thread lain.

## 2.3 Atomicity

Operasi tidak bisa diinterleave sebagian.

## 2.4 `volatile`

Memberi visibility dan ordering untuk read/write field volatile.

## 2.5 `synchronized`

Memberi mutual exclusion dan visibility.

## 2.6 Atomics

Memberi atomic read-modify-write untuk single variable/reference.

## 2.7 Main rule

```text
volatile solves visibility/order.
atomic variables solve atomic updates on a single variable.
locks solve compound invariants.
```

---

# 3. Masalah yang Ingin Diselesaikan

Concurrent state biasanya butuh salah satu dari ini:

## 3.1 Stop flag

```java
running = false;
```

Need visibility.

## 3.2 Counter

```java
count++;
```

Need atomic read-modify-write.

## 3.3 Reference swap

```java
config = newConfig;
```

Need safe publication.

## 3.4 State transition

```text
NEW -> RUNNING -> COMPLETED
```

Need conditional atomic transition.

## 3.5 Multi-field invariant

```text
lower <= upper
```

Need lock or immutable snapshot.

## 3.6 High-contention metric

```text
many threads increment counter
```

Need contention-friendly counter.

## 3.7 Main rule

```text
Choose concurrency primitive from the state shape and update semantics.
```

---

# 4. `volatile`: Mental Model

`volatile` is a field modifier.

```java
private volatile boolean running = true;
```

A volatile field has special memory semantics:

- reads see latest writes according to volatile happens-before rules;
- write to volatile has release-like effect;
- read from volatile has acquire-like effect;
- prevents certain reordering around volatile access.

## 4.1 Simple mental model

```text
volatile field is a visibility signal.
```

When writer writes volatile:

```text
publish prior writes
```

When reader reads volatile:

```text
observe writes published before that volatile write
```

## 4.2 Example

```java
class Holder {
    int value;
    volatile boolean ready;
}
```

Writer:

```java
holder.value = 42;
holder.ready = true;
```

Reader:

```java
if (holder.ready) {
    System.out.println(holder.value); // sees 42
}
```

## 4.3 Main rule

```text
Use volatile when a single variable coordinates visibility of state.
```

---

# 5. `volatile` untuk Visibility

Classic stop flag:

```java
final class Worker implements Runnable {
    private volatile boolean running = true;

    void stop() {
        running = false;
    }

    @Override
    public void run() {
        while (running) {
            doWork();
        }
        cleanup();
    }
}
```

Without volatile, worker may never see stop.

## 5.1 Why volatile works

`stop()` writes volatile field.

Worker reads volatile field repeatedly.

Volatile write happens-before subsequent volatile read.

## 5.2 Better with interrupt?

If worker blocks:

```java
queue.take();
```

volatile flag alone may not wake it.

Use interrupt too.

```java
void stop(Thread workerThread) {
    running = false;
    workerThread.interrupt();
}
```

## 5.3 Main rule

```text
volatile makes state visible, but does not wake a blocked thread by itself.
```

---

# 6. `volatile` untuk Ordering

Volatile can publish a data structure.

```java
class ConfigHolder {
    private Config config;
    private volatile boolean initialized;

    void initialize() {
        config = loadConfig();
        initialized = true;
    }

    Config config() {
        if (!initialized) {
            throw new IllegalStateException();
        }
        return config;
    }
}
```

If thread reads `initialized == true`, it sees prior write to `config`.

## 6.1 Better design

Often simpler:

```java
private volatile Config config;
```

Then assign immutable config snapshot:

```java
this.config = loadConfig();
```

## 6.2 Main rule

```text
A volatile write can act as a publication barrier for prior writes.
```

---

# 7. `volatile` Bukan Atomic Compound Operation

This is the most common bug.

```java
private volatile int count;

void increment() {
    count++;
}
```

`count++` is:

```text
read count
add 1
write count
```

Volatile makes each read/write visible, but does not make the compound operation indivisible.

## 7.1 Interleaving

```text
count = 0

Thread A reads 0
Thread B reads 0
Thread A writes 1
Thread B writes 1

lost update
```

## 7.2 Fix

```java
AtomicInteger count = new AtomicInteger();

void increment() {
    count.incrementAndGet();
}
```

or:

```java
synchronized void increment() {
    count++;
}
```

## 7.3 Main rule

```text
volatile does not make read-modify-write atomic.
```

---

# 8. Kapan `volatile` Cukup

Use volatile for:

## 8.1 Stop flags

```java
volatile boolean running;
```

## 8.2 Readiness flag

```java
volatile boolean ready;
```

## 8.3 Immutable snapshot reference

```java
volatile Config currentConfig;
```

## 8.4 Single-writer/multiple-reader simple state

```java
volatile HealthStatus health;
```

## 8.5 Last seen value

```java
volatile Instant lastHeartbeat;
```

## 8.6 Publishing reference to immutable object

```java
volatile RoutingTable routingTable;
```

## 8.7 Main rule

```text
volatile is enough when updates are independent simple assignments
and no compound invariant must be preserved.
```

---

# 9. Kapan `volatile` Tidak Cukup

Volatile is not enough for:

## 9.1 Counters

```java
count++;
```

## 9.2 Check-then-act

```java
if (!initialized) {
    initialized = true;
    init();
}
```

## 9.3 Multi-field invariant

```java
lower <= upper
```

## 9.4 Conditional state transition

```text
if state == NEW, set RUNNING
```

Unless using atomic CAS.

## 9.5 Compound collection operation

```java
if (!list.contains(x)) {
    list.add(x);
}
```

## 9.6 Main rule

```text
If correctness depends on current value while writing next value,
volatile alone is usually not enough.
```

---

# 10. `AtomicInteger`, `AtomicLong`, `AtomicBoolean`

Atomic classes provide atomic updates on single variables.

Example:

```java
AtomicInteger counter = new AtomicInteger();

int value = counter.incrementAndGet();
```

Java SE 25 `AtomicInteger` is an int value that may be updated atomically, with operations such as `compareAndSet`, `getAndIncrement`, and update methods whose memory effects are specified via VarHandle methods.

## 10.1 AtomicInteger

Use for int counters/state.

## 10.2 AtomicLong

Use for long counters/sequences.

## 10.3 AtomicBoolean

Use for atomic flags:

```java
AtomicBoolean started = new AtomicBoolean();

if (started.compareAndSet(false, true)) {
    startOnce();
}
```

## 10.4 Main rule

```text
Atomic variables are for atomic operations on one independent variable.
```

---

# 11. Read-Modify-Write Atomic Operations

Atomic classes support compound operations atomically:

```java
incrementAndGet()
getAndIncrement()
decrementAndGet()
addAndGet(delta)
getAndAdd(delta)
updateAndGet(fn)
getAndUpdate(fn)
accumulateAndGet(x, fn)
```

## 11.1 Example

```java
AtomicLong sequence = new AtomicLong();

long id = sequence.incrementAndGet();
```

## 11.2 Example max update

```java
AtomicLong maxLatency = new AtomicLong();

void record(long latency) {
    maxLatency.updateAndGet(current -> Math.max(current, latency));
}
```

## 11.3 Main rule

```text
Use built-in atomic read-modify-write methods instead of get + set.
```

---

# 12. Compare-And-Swap / Compare-And-Set

CAS concept:

```text
if current value == expected:
    set to new value atomically
else:
    fail
```

Java method:

```java
compareAndSet(expected, newValue)
```

Example:

```java
AtomicBoolean started = new AtomicBoolean(false);

void start() {
    if (started.compareAndSet(false, true)) {
        doStart();
    }
}
```

Only one thread wins.

## 12.1 Why CAS matters

CAS enables lock-free algorithms.

Instead of locking:

```text
try update
if conflict, retry
```

## 12.2 CAS failure is normal

Under contention, multiple threads may fail CAS and retry.

## 12.3 Main rule

```text
CAS is optimistic concurrency for a single memory location.
```

---

# 13. CAS Loop

Example atomic update manually:

```java
AtomicReference<State> ref = new AtomicReference<>(initial);

void transition(Function<State, State> update) {
    while (true) {
        State current = ref.get();
        State next = update.apply(current);

        if (ref.compareAndSet(current, next)) {
            return;
        }
    }
}
```

## 13.1 Why loop?

Another thread may change value between read and CAS.

## 13.2 Risk

If high contention:

- many retries;
- CPU spinning;
- poor throughput.

## 13.3 Add validation

```java
boolean tryStart() {
    while (true) {
        State current = state.get();

        if (current != State.NEW) {
            return false;
        }

        if (state.compareAndSet(State.NEW, State.RUNNING)) {
            return true;
        }
    }
}
```

## 13.4 Main rule

```text
CAS loop must be simple, bounded in work per attempt, and safe to retry.
```

---

# 14. Side-Effect-Free Update Functions

Atomic update methods may re-apply function on CAS failure.

Java docs for atomic reference update methods state that update functions should be side-effect-free because they may be re-applied when attempted updates fail due to contention.

Bad:

```java
atomic.updateAndGet(current -> {
    sendEmail(); // side effect may happen multiple times
    return current + 1;
});
```

Good:

```java
atomic.updateAndGet(current -> current + 1);
```

Side effect after successful update:

```java
int updated = atomic.incrementAndGet();
sendMetric(updated);
```

## 14.1 Main rule

```text
Functions passed to atomic update methods must be pure/idempotent
because they may run more than once.
```

---

# 15. `AtomicReference`

`AtomicReference<V>` holds object reference updated atomically.

Example:

```java
AtomicReference<Config> configRef =
    new AtomicReference<>(initialConfig);

Config current = configRef.get();

configRef.set(newConfig);
```

## 15.1 CAS with reference

```java
configRef.compareAndSet(oldConfig, newConfig);
```

## 15.2 Use cases

- immutable config snapshot;
- routing table;
- state machine;
- cache entry reference;
- current leader/reference;
- copy-on-write data structure.

## 15.3 Main rule

```text
AtomicReference is powerful when the referenced object is immutable or treated as immutable.
```

---

# 16. Immutable Snapshot with `AtomicReference`

Example:

```java
record AppConfig(
    Map<String, String> values,
    Set<String> enabledFeatures
) {
    AppConfig {
        values = Map.copyOf(values);
        enabledFeatures = Set.copyOf(enabledFeatures);
    }
}
```

Holder:

```java
final class ConfigRegistry {
    private final AtomicReference<AppConfig> current;

    ConfigRegistry(AppConfig initial) {
        this.current = new AtomicReference<>(initial);
    }

    AppConfig get() {
        return current.get();
    }

    void reload(AppConfig next) {
        current.set(next);
    }
}
```

Readers:

```java
AppConfig config = registry.get();
```

## 16.1 Why good

- readers do not lock;
- config object immutable;
- update is atomic reference swap;
- readers see either old or new config, never partial.

## 16.2 Main rule

```text
Immutable snapshot + atomic/volatile reference is a clean read-mostly pattern.
```

---

# 17. Lock-Free State Machine

State enum:

```java
enum JobState {
    NEW,
    RUNNING,
    SUCCEEDED,
    FAILED,
    CANCELLED
}
```

Atomic state:

```java
final class JobController {
    private final AtomicReference<JobState> state =
        new AtomicReference<>(JobState.NEW);

    boolean start() {
        return state.compareAndSet(JobState.NEW, JobState.RUNNING);
    }

    boolean succeed() {
        return state.compareAndSet(JobState.RUNNING, JobState.SUCCEEDED);
    }

    boolean fail() {
        return state.compareAndSet(JobState.RUNNING, JobState.FAILED);
    }

    boolean cancel() {
        while (true) {
            JobState current = state.get();

            if (current == JobState.SUCCEEDED ||
                current == JobState.FAILED ||
                current == JobState.CANCELLED) {
                return false;
            }

            if (state.compareAndSet(current, JobState.CANCELLED)) {
                return true;
            }
        }
    }
}
```

## 17.1 Good fit

Single state variable.

## 17.2 Bad fit

If transition must update multiple fields atomically.

Then use lock or immutable aggregate snapshot.

## 17.3 Main rule

```text
Atomic state machine works best when the state is one variable/reference.
```

---

# 18. ABA Problem

CAS checks:

```text
current == expected
```

Problem:

```text
Thread A reads A
Thread B changes A -> B
Thread B changes B -> A
Thread A CAS sees A and succeeds
```

Thread A does not know value changed in between.

## 18.1 Why dangerous

If intermediate changes matter, CAS equality is insufficient.

## 18.2 Example conceptual stack

Lock-free stack pop may be affected if node removed and later reinserted.

## 18.3 Not always a problem

For simple counters/state where only current value matters, ABA may not matter.

## 18.4 Main rule

```text
ABA matters when “same value again” is not equivalent to “unchanged”.
```

---

# 19. `AtomicStampedReference` and `AtomicMarkableReference`

## 19.1 AtomicStampedReference

Stores:

```text
reference + int stamp
```

Use stamp/version to detect ABA.

```java
AtomicStampedReference<Node> ref =
    new AtomicStampedReference<>(initialNode, 0);
```

CAS includes stamp:

```java
ref.compareAndSet(expectedRef, newRef, expectedStamp, newStamp);
```

## 19.2 AtomicMarkableReference

Stores:

```text
reference + boolean mark
```

Useful for mark/delete flags in some algorithms.

## 19.3 Application code

Rarely needed in ordinary backend code.

More relevant for low-level concurrent data structures.

## 19.4 Main rule

```text
Use stamped/markable references only when reference identity alone is insufficient.
```

---

# 20. `LongAdder`

`LongAdder` is designed for high-throughput counters under contention.

```java
LongAdder requests = new LongAdder();

requests.increment();

long count = requests.sum();
```

## 20.1 Why not always AtomicLong?

`AtomicLong.incrementAndGet` updates one memory location.

Under heavy contention, many CAS failures.

`LongAdder` spreads updates across cells to reduce contention.

## 20.2 Trade-off

`sum()` may not be a perfectly atomic snapshot with concurrent updates.

Great for metrics.

Less suitable when exact immediate value controls business logic.

## 20.3 Use cases

- request count;
- metric counter;
- error count;
- event count;
- high-contention statistics.

## 20.4 Main rule

```text
Use LongAdder for high-contention statistical counters,
not for exact state decisions.
```

---

# 21. `LongAccumulator`

`LongAccumulator` generalizes `LongAdder`.

Example max:

```java
LongAccumulator maxLatency =
    new LongAccumulator(Long::max, 0L);

maxLatency.accumulate(latencyMillis);

long max = maxLatency.get();
```

## 21.1 Function requirements

Accumulator function should be associative and side-effect-free.

## 21.2 Use cases

- max latency;
- min value;
- custom reductions;
- high-contention stats.

## 21.3 Main rule

```text
LongAccumulator is for contention-friendly associative numeric aggregation.
```

---

# 22. Atomic Arrays

Classes:

```java
AtomicIntegerArray
AtomicLongArray
AtomicReferenceArray
```

Use when elements need atomic independent updates.

Example:

```java
AtomicIntegerArray buckets = new AtomicIntegerArray(16);

buckets.incrementAndGet(bucketIndex);
```

## 22.1 Use cases

- counters per shard;
- fixed bucket states;
- simple lock-free arrays.

## 22.2 Caution

Atomic array protects element operations, not higher-level invariant across elements.

## 22.3 Main rule

```text
Atomic arrays provide atomic element updates, not whole-array transactions.
```

---

# 23. Atomic Field Updaters

Classes:

```java
AtomicIntegerFieldUpdater
AtomicLongFieldUpdater
AtomicReferenceFieldUpdater
```

They update volatile fields reflectively.

Example:

```java
class Task {
    volatile int state;
}

AtomicIntegerFieldUpdater<Task> STATE =
    AtomicIntegerFieldUpdater.newUpdater(Task.class, "state");
```

## 23.1 Why use

Avoid extra AtomicInteger object per instance in memory-sensitive structures.

## 23.2 Downsides

- more complex;
- reflective constraints;
- field must be volatile;
- less type-safe/clean;
- VarHandle often preferred for low-level code.

Java SE 25 docs for atomic package mention field updaters as reflection-based utilities and indicate VarHandle should generally be used instead for that subset of functionality in modern low-level code.

## 23.3 Main rule

```text
Field updaters are advanced memory-optimization tools, not default application patterns.
```

---

# 24. VarHandle Overview

`VarHandle` is a low-level typed reference to variable-like storage with access modes.

It supports:

- plain get/set;
- opaque;
- acquire/release;
- volatile;
- compare-and-set;
- compare-and-exchange;
- get-and-update.

## 24.1 Example conceptual use

```java
private static final VarHandle STATE;

static {
    try {
        STATE = MethodHandles.lookup().findVarHandle(
            MyClass.class,
            "state",
            int.class
        );
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}
```

## 24.2 Application code

Most application code should not need VarHandle.

Use:

- `volatile`;
- atomics;
- locks;
- concurrent utilities.

## 24.3 Main rule

```text
VarHandle is for expert-level memory ordering control.
Use higher-level constructs unless you truly need it.
```

---

# 25. Memory Effects of Atomic Classes

Atomic classes now specify memory effects in terms of VarHandle access modes.

For example, Java SE 25 `AtomicInteger` methods such as `compareAndExchange` and its acquire/release variants document memory effects by referencing corresponding VarHandle operations. Atomic package docs describe atomic classes as supporting lock-free thread-safe programming on single variables, with values accessed and updated using methods corresponding to associated atomic VarHandle operations.

## 25.1 Practical interpretation

For ordinary application-level use:

- `get`/`set` behave like volatile-style access in classic atomic usage;
- CAS/update methods are atomic and have appropriate memory effects;
- acquire/release/plain variants exist for advanced tuning.

## 25.2 Do not over-optimize early

Choosing weaker memory modes incorrectly can create subtle bugs.

## 25.3 Main rule

```text
For application code, prefer ordinary atomic methods unless you can prove weaker memory modes are correct.
```

---

# 26. Performance: Contention, CAS Failure, and Spinning

Atomics are not magic.

## 26.1 Low contention

Atomics are often fast.

## 26.2 High contention

Many threads update same atomic variable.

Problems:

- CAS failures;
- retry loops;
- cache-line bouncing;
- CPU wasted spinning;
- throughput drops.

## 26.3 LongAdder helps counters

By spreading updates.

## 26.4 Locks may be better

If update is complex or contention high, a lock can be more predictable.

## 26.5 Main rule

```text
Lock-free does not mean wait-free, contention-free, or always faster.
```

---

# 27. Locks vs Atomics

## 27.1 Atomics good for

- single variable;
- counters;
- flags;
- simple state transition;
- immutable reference swap.

## 27.2 Locks good for

- multiple variables;
- complex invariants;
- compound collection operations;
- condition waiting;
- fairness needs;
- clarity.

## 27.3 Example lock better

```java
class Range {
    private int lower;
    private int upper;

    synchronized void set(int lower, int upper) {
        if (lower > upper) throw new IllegalArgumentException();
        this.lower = lower;
        this.upper = upper;
    }
}
```

Can be done with immutable snapshot + AtomicReference too, but lock may be simpler.

## 27.4 Main rule

```text
Use atomics for single-location state.
Use locks for multi-location invariants.
```

---

# 28. Volatile vs Atomic vs Synchronized

## 28.1 Volatile

- visibility;
- ordering;
- simple assignment;
- no mutual exclusion;
- no compound atomicity.

## 28.2 Atomic

- visibility;
- atomic single-variable updates;
- CAS;
- no multi-variable invariant.

## 28.3 Synchronized

- mutual exclusion;
- visibility;
- multi-field invariant;
- blocking;
- simpler reasoning for complex state.

## 28.4 Main rule

```text
volatile publishes.
atomic updates one thing atomically.
synchronized protects a critical section.
```

---

# 29. Counters in Production

## 29.1 Exact counter controlling behavior

Use `AtomicLong`.

Example:

```java
AtomicLong inFlight = new AtomicLong();

boolean tryEnter(long max) {
    while (true) {
        long current = inFlight.get();
        if (current >= max) return false;
        if (inFlight.compareAndSet(current, current + 1)) return true;
    }
}

void leave() {
    inFlight.decrementAndGet();
}
```

But semaphore may be better.

## 29.2 Statistical metric counter

Use `LongAdder`.

```java
LongAdder requestCount = new LongAdder();
requestCount.increment();
```

## 29.3 Gauge

For exact current value:

```java
AtomicInteger active = new AtomicInteger();
```

## 29.4 Main rule

```text
Use AtomicLong for exact decisions.
Use LongAdder for high-throughput metrics.
```

---

# 30. Flags in Production

## 30.1 Simple visible flag

```java
volatile boolean shutdownRequested;
```

## 30.2 One-time action

```java
AtomicBoolean started = new AtomicBoolean();

if (started.compareAndSet(false, true)) {
    start();
}
```

## 30.3 State enum

```java
AtomicReference<State> state;
```

## 30.4 Blocking worker stop

Use volatile/atomic plus interrupt.

## 30.5 Main rule

```text
Use volatile for simple visibility.
Use AtomicBoolean for one-winner transitions.
```

---

# 31. Config Reload Pattern

Use immutable config snapshot:

```java
record FeatureConfig(
    Map<String, Boolean> flags
) {
    FeatureConfig {
        flags = Map.copyOf(flags);
    }
}
```

Holder:

```java
final class FeatureConfigRegistry {
    private final AtomicReference<FeatureConfig> current;

    FeatureConfigRegistry(FeatureConfig initial) {
        this.current = new AtomicReference<>(initial);
    }

    FeatureConfig current() {
        return current.get();
    }

    void reload(FeatureConfig next) {
        current.set(next);
    }
}
```

## 31.1 Why not mutate map in place?

If you mutate existing map:

- readers see partial update;
- need lock;
- iterator may fail;
- invariant may break.

## 31.2 Main rule

```text
For read-mostly shared config, replace immutable snapshot atomically.
```

---

# 32. One-Time Initialization Pattern

## 32.1 AtomicBoolean guard

```java
AtomicBoolean initialized = new AtomicBoolean();

void initializeOnce() {
    if (!initialized.compareAndSet(false, true)) {
        return;
    }

    doInitialize();
}
```

## 32.2 Problem if initialization fails

If `doInitialize` fails, state already true.

Better state machine:

```java
enum InitState {
    NEW,
    INITIALIZING,
    INITIALIZED,
    FAILED
}
```

Use AtomicReference for transitions.

## 32.3 Main rule

```text
One-time initialization needs failure semantics, not only AtomicBoolean.
```

---

# 33. Rate Limit / Permit State Pattern

Atomic counter can implement simple in-flight limit, but `Semaphore` is usually clearer.

## 33.1 Atomic version

```java
final class InFlightLimiter {
    private final AtomicInteger inFlight = new AtomicInteger();
    private final int max;

    InFlightLimiter(int max) {
        this.max = max;
    }

    boolean tryAcquire() {
        while (true) {
            int current = inFlight.get();
            if (current >= max) return false;
            if (inFlight.compareAndSet(current, current + 1)) return true;
        }
    }

    void release() {
        inFlight.decrementAndGet();
    }
}
```

## 33.2 Semaphore version

```java
Semaphore semaphore = new Semaphore(max);

if (semaphore.tryAcquire()) {
    try {
        doWork();
    } finally {
        semaphore.release();
    }
}
```

## 33.3 Main rule

```text
Do not build custom atomic limiters when Semaphore expresses the intent better.
```

---

# 34. Metrics and Observability

For atomic state, expose:

## 34.1 Counters

- increments;
- failures;
- CAS retry count if custom CAS loop;
- contention indicators.

## 34.2 State

- current state;
- transition success/failure;
- invalid transition attempts.

## 34.3 Config

- config version;
- reload success/failure;
- active snapshot version.

## 34.4 In-flight

- active;
- rejected due to max;
- max observed.

## 34.5 Main rule

```text
Atomic state should still be observable as business state.
```

---

# 35. Common Bugs

## 35.1 Volatile counter

```java
volatile int count;
count++;
```

## 35.2 Atomic get then set

```java
atomic.set(atomic.get() + 1);
```

Not atomic as a pair.

## 35.3 Side effects in update function

```java
ref.updateAndGet(x -> {
    audit();
    return next(x);
});
```

May run multiple times.

## 35.4 AtomicReference to mutable object

```java
AtomicReference<Map<String, String>> ref;
ref.get().put("k", "v");
```

Reference atomic, map mutation not.

## 35.5 CAS loop without exit/backoff under contention

CPU spin.

## 35.6 AtomicBoolean init without failure state

Failed init blocks retry.

## 35.7 LongAdder for exact limit

`sum()` not suitable for precise gate.

## 35.8 Main rule

```text
Atomic reference protects the reference, not the object’s internal mutation.
```

---

# 36. Mini Case Study: Volatile Counter Bug

## 36.1 Code

```java
class RequestStats {
    private volatile long total;

    void increment() {
        total++;
    }

    long total() {
        return total;
    }
}
```

## 36.2 Bug

Lost updates under concurrency.

## 36.3 Fix for exact count

```java
class RequestStats {
    private final AtomicLong total = new AtomicLong();

    void increment() {
        total.incrementAndGet();
    }

    long total() {
        return total.get();
    }
}
```

## 36.4 Fix for metric under high contention

```java
class RequestStats {
    private final LongAdder total = new LongAdder();

    void increment() {
        total.increment();
    }

    long total() {
        return total.sum();
    }
}
```

## 36.5 Lesson

```text
volatile visibility does not prevent lost updates.
```

---

# 37. Mini Case Study: Config Snapshot Reload

## 37.1 Bad

```java
class ConfigRegistry {
    private final Map<String, String> config = new HashMap<>();

    void reload(Map<String, String> next) {
        config.clear();
        config.putAll(next);
    }

    String get(String key) {
        return config.get(key);
    }
}
```

Problems:

- data race;
- partial config visible;
- HashMap not thread-safe;
- readers may see inconsistent state.

## 37.2 Good

```java
record Config(Map<String, String> values) {
    Config {
        values = Map.copyOf(values);
    }
}

class ConfigRegistry {
    private final AtomicReference<Config> current;

    ConfigRegistry(Config initial) {
        current = new AtomicReference<>(initial);
    }

    void reload(Config next) {
        current.set(next);
    }

    String get(String key) {
        return current.get().values().get(key);
    }
}
```

## 37.3 Lesson

```text
Replace immutable snapshots instead of mutating shared structures in place.
```

---

# 38. Mini Case Study: Atomic State Transition

## 38.1 Requirement

Job can start once.

## 38.2 Code

```java
enum JobState {
    NEW,
    RUNNING,
    DONE
}

class Job {
    private final AtomicReference<JobState> state =
        new AtomicReference<>(JobState.NEW);

    boolean start() {
        return state.compareAndSet(JobState.NEW, JobState.RUNNING);
    }

    boolean finish() {
        return state.compareAndSet(JobState.RUNNING, JobState.DONE);
    }
}
```

## 38.3 Good

Single state variable, simple transitions.

## 38.4 Add invalid transition metrics

```java
if (!state.compareAndSet(JobState.NEW, JobState.RUNNING)) {
    metrics.incrementInvalidStart();
    return false;
}
```

## 38.5 Lesson

```text
AtomicReference is excellent for simple explicit state transitions.
```

---

# 39. Best Practices

## 39.1 Use volatile for simple visibility

Flags and immutable reference publication.

## 39.2 Use atomics for single-variable atomic updates

Counters, CAS states.

## 39.3 Use LongAdder for high-contention metrics

Not exact control.

## 39.4 Use immutable snapshots with AtomicReference

Read-mostly config/routing.

## 39.5 Keep CAS loops simple

No I/O, no blocking, no side effects.

## 39.6 Avoid side effects in update functions

They may re-run.

## 39.7 Use locks for multi-field invariants

Simpler and safer.

## 39.8 Avoid custom lock-free algorithms

Unless necessary and tested.

## 39.9 Measure contention

Do not assume atomics are faster.

## 39.10 Prefer clarity

Concurrency correctness beats cleverness.

---

# 40. Decision Matrix

| Need | Tool |
|---|---|
| Stop flag | `volatile boolean` + interrupt if blocking |
| Ready flag | `volatile boolean` |
| Publish immutable config | `volatile Config` or `AtomicReference<Config>` |
| Increment exact counter | `AtomicLong` |
| High-throughput metric counter | `LongAdder` |
| One-time start | `AtomicBoolean.compareAndSet` |
| Explicit state transition | `AtomicReference<State>` |
| Multi-field invariant | `synchronized` / lock / immutable aggregate ref |
| Max/min metric under contention | `LongAccumulator` |
| Detect ABA | `AtomicStampedReference` |
| Mark/delete ref | `AtomicMarkableReference` |
| Atomic array slots | `AtomicIntegerArray` / `AtomicReferenceArray` |
| Memory-sensitive atomic field | VarHandle or field updater |
| Advanced memory ordering | VarHandle |
| Rate limiting permits | `Semaphore` usually better |
| Complex collection mutation | concurrent collection or lock |

---

# 41. Latihan

## Latihan 1 — Volatile Flag

Implementasikan worker dengan `volatile boolean running`, lalu tambahkan interrupt untuk blocking wait.

## Latihan 2 — Volatile Counter Bug

Buat test multi-thread yang menunjukkan lost update pada `volatile int count++`.

## Latihan 3 — AtomicInteger Counter

Perbaiki counter dengan `AtomicInteger`.

## Latihan 4 — LongAdder Metrics

Implementasikan request counter dengan `LongAdder`.

## Latihan 5 — AtomicBoolean Start Once

Buat service yang hanya boleh start sekali.

## Latihan 6 — AtomicReference Config

Buat immutable config snapshot dan registry dengan `AtomicReference`.

## Latihan 7 — CAS Loop

Implementasikan `tryAcquire` sederhana dengan `AtomicInteger`.

## Latihan 8 — Side Effect Bug

Tulis contoh `updateAndGet` yang salah karena ada side effect, lalu perbaiki.

## Latihan 9 — ABA Explanation

Jelaskan ABA problem dengan timeline A -> B -> A.

## Latihan 10 — Choose Primitive

Untuk setiap kasus, pilih volatile/atomic/lock/LongAdder/Semaphore:
1. stop worker;
2. count requests;
3. update range lower/upper;
4. reload config;
5. limit 50 concurrent calls;
6. job state transition.

---

# 42. Ringkasan

Bagian ini memperdalam `volatile`, atomics, dan CAS.

Core lessons:

- `volatile` memberi visibility dan ordering.
- `volatile` tidak memberi atomic compound operation.
- `volatile` cocok untuk flags dan immutable reference publication.
- Atomic variables memberi atomic updates untuk satu variable.
- CAS adalah optimistic atomic conditional update.
- CAS loop harus simple dan safe to retry.
- Atomic update functions harus side-effect-free.
- `AtomicReference` cocok untuk immutable snapshots dan state machines.
- ABA terjadi ketika value berubah A -> B -> A dan CAS tidak mendeteksi intermediate change.
- `AtomicStampedReference` membantu mendeteksi ABA dengan version/stamp.
- `LongAdder` cocok untuk high-contention metric counters.
- `LongAdder.sum()` bukan exact control gate under concurrent updates.
- `LongAccumulator` cocok untuk associative numeric aggregation.
- Atomic arrays memberi atomic element updates.
- Field updaters/VarHandle adalah advanced tools.
- Atomics bisa lambat under high contention karena CAS retries.
- Lock-free tidak selalu lebih cepat.
- Locks lebih baik untuk multi-field invariants.
- Immutable snapshot + atomic/volatile reference adalah pola production yang sangat kuat.

Main rule:

```text
Use the simplest primitive that matches the state:
volatile for visibility,
atomic for one-variable atomicity,
LongAdder for metrics,
locks for invariants,
immutable snapshots for read-mostly shared state.
```

---

# 43. Referensi

1. Java SE 25 — `AtomicInteger`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html

2. Java SE 25 — `AtomicLong`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicLong.html

3. Java SE 25 — `AtomicBoolean`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicBoolean.html

4. Java SE 25 — `AtomicReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html

5. Java SE 25 — Package `java.util.concurrent.atomic`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/package-summary.html

6. Java SE 25 — `LongAdder`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAdder.html

7. Java SE 25 — `LongAccumulator`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/LongAccumulator.html

8. Java SE 25 — `AtomicStampedReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicStampedReference.html

9. Java SE 25 — `AtomicMarkableReference`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicMarkableReference.html

10. Java SE 25 — `VarHandle`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/VarHandle.html

11. Java Language Specification — Chapter 17: Threads and Locks  
    https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html

12. OpenJDK jcstress  
    https://openjdk.org/projects/code-tools/jcstress/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-concurrency-and-reactive-part-007.md](./learn-java-concurrency-and-reactive-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-concurrency-and-reactive-part-009.md](./learn-java-concurrency-and-reactive-part-009.md)
