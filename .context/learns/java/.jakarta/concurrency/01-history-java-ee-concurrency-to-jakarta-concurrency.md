# Part 1 — Historical Map: Java EE Concurrency Utilities to Jakarta Concurrency

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `01-history-java-ee-concurrency-to-jakarta-concurrency.md`  
**Scope:** Java 8–25, Java EE/Jakarta EE, `javax.enterprise.concurrent`, `jakarta.enterprise.concurrent`, Jakarta Batch historical positioning  
**Baseline stable:** Jakarta EE 11, Jakarta Concurrency 3.1, Jakarta Batch 2.1  
**Status seri:** Part 1 dari 35. Seri belum selesai.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kita ingin memiliki mental model yang kuat tentang **mengapa Jakarta Concurrency ada**, bukan sekadar tahu API-nya.

Target pemahaman:

1. Memahami evolusi dari Java SE concurrency, Java EE Concurrency Utilities, sampai Jakarta Concurrency.
2. Memahami kenapa concurrency di application server/container tidak bisa diperlakukan sama seperti concurrency di aplikasi Java SE biasa.
3. Memahami transisi namespace dari `javax.*` ke `jakarta.*` dan dampaknya ke migrasi aplikasi enterprise.
4. Memahami posisi Jakarta Batch dalam sejarah Java EE/Jakarta EE.
5. Memahami compatibility Java 8 sampai Java 25 dalam konteks Jakarta EE.
6. Memahami perbedaan portable specification vs vendor implementation.
7. Memiliki peta besar sebelum masuk ke API detail pada part berikutnya.

Part ini adalah fondasi historis dan arsitektural. Tujuannya bukan nostalgia, tetapi agar kita tidak salah mengambil keputusan desain ketika menghadapi aplikasi enterprise modern yang masih membawa warisan Java EE lama, tapi harus jalan di runtime Jakarta EE baru, Kubernetes, cloud, Java 21+, dan mungkin virtual threads.

---

## 2. Kenapa Sejarah Ini Penting?

Banyak engineer mempelajari concurrency dari Java SE terlebih dahulu:

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
executor.submit(() -> doWork());
```

Di aplikasi command-line, service mandiri, atau Spring Boot standalone, pola seperti ini bisa sah selama lifecycle, shutdown, resource ownership, dan observability dikendalikan dengan benar.

Namun dalam Java EE/Jakarta EE, aplikasi biasanya berjalan di dalam **container**:

```text
Application code
     ↓
Jakarta EE APIs
     ↓
Application server / runtime
     ↓
JVM
     ↓
Operating system
```

Container bukan hanya menjalankan kode. Container juga mengelola:

- request lifecycle
- transaction lifecycle
- security identity
- naming/JNDI context
- dependency injection
- classloader aplikasi
- connection pool
- persistence context
- lifecycle deploy/redeploy/undeploy
- thread pool internal
- monitoring dan management

Karena itu, ketika aplikasi membuat thread sendiri tanpa sepengetahuan container, aplikasi dapat merusak asumsi container.

Masalahnya bukan “Java tidak bisa membuat thread”. Masalahnya adalah:

> Thread yang tidak dikelola container dapat membawa pekerjaan keluar dari kontrol lifecycle, security, transaction, dan observability container.

Inilah akar lahirnya **Concurrency Utilities for Java EE** dan kemudian **Jakarta Concurrency**.

---

## 3. Timeline Besar

Secara kasar, evolusinya seperti ini:

```text
Java 1.0–1.4
  Thread, Runnable, synchronized, wait/notify

Java 5
  java.util.concurrent / JSR-166
  Executor, ExecutorService, Future, BlockingQueue, Lock, Atomic*

Java EE 6 and earlier
  Container-managed runtime exists,
  but standard portable concurrency API for application components is limited.
  Many apps use EJB timers, JMS, vendor APIs, or unsafe manual threads.

Java EE 7
  JSR 236: Concurrency Utilities for Java EE
  javax.enterprise.concurrent.*
  ManagedExecutorService, ManagedScheduledExecutorService,
  ManagedThreadFactory, ContextService

Java EE 8
  Keeps Java EE concurrency model.
  Namespace remains javax.*

Jakarta EE 8
  First Jakarta-branded release after Eclipse transition,
  still mostly javax.* namespace for compatibility.

Jakarta EE 9
  Big namespace switch from javax.* to jakarta.*
  Jakarta Concurrency 2.0
  Jakarta Batch 2.0

Jakarta EE 10
  Jakarta Concurrency 3.0
  Jakarta Batch 2.1

Jakarta EE 11
  Jakarta Concurrency 3.1
  Jakarta Batch 2.1
  Minimum Java SE 17+
  Better alignment with modern Java, including Java 21-era features.

Jakarta EE 12 and beyond
  Jakarta Concurrency 3.2 and Batch 2.2 under development.
```

The important transition is not only naming. It is a shift in enterprise Java’s compatibility boundary:

```text
Old world:
  Java EE / javax / Java 8 era

Transition world:
  Jakarta EE 8 / still javax

New world:
  Jakarta EE 9+ / jakarta namespace
  Java 11/17/21+ runtime expectations
```

---

## 4. Java SE Concurrency Before Enterprise Concurrency

Before understanding Jakarta Concurrency, we need to separate two layers:

```text
Java SE concurrency
  General-purpose primitives and libraries.

Jakarta EE concurrency
  Container-integrated concurrency for enterprise components.
