# learn-java-eclipse-jersey-deployment-models-part-000

# Part 0 — Orientation: Mental Model Deployment Jersey dari Java 8 sampai Java 25

> Seri: **Java Eclipse Jersey Deployment Models**  
> Target: engineer yang ingin memahami deployment Jersey bukan sekadar “bisa jalan”, tetapi mampu mendesain, mendiagnosis, memigrasikan, dan mempertanggungjawabkan runtime REST API Java di berbagai model deployment.  
> Scope Java: **Java 8 sampai Java 25**  
> Scope Jersey: terutama **Jersey 2.x, 3.x, 4.x**  
> Fokus part ini: **mental model**, vocabulary, peta model deployment, invariant teknis, dan cara berpikir sebelum masuk ke detail per model.

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan tidak lagi melihat Jersey sebagai sekadar dependency Maven seperti:

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet</artifactId>
</dependency>
```

atau sekadar class seperti:

```java
public class MyApplication extends ResourceConfig {
    public MyApplication() {
        packages("com.example.api");
    }
}
```

Kita akan membangun mental model bahwa Jersey deployment adalah proses menempelkan **JAX-RS / Jakarta REST runtime** ke sebuah **HTTP hosting environment**.

Dengan mental model itu, kamu bisa menjawab pertanyaan seperti:

1. Kenapa aplikasi Jersey bisa berjalan di Tomcat, Jetty, Grizzly, JDK HTTP Server, GlassFish, Payara, Open Liberty, atau Kubernetes container?
2. Kenapa deployment Jersey 2 di Java 8 berbeda secara fundamental dari Jersey 3/4 di Java 17/21/25?
3. Apa sebenarnya perbedaan antara WAR deployment, servlet deployment, filter deployment, embedded deployment, fat jar, thin jar, dan Jakarta EE deployment?
4. Kenapa error `ClassNotFoundException`, `NoSuchMethodError`, `404`, `415`, `500`, atau injection failure sering sebenarnya bukan bug resource, melainkan bug deployment model?
5. Bagaimana cara memilih deployment model yang benar untuk legacy enterprise, regulated system, cloud-native service, atau internal lightweight API?

Part ini belum membahas semua konfigurasi secara detail. Detail teknis akan dipecah ke part berikutnya. Part ini adalah fondasi berpikirnya.

---

## 1. Satu Kalimat Inti

**Jersey adalah implementation/runtime untuk JAX-RS/Jakarta REST; deployment model adalah cara runtime itu dipasang ke HTTP server atau application container yang menerima request sebenarnya.**

Artinya:

- Jersey bukan TCP server secara intrinsik.
- Jersey bukan servlet container.
- Jersey bukan Tomcat.
- Jersey bukan Jetty.
- Jersey bukan Kubernetes runtime.
- Jersey bukan API Gateway.
- Jersey adalah runtime yang mengubah deklarasi resource Java menjadi pipeline request-response REST.

Contoh resource:

```java
@Path("/hello")
public class HelloResource {

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String hello() {
        return "hello";
    }
}
```

Resource ini tidak bisa menerima HTTP request sendirian. Harus ada lapisan lain yang menerima HTTP request, lalu meneruskannya ke Jersey.

Lapisan itu bisa berupa:

- Servlet container: Tomcat, Jetty, Undertow, servlet layer dalam GlassFish/Payara/Open Liberty/WildFly.
- Embedded HTTP server: Grizzly, Jetty embedded, JDK HTTP Server, Netty.
- Full Jakarta EE runtime: GlassFish, Payara, Open Liberty, WildFly, WebLogic, WebSphere.
- Container image + orchestration: Docker/Kubernetes, biasanya tetap menjalankan salah satu dari runtime di atas.

---

## 2. Deployment Bukan Sekadar Packaging

Banyak engineer menyamakan deployment dengan “membuat artifact”. Ini kurang tepat.

Artifact adalah hasil build:

- `.war`
- `.jar`
- shaded jar
- distribution zip/tar
- container image
- native binary

Deployment model lebih luas. Deployment model menjawab:

1. Siapa yang membuka port HTTP?
2. Siapa yang mengelola thread request?
3. Siapa yang membuat instance Jersey runtime?
4. Siapa yang memanggil Jersey ketika request masuk?
5. Siapa yang mengelola classloader?
6. Siapa yang mengatur lifecycle startup/shutdown?
7. Siapa yang menyediakan dependency injection?
8. Siapa yang mengatur security context?
9. Siapa yang melakukan logging akses?
10. Siapa yang mengelola TLS, HTTP/2, compression, upload limit, dan timeout?
11. Siapa yang memutuskan kapan aplikasi dianggap ready?
12. Siapa yang mengalirkan signal shutdown?
13. Siapa yang bertanggung jawab saat terjadi memory leak ketika redeploy?

Artifact hanya salah satu aspek. Dua aplikasi bisa sama-sama berbentuk `.jar`, tetapi deployment modelnya berbeda total:

```text
Model A:
java -jar app.jar
  -> embedded Grizzly
  -> Jersey ResourceConfig
  -> application resources

Model B:
java -jar app.jar
  -> embedded Jetty servlet server
  -> ServletContainer
  -> Jersey ResourceConfig
  -> application resources

Model C:
java -jar app.jar
  -> Spring Boot embedded Tomcat
  -> Jersey servlet registration
  -> Jersey resources
```

Ketiganya sama-sama jar, tetapi request path, lifecycle, classloading, observability, dan tuning-nya berbeda.

---

## 3. Jersey dalam Tiga Lapisan Mental

Bayangkan Jersey deployment sebagai tiga lapisan:

```text
┌──────────────────────────────────────────────────────────────┐
│ Application Layer                                             │
│ Resource, Provider, Filter, ExceptionMapper, DTO, Service     │
└───────────────────────────────▲──────────────────────────────┘
                                │
┌───────────────────────────────┴──────────────────────────────┐
│ Jersey Runtime Layer                                          │
│ ResourceConfig, ApplicationHandler, Injection, Routing, MBR/W │
└───────────────────────────────▲──────────────────────────────┘
                                │
