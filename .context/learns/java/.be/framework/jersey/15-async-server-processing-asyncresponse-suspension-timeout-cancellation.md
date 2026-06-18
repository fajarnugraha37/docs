# Part 15 — Async Server Processing: `AsyncResponse`, Suspension, Timeout, and Cancellation

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `15-async-server-processing-asyncresponse-suspension-timeout-cancellation.md`  
Target pembaca: Java engineer yang sudah memahami Java concurrency, servlet/web container, Jakarta REST/JAX-RS, dan production backend engineering.  
Scope Java: Java 8 sampai Java 25.  
Scope Jersey: Jersey 2.x (`javax.ws.rs`), Jersey 3.x/4.x (`jakarta.ws.rs`).

---

## 0. Posisi Part Ini Dalam Series

Sampai Part 14, kita sudah memahami:

1. Jersey sebagai runtime Jakarta REST/JAX-RS.
2. Bootstrap aplikasi Jersey.
3. Resource model.
4. Request matching.
5. Parameter injection.
6. Entity provider pipeline.
7. JSON provider strategy.
8. Response engineering.
9. Exception mapping.
10. Filters/interceptors.
11. HK2 injection model.
12. CDI/Spring/Jersey composition model.
13. Jersey Client runtime.
14. Resilient outbound calls.

Part 15 masuk ke topik yang sering disalahpahami:

> “Kalau endpoint lambat, jadikan async.”

Itu premise yang berbahaya.

Async server processing di Jersey bukan tombol ajaib untuk membuat aplikasi lebih cepat. Async adalah mekanisme untuk **melepaskan request-processing thread dari pekerjaan yang belum bisa diselesaikan sekarang**, lalu melanjutkan response nanti ketika hasil tersedia.

Jika dipakai dengan benar, async bisa membantu:

- long-polling,
- fan-out request ke dependency eksternal,
- integrasi dengan non-blocking callback,
- background job submission,
- mengurangi thread starvation pada container thread pool,
- mengelola timeout dan cancellation secara eksplisit.

Jika dipakai salah, async bisa membuat:

- thread pool tersembunyi penuh,
- request menggantung,
- memory leak karena suspended request tidak pernah selesai,
- transaction boundary kacau,
- security/request context hilang,
- observability putus,
- client timeout lebih dulu dibanding server timeout,
- incident lebih sulit dianalisis.

Part ini akan membangun mental model agar kamu tidak sekadar tahu `@Suspended AsyncResponse`, tetapi bisa memutuskan **kapan, mengapa, dan bagaimana** async request processing dipakai secara production-grade.

---

## 1. Problem Yang Diselesaikan Async Server Processing

Dalam model synchronous REST endpoint biasa:

```java
@GET
@Path("/reports/{id}")
public ReportDto getReport(@PathParam("id") String id) {
    return reportService.generateReport(id);
}
```

Request masuk:

```text
client
  -> servlet/container request thread
       -> Jersey matching
       -> resource method
       -> service call
       -> return response
  <- response
```

Selama `generateReport(id)` berjalan, thread yang memproses request tetap tertahan.

Jika operasi cepat, itu normal.

Jika operasi lambat, misalnya:

- menunggu remote API,
- menunggu queue result,
- menunggu event dari sistem lain,
- melakukan long-polling,
- menunggu job completion,
- melakukan stream event,

maka synchronous request bisa mengikat thread terlalu lama.

Async processing memungkinkan alur seperti ini:

```text
client
  -> request thread menerima request
       -> Jersey resource method dipanggil
       -> request disuspend
       -> request thread dilepas ke pool

  ... nanti, di thread lain / callback lain ...

  -> hasil tersedia
       -> AsyncResponse.resume(result)
  <- response dikirim ke client
```

Mental model penting:

> AsyncResponse tidak membuat kerja menjadi ringan. Ia hanya memisahkan umur request HTTP dari umur thread awal yang menerima request.

---

## 2. Synchronous vs Asynchronous: Perbedaan Yang Sering Kabur

### 2.1 Synchronous endpoint

```java
@GET
@Path("/status/{id}")
public StatusDto getStatus(@PathParam("id") String id) {
    return statusService.load(id);
}
```

Karakteristik:

- resource method return langsung menjadi response,
- exception dilempar dari method bisa diproses oleh `ExceptionMapper`,
- request thread tertahan sampai method selesai,
- lifecycle mudah dipahami,
- context biasanya masih tersedia di thread yang sama.

Cocok untuk:

- operasi cepat,
- request sederhana,
- CPU ringan,
- query database biasa,
- command pendek,
- response segera.

### 2.2 Asynchronous endpoint dengan `AsyncResponse`

```java
@GET
@Path("/status/{id}/wait")
public void waitForStatus(
        @PathParam("id") String id,
        @Suspended AsyncResponse asyncResponse) {

    statusWaiter.waitAsync(id, result -> {
        asyncResponse.resume(result);
    });
}
```

Karakteristik:

- resource method biasanya `void`,
- response belum dikirim saat method selesai,
- request berada dalam suspended state,
- response dikirim saat `resume(...)` dipanggil,
- timeout/cancellation harus dipikirkan,
- context propagation menjadi tanggung jawab desain,
- resource leak lebih mungkin terjadi.

Cocok untuk:

- long-polling,
- callback-driven integration,
- waiting for external event,
- request yang secara natural tidak selesai segera,
- endpoint yang perlu melepas container thread.

Tidak otomatis cocok untuk:

- CPU-bound task berat,
- operasi database lambat akibat query buruk,
- blocking IO tanpa pool isolation,
- desain yang seharusnya memakai `202 Accepted` + polling,
- workload yang client/proxy-nya punya timeout pendek.

---

## 3. Core API: `@Suspended` dan `AsyncResponse`

Di Jakarta REST/JAX-RS, async server endpoint biasanya memakai:

```java
import jakarta.ws.rs.container.AsyncResponse;
import jakarta.ws.rs.container.Suspended;
```

Untuk Jersey 2.x / Java EE style:

```java
import javax.ws.rs.container.AsyncResponse;
import javax.ws.rs.container.Suspended;
```

Contoh minimal:

```java
@GET
@Path("/async-hello")
public void hello(@Suspended AsyncResponse async) {
    new Thread(() -> {
        async.resume("hello");
    }).start();
}
```

Contoh di atas benar secara mekanik, tetapi buruk untuk production karena membuat thread manual per request.

Versi lebih sehat:

```java
@Path("/reports")
public class ReportResource {

    private final ExecutorService executor;
    private final ReportService reportService;

    public ReportResource(ExecutorService executor, ReportService reportService) {
        this.executor = executor;
        this.reportService = reportService;
    }

    @GET
    @Path("/{id}/preview")
    public void preview(
            @PathParam("id") String id,
            @Suspended AsyncResponse async) {

        executor.submit(() -> {
            try {
                ReportPreviewDto dto = reportService.generatePreview(id);
                async.resume(dto);
            } catch (Throwable t) {
                async.resume(t);
            }
        });
    }
}
```

