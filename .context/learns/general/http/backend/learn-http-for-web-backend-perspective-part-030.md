# learn-http-for-web-backend-perspective-part-030.md

# HTTP for Web/Backend Perspective — Part 030
# Java Backend Implementation: WebFlux, Reactor Netty, and Reactive HTTP

> Series: `learn-http-for-web-backend-perspective`  
> Part: `030 / 032`  
> Audience: Java software engineer / backend engineer  
> Focus: bagaimana HTTP backend diimplementasikan dengan Spring WebFlux, Reactor Netty, reactive streams, non-blocking I/O, cancellation, backpressure, streaming, observability, dan failure modelling.

---

## 0. Posisi Part Ini dalam Seri

Di Part 029 kita membahas stack Servlet dan Spring MVC: request masuk ke connector, diproses dengan model thread-per-request, melewati filter/interceptor, binding, validation, controller, exception resolver, lalu response dikirim kembali.

Part ini membahas jalur berbeda: **Spring WebFlux dan Reactor Netty**.

Tujuan part ini bukan membuat klaim dangkal seperti:

> “WebFlux lebih cepat daripada Spring MVC.”

Itu framing yang lemah.

Framing yang lebih benar:

> WebFlux adalah model pemrograman HTTP non-blocking berbasis Reactive Streams. Ia dapat meningkatkan scalability pada workload tertentu, terutama workload dengan banyak I/O concurrent dan long-lived connection, tetapi juga menambah kompleksitas pada debugging, mental model, context propagation, testing, error handling, dan integration dengan dependency blocking.

Spring mendokumentasikan WebFlux sebagai reactive-stack web framework yang fully non-blocking, mendukung Reactive Streams back pressure, dan dapat berjalan di server seperti Netty maupun Servlet container. Reactor adalah library reactive utama yang menyediakan `Mono` dan `Flux`. Reactor Netty menyediakan runtime network non-blocking yang sering menjadi default untuk WebFlux. Referensi resmi: Spring WebFlux reference, Spring reactive core, functional endpoints, Project Reactor, dan Reactor Netty.

---

## 1. Kenapa WebFlux Ada?

Spring MVC sangat baik untuk banyak backend API tradisional. Modelnya sederhana:

```text
1 request ≈ 1 thread
thread blocked saat menunggu database / HTTP downstream / file I/O
response selesai -> thread kembali ke pool
```

Model ini mudah dipahami, mudah di-debug, dan cocok untuk banyak sistem enterprise.

Namun model thread-per-request punya batas alami:

1. Setiap request yang sedang menunggu I/O tetap memegang thread.
2. Thread adalah resource mahal: memory stack, scheduling overhead, context switch.
3. Long-lived request seperti SSE, streaming, atau long polling dapat menahan thread terlalu lama.
4. Saat downstream lambat, thread pool bisa habis walaupun CPU tidak sibuk.
5. Banyak concurrent connection dengan sedikit kerja CPU dapat membuat thread-per-request tidak efisien.

WebFlux mencoba memecahkan problem ini dengan model:

```text
small number of event-loop threads
request I/O non-blocking
work dilanjutkan lewat callback/reactive chain saat data tersedia
thread tidak diparkir hanya untuk menunggu I/O
```

Namun trade-off-nya besar:

1. Semua dependency idealnya non-blocking.
2. Blocking kecil di event loop bisa merusak seluruh server.
3. Stack trace sering tidak linear.
4. Error flow tidak sama dengan try/catch biasa.
5. Transaction boundary dan ThreadLocal tidak otomatis aman.
6. Context propagation perlu perhatian.
7. Testing butuh pendekatan reactive.

Jadi WebFlux bukan “upgrade default”. WebFlux adalah **arsitektur concurrency berbeda**.

---

## 2. Mental Model Utama: Reactive HTTP Bukan Hanya Async

Banyak engineer menyamakan reactive dengan async. Itu kurang tepat.

Ada beberapa konsep berbeda:

| Konsep | Makna |
|---|---|
| Async | pekerjaan tidak harus selesai sebelum method return |
| Non-blocking I/O | thread tidak menunggu I/O secara blocking |
| Event loop | thread kecil menangani banyak event I/O |
| Reactive Streams | kontrak publisher-subscriber dengan demand/backpressure |
| Backpressure | consumer bisa mengontrol laju producer |
| WebFlux | framework web reactive Spring |
| Reactor Netty | network runtime berbasis Netty + Reactor |

Async tanpa non-blocking masih bisa boros thread.

Contoh:

```java
CompletableFuture.supplyAsync(() -> blockingJdbcCall())
```

Ini async dari sisi caller, tetapi tetap blocking di thread lain.

Non-blocking berarti:

```text
request dikirim ke database/client network
thread dilepas
ketika data tersedia, event callback melanjutkan pipeline
```

Reactive menambahkan struktur komposisi:

```java
return repository.findById(id)
    .flatMap(entity -> authorize(entity))
    .map(mapper::toDto)
    .switchIfEmpty(Mono.error(new NotFoundException()));
```

Alur itu bukan menjalankan semua sekarang. Ia membangun pipeline yang akan dijalankan saat ada subscription dari runtime HTTP.

---

## 3. Spring WebFlux Stack Overview

Secara konseptual:

```text
client
  |
  v
reverse proxy / gateway
  |
  v
Reactor Netty HTTP server
  |
  v
Spring WebFlux HttpHandler
  |
  v
WebFilter chain
  |
  v
HandlerMapping
  |
  v
HandlerAdapter
  |
  v
Controller / HandlerFunction
  |
  v
Reactive service chain
  |
  v
Reactive repository / WebClient / messaging / filesystem wrapper
  |
  v
Publisher<response body>
```

WebFlux punya dua programming model utama:

1. **Annotated controllers** mirip Spring MVC:

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    @GetMapping("/{id}")
    Mono<CaseResponse> getCase(@PathVariable UUID id) {
        return caseService.getCase(id);
    }
}
```

2. **Functional endpoints**:

```java
@Bean
RouterFunction<ServerResponse> routes(CaseHandler handler) {
    return RouterFunctions.route()
        .GET("/cases/{id}", handler::getCase)
        .POST("/cases", handler::createCase)
        .build();
}
```

Annotated controllers lebih familiar untuk tim Spring MVC.
Functional endpoints memberi kontrol eksplisit dan composability, tetapi bisa terasa lebih verbose.

---

## 4. Mono dan Flux

Reactor menggunakan dua tipe utama:

```text
Mono<T> = 0 atau 1 item
Flux<T> = 0 sampai N item
```

Contoh mapping HTTP:

| HTTP shape | Reactive type |
|---|---|
| single resource | `Mono<ResourceDto>` |
| resource not found | `Mono.empty()` atau `Mono.error(new NotFoundException())` |
| collection bounded | `Flux<ItemDto>` atau `Mono<List<ItemDto>>` |
| streaming events | `Flux<EventDto>` |
| SSE stream | `Flux<ServerSentEvent<EventDto>>` |
| async command accepted | `Mono<ResponseEntity<JobResponse>>` |
| no content | `Mono<Void>` |

### 4.1 `Mono<T>` bukan T

Kesalahan umum:

```java
Mono<CaseEntity> entity = repository.findById(id);
if (entity == null) { // salah mental model
    ...
}
```

`Mono` adalah pipeline, bukan value. Value-nya muncul nanti.

Yang benar:

```java
return repository.findById(id)
    .switchIfEmpty(Mono.error(new NotFoundException("case not found")))
    .map(mapper::toResponse);
