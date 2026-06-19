# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-032
# Virtual Threads in Quarkus: Loom, Blocking Simplicity, Reactive Trade-Off

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Part: `032`  
> Topik: Virtual Threads in Quarkus: Loom, Blocking Simplicity, Reactive Trade-Off  
> Status: Materi lanjutan advance — setelah runtime tuning JVM/native  
> Target: Software engineer yang mampu memakai virtual threads di Quarkus secara benar: kapan membuat kode blocking lebih sederhana, kapan tetap memakai reactive, dan bagaimana menghindari pinning, overload, serta illusion of infinite concurrency

---

## 0. Ringkasan Besar

Virtual threads sering dipromosikan sebagai:

```text
Tulis kode blocking sederhana, tetapi scalable seperti reactive.
```

Pernyataan itu arah besarnya benar, tetapi berbahaya jika disederhanakan.

Virtual threads **mengurangi biaya menunggu**.

Virtual threads **tidak menghapus bottleneck**:

- database connection tetap terbatas,
- external API tetap punya rate limit,
- CPU tetap terbatas,
- memory tetap terbatas,
- lock tetap bisa menahan,
- transaction tetap bisa panjang,
- retry storm tetap bisa terjadi,
- event loop tetap tidak boleh diblokir sembarangan,
- downstream tetap bisa collapse.

Quarkus mendukung virtual threads di berbagai model, termasuk REST, Reactive Messaging, dan gRPC. Guide resmi Quarkus menjelaskan bahwa virtual threads membantu Java 21+ applications mendapatkan manfaat concurrency model baru, dan Quarkus menyediakan annotation seperti `@RunOnVirtualThread` untuk menjalankan handler tertentu di virtual thread. Quarkus juga menyediakan guide khusus untuk REST, Reactive Messaging, dan gRPC virtual threads.

Part ini membahas virtual threads sebagai desain execution model.

---

## 1. Mental Model: Virtual Thread Adalah Thread Murah, Bukan Resource Tak Terbatas

Platform thread tradisional:

```text
Java Thread -> OS thread
```

Setiap platform thread mahal:

- stack memory,
- OS scheduling,
- context switching,
- terbatas jumlahnya.

Virtual thread:

```text
Java virtual thread -> scheduled by JVM on carrier platform threads
```

Virtual thread murah dibuat dalam jumlah besar.

Namun virtual thread tetap menjalankan code.

Jika code melakukan IO blocking yang virtual-thread-friendly, JVM bisa unmount virtual thread dari carrier thread saat menunggu.

Carrier thread bisa dipakai virtual thread lain.

Inilah manfaat utama:

```text
Menunggu IO tidak lagi memonopoli OS thread.
```

Namun jika virtual thread melakukan CPU work:

```text
carrier tetap sibuk.
```

Jika virtual thread melakukan blocking sambil pinned:

```text
carrier bisa tertahan.
```

Jika 100 ribu virtual threads semua butuh DB connection:

```text
DB pool tetap bottleneck.
```

---

## 2. Platform Thread vs Virtual Thread

### 2.1 Platform Thread

```java
Thread thread = new Thread(task);
thread.start();
```

Mapping ke OS thread.

Karakteristik:

- mahal,
- jumlah terbatas,
- cocok untuk long-lived worker,
- blocking IO menahan OS thread,
- thread pool diperlukan.

### 2.2 Virtual Thread

```java
Thread.startVirtualThread(task);
```

Karakteristik:

- sangat murah,
- banyak short-lived threads,
- blocking IO bisa park/unmount,
- tidak perlu thread pool untuk membatasi jumlah thread,
- tetap perlu batas resource downstream,
- cocok untuk request-per-task blocking style.

### 2.3 Carrier Thread

Virtual threads dijalankan di atas carrier platform threads.

Carrier threads adalah resource nyata.

Jika virtual thread pinned atau CPU-heavy:

```text
carrier thread tidak bisa melayani virtual thread lain.
```

Maka virtual threads tidak berarti infinite execution.

---

## 3. Why Virtual Threads Matter for Quarkus

Quarkus sejak awal punya reactive core berbasis Vert.x:

```text
event loop
non-blocking IO
message passing
reactive clients
Mutiny Uni/Multi
```

Reactive model sangat scalable, tetapi code bisa menjadi lebih kompleks:

```java
return client.call()
    .onItem().transform(...)
    .onFailure().recoverWithItem(...);
```

Virtual threads memungkinkan model imperative:

```java
Response response = client.call();
repository.save(response);
return result;
```

Dengan scalability lebih baik daripada platform-thread-per-request tradisional untuk IO-bound workloads.

Quarkus mendukung beberapa model sekaligus:

1. event-loop reactive,
2. worker-thread blocking,
3. virtual-thread blocking,
4. Mutiny reactive,
5. messaging with virtual thread,
6. gRPC with virtual thread.

Quarkus tidak memaksa satu model.

---

## 4. The Core Trade-Off: Simplicity vs Control

Reactive model:

```text
+ explicit async composition
+ excellent for high concurrency IO
+ backpressure primitives
+ event loop efficient
- mental overhead
- harder debugging
- callback/pipeline complexity
- transaction/security/context complexity
```

Virtual thread blocking model:

```text
+ simple sequential code
+ easier debugging
+ easier transaction-like reasoning
+ lower migration cost from blocking code
+ good for IO-bound endpoints
- still needs downstream limits
- pinning risk
- CPU-heavy work still consumes carriers
- backpressure less explicit
- can create illusion of infinite concurrency
```

Rule:

```text
Use virtual threads to simplify IO-bound blocking code.
Use reactive when streaming/backpressure/non-blocking composition is central.
```

---

## 5. Quarkus `@RunOnVirtualThread`

Quarkus Virtual Thread support reference explains that `@RunOnVirtualThread` instructs Quarkus to invoke the annotated method on a virtual thread.

Conceptual REST example:

```java
import io.smallrye.common.annotation.RunOnVirtualThread;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/hello")
public class HelloResource {

    @GET
    @RunOnVirtualThread
    public String hello() {
        return blockingService.compute();
    }
}
```

Meaning:

```text
Quarkus offloads endpoint method execution to a virtual thread.
```

The method can use blocking style without occupying event loop.

Important:

```text
Do not return Uni/CompletionStage and expect @RunOnVirtualThread to make sense.
Virtual-thread endpoints are for blocking signatures such as object/void return.
```

Quarkus Vert.x reference notes that only methods returning an object or void can use `@RunOnVirtualThread`; methods returning `Uni` or `CompletionStage` cannot run on virtual threads.

---

## 6. REST Virtual Threads

Quarkus guide “Use virtual threads in REST applications” explains how virtual threads can be used in REST applications, especially because virtual threads are about IO and the guide uses REST client as an example.

Typical use case:

```java
@Path("/applications")
public class ApplicationResource {

    private final ApplicationService service;

    public ApplicationResource(ApplicationService service) {
        this.service = service;
    }

    @POST
    @RunOnVirtualThread
    public ApplicationResponse submit(SubmitApplicationRequest request) {
        return service.submit(request);
    }
}
```

Service can be imperative:

```java
@ApplicationScoped
public class ApplicationService {

    public ApplicationResponse submit(SubmitApplicationRequest request) {
        ApplicantIdentity identity = identityGateway.load(request.applicantId());
        Application app = repository.create(request, identity);
        auditService.recordSubmitted(app);
        return ApplicationResponse.from(app);
    }
}
```

This is readable.

But still needs:

- timeout,
- retry policy,
- DB pool limit,
- transaction boundary,
- idempotency,
- observability,
- rate limit.

---

## 7. Virtual Threads and JDBC

JDBC is blocking.

Virtual threads make blocking JDBC easier to scale than platform threads, because waiting on DB IO can unmount virtual thread if underlying operation cooperates with JDK blocking mechanisms.

However:

```text
DB connection is still scarce.
```

If 10,000 virtual threads hit DB and pool size is 20:

```text
9,980 wait for connection.
```

This can still cause:

- high latency,
- memory growth,
- request queueing,
- timeout,
- DB overload if pool too large.

Rule:

```text
Virtual threads do not replace DB pool sizing.
```

For JDBC-heavy apps:

- use virtual threads for simpler blocking code,
- keep pool bounded,
- set query timeout,
- avoid long transactions,
- avoid external call inside DB transaction,
- measure pool awaiting,
- monitor p99.

---

## 8. Virtual Threads and REST Clients

Blocking REST client calls fit virtual threads well.

Example:

```java
@ApplicationScoped
public class IdentityGateway {

    private final IdentityClient client;

    public IdentityGateway(@RestClient IdentityClient client) {
        this.client = client;
    }

    public IdentitySnapshot load(String id) {
        IdentityResponse response = client.getIdentity(id);
        return IdentitySnapshot.from(response);
    }
}
```

When invoked from virtual-thread endpoint:

```text
blocking wait does not consume platform worker thread the same way.
```

Still required:

- connect/read timeout,
- retry budget,
- circuit breaker,
- bulkhead,
- rate limit,
- idempotency for side effects,
- token refresh control.

Virtual threads reduce thread cost, not external dependency cost.

---

## 9. Virtual Threads and Transactions

Imperative code can make transaction logic simpler.

Example:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.getForUpdate(id);
    app.approve();
    auditRepository.insert(...);
}
```

Good.

But do not do:

```java
@Transactional
public void approve(ApplicationId id) {
    Application app = repository.getForUpdate(id);
    externalApi.notify(app); // network call inside DB transaction
    app.approve();
}
```

Virtual thread makes blocking cheaper but does not make transaction safe.

Still avoid long transactions around external calls.

Use outbox for side effects.

---

## 10. Virtual Threads and Reactive Model

Quarkus reactive architecture remains important.

Reactive is still strong for:

- streaming,
- backpressure,
- high-throughput non-blocking pipelines,
- WebSockets,
- server-sent events,
- Kafka streaming,
- large file streaming,
- composing many async operations,
- non-blocking database clients,
- event-loop-centric systems.

Virtual threads are strong for:

- request/response IO-bound apps,
- CRUD,
- blocking libraries,
- JDBC,
- readable orchestration,
- migration from classic blocking stack,
- simpler imperative error handling.

Decision is not:

```text
Virtual threads replace reactive.
```

Better:

```text
Virtual threads and reactive are complementary.
```

---

## 11. Mixed Model: Valid and Common

You can mix:

```text
REST endpoint on virtual thread
  -> blocking JDBC
  -> blocking REST client
  -> outbox

Messaging consumer on virtual thread
  -> blocking service

Reactive endpoint
  -> returns Uni
  -> non-blocking reactive SQL client

Streaming endpoint
  -> Multi
  -> backpressure-aware pipeline
```

Do not mix blindly inside same method.

Bad:

```java
@RunOnVirtualThread
public Uni<Response> get() {
    return reactiveClient.call();
}
```

If using `Uni`, stay reactive.

If using virtual thread, return object/void and write imperative code.

---

## 12. Pinning

Pinning happens when a virtual thread cannot be unmounted from its carrier during blocking operation.

Quarkus blog on testing virtual thread applications discusses limitations including monopolizing and pinning carrier threads, and notes pinning for a short period can be tolerated but can be dramatic under load.

Common pinning causes:

- blocking while inside `synchronized`,
- native method,
- some monitor usage,
- certain file/system calls,
- old libraries,
- blocking code under classloader/lock,
- long CPU section while holding lock.

Example risky:

```java
synchronized (lock) {
    externalApi.call(); // blocking while holding monitor
}
```

If virtual thread blocks here, carrier may be pinned.

Better:

```java
Data data;

synchronized (lock) {
    data = prepare();
}

