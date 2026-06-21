# learn-java-eclipse-jersey-deployment-models-part-002

# Part 2 — Deployment Invariants: Apa yang Tidak Boleh Salah di Semua Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Target: Java 8 sampai Java 25  
> Fokus: invariant deployment yang berlaku untuk WAR, Servlet container, Filter, embedded server, Jakarta EE server, Docker, Kubernetes, dan cloud runtime.

---

## 1. Tujuan Part Ini

Part sebelumnya membahas **version matrix**: Java version, Jersey major version, namespace `javax.*` vs `jakarta.*`, Servlet API, Jakarta REST API, dan container runtime.

Part ini membahas sesuatu yang lebih mendasar: **deployment invariants**.

Invariant adalah aturan yang harus tetap benar dalam semua variasi implementasi. Deployment model boleh berbeda:

- WAR di Tomcat.
- WAR di Jetty.
- WAR di GlassFish atau Payara.
- Jersey embedded dengan Grizzly.
- Jersey embedded dengan Jetty.
- Jersey di JDK HTTP Server.
- Jersey di Netty.
- Jersey sebagai Servlet.
- Jersey sebagai Filter.
- Jersey dalam Docker.
- Jersey dalam Kubernetes.
- Jersey di balik reverse proxy atau API gateway.

Tetapi ada aturan yang tidak berubah. Kalau aturan ini rusak, gejalanya bisa berbeda-beda, tetapi akar masalahnya sering sama.

Contoh:

- Di Tomcat, gejalanya mungkin `404 Not Found`.
- Di embedded Grizzly, gejalanya mungkin resource tidak pernah dipanggil.
- Di Kubernetes, gejalanya mungkin readiness probe gagal.
- Di Payara, gejalanya mungkin CDI injection tidak jalan.
- Di Java 17+, gejalanya mungkin reflective access error.
- Di migrasi Jersey 2 ke 3, gejalanya mungkin `ClassNotFoundException: javax.ws.rs.*` atau `jakarta.ws.rs.*` mismatch.

Engineer biasa sering menyelesaikan gejala. Engineer kuat mencari invariant yang rusak.

---

## 2. Mental Model: Deployment Bukan Sekadar “Run Application”

Deployment Jersey bukan hanya menjalankan class Java.

Deployment Jersey adalah proses mengikat beberapa kontrak sekaligus:

```text
HTTP Runtime
  -> Hosting Adapter
    -> Jersey Runtime
      -> Application Model
        -> Resource Model
          -> Provider Pipeline
            -> Dependency Injection
              -> Configuration
                -> Observability
                  -> Lifecycle Management
```

Setiap layer punya tanggung jawab berbeda.

| Layer | Pertanyaan Utama |
|---|---|
| HTTP Runtime | Siapa yang menerima koneksi TCP/HTTP? |
| Hosting Adapter | Bagaimana request HTTP masuk ke Jersey? |
| Jersey Runtime | Bagaimana resource, provider, filter, interceptor diproses? |
| Application Model | Class apa saja yang membentuk aplikasi REST? |
| Resource Model | Endpoint apa saja yang valid? |
| Provider Pipeline | Siapa yang membaca body, menulis response, validasi, error mapping? |
| DI | Siapa yang membuat object dan mengisi dependency? |
| Configuration | Dari mana config deployment dibaca? |
| Observability | Bagaimana kita tahu aplikasi sehat atau rusak? |
| Lifecycle | Bagaimana startup, running, reload, shutdown terjadi? |

Deployment gagal ketika satu atau lebih kontrak ini ambigu.

---

## 3. Invariant 1 — Satu Aplikasi Harus Punya Satu Runtime Ownership yang Jelas

Pertanyaan paling awal:

> Siapa pemilik lifecycle aplikasi?

Jawaban yang mungkin:

1. Servlet container external, seperti Tomcat atau Jetty.
2. Jakarta EE server, seperti GlassFish, Payara, Open Liberty, WildFly.
3. Application main class sendiri, seperti embedded Grizzly atau embedded Jetty.
4. Framework lain yang membungkus Jersey.
5. Test harness.
6. Container orchestrator seperti Kubernetes, tetapi hanya sebagai process supervisor, bukan Jersey runtime owner.

Ownership penting karena menentukan:

- siapa yang membuat object;
- siapa yang memulai server;
- siapa yang membuka port;
- siapa yang membaca deployment descriptor;
- siapa yang memanggil lifecycle callback;
- siapa yang menangani shutdown;
- siapa yang menyediakan classloader;
- siapa yang menyediakan injection container;
- siapa yang mendefinisikan request thread;
- siapa yang mengelola redeploy.

### 3.1 Contoh Ownership yang Jelas

#### WAR di Tomcat

```text
Tomcat owns process + HTTP connector + servlet lifecycle
Jersey owns JAX-RS resource dispatch
Application owns resource/provider code
```

#### Embedded Grizzly

```text
Your main() owns process lifecycle
Grizzly owns HTTP listener
Jersey owns JAX-RS resource dispatch
Application owns resource/provider code
```

#### Jakarta EE Server

```text
Application server owns process + servlet + CDI + transaction + security
Jersey/Jakarta REST owns REST dispatch
Application owns business resource code
```

### 3.2 Anti-Pattern: Mixed Ownership

Contoh buruk:

```text
Aplikasi dikemas sebagai WAR,
tetapi juga punya main() yang men-start embedded server,
dan juga mencoba memakai CDI server,
dan juga membawa sendiri implementation jar yang sama dengan server.
```

Masalah yang bisa muncul:

- resource terdaftar dua kali;
- provider bentrok;
- injection container ganda;
- class dimuat oleh classloader berbeda;
- application startup jalan dua kali;
- shutdown hook tidak sinkron;
- memory leak saat redeploy;
- dependency yang dipakai runtime bukan dependency yang dikira engineer.

### 3.3 Rule of Thumb

Sebelum menulis konfigurasi deployment, jawab dulu:

```text
Dalam model ini, siapa yang memiliki:
1. process?
2. port?
3. HTTP parsing?
4. servlet/filter lifecycle?
5. Jersey Application/ResourceConfig?
6. DI object lifecycle?
7. graceful shutdown?
```

Kalau jawabannya lebih dari satu untuk satu aspek, desainnya rawan.

---

## 4. Invariant 2 — Namespace Harus Konsisten: `javax.*` atau `jakarta.*`, Jangan Campur

Untuk Java/Jersey modern, salah satu invariant paling penting adalah namespace.

Dua dunia utama:

```text
Legacy world:
  javax.ws.rs.*
  javax.servlet.*
  javax.inject.*
  javax.validation.*
  Jersey 2.x
  Java 8+ legacy-compatible

Modern Jakarta world:
  jakarta.ws.rs.*
  jakarta.servlet.*
  jakarta.inject.*
  jakarta.validation.*
  Jersey 3.x / 4.x
  Java 11+/17+ depending on generation
```

Masalahnya bukan sekadar import statement. Namespace menentukan seluruh ecosystem:

- annotation resource;
- Servlet API;
- JAX-RS/Jakarta REST API;
- CDI/Jakarta Inject;
- Bean Validation;
- JSON-B/Jackson integration;
- container runtime;
- test framework;
- dependency transitive;
- documentation yang relevan.

### 4.1 Bentuk Mismatch yang Umum

