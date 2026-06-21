# Part 30 — Performance Engineering for Spring Applications

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `30-performance-engineering-for-spring-applications.md`  
> Status seri: Part 30 dari 35 — belum selesai  
> Prasyarat utama: Part 1–29, terutama IoC container, auto-configuration, AOP/proxy, transaction, Web MVC, WebFlux, HTTP client, caching, async, virtual threads, observability, testing, AOT/native image.

---

## 0. Tujuan Part Ini

Performance engineering untuk aplikasi Spring bukan sekadar:

```text
pakai cache
pakai WebFlux
pakai virtual thread
pakai native image
naikkan connection pool
matikan log
```

Itu semua hanya teknik. Teknik tanpa model biasanya menghasilkan tuning acak.

Tujuan part ini adalah membangun cara berpikir seperti engineer yang mampu:

1. membaca aplikasi Spring sebagai runtime system;
2. membedakan latency, throughput, capacity, utilization, saturation, dan efficiency;
3. mengidentifikasi bottleneck berdasarkan evidence;
4. memahami overhead Spring yang nyata vs overhead yang dibayangkan;
5. mengoptimalkan startup, request path, database path, serialization path, background path, dan integration path;
6. membuat regression guard supaya performa tidak memburuk diam-diam;
7. memilih antara MVC, WebFlux, virtual threads, AOT/native image, cache, batch, dan async berdasarkan trade-off nyata;
8. mendesain sistem Spring yang performanya bisa dijelaskan, diukur, dan dipertahankan.

Part ini tidak akan mengulang teori JVM/JFR/GC/benchmarking umum yang sudah dibahas pada seri Java performance sebelumnya. Yang dibahas di sini adalah **bagaimana konsep tersebut muncul secara spesifik dalam aplikasi Spring**.

---

## 1. Mental Model: Spring Performance Is System Performance

Aplikasi Spring bukan satu loop tunggal. Ia adalah gabungan dari beberapa subsistem:

```text
incoming request
  -> servlet container / Netty
  -> filter chain
  -> security chain
  -> dispatcher / handler mapping
  -> argument resolution
  -> validation / conversion
  -> controller
  -> service proxy chain
  -> transaction interceptor
  -> repository / mapper / client
  -> database / cache / broker / HTTP remote
  -> serialization
  -> response write
```

Spring performance jarang ditentukan oleh satu komponen saja. Biasanya ditentukan oleh **boundary**:

| Boundary | Contoh Bottleneck |
|---|---|
| HTTP ingress | thread pool saturation, slow client, TLS, payload besar |
| Security | token validation mahal, remote introspection, authority lookup |
| Controller binding | JSON besar, validation mahal, conversion berulang |
| Service proxy | transaction/cache/security advice chain |
| Database | connection pool, slow SQL, lock, N+1, transaction terlalu panjang |
| Cache | stampede, key terlalu luas, serialization mahal |
| HTTP outbound | no timeout, pool starvation, retry storm |
| Messaging | consumer concurrency, poison message, DLQ storm |
| Async | queue growth, lost context, executor saturation |
| Observability | high-cardinality tags, excessive spans/logs |
| Startup | classpath scanning, auto-config explosion, eager initialization |

Mental model utamanya:

```text
Spring rarely makes a slow system fast.
Spring can make a poorly bounded system fail predictably — or fail expensively.
```

Performance Spring yang baik bukan berarti semua code dibuat micro-optimized. Performance yang baik berarti setiap boundary punya:

1. limit;
2. timeout;
3. metric;
4. backpressure;
5. failure semantics;
6. ownership;
7. regression test.

---

## 2. Performance Vocabulary yang Harus Tepat

Banyak diskusi performa gagal karena istilahnya campur.

### 2.1 Latency

Latency adalah waktu yang dialami satu operasi.

Contoh:

```text
GET /cases/123 p95 = 180 ms
POST /applications p99 = 1.8 s
```

Latency harus dilihat sebagai distribusi, bukan average.

```text
avg 50 ms, p99 3000 ms
```

lebih berbahaya daripada:

```text
avg 120 ms, p99 180 ms
```

Karena user dan upstream system biasanya merasakan tail latency.

### 2.2 Throughput

Throughput adalah jumlah operasi per unit waktu.

```text
requests/sec
messages/sec
rows/sec
jobs/hour
```

Throughput tinggi tidak selalu berarti latency rendah. Sistem bisa memproses banyak request tapi masing-masing lambat karena queueing.

### 2.3 Utilization

Utilization adalah seberapa banyak resource dipakai.

```text
CPU 80%
heap 70%
DB pool active 90%
executor active 100%
```

Utilization tinggi belum tentu buruk. Yang buruk adalah utilization tinggi plus queue naik plus latency naik.

### 2.4 Saturation

Saturation adalah kondisi ketika resource tidak cukup dan request mulai menunggu.

Contoh:

```text
Hikari active = max pool size
Hikari pending threads > 0
Tomcat busy threads mendekati max
Executor queue terus naik
Kafka consumer lag terus naik
```

Performance incident sering dimulai dari saturation, bukan exception.

### 2.5 Capacity

Capacity adalah batas aman sistem sebelum SLO rusak.

```text
Aplikasi aman sampai 150 RPS dengan p95 < 300 ms.
Setelah 180 RPS, DB pool saturated dan p99 melewati 2 detik.
```

Capacity bukan angka statis. Ia tergantung workload mix.

### 2.6 Efficiency

Efficiency adalah output per resource.

```text
RPS per core
messages/sec per consumer
requests/sec per DB connection
startup time per bean count
```

Top-tier engineer tidak hanya bertanya “berapa cepat?”, tetapi “berapa mahal untuk mencapai cepat itu?”.

---

## 3. Golden Rule: Measure Before Tune

Dalam Spring, banyak optimization yang terdengar benar tetapi salah secara kasus.

Contoh:

| Dugaan | Bisa Salah Karena |
|---|---|
| “Spring lambat karena reflection” | bottleneck sebenarnya DB lock atau JSON payload |
| “Butuh WebFlux” | blocking DB tetap bottleneck |
| “Butuh virtual thread” | connection pool tetap 20 |
| “Butuh cache” | data user-specific, cache invalidation sulit |
| “Naikkan Hikari pool” | DB CPU sudah saturated |
| “Matikan Actuator” | metric cardinality yang salah, bukan Actuator-nya |
| “Native image pasti lebih cepat” | startup lebih cepat, throughput belum tentu lebih baik |

Performance workflow yang benar:

```text
1. Define SLO / target
2. Capture baseline
3. Identify bottleneck with evidence
4. Form hypothesis
5. Change one variable
6. Re-measure
7. Validate side effects
8. Codify guardrail
```

Tanpa baseline, tuning hanyalah tebakan.

---

## 4. Performance Map Aplikasi Spring

Untuk analisis, pecah aplikasi menjadi beberapa path.

```text
A. Startup path
B. Request path
C. Persistence path
D. Serialization path
E. Outbound integration path
F. Cache path
G. Async/background path
H. Messaging path
I. Observability path
J. Shutdown path
```

Setiap path punya metrik dan bottleneck berbeda.

### 4.1 Startup Path

Pertanyaan:

```text
berapa lama app siap menerima traffic?
berapa lama sampai readiness UP?
berapa banyak bean dibuat?
auto-config mana yang mahal?
ada eager remote call saat startup?
```

