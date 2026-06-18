# Part 24 — Virtual Threads, Modern Java, and Jersey Runtime Compatibility Thinking

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> Status: Part 24 dari 32  
> Fokus: memahami bagaimana Java 8–25, terutama virtual threads di Java 21+, memengaruhi cara kita menjalankan, men-tuning, dan memigrasikan aplikasi Jersey.

---

## 0. Kenapa Part Ini Penting?

Banyak engineer melihat virtual threads sebagai jawaban sederhana:

> “Kalau blocking I/O mahal, pakai virtual threads saja.”

Itu benar sebagian, tetapi berbahaya kalau diterapkan tanpa memahami runtime boundary.

Pada aplikasi Jersey, request tidak hidup di Java language saja. Request hidup di gabungan beberapa lapisan:

```text
Client
  -> load balancer / reverse proxy / API gateway
  -> servlet container / embedded HTTP server
  -> Jersey request pipeline
  -> resource method
  -> service layer
  -> database / remote HTTP / filesystem / queue
  -> response serialization
```

Virtual threads hanya menyentuh sebagian dari chain itu. Ia tidak otomatis memperbaiki:

- database connection pool yang kecil,
- remote dependency yang lambat,
- JSON serialization yang CPU-bound,
- lock contention,
- synchronized block yang mem-pin carrier thread,
- thread-local leakage,
- request scope yang salah,
- atau container yang belum mengeksekusi request dengan virtual threads.

Part ini membangun mental model supaya kita bisa menjawab pertanyaan yang lebih tajam:

> “Di bagian mana virtual threads membantu aplikasi Jersey saya, dan di bagian mana justru tidak relevan atau berisiko?”

---

## 1. Posisi Versi: Java 8 sampai Java 25

Seri ini membahas Java 8–25 karena ekosistem Jersey sering tersebar di banyak generasi aplikasi.

Secara garis besar:

| Era | Karakter | Dampak untuk Jersey |
|---|---|---|
| Java 8 | legacy enterprise baseline | Jersey 2.x, `javax.ws.rs`, servlet app lama, blocking stack umum |
| Java 11 | LTS modern awal | TLS/runtime lebih modern, module awareness mulai terasa, banyak app migrate dari 8 |
| Java 17 | LTS dan baseline banyak framework modern | Jakarta-era runtime makin lazim, container modern, records/sealed class mulai relevan |
| Java 21 | LTS dengan virtual threads final | peluang concurrency model baru, terutama untuk blocking I/O |
| Java 25 | LTS terbaru per 2026 | target modernisasi jangka panjang, tetap perlu cek support framework/container |

Hal penting: **versi Java aplikasi tidak otomatis menentukan versi Jakarta/Jersey**.

Contoh:

```text
Java 17 + Jersey 2.x      -> masih mungkin, tetapi namespace javax
Java 17 + Jersey 3.x      -> Jakarta EE 10 style, namespace jakarta
Java 17/21/25 + Jersey 4.x -> Jakarta EE 11 / Jakarta REST 4.0 direction
```

Jersey official site saat ini mencantumkan Jersey 4.0.0 sebagai published release untuk Jakarta EE 11, sedangkan Jakarta REST page mencantumkan Jakarta REST 4.0 sebagai release untuk Jakarta EE 11. JDK 25 sudah GA sejak 16 September 2025 dan Oracle download page mencantumkan JDK 25 sebagai LTS terbaru. Ini membuat Java 25 relevan sebagai target modernisasi, tetapi bukan berarti semua container/library otomatis matang di atasnya.

---

## 2. Mental Model: Thread Itu “Tempat Request Dieksekusi”, Bukan Arsitektur

Dalam aplikasi Jersey tradisional, satu request biasanya dieksekusi oleh satu thread container.

Simplified flow:

```text
HTTP request diterima
  -> container memilih worker thread
  -> Jersey pipeline berjalan di thread itu
  -> resource method dipanggil di thread itu
  -> service/database/client call blocking di thread itu
  -> response ditulis
  -> thread kembali ke pool
```

Pada model platform thread:

```text
1 blocked request = 1 blocked OS-backed thread
```

Kalau request melakukan blocking I/O, misalnya menunggu database 300 ms, platform thread ikut tertahan 300 ms.

Virtual thread mengubah cost model:

```text
1 blocked request = 1 suspended virtual thread
carrier thread bisa menjalankan virtual thread lain
```

Namun request tetap blocking secara logika. Yang berubah adalah **biaya menunggu**, bukan karakter dependency.

Jadi virtual threads bukan membuat database lebih cepat. Ia membuat aplikasi bisa menunggu banyak operasi blocking dengan lebih murah, selama bottleneck bukan CPU, bukan pool eksternal, dan bukan lock contention.

---

## 3. Platform Thread vs Virtual Thread

### 3.1 Platform Thread

Platform thread adalah thread tradisional Java yang dipetakan ke thread OS.

Karakter:

- relatif mahal dibuat,
- jumlahnya terbatas,
- biasanya dikelola via thread pool,
- cocok untuk kerja CPU-bound atau blocking terbatas,
- jika blocked, OS thread ikut blocked.

Model umum di servlet container:

```text
Tomcat/Jetty/Grizzly worker pool
  thread-1 handles request A
  thread-2 handles request B
  thread-3 handles request C
```

Kalau semua thread menunggu dependency lambat, server bisa kelihatan “mati” walaupun CPU rendah.

