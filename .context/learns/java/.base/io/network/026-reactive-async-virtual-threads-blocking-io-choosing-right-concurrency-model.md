# Part 26 — Reactive, Async, Virtual Threads, and Blocking I/O: Choosing the Right Concurrency Model

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `026-reactive-async-virtual-threads-blocking-io-choosing-right-concurrency-model.md`  
> Target: Java 8 hingga Java 25  
> Level: Advanced / production systems engineering

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah masuk cukup dalam ke TCP, HTTP/1.1, HTTP/2, HTTP/3, REST, streaming HTTP, WebSocket, gRPC, gRPC streaming, dan Netty. Sekarang kita perlu menjawab pertanyaan yang sering membuat desain Java backend menjadi tidak konsisten:

> Untuk network I/O, kapan sebaiknya memakai blocking thread, asynchronous API, reactive stream, event-loop runtime, atau virtual threads?

Bagian ini bukan sekadar membandingkan syntax:

```java
httpClient.send(request, BodyHandlers.ofString());
httpClient.sendAsync(request, BodyHandlers.ofString());
webClient.get().retrieve().bodyToMono(String.class);
```

Pertanyaan yang lebih penting adalah:

1. Di mana concurrency disimpan?
2. Di mana queue terbentuk?
3. Siapa yang melakukan cancellation?
4. Siapa yang menjaga deadline?
5. Bagaimana backpressure dikirim balik?
6. Apa yang terjadi ketika dependency lambat?
7. Apa yang terlihat di thread dump, metrics, logs, traces?
8. Apa limit sebenarnya: thread, connection, stream, CPU, memory, remote QPS, atau database pool?

Seorang engineer biasa memilih model concurrency karena familiar. Engineer senior memilih karena framework. Engineer top-tier memilih karena **workload shape, failure mode, resource budget, observability, dan operational simplicity**.

---

## 1. Core Mental Model

Network concurrency bukan tujuan. Concurrency adalah cara untuk menunggu banyak hal sekaligus.

Network call biasanya menghabiskan waktu pada fase berikut:

```text
application scheduling
-> queue before execution
-> DNS
-> connection acquisition
-> TCP connect
-> TLS handshake
-> request serialization
-> write to socket
-> remote queue
-> remote processing
-> response first byte
-> response body transfer
-> deserialization
-> callback / continuation / thread resume
```

Concurrency model hanya menentukan **bagaimana Java menunggu fase-fase itu**.

Ada empat model besar:

```text
1. Blocking platform threads
2. Async/future/callback style
3. Reactive/event-loop style
4. Blocking virtual threads
```

Tidak ada model yang menghapus realitas ini:

```text
remote system tetap punya kapasitas
connection pool tetap terbatas
HTTP/2 max concurrent streams tetap terbatas
database pool tetap terbatas
rate limit tetap berlaku
bandwidth tetap terbatas
heap/off-heap tetap terbatas
payload tetap butuh parsing
retry tetap bisa menggandakan traffic
```

Jadi kesalahan desain terbesar adalah berpikir:

```text
"Kalau pakai async/reactive/virtual threads, capacity problem hilang."
```

Yang benar:

```text
Concurrency model mengubah biaya waiting dan struktur program.
Capacity tetap harus dikontrol eksplisit.
```

---

## 2. Vocabulary yang Harus Jelas

### 2.1 Concurrency

Concurrency adalah kemampuan menangani banyak pekerjaan yang progress-nya overlap.

Contoh:

```text
Request A menunggu service X
Request B menunggu database
Request C menunggu Kafka/gRPC response
```

Mereka tidak harus berjalan di CPU bersamaan. Mereka hanya overlap dalam waktu.

### 2.2 Parallelism

Parallelism adalah pekerjaan benar-benar berjalan bersamaan di banyak CPU core.

Contoh:

```text
CPU core 1 parsing JSON
CPU core 2 kompres payload
CPU core 3 menjalankan crypto
CPU core 4 menjalankan aggregation
```

Network I/O biasanya lebih butuh concurrency daripada parallelism.

CPU-heavy workload lebih butuh bounded parallelism.

### 2.3 Blocking

Blocking berarti thread yang menjalankan kode berhenti sampai operasi selesai.

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Thread tidak lanjut ke statement berikutnya sebelum response selesai atau gagal.

Blocking bukan selalu buruk. Yang buruk adalah blocking di tempat yang salah atau tanpa limit.

### 2.4 Non-blocking

Non-blocking berarti thread tidak menunggu operasi I/O selesai. Runtime mendaftarkan interest, lalu thread bisa mengerjakan hal lain.

Contoh runtime:

```text
Selector
Netty EventLoop
Reactor Netty
JDK HttpClient internal async machinery
```

Non-blocking bukan berarti tanpa thread. Ia berarti thread tidak dedicated menunggu satu operasi.

### 2.5 Async

Async berarti result datang nanti melalui callback/future/promise.

```java
CompletableFuture<HttpResponse<String>> future =
    client.sendAsync(request, BodyHandlers.ofString());
```

Async bisa dibangun di atas blocking thread pool atau non-blocking event loop. Jadi async adalah API style, bukan selalu transport model.

### 2.6 Reactive

Reactive di JVM biasanya mengacu pada model Publisher/Subscriber dengan demand/backpressure.

Core idenya:

```text
consumer meminta N item
producer hanya boleh mengirim sesuai demand
```

Reactive cocok untuk pipeline data asynchronous, streaming, dan komposisi event. Tapi reactive juga dapat menjadi kompleks jika hanya dipakai untuk request-response sederhana.

### 2.7 Event Loop

Event loop adalah thread yang memproses banyak event I/O.

```text
readable socket event
writable socket event
timer event
connection close event
callback continuation
```

Aturan emas:

```text
jangan blocking event loop.
```

Kalau event loop blocked, semua connection yang dimiliki event loop ikut terganggu.

### 2.8 Virtual Thread

