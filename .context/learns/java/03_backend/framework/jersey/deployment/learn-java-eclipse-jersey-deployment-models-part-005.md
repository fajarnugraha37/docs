# learn-java-eclipse-jersey-deployment-models-part-005

# Part 5 — Jersey as Servlet: `ServletContainer` Deep Dive

> Seri: **learn-java-eclipse-jersey-deployment-models**  
> Topik: **Java Eclipse Jersey Deployment Models**  
> Part: **005 / 032**  
> Target Java: **Java 8 sampai Java 25**  
> Fokus: memahami Jersey ketika dipasang sebagai **Servlet** di dalam Servlet container.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas WAR deployment model sebagai unit distribusi web application. Part ini masuk lebih dalam ke komponen paling penting ketika Jersey berjalan di Servlet container: `org.glassfish.jersey.servlet.ServletContainer`.

Tujuan part ini bukan sekadar tahu bahwa di `web.xml` kita bisa menulis:

```xml
<servlet>
    <servlet-name>Jersey REST Application</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
</servlet>
```

Yang ingin kita kuasai adalah:

1. Apa sebenarnya peran `ServletContainer`.
2. Apa yang dikerjakan Servlet container dan apa yang dikerjakan Jersey runtime.
3. Bagaimana `ServletContainer` menjembatani dunia Servlet dengan dunia JAX-RS/Jakarta REST.
4. Bagaimana `Application`, `ResourceConfig`, package scanning, provider registration, dan servlet mapping saling berhubungan.
5. Mengapa bug deployment Jersey sering terlihat seperti bug resource, padahal akar masalahnya ada di bootstrap, mapping, dependency, atau classloader.
6. Bagaimana membuat deployment Jersey sebagai Servlet menjadi deterministik, observable, dan production-ready.

Mental model utama:

```text
HTTP server / Servlet container
        |
        v
Servlet API request boundary
        |
        v
Jersey ServletContainer
        |
        v
Jersey application model
        |
        v
Resource matching + provider pipeline + DI
        |
        v
Resource method invocation
        |
        v
Response mapping back to Servlet response
```

`ServletContainer` adalah adapter. Ia bukan domain resource, bukan business service, dan bukan servlet container itu sendiri. Ia adalah bridge yang mengubah request Servlet menjadi request yang dapat diproses oleh Jersey server runtime.

---

## 1. Apa Itu `ServletContainer`?

Di deployment Servlet, Jersey membutuhkan satu titik masuk agar Servlet container bisa menyerahkan HTTP request kepada Jersey runtime. Titik masuk itu adalah `ServletContainer`.

Secara konseptual:

```text
Tomcat / Jetty / GlassFish / Payara / Open Liberty
    menerima HTTP request
    membuat HttpServletRequest + HttpServletResponse
    memilih servlet berdasarkan mapping
    memanggil service(...) pada servlet

Jersey ServletContainer
    menerima HttpServletRequest + HttpServletResponse
    membuat internal request context Jersey
    menjalankan resource matching
    menjalankan filter/interceptor/provider pipeline
    memanggil resource method
    menulis response ke HttpServletResponse
```

Jadi `ServletContainer` memiliki dua identitas sekaligus:

1. Di mata Servlet container, ia adalah **Servlet**.
2. Di mata Jersey, ia adalah **bootstrap + request dispatch adapter**.

Ini penting karena kesalahan diagnosis sering terjadi di sini.

Contoh:

```text
GET /myapp/api/users/1 -> 404
```

404 itu bisa berarti:

1. Request tidak pernah masuk ke web application.
2. Request masuk ke web application tetapi tidak cocok dengan context path.
3. Request cocok dengan context path tetapi tidak cocok dengan servlet mapping.
4. Request masuk ke `ServletContainer`, tetapi tidak cocok dengan resource `@Path`.
5. Resource cocok tetapi sub-resource locator tidak cocok.
6. Resource method ada tetapi HTTP method/media type tidak cocok.

Semua terlihat sebagai “endpoint tidak ditemukan”, tetapi root cause-nya berbeda.

---

## 2. Dependency Dasar untuk Servlet Deployment

Untuk menjalankan Jersey sebagai Servlet, aplikasi membutuhkan modul container servlet Jersey.

Untuk Jersey 2.x, namespace masih `javax.*`:

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Untuk Jersey 3.x/4.x, koordinat artifact masih di keluarga `org.glassfish.jersey.*`, tetapi API yang digunakan berpindah ke `jakarta.*`.

Contoh Maven untuk Jersey 3.x:

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Biasanya juga perlu modul JSON, misalnya Jackson:

```xml
<dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Dan jika memakai HK2 injection bawaan Jersey:

```xml
<dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

### 2.1 `jersey-container-servlet-core` vs `jersey-container-servlet`

Di beberapa versi dokumentasi Jersey, ada pembedaan antara:

```text
jersey-container-servlet-core
jersey-container-servlet
```

Secara praktis:

1. `jersey-container-servlet-core` menyediakan integrasi dasar Servlet.
2. `jersey-container-servlet` menyediakan integrasi Servlet yang lebih lengkap, termasuk dukungan deployment Servlet 3.x+ tertentu dan async.

Untuk aplikasi modern, default yang aman biasanya `jersey-container-servlet`, kecuali ada alasan sangat spesifik untuk memakai core.

### 2.2 Dependency Ownership

Dalam WAR deployment, dependency bisa dimiliki oleh:

1. Aplikasi di `WEB-INF/lib`.
2. Servlet container di shared/common classloader.
3. Jakarta EE server sebagai bagian dari platform runtime.

Kesalahan fatal yang sering terjadi:

```text
Aplikasi membawa Jersey 3.x,
container membawa Jersey 2.x,
Servlet API container adalah javax,
resource aplikasi memakai jakarta.
```