### 3.2 Virtual Thread

Virtual thread adalah thread Java ringan yang dikelola JVM. JEP 444 memfinalkan virtual threads di JDK 21. Virtual threads tetap instance `java.lang.Thread`, tetapi bukan 1:1 dengan OS thread.

Karakter:

- murah dibuat,
- cocok untuk blocking I/O yang banyak,
- tidak perlu thread pool besar untuk “menyimpan” concurrency,
- saat blocking pada operasi yang mendukung, virtual thread dapat di-unmount dari carrier thread,
- tetap bukan solusi untuk CPU-bound work.

Mental model:

```text
Virtual Thread A melakukan blocking I/O
  -> JVM park virtual thread A
  -> carrier thread bebas menjalankan virtual thread B
```

Tetapi kalau virtual thread melakukan CPU-heavy JSON serialization, ia tetap memakai carrier thread sampai selesai.

---

## 4. Apa yang Berubah untuk Jersey?

Jersey sendiri adalah runtime JAX-RS/Jakarta REST. Ia tidak otomatis membuat semua request berjalan di virtual thread hanya karena aplikasi memakai Java 21+.

Ada beberapa kemungkinan deployment:

```text
A. Jersey di servlet container klasik
   -> thread model dikendalikan container

B. Jersey embedded dengan Grizzly/Jetty/Tomcat
   -> thread model dikendalikan embedded server config

C. Jersey di Spring Boot
   -> thread model dikendalikan Spring Boot + servlet container

D. Jersey di Jakarta EE server
   -> thread model dikendalikan application server

E. Jersey client dipakai di service layer
   -> thread model dikendalikan caller/executor kamu
```

Jadi pertanyaan yang benar bukan:

> “Apakah Jersey support virtual threads?”

Melainkan:

> “Apakah execution environment yang menjalankan resource method Jersey saya menggunakan virtual threads, dan apakah code di dalamnya virtual-thread-friendly?”

---

## 5. Boundary Utama: Container yang Menentukan Thread Request

Resource method Jersey biasanya dipanggil oleh container.

Contoh resource:

```java
@Path("/cases")
public class CaseResource {

    private final CaseService caseService;

    public CaseResource(CaseService caseService) {
        this.caseService = caseService;
    }

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public CaseDetailResponse getCase(@PathParam("id") String id) {
        return caseService.getCase(id);
    }
}
```

Method `getCase()` tidak memilih thread sendiri. Thread sudah dipilih sebelum Jersey memanggilnya.

Artinya:

```text
Virtual thread adoption path:
  container/server config
    -> request execution thread
      -> Jersey pipeline
        -> resource method
          -> service layer
```

Kalau container masih memakai platform worker pool, maka resource method tetap berjalan di platform thread.

---

## 6. Virtual Threads Cocok untuk Pola Jersey yang Mana?

Virtual threads cocok ketika endpoint banyak melakukan blocking I/O dan sedikit CPU.

Contoh cocok:

```text
GET /cases/{id}
  -> query database
  -> call identity service
  -> call document metadata service
  -> compose DTO
  -> return JSON kecil/sedang
```

Cocok karena sebagian besar waktu request adalah menunggu.

Contoh kurang cocok:

```text
POST /reports/export
  -> query besar
  -> transform jutaan rows
  -> generate PDF/XLSX besar
  -> compress file
  -> return binary
```

Di sini bottleneck bisa CPU, memory, disk, serialization, atau downstream. Virtual thread tidak menghilangkan cost tersebut.

Contoh berisiko:

```text
POST /bulk-approve
  -> synchronized global lock
  -> process 10.000 item
  -> write DB satu per satu
```

Virtual threads bisa membuat lebih banyak request masuk bersamaan, tetapi lock/global bottleneck justru makin terlihat.

---

## 7. Rule of Thumb: Virtual Threads Membantu “Wait Scaling”, Bukan “Work Scaling”

Gunakan distinction ini:

```text
Wait scaling:
  Banyak request menunggu database/HTTP/filesystem.
  Virtual threads bisa membantu.

Work scaling:
  Banyak request melakukan CPU/memory-heavy work.
  Virtual threads tidak banyak membantu.
```

Untuk Jersey API, tanyakan:

1. Berapa persen latency endpoint adalah blocking I/O?
2. Apakah pool dependency cukup?
3. Apakah ada lock yang sering contested?
4. Apakah response serialization besar?
5. Apakah endpoint melakukan buffering body besar?
6. Apakah observability menunjukkan CPU tinggi atau thread waiting tinggi?

Kalau CPU rendah tetapi worker thread habis karena banyak waiting, virtual threads mungkin relevan.

Kalau CPU tinggi, GC tinggi, DB connection pool penuh, atau remote dependency lambat, virtual threads bukan akar solusi.

---

## 8. Thread Pool Sebelum Virtual Threads

Pada model tradisional:

```text
max worker threads = 200
DB connection pool = 30
remote HTTP pool = 100
```

Kalau ada 200 request aktif dan 170 menunggu DB connection, menambah worker thread bisa memperparah antrian.

Dengan virtual threads:

```text
virtual threads aktif = ribuan
DB connection pool = tetap 30
```

Sekarang ribuan virtual threads bisa menunggu DB connection. Ini lebih murah daripada ribuan platform threads, tetapi tetap bukan berarti throughput DB naik.

Karena itu virtual threads harus tetap dipasangkan dengan:

- connection pool limit,
- timeout,
- bulkhead,
- rate limiting,
- back-pressure,
- queue limit,
- admission control.

Tanpa itu, virtual threads bisa membuat sistem menerima lebih banyak pekerjaan daripada dependency sanggup melayani.

---

## 9. Jersey Server dengan Virtual Threads: Tiga Strategi

### 9.1 Strategy A — Container-level virtual thread executor

Ini ideal jika servlet container mendukung konfigurasi virtual thread executor.

Model:

```text
HTTP request
  -> container dispatch ke virtual thread
  -> Jersey pipeline berjalan di virtual thread
  -> resource method blocking dengan murah
```

Keuntungan:

- resource code tetap synchronous,
- model programming sederhana,
- cocok untuk migrasi dari blocking stack,
- tidak perlu rewrite menjadi reactive.

Risiko:

- support tergantung container/version,
- ThreadLocal/MDC harus dicek,
- pinning/lock issue harus dipantau,
- dependency pool tetap harus dibatasi.

### 9.2 Strategy B — Platform request thread + offload ke virtual thread

Model:

```java
@GET
@Path("/{id}")
public void getCase(@PathParam("id") String id,
                    @Suspended AsyncResponse async) {
    Thread.startVirtualThread(() -> {
        try {
            async.resume(caseService.getCase(id));
        } catch (Throwable t) {
            async.resume(t);
        }
    });
}
```

Ini tampak menarik, tetapi sering bukan pilihan terbaik.

Masalah:

- kamu mencampur servlet async, Jersey async, dan virtual thread manual,
- context propagation menjadi manual,
- cancellation lebih sulit,
- error handling harus disiplin,
- terlalu mudah membuat unbounded concurrency.

Gunakan hanya jika container belum punya virtual-thread request executor dan kamu benar-benar memahami konsekuensinya.

### 9.3 Strategy C — Tetap platform threads, gunakan virtual threads hanya di service/client layer

Contoh:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Customer> customer = executor.submit(() -> customerClient.getCustomer(id));
    Future<List<Document>> docs = executor.submit(() -> documentClient.listDocuments(id));

    return new CaseView(customer.get(), docs.get());
}
```

Ini berguna untuk fan-out blocking calls, tetapi hati-hati:

- jangan membuat executor per request tanpa memahami lifecycle,
- structured concurrency akan lebih cocok untuk pola ini di Java modern,
- dependency bulkhead tetap harus ada,
- timeout total harus dikontrol.

---

## 10. Virtual Threads vs Jersey AsyncResponse

`AsyncResponse` dan virtual threads menyelesaikan masalah berbeda.

| Aspek | `AsyncResponse` | Virtual Thread |
|---|---|---|
| Tujuan | melepas request thread dan resume nanti | membuat blocking wait lebih murah |
| Model | callback/event style | synchronous style |
| Kompleksitas | lebih tinggi | lebih rendah untuk blocking code |
| Cocok untuk | long polling, async job, external callback | blocking I/O biasa |
| Error handling | manual resume/error | seperti synchronous code |
| Cancellation | perlu explicit handling | tetap perlu handling, tapi code lebih linear |

Dengan virtual threads, banyak kasus yang dulu membutuhkan `AsyncResponse` hanya untuk menghindari blocking thread bisa kembali ditulis synchronous.

Namun `AsyncResponse` tetap relevan untuk:

- long-polling,
- SSE-like waiting,
- job completion callback,
- request suspension yang benar-benar event-driven,
- integrasi dengan API async/callback.

Jangan menggunakan `AsyncResponse` hanya karena “blocking itu jelek”. Pada Java 21+, blocking di virtual thread bisa menjadi desain yang lebih sederhana dan lebih aman.

---

## 11. Virtual Threads vs Reactive Stack

Reactive stack biasanya digunakan untuk menghindari blocking thread dengan non-blocking I/O dan callback/publisher model.

Virtual threads menawarkan alternatif:

```text
Reactive:
  non-blocking I/O + callback/stream operators + event loop discipline

Virtual thread:
  blocking-looking code + cheap blocking + JVM scheduling
```

Untuk aplikasi Jersey yang mayoritas request/response tradisional:

```text
Resource -> service -> database/client -> DTO -> JSON
```

virtual threads sering lebih natural daripada memaksa reactive model.

Namun reactive tetap unggul untuk:

- high-throughput streaming,
- back-pressure end-to-end,
- event-driven pipelines,
- non-blocking protocol integration,
- workload dengan ribuan stream aktif dan flow control kompleks.

Jersey sendiri bukan WebFlux. Jangan mencoba menjadikan Jersey seperti reactive runtime penuh kecuali memang use case-nya tepat.

---

## 12. Pinning: Risiko yang Sering Diremehkan

Virtual thread idealnya bisa di-unmount dari carrier thread saat blocking. Namun ada kondisi tertentu yang dapat membuat virtual thread tetap memegang carrier thread. Ini sering disebut **pinning**.

Contoh sumber pinning/masalah:

- blocking di dalam `synchronized`,
- native call tertentu,
- monitor lock yang lama,
- library lama yang tidak virtual-thread-friendly,
- driver atau client yang memakai locking berat.

Contoh buruk:

```java
private final Object lock = new Object();

public CaseDetail getCase(String id) {
    synchronized (lock) {
        // Blocking I/O inside synchronized block: bad for virtual threads.
        return repository.findCase(id);
    }
}
```

Kenapa buruk?

```text
virtual thread masuk synchronized
  -> melakukan blocking DB call
  -> carrier thread bisa ter-pin
  -> scalability benefit turun