Virtual thread adalah thread ringan yang dijadwalkan oleh JVM, bukan langsung satu OS thread per thread Java. Ia membuat blocking style jauh lebih murah untuk workload I/O-bound. Namun virtual thread tidak membuat remote dependency lebih cepat dan tidak menggantikan backpressure.

Oracle Java 25 documentation menjelaskan structured concurrency sebagai cara membagi task menjadi subtasks yang dikelompokkan dalam scope; subtasks dalam scope secara default berjalan pada virtual thread, sehingga error handling dan cancellation dapat dikelola sebagai satu unit kerja.

---

## 3. Model 1 — Blocking Platform Threads

### 3.1 Bentuk Dasar

```java
public OrderView loadOrder(String orderId) throws Exception {
    Customer customer = customerClient.getCustomer(orderId);
    Payment payment = paymentClient.getPayment(orderId);
    Shipment shipment = shipmentClient.getShipment(orderId);
    return assemble(customer, payment, shipment);
}
```

Atau server klasik:

```text
one request -> one platform thread
```

### 3.2 Kelebihan

```text
simple mental model
stack trace mudah dibaca
debugging mudah
transaction/correlation context lebih natural
cocok untuk aplikasi enterprise tradisional
mudah dipahami oleh banyak engineer
```

### 3.3 Kekurangan

```text
platform thread mahal dibanding virtual thread
thread pool mudah habis saat dependency lambat
banyak blocked thread meningkatkan memory footprint
context switch overhead bisa besar
butuh sizing thread pool hati-hati
```

### 3.4 Failure Mode Khas

```text
Dependency lambat
-> request thread blocked
-> thread pool penuh
-> queue request naik
-> latency naik
-> timeout client
-> retry meningkat
-> lebih banyak thread blocked
-> cascading failure
```

### 3.5 Kapan Masih Masuk Akal?

Blocking platform thread masih masuk akal untuk:

```text
traffic kecil/sedang
aplikasi internal sederhana
legacy Java 8 stack
sistem dengan dependency cepat dan stabil
batch/job dengan concurrency bounded
```

Namun untuk high-concurrency network workload, model ini harus diberi bulkhead kuat.

---

## 4. Model 2 — Async dengan Future / CompletableFuture

### 4.1 Bentuk Dasar

```java
CompletableFuture<Customer> customerF = customerClient.getCustomerAsync(orderId);
CompletableFuture<Payment> paymentF = paymentClient.getPaymentAsync(orderId);
CompletableFuture<Shipment> shipmentF = shipmentClient.getShipmentAsync(orderId);

return customerF.thenCombine(paymentF, PartialOrder::new)
        .thenCombine(shipmentF, OrderView::new);
```

Atau dengan JDK HTTP Client:

```java
CompletableFuture<HttpResponse<String>> future =
    client.sendAsync(request, HttpResponse.BodyHandlers.ofString());
```

### 4.2 Kelebihan

```text
bisa menjalankan beberapa I/O secara overlap
tidak memblokir caller thread
bagus untuk fan-out/fan-in kecil
tersedia sejak Java 8 melalui CompletableFuture
lebih ringan daripada dedicated platform thread per wait
```

### 4.3 Kekurangan

```text
error propagation bisa sulit dibaca
cancellation sering tidak lengkap
context propagation tidak otomatis
callback chain bisa kompleks
timeout/deadline mudah tercecer
stack trace lebih sulit
```

### 4.4 Kesalahan Umum

#### Kesalahan 1 — Async tapi Tetap Unbounded

```java
for (String id : ids) {
    futures.add(client.getAsync(id));
}
```

Jika `ids` berisi 100.000 item, ini bisa menciptakan 100.000 outstanding calls.

Async tidak berarti aman. Harus ada concurrency limit:

```text
max outstanding request
max per dependency
max per tenant/user/job
max queue size
max deadline
```

#### Kesalahan 2 — Blocking di Common ForkJoinPool

```java
CompletableFuture.supplyAsync(() -> blockingHttpCall());
```

Tanpa executor eksplisit, ini memakai common pool. Untuk blocking I/O, ini bisa mengganggu task lain.

Lebih aman:

```java
ExecutorService ioExecutor = Executors.newFixedThreadPool(100);
CompletableFuture.supplyAsync(() -> blockingHttpCall(), ioExecutor);
```

Pada Java modern, untuk I/O-bound blocking work, virtual thread executor sering lebih natural:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Result> f = executor.submit(() -> blockingHttpCall());
}
```

### 4.5 Kapan Cocok?

Async future cocok untuk:

```text
Java 8+ codebase
fan-out/fan-in terbatas
library client memang async
pipeline tidak terlalu panjang
butuh overlap beberapa remote call
```

Tapi untuk workflow besar, structured concurrency sering lebih mudah dipahami daripada callback chain.

---

## 5. Model 3 — Reactive / Event-Loop

### 5.1 Bentuk Dasar

Dengan Reactor/WebFlux style:

```java
Mono<OrderView> result =
    Mono.zip(
        customerClient.getCustomer(orderId),
        paymentClient.getPayment(orderId),
        shipmentClient.getShipment(orderId)
    ).map(tuple -> assemble(tuple.getT1(), tuple.getT2(), tuple.getT3()));
```

Untuk streaming:

```java
Flux<Event> events = eventClient.streamEvents(caseId)
    .filter(Event::isRelevant)
    .bufferTimeout(100, Duration.ofSeconds(1))
    .flatMap(batch -> processBatch(batch), 8);
