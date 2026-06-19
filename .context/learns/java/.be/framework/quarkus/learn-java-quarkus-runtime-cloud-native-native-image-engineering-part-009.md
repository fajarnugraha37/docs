# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-009

# Part 009 — Blocking vs Reactive Execution Model: Event Loop, Worker Thread, Mutiny, dan Backpressure

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced / Top 1% Software Engineer Track  
> Fokus: Quarkus execution model, reactive core, event loop discipline, worker isolation, Mutiny, backpressure, failure handling, dan decision-making blocking vs reactive.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita membahas REST layer Quarkus: resource boundary, routing, exception mapping, DTO contract, validation, blocking/non-blocking endpoint, dan API design. Part ini masuk lebih dalam ke mesin eksekusi yang membuat Quarkus berbeda dari framework Java server-side tradisional.

Bagian ini tidak mengulang dasar concurrency Java, thread pool, CompletableFuture, executor, atau reactive programming umum yang sudah pernah dibahas di seri sebelumnya. Fokusnya adalah:

1. bagaimana Quarkus menjalankan request dan event;
2. bagaimana event loop berbeda dari worker thread;
3. bagaimana Quarkus memilih thread untuk endpoint REST;
4. bagaimana Mutiny mengekspresikan asynchronous computation;
5. bagaimana backpressure bekerja dan batasnya;
6. bagaimana menghindari blocking event loop;
7. bagaimana memilih antara imperative, reactive, dan virtual-thread style;
8. bagaimana mendesain service production yang tidak collapse karena thread starvation, blocking leak, retry storm, atau uncontrolled demand.

Inti dari part ini:

> Quarkus bukan memaksa semua kode menjadi reactive. Quarkus memberi runtime reactive-core yang bisa mengeksekusi model imperative, reactive, dan virtual-thread secara terkontrol. Engineer yang matang harus tahu kapan masing-masing model benar, kapan salah, dan failure mode apa yang muncul.

---

## 1. Problem yang Diselesaikan

Framework Java tradisional biasanya memakai model sederhana:

```text
1 request HTTP = 1 thread server = jalankan kode blocking sampai selesai
```

Model ini mudah dipahami. Untuk banyak aplikasi CRUD, model ini masih sangat produktif. Masalahnya muncul ketika sistem harus melayani banyak koneksi, banyak IO eksternal, streaming, messaging, atau workload cloud-native yang harus efisien terhadap CPU dan memory.

Beberapa masalah umum:

1. **Thread-per-request mahal untuk concurrency tinggi**  
   Setiap thread punya stack, scheduler overhead, context switching, dan memory footprint.

2. **Blocking IO membuat thread diam tetapi tetap memakan resource**  
   Saat thread menunggu database, HTTP API, Redis, Kafka, atau filesystem, CPU tidak bekerja tetapi thread tetap tertahan.

3. **Thread pool bisa habis**  
   Jika dependency lambat, semua worker thread bisa tersangkut menunggu. Akibatnya request baru tidak bisa diproses walaupun CPU masih rendah.

4. **Retry bisa memperparah overload**  
   Retry pada dependency lambat bisa menggandakan load dan mempercepat exhaustion.

5. **Reactive pipeline bisa sulit dibaca dan salah dipakai**  
   Reactive bukan gratis. Salah satu kesalahan paling umum adalah menulis reactive wrapper di atas kode blocking, lalu menjalankannya di event loop.

6. **Backpressure sering disalahpahami**  
   Banyak engineer mengira backpressure otomatis menyelesaikan overload. Padahal backpressure hanya bekerja jika upstream dapat dikontrol dan semua boundary menghormati demand.

7. **Virtual threads mengubah trade-off**  
   Java modern membuat blocking style lebih scalable, tetapi tidak menghapus kebutuhan memahami event loop, resource boundary, database connection pool, dan downstream capacity.

Quarkus menyelesaikan sebagian masalah ini dengan membangun runtime di atas reactive core, terutama Vert.x, tetapi tetap menyediakan API imperative agar developer tidak harus selalu menulis reactive code.

---

## 2. Mental Model Utama

### 2.1 Ada Tiga Model Eksekusi yang Perlu Dibedakan

Dalam Quarkus modern, kamu harus membedakan minimal tiga style eksekusi:

```text
┌──────────────────────────────┐
│ 1. Imperative / Blocking      │
│    mudah, langsung, familiar  │
└──────────────┬───────────────┘
               │ biasanya worker thread
               ▼
┌──────────────────────────────┐
│ 2. Reactive / Non-blocking    │
│    event loop + continuation  │
└──────────────┬───────────────┘
               │ biasanya Uni/Multi
               ▼
┌──────────────────────────────┐
│ 3. Virtual Thread             │
│    blocking style, cheap wait │
└──────────────────────────────┘
```

Ketiganya bukan ranking. Yang benar bukan “reactive selalu lebih advanced”. Yang benar adalah:

> Pilih model eksekusi yang sesuai dengan sifat workload, dependency, observability, team skill, dan failure mode.

### 2.2 Event Loop Bukan Tempat Kerja Berat

Event loop adalah thread kecil yang bertugas menangani banyak event IO secara cepat.

Bayangkan event loop sebagai petugas loket super cepat:

```text
Event loop:
- menerima event;
- memanggil handler singkat;
- mendaftarkan callback/continuation;
- lanjut ke event berikutnya.
```

Event loop tidak boleh:

```text
- sleep;
- menunggu JDBC blocking;
- menunggu HTTP client blocking;
- melakukan file IO blocking;
- melakukan CPU-heavy computation panjang;
- melakukan synchronized lock panjang;
- melakukan parsing besar yang memakan waktu lama;
- melakukan crypto/compression berat;
- memanggil .await().indefinitely() di jalur event loop.
```

Jika event loop terblokir, satu thread kecil yang seharusnya melayani banyak koneksi menjadi macet. Dampaknya bisa jauh lebih besar daripada satu request lambat.

### 2.3 Worker Thread Adalah Tempat Kode Blocking Tradisional

