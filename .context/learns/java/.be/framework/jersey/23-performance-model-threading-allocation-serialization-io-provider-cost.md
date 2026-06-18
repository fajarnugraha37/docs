# Part 23 — Performance Model: Threading, Allocation, Serialization, IO, and Provider Cost

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Part: `23 / 32`  
Topic: Jersey performance model from runtime lifecycle to production profiling  
Java range: Java 8 sampai Java 25  
Jersey range: Jersey 2.x, 3.x, 4.x  
Primary focus: server-side Jersey, with outbound/client-side impact where relevant

---

## 0. Tujuan Bagian Ini

Pada part sebelumnya kita sudah membahas observability: log, metric, trace, correlation, dan profiling. Bagian ini melanjutkan dari sana, tetapi fokusnya bukan lagi "bagaimana melihat sistem", melainkan:

> Bagaimana memahami biaya kerja Jersey sehingga kita bisa menganalisis, mengukur, dan memperbaiki performa secara benar.

Target setelah bagian ini:

1. Bisa menjelaskan jalur request Jersey dari network sampai response sebagai rangkaian biaya.
2. Bisa membedakan bottleneck CPU, IO, thread pool, serialization, database, remote call, memory allocation, dan GC.
3. Bisa menghindari tuning palsu seperti "tambah thread", "tambah pod", atau "ganti GC" tanpa bukti.
4. Bisa merancang endpoint Jersey yang hemat allocation, stabil di latency tail, dan mudah diprofiling.
5. Bisa membuat checklist performa untuk Jersey app Java 8 sampai Java 25.

Bagian ini tidak mengulang dasar JAX-RS, HTTP, logging, atau Java concurrency. Fokusnya adalah mental model performa Jersey sebagai runtime.

---

## 1. Core Mental Model: Request Performance Is a Pipeline, Not One Number

Ketika sebuah endpoint Jersey lambat, biasanya orang melihat satu angka:

```text
GET /cases/123 took 2.8s
```

Angka itu tidak cukup. Angka tersebut adalah total dari banyak tahap:

```text
client/network
  -> load balancer / gateway
  -> servlet container accept queue
  -> container thread dispatch
  -> Jersey application matching
  -> filters
  -> parameter binding
  -> request entity read / deserialize
  -> resource method execution
  -> service/domain logic
  -> database / remote calls / cache
  -> response mapping
  -> exception mapper if failed
  -> response filters
  -> message body writer / serialize
  -> network write
```

Performance engineering berarti memecah angka total menjadi bagian-bagian yang bisa dijelaskan.

Kalau tidak dipecah, diagnosis akan mudah salah:

```text
Symptom:
  Endpoint latency naik dari 200ms ke 3s.

Diagnosis dangkal:
  Jersey lambat.

Diagnosis yang mungkin benar:
  - database query berubah dari index range scan menjadi full scan
  - JSON response membesar 30x
  - client tidak menutup Response sehingga pool outbound habis
  - gzip aktif untuk payload kecil dan CPU naik
  - request body dibuffer ulang oleh filter logging
  - thread pool container penuh karena remote dependency lambat
  - GC pause meningkat karena DTO graph terlalu besar
  - lazy JPA proxy terserialisasi dan memicu N+1 query
  - reverse proxy buffering streaming response
```

Jersey hanya satu layer dalam pipeline. Tugas top engineer adalah tahu di layer mana biaya muncul.

---

## 2. Jersey Performance Boundary

Jersey bertanggung jawab besar pada beberapa area:

```text
Jersey-owned or Jersey-heavy cost:
  - application/resource matching
  - provider lookup
  - filters and interceptors
  - parameter conversion
  - entity reader/writer selection
  - request/response context management
  - exception mapping
  - server-side async abstraction
  - Jersey client invocation pipeline
  - monitoring/tracing extension overhead

Not purely Jersey-owned:
  - TCP accept
  - TLS handshake
  - servlet connector thread scheduling
  - database latency
  - remote HTTP latency
  - JSON library internals
  - GC algorithm
  - kernel/network buffering
  - container/image CPU throttling
  - Kubernetes scheduling
```

Ini penting agar tuning diarahkan ke tempat yang benar.

Contoh:

```text
Case:
  CPU rendah, latency tinggi, thread busy tinggi.

Kemungkinan:
  Blocking IO menahan thread.

Bukan solusi utama:
  Optimize provider lookup.

Solusi yang lebih masuk akal:
  - pasang timeout outbound
  - bulkhead remote dependency
  - batasi concurrency
  - pisahkan executor
  - ukur wait time database/HTTP
```

Contoh lain:

```text
Case:
  CPU tinggi, request/sec turun, DB normal, remote normal.

Kemungkinan:
  Serialization/deserialization, validation, compression, logging body, atau object mapping.

Bukan solusi utama:
  Tambah timeout.

Solusi yang lebih masuk akal:
  - profile CPU
  - ukur payload size
  - cek Jackson hotspots
  - cek DTO graph
  - cek accidental reflection-heavy mapping
  - cek gzip ratio vs CPU
```

---

## 3. Latency, Throughput, Saturation, and Tail

Jersey endpoint performa tidak boleh hanya diukur rata-rata.

Minimal ukur:

```text
latency:
  p50, p90, p95, p99, max

throughput:
  requests per second

saturation:
  active threads
  queued requests
  DB connections in use
  outbound HTTP connections in use
  CPU usage
  heap allocation rate
  GC pause
  network egress

error:
  4xx, 5xx, timeout, rejected, circuit-open
```

Kenapa p99 penting?

Karena sistem production gagal bukan hanya saat rata-rata lambat, tapi saat tail latency membuat dependency chain runtuh.

Misalnya:

```text
API A -> API B -> DB

API B p50 = 80ms
API B p99 = 4s

API A timeout = 5s
Thread pool API A = 200
Traffic spike = 100 rps

Saat p99 API B naik, thread API A tertahan.
Thread pool penuh.
Queue naik.
Latency API A naik.
Client retry.
Traffic makin tinggi.
System enters retry storm.
```

Jersey tidak mencegah ini sendiri. Jersey hanya menjalankan request. Arsitektur resilience harus mengontrol concurrency, timeout, retry, dan back-pressure.

