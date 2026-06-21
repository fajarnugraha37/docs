# learn-java-eclipse-jersey-deployment-models-part-009  
# Part 9 — Classpath, Module Path, JPMS, dan Split-Package Problem

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 9 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami deployment Jersey pada level arsitektur runtime, bukan hanya cara menjalankan aplikasi.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: bagaimana dependency, classloader, module path, service discovery, dan namespace migration menentukan berhasil/gagalnya deployment Jersey.

---

## 1. Mengapa Part Ini Penting?

Pada banyak aplikasi Jersey, kegagalan deployment tidak terjadi karena:

- endpoint salah,
- `@Path` salah,
- JSON mapping salah,
- business logic salah,
- atau HTTP client salah.

Sering kali kegagalannya berada di layer yang lebih bawah:

- class tidak ditemukan,
- class ditemukan tapi versi salah,
- API ditemukan dari container, implementation ditemukan dari WAR,
- `javax.*` dan `jakarta.*` tercampur,
- provider ada tetapi tidak terdeteksi,
- provider terdeteksi dua kali,
- `META-INF/services` hilang karena shading,
- module path menolak split package,
- classloader container dan webapp saling “melihat” dependency yang tidak seharusnya,
- saat redeploy classloader lama masih tertahan oleh thread/static reference.

Part ini membahas lapisan tersebut.

Mental model utamanya:

> Jersey deployment bukan hanya soal “server mana yang menjalankan aplikasi”.  
> Jersey deployment juga soal **siapa yang memiliki class**, **siapa yang memuat class**, **class versi mana yang menang**, dan **bagaimana runtime menemukan extension/provider**.

Kalau bagian ini tidak dipahami, deployment akan terasa seperti trial-and-error: tambah dependency, exclude dependency, ubah scope, restart server, lalu berharap error hilang.

Engineer top-tier tidak bekerja seperti itu. Mereka membaca deployment sebagai **runtime graph**.

---

## 2. Model Besar: Dari Source Code ke Runtime Type Identity

Dalam Java, dua class dianggap sama bukan hanya karena nama fully qualified class-nya sama.

Secara runtime, identitas class kira-kira adalah:

```text
class identity = classloader + binary class name
```

Artinya:

```text
com.example.User loaded by ClassLoader A
```

tidak sama dengan:

```text
com.example.User loaded by ClassLoader B
```

walaupun bytecode-nya berasal dari file `.class` yang identik.

Ini sangat penting dalam deployment Jersey karena ada banyak aktor yang membawa class:

```text
JDK
  └─ java.base, java.logging, java.net.http, etc.

Servlet Container / Jakarta EE Server
  ├─ servlet-api
  ├─ jakarta.ws.rs-api / javax.ws.rs-api
  ├─ CDI implementation
  ├─ JSON-B / JSON-P / JAXB
  ├─ server internal libs
  └─ sometimes Jersey/Jakarta REST implementation

Web Application / WAR
  ├─ WEB-INF/classes
  ├─ WEB-INF/lib/*.jar
  ├─ app resources
  ├─ Jersey runtime jars
  ├─ JSON providers
  └─ custom filters/providers/features

Embedded Application
  ├─ application jar
  ├─ dependency jars
  ├─ embedded HTTP server
  ├─ Jersey runtime jars
  └─ providers/features

Module Path Application
  ├─ named modules
  ├─ automatic modules
  ├─ module descriptors
  └─ service declarations
```

Deployment menjadi benar kalau semua aktor ini punya batas kepemilikan yang jelas.

---

## 3. Classpath vs Module Path: Dua Dunia yang Berbeda

### 3.1 Classpath

Classpath adalah model lama Java.

Karakteristiknya:

- berbasis daftar direktori/JAR,
- urutan penting,
- tidak ada module boundary formal,
- duplicate class bisa terjadi,
- split package bisa terjadi,
- reflective access relatif bebas, terutama sebelum Java 16/17 tightening,
- cocok untuk Java 8,
- masih sangat umum untuk WAR, fat jar, dan banyak deployment enterprise.

Contoh:

```bash
java -cp "app.jar:lib/*" com.example.Main
```

Atau dalam servlet container:

```text
WEB-INF/classes
WEB-INF/lib/a.jar
WEB-INF/lib/b.jar
```

Model classpath mudah dipakai, tetapi kelemahannya:

> kalau ada dua JAR membawa class yang sama, runtime dapat memilih salah satu berdasarkan urutan classloader/classpath, dan hasilnya bisa tidak eksplisit.

Contoh masalah:

```text
WEB-INF/lib/jakarta.ws.rs-api-3.1.0.jar
TOMCAT/lib/jakarta.ws.rs-api-3.1.0.jar
```

atau lebih buruk:

```text
WEB-INF/lib/javax.ws.rs-api-2.1.1.jar
WEB-INF/lib/jakarta.ws.rs-api-3.1.0.jar
```

Compiler mungkin berhasil. Runtime bisa gagal aneh.

---

### 3.2 Module Path / JPMS

Module path diperkenalkan di Java 9 lewat Java Platform Module System.

Karakteristiknya:

- setiap module punya nama,
- module menyatakan dependency melalui `requires`,
- package ownership lebih ketat,
- split package antar module tidak diperbolehkan,
- reflective access perlu `opens`,
- service discovery memakai `uses` dan `provides`,
- lebih eksplisit,
- lebih aman untuk long-term maintainability,
- tetapi lebih sulit untuk library ecosystem yang belum sepenuhnya modular.

Contoh:

```bash
java --module-path mods:lib \
     --module com.example.app/com.example.Main
```

Contoh `module-info.java` sederhana:

```java
module com.example.api {
    requires jakarta.ws.rs;
    requires org.glassfish.jersey.server;

    exports com.example.resource;
}
```

Namun untuk Jersey deployment, JPMS harus dipakai dengan hati-hati karena banyak integrasi framework masih mengandalkan:

- reflection,
- service loader,
- annotation scanning,
- injection,
- runtime-generated proxies,
- provider discovery.

JPMS bukan sekadar mengganti `-cp` menjadi `--module-path`.

---

