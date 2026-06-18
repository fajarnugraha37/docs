# Part 11 — Virtual Threads, Jakarta EE, and Managed Concurrency

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `11-virtual-threads-and-jakarta-ee-managed-concurrency.md`  
> Scope: Java 8–25, Java EE/Jakarta EE managed runtime, Jakarta Concurrency 3.1+, Jakarta EE 11 baseline  
> Status: Advanced continuation; assumes you already understand Java SE concurrency fundamentals.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu memahami dan mendesain penggunaan **virtual threads** di aplikasi Jakarta EE secara benar, bukan hanya mengikuti hype “thread murah”.

Target pemahaman:

1. Membedakan **cheap execution carrier** dari **managed execution contract**.
2. Memahami kenapa virtual threads tidak otomatis menggantikan `ManagedExecutorService`, `ManagedScheduledExecutorService`, `ContextService`, transaction boundary, security boundary, dan lifecycle container.
3. Memahami kapan virtual threads meningkatkan throughput, kapan tidak memberi efek, dan kapan justru memperbesar failure blast radius.
4. Mendesain workload Jakarta EE yang memanfaatkan virtual threads tanpa kehilangan:
   - container integrity,
   - context propagation,
   - security attribution,
   - transaction safety,
   - observability,
   - cancellation semantics,
   - capacity control.
5. Menilai kompatibilitas Java 8–25 dan Jakarta EE 8–11 secara realistis.
6. Menghindari kesalahan umum seperti:
   - mengganti semua executor dengan virtual-thread-per-task executor,
   - membuat unbounded fan-out,
   - memakai virtual threads untuk menyelesaikan bottleneck database,
   - menganggap virtual thread sama dengan async/reactive,
   - mengabaikan pinning, blocking, dan carrier thread starvation.

---

## 2. Core Thesis

Virtual threads mengubah biaya membuat dan memblokir thread.  
Virtual threads **tidak menghapus kebutuhan governance execution**.

Dalam Jakarta EE, masalah utama concurrency bukan hanya:

> “Berapa banyak thread yang bisa dibuat?”

Tetapi:

> “Siapa yang memiliki thread itu, context apa yang valid di dalamnya, lifecycle siapa yang mengontrolnya, bagaimana ia dibatasi, bagaimana ia dihentikan, bagaimana ia diamati, dan bagaimana efek sampingnya dipulihkan?”

Virtual threads menjawab sebagian problem **scalability of blocking execution**.  
Managed concurrency menjawab problem **container-safe execution**.

Keduanya bukan lawan. Dalam Jakarta EE modern, bentuk yang paling sehat adalah:

```text
Managed Concurrency Contract
        +
Virtual Thread Execution Strategy
        +
Explicit Capacity / Context / Transaction / Observability Design
```

---

## 3. Baseline Versi: Java 8–25 dan Jakarta EE

### 3.1 Java SE timeline yang relevan

| Java Version | Relevansi terhadap virtual threads |
|---|---|
| Java 8 | Tidak ada virtual threads. Baseline klasik: platform threads, `ExecutorService`, `CompletableFuture`. |
| Java 9–18 | Tidak ada virtual threads final. Ada evolusi API concurrency minor, Flow API, dan fondasi runtime. |
| Java 19 | Virtual threads hadir sebagai preview Project Loom. |
| Java 20 | Virtual threads tetap preview. |
| Java 21 | Virtual threads final melalui JEP 444. Ini baseline stabil pertama. |
| Java 22–23 | Perbaikan runtime bertahap; structured concurrency/scoped values masih preview/incubator tergantung versi. |
| Java 24 | Peningkatan besar terkait virtual thread pinning melalui JEP 491. |
| Java 25 | Relevan untuk generasi enterprise baru: virtual threads sudah matang, structured concurrency/scoped values makin relevan, tetapi perlu cek status final/preview pada runtime yang dipakai. |

Catatan penting: Java 21 adalah titik awal aman untuk membahas virtual threads sebagai fitur final. Java 8–17 tetap sangat umum di enterprise, sehingga desain library/aplikasi harus mampu memiliki fallback ke platform threads.

### 3.2 Jakarta EE timeline yang relevan

| Platform | Namespace | Concurrency story |
|---|---|---|
| Java EE 7/8 | `javax.enterprise.concurrent` | Managed executor, scheduled executor, thread factory, context service; tidak mengenal virtual threads. |
| Jakarta EE 9/10 | `jakarta.enterprise.concurrent` | Namespace berubah ke `jakarta`; semantics managed concurrency tetap penting. |
| Jakarta EE 11 | Jakarta Concurrency 3.1 | Baseline modern; memperkenalkan dukungan Java SE virtual threads pada managed resources. |
| Jakarta EE 12 | Under development | Spesifikasi berkembang; gunakan Jakarta EE 11 sebagai baseline stabil kecuali server sudah jelas mendukung fitur baru. |

Jakarta EE 11 menyatakan bahwa Jakarta Concurrency 3.1 memperkenalkan support untuk Java SE virtual threads pada managed resources, misalnya melalui definisi managed executor/thread factory. Jakarta Concurrency sendiri tetap bertujuan menyediakan concurrency dari komponen aplikasi tanpa mengorbankan integritas container.

---

## 4. Mental Model: Platform Thread vs Virtual Thread vs Managed Thread

### 4.1 Platform thread

Platform thread adalah thread tradisional Java yang biasanya dipetakan ke thread OS.

Sifat penting:

- relatif mahal dibanding virtual thread,
- jumlahnya harus dibatasi ketat,
- blocking thread berarti menahan resource OS,
- cocok untuk thread pool terbatas,
- menjadi model dominan sebelum Java 21.

Mental model:

```text
1 Java platform thread ≈ 1 expensive OS-backed execution lane
```

Jika kamu memiliki 5000 request concurrent yang masing-masing blocking ke DB/API, platform-thread-per-request biasanya tidak scalable kecuali kapasitas thread, memory, DB, dan downstream sangat besar.

### 4.2 Virtual thread

Virtual thread adalah thread Java ringan yang dijadwalkan oleh JVM di atas sejumlah platform thread carrier.

Mental model:

```text
Many virtual threads
        ↓ mounted/unmounted by JVM
Fewer carrier platform threads
        ↓ scheduled by OS
CPU cores
```

Virtual thread murah dibuat dan murah dipark ketika blocking pada operasi yang didukung JVM. Karena itu, model blocking imperative bisa kembali kompetitif untuk workload I/O-bound.

Tetapi virtual thread tetap thread:

- punya stack logical,
- bisa blocking,
- bisa interrupted,
- bisa punya ThreadLocal,
- bisa deadlock,
- bisa menahan lock,
- bisa membuat downstream overload,
- bisa membawa context yang salah jika didesain salah.

### 4.3 Managed thread dalam Jakarta EE

Managed thread bukan sekadar jenis thread fisik. Ia adalah thread yang berada dalam kontrak container.

Managed thread berarti container bisa mengatur:

- lifecycle,
- classloader context,
- naming context,
- security context,
- application context,
- resource usage,
- deployment boundary,
- shutdown behavior,
- observability hooks,
- policy configuration.

Sebuah managed thread bisa saja secara implementasi memakai:

- platform thread,
- virtual thread,
- atau strategi vendor-specific.

Jadi taxonomy yang benar bukan:

```text
managed thread vs virtual thread
```

Tetapi:

```text
ownership/governance axis: unmanaged vs managed
execution-cost axis: platform vs virtual
```

### 4.4 Matrix mental model

| Execution | Owner | Cost model | Aman untuk Jakarta EE? | Catatan |
|---|---|---:|---|---|
| `new Thread(...)` platform | Application | mahal | Tidak ideal | Bypass lifecycle/context container. |
| `Executors.newFixedThreadPool(...)` | Application | mahal/terbatas | Biasanya tidak ideal | App membuat mini-runtime sendiri. |
| `Executors.newVirtualThreadPerTaskExecutor()` | Application | murah per thread | Tetap berisiko | Murah bukan berarti managed. |
| `ManagedExecutorService` platform-backed | Container | configurable | Ya | Portable managed concurrency klasik. |
| `ManagedExecutorService` virtual-backed | Container | murah per task | Ya, jika server support | Model modern yang ideal untuk banyak I/O-bound task. |
| `ManagedThreadFactory` platform | Container-created | tergantung | Hati-hati | Lower-level, jangan jadi mini-runtime. |
| `ManagedThreadFactory` virtual | Container-created | murah | Hati-hati | Tetap perlu lifecycle/capacity design. |

---

## 5. Kesalahpahaman Utama tentang Virtual Threads

### 5.1 “Virtual thread berarti tidak perlu thread pool”

Sebagian benar, tetapi berbahaya jika dipahami mentah.

Untuk virtual-thread-per-task, kamu memang biasanya tidak memakai pool virtual thread karena virtual thread murah dibuat per task. Tetapi kamu tetap butuh **capacity control**.

Yang tidak lagi perlu:

```text
pool virtual thread untuk menghemat thread
```

Yang tetap perlu:

```text
limit jumlah pekerjaan aktif terhadap resource bottleneck
```

Contoh:

- DB pool hanya 50 connection.
- External API rate limit 300 request/minute.
- CPU hanya 8 core.
- Oracle undo/redo bisa saturate.
- S3/object storage punya throughput limit.

Membuat 50.000 virtual threads tidak memperbesar DB pool menjadi 50.000.

### 5.2 “Virtual thread lebih cepat”

Virtual threads bukan magic CPU acceleration.

Virtual thread membantu ketika workload sering blocking:

- HTTP call,
- DB call,
- file/network I/O,
- waiting on queue,
- waiting on lock, meski lock contention tetap masalah.

Virtual thread tidak banyak membantu untuk CPU-bound workload:

- compression besar,
- encryption besar,
- image processing,
- heavy JSON transformation,
- rule engine CPU-heavy,
- large in-memory sorting,
- batch calculation pure CPU.

Untuk CPU-bound, jumlah pekerjaan parallel ideal tetap kira-kira berhubungan dengan jumlah core, bukan jumlah virtual thread.

### 5.3 “Virtual thread menggantikan reactive”

Virtual thread membuat gaya imperative blocking lebih scalable dan lebih sederhana dibanding banyak reactive pipeline untuk kasus I/O-bound biasa.

Tetapi reactive/streaming tetap berguna untuk:

- true streaming backpressure,
- event streams,
- high-volume message pipeline,
- push-based async composition,
- non-blocking protocol stack tertentu,
- ecosystem yang sudah reactive-native.

Virtual thread bukan “reactive killer” universal. Ia mengurangi kebutuhan reactive untuk banyak CRUD/API fan-out yang sebelumnya dibuat reactive hanya karena thread platform mahal.

### 5.4 “Virtual thread aman dipakai bebas di Jakarta EE”

Tidak. Yang aman adalah virtual thread yang digunakan melalui kontrak yang sesuai dengan container, terutama saat berjalan di application server.

Kesalahan umum:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> service.doWork());
}
```

Kode ini valid Java SE, tetapi dalam Jakarta EE bisa bermasalah karena:

- executor dimiliki aplikasi, bukan container,
- context propagation tidak otomatis sesuai spesifikasi Jakarta,
- shutdown/redeploy tidak selalu terkoordinasi,
- security/CDI/JNDI context bisa tidak valid,
- observability server bisa melewatkan task tersebut,
- resource governance bypass.

Dalam Jakarta EE, preferensi desain:

```text
Use container-managed virtual-capable resources where available.
```

---

## 6. Jakarta Concurrency 3.1 dan Virtual Threads

Jakarta Concurrency 3.1, sebagai bagian dari Jakarta EE 11, memperkenalkan dukungan virtual threads dalam managed resources. Secara konsep, ini berarti aplikasi bisa meminta resource concurrency yang menggunakan virtual threads, tetapi tetap berada di bawah pengelolaan container.

Contoh arah konsep:

```java
@ManagedExecutorDefinition(
    name = "java:app/concurrent/IoExecutor",
    virtual = true,
    maxAsync = 200
)
public class ConcurrencyResources {
}
```

Lalu resource dipakai melalui injection/lookup:

```java
@Resource(lookup = "java:app/concurrent/IoExecutor")
ManagedExecutorService ioExecutor;
```

Catatan:

- Detail atribut bisa bergantung versi API dan server.
- Selalu cek dokumentasi server yang dipakai.
- Jangan asumsikan semua application server langsung menyediakan behavior identik.
- Portability tetap lebih baik daripada membuat executor virtual thread sendiri.

### 6.1 Apa arti `virtual = true` secara mental model?

Bukan berarti:

```text
Semua masalah concurrency hilang.
```

Tetapi:

```text
Task yang dijalankan oleh managed resource dapat menggunakan virtual thread sebagai execution vehicle.
```

Container tetap harus mengatur:

- task acceptance,
- lifecycle,
- context,
- rejection/capacity,
- monitoring,
- deployment shutdown,
- integration dengan managed environment.

### 6.2 Apakah `maxAsync` masih perlu jika virtual threads murah?

Ya.

`maxAsync` atau limit sejenis bukan hanya untuk menghemat thread. Ia adalah governance terhadap workload.

Tanpa limit:

```text
10 users × 1000 fan-out calls = 10.000 virtual threads
```

Mungkin JVM kuat. Tetapi external API, DB, auth server, message broker, dan downstream service belum tentu kuat.

Limit tetap dibutuhkan untuk:

- fairness,
- backpressure,
- rate limiting,
- database protection,
- downstream protection,
- predictable latency,
- operational safety.

---

## 7. Java SE Virtual Thread API: Yang Perlu Dipahami di Jakarta EE

### 7.1 Membuat virtual thread langsung

Java SE:

```java
Thread.startVirtualThread(() -> {
    doBlockingIo();
});
```

Atau:

```java
Thread vt = Thread.ofVirtual()
    .name("worker-", 0)
    .start(() -> doWork());
