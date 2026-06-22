# Part 25 — Virtual Threads, CompletableFuture, Reactive, dan Structured Concurrency

> Series: `learn-java-http-client-okhttp-retrofit-client-engineering`  
> File: `25-virtual-threads-completablefuture-reactive-structured-concurrency.md`  
> Scope: Java 8 sampai Java 25  
> Fokus: memilih dan mendesain model concurrency untuk HTTP client production-grade

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas performance engineering: latency, throughput, allocation, GC, pooling, HTTP/2, dan threading. Bagian ini masuk lebih dalam ke pertanyaan desain yang sering menentukan kualitas sistem backend modern:

> Untuk outbound HTTP call, kapan memakai blocking thread biasa, `CompletableFuture`, reactive stream, virtual threads, atau structured concurrency?

Ini bukan pertanyaan gaya coding. Ini pertanyaan arsitektur runtime.

Pilihan concurrency model akan memengaruhi:

- jumlah request paralel yang bisa ditangani;
- cara timeout dan cancellation dipropagasi;
- cara retry dan fallback dikomposisikan;
- apakah thread mudah habis;
- apakah kode mudah dibaca;
- apakah failure bisa dikaitkan ke parent operation;
- apakah observability tetap jelas;
- apakah debugging production masih manusiawi.

HTTP client yang tampak sederhana seperti ini:

```java
var response = client.send(request, BodyHandlers.ofString());
```

bisa berada di dalam berbagai runtime model:

```text
platform thread blocking
virtual thread blocking
CompletableFuture async
reactive Mono/Flux
structured task scope
custom executor pool
batch worker pool
message-driven consumer
scheduled polling job
```

Masing-masing punya konsekuensi berbeda.

Bagian ini bertujuan membuat Anda bisa mengambil keputusan seperti engineer senior/top-tier:

- bukan “reactive selalu lebih scalable”;
- bukan “virtual thread membuat semua masalah hilang”;
- bukan “async pasti lebih cepat”;
- bukan “CompletableFuture cukup untuk semua fan-out”;
- bukan “blocking itu buruk”.

Yang benar:

> Concurrency model harus dipilih berdasarkan workload shape, failure semantics, resource boundary, dan observability model.

---

## 2. Mental Model Dasar: Concurrency Bukan Parallelism Saja

Dalam HTTP client engineering, concurrency berarti:

> Berapa banyak operasi outbound yang sedang hidup pada saat bersamaan, walaupun belum tentu sedang memakai CPU.

Satu HTTP call memiliki banyak fase wait:

```text
DNS wait
TCP connect wait
TLS handshake wait
connection pool wait
request write wait
server processing wait
response read wait
body decode wait
```

Sebagian besar waktunya adalah I/O wait, bukan CPU work.

Itu sebabnya HTTP client sering terlihat “ringan”, tetapi secara sistemik bisa memakan:

- thread;
- connection slot;
- socket;
- heap buffer;
- pending callback;
- retry queue;
- rate limiter permit;
- circuit breaker slot;
- downstream capacity.

Concurrency model bukan hanya cara menjalankan kode. Ia adalah cara sistem menyimpan ribuan operasi yang sedang menunggu.

---

## 3. Empat Model Besar untuk HTTP Client Java

Secara praktis, Java backend memiliki empat model besar.

```text
1. Blocking on platform threads
2. Async with CompletableFuture / callback
3. Reactive / non-blocking stream
4. Blocking on virtual threads + optional structured concurrency
```

### 3.1 Blocking on Platform Threads

Model klasik:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Thread OS/platform akan blocked sampai response tersedia.

Karakteristik:

- kode mudah dibaca;
- stack trace jelas;
- mudah debugging;
- cocok untuk throughput sedang;
- bisa boros thread jika concurrency tinggi;
- thread pool sizing menjadi penting;
- raw fan-out besar berisiko thread starvation.

### 3.2 Async dengan CompletableFuture

Model Java 8+:

```java
CompletableFuture<HttpResponse<String>> future =
    client.sendAsync(request, BodyHandlers.ofString());
```

Karakteristik:

- caller thread tidak blocked;
- operasi direpresentasikan sebagai future;
- mudah compose beberapa operasi;
- raw callback chain bisa sulit dibaca;
- cancellation/error propagation harus hati-hati;
- executor selection penting;
- debugging bisa lebih sulit daripada blocking.

JDK `HttpClient.sendAsync` mengembalikan `CompletableFuture<HttpResponse<T>>`; future selesai ketika response tersedia dan bisa dikombinasikan dengan dependent async tasks.

### 3.3 Reactive / Non-Blocking

Model Spring WebClient/Reactor:

```java
Mono<CustomerDto> result = webClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .bodyToMono(CustomerDto.class);
```

Karakteristik:

- non-blocking end-to-end;
- mendukung backpressure pada stream;
- cocok untuk streaming dan high concurrency;
- butuh disiplin agar tidak blocking di event loop;
- observability dan debugging butuh tooling matang;
- mental model lebih kompleks.

Spring WebFlux adalah reactive stack yang non-blocking dan mendukung Reactive Streams back pressure; `WebClient` menyediakan API fluent berbasis Reactor untuk komposisi logic asynchronous tanpa berurusan langsung dengan thread/concurrency.

### 3.4 Virtual Threads

