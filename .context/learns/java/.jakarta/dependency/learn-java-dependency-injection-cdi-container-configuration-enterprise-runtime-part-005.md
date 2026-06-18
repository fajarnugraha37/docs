# Part 005 — Classloaders, Modules, and Deployment Isolation

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-005.md`  
> Target Java: 8 hingga 25  
> Fokus: classloader, JPMS/module system, deployment isolation, WAR/EAR/server module boundary, dan cara mendiagnosis error runtime yang terlihat seperti masalah DI/CDI tetapi akar masalahnya adalah class visibility.

---

## 0. Posisi Bagian Ini Dalam Seri

Pada bagian sebelumnya kita membahas bahwa aplikasi enterprise Java tidak hidup sebagai sekumpulan object biasa. Object bisa dimiliki oleh CDI container, Servlet container, EJB container, Jakarta EE server, MicroProfile runtime, atau framework runtime lain.

Namun sebelum container bisa melakukan injection, proxying, interceptor, lifecycle callback, transaction wrapping, atau resource binding, ada satu pertanyaan yang lebih primitif:

> **Apakah runtime bahkan bisa melihat class tersebut?**

Banyak error enterprise Java tampak seperti masalah CDI:

```text
Unsatisfied dependency for type PaymentGateway
```

atau seperti masalah deployment:

```text
ClassNotFoundException: jakarta.enterprise.inject.spi.Extension
```

atau seperti masalah dependency version:

```text
NoSuchMethodError: org.hibernate.Session.createQuery(...)
```

atau seperti masalah aneh:

```text
java.lang.ClassCastException: com.acme.User cannot be cast to com.acme.User
```

Tetapi akar masalahnya sering bukan annotation, bukan CDI resolution, bukan JPA mapping, dan bukan business logic.

Akar masalahnya adalah:

```text
class visibility + class identity + classloader boundary + module boundary + dependency packaging
```

Bagian ini membangun mental model agar ketika melihat error runtime, kita bisa bertanya dengan benar:

1. Class ini ada di mana?
2. Siapa classloader yang memuatnya?
3. Apakah ada dua versi class yang sama?
4. Apakah API disediakan server atau dibundel aplikasi?
5. Apakah deployment unit bisa melihat deployment unit lain?
6. Apakah JPMS module membuka package untuk reflection/proxy?
7. Apakah container scanning bisa menjangkau class tersebut?
8. Apakah class yang terlihat oleh compile-time sama dengan class yang terlihat oleh runtime?

---

## 1. Core Mental Model: Class Bukan Hanya Nama

Di Java, kita sering berpikir bahwa class diidentifikasi oleh fully qualified name:

```java
com.acme.caseflow.CaseService
```

Secara source code, itu benar.

Namun secara JVM runtime, identitas class adalah kombinasi:

```text
class identity = fully qualified class name + defining classloader
```

Artinya dua class dengan nama yang sama tetapi dimuat oleh classloader yang berbeda adalah dua type berbeda di mata JVM.

Contoh konseptual:

```text
Class A:
  name        = com.acme.User
  classloader = WebAppClassLoader@100

Class B:
  name        = com.acme.User
  classloader = ModuleClassLoader@200

A != B
```

Maka error ini masuk akal:

```text
java.lang.ClassCastException: com.acme.User cannot be cast to com.acme.User
```

Kalimat itu terlihat tidak masuk akal bagi manusia, tetapi sangat masuk akal bagi JVM:

```text
com.acme.User loaded by classloader X
cannot be cast to
com.acme.User loaded by classloader Y
```

### 1.1 Kenapa Ini Sangat Penting Untuk CDI/Jakarta?

CDI melakukan resolution berdasarkan type dan qualifier.

Jika producer menghasilkan object dengan type `com.acme.UserRepository` yang dimuat oleh classloader A, tetapi injection point meminta `com.acme.UserRepository` yang dimuat oleh classloader B, maka secara nama terlihat sama, tetapi secara type system berbeda.

Akibatnya bisa muncul:

```text
Unsatisfied dependency
Ambiguous dependency
ClassCastException
NoSuchMethodError
LinkageError
DeploymentException
```

Top engineer tidak hanya membaca error sebagai teks. Ia membaca error sebagai bukti dari struktur runtime.

---

## 2. Apa Itu Classloader?

Classloader adalah mekanisme JVM untuk memuat bytecode class ke memori runtime.

Secara sederhana:

```text
.class file / JAR entry / module content
        |
        v
ClassLoader#defineClass(...)
        |
        v
java.lang.Class object
        |
        v
runtime type usable by JVM
```

Classloader menjawab pertanyaan:

```text
Ketika kode meminta class X, dari mana bytecode X diambil?
```

### 2.1 Classpath Era Java 8

Pada Java 8, aplikasi umumnya memakai classpath:

```bash
java -cp app.jar:lib/a.jar:lib/b.jar com.acme.Main
```

Classpath bersifat relatif datar:

```text
AppClassLoader
  ├── app.jar
  ├── lib/a.jar
  └── lib/b.jar
```

Jika dua JAR membawa class yang sama, classloader akan memilih yang pertama ditemukan berdasarkan urutan classpath.

Ini melahirkan istilah:

```text
JAR Hell
```

Masalahnya:

- duplicate class
- version conflict
- transitive dependency tidak terlihat jelas
- compile-time class berbeda dari runtime class
- sulit memastikan reproducibility
- dependency resolution build tool tidak selalu sama dengan runtime loading order

### 2.2 Classloader Delegation

Classloader klasik mengikuti parent delegation:

```text
Bootstrap ClassLoader
        ^
Platform/Extension ClassLoader
        ^
Application ClassLoader
        ^
Custom/Application Server ClassLoader
```

Dalam parent-first delegation:

```text
loadClass("x.y.Z"):
  1. tanya parent dulu
  2. jika parent tidak menemukan, cari sendiri
```

Tujuannya:

- mencegah aplikasi mengganti class inti JDK
- menjaga konsistensi platform
- mengurangi duplicate loading

Namun application server sering punya variasi:

- parent-first
- child-first
- parent-last
- module-based explicit dependencies
- isolated webapp classloader
- server-provided API classloader

Karena enterprise runtime butuh isolasi antar aplikasi.

---

## 3. Class Visibility vs Class Identity

Dua konsep ini harus dipisah.

### 3.1 Class Visibility

Visibility menjawab:

```text
Bisakah classloader A menemukan class X?
```

Contoh error visibility:

```text
ClassNotFoundException: com.acme.PaymentClient
```

Artinya class diminta secara eksplisit, tetapi classloader tidak bisa menemukannya.

```text
NoClassDefFoundError: com/acme/PaymentClient
```

Artinya class pernah diketahui saat compile/linking, tetapi saat runtime JVM gagal memuat dependency class tersebut.

### 3.2 Class Identity

Identity menjawab:

```text
Apakah class X yang dilihat komponen A sama dengan class X yang dilihat komponen B?
```

Error identity:

```text
ClassCastException: com.acme.User cannot be cast to com.acme.User
```

Kemungkinan besar ada dua copy `com.acme.User` dalam dua classloader berbeda.

### 3.3 Linkage Compatibility

Linkage menjawab:

```text
Apakah bytecode yang sekarang dimuat punya method/field/constructor yang diharapkan oleh bytecode pemanggil?
```

Contoh:

```text
NoSuchMethodError
NoSuchFieldError
AbstractMethodError
IncompatibleClassChangeError
UnsupportedClassVersionError
```

Ini sering terjadi ketika:

- compile pakai versi library A 2.0
- runtime menyediakan library A 1.7
- server punya API lama
- aplikasi membundel API baru tetapi server memakai implementation lama
- dependency transitive menurunkan versi library

---

## 4. Application Server Mengubah Game

Dalam Java SE sederhana, classpath sering datar.

Dalam Jakarta EE server, runtime biasanya punya banyak lapisan:

```text
JDK classes
  |