---

## 4. Anatomy of a Jersey Server Request

Mari pecah lifecycle menjadi biaya performa.

### 4.1 Network and Container Entry

Sebelum Jersey melihat request, request sudah melewati:

```text
client
  -> DNS
  -> TCP
  -> TLS
  -> load balancer
  -> reverse proxy / API gateway
  -> servlet container connector
  -> container thread
```

Di servlet deployment, Jersey biasanya berjalan sebagai servlet/filter integration. Container seperti Tomcat, Jetty, Undertow, Grizzly, Payara, GlassFish, WebLogic, atau Spring Boot embedded server mengatur thread dan IO dasar.

Biaya umum:

```text
- TLS handshake
- request queueing
- container worker thread scheduling
- header parsing
- body buffering by proxy/container
- connection keep-alive behavior
```

Kalau latency tinggi sebelum resource method dipanggil, Jersey resource code tidak akan kelihatan lambat, tetapi user tetap merasakan lambat.

Observability yang dibutuhkan:

```text
- gateway request time
- upstream response time
- container access log duration
- application duration
- queue time if available
```

### 4.2 Jersey Request Context Creation

Setelah masuk Jersey, runtime membuat context request:

```text
ContainerRequestContext
ResourceConfig reference
routing context
properties
security context
headers/media type info
entity stream reference
```

Biaya ini biasanya kecil, tetapi meningkat jika:

```text
- terlalu banyak filter/interceptor global
- tracing detail aktif di production high traffic
- property/context dimodifikasi berlebihan
- request body dibuffer di filter
- custom injection berat
```

### 4.3 Pre-Matching Filters

Pre-matching filter berjalan sebelum resource dipilih.

Cocok untuk:

```text
- correlation ID
- method override jika benar-benar diperlukan
- URI normalization terbatas
- early reject untuk auth/rate limit global
```

Risiko performa:

```text
- membaca body terlalu awal
- melakukan DB/remote call sebelum tahu resource target
- parsing JWT berat untuk semua request termasuk static/health
- logging besar sebelum sampling/filtering
```

Rule praktis:

> Pre-matching filter harus ringan, deterministik, dan tidak melakukan kerja bisnis.

### 4.4 Resource Matching

Jersey mencocokkan request terhadap resource model:

```text
path
HTTP method
consumes
produces
sub-resource locator
parameter model
```

Biaya matching biasanya bukan bottleneck utama bila resource model rapi. Tetapi bisa memburuk jika:

```text
- terlalu banyak resource path ambigu
- regex path kompleks
- sub-resource locator terlalu dinamis
- package scanning menghasilkan resource model besar tidak perlu
- versioning didesain terlalu granular dengan duplicate route luas
```

Desain route yang performanya lebih baik biasanya juga lebih maintainable:

```text
Good:
  /cases/{caseId}/documents/{documentId}
  /cases/search
  /cases/{caseId}/actions/submit

Risky:
  /{module}/{entity}/{id}/{action:.*}
  /api/{anything:.*}
  dynamic locator that decides service by database lookup
```

### 4.5 Post-Matching Filters

Setelah resource ditemukan, filter dapat memakai informasi target method/class.

Cocok untuk:

```text
- name-bound authorization
- audit classification
- idempotency on selected endpoints
- per-resource logging policy
- feature flag per endpoint
```

Risiko performa:

```text
- filter global melakukan introspection annotation berulang tanpa cache
- role evaluation memanggil remote service per request
- audit filter menulis synchronous ke DB untuk semua request
- idempotency filter memegang lock terlalu lama
```

Jika filter butuh metadata method, cache hasil introspection berdasarkan resource method identity.

### 4.6 Parameter Binding

Parameter binding meliputi:

```text
@PathParam
@QueryParam
@HeaderParam
@CookieParam
@MatrixParam
@BeanParam
custom ParamConverter
```

Biaya umumnya kecil, tetapi bisa meningkat karena:

```text
- custom converter melakukan parsing kompleks
- converter melakukan DB lookup
- BeanParam terlalu besar
- collection query param besar
- date/time parsing tanpa formatter reusable
```

Rule:

> `ParamConverter` harus pure conversion, bukan service lookup.

Buruk:

```java
public User fromString(String id) {
    return userRepository.findById(id); // jangan lakukan ini di converter
}
```

Baik:

```java
public UserId fromString(String value) {
    return UserId.parse(value);
}
```

### 4.7 Request Entity Reading

Untuk request body, Jersey memilih `MessageBodyReader` berdasarkan:

```text
target Java type
generic type
annotations
media type
registered providers
priority
```

Biaya bisa tinggi untuk:

```text
- JSON besar
- nested DTO dalam
- validation setelah deserialize
- polymorphic JSON
- multipart
- XML
- binary yang dibuffer ke memory
```

Hal penting:

> Request body adalah stream. Sekali dibaca, stream habis kecuali dibuffer ulang.

Filter logging yang membaca stream lalu membuat `byte[]` baru dapat menggandakan memory pressure.

Contoh risiko:

```text
Request body 20 MB
Logging filter copies body to byte[]
Jackson reads another structure
Validation creates violation paths
Service maps DTO to command object

Peak memory per request can be far above 20 MB.
```

### 4.8 Resource Method Execution

Resource method sering terlihat sebagai tempat utama latency, tetapi sebenarnya resource method biasanya memanggil service:

```java
@POST
@Path("/{caseId}/submit")
public Response submit(@PathParam("caseId") String caseId, SubmitRequest request) {
    SubmitResult result = submitCaseUseCase.submit(caseId, request);
    return Response.ok(result).build();
}
```

Biaya di dalam use case:

```text
- transaction begin/commit
- authorization check
- DB query
- ORM lazy loading
- remote service call
- cache read/write
- workflow state transition
- document generation
- email scheduling
- audit event
```

Top engineer tidak menyebut semua itu "Jersey latency". Dia memecahnya.

### 4.9 Response Entity Writing

Jersey memilih `MessageBodyWriter` untuk response.

Biaya bisa besar untuk:

```text
- JSON serialization graph besar
- lazy proxy triggering
- cyclic object graph
- date/time formatting
- BigDecimal formatting
- envelope/wrapper berlebihan
- streaming vs buffering salah
- gzip compression
- large list without pagination
```

Common mistake:

```java
return Response.ok(entityFromJpa).build();
```

Risiko:

```text
- accidental lazy loading
- infinite recursion parent-child
- leaking internal fields
- huge object graph
- serialization inconsistent with API contract
```

Better:

```java
CaseDetailResponse response = mapper.toResponse(caseAggregate);
return Response.ok(response).build();
```

---

## 5. Performance Cost Taxonomy

Setiap masalah performa harus diklasifikasi.

### 5.1 CPU-Bound

Ciri:

```text
- CPU tinggi
- thread runnable tinggi
- latency naik seiring CPU saturation
- DB/remote normal
- flame graph menunjukkan kerja aktif
```

Kemungkinan di Jersey app:

```text
- JSON serialization/deserialization
- validation berat
- object mapping besar
- compression
- encryption/signature
- regex path/converter kompleks
- logging formatting
- large collection processing
- reflection-heavy custom provider
```

Solusi:

```text
- profile CPU
- kurangi payload
- stream output
- cache immutable metadata
- optimize DTO mapping
- hindari expensive filter global
- offload heavy batch work
- tune compression threshold
```

### 5.2 IO-Bound

Ciri:

```text
- CPU rendah/sedang
- thread banyak blocked/timed waiting
- latency mengikuti DB/remote/storage
- queue meningkat saat dependency lambat
```

Kemungkinan:

```text
- DB query lambat
- remote API lambat
- file/S3/object storage lambat
- DNS/TLS/connect timeout
- outbound connection pool habis
- database connection pool habis
```

Solusi:

```text
- timeout tegas
- pool sizing benar
- bulkhead
- circuit breaker
- async job untuk long operation
- cache jika benar
- query/index optimization
- remove N+1
```

### 5.3 Allocation-Bound

Ciri:

```text
- allocation rate tinggi
- GC sering
- CPU banyak di GC atau allocation path
- p99 latency spikes
```

Sumber:

```text
- DTO graph besar
- body logging copies
- repeated ObjectMapper creation
- repeated DateTimeFormatter creation
- per-request regex compilation
- string concatenation/log formatting
- mapping entity -> DTO -> map -> DTO lagi
- collecting stream besar ke list
```

Solusi:

```text
- reuse immutable heavy objects
- avoid full buffering
- pagination
- streaming
- reduce mapping layers
- avoid body logging default
- cache metadata/converters
- use records carefully for DTO clarity, not as performance magic
```

### 5.4 Contention-Bound

Ciri:

```text
- CPU tidak penuh tetapi throughput tidak naik
- thread blocked on lock
- p99 naik saat concurrency naik
- thread dump menunjukkan synchronized/lock contention
```

Sumber:

```text
- synchronized singleton provider
- shared mutable formatter/cache
- global audit lock
- idempotency lock terlalu coarse
- connection pool lock under saturation
- logging appender sync bottleneck
- single executor queue
```

Solusi:

```text
- reduce shared mutable state
- use concurrent data structure carefully
- narrow lock scope
- partition lock per key
- async logging
- bounded executor per workload
- remove per-request global synchronized blocks
```

### 5.5 Queueing-Bound

Ciri:

```text
- processing time normal, total latency tinggi
- requests wait before execution
- active threads maxed
- executor queue grows
- connection pool wait grows
```

Sumber:

```text
- servlet thread pool full
- DB pool exhausted
- outbound client pool exhausted
- async executor saturated
- rate limiter queueing instead of rejecting
```

Solusi:

```text
- measure queue time
- set bounded queues
- fail fast when saturated
- tune pool sizes with Little's Law
- reduce blocking duration
- introduce bulkhead
```

---

## 6. Threading Model: Why “Tambah Thread” Is Often Wrong

Jersey itself does not magically make blocking work cheap. In servlet-style deployments, each request usually consumes a container worker thread while it is being processed.

Simplified:

```text
request arrives
  -> worker thread assigned
  -> Jersey pipeline runs
  -> resource method blocks on DB/HTTP
  -> same worker thread waits
  -> response serialized
  -> worker thread released
```

If dependency latency increases, each request holds the thread longer.

Throughput relationship:

```text
concurrency ≈ throughput × latency
```

Example:

```text
Target throughput: 100 rps
Average service time: 100ms
Needed concurrency ≈ 100 × 0.1 = 10 active requests

If dependency slows to 2s:
Needed concurrency ≈ 100 × 2 = 200 active requests
```

If worker pool has 100 threads, queue starts. If clients retry, load increases further.

### 6.1 Thread Pool Sizing Is Capacity Management

Thread pool size must consider:

```text
- CPU cores
- blocking ratio
- DB pool size
- outbound pool size
- memory per thread / stack
- downstream capacity
- timeout duration
- queue policy
```

Adding threads without downstream capacity can make the system worse:

```text
Before:
  100 threads hit DB pool of 30.

After:
  300 threads hit DB pool of 30.

Result:
  More memory, more context switching, more timeout, no more DB capacity.
```

### 6.2 Thread Pool Should Not Exceed Real Dependency Capacity Too Much

If DB pool is 30 and endpoint needs DB connection for most of its duration, allowing 500 concurrent requests just creates wait and tail latency.

Better:

```text
- use bounded concurrency
- reject or shed load predictably
- separate endpoints with different cost profiles
- separate outbound pools per dependency
- use back-pressure at gateway or application layer
```

### 6.3 ThreadLocal and MDC Cost

Jersey apps often use MDC for correlation ID.

Risks:

```text
- forgetting to clear MDC
- copying too many fields per request
- ThreadLocal leaks in pooled threads
- context lost across async boundaries
```

Pattern:

```java
public void filter(ContainerRequestContext requestContext) {
    String correlationId = resolveCorrelationId(requestContext);
    MDC.put("correlationId", correlationId);
    requestContext.setProperty("correlationId", correlationId);
}

public void filter(ContainerRequestContext requestContext,
                   ContainerResponseContext responseContext) {
    MDC.remove("correlationId");
}
```