Model Java 21+:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<HttpResponse<String>> future = executor.submit(() ->
        client.send(request, BodyHandlers.ofString())
    );
}
```

Karakteristik:

- gaya kode blocking tetap sederhana;
- thread virtual jauh lebih ringan daripada platform thread;
- cocok untuk I/O-bound workload;
- bukan pengganti rate limit, pool limit, timeout, atau bulkhead;
- blocking native/pinning masih perlu dipahami;
- resource eksternal tetap terbatas.

JEP 444 memperkenalkan virtual threads sebagai thread ringan untuk mengurangi effort menulis, memelihara, dan mengobservasi aplikasi concurrent throughput tinggi.

---

## 4. Hal yang Sering Disalahpahami

### 4.1 Async Tidak Otomatis Lebih Cepat

Async mengubah cara menunggu. Async tidak menghilangkan:

- DNS latency;
- TCP connect latency;
- TLS handshake latency;
- server latency;
- body download time;
- JSON parsing cost;
- downstream rate limit;
- connection pool limit.

Async bisa meningkatkan scalability jika bottleneck Anda adalah thread blocking. Tetapi jika bottleneck-nya adalah downstream 100 RPS atau database internal, async hanya membuat antrean lebih panjang.

### 4.2 Reactive Tidak Otomatis Lebih Baik dari Blocking

Reactive unggul ketika:

- sistem benar-benar non-blocking end-to-end;
- banyak stream panjang;
- butuh backpressure;
- event-loop model dijaga ketat;
- tim paham debugging reactive chain.

Reactive buruk ketika:

- banyak blocking call tersembunyi;
- tim tidak paham scheduler;
- semua dipaksa `Mono`/`Flux` tetapi domain sebenarnya sederhana;
- observability tidak siap;
- error handling menjadi opaque.

### 4.3 Virtual Threads Tidak Menghapus Kebutuhan Bulkhead

Virtual thread membuat thread murah. Tetapi ia tidak membuat resource lain murah.

Jika Anda membuat 100.000 virtual thread melakukan HTTP call bersamaan, Anda tetap bisa kehabisan:

- connection pool slot;
- downstream capacity;
- NAT port;
- memory buffer;
- TLS handshake CPU;
- rate limit quota;
- database connection downstream;
- API gateway capacity.

Virtual threads mengurangi masalah thread starvation, bukan menghapus hukum kapasitas.

### 4.4 CompletableFuture Tidak Sama dengan Structured Concurrency

`CompletableFuture` sangat fleksibel, tetapi fleksibilitas ini bisa menjadi masalah.

Future bisa hidup lebih lama dari request parent. Cancellation bisa tidak jelas. Error bisa tersebar di banyak stage. Timeout bisa dipasang di tempat yang salah. Fan-out bisa membuat orphan tasks.

Structured concurrency mencoba memperbaiki ini dengan memperlakukan sekumpulan task terkait sebagai satu unit kerja. JEP structured concurrency menjelaskan bahwa group task dalam thread berbeda diperlakukan sebagai satu unit sehingga error handling, cancellation, reliability, dan observability lebih baik.

---

## 5. Decision Matrix Ringkas

| Kondisi | Model yang Biasanya Cocok | Catatan |
|---|---|---|
| Java 8, simple outbound call | Blocking + bounded executor / OkHttp / Apache | Simple dan stabil |
| Java 8, fan-out async | `CompletableFuture` + custom executor + limit | Jangan pakai unbounded fan-out |
| Java 11+, simple client tanpa dependency besar | JDK `HttpClient` blocking/async | Native JDK |
| Java 21+, I/O-bound service | Blocking + virtual threads | Tetap pakai timeout/bulkhead |
| Streaming / SSE / long-lived flow | Reactive / WebClient / Reactor Netty | Backpressure penting |
| High fan-out aggregator | Virtual threads + structured concurrency atau carefully bounded CF | Cancellation penting |
| Library SDK internal | Blocking API sederhana + async optional | Jangan paksa caller reactive |
| Existing reactive stack | WebClient | Hindari blocking di event loop |
| Strict enterprise proxy/TLS control | Apache HttpClient 5 | Rich configuration |
| Retrofit typed API | Retrofit + OkHttp | Interface contract bagus |

---

## 6. Workload Shape: Pertanyaan Pertama Sebelum Pilih Model

Sebelum memilih concurrency model, jawab workload shape.

### 6.1 Apakah Request-Driven atau Batch-Driven?

Request-driven:

```text
incoming HTTP request
→ call downstream A/B/C
→ respond user
```

Batch-driven:

```text
scheduler / queue consumer
→ process N records
→ call external API per record
→ persist result
```

Request-driven biasanya lebih sensitif terhadap tail latency dan cancellation. Batch-driven lebih sensitif terhadap throughput, quota, idempotency, dan retry scheduling.

### 6.2 Apakah Fan-Out atau Single Call?

Single call:

```text
get customer profile
→ one external API
```

Fan-out:

```text
get dashboard
→ profile API
→ balance API
→ notification API
→ risk API
→ entitlement API
```

Fan-out memerlukan:

- concurrency limit;
- deadline sharing;
- partial failure policy;
- cancellation of losers;
- structured error aggregation;
- trace clarity.

### 6.3 Apakah Response Kecil atau Streaming/Besar?

Small response:

```text
JSON 2 KB
```

Large/streaming response:

```text
CSV 500 MB
PDF stream
SSE stream
NDJSON stream
large XML
```

Large response tidak boleh diperlakukan seperti small response. Concurrency model harus mempertimbangkan buffer, backpressure, dan body lifecycle.

### 6.4 Apakah Downstream Cepat, Lambat, atau Tidak Stabil?

Jika downstream cepat dan stabil, simple blocking mungkin cukup.

Jika downstream lambat/tidak stabil:

- timeout harus ketat;
- concurrency harus dibatasi;
- retry harus budgeted;
- fallback harus jelas;
- observability harus granular.

Model concurrency tidak boleh dipakai untuk menyembunyikan downstream yang buruk.

---

## 7. Platform Thread Blocking Model

### 7.1 Kapan Masih Masuk Akal

Blocking dengan platform thread masih masuk akal jika:

- concurrency kecil/sedang;
- service tidak melakukan ribuan parallel outbound call;
- thread pool dibatasi;
- timeout jelas;
- workload mudah diprediksi;
- tim butuh debugging sederhana.

Contoh:

```java
public CustomerProfile fetchProfile(String customerId) {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(baseUrl + "/customers/" + customerId))
        .timeout(Duration.ofSeconds(2))
        .GET()
        .build();

    try {
        HttpResponse<String> response = httpClient.send(
            request,
            HttpResponse.BodyHandlers.ofString()
        );
        return mapper.readValue(response.body(), CustomerProfile.class);
    } catch (IOException e) {
        throw new DownstreamTransportException("Profile API transport failure", e);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new DownstreamInterruptedException("Profile API call interrupted", e);
    }
}
```

### 7.2 Risiko Utama

Risiko utama platform thread blocking:

```text
high concurrency
→ many blocked platform threads
→ thread pool exhausted
→ incoming requests queue
→ latency rises
→ retry starts
→ more blocked threads
→ cascading failure
```

### 7.3 Rule of Thumb

Blocking platform thread aman bila Anda bisa menjawab:

- berapa max concurrent outbound call?
- berapa max thread pool?
- berapa timeout per call?
- apa yang terjadi saat downstream slow?
- apakah caller bisa membatalkan request?
- apakah semua blocking call berada di executor yang tepat?

Jika jawabannya tidak jelas, Anda sedang membangun incident.

---

## 8. CompletableFuture Model

### 8.1 Kekuatan CompletableFuture

`CompletableFuture` berguna untuk:

- parallel fan-out;
- compose dependent async operations;
- avoid blocking caller thread;
- combine results;
- race beberapa call;
- add timeout at future level;
- build async SDK API.

Contoh sederhana:

```java
CompletableFuture<Customer> customerFuture =
    httpClient.sendAsync(customerRequest, BodyHandlers.ofString())
        .thenApply(this::ensure2xx)
        .thenApply(HttpResponse::body)
        .thenApply(this::parseCustomer);
```

### 8.2 Fan-Out dengan CompletableFuture

```java
CompletableFuture<Customer> customer = fetchCustomer(id);
CompletableFuture<Account> account = fetchAccount(id);
CompletableFuture<List<Order>> orders = fetchOrders(id);

