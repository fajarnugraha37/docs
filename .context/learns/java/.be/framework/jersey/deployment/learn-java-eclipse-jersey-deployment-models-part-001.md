# learn-java-eclipse-jersey-deployment-models-part-001

# Part 1 — Version Matrix: Java 8–25, Jersey 2.x/3.x/4.x, `javax.*` vs `jakarta.*`

> Seri: **Java Eclipse Jersey Deployment Models**  
> Target pembaca: engineer yang sudah memahami Java, Jakarta/JAX-RS, servlet, HTTP, build tooling, runtime, observability, dan deployment dasar, lalu ingin naik ke level arsitektur deployment yang presisi.  
> Fokus part ini: membuat peta kompatibilitas yang benar sebelum memilih deployment model Jersey.

---

## 1. Tujuan Part Ini

Part 0 membentuk mental model bahwa Jersey bukan server, melainkan runtime Jakarta REST/JAX-RS yang harus ditempelkan ke hosting model tertentu.

Part ini menjawab pertanyaan yang jauh lebih praktis:

> Kalau aplikasi memakai Java 8, 11, 17, 21, atau 25, Jersey versi berapa yang masuk akal, namespace mana yang dipakai, container apa yang kompatibel, dan deployment model mana yang aman?

Tanpa version matrix yang benar, banyak masalah deployment Jersey terlihat seperti bug aplikasi, padahal akar masalahnya adalah kombinasi versi yang salah.

Contoh masalah nyata:

```text
java.lang.ClassNotFoundException: javax.ws.rs.core.Application
java.lang.ClassNotFoundException: jakarta.ws.rs.core.Application
java.lang.NoSuchMethodError: jakarta.servlet.ServletContext.getVirtualServerName()
java.lang.LinkageError: loader constraint violation
java.lang.NoClassDefFoundError: org/glassfish/jersey/server/ResourceConfig
java.lang.IllegalStateException: InjectionManagerFactory not found
404 padahal resource class ada
500 saat startup karena provider duplicate
```

Kesalahan seperti ini hampir selalu berasal dari satu dari lima hal:

1. Java runtime terlalu tua atau terlalu baru untuk library/container yang dipilih.
2. Jersey major version tidak cocok dengan namespace API (`javax.*` vs `jakarta.*`).
3. Servlet container tidak cocok dengan Servlet API yang dipakai.
4. Dependency aplikasi membundel API/implementation yang seharusnya disediakan container.
5. Deployment model tidak sesuai dengan lifecycle dan classloading runtime.

Part ini membangun peta agar keputusan tidak dibuat berdasarkan hafalan versi, tetapi berdasarkan prinsip kompatibilitas.

---

## 2. Big Picture: Empat Sumbu Kompatibilitas

Setiap deployment Jersey harus dievaluasi lewat empat sumbu:

```text
┌──────────────────────────────────────────────────────────────┐
│                    JERSEY DEPLOYMENT STACK                   │
├──────────────────────────────────────────────────────────────┤
│  1. Java Runtime       Java 8 / 11 / 17 / 21 / 25             │
│  2. REST API Namespace javax.ws.rs.* / jakarta.ws.rs.*        │
│  3. Jersey Runtime     Jersey 2.x / 3.x / 4.x                 │
│  4. Hosting Runtime    Servlet / Jakarta EE / Embedded / K8s  │
└──────────────────────────────────────────────────────────────┘
```

Jangan hanya bertanya:

> Kita pakai Jersey versi berapa?

Pertanyaan yang lebih benar:

> Kombinasi Java, REST API namespace, Servlet API, Jersey implementation, DI/runtime dependency, container, packaging, dan operational model apa yang dipakai?

Jersey deployment adalah **matrix problem**, bukan satu-dimensional version choice.

---

## 3. Sejarah Singkat yang Penting untuk Deployment

Untuk memahami matrix modern, kita perlu memahami evolusi ekosistemnya.

### 3.1 Era Java EE / JAX-RS / `javax.*`

Awalnya spesifikasi REST di Java dikenal sebagai **JAX-RS** dan berada di namespace:

```java
javax.ws.rs.*
```

Contoh:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;

@Path("/hello")
public class HelloResource {
    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String hello() {
        return "hello";
    }
}
```

Ini adalah dunia:

```text
Java EE
JAX-RS
Servlet javax.servlet.*
Jersey 2.x
Java 8-compatible legacy estate
```

Untuk banyak enterprise system lama, kombinasi ini masih hidup karena Java 8 dan Java EE container lama masih digunakan.

### 3.2 Era Jakarta EE / Jakarta REST / `jakarta.*`

Setelah transisi dari Java EE ke Jakarta EE, namespace berubah dari:

```text
javax.*
```

menjadi:

```text
jakarta.*
```

Untuk REST API:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/hello")
public class HelloResource {
    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String hello() {
        return "hello";
    }
}
```

Untuk servlet:

```text
javax.servlet.*     -> Jakarta EE lama / Java EE / Servlet 4 ke bawah
jakarta.servlet.*   -> Jakarta EE 9+ / Servlet 5+
```

Perubahan ini bukan sekadar rename kosmetik. Ini adalah **binary incompatibility boundary**.

Artinya:

```text
Class yang dikompilasi terhadap javax.ws.rs.Path
TIDAK SAMA dengan
Class yang dikompilasi terhadap jakarta.ws.rs.Path
```

Walaupun nama class akhirnya mirip, JVM melihatnya sebagai dua type yang benar-benar berbeda.

---

## 4. Jersey Major Version Mental Model

Secara praktis, deployment Jersey modern dapat dipetakan seperti ini:

