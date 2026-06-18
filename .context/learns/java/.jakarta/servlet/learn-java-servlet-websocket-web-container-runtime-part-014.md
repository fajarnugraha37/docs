# learn-java-servlet-websocket-web-container-runtime-part-014

# Part 014 — Async Servlet: Non-Blocking Request Lifecycle

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Bagian: `014 / 031`  
> Topik: Async Servlet, asynchronous request lifecycle, timeout race, context propagation, blocking-vs-nonblocking semantics, virtual threads, dan failure modelling.  
> Target: Java 8–25, Java EE `javax.servlet.*`, Jakarta EE `jakarta.servlet.*`.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **Async Servlet**: mekanisme Servlet API untuk melepaskan request dari thread container awal, lalu menyelesaikan response di waktu yang berbeda.

Ini bukan topik kosmetik. Banyak engineer menganggap async servlet berarti “otomatis lebih cepat” atau “otomatis non-blocking”. Itu salah. Async servlet adalah perubahan **lifecycle ownership**, bukan jaminan bahwa semua operasi menjadi non-blocking.

Setelah bagian ini, kamu harus bisa menjawab:

1. Apa perbedaan request synchronous, async servlet, non-blocking I/O, reactive, dan virtual thread?
2. Kapan `startAsync()` benar-benar berguna?
3. Kenapa async servlet bisa tetap blocking?
4. Apa state machine dari request async?
5. Apa hubungan async servlet dengan filter, dispatcher, listener, timeout, error handling, dan response commit?
6. Bagaimana menghindari bug seperti lupa `complete()`, response double-write, timeout race, MDC hilang, security context hilang, dan request object dipakai setelah lifecycle tidak valid?
7. Bagaimana async servlet memengaruhi capacity planning?

---

## 1. Mental Model Utama

Servlet synchronous klasik bekerja seperti ini:

```text
client
  -> container accepts request
  -> worker thread assigned
  -> filter chain
  -> servlet/service/controller
  -> response written
  -> worker thread released
```

Selama application code berjalan, worker thread container tertahan.

Async servlet mengubahnya menjadi:

```text
client
  -> container accepts request
  -> worker thread assigned
  -> filter chain
  -> servlet calls startAsync()
  -> original worker thread returns to container
  -> work continues elsewhere / later
  -> async code writes response or dispatches again
  -> asyncContext.complete()
```

Jadi inti async servlet adalah:

> Request belum selesai, tetapi thread container awal boleh dilepas.

Ini berbeda dari:

```text
"kode menjadi cepat"
"I/O menjadi non-blocking"
"semua problem concurrency hilang"
"bisa membuka request sebanyak mungkin tanpa limit"
```

Async servlet memindahkan tempat tunggu. Kalau sebelumnya request menunggu di worker thread container, sekarang request bisa menunggu di external callback, executor, event loop, scheduler, queue, atau dependency async.

---

## 2. Masalah yang Diselesaikan Async Servlet

Tanpa async servlet, model request biasanya seperti ini:

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
    Data data = slowRemoteCall(); // blocks 3 seconds
    resp.getWriter().write(toJson(data));
}
```

Jika ada 200 thread container dan semua request menunggu remote call 3 detik, maka 200 thread bisa habis hanya untuk menunggu.

Async servlet memungkinkan:

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
    AsyncContext async = req.startAsync();

    remoteClient.fetchAsync()
        .whenComplete((data, error) -> {
            try {
                HttpServletResponse response = (HttpServletResponse) async.getResponse();
                if (error != null) {
                    response.sendError(500);
                } else {
                    response.setContentType("application/json");
                    response.getWriter().write(toJson(data));
                }
            } catch (Exception writeError) {
                // log
            } finally {
                async.complete();
            }
        });
}
```

Di sini thread awal container tidak perlu tertahan selama remote call berjalan.

Namun perhatikan: kalau `fetchAsync()` ternyata hanya membungkus blocking call di executor kecil, kamu hanya memindahkan bottleneck dari container thread pool ke executor thread pool.

---

## 3. Async Servlet Bukan Non-Blocking I/O

Ini perbedaan paling penting.

| Konsep | Apa yang dilepas? | Apa yang tetap bisa blocking? | API utama |
|---|---:|---:|---|
| Synchronous servlet | Tidak ada | Semua application call | `doGet`, `doPost` |
| Async servlet | Container request thread awal | Executor, DB call, HTTP client, response write | `startAsync`, `AsyncContext` |
| Servlet non-blocking I/O | Read/write stream readiness | Business processing, external dependency | `ReadListener`, `WriteListener` |
| Reactive stack | Event-loop thread | Blocking call yang tidak dipindah | Reactor/Netty style |
| Virtual thread | Platform thread carrier saat blocking tertentu | CPU, pinning, downstream limits | Java 21+ virtual threads |

Async servlet berarti request bisa hidup lebih lama dari invocation awal servlet.

Non-blocking I/O berarti read/write body memakai readiness callback (`isReady`, `ReadListener`, `WriteListener`) sehingga thread tidak perlu blocking saat socket belum siap.

Keduanya bisa dipakai bersama, tapi bukan hal yang sama.

---

## 4. API Inti Async Servlet

API utama:

```java
AsyncContext async = request.startAsync();
```

atau:

```java
AsyncContext async = request.startAsync(request, response);
```

Lalu operasi penting:

```java
async.setTimeout(30_000);
async.addListener(new AsyncListener() { ... });
async.start(() -> { ... });
async.dispatch();
async.dispatch("/path");
async.complete();
```

Secara konseptual:

| API | Fungsi |
|---|---|
| `startAsync()` | Memulai mode async untuk request saat ini |
| `getAsyncContext()` | Mengambil async context aktif dari request |
| `isAsyncStarted()` | Mengecek apakah request sedang async |
| `isAsyncSupported()` | Mengecek apakah chain mendukung async |
| `setTimeout()` | Mengatur timeout async |
| `addListener()` | Mendaftarkan callback lifecycle async |
| `start(Runnable)` | Menjalankan task via container-managed thread/executor |
| `dispatch()` | Mengirim request kembali ke container pipeline |
| `complete()` | Menandai response selesai |