┌───────────────────────────────┴──────────────────────────────┐
│ Hosting / Deployment Layer                                    │
│ Servlet Container, Grizzly, Jetty, Netty, JDK HTTP, EE Server │
└──────────────────────────────────────────────────────────────┘
```

Penjelasan:

### 3.1 Application Layer

Ini kode bisnis dan HTTP contract milik aplikasimu:

- `@Path`
- `@GET`, `@POST`, `@PUT`, `@DELETE`
- `@Consumes`
- `@Produces`
- `ContainerRequestFilter`
- `ContainerResponseFilter`
- `ExceptionMapper`
- `MessageBodyReader`
- `MessageBodyWriter`
- DTO JSON/XML
- service/domain layer
- validation
- auth principal mapping

Layer ini sering dipikirkan developer sebagai “Jersey app”. Padahal ini baru aplikasi yang dijalankan oleh Jersey.

### 3.2 Jersey Runtime Layer

Ini runtime Jersey yang melakukan pekerjaan JAX-RS/Jakarta REST:

- Membaca resource class.
- Membangun routing table.
- Menjalankan matching method berdasarkan HTTP method, path, media type, dan parameter.
- Memanggil filter dan interceptor.
- Mengelola provider.
- Melakukan entity serialization/deserialization.
- Mengubah exception menjadi response.
- Mengelola injection internal melalui HK2/CDI bridge tergantung setup.
- Menghubungkan context seperti request, URI info, headers, security context.

### 3.3 Hosting / Deployment Layer

Ini lapisan yang sering diabaikan, padahal paling menentukan behavior production:

- Servlet engine menerima HTTP request.
- Connector membaca socket.
- Thread pool memilih worker.
- HTTP parser membuat request object.
- Filter chain berjalan.
- Servlet mapping menentukan apakah request diteruskan ke Jersey.
- Jersey adapter mengubah request container menjadi request Jersey.
- Response ditulis balik ke container.

Di embedded model, hosting layer bisa dibuat sendiri lewat kode `main()`.

Di WAR model, hosting layer disediakan oleh container eksternal.

Di Jakarta EE server, hosting layer juga mengelola banyak hal lain: CDI, transaction, security, JNDI, pooling, classloader, monitoring, deployment lifecycle.

---

## 4. Deployment-Agnostic Application Model

Konsep paling penting dalam JAX-RS/Jakarta REST adalah `Application`.

Secara ide, `Application` adalah deklarasi “apa isi aplikasi REST ini”. Ia tidak peduli apakah nanti dijalankan di Tomcat, Grizzly, Jetty, GlassFish, atau test runtime.

Contoh minimal:

```java
public class ApiApplication extends Application {
    @Override
    public Set<Class<?>> getClasses() {
        Set<Class<?>> classes = new HashSet<>();
        classes.add(HelloResource.class);
        classes.add(GlobalExceptionMapper.class);
        return classes;
    }
}
```

Jersey menyediakan `ResourceConfig`, implementasi yang lebih praktis:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HelloResource.class);
        register(GlobalExceptionMapper.class);
    }
}
```

atau:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Mental model-nya:

```text
Application / ResourceConfig
    = daftar resource + provider + feature + property
    = model aplikasi REST
    ≠ server
    ≠ container
    ≠ deployment artifact
```

Kesalahan umum:

```text
“Saya sudah buat ResourceConfig, kenapa endpoint tidak jalan?”
```

Jawabannya bisa banyak:

- ResourceConfig tidak pernah didaftarkan ke servlet.
- Servlet mapping salah.
- Package scanning tidak menemukan class.
- Container memakai Jersey versi lain.
- `javax.*` dan `jakarta.*` tercampur.
- WAR tidak memuat dependency yang dibutuhkan.
- Resource class berada di classloader yang tidak terlihat oleh Jersey.
- Request path tidak masuk ke Jersey karena context path/proxy rewrite.

---

## 5. Empat Keluarga Besar Deployment Jersey

Untuk seri ini, kita bagi deployment Jersey menjadi empat keluarga utama.

```text
1. Servlet-based deployment
2. Embedded / Java SE deployment
3. Jakarta EE managed deployment
4. Cloud/containerized operational deployment
```

Keempatnya bukan saling eksklusif sepenuhnya. Kubernetes, misalnya, bisa menjalankan WAR di Tomcat, fat jar embedded Jetty, atau Jakarta EE server image.

---

## 6. Keluarga 1 — Servlet-Based Deployment

Ini model paling klasik dan paling banyak ditemui.

Request flow:

```text
Client
  -> TCP/TLS
  -> HTTP connector
  -> Servlet container
  -> Filter chain
  -> Jersey ServletContainer
  -> Jersey runtime
  -> Resource method
```

Artifact umum:

```text
app.war
```

Struktur umum:

```text
my-api.war
├── index.html / static files optional
└── WEB-INF
    ├── web.xml
    ├── classes
    │   └── com/example/api/...
    └── lib
        ├── jersey-container-servlet-...
        ├── jersey-server-...
        └── provider libraries...
```

Atau tanpa `web.xml`, menggunakan annotation/config programmatic.

### 6.1 Jersey sebagai Servlet

Jersey bisa dipasang sebagai servlet:

```xml
<servlet>
    <servlet-name>Jersey</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.ApiApplication</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>Jersey</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Untuk Jersey 2.x lama, nama package API dan beberapa parameter berada di dunia `javax.*`; untuk Jersey 3.x/4.x, dunia modernnya adalah `jakarta.*`.

### 6.2 Jersey sebagai Filter

Jersey juga bisa dipasang sebagai servlet filter. Model ini berguna ketika Jersey harus hidup di dalam filter chain tertentu atau harus melakukan routing yang berinteraksi dengan static content/servlet lain.

Flow-nya:

```text
Client
  -> Servlet container
  -> Filter A
  -> Jersey Filter
  -> maybe Servlet / static resource / Jersey resource