```text
┌────────────┬───────────────┬────────────────────┬──────────────────────────────┐
│ Jersey     │ REST Namespace│ Typical Java Baseline│ Typical Platform Alignment  │
├────────────┼───────────────┼────────────────────┼──────────────────────────────┤
│ 2.x        │ javax.ws.rs.* │ Java 8+             │ Java EE / Jakarta EE 8 era   │
│ 3.0.x      │ jakarta.ws.rs.*│ Java 8/11+ lineage* │ Jakarta EE 9 namespace shift │
│ 3.1.x      │ jakarta.ws.rs.*│ JDK 11+ documented  │ Jakarta EE 10               │
│ 4.x        │ jakarta.ws.rs.*│ Java 17+ platform   │ Jakarta EE 11 / REST 4.0    │
└────────────┴───────────────┴────────────────────┴──────────────────────────────┘
```

Catatan penting:

- Untuk keputusan production, jangan hanya membaca satu angka versi Jersey.
- Lihat dokumentasi release line yang spesifik.
- Lihat juga container runtime: Tomcat/Jetty/GlassFish/Payara/Open Liberty/WildFly bisa punya baseline dan API level berbeda.
- Untuk Java 8 estate, Jersey 2.x biasanya menjadi pilihan realistis.
- Untuk Jakarta EE 10, Jersey 3.1.x adalah line yang relevan.
- Untuk Jakarta EE 11 / Jakarta REST 4.0, Jersey 4.x adalah line yang relevan.

---

## 5. Java Version sebagai Deployment Constraint

Java version bukan hanya soal syntax. Dalam deployment, Java version memengaruhi:

1. Bytecode target.
2. TLS provider dan cipher behavior.
3. GC behavior.
4. Container memory ergonomics.
5. Reflection/module restrictions.
6. Virtual thread availability.
7. Observability tooling.
8. Base image availability.
9. Vendor support and patch lifecycle.
10. Library baseline compatibility.

### 5.1 Java 8

Java 8 adalah baseline legacy yang masih sangat umum di enterprise.

Ciri deployment:

```text
- Tidak ada module system.
- Tidak ada var, record, sealed class, virtual thread.
- Banyak Java EE / javax-era library masih kompatibel.
- Banyak container lama masih Java 8-compatible.
- Runtime security patch lifecycle harus diperhatikan secara serius.
```

Untuk Jersey:

```text
Java 8 + Jersey 2.x + javax.ws.rs.*
```

adalah kombinasi paling umum.

Deployment model yang masuk akal:

```text
- WAR di Tomcat 8.5/9 atau Jetty 9/10 sesuai dependency.
- WAR di GlassFish/Payara versi lama.
- Embedded Grizzly/Jetty dengan Jersey 2.x.
- Fat jar manual untuk service internal.
```

Anti-pattern:

```text
Java 8 + Jersey 4.x
Java 8 + Jakarta REST 4.0
Java 8 + Jakarta EE 11 container
Java 8 + Servlet 6.x expectation
```

Java 8 estate sebaiknya diperlakukan sebagai **legacy compatibility island**. Jangan mencampur dependency modern secara acak.

### 5.2 Java 11

Java 11 adalah LTS pertama setelah Java 8 yang banyak dipakai untuk modernisasi awal.

Ciri deployment:

```text
- Module system sudah ada sejak Java 9.
- Java EE modules seperti JAXB tidak lagi bundled seperti era lama.
- Banyak library enterprise mulai menaikkan baseline ke 11.
- Lebih cocok untuk containerized deployment dibanding Java 8.
```

Untuk Jersey:

```text
Java 11 + Jersey 2.x   -> masih mungkin untuk javax estate.
Java 11 + Jersey 3.x   -> masuk akal untuk jakarta estate.
```

Deployment model yang masuk akal:

```text
- Servlet container modern.
- Embedded Grizzly/Jetty.
- Docker/Kubernetes runtime.
- Transitional migration from javax to jakarta.
```

Java 11 sering menjadi jembatan migrasi:

```text
Phase A: Java 8 + Jersey 2.x + javax
Phase B: Java 11 + Jersey 2.x + javax
Phase C: Java 11/17 + Jersey 3.x + jakarta
```

Yang penting: jangan menggabungkan upgrade Java dan namespace migration tanpa test strategy kuat.

### 5.3 Java 17

Java 17 adalah LTS penting untuk Jakarta EE 10/11 ecosystem dan baseline modern banyak framework.

Ciri deployment:

```text
- Stronger encapsulation semakin terasa.
- Container support lebih matang.
- Records, sealed classes, modern language features tersedia.
- Banyak server runtime modern menjadikan Java 17 sebagai baseline.
```

Untuk Jersey:

```text
Java 17 + Jersey 3.1.x -> sangat masuk akal untuk Jakarta EE 10.
Java 17 + Jersey 4.x   -> masuk akal untuk Jakarta EE 11/Jakarta REST 4.0.
```

Deployment model yang masuk akal:

```text
- Jakarta EE 10/11 server.
- Servlet 6.x-capable runtime sesuai line.
- Containerized Kubernetes deployment.
- Modern observability stack.
```

Java 17 adalah baseline yang sering paling sehat untuk modern enterprise.

### 5.4 Java 21

Java 21 adalah LTS yang membawa virtual threads sebagai fitur final.

Ciri deployment:

```text
- Virtual threads tersedia.
- GC modern dan container ergonomics lebih matang.
- Cocok untuk high-concurrency blocking server workloads jika runtime mendukung modelnya.
- Banyak organisasi menargetkan Java 21 sebagai modern LTS sebelum Java 25.
```

Untuk Jersey:

```text
Java 21 + Jersey 3.1.x
Java 21 + Jersey 4.x
```

Keduanya bisa masuk akal tergantung platform target.

Hal penting:

> Menggunakan Java 21 tidak otomatis membuat Jersey request handler berjalan di virtual thread.

Virtual thread harus dipahami di level hosting runtime:

```text
- Apakah servlet container mendukung virtual-thread executor?
- Apakah Jersey integration menghormati executor tersebut?
- Apakah resource method melakukan blocking IO?
- Apakah driver DB, HTTP client, dan logging sink aman terhadap concurrency tinggi?
```

### 5.5 Java 25

Java 25 adalah LTS modern setelah Java 21. Dalam konteks seri ini, Java 25 harus dilihat sebagai target deployment masa depan untuk stack yang sudah modern.

Untuk Jersey:

```text
Java 25 + Jersey 3.1.x -> mungkin secara runtime jika dependency kompatibel, tetapi bukan target platform semantik terbaru.
Java 25 + Jersey 4.x   -> lebih natural untuk Jakarta EE 11/Jakarta REST 4.0 direction.
```

Risiko Java 25 bukan biasanya di source code JAX-RS sederhana, tetapi di:

```text
- Container belum tersertifikasi/teruji penuh.
- Library lama menggunakan reflection illegal.
- Bytecode manipulation library belum kompatibel.
- Build plugin lama gagal.
- Docker base image belum distandardisasi di organisasi.
- Observability/profiler/security agent belum support.
```

Prinsipnya:

```text
Untuk Java 25, validasi bukan hanya compile test.
Validasi harus mencakup boot, request path, injection, JSON, TLS, metrics, tracing,
thread dump, heap dump, redeploy, shutdown, and container probes.
```

---

## 6. Namespace Boundary: `javax.*` vs `jakarta.*`

Ini adalah bagian paling penting dalam deployment Jersey modern.

### 6.1 JVM Melihat Namespace sebagai Type Berbeda

Kode ini:

```java
import javax.ws.rs.Path;

@Path("/users")
public class UserResource {}
```

berbeda total dari:

```java
import jakarta.ws.rs.Path;

@Path("/users")
public class UserResource {}
```

Jersey runtime yang mencari annotation `jakarta.ws.rs.Path` tidak akan memperlakukan `javax.ws.rs.Path` sebagai annotation yang sama.

Maka masalah berikut bisa muncul:

```text
Resource class ada.
Annotation @Path ada.
Build sukses.
Deployment sukses sebagian.
Tetapi endpoint 404.
```

Kenapa?

Karena runtime mencari annotation namespace lain.

### 6.2 Contoh Mismatch

#### Case A — Jersey 3.x dengan resource `javax.ws.rs.*`

```text
Runtime: Jersey 3.x
Expected annotation: jakarta.ws.rs.Path
Application resource: javax.ws.rs.Path
Result: Resource tidak terdeteksi sebagai Jakarta REST resource.
```

#### Case B — Jersey 2.x dengan resource `jakarta.ws.rs.*`

```text
Runtime: Jersey 2.x
Expected annotation: javax.ws.rs.Path
Application resource: jakarta.ws.rs.Path
Result: Resource tidak terdeteksi.
```

#### Case C — Servlet container `javax.servlet.*` dengan app `jakarta.servlet.*`

```text
Container: Tomcat 9 / Servlet 4 / javax.servlet
App: Jersey 3/4 servlet integration requiring jakarta.servlet
Result: ClassNotFoundException / NoClassDefFoundError / deployment failure.
```

#### Case D — Servlet container `jakarta.servlet.*` dengan app `javax.servlet.*`

```text
Container: Tomcat 10+ / Servlet 5+ / jakarta.servlet
App: Jersey 2.x servlet artifact for javax servlet
Result: servlet class/API mismatch.
```

### 6.3 Rule of Thumb

```text
Jersey 2.x  -> javax.ws.rs.*  -> javax.servlet.* container line
Jersey 3.x  -> jakarta.ws.rs.* -> jakarta.servlet.* container line
Jersey 4.x  -> jakarta.ws.rs.* -> Jakarta REST 4.0 / Jakarta EE 11 line
```

Jangan pernah mencampur `javax.ws.rs` dan `jakarta.ws.rs` dalam satu application boundary kecuali sedang menjalankan transitional adapter yang sangat eksplisit.

---

## 7. Servlet API Matrix

Untuk Jersey deployment berbasis servlet, REST namespace belum cukup. Kita juga harus cocok dengan Servlet namespace.

```text
┌──────────────┬───────────────────┬──────────────────────┬────────────────────┐
│ Servlet Era  │ Servlet Namespace │ Typical Containers    │ Jersey Fit         │
├──────────────┼───────────────────┼──────────────────────┼────────────────────┤
│ Servlet 3.x  │ javax.servlet.*   │ Tomcat 7/8            │ Jersey 2.x         │
│ Servlet 4.x  │ javax.servlet.*   │ Tomcat 9              │ Jersey 2.x         │
│ Servlet 5.x  │ jakarta.servlet.* │ Tomcat 10.0           │ Jersey 3.0.x       │
│ Servlet 6.x  │ jakarta.servlet.* │ Tomcat 10.1+, modern  │ Jersey 3.1.x/4.x*  │
└──────────────┴───────────────────┴──────────────────────┴────────────────────┘
```

Catatan:

- Matrix container harus dicek per versi, bukan hanya nama produk.
- Tomcat 9 dan Tomcat 10 berbeda besar karena namespace servlet berubah.
- “Jetty” juga harus dicek versi major-nya.
- Jakarta EE server seperti GlassFish/Payara/Open Liberty/WildFly membawa platform API set sendiri.

### 7.1 WAR Deployment Requires Container API Alignment

WAR deployment berarti aplikasi Anda hidup di bawah classloader container.

Maka ada pertanyaan penting:

```text
Apakah API jar disediakan container atau dibundel aplikasi?
```

Untuk WAR di full container:

```xml
<dependency>
    <groupId>jakarta.ws.rs</groupId>
    <artifactId>jakarta.ws.rs-api</artifactId>
    <version>...</version>
    <scope>provided</scope>
</dependency>
```

Sering kali API scope `provided` masuk akal karena container menyediakan API.

