# Part 14 — WebFlux and Reactive Spring Architecture

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `14-webflux-reactive-spring-architecture.md`  
> Status seri: Part 14 dari 35 — belum selesai  
> Prasyarat internal: Part 0–13, terutama IoC container, lifecycle, AOP/proxy, transaction boundary, Web MVC runtime, dan REST API engineering.

---

## 0. Tujuan Part Ini

Bagian ini membahas **Spring WebFlux** dan arsitektur reactive Spring dari sudut pandang engineer yang harus membuat keputusan produksi, bukan sekadar menulis `Mono<User>` atau `Flux<Order>`.

Kita tidak akan mengulang teori reactive programming dari nol secara generik. Fokusnya adalah:

1. Bagaimana WebFlux masuk ke dalam arsitektur Spring.
2. Apa bedanya dengan Spring MVC secara runtime, execution model, dan failure model.
3. Bagaimana `Mono`, `Flux`, event loop, backpressure, scheduler, dan non-blocking I/O bekerja dalam aplikasi Spring.
4. Kapan WebFlux layak dipilih.
5. Kapan WebFlux justru menjadi keputusan yang buruk.
6. Bagaimana membandingkan WebFlux dengan MVC + virtual threads pada Java 21–25.
7. Bagaimana mendesain API, client, error handling, security, observability, dan testing untuk reactive Spring.

Target akhirnya: Anda bisa membaca, mendesain, mereview, dan memperbaiki sistem WebFlux tanpa terjebak pada slogan “reactive lebih cepat”.

---

## 1. Mental Model Utama: Reactive Bukan Sinonim dari Cepat

Banyak engineer salah memulai WebFlux dari asumsi:

```text
WebFlux = lebih cepat dari MVC
```

Asumsi itu terlalu kasar dan sering salah.

Mental model yang lebih benar:

```text
WebFlux = model eksekusi non-blocking + asynchronous + backpressure-aware
          untuk workload yang didominasi waiting I/O dan membutuhkan skalabilitas koneksi/concurrency tinggi.
```

WebFlux tidak membuat CPU Anda lebih cepat. WebFlux juga tidak membuat query database lebih cepat. WebFlux mengubah **cara thread digunakan** ketika aplikasi menunggu I/O.

Pada MVC tradisional:

```text
1 request biasanya memakai 1 server thread selama request berlangsung.
Jika request menunggu DB/API/file/network, thread itu ikut menunggu.
```

Pada WebFlux:

```text
request tidak perlu memegang 1 thread selama seluruh durasi.
Thread event loop dapat memproses banyak koneksi karena operasi I/O didesain non-blocking.
```

Artinya, WebFlux paling bernilai ketika bottleneck Anda adalah:

- banyak koneksi concurrent,
- banyak waiting time ke service lain,
- streaming response,
- server-sent events,
- websocket/reactive stream,
- fan-out/fan-in I/O non-blocking,
- kebutuhan backpressure antar pipeline.

WebFlux tidak otomatis cocok untuk:

- aplikasi CRUD sederhana dengan JDBC blocking,
- tim yang belum paham reactive debugging,
- sistem yang dominan CPU-bound,
- codebase yang banyak library blocking,
- transaction-heavy OLTP dengan JDBC dan JPA,
- workflow enterprise yang lebih butuh clarity daripada event-loop efficiency.

---

## 2. Posisi WebFlux di Ekosistem Spring

Spring memiliki dua web stack utama:

```text
Spring MVC    : Servlet stack, imperative, thread-per-request style.
Spring WebFlux: Reactive stack, non-blocking, Reactive Streams-based.
```

Spring MVC dibangun di atas Servlet API. WebFlux dibangun di atas abstraction reactive yang dapat berjalan di server non-blocking seperti Reactor Netty, dan juga dapat beradaptasi ke servlet container tertentu.

Pemisahan mentalnya:

```text
Spring MVC
  └─ DispatcherServlet
      └─ HandlerMapping
      └─ HandlerAdapter
      └─ HandlerMethodArgumentResolver
      └─ HttpMessageConverter
      └─ HandlerExceptionResolver

Spring WebFlux
  └─ HttpHandler / WebHandler / DispatcherHandler
      └─ HandlerMapping
      └─ HandlerAdapter
      └─ HandlerResultHandler
      └─ HttpMessageReader / HttpMessageWriter
      └─ WebExceptionHandler
```

Secara rasa pemrograman, keduanya mirip karena sama-sama mendukung annotation seperti:

```java
@RestController
@RequestMapping("/users")
class UserController {

    @GetMapping("/{id}")
    Mono<UserResponse> get(@PathVariable String id) {
        return userService.get(id);
    }
}
```

Tetapi runtime-nya berbeda. Kemiripan annotation dapat menipu. Di baliknya, WebFlux memiliki constraint yang jauh lebih ketat: **jangan block event loop**.

---

## 3. Reactive Streams Contract

WebFlux berdiri di atas konsep Reactive Streams. Contract dasarnya melibatkan empat konsep:

```text
Publisher<T>    : sumber data/event.
Subscriber<T>   : penerima data/event.
Subscription    : hubungan antara publisher dan subscriber.
Processor       : komponen yang sekaligus subscriber dan publisher.
```

Sinyal utama dalam stream:

```text
onSubscribe(subscription)
onNext(item)
onError(error)
onComplete()
```

Invariant penting:

1. Stream berakhir hanya dengan `onComplete` atau `onError`.
2. Setelah terminal signal, tidak boleh ada signal lain.
3. Subscriber dapat meminta jumlah item melalui demand/request.
4. Publisher tidak boleh membanjiri subscriber melebihi demand.

Inilah dasar backpressure.

Backpressure bukan retry. Bukan rate limit. Bukan queue biasa.

Backpressure adalah mekanisme supaya consumer dapat mengatakan:

```text
Saya hanya siap menerima N item sekarang.
```

Dalam sistem HTTP request/response biasa, backpressure sering tidak terlihat secara eksplisit. Tetapi dalam streaming, file transfer, SSE, WebSocket, message pipeline, atau fan-out data flow, backpressure sangat penting.

---

## 4. Reactor: `Mono` dan `Flux`

Spring WebFlux memakai Project Reactor sebagai reactive library utama.

Dua tipe paling umum:

```text
Mono<T> : stream 0 atau 1 item.
Flux<T> : stream 0 sampai banyak item.
```

Mental model:

```text
Mono<User>       = nanti mungkin ada satu User, atau kosong, atau error.
Flux<Event>      = nanti ada banyak Event, bisa selesai, bisa error.
```

Contoh:

```java
Mono<User> oneUser = userRepository.findById(id);

Flux<Order> manyOrders = orderRepository.findByUserId(userId);
```

Yang penting: `Mono` dan `Flux` adalah **declarative pipeline**, bukan hasil yang sudah langsung ada.