```

Di Jakarta EE, hindari langsung seperti ini untuk workload aplikasi server kecuali kamu benar-benar tahu implikasinya dan server/vendor menyatakan aman untuk use case tersebut.

### 7.2 Virtual-thread-per-task executor

Java SE:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<String> future = executor.submit(() -> callExternalApi());
    return future.get();
}
```

Ini bagus untuk aplikasi Java SE, CLI, worker standalone, atau service non-container. Tetapi di Jakarta EE, prefer managed executor virtual jika tersedia.

### 7.3 ThreadLocal tetap ada, tetapi harus hati-hati

Virtual threads mendukung ThreadLocal, tetapi jangan menaruh context besar sembarangan.

Masalah potensial:

- terlalu banyak ThreadLocal pada jutaan virtual threads,
- context bocor ke task yang salah jika wrapper salah,
- request-scoped object disimpan melewati lifecycle,
- security identity stale,
- memory pressure meningkat.

Era virtual threads mendorong desain context yang lebih eksplisit. Untuk Java modern, Scoped Values menjadi arah mental model yang lebih aman untuk immutable context yang lexical-scoped, tetapi adopsi di Jakarta EE perlu mengikuti status Java dan support framework/server.

---

## 8. Blocking I/O: Kenapa Virtual Threads Berguna

### 8.1 Model platform thread klasik

Misalnya satu request melakukan:

1. query DB 80 ms,
2. call API A 120 ms,
3. call API B 150 ms,
4. write audit 20 ms.

Dengan platform thread, thread request banyak menunggu. Jika banyak request concurrent, thread pool cepat penuh.

```text
Platform thread:
RUN 5 ms
BLOCK DB 80 ms  → OS-backed thread tertahan
RUN 3 ms
BLOCK API 120 ms → OS-backed thread tertahan
...
```

### 8.2 Model virtual thread

Saat virtual thread blocking pada operasi yang didukung, JVM dapat unmount virtual thread dari carrier. Carrier bisa menjalankan virtual thread lain.

```text
Virtual thread:
RUN on carrier
BLOCK I/O → unmounted / parked
carrier released
I/O ready → mounted again
continue
```

Efeknya:

- gaya coding tetap blocking/imperative,
- throughput I/O-bound bisa naik,
- stack trace lebih natural dibanding callback-heavy code,
- debugging lebih mudah dibanding pipeline reactive kompleks.

### 8.3 Yang tidak berubah

Walaupun virtual thread murah, resource eksternal tetap terbatas:

```text
DB connections remain finite.
HTTP downstream capacity remains finite.
Transaction logs remain finite.
CPU cores remain finite.
Memory remains finite.
Lock contention remains real.
```

Virtual threads membuat aplikasi lebih mudah mengantre pekerjaan secara murah. Tanpa backpressure, ini bisa mempercepat overload.

---

## 9. Jakarta EE Request Handling dan Virtual Threads

### 9.1 Apakah request thread Jakarta EE bisa virtual thread?

Ini bergantung server dan versi. Jakarta EE 11 membawa support virtual threads pada Jakarta Concurrency managed resources, tetapi request handling servlet/JAX-RS virtual-thread-per-request adalah keputusan implementasi server/framework.

Beberapa server mungkin menyediakan opsi virtual thread untuk request executor. Namun secara portable, kamu tidak boleh mengasumsikan request thread adalah virtual thread.

Kode yang buruk:

```java
if (Thread.currentThread().isVirtual()) {
    // assume behavior
}
```

Lebih baik desain berdasarkan contract:

```text
Do not depend on whether the current thread is virtual or platform.
Depend on lifecycle, timeout, transaction, context, and resource boundary.
```

### 9.2 Request thread bukan tempat untuk uncontrolled fan-out

Contoh buruk:

```java
@GET
@Path("/sync-all")
public Response syncAll() throws Exception {
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        List<Future<?>> futures = ids.stream()
            .map(id -> executor.submit(() -> syncOne(id)))
            .toList();

        for (Future<?> future : futures) {
            future.get();
        }
    }
    return Response.ok().build();
}
```

Masalah:

- executor unmanaged,
- jumlah task tidak dibatasi,
- request timeout bisa terjadi saat task masih punya side effects,
- transaction/security/audit boundary kabur,
- API/DB bisa overload,
- cancellation tidak jelas,
- observability buruk.

Desain lebih baik:

```text
Request validates command
        ↓
Persist durable job request / outbox
        ↓
Return 202 Accepted + jobId
        ↓
Managed executor / Jakarta Batch / messaging processes work
        ↓
Progress and audit observable
```

Atau jika memang harus synchronous fan-out kecil:

```text
Request
  → ManagedExecutorService virtual-backed
  → explicit semaphore/rate limit
  → timeout/cancel
  → aggregate result
```

---

## 10. Virtual Threads dengan ManagedExecutorService

### 10.1 Preferred model

Untuk Jakarta EE 11+ server yang mendukung managed virtual resources:

```java
@Resource(lookup = "java:app/concurrent/IoExecutor")
ManagedExecutorService ioExecutor;

public CompletionStage<CustomerSnapshot> loadSnapshot(String customerId) {
    return CompletableFuture.supplyAsync(
        () -> loadCustomerSnapshotBlocking(customerId),
        ioExecutor
    );
}
```

Keuntungan:

- task masuk ke managed executor,
- container bisa mengontrol lifecycle,
- context propagation mengikuti spesifikasi/config,
- executor bisa dikonfigurasi admin/deployer,
- virtual thread bisa dipakai sebagai execution strategy,
- observability lebih mudah dibanding unmanaged executor.

### 10.2 Jangan gunakan default async executor

Buruk:

```java
CompletableFuture.supplyAsync(() -> callApi());
```

Ini memakai default executor `CompletableFuture`, umumnya `ForkJoinPool.commonPool()` untuk async stage tertentu. Dalam Jakarta EE, ini berisiko karena common pool tidak managed oleh container.

Lebih baik:

```java
CompletableFuture.supplyAsync(() -> callApi(), managedExecutor);
```

### 10.3 Virtual thread bukan alasan menghapus timeout

Tetap lakukan:

```java
CompletableFuture<ResponseDto> future = CompletableFuture
    .supplyAsync(() -> externalClient.getData(id), ioExecutor)
    .orTimeout(2, TimeUnit.SECONDS)
    .exceptionally(ex -> fallback(id, ex));
```

Tetapi ingat: timeout pada `CompletableFuture` belum tentu otomatis membatalkan blocking call di client library. HTTP client, JDBC, dan transaction timeout tetap harus dikonfigurasi di layer masing-masing.

---

## 11. Capacity Control pada Virtual Threads

### 11.1 Kenapa virtual threads justru membuat limit makin penting

