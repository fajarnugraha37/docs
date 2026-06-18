# learn-java-servlet-websocket-web-container-runtime-part-001

# Part 001 — Evolution: Java EE `javax.*` ke Jakarta EE `jakarta.*`

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Bagian: `001 / 031`  
> Fokus: evolusi platform, perubahan namespace, kompatibilitas runtime, dan strategi migrasi dari Java EE/`javax.*` menuju Jakarta EE/`jakarta.*` dalam konteks Servlet, WebSocket, JSP/Jakarta Pages, EL, dan web container.

---

## 0. Tujuan Bagian Ini

Bagian ini bukan sekadar sejarah Java EE berubah nama menjadi Jakarta EE. Tujuannya adalah membangun **mental model migrasi platform**.

Setelah bagian ini, kita ingin bisa menjawab pertanyaan-pertanyaan seperti:

1. Kenapa aplikasi lama memakai `javax.servlet.*`, sedangkan aplikasi modern memakai `jakarta.servlet.*`?
2. Apakah `javax.servlet.http.HttpServlet` dan `jakarta.servlet.http.HttpServlet` “sama saja”?
3. Kenapa upgrade dari Spring Boot 2 ke Spring Boot 3 sering pecah di banyak dependency?
4. Kenapa Tomcat 9 tidak bisa langsung menjalankan aplikasi `jakarta.servlet.*`?
5. Kenapa Tomcat 10 tidak bisa langsung menjalankan aplikasi `javax.servlet.*` tanpa transformation?
6. Apa bedanya Servlet 3.1, 4.0, 5.0, 6.0, dan 6.1?
7. Apa bedanya WebSocket 1.1, 2.0, 2.1, dan 2.2?
8. Bagaimana menyusun strategi migrasi yang aman untuk aplikasi enterprise legacy?
9. Apa invariants yang harus dicek agar runtime, framework, library, dan source code tidak saling bentrok?
10. Bagaimana cara membaca compatibility matrix web container tanpa terjebak versi marketing?

Core idea-nya:

> Migrasi `javax.*` ke `jakarta.*` bukan rename kosmetik. Ia adalah perubahan ABI/API boundary di seluruh ekosistem enterprise Java. Semua layer yang menyentuh Jakarta EE API harus berada pada “sisi namespace” yang sama.

---

## 1. Big Picture: Apa yang Sebenarnya Berubah?

Secara sederhana:

```text
Java EE / Jakarta EE 8 and earlier style
  javax.servlet.*
  javax.websocket.*
  javax.servlet.jsp.*
  javax.el.*
  javax.annotation.*
  javax.validation.*
  javax.persistence.*

Jakarta EE 9+ style
  jakarta.servlet.*
  jakarta.websocket.*
  jakarta.servlet.jsp.*
  jakarta.el.*
  jakarta.annotation.*
  jakarta.validation.*
  jakarta.persistence.*
```

Untuk seri ini, yang paling relevan adalah:

```text
javax.servlet.*       -> jakarta.servlet.*
javax.websocket.*     -> jakarta.websocket.*
javax.servlet.jsp.*   -> jakarta.servlet.jsp.*
javax.el.*            -> jakarta.el.*
```

Namun dalam aplikasi nyata, perubahan ini jarang berdiri sendiri. Kode Servlet biasanya bersentuhan dengan:

- annotation,
- validation,
- persistence,
- transaction,
- JSON binding,
- dependency injection,
- security,
- framework MVC,
- library third-party,
- application server.

Karena itu, migrasi Servlet/WebSocket sering kelihatan seperti “cuma ganti import”, padahal sebenarnya adalah **platform alignment problem**.

---

## 2. Timeline Konseptual

Kita tidak perlu menghafal semua tanggal. Yang perlu dipahami adalah fase platform.

```text
Java EE era
  ↓
Java EE 6 / 7 / 8
  javax.* namespace
  Servlet 3.x / 4.0
  WebSocket 1.x
  JSP 2.x
  EL 3.x
  ↓
Jakarta EE 8
  still javax.* namespace
  mostly continuation of Java EE 8 under Eclipse Foundation
  ↓
Jakarta EE 9
  big namespace switch
  javax.* -> jakarta.*
  Servlet 5.0
  WebSocket 2.0
  Pages 3.0
  EL 4.0
  ↓
Jakarta EE 10
  modernized APIs
  Servlet 6.0
  WebSocket 2.1
  Pages 3.1
  EL 5.0
  ↓
Jakarta EE 11
  Java 21 baseline at platform direction level
  Servlet 6.1
  WebSocket 2.2
  Pages 4.0
  EL 6.0
  ↓
Jakarta EE 12 under development
  next platform cycle
```

Important distinction:

- **Jakarta EE 8** masih memakai `javax.*`.
- **Jakarta EE 9** adalah titik “big bang rename” ke `jakarta.*`.
- **Jakarta EE 10/11** adalah generasi modern setelah namespace migration.

Jadi jangan berpikir:

```text
Jakarta == jakarta.*
```

Lebih tepat:

```text
Jakarta EE 8  == javax.*
Jakarta EE 9+ == jakarta.*
```

---

## 3. Kenapa Namespace Berubah?

Dari sisi engineer aplikasi, alasan historis/legal tidak sepenting dampak teknisnya. Yang penting:

1. Spesifikasi enterprise Java pindah governance ke Eclipse Foundation.
2. Namespace `javax.*` tidak menjadi jalur evolusi baru untuk spesifikasi Jakarta EE.
3. Jakarta EE 9 melakukan one-time namespace move dari `javax.*` ke `jakarta.*`.
4. Akibatnya, package name berubah secara menyeluruh.

Dampak terbesar:

```java
// Java EE / Jakarta EE 8 style
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

// Jakarta EE 9+ style
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
```

Secara konsep, banyak class punya peran sama. Tetapi secara Java type system, mereka adalah type berbeda.

Ini penting:

```text
javax.servlet.http.HttpServletRequest
  !=
jakarta.servlet.http.HttpServletRequest
```

Bukan beda alias. Bukan beda import saja. Bukan bisa dicast langsung. Mereka adalah fully-qualified class name yang berbeda.

---

## 4. Java Type System Reality: Kenapa “Sama Tapi Beda” Itu Berbahaya

Misalnya ada library lama:

```java
package legacy.audit;

import javax.servlet.http.HttpServletRequest;

public class AuditExtractor {
    public String extractClientIp(HttpServletRequest request) {
        return request.getRemoteAddr();
    }
}
```

Aplikasi modern memakai:

```java
import jakarta.servlet.http.HttpServletRequest;

public class MyServlet extends HttpServlet {
    protected void doGet(HttpServletRequest request, HttpServletResponse response) {
        // request adalah jakarta.servlet.http.HttpServletRequest
    }
}
```

Walaupun method-nya terlihat mirip, signature-nya tidak kompatibel.

```text
legacy.audit.AuditExtractor.extractClientIp(javax.servlet.http.HttpServletRequest)

cannot accept

jakarta.servlet.http.HttpServletRequest
```

Inilah salah satu akar error migrasi:

```text
method cannot be applied to given types
incompatible types: jakarta.servlet.http.HttpServletRequest cannot be converted to javax.servlet.http.HttpServletRequest
ClassCastException
NoSuchMethodError
NoClassDefFoundError
LinkageError
```