Kode ini belum mengeksekusi operasi sampai ada subscription:

```java
Mono<User> user = userClient.fetchUser("u-123")
    .map(this::normalize)
    .doOnNext(this::audit);
```

Pipeline reactive mirip blueprint:

```text
source → operator → operator → operator → subscriber
```

Dalam WebFlux server, framework menjadi subscriber untuk return value controller.

---

## 5. Lazy Execution dan Subscription

Kesalahan umum engineer MVC saat pindah ke WebFlux:

```java
Mono<User> user = service.getUser(id);
System.out.println("done");
return user;
```

Mereka mengira `service.getUser(id)` sudah selesai sebelum `done` dicetak. Belum tentu.

Dalam reactive pipeline:

```text
method call membangun pipeline;
subscription menjalankan pipeline.
```

Karena itu, side effect harus dimasukkan ke pipeline dengan hati-hati:

```java
return userService.getUser(id)
    .doOnNext(user -> log.info("found user {}", user.id()))
    .map(UserResponse::from);
```

Jangan seperti ini:

```java
Mono<User> user = userService.getUser(id);
log.info("found user"); // ini bukan berarti user sudah ditemukan
return user.map(UserResponse::from);
```

---

## 6. Event Loop Model

Default WebFlux dengan Reactor Netty memakai event loop model.

Model konseptual:

```text
sedikit thread event loop
    ├─ menerima koneksi
    ├─ membaca request secara non-blocking
    ├─ menjalankan callback ringan
    ├─ menulis response secara non-blocking
    └─ tidak boleh dipakai untuk blocking operation
```

Event loop thread harus cepat kembali ke loop. Jika Anda melakukan blocking call di event loop, dampaknya besar:

```text
1 blocking call → event loop tertahan → banyak koneksi ikut tertahan
```

Contoh operasi blocking yang berbahaya di event loop:

```java
Thread.sleep(1000);
fileInputStream.read();
jdbcTemplate.queryForObject(...);
restTemplate.getForObject(...);
future.get();
blockingQueue.take();
process.waitFor();
```

Dalam MVC, blocking call membuat satu request/thread lambat. Dalam WebFlux, blocking call di event loop dapat membuat banyak request terdampak.

---

## 7. Non-Blocking I/O vs Asynchronous vs Parallel

Tiga istilah ini sering tercampur.

### 7.1 Non-blocking

Thread tidak menunggu operasi I/O selesai.

```text
start network read → register callback → thread bebas mengerjakan hal lain
```

### 7.2 Asynchronous

Hasil operasi datang nanti.

```text
call now → result later
```

### 7.3 Parallel

Banyak pekerjaan berjalan bersamaan di banyak CPU/thread.

```text
work A on thread 1
work B on thread 2
work C on thread 3
```

WebFlux terutama tentang **non-blocking asynchronous I/O**, bukan otomatis parallel CPU processing.

Jika Anda punya CPU-bound task berat, WebFlux tidak otomatis membuatnya aman. Anda perlu mengatur scheduler/worker pool secara eksplisit, atau tetap memilih model imperative yang lebih sederhana.

---

## 8. Scheduler di Reactor

Scheduler menentukan di mana pipeline dieksekusi.

Beberapa scheduler umum:

```text
immediate        : eksekusi di thread saat ini.
single           : satu thread reusable.
parallel         : pool fixed untuk CPU-bound work.
boundedElastic   : pool elastis terbatas untuk blocking I/O yang tidak bisa dihindari.
```

Contoh memindahkan blocking call ke bounded elastic:

```java
Mono<User> findUserBlocking(String id) {
    return Mono.fromCallable(() -> legacyJdbcUserDao.findById(id))
        .subscribeOn(Schedulers.boundedElastic());
}
```

Tetapi ini adalah kompromi, bukan pembenaran untuk menulis seluruh aplikasi WebFlux dengan library blocking.

Jika semua operasi utama blocking lalu Anda bungkus dengan `boundedElastic`, Anda sedang membangun MVC yang lebih rumit.

Rule of thumb:

```text
Sedikit blocking adapter di tepi sistem: masih masuk akal.
Mayoritas stack blocking: lebih baik MVC + platform threads/virtual threads.
```

---

## 9. WebFlux Request Lifecycle

Lifecycle WebFlux annotation controller secara sederhana:

```text
HTTP request
  → HttpHandler
  → WebHandler
  → DispatcherHandler
  → HandlerMapping
  → HandlerAdapter
  → Controller method
  → HandlerResult
  → HandlerResultHandler
  → HttpMessageWriter
  → HTTP response
```

Bandingkan dengan MVC:

```text
HTTP request
  → DispatcherServlet
  → HandlerMapping
  → HandlerAdapter
  → Controller method
  → ReturnValueHandler
  → HttpMessageConverter
  → HTTP response
```

Konsep mirip, runtime berbeda.

Di WebFlux, body request/response diproses sebagai stream data buffer. Serialization/deserialization memakai codec reactive:

```text
HttpMessageReader
HttpMessageWriter
Encoder
Decoder
```

---

## 10. Annotated Controller vs Functional Endpoint

WebFlux mendukung dua gaya utama.

### 10.1 Annotated Controller

Mirip MVC:

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final CaseService caseService;

    CaseController(CaseService caseService) {
        this.caseService = caseService;
    }

    @GetMapping("/{id}")
    Mono<CaseResponse> get(@PathVariable String id) {
        return caseService.findCase(id)
            .map(CaseResponse::from);
    }
}
```

Kelebihan:

- familiar untuk Spring team,
- cocok untuk aplikasi REST biasa,
- integrasi annotation validation/security lebih natural,
- onboarding lebih mudah.

### 10.2 Functional Endpoint

Routing dan handler dipisahkan secara functional:

```java
@Configuration
class CaseRoutes {

    @Bean
    RouterFunction<ServerResponse> routes(CaseHandler handler) {
        return RouterFunctions.route()
            .GET("/cases/{id}", handler::get)
            .POST("/cases", handler::create)
            .build();
    }
}
```

Handler:

```java
@Component
class CaseHandler {

    private final CaseService caseService;

    CaseHandler(CaseService caseService) {
        this.caseService = caseService;
    }

    Mono<ServerResponse> get(ServerRequest request) {
        String id = request.pathVariable("id");
        return caseService.findCase(id)
            .flatMap(c -> ServerResponse.ok().bodyValue(CaseResponse.from(c)))
            .switchIfEmpty(ServerResponse.notFound().build());
    }
}
```

Kelebihan:

- routing eksplisit,
- cocok untuk API gateway/lightweight edge service,
- mudah compose routing,
- terasa lebih dekat dengan reactive pipeline.

Kekurangan:

- lebih verbose,
- sebagian tim lebih sulit membaca,
- discipline error/validation harus lebih eksplisit.

---

## 11. Operator Penting dan Maknanya

### 11.1 `map`

Transformasi synchronous item ke item lain.

```java
return userMono.map(UserResponse::from);
```

Pakai ketika fungsi transformasi tidak menghasilkan `Mono`/`Flux`.

### 11.2 `flatMap`

Transformasi item ke publisher lain.

```java
return userRepository.findById(id)
    .flatMap(user -> orderRepository.findLatestByUserId(user.id()));