```

Better:

```java
public CaseDetail getCase(String id) {
    // Avoid global monitor around blocking I/O.
    return repository.findCase(id);
}
```

Jika perlu coordination, gunakan desain yang lebih sempit:

- lock per key,
- optimistic concurrency,
- database constraint,
- idempotency table,
- bounded queue,
- semaphore bulkhead,
- atau `ReentrantLock` dengan disiplin scope kecil.

---

## 13. ThreadLocal, MDC, and Request Context

Aplikasi Jersey production sering memakai:

- MDC logging,
- correlation ID,
- tenant ID,
- user identity,
- request context,
- security context,
- transaction context.

Banyak yang disimpan via `ThreadLocal`.

Virtual threads mendukung thread-local variables, tetapi masalahnya bukan “bisa atau tidak”. Masalahnya adalah lifecycle dan propagation.

Contoh filter:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String correlationId = resolveCorrelationId(requestContext);
        MDC.put("correlationId", correlationId);
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        MDC.clear();
    }
}
```

Pada platform thread pool, `MDC.clear()` penting karena thread akan dipakai ulang.

Pada virtual thread, thread biasanya short-lived, tetapi `clear()` tetap wajib karena:

- code harus benar di semua runtime,
- request bisa berpindah ke async flow,
- library bisa memakai executor lain,
- tests bisa berjalan di platform threads,
- kebiasaan cleanup menjaga disiplin.

Rule:

```text
Set context at boundary.
Use context explicitly where possible.
Clear context at boundary exit.
Do not assume thread model saves you.
```

---

## 14. Jersey Request Scope and Virtual Threads

Jersey/HK2/CDI request scope biasanya diasosiasikan dengan request lifecycle, bukan sekadar thread lifecycle.

Namun secara praktik, banyak implementation dan integration menggunakan thread-bound context selama request diproses.

Risiko muncul ketika:

- request diproses async,
- kerja dipindah ke executor lain,
- virtual thread dibuat manual,
- service mencoba membaca request-scoped bean di luar request thread,
- response sudah selesai tetapi async task masih memakai context.

Contoh berbahaya:

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") String id) {
    Thread.startVirtualThread(() -> {
        // Dangerous: using request-scoped/context object outside clear boundary.
        auditService.recordAccess(id);
    });

    return Response.accepted().build();
}
```

Masalah:

- task bisa berjalan setelah request selesai,
- security context mungkin sudah tidak valid,
- MDC mungkin hilang atau salah,
- exception bisa tidak terlihat,
- audit bisa kehilangan causality.

Better pattern:

```java
@GET
@Path("/{id}")
public Response get(@PathParam("id") String id,
                    @Context SecurityContext securityContext) {
    Actor actor = Actor.from(securityContext);
    String correlationId = Correlation.currentId();

    auditQueue.enqueue(new AuditCommand(actor, correlationId, "VIEW_CASE", id));

    return Response.accepted().build();
}
```

Pass immutable context explicitly.

---

## 15. Virtual Threads and Jersey Client

Jersey Client often performs blocking HTTP calls.

Traditional code:

```java
Response response = client
    .target(baseUrl)
    .path("/customers/{id}")
    .resolveTemplate("id", id)
    .request(MediaType.APPLICATION_JSON_TYPE)
    .get();
```

On platform threads, each blocking outbound call occupies the caller thread.

On virtual threads, this blocking style becomes more scalable if:

- connector implementation cooperates with modern JDK blocking behavior,
- timeouts are configured,
- connection pool is bounded,
- response is closed,
- retry/bulkhead policy is controlled.

Still mandatory:

```java
try (Response response = target.request().get()) {
    if (response.getStatus() == 404) {
        return Optional.empty();
    }
    if (response.getStatusInfo().getFamily() != Response.Status.Family.SUCCESSFUL) {
        throw mapRemoteError(response);
    }
    return Optional.of(response.readEntity(CustomerResponse.class));
}
```

Virtual threads do not fix connection leaks.

They also do not fix missing timeout:

```java
Client client = ClientBuilder.newBuilder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build();
```

Without timeout, a virtual thread may wait cheaply, but your business operation still hangs logically.

---

## 16. Fan-out Calls with Virtual Threads

A common Jersey API pattern:

```text
GET /case-overview/{id}
  -> case service
  -> customer service
  -> document service
  -> risk service
```

Sequential implementation:

```java
CaseData caseData = caseClient.getCase(id);
Customer customer = customerClient.getCustomer(caseData.customerId());
List<Document> documents = documentClient.listDocuments(id);
RiskScore risk = riskClient.getRisk(id);

return new CaseOverview(caseData, customer, documents, risk);
```

If each call takes 200 ms, sequential latency can be close to 800 ms.

Virtual-thread fan-out can reduce latency:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<CaseData> caseFuture = executor.submit(() -> caseClient.getCase(id));
    Future<List<Document>> docsFuture = executor.submit(() -> documentClient.listDocuments(id));
    Future<RiskScore> riskFuture = executor.submit(() -> riskClient.getRisk(id));

    CaseData caseData = caseFuture.get();
    Customer customer = customerClient.getCustomer(caseData.customerId());

    return new CaseOverview(
        caseData,
        customer,
        docsFuture.get(),
        riskFuture.get()
    );
}
```

But this is still incomplete without:

- total deadline,
- cancellation on failure,
- error taxonomy,
- bulkhead per dependency,
- correlation propagation,
- fallback policy where appropriate.

A more mature design passes a deadline:

```java
Instant deadline = Instant.now().plusMillis(800);

CaseData caseData = caseClient.getCase(id, deadline);
List<Document> documents = documentClient.listDocuments(id, deadline);
RiskScore risk = riskClient.getRisk(id, deadline);
```

The important mental model:

```text
Virtual threads make fan-out easier to express.
They do not define the resilience policy.
```

---

## 17. Structured Concurrency Thinking

Structured concurrency is the idea that child tasks should have a clear parent scope:

```text
request starts
  -> child task A
  -> child task B
  -> child task C
request ends only after children finish/cancel
```

This matters because unstructured concurrency creates orphan tasks:

```java
Thread.startVirtualThread(() -> callRemoteService());
return Response.ok().build();
```

That task may still run after the response is sent.

For Jersey resource design, prefer:

```text
All work required for the response completes inside request scope.
Fire-and-forget work goes to durable queue/job system.
```

Avoid:

```text
Resource method starts background virtual thread and forgets it.
```

If a task matters, track it. If it does not matter, it probably should not exist.

---

## 18. Virtual Threads and Transactions

A common mistake is to treat virtual threads as permission to parallelize inside a transaction.

Dangerous pattern:

```java
@Transactional
public CaseOverview getOverview(String id) {
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        Future<CaseEntity> caseFuture = executor.submit(() -> caseRepository.find(id));
        Future<List<TaskEntity>> tasksFuture = executor.submit(() -> taskRepository.findByCase(id));
        return assemble(caseFuture.get(), tasksFuture.get());
    }
}
```

Problems:

- transaction context may be thread-bound,
- entity manager/session may not be thread-safe,
- lazy loading across threads can fail,
- connection ownership becomes unclear,
- isolation assumptions can break.

Better:

```text
Inside one transaction:
  use one thread and clear repository boundaries.

For parallel fan-out:
  use independent read-only calls with explicit transaction per task, or use database query optimization instead.
```

Do not parallelize JPA/Hibernate work inside one request transaction unless you deeply understand transaction propagation and thread confinement.

---

## 19. Virtual Threads and Database Pools

Suppose:

```text
request concurrency = 5000 virtual threads
HikariCP maxPoolSize = 50
```

Only 50 DB operations can hold connection concurrently. The rest wait.

This may be acceptable if you intend it. It is dangerous if accidental.

Recommended controls:

```text
- DB pool max size based on DB capacity, not request count
- connection timeout short enough to fail fast
- query timeout configured
- statement timeout configured where possible
- separate pool/bulkhead for slow reporting workloads
- endpoint-level admission control for expensive operations
```

Virtual threads reduce the memory cost of waiting for a connection. They do not increase database capacity.

---

## 20. Virtual Threads and JSON Serialization

Jersey response serialization happens after resource method returns entity.

Example:

```java
@GET
public List<CaseDto> search() {
    return caseService.searchCases();
}
```

The JSON provider writes the entity to output stream.

If `searchCases()` returns 100,000 records, cost includes:

- DTO allocation,
- object graph traversal,
- Jackson/JSON-B serialization,
- output buffering,
- network write,
- GC pressure.

Virtual thread does not make serialization free.

For large responses, prefer:

- pagination,
- streaming output,
- export job,
- cursor-based retrieval,
- explicit maximum page size,
- compression only when beneficial,
- avoid building huge object graphs.

Bad:

```java
@GET
@Path("/all")
public List<CaseDto> getAllCases() {
    return caseService.findAll();
}
```

Better:

```java
@GET
public PageResponse<CaseSummaryDto> search(@BeanParam CaseSearchRequest request) {
    request.requireReasonableLimit(100);
    return caseService.search(request);
}
```

---

## 21. Virtual Threads and File/Multipart Endpoints

Large upload/download endpoints require special care.

Virtual threads can help with blocking file I/O, but you still need:

- size limit,
- streaming,
- temp file policy,
- antivirus scanning pattern,
- cleanup,
- timeout,
- disk capacity monitoring,
- back-pressure/admission control.

Bad mental model:

```text
Virtual threads mean many large uploads are fine.
```

Correct mental model:

```text
Virtual threads reduce thread cost.
Large uploads still consume bandwidth, disk, file handles, temp storage, scanner capacity, and downstream storage throughput.
```

---

## 22. Virtual Threads and SSE/Streaming

SSE connections can stay open for a long time.

Virtual threads may reduce the cost of one thread per stream if the container supports it. But SSE bottlenecks often are:

- number of open sockets,
- proxy timeout,
- load balancer idle timeout,
- broadcaster memory,
- per-client buffer,
- slow consumer,
- reconnect storm,
- heartbeat frequency.

Virtual thread is not a substitute for streaming architecture.

For SSE:

```text
Track active sinks.
Remove disconnected sinks.
Bound per-client buffering.
Send heartbeat.
Configure proxy timeout.
Limit subscriptions per user/tenant.
Avoid per-event heavy serialization.
```

---

## 23. Java 8 Legacy Constraints

On Java 8, virtual threads do not exist.

Jersey apps on Java 8 usually rely on:

- bounded servlet worker pool,
- bounded DB pool,
- async response where needed,
- external executor for background tasks,
- careful timeout/retry design,
- reducing blocking wait,
- caching and batching,
- better query/index design.