```

Risikonya:

- Filter ordering salah.
- Security filter berjalan sebelum/after Jersey secara tidak sesuai.
- Static resource tertelan oleh Jersey.
- Error 404 menjadi ambigu: apakah dari container, static handler, atau Jersey?

### 6.3 Cocok untuk Apa?

Servlet-based deployment cocok untuk:

- Enterprise Java legacy.
- Aplikasi yang sudah standardize di Tomcat/Jetty.
- Tim ops yang paham WAR deployment.
- Lingkungan dengan existing servlet filters/security/compression/access logging.
- Migrasi incremental dari Java EE/Jakarta EE.

Tidak selalu cocok untuk:

- Service kecil yang ingin self-contained process.
- Runtime minimal yang ingin cepat start tanpa external app server.
- Deployment model yang ingin artifact tunggal `java -jar`.

---

## 7. Keluarga 2 — Embedded / Java SE Deployment

Dalam embedded model, aplikasi punya `main()` dan membuat HTTP server sendiri.

Contoh mental flow:

```text
public static void main(String[] args)
  -> build ResourceConfig
  -> create embedded HTTP server
  -> bind host/port
  -> start server
  -> wait for shutdown signal
```

Flow request:

```text
Client
  -> embedded HTTP server
  -> Jersey container adapter
  -> Jersey runtime
  -> Resource method
```

Contoh dengan gaya Grizzly:

```java
public final class Main {
    public static void main(String[] args) throws Exception {
        ResourceConfig config = new ResourceConfig()
            .packages("com.example.api");

        URI baseUri = URI.create("http://0.0.0.0:8080/");

        HttpServer server = GrizzlyHttpServerFactory.createHttpServer(baseUri, config);

        Runtime.getRuntime().addShutdownHook(new Thread(server::shutdownNow));

        Thread.currentThread().join();
    }
}
```

### 7.1 Embedded Server Pilihan

Jersey menyediakan container integration untuk beberapa server/runtime, tergantung generasi Jersey:

- Grizzly HTTP
- Grizzly Servlet
- JDK HTTP Server
- Jetty HTTP Server
- Jetty Servlet
- Netty HTTP
- Simple HTTP pada generasi tertentu

Tetapi jangan hanya bertanya “Jersey support apa?”. Pertanyaan deployment yang lebih benar:

1. Server mana yang thread model-nya cocok dengan workload?
2. Apakah butuh Servlet API atau cukup HTTP adapter?
3. Apakah butuh HTTP/2?
4. Apakah butuh TLS langsung di app atau TLS termination di proxy?
5. Apakah butuh access log production-grade?
6. Apakah butuh graceful shutdown yang bisa dikontrol penuh?
7. Apakah tim ops sanggup mengoperasikan runtime ini?
8. Apakah dependency-nya kompatibel dengan Java target?

### 7.2 Cocok untuk Apa?

Embedded deployment cocok untuk:

- Microservice self-contained.
- Internal service ringan.
- CLI/server hybrid.
- Test harness.
- Local dev cepat.
- Container image yang menjalankan satu process.
- Deployment yang ingin menghindari external app server.

Risikonya:

- Kamu menjadi “pemilik” lifecycle server.
- Kamu harus mengatur shutdown, signal, thread, port, health, TLS, logging, dan config sendiri.
- Beberapa fitur enterprise container tidak tersedia otomatis.
- Debugging production bisa sulit jika observability tidak dipasang sejak awal.

---

## 8. Keluarga 3 — Jakarta EE Managed Deployment

Dalam model ini, Jersey/Jakarta REST berjalan sebagai bagian dari application server atau runtime Jakarta EE.

Contoh runtime:

- GlassFish
- Payara
- Open Liberty
- WildFly
- WebLogic
- WebSphere Liberty

Flow request:

```text
Client
  -> application server connector
  -> servlet/web container
  -> Jakarta REST implementation
  -> CDI/security/transaction integration
  -> Resource method
```

Di sini, deployment tidak hanya soal HTTP. Runtime juga bisa mengelola:

- CDI
- Jakarta Security
- Jakarta Transactions
- Jakarta Persistence
- Jakarta Validation
- JNDI resources
- connection pools
- managed executor
- application lifecycle
- admin console/config
- clustering/session/security realm

### 8.1 Jersey di Jakarta EE Server

Jersey adalah reference/implementation yang erat sejarahnya dengan GlassFish/Payara. Tetapi dalam Jakarta EE ecosystem, tidak semua server memakai Jersey. WildFly, misalnya, historisnya memakai RESTEasy.

Maka pertanyaan penting:

```text
Apakah server menyediakan Jersey sebagai implementation bawaan,
atau aplikasi membawa Jersey sendiri di WEB-INF/lib?
```

Ini berpengaruh pada:

- classloader
- dependency conflict
- provider discovery
- version mismatch
- upgrade path
- support policy
- security patching

### 8.2 Cocok untuk Apa?

Jakarta EE managed deployment cocok untuk:

- Enterprise platform dengan banyak spesifikasi Jakarta EE.
- Aplikasi yang butuh CDI/transaction/security/container-managed resource secara kuat.
- Organisasi yang sudah punya standard app server.
- Regulated environment yang ingin administrative control dan support vendor.
- Sistem besar yang tidak ingin setiap service mengurus semua aspek runtime sendiri.

Risikonya:

- Startup lebih berat.
- Classloader lebih kompleks.
- Upgrade server bisa memengaruhi banyak aplikasi.
- Bundled implementation bisa bertabrakan dengan dependency aplikasi.
- Debugging “siapa yang menyediakan class ini?” menjadi lebih sulit.

---

## 9. Keluarga 4 — Cloud / Containerized Operational Deployment

Docker/Kubernetes bukan pengganti Jersey deployment model. Ia membungkus salah satu model di atas.

Contoh:

```text
Kubernetes Pod
  -> container image
      -> java -jar app.jar
          -> embedded Grizzly
              -> Jersey
```

atau:

```text
Kubernetes Pod
  -> container image
      -> Tomcat
          -> deployed WAR
              -> Jersey ServletContainer
```

atau:

```text
Kubernetes Pod
  -> container image
      -> Open Liberty
          -> Jakarta REST app