```

### 4.2 `Flux<T>` bukan List<T>

`Flux` bisa merepresentasikan stream yang belum selesai, bahkan infinite.

Contoh:

```java
@GetMapping(value = "/cases/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<ServerSentEvent<CaseEventDto>> streamEvents(@PathVariable UUID id) {
    return eventService.streamCaseEvents(id)
        .map(event -> ServerSentEvent.builder(event).build());
}
```

Jangan langsung mengubah semua `Flux` menjadi `collectList()` kecuali memang kontrak HTTP-nya membutuhkan response bounded.

```java
// Boleh jika collection kecil dan bounded
return repository.findRecentCases().collectList();

// Bahaya jika dataset besar
return repository.findAllCases().collectList();
```

---

## 5. Execution Model: Subscription, Laziness, and Runtime Ownership

Reactive pipeline umumnya lazy. Method controller mengembalikan `Mono`/`Flux`, tetapi eksekusi sebenarnya terjadi saat runtime subscribe.

```java
@GetMapping("/{id}")
Mono<CaseResponse> get(@PathVariable UUID id) {
    return service.get(id)
        .doOnNext(x -> log.info("case loaded"));
}
```

Yang terjadi:

1. Request masuk.
2. Controller dipanggil.
3. Controller mengembalikan `Mono`.
4. WebFlux subscribe ke `Mono` untuk menulis response.
5. Setiap item yang dihasilkan ditulis ke HTTP response.
6. Jika error, WebFlux memetakan ke error response.
7. Jika client disconnect, subscription dapat dibatalkan.

Implikasi:

1. Jangan subscribe manual di controller/service.
2. Jangan menggunakan side effect yang tidak dikaitkan dengan subscription lifecycle.
3. Jangan menganggap code dalam `map/flatMap` langsung berjalan saat method dipanggil.

Anti-pattern:

```java
@PostMapping
Mono<ResponseEntity<Void>> create(@RequestBody Mono<CreateRequest> body) {
    body.subscribe(req -> service.create(req)); // salah
    return Mono.just(ResponseEntity.accepted().build());
}
```

Kenapa salah?

1. Error tidak masuk ke HTTP error handling.
2. Cancellation tidak dihormati.
3. Backpressure hilang.
4. Observability rusak.
5. Request bisa dianggap sukses padahal create gagal.

Lebih benar:

```java
@PostMapping
Mono<ResponseEntity<Void>> create(@RequestBody Mono<CreateRequest> body) {
    return body
        .flatMap(service::create)
        .thenReturn(ResponseEntity.accepted().build());
}
```

---

## 6. Event Loop: Resource yang Harus Dilindungi

Pada Reactor Netty, event-loop thread menangani banyak connection. Ini efisien selama operasi tidak blocking.

Model kasar:

```text
event-loop-1 handles connection A, B, C, D
event-loop-2 handles connection E, F, G, H
```

Jika kamu melakukan blocking call di event-loop:

```java
return Mono.just(jdbcTemplate.queryForObject(...)); // buruk jika dieksekusi di event-loop
```

Thread event-loop berhenti melayani banyak connection lain. Satu call blocking bisa mengganggu banyak request.

### 6.1 Blocking yang sering tidak terlihat

Blocking tidak selalu jelas. Contoh:

1. JDBC biasa.
2. JPA/Hibernate.
3. File I/O besar.
4. DNS resolver blocking.
5. SDK cloud yang blocking.
6. `Thread.sleep`.
7. `.block()`.
8. `.toFuture().get()`.
9. lock contention.
10. synchronous logging berat.
11. BCrypt/password hashing berat di event loop.
12. JSON serialization sangat besar.
13. CPU-heavy transformation.

### 6.2 Aturan praktis

Di WebFlux:

> Event-loop hanya untuk koordinasi I/O ringan. Blocking I/O dan CPU-heavy work harus dipindahkan ke scheduler yang sesuai atau, lebih baik, gunakan dependency non-blocking.

Contoh isolasi blocking:

```java
Mono<CaseEntity> loadWithBlockingJpa(UUID id) {
    return Mono.fromCallable(() -> caseJpaRepository.findById(id)
            .orElseThrow(() -> new NotFoundException("case not found")))
        .subscribeOn(Schedulers.boundedElastic());
}
```

Ini bukan solusi ideal untuk semua hal, tetapi lebih aman daripada blocking di event-loop.

Namun jangan menipu diri:

```text
WebFlux + blocking JPA + boundedElastic = bukan fully reactive system
```

Itu adalah hybrid. Bisa valid sebagai migration strategy, tetapi perlu tuning pool, timeout, backpressure, dan observability.

---

## 7. `map`, `flatMap`, `concatMap`, `switchMap`: Correctness Semantics

Reactive code sering rusak karena operator dipakai seperti “lambda biasa”.

### 7.1 `map`

Gunakan untuk transformasi synchronous non-blocking:

```java
return repository.findById(id)
    .map(mapper::toResponse);
```

`map: T -> R`

Jangan gunakan `map` jika fungsi mengembalikan `Mono`:

```java
// menghasilkan Mono<Mono<AuthResult>>, biasanya salah
return repository.findById(id)
    .map(entity -> authorizationService.check(entity));
```

### 7.2 `flatMap`

Gunakan untuk chaining operasi asynchronous:

```java
return repository.findById(id)
    .flatMap(entity -> authorizationService.checkCanView(entity)
        .thenReturn(entity))
    .map(mapper::toResponse);
```

`flatMap: T -> Publisher<R>` lalu flatten.

### 7.3 `concatMap`

Gunakan saat urutan penting dan operasi tidak boleh concurrent:

```java
return Flux.fromIterable(commands)
    .concatMap(commandService::applyCommand);
```

Untuk workflow state machine, `concatMap` sering lebih aman daripada `flatMap` karena state transition mungkin harus berurutan.

### 7.4 `flatMap` concurrency

`flatMap` dapat menjalankan inner publisher secara concurrent.

```java
return Flux.fromIterable(ids)
    .flatMap(id -> webClient.get()
        .uri("/external/{id}", id)
        .retrieve()
        .bodyToMono(ExternalDto.class), 16);