Catatan penting:

- `async.resume(dto)` mengirim normal response melalui Jersey pipeline.
- `async.resume(exception)` mengirim exception ke exception mapping pipeline.
- `resume` hanya boleh efektif sekali.
- Setelah resumed/cancelled/timed out, suspended request sudah tidak boleh dianggap aktif.

---

## 4. Mental Model: Request Suspension Bukan Background Job

AsyncResponse sering disalahartikan sebagai background job API.

Padahal ada perbedaan besar:

| Model | Client menunggu HTTP response? | Cocok untuk | Risiko |
|---|---:|---|---|
| Sync request | Ya | operasi cepat | thread tertahan |
| AsyncResponse | Ya | request menunggu event sebentar/sedang | suspended request leak |
| `202 Accepted` + polling | Tidak langsung | operasi panjang | butuh job state model |
| Queue/event async | Tidak | workflow panjang, decoupled | eventual consistency |
| SSE/WebSocket | Ya, koneksi panjang | streaming event | resource per connection |

`AsyncResponse` masih mempertahankan HTTP request yang sama.

Artinya:

```text
client connection masih hidup
proxy timeout masih relevan
server memory masih memegang request state
security/correlation/audit context perlu dijaga
```

Jika pekerjaan bisa berlangsung menit/jam, jangan langsung memilih `AsyncResponse`.

Lebih sehat:

```http
POST /exports
-> 202 Accepted
Location: /exports/{jobId}

GET /exports/{jobId}
-> status: PENDING/RUNNING/DONE/FAILED

GET /exports/{jobId}/file
-> download result
```

AsyncResponse cocok ketika:

- client memang harus menunggu response request yang sama,
- durasi masih masuk akal dibanding timeout proxy/client,
- jumlah suspended request bisa dikontrol,
- ada timeout/cancellation cleanup,
- pekerjaan tidak perlu survive server restart.

---

## 5. Lifecycle `AsyncResponse`

Lifecycle sederhana:

```text
REQUEST ARRIVES
    |
    v
Jersey matches resource method
    |
    v
Resource method receives @Suspended AsyncResponse
    |
    v
Resource method returns without final response
    |
    v
Request is suspended
    |
    +--> resume(entity)       -> normal response
    +--> resume(Throwable)    -> exception mapping
    +--> cancel()             -> cancel response
    +--> timeout              -> timeout handling
    +--> client disconnect    -> completion/callback depending container/runtime
```

State yang perlu dipahami:

```text
active/suspended
resumed
cancelled
timed out
done
```

Secara desain, aplikasi harus menganggap `AsyncResponse` sebagai one-shot response handle.

Jangan mendesain flow seperti ini:

```java
async.resume(firstResult);
async.resume(secondResult); // salah: response sudah selesai
```

Untuk multiple event, gunakan:

- SSE,
- WebSocket,
- polling,
- message queue + state store.

---

## 6. Return Type Resource Method Async

Pola umum:

```java
public void method(@Suspended AsyncResponse async) { ... }
```

atau:

```java
public void method(@Suspended final AsyncResponse async) { ... }
```

Resource method tidak return entity langsung karena response akan dikirim lewat `async.resume`.

Yang tidak boleh rancu:

```java
@GET
public Response wrong(@Suspended AsyncResponse async) {
    async.resume("later");
    return Response.ok("now").build(); // desain kacau
}
```

Hindari mencampur return langsung dengan suspended response.

---

## 7. Normal Completion: `resume(entity)`

Contoh:

```java
@GET
@Path("/checks/{id}/wait")
public void waitCheck(
        @PathParam("id") String id,
        @Suspended AsyncResponse async) {

    checkService.onCompleted(id, check -> {
        CheckResultDto dto = CheckResultDto.from(check);
        async.resume(dto);
    });
}
```

Saat `resume(dto)` dipanggil:

1. Jersey menerima entity `dto`.
2. Jersey memilih `MessageBodyWriter` berdasarkan type + media type.
3. Response filter/interceptor dapat tetap berjalan.
4. Response dikirim.

Artinya semua pembahasan Part 6–10 masih relevan.

`AsyncResponse` bukan bypass Jersey pipeline.

---

## 8. Error Completion: `resume(Throwable)`

Contoh:

```java
executor.submit(() -> {
    try {
        var result = service.compute(id);
        async.resume(result);
    } catch (DomainNotFoundException ex) {
        async.resume(ex);
    } catch (Throwable t) {
        async.resume(t);
    }
});
```

Jika kamu sudah punya:

```java
@Provider
public class DomainNotFoundMapper implements ExceptionMapper<DomainNotFoundException> {
    @Override
    public Response toResponse(DomainNotFoundException exception) {
        return Response.status(Response.Status.NOT_FOUND)
                .entity(ApiError.notFound(exception.code()))
                .build();
    }
}
```

Maka `async.resume(new DomainNotFoundException(...))` akan mengikuti exception mapping pipeline.

Ini penting untuk menjaga error contract tetap konsisten antara sync dan async endpoint.

Anti-pattern:

```java
catch (Exception e) {
    async.resume(Response.serverError()
        .entity(e.getMessage())
        .build());
}
```

Masalah:

- error contract bypassed,
- stack/detail bisa bocor,
- correlation ID bisa hilang,
- taxonomy error tidak konsisten.

Lebih baik:

```java
catch (Throwable t) {
    async.resume(t);
}
```

Lalu biarkan `ExceptionMapper` pusat yang memutuskan shape response.

---

## 9. Timeout Handling

Suspended request harus punya timeout.

Tanpa timeout, failure mode-nya buruk:

```text
request suspended
callback tidak pernah datang
client mungkin sudah disconnect
server masih menyimpan state
memory/context/listener tetap hidup
akhirnya leak atau resource exhaustion
```

Contoh:

```java
@GET
@Path("/approval/{id}/wait")
public void waitApproval(
        @PathParam("id") String id,
        @Suspended AsyncResponse async) {

    async.setTimeout(30, TimeUnit.SECONDS);
    async.setTimeoutHandler(ar -> {
        ar.resume(Response.status(Response.Status.REQUEST_TIMEOUT)
                .entity(ApiError.timeout("APPROVAL_WAIT_TIMEOUT"))
                .build());
    });

    approvalWaiter.register(id, result -> async.resume(result));
}
```

Beberapa pilihan status timeout:

| Status | Kapan dipakai |
|---:|---|
| `408 Request Timeout` | server menutup karena request wait melebihi batas |
| `504 Gateway Timeout` | gateway/dependency downstream timeout, biasanya di API gateway/proxy atau dependency mapping |
| `503 Service Unavailable` | sistem overload atau tidak bisa menerima wait |
| `202 Accepted` | seharusnya operasi dipindah ke job model |