externalApi.call(data);
```

Keep synchronized section short and non-blocking.

---

## 13. Monopolization

Monopolization means virtual thread occupies carrier for a long time without parking.

Common causes:

- CPU-heavy loop,
- large JSON processing,
- compression,
- cryptography,
- PDF generation,
- image processing,
- big sorting,
- blocking native call,
- infinite loop.

Virtual threads help waiting, not CPU.

If task is CPU-heavy:

```text
virtual thread still uses carrier CPU.
```

Use:

- bounded executor,
- worker pool,
- job queue,
- backpressure,
- CPU profiling,
- limit concurrency.

---

## 14. Detecting Pinning

Java can emit pinning diagnostics with system property in some JDKs:

```bash
-Djdk.tracePinnedThreads=full
```

or shorter modes depending JDK.

Use under test/load to identify pinned virtual threads.

Quarkus blog on testing virtual thread applications discusses mechanisms to detect pinning and highlights that pinning under load can increase memory usage and degrade performance.

Testing should include:

- load test,
- pinning trace enabled,
- representative blocking paths,
- JDBC,
- REST clients,
- locks,
- templates,
- crypto,
- file IO.

Do not enable verbose pinning logs in production permanently.

---

## 15. Virtual Threads and Locks

Avoid long synchronized sections.

Bad:

```java
public synchronized Result process(Request request) {
    return externalClient.call(request);
}
```

This serializes all requests and risks pinning.

Better:

- use immutable data,
- reduce shared mutable state,
- use concurrent data structures,
- lock only small critical section,
- never call external IO under lock,
- use database lock/unique constraint for cross-pod coordination.

Virtual threads do not fix bad locking.

---

## 16. Virtual Threads and CPU-Bound Work

For CPU-bound tasks:

```text
virtual threads do not increase CPU cores.
```

If you run 10,000 CPU tasks on 4 cores:

```text
they queue/compete.
```

Examples:

- risk scoring,
- report generation,
- PDF rendering,
- encryption bulk processing,
- large JSON transformation,
- image processing.

Use bounded concurrency:

```java
Semaphore cpuBudget = new Semaphore(4);
```

or worker executor/queue/job.

For CPU-heavy work, reactive vs virtual thread is less relevant than CPU capacity and backpressure.

---

## 17. Virtual Threads and Backpressure

Reactive pipelines often make backpressure explicit.

Virtual threads make code simple, but concurrency can grow quickly.

Example:

```text
1000 inbound requests
1000 virtual threads
all call external API
external API limit 100 concurrent
```

Need explicit backpressure:

- rate limit,
- bulkhead,
- semaphore,
- queue,
- circuit breaker,
- DB pool,
- HTTP client pool,
- load shedding.

Virtual threads do not eliminate the need for bulkheads.

---

## 18. Virtual Threads and SmallRye Fault Tolerance

Fault tolerance remains essential:

```java
@Timeout(800)
@Retry(maxRetries = 1)
@CircuitBreaker(...)
@Bulkhead(value = 20, waitingTaskQueue = 50)
public IdentitySnapshot loadIdentity(String id) {
    return client.getIdentity(id);
}
```

`@Bulkhead` is especially important with virtual threads because thread count no longer naturally limits concurrency.

Previously:

```text
worker thread pool size accidentally limited calls.
```

With virtual threads:

```text
you must explicitly limit scarce downstream resources.
```

---

## 19. Virtual Threads in Reactive Messaging

Quarkus has a guide for virtual threads with Reactive Messaging. It explains how to benefit from Java virtual threads when writing message processing applications in Quarkus.

Conceptual:

```java
@Incoming("applications")
@RunOnVirtualThread
public void consume(ApplicationSubmitted event) {
    applicationProcessor.process(event);
}
```

Use when message processing is blocking/imperative:

- JDBC,
- blocking REST client,
- file IO,
- simple business service.

Still need:

- concurrency control,
- ack/nack policy,
- idempotency,
- DLQ,
- retry,
- ordering guarantee,
- broker backpressure,
- downstream limits.

Kafka blog notes that the JVM limits the number of carrier threads; if carriers are unavailable, tasks queue until carrier available. This matters in high-throughput messaging.

---

## 20. Messaging Ordering and Virtual Threads

If you process messages concurrently on virtual threads:

```text
ordering may change unless connector guarantees/order config prevents it.
```

For Kafka:

- partition ordering matters,
- concurrent processing can break assumptions,
- commit/ack order matters,
- idempotency required.

Use virtual threads carefully when:

- order per key required,
- exactly-once-ish semantics,
- transactional processing,
- side effects,
- retry topics.

If ordering matters, design explicitly.

---

## 21. Virtual Threads in gRPC

Quarkus has a guide for virtual threads with gRPC services.

Use case:

```text
gRPC service method uses blocking logic.
```

Virtual threads can simplify implementation.

Still need:

- deadline propagation,
- cancellation handling,
- backpressure for streams,
- max concurrent calls,
- TLS,
- metadata propagation,
- observability.

Streaming gRPC may still fit reactive/non-blocking model better.

---

## 22. Virtual Threads and Native Image

Virtual threads are Java runtime feature.

Quarkus native image can use Java features depending on GraalVM/Mandrel support and Quarkus version.

Need test:

- virtual-thread endpoint in native,
- blocking JDBC in native under virtual thread,
- REST client in native,
- pinning/load,
- observability,
- throughput/RSS.

Native + virtual threads can be attractive:

```text
fast startup + simple blocking code
```

But still measure:

- CPU,
- memory,
- p99,
- carrier behavior,
- downstream bottleneck.

---

## 23. Virtual Threads and ThreadLocal/MDC

Virtual threads support ThreadLocal, but careless usage can be costly.

Risks:

- large ThreadLocal values per virtual thread,
- context leakage if not scoped,
- relying on platform thread identity,
- MDC cleanup missing,
- security context propagation assumptions.

Quarkus context propagation and logging MDC should be tested in virtual-thread paths.

Guidelines:

- keep ThreadLocal data small,
- scope MDC carefully,
- cleanup always,
- avoid caching large objects in ThreadLocal,
- use framework context propagation.

---

## 24. Virtual Threads and Security Context

Security identity should be available in request context.

Test:

- `SecurityIdentity` accessible in virtual-thread endpoint,
- role checks work,
- method security works,
- MDC actor fields set/cleared,
- token propagation works,
- async calls do not lose identity.

Do not assume because normal endpoint works, virtual-thread endpoint has identical context behavior for custom code.

---

## 25. Virtual Threads and Testing

Test categories:

1. Functional test:
   - endpoint works with `@RunOnVirtualThread`.

2. Thread model test:
   - code runs on virtual thread when expected.

3. Pinning test:
   - run under `jdk.tracePinnedThreads`.

4. Load test:
   - concurrency,
   - p99,
   - DB pool,
   - external API.

5. Downstream capacity test:
   - bulkhead/rate limit.

6. Native test:
   - if native deployment.

Example assertion:

```java
assertTrue(Thread.currentThread().isVirtual());
```

Use sparingly; do not over-couple tests to thread internals except where thread mode is contract.

---

## 26. Virtual Thread Benchmarking

Benchmark scenarios should compare:

1. Platform worker blocking.
2. Virtual thread blocking.
3. Reactive non-blocking.
4. Native virtual thread if relevant.
5. JVM virtual thread.

Measure:

- throughput,
- p95/p99,
- CPU,
- RSS,
- DB pool awaiting,
- external call concurrency,
- carrier thread saturation,
- pinning logs,
- error rate.

Workload types:

- DB-bound CRUD,
- external API-bound endpoint,
- CPU-heavy endpoint,
- streaming endpoint,
- message consumer.

Expected patterns:

```text
IO-bound blocking: virtual threads often help.
CPU-bound: virtual threads do not create CPU.
Streaming/backpressure: reactive may be better.
```

---

## 27. Capacity Model with Virtual Threads

Before virtual threads:

```text
worker pool size may accidentally cap concurrency.
```

After virtual threads:

```text
concurrency can rise dramatically.
```

You must define explicit budgets:

```text
max inbound concurrency
DB pool size
HTTP client bulkhead
external API rate
CPU-heavy work semaphore
message consumer concurrency
job worker count
```

Example:

```text
HTTP requests: allow 1000 concurrent
DB pool: 30
identity API bulkhead: 50
email API async outbox: 10 workers
CPU risk score: 4 concurrent
```

Virtual threads simplify code, but budgets must be explicit.

---

## 28. Migration from Reactive to Virtual Threads

Do not migrate blindly.

Good candidate:

```java
Uni<Response> submit(...) {
    return identityClient.get(...)
        .chain(identity -> repository.persist(...))
        .map(Response::from);
}
```

If pipeline is mostly sequential IO, virtual thread version may be simpler.

Poor candidate:

- streaming,
- backpressure-heavy,
- many concurrent async fan-out operations,
- reactive SQL already working,
- WebSocket streaming,
- high-throughput event stream.

Migration steps:

1. Identify IO-bound endpoints.
2. Convert one endpoint to blocking signature.
3. Add `@RunOnVirtualThread`.
4. Ensure dependencies are safe blocking APIs.
5. Add timeout/bulkhead.
6. Load test.
7. Monitor pinning.
8. Compare readability and metrics.

---

## 29. Migration from Blocking Worker to Virtual Threads

Traditional blocking endpoint:

```text
worker thread per request
```

Migration:

```java
@RunOnVirtualThread
public Response get() {
    return service.get();
}
```

Review:

- DB pool,
- external client timeout,
- locks,
- ThreadLocal,
- MDC,
- transaction boundary,
- CPU work,
- bulkheads.

Performance may improve due lower thread cost.

But if bottleneck is DB, improvement limited.

---

## 30. When Not to Use Virtual Threads

Avoid or be cautious if:

- method returns `Uni`/`CompletionStage`,
- code is already efficient reactive pipeline,
- CPU-heavy work dominates,
- streaming/backpressure central,
- code holds locks during IO,
- library pins heavily,
- transaction contains long external calls,
- downstream limits not controlled,
- team has no observability for pinning/saturation.

Virtual threads are not a license to ignore architecture.

---

## 31. Production Checklist

### 31.1 Suitability

- [ ] Workload is IO-bound.
- [ ] Blocking style improves clarity.
- [ ] Streaming/backpressure not central.
- [ ] CPU-heavy sections identified.
- [ ] Reactive alternative evaluated.

### 31.2 Correctness

- [ ] Transactions not holding external calls.
- [ ] Idempotency for side effects.
- [ ] Security context tested.
- [ ] MDC/context cleanup tested.
- [ ] ThreadLocal usage reviewed.

### 31.3 Capacity

- [ ] DB pool sized.
- [ ] HTTP client bulkhead set.
- [ ] External rate limit set.
- [ ] CPU work bounded.
- [ ] Message concurrency controlled.
- [ ] HPA/downstream capacity reviewed.

### 31.4 Pinning

- [ ] synchronized blocking reviewed.
- [ ] native/blocking libraries reviewed.
- [ ] pinning detection run under load.
- [ ] locks are short.
- [ ] no IO inside monitor locks.

### 31.5 Observability

- [ ] p95/p99 measured.
- [ ] DB pool awaiting monitored.
- [ ] external client concurrency monitored.
- [ ] carrier/pinning symptoms monitored in test.
- [ ] errors/timeouts/rejections measured.

### 31.6 Runtime

- [ ] JVM and/or native tested.
- [ ] resource limits tested.
- [ ] performance compared with baseline.
- [ ] rollback path exists.

---

## 32. Case Study: CRUD Service with JDBC

Service:

```text
Quarkus REST + JDBC/Hibernate + simple request/response
```

Virtual thread suitability:

```text
high
```

Why:

- blocking JDBC,
- sequential operations,
- business logic readable,
- no streaming,
- IO-bound.

Design:

```java
@Path("/applications")
public class ApplicationResource {

