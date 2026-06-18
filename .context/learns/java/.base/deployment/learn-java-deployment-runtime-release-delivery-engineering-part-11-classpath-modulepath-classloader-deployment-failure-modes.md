# Learn Java Deployment Runtime Release Delivery Engineering

## Part 11 — Classpath, Module Path, ClassLoader, and Deployment Failure Modes

> Seri: `learn-java-deployment-runtime-release-delivery-engineering`  
> Level: Advanced / Principal Engineer  
> Fokus: Java 8 sampai Java 25  
> Tujuan: Memahami bagaimana Java menemukan, memuat, menghubungkan, dan mengisolasi class/resource saat runtime, serta bagaimana kegagalan deployment muncul dari classpath, module path, dan classloader boundary.

---

# 0. Posisi Materi Ini Dalam Series

Pada part sebelumnya kita sudah membahas:

- artifact taxonomy: JAR, WAR, EAR, thin JAR, fat JAR, layered JAR, native image;
- runtime selection;
- OS/runtime layout;
- configuration deployment;
- JVM options;
- deployment ke Linux server;
- containerizing Java;
- Dockerfile pattern;
- `jlink`, `jdeps`, `jpackage`, dan custom runtime image.

Bagian ini masuk ke salah satu sumber kegagalan production Java yang paling sering membuat debugging menjadi mahal:

> aplikasi berhasil di-build, image berhasil dibuat, deployment berhasil apply, process berhasil start, tetapi runtime gagal karena class yang dimuat bukan class yang kita kira.

Masalah ini jarang terlihat sebagai “deployment problem” pada awalnya. Gejalanya sering muncul sebagai:

- service tidak bisa start;
- endpoint tertentu error setelah traffic masuk;
- hanya environment tertentu yang gagal;
- hanya WAR di app server yang gagal, tetapi executable JAR lokal aman;
- hanya setelah upgrade library/JDK/app server;
- hanya setelah mengubah base image/container layer;
- hanya setelah menambahkan dependency transitif;
- hanya pada satu module dari banyak module;
- hanya pada path tertentu yang memakai reflection, SPI, XML parser, JDBC driver, logging binding, JSON provider, JAXB provider, atau Jakarta provider.

Materi ini tidak mengulang build dependency management secara umum. Fokus kita adalah **runtime deployment mechanics**.

---

# 1. Core Mental Model

Deployment Java tidak hanya menaruh artifact ke server. Deployment Java membuat kontrak antara:

```text
source code
  -> compiled bytecode
  -> dependency graph
  -> artifact layout
  -> launcher command
  -> classpath/module path
  -> classloader graph
  -> runtime linkage
  -> reflective/resource/SPI lookup
  -> application behavior
```

Kesalahan di salah satu lapisan bisa menghasilkan runtime yang berbeda dari yang divalidasi di build pipeline.

## 1.1 Pertanyaan Utama

Saat aplikasi Java berjalan, JVM harus menjawab empat pertanyaan:

1. **Di mana class dicari?**  
   Classpath, module path, runtime image, boot/platform loader, webapp loader, custom loader, agent loader.

2. **Siapa yang memuat class tersebut?**  
   Bootstrap loader, platform loader, application loader, servlet/webapp loader, plugin loader, OSGi loader, custom framework loader.

3. **Versi class mana yang menang?**  
   Ini tergantung order classpath, module resolution, parent-first/child-first delegation, shaded class, shared library, provided dependency, dan container library.

4. **Apakah class tersebut compatible dengan caller?**  
   Kompatibilitas bytecode, method signature, field signature, package/module access, class initialization, dependency transitif, dan runtime reflection.

Top 1% engineer tidak hanya membaca stack trace. Mereka membangun **model lookup dan linkage**.

---

# 2. Class Is Not Just a Name

Di Java, class identity bukan hanya nama package + class.

Secara runtime, class identity kira-kira adalah:

```text
(binary class name, defining classloader, module/package context)
```

Dua class dengan nama sama bisa dianggap berbeda jika dimuat oleh classloader berbeda.

Contoh konseptual:

```text
com.example.User loaded by WebAppClassLoader@A
com.example.User loaded by WebAppClassLoader@B
```

Bagi JVM, keduanya bukan class yang sama.

Dampaknya:

```java
Object userFromPlugin = plugin.createUser();
User user = (User) userFromPlugin; // bisa ClassCastException
```

Meskipun nama class sama, jika classloader berbeda, cast bisa gagal.

## 2.1 Deployment Implication

Hal ini penting pada:

- servlet container dengan banyak webapp;
- EAR dengan beberapa WAR/EJB module;
- plugin architecture;
- app server shared library;
- OSGi;
- custom module loader;
- Java agent;
- fat JAR dengan nested classloader;
- framework yang melakukan restart classloader seperti Spring Boot DevTools;
- test runtime yang berbeda dari production runtime.

---

# 3. Classpath: Model Lama Yang Masih Dominan

Classpath adalah daftar lokasi tempat JVM mencari class dan resource.

Bentuk lokasi:

- direktori hasil compile;
- JAR file;
- wildcard JAR path;
- path absolut/relatif;
- environment variable `CLASSPATH`;
- argumen `-cp` atau `--class-path`.

Contoh:

```bash
java -cp "app.jar:lib/*" com.example.Main
```

Di Windows separator path biasanya `;`, di Linux/macOS `:`.

## 3.1 Classpath Is Ordered

Classpath bukan set. Classpath adalah list berurutan.

Jika class yang sama ada di dua JAR:

```text
-cp lib/a.jar:lib/b.jar
```

dan keduanya mengandung:

```text
com/example/JsonUtil.class
```

maka class yang lebih awal biasanya menang, tergantung classloader implementation.

Ini membuat classpath bersifat:

- order-sensitive;
- mudah berubah karena build tool/plugin;
- rawan duplicate class;
- rawan dependency shadowing;
- sulit diaudit secara manual jika graph besar.

## 3.2 Classpath Tidak Punya Konsep Versi

Classpath tidak tahu:

```text
guava-28.jar
guava-32.jar
```

Ia hanya tahu ada class:

```text
com/google/common/collect/ImmutableList.class
```

Jika dua versi ada bersamaan, JVM tidak menyelesaikan konflik berdasarkan semantic version. Yang terjadi adalah lookup order.

## 3.3 Classpath Tidak Punya Strong Encapsulation

Pada classpath, banyak boundary bersifat konvensi, bukan enforcement kuat.

Masalah umum:

- internal API library bisa terpakai tanpa sadar;
- split package bisa terjadi;
- duplicate resource bisa tidak terlihat;
- service provider bisa tertimpa;
- package yang sama bisa tersebar di banyak JAR;
- reflective access lebih longgar dibanding module path.

## 3.4 Classpath Deployment Failure Pattern