CompletableFuture<Dashboard> dashboard = CompletableFuture
    .allOf(customer, account, orders)
    .thenApply(ignored -> new Dashboard(
        customer.join(),
        account.join(),
        orders.join()
    ));
```

Kode ini terlihat rapi, tetapi ada pertanyaan besar:

- jika `customer` gagal cepat, apakah `account` dan `orders` dibatalkan?
- jika parent request timeout, apakah semua future dibatalkan?
- jika satu task hang, apakah `allOf` punya deadline?
- apakah semua future memakai executor yang aman?
- apakah exception dibungkus `CompletionException` dengan benar?
- apakah trace context masih benar?

### 8.3 Common Pitfall: Unbounded Fan-Out

Anti-pattern:

```java
List<CompletableFuture<Result>> futures = ids.stream()
    .map(this::fetchRemote)
    .toList();
```

Jika `ids` berisi 10.000 item, kode ini bisa membuat 10.000 outbound operation sekaligus.

Solusi:

- gunakan semaphore;
- gunakan bounded executor;
- gunakan rate limiter;
- gunakan batch/window;
- gunakan queue worker;
- gunakan structured concurrency dengan bounded policy.

Contoh bounded dengan semaphore:

```java
public CompletableFuture<Result> fetchWithLimit(String id, Semaphore semaphore) {
    return CompletableFuture.runAsync(() -> {
            try {
                semaphore.acquire();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new CompletionException(e);
            }
        })
        .thenCompose(ignored -> fetchRemote(id))
        .whenComplete((result, error) -> semaphore.release());
}
```

Tetapi desain ini harus hati-hati: release harus selalu terjadi, cancellation harus dipahami, dan semaphore acquisition sendiri bisa menjadi bottleneck.

### 8.4 Common Pitfall: Executor Tidak Jelas

`CompletableFuture` tanpa executor eksplisit bisa memakai common pool untuk async stages tertentu. Ini berbahaya jika stage Anda melakukan blocking work seperti parsing besar, file I/O, atau call lain.

Contoh yang lebih eksplisit:

```java
ExecutorService parsingExecutor = Executors.newFixedThreadPool(8);

CompletableFuture<Customer> customer = httpClient
    .sendAsync(request, BodyHandlers.ofString())
    .thenApply(this::ensure2xx)
    .thenApplyAsync(response -> parseCustomer(response.body()), parsingExecutor);
```

Pisahkan:

- I/O async handling;
- CPU-heavy JSON/XML parsing;
- blocking fallback;
- audit/log writing;
- downstream call fan-out.

### 8.5 Future Timeout vs HTTP Timeout

Future timeout:

```java
future.orTimeout(2, TimeUnit.SECONDS)
```

HTTP request timeout:

```java
HttpRequest.newBuilder()
    .timeout(Duration.ofSeconds(2))
```

Keduanya tidak sama.

Future timeout membatasi future completion dari sudut pandang caller. HTTP timeout membatasi operasi HTTP di client/request layer. Anda perlu memahami apakah timeout membatalkan underlying operation atau hanya membuat caller berhenti menunggu.

Design principle:

> Pasang timeout sedekat mungkin dengan resource yang ingin dikontrol, lalu bungkus dengan deadline operation-level.

---

## 9. Reactive Model

### 9.1 Reactive Cocok untuk Apa?

Reactive cocok ketika:

- stack benar-benar non-blocking;
- response streaming;
- banyak long-lived connections;
- butuh backpressure;
- event-loop resource harus efisien;
- ada pipeline transform asynchronous;
- tim punya maturity Reactor/Rx.

Contoh WebClient:

```java
Mono<Customer> customer = webClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .bodyToMono(Customer.class)
    .timeout(Duration.ofSeconds(2));
```

### 9.2 Reactive Backpressure

Backpressure berarti consumer bisa memberi sinyal bahwa ia belum siap menerima data lebih banyak.

Ini penting untuk:

- stream besar;
- SSE;
- NDJSON;
- file streaming;
- high-throughput event processing;
- service yang menjadi proxy/transformer.

Tetapi untuk typical REST JSON kecil, backpressure sering bukan alasan utama memakai reactive. Alasan utamanya mungkin consistency dengan reactive stack existing.

### 9.3 Event Loop Rule

Dalam reactive stack, jangan blocking di event loop.

Anti-pattern:

```java
return webClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .bodyToMono(Customer.class)
    .map(customer -> blockingRepository.save(customer));
```

Jika `blockingRepository.save` benar-benar blocking, ia dapat merusak event loop throughput.

Solusi biasanya:

```java
return webClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .bodyToMono(Customer.class)
    .publishOn(Schedulers.boundedElastic())
    .map(customer -> blockingRepository.save(customer));
```

Namun ini bukan gratis. Anda hanya memindahkan blocking ke scheduler lain. Anda tetap perlu limit, timeout, dan observability.

### 9.4 Reactive Error Handling

Reactive error handling harus eksplisit.

Contoh:

```java
return webClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .onStatus(HttpStatusCode::is4xxClientError, response ->
        response.bodyToMono(ErrorBody.class)
            .map(error -> new DownstreamClientException(error.code(), error.message()))
    )
    .onStatus(HttpStatusCode::is5xxServerError, response ->
        response.bodyToMono(String.class)
            .map(body -> new DownstreamServerException("Profile API 5xx"))
    )
    .bodyToMono(Customer.class)
    .timeout(Duration.ofSeconds(2));
```

Pitfall:

- `retrieve()` default error behavior tidak selalu sesuai domain Anda;
- body error bisa hanya bisa dibaca sekali;
- retry operator bisa mengulang non-idempotent operation jika tidak dibatasi;
- context propagation perlu diperhatikan;
- `block()` di reactive path sering menjadi smell, kecuali di boundary yang memang blocking.

### 9.5 Reactive Tidak Cocok Bila Tim Tidak Siap

Reactive bisa menjadi liability jika:

- tim sering memakai `.block()` di mana-mana;
- exception stack sulit dipahami;
- tracing context hilang;
- test sulit dibaca;
- operator dipakai karena gaya, bukan kebutuhan;
- blocking library dicampur tanpa boundary.

Top-tier engineering bukan memakai tool paling canggih. Top-tier engineering adalah memilih complexity yang justified.

---

## 10. Virtual Threads Model

### 10.1 Mental Model Virtual Thread

Virtual thread memungkinkan Anda menulis kode blocking yang lebih murah secara thread resource.

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Customer> future = executor.submit(() -> fetchCustomerBlocking(id));
    Customer customer = future.get();
}
```

Untuk I/O-bound HTTP call, ini menarik karena:

- kode tetap sequential;
- stack trace lebih natural;
- debugging lebih mudah daripada callback chain;
- concurrency bisa tinggi tanpa ribuan platform thread;
- existing blocking client bisa dipakai lebih efektif.

### 10.2 Apa yang Tidak Diselesaikan Virtual Threads

Virtual threads tidak menyelesaikan:

```text
bad timeout
no retry budget
unbounded fan-out
downstream rate limit
connection pool starvation
large response buffering
NAT port exhaustion
TLS handshake storm
bad error taxonomy
missing observability
```

Virtual thread menjawab pertanyaan:

> Bagaimana menyimpan banyak operasi blocked dengan lebih murah?

Bukan:

> Berapa banyak operasi boleh saya jalankan ke downstream?

Itu tetap tugas bulkhead/rate limiter.

### 10.3 Virtual Thread + HTTP Client

Dengan JDK `HttpClient`:

```java
public Customer fetchCustomer(String id) {
    HttpRequest request = HttpRequest.newBuilder()
        .uri(customerUri(id))
        .timeout(Duration.ofSeconds(2))
        .GET()
        .build();

    try {
        HttpResponse<String> response = httpClient.send(
            request,
            BodyHandlers.ofString()
        );
        return parseCustomer(response);
    } catch (IOException e) {
        throw classifyTransportFailure(e);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new ClientCancelledException(e);
    }
}
```

Dipanggil di virtual thread:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Customer> customer = executor.submit(() -> fetchCustomer(id));
    return customer.get(3, TimeUnit.SECONDS);
}
```

### 10.4 Virtual Threads dalam Server Java

Di Spring Boot modern, virtual threads bisa dipakai untuk request handling blocking-style. Namun outbound HTTP tetap harus:

- punya timeout;
- punya connection pool yang cukup tetapi bounded;
- punya downstream bulkhead;
- tidak melakukan unbounded fan-out;
- tidak buffer body besar sembarangan;
- tidak retry tanpa deadline.

### 10.5 Pinning dan Blocking yang Perlu Diwaspadai

Virtual threads ideal ketika blocking operation bisa di-unmount dari carrier thread. Namun ada kondisi tertentu yang bisa menyebabkan carrier thread tetap tertahan, misalnya blocking dalam synchronized/native tertentu. Detailnya bergantung pada versi JDK dan library.

Prinsip praktis:

- hindari synchronized block panjang yang membungkus I/O;
- hindari blocking native call tidak jelas;
- gunakan profiling/JFR untuk melihat pinning;
- jangan anggap semua library lama otomatis optimal di virtual thread;
- tetap ukur di workload nyata.

---

## 11. Structured Concurrency

### 11.1 Masalah yang Ingin Diselesaikan

Fan-out manual sering seperti ini:

```java
CompletableFuture<Customer> customer = fetchCustomer(id);
CompletableFuture<Account> account = fetchAccount(id);
CompletableFuture<Risk> risk = fetchRisk(id);

return CompletableFuture.allOf(customer, account, risk)
    .thenApply(ignored -> combine(customer.join(), account.join(), risk.join()));
```

Masalah:

- parent operation tidak punya scope eksplisit;
- cancellation bisa bocor;
- task yang tidak dibutuhkan bisa tetap jalan;
- error aggregation tidak natural;
- timeout bisa tidak membatalkan semua subtask;
- observability sulit melihat semua task sebagai satu unit.

Structured concurrency ingin menjadikan beberapa task sebagai satu operation tree.

```text
request: build dashboard
├── task: fetch customer
├── task: fetch account
└── task: fetch risk

If parent fails/cancels/timeouts:
→ children should be cancelled

If child fails according to policy:
→ parent can fail or degrade
```

### 11.2 Structured Concurrency untuk HTTP Fan-Out

Konsep ideal:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Subtask<Customer> customer = scope.fork(() -> fetchCustomer(id));
    Subtask<Account> account = scope.fork(() -> fetchAccount(id));
    Subtask<Risk> risk = scope.fork(() -> fetchRisk(id));

    scope.join();
    scope.throwIfFailed();

    return new Dashboard(
        customer.get(),
        account.get(),
        risk.get()
    );
}
```

Catatan penting: API structured concurrency masih mengalami evolusi/preview di beberapa versi Java setelah Java 21. Untuk production, cek status JDK yang digunakan dan kebijakan organisasi sebelum mengandalkannya langsung.

### 11.3 Policy: ShutdownOnFailure vs Partial Success

Tidak semua fan-out harus fail-fast.

Dashboard bisa punya policy:

```text
customer API required
account API required
recommendation API optional
notification API optional
```

Jika optional API gagal, parent operation mungkin tetap sukses dengan degraded result.

Model:

```text
Required child failure → parent failure
Optional child failure → degraded response + warning
Slow optional child → timeout and omit
Slow required child → parent timeout/failure
```

### 11.4 Structured Concurrency dan Deadline

Fan-out harus berbagi deadline.

Contoh:

```text
incoming request budget: 1000 ms
validation: 50 ms
internal processing: 100 ms
outbound fan-out budget: 700 ms
response composition: 100 ms
buffer: 50 ms
```

Semua subtask tidak boleh masing-masing punya timeout 1000 ms. Mereka harus berbagi operation deadline.

### 11.5 Structured Concurrency vs CompletableFuture

| Aspek | CompletableFuture | Structured Concurrency |
|---|---|---|
| Java availability | Java 8+ | Java 21+ preview/evolving |
| Composition style | graph/callback | lexical scope/tree |
| Error handling | distributed | centralized |
| Cancellation | manual/careful | scope-oriented |
| Debugging | harder for complex chains | more natural |
| Great for | async API, pipelines | request-scoped fan-out |
| Risk | orphan future, unbounded chain | API maturity/version concern |

---

## 12. Cancellation Semantics

Cancellation adalah salah satu area paling sering diabaikan.

### 12.1 Apa yang Terjadi Jika Caller Pergi?

Contoh:

```text
User closes browser
API gateway timeout
client disconnects
upstream cancels request
```

Pertanyaan:

- apakah outbound HTTP call ikut dibatalkan?
- apakah thread tetap menunggu downstream?
- apakah retry tetap jalan?
- apakah response body tetap dibaca?
- apakah connection dilepas?
- apakah audit event tetap ditulis?

### 12.2 CompletableFuture Cancellation

```java
CompletableFuture<HttpResponse<String>> future =
    httpClient.sendAsync(request, BodyHandlers.ofString());

future.cancel(true);
```

Anda perlu memahami apakah underlying operation benar-benar dibatalkan oleh client/library. Jangan hanya mengandalkan status future.

### 12.3 Reactive Cancellation

Reactive cancellation terjadi ketika subscriber membatalkan subscription.

Dalam WebClient, cancellation dapat menghentikan request/response processing, tetapi pipeline Anda harus dirancang agar cleanup terjadi:

- release buffer;
- stop downstream request;
- update metrics;
- avoid hidden background task.

### 12.4 Blocking Cancellation

Blocking thread cancellation biasanya lewat interrupt.

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new ClientCancelledException(e);
}
```

Jangan swallow interrupt.

### 12.5 Cancellation dalam Fan-Out

Fan-out policy:

```text
If parent deadline exceeded:
→ cancel all children

If required child fails fast:
→ cancel non-needed children

If first success wins:
→ cancel losers

If optional child slow:
→ cancel optional child and degrade
```

Tanpa cancellation, sistem bisa melakukan kerja sia-sia setelah hasil tidak lagi berguna.

---

## 13. Timeout Propagation Across Concurrency Models

### 13.1 Timeout Lokal Bukan Deadline Global

Anti-pattern:

```text
fetch A timeout 1s
fetch B timeout 1s
fetch C timeout 1s
parent timeout not defined
```

Jika dipanggil sequential, total bisa 3 detik. Jika retry masuk, bisa lebih panjang.

Top-tier model:

```text
operation deadline = now + 1200ms
A receives remaining budget
B receives remaining budget
C receives remaining budget
retry uses remaining budget
fallback uses remaining budget
```

### 13.2 Deadline Object

Contoh sederhana:

```java
public final class Deadline {
    private final Instant expiresAt;

    private Deadline(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public static Deadline after(Duration duration) {
        return new Deadline(Instant.now().plus(duration));
    }

    public Duration remaining() {
        Duration remaining = Duration.between(Instant.now(), expiresAt);
        return remaining.isNegative() ? Duration.ZERO : remaining;
    }

    public boolean expired() {
        return !Instant.now().isBefore(expiresAt);
    }
}
```

HTTP call:

```java
Duration timeout = deadline.remaining().compareTo(maxPerCallTimeout) < 0
    ? deadline.remaining()
    : maxPerCallTimeout;

HttpRequest request = HttpRequest.newBuilder(uri)
    .timeout(timeout)
    .GET()
    .build();
```

### 13.3 Timeout + Retry

Retry harus mengambil sisa deadline.

```text
operation deadline: 1000 ms
attempt 1: 300 ms timeout
backoff: 100 ms
attempt 2: min(300 ms, remaining)
backoff: maybe skipped if not enough budget
attempt 3: only if remaining budget meaningful
```

Jangan membuat retry yang hidup lebih lama dari parent request.

---

## 14. Fan-Out/Fan-In Patterns

### 14.1 All Required

Semua downstream wajib sukses.

```text
A required
B required
C required
If any fails → operation fails
```

Cocok untuk:

- command validation;
- payment pre-check;
- regulatory submission;
- consistency-sensitive flow.

Concurrency model:

- structured concurrency `ShutdownOnFailure`;
- `CompletableFuture.allOf` + cancellation;
- reactive `Mono.zip`.

### 14.2 Partial Success

Sebagian wajib, sebagian optional.

```text
A required
B required
C optional
D optional
```

Cocok untuk:

- dashboard;
- enrichment;
- recommendation;
- non-critical metadata.

Output harus eksplisit:

```java
public record Dashboard(
    Customer customer,
    Account account,
    Optional<Recommendation> recommendation,
    List<Degradation> degradations
) {}
```

Jangan menyembunyikan partial failure sebagai sukses total.

### 14.3 First Success Wins

Beberapa endpoint alternatif.

```text
call primary
call secondary
return first valid response
cancel loser
```

Cocok untuk:

- redundant read replica;
- low-latency read;
- multi-region fallback.

Risiko:

- double load;
- inconsistent response;
- cost increase;
- cancellation not effective;
- duplicate side effect jika dipakai untuk command.

### 14.4 Sequential Dependency

```text
call token endpoint
→ use token to call resource endpoint
→ use resource id to call detail endpoint
```

Di sini parallelism tidak membantu. Fokus pada:

- timeout propagation;
- token cache;
- failure classification;
- retry boundary;
- redaction.

### 14.5 Bounded Batch Fan-Out

Untuk batch 10.000 records:

```text
window size 50
rate 250/min
max in-flight 20
retry queue bounded
dead letter for permanent failures
```

Jangan pakai `parallelStream()` untuk outbound HTTP production.

---

## 15. Code Pattern: Bounded Fan-Out dengan Virtual Threads

Contoh konsep:

```java
public List<Result> fetchAllBounded(List<String> ids, int maxConcurrency) throws InterruptedException {
    Semaphore semaphore = new Semaphore(maxConcurrency);

    try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
        List<Future<Result>> futures = new ArrayList<>();

        for (String id : ids) {
            futures.add(executor.submit(() -> {
                semaphore.acquire();
                try {
                    return fetchOne(id);
                } finally {
                    semaphore.release();
                }
            }));
        }

        List<Result> results = new ArrayList<>();
        for (Future<Result> future : futures) {
            try {
                results.add(future.get());
            } catch (ExecutionException e) {
                results.add(Result.failed(classify(e.getCause())));
            }
        }

        return results;
    }
}
```

Catatan:

- virtual threads membuat blocking murah;
- semaphore tetap membatasi downstream concurrency;
- future collection tetap bisa besar jika `ids` sangat besar;
- untuk data sangat besar, gunakan window/chunk, bukan submit semua sekaligus.

Windowed pattern:

```java
for (List<String> batch : partition(ids, 100)) {
    List<Result> batchResults = fetchAllBounded(batch, 20);
    persist(batchResults);
}
```

---

## 16. Code Pattern: CompletableFuture dengan Bounded Executor

```java
ExecutorService outboundExecutor = Executors.newFixedThreadPool(32);

public CompletableFuture<Customer> fetchCustomerAsync(String id) {
    return CompletableFuture.supplyAsync(() -> fetchCustomerBlocking(id), outboundExecutor);
}
```

Ini bukan true non-blocking, tetapi useful di Java 8 jika library Anda blocking.

Risiko:

- fixed pool habis jika downstream lambat;
- queue executor bisa menumpuk;
- cancellation belum tentu membatalkan socket;
- caller harus handle timeout.

Lebih aman dengan bounded queue + rejection policy:

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    16,
    32,
    30, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(200),
    new ThreadPoolExecutor.AbortPolicy()
);
```

Rejected execution adalah load shedding, bukan bug.

---

## 17. Code Pattern: Reactive Fan-Out

```java
Mono<Customer> customer = fetchCustomer(id);
Mono<Account> account = fetchAccount(id);
Mono<Risk> risk = fetchRisk(id);

return Mono.zip(customer, account, risk)
    .map(tuple -> new Dashboard(
        tuple.getT1(),
        tuple.getT2(),
        tuple.getT3()
    ))
    .timeout(Duration.ofMillis(800));
```

Partial success:

```java
Mono<Optional<Recommendation>> recommendation = fetchRecommendation(id)
    .map(Optional::of)
    .timeout(Duration.ofMillis(200))
    .onErrorReturn(Optional.empty());
```

Hati-hati:

- `onErrorReturn` bisa menyembunyikan systemic outage;
- tambahkan metric degradation;
- jangan fallback diam-diam untuk required dependency;
- jangan retry non-idempotent operation.

---

## 18. API Design: Blocking, Async, atau Reactive untuk SDK?

Jika Anda membangun internal SDK/client library, pertanyaan penting:

> API apa yang diberikan ke caller?

### 18.1 Blocking API

```java
Customer getCustomer(String id);
```

Kelebihan:

- paling mudah digunakan;
- cocok untuk virtual threads;
- stack trace jelas;
- caller bisa wrap sendiri jika butuh async.

Kekurangan:

- caller platform-thread stack bisa blocked;
- butuh timeout/bulkhead di dalam SDK.

### 18.2 CompletableFuture API

```java
CompletableFuture<Customer> getCustomerAsync(String id);
```

Kelebihan:

- Java 8+;
- mudah compose;
- tidak memaksa Reactor dependency.

Kekurangan:

- error/cancellation semantics harus terdokumentasi;
- executor ownership harus jelas;
- future bisa bocor.

### 18.3 Reactive API

```java
Mono<Customer> getCustomer(String id);
```

Kelebihan:

- cocok untuk reactive app;
- backpressure/stream support;
- rich operator composition.

Kekurangan:

- memaksa dependency Reactor;
- tidak ideal untuk non-reactive caller;
- blocking caller akan memakai `.block()`.

### 18.4 Rekomendasi SDK Umum

Untuk organisasi campuran:

```text
Core client: blocking domain-safe API
Optional async facade: CompletableFuture
Optional reactive adapter: separate module
```

Contoh package:

```text
client-core
  CustomerClient#getCustomer(id)

client-async
  AsyncCustomerClient#getCustomerAsync(id)

client-reactor
  ReactorCustomerClient#getCustomer(id): Mono<Customer>
```

Jangan membuat semua service tergantung Reactor hanya karena satu client ingin async.

---

## 19. Threading Model per Library

### 19.1 JDK HttpClient

- `send()` blocking.
- `sendAsync()` mengembalikan `CompletableFuture`.
- `executor()` bisa dikonfigurasi di builder.
- HTTP/2 didukung.
- Cocok untuk native Java 11+ client.

### 19.2 OkHttp

- `Call.execute()` blocking.
- `Call.enqueue()` async callback.
- `Dispatcher` mengontrol async call concurrency.
- ConnectionPool menangani reuse.
- Dengan virtual threads, `execute()` bisa menjadi pilihan yang sangat readable.

### 19.3 Retrofit

- Di Java, bisa expose `Call<T>`.
- Bisa execute sync atau enqueue async.
- Bisa pakai adapter untuk `CompletableFuture`, RxJava, Reactor via extension/custom adapter.
- Underlying engine biasanya OkHttp.

### 19.4 Apache HttpClient 5

- Classic blocking client.
- Async client.
- Rich connection management.
- Cocok untuk enterprise proxy/TLS/connection policy.
- Dengan virtual threads, classic API menjadi lebih menarik.

### 19.5 Spring WebClient

- Reactive/non-blocking.
- Berbasis Reactor.
- Cocok untuk WebFlux stack dan streaming.
- Jangan blocking sembarangan.

### 19.6 Spring RestClient

- Synchronous/fluent API.
- Cocok untuk Spring MVC/blocking style.
- Dengan virtual threads, bisa menjadi modern blocking option.

---

## 20. Interaction dengan Connection Pool

Concurrency model harus cocok dengan pool model.

### 20.1 Too Many Tasks, Too Small Pool

```text
1000 concurrent tasks
connection pool max 50
950 tasks wait for pool
thread/future/subscription remains pending
latency rises
timeout happens
retry amplifies
```

Solusi:

- limit concurrency ≤ pool capacity × reasonable factor;
- monitor pool acquire wait;
- separate pool per downstream jika critical;
- tune pool berdasarkan downstream capacity;
- do not increase pool blindly.

### 20.2 HTTP/2 Multiplexing

HTTP/2 bisa menjalankan banyak streams di satu connection. Tetapi tetap ada limit:

- max concurrent streams;
- server setting;
- flow control;
- head-of-line at TCP level;
- shared connection failure impact.

Concurrency model tetap perlu limit.

### 20.3 Virtual Threads and Pool Wait

Virtual threads membuat pool wait lebih murah secara thread, tetapi tidak membuat wait bagus secara latency. Jika banyak virtual thread menunggu connection pool, user tetap menunggu.

Metric penting:

```text
pool_acquire_duration
active_connections
idle_connections
pending_requests
in_flight_requests
request_queue_depth
```

---

## 21. Interaction dengan Retry, Rate Limit, dan Circuit Breaker

### 21.1 Retry in Async Model

Retry dalam async model harus:

- preserve context;
- respect deadline;
- classify retryability;
- avoid duplicate side effects;
- avoid unbounded recursion;
- expose attempt metrics.

### 21.2 Rate Limit in Reactive Model

Reactive stream bisa terlihat backpressured, tetapi downstream API rate limit tetap perlu explicit rate limiter.

Backpressure menjawab:

> Consumer saya siap menerima berapa banyak data?

Rate limit menjawab:

> Downstream mengizinkan saya mengirim berapa banyak request per time window?

Ini berbeda.

### 21.3 Circuit Breaker with Virtual Threads

Virtual threads tidak mengurangi kebutuhan circuit breaker. Jika downstream down, virtual threads bisa membuat ribuan blocked attempts dengan murah, tetapi downstream tetap dihantam.

Circuit breaker tetap membatasi attempts ketika failure rate tinggi.

---

## 22. Observability per Concurrency Model

### 22.1 Blocking

Mudah:

```text
one stack trace
one thread name
MDC often works
try/finally simple
```

Tapi dengan thread pool reuse, pastikan MDC dibersihkan.

### 22.2 CompletableFuture

Perlu propagation:

- trace context;
- MDC;
- security context;
- locale/tenant context;
- deadline context.

Jangan mengandalkan `ThreadLocal` berjalan otomatis melintasi async boundaries.

### 22.3 Reactive

Gunakan Reactor Context, bukan raw ThreadLocal.

```java
return webClient.get()
    .uri("/customers/{id}", id)
    .retrieve()
    .bodyToMono(Customer.class)
    .contextWrite(ctx -> ctx.put("correlationId", correlationId));
```

### 22.4 Virtual Threads

ThreadLocal bisa lebih natural karena satu virtual thread sering mewakili satu operation. Tetapi tetap hati-hati dengan propagation ke child tasks, executor, dan library async internal.