Tetapi untuk embedded/fat jar:

```xml
<scope>provided</scope>
```

bisa menjadi salah, karena tidak ada container eksternal yang menyediakan API.

Inilah kenapa version matrix harus mempertimbangkan deployment model.

---

## 8. Jersey Runtime Line by Line

### 8.1 Jersey 2.x

Jersey 2.x adalah line penting untuk `javax.ws.rs.*`.

Typical use:

```text
- Java 8 legacy apps.
- Java EE 7/8 style environments.
- Servlet 3.x/4.x containers.
- Tomcat 8.5/9.
- Legacy GlassFish/Payara/WildFly era.
```

Source code:

```java
import javax.ws.rs.ApplicationPath;
import javax.ws.rs.core.Application;

@ApplicationPath("/api")
public class MyApplication extends Application {
}
```

Resource:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;

@Path("/health")
public class HealthResource {
    @GET
    public String health() {
        return "OK";
    }
}
```

Typical Maven dependency for servlet deployment:

```xml
<dependency>
    <groupId>org.glassfish.jersey.containers</groupId>
    <artifactId>jersey-container-servlet-core</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Depending on use case, you may need:

```xml
<dependency>
    <groupId>org.glassfish.jersey.inject</groupId>
    <artifactId>jersey-hk2</artifactId>
    <version>${jersey.version}</version>
</dependency>
```

Mental model:

```text
Jersey 2.x = correct answer when the surrounding world is still javax.
```

### 8.2 Jersey 3.0.x

Jersey 3.0.x is the first Jakarta namespace line.

Typical use:

```text
- Jakarta EE 9 namespace transition.
- First-generation jakarta.ws.rs migration.
- Servlet 5 / jakarta.servlet runtime.
```

Source code:

```java
import jakarta.ws.rs.ApplicationPath;
import jakarta.ws.rs.core.Application;

@ApplicationPath("/api")
public class MyApplication extends Application {
}
```

Resource:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/health")
public class HealthResource {
    @GET
    public String health() {
        return "OK";
    }
}
```

Mental model:

```text
Jersey 3.0.x = namespace migration line.
```

Use it when you must align with Jakarta EE 9-era runtime, but be careful if you can target newer 3.1.x/4.x instead.

### 8.3 Jersey 3.1.x

Jersey 3.1.x aligns with Jakarta EE 10 / Jakarta REST 3.1 era.

Typical use:

```text
- Java 11+ documented compatibility line.
- Jakarta EE 10 application servers.
- Servlet 6.0-capable ecosystem depending on runtime.
- Modern containerized services that are not yet Jakarta EE 11.
```

Mental model:

```text
Jersey 3.1.x = stable modern Jakarta REST line before Jakarta EE 11.
```

This is often the practical default for modern apps unless you explicitly target Jakarta EE 11/Jersey 4.

### 8.4 Jersey 4.x

Jersey 4.x aligns with Jakarta REST 4.0 / Jakarta EE 11.

Typical use:

```text
- Java 17+ platform expectation.
- Jakarta EE 11 server/runtime alignment.
- New applications targeting latest Jakarta EE line.
- Organizations ready to validate container/library ecosystem.
```

Mental model:

```text
Jersey 4.x = Jakarta EE 11 / REST 4.0 generation.
```

For conservative enterprise deployment, Jersey 4.x requires stronger platform validation than Jersey 3.1.x because the ecosystem is newer.

---

## 9. Deployment Model Matrix

Now combine Jersey line with deployment model.

### 9.1 WAR on External Servlet Container

```text
┌──────────────┬───────────────┬──────────────────────┬──────────────────────────┐
│ Java         │ Jersey        │ Container             │ Recommendation           │
├──────────────┼───────────────┼──────────────────────┼──────────────────────────┤
│ 8            │ 2.x           │ Tomcat 8.5/9          │ Common legacy-safe path   │
│ 11           │ 2.x           │ Tomcat 9              │ Transitional javax path   │
│ 11/17        │ 3.0/3.1       │ Tomcat 10/10.1        │ Jakarta migration path    │
│ 17/21/25     │ 3.1           │ Modern Servlet 6 line  │ Stable modern path        │
│ 17/21/25     │ 4.x           │ Jakarta EE 11 runtime  │ Latest platform path      │
└──────────────┴───────────────┴──────────────────────┴──────────────────────────┘
```

The key is not Tomcat/Jetty name alone, but Servlet API line.

### 9.2 Embedded Server

Embedded deployment means your app owns the server lifecycle.

```text
main() -> create ResourceConfig -> create server -> start -> block -> shutdown
```

Example conceptual structure:

```java
public final class Main {
    public static void main(String[] args) throws Exception {
        ResourceConfig config = new ResourceConfig()
                .packages("com.example.api");

        // server bootstrap depends on Grizzly/Jetty/Netty/JDK HTTP module
        Server server = startServer(config);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop();
        }));

        Thread.currentThread().join();
    }
}
```

Matrix:

```text
┌──────────────┬───────────────┬───────────────────────────────┐
│ Java         │ Jersey        │ Embedded Model                │
├──────────────┼───────────────┼───────────────────────────────┤
│ 8            │ 2.x           │ Grizzly/Jetty/JDK HTTP legacy │
│ 11           │ 2.x/3.x       │ Transitional                  │
│ 17/21        │ 3.1/4.x       │ Modern embedded               │
│ 25           │ 4.x preferred │ Validate all agents/plugins   │
└──────────────┴───────────────┴───────────────────────────────┘
```

Embedded is powerful because it removes external container ambiguity, but it moves responsibility to your code:

```text
- port binding
- TLS
- thread pool
- graceful shutdown
- health endpoint
- access log
- static assets
- compression
- max request size
- startup failure handling
```

### 9.3 Jakarta EE Server

In Jakarta EE server deployment, the server provides a large part of platform services.

```text
Application code delegates to container for:
- REST runtime integration
- CDI
- transactions
- security
- naming/JNDI
- managed executor
- resource injection
- lifecycle
```

Matrix:

```text
┌──────────────┬───────────────┬───────────────────────────┐
│ Platform     │ REST API      │ Jersey Line               │
├──────────────┼───────────────┼───────────────────────────┤
│ Java EE 8    │ javax.ws.rs   │ Jersey 2.x                │
│ Jakarta EE 9 │ jakarta.ws.rs │ Jersey 3.0.x              │
│ Jakarta EE 10│ jakarta.ws.rs │ Jersey 3.1.x              │
│ Jakarta EE 11│ jakarta.ws.rs │ Jersey 4.x                │
└──────────────┴───────────────┴───────────────────────────┘
```

The failure mode here is usually **double implementation**:

```text
Container already provides REST implementation,
but application bundles another Jersey implementation version.
```

This can cause:

```text
- classloader conflict
- provider loaded twice
- CDI bridge mismatch
- HK2/CDI confusion
- NoSuchMethodError
- endpoint not registered
```

### 9.4 Docker/Kubernetes

Docker/Kubernetes are not REST API platforms. They wrap your chosen runtime.

```text
Kubernetes does not decide javax vs jakarta.
Docker does not decide Servlet API.
```

But they affect:

```text
- startup time
- memory limit
- CPU quota
- signal handling
- shutdown grace period
- readiness/liveness probes
- log format
- config injection
- secret injection
- rolling deployment
```

Matrix thinking:

```text
Java version + Jersey line + hosting runtime + image base + orchestration behavior
```

Example:

```text
Java 21 + Jersey 3.1 + embedded Jetty + Docker + Kubernetes
```

is completely different operationally from:

```text
Java 21 + Jersey 3.1 + WAR + external Tomcat + VM deployment
```

Even if resource classes are identical.

---

## 10. Dependency Scope Matrix

Deployment mistakes often happen in Maven/Gradle scope.

### 10.1 API Dependency

For compile-time API:

```xml
<dependency>
    <groupId>jakarta.ws.rs</groupId>
    <artifactId>jakarta.ws.rs-api</artifactId>
    <version>${jakarta-rest.version}</version>