### 4.2 Request Path

Pertanyaan:

```text
berapa latency p50/p95/p99?
berapa waktu di security?
berapa waktu di controller binding?
berapa waktu di service?
berapa waktu di DB/remote/cache?
```

### 4.3 Persistence Path

Pertanyaan:

```text
berapa active connection?
berapa pending connection?
berapa query per request?
berapa transaction duration?
berapa lock wait?
```

### 4.4 Outbound Path

Pertanyaan:

```text
berapa connection pool wait?
berapa timeout?
berapa retry?
apakah retry memperparah outage?
```

### 4.5 Background Path

Pertanyaan:

```text
berapa executor active?
berapa queue size?
berapa scheduled job overlap?
berapa lag?
berapa DLQ rate?
```

---

## 5. Startup Performance

Startup performance penting untuk:

1. deployment speed;
2. autoscaling responsiveness;
3. Kubernetes rolling update;
4. cold start serverless/container-on-demand;
5. developer feedback loop;
6. native image decision.

Spring Boot menyediakan mekanisme production-ready seperti Actuator dan observability untuk membantu memonitor aplikasi; Actuator mencakup endpoint, health, metrics, dan fitur produksi lain. Dokumentasi resmi Spring Boot menjelaskan bahwa Actuator menyediakan fitur tambahan untuk memonitor dan mengelola aplikasi saat production. Referensi: Spring Boot Actuator production-ready features.

### 5.1 Apa yang Terjadi Saat Startup?

Secara ringkas:

```text
main()
  -> SpringApplication.run()
  -> prepare environment
  -> create ApplicationContext
  -> load bean definitions
  -> evaluate conditions
  -> process configuration classes
  -> instantiate eager singletons
  -> start web server
  -> publish started/ready events
```

Biaya startup muncul dari:

| Area | Biaya |
|---|---|
| Classpath scanning | membaca metadata class |
| Auto-configuration | condition evaluation |
| Bean creation | constructor, dependency resolution |
| Proxy creation | AOP/security/transaction/cache |
| External init | datasource, client, broker, migration |
| Validation | config validation, schema validation |
| Web server | Tomcat/Jetty/Netty initialization |
| JIT warm-up | JVM optimization belum matang |

### 5.2 Common Startup Anti-Pattern

#### Anti-pattern 1 — Remote call saat bean creation

```java
@Component
class ExternalRegistryClient {
    ExternalRegistryClient(RestClient client) {
        client.get().uri("/registry/config").retrieve().body(String.class);
    }
}
```

Masalah:

1. startup tergantung remote system;
2. readiness tertunda;
3. retry bisa memperlambat deployment;
4. failure tidak terisolasi.

Lebih baik:

```java
@Component
class ExternalRegistryWarmup implements ApplicationRunner {
    private final ExternalRegistryService service;

    ExternalRegistryWarmup(ExternalRegistryService service) {
        this.service = service;
    }

    @Override
    public void run(ApplicationArguments args) {
        service.tryWarmup();
    }
}
```

Tetapi untuk production, bahkan runner juga harus jelas:

```text
apakah failure harus menggagalkan startup?
apakah hanya warm cache best-effort?
apakah readiness harus menunggu warmup?
```

#### Anti-pattern 2 — Bean terlalu banyak karena scanning liar

```java
@SpringBootApplication(scanBasePackages = "com.company")
class App {}
```

Jika `com.company` berisi banyak module/library, aplikasi bisa memuat bean yang tidak relevan.

Lebih baik:

```java
@SpringBootApplication(scanBasePackages = "com.company.caseapp")
class CaseApplication {}
```

Atau gunakan modular configuration eksplisit.

#### Anti-pattern 3 — semua configuration full mode tanpa perlu

```java
@Configuration
class ManyBeansConfig {
    @Bean A a() { return new A(); }
    @Bean B b() { return new B(); }
}
```

Untuk configuration yang tidak memanggil `@Bean` method lain, gunakan:

```java
@Configuration(proxyBeanMethods = false)
class ManyBeansConfig {
    @Bean A a() { return new A(); }
    @Bean B b() { return new B(); }
}
```

Ini menghindari CGLIB enhancement yang tidak diperlukan.

### 5.3 Startup Measurement

Gunakan `ApplicationStartup`:

```java
@SpringBootApplication
public class App {
    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(App.class);
        app.setApplicationStartup(new BufferingApplicationStartup(2048));
        app.run(args);
    }
}
```

Dengan Actuator startup endpoint, startup steps bisa dianalisis.

Contoh pertanyaan:

```text
step mana paling lama?
auto-config mana aktif?
bean mana dibuat terlalu awal?
apakah ada repository/client init terlalu cepat?
```

### 5.4 Startup Optimization Checklist

```text
[ ] Batasi component scan.
[ ] Gunakan proxyBeanMethods=false jika aman.
[ ] Hindari remote call di constructor/@PostConstruct.
[ ] Pisahkan fail-fast validation dari warmup best-effort.
[ ] Audit auto-configuration yang aktif.
[ ] Hapus dependency starter yang tidak dipakai.
[ ] Gunakan lazy initialization hanya jika trade-off dimengerti.
[ ] Pakai AOT/native image jika startup/cold-start benar-benar bottleneck.
[ ] Ukur startup dengan ApplicationStartup, bukan feeling.
```

---

## 6. Bean Count, Auto-Configuration, and Context Weight

Bean count bukan metrik performa absolut. Tetapi bean count adalah sinyal kompleksitas runtime.

```text
bean count 150  -> kecil
bean count 600  -> normal enterprise app
bean count 1500 -> perlu audit
bean count 3000 -> biasanya ada starter/scanning/auto-config berlebihan
```

Angka ini bukan aturan kaku. Yang penting adalah tren.

### 6.1 Kenapa Bean Count Berpengaruh?

Karena setiap bean mungkin membawa:

1. dependency resolution;
2. lifecycle callback;
3. proxy wrapping;
4. reflection/metadata;
5. condition evaluation;
6. memory footprint;
7. test context cost.

### 6.2 Auto-Configuration Cost

Auto-configuration bukan musuh. Tetapi auto-configuration yang tidak dipahami bisa membawa:

1. bean tambahan;
2. post processor tambahan;
3. metrics binder tambahan;
4. HTTP client/server customization;
5. data layer initialization;
6. security default chain;
7. actuator endpoints;
8. message listener containers.

Gunakan condition report:

```bash
java -jar app.jar --debug
```

Atau Actuator conditions endpoint jika diekspos secara aman.

### 6.3 Dependency Hygiene

Masalah umum:

```text
menambah starter hanya untuk satu class utility
membawa transitive dependency yang mengaktifkan auto-config
library internal membawa spring-boot-starter-web padahal hanya butuh core
starter platform terlalu gemuk
```

Contoh buruk:

```groovy
dependencies {
    implementation "org.springframework.boot:spring-boot-starter-web"
    implementation "org.springframework.boot:spring-boot-starter-webflux"
    implementation "org.springframework.boot:spring-boot-starter-data-jpa"
    implementation "org.springframework.boot:spring-boot-starter-data-mongodb"
    implementation "org.springframework.boot:spring-boot-starter-amqp"
}
```

Jika aplikasi tidak benar-benar memakai semuanya, context menjadi berat dan failure surface membesar.

### 6.4 Heuristic

