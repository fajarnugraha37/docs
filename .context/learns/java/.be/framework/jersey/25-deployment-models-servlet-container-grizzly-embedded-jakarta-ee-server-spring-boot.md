# Part 25 — Deployment Models: Servlet Container, Grizzly, Embedded, Jakarta EE Server, Spring Boot

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`

Status: **Part 25 dari 32**  
Topik utama: **bagaimana Jersey dijalankan, dipaketkan, dipetakan ke HTTP server/container, dan dioperasikan di production**.

---

## 0. Kenapa Part Ini Penting

Banyak engineer bisa membuat resource Jersey, tetapi tidak benar-benar memahami **siapa yang menjalankan Jersey**.

Itu berbahaya, karena banyak incident Jersey bukan berasal dari annotation `@Path`, melainkan dari deployment boundary:

- servlet mapping salah;
- `ApplicationPath` salah;
- resource tidak ter-scan;
- Jersey servlet bentrok dengan Spring MVC servlet;
- dependency `javax.*` bercampur dengan `jakarta.*`;
- container menyediakan versi Jersey/Jackson/Jakarta API yang berbeda dari aplikasi;
- health check masuk ke Jersey padahal harusnya di luar Jersey;
- shutdown Kubernetes memutus request aktif;
- fat jar membawa dependency berbeda dari WAR deployment;
- reverse proxy mengubah path sehingga URI/link yang dibangun Jersey salah;
- local embedded Grizzly berhasil, tetapi WAR di Tomcat/Payara/GlassFish gagal;
- Spring Boot menjalankan Jersey sebagai servlet padahal static resource/error handling diharapkan berjalan seperti Spring MVC.

Part ini membahas Jersey bukan sebagai kode resource, tetapi sebagai **runtime yang dipasang ke host HTTP**.

Mental model dasarnya:

```text
Client
  |
  v
Load Balancer / API Gateway / Reverse Proxy
  |
  v
HTTP Server / Servlet Container / Embedded Container / Jakarta EE Server
  |
  v
Jersey Servlet/Filter/Container Adapter
  |
  v
Jersey Application Runtime
  |
  v
Resource Model + Providers + Filters + Interceptors + DI
```

Kalau kamu tidak tahu layer mana yang bertanggung jawab atas apa, debugging akan berubah menjadi tebak-tebakan.

---

## 1. Deployment Jersey Itu Memiliki Dua Pertanyaan Besar

Setiap deployment Jersey selalu menjawab dua pertanyaan:

1. **Jersey di-host oleh apa?**
2. **Jersey menerima URL yang mana?**

Pertanyaan pertama menentukan runtime ownership:

```text
Host runtime:
- Servlet container
- Embedded Grizzly
- Embedded Jetty/Tomcat-style runtime
- Jakarta EE application server
- Spring Boot embedded servlet container
- Kubernetes/container image wrapper
```

Pertanyaan kedua menentukan routing boundary:

```text
Incoming URL:
/api/v1/cases/123

Bisa dipotong oleh:
- ingress path
- reverse proxy path rewrite
- servlet context path
- servlet mapping
- @ApplicationPath
- resource @Path
- method @Path
```

Seorang engineer top-level selalu memecah URL menjadi komponen berikut:

```text
External URL:
https://api.company.com/aceas/api/v1/cases/123

Reverse proxy / ingress prefix:
/aceas

Servlet context path:
/api

Jersey application path:
/v1

Resource path:
/cases

Method path:
/{id}
```

Dalam production, error umum adalah mengira semua path itu satu hal yang sama.

---

## 2. Peta Deployment Model Jersey

Jersey bisa berjalan dalam beberapa model utama.

```text
Model A — Servlet Container WAR
  Jersey app dipaketkan sebagai WAR dan dijalankan di Tomcat/Jetty/Undertow/dll.

Model B — Jakarta EE Server
  Jersey app berjalan sebagai bagian dari Jakarta EE runtime seperti GlassFish/Payara/Open Liberty/WildFly-like platform.

Model C — Embedded Grizzly
  Aplikasi Java biasa menjalankan Grizzly HTTP server dan memasang Jersey ke server tersebut.

Model D — Spring Boot + Jersey
  Spring Boot menjalankan embedded servlet container, lalu Jersey diregister sebagai servlet/filter.

Model E — Fat Jar / Self-contained Runtime
  Aplikasi mengemas HTTP server + Jersey + dependency sendiri.

Model F — Container Image / Kubernetes
  Salah satu model di atas dibungkus dalam image dan dioperasikan dengan probes, resources, shutdown, config, secrets, logs.
```

Tidak ada model yang selalu paling benar. Yang penting adalah cocok dengan constraint sistem.

---

## 3. Version and Namespace Reality: Java 8 sampai Java 25

Sebelum deployment dibahas, kamu harus disiplin dengan versi.

### 3.1 Jersey 2.x

Umumnya terkait dengan:

```text
Jersey 2.x
  -> JAX-RS / Java EE era
  -> package javax.ws.rs.*
  -> Servlet javax.servlet.*
  -> cocok untuk legacy Java 8/11 enterprise system
```

Contoh import:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;
```

### 3.2 Jersey 3.x

Umumnya terkait dengan:

```text
Jersey 3.x
  -> Jakarta REST era
  -> package jakarta.ws.rs.*
  -> Servlet jakarta.servlet.*
  -> Jakarta EE 9/10 style
```

Contoh import:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

### 3.3 Jersey 4.x

Untuk Jakarta EE 11 / Jakarta REST 4.0 generation:

```text
Jersey 4.x
  -> Jakarta EE 11 aligned
  -> Jakarta REST 4.0 implementation line
  -> Java modern baseline thinking
```

Dalam Java 17/21/25 era, jangan hanya bertanya “apakah compile?”. Pertanyaan yang benar:

```text
Apakah seluruh stack aligned?

JDK version
Servlet API version
Jakarta REST API version
Jersey version
JSON provider version
Bean Validation version
CDI/Spring version
Container version
Build plugin version
```

### 3.4 Kesalahan Paling Mahal: `javax` dan `jakarta` Dicampur

Contoh problem:

```java
// Resource memakai jakarta
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

// Tapi dependency runtime masih Jersey 2.x / javax era
```

Atau kebalikannya:

```java
// Resource memakai javax
import javax.ws.rs.GET;
import javax.ws.rs.Path;

// Tapi runtime memakai Jersey 3.x/4.x / jakarta era
```

Akibatnya bisa berupa:

```text
- resource tidak terdeteksi
- annotation tidak dikenali
- ClassNotFoundException
- NoClassDefFoundError
- NoSuchMethodError
- LinkageError
- deployment berhasil tapi endpoint 404
```

Top 1% engineer tidak men-debug ini dari symptom saja. Mereka langsung bertanya:

```text
Namespace runtime saya javax atau jakarta?
Semua dependency konsisten atau tidak?
Container saya menyediakan API yang mana?
Aplikasi saya membawa API yang mana?
```

---

## 4. Model A — Servlet Container WAR

Ini model klasik.

```text
source code
  -> compile
  -> WAR
  -> deploy ke servlet container
  -> container membuat ServletContext
  -> Jersey servlet/filter diregister
  -> request masuk ke Jersey
```

### 4.1 Kapan Cocok

Model WAR cocok ketika:

- organisasi sudah punya standar deployment application server/container;
- banyak aplikasi Java EE/Jakarta EE legacy;
- operasi production dikelola oleh tim infra yang familiar dengan WAR;
- lifecycle aplikasi dikontrol oleh container;
- clustering/session/security dikelola oleh container;
- ingin memisahkan aplikasi dari HTTP server runtime.

### 4.2 Kapan Tidak Cocok

Kurang cocok ketika:

- ingin self-contained deployment;
- ingin container image kecil dan immutable;
- ingin startup sangat deterministik;
- dependency container sering tidak sinkron dengan aplikasi;
- perlu kontrol penuh terhadap HTTP server configuration;
- team lebih nyaman dengan fat jar/Spring Boot style.

### 4.3 Servlet Registration via `web.xml`