Server boot classes
  |
Jakarta EE API classes
  |
Server implementation/provider classes
  |
Shared libraries / server modules
  |
Application deployment unit
  |
WAR WEB-INF/classes + WEB-INF/lib
```

Application server harus menyediakan:

- Servlet implementation
- CDI implementation
- JPA integration
- transaction manager
- naming/JNDI
- resource pooling
- security services
- EJB container jika full profile
- JSON-B/JSON-P provider
- Bean Validation provider
- WebSocket provider
- Jakarta REST provider jika tersedia

Karena itu, aplikasi tidak selalu harus membawa semua JAR sendiri.

Contoh dependency yang sering `provided` saat deploy ke full Jakarta EE server:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Maknanya:

```text
Compile-time:
  aplikasi butuh API untuk compile.

Runtime:
  API dan implementation disediakan server.
```

Jika dependency ini dibundel ke `WEB-INF/lib`, bisa terjadi konflik dengan API yang sudah disediakan server.

---

## 5. WAR, JAR, EAR: Deployment Unit Visibility

### 5.1 WAR

WAR adalah web application archive.

Struktur umum:

```text
myapp.war
├── WEB-INF/
│   ├── classes/
│   │   └── com/acme/...
│   ├── lib/
│   │   ├── app-lib.jar
│   │   └── third-party.jar
│   └── web.xml
└── index.html
```

Umumnya web app dapat melihat:

```text
WEB-INF/classes
WEB-INF/lib/*.jar
server-provided APIs
server-provided implementation sesuai aturan container
```

Tetapi WAR A biasanya tidak bisa melihat class WAR B.

```text
app-a.war  --X--> app-b.war
```

Ini disengaja untuk isolasi.

### 5.2 JAR Dalam WAR

Jika `domain.jar` berada dalam `WEB-INF/lib`, class dalam JAR itu biasanya terlihat oleh web app tersebut.

```text
myapp.war
└── WEB-INF/lib/domain.jar
```

Tetapi jika ada deployment lain yang juga membawa `domain.jar`, maka setiap deployment bisa memiliki copy type sendiri.

```text
app-a.war / WEB-INF/lib/domain.jar / com.acme.User
app-b.war / WEB-INF/lib/domain.jar / com.acme.User
```

Secara nama sama, secara runtime bisa berbeda.

### 5.3 EAR

EAR adalah enterprise archive untuk mengemas beberapa module:

```text
enterprise.ear
├── lib/
│   └── shared-domain.jar
├── web-a.war
├── web-b.war
└── ejb-module.jar
```

EAR bisa menyediakan shared library di `EAR/lib`.

Konseptual:

```text
EAR classloader
  ├── shared-domain.jar
  ├── web-a.war classloader
  ├── web-b.war classloader
  └── ejb-module.jar classloader
```

Namun detail visibility antar module tergantung spesifikasi dan vendor.

### 5.4 Kenapa EAR Bisa Berbahaya?

EAR memberi sharing, tetapi juga menambah kompleksitas.

Risiko:

- shared library versi lama dipakai semua module
- WAR membawa copy library yang juga ada di EAR/lib
- EJB module melihat type berbeda dari WAR
- CDI discovery lintas module tidak sesuai ekspektasi
- deployment order memengaruhi binding/resource
- classloader hierarchy sulit dipahami tim

EAR cocok untuk sistem enterprise tertentu, tetapi harus dikelola dengan disiplin dependency yang tinggi.

---

## 6. Parent-First vs Child-First

### 6.1 Parent-First

Parent-first:

```text
Application classloader mencari class:
  1. tanya parent
  2. jika parent tidak punya, cari di aplikasi
```

Diagram:

```text
request com.fasterxml.jackson.ObjectMapper
        |
        v
Parent/server classloader punya Jackson?
        |
        ├── yes -> pakai server Jackson
        └── no  -> pakai app WEB-INF/lib Jackson
```

Kelebihan:

- platform lebih konsisten
- server API tidak mudah dioverride aplikasi
- mengurangi shadowing class platform

Kekurangan:

- aplikasi sulit memakai versi library berbeda dari server
- runtime bisa memakai class yang bukan dependency build aplikasi
- `NoSuchMethodError` jika server punya versi lebih tua

### 6.2 Child-First / Parent-Last

Child-first:

```text
Application classloader mencari class:
  1. cari di aplikasi
  2. jika tidak ada, tanya parent
```

Kelebihan:

- aplikasi lebih self-contained
- bisa override library tertentu

Kekurangan:

- bisa mengganti class yang seharusnya milik server
- bisa membuat API/implementation mismatch
- rentan duplicate platform classes

### 6.3 Rule Praktis

Untuk enterprise Jakarta:

```text
Jangan bundel API/spec JAR yang sudah disediakan server, kecuali runtime memang mengharuskan aplikasi self-contained.
```

Contoh yang sebaiknya tidak dibundel dalam WAR untuk full Jakarta EE server:

```text
jakarta.servlet-api
jakarta.enterprise.cdi-api
jakarta.ejb-api
jakarta.transaction-api
jakarta.annotation-api
jakarta.persistence-api
jakarta.ws.rs-api
jakarta.validation-api
jakarta.json-api
jakarta.json.bind-api
```

Biasanya scope-nya `provided`.

Namun untuk runnable JAR/embedded runtime, aturan berbeda: aplikasi mungkin memang membawa semua dependency sendiri.

---

## 7. Server Module Systems: WildFly, Open Liberty, Payara, Tomcat

Vendor berbeda punya classloading model berbeda.

### 7.1 WildFly / JBoss EAP Style

WildFly memakai model module-based classloading. Deployment juga diperlakukan sebagai module. Artinya class visibility lebih eksplisit daripada classpath datar.

Konseptual:

```text
module org.hibernate
module jakarta.api
module com.fasterxml.jackson
module deployment.myapp.war
```

Deployment tidak otomatis bisa melihat semua JAR server. Ia melihat dependency yang disediakan secara eksplisit atau otomatis oleh subsystem tertentu.

Contoh konseptual `jboss-deployment-structure.xml`:

```xml
<jboss-deployment-structure>
  <deployment>
    <dependencies>
      <module name="com.acme.shared" />
    </dependencies>
    <exclusions>
      <module name="org.slf4j" />
    </exclusions>
  </deployment>
</jboss-deployment-structure>
```

Gunakan dengan hati-hati. File ini kuat tetapi vendor-specific.

### 7.2 Open Liberty Style

Open Liberty menyediakan konfigurasi classloader dan shared libraries lewat server configuration.

Konseptual:

```xml
<library id="sharedLib">
  <fileset dir="${server.config.dir}/lib" includes="*.jar" />
</library>

<webApplication location="myapp.war">
  <classloader commonLibraryRef="sharedLib" />
</webApplication>
```

Liberty juga memiliki pilihan delegation behavior dan library reference. Ini berguna untuk shared libraries, tetapi harus dipakai sebagai boundary sadar, bukan tempat membuang dependency sembarangan.

### 7.3 Payara / GlassFish Style

Payara/GlassFish mengikuti model Jakarta EE server dengan domain/server libraries, application libraries, dan deployment packaging.

Konsep penting tetap sama:

```text
server-provided API/implementation
application WEB-INF/lib
shared domain/server library
classloader delegation
```

### 7.4 Tomcat / Servlet Container Style

Tomcat bukan full Jakarta EE server. Ia terutama Servlet/JSP/WebSocket container.

Tomcat tidak menyediakan CDI/EJB/JPA full stack secara default seperti full profile server.

Jika aplikasi butuh CDI di Tomcat, biasanya perlu membawa implementation seperti Weld Servlet integration atau memakai framework yang mengemas runtime sendiri.

Classloader Tomcat umumnya punya model:

```text
Bootstrap
  |
System
  |
Common
  |
Webapp classloader per WAR
```

Setiap webapp isolated. Ini bagus untuk isolasi, tetapi bisa menimbulkan duplicate class antar WAR.

---

## 8. JPMS: Java Platform Module System dari Java 9+

Java 9 memperkenalkan JPMS.

JPMS bukan sekadar classloader baru. Ia menambah konsep module sebagai unit strong encapsulation.

Contoh `module-info.java`:

```java
module com.acme.caseflow {
    requires jakarta.inject;
    requires jakarta.enterprise.cdi.api;

    exports com.acme.caseflow.api;
    opens com.acme.caseflow.internal to weld.core;
}
```

### 8.1 Classpath vs Module Path

Classpath:

```text
Semua JAR berada dalam unnamed module.
Visibility relatif longgar.
Encapsulation lemah.
```

Module path:

```text
Setiap module punya deklarasi requires/exports/opens.
Visibility eksplisit.
Encapsulation kuat.
```

### 8.2 `requires`

`requires` menyatakan module dependency.

```java
module com.acme.app {
    requires java.sql;
    requires jakarta.inject;
}
```

Tanpa `requires`, module tidak bisa membaca module lain.

### 8.3 `exports`

`exports` membuat package bisa digunakan compile-time dan runtime oleh module lain.

```java
exports com.acme.caseflow.api;
```

Jika package tidak diekspor, module lain tidak bisa mengakses public class di package tersebut.

### 8.4 `opens`

`opens` mengizinkan deep reflection.

Ini penting untuk CDI/JPA/JSON-B/Bean Validation/framework yang perlu membaca field/constructor/method secara reflektif.

```java
opens com.acme.caseflow.entity to org.hibernate.orm.core;
opens com.acme.caseflow.service to weld.core;
```

Atau membuka semua package dalam module:

```java
open module com.acme.caseflow {
    requires jakarta.persistence;
    requires jakarta.enterprise.cdi.api;
}
```

Namun `open module` adalah palu besar. Lebih baik buka package yang diperlukan saja jika maturity tim memungkinkan.

### 8.5 Automatic Module

JAR tanpa `module-info.java` di module path menjadi automatic module.

Risiko:

- nama module bisa tidak stabil
- semua package diekspor
- dependency behavior kurang eksplisit
- cocok sebagai transisi, bukan desain jangka panjang

### 8.6 Unnamed Module

Classpath content masuk unnamed module.

Banyak aplikasi Jakarta masih berjalan di classpath/unnamed module, terutama saat deploy ke application server.

Jadi dari Java 9 sampai 25, realitas enterprise adalah campuran:

```text
JDK sendiri modular
server mungkin punya module system internal
aplikasi mungkin masih classpath/WAR
library mungkin automatic module
framework memakai reflection/proxy
```

Top engineer harus bisa hidup di hybrid world ini.

---

## 9. JPMS vs Application Server Module System

Penting:

```text
JPMS module system != WildFly/JBoss Modules != OSGi != Maven modules != Gradle subprojects
```

Mereka semua memakai kata “module”, tetapi maknanya berbeda.

| Istilah | Level | Fungsi |
|---|---:|---|
| Maven module | build | subproject dalam multi-module build |
| Gradle subproject | build | unit build/composition |
| JPMS module | Java runtime/language | `module-info.java`, requires/exports/opens |
| JBoss/WildFly module | server runtime | dependency isolation dalam server |
| OSGi bundle | dynamic module runtime | lifecycle + service registry |
| EAR module | deployment | WAR/EJB/JAR dalam enterprise archive |
| CDI bean archive | DI discovery | unit discovery CDI |

Jangan mencampur istilah ini dalam desain.

Contoh kalimat ambigu:

```text
“Module case-management tidak bisa melihat module audit.”
```

Harus diklarifikasi:

```text
Maksudnya Maven module?
JPMS module?
EAR module?
WildFly server module?
CDI bean archive?
```

Tanpa klarifikasi, diagnosis akan kacau.

---

## 10. Reflection, Proxy, dan Module Boundary

CDI dan banyak Jakarta provider memakai reflection/proxy.

Mereka mungkin perlu:

- membaca annotation
- memanggil constructor
- mengakses method non-public
- membuat subclass proxy
- membuat synthetic class
- membaca generic metadata
- mengakses field untuk injection

Pada Java 8, reflection relatif longgar.

Pada Java 9+, strong encapsulation membuat akses reflective bisa gagal jika package tidak `opens`.

Error umum:

```text
java.lang.reflect.InaccessibleObjectException
```

Contoh:

```text
Unable to make field private ... accessible:
module com.acme.caseflow does not "opens com.acme.caseflow" to module weld.core
```

### 10.1 `exports` Tidak Sama Dengan `opens`

`exports`:

```text
Membolehkan akses public compile-time/runtime normal.
```

`opens`:

```text
Membolehkan deep reflection.
```

CDI/JPA sering butuh `opens`, bukan hanya `exports`.

### 10.2 Proxy dan Final Class

Selain module openness, proxy juga punya batasan:

- final class sulit/subclass proxy tidak bisa
- final method tidak bisa dioverride untuk interception
- private method tidak bisa diintercept seperti public business method
- constructor visibility dapat memengaruhi instantiation

Jadi masalah proxy bisa berasal dari:

```text
CDI proxy rule
+ classloader visibility
+ JPMS reflective access
+ bytecode generation library compatibility
```

---

## 11. Bean Discovery Dipengaruhi Classloader

CDI tidak melakukan scanning seluruh universe JVM.

CDI melakukan discovery pada bean archive/deployment unit yang terlihat oleh container.

Konseptual:

```text
Deployment unit
  |
  ├── discover classes reachable in bean archive
  ├── read beans.xml / bean-defining annotations
  ├── build bean metadata
  ├── validate injection points
  └── create bean graph
```

Jika class berada di JAR yang tidak terlihat oleh deployment classloader, CDI tidak bisa menemukan bean tersebut.

Jika JAR terlihat tetapi bukan bean archive, CDI mungkin tidak mendaftarkan class sebagai bean.

Jika JAR terlihat tetapi memakai namespace salah (`javax` vs `jakarta`), CDI modern bisa mengabaikan annotation yang dianggap bukan CDI annotation platform tersebut.

Contoh:

```java
// Library lama
import javax.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class LegacyService {}
```

Pada Jakarta EE 10/11 runtime, container mencari:

```java
jakarta.enterprise.context.ApplicationScoped
```

Bagi runtime modern, annotation `javax.enterprise.context.ApplicationScoped` bukan annotation CDI yang sama.

Akibatnya bean bisa tidak discoverable.

---

## 12. API JAR vs Implementation JAR Trap

Enterprise Java punya pola:

```text
API JAR         = interfaces, annotations, contracts
Implementation = provider/container actual behavior
```

Contoh:

```text
jakarta.enterprise.cdi-api       -> API CDI
Weld / OpenWebBeans / ArC        -> CDI implementation

jakarta.persistence-api          -> JPA API
Hibernate ORM / EclipseLink      -> JPA provider

jakarta.servlet-api              -> Servlet API
Tomcat/Jetty/Undertow            -> Servlet implementation
```

### 12.1 Error Karena Membundel API JAR

Misal aplikasi deploy ke server Jakarta EE 10 tetapi membawa `jakarta.enterprise.cdi-api` versi berbeda di `WEB-INF/lib`.

Kemungkinan:

```text
Application classloader sees API version X
Container implementation expects API version Y
```

Akibat:

- `ClassCastException`
- `LinkageError`
- extension tidak dipanggil
- annotation tidak terbaca sesuai ekspektasi
- method API tidak ada

### 12.2 Error Karena Membundel Implementation JAR

Misal deploy ke full server tetapi membawa sendiri Weld/Hibernate versi lain.

```text
Server already has CDI implementation
WAR bundles another CDI implementation
```

Ini bisa membuat:

- dua container aktif
- provider discovery kacau
- classloader conflict
- duplicate service provider
- transaction integration tidak nyambung
- JPA provider tidak integrate dengan JTA server

Rule:

```text
Jika server adalah full platform provider, jangan sembarang membawa implementation provider yang server sudah punya.
```

Kecuali memang dokumentasi vendor mengizinkan override dengan prosedur tertentu.

---

## 13. ServiceLoader, SPI, dan Classloader

Banyak provider Java ditemukan lewat `ServiceLoader`.

Struktur JAR:

```text
META-INF/services/com.acme.Plugin
```

Isi file:

```text
com.acme.impl.DefaultPlugin
```

ServiceLoader memakai classloader tertentu untuk menemukan provider.

Masalah umum:

- provider class tidak terlihat oleh classloader pemanggil
- service file ada di JAR yang tidak discan
- duplicate provider dari dua JAR
- provider memakai dependency yang tidak terlihat
- provider `javax` tidak compatible dengan consumer `jakarta`

Contoh CDI extension juga memakai service provider mechanism:

```text
META-INF/services/jakarta.enterprise.inject.spi.Extension
```

Jika file ini tidak masuk artifact, extension tidak jalan.

Jika extension class ada tetapi dependency-nya hilang, deployment bisa gagal.

---

## 14. Diagnosing Common Runtime Errors

### 14.1 `ClassNotFoundException`

Makna:

```text
Kode mencoba load class by name, tetapi classloader tidak menemukan class tersebut.
```

Pertanyaan diagnosis:

1. Class seharusnya berasal dari JAR mana?
2. JAR itu ada di artifact final?
3. JAR itu ada di server module?
4. Classloader deployment bisa melihat JAR itu?
5. Scope dependency benar?
6. Package namespace benar `javax` atau `jakarta`?
7. Apakah class hanya ada di test dependency?

Contoh penyebab:

```text
dependency scope = test
dependency scope = provided tetapi server tidak menyediakan
JAR tidak ikut terpackage
server module dependency belum dideklarasi
library dipindah dari javax ke jakarta
```

### 14.2 `NoClassDefFoundError`

Makna:

```text
Class yang dibutuhkan saat linking/initialization tidak tersedia saat runtime.
```

Bedanya dengan `ClassNotFoundException`:

- `ClassNotFoundException`: explicit load gagal.
- `NoClassDefFoundError`: JVM butuh class sebagai dependency bytecode tetapi gagal menemukannya.

Diagnosis:

```text
Cari class paling bawah dalam stacktrace.
Jangan hanya lihat class top-level.
```

Contoh:

```text
NoClassDefFoundError: org/reactivestreams/Publisher
```

Mungkin aplikasi membawa library yang compile terhadap Reactive Streams, tetapi runtime dependency-nya tidak ikut.

### 14.3 `NoSuchMethodError`

Makna:

```text
Bytecode pemanggil mengharapkan method tertentu, tetapi class runtime yang dimuat tidak punya method itu.
```

Penyebab paling umum:

```text
compile-time version != runtime version
```

Contoh:

```text
Compile: jackson-databind 2.17
Runtime: jackson-databind 2.13
```

Diagnosis:

1. Lihat method yang hilang.
2. Cari library asal class tersebut.
3. Bandingkan dependency tree compile/runtime.
4. Inspect artifact final.
5. Cek server-provided library.
6. Cek apakah class berasal dari parent classloader.

### 14.4 `ClassCastException: X cannot be cast to X`

Makna:

```text
Dua class dengan nama sama dimuat oleh classloader berbeda.
```

Penyebab:

- shared DTO ada di dua WAR
- common library ada di EAR/lib dan WEB-INF/lib
- API class dibundel app dan juga disediakan server
- plugin classloader memuat interface sendiri
- remote object/class dari boundary lain memakai copy type berbeda

Diagnosis:

```java
System.out.println(obj.getClass());
System.out.println(obj.getClass().getClassLoader());
System.out.println(ExpectedType.class.getClassLoader());
```

### 14.5 `LinkageError`

Makna umum:

```text
Ada masalah linking bytecode di runtime.
```

Keluarga error:

- `NoSuchMethodError`
- `NoSuchFieldError`
- `AbstractMethodError`
- `IncompatibleClassChangeError`
- `UnsupportedClassVersionError`
- `VerifyError`

Diagnosis:

```text
Ini hampir selalu masalah binary compatibility, versi dependency, atau classloader.
```

### 14.6 `UnsupportedClassVersionError`

Makna:

```text
Class dikompilasi dengan versi Java lebih tinggi daripada JVM runtime.
```

Contoh:

```text
class file version 65.0
```

Artinya Java 21 bytecode.

Jika runtime Java 17, gagal.

Mapping umum:

| Java | Class File Version |
|---:|---:|
| 8 | 52 |
| 11 | 55 |
| 17 | 61 |
| 21 | 65 |
| 25 | 69 |

Diagnosis:

```bash
javap -verbose SomeClass.class | grep "major version"
```

atau cek build target:

```xml
<maven.compiler.release>17</maven.compiler.release>
```

---

## 15. Duplicate Class Problem

Duplicate class berarti class dengan fully qualified name yang sama ada di lebih dari satu JAR.

Contoh:

```text
lib-a.jar -> com.acme.common.Money
lib-b.jar -> com.acme.common.Money
```

Runtime akan memilih salah satu berdasarkan classloader order.

Bahaya:

- class yang dipilih bukan yang diharapkan
- method hilang
- field beda
- annotation beda
- serialVersionUID beda
- security patch tidak aktif karena class lama menang

### 15.1 Cara Deteksi Duplicate Class

Dengan Maven:

```bash
mvn dependency:tree
mvn dependency:build-classpath
```

Dengan JAR inspection:

```bash
jar tf target/myapp.war | grep 'com/acme/common/Money.class'
```

Dengan script sederhana:

```bash
find target -name "*.jar" -print0 | while IFS= read -r -d '' jar; do
  jar tf "$jar" | grep 'com/acme/common/Money.class' && echo " -> $jar"
done
```

Dengan Maven Enforcer plugins, dependency convergence, banned dependencies, atau duplicate class detection plugin.

### 15.2 Duplicate API Class

Lebih berbahaya lagi jika duplicate-nya adalah API platform:

```text
jakarta/servlet/Servlet.class
jakarta/enterprise/inject/Inject.class
jakarta/persistence/Entity.class
```

Ini bisa membuat container dan aplikasi tidak sepakat tentang annotation/type.

---

## 16. Split Package Problem

Split package terjadi ketika package yang sama tersebar di beberapa JAR/module.

Contoh:

```text
core-a.jar -> com.acme.shared.Foo
core-b.jar -> com.acme.shared.Bar
```

Di classpath tradisional ini bisa berjalan, meskipun rawan.

Di JPMS, split package antar resolved modules tidak diperbolehkan.

Kenapa buruk:

- ownership package tidak jelas
- encapsulation lemah
- refactoring sulit
- module migration sulit
- class shadowing mudah terjadi

Rule:

```text
Satu package sebaiknya dimiliki oleh satu artifact/module saja.
```

---

## 17. Shading dan Relocation

Shading adalah memasukkan dependency ke artifact lain, sering dengan relocation package.

Contoh Maven Shade relocation:

```xml
<relocation>
  <pattern>com.fasterxml.jackson</pattern>
  <shadedPattern>com.acme.shadow.jackson</shadedPattern>
</relocation>
```

Kapan berguna:

- CLI tool self-contained
- library ingin menghindari conflict dengan dependency umum
- plugin runtime butuh isolasi

Kapan berbahaya:

- Jakarta EE application server deployment
- framework provider discovery via ServiceLoader
- annotation API class ikut dishade
- reflection/resource path tidak ikut benar
- license/security scanning jadi kabur

Rule:

```text
Jangan shade Jakarta API/spec classes.
Jangan shade provider classes kecuali benar-benar paham konsekuensinya.
```

---

## 18. Multi-Release JAR

Multi-release JAR memungkinkan satu JAR punya class berbeda untuk versi Java berbeda.

Struktur:

```text
my-lib.jar
├── com/acme/Foo.class              # base version
└── META-INF/versions/17/com/acme/Foo.class
```

Runtime Java 17+ bisa memilih class versi 17.

Risiko:

- behavior berbeda antar Java 8/11/17/21/25
- debugging sulit jika tidak sadar multi-release
- class file version berbeda dalam satu artifact
- shading/minimization bisa merusak struktur

Diagnosis:

```bash
jar tf my-lib.jar | grep META-INF/versions
```

---

## 19. CDI, Classloader, dan Generic Type

CDI resolution memakai type closure, termasuk generic type dalam kondisi tertentu.

Contoh:

```java
@ApplicationScoped
public class JpaRepository<T> {}

@ApplicationScoped
public class CaseRepository extends JpaRepository<Case> {}
```

Jika `Case` dimuat oleh classloader berbeda dari injection point yang meminta `JpaRepository<Case>`, resolution bisa kacau.

Masalah generic juga muncul dengan:

- shared DTO antar deployment
- plugin API
- remote boundary
- serialization/deserialization
- generated classes

Rule:

```text
Type yang dipakai sebagai boundary DI sebaiknya berasal dari artifact/classloader yang sama dan stabil.
```

---

## 20. Deployment Isolation Patterns

### 20.1 Self-Contained WAR

```text
myapp.war
└── WEB-INF/lib semua dependency non-platform
```

Cocok untuk:

- Tomcat/Jetty style
- aplikasi web standalone
- minimal shared dependency

Risiko:

- duplicate dependency antar aplikasi
- ukuran artifact besar
- patch library harus redeploy semua aplikasi

### 20.2 Server-Provided Platform

```text
server provides Jakarta EE API + implementation
app provides business libs only
```

Cocok untuk:

- Jakarta EE full/profile server
- enterprise standardization
- centralized provider management

Risiko:

- app bergantung versi server
- upgrade server bisa memengaruhi banyak app
- aplikasi sulit override library provider

### 20.3 Shared Library

```text
server/shared-lib/domain.jar
app-a.war depends on shared-lib
app-b.war depends on shared-lib
```

Cocok untuk:

- controlled common API
- shared DTO/contracts
- stable internal platform

Risiko:

- version coupling antar app
- deployment coordination sulit
- hidden runtime dependency
- rollback rumit

### 20.4 EAR Shared Lib

```text
enterprise.ear/lib/shared.jar
enterprise.ear/app-a.war
enterprise.ear/app-b.war
```

Cocok untuk:

- satu enterprise application besar
- module tightly coupled
- single deployment lifecycle

Risiko:

- classloader complexity
- accidental duplicate library
- harder cloud-native deployment

### 20.5 Plugin Classloader

```text
core-app
  ├── plugin-a classloader
  ├── plugin-b classloader
  └── shared API classloader
```

Cocok untuk:

- extensible runtime
- tenant-specific adapter
- optional connectors

Risiko:

- class identity bugs
- memory leak saat unload
- SPI visibility issues
- security risks

---

## 21. Practical Packaging Rules

### 21.1 For Full Jakarta EE Server

Gunakan `provided` untuk platform API:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Jangan bundle implementation provider kecuali memang disengaja dan didukung vendor.

```text
Avoid bundling:
- CDI implementation
- Servlet implementation
- EJB implementation
- transaction manager
- server-integrated JPA provider override tanpa prosedur
```

### 21.2 For Servlet Container

Jika hanya deploy ke Tomcat:

```text
Tomcat provides Servlet/JSP/WebSocket pieces.
App must provide CDI/JPA/Validation/REST provider if needed.
```

Jangan mengasumsikan Tomcat adalah Jakarta EE full server.

### 21.3 For Runnable JAR / Microservice Runtime

Jika runtime seperti Quarkus, Helidon, Micronaut, Spring Boot, atau custom embedded:

```text
Application packaging owns most dependencies.
```

Namun build-time augmentation/native-image/runtime indexing dapat mengubah cara discovery dan reflection bekerja.

### 21.4 For Java 8–25 Library

Jika membuat library yang harus berjalan luas:

- jangan bergantung pada application server internals
- pisahkan API dan integration module
- hindari static global container lookup
- jangan expose implementation provider class dalam public API
- publish variant untuk `javax` dan `jakarta` jika perlu
- perhatikan bytecode target

---

## 22. Java Version and Bytecode Compatibility

Karena seri ini mencakup Java 8 hingga 25, penting membedakan:

```text
source compatibility
binary compatibility
runtime compatibility
platform compatibility
```

### 22.1 Build Target

Maven modern sebaiknya memakai `release`:

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Bukan hanya:

```xml
<source>17</source>
<target>17</target>
```

Karena `release` juga membatasi API JDK yang tersedia sesuai target.

### 22.2 Runtime Matrix

Contoh:

| Compile Release | Runtime Java 8 | 11 | 17 | 21 | 25 |
|---:|---:|---:|---:|---:|---:|
| 8 | yes | yes | yes | yes | yes |
| 11 | no | yes | yes | yes | yes |
| 17 | no | no | yes | yes | yes |
| 21 | no | no | no | yes | yes |
| 25 | no | no | no | no | yes |

Namun library/runtime provider compatibility tidak otomatis mengikuti bytecode.

Contoh:

```text
Bytecode compatible dengan Java 17
belum tentu compatible dengan Jakarta EE 11 server tertentu
```

### 22.3 Jakarta EE 11 Baseline

Jakarta EE 11 menetapkan minimum Java SE 17. Itu berarti Jakarta EE 11 aplikasi tidak ditargetkan untuk Java 8 runtime.

Untuk sistem legacy Java 8, biasanya baseline-nya Java EE 8 / Jakarta EE 8-era dengan `javax.*`.

---

## 23. Production Debugging Playbook

Ketika menemukan runtime classloading issue, jangan langsung edit dependency sembarang.

Ikuti urutan ini.

### Step 1 — Klasifikasikan Error

```text
ClassNotFoundException       -> visibility missing
NoClassDefFoundError         -> dependency missing during linking/init
NoSuchMethodError            -> version mismatch
ClassCastException X to X    -> duplicate class/classloader identity
InaccessibleObjectException  -> JPMS reflection openness
UnsupportedClassVersionError -> Java runtime too old
DeploymentException          -> bisa CDI/resource/classloading
```

### Step 2 — Identifikasi Class yang Bermasalah

Jangan hanya lihat stacktrace paling atas.

Cari:

- class pertama yang gagal dimuat
- method yang hilang
- package namespace
- artifact asal
- apakah `javax` atau `jakarta`

### Step 3 — Cek Build Dependency Tree

Maven:

```bash
mvn -q dependency:tree -Dverbose
```

Filter:

```bash
mvn dependency:tree -Dincludes=jakarta.enterprise
mvn dependency:tree -Dincludes=org.hibernate
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency hibernate-core
```

### Step 4 — Cek Artifact Final

WAR:

```bash
jar tf target/myapp.war | sort | less
jar tf target/myapp.war | grep 'WEB-INF/lib'
jar tf target/myapp.war | grep 'jakarta/enterprise'
```

EAR:

```bash
jar tf target/myapp.ear | sort | less
```

### Step 5 — Cek Server-Provided Library

Pertanyaan:

```text
Apakah server sudah menyediakan API/implementation ini?
Versinya apa?
Apakah aplikasi membawa versi lain?
```

Untuk WildFly/Open Liberty/Payara, cek dokumentasi server dan module/library list.

### Step 6 — Print Classloader Saat Perlu

Tambahkan diagnostic sementara:

```java
public final class ClassloaderDebug {
    public static void print(Class<?> type) {
        System.out.println(type.getName() + " -> " + type.getClassLoader());
        System.out.println("code source -> " +
            type.getProtectionDomain().getCodeSource());
    }
}
```

Pemakaian:

```java
ClassloaderDebug.print(com.acme.User.class);
ClassloaderDebug.print(jakarta.enterprise.inject.Instance.class);
ClassloaderDebug.print(org.hibernate.Session.class);
```

Output `CodeSource` sering langsung menunjukkan JAR mana yang dipakai.

### Step 7 — Cek Namespace

Cari campuran:

```bash
jar tf target/myapp.war | grep 'javax/'
jar tf target/myapp.war | grep 'jakarta/'
```

Atau dependency tree:

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

Campuran tidak selalu salah, tetapi untuk spesifikasi yang sama campuran sering berbahaya.

### Step 8 — Fix Dengan Prinsip Minimal

Jangan fix dengan menambahkan semua JAR.

Urutan fix yang sehat:

1. Tentukan source of truth: server atau app?
2. Hilangkan duplicate API.
3. Align BOM/platform version.
4. Perbaiki scope dependency.
5. Tambahkan explicit server module dependency hanya jika perlu.
6. Tambahkan `opens` untuk JPMS reflection jika module-path dipakai.
7. Tambahkan integration provider sesuai runtime.
8. Tambahkan test deployment agar tidak regress.

---

## 24. Case Study 1 — CDI Bean Tidak Ditemukan Padahal Class Ada

### Situation

Aplikasi Jakarta EE 10 deploy ke server modern.

Class:

```java
import javax.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class LegacyPaymentService {
}
```

Injection:

```java
@Inject
PaymentService paymentService;
```

Error:

```text
Unsatisfied dependency for type LegacyPaymentService
```

### Naive Diagnosis

```text
Mungkin lupa @ApplicationScoped?
```

Padahal annotation ada.

### Real Diagnosis

Runtime Jakarta EE 10/11 mencari CDI annotation namespace:

```java
jakarta.enterprise.context.ApplicationScoped
```

Tetapi class memakai:

```java
javax.enterprise.context.ApplicationScoped
```

Bagi runtime, itu annotation berbeda.

### Fix

Migrasi namespace:

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class PaymentService {
}
```

Lalu pastikan dependency graph tidak membawa CDI API `javax` lama.

---

## 25. Case Study 2 — `NoSuchMethodError` Setelah Upgrade Library

### Situation

Build compile sukses.

Runtime error:

```text
java.lang.NoSuchMethodError:
  com.fasterxml.jackson.databind.ObjectMapper.readerForUpdating(Ljava/lang/Object;)Lcom/fasterxml/jackson/databind/ObjectReader;
```

### Mental Model

Compile-time `ObjectMapper` punya method itu.

Runtime `ObjectMapper` yang dimuat tidak punya method itu.

### Kemungkinan

- server punya Jackson lebih lama dan parent-first menang
- WAR membawa Jackson versi lama karena transitive dependency
- dependency management override salah
- shared library server menimpa aplikasi

### Diagnostic

```java
ClassloaderDebug.print(com.fasterxml.jackson.databind.ObjectMapper.class);
```

Cek:

```text
CodeSource: server/modules/com/fasterxml/jackson/...
```

atau:

```text
CodeSource: WEB-INF/lib/jackson-databind-2.13.x.jar
```

### Fix

- Align dependency dengan BOM.
- Exclude versi lama.
- Hindari memakai server-provided library non-platform kecuali disengaja.
- Jika server parent-first, konfigurasi classloader vendor mungkin diperlukan.
- Lebih baik hindari conflict dengan library umum di shared server.

---

## 26. Case Study 3 — `ClassCastException: User cannot be cast to User`

### Situation

EAR:

```text
caseflow.ear
├── lib/domain.jar
├── api.war
└── worker.jar
```

Tetapi `api.war` juga membawa:

```text
WEB-INF/lib/domain.jar
```

Error:

```text
ClassCastException: com.acme.domain.User cannot be cast to com.acme.domain.User
```

### Root Cause

Ada dua `User`:

```text
EAR/lib/domain.jar             -> loaded by EAR classloader
api.war/WEB-INF/lib/domain.jar -> loaded by WAR classloader
```

### Fix

Pilih satu source of truth.

Jika memakai EAR shared lib:

```text
Hapus domain.jar dari WAR WEB-INF/lib.
Pastikan dependency scope packaging tidak memasukkan duplicate.
```

Jika tidak perlu EAR shared lib:

```text
Jangan share mutable DTO antar module lewat classloader rumit.
Package masing-masing atau pecah boundary via API contract.
```

---

## 27. Case Study 4 — JPMS Reflection Error Dengan CDI/JPA

### Situation

Java 21/25 modular app:

```java
module com.acme.caseflow {
    requires jakarta.persistence;
    requires jakarta.enterprise.cdi.api;
    exports com.acme.caseflow.api;
}
```

Entity:

```java
package com.acme.caseflow.entity;

@Entity
public class CaseRecord {
    @Id
    private Long id;
}
```

Runtime error:

```text
InaccessibleObjectException:
module com.acme.caseflow does not opens com.acme.caseflow.entity to org.hibernate.orm.core
```

### Root Cause

JPA provider perlu reflection terhadap entity package.

`exports` tidak cukup.

### Fix

```java
module com.acme.caseflow {
    requires jakarta.persistence;
    requires jakarta.enterprise.cdi.api;

    exports com.acme.caseflow.api;
    opens com.acme.caseflow.entity to org.hibernate.orm.core;
}
```

Jika CDI juga perlu reflective access ke service/internal package:

```java
opens com.acme.caseflow.service to weld.core;
```

Nama target module tergantung provider/runtime.

---

## 28. Design Heuristics for Top 1% Runtime Engineers

### 28.1 Treat Classloader as Architecture, Not Accident

Jangan biarkan classloader menjadi efek samping packaging.

Dokumentasikan:

```text
- dependency mana yang server-provided
- dependency mana yang app-owned
- dependency mana yang shared
- dependency mana yang isolated
- module mana yang boleh melihat module lain
```

### 28.2 Avoid Shared Mutable Domain Types Across Deployment Boundaries

Jika dua deployment punya lifecycle berbeda, jangan mudah share domain class lewat server lib.

Lebih aman:

- REST/JSON contract
- messaging contract
- schema contract
- versioned API JAR dengan lifecycle jelas

### 28.3 Keep Platform API Out of Application Artifacts

Untuk Jakarta server deployment:

```text
provided means provided.
```

Jangan bundle API/spec JAR platform kecuali benar-benar perlu.

### 28.4 Make Build Graph Match Runtime Graph

Build sukses tidak cukup.

Harus ada:

- dependency convergence
- lockfile atau reproducible versioning
- artifact inspection
- deployment smoke test
- startup validation

### 28.5 Design Public API With Stable Classloader Boundary

Interface yang dipakai lintas classloader harus berasal dari shared parent/API classloader.

Plugin pattern:

```text
shared-api.jar loaded by parent
plugin-a.jar loaded by child A
plugin-b.jar loaded by child B
```

Interface tidak boleh ikut bundled di plugin masing-masing.

### 28.6 Prefer Explicitness Over Magic Shared Libraries

Shared server library tampak nyaman, tetapi sering membuat runtime graph tersembunyi.

Jika dipakai, perlakukan seperti platform internal:

- versioned
- documented
- tested
- owner jelas
- release notes
- compatibility policy

---

## 29. Runtime Boundary Decision Matrix

| Situation | Recommended Model | Avoid |
|---|---|---|
| Full Jakarta EE deployment | server-provided platform APIs, app-owned business libs | bundling Jakarta API/provider sembarang |
| Tomcat web app needing CDI | bundle CDI integration/provider sesuai dokumentasi | mengira Tomcat full Jakarta EE |
| Multiple WARs sharing DTO | versioned shared API with clear lifecycle | copy DTO JAR di tiap WAR lalu cast antar WAR |
| EAR tightly coupled modules | EAR/lib shared classes | duplicate shared lib dalam WAR |
| Plugin system | parent-loaded API + isolated plugin loaders | plugin membawa copy API sendiri |
| Java 17+ modular runtime | explicit `requires`, `exports`, `opens` | membuka semua package tanpa alasan |
| Legacy Java 8 app | classpath hygiene + dependency convergence | split package dan duplicate class |
| Jakarta migration | one namespace per spec boundary | mencampur `javax` dan `jakarta` untuk spec yang sama |

---

## 30. Checklist Sebelum Deploy

### Dependency Packaging Checklist

```text
[ ] Apakah Jakarta API dependency memakai scope provided untuk full server?
[ ] Apakah provider implementation tidak dibundel dua kali?
[ ] Apakah dependency tree converged?
[ ] Apakah tidak ada duplicate class kritis?
[ ] Apakah tidak ada campuran javax/jakarta yang salah?
[ ] Apakah WAR/EAR final sudah diinspect?
[ ] Apakah shared library server terdokumentasi?
[ ] Apakah bytecode target cocok dengan runtime Java?
```

### Classloader Checklist

```text
[ ] Deployment unit mana yang memiliki class ini?
[ ] Class ini dimuat oleh classloader mana?
[ ] Apakah ada class dengan nama sama di lokasi lain?
[ ] Apakah module/deployment A boleh melihat B?
[ ] Apakah parent-first/child-first behavior diketahui?
[ ] Apakah server module dependency eksplisit diperlukan?
```

### JPMS Checklist

```text
[ ] Apakah module memakai module-path atau classpath?
[ ] Apakah package API diekspor dengan exports?
[ ] Apakah package yang butuh reflection dibuka dengan opens?
[ ] Apakah automatic module name stabil?
[ ] Apakah ada split package?
[ ] Apakah provider/framework bisa membaca metadata yang diperlukan?
```

### CDI Discovery Checklist

```text
[ ] Apakah bean class berada dalam bean archive yang terlihat?
[ ] Apakah annotation memakai namespace yang benar?
[ ] Apakah beans.xml/discovery mode sesuai?
[ ] Apakah dependency JAR ikut deployment?
[ ] Apakah class tidak berada di server module yang tidak terlihat CDI deployment?
[ ] Apakah extension service file benar?
```

---

## 31. Anti-Patterns

### 31.1 “Add JAR Until It Works”

Ini cara tercepat membuat runtime graph tidak terkendali.

Gejala:

```text
ClassNotFoundException -> tambah JAR
NoSuchMethodError -> tambah JAR lain
ClassCastException -> tambah shared lib
Deployment makin rapuh
```

Solusi:

```text
Tentukan ownership dependency dan boundary classloader.
```

### 31.2 Bundling Platform APIs in Full Server Deployment

Contoh buruk:

```text
WEB-INF/lib/jakarta.servlet-api.jar
WEB-INF/lib/jakarta.enterprise.cdi-api.jar
WEB-INF/lib/jakarta.ejb-api.jar
```

Pada full server, ini sering sumber konflik.

### 31.3 Shared Library Dumping Ground

Server shared lib diisi semua library agar semua aplikasi bisa pakai.

Akibat:

- aplikasi tidak tahu dependency sebenarnya
- upgrade satu library memecahkan banyak app
- rollback sulit
- security patch tidak jelas
- dependency tree build tidak mewakili runtime

### 31.4 Duplicate Domain JAR Across Deployment Boundaries

Sangat berbahaya jika object ditukar antar boundary.

Jika object tidak pernah ditukar, mungkin aman secara praktis, tetapi tetap membingungkan.

### 31.5 Ignoring `javax`/`jakarta` Namespace in Classloader Diagnosis

Namespace migration bukan hanya package rename. Itu type identity baru.

```text
javax.inject.Inject != jakarta.inject.Inject
javax.persistence.Entity != jakarta.persistence.Entity
```

### 31.6 Treating JPMS `exports` as Reflection Permission

`exports` tidak sama dengan `opens`.

Framework reflection butuh `opens`.

---

## 32. Compact Mental Model

Ingat rumus ini:

```text
A Java class at runtime is not only a name.
It is a name loaded by a specific classloader under a specific visibility graph.
```

Dan untuk enterprise runtime:

```text
Dependency build graph != runtime classloader graph != CDI bean graph != JPMS module graph.
```

Mereka berhubungan, tetapi tidak sama.

### 32.1 Four Graphs You Must Separate

```text
1. Build dependency graph
   Maven/Gradle resolves artifacts.

2. Packaging graph
   What actually enters WAR/EAR/JAR.

3. Runtime classloader graph
   Who can load which class from where.

4. Container bean/resource graph
   Which beans/resources the container discovers and wires.
```

Banyak bug terjadi saat engineer menganggap empat graph ini identik.

Padahal:

```text
Dependency ada di pom.xml
  belum tentu masuk artifact.

Artifact membawa JAR
  belum tentu classloader memakai JAR itu.

Classloader bisa melihat class
  belum tentu CDI menjadikannya bean.

CDI menemukan bean
  belum tentu bean proxyable/interceptable.
```

---

## 33. Minimal Diagnostic Commands

### Maven

```bash
mvn dependency:tree
mvn dependency:tree -Dverbose
mvn dependency:tree -Dincludes=jakarta.enterprise
mvn dependency:tree -Dincludes=org.hibernate
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

### Gradle

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jakarta.enterprise
./gradlew dependencyInsight --dependency hibernate-core
```

### Artifact Inspection

```bash
jar tf target/app.war | sort
jar tf target/app.war | grep 'WEB-INF/lib'
jar tf target/app.war | grep 'javax/'
jar tf target/app.war | grep 'jakarta/'
```

### Class File Version

```bash
javap -verbose SomeClass.class | grep "major version"
```

### Runtime Source

```java
System.out.println(MyType.class.getClassLoader());
System.out.println(MyType.class.getProtectionDomain().getCodeSource());
```

---

## 34. What You Should Be Able To Do After This Part

Setelah bagian ini, kamu harus bisa:

1. Membedakan class visibility, class identity, dan binary linkage.
2. Menjelaskan kenapa `X cannot be cast to X` mungkin terjadi.
3. Mendiagnosis `ClassNotFoundException`, `NoClassDefFoundError`, `NoSuchMethodError`, `LinkageError`, dan `InaccessibleObjectException`.
4. Menentukan apakah dependency harus `provided`, `compile`, atau runtime-owned app.
5. Membaca WAR/EAR sebagai runtime graph, bukan hanya file build output.
6. Memahami dampak WAR/EAR/server shared lib terhadap DI/CDI.
7. Memahami perbedaan Maven module, JPMS module, server module, EAR module, dan CDI bean archive.
8. Mendesain boundary classloader untuk plugin/shared API.
9. Menghindari campuran `javax.*` dan `jakarta.*` yang merusak discovery/runtime identity.
10. Menyiapkan checklist deployment yang menangkap classloader issue sebelum production.

---

## 35. Bridge ke Part Berikutnya

Bagian ini menjawab:

```text
Apakah runtime bisa melihat class yang benar?
```

Bagian berikutnya akan masuk ke:

```text
Dependency Injection Fundamentals: Inversion of Control Done Correctly
```

Setelah class terlihat, pertanyaan berikutnya adalah:

```text
Siapa yang membuat object?
Siapa yang memilih implementasi?
Siapa yang menyusun object graph?
Bagaimana dependency lookup berbeda dari dependency injection?
Kapan DI membantu, dan kapan DI justru menyembunyikan desain buruk?
```

Itu akan menjadi fondasi sebelum masuk ke Jakarta Inject dan CDI core.

---

## 36. Referensi Resmi dan Bacaan Lanjutan

- Jakarta EE Platform Specification — class loading, deployment model, platform services.
- Jakarta CDI Specification — bean discovery, type-safe resolution, contextual instances, client proxies.
- Jakarta Enterprise Beans Specification — deployment/module semantics for Enterprise Beans.
- Jakarta Servlet Specification — web application structure and container class visibility.
- Oracle Java Platform Module System / Project Jigsaw documentation — JPMS module path, requires, exports, opens.
- WildFly Developer Guide — module-based class loading and deployment modules.
- Open Liberty Documentation — class loader configuration and library references.
- Apache Tomcat Class Loader How-To — webapp classloader model.
- Maven Dependency Mechanism — compile/runtime/provided scope and transitive dependency graph.
- Gradle Dependency Management — dependency insight, constraints, platforms/BOM.

---

# Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
```

Belum selesai. Bagian berikutnya:

```text
Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 004 — Runtime / Container Model: Who Owns Your Object?](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-006.md)