Classpath problem sering muncul dalam bentuk:

```text
works on local, fails on server
works in IDE, fails in packaged jar
works as boot jar, fails as WAR
works in Java 8, fails in Java 17/21/25
works before adding dependency X
works before moving lib/ order
```

Akar masalahnya sering bukan source code, tetapi **runtime search space berubah**.

---

# 4. Module Path: Model Java 9+

Sejak Java 9, Java memperkenalkan Java Platform Module System.

Module path berbeda dari classpath.

Classpath mencari **class/resource individual**.

Module path mencari **module utuh**.

Sebuah module punya descriptor:

```java
module com.example.payment {
    requires java.sql;
    requires com.fasterxml.jackson.databind;
    exports com.example.payment.api;
}
```

Module system mencoba membuat dependency lebih eksplisit:

- module punya nama;
- module menyatakan dependency (`requires`);
- module menyatakan package yang diekspor (`exports`);
- module bisa membuka package untuk reflection (`opens`);
- module graph di-resolve saat launch/link/compile.

## 4.1 Module Path Is Not Just Better Classpath

Module path bukan “classpath versi baru”. Ia punya aturan berbeda:

```text
classpath: list of class/resource containers
module path: set of named modules and module descriptors
```

Konsekuensi:

- duplicate module name bisa gagal;
- package yang sama dalam lebih dari satu module bisa bermasalah;
- access antar module dikontrol;
- reflective access bisa butuh `opens` atau `--add-opens`;
- unnamed module dari classpath bisa berinteraksi dengan named module, tetapi ada batasan;
- automatic module name bisa tidak stabil jika tidak didefinisikan.

## 4.2 Named Module, Automatic Module, Unnamed Module

Saat deployment Java 9+, kita perlu memahami tiga kategori:

### Named Module

JAR punya `module-info.class`.

```text
payment.jar
  module-info.class
  com/example/payment/...
```

Ia punya nama module eksplisit.

### Automatic Module

JAR biasa diletakkan di module path, tetapi tidak punya `module-info.class`.

JVM bisa memperlakukannya sebagai automatic module.

Nama module bisa berasal dari:

- manifest `Automatic-Module-Name`;
- nama file JAR.

Risiko:

```text
my-lib-1.2.3.jar -> my.lib
my.lib.jar       -> my.lib
```

Perubahan nama file dapat mengubah module name jika tidak distabilkan.

### Unnamed Module

Semua class di classpath masuk ke unnamed module.

Banyak aplikasi modern masih berjalan sebagai unnamed module karena framework dan dependency graph masih classpath-oriented.

## 4.3 Deployment Implication

Untuk Java 8, module path tidak ada.

Untuk Java 9–25:

- aplikasi legacy tetap bisa berjalan di classpath;
- aplikasi modular bisa berjalan di module path;
- sebagian aplikasi hybrid memakai module path + classpath;
- custom runtime image dengan `jlink` membutuhkan module graph yang jelas;
- reflection-heavy framework bisa butuh `--add-opens`;
- dependency yang dulu aman di Java 8 bisa gagal karena encapsulation lebih kuat.

---

# 5. ClassLoader Hierarchy

Classloader adalah object yang bertanggung jawab memuat class.

Model klasik JVM modern:

```text
Bootstrap ClassLoader
  -> Platform ClassLoader
      -> Application/System ClassLoader
          -> Framework/App-specific ClassLoader(s)
```

## 5.1 Bootstrap ClassLoader

Memuat core Java runtime classes.

Contoh:

```text
java.lang.String
java.lang.Object
java.util.List
```

Pada Java modern, runtime classes berasal dari modular runtime image, bukan `rt.jar` seperti era lama.

## 5.2 Platform ClassLoader

Memuat platform modules/classes tertentu.

Pada Java 9+, konsep extension classloader lama berubah. Banyak asumsi Java 8 tentang extension directory sudah tidak relevan.

## 5.3 Application/System ClassLoader

Memuat class dari classpath/module path aplikasi yang diluncurkan oleh command `java`.

Untuk executable JAR biasa:

```bash
java -jar app.jar
```

application loader memuat entrypoint dan dependency sesuai mekanisme launcher.

## 5.4 Custom ClassLoader

Framework bisa membuat loader sendiri untuk:

- nested JAR;
- plugin isolation;
- hot reload;
- servlet webapp isolation;
- OSGi bundle;
- application server module system;
- Java agent instrumentation;
- scripting engine;
- tenant isolation.

---

# 6. Parent-First vs Child-First Loading

Classloader biasanya mengikuti delegation model:

```text
child asks parent first
if parent cannot load, child loads
```

Ini disebut **parent-first**.

Namun beberapa environment memakai variasi child-first untuk memberi webapp/plugin prioritas atas library parent.

## 6.1 Parent-First

Kelebihan:

- core/platform classes terlindungi;
- shared library konsisten;
- risiko duplicate lebih rendah;
- container bisa mengontrol API.

Risiko:

- app tidak bisa override library lama di parent;
- dependency app bisa kalah dari shared library;
- upgrade aplikasi tidak efektif jika parent masih punya versi lama.

## 6.2 Child-First

Kelebihan:

- app bisa membawa versi library sendiri;
- isolasi webapp/plugin lebih kuat;
- upgrade per aplikasi lebih fleksibel.

Risiko:

- container API bisa tertimpa jika tidak dilindungi;
- class identity conflict lebih mudah;
- shared types antar loader bisa ClassCastException;
- logging/JDBC/provider conflict bisa aneh.

## 6.3 Deployment Question

Saat ada classloading bug, tanyakan:

```text
Class ini dimuat oleh loader mana?
Loader tersebut parent-first atau child-first?
Apakah class yang sama ada di parent dan child?
Apakah object melewati boundary antar loader?
```

---

# 7. Executable JAR Classloading

Executable JAR sederhana:

```bash
java -jar app.jar
```

Manifest:

```text
Main-Class: com.example.Main
Class-Path: lib/a.jar lib/b.jar
```

Atau:

```bash
java -cp "app.jar:lib/*" com.example.Main
```

## 7.1 Thin JAR

Thin JAR bergantung pada external `lib/`.

Layout:

```text
app/
  app.jar
  lib/
    jackson-databind.jar
    hikari.jar
    oracle-jdbc.jar
```

Risiko deployment:

- lib hilang;
- versi lib salah;
- lib dari release lama tersisa;
- wildcard order berubah;
- deployment partial update;
- symlink release tidak atomik;
- `lib/` shared antar aplikasi.

## 7.2 Fat/Shaded JAR

Fat JAR menggabungkan dependency.

Risiko:

- duplicate class diam-diam tertimpa;
- resource merge salah;
- `META-INF/services` tidak tergabung benar;
- signature file rusak;
- license/SBOM tidak jelas;
- relocation/shading membuat stack trace berubah;
- reflection string class name tidak ikut direlokasi.

## 7.3 Spring Boot Executable JAR

Spring Boot executable JAR punya nested JAR layout dan launcher sendiri.

Konsekuensi:

- bukan classpath JAR biasa;
- dependency berada di `BOOT-INF/lib/`;
- application class di `BOOT-INF/classes/`;
- loader khusus memuat nested JAR;
- beberapa tool yang mengasumsikan flat classpath bisa gagal;
- container image layering bisa memanfaatkan dependency/application separation.

---

# 8. WAR and Servlet Container Classloading

WAR deployment berbeda dari executable JAR.

Layout WAR:

```text
myapp.war
  WEB-INF/classes/
  WEB-INF/lib/
  WEB-INF/web.xml
```

Dalam servlet container:

```text
container classes
shared libraries
webapp classes
webapp libraries
```

Tomcat, Jetty, Undertow, WildFly, WebLogic, WebSphere, Payara/Open Liberty memiliki detail classloader sendiri.

## 8.1 Provided Dependencies

Dalam WAR, beberapa dependency seharusnya `provided` karena container sudah menyediakannya.

Contoh:

- Servlet API;
- JSP API;
- Jakarta EE API tertentu;
- JTA API;
- JPA provider dalam app server tertentu;
- server-specific API.

Jika dependency yang harusnya `provided` ikut masuk ke `WEB-INF/lib`, bisa terjadi:

- class duplication;
- API mismatch;
- runtime method missing;
- class cast issue;
- container behavior tidak stabil.

## 8.2 Jakarta Migration Trap

Jakarta EE 9+ mengganti namespace:

```text
javax.servlet.* -> jakarta.servlet.*
javax.persistence.* -> jakarta.persistence.*
javax.validation.* -> jakarta.validation.*
```

Deployment failure umum:

```text
App compiled against jakarta.*
Container only supports javax.*
```

atau sebaliknya:

```text
App compiled against javax.*
Container supports jakarta.* only
```

Gejala:

```text
ClassNotFoundException: jakarta.servlet.Servlet
NoClassDefFoundError: javax/servlet/Servlet
```

Ini bukan sekadar dependency issue. Ini **runtime platform mismatch**.

---

# 9. EAR and Enterprise Classloading

EAR bisa berisi beberapa module:

```text
application.ear
  lib/
  app1.war
  app2.war
  services.jar
  META-INF/application.xml
```

Classloading EAR lebih kompleks karena ada beberapa boundary:

- EAR-level library;
- WAR-level `WEB-INF/lib`;
- EJB/JAR module;
- app server global module;
- domain/server shared library;
- vendor-specific classloading policy.

## 9.1 Common EAR Failure

Contoh masalah:

```text
WAR A membawa jackson 2.13
WAR B membawa jackson 2.17
EAR/lib membawa jackson 2.15
App server global membawa jackson 2.12
```

Pertanyaan sebenarnya:

```text
Jackson mana yang dipakai oleh WAR A?
Jackson mana yang dipakai oleh shared service?
Apakah object dari WAR A melewati boundary ke WAR B?
Apakah provider lookup menemukan resource dari versi mana?
```

## 9.2 Rule of Thumb

Untuk EAR/app server:

- jangan asal menaruh library di shared/global lib;
- dependency yang dipakai satu WAR sebaiknya ada di WAR itu;
- dependency yang sengaja shared harus distabilkan versinya;
- API interface yang melewati module boundary harus ditempatkan pada loader yang sama;
- jangan mencampur provider implementation berbeda di banyak layer;
- dokumentasikan classloading policy per server.

---

# 10. Resource Loading Is Also Classloading

Banyak deployment bug bukan karena `.class`, tetapi resource.

Contoh resource:

```text
application.yml
logback.xml
META-INF/services/*
META-INF/spring/*
META-INF/persistence.xml
META-INF/beans.xml
schema.sql
messages.properties
keystore.p12
```

## 10.1 `getResource` and `getResourceAsStream`