</dependency>
```

or legacy:

```xml
<dependency>
    <groupId>javax.ws.rs</groupId>
    <artifactId>javax.ws.rs-api</artifactId>
    <version>${jaxrs.version}</version>
</dependency>
```

But scope depends on deployment model:

```text
WAR on full Jakarta EE server:
  API often provided by server.

WAR on bare servlet container:
  servlet API provided by container, but Jersey implementation may be app-bundled.

Embedded/fat jar:
  app must include everything required at runtime.
```

### 10.2 Servlet API Scope

WAR on Tomcat:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>${servlet.version}</version>
    <scope>provided</scope>
</dependency>
```

Embedded Jetty/Grizzly:

```text
Do not blindly mark server/runtime dependencies as provided.
```

### 10.3 Jersey Implementation Scope

Bare servlet container usually needs Jersey implementation bundled with app:

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

Full Jakarta EE server may already provide implementation or integrate one. Bundling another can be risky.

Rule:

```text
Know exactly who owns each layer:
- API jar owner
- implementation jar owner
- servlet runtime owner
- DI bridge owner
- JSON provider owner
```

---

## 11. Classloading Matrix

Different deployment models imply different classloading behavior.

### 11.1 External Servlet Container

WAR structure:

```text
my-app.war
├── WEB-INF/
│   ├── classes/
│   │   └── com/example/...
│   └── lib/
│       ├── jersey-*.jar
│       ├── jackson-*.jar
│       └── app-dependency.jar
└── index.html
```

Classloading boundary:

```text
Container classloader
  -> shared libraries
  -> webapp classloader
       -> WEB-INF/classes
       -> WEB-INF/lib
```

Problems:

```text
- Same API class loaded from parent and child.
- Container has old Jersey, app bundles new Jersey.
- Shared lib folder contains stale javax jar.
- App bundles jakarta jar on javax container.
```

### 11.2 Embedded/Fat Jar

Fat jar structure:

```text
app.jar
├── application classes
├── Jersey classes
├── HTTP server classes
├── JSON provider classes
└── dependencies
```

Classloading is simpler but packaging risk increases:

```text
- service loader metadata merge required
- duplicate META-INF/services entries
- shaded classes can break provider discovery
- signature files can break jar verification
- reflection config can be missed for native image
```

### 11.3 JPMS / Module Path

Java 9+ introduces module path.

Most enterprise Jersey deployments still use classpath, but Java 17/21/25 teams increasingly hit:

```text
- automatic module names
- split packages
- reflective access warnings/errors
- service provider discovery differences
```

For production deployment:

```text
Do not accidentally switch from classpath to module path without a compatibility test.
```

Build tools, IDE, test runner, and production launcher must agree.

---

## 12. Provider Discovery Compatibility

Jersey detects and uses providers such as:

```text
- MessageBodyReader
- MessageBodyWriter
- ExceptionMapper
- ContainerRequestFilter
- ContainerResponseFilter
- Feature
- DynamicFeature
- ParamConverterProvider
```

Provider discovery depends on:

```text
- package scanning
- explicit registration
- classpath visibility
- META-INF/services
- HK2/CDI integration
- annotation namespace
```

Version mismatch can cause providers not to load.

Example:

```java
import javax.ws.rs.ext.Provider;

@Provider
public class MyExceptionMapper implements ExceptionMapper<Throwable> {
    ...
}
```

If runtime expects:

```java
jakarta.ws.rs.ext.Provider
```

then provider may not be recognized.

Top-tier deployment practice:

```text
Do not rely purely on magical scanning for critical providers.
Explicitly register critical providers in ResourceConfig/Application.
```