```

### 5.2 Kelebihan

```text
backpressure-aware abstraction
cocok untuk streaming data
cocok untuk high concurrency dengan sedikit thread
cocok ketika seluruh stack non-blocking
bisa mengontrol demand, buffer, retry, timeout dalam pipeline
baik untuk gateway/proxy/stream processing
```

Project Reactor mendeskripsikan Reactor sebagai fondasi reactive non-blocking untuk JVM dengan demand management/backpressure.

### 5.3 Kekurangan

```text
learning curve tinggi
stack trace/correlation lebih sulit jika tidak diinstrumentasi
blocking kecil di event loop bisa merusak banyak connection
context propagation perlu disiplin
operator misuse dapat menyebabkan bug halus
business workflow imperative kadang menjadi tidak natural
```

### 5.4 Aturan Emas Reactive/Event Loop

```text
1. Jangan blocking event loop.
2. Jangan memanggil JDBC blocking langsung di event loop.
3. Jangan melakukan CPU-heavy work di event loop.
4. Gunakan scheduler/offload eksplisit untuk blocking/CPU-heavy work.
5. Batasi concurrency pada flatMap/merge.
6. Batasi buffer.
7. Definisikan timeout dan cancellation.
8. Instrumentasi context propagation.
```

### 5.5 Event Loop Blocking Hazard

Misal satu event loop menangani banyak connection:

```text
EventLoop-1:
  connection A
  connection B
  connection C
  connection D
```

Jika handler connection A menjalankan blocking database query selama 2 detik, maka event untuk B/C/D juga tertunda.

Akibatnya:

```text
latency semua connection naik
heartbeat tertunda
read/write event tertunda
timeout palsu muncul
backpressure tidak diproses tepat waktu
```

### 5.6 Kapan Cocok?

Reactive/event-loop cocok untuk:

```text
API gateway
streaming HTTP/SSE/WebSocket/gRPC streaming
high fan-in/fan-out network service
service dengan banyak idle connection
non-blocking database/client stack end-to-end
pipeline event dengan backpressure
```

Reactive kurang ideal jika:

```text
team belum matang reactive
stack masih mayoritas blocking
workflow dominan request-response sederhana
observability belum siap
error handling domain kompleks tapi pipeline kecil
```

---

## 6. Model 4 — Blocking dengan Virtual Threads

### 6.1 Bentuk Dasar

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Customer> customerF = executor.submit(() -> customerClient.getCustomer(orderId));
    Future<Payment> paymentF = executor.submit(() -> paymentClient.getPayment(orderId));
    Future<Shipment> shipmentF = executor.submit(() -> shipmentClient.getShipment(orderId));

    return assemble(customerF.get(), paymentF.get(), shipmentF.get());
}
```

Atau dalam server framework yang mendukung virtual thread per request:

```text
one request -> one virtual thread
```

### 6.2 Apa yang Berubah?

Sebelum virtual threads:

```text
blocking I/O = satu OS/platform thread parkir
banyak concurrent blocking calls = banyak platform threads
```

Dengan virtual threads:

```text
blocking I/O = virtual thread parkir
carrier/platform thread bisa menjalankan virtual thread lain
```

Artinya blocking style menjadi jauh lebih scalable untuk I/O-bound workload.

### 6.3 Apa yang Tidak Berubah?

```text
connection pool tetap terbatas
remote QPS tetap terbatas
rate limit tetap terbatas
database pool tetap terbatas
CPU parsing tetap butuh core
heap tetap terbatas
payload besar tetap mahal
synchronized pinning bisa menjadi masalah
native/blocking operation tertentu bisa pin carrier thread
```

Virtual threads membuat waiting murah, bukan membuat dependency unlimited.

### 6.4 Virtual Threads vs Reactive

Virtual threads unggul dalam:

```text
readability
imperative workflow
stack trace lebih natural
migration dari blocking code
request-response service
fan-out/fan-in dengan structured concurrency
```

Reactive unggul dalam:

```text
streaming backpressure end-to-end
event-driven pipelines
gateway/proxy workloads
mengelola banyak stream dengan demand control
stack yang sudah non-blocking penuh
```

### 6.5 Hidden Trap: Unbounded Virtual Threads

Kode berikut terlihat bersih:

```java
for (String id : ids) {
    Thread.startVirtualThread(() -> callRemote(id));
}
```

Tetapi jika `ids` berisi 1 juta, kamu tetap menciptakan 1 juta outstanding attempts.

Masalahnya pindah dari thread cost ke:

```text
remote overload
connection pool queue
memory untuk continuation/task state
timeout storm
retry storm
rate limit violation
```

Jadi tetap butuh limiter:

```java
Semaphore permits = new Semaphore(100);

for (String id : ids) {
    Thread.startVirtualThread(() -> {
        try {
            permits.acquire();
            callRemote(id);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            permits.release();
        }
    });
}
```

### 6.6 Kapan Cocok?

Virtual threads cocok untuk:

```text
Java 21+ / 25 applications
blocking HTTP/gRPC/JDBC style
request-response service
fan-out/fan-in business workflow
legacy migration dari servlet blocking
meningkatkan concurrency tanpa reactive rewrite
```

Tidak cukup sendiri untuk:

```text
unbounded streaming
fine-grained backpressure
event-loop protocol gateway
CPU-heavy parallel computation
dependencies dengan limit ketat tanpa limiter
```

---

## 7. Structured Concurrency: Dari “Spawn Banyak Task” ke “Satu Unit Kerja”

### 7.1 Masalah Fan-Out Biasa

Misal request membutuhkan tiga remote calls:

```text
GET /case/{id}/summary
  -> case service
  -> applicant service
  -> compliance service
```

Dengan future biasa, masalah yang sering muncul:

```text
satu call gagal tapi call lain tetap jalan
request sudah timeout tapi subtasks masih hidup
cancellation tidak dipropagate
deadline tidak konsisten
trace/log context hilang
error aggregation berantakan
```

### 7.2 Structured Concurrency Mental Model

Structured concurrency memperlakukan subtasks sebagai anak dari satu parent task.

```text
parent request scope
  ├── subtask A
  ├── subtask B
  └── subtask C
```

Invariant-nya:

```text
parent tidak selesai sebelum anak-anaknya selesai/dibatalkan
jika policy menghendaki fail-fast, sibling dapat dibatalkan
lifetime subtasks bounded oleh scope
error handling dan cancellation menjadi eksplisit
```