Untuk long-polling, timeout bukan selalu error fatal. Bisa menjadi response normal:

```json
{
  "status": "NO_CHANGE",
  "nextPollAfterMs": 3000
}
```

Atau:

```http
204 No Content
```

Pilihan tergantung contract API.

---

## 10. Timeout Layering: Client, Proxy, Server, Dependency

Timeout async endpoint harus selaras dengan chain deployment:

```text
Client timeout
  > API Gateway / ALB / Nginx idle timeout
      > Servlet container async timeout
          > Jersey AsyncResponse timeout
              > dependency timeout
```

Jika tidak selaras, bug-nya membingungkan.

Contoh salah:

```text
client timeout: 10s
ALB idle timeout: 60s
Jersey async timeout: 120s
dependency timeout: 90s
```

Yang terjadi:

- client sudah menyerah di 10s,
- server tetap menunggu sampai 120s,
- dependency tetap berjalan sampai 90s,
- hasil akhirnya tidak berguna,
- resource terpakai untuk client yang sudah pergi.

Lebih sehat:

```text
client timeout: 35s
proxy idle timeout: 40s
Jersey async timeout: 30s
dependency timeout: 25s
internal executor queue timeout: 20s
```

Prinsip:

> Timeout terdalam harus lebih pendek daripada timeout terluar, agar sistem yang paling dekat dengan penyebab masalah bisa gagal dulu dan membersihkan resource.

---

## 11. Cancellation

`AsyncResponse` menyediakan mekanisme cancellation.

Contoh sederhana:

```java
boolean cancelled = async.cancel();
```

Namun cancellation harus dipahami hati-hati.

`cancel()` membatalkan suspended response dari sisi Jersey, tetapi belum tentu otomatis membatalkan pekerjaan background yang sudah berjalan.

Contoh buruk:

```java
Future<?> future = executor.submit(() -> expensiveWork());
async.cancel();
// expensiveWork mungkin tetap jalan
```

Lebih baik desain cancellation-aware:

```java
Future<?> future = executor.submit(() -> {
    try {
        Result result = expensiveWorkWithCancellationCheck();
        if (!async.isDone()) {
            async.resume(result);
        }
    } catch (Throwable t) {
        if (!async.isDone()) {
            async.resume(t);
        }
    }
});

async.register((CompletionCallback) throwable -> {
    if (!future.isDone()) {
        future.cancel(true);
    }
});
```

Tetapi `Future.cancel(true)` hanya efektif jika pekerjaan:

- memperhatikan interrupt,
- tidak menelan `InterruptedException`,
- tidak blocking di API yang tidak interruptible,
- memiliki timeout sendiri.

Cancellation bukan magic.

---

## 12. Completion Callback

Kita butuh cleanup setelah async response selesai.

Contoh:

```java
async.register((CompletionCallback) throwable -> {
    waiterRegistry.remove(waitKey);
    metrics.decrementInFlightWaits();
});
```

Use case:

- hapus listener dari registry,
- release permit semaphore,
- decrement metric,
- cancel scheduled timeout task,
- cleanup correlation context,
- log completion.

Pattern:

```java
@GET
@Path("/events/{id}/wait")
public void waitEvent(
        @PathParam("id") String id,
        @Suspended AsyncResponse async) {

    String waitKey = UUID.randomUUID().toString();
    metrics.incrementInFlightWaits();

    async.register((CompletionCallback) throwable -> {
        eventWaiter.unregister(waitKey);
        metrics.decrementInFlightWaits();
    });

    async.setTimeout(25, TimeUnit.SECONDS);
    async.setTimeoutHandler(ar -> ar.resume(Response.noContent().build()));

    eventWaiter.register(waitKey, id, event -> {
        if (!async.isDone()) {
            async.resume(event);
        }
    });
}
```

Tanpa completion callback, long-polling endpoint sangat mudah bocor.

---

## 13. Connection Callback dan Client Disconnect

Dalam praktik production, client bisa disconnect sebelum server resume.

Penyebab:

- browser tab ditutup,
- mobile network hilang,
- API gateway timeout,
- client timeout,
- reverse proxy reset,
- deployment rolling restart.

JAX-RS menyediakan callback seperti `ConnectionCallback` di beberapa implementasi/API untuk mendeteksi disconnect, tetapi behavior detail bisa bergantung container.

Jangan membuat logic bisnis kritikal bergantung penuh pada disconnect callback.

Gunakan callback untuk cleanup best-effort:

```java
async.register((ConnectionCallback) disconnected -> {
    waiterRegistry.remove(waitKey);
    metrics.incrementDisconnectCount();
});
```

Tetapi tetap punya:

- timeout,
- completion callback,
- scheduled cleanup,
- bounded registry.

---

## 14. Race Condition: Resume vs Timeout vs Cancel

Async endpoint punya race alami.

Contoh:

```text
T1: timeout handler mulai jalan
T2: external event callback datang
T3: client disconnect
```

Semua bisa mencoba menyelesaikan response.

Pattern aman:

```java
if (!async.isDone()) {
    async.resume(result);
}
```

Tetapi check-then-act sendiri tidak selalu atomic secara semantik.

Lebih kuat gunakan guard sendiri:

```java
AtomicBoolean completed = new AtomicBoolean(false);

Runnable cleanup = () -> registry.remove(waitKey);

async.setTimeoutHandler(ar -> {
    if (completed.compareAndSet(false, true)) {
        cleanup.run();
        ar.resume(Response.noContent().build());
    }
});

registry.register(waitKey, event -> {
    if (completed.compareAndSet(false, true)) {
        cleanup.run();
        async.resume(event);
    }
});

async.register((CompletionCallback) t -> {
    if (completed.compareAndSet(false, true)) {
        cleanup.run();
    }
});
```

Namun hati-hati: jangan cleanup dua kali atau melewatkan cleanup. Buat utility kecil untuk one-shot completion bila pattern sering dipakai.

---

## 15. Executor Ownership

Ini salah satu bagian paling penting.

AsyncResponse hanya melepas request thread awal. Pekerjaan lanjutannya harus berjalan di suatu executor, callback loop, event thread, atau mekanisme lain.

Pertanyaan arsitektural:

> Siapa pemilik executor untuk pekerjaan async?

Jangan membuat executor sembarangan di resource:

```java
@GET
public void bad(@Suspended AsyncResponse async) {
    Executors.newFixedThreadPool(10).submit(() -> async.resume(work()));
}
```

Masalah:

- executor dibuat per request,
- thread leak,
- shutdown tidak terkontrol,
- metric tidak ada,
- queue tidak bounded,
- tidak ada rejection policy.

Lebih sehat:

```java
public class AsyncExecutors {
    private final ThreadPoolExecutor reportExecutor;

    public AsyncExecutors() {
        this.reportExecutor = new ThreadPoolExecutor(
                8,
                32,
                60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(500),
                new NamedThreadFactory("report-async-"),
                new ThreadPoolExecutor.AbortPolicy()
        );
    }

    public ExecutorService reportExecutor() {
        return reportExecutor;
    }
}
```

Saat queue penuh:

```java
try {
    executor.submit(task);
} catch (RejectedExecutionException ex) {
    async.resume(Response.status(Response.Status.SERVICE_UNAVAILABLE)
            .entity(ApiError.overloaded("ASYNC_EXECUTOR_FULL"))
            .build());
}
```

Prinsip:

> Setiap async endpoint harus punya capacity model: jumlah thread, ukuran queue, timeout, rejection behavior, dan metric.

---

## 16. Thread Pool Sizing: Jangan Menyembunyikan Bottleneck

Misalnya endpoint async melakukan blocking call ke dependency eksternal.

```text
traffic: 200 RPS
remote latency p95: 2s
concurrency needed ≈ 200 * 2 = 400 in-flight calls
```

Jika executor hanya 50 thread dan queue 10.000:

- request cepat disuspend,
- queue membesar,
- latency makin panjang,
- client timeout,
- server tetap kerja untuk request yang sudah tidak relevan,
- memory naik.

Jika executor 1000 thread di Java 8:

- context switching besar,
- memory stack tinggi,
- remote dependency bisa dihantam,
- incident menyebar.

Async tidak menghilangkan Little’s Law:

```text
concurrency = throughput × latency
```

Yang berubah hanya lokasi concurrency:

```text
sebelum async: container thread pool
sesudah async: executor/callback registry/suspended request registry
```

---

## 17. Bounded Concurrency Dengan Semaphore

Untuk mencegah overload, batasi jumlah suspended wait.

```java
public class WaitLimiter {
    private final Semaphore permits = new Semaphore(200);

    public boolean tryAcquire() {
        return permits.tryAcquire();
    }

    public void release() {
        permits.release();
    }
}
```

Pemakaian:

```java
@GET
@Path("/cases/{id}/wait")
public void waitCase(
        @PathParam("id") String id,
        @Suspended AsyncResponse async) {

    if (!waitLimiter.tryAcquire()) {
        async.resume(Response.status(Response.Status.SERVICE_UNAVAILABLE)
                .entity(ApiError.overloaded("TOO_MANY_SUSPENDED_REQUESTS"))
                .build());
        return;
    }

    AtomicBoolean released = new AtomicBoolean(false);
    Runnable releaseOnce = () -> {
        if (released.compareAndSet(false, true)) {
            waitLimiter.release();
        }
    };

    async.register((CompletionCallback) t -> releaseOnce.run());
    async.setTimeout(25, TimeUnit.SECONDS);
    async.setTimeoutHandler(ar -> {
        releaseOnce.run();
        ar.resume(Response.noContent().build());
    });

    caseWaiter.register(id, update -> {
        releaseOnce.run();
        async.resume(update);
    });
}
```

Tanpa bounded concurrency, async endpoint bisa menjadi memory leak berbentuk fitur.

---

## 18. AsyncResponse Untuk Long-Polling

Long-polling pattern:

```text
client: GET /notifications?after=123
server:
  if event exists -> return immediately
  else suspend up to 25s
  if event arrives -> return event
  if timeout -> return no change
client repeats
```

Contoh desain:

```java
@GET
@Path("/notifications")
public void poll(
        @QueryParam("after") long after,
        @Suspended AsyncResponse async) {

    List<NotificationDto> existing = notificationStore.findAfter(after, 100);
    if (!existing.isEmpty()) {
        async.resume(existing);
        return;
    }

    async.setTimeout(25, TimeUnit.SECONDS);
    async.setTimeoutHandler(ar -> ar.resume(Response.noContent().build()));

    String registrationId = notificationWaiter.register(after, notifications -> {
        async.resume(notifications);
    });

    async.register((CompletionCallback) t -> {
        notificationWaiter.unregister(registrationId);
    });
}
```

Important design details:

- Always check existing data first.
- Register listener only if no data exists.
- Timeout with normal no-change response.
- Cleanup registration on completion.
- Bound maximum waiters per user/tenant.
- Avoid one suspended request per tab/device without limit.

Race condition yang harus dipikirkan:

```text
1. Server check existing event: none.
2. Event arrives.
3. Server registers waiter.
4. Waiter misses event.
5. Request times out even though event exists.
```

Solusi:

- gunakan atomic register-and-check pattern,
- gunakan monotonically increasing sequence,
- setelah register, check lagi,
- waiter registry harus memahami cursor.

Pattern:

```java
String registrationId = waiter.register(after, callback);
List<NotificationDto> afterRegister = store.findAfter(after, 100);
if (!afterRegister.isEmpty()) {
    waiter.unregister(registrationId);
    async.resume(afterRegister);
}
```

Tetap butuh guard one-shot agar callback dan check kedua tidak double resume.

---

## 19. AsyncResponse Untuk Fan-Out Remote Calls

Misalnya endpoint harus memanggil tiga dependency:

```text
GET /dashboard/{userId}
  -> profile service
  -> notification service
  -> entitlement service
```

Naive sync:

```java
Profile p = profileClient.get(userId);
Notifications n = notificationClient.get(userId);
Entitlements e = entitlementClient.get(userId);
return combine(p, n, e);
```

Async dengan `CompletableFuture`:

```java
@GET
@Path("/dashboard/{userId}")
public void dashboard(
        @PathParam("userId") String userId,
        @Suspended AsyncResponse async) {

    async.setTimeout(3, TimeUnit.SECONDS);
    async.setTimeoutHandler(ar -> ar.resume(
            Response.status(Response.Status.GATEWAY_TIMEOUT)
                    .entity(ApiError.timeout("DASHBOARD_TIMEOUT"))
                    .build()
    ));

    CompletableFuture<ProfileDto> profile = CompletableFuture.supplyAsync(
            () -> profileClient.get(userId), outboundExecutor);

    CompletableFuture<List<NotificationDto>> notifications = CompletableFuture.supplyAsync(
            () -> notificationClient.get(userId), outboundExecutor);

    CompletableFuture<EntitlementDto> entitlements = CompletableFuture.supplyAsync(
            () -> entitlementClient.get(userId), outboundExecutor);

    CompletableFuture.allOf(profile, notifications, entitlements)
            .thenApply(ignored -> DashboardDto.of(
                    profile.join(),
                    notifications.join(),
                    entitlements.join()))
            .whenComplete((dto, throwable) -> {
                if (throwable != null) {
                    async.resume(unwrapCompletionException(throwable));
                } else {
                    async.resume(dto);
                }
            });
}
```

Catatan:

- Setiap client call tetap perlu timeout sendiri.
- Executor harus bounded.
- `CompletableFuture` default common pool sebaiknya dihindari untuk blocking IO.
- Error mapping harus tetap konsisten.
- Context propagation harus dipikirkan.

---

## 20. `CompletableFuture` Pitfall

### 20.1 Memakai common pool untuk blocking IO

Buruk:

```java
CompletableFuture.supplyAsync(() -> jerseyClientCall());
```

Tanpa executor eksplisit, ini memakai common ForkJoinPool. Blocking IO di common pool dapat mengganggu task lain dalam JVM.

Lebih baik:

```java
CompletableFuture.supplyAsync(() -> jerseyClientCall(), outboundExecutor);
```

### 20.2 Exception terbungkus

`CompletableFuture` sering membungkus exception dalam:

- `CompletionException`,
- `ExecutionException`.

Buat helper:

```java
private Throwable unwrapCompletionException(Throwable t) {
    if ((t instanceof CompletionException || t instanceof ExecutionException)
            && t.getCause() != null) {
        return t.getCause();
    }
    return t;
}
```

### 20.3 Tidak membatalkan subtask saat async timeout

Jika `AsyncResponse` timeout, `CompletableFuture` subtask bisa tetap jalan.

Pattern lebih baik:

```java
List<CompletableFuture<?>> futures = List.of(profile, notifications, entitlements);

async.register((CompletionCallback) t -> {
    futures.forEach(f -> f.cancel(true));
});
```

Tetapi lagi-lagi, cancellation hanya efektif jika task cooperative.

---

## 21. Context Propagation

Dalam synchronous endpoint, kamu sering mengandalkan:

- `SecurityContext`,
- `UriInfo`,
- request headers,
- correlation ID di MDC,
- tenant context di ThreadLocal,
- locale,
- transaction context,
- CDI/Spring request scope.

Dalam async flow, pekerjaan bisa lanjut di thread lain.

ThreadLocal tidak otomatis pindah.

Contoh bug:

```java
MDC.put("correlationId", cid);

executor.submit(() -> {
    log.info("processing async"); // MDC kosong
});
```

Pattern manual:

```java
Map<String, String> contextMap = MDC.getCopyOfContextMap();
SecurityContext security = this.securityContext;

executor.submit(() -> {
    Map<String, String> old = MDC.getCopyOfContextMap();
    try {
        if (contextMap != null) {
            MDC.setContextMap(contextMap);
        }
        service.process(security.getUserPrincipal().getName());
        async.resume(result);
    } catch (Throwable t) {
        async.resume(t);
    } finally {
        MDC.clear();
        if (old != null) {
            MDC.setContextMap(old);
        }
    }
});
```

Lebih baik buat wrapper executor:

```java
public final class ContextAwareExecutor implements Executor {
    private final Executor delegate;

    public ContextAwareExecutor(Executor delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        Map<String, String> mdc = MDC.getCopyOfContextMap();
        delegate.execute(() -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                if (mdc != null) {
                    MDC.setContextMap(mdc);
                } else {
                    MDC.clear();
                }
                command.run();
            } finally {
                MDC.clear();
                if (previous != null) {
                    MDC.setContextMap(previous);
                }
            }
        });
    }
}
```

Untuk enterprise runtime, pertimbangkan ManagedExecutor / MicroProfile Context Propagation jika tersedia.

---

## 22. SecurityContext Dalam Async Flow

Contoh:

```java
@Context
SecurityContext securityContext;
```

Jika resource instance request-scoped, `securityContext` mungkin aman dibaca selama request aktif. Tetapi jangan menyimpan object context mentah ke job jangka panjang.

Lebih baik capture value eksplisit:

```java
String userId = securityContext.getUserPrincipal().getName();
boolean isAdmin = securityContext.isUserInRole("ADMIN");
```

Lalu kirim value ke task:

```java
executor.submit(() -> {
    auditContext.runAs(userId, () -> {
        Result result = service.process(userId, isAdmin);
        async.resume(result);
    });
});
```

Prinsip:

> Jangan menyebarkan request context object. Sebarkan snapshot data yang memang dibutuhkan.

---

## 23. Transaction Boundary

Kesalahan umum:

```java
@Transactional
@GET
@Path("/async")
public void async(@Suspended AsyncResponse async) {
    executor.submit(() -> {
        entityManager.persist(...); // transaction dari method awal tidak ikut
        async.resume(...);
    });
}
```

Transaction annotation pada resource method biasanya berlaku pada thread/method invocation awal. Begitu pekerjaan pindah ke thread lain, transaction boundary tidak otomatis ikut.

Desain yang benar:

```java
executor.submit(() -> {
    try {
        Result result = transactionalService.doInTransaction(input);
        async.resume(result);
    } catch (Throwable t) {
        async.resume(t);
    }
});
```

Transaction harus dimulai di thread yang menjalankan pekerjaan database.

Mental model:

```text
Resource method async = HTTP coordination boundary
Service method = business/transaction boundary
Async executor task = execution boundary
```

Jangan berharap annotation transaction di boundary HTTP menyelesaikan semua.

---

## 24. Request Scope dan Bean Lifecycle

Jika memakai CDI/Spring request scope, async bisa membuat lifecycle rumit.

Contoh masalah:

```java
@RequestScoped
public class RequestContextHolder {
    ...
}

executor.submit(() -> requestContextHolder.getTenantId());
```

Saat task berjalan:

- request method awal sudah selesai,
- context mungkin tidak aktif,
- proxy bisa gagal,
- data bisa kosong,
- behavior tergantung container.

Lebih aman:

```java
String tenantId = requestContextHolder.getTenantId();
executor.submit(() -> service.process(tenantId));
```

Capture primitive/value object, bukan request-scoped proxy.

---

## 25. AsyncResponse vs Servlet Async

Jersey async server processing biasanya berjalan di atas kemampuan async dari container/Servlet ketika deployed di servlet environment.

Tapi engineer harus membedakan layer:

```text
Servlet container async support
    provides low-level request suspension mechanism

Jakarta REST/JAX-RS AsyncResponse
    provides resource-level async response API

Jersey
    implements and integrates it with Jersey pipeline
```

Jika terjadi bug async, sumbernya bisa dari:

- Jersey resource method,
- Jersey async implementation,
- servlet async timeout,
- connector thread pool,
- container config,
- reverse proxy,
- client timeout.

Debugging harus memperhatikan semua layer.

---

## 26. AsyncResponse vs Non-Blocking IO

`AsyncResponse` bukan berarti non-blocking IO end-to-end.

Contoh:

```java
executor.submit(() -> {
    Result r = blockingJdbcQuery();
    async.resume(r);
});
```

Ini async dari sisi request thread, tetapi tetap blocking pada executor thread.

Non-blocking end-to-end membutuhkan:

- non-blocking client,
- non-blocking driver,
- callback/future model,
- container support,
- back-pressure strategy.