### 22.5 Structured Concurrency

Observability lebih natural karena child tasks berada dalam scope parent. Idealnya trace/span juga membentuk tree:

```text
span: GET /dashboard
├── span: outbound profile-api
├── span: outbound account-api
└── span: outbound risk-api
```

---

## 23. Testing Concurrency Model

Test bukan hanya response sukses.

### 23.1 Test Fan-Out Cancellation

Simulasikan:

- A gagal cepat;
- B lambat;
- C masih berjalan;
- parent harus membatalkan B/C jika policy fail-fast.

### 23.2 Test Timeout Propagation

Simulasikan:

- parent deadline 500 ms;
- downstream delay 1 s;
- retry should not exceed deadline.

### 23.3 Test Bulkhead

Simulasikan 100 request, limit concurrency 10.

Assert:

- max in-flight tidak melebihi 10;
- excess request queue/reject sesuai policy;
- metric emitted.

### 23.4 Test Reactive Blocking Guard

Jika memakai WebClient/Reactor, gunakan tools seperti BlockHound di test environment untuk mendeteksi blocking call di event loop. Jangan gunakan di production tanpa evaluasi.

### 23.5 Test Virtual Thread Behavior

Test:

- banyak concurrent call;
- timeout tetap berjalan;
- semaphore limit bekerja;
- interrupt/cancellation ditangani;
- no memory explosion.

---

## 24. Anti-Pattern Besar

### 24.1 `parallelStream()` untuk HTTP Call

Anti-pattern:

```java
ids.parallelStream()
    .map(this::callRemote)
    .toList();
```

Masalah:

- memakai common ForkJoinPool;
- concurrency tidak sesuai downstream;
- cancellation/error handling buruk;
- observability buruk;
- sulit memasang rate limit.

### 24.2 Async Without Limit

```java
ids.stream()
    .map(this::fetchAsync)
    .toList();
```

Masalah:

- unbounded in-flight;
- connection pool wait;
- memory pressure;
- retry storm.

### 24.3 Reactive with Hidden Blocking

```java
Mono.just(blockingCall())
```

Ini menjalankan blocking call saat assembly, bukan saat subscription.

Gunakan jika benar-benar perlu:

```java
Mono.fromCallable(this::blockingCall)
    .subscribeOn(Schedulers.boundedElastic())
```

Tetap pasang limit.

### 24.4 Virtual Threads Without Bulkhead

```java
Executors.newVirtualThreadPerTaskExecutor()
// submit 100_000 remote calls
```

Virtual threads murah, downstream tidak.

### 24.5 Timeout Only at Outer Layer

Jika hanya memakai API gateway timeout, application masih bisa menjalankan outbound call setelah caller pergi. Pasang timeout dan cancellation di application boundary juga.

### 24.6 Swallow InterruptedException

```java
catch (InterruptedException e) {
    throw new RuntimeException(e);
}
```

Lebih benar:

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    throw new ClientCancelledException(e);
}
```

### 24.7 Mixing Models Without Boundary

Contoh buruk:

```text
Controller reactive
→ service blocking
→ CompletableFuture
→ .block()
→ virtual thread executor
→ another reactive call
```

Buat boundary yang jelas. Jangan campur model tanpa alasan.

---

## 25. Practical Selection Framework

Gunakan pertanyaan berikut.

### 25.1 Runtime Version

```text
Java 8?
→ CompletableFuture / blocking executor / OkHttp / Apache

Java 11+?
→ JDK HttpClient available

Java 21+?
→ virtual threads available

Java 25?
→ structured concurrency may still require preview awareness depending API status
```

### 25.2 Application Stack

```text
Spring MVC / blocking stack
→ RestClient / JDK / OkHttp / Apache + virtual threads if Java 21+

Spring WebFlux reactive stack
→ WebClient

Library SDK for broad consumers
→ blocking core + async adapter
```

### 25.3 Workload

```text
single short call
→ blocking simple model

request-scoped fan-out
→ virtual threads + structured style or bounded CF

streaming
→ reactive/non-blocking

batch millions records
→ bounded worker/rate limiter, not raw async

low-latency hedge
→ carefully bounded async/race model
```

### 25.4 Failure Semantics

```text
required all success
→ fail-fast scope

optional downstream
→ partial success model

side-effect command
→ avoid blind retry/hedging

idempotent read
→ retry/hedging possible with budget
```

### 25.5 Team Maturity

```text
team strong in Reactor
→ reactive is viable

team mostly imperative
→ virtual threads/blocking may be safer