---

## 5. `asyncSupported=true`

Agar async servlet bekerja, servlet/filter terkait harus mendukung async.

Annotation servlet:

```java
@WebServlet(
    urlPatterns = "/report",
    asyncSupported = true
)
public class ReportServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        AsyncContext async = req.startAsync();
        // ...
    }
}
```

`web.xml`:

```xml
<servlet>
    <servlet-name>ReportServlet</servlet-name>
    <servlet-class>com.example.ReportServlet</servlet-class>
    <async-supported>true</async-supported>
</servlet>
```

Filter juga penting:

```java
@WebFilter(
    urlPatterns = "/*",
    asyncSupported = true
)
public class CorrelationFilter implements Filter {
    // ...
}
```

Jika ada filter dalam chain yang tidak mendukung async, `startAsync()` bisa gagal.

Mental model:

```text
Async support is a property of the entire request processing chain,
not only the final servlet.
```

---

## 6. Lifecycle State Machine

Synchronous request:

```text
NEW_REQUEST
  -> FILTER_CHAIN
  -> SERVLET_SERVICE
  -> RESPONSE_WRITE
  -> COMMITTED_OR_CLOSED
  -> DONE
```

Async request:

```text
NEW_REQUEST
  -> FILTER_CHAIN
  -> SERVLET_SERVICE
  -> startAsync()
  -> INITIAL_THREAD_RETURNS
  -> ASYNC_WAITING
       -> ASYNC_WORK_COMPLETES
       -> WRITE_RESPONSE
       -> complete()
  -> DONE
```

Dengan timeout/error:

```text
ASYNC_WAITING
  -> TIMEOUT
       -> onTimeout
       -> app may write timeout response
       -> complete OR dispatch error

ASYNC_WAITING
  -> ERROR
       -> onError
       -> error dispatch OR complete
```

Dengan dispatch:

```text
ASYNC_WAITING
  -> dispatch("/result")
  -> container re-enters filter/servlet pipeline with DispatcherType.ASYNC
  -> target writes response
  -> complete implicitly/explicitly depending flow
```

Poin penting:

> Async request bukan satu call stack lurus. Ia adalah lifecycle multi-phase.

Karena itu logging, transaction, security, request attributes, MDC, tracing, exception handling, dan filter behavior harus dipikirkan ulang.

---

## 7. Contoh Minimal Async Servlet

```java
import jakarta.servlet.AsyncContext;
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

@WebServlet(urlPatterns = "/async/hello", asyncSupported = true)
public class AsyncHelloServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        AsyncContext async = req.startAsync();
        async.setTimeout(10_000);

        async.start(() -> {
            try {
                Thread.sleep(500); // demo only; not ideal for production

                HttpServletResponse response =
                        (HttpServletResponse) async.getResponse();

                response.setStatus(HttpServletResponse.SC_OK);
                response.setContentType("text/plain;charset=UTF-8");
                response.getWriter().write("Hello from async servlet");
            } catch (Exception e) {
                try {
                    HttpServletResponse response =
                            (HttpServletResponse) async.getResponse();
                    response.sendError(500, "Async failure");
                } catch (IOException ignored) {
                    // response may already be unavailable/committed
                }
            } finally {
                async.complete();
            }
        });
    }
}
```

Ini contoh sederhana, tapi memiliki beberapa caveat:

1. `Thread.sleep()` hanya simulasi.
2. `async.start()` memakai mekanisme container, bukan selalu executor yang kamu kontrol langsung.
3. `complete()` wajib dipanggil pada jalur sukses maupun gagal.
4. Write response setelah timeout bisa gagal.
5. Exception di thread async tidak otomatis ditangani seperti exception di `doGet` synchronous.

---

## 8. `async.start()` vs Executor Sendiri

Ada dua pola umum.

### 8.1 Container-managed async task

```java
async.start(() -> {
    // async work
});
```

Kelebihan:

- sederhana,
- container tahu task tersebut bagian dari async request,
- cocok untuk demo atau task kecil.

Kekurangan:

- kontrol tuning terbatas,
- bisa bercampur dengan resource container,
- tidak selalu ideal untuk workload berat.

### 8.2 Application-managed executor

```java
ExecutorService executor = ...;

protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
    AsyncContext async = req.startAsync();

    executor.submit(() -> {
        try {
            // work
        } finally {
            async.complete();
        }
    });
}
```

Kelebihan:

- bisa diberi bounded queue,
- bisa diberi rejection policy,
- bisa dipisahkan per workload,
- lebih mudah diobservasi.

Kekurangan:

- harus shutdown saat aplikasi berhenti,
- risiko thread leak saat redeploy,
- harus handle context propagation sendiri,
- harus handle rejection dengan benar.

Rule of thumb:

```text
Use async servlet to release container request threads.
Use a bounded executor to protect the application from unlimited work.
```

---

## 9. Pola Executor yang Aman

Executor async servlet jangan unlimited.

Contoh buruk:

```java
Executors.newCachedThreadPool();
```

Masalah:

- thread bisa tumbuh tak terkendali,
- overload berubah menjadi memory/thread exhaustion,
- failure menjadi lebih lambat dan lebih mahal.

Contoh lebih aman:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
        16,
        64,
        60, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(500),
        new ThreadFactory() {
            private final AtomicInteger seq = new AtomicInteger();

            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r);
                t.setName("report-async-" + seq.incrementAndGet());
                t.setDaemon(false);
                return t;
            }
        },
        new ThreadPoolExecutor.AbortPolicy()
);
```

Jika executor penuh:

```java
try {
    executor.execute(task);
} catch (RejectedExecutionException rejected) {
    resp.setStatus(503);
    resp.setContentType("application/json");
    resp.getWriter().write("{\"error\":\"server_busy\"}");
}
```

Namun jika `startAsync()` sudah dipanggil sebelum submit, failure harus diselesaikan via async response:

```java
AsyncContext async = req.startAsync();

