# learn-java-concurrency-and-reactive-part-009.md

# Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 009  
# Locks, Monitors, `synchronized`, and Intrinsic Locking: Mutual Exclusion, Visibility, Reentrancy, Guarded State, Wait/Notify, Lock Granularity, Contention, and Production Design

> Seri: **Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming**  
> Bagian: **009**  
> Fokus: memahami locking fundamental di Java melalui intrinsic lock/monitor dan keyword `synchronized`. Kita akan membahas mutual exclusion, visibility, happens-before, reentrancy, guarded state, monitor wait set, `wait`/`notify`/`notifyAll`, lock granularity, contention, deadlock risk, lock ordering, virtual thread considerations, dan kapan lock lebih tepat daripada `volatile`/atomic variables.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Kenapa Lock Masih Penting](#2-kenapa-lock-masih-penting)
3. [Masalah yang Diselesaikan Lock](#3-masalah-yang-diselesaikan-lock)
4. [Intrinsic Lock dan Monitor](#4-intrinsic-lock-dan-monitor)
5. [`synchronized` Method](#5-synchronized-method)
6. [`synchronized` Block](#6-synchronized-block)
7. [Lock Object: Jangan Salah Pilih](#7-lock-object-jangan-salah-pilih)
8. [Mutual Exclusion](#8-mutual-exclusion)
9. [Visibility and Happens-Before](#9-visibility-and-happens-before)
10. [Reentrancy](#10-reentrancy)
11. [Guarded State](#11-guarded-state)
12. [Compound Actions](#12-compound-actions)
13. [Multi-Field Invariants](#13-multi-field-invariants)
14. [Check-Then-Act](#14-check-then-act)
15. [Read-Modify-Write](#15-read-modify-write)
16. [Lock Granularity](#16-lock-granularity)
17. [Coarse-Grained Locking](#17-coarse-grained-locking)
18. [Fine-Grained Locking](#18-fine-grained-locking)
19. [Lock Splitting and Striping](#19-lock-splitting-and-striping)
20. [Holding Locks: Keep Critical Sections Small](#20-holding-locks-keep-critical-sections-small)
21. [Never Block on External I/O While Holding Lock](#21-never-block-on-external-io-while-holding-lock)
22. [`wait`, `notify`, `notifyAll`: Monitor Coordination](#22-wait-notify-notifyall-monitor-coordination)
23. [Guarded Suspension Pattern](#23-guarded-suspension-pattern)
24. [Why `wait` Must Be in a Loop](#24-why-wait-must-be-in-a-loop)
25. [`notify` vs `notifyAll`](#25-notify-vs-notifyall)
26. [Lost Notification and Missed Signal](#26-lost-notification-and-missed-signal)
27. [`sleep` vs `wait`](#27-sleep-vs-wait)
28. [Deadlock](#28-deadlock)
29. [Lock Ordering](#29-lock-ordering)
30. [Livelock and Starvation](#30-livelock-and-starvation)
31. [Lock Contention](#31-lock-contention)
32. [Biased/Lightweight/Heavyweight Locking: Conceptual View](#32-biasedlightweightheavyweight-locking-conceptual-view)
33. [`synchronized` and Virtual Threads](#33-synchronized-and-virtual-threads)
34. [Locks vs Atomics vs Volatile](#34-locks-vs-atomics-vs-volatile)
35. [Thread-Safe Class Design with Locks](#35-thread-safe-class-design-with-locks)
36. [Mini Case Study: Range Invariant](#36-mini-case-study-range-invariant)
37. [Mini Case Study: Bounded Buffer with Wait/Notify](#37-mini-case-study-bounded-buffer-with-waitnotify)
38. [Mini Case Study: Deadlock from Two Account Transfer](#38-mini-case-study-deadlock-from-two-account-transfer)
39. [Common Bugs](#39-common-bugs)
40. [Best Practices](#40-best-practices)
41. [Decision Matrix](#41-decision-matrix)
42. [Latihan](#42-latihan)
43. [Ringkasan](#43-ringkasan)
44. [Referensi](#44-referensi)

---

# 1. Tujuan Bagian Ini

Di part 008 kita membahas `volatile`, atomics, dan CAS.

Kita belajar:

```text
volatile -> visibility/order
atomic   -> single-variable atomic update
```

Tetapi banyak masalah concurrent tidak bisa diselesaikan dengan satu variable.

Contoh:

```java
class Range {
    private int lower;
    private int upper;
}
```

Invariant:

```text
lower <= upper
```

Jika dua field harus konsisten bersama, `volatile` atau `AtomicInteger` per field tidak cukup.

Kita butuh critical section:

```java
synchronized (lock) {
    // check and update multiple variables atomically
}
```

Target bagian ini:

- memahami intrinsic lock/monitor;
- memahami `synchronized`;
- memahami mutual exclusion;
- memahami visibility dari lock;
- memahami reentrancy;
- memahami guarded state;
- memahami wait/notify;
- memahami lock granularity;
- memahami contention dan deadlock;
- tahu kapan lock lebih tepat daripada atomic;
- mampu mendesain class thread-safe dengan lock.

Main idea:

```text
A lock protects an invariant, not just a line of code.
```

---

# 2. Kenapa Lock Masih Penting

Di era atomics, virtual threads, structured concurrency, dan reactive programming, lock tetap penting.

Kenapa?

Karena banyak state production adalah **compound state**:

- beberapa field harus konsisten;
- beberapa collection operation harus atomic secara logis;
- update tergantung validasi;
- state transition punya invariant;
- resource harus dipakai eksklusif;
- wait condition perlu koordinasi.

## 2.1 Atomics tidak selalu cukup

Atomic per variable:

```java
AtomicInteger lower = new AtomicInteger();
AtomicInteger upper = new AtomicInteger();
```

Tidak otomatis menjaga:

```text
lower <= upper
```

Karena update dua atomic berbeda bukan satu transaksi.

## 2.2 Lock membuat invariant sederhana

```java
synchronized (lock) {
    if (newLower > upper) {
        throw new IllegalArgumentException();
    }
    lower = newLower;
}
```

## 2.3 Main rule

```text
Use locks when correctness depends on multiple pieces of state being consistent together.
```

---

# 3. Masalah yang Diselesaikan Lock

Lock menyelesaikan dua masalah utama:

## 3.1 Mutual exclusion

Hanya satu thread boleh masuk critical section.

```text
Thread A enters
Thread B waits
Thread A exits
Thread B enters
```

## 3.2 Visibility

Writes sebelum unlock terlihat oleh thread yang kemudian lock monitor yang sama.

## 3.3 Lock juga mendukung coordination

Dengan monitor methods:

```java
wait()
notify()
notifyAll()
```

## 3.4 Main rule

```text
A lock gives mutual exclusion and memory visibility.
```

---

# 4. Intrinsic Lock dan Monitor

Setiap object Java punya monitor/intrinsic lock.

```java
Object lock = new Object();

synchronized (lock) {
    // owns lock's monitor
}
```

## 4.1 Intrinsic lock

Disebut intrinsic karena built-in pada object.

## 4.2 Monitor

Monitor adalah mechanism yang menggabungkan:

- mutual exclusion;
- wait set untuk `wait`;
- notification via `notify`/`notifyAll`.

## 4.3 Same object matters

```java
synchronized (lockA) { ... }
synchronized (lockB) { ... }
```

Jika `lockA != lockB`, tidak saling exclude.

## 4.4 Main rule

```text
Synchronization works only when all participating code uses the same lock object.
```

---

# 5. `synchronized` Method

Instance synchronized method:

```java
public synchronized void increment() {
    count++;
}
```

Equivalent to:

```java
public void increment() {
    synchronized (this) {
        count++;
    }
}
```

## 5.1 Static synchronized method

```java
public static synchronized void reload() {
    ...
}
```

Locks on `Class` object:

```java
synchronized (MyClass.class) {
    ...
}
```

## 5.2 Pros

- simple;
- readable for small classes;
- protects all method body.

## 5.3 Cons

- lock object is exposed as `this`;
- entire method is critical section;
- less flexible;
- may hold lock longer than needed.

## 5.4 Main rule

```text
synchronized method is simple, but synchronized block gives better lock object and scope control.
```

---

# 6. `synchronized` Block

```java
private final Object lock = new Object();

public void update() {
    synchronized (lock) {
        // critical section
    }
}
```

## 6.1 Advantages

- private lock object;
- smaller critical section;
- multiple locks possible;
- clearer guarded state.

## 6.2 Recommended for many classes

```java
private final Object lock = new Object();
```

Avoid exposing lock externally.

## 6.3 Main rule

```text
Prefer private final lock objects for internal state protection.
```

---

# 7. Lock Object: Jangan Salah Pilih

Bad lock choices:

## 7.1 Lock on public object

```java
synchronized (this) {
    ...
}
```

External code can also lock `this`, causing accidental deadlock.

## 7.2 Lock on String literal

```java
synchronized ("LOCK") {
    ...
}
```

String literals are interned and shared.

## 7.3 Lock on boxed primitive

```java
synchronized (Integer.valueOf(1)) {
    ...
}
```

Boxed values may be cached/shared.

## 7.4 Lock on mutable lock reference

```java
private Object lock = new Object();

void replaceLock() {
    lock = new Object();
}
```

Different threads may synchronize on different lock objects.

## 7.5 Good

```java
private final Object lock = new Object();
```

## 7.6 Main rule

```text
Lock object should be private, final, and dedicated to synchronization.
```

---

# 8. Mutual Exclusion

Mutual exclusion means only one thread can execute protected code at a time.

Example:

```java
final class Counter {
    private int count;
    private final Object lock = new Object();

    void increment() {
        synchronized (lock) {
            count++;
        }
    }

    int get() {
        synchronized (lock) {
            return count;
        }
    }
}
```

## 8.1 Why both read and write synchronize?

Because:

- writer needs atomicity;
- reader needs visibility;
- reader must not observe inconsistent state.

## 8.2 Main rule

```text
Protect every access to guarded mutable state with the same lock.
```

---

# 9. Visibility and Happens-Before

JLS Chapter 17 defines monitor happens-before rule:

```text
An unlock on a monitor happens-before every subsequent lock on that monitor.
```

Example:

```java
synchronized (lock) {
    value = 42;
}
```

Later:

```java
synchronized (lock) {
    System.out.println(value);
}
```

The second block sees effects of first block if it locks after unlock.

## 9.1 Lock exit publishes

Unlock publishes writes done inside synchronized block.

## 9.2 Lock enter acquires

Lock acquire sees writes published by previous unlock on same monitor.

## 9.3 Main rule

```text
A lock is both a mutual exclusion mechanism and a memory visibility mechanism.
```

---

# 10. Reentrancy

Java intrinsic locks are reentrant.

If a thread already owns lock, it can acquire it again.

Example:

```java
class Service {
    synchronized void outer() {
        inner();
    }

    synchronized void inner() {
        // same thread can enter
    }
}
```

Without reentrancy, this would deadlock itself.

## 10.1 Lock hold count

Conceptually, monitor tracks hold count per owning thread.

```text
enter outer -> hold count 1
enter inner -> hold count 2
exit inner  -> hold count 1
exit outer  -> hold count 0, unlock
```

## 10.2 Main rule

```text
synchronized is reentrant: the owning thread can acquire the same monitor repeatedly.
```

---

# 11. Guarded State

A lock should guard specific state.

Document it mentally or explicitly:

```java
// Guarded by lock
private int lower;

// Guarded by lock
private int upper;
```

## 11.1 GuardedBy convention

Some codebases use annotation/comments:

```java
@GuardedBy("lock")
private int count;
```

Even if annotation is not enforced, it documents design.

## 11.2 State ownership

The class owns state and lock.

External code should not mutate guarded fields.

## 11.3 Main rule

```text
Every lock should have a clear answer: what state does this lock guard?
```

---

# 12. Compound Actions

Compound action is multi-step operation that must be atomic logically.

Examples:

```java
check then insert
read then update
validate then assign
remove then notify
debit then credit
```

## 12.1 Broken example

```java
if (!list.contains(item)) {
    list.add(item);
}
```

Even if list methods individually synchronized, the compound operation may not be atomic unless whole sequence is locked.

## 12.2 Fixed

```java
synchronized (lock) {
    if (!list.contains(item)) {
        list.add(item);
    }
}
```

## 12.3 Main rule

```text
If multiple operations must be true as one logical action,
protect the whole sequence.
```

---

# 13. Multi-Field Invariants

Invariant:

```text
lower <= upper
```

Fields:

```java
private int lower;
private int upper;
```

## 13.1 Broken with separate volatile

```java
private volatile int lower;
private volatile int upper;
```

Volatile does not make both fields update atomically together.

## 13.2 Lock solution

```java
synchronized (lock) {
    if (newLower > upper) throw new IllegalArgumentException();
    lower = newLower;
}
```

## 13.3 Immutable snapshot alternative

```java
record RangeSnapshot(int lower, int upper) {
    RangeSnapshot {
        if (lower > upper) throw new IllegalArgumentException();
    }
}

private final AtomicReference<RangeSnapshot> range;
```

## 13.4 Main rule

```text
Multi-field invariants need one lock or one immutable aggregate reference.
```

---

# 14. Check-Then-Act

Broken lazy init:

```java
if (instance == null) {
    instance = new Service();
}
return instance;
```

Multiple threads can create multiple instances.

## 14.1 Synchronized fix

```java
synchronized Service get() {
    if (instance == null) {
        instance = new Service();
    }
    return instance;
}
```

## 14.2 Better static holder

For singleton lazy init, use static holder.

## 14.3 Main rule

```text
Check-then-act must be atomic if other threads can change the condition.
```

---

# 15. Read-Modify-Write

Classic:

```java
count = count + 1;
```

Need atomicity.

## 15.1 Lock solution

```java
synchronized (lock) {
    count = count + 1;
}
```

## 15.2 Atomic solution

```java
count.incrementAndGet();
```

## 15.3 Which better?

- single counter: atomic;
- multiple values/invariant: lock;
- high-contention metric: LongAdder;
- simple clarity: synchronized can be fine.

## 15.4 Main rule

```text
Read-modify-write needs atomic operation or critical section.
```

---

# 16. Lock Granularity

Granularity means scope/amount of state protected by one lock.

## 16.1 Coarse

One lock protects many things.

## 16.2 Fine

Many locks protect different parts.

## 16.3 Trade-off

Coarse:

- simpler;
- easier correctness;
- less concurrency.

Fine:

- more concurrency;
- more complexity;
- deadlock risk;
- harder reasoning.

## 16.4 Main rule

```text
Start with simple correct locking.
Refine granularity only when contention is proven.
```

---

# 17. Coarse-Grained Locking

Example:

```java
class Registry {
    private final Object lock = new Object();
    private final Map<String, User> users = new HashMap<>();
    private final Map<String, Role> roles = new HashMap<>();

    User getUser(String id) {
        synchronized (lock) {
            return users.get(id);
        }
    }

    Role getRole(String id) {
        synchronized (lock) {
            return roles.get(id);
        }
    }
}
```

## 17.1 Pros

- simple;
- fewer bugs;
- one invariant boundary.

## 17.2 Cons

- unrelated operations block each other;
- can reduce throughput.

## 17.3 Good when

- low contention;
- state strongly related;
- correctness more important;
- class small.

## 17.4 Main rule

```text
Coarse-grained locking is often the right first implementation.
```

---

# 18. Fine-Grained Locking

Example:

```java
private final Object userLock = new Object();
private final Object roleLock = new Object();
```

## 18.1 Pros

- more concurrency;
- less unrelated blocking.

## 18.2 Cons

- deadlock risk when acquiring multiple locks;
- harder invariant reasoning;
- more code complexity.

## 18.3 Need ordering

If sometimes acquiring both:

```java
synchronized (userLock) {
    synchronized (roleLock) {
        ...
    }
}
```

Always use same order.

## 18.4 Main rule

```text
Fine-grained locking needs strict lock ordering and clear guarded state documentation.
```

---

# 19. Lock Splitting and Striping

## 19.1 Lock splitting

Separate independent state into different locks.

```java
private final Object cacheLock = new Object();
private final Object metricsLock = new Object();
```

## 19.2 Lock striping

Use array of locks based on hash/key.

```java
private final Object[] stripes = new Object[16];

Object lockFor(String key) {
    return stripes[Math.floorMod(key.hashCode(), stripes.length)];
}
```

## 19.3 Use cases

- per-key operations;
- reduce contention;
- custom maps/cache;
- sharded counters.

## 19.4 Prefer built-in concurrent collections

Before implementing striped locks, consider `ConcurrentHashMap`.

## 19.5 Main rule

```text
Striping reduces contention by sacrificing global serialization.
Use only when invariants are per-stripe/per-key.
```

---

# 20. Holding Locks: Keep Critical Sections Small

Bad:

```java
synchronized (lock) {
    validate();
    callRemoteService();
    updateState();
    writeAuditFile();
}
```

Problems:

- holds lock during slow I/O;
- blocks other threads;
- increases latency;
- deadlock risk;
- hard cancellation.

Better:

```java
Data snapshot;
synchronized (lock) {
    snapshot = createSnapshot();
}

RemoteResult result = callRemoteService(snapshot);

synchronized (lock) {
    applyResult(result);
}
```

## 20.1 Main rule

```text
Do only the minimum state-protecting work while holding a lock.
```

---

# 21. Never Block on External I/O While Holding Lock

Holding lock while calling external systems is dangerous.

External I/O:

- DB;
- HTTP;
- file;
- message broker;
- user callback;
- plugin code;
- logging to slow sink.

## 21.1 Why

External call can:

- be slow;
- timeout;
- call back into your code;
- acquire other locks;
- block forever;
- trigger deadlock/cascading latency.

## 21.2 Better

- copy required state under lock;
- release lock;
- perform I/O;
- reacquire lock if needed;
- validate state version before applying.

## 21.3 Main rule

```text
Locks protect memory invariants, not remote calls.
```

---

# 22. `wait`, `notify`, `notifyAll`: Monitor Coordination

Every object monitor has wait set.

Methods:

```java
wait()
notify()
notifyAll()
```

Must be called while holding the object's monitor.

```java
synchronized (lock) {
    lock.wait();
}
```

If not, `IllegalMonitorStateException`.

## 22.1 `wait`

- releases monitor;
- current thread waits;
- later wakes after notify/interrupt/spurious wakeup/timeout;
- must reacquire monitor before returning.

## 22.2 `notify`

Wakes one waiting thread.

## 22.3 `notifyAll`

Wakes all waiting threads.

## 22.4 Main rule

```text
wait/notify are monitor condition coordination mechanisms,
not general event systems.
```

---

# 23. Guarded Suspension Pattern

A thread waits until condition becomes true.

```java
synchronized (lock) {
    while (!condition) {
        lock.wait();
    }
    // condition true
}
```

Producer:

```java
synchronized (lock) {
    condition = true;
    lock.notifyAll();
}
```

## 23.1 Example

```java
final class OneSlot<T> {
    private final Object lock = new Object();
    private T value;
    private boolean available;

    void put(T item) throws InterruptedException {
        synchronized (lock) {
            while (available) {
                lock.wait();
            }
            value = item;
            available = true;
            lock.notifyAll();
        }
    }

    T take() throws InterruptedException {
        synchronized (lock) {
            while (!available) {
                lock.wait();
            }
            T item = value;
            value = null;
            available = false;
            lock.notifyAll();
            return item;
        }
    }
}
```

## 23.2 Main rule

```text
Guarded wait = while condition not true, wait.
```

---

# 24. Why `wait` Must Be in a Loop

Always:

```java
while (!condition) {
    lock.wait();
}
```

Not:

```java
if (!condition) {
    lock.wait();
}
```

## 24.1 Reasons

- spurious wakeups;
- wrong thread notified;
- condition changed before reacquiring lock;
- multiple waiters;
- notifyAll wakes all but only one can proceed.

## 24.2 Main rule

```text
Wait for conditions, not notifications.
Always re-check condition after waking.
```

---

# 25. `notify` vs `notifyAll`

## 25.1 `notify`

Wakes one arbitrary waiter.

Can be efficient but risky if multiple condition predicates use same monitor.

## 25.2 `notifyAll`

Wakes all waiters.

Safer but can cause thundering herd.

## 25.3 General guidance

Use `notifyAll` unless you can prove:

- only one condition;
- any waiter can proceed;
- waking one is sufficient;
- no missed progress.

## 25.4 Main rule

```text
Prefer notifyAll for correctness unless notify is clearly safe.
```

---

# 26. Lost Notification and Missed Signal

Bad:

```java
// Thread A
if (!ready) {
    lock.wait();
}

// Thread B
ready = true;
lock.notify();
```

If notification happens before Thread A waits, A can wait forever.

## 26.1 Correct pattern

Both condition check and notify under same lock.

```java
synchronized (lock) {
    while (!ready) {
        lock.wait();
    }
}
```

Notifier:

```java
synchronized (lock) {
    ready = true;
    lock.notifyAll();
}
```

## 26.2 Main rule

```text
Condition state and notification must be protected by the same lock.
```

---

# 27. `sleep` vs `wait`

## 27.1 `sleep`

```java
Thread.sleep(1000);
```

- static method;
- current thread sleeps;
- does not release locks;
- time-based.

## 27.2 `wait`

```java
lock.wait();
```

- instance method on monitor object;
- must hold monitor;
- releases monitor while waiting;
- condition-based coordination.

## 27.3 Main rule

```text
sleep delays.
wait coordinates condition changes and releases monitor.
```

---

# 28. Deadlock

Deadlock happens when threads wait forever in cycle.

Example:

```text
Thread A holds lock1, waits for lock2
Thread B holds lock2, waits for lock1
```

## 28.1 Code

```java
synchronized (lock1) {
    synchronized (lock2) {
        ...
    }
}
```

Other thread:

```java
synchronized (lock2) {
    synchronized (lock1) {
        ...
    }
}
```

## 28.2 Conditions

Classic necessary conditions:

- mutual exclusion;
- hold and wait;
- no preemption;
- circular wait.

## 28.3 Main rule

```text
Deadlock prevention is mostly lock ordering and avoiding nested locks.
```

---

# 29. Lock Ordering

Define global order for locks.

Example account transfer:

```java
Account first = accountA.id() < accountB.id() ? accountA : accountB;
Account second = first == accountA ? accountB : accountA;

synchronized (first.lock()) {
    synchronized (second.lock()) {
        transferInternal(accountA, accountB, amount);
    }
}
```

## 29.1 Tie breaker

If IDs can equal or compare ambiguous, use tie lock.

## 29.2 Main rule

```text
If code ever acquires multiple locks, all paths must acquire them in the same order.
```

---

# 30. Livelock and Starvation

## 30.1 Livelock

Threads keep changing state in response to each other but no progress.

Example:

```text
two polite people repeatedly step aside same direction
```

## 30.2 Starvation

A thread waits too long or forever because others keep acquiring resource.

Intrinsic locks do not guarantee fairness.

## 30.3 Main rule

```text
No deadlock does not mean good progress.
Consider starvation and fairness when contention matters.
```

---

# 31. Lock Contention

Contention occurs when multiple threads compete for same lock.

Symptoms:

- many BLOCKED threads;
- high latency;
- low throughput;
- JFR monitor enter events;
- thread dumps show same monitor;
- CPU may be low or high depending workload.

## 31.1 Causes

- lock too coarse;
- long critical section;
- blocking I/O inside lock;
- hot shared counter/state;
- all requests hit same singleton lock.

## 31.2 Fixes

- reduce critical section;
- immutable snapshot;
- split lock;
- concurrent data structure;
- atomics/LongAdder for counters;
- per-key locks;
- remove shared mutable state.

## 31.3 Main rule

```text
Lock contention is a design signal: too much work is serialized.
```

---

# 32. Biased/Lightweight/Heavyweight Locking: Conceptual View

JVM implementations optimize locks.

Conceptually, locks may be cheap when uncontended and more expensive under contention.

Terms historically/implementation-wise include:

- biased locking;
- lightweight locking;
- inflated/heavyweight monitor.

Exact implementation can change across JDK versions.

## 32.1 What application developers should know

- uncontended synchronized can be quite cheap;
- contended locks are expensive;
- do not avoid synchronized solely based on old myths;
- measure before optimizing.

## 32.2 Main rule

```text
The cost of synchronized is mostly about contention and critical-section design,
not the keyword itself.
```

---

# 33. `synchronized` and Virtual Threads

Virtual threads can use `synchronized`.

Historically, blocking while inside certain synchronized/native sections could pin virtual threads to carrier threads. Newer Java work, such as JEP 491, improves behavior around synchronization and virtual threads by avoiding pinning for monitor operations in more cases.

## 33.1 Still important

Even if pinning improves, locks still serialize access.

Virtual threads do not remove lock contention.

If 10,000 virtual threads wait for same lock:

```text
only one enters at a time
```

## 33.2 Avoid long lock hold

Especially with virtual-thread-per-request systems.

## 33.3 Main rule

```text
Virtual threads reduce thread cost, not serialization caused by locks.
```

---

# 34. Locks vs Atomics vs Volatile

## 34.1 Use volatile

For simple visibility:

```java
volatile boolean running;
volatile Config config;
```

## 34.2 Use atomic

For single-variable atomic update:

```java
AtomicLong counter;
AtomicReference<State> state;
```

## 34.3 Use lock

For:

- multiple variables;
- compound action;
- invariant;
- condition wait;
- state + collection update;
- critical section clarity.

## 34.4 Main rule

```text
Lock when you need to protect a relationship between values.
```

---

# 35. Thread-Safe Class Design with Locks

## 35.1 Encapsulate state

Make fields private.

## 35.2 Define lock

```java
private final Object lock = new Object();
```

## 35.3 Guard all access

Every read/write of guarded state under lock.

## 35.4 Do not expose mutable internals

Return copies/snapshots.

## 35.5 Keep methods small

Avoid calling unknown external code under lock.

## 35.6 Document invariants

```java
// Guarded by lock: lower <= upper
```

## 35.7 Main rule

```text
Thread-safe class design is state ownership + invariant protection + safe publication.
```

---

# 36. Mini Case Study: Range Invariant

## 36.1 Broken

```java
class Range {
    private volatile int lower;
    private volatile int upper;

    void setLower(int value) {
        if (value > upper) throw new IllegalArgumentException();
        lower = value;
    }

    void setUpper(int value) {
        if (value < lower) throw new IllegalArgumentException();
        upper = value;
    }
}
```

Race can break invariant.

## 36.2 Lock solution

```java
final class Range {
    private final Object lock = new Object();

    // Guarded by lock
    private int lower;

    // Guarded by lock
    private int upper;

    void setLower(int value) {
        synchronized (lock) {
            if (value > upper) {
                throw new IllegalArgumentException();
            }
            lower = value;
        }
    }

    void setUpper(int value) {
        synchronized (lock) {
            if (value < lower) {
                throw new IllegalArgumentException();
            }
            upper = value;
        }
    }

    boolean contains(int value) {
        synchronized (lock) {
            return lower <= value && value <= upper;
        }
    }
}
```

## 36.3 Lesson

```text
Volatile per field cannot protect multi-field invariant.
```

---

# 37. Mini Case Study: Bounded Buffer with Wait/Notify

For learning only. In production, prefer `BlockingQueue`.

```java
final class BoundedBuffer<T> {
    private final Object lock = new Object();
    private final Object[] items;
    private int head;
    private int tail;
    private int count;

    BoundedBuffer(int capacity) {
        this.items = new Object[capacity];
    }

    void put(T item) throws InterruptedException {
        synchronized (lock) {
            while (count == items.length) {
                lock.wait();
            }

            items[tail] = item;
            tail = (tail + 1) % items.length;
            count++;

            lock.notifyAll();
        }
    }

    @SuppressWarnings("unchecked")
    T take() throws InterruptedException {
        synchronized (lock) {
            while (count == 0) {
                lock.wait();
            }

            Object item = items[head];
            items[head] = null;
            head = (head + 1) % items.length;
            count--;

            lock.notifyAll();
            return (T) item;
        }
    }
}
```

## 37.1 Why while?

Condition may be false after wakeup.

## 37.2 Why notifyAll?

Both producers and consumers may wait on same monitor.

## 37.3 Why prefer BlockingQueue?

Because it is tested, optimized, and has richer APIs.

## 37.4 Lesson

```text
wait/notify teaches monitor mechanics, but high-level utilities are safer.
```

---

# 38. Mini Case Study: Deadlock from Two Account Transfer

## 38.1 Broken

```java
void transfer(Account from, Account to, Money amount) {
    synchronized (from) {
        synchronized (to) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

Thread 1:

```text
transfer(A, B)
```

Thread 2:

```text
transfer(B, A)
```

Deadlock possible.

## 38.2 Fix with ordering

```java
void transfer(Account from, Account to, Money amount) {
    Account first = from.id().compareTo(to.id()) < 0 ? from : to;
    Account second = first == from ? to : from;

    synchronized (first.lock()) {
        synchronized (second.lock()) {
            from.debit(amount);
            to.credit(amount);
        }
    }
}
```

## 38.3 Better database-level design

In real financial systems, use database transactions, row locking order, idempotency, ledger model, and consistency constraints.

## 38.4 Lesson

```text
Multiple locks require global ordering.
```

---

# 39. Common Bugs

## 39.1 Synchronizing only writes

Reads outside lock see stale/inconsistent state.

## 39.2 Different locks for same state

No mutual exclusion.

## 39.3 Locking on mutable reference

Lock changes.

## 39.4 Locking on public object

External interference.

## 39.5 Calling external code under lock

Deadlock/latency.

## 39.6 `wait` outside synchronized

IllegalMonitorStateException.

## 39.7 `wait` with `if`

Spurious wakeup bug.

## 39.8 Using `notify` when multiple conditions exist

Missed progress.

## 39.9 Sleeping while holding lock

Other threads blocked unnecessarily.

## 39.10 Nested locks without ordering

Deadlock.

---

# 40. Best Practices

## 40.1 Use private final lock object

```java
private final Object lock = new Object();
```

## 40.2 Document guarded state

```java
// Guarded by lock
```

## 40.3 Synchronize all access

Reads and writes.

## 40.4 Keep critical section small

Only state manipulation.

## 40.5 Avoid external calls under lock

No HTTP/DB/callback.

## 40.6 Use wait in loop

Always.

## 40.7 Prefer notifyAll for correctness

Unless notify is proven safe.

## 40.8 Define lock ordering

If multiple locks.

## 40.9 Prefer high-level concurrency utilities

`BlockingQueue`, `Semaphore`, `CountDownLatch`, etc.

## 40.10 Measure contention before optimizing

Do not prematurely replace locks with complex atomics.

---

# 41. Decision Matrix

| Need | Recommended |
|---|---|
| Simple stop flag | `volatile` / interrupt |
| Simple counter | `AtomicLong` / `LongAdder` |
| Multi-field invariant | `synchronized` / lock |
| Compound collection operation | lock or concurrent collection atomic method |
| Per-key independent state | lock striping / `ConcurrentHashMap` |
| Producer-consumer | `BlockingQueue` usually |
| Condition wait low-level | `wait`/`notifyAll`, or better `Condition` later |
| High contention metric | `LongAdder` |
| Complex state transition | lock or immutable state + `AtomicReference` |
| Need fairness/tryLock/interruptible lock | `ReentrantLock` later |
| Read-heavy immutable snapshot | volatile/atomic reference |
| Avoid deadlock with multiple resources | global lock ordering |
| Virtual-thread request shared state | avoid hot lock; minimize critical section |

---

# 42. Latihan

## Latihan 1 — Counter with synchronized

Implementasikan counter dengan `synchronized`, lalu bandingkan dengan `AtomicLong`.

## Latihan 2 — GuardedBy

Ambil class mutable dan tuliskan state mana yang guarded by lock.

## Latihan 3 — Range Invariant

Implementasikan class `Range` thread-safe dengan invariant `lower <= upper`.

## Latihan 4 — Different Locks Bug

Buat contoh writer synchronize pada `lockA` dan reader pada `lockB`. Jelaskan kenapa salah.

## Latihan 5 — Wait in Loop

Jelaskan kenapa `while (!condition) wait()` lebih benar daripada `if`.

## Latihan 6 — Bounded Buffer

Implementasikan bounded buffer sederhana dengan `wait`/`notifyAll`.

## Latihan 7 — Deadlock

Reproduce deadlock dua lock, lalu perbaiki dengan lock ordering.

## Latihan 8 — Critical Section Refactor

Refactor code yang melakukan HTTP call di dalam synchronized block.

## Latihan 9 — Lock Granularity

Desain registry dengan dua independent maps. Bandingkan satu lock vs dua locks.

## Latihan 10 — Choose Primitive

Pilih volatile/atomic/synchronized untuk:
1. `running` flag;
2. request counter;
3. range lower/upper;
4. reload config snapshot;
5. one-slot buffer;
6. two-account transfer.

---

# 43. Ringkasan

Bagian ini membahas intrinsic locks, monitor, dan `synchronized`.

Core lessons:

- Setiap object Java punya intrinsic lock/monitor.
- `synchronized` memberi mutual exclusion dan visibility.
- Unlock happens-before subsequent lock pada monitor yang sama.
- `synchronized` method instance lock pada `this`.
- Static synchronized method lock pada class object.
- Private final lock object sering lebih baik.
- Lock harus jelas menjaga state apa.
- Reentrancy memungkinkan thread yang sama acquire lock yang sama berkali-kali.
- Compound actions harus dilindungi sebagai satu critical section.
- Multi-field invariant perlu lock atau immutable aggregate reference.
- Lock granularity adalah trade-off correctness vs concurrency.
- Critical section harus kecil.
- Jangan melakukan external I/O sambil memegang lock.
- `wait` melepas monitor dan harus dipakai dalam loop.
- `notifyAll` lebih aman daripada `notify` untuk banyak kondisi.
- `sleep` tidak melepas lock; `wait` melepas lock.
- Deadlock terjadi karena circular wait.
- Multiple locks perlu global ordering.
- Lock contention adalah sinyal serialisasi berlebihan.
- Virtual threads tidak menghapus lock contention.
- Lock sering lebih sederhana dan lebih benar daripada atomics untuk invariants.

Main rule:

```text
Use locks to protect invariants.
Keep lock scope small, lock object private,
and every access to guarded mutable state under the same lock.
```

---

# 44. Referensi

1. Java Language Specification — Chapter 17: Threads and Locks  
   https://docs.oracle.com/javase/specs/jls/se8/html/jls-17.html

2. Java SE 25 — `Object.wait`, `notify`, `notifyAll`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Object.html

3. Java SE 25 — `Thread.State`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html

4. Java SE 25 — `IllegalMonitorStateException`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/IllegalMonitorStateException.html

5. Java SE 25 — `BlockingQueue`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/BlockingQueue.html

6. Java SE 25 — `ReentrantLock`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html

7. Java SE 25 — `Condition`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/Condition.html

8. OpenJDK JEP 444 — Virtual Threads  
   https://openjdk.org/jeps/444

9. OpenJDK JEP 491 — Synchronize Virtual Threads without Pinning  
   https://openjdk.org/jeps/491

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 008](./learn-java-concurrency-and-reactive-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming — Part 010](./learn-java-concurrency-and-reactive-part-010.md)