```

Pakai ketika fungsi menghasilkan operasi asynchronous/reactive lain.

### 11.3 `concatMap`

Menjaga urutan.

```java
return Flux.fromIterable(commands)
    .concatMap(commandProcessor::process);
```

### 11.4 `switchIfEmpty`

Fallback ketika tidak ada item.

```java
return userRepository.findById(id)
    .switchIfEmpty(Mono.error(new UserNotFoundException(id)));
```

### 11.5 `onErrorResume`

Fallback berdasarkan error.

```java
return externalClient.fetch(id)
    .onErrorResume(TimeoutException.class, e -> cacheClient.fetch(id));
```

### 11.6 `doOnNext`, `doOnError`, `doFinally`

Side effect untuk logging/metrics/tracing, bukan transformasi data.

```java
return service.execute(command)
    .doOnNext(result -> metrics.incrementSuccess())
    .doOnError(error -> metrics.incrementFailure())
    .doFinally(signal -> log.debug("finished with {}", signal));
```

### 11.7 `timeout`

Batas waktu pipeline.

```java
return client.fetchProfile(userId)
    .timeout(Duration.ofSeconds(2));
```

### 11.8 `retryWhen`

Retry dengan policy.

```java
return client.call()
    .retryWhen(Retry.backoff(3, Duration.ofMillis(200))
        .filter(this::isRetryable));
```

Retry harus dikaitkan dengan idempotency.

---

## 12. Kesalahan `map` vs `flatMap`

Kesalahan umum:

```java
Mono<Mono<Order>> nested = userRepository.findById(id)
    .map(user -> orderRepository.findLatestByUserId(user.id()));
```

Yang benar:

```java
Mono<Order> order = userRepository.findById(id)
    .flatMap(user -> orderRepository.findLatestByUserId(user.id()));
```

Mental model:

```text
map     : T → R
flatMap : T → Publisher<R>
```

---

## 13. Empty vs Error

Dalam reactive API, `empty` dan `error` adalah dua state berbeda.

```text
Mono.empty()       = tidak ada data, bukan error.
Mono.error(e)      = gagal.
Mono.just(value)   = sukses dengan data.
```

Untuk REST:

```java
@GetMapping("/{id}")
Mono<ResponseEntity<UserResponse>> get(@PathVariable String id) {
    return userService.find(id)
        .map(UserResponse::from)
        .map(ResponseEntity::ok)
        .switchIfEmpty(Mono.just(ResponseEntity.notFound().build()));
}
```

Tetapi untuk domain rule, missing data mungkin lebih baik menjadi domain exception:

```java
return userService.findRequired(id)
    .map(UserResponse::from);
```

Di service:

```java
Mono<User> findRequired(String id) {
    return repository.findById(id)
        .switchIfEmpty(Mono.error(new UserNotFoundException(id)));
}
```

Decision rule:

```text
Empty adalah valid absence.
Error adalah failure atau rule violation.
```

---

## 14. WebClient sebagai Reactive HTTP Client

WebFlux sering dipakai bukan hanya sebagai server, tetapi sebagai client stack melalui `WebClient`.

Contoh:

```java
@Component
class ProfileClient {

    private final WebClient webClient;

    ProfileClient(WebClient.Builder builder) {
        this.webClient = builder
            .baseUrl("https://profile-service")
            .build();
    }

    Mono<ProfileResponse> getProfile(String userId) {
        return webClient.get()
            .uri("/profiles/{userId}", userId)
            .retrieve()
            .bodyToMono(ProfileResponse.class);
    }
}
```

Production client harus punya:

- timeout,
- error mapping,
- retry policy jika aman,
- correlation ID propagation,
- metrics/tracing,
- response size guard,
- connection pool governance,
- idempotency rule.

Contoh error mapping:

```java
Mono<ProfileResponse> getProfile(String userId) {
    return webClient.get()
        .uri("/profiles/{userId}", userId)
        .retrieve()
        .onStatus(status -> status.value() == 404,
            response -> Mono.error(new ProfileNotFoundException(userId)))
        .onStatus(HttpStatusCode::is5xxServerError,
            response -> Mono.error(new ProfileServiceUnavailableException()))
        .bodyToMono(ProfileResponse.class)
        .timeout(Duration.ofSeconds(2));
}
```

---

## 15. Blocking Boundary dalam WebFlux

WebFlux production design harus sangat jelas membedakan:

```text
reactive-safe operation
blocking operation
CPU-heavy operation
legacy adapter
```

### 15.1 Reactive-safe operation

Contoh:

- reactive HTTP client,
- reactive Redis client,
- reactive MongoDB driver,
- R2DBC,
- non-blocking file/network API.

### 15.2 Blocking operation

Contoh:

- JDBC,
- JPA/Hibernate,
- `RestTemplate`,
- synchronous SDK,
- blocking filesystem read,
- heavy cryptographic call di request path,
- legacy SOAP client.

### 15.3 Blocking adapter pattern

Jika tidak bisa dihindari:

```java
Mono<CaseRecord> findCase(String id) {
    return Mono.fromCallable(() -> caseJdbcDao.findById(id))
        .subscribeOn(Schedulers.boundedElastic());
}
```

Tetapi batasi dan isolasi:

```text
Controller reactive
  → service reactive
      → legacy adapter explicitly scheduled