```

Java SE provides low-level and mid-level concurrency tools:

- `Thread`
- `Runnable`
- `Callable`
- `Future`
- `Executor`
- `ExecutorService`
- `ScheduledExecutorService`
- `ForkJoinPool`
- `CompletableFuture`
- locks and atomics
- blocking queues
- concurrent collections
- virtual threads from Java 21
- structured concurrency preview APIs in newer Java versions
- scoped values in Java 25

These are powerful but container-agnostic. They do not inherently understand:

- CDI context
- Jakarta Security identity
- JTA transaction lifecycle
- JNDI naming context
- web request lifecycle
- application server shutdown
- module classloader lifecycle
- runtime-managed thread accounting

So Java SE concurrency answers:

> “How can I run multiple tasks concurrently?”

Jakarta Concurrency answers:

> “How can an application component run concurrent work without violating the contract of the Jakarta EE container?”

That is a much more constrained and production-relevant question.

---

## 5. The Pre-JSR-236 Problem

Before Java EE 7, enterprise applications had several imperfect options.

### 5.1 Use Manual Threads

Example:

```java
new Thread(() -> {
    sendEmail();
}).start();
```

At first glance this looks harmless.

But in an application server, this can create many subtle problems:

```text
Request thread receives HTTP request
  ↓
Application creates unmanaged thread
  ↓
Request completes
  ↓
Transaction/security/request context ends
  ↓
Unmanaged thread keeps running
  ↓
Thread may still reference old classloader, EntityManager, user identity, CDI bean, logger MDC, or stale config
```

Failure examples:

| Failure | Cause |
|---|---|
| Classloader leak | Thread retains references to app classes after redeploy |
| Stale CDI context | Thread uses request-scoped object after request ended |
| Transaction confusion | Work expects transaction but none exists, or tries to use invalid resource |
| Security ambiguity | Async work no longer knows who initiated it |
| Shutdown hang | Container cannot stop thread cleanly |
| Invisible workload | Monitoring does not know this task exists |
| Resource exhaustion | App bypasses server thread pool and creates uncontrolled threads |

This is why “do not create unmanaged threads in Java EE” became a long-standing rule of thumb.

The more precise version is:

> Application code should not create or manage threads in a way that bypasses the container’s lifecycle, context, and resource management.

### 5.2 Use EJB Asynchronous Methods

EJB provided some managed async capability:

```java
@Stateless
public class ReportService {

    @Asynchronous
    public Future<ReportResult> generateReport(...) {
        return new AsyncResult<>(doGenerateReport());
    }
}
```

This was useful but tied to EJB programming model.

Limitations:

- less flexible for generic task orchestration
- not as close to Java SE executor model
- awkward for non-EJB components
- hard to compose with modern `CompletableFuture`
- dependent on EJB availability and usage style

### 5.3 Use EJB Timer Service

For scheduled work:

```java
@Schedule(hour = "2", minute = "0")
public void nightlyJob() {
    runNightlyJob();
}
```

Useful for enterprise timers, but not the same as general-purpose executor/scheduled executor.

### 5.4 Use JMS / Messaging

Messaging was often used to decouple asynchronous work:

```text
Request
  ↓
Persist business data
  ↓
Send JMS message
  ↓
MDB consumes message asynchronously
```

This is often a better architecture for durable async work, but it is heavier than simple in-memory async offload and requires message broker semantics.

### 5.5 Use Vendor-Specific APIs

Many servers had their own work manager APIs.

For example:

```text
WebSphere WorkManager
WebLogic WorkManager
GlassFish-specific executors
```

These solved real problems, but portability suffered.

An application using a vendor-specific work manager might be hard to move from one server to another.

### 5.6 Use Quartz or External Scheduler

Quartz and external schedulers were common for scheduled jobs.

They can be excellent, but they are not a standard Jakarta EE concurrency API.

---

## 6. JSR 236: Concurrency Utilities for Java EE

JSR 236 standardized a portable model for concurrency in Java EE application components.

The core idea:

> Bring the familiar Java SE executor model into Java EE, but make it managed by the container.

It introduced the package:

```java
javax.enterprise.concurrent
```

The central APIs were:

```java
ManagedExecutorService
ManagedScheduledExecutorService
ManagedThreadFactory
ContextService
```

Conceptually:

| API | Java SE analog | Container-aware value |
|---|---|---|
| `ManagedExecutorService` | `ExecutorService` | Executes async tasks on managed threads |
| `ManagedScheduledExecutorService` | `ScheduledExecutorService` | Schedules tasks with container-managed threads |
| `ManagedThreadFactory` | `ThreadFactory` | Creates threads known to the container |
| `ContextService` | no direct exact equivalent | Captures/propagates selected container contexts |

This specification was included in Java EE 7.

The official focus was asynchronous capabilities for application components, largely by extending the Java SE concurrency utilities model into the enterprise environment.

---

## 7. The Core Design Shift

The shift introduced by JSR 236 is this:

```text
Before:
  Application owns thread creation and executor lifecycle.

After:
  Container owns thread resources and lifecycle.
  Application submits units of work.
```

This is a critical distinction.

Bad mental model:

```text
I need a background thread.
```

Better mental model:

```text
I need to submit a unit of work to a managed execution facility, with known lifecycle, context, capacity, and failure behavior.
```

The second statement forces better engineering questions:

1. Who owns the thread?
2. What context should be propagated?
3. What happens on undeploy?
4. What happens on cancellation?
5. What happens on transaction rollback?
6. What happens if the task outlives the request?
7. What happens if the cluster has multiple nodes?
8. What happens if the downstream system is slow?
9. How is the work audited?
10. How is it observed operationally?

This is the difference between “using concurrency” and “engineering concurrency.”

---

## 8. Java EE 7/8 Era: `javax.enterprise.concurrent`

In Java EE 7 and Java EE 8, the namespace was:

```java
javax.enterprise.concurrent.ManagedExecutorService
javax.enterprise.concurrent.ManagedScheduledExecutorService
javax.enterprise.concurrent.ManagedThreadFactory
javax.enterprise.concurrent.ContextService
```

Example:

```java
import javax.annotation.Resource;
import javax.enterprise.concurrent.ManagedExecutorService;

public class ReportController {

    @Resource
    private ManagedExecutorService executor;