```

Cloud-native layer menambahkan concern baru:

- readiness probe
- liveness probe
- startup probe
- graceful termination
- SIGTERM handling
- preStop hook
- load balancer draining
- container memory limit
- CPU quota
- horizontal scaling
- service discovery
- secret/config injection
- rolling update
- rollback
- image immutability
- vulnerability scanning
- runtime user non-root

### 9.1 Mental Model Production

Di production, request path sering seperti ini:

```text
Client
  -> CDN/WAF optional
  -> API Gateway / Load Balancer
  -> Ingress / Reverse Proxy
  -> Kubernetes Service
  -> Pod
  -> Java process
  -> HTTP server / servlet container
  -> Jersey adapter
  -> Jersey runtime
  -> Resource method
  -> downstream service/database
```

Bug bisa muncul di tiap titik. Engineer top-tier tidak langsung menyalahkan resource method.

Contoh `404`:

```text
404 bisa berasal dari:
- API Gateway route tidak match
- Ingress path rewrite salah
- Kubernetes service salah target port
- servlet context path beda
- servlet mapping salah
- Jersey @Path tidak match
- method HTTP tidak match
- trailing slash behavior
- resource tidak terdaftar
```

Contoh `504`:

```text
504 bisa berasal dari:
- API Gateway timeout
- ALB timeout
- nginx proxy_read_timeout
- servlet thread pool habis
- downstream DB lambat
- Jersey resource blocking terlalu lama
- connection pool starvation
- Kubernetes pod terminating saat request masih berjalan
```

---

## 10. Version Boundary: Java 8 sampai Java 25

Seri ini membahas Java 8–25, tetapi tidak berarti semua kombinasi valid.

Kamu harus berpikir dengan matrix:

```text
Java version
  × Jersey major version
  × JAX-RS/Jakarta REST API namespace
  × Servlet version
  × container/runtime version
  × dependency/provider ecosystem
```

### 10.1 Java 8 Era

Java 8 masih banyak di enterprise legacy.

Ciri umum:

- Jersey 2.x sangat relevan.
- Namespace umumnya `javax.ws.rs.*`.
- Servlet container sering Tomcat 8/9, Jetty 9, WebLogic lama, GlassFish lama.
- JPMS belum ada.
- Banyak library lama masih cocok.
- Problem umum: dependency tua, security patching, TLS/cipher defaults, JAXB availability berubah saat migrasi ke Java 11.

Contoh import:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
```

### 10.2 Java 11 Era

Java 11 adalah transisi penting:

- Banyak modul Java EE lama tidak lagi bundled di JDK.
- JAXB, activation, annotation, dan beberapa API harus eksplisit sebagai dependency.
- Banyak organisasi mulai migrasi dari Java 8.
- Jersey 2.x masih bisa digunakan, tetapi dependency harus lebih disiplin.

Masalah umum:

```text
Aplikasi jalan di Java 8, gagal di Java 11 karena JAXB/activation tidak ada.
```

Deployment insight:

```text
Saat upgrade Java, jangan hanya test resource endpoint.
Test startup classpath, provider discovery, JSON/XML binding, multipart, validation,
reflection, TLS, logging, metrics, and shutdown behavior.
```

### 10.3 Java 17/21 Era

Java 17 dan 21 menjadi baseline modern banyak organisasi.

Ciri umum:

- Jakarta EE 10 ecosystem matang di Java 17+.
- Jersey 3.1.x relevan untuk Jakarta REST 3.1/Jakarta EE 10.
- Namespace `jakarta.ws.rs.*`.
- Servlet 5/6 tergantung container.
- Stronger encapsulation membuat reflective access issue lebih terlihat.
- Container ergonomics JVM lebih baik dibanding era lama.
- Virtual threads tersedia sejak Java 21, tetapi pemakaiannya dalam servlet/Jersey deployment harus dianalisis berdasarkan hosting runtime.

Contoh import:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
```

### 10.4 Java 25 Era

Java 25 adalah target modern baru. Untuk deployment Jersey, dampaknya bukan berarti resource code berubah drastis, tetapi keputusan runtime menjadi lebih serius:

- Apakah container/runtime sudah tested dengan Java 25?
- Apakah bytecode target sesuai?
- Apakah dependency ASM/bytecode scanning compatible?
- Apakah framework scanning bisa membaca classfile baru?
- Apakah observability agent compatible?
- Apakah base image dan vendor JDK support policy jelas?
- Apakah GC, container memory, dan startup profile berubah?

Kesalahan umum:

```text
“JDK bisa compile, berarti runtime aman.”
```

Tidak cukup. Deployment Jersey banyak bergantung pada scanning, reflection, provider discovery, servlet adapter, JSON provider, validation provider, dan monitoring agent.

---

## 11. Namespace Boundary: `javax.*` vs `jakarta.*`

Ini salah satu sumber masalah terbesar.

### 11.1 Dunia Lama

JAX-RS lama:

```java
import javax.ws.rs.Path;
import javax.ws.rs.GET;
import javax.ws.rs.core.Response;
```

Umumnya:

- Jersey 2.x
- Java EE / Jakarta EE 8 lineage
- Servlet 3/4 era
- Tomcat 8/9 era

### 11.2 Dunia Baru

Jakarta REST modern:

```java
import jakarta.ws.rs.Path;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.core.Response;
```

Umumnya:

- Jersey 3.x/4.x
- Jakarta EE 9+ lineage
- Servlet 5+ untuk `jakarta.servlet.*`
- Tomcat 10+, Jetty 11/12+, modern Jakarta EE runtimes

### 11.3 Tidak Bisa Dicampur Sembarangan

Masalah klasik:

```java
// Resource memakai javax
import javax.ws.rs.Path;