#### Case 1 — Resource memakai `javax.ws.rs.GET`, runtime Jersey 3

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;

@Path("/hello")
public class HelloResource {
    @GET
    public String hello() {
        return "hello";
    }
}
```

Jika runtime berbasis Jakarta/Jersey 3+, annotation ini bukan annotation yang dicari runtime modern.

Gejala bisa berupa:

- endpoint tidak terdaftar;
- 404;
- provider tidak ditemukan;
- startup warning;
- classpath conflict;
- test pass di satu runtime, fail di runtime lain.

#### Case 2 — Servlet container masih `javax.servlet`, app membawa `jakarta.servlet`

Contoh paling sering:

```text
Tomcat 9 -> javax.servlet
Tomcat 10+ -> jakarta.servlet
```

Kalau aplikasi Jersey 3 berbasis `jakarta.*` dideploy ke container `javax.*`, kontraknya tidak cocok.

#### Case 3 — API jar dan implementation jar berasal dari generasi berbeda

Contoh konseptual:

```text
jakarta.ws.rs-api 3.x
jersey-server 2.x
```

atau:

```text
javax.ws.rs-api 2.x
jersey-server 3.x
```

Gejalanya bisa berupa:

- `NoSuchMethodError`;
- `ClassCastException`;
- `ClassNotFoundException`;
- resource tidak dikenali;
- provider tidak bekerja.

### 4.2 Invariant Praktis

Untuk setiap aplikasi, harus ada satu jawaban jelas:

```text
Apakah aplikasi ini berada di javax world atau jakarta world?
```

Kalau `javax`:

- gunakan Jersey 2.x;
- gunakan Servlet container yang cocok dengan `javax.servlet`;
- gunakan dependency API `javax.*`;
- hindari library extension yang hanya Jakarta;
- target Java 8/11/17 bisa dilakukan, tapi namespace tetap legacy.

Kalau `jakarta`:

- gunakan Jersey 3.x atau 4.x;
- gunakan container yang cocok dengan `jakarta.servlet`;
- gunakan dependency API `jakarta.*`;
- pastikan semua provider dan filter sudah Jakarta-compatible;
- siapkan migrasi import, config, test, dan deployment descriptor.

---

## 5. Invariant 3 — API, Implementation, dan Container Tidak Boleh Saling Mengambil Alih Sembarangan

Jersey deployment selalu melibatkan beberapa jenis dependency:

1. API dependency.
2. Implementation dependency.
3. Container adapter dependency.
4. Integration dependency.
5. Provider dependency.
6. Test dependency.

Contoh konseptual:

```text
API:
  jakarta.ws.rs-api

Implementation:
  jersey-server
  jersey-common

Container adapter:
  jersey-container-servlet
  jersey-container-grizzly2-http
  jersey-container-jetty-http

Provider:
  jersey-media-json-jackson
  jersey-media-moxy
  jersey-bean-validation

Injection:
  jersey-hk2
  jersey-cdi integration
```

Invariant-nya:

> Runtime harus tahu siapa menyediakan API, siapa menyediakan implementation, dan siapa menyediakan container adapter.

### 5.1 WAR di External Container

Dalam WAR, sebagian dependency bisa disediakan container.

Tetapi ini harus eksplisit.

Contoh mental model:

```text
Tomcat only provides Servlet container.
Tomcat does not provide Jersey runtime by default.
Application WAR must bring Jersey implementation.
```

Sedangkan di Jakarta EE server:

```text
Server may already provide Jakarta REST implementation.
Application may not need to bundle Jersey implementation.
```

Kalau aplikasi tetap membawa Jersey sendiri di server yang juga membawa REST implementation, hasilnya bisa:

- app memakai implementation server, bukan implementation bundled;
- app memakai bundled Jersey tetapi API dari server;
- classloader conflict;
- injection integration rusak;
- error hanya terjadi di server tertentu.

### 5.2 Provided Scope Bukan Dekorasi

Dalam Maven/Gradle, scope dependency adalah kontrak deployment.

Contoh Maven mental model:

```xml
<scope>provided</scope>
```

Artinya:

```text
Dependency tersedia saat compile,
tetapi tidak dikemas ke artifact,
karena runtime/container diharapkan menyediakannya.
```

Kalau dependency salah diberi `provided`, aplikasi bisa compile tetapi gagal runtime.

Kalau dependency salah ikut dikemas, aplikasi bisa jalan di local tetapi gagal di server karena conflict.

### 5.3 Invariant Praktis

Untuk setiap dependency penting, buat tabel ownership:

| Dependency | Compile Owner | Runtime Owner | Packaged? | Alasan |
|---|---:|---:|---:|---|
| Servlet API | app compile | container | no for WAR | disediakan container |
| Jersey server | app | app/server | depends | tergantung deployment |
| JSON provider | app | app | usually yes | app memilih serialization behavior |
| Validation API | app | app/server | depends | tergantung container |
| CDI API | app | server/app | depends | tergantung DI model |

Tanpa tabel ini, deployment besar sering menjadi trial-and-error.

---

## 6. Invariant 4 — Resource Registration Harus Deterministik

Jersey harus tahu resource class apa saja yang masuk application model.

Ada beberapa cara:

1. Package scanning.
2. Explicit class registration.
3. `ResourceConfig` subclass.
4. `Application` subclass.
5. Servlet init-param.
6. Auto-discovery.
7. Container integration.

Masalahnya: semakin banyak mekanisme registration yang dicampur, semakin sulit memprediksi hasil.

### 6.1 Package Scanning

Contoh:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Kelebihan:

- mudah untuk project kecil-menengah;
- sedikit boilerplate;
- cepat menambah resource baru.

Kekurangan:

- startup scanning cost;
- classpath dependent;
- rawan membawa class yang tidak diinginkan;
- hasil bisa berbeda saat shading/fat jar;
- bisa membingungkan di modular Java;
- sulit untuk deployment yang butuh deterministik penuh.

### 6.2 Explicit Registration

Contoh:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
        register(OrderResource.class);
        register(GlobalExceptionMapper.class);
        register(JsonFeature.class);
    }
}
```

Kelebihan:

- deterministic;
- mudah diaudit;
- mudah diuji;
- startup lebih predictable;
- cocok untuk regulated system;
- cocok untuk native image atau strict runtime.

Kekurangan:

- lebih verbose;
- perlu disiplin saat menambah resource;
- bisa lupa register resource baru.

### 6.3 Auto-Discovery

Auto-discovery bisa membantu, tetapi dalam production deployment yang kompleks, auto-discovery harus diperlakukan sebagai mekanisme yang perlu dikendalikan.

Contoh risiko:

- provider transitive ikut aktif tanpa disadari;
- JSON provider yang dipilih bukan yang diharapkan;
- behavior berbeda antara local dan server;
- startup order sulit dipahami;
- native-image atau module path membutuhkan config tambahan.

### 6.4 Invariant Praktis

Untuk production-grade deployment:

```text
Resource registration harus bisa dijelaskan tanpa menebak classpath.
```

Minimal harus bisa menjawab:

1. Dari mana Jersey menemukan resource?
2. Dari mana Jersey menemukan provider?
3. Apakah package scanning dipakai?
4. Apakah auto-discovery aktif?
5. Apakah list resource bisa diuji saat startup?
6. Apakah endpoint yang diharapkan bisa divalidasi di integration test?