    public void submitReport() {
        executor.submit(() -> {
            generateReport();
        });
    }
}
```

This era is often found in:

- Java EE 7 apps on Java 7/8
- Java EE 8 apps on Java 8
- older WebLogic/WebSphere deployments
- older Payara/GlassFish deployments
- legacy enterprise monoliths

Common migration reality:

```text
Java 8 + Java EE 7/8 + javax.*
  ↓
Java 11/17 + Jakarta EE 9+ + jakarta.*
```

That migration is rarely just search-and-replace because dependencies, app server versions, bytecode targets, libraries, frameworks, XML descriptors, generated sources, and test containers also need alignment.

---

## 9. Jakarta EE 8: Branding Change Without Namespace Change

Jakarta EE 8 was a transition release.

Important point:

```text
Jakarta EE 8 still largely used javax.* APIs.
```

This matters because many engineers assume:

```text
Jakarta EE == jakarta.* package names
```

That is not always true.

More precise:

```text
Jakarta EE 8      → mostly javax.*
Jakarta EE 9+     → jakarta.* namespace
```

So a dependency named “Jakarta” may still expose `javax` packages if it targets Jakarta EE 8.

This is a common source of migration confusion.

---

## 10. Jakarta EE 9: Namespace Break

Jakarta EE 9 introduced the major namespace transition:

```text
javax.* → jakarta.*
```

For concurrency:

```java
javax.enterprise.concurrent.ManagedExecutorService
```

became:

```java
jakarta.enterprise.concurrent.ManagedExecutorService
```

The package changed, but the conceptual model remained continuous.

Example after migration:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;

public class ReportController {

    @Resource
    private ManagedExecutorService executor;

    public void submitReport() {
        executor.submit(() -> {
            generateReport();
        });
    }
}
```

The risky assumption is:

> “If it compiles after changing imports, migration is done.”

Usually false.

Migration must consider:

- application server Jakarta EE level
- Java runtime version
- CDI version
- JPA/Persistence version
- REST/JAX-RS version
- Servlet version
- Bean Validation version
- Batch version
- Security integration
- library compatibility
- test framework compatibility
- deployment descriptor namespaces
- bytecode target
- old transitive dependencies still pulling `javax.*`

---

## 11. Jakarta Concurrency 2.x, 3.x, and Current Baseline

The Jakarta Concurrency version line roughly maps like this:

| Platform | Concurrency version | Namespace | Notes |
|---|---:|---|---|
| Java EE 7 | JSR 236 / 1.x style | `javax.*` | First standardized Java EE concurrency utilities |
| Java EE 8 | 1.x style | `javax.*` | Continued Java EE model |
| Jakarta EE 8 | 1.x style | `javax.*` | Eclipse transition, compatibility release |
| Jakarta EE 9 | 2.0 | `jakarta.*` | Namespace transition |
| Jakarta EE 10 | 3.0 | `jakarta.*` | Modern Jakarta baseline |
| Jakarta EE 11 | 3.1 | `jakarta.*` | Java SE 17+ platform baseline |
| Jakarta EE 12 future | 3.2 under development | `jakarta.*` | Not stable baseline yet |

For this series:

```text
Main stable target:
  Jakarta EE 11 + Jakarta Concurrency 3.1

Legacy comparison:
  Java EE 7/8 + javax.enterprise.concurrent

Future awareness:
  Jakarta Concurrency 3.2 under development for Jakarta EE 12
```

We will not teach from an obsolete-only perspective, but we will keep legacy migration visible because real enterprise systems often live across multiple generations.

---

## 12. Jakarta Batch Historical Positioning

Jakarta Batch has a related but different history.

Concurrency utilities answer:

> “How do I run asynchronous/concurrent tasks inside the container?”

Batch answers:

> “How do I define, execute, monitor, stop, restart, and govern long-running batch jobs?”

Batch is not merely “executor with XML.” It has a distinct model:

```text
Job
  Step
    Batchlet or Chunk
      Reader / Processor / Writer
  Flow / Split / Decision
  Job repository
  JobOperator
  Checkpoint
  Restart
```

Historical simplification:

| Era | Batch API | Namespace | Notes |
|---|---:|---|---|
| Java EE 7 | JSR 352 Batch Applications for Java Platform | `javax.batch.*` | Standardized batch programming model |
| Java EE 8 | Batch 1.x | `javax.batch.*` | Continued model |
| Jakarta EE 8 | Batch 1.0 | `javax.batch.*` | Transition release |
| Jakarta EE 9 | Batch 2.0 | `jakarta.batch.*` | Namespace transition |
| Jakarta EE 10 | Batch 2.1 | `jakarta.batch.*` | Stable modern version |
| Jakarta EE 11 | Batch 2.1 | `jakarta.batch.*` | Included in Jakarta EE 11 platform release |
| Jakarta EE 12 future | Batch 2.2 under development | `jakarta.batch.*` | Future enhancements |

Jakarta Batch and Jakarta Concurrency interact, but they are not substitutes.

### 12.1 Simple In-Memory Async Work

Use managed executor when:

```text
- task is short or bounded
- does not need durable restart after JVM crash
- can fail with normal request/application error handling
- does not need job repository
- does not need operator stop/restart/status
```

Example:

```text
Generate small notification asynchronously after request.
```

### 12.2 Durable Batch Work

Use Jakarta Batch when:

```text
- job may run for minutes/hours
- work must be restartable
- progress must be checkpointed
- operator needs stop/restart/status
- records are processed in chunks
- skip/retry policy matters
- job history matters
```

Example:

```text
Nightly recalculation of case ageing for 5 million records.
```

### 12.3 Messaging May Be Better

Use messaging when:

```text
- work is event-driven
- durability is message-based
- consumer scaling matters
- exactly/effectively-once delivery semantics are required
- producer and consumer should be decoupled
```

Example:

```text
When a case is approved, publish event for downstream correspondence generation.
```

### 12.4 Workflow Engine May Be Better

Use BPMN/workflow engine when:

```text
- business process spans human tasks
- state machine is explicit
- SLA/escalation logic matters
- process visualization matters
- compensation and long-running business state are central
```