For async, cleanup must be handled carefully because response may finish on a different thread.

---

## 7. Virtual Threads and Jersey Performance

Java 21 introduced virtual threads as a stable feature, and Java 25 is now an LTS generation after Java 21. Virtual threads matter for Jersey because many Jersey apps are blocking IO applications.

But the correct mental model is:

> Virtual threads reduce the cost of blocking threads; they do not reduce the cost of downstream latency, database capacity, CPU work, serialization, or bad retry behavior.

### 7.1 Where Virtual Threads Can Help

They can help when:

```text
- workload is mostly blocking IO
- servlet/container supports virtual-thread execution model
- blocking operations are properly timeout-bound
- downstream systems can handle concurrency
- code does not rely on thread pool size as implicit bulkhead
```

Example helpful case:

```text
Endpoint waits on multiple remote services.
Platform threads become saturated by waiting.
Virtual threads reduce thread resource pressure.
```

### 7.2 Where Virtual Threads Do Not Help

They do not help much when:

```text
- CPU is saturated by JSON serialization
- DB has only 30 useful concurrent connections
- remote service rate limit is 100 rps
- payload is too large
- response is buffered entirely in memory
- synchronized lock serializes all requests
- client retry storm overloads dependency
```

### 7.3 Hidden Risk: Removing Natural Back-Pressure

Traditional small worker pools accidentally limit concurrency. Virtual threads can allow far more concurrent blocking operations.

That sounds good until dependency collapses.

```text
Before virtual threads:
  200 worker threads limit DB pressure.

After virtual threads:
  10,000 virtual threads can wait for DB pool/remote API.

If not controlled:
  DB pool wait explodes.
  Remote dependency gets hammered.
  Memory grows from request state.
  Tail latency worsens.
```

So virtual threads require explicit bulkheads:

```text
- semaphore per dependency
- DB pool limit
- outbound connection pool limit
- rate limiter
- circuit breaker
- request timeout
```

### 7.4 Pinning and Blocking

Virtual threads are efficient when blocking operations can unmount from carrier threads. Some blocking or synchronized regions may pin carrier threads depending on JDK/version and library behavior.

For Jersey app design:

```text
- avoid long synchronized blocks
- avoid blocking while holding monitor locks
- use ReentrantLock carefully where appropriate
- profile with JFR when adopting virtual threads
- validate container support, not only JDK support
```

### 7.5 Java 8–25 Compatibility View

```text
Java 8:
  No virtual threads. Traditional pool sizing and async patterns matter more.

Java 11:
  Better runtime/library baseline, still platform-thread model.

Java 17:
  Common enterprise baseline for Jakarta-era migration.

Java 21:
  Virtual threads stable. Evaluate if container supports them.

Java 25:
  LTS generation with continued runtime improvements. Still requires measurement.
```

Rule:

> Treat virtual threads as a concurrency execution model, not as a performance fix.

---

## 8. Allocation Model in Jersey Apps

Modern Java can allocate fast, but allocation is not free. High allocation rate can cause GC pressure and latency spikes.

### 8.1 Common Allocation Sources

```text
Jersey/request layer:
  - request/response context objects
  - header maps
  - parameter conversion strings
  - filter/interceptor wrappers
  - exception objects
  - response builders

Serialization layer:
  - JSON parser tokens
  - DTO objects
  - collections/maps
  - date/time formatting objects
  - byte arrays / char arrays

Application layer:
  - entity-to-DTO mapping
  - command/result objects
  - validation violations
  - audit payloads
  - log message strings

IO layer:
  - buffers
  - multipart temporary representations
  - downloaded/uploaded byte arrays
```

Jersey's own overhead is usually acceptable. The biggest allocation often comes from body handling, mapping, and logging.

### 8.2 The Body Logging Trap

Bad pattern:

```java
byte[] body = requestContext.getEntityStream().readAllBytes();
log.info("body={}", new String(body, StandardCharsets.UTF_8));
requestContext.setEntityStream(new ByteArrayInputStream(body));
```

Why dangerous:

```text
- copies entire body into heap
- creates String copy
- may log sensitive data
- doubles/triples memory use
- breaks large upload behavior
- increases GC pressure
```

Better:

```text
- log metadata by default
- log body only for sampled small payloads
- enforce max capture size
- mask sensitive fields
- do not log multipart/binary bodies
- stream to bounded buffer only when explicitly enabled
```

### 8.3 Repeated Heavy Object Creation

Avoid per-request creation of:

```text
- ObjectMapper
- ValidatorFactory
- DateTimeFormatter when custom pattern can be static
- regex Pattern
- HTTP Client
- expensive reflection metadata
- JAXB/JSON-B binding contexts if applicable
```

Better:

```java
private static final Pattern CASE_ID_PATTERN = Pattern.compile("[A-Z]{3}-\\d{8}");
private static final DateTimeFormatter API_DATE = DateTimeFormatter.ISO_LOCAL_DATE;
```

For `ObjectMapper`, prefer a singleton configured at startup.

### 8.4 DTO Graph Size

This response looks innocent:

```java
return Response.ok(caseService.findAll()).build();
```

But if `findAll()` returns thousands of cases, each with nested documents, comments, users, actions, and history, response serialization becomes the bottleneck.

Better patterns:

```text
- pagination
- field selection if needed
- summary DTO vs detail DTO
- separate endpoints for expensive related data
- explicit export job for huge results
- streaming for bulk export
```

---

## 9. Serialization Performance: JSON Is Often the Real Endpoint

For many Jersey APIs, resource method logic is short, but JSON serialization dominates.

### 9.1 Serialization Cost Drivers

```text
- payload size
- object count
- nesting depth
- reflection/introspection cache misses
- custom serializers
- date/time formatting
- BigDecimal formatting
- polymorphic type handling
- lazy proxy handling
- field filtering
- compression
```

### 9.2 Jackson/JSON-B/MOXy Provider Strategy

Do not register multiple JSON providers casually.

Risk:

```text
- provider selection surprises
- different null/date/enum behavior between endpoints
- performance inconsistency
- classpath-dependent behavior
```