Worker thread pool digunakan untuk menjalankan operasi blocking atau long-running.

```text
Worker thread:
- boleh menjalankan JDBC blocking;
- boleh memanggil library blocking;
- boleh melakukan CPU work sedang;
- boleh menjalankan kode imperative;
- tetapi jumlahnya terbatas.
```

Worker pool bukan tempat membuang semua masalah. Jika semua worker thread terblokir pada dependency lambat, sistem tetap bisa starvation.

### 2.4 Reactive Bukan Tentang “Tidak Ada Thread”

Reactive tetap memakai thread. Perbedaannya:

```text
Blocking model:
Thread menunggu hasil.

Reactive model:
Thread tidak menunggu. Continuation dijalankan ketika hasil tersedia.
```

Dengan blocking:

```java
Response response = client.call(); // thread berhenti menunggu
return response;
```

Dengan reactive:

```java
return client.call()
    .onItem().transform(response -> transform(response));
```

Perbedaan paling penting:

> Pada reactive, waiting direpresentasikan sebagai data/control-flow, bukan sebagai thread yang parkir menunggu.

### 2.5 Backpressure Bukan Magic Shield

Backpressure adalah mekanisme agar consumer dapat memberi tahu producer: “saya hanya sanggup menerima N item sekarang”.

Tetapi backpressure hanya efektif jika:

1. producer bisa dikontrol;
2. transport/protocol mendukung demand control;
3. pipeline tidak menyisipkan buffer tak terbatas;
4. boundary eksternal tidak mengabaikan sinyal demand;
5. consumer benar-benar memproses sesuai kapasitas.

Jika upstream adalah user HTTP yang terus mengirim request, atau Kafka topic dengan backlog besar, atau external webhook yang tidak peduli kapasitasmu, maka backpressure harus dilengkapi dengan:

```text
- rate limiting;
- bounded queue;
- load shedding;
- circuit breaker;
- retry budget;
- consumer lag monitoring;
- autoscaling;
- admission control;
- DLQ;
- idempotency.
```

---

## 3. Quarkus Reactive Architecture secara Ringkas

Quarkus menggunakan Vert.x sebagai salah satu fondasi reactive core. Artinya banyak komponen Quarkus berjalan di atas model non-blocking IO dan event-driven runtime.

Secara mental, lapisannya dapat dipahami seperti ini:

```text
┌─────────────────────────────────────────────┐
│ Application Code                             │
│ REST resource, service, repository, handler  │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│ Quarkus Integration Layer                    │
│ REST, CDI, messaging, config, security       │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│ Reactive Core                                │
│ Vert.x event loop, context, event bus        │
└─────────────────────┬───────────────────────┘
                      │
┌─────────────────────▼───────────────────────┐
│ Network / IO / OS                            │
└─────────────────────────────────────────────┘
```

Quarkus REST sendiri menggunakan dua jenis thread utama:

1. **event-loop threads** untuk membaca request dan menulis response;
2. **worker threads** untuk offload operasi long-running/blocking.

Implikasinya:

```text
Semua request HTTP masuk melalui mekanisme IO non-blocking.
Tetapi business code bisa dijalankan di event loop atau worker tergantung signature, annotation, dan model API.
```

---

## 4. Event Loop Deep Dive

### 4.1 Apa Itu Event Loop?

Event loop adalah thread yang terus mengulang pola:

```text
while (running) {
    event = pollNextEvent();
    dispatch(event.handler);
}
```

Dalam praktik, event loop mengelola:

- socket readiness;
- HTTP request bytes;
- HTTP response writes;
- timers;
- callbacks;
- event bus messages;
- non-blocking client completion;
- reactive continuation.

### 4.2 Kenapa Event Loop Harus Cepat?

Karena satu event loop dapat melayani banyak koneksi. Jika handler satu request melakukan blocking selama 2 detik, event lain yang terikat pada event loop yang sama ikut tertunda.

Contoh buruk:

```java
@GET
@Path("/bad")
@NonBlocking
public String bad() throws Exception {
    Thread.sleep(2_000); // fatal jika jalan di event loop
    return "done";
}
```

Efeknya bukan hanya request ini lambat. Event loop bisa gagal memproses:

- request lain;
- timeout;
- response write;
- connection close;
- heartbeat;
- reactive continuation.

### 4.3 Tanda Event Loop Terblokir

Gejala production:

```text
- CPU tidak selalu tinggi, tetapi latency melonjak;
- request timeout sporadis;
- p99/p999 latency jelek;
- log warning blocked thread;
- throughput turun ketika dependency lambat;
- health check kadang gagal;
- reactive endpoint terlihat hang;
- thread dump menunjukkan vert.x-eventloop-thread menunggu lock/IO.
```

### 4.4 Operasi yang Tidak Boleh di Event Loop

| Operasi | Aman di event loop? | Catatan |
|---|---:|---|
| Parsing small JSON | Ya, jika kecil | Hindari payload besar |
| Simple validation | Ya | Jangan melakukan remote call |
| JDBC call | Tidak | JDBC tradisional blocking |
| Blocking REST client | Tidak | Pakai reactive client atau worker |
| File IO besar | Tidak | Offload |
| Redis reactive client | Ya | Jika benar-benar non-blocking |
| Hibernate ORM blocking | Tidak | Worker thread |
| Hibernate Reactive | Ya, dengan pipeline reactive | Jangan bridge ke blocking |
| CPU-heavy hash/compress | Tidak | Worker/custom pool |
| `Thread.sleep` | Tidak | Gunakan timer/non-blocking delay |
| `Uni.await().indefinitely()` | Tidak | Ini memblokir current thread |

---

## 5. Worker Thread Deep Dive

### 5.1 Apa Itu Worker Thread?

Worker thread adalah thread pool untuk menjalankan operasi yang tidak cocok di event loop.

Contoh:

```java
@GET
@Path("/customers/{id}")
@Blocking
public CustomerDto find(@PathParam("id") Long id) {
    return customerService.findById(id); // boleh blocking JDBC/Hibernate ORM
}
```