```text
Every starter is an architectural statement.
```

Menambah starter berarti menerima:

1. auto-configuration;
2. default behavior;
3. operational responsibility;
4. security surface;
5. test context impact.

---

## 7. Proxy and AOP Overhead

Spring proxy overhead biasanya bukan bottleneck utama. Tetapi proxy chain bisa menjadi signifikan jika:

1. method sangat kecil dipanggil jutaan kali;
2. banyak advice bertumpuk;
3. proxy digunakan di inner loop;
4. pointcut terlalu luas;
5. AOP dipakai untuk logic granular, bukan boundary.

### 7.1 Proxy Chain Contoh

```text
Controller
  -> Service proxy
     -> method security interceptor
     -> transaction interceptor
     -> cache interceptor
     -> metrics interceptor
     -> custom audit interceptor
     -> target method
```

Untuk request HTTP biasa, overhead ini sering kecil dibanding DB/remote call. Tetapi untuk high-throughput in-memory operation, overhead bisa terlihat.

### 7.2 Anti-Pattern: AOP di Inner Loop

```java
@Service
class PriceService {
    @Timed
    public BigDecimal computeOne(Item item) {
        return ...;
    }
}

for (Item item : oneMillionItems) {
    priceService.computeOne(item);
}
```

Jika `computeOne` proxied dan dipanggil sangat sering, overhead proxy + metrics bisa signifikan.

Lebih baik:

```java
@Service
class PriceService {
    @Timed
    public BatchPriceResult computeBatch(List<Item> items) {
        List<BigDecimal> prices = new ArrayList<>(items.size());
        for (Item item : items) {
            prices.add(computeOneInternal(item));
        }
        return new BatchPriceResult(prices);
    }

    private BigDecimal computeOneInternal(Item item) {
        return ...;
    }
}
```

Boundary yang diobservasi adalah batch operation, bukan setiap micro-operation.

### 7.3 Pointcut Cost

Pointcut yang terlalu luas bisa membuat banyak bean diproxy.

Contoh berbahaya:

```java
@Around("execution(* com.company..*(..))")
public Object aroundEverything(ProceedingJoinPoint pjp) throws Throwable {
    return pjp.proceed();
}
```

Lebih baik:

```java
@Around("@within(com.company.platform.audit.AuditedComponent)")
public Object aroundAuditedComponent(ProceedingJoinPoint pjp) throws Throwable {
    return pjp.proceed();
}
```

### 7.4 Heuristic

```text
Use AOP at architectural boundaries, not computational inner loops.
```

---

## 8. Web MVC Performance

Spring MVC performance dipengaruhi oleh:

1. servlet container thread pool;
2. filter chain;
3. security;
4. request body parsing;
5. validation;
6. controller/service/database;
7. response serialization;
8. slow client write.

### 8.1 Thread Pool Is Not Infinite Capacity

Di Tomcat-style MVC, setiap request biasanya memakai satu thread selama request berjalan.

Jika request blocking ke DB/remote API selama 500 ms, thread itu tertahan selama 500 ms.

Virtual threads mengurangi biaya thread blocking, tetapi tidak menghilangkan bottleneck DB/remote/pool.

Spring Boot documentation menyebut bahwa virtual threads dapat diaktifkan dengan `spring.threads.virtual.enabled=true` pada Java 21+, dan pada task execution Boot akan menggunakan virtual-thread-backed `SimpleAsyncTaskExecutor` ketika fitur ini aktif. Referensi: Spring Boot task execution and scheduling.

### 8.2 MVC Request Tuning Checklist

```text
[ ] Endpoint punya latency SLO.
[ ] Payload size dibatasi.
[ ] Request body tidak dibaca berkali-kali.
[ ] Validation tidak melakukan remote/DB call.
[ ] Security tidak melakukan authority lookup mahal per request tanpa cache aman.
[ ] DB query per request diketahui.
[ ] Outbound HTTP punya timeout.
[ ] Response serialization diukur.
[ ] p95/p99 dipantau per endpoint.
```

### 8.3 Controller Thinness and Performance

Controller tebal sulit diukur.

Buruk:

```java
@PostMapping("/applications")
public ResponseEntity<?> submit(@RequestBody SubmitRequest request) {
    validate(request);
    User user = loadUser();
    Application app = map(request);
    repository.save(app);
    external.notify(app);
    audit(app);
    return ResponseEntity.ok(...);
}
```

Lebih baik:

```java
@PostMapping("/applications")
public ResponseEntity<SubmitResponse> submit(@Valid @RequestBody SubmitRequest request) {
    SubmitResult result = submitApplicationUseCase.submit(request.toCommand());
    return ResponseEntity.accepted().body(SubmitResponse.from(result));
}
```

Dengan ini profiling lebih jelas:

```text
controller binding
use case transaction
outbox/event
serialization
```

---

## 9. WebFlux Performance

WebFlux bukan “lebih cepat” secara universal. WebFlux berguna saat:

1. workload I/O-bound;
2. banyak concurrent slow connections;
3. streaming;
4. non-blocking driver tersedia;
5. tim mampu menjaga non-blocking discipline.

WebFlux berbahaya jika:

1. memakai JDBC/JPA blocking di event loop;
2. memanggil `.block()` sembarangan;
3. debugging/context propagation tidak dikuasai;
4. reactive dipakai hanya karena hype.

### 9.1 Event Loop Rule

```text
Never block event loop threads.
```

Contoh buruk:

```java
@GetMapping("/cases/{id}")
Mono<CaseDto> get(@PathVariable String id) {
    return Mono.just(repository.findById(id)) // blocking call
            .map(CaseDto::from);
}
```

Lebih buruk jika berjalan di event loop.

Jika harus memanggil blocking API:

```java
@GetMapping("/cases/{id}")
Mono<CaseDto> get(@PathVariable String id) {
    return Mono.fromCallable(() -> repository.findById(id))
            .subscribeOn(Schedulers.boundedElastic())
            .map(CaseDto::from);
}
```

Tetapi ini hanya bridge. Jika mayoritas aplikasi blocking, MVC + virtual threads sering lebih sederhana.

### 9.2 WebFlux Decision

```text
Use WebFlux when non-blocking is end-to-end meaningful.
Use MVC + virtual threads when blocking code dominates but concurrency need is high.
Use MVC + platform threads when workload moderate and simplicity matters.
```

---

## 10. JSON Serialization and Deserialization Cost

Untuk banyak aplikasi Spring, Jackson serialization adalah hotspot yang sering diremehkan.

Biaya muncul dari:

1. payload besar;
2. object graph dalam;
3. lazy entity accidental serialization;
4. polymorphic serialization;
5. date/time formatting;
6. reflection/introspection;
7. custom serializer mahal;
8. repeated allocation.

### 10.1 Anti-Pattern: Return Entity Directly

```java
@GetMapping("/cases/{id}")
public CaseEntity get(@PathVariable Long id) {
    return repository.findById(id).orElseThrow();
}
```

Risiko:

1. lazy loading saat serialization;
2. circular reference;
3. data leak;
4. response tidak stabil;
5. payload membesar;
6. N+1 tidak terlihat di service layer.

Lebih baik:

```java
@GetMapping("/cases/{id}")
public CaseDetailResponse get(@PathVariable Long id) {
    return useCase.getDetail(id);
}
```

DTO menjadi performance boundary.

### 10.2 Payload Budget