```

Parameter `16` membatasi concurrency. Tanpa batas, request fan-out bisa membanjiri downstream.

### 7.5 `switchMap`

`switchMap` membatalkan publisher sebelumnya saat item baru datang. Cocok untuk stream dinamis, jarang cocok untuk command audit-critical karena bisa membatalkan operasi yang masih berjalan.

---

## 8. Backpressure: Apa yang Sebenarnya Dikontrol?

Backpressure berarti consumer dapat memberi tahu producer: “Saya hanya siap menerima N item.”

Dalam Reactive Streams, subscriber melakukan request demand.

Namun di HTTP real-world, backpressure memiliki batas:

1. Database driver harus mendukung reactive/non-blocking agar demand efektif sampai sumber data.
2. HTTP client/server harus menghormati flow control.
3. Proxy di tengah bisa buffering sehingga sinyal backpressure tidak murni end-to-end.
4. JSON array response sering harus dirender sebagai satu struktur besar, kecuali streaming format dipilih.
5. Jika producer adalah event bus tanpa backpressure, kamu perlu buffer/drop/latest/replay policy.

### 8.1 Contoh backpressure-friendly streaming

```java
@GetMapping(value = "/events", produces = MediaType.APPLICATION_NDJSON_VALUE)
Flux<EventDto> events() {
    return eventRepository.streamRecentEvents()
        .map(mapper::toDto);
}
```

NDJSON lebih stream-friendly daripada JSON array besar karena item bisa dikirim bertahap.

### 8.2 Buffer bukan backpressure

```java
return fastProducer
    .onBackpressureBuffer();
```

Ini tidak menyelesaikan overload. Ini menunda ledakan memory.

Lebih defensible:

```java
return fastProducer
    .onBackpressureBuffer(
        10_000,
        dropped -> log.warn("dropping event due to buffer overflow"),
        BufferOverflowStrategy.DROP_OLDEST
    );
```

Tetapi untuk domain regulatory/audit, drop event mungkin tidak boleh. Maka desain harus jelas:

1. Apakah stream ini hanya notification ephemeral?
2. Apakah client bisa resume dari cursor?
3. Apakah event harus persistent?
4. Apa yang terjadi saat client lambat?
5. Apakah server harus disconnect dengan error?

Top-tier engineer tidak hanya memakai operator; ia mendesain semantics overload.

---

## 9. Cancellation dan Client Disconnect

Dalam HTTP, client bisa disconnect kapan saja:

1. User menutup browser/tab.
2. Mobile network hilang.
3. Proxy timeout.
4. Client timeout.
5. Load balancer reset.

Di WebFlux, disconnect dapat membatalkan subscription.

Ini penting untuk:

1. Query database panjang.
2. Downstream HTTP call.
3. Streaming response.
4. SSE.
5. File download.
6. Async computation.

### 9.1 Cancellation bukan rollback otomatis

Jika operasi sudah commit ke database, cancellation response tidak menghapus side effect.

Contoh:

```text
POST /cases
server inserts case
client disconnects before response received
```

Dari sisi client, request gagal/timeout. Dari sisi server, case sudah dibuat.

Solusi bukan “reactive cancellation”. Solusi adalah desain idempotency dan operation resource seperti Part 011 dan Part 021.

### 9.2 Side effect harus ditempatkan hati-hati

```java
return requestMono
    .flatMap(req -> repository.save(toEntity(req)))
    .doOnCancel(() -> log.warn("client cancelled"));
```

`doOnCancel` bisa mencatat cancellation, tetapi tidak boleh diasumsikan sebagai compensation.

Jika operasi harus terus berjalan walau client disconnect, pertimbangkan async job resource:

```text
POST /exports
202 Accepted
Location: /exports/{jobId}
```

Jangan memaksa long-running critical operation terikat pada lifecycle koneksi HTTP.

---

## 10. Controller Design di WebFlux

### 10.1 Return `Mono<ResponseEntity<T>>`

Untuk kontrol status/header:

```java
@GetMapping("/cases/{id}")
Mono<ResponseEntity<CaseResponse>> getCase(@PathVariable UUID id) {
    return caseService.getCase(id)
        .map(dto -> ResponseEntity.ok()
            .eTag(dto.etag())
            .body(dto))
        .switchIfEmpty(Mono.just(ResponseEntity.notFound().build()));
}
```

### 10.2 `Mono<T>` untuk simple 200

```java
@GetMapping("/cases/{id}")
Mono<CaseResponse> getCase(@PathVariable UUID id) {
    return caseService.getCaseOrError(id);
}
```

Jika empty handling/error mapping ada di global exception handler, ini bersih.

### 10.3 Request body sebagai object vs `Mono<Request>`

Bisa:

```java
@PostMapping("/cases")
Mono<ResponseEntity<CaseResponse>> create(@Valid @RequestBody CreateCaseRequest request) {
    return service.create(request)
        .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created));
}
```

Atau:

```java
@PostMapping("/cases")
Mono<ResponseEntity<CaseResponse>> create(@Valid @RequestBody Mono<CreateCaseRequest> body) {
    return body
        .flatMap(service::create)
        .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created));
}
```

Untuk small JSON object, keduanya sering cukup. `Mono<Request>` memberi kontrol reactive lebih eksplisit dan cocok saat body processing sendiri asynchronous.

### 10.4 Jangan return nested publisher

Buruk:

```java
Mono<Mono<CaseResponse>> result = service.load(id)
    .map(caseEntity -> service.enrich(caseEntity));
```

Benar:

```java
Mono<CaseResponse> result = service.load(id)
    .flatMap(service::enrich);
```

---

## 11. Validation di WebFlux

Bean Validation tetap bisa digunakan.

Contoh DTO:

```java
record CreateCaseRequest(
    @NotBlank String title,
    @NotNull UUID respondentId,
    @Size(max = 2000) String summary
) {}
```

Controller:

```java
@PostMapping("/cases")
Mono<ResponseEntity<CaseResponse>> create(@Valid @RequestBody Mono<CreateCaseRequest> body) {
    return body
        .flatMap(caseService::create)
        .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created));
}
```

Tetapi ingat layering dari Part 009:

1. Content-Type validation.
2. Body parse.
3. Structural validation.
4. Semantic validation.
5. Authorization-sensitive validation.
6. Domain invariant.
7. Persistence constraint.

Reactive tidak menghapus kebutuhan layering.

### 11.1 Semantic validation asynchronous

```java
Mono<Void> validateCreate(CreateCaseRequest req) {
    return respondentRepository.existsById(req.respondentId())
        .flatMap(exists -> exists
            ? Mono.empty()
            : Mono.error(new ValidationException("respondent does not exist")));
}
```

Use:

```java
return body
    .flatMap(req -> validateCreate(req).thenReturn(req))
    .flatMap(caseService::create)
    .map(created -> ResponseEntity.status(HttpStatus.CREATED).body(created));