Dengan platform thread, thread pool kecil sering menjadi accidental backpressure. Dengan virtual thread, accidental backpressure hilang.

Ini bagus jika kamu punya backpressure eksplisit.  
Ini berbahaya jika tidak.

Tanpa limit:

```text
incoming request spike
        ↓
create huge virtual tasks
        ↓
all tasks call DB/API
        ↓
DB pool exhausted / API 429 / queue explosion
        ↓
latency collapse
        ↓
retry storm
```

Dengan limit:

```text
incoming request spike
        ↓
bounded admission control
        ↓
limited active downstream calls
        ↓
reject/defer gracefully
        ↓
stable latency and recovery
```

### 11.2 Semaphore pattern untuk downstream-bound workload

```java
@ApplicationScoped
public class RegistryClientFacade {

    private final Semaphore registryPermits = new Semaphore(50);

    @Resource(lookup = "java:app/concurrent/IoExecutor")
    ManagedExecutorService ioExecutor;

    public CompletionStage<RegistryResult> fetch(String entityId) {
        return CompletableFuture.supplyAsync(() -> {
            boolean acquired = false;
            try {
                acquired = registryPermits.tryAcquire(500, TimeUnit.MILLISECONDS);
                if (!acquired) {
                    throw new RejectedExecutionException("Registry concurrency limit reached");
                }
                return callRegistry(entityId);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new CancellationException("Interrupted while waiting for registry permit");
            } finally {
                if (acquired) {
                    registryPermits.release();
                }
            }
        }, ioExecutor);
    }
}
```

Catatan:

- `Semaphore` membatasi downstream calls, bukan thread.
- Limit harus berdasarkan kapasitas downstream, bukan jumlah virtual thread.
- Pada cluster, limit lokal per node tidak sama dengan global limit. Perlu distributed rate limit jika downstream memiliki quota global.

### 11.3 DB pool sebagai hard bottleneck

Jika Hikari/connection pool size 50, maka 1000 virtual threads yang memanggil DB akan antre di pool.

Efek buruk:

- banyak virtual threads parked menunggu connection,
- request latency meningkat,
- timeout berlapis,
- transaction boundary kacau jika connection diperoleh terlalu lambat,
- DB terlihat “lambat” padahal pool bottleneck.

Desain lebih baik:

```text
DB concurrency limit <= DB pool capacity minus headroom
```

Contoh:

```text
Hikari maxPoolSize = 50
reserved request headroom = 20
batch/async DB permits = 20-25
```

Jangan biarkan background virtual-thread workload memakai semua DB connection.

---

## 12. JDBC, JPA, JTA, dan Virtual Threads

### 12.1 JDBC blocking cocok secara API, tetapi DB tetap bottleneck

JDBC adalah blocking API. Virtual threads membuat blocking JDBC tidak menghabiskan platform thread sebanyak model lama. Tetapi:

- connection tetap resource fisik,
- database tetap punya CPU/I/O/lock/redo/undo limit,
- transaction tetap harus pendek,
- cursor tetap harus ditutup,
- fetch size dan batch size tetap penting.

Virtual threads memperbaiki thread scalability, bukan database scalability.

### 12.2 EntityManager dan thread confinement

JPA `EntityManager` tidak boleh diperlakukan sebagai object bebas lintas thread.

Kesalahan:

```java
EntityManager em = this.entityManager;

ids.forEach(id -> executor.submit(() -> {
    Entity entity = em.find(Entity.class, id); // dangerous
}));
```

Masalah:

- persistence context tidak thread-safe,
- transaction context tidak valid lintas thread,
- lazy loading bisa terjadi di context salah,
- entity managed state bisa corrupt secara konseptual.

Desain aman:

```java
ids.forEach(id -> executor.submit(() -> service.processOneInItsOwnTransaction(id)));
```

Di mana `service.processOneInItsOwnTransaction` dipanggil melalui CDI/EJB proxy/interceptor yang benar, bukan self-invocation.

### 12.3 Transaction per virtual task

Virtual thread membuat mudah membuat banyak task. Jangan membuat satu transaction global lalu menyebar task paralel ke dalamnya.

Buruk:

```text
Begin transaction in request
  → spawn 100 virtual tasks
  → all tasks use same conceptual transaction
  → commit at end
```

Lebih aman:

```text
For each independent unit:
  → start its own transaction
  → read/process/write
  → commit
  → record result
```

Untuk batch besar, gunakan Jakarta Batch chunk transaction model atau durable job pattern.

---

## 13. Locking, Pinning, dan Java 24+

### 13.1 Apa itu pinning?

Virtual thread idealnya bisa unmount dari carrier ketika blocking. Tetapi dalam kondisi tertentu, virtual thread dapat tetap menahan carrier thread. Ini disebut pinning.

Secara historis, pinning banyak dibahas pada:

- blocking di dalam `synchronized` block/method,
- native/foreign calls tertentu,
- operasi yang belum Loom-friendly.

Jika banyak virtual threads pinned, carrier thread bisa habis, sehingga scalability virtual threads turun drastis.

### 13.2 Java 24 dan JEP 491

JEP 491 bertujuan mengurangi masalah pinning pada `synchronized` dengan membuat virtual threads yang blocking di construct tersebut dapat melepas carrier. Ini peningkatan besar untuk kode Java lama yang banyak memakai `synchronized`.

Tetapi jangan salah paham:

- lock contention tetap lock contention,
- critical section panjang tetap buruk,
- virtual thread tidak membuat shared mutable state aman,
- blocking di native/foreign/library tertentu tetap harus diperiksa,
- Java 21 deployment masih umum, jadi pinning tetap perlu diperhatikan.

### 13.3 Practical rule

Untuk Java 21:

- hindari blocking lama di dalam `synchronized`,
- gunakan `ReentrantLock` atau concurrency primitive modern bila cocok,
- jaga critical section pendek,
- aktifkan observability pinning bila tersedia,
- tes dengan workload nyata.

Untuk Java 24+:

- pinning karena `synchronized` jauh berkurang,
- tetap jangan jadikan ini alasan desain lock buruk,
- tetap ukur latency dan carrier utilization.

---

## 14. Virtual Threads dan `synchronized`

### 14.1 Contoh buruk

```java
public synchronized RegistryResult getOrLoad(String key) {
    RegistryResult cached = cache.get(key);
    if (cached != null) {
        return cached;
    }

    RegistryResult loaded = externalClient.fetch(key); // blocking inside synchronized
    cache.put(key, loaded);
    return loaded;
}
```

Masalah:

- semua caller serial pada monitor yang sama,
- external call blocking dilakukan di dalam lock,
- pada Java 21, ini bisa berkontribusi pada pinning,
- pada Java 24+, pinning membaik tetapi serialisasi tetap buruk,
- latency satu request buruk menahan semua request.

### 14.2 Desain lebih baik: compute outside lock