Jersey async API bisa dipakai untuk menghubungkan callback non-blocking ke HTTP response, tetapi tidak otomatis mengubah blocking code menjadi non-blocking.

---

## 27. AsyncResponse vs Reactive Programming

AsyncResponse adalah imperative async handle.

Reactive framework biasanya menyediakan:

- publisher/subscriber,
- back-pressure,
- composition operator,
- cancellation semantics,
- event loop model.

Jersey AsyncResponse lebih sederhana:

```text
suspend once
resume once
```

Jika kebutuhanmu:

- satu response nanti,
- wait event,
- bridge callback,

AsyncResponse cukup.

Jika kebutuhanmu:

- stream banyak item,
- back-pressure,
- reactive composition kompleks,

pertimbangkan SSE, WebSocket, reactive stack, atau streaming mechanism lain.

---

## 28. AsyncResponse Dengan Java 8

Java 8 baseline:

- `CompletableFuture` tersedia,
- virtual threads belum ada,
- blocking IO membutuhkan thread platform,
- thread pool sizing sangat penting,
- memory per thread lebih mahal dibanding virtual thread.

Rekomendasi Java 8:

- gunakan bounded executor,
- hindari common pool untuk blocking IO,
- selalu set timeout,
- jangan membuat thread per request,
- perhatikan stack size/thread count,
- pakai resilience library jika perlu,
- observability wajib karena async stack trace lebih sulit.

---

## 29. AsyncResponse Dengan Java 11/17

Java 11/17 memberi runtime lebih modern:

- TLS lebih baik,
- GC lebih matang,
- Java Flight Recorder lebih umum,
- container awareness membaik,
- HTTP Client Java standar tersedia sejak Java 11.

Tetapi untuk Jersey async server:

- konsep `AsyncResponse` tetap sama,
- thread pool tetap perlu bounded,
- context propagation tetap tidak otomatis,
- timeout layering tetap wajib.

Java 17 sering menjadi baseline modern untuk Jakarta stack baru.

---

## 30. AsyncResponse Dengan Java 21/25 dan Virtual Threads

Virtual threads mengubah cost model blocking IO.

Dengan virtual threads, blocking operation bisa lebih murah dari sisi thread resource dibanding platform threads.

Namun:

- Jersey async API tetap one-shot suspended response API,
- container support menentukan apakah request handling memakai virtual thread,
- ThreadLocal/MDC propagation tetap perlu desain,
- pinning bisa terjadi jika blocking di synchronized/native tertentu,
- database/HTTP client connection pool tetap bottleneck,
- remote dependency tetap punya latency dan capacity limit,
- back-pressure tetap wajib.

Pertanyaan penting:

> Jika container sudah menjalankan request dengan virtual threads, apakah AsyncResponse masih perlu?

Jawabannya: tergantung.

AsyncResponse masih berguna untuk:

- long-polling yang menunggu event callback,
- request suspension tanpa menahan thread virtual sekalipun,
- integrasi dengan event-driven callback,
- explicit timeout/cancellation response handle.

Namun untuk endpoint blocking sederhana:

```java
@GET
public Dto get() {
    return blockingService.load();
}
```

Di runtime virtual-thread-friendly, synchronous style mungkin lebih sederhana dan cukup skalabel.

Prinsip:

> Virtual threads mengurangi alasan memakai AsyncResponse untuk sekadar menghindari thread blocking, tetapi tidak menghilangkan kebutuhan async untuk event-driven wait, cancellation, dan request suspension semantics.

---

## 31. Designing Async Endpoint: Decision Tree

Sebelum memakai `AsyncResponse`, tanyakan:

```text
1. Apakah response harus dikirim pada HTTP request yang sama?
   - Tidak -> gunakan 202 + job resource / queue.
   - Ya -> lanjut.

2. Apakah durasi maksimum lebih pendek dari timeout client/proxy?
   - Tidak -> jangan pakai AsyncResponse sebagai wait panjang.
   - Ya -> lanjut.

3. Apakah jumlah concurrent wait bisa dibatasi?
   - Tidak -> desain ulang.
   - Ya -> lanjut.

4. Apakah ada timeout dan cleanup?
   - Tidak -> belum production-ready.
   - Ya -> lanjut.

5. Apakah pekerjaan background punya executor/callback owner yang jelas?
   - Tidak -> belum production-ready.
   - Ya -> lanjut.

6. Apakah context/security/correlation perlu dipropagasi?
   - Ya -> capture snapshot eksplisit.

7. Apakah cancellation perlu menghentikan task downstream?
   - Ya -> task harus cooperative dan timeout-aware.
```

---

## 32. Production Pattern: Async Wait Registry

Misalnya sistem case management ingin endpoint:

```http
GET /cases/{caseId}/changes?afterVersion=105
```

Jika ada perubahan setelah version 105, return langsung. Jika belum ada, tunggu sampai 25 detik.

### 32.1 Contract

Response jika ada update:

```json
{
  "caseId": "CASE-001",
  "version": 106,
  "events": [
    {
      "type": "STATUS_CHANGED",
      "timestamp": "2026-06-16T10:30:00Z"
    }
  ]
}
```

Response jika timeout tanpa update:

```http
204 No Content
```

Response jika terlalu banyak wait:

```http
503 Service Unavailable
Retry-After: 3
```

### 32.2 Resource

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
public class CaseChangeResource {

    private final CaseChangeStore changeStore;
    private final CaseChangeWaitRegistry waitRegistry;
    private final WaitLimiter waitLimiter;

    public CaseChangeResource(
            CaseChangeStore changeStore,
            CaseChangeWaitRegistry waitRegistry,
            WaitLimiter waitLimiter) {
        this.changeStore = changeStore;
        this.waitRegistry = waitRegistry;
        this.waitLimiter = waitLimiter;
    }

    @GET
    @Path("/{caseId}/changes")
    public void waitForChanges(
            @PathParam("caseId") String caseId,
            @QueryParam("afterVersion") long afterVersion,
            @Suspended AsyncResponse async) {

        List<CaseEventDto> existing = changeStore.findAfter(caseId, afterVersion);
        if (!existing.isEmpty()) {
            async.resume(CaseChangeResponse.of(caseId, existing));
            return;
        }

        if (!waitLimiter.tryAcquire()) {
            async.resume(Response.status(Response.Status.SERVICE_UNAVAILABLE)
                    .header(HttpHeaders.RETRY_AFTER, "3")
                    .entity(ApiError.overloaded("TOO_MANY_WAITING_REQUESTS"))
                    .build());
            return;
        }

        AsyncWaitHandle handle = new AsyncWaitHandle(async, waitLimiter);

        async.setTimeout(25, TimeUnit.SECONDS);
        async.setTimeoutHandler(ar -> handle.completeWithNoContent());

        String registrationId = waitRegistry.register(
                caseId,
                afterVersion,
                events -> handle.completeWithEntity(CaseChangeResponse.of(caseId, events))
        );

        async.register((CompletionCallback) throwable -> {
            waitRegistry.unregister(registrationId);
            handle.releasePermit();
        });

        List<CaseEventDto> afterRegister = changeStore.findAfter(caseId, afterVersion);
        if (!afterRegister.isEmpty()) {
            waitRegistry.unregister(registrationId);
            handle.completeWithEntity(CaseChangeResponse.of(caseId, afterRegister));
        }
    }
}
```

### 32.3 One-Shot Handle

```java
public final class AsyncWaitHandle {