mixed organization
→ expose simple API, hide complexity inside client
```

---

## 26. Example: Dashboard Aggregator Design

Requirement:

```text
Build dashboard within 900 ms.
Customer and account required.
Recommendations optional.
Risk required but can fallback to cached risk if remote fails.
```

### 26.1 Policy

```text
operation deadline: 900 ms
customer timeout: remaining max 400 ms
account timeout: remaining max 400 ms
risk timeout: remaining max 300 ms
recommendation timeout: 150 ms
risk fallback: cache if remote failure
recommendation fallback: omit
max concurrent outbound per request: 4
service-level bulkhead per downstream
```

### 26.2 Result Model

```java
public record DashboardResult(
    Customer customer,
    Account account,
    Risk risk,
    Optional<Recommendation> recommendation,
    List<Degradation> degradations
) {}
```

### 26.3 Top-Tier Observability

Emit:

```text
outbound.customer.duration
outbound.account.duration
outbound.risk.duration
outbound.recommendation.duration
outbound.risk.fallback.used
outbound.recommendation.omitted
outbound.dashboard.deadline.remaining
outbound.dashboard.degraded
```

Trace:

```text
GET /dashboard
├── customer-api GET /customer/{id}
├── account-api GET /account/{id}
├── risk-api GET /risk/{id}
└── recommendation-api GET /recommendations/{id}
```

### 26.4 Design Lesson

Concurrency model is not the design. Policy is the design.

The model is just implementation strategy.

---

## 27. Example: Batch External API Delivery

Requirement:

```text
Send 1 million records to third-party API.
Vendor allows 300 requests/min.
Each request is idempotent with idempotency key.
Need retry transient failures.
Need resume after crash.
```

Bad design:

```text
CompletableFuture for all records
→ unbounded memory
→ rate limit violation
→ retry storm
```

Good design:

```text
persistent queue/outbox
→ worker pool
→ rate limiter 250/min
→ max in-flight 20
→ idempotency key per record
→ retry with backoff
→ DLQ for permanent failure
→ checkpoint/resume
```

Concurrency model:

- blocking workers on virtual threads can work;
- platform thread pool can work;
- reactive can work;
- the important part is bounded delivery policy.

---

## 28. Example: Internal SDK API Design

Goal:

```text
Provide OrganizationProfileClient usable by many Java services.
```

Recommended:

```java
public interface OrganizationProfileClient {
    OrganizationProfile getProfile(OrganizationId id, ClientRequestContext context);
}
```

Async adapter:

```java
public interface AsyncOrganizationProfileClient {
    CompletableFuture<OrganizationProfile> getProfile(
        OrganizationId id,
        ClientRequestContext context
    );
}
```

Reactive adapter:

```java
public interface ReactorOrganizationProfileClient {
    Mono<OrganizationProfile> getProfile(
        OrganizationId id,
        ClientRequestContext context
    );
}
```

Context:

```java
public record ClientRequestContext(
    String correlationId,
    Deadline deadline,
    String tenantId,
    boolean allowFallback
) {}
```

Do not hide deadline/correlation as random ThreadLocal only.

---

## 29. Production Checklist

### 29.1 Model Selection

- [ ] Apakah concurrency model sesuai Java version?
- [ ] Apakah sesuai stack aplikasi?
- [ ] Apakah sesuai workload shape?
- [ ] Apakah tim mampu maintain/debug model tersebut?
- [ ] Apakah blocking/non-blocking boundary jelas?

### 29.2 Resource Control

- [ ] Apakah max concurrent outbound call dibatasi?
- [ ] Apakah pool size sesuai concurrency?
- [ ] Apakah queue bounded?
- [ ] Apakah rejection/load shedding diperlakukan sebagai expected behavior?
- [ ] Apakah rate limit vendor dihormati?

### 29.3 Timeout and Cancellation

- [ ] Apakah ada operation deadline?
- [ ] Apakah per-call timeout mengambil sisa deadline?
- [ ] Apakah retry menghormati deadline?
- [ ] Apakah parent cancellation membatalkan child calls?
- [ ] Apakah `InterruptedException` ditangani benar?

### 29.4 Error Semantics

- [ ] Apakah failure child required/optional dibedakan?
- [ ] Apakah partial success eksplisit?
- [ ] Apakah fallback dicatat sebagai degradation?
- [ ] Apakah exception async tidak hilang?
- [ ] Apakah cancellation dibedakan dari timeout?

### 29.5 Observability

- [ ] Apakah setiap outbound call punya metric duration/status/error?
- [ ] Apakah fan-out child spans terlihat?
- [ ] Apakah retry attempt terlihat?
- [ ] Apakah timeout/cancel/fallback punya classification?
- [ ] Apakah context propagation aman di async/reactive boundary?

### 29.6 Testing

- [ ] Test slow downstream.
- [ ] Test failure required child.
- [ ] Test optional child degradation.
- [ ] Test parent timeout.
- [ ] Test cancellation.
- [ ] Test max concurrency.
- [ ] Test retry budget.
- [ ] Test no unbounded fan-out.

---

## 30. Heuristik Top 1% Engineer

### 30.1 Simplicity First, But Not Naive

Gunakan blocking jika cukup. Gunakan virtual threads jika Anda butuh high concurrency dengan imperative readability. Gunakan reactive jika benar-benar perlu non-blocking stream/backpressure atau sudah berada di reactive stack.

Jangan memakai concurrency model untuk terlihat advanced.

### 30.2 Policy Before API

Sebelum memilih `sendAsync`, `Mono`, atau virtual thread, definisikan:

```text
deadline
max concurrency
retryability
fallback
partial failure
rate limit
idempotency
observability
```

### 30.3 Bound Everything

Bound:

- threads;
- virtual thread submissions indirectly via semaphore/window;
- futures;
- reactive concurrency;
- connection pools;
- queues;
- retries;
- body size;
- deadline;
- memory buffers.

### 30.4 Cancellation Is a Feature, Not an Accident

Setiap fan-out harus punya cancellation story.

Jika hasil tidak lagi dibutuhkan, hentikan kerja.

### 30.5 Do Not Confuse Waiting Cheaply with Being Scalable

Virtual threads membuat waiting murah. Reactive membuat waiting non-blocking. Async membuat caller tidak menunggu.

Tetapi downstream capacity tetap nyata.

### 30.6 Make Degradation Visible

Fallback/partial success harus terlihat di:

- response model jika relevan;
- metrics;
- logs;
- traces;
- audit jika domain regulatori.

### 30.7 Prefer Structured Reasoning Over Framework Identity

Pertanyaan yang bagus bukan:

> Kita pakai reactive atau virtual thread?

Pertanyaan yang lebih baik:

> Workload kita seperti apa, resource mana yang terbatas, failure mana yang harus dibatalkan, dan bagaimana kita membuktikan policy itu jalan di production?

---

## 31. Ringkasan Mental Model

HTTP client concurrency bisa diringkas seperti ini:

```text
Concurrency model = how work waits
Policy model      = how much work is allowed
Failure model     = what happens when work fails
Deadline model    = how long work may live
Cancellation model= how work is stopped when no longer useful
Observability     = how work is understood in production
```

Blocking, async, reactive, virtual threads, dan structured concurrency hanyalah pilihan implementasi.

Top-tier engineer tidak memilih berdasarkan tren. Mereka memilih berdasarkan invariant:

```text
No unbounded work.
No hidden blocking.
No orphan tasks.
No retry beyond deadline.
No fallback without visibility.
No downstream call without timeout.
No concurrency without capacity model.
```

---

## 32. Apa yang Harus Dikuasai Setelah Part Ini

Setelah menyelesaikan part ini, Anda seharusnya bisa:

- membedakan blocking, async, reactive, virtual threads, dan structured concurrency;
- memilih model berdasarkan workload, bukan hype;
- mendesain bounded fan-out;
- membuat timeout/deadline propagation;
- memahami cancellation semantics;
- menghindari unbounded `CompletableFuture` dan `parallelStream`;
- memahami kapan WebClient tepat dan kapan berlebihan;
- memahami kenapa virtual threads tetap butuh bulkhead/rate limit;
- mendesain SDK yang tidak memaksa semua caller mengikuti satu concurrency model;
- menulis checklist production untuk outbound concurrency.

---

## 33. Bridge ke Part Berikutnya

Part berikutnya akan membahas security hardening untuk HTTP client.

Jika part ini bertanya:

> Bagaimana banyak HTTP call hidup bersamaan dengan aman?

Maka part berikutnya bertanya:

> Bagaimana memastikan HTTP client tidak menjadi pintu SSRF, token leakage, redirect abuse, certificate bypass, header injection, dan data exfiltration?

Concurrency membuat sistem mampu melakukan banyak hal sekaligus. Security memastikan sistem hanya melakukan hal yang memang boleh dilakukan.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./24-performance-engineering-throughput-latency-allocation-gc-threading.md">⬅️ Part 24 — Performance Engineering: Throughput, Latency, Allocation, GC, Threading</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./26-security-hardening-for-http-clients.md">Part 26 — Security Hardening for HTTP Clients ➡️</a>
</div>
