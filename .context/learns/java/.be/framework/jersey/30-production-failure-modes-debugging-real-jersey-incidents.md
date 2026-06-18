# Part 30 — Production Failure Modes: Debugging Real Jersey Incidents

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `30-production-failure-modes-debugging-real-jersey-incidents.md`  
Status: Part 30 dari 32  
Target pembaca: engineer yang sudah memahami Java, HTTP, Jakarta REST/JAX-RS, Jersey resource/provider/filter/client, deployment, observability, dan performance model.

---

## 0. Tujuan Part Ini

Part ini bukan mengajarkan fitur baru Jersey satu per satu. Part ini mengajarkan cara berpikir saat Jersey application di production menunjukkan gejala seperti:

- endpoint terlihat ada di code, tetapi client mendapat `404 Not Found`;
- endpoint ada, tetapi client mendapat `405 Method Not Allowed`;
- JSON request benar menurut client, tetapi server menjawab `415 Unsupported Media Type`;
- response DTO valid menurut service, tetapi Jersey gagal menulis response dengan `MessageBodyWriter not found`;
- `ExceptionMapper` tidak pernah terpanggil;
- authentication filter berjalan, tetapi resource menerima `SecurityContext` kosong;
- deployment berhasil, tetapi startup lambat atau gagal karena injection/resource ambiguity;
- outbound Jersey Client terlihat sukses di low traffic, tetapi leak connection saat traffic naik;
- SSE/file download/multipart endpoint menyebabkan memory atau disk pressure;
- error hanya muncul setelah migrasi dari Jersey 2 ke 3/4 atau dari Java 8 ke Java 17/21/25.

Target akhirnya: kamu mampu membangun **debugging decision tree**. Bukan menebak-nebak. Bukan langsung menyalahkan Jersey, proxy, JSON, Spring, atau container. Setiap gejala harus dikembalikan ke stage runtime yang tepat.

---

## 1. Mental Model: Jersey Incident Hampir Selalu Terjadi di Salah Satu Boundary

Jersey production incident jarang benar-benar “misterius”. Biasanya failure terjadi di salah satu boundary berikut:

```text
Client / Browser / Upstream Service
        |
        v
Proxy / API Gateway / Load Balancer
        |
        v
Servlet Container / Embedded Server
        |
        v
Jersey Application Mapping
        |
        v
Resource Matching
        |
        v
Filter / Interceptor Pipeline
        |
        v
Parameter Injection
        |
        v
Entity Provider Read
        |
        v
Resource Method
        |
        v
Service / Domain / Transaction / Dependency
        |
        v
Exception Mapper
        |
        v
Entity Provider Write
        |
        v
Container Response / Proxy Response
        |
        v
Client
```

Top 1% debugging skill bukan hafal semua error message. Skill utamanya adalah cepat menjawab:

> “Request ini mati di stage mana?”

Jika stage-nya salah, semua diagnosis berikutnya biasanya salah.

Contoh:

- `404` dari gateway berbeda dengan `404` dari Jersey resource matching.
- `401` dari authentication filter berbeda dengan `401` dari upstream IdP.
- `500` dari `ExceptionMapper` berbeda dengan `500` karena mapper itu sendiri throw exception.
- `No MessageBodyWriter found` bukan bug service layer; itu provider selection/write-stage failure.
- `Connection pool exhausted` pada Jersey Client bukan problem endpoint tujuan saja; bisa jadi response tidak ditutup.

---

## 2. Prinsip Utama Debugging Jersey

### 2.1. Jangan mulai dari stack trace; mulai dari stage

Stack trace penting, tetapi stack trace sering muncul **terlambat**. Dalam Jersey, banyak kegagalan terjadi sebelum resource method dipanggil:

- URI tidak match;
- HTTP method tidak cocok;
- `Content-Type` tidak diterima;
- `Accept` tidak bisa dipenuhi;
- parameter conversion gagal;
- body reader tidak ditemukan;
- filter abort request;
- security context tidak dibentuk.

Jika kamu hanya melihat resource method log, kamu bisa salah simpul: “method saya tidak terpanggil, berarti request tidak sampai server”. Padahal request sampai server, tetapi gugur sebelum method.

### 2.2. Selalu bedakan inbound, internal, dan outbound failure

```text
Inbound failure:
  client -> Jersey boundary gagal

Internal failure:
  Jersey resource -> service/domain/persistence gagal

Outbound failure:
  Jersey app -> dependency eksternal gagal
```

Banyak incident bercampur. Contoh: endpoint search menerima request, service memanggil remote API dengan Jersey Client, remote timeout, lalu generic exception mapper mengembalikan `500`. Dari luar tampak “Jersey API 500”, padahal akar masalah outbound timeout policy.

### 2.3. Jangan percaya status code tanpa tahu siapa yang menghasilkannya

Status code bisa dibuat oleh:

- browser/client;
- CDN/WAF;
- API gateway;
- load balancer;
- servlet container;
- Jersey runtime;
- filter/interceptor;
- exception mapper;
- resource method;
- reverse proxy saat response streaming gagal.

Karena itu setiap response error production sebaiknya punya minimal:

```text
correlationId
origin/service name
stage atau error category
stable error code
safe message
```

Tanpa itu, tim sering berdebat lama hanya untuk menentukan “error ini dari mana”.

---

## 3. Incident Class 1 — Endpoint Not Found (`404`)

### 3.1. Gejala

Client memanggil:

```http
GET /api/v1/customers/123
```

Response:

```http
404 Not Found
```

Tetapi di code ada resource:

```java
@Path("/customers")
public class CustomerResource {
    @GET
    @Path("/{id}")
    public CustomerDto get(@PathParam("id") String id) {
        ...
    }
}
```

### 3.2. Kemungkinan stage failure

```text
A. Request tidak sampai aplikasi
B. Proxy path rewrite salah
C. Servlet mapping salah
D. Application path salah
E. Resource class tidak terdaftar
F. Path template tidak match
G. Sub-resource locator tidak mengembalikan resource yang benar
H. Trailing slash / encoded path / matrix param berubah
I. Namespace/dependency membuat app berbeda dari yang dipikirkan
```

### 3.3. Decision tree

```text
1. Apakah request muncul di access log container?
   Tidak -> gateway/LB/network/routing.
   Ya -> lanjut.

2. Apakah request muncul di Jersey request filter log paling awal?
   Tidak -> servlet mapping/application path.
   Ya -> lanjut.

3. Apakah resource class masuk ResourceConfig?
   Tidak -> registration/scanning.
   Ya -> lanjut.

4. Apakah @ApplicationPath + servlet mapping + @Path membentuk URL yang dipanggil?
   Tidak -> path composition issue.
   Ya -> lanjut.

5. Apakah method/path segment match secara exact?
   Tidak -> path template issue.
   Ya -> lanjut ke method/media matching.
```

### 3.4. Penyebab umum

#### Penyebab 1 — `ApplicationPath` dan servlet mapping bertumpuk