Mental model:

> Namespace adalah bagian dari identity type. Begitu package berubah, seluruh dependency graph harus konsisten.

---

## 5. ABI/API Boundary: Source Compatible Tidak Sama dengan Binary Compatible

Ada beberapa level kompatibilitas:

| Level | Makna | Contoh |
|---|---|---|
| Conceptual compatibility | Konsep API masih mirip | `HttpServletRequest.getHeader()` tetap ada |
| Source migration | Source bisa diubah import-nya lalu compile ulang | `javax.servlet.*` menjadi `jakarta.servlet.*` |
| Binary compatibility | `.class` lama tetap bisa jalan tanpa compile ulang | Biasanya tidak untuk namespace switch |
| Runtime compatibility | Container dan app pakai API namespace sama | Tomcat 10 app harus `jakarta.*` |
| Ecosystem compatibility | Framework + library + container + app aligned | Spring Boot 3 + Jakarta libraries + Tomcat 10/11 |

Kesalahan umum adalah menganggap conceptual compatibility berarti runtime compatibility.

Contoh:

```text
"Method-nya sama, harusnya jalan."
```

Tidak selalu. JVM tidak melihat “method mirip”. JVM melihat:

```text
owner class + method name + descriptor
```

Jika descriptor memakai `Ljavax/servlet/http/HttpServletRequest;`, maka itu beda dari `Ljakarta/servlet/http/HttpServletRequest;`.

---

## 6. Servlet Version Map

Versi yang paling sering relevan:

| Platform | Namespace | Servlet | Typical container generation |
|---|---:|---:|---|
| Java EE 7 | `javax.*` | Servlet 3.1 | Tomcat 8.x, older app servers |
| Java EE 8 / Jakarta EE 8 | `javax.*` | Servlet 4.0 | Tomcat 9.x, Jetty EE8 mode, legacy enterprise runtimes |
| Jakarta EE 9 | `jakarta.*` | Servlet 5.0 | Tomcat 10.0, Jakarta EE 9 runtimes |
| Jakarta EE 10 | `jakarta.*` | Servlet 6.0 | Tomcat 10.1, Jetty 12 EE10, modern runtimes |
| Jakarta EE 11 | `jakarta.*` | Servlet 6.1 | Tomcat 11, Jetty 12.1 EE11, newer runtimes |

Catatan:

- Servlet 4.0 adalah fase penting karena membawa HTTP/2 support dalam spec Servlet.
- Servlet 5.0 terutama penting karena namespace switch ke `jakarta.*`.
- Servlet 6.0 dan 6.1 adalah modern Jakarta Servlet generation.
- Servlet 6.1 menghapus referensi ke SecurityManager dan menambahkan beberapa penyempurnaan API/clarification di area modern runtime.

---

## 7. WebSocket Version Map

Untuk WebSocket:

| Platform | Namespace | WebSocket API | Meaning |
|---|---:|---:|---|
| Java EE 7/8 | `javax.websocket.*` | WebSocket 1.0/1.1 | Legacy namespace |
| Jakarta EE 9 | `jakarta.websocket.*` | WebSocket 2.0 | Namespace switch |
| Jakarta EE 10 | `jakarta.websocket.*` | WebSocket 2.1 | Jakarta EE 10 generation |
| Jakarta EE 11 | `jakarta.websocket.*` | WebSocket 2.2 | Jakarta EE 11 generation |

Core programming model tetap familiar:

```java
@ServerEndpoint("/events")
public class EventSocket {
    @OnOpen
    public void onOpen(Session session) {}

    @OnMessage
    public void onMessage(String message, Session session) {}

    @OnClose
    public void onClose(Session session) {}

    @OnError
    public void onError(Session session, Throwable error) {}
}
```

Tetapi import-nya berubah:

```java
// Legacy
import javax.websocket.OnOpen;
import javax.websocket.OnMessage;
import javax.websocket.Session;
import javax.websocket.server.ServerEndpoint;

// Modern
import jakarta.websocket.OnOpen;
import jakarta.websocket.OnMessage;
import jakarta.websocket.Session;
import jakarta.websocket.server.ServerEndpoint;
```

Again:

```text
javax.websocket.Session != jakarta.websocket.Session
```

---

## 8. Container Version Reality

### 8.1 Tomcat

Conceptual mapping:

| Tomcat | API family | Servlet | WebSocket | Notes |
|---|---|---:|---:|---|
| Tomcat 8.5 | Java EE / `javax.*` | 3.1 | 1.1 | legacy but widely used |
| Tomcat 9 | Java EE / `javax.*` | 4.0 | 1.1 | last major `javax.*` Tomcat line |
| Tomcat 10.0 | Jakarta EE 9 / `jakarta.*` | 5.0 | 2.0 | first Jakarta namespace Tomcat line |
| Tomcat 10.1 | Jakarta EE 10 / `jakarta.*` | 6.0 | 2.1 | common Spring Boot 3 generation |
| Tomcat 11 | Jakarta EE 11 / `jakarta.*` | 6.1 | 2.2 | newer generation |

Mental model:

```text
Tomcat 9  -> javax.servlet.*
Tomcat 10 -> jakarta.servlet.*
Tomcat 11 -> jakarta.servlet.* newer spec
```

If app imports `javax.servlet.*`, Tomcat 10/11 is not the natural runtime unless the app is transformed or rewritten.

If app imports `jakarta.servlet.*`, Tomcat 9 is not the natural runtime.

### 8.2 Jetty

Jetty 12 is interesting because it has explicit environment modules for different EE levels. In practice, Jetty 12 can support different Jakarta/Java EE environments through modules such as EE8, EE9, EE10, and newer EE11 support.

The important concept:

> Jetty version alone is not always enough. You must know the selected EE environment/module.

This is different from simple Tomcat thinking where major version often maps more directly to namespace generation.

### 8.3 Full Jakarta EE Runtimes

Examples:

- GlassFish,
- Payara,
- WildFly,
- Open Liberty,
- WebSphere Liberty,
- TomEE,
- newer enterprise runtimes.

For full servers, compatibility must consider:

- Servlet,
- WebSocket,
- CDI,
- JPA,
- Validation,
- JSON-B/P,
- Transaction,
- Security,
- REST,
- Faces/Pages,
- mail,
- batch,
- concurrency,
- connector APIs.

Untuk seri ini, fokus kita tetap Servlet/WebSocket. Tetapi saat migrasi platform, semua spec terkait bisa ikut terkena.

---

## 9. Compatibility Matrix: Cara Berpikir yang Benar

Jangan mulai dari pertanyaan:

```text
"Versi Java saya berapa?"
```

Itu penting, tapi bukan satu-satunya.

Mulai dari matrix:

```text
Application source namespace
  ↓
Framework generation
  ↓
Servlet/WebSocket API dependency
  ↓
Container implementation version
  ↓
Java runtime version
  ↓
Third-party libraries touching Jakarta/Java EE APIs
```

Checklist ringkas:

| Layer | Pertanyaan wajib |
|---|---|
| Source code | Apakah import-nya `javax.*` atau `jakarta.*`? |
| Framework | Spring Boot 2 atau 3? Jakarta EE 8 atau 10/11? |
| Servlet API dependency | Apakah `javax.servlet-api` atau `jakarta.servlet-api`? |
| WebSocket API dependency | Apakah `javax.websocket-api` atau `jakarta.websocket-api`? |
| Container | Tomcat 9, 10.0, 10.1, 11? Jetty EE8/EE9/EE10/EE11? |
| Libraries | Apakah filter, listener, servlet extension, auth adapter, tracing agent masih `javax.*`? |
| Deployment | WAR eksternal atau embedded container? |
| Runtime Java | Java 8, 11, 17, 21, 25? |

Top 1% habit:

> Jangan debug migration error secara acak. Bangun dependency graph namespace. Temukan layer yang berada di sisi yang salah.

---

## 10. Migration Failure Patterns

### 10.1 Compile Error: Import Tidak Ada

Contoh:

```text
package javax.servlet does not exist
```

Kemungkinan:

- project sudah pakai Jakarta API dependency,
- source masih import `javax.servlet.*`,
- Java EE API lama tidak lagi ada di classpath.

Solusi:

- ganti source import ke `jakarta.servlet.*`, atau
- jika target runtime masih legacy, gunakan dependency `javax.servlet-api` sesuai container.

### 10.2 Compile Error: Type Mismatch

```text
incompatible types: jakarta.servlet.http.HttpServletRequest cannot be converted to javax.servlet.http.HttpServletRequest
```

Kemungkinan:

- ada library/helper internal masih `javax.*`,
- aplikasi sudah `jakarta.*`,
- boundary method signature belum dimigrasi.

Solusi:

- migrasi semua module internal secara konsisten,
- compile ulang semua module,
- jangan biarkan shared common library berada di namespace lama.

### 10.3 Runtime Error: `NoClassDefFoundError`

```text
java.lang.NoClassDefFoundError: javax/servlet/Filter
```

Kemungkinan:

- menjalankan library lama di runtime Jakarta,
- container menyediakan `jakarta.servlet.Filter`, bukan `javax.servlet.Filter`.

Solusi:

- upgrade library ke versi Jakarta,
- transform binary,
- ganti library,
- atau tetap di runtime `javax.*` sampai dependency siap.

### 10.4 Runtime Error: `ClassCastException`

```text
jakarta.servlet... cannot be cast to javax.servlet...
```

Kemungkinan:

- dua API family hadir bersama,
- framework menerima satu type, library memberi type lain,
- custom classloader memuat library campuran.

Solusi:

- hilangkan mixed namespace,
- audit dependency tree,
- jangan memasukkan servlet API yang salah ke `WEB-INF/lib`.

### 10.5 `NoSuchMethodError` / `AbstractMethodError`

Kemungkinan:

- compile terhadap versi API berbeda dari runtime,
- container spec lebih lama dari yang diharapkan,
- library dikompilasi dengan method signature baru.

Solusi:

- align API version dengan container,
- jangan override container-provided API secara sembarangan,
- cek dependency `provided` vs `compile`/`implementation`.

---

## 11. Dependency Scope: Kesalahan Kecil yang Menjadi Production Bug

Untuk WAR tradisional, Servlet API biasanya disediakan oleh container.

Maven legacy:

```xml
<dependency>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
  <version>4.0.1</version>
  <scope>provided</scope>
</dependency>
```

Maven modern:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
  <scope>provided</scope>
</dependency>
```

Gradle legacy:

```groovy
compileOnly 'javax.servlet:javax.servlet-api:4.0.1'
```

Gradle modern:

```groovy
compileOnly 'jakarta.servlet:jakarta.servlet-api:6.1.0'
```

Kenapa `provided` / `compileOnly`?

Karena external container sudah menyediakan implementasi API tersebut. Jika aplikasi memasukkan API jar sendiri ke WAR, bisa muncul konflik classloader.

Namun untuk embedded server seperti Spring Boot executable JAR, dependency management biasanya diatur oleh framework starter. Kita tidak perlu memasukkan servlet API secara manual kecuali ada kebutuhan khusus.

Mental model:

```text
External WAR:
  app compile against API
  container provides runtime implementation

Embedded server:
  app includes server implementation as part of process
  framework manages matching API + implementation
```

---

## 12. `javax.servlet-api` vs Implementation

Penting:

```text
servlet-api jar != servlet container
```

`javax.servlet-api` atau `jakarta.servlet-api` hanya berisi interface/contract API.

Contoh API:

```text
HttpServletRequest
HttpServletResponse
Filter
ServletContext
AsyncContext
```

Implementation-nya disediakan oleh container:

```text
Tomcat
Jetty
Undertow
GlassFish
WildFly
Payara
Open Liberty
```

Jadi kalau hanya menambahkan:

```xml
<artifactId>jakarta.servlet-api</artifactId>
```

itu tidak membuat aplikasi bisa menerima HTTP request. Ia hanya memungkinkan compile. Runtime butuh container.

---

## 13. Java Version vs Jakarta Version

Java version dan Jakarta EE version adalah dua sumbu berbeda.

```text
Java version    -> language/runtime/JDK capabilities
Jakarta version -> enterprise API specifications
Container       -> implementation of Jakarta specs
```

Contoh kombinasi:

| Java Runtime | App Namespace | Container | Valid? | Catatan |
|---:|---|---|---|---|
| Java 8 | `javax.*` | Tomcat 9 | Umumnya valid | legacy common |
| Java 17 | `javax.*` | Tomcat 9 | Bisa valid | app lama di JDK baru, jika libs support |
| Java 17 | `jakarta.*` | Tomcat 10.1 | Valid | common Spring Boot 3 era |
| Java 21 | `jakarta.*` | Tomcat 10.1/11 | Valid jika container support | modern LTS |
| Java 25 | `jakarta.*` | container terbaru | Perlu cek support | modern/current JDK |
| Java 8 | `jakarta.*` Servlet 6.x | Tidak realistis | Servlet 6.x ecosystem punya baseline modern |

Top-tier mental model:

> Upgrade Java runtime tidak otomatis berarti upgrade Jakarta namespace. Upgrade namespace tidak otomatis berarti upgrade Java runtime. Tetapi framework/container modern sering mengikat keduanya lewat minimum baseline.

Contoh besar: Spring Boot 3 menggunakan Jakarta EE 9 APIs dan membutuhkan Java 17+.

---

## 14. Spring Boot 2 ke 3: Kenapa Ini Relevan untuk Servlet?

Banyak engineer tidak pernah menulis `HttpServlet` langsung, tapi tetap terkena Servlet runtime lewat:

- Spring MVC,
- Spring Security filter chain,
- Spring WebSocket,
- embedded Tomcat/Jetty/Undertow,
- servlet filters,
- interceptors,
- multipart handling,
- error dispatch,
- session management.

Spring Boot 2.x umumnya berada di dunia `javax.*`.

Spring Boot 3.x berada di dunia `jakarta.*`.

Dampak:

```java
// Boot 2 style
import javax.servlet.Filter;
import javax.servlet.http.HttpServletRequest;