    @POST
    @RunOnVirtualThread
    public ApplicationResponse submit(SubmitRequest request) {
        return service.submit(request);
    }
}
```

Need:

- DB pool size,
- transaction boundary,
- p99 test,
- no external calls inside transaction,
- connection awaiting metrics.

---

## 33. Case Study: External API Aggregator

Endpoint:

```text
GET /dashboard
calls 5 external APIs
```

Virtual thread version:

```java
@RunOnVirtualThread
public Dashboard get() {
    A a = apiA.call();
    B b = apiB.call();
    C c = apiC.call();
    ...
}
```

Problem:

```text
Sequential calls may be simple but slow.
```

Alternative:

- structured concurrency/futures,
- reactive fan-out,
- bounded parallelism,
- cache,
- async precompute.

Virtual threads help each blocking wait, but do not automatically parallelize.

If parallel fan-out needed, design carefully:

- deadlines,
- cancellation,
- per-dependency bulkhead,
- fallback,
- timeout budget.

---

## 34. Case Study: Messaging Consumer with JDBC

Consumer:

```java
@Incoming("application-events")
@RunOnVirtualThread
public void consume(ApplicationSubmitted event) {
    service.process(event);
}
```

Good if:

- processing is blocking JDBC,
- each message independent,
- idempotency exists,
- ordering not strict or per-key controlled.

Need:

- connector concurrency,
- DB pool budget,
- ack/nack policy,
- DLQ,
- retry,
- idempotency key,
- lag metrics.

Virtual threads can make consumer code simple but can increase concurrent DB waits.

---

## 35. Case Study: CPU-Heavy Risk Scoring

Endpoint:

```text
POST /risk/score
```

Work:

- parse large payload,
- compute CPU-heavy model,
- no external IO.

Virtual threads suitability:

```text
low
```

Because bottleneck is CPU.

Use:

- bounded CPU executor,
- queue,
- async job,
- scale CPU,
- optimize algorithm,
- profile,
- maybe native/JVM benchmark.

Virtual threads do not create more CPU.

---

## 36. Anti-Pattern Umum

### 36.1 Virtual Threads Everywhere

Not every endpoint benefits.

### 36.2 No Bulkhead Because Threads Are Cheap

Downstream still limited.

### 36.3 Blocking Inside `synchronized`

Pinning risk.

### 36.4 CPU-Heavy Work on Virtual Threads Without Bound

Carrier saturation.

### 36.5 Mixing `Uni` with `@RunOnVirtualThread`

Conceptual mismatch.

### 36.6 Assuming Virtual Threads Replace Reactive

They complement, not replace.

### 36.7 No Pinning Test

Performance collapses under load.

### 36.8 Ignoring DB Pool

10k virtual threads wait on 20 DB connections.

### 36.9 Long Transaction with External Call

Still bad.

### 36.10 ThreadLocal Large State

Memory pressure across many virtual threads.

---

## 37. Implementation Blueprint: Virtual Thread REST Endpoint

```java
import io.smallrye.common.annotation.RunOnVirtualThread;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;