Misalnya:

```java
@ApplicationPath("/api")
public class AppConfig extends ResourceConfig { }
```

Lalu servlet mapping juga:

```xml
<url-pattern>/api/*</url-pattern>
```

Hasil efektif bisa menjadi tidak seperti yang diasumsikan. Dalam deployment yang berbeda, base path bisa berubah.

Mental model:

```text
public URL = gateway prefix + servlet context path + servlet mapping + application path + resource path
```

Jangan pernah debug `@Path` tanpa menghitung semua layer path.

#### Penyebab 2 — resource tidak terdaftar

Contoh terlalu bergantung pada package scanning:

```java
public class AppConfig extends ResourceConfig {
    public AppConfig() {
        packages("com.company.api");
    }
}
```

Lalu resource pindah ke:

```text
com.company.customer.boundary
```

Startup tetap berhasil, tetapi endpoint hilang.

Production recommendation:

```java
public class AppConfig extends ResourceConfig {
    public AppConfig() {
        register(CustomerResource.class);
        register(OrderResource.class);
        register(GlobalExceptionMapper.class);
    }
}
```

Untuk aplikasi besar, explicit registration lebih verbose, tetapi lebih deterministic.

#### Penyebab 3 — path rewrite gateway

Gateway route:

```text
/public/customer-api/* -> /api/*
```

Tetapi request yang diterima app ternyata:

```text
/customer-api/api/v1/customers/123
```

Solusi bukan mengubah `@Path` secara panik, tetapi memastikan kontrak antara gateway dan aplikasi jelas:

```text
external path: /public/customer-api/v1/customers/{id}
internal path: /api/v1/customers/{id}
```

### 3.5. Debug instrumentation minimal

Tambahkan pre-matching request filter sementara di non-production atau dengan feature flag:

```java
@Provider
@PreMatching
@Priority(Priorities.AUTHENTICATION - 100)
public class EarlyRequestDebugFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        System.out.printf(
            "method=%s uri=%s path=%s base=%s headers=%s%n",
            ctx.getMethod(),
            ctx.getUriInfo().getRequestUri(),
            ctx.getUriInfo().getPath(),
            ctx.getUriInfo().getBaseUri(),
            ctx.getHeaders().keySet()
        );
    }
}
```

Jangan log full headers/body di production tanpa masking.

---

## 4. Incident Class 2 — Method Not Allowed (`405`)

### 4.1. Gejala

Endpoint path benar, tetapi method salah:

```http
POST /api/v1/customers/123
```

Response:

```http
405 Method Not Allowed
Allow: GET, PUT, DELETE
```

### 4.2. Makna runtime

`405` biasanya berarti:

```text
resource path match, tetapi tidak ada resource method dengan HTTP verb yang cocok
```

Ini berbeda dari `404`:

```text
404 -> path/resource tidak match
405 -> path match, verb tidak match
```

### 4.3. Penyebab umum

- frontend memakai `POST` untuk operation yang server desain sebagai `PUT`;
- CORS preflight `OPTIONS` tidak ditangani oleh filter/gateway;
- method annotation hilang setelah refactor;
- sub-resource locator mengarah ke class yang tidak punya method tersebut;
- gateway mengubah method, misalnya `X-HTTP-Method-Override` tidak diproses.

### 4.4. Debugging rule

Jika `405` muncul, jangan mulai dari JSON body. Body belum relevan. Periksa dulu:

```text
@Path class
@Path method
@GET/@POST/@PUT/@PATCH/@DELETE
sub-resource locator
Allow header
proxy method forwarding
CORS handling
```

---

## 5. Incident Class 3 — `406 Not Acceptable`

### 5.1. Gejala

Resource method ada dan HTTP method benar:

```java
@GET
@Path("/{id}")
@Produces("application/json")
public CustomerDto get(@PathParam("id") String id) { ... }
```

Client mengirim:

```http
Accept: application/xml
```

Response:

```http
406 Not Acceptable
```

### 5.2. Makna runtime

`406` berarti server menemukan method/path, tetapi tidak bisa menghasilkan representation yang sesuai dengan `Accept` header.

### 5.3. Penyebab umum

- client mengirim `Accept` terlalu sempit;
- browser/plugin mengirim header aneh;
- endpoint hanya `@Produces("application/json")`, client meminta vendor media type;
- versioning via media type tidak match;
- wildcard quality factor tidak dipahami tim;
- `@Produces` di class dan method menghasilkan kombinasi yang tidak dipikirkan.

### 5.4. Debugging checklist

```text
Request Accept header?
@Produces di class?
@Produces di method?
Vendor media type digunakan?
Quality factor q digunakan?
Default media type expectation apa?
```

Contoh lebih fleksibel:

```java
@GET
@Produces({
    "application/vnd.company.customer-v1+json",
    MediaType.APPLICATION_JSON
})
public CustomerDto get(...) { ... }
```

Tetapi fleksibilitas harus dikendalikan. Jangan menerima terlalu banyak media type jika contract API harus ketat.

---

## 6. Incident Class 4 — `415 Unsupported Media Type`

### 6.1. Gejala

Client mengirim JSON:

```http
POST /api/v1/customers
Content-Type: text/plain

{"name":"Alice"}
```

Resource:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) { ... }
```

Response:

```http
415 Unsupported Media Type
```

### 6.2. Makna runtime

`415` berarti server tidak menerima `Content-Type` request untuk resource method yang cocok.

### 6.3. Penyebab umum

- client lupa `Content-Type: application/json`;
- `Content-Type` ada charset/vendor suffix yang tidak cocok;
- frontend mengirim `multipart/form-data`, endpoint mengharapkan JSON;
- endpoint menerima `application/json`, gateway mengubah header;
- body kosong tetapi `@Consumes` membuat runtime tetap menilai media type;
- provider JSON tidak terdaftar, sehingga seolah media type tidak bisa diproses.

### 6.4. Debugging checklist

```text
Content-Type actual di server?
@Consumes class/method?
Apakah body memang ada?
Apakah endpoint multipart atau JSON?
Apakah provider body reader tersedia?
Apakah gateway mengubah header?
```

### 6.5. Pattern aman

Untuk command JSON:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public Response create(CreateCustomerRequest request) { ... }
```