For Java 8 systems, do not design APIs that assume cheap concurrency.

Example risk:

```text
Endpoint fan-out to 8 remote services per request.
Request concurrency 200.
Potential outbound calls = 1600.
```

On Java 8/platform threads this can exhaust:

- servlet threads,
- HTTP client connection pool,
- remote service capacity,
- CPU due to context switching.

The correct fix may be:

- aggregate dependency design,
- caching,
- asynchronous job,
- batch endpoint,
- read model/materialized view,
- reducing remote fan-out.

---

## 24. Java 11 and 17: The Middle Migration Zone

Java 11/17 migrations are common stepping stones.

Key concerns:

```text
Java 8 -> 11:
  TLS/runtime changes
  removed Java EE modules from JDK
  dependency upgrades
  reflective access warnings

Java 11 -> 17:
  stronger encapsulation
  framework compatibility
  Jakarta transition pressure
  better GC/runtime behavior
```

For Jersey:

- Jersey 2.x may remain on `javax.ws.rs`.
- Jersey 3.x moves to `jakarta.ws.rs`.
- Jersey 4.x aligns with Jakarta EE 11 / Jakarta REST 4.0.

The hard part is often not Java syntax. It is dependency convergence:

```text
javax.ws.rs-api vs jakarta.ws.rs-api
javax.servlet vs jakarta.servlet
javax.validation vs jakarta.validation
Jackson provider variant
CDI/HK2 integration
container-provided libraries
```

---

## 25. Java 21 and 25: Modern Runtime Thinking

Java 21 matters because virtual threads are finalized there.

Java 25 matters as a newer LTS target, but the same engineering principle applies:

```text
Do not upgrade runtime alone.
Upgrade the compatibility envelope.
```

Compatibility envelope:

```text
JDK version
  + Jersey version
  + Jakarta REST version
  + Servlet/container version
  + DI integration
  + JSON provider
  + validation provider
  + HTTP connector
  + build plugins
  + monitoring agent
  + application server/base image
```

You need a tested matrix, not a single version bump.

Example matrix:

| Runtime Profile | Java | Jersey | Namespace | Use Case |
|---|---:|---|---|---|
| Legacy | 8 | 2.x | `javax` | old enterprise WAR |
| Transitional | 11/17 | 2.x | `javax` | JDK migration before Jakarta migration |
| Jakarta EE 10 | 17/21 | 3.1.x | `jakarta` | modern Jakarta app |
| Jakarta EE 11 | 17/21/25 | 4.x | `jakarta` | future-facing platform |

---

## 26. Do Not Confuse Java Version with Namespace Migration

This is a frequent source of broken builds.

Java upgrade:

```text
Java 8 -> Java 17
```

Namespace migration:

```text
javax.ws.rs.* -> jakarta.ws.rs.*
```

They are related but not identical.

You can run some `javax` libraries on newer JDKs, but you cannot freely mix `javax.ws.rs` resources with a `jakarta.ws.rs` runtime.

Bad mix:

```java
import javax.ws.rs.GET;
import jakarta.ws.rs.Path;
```

This creates confusing runtime behavior because annotations may look semantically similar but are different types.

Rule:

```text
One application boundary should consistently use either javax or jakarta for the same specification family.
```

---

## 27. Migration Pattern: Java First or Jakarta First?

For legacy Jersey 2 + Java 8 apps, there are two broad strategies.

### 27.1 Java-first migration

```text
Java 8 + Jersey 2.x
  -> Java 11/17 + Jersey 2.x
  -> stabilize
  -> Jersey 3/4 + jakarta namespace
```

Pros:

- isolates JDK issues first,
- avoids huge namespace migration upfront,
- easier rollback.

Cons:

- still stuck on older API namespace,
- may need temporary dependency compromises.

### 27.2 Jakarta-first migration

```text
Java 8 + Jersey 2.x
  -> Java 17 + Jersey 3/4 + jakarta namespace
```

Pros:

- one big modernization,
- future-facing faster.

Cons:

- larger blast radius,
- more dependency conflicts,
- harder incident attribution.

For enterprise systems, Java-first is often safer unless there is a strong reason to combine migrations.

---

## 28. Designing Jersey Code That Survives Thread Model Changes

Good Jersey code should work under platform threads and virtual threads.

Principles:

```text
1. Keep resource methods stateless.
2. Avoid mutable singleton request state.
3. Avoid global synchronized locks around I/O.
4. Use explicit timeout and bulkhead.
5. Close Response/InputStream resources.
6. Keep ThreadLocal usage boundary-scoped.
7. Pass security/audit context explicitly for async/background work.
8. Avoid fire-and-forget virtual threads inside resource methods.
9. Do not share non-thread-safe objects across requests.
10. Profile before and after switching thread model.
```

---

## 29. Resource Class Design for Virtual Thread Friendliness

Bad:

```java
@Path("/cases")
@Singleton
public class CaseResource {

    private String currentUser;

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id,
                       @Context SecurityContext securityContext) {
        this.currentUser = securityContext.getUserPrincipal().getName();
        return service.getCaseForUser(id, currentUser);
    }
}
```

Problem:

```text
Singleton resource + mutable request state = race condition.
```

Better:

```java
@Path("/cases")
public class CaseResource {

    private final CaseService service;

    public CaseResource(CaseService service) {
        this.service = service;
    }

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id,
                       @Context SecurityContext securityContext) {
        String username = securityContext.getUserPrincipal().getName();
        return service.getCaseForUser(id, username);
    }
}
```

