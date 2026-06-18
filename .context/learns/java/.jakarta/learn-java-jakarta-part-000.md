# learn-java-jakarta-part-000.md

# Bagian 0 — Jakarta Package: Big Picture, Sejarah, dan Mental Model

> Target pembaca: Java engineer yang sudah memahami Java SE/JVM/backend modern dan ingin masuk lebih dalam ke ekosistem `jakarta.*` / Jakarta EE secara serius.
>
> Target hasil: setelah bagian ini kamu tidak hanya tahu bahwa `javax.*` berubah menjadi `jakarta.*`, tetapi memahami **kenapa**, **apa konsekuensinya**, **bagaimana membaca spesifikasi**, **bagaimana API berbeda dari implementation**, **apa peran runtime/container**, **apa itu Platform/Web/Core Profile**, **apa itu TCK/compatible implementation**, dan **bagaimana berpikir spec-first untuk sistem enterprise Java modern**.

---

## Daftar Isi

1. [Orientasi: Apa yang Dimaksud “Jakarta Package”?](#1-orientasi-apa-yang-dimaksud-jakarta-package)
2. [Mental Model Paling Penting](#2-mental-model-paling-penting)
3. [Java SE vs Jakarta EE vs MicroProfile vs Spring](#3-java-se-vs-jakarta-ee-vs-microprofile-vs-spring)
4. [Sejarah Singkat: J2EE → Java EE → Jakarta EE](#4-sejarah-singkat-j2ee--java-ee--jakarta-ee)
5. [Kenapa `javax.*` Berubah Menjadi `jakarta.*`](#5-kenapa-javax-berubah-menjadi-jakarta)
6. [Jakarta EE 8, 9, 9.1, 10, 11, dan Arah 12](#6-jakarta-ee-8-9-91-10-11-dan-arah-12)
7. [Apa Itu Specification, API, Implementation, dan Runtime?](#7-apa-itu-specification-api-implementation-dan-runtime)
8. [TCK dan Compatible Implementation](#8-tck-dan-compatible-implementation)
9. [Platform, Web Profile, dan Core Profile](#9-platform-web-profile-dan-core-profile)
10. [Peta Besar Spesifikasi Jakarta EE](#10-peta-besar-spesifikasi-jakarta-ee)
11. [Cara Membaca Package `jakarta.*`](#11-cara-membaca-package-jakarta)
12. [Container-Managed Programming Model](#12-container-managed-programming-model)
13. [Dependency Mental Model: API Jar ≠ Runtime](#13-dependency-mental-model-api-jar--runtime)
14. [WAR, EAR, Thin Deployment, Fat JAR, dan Cloud-Native Packaging](#14-war-ear-thin-deployment-fat-jar-dan-cloud-native-packaging)
15. [Spec-First vs Framework-First Thinking](#15-spec-first-vs-framework-first-thinking)
16. [Portability vs Vendor Extension](#16-portability-vs-vendor-extension)
17. [Relationship dengan Spring, Quarkus, Micronaut, Open Liberty, WildFly, Payara, TomEE](#17-relationship-dengan-spring-quarkus-micronaut-open-liberty-wildfly-payara-tomee)
18. [Common Misconceptions](#18-common-misconceptions)
19. [Cara Belajar Jakarta EE yang Benar](#19-cara-belajar-jakarta-ee-yang-benar)
20. [Checklist Pemahaman Bagian 0](#20-checklist-pemahaman-bagian-0)
21. [Latihan Praktis](#21-latihan-praktis)
22. [Mini Project: Jakarta EE Ecosystem Map](#22-mini-project-jakarta-ee-ecosystem-map)
23. [Referensi Resmi](#23-referensi-resmi)

---

# 1. Orientasi: Apa yang Dimaksud “Jakarta Package”?

Dalam seri ini, “Jakarta Package” berarti seluruh ekosistem package dan specification yang berada di bawah namespace:

```java
jakarta.*
```

Contoh:

```java
jakarta.ws.rs.*
jakarta.persistence.*
jakarta.transaction.*
jakarta.validation.*
jakarta.enterprise.context.*
jakarta.inject.*
jakarta.servlet.*
jakarta.json.*
jakarta.json.bind.*
jakarta.security.enterprise.*
jakarta.jms.*
jakarta.batch.*
jakarta.mail.*
```

Namun jangan salah: `jakarta.*` bukan hanya kumpulan import. Ia adalah hasil dari sebuah platform enterprise Java yang distandardisasi.

Jika Java SE memberikan fondasi bahasa dan library standar:

```text
java.lang
java.util
java.time
java.nio
java.net
java.concurrent
java.security
```

maka Jakarta EE memberikan standar untuk banyak kebutuhan enterprise:

```text
HTTP request handling
REST API
dependency injection
persistence
transaction
validation
security
messaging
JSON/XML processing
batch
mail
websocket
container lifecycle
```

## 1.1 Kenapa ini penting untuk Java engineer?

Karena banyak framework modern Java berdiri di atas, mengimplementasikan, atau berinteraksi dengan Jakarta specifications.

Contoh:

- Spring Boot 3+ memakai banyak package `jakarta.*` seperti Servlet, Validation, Persistence.
- Hibernate ORM modern memakai `jakarta.persistence`.
- Bean Validation modern memakai `jakarta.validation`.
- Tomcat 10+ memakai `jakarta.servlet`.
- Jakarta RESTful Web Services memakai `jakarta.ws.rs`.
- Quarkus dan Open Liberty banyak menggunakan Jakarta APIs.
- Legacy Java EE apps memakai `javax.*` dan sering perlu migrasi ke `jakarta.*`.

Jika kamu tidak memahami boundary-nya, kamu akan sering mengalami error seperti:

```text
ClassNotFoundException: javax.servlet.Servlet
NoClassDefFoundError: jakarta/validation/Validator
NoSuchMethodError from mixed dependency versions
IllegalStateException: No CDI provider
DeploymentException: unsatisfied dependency
```

## 1.2 `jakarta.*` bukan replacement untuk seluruh `javax.*`

Ini penting sejak awal.

Tidak semua `javax.*` berubah menjadi `jakarta.*`.

Package Java SE seperti ini tetap valid:

```java
javax.crypto.*
javax.net.ssl.*
javax.sql.*
javax.management.*
javax.naming.*
```

Sedangkan package dari Java EE/Jakarta EE berubah ke `jakarta.*`, misalnya:

```java
javax.servlet.*      -> jakarta.servlet.*
javax.persistence.*  -> jakarta.persistence.*
javax.validation.*   -> jakarta.validation.*
javax.ws.rs.*        -> jakarta.ws.rs.*
javax.transaction.*  -> jakarta.transaction.*
javax.json.*         -> jakarta.json.*
javax.jms.*          -> jakarta.jms.*
```

Karena itu, migration rule yang salah adalah:

```text
replace semua "javax" menjadi "jakarta"
```

Rule yang benar:

```text
pahami apakah package tersebut milik Jakarta EE specification atau Java SE/yang lain.
```

## 1.3 Materi ini bukan tutorial “hello world”

Kita tidak akan belajar seperti:

```java
@Path("/hello")
public class HelloResource {
    @GET
    public String hello() { return "hello"; }
}
```

lalu selesai.

Kita akan membangun mental model:

```text
Apa yang terjadi saat container menemukan resource class?
Siapa yang membuat object?
Siapa yang meng-inject dependency?
Siapa yang membuka transaction?
Siapa yang memanggil validation?
Siapa yang mengubah exception menjadi response?
Siapa yang menyediakan implementation dari API jar?
Apa yang portable dan apa yang vendor-specific?
```

---

# 2. Mental Model Paling Penting

Ada beberapa mental model yang akan terus dipakai di seluruh seri Jakarta.

## 2.1 Jakarta EE adalah kumpulan specifications, bukan satu library

Jakarta EE bukan seperti satu dependency biasa:

```xml
<dependency>
  <groupId>some.vendor</groupId>
  <artifactId>some-framework</artifactId>
</dependency>
```

Jakarta EE adalah kumpulan standar/specification. Setiap specification menjelaskan contract:

- API apa yang tersedia;
- annotation apa yang bermakna;
- lifecycle apa yang harus terjadi;
- behavior apa yang wajib dipenuhi;
- integrasi apa yang diharapkan;
- compatibility requirement apa yang harus diuji.

Contoh:

```text
Jakarta Persistence specification
  defines EntityManager, entity lifecycle, JPQL, persistence context, etc.

Hibernate
  is one implementation/provider commonly used for Jakarta Persistence.
```

Jadi:

```text
Jakarta Persistence ≠ Hibernate
Jakarta REST ≠ Jersey
Jakarta Servlet ≠ Tomcat
Jakarta CDI ≠ Weld
```

Specification adalah contract. Implementation adalah real code yang menjalankan contract.

## 2.2 API jar bukan implementation

Dependency seperti:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
</dependency>
```

memberi kamu interface/annotation/class API untuk compile.

Tetapi itu tidak otomatis memberi implementation JPA.

Kalau kamu hanya punya API, kamu bisa compile:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.EntityManager;
```

Tetapi runtime tetap butuh provider seperti:

- Hibernate ORM;
- EclipseLink;
- OpenJPA-like provider if available/compatible;
- runtime/container yang menyediakan provider.

Mental model:

```text
API jar:
  "compiler tahu tipe dan annotation"

Implementation:
  "runtime benar-benar melakukan behavior"
```

## 2.3 Container memberi behavior

Banyak Jakarta feature hanya bekerja jika object dikelola container.

Contoh:

```java
@Inject
CaseRepository repository;
```

Injection tidak terjadi karena annotation itu sendiri magic. Injection terjadi karena CDI container:

1. menemukan bean;
2. membangun dependency graph;
3. membuat object;
4. mengisi dependency;
5. mengelola scope/lifecycle;
6. memberikan proxy jika perlu.

Jika kamu membuat object sendiri:

```java
var service = new CaseService();
```

maka container tidak otomatis meng-inject field-nya.

Annotation adalah metadata. Container adalah mesin yang membaca metadata dan menjalankan behavior.

## 2.4 Jakarta programming model adalah contract antara app dan runtime

Saat kamu menulis:

```java
@Transactional
public void approve() { ... }
```

kamu sebenarnya membuat kontrak:

```text
Jika method ini dipanggil sebagai managed component oleh runtime yang mendukung transaction interceptor,
maka runtime harus mengatur transaction boundary sesuai specification/implementation behavior.
```

Tanpa runtime:

```java
new MyService().approve();
```

tidak ada transaction otomatis.

## 2.5 Portable bukan berarti behavior vendor 100% identik dalam semua detail

Specification menentukan contract standar, tetapi implementation bisa berbeda dalam:

- configuration style;
- default tuning;
- performance;
- startup time;
- logging;
- extension features;
- packaging;
- clustering;
- metrics;
- cloud integration;
- admin tooling;
- vendor-specific optimizations.

Portability berarti aplikasi yang mengikuti standard API/spec contract bisa dipindahkan lebih mudah antar compatible implementation. Tetapi production-grade portability tetap butuh testing.

## 2.6 Jakarta EE bukan “old application server only”

Banyak orang masih mengasosiasikan Jakarta EE dengan masa lama:

```text
big application server
EAR deployment
XML descriptor
EJB everywhere
heavyweight
slow startup
legacy JSP
```

Sebagian itu sejarah. Namun Jakarta EE modern juga mendukung gaya:

```text
cloud-native
microservices
Core Profile
CDI
REST
JSON
Validation
JPA
small runtime
container deployment
Kubernetes
```

Salah satu tujuan Jakarta EE modern adalah tetap menjadi platform enterprise Java yang relevan untuk aplikasi cloud-native.

---

# 3. Java SE vs Jakarta EE vs MicroProfile vs Spring

## 3.1 Java SE

Java SE adalah fondasi bahasa dan library standar.

Contoh:

```java
java.lang.String
java.util.List
java.time.Instant
java.nio.file.Files
java.net.http.HttpClient
java.util.concurrent.ExecutorService
java.security.SecureRandom
```

Java SE adalah baseline yang disediakan oleh JDK/JRE.

## 3.2 Jakarta EE

Jakarta EE berada di atas Java SE dan menstandardisasi kebutuhan enterprise.

Contoh:

```java
jakarta.ws.rs.GET
jakarta.persistence.Entity
jakarta.transaction.Transactional
jakarta.validation.NotNull
jakarta.inject.Inject
jakarta.enterprise.context.ApplicationScoped
jakarta.servlet.Filter
jakarta.json.JsonObject
```

Jakarta EE membutuhkan Java SE tertentu sebagai baseline, tergantung versi Jakarta EE.

## 3.3 MicroProfile

MicroProfile adalah kumpulan specification untuk microservices/cloud-native enterprise Java, seperti:

- config;
- fault tolerance;
- health;
- metrics;
- JWT auth;
- OpenAPI;
- REST client;
- telemetry.

MicroProfile sering dibangun di atas subset Jakarta EE seperti CDI/JAX-RS/JSON-B, tetapi bukan sama dengan Jakarta EE Platform.

Mental model:

```text
Jakarta EE:
  standardized enterprise Java platform foundation

MicroProfile:
  additional microservice/cloud-native specifications,
  historically complementary to Jakarta EE
```

## 3.4 Spring

Spring adalah framework/ecosystem besar yang tidak sama dengan Jakarta EE, tetapi memakai banyak Jakarta APIs.

Contoh Spring Boot 3:

- uses `jakarta.servlet` for Servlet stack;
- uses `jakarta.persistence` through Spring Data JPA/Hibernate;
- uses `jakarta.validation` for Bean Validation;
- uses `jakarta.transaction` in transaction integration scenarios.

Spring punya programming model sendiri:

```text
Spring IoC container
Spring MVC
Spring Security
Spring Data
Spring Transaction
Spring Boot auto-configuration
```

Beberapa overlap dengan Jakarta EE:

| Concern | Jakarta EE | Spring |
|---|---|---|
| Dependency injection | CDI / `jakarta.inject` | Spring IoC |
| REST | Jakarta REST (`jakarta.ws.rs`) | Spring MVC/WebFlux |
| Persistence | Jakarta Persistence | Spring Data JPA + provider |
| Transaction | Jakarta Transactions | Spring Transaction |
| Validation | Jakarta Validation | Bean Validation integration |
| Security | Jakarta Security | Spring Security |
| Servlet | Jakarta Servlet | Spring MVC runs on Servlet stack |

## 3.5 Quarkus/Micronaut

Quarkus dan Micronaut memakai banyak konsep modern:

- build-time processing;
- fast startup;
- low memory;
- cloud-native;
- native image support;
- dependency injection;
- REST endpoints.

Quarkus punya integrasi kuat dengan Jakarta APIs seperti CDI, REST, Persistence, Transactions.

Micronaut punya model sendiri, tetapi bisa berinteraksi dengan Jakarta annotations tertentu.

## 3.6 Kenapa perlu paham Jakarta walau pakai Spring?

Karena Spring Boot modern tetap berada di ekosistem Java enterprise yang menyentuh `jakarta.*`.

Error migration Spring Boot 2 ke 3 sering bukan “Spring” murni, tetapi:

```text
javax.servlet → jakarta.servlet
javax.persistence → jakarta.persistence
javax.validation → jakarta.validation
old Tomcat 9 vs Tomcat 10 namespace
old Hibernate 5 vs Hibernate 6 Jakarta alignment
```

Jika kamu paham Jakarta namespace dan specification boundary, migration Spring juga lebih masuk akal.

---

# 4. Sejarah Singkat: J2EE → Java EE → Jakarta EE

## 4.1 J2EE era

Awalnya platform enterprise Java dikenal sebagai:

```text
J2EE — Java 2 Platform, Enterprise Edition
```

Era ini identik dengan:

- application server;
- EJB-heavy architecture;
- XML deployment descriptors;
- remote components;
- heavyweight programming model.

Banyak trauma lama Java enterprise berasal dari era ini.

## 4.2 Java EE era

Nama berubah menjadi:

```text
Java EE — Java Platform, Enterprise Edition
```

Java EE kemudian mengalami simplifikasi:

- annotation-based configuration;
- JPA;
- CDI;
- JAX-RS;
- Bean Validation;
- JSON-P;
- WebSocket;
- batch;
- modernized EJB usage.

Java EE 6/7/8 jauh lebih ringan dibanding J2EE lama.

## 4.3 Transfer ke Eclipse Foundation

Oracle kemudian menyerahkan Java EE ke Eclipse Foundation, dan ekosistem dilanjutkan sebagai:

```text
Jakarta EE
```

Jakarta EE berada di bawah Eclipse Foundation dan EE4J projects.

## 4.4 Jakarta EE 8: bridge release

Jakarta EE 8 pada dasarnya menjaga compatibility dengan Java EE 8 programming model dan masih memakai namespace:

```java
javax.*
```

Ini penting karena Jakarta EE 8 adalah jembatan awal.

## 4.5 Jakarta EE 9: namespace switch

Jakarta EE 9 adalah release besar yang mengganti namespace specification dari:

```java
javax.*
```

menjadi:

```java
jakarta.*
```

Fokus Jakarta EE 9 bukan menambah banyak fitur baru, tetapi memberi baseline namespace baru.

## 4.6 Jakarta EE 10 dan 11: modernization

Jakarta EE 10 memperkenalkan profile modern seperti Core Profile dan mendorong arah cloud-native.

Jakarta EE 11 melanjutkan modernisasi dengan baseline Java modern dan update specifications, termasuk dukungan Java Records, runtime-aware virtual thread support, dan Jakarta Data 1.0 pada Platform/Web Profile.

## 4.7 Jakarta EE 12

Jakarta EE 12 sudah tercatat sebagai under development di halaman spesifikasi resmi. Ini berarti ekosistem masih bergerak, dan engineer perlu membaca release plan/specification matrix, bukan mengandalkan pengetahuan lama.

---

# 5. Kenapa `javax.*` Berubah Menjadi `jakarta.*`

## 5.1 Bukan karena alasan teknis semata

Perubahan namespace bukan karena `javax` buruk secara teknis.

Perubahan terjadi karena setelah Java EE berpindah ke Eclipse Foundation, penggunaan namespace/trademark terkait Java memiliki batasan legal dan governance. Jakarta EE kemudian bergerak dengan namespace baru:

```java
jakarta.*
```

## 5.2 Dampak teknisnya sangat besar

Walaupun penyebabnya governance/legal, dampak teknisnya nyata:

```java
import javax.servlet.http.HttpServletRequest;
```

harus menjadi:

```java
import jakarta.servlet.http.HttpServletRequest;
```

Tetapi perubahan tidak berhenti di source import.

Dampak juga terjadi pada:

- Maven/Gradle dependencies;
- generated source;
- bytecode libraries;
- JSP/Facelets;
- XML descriptors;
- reflection config;
- annotation names;
- servlet container version;
- application server version;
- framework version;
- transitive dependencies;
- documentation;
- IDE tooling;
- test utilities;
- mocking libraries;
- APM agents.

## 5.3 Namespace switch adalah ecosystem migration

Satu aplikasi bisa sudah memakai `jakarta.*`, tetapi dependency transitive masih memakai `javax.*`.

Atau sebaliknya:

```text
App imports jakarta.servlet.*
but runtime Tomcat 9 provides javax.servlet.*
```

Maka terjadi error.

Contoh mismatch:

```text
Spring Boot 3 app expects jakarta.servlet.*
Deployed to Tomcat 9 which provides javax.servlet.*
Result: failure
```

Solusi:

```text
Spring Boot 3 → Tomcat 10+
Spring Boot 2 → Tomcat 9
```

Secara umum:

```text
javax world and jakarta world cannot be mixed casually for same specification.
```

## 5.4 Bytecode-level issue

Bahkan jika source terlihat benar, dependency jar bisa berisi constant pool reference ke:

```text
javax/servlet/...
```

Jika runtime hanya punya:

```text
jakarta/servlet/...
```

maka gagal.

Karena itu migration perlu tools:

- dependency tree;
- class file scanning;
- `jdeps`;
- Maven/Gradle dependency insight;
- OpenRewrite/transformer tools;
- integration tests.

## 5.5 Jangan blind replace

Blind replace:

```text
javax → jakarta
```

bisa merusak Java SE package:

```java
javax.crypto.Cipher
javax.net.ssl.SSLContext
javax.sql.DataSource
javax.management.MBeanServer
```

Package tersebut bukan Jakarta EE namespace migration.

Rule:

```text
Migrate only packages that belong to Jakarta EE specifications.
```

---

# 6. Jakarta EE 8, 9, 9.1, 10, 11, dan Arah 12

## 6.1 Jakarta EE 8

Karakter:

```text
javax.* namespace
Java EE 8 compatible programming model
bridge release under Eclipse Foundation
```

Cocok untuk:

- stabilisasi awal;
- transisi governance;
- aplikasi Java EE 8 yang ingin masuk Jakarta branding tanpa namespace switch.

## 6.2 Jakarta EE 9

Karakter:

```text
jakarta.* namespace introduced
big namespace migration
minimal feature evolution
```

Penting untuk:

- memulai ecosystem migration;
- membuat baseline baru untuk framework dan container.

## 6.3 Jakarta EE 9.1

Karakter:

```text
Jakarta EE 9 namespace
JDK 11 alignment/support
```

Penting sebagai bridge untuk runtime Java lebih baru.

## 6.4 Jakarta EE 10

Karakter:

- Core Profile diperkenalkan;
- alignment cloud-native/microservices lebih kuat;
- APIs modernized;
- banyak specs naik versi.

Core Profile membuat Jakarta EE bisa dipakai sebagai subset minimal untuk runtime kecil.

## 6.5 Jakarta EE 11

Jakarta EE 11 adalah release modern yang saat ini menjadi baseline utama untuk seri ini.

Beberapa highlight:

- Platform 11 mendefinisikan standard platform untuk hosting Jakarta EE applications.
- Platform/Web Profile 11 menyebut support Java Records, runtime-aware support for Virtual Threads, dan Jakarta Data 1.0.
- Web Profile 11 menargetkan web applications.
- Core Profile 11 menargetkan smaller runtimes.
- Web Profile 11 dan Core Profile 11 memiliki minimum Java SE 17 or higher.
- Platform 11 menghapus requirement untuk menggunakan SecurityManager dan menghapus optional specifications.

## 6.6 Jakarta EE 12

Jakarta EE 12 tercatat sebagai under development di halaman specifications Jakarta EE.

Makna praktis:

```text
Jangan menganggap Jakarta EE statis.
Baca spec matrix dan release note untuk setiap major upgrade.
```

---

# 7. Apa Itu Specification, API, Implementation, dan Runtime?

Ini bagian paling penting.

## 7.1 Specification

Specification adalah dokumen standar.

Ia mendeskripsikan:

- API surface;
- behavior;
- lifecycle;
- integration points;
- compatibility requirements;
- semantics;
- deployment expectations;
- optional/required features.

Contoh:

```text
Jakarta RESTful Web Services Specification
Jakarta Persistence Specification
Jakarta Contexts and Dependency Injection Specification
Jakarta Transactions Specification
```

Specification adalah “kontrak”.

## 7.2 API

API adalah artifact yang berisi tipe Java untuk compile.

Contoh:

```xml
<dependency>
  <groupId>jakarta.ws.rs</groupId>
  <artifactId>jakarta.ws.rs-api</artifactId>
</dependency>
```

Ia menyediakan:

```java
@Path
@GET
Response
Application
ExceptionMapper
ContainerRequestFilter
```

Tetapi tidak otomatis menyediakan runtime server.

## 7.3 Implementation

Implementation adalah library/runtime yang benar-benar menjalankan spec.

Contoh mapping:

| Specification | API package | Implementation examples |
|---|---|---|
| Jakarta Servlet | `jakarta.servlet` | Tomcat, Jetty, Undertow, GlassFish, Liberty |
| Jakarta REST | `jakarta.ws.rs` | Jersey, RESTEasy, CXF |
| Jakarta Persistence | `jakarta.persistence` | Hibernate ORM, EclipseLink |
| Jakarta CDI | `jakarta.enterprise` | Weld, OpenWebBeans, Arc-like CDI implementation |
| Jakarta Validation | `jakarta.validation` | Hibernate Validator |
| Jakarta JSON-B | `jakarta.json.bind` | Yasson |
| Jakarta JSON-P | `jakarta.json` | Parsson/Johnzon-like providers |
| Jakarta Mail | `jakarta.mail` | Angus Mail and others |

Implementation detail can vary as long as it satisfies spec.

## 7.4 Runtime/container

Runtime/container packages implementations and manages application lifecycle.

Examples:

- Eclipse GlassFish;
- Open Liberty;
- WildFly;
- Payara;
- Apache TomEE;
- application server / web container / microservice runtime.

Runtime may provide:

- Servlet container;
- CDI container;
- transaction manager;
- persistence provider integration;
- security integration;
- REST runtime;
- JSON providers;
- resource management;
- connection pooling;
- deployment scanner;
- classloader;
- lifecycle callbacks;
- management/metrics.

## 7.5 Mental model diagram

```text
Your application code
  imports jakarta.* API
      ↓
Jakarta specification defines semantics
      ↓
Runtime/container provides implementation
      ↓
TCK verifies compatibility
```

## 7.6 Compile-time vs runtime

Compile-time:

```text
Do I have the API classes to compile?
```

Runtime:

```text
Is there an implementation/container that provides the behavior?
```

Deployment-time:

```text
Is my artifact packaged in a way that the runtime expects?
```

Production-time:

```text
Is the runtime configured, observable, secure, and scalable?
```

---

# 8. TCK dan Compatible Implementation

## 8.1 Apa itu TCK?

TCK adalah Technology Compatibility Kit.

Tujuan:

```text
memastikan implementation memenuhi specification.
```

Jika vendor/runtime ingin mengklaim kompatibilitas Jakarta EE, mereka harus menjalankan dan memenuhi TCK yang relevan.

## 8.2 Compatible product bukan hanya “support package”

Sebuah runtime tidak cukup hanya berkata:

```text
kami punya jakarta.servlet classes
```

Untuk compatible product, ada proses compatibility/certification yang mencakup TCK results dan listing.

## 8.3 Kenapa TCK penting untuk engineer aplikasi?

Karena TCK memberi confidence bahwa aplikasi yang mengikuti spec punya peluang lebih besar berjalan portable pada compatible implementation.

Namun:

```text
TCK compatibility ≠ semua production behavior identik.
```

TCK menguji contract standar. Production tetap dipengaruhi:

- configuration;
- clustering;
- performance;
- datasource pooling;
- deployment model;
- security realm;
- admin tooling;
- vendor extensions;
- cloud integration.

## 8.4 What compatibility gives you

Compatibility membantu dalam:

- portability;
- vendor choice;
- long-term maintainability;
- enterprise procurement;
- confidence;
- standards-based development.

## 8.5 What compatibility does not give you

Compatibility tidak otomatis menjamin:

- same performance;
- same startup time;
- same memory footprint;
- same Kubernetes ergonomics;
- same metrics;
- same admin UI;
- same default connection pool behavior;
- same logging format;
- same exact bug behavior.

## 8.6 Engineer mindset

Use Jakarta spec for portable contract.

Use runtime-specific documentation for production behavior.

---

# 9. Platform, Web Profile, dan Core Profile

Jakarta EE tidak harus selalu “full platform”. Ada profile.

## 9.1 Platform

Jakarta EE Platform adalah umbrella specification yang mencakup sebagian besar individual specifications.

Cocok untuk:

- full enterprise applications;
- app server deployment;
- applications needing broad specs;
- legacy modernization;
- systems using many Jakarta capabilities.

## 9.2 Web Profile

Web Profile adalah subset Platform yang ditargetkan untuk web applications.

Cocok untuk:

- REST/web app;
- Servlet/JAX-RS/JPA/CDI/Validation style;
- tidak butuh seluruh full Platform;
- aplikasi server-side modern.

## 9.3 Core Profile

Core Profile adalah profile minimal yang ditargetkan untuk smaller runtimes dan microservices/cloud-native direction.

Cocok untuk:

- microservices;
- small runtime;
- AOT/native-image-oriented runtimes;
- CDI + REST + JSON minimal style;
- service yang tidak butuh full web/app server capabilities.

## 9.4 Choosing profile

Decision table:

| Situation | Likely choice |
|---|---|
| Simple REST microservice | Core Profile or Web Profile |
| REST + JPA + Validation + Transaction | Web Profile or vendor runtime bundle |
| Full enterprise app with messaging/batch/mail/EJB | Platform |
| Legacy EAR/EJB/JMS app | Platform |
| Cloud-native small service | Core Profile |
| Servlet-heavy web app | Web Profile |
| Modern Spring Boot service | Not necessarily Jakarta runtime, but uses Jakarta APIs |

## 9.5 Profile anti-pattern

Bad:

```text
Use full Platform because it contains everything.
```

Risk:

- larger runtime;
- bigger attack surface;
- slower startup;
- more config;
- more operational complexity.

Also bad:

```text
Use Core Profile for app that needs JPA/JTA/messaging/batch without considering missing specs.
```

Rule:

```text
Choose the smallest profile/runtime that satisfies requirements with clear operational support.
```

---

# 10. Peta Besar Spesifikasi Jakarta EE

Jakarta EE consists of many specifications. We'll cover them in later parts, but here is the mental map.

## 10.1 Core programming model

| Area | Package/spec |
|---|---|
| Dependency injection minimal | `jakarta.inject` |
| CDI | `jakarta.enterprise.*` |
| Common annotations | `jakarta.annotation` |
| Interceptors | `jakarta.interceptor` |

## 10.2 Web/API

| Area | Package/spec |
|---|---|
| Servlet | `jakarta.servlet` |
| REST | `jakarta.ws.rs` |
| WebSocket | `jakarta.websocket` |
| JSON Processing | `jakarta.json` |
| JSON Binding | `jakarta.json.bind` |
| Validation | `jakarta.validation` |

## 10.3 Persistence/data/transaction

| Area | Package/spec |
|---|---|
| Persistence/JPA | `jakarta.persistence` |
| Transactions/JTA | `jakarta.transaction` |
| Jakarta Data | repository abstraction |
| NoSQL (depending release/spec status) | data access standardization area |

## 10.4 Security

| Area | Package/spec |
|---|---|
| Security | `jakarta.security.enterprise` |
| Authentication | `jakarta.authentication` |
| Authorization | `jakarta.authorization` |
| Servlet security integration | `jakarta.servlet` security model |

## 10.5 Messaging/integration

| Area | Package/spec |
|---|---|
| Messaging/JMS | `jakarta.jms` |
| Connectors/JCA | `jakarta.resource` |
| Mail | `jakarta.mail` |
| Activation | `jakarta.activation` |
| Batch | `jakarta.batch` |

## 10.6 Legacy/server-side UI/XML

| Area | Package/spec |
|---|---|
| Jakarta Pages/JSP | server-side page technology |
| Expression Language | `jakarta.el` |
| Standard Tag Library | JSTL package area |
| Faces/JSF | `jakarta.faces` |
| XML Binding/JAXB | `jakarta.xml.bind` |
| XML Web Services/SOAP | `jakarta.xml.ws` |

## 10.7 Enterprise Beans

| Area | Package/spec |
|---|---|
| EJB | `jakarta.ejb` |

EJB is not the center of modern Jakarta development, but remains important for legacy and some enterprise workloads.

---

# 11. Cara Membaca Package `jakarta.*`

Package names usually reveal the specification area.

## 11.1 `jakarta.ws.rs`

`ws.rs` historically means RESTful web services.

Example:

```java
@Path("/cases")
public class CaseResource {
    @GET
    public List<CaseResponse> list() { ... }
}
```

Mental model:

```text
HTTP resource mapping + provider/filter/exception mapping
```

## 11.2 `jakarta.persistence`

Persistence/JPA.

Example:

```java
@Entity
public class CaseEntity {
    @Id
    private UUID id;
}
```

Mental model:

```text
object-relational mapping + persistence context + JPQL + transaction integration
```

## 11.3 `jakarta.enterprise`

CDI.

Example:

```java
@ApplicationScoped
public class CaseService {
    @Inject
    CaseRepository repository;
}
```

Mental model:

```text
container-managed beans + scopes + injection + qualifiers + events + interceptors
```

## 11.4 `jakarta.inject`

Minimal dependency injection annotation.

Example:

```java
@Inject
public CaseService(CaseRepository repository) { ... }
```

Mental model:

```text
standard annotation contract, implemented by DI container
```

## 11.5 `jakarta.transaction`

Transaction annotation/API.

Example:

```java
@Transactional
public void approve() { ... }
```

Mental model:

```text
transaction boundary managed by runtime/container/interceptor
```

## 11.6 `jakarta.validation`

Bean Validation.

Example:

```java
public record CreateCaseRequest(
    @NotBlank String title
) {}
```

Mental model:

```text
declarative input/object constraint validation
```

## 11.7 `jakarta.servlet`

Servlet API.

Example:

```java
public class AuditFilter implements Filter { ... }
```

Mental model:

```text
low-level HTTP request/response/container/filter/session model
```

## 11.8 `jakarta.json` and `jakarta.json.bind`

JSON-P and JSON-B.

```text
jakarta.json:
  low-level JSON object model and streaming

jakarta.json.bind:
  object binding between Java object and JSON
```

## 11.9 `jakarta.jms`

JMS messaging.

Mental model:

```text
standard queue/topic messaging API with sessions, producers, consumers, acknowledgments, transactions
```

---

# 12. Container-Managed Programming Model

The biggest conceptual difference between Jakarta and plain Java is container management.

## 12.1 Plain Java object

```java
public class CaseService {
    private final CaseRepository repository;

    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

You construct and manage it.

## 12.2 Managed bean

```java
@ApplicationScoped
public class CaseService {
    private final CaseRepository repository;

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

The container:

- discovers it;
- creates it;
- resolves dependencies;
- manages scope;
- may create proxy;
- invokes lifecycle callbacks;
- applies interceptors;
- destroys it.

## 12.3 Managed lifecycle

Example:

```java
@PostConstruct
void init() {
    // after injection
}

@PreDestroy
void destroy() {
    // before container destroys bean
}
```

These callbacks work only when container manages the instance.

## 12.4 Managed transaction

```java
@Transactional
public void closeCase(CloseCase command) { ... }
```

This is not a magical Java language feature. Runtime/interceptor must see the invocation and apply transaction behavior.

## 12.5 Managed resources

Jakarta runtimes can provide:

- datasource;
- transaction manager;
- JMS connection factory;
- executor;
- security context;
- persistence unit;
- mail session.

Usually via configuration/JNDI/injection.

## 12.6 Why not create threads manually?

In classic Jakarta EE, arbitrary unmanaged threads are discouraged because container manages lifecycle, security, classloader, transaction, naming, and shutdown.

Jakarta Concurrency provides managed executors/thread factories to propagate/handle context correctly.

In modern runtimes, behavior varies, but the principle remains:

```text
If the container owns lifecycle, use container-aware concurrency resources.
```

---

# 13. Dependency Mental Model: API Jar ≠ Runtime

## 13.1 API dependency example

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

This says:

```text
Compile against Jakarta EE Web API 11.
At runtime, the container provides implementation.
```

## 13.2 Why `provided` is common

If deploying to compatible server/runtime, you usually do not package the full API/implementation into the app artifact.

For WAR deployment:

```text
app.war contains your classes and dependencies
server provides Jakarta APIs/implementation
```

`provided` prevents duplicate API classes.

## 13.3 When `provided` is wrong

If you build an executable jar without external container and your runtime does not provide implementation, `provided` might fail.

Example:

```text
java -jar app.jar
```

and no REST/CDI/JPA implementation inside.

Then you need runtime dependencies or framework packaging that includes them.

## 13.4 API-only failure

Symptom:

```text
No provider found
No CDI container available
No PersistenceProvider found
No JsonbProvider found
```

Meaning:

```text
You compiled with API, but no implementation/runtime is available.
```

## 13.5 Duplicate API failure

If you package Jakarta API jars into a server that already provides them, you can get:

- classloader conflict;
- linkage errors;
- strange provider discovery behavior;
- version mismatch.

Production rule:

```text
Know who provides each Jakarta specification:
  your app artifact or the runtime/container.
```

## 13.6 Dependency alignment

Do not mix:

```text
jakarta.persistence-api 3.2
Hibernate version supporting different Jakarta Persistence level
old validation provider
old CDI implementation
old servlet container
```

Version alignment matters.

---

# 14. WAR, EAR, Thin Deployment, Fat JAR, dan Cloud-Native Packaging

## 14.1 WAR

WAR is web application archive.

Common contents:

```text
WEB-INF/classes
WEB-INF/lib
WEB-INF/web.xml optional
static resources
```

Used with Servlet/Jakarta web containers.

Good for:

- traditional app server deployment;
- external container management;
- multiple apps on one server;
- enterprise standardized runtime.

## 14.2 EAR

EAR is enterprise application archive.

Can contain:

- WAR modules;
- EJB modules;
- library jars;
- application.xml.

Historically used for full enterprise apps.

Modern usage is mostly legacy/enterprise app server environments.

## 14.3 Thin deployment

Thin artifact relies on runtime/container to provide many things.

Pros:

- smaller artifact;
- standard runtime;
- centralized ops;
- compatible server model.

Cons:

- runtime version coupling;
- harder local reproduction if not standardized;
- shared server classloader concerns;
- container configuration matters.

## 14.4 Fat JAR / executable JAR

App packages runtime libraries and starts standalone.

Common in:

- Spring Boot;
- Quarkus;
- Micronaut;
- some Jakarta runtimes.

Pros:

- self-contained;
- container-friendly;
- same artifact local/staging/prod;
- simple deployment.

Cons:

- larger artifact;
- responsibility to include correct implementation;
- version duplication across services;
- image rebuild for runtime patch.

## 14.5 Cloud-native packaging

Modern deployment often:

```text
application artifact
  → container image
  → Kubernetes deployment
```

Questions:

- who owns runtime?
- how is health exposed?
- how is config injected?
- how is datasource configured?
- how are secrets mounted?
- how is JFR captured?
- how does graceful shutdown work?
- how is memory sized?

## 14.6 No universal best

WAR is not automatically legacy-bad. Fat JAR is not automatically modern-good.

Choose based on:

- operations model;
- runtime control;
- portability;
- team skill;
- compatibility;
- cloud strategy;
- patching;
- observability;
- startup/memory.

---

# 15. Spec-First vs Framework-First Thinking

## 15.1 Framework-first thinking

Framework-first engineer asks:

```text
How does Spring/Quarkus/Liberty do this?
```

This is practical, but can lead to vendor-specific mental model only.

## 15.2 Spec-first thinking

Spec-first engineer asks:

```text
What is the standard contract?
Which specification defines this?
Which behavior is portable?
Which behavior is implementation-specific?
```

Example:

```java
@Path("/cases")
```

Spec-first view:

```text
This is Jakarta REST resource mapping.
The spec defines matching, injection points, providers, filters, exceptions, content negotiation.
The runtime implementation may be Jersey/RESTEasy/CXF/etc.
```

## 15.3 Why spec-first matters

Spec-first thinking helps with:

- migration;
- portability;
- debugging;
- vendor selection;
- avoiding accidental lock-in;
- writing library code;
- understanding Spring/Jakarta overlap;
- enterprise architecture.

## 15.4 Why framework-first also matters

Production apps run on concrete frameworks/runtimes.

You still need to know:

- vendor config;
- runtime defaults;
- performance behavior;
- bug workarounds;
- deployment model;
- monitoring integration.

## 15.5 Balanced mental model

Use both:

```text
Spec-first for contract and portability.
Runtime/framework-first for concrete production behavior.
```

---

# 16. Portability vs Vendor Extension

## 16.1 Portable code

Portable code uses standard APIs/spec behavior:

```java
@Inject
EntityManager em;

@Transactional
public void save(...) { ... }
```

If spec-compliant, it can be moved across compatible runtimes more easily.

## 16.2 Vendor extension

Vendor extension uses implementation-specific features:

```text
Hibernate-specific annotation
WildFly-specific deployment descriptor
Open Liberty feature config
Payara-specific admin command
Tomcat-specific Valve
```

Extensions can be valuable.

## 16.3 Extension decision matrix

| Question | If yes |
|---|---|
| Does it solve real production problem? | consider extension |
| Is there no standard equivalent? | extension may be justified |
| Is lock-in acceptable? | document it |
| Is migration cost known? | add ADR |
| Is behavior tested? | add integration test |
| Is fallback possible? | document fallback |

## 16.4 Good extension usage

Example:

```text
Use Hibernate-specific batch fetch tuning because JPA standard does not fully express desired fetch optimization.
```

Document:

- why;
- where;
- impact;
- migration risk;
- test evidence.

## 16.5 Bad extension usage

Bad:

```text
Use vendor-specific annotation everywhere because tutorial did it.
```

Consequence:

- hidden lock-in;
- migration pain;
- inconsistent behavior;
- team confusion.

## 16.6 ADR for extension

If extension touches architecture or persistence behavior, write ADR.

---

# 17. Relationship dengan Spring, Quarkus, Micronaut, Open Liberty, WildFly, Payara, TomEE

## 17.1 Spring

Spring is not a Jakarta EE runtime, but it uses Jakarta APIs in many areas.

Example:

```java
jakarta.persistence.Entity
jakarta.validation.Valid
jakarta.servlet.Filter
jakarta.transaction.Transactional
```

Spring provides its own container/programming model.

Important:

```text
Using jakarta.persistence in Spring does not mean you are running Jakarta EE Platform.
```

You are using a Jakarta specification API with Spring-managed integration.

## 17.2 Quarkus

Quarkus supports many Jakarta specifications and emphasizes build-time augmentation, low memory, fast startup, and native image.

It often uses CDI-style programming model and Jakarta REST/JPA/Transactions APIs.

Quarkus is useful to study because it shows Jakarta APIs in cloud-native runtime style.

## 17.3 Micronaut

Micronaut has its own compile-time DI/AOP model, but can interoperate with Jakarta annotations/spec APIs in certain areas.

It is not simply “Jakarta EE”, but participates in Java enterprise ecosystem.

## 17.4 Open Liberty

Open Liberty is a modular runtime with feature-based configuration and strong Jakarta/MicroProfile support. It is often used for cloud-native Jakarta EE apps.

## 17.5 WildFly

WildFly is a Jakarta EE application server/runtime with strong enterprise capabilities and RESTEasy/Weld/Hibernate integration.

## 17.6 Payara/GlassFish

GlassFish is reference/compatible implementation historically important in Jakarta EE. Payara builds enterprise runtime around GlassFish lineage.

## 17.7 TomEE

TomEE integrates Tomcat with Jakarta EE capabilities.

## 17.8 Tomcat/Jetty

Tomcat and Jetty are Servlet containers/web servers, not full Jakarta EE Platform implementations by themselves. They provide web container capabilities like Servlet/JSP/WebSocket depending version, but not full CDI/JPA/JTA/JMS platform unless integrated with additional libraries/runtime.

## 17.9 Decision thinking

When choosing stack:

```text
Need Spring ecosystem and Boot auto-config?
  Spring Boot

Need standards-based Jakarta EE runtime?
  Open Liberty/WildFly/Payara/TomEE/GlassFish

Need fast startup/build-time augmentation with Jakarta APIs?
  Quarkus

Need minimal compile-time DI framework?
  Micronaut

Need only Servlet container?
  Tomcat/Jetty
```

No universal winner. Context matters.

---

# 18. Common Misconceptions

## 18.1 “Jakarta is just a rename”

Wrong.

The namespace rename is visible, but ecosystem consequences include:

- dependency graph migration;
- runtime/container compatibility;
- framework major versions;
- tooling support;
- classloader conflicts;
- bytecode references;
- documentation updates;
- test migration.

## 18.2 “If it compiles, it runs”

Wrong.

You can compile with API jar but lack implementation.

```text
compile success
runtime provider missing
```

## 18.3 “`jakarta.*` means Jakarta EE runtime”

Not necessarily.

A Spring Boot app can use `jakarta.validation` and `jakarta.persistence` without being a Jakarta EE Platform app.

## 18.4 “All `javax.*` should become `jakarta.*`”

Wrong.

Java SE `javax.*` packages remain.

## 18.5 “Application server means old and heavy”

Not always.

Modern runtimes can be modular, container-friendly, and cloud-native. But runtime choice must be evaluated.

## 18.6 “Spec means no vendor lock-in”

Specification reduces lock-in, but does not eliminate:

- operational config;
- tuning;
- extensions;
- deployment model;
- monitoring integration;
- vendor bugs.

## 18.7 “CDI injection works on any object”

Wrong.

Injection works for container-managed beans, not arbitrary objects you construct manually.

## 18.8 “`@Transactional` always starts transaction”

Wrong.

It depends on container/interceptor/proxy invocation and context. Direct self-invocation or unmanaged object may bypass it.

## 18.9 “JPA entity is always domain model”

Not always.

JPA entity can be persistence model, domain entity, or hybrid. Choose consciously.

---

# 19. Cara Belajar Jakarta EE yang Benar

## 19.1 Learn by concern, not by annotation list

Bad learning path:

```text
memorize annotations
```

Good learning path:

```text
for each concern:
  what problem does it solve?
  what specification owns it?
  what API types exist?
  what runtime behavior is required?
  what failure modes happen?
  how to test it?
  how to operate it?
```

## 19.2 Read specs selectively

You don't need to read every specification end-to-end at first. But for top-tier understanding, read:

- overview;
- lifecycle;
- semantics;
- integration sections;
- error behavior;
- portability notes.

## 19.3 Build small experiments

For each spec:

- write minimal code;
- break it intentionally;
- observe error;
- run on different runtime if possible;
- inspect dependency tree;
- write integration test.

## 19.4 Compare with Spring

Since many Java engineers know Spring, compare each Jakarta concept:

| Jakarta concept | Spring comparison |
|---|---|
| CDI bean | Spring bean |
| CDI qualifier | Spring qualifier |
| CDI interceptor | Spring AOP/interceptor |
| Jakarta REST | Spring MVC controller |
| Jakarta Persistence | Spring Data JPA uses same JPA spec |
| Jakarta Transaction | Spring transaction integration |
| Jakarta Validation | Spring validation integration |
| Servlet filter | Spring filter/security filter chain |

Comparison helps, but don't collapse them as identical.

## 19.5 Learn migration early

Jakarta is inseparable from migration.

Even if you build greenfield, you will encounter libraries, tutorials, and legacy systems in `javax.*`.

Learn to diagnose:

```text
Which side is javax?
Which side is jakarta?
Who provides API?
Who provides implementation?
Which runtime version?
Which framework version?
Which transitive dependency?
```

## 19.6 Learn operational behavior

Every spec has production consequences:

- REST: error mapping, filters, content negotiation.
- CDI: scope/proxy/lifecycle.
- JPA: transaction, lazy loading, N+1, locking.
- JMS: ack, redelivery, transaction, DLQ.
- Batch: restartability, checkpoint.
- Servlet: thread model, filters, async.
- Validation: error contract.
- Security: identity/authorization/audit.
- JSON/XML: contract/security/performance.

Top-tier engineer studies behavior under failure, not only happy path.

---

# 20. Checklist Pemahaman Bagian 0

Kamu memahami Bagian 0 jika bisa menjawab:

## 20.1 Conceptual

- [ ] Apa perbedaan Java SE dan Jakarta EE?
- [ ] Apa perbedaan specification, API, implementation, runtime?
- [ ] Kenapa API jar saja tidak cukup?
- [ ] Apa itu TCK?
- [ ] Apa arti compatible implementation?
- [ ] Apa perbedaan Platform, Web Profile, Core Profile?
- [ ] Kenapa `javax.*` berubah ke `jakarta.*`?
- [ ] Kenapa tidak boleh blind replace semua `javax`?

## 20.2 Practical

- [ ] Bisa membaca dependency Jakarta dan tahu mana API, mana implementation.
- [ ] Bisa menjelaskan kenapa Spring Boot 3 butuh `jakarta.*`.
- [ ] Bisa menjelaskan kenapa Tomcat 9 vs Tomcat 10 penting.
- [ ] Bisa membuat migration risk list dari `javax → jakarta`.
- [ ] Bisa menjelaskan kapan memilih Core/Web/Platform.
- [ ] Bisa membedakan portable spec usage dan vendor extension.

## 20.3 Production

- [ ] Bisa menjelaskan apa yang container manage.
- [ ] Bisa menjelaskan kenapa lifecycle annotation butuh managed bean.
- [ ] Bisa menjelaskan kenapa manual thread creation bisa berbahaya di managed runtime.
- [ ] Bisa menjelaskan risiko duplicate API jars.
- [ ] Bisa menjelaskan kenapa compatible implementation tidak menjamin performance identik.

---

# 21. Latihan Praktis

## Latihan 1 — Identifikasi package

Klasifikasikan package berikut:

```java
javax.crypto.Cipher
javax.sql.DataSource
javax.servlet.Filter
javax.persistence.Entity
jakarta.persistence.Entity
jakarta.ws.rs.Path
javax.net.ssl.SSLContext
jakarta.validation.NotNull
javax.management.MBeanServer
jakarta.enterprise.context.ApplicationScoped
```

Tentukan:

- Java SE atau Jakarta EE?
- Perlu migrasi ke `jakarta.*` atau tidak?
- Specification apa?

## Latihan 2 — API vs implementation

Buat Maven project kecil hanya dengan:

```xml
<dependency>
  <groupId>jakarta.json.bind</groupId>
  <artifactId>jakarta.json.bind-api</artifactId>
  <version>3.x/4.x sesuai target</version>
</dependency>
```

Coba buat `JsonbBuilder.create()`.

Amati apakah provider ditemukan.

Lalu tambahkan implementation JSON-B seperti Yasson/appropriate provider. Bandingkan.

Tujuan:

```text
merasakan langsung bahwa API jar ≠ implementation.
```

## Latihan 3 — Servlet namespace mismatch

Buat minimal Servlet app.

Coba:

- compile dengan `jakarta.servlet-api`;
- deploy ke Tomcat 9;
- deploy ke Tomcat 10+.

Amati error.

Tujuan:

```text
memahami bahwa runtime harus sejalan dengan namespace.
```

## Latihan 4 — Dependency tree inspection

Ambil project Spring Boot 2 dan Spring Boot 3.

Jalankan:

```bash
mvn dependency:tree
```

atau:

```bash
./gradlew dependencies
```

Cari:

```text
javax.servlet
jakarta.servlet
javax.persistence
jakarta.persistence
javax.validation
jakarta.validation
```

Buat laporan: dependency mana yang berubah.

## Latihan 5 — Runtime responsibility map

Untuk aplikasi Jakarta REST + CDI + JPA:

Buat tabel:

| Concern | API | Implementation/provider | Runtime/container |
|---|---|---|---|
| REST endpoint |  |  |  |
| Dependency injection |  |  |  |
| Persistence |  |  |  |
| Transaction |  |  |  |
| Validation |  |  |  |
| JSON |  |  |  |

Tujuan:

```text
membiasakan berpikir siapa menyediakan apa.
```

## Latihan 6 — Profile selection

Untuk 5 aplikasi berikut, pilih Core/Web/Platform atau non-Jakarta runtime:

1. REST-only service with JSON and CDI.
2. REST + JPA + transaction + validation service.
3. Legacy app with EJB + JMS + JSP.
4. Worker that consumes JMS and writes DB.
5. Spring Boot 3 service using Spring MVC and JPA.

Jelaskan reasoning.

---

# 22. Mini Project: Jakarta EE Ecosystem Map

## 22.1 Goal

Buat repository dokumentasi kecil:

```text
jakarta-ecosystem-map/
  README.md
  specs/
  runtimes/
  migration/
  examples/
```

## 22.2 Deliverables

### `README.md`

Berisi:

- apa itu Jakarta EE;
- Java SE vs Jakarta EE;
- `javax → jakarta`;
- spec/API/implementation/runtime mental model.

### `specs/spec-map.md`

Tabel:

| Specification | Package | Concern | Common implementation | Typical runtime |
|---|---|---|---|---|

Minimal isi:

- Annotation;
- Inject;
- CDI;
- Interceptors;
- REST;
- Servlet;
- JSON-P;
- JSON-B;
- Persistence;
- Transactions;
- Validation;
- Security;
- Messaging;
- Batch;
- Mail;
- XML Binding.

### `runtimes/runtime-map.md`

Tabel:

| Runtime | Category | Jakarta profile support | Notes |
|---|---|---|---|

Isi dengan kategori:

- full Jakarta runtime;
- web container;
- microservice runtime;
- Spring runtime;
- Quarkus-like runtime.

### `migration/javax-to-jakarta-risk.md`

Berisi:

- package migration table;
- do-not-replace list;
- dependency risk;
- runtime mismatch examples;
- testing checklist.

### `examples/api-vs-impl/`

Buat contoh API-only failure dan fix with implementation.

## 22.3 Acceptance criteria

Kamu dianggap lulus mini project ini jika bisa:

- menjelaskan setiap dependency;
- menjelaskan siapa provider runtime-nya;
- menunjukkan error saat implementation tidak ada;
- menunjukkan error saat namespace mismatch;
- memilih profile untuk use case berbeda;
- membuat migration checklist sederhana.

---

# 23. Referensi Resmi

Referensi yang digunakan dan perlu dibaca bertahap:

1. Jakarta EE Specifications  
   https://jakarta.ee/specifications/

2. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

3. Jakarta EE Web Profile 11  
   https://jakarta.ee/specifications/webprofile/11/

4. Jakarta EE Core Profile 11  
   https://jakarta.ee/specifications/coreprofile/11/

5. Jakarta EE 11 Release Page  
   https://jakarta.ee/release/11/

6. Javax to Jakarta Namespace Ecosystem Progress  
   https://jakarta.ee/blogs/javax-jakartaee-namespace-ecosystem-progress/

7. Jakarta EE Compatible Products — Get Listed / TCK process  
   https://jakarta.ee/compatibility/get-listed/

8. Jakarta EE Platform Guide  
   https://jakarta.ee/learn/specification-guides/jakarta-ee-platform/

9. Eclipse Foundation / Jakarta EE Working Group  
   https://jakarta.ee/about/working-group/

10. Jakarta EE Specification Process  
    https://jakarta.ee/about/jesp/

11. Open Liberty Jakarta EE Documentation  
    https://openliberty.io/docs/latest/jakarta-ee.html

12. Jakarta EE API artifacts on Maven Central  
    https://central.sonatype.com/

---

# Penutup

Bagian 0 ini sengaja tidak langsung masuk ke coding REST/JPA/CDI. Alasannya: banyak engineer bisa menulis annotation Jakarta, tetapi tidak memahami boundary-nya.

Kalau kamu memahami bagian ini, kamu akan punya mental model yang sangat kuat:

```text
jakarta.* package
  bukan sekadar import
  melainkan API surface dari specification

specification
  mendefinisikan contract

API jar
  membuat code bisa compile

implementation
  menjalankan behavior

runtime/container
  mengelola lifecycle, injection, transaction, request, resource

TCK
  memverifikasi compatibility

profile
  menentukan subset platform yang dipakai

migration
  butuh ecosystem alignment, bukan blind rename
```

Dengan mental model ini, bagian berikutnya—namespace migration dari `javax.*` ke `jakarta.*`—akan jauh lebih mudah, karena kamu sudah tahu bahwa perubahan package adalah perubahan ecosystem boundary, bukan sekadar refactor import.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 30 — Capstone: Build and Review an Enterprise Case Management UI](./jsp/30-capstone-enterprise-case-management-ui.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-001.md](./learn-java-jakarta-part-001.md)

</div>