Untuk upload file:

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(...) { ... }
```

Jangan gabungkan JSON command dan file upload besar tanpa desain boundary jelas.

---

## 7. Incident Class 5 — `No MessageBodyReader Found`

### 7.1. Gejala

```text
MessageBodyProviderNotFoundException: MessageBodyReader not found for media type=application/json, type=class com.company.CreateCustomerRequest
```

### 7.2. Makna runtime

Jersey sudah memilih resource method dan sekarang mencoba membaca body request menjadi Java type. Gagal karena tidak ada `MessageBodyReader` yang cocok.

Provider selection mengacu pada type, generic type, annotation, dan media type. Jakarta REST specification mendefinisikan kontrak provider seperti `MessageBodyReader`, `MessageBodyWriter`, dan exception mapping. Jersey menambahkan API seperti `MessageBodyWorkers` untuk memanipulasi/memilih provider sesuai aturan spec. citeturn572487search1turn572487search2

### 7.3. Penyebab umum

```text
A. JSON provider belum ditambahkan
B. Salah provider antara javax dan jakarta
C. Media type tidak cocok
D. DTO tidak bisa dibuat/deserialized
E. Generic type hilang
F. Provider custom kalah priority
G. Auto discovery dimatikan
H. Dependency conflict menghasilkan provider tidak aktif
```

### 7.4. Contoh dependency mismatch

Jersey 3/4 memakai `jakarta.ws.rs.*`, tetapi aplikasi masih membawa provider lama berbasis `javax.ws.rs.*`.

Efeknya:

```text
compile bisa lolos di module tertentu,
runtime provider tidak dikenali,
body reader/writer tidak ditemukan,
atau ClassCastException/NoSuchMethodError muncul.
```

### 7.5. Debugging checklist

```text
1. Jersey major version berapa?
2. Namespace API: javax atau jakarta?
3. JSON provider apa: Jackson, JSON-B, MOXy?
4. Provider terdaftar explicit atau auto-discovered?
5. Media type actual apa?
6. Type yang dibaca apa?
7. DTO punya constructor/creator yang valid?
8. Apakah ada custom reader yang mengambil alih?
```

### 7.6. Diagnostic endpoint untuk non-production

```java
@Path("/__diag/providers")
public class ProviderDiagnosticResource {
    @Context
    Providers providers;

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String inspect() {
        MessageBodyReader<?> reader = providers.getMessageBodyReader(
            CreateCustomerRequest.class,
            CreateCustomerRequest.class,
            new Annotation[0],
            MediaType.APPLICATION_JSON_TYPE
        );
        return "reader=" + reader;
    }
}
```

Catatan: jangan expose diagnostic endpoint semacam ini ke public production.

---

## 8. Incident Class 6 — `No MessageBodyWriter Found`

### 8.1. Gejala

Resource method berhasil mengembalikan object:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CustomerDto get() {
    return new CustomerDto(...);
}
```

Tetapi response gagal:

```text
MessageBodyWriter not found for media type=application/json, type=class com.company.CustomerDto
```

### 8.2. Makna runtime

Resource method sudah selesai. Failure terjadi di response write stage.

### 8.3. Penyebab umum

- JSON provider tidak tersedia;
- return type terlalu generic tanpa `GenericEntity`;
- media type tidak cocok;
- response entity berupa type yang tidak didukung;
- streaming entity sudah tertutup;
- custom writer salah `isWriteable`;
- DTO mengandung field yang tidak bisa diserialize;
- lazy proxy JPA bocor ke response;
- circular reference;
- Java record/sealed type butuh module/provider support yang sesuai.

### 8.4. Generic type trap

Buruk:

```java
@GET
public Response list() {
    List<CustomerDto> customers = service.list();
    return Response.ok(customers).build();
}
```

Kadang provider masih bisa menulis, tetapi generic information bisa hilang dalam skenario tertentu.

Lebih eksplisit:

```java
@GET
public Response list() {
    List<CustomerDto> customers = service.list();
    GenericEntity<List<CustomerDto>> entity =
        new GenericEntity<List<CustomerDto>>(customers) {};
    return Response.ok(entity).build();
}
```

### 8.5. Lazy proxy trap

Buruk:

```java
@GET
public OrderEntity getOrder(...) {
    return repository.find(...);
}
```

Risiko:

- lazy relation diakses saat serialization;
- transaction sudah tertutup;
- infinite recursion;
- field internal entity terekspos;
- serialization performa buruk.

Lebih aman:

```java
@GET
public OrderDto getOrder(...) {
    Order order = service.getOrder(...);
    return mapper.toDto(order);
}
```

---

## 9. Incident Class 7 — JSON Serialization Failure

### 9.1. Gejala

Status response `500`, stack trace menunjukkan Jackson/JSON-B/MOXy error:

```text
JsonMappingException
InvalidDefinitionException
LazyInitializationException
StackOverflowError
```

### 9.2. Diagnosis stage

Ini bukan routing issue. Ini response entity write issue.

### 9.3. Penyebab umum

```text
Circular reference
Lazy JPA proxy
Unsupported Java time type
Record creator issue
Unknown polymorphic subtype
Getter throws exception
Field visibility unexpected
Entity exposed directly
DTO contains InputStream/resource handle
```

### 9.4. Defensive design

Resource tidak boleh mengembalikan persistence entity langsung untuk public API.

```text
Persistence entity -> domain/service -> API DTO -> JSON provider
```

DTO harus didesain sebagai serialization contract, bukan kebetulan bentuk object internal.

### 9.5. Production checklist

```text
Apakah entity JPA bocor?
Apakah mapper sudah eager mengambil field yang dibutuhkan?
Apakah Java time module/config tersedia?
Apakah circular relation diputus di DTO?
Apakah polymorphism explicit dan aman?
Apakah error mapper menangkap serialization failure?
Apakah response sudah committed sebelum failure?
```

Jika response streaming sudah mulai dikirim, error mapper mungkin tidak bisa lagi mengganti response dengan clean JSON error.

---

## 10. Incident Class 8 — Request Body Already Consumed

### 10.1. Gejala

Resource menerima DTO kosong, atau body reader gagal karena stream sudah habis.

Penyebab umum:

```java
public class LoggingFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) throws IOException {
        String body = new String(ctx.getEntityStream().readAllBytes(), UTF_8);
        log.info(body);
        // lupa mengembalikan stream
    }
}
```

### 10.2. Mental model

Request body adalah stream. Sekali dibaca, cursor maju. Jika filter membaca stream dan tidak menggantinya, `MessageBodyReader` downstream tidak punya data lagi.

### 10.3. Fix pattern

```java
byte[] bytes = ctx.getEntityStream().readAllBytes();
String safePreview = maskAndTruncate(bytes);
log.debug("requestBodyPreview={}", safePreview);
ctx.setEntityStream(new ByteArrayInputStream(bytes));
```

Tetapi pattern ini berbahaya untuk body besar. Untuk production:

```text
small JSON only
max capture size
masking wajib
feature flag
jangan untuk multipart/file upload
jangan untuk PII/secret
```

### 10.4. Better strategy

Daripada log full body, log:

```text
correlationId
method
path template
status
latency
contentLength
contentType
principal/tenant safe identifier
errorCode
```

Body logging harus exception, bukan default.

---

## 11. Incident Class 9 — `ExceptionMapper` Tidak Terpanggil

### 11.1. Gejala