Oracle Java 25 documentation menjelaskan bahwa structured concurrency membagi task menjadi subtasks yang harus selesai sebelum task berlanjut, dan subtasks dikelompokkan dalam scope.

### 7.3 Kenapa Penting untuk Network Calls?

Network fan-out tanpa structured lifetime bisa menyebabkan:

```text
orphan request
wasted remote work
connection leak
trace yang tetap berjalan setelah parent gagal
retry yang tidak perlu
inconsistent cancellation
```

Structured concurrency membuat network workflow lebih mirip state machine:

```text
START
-> fork subtasks
-> wait with deadline
-> if all success: combine
-> if any fatal failure: cancel siblings
-> if timeout: cancel all
-> close scope
```

### 7.4 Contoh Konseptual

```java
// Pseudocode style; API detail dapat berubah karena Structured Concurrency masih preview di Java 25.
try (var scope = StructuredTaskScope.open()) {
    var customer = scope.fork(() -> customerClient.getCustomer(id));
    var payment  = scope.fork(() -> paymentClient.getPayment(id));
    var shipment = scope.fork(() -> shipmentClient.getShipment(id));

    scope.join();

    return assemble(customer.get(), payment.get(), shipment.get());
}
```

Yang penting bukan syntax. Yang penting adalah invariants:

```text
subtasks punya lifetime jelas
join point eksplisit
cancellation policy eksplisit
result/error aggregation eksplisit
```

### 7.5 Java 25 Status

Di Java 25, structured concurrency masih preview API melalui JEP 505. Scoped Values sudah difinalisasi melalui JEP 506, dan dirancang untuk berbagi immutable context secara aman dan efisien dengan callee serta child threads.

Untuk production, implikasinya:

```text
virtual threads stable sejak Java 21
ScopedValue final di Java 25
Structured Concurrency di Java 25 masih preview
gunakan preview API hanya jika organisasi siap dengan --enable-preview dan risiko perubahan API
untuk production conservative, gunakan ExecutorService + explicit cancellation + deadline wrapper
```

---

## 8. Scoped Values vs ThreadLocal untuk Context Propagation

### 8.1 Masalah Context di Network Systems

Dalam networked Java service, kita sering perlu membawa:

```text
correlation id
trace id
tenant id
user id / actor id
request deadline
authorization decision context
locale
idempotency key
```

Cara klasik:

```java
ThreadLocal<RequestContext> REQUEST_CONTEXT = new ThreadLocal<>();
```

Masalahnya:

```text
leak jika tidak clear
sulit dengan thread reuse
sulit dengan async callback
dapat menyimpan mutable state terlalu lama
virtual threads membuat jumlah thread sangat banyak sehingga ThreadLocal harus dipakai hati-hati
```

### 8.2 Scoped Value Mental Model

Scoped value adalah immutable context untuk lifetime bounded.

```text
within scope:
  context tersedia
outside scope:
  context tidak tersedia
```

Java 25 documentation menjelaskan ScopedValue sebagai cara membagikan value secara aman dan efisien ke method tanpa parameter eksplisit.

### 8.3 Implikasi untuk Network Client Wrapper

Idealnya client wrapper tidak membaca global mutable state sembarangan. Lebih baik:

```text
request context eksplisit
atau scoped immutable context
```

Contoh desain:

```java
record RequestContext(
    String correlationId,
    Instant deadline,
    String actorId,
    String tenantId
) {}
```

Lalu network client memakai context untuk:

```text
set header correlation id
set deadline/timeout
set audit actor
set tenant boundary
set trace attributes
```

---

## 9. Decision Framework: Memilih Model Concurrency

### 9.1 Pertanyaan Pertama: Workload Shape

| Workload | Model yang Biasanya Cocok |
|---|---|
| Request-response sederhana | Blocking + virtual threads atau blocking platform threads bounded |
| Banyak remote fan-out per request | Virtual threads + structured concurrency / CompletableFuture dengan cancellation disiplin |
| Streaming event high-volume | Reactive/event-loop atau gRPC streaming dengan manual flow control |
| Gateway/proxy | Netty/Reactor/event-loop |
| Legacy Java 8 enterprise | Blocking + bounded pools / CompletableFuture hati-hati |
| Java 21/25 service baru | Virtual threads untuk request-response; reactive untuk streaming/gateway |
| CPU-heavy computation | Bounded platform thread pool / ForkJoin / parallelism eksplisit |
| Long-lived WebSocket/SSE | Event-loop/reactive sering lebih natural, tapi blocking bisa jika concurrency kecil dan resource cukup |
| Batch calling external API | Virtual threads + semaphore/rate limiter/deadline/retry budget |

### 9.2 Pertanyaan Kedua: Apakah Stack End-to-End Non-blocking?

Reactive hanya optimal jika sebagian besar stack non-blocking:

```text
HTTP server non-blocking
HTTP client non-blocking
DB driver non-blocking atau offloaded
cache client non-blocking
message client non-blocking
serialization tidak CPU-heavy di event loop
```

Jika satu bagian blocking dan tidak di-offload, event loop bisa rusak.

### 9.3 Pertanyaan Ketiga: Apakah Butuh Backpressure Nyata?

Jika workload streaming dan producer bisa lebih cepat daripada consumer, kamu butuh backpressure.

Contoh:

```text
export 10 juta rows
consume gRPC stream dari upstream
WebSocket fan-out ke ribuan clients
read file besar dan upload ke object storage
```

Reactive/event-loop/gRPC manual flow control lebih cocok dibanding naive virtual thread per item.

### 9.4 Pertanyaan Keempat: Apa Failure Mode Dominan?

Jika failure dominan adalah:

```text
dependency lambat -> gunakan deadline, bulkhead, circuit breaker, virtual threads boleh
slow consumer -> gunakan backpressure/event-loop/manual flow control
CPU saturation -> gunakan bounded CPU pool
connection pool starvation -> tuning pool + concurrency limiter
retry storm -> retry budget + jitter + idempotency
context propagation bugs -> ScopedValue / explicit context / instrumentation
```