### 5.2 Worker Bukan Infinite Resource

Worker pool punya ukuran terbatas. Jika semua worker dipakai untuk menunggu dependency lambat, request baru yang butuh worker akan antre.

Failure mode:

```text
Database slow
→ worker threads wait on JDBC
→ worker pool saturated
→ new requests queue
→ latency increases
→ clients retry
→ more requests arrive
→ database load increases
→ service collapse
```

### 5.3 Worker Pool Harus Dilindungi

Gunakan:

- timeout;
- bounded queue;
- circuit breaker;
- bulkhead;
- connection pool sizing;
- retry budget;
- load shedding;
- rate limiting;
- per-dependency isolation;
- observability.

### 5.4 Worker Thread vs Custom Executor

Default worker pool cocok untuk operasi blocking umum, tetapi tidak semua workload sebaiknya digabung.

Gunakan custom executor/bulkhead jika:

1. dependency tertentu sering lambat;
2. workload CPU-heavy;
3. ada operasi batch berat;
4. operasi bisa memonopoli worker pool;
5. perlu isolasi antar kelas pekerjaan.

Contoh conceptual isolation:

```text
HTTP request worker pool
├── fast blocking business logic
├── DB calls
└── short transformations

Custom executor: document-rendering-pool
└── PDF/template rendering berat

Custom executor: crypto-pool
└── signature/hash/verifikasi besar

Custom executor: integration-pool
└── legacy SOAP/blocking external API
```

---

## 6. Quarkus REST Execution Model

### 6.1 Smart Dispatch

Quarkus REST dapat memilih dispatch berdasarkan signature dan annotation.

Secara mental:

```text
Synchronous/blocking-looking method
→ biasanya worker thread

Reactive return type seperti Uni/Multi
→ biasanya event loop/non-blocking path

Annotation @Blocking
→ paksa worker

Annotation @NonBlocking
→ paksa event loop

Annotation virtual-thread support
→ jalankan dengan virtual thread jika dikonfigurasi/supported
```

Jangan hafal sebagai dogma. Selalu cek dokumentasi versi Quarkus yang dipakai, karena default dan annotation bisa berubah antar generasi RESTEasy Reactive/Quarkus REST.

### 6.2 Contoh Imperative Endpoint

```java
@Path("/orders")
public class OrderResource {

    private final OrderService orderService;

    public OrderResource(OrderService orderService) {
        this.orderService = orderService;
    }

    @GET
    @Path("/{id}")
    public OrderDto get(@PathParam("id") Long id) {
        return orderService.getBlocking(id);
    }
}
```

Karakteristik:

- mudah dibaca;
- cocok untuk Hibernate ORM blocking;
- cocok untuk JDBC;
- cocok untuk domain service imperative;
- risiko thread starvation jika dependency lambat;
- butuh timeout dan pool discipline.

### 6.3 Contoh Reactive Endpoint

```java
@Path("/orders")
public class OrderResource {

    private final OrderReactiveService orderService;

    public OrderResource(OrderReactiveService orderService) {
        this.orderService = orderService;
    }

    @GET
    @Path("/{id}")
    public Uni<OrderDto> get(@PathParam("id") Long id) {
        return orderService.get(id);
    }
}
```

Karakteristik:

- tidak menahan thread saat menunggu IO non-blocking;
- cocok untuk reactive SQL client, reactive REST client, messaging;
- butuh disiplin pipeline;
- debugging bisa lebih sulit;
- error handling harus eksplisit;
- jangan memanggil blocking code di pipeline event loop.

### 6.4 Contoh Forced Worker dengan `@Blocking`

```java
@GET
@Path("/report/{id}")
@Blocking
public ReportDto generate(@PathParam("id") Long id) {
    return reportService.generateBlockingReport(id);
}
```

Gunakan jika method terlihat reactive/non-blocking tetapi di dalamnya ada blocking work, atau jika kamu ingin eksplisit.

### 6.5 Contoh Forced Event Loop dengan `@NonBlocking`

```java
@GET
@Path("/status")
@NonBlocking
public StatusDto status() {
    return new StatusDto("ok");
}
```

Gunakan hanya untuk operasi sangat cepat, tidak blocking, tidak CPU-heavy.

### 6.6 Anti-Pattern: Reactive Signature Tetapi Blocking Inside

```java
@GET
@Path("/bad/{id}")
public Uni<OrderDto> bad(@PathParam("id") Long id) {
    return Uni.createFrom().item(() -> {
        // Ini supplier sinkron; jika dieksekusi di event loop dan memanggil blocking code, bahaya.
        return blockingRepository.find(id);
    });
}
```

Masalahnya:

```text
Return type reactive tidak otomatis membuat isi kode non-blocking.
```

Lebih benar:

1. pakai repository reactive benar-benar non-blocking; atau
2. offload blocking code ke worker/custom executor secara eksplisit; atau
3. gunakan endpoint imperative/worker.

---

## 7. Mutiny Mental Model

### 7.1 Uni dan Multi

Mutiny adalah library reactive utama di Quarkus.

Dua tipe utama:

```text
Uni<T>
- menghasilkan 0 atau 1 item atau failure
- cocok untuk HTTP response tunggal, DB lookup, command result

Multi<T>
- menghasilkan 0 sampai banyak item atau failure/completion
- cocok untuk stream, messaging, SSE, file stream, event stream
```

Contoh `Uni`:

```java
Uni<Customer> customer = customerClient.findById(id);
```

Contoh `Multi`:

```java
Multi<OrderEvent> events = orderEventStream.eventsFor(customerId);
```

### 7.2 Mutiny Bukan Future Biasa

`Uni` bukan sekadar `CompletableFuture` dengan nama lain.

Mental model:

```text
Uni/Multi adalah description of asynchronous computation.
Pipeline tidak selalu langsung jalan saat dibuat.
Eksekusi dipicu oleh subscription/request.
```

### 7.3 Transform vs Chain

#### Transform: sinkron, item ke item