```

Jangan menyebarkan blocking call di sembarang operator.

---

## 16. R2DBC vs JDBC/JPA

WebFlux sering dikaitkan dengan R2DBC.

Mental model:

```text
JDBC/JPA  : blocking database access.
R2DBC     : reactive non-blocking relational database access.
```

Tetapi R2DBC bukan JPA reactive. Jangan mengharapkan fitur ORM penuh seperti Hibernate.

Trade-off:

| Aspek | JDBC/JPA | R2DBC |
|---|---|---|
| Model | blocking | non-blocking reactive |
| ORM richness | tinggi dengan JPA/Hibernate | lebih rendah |
| Transaction model | matang dan familiar | reactive transaction, butuh discipline |
| Ecosystem legacy | sangat luas | lebih terbatas |
| Debuggability | lebih familiar | lebih kompleks |
| Cocok untuk | OLTP enterprise umum | high-concurrency non-blocking relational access |

Jika sistem Anda heavily domain-rich dengan JPA aggregate, lazy loading, dirty checking, dan transaction-heavy use case, pindah ke WebFlux + R2DBC bukan keputusan kecil. Itu perubahan application model.

---

## 17. Reactive Transaction Boundary

Reactive transaction tidak sama dengan imperative transaction.

Dalam imperative Spring:

```text
transaction context sering diikat ke ThreadLocal.
```

Dalam reactive:

```text
execution bisa berpindah thread;
context harus mengalir lewat reactive context/pipeline.
```

Contoh dengan `TransactionalOperator`:

```java
Mono<CaseResult> createCase(CreateCaseCommand command) {
    return transactionalOperator.transactional(
        caseRepository.save(command.toCase())
            .flatMap(saved -> auditRepository.save(AuditRecord.created(saved)))
            .thenReturn(CaseResult.created())
    );
}
```

Atau dengan `@Transactional` pada reactive method, selama return type reactive dan manager reactive tersedia:

```java
@Transactional
public Mono<CaseResult> createCase(CreateCaseCommand command) {
    return caseRepository.save(command.toCase())
        .flatMap(saved -> auditRepository.save(AuditRecord.created(saved)))
        .thenReturn(CaseResult.created());
}
```

Pitfall:

```java
@Transactional
public void createCase(CreateCaseCommand command) {
    caseRepository.save(command.toCase()).subscribe(); // buruk
}
```

Kenapa buruk:

- method mengembalikan `void`, bukan pipeline,
- manual subscribe memisahkan execution dari transaction boundary,
- error bisa hilang dari caller,
- lifecycle transaksi sulit diprediksi.

Rule:

```text
Jangan manual subscribe di service/controller kecuali Anda benar-benar membuat boundary eksekusi eksplisit.
```

---

## 18. Manual `subscribe()` adalah Bau Arsitektur

Dalam WebFlux server, framework yang melakukan subscribe.

Biasanya Anda menulis:

```java
return service.execute(command);
```

Bukan:

```java
service.execute(command).subscribe();
return Mono.just("ok");
```

Masalah manual subscribe:

1. Error tidak otomatis masuk ke HTTP error flow.
2. Transaction boundary bisa hilang.
3. Security/context/tracing bisa tidak terbawa.
4. Backpressure diabaikan.
5. Test menjadi nondeterministic.
6. Caller mengira operasi selesai padahal masih jalan.

Manual subscribe hanya wajar di boundary tertentu:

- application startup sink,
- event bridge yang memang fire-and-forget dengan error handler eksplisit,
- integration adapter yang mengelola lifecycle subscription,
- background stream dengan shutdown handling.

---

## 19. Context Propagation

Di MVC, banyak hal disimpan di `ThreadLocal`:

- security context,
- transaction context,
- MDC logging context,
- request attributes,
- locale,
- tracing context.

Di WebFlux, pipeline bisa berpindah thread. Karena itu, reactive context menjadi penting.

Contoh Reactor Context:

```java
return Mono.deferContextual(ctx -> {
    String correlationId = ctx.get("correlationId");
    return service.call(correlationId);
});
```

Menulis context:

```java
return handler.handle(request)
    .contextWrite(ctx -> ctx.put("correlationId", correlationId));
```

Dalam Spring modern, banyak integrasi observability/security sudah membantu propagation, tetapi Anda tetap harus paham boundary-nya.

Pitfall:

```text
MDC berbasis ThreadLocal tidak otomatis aman di reactive pipeline jika tidak ada context propagation support.
```

---

## 20. Error Handling dalam Reactive Pipeline

Reactive error bukan thrown exception biasa yang langsung keluar dari stack.

Contoh salah:

```java
try {
    return client.call()
        .map(this::transform);
} catch (Exception e) {
    return Mono.error(e);
}
```

`try/catch` ini hanya menangkap error saat pipeline dibangun, bukan error asynchronous saat pipeline berjalan.

Contoh benar:

```java
return client.call()
    .map(this::transform)
    .onErrorMap(ExternalTimeoutException.class,
        e -> new UpstreamUnavailableException("profile-service", e))
    .onErrorResume(ProfileNotFoundException.class,
        e -> Mono.empty());
```

Operator penting:

```text
onErrorMap      : ubah error menjadi error lain.
onErrorResume   : fallback ke publisher lain.
onErrorReturn   : fallback value statis.
doOnError       : side effect, tidak recover.
retryWhen       : retry sesuai policy.
timeout         : ubah hanging pipeline menjadi timeout error.
```

Guideline:

```text
Recover hanya jika business semantics-nya jelas.
Jangan sembunyikan error hanya demi response sukses.
```

---

## 21. Timeout, Retry, dan Resilience

Reactive pipeline yang tidak diberi timeout bisa menggantung.

Contoh:

```java
return profileClient.getProfile(userId)
    .timeout(Duration.ofSeconds(2))
    .retryWhen(Retry.backoff(2, Duration.ofMillis(100))
        .filter(this::isTransientFailure));
```

Tetapi retry harus mempertimbangkan:

1. Apakah operasi idempotent?
2. Apakah upstream memang transient?
3. Apakah retry bisa memperparah overload?
4. Apakah ada budget waktu keseluruhan?
5. Apakah response duplikat aman?

Anti-pattern:

```java
return paymentClient.charge(command)
    .retry(3); // berbahaya jika charge tidak idempotent
```

Lebih aman:

```java
return paymentClient.charge(command.withIdempotencyKey(key))
    .timeout(Duration.ofSeconds(3))
    .retryWhen(Retry.backoff(2, Duration.ofMillis(200))
        .filter(this::isSafeTransientFailure));
