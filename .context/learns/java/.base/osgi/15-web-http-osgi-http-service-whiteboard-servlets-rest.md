# Part 15 — Web and HTTP in OSGi: Http Service, HTTP Whiteboard, Servlets, REST

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `15-web-http-osgi-http-service-whiteboard-servlets-rest.md`  
Target Java: 8 sampai 25  
Level: Advanced / platform engineering

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu melihat web stack di OSGi bukan sebagai “WAR kecil di dalam framework”, tetapi sebagai **dynamic HTTP composition layer**.

Target pemahaman:

1. Mengerti perbedaan mental model antara:
   - servlet container tradisional,
   - Spring Boot embedded server,
   - Java EE/Jakarta EE web module,
   - OSGi Http Service,
   - OSGi HTTP Whiteboard,
   - OSGi JAX-RS / Jakarta REST Whiteboard.
2. Mendesain endpoint, filter, listener, static resource, dan servlet context sebagai **service yang bisa muncul/hilang saat runtime**.
3. Mengerti konsekuensi classloading OSGi terhadap servlet, filter, JAX-RS resource, JSON provider, annotation scanning, TCCL, dan third-party web framework.
4. Mampu menentukan kapan memakai:
   - raw servlet,
   - HTTP Whiteboard,
   - JAX-RS Whiteboard,
   - embedded Jetty/Undertow/Tomcat,
   - Karaf/Pax Web,
   - atau memisahkan web layer ke service eksternal.
5. Mampu membuat desain web modular yang aman untuk production:
   - context isolation,
   - dynamic unregister,
   - graceful shutdown,
   - security boundary,
   - versioning endpoint,
   - observability,
   - failure mode.

---

## 1. Posisi Part Ini dalam Series

Sebelumnya kita sudah membahas:

- bundle lifecycle,
- manifest,
- classloading,
- dependency model,
- resolver,
- semantic versioning,
- service registry,
- Declarative Services,
- configuration,
- bnd,
- Felix,
- Equinox,
- Karaf.

Sekarang kita masuk ke salah satu area yang paling sering membuat OSGi terlihat “aneh” bagi engineer web biasa: **HTTP dan web application**.

Di Java umum, web application sering diasumsikan seperti ini:

```text
one application
  -> one classpath
  -> one servlet context
  -> one dependency graph
  -> one deployment artifact
  -> one startup lifecycle
```

Di OSGi, asumsi itu berubah:

```text
one OSGi framework
  -> many bundles
  -> many classloaders
  -> many service providers
  -> dynamic servlet/filter/resource registrations
  -> possibly many servlet contexts
  -> HTTP runtime observes services
  -> endpoint topology can change at runtime
```

Mental model utama:

> Di OSGi, endpoint web bukan selalu “isi dari WAR”. Endpoint web bisa menjadi **service contribution** dari bundle yang aktif.

Ini penting karena OSGi web layer mengikuti filosofi OSGi:

- dependency eksplisit,
- lifecycle eksplisit,
- runtime dinamis,
- capability/service driven,
- modular composition,
- visibility terbatas oleh bundle wiring.

---

## 2. Evolusi Web di OSGi

Secara historis ada beberapa model web di OSGi.

### 2.1 Http Service Lama

Http Service adalah model lama untuk mendaftarkan servlet dan resource secara programmatic.

Secara sederhana:

```java
httpService.registerServlet("/hello", new HelloServlet(), null, null);
httpService.registerResources("/static", "/www", null);
```

Karakteristik:

- bundle mendapatkan service `HttpService`,
- bundle mendaftarkan servlet/resource sendiri,
- unregister biasanya dilakukan saat stop,
- cukup sederhana,
- tetapi kurang idiomatis untuk OSGi modern jika dibanding HTTP Whiteboard.

Masalah yang sering muncul:

- lifecycle manual,
- raw registration scattered in activator/component,
- error unregister jika start gagal separuh,
- susah dipahami sebagai topology deklaratif,
- tidak sebaik DS + Whiteboard untuk dynamic composition.

### 2.2 HTTP Whiteboard

HTTP Whiteboard membalik arah kontrol.

Bukan bundle yang memanggil `registerServlet()`, tetapi bundle cukup **mendaftarkan servlet sebagai OSGi service** dengan properti tertentu.

HTTP runtime mengamati service registry, lalu memasangnya ke HTTP server.

Mental model:

```text
Bundle A registers Servlet service + properties
Bundle B registers Filter service + properties
Bundle C registers ServletContextHelper service + properties

HTTP Whiteboard implementation observes registry
  -> matches servlet/filter/resource/listener to context
  -> exposes endpoint
  -> removes endpoint when service disappears
```

Ini lebih selaras dengan OSGi karena:

- declarative,
- dynamic,
- composable,
- DS-friendly,
- lebih mudah didiagnosis sebagai service graph,
- endpoint lifecycle mengikuti service lifecycle.

OSGi HTTP Whiteboard specification menyediakan cara untuk menggunakan servlet, filter, listener, dan web resource dalam lingkungan OSGi menggunakan Whiteboard Pattern. citeturn923619search0

### 2.3 JAX-RS Whiteboard / Jakarta REST Whiteboard

Untuk REST API, OSGi juga punya whiteboard spesifik JAX-RS/Jakarta REST.

Modelnya mirip:

```text
Resource class registered as service
Application registered as service
Extension/provider registered as service
JAX-RS Whiteboard observes registry
  -> builds REST application dynamically
```

OSGi JAX-RS Whiteboard memperbolehkan lebih dari satu active JAX-RS Whiteboard dalam satu framework, sehingga bisa ada banyak holder aplikasi JAX-RS. citeturn923619search4

Pada OSGi Compendium 8.1, spesifikasi lama berbasis `javax` digantikan/diupdate ke dunia Jakarta: Jakarta Servlet Whiteboard menggantikan HTTP Whiteboard lama berbasis `javax`, dan Jakarta RESTful Web Services Whiteboard menggantikan JAX-RS Whiteboard berbasis `javax`. citeturn923619search8

Konsekuensi penting:

- Java 8-era OSGi sering memakai `javax.servlet` dan `javax.ws.rs`.
- Java 11/17/21/25-era modern lebih sering menghadapi `jakarta.servlet` dan `jakarta.ws.rs`.
- Migrasi `javax` ke `jakarta` bukan rename kecil; ini memengaruhi package import/export, resolver, binary compatibility, API bundles, dan runtime implementation.

---

## 3. Perbedaan OSGi Web dengan Servlet Container Tradisional

### 3.1 Servlet Container Tradisional

Pada servlet container biasa:

```text
WAR deployed
  WEB-INF/classes
  WEB-INF/lib/*.jar
  web.xml / annotations
  one ServletContext
  container scans and starts application
```

Boundary-nya adalah WAR.

Dependency visibility biasanya:

```text
application classes + WEB-INF/lib + container APIs
```

Lifecycle:

```text
deploy WAR -> create context -> scan -> instantiate -> init -> serve
undeploy WAR -> destroy context
```

### 3.2 OSGi HTTP Whiteboard

Pada OSGi:

```text
Bundle A exports API
Bundle B registers servlet service
Bundle C registers filter service
Bundle D registers resource service
Bundle E registers auth service
HTTP runtime composes them
```

Boundary-nya bukan WAR, tetapi:

- bundle,
- service,
- servlet context helper,
- service properties,
- bundle wiring.

Lifecycle:

```text
bundle starts
  -> DS component satisfied
  -> servlet service registered
  -> HTTP Whiteboard maps it
  -> endpoint appears

bundle stops/config changes/reference disappears
  -> servlet service unregistered
  -> endpoint disappears
```