// Runtime mencari jakarta annotation
// Hasil: resource tidak terdeteksi atau error classpath
```

atau:

```text
Tomcat 9 menggunakan javax.servlet.*
Aplikasi membawa Jersey 3 yang butuh jakarta.servlet.*
Hasil: startup failure / class not found / servlet tidak load
```

Prinsip:

```text
Dalam satu deployment boundary, pilih satu dunia API:
- javax stack
atau
- jakarta stack
```

Boundary ini mencakup:

- JAX-RS/Jakarta REST API
- Servlet API
- Validation API
- CDI API
- JSON-B/JAXB/Activation jika dipakai
- Container version
- Provider libraries
- Test libraries

---

## 12. Deployment Model vs Runtime Model vs Operational Model

Agar tidak rancu, kita pisahkan tiga istilah.

### 12.1 Deployment Model

Cara aplikasi dipasang ke runtime HTTP/container.

Contoh:

- WAR di Tomcat.
- WAR di Payara.
- Embedded Grizzly jar.
- Embedded Jetty jar.
- Jersey di JDK HTTP Server.
- Open Liberty server package.

### 12.2 Runtime Model

Bagaimana aplikasi berjalan saat menerima request.

Contoh concern:

- servlet thread per request
- event-loop + worker offload
- virtual thread
- request scope
- provider lifecycle
- singleton vs per-request resource
- blocking IO
- async response
- streaming output

### 12.3 Operational Model

Bagaimana aplikasi dioperasikan.

Contoh concern:

- Docker image
- Kubernetes deployment
- probes
- secret injection
- logs
- metrics
- tracing
- autoscaling
- deployment rollout
- canary
- rollback
- backup/restore config
- vulnerability scanning

Satu deployment model bisa punya banyak operational model.

Contoh:

```text
WAR di Tomcat:
- manual copy ke server VM
- deployed via Jenkins ke VM
- baked into Docker image
- run in Kubernetes
```

---

## 13. Request Lifecycle: Dari Network ke Resource Method

Mari lihat request lifecycle secara konseptual.

```text
1. Client membuka koneksi / memakai keep-alive
2. Load balancer menerima request
3. Reverse proxy meneruskan request
4. Java process menerima socket
5. HTTP server/container parse request
6. Container memilih worker thread / event loop
7. Servlet/filter mapping menentukan handler
8. Jersey adapter membuat ContainerRequest
9. Jersey menjalankan request filters
10. Jersey melakukan resource matching
11. Jersey membaca entity body melalui MessageBodyReader
12. Jersey memanggil resource method
13. Resource memanggil service/downstream
14. Return value diproses MessageBodyWriter
15. Response filters berjalan
16. Container menulis response ke network
17. Access log/metrics/tracing ditutup
```

Deployment model memengaruhi hampir semua langkah.

Contoh:

- Di Tomcat, thread request berasal dari Tomcat connector executor.
- Di Jetty, thread pool dan handler chain Jetty menentukan behavior.
- Di Netty, event loop tidak boleh diblokir sembarangan.
- Di Grizzly, transport/threading punya konfigurasi sendiri.
- Di Jakarta EE server, CDI/security/transaction dapat ikut masuk lifecycle.
- Di Kubernetes, SIGTERM bisa datang saat request masih berjalan.

---

## 14. Startup Lifecycle: Kenapa Banyak Bug Muncul Sebelum Request Pertama

Startup Jersey bukan hanya “server start”. Banyak hal terjadi:

```text
1. JVM start
2. Classpath/module path dibentuk
3. Container/server start
4. Web app context dibuat
5. Servlet/filter/listener ditemukan
6. Jersey ServletContainer dibuat
7. Application/ResourceConfig dibuat
8. Package scanning / explicit registration berjalan
9. Providers/features/binders diregistrasi
10. Injection graph disiapkan
11. Resource model divalidasi
12. Message body providers disusun
13. ExceptionMapper dipilih/diindeks
14. Server bind port
15. App dianggap started
16. Readiness boleh true
```

Error bisa muncul di setiap tahap.

Contoh:

```text
ClassNotFoundException jakarta.ws.rs.Path
```

Kemungkinan:

- API jar tidak ada.
- Salah versi Jersey/container.
- WAR scope salah.
- Container lama tidak punya Jakarta API.

Contoh:

```text
NoSuchMethodError on Jackson provider
```

Kemungkinan:

- Jackson version conflict.
- Container menyediakan versi lain.
- Shaded jar merusak service file.
- Dependency mediation Maven/Gradle salah.

Contoh:

```text
Endpoint 404 setelah startup sukses
```

Kemungkinan:

- Resource tidak terdaftar.
- Package scanning salah.
- Servlet mapping tidak sesuai.
- Context path berbeda.
- Proxy rewrite salah.
- `@ApplicationPath` dan servlet mapping bertabrakan.

---

## 15. Classloading adalah Bagian dari Deployment

Classloading sering dianggap detail JVM, padahal dalam deployment Java enterprise itu pusat masalah.

### 15.1 Embedded Jar

Umumnya satu application classloader:

```text
Bootstrap/platform classloader
  -> application classloader
      -> app classes
      -> Jersey classes
      -> server classes
      -> JSON provider
```

Lebih sederhana, tetapi risiko duplicate dependency tetap ada.

### 15.2 WAR di Servlet Container

Umumnya:

```text
JVM/platform
  -> container common classloader
      -> servlet container classes
      -> shared libs optional
  -> webapp classloader
      -> WEB-INF/classes
      -> WEB-INF/lib
```

Masalah:

- Container punya servlet API sendiri.
- Aplikasi tidak boleh membawa servlet API yang salah di `WEB-INF/lib`.
- Container mungkin punya JAX-RS implementation bawaan.
- Shared library bisa mengalahkan app library.

### 15.3 Jakarta EE Server

Lebih kompleks:

```text
server modules
  -> deployment module
  -> subdeployment module
  -> shared libraries
  -> application libs
