# learn-java-eclipse-jersey-deployment-models-part-004

# Part 4 — WAR Deployment Model di Servlet Container

> Seri: `learn-java-eclipse-jersey-deployment-models`  
> Bagian: `004 / 032`  
> Topik: WAR deployment model di Servlet container  
> Target Java: Java 8 sampai Java 25  
> Target Jersey: Jersey 2.x, 3.x, 4.x  
> Fokus utama: memahami WAR sebagai deployment contract, bukan sekadar format file.

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita membangun mental model bahwa Jersey tidak berdiri sendiri sebagai web server. Jersey adalah runtime Jakarta REST/JAX-RS yang harus ditempelkan ke sebuah hosting model. Salah satu hosting model paling penting, paling tua, dan masih sangat relevan di enterprise adalah **WAR deployment di Servlet container**.

Di part ini kita akan membahas WAR dengan cara yang lebih dalam daripada sekadar:

```text
mvn package
copy target/app.war ke Tomcat/webapps
```

Cara berpikir seperti itu terlalu operasional dan tidak cukup untuk menjadi engineer yang benar-benar kuat. WAR harus dipahami sebagai kontrak antara beberapa pihak:

1. build system,
2. dependency graph,
3. Servlet container,
4. Jersey servlet/filter bridge,
5. application classloader,
6. deployment descriptor,
7. runtime lifecycle,
8. operational environment,
9. security boundary,
10. observability dan troubleshooting model.

Tujuan part ini adalah agar kita bisa menjawab pertanyaan-pertanyaan seperti:

- Apa sebenarnya isi WAR?
- Siapa yang memiliki Servlet API: aplikasi atau container?
- Kenapa dependency tertentu harus `provided`, sementara dependency lain harus ikut di `WEB-INF/lib`?
- Bagaimana Jersey masuk ke Servlet lifecycle?
- Apa bedanya `@ApplicationPath`, `web.xml`, dan `ResourceConfig`?
- Kenapa aplikasi bisa berjalan di embedded Jetty tetapi gagal di Tomcat external?
- Kenapa `javax.*` dan `jakarta.*` mismatch sering menghasilkan error aneh?
- Kenapa class yang sama bisa berbeda perilaku antar WAR?
- Apa failure mode paling umum saat deploy Jersey WAR?
- Bagaimana membuat WAR deployment yang deterministic, observable, dan production-ready?

---

## 1. Mental Model Dasar: WAR adalah Kontrak Deployment

WAR adalah singkatan dari **Web Application Archive**. Secara fisik, WAR adalah archive berbasis ZIP. Tetapi secara engineering, WAR bukan sekadar zip. WAR adalah format standar untuk mengemas aplikasi web Java agar bisa dijalankan oleh Servlet container.

Mental model sederhananya:

```text
WAR file
  = application artifact
  + classes
  + resources
  + libraries
  + web deployment metadata
  + optional static files
  + optional container integration descriptors
```

Servlet container membaca WAR, membuat web application context, membuat classloader khusus untuk aplikasi itu, membaca descriptor/annotation, membuat instance servlet/filter/listener, lalu mengarahkan request HTTP ke komponen yang sesuai.

Untuk Jersey, WAR biasanya berarti:

```text
HTTP request
  -> Servlet container
  -> Servlet mapping / filter mapping
  -> Jersey ServletContainer or Jersey filter
  -> Jersey runtime
  -> Resource method
  -> MessageBodyReader / MessageBodyWriter
  -> Servlet response
```

Yang perlu dipahami: **WAR tidak menjalankan Jersey secara langsung**. WAR diberikan ke Servlet container. Servlet container-lah yang menjalankan lifecycle web application. Jersey baru aktif setelah container memanggil servlet/filter Jersey.

---

## 2. WAR dalam Deployment Model Jersey

Dalam konteks Jersey, WAR deployment biasanya dipakai untuk beberapa skenario:

1. aplikasi legacy Java EE/Jakarta EE,
2. aplikasi REST API yang dideploy ke Tomcat/Jetty,
3. aplikasi enterprise yang membutuhkan container-managed resources,
4. aplikasi yang perlu dipisahkan per web application context,
5. organisasi yang sudah punya operasi berbasis application server,
6. regulated environment yang lebih nyaman dengan artifact WAR dibanding self-contained service.

Jersey sendiri mendukung banyak hosting model. Dokumentasi Jersey menjelaskan bahwa aplikasi Jersey dapat berjalan pada lightweight HTTP containers sampai full Java/Jakarta EE servers. Cara publikasinya bergantung apakah aplikasi berjalan di Java SE environment atau container environment. Dalam model WAR, kita berada di **container environment**.

Konsekuensinya:

- port HTTP biasanya milik container,
- thread pool HTTP milik container,
- servlet lifecycle milik container,
- classloader hierarchy milik container,
- request parsing milik container,
- response commit milik container,
- deployment/redeployment milik container,
- sebagian API bisa disediakan container,
- aplikasi hanya menyediakan business code dan library yang memang menjadi miliknya.

Ini berbeda dari embedded model, di mana aplikasi membuat server sendiri dari `main()`.

---

## 3. Struktur WAR

Struktur umum WAR:

```text
my-api.war
├── index.html
├── assets/
├── META-INF/
│   └── MANIFEST.MF
└── WEB-INF/
    ├── web.xml
    ├── classes/
    │   └── com/example/...
    ├── lib/
    │   ├── jersey-server-*.jar
    │   ├── jersey-container-servlet-core-*.jar
    │   ├── jersey-hk2-*.jar
    │   └── ...
    └── views/ or config/ or other private resources
```

Bagian penting:

## 3.1 Root WAR

Root WAR dapat berisi static files seperti:

```text
index.html
favicon.ico
assets/app.js
assets/app.css
```

Untuk REST-only service, root WAR sering kosong atau hanya berisi health/static info minimal. Namun untuk aplikasi yang menggabungkan UI dan API, root WAR bisa berisi frontend static assets.

## 3.2 `WEB-INF/`

`WEB-INF` adalah area private web application. File di dalam `WEB-INF` tidak boleh diakses langsung oleh client lewat URL biasa. Container membacanya sebagai metadata/runtime resources.

## 3.3 `WEB-INF/classes/`

Berisi compiled classes aplikasi:

```text
WEB-INF/classes/com/example/api/UserResource.class
WEB-INF/classes/com/example/config/JerseyApplication.class
WEB-INF/classes/application.properties
```

Classpath aplikasi akan memuat `WEB-INF/classes`.

## 3.4 `WEB-INF/lib/`

Berisi library JAR yang dimiliki aplikasi:

```text
WEB-INF/lib/jersey-server-3.1.x.jar
WEB-INF/lib/jersey-container-servlet-core-3.1.x.jar
WEB-INF/lib/jersey-hk2-3.1.x.jar
WEB-INF/lib/jackson-databind-*.jar
```

Library di sini hanya terlihat oleh web application classloader milik WAR tersebut, bukan semua aplikasi di container, kecuali container punya mekanisme sharing tambahan.

## 3.5 `WEB-INF/web.xml`

`web.xml` adalah deployment descriptor klasik. Dalam aplikasi modern, bisa tidak ada jika menggunakan annotation scanning atau programmatic registration. Tetapi untuk production enterprise, `web.xml` sering tetap berguna karena eksplisit, predictable, dan mudah diaudit.

---

## 4. Servlet Container: Pemilik Hosting Runtime

Servlet container adalah runtime yang mengimplementasikan Servlet API. Contoh:

- Apache Tomcat,
- Eclipse Jetty,
- GlassFish,
- Payara,
- Open Liberty,
- WildFly/Undertow,
- WebLogic,
- WebSphere tradisional atau Liberty variants.