Example:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(GlobalExceptionMapper.class);
        register(JsonFeature.class);
        register(CorrelationIdFilter.class);
    }
}
```

This makes version and boot errors more obvious.

---

## 13. JSON Provider Matrix

REST deployment is rarely Jersey only. JSON binding matters.

Common options:

```text
- Jackson
- JSON-B
- MOXy
```

Legacy combinations:

```text
Jersey 2.x + Jackson javax line
Jersey 2.x + MOXy old Java EE style
```

Modern combinations:

```text
Jersey 3.x/4.x + Jakarta-compatible Jackson/Jakarta modules
Jersey 3.x/4.x + JSON-B provider aligned with Jakarta EE runtime
```

Failure examples:

```text
MessageBodyWriter not found for media type application/json
No serializer found
ClassNotFoundException for jakarta.json.bind.Jsonb
NoSuchMethodError from mismatched Jackson module
```

Deployment implication:

```text
Your version matrix must include serialization provider, not only Jersey core.
```

A healthy compatibility matrix includes:

```text
Java version
Jersey version
REST API version
Servlet API version
JSON provider version
DI provider version
Container version
Build plugin version
Test runtime version
```

---

## 14. DI Matrix: HK2, CDI, and Container Management

Jersey historically uses HK2 for injection internally, while Jakarta EE applications often use CDI.

Potential models:

```text
- Jersey standalone + HK2
- Jersey + CDI bridge
- Jakarta EE server-managed CDI
- Spring integration in hybrid apps
```

Deployment issues:

```text
InjectionManagerFactory not found
Unsatisfied dependency
CDI bean not visible to Jersey resource
Jersey creates resource but CDI expected to create it
Request scope not active
```

Mental model:

```text
Resource ownership must be clear.
```

Ask:

```text
Who constructs resource instances?
- Jersey/HK2?
- CDI container?
- Spring?
- Manual factory?
```

If ownership is unclear, deployment may succeed but runtime behavior is wrong.

For deployment matrix, record:

```text
DI owner: HK2 / CDI / Spring / manual
Scope model: singleton / request / dependent / custom
Bridge dependency: yes/no
Container-managed resources: yes/no
```

---

## 15. Build Tool Matrix: Maven/Gradle and Bytecode

### 15.1 Java Release Flag

For Java 8 target:

```xml
<configuration>
    <release>8</release>
</configuration>
```

For Java 17:

```xml
<configuration>
    <release>17</release>
</configuration>
```

For Java 21:

```xml
<configuration>
    <release>21</release>
</configuration>
```

For Java 25:

```xml
<configuration>
    <release>25</release>
</configuration>
```

Do not confuse:

```text
source/target
```

with:

```text
release
```

`--release` ensures correct platform API targeting.

### 15.2 Bytecode Failure

If you compile with Java 21 and deploy on Java 17:

```text
UnsupportedClassVersionError
```

Example:

```text
class file has wrong version 65.0, should be 61.0
```

Meaning:

```text
65 = Java 21
61 = Java 17
```

Version matrix must include:

```text
Build JDK
Target release
Runtime JDK
Container JDK
CI test JDK
```

They are not always the same.

---

## 16. Compatibility Decision Recipes

### 16.1 Legacy Stable Java 8 System

Recommended shape:

```text
Java: 8
Jersey: 2.x
Namespace: javax.ws.rs.*
Servlet: javax.servlet.*
Container: Tomcat 8.5/9 or compatible Java EE/Jakarta EE 8 era runtime
Packaging: WAR or controlled embedded app
```

Avoid:

```text
- jakarta.* dependencies
- Jersey 3/4
- Servlet 5/6 container
- random library upgrades that move to jakarta namespace
```

Engineering posture:

```text
Stabilize, patch, isolate, and plan migration.
```

### 16.2 Java 11 Transitional System

Recommended shape A:

```text
Java: 11
Jersey: 2.x
Namespace: javax.ws.rs.*
Goal: Java runtime upgrade first
```

Recommended shape B:

```text
Java: 11/17
Jersey: 3.x
Namespace: jakarta.ws.rs.*
Goal: namespace migration
```

Avoid doing both without staging:

```text
Java 8 -> 17
Jersey 2 -> 3
javax -> jakarta
Tomcat 9 -> 10
Jackson major upgrade
DI bridge change
```

all in one release.

### 16.3 Modern Java 17/21 System

Recommended shape:

```text
Java: 17 or 21
Jersey: 3.1.x
Namespace: jakarta.ws.rs.*
Platform: Jakarta EE 10-compatible or standalone modern servlet runtime
```

Alternative:

```text
Java: 17/21
Jersey: 4.x
Platform: Jakarta EE 11 target
```

Choose Jersey 4.x when you are intentionally aligning with Jakarta EE 11, not merely because it is newer.

### 16.4 Future-Oriented Java 25 System

Recommended shape:

```text
Java: 25
Jersey: 4.x preferred for new Jakarta EE 11-aligned applications
Namespace: jakarta.ws.rs.*
Deployment: containerized with strong validation
```

Validation must include:

```text
- build plugin compatibility
- container runtime compatibility
- observability agent compatibility
- JSON provider compatibility
- DI lifecycle compatibility
- load test
- shutdown test
- memory limit test
```

---

## 17. Migration Strategy Matrix

### 17.1 Bad Migration Strategy

```text
Before:
Java 8 + Jersey 2.x + javax + Tomcat 9