Kamu punya mapper:

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    @Override
    public Response toResponse(DomainException e) { ... }
}
```

Tetapi production tetap mengembalikan generic `500`.

### 11.2. Penyebab umum

```text
A. Mapper tidak terdaftar
B. Exception dibungkus exception lain
C. Exception terjadi sebelum Jersey pipeline
D. Exception terjadi setelah response committed
E. Mapper generic mengambil alih secara tidak diharapkan
F. Mapper throw exception
G. Namespace mismatch javax/jakarta
H. Container-level error page override
```

Jakarta REST mensyaratkan runtime memilih exception mapping provider dengan generic type terdekat terhadap exception yang terjadi; jika mapper sendiri gagal saat membuat response, runtime mengembalikan server error. citeturn572487search1

### 11.3. Wrapper exception trap

Service throw:

```java
throw new DomainException("CUSTOMER_NOT_FOUND");
```

Tetapi transaction/proxy layer membungkus:

```text
EJBException
CompletionException
ExecutionException
UndeclaredThrowableException
```

Mapper untuk `DomainException` tidak match karena actual thrown exception berbeda.

### 11.4. Fix pattern

Gunakan mapper untuk wrapper umum secara hati-hati:

```java
@Provider
public class CompletionExceptionMapper implements ExceptionMapper<CompletionException> {
    @Override
    public Response toResponse(CompletionException e) {
        Throwable root = unwrap(e);
        if (root instanceof DomainException de) {
            return mapDomain(de);
        }
        return serverError(root);
    }
}
```

Namun jangan membuat mapper `Throwable` yang menyembunyikan semua bug tanpa logging.

### 11.5. Mapper observability

Setiap mapper harus log minimal:

```text
correlationId
exceptionClass
mappedStatus
errorCode
resourceMethod/path if available
rootCauseClass
```

Dan tidak boleh mengembalikan stack trace ke client.

---

## 12. Incident Class 10 — Filter Priority dan Ordering Salah

### 12.1. Gejala

- audit filter tidak melihat principal;
- authorization berjalan sebelum authentication;
- correlation ID belum ada saat error mapper log;
- response masking tidak jalan;
- CORS header tidak ada untuk error response.

### 12.2. Penyebab

Filter/interceptor ordering tidak dipahami.

Jersey/Jakarta REST memiliki filters dan interceptors untuk server/client, name binding, dynamic binding, dan priority. Jersey documentation membahas execution order, name binding, dynamic binding, dan priorities sebagai bagian dari pipeline. citeturn572487search19

### 12.3. Recommended ordering mental model

```text
Very early:
  correlation id
  request identity envelope

Authentication:
  parse credential/token/session
  build principal/security context

Authorization:
  role/scope/object access

Request audit pre-stage:
  who attempts what

Entity read/interceptor:
  body processing

Resource method:
  business operation

Response mapping:
  status/entity

Response audit:
  outcome

Response security headers/CORS:
  final headers
```

### 12.4. Example priority

```java
@Priority(Priorities.AUTHENTICATION - 100)
public class CorrelationIdFilter implements ContainerRequestFilter { ... }

@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter { ... }

@Priority(Priorities.AUTHORIZATION)
public class AuthorizationFilter implements ContainerRequestFilter { ... }
```

### 12.5. Failure mode

Jika audit filter jalan sebelum authentication, audit record akan berisi:

```text
actor=anonymous
```

Padahal request sebenarnya authenticated. Ini bukan sekadar bug log; dalam sistem regulatori, ini bisa merusak evidence trail.

---

## 13. Incident Class 11 — SecurityContext Missing atau Salah

### 13.1. Gejala

Resource:

```java
@Context
SecurityContext securityContext;
```

Tetapi:

```java
securityContext.getUserPrincipal() == null
```

Padahal token valid.

### 13.2. Penyebab umum

```text
Authentication filter tidak terdaftar
Filter order salah
Filter tidak memanggil setSecurityContext
Request aborted sebelum context dibuat
Container security dan Jersey security tidak bridge
Async flow kehilangan context
ThreadLocal custom identity tidak propagate
Test bypass filter
```

### 13.3. Correct pattern

```java
ctx.setSecurityContext(new SecurityContext() {
    @Override
    public Principal getUserPrincipal() {
        return principal;
    }

    @Override
    public boolean isUserInRole(String role) {
        return roles.contains(role);
    }

    @Override
    public boolean isSecure() {
        return ctx.getUriInfo().getRequestUri().getScheme().equals("https");
    }

    @Override
    public String getAuthenticationScheme() {
        return "Bearer";
    }
});
```

### 13.4. Top 1% note

Identity context harus punya **source of truth**. Jangan campur:

```text
SecurityContext principal
ThreadLocal current user
JWT claims object
session attribute
custom header
```

Tanpa ownership jelas. Pilih satu canonical request identity, lalu expose adapter seperlunya.

---

## 14. Incident Class 12 — Injection Failure Saat Startup

### 14.1. Gejala

Startup gagal:

```text
UnsatisfiedDependencyException
MultiException
InjectionManagerFactory not found
A MultiException has 1 exceptions
```

### 14.2. Penyebab umum

```text
HK2 binder tidak register service
Resource dibuat oleh container berbeda dari yang diharapkan
Spring/CDI/HK2 ownership bercampur
Scope salah
Factory throw exception
Constructor injection tidak didukung sesuai setup
Namespace mismatch
Auto-discovery disabled
```

### 14.3. Debugging checklist

```text
1. Siapa yang membuat resource instance?
   Jersey/HK2? Spring? CDI? Jakarta EE container?

2. Service yang diinject milik container mana?

3. Binder/bridge module sudah ada?

4. Scope service apa?

5. Apakah dependency dibuat saat startup atau lazy?

6. Apakah classpath membawa jersey-hk2 yang sesuai?
```

### 14.4. Anti-pattern

```java
@Path("/orders")
@Component
public class OrderResource {
    @Inject // jakarta inject?
    private OrderService service;

    @Autowired // Spring?
    private AuditService audit;
}
```

Ini bukan selalu salah secara teknis, tetapi sangat rawan jika ownership tidak jelas.

### 14.5. Better rule

```text
Resource lifecycle owner: one container only.
Service lifecycle owner: one container only.
Bridge explicitly.
Do not rely on accidental scanning.
```

---

## 15. Incident Class 13 — Ambiguous Resource Method

### 15.1. Gejala

Startup warning/error atau runtime method selection aneh.

```java
@GET
@Path("/{id}")
public CustomerDto byId(@PathParam("id") String id) { ... }

@GET
@Path("/{code}")
public CustomerDto byCode(@PathParam("code") String code) { ... }
```

Dua method ini sama-sama match path satu segment.

### 15.2. Penyebab

Resource model ambiguity. Nama path parameter tidak membedakan path template shape.

```text
/{id}
/{code}
```

Keduanya sama dari perspektif matching.

### 15.3. Fix

Buat shape eksplisit:

```java
@GET
@Path("/id/{id}")
public CustomerDto byId(...) { ... }