```java
return customerClient.find(id)
    .onItem().transform(customer -> CustomerDto.from(customer));
```

Gunakan saat transformasi cepat dan tidak asynchronous.

#### Chain: asynchronous, item ke Uni lain

```java
return customerClient.find(id)
    .onItem().transformToUni(customer -> orderClient.findLatest(customer.id())
        .onItem().transform(order -> CustomerSummary.of(customer, order)));
```

Atau bentuk umum:

```java
return customerClient.find(id)
    .chain(customer -> orderClient.findLatest(customer.id())
        .map(order -> CustomerSummary.of(customer, order)));
```

Gunakan saat tahap berikutnya juga asynchronous.

### 7.4 Failure adalah Signal

Dalam reactive stream, failure bukan exception yang dilempar secara sinkron. Failure adalah event/signal dalam pipeline.

```java
return client.call()
    .onFailure(TimeoutException.class)
    .recoverWithItem(failure -> fallbackResponse());
```

Atau transform failure:

```java
return repository.find(id)
    .onFailure(DatabaseException.class)
    .transform(ex -> new ServiceUnavailableException("Database unavailable", ex));
```

### 7.5 Retry adalah Resubscription

Retry reactive bukan “lanjut dari titik gagal”. Retry berarti subscribe ulang ke upstream computation.

Implikasi penting:

```text
Jika upstream punya side effect, retry bisa mengulang side effect.
```

Contoh bahaya:

```java
return paymentClient.charge(command)
    .onFailure().retry().atMost(3);
```

Jika `charge` tidak idempotent, retry bisa menyebabkan double charge.

Lebih aman:

```text
- gunakan idempotency key;
- retry hanya untuk failure transient;
- batasi retry;
- gunakan delay/jitter;
- jangan retry semua exception;
- observasi retry count;
- hormati time budget request.
```

### 7.6 Timeout Harus Ada di Boundary

```java
return externalClient.getProfile(userId)
    .ifNoItem().after(Duration.ofMillis(800)).fail()
    .onFailure(TimeoutException.class)
    .recoverWithItem(ProfileDto.unavailable(userId));
```

Timeout harus dipasang di dependency boundary, bukan hanya global HTTP server timeout.

### 7.7 Jangan `.await()` di Event Loop

```java
// Buruk jika current thread adalah event loop
Customer customer = customerClient.find(id).await().indefinitely();
```

`.await()` mengubah asynchronous menjadi blocking wait. Ini kadang boleh di test atau worker thread, tetapi berbahaya di event loop.

---

## 8. Thread Switching dalam Mutiny

### 8.1 Kenapa Thread Switching Penting?

Reactive pipeline bisa berjalan di event loop, worker, atau executor lain tergantung sumber event dan operator.

Masalah umum:

```text
Engineer mengira semua tahap pipeline otomatis pindah thread.
Padahal banyak operator melanjutkan di thread yang sama dengan upstream signal.
```

### 8.2 `emitOn` vs `runSubscriptionOn`

Secara konseptual:

```text
runSubscriptionOn(executor)
→ memindahkan proses subscription/upstream production ke executor lain.

emitOn(executor)
→ memindahkan emission downstream ke executor lain.
```

Contoh konseptual untuk blocking supplier:

```java
return Uni.createFrom().item(() -> blockingRepository.find(id))
    .runSubscriptionOn(Infrastructure.getDefaultWorkerPool());
```

Contoh memindahkan downstream processing:

```java
return reactiveClient.get(id)
    .emitOn(cpuExecutor)
    .onItem().transform(this::expensiveTransform);
```

Catatan:

- jangan menyebar `emitOn` sembarangan;
- thread switch punya overhead;
- pindah thread bisa memengaruhi context/MDC;
- lebih baik desain boundary execution secara eksplisit.

### 8.3 Pattern Aman untuk Blocking Legacy Call

Misal punya library legacy blocking:

```java
public LegacyResponse callLegacy(LegacyRequest request) {
    return legacySdk.call(request); // blocking
}
```

Opsi 1: endpoint imperative dan worker:

```java
@POST
@Path("/legacy")
@Blocking
public LegacyResponseDto call(LegacyRequestDto dto) {
    return mapper.toDto(legacyService.call(dto));
}
```

Opsi 2: reactive facade dengan explicit offload:

```java
public Uni<LegacyResponseDto> call(LegacyRequestDto dto) {
    return Uni.createFrom().item(() -> legacyService.call(dto))
        .runSubscriptionOn(legacyExecutor)
        .onItem().transform(mapper::toDto);
}
```

Pilih opsi 1 jika aplikasi mayoritas imperative. Pilih opsi 2 jika kamu perlu compose dengan pipeline reactive lain.

---

## 9. Backpressure Deep Dive

### 9.1 Backpressure dengan Multi

`Multi` mewakili stream banyak item. Consumer dapat meminta item dalam jumlah tertentu.

Mental model:

```text
Subscriber: saya siap menerima 10 item.
Publisher: kirim maksimal 10 item.
Subscriber: selesai proses, minta lagi.
```

### 9.2 Demand Control

Demand control berguna saat:

- membaca stream dari sumber controllable;
- processing pipeline lebih lambat dari producer;
- ingin menghindari memory blow-up;
- ingin menjaga latency tetap stabil.

### 9.3 Backpressure vs Buffer

Buffer bukan backpressure. Buffer hanya menunda masalah.

```text
Producer cepat → buffer → consumer lambat
```

Jika buffer unbounded:

```text
latency naik → memory naik → GC pressure → OOM
```

Jika buffer bounded:

```text
saat penuh harus ada policy:
- drop;
- fail;
- block upstream;
- backpressure upstream;
- shed load;
- persist queue;
- DLQ.
```

### 9.4 Backpressure di Boundary Eksternal

#### HTTP Request

Untuk HTTP request biasa, backpressure internal tidak otomatis mencegah client mengirim request baru.

Butuh:

- rate limiting;
- max concurrent requests;
- load balancer limit;
- circuit breaker;
- queue bound;
- autoscaling.

#### Kafka