Production pattern:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(JacksonFeature.class);
        register(ObjectMapperProvider.class);
        packages("com.example.api");
    }
}
```

And:

```java
@Provider
public class ObjectMapperProvider implements ContextResolver<ObjectMapper> {
    private final ObjectMapper mapper;

    public ObjectMapperProvider() {
        this.mapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

### 9.3 Lazy Proxy Serialization

JPA entity serialization can silently destroy performance:

```text
Resource returns entity
  -> Jackson accesses getter
  -> getter triggers lazy load
  -> N+1 query
  -> object graph grows
  -> serialization time grows
  -> DB pressure grows
```

Better:

```text
- map to DTO inside transaction boundary
- fetch exactly what response needs
- never expose entity graph directly
- use projection query for list endpoints
- keep response contract stable
```

### 9.4 Streaming JSON

For huge output, streaming can reduce memory.

But streaming does not automatically solve everything:

```text
Pros:
  - lower peak heap
  - earlier first byte
  - useful for export

Cons:
  - error handling after partial response is hard
  - transaction may remain open too long if streaming from DB cursor
  - client disconnect handling needed
  - proxy buffering may hide streaming benefit
  - cannot easily compute Content-Length
```

Use streaming for export-like endpoints, not normal query endpoints by default.

---

## 10. Provider Lookup and Runtime Metadata Cost

Jersey uses registered providers for entity reading/writing, filters, interceptors, exception mappers, parameter converters, and features.

Provider lookup is usually optimized internally, but design still matters.

### 10.1 Provider Explosion

Too many global providers can increase cognitive and runtime complexity.

Signs:

```text
- multiple JSON providers registered
- generic MessageBodyWriter<Object>
- global filters for niche endpoints
- broad ExceptionMapper<Throwable>
- dynamic feature scanning many annotations per request
```

Better:

```text
- explicit registration
- narrow provider type
- name binding for filters/interceptors
- priority intentionally documented
- cache annotation introspection
```

### 10.2 Generic Provider Trap

Bad:

```java
@Provider
@Produces(MediaType.APPLICATION_JSON)
public class UniversalWriter implements MessageBodyWriter<Object> {
    // writes anything
}
```

This competes with normal JSON providers and may cause unexpected selection.

Better:

```java
@Provider
@Produces("application/vnd.company.audit+json")
public class AuditEventWriter implements MessageBodyWriter<AuditEventEnvelope> {
    // narrow and predictable
}
```

### 10.3 DynamicFeature Cost

`DynamicFeature` is usually evaluated during resource model building/registration, not on every request in the same way as filters. But code inside filters registered by it still runs per request.

Pattern:

```java
@Provider
public class AuditedFeature implements DynamicFeature {
    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        if (resourceInfo.getResourceMethod().isAnnotationPresent(Audited.class)) {
            context.register(AuditFilter.class);
        }
    }
}
```

This is better than one global filter checking annotations on every request.

---

## 11. Filters and Interceptors: Performance Rules

Filters are powerful because they run on many requests. That makes them dangerous.

### 11.1 Global Filter Cost Multiplies

A 2ms global filter at 500 rps costs:

```text
2ms × 500 = 1000ms CPU time per second
≈ one full CPU core consumed
```

If three such filters exist, you have burned three cores before business logic.

### 11.2 Request Filter Checklist

A production request filter should answer:

```text
- Does it run globally or only on selected endpoints?
- Does it read the entity stream?
- Does it allocate large objects?
- Does it call DB/remote service?
- Does it use cached metadata?
- Does it add high-cardinality log fields?
- Does it have timeout if doing IO?
- Does it fail open or fail closed?
```

### 11.3 Interceptor Cost

Reader/writer interceptors wrap entity read/write.

Good use cases:

```text
- compression
- encryption/signature
- payload hash
- limited body capture
```

Risk:

```text
- buffering entire output
- double serialization
- per-byte inefficient wrapping
- encryption/compression for tiny payloads
```

Compression should usually have threshold logic:

```text
Do not gzip tiny responses where CPU cost exceeds bandwidth benefit.
```

---

## 12. IO Model: Blocking Is Fine Until It Is Unbounded

Most Jersey enterprise apps are blocking:

```text
resource method -> service -> JDBC -> remote HTTP -> return
```

Blocking is not automatically bad. Unbounded blocking is bad.

### 12.1 Required Controls

Every IO operation needs:

```text
- connect timeout
- read/request timeout
- pool limit
- queue limit
- cancellation behavior
- retry policy if safe
- circuit breaker for repeated failure
- metric and trace
```

### 12.2 Jersey Client Response Closing

For Jersey Client, always close response when not directly reading as an auto-managed type.

Bad:

```java
Response response = target.request().get();
if (response.getStatus() == 200) {
    return response.readEntity(MyDto.class);
}
throw new RuntimeException("failed"); // response may not be closed depending path
```

Better:

```java
try (Response response = target.request().get()) {
    if (response.getStatus() == 200) {
        return response.readEntity(MyDto.class);
    }
    throw mapRemoteError(response);
}
```

Connection leaks become performance incidents:

```text
- pool exhausted
- threads wait for connection
- latency rises
- retry storm begins
```

### 12.3 DB Pool and HTTP Pool Alignment

If endpoint does DB + remote HTTP, capacity is minimum of multiple pools.

```text
Endpoint A:
  uses DB pool max 30
  uses remote pool max 50
  container threads 200

Effective useful concurrency may be around 30 for DB-heavy path.
```

Letting 200 requests enter may mostly create queue.

---

## 13. Buffering vs Streaming

### 13.1 Buffering

Buffering means collecting full content before sending/processing.

Pros:

```text
- easier error handling
- can compute Content-Length
- can retry internal operation before response starts
- can sign/hash full payload
```

Cons:

```text
- high memory
- high latency before first byte
- OOM risk for large payload
```

### 13.2 Streaming

Streaming means processing/sending progressively.

Pros:

```text
- lower peak memory
- good for large file/export
- faster first byte
```

Cons:

```text
- partial response cannot be cleanly converted to normal JSON error
- client disconnect handling required
- proxy buffering may defeat streaming
- long-held resources
```

### 13.3 Decision Matrix

```text
Small JSON response:
  buffer normally.

Normal list endpoint:
  paginate; do not stream huge list by default.

Large export:
  stream or async export job.

File download:
  stream.

File upload:
  stream to controlled temporary/object storage; do not read all bytes.

Audit-critical generated document:
  may buffer to compute hash/signature, but enforce size limit.
```

---

## 14. Caching and Performance

Caching can help, but wrong cache creates correctness incidents.

### 14.1 Cacheable Things in Jersey Apps

Good candidates:

```text
- immutable reference data
- route/resource metadata
- annotation introspection result
- ObjectMapper/config objects
- compiled regex patterns
- remote token until expiry
- external lookup by exact key with TTL
```

Risky candidates:

```text
- user authorization result without tenant/context
- mutable case state
- partial DTO with unclear invalidation
- validation error for changing rules
- response with personal data
```

### 14.2 Cache Key Discipline

Bad:

```text
cache key = caseId
```

If response differs by user role, tenant, locale, or API version, this leaks or corrupts data.

Better:

```text
cache key = tenantId + apiVersion + roleClass + locale + caseId
```

But if key becomes too complex, maybe response caching is wrong.

---

## 15. GC and Jersey Workloads

Jersey apps commonly create many short-lived objects:

```text
request contexts
DTOs
JSON parser structures
strings
collections
response builders
exceptions
log entries
```

This usually fits generational GC well. Problems appear when:

```text
- payloads are huge
- objects survive longer due to async/queues
- response bodies are buffered
- caches retain too much
- ThreadLocal retains request data
- multipart temp metadata leaks
- SSE clients retain per-connection state
```

### 15.1 G1 vs ZGC Mental Model

Do not choose GC by fashion.

```text
G1:
  - common default for many enterprise services
  - good balance
  - generally memory efficient
  - suitable for many Jersey APIs

ZGC / Generational ZGC:
  - targets very low pause times
  - useful for latency-sensitive services and larger heaps
  - may need memory headroom
  - still requires allocation reduction if app allocates excessively
```

### 15.2 Java 8–25 GC View

```text
Java 8:
  G1 available but older than modern versions.
  CMS historically existed but should not be target for new systems.

Java 11:
  G1 mature; ZGC introduced as experimental era.

Java 17:
  strong enterprise LTS baseline; ZGC production-ready.

Java 21:
  generational ZGC available; virtual threads stable.

Java 25:
  runtime/GC improvements continue; still profile under real workload.
```

### 15.3 GC Tuning Order

Correct order:

```text
1. Measure allocation rate and heap usage.
2. Identify object sources.
3. Reduce avoidable allocation.
4. Fix buffering/logging/caches.
5. Tune heap and GC.
6. Validate p95/p99 under load.
```

Wrong order:

```text
1. Change GC.
2. Hope endpoint becomes fast.
```

---

## 16. Endpoint Design for Performance

### 16.1 List Endpoint

Bad:

```java
@GET
@Path("/cases")
public List<CaseDetailResponse> allCases() {
    return caseService.findAllDetails();
}
```

Problems:

```text
- unbounded result
- huge serialization
- DB pressure
- memory pressure
- unstable latency
```

Better:

```java
@GET
@Path("/cases")
public PagedResponse<CaseSummaryResponse> search(@BeanParam CaseSearchRequest request) {
    Page<CaseSummaryResponse> page = caseQuery.search(request.toCriteria());
    return PagedResponse.from(page);
}
```

Rules:

```text
- require pagination
- cap page size
- use summary DTO
- return stable sort
- include next link/cursor
- reject pathological filters
```

### 16.2 Detail Endpoint

Detail endpoint can be richer, but still bounded.

```text
/cases/{id}
/cases/{id}/documents
/cases/{id}/timeline
/cases/{id}/audit-events
```

Avoid one mega endpoint returning everything.

### 16.3 Command Endpoint

Command endpoints should separate accepted work from completed work.

If operation is fast:

```text
POST /cases/{id}/submit -> 200/204
```

If operation is long:

```text
POST /cases/{id}/submit -> 202 Accepted + operationId
GET /operations/{operationId}
```

This prevents request threads from being held for long-running workflows.

### 16.4 Export Endpoint

Avoid:

```text
GET /cases/export returns huge generated file synchronously under request thread with no limit
```

Better:

```text
POST /exports/cases -> 202 Accepted
GET /exports/{id} -> status
GET /exports/{id}/file -> stream when ready
```

For small exports, streaming can be acceptable with strict limits.

---

## 17. Profiling Methodology

### 17.1 Do Not Guess

Performance work without profiling often optimizes the wrong layer.

Use:

```text
- metrics for where saturation occurs
- traces for distributed latency
- logs for correlation/error context
- CPU profiler/flame graph for CPU
- allocation profiler for memory pressure
- thread dump for blocking/locking
- JFR for runtime events
- load test for reproducibility
```

### 17.2 Step-by-Step Investigation

```text
1. Define symptom:
   Which endpoint? Which percentile? Since when? Under what traffic?

2. Split latency:
   gateway vs application vs DB vs outbound.

3. Check saturation:
   CPU, heap, GC, threads, DB pool, HTTP pool, queues.

4. Check error/retry:
   timeout, 429, 5xx, circuit breaker, client retry.

5. Profile one representative period:
   CPU flame graph if CPU high.
   Thread dump if blocked.
   Allocation if GC high.

6. Form hypothesis:
   Example: JSON serialization of detail response dominates CPU.

7. Make targeted change:
   Example: summary DTO + pagination + remove nested history.

8. Validate:
   Compare p50/p95/p99, CPU, allocation, error rate.
```

### 17.3 Useful Thread Dump Patterns

Blocked on DB pool:

```text
threads waiting on Hikari pool / datasource getConnection
```

Blocked on remote HTTP:

```text
threads in socketRead / HttpClient execute / Jersey connector read
```

Lock contention:

```text
BLOCKED on synchronized method in singleton provider/filter/cache
```

Serialization CPU:

```text
RUNNABLE in Jackson serializer / reflection / bean property writer
```

Logging bottleneck:

```text
threads waiting in logging appender or formatting large messages
```

---

## 18. Load Testing Jersey Correctly

### 18.1 Test Realistic Payloads

A performance test with tiny JSON is misleading if production payload is large.

Test dimensions:

```text
- small request / small response
- small request / large response
- large request / small response
- validation-heavy request
- error response path
- auth-heavy path
- DB-heavy path
- remote-heavy path
- file upload/download
```

### 18.2 Test Tail, Not Only Average

Capture:

```text
- p50
- p90
- p95
- p99
- max
- error rate
- timeout count
- retry count
- CPU
- heap/GC
- thread pool
- DB pool
- outbound pool
```

### 18.3 Warmup Matters

JVM/Jersey performance changes after warmup:

```text
- class loading
- JIT compilation
- Jackson serializer cache
- connection pool warmup
- TLS session reuse
- DB plan cache
```

Do not judge cold startup behavior as steady-state behavior unless cold start is the goal.

### 18.4 Data Shape Matters

Production data may have:

```text
- longer strings
- more nested children
- null-heavy fields
- rare enum values
- large CLOB/text
- more validation violations
- more authorization checks
```

Use production-like anonymized data.

---

## 19. Jersey-Specific Performance Anti-Patterns

### Anti-Pattern 1: Resource Class as God Object

```text
One class handles 50 endpoints, mapping, validation, auth, DB calls, response shaping.
```

Impact:

```text
- hard to profile
- hard to test
- high accidental coupling
- shared mutable state risk
```

Fix:

```text
- resource as adapter
- use case service owns business flow
- mapper owns DTO conversion
- filters own cross-cutting concerns
```

### Anti-Pattern 2: Returning JPA Entities Directly

Impact:

```text
- lazy load N+1
- huge graph
- security leak
- unstable JSON contract
```

Fix:

```text
- projection/query DTO
- explicit response DTO
- controlled fetch plan
```

### Anti-Pattern 3: Global Body Logging

Impact:

```text
- memory spike
- sensitive data leakage
- serialization-like overhead before business logic
```

Fix:

```text
- metadata logs
- sampling
- max body size
- masking
```

### Anti-Pattern 4: New Client Per Request

Bad:

```java
Client client = ClientBuilder.newClient();
Response r = client.target(url).request().get();
```

Impact:

```text
- connection reuse lost
- TLS overhead
- resource leak risk
- higher latency
```

Fix:

```text
- singleton/reused Client per config/dependency
- close on application shutdown
- configure pool/timeouts
```

### Anti-Pattern 5: No Timeout

Impact:

```text
- threads held indefinitely
- pool exhaustion
- cascading failure
```

Fix:

```text
- connect timeout
- read/request timeout
- total deadline
- fallback/circuit breaker where appropriate
```

### Anti-Pattern 6: Unbounded List Endpoint

Impact:

```text
- DB, memory, serialization, network all scale with data size
```

Fix:

```text
- pagination
- max page size
- cursor for large datasets
- export workflow for huge results
```

### Anti-Pattern 7: Synchronous Audit Write in Hot Path

Impact:

```text
- audit store latency becomes API latency
- audit DB incident becomes API incident
```

Fix:

```text
- durable outbox
- async event dispatch
- fallback policy
- explicit audit reliability contract
```

---

## 20. Performance Design Checklist

Use this before building a Jersey endpoint.

### 20.1 Request Contract

```text
[ ] Is request body size bounded?
[ ] Are query params bounded?
[ ] Are filters selective?
[ ] Is validation cost understood?
[ ] Is parameter conversion pure and cheap?
```

### 20.2 Resource Method

```text
[ ] Is resource only an adapter?
[ ] Is transaction boundary clear?
[ ] Is authorization boundary clear?
[ ] Are remote calls timeout-bound?
[ ] Is DB query shape known?
[ ] Is endpoint idempotency clear?
```

### 20.3 Response Contract

```text
[ ] Is response size bounded?
[ ] Is pagination enforced for lists?
[ ] Is DTO explicit?
[ ] Are lazy entities avoided?
[ ] Is streaming used only when appropriate?
[ ] Is compression threshold reasonable?
```

### 20.4 Runtime

```text
[ ] Are Jersey providers registered explicitly?
[ ] Are JSON providers not conflicting?
[ ] Are clients reused?
[ ] Are pools sized with dependency capacity?
[ ] Are queues bounded?
[ ] Are MDC/ThreadLocal values cleared?
```

### 20.5 Observability

```text
[ ] Is latency measured by endpoint?
[ ] Are p95/p99 tracked?
[ ] Are DB/outbound timings visible?
[ ] Is payload size tracked?
[ ] Is error taxonomy visible?
[ ] Can we profile CPU/allocation under load?
```

---

## 21. Mini Case Study: Slow Case Search Endpoint

### 21.1 Symptom

```text
GET /cases/search p95 increased from 350ms to 4.2s.
CPU 75%.
DB CPU 30%.
Heap allocation high.
GC frequent but short.
```

### 21.2 First Bad Guess

```text
Jersey routing is slow because many endpoints were added.
```

Unlikely unless route model is pathological. Need evidence.

### 21.3 Measurements

```text
Trace breakdown:
  auth filter: 10ms
  search service DB: 180ms
  DTO mapping: 600ms
  response serialization: 2800ms
  response size: 18 MB

Allocation profile:
  many CaseDetailResponse
  many ArrayList
  Jackson bean serialization hotspot
```

### 21.4 Root Cause

Search endpoint accidentally changed from summary DTO to detail DTO including:

```text
- documents
- comments
- assignment history
- audit trail summary
```

### 21.5 Fix

```text
- restore CaseSummaryResponse
- cap page size to 100
- move details to /cases/{id}
- add response payload size metric
- add contract test for fields
- add load test for worst-case search page
```

### 21.6 Lesson

The bottleneck looked like "Jersey slow", but the real issue was response contract expansion and JSON serialization.

---

## 22. Mini Case Study: Thread Pool Exhaustion from Remote Dependency

### 22.1 Symptom

```text
POST /applications/{id}/verify intermittently times out.
CPU low.
Container threads maxed.
Outbound dependency latency high.
```

### 22.2 Thread Dump

Many threads waiting in outbound HTTP read.

### 22.3 Root Cause

```text
- no read timeout
- retry without jitter
- no circuit breaker
- worker threads blocked
- client retry amplified load
```

### 22.4 Fix

```text
- connect timeout: 1s
- read timeout: 3s
- total deadline: 4s
- retry only safe transient failures
- exponential backoff with jitter
- circuit breaker
- bulkhead per dependency
- map dependency timeout to stable 503/504 error contract
```

### 22.5 Lesson

Adding Jersey/server threads would only allow more requests to block. The real fix is bounded IO and resilience.

---

## 23. Mini Case Study: Memory Spike from Multipart Upload

### 23.1 Symptom

```text
Upload endpoint fails with OOM during peak.
Average file size 5 MB.
Some files 200 MB.
```

### 23.2 Root Cause

```text
- endpoint reads file into byte[]
- logging filter captures request body
- antivirus integration buffers again
- concurrent uploads create heap spike
```

### 23.3 Fix

```text
- enforce max upload size
- stream to temp/object storage
- skip body logging for multipart
- scanner reads stream/file path
- limit concurrent uploads
- monitor temp disk and upload latency
```

### 23.4 Lesson

Large payload performance is mostly memory and IO discipline, not Jersey annotation usage.

---

## 24. Java Version Considerations: 8 to 25

### Java 8

Constraints:

```text
- older GC/JIT/runtime behavior
- no records
- no virtual threads
- older TLS/library ecosystem
- javax-based Jersey 2.x common
```

Recommendations:

```text
- be conservative with allocation
- use explicit pools/timeouts
- avoid very large heap pause surprises
- keep DTO simple
- benchmark on real JDK 8 if still deployed
```

### Java 11

```text
- better runtime baseline than 8
- stronger container support era
- still no virtual threads
- often migration stepping stone
```

### Java 17

```text
- common modern LTS baseline
- good for Jakarta migration
- records/sealed classes available for DTO modeling if desired
- mature G1/ZGC options
```

### Java 21

```text
- virtual threads stable
- generational ZGC available
- useful for blocking IO apps when container supports it
- requires explicit bulkhead thinking
```

### Java 25

```text
- latest LTS generation after 21
- runtime improvements continue
- good target for long-lived platform modernization
- still requires workload-specific profiling
```

Version rule:

> Do not infer performance from Java version alone. Measure the same Jersey workload on the target JDK, target container, target dependency versions, and target payload shape.

---

## 25. Practical Tuning Order for Jersey Apps

When asked "how do we make this Jersey API faster?", use this order:

```text
1. Clarify target:
   throughput, p95, p99, CPU, memory, cost, cold start, or tail stability?

2. Measure current behavior:
   endpoint latency, dependency latency, payload size, CPU, GC, threads.

3. Remove obvious contract problems:
   unbounded lists, huge DTO, body logging, no timeout.

4. Fix dependency controls:
   DB query, connection pool, outbound timeout, bulkhead.

5. Optimize serialization/mapping:
   DTO shape, ObjectMapper reuse, avoid lazy entities.

6. Reduce allocation:
   avoid buffering, reuse immutable heavy objects, reduce copies.

7. Tune pools:
   container threads, DB pool, HTTP pool, executor queues.

8. Tune JVM:
   heap, GC, JFR validation.

9. Tune infrastructure:
   CPU/memory limits, pod count, gateway timeout, network.

10. Regression guard:
   load tests, contract tests, metrics alerts.
```

This order prevents expensive low-value tuning.

---

## 26. What Top Engineers Notice

A top engineer looking at Jersey performance asks:

```text
- Is this endpoint bounded?
- Is latency CPU, IO, queueing, allocation, or contention?
- Is the response contract accidentally too large?
- Are we serializing domain entities?
- Are filters global and expensive?
- Are providers explicit and deterministic?
- Are request/response bodies buffered unnecessarily?
- Are clients reused and closed correctly?
- Are timeouts shorter than upstream/gateway deadlines?
- Is retry safe and bounded?
- Are thread pools aligned with dependency capacity?
- Are p99 and saturation visible?
- Can the endpoint fail fast under overload?
```

Performance is not just speed. It is controlled degradation.

---

## 27. Review Questions

1. Why is average latency insufficient for Jersey production performance analysis?
2. What is the difference between CPU-bound and IO-bound endpoint latency?
3. Why can adding container threads make an outage worse?
4. Why is returning JPA entities directly dangerous for performance?
5. What makes global filters risky?
6. How can body logging cause GC pressure?
7. When is streaming better than buffering?
8. When is buffering better than streaming?
9. Why do virtual threads not replace bulkheads?
10. What metrics would you inspect when p99 latency increases?
11. Why must Jersey Client `Response` be closed?
12. What is the correct order of performance tuning?

---

## 28. Summary

Jersey performance is a pipeline problem. The runtime participates in request matching, provider selection, filters, interceptors, entity reading/writing, exception mapping, and client invocation. But most production bottlenecks come from the interaction between Jersey and application design: payload size, serialization, blocking IO, pools, filters, logging, validation, mapping, database access, remote calls, and GC pressure.

The strongest mental model is:

```text
Total latency
  = queue time
  + Jersey pipeline overhead
  + parameter/entity read
  + resource/use-case execution
  + dependency wait
  + response serialization
  + network write
```

Do not tune blindly. Measure. Classify. Fix the dominant cost. Validate under realistic load.

---

## 29. Status Seri

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
Part 16 — selesai
Part 17 — selesai
Part 18 — selesai
Part 19 — selesai
Part 20 — selesai
Part 21 — selesai
Part 22 — selesai
Part 23 — selesai
Part 24 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri belum selesai. Berikutnya:

> Part 24 — Virtual Threads, Modern Java, and Jersey Runtime Compatibility Thinking

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 22 — Observability in Jersey: Logs, Metrics, Traces, Correlation, and Profiling](./22-observability-in-jersey-logs-metrics-traces-correlation-profiling.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 24 — Virtual Threads, Modern Java, and Jersey Runtime Compatibility Thinking](./24-virtual-threads-modern-java-jersey-runtime-compatibility-thinking.md)

</div>