```java
public RegistryResult getOrLoad(String key) {
    RegistryResult cached = cache.get(key);
    if (cached != null) {
        return cached;
    }

    RegistryResult loaded = externalClient.fetch(key);

    RegistryResult existing = cache.putIfAbsent(key, loaded);
    return existing != null ? existing : loaded;
}
```

Masih ada duplicate fetch race. Untuk banyak kasus acceptable. Jika tidak, gunakan in-flight dedup.

### 14.3 In-flight dedup dengan `CompletableFuture`

```java
@ApplicationScoped
public class RegistryCache {

    private final ConcurrentHashMap<String, CompletableFuture<RegistryResult>> inFlight = new ConcurrentHashMap<>();

    @Resource(lookup = "java:app/concurrent/IoExecutor")
    ManagedExecutorService executor;

    public CompletionStage<RegistryResult> getOrLoad(String key) {
        return inFlight.computeIfAbsent(key, ignored ->
            CompletableFuture.supplyAsync(() -> externalFetch(key), executor)
                .whenComplete((result, error) -> inFlight.remove(key))
        );
    }
}
```

Ini lebih baik untuk virtual threads karena:

- tidak blocking di monitor,
- duplicate work dikurangi,
- executor managed,
- external fetch bisa berjalan di virtual managed thread jika resource dikonfigurasi demikian.

---

## 15. Virtual Threads vs Async Servlet/JAX-RS

### 15.1 Servlet async klasik

Servlet async memungkinkan request thread dilepas sementara response diselesaikan belakangan.

Model:

```text
request arrives
  → start async
  → release container request thread
  → background work
  → complete response
```

Ini berguna saat platform threads mahal.

### 15.2 Dengan virtual threads

Jika request handling sendiri memakai virtual threads, kebutuhan servlet async untuk sekadar melepas platform thread bisa berkurang.

Tetapi servlet async masih berguna untuk:

- streaming response,
- server-sent events,
- long polling,
- integrating with callback APIs,
- container-specific timeout/lifecycle handling,
- separating request lifecycle from backend work.

### 15.3 Jangan campur tanpa model jelas

Buruk:

```text
request virtual thread
  → servlet async
  → unmanaged virtual executor
  → CompletableFuture commonPool
  → callback writes response
```

Ini membuat lifecycle kabur.

Lebih baik pilih satu model dominan:

1. Synchronous blocking request on virtual thread for small bounded work.
2. Managed async executor for bounded fan-out.
3. Durable async job for long-running work.
4. Jakarta Batch for restartable batch.
5. Messaging/workflow for distributed orchestration.

---

## 16. Virtual Threads dan Jakarta Batch

Virtual threads tidak menggantikan Jakarta Batch.

Jakarta Batch menyediakan:

- job repository,
- job instance/execution state,
- step lifecycle,
- chunk transaction,
- checkpoint,
- restart,
- skip/retry semantics,
- partitioning,
- operator control.

Virtual threads hanya execution mechanism.

### 16.1 Kapan virtual threads membantu batch?

Virtual threads bisa membantu jika batch step melakukan banyak blocking I/O:

- call external API per record,
- fetch metadata dari remote system,
- upload/download object storage,
- enrichment via service call.

Tetapi tetap butuh:

- rate limit,
- partition limit,
- retry/backoff,
- idempotent writer,
- checkpoint state,
- failure classification.

### 16.2 Kapan virtual threads tidak membantu batch?

Tidak banyak membantu jika batch bottleneck-nya:

- single DB query besar,
- heavy CPU transformation,
- lock contention,
- sequential file format,
- one external API global rate limit,
- large transaction log pressure.

### 16.3 Anti-pattern: parallelize everything inside chunk

Buruk:

```java
public void writeItems(List<Object> items) {
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        for (Object item : items) {
            executor.submit(() -> callExternalSystem(item));
        }
    }
}
```

Masalah:

- unmanaged executor,
- chunk transaction semantics kabur,
- partial side effects sulit direstart,
- external API overload,
- checkpoint tidak mewakili side effect real,
- error aggregation buruk.

Lebih baik:

```text
chunk reads records
  → each record transformed deterministically
  → writer persists intent/outbox rows transactionally
  → separate managed worker sends external calls with idempotency
  → result reconciled by later batch step
```

Atau gunakan partitioning resmi Jakarta Batch jika paralelisme berada pada level partition/step yang restartable.

---

## 17. Request Fan-Out Pattern dengan Virtual Managed Executor

### 17.1 Use case

Endpoint perlu mengambil data dari beberapa service internal:

- profile service,
- compliance service,
- enforcement service,
- document service.

Semua I/O-bound dan harus selesai dalam 2 detik.

### 17.2 Desain buruk

Sequential:

```java
Profile p = profileClient.get(id);
Compliance c = complianceClient.get(id);
Enforcement e = enforcementClient.get(id);
Documents d = documentClient.get(id);
```

Latency total kira-kira penjumlahan semua call.

### 17.3 Desain lebih baik dengan managed executor

```java
@ApplicationScoped
public class CaseSnapshotService {

    @Resource(lookup = "java:app/concurrent/IoExecutor")
    ManagedExecutorService executor;

    public CaseSnapshot load(String caseId) {
        CompletableFuture<Profile> profile = CompletableFuture.supplyAsync(
            () -> profileClient.get(caseId), executor);

        CompletableFuture<Compliance> compliance = CompletableFuture.supplyAsync(
            () -> complianceClient.get(caseId), executor);

        CompletableFuture<Enforcement> enforcement = CompletableFuture.supplyAsync(
            () -> enforcementClient.get(caseId), executor);

        CompletableFuture<List<Document>> documents = CompletableFuture.supplyAsync(
            () -> documentClient.list(caseId), executor);

        CompletableFuture<Void> all = CompletableFuture.allOf(
            profile, compliance, enforcement, documents
        );

        try {
            all.orTimeout(1800, TimeUnit.MILLISECONDS).join();

            return new CaseSnapshot(
                profile.join(),
                compliance.join(),
                enforcement.join(),
                documents.join()
            );
        } catch (CompletionException ex) {
            throw translateSnapshotFailure(caseId, ex);
        }
    }
}
```

### 17.4 Production hardening yang masih harus ditambahkan

Kode di atas belum lengkap production-grade. Tambahkan:

- HTTP client timeout per call,
- bulkhead per downstream,
- rate limit jika ada quota,
- fallback jika business membolehkan,
- cancellation propagation,
- audit/correlation propagation,
- metrics per downstream,
- structured error response,
- tracing async spans,
- no side effect dalam read fan-out.

---

## 18. Cancellation dan Interruption pada Virtual Threads

### 18.1 Virtual thread tetap harus cooperative

Virtual thread bisa di-interrupt seperti thread biasa.

```java
try {
    blockingCall();
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new CancellationException("Task interrupted");
}
```

Tetapi tidak semua blocking library merespons interruption sama.

Perlu konfigurasi timeout eksplisit:

- HTTP connect timeout,
- HTTP read timeout,
- JDBC query timeout,
- transaction timeout,
- lock wait timeout,
- future timeout.