Hasilnya bisa berupa:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
LinkageError
Provider not found
404 semua endpoint
startup sukses tetapi runtime gagal
```

Rule:

```text
Satu aplikasi harus punya satu ownership model yang jelas.
Jangan biarkan Jersey API/implementation tersebar acak antara app dan container.
```

---

## 3. Tiga Cara Utama Mengaktifkan `ServletContainer`

Ada tiga pola umum:

1. `web.xml` eksplisit.
2. `@ApplicationPath` pada subclass `Application` / `ResourceConfig`.
3. Programmatic registration oleh framework/container initializer.

Part ini fokus pada dua yang paling penting: `web.xml` dan `@ApplicationPath`.

---

## 4. Model 1 — Explicit `web.xml`

Model paling eksplisit:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_0.xsd"
         version="6.0">

    <servlet>
        <servlet-name>api</servlet-name>
        <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
        <init-param>
            <param-name>jakarta.ws.rs.Application</param-name>
            <param-value>com.example.api.ApiApplication</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>api</servlet-name>
        <url-pattern>/api/*</url-pattern>
    </servlet-mapping>

</web-app>
```

Untuk Jersey 2.x / Java EE / `javax.*`, namespace descriptor dan param name bisa berbeda:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         version="3.1">

    <servlet>
        <servlet-name>api</servlet-name>
        <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
        <init-param>
            <param-name>javax.ws.rs.Application</param-name>
            <param-value>com.example.api.ApiApplication</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>api</servlet-name>
        <url-pattern>/api/*</url-pattern>
    </servlet-mapping>

</web-app>
```

### 4.1 Mengapa `web.xml` Masih Penting?

Banyak engineer modern menganggap `web.xml` sebagai legacy. Itu sebagian benar, tetapi tidak lengkap.

`web.xml` masih sangat berguna untuk:

1. Deployment yang harus sangat eksplisit.
2. Enterprise server yang punya aturan security/filter/listener terpusat.
3. Aplikasi dengan banyak servlet/filter.
4. Aplikasi yang perlu startup order jelas.
5. Aplikasi yang harus mudah diaudit.
6. Aplikasi yang ingin menghindari annotation scanning surprise.
7. Aplikasi yang ingin membedakan beberapa Jersey application dalam satu WAR.

Dalam sistem regulated atau enterprise, eksplisit sering lebih bernilai daripada magic.

### 4.2 `load-on-startup`

Tanpa `load-on-startup`, servlet bisa lazy-init saat request pertama datang.

Itu berbahaya untuk production.

```xml
<load-on-startup>1</load-on-startup>
```

Manfaat:

1. Kesalahan dependency muncul saat deployment, bukan request pertama user.
2. Resource/provider registration diverifikasi lebih awal.
3. Readiness probe bisa menunggu aplikasi benar-benar siap.
4. Startup failure lebih mudah dikorelasikan dengan deployment event.

Anti-pattern:

```text
Deploy sukses.
Readiness true.
Request pertama user terkena HK2 injection failure.
```

Aplikasi seperti itu belum benar-benar production-ready.

---

## 5. Model 2 — `@ApplicationPath`

Alternatif modern:

```java
package com.example.api;

import jakarta.ws.rs.ApplicationPath;
import org.glassfish.jersey.server.ResourceConfig;

@ApplicationPath("/api")
public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        packages("com.example.api.resources");
        register(com.example.api.providers.JsonExceptionMapper.class);
    }
}
```

Dengan model ini, container/Jersey menemukan subclass aplikasi dan memasangnya sesuai `@ApplicationPath`.

Untuk Jersey 2.x:

```java
import javax.ws.rs.ApplicationPath;
import org.glassfish.jersey.server.ResourceConfig;

@ApplicationPath("/api")
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api.resources");
    }
}
```

### 5.1 Kelebihan `@ApplicationPath`

1. Lebih ringkas.
2. Tidak perlu deklarasi servlet manual untuk aplikasi sederhana.
3. Cocok untuk deployment Servlet 3.x+ annotation scanning.
4. Konfigurasi Jersey bisa dikumpulkan dalam satu class Java.

### 5.2 Kekurangan `@ApplicationPath`

1. Bergantung pada scanning.
2. Startup dapat berbeda antar container jika classpath rumit.
3. Kurang eksplisit untuk audit deployment.
4. Sulit jika satu WAR punya banyak aplikasi Jersey.
5. Bisa bentrok dengan framework lain yang juga melakukan scanning/registration.

Untuk sistem enterprise besar, kombinasi umum yang lebih aman:

```text
web.xml untuk servlet boundary
ResourceConfig untuk Jersey internal registration
```

---

## 6. `Application` vs `ResourceConfig`

JAX-RS/Jakarta REST mendefinisikan `Application` sebagai class konfigurasi aplikasi REST.

Contoh pure spec:

```java
package com.example.api;

import jakarta.ws.rs.core.Application;
import java.util.Set;

public final class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            UserResource.class,
            OrderResource.class,
            GlobalExceptionMapper.class
        );
    }
}
```

Jersey menyediakan `ResourceConfig` sebagai extension yang lebih nyaman:

```java
package com.example.api;

import org.glassfish.jersey.server.ResourceConfig;

public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        register(UserResource.class);
        register(OrderResource.class);
        register(GlobalExceptionMapper.class);
        packages("com.example.api.resources");
    }
}
```

### 6.1 Mental Model

```text
Application
    = standard Jakarta REST/JAX-RS application declaration

ResourceConfig
    = Jersey-specific programmable application declaration
```

`ResourceConfig` biasanya lebih praktis untuk aplikasi Jersey production karena bisa mengatur:

1. Resource registration.
2. Provider registration.
3. Feature registration.
4. Binder registration.
5. Properties.
6. Package scanning.
7. Explicit class registration.

### 6.2 Kapan Memakai Pure `Application`?

Gunakan pure `Application` jika:

1. Ingin portability maksimal antar implementation JAX-RS/Jakarta REST.
2. Konfigurasi sangat sederhana.
3. Tidak ingin mengunci diri ke Jersey extension.
4. Runtime dikelola Jakarta EE server.

### 6.3 Kapan Memakai `ResourceConfig`?

Gunakan `ResourceConfig` jika:

1. Aplikasi memang memilih Jersey sebagai runtime utama.
2. Perlu explicit registration.
3. Perlu package scanning terkontrol.
4. Perlu bind dependency custom via HK2.
5. Perlu fitur Jersey-specific.
6. Ingin startup behavior lebih mudah dikendalikan.

Untuk seri ini, `ResourceConfig` akan menjadi default mental model karena kita membahas Jersey deployment secara spesifik.

---

## 7. Request Lifecycle ketika Jersey Berjalan sebagai Servlet

Mari bedah lifecycle request.

Misalnya request:

```http
GET /aceas/api/cases/123 HTTP/1.1
Host: example.gov
Accept: application/json
```

Deployment:

```text
context path     = /aceas
servlet mapping  = /api/*
resource path    = /cases/123
```

Alurnya:

```text
[1] TCP connection diterima container connector
[2] HTTP parser membaca request line/header/body
[3] Container menentukan virtual host/context
[4] Container memilih web application dengan context path /aceas
[5] Container menjalankan filter chain yang match
[6] Container memilih ServletContainer karena /api/* match
[7] ServletContainer menerima HttpServletRequest/Response
[8] Jersey membangun ContainerRequest
[9] Jersey menghitung base URI dan request URI
[10] Jersey melakukan resource matching
[11] Jersey memilih resource method
[12] Jersey menjalankan request filters
[13] Jersey membaca entity jika ada
[14] Jersey invoke resource method
[15] Jersey menjalankan response filters/interceptors
[16] MessageBodyWriter menulis entity response
[17] Servlet response di-commit
[18] Container flush response ke network
```

### 7.1 Boundary yang Harus Diingat

Sebelum step 7, request masih berada di dunia Servlet container.

Setelah step 7, request masuk ke dunia Jersey.

Jika error terjadi sebelum step 7, provider Jersey tidak akan menangkapnya.

Contoh:

```text
Request ditolak oleh container karena maxPostSize.
```

Maka `ExceptionMapper` Jersey tidak akan bekerja.

Contoh lain:

```text
Request tidak cocok dengan servlet mapping.
```

Maka Jersey tidak pernah melihat request tersebut.

---

## 8. Base URI, Context Path, Servlet Path, Path Info

Ini salah satu bagian paling sering menyebabkan kebingungan.

Servlet request biasanya memiliki beberapa komponen:

```text
request URI  = /aceas/api/cases/123
contextPath  = /aceas
servletPath  = /api
pathInfo     = /cases/123
```

Dengan mapping:

```xml
<url-pattern>/api/*</url-pattern>
```

Jersey resource biasanya melihat:

```text
application root = /api
resource path    = /cases/123
```

Resource:

```java
@Path("/cases")
public class CaseResource {

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id) {
        ...
    }
}
```

Tidak perlu menulis:

```java
@Path("/api/cases") // biasanya salah
```

Karena `/api` adalah servlet mapping atau application path, bukan resource path.

### 8.1 Common Mistake

Salah:

```java
@ApplicationPath("/api")
@Path("/api/users")
public class UserResource {
}
```

Hasil endpoint menjadi:

```text
/api/api/users
```

Benar:

```java
@ApplicationPath("/api")
@Path("/users")
public class UserResource {
}
```

Endpoint:

```text
/api/users
```

---

## 9. Servlet Mapping dan Resource Matching Bukan Hal yang Sama

Servlet mapping menentukan apakah request masuk ke Jersey.

Resource matching menentukan resource method mana yang dipilih setelah request masuk ke Jersey.

```text
Servlet mapping:
    Apakah /api/users masuk ke ServletContainer?

Resource matching:
    Setelah masuk, apakah /users cocok dengan @Path("/users")?
```

Diagnostic strategy:

```text
Jika semua endpoint 404:
    curigai servlet mapping / application bootstrap / resource registration.

Jika hanya satu endpoint 404:
    curigai @Path, HTTP method, media type, sub-resource, atau path param.

Jika endpoint masuk tetapi 405:
    path cocok, HTTP method tidak cocok.

Jika endpoint masuk tetapi 415:
    Content-Type/request entity reader tidak cocok.

Jika endpoint masuk tetapi 406:
    Accept/response writer tidak cocok.
```

---

## 10. Package Scanning vs Explicit Registration

Jersey bisa menemukan resource dengan package scanning:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
    }
}
```

Atau explicit registration:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(UserResource.class);
        register(OrderResource.class);
        register(GlobalExceptionMapper.class);
        register(JsonFeature.class);
    }
}
```

### 10.1 Package Scanning

Kelebihan:

1. Mudah untuk aplikasi kecil.
2. Tidak perlu update daftar class setiap menambah resource.
3. Cocok untuk prototyping.

Kekurangan:

1. Bisa lambat saat startup.
2. Bisa menemukan provider yang tidak diinginkan.
3. Bisa berbeda jika packaging berubah.
4. Bisa gagal jika shading/minimization salah.
5. Lebih sulit diaudit.

### 10.2 Explicit Registration

Kelebihan:

1. Deterministik.
2. Lebih cepat startup.
3. Mudah diaudit.
4. Lebih aman untuk production besar.
5. Mengurangi hidden dependency.

Kekurangan:

1. Lebih verbose.
2. Developer harus disiplin mendaftarkan resource/provider baru.
3. Bisa lupa register class.

### 10.3 Rekomendasi Production

Untuk aplikasi enterprise besar:

```text
Gunakan explicit registration untuk boundary penting:
    - resource utama
    - exception mapper
    - JSON provider
    - auth filter
    - request/response filter
    - binder

Package scanning boleh digunakan terbatas:
    - hanya package sempit
    - bukan root package besar
    - bukan seluruh com.company
```

Contoh buruk:

```java
packages("com");
```

Contoh lebih baik:

```java
packages("com.example.caseapi.resources");
register(GlobalExceptionMapper.class);
register(SecurityRequestFilter.class);
register(JacksonFeature.class);
```

Contoh paling deterministik:

```java
register(CaseResource.class);
register(DocumentResource.class);
register(GlobalExceptionMapper.class);
register(ValidationExceptionMapper.class);
register(JacksonFeature.class);
register(SecurityRequestFilter.class);
```

---

## 11. Init Parameters Penting

Jersey mendukung konfigurasi melalui init-param Servlet.

Contoh umum:

```xml
<init-param>
    <param-name>jersey.config.server.provider.packages</param-name>
    <param-value>com.example.api.resources</param-value>
</init-param>
```

Contoh menunjuk application class:

```xml
<init-param>
    <param-name>jakarta.ws.rs.Application</param-name>
    <param-value>com.example.api.ApiApplication</param-value>
</init-param>
```

Untuk Jersey 2:

```xml
<init-param>
    <param-name>javax.ws.rs.Application</param-name>
    <param-value>com.example.api.ApiApplication</param-value>
</init-param>
```

### 11.1 Rule Konfigurasi

Jangan mencampur terlalu banyak sumber konfigurasi tanpa precedence jelas.

Buruk:

```text
web.xml mendefinisikan provider package A
ResourceConfig scan package B
system property scan package C
framework auto-register package D
```

Lebih baik:

```text
web.xml hanya menentukan ServletContainer + Application class
ResourceConfig mengatur semua Jersey registration
external config hanya untuk runtime values
```

---

## 12. Multi-Jersey Application dalam Satu WAR

Kadang satu WAR memiliki lebih dari satu Jersey application:

```text
/admin/*     -> AdminApiApplication
/public/*    -> PublicApiApplication
/internal/*  -> InternalApiApplication
```

`web.xml`:

```xml
<servlet>
    <servlet-name>public-api</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.publicapi.PublicApiApplication</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>public-api</servlet-name>
    <url-pattern>/public/*</url-pattern>
</servlet-mapping>

<servlet>
    <servlet-name>admin-api</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.adminapi.AdminApiApplication</param-value>
    </init-param>
    <load-on-startup>2</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>admin-api</servlet-name>
    <url-pattern>/admin/*</url-pattern>
</servlet-mapping>
```

Mental model:

```text
One WAR
    multiple ServletContainer instances
        each owns its own Jersey Application/ResourceConfig
```

Risiko:

1. Provider terdaftar di aplikasi yang salah.
2. Shared singleton tidak benar-benar shared.
3. Security filter mapping terlalu luas/sempit.
4. ExceptionMapper berbeda antar API.
5. Health check hanya memeriksa salah satu app.

Rekomendasi:

```text
Jika boundary security/operational berbeda besar,
pertimbangkan pisah WAR/service.
```

---

## 13. Lifecycle `ServletContainer`

Servlet lifecycle dasar:

```text
constructor
    -> init(ServletConfig)
    -> service(request, response) many times
    -> destroy()
```

Saat `init`, Jersey biasanya:

1. Membaca servlet init parameters.
2. Menentukan application class/config.
3. Membuat Jersey application model.
4. Melakukan resource/provider registration.
5. Menyiapkan injection manager.
6. Menyiapkan message body readers/writers.
7. Menyiapkan routing/matching model.
8. Menjalankan feature configuration.

Saat `service`, Jersey:

1. Membungkus servlet request menjadi Jersey request context.
2. Menjalankan request pipeline.
3. Memanggil resource.
4. Menulis response.

Saat `destroy`, Jersey:

1. Menutup runtime.
2. Melepas resource managed component.
3. Menutup executor/client/resource tertentu jika didaftarkan dengan benar.

### 13.1 Startup Harus Fail-Fast

Production Jersey deployment harus gagal saat startup jika:

1. Resource dependency tidak bisa dibuat.
2. Provider konflik.
3. JSON provider tidak ada.
4. Required configuration kosong.
5. Database/client wajib tidak tersedia, jika aplikasi mensyaratkan dependency ready.
6. `javax.*`/`jakarta.*` mismatch.

Anti-pattern:

```java
@Path("/orders")
public class OrderResource {
    private final OrderService orderService;

    public OrderResource() {
        this.orderService = ServiceLocator.global().findLater();
    }
}
```

Masalah baru muncul saat request.

Lebih baik:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        validateRequiredConfiguration();
        register(new ApiBinder(buildDependencies()));
        register(OrderResource.class);
    }
}
```

---

## 14. Threading Model

Ketika Jersey berjalan sebagai Servlet, thread request biasanya berasal dari Servlet container thread pool.

```text
Tomcat executor thread / Jetty queued thread / app server worker
        |
        v
ServletContainer.service(...)
        |
        v
Jersey pipeline
        |
        v
Resource method
```

Artinya resource method sinkron akan menahan thread container selama request berjalan.

Contoh resource blocking:

```java
@GET
@Path("/{id}")
public UserDto getUser(@PathParam("id") String id) {
    return userRepository.findById(id); // blocking DB call
}
```

Ini normal untuk Servlet stack tradisional, tetapi harus dihitung:

```text
Max concurrent blocking request ≈ available request threads
```

Jika DB lambat dan thread pool habis:

```text
new request queueing naik
latency naik
health check ikut lambat
timeout cascade terjadi
```

### 14.1 Async Servlet / Async Resource

Jersey mendukung beberapa model async, tetapi mental modelnya harus hati-hati.

Async bukan berarti pekerjaan hilang.

Async berarti:

```text
request thread bisa dilepas,
pekerjaan dilanjutkan di executor/event source lain,
response diselesaikan nanti.
```

Risiko:

1. Executor async tidak dibatasi.
2. Cancellation tidak ditangani.
3. Timeout tidak jelas.
4. Context propagation hilang.
5. Error mapping tidak konsisten.

Untuk production:

```text
Async harus punya executor bounded, timeout, cancellation policy, dan metrics.
```

---

## 15. Provider Pipeline dalam Servlet Deployment

Setelah request masuk ke Jersey, Jersey menjalankan pipeline internal:

```text
ContainerRequestFilter
    -> resource matching
    -> entity provider / MessageBodyReader
    -> resource method
    -> ExceptionMapper jika error
    -> ContainerResponseFilter
    -> WriterInterceptor
    -> MessageBodyWriter
```

Provider penting:

1. `ContainerRequestFilter` untuk auth/correlation/logging.
2. `ContainerResponseFilter` untuk headers/logging.
3. `ExceptionMapper` untuk error response.
4. `MessageBodyReader` untuk deserialize request body.
5. `MessageBodyWriter` untuk serialize response body.
6. `Feature` untuk registrasi modular.
7. `DynamicFeature` untuk conditional filter binding.

### 15.1 Provider Mana yang Tidak Bisa Melihat Error?

Provider Jersey tidak melihat error yang terjadi sebelum request masuk ke Jersey.

Contoh tidak terlihat oleh `ExceptionMapper`:

1. TLS handshake failure.
2. Connector max header exceeded.
3. Request body terlalu besar dan ditolak container.
4. Servlet mapping tidak cocok.
5. Filter eksternal sebelum Jersey melempar error dan tidak meneruskan chain.

Ini penting untuk observability.

Jika hanya mengandalkan Jersey `ExceptionMapper`, log error edge/container bisa hilang.

---

## 16. Interaction dengan Servlet Filter

Jika `ServletContainer` dipasang sebagai servlet, filter chain bisa berada sebelum Jersey:

```text
Client
  -> Container
  -> Filter A
  -> Filter B
  -> ServletContainer
  -> Jersey filters/resources/providers
```

Contoh filter:

1. Security filter.
2. CORS filter.
3. Compression filter.
4. Logging filter.
5. Correlation ID filter.
6. Character encoding filter.
7. Rate limiting filter.

### 16.1 Servlet Filter vs Jersey Filter

Servlet filter bekerja pada Servlet API level.

Jersey filter bekerja pada Jersey request/response context level.

```text
Servlet Filter:
    melihat HttpServletRequest/Response mentah
    bisa mencegah request masuk ke Jersey
    cocok untuk cross-cutting container-level concern

Jersey Filter:
    melihat JAX-RS/Jakarta REST context
    punya akses resource matching context tertentu
    cocok untuk API-level concern
```

Contoh pilihan:

```text
Correlation ID:
    bisa Servlet Filter jika semua endpoint termasuk non-Jersey butuh ID
    bisa Jersey Filter jika hanya REST API Jersey yang butuh ID

Authentication:
    bisa Servlet Filter jika security boundary ada sebelum Jersey
    bisa Jersey ContainerRequestFilter jika security logic API-specific

CORS:
    sering lebih aman di edge/reverse proxy atau Servlet Filter
    bisa di Jersey jika API-specific
```

### 16.2 Ordering

Ordering filter sangat penting.

Contoh:

```text
CorrelationIdFilter
    -> AccessLogEnrichmentFilter
    -> AuthenticationFilter
    -> Jersey ServletContainer
```

Jika authentication berjalan sebelum correlation id, error auth bisa tidak punya correlation id.

---

## 17. Error Boundary dan Exception Mapping

Jersey `ExceptionMapper` hanya bekerja untuk exception yang terjadi di dalam Jersey runtime boundary.

Contoh:

```java
@Provider
public final class GlobalExceptionMapper implements ExceptionMapper<Throwable> {
    @Override
    public Response toResponse(Throwable exception) {
        return Response.status(500)
            .entity(Map.of("error", "internal_error"))
            .build();
    }
}
```

Ini menangani:

1. Exception dari resource method.
2. Exception dari provider Jersey.
3. Exception dari filter Jersey.
4. Exception dari message body reader/writer tertentu.

Tidak menangani:

1. Error di reverse proxy.
2. Error di connector.
3. Error di Servlet filter sebelum Jersey jika tidak diteruskan.
4. Error saat container memilih servlet.
5. Error deployment sebelum runtime aktif.

### 17.1 Production Error Model

Untuk production, error model minimal harus punya:

```text
Edge/reverse proxy error response
Servlet container error page/logging
Jersey ExceptionMapper
Application domain error contract
Structured log + correlation id
```

Jangan berpikir satu `ExceptionMapper<Throwable>` menyelesaikan seluruh error architecture.

---

## 18. DI Boundary: HK2, CDI, Spring, Manual Wiring

Jersey memakai injection mechanism internal. Dalam banyak versi, HK2 menjadi DI default/bawaan Jersey.

Namun aplikasi bisa juga berjalan dengan:

1. HK2 native.
2. CDI integration.
3. Spring integration.
4. Manual dependency wiring.
5. Jakarta EE managed injection.

Deployment sebagai Servlet memperbesar risiko “dua container DI”:

```text
Servlet container lifecycle
Jersey lifecycle
HK2 lifecycle
CDI/Spring lifecycle
Application custom lifecycle
```

### 18.1 Anti-Pattern: Ambiguous Ownership

Buruk:

```text
UserService dibuat oleh Spring
UserResource dibuat oleh Jersey/HK2
Transaction manager dibuat oleh app server
Repository dibuat manual static singleton
```

Hasil:

1. Lifecycle kacau.
2. Shutdown leak.
3. Proxy injection gagal.
4. Test sulit.
5. Resource bisa punya dependency null.

### 18.2 Rule

Untuk setiap component, jawab:

```text
Siapa yang membuat object ini?
Siapa yang menginject dependency-nya?
Siapa yang menutupnya?
Apakah singleton/per-request/per-lookup?
Apakah thread-safe?
```

Jika tidak bisa menjawab, deployment belum cukup matang.

---

## 19. JSON Provider dan Media Type

Jersey tidak otomatis selalu tahu cara serialize object ke JSON, tergantung dependency/provider.

Resource:

```java
@GET
@Produces(MediaType.APPLICATION_JSON)
public UserDto get() {
    return new UserDto("u-1", "Fajar");
}
```

Butuh `MessageBodyWriter` untuk `UserDto -> application/json`.

Dengan Jackson:

```java
register(org.glassfish.jersey.jackson.JacksonFeature.class);
```

Atau package dependency bisa auto-discover, tetapi production lebih baik explicit.

### 19.1 Failure Mode

Jika provider JSON tidak ada:

```text
MessageBodyWriter not found for media type=application/json
HTTP 500
```

Jika `Content-Type` request tidak cocok:

```text
415 Unsupported Media Type
```

Jika `Accept` response tidak cocok:

```text
406 Not Acceptable
```

Diagnosis harus membedakan:

```text
routing problem != serialization problem != negotiation problem
```

---

## 20. ServletContainer dan Security Boundary

Ada beberapa lokasi security bisa ditempatkan:

```text
[1] Reverse proxy / API gateway
[2] Servlet container security
[3] Servlet Filter
[4] Jersey ContainerRequestFilter
[5] Resource method authorization
[6] Domain service authorization
```

Masing-masing punya fungsi.

### 20.1 Jangan Salah Menaruh Security

Authentication biasanya cocok di boundary awal:

```text
gateway / servlet filter / Jersey request filter
```

Authorization sering butuh konteks domain:

```text
resource layer + domain service layer
```

Contoh:

```java
@GET
@Path("/cases/{id}")
public CaseDto getCase(@PathParam("id") String id) {
    return caseService.getVisibleCase(currentUser(), id);
}
```

Jangan hanya mengandalkan path-level auth jika data-level authorization kompleks.

---

## 21. Observability untuk ServletContainer Deployment

Minimal observability:

1. Startup log: application class, servlet mapping, resource count, provider count.
2. Access log: method, URI, status, duration, bytes, user/correlation ID.
3. Application log: domain event/error.
4. Error log: uncaught exception, mapper exception, provider failure.
5. Metrics: request count, latency, error rate, thread pool, queue, memory, GC.
6. Health: liveness/readiness/startup readiness.
7. Trace: request span from edge to resource/service/db.

### 21.1 Startup Diagnostics yang Perlu Dicetak

Contoh startup log yang sehat:

```text
Jersey application started
  appClass=com.example.api.ApiApplication
  servletName=api
  servletMapping=/api/*
  contextPath=/aceas
  registeredResources=42
  registeredProviders=17
  jsonProvider=JacksonFeature
  environment=uat
  buildVersion=2026.06.21-001
```

Jangan hanya:

```text
Started server
```

Itu tidak cukup untuk troubleshooting.

---

## 22. Health Check dalam Servlet Deployment

Health check harus dipahami dari sudut path/mapping.

Jika servlet mapping:

```text
/api/*
```

Maka health endpoint Jersey:

```java
@Path("/health")
public class HealthResource {
    @GET
    public Response health() { ... }
}
```

Aksesnya:

```text
/context/api/health
```

Jika probe diarahkan ke:

```text
/context/health
```

maka request tidak masuk ke Jersey.

### 22.1 Liveness vs Readiness

Liveness:

```text
Apakah process/container masih hidup dan tidak deadlock total?
```

Readiness:

```text
Apakah aplikasi siap menerima traffic production?
```

Startup readiness:

```text
Apakah bootstrap Jersey selesai, dependencies minimum siap, dan mapping benar?
```

Untuk Servlet deployment, readiness harus memastikan:

1. `ServletContainer` sudah initialized.
2. Application config sudah loaded.
3. Resource/provider registration berhasil.
4. Dependency wajib tersedia.
5. Thread pool tidak overloaded permanen.

---

## 23. Graceful Shutdown

Saat shutdown:

```text
orchestrator sends SIGTERM
container stops accepting new request
load balancer drains connections
ServletContainer/resource runtime is destroyed
managed resources close
process exits
```

Risiko:

1. Request sedang berjalan diputus.
2. Connection pool tidak ditutup.
3. Background executor tetap hidup.
4. Jersey client tidak ditutup.
5. Async response menggantung.
6. Container mati sebelum drain selesai.

### 23.1 Rule Production

Semua resource non-trivial harus punya owner dan close path:

```java
public final class ApiApplication extends ResourceConfig {

    private final ExecutorService executor;
    private final DataSource dataSource;

    public ApiApplication() {
        this.executor = Executors.newFixedThreadPool(16);
        this.dataSource = buildDataSource();
        register(new ApiBinder(executor, dataSource));
    }
}
```

Tetapi jangan berhenti di situ. Pastikan ada lifecycle listener/context listener/container hook yang menutupnya.

Di app server/Jakarta EE, sering lebih baik memakai resource managed container agar shutdown lifecycle ditangani runtime.

---

## 24. Classloader dan Redeploy Leak

WAR deployment punya classloader per web application. Saat redeploy, classloader lama harus bisa di-GC.

Leak terjadi jika ada reference dari luar classloader ke object/class dari webapp lama.

Contoh penyebab:

1. Static singleton menyimpan thread.
2. ThreadLocal tidak dibersihkan.
3. JDBC driver tidak deregister.
4. Executor tidak shutdown.
5. Timer tidak cancel.
6. Jersey client tidak close.
7. Logging appender menyimpan reference.
8. Global registry menyimpan provider.

### 24.1 Kenapa Ini Relevan untuk ServletContainer?

Karena `ServletContainer` bootstrap membuat runtime graph:

```text
ApplicationHandler
Resource model
Provider instances
Injection manager
Message body providers
Filters/interceptors
```

Jika ada object dalam graph ini leak ke luar lifecycle WAR, redeploy tidak bersih.

Untuk production modern dengan container image immutable, redeploy leak mungkin kurang sering terlihat karena process diganti total. Tetapi di app server tradisional yang redeploy WAR dalam JVM yang sama, ini sangat penting.

---

## 25. Testing Deployment sebagai Servlet

Jangan hanya unit test resource method.

Perlu test beberapa level:

### 25.1 Resource Unit Test

Menguji method logic tanpa container.

```text
Cepat, tetapi tidak memvalidasi deployment.
```

### 25.2 Jersey Test Framework / In-Memory / Grizzly

Menguji Jersey resource matching/provider pipeline.

```text
Bagus untuk API behavior,
tetapi belum tentu sama dengan Servlet mapping production.
```

### 25.3 Embedded Servlet Container Test

Menguji WAR/servlet mapping/filter chain.

```text
Lebih dekat ke production.
```

### 25.4 Real Container Smoke Test

Deploy WAR ke Tomcat/Jetty/Payara/Open Liberty versi target lalu hit endpoint:

```text
GET /context/api/health
GET /context/api/openapi
GET /context/api/known-resource
POST /context/api/validation-sample
```

Ini menangkap:

1. Dependency conflict.
2. `javax/jakarta` mismatch.
3. Servlet mapping salah.
4. Provider tidak terdaftar.
5. JSON writer hilang.
6. Filter ordering salah.

---

## 26. Production-Grade `ResourceConfig` Example

Contoh sederhana tetapi lebih production-oriented:

```java
package com.example.api;

import com.example.api.health.HealthResource;
import com.example.api.user.UserResource;
import com.example.api.error.GlobalExceptionMapper;
import com.example.api.error.ValidationExceptionMapper;
import com.example.api.filter.CorrelationIdFilter;
import com.example.api.filter.SecurityFilter;
import org.glassfish.jersey.jackson.JacksonFeature;
import org.glassfish.jersey.server.ResourceConfig;

public final class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        String env = requiredProperty("APP_ENV");
        String version = optionalProperty("APP_VERSION", "unknown");

        AppDependencies dependencies = AppDependencies.boot(env);

        register(new ApiBinder(dependencies));

        register(HealthResource.class);
        register(UserResource.class);

        register(CorrelationIdFilter.class);
        register(SecurityFilter.class);

        register(GlobalExceptionMapper.class);
        register(ValidationExceptionMapper.class);

        register(JacksonFeature.class);

        property("app.env", env);
        property("app.version", version);
    }

    private static String requiredProperty(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            value = System.getProperty(name);
        }
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required configuration: " + name);
        }
        return value;
    }

    private static String optionalProperty(String name, String fallback) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            value = System.getProperty(name);
        }
        return value == null || value.isBlank() ? fallback : value;
    }
}
```

Key points:

1. Required config divalidasi saat startup.
2. Resource registration eksplisit.
3. Provider registration eksplisit.
4. JSON feature eksplisit.
5. Dependency graph dibuat terpusat.
6. Aplikasi gagal cepat jika konfigurasi wajib tidak ada.

---

## 27. Production `web.xml` Example

Jakarta/Jersey 3.x/4.x style:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_0.xsd"
         version="6.0">

    <display-name>example-api</display-name>

    <filter>
        <filter-name>correlation-filter</filter-name>
        <filter-class>com.example.web.CorrelationServletFilter</filter-class>
    </filter>

    <filter-mapping>
        <filter-name>correlation-filter</filter-name>
        <url-pattern>/*</url-pattern>
    </filter-mapping>

    <servlet>
        <servlet-name>api</servlet-name>
        <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
        <init-param>
            <param-name>jakarta.ws.rs.Application</param-name>
            <param-value>com.example.api.ApiApplication</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
        <async-supported>true</async-supported>
    </servlet>

    <servlet-mapping>
        <servlet-name>api</servlet-name>
        <url-pattern>/api/*</url-pattern>
    </servlet-mapping>

</web-app>
```

Notes:

1. Filter mapping `/*` berarti filter melihat request non-Jersey juga.
2. Servlet mapping `/api/*` berarti Jersey hanya melihat API path.
3. `async-supported` hanya aktifkan kemampuan Servlet async; bukan otomatis membuat semua resource non-blocking.
4. `load-on-startup` memastikan bootstrap terjadi saat deploy.

---

## 28. Java 8 sampai Java 25 Considerations

### 28.1 Java 8

Biasanya terkait:

```text
Jersey 2.x
javax.ws.rs
javax.servlet
Servlet 3.x/4.x
Tomcat 8.5/9
Jetty 9
Java EE style
```

Risiko:

1. Library modern tidak lagi support Java 8.
2. Security update terbatas tergantung distribution.
3. Tidak ada JPMS.
4. TLS/cipher defaults bisa tertinggal.
5. Observability modern perlu backport.

### 28.2 Java 11

Sering menjadi baseline Jersey 3.x.

Karakter:

```text
jakarta.ws.rs for Jersey 3
Servlet 5+ for Jakarta EE 9+ namespace
Tomcat 10+
Jetty 11+
```

Risiko utama:

```text
javax -> jakarta migration
```

### 28.3 Java 17

Baseline kuat untuk Jakarta EE 10/11 era.

Keuntungan:

1. LTS modern.
2. GC/JFR lebih matang.
3. Banyak framework sudah menjadikannya baseline.
4. Cocok untuk container/cloud.

### 28.4 Java 21

LTS modern dengan virtual threads.

Untuk Servlet/Jersey:

1. Virtual threads bisa berguna jika container mendukung model executor yang sesuai.
2. Jangan otomatis menganggap Jersey resource menjadi reactive.
3. Blocking IO tetap perlu timeout dan pool downstream.

### 28.5 Java 25

Target modern berikutnya.

Untuk Jersey deployment:

1. Perhatikan kompatibilitas container dengan Java 25.
2. Perhatikan library bytecode target.
3. Perhatikan module illegal access.
4. Jalankan smoke test real container.
5. Jangan hanya compile; validasi startup dan request lifecycle.

---

## 29. Decision Matrix: Kapan Jersey as Servlet Cocok?

| Kondisi | Jersey as Servlet Cocok? | Catatan |
|---|---:|---|
| Aplikasi enterprise WAR tradisional | Ya | Model natural |
| Butuh integrasi Servlet filter/security existing | Ya | Servlet boundary kuat |
| Butuh deployment ke Tomcat/Jetty | Ya | Umum dan stabil |
| Butuh full Jakarta EE resources | Ya, tetapi app server ownership harus jelas | Bisa lebih managed |
| Microservice kecil fat jar | Bisa, tetapi embedded sering lebih simple | Servlet masih mungkin via embedded Jetty/Tomcat |
| Native image minimal | Tidak selalu | Perlu evaluasi reflection/provider |
| Ultra-low-latency event-loop architecture | Tidak ideal | Servlet blocking model perlu hati-hati |
| Banyak endpoint non-REST dalam satu WAR | Cocok | Servlet mapping bisa membagi boundary |
| Ingin dependency ownership penuh di app | Cocok via WAR self-contained | Hindari server shared Jersey conflict |

---

## 30. Failure Mode Catalog

### 30.1 Semua Endpoint 404

Kemungkinan:

1. WAR tidak deployed di context path yang dikira.
2. Servlet mapping salah.
3. `@ApplicationPath` salah.
4. Application class tidak ditemukan.
5. Resource tidak terdaftar.
6. Package scanning salah package.
7. Jersey servlet tidak initialized.
8. Request dipotong reverse proxy path rewrite.

### 30.2 Startup Gagal

Kemungkinan:

1. Missing dependency.
2. `javax.*`/`jakarta.*` mismatch.
3. Duplicate provider.
4. HK2 injection failure.
5. Application constructor melempar exception.
6. JSON module tidak compatible.
7. Container Servlet API tidak compatible.

### 30.3 500 Saat Serialize Response

Kemungkinan:

1. JSON provider tidak ada.
2. DTO punya circular reference.
3. Jackson module belum register.
4. Lazy JPA entity keluar transaction.
5. MessageBodyWriter tidak cocok.

### 30.4 415 Unsupported Media Type

Kemungkinan:

1. Client mengirim `Content-Type` salah.
2. Resource `@Consumes` terlalu sempit.
3. MessageBodyReader tidak tersedia.
4. JSON provider tidak aktif.

### 30.5 406 Not Acceptable

Kemungkinan:

1. Client `Accept` tidak cocok.
2. Resource `@Produces` tidak cocok.
3. MessageBodyWriter tidak tersedia untuk media type tersebut.

### 30.6 Memory Leak Setelah Redeploy

Kemungkinan:

1. Executor tidak shutdown.
2. ThreadLocal leak.
3. Static registry.
4. JDBC driver leak.
5. Jersey client leak.
6. Logging appender leak.

---

## 31. Diagnostic Checklist

Saat Jersey as Servlet bermasalah, cek berurutan:

```text
[1] Apakah request sampai ke server?
[2] Apakah host/context path benar?
[3] Apakah servlet mapping benar?
[4] Apakah ServletContainer initialized?
[5] Apakah Application/ResourceConfig loaded?
[6] Apakah resource terdaftar?
[7] Apakah @Path cocok?
[8] Apakah HTTP method cocok?
[9] Apakah @Consumes/@Produces cocok?
[10] Apakah provider JSON tersedia?
[11] Apakah DI berhasil?
[12] Apakah filter sebelum Jersey memblokir request?
[13] Apakah reverse proxy rewrite benar?
[14] Apakah container log menunjukkan classloading issue?
[15] Apakah dependency namespace javax/jakarta konsisten?
```

Gunakan prinsip:

```text
Jangan mulai dari resource method jika request belum terbukti masuk ke Jersey.
```

---

## 32. Mental Model Ringkas

`ServletContainer` adalah **adapter boundary**.

Ia menerima Servlet request, membangun Jersey request, menjalankan Jersey runtime, lalu menulis hasilnya ke Servlet response.

Deployment yang sehat membutuhkan empat hal:

```text
Correct servlet boundary
    context path + servlet mapping + filter chain benar

Correct Jersey application model
    Application/ResourceConfig/resource/provider terdaftar jelas

Correct runtime ownership
    dependency, classloader, DI, lifecycle jelas

Correct operational model
    startup, readiness, shutdown, logging, metrics, tracing jelas
```

Jika salah satu hilang, aplikasi bisa tetap compile, bahkan bisa deploy, tetapi tidak production-ready.

---

## 33. Production Readiness Checklist

Sebelum menyatakan Jersey Servlet deployment siap production, pastikan:

- [ ] Jersey major version sesuai Java dan namespace target.
- [ ] Servlet API container sesuai `javax.*` atau `jakarta.*`.
- [ ] Tidak ada campuran Jersey API/implementation dari container dan app secara tidak sengaja.
- [ ] `ServletContainer` mapping eksplisit dan terdokumentasi.
- [ ] Context path dan servlet path diketahui oleh tim ops/dev.
- [ ] `load-on-startup` aktif.
- [ ] Resource registration deterministik.
- [ ] Provider penting explicit registered.
- [ ] JSON provider tersedia dan diuji.
- [ ] ExceptionMapper mengembalikan error contract konsisten.
- [ ] Servlet filter ordering jelas.
- [ ] Security boundary jelas.
- [ ] Health endpoint berada di path yang benar.
- [ ] Readiness tidak true sebelum Jersey initialized.
- [ ] Startup log mencetak app class, mapping, version, env.
- [ ] Access log dan correlation id tersedia.
- [ ] Thread pool dan timeout container dikonfigurasi.
- [ ] Graceful shutdown diuji.
- [ ] Redeploy leak diuji jika menjalankan WAR dalam long-lived app server.
- [ ] Smoke test berjalan di container target sebenarnya.

---

## 34. Latihan Praktis

### Latihan 1 — Mapping Decomposition

Diberikan:

```text
URL: /aceas/backend/api/v1/cases/123
contextPath: /aceas
servletMapping: /backend/api/*
resource: @Path("/v1/cases")
method: @Path("/{id}")
```

Jawab:

1. Apa resource path yang dilihat Jersey?
2. Apakah endpoint match?
3. Apa URL health jika `@Path("/health")`?

Jawaban:

```text
Resource path = /v1/cases/123
Endpoint match = ya
Health URL = /aceas/backend/api/health
```

### Latihan 2 — Diagnosis 404

Gejala:

```text
GET /app/api/users -> 404
Tomcat access log ada request
Jersey access filter tidak mencetak log
```

Kemungkinan terbesar:

```text
Request belum masuk ke Jersey.
Cek context path, servlet mapping, filter sebelum Jersey, atau aplikasi tidak initialized.
```

### Latihan 3 — Diagnosis 500 JSON

Gejala:

```text
GET /app/api/users/1 -> 500
Resource method sukses return UserDto
Log: MessageBodyWriter not found
```

Kemungkinan:

```text
Provider JSON belum tersedia/terdaftar.
Tambahkan jersey-media-json-jackson dan register JacksonFeature secara eksplisit.
```

---

## 35. Kesimpulan

Jersey sebagai Servlet adalah deployment model yang sangat kuat karena memanfaatkan stabilitas Servlet container dan fleksibilitas Jersey runtime. Tetapi kekuatannya datang bersama kompleksitas boundary.

Engineer top-tier tidak hanya tahu cara menulis `@Path` dan `web.xml`. Ia mampu menjawab:

```text
Apakah request benar-benar masuk ke Jersey?
Siapa pemilik lifecycle resource ini?
Siapa yang membuat dependency ini?
Apa yang terjadi saat startup gagal?
Apa yang terjadi saat shutdown?
Apa yang terjadi saat reverse proxy rewrite path?
Apa yang terjadi saat JSON provider tidak ditemukan?
Apa yang terjadi saat javax/jakarta tercampur?
Apa yang terjadi saat redeploy ke JVM yang sama?
```

Part berikutnya akan membahas deployment model lain yang mirip tetapi punya konsekuensi berbeda: **Jersey as Servlet Filter**.

---

## 36. Referensi

- Eclipse Jersey Documentation — Application Deployment and Runtime Environments: https://eclipse-ee4j.github.io/jersey.github.io/documentation/3.0.1/deployment.html
- Eclipse Jersey Documentation — Deployment using web.xml / Servlet container model: https://eclipse-ee4j.github.io/jersey.github.io/documentation/3.0.0/deployment.html
- Eclipse Jersey Documentation — Modules and Dependencies: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/modules-and-dependencies.html
- Jakarta RESTful Web Services Specification 4.0: https://jakarta.ee/specifications/restful-ws/4.0/
- Jakarta Servlet Specification: https://jakarta.ee/specifications/servlet/
- Apache Tomcat Class Loader HOW-TO: https://tomcat.apache.org/tomcat-10.1-doc/class-loader-howto.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-004.md">⬅️ Part 4 — WAR Deployment Model di Servlet Container</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-006.md">Part 6 — Jersey as Servlet Filter: Filter-Based Deployment Model ➡️</a>
</div>