Example:

```text
Regulatory enforcement case moves across review, approval, appeal, legal review, and closure.
```

---

## 13. Compatibility: Java 8 to Java 25

This series covers Java 8 to Java 25, but Jakarta EE versions do not all support all Java versions equally.

A practical map:

| Java version | Enterprise relevance |
|---:|---|
| Java 8 | Legacy Java EE 7/8 baseline, still common in old enterprise systems |
| Java 11 | Common migration step from Java 8; not enough for Jakarta EE 11 platform baseline |
| Java 17 | Minimum for Jakarta EE 11; major modern LTS baseline |
| Java 21 | Virtual threads final; modern LTS; important for high-concurrency I/O workloads |
| Java 22–24 | Intermediate releases with continued preview/incubator evolution |
| Java 25 | New LTS generation; structured concurrency still preview at JEP 505 stage; scoped values final via JEP 506 |

Important caution:

> Java language/runtime features and Jakarta EE specification support are separate compatibility axes.

You can have:

```text
Java 21 runtime
  but application server does not expose virtual-thread-aware managed executors.
```

Or:

```text
Jakarta EE 10 runtime
  but application code still depends on old javax libraries.
```

Or:

```text
Java 17 runtime
  but library dependency compiled against Java 21 bytecode.
```

So compatibility must be checked across at least four axes:

```text
1. Java runtime version
2. Jakarta EE platform version
3. application server implementation version
4. dependency/library namespace and bytecode version
```

---

## 14. Java 21+ Changes the Performance Model, Not the Container Contract

Virtual threads became final in Java 21.

They change the cost model of blocking concurrency:

```text
Platform threads:
  expensive, OS-backed, limited in number

Virtual threads:
  lightweight, JDK-managed, cheap enough for many blocking tasks
```

This is a major shift.

But it does not automatically remove Jakarta Concurrency.

Why?

Because Jakarta Concurrency is not only about thread cost.

It is about:

- container integrity
- context propagation
- lifecycle ownership
- security identity
- transaction boundaries
- application redeploy safety
- managed shutdown
- operational control

Virtual threads solve a different problem:

> “Can we afford many blocking concurrent tasks?”

Jakarta Concurrency solves:

> “Can enterprise application components run concurrent tasks without escaping container management?”

These concerns overlap, but they are not identical.

### 14.1 Bad Conclusion

```text
Java 21 has virtual threads, so managed executors are obsolete.
```

This is wrong.

### 14.2 Better Conclusion

```text
Java 21 virtual threads may influence how managed executors are implemented and sized,
but application code still needs a container-sanctioned execution model inside Jakarta EE.
```

In other words:

```text
Virtual threads reduce thread scarcity.
They do not remove lifecycle, context, security, transaction, or observability concerns.
```

---

## 15. Structured Concurrency and Scoped Values in the Historical Map

Modern Java is moving toward better concurrency structure.

Structured concurrency treats a group of related tasks as a single unit of work. This improves cancellation, failure handling, and observability.

Scoped values provide a safer way to share immutable contextual data across call chains and child tasks, especially in a virtual-thread-heavy world.

But in enterprise Jakarta EE, these features must be interpreted carefully.

### 15.1 Structured Concurrency

Conceptual model:

```text
Request
  ├── Task A
  ├── Task B
  └── Task C

The request owns the lifetime of A/B/C.
If one fails, the structure defines how others are cancelled or joined.
```

This is very attractive for request fan-out:

```text
Load profile
Load permissions
Load dashboard summary
Load pending tasks
```

But in Jakarta EE today, portability depends on container support and Java version. Structured concurrency remains a preview API in Java 25 according to the OpenJDK JEP line.

So in this series, structured concurrency will be treated as:

```text
Important forward-looking mental model,
not the main portable Jakarta EE baseline yet.
```

### 15.2 Scoped Values

ThreadLocal has long been used for:

- security context
- tenant context
- correlation ID
- locale
- request metadata
- transaction-like contextual data

But ThreadLocal becomes problematic when there are many virtual threads or when context must be passed safely to child tasks.

Scoped values offer a structured, immutable, lexically-scoped context mechanism.

For enterprise code, this suggests a future direction:

```text
From:
  ambient mutable ThreadLocal context

Toward:
  explicit, bounded, immutable scoped context
```

However, Jakarta EE contexts such as CDI request scope, security context, and transaction context are not automatically replaced by Scoped Values.

They are different abstraction layers.

---

## 16. The `javax` to `jakarta` Migration Problem in Detail

The namespace transition is one of the most operationally painful shifts in enterprise Java.

### 16.1 Source Code Imports

Old:

```java
import javax.enterprise.concurrent.ManagedExecutorService;
import javax.annotation.Resource;
import javax.batch.operations.JobOperator;
```

New:

```java
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.annotation.Resource;
import jakarta.batch.operations.JobOperator;
```

This part is straightforward.

### 16.2 Deployment Descriptors

XML descriptors may also use schema locations or namespaces tied to older versions.

Examples:

```text
web.xml
ejb-jar.xml
persistence.xml
beans.xml
batch job XML references
```

Not every XML file migrates the same way.

### 16.3 Transitive Dependencies

A frequent hidden problem:

```text
Application source imports jakarta.*
But library dependency still imports javax.*
```

This can create runtime errors such as:

```text
ClassNotFoundException
NoClassDefFoundError
ClassCastException
ServiceLoader mismatch
CDI discovery mismatch
```

### 16.4 Mixed Classpath

Danger pattern:

```text
jakarta.servlet-api
javax.servlet-api
jakarta.enterprise.cdi-api
javax.enterprise.cdi-api
jakarta.persistence-api
javax.persistence-api
```

If both appear in the same application, you may compile but fail at runtime, or worse: get ambiguous behavior.

### 16.5 Server Runtime Mismatch

Example mismatch:

```text
App compiled against jakarta.*
Deployed to Java EE 8 server expecting javax.*
```

or:

```text
App compiled against javax.*
Deployed to Jakarta EE 10 server expecting jakarta.*
```

Some transformation tools exist, but relying on automatic transformation for complex enterprise apps requires careful testing.

### 16.6 Test Runtime Mismatch

Unit tests may pass because they mock everything.

Integration tests fail because:

- test container is wrong version
- embedded server exposes old namespace
- Arquillian/Testcontainers setup is outdated
- CDI test extension uses wrong API
- batch runtime implementation is incompatible

### 16.7 Build Tool Alignment

Maven/Gradle must align:

- API dependencies
- plugin versions
- compiler release target
- bytecode version
- annotation processors
- test runtime
- shaded dependencies
- generated sources

---

## 17. Specification vs Implementation

A top-tier engineer must separate:

```text
Specification:
  What portable behavior is promised.

Implementation:
  How a specific server provides it.
```

Jakarta Concurrency specification says what APIs and semantics should exist.

But implementations differ in operational details such as:

- default executor thread pool size
- queue size
- rejection behavior configuration
- context propagation options
- management console controls
- metrics exposure
- virtual thread support
- scheduled executor clustering behavior
- shutdown timeout
- integration with vendor transaction/security subsystems

So never design production behavior based only on “it worked locally.”

Ask:

```text
1. Is this behavior specified?
2. Or is it vendor implementation detail?
3. Is this portable across servers?
4. Does our production runtime document this behavior?
5. Do we test it under redeploy, shutdown, overload, and failure?
```

---

## 18. Application Server Landscape

Jakarta Concurrency and Jakarta Batch support depends on server and version.

Common runtimes:

| Runtime | Notes |
|---|---|
| GlassFish / Eclipse GlassFish | Reference-style Jakarta EE lineage |
| Payara | GlassFish-derived enterprise runtime |
| WildFly | Red Hat/JBoss ecosystem; strong Jakarta EE support |
| Open Liberty | Modular IBM Liberty runtime; Jakarta EE feature-based model |
| WebLogic | Enterprise commercial runtime with long legacy support |
| WebSphere Liberty | IBM enterprise runtime lineage |
| TomEE | Tomcat plus Jakarta EE features |
| Plain Tomcat | Servlet container, not full Jakarta EE platform by default |

Important distinction:

```text
Tomcat alone is not a full Jakarta EE application server.
```

So if code expects:

```java
@Resource ManagedExecutorService executor;
```

it may not work in plain Tomcat unless additional implementation/support is provided.

Similarly, Jakarta Batch requires a batch runtime implementation. The API jar alone is not enough.

---

## 19. Portable Resource Names and Vendor Configuration

In Java EE/Jakarta EE, managed executors may be accessed through resource injection or JNDI lookup.

Example conceptual injection:

```java
@Resource
private ManagedExecutorService executor;
```

But real production systems often configure named executors:

```java
@Resource(lookup = "java:comp/DefaultManagedExecutorService")
private ManagedExecutorService executor;
```

or vendor-specific names:

```text
concurrent/myBusinessExecutor
concurrent/reportExecutor
concurrent/batchOffloadExecutor
```

Portable API does not mean all operational configuration is portable.

You must distinguish:

```text
Portable code contract:
  ManagedExecutorService API

Runtime-specific config:
  pool size, queue, context propagation, thread name, hung task detection
```

This is similar to JDBC:

```text
Portable API:
  javax.sql.DataSource / jakarta.sql equivalent ecosystem

Runtime-specific config:
  connection pool size, timeout, validation query, leak detection
```

---

## 20. What Was Standardized and What Was Not

Jakarta Concurrency standardizes the programming model.

It does not fully standardize every operational concern.

### 20.1 Standardized

- managed executor API shape
- scheduled executor API shape
- managed thread factory API shape
- context service concept
- integration concept with application components
- managed lifecycle expectation

### 20.2 Not Fully Portable or Often Vendor-Specific

- exact default pool size
- exact queue capacity
- exact scheduling misfire behavior
- exact admin console options
- exact metrics names
- exact thread naming conventions
- exact virtual thread support strategy
- exact cluster singleton scheduling
- exact timeout/hung task policy

This matters because many production incidents occur in the gap between:

```text
API-level correctness
```

and

```text
runtime operational correctness
```

---

## 21. The Enterprise Concurrency Decision Matrix

Before Jakarta Concurrency existed, engineers often mapped every async need to one of:

```text
Thread
EJB @Asynchronous
EJB Timer
JMS
Quartz
Vendor WorkManager
```

After Jakarta Concurrency and Jakarta Batch, the decision matrix becomes more nuanced.

| Requirement | Better fit |
|---|---|
| Short async offload, no durable restart | ManagedExecutorService |
| Time-based in-memory schedule | ManagedScheduledExecutorService |
| Need container-known custom thread | ManagedThreadFactory |
| Need context capture/propagation | ContextService |
| Long-running restartable job | Jakarta Batch |
| Event-driven durable async | Messaging/JMS/Kafka/etc. |
| Human process/state machine | Workflow/BPMN engine |
| Infrastructure one-shot job | Kubernetes Job or external scheduler |
| Cron-like infra job | Kubernetes CronJob or enterprise scheduler |
| CPU-parallel in standalone service | Java SE executor/virtual threads/ForkJoin depending case |

The mistake is using one mechanism for everything.

Top-tier engineers ask:

```text
What is the lifecycle of this work?
What is the durability requirement?
What is the restart behavior?
What is the ownership boundary?
What is the operational control plane?
What is the audit model?
What is the failure recovery model?
```

---

## 22. Historical Anti-Patterns That Still Exist

Many modern systems still contain old anti-patterns because they were written before managed concurrency was available or before the team understood container semantics.

### 22.1 `new Thread()` in Web Application

```java
new Thread(() -> processLargeFile()).start();
```

Problem:

- no managed lifecycle
- no shutdown control
- no observability
- context may be invalid
- redeploy leak risk

Better:

```java
managedExecutor.submit(() -> processLargeFile());
```

But even that may be insufficient if the job is long-running and restartable.

Better still for durable processing:

```text
Submit Jakarta Batch job
or persist job request and let batch/messaging process it.
```

### 22.2 `Executors.newFixedThreadPool` in Singleton Bean

```java
@ApplicationScoped
public class WorkerPool {
    private final ExecutorService executor = Executors.newFixedThreadPool(20);
}
```

This bypasses container thread management.

Problems:

- container does not own threads
- shutdown must be manually implemented
- context propagation absent
- metrics separate
- security/transaction assumptions break

### 22.3 `CompletableFuture.supplyAsync` Without Executor

```java
CompletableFuture.supplyAsync(() -> loadSomething());
```

This uses the default common pool unless otherwise configured.

In Jakarta EE, that is usually not what you want.

Better:

```java
CompletableFuture.supplyAsync(() -> loadSomething(), managedExecutor);
```

### 22.4 Batch Job Implemented as Huge Request

```text
HTTP request starts
  ↓
Controller processes 5 million records
  ↓
Request times out
  ↓
User retries
  ↓
Duplicate side effects
```

Better:

```text
HTTP request validates and submits job
  ↓
Job ID returned
  ↓
Batch runtime processes job
  ↓
User/operator polls job status
  ↓
Job is restartable and auditable
```

### 22.5 Scheduled Task on Every Cluster Node

```text
Node A schedule runs 02:00
Node B schedule runs 02:00
Node C schedule runs 02:00
```

If not designed for clustering, the job runs three times.

Better:

- cluster singleton mechanism
- database lock
- distributed lock
- job repository duplicate prevention
- external scheduler targeting one executor

---

## 23. Why `javax` Legacy Still Matters in 2026+

Even if modern Jakarta uses `jakarta.*`, real enterprise systems still have large `javax.*` footprints.

Reasons:

1. Government/enterprise systems have long lifecycles.
2. Certified platforms lag behind latest specs.
3. Vendor support contracts may keep Java EE runtimes alive.
4. Migration is risky and costly.
5. Many libraries only recently completed Jakarta migration.
6. Some internal frameworks wrap old APIs.
7. Batch jobs and integration code are often least frequently refactored.

Therefore, a top-tier engineer should be bilingual:

```text
Understand javax-era code.
Design jakarta-era code.
Plan migration between them.
```

---

## 24. Migration Strategy: From Java EE Concurrency to Jakarta Concurrency

A practical migration plan should not start with search-and-replace.

### 24.1 Inventory

Find usages:

```text
javax.enterprise.concurrent
javax.batch
javax.annotation.Resource
Executors.
new Thread
Timer
TimerTask
CompletableFuture.supplyAsync without executor
@Asynchronous
@Schedule
vendor work manager APIs
Quartz jobs
```

Example search patterns:

```bash
grep -R "javax.enterprise.concurrent" src/main/java
grep -R "javax.batch" src/main/java src/main/resources
grep -R "Executors\." src/main/java
grep -R "new Thread" src/main/java
grep -R "CompletableFuture\.supplyAsync" src/main/java
grep -R "@Schedule" src/main/java
grep -R "@Asynchronous" src/main/java
```

### 24.2 Classify Workloads

For every async/concurrent/batch usage, classify:

```text
1. short async task
2. scheduled task
3. long-running batch
4. event-driven durable work
5. human workflow
6. infrastructure job
7. CPU-parallel computation
```

### 24.3 Define Target Execution Model

Do not migrate API mechanically.

Ask if the old mechanism was correct.

Example:

```text
Old:
  EJB @Schedule triggers huge nightly processing.

Possible target:
  External scheduler submits Jakarta Batch job.
```

### 24.4 Migrate Namespace

Only after classification:

```text
javax.enterprise.concurrent → jakarta.enterprise.concurrent
javax.batch → jakarta.batch
javax.annotation → jakarta.annotation
```

### 24.5 Align Runtime

Verify:

```text
Application server supports target Jakarta EE version.
Java runtime version is supported.
All dependencies are jakarta-compatible.
Batch runtime exists.
Managed executor resources are configured.
Operational metrics are exposed.
```

### 24.6 Test Lifecycle Events

Test beyond happy path:

- task success
- task failure
- cancellation
- timeout
- redeploy
- server shutdown
- cluster duplicate execution
- transaction rollback
- security identity propagation
- context cleanup
- batch restart
- partial failure

---

## 25. Java 8–25 Practical Guidance

### 25.1 If You Are on Java 8 + Java EE 7/8

Likely environment:

```text
javax.*
application server legacy version
no virtual threads
managed executor available if Java EE 7+
Batch API likely javax.batch
```

Guidance:

- avoid introducing new unmanaged thread pools
- use `ManagedExecutorService` where appropriate
- use Java EE Batch for restartable jobs
- avoid default `CompletableFuture` common pool
- prepare code for future namespace migration
- isolate concurrency abstractions behind application service interfaces

### 25.2 If You Are Migrating to Java 17 + Jakarta EE 10/11

Likely environment:

```text
jakarta.*
modern CDI/JPA/REST/etc.
Jakarta Concurrency 3.x
Jakarta Batch 2.1
```

Guidance:

- remove mixed `javax`/`jakarta` dependencies
- align app server version early
- configure managed executors explicitly
- treat batch runtime as operational subsystem
- test redeploy/shutdown/cluster behavior
- use Java 17 language improvements where safe

### 25.3 If You Are on Java 21+

Additional possibilities:

```text
virtual threads
better blocking I/O concurrency model
new observability patterns
```

Guidance:

- use virtual threads where runtime officially supports them
- do not bypass managed executor just to use virtual threads
- distinguish virtual thread support in Java from support in your Jakarta server
- benchmark with real DB/API constraints
- watch for connection pool bottlenecks
- watch for rate limits
- watch for synchronized/pinning history depending JDK version

### 25.4 If You Are Evaluating Java 25