```

Masalah umum:

- Server punya REST implementation bawaan.
- Aplikasi membawa Jersey lain.
- Ada module exclusion/import rule.
- CDI extension terlihat/tidak terlihat tergantung module.
- Provider discovery berbeda antar classloader.

Prinsip top-tier:

```text
Setiap kali ada deployment bug aneh, gambar classloader boundary.
Jangan debug hanya dari source code.
```

---

## 16. Provider Discovery: Kecil tapi Berbahaya

Jersey memakai banyak provider:

- JSON provider: Jackson, JSON-B/Yasson, MOXy.
- XML provider: JAXB/MOXy.
- Multipart provider.
- Validation provider.
- Exception mapper.
- Param converter.
- Context resolver.
- Feature.
- Binder.

Provider bisa didaftarkan secara:

1. Explicit registration:

```java
register(JacksonFeature.class);
register(GlobalExceptionMapper.class);
```

2. Package scanning:

```java
packages("com.example.api");
```

3. Auto-discovery / service loader:

```text
META-INF/services/...
```

4. Container integration.

Deployment problem muncul saat provider yang aktif bukan provider yang kamu kira.

Contoh:

```text
Aplikasi mengira memakai Jackson,
tetapi runtime memilih JSON-B provider.
```

Atau:

```text
Local test memakai provider A,
WAR di app server memakai provider B dari server module.
```

Prinsip:

```text
Untuk production-critical API, explicit registration lebih mudah diaudit daripada magic scanning penuh.
```

Bukan berarti scanning buruk. Scanning berguna, tetapi harus dipahami.

---

## 17. Resource Registration: Explicit vs Scanning

### 17.1 Explicit Registration

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(UserResource.class);
        register(CaseResource.class);
        register(AuditResource.class);
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);
    }
}
```

Kelebihan:

- Deterministik.
- Startup lebih terprediksi.
- Mudah audit.
- Mengurangi accidental resource exposure.
- Cocok untuk regulated system.

Kekurangan:

- Boilerplate lebih banyak.
- Developer bisa lupa register class baru.

### 17.2 Package Scanning

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Kelebihan:

- Praktis.
- Cocok untuk development cepat.
- Resource baru otomatis terdeteksi.

Kekurangan:

- Startup scanning cost.
- Bisa gagal karena classloader/module path.
- Bisa mendaftarkan class yang tidak dimaksud.
- Lebih sulit diaudit.
- Behavior bisa berbeda ketika shading/packaging berubah.

### 17.3 Hybrid Pattern

Untuk production, sering lebih baik:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        // explicit core providers
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);
        register(SecurityFilter.class);

        // controlled scan only for resource package
        packages(false, "com.example.api.resources");
    }
}
```

Mental model:

```text
Explicit for infrastructure providers.
Controlled scanning for resource surface.
Never scan the whole root package blindly in large enterprise apps.
```

---

## 18. Deployment Model Decision Axes

Saat memilih deployment model, jangan mulai dari preferensi pribadi. Mulai dari constraint.

### 18.1 Axis 1 — Java Version

```text
Java 8:
  likely Jersey 2.x / javax stack

Java 11:
  Jersey 2.x or early transition; watch removed Java EE modules

Java 17/21:
  Jersey 3.x / Jakarta EE 10 stack is realistic

Java 25:
  ensure runtime, bytecode tools, agents, container, and libraries support it
```

### 18.2 Axis 2 — Namespace

```text
javax stack:
  Tomcat 8/9, Jetty 9/10 patterns, Jersey 2.x

jakarta stack:
  Tomcat 10+, Jetty 11/12+, Jersey 3.x/4.x, Jakarta EE 9+
```

### 18.3 Axis 3 — Operational Ownership

```text
External servlet container:
  ops owns server, app deploys WAR

Embedded server:
  app owns server lifecycle

Jakarta EE server:
  platform owns many enterprise services

Kubernetes:
  app team/platform team share operational contract
```

### 18.4 Axis 4 — Runtime Features Needed

Ask:

- Need CDI?
- Need JTA transactions?
- Need container-managed security?
- Need WebSocket/JMS/JPA integration?
- Need admin console?
- Need hot redeploy?
- Need strict classloader isolation?
- Need one process per service?
- Need minimal startup?
- Need native image?

### 18.5 Axis 5 — Failure Tolerance

Ask:

- What happens if startup partially succeeds?
- Can readiness become true before all providers are ready?
- Can shutdown interrupt in-flight request?
- Can redeploy leak classloader?
- Can old and new versions run concurrently?
- Can a dependency conflict affect other apps?

### 18.6 Axis 6 — Regulatory / Audit Needs

For regulated systems, deployment must be explainable:

- Which version of Jersey?
- Which API namespace?
- Which container version?
- Which Java version?
- Which provider handles JSON/XML?
- Which auth filter runs first?
- Which timeout terminates the request?
- Where is access log generated?
- Where is trace ID injected?
- What is the rollback path?

---

## 19. Common Deployment Model Selection Patterns

### 19.1 Legacy Enterprise on Java 8

Likely shape:

```text
Java 8
Jersey 2.x
javax.ws.rs
WAR
Tomcat 8/9 or legacy app server
```

Recommendation:

- Keep stack internally consistent.
- Avoid mixing Jakarta dependencies.
- Pin versions explicitly.
- Document container-provided APIs.
- Build migration runway to Java 17/21/25 separately.

### 19.2 Modern Jakarta API on Java 17/21/25

Likely shape:

```text
Java 17/21/25
Jersey 3.x/4.x
jakarta.ws.rs
Tomcat 10+/Jetty 11+/Jakarta EE 10/11 runtime
```

Recommendation:

- Align Servlet API with Jersey generation.
- Avoid old `javax.*` providers.
- Validate JSON, validation, CDI, multipart compatibility.
- Run startup validation in CI.

### 19.3 Small Self-Contained Service

Likely shape:

```text
Java 21/25
Jersey 3.x/4.x
embedded Grizzly/Jetty/JDK HTTP/Netty
fat/thin jar
Docker image
Kubernetes
```

Recommendation:

- Own lifecycle explicitly.
- Implement graceful shutdown.
- Add health/readiness endpoints.
- Make config externalized.
- Tune server thread pool.
- Verify signal handling.

### 19.4 Regulated Enterprise API

Likely shape:

```text
WAR or controlled server package
explicit ResourceConfig registration
strict dependency BOM
auditable provider list
centralized logging/metrics/security
```

Recommendation:

- Prefer deterministic registration.
- Produce dependency report.
- Separate platform APIs from app libraries.
- Maintain deployment decision record.
- Include failure-mode testing.

---

## 20. Anti-Patterns yang Harus Dihindari

### 20.1 “Works on My Machine” Deployment

Gejala:

```text
Local embedded Grizzly jalan,
tapi WAR di Tomcat gagal.
```

Penyebab:

- Model deployment berbeda.
- Classpath berbeda.
- Servlet mapping berbeda.
- Provider discovery berbeda.
- Config source berbeda.

Solusi:

```text
Test artifact yang sama dengan deployment production sedini mungkin.
```

### 20.2 Blind Package Scanning

```java
packages("com.company");
```

Risiko:

- Startup lambat.
- Resource tidak sengaja terekspos.
- Provider test ikut terdaftar.
- Classpath scanning pecah saat shading/native image.

Lebih baik:

```java
packages("com.company.product.api.resources");
register(SecurityFilter.class);
register(GlobalExceptionMapper.class);
```

### 20.3 Mixing `javax` and `jakarta`

Gejala:

```text
Resource tidak ditemukan.
Servlet gagal load.
ClassNotFoundException.
NoSuchMethodError.
Provider tidak aktif.
```

Solusi:

```text
Pilih satu namespace stack untuk satu deployment boundary.
```

### 20.4 Membawa Servlet API ke WAR Secara Salah

Di WAR deployment, Servlet API biasanya disediakan container. Membawa versi salah ke `WEB-INF/lib` bisa menghasilkan konflik.

Prinsip:

```text
Untuk WAR di external servlet container:
servlet API biasanya scope provided.
```

### 20.5 Menganggap Kubernetes Menyelesaikan Lifecycle

Kubernetes hanya mengirim signal dan mengatur rollout. Aplikasi tetap harus:

- berhenti menerima request baru saat terminating,
- menunggu in-flight request selesai,
- menutup server,
- menutup connection pool,
- flush log/metrics,
- keluar dengan benar.

### 20.6 Readiness Probe Terlalu Dangkal

Bad:

```text
GET /health -> 200 selama JVM hidup
```

Better:

```text
Readiness true jika:
- Jersey runtime initialized
- critical providers registered
- config loaded
- mandatory downstream reachable jika memang hard dependency
- app tidak dalam shutdown draining
```

---

## 21. Deployment Diagnostics: Cara Berpikir Saat Error

Saat Jersey app gagal, jangan langsung edit resource. Mulai dari boundary.

### 21.1 Pertanyaan Pertama

```text
Request gagal di layer mana?
```

Layer map:

```text
Network / DNS / LB
  -> reverse proxy / ingress
  -> container port
  -> HTTP server
  -> servlet mapping / handler
  -> Jersey routing
  -> provider/entity
  -> resource method
  -> downstream