```

---

## 22. Streaming, SSE, dan Long-Lived Connection

WebFlux sangat cocok untuk streaming.

### 22.1 Server-Sent Events

```java
@GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<ServerSentEvent<CaseEventResponse>> events() {
    return caseEventService.stream()
        .map(event -> ServerSentEvent.builder(CaseEventResponse.from(event))
            .event("case-event")
            .id(event.id())
            .build());
}
```

Use case:

- notification stream,
- audit stream,
- long-running job progress,
- live dashboard,
- workflow status updates.

Risiko:

- connection lifecycle,
- client reconnect,
- memory pressure,
- slow consumer,
- backpressure,
- authorization over long-lived session,
- deployment rolling restart.

### 22.2 Streaming JSON

```java
@GetMapping(value = "/cases/stream", produces = MediaType.APPLICATION_NDJSON_VALUE)
Flux<CaseResponse> streamCases() {
    return caseQueryService.streamAll()
        .map(CaseResponse::from);
}
```

NDJSON lebih cocok untuk streaming object satu per satu daripada JSON array besar.

---

## 23. Request Body Streaming dan Memory Guard

WebFlux memungkinkan request body diproses sebagai stream.

Contoh upload stream konseptual:

```java
@PostMapping("/files")
Mono<FileUploadResult> upload(@RequestBody Flux<DataBuffer> body) {
    return fileStorage.store(body);
}
```

Tetapi `DataBuffer` lifecycle harus hati-hati. Memory leak di buffer bisa terjadi jika buffer tidak dirilis dengan benar pada low-level handling.

Guideline:

1. Gunakan abstraction Spring yang aman jika bisa.
2. Hindari mengumpulkan body besar ke memory.
3. Terapkan max in-memory size.
4. Pastikan cancellation path membersihkan resource.
5. Test dengan file besar dan client disconnect.

---

## 24. Validation dalam WebFlux

Annotated controller tetap bisa memakai validation:

```java
@PostMapping("/cases")
Mono<CaseResponse> create(@Valid @RequestBody Mono<CreateCaseRequest> requestMono) {
    return requestMono
        .flatMap(request -> caseService.create(request.toCommand()))
        .map(CaseResponse::from);
}
```

Namun error timing berbeda karena body dibaca secara reactive.

Pola yang lebih eksplisit:

```java
@PostMapping("/cases")
Mono<CaseResponse> create(@RequestBody Mono<CreateCaseRequest> requestMono) {
    return requestMono
        .doOnNext(validator::validateCreateCase)
        .flatMap(request -> caseService.create(request.toCommand()))
        .map(CaseResponse::from);
}
```

Untuk API besar, tetap jaga boundary:

```text
transport DTO validation
  → application command mapping
      → domain invariant validation
```

---

## 25. Security dalam WebFlux

Spring Security memiliki reactive stack sendiri.

Konsep yang berubah:

```text
MVC SecurityContextHolder ThreadLocal
WebFlux reactive security context
```

Controller bisa mengakses principal secara reactive:

```java
@GetMapping("/me")
Mono<UserResponse> me(Mono<Principal> principal) {
    return principal
        .flatMap(p -> userService.findByUsername(p.getName()))
        .map(UserResponse::from);
}
```

Atau dari reactive security context:

```java
return ReactiveSecurityContextHolder.getContext()
    .map(SecurityContext::getAuthentication)
    .flatMap(auth -> service.execute(auth.getName()));
```

Pitfall:

1. Menggunakan ThreadLocal security context di reactive pipeline.
2. Manual subscribe yang kehilangan context.
3. Blocking user lookup dalam authentication flow.
4. Authorization decision yang memanggil DB blocking di event loop.
5. Cache authorization tanpa tenant/user/resource dimension.

---

## 26. Observability dalam WebFlux

Observability reactive memiliki tantangan:

- execution asynchronous,
- thread bisa berpindah,
- stack trace lebih sulit,
- cancellation adalah outcome penting,
- latency harus diukur per pipeline, bukan per method call biasa.

Yang perlu diamati:

```text
HTTP server request latency
HTTP client latency
active connections
event loop saturation
scheduler queue
boundedElastic usage
retry count
timeout count
cancellation count
stream duration
slow subscriber
error type distribution
```

`doOn...` operator bisa membantu untuk domain metrics:

```java
return caseService.create(command)
    .doOnSuccess(result -> metrics.caseCreated())
    .doOnError(error -> metrics.caseCreateFailed(error))
    .doFinally(signal -> metrics.caseCreateFinished(signal.name()));
```

Tetapi jangan menaruh logic bisnis di `doOnNext`; itu side-effect hook, bukan transformation stage.

---

## 27. Testing WebFlux

### 27.1 WebTestClient

`WebTestClient` adalah tool utama untuk test WebFlux endpoint.

```java
@WebFluxTest(CaseController.class)
class CaseControllerTest {

    @Autowired
    WebTestClient webTestClient;

    @MockBean
    CaseService caseService;

    @Test
    void shouldReturnCase() {
        given(caseService.findCase("C-1"))
            .willReturn(Mono.just(new Case("C-1")));

        webTestClient.get()
            .uri("/cases/C-1")
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.id").isEqualTo("C-1");
    }
}
```

### 27.2 StepVerifier

Untuk service reactive:

```java
@Test
void shouldCreateCase() {
    Mono<CaseResult> result = service.create(command);

    StepVerifier.create(result)
        .expectNextMatches(r -> r.caseId() != null)
        .verifyComplete();
}
```

### 27.3 Testing error

```java
StepVerifier.create(service.findRequired("missing"))
    .expectError(CaseNotFoundException.class)
    .verify();
```

### 27.4 Testing time

Untuk timeout/delay, gunakan virtual time jika memungkinkan:

```java
StepVerifier.withVirtualTime(() -> service.waitForEvent())
    .thenAwait(Duration.ofSeconds(10))
    .expectNextCount(1)
    .verifyComplete();
```

---

## 28. Debugging Reactive Pipeline

Reactive stack trace bisa sulit karena call stack saat error terjadi tidak selalu menunjukkan assembly site.

Tools/strategi:

1. beri nama operator/checkpoint,
2. log signal secara selektif,
3. gunakan `checkpoint()` di boundary penting,
4. jangan spam `log()` pada stream high-volume,
5. test pipeline dengan `StepVerifier`,
6. pisahkan pipeline menjadi method kecil yang punya nama domain.

Contoh:

```java
return client.fetchCase(id)
    .checkpoint("fetch-case-from-case-service")
    .flatMap(this::enrichCase)
    .checkpoint("enrich-case-with-profile")
    .map(CaseResponse::from);
```

---

## 29. WebFlux vs MVC vs MVC + Virtual Threads

Pada Java 21–25, keputusan tidak lagi sesederhana:

```text
butuh concurrency tinggi → WebFlux
```

Karena virtual threads membuat blocking style jauh lebih scalable untuk banyak workload I/O-bound blocking.

### 29.1 Decision Matrix

| Kriteria | MVC platform threads | MVC virtual threads | WebFlux |
|---|---|---|---|
| Programming model | paling sederhana | sederhana | paling kompleks |
| Library blocking | cocok | cocok | tidak cocok kecuali diisolasi |
| JDBC/JPA | cocok | cocok, pool tetap bottleneck | tidak ideal |
| Reactive DB/client | tidak utama | bisa, tapi kurang natural | sangat cocok |
| Streaming/SSE banyak | bisa, tapi resource lebih berat | lebih baik | sangat cocok |
| Backpressure pipeline | lemah | lemah | kuat |
| Debuggability | mudah | mudah-sedang | lebih sulit |
| Skill requirement | rendah-sedang | sedang | tinggi |
| Event loop blocking risk | tidak ada | tidak ada | tinggi |
| CPU-bound workload | perlu pool | perlu pool | perlu scheduler/pool |

### 29.2 Rule of Thumb

Pilih **MVC platform threads** jika:

- aplikasi CRUD/OLTP biasa,
- traffic sedang,
- tim familiar MVC,
- library utama blocking,
- simplicity lebih penting.

Pilih **MVC virtual threads** jika:

- Java 21+ tersedia,
- banyak blocking I/O,
- ingin scalability lebih baik tanpa reactive complexity,
- JDBC/JPA tetap dominan,
- request/response biasa.

Pilih **WebFlux** jika:

- seluruh stack bisa non-blocking,
- WebClient/reactive datastore dominan,
- banyak streaming/SSE/WebSocket,
- butuh backpressure,
- high concurrency connection menjadi masalah nyata,
- tim siap dengan reactive debugging dan testing.

---

## 30. Architecture Pattern: Reactive Edge, Imperative Core?

Kadang tim ingin memakai WebFlux di edge API, tetapi domain core tetap imperative.

Contoh:

```text
WebFlux Controller
  → Reactive Application Service
      → Blocking Legacy Adapter on boundedElastic
      → Imperative Domain Model