Implikasi besar:

| Area | Servlet Container Biasa | OSGi HTTP Whiteboard |
|---|---|---|
| Deployment unit | WAR | Bundle/service contribution |
| Classpath | Per webapp | Per bundle wiring |
| Endpoint discovery | web.xml/annotations/scanning | OSGi service properties |
| Runtime change | deploy/undeploy WAR | service arrival/departure |
| Context | usually one per WAR | multiple contexts possible |
| Dependency visibility | webapp classloader | bundle classloader/imports |
| Extension | container-specific | OSGi whiteboard/service registry |
| Failure mode | app context fails | individual contribution can fail |

---

## 4. Mental Model: HTTP Runtime sebagai Observer

HTTP Whiteboard runtime bukan “owner” dari semua object web. Ia adalah observer dan composer.

```text
+-----------------------------+
| OSGi Service Registry       |
|                             |
| Servlet service             |
| Filter service              |
| Listener service            |
| Resource service            |
| ServletContextHelper        |
+-------------+---------------+
              |
              | observed by
              v
+-----------------------------+
| HTTP Whiteboard Runtime     |
|                             |
| match context               |
| match pattern               |
| order filters               |
| init/destroy servlet        |
| expose endpoint             |
+-------------+---------------+
              |
              v
+-----------------------------+
| Embedded HTTP Server        |
| Jetty / Tomcat / Undertow   |
+-----------------------------+
```

Satu hal penting:

> `ACTIVE` bundle tidak berarti endpoint tersedia. Endpoint tersedia jika service servlet/filter/resource/context sudah registered dan diterima oleh HTTP Whiteboard.

Sama seperti DS:

```text
Bundle ACTIVE != Component ACTIVE != Service Registered != Endpoint Mounted != Endpoint Healthy
```

Untuk production readiness, jangan pakai indikator terlalu dangkal.

---

## 5. Konsep Dasar HTTP Whiteboard

HTTP Whiteboard bekerja dengan service dan properties.

Jenis contribution utama:

1. `Servlet`
2. `Filter`
3. `ServletContextHelper`
4. resource mapping
5. listener
6. error page
7. preprocessor
8. multipart configuration
9. context selection

Nama property mengikuti konstanta OSGi, biasanya berawalan:

```text
osgi.http.whiteboard.*
```

Contoh property umum:

```text
osgi.http.whiteboard.servlet.pattern=/hello/*
osgi.http.whiteboard.filter.pattern=/api/*
osgi.http.whiteboard.context.name=default
osgi.http.whiteboard.context.path=/
osgi.http.whiteboard.resource.pattern=/assets/*
osgi.http.whiteboard.resource.prefix=/static
```

Dalam kode lebih baik memakai konstanta atau annotation helper agar tidak typo.

---

## 6. Minimal Servlet dengan DS + HTTP Whiteboard

Contoh sederhana menggunakan `javax.servlet` style.

```java
package com.example.web.internal;

import java.io.IOException;

import javax.servlet.Servlet;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.http.whiteboard.HttpWhiteboardConstants;

@Component(
    service = Servlet.class,
    property = {
        HttpWhiteboardConstants.HTTP_WHITEBOARD_SERVLET_PATTERN + "=/hello"
    }
)
public final class HelloServlet extends HttpServlet {

    @Override
    protected void doGet(
            HttpServletRequest req,
            HttpServletResponse resp
    ) throws ServletException, IOException {
        resp.setContentType("text/plain");
        resp.getWriter().println("Hello from OSGi HTTP Whiteboard");
    }
}
```

Yang terjadi:

1. DS membuat component.
2. Component registered sebagai service `Servlet`.
3. Service memiliki property `osgi.http.whiteboard.servlet.pattern=/hello`.
4. HTTP Whiteboard runtime melihat service ini.
5. Servlet dipasang ke server HTTP.
6. Saat bundle/component berhenti, servlet di-unmount.

Perhatikan: tidak ada `web.xml`, tidak ada WAR, tidak ada manual `registerServlet()`.

---

## 7. Anatomy Service Properties

Dalam HTTP Whiteboard, service properties adalah kontrak deployment endpoint.

Contoh:

```java
@Component(
    service = Servlet.class,
    property = {
        "osgi.http.whiteboard.servlet.pattern=/cases/*",
        "osgi.http.whiteboard.servlet.name=caseServlet",
        "osgi.http.whiteboard.context.select=(osgi.http.whiteboard.context.name=case-api)"
    }
)
public final class CaseServlet extends HttpServlet {
    // ...
}
```

Property di atas menjawab:

- servlet ini mounted di path apa?
- namanya apa?
- context mana yang dipilih?

Jika `context.select` salah, servlet mungkin registered sebagai OSGi service tetapi tidak mounted.

Ini failure mode umum:

```text
bundle ACTIVE
component ACTIVE
servlet service registered
but no endpoint
```

Penyebab sering:

- context filter tidak match,
- pattern invalid,
- required context belum ada,
- duplicate/conflicting mapping,
- HTTP runtime belum aktif,
- package servlet API tidak resolve ke provider yang tepat,
- service object gagal `init()`.

---

## 8. ServletContextHelper: Context sebagai Boundary

Dalam servlet container biasa, context biasanya melekat pada WAR.

Dalam HTTP Whiteboard, context bisa direpresentasikan oleh `ServletContextHelper`.

Contoh:

```java
package com.example.web.internal;

import java.net.URL;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.http.context.ServletContextHelper;
import org.osgi.service.http.whiteboard.HttpWhiteboardConstants;

@Component(
    service = ServletContextHelper.class,
    property = {
        HttpWhiteboardConstants.HTTP_WHITEBOARD_CONTEXT_NAME + "=case-api",
        HttpWhiteboardConstants.HTTP_WHITEBOARD_CONTEXT_PATH + "=/case"
    }
)
public final class CaseApiContext extends ServletContextHelper {

    @Override
    public URL getResource(String name) {
        return super.getResource(name);
    }

    @Override
    public String getMimeType(String name) {
        return super.getMimeType(name);
    }
}
```

Servlet bisa memilih context:

```java
@Component(
    service = Servlet.class,
    property = {
        HttpWhiteboardConstants.HTTP_WHITEBOARD_SERVLET_PATTERN + "=/applications/*",
        HttpWhiteboardConstants.HTTP_WHITEBOARD_CONTEXT_SELECT
            + "=(osgi.http.whiteboard.context.name=case-api)"
    }
)
public final class ApplicationServlet extends HttpServlet {
    // ...
}
```

Endpoint menjadi:

```text
/case/applications/*
```

### Kenapa Context Penting?

Context bisa menjadi boundary untuk:

- base path,
- static resource,
- security policy,
- MIME handling,
- resource lookup,
- tenant/agency separation,
- API version separation,
- admin vs public endpoint,
- health/management endpoint.

Contoh context design:

```text
/public        -> public API context
/internal      -> internal service context
/admin         -> admin operation context
/api/v1        -> stable external API v1
/api/v2        -> stable external API v2
/assets        -> static resources
```

Dalam OSGi, ini bisa dipasang secara modular.

---

## 9. Static Resource Registration

Static resource bisa didaftarkan sebagai service dengan properties.

Contoh konseptual:

```java
@Component(
    service = Object.class,
    property = {
        HttpWhiteboardConstants.HTTP_WHITEBOARD_RESOURCE_PATTERN + "=/assets/*",
        HttpWhiteboardConstants.HTTP_WHITEBOARD_RESOURCE_PREFIX + "=/web/assets"
    }
)
public final class StaticResources {
}
```