try {
    executor.execute(() -> process(async));
} catch (RejectedExecutionException rejected) {
    try {
        HttpServletResponse response = (HttpServletResponse) async.getResponse();
        response.setStatus(503);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"server_busy\"}");
    } catch (IOException ignored) {
        // log
    } finally {
        async.complete();
    }
}
```

---

## 10. Timeout Semantics

Async timeout bukan sekadar “exception setelah sekian detik”. Timeout adalah event lifecycle.

```java
async.setTimeout(30_000);
```

Listener:

```java
async.addListener(new AsyncListener() {
    @Override
    public void onComplete(AsyncEvent event) {
        // cleanup / metrics
    }

    @Override
    public void onTimeout(AsyncEvent event) throws IOException {
        HttpServletResponse response =
                (HttpServletResponse) event.getAsyncContext().getResponse();
        response.setStatus(503);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"async_timeout\"}");
        event.getAsyncContext().complete();
    }

    @Override
    public void onError(AsyncEvent event) {
        // log event.getThrowable()
    }

    @Override
    public void onStartAsync(AsyncEvent event) {
        // called if async cycle restarts
    }
});
```

Timeout problem yang sering terjadi:

```text
T0 request starts async
T1 async worker calls remote service
T30 container timeout fires, writes 503, complete()
T31 remote service returns
T31 worker tries to write 200 OK
```

Ini disebut timeout race.

Solusi: pakai completion guard.

```java
final AtomicBoolean done = new AtomicBoolean(false);

async.addListener(new AsyncListener() {
    @Override
    public void onTimeout(AsyncEvent event) throws IOException {
        if (done.compareAndSet(false, true)) {
            HttpServletResponse response =
                    (HttpServletResponse) event.getAsyncContext().getResponse();
            response.setStatus(503);
            response.getWriter().write("timeout");
            event.getAsyncContext().complete();
        }
    }

    @Override public void onComplete(AsyncEvent event) {}
    @Override public void onError(AsyncEvent event) {}
    @Override public void onStartAsync(AsyncEvent event) {}
});

executor.execute(() -> {
    try {
        String result = slowOperation();
        if (done.compareAndSet(false, true)) {
            HttpServletResponse response =
                    (HttpServletResponse) async.getResponse();
            response.getWriter().write(result);
            async.complete();
        }
    } catch (Exception e) {
        if (done.compareAndSet(false, true)) {
            try {
                ((HttpServletResponse) async.getResponse()).sendError(500);
            } catch (IOException ignored) {}
            async.complete();
        }
    }
});
```

Mental model:

```text
In async servlet, completion must be idempotent.
```

---

## 11. `complete()` Semantics

`complete()` memberitahu container:

```text
Application is done producing response for this async request.
```

Setelah `complete()`:

- jangan tulis response lagi,
- jangan dispatch lagi,
- jangan pakai request/response object untuk logic lanjutan,
- jangan menganggap listener belum dipanggil,
- cleanup harus sudah jelas.

Bug umum:

```java
async.complete();
response.getWriter().write("late write"); // wrong
```

atau:

```java
try {
    // work
    async.complete();
} catch (Exception e) {
    async.complete(); // may double complete depending path
}
```

Gunakan guard jika banyak jalur completion:

```java
private static void completeOnce(AsyncContext async, AtomicBoolean done) {
    if (done.compareAndSet(false, true)) {
        async.complete();
    }
}
```

---

## 12. Async Dispatch

Kadang async worker tidak langsung menulis response, tetapi mengembalikan request ke pipeline servlet.

```java
AsyncContext async = req.startAsync();
async.start(() -> {
    async.getRequest().setAttribute("result", "ready");
    async.dispatch("/render-result");
});
```

Target:

```java
@WebServlet("/render-result")
public class RenderResultServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {
        String result = (String) req.getAttribute("result");
        resp.getWriter().write(result);
    }
}
```

Dispatcher type menjadi:

```java
DispatcherType.ASYNC
```

Filter yang ingin ikut saat async dispatch harus mendaftarkan dispatcher type `ASYNC`.

```java
@WebFilter(
    urlPatterns = "/*",
    dispatcherTypes = {
        DispatcherType.REQUEST,
        DispatcherType.ASYNC,
        DispatcherType.ERROR
    },
    asyncSupported = true
)
public class ObservabilityFilter implements Filter {
    // ...
}
```

Poin penting:

```text
Async dispatch re-enters container pipeline.
Direct async write bypasses normal servlet target pipeline after the initial return.
```

---

## 13. Filter dan Async Servlet

Filter synchronous biasanya menganggap:

```text
before chain.doFilter()
after chain.doFilter()
request done
```

Dalam async servlet, asumsi ini salah.

```java
public void doFilter(ServletRequest req, ServletResponse resp, FilterChain chain)
        throws IOException, ServletException {

    long start = System.nanoTime();
    chain.doFilter(req, resp);
    long duration = System.nanoTime() - start;

    log.info("duration={}", duration); // may only measure initial phase
}
```

Jika servlet memanggil `startAsync()`, `chain.doFilter()` bisa return sebelum response selesai.

Pola lebih benar:

```java
public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException {

    long start = System.nanoTime();

    try {
        chain.doFilter(request, response);
    } finally {
        if (request.isAsyncStarted()) {
            request.getAsyncContext().addListener(new AsyncListener() {
                @Override
                public void onComplete(AsyncEvent event) {
                    long duration = System.nanoTime() - start;
                    // log actual async lifecycle duration
                }

                @Override public void onTimeout(AsyncEvent event) {}
                @Override public void onError(AsyncEvent event) {}
                @Override public void onStartAsync(AsyncEvent event) {}
            });
        } else {
            long duration = System.nanoTime() - start;
            // log sync duration
        }
    }
}
```

Filter async-aware harus menjawab:

1. Apakah filter support async?
2. Dispatcher type apa yang diproses?
3. Apakah cleanup dilakukan terlalu awal?
4. Apakah logging menghitung response final atau hanya initial dispatch?
5. Apakah `ThreadLocal` dibersihkan tanpa memutus context yang masih dibutuhkan async worker?

---

## 14. Request Attributes dalam Async Flow

Request attributes sering dipakai untuk membawa data antar filter/servlet/dispatch.

```java
req.setAttribute("correlationId", correlationId);
```

Dalam async flow, request object masih menjadi carrier selama lifecycle async, tapi hati-hati:

- attribute mutable bisa diubah oleh phase berbeda,
- parallel async task bisa race,
- after `complete()` attribute tidak boleh dianggap valid,
- data yang perlu hidup lebih lama sebaiknya dicopy ke immutable context object.

Contoh lebih aman:

```java
record RequestContext(
        String correlationId,
        String userId,
        Instant startedAt
) {}