```

Ini bisa diterima sebagai transisi, tetapi jangan salah klaim sebagai fully reactive.

Pattern ini cocok jika:

- Anda butuh streaming/WebClient di edge,
- sebagian legacy call masih blocking,
- domain model imperative masih kuat,
- blocking adapter diisolasi dan diukur.

Tidak cocok jika:

- semua repository blocking,
- semua service blocking,
- banyak nested transaction JDBC,
- Anda hanya mengganti return type menjadi `Mono`.

---

## 31. Architecture Pattern: Fully Reactive Service

Contoh service fully reactive:

```text
WebFlux endpoint
  → reactive validation
  → reactive application service
  → R2DBC/Mongo reactive repository
  → WebClient external API
  → reactive cache/client
  → reactive transaction boundary
```

Karakteristik:

- tidak ada blocking call di event loop,
- dependency driver non-blocking,
- context propagation dikelola,
- timeout/retry/cancellation jelas,
- backpressure diperhatikan,
- testing menggunakan StepVerifier/WebTestClient.

Ini target WebFlux yang paling sehat.

---

## 32. Architecture Pattern: Reactive Gateway/Aggregator

WebFlux sangat cocok untuk aggregator I/O-bound:

```text
GET /dashboard/{userId}
  → call profile service
  → call case service
  → call notification service
  → call task service
  → combine result
```

Contoh:

```java
Mono<DashboardResponse> getDashboard(String userId) {
    Mono<Profile> profile = profileClient.get(userId);
    Mono<List<CaseSummary>> cases = caseClient.list(userId).collectList();
    Mono<List<TaskSummary>> tasks = taskClient.list(userId).collectList();

    return Mono.zip(profile, cases, tasks)
        .map(tuple -> new DashboardResponse(
            tuple.getT1(),
            tuple.getT2(),
            tuple.getT3()
        ));
}
```

Tetapi beri timeout per dependency:

```java
Mono<Profile> profile = profileClient.get(userId)
    .timeout(Duration.ofSeconds(1));

Mono<List<CaseSummary>> cases = caseClient.list(userId)
    .timeout(Duration.ofSeconds(2))
    .collectList();
```

Dan tentukan fallback per dependency:

```java
Mono<List<TaskSummary>> tasks = taskClient.list(userId)
    .timeout(Duration.ofSeconds(1))
    .onErrorReturn(List.of())
    .collectList();
```

Fallback kosong hanya benar jika secara bisnis dashboard boleh degraded.

---

## 33. Backpressure dalam API Aggregation

Backpressure tidak menyelamatkan Anda dari semua overload.

Jika endpoint melakukan fan-out ke 10 service, lalu traffic 1000 RPS, Anda bisa membuat 10.000 RPS downstream.

Perlu guard tambahan:

- timeout,
- concurrency limit,
- rate limit,
- bulkhead,
- queue bound,
- circuit breaker,
- cache,
- pagination/stream limit.

Dalam Reactor, concurrency dapat dibatasi:

```java
return Flux.fromIterable(ids)
    .flatMap(client::fetchById, 8)
    .collectList();
```

Angka `8` membatasi concurrency `flatMap`.

Tanpa limit:

```java
return Flux.fromIterable(ids)
    .flatMap(client::fetchById)
    .collectList();
```

Jika `ids` besar, ini bisa membanjiri downstream.

---

## 34. Cancellation adalah Signal Produksi

Dalam reactive stream, client disconnect dapat membatalkan pipeline.

Contoh:

```text
client request streaming report
server mulai generate
client menutup koneksi
pipeline menerima cancellation
resource harus dibersihkan
```

`doFinally` dapat melihat signal:

```java
return reportService.streamReport(command)
    .doFinally(signal -> {
        if (signal == SignalType.CANCEL) {
            metrics.reportCancelled();
        }
    });
```

Production concern:

- apakah DB cursor ditutup?
- apakah file handle dilepas?
- apakah temporary object dibersihkan?
- apakah background job tetap jalan walau client disconnect?
- apakah cancellation harus dianggap audit event?

---

## 35. Failure Model WebFlux

Beberapa failure khas WebFlux:

### 35.1 Event loop blocked

Gejala:

- latency spike luas,
- throughput turun,
- CPU belum tentu tinggi,
- thread dump menunjukkan event loop di blocking call.

Penyebab:

- JDBC/JPA langsung di pipeline,
- `Thread.sleep`,
- blocking SDK,
- file read besar,
- synchronous crypto/compression berat.

### 35.2 Pipeline tidak pernah dieksekusi

Penyebab:

- tidak ada subscription,
- service method membangun pipeline tapi caller tidak return/subscribe.

### 35.3 Error hilang

Penyebab:

- manual subscribe tanpa error handler,
- fire-and-forget tanpa observability,
- `onErrorResume` terlalu luas.

### 35.4 Memory naik saat streaming

Penyebab:

- `collectList()` pada stream besar,
- unbounded buffering,
- slow consumer,
- DataBuffer leak,
- response aggregation tidak perlu.

### 35.5 Downstream overload

Penyebab:

- `flatMap` concurrency tidak dibatasi,
- retry storm,
- no timeout,
- no circuit breaker/bulkhead.

### 35.6 Context hilang

Penyebab:

- thread-local assumption,
- manual scheduler switching,
- manual subscribe,
- library tidak reactive-aware.

---

## 36. Code Review Checklist untuk WebFlux

Gunakan checklist ini saat review PR:

### 36.1 API Layer

- Apakah controller mengembalikan `Mono`/`Flux`, bukan manual subscribe?
- Apakah empty/error semantics jelas?
- Apakah validation boundary jelas?
- Apakah response streaming tidak mengumpulkan seluruh data tanpa alasan?

### 36.2 Blocking Safety

- Apakah ada JDBC/JPA/blocking SDK di event loop?
- Jika blocking tidak bisa dihindari, apakah diisolasi di bounded scheduler?
- Apakah penggunaan `boundedElastic` dibatasi dan dimonitor?

### 36.3 Resilience

- Apakah outbound call punya timeout?
- Apakah retry hanya untuk operasi aman/idempotent?
- Apakah concurrency `flatMap` dibatasi?
- Apakah fallback punya business semantics?

### 36.4 Context

- Apakah correlation ID/security/tenant context terbawa?
- Apakah ada ThreadLocal assumption?
- Apakah MDC logging sudah reactive-aware?

### 36.5 Transaction

- Apakah reactive transaction manager digunakan jika perlu?
- Apakah `@Transactional` return type reactive?
- Apakah tidak ada manual subscribe dalam transactional method?

### 36.6 Observability

- Apakah metrics/tracing tersedia untuk HTTP server/client?
- Apakah timeout/retry/error/cancel termonitor?
- Apakah operator debug/checkpoint cukup di boundary penting?

### 36.7 Testing

- Apakah endpoint diuji dengan `WebTestClient`?
- Apakah service pipeline diuji dengan `StepVerifier`?
- Apakah error/timeout/cancellation diuji?
- Apakah test tidak bergantung pada sleep real-time jika bisa pakai virtual time?

---

## 37. Anti-Pattern Besar WebFlux

### 37.1 Return type reactive, isi tetap blocking

```java
@GetMapping("/{id}")
Mono<User> get(@PathVariable String id) {
    User user = jdbcTemplate.queryForObject(...);
    return Mono.just(user);
}
```

Ini buruk karena blocking terjadi sebelum `Mono` dibuat.

### 37.2 Blocking dibungkus tapi semua stack tetap blocking

```java
return Mono.fromCallable(() -> giantLegacyService.execute(command))
    .subscribeOn(Schedulers.boundedElastic());