### 18.2 Timeout layering

```text
User request timeout:        2.0s
Internal fan-out budget:     1.8s
HTTP client read timeout:    1.5s
DB query timeout:            1.2s
Transaction timeout:         2.0s or less depending use case
```

Jangan membuat future timeout 2 detik tetapi HTTP client timeout 60 detik. Itu membuat task bisa tetap menahan resource setelah caller menyerah.

---

## 19. Observability Virtual Threads di Jakarta EE

### 19.1 Yang harus diamati

Untuk executor virtual-backed:

- submitted task count,
- active task count,
- completed task count,
- failed task count,
- rejected task count,
- timeout count,
- queue/admission wait,
- downstream latency,
- DB connection acquisition time,
- carrier thread utilization jika tersedia,
- virtual thread count,
- pinned virtual thread events,
- cancellation count.

### 19.2 Thread dump berubah

Dengan virtual threads, thread dump bisa berisi sangat banyak virtual threads. Jangan menganalisis seperti era platform threads saja.

Yang dicari:

- banyak virtual threads menunggu DB connection,
- banyak virtual threads menunggu lock sama,
- banyak virtual threads stuck di library call,
- carrier thread starvation,
- blocking di critical section,
- commonPool usage tak sengaja,
- unmanaged executor thread names.

### 19.3 JFR

Java Flight Recorder sangat berguna untuk virtual thread observability, termasuk event terkait virtual thread, blocking, dan pinning pada JDK yang mendukung. Untuk production, gunakan sampling/recording profile yang aman agar overhead terkendali.

---

## 20. Failure Modes Khusus Virtual Threads di Enterprise

### 20.1 Cheap-thread amplification

Karena thread murah, developer membuat terlalu banyak pekerjaan.

Gejala:

- downstream 429,
- DB pool exhausted,
- latency meningkat tajam,
- retry storm,
- heap naik karena task/result menumpuk,
- request timeout massal.

Mitigasi:

- admission control,
- semaphore/bulkhead,
- bounded job queue,
- rate limiter,
- per-tenant fairness,
- reject early.

### 20.2 Unmanaged virtual executor leak

Gejala:

- redeploy tidak bersih,
- task lama masih berjalan,
- classloader leak,
- memory leak,
- thread names aneh di dump,
- container tidak tahu workload tersebut.

Mitigasi:

- gunakan managed executor,
- jangan buat executor static,
- jangan simpan executor global unmanaged,
- integrasikan lifecycle shutdown.

### 20.3 Context explosion

Gejala:

- setiap virtual thread membawa context besar,
- MDC besar disalin ribuan kali,
- memory naik,
- sensitive data masuk log/task,
- stale security identity.

Mitigasi:

- context minimal,
- immutable command object,
- explicit audit attribution,
- hindari membawa request/session object,
- clear MDC setelah invocation.

### 20.4 Pinning/carrier starvation

Gejala:

- virtual thread count tinggi tetapi throughput rendah,
- carrier threads busy/stuck,
- JFR menunjukkan pinning/blocking,
- synchronized hot monitor.

Mitigasi:

- upgrade Java jika memungkinkan,
- perbaiki lock design,
- hindari blocking dalam synchronized,
- gunakan lock-free/concurrent structures bila cocok,
- ukur dengan JFR.

### 20.5 False sense of transaction safety

Gejala:

- task paralel menulis side effect terpisah,
- caller rollback tetapi side effect sudah terjadi,
- duplicate execution saat retry,
- audit tidak sesuai real execution.

Mitigasi:

- async boundary = transaction boundary,
- outbox/job request,
- idempotency key,
- per-task transaction,
- clear audit model.

---

## 21. Decision Framework: Kapan Memakai Virtual Threads

### 21.1 Good fit

Virtual threads cocok untuk:

- I/O-bound request handling,
- bounded fan-out ke beberapa service,
- blocking HTTP clients,
- blocking JDBC dengan connection control,
- short-lived background tasks,
- simple imperative code yang sebelumnya dibuat reactive hanya untuk scalability,
- task yang banyak menunggu dan sedikit CPU.

### 21.2 Conditional fit

Virtual threads bisa cocok dengan desain tambahan untuk:

- batch enrichment via external API,
- large file processing dengan blocking I/O,
- polling workers,
- scheduled jobs yang memanggil downstream,
- integration connectors.

Syarat:

- limit concurrency,
- restartability/idempotency,
- timeout,
- cancellation,
- observability.

### 21.3 Poor fit

Virtual threads kurang cocok sebagai solusi utama untuk:

- CPU-bound processing,
- huge in-memory computation,
- database query yang lambat karena plan/index buruk,
- lock-heavy code,
- global rate-limited API,
- long-running business process yang butuh state machine,
- restartable batch tanpa job repository,
- guaranteed delivery problem.

---

## 22. Migration Strategy Java 8–25

### 22.1 Dari Java 8/11/17 ke Java 21+

Jangan migrasi dengan cara:

```text
replace all ExecutorService with virtual-thread-per-task executor
```

Lakukan bertahap:

1. Identifikasi workload I/O-bound.
2. Ukur bottleneck sekarang:
   - thread pool saturation,
   - DB pool saturation,
   - downstream latency,
   - CPU,
   - memory,
   - lock contention.
3. Tambahkan timeout dan cancellation dulu.
4. Tambahkan observability executor/downstream dulu.
5. Ubah execution strategy ke managed virtual resource jika server mendukung.
6. Batasi concurrency berdasarkan downstream capacity.
7. Load test dengan skenario spike dan downstream degradation.
8. Validasi redeploy/shutdown behavior.
9. Validasi audit/security context.
10. Baru perluas ke workload lain.

### 22.2 Fallback untuk runtime non-Java 21

Jika masih Java 8/11/17:

- gunakan `ManagedExecutorService` platform-backed,
- tetap desain boundary yang sama,
- tetap gunakan bulkhead/rate limit,
- hindari API yang hanya ada di Java 21,
- abstraksikan executor strategy.

Contoh desain:

```java
public interface AsyncExecutionGateway {
    <T> CompletionStage<T> supply(String operation, Supplier<T> supplier);
}
```

Implementasi Java 8:

```text
ManagedExecutorService platform-backed
```

Implementasi Java 21+:

```text
ManagedExecutorService virtual-backed, if supported
```

Business code tidak perlu tahu thread-nya virtual atau platform.

---

## 23. Jakarta EE Server Reality Check

Walaupun spesifikasi memberi arah, realitas server penting.

Checklist evaluasi server:

1. Apakah server mendukung Jakarta EE 11?
2. Apakah Jakarta Concurrency 3.1 tersedia?
3. Apakah `virtual` pada managed resource didukung?
4. Apakah ada konfigurasi admin untuk virtual executor?
5. Bagaimana default context propagation?
6. Apakah metrics executor tersedia?
7. Bagaimana shutdown behavior task virtual?
8. Apakah request handling bisa virtual thread? Portable atau vendor-specific?
9. Bagaimana integrasi JTA/CDI/security dengan virtual managed task?
10. Apakah ada known issue dengan JDBC driver/server version?