RequestContext context = new RequestContext(
        correlationId,
        userId,
        Instant.now()
);

AsyncContext async = req.startAsync();
executor.execute(() -> process(async, context));
```

Jangan bergantung pada request object untuk semua hal.

---

## 15. MDC dan Logging Context

MDC biasanya berbasis `ThreadLocal`. Dalam synchronous servlet:

```text
request thread sets MDC
controller logs
filter clears MDC
```

Dalam async servlet:

```text
thread A sets MDC
thread A starts async
thread A returns and clears MDC
thread B continues async work
thread B has no MDC unless propagated
```

Contoh capture/restore:

```java
Map<String, String> capturedMdc = MDC.getCopyOfContextMap();

executor.execute(() -> {
    Map<String, String> previous = MDC.getCopyOfContextMap();
    try {
        if (capturedMdc != null) {
            MDC.setContextMap(capturedMdc);
        } else {
            MDC.clear();
        }

        // async work with correlation id
    } finally {
        if (previous != null) {
            MDC.setContextMap(previous);
        } else {
            MDC.clear();
        }
    }
});
```

Rule:

```text
Anything ThreadLocal-based must be explicitly propagated or intentionally dropped.
```

Ini berlaku untuk:

- MDC,
- security context,
- locale,
- tenant context,
- trace/span context,
- transaction context,
- request-scoped context,
- diagnostic flags.

---

## 16. Security Context Caveat

Jangan menganggap security context otomatis tersedia di async worker.

Di level Servlet, request memiliki:

```java
req.getUserPrincipal();
req.isUserInRole("ADMIN");
```

Tetapi framework security sering menyimpan context di `ThreadLocal`.

Dalam async worker, ini bisa hilang.

Pola aman:

```java
Principal principal = req.getUserPrincipal();
String userId = principal != null ? principal.getName() : null;
Set<String> roles = extractRoles(req);

RequestContext context = new RequestContext(correlationId, userId, roles);
```

Lalu authorization untuk async work jangan bergantung pada `ThreadLocal` yang mungkin kosong.

---

## 17. Transaction Context Caveat

Async servlet tidak boleh sembarang membawa transaksi request synchronous ke thread lain.

Contoh buruk:

```java
@Transactional
protected void doGet(...) {
    AsyncContext async = req.startAsync();
    executor.execute(() -> repository.save(...)); // transaction context unclear/wrong
}
```

Masalah:

- transaction biasanya thread-bound,
- EntityManager/session bisa tidak valid di thread lain,
- request selesai phase awal tapi transaction masih dianggap di call stack awal,
- rollback semantics kacau.

Pola lebih benar:

```text
Async task opens its own transaction boundary explicitly.
```

Contoh konseptual:

```java
executor.execute(() -> {
    transactionTemplate.execute(status -> {
        service.process(command);
        return null;
    });
});
```

Untuk seri ini kita tidak mengulang JPA/transaction detail. Yang penting: async servlet memotong asumsi thread-bound transaction.

---

## 18. Async Servlet dengan `CompletableFuture`

Pola umum:

```java
@WebServlet(urlPatterns = "/async/user", asyncSupported = true)
public class UserServlet extends HttpServlet {
    private final UserClient userClient = new UserClient();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        AsyncContext async = req.startAsync();
        async.setTimeout(5_000);

        String userId = req.getParameter("id");

        CompletableFuture<UserDto> future = userClient.fetchUser(userId);

        future.whenComplete((user, error) -> {
            try {
                HttpServletResponse response =
                        (HttpServletResponse) async.getResponse();

                if (error != null) {
                    response.setStatus(502);
                    response.setContentType("application/json");
                    response.getWriter().write("{\"error\":\"upstream_failed\"}");
                    return;
                }

                response.setStatus(200);
                response.setContentType("application/json");
                response.getWriter().write(toJson(user));
            } catch (IOException writeError) {
                // log write failure
            } finally {
                async.complete();
            }
        });
    }
}
```

Namun `CompletableFuture` bisa menipu.

```java
CompletableFuture.supplyAsync(() -> blockingCall())
```

Ini tetap blocking, hanya dipindahkan ke executor.

Pertanyaan desain yang wajib:

1. Executor apa yang dipakai?
2. Berapa queue limit-nya?
3. Apa rejection policy-nya?
4. Apakah downstream punya timeout lebih pendek dari async timeout?
5. Apakah cancellation terjadi saat async timeout?
6. Apakah response completion idempotent?

---

## 19. Cancellation dan Timeout Propagation

Jika async request timeout, idealnya dependency call juga dibatalkan.

Contoh konseptual:

```java
CompletableFuture<Result> future = service.callAsync(command);

async.addListener(new AsyncListener() {
    @Override
    public void onTimeout(AsyncEvent event) throws IOException {
        future.cancel(true);
        HttpServletResponse response =
                (HttpServletResponse) event.getAsyncContext().getResponse();
        response.setStatus(504);
        response.getWriter().write("timeout");
        event.getAsyncContext().complete();
    }

    @Override public void onComplete(AsyncEvent event) {}
    @Override public void onError(AsyncEvent event) {}
    @Override public void onStartAsync(AsyncEvent event) {}
});
```

Tapi cancellation tidak selalu efektif:

- HTTP client harus mendukung cancel,
- JDBC blocking query belum tentu langsung berhenti,
- thread interruption sering diabaikan library,
- remote service tetap memproses request.

Maka desain harus punya timeout di semua layer:

```text
client timeout
  >= load balancer timeout
    >= reverse proxy timeout
      >= servlet async timeout
        >= outbound HTTP client timeout
          >= DB query timeout