## 4. Deployment Model dan Class Loading Boundary

### 4.1 WAR di Servlet Container

Pada WAR deployment, struktur class biasanya:

```text
my-app.war
├─ WEB-INF/classes/
│  └─ com/example/...
└─ WEB-INF/lib/
   ├─ jersey-server.jar
   ├─ jersey-container-servlet-core.jar
   ├─ jersey-hk2.jar
   ├─ jackson-provider.jar
   └─ app-dependencies.jar
```

Container juga punya library sendiri:

```text
$CATALINA_HOME/lib/
$PAYARA_HOME/glassfish/modules/
$WILDFLY_HOME/modules/
```

Di sini pertanyaan utamanya:

> Jersey runtime dimiliki oleh WAR atau oleh container?

Ada dua style:

#### Style A — Application-owned Jersey

Aplikasi membawa Jersey sendiri di `WEB-INF/lib`.

Cocok untuk:

- Tomcat,
- Jetty external,
- servlet-only container,
- aplikasi yang ingin mengontrol versi Jersey,
- deployment yang menghindari server-provided JAX-RS implementation.

Risiko:

- jangan masukkan API yang seharusnya disediakan container jika container sudah punya versi berbeda,
- jangan mencampur Jersey implementation server dan WAR,
- hati-hati terhadap duplicate service providers.

#### Style B — Container-owned Jersey/Jakarta REST

Server menyediakan implementation.

Cocok untuk:

- GlassFish,
- Payara,
- Open Liberty,
- WildFly,
- full Jakarta EE runtime.

Risiko:

- aplikasi tidak bebas memilih versi Jersey,
- bundled Jersey di WAR bisa bentrok dengan server module,
- dependency `provided` harus tepat,
- extension Jersey tertentu mungkin tidak cocok dengan runtime bawaan server.

Rule of thumb:

```text
Tomcat/Jetty servlet container:
  usually application owns Jersey implementation.

Full Jakarta EE server:
  usually container owns Jakarta REST implementation.
```

Tapi ini bukan hukum absolut. Yang penting adalah ownership harus eksplisit.

---

### 4.2 Embedded Deployment

Pada embedded model:

```text
java -jar app.jar
```

aplikasi membawa semuanya:

```text
application
  ├─ Jersey runtime
  ├─ embedded Grizzly/Jetty/Netty/JDK HTTP server
  ├─ JSON provider
  ├─ DI integration
  └─ config/logging/observability libs
```

Di sini classloader biasanya lebih sederhana dibanding WAR:

```text
system/application classloader
  └─ app classes + dependency jars
```

Namun fat jar/shaded jar dapat menciptakan masalah lain:

- duplicate class tersembunyi,
- `META-INF/services` tertimpa,
- signature file rusak,
- provider tidak terdaftar,
- automatic module name hilang,
- resource collision,
- package relocation salah.

Embedded bukan berarti bebas classpath problem. Ia hanya mengganti masalah classloader container menjadi masalah packaging artifact.

---

### 4.3 Docker/Kubernetes

Docker tidak mengubah aturan classloader Java.

Namun Docker membuat artifact boundary menjadi lebih eksplisit:

```text
image layer
  ├─ JDK/JRE layer
  ├─ dependency layer
  ├─ application layer
  └─ config/runtime layer
```

Masalah yang sering muncul:

- local run memakai dependency berbeda dengan image,
- image lama masih cached,
- base image Java berbeda dari CI,
- dependency layer tidak invalidated,
- runtime memakai Java 21 tapi build compile target Java 25,
- container memory limit memicu error yang disangka classpath issue,
- health check gagal karena Jersey belum selesai startup.

Dalam konteks classpath/module path:

> Docker tidak menyelesaikan dependency correctness. Docker hanya membuat dependency graph yang salah menjadi lebih reproducible.

---

## 5. Namespace Boundary: `javax.*` vs `jakarta.*`

Ini adalah boundary paling berbahaya dalam migrasi Jersey.

### 5.1 Jersey 2.x

Umumnya berada di dunia:

```java
javax.ws.rs.*
javax.servlet.*
javax.inject.*
javax.validation.*
```

Cocok untuk:

- Java 8,
- Java 11 legacy,
- Servlet 3.x/4.x,
- Java EE era,
- aplikasi enterprise lama.

Contoh:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.Produces;
```

---

### 5.2 Jersey 3.x

Berada di dunia:

```java
jakarta.ws.rs.*
jakarta.servlet.*
jakarta.inject.*
jakarta.validation.*
```

Cocok untuk:

- Java 11+,
- Jakarta EE 9/10 style,
- Servlet 5/6,
- migration setelah package rename.

Contoh:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
```

---

### 5.3 Jersey 4.x

Berada di dunia Jakarta REST 4.0 / Jakarta EE 11.

Implikasi besarnya:

- baseline Java modern,
- alignment dengan Jakarta EE 11,
- JAXB tidak lagi hard dependency di spesifikasi Jakarta REST 4.0,
- ManagedBean support dihapus dari spesifikasi,
- lebih relevan untuk Java 17+ dan Java 21/25 deployment modern.

---

### 5.4 Kenapa Tidak Boleh Dicampur?

Karena ini bukan rename kosmetik.

Class ini:

```java
javax.ws.rs.core.Response
```

bukan class yang sama dengan:

```java
jakarta.ws.rs.core.Response
```

Resource ini:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;

@Path("/users")
public class UserResource {
    @GET
    public String list() {
        return "ok";
    }
}
```

tidak akan dikenali oleh runtime yang mencari annotation:

```java
jakarta.ws.rs.Path
```

Begitu pula sebaliknya.

Checklist:

```text
Satu aplikasi Jersey harus hidup dalam satu namespace utama:

Jersey 2.x:
  javax.*

Jersey 3.x/4.x:
  jakarta.*