Contoh klasik:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_0.xsd"
         version="6.0">

    <servlet>
        <servlet-name>jersey</servlet-name>
        <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
        <init-param>
            <param-name>jakarta.ws.rs.Application</param-name>
            <param-value>com.example.api.ApiApplication</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>jersey</servlet-name>
        <url-pattern>/api/*</url-pattern>
    </servlet-mapping>

</web-app>
```

Dengan class:

```java
package com.example.api;

import jakarta.ws.rs.ApplicationPath;
import org.glassfish.jersey.server.ResourceConfig;

@ApplicationPath("/")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CaseResource.class);
        register(ErrorMapper.class);
        register(CorrelationIdFilter.class);
    }
}
```

Jika servlet mapping `/api/*` dan `@ApplicationPath("/")`, maka resource `@Path("/cases")` akan tersedia di:

```text
/context-path/api/cases
```

### 4.4 Registration via Servlet 3+ Initializer

Dalam Servlet modern, kamu bisa mendaftarkan programmatically:

```java
public class ApiInitializer implements WebApplicationInitializer {
    @Override
    public void onStartup(ServletContext servletContext) {
        ResourceConfig config = new ApiApplication();

        ServletRegistration.Dynamic jersey = servletContext.addServlet(
            "jersey",
            new ServletContainer(config)
        );

        jersey.setLoadOnStartup(1);
        jersey.addMapping("/api/*");
    }
}
```

Catatan: contoh ini bergantung pada integrasi framework tertentu untuk `WebApplicationInitializer`. Secara prinsip, yang penting adalah **ServletContext mendaftarkan Jersey ServletContainer**.

### 4.5 WAR Dependency Rule

Dalam WAR deployment, dependency bisa berasal dari dua tempat:

```text
1. Application WAR
   WEB-INF/lib/*.jar

2. Container/server runtime
   lib container/application server
```

Bahaya muncul ketika keduanya membawa library yang sama tapi versi berbeda.

Contoh:

```text
WAR membawa:
- jersey-server 3.1.x
- jakarta.ws.rs-api 3.1.x

Container menyediakan:
- jakarta.ws.rs-api 4.0
- jersey-server 4.x
```

Atau:

```text
WAR membawa javax.ws.rs-api
Container adalah jakarta.servlet/jakarta.ws.rs runtime
```

Akibatnya bisa subtle.

Prinsip:

```text
Jika container adalah plain servlet container:
  aplikasi biasanya membawa Jersey sendiri.

Jika container adalah Jakarta EE application server:
  hati-hati karena server mungkin sudah menyediakan Jakarta REST implementation.
```

---

## 5. Model B — Jakarta EE Server

Dalam Jakarta EE server, Jersey bisa menjadi:

1. implementation bawaan server;
2. dependency aplikasi;
3. konflik dengan implementation lain.

### 5.1 Mental Model Jakarta EE Server

```text
Application server
  menyediakan:
  - Servlet
  - CDI
  - Jakarta REST
  - Bean Validation
  - JSON-B/JSON-P
  - Security
  - Transactions
  - JPA
  - Connection pool
```

Jersey dalam konteks ini tidak selalu berdiri sendiri. Ia bisa menjadi bagian dari platform.

### 5.2 Kapan Cocok

Cocok ketika:

- aplikasi memang full Jakarta EE;
- menggunakan CDI, JTA, JPA, Jakarta Security, Bean Validation intensif;
- deployment standard perusahaan adalah application server;
- tim membutuhkan standard platform services;
- compliance mengharuskan runtime tersertifikasi/terkontrol.

### 5.3 Risiko

Risiko utama:

```text
- classloading conflict
- server-provided Jersey berbeda dengan application-provided Jersey
- CDI integration behavior berbeda antar server
- feature Jersey vendor-specific tidak portable
- upgrade server berarti upgrade banyak spec sekaligus
- sulit membuat local reproduction jika server production kompleks
```

### 5.4 Portable Jakarta REST Application

Untuk portabilitas, tulis seperti ini:

```java
package com.example.api;

import jakarta.ws.rs.ApplicationPath;
import jakarta.ws.rs.core.Application;

@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Lalu resource:

```java
package com.example.api.casework;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/cases")
public class CaseResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public CaseListResponse list() {
        return new CaseListResponse();
    }
}
```

Ini lebih spec-oriented.

Namun kalau kamu ingin mendaftarkan Jersey-specific provider/feature secara eksplisit, gunakan `ResourceConfig`:

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(CaseResource.class);
        register(CorrelationIdFilter.class);
        register(JacksonFeature.class);
    }
}
```

Trade-off:

```text
Application murni:
  lebih portable
  kurang eksplisit untuk Jersey-specific setup

ResourceConfig:
  lebih deterministic untuk Jersey
  lebih terikat ke Jersey
```

---

## 6. Model C — Embedded Grizzly

Jersey historically sangat sering dicoba dengan Grizzly karena ringan untuk quickstart dan testing.

Mental model:

```text
main()
  -> buat ResourceConfig
  -> start Grizzly HTTP server
  -> bind Jersey application ke base URI
  -> process berjalan sebagai Java app biasa
```

### 6.1 Contoh Minimal

```java
package com.example;

import java.net.URI;
import org.glassfish.grizzly.http.server.HttpServer;
import org.glassfish.jersey.grizzly2.httpserver.GrizzlyHttpServerFactory;
import org.glassfish.jersey.server.ResourceConfig;

public class Main {
    public static void main(String[] args) throws Exception {
        URI baseUri = URI.create("http://0.0.0.0:8080/");

        ResourceConfig config = new ResourceConfig()
            .register(CaseResource.class)
            .register(ErrorMapper.class)
            .register(CorrelationIdFilter.class);

        HttpServer server = GrizzlyHttpServerFactory.createHttpServer(baseUri, config);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.shutdownNow();
        }));

        Thread.currentThread().join();
    }
}
```

### 6.2 Kapan Cocok

Embedded Grizzly cocok untuk:

- learning;
- test harness;
- lightweight internal service;
- prototype;
- tool/server kecil;
- scenario di mana kamu ingin kontrol penuh tanpa servlet container besar.

### 6.3 Kapan Tidak Cocok

Kurang cocok jika:

- organisasi standard-nya servlet/Spring Boot/Jakarta EE;
- butuh operational maturity yang sudah disediakan container lain;
- butuh integration dengan security/session/management endpoint standard;
- butuh advanced graceful shutdown/lifecycle/probes tanpa banyak custom code;
- tim belum familiar dengan Grizzly production tuning.

### 6.4 Embedded Server Responsibility

Ketika kamu memakai embedded server, kamu mengambil tanggung jawab yang biasanya dipegang container:

```text
- port binding
- TLS
- thread pool
- max header size
- request body limit
- connection timeout
- idle timeout
- graceful shutdown
- access log
- compression
- static resource handling
- health/readiness endpoint
- metrics exposure
- signal handling
```

Jangan menganggap embedded berarti lebih sederhana. Ia sederhana untuk startup, tapi operational responsibility lebih besar.

---

## 7. Model D — Spring Boot + Jersey

Dalam Spring Boot, Jersey biasanya dijalankan di atas embedded servlet container yang dikelola Spring Boot.

```text
Spring Boot Application
  -> Embedded Tomcat/Jetty/Undertow
  -> Jersey Servlet atau Filter
  -> ResourceConfig bean
  -> Jersey resources/providers/filters
  -> Spring beans sebagai service layer
```

### 7.1 Kapan Cocok

Cocok ketika:

- organisasi memakai Spring Boot sebagai platform utama;
- ingin JAX-RS/Jersey programming model;
- service layer, config, security, observability sudah Spring-based;
- ingin actuator/management ecosystem Spring Boot;
- ingin packaging fat jar/container image yang familiar.

### 7.2 Basic Spring Boot Jersey Setup

Contoh:

```java
package com.example;

import org.glassfish.jersey.server.ResourceConfig;
import org.springframework.stereotype.Component;

@Component
public class JerseyConfig extends ResourceConfig {
    public JerseyConfig() {
        register(CaseResource.class);
        register(ErrorMapper.class);
        register(CorrelationIdFilter.class);
    }
}
```

Resource bisa menjadi Spring bean:

```java
package com.example.casework;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.springframework.stereotype.Component;

@Component
@Path("/cases")
public class CaseResource {

    private final CaseService caseService;

    public CaseResource(CaseService caseService) {
        this.caseService = caseService;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public CaseListResponse list() {
        return caseService.listCases();
    }
}
```

### 7.3 Servlet vs Filter Mode

Spring Boot dapat menjalankan Jersey sebagai servlet atau filter tergantung konfigurasi.

Mental model:

```text
Jersey as Servlet:
  Jersey menangani mapping tertentu sebagai servlet sendiri.

Jersey as Filter:
  Jersey berada dalam filter chain dan bisa meneruskan request yang tidak ditanganinya.
```

Kenapa ini penting?

Karena dalam aplikasi Spring Boot, mungkin ada:

```text
- static resources
- actuator endpoints
- Spring MVC endpoints
- error controller
- servlet filters
- Spring Security filter chain
```

Jika Jersey dipasang terlalu luas, misalnya `/*`, ia bisa mengambil request yang seharusnya ditangani layer lain.

### 7.4 Mapping Strategy di Spring Boot

Contoh properti:

```properties
spring.jersey.application-path=/api
```

Atau dengan `@ApplicationPath` pada `ResourceConfig`.

Prinsip:

```text
Jangan mapping Jersey ke /* kecuali kamu benar-benar ingin Jersey menjadi owner seluruh HTTP surface aplikasi.
```

Lebih aman:

```text
/api/*       -> Jersey business API
/actuator/*  -> Spring Boot actuator
/health      -> bisa diarahkan ke actuator/readiness
/static/*    -> static resource jika ada
```

### 7.5 Ownership Rule di Spring Boot

Rekomendasi umum:

```text
Spring owns:
- business service
- repositories
- configuration
- transaction
- security integration
- external clients jika Spring ecosystem dipakai

Jersey owns:
- resource routing
- request/response provider
- filters/interceptors specific to JAX-RS
- exception mapping API contract
```

Hindari:

```text
- sebagian service dibuat HK2, sebagian Spring, tanpa aturan jelas
- resource kadang Spring bean, kadang HK2 resource
- provider butuh Spring dependency tapi diregister sebagai Jersey class tanpa bridge benar
- transaction annotation dipasang di class yang tidak dikelola Spring
```

---

## 8. Model E — Fat Jar / Self-contained Runtime

Fat jar berarti aplikasi membawa runtime sendiri.

```text
java -jar app.jar
```

Bisa berupa:

```text
- Spring Boot fat jar + Jersey
- custom main + Grizzly + Jersey
- embedded servlet container + Jersey
```

### 8.1 Kelebihan

```text
- deployment artifact tunggal
- dependency lebih deterministic
- cocok container image
- local run mirip production
- startup command sederhana
- tidak bergantung ke shared application server
```

### 8.2 Risiko

```text
- artifact besar
- duplicate dependency jika shading buruk
- perlu mengelola server config sendiri
- upgrade security patch menjadi tanggung jawab aplikasi
- classpath conflict tetap mungkin terjadi
```

### 8.3 Fat Jar Classpath Discipline

Cek dependency tree secara rutin:

```bash
mvn dependency:tree
```

atau:

```bash
gradle dependencies
```

Cari:

```text
javax.ws.rs-api
jakarta.ws.rs-api
jersey-server
jersey-container-*
jersey-media-json-*
jackson-*
jakarta.servlet-api
javax.servlet-api
jakarta.validation-api
javax.validation-api
```

Jika kamu melihat `javax` dan `jakarta` aktif bersama untuk API yang sama, itu red flag besar.

---

## 9. Model F — Container Image and Kubernetes

Di Kubernetes, pertanyaan deployment berubah:

```text
Bukan hanya “aplikasi bisa start?”
Tapi:
- kapan pod dianggap siap?
- bagaimana request aktif dihentikan saat rollout?
- bagaimana config masuk?
- bagaimana secret masuk?
- bagaimana logs keluar?
- bagaimana memory limit berinteraksi dengan JVM?
- bagaimana liveness probe tidak membunuh pod yang sebenarnya sehat?
```

### 9.1 Minimal Containerfile Thinking

Contoh sederhana:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Namun production image harus mempertimbangkan:

```text
- base image patching
- non-root user
- timezone
- CA certificates
- JVM memory flags
- heap dump policy
- GC logging policy
- signal handling
- file permissions
- temp directory
```

### 9.2 JVM Memory in Container

JVM modern aware terhadap container memory limit, tetapi kamu tetap harus sadar:

```text
Container memory limit bukan hanya heap.

Memory digunakan oleh:
- Java heap
- metaspace
- thread stack
- direct buffer
- JIT/code cache
- native libraries
- TLS/native allocations
- mmap/file buffers
```

Untuk Jersey, memory pressure sering muncul dari:

```text
- buffering request body
- buffering response body
- JSON serialization large object graph
- multipart temp/memory threshold
- connection pool
- excessive thread pool
- logging payload
- SSE open connection state
```

### 9.3 Kubernetes Probes

Minimal:

```text
startupProbe:
  memastikan aplikasi selesai boot sebelum liveness aktif

readinessProbe:
  menentukan apakah pod boleh menerima traffic

livenessProbe:
  menentukan apakah pod perlu direstart
```

Jangan gunakan endpoint berat untuk liveness.

Bad:

```text
/liveness -> query database, call remote service, check every dependency
```

Better:

```text
/liveness -> process alive, event loop/thread pool not catastrophically dead
/readiness -> app initialized + critical dependency readiness sesuai policy
```

### 9.4 Health Endpoint Placement

Ada dua pilihan:

```text
A. Health endpoint di Jersey
B. Health endpoint di management framework terpisah
```

Jika memakai Spring Boot, sering lebih baik gunakan actuator untuk health/readiness, sementara Jersey fokus business API.

Jika memakai pure Jersey, kamu bisa membuat resource health:

```java
@Path("/health")
public class HealthResource {

    @GET
    @Path("/live")
    @Produces(MediaType.APPLICATION_JSON)
    public HealthResponse live() {
        return new HealthResponse("UP");
    }

    @GET
    @Path("/ready")
    @Produces(MediaType.APPLICATION_JSON)
    public HealthResponse ready() {
        return new HealthResponse("UP");
    }
}
```

Tetapi pastikan endpoint ini tidak melewati filter berat seperti audit/security jika tidak diperlukan.

---

## 10. Servlet Mapping, Application Path, Resource Path

Ini salah satu area paling penting.

### 10.1 Tiga Layer Path

```text
Servlet mapping:
  konfigurasi di container

Application path:
  @ApplicationPath atau config Jersey

Resource path:
  @Path pada resource class/method
```

Contoh:

```text
Context path       = /aceas
Servlet mapping    = /api/*
ApplicationPath    = /v1
Resource @Path     = /cases
Method @Path       = /{id}
```

External URL menjadi:

```text
/aceas/api/v1/cases/{id}
```

Namun tidak semua deployment menggabungkannya dengan cara yang kamu kira. Beberapa setup memilih:

```text
Servlet mapping = /api/*
ApplicationPath = /
```

atau:

```text
Servlet mapping = /*
ApplicationPath = /api
```

Pilih satu gaya dan konsisten.

### 10.2 Recommended Production Rule

Untuk mengurangi kebingungan:

```text
Gunakan satu layer utama sebagai API prefix.
```

Contoh WAR/Servlet:

```text
Servlet mapping = /api/*
ApplicationPath = /
Resource path = /cases
```

Contoh Jakarta REST portable:

```text
ApplicationPath = /api
Resource path = /cases
```

Contoh Spring Boot:

```text
spring.jersey.application-path=/api
Resource path=/cases
```

Yang buruk:

```text
Ingress rewrite = /service
Context path = /service
Servlet mapping = /api/*
ApplicationPath = /api
Resource path = /api/cases
```

Ini menghasilkan path yang sulit ditebak dan rawan double prefix.

---

## 11. Reverse Proxy, Gateway, and Base URI

Di production, Jersey jarang langsung menerima request dari browser/client.

Biasanya:

```text
Client
  -> CDN/WAF
  -> API Gateway
  -> Ingress
  -> Service
  -> Pod/Container
  -> Servlet/Jersey
```

Masalah muncul karena Jersey melihat internal request:

```text
http://10.0.12.34:8080/api/cases
```

Padahal client melihat:

```text
https://api.company.com/aceas/api/cases
```

Kalau resource memakai `UriInfo.getBaseUri()` untuk membuat link, hasilnya bisa salah.

### 11.1 Forwarded Headers

Proxy biasanya mengirim:

```text
Forwarded
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
X-Forwarded-Prefix
X-Forwarded-For
```

Namun aplikasi/container harus dikonfigurasi agar mempercayainya.

Jangan percaya forwarded header dari sembarang client publik tanpa trusted proxy boundary, karena client bisa memalsukan header.

### 11.2 Rule untuk URI Generation

Untuk API internal:

```text
Relative link sering cukup dan lebih aman terhadap proxy rewrite.
```

Untuk API publik yang butuh absolute URL:

```text
Pastikan public base URL dikonfigurasi eksplisit atau forwarded header diproses secara aman.
```

Contoh config eksplisit:

```properties
app.public-base-url=https://api.company.com/aceas
```

Kemudian gunakan service khusus:

```java
public final class PublicUriBuilder {
    private final URI publicBaseUri;

    public PublicUriBuilder(URI publicBaseUri) {
        this.publicBaseUri = publicBaseUri;
    }

    public URI caseUri(String id) {
        return publicBaseUri.resolve("/api/v1/cases/" + id);
    }
}
```

---

## 12. Graceful Shutdown

Deployment production harus menjawab:

```text
Apa yang terjadi pada request aktif saat process dimatikan?
```

### 12.1 Shutdown Timeline di Kubernetes

```text
1. Pod diberi sinyal termination.
2. Readiness harus berubah menjadi false.
3. Load balancer/Service berhenti mengirim traffic baru.
4. Request aktif diberi waktu selesai.
5. JVM menerima SIGTERM.
6. Application shutdown hook/container shutdown berjalan.
7. Setelah grace period habis, SIGKILL.
```

### 12.2 Jersey-Level Concern

Jersey resource bisa sedang:

```text
- membaca request body besar
- menulis streaming response
- melakukan outbound HTTP call
- menjalankan async response
- memproses upload multipart
- memegang database transaction
```

Jika shutdown tidak graceful:

```text
- client menerima connection reset
- transaction rollback mendadak
- audit event tidak tercatat
- file upload partial tertinggal
- response export terputus
- async task orphan
```

### 12.3 Shutdown Design

Minimal design:

```text
- readiness false sebelum stop menerima traffic
- timeout outbound lebih pendek dari termination grace period
- async executor shutdown dengan deadline
- streaming endpoint aware disconnect
- temp file cleanup
- audit finalization best-effort
```

Contoh konsep:

```java
public final class ShutdownState {
    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);

    public void markShuttingDown() {
        shuttingDown.set(true);
    }

    public boolean isShuttingDown() {
        return shuttingDown.get();
    }
}
```

Readiness:

```java
@Path("/health/ready")
public class ReadinessResource {
    private final ShutdownState shutdownState;

    public ReadinessResource(ShutdownState shutdownState) {
        this.shutdownState = shutdownState;
    }

    @GET
    public Response ready() {
        if (shutdownState.isShuttingDown()) {
            return Response.status(Response.Status.SERVICE_UNAVAILABLE).build();
        }
        return Response.ok().build();
    }
}
```

---

## 13. Static Content, Error Pages, and Non-API Paths

Jersey bukan static content framework utama.

Dalam deployment campuran, tentukan owner:

```text
/static/*    -> web server/container/Spring MVC
/api/*       -> Jersey
/actuator/*  -> Spring Boot Actuator
/error       -> container/Spring error handling
```

Jika Jersey mengambil `/*`, maka request static resource bisa masuk Jersey dan menghasilkan 404 dari Jersey, bukan dari web server.

Prinsip:

```text
Jangan biarkan Jersey menjadi catch-all kecuali memang API-only service.
```

---

## 14. TLS and HTTPS Termination

TLS bisa diterminasi di beberapa tempat:

```text
Client -> LB terminates TLS -> app receives HTTP
Client -> LB passes TLS -> app terminates TLS
Client -> mTLS ingress -> app receives trusted identity header
Client -> service mesh mTLS -> app receives HTTP internally
```

Jersey biasanya tidak peduli langsung terhadap TLS jika berada di servlet container. Tetapi security logic bisa bergantung pada:

```text
- scheme http/https
- client certificate
- forwarded proto
- principal
- secure flag cookie
- absolute redirect URL
```

Jika app melihat request sebagai HTTP padahal external HTTPS, maka:

```text
- generated URL bisa http://
- secure cookie decision bisa salah
- redirect bisa salah
- HSTS assumption salah
```

Maka, proxy/header/container config harus benar.

---

## 15. Logging in Deployment

Jersey app di production sebaiknya log ke stdout/stderr dalam container image.

Prinsip:

```text
Application log:
  structured, correlation-aware, no sensitive payload

Access log:
  method, path, status, latency, size, client identity where safe

Audit log:
  domain/security action, not raw debug log
```

Jangan mencampur semuanya menjadi satu log filter besar.

Deployment-level log concern:

```text
- log rotation jika VM/WAR legacy
- stdout aggregation jika Kubernetes
- MDC propagation
- JSON log format
- request id from gateway
- avoid duplicated access logs from proxy + app unless intentional
```

---

## 16. Configuration Injection

Deployment berbeda berarti config berbeda.

Sumber config:

```text
- environment variable
- system property
- config file
- Spring Environment
- MicroProfile Config
- Kubernetes ConfigMap
- Kubernetes Secret
- SSM/Secrets Manager/Vault
```

Jersey `ResourceConfig` sering menjadi tempat registration, tetapi jangan membuatnya menjadi tempat membaca semua config secara ad-hoc.

Bad:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        String timeout = System.getenv("REMOTE_TIMEOUT");
        register(new RemoteClient(Integer.parseInt(timeout)));
    }
}
```

Better:

```java
public final class AppConfig {
    private final Duration remoteTimeout;
    private final URI remoteBaseUri;

    // validate in constructor/factory
}
```

Lalu bind/configure secara eksplisit.

---

## 17. Deployment Failure Modes

### 17.1 404 Semua Endpoint

Kemungkinan:

```text
- Jersey servlet tidak terdaftar
- mapping salah
- @ApplicationPath salah
- package scanning tidak menemukan resource
- resource memakai javax annotation tapi runtime jakarta
- resource class tidak public
- application class tidak terdeteksi
- context path berbeda dari asumsi
- ingress rewrite salah
```

Diagnosis:

```text
1. Cek startup log: apakah Jersey application boot?
2. Cek registered resources jika logging tersedia.
3. Hit health/resource paling sederhana.
4. Cek context path + servlet mapping + ApplicationPath + ResourcePath.
5. Cek namespace import.
```

### 17.2 405 Method Not Allowed

Kemungkinan:

```text
- path cocok, HTTP method tidak cocok
- preflight OPTIONS tidak ditangani
- gateway mengubah method
- resource method tidak registered karena annotation namespace mismatch
```

### 17.3 415 Unsupported Media Type

Kemungkinan:

```text
- Content-Type tidak cocok @Consumes
- client mengirim text/plain padahal JSON
- multipart provider tidak aktif
- custom media type tidak registered
```

### 17.4 406 Not Acceptable

Kemungkinan:

```text
- Accept header tidak cocok @Produces
- browser mengirim Accept kompleks
- provider tidak bisa menulis media type yang diminta
```

### 17.5 Startup Gagal di Production tapi Berhasil Local

Kemungkinan:

```text
- container menyediakan dependency berbeda
- local fat jar beda dari WAR production
- environment variable hilang
- classpath scanning berbeda
- Java version beda
- servlet/Jakarta version beda
- security manager/policy lama
- file permission berbeda
```

### 17.6 `NoSuchMethodError` / `LinkageError`

Hampir selalu curiga dependency conflict.

Langkah:

```text
1. Cek dependency tree.
2. Cek container-provided libraries.
3. Cek duplicate JAR di WEB-INF/lib.
4. Cek javax/jakarta mix.
5. Cek transitive dependency dari JSON provider/Jersey extension.
```

---

## 18. Deployment Decision Matrix

| Model | Cocok Untuk | Kekuatan | Risiko |
|---|---|---|---|
| WAR Servlet Container | Legacy enterprise, standard container | Familiar, clear servlet model | dependency/container mismatch |
| Jakarta EE Server | Full Jakarta EE apps | CDI/JTA/JPA/security integrated | classloading and portability complexity |
| Embedded Grizzly | learning, prototype, lightweight services | simple startup, self-contained | operational responsibility besar |
| Spring Boot + Jersey | Spring platform with JAX-RS API | config/actuator/security ecosystem | ownership conflict Spring vs Jersey |
| Fat Jar | cloud-native/self-contained deployment | deterministic artifact | patching and runtime config responsibility |
| Kubernetes Image | scalable production deployment | probes, rollout, isolation | shutdown/memory/probe mistakes |

---

## 19. Recommended Deployment Patterns

### Pattern 1 — API-only Spring Boot + Jersey

```text
Spring Boot owns platform.
Jersey owns /api.
Actuator owns /actuator.
Spring owns DI/config/security.
Jersey owns JAX-RS provider/filter/mapper.
```

Good for microservices.

### Pattern 2 — Jakarta EE Application

```text
Application server owns platform services.
Jakarta REST/Jersey owns API.
CDI owns service lifecycle.
JTA owns transaction boundary.
```

Good for enterprise platform consistency.

### Pattern 3 — Explicit Servlet WAR

```text
Plain servlet container.
WAR brings Jersey.
Servlet mapping explicit.
No scanning magic.
```

Good for controlled legacy modernization.

### Pattern 4 — Embedded Grizzly Tooling Server

```text
Main method starts server.
ResourceConfig explicit.
Used for internal tool/prototype/test harness.
```

Good for low ceremony.

---

## 20. Anti-Patterns

### 20.1 Catch-all Jersey Mapping Without Intent

```text
Jersey mapped to /*
Static resources expected elsewhere
Actuator expected elsewhere
Error handling expected elsewhere
```

Result:

```text
Jersey intercepts everything.
```

### 20.2 Mixed Namespace Deployment

```text
javax.ws.rs annotations + jakarta runtime
jakarta.ws.rs annotations + javax runtime
```

Result:

```text
mysterious 404/startup/linkage errors
```

### 20.3 Container and App Both Provide Jersey

```text
Application server has Jersey.
WAR includes different Jersey version.
```

Result:

```text
classloading conflict
```

### 20.4 Health Check Through Heavy Filter Chain

```text
/health requires auth, audit, DB transaction, outbound dependency
```

Result:

```text
false unhealthy pod
cascading restart
```

### 20.5 No Graceful Shutdown

```text
SIGTERM -> immediate stop
```

Result:

```text
dropped requests, partial uploads, orphan async tasks
```

### 20.6 Local Deployment Not Equivalent to Production

```text
local: embedded Grizzly
prod: Jakarta EE server
```

without compatibility tests.

Result:

```text
works locally, fails in deployment
```

---

## 21. Production Checklist

### 21.1 Version Alignment

```text
[ ] Java version defined
[ ] Jersey version defined
[ ] Jakarta REST/JAX-RS version defined
[ ] Servlet API version defined
[ ] JSON provider version defined
[ ] Bean Validation version defined
[ ] CDI/Spring version defined
[ ] No javax/jakarta mix unless intentionally isolated
```

### 21.2 Path Mapping

```text
[ ] external URL documented
[ ] ingress path documented
[ ] context path documented
[ ] servlet mapping documented
[ ] ApplicationPath documented
[ ] resource path documented
[ ] generated links tested behind proxy
```

### 21.3 Runtime Ownership

```text
[ ] who owns DI lifecycle?
[ ] who owns transaction?
[ ] who owns security?
[ ] who owns config?
[ ] who owns health endpoints?
[ ] who owns graceful shutdown?
[ ] who owns access logs?
```

### 21.4 Kubernetes

```text
[ ] startupProbe configured if startup non-trivial
[ ] readinessProbe separate from livenessProbe
[ ] terminationGracePeriodSeconds realistic
[ ] preStop/readiness drain considered
[ ] memory limit aligned with JVM
[ ] logs to stdout/stderr
[ ] secrets not logged
[ ] temp storage considered for multipart/export
```

### 21.5 Failure Readiness

```text
[ ] dependency tree captured in build artifact
[ ] startup logs show registered resources/providers
[ ] test verifies actual deployed path
[ ] smoke test covers JSON provider
[ ] smoke test covers exception mapper
[ ] smoke test covers health endpoint
[ ] rollback plan exists
```

---

## 22. Java 8–25 Deployment Notes

### Java 8

```text
- mostly Jersey 2.x / javax era
- WAR/application server legacy common
- no module system
- older TLS defaults
- older container memory ergonomics
- more manual GC/container tuning
```

### Java 11

```text
- stronger baseline for modern TLS/runtime
- still many Jersey 2.x systems
- migration bridge era
```

### Java 17

```text
- common modern enterprise baseline
- Jakarta ecosystem increasingly assumes Java 17+
- good target for migration stabilization
```

### Java 21

```text
- virtual threads available
- modern GC/runtime
- good LTS target
- verify servlet container support and ThreadLocal assumptions
```

### Java 25

```text
- newest LTS line
- attractive for forward-looking platform
- verify framework/container compatibility carefully
- do not upgrade only JVM without testing Jersey/container/provider stack
```

Rule:

```text
JDK upgrade is not just language/runtime upgrade.
For Jersey production, it is a full stack compatibility exercise.
```

---

## 23. Mental Model Summary

Jersey deployment is not one thing. It is the composition of:

```text
HTTP host
  + container lifecycle
  + servlet/filter mapping
  + application path
  + Jersey runtime
  + DI ownership
  + provider registration
  + config source
  + observability
  + shutdown behavior
  + dependency/classloading model
```

A production-grade engineer does not ask only:

```text
How do I run Jersey?
```

They ask:

```text
Who owns the HTTP lifecycle?
Who owns the object lifecycle?
Who owns the dependency versions?
Who owns the URL namespace?
Who owns health and shutdown?
Who owns security and observability?
What differs between local, test, and production?
```

That is the real deployment model.

---

## 24. Mini Exercises

### Exercise 1 — Path Decomposition

Given external URL:

```text
https://api.company.com/aceas/service/api/v1/cases/123
```

Break it into:

```text
- proxy prefix
- context path
- servlet mapping
- ApplicationPath
- resource path
- method path
```

Then propose a simpler mapping strategy.

### Exercise 2 — Deployment Diagnosis

A Jersey resource works locally in embedded Grizzly:

```text
GET http://localhost:8080/cases
```

But after WAR deployment:

```text
GET https://dev.company.com/app/api/cases
```

returns 404.

List at least 10 possible causes and how you would verify each one.

### Exercise 3 — Namespace Audit

Run dependency tree and identify whether the app is `javax` or `jakarta` aligned.

Check for:

```text
javax.ws.rs-api
jakarta.ws.rs-api
javax.servlet-api
jakarta.servlet-api
javax.validation-api
jakarta.validation-api
```

### Exercise 4 — Health Endpoint Design

Design `/live` and `/ready` for a Jersey service that depends on:

```text
- Oracle DB
- Redis
- outbound HTTP service
- async executor
```

Decide which dependency belongs to liveness, readiness, or neither.

### Exercise 5 — Graceful Shutdown

For an endpoint that uploads a 500 MB file and stores metadata in DB, describe what should happen when Kubernetes sends SIGTERM mid-upload.

---

## 25. Key Takeaways

- Jersey deployment is a composition problem, not only a packaging problem.
- The most important deployment questions are host runtime, URL ownership, dependency ownership, lifecycle ownership, and shutdown behavior.
- `javax` vs `jakarta` mismatch is one of the highest-value things to check early.
- Servlet mapping, `@ApplicationPath`, and resource `@Path` must be documented as a single URL contract.
- Spring Boot + Jersey is powerful, but ownership between Spring and Jersey must be explicit.
- Embedded Grizzly is easy to start but shifts operational responsibility to you.
- Kubernetes requires readiness, liveness, memory, logging, and graceful shutdown thinking.
- A Jersey app that works locally is not necessarily deployment-ready.

---

## 26. Seri Status

Sampai di sini:

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
Part 24 — selesai
Part 25 — selesai
Part 26 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri **belum selesai**.

Berikutnya:

```text
Part 26 — Configuration Engineering: Properties, Environments, Features, and Runtime Flags
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 24 — Virtual Threads, Modern Java, and Jersey Runtime Compatibility Thinking](./24-virtual-threads-modern-java-jersey-runtime-compatibility-thinking.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 26 — Configuration Engineering: Properties, Environments, Features, and Runtime Flags](./26-configuration-engineering-properties-environments-features-runtime-flags.md)