Maknanya:

```text
request /assets/app.css
  -> mapped to bundle resource /web/assets/app.css
```

Penting:

- resource berasal dari bundle yang mendaftarkan service,
- classloader/resource visibility mengikuti bundle tersebut,
- static resource tidak otomatis melihat resource bundle lain,
- fragment bisa menambah resource ke host bundle, tetapi harus hati-hati.

Gunakan static resource di OSGi untuk:

- admin console kecil,
- plugin UI assets,
- documentation endpoint,
- runtime management page,
- embedded portal ringan.

Jangan gunakan untuk:

- full SPA production besar tanpa deployment strategy yang jelas,
- asset pipeline kompleks tanpa cache/versioning,
- multi-tenant static content tanpa boundary.

---

## 10. Filter Registration

Filter juga didaftarkan sebagai service.

Contoh:

```java
package com.example.web.internal;

import java.io.IOException;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;

import org.osgi.service.component.annotations.Component;
import org.osgi.service.http.whiteboard.HttpWhiteboardConstants;

@Component(
    service = Filter.class,
    property = {
        HttpWhiteboardConstants.HTTP_WHITEBOARD_FILTER_PATTERN + "=/api/*",
        HttpWhiteboardConstants.HTTP_WHITEBOARD_FILTER_NAME + "correlationFilter",
        "service.ranking:Integer=100"
    }
)
public final class CorrelationFilter implements Filter {

    @Override
    public void doFilter(
            ServletRequest request,
            ServletResponse response,
            FilterChain chain
    ) throws IOException, ServletException {
        try {
            // create or propagate correlation id
            chain.doFilter(request, response);
        } finally {
            // cleanup MDC / ThreadLocal
        }
    }
}
```

Filter ordering biasanya dipengaruhi oleh service ranking dan whiteboard rules.

Design filter chain dengan eksplisit:

```text
request
  -> correlation filter
  -> security filter
  -> tenant context filter
  -> rate limit filter
  -> transaction boundary filter? maybe not
  -> servlet/resource
```

### Filter Failure Mode

Filter di OSGi sering gagal karena:

- property pattern salah,
- context select tidak match,
- regex vs pattern tertukar,
- service ranking tidak sesuai,
- filter bergantung service yang belum tersedia,
- filter memakai ThreadLocal tetapi tidak cleanup,
- filter menangkap exception lalu menelan error,
- filter registered tapi tidak match karena context berbeda.

Dokumentasi dan contoh modern sering membedakan `osgi.http.whiteboard.filter.pattern` untuk path pattern dan `osgi.http.whiteboard.filter.regex` untuk regex URL matching. citeturn923619search5

---

## 11. Listener Registration

Listener seperti:

- `ServletContextListener`,
- `ServletRequestListener`,
- `HttpSessionListener`,
- attribute listener,

juga bisa diregister melalui whiteboard.

Gunakan listener untuk:

- audit request lifecycle,
- per-context initialization ringan,
- session metrics,
- request diagnostics,
- resource cleanup.

Jangan gunakan listener untuk:

- bootstrap besar,
- blocking I/O panjang,
- dependency orchestration,
- database migration,
- start service global.

Di OSGi, lifecycle sudah punya DS dan bundle lifecycle. Jangan jadikan servlet listener sebagai pseudo-container initializer jika sebenarnya tanggung jawabnya adalah OSGi component.

---

## 12. Preprocessor

Beberapa HTTP Whiteboard implementation mendukung konsep preprocessor sesuai spesifikasi.

Preprocessor berada sebelum servlet/filter normal.

Gunakan untuk:

- request normalization,
- low-level security gate,
- global correlation,
- reverse proxy header normalization,
- request rejection sangat awal.

Hati-hati:

- preprocessor terlalu global bisa menjadi coupling tersembunyi,
- sulit dites jika semua request melewatinya,
- bisa mem-bypass context-specific design.

Rule praktis:

> Pakai preprocessor hanya untuk policy yang benar-benar global. Untuk policy domain, pakai filter context-specific.

---

## 13. Dynamic Endpoint Lifecycle

HTTP endpoint di OSGi bisa berubah saat runtime.

Contoh scenario:

```text
T0: HTTP runtime aktif
T1: /api/cases servlet aktif
T2: validation plugin bundle installed
T3: plugin exposes /api/validation-rules
T4: config disabled
T5: /api/validation-rules disappears
T6: bundle updated
T7: endpoint appears again
```

Ini powerful, tetapi harus didesain.

### 13.1 Client Perspective

Client eksternal tidak peduli OSGi dynamic lifecycle. Mereka hanya melihat:

- endpoint 200,
- 404,
- 503,
- timeout,
- inconsistent response,
- connection reset.

Karena itu, dynamic HTTP topology harus dipetakan ke SLA eksternal.

Jika endpoint bisa hilang karena bundle restart, tanyakan:

- Apakah client boleh menerima 404?
- Atau harus 503?
- Apakah endpoint harus tetap ada tetapi degrade?
- Apakah router/API gateway tahu readiness per endpoint?
- Apakah update dilakukan saat maintenance window?

### 13.2 Graceful Unregister

Saat service servlet di-unregister:

- request baru tidak boleh masuk ke servlet itu,
- request berjalan harus diberi kesempatan selesai jika server/runtime mendukung,
- resource harus di-cleanup,
- thread/asynchronous task tidak boleh tertinggal.

Pattern:

```java
@Component(service = Servlet.class, property = { ... })
public final class SafeServlet extends HttpServlet {

    private final AtomicBoolean accepting = new AtomicBoolean(true);

    @Deactivate
    void deactivate() {
        accepting.set(false);
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (!accepting.get()) {
            resp.sendError(503, "Endpoint is stopping");
            return;
        }
        // handle request
    }
}
```

Namun ini hanya basic. Production-grade graceful drain biasanya butuh:

- load balancer readiness,
- runtime health endpoint,
- request counter,
- max drain timeout,
- idempotent shutdown,
- no new long-running async jobs.

---

## 14. JAX-RS Whiteboard Mental Model

Servlet bagus untuk kontrol rendah. Tetapi untuk REST API, JAX-RS/Jakarta REST Whiteboard lebih idiomatis.

Konsepnya:

```text
JAX-RS Application service
JAX-RS Resource service
JAX-RS Extension service
JAX-RS Whiteboard runtime
```

Contoh resource:

```java
package com.example.caseapi.internal;

import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;

import org.osgi.service.component.annotations.Component;

@Component(service = Object.class)
@Path("/cases")
public final class CaseResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public String listCases() {
        return "[]";
    }
}
```

Pada whiteboard, resource tidak otomatis cukup hanya karena punya annotation. Ia harus menjadi service yang dikenali oleh JAX-RS Whiteboard, biasanya dengan properti tertentu tergantung API/spec/implementation.

Contoh conceptual:

```java
@Component(
    service = Object.class,
    property = {
        "osgi.jaxrs.resource=true",
        "osgi.jaxrs.application.select=(osgi.jaxrs.name=case-api)"
    }
)
@Path("/cases")
public final class CaseResource {
    // ...
}
```