Kafka consumer bisa mengatur polling dan commit, tetapi backlog tetap ada di topic.

Butuh:

- consumer lag monitoring;
- concurrency/partition strategy;
- idempotent processing;
- DLQ;
- pause/resume;
- max inflight;
- retry topic.

#### Webhook

External webhook sering tidak peduli kapasitasmu.

Butuh:

- fast accept + durable queue;
- 429/503 policy;
- signature verification cepat;
- queue depth metric;
- retry contract dengan provider.

### 9.5 Backpressure dan Regulatory Systems

Untuk sistem case management/regulatory, backpressure bukan hanya technical concern. Ia menentukan fairness dan defensibility.

Contoh:

```text
Jika semua event appeal masuk bersamaan,
sistem harus bisa menjelaskan:
- event mana diterima;
- event mana ditolak;
- event mana ditunda;
- event mana retry;
- apakah ordering dipertahankan;
- apakah SLA dihitung dari received time atau processed time;
- apakah ada audit event untuk queue delay.
```

Top 1% engineer tidak hanya berkata “pakai queue”. Ia mendefinisikan semantics:

```text
admission → persistence → ordering → processing → retry → failure → audit → user-visible state
```

---

## 10. Decision Framework: Blocking, Reactive, atau Virtual Thread?

### 10.1 Pilih Imperative/Blocking Jika

Gunakan blocking style jika:

1. service dominan CRUD dengan Hibernate ORM/JDBC;
2. dependency libraries mayoritas blocking;
3. team lebih produktif dengan imperative code;
4. throughput requirement sedang;
5. latency target tidak ekstrem;
6. operability lebih penting daripada non-blocking purity;
7. request lifecycle sederhana;
8. tidak banyak streaming/concurrent long-lived connections.

Tetapi wajib punya:

- connection pool sizing;
- timeout;
- bulkhead;
- transaction discipline;
- observability;
- worker pool monitoring.

### 10.2 Pilih Reactive Jika

Gunakan reactive jika:

1. banyak IO non-blocking;
2. banyak concurrent request yang menunggu external services;
3. streaming/SSE/websocket/event stream;
4. messaging pipeline;
5. perlu compose banyak asynchronous dependency;
6. ingin meminimalkan blocked threads;
7. library yang dipakai benar-benar reactive;
8. team siap dengan pipeline mental model.

Tetapi wajib hindari:

- blocking call di event loop;
- nested callback/pipeline yang tidak terbaca;
- retry tanpa idempotency;
- unbounded merge/concurrency;
- hidden thread switching;
- error swallowed;
- `.await()` sembarangan.

### 10.3 Pilih Virtual Threads Jika

Gunakan virtual thread style jika:

1. ingin menjaga imperative code simplicity;
2. workload banyak blocking wait tetapi thread-per-request platform thread terlalu mahal;
3. Java runtime modern tersedia;
4. dependency blocking tetapi tidak terlalu pinning-heavy;
5. database pool/downstream capacity tetap dikontrol;
6. team belum perlu reactive pipeline kompleks.

Tetapi pahami:

```text
Virtual threads membuat waiting lebih murah,
tetapi tidak membuat database, HTTP dependency, atau downstream menjadi lebih cepat.
```

Jika DB pool hanya 50 connection, 10.000 virtual thread tetap tidak boleh memaksa 10.000 query concurrent.

### 10.4 Matrix Keputusan

| Kondisi | Imperative Worker | Reactive | Virtual Thread |
|---|---:|---:|---:|
| Hibernate ORM/JDBC | Sangat cocok | Tidak cocok kecuali offload | Cocok dengan limit |
| Hibernate Reactive | Tidak | Sangat cocok | Tidak utama |
| Streaming response | Bisa tapi kurang ideal | Sangat cocok | Tergantung |
| External HTTP non-blocking | Bisa | Cocok | Bisa |
| Legacy blocking SOAP | Cocok dengan isolation | Bisa via offload | Cocok dengan limit |
| CPU-heavy | Bisa dengan pool khusus | Tidak di event loop | Bisa tapi pool/limit tetap perlu |
| Code simplicity | Tinggi | Sedang-rendah | Tinggi |
| Tail latency under high IO wait | Sedang | Baik jika benar | Baik jika limit benar |
| Debuggability | Tinggi | Butuh skill | Tinggi-sedang |
| Native image compatibility | Baik jika libs aman | Baik jika libs reactive aman | Perlu validasi runtime |

---

## 11. Common Anti-Patterns

### 11.1 Reactive by Return Type Only

```java
public Uni<OrderDto> get(Long id) {
    return Uni.createFrom().item(orderRepository.findById(id));
}
```

Ini buruk karena `findById` dipanggil langsung saat method dieksekusi, bukan deferred non-blocking.

Lebih benar jika memang blocking:

```java
public Uni<OrderDto> get(Long id) {
    return Uni.createFrom().item(() -> orderRepository.findById(id))
        .runSubscriptionOn(blockingExecutor)
        .onItem().transform(mapper::toDto);
}
```

Atau jangan reactive:

```java
public OrderDto get(Long id) {
    return mapper.toDto(orderRepository.findById(id));
}
```

### 11.2 Await Inside Reactive Endpoint

```java
@GET
public Uni<ResponseDto> bad() {
    Data data = client.call().await().indefinitely();
    return Uni.createFrom().item(map(data));
}
```

Ini mengalahkan tujuan reactive dan bisa memblokir event loop.

### 11.3 Unbounded Concurrency

```java
return Multi.createFrom().iterable(ids)
    .onItem().transformToUniAndMerge(id -> client.call(id));
```

Jika `ids` berisi 100.000 item, kamu bisa menciptakan ledakan request ke downstream.

Lebih aman: batasi concurrency jika operator/API mendukung, atau chunk/pacing.

### 11.4 Retry Everything

```java
return client.call()
    .onFailure().retry().atMost(5);
```

Masalah:

- retry validation error tidak masuk akal;
- retry 401 bisa salah tanpa token refresh;
- retry 404 biasanya tidak berguna;
- retry 500 tanpa jitter bisa storm;
- retry command non-idempotent berbahaya.