@GET
@Path("/code/{code}")
public CustomerDto byCode(...) { ... }
```

Atau gunakan regex jika benar-benar perlu:

```java
@Path("/{id: \\d+}")
```

Tetapi regex path yang terlalu pintar sering lebih sulit dipelihara.

---

## 16. Incident Class 14 — Jersey Client Connection Leak

### 16.1. Gejala

Outbound call awalnya normal. Setelah traffic tinggi:

```text
connection pool exhausted
timeout waiting for connection
threads blocked on HTTP client
remote service terlihat sehat
```

### 16.2. Penyebab umum

Response tidak ditutup:

```java
Response response = client.target(url).request().get();
if (response.getStatus() == 200) {
    return response.readEntity(CustomerDto.class);
}
throw new RuntimeException("failed");
```

Jika semua branch tidak menutup response, koneksi bisa tidak kembali ke pool.

### 16.3. Correct pattern

```java
try (Response response = target.request().get()) {
    if (response.getStatus() == 200) {
        return response.readEntity(CustomerDto.class);
    }
    ErrorBody error = safeReadError(response);
    throw mapRemoteError(response.getStatus(), error);
}
```

### 16.4. Client lifecycle trap

Buruk:

```java
public CustomerDto call() {
    Client client = ClientBuilder.newClient();
    return client.target(url).request().get(CustomerDto.class);
}
```

Membuat client per request dapat menghasilkan overhead, pool fragmentation, resource leak.

Lebih baik:

```java
@Singleton
public class CustomerApiClient {
    private final Client client;

    public CustomerApiClient(Client client) {
        this.client = client;
    }
}
```

Client dibuat sebagai shared component, ditutup saat aplikasi shutdown.

---

## 17. Incident Class 15 — Timeout Tidak Dikonfigurasi

### 17.1. Gejala

Thread aplikasi habis saat dependency lambat. Tidak ada error cepat. Latency naik sampai semua request antre.

### 17.2. Penyebab

Outbound HTTP client tanpa timeout eksplisit.

### 17.3. Rule

Setiap outbound dependency harus punya:

```text
connect timeout
read timeout / response timeout
total deadline jika tersedia
pool acquisition timeout
retry budget
circuit breaker / bulkhead untuk dependency kritis
```

### 17.4. Failure amplification

Tanpa timeout:

```text
remote dependency lambat
-> request thread menunggu
-> thread pool habis
-> unrelated endpoint ikut lambat
-> health check gagal
-> orchestrator restart app
-> cold start menambah pressure
```

Ini bukan hanya “client timeout bug”. Ini systemic failure.

---

## 18. Incident Class 16 — Thread Pool Exhaustion

### 18.1. Gejala

- semua endpoint lambat;
- CPU tidak selalu tinggi;
- thread dump menunjukkan banyak thread WAITING/BLOCKED;
- connection pool penuh;
- health check timeout.

### 18.2. Penyebab umum

```text
Blocking outbound calls tanpa timeout
DB pool exhausted
SSE clients terlalu banyak
large file download memakai request thread lama
async response memakai executor kecil/penuh
lock contention
synchronized block lama
virtual thread pinning / ThreadLocal misuse pada Java modern
```

### 18.3. Debugging approach

```text
1. Ambil thread dump berkala, bukan satu kali.
2. Kelompokkan stack trace berdasarkan blocking point.
3. Cocokkan dengan metrics: active request, outbound latency, DB pool, CPU, GC.
4. Tentukan apakah bottleneck CPU, IO, lock, pool, atau downstream.
5. Jangan tambah thread sebelum tahu bottleneck.
```

### 18.4. Symptom vs root cause

Thread pool exhaustion sering symptom, bukan root cause.

```text
Symptom: request threads habis.
Root cause: remote dependency lambat + no timeout + retry storm.
```

---

## 19. Incident Class 17 — SSE / Streaming Resource Leak

### 19.1. Gejala

- memory naik perlahan;
- jumlah open connection naik;
- client disconnect tetapi server masih menyimpan sink;
- broadcaster list membesar;
- proxy timeout memutus koneksi secara massal.

### 19.2. Penyebab umum

```text
SseEventSink tidak dihapus saat close/error
heartbeat tidak ada
proxy buffering/timeout tidak dikonfigurasi
per-client queue tidak dibatasi
producer lebih cepat daripada consumer
broadcast sink lambat memblokir sink lain
```

### 19.3. Defensive pattern

```java
@GET
@Produces(MediaType.SERVER_SENT_EVENTS)
public void stream(@Context SseEventSink sink, @Context Sse sse) {
    clients.add(sink);
    sink.send(sse.newEvent("connected"))
        .whenComplete((ok, err) -> {
            if (err != null || sink.isClosed()) {
                clients.remove(sink);
            }
        });
}
```

Real implementation butuh lifecycle cleanup lebih lengkap.

### 19.4. Operational checklist

```text
max concurrent streams
heartbeat interval
proxy idle timeout
client reconnect backoff
sink cleanup on send failure
per-client queue limit
metrics: open streams, failed sends, dropped events
```

---

## 20. Incident Class 18 — Multipart Temp Disk Full

### 20.1. Gejala

Upload file gagal acak:

```text
No space left on device
Multipart processing failed
Temporary file creation failed
```

### 20.2. Penyebab

Multipart parser/container menyimpan part besar ke temp directory. Jika upload besar/paralel, disk temp habis.

### 20.3. Defensive controls

```text
request size limit
per-file size limit
temp directory dedicated
disk quota monitoring
early reject by Content-Length if available
streaming scanner
delete temp file on all branches
avoid reading full file into byte[]
```

### 20.4. Security checklist

```text
filename sanitize
MIME sniffing not only header trust
extension whitelist if needed
hash calculation
antivirus scan
zip bomb protection
path traversal prevention
audit upload metadata
```

---

## 21. Incident Class 19 — Wrong Base URI Behind Proxy

### 21.1. Gejala

Response link salah:

```json
{
  "self": "http://internal-service:8080/api/orders/123"
}
```

Padahal public URL:

```text
https://api.company.com/orders/123
```

### 21.2. Penyebab

`UriInfo` membangun URI dari request yang diterima aplikasi internal, bukan public URL, jika forwarded headers tidak diproses dengan benar.

### 21.3. Debugging checklist

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
Forwarded header
gateway path rewrite
container proxy configuration
Jersey/base URI configuration
absolute vs relative link decision
```

### 21.4. Better design

Untuk public API, tentukan policy:

```text
Use relative links when possible
or configure publicBaseUrl explicitly
or correctly trust forwarded headers only from known proxy
```

Jangan blindly trust `X-Forwarded-*` dari internet-facing request tanpa trusted proxy boundary.

---

## 22. Incident Class 20 — `javax` / `jakarta` Classpath Collision

### 22.1. Gejala

Setelah migrasi:

```text
ClassNotFoundException: javax.ws.rs.core.Response
NoClassDefFoundError: jakarta/ws/rs/core/Response
ClassCastException
NoSuchMethodError
LinkageError
provider not found
filter not invoked
```