```

---

## 12. Error Handling

Error di reactive chain bukan hanya exception thrown di stack synchronously. Error menjadi signal.

### 12.1 `Mono.error`

```java
return repository.findById(id)
    .switchIfEmpty(Mono.error(new NotFoundException("case not found")));
```

### 12.2 `onErrorMap`

Gunakan untuk mengubah exception teknis menjadi domain/application exception.

```java
return downstreamClient.fetch(id)
    .onErrorMap(WebClientResponseException.NotFound.class,
        ex -> new ExternalReferenceNotFoundException(id));
```

### 12.3 `onErrorResume`

Gunakan untuk recovery yang memang benar secara domain.

```java
return primaryClient.fetchPolicy(policyId)
    .onErrorResume(TimeoutException.class,
        ex -> cache.getLastKnownPolicy(policyId));
```

Jangan gunakan sebagai “catch all then return empty” jika itu menyembunyikan kerusakan.

Anti-pattern:

```java
return service.load(id)
    .onErrorResume(ex -> Mono.empty()); // hilang observability dan semantics
```

### 12.4 Global exception handler

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(NotFoundException.class)
    Mono<ResponseEntity<ProblemDetail>> notFound(NotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        pd.setTitle("Resource not found");
        pd.setDetail(ex.getMessage());
        return Mono.just(ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd));
    }
}
```

Spring WebFlux juga punya lower-level `ErrorWebExceptionHandler` untuk functional/global handling.

---

## 13. WebFilter vs HandlerFilterFunction

Spring MVC punya Servlet Filter dan HandlerInterceptor. WebFlux punya:

1. `WebFilter` untuk filter global reactive request/response.
2. `HandlerFilterFunction` untuk functional endpoint filtering.
3. Spring Security reactive filter chain.

### 13.1 WebFilter example: correlation id

```java
@Component
class CorrelationIdWebFilter implements WebFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String correlationId = Optional.ofNullable(exchange.getRequest()
                .getHeaders()
                .getFirst("X-Correlation-ID"))
            .orElse(UUID.randomUUID().toString());

        exchange.getResponse().getHeaders().set("X-Correlation-ID", correlationId);

        return chain.filter(exchange)
            .contextWrite(ctx -> ctx.put("correlationId", correlationId));
    }
}
```

Catatan: Reactor context bukan ThreadLocal biasa.

### 13.2 Security filter chain reactive

```java
@Bean
SecurityWebFilterChain security(ServerHttpSecurity http) {
    return http
        .csrf(ServerHttpSecurity.CsrfSpec::disable)
        .authorizeExchange(exchanges -> exchanges
            .pathMatchers(HttpMethod.GET, "/health").permitAll()
            .pathMatchers("/cases/**").authenticated()
            .anyExchange().denyAll())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
        .build();
}
```

Resource-level authorization tetap harus dilakukan dekat resource/service layer, bukan hanya path matcher.

---

## 14. Functional Endpoints

Functional endpoints memisahkan routing dan handling secara eksplisit.

```java
@Configuration
class CaseRoutes {

    @Bean
    RouterFunction<ServerResponse> caseRouter(CaseHandler handler) {
        return route()
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

    private final CaseService service;

    CaseHandler(CaseService service) {
        this.service = service;
    }

    Mono<ServerResponse> get(ServerRequest request) {
        UUID id = UUID.fromString(request.pathVariable("id"));

        return service.getCase(id)
            .flatMap(dto -> ServerResponse.ok().bodyValue(dto))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    Mono<ServerResponse> create(ServerRequest request) {
        return request.bodyToMono(CreateCaseRequest.class)
            .flatMap(service::create)
            .flatMap(dto -> ServerResponse.created(URI.create("/cases/" + dto.id()))
                .bodyValue(dto));
    }
}
```

Kelebihan functional endpoints:

1. Routing eksplisit.
2. Mudah compose route group.
3. Handler bisa diuji sebagai function.
4. Cocok untuk API gateway/lightweight service.

Kekurangan:

1. Kurang familiar bagi tim Spring MVC.
2. Bisa verbose untuk banyak endpoint.
3. Annotation-based tooling kadang lebih matang/familiar.

---

## 15. WebClient: Reactive HTTP Client

WebFlux sering dipasangkan dengan `WebClient` untuk outbound HTTP non-blocking.

```java
Mono<RespondentDto> fetchRespondent(UUID id) {
    return webClient.get()
        .uri("/respondents/{id}", id)
        .retrieve()
        .bodyToMono(RespondentDto.class);
}
```

Namun production client perlu lebih dari itu.

### 15.1 Status mapping

```java
Mono<RespondentDto> fetchRespondent(UUID id) {
    return webClient.get()
        .uri("/respondents/{id}", id)
        .retrieve()
        .onStatus(HttpStatusCode::is4xxClientError, response ->
            response.bodyToMono(ProblemDetail.class)
                .flatMap(problem -> Mono.error(new DownstreamClientException(problem))))
        .onStatus(HttpStatusCode::is5xxServerError, response ->
            response.bodyToMono(String.class)
                .defaultIfEmpty("")
                .flatMap(body -> Mono.error(new DownstreamServerException("respondent service failed"))))
        .bodyToMono(RespondentDto.class);
}
```

### 15.2 Timeout

```java
Mono<RespondentDto> fetchRespondent(UUID id) {
    return webClient.get()
        .uri("/respondents/{id}", id)
        .retrieve()
        .bodyToMono(RespondentDto.class)
        .timeout(Duration.ofMillis(800));
}
```

But timeout should be aligned with:

1. inbound request deadline.
2. gateway timeout.
3. client timeout.
4. downstream timeout.
5. retry policy.

### 15.3 Retry only when safe

```java
return webClient.get()
    .uri("/reference-data/{id}", id)
    .retrieve()
    .bodyToMono(ReferenceDto.class)
    .retryWhen(Retry.backoff(2, Duration.ofMillis(100))
        .filter(this::isTransientFailure));
```

Do not blindly retry non-idempotent POST.

If retrying POST, use idempotency keys and domain-level dedup.

### 15.4 Propagate tracing and correlation headers

Use filters:

```java
@Bean
WebClient webClient(WebClient.Builder builder) {
    return builder
        .filter((request, next) -> Mono.deferContextual(ctx -> {
            String correlationId = ctx.getOrDefault("correlationId", UUID.randomUUID().toString());
            ClientRequest mutated = ClientRequest.from(request)
                .header("X-Correlation-ID", correlationId)
                .build();
            return next.exchange(mutated);
        }))
        .build();
}
```

In real systems, prefer OpenTelemetry/Micrometer instrumentation rather than fully manual tracing.

---