---

## 7. Invariant 5 — Servlet Mapping atau Base URI Harus Konsisten dengan Routing External

Dalam deployment REST, path yang dilihat client tidak selalu sama dengan path yang dilihat Jersey.

Contoh:

```text
Client calls:
  https://api.example.com/aceas/api/cases/123

Reverse proxy forwards to app:
  http://service:8080/api/cases/123

Servlet context path:
  /aceas

Jersey servlet mapping:
  /api/*

Resource path:
  /cases/{id}
```

Semua layer ini harus konsisten.

### 7.1 Path Layer

```text
External URL
  -> reverse proxy path
    -> servlet context path
      -> servlet mapping
        -> application path
          -> resource path
```

Contoh:

```java
@Path("/cases")
public class CaseResource {
    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") String id) {
        return Response.ok().build();
    }
}
```

Jika servlet mapping adalah `/api/*`, maka endpoint internal mungkin:

```text
/context/api/cases/{id}
```

Kalau reverse proxy menghapus `/api` tetapi aplikasi masih mengharapkan `/api`, endpoint menjadi 404.

### 7.2 Common Mapping Mistakes

| Mistake | Gejala |
|---|---|
| `/*` dipakai tanpa paham konsekuensi | static file, error page, dan framework lain terganggu |
| `/api` bukan `/api/*` | path matching tidak sesuai ekspektasi |
| context path berubah di container | endpoint berubah tanpa perubahan code |
| proxy rewrite tidak sinkron | local jalan, deployment gagal |
| health endpoint berada di path yang salah | readiness/liveness gagal |
| trailing slash tidak distandarkan | route tampak tidak konsisten |

### 7.3 Invariant Praktis

Selalu dokumentasikan route lengkap:

```text
External public path:
  /aceas/api/cases/{id}

Proxy behavior:
  strip /aceas or preserve /aceas?

Container context path:
  /aceas

Servlet mapping:
  /api/*

Jersey resource path:
  /cases/{id}
```

Tanpa peta ini, bug routing menjadi debat opini.

---

## 8. Invariant 6 — Provider Pipeline Harus Eksplisit dan Stabil

Dalam Jersey, resource method bukan satu-satunya komponen penting.

Request/response melewati pipeline:

```text
Request
  -> pre-matching filters
  -> request filters
  -> resource matching
  -> parameter conversion
  -> entity provider / MessageBodyReader
  -> validation
  -> resource method
  -> exception mapper if needed
  -> response filters
  -> MessageBodyWriter
  -> output stream
```

Provider yang umum:

- `ContainerRequestFilter`;
- `ContainerResponseFilter`;
- `ExceptionMapper<T>`;
- `MessageBodyReader<T>`;
- `MessageBodyWriter<T>`;
- `ParamConverterProvider`;
- `ContextResolver<T>`;
- JSON provider;
- validation feature;
- multipart feature;
- logging feature;
- authentication filter;
- authorization filter;
- CORS filter.

### 8.1 Provider Collision

Contoh collision:

- Jackson dan MOXy sama-sama tersedia;
- dua `ExceptionMapper<Throwable>` terdaftar;
- custom filter dan servlet filter melakukan hal sama;
- CORS di reverse proxy dan aplikasi berbeda;
- auth di gateway dan app tidak sepakat;
- validation error mapper tertimpa generic exception mapper.

Gejala:

- response JSON berubah format;
- error 500 tidak konsisten;
- content negotiation gagal;
- `415 Unsupported Media Type`;
- `406 Not Acceptable`;
- header hilang;
- CORS preflight gagal;
- security bypass atau double authentication.

### 8.2 Invariant Praktis

Buat provider registry eksplisit:

| Provider | Role | Order | Scope | Owner |
|---|---|---:|---|---|
| CorrelationIdFilter | request id | early | all requests | app |
| AuthenticationFilter | authN | early | protected APIs | app/gateway |
| AuthorizationFilter | authZ | after authN | protected APIs | app |
| JsonProvider | body serialization | entity | JSON APIs | app |
| ValidationExceptionMapper | validation errors | exception | all APIs | app |
| GenericExceptionMapper | fallback errors | exception | all APIs | app |
| AccessLogFilter | audit/logging | late | all APIs | app/container |

Provider pipeline adalah bagian deployment, bukan detail coding kecil.

---

## 9. Invariant 7 — Dependency Injection Boundary Harus Dipilih, Bukan Terjadi Kebetulan

Jersey punya integration dengan HK2. Di environment Jakarta EE, CDI juga bisa hadir. Di aplikasi modern, ada juga Spring atau custom DI.

Pertanyaan penting:

```text
Siapa yang membuat resource object?
```

Pilihan umum:

1. Jersey/HK2 membuat resource.
2. CDI container membuat resource.
3. Spring container membuat resource.
4. Manual registration membuat singleton/object tertentu.
5. Hybrid integration.

### 9.1 Kenapa Ini Penting?

Karena object lifecycle menentukan:

- constructor injection;
- field injection;
- request scope;
- singleton scope;
- transaction boundary;
- security context;
- proxy generation;
- resource cleanup;
- thread-safety requirement.

### 9.2 Anti-Pattern: Resource Mengira CDI, Runtime Menggunakan HK2

Contoh:

```java
@Path("/orders")
public class OrderResource {
    @Inject
    OrderService service;
}
```

Pertanyaan:

- `@Inject` ini dari package mana?
- Siapa yang memproses annotation ini?
- Apakah `OrderService` registered di container yang sama?
- Apakah resource dibuat oleh CDI atau Jersey?
- Apakah deployment model mendukung CDI?

Kalau ini tidak jelas, error bisa muncul sebagai:

- `UnsatisfiedDependencyException`;
- `MultiException` dari HK2;
- field null;
- resource dibuat tapi dependency tidak masuk;
- resource singleton tanpa sadar;
- memory leak karena manual singleton.

### 9.3 Invariant Praktis

Tentukan satu DI ownership model per deployment:

| Model | Resource Created By | Service Created By | Cocok Untuk |
|---|---|---|---|
| Jersey + HK2 | Jersey/HK2 | HK2 binder | embedded/simple service |
| Jakarta EE + CDI | CDI/Jakarta runtime | CDI | enterprise managed runtime |
| Spring + Jersey | Spring integration | Spring | Spring ecosystem |
| Manual singleton | manual/Jersey registration | manual | very small app/test |

Jangan biarkan DI model menjadi hasil kebetulan dari transitive dependency.

---

## 10. Invariant 8 — Configuration Harus Punya Precedence yang Bisa Diaudit

Deployment berbeda sering memakai konfigurasi berbeda:

- local property file;
- environment variable;
- JVM system property;
- servlet init-param;
- context-param;
- MicroProfile Config;
- Kubernetes ConfigMap;
- Kubernetes Secret;
- AWS SSM Parameter Store;
- Vault;
- command-line argument;
- application server resource config.

Masalah muncul ketika tidak ada precedence.

Contoh:

```text
Local config says /api
Env var says /v1
Servlet init-param says /rest
Kubernetes ConfigMap still old
```

Aplikasi jalan, tetapi behavior sulit diprediksi.

### 10.1 Configuration Invariant

Harus ada jawaban untuk:

1. Config dibaca dari mana?
2. Mana yang menang jika ada duplikasi?
3. Config mana yang immutable saat startup?
4. Config mana yang boleh dynamic reload?
5. Secret disimpan di mana?
6. Apakah config dicetak saat startup secara aman?
7. Apakah config bisa divalidasi sebelum app menerima traffic?
8. Apakah config bisa diaudit di production incident?

### 10.2 Startup Config Validation

Untuk sistem enterprise, jangan biarkan config error baru ketahuan saat request pertama.

Contoh validation:

```java
public final class StartupValidator {
    public void validate(AppConfig config) {
        requireNonBlank(config.basePath(), "basePath");
        requireNonBlank(config.databaseUrl(), "databaseUrl");
        requirePositive(config.requestTimeoutMs(), "requestTimeoutMs");
        requireValidUrl(config.identityProviderUrl(), "identityProviderUrl");
    }
}
```

Mental model:

```text
Invalid deployment config should fail at startup,
not at first user transaction.
```

---

## 11. Invariant 9 — Startup Harus Deterministik dan Observable

Startup Jersey bukan hanya process hidup.

Startup yang sehat berarti:

1. HTTP listener siap.
2. Jersey application model berhasil dibangun.
3. Resource berhasil terdaftar.
4. Provider berhasil terdaftar.
5. DI graph valid.
6. Config valid.
7. Required downstream dependency minimal valid, jika memang required at startup.
8. Health endpoint tersedia.
9. App belum menerima traffic sebelum siap.

### 11.1 Startup Phases

```text
Process start
  -> JVM initialization
  -> dependency/classloading
  -> container/server initialization
  -> Jersey ResourceConfig/Application creation
  -> resource/provider scanning/registration
  -> DI binding/resolution
  -> config validation
  -> HTTP listener bind
  -> readiness true
  -> traffic accepted
```

### 11.2 Bad Startup Pattern

```text
Process starts
Port opens
Readiness returns 200
Jersey resource registration later fails lazily
First real user request gets 500
```

Ini buruk karena orchestrator menganggap aplikasi sehat.

### 11.3 Good Startup Pattern

```text
Process starts
Config validated
Resource model built
DI graph validated
Critical providers registered
Health endpoint active
Readiness true only after application ready
Traffic accepted
```

### 11.4 Invariant Praktis

Startup log minimal harus mencakup:

- application name;
- version/build commit;
- Java version;
- Jersey version;
- deployment model;
- namespace mode: `javax` or `jakarta`;
- container/runtime name;
- context path;
- servlet mapping or base URI;
- active profiles/environment;
- registered resource count;
- registered provider count;
- configured port;
- readiness status.

Jangan menunggu incident untuk mencari tahu aplikasi sebenarnya berjalan dengan deployment model apa.

---

## 12. Invariant 10 — Shutdown Harus Graceful, Bukan Hanya Process Mati

Shutdown yang benar berarti:

1. stop menerima request baru;
2. biarkan request berjalan selesai dalam batas waktu;
3. flush response/log/metrics;
4. tutup client connection pool;
5. tutup DB pool;
6. hentikan scheduler/background worker;
7. unregister health/readiness;
8. release port;
9. exit dengan status yang benar.

### 12.1 Kenapa Ini Deployment Invariant?

Karena deployment modern sering melakukan:

- rolling update;
- pod eviction;
- autoscaling;
- blue-green deployment;
- canary deployment;
- application server redeploy;
- graceful restart;
- node drain.

Kalau shutdown buruk, efeknya:

- request putus di tengah;
- duplicate transaction;
- partial response;
- connection leak;
- locked file;
- stuck thread;
- delayed deployment;
- false incident.

### 12.2 Embedded Shutdown

Di embedded model, aplikasi sendiri harus mengelola shutdown.

Contoh mental model:

```java
public static void main(String[] args) throws Exception {
    Server server = startServer();

    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
        server.shutdownGracefully();
    }));

    Thread.currentThread().join();
}
```

Tetapi production-grade shutdown tidak cukup hanya `addShutdownHook`. Harus ada timeout, logging, error handling, dan resource cleanup.

### 12.3 Container Shutdown

Di servlet/Jakarta EE container, lifecycle bisa dikontrol oleh container.

Namun aplikasi tetap bertanggung jawab untuk:

- menutup custom executor;
- menutup external clients;
- memastikan background task berhenti;
- tidak membuat thread liar;
- tidak menyimpan reference static ke classloader lama.

### 12.4 Invariant Praktis

Checklist shutdown:

```text
[ ] Readiness false before stopping traffic.
[ ] New requests rejected/drained properly.
[ ] In-flight requests get bounded completion time.
[ ] DB pools closed.
[ ] HTTP clients closed.
[ ] Message consumers stopped.
[ ] Schedulers stopped.
[ ] Metrics/logs flushed.
[ ] No non-daemon runaway thread.
[ ] Exit code meaningful.
```

---

## 13. Invariant 11 — Threading Model Harus Diketahui

Jersey resource method dieksekusi oleh thread yang disediakan deployment runtime.

Thread itu bisa berasal dari:

- Tomcat executor;
- Jetty thread pool;
- Grizzly worker thread;
- Netty event loop atau offload executor;
- Jakarta EE managed executor;
- virtual thread executor;
- test runner.

### 13.1 Kenapa Ini Penting?

Karena resource method sering melakukan:

- DB query;
- HTTP call ke service lain;
- file IO;
- JSON serialization;
- authorization lookup;
- audit logging;
- event publishing;
- validation;
- blocking wait.

Kalau thread pool salah dipahami, aplikasi bisa mengalami:

- thread starvation;
- request queue menumpuk;
- latency spike;
- deadlock;
- timeout chain;
- event-loop blocking;
- CPU oversubscription;
- GC pressure.

### 13.2 Blocking vs Non-Blocking Boundary

JAX-RS resource tradisional sering ditulis blocking:

```java
@GET
@Path("/{id}")
public Order getOrder(@PathParam("id") String id) {
    return orderService.loadFromDatabase(id);
}
```

Ini tidak salah jika runtime thread pool memang dirancang untuk blocking workload.

Tetapi berbahaya jika request dieksekusi pada event loop yang tidak boleh blocking.

### 13.3 Virtual Threads

Di Java modern, virtual threads mengubah cost model blocking. Namun virtual threads tidak menghapus semua masalah:

- DB driver harus dipahami behavior-nya;
- synchronized pinning perlu diperhatikan;
- native calls/blocking sections bisa berdampak;
- connection pool tetap menjadi bottleneck;
- downstream timeout tetap wajib;
- concurrency limit tetap perlu.

Virtual thread bukan pengganti backpressure.

### 13.4 Invariant Praktis

Untuk setiap deployment, dokumentasikan:

| Pertanyaan | Jawaban yang Harus Ada |
|---|---|
| Thread apa yang menjalankan resource method? | nama executor/runtime |
| Apakah resource boleh blocking? | yes/no/limited |
| Berapa max concurrent request? | angka eksplisit |
| Berapa queue size? | angka eksplisit |
| Apa timeout request? | angka eksplisit |
| Apa timeout downstream? | angka eksplisit |
| Apa strategi overload? | reject/queue/degrade |

---

## 14. Invariant 12 — Timeout Harus Berlapis dan Konsisten