### 22.2. Root cause

Jersey 2 era memakai `javax.ws.rs.*`. Jersey 3/4 era memakai `jakarta.ws.rs.*`. Keduanya bukan package yang sama. Class dengan nama konsep sama tidak kompatibel secara binary.

### 22.3. Debugging checklist

```bash
mvn dependency:tree | grep -E "jersey|javax.ws.rs|jakarta.ws.rs|servlet|validation|json"
```

Periksa:

```text
jersey-server version
jersey-container-* version
jersey-media-* version
jakarta.ws.rs-api version
jakarta.servlet-api version
jakarta.validation-api version
JSON provider version
HK2 version
Spring Boot/Jakarta EE server managed dependencies
```

### 22.4. Migration rule

Jangan migrasi package source code saja. Migrasi dependency graph sebagai satu unit:

```text
Jersey major version
Jakarta REST API
Servlet API
Validation API
JSON provider
container runtime
test framework
custom providers/filters
```

---

## 23. Incident Class 21 — Auto Discovery Surprise

### 23.1. Gejala

Behavior berbeda antara local dan production:

- local memakai Jackson;
- production memakai JSON-B/MOXy;
- filter tambahan tiba-tiba aktif;
- provider custom kalah dari provider transitive dependency;
- startup berubah setelah dependency baru ditambahkan.

### 23.2. Penyebab

Auto discovery dan classpath-sensitive provider registration.

### 23.3. Production recommendation

Untuk aplikasi kritikal:

```text
register important providers explicitly
pin dependency versions
disable or restrict auto discovery jika perlu
log registered features/providers saat startup di non-sensitive form
buat startup validation
```

### 23.4. Startup validation example

```java
public class AppConfig extends ResourceConfig {
    public AppConfig() {
        register(JacksonFeature.class);
        register(ApiExceptionMapper.class);
        register(CorrelationIdFilter.class);

        property("app.expectedJsonProvider", "jackson");
    }
}
```

Kemudian test integration memastikan response JSON shape sesuai.

---

## 24. Incident Class 22 — CORS and Preflight Failure

### 24.1. Gejala

Browser gagal, tetapi Postman/curl berhasil.

Browser console:

```text
CORS policy: No 'Access-Control-Allow-Origin' header
```

Atau preflight:

```http
OPTIONS /api/v1/orders
```

mendapat `404`/`405`/`401`.

### 24.2. Diagnosis

Ini sering bukan resource method bug. Browser mengirim preflight `OPTIONS` sebelum actual request jika method/header tertentu digunakan.

### 24.3. Failure modes

```text
OPTIONS tidak ditangani
auth filter menolak OPTIONS tanpa CORS header
error response tidak diberi CORS header
allowed headers tidak mencakup Authorization/Content-Type/custom header
allowed methods tidak mencakup method actual
gateway dan app sama-sama menambah CORS berbeda
```

### 24.4. Correct ordering

CORS response header sebaiknya tetap ada untuk error response yang relevan. Authentication filter harus sadar preflight policy.

```text
preflight CORS handling
then authentication for actual request
```

Namun jangan membuat CORS terlalu permisif untuk endpoint sensitif.

---

## 25. Incident Class 23 — Validation Error Shape Tidak Konsisten

### 25.1. Gejala

Request invalid kadang mengembalikan:

```json
{"errors":[...]}
```

Kadang:

```html
<html>...</html>
```

Kadang:

```json
{"message":"Internal Server Error"}
```

### 25.2. Penyebab

```text
ConstraintViolationException dari Jersey validation
ConstraintViolationException dari JPA flush
JsonMappingException saat body parse
Param conversion exception
Domain validation exception
Database constraint exception
```

Mereka terjadi di stage berbeda.

### 25.3. Strategy

Buat taxonomy:

```text
REQUEST_PARSE_ERROR
REQUEST_PARAMETER_INVALID
REQUEST_BODY_INVALID
DOMAIN_INVARIANT_VIOLATION
PERSISTENCE_CONSTRAINT_VIOLATION
```

Lalu mapper masing-masing mengembalikan error contract konsisten.

---

## 26. Incident Class 24 — Response Already Committed

### 26.1. Gejala

Exception terjadi, tetapi client menerima partial response atau koneksi putus.

### 26.2. Penyebab

Response sudah mulai dikirim sebelum error:

```text
StreamingOutput throw setelah menulis sebagian data
SSE send gagal setelah beberapa event
large download source error di tengah stream
writer interceptor error setelah commit
```

### 26.3. Consequence

Setelah response committed, Jersey tidak selalu bisa mengganti response menjadi clean JSON error. Error mapper mungkin tidak berguna di titik ini.

### 26.4. Design implication

Untuk streaming/download:

```text
validasi authorization sebelum stream mulai
validasi file/source existence sebelum write
set header setelah yakin
log stream failure server-side
client harus bisa handle truncated stream
checksum/Content-Length jika memungkinkan
```

---

## 27. Incident Class 25 — Test Lolos, Production Gagal

### 27.1. Gejala

Unit test hijau, tetapi runtime gagal:

```text
filter tidak jalan
exception mapper tidak jalan
provider missing
security context null
validation berbeda
```

### 27.2. Penyebab

Test memanggil resource class langsung:

```java
CustomerResource resource = new CustomerResource(service);
resource.create(request);
```

Ini tidak melewati:

```text
Jersey resource matching
parameter injection
body reader
validation integration
filters
interceptors
exception mappers
body writer
```

### 27.3. Testing strategy

Gunakan beberapa level:

```text
Unit test: domain/service logic
Resource unit test: thin boundary logic
Jersey runtime test: filter/provider/mapper/validation/matching
Contract test: JSON shape and status
Failure test: invalid body, invalid media type, auth failure, downstream timeout
```

---

## 28. Incident Debugging Workflow End-to-End

Saat ada incident Jersey, gunakan workflow ini.

### Step 1 — Identifikasi origin response

```text
Apakah response dari gateway, container, Jersey, mapper, resource, atau dependency?
```

Cari:

```text
correlation ID
server header
error code shape
access log
application log
gateway log
trace span
```

### Step 2 — Tentukan stage terakhir yang berhasil

```text
Reached gateway?
Reached container?
Reached pre-matching filter?
Matched resource?
Read entity?
Entered resource method?
Called service?
Called dependency?
Mapped exception?
Wrote response?
Returned to client?
```

### Step 3 — Cocokkan status code dengan stage

```text
404 -> path/mapping/resource/gateway
405 -> method selection
406 -> Accept/@Produces
415 -> Content-Type/@Consumes/body reader
400 -> parse/param/validation
401 -> authentication
403 -> authorization
409 -> conflict/domain concurrency
422 -> semantic validation if used
500 -> internal/unmapped/mapper failure/provider write
503 -> dependency/circuit/bulkhead/maintenance
504 -> gateway/upstream timeout
```