```

Biasanya inner dependency timeout harus lebih pendek dari outer request timeout agar aplikasi masih punya waktu menulis response error yang rapi.

---

## 20. Async Servlet dan Response Commit

Dalam async flow, response commit tetap berlaku.

Jika response sudah committed:

```java
response.getWriter().write("partial");
response.flushBuffer();
response.sendError(500); // too late
```

Pada async flow, masalah ini lebih sering karena error bisa terjadi setelah sebagian response ditulis.

Pola aman untuk JSON response kecil:

```text
Compute first, write once at the end.
```

Pola streaming berbeda:

```text
Commit early, then accept that later failure cannot become normal JSON error.
```

Untuk streaming async, failure harus direpresentasikan sebagai:

- stream closed,
- event error frame,
- partial response semantics,
- log + metric,
- client retry.

---

## 21. Async Servlet vs Long Polling

Async servlet sangat cocok untuk long polling.

Synchronous long polling buruk:

```text
1000 waiting clients = 1000 blocked container threads
```

Async long polling:

```text
1000 waiting clients = 1000 open requests,
but not necessarily 1000 blocked container worker threads
```

Contoh konseptual:

```java
@WebServlet(urlPatterns = "/notifications/poll", asyncSupported = true)
public class NotificationPollServlet extends HttpServlet {
    private final NotificationBroker broker = NotificationBroker.getInstance();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        String userId = req.getUserPrincipal().getName();
        AsyncContext async = req.startAsync();
        async.setTimeout(25_000);

        broker.register(userId, async);
    }
}
```

Saat event datang:

```java
void notify(String userId, Notification notification) {
    AsyncContext async = waiting.remove(userId);
    if (async == null) return;

    try {
        HttpServletResponse response =
                (HttpServletResponse) async.getResponse();
        response.setContentType("application/json");
        response.getWriter().write(toJson(notification));
    } catch (IOException e) {
        // client gone
    } finally {
        async.complete();
    }
}
```

Wajib ada cleanup saat timeout:

```java
async.addListener(new AsyncListener() {
    @Override
    public void onTimeout(AsyncEvent event) {
        broker.remove(userId, event.getAsyncContext());
        event.getAsyncContext().complete();
    }

    @Override public void onComplete(AsyncEvent event) {
        broker.remove(userId, event.getAsyncContext());
    }

    @Override public void onError(AsyncEvent event) {
        broker.remove(userId, event.getAsyncContext());
    }

    @Override public void onStartAsync(AsyncEvent event) {}
});
```

Jika tidak, memory leak.

---

## 22. Async Servlet vs Server-Sent Events

SSE sering memakai async servlet karena koneksi dibiarkan terbuka lama.

Simplified SSE:

```java
@WebServlet(urlPatterns = "/events", asyncSupported = true)
public class EventStreamServlet extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {

        resp.setStatus(200);
        resp.setContentType("text/event-stream;charset=UTF-8");
        resp.setHeader("Cache-Control", "no-cache");

        AsyncContext async = req.startAsync();
        async.setTimeout(0); // container-specific meaning: often no timeout; be careful

        EventRegistry.add(async);
    }
}
```

Namun SSE detail akan dibahas di Part 026. Untuk sekarang, poinnya:

```text
Async servlet is a lifecycle mechanism that enables long-lived HTTP responses.
```

---

## 23. Async Servlet dan Virtual Threads

Java 21 memperkenalkan virtual threads sebagai fitur final. Dalam Java 21–25, virtual threads mengubah trade-off untuk blocking server code.

Dengan platform thread klasik:

```text
blocking request = expensive thread occupied
```

Dengan virtual thread:

```text
blocking request = cheap virtual thread parked, carrier can run others
```

Maka pertanyaan muncul:

> Apakah async servlet masih relevan setelah virtual threads?

Jawabannya: masih, tapi use case-nya berubah.

Virtual threads membantu jika:

- kode dominan blocking I/O,
- library blocking kompatibel dengan virtual threads,
- kamu ingin mempertahankan programming model synchronous,
- bottleneck sebelumnya adalah jumlah platform thread.

Async servlet tetap relevan jika:

- request harus hidup sebagai pending lifecycle tanpa call stack aktif,
- long polling/SSE,
- callback dari event broker,
- integration dengan non-blocking client API,
- explicit async dispatch diperlukan,
- framework/container menggunakan async internally,
- perlu release container thread di container yang belum memakai virtual thread per request.

Virtual threads tidak menyelesaikan:

- DB connection pool habis,
- downstream rate limit,
- CPU saturation,
- lock contention,
- huge response buffering,
- memory per request,
- proxy timeout,
- client disconnect,
- duplicate completion,
- response commit semantics.

Mental model:

```text
Virtual threads make blocking cheaper.
Async servlet changes the request lifecycle.
They solve different layers of the problem.
```

---

## 24. Async Servlet dan Capacity Planning

Misal synchronous:

```text
max container threads = 200
avg service time = 2s
max rough throughput = 200 / 2s = 100 req/s
```

Async bisa melepas container threads, tetapi bukan berarti kapasitas infinite.

Bottleneck pindah ke:

- async executor threads,
- async queue size,
- DB connection pool,
- outbound HTTP connection pool,
- remote service concurrency limit,
- heap memory untuk pending request,
- socket/file descriptors,
- reverse proxy connection limit,
- timeout backlog,
- response write bandwidth.

Async long-polling contoh:

```text
20_000 pending requests
1 KB state per request = ~20 MB app state only
plus request/response/container objects
plus socket/proxy/LB resources
```

Capacity planning harus melihat:

```text
active executing work
+ pending async requests
+ queued tasks
+ downstream concurrency
+ memory per request
+ socket resources
+ timeout policy
```

Async servlet meningkatkan concurrency handling, bukan menghapus cost concurrency.

---

## 25. Failure Model Async Servlet

### 25.1 Lupa `complete()`

Gejala:

- request menggantung,
- client timeout,
- active async count naik,
- memory leak,
- thread dump tidak jelas karena thread awal sudah kembali.

Pencegahan:

```java
try {
    // work
} finally {
    async.complete();
}
```

Tapi dengan banyak jalur, gunakan `AtomicBoolean` guard.

---

### 25.2 Double completion

Gejala:

- `IllegalStateException`,
- log noise,
- response already committed,
- random behavior tergantung race.

Pencegahan:

```java
if (done.compareAndSet(false, true)) {
    async.complete();
}
```

---

### 25.3 Timeout race

Gejala:

- client menerima 503 tapi worker tetap mencoba write 200,
- log broken pipe,
- duplicate metrics,
- late write exception.

Pencegahan:

- completion guard,
- cancel future/dependency,
- dependency timeout lebih pendek dari async timeout.

---

### 25.4 Context hilang

Gejala:

- log tanpa correlation ID,
- user null,
- tenant null,
- trace putus,
- audit salah user.

Pencegahan:

- capture immutable request context,
- propagate MDC/security/trace secara eksplisit,
- jangan bergantung pada ThreadLocal implicit.

---

### 25.5 Executor overload

Gejala:

- request async diterima tapi task antre terlalu lama,
- latency tail memburuk,
- heap naik,
- timeout massal,
- cascading failure.

Pencegahan:

- bounded executor,
- rejection dengan 503,
- queue timeout,
- bulkhead per dependency/workload,
- admission control sebelum `startAsync()` jika memungkinkan.

---

### 25.6 Client disconnect

Gejala:

- `IOException: Broken pipe`,
- `Connection reset by peer`,
- response write gagal,
- async work tetap jalan walau client pergi.

Pencegahan:

- handle IOException sebagai expected operational event,
- cancel work jika bisa,
- record metric client abort,
- jangan log semua sebagai ERROR noisy.

---

### 25.7 Async registry leak

Umum pada long polling/SSE.

Gejala:

- map pending connection terus naik,
- heap leak,
- user dianggap online padahal sudah pergi.

Pencegahan:

- remove on complete,
- remove on timeout,
- remove on error,
- remove on application shutdown,
- use weak/guarded lifecycle if needed.

---

## 26. Production-Grade Async Pattern

Berikut skeleton yang lebih realistis.

```java
@WebServlet(urlPatterns = "/api/report/status", asyncSupported = true)
public class ReportStatusServlet extends HttpServlet {