```

### 21.2 Jika 404

Checklist:

- Apakah request sampai ke process?
- Apakah access log container mencatat request?
- Apakah context path benar?
- Apakah servlet mapping benar?
- Apakah `@ApplicationPath` aktif?
- Apakah proxy rewrite mengubah path?
- Apakah resource class registered?
- Apakah HTTP method cocok?
- Apakah trailing slash/matrix path berpengaruh?

### 21.3 Jika 415 Unsupported Media Type

Checklist:

- Apakah `Content-Type` request benar?
- Apakah resource punya `@Consumes` yang cocok?
- Apakah MessageBodyReader tersedia?
- Apakah JSON provider terdaftar?
- Apakah provider yang aktif sesuai?
- Apakah `javax`/`jakarta` provider mismatch?

### 21.4 Jika 500 Saat Startup

Checklist:

- Full stack trace startup.
- Dependency tree.
- Jersey version.
- Servlet API version.
- Container version.
- Java version.
- Provider libraries.
- Classloader source class.
- Duplicate jars.
- Service loader files.

### 21.5 Jika Timeout

Checklist:

- Timeout di LB/proxy berapa?
- Timeout di container berapa?
- Thread pool habis?
- Queue penuh?
- Downstream lambat?
- Connection pool starvation?
- Blocking call di event loop?
- Upload/download streaming?
- Shutdown sedang berlangsung?

---

## 22. Production Readiness Thinking

Sebuah Jersey deployment production-ready bukan hanya punya endpoint.

Minimal harus punya jawaban untuk:

### 22.1 Build Reproducibility

- Apakah dependency dikunci?
- Apakah memakai BOM?
- Apakah build repeatable?
- Apakah artifact immutable?
- Apakah dependency tree direkam?

### 22.2 Runtime Identity

- Java version apa?
- Jersey version apa?
- JAX-RS/Jakarta REST version apa?
- Servlet version apa?
- Container/server version apa?
- JSON provider apa?
- Validation provider apa?

### 22.3 Startup Validation

- Apakah semua resource terdaftar?
- Apakah provider penting aktif?
- Apakah config mandatory tersedia?
- Apakah port bind sukses?
- Apakah health endpoint tidak true terlalu cepat?

### 22.4 Operational Hooks

- Readiness endpoint.
- Liveness endpoint.
- Graceful shutdown.
- Structured logging.
- Access logging.
- Metrics.
- Tracing.
- Correlation ID.
- Error response standardization.

### 22.5 Failure Handling

- Startup fail-fast.
- Clear error for missing config.
- Request timeout policy.
- Overload behavior.
- Downstream failure mapping.
- Shutdown draining.
- Rollback plan.

---

## 23. Cara Membaca Seri Ini

Seri ini akan bergerak dari mental model ke detail teknis:

```text
Part 0:
  peta besar dan mental model

Part 1-3:
  version matrix, invariant, request path

Part 4-9:
  servlet/WAR/classpath/module model

Part 10-13:
  embedded/container integrations

Part 14-18:
  Jakarta EE/server-specific deployment

Part 19-22:
  packaging, Docker, Kubernetes, proxy/API gateway

Part 23-29:
  threading, timeout, config, security, observability, failure, performance

Part 30-32:
  migration, decision framework, capstone architecture