### Step 4 — Ambil evidence minimal

```text
request method
public URL
internal URL if known
headers: Content-Type, Accept, Authorization presence only, correlation id
status code
response body shape
resource method expected
application version/build hash
dependency versions
thread dump if latency
heap/GC if memory
connection pool metrics if outbound
```

### Step 5 — Reproduce dengan curl

Gunakan curl untuk menghilangkan browser/client noise:

```bash
curl -i \
  -X POST 'https://api.company.com/api/v1/customers' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -H 'X-Correlation-Id: debug-123' \
  --data '{"name":"Alice"}'
```

Untuk CORS, test preflight:

```bash
curl -i \
  -X OPTIONS 'https://api.company.com/api/v1/customers' \
  -H 'Origin: https://app.company.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Authorization, Content-Type'
```

### Step 6 — Jangan patch sebelum tahu stage

Contoh patch salah:

```text
Problem: 415 karena client Content-Type salah.
Patch salah: menambahkan @Consumes("*/*").
```

Efeknya contract API jadi longgar, error pindah ke JSON parser, dan client bug tersembunyi.

---

## 29. Production Diagnostic Toolkit

### 29.1. Startup diagnostics

Saat startup, log aman:

```text
application name/version
Jersey version
Jakarta REST API version
Java version
active profile
registered major features
JSON provider strategy
servlet mapping/application path
important config flags
```

Jangan log secret.

### 29.2. Request diagnostics

Untuk setiap request:

```text
timestamp
correlationId
method
path template, not only raw path
status
latency
response size if available
principal/tenant safe id
error code
exception class for 5xx server-side only
```

### 29.3. Provider diagnostics

Test/integration check:

```text
Can read JSON request DTO?
Can write JSON response DTO?
Can map validation error?
Can map domain error?
Can handle unknown field policy?
Can handle Java time field?
```

### 29.4. Outbound diagnostics

For Jersey Client:

```text
dependency name
method
URI template, not full sensitive URL
status
latency
timeout type
retry count
circuit state
pool stats
error class
```

---

## 30. Failure Mode Matrix

| Symptom | Likely Stage | Common Root Cause | First Evidence |
|---|---|---|---|
| 404 | Gateway/servlet/resource matching | wrong base path, unregistered resource | access log + pre-matching filter |
| 405 | method selection | wrong HTTP verb, missing method annotation | Allow header |
| 406 | response negotiation | Accept incompatible with `@Produces` | Accept + `@Produces` |
| 415 | request media negotiation | Content-Type incompatible with `@Consumes` | Content-Type + `@Consumes` |
| body DTO null | entity read/filter | stream consumed or bad provider | body logging filter, reader logs |
| writer not found | response write | missing provider/generic type/provider conflict | return type + media type |
| mapper not called | exception mapping | exception wrapped/not registered/committed | actual exception class |
| principal null | security context | auth filter missing/order/bridge issue | filter order logs |
| pool exhausted | outbound client | response not closed/no timeout | pool metrics + code review |
| all endpoints slow | thread/pool/dependency | downstream latency/DB pool/lock | thread dump + metrics |
| partial response | streaming | error after commit | client truncation + server log |
| only browser fails | CORS | preflight/header policy | OPTIONS curl |
| local works prod fails | config/classpath | auto discovery/dependency drift | dependency tree/startup diagnostics |
| after migration fails | namespace/binary | javax/jakarta mismatch | dependency tree + stack trace |

---

## 31. Advanced Debugging: Mapping Runtime Stage to Code Location

### 31.1. Pre-resource failure

Examples:

```text
404
405
406
415
param conversion error
body reader error
request filter abort
```

Resource method log absent does not mean request never arrived.

### 31.2. In-resource failure

Examples:

```text
domain exception
authorization inside service
transaction error
DB error
remote dependency error
```

Resource method log present, service log may show root cause.

### 31.3. Post-resource failure

Examples:

```text
MessageBodyWriter not found
JSON serialization failure
WriterInterceptor failure
streaming failure
response filter failure
```

Resource method completed, but response failed.

This category is often underdiagnosed because developers assume “method returned object” means success.

---

## 32. Design Patterns That Prevent Incidents

### 32.1. Explicit boundary registration

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CorrelationIdFilter.class);
        register(AuthenticationFilter.class);
        register(ApiExceptionMapper.class);
        register(JsonMappingExceptionMapper.class);
        register(CustomerResource.class);
        register(OrderResource.class);
    }
}
```

### 32.2. Stable error envelope

```json
{
  "errorCode": "REQUEST_BODY_INVALID",
  "message": "Request body is invalid.",
  "correlationId": "...",
  "details": []
}
```

### 32.3. Resource as thin adapter

```text
HTTP/Jersey concerns:
  params, headers, security context, response status

Service/domain concerns:
  business operation, transaction, invariants

Mapper concerns:
  DTO <-> command/result
```

### 32.4. No persistence entity in public response

```text
Entity -> DTO only
```

### 32.5. Outbound client wrapper

```text
Jersey Client raw API should be hidden behind typed dependency client.
All timeout/retry/error mapping centralized.
```

### 32.6. Failure-first tests

Test not only happy path:

```text
wrong method
wrong content type
wrong accept
invalid JSON
unknown field
missing auth
forbidden role
downstream timeout
provider missing regression
mapper regression
```

---

## 33. Java 8–25 Considerations for Production Debugging

### 33.1. Java 8

Risks:

```text
older TLS defaults
older GC ergonomics
limited modern diagnostics
legacy javax stack common
thread-per-request pressure more severe
```

Use:

```text
jstack
jmap carefully
GC logs
Maven dependency tree
explicit timeouts
```

### 33.2. Java 11/17

Benefits:

```text
better TLS/runtime defaults
better container awareness
Flight Recorder more accessible
modern GC options
Jakarta migration often begins here
```

### 33.3. Java 21

Virtual threads become production feature via JEP 444. They help with blocking IO concurrency, but do not remove need for timeout, bulkhead, or connection pool discipline.

Watch:

```text
ThreadLocal/MDC propagation
synchronized pinning
container support
library compatibility
blocking DB/HTTP client pools
```

### 33.4. Java 25

Java 25 is relevant as modern LTS context. For Jersey production debugging, the main implication is not “rewrite everything”, but:

```text
refresh runtime diagnostics
revisit GC/logging/JFR practice
verify container/Jersey compatibility
verify jakarta stack alignment
modernize test and migration pipeline
```

---

## 34. Incident Postmortem Template for Jersey Systems

Use this structure after a Jersey incident:

```text
1. Summary
   What failed from user/client perspective?

2. Timeline
   First bad signal, detection, mitigation, recovery.

3. Impact
   Which endpoints, clients, tenants, operations affected?

4. Runtime Stage
   Gateway / container / Jersey matching / provider / resource / dependency / response write.

5. Root Cause
   Technical cause, not only symptom.

6. Contributing Factors
   Missing timeout, ambiguous config, lack of test, weak observability, dependency drift.