```

Kalau ada library internal lama masih expose `javax.ws.rs.Response`, jangan langsung ditempel ke aplikasi `jakarta.*`. Buat adapter boundary.

---

## 6. API JAR vs Implementation JAR

Banyak bug deployment terjadi karena engineer tidak membedakan API dan implementation.

Contoh API:

```text
jakarta.ws.rs-api
jakarta.servlet-api
jakarta.inject-api
jakarta.validation-api
jakarta.json-api
```

Contoh implementation/runtime:

```text
jersey-server
jersey-container-servlet-core
jersey-hk2
jersey-media-json-jackson
hibernate-validator
weld
eclipselink
```

API biasanya berisi:

```text
interfaces
annotations
contracts
exceptions
```

Implementation berisi:

```text
runtime logic
scanning
dispatching
serialization
injection
provider selection
container adapter
```

Deployment failure klasik:

```text
Compile succeeds because API exists.
Runtime fails because implementation missing.
```

Contoh:

```text
jakarta.ws.rs-api exists
but jersey-server missing
```

Atau:

```text
jersey-server exists
but servlet integration jar missing
```

Atau:

```text
jakarta.validation-api exists
but validator implementation missing
```

Mental model:

```text
API jar makes code compile.
Implementation jar makes code run.
Container adapter makes code attach to hosting runtime.
Provider jar makes entity conversion work.
```

---

## 7. Jersey Dependency Families

Untuk deployment reasoning, pisahkan dependency Jersey menjadi beberapa keluarga.

### 7.1 Core Runtime

Biasanya:

```text
jersey-common
jersey-server
```

Fungsinya:

- model resource,
- provider registry,
- request processing,
- exception mapping,
- entity provider pipeline,
- feature/config handling.

Tanpa ini, Jersey runtime tidak hidup.

---

### 7.2 Container Adapter

Contoh:

```text
jersey-container-servlet-core
jersey-container-servlet
jersey-container-grizzly2-http
jersey-container-jetty-http
jersey-container-jdk-http
jersey-container-netty-http
```

Fungsinya:

> menjembatani hosting runtime ke Jersey runtime.

Tanpa adapter, Jersey tidak tahu cara menerima request dari host tertentu.

Mapping mental:

```text
Servlet container:
  needs servlet adapter

Grizzly:
  needs grizzly adapter

Jetty embedded:
  needs jetty adapter

JDK HTTP Server:
  needs jdk-http adapter

Netty:
  needs netty adapter
```

---

### 7.3 Injection Integration

Contoh:

```text
jersey-hk2
jersey-cdi1x / cdi-related integration
```

Fungsinya:

- object lifecycle,
- injection,
- binder registration,
- per-request scope,
- provider/resource instantiation.

Error yang sering muncul:

```text
InjectionManagerFactory not found
Unsatisfied dependency
No injection source found
```

Root cause sering bukan “DI salah”, melainkan dependency injection bridge tidak ada atau bentrok.

---

### 7.4 Media Providers

Contoh:

```text
jersey-media-json-jackson
jersey-media-json-binding
jersey-media-moxy
jersey-media-multipart
```

Fungsinya:

- membaca request body,
- menulis response body,
- memilih `MessageBodyReader`,
- memilih `MessageBodyWriter`.

Error klasik:

```text
MessageBodyWriter not found for media type application/json
MessageBodyReader not found for type ...
```

Root cause:

- provider jar tidak ada,
- provider tidak registered,
- auto-discovery disabled,
- shaded jar kehilangan service descriptor,
- JSON library version bentrok,
- namespace mismatch.

---

### 7.5 Extension Providers

Contoh:

```text
jersey-bean-validation
jersey-micrometer
jersey-mp-config
jersey-sse
```

Fungsinya tergantung extension:

- validation,
- metrics,
- config integration,
- server-sent events,
- multipart,
- tracing/observability bridge.

Rule:

```text
Extension dependency is not just library.
It often participates in runtime discovery and lifecycle.
```

---

## 8. ServiceLoader dan `META-INF/services`

Banyak framework Java, termasuk Jersey ecosystem dan provider libraries, memakai mekanisme discovery.

Secara umum, Java `ServiceLoader` membaca file:

```text
META-INF/services/<fully-qualified-interface-name>
```

Isi file biasanya daftar implementation class:

```text
com.example.MyProvider
com.example.MyFeature
```

Dalam deployment biasa, setiap JAR bisa punya file `META-INF/services`.

Namun dalam shaded/fat jar, file-file ini bisa tertimpa.

Contoh bahaya:

```text
dependency-a.jar
  META-INF/services/jakarta.ws.rs.ext.RuntimeDelegate

dependency-b.jar
  META-INF/services/jakarta.ws.rs.ext.RuntimeDelegate
```

Jika shading hanya mengambil salah satu, provider lain hilang.

Gejala:

- provider tidak ditemukan,
- JSON tidak aktif,
- runtime delegate salah,
- extension tidak jalan,
- error hanya muncul saat runtime.

Untuk Maven Shade, biasanya perlu service resource transformer.

Contoh konseptual:

```xml
<transformer implementation="org.apache.maven.plugins.shade.resource.ServicesResourceTransformer"/>
```

Untuk Gradle Shadow, biasanya:

```groovy
shadowJar {
    mergeServiceFiles()
}
```

Prinsipnya:

> kalau membuat fat jar Jersey, service descriptors harus digabung, bukan ditimpa.

---

## 9. Split Package Problem

Split package terjadi ketika package yang sama berada di lebih dari satu artifact/module.

Contoh:

```text
jar-a:
  com.example.common.Foo

jar-b:
  com.example.common.Bar