Dalam WAR deployment, container bertanggung jawab atas:

1. membuka port HTTP/HTTPS,
2. menerima koneksi,
3. parsing HTTP request,
4. membuat request/response object,
5. menjalankan filter chain,
6. memanggil servlet,
7. mengelola session jika dipakai,
8. mengelola listener lifecycle,
9. menjalankan security constraint,
10. menyediakan classloader isolation,
11. deploy/redeploy/undeploy application,
12. shutdown lifecycle.

Jersey bertanggung jawab atas:

1. resource discovery,
2. resource matching,
3. parameter binding,
4. entity provider selection,
5. exception mapping,
6. request/response filter JAX-RS,
7. injection integration,
8. content negotiation,
9. JAX-RS/Jakarta REST semantics.

Jadi boundary-nya:

```text
Servlet container owns HTTP hosting.
Jersey owns REST resource runtime.
Your application owns business behavior.
```

Jika boundary ini kabur, masalah deployment akan sulit didiagnosis.

---

## 5. Jersey di Dalam WAR: Komponen Inti

Untuk deploy Jersey sebagai WAR, komponen kunci biasanya adalah:

1. `jakarta.ws.rs-api` atau `javax.ws.rs-api`,
2. `jersey-server`,
3. `jersey-container-servlet-core` atau `jersey-container-servlet`,
4. injection provider seperti `jersey-hk2`,
5. JSON provider seperti `jersey-media-json-jackson`,
6. aplikasi resource classes,
7. application config: `Application`, `ResourceConfig`, `web.xml`, atau package scanning.

Untuk Jersey 2.x, namespace utama adalah:

```java
javax.ws.rs.*
javax.servlet.*
```

Untuk Jersey 3.x/4.x, namespace utama adalah:

```java
jakarta.ws.rs.*
jakarta.servlet.*
```

Ini bukan perubahan kosmetik. Ini boundary binary compatibility. Class yang dikompilasi terhadap `javax.ws.rs.GET` tidak sama dengan class yang dikompilasi terhadap `jakarta.ws.rs.GET`.

---

## 6. Tiga Cara Umum Menghubungkan Jersey ke WAR

Ada tiga pendekatan besar:

1. annotation-based deployment dengan `@ApplicationPath`,
2. descriptor-based deployment dengan `web.xml`,
3. hybrid/programmatic deployment dengan `ResourceConfig` + servlet init parameter.

Kita bahas satu per satu.

---

## 7. Model A: `@ApplicationPath`

Contoh Jersey 3.x/4.x:

```java
package com.example.api;

import jakarta.ws.rs.ApplicationPath;
import jakarta.ws.rs.core.Application;

@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Resource:

```java
package com.example.api.user;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/users")
public class UserResource {
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public String listUsers() {
        return "[]";
    }
}
```

Dengan context path `/my-api`, endpoint menjadi:

```text
/my-api/api/users
```

Komposisinya:

```text
/my-api  -> context path WAR
/api     -> ApplicationPath
/users   -> resource @Path
```

Kelebihan:

- sederhana,
- tidak perlu `web.xml`,
- cocok untuk aplikasi kecil/menengah,
- lebih declarative.

Kekurangan:

- scanning bisa kurang eksplisit,
- behavior bisa berbeda antar container jika annotation scanning dikonfigurasi berbeda,
- lebih sulit untuk audit deployment mapping secara terpusat,
- tidak ideal jika butuh banyak init-param container/Jersey.

Top-tier engineer tidak anti annotation. Tetapi untuk sistem besar, dia tahu kapan annotation cukup dan kapan descriptor eksplisit lebih aman.

---

## 8. Model B: `web.xml` dengan Jersey Servlet

Contoh `web.xml` untuk Jersey 3.x:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_5_0.xsd"
         version="5.0">

    <servlet>
        <servlet-name>jersey-servlet</servlet-name>
        <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
        <init-param>
            <param-name>jakarta.ws.rs.Application</param-name>
            <param-value>com.example.api.ApiResourceConfig</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>

    <servlet-mapping>
        <servlet-name>jersey-servlet</servlet-name>
        <url-pattern>/api/*</url-pattern>
    </servlet-mapping>
</web-app>
```

`ResourceConfig`:

```java
package com.example.api;

import org.glassfish.jersey.server.ResourceConfig;

public class ApiResourceConfig extends ResourceConfig {
    public ApiResourceConfig() {
        packages("com.example.api");
        register(com.example.api.error.GlobalExceptionMapper.class);
        register(com.example.api.filter.CorrelationIdFilter.class);
    }
}
```

Endpoint:

```text
/context-path/api/users
```

Kelebihan:

- servlet mapping eksplisit,
- startup eager dengan `load-on-startup`,
- mudah memasukkan init-param,
- cocok untuk environment yang perlu security descriptor,
- lebih mudah diaudit,
- failure startup bisa muncul lebih awal.

Kekurangan:

- lebih verbose,
- perlu menjaga descriptor sesuai Servlet version,
- raw XML bisa menjadi sumber typo,
- perlu membedakan parameter name Jersey 2 vs 3.

Untuk sistem enterprise/regulatory, `web.xml` sering lebih defensible karena deployment contract tertulis jelas.

---

## 9. Model C: Jersey sebagai Servlet Filter

Jersey juga bisa dipasang sebagai filter. Secara konseptual:

```text
HTTP request
  -> Filter A
  -> Jersey filter
  -> Filter B or servlet/static handler
```

Model filter berguna jika Jersey harus berpartisipasi dalam filter chain dengan cara tertentu atau jika aplikasi punya kombinasi static content dan REST routing yang lebih spesifik.

Namun filter deployment lebih mudah salah:

- filter ordering salah,
- request yang seharusnya static malah ditangkap Jersey,
- security filter tidak jalan di jalur tertentu,
- CORS diterapkan dua kali,
- error response dibuat oleh filter luar, bukan Jersey exception mapper,
- ambiguous mapping antara Jersey dan servlet lain.

Untuk REST API murni, Jersey sebagai servlet biasanya lebih jelas. Jersey sebagai filter sebaiknya dipilih karena ada alasan arsitektural, bukan karena terlihat fleksibel.

---

## 10. `web.xml` Bukan Legacy Semata

Banyak engineer menganggap `web.xml` selalu legacy. Ini asumsi yang terlalu lemah.

`web.xml` memang berasal dari era lama, tetapi descriptor deployment masih punya nilai besar:

1. mapping terlihat eksplisit,
2. load order bisa dikontrol,
3. security constraint bisa diaudit,
4. init-param bisa dipusatkan,
5. listener/filter bisa diurutkan,
6. environment yang membatasi annotation scanning tetap bisa deploy,
7. startup behavior lebih deterministic,
8. perbedaan container bisa dikurangi.

Untuk aplikasi kecil, `@ApplicationPath` cukup. Untuk aplikasi regulated, multi-team, atau high-compliance, descriptor eksplisit sering lebih mudah dipertanggungjawabkan.

Prinsipnya:

```text
Annotation is good for local clarity.
Descriptor is good for deployment contract clarity.
```

---

## 11. Context Path, Servlet Path, Path Info

Salah satu sumber bug deployment terbesar adalah salah paham path decomposition.

Misalkan request:

```text
GET https://api.example.com/aceas/api/v1/cases/123
```

Jika WAR dideploy dengan context path `/aceas`, servlet mapping `/api/*`, dan resource `@Path("/v1/cases")`, maka:

```text
scheme          = https
host            = api.example.com
context path    = /aceas
servlet path    = /api
path info       = /v1/cases/123
resource path   = /v1/cases/123
```

Jersey resource matching biasanya bekerja terhadap path yang sudah berada di bawah application/servlet mapping.

Bug umum:

```text
Expected endpoint: /api/v1/cases
Actual endpoint:   /aceas/api/v1/cases
```

Atau:

```text
Reverse proxy strips /aceas
Container sees /api/v1/cases
Application generates links with /api instead of /aceas/api
```

Top-tier deployment engineer selalu menanyakan:

1. public URL apa?
2. reverse proxy path rewrite bagaimana?
3. container context path apa?
4. servlet mapping apa?
5. `@ApplicationPath` apa?
6. resource `@Path` apa?
7. absolute URL generation menggunakan base URI yang mana?

---

## 12. Mapping Pattern: `/api/*` vs `/api` vs `/*` vs `/`

Servlet mapping tidak boleh ditebak. Perbedaannya penting.

## 12.1 `/api/*`

Ini prefix mapping. Cocok untuk REST API.

```xml
<url-pattern>/api/*</url-pattern>
```

Request:

```text
/api/users
/api/orders/123
```

Akan masuk ke Jersey servlet.

Kelebihan:

- jelas,
- static content di luar `/api` tidak terganggu,
- reverse proxy rule mudah,
- cocok untuk API versioning.

## 12.2 `/*`

Semua request masuk ke Jersey servlet.

Cocok jika WAR memang REST-only dan tidak ada static servlet/default servlet yang perlu dipakai.

Risiko:

- static files ikut ditangkap,
- error page/container default behavior berubah,
- health endpoint non-Jersey bisa tertutup.

## 12.3 `/`

Root mapping punya semantics khusus sebagai default servlet mapping. Di beberapa container, mapping `/` bisa berinteraksi dengan default servlet. Harus hati-hati.

## 12.4 `/api`

Ini exact mapping, bukan prefix mapping. Request `/api/users` tidak otomatis sama dengan `/api`.

Bug umum:

```xml
<url-pattern>/api</url-pattern>
```

Engineer berharap semua `/api/...` masuk, padahal yang benar untuk prefix adalah:

```xml
<url-pattern>/api/*</url-pattern>
```

---

## 13. Namespace Boundary: Java 8–25 dan `javax`/`jakarta`

WAR deployment sangat sensitif terhadap namespace.

## 13.1 Java 8 + Jersey 2.x

Umumnya:

```text
Java 8
Jersey 2.x
javax.ws.rs.*
javax.servlet.*
Servlet 3.x/4.x container
Tomcat 8.5/9
Jetty 9/10 depending compatibility
```

Contoh imports:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;
```

Servlet API:

```java
import javax.servlet.ServletContext;
```

## 13.2 Java 11/17/21/25 + Jersey 3.x

Umumnya:

```text
Java 11+
Jersey 3.x
jakarta.ws.rs.*
jakarta.servlet.*
Servlet 5/6 compatible container
Tomcat 10+
Jetty 11/12 depending target
```

Contoh imports:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

Servlet API:

```java
import jakarta.servlet.ServletContext;
```

## 13.3 Java 17+ + Jersey 4.x

Umumnya:

```text
Java 17+
Jersey 4.x
Jakarta REST 4.0
Jakarta EE 11 alignment
Servlet 6.1-era runtime depending server support
```

Poin penting: Java version sendiri tidak otomatis menentukan namespace. Yang menentukan adalah library dan container target. Namun dalam praktik, Jersey 2 sering dipakai pada Java 8/11, Jersey 3 pada Java 11/17/21, Jersey 4 pada Java 17+.

---

## 14. Dependency Ownership: Provided vs Packaged

Dalam WAR, dependency harus diklasifikasikan berdasarkan siapa pemiliknya.

Mental model:

```text
Container-owned dependency -> provided
Application-owned dependency -> WEB-INF/lib
Shared infrastructure dependency -> avoid unless explicitly governed
```

## 14.1 Servlet API

Untuk WAR di external container, Servlet API biasanya `provided`.

Maven Jersey 3/Tomcat 10 example:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>5.0.0</version>
    <scope>provided</scope>
</dependency>
```

Kenapa `provided`?

Karena container sudah menyediakan implementation Servlet API. Jika aplikasi membawa Servlet API sendiri ke `WEB-INF/lib`, bisa terjadi class mismatch atau behavior aneh, terutama jika versi tidak cocok.

## 14.2 Jersey Runtime

Untuk Tomcat/Jetty sebagai plain Servlet container, Jersey runtime biasanya dibawa aplikasi di `WEB-INF/lib`.

Contoh:

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet-core</artifactId>
    <version>${jersey.version}</version>
</dependency>

<dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Kenapa bukan `provided`?

Karena Tomcat bukan full Jakarta REST server. Tomcat menyediakan Servlet, bukan Jersey/Jakarta REST runtime.

## 14.3 Jakarta REST API

Tergantung container.

Di Tomcat plain servlet container:

- sering ikut sebagai dependency transitif Jersey,
- bisa masuk `WEB-INF/lib`,
- harus cocok dengan Jersey major version.

Di full Jakarta EE server:

- Jakarta REST API/implementation bisa disediakan server,
- membawa Jersey sendiri bisa konflik dengan server-provided runtime,
- perlu aturan packaging yang lebih hati-hati.

## 14.4 JSON Provider

Jika memakai Jackson provider:

```xml
<dependency>
    <groupId>org.glassfish.jersey.media</groupId>
    <artifactId>jersey-media-json-jackson</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Pastikan versi Jackson transitif tidak bentrok dengan versi lain di aplikasi.

## 14.5 Database Driver

Database driver biasanya application-owned atau container-managed tergantung strategi.

Dua pendekatan:

1. Driver di WAR `WEB-INF/lib`.
2. Driver di container lib untuk JNDI datasource.

Pendekatan 1 lebih isolated. Pendekatan 2 sering dipakai untuk container-managed datasource, tetapi meningkatkan risiko shared dependency conflict.

---

## 15. Classloader Isolation

Setiap web application biasanya punya classloader sendiri. Di Tomcat, dokumentasi classloader menjelaskan adanya pemisahan classloader untuk container dan web application. Tujuannya agar aplikasi yang berbeda bisa membawa library berbeda.

Mental model:

```text
Bootstrap ClassLoader
  -> Platform/System ClassLoader
      -> Container/Common ClassLoader
          -> WebApp ClassLoader A
          -> WebApp ClassLoader B
```

Dalam praktik:

```text
WAR A punya Jackson 2.15
WAR B punya Jackson 2.17
Container bisa menjalankan keduanya jika isolation benar
```

Namun masalah muncul jika dependency diletakkan di common container lib:

```text
$CATALINA_BASE/lib/jackson-databind.jar
```

Maka semua aplikasi bisa terkena versi yang sama.

Prinsip production:

```text
Do not put application libraries into container global lib unless there is a clear governance reason.
```

Dokumentasi Tomcat sendiri memperingatkan bahwa application classes normalnya tidak ditempatkan di common loader. Ini sejalan dengan prinsip isolation.

---

## 16. WAR Deployment Lifecycle

Lifecycle WAR di container kira-kira:

```text
1. Container startup or deployment trigger
2. WAR discovered
3. WAR unpacked or mounted
4. Web application context created
5. Webapp classloader created
6. web.xml parsed
7. annotations scanned
8. ServletContainerInitializer processed
9. listeners initialized
10. filters initialized
11. servlets initialized according to load-on-startup
12. Jersey runtime initialized
13. resources/providers discovered/registered
14. application marked available
15. requests routed
16. undeploy/redeploy/shutdown begins
17. servlet/filter/listener destroyed
18. classloader eligible for GC
```

Untuk Jersey, titik pentingnya adalah step 12-13.

Jika `load-on-startup` diset:

```xml
<load-on-startup>1</load-on-startup>
```

Maka Jersey servlet diinisialisasi saat aplikasi start. Ini bagus untuk production karena error resource/provider muncul di startup, bukan pada request pertama.

Jika tidak diset, servlet bisa lazy-init pada request pertama. Ini dapat menyebabkan first request terkena error startup.

Prinsip production:

```text
Prefer eager startup for REST runtime.
Fail fast before receiving traffic.
```

---

## 17. `load-on-startup` dan Fail-Fast Deployment

Tanpa `load-on-startup`:

```text
App deployed -> container says OK -> first user request -> Jersey starts -> error appears
```

Dengan `load-on-startup`:

```text
App deployed -> Jersey starts -> error appears immediately -> deployment fails or app unavailable
```

Fail-fast lebih baik untuk regulated/production environment karena deployment pipeline bisa mendeteksi error sebelum traffic masuk.

Contoh error yang ingin kita tangkap saat startup:

- class resource tidak ditemukan,
- provider gagal dibuat,
- injection dependency missing,
- ambiguous resource method,
- duplicate provider conflict,
- invalid feature registration,
- broken configuration,
- incompatible API namespace.

---

## 18. `ResourceConfig` sebagai Composition Root

Dalam Jersey WAR yang serius, `ResourceConfig` sebaiknya dipakai sebagai composition root.

Contoh:

```java
package com.example.api;