### 9.5 Pertanyaan Kelima: Apa Skill dan Operability Team?

Model yang secara teori optimal bisa buruk jika team tidak bisa mengoperasikannya.

Pertimbangkan:

```text
apakah engineer bisa membaca reactive stack trace?
apakah observability context propagation sudah siap?
apakah thread dump model mudah dipahami?
apakah production incident bisa didiagnosis cepat?
apakah testing failure/cancellation sudah matang?
```

Top-tier engineering bukan memilih teknologi paling advanced. Top-tier engineering memilih model paling aman untuk workload dan organisasi.

---

## 10. Concurrency Model dan Resource Budget

### 10.1 Formula Dasar Outstanding Work

Untuk sebuah dependency:

```text
outstanding_calls ≈ arrival_rate × latency
```

Jika service menerima 1000 request/second, dan tiap request memanggil dependency X yang latency-nya 200 ms:

```text
outstanding_calls ≈ 1000 × 0.2 = 200
```

Jika latency X naik ke 2 detik:

```text
outstanding_calls ≈ 1000 × 2 = 2000
```

Concurrency model hanya menentukan apakah 2000 outstanding calls itu memakan 2000 platform threads, virtual threads, futures, stream states, atau event-loop state. Tetapi 2000 outstanding calls tetap menekan:

```text
connection pool
remote service
memory
queues
timeout system
observability pipeline
```

### 10.2 Bulkhead Tetap Wajib

Untuk setiap remote dependency:

```text
max concurrent calls
max queued calls
max request body size
max response body size
max retry attempts
max total deadline
max rate
```

Contoh:

```java
class DependencyLimiter {
    private final Semaphore permits = new Semaphore(100);

    <T> T call(Callable<T> action) throws Exception {
        if (!permits.tryAcquire(50, TimeUnit.MILLISECONDS)) {
            throw new DependencyBusyException("dependency concurrency limit reached");
        }
        try {
            return action.call();
        } finally {
            permits.release();
        }
    }
}
```

Dengan virtual threads, semaphore seperti ini makin penting karena thread tidak lagi menjadi natural bottleneck.

---

## 11. Cancellation Semantics

### 11.1 Cancellation Harus Punya Efek Nyata

Cancellation bukan hanya:

```java
future.cancel(true);
```

Pertanyaannya:

```text
apakah HTTP request benar-benar dibatalkan?
apakah socket/stream ditutup?
apakah gRPC Context dibatalkan?
apakah remote server tahu client sudah pergi?
apakah database query dihentikan?
apakah child tasks ikut berhenti?
apakah response body tidak lagi dibaca?
```

### 11.2 Cancellation di Blocking Model

Blocking code biasanya memakai interruption:

```java
Thread.currentThread().interrupt();
```

Tapi tidak semua I/O merespons interrupt dengan cara yang sama. Deadline/timeout di client library tetap perlu.

### 11.3 Cancellation di CompletableFuture

`CompletableFuture.cancel()` sering hanya mengubah state future. Tergantung library, underlying I/O bisa atau tidak bisa dihentikan.

Jadi wrapper harus memastikan:

```text
cancel future
abort request jika didukung
close body stream jika sudah ada
propagate deadline ke downstream
```

### 11.4 Cancellation di Reactive

Reactive punya cancellation signal dari subscriber ke publisher. Tapi operator chain dan library harus menghormatinya.

Pertanyaan:

```text
apakah upstream berhenti produce?
apakah buffer dibuang?
apakah network subscription dibatalkan?
apakah cleanup dijalankan?
```

### 11.5 Cancellation di gRPC

gRPC punya cancellation semantics jelas: client cancellation/deadline dapat membatalkan RPC, dan server sebaiknya menghentikan computation yang tidak lagi diperlukan.

Untuk streaming, cancellation harus diperlakukan sebagai lifecycle event, bukan error biasa.

---

## 12. Timeout dan Deadline dalam Berbagai Model

### 12.1 Blocking

```java
HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(Duration.ofSeconds(2))
    .GET()
    .build();

HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Mudah dibaca, tetapi fan-out perlu deadline bersama.

### 12.2 Async

```java
client.sendAsync(request, BodyHandlers.ofString())
    .orTimeout(2, TimeUnit.SECONDS)
    .exceptionally(ex -> fallback());
```

Hati-hati: `orTimeout` membatasi future, tetapi pastikan underlying operation juga berhenti atau tidak menjadi orphan.

### 12.3 Reactive

```java
webClient.get()
    .uri("/cases/{id}", id)
    .retrieve()
    .bodyToMono(CaseDto.class)
    .timeout(Duration.ofSeconds(2));
