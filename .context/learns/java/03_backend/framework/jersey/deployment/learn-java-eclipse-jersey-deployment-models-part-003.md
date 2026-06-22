# learn-java-eclipse-jersey-deployment-models-part-003

# Part 3 — The Hosting Contract: Bagaimana Request Masuk ke Jersey

> Seri: `learn-java-eclipse-jersey-deployment-models`  
> Part: 003 / 032  
> Topik: kontrak hosting antara HTTP runtime/container dan Jersey runtime  
> Target: Java 8 sampai Java 25, Jersey 2.x / 3.x / 4.x, servlet-based dan embedded deployment  

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membahas **deployment invariants**: aturan yang harus tetap benar di semua model deployment. Part ini masuk satu level lebih dalam: **bagaimana request benar-benar masuk ke Jersey**.

Kalau kita salah memahami alur ini, banyak masalah production akan terlihat seperti masalah business logic, padahal root cause-nya ada di deployment boundary:

- URL sudah benar menurut client, tetapi resource tidak ketemu.
- Response 404 berasal dari servlet container, bukan dari Jersey.
- Filter security berjalan terlalu awal atau terlalu lambat.
- Request body sudah dikonsumsi sebelum masuk resource method.
- Correlation ID hilang saat melewati reverse proxy.
- `UriInfo.getBaseUri()` menghasilkan URL internal, bukan public URL.
- Timeout terjadi di ALB/nginx/Tomcat, bukan di method JAX-RS.
- Health check hijau, tetapi request real traffic gagal karena servlet mapping salah.
- Aplikasi deploy sukses, tetapi resource tidak pernah registered.

Mental model utama part ini:

> Jersey tidak menerima koneksi TCP secara langsung, kecuali lewat hosting runtime yang mengintegrasikannya. Jersey menerima **abstraksi request** yang sudah dibentuk oleh host: servlet container, Grizzly, Jetty, Netty, JDK HTTP Server, atau Jakarta EE server.

Artinya, deployment Jersey selalu punya dua lapisan kontrak:

1. **Host contract**: bagaimana runtime HTTP menerima request dan menyerahkannya ke Jersey.
2. **Jersey contract**: bagaimana Jersey mencocokkan request ke resource method, menjalankan provider/filter/interceptor, membaca entity, dan menulis response.

---

## 1. Definisi: Apa Itu “Hosting Contract”?

Dalam konteks Jersey deployment, **hosting contract** adalah kesepakatan teknis antara:

- HTTP server / servlet container / application server,
- adapter Jersey untuk environment tersebut,
- Jersey server runtime,
- aplikasi JAX-RS/Jakarta REST milik kita.

Kontrak ini menjawab pertanyaan:

1. Siapa yang membuka port?
2. Siapa yang menerima koneksi TCP?
3. Siapa yang parsing HTTP request?
4. Siapa yang membuat object request internal?
5. Siapa yang menentukan context path dan servlet path?
6. Siapa yang menjalankan filter sebelum Jersey?
7. Kapan Jersey mulai memproses request?
8. Bagaimana URI diterjemahkan menjadi resource method?
9. Siapa yang membaca request body?
10. Siapa yang menulis response body?
11. Siapa yang melakukan commit response?
12. Siapa yang mengelola lifecycle startup/shutdown?
13. Siapa yang bertanggung jawab terhadap timeout, thread, dan koneksi?

Jersey sendiri adalah implementasi JAX-RS/Jakarta REST. Ia menyediakan resource matching, request pipeline, provider model, entity conversion, exception mapping, filters, interceptors, injection integration, dan runtime application model. Tetapi Jersey membutuhkan “host” agar bisa menerima request HTTP.

Dokumentasi Jersey sendiri menjelaskan bahwa aplikasi Jersey dapat dijalankan pada berbagai server environment, mulai dari lightweight HTTP containers sampai full Java/Jakarta EE servers, dan cara publikasi aplikasi bergantung pada apakah aplikasi berjalan di Java SE environment atau container environment.

---

## 2. Diagram Mental: Request Masuk ke Jersey

Secara umum, request production melewati jalur seperti ini:

```text
Client
  |
  | HTTP/HTTPS
  v
Edge / Load Balancer / Reverse Proxy
  |
  | forwarded HTTP
  v
HTTP Runtime / Servlet Container / Embedded Server
  |
  | environment-specific request object
  v
Jersey Container Adapter
  |
  | Jersey internal request context
  v
Jersey Runtime
  |
  | resource matching + provider pipeline
  v
Resource Method
  |
  | return value / response object / stream
  v
Jersey Runtime
  |
  | response filters + writer interceptors + MessageBodyWriter
  v
Host Runtime
  |
  | commit response
  v
Client
```

Ada beberapa boundary penting:

```text
[network boundary]
Client -> Load Balancer -> Host runtime

[container boundary]
Host runtime -> Jersey adapter

[jax-rs boundary]
Jersey adapter -> Jersey runtime -> resource method

[application boundary]
Resource method -> service/domain/data layer
```

Kesalahan diagnosis sering terjadi karena semua error dianggap “Jersey error”. Padahal:

- 400 bisa berasal dari reverse proxy sebelum request masuk JVM.
- 404 bisa berasal dari servlet container sebelum Jersey dipanggil.
- 405 bisa berasal dari Jersey resource matching.
- 413 bisa berasal dari nginx, ALB, servlet container, atau Jersey/entity provider.
- 415 biasanya berasal dari Jersey saat tidak ada `MessageBodyReader` cocok.
- 500 bisa berasal dari resource method, provider, DI runtime, atau container listener.
- Timeout bisa berasal dari client, LB, proxy, servlet thread pool, DB pool, atau async timeout.

Top-tier engineer tidak hanya melihat status code. Ia bertanya:

> Di boundary mana request mati?

---

## 3. Jersey Bukan HTTP Server: Ini Kesalahan Mental Model yang Umum

Kesalahan umum:

> “Saya deploy Jersey, berarti Jersey yang listen port 8080.”

Lebih akurat:

> Runtime host yang listen port. Jersey hanya mengambil alih setelah host menyerahkan request ke adapter Jersey.

Contoh:

| Deployment Model | Yang listen port | Yang menyerahkan request ke Jersey |
|---|---:|---|
| WAR di Tomcat | Tomcat connector | Servlet mapping ke `ServletContainer` |
| WAR di Jetty | Jetty connector | Servlet handler/context |
| Payara/GlassFish | Application server | Jakarta REST/Jersey integration |
| Embedded Grizzly | Grizzly HTTP server | Jersey Grizzly container adapter |
| Embedded Jetty | Jetty server | Servlet container / handler registration |
| JDK HTTP Server | JDK HTTP server | Jersey JDK HTTP container adapter |
| Netty | Netty channel/event loop | Jersey Netty container adapter |
| Docker | tetap app runtime di container | Docker hanya packaging/process isolation |
| Kubernetes | Service/Ingress/Pod networking | aplikasi di dalam pod tetap host runtime |

Docker dan Kubernetes bukan hosting contract JAX-RS. Mereka adalah operational hosting layer. Di dalam container/pod tetap ada Tomcat/Jetty/Grizzly/Netty/Jakarta EE runtime.

---

## 4. Dua Mode Besar: Container Environment vs Java SE Environment

Jersey deployment secara konseptual terbagi menjadi dua keluarga besar.

### 4.1 Container Environment

Aplikasi berjalan di dalam container yang sudah ada, misalnya:

- Servlet container: Tomcat, Jetty.
- Jakarta EE server: GlassFish, Payara, Open Liberty, WildFly.
- Web profile/full profile runtime.

Ciri-ciri:

```text
Container starts first
  -> container discovers/deploys application
  -> container creates servlet/context/application model
  -> Jersey is initialized inside container
  -> requests are routed through container mapping
```

Konsekuensi:

- Container mengontrol port, connector, thread pool, TLS, session, filter chain, context path.
- Aplikasi dikemas sebagai WAR atau deployment unit container-specific.
- Banyak dependency sebaiknya `provided`, terutama API yang sudah dimiliki container.
- Classloader isolation dan library conflict menjadi isu penting.
- Lifecycle aplikasi mengikuti lifecycle container.

### 4.2 Java SE Environment

Aplikasi menjalankan host HTTP sendiri melalui `main()`.

Contoh:

```java
public final class Main {
    public static void main(String[] args) {
        ResourceConfig config = new ResourceConfig()
            .packages("com.example.api");

        // host runtime dibuat oleh aplikasi
        // lalu Jersey ditempelkan ke host tersebut
    }
}
```

Ciri-ciri:

```text
Application main starts first
  -> application creates HTTP server
  -> application registers Jersey ResourceConfig
  -> HTTP server listens on port
  -> requests are adapted into Jersey runtime
```

Konsekuensi:

- Aplikasi mengontrol port, lifecycle, shutdown hook, TLS, thread pool, config, logging bootstrap.
- Packaging sering berupa executable jar, distribution zip, atau container image.
- Dependency harus lengkap di aplikasi.
- Tidak ada servlet descriptor kecuali memakai embedded servlet container.
- Cocok untuk microservice atau lightweight runtime, tetapi tanggung jawab operasional lebih banyak di aplikasi.

---

## 5. Kontrak Request pada Servlet Deployment

Servlet deployment adalah model paling umum untuk Jersey enterprise.

Simplified flow:

```text
Client
  -> connector receives bytes
  -> servlet container parses HTTP
  -> container selects web application by host/context path
  -> container applies filters
  -> container selects servlet mapping
  -> Jersey ServletContainer invoked
  -> Jersey maps path to resource method
```

### 5.1 Context Path, Servlet Path, Path Info

Dalam servlet environment, URI tidak langsung menjadi JAX-RS resource path. URI dipecah oleh container.

Misal request:

```text
GET https://api.example.com/aceas/api/cases/123?expand=owner
```

Kemungkinan decomposition:

```text
scheme        = https
host          = api.example.com
context path  = /aceas
servlet path  = /api
path info     = /cases/123
query string  = expand=owner
```

Jersey biasanya akan melakukan resource matching terhadap path yang relevan setelah context/servlet mapping dipotong.

Kalau mapping berubah, resource path yang dilihat Jersey juga berubah.