// Boot 3 style
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
```

Migration surface:

1. custom filters,
2. custom servlet registration,
3. custom listener,
4. custom `HandlerInterceptor` yang mengambil servlet request,
5. custom error handling,
6. multipart config,
7. third-party servlet filters,
8. tracing/observability libraries,
9. auth adapters,
10. SSO/OIDC integration libraries,
11. old Keycloak adapters,
12. old Swagger/OpenAPI integrations,
13. old CORS/filter libs,
14. old file upload libs.

Rule of thumb:

> Jika sebuah library punya type signature yang menyebut `ServletRequest`, `HttpServletRequest`, `Filter`, `ServletContext`, `WebSocket Session`, atau annotation Jakarta EE, library itu harus dicek namespace-nya.

---

## 15. Container-Framework Alignment Examples

### 15.1 Legacy Java EE / Spring Boot 2 Style

```text
Java 8/11/17
Spring Boot 2.x
Spring Framework 5.x
javax.servlet.*
Tomcat 9 embedded or external
Servlet 4.0
WebSocket 1.1
```

Natural alignment:

```text
source: javax.*
framework: javax.*
container: javax.*
```

### 15.2 Modern Spring Boot 3 Style

```text
Java 17/21/25
Spring Boot 3.x
Spring Framework 6.x
jakarta.servlet.*
Tomcat 10.1/11 embedded or compatible external
Servlet 6.x
WebSocket 2.x
```

Natural alignment:

```text
source: jakarta.*
framework: jakarta.*
container: jakarta.*
```

### 15.3 Broken Mixed Style

```text
Java 17
Spring Boot 3.x
jakarta.servlet.* in app
old internal library using javax.servlet.Filter
Tomcat 10.1
```

Likely failure:

```text
compile mismatch
NoClassDefFoundError: javax/servlet/Filter
ClassCastException
```

### 15.4 Another Broken Mixed Style

```text
Java 17
app source jakarta.servlet.*
external Tomcat 9
```

Likely failure:

```text
ClassNotFoundException: jakarta.servlet.Servlet
```

Because Tomcat 9 provides `javax.servlet.*`, not `jakarta.servlet.*`.

---

## 16. Migration Strategies

Ada beberapa strategi. Tidak ada satu strategi universal. Pilihan tergantung risiko, ukuran aplikasi, dependency, release pressure, dan ownership.

### 16.1 Big Bang Source Migration

Semua source dan dependency dimigrasi sekaligus.

Flow:

```text
upgrade build baseline
  ↓
upgrade framework/container
  ↓
replace javax imports with jakarta imports
  ↓
upgrade third-party dependencies
  ↓
fix compile errors
  ↓
fix runtime errors
  ↓
full regression test
  ↓
production rollout
```

Kelebihan:

- clean target state,
- tidak banyak compatibility shim,
- bagus untuk codebase kecil/menengah,
- cocok jika test coverage kuat.

Kekurangan:

- blast radius besar,
- banyak compile error sekaligus,
- dependency lama bisa menjadi blocker,
- sulit jika banyak module/team.

### 16.2 Incremental Module Migration

Migrasi dilakukan module-by-module.

Masalah:

```text
Module A jakarta.* cannot directly expose jakarta servlet types to Module B javax.*
```

Agar bisa incremental, boundary antar module harus tidak mengekspos Servlet API.

Contoh buruk:

```java
public interface AuditContextFactory {
    AuditContext from(HttpServletRequest request);
}
```

Jika interface ini berada di shared module, semua consumer terikat namespace Servlet.

Contoh lebih baik:

```java
public interface AuditContextFactory {
    AuditContext from(RequestMetadata metadata);
}

public record RequestMetadata(
    String method,
    String path,
    String clientIp,
    String userAgent,
    String correlationId
) {}
```

Dengan boundary ini, hanya adapter web layer yang perlu tahu `javax` atau `jakarta`.

Mental model:

> Untuk incremental migration, isolate platform types at the edge.

### 16.3 Binary Transformation

Ada tool yang bisa mentransform bytecode/resource dari `javax.*` ke `jakarta.*`, misalnya Eclipse Transformer.

Use case:

- aplikasi legacy besar,
- third-party dependency belum tersedia versi Jakarta,
- perlu deploy ke runtime Jakarta,
- source migration belum feasible.

Kelebihan:

- bisa mempercepat transisi,
- membantu library lama,
- berguna untuk migration bridge.

Kekurangan:

- tidak semua kasus aman,
- reflection/string literal/resource XML perlu perhatian,
- debugging bisa lebih sulit,
- jangan dianggap pengganti upgrade dependency jangka panjang.

### 16.4 Stay on `javax.*` Temporarily

Kadang pilihan terbaik adalah tidak migrasi dulu.

Valid jika:

- aplikasi stabil,
- dependency belum siap,
- container legacy masih supported secara internal,
- business risk migration terlalu tinggi,
- tidak ada requirement Java/framework modern.

Namun harus ada plan:

```text
inventory dependency
security support assessment
container EOL assessment
Java runtime support assessment
migration spike
test strategy
cutover target
```

Jangan “stay” karena tidak tahu risikonya. Stay harus menjadi keputusan sadar.

---

## 17. Tooling untuk Migration

### 17.1 IDE Search and Replace

Paling sederhana:

```text
javax.servlet        -> jakarta.servlet
javax.websocket      -> jakarta.websocket
javax.servlet.jsp    -> jakarta.servlet.jsp
javax.el             -> jakarta.el
```

Masalah:

- tidak cukup untuk semua spec,
- bisa salah pada documentation/string,
- tidak upgrade dependency,
- tidak menyelesaikan transitive libraries.

### 17.2 OpenRewrite

OpenRewrite punya recipe untuk migrasi Java/Jakarta, termasuk migrasi `javax` ke `jakarta`.

Kelebihan:

- source-aware,
- cocok untuk Maven/Gradle,
- bisa dijalankan repeatable,
- membantu large codebase.

Contoh mental flow:

```text
run dependency tree
  ↓
run OpenRewrite javax-to-jakarta recipe
  ↓
review diff
  ↓
compile
  ↓
fix manually where recipe cannot infer
```

### 17.3 Eclipse Transformer

Eclipse Transformer bisa mentransform resource/file/archive berdasarkan rule tertentu, termasuk namespace transformation.

Kelebihan:

- bisa bekerja pada binary/artifact,
- berguna untuk app/library yang belum source-migrated.

Kekurangan:

- hasil transform harus diuji ketat,
- reflection, serialized form, XML, service loader, dan config text perlu diperhatikan,
- idealnya temporary bridge, bukan desain permanen.

### 17.4 Build Dependency Audit

Maven:

```bash
mvn dependency:tree | grep -E "javax|jakarta|servlet|websocket"
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencies --configuration compileClasspath
```

Tujuan:

```text
Find mixed namespace dependencies.
```

Red flags:

```text
javax.servlet-api present in Jakarta app
jakarta.servlet-api present in legacy javax app
old javax.websocket-api in modern runtime
old servlet filter library compiled against javax
two different servlet-api jars in WAR
servlet-api included in WEB-INF/lib for external container
```

---

## 18. Web.xml and Deployment Descriptor Migration

Servlet migration bukan hanya Java import.

Legacy `web.xml` namespace bisa terlihat seperti:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee
                             http://xmlns.jcp.org/xml/ns/javaee/web-app_4_0.xsd"
         version="4.0">
</web-app>
```