After:
Java 25 + Jersey 4.x + jakarta + Tomcat 11 + new Jackson + new DI + Kubernetes
```

This is risky because if it fails, you do not know which axis caused failure.

### 17.2 Better Migration Strategy

```text
Phase 1: Stabilize dependency tree on current runtime.
Phase 2: Upgrade Java runtime while keeping Jersey 2/javax.
Phase 3: Add compatibility tests around REST resources/providers.
Phase 4: Migrate source imports javax -> jakarta.
Phase 5: Move Jersey 2 -> Jersey 3.1 or 4 depending on target platform.
Phase 6: Move servlet container line.
Phase 7: Validate deployment lifecycle, observability, and shutdown.
Phase 8: Optimize performance and container packaging.
```

This isolates failures.

### 17.3 Migration Test Checklist

At minimum:

```text
- Every resource path registered.
- Every HTTP method works.
- JSON read/write works.
- ExceptionMapper works.
- Filters execute in correct order.
- Auth integration works.
- Multipart works if used.
- Streaming works if used.
- OpenAPI generation works if used.
- CDI/HK2 injection works.
- Startup fails fast if required provider missing.
- Shutdown releases resources.
```

---

## 18. Decision Framework

Use this as a practical decision algorithm.

### Step 1 — Identify Namespace

```text
Does source code import javax.ws.rs.*?
  -> You are in JAX-RS/javax world.

Does source code import jakarta.ws.rs.*?
  -> You are in Jakarta REST world.
```

### Step 2 — Identify Jersey Line

```text
javax.ws.rs.*
  -> Jersey 2.x

jakarta.ws.rs.* + Jakarta EE 9/10
  -> Jersey 3.x

jakarta.ws.rs.* + Jakarta EE 11 / REST 4.0
  -> Jersey 4.x
```

### Step 3 — Identify Servlet Namespace

```text
javax.servlet.*
  -> Servlet 4 or below, Tomcat 9 or older line

jakarta.servlet.*
  -> Servlet 5+, Tomcat 10+ line
```

### Step 4 — Identify Container Ownership

```text
Full Jakarta EE server?
  -> container may provide REST implementation and APIs.

Bare servlet container?
  -> app likely bundles Jersey implementation.

Embedded server?
  -> app owns everything.
```

### Step 5 — Identify Java Runtime

```text
Java 8?
  -> legacy javax; avoid modern jakarta platform.

Java 11?
  -> transitional; decide whether migration or runtime-only upgrade.

Java 17/21?
  -> modern; Jersey 3.1 or 4 depending platform.

Java 25?
  -> future LTS; validate entire toolchain.
```

### Step 6 — Validate Dependency Tree

```bash
mvn dependency:tree
```

Look for mixed namespaces:

```text
javax.ws.rs-api + jakarta.ws.rs-api together
javax.servlet-api + jakarta.servlet-api together
Jersey 2.x + Jersey 3.x/4.x together
old Jackson + Jakarta provider mismatch
old HK2 with new Jersey
```

### Step 7 — Validate Runtime Boot

Do not trust compile success.

Test:

```text
- boot logs
- registered resources
- registered providers
- sample request
- error mapper
- JSON serialization
- shutdown
```

---

## 19. Diagnostic Patterns

### 19.1 `ClassNotFoundException: javax.ws.rs...`

Likely causes:

```text
- App compiled for javax but runtime only has jakarta API.
- Missing javax.ws.rs-api in embedded deployment.
- Wrong scope provided in fat jar.
```

### 19.2 `ClassNotFoundException: jakarta.ws.rs...`

Likely causes:

```text
- App compiled for jakarta but runtime only has javax-era APIs.
- Deploying Jersey 3/4 app to old container.
- Dependency scope removes jakarta API at runtime.
```

### 19.3 `ClassNotFoundException: jakarta.servlet...`

Likely causes:

```text
- Jersey 3/4 servlet artifact deployed to Tomcat 9 or older.
- Container is javax.servlet era.
```

### 19.4 Endpoint 404 but Resource Exists

Likely causes:

```text
- Wrong namespace annotation.
- Resource package not scanned.
- Application subclass not registered.
- Servlet mapping wrong.
- Context path misunderstood.
- Reverse proxy strips prefix differently.
```

### 19.5 `NoSuchMethodError`

Likely causes:

```text
- Mixed jar versions.
- Container-provided API older than app expects.
- Dependency convergence failure.
- Parent classloader loads different version.
```

### 19.6 Injection Failure

Likely causes:

```text
- Missing jersey-hk2.
- CDI bridge mismatch.
- Resource created by wrong container.
- Scope not active.
- Provider registered in wrong runtime.
```

---

## 20. Recommended Compatibility Records

For each service, maintain a `runtime-matrix.md`.

Example:

```markdown
# Runtime Matrix