Deployment REST production selalu punya timeout berlapis:

```text
Client timeout
  -> DNS/connect timeout
  -> proxy timeout
  -> load balancer idle timeout
  -> servlet/container request timeout
  -> application internal timeout
  -> DB timeout
  -> downstream HTTP timeout
  -> transaction timeout
```

Kalau timeout tidak konsisten, hasilnya bisa kacau.

### 14.1 Contoh Timeout Mismatch

```text
Client waits: 30s
ALB idle timeout: 60s
App request timeout: none
DB query timeout: none
Downstream timeout: none
```

Gejala:

- client sudah menyerah;
- server masih bekerja;
- DB query masih jalan;
- thread tetap tertahan;
- retry client menciptakan duplicate load;
- incident terlihat seperti “random spike”.

### 14.2 Timeout Principle

Timeout harus mengikuti prinsip:

```text
Outer layer timeout should generally be greater than inner controlled timeout,
so the application can fail intentionally before infrastructure kills it blindly.
```

Contoh:

```text
Client timeout: 35s
Gateway timeout: 32s
Application request budget: 28s
Downstream service timeout: 5s
DB query timeout: 10s
```

Aplikasi punya kesempatan mengembalikan error yang bermakna, bukan diputus oleh proxy.

### 14.3 Invariant Praktis

Setiap deployment harus punya timeout budget:

| Layer | Timeout |
|---|---:|
| Client | 35s |
| Reverse proxy | 32s |
| App request budget | 28s |
| DB query | 10s |
| Downstream HTTP connect | 1s |
| Downstream HTTP read | 5s |
| Transaction | 25s |

Angka di atas hanya contoh. Yang penting adalah budget eksplisit.

---

## 15. Invariant 13 — Health Check Harus Membedakan Liveness dan Readiness

Health endpoint sering dianggap sederhana, tetapi deployment modern sangat bergantung padanya.

### 15.1 Liveness

Liveness menjawab:

```text
Apakah process masih hidup dan tidak stuck fatal?
```

Jika liveness gagal, orchestrator boleh restart process.

Liveness tidak boleh terlalu bergantung pada dependency external. Kalau DB down lalu liveness gagal, semua pod bisa restart storm.

### 15.2 Readiness

Readiness menjawab:

```text
Apakah instance siap menerima traffic?
```

Readiness boleh mempertimbangkan:

- app startup selesai;
- config valid;
- resource model siap;
- DB pool tersedia jika DB wajib untuk semua request;
- message broker connection jika service tidak berguna tanpanya;
- warmup selesai;
- instance sedang shutdown atau tidak.

### 15.3 Startup Probe

Startup probe berguna untuk aplikasi yang butuh waktu startup lebih lama agar tidak dibunuh liveness terlalu cepat.

### 15.4 Invariant Praktis

```text
Liveness should be conservative.
Readiness should protect users.
Startup should protect slow initialization.
```

Jangan hanya membuat `/health` yang selalu return `200 OK` lalu menganggap deployment siap.

---

## 16. Invariant 14 — Error Handling Harus Stabil Antara Local dan Production

Jersey deployment harus punya error model yang stabil.

Tanpa error model, exception bisa bocor dalam bentuk:

- HTML error page dari container;
- JSON error dari app;
- plaintext stack trace;
- gateway-generated 502;
- Jersey default error;
- custom exception mapper;
- servlet filter error;
- security framework error.

### 16.1 Error Boundary

Error bisa terjadi di beberapa titik:

```text
Before Jersey:
  proxy, load balancer, servlet filter, container

Inside Jersey:
  matching, parameter conversion, body read, validation, resource, provider

After Jersey:
  body writer, output stream, client disconnect
```

Tidak semua error bisa ditangkap oleh `ExceptionMapper`.

Contoh:

- malformed HTTP request mungkin ditolak container sebelum Jersey;
- request body terlalu besar mungkin ditolak proxy;
- TLS error terjadi sebelum aplikasi;
- client disconnect terjadi saat response write.

### 16.2 Invariant Praktis

Untuk API production, definisikan:

- error JSON schema;
- correlation ID;
- timestamp;
- error code internal;
- user-safe message;
- developer diagnostics via logs only;
- mapping untuk validation error;
- mapping untuk not found;
- mapping untuk unauthorized/forbidden;
- mapping untuk timeout;
- fallback 500;
- behavior untuk gateway/container errors.

Contoh struktur:

```json
{
  "errorId": "01HXYZ...",
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed.",
  "details": [
    {
      "field": "email",
      "reason": "must be a valid email"
    }
  ]
}
```

Deployment bagus tidak hanya membuat endpoint jalan, tetapi juga membuat kegagalan dapat dipahami.

---

## 17. Invariant 15 — Observability Harus Ada Sebelum Incident

Observability deployment minimal:

1. logs;
2. metrics;
3. traces;
4. health;
5. thread dump access;
6. heap dump strategy;
7. access log;
8. deployment metadata;
9. configuration fingerprint;
10. dependency version visibility.

### 17.1 Logs

Log harus bisa menjawab:

- request apa yang masuk?
- siapa correlation ID-nya?
- endpoint mana?
- status berapa?
- latency berapa?
- error apa?
- downstream call mana yang lambat?
- deployment version apa?

### 17.2 Metrics

Metrics minimal:

- request count by route/status;
- latency histogram;
- error rate;
- active requests;
- thread pool usage;
- queue size;
- connection pool usage;
- JVM memory;
- GC pause;
- CPU;
- file descriptor;
- downstream latency;
- timeout count.

### 17.3 Traces

Tracing penting untuk request lintas service.

Minimal:

```text
client request
  -> gateway
    -> Jersey API
      -> DB
      -> downstream service
      -> message publish
```

Tanpa tracing, deployment microservices mudah berubah menjadi black box.

### 17.4 Invariant Praktis

Setiap deployment artifact harus bisa menjawab:

```text
What version is running?
Where is it running?
What routes are active?
How many requests are failing?
Why are they failing?
Which dependency is slow?
Is the app unhealthy or is downstream unhealthy?
```

---

## 18. Invariant 16 — Classloader Boundary Harus Dipahami

Di Java deployment, classloader bukan teori akademik. Ini sumber bug production yang nyata.

### 18.1 Classloader di WAR

WAR biasanya punya classloader application sendiri.

```text
Bootstrap classloader
  -> Platform/System classloader
    -> Container classloader
      -> WebApp classloader
```

Namun detail bisa berbeda antar container.

### 18.2 Classloader di Jakarta EE Server

Application server bisa punya:

- server module classloader;
- shared library classloader;
- application classloader;
- WAR classloader;
- EAR classloader;
- parent-first atau parent-last delegation;
- isolated deployment mode.

### 18.3 Classloader di Fat Jar

Fat jar/shaded jar biasanya lebih sederhana, tetapi punya risiko:

- service descriptor merge salah;
- duplicate classes;
- relocated package rusak;
- resource file tertimpa;
- provider discovery gagal;
- `META-INF/services` tidak tergabung benar.

### 18.4 Common Classloader Symptoms

| Symptom | Kemungkinan Penyebab |
|---|---|
| `ClassCastException` terhadap class yang sama | class dimuat dua classloader berbeda |
| `NoSuchMethodError` | versi jar compile dan runtime berbeda |
| `ClassNotFoundException` | dependency tidak dikemas atau tidak disediakan container |
| `ServiceConfigurationError` | service loader descriptor rusak |
| provider tidak ditemukan | `META-INF/services` hilang/tertindih |
| leak saat redeploy | thread/static reference menahan classloader lama |