Modern Jakarta style bisa memakai namespace Jakarta EE schema sesuai versi:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_1.xsd"
         version="6.1">
</web-app>
```

Hal-hal yang perlu dicek:

- XML namespace,
- schema location,
- `version`,
- listener class names,
- filter class names,
- servlet class names,
- context-param values yang menyebut class lama,
- custom taglib descriptor,
- JSP config,
- security constraint,
- error page mapping,
- multipart config.

Top-tier habit:

> Migration search tidak hanya `.java`. Search juga XML, properties, YAML, service loader files, JSP, tag files, generated sources, documentation-as-config, and reflection strings.

---

## 19. Annotation Migration

Servlet-related annotations:

Legacy:

```java
import javax.servlet.annotation.WebServlet;
import javax.servlet.annotation.WebFilter;
import javax.servlet.annotation.WebListener;
import javax.servlet.annotation.MultipartConfig;
```

Modern:

```java
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.annotation.WebFilter;
import jakarta.servlet.annotation.WebListener;
import jakarta.servlet.annotation.MultipartConfig;
```

WebSocket annotations:

Legacy:

```java
import javax.websocket.server.ServerEndpoint;
import javax.websocket.OnOpen;
import javax.websocket.OnMessage;
import javax.websocket.OnClose;
import javax.websocket.OnError;
```

Modern:

```java
import jakarta.websocket.server.ServerEndpoint;
import jakarta.websocket.OnOpen;
import jakarta.websocket.OnMessage;
import jakarta.websocket.OnClose;
import jakarta.websocket.OnError;
```

Potential hidden issue:

```java
@WebFilter(filterName = "LegacyAuthFilter", urlPatterns = "/*")
public class AuthFilter implements Filter { ... }
```

Jika class `AuthFilter` masih implement `javax.servlet.Filter`, annotation modern saja tidak cukup. Annotation dan implemented interface harus satu namespace.

---

## 20. Reflection, ServiceLoader, and String-Based Class Names

Migration tool sering sukses mengubah import, tapi gagal menemukan string-based references.

Contoh:

```java
Class.forName("javax.servlet.http.HttpServletRequest");
```

Contoh properties:

```properties
filter.class=javax.servlet.Filter
```

Contoh XML:

```xml
<listener-class>com.example.LegacySessionListener</listener-class>
```

Contoh service loader:

```text
META-INF/services/javax.servlet.ServletContainerInitializer
```

Untuk Servlet 3+ pluggability, `ServletContainerInitializer` sangat penting. Jika library menggunakan service loader dengan namespace lama, container modern mungkin tidak memprosesnya.

Checklist:

```bash
grep -R "javax\.servlet" .
grep -R "javax\.websocket" .
grep -R "javax\.el" .
grep -R "javax\.servlet\.jsp" .
grep -R "META-INF/services" .
```

---

## 21. Multi-Module Enterprise Migration Problem

Bayangkan struktur:

```text
app-parent
  common-web
  common-security
  common-audit
  module-case
  module-application
  module-report
  webapp
```

Masalah muncul jika `common-web` mengekspos Servlet API:

```java
public interface ClientIpResolver {
    String resolve(HttpServletRequest request);
}
```

Ini membuat semua module yang memakai interface tersebut ikut tergantung namespace Servlet.

Lebih scalable:

```java
public interface ClientIpResolver {
    String resolve(RequestHeaders headers, NetworkPeer peer);
}
```

Atau:

```java
public final class ServletRequestMetadataExtractor {
    public RequestMetadata extract(HttpServletRequest request) {
        return new RequestMetadata(...);
    }
}
```

Dengan pola ini:

```text
Servlet-specific code stays in adapter layer.
Domain/common code receives neutral DTO.
```

Ini bukan hanya migration technique. Ini architecture hygiene.

---

## 22. The Edge-Type Rule

Rule penting:

> Jangan biarkan Servlet/WebSocket API types bocor ke domain layer, shared utility layer, atau library internal yang tidak benar-benar web-specific.

Boleh:

```java
public class ServletAuditAdapter {
    public AuditInput from(HttpServletRequest request) { ... }
}
```

Kurang baik:

```java
public interface AuditService {
    void audit(HttpServletRequest request, Object payload);
}
```

Lebih baik:

```java
public interface AuditService {
    void audit(AuditInput input);
}
```

Manfaat:

- migration lebih mudah,
- test lebih mudah,
- domain tidak tergantung container,
- bisa dipakai dari CLI/batch/message consumer,
- lebih sedikit namespace blast radius,
- lebih jelas boundary responsibility.

---

## 23. Servlet API as Boundary, Not Business Abstraction

Top 1% engineer tidak melihat Servlet API sebagai tempat menaruh business logic. Servlet API adalah **protocol boundary**.

```text
HTTP request enters
  ↓
Servlet/container boundary parses request
  ↓
Adapter extracts technical metadata
  ↓
Application service receives stable domain/application input
  ↓
Application result mapped back to response
```

Buruk:

```java
public void approveCase(HttpServletRequest request) {
    String caseId = request.getParameter("caseId");
    String officer = (String) request.getSession().getAttribute("user");
    // business logic here
}
```

Lebih baik:

```java
public ApprovalResult approveCase(ApproveCaseCommand command, Actor actor) {
    // business logic here
}
```

Servlet adapter:

```java
String caseId = request.getParameter("caseId");
Actor actor = actorResolver.from(request);
ApproveCaseCommand command = new ApproveCaseCommand(caseId);
ApprovalResult result = service.approveCase(command, actor);
```

Kenapa ini relevan untuk migration?

Karena semakin banyak business code menerima `HttpServletRequest`, semakin mahal migrasi `javax` ke `jakarta`.

---

## 24. Reading Specification Documents Without Drowning

Spec document bisa panjang. Cara membacanya:

### 24.1 Jangan mulai dari semua bab

Mulai dari pertanyaan runtime:

```text
What object is container-managed?
What lifecycle method exists?
What threading guarantee exists?
What is portable behavior?
What is container-specific behavior?
What is undefined?
What changed between versions?
```

### 24.2 Cari keywords

Untuk Servlet:

```text
lifecycle
mapping
dispatcher
filter
listener
session
async
non-blocking
error
security
multipart
HTTP/2
```

Untuk WebSocket:

```text
endpoint lifecycle
session
encoder
decoder
configurator
subprotocol
extension
message handler
partial message
async remote
close code
```

### 24.3 Bedakan API spec dan implementation docs

Specification menjawab:

```text
What must a compliant implementation provide?
```

Container docs menjawab:

```text
How does this container implement/configure/tune it?
```

Contoh:

```text
Jakarta Servlet Spec -> lifecycle/filter/session semantics
Tomcat docs          -> maxThreads, connector, valves, deployment specifics
Jetty docs           -> modules, handlers, connectors, EE environment
Undertow docs        -> worker/io thread model, handler chain
```

---

## 25. Version Selection Decision Tree

### 25.1 Starting From Existing Legacy App

```text
Is app using javax.servlet.*?
  ↓ yes