Jangan hanya membaca API. Uji di server target.

---

## 24. Production Design Template

Gunakan template ini sebelum memakai virtual threads di Jakarta EE.

### 24.1 Workload description

```text
Name:
Type: request fan-out / background async / scheduled / batch / integration
Expected latency:
Expected throughput:
Peak concurrency:
Blocking ratio:
CPU intensity:
Downstream systems:
Stateful side effects:
Restart requirement:
Audit requirement:
```

### 24.2 Execution model

```text
Managed resource:
- ManagedExecutorService / ManagedScheduledExecutorService / Jakarta Batch / other
Thread strategy:
- platform / virtual / server default
Ownership:
- container-managed
```

### 24.3 Capacity model

```text
Max accepted tasks:
Max active tasks:
DB permits:
External API permits:
Per-tenant permits:
Queue policy:
Rejection policy:
Timeout budget:
```

### 24.4 Context model

```text
Correlation ID:
Tenant ID:
User attribution:
System identity:
Security context propagation:
MDC propagation:
Request/session context allowed? no by default
Transaction propagation? no by default
```

### 24.5 Failure model

```text
Timeout:
Cancellation:
Retry:
Fallback:
Idempotency key:
Compensation:
Partial success:
Audit event:
Operator action:
```

### 24.6 Observability model

```text
Metrics:
Logs:
Tracing:
JFR:
Thread dump naming:
Dashboard:
Alerts:
```

---

## 25. Worked Example: Regulatory Case Snapshot Fan-Out

### 25.1 Problem

User membuka detail case. UI membutuhkan snapshot dari beberapa domain:

- case core,
- party profile,
- compliance history,
- enforcement actions,
- correspondence summary,
- document metadata.

Target latency: < 2 detik.  
Semua call read-only.  
Tidak boleh membuat side effect kecuali audit read event.  
Sistem berjalan di Jakarta EE 11 dan Java 21+.

### 25.2 Bad design

```text
Request thread sequentially calls all services
OR
Request creates unmanaged virtual executor
OR
Request launches unbounded fan-out per tab refresh
```

### 25.3 Better design

```text
JAX-RS request
  → validate access synchronously
  → create immutable SnapshotCommand
  → use ManagedExecutorService virtual-backed
  → fan-out max 6 calls
  → per-downstream timeout
  → per-downstream semaphore
  → aggregate result
  → return partial/failure according to business rule
  → emit audit event with initiatedBy + correlationId
```

### 25.4 Code sketch

```java
public record SnapshotCommand(
    String caseId,
    String initiatedBy,
    String correlationId,
    Instant requestedAt
) {}
```

```java
@ApplicationScoped
public class SnapshotAggregator {

    @Resource(lookup = "java:app/concurrent/IoExecutor")
    ManagedExecutorService executor;

    public CaseSnapshot load(SnapshotCommand command) {
        var core = async("case-core", () -> caseClient.get(command.caseId()));
        var profile = async("profile", () -> profileClient.getByCase(command.caseId()));
        var compliance = async("compliance", () -> complianceClient.history(command.caseId()));
        var enforcement = async("enforcement", () -> enforcementClient.actions(command.caseId()));
        var docs = async("documents", () -> documentClient.metadata(command.caseId()));

        CompletableFuture<Void> all = CompletableFuture.allOf(
            core, profile, compliance, enforcement, docs
        );

        try {
            all.orTimeout(1800, TimeUnit.MILLISECONDS).join();

            return new CaseSnapshot(
                core.join(),
                profile.join(),
                compliance.join(),
                enforcement.join(),
                docs.join()
            );
        } catch (CompletionException ex) {
            throw mapSnapshotException(command, ex);
        }
    }

    private <T> CompletableFuture<T> async(String dependency, Supplier<T> supplier) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                return supplier.get();
            } catch (RuntimeException ex) {
                throw new DependencyFailureException(dependency, ex);
            }
        }, executor);
    }
}
```

### 25.5 Important caveat

`orTimeout` membatasi wait pada future chain, tetapi downstream client timeout tetap harus dikonfigurasi.

Contoh:

```text
HTTP client connect timeout = 300 ms
HTTP client read timeout    = 1200 ms
Aggregator budget           = 1800 ms
Request timeout             = 2000 ms
```

---

## 26. Worked Example: Batch Enrichment with Virtual Threads

### 26.1 Problem

Nightly batch perlu enrich 200.000 records dari external registry. Registry rate limit 300 request/minute. Java 21 tersedia. Jakarta Batch dipakai.

### 26.2 Wrong thinking

```text
Virtual threads are cheap, so process 200.000 records in parallel.
```

Hasil:

- registry 429,
- retry storm,
- job gagal,
- audit kacau,
- checkpoint tidak meaningful.

### 26.3 Correct thinking

Bottleneck bukan thread. Bottleneck adalah rate limit registry.

Desain:

```text
Jakarta Batch chunk step
  → reader reads records in pages
  → processor prepares enrichment request
  → writer stores enrichment intent/outbox transactionally
  → managed worker drains outbox at 250/minute
  → idempotency key = registryType + entityId + version
  → later reconciliation step updates status
```

Atau:

```text
Jakarta Batch partitioning
  → limited partitions
  → shared distributed rate limiter
  → checkpoint per partition
  → retry 429 with backoff and stop policy
```

Virtual threads bisa digunakan di worker untuk blocking HTTP call, tetapi tidak menentukan rate.

---

## 27. Anti-Patterns

### 27.1 Unmanaged virtual executor in application server

```java
private static final ExecutorService EXECUTOR = Executors.newVirtualThreadPerTaskExecutor();
```

Masalah:

- static lifecycle,
- redeploy leak,
- no container control,
- no managed context,
- hard to monitor.

### 27.2 Virtual thread as queue

```text
Create virtual thread for every job and let them wait.
```

Masalah:

- memory pressure,
- no durable state,
- no restart,
- no operator visibility.

Gunakan durable queue/job table/Jakarta Batch/messaging.

### 27.3 Unbounded fan-out

```java
ids.parallelStream().forEach(id -> callExternal(id));
```

Atau virtual equivalent tanpa limit.

Masalah:

- common pool/unmanaged execution,
- downstream overload,
- no fairness.

### 27.4 Blocking inside global lock

```java
synchronized (lock) {
    externalCall();
}
```

Masalah:

- serialization,
- pinning risk on Java 21,
- latency amplification.

### 27.5 Treating virtual threads as transaction propagation tool

Virtual threads tidak membuat transaction bisa aman dipakai lintas task.

Async task tetap harus punya transaction boundary sendiri.

---

## 28. Best Practices

