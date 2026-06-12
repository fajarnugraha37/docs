Bisa. Kita buat seri baru yang **tidak mengulang Collections/Streams**, tetapi melanjutkan ke area yang jauh lebih advance:

# Seri Baru: Advanced Java Thread, Virtual Threads, Concurrency, Parallelism, and Reactive Programming

Target versi Java: **Java 25+**, dengan fokus kuat pada modern Java concurrency: platform threads, virtual threads, structured concurrency, scoped values, executor design, synchronization, Java Memory Model, performance diagnostics, production failure modes, dan pengantar reactive programming.

Catatan versi penting: virtual threads sudah menjadi fitur Java sejak Java 21 dan di Java 25 tetap menjadi bagian inti model concurrency modern; dokumentasi Java 25 menyebut virtual threads sebagai thread ringan yang dijadwalkan oleh Java runtime dan cocok untuk task yang banyak menunggu I/O, bukan CPU-bound panjang. ([Oracle Documentation][1]) Structured Concurrency di Java 25 masih berstatus **preview/fifth preview** lewat JEP 505 dan API `StructuredTaskScope`, sedangkan Scoped Values ditargetkan sebagai mekanisme berbagi data immutable dalam scope yang lebih aman/lebih cocok untuk virtual threads dibanding `ThreadLocal`. ([OpenJDK][2]) Untuk reactive, seri ini akan memakai konsep Reactive Streams sebagai standar asynchronous stream processing dengan non-blocking backpressure, lalu memberi overview Project Reactor sebagai library JVM non-blocking berbasis Reactive Streams. ([Reactive Streams][3])

Format file nanti saya sarankan:

```text
learn-java-concurrency-and-reactive-part-<nnn>.md
```

Total: **35 part** karena ini memang big series.

---

# Daftar Isi Utama

## Part 000 — Big Picture: From Sequential Java to Modern Concurrent Java

File:

```text
learn-java-concurrency-and-reactive-part-000.md
```

Fokus:

* kenapa concurrency sulit;
* perbedaan concurrency, parallelism, asynchronous, non-blocking, reactive;
* mental model “work”, “thread”, “task”, “scheduler”, “resource”;
* kapan butuh thread;
* kapan butuh virtual thread;
* kapan butuh executor;
* kapan butuh parallelism;
* kapan butuh reactive;
* map besar seluruh seri;
* anti-goal: tidak memakai concurrency hanya karena terlihat “modern”.

---

## Part 001 — OS Threads, JVM Threads, Scheduling, Context Switching, and Blocking

File:

```text
learn-java-concurrency-and-reactive-part-001.md
```

Fokus:

* apa itu thread di level OS;
* stack, register, program counter;
* context switch;
* kernel scheduling;
* runnable vs blocked;
* CPU-bound vs I/O-bound;
* blocking syscall;
* thread per request model;
* kenapa platform thread mahal;
* limit praktis thread di production;
* hubungan Java `Thread` dengan OS thread.

---

## Part 002 — Java Thread Fundamentals Deep Dive

File:

```text
learn-java-concurrency-and-reactive-part-002.md
```

Fokus:

* `Thread`;
* `Runnable`;
* `Callable`;
* thread lifecycle;
* daemon vs non-daemon;
* `join`;
* `sleep`;
* interrupt;
* uncaught exception handler;
* thread naming;
* thread factory;
* why manually creating threads is usually not enough;
* production thread hygiene.

---

## Part 003 — Task, Work Unit, and Execution Model

File:

```text
learn-java-concurrency-and-reactive-part-003.md
```

Fokus:

* membedakan task vs thread;
* task ownership;
* task lifecycle;
* cancellation;
* timeout;
* retry;
* result;
* failure;
* idempotency;
* unit of concurrency;
* designing concurrent work as domain concept;
* why “spawn thread” is not architecture.

---

## Part 004 — Executor Framework Deep Dive

File:

```text
learn-java-concurrency-and-reactive-part-004.md
```

Fokus:

* `Executor`;
* `ExecutorService`;
* `ScheduledExecutorService`;
* `Future`;
* submit vs execute;
* shutdown vs shutdownNow;
* `invokeAll`, `invokeAny`;
* queueing model;
* rejection;
* thread factory;
* executor lifecycle;
* executor ownership;
* avoiding executor leaks;
* production executor design.

---

## Part 005 — Thread Pools: Sizing, Queues, Rejection, Backpressure

File:

```text
learn-java-concurrency-and-reactive-part-005.md
```

Fokus:

* fixed pool;
* cached pool;
* work queue;
* bounded vs unbounded queue;
* pool sizing for CPU-bound;
* pool sizing for I/O-bound;
* Little’s Law;
* queue latency;
* rejection policies;
* bulkhead;
* backpressure;
* saturation;
* deadlock by thread starvation;
* metrics yang wajib ada.