Untuk dunia Jakarta:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
```

OSGi Compendium 8.1 mendefinisikan package `org.osgi.service.jakartars.whiteboard` untuk constants Jakarta RESTful Web Services Whiteboard. citeturn923619search21

---

## 15. JAX-RS Application Boundary

JAX-RS `Application` bisa menjadi boundary API.

Contoh conceptual:

```java
@Component(
    service = Application.class,
    property = {
        "osgi.jaxrs.application.base=/case-api",
        "osgi.jaxrs.name=case-api"
    }
)
public final class CaseApplication extends Application {
}
```

Resource memilih application:

```java
@Component(
    service = Object.class,
    property = {
        "osgi.jaxrs.resource=true",
        "osgi.jaxrs.application.select=(osgi.jaxrs.name=case-api)"
    }
)
@Path("/applications")
public final class ApplicationResource {
}
```

Endpoint final:

```text
/case-api/applications
```

### Design Application Boundary

Gunakan JAX-RS Application untuk:

- API version,
- bounded context,
- tenant boundary,
- public/internal/admin split,
- feature bundle grouping,
- security policy grouping,
- provider/extension selection.

Contoh:

```text
/case-api/v1
/case-api/v2
/admin-api
/internal-api
/public-api
```

---

## 16. JSON Provider dan Entity Mapping

REST tanpa JSON provider tidak berguna.

Di JAX-RS, JSON bisa datang dari:

- Jackson provider,
- JSON-B provider,
- MOXy,
- custom `MessageBodyReader`,
- custom `MessageBodyWriter`.

Di OSGi, provider harus resolve dan visible.

Problem umum:

```text
Resource bundle uses DTO class
Jackson provider bundle sees DTO?
JAX-RS runtime bundle sees provider?
Provider imports correct jakarta/javax package?
Multiple Jackson versions exist?
ObjectMapper customized where?
```

### 16.1 DTO Boundary

Jangan expose entity persistence langsung:

```java
// Avoid for API contract
public class CaseEntity { ... }
```

Gunakan DTO package yang jelas:

```text
com.example.case.api.dto
```

Export DTO package dari API bundle:

```text
Export-Package: com.example.case.api.dto;version="1.2.0"
```

Resource implementation import DTO:

```text
Import-Package: com.example.case.api.dto;version="[1.2,2)"
```

### 16.2 JSON Provider Versioning

Jackson di OSGi sering menimbulkan konflik karena banyak package:

```text
com.fasterxml.jackson.core
com.fasterxml.jackson.databind
com.fasterxml.jackson.annotation
com.fasterxml.jackson.datatype.jsr310
```

Pastikan:

- satu provider version policy,
- no duplicate embedded Jackson jika bisa,
- import range tidak terlalu bebas,
- `uses:=` chain konsisten,
- provider registered ke JAX-RS whiteboard yang benar.

---

## 17. Annotation Scanning Problem

Framework web modern sering mengandalkan scanning:

- servlet annotation,
- JAX-RS annotation,
- CDI annotation,
- Jackson annotation,
- validation annotation,
- OpenAPI annotation,
- Spring annotation.

Di classpath tunggal, scanner bisa scan semua classpath.

Di OSGi, tidak ada “semua classpath”. Ada banyak bundle classloader dengan visibility terbatas.

Masalah umum:

```text
scanner in runtime bundle cannot see resource classes in application bundle
application bundle cannot see provider class
TCCL is not set as expected
annotation class loaded from different bundle
```

Top 1% principle:

> Jangan bergantung pada global classpath scanning di OSGi. Prefer explicit service registration, manifest metadata, DS metadata, atau whiteboard service properties.

Jika scanning harus ada:

- batasi scope scanning,
- buat extender pattern,
- scan bundle resources yang eksplisit,
- gunakan OSGi wiring API bila perlu,
- pastikan annotation package identity konsisten,
- dokumentasikan TCCL behavior.

---

## 18. TCCL dan Web Framework

Banyak web framework mengandalkan Thread Context ClassLoader.

Contoh:

```java
Thread.currentThread().getContextClassLoader()
```

Dipakai oleh:

- JAXB,
- Jackson extension discovery,
- ServiceLoader,
- logging provider,
- validation provider,
- JPA provider,
- EL/JSP engine,
- template engine,
- scripting engine.

Di OSGi, TCCL mungkin menunjuk ke:

- HTTP runtime bundle classloader,
- framework classloader,
- worker thread pool classloader,
- bukan bundle aplikasi.

Akibat:

```text
works in unit test
fails in OSGi runtime
```

### 18.1 TCCL Bridge Pattern

Kadang perlu bridge:

```java
ClassLoader previous = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
    // call third-party library that expects TCCL
} finally {
    Thread.currentThread().setContextClassLoader(previous);
}
```

Tapi jangan jadikan default global.

Gunakan hanya di adapter boundary yang jelas:

```text
OSGi-safe code
  -> adapter sets TCCL
  -> third-party library
  -> restore TCCL