Setiap endpoint sebaiknya punya budget:

```text
max request size
max response size
max collection size
max nesting depth
max export size
streaming threshold
```

Contoh:

```text
List endpoint tidak boleh mengembalikan 10.000 row JSON penuh.
Gunakan pagination, projection, atau export async.
```

### 10.3 Jackson Optimization Heuristic

```text
Optimize DTO shape before optimizing ObjectMapper.
```

Hal yang biasanya lebih berdampak:

1. kurangi field;
2. kurangi nesting;
3. hindari entity serialization;
4. gunakan projection;
5. gunakan streaming untuk payload besar;
6. hindari custom serializer kompleks;
7. cache reference data yang aman.

---

## 11. Database and Connection Pool Performance in Spring

Spring sering disalahkan ketika bottleneck sebenarnya ada di database.

### 11.1 Connection Pool Is a Queue

HikariCP bukan hanya pool. Ia adalah control point.

Jika pool max 20:

```text
maksimal 20 operasi DB concurrent per app instance
request ke-21 menunggu
```

Menaikkan pool bukan selalu solusi.

Jika DB hanya mampu 80 koneksi efektif dan ada 8 pod:

```text
pool per pod = 30
8 pod * 30 = 240 potential connections
```

Ini bisa menghancurkan DB.

### 11.2 Pool Sizing Mental Model

```text
DB concurrency budget dibagi jumlah app instance.
```

Contoh:

```text
DB safe active connections: 120
App pod count: 6
Reserve for admin/batch/other apps: 30
Remaining: 90
Pool per pod: 15
```

Jangan set:

```text
maximumPoolSize=100
```

hanya karena request banyak.

### 11.3 Metrics yang Harus Dipantau

```text
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.timeout
hikaricp.connections.creation
transaction duration
query latency
rows returned
lock wait
DB CPU
DB I/O
```

Spring Boot Actuator menyediakan integrasi metrics melalui Micrometer; dokumentasi Spring Boot menyatakan Actuator menyediakan dependency management dan auto-configuration untuk Micrometer sebagai facade metrics. Referensi: Spring Boot metrics.

### 11.4 Transaction Duration

Transaction panjang memperburuk:

1. lock contention;
2. connection hold time;
3. deadlock probability;
4. undo/redo pressure;
5. user-facing latency;
6. retry blast radius.

Buruk:

```java
@Transactional
public void submit(ApplicationCommand command) {
    Application app = repository.save(command.toEntity());
    externalSystem.send(app);       // remote call inside transaction
    emailClient.send(app);          // side effect inside transaction
    auditRemote.write(app);         // remote call inside transaction
}
```

Lebih baik:

```java
@Transactional
public SubmitResult submit(ApplicationCommand command) {
    Application app = repository.save(command.toEntity());
    outbox.add(ApplicationSubmittedEvent.from(app));
    return SubmitResult.accepted(app.getId());
}
```

Lalu dispatcher mengirim side effect setelah commit.

### 11.5 Repository Abstraction Does Not Remove SQL Cost

Spring Data repository method terlihat murah:

```java
List<Case> findByStatusAndCreatedAtBefore(Status status, Instant cutoff);
```

Tetapi biaya sebenarnya tergantung:

1. index;
2. cardinality;
3. fetch plan;
4. row count;
5. selectivity;
6. join;
7. pagination;
8. lock;
9. transaction isolation.

Performance rule:

```text
Every repository method used in hot path deserves SQL visibility.
```

---

## 12. HTTP Outbound Performance

Outbound HTTP sering menjadi hidden bottleneck.

### 12.1 Timeout Taxonomy

Minimal bedakan:

```text
connect timeout      -> gagal membuat koneksi
connection acquire   -> menunggu koneksi dari pool
read/response timeout -> server lambat memberi response
write timeout        -> lambat mengirim request body
overall timeout      -> seluruh operasi terlalu lama
```

No-timeout adalah bug production.

Buruk:

```java
RestClient client = RestClient.create("https://external.example");
```

Lebih baik: konfigurasi request factory/client dengan timeout eksplisit sesuai client yang dipakai.

### 12.2 Retry Can Destroy Systems

Retry aman hanya jika:

1. operation idempotent;
2. timeout jelas;
3. retry count kecil;
4. backoff ada jitter;
5. retry budget ada;
6. circuit breaker/rate limit ada;
7. error diklasifikasikan.

Buruk:

```text
3 retries per request
100 concurrent requests
external system down
=> 400 total attempts dalam window pendek
```

### 12.3 WebClient Pool Starvation

Pada WebClient/Reactor Netty, bottleneck bisa muncul dari:

1. connection pool max;
2. pending acquire queue;
3. event loop blocking;
4. slow remote;
5. retry storm.

Metric dan log harus menjawab:

```text
apakah lambat karena remote response?
apakah lambat karena menunggu connection pool?
apakah lambat karena event loop blocked?
```

---

## 13. Cache Performance and Correctness

Cache mempercepat read path dengan menukar correctness complexity.

### 13.1 Cache Is Not Free

Cache membawa biaya:

1. key generation;
2. serialization/deserialization;
3. network round trip ke Redis;
4. memory pressure;
5. invalidation;
6. stale data;
7. stampede;
8. tenant/security leak risk.

### 13.2 Cache Local vs Distributed

| Cache | Kuat | Lemah |
|---|---|---|
| Local Caffeine | sangat cepat, murah | per-instance, stale antar pod |
| Redis | shared, TTL terpusat | network latency, serialization, ops dependency |
| DB materialized view | query cepat, durable | refresh complexity |
| CDN/API gateway cache | offload besar | hanya cocok data public/cacheable |

### 13.3 Cache Stampede

Tanpa proteksi:

```text
popular key expired
1000 requests masuk
1000 requests hit DB
DB spike
```

Mitigasi:

1. sync cache loading;
2. per-key lock;
3. stale-while-revalidate;
4. TTL jitter;
5. request coalescing;
6. pre-warm for reference data.

### 13.4 Cache Key Discipline

Cache key harus mencakup semua dimensi correctness.

Contoh berbahaya:

```java
@Cacheable("case-detail")
public CaseDetail getCase(Long caseId) { ... }
```

Jika response tergantung user/tenant/role, key salah.

Lebih aman:

```java
@Cacheable(
    cacheNames = "case-detail",
    key = "T(java.lang.String).format('%s:%s:%s', #tenantId, #viewerRole, #caseId)"
)
public CaseDetail getCase(String tenantId, String viewerRole, Long caseId) { ... }
```

Tetapi key yang terlalu spesifik bisa menurunkan hit rate. Ini trade-off, bukan aturan tunggal.

---

## 14. Observability Overhead

Observability membantu performance, tetapi juga bisa merusaknya jika salah.

### 14.1 Metrics Cardinality

High-cardinality tag adalah salah satu penyebab umum metrics backend mahal/lambat.

Buruk:

```java
registry.counter("http.client.calls",
    "userId", userId,
    "caseId", caseId,
    "url", fullUrl
).increment();
```

Lebih baik:

```java
registry.counter("http.client.calls",
    "client", "payment-gateway",
    "operation", "create-payment",
    "outcome", outcome
).increment();
```

### 14.2 Logs in Hot Path

Buruk:

```java
log.info("Processing item {} payload {}", itemId, hugePayload);
```

Lebih baik:

```java
log.debug("Processing item {}", itemId);
```

Untuk batch besar:

```text
log progress per N records, not per record
```

### 14.3 Tracing Cost

Distributed tracing bernilai tinggi, tetapi span terlalu banyak akan mahal.

Prinsip:

```text
Trace boundaries, not every helper method.
```

Trace:

1. HTTP server;
2. HTTP client;
3. DB query group;
4. message publish/consume;
5. batch step;
6. external system call.

Jangan trace:

1. every mapper call;
2. every getter;
3. every validation field;
4. every loop item kecuali sampling khusus.

---

## 15. Async and Executor Performance

`@Async` tidak membuat pekerjaan lebih murah. Ia memindahkan pekerjaan ke executor.

### 15.1 Executor Has Capacity

Thread pool punya:

```text
core size
max size
queue capacity
rejection policy
thread name
context propagation
shutdown policy
```

Unbounded queue adalah risiko.

```java
@Bean
ThreadPoolTaskExecutor applicationExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(16);
    executor.setMaxPoolSize(32);
    executor.setQueueCapacity(1000);
    executor.setThreadNamePrefix("app-async-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    return executor;
}
```

`CallerRunsPolicy` bukan selalu benar, tetapi lebih eksplisit daripada queue tumbuh tanpa batas.

### 15.2 Async Anti-Pattern

```java
@Async
public void generateReport(Long reportId) {
    // heavy job 30 minutes
}
```

Masalah:

1. state hilang jika pod restart;
2. tidak ada retry/recovery durable;
3. tidak ada progress;
4. tidak ada ownership;
5. tidak aman untuk long-running business workflow.

Lebih baik:

```text
command table / job table / Spring Batch / message queue
```

### 15.3 Executor Metrics

Pantau:

```text
active threads
pool size
queue size
completed tasks
rejected tasks
task duration
oldest queued task age
```

---

## 16. Virtual Threads Performance Model

Virtual threads mengubah biaya thread, bukan biaya semua hal.

### 16.1 Apa yang Menjadi Lebih Baik?

1. blocking I/O lebih scalable dari sisi thread;
2. imperative code tetap sederhana;
3. stack trace lebih natural dibanding reactive chain;
4. request-per-thread model bisa menangani concurrency lebih tinggi.

### 16.2 Apa yang Tidak Berubah?

1. DB connection pool tetap terbatas;
2. remote API tetap lambat;
3. CPU tetap terbatas;
4. lock contention tetap ada;
5. transaction tetap menahan connection;
6. memory allocation tetap nyata;
7. backpressure tetap perlu;
8. downstream tetap bisa overload.

Oracle mendeskripsikan virtual threads sebagai lightweight threads yang membantu menulis, merawat, dan men-debug aplikasi concurrent high-throughput. Namun virtual threads bukan pengganti capacity planning. Referensi: Oracle Java virtual threads documentation.

### 16.3 Dangerous Pattern

```text
virtual threads enabled
10.000 concurrent requests
DB pool 30
semua request blocking menunggu DB
latency naik karena queue invisible di application layer
```

Virtual threads bisa membuat bottleneck berpindah dari thread pool ke DB pool/downstream.

### 16.4 Guideline

```text
Use virtual threads to reduce thread scarcity.
Still use limits to protect scarce downstream resources.
```

---

## 17. Native Image Performance Model

Native image sering menang di:

1. startup time;
2. memory footprint awal;
3. cold-start deployment;
4. scale-to-zero;
5. small container footprint.

Native image belum tentu menang di:

1. peak throughput;
2. long-running JIT-optimized workload;
3. dynamic plugin system;
4. heavy reflection application;
5. large enterprise app with unsupported libraries.

### 17.1 Kapan Native Image Masuk Akal?

```text
[ ] startup/cold start adalah bottleneck nyata
[ ] memory footprint mahal
[ ] app cukup statis
[ ] dependency native-compatible
[ ] team siap maintain runtime hints
[ ] CI bisa build native secara reliable
```

### 17.2 Kapan JVM Lebih Rasional?

```text
[ ] app long-running
[ ] throughput puncak lebih penting dari cold start
[ ] banyak dynamic reflection/plugin
[ ] library belum native-friendly
[ ] troubleshooting native masih mahal untuk team
```

---

## 18. Memory Footprint in Spring Applications

Memory footprint Spring dipengaruhi oleh:

1. bean graph;
2. class metadata;
3. proxy class;
4. caches internal;
5. Jackson object graph;
6. Hibernate persistence context;
7. HTTP buffers;
8. Netty buffers;
9. thread stack/platform threads;
10. metrics cardinality;
11. local cache;
12. batch chunk size.

### 18.1 Common Memory Problems

#### Problem 1 — Persistence Context Terlalu Besar

Dalam transaction panjang:

```java
@Transactional
public void processAll() {
    List<Entity> entities = repository.findAll();
    for (Entity entity : entities) {
        entity.update();
    }
}
```

Risiko:

1. semua entity berada di memory;
2. dirty checking mahal;
3. flush besar;
4. transaction panjang.

Lebih baik:

```text
pagination/chunking
clear persistence context per chunk
Spring Batch untuk workload besar
```

#### Problem 2 — Local Cache Tanpa Limit

```java
private final Map<String, Object> cache = new ConcurrentHashMap<>();
```

Jika tidak ada size limit/TTL, ini memory leak.

Lebih baik gunakan cache dengan eviction policy.

#### Problem 3 — Metrics Tag Explosion

Setiap kombinasi tag bisa membuat time series baru. Ini memory/CPU/backend cost.

---

## 19. Transaction Performance

Transaction overhead Spring sendiri biasanya kecil. Yang mahal adalah efek dari transaction boundary yang salah.

### 19.1 Long Transaction Symptoms

```text
DB pool active tinggi
lock wait naik
p99 latency naik
deadlock meningkat
undo/redo pressure naik
external call lambat memperpanjang transaction
```

### 19.2 Transaction Scope Rule

```text
Keep transaction around durable state mutation, not around orchestration latency.
```

Buruk:

```java
@Transactional
public void approve(Long caseId) {
    Case c = caseRepository.get(caseId);
    c.approve();
    documentClient.generate(c);     // slow remote
    emailClient.notify(c);          // slow remote
    auditClient.write(c);           // slow remote
}
```

Lebih baik:

```java
@Transactional
public void approve(Long caseId) {
    Case c = caseRepository.get(caseId);
    c.approve();
    outbox.publish(CaseApproved.of(c));
}
```

### 19.3 Read-Only Transaction

`readOnly=true` bukan magic speed button. Ia adalah hint dan semantic declaration. Efeknya tergantung transaction manager/provider/database.

Gunakan karena:

1. menyatakan intent;
2. mencegah accidental write pada beberapa setup;
3. membantu provider tertentu mengoptimalkan.

Jangan anggap selalu mempercepat signifikan.

---

## 20. Security Performance

Spring Security overhead normal biasanya kecil dibanding I/O. Tetapi security bisa menjadi bottleneck jika:

1. token introspection remote per request;
2. JWKS fetch tidak dicache dengan benar;
3. authority mapping query DB per request;
4. method security dipakai granular di inner loop;
5. authorization expression mahal;
6. session store remote lambat;
7. filter chain terlalu banyak untuk endpoint publik/static.

### 20.1 JWT Resource Server