Is there strong need for Spring Boot 3 / Jakarta EE 10+ / Java 21+ platform?
  ↓ no
Stay on compatible javax runtime temporarily, plan migration.
  ↓ yes
Inventory dependencies touching javax.*.
  ↓
Are all critical dependencies available in jakarta.* versions?
  ↓ no
Decide: replace, transform, isolate, or postpone.
  ↓ yes
Migrate source + build + container together.
```

### 25.2 Starting From New App

```text
New application?
  ↓
Use jakarta.* unless constrained by legacy container.
  ↓
Use modern framework/container generation.
  ↓
Avoid javax.* unless integrating with legacy deployment target.
```

### 25.3 Starting From Shared Library

```text
Is this library web-specific?
  ↓ no
Do not expose Servlet/WebSocket API.
  ↓ yes
Do we need support for both javax and jakarta users?
  ↓ yes
Consider separate artifacts:
    library-web-javax
    library-web-jakarta
  ↓ no
Target jakarta.* for modern baseline.
```

---

## 26. Dual Artifact Strategy for Internal Libraries

For companies with many apps, sometimes you cannot migrate all at once.

A practical pattern:

```text
common-audit-core
  no servlet dependency

common-audit-servlet-javax
  depends on javax.servlet-api
  adapts HttpServletRequest -> AuditInput

common-audit-servlet-jakarta
  depends on jakarta.servlet-api
  adapts HttpServletRequest -> AuditInput
```

Package idea:

```text
com.company.audit.core
com.company.audit.servlet.javax
com.company.audit.servlet.jakarta
```

Core stays stable:

```java
public record AuditInput(
    String method,
    String path,
    String clientIp,
    String userAgent,
    String correlationId
) {}
```

Legacy adapter:

```java
public final class JavaxAuditExtractor {
    public AuditInput extract(javax.servlet.http.HttpServletRequest request) {
        return new AuditInput(
            request.getMethod(),
            request.getRequestURI(),
            request.getRemoteAddr(),
            request.getHeader("User-Agent"),
            request.getHeader("X-Correlation-ID")
        );
    }
}
```

Modern adapter:

```java
public final class JakartaAuditExtractor {
    public AuditInput extract(jakarta.servlet.http.HttpServletRequest request) {
        return new AuditInput(
            request.getMethod(),
            request.getRequestURI(),
            request.getRemoteAddr(),
            request.getHeader("User-Agent"),
            request.getHeader("X-Correlation-ID")
        );
    }
}
```

Ini menghindari memaksa semua aplikasi pindah di hari yang sama.

---

## 27. WebSocket Migration Special Concerns

WebSocket lebih tricky karena long-lived connection.

Migration impact bukan hanya compile-time. Runtime behavior juga perlu diuji:

- handshake path,
- endpoint discovery,
- CDI/Spring injection integration,
- configurator,
- encoder/decoder,
- session registry,
- async send,
- close handling,
- proxy upgrade behavior,
- idle timeout,
- ping/pong,
- browser reconnect.

Legacy endpoint:

```java
import javax.websocket.OnMessage;
import javax.websocket.Session;
import javax.websocket.server.ServerEndpoint;

@ServerEndpoint("/ws/notice")
public class NoticeEndpoint {
    @OnMessage
    public void onMessage(String message, Session session) {
        session.getAsyncRemote().sendText("ack");
    }
}
```

Modern endpoint:

```java
import jakarta.websocket.OnMessage;
import jakarta.websocket.Session;
import jakarta.websocket.server.ServerEndpoint;

@ServerEndpoint("/ws/notice")
public class NoticeEndpoint {
    @OnMessage
    public void onMessage(String message, Session session) {
        session.getAsyncRemote().sendText("ack");
    }
}
```

Source terlihat hampir sama. Tetapi runtime endpoint scanner harus melihat annotation modern jika container modern.

Jika annotation lama tertinggal, endpoint mungkin tidak terdaftar.

---

## 28. JSP / Jakarta Pages Migration Notes

Legacy JSP ecosystem:

```text
javax.servlet.jsp.*
JSP 2.x
JSTL javax era
EL javax era
```

Modern Jakarta Pages ecosystem:

```text
jakarta.servlet.jsp.*
Jakarta Pages 3.x/4.x
Jakarta Tags/JSTL modern versions
Jakarta EL 4/5/6
```

Risk points:

- taglibs,
- custom tags,
- old JSTL dependency,
- JSP compilation,
- TLD files,
- expression language behavior,
- generated servlet source,
- container-provided JSP engine version.

Jika aplikasi legacy memakai JSP berat, migration bukan hanya Servlet import.

Checklist:

```text
Search JSP files for javax.* references.
Check taglib URIs.
Check JSTL dependency generation.
Check custom tag handler imports.
Check container JSP support version.
Compile JSP during CI if possible.
```

---

## 29. Jakarta Migration and SecurityManager Removal Context

Servlet 6.1 removes references to SecurityManager. Ini relevan karena SecurityManager di Java modern sudah deprecated for removal dan bukan lagi model sandbox utama.

Untuk aplikasi modern, security boundary biasanya dipindah ke:

- OS/container isolation,
- Kubernetes security context,
- IAM/secret management,
- network policies,
- application-level authorization,
- framework security,
- dependency scanning,
- runtime hardening.

Dalam konteks Servlet:

```text
Do not assume Java SecurityManager protects your webapp.
Use explicit application and infrastructure controls.
```

---

## 30. Common Misconceptions

### Misconception 1: “Jakarta itu cuma rename Java EE”

Sebagian benar secara sejarah, tapi salah secara engineering. Namespace change mengubah type identity dan memengaruhi seluruh dependency graph.

### Misconception 2: “Tinggal replace `javax` ke `jakarta`”

Untuk toy project mungkin. Untuk enterprise project, perlu cek:

- dependencies,
- generated code,
- XML,
- reflection,
- service loader,
- container,
- deployment model,
- tests,
- agents,
- custom plugins,
- JSP/taglibs,
- WebSocket endpoint scanning.

### Misconception 3: “Kalau compile berarti aman”

Tidak. Runtime bisa gagal karena:

- container version mismatch,
- duplicate API jar,
- service loader mismatch,
- library binary lama,
- endpoint not discovered,
- classloader conflict.

### Misconception 4: “Java version menentukan Servlet version”

Tidak langsung. Java 17 bisa menjalankan app `javax.*` di Tomcat 9. Java 17 juga bisa menjalankan app `jakarta.*` di Tomcat 10.1. Yang penting alignment.

### Misconception 5: “Tomcat 10 pasti lebih baik dari Tomcat 9 untuk semua app”

Tomcat 10 lebih modern, tapi jika app dan dependencies masih `javax.*`, Tomcat 10 bisa menjadi migration hazard.

---

## 31. Practical Migration Playbook

### Phase 1 — Inventory

```bash
# Java source and resources
grep -R "javax\.servlet" src || true
grep -R "javax\.websocket" src || true
grep -R "javax\.servlet\.jsp" src || true
grep -R "javax\.el" src || true