```

Anti-pattern:

```text
set TCCL globally in every request and hope it works
```

---

## 19. Servlet API: javax vs jakarta

Ini sangat penting untuk Java 8–25.

### 19.1 Java 8 Era

Umumnya:

```text
javax.servlet
javax.ws.rs
javax.annotation
javax.validation
javax.json
```

### 19.2 Jakarta Era

Modern Jakarta EE menggunakan:

```text
jakarta.servlet
jakarta.ws.rs
jakarta.annotation
jakarta.validation
jakarta.json
```

### 19.3 Binary Compatibility

`javax.servlet.http.HttpServlet` dan `jakarta.servlet.http.HttpServlet` adalah tipe berbeda.

Tidak bisa sekadar:

```text
import rename and hope binary compatible
```

Bagi OSGi resolver, ini package berbeda:

```text
Import-Package: javax.servlet;version="[3.1,5)"
```

vs

```text
Import-Package: jakarta.servlet;version="[5,7)"
```

Bundle yang memakai `javax.servlet` tidak bisa dipasang ke runtime yang hanya menyediakan `jakarta.servlet`, kecuali ada compatibility bridge khusus yang biasanya tidak trivial.

### 19.4 Migration Strategy

Pilihan:

1. Tetap di `javax` stack untuk legacy runtime.
2. Migrasi semua web bundle ke `jakarta` secara konsisten.
3. Jalankan dua runtime terpisah.
4. Buat adapter/proxy boundary HTTP di luar OSGi.
5. Gunakan API versioning dan migrate endpoint secara gradual.

Jangan campur sembarangan:

```text
Resource uses jakarta.ws.rs
Provider uses javax.ws.rs
Runtime supports javax only
```

Itu hampir pasti gagal resolve atau gagal runtime.

---

## 20. HTTP Runtime Implementations

HTTP Whiteboard adalah spesifikasi. Butuh implementation.

Contoh ecosystem:

- Apache Felix HTTP Service / HTTP Whiteboard,
- Pax Web,
- Equinox HTTP,
- Jetty-based implementation,
- Tomcat-based implementation,
- Karaf web stack,
- OSGi Jakarta Servlet Whiteboard implementation.

### 20.1 Apache Felix HTTP

Cocok untuk:

- runtime ringan,
- embedded OSGi,
- custom platform,
- Felix-based distribution,
- simple servlet/filter/resource use cases.

### 20.2 Pax Web

Sering muncul di Karaf ecosystem.

Cocok untuk:

- Karaf deployment,
- WAR-like needs,
- advanced web container features,
- JSP/JSF legacy integration,
- multi-container support.

### 20.3 Equinox HTTP

Cocok untuk:

- Eclipse/RCP/headless Equinox,
- product platform dengan Equinox heritage,
- p2-based provisioning.

### 20.4 Custom Embedded Server

Kadang platform membuat HTTP server sendiri lalu bridge ke OSGi service registry.

Ini boleh, tapi mahal:

- harus manage lifecycle,
- harus map classloader,
- harus handle service dynamics,
- harus expose diagnostics,
- harus test resolver/runtime edge cases.

Rule praktis:

> Gunakan implementation standar kecuali kamu benar-benar membangun platform runtime khusus dan punya alasan engineering kuat.

---

## 21. OSGi Web in Karaf

Karaf sering dipakai sebagai OSGi distribution untuk web integration.

Biasanya konsep operasionalnya:

```text
features install web stack
features install http whiteboard runtime
features install application bundles
Karaf shell used for diagnostics
Config Admin drives runtime config
```

Contoh operation:

```text
feature:install http
bundle:list
service:list Servlet
scr:list
log:tail
```

Karaf cocok ketika kamu butuh:

- shell operational,
- features provisioning,
- config file operation,
- web stack siap pakai,
- enterprise integration.

Tapi untuk container/Kubernetes modern, perlu discipline:

- jangan asal hot deploy manual di production,
- gunakan immutable image bila memungkinkan,
- feature set dikunci,
- config externalized,
- shell diamankan,
- readiness/health jelas.

---

## 22. OSGi Web vs Spring Boot

Perbandingan mental model:

| Area | Spring Boot | OSGi HTTP Whiteboard |
|---|---|---|
| Startup | one application context | many bundles/components |
| Dependency | build-time classpath | package wiring + service dynamics |
| Endpoint | controller bean | servlet/resource service contribution |
| Hot plugin | not native | native pattern |
| Annotation scanning | central | must be constrained/adapted |
| Dynamic removal | uncommon | core model |
| Operational unit | app process | runtime + bundles |
| Fit | service app | platform/plugin/runtime composition |

Spring Boot unggul untuk:

- simple microservice,
- fast web app development,
- uniform dependency graph,
- cloud-native service pattern.

OSGi unggul untuk:

- plugin platform,
- runtime extensibility,
- modular product line,
- dynamic endpoint contribution,
- long-lived platform with controlled module evolution.

Jangan pilih OSGi hanya untuk membuat REST CRUD service biasa.

---

## 23. OSGi Web vs WAR Deployment

WAR deployment biasanya lebih familiar.

OSGi lebih cocok jika:

- endpoint berasal dari plugin berbeda,
- modules bisa dipasang/diupdate independently,
- API extension contracts penting,
- runtime harus support product variants,
- classloader isolation diperlukan,
- service dynamics memang dibutuhkan.

WAR lebih cocok jika:

- aplikasi utuh satu deployable,
- dependency graph seragam,
- tidak butuh runtime plugin,
- team lebih familier servlet/Jakarta EE,
- operational simplicity lebih penting.

---

## 24. Security di OSGi Web Layer

Security layer web di OSGi harus dipikirkan eksplisit.

Area:

- authentication,
- authorization,
- CSRF,
- CORS,
- session handling,
- token validation,
- TLS termination,
- reverse proxy headers,
- tenant isolation,
- admin endpoint protection,
- management shell exposure,
- bundle/plugin trust.

### 24.1 Security Filter sebagai Service

Contoh conceptual:

```java
@Component(
    service = Filter.class,
    property = {
        HttpWhiteboardConstants.HTTP_WHITEBOARD_FILTER_PATTERN + "=/api/*",
        HttpWhiteboardConstants.HTTP_WHITEBOARD_FILTER_NAME + "authFilter",
        "service.ranking:Integer=1000"
    }
)
public final class AuthFilter implements Filter {

    @Reference
    private TokenVerifier tokenVerifier;

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        // verify token, set security context, continue
    }
}
```

Dynamic risk:

```text
What happens if TokenVerifier disappears?
```

Jika reference mandatory static, filter component akan deactivate dan endpoint mungkin menjadi tanpa filter atau filter menghilang tergantung mapping.

Ini bahaya.

Design yang lebih aman:

- security filter harus mandatory untuk protected context,
- protected servlet context tidak boleh serve tanpa security gate,
- fail closed, bukan fail open,
- readiness harus false jika auth service missing,
- context design harus memisahkan public/admin/internal.

### 24.2 Fail Closed Pattern

```java
@Component(service = Filter.class, property = { ... })
public final class AuthFilter implements Filter {

    private volatile TokenVerifier verifier;

    @Reference(cardinality = ReferenceCardinality.OPTIONAL, policy = ReferencePolicy.DYNAMIC)
    void bind(TokenVerifier verifier) {
        this.verifier = verifier;
    }

    void unbind(TokenVerifier verifier) {
        if (this.verifier == verifier) {
            this.verifier = null;
        }
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        TokenVerifier current = verifier;
        if (current == null) {
            ((HttpServletResponse) res).sendError(503, "Security service unavailable");
            return;
        }
        // verify
        chain.doFilter(req, res);
    }
}
```

Namun optional security dependency harus dipakai hati-hati. Untuk banyak kasus, mandatory static lebih sederhana, tetapi pastikan servlet tidak reachable tanpa filter.

---

## 25. Session Handling

Session di OSGi web runtime punya tantangan:

- servlet context boundary,
- multiple HTTP runtimes,
- load balancer sticky session,
- cluster replication,
- bundle update while session object exists,
- session attributes holding bundle classes,
- classloader leak.

Rule penting:

> Jangan simpan object implementation bundle ke HTTP session jika bundle bisa di-update/uninstall.

Buruk:

```java
session.setAttribute("caseDraft", new InternalCaseDraftState(...));
```

Lebih aman:

```java
session.setAttribute("caseDraftId", draftId);
```

Simpan state di:

- database,
- distributed cache,
- external session store,
- stable DTO package yang versioned,
- atau stateless token jika cocok.

Session object bisa menahan classloader lama dan menyebabkan memory leak setelah bundle refresh.

---

## 26. Async Servlet dan Long-Running Request

Servlet 3+ mendukung async.

Di OSGi, async request harus memperhatikan lifecycle.

Problem:

```text
request starts async
bundle stops
service unregistered
async task still running
classloader retained
response writes after endpoint stopped
```

Pattern aman:

- track active async tasks,
- cancel/timeout saat deactivate,
- jangan gunakan unmanaged executor,
- executor sebagai OSGi service atau component-owned lifecycle,
- no static executor,
- restore TCCL if needed,
- handle service dependency disappearance.

Contoh lifecycle-aware executor:

```java
@Component(service = Servlet.class, property = { ... })
public final class AsyncReportServlet extends HttpServlet {

    private ExecutorService executor;
    private final AtomicBoolean active = new AtomicBoolean(false);

    @Activate
    void activate() {
        executor = Executors.newFixedThreadPool(4);
        active.set(true);
    }