## 16. Reactive Database Access

For a truly non-blocking stack, database layer matters.

Options:

1. R2DBC for relational database access.
2. Reactive MongoDB driver.
3. Reactive Redis driver.
4. Reactive Cassandra/Scylla clients where available.
5. Reactive Elasticsearch client alternatives depending on version/library.
6. Messaging clients with reactive bridge.

### 16.1 JPA is blocking

JPA/Hibernate is traditionally blocking and thread-bound.

A common migration trap:

```text
WebFlux controller
  -> service returns Mono
  -> inside service uses blocking JPA
```

This can work only if isolated:

```java
Mono<CaseEntity> findCase(UUID id) {
    return Mono.fromCallable(() -> jpaRepository.findById(id)
            .orElseThrow(NotFoundException::new))
        .subscribeOn(Schedulers.boundedElastic());
}
```

But it is not equivalent to reactive database access.

### 16.2 Transaction boundary

Spring reactive transactions use different mechanics than imperative transactions.

Imperative pattern:

```java
@Transactional
public Case create(CreateCaseRequest req) {
    ...
}
```

Reactive transaction pattern often uses reactive transaction manager or `TransactionalOperator`:

```java
Mono<CaseResponse> create(CreateCaseRequest req) {
    return transactionalOperator.transactional(
        caseRepository.save(toEntity(req))
            .flatMap(saved -> auditRepository.save(audit(saved)).thenReturn(saved))
            .map(mapper::toResponse)
    );
}
```

Do not assume ThreadLocal transaction semantics behave the same way across asynchronous boundaries.

---

## 17. DataBuffer and Memory Safety

WebFlux uses `DataBuffer` for low-level body processing. When dealing with raw buffers, memory management matters, especially with Netty pooled buffers.

High-level APIs like `bodyToMono(MyDto.class)` are safer.

Low-level streaming example:

```java
@PostMapping("/upload")
Mono<ResponseEntity<Void>> upload(@RequestBody Flux<DataBuffer> body) {
    return storageService.write(body)
        .thenReturn(ResponseEntity.accepted().build());
}
```

Risks:

1. Memory leak if buffers retained incorrectly.
2. Buffering entire file accidentally.
3. Missing size limit.
4. Slow consumer causing memory pressure.
5. Compression bomb.

For file upload, prefer high-level multipart APIs or controlled streaming service that enforces:

1. max bytes.
2. timeout.
3. checksum.
4. content type validation.
5. storage cleanup.
6. malware scanning workflow.

---

## 18. Streaming Response Patterns

### 18.1 NDJSON

```java
@GetMapping(value = "/cases/{id}/events", produces = MediaType.APPLICATION_NDJSON_VALUE)
Flux<CaseEventDto> events(@PathVariable UUID id) {
    return eventService.streamEvents(id);
}
```

Good for machine clients.

### 18.2 SSE

```java
@GetMapping(value = "/cases/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<ServerSentEvent<CaseEventDto>> sse(@PathVariable UUID id) {
    return eventService.streamEvents(id)
        .map(event -> ServerSentEvent.<CaseEventDto>builder()
            .id(event.sequence().toString())
            .event(event.type())
            .data(event)
            .build());
}
```

Important:

1. Send event IDs for resume.
2. Support `Last-Event-ID` when possible.
3. Add heartbeat if connection may be idle.
4. Configure proxy buffering off where needed.
5. Enforce auth and resource-level authorization before opening stream.
6. Re-check permissions for long-lived streams if permissions can change.

### 18.3 Heartbeat

```java
Flux<ServerSentEvent<CaseEventDto>> data = eventService.streamEvents(id)
    .map(event -> ServerSentEvent.builder(event).event("case-event").build());

Flux<ServerSentEvent<CaseEventDto>> heartbeat = Flux.interval(Duration.ofSeconds(20))
    .map(tick -> ServerSentEvent.<CaseEventDto>builder().comment("heartbeat").build());

return Flux.merge(data, heartbeat);
```

### 18.4 Streaming vs async job

Do not use streaming response for all long operations.

If operation is critical and should complete independent of client connection:

```text
POST /reports
202 Accepted
Location: /reports/{reportId}
```

Then use:

```text
GET /reports/{reportId}
GET /reports/{reportId}/download
GET /reports/{reportId}/events
```

---

## 19. Blocking Detection

In a reactive service, one of the most valuable disciplines is detecting accidental blocking.

Tools/patterns:

1. Code review rule: no `.block()` in request path.
2. BlockHound in test/dev for detecting blocking calls.
3. Thread name inspection in logs.
4. Metrics for event-loop saturation.
5. Load test with slow downstream.
6. Timeouts around all outbound dependencies.
7. Separate bounded scheduler for known blocking bridges.

Anti-pattern:

```java
Mono<CaseResponse> get(UUID id) {
    CaseEntity entity = repository.findById(id).block();
    return Mono.just(mapper.toResponse(entity));
}
```

This defeats WebFlux and can deadlock or starve event loops.

---

## 20. Scheduler Usage

Reactor has schedulers such as:

| Scheduler | Use |
|---|---|
| `immediate` | run on current thread |
| `single` | single reusable thread |
| `parallel` | CPU-bound work with fixed worker pool |
| `boundedElastic` | blocking I/O bridge with bounded growth |

### 20.1 `subscribeOn` vs `publishOn`

`subscribeOn` affects where subscription/source work happens.

```java
return Mono.fromCallable(this::blockingCall)
    .subscribeOn(Schedulers.boundedElastic());
```

`publishOn` shifts downstream operators.

```java
return source
    .publishOn(Schedulers.parallel())
    .map(this::cpuHeavyTransform);
```

### 20.2 Do not sprinkle schedulers randomly

Bad:

```java
return repo.find(id)
    .publishOn(Schedulers.boundedElastic())
    .flatMap(this::callOtherService)
    .publishOn(Schedulers.parallel())
    .map(this::transform)
    .subscribeOn(Schedulers.boundedElastic());
```

This makes execution hard to reason about.

Better:

1. Keep non-blocking chain on event-loop/default reactive threads.
2. Isolate known blocking boundary explicitly.
3. Isolate CPU-heavy work explicitly.
4. Document why scheduler shift exists.

---

## 21. Context Propagation: ThreadLocal Trap

Servlet stack often relies on ThreadLocal:

1. SecurityContext.
2. MDC logging.
3. transaction context.
4. request context.
5. tenant context.

In WebFlux, execution can move across threads. ThreadLocal is unreliable unless framework bridges it.

Reactor provides Context:

```java
return Mono.deferContextual(ctx -> {
    String tenantId = ctx.get("tenantId");
    return service.loadForTenant(tenantId);
});
```

Set context:

```java
return chain.filter(exchange)
    .contextWrite(ctx -> ctx.put("tenantId", tenantId));
```