    private final ExecutorService executor = ReportExecutors.statusExecutor();
    private final ReportService reportService = new ReportService();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {

        String reportId = req.getParameter("reportId");
        if (reportId == null || reportId.isBlank()) {
            resp.setStatus(400);
            resp.setContentType("application/json");
            resp.getWriter().write("{\"error\":\"missing_report_id\"}");
            return;
        }

        String correlationId = (String) req.getAttribute("correlationId");
        String userId = req.getUserPrincipal() != null
                ? req.getUserPrincipal().getName()
                : "anonymous";

        RequestContext context = new RequestContext(correlationId, userId, reportId);

        AsyncContext async = req.startAsync();
        async.setTimeout(8_000);

        AtomicBoolean done = new AtomicBoolean(false);

        async.addListener(new AsyncListener() {
            @Override
            public void onTimeout(AsyncEvent event) throws IOException {
                if (done.compareAndSet(false, true)) {
                    writeJson(event.getAsyncContext(), 504,
                            "{\"error\":\"report_status_timeout\"}");
                    event.getAsyncContext().complete();
                }
            }

            @Override
            public void onError(AsyncEvent event) {
                if (done.compareAndSet(false, true)) {
                    try {
                        writeJson(event.getAsyncContext(), 500,
                                "{\"error\":\"async_error\"}");
                    } catch (IOException ignored) {
                        // response may be gone
                    } finally {
                        event.getAsyncContext().complete();
                    }
                }
            }

            @Override
            public void onComplete(AsyncEvent event) {
                // metrics cleanup
            }

            @Override
            public void onStartAsync(AsyncEvent event) {
                // usually no-op unless redispatching/restarting async cycle
            }
        });

        try {
            executor.execute(() -> process(async, context, done));
        } catch (RejectedExecutionException rejected) {
            if (done.compareAndSet(false, true)) {
                writeJson(async, 503, "{\"error\":\"server_busy\"}");
                async.complete();
            }
        }
    }

    private void process(AsyncContext async, RequestContext context, AtomicBoolean done) {
        try {
            ReportStatus status = reportService.getStatus(
                    context.userId(),
                    context.reportId()
            );

            if (done.compareAndSet(false, true)) {
                writeJson(async, 200, toJson(status));
                async.complete();
            }
        } catch (ReportNotFoundException e) {
            completeWithJson(async, done, 404, "{\"error\":\"not_found\"}");
        } catch (Exception e) {
            completeWithJson(async, done, 500, "{\"error\":\"internal_error\"}");
        }
    }

    private static void completeWithJson(
            AsyncContext async,
            AtomicBoolean done,
            int status,
            String json
    ) {
        if (done.compareAndSet(false, true)) {
            try {
                writeJson(async, status, json);
            } catch (IOException ignored) {
                // client may be gone
            } finally {
                async.complete();
            }
        }
    }

    private static void writeJson(AsyncContext async, int status, String json)
            throws IOException {
        HttpServletResponse response =
                (HttpServletResponse) async.getResponse();
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(json);
    }

    private static String toJson(ReportStatus status) {
        return "{\"status\":\"" + status.value() + "\"}";
    }

    record RequestContext(String correlationId, String userId, String reportId) {}
    record ReportStatus(String value) {}

    static class ReportNotFoundException extends RuntimeException {}