JWT validation lokal biasanya lebih murah daripada remote introspection.

Tetapi perhatikan:

1. key rotation;
2. JWKS caching;
3. clock skew;
4. claim mapping;
5. token size;
6. authority explosion.

### 20.2 Method Security

Buruk:

```java
@PreAuthorize("@authz.canViewItem(#item)")
public ItemDto mapItem(Item item) { ... }
```

lalu dipanggil ribuan kali.

Lebih baik:

```text
authorize collection/query boundary
filter data at query/service boundary
avoid per-item remote authorization
```

### 20.3 Security Caching Warning

Caching authorization decision berbahaya jika key tidak lengkap.

Key minimal biasanya mencakup:

```text
subject
tenant
resource type
resource id
permission
authority version/policy version
```

---

## 21. Batch Performance

Spring Batch performance dipengaruhi oleh:

1. chunk size;
2. reader paging/fetch size;
3. writer batch size;
4. transaction per chunk;
5. skip/retry cost;
6. persistence context management;
7. partition count;
8. DB lock/index;
9. I/O throughput;
10. metadata table contention.

### 21.1 Chunk Size Trade-Off

| Chunk Size | Kuat | Lemah |
|---|---|---|
| kecil | cepat recover, memory rendah | overhead transaction tinggi |
| besar | throughput tinggi | rollback mahal, memory tinggi |

Tidak ada angka universal. Ukur.

### 21.2 Batch Anti-Pattern

```text
read all rows into memory
process in one transaction
write one row at a time
log every row
no restart key
no idempotency
```

### 21.3 Batch Metrics

```text
items read/sec
items processed/sec
items written/sec
skip count
retry count
chunk duration
step duration
commit duration
rollback count
oldest unprocessed record age
```

---

## 22. Messaging Performance

Messaging performance bukan hanya consumer concurrency.

Dipengaruhi oleh:

1. broker throughput;
2. partition/queue count;
3. listener concurrency;
4. processing time;
5. ack/commit strategy;
6. retry/DLQ;
7. idempotency store;
8. DB transaction;
9. external call;
10. message size.

### 22.1 Consumer Throughput Formula Sederhana

```text
throughput ≈ concurrency / average_processing_time
```

Jika average processing 200 ms dan concurrency 10:

```text
10 / 0.2s = 50 msg/sec
```

Tetapi DB/remote system bisa menurunkan angka ini.

### 22.2 Retry Storm

Jika consumer retry cepat pada downstream outage:

```text
message gagal
retry immediate
consumer sibuk retry message yang sama
lag naik
DLQ penuh
downstream makin tertekan
```

Gunakan:

1. backoff;
2. max attempts;
3. DLQ/DLT;
4. circuit breaker;
5. delayed retry topic/queue;
6. poison message classification.

---

## 23. Profiling Spring Applications

### 23.1 What to Use

| Tool | Cocok Untuk |
|---|---|
| Micrometer metrics | trend production, SLO, saturation |
| Actuator endpoints | runtime inspection |
| JFR | CPU, allocation, lock, thread, I/O, GC |
| async-profiler | CPU/flamegraph/allocation profiling |
| database AWR/EXPLAIN | query/database bottleneck |
| load test | capacity and regression |
| logs/traces | request-level causality |

Spring Boot Actuator metrics endpoint membantu melihat metrics yang terekam, tetapi dokumentasi Spring Boot REST API untuk endpoint metrics menegaskan endpoint tersebut bukan backend metrics production; gunakan backend metrics seperti Prometheus/OTLP untuk scraping/penyimpanan production. Referensi: Spring Boot metrics endpoint API.

### 23.2 Profiling Workflow

```text
1. Observe p95/p99 latency problem.
2. Check saturation: CPU, DB pool, executor, remote calls.
3. Check traces: where time is spent.
4. Check JFR/flamegraph: CPU/allocation hotspots.
5. Check DB: slow SQL, lock, wait event.
6. Form hypothesis.
7. Optimize one boundary.
8. Re-run comparable load.
```

### 23.3 Avoid Profiling Trap

Profiling local dev single request sering menyesatkan.

Yang dibutuhkan:

```text
production-like dataset
production-like concurrency
production-like payload
production-like network latency
production-like DB indexes/stats
production-like config
```

---

## 24. Load Testing Spring Applications

Load test harus menjawab pertanyaan capacity, bukan hanya “bisa 1000 user?”

### 24.1 Workload Model

Definisikan mix:

```text
70% read list
15% read detail
10% create/update
3% export
2% login/token refresh
```

Tanpa mix, load test tidak bermakna.

### 24.2 Metrics Selama Load Test

Pantau bersamaan:

```text
HTTP RPS
HTTP p50/p95/p99
error rate
CPU
heap/GC
DB pool active/pending
DB CPU/query latency
executor active/queue
HTTP client latency
cache hit ratio
message lag
log volume
trace sample
```

### 24.3 Find Knee Point

Knee point adalah titik ketika sedikit penambahan traffic menyebabkan latency naik tajam.

```text
100 RPS -> p95 120 ms
150 RPS -> p95 180 ms
180 RPS -> p95 300 ms
200 RPS -> p95 1500 ms
```

Capacity aman mungkin 150–170 RPS, bukan 200 RPS.

---

## 25. Performance Regression Guard

Performance harus dijaga seperti correctness.

### 25.1 What to Guard

```text
startup time
bean count
context load time
critical endpoint latency
query count per request
serialization payload size
allocation rate
DB pool pending count
cache hit ratio
batch throughput
message processing latency
```

### 25.2 CI Guard Examples

#### Guard 1 — Context startup budget

```java
@Test
void applicationContextStartsWithinBudget() {
    long start = System.nanoTime();
    try (ConfigurableApplicationContext context = SpringApplication.run(App.class)) {
        long elapsedMs = Duration.ofNanos(System.nanoTime() - start).toMillis();
        assertThat(elapsedMs).isLessThan(8_000);
    }
}
```

Ini bukan benchmark presisi, tetapi guard kasar. Jangan terlalu flaky.

#### Guard 2 — Bean count trend

```java
@Test
void beanCountDoesNotExplode() {
    try (ConfigurableApplicationContext context = SpringApplication.run(App.class)) {
        assertThat(context.getBeanDefinitionCount()).isLessThan(900);
    }
}
```

Gunakan sebagai alarm perubahan besar, bukan angka sakral.

#### Guard 3 — Query count in integration test

Dengan instrumentation datasource, pastikan endpoint tertentu tidak tiba-tiba N+1.

```text
GET /cases/{id} should not execute > 5 SQL statements
```

### 25.3 Production Regression Guard

```text
alert when p95 increases 50% week-over-week
alert when DB pool pending > 0 for 5 min
alert when cache hit ratio drops suddenly
alert when startup time exceeds deployment timeout budget
alert when message lag age exceeds SLA
```

---

## 26. Spring Performance Anti-Patterns

### 26.1 Magic Annotation Performance

```text
Adding @Async without executor design.
Adding @Cacheable without invalidation model.
Adding @Transactional around orchestration.
Adding @Retryable without idempotency.
Adding WebFlux while using blocking repository.
Adding virtual threads without downstream limits.
```

### 26.2 Repository Abuse

```text
repository method per field lookup
findAll then filter in memory
unbounded pageable
entity graph accidental explosion
N+1 hidden by DTO mapper
```

### 26.3 Config Abuse