```

Pastikan timeout operator menyebabkan cancellation ke upstream.

### 12.4 Virtual Threads + Structured Deadline

```text
request deadline = now + 2s
subcall A gets remaining budget
subcall B gets remaining budget
subcall C gets remaining budget
scope cancels all when deadline expires
```

Deadline harus menjadi bagian dari request context, bukan angka acak di tiap client.

---

## 13. Backpressure dalam Berbagai Model

### 13.1 Blocking Backpressure

Blocking model punya backpressure kasar:

```text
thread pool penuh
queue penuh
semaphore penuh
socket write blocking
```

Ini sederhana, tapi sering terlambat terlihat.

### 13.2 Async Backpressure

Async tidak punya backpressure otomatis. Kamu harus membuat limiter:

```text
semaphore
bounded queue
rate limiter
windowed execution
batch size
```

### 13.3 Reactive Backpressure

Reactive punya demand signal, tetapi hanya efektif jika semua operator dan source menghormatinya.

Risk:

```text
unbounded buffer
flatMap concurrency terlalu tinggi
source tidak backpressure-aware
blocking source di event loop
```

### 13.4 Virtual Thread Backpressure

Virtual thread membuat blocking murah, sehingga backpressure natural dari thread starvation berkurang. Ini bagus untuk throughput, tapi berbahaya jika tidak ada limit eksplisit.

Gunakan:

```text
Semaphore
RateLimiter
bounded Executor wrapper
connection pool limits
per-dependency bulkhead
queue rejection
```

---

## 14. Observability per Model

### 14.1 Blocking Platform Threads

Mudah dilihat di thread dump:

```text
many threads blocked on socket read
many threads waiting for pool acquisition
many threads waiting for database
```

Metrics wajib:

```text
thread pool active/queued/rejected
request latency
dependency latency
timeout count
pool acquisition latency
```

### 14.2 Async/Future

Yang perlu terlihat:

```text
future created/completed/failed/cancelled
executor queue size
callback latency
timeout vs underlying cancellation
orphan operation count
```

### 14.3 Reactive/Event Loop

Yang perlu terlihat:

```text
event loop pending tasks
event loop blocked time
operator latency
buffer size
dropped/cancelled signals
scheduler queue
connection provider metrics
```

### 14.4 Virtual Threads

Yang perlu terlihat:

```text
virtual thread count
carrier/platform thread count
pinned virtual threads
blocked virtual threads by dependency
semaphore wait time
connection pool queue
deadline cancellation count
```

Thread dump dengan virtual threads bisa besar. Butuh profiling/observability yang mendukung virtual thread awareness.

---

## 15. Java 8 hingga Java 25: Evolution Map

### 15.1 Java 8

Available mainstream tools:

```text
CompletableFuture
ExecutorService
ForkJoinPool
blocking I/O
NIO Selector
third-party clients: Apache HttpClient, OkHttp, Netty
reactive libraries muncul/berkembang
```

Design implication:

```text
pakai bounded thread pools untuk blocking
pakai CompletableFuture hati-hati
pakai Netty/Reactor jika butuh non-blocking serius
```

### 15.2 Java 11

JDK `HttpClient` menjadi standard.

Implication:

```text
standard HTTP/1.1 and HTTP/2 client
sync and async API
BodyPublisher/BodyHandler abstraction
```

### 15.3 Java 17

LTS yang banyak dipakai enterprise.

Implication:

```text
belum punya final virtual threads
masih banyak stack memakai platform threads / reactive
```

### 15.4 Java 21

Virtual threads menjadi final.

Implication:

```text
blocking I/O style menjadi scalable untuk banyak service
migration path dari servlet/JDBC/blocking HTTP menjadi lebih realistis
```

### 15.5 Java 25

Relevant items:

```text
Scoped Values final
Structured Concurrency fifth preview
JDK HttpClient tetap HTTP/1.1 dan HTTP/2
modern Java concurrency story semakin matang
```

Implication:

```text
gunakan virtual threads untuk banyak request-response workload
gunakan ScopedValue untuk immutable context bila sesuai
gunakan structured concurrency dengan perhatian status preview
reactive tetap relevan untuk streaming/gateway/backpressure-heavy systems
```

---

## 16. Design Patterns

### 16.1 Imperative Client Wrapper dengan Virtual Threads

```java
public final class RemoteCaseClient {
    private final HttpClient http;
    private final Semaphore concurrency = new Semaphore(100);

    public CaseDto getCase(String caseId, RequestContext ctx) throws Exception {
        if (!concurrency.tryAcquire(50, TimeUnit.MILLISECONDS)) {
            throw new DependencyBusyException("case-service busy");
        }
        try {
            Duration timeout = ctx.remainingBudgetOr(Duration.ofSeconds(2));
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://case-service/cases/" + caseId))
                .timeout(timeout)
                .header("X-Correlation-Id", ctx.correlationId())
                .GET()
                .build();

            HttpResponse<String> response = http.send(request, BodyHandlers.ofString());
            return mapResponse(response);
        } finally {
            concurrency.release();
        }
    }
}
```

Mental model:

```text
blocking style for readability
virtual threads for cheap waiting
semaphore for resource protection
request timeout from deadline
explicit context propagation
```

### 16.2 CompletableFuture Fan-Out with Limit

```java
public CompletableFuture<OrderView> loadOrder(String orderId) {
    CompletableFuture<Customer> c = customerClient.get(orderId);
    CompletableFuture<Payment> p = paymentClient.get(orderId);
    CompletableFuture<Shipment> s = shipmentClient.get(orderId);

    return CompletableFuture.allOf(c, p, s)
        .thenApply(ignored -> assemble(c.join(), p.join(), s.join()));
}
```

Production wrapper must add:

```text
timeout
cancellation
context propagation
exception mapping
concurrency limiter
trace span
```

### 16.3 Reactive Streaming Pipeline

```java
Flux<CaseEvent> stream = caseEventClient.stream(caseId)
    .timeout(Duration.ofSeconds(30))
    .onBackpressureBuffer(1000)
    .flatMap(event -> process(event), 16)
    .doOnCancel(() -> log.info("stream cancelled"));
```

Production questions:

```text
What happens when buffer is full?
Is process(event) blocking?
Does timeout cancel upstream?
What is max in-flight work?
How are errors represented?
How is resume implemented?
```

### 16.4 Event Loop + Offload Pattern

```text
Netty EventLoop:
  parse frame
  validate cheap headers
  hand off blocking/business work to worker pool
  write response asynchronously
```

Invariant:

```text
event loop never waits for database, file system, external blocking HTTP call, or CPU-heavy transformation
```

---

## 17. Anti-Patterns

### 17.1 “Reactive Everywhere” Without Backpressure Understanding

Reactive syntax tanpa bounded demand bisa tetap overload.

```text
Flux.fromIterable(hugeList)
    .flatMap(id -> callRemote(id)) // no concurrency limit