Additional possibilities:

```text
Scoped Values final
Structured Concurrency still preview in JDK 25 line
```

Guidance:

- scoped values are important for future context propagation design
- structured concurrency is useful mental model but preview API means cautious production use
- do not build portable Jakarta EE application architecture around preview APIs unless you control runtime and upgrade policy

---

## 26. Conceptual Map: Execution Facility vs Work Semantics

A common design mistake is confusing the mechanism that runs code with the semantics of the work.

```text
Execution facility:
  Thread pool, managed executor, scheduler, virtual thread executor, batch runtime

Work semantics:
  request response, async side effect, durable job, event processing, workflow transition
```

Example:

```text
A report generation process can be executed by:
  - request thread
  - managed executor
  - batch job
  - message consumer
  - Kubernetes job

But each gives different semantics.
```

Comparison:

| Mechanism | Durable? | Restartable? | Operator visible? | Context aware? | Good for |
|---|---:|---:|---:|---:|---|
| Request thread | No | No | Low | Yes | fast synchronous work |
| Managed executor | No by default | No by default | Medium | Yes | bounded async work |
| Managed scheduled executor | No by default | No by default | Medium | Yes | simple periodic work |
| Jakarta Batch | Yes via repository | Yes | High | Container-integrated | long-running jobs |
| Messaging | Yes if broker durable | Redelivery-based | Medium/High | depends | event-driven async |
| Workflow engine | Yes | Process-state based | High | depends | business processes |
| Kubernetes Job | Pod/job-level | restart policy | Infra-level | No Jakarta context by default | infra batch |

This is why top-tier engineers do not ask only:

```text
Can I run this in another thread?
```

They ask:

```text
What semantics must this work have?
```

---

## 27. Enterprise Workload Taxonomy

Use this taxonomy when reading old code or designing new code.

### 27.1 Request-Bound Work

Properties:

```text
- starts with request
- must finish before response
- shares request identity
- shares request observability
- must be low latency
```

Good for:

- validation
- small DB query
- simple command
- synchronous authorization

Bad for:

- huge export
- bulk recalculation
- slow external API fan-out

### 27.2 Request-Initiated Async Work

Properties:

```text
- initiated by request
- may finish after response
- should record initiator
- often needs audit/correlation
- may or may not be durable
```

Good for:

- send notification
- warm cache
- trigger small post-processing

Mechanism:

- managed executor
- messaging
- job request table

### 27.3 Scheduled Work

Properties:

```text
- time-triggered
- not directly user-triggered
- may run on cluster
- duplicate prevention matters
```

Mechanism:

- managed scheduled executor
- EJB timer
- Jakarta Batch launched by scheduler
- external scheduler
- Kubernetes CronJob

### 27.4 Batch Work

Properties:

```text
- processes many records/items
- long-running
- must checkpoint
- must restart
- must report progress
- often needs skip/retry policy
```

Mechanism:

- Jakarta Batch
- Spring Batch outside Jakarta context
- external data pipeline

### 27.5 Event-Driven Work

Properties:

```text
- triggered by event/message
- decoupled producer/consumer
- durability via broker/log
- ordering may matter
```

Mechanism:

- JMS
- Kafka
- RabbitMQ
- event bus

### 27.6 Workflow/Process Work

Properties:

```text
- business state spans time
- human tasks
- approval/escalation
- SLA
- compensation
- audit-heavy
```

Mechanism:

- BPMN/workflow engine
- state machine engine
- custom process orchestration

---

## 28. How This History Shapes the Rest of the Series

The rest of the series will build from this map.

Part 2 will explain container integrity in depth:

```text
Why managed concurrency exists at all.
```

Part 3–6 will cover Jakarta Concurrency APIs:

```text
ManagedExecutorService
ManagedScheduledExecutorService
ManagedThreadFactory
ContextService
```

Part 7–16 will cover enterprise failure boundaries:

```text
transactions
security
CDI
CompletableFuture
virtual threads
structured concurrency
backpressure
cancellation
observability
production failure modes
```

Part 17 onward will cover Jakarta Batch:

```text
job model
JSL
batchlet
chunk
checkpoint
restart
skip/retry
partitioning
control plane
listeners
file/API/batch integration
cluster
performance
security/audit
case study
```

The key learning path is:

```text
History
  ↓
Container contract
  ↓
Managed concurrency APIs
  ↓
Boundary engineering
  ↓
Batch runtime model
  ↓
Production orchestration
```

---

## 29. Top 1% Mental Models

This section condenses what a top-tier engineer should internalize from the historical evolution.

### 29.1 Thread Is Not the Unit of Design

Old thinking:

```text
I need a thread.
```

Better thinking:

```text
I need an execution model with defined lifecycle, context, capacity, cancellation, failure, and observability semantics.
```

### 29.2 Executor Is Not Enough

An executor can run code.

But enterprise systems also need:

- who initiated the work
- what transaction boundary applies
- what identity applies
- whether the work survives restart
- whether duplicate execution is acceptable
- whether operator can stop/restart it
- how progress is reported

### 29.3 Namespace Migration Is Not Architecture Migration

Changing:

```text
javax → jakarta
```

does not automatically fix:

- bad async boundaries
- hidden unmanaged threads
- non-idempotent batch writers
- unbounded queues
- cluster duplicate jobs
- missing audit trail
- poor cancellation behavior

### 29.4 Virtual Threads Change Capacity, Not Semantics

Virtual threads make blocking concurrency cheaper.

They do not decide:

- transaction design
- job restartability
- security propagation
- audit attribution
- cluster coordination
- idempotency

### 29.5 Batch Is About Recoverable Progress

Batch is not just running code in the background.

Batch is about:

```text
large work + durable progress + restart + operator control + governed failure
```

### 29.6 Portability Ends Where Runtime Operations Begin

Jakarta specifications give a portable API model.

Production behavior still depends on server configuration and implementation details.

Therefore, engineering must include:

- spec reading
- vendor documentation
- integration testing
- failure simulation
- operational runbook

---

## 30. Practical Checklist

Use this checklist when reviewing an enterprise Java application.

### 30.1 Find Unsafe Concurrency

Search for:

```text
new Thread
Executors.new*
Timer
TimerTask
ForkJoinPool.commonPool
CompletableFuture.supplyAsync without executor
parallelStream inside request path
static ExecutorService
custom scheduler loop
while(true) background worker
```

### 30.2 Find Legacy Java EE/Jakarta Boundary

Search for:

```text
javax.enterprise.concurrent
jakarta.enterprise.concurrent
javax.batch
jakarta.batch
javax.annotation.Resource
jakarta.annotation.Resource
```

### 30.3 Classify Each Workload

For each workload, answer:

```text
Is it request-bound?
Is it request-initiated async?
Is it scheduled?
Is it batch?
Is it event-driven?
Is it workflow/process state?
Is it infrastructure-level?
```

### 30.4 Check Semantics

Ask:

```text
Does it need durable restart?
Does it need checkpoint?
Can it run twice?
Can it be cancelled?
Can it be retried?
Who is the actor?
What is the audit trail?
What happens on redeploy?
What happens on node crash?
What happens on cluster duplicate?
```

### 30.5 Check Runtime Fit

Verify:

```text
Application server version
Jakarta EE version
Java runtime version
Namespace alignment
Batch runtime availability
Managed executor resources
Pool/queue limits
Metrics
Shutdown behavior
Cluster behavior
```

---

## 31. Thought Experiment

Imagine a regulatory case management platform with these requirements:

1. A user uploads a CSV with 500,000 license records.
2. The system validates every record.
3. Some records require external API enrichment.
4. Failed records must be downloadable as a report.
5. Operator must be able to stop and restart the process.
6. Duplicate submission must not duplicate downstream effects.
7. The audit trail must show who initiated the job and what input file was used.
8. The platform runs on three Kubernetes pods.

Question:

```text
Should this be implemented as:
  A. HTTP request processing
  B. ManagedExecutorService task
  C. ManagedScheduledExecutorService task
  D. Jakarta Batch job
  E. JMS consumer
  F. BPMN workflow
```

Reasoning:

- HTTP request is wrong because work is long-running and restartable.
- Simple managed executor is probably insufficient because durable progress, stop/restart, and job history are required.
- Scheduled executor is wrong because the trigger is user submission, not time.
- Jakarta Batch is a strong fit because records can be processed in chunks with checkpoint/restart.
- Messaging may be used internally for external API enrichment or event publication, but not necessarily as the whole job model.
- BPMN may be excessive unless human approval/state transitions are part of the process.

Likely architecture:

```text
HTTP request
  ↓
Store upload metadata and file manifest
  ↓
Start Jakarta Batch job with job parameters
  ↓
Chunk reader reads records
  ↓
Processor validates/enriches
  ↓
Writer persists valid results and error rows idempotently
  ↓
Job repository tracks progress
  ↓
Operator can stop/restart
  ↓
Audit trail records initiatedBy/inputManifest/resultSummary
```

This is the type of architectural reasoning this series aims to build.

---

## 32. Summary

Concurrency in Jakarta EE evolved because enterprise applications needed a safe way to run asynchronous work without bypassing the application server’s control.

The core historical line is:

```text
Java SE concurrency
  ↓
JSR 236 Concurrency Utilities for Java EE
  ↓
javax.enterprise.concurrent in Java EE 7/8
  ↓
Jakarta EE transition
  ↓
jakarta.enterprise.concurrent in Jakarta EE 9+
  ↓
Jakarta Concurrency 3.1 in Jakarta EE 11
```

Jakarta Batch evolved as the standard model for long-running, restartable, checkpointed jobs:

```text
JSR 352 / javax.batch
  ↓
Jakarta Batch / jakarta.batch
  ↓
Batch 2.1 in Jakarta EE 10/11
```

The essential lesson:

> Do not treat enterprise concurrency as merely running code on another thread. Treat it as workload orchestration under container lifecycle, context, capacity, failure, restartability, and audit constraints.

This historical understanding prevents many real production failures:

- unmanaged thread leaks
- context loss
- transaction misuse
- cluster duplicate execution
- non-restartable long-running jobs
- common pool starvation
- missing audit attribution
- fragile namespace migration

---

## 33. References

- Jakarta Concurrency 3.1 specification page: <https://jakarta.ee/specifications/concurrency/3.1/>
- Jakarta Concurrency 3.1 specification document: <https://jakarta.ee/specifications/concurrency/3.1/jakarta-concurrency-spec-3.1>
- Jakarta Concurrency specification index: <https://jakarta.ee/specifications/concurrency/>
- Jakarta Batch 2.1 specification page: <https://jakarta.ee/specifications/batch/2.1/>
- Jakarta Batch specification index: <https://jakarta.ee/specifications/batch/>
- Jakarta EE 11 release page: <https://jakarta.ee/release/11/>
- Jakarta EE Platform 11 page: <https://jakarta.ee/specifications/platform/11/>
- JSR 236: Concurrency Utilities for Java EE: <https://jcp.org/ja/jsr/detail?id=236>
- Oracle Java EE 7 Tutorial — Concurrency Utilities: <https://docs.oracle.com/javaee/7/tutorial/concurrency-utilities.htm>
- JEP 444: Virtual Threads: <https://openjdk.org/jeps/444>
- JEP 505: Structured Concurrency, Fifth Preview: <https://openjdk.org/jeps/505>
- JEP 506: Scoped Values: <https://openjdk.org/jeps/506>
- JEP 491: Synchronize Virtual Threads without Pinning: <https://openjdk.org/jeps/491>

---

## 34. Status Seri

Part 1 selesai.

Seri belum selesai. Bagian berikutnya:

```text
Part 2 — Container Integrity: Why Managed Concurrency Exists
File: 02-container-integrity-and-managed-concurrency.md
```