    @Deactivate
    void deactivate() {
        active.set(false);
        executor.shutdownNow();
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        if (!active.get()) {
            resp.setStatus(503);
            return;
        }
        AsyncContext async = req.startAsync();
        executor.submit(() -> {
            try {
                if (!active.get()) {
                    async.getResponse().setContentType("text/plain");
                    async.getResponse().getWriter().write("stopping");
                    return;
                }
                // work
            } catch (Exception e) {
                // log and handle
            } finally {
                async.complete();
            }
        });
    }
}
```

Untuk production, gunakan executor service yang diobservasi dan punya metrics.

---

## 27. Error Handling

Error handling di OSGi web layer harus memisahkan:

- HTTP error,
- business error,
- dependency unavailable,
- service not mounted,
- config invalid,
- security denied,
- JSON serialization error,
- classloading error.

Map secara eksplisit:

| Condition | HTTP Status | Catatan |
|---|---:|---|
| invalid request | 400 | client error |
| unauthenticated | 401 | auth challenge/token invalid |
| unauthorized | 403 | authenticated but not allowed |
| not found | 404 | route/resource absent |
| method unsupported | 405 | method mismatch |
| conflict | 409 | state conflict |
| validation error | 422 | if API convention allows |
| dependency unavailable | 503 | service temporarily unavailable |
| endpoint draining | 503 | retry possible |
| internal bug | 500 | server fault |

OSGi-specific:

```text
Missing OSGi dependency should rarely become 500 if it is operational dependency.
Often 503 is more honest.
```

---

## 28. Versioning HTTP APIs in OSGi

OSGi package versioning dan HTTP API versioning adalah dua hal berbeda.

Package version:

```text
com.example.case.api.dto;version="2.1.0"
```

HTTP API version:

```text
/api/v1/cases
/api/v2/cases
```

Keduanya harus diselaraskan, tapi jangan disamakan mentah.

Contoh:

```text
HTTP /api/v1 uses DTO package 1.x
HTTP /api/v2 uses DTO package 2.x
```

OSGi memungkinkan menjalankan dua versi API secara bersamaan:

```text
case-api-v1-bundle exports com.example.case.v1.dto;version=1.5.0
case-api-v2-bundle exports com.example.case.v2.dto;version=2.0.0

case-rest-v1 registers /api/v1/cases
case-rest-v2 registers /api/v2/cases
```

Ini sangat berguna untuk regulated/enterprise systems yang butuh backward compatibility panjang.

---

## 29. Multi-Context Architecture Example

Misal regulatory case management platform.

Kita ingin:

- public API untuk external agency,
- internal API untuk internal UI,
- admin API untuk operator,
- plugin endpoint untuk rule diagnostics,
- static admin console.

Desain context:

```text
/agency-api/v1      -> external agency API
/internal-api       -> internal SPA/backend API
/admin              -> admin management API
/plugin             -> plugin diagnostics API
/assets             -> static resources
```

Bundle layout:

```text
com.acme.platform.web.context
  -> registers ServletContextHelper services

com.acme.case.api
  -> exports DTO/service contracts

com.acme.case.rest.internal
  -> registers case resources/servlets

com.acme.security.web
  -> registers auth filters

com.acme.observability.web
  -> registers correlation and metrics filters

com.acme.plugin.rule.web
  -> plugin contributes diagnostics endpoint
```

Topology:

```text
HTTP Runtime
  /agency-api/v1
    correlation filter
    auth filter
    rate limit filter
    agency case resource

  /internal-api
    correlation filter
    session/token filter
    internal case resource

  /admin
    correlation filter
    admin auth filter
    admin servlet

  /plugin
    correlation filter
    admin auth filter
    plugin diagnostic resources