Spring Security has reactive security context support. Use reactive-aware APIs:

```java
Mono<Authentication> auth = ReactiveSecurityContextHolder.getContext()
    .map(SecurityContext::getAuthentication);
```

Do not assume `SecurityContextHolder.getContext()` imperative ThreadLocal works correctly in reactive flows.

---

## 22. Observability in WebFlux

Reactive observability must handle asynchronous execution.

### 22.1 What to measure

For inbound HTTP:

1. request count.
2. status code distribution.
3. latency percentiles.
4. active requests/streams.
5. request body size.
6. response body size.
7. cancellation count.
8. timeout count.
9. event-loop pending tasks.
10. connection pool metrics.
11. outbound WebClient latency.
12. scheduler queue saturation.
13. DataBuffer memory/pool metrics.

### 22.2 Access logs

Reactor Netty access logs can be enabled. In production, ensure logs contain:

1. method.
2. path template if possible.
3. status.
4. duration.
5. bytes sent.
6. remote address after trust boundary normalization.
7. request ID/trace ID.
8. user/tenant only if safe and policy allows.

Do not log raw Authorization headers, cookies, tokens, or PII.

### 22.3 Tracing

Use OpenTelemetry/Micrometer instrumentation where possible.

Manual tracing in reactive code is easy to get wrong because of context propagation. Prefer framework-integrated instrumentation, and verify propagation across:

1. inbound request.
2. WebFilter.
3. controller.
4. WebClient outbound.
5. database reactive client.
6. message publisher.
7. async job boundary.

---

## 23. Security in WebFlux

Security rules from earlier parts still apply:

1. Authentication: verify token/session.
2. Authorization: resource-level check.
3. CSRF if browser cookie-based auth.
4. CORS as browser permission, not auth.
5. Rate limiting and abuse controls.
6. Body size limits.
7. Error leakage prevention.
8. Header trust boundaries.
9. SSRF prevention for outbound calls.
10. Request smuggling protection at edge.

### 23.1 Resource-level authorization example

```java
Mono<CaseResponse> getCase(UUID id) {
    return caseRepository.findById(id)
        .switchIfEmpty(Mono.error(new NotFoundException("case not found")))
        .flatMap(caseEntity -> ReactiveSecurityContextHolder.getContext()
            .map(SecurityContext::getAuthentication)
            .flatMap(auth -> authorizationService.canView(auth, caseEntity)
                .flatMap(allowed -> allowed
                    ? Mono.just(caseEntity)
                    : Mono.error(new AccessDeniedException("forbidden")))))
        .map(mapper::toResponse);
}
```

### 23.2 Timing and existence leakage

Reactive code does not magically solve existence leakage.

Decide explicitly:

```text
unauthorized access to existing hidden case -> 404 or 403?
```

Same decision from Part 015 applies.

---

## 24. Performance: When WebFlux Helps and When It Does Not

WebFlux tends to help when:

1. Many concurrent I/O-bound requests.
2. Long-lived streaming connections.
3. Downstream calls are non-blocking.
4. Database driver is reactive.
5. Need backpressure-aware streaming.
6. Thread-per-request would spend most time waiting.
7. Memory/thread overhead matters.

WebFlux may not help when:

1. Workload is CPU-bound.
2. All dependencies are blocking.
3. Team lacks reactive debugging skill.
4. Simpler MVC meets latency and throughput targets.
5. Endpoint count is mostly CRUD with short request time.
6. Existing libraries are imperative and ThreadLocal-heavy.
7. Transaction model depends on JPA/Hibernate deeply.

### 24.1 Correct benchmark question

Bad benchmark question:

> Which is faster, MVC or WebFlux?

Better benchmark questions:

1. What is p50/p95/p99 latency under expected concurrency?
2. What happens when downstream p99 rises 10x?
3. How many concurrent SSE connections can we hold?
4. What is memory usage per active connection?
5. What is event-loop utilization?
6. What happens when clients are slow readers?
7. What happens under retry storm?
8. What is failure isolation behavior?
9. Can team debug production incidents quickly?

---

## 25. Design Pattern: Reactive Service Layer

A clean WebFlux service layer should preserve reactive composition.

```java
@Service
class CaseApplicationService {

    private final CaseRepository caseRepository;
    private final RespondentClient respondentClient;
    private final CaseAuthorizationService authorizationService;
    private final CaseMapper mapper;

    Mono<CaseResponse> getCase(UUID id) {
        return caseRepository.findById(id)
            .switchIfEmpty(Mono.error(new NotFoundException("case not found")))
            .flatMap(caseEntity -> authorizationService.requireCanView(caseEntity)
                .thenReturn(caseEntity))
            .flatMap(caseEntity -> respondentClient.fetch(caseEntity.respondentId())
                .map(respondent -> mapper.toResponse(caseEntity, respondent)))
            .timeout(Duration.ofSeconds(2));
    }
}
```

Key properties:

1. No `.block()`.
2. Authorization is in chain.
3. Downstream call is composed.
4. Timeout is explicit.
5. Errors flow into global handler.
6. Result remains `Mono<CaseResponse>`.

---

## 26. Design Pattern: Idempotent Command in WebFlux

```java
@PostMapping("/case-submissions")
Mono<ResponseEntity<SubmissionResponse>> submit(
    @RequestHeader("Idempotency-Key") String idempotencyKey,
    @Valid @RequestBody Mono<CreateSubmissionRequest> body
) {
    return body
        .flatMap(req -> submissionService.submit(idempotencyKey, req))
        .map(result -> ResponseEntity.status(result.created() ? 201 : 200)
            .header("Location", "/case-submissions/" + result.submissionId())
            .body(result.response()));
}
```

Service sketch:

```java
Mono<SubmissionResult> submit(String key, CreateSubmissionRequest req) {
    return idempotencyService.acquireOrReplay(key, req)
        .flatMap(decision -> switch (decision.kind()) {
            case REPLAY -> Mono.just(decision.previousResult());
            case ACQUIRED -> createSubmission(req)
                .flatMap(result -> idempotencyService.storeResult(key, result).thenReturn(result));
            case CONFLICT -> Mono.error(new IdempotencyConflictException());
        });
}
```

The hard part is not Reactor syntax. The hard part is atomic idempotency design.

---

## 27. Design Pattern: Reactive Streaming with Cursor Resume

For audit event stream:

```text
GET /cases/{caseId}/events?afterSequence=123
Accept: application/x-ndjson
```

Controller:

```java
@GetMapping(value = "/cases/{caseId}/events", produces = MediaType.APPLICATION_NDJSON_VALUE)
Flux<CaseEventDto> streamEvents(
    @PathVariable UUID caseId,
    @RequestParam(defaultValue = "0") long afterSequence
) {
    return authorizationService.requireCanViewCase(caseId)
        .thenMany(eventRepository.streamAfter(caseId, afterSequence))
        .map(mapper::toDto);
}
```