```

Better:

```text
flatMap(id -> callRemote(id), 32)
```

### 17.2 Virtual Thread per Item Without Limiter

```text
1 million items -> 1 million virtual threads -> 1 million remote attempts
```

Virtual threads reduce thread cost, not business risk.

### 17.3 Blocking Inside Event Loop

```text
Netty/Reactor handler calls JDBC/blocking HTTP/file read directly
```

Impact:

```text
all connections on same event loop suffer
```

### 17.4 Async Without Cancellation

```text
parent request timeout
child futures keep running
remote work continues
resources wasted
```

### 17.5 Common Pool Abuse

```java
CompletableFuture.supplyAsync(() -> blockingCall());
```

Without explicit executor, this may interfere with unrelated tasks.

### 17.6 Treating Timeout as Same as Cancellation

Timeout observed by caller does not guarantee underlying call stopped.

Always ask:

```text
what resource was released?
what remote work was cancelled?
what socket/stream/body was closed?
```

### 17.7 Using Concurrency Model as Architecture Religion

Bad thinking:

```text
reactive is always better
virtual threads replace reactive
blocking is obsolete
async is faster
```

Better thinking:

```text
choose based on workload, failure mode, backpressure need, team skill, and observability
```

---

## 18. Case Study 1 — Case Summary API Fan-Out

### Scenario

```text
GET /cases/{caseId}/summary
```

Needs:

```text
case details
applicant profile
latest compliance flags
payment status
open tasks
```

### Bad Design

```text
sequential calls
no deadline
no cancellation
no fallback
no per-dependency limit
```

Failure:

```text
payment service slow
-> summary API waits too long
-> request threads/virtual threads accumulate
-> clients retry
-> compliance service also gets extra load
```

### Better Design

```text
request deadline: 2s
fan-out with structured lifetime
per-dependency concurrency limit
critical vs optional dependency distinction
cancel siblings when request is no longer useful
return partial summary only if contract allows
```

Concurrency model options:

```text
Java 8: CompletableFuture + explicit executor + cancellation wrapper
Java 17: CompletableFuture / reactive depending stack
Java 21/25: virtual threads + structured-like scope + deadlines
```

---

## 19. Case Study 2 — High-Volume Export Stream

### Scenario

```text
Export 5 million audit records to client
```

### Bad Design

```text
load all rows into memory
serialize giant JSON array
write response at once
```

Failure:

```text
heap pressure
GC storm
client slow causes server memory growth
connection timeout
partial export impossible to resume
```

### Better Design

```text
cursor-based read
bounded batch
stream NDJSON/CSV/chunks
checksum / sequence number
client cancellation detection
resume token
backpressure-aware write
```

Concurrency model:

```text
Reactive/event-loop if stack supports streaming and backpressure
Blocking virtual thread can work if write blocks naturally and concurrency is bounded
Avoid unbounded buffering in either model
```

---

## 20. Case Study 3 — WebSocket Notification Gateway

### Scenario

```text
10,000 connected users
case update notifications
some clients fast, some clients slow
```

### Bad Design

```text
one unbounded queue per client
broadcast synchronously
no heartbeat
no disconnect slow consumers
no resume snapshot
```

Failure:

```text
slow client accumulates messages
heap grows
broadcast latency increases
server dies
```

### Better Design

```text
event-loop WebSocket runtime
bounded per-session queue
drop/coalesce policy for non-critical events
heartbeat
slow consumer disconnect
snapshot-on-reconnect
sticky session or external pub/sub
```

Concurrency model:

```text
Event-loop/reactive often natural
Virtual thread per session may be simpler for small scale but must be bounded carefully
```

---

## 21. Practical Selection Matrix

| Criterion | Blocking Platform Threads | CompletableFuture | Reactive/Event Loop | Virtual Threads |
|---|---:|---:|---:|---:|
| Readability | High | Medium | Low-Medium | High |
| Java 8 support | Yes | Yes | Yes via libraries | No |
| High idle concurrency | Expensive | Good | Excellent | Excellent |
| Streaming backpressure | Coarse | Manual | Strong | Manual/coarse |
| Debug stack trace | Easy | Medium-Hard | Hard | Easy-Medium |
| Cancellation discipline | Manual | Manual | Built-in signal, still needs care | Manual/structured |
| Works with blocking libraries | Yes | With executor | Only via offload | Yes |
| Gateway/proxy workload | Poor-Medium | Medium | Excellent | Medium-Good |
| Business workflow clarity | High | Medium | Low-Medium | High |
| Team learning curve | Low | Medium | High | Medium |
| Risk of unbounded work | Medium | High | High if misused | High if misused |

---

## 22. Engineering Rules of Thumb

### Rule 1 — Start with Workload Shape

Do not ask:

```text
Should we use reactive or virtual threads?
```

Ask:

```text
Is this request-response, streaming, gateway, fan-out, CPU-heavy, or batch workload?
```

### Rule 2 — Limit at the Dependency Boundary

Every dependency client should have:

```text
max concurrency
max queue
timeout/deadline
retry budget
circuit breaker or load shedding
metrics
```

### Rule 3 — Event Loops Must Stay Clean

If event loop exists:

```text
never block it
never run CPU-heavy work there
never call blocking JDBC/HTTP/file there
```

### Rule 4 — Virtual Threads Need Bulkheads

Virtual threads make blocking code scalable. They also make overload easier if you forget limiters.

### Rule 5 — Async Needs Cancellation

Async without cancellation is just orphan work with nicer syntax.

### Rule 6 — Reactive Needs Demand Discipline

Reactive without bounded demand/backpressure is just callback code with different names.

### Rule 7 — Deadline Beats Timeout Scatter

Use one request deadline and derive subcall timeouts from remaining budget.

### Rule 8 — Observability Must Match Runtime

Different model needs different operational lens:

```text
thread dumps for blocking
executor metrics for futures
event-loop metrics for reactive
virtual thread/pinning metrics for Loom-style apps
```

---

## 23. Checklist: Choosing the Right Model for a New Java Service

### 23.1 Workload

```text
[ ] Mostly request-response?
[ ] Mostly streaming?
[ ] Mostly gateway/proxy?
[ ] Mostly batch external calls?
[ ] Mostly CPU-heavy?
[ ] Mostly long-lived connections?
```

### 23.2 Runtime and Version

```text
[ ] Java 8, 11, 17, 21, or 25?
[ ] Virtual threads available?
[ ] Structured concurrency allowed as preview?
[ ] ScopedValue usable?
[ ] Framework supports virtual threads cleanly?
[ ] Client libraries are blocking or async/non-blocking?
```

### 23.3 Dependency Limits

```text
[ ] Per-dependency max concurrency?
[ ] Connection pool size?
[ ] HTTP/2 max concurrent streams?
[ ] DB pool size?
[ ] External API rate limit?
[ ] Retry budget?
[ ] Timeout budget?
```

### 23.4 Backpressure

```text
[ ] Can producer outrun consumer?
[ ] Are buffers bounded?
[ ] What happens when buffer full?
[ ] Is cancellation propagated upstream?
[ ] Is slow consumer disconnected/throttled?
```

### 23.5 Observability

```text
[ ] Can we see queue length?
[ ] Can we see outstanding calls?
[ ] Can we see cancellations?
[ ] Can we see event loop blocked time?
[ ] Can we see virtual thread pinning?
[ ] Can we see per-dependency latency histogram?
[ ] Can we correlate logs/traces across async boundaries?
```

---

## 24. Exercises

### Exercise 1 — Classify Workloads

Untuk setiap kasus, pilih model concurrency awal dan jelaskan alasannya:

```text
1. Internal CRUD service with JDBC and REST calls
2. API gateway routing to 30 downstream services
3. Audit export of 20 million rows
4. WebSocket live notification service
5. Batch job calling external API for 500k records
6. gRPC bidi worker coordination service
7. Case summary API with 5 parallel downstream calls
```

Jangan hanya jawab model. Sertakan:

```text
resource limit
failure mode
timeout/deadline strategy
observability metric
```

### Exercise 2 — Find the Hidden Queue

Cari queue tersembunyi dalam arsitektur berikut:

```text
Client
-> ALB
-> Java service with virtual threads
-> JDK HttpClient
-> HTTP/2 remote service
-> database
```

Petunjuk:

```text
ALB queue?
server accept queue?
virtual thread scheduling?
semaphore?
connection pool?
HTTP/2 stream queue?
remote worker queue?
database pool queue?
```

### Exercise 3 — Rewrite Unbounded Async

Kode:

```java
List<CompletableFuture<Result>> futures = ids.stream()
    .map(id -> client.callAsync(id))
    .toList();