    private final AsyncResponse async;
    private final WaitLimiter limiter;
    private final AtomicBoolean completed = new AtomicBoolean(false);
    private final AtomicBoolean permitReleased = new AtomicBoolean(false);

    public AsyncWaitHandle(AsyncResponse async, WaitLimiter limiter) {
        this.async = async;
        this.limiter = limiter;
    }

    public void completeWithEntity(Object entity) {
        if (completed.compareAndSet(false, true)) {
            releasePermit();
            async.resume(entity);
        }
    }

    public void completeWithError(Throwable throwable) {
        if (completed.compareAndSet(false, true)) {
            releasePermit();
            async.resume(throwable);
        }
    }

    public void completeWithNoContent() {
        if (completed.compareAndSet(false, true)) {
            releasePermit();
            async.resume(Response.noContent().build());
        }
    }

    public void releasePermit() {
        if (permitReleased.compareAndSet(false, true)) {
            limiter.release();
        }
    }
}
```

Kenapa pattern ini penting?

- `resume` hanya satu kali.
- Timeout/event/disconnect race terkendali.
- Permit tidak bocor.
- Registry dibersihkan.
- Response contract eksplisit.

---

## 33. Production Pattern: Async Job Submission Dengan `202 Accepted`

Kadang developer memakai AsyncResponse untuk operasi panjang seperti export laporan.

Lebih baik:

```java
@POST
@Path("/exports")
public Response submitExport(ExportRequest request, @Context UriInfo uriInfo) {
    String jobId = exportService.submit(request);

    URI location = uriInfo.getAbsolutePathBuilder()
            .path(jobId)
            .build();

    return Response.accepted(ExportAcceptedDto.of(jobId))
            .location(location)
            .build();
}