Virtual threads increase concurrency. Bad shared state becomes easier to expose.

---

## 30. Using Semaphore Bulkhead with Virtual Threads

Because virtual threads are cheap, you often need explicit concurrency gates.

Example:

```java
public final class RemoteRiskClient {

    private final Semaphore bulkhead = new Semaphore(50);
    private final WebTarget target;

    public RiskScore getRisk(String caseId) {
        boolean acquired = false;
        try {
            acquired = bulkhead.tryAcquire(200, TimeUnit.MILLISECONDS);
            if (!acquired) {
                throw new DependencyBusyException("risk-service");
            }

            try (Response response = target
                    .path("/risk/{caseId}")
                    .resolveTemplate("caseId", caseId)
                    .request(MediaType.APPLICATION_JSON_TYPE)
                    .get()) {
                return response.readEntity(RiskScore.class);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new DependencyInterruptedException("risk-service", e);
        } finally {
            if (acquired) {
                bulkhead.release();
            }
        }
    }
}
```

This matters more with virtual threads because you can have far more callers waiting cheaply.

Without bulkhead:

```text
cheap waiting -> huge pressure on dependency -> cascading failure
```

With bulkhead:

```text
cheap waiting + explicit limit -> controlled degradation
```

---

## 31. Timeout Hierarchy for Virtual-Thread-Based Jersey Apps

Timeout must be layered.

```text
Client request timeout / load balancer timeout
  > server request timeout
    > total business operation deadline
      > outbound HTTP timeout
      > DB query timeout
      > lock acquisition timeout
      > queue offer timeout
```

Bad:

```text
ALB timeout = 60s
Jersey app outbound timeout = none
DB query timeout = none
```

Better:

```text
ALB timeout = 60s
server max request expectation = 30s
business deadline = 5s
outbound connect timeout = 1s
outbound read timeout = 2s
DB statement timeout = 3s
bulkhead wait timeout = 100-300ms
```

Virtual threads do not remove the need for deadlines. They make the wait cheaper, not acceptable.

---

## 32. Observability When Adopting Virtual Threads

Before adopting virtual threads, collect baseline:

```text
- request rate
- p50/p95/p99 latency
- active requests
- servlet worker utilization
- CPU usage
- GC pause/allocation rate
- DB pool active/idle/pending
- outbound pool active/pending
- timeout count
- retry count
- error rate by type
- thread dump during load
- lock contention
```

After adopting, compare:

```text
Expected improvements:
  lower platform thread pressure
  better concurrency during blocking wait
  simpler synchronous code for fan-out

Possible regressions:
  DB pool pending spike
  downstream overload
  more concurrent memory allocation
  hidden lock contention
  MDC/context bugs
  more 429/503 from dependencies
```

Virtual threads should be treated as a runtime change requiring observability, not as a syntax feature.

---

## 33. Thread Dumps with Virtual Threads

Traditional thread dumps are often dominated by platform worker threads.

With virtual threads, there can be many more logical threads. Diagnosis changes:

Look for:

- many virtual threads waiting on DB connection,
- many virtual threads waiting on same lock,
- many virtual threads blocked on remote HTTP call,
- virtual threads performing CPU-heavy serialization,
- carrier thread pinning symptoms,
- unbounded task creation.

Useful questions:

```text
Are virtual threads waiting on useful I/O?
Are they waiting on a bottleneck we should limit?
Are they stuck due to missing timeout?
Are they blocked inside synchronized code?
Are they doing CPU work that should be bounded?
```

---

## 34. Anti-Patterns

### 34.1 “Use virtual threads, remove all pools”

Wrong. You may remove some application thread pools, but you still need pools/limits for external resources.

Keep:

- DB connection pool,
- HTTP connection pool,
- rate limiter,
- bulkhead,
- queue limits,
- CPU-bound executor where appropriate.

### 34.2 “Make every endpoint parallel”

Parallel fan-out helps only if tasks are independent and dependency capacity exists.

Bad:

```text
Parallelize 10 DB queries that could be one indexed query.
```

Better:

```text
First fix data access shape. Then parallelize independent remote waits if needed.
```

### 34.3 “Start virtual thread inside resource and return immediately”

This creates orphan work.

Use durable queues/jobs for background work.

### 34.4 “Ignore ThreadLocal cleanup because virtual threads are short-lived”

Still wrong. Cleanup is boundary discipline.

### 34.5 “Virtual threads replace async API design”

No. Long-running operations still need correct HTTP semantics:

```text
202 Accepted + job resource
GET /jobs/{id}
callback/webhook/SSE where appropriate
```

---

## 35. A Practical Adoption Plan for Existing Jersey Apps

### Step 1 — Classify endpoints

```text
A. mostly DB read
B. mostly outbound HTTP
C. CPU-heavy export/report
D. file upload/download
E. long-polling/SSE
F. command/write transaction
G. bulk operation
```

### Step 2 — Measure baseline

Do not migrate blind.

Collect:

- latency distribution,
- active threads,
- DB pool wait,
- outbound wait,
- CPU,
- GC,
- allocation,
- error taxonomy.

### Step 3 — Upgrade dependency compatibility envelope

Check:

- Jersey version,
- servlet container,
- Jakarta namespace,
- JSON provider,
- validation provider,
- monitoring agent,
- JDBC driver,
- HTTP connector,
- build plugins.