import org.glassfish.jersey.server.ResourceConfig;

public final class ApiResourceConfig extends ResourceConfig {
    public ApiResourceConfig() {
        registerResources();
        registerProviders();
        registerFilters();
        registerFeatures();
        configureProperties();
    }

    private void registerResources() {
        packages("com.example.api.resource");
    }

    private void registerProviders() {
        register(com.example.api.error.ApiExceptionMapper.class);
        register(com.example.api.json.ObjectMapperProvider.class);
    }

    private void registerFilters() {
        register(com.example.api.filter.CorrelationIdRequestFilter.class);
        register(com.example.api.filter.AuditResponseFilter.class);
    }

    private void registerFeatures() {
        // register custom features here
    }

    private void configureProperties() {
        property("jersey.config.server.wadl.disableWadl", true);
    }
}
```

Keuntungan:

1. registration eksplisit,
2. startup lebih deterministic,
3. testing lebih mudah,
4. behavior tidak bergantung penuh pada scanning,
5. production review lebih mudah.

Package scanning tetap boleh, tetapi harus sadar risikonya:

- bisa lambat untuk classpath besar,
- bisa menemukan class yang tidak dimaksud,
- bisa berbeda saat shading/relocation,
- bisa terpengaruh container scanning rules.

Untuk sistem besar, prefer:

```text
Explicit registration for critical providers.
Limited package scanning for resources only.
```

---

## 19. Annotation Scanning: Convenience vs Determinism

Annotation scanning membuat aplikasi lebih mudah ditulis:

```java
@Path("/cases")
public class CaseResource { }
```

Tetapi deployment WAR menambahkan kompleksitas:

1. container melakukan scanning untuk servlet annotations,
2. Jersey melakukan scanning untuk JAX-RS annotations,
3. CDI mungkin melakukan scanning untuk beans,
4. JSON provider mungkin memakai service loader,
5. framework lain mungkin melakukan scanning sendiri.

Di aplikasi besar, scanning bisa menjadi sumber:

- startup lambat,
- duplicate registration,
- classloading error saat class opsional tidak tersedia,
- memory pressure saat startup,
- nondeterministic behavior jika classpath berubah.

Prinsip:

```text
Scanning is acceptable when bounded.
Scanning becomes risk when unbounded.
```

Cara membatasi:

```java
packages("com.example.api.resource");
```

Jangan scan root package terlalu luas:

```java
packages("com.example"); // can be too broad in large systems
```

Lebih buruk:

```java
packages("com"); // dangerous and slow
```

---

## 20. WAR dengan Maven

Contoh `pom.xml` Jersey 3.x untuk Tomcat 10+:

```xml
<project>
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>case-api</artifactId>
    <version>1.0.0</version>
    <packaging>war</packaging>

    <properties>
        <maven.compiler.release>17</maven.compiler.release>
        <jersey.version>3.1.11</jersey.version>
    </properties>

    <dependencies>
        <dependency>
            <groupId>jakarta.servlet</groupId>
            <artifactId>jakarta.servlet-api</artifactId>
            <version>5.0.0</version>
            <scope>provided</scope>
        </dependency>

        <dependency>
            <groupId>org.glassfish.jersey.containers</groupId>
            <artifactId>jersey-container-servlet-core</artifactId>
            <version>${jersey.version}</version>
        </dependency>

        <dependency>
            <groupId>org.glassfish.jersey.inject</groupId>
            <artifactId>jersey-hk2</artifactId>
            <version>${jersey.version}</version>
        </dependency>

        <dependency>
            <groupId>org.glassfish.jersey.media</groupId>
            <artifactId>jersey-media-json-jackson</artifactId>
            <version>${jersey.version}</version>
        </dependency>
    </dependencies>

    <build>
        <finalName>case-api</finalName>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-war-plugin</artifactId>
                <version>3.4.0</version>
            </plugin>
        </plugins>
    </build>
</project>
```

Untuk Jersey 2.x/Java 8/Tomcat 9, namespace dan dependencies berubah:

```xml
<properties>
    <maven.compiler.source>1.8</maven.compiler.source>
    <maven.compiler.target>1.8</maven.compiler.target>
    <jersey.version>2.47</jersey.version>
</properties>

<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
    <version>4.0.1</version>
    <scope>provided</scope>
</dependency>

<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet-core</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Jangan mencampur:

```text
Jersey 2 + jakarta.ws.rs annotations
Jersey 3 + javax.ws.rs annotations
Tomcat 9 + jakarta.servlet app
Tomcat 10 + javax.servlet app
```

---

## 21. WAR dengan Gradle

Contoh Gradle modern:

```kotlin
plugins {
    java
    war
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

repositories {
    mavenCentral()
}

val jerseyVersion = "3.1.11"

dependencies {
    providedCompile("jakarta.servlet:jakarta.servlet-api:5.0.0")

    implementation("org.glassfish.jersey.containers:jersey-container-servlet-core:$jerseyVersion")
    implementation("org.glassfish.jersey.inject:jersey-hk2:$jerseyVersion")
    implementation("org.glassfish.jersey.media:jersey-media-json-jackson:$jerseyVersion")
}

tasks.war {
    archiveFileName.set("case-api.war")
}
```

Untuk Java 8/Jersey 2:

```kotlin
java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}

val jerseyVersion = "2.47"

dependencies {
    providedCompile("javax.servlet:javax.servlet-api:4.0.1")
    implementation("org.glassfish.jersey.containers:jersey-container-servlet-core:$jerseyVersion")
    implementation("org.glassfish.jersey.inject:jersey-hk2:$jerseyVersion")
}
```

---

## 22. WAR File Name dan Context Path

Di banyak container, nama WAR menentukan context path.

Contoh Tomcat:

```text
case-api.war -> /case-api
ROOT.war     -> /
```

Jadi endpoint bisa berubah hanya karena nama file WAR berubah.

```text
case-api.war + /api/* + @Path('/users')
= /case-api/api/users
```

Jika di-deploy sebagai `ROOT.war`:

```text
ROOT.war + /api/* + @Path('/users')
= /api/users
```

Ini sangat penting di balik reverse proxy.

Anti-pattern:

```text
Application assumes it always runs at root context.
```

Production pattern:

```text
Public base URL must be explicitly known, configured, or derived through trusted forwarded headers.
```

---

## 23. External Container vs Embedded Container

WAR deployment berarti container external biasanya menjalankan aplikasi.

External container:

```text
Tomcat process
  -> deploys case-api.war
  -> manages lifecycle
```

Embedded deployment:

```text
java -jar case-api.jar
  -> app creates Jetty/Grizzly/Tomcat embedded
  -> app manages lifecycle
```

Perbedaan penting:

| Concern | WAR External Container | Embedded Server |
|---|---|---|
| Owner of port | Container | Application |
| Owner of HTTP thread pool | Container | Application |
| Artifact | WAR | JAR/dir/image |
| Lifecycle | deploy/redeploy | process start/stop |
| Classloader | webapp classloader | app classloader/custom |
| Operational model | app server ops | service ops |
| Multi-app hosting | natural | uncommon |
| Isolation | per WAR | per process usually |

Top-tier engineer tidak menganggap salah satunya selalu lebih baik. Dia memilih berdasarkan operational model.

WAR cocok jika:

- organisasi sudah punya app server standard,
- banyak aplikasi kecil di satu container,
- ada container-managed resources,
- deployment governance berbasis WAR,
- environment legacy masih Java 8/11.

Embedded cocok jika:

- cloud-native per service process,
- container image per service,
- ownership penuh di aplikasi,
- ingin immutable runtime,
- deploy via Kubernetes lebih natural.

---

## 24. WAR dan Full Jakarta EE Server

Jika WAR dideploy ke full Jakarta EE server, situasinya lebih kompleks.

Tomcat hanya menyediakan Servlet/JSP/EL/WebSocket stack tertentu, bukan full Jakarta EE. Full server seperti GlassFish/Payara/Open Liberty/WildFly dapat menyediakan:

- Jakarta REST,
- CDI,
- JSON-B,
- JSON-P,
- Bean Validation,
- Jakarta Persistence,
- Jakarta Transactions,
- Jakarta Security,
- Jakarta Concurrency,
- JNDI resources,
- connector resources.

Dalam full Jakarta EE server, membawa Jersey sendiri di WAR bisa konflik dengan server-provided Jakarta REST runtime.

Ada dua model:

## 24.1 Server-Provided REST Runtime

WAR tidak membawa Jersey runtime. Server menyediakan Jakarta REST implementation.

Kelebihan:

- lebih aligned dengan server,
- CDI/security/JTA integration lebih natural,
- artifact lebih kecil.

Kekurangan:

- runtime behavior bergantung server,
- upgrade Jersey bergantung server upgrade,
- portability bisa terpengaruh vendor behavior.

## 24.2 Application-Bundled Jersey Runtime

WAR membawa Jersey sendiri.

Kelebihan:

- aplikasi mengontrol Jersey version,
- behavior lebih konsisten antar plain servlet container,
- bisa patch library lebih cepat.

Kekurangan:

- konflik dengan server modules,
- classloader tuning bisa diperlukan,
- duplicate API/implementation risk,
- CDI/JTA/security integration perlu diuji serius.

Prinsip:

```text
On plain Servlet container: bundle Jersey.
On full Jakarta EE server: decide explicitly who owns Jakarta REST runtime.
```

Jangan biarkan dependency ownership terjadi secara kebetulan.

---

## 25. `WEB-INF/lib` Hygiene

WAR production harus punya dependency hygiene.

Checklist:

1. tidak ada duplicate versions,
2. tidak ada campuran `javax` dan `jakarta` API yang salah,
3. tidak ada servlet API packaged jika container-owned,
4. tidak ada test libraries,
5. tidak ada embedded server library yang tidak dipakai,
6. tidak ada vulnerable unused dependency,
7. tidak ada dependency dengan overlapping service provider tanpa disengaja,
8. tidak ada logging binding ganda,
9. tidak ada database driver ganda,
10. tidak ada old JAXB/JAX-RS API incompatible.

Command inspeksi:

```bash
jar tf target/case-api.war | sort
```

Cari Servlet API:

```bash
jar tf target/case-api.war | grep -E 'servlet.*api|jakarta.servlet|javax.servlet'
```

Cari JAX-RS/Jakarta REST API:

```bash
jar tf target/case-api.war | grep -E 'jaxrs|jakarta.ws.rs|javax.ws.rs'
```

Cari Jersey:

```bash
jar tf target/case-api.war | grep jersey
```

Cari logging:

```bash
jar tf target/case-api.war | grep -E 'slf4j|logback|log4j|jul'
```

---

## 26. ServiceLoader dan Provider Collision

Banyak Java library memakai `META-INF/services`. Jersey, JSON provider, injection provider, logging bridge, dan library lain bisa menggunakan service provider discovery.

Dalam WAR, provider discovery bisa terjadi dari:

```text
WEB-INF/classes/META-INF/services
WEB-INF/lib/*.jar!/META-INF/services
container/common/lib/*.jar!/META-INF/services
```

Masalah umum:

- dua JSON provider aktif,
- provider lama masih ada dari dependency transitif,
- HK2 injection provider tidak ada,
- MOXy auto-discovered padahal ingin Jackson,
- custom provider tidak ditemukan karena packaging salah.

Prinsip:

```text
Critical providers should be registered explicitly.
Do not rely blindly on auto-discovery for production behavior.
```

Contoh:

```java
register(org.glassfish.jersey.jackson.JacksonFeature.class);
register(ObjectMapperProvider.class);
```

---

## 27. Static Content + Jersey dalam WAR

WAR bisa melayani static files dan REST API bersamaan.

Contoh:

```text
/
  index.html
  assets/app.js
/api/*
  Jersey REST API
```

Mapping:

```xml
<servlet-mapping>
    <servlet-name>jersey-servlet</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Static files tetap dilayani default servlet container.

Jika Jersey dimapping `/*`, static files bisa tertangkap Jersey.

Production choice:

```text
If WAR contains both SPA/static and API, prefer /api/* for Jersey.
If WAR is API-only, /* may be acceptable but must be intentional.
```

Dalam cloud-native architecture, sering lebih baik memisahkan static SPA dari API service. Namun dalam enterprise legacy, satu WAR gabungan masih sering ditemukan.

---

## 28. Security dalam WAR Deployment

Security bisa berada di beberapa layer:

```text
Client
  -> reverse proxy / WAF / API gateway
  -> Servlet container security
  -> Servlet filter
  -> Jersey request filter
  -> resource method authorization
  -> service/domain authorization
```

WAR deployment dapat memakai:

1. container-managed security melalui `web.xml`,
2. application-managed security melalui filters,
3. Jakarta Security/CDI jika full Jakarta EE,
4. reverse proxy/API gateway authentication,
5. JWT validation di Jersey filter,
6. mTLS di proxy/container.

Contoh `web.xml` security constraint:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>API</web-resource-name>
        <url-pattern>/api/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>api-user</role-name>
    </auth-constraint>
</security-constraint>
```

Namun untuk modern token-based API, sering authorization dilakukan di application filter/domain layer.

Prinsip top-tier:

```text
Do not confuse authentication success with authorization correctness.
Deployment security boundary must be explicit.
```

Pertanyaan penting:

- Siapa memvalidasi token?
- Siapa memetakan principal?
- Siapa memeriksa role/scope?
- Apakah path `/api/admin/*` dilindungi di semua layer?
- Apakah reverse proxy bisa bypass container security?
- Apakah forwarded header dipercaya hanya dari proxy internal?
- Apakah error auth bocor detail?

---

## 29. Configuration dalam WAR

WAR idealnya immutable. Konfigurasi environment-specific sebaiknya tidak hardcoded di artifact.

Sumber konfigurasi:

1. environment variables,
2. Java system properties,
3. JNDI environment entries,
4. external config file,
5. container context parameters,
6. Servlet init-param,
7. Kubernetes ConfigMap/Secret mounted file,
8. cloud secret manager.

Contoh servlet init-param:

```xml
<init-param>
    <param-name>app.config.location</param-name>
    <param-value>${APP_CONFIG_LOCATION}</param-value>
</init-param>
```

Namun tidak semua container melakukan variable substitution di `web.xml` secara sama. Jangan asumsikan.

Production rule:

```text
Configuration precedence must be documented and tested.
```

Contoh precedence:

```text
1. System property
2. Environment variable
3. External file
4. Servlet init-param
5. Default bundled config
```

---

## 30. Logging dalam WAR

Logging WAR bisa rumit karena container juga punya logging.

Layer logging:

```text
Container logs
Access logs
Application logs
Jersey logs
Dependency logs
GC logs
```

Masalah umum:

- aplikasi membawa logging binding yang bentrok,
- container memakai JUL, aplikasi memakai SLF4J/Logback,
- log tidak punya correlation ID,
- access log tidak bisa dikorelasikan dengan app log,
- redeploy membuat appender thread bocor,
- async logging tidak shutdown.

Production pattern:

1. satu logging facade,
2. satu binding jelas,
3. correlation ID filter di awal request,
4. structured logs jika mungkin,
5. access log aktif di container/proxy,
6. request ID diteruskan ke response header,
7. logger shutdown bersih saat undeploy.

Jersey request filter contoh:

```java
@Provider
public final class CorrelationIdFilter implements jakarta.ws.rs.container.ContainerRequestFilter,
        jakarta.ws.rs.container.ContainerResponseFilter {

    private static final String HEADER = "X-Correlation-Id";

    @Override
    public void filter(jakarta.ws.rs.container.ContainerRequestContext requestContext) {
        String id = requestContext.getHeaderString(HEADER);
        if (id == null || id.isBlank()) {
            id = java.util.UUID.randomUUID().toString();
        }
        requestContext.setProperty(HEADER, id);
        org.slf4j.MDC.put(HEADER, id);
    }

    @Override
    public void filter(jakarta.ws.rs.container.ContainerRequestContext requestContext,
                       jakarta.ws.rs.container.ContainerResponseContext responseContext) {
        Object id = requestContext.getProperty(HEADER);
        if (id != null) {
            responseContext.getHeaders().putSingle(HEADER, id.toString());
        }
        org.slf4j.MDC.remove(HEADER);
    }
}
```

Catatan: filter ini sederhana. Dalam production, pastikan cleanup tetap terjadi pada async/error path.

---

## 31. Health Check dalam WAR

Health check untuk WAR harus membedakan:

1. process/container hidup,
2. web application deployed,
3. Jersey runtime initialized,
4. dependency kritikal tersedia,
5. aplikasi siap menerima traffic.

Endpoint:

```java
@Path("/health")
public class HealthResource {
    @GET
    @Path("/live")
    public Response live() {
        return Response.ok().build();
    }

    @GET
    @Path("/ready")
    public Response ready() {
        // check critical readiness
        return Response.ok().build();
    }
}
```

Dalam WAR dengan context `/case-api` dan mapping `/api/*`:

```text
/case-api/api/health/live
/case-api/api/health/ready
```

Jika Kubernetes probe salah path, pod akan restart padahal aplikasi sehat.

Checklist:

- probe path mencakup context path,
- reverse proxy tidak mengubah path tanpa disadari,
- readiness gagal jika dependency wajib belum siap,
- liveness tidak terlalu berat,
- startup probe dipakai jika startup lama,
- health endpoint tidak butuh auth atau memakai auth khusus internal.

---

## 32. Graceful Shutdown dan Undeploy

Dalam WAR deployment, shutdown bisa terjadi karena:

1. container stop,
2. application undeploy,
3. redeploy,
4. node termination,
5. Kubernetes pod shutdown,
6. admin operation.

Servlet container akan memanggil destroy lifecycle:

```text
filters destroyed
servlets destroyed
listeners destroyed
classloader released
```

Aplikasi harus memastikan:

- executor shutdown,
- database pool closed jika application-owned,
- HTTP clients closed,
- scheduler stopped,
- metrics exporter stopped,
- logging appender flushed,
- background thread tidak menahan classloader,
- ThreadLocal/MDC dibersihkan,
- resource tidak menerima request baru saat shutdown.

Memory leak klasik saat redeploy:

```text
Old webapp classloader cannot be GC'ed because a background thread still references application class.
```

Contoh listener:

```java
public final class AppLifecycleListener implements jakarta.servlet.ServletContextListener {
    @Override
    public void contextInitialized(jakarta.servlet.ServletContextEvent sce) {
        // initialize app-wide resources if needed
    }

    @Override
    public void contextDestroyed(jakarta.servlet.ServletContextEvent sce) {
        // close executors, clients, pools
    }
}
```

Daftarkan:

```xml
<listener>
    <listener-class>com.example.api.AppLifecycleListener</listener-class>
</listener>
```

---

## 33. Redeploy: Risiko yang Sering Diremehkan

Redeploy WAR bukan sekadar mengganti file.

Risiko redeploy:

1. request aktif terputus,
2. session hilang,
3. classloader lama bocor,
4. file lock pada Windows,
5. database pool lama belum tertutup,
6. scheduler double-run,
7. cache local hilang,
8. startup scanning lama,
9. traffic masuk sebelum ready,
10. rollback tidak bersih.

Dalam regulated system, redeploy harus diperlakukan sebagai state transition:

```text
RUNNING
  -> DRAINING
  -> STOPPING
  -> STOPPED
  -> DEPLOYING
  -> STARTING
  -> READY
  -> RUNNING
```

Jika container tidak menyediakan draining bagus, lakukan di load balancer/reverse proxy.

---

## 34. WAR di Docker: Bukan Berarti Cloud-Native Otomatis

Banyak tim menaruh Tomcat + WAR ke Docker dan menganggap sudah cloud-native.

Contoh:

```Dockerfile
FROM tomcat:10.1-jdk17
COPY target/case-api.war /usr/local/tomcat/webapps/case-api.war
```

Ini valid, tetapi belum otomatis robust.

Pertanyaan production:

- Apakah image non-root?
- Apakah base image minimal dan patched?
- Apakah WAR dideploy saat build, bukan runtime copy manual?
- Apakah context path stabil?
- Apakah Tomcat shutdown menerima SIGTERM dengan benar?
- Apakah `server.xml` ditune?
- Apakah access log ke stdout?
- Apakah heap sesuai container memory?
- Apakah health endpoint benar?
- Apakah graceful termination cukup lama?

Docker tidak menghapus kontrak WAR. Docker hanya membungkus container runtime dan WAR ke image.

---

## 35. WAR di Kubernetes

Model umum:

```text
Pod
  -> container image with Tomcat
      -> deployed WAR
          -> Jersey app
```

Kubernetes concern:

1. readiness probe,
2. liveness probe,
3. startup probe,
4. resource requests/limits,
5. graceful termination,
6. preStop hook,
7. config/secret injection,
8. rolling update,
9. service routing,
10. ingress path rewrite.

Deployment path example:

```yaml
readinessProbe:
  httpGet:
    path: /case-api/api/health/ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5

livenessProbe:
  httpGet:
    path: /case-api/api/health/live
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
```

Jika WAR name berubah dari `case-api.war` ke `ROOT.war`, probe path harus ikut berubah.

Prinsip:

```text
In Kubernetes, context path is an operational contract.
Do not let artifact naming accidentally define routing.
```

---

## 36. Reverse Proxy Path Rewriting

Contoh public URL:

```text
https://example.com/api/cases
```

Internal Tomcat:

```text
http://tomcat:8080/case-api/api/cases
```

Proxy bisa:

1. preserve path,
2. strip prefix,
3. add prefix,
4. rewrite host/scheme,
5. terminate TLS.

Jika aplikasi membuat absolute URL, Jersey bisa memakai base URI dari request yang dilihat container. Jika proxy tidak meneruskan forwarded headers dengan benar, aplikasi bisa menghasilkan link salah:

```text
http://tomcat:8080/case-api/api/cases/123
```

Padahal public harus:

```text
https://example.com/api/cases/123
```

Deployment harus menetapkan aturan:

- trusted proxy siapa,
- header apa yang dipercaya,
- `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`, `Forwarded`,
- apakah container memproses remote IP valve/customizer,
- apakah aplikasi boleh percaya header dari client langsung.

Security warning:

```text
Never blindly trust forwarded headers from arbitrary clients.
```

---

## 37. Common Failure Modes

## 37.1 `ClassNotFoundException: org.glassfish.jersey.servlet.ServletContainer`

Penyebab:

- `jersey-container-servlet-core` tidak masuk WAR,
- scope salah menjadi `provided`,
- dependency excluded,
- WAR salah artifact.

Diagnosis:

```bash
jar tf target/app.war | grep jersey-container-servlet
```

## 37.2 `NoClassDefFoundError: jakarta/ws/rs/core/Application`

Penyebab:

- Jakarta REST API tidak tersedia,
- Jersey dependency tidak lengkap,
- container/server tidak menyediakan API,
- dependency scope salah.

## 37.3 `NoClassDefFoundError: javax/ws/rs/...`

Penyebab:

- aplikasi/resource masih `javax.*`, runtime sudah `jakarta.*`,
- migrasi Jersey 2 ke 3 tidak tuntas.

## 37.4 `ClassCastException` antara Servlet classes

Penyebab:

- aplikasi membawa Servlet API sendiri,
- container punya Servlet API berbeda,
- shared lib conflict.

## 37.5 404 untuk semua endpoint

Penyebab:

- servlet mapping salah,
- context path salah,
- `@ApplicationPath` salah,
- resource package tidak discan,
- resource class tidak public,
- WAR deploy path berbeda.

## 37.6 415 Unsupported Media Type

Penyebab:

- `Content-Type` request salah,
- MessageBodyReader tidak tersedia,
- JSON provider tidak registered,
- dependency Jackson/MOXy hilang.

## 37.7 406 Not Acceptable

Penyebab:

- `Accept` header tidak cocok,
- `@Produces` terlalu sempit,
- provider output tidak tersedia.

## 37.8 Injection Error saat Startup

Penyebab:

- `jersey-hk2` tidak ada,
- binder tidak registered,
- CDI/HK2 boundary salah,
- constructor injection tidak resolvable.

## 37.9 Memory Leak saat Redeploy

Penyebab:

- executor tidak shutdown,
- JDBC driver deregistration issue,
- ThreadLocal tidak dibersihkan,
- logging appender masih aktif,
- static cache menahan classloader.

---

## 38. Diagnostic Workflow saat WAR Gagal Deploy

Jangan mulai dari menebak. Gunakan workflow.

## Step 1: Pastikan container dan namespace cocok

```text
Tomcat 9  -> javax servlet world
Tomcat 10 -> jakarta servlet world
Jersey 2  -> javax.ws.rs world
Jersey 3+ -> jakarta.ws.rs world
```

## Step 2: Inspect WAR

```bash
jar tf target/app.war | less
```

Validasi:

- `WEB-INF/web.xml` ada jika diharapkan,
- `WEB-INF/classes` berisi app classes,
- Jersey jars ada,
- Servlet API tidak ikut jika harus provided,
- tidak ada duplicate weird jars.

## Step 3: Baca container log dari awal deployment

Cari:

```text
Deployment of web application archive
Initializing Spring/HK2/Jersey
SEVERE
ClassNotFoundException
NoClassDefFoundError
MultiException
```

## Step 4: Validasi path

Tentukan:

```text
context path
servlet mapping
application path
resource path
proxy rewrite
```

## Step 5: Buat minimal endpoint

```java
@Path("/ping")
public class PingResource {
    @GET
    public String ping() {
        return "pong";
    }
}
```

Jika ping tidak muncul, masalah di deployment/mapping/registration, bukan business logic.

## Step 6: Matikan auto-discovery yang tidak perlu

Daftarkan provider eksplisit untuk mengurangi noise.

## Step 7: Bandingkan dependency tree

Maven:

```bash
mvn dependency:tree
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath
```

---

## 39. Production Readiness Checklist untuk Jersey WAR

## 39.1 Compatibility

- [ ] Java version sesuai target.
- [ ] Jersey major version sesuai namespace.
- [ ] Servlet container sesuai namespace.
- [ ] Tidak mencampur `javax.*` dan `jakarta.*` secara salah.
- [ ] Jakarta REST/JAX-RS API version cocok.

## 39.2 Packaging

- [ ] WAR berisi classes yang benar.
- [ ] Jersey runtime ada jika container plain servlet.
- [ ] Servlet API `provided` untuk external container.
- [ ] Tidak ada duplicate dependency berbahaya.
- [ ] JSON provider jelas.
- [ ] Injection provider jelas.

## 39.3 Mapping

- [ ] Context path diketahui.
- [ ] Servlet mapping eksplisit.
- [ ] `@ApplicationPath` tidak konflik dengan servlet mapping.
- [ ] Reverse proxy rewrite didokumentasikan.
- [ ] Health endpoint path benar.

## 39.4 Lifecycle

- [ ] `load-on-startup` dipakai untuk fail-fast.
- [ ] Startup validates critical config.
- [ ] Shutdown menutup executor/client/pool.
- [ ] Redeploy tidak bocor thread/classloader.

## 39.5 Security

- [ ] TLS boundary jelas.
- [ ] AuthN/AuthZ layer jelas.
- [ ] Security constraint/filter mapping benar.
- [ ] Forwarded headers hanya dipercaya dari proxy tepercaya.
- [ ] Error response tidak bocor detail.

## 39.6 Observability

- [ ] Access log aktif.
- [ ] Application log structured atau konsisten.
- [ ] Correlation ID ada.
- [ ] Metrics tersedia.
- [ ] Health/readiness/liveness jelas.
- [ ] Startup logs mencetak version/runtime penting.

## 39.7 Operations

- [ ] Deployment artifact immutable.
- [ ] Config externalized.
- [ ] Rollback path tersedia.
- [ ] Probe/monitoring sesuai context path.
- [ ] Timeout align antara proxy/container/app.
- [ ] Memory/CPU setting sesuai container/process.

---

## 40. Decision Framework: Kapan WAR adalah Pilihan Tepat?

WAR cocok jika:

1. tim ops sudah standardisasi Tomcat/Jetty/app server,
2. organisasi butuh deployment model familiar,
3. aplikasi berada di environment Java EE/Jakarta EE,
4. multi-app per container masih diterima,
5. aplikasi legacy Java 8 masih dominan,
6. container-managed resources dibutuhkan,
7. compliance menginginkan descriptor eksplisit,
8. migration ke cloud-native belum selesai.

WAR kurang ideal jika:

1. setiap service ingin runtime sepenuhnya self-contained,
2. Kubernetes menjadi deployment target utama,
3. immutable image per service lebih penting,
4. team ingin avoid shared container lifecycle,
5. startup/redeploy isolation harus per process,
6. perlu custom server lifecycle penuh.

Namun jawabannya bukan “WAR buruk”. Jawaban yang lebih matang:

```text
WAR is a valid deployment contract when its lifecycle, dependency ownership,
classloading, and operational boundaries are intentionally governed.
```

---

## 41. Mini Case Study: API Case Management sebagai WAR

Bayangkan aplikasi case management regulatory:

```text
Public URL:       https://case.example.gov/api/v1/cases
Reverse proxy:    strips /api? no, preserves path
Tomcat context:   /case-api
Jersey mapping:   /api/*
Resource path:    /v1/cases
Runtime:          Java 17
Jersey:           3.1.x
Container:        Tomcat 10.1
```

Endpoint internal:

```text
/case-api/api/v1/cases
```

Proxy route:

```text
/api/v1/cases -> /case-api/api/v1/cases
```

Design decisions:

- use `web.xml` for explicit mapping,
- use `ResourceConfig` as composition root,
- use `load-on-startup=1`,
- Servlet API `provided`,
- Jersey runtime packaged,
- Jackson provider explicit,
- correlation ID filter registered,
- health endpoint under `/api/health`,
- readiness checks DB/cache if mandatory,
- access log enabled at proxy/container,
- config externalized via environment/system properties,
- graceful shutdown closes executor and clients,
- artifact name fixed as `case-api.war` or deployed as `ROOT.war` intentionally.

Failure test before production:

1. deploy with missing Jackson provider -> expect startup/test failure,
2. deploy with wrong context path -> probe catches,
3. simulate DB down -> readiness false,
4. send SIGTERM -> request draining observed,
5. redeploy 20 times -> no classloader/thread leak,
6. verify 404 path matrix,
7. verify auth bypass impossible through alternate path,
8. verify forwarded header spoofing rejected.

---

## 42. Anti-Patterns

## 42.1 “It Works on Embedded, So WAR Must Work”

Embedded and WAR have different classloading, lifecycle, mapping, and dependency ownership. Passing embedded test is not enough.

## 42.2 “Put Missing Jar into Tomcat lib”

This often fixes one app and breaks another. Prefer fixing WAR dependencies unless shared container library is intentionally governed.

## 42.3 “Use `/*` Because It Makes Everything Work”

It may hide mapping mistakes and break static/error/default servlet behavior.

## 42.4 “Lazy Startup is Fine”

Lazy startup shifts deployment failure to first user request.

## 42.5 “Context Path Does Not Matter”

Context path affects routing, probes, links, CORS, cookies, reverse proxy, and monitoring.

## 42.6 “WAR in Docker Means No App Server Thinking Needed”

Docker wraps the app server. It does not remove Tomcat/Jetty lifecycle concerns.

## 42.7 “Mix `javax` and `jakarta` Until It Compiles”

Compiles does not mean runtime-compatible. Namespace boundary is binary/runtime boundary.

---

## 43. Java 8 sampai Java 25: Practical Guidance

## 43.1 Java 8

Recommended practical model:

```text
Jersey 2.x
javax.ws.rs
javax.servlet
Tomcat 8.5/9 or compatible app server
WAR deployment if legacy enterprise
```

Risks:

- older dependency ecosystem,
- security patch pressure,
- migration burden to jakarta,
- fewer modern JVM/container improvements.

## 43.2 Java 11

Transitional model:

```text
Jersey 2.x or 3.x depending namespace migration
Tomcat 9 for javax
Tomcat 10 for jakarta
```

Java 11 can be bridge version, but do not mix namespace.

## 43.3 Java 17

Modern stable model:

```text
Jersey 3.x or 4.x depending Jakarta target
Tomcat 10.1 / Jetty 11/12 / modern Jakarta runtimes
```

Good baseline for long-lived enterprise services.

## 43.4 Java 21

Modern LTS with better runtime ergonomics. WAR deployment remains valid. Virtual threads may affect application design, but Servlet container integration must be understood per container support.

## 43.5 Java 25

Java 25 is a current modern LTS target. For WAR, the main question is not “can Java 25 run WAR?” but:

- does the container support Java 25?
- do all dependencies support Java 25?
- is Jersey version tested on Java 25?
- do build plugins support target runtime?
- do monitoring agents support Java 25?
- do container images exist and pass security scanning?

---

## 44. What Top 1% Engineers See in WAR Deployment

Average engineer sees:

```text
WAR = deployable file
```

Strong engineer sees:

```text
WAR = classloader boundary + dependency graph + servlet lifecycle + path contract
```

Top-tier engineer sees:

```text
WAR = operationally governed runtime contract whose correctness depends on
version alignment, namespace boundary, container ownership, lifecycle semantics,
routing invariants, security boundaries, observability, and failure-mode testing.
```

That is the level we want.

---

## 45. Ringkasan

WAR deployment model adalah salah satu deployment model Jersey yang paling penting karena masih sangat banyak dipakai di enterprise. Kekuatan WAR ada pada standardisasi dan integrasinya dengan Servlet container. Kelemahannya ada pada classloader complexity, dependency ownership, lifecycle redeploy, dan namespace compatibility.

Poin utama:

1. WAR adalah deployment contract, bukan sekadar archive.
2. Servlet container memiliki HTTP runtime dan servlet lifecycle.
3. Jersey masuk melalui `ServletContainer` atau filter.
4. Context path, servlet mapping, application path, dan resource path harus dipahami sebagai komposisi.
5. Java 8/Jersey 2 menggunakan `javax.*`; Jersey 3/4 menggunakan `jakarta.*`.
6. Servlet API biasanya `provided` untuk external container.
7. Jersey runtime biasanya dibundel untuk plain Servlet container seperti Tomcat.
8. Full Jakarta EE server butuh keputusan eksplisit apakah runtime REST disediakan server atau aplikasi.
9. `web.xml` tetap relevan untuk deployment yang butuh eksplisit dan auditable.
10. `ResourceConfig` sebaiknya menjadi composition root untuk aplikasi Jersey serius.
11. `load-on-startup` membantu fail-fast.
12. Classloader isolation adalah fitur sekaligus sumber bug.
13. WAR di Docker/Kubernetes tetap membawa seluruh konsekuensi Servlet container.
14. Production readiness harus mencakup compatibility, packaging, mapping, lifecycle, security, observability, dan operations.

---

## 46. Latihan Pemahaman

Jawab pertanyaan berikut tanpa melihat ulang materi:

1. Apa perbedaan context path, servlet path, dan resource path?
2. Kenapa `jakarta.servlet-api` biasanya tidak boleh ikut masuk `WEB-INF/lib` saat deploy ke Tomcat external?
3. Apa risiko menaruh library aplikasi di `$CATALINA_BASE/lib`?
4. Kapan `web.xml` lebih baik daripada `@ApplicationPath`?
5. Kenapa `load-on-startup` penting untuk production?
6. Apa bedanya deploy Jersey WAR ke Tomcat vs Payara?
7. Bagaimana cara mendiagnosis 404 semua endpoint setelah deploy?
8. Apa hubungan nama WAR dengan context path?
9. Kenapa WAR di Docker belum otomatis cloud-native?
10. Apa saja resource yang harus ditutup saat undeploy?

---

## 47. Referensi

- Eclipse Jersey Documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/deployment.html
- Eclipse Jersey Documentation — Modules and Dependencies: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/modules-and-dependencies.html
- Apache Tomcat 10.1 Documentation — Class Loader How-To: https://tomcat.apache.org/tomcat-10.1-doc/class-loader-howto.html
- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/
- Jakarta RESTful Web Services 4.0 Specification: https://jakarta.ee/specifications/restful-ws/4.0/
- Eclipse Jersey 4.0.0 Release Information: https://projects.eclipse.org/projects/ee4j.jersey/releases/4.0.0

---

## 48. Status Seri

Part 4 selesai.

Seri belum selesai. Berikutnya:

**Part 5 — Jersey as Servlet: `ServletContainer` Deep Dive**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-003.md">⬅️ Part 3 — The Hosting Contract: Bagaimana Request Masuk ke Jersey</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-005.md">Part 5 — Jersey as Servlet: `ServletContainer` Deep Dive ➡️</a>
</div>