| Dimension | Value |
|---|---|
| Build JDK | 21.0.x |
| Target release | 17 |
| Runtime JDK | 17.0.x |
| Jersey | 3.1.x |
| REST API | jakarta.ws.rs 3.1 |
| Servlet API | jakarta.servlet 6.0 |
| Container | Tomcat 10.1.x |
| Packaging | WAR |
| DI | HK2 + explicit binders |
| JSON | Jackson Jakarta-compatible provider |
| Deployment | Kubernetes |
| Health endpoint | /api/health |
| Graceful shutdown | container-managed + preStop |
```

This small file prevents months of future confusion.

---

## 21. Top 1% Engineer Perspective

A top-tier engineer does not ask only:

> Which Jersey version is latest?

They ask:

```text
1. What compatibility island are we in?
2. What namespace boundary are we crossing?
3. Who owns the servlet API?
4. Who owns the REST implementation?
5. Who owns dependency injection?
6. What classloader sees what?
7. What is provided vs bundled?
8. What is the target Java bytecode?
9. What does production actually run?
10. How do we prove this matrix in CI/CD?
```

The difference between average and elite deployment engineering is not memorizing more version numbers. It is understanding the **compatibility surfaces** and building systems that make invalid combinations impossible.

---

## 22. Practical Matrix Templates

### 22.1 Legacy Java 8 Template

```text
Name: legacy-java8-javax
Java: 8
Jersey: 2.x
REST API: javax.ws.rs
Servlet API: javax.servlet
Container: Tomcat 8.5/9 or equivalent
Packaging: WAR
DI: HK2 or legacy CDI integration
JSON: Jersey/Jackson/MOXy javax-compatible
Risk: security patching, old dependencies, migration debt
```

### 22.2 Transitional Java 11 Template

```text
Name: transition-java11-javax
Java: 11
Jersey: 2.x
REST API: javax.ws.rs
Servlet API: javax.servlet
Container: Tomcat 9
Packaging: WAR or embedded
Goal: upgrade runtime before namespace migration
Risk: JAXB/JDK module removal, old plugins
```

### 22.3 Jakarta EE 10 Template

```text
Name: modern-jakarta-ee10
Java: 17/21
Jersey: 3.1.x
REST API: jakarta.ws.rs 3.1
Servlet API: jakarta.servlet 6.0 line depending container
Container: Tomcat 10.1 / Jetty modern / Jakarta EE 10 server
Packaging: WAR, fat jar, or container image
Risk: mixed javax dependencies
```

### 22.4 Jakarta EE 11 Template

```text
Name: modern-jakarta-ee11
Java: 17/21/25
Jersey: 4.x
REST API: Jakarta REST 4.0
Servlet API: Jakarta EE 11 runtime line
Container: Jakarta EE 11-compatible runtime
Packaging: modern deployment
Risk: newer ecosystem, agent/tool compatibility
```

---

## 23. CI/CD Enforcement

A matrix is useless if not enforced.

### 23.1 Maven Enforcer

Use Maven Enforcer to prevent wrong Java version and dependency convergence failures.

Conceptual rules:

```xml
<rules>
    <requireJavaVersion>
        <version>[17,)</version>
    </requireJavaVersion>
    <dependencyConvergence />
</rules>
```

### 23.2 Ban Mixed Namespaces

Add build checks to fail if both appear:

```text
javax.ws.rs-api
jakarta.ws.rs-api
```

or:

```text
javax.servlet-api
jakarta.servlet-api
```

### 23.3 Dependency Tree Gate

CI should archive:

```bash
mvn dependency:tree -DoutputFile=target/dependency-tree.txt
```

and detect:

```text
- duplicate Jersey major versions
- duplicate servlet APIs
- old javax dependencies in jakarta branch
- wrong Jackson provider
```

### 23.4 Runtime Smoke Test

After packaging, run the artifact exactly as production would run it.

For WAR:

```text
Start target container.
Deploy WAR.
Call health endpoint.
Call JSON endpoint.
Call exception endpoint.
Stop container.
Assert clean shutdown.
```

For embedded:

```text
java -jar app.jar
curl /health
curl /api/sample
SIGTERM
assert process exits within grace period
```

---

## 24. Anti-Patterns

### Anti-Pattern 1 — “Latest Everything”

```text
Upgrade Java, Jersey, Servlet, Jackson, container, Docker base image, and deployment platform together.
```

Why bad:

```text
No failure isolation.
```

### Anti-Pattern 2 — Mixed `javax` and `jakarta`

```text
Some resources use javax.ws.rs.Path.
Some providers use jakarta.ws.rs.ext.Provider.
```

Why bad:

```text
Runtime discovery becomes inconsistent.
```

### Anti-Pattern 3 — Assuming Tomcat 9 and 10 Are Compatible

They are not namespace-compatible.

```text
Tomcat 9  -> javax.servlet
Tomcat 10 -> jakarta.servlet
```

### Anti-Pattern 4 — Blind `provided` Scope

```text
Works in IDE, fails in java -jar.
```

Why:

```text
Embedded runtime does not provide what WAR container provides.
```

### Anti-Pattern 5 — Bundling Jersey into Full Jakarta EE Server Without Reason

Why bad:

```text
Container may already provide REST implementation.
Bundling another runtime can create classloading conflict.
```

### Anti-Pattern 6 — Treating Compile Success as Deployment Success

Compile only proves type availability at build time.
Deployment requires:

```text
- classloading at runtime
- provider discovery
- servlet registration
- injection manager setup
- JSON provider registration
- request handling
```

---

## 25. What to Remember

The core lesson:

```text
Jersey deployment compatibility is governed by version alignment across Java,
REST namespace, Servlet namespace, Jersey runtime, hosting runtime, dependency scope,
classloading model, DI ownership, and packaging model.
```

Simple matrix:

```text
Java 8  -> Jersey 2.x -> javax.ws.rs -> javax.servlet-era container
Java 11 -> transitional; can run javax or jakarta depending migration path
Java 17 -> modern baseline; Jersey 3.1 or 4 depending Jakarta EE target
Java 21 -> modern LTS; consider virtual threads only with runtime support
Java 25 -> latest LTS direction; validate complete ecosystem
```

Namespace rule:

```text
javax != jakarta
```

Deployment rule:

```text
WAR, embedded, and Jakarta EE server deployments have different ownership boundaries.
```

Production rule:

```text
Do not choose a Jersey version. Choose a coherent deployment matrix.
```

---

## 26. References

- Eclipse Jersey Documentation — Deployment
- Eclipse Jersey Documentation — Modules and Dependencies
- Eclipse Jersey Project Releases
- Jakarta RESTful Web Services 4.0 Specification
- Jakarta EE 11 Platform Specification
- OpenJDK JDK 25 Project Page

---

## 27. Status Seri

Part ini adalah **Part 1 dari 32**.

Seri **belum selesai**.

Part berikutnya:

```text
Part 2 — Deployment Invariants: Apa yang Tidak Boleh Salah di Semua Model
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-000.md">⬅️ Part 0 — Orientation: Mental Model Deployment Jersey dari Java 8 sampai Java 25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-002.md">Part 2 — Deployment Invariants: Apa yang Tidak Boleh Salah di Semua Model ➡️</a>
</div>