    static class ReportService {
        ReportStatus getStatus(String userId, String reportId) {
            return new ReportStatus("PROCESSING");
        }
    }
}
```

Catatan:

- Ini bukan style framework modern terbaik, tetapi bagus untuk memahami boundary Servlet API.
- Di aplikasi nyata, JSON serialization jangan manual string concat.
- Executor harus dibuat/dihancurkan pada lifecycle aplikasi dengan benar, bukan static sembarangan.
- Response completion harus idempotent.
- Request context dicopy sebelum pindah thread.

---

## 27. Async Servlet dengan Java 8 sampai 25

### Java 8

Async servlet umum dikombinasikan dengan:

- `ExecutorService`,
- `CompletableFuture`,
- callback HTTP client,
- servlet container klasik.

Risiko utama:

- `ThreadLocal` propagation manual,
- executor leak,
- blocking call pindah tempat saja.

### Java 11

Java 11 membawa `java.net.http.HttpClient` yang mendukung async dengan `sendAsync`.

Contoh konseptual:

```java
HttpClient client = HttpClient.newHttpClient();

CompletableFuture<HttpResponse<String>> future = client.sendAsync(
        request,
        HttpResponse.BodyHandlers.ofString()
);
```

Ini lebih cocok dengan async servlet dibanding blocking HTTP client, tetapi tetap harus ada timeout/cancellation/error handling.

### Java 17

Java 17 banyak dipakai sebagai baseline enterprise modern. Async servlet pattern masih sama, tetapi library/framework lebih matang.

### Java 21

Virtual threads membuat synchronous blocking code lebih feasible untuk banyak case. Tetapi async servlet tetap relevan untuk lifecycle long-lived dan integration callback.

### Java 25

Java 25 melanjutkan era modern Java runtime. Untuk Servlet engineer, implikasinya bukan “pakai semua fitur baru”, melainkan memahami bahwa runtime modern memberi lebih banyak pilihan concurrency model:

```text
classic platform thread
async servlet lifecycle
non-blocking servlet I/O
virtual thread per task/request
reactive/event-loop integration
```

Top-tier engineer memilih model berdasarkan bottleneck dan failure mode, bukan hype.

---

## 28. Kapan Menggunakan Async Servlet?

Gunakan async servlet ketika:

1. Request harus menunggu event eksternal tetapi tidak perlu menahan worker thread container.
2. Long polling.
3. SSE atau streaming response berbasis HTTP.
4. Integrasi dengan API async/callback.
5. Framework membutuhkan async dispatch.
6. Perlu memisahkan initial request acceptance dari completion.
7. Ingin admission control dan queue management eksplisit.

Jangan gunakan async servlet hanya karena:

1. “Async pasti lebih cepat”.
2. Ingin menyembunyikan query DB lambat.
3. Thread pool container habis karena downstream buruk tetapi downstream limit tidak diperbaiki.
4. Ingin menjalankan CPU-heavy task di background dalam request lifecycle.
5. Tidak punya observability untuk pending async request.
6. Tidak siap menangani timeout race.

---

## 29. Async Servlet vs Background Job

Async servlet masih bagian dari request lifecycle.

Jika pekerjaan:

- butuh menit/jam,
- harus survive restart,
- butuh retry durable,
- tidak harus selesai dalam HTTP response,
- bisa diproses oleh worker terpisah,

maka async servlet bukan solusi utama. Gunakan job queue / message broker / batch / workflow engine.

Pola lebih benar:

```text
POST /reports
  -> validate
  -> persist job = SUBMITTED
  -> enqueue job
  -> return 202 Accepted + jobId

GET /reports/{jobId}
  -> return status

SSE/WebSocket optional
  -> notify progress