return futures.stream().map(CompletableFuture::join).toList();
```

Tugas:

```text
Tambahkan max concurrency.
Tambahkan deadline global.
Tambahkan cancellation saat salah satu fatal error.
Tambahkan metrics outstanding calls.
```

### Exercise 4 — Reactive Blocking Audit

Di pipeline WebFlux, cari bagian yang blocking:

```java
return webClient.get()
    .uri("/cases/{id}", id)
    .retrieve()
    .bodyToMono(CaseDto.class)
    .map(dto -> jdbcRepository.save(dto))
    .map(saved -> mapper.toView(saved));
```

Tugas:

```text
Jelaskan kenapa ini berbahaya.
Berikan versi yang aman.
Jelaskan trade-off-nya.
```

### Exercise 5 — Virtual Thread Bulkhead

Desain batch processor Java 25:

```text
Input: 1 juta case IDs
For each ID: call external REST API
External limit: 300 requests/minute
Max latency: 2 seconds per call
Retry: max 2 attempts for transient failure
```

Tugas:

```text
Gunakan virtual threads.
Tambahkan rate limiter.
Tambahkan semaphore.
Tambahkan retry budget.
Tambahkan idempotency key.
Tambahkan progress checkpoint.
```

---

## 25. Ringkasan

Concurrency model adalah cara Java menunggu network I/O. Ia bukan pengganti capacity planning.

Blocking platform threads sederhana tetapi mahal untuk high concurrency. CompletableFuture memberi overlap tetapi mudah kehilangan cancellation dan context. Reactive/event-loop sangat kuat untuk streaming dan backpressure, tetapi membutuhkan disiplin tinggi dan stack non-blocking. Virtual threads mengembalikan readability blocking style untuk I/O-bound workload, tetapi tetap membutuhkan limiter, deadline, dan resource accounting.

Mental model yang harus dibawa:

```text
Concurrency model decides how waiting is represented.
Resource limits decide whether the system survives.
Deadlines decide when work stops.
Backpressure decides whether producers respect consumers.
Observability decides whether humans can debug it.
```

Untuk Java 8–25:

```text
Java 8: bounded blocking pools + CompletableFuture + Netty/Reactor when needed
Java 11: JDK HttpClient adds standard sync/async HTTP/1.1 and HTTP/2 client
Java 17: mature enterprise baseline, still mostly platform-thread/reactive
Java 21: virtual threads make blocking I/O scalable for many workloads
Java 25: Scoped Values final, Structured Concurrency preview, modern concurrency model becomes more coherent
```

---

## 26. Referensi

- Oracle Java 25 Documentation — Structured Concurrency
- OpenJDK JEP 505 — Structured Concurrency, Fifth Preview
- OpenJDK JEP 506 — Scoped Values
- Oracle Java SE 25 API — `ScopedValue`
- Oracle Java SE 25 API — `java.net.http.HttpClient`
- Project Reactor Reference Guide
- Reactive Streams Specification
- Netty Documentation
- gRPC Java Documentation
- gRPC Guides: Deadlines, Cancellation, Flow Control, Retry, Keepalive

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 25 — Netty for Java Network Engineers: Event Loop, Channel Pipeline, ByteBuf, and Zero-Copy](./025-netty-for-java-network-engineers-event-loop-channel-pipeline-bytebuf-zero-copy.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 27 — Backpressure, Rate Limiting, Bulkhead, Circuit Breaker, and Adaptive Protection](./027-backpressure-rate-limiting-bulkhead-circuit-breaker-adaptive-protection.md)

</div>