```

Pada classpath, ini sering “boleh” walaupun berbahaya.

Pada module path, ini biasanya ditolak karena module system ingin satu package dimiliki oleh satu module.

Mengapa ini berbahaya?

Karena package bukan hanya folder. Package juga terkait:

- package-private access,
- sealed package,
- module ownership,
- reflective access,
- class identity expectation,
- service discovery assumptions.

Contoh buruk pada modular system:

```text
module com.example.a exports com.example.common
module com.example.b exports com.example.common
```

Runtime/module resolution dapat gagal.

Dalam Jersey deployment, split package sering muncul akibat:

- internal shared library dipotong salah,
- generated client/server code berada pada package sama,
- shaded dependency tidak direlokasi dengan benar,
- migration `javax` ke `jakarta` menyisakan dua varian library,
- multi-module Maven project punya package overlap.

Rule:

```text
Satu package harus punya satu owner artifact/module.
```

Kalau butuh membagi layer, ubah package:

```text
com.example.user.api
com.example.user.resource
com.example.user.service
com.example.user.persistence
```

Jangan:

```text
module-a: com.example.user
module-b: com.example.user
module-c: com.example.user
```

---

## 10. Duplicate Class Problem

Duplicate class lebih kasar daripada split package.

Contoh:

```text
WEB-INF/lib/lib-a.jar contains com.example.JsonUtil
WEB-INF/lib/lib-b.jar contains com.example.JsonUtil
```

Atau:

```text
WEB-INF/lib/jackson-databind-2.15.jar
WEB-INF/lib/jackson-databind-2.17.jar
```

Atau:

```text
container/lib/jakarta.ws.rs-api.jar
WEB-INF/lib/jakarta.ws.rs-api.jar
```

Gejala:

- `NoSuchMethodError`,
- `NoSuchFieldError`,
- `ClassCastException`,
- provider not found,
- method exists at compile time but missing at runtime,
- serialization behavior berbeda antara local dan server.

`NoSuchMethodError` sangat sering berarti:

```text
Code was compiled against version X.
Runtime loaded version Y.
```

Contoh:

```text
compile:
  jersey-server 3.1.x

runtime:
  jersey-common 3.0.x
```

Maka class ada, tapi method yang diharapkan tidak ada.

---

## 11. WAR Classloader Reality

Servlet container biasanya memakai hierarki classloader.

Model sederhananya:

```text
Bootstrap ClassLoader
  └─ Platform/System ClassLoader
      └─ Container Common ClassLoader
          └─ WebApp ClassLoader
```

Namun banyak servlet container melakukan pengecualian terhadap parent-first delegation untuk webapp agar `WEB-INF/classes` dan `WEB-INF/lib` dapat punya prioritas tertentu terhadap aplikasi.

Konsekuensi:

- behavior Tomcat, Jetty, Payara, WildFly, Open Liberty bisa berbeda,
- menaruh dependency di global container lib dapat mengubah semua aplikasi,
- satu aplikasi bisa “sembuh”, aplikasi lain bisa rusak,
- shared library global meningkatkan blast radius.

Prinsip production:

```text
Default: keep application dependencies inside application boundary.

Only put libraries in container/global lib if:
  - they are truly shared infrastructure,
  - version is centrally governed,
  - all apps are tested against the same version,
  - rollback plan exists.
```

Untuk Jakarta EE server, konsepnya sedikit berbeda karena server memang menyediakan banyak implementation module. Di situ dependency aplikasi harus disesuaikan dengan runtime server.

---

## 12. Dependency Scope Strategy

### 12.1 Maven WAR for Tomcat/Jetty Servlet Container

Umumnya:

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

<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-json-jackson</artifactId>
  <version>${jersey.version}</version>
</dependency>
```

Servlet API biasanya:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>${servlet.version}</version>
  <scope>provided</scope>
</dependency>
```

Karena servlet API disediakan oleh container.

Namun Jersey implementation biasanya **tidak** `provided` di Tomcat/Jetty kalau container tidak menyediakan Jersey.

---

### 12.2 Maven WAR for Full Jakarta EE Server

Pada full Jakarta EE server:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Sering kali Jakarta APIs disediakan server.

Tergantung server:

- jangan bundle implementation yang server sudah punya,
- jangan bundle Jersey jika server memakai implementation REST lain kecuali server mendukung override secara eksplisit,
- baca dokumentasi server classloading/module.

Prinsipnya:

```text
If container owns runtime:
  app depends on API as provided.

If app owns runtime:
  app packages implementation.
```

---

### 12.3 Embedded Jar

Embedded harus membawa semua implementation:

```xml
<dependency>
  <groupId>org.glassfish.jersey.containers</groupId>
  <artifactId>jersey-container-grizzly2-http</artifactId>
</dependency>

<dependency>
  <groupId>org.glassfish.jersey.inject</groupId>
  <artifactId>jersey-hk2</artifactId>
</dependency>

<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-json-jackson</artifactId>
</dependency>
```

Tidak ada container eksternal yang akan menyelamatkan dependency missing.

---

## 13. BOM: Menjaga Versi Tetap Konsisten

Untuk Jersey, hindari menentukan versi tiap artifact secara manual tanpa governance.

Buruk:

```xml
<dependency>
  <artifactId>jersey-server</artifactId>
  <version>3.1.6</version>
</dependency>

<dependency>
  <artifactId>jersey-hk2</artifactId>
  <version>3.0.8</version>
</dependency>

<dependency>
  <artifactId>jersey-media-json-jackson</artifactId>
  <version>3.1.2</version>
</dependency>
```

Lebih baik:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.glassfish.jersey</groupId>
      <artifactId>jersey-bom</artifactId>
      <version>${jersey.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Lalu dependency tidak perlu version individual:

```xml
<dependency>
  <groupId>org.glassfish.jersey.core</groupId>
  <artifactId>jersey-server</artifactId>