Resource bisa dicari lewat:

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
InputStream in = cl.getResourceAsStream("application.yml");
```

atau:

```java
InputStream in = MyClass.class.getResourceAsStream("/application.yml");
```

Perbedaan loader/context bisa menghasilkan resource berbeda.

## 10.2 Duplicate Resource

Jika ada dua JAR mengandung:

```text
META-INF/services/com.example.Plugin
```

Maka merge behavior tergantung packaging.

Pada shaded JAR, jika resource tidak di-merge, provider bisa hilang.

Akibat:

- JDBC driver tidak ditemukan;
- JSON provider tidak ditemukan;
- logging binding tidak aktif;
- XML parser provider berbeda;
- SPI extension tidak jalan;
- annotation processor/runtime scanner gagal.

## 10.3 Thread Context ClassLoader

Banyak framework memakai Thread Context ClassLoader (TCCL) untuk lookup provider.

Contoh area yang sering bergantung TCCL:

- JNDI;
- JDBC driver discovery;
- ServiceLoader;
- XML parser;
- JAXB;
- JPA provider;
- CDI;
- logging;
- scripting;
- application server integration.

Deployment bug bisa muncul jika thread dibuat manual tanpa context classloader yang benar.

Contoh:

```java
Thread t = new Thread(() -> service.loadPlugin());
t.start();
```

Pada environment container/app server, thread manual bisa membawa loader yang tidak sesuai, atau tidak membawa konteks container yang dibutuhkan.

---

# 11. ServiceLoader and META-INF/services

Java `ServiceLoader` mencari provider melalui metadata:

```text
META-INF/services/<fully-qualified-interface-name>
```

Isi file:

```text
com.example.impl.DefaultProvider
com.example.impl.FastProvider
```

## 11.1 Deployment Failure

Jika fat JAR/shading tidak merge service files, provider bisa hilang.

Contoh:

```text
jar A -> META-INF/services/java.sql.Driver
jar B -> META-INF/services/java.sql.Driver
```

Jika build hanya mengambil salah satu file, driver lain hilang.

## 11.2 Symptom

- provider tidak ditemukan;
- fallback provider dipakai tanpa sadar;
- runtime behavior berbeda dari local;
- `No suitable driver found`;
- JSON-B/JAXB/JAXP provider mismatch;
- logging implementation tidak aktif.

## 11.3 Deployment Rule

Jika memakai shaded/fat JAR:

- audit `META-INF/services`;
- gunakan transformer/merge strategy yang benar;
- test provider discovery dari packaged artifact, bukan hanya dari IDE;
- jalankan smoke test dengan command produksi.

---

# 12. Common Runtime Errors and Real Meaning

## 12.1 `ClassNotFoundException`

Checked exception. Biasanya terjadi saat code mencoba memuat class by name:

```java
Class.forName("com.example.Plugin")
```

Makna deployment:

```text
Class tidak tersedia pada loader yang dipakai untuk lookup.
```

Kemungkinan:

- dependency tidak ikut packaged;
- wrong classpath;
- wrong module path;
- class ada tapi loader berbeda;
- provided dependency tidak disediakan container;
- optional dependency tidak ada;
- reflective class name salah;
- shading/relocation mengubah package;
- Java version/profile runtime tidak mengandung module/class tersebut.

## 12.2 `NoClassDefFoundError`

Error ini sering disalahpahami.

Makna umum:

```text
Class pernah diketahui saat compile/linking, tetapi saat runtime definition tidak bisa ditemukan atau initialization gagal.
```

Dua bentuk umum:

### Class Missing

```text
java.lang.NoClassDefFoundError: com/example/Foo
Caused by: java.lang.ClassNotFoundException: com.example.Foo
```

### Initialization Failed

```text
java.lang.NoClassDefFoundError: Could not initialize class com.example.Config
```

Artinya class ada, tetapi static initializer gagal sebelumnya.

Contoh:

```java
class Config {
    static final String SECRET = loadRequiredSecret(); // throws
}
```

## 12.3 `NoSuchMethodError`

Makna:

```text
Caller berhasil compile terhadap method tertentu, tetapi class yang dimuat saat runtime tidak punya method itu.
```

Biasanya karena version mismatch.

Contoh:

```text
Compiled with library v2
Runtime loads library v1
```

Ini sangat sering pada:

- transitive dependency conflict;
- app server shared library;
- old library in `$CATALINA_BASE/lib`;
- thin deployment `lib/` tidak bersih;
- Docker layer cache memakai JAR lama;
- container base image membawa library server lama;
- BOM tidak konsisten;
- dependency resolution berbeda antara build dan runtime.

## 12.4 `NoSuchFieldError`

Mirip `NoSuchMethodError`, tetapi field hilang/berubah.

Biasanya binary incompatibility.

## 12.5 `AbstractMethodError`

Makna:

```text
Runtime class tidak mengimplementasikan method yang caller harapkan.
```

Sering terjadi ketika interface berubah antara versi compile dan runtime.

Contoh:

```text
Compiled against interface v2 with new method
Runtime implementation class from v1 loaded
```

## 12.6 `IncompatibleClassChangeError`

Payung besar untuk mismatch binary structure.

Contoh:

- class berubah menjadi interface;
- method static vs instance berubah;
- field/method signature incompatible;
- runtime class tidak sesuai dengan bytecode expectation.

## 12.7 `LinkageError`

Keluarga error yang menunjukkan JVM gagal melakukan linking class.

Termasuk:

- `NoClassDefFoundError`;
- `NoSuchMethodError`;
- `NoSuchFieldError`;
- `IncompatibleClassChangeError`;
- `UnsupportedClassVersionError`;
- `ClassFormatError`;
- `ExceptionInInitializerError` terkait initialization.

## 12.8 `UnsupportedClassVersionError`

Makna:

```text
Class dikompilasi dengan target Java lebih baru daripada runtime JVM.
```

Contoh:

```text
Class file version 65 = Java 21
Runtime Java 17 tidak bisa menjalankan
```

Deployment implication:

- build image memakai JDK 21;
- runtime image memakai JRE/JDK 17;
- multi-stage Dockerfile salah base;
- CI agent dan production runtime berbeda;
- app server berjalan di JDK lama;
- plugin compiled dengan JDK lebih baru.

## 12.9 `IllegalAccessError`

Makna:

```text
Class mencoba mengakses member/class yang tidak boleh diakses pada runtime.
```

Bisa muncul karena:

- binary compatibility berubah;
- module encapsulation;
- library memakai internal JDK API;
- reflective access yang dulu longgar sekarang dibatasi;
- package-private boundary berubah karena shading/split package.

## 12.10 `ClassCastException: X cannot be cast to X`

Ini gejala klasik classloader conflict.

Contoh:

```text
com.example.User cannot be cast to com.example.User
```

Makna:

```text
Nama class sama, tetapi defining classloader berbeda.
```

Biasanya pada:

- WAR/EAR boundary;
- plugin system;
- shared library duplicated;
- hot reload classloader;
- app server module isolation;
- multiple deployment of same library.

---

# 13. Java 8 to Java 25 Compatibility Trap

## 13.1 Java 8 Era

Pada Java 8:

- classpath dominan;
- `rt.jar` masih dikenal;
- extension mechanism lama masih ada;
- banyak internal JDK API masih bisa diakses;
- JAXB/JAX-WS masih tersedia di JDK 8;
- illegal reflective access bukan isu module system;
- banyak framework lama mengasumsikan classpath longgar.

## 13.2 Java 9+

Java 9 memperkenalkan module system.

Dampak deployment:

- JDK modular;
- `rt.jar` hilang;
- internal API mulai dienkapsulasi;
- module path tersedia;
- `--add-opens`, `--add-exports`, `--add-modules` menjadi deployment tools;
- beberapa Java EE/CORBA modules deprecated/removed kemudian;
- custom runtime image via `jlink` menjadi mungkin.

## 13.3 Java 11+

Java 11 adalah LTS besar setelah Java 8.

Trap umum:

- JAXB/JAX-WS tidak lagi bundled seperti Java 8;
- dependency yang dulu “ada di JDK” harus ditambahkan eksplisit;
- TLS/crypto default berubah;
- reflective access warning mulai serius;
- library lama bisa gagal.

## 13.4 Java 17+

Java 17 memperkuat encapsulation.

Trap umum:

- reflective framework lama butuh update;
- penggunaan internal JDK API lebih sering gagal;
- `--illegal-access` bukan solusi jangka panjang;
- framework agent/instrumentation harus kompatibel.

## 13.5 Java 21/25

Java 21 dan 25 membawa baseline modern untuk production baru.

Deployment trap:

- library/agent harus mendukung class file version baru;
- app server harus certified/support runtime Java tersebut;
- build tool/plugin harus update;
- bytecode instrumentation tool seperti ASM/ByteBuddy/Javassist harus support versi class file;
- observability/security agent bisa menjadi bottleneck compatibility;
- custom runtime image harus direbuild untuk patch runtime.

---

# 14. Split Package

Split package terjadi ketika package yang sama ada di lebih dari satu module/JAR.

Contoh:

```text
lib-a.jar -> com.example.common.Foo
lib-b.jar -> com.example.common.Bar
```

Pada classpath, ini mungkin berjalan.

Pada module path, ini bisa gagal karena module system tidak menyukai package yang sama tersebar di beberapa module.

## 14.1 Why It Matters

Split package membuat ownership tidak jelas:

```text
Siapa pemilik package com.example.common?
Versi mana yang authoritative?
Apakah package-private access bergantung pada JAR tertentu?
Bagaimana scanner membaca annotation/resource?
```

## 14.2 Deployment Failure

Gejala:

- module resolution error;
- class not visible;
- unexpected class from wrong JAR;
- reflection scanner conflict;
- package sealing violation;
- `LayerInstantiationException` pada module layer tertentu.

## 14.3 Remediation

- refactor package ownership;
- avoid splitting package across modules;
- use one common artifact;
- avoid shading ke package yang sama;
- define stable module boundaries;
- jika legacy, tetap di classpath sampai siap modularisasi.

---

# 15. Package Sealing

JAR dapat menyatakan package sealed di manifest.

Contoh:

```text
Sealed: true
```

Package sealing berarti semua class dalam package tertentu harus berasal dari JAR yang sama.

Jika package tersebar di banyak JAR, bisa muncul:

```text
SecurityException: sealing violation
```

## 15.1 Deployment Implication

Jar repackaging, shading, atau split lib bisa memicu sealing violation.

Audit manifest jika terjadi error aneh saat class loading.

---

# 16. Multi-Release JAR

Multi-release JAR memungkinkan JAR memiliki class berbeda untuk Java version berbeda.

Layout:

```text
com/example/Foo.class
META-INF/versions/9/com/example/Foo.class
META-INF/versions/17/com/example/Foo.class
```

Runtime Java memilih versi class sesuai JVM.

## 16.1 Deployment Benefit

Satu artifact bisa mendukung beberapa Java version dengan optimasi API tertentu.

## 16.2 Deployment Risk

Aplikasi bisa berperilaku berbeda antara Java 8, 11, 17, 21, 25 meskipun JAR sama.

Failure pattern:

```text
works on Java 11, fails on Java 17
same artifact, different selected class
```

## 16.3 Rule

Jika menggunakan multi-release dependency:

- test pada semua target Java runtime;
- audit manifest `Multi-Release: true`;
- jangan asumsikan bytecode path sama lintas runtime;
- perhatikan agent/instrumentation compatibility.

---

# 17. Shading and Relocation Failure Modes

Shading menggabungkan dependency ke artifact utama.

Relocation mengubah package dependency.

Contoh:

```text
com.fasterxml.jackson.* -> com.myapp.shaded.jackson.*
```

## 17.1 Benefit

- menghindari conflict dependency;
- membuat artifact mandiri;
- melindungi library internal;
- cocok untuk CLI/tool/plugin tertentu.

## 17.2 Risk

- ServiceLoader metadata tidak ikut direlokasi/merge;
- reflection string tidak berubah;
- resource path tidak berubah;
- native library loading gagal;
- license/signature issue;
- debugging lebih sulit;
- CVE scanner bisa miss atau double count;
- stack trace tidak cocok dengan upstream docs;
- duplicate shaded copies memperbesar memory.

## 17.3 When Shading Is Dangerous

Hindari shading sembarangan untuk:

- application server WAR;
- frameworks with SPI;
- libraries yang dipakai orang lain;
- Jakarta/Spring API;
- logging facade/implementation;
- database driver;
- cryptography/security provider;
- observability agent dependency;
- classes yang diakses reflection by string.

---

# 18. Provided Dependency Trap

Dalam build, dependency bisa punya scope `provided`.

Artinya:

```text
Needed for compile, but provided by runtime environment.
```

Contoh Maven:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <scope>provided</scope>
</dependency>
```