1. Pakai virtual threads melalui **managed Jakarta Concurrency resources** jika berada di Jakarta EE container.
2. Gunakan virtual threads terutama untuk **I/O-bound blocking workloads**.
3. Tetap gunakan concurrency limit berdasarkan downstream capacity.
4. Jangan gunakan `ForkJoinPool.commonPool()` secara tidak sengaja dari `CompletableFuture`.
5. Jangan membuat unmanaged executor static di application server.
6. Jangan menyebarkan `EntityManager`, request object, session object, atau mutable contextual object ke virtual task.
7. Perlakukan async boundary sebagai transaction boundary.
8. Gunakan timeout di semua layer, bukan hanya future chain.
9. Desain cancellation cooperative.
10. Gunakan JFR/thread dump/metrics untuk memahami virtual thread behavior.
11. Uji shutdown/redeploy/pod termination.
12. Untuk batch, gunakan Jakarta Batch semantics; virtual threads hanya execution optimization.
13. Pisahkan read-only fan-out dari side-effecting workflow.
14. Simpan audit attribution eksplisit, jangan bergantung penuh pada propagated user session.
15. Load test dengan downstream lambat, bukan hanya happy path.

---

## 29. Checklist Evaluasi Sebelum Mengaktifkan Virtual Threads

### Runtime

- [ ] Running Java 21+ untuk virtual threads final.
- [ ] Target server mendukung Jakarta Concurrency 3.1 atau fitur managed virtual threads yang jelas.
- [ ] Tidak bergantung pada API preview tanpa keputusan sadar.
- [ ] JDBC driver dan HTTP client sudah diuji dengan virtual threads.

### Design

- [ ] Workload I/O-bound, bukan CPU-bound dominan.
- [ ] Resource bottleneck sudah diidentifikasi.
- [ ] Ada concurrency limit per bottleneck.
- [ ] Ada timeout budget per layer.
- [ ] Ada cancellation policy.
- [ ] Ada fallback/retry policy.
- [ ] Ada idempotency untuk side effect.

### Jakarta EE correctness

- [ ] Executor managed oleh container.
- [ ] Context propagation jelas.
- [ ] Security attribution eksplisit.
- [ ] Transaction boundary tidak melewati async task sembarangan.
- [ ] CDI proxy/interceptor dipakai benar.
- [ ] Tidak membawa request/session scoped object ke task jangka panjang.

### Operations

- [ ] Metrics tersedia.
- [ ] Logs punya correlation ID.
- [ ] Tracing async boundary tersedia.
- [ ] JFR/thread dump playbook tersedia.
- [ ] Rejection/timeout alert tersedia.
- [ ] Shutdown/redeploy sudah diuji.
- [ ] Spike/downstream failure sudah diuji.

---

## 30. Ringkasan Mental Model

Virtual threads menjawab:

```text
Can we afford many blocking concurrent tasks more cheaply?
```

Managed concurrency menjawab:

```text
Can the container safely own, observe, contextualize, govern, and terminate those tasks?
```

Batch menjawab:

```text
Can long-running, restartable, stateful processing be executed with checkpoint, status, retry, and operational control?
```

Jangan tertukar.

Formula yang sehat:

```text
Virtual thread = execution vehicle
Managed executor = container contract
Capacity control = stability mechanism
Transaction boundary = correctness mechanism
Idempotency = retry/restart safety
Observability = operational truth
Jakarta Batch = restartable workload model
```

Top-tier engineer tidak bertanya:

> “Apakah kita harus pakai virtual threads?”

Tetapi:

> “Workload mana yang bottleneck-nya platform-thread blocking, resource mana yang menjadi real limit, managed contract apa yang menjamin lifecycle/context, dan failure mode apa yang muncul setelah thread cost turun?”

---

## 31. Latihan / Thought Experiments

### Latihan 1 — Request fan-out

Sebuah endpoint memanggil 12 downstream service. Semua read-only. Rata-rata latency tiap service 200 ms. DB pool 40. External service ada yang rate limit 100/minute.

Jawab:

1. Apakah virtual threads cocok?
2. Berapa concurrency limit yang perlu ada?
3. Di mana timeout diletakkan?
4. Apakah perlu return partial response?
5. Apa metrik utama yang harus dipantau?

### Latihan 2 — Batch external sync

Batch 500.000 record perlu call API eksternal. API limit 300/minute. Business membutuhkan restart aman dan audit per record.

Jawab:

1. Apakah cukup memakai virtual-thread-per-task?
2. Apakah lebih cocok Jakarta Batch chunk, partition, outbox, atau messaging?
3. Bagaimana idempotency key dibuat?
4. Bagaimana checkpoint dirancang?
5. Bagaimana menangani 429?

### Latihan 3 — Java 17 to Java 21 migration

Aplikasi Jakarta EE berjalan Java 17, memakai `ManagedExecutorService` platform-backed, banyak timeout karena executor pool penuh saat external API lambat.

Jawab:

1. Apakah migrasi ke virtual threads cukup?
2. Apa yang harus diukur sebelum migrasi?
3. Bagaimana desain fallback jika server belum mendukung managed virtual executor?
4. Risiko apa yang muncul jika langsung memakai `Executors.newVirtualThreadPerTaskExecutor()`?

### Latihan 4 — Pinning investigation

Setelah migrasi Java 21, throughput tidak naik. Thread dump menunjukkan banyak virtual threads menunggu method synchronized yang melakukan HTTP call.

Jawab:

1. Apa masalah desainnya?
2. Apakah upgrade Java 24 menyelesaikan semua masalah?
3. Bagaimana refactor locking-nya?
4. Apa metrik/JFR event yang dicari?

---

## 32. Referensi

- Jakarta Concurrency 3.1 Specification — https://jakarta.ee/specifications/concurrency/3.1/
- Jakarta EE 11 Release — https://jakarta.ee/release/11/
- Jakarta Concurrency 3.0 Specification detail — https://jakarta.ee/specifications/concurrency/3.0/jakarta-concurrency-spec-3.0
- OpenJDK JEP 444: Virtual Threads — https://openjdk.org/jeps/444
- OpenJDK JEP 491: Synchronize Virtual Threads without Pinning — https://openjdk.org/jeps/491
- Oracle Java Documentation: Virtual Threads — https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html

---

## 33. Apa yang Dibahas Berikutnya

Part berikutnya akan membahas:

```text
Part 12 — Structured Concurrency and Scoped Values for Enterprise Java
File: 12-structured-concurrency-scoped-values-enterprise-java.md
```

Fokus berikutnya:

- structured concurrency sebagai model task tree,
- parent-child lifetime,
- cancellation yang terstruktur,
- failure aggregation,
- scoped values sebagai alternatif mental model untuk context immutable,
- bagaimana semua ini relevan untuk Jakarta EE, meskipun sebagian masih preview/berkembang di Java modern.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — CompletableFuture in Jakarta EE Without Breaking the Container](./10-completablefuture-in-jakarta-ee.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 12 — Structured Concurrency and Scoped Values for Enterprise Java](./12-structured-concurrency-scoped-values-enterprise-java.md)