</dependency>
```

Dengan Gradle platform:

```groovy
dependencies {
    implementation platform("org.glassfish.jersey:jersey-bom:${jerseyVersion}")
    implementation "org.glassfish.jersey.core:jersey-server"
    implementation "org.glassfish.jersey.inject:jersey-hk2"
    implementation "org.glassfish.jersey.media:jersey-media-json-jackson"
}
```

Mental model:

> Jersey runtime harus diperlakukan sebagai satu family version, bukan kumpulan artifact independen.

---

## 14. JPMS untuk Jersey: Kapan Dipakai?

JPMS berguna jika:

- aplikasi Java SE/embedded,
- ingin explicit module boundary,
- library internal sudah modular,
- deployment bukan WAR klasik,
- team mampu mengelola `requires`, `exports`, `opens`,
- testing module path dijalankan di CI.

JPMS kurang cocok jika:

- aplikasi WAR lama,
- banyak library belum modular,
- masih Java 8,
- ada banyak annotation scanning/reflection,
- ingin migrasi cepat dari Jersey 2 ke 3,
- team belum punya dependency governance kuat.

Untuk top-tier engineering, pertanyaannya bukan:

```text
“Haruskah semua aplikasi dibuat modular?”
```

Tetapi:

```text
“Apakah module boundary memberi nilai lebih besar daripada kompleksitasnya untuk deployment model ini?”
```

---

## 15. `exports` vs `opens`

Dalam JPMS:

### `exports`

Membuat package bisa dipakai secara compile-time oleh module lain.

```java
module com.example.api {
    exports com.example.api;
}
```

### `opens`

Membuka package untuk deep reflection runtime.

```java
module com.example.app {
    opens com.example.resource to org.glassfish.jersey.server;
}
```

Atau membuka semua package:

```java
open module com.example.app {
    requires jakarta.ws.rs;
    requires org.glassfish.jersey.server;
}
```

Untuk framework seperti Jersey, Jackson, validation, CDI, reflection sering dibutuhkan.

Contoh resource:

```java
@Path("/users")
public class UserResource {
    @GET
    public List<UserDto> list() {
        return List.of(new UserDto("fajar"));
    }
}
```

Jackson mungkin perlu reflection ke DTO:

```java
public class UserDto {
    public String name;

    public UserDto() {
    }

    public UserDto(String name) {
        this.name = name;
    }
}
```

Kalau DTO package tidak terbuka, serialization/deserialization bisa gagal pada module path.

Rule:

```text
exports = compile-time/public API access
opens   = runtime reflection access
```

Jangan memakai `exports` untuk semua hal hanya karena reflection gagal. Itu membuat boundary module bocor.

---

## 16. Automatic Modules

Kalau JAR tidak punya `module-info.class`, tetapi diletakkan di module path, ia bisa menjadi automatic module.

Risiko automatic module:

- nama module bisa berasal dari file JAR,
- nama bisa berubah jika artifact berubah,
- semua package diexport,
- dependency readability lebih longgar,
- bisa menunda problem modularity sampai runtime/upgrade.

Contoh:

```text
my-lib-1.0.0.jar
```

dapat menjadi module otomatis dengan nama turunan tertentu.

Untuk application deployment, automatic modules bisa berguna sebagai jembatan, tapi jangan dianggap desain final.

Rule:

```text
Automatic module is migration bridge, not architectural foundation.
```

---

## 17. Resource Scanning dan Module Boundary

Jersey dapat menemukan resource/provider melalui:

- explicit registration,
- package scanning,
- class scanning,
- servlet init params,
- `Application` subclass,
- `ResourceConfig`,
- service discovery,
- framework integration.

Pada classpath, scanning relatif bebas.

Pada module path, scanning bisa terkendala oleh:

- module readability,
- non-exported package,
- package not opened,
- classloader visibility,
- service declaration missing,
- runtime image/jlink excluding modules.

Karena itu, untuk deployment modular, explicit registration lebih aman:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(UserResource.class);
        register(HealthResource.class);
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);
    }
}
```

Dibanding:

```java
packages("com.example");
```

Package scanning nyaman, tetapi pada deployment kompleks ia memperbesar ruang ketidakpastian.

---

## 18. Shading, Relocation, dan Fat Jar

Fat jar sering dipakai untuk embedded deployment.

Namun shading bukan sekadar menggabungkan JAR.

Masalah umum:

### 18.1 Service Descriptor Hilang

```text
META-INF/services/... overwritten
```

Efek:

```text
provider not found
feature not loaded
runtime delegate missing
```

### 18.2 Resource Collision

```text
META-INF/jersey-module-version
META-INF/LICENSE
META-INF/NOTICE
META-INF/services/*
```

### 18.3 Signature Files Bermasalah

Signed JAR punya:

```text
META-INF/*.SF
META-INF/*.DSA
META-INF/*.RSA
```

Setelah shading, signature bisa invalid.

### 18.4 Relocation Salah

Relocation bisa memindahkan package dependency:

```text
com.fasterxml.jackson -> shaded.com.fasterxml.jackson
```

Tetapi framework/provider yang mencari class asli bisa gagal.

Jangan relocate framework core sembarangan:

- Jersey,
- Jakarta API,
- Jackson provider,
- Servlet API,
- HK2/CDI,
- validation provider.

Relocation lebih aman untuk dependency internal utility yang tidak menjadi bagian dari framework extension boundary.

---

## 19. Multi-Release JAR

Sejak Java 9, JAR bisa punya class berbeda untuk Java version berbeda:

```text
META-INF/versions/9/...
META-INF/versions/11/...
META-INF/versions/17/...
```

Ini disebut multi-release JAR.

Dalam konteks Java 8–25:

- compile di Java 8 bisa berbeda runtime di Java 17/21/25,
- behavior dependency bisa berubah karena class versi modern dipilih,
- shading tool harus mendukung multi-release JAR dengan benar,
- Docker base image Java version dapat mengubah class yang dipakai.

Gejala:

```text
works on Java 11
fails on Java 21
```

bukan selalu karena JDK breaking change. Bisa karena dependency memakai entry multi-release berbeda.

Checklist:

```text
- cek Manifest: Multi-Release: true
- cek dependency tree
- cek JDK runtime image
- cek shaded artifact preserve multi-release metadata
```

---

## 20. Build Target: `source`, `target`, `release`

Untuk Java 8–25, gunakan `--release` bila memungkinkan.

Maven:

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Gradle:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}

tasks.withType(JavaCompile).configureEach {
    options.release = 17
}
```

Kenapa `--release` lebih baik daripada hanya `source`/`target`?

Karena `--release` membatasi API JDK yang boleh dipakai sesuai target.

Contoh bahaya:

```text
compile with JDK 21
target bytecode 8
but accidentally call API added in Java 11
```

Bytecode bisa tampak compatible, tetapi runtime Java 8 gagal.

Rule:

```text
If target runtime is Java N, compile with --release N.
```

Untuk Jersey:

```text
Java 8 target:
  Jersey 2.x universe

Java 11+ target:
  Jersey 3.x possible

Java 17+ target:
  Jersey 4.x/Jakarta EE 11 universe possible