# Config/resource references
grep -R "javax\.servlet" . || true
grep -R "javax\.websocket" . || true
```

Maven:

```bash
mvn dependency:tree > dependency-tree.txt
grep -E "javax|jakarta|servlet|websocket|jsp|el" dependency-tree.txt
```

Gradle:

```bash
./gradlew dependencies --configuration compileClasspath > compile-deps.txt
./gradlew dependencies --configuration runtimeClasspath > runtime-deps.txt
grep -E "javax|jakarta|servlet|websocket|jsp|el" compile-deps.txt runtime-deps.txt
```

### Phase 2 — Decide Target Runtime

Example target options:

```text
Option A: remain javax
  Tomcat 9 / Java EE 8 compatible runtime

Option B: Jakarta EE 10
  Tomcat 10.1 / Servlet 6.0 / WebSocket 2.1

Option C: Jakarta EE 11
  Tomcat 11 / Servlet 6.1 / WebSocket 2.2
```

### Phase 3 — Upgrade Dependency Graph

Tasks:

- replace servlet API dependency,
- replace websocket API dependency,
- upgrade framework,
- upgrade third-party filters/listeners,
- remove obsolete adapters,
- check old Java EE umbrella dependencies,
- avoid duplicate API jars.

### Phase 4 — Source Migration

Replace imports and signatures:

```text
javax.servlet.*       -> jakarta.servlet.*
javax.websocket.*     -> jakarta.websocket.*
javax.servlet.jsp.*   -> jakarta.servlet.jsp.*
javax.el.*            -> jakarta.el.*
```

### Phase 5 — Descriptor and Resource Migration

Check:

- `web.xml`,
- `web-fragment.xml`,
- TLD,
- JSP,
- `META-INF/services`,
- config properties,
- YAML,
- reflection strings,
- generated code.

### Phase 6 — Compile and Fix Type Leaks

When errors appear, classify:

```text
source still old import
library still old namespace
boundary exposing servlet type
wrong API dependency
wrong container version
```

### Phase 7 — Runtime Smoke Test

Minimum runtime checks:

```text
app starts
servlet mappings registered
filters invoked in expected order
listeners invoked
session works
multipart works
error page works
async endpoint works if any
WebSocket handshake works
WebSocket send/receive works
JSP compiles if used
static resources served
reverse proxy path/scheme correct
```

### Phase 8 — Production-like Regression

Run tests involving:

- login/session,
- redirect,
- file upload,
- file download,
- concurrent requests,
- large request body,
- slow client,
- timeout,
- WebSocket reconnect,
- rolling restart,
- proxy idle timeout,
- health checks.

---

## 32. Migration Test Matrix

| Area | Test | Why |
|---|---|---|
| Startup | App deploys cleanly | catches classloader and missing API problems |
| Servlet mapping | Expected routes work | catches annotation/descriptor mismatch |
| Filter chain | Auth/logging/CORS filters run | catches old `javax.servlet.Filter` libs |
| Listener | Startup/shutdown hooks run | catches listener registration problems |
| Session | Create/read/invalidate session | catches cookie/session compatibility |
| Multipart | Upload file | catches config and API migration issues |
| Error dispatch | 404/500 custom handling | catches descriptor and dispatcher behavior |
| Async | Async servlet completes/timeouts | catches lifecycle issues |
| WebSocket handshake | Browser connects | catches endpoint discovery/proxy upgrade |
| WebSocket messaging | send/receive/close | catches API/runtime mismatch |
| JSP | Page compiles/renders | catches Pages/JSTL/EL mismatch |
| Proxy | scheme/host/path correct | catches forwarded header assumptions |
| Shutdown | graceful drain | catches lifecycle/thread leaks |

---

## 33. Deep Mental Model: Namespace Side Consistency

Bayangkan ada dua pulau:

```text
javax island
  javax.servlet.Filter
  javax.servlet.http.HttpServletRequest
  javax.websocket.Session
  Tomcat 9
  Spring Boot 2
  Java EE 8 libraries

jakarta island
  jakarta.servlet.Filter
  jakarta.servlet.http.HttpServletRequest
  jakarta.websocket.Session
  Tomcat 10/11
  Spring Boot 3
  Jakarta EE 9+ libraries
```

Yang berbahaya adalah jembatan setengah jadi:

```text
App source: jakarta
Internal common lib: javax
Container: jakarta
Third-party auth filter: javax
```

Ini bukan “hybrid flexible”. Ini biasanya “runtime failure waiting to happen”.

Prinsip:

> Semua komponen yang menyentuh platform API harus berdiri di pulau yang sama, kecuali Anda sengaja membuat adapter boundary atau artifact terpisah.

---

## 34. Design Principle: Keep Platform Types at the Perimeter

Servlet/WebSocket API sangat berguna di perimeter, tapi jangan menyebar ke seluruh aplikasi.

Boundary layering:

```text
[Browser / HTTP / WebSocket]
          ↓
[Servlet/WebSocket adapter]
          ↓
[Application boundary DTO/command]
          ↓
[Domain/application service]
          ↓