### 11.5 Blocking Detection Dianggap Gangguan

Jika muncul error/warning blocking thread, jangan langsung “matikan warning”. Itu sinyal desain.

Tanyakan:

```text
- kode mana yang blocking?
- thread apa yang menjalankannya?
- apakah harus offload?
- apakah sebaiknya endpoint imperative?
- apakah dependency punya client reactive?
- apakah ada lock panjang?
```

### 11.6 Mixing Reactive and Transactions Tanpa Memahami Lifecycle

Blocking transaction:

```java
@Transactional
public Order create(Command command) { ... }
```

Reactive transaction berbeda. Jangan asal menaruh `@Transactional` pada pipeline reactive dan berharap semantics sama.

Untuk reactive persistence, transaction harus mengikuti pipeline reactive dan session reactive.

### 11.7 Event Loop untuk CPU Work

```java
return Uni.createFrom().item(payload)
    .onItem().transform(this::compressLargePayload);
```

Jika `compressLargePayload` berat dan pipeline berada di event loop, event loop bisa macet.

Offload CPU work:

```java
return Uni.createFrom().item(payload)
    .emitOn(cpuExecutor)
    .onItem().transform(this::compressLargePayload);
```

Tetapi lebih baik: desain explicit boundary dan ukur.

---

## 12. Patterns yang Baik

### 12.1 Imperative Service dengan Guardrail

```java
@Path("/cases")
public class CaseResource {

    private final CaseApplicationService service;

    public CaseResource(CaseApplicationService service) {
        this.service = service;
    }

    @POST
    @Transactional
    public Response submit(SubmitCaseRequest request) {
        CaseId id = service.submit(request);
        return Response.accepted(new SubmitCaseResponse(id.value())).build();
    }
}
```

Guardrail:

- transaction pendek;
- database pool jelas;
- timeout external call tidak di dalam transaction;
- audit event persisted;
- idempotency key jika command bisa diulang;
- endpoint tidak melakukan blocking external call panjang dalam DB transaction.

### 12.2 Reactive Composition untuk IO Non-Blocking

```java
public Uni<CaseSummaryDto> summary(String caseId) {
    Uni<CaseDto> caseUni = caseClient.get(caseId);
    Uni<List<TaskDto>> tasksUni = taskClient.list(caseId);
    Uni<RiskDto> riskUni = riskClient.evaluate(caseId);

    return Uni.combine().all().unis(caseUni, tasksUni, riskUni)
        .asTuple()
        .onItem().transform(tuple -> CaseSummaryDto.of(
            tuple.getItem1(),
            tuple.getItem2(),
            tuple.getItem3()
        ));
}
```

Cocok jika semua client benar-benar non-blocking.

Tambahkan:

- per-client timeout;
- fallback untuk dependency optional;
- correlation ID;
- bounded concurrency;
- error taxonomy.

### 12.3 Hybrid Boundary

Kadang model terbaik adalah hybrid:

```text
HTTP REST resource imperative
→ domain command synchronous
→ persist outbox
→ messaging reactive pipeline
→ external integration async
```

Contoh:

```text
Submit case
1. Validate request
2. Persist case + audit + outbox in one DB transaction
3. Return accepted
4. Outbox publisher emits event
5. Integration worker calls external systems asynchronously
```

Ini sering lebih defensible daripada membuat seluruh request path reactive dan menunggu semua downstream selesai.

### 12.4 Fast Accept + Async Processing

Untuk workload yang tidak perlu selesai dalam request:

```text
POST /applications/{id}/screening
→ validate command
→ persist screening_requested
→ enqueue work
→ return 202 Accepted
```

Lalu worker:

```text
consume screening_requested
→ call screening engine
→ persist result
→ emit screening_completed
```

Keuntungan:

- request latency stabil;
- downstream failure tidak langsung merusak UX;
- retry bisa dikontrol;
- audit trail jelas;
- SLA bisa dipisah antara acceptance dan completion.

---

## 13. Failure Mode Analysis

### 13.1 Blocking Leak

```text
Reactive endpoint
→ calls blocking SDK
→ event loop blocked
→ latency spike
→ health check delayed
→ pod killed/restarted
```

Mitigasi:

- identify blocking dependency;
- mark endpoint `@Blocking` atau offload;
- replace with non-blocking client;
- add blocked thread monitoring;
- add test detecting thread name/path.

### 13.2 Worker Starvation

```text
JDBC slow
→ all workers wait
→ incoming requests queue
→ p99 explodes
→ retry storm
```

Mitigasi:

- DB timeout;
- max request concurrency;
- circuit breaker;
- DB pool sizing;
- bulkhead per dependency;
- cache degraded response if safe;
- fail fast.

### 13.3 Event Loop CPU Saturation

```text
Non-blocking endpoint
→ large JSON transform/compression
→ event loop burns CPU
→ other connections delayed
```

Mitigasi:

- payload size limit;
- offload CPU-heavy work;
- streaming parser;
- backpressure;
- profiling;
- avoid large response generation in event loop.

### 13.4 Reactive Pipeline Memory Blow-Up

```text
Multi stream
→ producer faster than consumer
→ unbounded buffer
→ memory grows
→ GC pressure
→ OOM
```

Mitigasi:

- bounded buffer;
- demand control;
- concurrency limit;
- drop/fail policy;
- persistent queue;
- consumer lag monitoring.

### 13.5 Retry Storm

```text
External API slow
→ many calls timeout
→ each request retries 3 times
→ load triples
→ external API worse
→ service worse
```

Mitigasi:

- retry only transient failures;
- exponential backoff + jitter;
- retry budget;
- circuit breaker;
- bulkhead;
- idempotency key;
- global time budget.

### 13.6 Context Loss

```text
Request starts with correlation ID
→ reactive pipeline switches thread
→ MDC lost
→ logs cannot be correlated
```

Mitigasi:

- use Quarkus/SmallRye context propagation;
- avoid manual ThreadLocal assumptions;
- test correlation ID across async boundary;
- include trace/span IDs.

---

## 14. Observability for Execution Model

### 14.1 Metrics yang Harus Ada

Minimal:

```text
HTTP:
- request rate
- latency p50/p95/p99/p999
- status code distribution
- inflight requests

Threading:
- event loop blocked count/warnings
- worker pool active count
- worker queue size if available
- executor saturation

Dependencies:
- DB pool active/idle/pending
- external client latency
- timeout count
- retry count
- circuit breaker state

Reactive/Messaging:
- message processing latency
- consumer lag
- nack count
- DLQ count
- buffer depth
- max in-flight
```

### 14.2 Logs yang Berguna

Log harus menjawab:

```text
- request id/correlation id apa?
- user/principal siapa? jika aman dicatat
- endpoint/operation apa?
- dependency mana yang lambat?
- timeout di mana?
- retry berapa kali?
- fallback dipakai atau tidak?
- event diterima, diproses, gagal, atau dikirim ke DLQ?
```

### 14.3 Tracing

Trace penting untuk reactive service karena call stack sinkron tidak cukup.

Trace harus menunjukkan:

```text
HTTP request
→ validation
→ DB query
→ external REST call
→ Kafka publish
→ response
```

Untuk async messaging:

```text
command accepted
→ outbox event
→ publisher
→ consumer
→ downstream call
→ state update
```

### 14.4 Thread Dump Reading

Saat incident, lihat:

```text
- apakah vert.x-eventloop-thread sedang BLOCKED/WAITING?
- apakah worker thread penuh menunggu DB/socket?
- apakah ada synchronized lock panjang?
- apakah ada ForkJoinPool/commonPool tak terduga?
- apakah custom executor saturated?
```

---

## 15. Performance Reasoning

### 15.1 Throughput Bukan Satu-Satunya Ukuran

Jangan hanya mengukur RPS. Ukur:

- p99 latency;
- p999 latency;
- memory RSS;
- heap allocation rate;
- CPU utilization;
- event loop delay;
- worker saturation;
- DB pool pending;
- downstream error rate;
- retry amplification;
- queue depth;
- cold start;
- warm steady state.

### 15.2 Reactive Bisa Lebih Lambat untuk Kasus Sederhana

Untuk endpoint sederhana:

```text
GET /lookup/{id}
→ one DB query
→ return DTO
```

Imperative worker + Hibernate ORM bisa lebih sederhana dan cukup cepat.

Reactive memberi benefit jika thread waiting menjadi bottleneck atau ada banyak concurrent IO non-blocking.

### 15.3 Reactive Bisa Lebih Cepat Secara Resource Efficiency

Untuk workload:

```text
- banyak concurrent connection;
- banyak external HTTP non-blocking;
- streaming;
- websocket;
- event-driven pipeline;
```

Reactive bisa mengurangi thread blocked dan memory overhead.

### 15.4 Bottleneck Tetap Bisa Ada di Downstream

Non-blocking tidak menghapus bottleneck:

```text
DB pool 30 connection
→ maksimal 30 query concurrent yang benar-benar berjalan
```

Jika reactive pipeline mengirim 10.000 query sekaligus, kamu hanya memindahkan bottleneck ke DB/pool/queue.

---

## 16. Production Checklist

### 16.1 Endpoint Checklist

Untuk setiap endpoint:

- Apakah endpoint blocking atau non-blocking?
- Thread apa yang menjalankan business code?
- Apakah ada blocking call?
- Apakah annotation sudah eksplisit jika perlu?
- Apakah ada timeout dependency?
- Apakah ada retry? Apakah aman/idempotent?
- Apakah response contract stabil?
- Apakah error mapping jelas?
- Apakah transaction boundary pendek?
- Apakah logging/correlation tersedia?

### 16.2 Reactive Pipeline Checklist

- Apakah semua dependency benar-benar non-blocking?
- Apakah ada `.await()`?
- Apakah ada blocking transformation?
- Apakah concurrency dibatasi?
- Apakah failure ditangani?
- Apakah timeout dipasang?
- Apakah retry dibatasi?
- Apakah context propagation aman?
- Apakah backpressure berlaku sampai upstream?
- Apakah buffer bounded?

### 16.3 Worker Pool Checklist

- Apakah worker pool bisa saturated?
- Apakah blocking dependency punya pool sendiri?
- Apakah DB pool lebih kecil dari worker pool secara masuk akal?
- Apakah ada queue tak terlihat?
- Apakah ada operation CPU-heavy yang perlu executor khusus?
- Apakah timeout lebih kecil dari upstream client timeout?
- Apakah ada metric active/queued?

### 16.4 Backpressure Checklist

- Siapa producer?
- Siapa consumer?
- Apakah producer controllable?
- Apa policy saat consumer lambat?
- Apakah buffer bounded?
- Apa yang terjadi saat queue penuh?
- Apakah event bisa didrop?
- Apakah ordering penting?
- Apakah retry bisa mengubah ordering?
- Apakah deduplication tersedia?
- Apakah ada audit trail untuk delay/failure?

---

## 17. Case Study: Screening Request di Regulatory Case Management

### 17.1 Skenario

Ada endpoint:

```text
POST /cases/{caseId}/screening-requests
```

Endpoint ini harus:

1. menerima command dari officer;
2. validasi permission dan case state;
3. persist request;
4. call external screening engine;
5. update result;
6. audit semua step.

### 17.2 Desain Buruk: Semua Dikerjakan dalam Request

```text
HTTP request
→ DB transaction open
→ validate
→ call external screening engine blocking 20s
→ update DB
→ commit
→ return
```

Masalah:

- transaction terlalu lama;
- DB lock lama;
- worker thread tertahan;
- external timeout membuat user wait;
- retry client bisa duplicate;
- audit partial sulit;
- failure external membuat command acceptance gagal;
- throughput buruk.

### 17.3 Desain Lebih Baik: Fast Accept + Outbox