```

---

## 21. Runtime Mismatch Error Catalog

### 21.1 `ClassNotFoundException`

Artinya class dicari secara eksplisit tapi tidak ditemukan.

Contoh:

```text
java.lang.ClassNotFoundException:
org.glassfish.jersey.servlet.ServletContainer
```

Kemungkinan:

- servlet integration jar missing,
- dependency not packaged into WAR,
- wrong scope `provided`,
- classloader tidak melihat dependency.

---

### 21.2 `NoClassDefFoundError`

Class pernah diketahui saat compile/linking, tetapi gagal dimuat saat runtime.

Contoh:

```text
NoClassDefFoundError: jakarta/ws/rs/core/Application
```

Kemungkinan:

- API jar missing,
- container tidak menyediakan API,
- wrong namespace,
- dependency excluded.

---

### 21.3 `NoSuchMethodError`

Class ada, method tidak ada.

Kemungkinan:

- version mismatch,
- compile dependency lebih baru daripada runtime,
- transitive dependency override,
- server-provided library lebih tua.

---

### 21.4 `ClassCastException`

Dua class tampak sama tapi dimuat classloader berbeda.

Contoh konseptual:

```text
com.example.User cannot be cast to com.example.User
```

Kemungkinan:

- duplicate class across classloaders,
- shared lib + webapp lib,
- redeploy stale classloader,
- server module conflict.

---

### 21.5 `LinkageError`

Keluarga error yang sering berarti binary incompatibility.

Contoh:

```text
loader constraint violation
```

Kemungkinan:

- classloader boundary salah,
- API class dimuat dari dua tempat,
- mixed implementation/API.

---

### 21.6 Provider Not Found

Contoh:

```text
MessageBodyWriter not found for media type application/json
```

Kemungkinan:

- JSON provider missing,
- provider not registered,
- service descriptor lost,
- wrong namespace,
- media type mismatch,
- DTO inaccessible by module reflection.

---

## 22. Diagnostic Workflow: Cara Membaca Masalah Classpath

Jangan langsung “coba exclude ini”. Pakai workflow.

### Step 1 — Identifikasi Error Type

```text
ClassNotFoundException?
NoClassDefFoundError?
NoSuchMethodError?
ClassCastException?
Provider not found?
Injection error?
```

Setiap jenis error punya arah investigasi berbeda.

---

### Step 2 — Cari Class yang Bermasalah

Misalnya:

```text
jakarta/ws/rs/core/Response
```

Terjemahkan ke artifact candidate:

```text
jakarta.ws.rs-api
```

Atau:

```text
org/glassfish/jersey/server/ResourceConfig
```

Candidate:

```text
jersey-server
```

Atau:

```text
org/glassfish/jersey/servlet/ServletContainer
```

Candidate:

```text
jersey-container-servlet-core / jersey-container-servlet
```

---

### Step 3 — Cek Dependency Tree

Maven:

```bash
mvn dependency:tree
```

Lebih spesifik:

```bash
mvn dependency:tree -Dincludes=org.glassfish.jersey
mvn dependency:tree -Dincludes=jakarta.ws.rs
mvn dependency:tree -Dincludes=javax.ws.rs
mvn dependency:tree -Dverbose
```

Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jersey-server
./gradlew dependencyInsight --dependency jakarta.ws.rs-api
```

---

### Step 4 — Cek Artifact Final

Untuk WAR:

```bash
jar tf target/my-app.war | grep WEB-INF/lib
jar tf target/my-app.war | grep jersey
jar tf target/my-app.war | grep jakarta.ws.rs
jar tf target/my-app.war | grep javax.ws.rs
```

Untuk fat jar:

```bash
jar tf build/libs/app-all.jar | grep META-INF/services
jar tf build/libs/app-all.jar | grep jakarta/ws/rs
```

---

### Step 5 — Cek Container Lib

Tomcat:

```text
$CATALINA_HOME/lib
```

Payara/GlassFish:

```text
domain/lib
glassfish/modules
```

WildFly:

```text
modules/system/layers/base
```

Open Liberty:

```text
wlp/usr/servers/<server>/lib
feature configuration
```

Pertanyaannya:

```text
Class ini dimuat dari WAR atau server?
```

---

### Step 6 — Log Code Source

Tambahkan diagnostic sementara:

```java
static void printCodeSource(Class<?> type) {
    var source = type.getProtectionDomain()
        .getCodeSource();

    System.out.println(type.getName() + " -> " +
        (source == null ? "<unknown>" : source.getLocation()));
}
```

Contoh pemakaian:

```java
printCodeSource(jakarta.ws.rs.core.Response.class);
printCodeSource(org.glassfish.jersey.server.ResourceConfig.class);
printCodeSource(org.glassfish.jersey.servlet.ServletContainer.class);
printCodeSource(com.fasterxml.jackson.databind.ObjectMapper.class);
```

Ini sangat powerful.

Output dapat menjawab:

```text
Class loaded from:
  WEB-INF/lib/...
or:
  /opt/tomcat/lib/...
or:
  server module...
```

---

## 23. Namespace Audit Script Concept

Untuk migration, lakukan audit sederhana.

Cari `javax`:

```bash
grep -R "javax.ws.rs" -n src/main/java
grep -R "javax.servlet" -n src/main/java
grep -R "javax.inject" -n src/main/java
```

Cari `jakarta`:

```bash
grep -R "jakarta.ws.rs" -n src/main/java
grep -R "jakarta.servlet" -n src/main/java
grep -R "jakarta.inject" -n src/main/java
```

Kalau keduanya muncul dalam satu deployable unit, berhenti dulu.

Untuk Maven dependency:

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

Rule:

```text
Mixed namespace is allowed only across explicit adapter boundary,
not inside the same runtime surface.
```

Contoh adapter boundary:

```text
legacy-client-lib uses javax.ws.rs types internally
new-api-app exposes jakarta.ws.rs resources

Boundary:
  convert legacy DTO/result to new app DTO/result
  do not leak javax.ws.rs.Response to jakarta resource layer
```

---

## 24. Classpath Governance untuk Multi-Module Project