Important semantics:

1. Events are durable.
2. Client can resume.
3. Sequence is monotonic per case or globally.
4. Authorization checked before stream starts.
5. If permission changes mid-stream, decide whether to terminate.
6. Slow client policy is explicit.
7. Proxy timeout/buffering configured.

---

## 28. Common Anti-Patterns

### 28.1 `.block()` in request path

```java
return Mono.just(service.get(id).block());
```

Breaks non-blocking model.

### 28.2 Reactive wrapper over blocking mess

```java
Mono.just(jpaRepository.findAll())
```

This calls blocking code immediately before Mono exists.

Use:

```java
Mono.fromCallable(() -> jpaRepository.findAll())
    .subscribeOn(Schedulers.boundedElastic())
```

But treat it as migration compromise.

### 28.3 Unbounded `flatMap`

```java
Flux.fromIterable(ids)
    .flatMap(this::callDownstream)
```

May DDoS your own dependency. Add concurrency limit.

### 28.4 Catch-all fallback

```java
.onErrorResume(ex -> Mono.empty())
```

Can turn real production failure into silent data loss.

### 28.5 Ignoring cancellation

Long-running operations tied to client connection without idempotency/job model.

### 28.6 Logging in reactive chain with PII

```java
.doOnNext(req -> log.info("request={}", req))
```

May leak personal/regulatory data.

### 28.7 Using WebFlux because it sounds modern

If team, dependencies, and workload are MVC-shaped, Spring MVC may be better.

### 28.8 Mixing ThreadLocal assumptions

Security, tenant, request ID, transaction context must be reactive-aware.

### 28.9 Buffering streams accidentally

```java
flux.collectList()
```

This turns stream into memory-bound aggregate.

### 28.10 No timeout on WebClient

Reactive does not imply bounded. Every dependency still needs timeout/deadline.

---

## 29. Migration Strategy from Spring MVC to WebFlux

Do not migrate by replacing return types mechanically.

Bad migration:

```text
Controller<T> -> Controller<Mono<T>>
keep all blocking services
keep JPA
keep ThreadLocal assumptions
```

Better migration:

1. Identify workload reason:
   - streaming?
   - many outbound I/O calls?
   - high concurrency idle connections?
   - gateway reactive filters?
2. Start with isolated endpoint/service.
3. Use WebClient for outbound HTTP.
4. Keep blocking dependency behind bounded scheduler if unavoidable.
5. Add BlockHound/test checks.
6. Add event-loop metrics.
7. Add timeout and cancellation tests.
8. Avoid mixing MVC and WebFlux blindly in same app unless you understand Spring Boot auto-configuration behavior.
9. Train team on Reactor operators and debugging.
10. Benchmark under realistic failure conditions.

Migration should be driven by a bottleneck or capability, not fashion.

---

## 30. Testing WebFlux

### 30.1 WebTestClient

```java
@WebFluxTest(CaseController.class)
class CaseControllerTest {

    @Autowired WebTestClient webTestClient;

    @Test
    void returnsCase() {
        webTestClient.get()
            .uri("/cases/{id}", UUID.randomUUID())
            .exchange()
            .expectStatus().isOk()
            .expectHeader().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)
            .expectBody()
            .jsonPath("$.id").exists();
    }
}
```

### 30.2 StepVerifier

```java
@Test
void serviceReturnsNotFoundWhenMissing() {
    Mono<CaseResponse> result = service.getCase(missingId);

    StepVerifier.create(result)
        .expectError(NotFoundException.class)
        .verify();
}
```

### 30.3 Timeout test

```java
StepVerifier.withVirtualTime(() -> service.callSlowDependency())
    .thenAwait(Duration.ofSeconds(3))
    .expectError(TimeoutException.class)
    .verify();
```

### 30.4 Cancellation test

```java
StepVerifier.create(eventService.streamEvents(caseId))
    .thenRequest(1)
    .expectNextCount(1)
    .thenCancel()
    .verify();
```

### 30.5 Contract tests still matter

WebFlux does not replace:

1. OpenAPI contract testing.
2. Problem Details error shape tests.
3. authorization matrix tests.
4. idempotency tests.
5. retry/cancellation tests.
6. gateway/proxy integration tests.

---

## 31. Production Checklist

Before choosing WebFlux for a backend service, answer:

### 31.1 Workload fit

- [ ] Is workload I/O-bound or streaming-heavy?
- [ ] Are there many concurrent idle/long-lived connections?
- [ ] Are dependencies non-blocking?
- [ ] If dependencies are blocking, are they isolated and bounded?
- [ ] Is MVC insufficient under measured load?

### 31.2 HTTP correctness

- [ ] Are status codes mapped correctly?
- [ ] Are errors represented consistently?
- [ ] Are idempotent operations safe under retry?
- [ ] Are cancellation semantics understood?
- [ ] Are streaming endpoints resumable or explicitly ephemeral?

### 31.3 Resource control

- [ ] Are request body limits enforced?
- [ ] Are response stream policies defined?
- [ ] Are timeouts configured for inbound/outbound/database?
- [ ] Is flatMap concurrency bounded?
- [ ] Are buffers bounded?
- [ ] Are event-loop blocking calls detected?

### 31.4 Security

- [ ] Is authentication reactive-aware?
- [ ] Is authorization resource-level?
- [ ] Are CORS/CSRF rules correct for browser clients?
- [ ] Are tokens/cookies redacted from logs?
- [ ] Is SSRF prevention applied to outbound URL-taking flows?
- [ ] Are forwarded headers trusted only from known proxies?

### 31.5 Observability

- [ ] Are access logs enabled where needed?
- [ ] Are trace IDs propagated through WebClient?
- [ ] Are event-loop metrics visible?
- [ ] Are scheduler queues visible?
- [ ] Are cancellation/timeouts counted?
- [ ] Are streaming active connections visible?
- [ ] Are high-cardinality tags avoided?

### 31.6 Team readiness

- [ ] Can engineers explain `Mono` vs value?
- [ ] Can engineers debug reactive stack traces?
- [ ] Are operator choices reviewed?
- [ ] Is there a rule against `.block()` in request path?
- [ ] Are tests written with `WebTestClient`/`StepVerifier`?

---

## 32. Case Study: Regulatory Enforcement Case Event API

Suppose a regulatory platform needs:

1. Case detail retrieval.
2. Evidence upload.
3. Long-running report export.
4. Live case event notification.
5. Cross-service enrichment from respondent service.
6. Resource-level authorization.
7. Auditability.

### 32.1 Use MVC or WebFlux?

Case detail retrieval with JPA and simple JSON:

```text
Spring MVC likely enough
```

Live event notification with thousands of SSE clients:

```text
WebFlux can be strong fit
```