```

Ini bisa menjadi adapter sementara, tetapi jika seluruh aplikasi begini, WebFlux tidak memberi banyak nilai.

### 37.3 Manual subscribe di service

```java
public Mono<Result> execute(Command command) {
    auditService.audit(command).subscribe();
    return repository.save(command);
}
```

Audit error hilang, ordering tidak jelas, transaction tidak jelas.

### 37.4 `block()` di pipeline

```java
return userService.find(id)
    .map(user -> profileClient.get(user.profileId()).block());
```

Ini memblokir thread reactive.

### 37.5 `collectList()` tanpa batas

```java
return eventRepository.streamAll()
    .collectList();
```

Jika stream besar, memory bisa meledak.

### 37.6 `onErrorResume` terlalu luas

```java
return service.execute(command)
    .onErrorResume(e -> Mono.just(defaultResponse));
```

Ini menyembunyikan bug, data corruption, dan security failure.

---

## 38. WebFlux untuk Regulatory / Case Management System

Untuk sistem case management/regulatory enforcement, WebFlux bisa berguna di area tertentu:

1. **API aggregator** untuk dashboard yang memanggil banyak service.
2. **Streaming progress** untuk long-running report/export.
3. **Notification feed** berbasis SSE.
4. **Reactive gateway** untuk routing, enrichment, dan policy enforcement lightweight.
5. **External API integration** yang I/O-bound dan high concurrency.
6. **Backpressure-aware ingestion** untuk event/file stream tertentu.

Tetapi banyak core workflow regulatory biasanya lebih cocok dengan model imperative:

- complex state transition,
- transaction-heavy command,
- relational consistency,
- audit defensibility,
- explicit domain invariant,
- sequential business rule evaluation,
- reviewer/approver workflow,
- legal traceability.

Untuk domain core seperti itu, WebFlux bukan otomatis buruk, tetapi harus dibuktikan nilainya. Jangan mengorbankan clarity hanya demi reactive purity.

Pattern yang sering masuk akal:

```text
Imperative Spring MVC core command API
Reactive WebFlux edge/streaming/aggregation service
Shared contracts and observability conventions
```

---

## 39. Migration Strategy dari MVC ke WebFlux

Jangan migrasi seluruh aplikasi MVC besar ke WebFlux sekaligus hanya karena ingin modern.

Strategi lebih aman:

1. Identifikasi use case yang benar-benar butuh streaming/non-blocking/high concurrency.
2. Bangun service kecil/edge dengan WebFlux.
3. Pastikan dependency stack non-blocking.
4. Buat observability khusus event loop/scheduler.
5. Latih tim membaca reactive pipeline.
6. Hindari campuran MVC/WebFlux tidak perlu dalam satu aplikasi.
7. Jika core masih JDBC/JPA, pertimbangkan MVC + virtual threads terlebih dahulu.
8. Ukur hasil dengan load test.

Migration checklist:

```text
[ ] Semua outbound HTTP client sudah WebClient/HTTP interface reactive?
[ ] Database access reactive atau blocking diisolasi?
[ ] Tidak ada .block() di request path?
[ ] Tidak ada manual subscribe di service?
[ ] Timeout semua outbound call?
[ ] Retry hanya untuk idempotent operation?
[ ] Context propagation diuji?
[ ] Metrics event loop/scheduler tersedia?
[ ] Team tahu debugging StepVerifier/checkpoint?
```

---

## 40. Minimal Production Skeleton

### 40.1 Controller

```java
@RestController
@RequestMapping("/api/cases")
class ReactiveCaseController {

    private final ReactiveCaseApplicationService service;

    ReactiveCaseController(ReactiveCaseApplicationService service) {
        this.service = service;
    }

    @PostMapping
    Mono<ResponseEntity<CaseResponse>> create(@RequestBody Mono<CreateCaseRequest> request) {
        return request
            .flatMap(req -> service.create(req.toCommand()))
            .map(CaseResponse::from)
            .map(response -> ResponseEntity.status(HttpStatus.CREATED).body(response));
    }

    @GetMapping("/{caseId}")
    Mono<ResponseEntity<CaseResponse>> get(@PathVariable String caseId) {
        return service.find(caseId)
            .map(CaseResponse::from)
            .map(ResponseEntity::ok)
            .switchIfEmpty(Mono.just(ResponseEntity.notFound().build()));
    }
}
```

### 40.2 Service

```java
@Service
class ReactiveCaseApplicationService {

    private final CaseRepository caseRepository;
    private final ProfileClient profileClient;

    ReactiveCaseApplicationService(
        CaseRepository caseRepository,
        ProfileClient profileClient
    ) {
        this.caseRepository = caseRepository;
        this.profileClient = profileClient;
    }

    Mono<CaseResult> create(CreateCaseCommand command) {
        return validate(command)
            .then(profileClient.getProfile(command.applicantId()))
            .flatMap(profile -> caseRepository.save(command.toCase(profile)))
            .map(saved -> new CaseResult(saved.id()))
            .timeout(Duration.ofSeconds(5))
            .checkpoint("create-case");
    }

    Mono<CaseRecord> find(String caseId) {
        return caseRepository.findById(caseId)
            .timeout(Duration.ofSeconds(2))
            .checkpoint("find-case");
    }