Aplikasi enterprise sering multi-module:

```text
api
domain
application
infrastructure
rest
deployment
```

Masalah muncul ketika semua module bebas membawa dependency.

Lebih aman:

```text
root dependency management
  ├─ defines Jersey version
  ├─ defines Jakarta API version
  ├─ defines Jackson version
  ├─ defines validation version
  └─ bans duplicate/conflicting versions
```

Maven Enforcer contoh:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-enforcer-plugin</artifactId>
  <executions>
    <execution>
      <id>enforce</id>
      <goals>
        <goal>enforce</goal>
      </goals>
      <configuration>
        <rules>
          <dependencyConvergence/>
          <requireUpperBoundDeps/>
        </rules>
      </configuration>
    </execution>
  </executions>
</plugin>
```

Gradle bisa memakai:

```groovy
configurations.all {
    resolutionStrategy {
        failOnVersionConflict()
    }
}
```

Namun hati-hati: fail-on-conflict bisa noisy. Untuk enterprise system, lebih baik noisy di CI daripada silent mismatch di production.

---

## 25. Recommended Dependency Ownership by Deployment Model

### 25.1 Tomcat + Jersey WAR

```text
Container owns:
  Servlet API
  JSP/static/default servlet if used

Application owns:
  Jersey runtime
  Jersey servlet adapter
  JSON provider
  validation provider
  application dependencies
```

Avoid:

```text
Putting Jersey jars in Tomcat/lib
Bundling servlet-api without provided scope
Mixing javax and jakarta
```

---

### 25.2 Jetty External + Jersey WAR

```text
Container owns:
  Servlet engine

Application owns:
  Jersey runtime unless Jetty distro explicitly provides integration
```

Check:

```text
Jetty version vs Servlet namespace
Jersey version vs Servlet namespace
```

---

### 25.3 Payara/GlassFish

```text
Container often owns:
  Jakarta REST implementation
  Servlet
  CDI
  validation
  JSON-B/JSON-P
  JTA
  JPA
```

Application often owns:

```text
business code
app-specific libraries
maybe provider extension if compatible
```

Avoid:

```text
Bundling random Jersey implementation version into WAR
unless server override strategy is explicit.
```

---

### 25.4 Open Liberty

```text
Runtime owns features selected in server.xml.
Application should align with enabled Jakarta EE/Jakarta REST features.
```

Risk:

```text
Feature version and app dependency namespace mismatch.
```

---

### 25.5 Embedded Grizzly/Jetty/Netty

```text
Application owns:
  everything except JDK
```

Must ensure:

```text
Jersey family version aligned
HTTP server adapter included
Service files preserved in fat jar
No duplicate JSON/Jakarta API conflicts
```

---

## 26. Security Angle: Classpath as Attack Surface

Classpath is not only reliability. It is security.

Risks:

- dependency confusion,
- transitive dependency hijack,
- class shadowing,
- malicious provider discovered by ServiceLoader,
- vulnerable version loaded because of transitive override,
- global container lib affecting all apps,
- duplicate class hiding patched class,
- old library loaded before patched one.

Production governance:

```text
- lock dependency versions
- generate SBOM
- scan transitive dependencies
- ban duplicate classes
- pin repositories
- avoid global container libs
- sign or verify artifacts where required
- log runtime code source for critical classes
```

For regulated systems, dependency graph is part of defensibility.

You should be able to answer:

```text
Which Jersey version handled this request?
Which JSON provider serialized this response?
Which API jar was loaded?
Which container module supplied Servlet API?
Which artifact introduced this vulnerable class?
```

---

## 27. Build-Time Checks Worth Having

### 27.1 Dependency Tree Check

CI should archive:

```bash
mvn dependency:tree
```

or:

```bash
./gradlew dependencies
```

For each release build.

---

### 27.2 Duplicate Class Check

Use plugin/tooling to detect duplicate classes.

Examples:

- Maven Enforcer extra rules,
- Gradle duplicate class plugins,
- custom script using `jar tf`,
- dependency analysis tool.

---

### 27.3 Namespace Check

Fail build if both exist unexpectedly:

```text
javax.ws.rs
jakarta.ws.rs
```

In same deployable.

---

### 27.4 Service Descriptor Check

For fat jar:

```text
META-INF/services entries must exist and be merged.
```

---

### 27.5 Runtime Smoke Test

Do not only test unit.

Start actual deployment artifact:

```text
WAR in container
or fat jar
or Docker image
```

Then verify:

```text
GET /health
GET /api/sample
POST /api/sample JSON
exception mapper
validation
security filter
metrics
shutdown
```

---

## 28. Java 8 to Java 25 Strategy

### Java 8

Prefer:

```text
Jersey 2.x
javax.*
classpath
WAR or embedded classpath
no JPMS
```

Main risks:

- old dependencies,
- TLS/cipher limitations,
- old servlet containers,
- backport pressure,
- security patching.

---

### Java 11

Possible:

```text
Jersey 2.x legacy
or Jersey 3.x if migrating to jakarta.*
```

Java 11 is a transition point.

---

### Java 17

Good baseline for:

```text
Jakarta EE 10/11 era
Jersey 3.x/4.x depending runtime
modern containers
stronger encapsulation awareness
```

---

### Java 21

Modern LTS.

Consider:

- virtual thread experiments,
- newer GC behavior,
- better container ergonomics,
- stronger dependency hygiene.

---

### Java 25

Modern LTS target.

Consider:

- keep deployment model conservative first,
- run compatibility test suite,
- validate container support,
- validate Jersey/runtime version,
- validate bytecode target,
- validate observability agent compatibility,
- validate Docker base image and CI toolchain.

Rule:

```text
Upgrade Java runtime and Jersey major version separately if possible.
```

Do not combine:

```text
Java 8 -> 25
Jersey 2 -> 4
javax -> jakarta
Tomcat 8 -> Tomcat 11
WAR -> Docker/Kubernetes
```

in one uncontrolled migration.

That is not modernization. That is a blast radius generator.

---

## 29. Practical Decision Framework

Ask these questions:

### 29.1 Who owns Jersey runtime?

```text
Application?
Container?
```

### 29.2 Which namespace?

```text
javax.*
jakarta.*
```

### 29.3 Which Java baseline?

```text
8, 11, 17, 21, 25?
```

### 29.4 Which artifact type?

```text
WAR?
thin jar?
fat jar?
Docker image?
server deployment?
```

### 29.5 Which discovery model?

```text
explicit registration?
package scanning?
service loader?
container integration?
```

### 29.6 Which classloading model?

```text
single classloader?
webapp classloader?
server module classloader?
module path?
```

### 29.7 Which dependencies are provided?

```text
Servlet API?
Jakarta REST API?
CDI?
Validation?
JSON-B/P?
Jersey implementation?
```

### 29.8 What is the failure proof?

```text
dependency tree archived
artifact inspected
runtime code source logged
smoke test executed
provider pipeline tested
shutdown tested
```

---

## 30. Example: Bad Deployment

```text
Java 17
Tomcat 10
Jersey 3.1
WAR
```

But dependencies:

```text
WEB-INF/lib/javax.ws.rs-api-2.1.jar
WEB-INF/lib/jakarta.ws.rs-api-3.1.jar
WEB-INF/lib/jersey-server-3.1.jar
WEB-INF/lib/jersey-container-servlet-core-2.35.jar
WEB-INF/lib/jackson-jaxrs-json-provider built for javax
```

Symptoms:

```text
resource not found
MessageBodyWriter not found
NoSuchMethodError
ClassCastException
startup warning ignored
```

Root problem:

```text
mixed namespace
mixed Jersey major versions
wrong JSON provider generation
runtime graph invalid
```

Fix is not “try another annotation”.

Fix:

```text
align all to jakarta.*
align all Jersey artifacts to same family version
use Jersey 3.x compatible JSON provider
remove javax.ws.rs
verify WAR contents
run smoke test
```

---

## 31. Example: Good Deployment

```text
Java 21
Tomcat 10.1
Jersey 3.1.x
WAR
```

Ownership:

```text
Tomcat owns:
  jakarta.servlet-api