7. Detection Gap
   Why did monitoring not catch earlier?

8. Prevention
   Code fix, config fix, test, alert, dashboard, runbook.

9. Defensibility
   Was audit trail complete? Were error messages safe? Was data consistency affected?
```

For regulatory/case-management systems, always add:

```text
Did any user action become partially applied?
Was any decision made without complete audit evidence?
Was any notification/email/file generated twice or missed?
Was any authorization decision incorrect?
```

---

## 35. Practical Runbooks

### 35.1. Runbook: 404 after deployment

```text
1. Check gateway route deployment.
2. Check app health and version.
3. Curl internal service path directly.
4. Check servlet mapping/application path.
5. Check ResourceConfig registration.
6. Enable pre-matching path log temporarily.
7. Compare old/new package scan or explicit resources.
8. Check dependency namespace if migration happened.
```

### 35.2. Runbook: sudden 415 spike

```text
1. Inspect Content-Type from real failed requests.
2. Check recent frontend/client release.
3. Check gateway/header transformation.
4. Check @Consumes changes.
5. Check JSON provider dependency changes.
6. Reproduce with curl.
7. Add contract test for media type.
```

### 35.3. Runbook: endpoint latency spike

```text
1. Separate queue time vs processing time if possible.
2. Check active request count.
3. Check thread pool and thread dumps.
4. Check outbound dependency latency.
5. Check DB pool.
6. Check GC pause/allocation rate.
7. Check serialization payload size.
8. Check retries causing amplification.
```

### 35.4. Runbook: Jersey Client pool exhausted

```text
1. Check connection pool metrics.
2. Search code for Response without try-with-resources.
3. Check readEntity branches.
4. Check exception branch closure.
5. Check client singleton lifecycle.
6. Check timeout configuration.
7. Check retry storm.
8. Add integration test with many calls.
```

### 35.5. Runbook: mapper not invoked

```text
1. Confirm mapper registered.
2. Log actual thrown exception class.
3. Check wrapper exceptions.
4. Check if exception happens outside Jersey pipeline.
5. Check if response already committed.
6. Check generic mapper priority/nearest superclass.
7. Check mapper itself for exception.
8. Check javax/jakarta mismatch.
```

---

## 36. Exercises

### Exercise 1 — Diagnose status code

For each case, identify stage:

```text
A. GET endpoint returns 406 only when browser calls it.
B. POST endpoint returns 415 only after frontend migration.
C. Resource method log absent, pre-matching filter log present.
D. Resource method returns DTO, but client receives 500 serialization error.
E. Endpoint works for 10 minutes, then outbound calls timeout waiting for pool connection.
```

Expected reasoning:

```text
A. Accept negotiation / @Produces.
B. Content-Type / @Consumes / request body media type.
C. Resource matching/method/media/parameter/entity read before method.
D. MessageBodyWriter/JSON serialization stage.
E. Jersey Client connection leak or pool exhaustion.
```

### Exercise 2 — Fix unsafe logging filter

Given:

```java
public void filter(ContainerRequestContext ctx) throws IOException {
    log.info(new String(ctx.getEntityStream().readAllBytes(), UTF_8));
}
```

Find at least five problems.

Possible answers:

```text
Consumes body stream
No stream reset
Logs sensitive data
No size limit
Breaks multipart/file upload
Allocates entire body
No masking
No feature flag
No content-type guard
```

### Exercise 3 — Design an incident dashboard

Create dashboard panels for Jersey API:

```text
request rate by resource method
latency p50/p95/p99 by resource method
error rate by status/errorCode
active requests
inbound payload size
outbound dependency latency
Jersey Client pool usage
exception mapper count by exception class
serialization failure count
SSE open connections
multipart temp disk usage
```

---

## 37. Key Takeaways

1. Jersey incidents are easiest to solve when you identify the runtime stage first.
2. `404`, `405`, `406`, and `415` are not generic failures; they point to different matching/negotiation stages.
3. `MessageBodyReader` and `MessageBodyWriter` failures mean the resource boundary was reached, but entity conversion failed.
4. Filters and interceptors are powerful but can corrupt stream, identity, audit, or ordering if misused.
5. `ExceptionMapper` only helps if exception occurs within the mappable Jersey pipeline and response is not already committed.
6. Jersey Client must be treated as a managed outbound runtime: reuse client, close response, configure timeout, observe pool.
7. `javax`/`jakarta` mismatch is a common migration failure class, not a random classpath annoyance.
8. Streaming, SSE, multipart, and large payload endpoints need separate operational controls.
9. Tests that instantiate resource classes directly do not prove Jersey runtime behavior.
10. Production-grade Jersey engineering is mostly boundary discipline: path, media, provider, identity, error, lifecycle, and dependency boundaries.

---

## 38. Checklist: Before Calling a Jersey API Production-Ready

```text
[ ] Resource registration deterministic
[ ] Servlet/application path documented
[ ] Error contract stable
[ ] Exception mappers registered and tested
[ ] JSON provider explicit
[ ] Request/response media types tested
[ ] Correlation ID works before auth
[ ] Authentication and authorization order tested
[ ] SecurityContext canonical
[ ] Body logging disabled or strictly guarded
[ ] Jersey Client reused and closed correctly
[ ] Outbound timeout configured
[ ] Retry/circuit/bulkhead policy defined where needed
[ ] Multipart/SSE/streaming endpoints have resource limits
[ ] javax/jakarta dependency tree clean
[ ] Runtime tests cover filters/providers/mappers
[ ] Dashboard can distinguish matching/provider/resource/dependency failures
[ ] Runbooks exist for 404/405/406/415/500/timeout/pool exhaustion
```

---

## 39. Penutup

Part 30 ini menggeser fokus dari “bagaimana memakai Jersey” menjadi “bagaimana membaca Jersey saat sistem gagal”. Ini adalah transisi penting menuju level engineering yang lebih tinggi.

Engineer biasa sering bertanya:

> “Kenapa endpoint saya error?”

Engineer kuat bertanya:

> “Request ini mati di stage mana, siapa yang menghasilkan response, evidence apa yang membuktikan itu, dan boundary mana yang harus diperbaiki agar tidak berulang?”

Itulah perbedaan antara debugging reaktif dan production failure modelling.

---

## 40. Status Series

```text
Part 30 selesai.
Part 31 berikutnya: Architecture Patterns — Jersey as API Boundary in Enterprise Systems.
Part 32 terakhir: Capstone — Building a Production-Grade Jersey Platform Module.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 29 — Migration Engineering: Jersey 2 to 3 to 4, `javax` to `jakarta`, Java 8 to 25](./29-migration-engineering-jersey-2-to-3-to-4-javax-to-jakarta-java-8-to-25.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 31 — Architecture Patterns: Jersey as API Boundary in Enterprise Systems](./31-architecture-patterns-jersey-as-api-boundary-enterprise-systems.md)

</div>