    private Mono<Void> validate(CreateCaseCommand command) {
        if (command.applicantId() == null || command.applicantId().isBlank()) {
            return Mono.error(new InvalidCaseCommandException("applicantId is required"));
        }
        return Mono.empty();
    }
}
```

### 40.3 Client

```java
@Component
class ProfileClient {

    private final WebClient webClient;

    ProfileClient(WebClient.Builder builder) {
        this.webClient = builder
            .baseUrl("https://profile-service")
            .build();
    }

    Mono<Profile> getProfile(String applicantId) {
        return webClient.get()
            .uri("/profiles/{id}", applicantId)
            .retrieve()
            .onStatus(status -> status.value() == 404,
                response -> Mono.error(new ProfileNotFoundException(applicantId)))
            .onStatus(HttpStatusCode::is5xxServerError,
                response -> Mono.error(new ProfileServiceUnavailableException()))
            .bodyToMono(Profile.class)
            .timeout(Duration.ofSeconds(2))
            .retryWhen(Retry.backoff(2, Duration.ofMillis(100))
                .filter(this::isRetryable))
            .checkpoint("profile-client-get-profile");
    }

    private boolean isRetryable(Throwable error) {
        return error instanceof ProfileServiceUnavailableException
            || error instanceof TimeoutException;
    }
}
```

---

## 41. Decision Framework: Haruskah Pakai WebFlux?

Jawab pertanyaan ini secara jujur.

### 41.1 Pertanyaan Teknis

1. Apakah dependency I/O utama sudah non-blocking?
2. Apakah database access reactive?
3. Apakah ada kebutuhan streaming atau long-lived connection?
4. Apakah traffic concurrency tinggi benar-benar menjadi bottleneck?
5. Apakah request banyak menunggu external service?
6. Apakah tim siap debugging reactive?
7. Apakah observability reactive sudah tersedia?
8. Apakah virtual threads sudah cukup menyelesaikan masalah?

### 41.2 Pertanyaan Organisasi

1. Apakah semua reviewer memahami `map` vs `flatMap`?
2. Apakah tim tahu bahaya `.block()`?
3. Apakah ada standar timeout/retry/fallback?
4. Apakah ada checklist blocking call?
5. Apakah production support bisa membaca stack trace reactive?

### 41.3 Keputusan

Gunakan WebFlux jika jawaban dominan:

```text
non-blocking stack tersedia
streaming/concurrency tinggi penting
team siap
observability siap
benefit terukur
```

Jangan gunakan WebFlux jika motivasinya hanya:

```text
karena modern
karena ingin cepat
karena semua orang bicara reactive
karena ingin mengganti MVC tanpa bottleneck jelas
```

---

## 42. Ringkasan Mental Model

Pegang ringkasan ini:

```text
WebFlux bukan MVC dengan return type Mono.
WebFlux adalah runtime non-blocking yang membutuhkan discipline non-blocking end-to-end.
```

```text
Mono/Flux adalah pipeline, bukan value langsung.
```

```text
Event loop harus tidak diblokir.
```

```text
Manual subscribe biasanya salah di aplikasi server.
```

```text
Timeout, retry, fallback, dan concurrency limit adalah bagian dari desain, bukan tambahan nanti.
```

```text
Virtual threads mengurangi kebutuhan WebFlux untuk banyak use case blocking I/O biasa, tetapi tidak menggantikan backpressure/streaming/reactive pipeline.
```

```text
WebFlux terbaik ketika seluruh jalur I/O dapat reactive dan workload memang membutuhkan non-blocking concurrency.
```

---

## 43. Latihan Praktis

### Latihan 1 — Identifikasi Blocking

Cari potongan kode WebFlux yang memakai:

```text
.block()
.toFuture().get()
Thread.sleep
JDBC/JPA langsung
RestTemplate
synchronous SDK
Files.readAllBytes
```

Klasifikasikan:

```text
harus dihapus
boleh diadapter sementara
harus pindah ke MVC/virtual thread
```

### Latihan 2 — Ubah Aggregator Menjadi Reactive

Buat endpoint:

```text
GET /dashboard/{userId}
```

Yang memanggil:

```text
profile service
case service
task service
notification service
```

Syarat:

- timeout per service,
- fallback hanya untuk notification/task,
- profile failure menggagalkan response,
- concurrency bounded,
- correlation ID propagated,
- tested with WebTestClient.

### Latihan 3 — Streaming Progress

Buat endpoint SSE:

```text
GET /exports/{jobId}/events
```

Event:

```text
STARTED
RUNNING
PARTIAL_COMPLETE
FAILED
COMPLETED
```

Tambahkan:

- client reconnect handling,
- authorization per job,
- cancellation metrics,
- keepalive event.

### Latihan 4 — Reactive Error Catalog

Buat mapping:

```text
ProfileNotFoundException → 404
ProfileServiceUnavailableException → 503
TimeoutException → 504
InvalidCaseCommandException → 400
AccessDeniedException → 403
```

Implementasikan dengan `@RestControllerAdvice` WebFlux atau `ErrorWebExceptionHandler` jika perlu global low-level control.

---

## 44. Referensi Resmi

Gunakan referensi resmi sebagai sumber utama:

1. Spring Framework Reference — Spring WebFlux.
2. Spring Framework Reference — Web on Reactive Stack.
3. Spring Framework Reference — Reactive Core.
4. Spring Boot Reference — Reactive Web Applications.
5. Project Reactor Reference/API untuk `Mono`, `Flux`, scheduler, retry, dan testing.

---

## 45. Penutup Part 14

Di part ini kita membangun peta WebFlux dari sisi runtime dan architecture decision.

Hal yang harus benar-benar melekat:

```text
Reactive programming bukan tujuan.
Reactive adalah alat untuk workload tertentu.
```

Engineer top-tier tidak memilih WebFlux karena terlihat advanced. Engineer top-tier memilih WebFlux ketika:

- bottleneck-nya jelas,
- constraint-nya cocok,
- failure model-nya dipahami,
- tim mampu mengoperasikan,
- observability-nya siap,
- dan alternatif seperti MVC + virtual threads sudah dibandingkan secara jujur.

Jika tidak, Spring MVC modern dengan Java 21–25 dan virtual threads sering menjadi solusi yang lebih sederhana, lebih maintainable, dan lebih defensible.

---

## Status Seri

```text
Part saat ini : 14 dari 35
Status        : belum selesai
Berikutnya    : 15-spring-http-clients-restclient-webclient-http-interface.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./13-rest-api-engineering-with-spring.md">⬅️ Part 13 — REST API Engineering with Spring MVC and Boot</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./15-spring-http-clients-restclient-webclient-http-interface.md">Part 15 — Spring HTTP Clients: RestTemplate, RestClient, WebClient, and HTTP Interface ➡️</a>
</div>