```

Prinsip belajar:

```text
Jangan hafal template deployment.
Pahami siapa yang punya lifecycle, classloader, thread, config, dan request mapping.
```

---

## 24. Mental Model Ringkas

Jika harus diringkas menjadi satu diagram:

```text
                 ┌──────────────────────────────┐
                 │        Client / Caller        │
                 └───────────────┬──────────────┘
                                 │ HTTP
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│ Operational Layer                                             │
│ LB, Gateway, Proxy, Docker, Kubernetes, VM, Service Manager   │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Hosting Layer                                                 │
│ Tomcat, Jetty, Grizzly, Netty, JDK HTTP, GlassFish, Liberty   │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Jersey Integration Adapter                                    │
│ ServletContainer, Filter, Grizzly adapter, Jetty adapter, etc │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Jersey Runtime                                                │
│ Resource matching, filters, providers, mappers, entity IO     │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Application Code                                              │
│ Resource, service, domain, database, downstream integration   │
└──────────────────────────────────────────────────────────────┘
```

Top-tier engineer tidak hanya tahu menulis:

```java
@Path("/users")
```

Top-tier engineer tahu:

```text
Bagaimana request /users sampai ke method itu,
siapa yang memilih thread,
siapa yang membuat resource instance,
siapa yang memilih JSON provider,
siapa yang mengubah exception,
siapa yang mengatur timeout,
siapa yang menutup koneksi,
dan apa yang terjadi saat process sedang shutdown.
```

---

## 25. Checklist Pemahaman Part 0

Kamu dianggap memahami part ini jika bisa menjelaskan:

1. Perbedaan Jersey runtime dan HTTP server/container.
2. Perbedaan artifact packaging dan deployment model.
3. Perbedaan servlet-based, embedded, Jakarta EE managed, dan cloud operational deployment.
4. Kenapa `Application`/`ResourceConfig` bersifat deployment-agnostic.
5. Kenapa `javax.*` dan `jakarta.*` adalah deployment boundary, bukan sekadar rename import.
6. Kenapa Java 8–25 harus dibaca sebagai compatibility matrix.
7. Kenapa classloader dan provider discovery adalah bagian dari deployment.
8. Kenapa 404/415/500/timeout perlu didiagnosis dari layer paling luar ke dalam.
9. Kenapa Kubernetes tidak menghapus kebutuhan graceful shutdown di aplikasi.
10. Kenapa explicit registration sering lebih cocok untuk production-critical API.

---

## 26. Latihan Berpikir

### Latihan 1 — Identifikasi Deployment Model

Diberikan command:

```bash
java -jar my-api.jar
```

Pertanyaan:

```text
Apakah ini pasti embedded deployment?
```

Jawaban:

Tidak pasti. Bisa saja jar tersebut menjalankan embedded server, tetapi bisa juga launcher untuk server lain, Spring Boot embedded container, custom bootstrap, atau thin launcher yang memuat dependency eksternal. Command line tidak cukup. Harus lihat isi artifact dan bootstrap code.

### Latihan 2 — 404 Setelah Migrasi Tomcat 9 ke Tomcat 10

Aplikasi Jersey 2 menggunakan:

```java
import javax.ws.rs.Path;
```

Lalu dideploy ke Tomcat 10 dengan Jersey 3 dependency.

Kemungkinan masalah:

```text
Tomcat 10 adalah dunia jakarta.servlet.*.
Jersey 3 adalah dunia jakarta.ws.rs.*.
Resource masih javax.ws.rs.*.
Annotation tidak match dengan runtime modern.
```

Solusi konseptual:

```text
Migrasikan seluruh deployment boundary ke jakarta stack,
atau tetap di javax stack dengan container/runtime yang sesuai.
Jangan setengah-setengah.
```

### Latihan 3 — Local Grizzly Sukses, WAR Gagal

Local test:

```text
embedded Grizzly + ResourceConfig packages("com.example")
```

Production:

```text
WAR di external Tomcat
```

Kemungkinan beda:

- Different classloader.
- Different servlet mapping.
- Different context path.
- Different provider auto-discovery.
- Different dependency scope.
- Different config source.
- Different startup order.

Lesson:

```text
Local runtime harus sedekat mungkin dengan production deployment model,
atau minimal ada integration test untuk artifact production.
```

---

## 27. Ringkasan Akhir

Jersey deployment models adalah topik arsitektural, bukan sekadar konfigurasi Maven.

Inti pemahamannya:

1. Jersey menjalankan model JAX-RS/Jakarta REST.
2. HTTP request selalu datang lewat hosting layer tertentu.
3. Deployment model menentukan lifecycle, classloader, thread, mapping, provider discovery, config, security, observability, dan shutdown.
4. Java 8–25 harus dibaca bersama Jersey major version, namespace API, Servlet version, container version, dan dependency ecosystem.
5. `javax.*` vs `jakarta.*` adalah boundary besar yang memengaruhi seluruh deployment.
6. Production-grade Jersey deployment harus bisa dijelaskan dari network sampai resource method dan dari startup sampai shutdown.

---

## 28. Status Seri

Seri **belum selesai**.  
Ini adalah **Part 0 dari 32**.

Part berikutnya:

```text
Part 1 — Version Matrix: Java 8–25, Jersey 2.x/3.x/4.x, javax.* vs jakarta.*
```

---

## 29. Referensi Utama

Referensi berikut digunakan sebagai basis faktual untuk orientasi part ini:

1. Eclipse Jersey Documentation — Application Deployment and Runtime Environments: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
2. Eclipse Jersey Documentation — Modules and Dependencies: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/modules-and-dependencies.html
3. Eclipse Jersey Project Website: https://jersey.github.io/
4. Eclipse Jersey 4.0.0 Release Information: https://projects.eclipse.org/projects/ee4j.jersey/releases/4.0.0
5. Jakarta RESTful Web Services 4.0 Specification Page: https://jakarta.ee/specifications/restful-ws/4.0/
6. OpenJDK JDK 25 Project Page: https://openjdk.org/projects/jdk/25/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-001.md">Part 1 — Version Matrix: Java 8–25, Jersey 2.x/3.x/4.x, `javax.*` vs `jakarta.*` ➡️</a>
</div>