[Persistence/integration]
```

Di layer Servlet/WebSocket adapter, wajar memakai:

```text
HttpServletRequest
HttpServletResponse
Filter
ServletContext
Session
EndpointConfig
jakarta.websocket.Session
```

Di domain/application service, hindari type tersebut.

Kenapa?

- business logic tidak perlu tahu container,
- lebih mudah dites,
- lebih mudah migrate,
- lebih mudah digunakan ulang,
- lebih minim classloader/namespace coupling,
- lebih jelas protocol boundary.

---

## 35. Engineering Heuristics untuk Top-Tier Migration

### 35.1 Always Align Four Things

```text
source imports
API dependency
framework generation
container implementation
```

Jika satu saja berbeda, error bisa muncul.

### 35.2 Never Trust Transitive Dependencies Blindly

Dependency lama bisa membawa:

```text
javax.servlet-api
javax.websocket-api
old JSP/JSTL APIs
old Java EE umbrella jar
```

### 35.3 Avoid Including Servlet API in WAR Runtime

Untuk external container, pakai `provided` atau `compileOnly`. Jangan bawa API jar salah ke `WEB-INF/lib`.

### 35.4 Search Beyond Java Source

Cari di:

```text
.java
.xml
.jsp
.tag
.properties
.yml
META-INF/services
Dockerfile
startup scripts
generated sources
```

### 35.5 Build Neutral Internal Abstractions

Jangan expose Servlet API dari common library kecuali library itu memang servlet-specific.

### 35.6 Treat WebSocket Separately

WebSocket punya lifecycle long-lived. Migration success tidak cukup dengan HTTP endpoint test.

### 35.7 Prefer Upgrade Over Permanent Transformation

Binary transformation berguna, tapi lebih sehat jika eventually source dan dependency benar-benar berada di target namespace.

---

## 36. Mini Case Study: Legacy WAR to Modern Jakarta Runtime

### Initial State

```text
Java 8
Maven multi-module
Spring MVC legacy
Tomcat 9 external
javax.servlet.*
custom filters
JSP pages
WebSocket endpoint
internal common-web library
```

### Target State

```text
Java 21
Spring Boot 3.x or Jakarta EE 10/11 runtime
Tomcat 10.1/11 or equivalent
jakarta.servlet.*
jakarta.websocket.*
modern dependencies
```

### Risk Inventory

| Risk | Why |
|---|---|
| old custom filter | implements `javax.servlet.Filter` |
| old WebSocket endpoint | annotation scanner mismatch |
| JSP taglibs | JSTL/EL version mismatch |
| common-web library | exposes `HttpServletRequest` |
| external auth adapter | may not support Jakarta namespace |
| WAR descriptor | old XML schema |
| servlet-api jar | might be packaged incorrectly |

### Good Migration Plan

```text
1. Move to latest legacy baseline first if needed.
2. Remove unused servlet/websocket dependencies.
3. Split common-web into core + servlet adapter if needed.
4. Upgrade third-party dependencies to Jakarta-compatible versions.
5. Convert source imports.
6. Convert descriptors/resources.
7. Move runtime to Jakarta-compatible container.
8. Run HTTP + WebSocket + JSP + session regression.
9. Run production-like proxy/timeout tests.
10. Roll out with rollback plan.
```

### Bad Migration Plan

```text
1. Replace all javax with jakarta.
2. Deploy to production.
3. Fix errors as they appear.
```

Ini bukan migration. Ini gambling.

---

## 37. What Changes, What Does Not

### Changes

```text
Package names
API artifacts
container generation
framework generation
descriptor schemas
library compatibility
binary identity
some deprecated/removed APIs
minimum Java baseline in modern ecosystems
```

### Mostly Same Conceptually

```text
Servlet lifecycle
request/response model
filter chain concept
listener concept
session concept
WebSocket endpoint model
JSP generated servlet concept
HTTP protocol fundamentals
```

### But Beware

“Conceptually same” tidak berarti “operationally same”. Production behavior can change because container version, defaults, timeout, thread pool, HTTP/2, security hardening, and dependency versions change.

---

## 38. Self-Assessment Questions

Jawab tanpa melihat materi:

1. Apa perbedaan `javax.servlet.http.HttpServletRequest` dan `jakarta.servlet.http.HttpServletRequest` dari sudut pandang JVM?
2. Kenapa Tomcat 9 dan Tomcat 10 berada di sisi namespace berbeda?
3. Apa arti Jakarta EE 8 masih `javax.*`?
4. Apa risiko terbesar dari library internal yang mengekspos `HttpServletRequest`?
5. Kenapa compile success belum cukup untuk migration success?
6. Sebutkan lima tempat selain `.java` yang perlu dicari saat migration.
7. Kenapa WebSocket harus diuji terpisah dari HTTP endpoint biasa?
8. Apa bedanya API jar dan container implementation?
9. Kapan binary transformation masuk akal?
10. Apa yang dimaksud “keep platform types at the perimeter”?

---

## 39. Practical Checklist

Sebelum memilih target Jakarta/Javax runtime:

```text
[ ] Identify current namespace: javax or jakarta
[ ] Identify current Servlet spec version
[ ] Identify current WebSocket spec version
[ ] Identify current container version
[ ] Identify Java runtime version
[ ] Identify framework generation
[ ] Find all direct servlet/websocket imports
[ ] Find all descriptor/resource references
[ ] Find all third-party filters/listeners/servlet extensions
[ ] Find all WebSocket endpoints/configurators/encoders/decoders
[ ] Find JSP/JSTL/EL usage
[ ] Check dependency tree for mixed javax/jakarta artifacts
[ ] Decide target platform
[ ] Align source, dependencies, framework, container
[ ] Run HTTP regression
[ ] Run WebSocket regression
[ ] Run proxy/session/timeout regression
[ ] Prepare rollback plan
```

---

## 40. Key Takeaways

1. `javax.*` ke `jakarta.*` adalah perubahan besar di type identity, bukan sekadar kosmetik import.
2. Jakarta EE 8 masih `javax.*`; Jakarta EE 9+ memakai `jakarta.*`.
3. Servlet 5.0 adalah titik namespace switch; Servlet 6.x adalah generasi Jakarta modern.
4. WebSocket 2.x adalah generasi Jakarta namespace; WebSocket 1.x adalah legacy `javax.websocket.*`.
5. Tomcat 9 adalah dunia `javax.*`; Tomcat 10/11 adalah dunia `jakarta.*`.
6. Spring Boot 2 umumnya `javax.*`; Spring Boot 3 menggunakan Jakarta APIs dan membutuhkan Java 17+.
7. Semua komponen yang menyentuh Servlet/WebSocket API harus konsisten namespace-nya.
8. Migration enterprise harus mengaudit source, dependency, descriptor, reflection, service loader, JSP, dan runtime container.
9. Architecture yang baik menjaga Servlet/WebSocket types tetap di perimeter, bukan menyebar ke domain/common layer.
10. Top-tier engineer tidak sekadar “replace import”; mereka membuat compatibility matrix dan failure model.

---

## 41. Referensi Utama

- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/
- Jakarta Servlet 6.1 Spec Document: https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta WebSocket 2.2 Specification: https://jakarta.ee/specifications/websocket/2.2/
- Jakarta WebSocket 2.2 Spec Document: https://jakarta.ee/specifications/websocket/2.2/jakarta-websocket-spec-2.2
- Jakarta EE Specifications: https://jakarta.ee/specifications/
- Jakarta EE 9 namespace migration discussion: https://jakarta.ee/blogs/javax-jakartaee-namespace-ecosystem-progress/
- Jakarta EE Platform 9 namespace section: https://jakarta.ee/specifications/platform/9/jakarta-platform-spec-9.html
- Apache Tomcat version mapping: https://tomcat.apache.org/whichversion.html
- Apache Tomcat migration guide 10.0: https://tomcat.apache.org/migration-10.html
- Apache Tomcat project overview: https://tomcat.apache.org/
- Eclipse Jetty 12.1 documentation: https://jetty.org/docs/jetty/12.1/index.html
- Jetty 12.0 to 12.1 migration: https://jetty.org/docs/jetty/12.1/programming-guide/migration/12.0-to-12.1.html
- Spring Boot 3 preparation note: https://spring.io/blog/2022/05/24/preparing-for-spring-boot-3-0
- OpenRewrite Jakarta migration recipes: https://docs.openrewrite.org/recipes/java/migrate/jakarta
- Eclipse Transformer project: https://projects.eclipse.org/projects/technology.transformer

---

## 42. Penutup

Bagian ini membangun fondasi untuk semua bagian berikutnya. Mulai Part 002, kita masuk ke HTTP fundamentals for Servlet engineers. Itu penting karena Servlet bukan “API controller”; Servlet adalah kontrak Java terhadap HTTP request/response lifecycle.

Jika bagian ini diringkas menjadi satu prinsip:

> Sebelum mendesain atau memigrasi aplikasi Servlet/WebSocket, pastikan Anda tahu persis berada di dunia `javax.*` atau `jakarta.*`, lalu align source code, dependency, framework, container, dan deployment runtime pada dunia yang sama.

---

**Status seri:** belum selesai.  
**Bagian selesai:** Part 001 dari 031.  
**Berikutnya:** Part 002 — HTTP Fundamentals for Servlet Engineers.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 000 — Mental Model Server-Side Java Web Runtime](./learn-java-servlet-websocket-web-container-runtime-part-000.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 002 — HTTP Fundamentals for Servlet Engineers](./learn-java-servlet-websocket-web-container-runtime-part-002.md)