@Path("/applications")
public class ApplicationResource {

    private final ApplicationSubmissionService service;

    public ApplicationResource(ApplicationSubmissionService service) {
        this.service = service;
    }

    @POST
    @RunOnVirtualThread
    public ApplicationResponse submit(SubmitApplicationRequest request) {
        return service.submit(request);
    }
}
```

Service:

```java
@ApplicationScoped
public class ApplicationSubmissionService {

    private final IdentityGateway identityGateway;
    private final ApplicationRepository repository;
    private final AuditService auditService;

    @Transactional
    public ApplicationResponse submit(SubmitApplicationRequest request) {
        ApplicantIdentity identity = identityGateway.load(request.applicantId());

        Application app = Application.submit(request, identity);
        repository.persist(app);
        auditService.recordSubmitted(app);

        return ApplicationResponse.from(app);
    }
}
```

Caution:

```text
If identityGateway performs external IO, avoid holding DB transaction before calling it.
```

Better:

```text
external validation first,
then transaction for DB changes,
or outbox depending side effect.
```

---

## 38. Implementation Blueprint: Bounded External Call

```java
@ApplicationScoped
public class IdentityGateway {

    private final IdentityClient client;
    private final Semaphore concurrency = new Semaphore(50);

    public IdentityGateway(@RestClient IdentityClient client) {
        this.client = client;
    }