```

Async servlet cocok untuk response yang masih wajar dalam batas request timeout, bukan untuk mengganti background processing durable.

---

## 30. Observability Checklist

Untuk async servlet, metric minimal:

| Metric | Kenapa penting |
|---|---|
| active async requests | mendeteksi leak/backlog |
| async started count | volume penggunaan async |
| async completed count | completion rate |
| async timeout count | timeout pressure |
| async error count | error lifecycle |
| executor active threads | worker saturation |
| executor queue size | early overload signal |
| executor rejected tasks | admission failure |
| response write failures | client disconnect/proxy issue |
| duration initial dispatch | waktu sampai `startAsync` |
| duration total async lifecycle | user-visible latency |
| downstream timeout count | root cause timeout |

Logging minimal:

```text
correlation_id
request_uri
method
async_started
async_dispatch_count
async_timeout_ms
final_status
completion_source = success | timeout | error | rejected | client_abort
executor_queue_size
user/tenant safe identifier
```

Thread dump analysis:

- cari executor async custom,
- cari worker container blocked,
- cari DB/HTTP client threads,
- cari lock contention,
- cari queue consumer stuck,
- jangan hanya melihat container worker pool.

---

## 31. Anti-Pattern Catalog

### 31.1 Async tanpa timeout

```java
AsyncContext async = req.startAsync();
// no timeout, no listener
```

Bahaya: request bisa menggantung lama dan leak.

---

### 31.2 Async dengan unbounded queue

```java
new LinkedBlockingQueue<>(); // unlimited capacity by default
```

Bahaya: overload menjadi heap exhaustion.

---

### 31.3 Menulis response dari banyak thread

```java
futureA.thenAccept(a -> response.getWriter().write(a));
futureB.thenAccept(b -> response.getWriter().write(b));
```

Bahaya: interleaved response, race, corrupted output.

---

### 31.4 Menggunakan request object setelah complete

```java
async.complete();
String p = async.getRequest().getParameter("x"); // wrong lifecycle assumption
```

Bahaya: undefined/invalid lifecycle usage.

---

### 31.5 Tidak cleanup registry

```java
sessions.put(userId, async); // never removed
```

Bahaya: memory leak dan stale state.

---

### 31.6 Menganggap async menyelesaikan bottleneck DB

```text
Container thread released,
but DB pool still only has 20 connections.
```

Bahaya: latency queue pindah ke DB pool.

---

### 31.7 Blocking call di event loop / callback thread

Jika callback berasal dari non-blocking client event loop, jangan lakukan CPU/blocking heavy work di callback thread.

```java
client.callAsync().whenComplete((r, e) -> {
    blockingDatabaseCall(); // may poison callback/event-loop executor
});
```

Pindahkan ke executor yang sesuai.

---

## 32. Debugging Playbook

### Kasus: request menggantung

Cek:

1. Apakah `complete()` selalu dipanggil?
2. Apakah listener timeout aktif?
3. Apakah async timeout terlalu tinggi/disabled?
4. Apakah executor queue penuh?
5. Apakah downstream call tidak punya timeout?
6. Apakah response write menunggu client/proxy?
7. Apakah registry long-polling tidak cleanup?

### Kasus: log duration terlalu kecil

Cek:

1. Apakah filter hanya mengukur initial dispatch?
2. Apakah menggunakan `AsyncListener.onComplete`?
3. Apakah async dispatch membuat filter terpanggil beberapa kali?

### Kasus: correlation ID hilang

Cek:

1. Apakah MDC dipropagate ke async thread?
2. Apakah filter clear MDC sebelum async worker berjalan?
3. Apakah request attribute dicopy ke context object?
4. Apakah framework tracing mendukung async?

### Kasus: 503/504 massal

Cek:

1. Async timeout.
2. Executor rejected count.
3. Downstream timeout.
4. LB/proxy timeout.
5. DB/HTTP connection pool.
6. Queue length.
7. Recent deployment/shutdown/draining.

### Kasus: response double-write

Cek:

1. Timeout listener dan success callback race.
2. `onError` dan catch block sama-sama write.
3. Multiple futures complete independently.
4. Tidak ada `AtomicBoolean done`.

---

## 33. Relation ke Bagian Sebelumnya

Async servlet mengikat banyak konsep sebelumnya:

| Bagian | Hubungan |
|---|---|
| Part 003 Container Architecture | worker thread dilepas dan request lifecycle diperpanjang |
| Part 004 Servlet Lifecycle | `service` return tidak berarti request selesai |
| Part 005 Request Object | request object tetap carrier tapi lifecycle lebih panjang |
| Part 006 Response Object | commit/write/error tetap berlaku dalam async phase |
| Part 008 Dispatching | async dispatch masuk pipeline dengan `DispatcherType.ASYNC` |
| Part 009 Filters | filter harus async-aware |
| Part 010 Listeners | `AsyncListener` menambah lifecycle callback |
| Part 012 Session | session bisa diakses pada async flow, tapi concurrency tetap bahaya |
| Part 013 Cookies/Headers | headers tetap harus diset sebelum response commit |

---

## 34. Mental Model Final

Async servlet bukan “magic performance mode”.

Async servlet adalah:

```text
A Servlet lifecycle mechanism that lets a request remain open
while the original container thread returns,
so completion can happen later via callback, executor, event, timeout, or dispatch.
```

Top-tier mental model:

```text
Synchronous servlet controls one call stack.
Async servlet controls a state machine.
```

Dalam synchronous servlet, pertanyaan utama:

```text
What happens during this method call?
```

Dalam async servlet, pertanyaan utama:

```text
Who owns completion?
Who owns timeout?
Who owns cancellation?
Who owns context propagation?
Who owns response commit?
Who owns cleanup?
Who owns capacity limit?
```

Jika pertanyaan itu tidak terjawab, async servlet akan menjadi sumber bug produksi yang sulit dilacak.

---

## 35. Checklist Desain Async Servlet

Sebelum memakai async servlet, jawab:

- [ ] Apakah workload benar-benar butuh async lifecycle?
- [ ] Apakah semua filter di chain `asyncSupported=true`?
- [ ] Apakah timeout async ditentukan?
- [ ] Apakah downstream timeout lebih pendek dari async timeout?
- [ ] Apakah completion idempotent?
- [ ] Apakah ada guard untuk timeout race?
- [ ] Apakah executor bounded?
- [ ] Apakah rejection menghasilkan response 503 yang jelas?
- [ ] Apakah MDC/security/tenant/trace context dipropagate atau dicopy?
- [ ] Apakah response hanya ditulis oleh satu owner?
- [ ] Apakah client disconnect ditangani sebagai operational event?
- [ ] Apakah registry pending request cleanup pada complete/timeout/error?
- [ ] Apakah metric active async request tersedia?
- [ ] Apakah shutdown/draining memikirkan pending async request?

---

## 36. Ringkasan

Async Servlet adalah fitur penting untuk web runtime Java modern, terutama untuk long-lived request, callback integration, long polling, SSE, dan pelepasan container worker thread dari operasi menunggu.

Namun async servlet tidak otomatis membuat aplikasi non-blocking, tidak menghapus bottleneck downstream, tidak menggantikan background job durable, dan tidak membebaskan engineer dari timeout/cancellation/context propagation.

Engineer level tinggi memahami async servlet sebagai state machine dengan ownership eksplisit:

```text
request accepted
thread released
work pending
timeout/error/success races
response written
complete once
cleanup always
```

Jika dipakai dengan benar, async servlet adalah alat runtime yang kuat. Jika dipakai karena hype, ia hanya memindahkan bottleneck dan menambah failure mode.

---

## 37. Referensi

- Jakarta Servlet 6.1 Specification — asynchronous processing, request/response lifecycle, dispatching, listener model.
- Jakarta Servlet 6.1 API — `AsyncContext`, `AsyncListener`, `AsyncEvent`, `ServletRequest`, `ServletResponse`.
- Jakarta Servlet API — `ServletInputStream`, `ServletOutputStream`, `ReadListener`, `WriteListener` untuk non-blocking I/O.
- Jakarta EE Tutorial — asynchronous servlet and non-blocking I/O concepts.
- Apache Tomcat Servlet API documentation — historical `javax.servlet` async semantics for Servlet 3.x/4.x and migration context.
- OpenJDK Java 21+ documentation — virtual threads as modern server-side concurrency option.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 013 — Cookies, Headers, SameSite, and Browser Boundary](./learn-java-servlet-websocket-web-container-runtime-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 015 — Servlet Non-Blocking I/O](./learn-java-servlet-websocket-web-container-runtime-part-015.md)