Application owns:
  jersey-server
  jersey-container-servlet-core
  jersey-hk2
  jersey-media-json-jackson
  app dependencies
```

Build:

```text
Jersey BOM imported
Servlet API scope provided
no javax.ws.rs dependency
dependency convergence enforced
WAR inspected in CI
```

Runtime:

```text
/health starts
/api/sample GET works
/api/sample POST JSON works
exception mapper works
validation tested
code source diagnostic available
```

This is boring. Boring deployment is good deployment.

---

## 32. Production Checklist

Before deploying Jersey app, answer:

```text
[ ] Which Java version is used at runtime?
[ ] Which Java version is used at compile time?
[ ] Is --release configured correctly?
[ ] Which Jersey major version is used?
[ ] Are all Jersey artifacts same family version?
[ ] Is the app javax.* or jakarta.*?
[ ] Is any javax.ws.rs dependency present in jakarta app?
[ ] Is any jakarta.ws.rs dependency present in javax app?
[ ] Who owns Servlet API?
[ ] Who owns Jakarta REST/JAX-RS API?
[ ] Who owns Jersey implementation?
[ ] Is Jersey packaged in WAR or provided by server?
[ ] Is servlet adapter present?
[ ] Is injection integration present?
[ ] Is JSON provider present?
[ ] Are providers explicitly registered or reliably discovered?
[ ] Are META-INF/services preserved in fat jar?
[ ] Are duplicate classes checked?
[ ] Is dependency tree archived?
[ ] Is final WAR/JAR inspected?
[ ] Is runtime code source diagnosable?
[ ] Is deployment tested in the same container/image as production?
[ ] Is classloader leakage checked on redeploy?
[ ] Are global container libs minimized?
[ ] Is SBOM generated?
[ ] Is rollback artifact known?
```

---

## 33. Key Takeaways

1. Jersey deployment correctness depends on **runtime graph correctness**, not just source code correctness.

2. Class identity in Java is determined by both **class name** and **classloader**.

3. WAR deployment adds classloader boundaries that embedded deployment does not have.

4. Embedded deployment simplifies container classloading but introduces fat jar/shading/service descriptor risks.

5. JPMS improves explicitness but requires careful handling of reflection, scanning, service loading, `exports`, and `opens`.

6. `javax.*` and `jakarta.*` are different universes. They must not be casually mixed.

7. API dependency makes code compile; implementation dependency makes code run; container adapter makes Jersey attach to the host.

8. `NoSuchMethodError` usually means version mismatch.

9. `ClassCastException` involving the same class name often means classloader duplication.

10. Top-tier engineers diagnose deployment by tracing **which artifact supplied which class at runtime**.

---

## 34. How This Part Connects to the Next Part

Part 9 built the dependency/classloading foundation.

Next, we move into:

```text
Part 10 — Embedded Grizzly Deployment Model
```

There we will apply this knowledge to a concrete Java SE deployment model:

```text
Jersey + Grizzly + ResourceConfig + explicit lifecycle + production shutdown
```

The key shift:

```text
From:
  “How does the JVM/container find Jersey classes?”

To:
  “How do we own the entire HTTP runtime ourselves in an embedded deployment?”
```

---

## References

- Eclipse Jersey documentation — Application Deployment and Runtime: https://eclipse-ee4j.github.io/jersey.github.io/documentation/3.0.1/deployment.html
- Eclipse Jersey documentation — Modules and Dependencies: https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest3x/modules-and-dependencies.html
- Jakarta RESTful Web Services 4.0: https://jakarta.ee/specifications/restful-ws/4.0/
- Apache Tomcat Class Loader How-To: https://tomcat.apache.org/tomcat-9.0-doc/class-loader-howto.html
- Jakarta EE Platform 11 specification page: https://jakarta.ee/specifications/platform/11/
- OpenJDK JDK 25 project: https://openjdk.org/projects/jdk/25/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-008.md">⬅️ Part 8 — Programmatic Deployment with `ResourceConfig`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-010.md">Part 10 — Embedded Grizzly Deployment Model ➡️</a>
</div>