### 18.5 Invariant Praktis

Untuk production deployment, simpan dependency tree sebagai artifact audit.

Minimal:

```bash
mvn dependency:tree
```

atau:

```bash
gradle dependencies
```

Dan pastikan CI bisa mendeteksi:

- duplicate classes;
- forbidden dependencies;
- mixed `javax`/`jakarta`;
- dependency convergence failure;
- vulnerable dependency;
- incompatible servlet API;
- accidental inclusion of container-provided API.

---

## 19. Invariant 17 — Packaging Harus Sesuai Deployment Model

Packaging bukan hanya output build. Packaging adalah kontrak dengan runtime.

### 19.1 Common Packaging Models

| Packaging | Runtime Owner | Cocok Untuk |
|---|---|---|
| WAR | external servlet/Jakarta EE container | enterprise/classic deployment |
| executable jar | app owns process | embedded server/cloud-native |
| fat jar | app owns all dependencies | simple ops, container image |
| thin jar + lib directory | app owns process, dependencies externalized | controlled enterprise runtime |
| EAR | app server owns multi-module app | legacy enterprise suite |
| container image | orchestrator runs process | Kubernetes/cloud |
| native image | binary runtime | fast startup/small footprint, with constraints |

### 19.2 Packaging Mismatch

Contoh buruk:

```text
WAR includes servlet API implementation.
```

Atau:

```text
Fat jar excludes Jersey container adapter.
```

Atau:

```text
Jakarta EE server receives app with duplicate Jakarta REST implementation.
```

Atau:

```text
Shaded jar loses META-INF/services provider descriptors.
```

### 19.3 Invariant Praktis

Sebelum release, artifact harus dicek:

```text
[ ] artifact type matches deployment model
[ ] required container adapter included
[ ] forbidden container APIs not packaged
[ ] provider service files preserved
[ ] no mixed javax/jakarta dependencies
[ ] manifest/main class correct if executable
[ ] config externalization works
[ ] health endpoint works after packaging
[ ] startup works from clean runtime, not IDE only
```

---

## 20. Invariant 18 — Deployment Harus Reproducible

Deployment yang tidak reproducible membuat debugging sulit.

Aplikasi harus bisa dibangun ulang dari:

- source commit;
- build tool version;
- Java version;
- dependency lock;
- container base image;
- config template;
- deployment manifest.

### 20.1 Reproducibility Questions

1. Bisa tahu commit mana yang sedang running?
2. Bisa rebuild artifact yang sama?
3. Dependency version locked atau floating?
4. Base image pinned atau `latest`?
5. Build memakai Java version yang sama dengan runtime?
6. Artifact dipromosikan antar environment atau rebuild per environment?
7. Config environment dipisah dari binary?
8. Deployment manifest versioned?

### 20.2 Invariant Praktis

Deployment artifact harus membawa metadata:

```text
application.name
application.version
build.commit
build.time
build.java.version
runtime.java.version
jersey.version
deployment.model
namespace.mode
```

Bisa diekspos di endpoint internal seperti:

```text
/internal/info
```

Dengan catatan jangan membocorkan info sensitif ke public.

---

## 21. Invariant 19 — Security Boundary Harus Eksplisit

Dalam Jersey deployment, security bisa berada di beberapa layer:

```text
Client
  -> CDN/WAF
    -> API Gateway
      -> Reverse Proxy
        -> Servlet Container
          -> Jersey Filter
            -> Resource Authorization
              -> Service Method Authorization
                -> Database Row-Level Constraint
```

Masalah muncul ketika tim mengira security sudah ditangani layer lain, padahal belum.

### 21.1 Security Ownership Questions

1. Siapa melakukan TLS termination?
2. Apakah internal hop juga TLS/mTLS?
3. Siapa melakukan authentication?
4. Siapa melakukan authorization?
5. Apakah app memvalidasi token sendiri?
6. Apakah gateway hanya meneruskan identity header?
7. Apakah header identity bisa dipalsukan dari internal network?
8. Apakah CORS dikontrol gateway atau app?
9. Apakah CSRF relevan untuk client browser?
10. Apakah audit trail mencatat principal yang benar?

### 21.2 Invariant Praktis

Jangan hanya berkata:

```text
Security handled by gateway.
```

Harus lebih spesifik:

```text
Gateway validates JWT signature and issuer.
Gateway forwards principal via signed internal header.
Application verifies gateway-originated header only from trusted network.
Application still performs resource-level authorization.
Audit log stores authenticated subject and authorization decision.
```

Security boundary yang tidak eksplisit adalah sumber vulnerability.

---

## 22. Invariant 20 — Deployment Harus Punya Failure Model

Top engineer tidak hanya bertanya “bagaimana cara deploy?” tetapi juga:

```text
Bagaimana deployment ini gagal?
Bagaimana kita tahu gagal?
Bagaimana sistem pulih?
Apa dampak user?
Apa rollback path?
```

### 22.1 Failure Categories

| Category | Example |
|---|---|
| Build failure | dependency conflict, test fail |
| Packaging failure | missing provider, wrong scope |
| Startup failure | port conflict, config invalid |
| Routing failure | wrong context path, proxy rewrite |
| Runtime failure | thread exhaustion, memory leak |
| Dependency failure | DB down, identity provider timeout |
| Security failure | token validation broken |
| Observability failure | logs missing, metrics wrong |
| Shutdown failure | request cut, stuck thread |
| Rollback failure | DB migration incompatible |

### 22.2 Failure-First Deployment Design

Untuk setiap deployment model, definisikan:

```text
Known failure modes
Detection signal
Blast radius
Automatic recovery
Manual recovery
Rollback strategy
Data safety consideration
```

Contoh:

| Failure | Signal | Recovery |
|---|---|---|
| Provider not registered | startup test fails | fail deployment before traffic |
| DB unavailable | readiness false | do not route traffic |
| thread pool exhausted | active threads max + latency | shed load / scale / fix bottleneck |
| wrong servlet mapping | integration test 404 | block promotion |
| memory leak redeploy | heap/classloader growth | full restart + leak fix |

---

## 23. Deployment Invariant Checklist

Gunakan checklist ini setiap kali memilih atau mengevaluasi Jersey deployment.

### 23.1 Runtime Ownership

```text
[ ] Process owner jelas.
[ ] HTTP listener owner jelas.
[ ] Jersey runtime owner jelas.
[ ] DI owner jelas.
[ ] Config owner jelas.
[ ] Shutdown owner jelas.
```

### 23.2 Version and Namespace

```text
[ ] Java target jelas.
[ ] Jersey major version jelas.
[ ] javax/jakarta mode jelas.
[ ] Servlet API version compatible.
[ ] Jakarta REST/JAX-RS API compatible.
[ ] Container version compatible.
```

### 23.3 Dependency and Packaging

```text
[ ] Dependency tree clean.
[ ] API vs implementation ownership jelas.
[ ] provided/compile/runtime scope benar.
[ ] No duplicate Jersey runtime unless intentional.
[ ] No mixed javax/jakarta dependency.
[ ] Provider dependencies included.
[ ] Service loader descriptors preserved.
```