```text
max pool size copied from blog
thread pool copied from another service
timeouts all set to 60s
retry count 5 everywhere
same cache TTL for all data
```

### 26.4 Observability Abuse

```text
userId/caseId/orderId as metric tags
log full payload per request
span per helper method
debug logging in hot path
actuator exposed without security
```

### 26.5 Test Abuse

```text
all tests use @SpringBootTest
no load test before major release
no production-like data
performance tested only after incident
```

---

## 27. Decision Matrix

### 27.1 MVC vs WebFlux vs Virtual Threads

| Situation | Better Default |
|---|---|
| Blocking JDBC/JPA app, normal traffic | MVC platform threads |
| Blocking JDBC/JPA app, high concurrency, Java 21+ | MVC + virtual threads, with DB limits |
| Non-blocking end-to-end, many slow I/O streams | WebFlux |
| Server-Sent Events/streaming | WebFlux or MVC streaming depending need |
| CPU-bound workload | Neither solves it; optimize CPU/parallelism |
| Team unfamiliar with reactive | Avoid WebFlux unless justified |
| Need lowest cold start | Consider AOT/native image |

### 27.2 Cache vs Query Optimization

| Symptom | First Investigate |
|---|---|
| slow query with bad index | query/index first |
| repeated reference data reads | cache likely useful |
| user-specific dynamic data | be careful with cache |
| list endpoint huge payload | pagination/projection first |
| DB CPU saturated by hot lookup | cache + index + capacity |

### 27.3 Increase Pool vs Reduce Work

| Symptom | Likely Action |
|---|---|
| pool pending, DB CPU low | pool may be too small or transactions too long |
| pool pending, DB CPU high | adding pool worsens DB |
| active connections high, transaction slow | shorten transaction/query |
| many idle connections | pool too large |
| connection timeout during spike | add backpressure/rate limit, not only pool |

---

## 28. Production Performance Review Checklist

Gunakan checklist ini saat review aplikasi Spring production.

### 28.1 Startup

```text
[ ] Startup time measured.
[ ] Bean count known.
[ ] Auto-config report reviewed.
[ ] No remote calls in constructors.
[ ] No unbounded package scanning.
[ ] Readiness only UP when truly ready.
```

### 28.2 HTTP

```text
[ ] Endpoint SLO defined.
[ ] p95/p99 per endpoint monitored.
[ ] Request/response size limited.
[ ] Timeout configured for inbound/outbound.
[ ] Error rate monitored.
[ ] Slow endpoint trace available.
```

### 28.3 Database

```text
[ ] Hikari active/pending/timeout monitored.
[ ] Pool size justified by DB capacity.
[ ] Slow query visibility exists.
[ ] Transaction duration monitored.
[ ] No remote call inside critical transaction.
[ ] N+1 detection exists for hot paths.
```

### 28.4 Cache

```text
[ ] Cache key includes tenant/security dimensions when needed.
[ ] TTL/eviction defined.
[ ] Hit ratio monitored.
[ ] Stampede mitigation exists for hot keys.
[ ] Invalidation semantics documented.
```

### 28.5 Async/Scheduler/Messaging

```text
[ ] Executor queue bounded.
[ ] Rejection policy explicit.
[ ] Queue size and task duration monitored.
[ ] Scheduled jobs safe in multi-replica deployment.
[ ] Message retry/DLQ configured.
[ ] Consumer idempotency exists.
```

### 28.6 Observability

```text
[ ] Metrics have bounded cardinality.
[ ] Logs do not leak PII/secrets.
[ ] Trace sampling configured.
[ ] Actuator endpoints secured.
[ ] SLO dashboards exist.
```

### 28.7 Regression

```text
[ ] Startup regression guard.
[ ] Critical endpoint performance test.
[ ] Query count guard for hot endpoint.
[ ] Load test before major release.
[ ] Performance baseline stored.
```

---

## 29. Worked Example: Diagnosing Slow Spring Endpoint

Kasus:

```text
GET /cases/search p95 naik dari 300 ms ke 2.5 s setelah release.
CPU app normal.
DB CPU naik.
Hikari pending kadang > 0.
```

### Step 1 — Jangan Langsung Tune Thread

Jangan langsung:

```text
naikkan Tomcat threads
naikkan Hikari pool
aktifkan virtual threads
```

Karena DB sudah naik.

### Step 2 — Cek Trace

Trace menunjukkan:

```text
controller: 20 ms
service: 2300 ms
repository: 2200 ms
serialization: 120 ms
```

### Step 3 — Cek SQL Count

Sebelum release:

```text
1 search query
```

Setelah release:

```text
1 search query + 100 detail queries
```

N+1 muncul dari mapper DTO.

### Step 4 — Root Cause

Developer menambahkan field:

```java
response.setAssignedOfficerName(caseEntity.getAssignedOfficer().getName());
```

`assignedOfficer` lazy loaded per row.

### Step 5 — Fix

Pilihan:

1. projection query;
2. join fetch untuk use case tertentu;
3. batch fetch;
4. denormalized read model;
5. limit field hanya di detail endpoint.

Untuk list endpoint, projection paling masuk akal:

```java
interface CaseSearchRow {
    Long getId();
    String getReferenceNo();
    String getStatus();
    String getAssignedOfficerName();
}
```

### Step 6 — Guard

Tambahkan integration test:

```text
/cases/search with 50 rows must execute <= 2 SQL statements
```

Tambahkan dashboard:

```text
search endpoint p95
SQL statements per request sample
Hikari pending
DB CPU
```

Pelajaran:

```text
Bottleneck bukan Spring MVC.
Bottleneck bukan thread.
Bottleneck adalah abstraction leak antara DTO mapper dan lazy loading.
```

---

## 30. Worked Example: Virtual Threads Do Not Fix DB Saturation

Kasus:

```text
Aplikasi MVC Java 21.
Sebelum virtual threads:
  max Tomcat threads = 200
  Hikari max pool = 30
  p95 under load = 900 ms

Setelah virtual threads:
  concurrent requests naik
  p95 = 3000 ms
  DB pool pending naik
```

### Analisis

Virtual threads membuat lebih banyak request bisa masuk dan menunggu. Tetapi DB tetap hanya 30 koneksi.

Sebelumnya Tomcat thread pool secara tidak sengaja menjadi throttle.

Setelah virtual threads, throttle hilang dan DB pool menjadi bottleneck utama.

### Solusi

Bukan sekadar matikan virtual threads.

Desain ulang limit:

```text
[ ] endpoint-level concurrency limit untuk DB-heavy endpoints
[ ] bulkhead per downstream/DB operation
[ ] query optimization
[ ] shorter transaction
[ ] pool sizing berdasarkan DB budget
[ ] backpressure dengan 429/503 jika saturated
```

Prinsip:

```text
Virtual threads remove one queue.
You still need explicit queues and limits at scarce resources.
```

---

## 31. Worked Example: Startup Lambat Setelah Menambah Starter

Kasus:

```text
Startup naik dari 12s ke 38s.
Perubahan: menambah internal-platform-starter.
```

### Investigation

1. Enable startup endpoint/ApplicationStartup.
2. Compare bean count.
3. Compare auto-config conditions.
4. Check runner/init methods.

Ditemukan:

```text
starter membawa spring-boot-starter-data-redis
starter auto-config membuat Redis client
@PostConstruct melakukan ping Redis
Redis dev network lambat
```