Report export that takes minutes:

```text
Use async job resource, not long blocking HTTP request
```

Evidence upload large files:

```text
Prefer object storage direct upload or carefully controlled streaming
```

Cross-service enrichment with several non-blocking HTTP calls:

```text
WebFlux + WebClient can fit, but bound concurrency and timeouts
```

### 32.2 Resource design

```http
GET /cases/{caseId}
GET /cases/{caseId}/events?afterSequence=123
POST /cases/{caseId}/exports
GET /cases/{caseId}/exports/{exportId}
GET /cases/{caseId}/exports/{exportId}/download
```

### 32.3 Reactive event stream

```java
@GetMapping(value = "/cases/{caseId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
Flux<ServerSentEvent<CaseEventDto>> streamCaseEvents(
    @PathVariable UUID caseId,
    @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId
) {
    long after = parseLastEventId(lastEventId).orElse(0L);

    Flux<ServerSentEvent<CaseEventDto>> events = authorizationService.requireCanViewCase(caseId)
        .thenMany(caseEventRepository.streamAfter(caseId, after))
        .map(event -> ServerSentEvent.<CaseEventDto>builder()
            .id(Long.toString(event.sequence()))
            .event(event.type())
            .data(mapper.toDto(event))
            .build());

    Flux<ServerSentEvent<CaseEventDto>> heartbeat = Flux.interval(Duration.ofSeconds(20))
        .map(tick -> ServerSentEvent.<CaseEventDto>builder()
            .comment("heartbeat")
            .build());

    return Flux.merge(events, heartbeat)
        .doOnCancel(() -> log.info("case event stream cancelled caseId={}", caseId));
}
```

Production details:

1. Auth checked before streaming.
2. Event IDs support resume.
3. Heartbeat keeps connection alive through proxies.
4. Cancellation is logged.
5. Stream is durable if event repository is durable.
6. Slow clients need explicit policy.
7. Gateway must avoid unwanted buffering.

---

## 33. Mini Reference: Operator Decision Table

| Need | Operator/pattern |
|---|---|
| transform value synchronously | `map` |
| call async operation | `flatMap` |
| preserve order with async ops | `concatMap` |
| limit concurrent async ops | `flatMap(fn, concurrency)` |
| return fallback on empty | `switchIfEmpty` |
| convert error | `onErrorMap` |
| recover from error | `onErrorResume` |
| run after completion | `then`, `thenReturn` |
| combine independent monos | `zip` |
| stream items as they arrive | `Flux` response |
| collect bounded list | `collectList` |
| isolate blocking call | `fromCallable(...).subscribeOn(boundedElastic())` |
| add timeout | `timeout(Duration)` |
| retry transient safe operation | `retryWhen` with filter/backoff |
| access Reactor context | `deferContextual` |

---

## 34. Exercises

### Exercise 1 — Identify Blocking Risk

Given this WebFlux code:

```java
@GetMapping("/cases/{id}")
Mono<CaseResponse> get(@PathVariable UUID id) {
    CaseEntity entity = jpaRepository.findById(id).orElseThrow();
    return Mono.just(mapper.toResponse(entity));
}
```

Explain:

1. Why this is blocking.
2. Why `Mono.just` does not make it non-blocking.
3. How to isolate it temporarily.
4. What real migration would require.

### Exercise 2 — Bound Fan-Out

Design endpoint:

```http
POST /case-search/enrich
```

Input contains 500 case IDs. For each case, service must call respondent service. Create a WebFlux chain that:

1. limits downstream concurrency,
2. applies timeout,
3. maps partial errors explicitly,
4. avoids unbounded memory growth.

### Exercise 3 — Streaming Event Contract

Design an SSE endpoint for case events. Define:

1. URI.
2. event ID semantics.
3. resume behavior.
4. heartbeat policy.
5. authorization policy.
6. slow client policy.
7. observability metrics.

### Exercise 4 — Cancellation Semantics

For:

```http
POST /case-decisions
```

Client disconnects after server commits decision but before response is sent.

Explain:

1. What client sees.
2. What server state is.
3. Why cancellation is not rollback.
4. How idempotency key helps.
5. What audit record should contain.

### Exercise 5 — MVC vs WebFlux Decision

For each endpoint below, choose Spring MVC or WebFlux and justify:

1. `GET /reference-data/countries`
2. `GET /cases/{id}` backed by JPA
3. `GET /cases/{id}/events` SSE
4. `POST /evidence-files` large upload
5. `POST /exports` long-running report
6. `GET /dashboard/live-alerts` with thousands of concurrent clients

---

## 35. Key Takeaways

1. WebFlux is a concurrency model shift, not a free performance upgrade.
2. `Mono` and `Flux` are pipelines, not values/collections.
3. Non-blocking only helps if the dependency chain is non-blocking or blocking is explicitly isolated.
4. Event-loop threads are precious; never block them.
5. Backpressure is valuable, but not magically end-to-end through every proxy/source.
6. Cancellation is a signal, not a domain rollback.
7. Reactive error handling is signal-based and must preserve HTTP semantics.
8. WebClient needs timeout, retry policy, status mapping, and tracing—not just `retrieve()`.
9. ThreadLocal assumptions break unless replaced by reactive-aware context handling.
10. WebFlux is especially useful for streaming, SSE, high concurrency I/O, and reactive gateway-style workloads.
11. Spring MVC is still a strong and often better choice for many imperative CRUD/transactional systems.
12. Top-tier backend engineers choose WebFlux based on workload, dependency model, operability, and team skill—not trend.

---

## 36. References

- Spring Framework Reference — Spring WebFlux: reactive-stack web framework, non-blocking, Reactive Streams back pressure, Netty and Servlet containers.
- Spring Framework Reference — WebFlux Overview and Reactive Core: `HttpHandler`, adapters, Reactor integration.
- Spring Framework Reference — Functional Endpoints: WebFlux.fn routing and handler model.
- Project Reactor: `Mono`, `Flux`, Reactive Streams, non-blocking applications on JVM.
- Reactor Netty Reference: HTTP/TCP/UDP non-blocking network runtime for Reactor-based applications.
- Reactive Streams specification: asynchronous stream processing with non-blocking backpressure.
- Spring Security Reactive documentation: reactive security context and `SecurityWebFilterChain`.
- OpenTelemetry HTTP semantic conventions: consistent tracing/metrics semantics for HTTP services.

---

# End of Part 030

Status seri: **Part 030 dari 032**.  
Seri **belum selesai**.  
Bagian berikutnya: `learn-http-for-web-backend-perspective-part-031.md` — **Backend-to-Backend HTTP Clients**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-029.md">⬅️ Part 029 — Java Backend Implementation: Servlet, Spring MVC, Filters, Interceptors</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-031.md">HTTP for Web/Backend Perspective — Part 031 ➡️</a>
</div>