## 18.1 Works Locally, Fails in Production

Jika local test memakai embedded container yang membawa API berbeda, sedangkan production container berbeda, error bisa muncul hanya saat deploy.

## 18.2 Provided Scope Requires Runtime Contract

Setiap `provided` dependency harus punya jawaban:

```text
Runtime mana yang menyediakan ini?
Versi berapa?
Bagaimana diverifikasi saat deployment?
Apakah semua environment sama?
Apakah app server upgrade mengubahnya?
```

Jika tidak ada jawaban, `provided` adalah hidden dependency risk.

---

# 19. Dependency Conflict Patterns

## 19.1 Direct vs Transitive Conflict

Contoh:

```text
app -> A -> commons-lang3 3.10
app -> B -> commons-lang3 3.14
```

Build tool memilih satu versi.

Namun runtime bisa berbeda jika:

- external lib directory punya versi lain;
- app server shared lib punya versi lain;
- Docker image layer masih menyimpan versi lama;
- WAR membawa dependency yang tidak sesuai;
- manual copy salah.

## 19.2 Compile Runtime Drift

Compile classpath:

```text
lib-x 2.0
```

Runtime classpath:

```text
lib-x 1.7
```

Gejala:

```text
NoSuchMethodError
NoSuchFieldError
AbstractMethodError
```

## 19.3 Dependency Mediation Is Build-Time Only

Maven/Gradle dependency resolution tidak otomatis menjamin runtime environment sama.

Deployment harus memastikan:

- artifact final diverifikasi;
- image final diverifikasi;
- WAR contents diverifikasi;
- app server shared lib diverifikasi;
- runtime command diverifikasi;
- classpath sebenarnya diketahui.

---

# 20. Logging Classpath Problems

Logging adalah sumber conflict klasik.

Komponen:

- facade: SLF4J, Jakarta Commons Logging, JUL;
- implementation: Logback, Log4j2, reload4j;
- bridge: jul-to-slf4j, jcl-over-slf4j, log4j-to-slf4j;
- app server logging subsystem.

## 20.1 Failure Modes

- multiple SLF4J bindings;
- no provider found;
- bridge loop;
- app server captures logs differently;
- Log4j2 plugin cache missing after shading;
- logging config not found;
- JUL vs SLF4J mismatch;
- library logs disappear in production.

## 20.2 Deployment Rule

For each deployment unit, define:

```text
Which logging API can application code use?
Which implementation is active?
Who owns logging config?
Where does stdout/stderr go?
Does app server override logging?
Are bridges intentional?
```

---

# 21. JDBC Driver Loading

JDBC driver discovery can use ServiceLoader.

Driver JAR contains:

```text
META-INF/services/java.sql.Driver
```

## 21.1 Failure Modes

- driver not packaged;
- driver packaged but service file lost in shading;
- app server expects driver as datasource module;
- app includes driver but datasource configured at server level;
- classloader boundary prevents driver discovery;
- multiple driver versions loaded;
- old driver incompatible with Java version;
- driver compiled for newer Java than runtime.

## 21.2 Deployment Rule

For JDBC:

```text
Is datasource app-managed or container-managed?
Where is driver installed?
Which classloader loads driver?
Which version?
How is it patched?
How is it tested in packaged runtime?
```

---

# 22. XML, JSON, Validation, Persistence Providers