@GET
@Path("/exports/{jobId}")
public ExportJobStatusDto getExportStatus(@PathParam("jobId") String jobId) {
    return exportService.status(jobId);
}
```

Gunakan `AsyncResponse` hanya jika request memang menunggu completion cepat.

Untuk operasi yang harus survive restart, retry, audit, dan SLA, gunakan job model.

---

## 34. Observability Untuk Async Endpoint

Metric minimal:

```text
async.requests.started
async.requests.completed
async.requests.timed_out
async.requests.cancelled
async.requests.disconnected
async.requests.rejected
async.requests.in_flight
async.wait.duration
async.executor.queue.size
async.executor.active.threads
async.executor.rejected
```

Log minimal saat start:

```json
{
  "event": "async_wait_started",
  "correlationId": "...",
  "resource": "CaseChangeResource.waitForChanges",
  "caseId": "CASE-001",
  "afterVersion": 105,
  "timeoutMs": 25000
}
```

Log saat complete:

```json
{
  "event": "async_wait_completed",
  "correlationId": "...",
  "outcome": "EVENT|TIMEOUT|ERROR|DISCONNECT|REJECTED",
  "durationMs": 1832
}
```

Trace consideration:

- request span bisa selesai saat response selesai, bukan saat resource method return,
- async callback harus melanjutkan trace context,
- outbound calls dalam async task harus punya child span,
- timeout handler harus dicatat sebagai outcome.

Anti-pattern observability:

```text
resource method logs "finished" ketika request baru disuspend
```

Itu misleading. Bedakan:

```text
request accepted for async waiting
response completed
```

---

## 35. Failure Modes

### 35.1 Suspended request tidak pernah resumed

Gejala:

- client menggantung,
- server in-flight meningkat,
- memory naik.

Penyebab:

- tidak ada timeout,
- callback hilang,
- exception di callback tidak diresume,
- registry leak.

Mitigasi:

- selalu set timeout,
- completion callback cleanup,
- try/catch semua callback,
- metrics in-flight.

### 35.2 Double resume

Gejala:

- warning/error di log,
- response pertama terkirim, event kedua gagal,
- race timeout/event.

Mitigasi:

- one-shot guard `AtomicBoolean`,
- `async.isDone()` sebagai tambahan, bukan satu-satunya perlindungan.

### 35.3 Executor queue penuh

Gejala:

- latency naik,
- request timeout,
- heap naik.

Mitigasi:

- bounded queue,
- rejection response `503`,
- metric queue size,
- bulkhead per dependency/operation.

### 35.4 Client timeout lebih pendek dari server timeout

Gejala:

- server tetap kerja setelah client pergi,
- banyak broken pipe / connection reset,
- wasted work.

Mitigasi:

- align timeout,
- cancellation cleanup,
- dependency timeout lebih pendek.

### 35.5 Context hilang

Gejala:

- log tidak punya correlation ID,
- user/tenant kosong,
- audit salah,
- permission check gagal.

Mitigasi:

- capture context snapshot,
- context-aware executor,
- jangan bawa request-scoped proxy ke thread lain.

### 35.6 Transaction tidak aktif

Gejala:

- lazy loading failure,
- no active transaction,
- entity manager error.

Mitigasi:

- buka transaction di service method yang berjalan di async thread,
- jangan mengandalkan transaction resource method.

### 35.7 Memory leak dari waiter registry

Gejala:

- map/list listener terus bertambah,
- heap dump penuh callback/request references.

Mitigasi:

- unregister on completion,
- timeout cleanup,
- max waiters,
- scheduled sweep fallback.

---

## 36. Security and Audit Risks

Async endpoint bisa melemahkan audit jika tidak hati-hati.

Pertanyaan audit:

```text
Who initiated the async wait/job?
When was it accepted?
What input/cursor was used?
When did it complete?
Was it timeout, cancelled, disconnected, or fulfilled?
What identity/tenant/role context applied?
Was authorization checked at request time only or also at completion time?
```

Untuk regulatory/case-management system, simpan minimal:

- correlation ID,
- actor ID,
- tenant/agency,
- resource key,
- requested operation,
- input cursor/version,
- accepted timestamp,
- completion outcome,
- completion timestamp,
- error code jika gagal.

Penting:

> Jangan menjalankan async completion dengan authorization context yang sudah tidak valid jika response berisi data sensitif.

Contoh long-polling case update:

- user authorized saat request dimulai,
- role dicabut saat request masih suspended,
- event sensitif muncul,
- server resume data ke client.

Apakah perlu re-check authorization saat resume?

Untuk data sensitif, iya, pertimbangkan re-check sebelum mengirim hasil.

---

## 37. Testing Async Jersey Endpoint

Test minimal:

1. Immediate result path.
2. Suspended then event resume.
3. Timeout path.
4. Error callback path.
5. Double event only resumes once.
6. Client disconnect/cleanup best-effort.
7. Too many waiters returns 503.
8. Registry cleanup after completion.
9. Context propagation preserved.
10. Executor rejection handled.

Pseudo-test:

```java
@Test
void shouldReturnNoContentWhenLongPollTimeout() {
    Response response = target("/cases/CASE-001/changes")
            .queryParam("afterVersion", 105)
            .request()
            .get();

    assertEquals(204, response.getStatus());
}
```

Untuk test timeout, jangan set 25 detik di test. Buat configurable timeout:

```java
Duration asyncTimeout = config.asyncWaitTimeout();
```

Di test:

```text
asyncWaitTimeout = 100ms
```

Untuk race test, gunakan controlled scheduler/latch.

---

## 38. Code Review Checklist

Gunakan checklist ini setiap melihat endpoint dengan `@Suspended AsyncResponse`.

### Contract

- [ ] Apakah request memang harus menunggu HTTP response yang sama?
- [ ] Apakah `202 Accepted + job status` lebih tepat?
- [ ] Apakah timeout response didefinisikan?
- [ ] Apakah error contract konsisten dengan endpoint sync?

### Capacity

- [ ] Apakah jumlah suspended request dibatasi?
- [ ] Apakah executor bounded?
- [ ] Apakah rejection ditangani?
- [ ] Apakah timeout client/proxy/server/dependency selaras?

### Lifecycle

- [ ] Apakah semua path memanggil resume/cancel/timeout?
- [ ] Apakah ada completion cleanup?
- [ ] Apakah registry listener dihapus?
- [ ] Apakah double resume dicegah?

### Context

- [ ] Apakah correlation ID dipropagasi?
- [ ] Apakah identity/tenant dicapture sebagai value?
- [ ] Apakah request-scoped bean tidak dipakai lintas thread?
- [ ] Apakah transaction dimulai di thread yang benar?

### Observability

- [ ] Ada metric in-flight?
- [ ] Ada metric timeout/rejected/disconnected/error?
- [ ] Ada log start dan complete?
- [ ] Trace context tidak putus?

### Security

- [ ] Authorization checked?
- [ ] Perlu re-check saat completion?
- [ ] Response tidak bocor ke user/tenant salah?
- [ ] Audit outcome tercatat?

---

## 39. Common Anti-Patterns

### 39.1 Async untuk menutupi query lambat

```text
Query lambat 20 detik -> pakai AsyncResponse
```

Ini tidak memperbaiki query. Ia hanya memindahkan blocking dari request thread ke executor thread.

Perbaiki:

- query plan,
- index,
- pagination,
- materialized view,
- cache,
- job model.

### 39.2 Thread per request

```java
new Thread(() -> async.resume(work())).start();
```

Buruk untuk production.

### 39.3 Tidak ada timeout

Suspended request tanpa timeout hampir selalu bug.

### 39.4 Queue tidak terbatas

```java
Executors.newFixedThreadPool(10)
```

`newFixedThreadPool` memakai unbounded queue. Ini bisa membuat heap penuh saat load spike.

Gunakan `ThreadPoolExecutor` dengan bounded queue.

### 39.5 Menyimpan `AsyncResponse` di map tanpa cleanup

```java
map.put(id, async);
```

Tanpa unregister pada completion, ini leak.

### 39.6 Mengandalkan ThreadLocal context otomatis

ThreadLocal tidak otomatis pindah ke executor.

### 39.7 Long operation memakai AsyncResponse padahal butuh durability

Jika operasi harus survive restart, gunakan job/queue/state store.

---

## 40. Mini Exercises

### Exercise 1 — Classify Async Need

Untuk setiap endpoint berikut, tentukan apakah cocok sync, AsyncResponse, SSE, atau `202 Accepted`:

1. `GET /users/{id}` load profile dari DB.
2. `POST /reports/monthly-export` menghasilkan file besar 5 menit.
3. `GET /notifications?after=123` tunggu event maksimal 25 detik.
4. `GET /dashboard` fan-out ke 4 service, target response < 1 detik.
5. `GET /audit/export` streaming file CSV besar.

### Exercise 2 — Timeout Layering

Diberikan:

```text
client timeout: 15s
nginx timeout: 60s
Jersey async timeout: 45s
downstream timeout: 50s
```

Apa yang salah? Susun ulang timeout yang lebih sehat.

### Exercise 3 — Find the Leak

```java
@GET
@Path("/wait/{id}")
public void wait(@PathParam("id") String id, @Suspended AsyncResponse async) {
    waiters.put(id, async);
}
```

Sebutkan minimal 5 masalah production.

### Exercise 4 — Context Capture

Buat desain agar async task tetap punya:

- correlation ID,
- actor ID,
- tenant ID,
- request start time.

Tetapi tidak membawa request-scoped bean ke thread lain.

---

## 41. Summary Mental Model

Async server processing di Jersey harus dipahami sebagai:

```text
HTTP request lifecycle control mechanism
not general background job engine
not automatic performance fix
not automatic non-blocking runtime
```

`AsyncResponse` berguna ketika kamu perlu:

- suspend request,
- release initial request thread,
- resume response later,
- bridge callback/event/future ke HTTP response,
- mengontrol timeout/cancellation secara eksplisit.

Namun setiap async endpoint wajib punya:

```text
timeout
cleanup
bounded concurrency
executor/callback ownership
context propagation
error mapping
observability
security/audit semantics
```

Jika salah satu tidak ada, endpoint belum production-ready.

---

## 42. Hubungan Dengan Part Berikutnya

Part 15 membahas one-shot async response.

Part berikutnya akan membahas streaming:

> **Part 16 — Server-Sent Events and Streaming APIs with Jersey**

Perbedaan utamanya:

```text
AsyncResponse:
  suspend once, resume once

SSE/streaming:
  keep connection open, send many events/chunks
```

Banyak risiko Part 15 tetap berlaku di Part 16, tetapi dengan tingkat bahaya lebih tinggi karena koneksi bisa hidup lama dan mengirim banyak event.

---

## 43. Status Series

Progress saat ini:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — selesai
Part 14 — selesai
Part 15 — selesai
Part 16 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 14 — Resilient Outbound Calls: Timeout, Retry, Circuit Breaker, Bulkhead, Idempotency](./14-resilient-outbound-calls-timeout-retry-circuit-breaker-bulkhead-idempotency.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 16 — Server-Sent Events and Streaming APIs with Jersey](./16-server-sent-events-and-streaming-apis-with-jersey.md)

</div>