---

## Part 006 — Futures, CompletableFuture, and Async Composition

File:

```text
learn-java-concurrency-and-reactive-part-006.md
```

Fokus:

* `Future`;
* limitation of `Future`;
* `CompletableFuture`;
* `thenApply`, `thenCompose`, `thenCombine`;
* sync vs async stages;
* default executor;
* custom executor;
* exception handling;
* timeout;
* cancellation limitation;
* composition mental model;
* pitfalls nested futures;
* async graph debugging.

---

## Part 007 — Java Memory Model Fundamentals

File:

```text
learn-java-concurrency-and-reactive-part-007.md
```

Fokus:

* visibility;
* ordering;
* atomicity;
* happens-before;
* data race;
* stale reads;
* instruction reordering;
* CPU cache;
* compiler/JIT optimization;
* safe publication;
* final fields;
* why code “works locally” but fails in production;
* mental model JMM untuk engineer backend.

---

## Part 008 — `volatile`, Atomic Variables, and CAS

File:

```text
learn-java-concurrency-and-reactive-part-008.md
```

Fokus:

* `volatile`;
* visibility vs atomicity;
* when volatile is enough;
* `AtomicInteger`, `AtomicLong`, `AtomicReference`;
* compare-and-swap;
* ABA problem;
* `LongAdder`;
* counters under contention;
* atomic updates;
* lock-free bukan selalu faster;
* production patterns.

---

## Part 009 — Locks, Monitors, `synchronized`, and Intrinsic Locking

File:

```text
learn-java-concurrency-and-reactive-part-009.md
```

Fokus:

* monitor;
* intrinsic lock;
* `synchronized` method/block;
* reentrancy;
* wait/notify;
* lock scope;
* lock granularity;
* lock contention;
* biased/lightweight/heavyweight locking conceptually;
* when synchronized is perfectly fine;
* common mistakes.

---

## Part 010 — Explicit Locks and Coordination Primitives

File:

```text
learn-java-concurrency-and-reactive-part-010.md
```

Fokus:

* `ReentrantLock`;
* fairness;
* `tryLock`;
* interruptible lock;
* `Condition`;
* `ReadWriteLock`;
* `StampedLock`;
* `Semaphore`;
* `CountDownLatch`;
* `CyclicBarrier`;
* `Phaser`;
* choosing coordination primitives;
* failure modes.

---

## Part 011 — Immutability, Thread Confinement, and Safe Sharing

File:

```text
learn-java-concurrency-and-reactive-part-011.md
```

Fokus:

* immutability as concurrency superpower;
* thread confinement;
* stack confinement;
* request confinement;
* actor-like ownership;
* copy-on-write concept;
* defensive copy in concurrent systems;
* avoiding shared mutable state;
* designing concurrent-safe domain objects;
* records and value objects.

---

## Part 012 — ThreadLocal: Power, Danger, Memory Leak, Context Propagation

File:

```text
learn-java-concurrency-and-reactive-part-012.md
```

Fokus:

* `ThreadLocal` mental model;
* request context;
* MDC/logging context;
* security context;
* transaction context;
* memory leak in pools;
* cleanup with `remove`;
* `InheritableThreadLocal`;
* virtual thread interaction;
* why ThreadLocal becomes problematic at scale;
* context propagation alternatives.

---

## Part 013 — Virtual Threads Fundamentals

File:

```text
learn-java-concurrency-and-reactive-part-013.md
```

Fokus:

* apa itu virtual thread;
* platform thread vs virtual thread;
* carrier thread;
* mount/unmount;
* blocking made cheap;
* thread-per-task model;
* `Thread.ofVirtual`;
* `Executors.newVirtualThreadPerTaskExecutor`;
* why virtual threads are not faster CPU;
* why virtual threads simplify blocking I/O code;
* migration mental model.

---

## Part 014 — Virtual Threads Internals, Pinning, Carrier Threads, and Limitations

File:

```text
learn-java-concurrency-and-reactive-part-014.md
```

Fokus:

* scheduler virtual threads;
* carrier thread pool;
* pinning;
* synchronized and native/blocking sections;
* blocking APIs that cooperate;
* CPU-bound misuse;
* thread-local overhead;
* millions of virtual threads myth vs reality;
* diagnostics for pinned virtual threads;
* operational tuning.

---

## Part 015 — Designing Applications with Virtual Threads

File:

```text
learn-java-concurrency-and-reactive-part-015.md
```

Fokus:

* thread-per-request revisited;
* replacing async callback complexity;
* virtual thread per task;
* service-to-service calls;
* database calls;
* HTTP clients;
* blocking code style;
* timeout/cancellation;
* connection pool bottleneck;
* external resource bottleneck;
* virtual thread architecture checklist.

---

## Part 016 — Structured Concurrency

File:

```text
learn-java-concurrency-and-reactive-part-016.md
```

Fokus:

* why unstructured concurrency is dangerous;
* task tree;
* parent-child lifetime;
* failure propagation;
* cancellation propagation;
* `StructuredTaskScope`;
* fork/join subtasks;
* all succeed vs shutdown-on-failure style;
* timeout;
* observability;
* preview API caveats;
* replacing ad-hoc `CompletableFuture` graphs.

---

## Part 017 — Scoped Values and Context Passing

File:

```text
learn-java-concurrency-and-reactive-part-017.md
```

Fokus:

* why context passing matters;
* explicit parameter vs ThreadLocal vs ScopedValue;
* scoped immutable context;
* request/tenant/user/correlation ID;
* structured concurrency inheritance;
* scoped values with virtual threads;
* avoiding context leaks;
* migration from ThreadLocal;
* best practices.

---

## Part 018 — Cancellation, Timeout, Interruption, and Cooperative Shutdown

File:

```text
learn-java-concurrency-and-reactive-part-018.md
```

Fokus:

* cancellation as protocol;
* `Thread.interrupt`;
* interruption status;
* blocking methods and interrupt;
* timeouts;
* deadline propagation;
* executor shutdown;
* structured cancellation;
* cleanup;
* idempotent cancellation;
* production timeout hierarchy.

---

## Part 019 — Deadlocks, Livelocks, Starvation, and Thread Starvation

File:

```text
learn-java-concurrency-and-reactive-part-019.md
```

Fokus:

* deadlock;
* lock ordering;
* livelock;
* starvation;
* priority issues;
* thread pool starvation;
* nested submit deadlock;
* connection pool starvation;
* virtual thread resource starvation;
* diagnosis with thread dumps;
* prevention patterns.

---

## Part 020 — Concurrent Data Structures and Synchronization Strategy

File:

```text
learn-java-concurrency-and-reactive-part-020.md
```

Fokus:

* memilih data structure concurrent;
* `ConcurrentHashMap` dari sudut concurrency;
* queues;
* blocking queues;
* copy-on-write;
* atomic snapshots;
* striped locking;
* read-heavy vs write-heavy;
* contention reduction;
* invariant protection;
* jangan mengulang detail Collections sebelumnya, tetapi fokus concurrency design.

---

## Part 021 — Producer–Consumer, Pipelines, Bulkheads, and Backpressure

File:

```text
learn-java-concurrency-and-reactive-part-021.md
```

Fokus:

* producer-consumer;
* bounded queue;
* worker pool;
* backpressure;
* load shedding;
* bulkhead;
* retry storm;
* rate limiting;
* batching;
* queue depth metrics;
* graceful degradation;
* designing overload-safe systems.

---

## Part 022 — Parallelism: CPU-Bound Work, ForkJoinPool, and Work Stealing

File:

```text
learn-java-concurrency-and-reactive-part-022.md
```

Fokus:

* concurrency vs parallelism;
* CPU-bound work;
* data parallelism;
* task parallelism;
* ForkJoinPool;
* work stealing;
* fork/join tasks;
* threshold tuning;
* false sharing overview;
* parallel speedup limits;
* Amdahl’s Law;
* why virtual threads are not CPU parallelism solution.

---

## Part 023 — Parallel Streams Revisited from Concurrency Perspective

File:

```text
learn-java-concurrency-and-reactive-part-023.md
```

Fokus:

* tidak mengulang stream API;
* fokus execution model;
* common pool;
* blocking inside parallel stream;
* custom pool caveats;
* spliterator characteristics impact;
* side effects;
* associativity;
* ordering cost;
* when parallel streams are acceptable;
* why many backend apps should avoid them.

---

## Part 024 — Concurrency in Web Applications and Spring Boot

File:

```text
learn-java-concurrency-and-reactive-part-024.md
```

Fokus:

* servlet thread model;
* request thread;
* Tomcat/Jetty/Undertow thread pools;
* Spring MVC with platform threads;
* Spring MVC with virtual threads;
* WebFlux thread model overview;
* request context;
* transaction boundaries;
* DB connection pools;
* HTTP client pools;
* thread pool tuning in backend services.

---

## Part 025 — Database, Transactions, Connection Pools, and Concurrent Access

File:

```text
learn-java-concurrency-and-reactive-part-025.md
```

Fokus:

* concurrency bottleneck often DB, not thread;
* connection pool sizing;
* transaction isolation;
* lock wait;
* optimistic locking;
* pessimistic locking;
* retry;
* idempotency;
* lost update;
* write skew overview;
* virtual threads vs JDBC pool limits;
* safe concurrent DB workflows.

---

## Part 026 — Distributed Concurrency and Coordination Overview

File:

```text
learn-java-concurrency-and-reactive-part-026.md
```

Fokus:

* single JVM concurrency vs distributed concurrency;
* duplicate requests;
* idempotency keys;
* distributed locks;
* leases;
* fencing tokens;
* message ordering;
* at-least-once processing;
* exactly-once myth;
* outbox pattern overview;
* saga/compensation overview;
* practical backend coordination.

---

## Part 027 — Observability and Debugging Concurrent Java

File:

```text
learn-java-concurrency-and-reactive-part-027.md
```

Fokus:

* thread dump;
* virtual thread dump;
* deadlock detection;
* JFR;
* async profiler overview;
* lock contention profiling;
* executor metrics;
* queue metrics;
* thread pool metrics;
* MDC/context;
* tracing concurrent flows;
* diagnosing latency under load.

---

## Part 028 — Performance Engineering for Threads and Virtual Threads

File:

```text
learn-java-concurrency-and-reactive-part-028.md
```

Fokus:

* latency vs throughput;
* load testing concurrency;
* concurrency level;
* Little’s Law in practice;
* benchmarking mistakes;
* JMH for microbenchmark;
* realistic service benchmark;
* context switch cost;
* allocation;
* blocking ratio;
* carrier utilization;
* connection pool saturation;
* tuning checklist.

---

## Part 029 — Testing Concurrent Code

File:

```text
learn-java-concurrency-and-reactive-part-029.md
```

Fokus:

* why concurrency tests are hard;
* deterministic tests;
* stress tests;
* jcstress overview;
* Awaitility-style waiting;
* avoiding `Thread.sleep`;
* testing cancellation/timeout;
* testing executor shutdown;
* testing race conditions;
* testing backpressure;
* testing virtual-thread code;
* chaos/failure injection.

---

## Part 030 — Production Failure Case Studies in Concurrency

File:

```text
learn-java-concurrency-and-reactive-part-030.md
```

Fokus:

* thread pool exhaustion;
* connection pool starvation;
* deadlock;
* missed interrupt;
* retry storm;
* unbounded queue OOM;
* ThreadLocal context leak;
* virtual thread pinning incident;
* parallel stream corruption;
* CompletableFuture exception swallowed;
* stale read due to bad publication;
* production-style diagnosis and prevention.

---

## Part 031 — Reactive Programming Mental Model

File:

```text
learn-java-concurrency-and-reactive-part-031.md
```

Fokus:

* why reactive exists;
* async dataflow;
* non-blocking I/O;
* publisher/subscriber;
* demand;
* backpressure;
* cold vs hot stream;
* push vs pull;
* reactive vs virtual threads;
* reactive is not “faster by default”;
* mental model before framework.

---

## Part 032 — Reactive Streams Specification and Project Reactor Overview

File:

```text
learn-java-concurrency-and-reactive-part-032.md
```

Fokus:

* Reactive Streams contract;
* `Publisher`;
* `Subscriber`;
* `Subscription`;
* `Processor`;
* demand/request(n);
* backpressure;
* Reactor `Mono`;
* Reactor `Flux`;
* operators overview;
* schedulers overview;
* error handling overview;
* why reactive code is harder to debug.

---

## Part 033 — Reactive vs Virtual Threads vs CompletableFuture: Choosing the Right Model

File:

```text
learn-java-concurrency-and-reactive-part-033.md
```

Fokus:

* blocking request-response services;
* high-concurrency I/O;
* streaming data;
* backpressure-heavy pipelines;
* fan-out/fan-in;
* CPU-bound work;
* team skill/readability;
* operational debugging;
* library ecosystem;
* migration strategy;
* decision matrix.

---

## Part 034 — Capstone: High-Concurrency Case Processing Service

File:

```text
learn-java-concurrency-and-reactive-part-034.md
```

Fokus:

* end-to-end design;
* HTTP request handling;
* virtual thread per request;
* structured fan-out;
* scoped request context;
* DB connection pool guard;
* timeout/deadline;
* cancellation;
* bounded executor for CPU work;
* metrics/tracing;
* graceful shutdown;
* tests;
* production review checklist.

---

[1]: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html?utm_source=chatgpt.com "Thread (Java SE 25 & JDK 25)"
[2]: https://openjdk.org/jeps/505?utm_source=chatgpt.com "JEP 505: Structured Concurrency (Fifth Preview)"
[3]: https://www.reactive-streams.org/?utm_source=chatgpt.com "Reactive Streams"