Provider lookup matters for:

- JAXP XML parser;
- JAXB provider;
- JSON-B provider;
- JSON-P provider;
- Jackson modules;
- Bean Validation provider;
- JPA provider;
- CDI provider;
- Mail provider;
- Activation provider.

Failure can be subtle:

- wrong provider selected;
- provider not found;
- annotation scanning incomplete;
- `persistence.xml` not found;
- `beans.xml` ignored;
- validation constraints not applied;
- different XML parser behavior;
- serialization/deserialization changes.

## 22.1 Deployment Rule

If behavior depends on provider discovery:

- test final artifact;
- inspect `META-INF/services`;
- inspect runtime logs at startup;
- explicitly configure provider where possible;
- avoid duplicate provider implementations;
- avoid mixing Jakarta and javax generation.

---

# 23. Java Agent and Classloading

Java agents attach via:

```bash
-javaagent:/path/agent.jar
```

Agents can transform bytecode.

Examples:

- APM agent;
- OpenTelemetry Java agent;
- security agent;
- profiling agent;
- coverage agent;
- custom instrumentation.

## 23.1 Deployment Risks

- agent not compatible with Java 21/25 class file version;
- agent modifies classes before framework expects;
- agent has its own shaded dependencies;
- agent conflicts with application dependencies;
- startup slower;
- memory overhead;
- class transformation causes verification error;
- native attach disabled;
- module opens needed.

## 23.2 Rule

Agent is part of deployment contract.

Record:

```text
agent version
supported Java versions
startup impact
memory impact
required JVM flags
required module opens
rollback plan without agent
```

---

# 24. Module Access Flags