    public IdentitySnapshot load(String applicantId) {
        if (!concurrency.tryAcquire()) {
            throw new DependencyBusyException("identity-api");
        }

        try {
            IdentityResponse response = client.getIdentity(applicantId);
            return IdentitySnapshot.from(response);
        } finally {
            concurrency.release();
        }
    }
}
```

In real systems, prefer robust bulkhead/fault tolerance tooling, but this shows the concept:

```text
virtual threads need explicit downstream concurrency budgets.
```

---

## 39. Implementation Blueprint: Pinning-Safe Locking

Bad:

```java
synchronized (cacheLock) {
    ExternalValue value = externalClient.load(key);
    cache.put(key, value);
}
```

Better:

```java
ExternalValue value = externalClient.load(key);

synchronized (cacheLock) {
    cache.put(key, value);
}
```

Even better:

- use Caffeine/Redis single-flight,
- use concurrent structures,
- avoid lock around IO.

---

## 40. Latihan

### Latihan 1 — Suitability Review

Tentukan apakah virtual threads cocok:

1. CRUD REST endpoint with JDBC.
2. Streaming endpoint returning `Multi`.
3. Kafka consumer calling JDBC.
4. CPU-heavy PDF generation.
5. REST endpoint calling 3 external APIs sequentially.
6. WebSocket live updates.
7. Batch job processing DB pages.
8. Endpoint using reactive SQL client returning `Uni`.

Untuk masing-masing, jelaskan pilihan.

### Latihan 2 — Capacity Model

Endpoint virtual-thread:

```text
200 RPS
p95 external API latency 500ms
DB pool 30
external API limit 100 concurrent
CPU limit 2 cores
```

Tentukan:

- expected concurrency,
- bulkhead,
- DB pool risk,
- timeout,
- HPA concern.

### Latihan 3 — Pinning Audit

Cari masalah:

```java
public synchronized Result submit(Command command) {
    validate(command);
    ExternalData data = externalClient.call(command.id());
    repository.save(data);
    return Result.ok();
}
```

Refactor agar virtual-thread-friendly.

### Latihan 4 — Reactive vs Virtual Thread

Endpoint:

```text
GET /reports/stream
streams 1M rows to client with backpressure.
```

Apakah virtual thread cocok? Jelaskan.

### Latihan 5 — Messaging Consumer

Kafka consumer memakai `@RunOnVirtualThread`, tetapi DB CPU naik dan lag meningkat.

Buat diagnosis:

- concurrency,
- DB pool,
- consumer configuration,
- idempotency,
- retry,
- bulkhead,
- lag metrics.

---

## 41. Ringkasan Invariants

Ingat invariants berikut:

```text
Virtual threads are cheap threads, not infinite resources.
They reduce the cost of blocking waits.
They do not create more CPU, DB connections, or external API quota.
Use them for IO-bound imperative code.
Keep reactive for streaming/backpressure-heavy flows.
Do not block inside synchronized sections.
Pinning can destroy scalability under load.
Bulkhead and rate limit become more important, not less.
DB pool sizing still controls throughput.
Virtual threads simplify code but require explicit capacity model.
Do not mix Uni/CompletionStage style with @RunOnVirtualThread.
Test pinning, p99 latency, DB pool awaiting, and native/JVM behavior.
```

---

## 42. Referensi Resmi yang Relevan

Referensi yang perlu dibaca saat implementasi nyata:

- Quarkus Virtual Thread support reference.
- Quarkus Use virtual threads in REST applications guide.
- Quarkus Virtual Thread support with Reactive Messaging guide.
- Quarkus Virtual Thread support for gRPC services guide.
- Quarkus Reactive Architecture guide.
- Quarkus Virtual Threads blog series.
- Quarkus Testing virtual thread applications blog.
- Quarkus Processing Kafka records on virtual threads blog.
- Java Project Loom / JDK virtual threads documentation.
- Quarkus performance measurement guide.

---

## 43. Kapan Seri Ini Lanjut ke Part Berikutnya

Part ini menyelesaikan virtual threads di Quarkus: mental model, REST/messaging/gRPC usage, reactive trade-off, pinning, capacity, testing, dan production checklist.

Bagian berikutnya:

```text
Part 033 — Custom Extension Engineering: Membuat Extension Quarkus Sendiri
```

Di part berikutnya, fokus bergeser ke Quarkus extension model:

- deployment module vs runtime module,
- build steps,
- build items,
- recorders,
- synthetic beans,
- Jandex indexing,
- native metadata registration,
- config root,
- generated resources/classes,
- extension testing,
- when to create extension,
- production-grade internal platform extension.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-031.md">⬅️ Native Runtime Tuning: JVM Mode vs Native Mode, Memory, GC, Startup, Throughput</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-033.md">Custom Extension Engineering: Membuat Extension Quarkus Sendiri ➡️</a>
</div>