Contoh resource:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public Response getCase(@PathParam("id") String id) {
        return Response.ok().build();
    }
}
```

Resource ini cocok terhadap:

```text
/cases/123
```

Bukan selalu cocok terhadap full external URL:

```text
/aceas/api/cases/123
```

Karena `/aceas` dan `/api` bisa jadi sudah dimakan oleh context path dan servlet path.

### 5.2 Mental Model Servlet Mapping

Jika WAR punya context path `/app`, lalu Jersey servlet mapping `/api/*`, dan resource `@Path("/users")`, maka endpoint efektif:

```text
/app/api/users
```

Bukan:

```text
/users
/app/users
/api/app/users
```

Rumus mental:

```text
external path = context path + servlet mapping prefix + resource path
```

Dengan catatan reverse proxy bisa menambah/menghapus prefix lagi.

### 5.3 ServletContainer sebagai Adapter

Pada servlet deployment, Jersey `ServletContainer` adalah adapter antara Servlet API dan Jersey runtime.

Ia bertugas kira-kira untuk:

- menerima `HttpServletRequest` dan `HttpServletResponse`,
- membuat Jersey request context,
- menentukan base URI dan request URI,
- meneruskan method/path/header/entity ke Jersey,
- membiarkan Jersey melakukan matching dan invocation,
- menulis hasil Jersey ke servlet response.

Jadi saat kita menulis:

```xml
<servlet>
    <servlet-name>Jersey REST Service</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jersey.config.server.provider.packages</param-name>
        <param-value>com.example.api</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>Jersey REST Service</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Yang terjadi bukan “Tomcat menjalankan resource langsung”. Tomcat menjalankan servlet Jersey, lalu Jersey menjalankan resource.

---

## 6. Kontrak Request pada Filter Deployment

Jersey juga bisa dipasang sebagai servlet filter.

Flow-nya berubah:

```text
Client
  -> servlet container
  -> filter chain begins
  -> Jersey filter may handle request
  -> if not handled, continue chain
  -> static resource / servlet lain / fallback
```

Filter model berguna saat:

- ingin Jersey berada di tengah filter chain tertentu,
- ingin coexist dengan static content atau servlet lain,
- ingin mapping lebih fleksibel,
- ingin semua request melewati filter tertentu sebelum/atau sesudah Jersey.

Tetapi risikonya lebih tinggi:

- ordering filter bisa salah,
- request body bisa dibaca filter lain sebelum Jersey,
- security filter bisa tidak protect endpoint tertentu,
- Jersey bisa “menelan” request yang seharusnya diteruskan,
- fallback static resource bisa menghasilkan 404 yang membingungkan,
- CORS/preflight bisa ditangani oleh layer yang salah.

### 6.1 Filter Chain Ordering

Contoh urutan yang sering masuk akal:

```text
CorrelationIdFilter
  -> ForwardedHeaderFilter
  -> SecurityFilter
  -> RequestLoggingFilter
  -> JerseyFilter
  -> Compression/ResponseFilter
```

Tetapi tidak selalu. Misalnya compression biasanya di response layer container/proxy, bukan di aplikasi. Security bisa berada di proxy, servlet filter, atau JAX-RS filter. Yang penting: ownership-nya eksplisit.

### 6.2 Request Body Consumption Problem

Filter yang membaca body sebelum Jersey dapat merusak entity stream.

Anti-pattern:

```java
public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
    String body = new String(request.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    log.info("body={}", body);
    chain.doFilter(request, response);
}
```

Masalah:

- body stream bisa habis,
- `MessageBodyReader` Jersey menerima stream kosong,
- request JSON valid berubah menjadi 400/EOF,
- file upload rusak,
- memory meledak untuk payload besar.

Deployment lesson:

> Jangan membuat filter observability/security yang membaca body sembarangan. Kalau harus, gunakan bounded buffering dan wrapper yang benar, atau lakukan logging di Jersey interceptor dengan limit ketat.

---

## 7. Kontrak Request pada Embedded Deployment

Pada embedded deployment, aplikasi membuat server sendiri.

Contoh mental:

```text
main()
  -> load config
  -> create ResourceConfig
  -> create HTTP server
  -> bind ResourceConfig to server
  -> start server
  -> wait until shutdown signal
```

### 7.1 Embedded Grizzly

Flow konseptual:

```text
Grizzly connector
  -> Grizzly HTTP request object
  -> Jersey Grizzly container adapter
  -> Jersey runtime
  -> resource method
```

Kelebihan:

- ringan,
- mudah untuk quickstart/service kecil,
- tidak perlu external servlet container,
- lifecycle eksplisit di kode.

Kompromi:

- aplikasi harus mengatur startup/shutdown sendiri,
- konfigurasi TLS/threading/logging bisa lebih manual,
- beberapa fitur servlet/Jakarta EE tidak tersedia,
- ops model harus dibangun sendiri.

### 7.2 Embedded Jetty

Ada dua pola:

1. Jersey ditempelkan melalui servlet model di embedded Jetty.
2. Jetty menjalankan servlet context seperti mini-container.

Flow:

```text
main()
  -> create Jetty Server
  -> create ServletContextHandler
  -> register Jersey ServletContainer
  -> server.start()
```

Ini mirip WAR deployment, tetapi container-nya dibuat oleh aplikasi.

Kelebihan:

- masih punya servlet semantics,
- cocok untuk executable service,
- konfigurasi Jetty lebih kaya daripada lightweight adapter sederhana.

Trade-off:

- tetap harus mengatur lifecycle,
- packaging dan dependency harus teliti,
- embedded container upgrade menjadi tanggung jawab aplikasi.

### 7.3 JDK HTTP Server

JDK HTTP Server cocok untuk:

- demo,
- internal tool kecil,
- test harness,
- lightweight admin endpoint tertentu.

Tetapi untuk production high-traffic, biasanya perlu hati-hati karena feature operational-nya lebih terbatas dibanding servlet container matang.

### 7.4 Netty

Netty berbeda karena event-loop model. Request tidak boleh sembarang blocking di event loop.

JAX-RS resource method umumnya sering blocking:

- akses database,
- call HTTP downstream,
- baca file,
- serialisasi besar,
- call service legacy.

Jika deployment memakai Netty/event loop, perlu desain offload yang jelas.

Mental rule:

> Event loop runtime bukan otomatis membuat aplikasi JAX-RS menjadi non-blocking. Blocking boundary tetap harus dikelola.

---

## 8. Kontrak Request pada Jakarta EE Managed Deployment

Pada Jakarta EE server, Jersey/Jakarta REST bisa menjadi bagian dari runtime yang lebih luas.

Flow konseptual:

```text
Application server
  -> deploy application
  -> scan Jakarta REST Application/resources/providers
  -> integrate CDI/security/transactions if available
  -> route HTTP request into Jakarta REST runtime
  -> invoke resource under managed context
```

Perbedaannya dari plain servlet deployment:

- CDI bisa menjadi dependency injection utama.
- Security bisa container-managed.
- Transactions bisa container-managed.
- Resources seperti datasource/JMS bisa JNDI/container-managed.
- Metrics/health/config bisa melalui MicroProfile di runtime tertentu.
- Classloading bisa mengikuti aturan application server.

Ini kuat untuk enterprise, tetapi perlu memahami ownership.

Pertanyaan penting:

- Jersey version datang dari server atau aplikasi?
- Jakarta REST API disediakan server atau dibundel aplikasi?
- CDI provider mana yang aktif?
- Apakah resource class dikelola CDI, HK2, atau hybrid?
- Apakah transaction context aktif di resource method?
- Apakah security principal berasal dari container, JWT, atau custom filter?

Jika tidak jelas, bug-nya bisa sangat halus.

---

## 9. Base URI, Request URI, dan Public URI

Salah satu sumber bug deployment terbesar: URI yang dilihat aplikasi bukan URI yang dilihat client.

Misal client memanggil:

```text
https://public.example.com/aceas/api/cases/123
```

Tetapi internal routing:

```text
ALB terminates TLS
  -> forwards HTTP to nginx
  -> nginx strips /aceas
  -> forwards /api/cases/123 to Tomcat
  -> Tomcat context path /app
  -> Jersey mapping /api/*
```

Aplikasi mungkin melihat:

```text
scheme = http
host   = internal-service.default.svc.cluster.local
port   = 8080
path   = /app/api/cases/123
```

Padahal client melihat:

```text
scheme = https
host   = public.example.com
path   = /aceas/api/cases/123
```

Ini berdampak pada:

- `UriInfo.getBaseUri()`,
- generated links,
- `Location` header untuk 201 Created,
- redirect,
- OpenAPI server URL,
- OAuth callback URL,
- CORS origin handling,
- audit log URL,
- absolute URL di email/template.

### 9.1 Forwarded Headers

Reverse proxy biasanya meneruskan informasi public request lewat header:

```text
Forwarded: proto=https;host=public.example.com
X-Forwarded-Proto: https
X-Forwarded-Host: public.example.com
X-Forwarded-Port: 443
X-Forwarded-Prefix: /aceas
X-Forwarded-For: 203.0.113.10
```

Tetapi aplikasi tidak boleh asal percaya header ini dari internet. Header forwarded harus dipercaya hanya jika berasal dari trusted proxy.

Deployment invariant:

> Public URI reconstruction adalah tanggung jawab eksplisit antara proxy, container, dan aplikasi. Jangan biarkan default internal URI bocor ke client.

---

## 10. Resource Matching: Kapan Jersey Mengambil Keputusan?

Setelah request masuk ke Jersey, runtime melakukan matching.

Simplified flow:

```text
HTTP method + path + headers
  -> pre-matching filters
  -> resource class matching
  -> resource method matching
  -> content negotiation
  -> entity provider selection
  -> method invocation
```

Jakarta REST specification memiliki bagian khusus tentang request matching ke resource method. Ini menunjukkan bahwa matching adalah concern JAX-RS/Jakarta REST runtime, bukan servlet container.

### 10.1 Contoh Matching

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public CaseDto get(@PathParam("id") String id) {
        return service.get(id);
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response create(CreateCaseRequest request) {
        CaseDto created = service.create(request);
        return Response.status(Response.Status.CREATED).entity(created).build();
    }
}
```

Request:

```text
GET /cases/123
Accept: application/json
```

Matching sequence:

1. Path `/cases/123` cocok ke resource class `/cases`.
2. Remaining path `/123` cocok ke method `/{id}`.
3. HTTP method `GET` cocok dengan `@GET`.
4. `Accept: application/json` cocok dengan `@Produces(application/json)`.
5. Method dipanggil.
6. Return object ditulis oleh `MessageBodyWriter` JSON.

Request:

```text
POST /cases
Content-Type: text/plain
Accept: application/json
```

Bisa gagal di `@Consumes`, menghasilkan 415 Unsupported Media Type jika tidak ada method/provider cocok untuk content type tersebut.

Request:

```text
PUT /cases/123
```

Bisa menghasilkan 405 jika path cocok tetapi HTTP method tidak cocok.

Request:

```text
GET /unknown
```

Bisa menghasilkan 404 dari Jersey jika request sudah masuk Jersey tetapi tidak ada resource matching.

Namun 404 juga bisa berasal dari servlet container jika request tidak pernah masuk Jersey. Inilah pentingnya boundary diagnosis.

---

## 11. Pre-Matching Filter vs Post-Matching Filter

JAX-RS/Jakarta REST punya filter sebelum dan sesudah resource matching.

### 11.1 Pre-Matching Filter

Pre-matching filter berjalan sebelum resource method dipilih.

Contoh use case:

- normalisasi method override,
- rewrite path internal,
- reject request sangat awal,
- correlation ID injection,
- low-level audit envelope.

Contoh:

```java
@Provider
@PreMatching
public class CorrelationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext context) {
        String id = context.getHeaderString("X-Correlation-Id");
        if (id == null || id.isBlank()) {
            id = UUID.randomUUID().toString();
        }
        context.setProperty("correlationId", id);
    }
}
```

Karena berjalan sebelum matching, perubahan pada method/path/header tertentu bisa memengaruhi resource yang dipilih.

### 11.2 Post-Matching Filter

Post-matching filter berjalan setelah resource method dipilih.

Use case:

- authorization berbasis resource/method annotation,
- name-bound filter,
- business audit,
- method-level metrics,
- policy enforcement.

Contoh:

```java
@Provider
@Secured
public class AuthorizationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext context) {
        // validate principal/role/permission
    }
}
```

Perbedaan ini penting dalam deployment karena filter servlet dan filter JAX-RS tidak berada di boundary yang sama.

```text
Servlet Filter
  -> Jersey PreMatching ContainerRequestFilter
  -> Jersey resource matching
  -> Jersey PostMatching ContainerRequestFilter
  -> Resource method
```

---

## 12. Entity Reading: Siapa yang Membaca Body?

HTTP request body tidak otomatis menjadi Java object. Jersey memilih `MessageBodyReader` berdasarkan:

- Java target type,
- generic type,
- annotations,
- `Content-Type`,
- provider registration,
- provider priority.

Contoh:

```java
@POST
@Consumes(MediaType.APPLICATION_JSON)
public Response submit(CreateCaseRequest request) {
    // request object sudah dibaca dari body JSON
}
```

Runtime mencari provider JSON, misalnya Jackson provider.

Failure umum:

| Gejala | Kemungkinan Penyebab |
|---|---|
| 415 Unsupported Media Type | `Content-Type` tidak cocok / reader tidak tersedia |
| 400 Bad Request | JSON invalid / mapping gagal |
| EOF / empty body | body sudah dibaca filter sebelumnya |
| 500 provider error | dependency JSON provider bentrok |
| works locally, fails in server | container sudah punya provider berbeda |

Deployment-level lesson:

> JSON/XML provider adalah bagian dari deployment contract, bukan sekadar kode resource.

---

## 13. Entity Writing: Siapa yang Menulis Response?

Return value resource method akan ditulis oleh `MessageBodyWriter`.

Contoh:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public CaseDto getCase() {
    return new CaseDto("C-001");
}
```

Jersey mencari writer yang bisa menulis `CaseDto` ke `application/json`.

Jika resource mengembalikan:

```java
return Response.created(uri).entity(dto).build();
```

Maka Jersey:

1. mengambil status code,
2. mengambil headers,
3. memilih writer untuk entity,
4. menjalankan response filters,
5. menjalankan writer interceptors,
6. menulis output stream,
7. menyerahkan commit ke host runtime.

### 13.1 Response Commit Boundary

Setelah response committed, status/header tidak bisa diubah secara normal.

Masalah umum:

- streaming response sudah mulai menulis, lalu error terjadi,
- exception mapper tidak bisa mengubah status karena response sudah committed,
- filter mencoba menambah header terlalu lambat,
- compression/proxy buffering mengubah timing,
- client disconnect saat stream berjalan.

Deployment implication:

> Untuk streaming/download/SSE, failure handling harus didesain berbeda dari response JSON biasa.

---

## 14. Exception Boundary: Siapa yang Mengubah Error Jadi Response?

Ada beberapa lapisan error.

```text
Reverse proxy error
  -> proxy-generated response

Servlet container error
  -> container error page/response

Jersey runtime error
  -> ExceptionMapper / Jersey error response

Application error
  -> thrown exception -> ExceptionMapper
```

### 14.1 Jersey ExceptionMapper

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    @Override
    public Response toResponse(DomainException ex) {
        return Response.status(422)
            .entity(new ErrorDto(ex.code(), ex.getMessage()))
            .type(MediaType.APPLICATION_JSON)
            .build();
    }
}
```

Ini hanya bekerja jika exception terjadi di dalam Jersey pipeline dan response belum committed.

Tidak bisa menangani:

- nginx 413,
- ALB timeout,
- Tomcat request header too large sebelum Jersey,
- TLS handshake failure,
- servlet mapping miss,
- deployment startup failure sebelum app tersedia.

### 14.2 Diagnostic Rule

Jika error body format berbeda dari standar aplikasi, curigai error berasal dari layer lain.

Contoh:

```text
<html><body><h1>404 Not Found</h1></body></html>
```

Mungkin dari container/proxy.

```json
{
  "code": "CASE_NOT_FOUND",
  "message": "Case not found"
}
```

Mungkin dari aplikasi/Jersey mapper.

---

## 15. Threading Boundary: Thread Siapa yang Menjalankan Resource?

Resource method berjalan pada thread yang disediakan host runtime atau executor yang dikonfigurasi oleh Jersey/adapter.

Servlet model:

```text
Tomcat/Jetty worker thread -> Jersey -> resource method
```

Embedded Grizzly:

```text
Grizzly worker thread -> Jersey -> resource method
```

Netty model:

```text
Netty event loop or offloaded worker -> Jersey -> resource method
```

Virtual thread model:

```text
acceptor/platform thread -> virtual thread per request -> Jersey -> resource method
```

Tergantung runtime dan konfigurasi.

### 15.1 Kenapa Ini Penting?

Karena resource method sering melakukan blocking operation.

```java
@GET
@Path("/{id}")
public CaseDto get(@PathParam("id") String id) {
    return repository.findById(id); // blocking DB call
}
```

Jika thread pool terbatas dan downstream lambat:

```text
all request threads blocked on DB
  -> new requests queued
  -> queue fills
  -> latency rises
  -> LB timeout
  -> retry storm
  -> more load
```

Deployment model menentukan:

- berapa thread tersedia,
- apakah blocking aman,
- queue berada di mana,
- timeout siapa yang menang,
- bagaimana overload terlihat.

### 15.2 Virtual Threads Tidak Menghapus Semua Masalah

Pada Java 21+ dan Java 25, virtual threads dapat membantu concurrency blocking IO. Tetapi:

- DB connection pool tetap terbatas,
- downstream tetap punya rate limit,
- CPU-bound serialization tetap menggunakan CPU,
- memory per request tetap ada,
- backpressure tetap perlu,
- synchronized/pinning issue bisa relevan,
- container integration tergantung runtime.

Mental rule:

> Virtual threads mengubah cost model thread, bukan menghapus capacity planning.

---

## 16. Lifecycle Boundary: Startup, Ready, Live, Shutdown

Deployment contract bukan hanya request. Lifecycle juga penting.

### 16.1 Startup Flow

```text
process starts
  -> JVM initializes
  -> logging initializes
  -> config loads
  -> host runtime starts
  -> Jersey application initializes
  -> resources/providers registered
  -> DI graph validated
  -> port binds
  -> readiness becomes true
```

Urutan ini berbeda antar deployment.

WAR di Tomcat:

```text
Tomcat starts
  -> deploy WAR
  -> create webapp classloader
  -> initialize servlet/listeners
  -> Jersey initializes
```

Embedded:

```text
main starts
  -> create config
  -> create ResourceConfig
  -> create server
  -> start server
```

Jakarta EE:

```text
server starts
  -> deploy app
  -> container scans app
  -> CDI/Jakarta REST/security integration
  -> app becomes available
```

### 16.2 Readiness Must Mean “Can Serve Real Requests”

Bad readiness:

```text
GET /health returns 200 because process is alive
```

Good readiness:

```text
GET /ready returns 200 only after:
  - Jersey application initialized
  - critical config loaded
  - DB pool initialized or at least validated according to policy
  - required providers registered
  - server accepting traffic
```

But do not overdo readiness. If readiness depends on every downstream being perfect, small downstream blips can eject all pods and cause cascading failure.

Readiness is an operational contract, not merely an endpoint.

### 16.3 Shutdown Flow

Graceful shutdown should look like:

```text
SIGTERM received
  -> readiness false
  -> load balancer stops sending new traffic
  -> server stops accepting new requests
  -> in-flight requests drain within deadline
  -> resources close
  -> process exits
```

Bad shutdown:

```text
SIGTERM received
  -> process exits immediately
  -> in-flight requests dropped
  -> clients retry
  -> duplicate writes
```

For Jersey deployment, shutdown must account for:

- host runtime drain,
- resource cleanup,
- executor shutdown,
- async tasks,
- DB pool close,
- client connection pool close,
- audit/event flush,
- idempotency if writes are retried.

---

## 17. Deployment Model Changes What “Same Code” Means

Same resource code can behave differently across hosts.

```java
@Path("/ping")
public class PingResource {
    @GET
    public String ping() {
        return "ok";
    }
}
```

This looks deployment-neutral. But behavior may differ in:

- URL path due to context/mapping,
- default media type,
- provider selection,
- charset,
- exception response,
- request size limit,
- header size limit,
- thread name,
- logging MDC propagation,
- DI injection,
- lifecycle timing,
- classpath conflict,
- shutdown behavior.

Top-tier mental model:

> JAX-RS resource code is portable only within the constraints of the hosting contract.

Portability is not magic. It must be engineered.

---

## 18. Deployment Boundary Case Study: 404 yang Menipu

### 18.1 Symptom

Client calls:

```text
GET /api/cases/123
```

Response:

```text
404 Not Found
```

Developer checks:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") String id) { ... }
}
```

Looks correct.

### 18.2 Possible Root Causes

#### Case A — Request Never Entered Jersey

Servlet mapping:

```xml
<url-pattern>/rest/*</url-pattern>
```

Effective endpoint:

```text
/rest/cases/123
```

But client calls:

```text
/api/cases/123
```

404 from container.

#### Case B — Context Path Missing

WAR deployed as:

```text
/aceas
```

Servlet mapping:

```text
/api/*
```

Effective endpoint:

```text
/aceas/api/cases/123
```

Client calls:

```text
/api/cases/123
```

404 from container or gateway.

#### Case C — Reverse Proxy Strips Prefix Incorrectly

Client:

```text
/aceas/api/cases/123
```

Proxy forwards:

```text
/cases/123
```

But Tomcat expects Jersey servlet mapping:

```text
/api/*
```

Request misses Jersey.

#### Case D — Resource Not Registered

Request enters Jersey, but `CaseResource` not registered due to wrong package scanning.

```java
new ResourceConfig().packages("com.example.wrong");
```

404 from Jersey.

#### Case E — Namespace Mismatch

Resource compiled with `javax.ws.rs.Path`, runtime expects `jakarta.ws.rs.Path`.

Jersey 3/4 may not recognize old annotations as Jakarta REST resources.

Result: app deploys but resources not discovered, or startup failure depending setup.

### 18.3 Diagnosis Procedure

Ask in order:

1. Does access log of host runtime show the request?
2. Does Jersey request filter log the request?
3. Does resource matching log show candidate resources?
4. Is error body from proxy/container/Jersey/app?
5. What is effective context path?
6. What is servlet mapping?
7. What path does reverse proxy forward?
8. Is resource explicitly registered?
9. Are annotations from correct namespace?
10. Are provider packages scanned?

A 404 is not a conclusion. It is a symptom.

---

## 19. Deployment Boundary Case Study: 415 di Production tapi Tidak di Local

### 19.1 Symptom

Local embedded Grizzly works:

```text
POST /api/cases
Content-Type: application/json
```

Production WAR fails:

```text
415 Unsupported Media Type
```

### 19.2 Likely Causes

- Jackson provider included locally but missing in WAR.
- WAR marks JSON provider as `provided`, but container does not provide it.
- Container provides different JSON-B/Jackson provider priority.
- Resource class registered, provider package not registered.
- `Content-Type` includes vendor media type not handled.
- Request body transformed by proxy/filter.
- Mixed Jersey 2 provider with Jersey 3 runtime.

### 19.3 Correct Mental Model

`@Consumes(application/json)` is not enough. The runtime needs an entity reader.

```text
Resource method says: I consume JSON.
Provider pipeline says: I know how to convert JSON stream to this Java type.
Deployment says: the provider implementation is actually present and registered.
```

All three must be true.

---

## 20. Deployment Boundary Case Study: Location Header Wrong Behind Proxy

### 20.1 Resource Code

```java
@POST
public Response create(CreateRequest request, @Context UriInfo uriInfo) {
    CaseDto created = service.create(request);

    URI location = uriInfo.getAbsolutePathBuilder()
        .path(created.id())
        .build();

    return Response.created(location).entity(created).build();
}
```

### 20.2 Expected by Client

```text
Location: https://api.example.com/aceas/api/cases/123
```

### 20.3 Actual

```text
Location: http://service-name.default.svc.cluster.local:8080/api/cases/123
```

### 20.4 Root Cause

Jersey builds URI from request information provided by host runtime. If reverse proxy headers are not honored, Jersey sees internal scheme/host.

Fix is not inside business method. Fix is deployment-level:

- configure proxy forwarded headers,
- configure servlet container/proxy valve/filter,
- configure Jersey/base URI handling if needed,
- define trusted proxy boundary,
- add integration test through proxy path.

---

## 21. Minimal Contract Checklist for Every Jersey Deployment

Before choosing deployment model, define these contracts.

### 21.1 Network Contract

- Public scheme: HTTP or HTTPS?
- TLS terminates where?
- Public host/path?
- Is there path prefix rewriting?
- Which headers are trusted?
- What is max request body?
- What is max header size?
- What are idle/read/write timeouts?

### 21.2 Host Runtime Contract

- Which runtime owns the port?
- Which runtime owns thread pool?
- Which runtime owns TLS?
- Which runtime owns compression?
- Which runtime owns access logs?
- Which runtime owns graceful shutdown?
- Which runtime owns static files?

### 21.3 Jersey Adapter Contract

- Servlet, filter, or embedded adapter?
- What is application path?
- What is servlet mapping?
- How is `ResourceConfig` loaded?
- Are resources registered explicitly or scanned?
- Are providers registered explicitly or scanned?
- Which DI bridge is active?

### 21.4 Application Contract

- What resources are exposed?
- What media types are consumed/produced?
- What exceptions are mapped?
- What filters/interceptors run?
- What config sources are used?
- What security principal model is expected?
- What observability fields must exist?

### 21.5 Operational Contract

- What means live?
- What means ready?
- How long is graceful shutdown?
- What happens on overload?
- What happens on downstream failure?
- What log proves request entered Jersey?
- What metric proves resource method was invoked?

---

## 22. Code Pattern: Make Request Boundary Visible

A useful early filter:

```java
@Provider
@PreMatching
public final class RequestBoundaryLogFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext context) {
        String method = context.getMethod();
        URI requestUri = context.getUriInfo().getRequestUri();
        URI baseUri = context.getUriInfo().getBaseUri();
        String correlationId = context.getHeaderString("X-Correlation-Id");

        // In real code, use structured logging and avoid sensitive data.
        System.out.printf(
            "jersey.request.boundary method=%s baseUri=%s requestUri=%s correlationId=%s%n",
            method,
            baseUri,
            requestUri,
            correlationId
        );
    }
}
```

This log helps answer:

- Did request enter Jersey?
- What URI does Jersey see?
- Is scheme/host/path correct?
- Is forwarded header handling working?
- Is correlation ID present before matching?

In production, do not use `System.out.printf`. Use structured logging and MDC.

---

## 23. Code Pattern: Explicit ResourceConfig for Deterministic Hosting

Avoid relying too much on magical scanning, especially for production.

```java
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(CaseResource.class);
        register(HealthResource.class);

        register(DomainExceptionMapper.class);
        register(JsonMappingExceptionMapper.class);

        register(CorrelationFilter.class);
        register(RequestBoundaryLogFilter.class);

        // Register JSON provider explicitly when appropriate.
        // register(JacksonFeature.class);

        property("jersey.config.server.tracing.type", "OFF");
    }
}
```

Benefits:

- startup is more deterministic,
- resource list is reviewable,
- provider ownership is explicit,
- migration is easier,
- tests can instantiate same config,
- scanning surprises are reduced.

Trade-off:

- more boilerplate,
- must remember to register new resources,
- modular projects need registration composition.

For large systems, a hybrid approach can work:

```java
public interface JerseyModule {
    void configure(ResourceConfig config);
}
```

Then each module registers its own resources/providers explicitly.

---

## 24. Code Pattern: Startup Validation

Deployment failure should happen early.

Example validation ideas:

```java
public final class DeploymentValidator {

    public static void validate(ResourceConfig config) {
        requireRegistered(config, CaseResource.class);
        requireRegistered(config, HealthResource.class);
        requireRegistered(config, DomainExceptionMapper.class);
    }

    private static void requireRegistered(ResourceConfig config, Class<?> type) {
        if (!config.getClasses().contains(type) && !config.getInstances().stream().anyMatch(type::isInstance)) {
            throw new IllegalStateException("Missing Jersey registration: " + type.getName());
        }
    }
}
```

This example is simplified. Real Jersey runtime model can include binders, dynamic features, package scanning, and container-specific discovery. But the principle matters:

> Fail startup when deployment contract is invalid. Do not wait until first production request.

---

## 25. Code Pattern: Distinguish Container 404 from Jersey 404

Add a Jersey pre-matching filter that adds a response header for all Jersey-handled responses.

```java
@Provider
public final class JerseyMarkerFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        responseContext.getHeaders().putSingle("X-Handled-By", "jersey");
    }
}
```

Then:

```text
404 with X-Handled-By: jersey
  -> request entered Jersey but no resource matched

404 without X-Handled-By
  -> likely proxy/container/static routing/mapping issue
```

Do not expose internal details if policy forbids it. In regulated systems, this can be enabled only in lower environments or internal traffic.

---

## 26. Hosting Contract by Deployment Model

### 26.1 WAR Servlet Model

```text
Owner of port: container
Owner of mapping: web.xml/annotations/container
Owner of Jersey app config: Servlet init-param/Application/ResourceConfig
Owner of threads: container
Owner of shutdown: container
Owner of dependency isolation: webapp classloader
```

Best for:

- enterprise servlet environments,
- existing Tomcat/Jetty infrastructure,
- app server ops maturity,
- WAR deployment pipeline.

Risk:

- classloader conflict,
- context path surprises,
- provided dependency mismatch,
- redeploy leaks.

### 26.2 Embedded Server Model

```text
Owner of port: application
Owner of mapping: application code
Owner of Jersey app config: ResourceConfig
Owner of threads: embedded server/application
Owner of shutdown: application
Owner of dependency isolation: process/container image
```

Best for:

- microservices,
- executable jar,
- Docker/Kubernetes,
- explicit runtime control.

Risk:

- application must implement operational hygiene,
- hidden defaults,
- incomplete graceful shutdown,
- TLS/proxy config mistakes.

### 26.3 Jakarta EE Managed Model

```text
Owner of port: application server
Owner of mapping: Jakarta REST/Application/server
Owner of Jersey/Jakarta REST integration: server/runtime
Owner of threads: server
Owner of CDI/security/transactions: server
Owner of shutdown: server
```

Best for:

- enterprise runtime standardization,
- CDI/JTA/JNDI integration,
- managed resources,
- governance-heavy environments.

Risk:

- runtime-provided library mismatch,
- hidden integration behavior,
- vendor-specific defaults,
- harder local parity.

### 26.4 Cloud/Kubernetes Model

Kubernetes does not replace the above. It wraps them.

```text
Kubernetes owns pod lifecycle, service discovery, scheduling, probes, resource limits.
Application runtime still owns Jersey hosting inside the pod.
```

Best for:

- scalable service deployment,
- immutable releases,
- standardized operations.

Risk:

- probe semantics wrong,
- SIGTERM mishandled,
- timeout mismatch,
- memory limit vs JVM ergonomics,
- readiness lies.

---

## 27. Testing the Hosting Contract

Unit tests are not enough. Need tests at multiple boundaries.

### 27.1 Resource-Level Test

Validates resource behavior inside Jersey test runtime.

Checks:

- path matching,
- status code,
- JSON mapping,
- exception mapper,
- filters/interceptors.

Limit:

- may not catch servlet mapping/context path/proxy issues.

### 27.2 Embedded Runtime Test

Start actual embedded server on random port.

Checks:

- real HTTP request,
- provider availability,
- headers,
- body reading/writing,
- startup lifecycle.

Limit:

- may not match production container.

### 27.3 Container Integration Test

Deploy WAR to Tomcat/Jetty/Payara/Open Liberty in test environment.

Checks:

- context path,
- servlet mapping,
- classloader,
- provided dependencies,
- container filters,
- real access logs.

### 27.4 Proxy Path Test

Test through same path shape as production:

```text
client -> reverse proxy -> app runtime -> Jersey
```

Checks:

- forwarded headers,
- prefix rewriting,
- TLS scheme reconstruction,
- generated Location header,
- timeout behavior,
- body/header size limit.

Top-tier deployment testing does not only call resource methods. It tests the path the real request takes.

---

## 28. Operational Signals: How to Prove the Request Passed Each Boundary

For production diagnostics, each boundary should leave evidence.

| Boundary | Evidence |
|---|---|
| Load balancer received request | LB access log / target status |
| Reverse proxy forwarded request | proxy access log with upstream status |
| JVM host received request | servlet/embedded access log |
| Request entered Jersey | Jersey request filter log/metric |
| Resource matched | resource/method metric or tracing span |
| Business method executed | app log/trace/span |
| DB/downstream called | client metrics/traces |
| Response written | Jersey response filter/access log |
| Response returned to client | LB/proxy final status/latency |

Without these signals, production incident analysis becomes guesswork.

---

## 29. Anti-Patterns

### 29.1 “It Works in Embedded, So WAR Will Work”

Not guaranteed. WAR introduces servlet mapping, context path, classloader, container-provided dependencies, and filter chain.

### 29.2 “It Works in Tomcat, So Payara/Open Liberty Will Work”

Not guaranteed. Jakarta EE server may provide Jakarta REST implementation, CDI integration, server libraries, different scanning, and different classloader rules.

### 29.3 “404 Means Resource Code Bug”

Not necessarily. It can be proxy/container/mapping/discovery/namespace issue.

### 29.4 “Jersey Owns All Timeouts”

False. Timeout can come from client, LB, proxy, connector, servlet async timeout, Jersey, downstream client, DB pool, or OS socket.

### 29.5 “Container Image Means Embedded Deployment”

False. A Docker image can run Tomcat with WAR, Payara, Open Liberty, or embedded Grizzly. Containerization is packaging/runtime isolation, not a JAX-RS hosting model.

### 29.6 “Provider Discovery Is Harmless”

Auto-discovery can become non-deterministic across classpaths, shaded jars, app servers, and upgrades.

### 29.7 “Forwarded Headers Are Just Headers”

They are security-sensitive. Trust them only from known proxies.

---

## 30. Top 1% Mental Model: Four Questions for Every Deployment Issue

When debugging Jersey deployment, ask:

### Question 1 — Did the request enter the JVM host?

Evidence:

- host access log,
- connector log,
- container log,
- port binding,
- LB target status.

If no, look at network/proxy/LB/DNS/firewall.

### Question 2 — Did the request enter Jersey?

Evidence:

- Jersey pre-matching filter log,
- Jersey marker header,
- Jersey metrics/tracing,
- exception mapper style.

If no, look at context path, servlet mapping, filter mapping, proxy rewrite, deployment descriptor.

### Question 3 — Did Jersey match the intended resource method?

Evidence:

- resource method log,
- tracing span name,
- method-level metric,
- 404/405/406/415 semantics,
- debug resource model in lower env.

If no, look at `@Path`, HTTP method, `@Consumes`, `@Produces`, provider registration, namespace mismatch.

### Question 4 — Did the application complete within operational budget?

Evidence:

- app latency,
- DB/client metrics,
- thread dump,
- pool usage,
- timeout source,
- cancellation behavior.

If no, look at downstream, thread pool, queueing, timeouts, backpressure, retries.

---

## 31. Practical Deployment Design Heuristic

For every Jersey service, document this table.

```text
Public URL prefix:
Internal context path:
Servlet/filter mapping:
Jersey Application/ResourceConfig class:
Resource registration mode:
Provider registration mode:
DI owner:
JSON provider:
Security owner:
Thread pool owner:
Timeout owner:
Forwarded header policy:
Health endpoint owner:
Graceful shutdown policy:
Generated URI policy:
Access log location:
Jersey request marker:
```

If a team cannot fill this out, they do not yet understand their deployment model.

---

## 32. Summary

The hosting contract is the missing mental model between “I wrote a Jersey resource” and “the API works in production”.

Key conclusions:

1. Jersey is not the HTTP server by itself; it runs behind a host runtime.
2. The host runtime owns connection acceptance, HTTP parsing, thread model, and often lifecycle.
3. Jersey owns resource matching, provider pipeline, entity conversion, filters/interceptors, and resource invocation after the request enters its runtime.
4. Servlet deployment adds context path, servlet mapping, filter chain, classloader, and container-owned lifecycle.
5. Embedded deployment gives more control but shifts operational responsibility to the application.
6. Jakarta EE deployment adds managed CDI/security/transaction/resource semantics.
7. Docker/Kubernetes wrap the hosting model; they do not replace it.
8. Most production bugs must be diagnosed by locating the failing boundary.
9. URI reconstruction behind reverse proxy is a deployment problem, not a resource method problem.
10. A top-tier engineer makes each request boundary observable and testable.

---

## 33. What You Should Be Able to Explain After This Part

You should now be able to explain:

- why Jersey needs a host runtime,
- how servlet deployment routes request to Jersey,
- why context path and servlet mapping change effective endpoint URL,
- how embedded deployment differs from WAR deployment,
- why Jakarta EE managed deployment changes DI/security/transaction behavior,
- where resource matching happens,
- where entity reader/writer selection happens,
- why some 404/415/500 errors are deployment bugs,
- why reverse proxy headers affect generated URLs,
- why thread ownership depends on deployment model,
- how to prove whether a request entered Jersey.

---

## 34. Mini Exercise

Given this setup:

```text
Public URL: https://api.company.com/aceas/v1/cases/123
Reverse proxy strips: /aceas
WAR context path: /case-service
Jersey servlet mapping: /v1/*
Resource class: @Path("/cases")
Resource method: @GET @Path("/{id}")
```

Answer:

1. What path should proxy forward to the servlet container?
2. What external URL should match the resource?
3. What path does Jersey likely match against?
4. If client gets 404, how do you determine whether 404 comes from proxy, container, or Jersey?
5. What should `Location` header look like if resource creates a new case?
6. What forwarded headers are needed for correct public URI generation?

Expected reasoning:

```text
External URL contains public prefix /aceas.
Proxy strips /aceas before forwarding.
Container still has WAR context path /case-service.
Jersey servlet mapping /v1/* consumes /v1.
Resource matches /cases/123 inside Jersey.
```

But exact answer depends on whether proxy forwards to context path directly or whether routing already maps to the webapp. This is precisely why deployment contract must be documented.

---

## 35. References

- Eclipse Jersey Documentation — Application Deployment and Runtime. Jersey supports deployment across lightweight HTTP containers and Java/Jakarta EE servers, and distinguishes Java SE versus container environments.
- Eclipse Jersey Documentation — Servlet-based deployment and `ServletContainer` deployment model.
- Eclipse Jersey Documentation — Java SE deployment with Grizzly/JDK HTTP/Jetty-related adapters.
- Jakarta RESTful Web Services Specification 4.0 — request matching and provider pipeline concepts.
- Jakarta RESTful Web Services Specification 3.0 — API goals, annotations, Java SE baseline, and HTTP stack non-goal.
- Eclipse Jersey Road Map / Jersey 4.x notes — Jakarta REST 4.0 compatibility and deployment module changes.

---

## 36. Status Seri

Part 3 selesai.

Progress:

```text
[03/32] The Hosting Contract: Bagaimana Request Masuk ke Jersey
```

Seri belum selesai. Part berikutnya:

```text
Part 4 — WAR Deployment Model di Servlet Container
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-002.md">⬅️ Part 2 — Deployment Invariants: Apa yang Tidak Boleh Salah di Semua Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-004.md">Part 4 — WAR Deployment Model di Servlet Container ➡️</a>
</div>