### Step 4 — Enable virtual thread execution in a controlled environment

Prefer container-level support when available.

Avoid manual `Thread.startVirtualThread` scattered across resources.

### Step 5 — Add explicit limits

Before increasing concurrency, enforce:

- DB pool limit,
- HTTP pool limit,
- dependency bulkhead,
- timeout,
- max page size,
- upload size,
- queue capacity.

### Step 6 — Load test realistic scenarios

Test:

- slow DB,
- slow remote dependency,
- partial dependency failure,
- high concurrency read,
- high concurrency write,
- large response,
- cancellation/client disconnect,
- retry storm.

### Step 7 — Roll out endpoint/profile by endpoint/profile

Avoid all-or-nothing rollout for critical enterprise apps.

---

## 36. Decision Matrix

| Situation | Virtual Threads Recommendation |
|---|---|
| Many blocking DB/HTTP calls, CPU low, worker threads saturated | strong candidate |
| CPU-bound serialization/export | weak candidate; optimize CPU/memory/workflow |
| DB pool already saturated | virtual threads may worsen pending wait; add bulkhead/query fixes |
| Heavy synchronized blocks around I/O | fix locks first |
| Jersey on old container with no virtual thread support | consider Java-first migration or controlled offload, but be careful |
| AsyncResponse used only to avoid blocking | virtual threads may simplify design |
| SSE with many clients | maybe helpful, but socket/proxy/buffer limits dominate |
| Fire-and-forget background work | use job/queue, not raw virtual threads |
| Java 8 legacy app | not available; use traditional concurrency controls |
| Java 21/25 modern app with compatible container | good modernization target after testing |

---

## 37. Production Checklist

Before enabling virtual threads for Jersey request handling:

```text
[ ] Container/server supports intended virtual thread execution model.
[ ] Jersey version tested on target JDK.
[ ] Namespace consistency checked: javax vs jakarta.
[ ] JSON provider tested under target JDK.
[ ] Validation provider tested.
[ ] JDBC driver tested.
[ ] HTTP connector tested.
[ ] Monitoring agent supports target JDK/runtime.
[ ] MDC/correlation cleanup verified.
[ ] Security context propagation verified.
[ ] Request scope behavior tested with async/offload cases.
[ ] DB pool max and timeout configured.
[ ] Outbound HTTP timeout configured.
[ ] Bulkhead/rate limit configured for dependencies.
[ ] Large response endpoints bounded.
[ ] File upload endpoints bounded.
[ ] Thread dump/profiling procedure updated.
[ ] Load test includes slow dependencies.
[ ] Rollback plan exists.
```

---

## 38. Review Questions

1. Kenapa virtual threads tidak otomatis aktif hanya karena aplikasi Jersey berjalan di Java 21+?
2. Apa perbedaan masalah yang diselesaikan `AsyncResponse` dan virtual threads?
3. Kenapa virtual threads tidak memperbesar kapasitas database?
4. Apa risiko melakukan blocking I/O di dalam `synchronized` block?
5. Kenapa `ThreadLocal`/MDC tetap harus dibersihkan walaupun virtual threads short-lived?
6. Kenapa fire-and-forget virtual thread di resource method biasanya buruk?
7. Bagaimana cara menentukan apakah endpoint Jersey cocok mendapat manfaat dari virtual threads?
8. Apa bedanya Java version upgrade dan `javax` ke `jakarta` namespace migration?
9. Kenapa parallel fan-out ke beberapa dependency tetap butuh deadline dan bulkhead?
10. Apa metrik paling penting sebelum dan sesudah migrasi ke virtual threads?

---

## 39. Kesimpulan

Virtual threads adalah perubahan besar dalam cara Java menangani concurrency blocking. Untuk aplikasi Jersey, dampaknya bisa sangat positif, terutama pada workload request/response synchronous yang banyak menunggu database atau remote HTTP.

Namun virtual threads bukan pengganti arsitektur.

Mereka tidak menggantikan:

- timeout,
- retry policy,
- bulkhead,
- rate limit,
- DB pool sizing,
- pagination,
- streaming discipline,
- transaction boundary,
- observability,
- atau compatibility testing.

Cara berpikir top-level-nya:

```text
Virtual threads reduce the cost of waiting.
They do not remove the need to control what you wait for, how many waiters exist, and what happens when waiting exceeds the business deadline.
```

Untuk Jersey engineer yang ingin naik level, skill pentingnya bukan hanya “pakai virtual thread”, melainkan mampu memutuskan:

```text
- endpoint mana yang cocok,
- container/runtime mana yang siap,
- dependency mana yang harus dibatasi,
- context mana yang harus dipropagasi,
- failure mode mana yang harus dites,
- dan kapan synchronous virtual-thread style lebih baik daripada async/reactive complexity.
```

---

## 40. Status Seri

Part ini adalah **Part 24 dari 32**.

Seri **belum selesai**.

Berikutnya:

```text
Part 25 — Deployment Models: Servlet Container, Grizzly, Embedded, Jakarta EE Server, Spring Boot
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 23 — Performance Model: Threading, Allocation, Serialization, IO, and Provider Cost](./23-performance-model-threading-allocation-serialization-io-provider-cost.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 25 — Deployment Models: Servlet Container, Grizzly, Embedded, Jakarta EE Server, Spring Boot](./25-deployment-models-servlet-container-grizzly-embedded-jakarta-ee-server-spring-boot.md)

</div>