Java 9+ introduced flags often used as migration aids:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-exports java.base/sun.nio.ch=ALL-UNNAMED
--add-modules java.xml.bind
```

Note: some modules removed after Java 8/9 era require external dependencies now.

## 24.1 `--add-opens`

Opens package for deep reflection.

Useful for frameworks/agents that need reflective access.

Risk:

- weakens encapsulation;
- may hide outdated dependency;
- can be forgotten during upgrade;
- may not be accepted by future runtime policies.

## 24.2 `--add-exports`

Exports internal package to another module/unnamed module for compile/runtime access.

Riskier because it usually means code depends on internal API.

## 24.3 Rule

Every `--add-opens` / `--add-exports` in deployment must have:

```text
owner
reason
library that needs it
target Java version
removal plan
verification test
```

Do not let these flags become permanent mystery cargo cult.

---

# 25. Diagnosing Classpath/Classloader Problems

## 25.1 Start with Final Runtime, Not Source

Never debug classpath problems from IDE assumptions.

Use final deployment unit:

```text
final JAR/WAR/EAR
final container image
final startup command
final app server
final Java runtime
final environment
```

## 25.2 Capture Java Version

```bash
java -version
```

Also capture:

```bash
which java
readlink -f $(which java)
```

Inside container:

```bash
docker run --rm image java -version
```

## 25.3 Print Runtime Properties

Useful properties:

```bash
java -XshowSettings:properties -version
```

Look for:

```text
java.version
java.home
java.class.path
jdk.module.path
sun.boot.library.path
user.dir
file.encoding
os.arch
```

## 25.4 Verbose Class Loading

Java 8:

```bash
-verbose:class
```

Java 9+ unified logging:

```bash
-Xlog:class+load=info
```

More focused:

```bash
-Xlog:class+load=debug
-Xlog:module=debug
```

Use carefully in production because logs can be large.

## 25.5 Find Which JAR Contains Class

```bash
jar tf app.jar | grep 'com/example/Foo.class'
```

For directory of JARs:

```bash
for j in lib/*.jar; do
  if jar tf "$j" | grep -q 'com/example/Foo.class'; then
    echo "$j"
  fi
done
```

## 25.6 Inspect WAR

```bash
jar tf myapp.war | sort | less
jar tf myapp.war | grep 'WEB-INF/lib'
```

Find duplicate:

```bash
jar tf myapp.war | grep 'WEB-INF/lib/.*jackson'
```

## 25.7 Inspect Manifest

```bash
unzip -p app.jar META-INF/MANIFEST.MF
```

Look for:

```text
Main-Class
Class-Path
Multi-Release
Automatic-Module-Name
Sealed
```

## 25.8 Inspect Module Descriptor

```bash
jar --describe-module --file lib.jar
```

Or:

```bash
jdeps --module-path mods --list-deps app.jar
```

## 25.9 Check Duplicate Classes

Conceptual script:

```bash
mkdir -p /tmp/classes-index
for j in lib/*.jar; do
  jar tf "$j" | grep '\.class$' | sed "s|^|$j |"
done | awk '{print $2}' | sort | uniq -d
```

For production-grade use, prefer build plugins/tools that detect duplicate classes.

## 25.10 Inspect Actual Process Command

On Linux:

```bash
ps -ef | grep java
tr '\0' ' ' < /proc/<pid>/cmdline
```

Environment:

```bash
tr '\0' '\n' < /proc/<pid>/environ
```

Container:

```bash
kubectl exec pod -- ps -ef
kubectl describe pod pod
kubectl logs pod
```

---

# 26. Deployment Verification Checklist

Before declaring deployment artifact safe, verify:

## 26.1 Runtime Identity

- [ ] Java version is expected.
- [ ] Vendor/distribution is expected.
- [ ] Architecture is expected: x64/aarch64.
- [ ] App server version is expected.
- [ ] Container base image is expected.

## 26.2 Artifact Integrity

- [ ] Final artifact hash recorded.
- [ ] Artifact contains expected classes.
- [ ] Artifact does not contain forbidden/provided dependencies.
- [ ] `META-INF/services` entries preserved.
- [ ] Manifest is correct.
- [ ] Multi-release behavior known.

## 26.3 Dependency Integrity

- [ ] Dependency tree locked.
- [ ] Runtime dependency list matches build output.
- [ ] No unexpected duplicate class.
- [ ] No old leftover JAR in external `lib/`.
- [ ] WAR `WEB-INF/lib` reviewed.
- [ ] App server shared/global lib reviewed.

## 26.4 Module/Classloader Integrity

- [ ] Classpath/module path explicit.
- [ ] No accidental reliance on `CLASSPATH` environment variable.
- [ ] `--add-opens`/`--add-exports` documented.
- [ ] Parent/child loading policy known.
- [ ] Shared API boundary classes loaded by common loader.

## 26.5 Provider Integrity

- [ ] JDBC driver discovery works.
- [ ] Logging provider correct.
- [ ] JSON/XML provider correct.
- [ ] Validation/JPA/CDI provider correct if applicable.
- [ ] SPI providers verified from packaged artifact.

---

# 27. Classpath/Module Path Decision Framework

## 27.1 Use Classpath When

- app is legacy Java 8 compatible;
- framework is classpath-oriented;
- modularization cost is high;
- deployment target is old app server;
- dependency graph contains many non-modular libraries;
- you prioritize operational stability over module purity.

## 27.2 Use Module Path When

- app is intentionally modular;
- module graph is clean;
- dependency libraries have stable module names;
- reflection needs are understood;
- you want strong encapsulation;
- you want `jlink` runtime images;
- you can test module resolution thoroughly.

## 27.3 Use Hybrid Carefully

Hybrid classpath + module path can be useful during migration.

But document:

```text
Which modules are named?
Which dependencies remain unnamed?
What readability assumptions exist?
Which --add-opens flags are required?
What is the exit strategy?
```

---

# 28. App Server vs Embedded Runtime Decision

## 28.1 Embedded Runtime

Example:

```bash
java -jar service.jar
```

Advantages:

- application owns runtime dependency graph;
- easier containerization;
- less shared-library conflict;
- one artifact maps to one process;
- rollback is straightforward;
- good for microservices.

Risks:

- every service carries own server libraries;
- patching duplicated across services;
- more process count;
- less centralized governance.

## 28.2 App Server Runtime

Example:

```text
Deploy WAR/EAR to WebLogic/WildFly/Open Liberty/Tomcat
```

Advantages:

- central management;
- shared datasource/security/transaction facilities;
- enterprise integration;
- operational familiarity;
- vendor support.

Risks:

- classloader complexity;
- shared library conflict;
- app server upgrade impact;
- deployment unit not fully self-contained;
- rollback can be harder;
- server config is part of app runtime.

## 28.3 Decision Rule

Choose based on runtime ownership:

```text
If app must own all runtime behavior -> embedded JAR/container.
If platform intentionally provides runtime services -> app server deployment.
```

But never mix accidentally.

---

# 29. Anti-Patterns

## 29.1 “Just Put It in lib/”

Putting dependency into shared `lib/` without ownership creates invisible coupling.

Impact:

- all apps see it;
- upgrade one app breaks another;
- rollback is unclear;
- class version conflict appears later.

## 29.2 Depending on IDE Classpath

IDE classpath is not production classpath.

Always test packaged artifact.

## 29.3 Shipping Both `javax` and `jakarta` Randomly

Mixing namespace generation without clear boundary creates runtime failure.

## 29.4 Fat JAR Without Resource Merge

Fat JAR that does not merge service resources can break providers.

## 29.5 Ignoring App Server Provided APIs

Bundling container API inside WAR can break classloading.

## 29.6 Mystery `--add-opens`

Flags copied from StackOverflow without owner/removal plan become future migration debt.

## 29.7 External `lib/` Not Cleaned During Upgrade

Old JAR leftover causes runtime drift.

Upgrade must be atomic and clean.

## 29.8 Same API Class in Multiple Loaders

Classes used as cross-boundary DTO/API must be loaded by a common loader.

Otherwise:

```text
ClassCastException: X cannot be cast to X
```

---

# 30. Production RCA Playbook

When encountering classpath/classloader error, use this sequence.

## Step 1 — Capture Exact Error

Do not summarize too early.

Capture:

```text
full stack trace
first caused-by
class name
method/field name
classloader info if present
Java version
artifact version
runtime environment
```

## Step 2 — Identify Error Family

Map symptom:

```text
ClassNotFoundException -> lookup by name failed
NoClassDefFoundError -> class missing or init failed
NoSuchMethodError -> version mismatch
NoSuchFieldError -> version mismatch
AbstractMethodError -> interface/implementation mismatch
UnsupportedClassVersionError -> compile/runtime Java mismatch
ClassCastException X to X -> loader identity conflict
IllegalAccessError -> access/module/binary mismatch
```

## Step 3 — Find Class Owner

Ask:

```text
Which artifact should contain this class?
Which artifact actually contains it?
Is there more than one copy?
Which copy is loaded?
```

Use:

```bash
jar tf
jdeps
-Xlog:class+load
-verbose:class
```

## Step 4 — Compare Compile vs Runtime

Compare:

```text
build dependency tree
packaged artifact contents
container image contents
app server shared libs
runtime command
```

## Step 5 — Check Boundary

For WAR/EAR/plugin:

```text
Which classloader owns the API type?
Which classloader owns implementation?
Is object crossing loader boundary?
```

## Step 6 — Fix the Ownership, Not Just the Symptom

Bad fix:

```text
copy another JAR until it starts
```

Good fix:

```text
define dependency ownership
remove duplicate
align versions
adjust provided scope
move shared API to common loader
upgrade compatible runtime/container
add explicit module opens with owner/removal plan
```

---

# 31. Example Scenario 1 — `NoSuchMethodError` After Deployment

## Symptom

```text
java.lang.NoSuchMethodError:
  com.fasterxml.jackson.databind.ObjectMapper.coercionConfigDefaults()
```

## Analysis

This means application code/library expects a Jackson version that has the method, but runtime loaded older Jackson.

Possible causes:

- app compiled with newer Jackson;
- app server shared lib has older Jackson;
- WAR includes old Jackson due to dependency mediation;
- Docker image still contains old lib;
- external `lib/` not cleaned;
- another transitive dependency pinned old version.

## Fix

- inspect final artifact;
- find all Jackson JARs;
- remove shared/global Jackson unless intentionally platform-owned;
- align BOM;
- rebuild image cleanly;
- add duplicate class/dependency convergence check;
- run smoke test from final artifact.

---

# 32. Example Scenario 2 — `ClassCastException: User cannot be cast to User`

## Symptom

```text
java.lang.ClassCastException:
  com.example.User cannot be cast to com.example.User
```

## Analysis

Same class name loaded by different loaders.

Likely architecture:

```text
Plugin loader loads com.example.User
Application loader also loads com.example.User
```

or:

```text
WAR A and WAR B each contain api.jar
```

Object crosses boundary.

## Fix

- move shared API classes to common parent loader;
- ensure plugins do not bundle API classes;
- separate API artifact from implementation artifact;
- use DTO serialization across boundary instead of direct object sharing;
- define loader contract.

---

# 33. Example Scenario 3 — Java 8 to Java 17 Upgrade Breaks Reflection

## Symptom

```text
java.lang.reflect.InaccessibleObjectException:
Unable to make field private final byte[] java.lang.String.value accessible
```

## Analysis

Framework/library tries deep reflection into JDK internals.

In Java 8, this often worked.

In Java 17+, strong encapsulation blocks it unless opened.

## Fix Options

Preferred:

- upgrade library/framework to version supporting Java 17+;
- remove internal reflection dependency.

Temporary migration aid:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
```

But document owner, reason, and removal plan.

---

# 34. Example Scenario 4 — WAR Works on Tomcat 9, Fails on Tomcat 10

## Symptom

```text
java.lang.ClassNotFoundException: javax.servlet.Filter
```

## Analysis

Tomcat 10 uses Jakarta namespace, while Tomcat 9 uses javax Servlet API line.

Application compiled for `javax.servlet.*` cannot simply run on Jakarta namespace container without migration.

## Fix

- deploy javax app to compatible javax container;
- migrate code/dependencies to jakarta namespace;
- ensure all libraries are Jakarta-compatible;
- do not mix random javax/jakarta dependencies;
- validate app server version matrix.

---

# 35. Example Scenario 5 — Shaded JAR Loses JDBC Driver

## Symptom

```text
java.sql.SQLException: No suitable driver found
```

## Analysis

Driver class may exist, but `META-INF/services/java.sql.Driver` was not merged into shaded JAR.

ServiceLoader cannot discover it.

## Fix

- inspect shaded JAR service file;
- configure resource transformer/merge strategy;
- explicitly load driver as temporary workaround only if appropriate;
- test final shaded artifact.

---

# 36. Design Invariants

A robust Java deployment has these invariants:

## Invariant 1 — One Runtime Owner Per Class

Every class should have a clear owner:

```text
JDK
application artifact
container runtime
shared platform library
plugin
agent
```

Ambiguous ownership creates conflict.

## Invariant 2 — Compile Runtime Match

The classes used at compile time must be compatible with classes loaded at runtime.

## Invariant 3 — Boundary Classes Must Be Shared Correctly

Classes crossing classloader boundaries must be loaded by a common ancestor, or transferred through serialization/protocol boundary.

## Invariant 4 — Provider Discovery Must Be Tested From Final Artifact

SPI/resource lookup must be validated after packaging.

## Invariant 5 — Runtime Flags Are Source-Controlled

Classpath/module path and module access flags are deployment source code.

## Invariant 6 — Server Libraries Are Platform APIs

Anything placed in app server/global lib becomes platform-level dependency and must be governed.

## Invariant 7 — Java Version Is Part of Artifact Compatibility

A Java artifact is not fully described without its target bytecode and runtime Java version.

---

# 37. Checklist for Pull Request / Release Review

Use this when reviewing deployment-impacting changes.

## Dependency Change

- [ ] Did dependency tree change?
- [ ] Any dependency version downgrade?
- [ ] Any duplicate class introduced?
- [ ] Any new provider/SPI?
- [ ] Any new annotation/reflection-heavy library?
- [ ] Any new Java agent requirement?
- [ ] Any new native library dependency?

## Artifact Change

- [ ] JAR/WAR/EAR layout changed?
- [ ] Shading/relocation changed?
- [ ] `META-INF/services` merge verified?
- [ ] Manifest changed?
- [ ] Multi-release JAR introduced?

## Runtime Change

- [ ] Java version changed?
- [ ] App server/container version changed?
- [ ] Base image changed?
- [ ] JVM flags changed?
- [ ] Module access flags changed?
- [ ] External `lib/` changed?

## Deployment Environment

- [ ] DEV/UAT/PROD runtime parity checked?
- [ ] App server shared lib parity checked?
- [ ] Container image digest pinned?
- [ ] Startup command audited?
- [ ] Smoke test runs against packaged artifact?

---

# 38. Top 1% Engineer Perspective

A normal engineer sees this:

```text
NoSuchMethodError. Need add dependency.
```

A strong engineer sees this:

```text
The caller was compiled against a binary contract that is not satisfied by the runtime class selected by the active classloader. I need to locate the loaded class, compare it with compile dependency graph, identify why deployment selected the wrong artifact, then fix dependency ownership and add a verification gate.
```

A normal engineer sees this:

```text
ClassNotFoundException. Missing JAR.
```

A strong engineer sees this:

```text
Which loader tried to find it? Was the class missing globally, or invisible from that loader? Is it a provided dependency? Was it removed from JDK after Java 8? Is this javax/jakarta mismatch? Was it shaded/relocated? Is this reflection by string?
```

A normal engineer sees this:

```text
Works locally but not in server.
```

A strong engineer sees this:

```text
Local and server have different runtime search spaces. I need to compare launch command, Java version, classpath/module path, app server shared libs, packaging layout, and environment-specific injected dependencies.
```

---

# 39. Practical Commands Appendix

## Java Version

```bash
java -version
```

## Show Settings

```bash
java -XshowSettings:properties -version
```

## Verbose Class Loading

Java 8:

```bash
java -verbose:class -jar app.jar
```

Java 9+:

```bash
java -Xlog:class+load=info -jar app.jar
```

## Describe Module

```bash
jar --describe-module --file mylib.jar
```

## List JAR Contents

```bash
jar tf app.jar
```

## Read Manifest

```bash
unzip -p app.jar META-INF/MANIFEST.MF
```

## Find Class in JAR Directory

```bash
for j in lib/*.jar; do
  jar tf "$j" | grep -q 'com/example/Foo.class' && echo "$j"
done
```

## Inspect Running Process Command

```bash
tr '\0' ' ' < /proc/<pid>/cmdline
```

## Inspect Running Process Environment

```bash
tr '\0' '\n' < /proc/<pid>/environ
```

## Inspect WAR Dependencies

```bash
jar tf app.war | grep '^WEB-INF/lib/' | sort
```

---

# 40. Summary

Deployment Java is not complete when artifact exists. It is complete only when runtime lookup space is correct.

The essential model:

```text
artifact layout + launcher command + runtime Java + classpath/module path + classloader graph + provider resources = actual application behavior
```

Most classpath/classloader incidents are caused by hidden drift between:

```text
compile-time dependency graph
packaged artifact contents
runtime classpath/module path
container/app-server shared libraries
Java version and module rules
```

The top-level lesson:

> Do not debug Java deployment as a file-copy problem. Debug it as a runtime resolution, linkage, and ownership problem.

---

# 41. What Comes Next

Part berikutnya:

```text
Part 12 — Application Server and Servlet Container Deployment
```

Kita akan masuk lebih detail ke deployment pada Tomcat, Jetty, Undertow, WildFly, Payara, Open Liberty, WebLogic, WebSphere/JBoss EAP: WAR/EAR lifecycle, shared libraries, datasource binding, JNDI, clustering, session, rolling restart, hot deploy risk, dan automation.

---

# 42. Status Series

Status:

```text
Part 11 selesai dari total 35 part.
Series belum selesai.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — `jlink`, `jdeps`, `jpackage`, and Custom Runtime Images](./learn-java-deployment-runtime-release-delivery-engineering-part-10-jlink-jdeps-jpackage-custom-runtime-images.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Deployment, Runtime, Release, and Delivery Engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-12-application-server-servlet-container-deployment.md)