### 23.4 Application Registration

```text
[ ] Resource registration deterministic.
[ ] Provider registration deterministic.
[ ] Auto-discovery controlled.
[ ] Package scanning deliberate.
[ ] Startup validates expected resources/providers.
```

### 23.5 Routing

```text
[ ] External path documented.
[ ] Proxy rewrite documented.
[ ] Context path documented.
[ ] Servlet mapping documented.
[ ] Resource path documented.
[ ] Health path reachable.
```

### 23.6 Lifecycle

```text
[ ] Startup phases observable.
[ ] Readiness true only after app ready.
[ ] Liveness not tied blindly to external dependency.
[ ] Graceful shutdown implemented.
[ ] Resource cleanup implemented.
```

### 23.7 Threading and Timeout

```text
[ ] Request thread model known.
[ ] Blocking boundary known.
[ ] Max concurrency known.
[ ] Queue behavior known.
[ ] Timeout budget defined.
[ ] Overload behavior defined.
```

### 23.8 Security

```text
[ ] TLS boundary known.
[ ] Authentication owner known.
[ ] Authorization owner known.
[ ] Header trust model known.
[ ] CORS/CSRF decision known.
[ ] Audit principal reliable.
```

### 23.9 Observability

```text
[ ] Access logs available.
[ ] Structured app logs available.
[ ] Metrics available.
[ ] Tracing available where needed.
[ ] Deployment metadata visible.
[ ] Diagnostic artifacts collectable.
```

### 23.10 Failure and Recovery

```text
[ ] Known failure modes listed.
[ ] Detection signals mapped.
[ ] Rollback path defined.
[ ] Blast radius understood.
[ ] Runbook exists.
```

---

## 24. Practical Example: Membaca Deployment Jersey Secara Sistematis

Misalkan ada aplikasi:

```text
Java 17
Jersey 3.1.x
Tomcat 10
WAR deployment
nginx reverse proxy
Kubernetes
```

Jangan langsung bertanya:

```text
Kenapa endpoint 404?
```

Mulai dari invariant:

### 24.1 Version/Namespace

```text
Java 17 -> ok for Jersey 3.x
Jersey 3.x -> jakarta.ws.rs
Tomcat 10 -> jakarta.servlet
```

Namespace cocok.

### 24.2 Runtime Ownership

```text
Kubernetes owns pod lifecycle.
Tomcat owns process HTTP connector and servlet lifecycle.
Jersey owns REST dispatch.
App owns resources/providers.
```

Jelas.

### 24.3 Packaging

```text
WAR should include Jersey runtime and container servlet adapter.
WAR should not package servlet implementation.
```

Cek dependency tree.

### 24.4 Routing

```text
External: /aceas/api/cases/123
nginx strips /aceas
Tomcat context path: /aceas or ROOT?
Servlet mapping: /api/*
Resource path: /cases/{id}
```

Jika nginx strip `/aceas` tetapi Tomcat juga context `/aceas`, bisa mismatch.

### 24.5 Registration

```text
ResourceConfig packages("com.example.api")
CaseResource inside com.example.case.api?
```

Jika package tidak tercakup, endpoint tidak terdaftar.

### 24.6 Provider

```text
Jackson provider included?
Exception mapper registered?
Auth filter registered?
```

Jika JSON provider hilang, request GET mungkin jalan, POST JSON gagal.

### 24.7 Health

```text
Readiness calls /internal/ready
But servlet mapping only /api/*
```

Jika health endpoint bukan servlet/Jersey path yang benar, probe gagal.

Dari sini debugging menjadi terstruktur.

---

## 25. Practical Example: Embedded Jersey Service

Misalkan:

```text
Java 21
Jersey 3.1.x
Embedded Grizzly
Executable jar
Docker
```

### 25.1 Runtime Ownership

```text
main() owns process.
Grizzly owns HTTP listener.
Jersey owns REST dispatch.
Application owns lifecycle glue.
Docker owns process supervision.
```

Karena tidak ada servlet container external, aplikasi harus mengurus:

- port binding;
- startup log;
- shutdown hook;
- graceful shutdown;
- config loading;
- signal handling;
- health endpoint;
- packaging all runtime dependencies.

### 25.2 Packaging

Executable jar harus membawa:

- Jersey server;
- Grizzly container adapter;
- JSON provider;
- injection provider;
- validation provider jika perlu;
- application classes;
- service loader resources.

Jika fat jar dibuat dengan shading, pastikan `META-INF/services` benar.

### 25.3 Threading

Grizzly worker thread pool harus disesuaikan dengan workload.

Jika resource blocking DB, jangan konfigurasi seolah workload purely non-blocking.

### 25.4 Shutdown

Docker/Kubernetes mengirim SIGTERM. Java process harus menangkap shutdown dan memberi waktu request selesai.

Jika tidak, rolling update bisa memutus request aktif.

---

## 26. Practical Example: Jakarta EE Managed Deployment

Misalkan:

```text
Java 21
Jersey 4.x or server-provided Jakarta REST 4.0
Jakarta EE 11 server
WAR deployment
CDI
JTA
Security managed by server
```

### 26.1 Runtime Ownership

```text
Application server owns HTTP, servlet, CDI, transactions, security.
Jakarta REST runtime owns resource dispatch.
Application owns business code.
```

Dalam model ini, membawa dependency Jersey sendiri bisa menjadi keputusan berisiko jika server sudah menyediakan Jakarta REST implementation.

### 26.2 DI Boundary

Resource bisa CDI-managed.

Maka injection, scope, interceptor, transaction, dan security context mengikuti aturan container.

### 26.3 Deployment Consequence

Keuntungan:

- managed resources;
- standardized enterprise services;
- less custom infrastructure code;
- good for enterprise integration.

Risiko:

- classloader complexity;
- server-specific behavior;
- slower upgrade cycle;
- dependency conflict;
- redeploy leak jika app membuat unmanaged threads/static references.

---

## 27. The “Top 1%” Lens: Cara Berpikir Saat Deployment Bermasalah

Engineer rata-rata melihat deployment sebagai file konfigurasi.

Engineer kuat melihat deployment sebagai kontrak sistem.

### 27.1 Jangan Tanya Hanya “Apa Errornya?”

Tanya:

```text
Invariant mana yang rusak?
```

- Namespace?
- Runtime ownership?
- Dependency scope?
- Classloader?
- Resource registration?
- Servlet mapping?
- DI boundary?
- Provider pipeline?
- Threading?
- Timeout?
- Health?
- Security?
- Shutdown?

### 27.2 Jangan Percaya “Works on My Machine”

Local run sering berbeda dari production:

| Local | Production |
|---|---|
| IDE classpath | packaged artifact |
| direct port | reverse proxy |
| no context path | context path |
| no TLS | TLS terminated |
| simple env var | secret/config platform |
| one instance | multiple replicas |
| no rolling update | rolling update |
| visible stack trace | sanitized logs |
| single classloader | container classloader |

Deployment yang benar harus diuji dalam model yang mendekati production.

### 27.3 Jangan Menyembunyikan Keputusan Deployment

Keputusan deployment harus ditulis.

Contoh dokumen pendek:

```text
Deployment Model:
  WAR on Tomcat 10.1

Java:
  21

Jersey:
  3.1.x

Namespace:
  jakarta

Container Ownership:
  Tomcat owns Servlet lifecycle.
  App packages Jersey runtime.

Routing:
  External /api/* -> Tomcat context ROOT -> Jersey servlet /api/*

DI:
  Jersey HK2 only, no CDI.

JSON:
  Jackson provider explicitly registered.

Health:
  /internal/live, /internal/ready

Shutdown:
  Tomcat graceful shutdown + app-managed client cleanup.
```

Dokumen seperti ini mengurangi debugging 10x.

---

## 28. Common Anti-Patterns yang Harus Dihindari

### 28.1 “Tambahkan Dependency Sampai Jalan”

Ini menghasilkan dependency tree yang penuh konflik.

Solusi:

- mulai dari deployment model;
- tentukan dependency minimum;
- gunakan BOM jika tersedia;
- audit dependency tree;
- enforce convergence.

### 28.2 “Pakai Package Scanning Semua Package”

Contoh buruk:

```java
packages("com.example");
```

Pada project besar, ini bisa membawa terlalu banyak class.

Solusi:

- scan package API spesifik;
- explicit register provider penting;
- test expected resource.

### 28.3 “Health Check Selalu 200”

Ini membuat orchestrator tidak bisa membedakan healthy dan broken.

Solusi:

- pisahkan liveness/readiness;
- readiness false saat shutdown;
- readiness validasi dependency kritikal secara hati-hati.

### 28.4 “Semua Error Ditangkap Generic Throwable Mapper”

Generic mapper bisa menutupi validation, auth, dan not found semantics.

Solusi:

- mapper spesifik dulu;
- fallback terakhir;
- logging dengan correlation ID;
- response user-safe.

### 28.5 “Tidak Ada Timeout”

Tanpa timeout, thread bisa tertahan tak terbatas.

Solusi:

- request budget;
- downstream timeout;
- DB timeout;
- proxy timeout alignment;
- overload behavior.

### 28.6 “Static Singleton untuk Semua Hal”

Static singleton di container deployment rawan leak saat redeploy.

Solusi:

- gunakan lifecycle container;
- close resource;
- hindari unmanaged threads;
- hindari static reference ke app classloader.

### 28.7 “Security Sudah di Gateway”

Pernyataan ini terlalu umum.

Solusi:

- definisikan authN/authZ split;
- validasi trust boundary;
- jangan percaya header tanpa proteksi;
- audit principal di app.

---

## 29. Deployment Invariant Decision Table

Gunakan tabel ini saat memilih deployment model.

| Constraint | Invariant yang Paling Penting |
|---|---|
| Java 8 legacy | namespace `javax`, Jersey 2.x, old servlet compatibility |
| Migrasi ke Jakarta | no mixed namespace, dependency convergence |
| WAR external Tomcat | servlet mapping, dependency scope, context path |
| Jakarta EE server | server-provided APIs, CDI/JTA/security ownership |
| Embedded service | process lifecycle, shutdown, packaged dependencies |
| Kubernetes | readiness, graceful termination, config/secrets, probes |
| Reverse proxy | forwarded headers, path rewrite, timeout alignment |
| High throughput | threading, queue, timeout, JSON provider, metrics |
| Regulated system | deterministic registration, audit logs, reproducible build |
| Multi-team platform | documented ownership, version matrix, standardized packaging |

---

## 30. Summary

Deployment Jersey yang kuat tidak dimulai dari memilih Tomcat, Jetty, Grizzly, atau Kubernetes.

Deployment yang kuat dimulai dari invariant:

1. Runtime ownership jelas.
2. Namespace konsisten.
3. API/implementation/container ownership jelas.
4. Resource registration deterministic.
5. Routing external sampai resource path konsisten.
6. Provider pipeline stabil.
7. DI boundary eksplisit.
8. Configuration precedence bisa diaudit.
9. Startup deterministic dan observable.
10. Shutdown graceful.
11. Threading model diketahui.
12. Timeout berlapis dan konsisten.
13. Health check membedakan liveness/readiness.
14. Error handling stabil.
15. Observability tersedia sebelum incident.
16. Classloader boundary dipahami.
17. Packaging sesuai deployment model.
18. Deployment reproducible.
19. Security boundary eksplisit.
20. Failure model tersedia.

Kalau invariant ini kuat, deployment model apa pun bisa dianalisis secara rasional.

Kalau invariant ini lemah, setiap deployment berubah menjadi trial-and-error.

---

## 31. Latihan Pemahaman

### Latihan 1 — Identifikasi Ownership

Ambil satu aplikasi Jersey yang pernah kamu lihat. Jawab:

1. Siapa process owner?
2. Siapa HTTP owner?
3. Siapa servlet/filter owner?
4. Siapa Jersey runtime owner?
5. Siapa DI owner?
6. Siapa config owner?
7. Siapa shutdown owner?

Jika ada jawaban ambigu, itu titik risiko.

### Latihan 2 — Trace Path

Untuk satu endpoint production, tulis lengkap:

```text
External URL:
Proxy rewrite:
Container context path:
Servlet mapping:
Application path:
Resource class:
Resource method:
```

Jika tidak bisa ditulis, routing belum benar-benar dipahami.

### Latihan 3 — Dependency Ownership

Buat tabel:

```text
Servlet API
Jakarta REST/JAX-RS API
Jersey server
Jersey container adapter
JSON provider
Validation provider
DI provider
Logging bridge
```

Untuk masing-masing, tulis:

```text
compile owner
runtime owner
packaged or provided
version
reason
```

### Latihan 4 — Failure Model

Pilih satu failure:

- wrong servlet mapping;
- missing JSON provider;
- DB unavailable;
- classpath conflict;
- thread pool exhausted;
- readiness false-positive.

Untuk failure tersebut, tulis:

```text
Detection:
Impact:
Mitigation:
Rollback:
Prevention:
```

---

## 32. Referensi

- Eclipse Jersey Documentation — Application Deployment and Runtime Environments: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Eclipse Jersey Documentation — Modules and Dependencies: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/modules-and-dependencies.html
- Eclipse Jersey 3.1.11 Release Information: https://projects.eclipse.org/projects/ee4j.jersey/releases/3.1.11
- Eclipse Jersey 4.0.0 Release Information: https://projects.eclipse.org/projects/ee4j.jersey/releases/4.0.0-0
- Jakarta RESTful Web Services 4.0 Specification Page: https://jakarta.ee/specifications/restful-ws/4.0/

---

## 33. Status Seri

Seri **Java Eclipse Jersey Deployment Models** belum selesai.

Progress saat ini:

```text
Part 0  — Orientation: Mental Model Deployment Jersey dari Java 8 sampai Java 25
Part 1  — Version Matrix: Java 8–25, Jersey 2.x/3.x/4.x, javax.* vs jakarta.*
Part 2  — Deployment Invariants: Apa yang Tidak Boleh Salah di Semua Model
```

Berikutnya:

```text
Part 3 — The Hosting Contract: Bagaimana Request Masuk ke Jersey
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-001.md">⬅️ Part 1 — Version Matrix: Java 8–25, Jersey 2.x/3.x/4.x, `javax.*` vs `jakarta.*`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-003.md">Part 3 — The Hosting Contract: Bagaimana Request Masuk ke Jersey ➡️</a>
</div>