```text
HTTP request
→ validate permission/state
→ begin transaction
→ persist screening_request status=PENDING
→ persist audit event SCREENING_REQUESTED
→ persist outbox event ScreeningRequested
→ commit
→ return 202 Accepted

Async worker
→ read outbox/event
→ call screening engine with timeout/retry/idempotency
→ persist result SUCCESS/FAILED
→ persist audit event SCREENING_COMPLETED/FAILED
```

Keuntungan:

- request cepat;
- transaction pendek;
- external failure isolated;
- retry controlled;
- audit complete;
- state machine explicit;
- SLA bisa dipisah acceptance vs processing;
- worker concurrency bisa dibatasi;
- backpressure bisa diterapkan di queue/outbox.

### 17.4 Reactive atau Blocking?

Pilihan rasional:

#### HTTP command endpoint

Imperative/blocking worker cukup baik karena:

- validasi domain state;
- DB transaction pendek;
- mudah diaudit;
- tidak perlu menunggu external engine.

#### Outbox publisher

Bisa reactive/messaging karena:

- event-driven;
- banyak IO;
- backpressure penting;
- retry/dedup lebih eksplisit.

#### External screening worker

Tergantung client:

- jika screening SDK blocking: gunakan worker/custom executor/virtual thread dengan concurrency limit;
- jika HTTP reactive client tersedia: gunakan reactive pipeline dengan timeout, retry, circuit breaker, max in-flight.

### 17.5 Invariant Desain

```text
1. Tidak ada external call panjang di dalam DB transaction.
2. Semua command punya idempotency/correlation key.
3. Semua state transition diaudit.
4. Semua retry aman atau dicegah.
5. Semua queue punya bounded capacity atau operational policy.
6. Semua failure menghasilkan state yang bisa dijelaskan.
```

---

## 18. Latihan Top 1% Engineer

### Latihan 1 — Thread Classification

Ambil 10 endpoint di sistemmu. Untuk masing-masing, klasifikasikan:

```text
- blocking worker;
- non-blocking event loop;
- virtual thread;
- mixed/hybrid;
- unknown.
```

Jika ada yang `unknown`, itu technical risk.

### Latihan 2 — Blocking Leak Hunt

Cari semua kode yang memakai:

```text
- Thread.sleep
- CompletableFuture.get/join
- Uni.await
- blocking HTTP client
- JDBC/Hibernate ORM
- file IO besar
- synchronized block panjang
- crypto/compression besar
```

Tentukan apakah kode tersebut bisa berjalan di event loop.

### Latihan 3 — Retry Safety Review

Untuk setiap retry:

```text
- failure apa yang diretry?
- berapa maksimal retry?
- ada delay/jitter?
- operasi idempotent?
- ada idempotency key?
- timeout total berapa?
- retry metric ada?
```

### Latihan 4 — Backpressure Contract

Untuk setiap pipeline async:

```text
producer → buffer/queue → consumer → downstream
```

Jawab:

- siapa bisa diperlambat?
- siapa tidak bisa diperlambat?
- apa policy saat penuh?
- apakah ordering penting?
- bagaimana audit delay?
- apakah DLQ cukup atau perlu manual remediation?

### Latihan 5 — Convert Endpoint Design

Ambil endpoint blocking panjang. Buat 3 desain:

1. tetap imperative tetapi diberi timeout/bulkhead;
2. reactive non-blocking end-to-end;
3. fast accept + async processing.

Bandingkan:

- latency;
- consistency;
- user experience;
- auditability;
- implementation complexity;
- failure mode;
- operational control.

---

## 19. Ringkasan Invariants

Pegang invariant berikut:

1. **Event loop harus cepat dan tidak boleh blocking.**
2. **Reactive return type tidak otomatis membuat kode non-blocking.**
3. **Worker thread boleh blocking, tetapi tetap resource terbatas.**
4. **Virtual thread membuat blocking wait lebih murah, bukan membuat downstream tak terbatas.**
5. **Backpressure hanya efektif jika upstream dapat dikontrol.**
6. **Buffer tanpa bound adalah bom waktu memory.**
7. **Retry adalah load amplifier jika tidak dibatasi.**
8. **Timeout harus dipasang di dependency boundary.**
9. **Transaction tidak boleh menahan external call panjang.**
10. **Execution model adalah bagian dari architecture decision, bukan detail framework.**
11. **Observability harus menunjukkan thread, queue, pool, timeout, retry, dan downstream behavior.**
12. **Hybrid architecture sering lebih baik daripada memaksa semua reactive atau semua blocking.**

---

## 20. Penutup

Part ini adalah fondasi untuk memahami banyak part berikutnya:

- Hibernate ORM vs Hibernate Reactive;
- REST Client Reactive;
- Messaging;
- Scheduler dan batch;
- Fault tolerance;
- Observability;
- Native image;
- Virtual threads;
- production tuning.

Jika kamu hanya menghafal annotation `@Blocking` dan `@NonBlocking`, kamu akan mudah salah desain. Yang lebih penting adalah memahami hubungan:

```text
workload → dependency behavior → execution model → resource limit → failure mode → observability → production policy
```

Quarkus memberi fleksibilitas besar karena bisa menggabungkan imperative, reactive, dan virtual-thread style. Tetapi fleksibilitas itu hanya aman jika setiap boundary punya semantics yang eksplisit.

---

## 21. Referensi Resmi yang Relevan

- Quarkus Reactive Architecture
- Quarkus REST execution model
- Quarkus REST / RESTEasy Reactive blocking vs non-blocking dispatch
- Quarkus Vert.x reference
- Quarkus Mutiny primer
- SmallRye Mutiny guides: Uni, Multi, failure handling, retry, demand/backpressure
- Quarkus duplicated context and context propagation
- Quarkus virtual threads articles/guides



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-008.md">⬅️ Part 008 — REST Layer Deep Dive: Quarkus REST, RESTEasy Reactive, Routing, Filters, Exception Mapping</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-010.md">Part 010 — Persistence I: Hibernate ORM di Quarkus Tanpa Mengulang JPA Dasar ➡️</a>
</div>