```

Design invariant:

```text
No protected endpoint can be mounted without security filter.
No plugin endpoint can expose internal objects directly.
No bundle stores implementation objects in HTTP session.
No endpoint depends on optional service without defined degradation.
```

---

## 30. OSGi Web with Reverse Proxy / Gateway

In production, OSGi HTTP runtime sering berada di belakang:

- Nginx,
- Apache HTTPD,
- HAProxy,
- ALB,
- API Gateway,
- service mesh ingress.

Perhatikan:

- `X-Forwarded-For`,
- `X-Forwarded-Proto`,
- `Forwarded`,
- host header,
- base path rewriting,
- TLS termination,
- cookie secure flag,
- same-site cookie,
- absolute URL generation,
- health probes,
- timeout,
- request body size.

OSGi-specific issue:

```text
Context path and reverse proxy rewrite must match servlet/JAX-RS base path.
```

Contoh:

```text
External: https://example.gov/app/api/v1/cases
Proxy strips /app
Internal OSGi: /api/v1/cases
```

Pastikan application tahu external base URL jika generate links.

---

## 31. Observability untuk OSGi Web

Observability tidak cukup hanya HTTP metrics umum.

Tambahkan dimensi OSGi:

- bundle symbolic name,
- bundle version,
- service id,
- component name,
- servlet/filter name,
- context name,
- endpoint pattern,
- application name,
- provider version,
- HTTP runtime implementation.

Metrics penting:

```text
http_requests_total
http_request_duration_seconds
http_inflight_requests
http_5xx_total
http_4xx_total
osgi_http_servlets_registered
osgi_http_filters_registered
osgi_http_contexts_registered
osgi_jaxrs_resources_registered
osgi_jaxrs_applications_registered
osgi_web_component_unsatisfied
```

Logs harus punya:

- correlation id,
- request id,
- user/subject id jika aman,
- tenant/agency id,
- endpoint name,
- bundle symbolic name,
- component name,
- error category.

Tracing:

```text
reverse proxy -> OSGi HTTP runtime -> filter -> resource -> OSGi service -> DB/messaging
```

Jika resource memanggil dynamic OSGi service, span harus menunjukkan service/provider yang dipakai.

---

## 32. Health and Readiness

Di OSGi web runtime, health perlu lebih granular.

### 32.1 Liveness

Menjawab:

```text
Apakah JVM/process/framework masih hidup?
```

### 32.2 Readiness

Menjawab:

```text
Apakah endpoint penting siap menerima traffic?
```

Readiness harus memeriksa:

- HTTP runtime aktif,
- required servlet contexts aktif,
- security filter aktif,
- critical resources aktif,
- required downstream service aktif,
- config valid,
- DB/messaging connector siap bila endpoint membutuhkan,
- no ongoing incompatible update.

Jangan cukup:

```text
bundle:list shows ACTIVE
```

Itu terlalu dangkal.

### 32.3 Endpoint-Level Readiness

Untuk platform kompleks:

```text
/health/live
/health/ready
/health/endpoints
/health/osgi
```

Endpoint readiness bisa menampilkan:

```json
{
  "contexts": {
    "case-api": "UP",
    "admin": "UP"
  },
  "resources": {
    "caseResource": "UP",
    "appealResource": "DOWN: missing AppealService"
  }
}
```

Jangan expose detail ini ke publik tanpa auth.

---

## 33. Deployment and Update Strategy

Dynamic endpoint update bisa dilakukan, tapi tidak selalu boleh dilakukan sembarangan.

### 33.1 Hot Update

```text
bundle:update case-rest.jar
framework refreshes affected wiring
servlet service unregisters/registers
endpoint briefly unavailable
```

Risiko:

- request in-flight gagal,
- session object classloader leak,
- filter chain berubah,
- JSON provider berubah,
- service dependency mismatch,
- old client menerima response berbeda.

### 33.2 Immutable Runtime

Di container/Kubernetes modern:

```text
build image with bundles
start new pod
readiness true
route traffic
terminate old pod gracefully
```

Ini lebih mudah dioperasikan daripada hot update manual.

Namun OSGi hot deploy tetap berguna untuk:

- plugin installation,
- optional extension,
- admin tool,
- edge device,
- on-prem modular product,
- controlled maintenance window.

### 33.3 Rollback

Rollback harus mencakup:

- bundle binary,
- package/API version,
- config,
- database schema,
- endpoint route,
- client compatibility,
- cache/session state.

Jangan rollback hanya JAR jika config/API sudah berubah.

---

## 34. Testing OSGi Web

Testing harus berlapis.

### 34.1 Unit Test

Test servlet/resource logic tanpa OSGi jika memungkinkan.

### 34.2 Component Test

Test DS component:

- activation,
- reference binding,
- config binding,
- fail closed behavior.

### 34.3 In-Framework Test

Jalankan OSGi framework dengan HTTP runtime:

- install bundle,
- verify endpoint appears,
- call HTTP endpoint,
- unregister dependency,
- verify endpoint degrades,
- update config,
- verify mapping changes.

### 34.4 Resolver Test

Pastikan:

- servlet API resolved,
- JSON provider resolved,
- no duplicate `javax`/`jakarta` conflict,
- package version range benar,
- HTTP runtime capability tersedia.

### 34.5 Contract Test

Untuk API eksternal:

- OpenAPI contract,
- backward compatibility,
- error response format,
- auth behavior,
- content type,
- version behavior.

### 34.6 Dynamic Lifecycle Test

Test yang sering dilupakan:

```text
request endpoint while bundle stops
update filter bundle while traffic exists
remove auth service
change context config
remove JSON provider
install plugin endpoint
uninstall plugin endpoint
```

---

## 35. Common Failure Modes

### 35.1 Bundle ACTIVE tapi Endpoint 404

Kemungkinan:

- servlet service tidak registered,
- HTTP runtime tidak aktif,
- pattern salah,
- context select tidak match,
- context path berbeda,
- servlet init gagal,
- JAX-RS application tidak match,
- wrong API namespace `javax` vs `jakarta`,
- reverse proxy path rewrite salah.

### 35.2 `ClassNotFoundException` untuk Servlet/JAX-RS Class

Kemungkinan:

- missing `Import-Package`,
- runtime menyediakan `jakarta` tapi bundle import `javax`,
- embedded dependency tidak masuk Bundle-ClassPath,
- optional import tidak resolved,
- scanner memakai classloader yang salah.

### 35.3 JSON Serialization Gagal

Kemungkinan:

- provider tidak registered,
- Jackson version conflict,
- DTO package tidak visible,
- Java time module missing,
- annotation package mismatch,
- TCCL problem,
- resource returns internal class from non-exported package.

### 35.4 Filter Tidak Jalan

Kemungkinan:

- pattern/regex salah,
- context select salah,
- ranking/order tidak sesuai,
- service not active,
- filter hanya match servlet tertentu,
- request masuk context lain,
- reverse proxy path sudah rewrite.

### 35.5 Security Fail Open

Kemungkinan:

- security filter unregistered saat auth service hilang,
- protected servlet tetap mounted,
- admin context tidak punya filter,
- default context menangkap route,
- optional auth reference tidak fail closed.

### 35.6 Memory Leak Setelah Bundle Update

Kemungkinan:

- session attribute memegang class bundle lama,
- ThreadLocal tidak cleanup,
- async task masih jalan,
- static singleton,
- logging MDC tidak clear,
- HTTP runtime masih hold servlet/filter instance,
- third-party library global registry.

### 35.7 Works in Felix, Fails in Karaf/Equinox

Kemungkinan:

- implementation-specific behavior,
- different HTTP runtime,
- different servlet API version,
- feature provisioning missing,
- config naming berbeda,
- start level/order berbeda,
- classloading workaround non-portable.

---

## 36. Troubleshooting Playbook

Saat endpoint bermasalah, jangan langsung edit kode. Ikuti urutan.

### Step 1 — Pastikan HTTP Runtime Aktif

Cek bundle/service HTTP runtime.

```text
bundle:list | grep -i http
service:list | grep -i Http
```

### Step 2 — Cek Servlet/Filter/Resource Service

```text
service:list Servlet
service:list Filter
```

Cek properties:

```text
osgi.http.whiteboard.servlet.pattern
osgi.http.whiteboard.context.select
service.ranking
```

### Step 3 — Cek DS Component

```text
scr:list
scr:info <component>
```

Cari:

- unsatisfied reference,
- missing config,
- activation error.

### Step 4 — Cek Context

Pastikan `ServletContextHelper` ada.

```text
osgi.http.whiteboard.context.name
osgi.http.whiteboard.context.path
```

### Step 5 — Cek Resolver/Wiring

Cek imports:

```text
javax.servlet
jakarta.servlet
javax.ws.rs
jakarta.ws.rs
com.fasterxml.jackson.*
```

Pastikan tidak ada mixed namespace.

### Step 6 — Cek Logs

Cari:

- servlet init failed,
- duplicate mapping,
- no application selected,
- provider not found,
- class not found,
- uses constraint violation.

### Step 7 — Cek Reverse Proxy

Bandingkan:

```text
external path
internal path
context path
servlet pattern
JAX-RS base path
```

### Step 8 — Reproduce in Minimal Runtime

Buat `.bndrun` minimal:

```text
HTTP runtime
DS runtime
your web bundle
required API bundles
JSON provider
```

Jika gagal di minimal runtime, masalah ada di bundle/wiring. Jika berhasil, masalah ada di distribution/provisioning/config.

---

## 37. Design Patterns untuk OSGi Web

### 37.1 Context-per-Boundary Pattern

Pisahkan public/internal/admin context.

```text
/public
/internal
/admin
```

Benefit:

- security lebih jelas,
- filter mapping lebih aman,
- observability lebih mudah,
- deployment endpoint lebih terstruktur.

### 37.2 Resource-as-Service Pattern

REST resource mendelegasikan business logic ke OSGi service.

```text
HTTP Resource
  -> ApplicationService interface
  -> domain implementation service
```

Jangan letakkan domain logic berat di resource.

### 37.3 Fail-Closed Security Context Pattern

Protected context tidak boleh serve bila security gate missing.

### 37.4 API Version Bundle Pattern

```text
case-api-v1-contract
case-api-v1-rest
case-api-v2-contract
case-api-v2-rest
```

Bisa menjalankan v1 dan v2 bersamaan.

### 37.5 Plugin Endpoint Pattern

Plugin bundle mendaftarkan endpoint diagnostics sendiri, tetapi hanya di admin/plugin context.

```text
plugin registers DiagnosticResource
context.select=(plugin-admin)
```

### 37.6 Adapter Boundary Pattern

Third-party web framework dibungkus di adapter bundle.

```text
OSGi service world
  -> adapter sets classloader/context
  -> third-party framework