### Fix

Starter harus back off:

```java
@AutoConfiguration
@ConditionalOnClass(RedisConnectionFactory.class)
@ConditionalOnProperty(prefix = "company.redis", name = "enabled", havingValue = "true")
class CompanyRedisAutoConfiguration {
    ...
}
```

Dan tidak melakukan remote ping di `@PostConstruct` kecuali memang fail-fast requirement.

### Guard

```text
internal starter must not activate expensive infrastructure by classpath alone
all remote initialization must be conditional and documented
startup time diff checked in CI for platform starter
```

---

## 32. Top 1% Heuristics for Spring Performance

### 32.1 Think in Queues

Setiap sistem punya queue:

```text
load balancer queue
Tomcat/platform/virtual thread scheduling
DB pool wait
HTTP client pool wait
executor queue
broker lag
cache wait
lock wait
```

Performance incident adalah queue yang tumbuh lebih cepat daripada drain rate.

### 32.2 Think in Budgets

Setiap boundary harus punya budget:

```text
latency budget
connection budget
thread budget
memory budget
payload budget
retry budget
cardinality budget
startup budget
```

### 32.3 Think in Ownership

Setiap optimisasi harus punya owner:

```text
Who owns DB pool sizing?
Who owns cache invalidation?
Who owns endpoint SLO?
Who owns retry policy?
Who owns starter auto-config behavior?
```

### 32.4 Think in Failure Modes

Optimisasi yang baik tidak hanya membuat happy path cepat, tetapi membuat overload lebih aman.

```text
timeout
bulkhead
rate limit
queue bound
circuit breaker
DLQ
backpressure
fallback
readiness state
```

### 32.5 Prefer Shape Optimization Before Micro-Optimization

Biasanya lebih berdampak:

```text
change endpoint shape
reduce payload
fix query
remove N+1
shorten transaction
remove remote call from transaction
add idempotency
bound executor
fix cache key
```

daripada:

```text
tweak reflection
avoid one proxy
replace framework randomly
micro-optimize mapper
```

---

## 33. Mini Reference Architecture for Performant Spring Service

```text
HTTP API
  -> SecurityFilterChain
  -> Controller DTO boundary
  -> UseCase service
     -> transaction around state mutation only
     -> repository projection/query optimized
     -> outbox for side effects
  -> HTTP response DTO

Background
  -> bounded executor / batch / queue consumer
  -> idempotent processing
  -> retry with backoff
  -> DLQ/recovery

Integration
  -> RestClient/WebClient with timeout
  -> connection pool
  -> retry only idempotent operations
  -> circuit breaker/bulkhead

Observability
  -> endpoint metrics
  -> DB pool metrics
  -> HTTP client metrics
  -> executor metrics
  -> cache metrics
  -> bounded tags
  -> traces at boundaries

Operations
  -> startup budget
  -> readiness/liveness
  -> performance regression guard
  -> load test profile
```

---

## 34. Latihan Praktis

### Latihan 1 — Audit Startup

Ambil satu aplikasi Spring Boot dan catat:

```text
startup time
bean count
auto-config active list
slowest startup steps
remote calls during startup
```

Output:

```text
startup bottleneck report
candidate improvements
risk of each improvement
```

### Latihan 2 — Endpoint Performance Budget

Pilih satu endpoint hot path.

Buat budget:

```text
total p95 budget: 300 ms
security: 20 ms
binding/validation: 20 ms
service logic: 40 ms
DB: 150 ms
serialization: 30 ms
buffer/network: 40 ms
```

Bandingkan dengan trace aktual.

### Latihan 3 — DB Pool Capacity

Hitung:

```text
DB safe connection count
jumlah pod
pool per pod
average transaction duration
expected concurrent DB operations
```

Tentukan apakah pool sekarang masuk akal.

### Latihan 4 — Cache Key Review

Ambil semua `@Cacheable`.

Untuk masing-masing:

```text
apakah response tenant-specific?
apakah user-specific?
apakah role-specific?
apakah data mutable?
apakah invalidation jelas?
apakah TTL jelas?
apakah hit ratio dimonitor?
```

### Latihan 5 — Virtual Thread Readiness

Untuk aplikasi Java 21+:

```text
aktifkan virtual threads di staging
ukur p95/p99
ukur DB pool pending
ukur downstream latency
ukur CPU
ukur memory
ukur lock contention/pinning signal
```

Kesimpulan harus berbasis measurement.

---

## 35. Ringkasan

Performance engineering untuk Spring adalah kemampuan membaca aplikasi sebagai sistem runtime yang memiliki banyak boundary dan queue.

Hal paling penting:

1. jangan tuning tanpa measurement;
2. bedakan latency, throughput, saturation, dan capacity;
3. audit startup, bean count, dan auto-configuration;
4. pahami proxy/AOP overhead, tetapi jangan membesar-besarkannya;
5. optimalkan request shape, query, payload, transaction, dan outbound timeout lebih dulu;
6. virtual threads mengurangi thread scarcity, bukan downstream scarcity;
7. WebFlux hanya bernilai jika non-blocking discipline dijaga;
8. native image terutama untuk startup/memory/cold-start, bukan jaminan throughput;
9. cache mempercepat read path dengan biaya correctness;
10. observability harus bounded, terutama tag cardinality;
11. executor, DB pool, HTTP pool, dan broker consumer adalah queue yang harus dibatasi;
12. performance harus punya regression guard.

Engineer Spring tingkat tinggi tidak hanya bisa membuat aplikasi cepat. Ia bisa menjelaskan:

```text
cepat di workload mana,
sampai kapasitas berapa,
dengan bottleneck apa,
dengan failure mode apa,
dengan metric apa,
dan dengan guardrail apa supaya tidak memburuk lagi.
```

---

## 36. Referensi Resmi dan Bacaan Lanjutan

1. Spring Boot Reference — Actuator Production-ready Features  
   `https://docs.spring.io/spring-boot/reference/actuator/index.html`
2. Spring Boot Reference — Metrics  
   `https://docs.spring.io/spring-boot/reference/actuator/metrics.html`
3. Spring Boot Reference — Task Execution and Scheduling  
   `https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html`
4. Spring Boot Reference — SpringApplication and Virtual Threads  
   `https://docs.spring.io/spring-boot/reference/features/spring-application.html`
5. Spring Boot Actuator REST API — Metrics Endpoint  
   `https://docs.spring.io/spring-boot/api/rest/actuator/metrics.html`
6. Micrometer Documentation  
   `https://micrometer.io/docs/`
7. Oracle Java Documentation — Virtual Threads  
   `https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html`
8. Spring Framework Reference — Web MVC  
   `https://docs.spring.io/spring-framework/reference/web/webmvc.html`
9. Spring Framework Reference — WebFlux  
   `https://docs.spring.io/spring-framework/reference/web/webflux.html`
10. Spring Boot Reference — Native Image  
   `https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html`

---

## 37. Status Seri

```text
Part saat ini : 30 dari 35
Status        : belum selesai
Berikutnya    : 31-spring-cloud-distributed-system-integration.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./29-native-image-aot-runtime-hints.md">⬅️ Native Image, AOT, Reflection, and Runtime Hints</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./31-spring-cloud-distributed-system-integration.md">Part 31 — Spring Cloud and Distributed System Integration ➡️</a>
</div>