```

### 37.7 Immutable Snapshot Config Pattern

Resource/filter membaca config snapshot immutable.

```java
private volatile ApiConfig config;
```

Jangan baca Config Admin dictionary mentah di setiap request tanpa validation.

---

## 38. Anti-Patterns

### 38.1 Treating OSGi as WAR Container

Mencoba memasukkan semua ke satu WAR lalu berharap OSGi memberi modularity.

### 38.2 Global Annotation Scanning

Scanner mencari semua class di semua bundle.

Masalah:

- lambat,
- tidak deterministik,
- classloader error,
- boundary bocor.

### 38.3 Export Everything for Web Runtime

Mengekspor semua package agar framework bisa melihatnya.

Ini merusak modularity.

### 38.4 Optional Security Service

Auth filter optional, lalu ketika auth service hilang, endpoint tetap reachable.

### 38.5 Session Holds Bundle Implementation Class

Menyimpan object internal ke session dan membuat classloader leak.

### 38.6 DynamicImport-Package untuk Web Framework

Menggunakan `DynamicImport-Package: *` agar scanner bisa jalan.

Ini memperbaiki gejala, merusak arsitektur.

### 38.7 Mixing javax and jakarta Randomly

Sebagian bundle `javax`, sebagian `jakarta`, runtime tidak konsisten.

### 38.8 Servlet Does Business Transaction Directly

Servlet/resource langsung melakukan persistence, messaging, workflow orchestration.

Lebih baik:

```text
Resource -> application service -> domain/infrastructure services
```

### 38.9 No Endpoint Readiness

Process dianggap ready hanya karena port terbuka.

### 38.10 Hot Update Without Drain

Update servlet/filter bundle saat traffic tanpa drain/readiness/rollback strategy.

---

## 39. Java 8 sampai 25 Considerations

### Java 8

- Banyak OSGi stack legacy berbasis `javax`.
- Servlet 3.x/JAX-RS 2.x umum.
- Security Manager masih lebih relevan secara historis.
- JPMS belum ada.

### Java 9–11

- JPMS muncul.
- Strong encapsulation mulai berdampak.
- Java EE modules mulai dihapus dari JDK.
- Banyak library harus eksplisit dependency.
- Servlet/JAX-RS masih banyak `javax`, tetapi transisi mulai terasa.

### Java 17

- LTS modern baseline umum.
- Illegal reflective access lebih ketat.
- Old bytecode/framework scanner bisa gagal.
- Security Manager deprecated for removal.

### Java 21

- LTS modern dengan virtual threads.
- Web runtime bisa memanfaatkan virtual threads jika implementation mendukung, tetapi OSGi lifecycle/thread ownership harus tetap jelas.
- Jangan membuat unmanaged virtual threads tanpa lifecycle.

### Java 25

- Perlu memastikan HTTP runtime, servlet API, bytecode tools, annotation scanner, proxy/bytecode generator, dan JSON provider sudah kompatibel.
- Jakarta-based stack lebih realistis untuk modern runtime.
- Legacy `javax` masih bisa berjalan jika dependencies tersedia, tetapi tidak boleh diasumsikan dari JDK.

Checklist Java 8–25:

```text
[ ] Servlet API namespace chosen: javax or jakarta
[ ] JAX-RS/Jakarta REST namespace chosen consistently
[ ] HTTP runtime supports target Java
[ ] Bytecode level compatible
[ ] bnd generates correct imports
[ ] No dependency on removed JDK Java EE modules
[ ] Reflection access tested on Java 17/21/25
[ ] JSON provider compatible
[ ] Validation provider compatible
[ ] No unmanaged thread/classloader leak
```

---

## 40. Case Study: Modular Enforcement Case API

Bayangkan platform enforcement lifecycle.

Requirement:

- internal users access case API,
- external agency access limited case status API,
- admin can inspect plugin diagnostics,
- rules can be contributed by separate bundles,
- API v1 must remain stable,
- API v2 added new escalation fields,
- auth must fail closed,
- production behind reverse proxy.

### 40.1 Bundle Design

```text
com.acme.enforcement.web.context
com.acme.enforcement.security.web
com.acme.enforcement.case.api.v1
com.acme.enforcement.case.api.v2
com.acme.enforcement.case.service
com.acme.enforcement.case.rest.v1
com.acme.enforcement.case.rest.v2
com.acme.enforcement.rule.spi
com.acme.enforcement.rule.plugin.latecase
com.acme.enforcement.rule.plugin.riskprofile
com.acme.enforcement.rule.web.diagnostics
com.acme.enforcement.observability.web
```

### 40.2 Contexts

```text
/internal-api
/agency-api/v1
/agency-api/v2
/admin/plugin
```

### 40.3 Security

```text
/internal-api      -> staff token filter
/agency-api/v1     -> agency token filter + rate limit
/agency-api/v2     -> agency token filter + rate limit
/admin/plugin      -> admin role filter
```

### 40.4 API Versioning

```text
v1 DTO package: com.acme.enforcement.case.api.v1.dto;version=1.4.0
v2 DTO package: com.acme.enforcement.case.api.v2.dto;version=2.0.0
```

### 40.5 Dynamic Plugin Diagnostic Endpoint

Rule plugin can expose diagnostics:

```text
/admin/plugin/rules/latecase
/admin/plugin/rules/riskprofile
```

But only if:

- admin context exists,
- admin auth filter active,
- plugin health UP,
- diagnostics enabled in config.

### 40.6 Failure Mode

If risk profile plugin disappears:

- case API still works,
- rule evaluation service degrades based on policy,
- diagnostic endpoint disappears or returns 503,
- readiness reports degraded but not full DOWN if business allows.

This is the real value of OSGi web design: endpoint topology can reflect runtime capability without collapsing the whole application.

---

## 41. Design Review Checklist

Gunakan checklist ini sebelum menyetujui OSGi web design.

### HTTP Runtime

```text
[ ] Implementation selected: Felix/Pax Web/Equinox/custom
[ ] Servlet API namespace consistent
[ ] Java version compatibility verified
[ ] HTTP runtime provisioned as feature/bundle set
[ ] Runtime diagnostics available
```

### Context

```text
[ ] Context names explicit
[ ] Context paths explicit
[ ] Public/internal/admin separated
[ ] Reverse proxy path mapping documented
[ ] Context helper lifecycle understood
```

### Servlet/Resource

```text
[ ] Registered through DS/Whiteboard
[ ] Pattern explicit
[ ] Context select explicit for non-default contexts
[ ] No domain logic directly inside servlet/resource
[ ] Handles dependency unavailable as 503 where appropriate
```

### Filter/Security

```text
[ ] Security filters fail closed
[ ] Filter order/ranking documented
[ ] Protected context cannot be served without auth gate
[ ] ThreadLocal/MDC cleanup guaranteed
[ ] CORS/CSRF/session policy explicit
```

### JAX-RS/Jakarta REST

```text
[ ] Application boundary explicit
[ ] Resource services registered correctly
[ ] JSON provider registered and resolved
[ ] DTO packages versioned
[ ] javax/jakarta not mixed accidentally
```

### Classloading

```text
[ ] No global classpath scanning assumption
[ ] TCCL bridge only at adapter boundary
[ ] No DynamicImport-Package wildcard
[ ] No session attribute holding internal classes
[ ] No duplicate servlet/JAX-RS API packages
```

### Operations

```text
[ ] Health/readiness checks endpoint-level
[ ] Metrics include OSGi dimensions
[ ] Logs include correlation id and component/bundle info
[ ] Update/drain strategy defined
[ ] Rollback includes config/API/schema
```

---

## 42. Summary Mental Model

OSGi web layer is best understood as:

```text
HTTP runtime observes OSGi services
OSGi services contribute web capabilities
Servlet context defines boundary
Service properties define routing
Bundle wiring defines class visibility
DS defines lifecycle
Config Admin defines runtime configuration
Resolver defines deployability
Operations define safety
```

The central shift:

> In OSGi, web endpoints are not merely code paths. They are runtime service contributions with lifecycle, dependency, configuration, and classloading semantics.

If you design OSGi web layer like a normal servlet app, you will fight the framework.

If you design it as dynamic runtime composition, it becomes powerful for:

- plugin endpoints,
- product-line APIs,
- admin/diagnostic surfaces,
- versioned APIs,
- modular monolith web boundaries,
- regulated systems with long-lived compatibility requirements.

---

## 43. What Comes Next

Part berikutnya:

```text
16-persistence-osgi-jdbc-jpa-transactions-hibernate-eclipselink.md
```

Kita akan membahas persistence di OSGi:

- JDBC driver loading,
- DataSource as service,
- connection pool lifecycle,
- JPA persistence unit discovery,
- Hibernate/EclipseLink classloading,
- transaction control,
- entity boundary,
- migration/schema tooling,
- dan failure mode persistence di runtime modular.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — Apache Karaf: OSGi Distribution, Features, Provisioning, and Operations](./14-apache-karaf-osgi-distribution-features-provisioning-operations.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 16 — Persistence in OSGi: JDBC, JPA, Transactions, Hibernate, EclipseLink](./16-persistence-osgi-jdbc-jpa-transactions-hibernate-eclipselink.md)
