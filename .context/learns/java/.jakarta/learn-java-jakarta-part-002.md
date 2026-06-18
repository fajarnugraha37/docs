# learn-java-jakarta-part-002.md

# Bagian 2 — Jakarta EE Platform, Web Profile, dan Core Profile

> Target pembaca: Java engineer yang ingin memahami Jakarta EE bukan sebagai “sekumpulan import `jakarta.*`”, tetapi sebagai **standardized enterprise platform** dengan ukuran/kapabilitas yang bisa dipilih sesuai kebutuhan aplikasi.
>
> Fokus bagian ini: memahami perbedaan **Jakarta EE Platform**, **Jakarta EE Web Profile**, dan **Jakarta EE Core Profile**; kapan memilih masing-masing; apa implikasi teknis, operasional, dependency, runtime, deployment, cloud-native, dan migration-nya.

---

## Daftar Isi

1. [Orientasi: Kenapa Jakarta EE Punya Profile?](#1-orientasi-kenapa-jakarta-ee-punya-profile)
2. [Mental Model: Platform vs Profile vs Individual Specification](#2-mental-model-platform-vs-profile-vs-individual-specification)
3. [Jakarta EE Platform](#3-jakarta-ee-platform)
4. [Jakarta EE Web Profile](#4-jakarta-ee-web-profile)
5. [Jakarta EE Core Profile](#5-jakarta-ee-core-profile)
6. [Core ⊂ Web ⊂ Platform: Cara Membaca Relasinya](#6-core--web--platform-cara-membaca-relasinya)
7. [Apa yang Masuk dan Tidak Masuk ke Setiap Profile](#7-apa-yang-masuk-dan-tidak-masuk-ke-setiap-profile)
8. [Jakarta EE 11 sebagai Baseline Modern](#8-jakarta-ee-11-sebagai-baseline-modern)
9. [Jakarta EE 12: Arah Berikutnya](#9-jakarta-ee-12-arah-berikutnya)
10. [Profile dan Runtime](#10-profile-dan-runtime)
11. [Profile dan Dependency Management](#11-profile-dan-dependency-management)
12. [Profile dan Packaging](#12-profile-dan-packaging)
13. [Profile dan Cloud-Native Architecture](#13-profile-dan-cloud-native-architecture)
14. [Profile dan Microservices](#14-profile-dan-microservices)
15. [Profile dan Monolith/Modulith](#15-profile-dan-monolithmodulith)
16. [Profile dan Legacy Enterprise Application](#16-profile-dan-legacy-enterprise-application)
17. [Decision Framework: Memilih Profile](#17-decision-framework-memilih-profile)
18. [Case Study 1: REST API Sederhana](#18-case-study-1-rest-api-sederhana)
19. [Case Study 2: CRUD Web App dengan JPA dan Validation](#19-case-study-2-crud-web-app-dengan-jpa-dan-validation)
20. [Case Study 3: Enterprise Monolith dengan Messaging, Batch, dan Mail](#20-case-study-3-enterprise-monolith-dengan-messaging-batch-dan-mail)
21. [Case Study 4: Cloud-Native Microservice dengan CDI + REST + JSON](#21-case-study-4-cloud-native-microservice-dengan-cdi--rest--json)
22. [Case Study 5: Legacy Java EE Full Platform Migration](#22-case-study-5-legacy-java-ee-full-platform-migration)
23. [Production Risks Saat Salah Memilih Profile](#23-production-risks-saat-salah-memilih-profile)
24. [Checklist Review Profile Selection](#24-checklist-review-profile-selection)
25. [Latihan Bertahap](#25-latihan-bertahap)
26. [Mini Project: Jakarta Profile Decision Matrix](#26-mini-project-jakarta-profile-decision-matrix)
27. [Referensi Resmi](#27-referensi-resmi)

---

# 1. Orientasi: Kenapa Jakarta EE Punya Profile?

Jakarta EE adalah platform enterprise yang besar. Ia mencakup banyak kebutuhan:

- web request/response;
- REST API;
- JSON;
- dependency injection;
- validation;
- persistence;
- transaction;
- security;
- servlet;
- websocket;
- messaging;
- batch;
- mail;
- XML;
- SOAP;
- connector;
- enterprise beans;
- concurrency;
- pages/faces;
- dan banyak lagi.

Kalau semua aplikasi harus membawa semua spesifikasi tersebut, maka Jakarta EE akan terasa terlalu besar untuk banyak use case modern.

Contoh aplikasi modern:

```text
Service A:
  REST API + JSON + CDI + Validation
  no JPA
  no JMS
  no Batch
  no Mail
  no EJB
  no JSF
```

Membawa seluruh Jakarta EE Platform untuk service seperti ini mungkin berlebihan.

Contoh lain:

```text
Service B:
  REST API + JPA + Transaction + Validation
  traditional web application
```

Mungkin cukup dengan Web Profile.

Contoh lain:

```text
System C:
  REST + JPA + JMS + Batch + Mail + Connector + Security + EJB legacy
```

Butuh Full Platform.

Karena itu Jakarta EE memiliki **Profile**.

Profile adalah subset resmi dari Platform yang ditujukan untuk kategori aplikasi tertentu.

Intinya:

```text
Platform = paket kapabilitas enterprise paling lengkap
Web Profile = subset untuk web application umum
Core Profile = subset kecil untuk smaller runtime, microservice, dan cloud-native minimal
```

## 1.1 Masalah yang diselesaikan oleh Profile

Profile membantu menjawab:

1. API apa yang dijamin tersedia?
2. Runtime jenis apa yang dibutuhkan?
3. Seberapa besar dependency surface aplikasi?
4. Apakah aplikasi bisa dijalankan di runtime kecil?
5. Apakah aplikasi portable antar compatible runtime?
6. Apakah aplikasi terlalu bergantung pada fitur platform yang tidak diperlukan?
7. Apakah deployment unit bisa dibuat ringan?
8. Apakah cloud-native startup/memory lebih mudah dikontrol?
9. Apakah modern microservice harus membawa seluruh enterprise stack?
10. Apakah legacy system butuh full platform?

## 1.2 Profile bukan sekadar dependency convenience

Pemula sering menganggap profile hanya pilihan Maven dependency:

```xml
jakarta.jakartaee-api
jakarta.jakartaee-web-api
jakarta.jakartaee-core-api
```

Itu hanya permukaan.

Profile sebenarnya adalah **kontrak runtime**:

```text
Jika aplikasi menargetkan Web Profile,
maka runtime Web Profile-compatible harus menyediakan seluruh API dan behavior yang diwajibkan Web Profile.
```

Artinya profile memengaruhi:

- compile-time API;
- runtime capability;
- TCK compliance;
- portability;
- deployment architecture;
- operational footprint;
- migration strategy;
- vendor/runtime selection.

---

# 2. Mental Model: Platform vs Profile vs Individual Specification

Untuk memahami Jakarta EE, pegang 3 level:

```text
Individual Specification
  ↓
Profile Specification
  ↓
Platform Specification
```

## 2.1 Individual Specification

Individual specification adalah spesifikasi spesifik untuk satu area.

Contoh:

- Jakarta RESTful Web Services;
- Jakarta Contexts and Dependency Injection;
- Jakarta Persistence;
- Jakarta Transactions;
- Jakarta Validation;
- Jakarta Servlet;
- Jakarta JSON Binding;
- Jakarta JSON Processing;
- Jakarta Messaging;
- Jakarta Batch;
- Jakarta Mail;
- Jakarta Security.

Setiap specification biasanya punya:

- specification document;
- API jar;
- TCK;
- compatible implementation;
- version.

Contoh mental model:

```text
Jakarta RESTful Web Services
  spec: behavior standard
  API: annotations/interfaces/classes
  implementation: REST runtime/provider
  TCK: test compatibility
```

## 2.2 Profile Specification

Profile specification mengelompokkan beberapa individual specs menjadi subset resmi.

Contoh:

```text
Core Profile
  includes minimal foundational specs

Web Profile
  includes Core + web application specs

Platform
  includes Web/Core + additional enterprise specs
```

Profile membuat aplikasi bisa menargetkan subset tanpa mengharuskan seluruh Platform.

## 2.3 Platform Specification

Platform specification adalah payung besar.

Platform menentukan:

- daftar spesifikasi yang masuk;
- requirements integrasi antar spesifikasi;
- application component model;
- deployment model;
- security/transaction/resource behavior;
- compatibility requirements.

Dalam Jakarta EE 11, Platform didefinisikan sebagai standard platform untuk hosting Jakarta EE applications. Platform adalah target paling lengkap.

## 2.4 Analogi

Bayangkan Jakarta EE seperti sistem operasi enterprise untuk Java server-side.

```text
Individual spec = fitur/layanan OS
Profile = edisi OS
Platform = edisi lengkap
```

Contoh:

```text
Core Profile:
  minimal runtime untuk service kecil

Web Profile:
  web app runtime

Platform:
  full enterprise runtime
```

## 2.5 Kenapa tidak semua individual spec berdiri sendiri?

Beberapa spec bisa dipakai standalone di luar full Jakarta EE, tetapi kekuatan Jakarta EE muncul dari integrasi container:

- CDI injection ke JAX-RS resource;
- Validation pada REST input;
- JPA dengan transaction;
- Security context di web layer;
- Managed executor dengan context propagation;
- lifecycle callback;
- resource injection;
- JTA transaction enlistment;
- JSON binding di REST.

Profile membantu menentukan integrasi apa yang dijamin oleh runtime.

---

# 3. Jakarta EE Platform

Jakarta EE Platform adalah paket paling lengkap dari Jakarta EE.

Jika kamu butuh breadth enterprise capability, Platform adalah targetnya.

## 3.1 Platform cocok untuk apa?

Platform cocok untuk aplikasi yang memakai banyak capability enterprise sekaligus:

- web;
- REST;
- persistence;
- transaction;
- security;
- messaging;
- batch;
- mail;
- enterprise beans;
- connector;
- XML/SOAP;
- concurrency;
- websocket;
- legacy UI;
- integration dengan enterprise system.

Contoh:

```text
Regulatory Case Management Monolith
  REST API
  Admin UI
  JPA
  Transactions
  Messaging
  Batch archival
  Email notifications
  Security
  Audit
  SOAP/XML integration
  Scheduled timers
  Legacy EJB modules
```

Aplikasi seperti ini lebih dekat ke Platform daripada Core/Web.

## 3.2 Platform memberikan runtime contract luas

Jika runtime compatible dengan Platform, kamu dapat berharap banyak spesifikasi tersedia.

Namun konsekuensinya:

- runtime footprint lebih besar;
- surface area lebih luas;
- startup bisa lebih berat;
- configuration lebih banyak;
- operational complexity lebih tinggi;
- migration dependency lebih luas;
- security attack surface perlu diperhatikan.

## 3.3 Platform bukan selalu buruk

Banyak engineer modern otomatis berpikir:

```text
Full Platform = legacy = buruk
```

Itu terlalu simplistik.

Full Platform masuk akal jika:

- aplikasi memang butuh banyak enterprise services;
- team punya expertise;
- runtime mendukung cloud deployment;
- governance butuh standardization;
- legacy modernization dilakukan bertahap;
- portability antar vendor penting;
- integration enterprise kompleks.

Yang buruk bukan Full Platform. Yang buruk adalah memakai Full Platform tanpa alasan.

## 3.4 Platform dan vendor runtime

Compatible runtime Platform menyediakan implementasi lengkap.

Contoh kategori runtime:

- application server full Jakarta EE;
- cloud-native application server;
- modular runtime yang bisa mengaktifkan fitur;
- vendor runtime dengan Platform compatibility.

Penting:

```text
API jar bukan runtime.
```

Jika kamu hanya menambahkan:

```xml
jakarta.jakartaee-api
```

itu tidak membuat aplikasi punya JPA provider, transaction manager, servlet container, JMS provider, dan seterusnya. Runtime/container yang menyediakan implementation.

## 3.5 Platform dan application portability

Salah satu value Jakarta EE adalah portability.

Aplikasi yang hanya bergantung pada standard API dan behavior bisa lebih mudah dipindah antar compatible runtime.

Namun portability menurun jika kamu memakai:

- vendor extension;
- runtime-specific config;
- proprietary annotation;
- non-standard deployment descriptor;
- proprietary transaction/JMS/resource feature;
- implementation-specific class.

Gunakan vendor extension hanya jika trade-off jelas.

---

# 4. Jakarta EE Web Profile

Web Profile adalah subset Jakarta EE yang ditargetkan untuk web applications.

## 4.1 Kenapa Web Profile ada?

Banyak aplikasi enterprise web tidak butuh seluruh Platform.

Mereka butuh:

- Servlet;
- REST;
- CDI;
- Validation;
- Persistence;
- Transaction;
- JSON;
- Security;
- Pages/Faces mungkin;
- Expression Language.

Tapi tidak selalu butuh:

- full EJB model;
- JMS;
- Batch;
- Mail;
- Connector;
- SOAP/XML WS;
- full enterprise integration services.

Web Profile memberikan subset yang cukup untuk banyak aplikasi web.

## 4.2 Web Profile cocok untuk apa?

Cocok untuk:

- REST API dengan persistence;
- server-side web app;
- CRUD admin app;
- modular web application;
- application with JPA/JTA/Validation/CDI;
- traditional enterprise web app modernized;
- service yang butuh Jakarta Persistence dan Jakarta Transactions tapi tidak butuh messaging/batch/mail.

Contoh:

```text
Licensing Application Service
  Jakarta REST
  CDI
  JPA
  Transaction
  Validation
  JSON-B
  Security
```

Web Profile sering menjadi default paling realistis untuk banyak aplikasi Jakarta EE.

## 4.3 Web Profile sebagai sweet spot

Web Profile sering berada di tengah:

```text
Core terlalu kecil untuk JPA-heavy web app
Platform terlalu besar untuk REST/JPA app
Web Profile pas
```

## 4.4 Web Profile dan Jakarta EE 11

Jakarta EE Web Profile 11 menargetkan web applications dan mencantumkan tambahan seperti:

- support untuk Java Records;
- JDK runtime-aware support untuk Virtual Threads;
- Jakarta Data 1.0.

Minimum Java SE untuk Web Profile 11 adalah Java SE 17 atau lebih tinggi.

## 4.5 Web Profile risk

Web Profile bisa menjadi masalah jika kamu diam-diam butuh fitur luar Web Profile.

Contoh:

```java
jakarta.jms.*
```

Jika target runtime hanya Web Profile dan tidak menyediakan JMS, aplikasi tidak portable.

Atau:

```java
jakarta.batch.*
```

Jika batch tidak masuk runtime Web Profile, kamu perlu full Platform atau dependency/runtime tambahan.

## 4.6 Web Profile vs Spring Boot

Spring Boot tidak sama dengan Jakarta Web Profile.

Namun secara fungsi, banyak aplikasi Spring Boot web setara dengan subset:

- web;
- dependency injection;
- validation;
- persistence;
- transaction;
- JSON;
- security.

Bedanya:

```text
Spring Boot = framework ecosystem
Jakarta Web Profile = standard profile contract
```

Spring bisa memakai beberapa Jakarta APIs, tetapi runtime modelnya berbeda.

---

# 5. Jakarta EE Core Profile

Core Profile adalah profile kecil yang ditargetkan untuk smaller runtimes.

## 5.1 Kenapa Core Profile muncul?

Cloud-native dan microservices membawa kebutuhan:

- runtime lebih kecil;
- startup lebih cepat;
- dependency surface lebih kecil;
- build-time processing/AOT lebih mudah;
- service tidak selalu butuh servlet/JPA/full web stack;
- portable minimal APIs;
- microservice bisa fokus REST/JSON/CDI/Validation.

Jakarta EE 10 memperkenalkan Core Profile, dan Jakarta EE 11 melanjutkannya.

## 5.2 Core Profile cocok untuk apa?

Cocok untuk:

- microservice kecil;
- cloud-native runtime;
- AOT/build-time optimized runtime;
- REST + JSON + CDI + Validation;
- lightweight API service;
- serverless-ish deployment;
- function-like service;
- service tanpa JPA/JMS/Batch/Mail;
- API gateway-like component;
- sidecar/internal control service.

Contoh:

```text
Case Classification Service
  REST endpoint
  CDI services
  JSON input/output
  Validation
  no DB
  no JMS
  no full web UI
```

## 5.3 Core Profile bukan “mainan kecil”

Core Profile bukan berarti tidak production-grade.

Ia adalah contract minimal untuk smaller runtimes. Jika service kamu memang kecil dan tidak butuh JPA/JMS/Batch, Core Profile bisa lebih tepat daripada Web/Platform.

## 5.4 Core Profile dan CDI Lite

Core Profile sangat terkait dengan programming model minimal seperti CDI Lite.

CDI Lite penting untuk runtime yang ingin:

- build-time discovery;
- minimal reflection;
- AOT friendliness;
- smaller runtime;
- predictable startup.

## 5.5 Core Profile limitation

Core Profile tidak otomatis menyediakan semua hal yang biasa kamu harapkan dari enterprise web app.

Jika kamu butuh:

- JPA;
- full transaction manager;
- servlet-specific features;
- server-side UI;
- JMS;
- Batch;
- Mail;
- Connector;
- SOAP;

Core Profile kemungkinan tidak cukup.

## 5.6 Core Profile decision principle

Pilih Core Profile jika requirement kamu benar-benar minimal.

Jangan pilih Core hanya karena “lebih modern”, lalu menambahkan banyak extension sehingga akhirnya jadi platform custom yang tidak jelas.

---

# 6. Core ⊂ Web ⊂ Platform: Cara Membaca Relasinya

Secara mental model:

```text
Core Profile
  ⊂ Web Profile
      ⊂ Platform
```

Artinya:

- Core adalah subset paling kecil.
- Web menambahkan capability untuk web applications.
- Platform menambahkan capability enterprise lebih luas.

## 6.1 Diagram konseptual

```text
+-----------------------------------------------------+
| Jakarta EE Platform                                 |
|                                                     |
|  Messaging, Batch, Mail, Connector, EJB, etc.       |
|                                                     |
|   +---------------------------------------------+   |
|   | Jakarta EE Web Profile                      |   |
|   |                                             |   |
|   |  Servlet, Web, Persistence, Transactions,   |   |
|   |  Web-oriented components                    |   |
|   |                                             |   |
|   |   +-------------------------------------+   |   |
|   |   | Jakarta EE Core Profile             |   |   |
|   |   |                                     |   |   |
|   |   | CDI Lite, REST, JSON, Validation,   |   |   |
|   |   | foundational microservice APIs      |   |   |
|   |   +-------------------------------------+   |   |
|   +---------------------------------------------+   |
+-----------------------------------------------------+
```

## 6.2 Cara membaca requirement

Jika aplikasi butuh fitur X, tanya:

1. Apakah X ada di Core?
2. Jika tidak, apakah X ada di Web?
3. Jika tidak, apakah X ada di Platform?
4. Jika tidak, apakah X vendor/framework-specific?
5. Apakah portable behavior masih penting?

## 6.3 Contoh mapping

```text
REST + JSON + CDI + Validation
  → Core mungkin cukup

REST + JPA + Transactions
  → Web Profile lebih realistis

REST + JPA + JMS + Batch + Mail
  → Platform

SOAP + Connector + EJB legacy
  → Platform / modernization strategy

Only JSON parser library in plain Java SE
  → mungkin tidak butuh Jakarta EE runtime sama sekali
```

---

# 7. Apa yang Masuk dan Tidak Masuk ke Setiap Profile

> Catatan penting: daftar komponen detail dapat berubah per versi Jakarta EE. Selalu cek halaman spesifikasi resmi versi target. Bagian ini menjelaskan mental model dan kategori, bukan menggantikan specification matrix resmi.

## 7.1 Core Profile: kategori kemampuan

Core Profile umumnya fokus pada foundational services untuk runtime kecil:

- dependency injection / CDI Lite;
- RESTful services;
- JSON processing/binding;
- validation;
- annotation/lifecycle basics;
- interceptors minimal;
- foundational APIs yang dibutuhkan oleh stack kecil.

Core biasanya tidak menjadi target untuk full persistence-heavy enterprise app.

## 7.2 Web Profile: kategori kemampuan

Web Profile menambahkan kemampuan web application:

- Servlet;
- REST;
- CDI Full or relevant CDI capabilities;
- Validation;
- Persistence;
- Transactions;
- JSON;
- Expression Language;
- Pages/Faces depending version/profile composition;
- web security-related capabilities;
- web-oriented APIs.

Web Profile sering cukup untuk:

- REST + DB;
- server-side app;
- web admin;
- business application tanpa messaging/batch/mail.

## 7.3 Platform: kategori kemampuan

Platform mencakup lebih banyak enterprise services:

- everything in Web/Core;
- Messaging/JMS;
- Batch;
- Mail;
- Enterprise Beans;
- Connector Architecture;
- XML Web Services/SOAP-related specs;
- more integration capabilities;
- full enterprise deployment semantics.

## 7.4 Jangan menghafal daftar, pahami axis

Daripada menghafal semua spec, pahami axis:

| Axis | Core | Web | Platform |
|---|---|---|---|
| Runtime size | kecil | sedang | besar |
| REST/JSON | ya | ya | ya |
| CDI | minimal/foundational | lebih lengkap | lengkap |
| Servlet web | tidak selalu / tergantung | ya | ya |
| Persistence/JPA | umumnya tidak | ya | ya |
| Transaction | minimal/terbatas | ya | ya |
| Messaging | tidak | tidak umum | ya |
| Batch | tidak | tidak umum | ya |
| Mail | tidak | tidak umum | ya |
| Enterprise legacy | tidak | sebagian | ya |
| Cloud-native small runtime | sangat cocok | cocok | tergantung |
| Traditional enterprise app | kurang cocok | cocok | sangat cocok |

## 7.5 “Tidak masuk profile” bukan berarti tidak bisa dipakai

Jika spec tidak ada di profile, kamu mungkin masih bisa:

- menambahkan dependency/implementation sendiri;
- memakai vendor extension;
- memakai library alternatif;
- menjalankan di runtime yang lebih besar;
- memilih profile lain.

Namun portability profile menjadi lebih lemah jika kamu bergantung pada sesuatu di luar profile contract.

---

# 8. Jakarta EE 11 sebagai Baseline Modern

Jakarta EE 11 adalah baseline modern penting.

## 8.1 Hal penting di Jakarta EE 11

Jakarta EE 11 Platform menyebut beberapa fitur/peningkatan:

- support for Java Records;
- JDK runtime-aware support for Virtual Threads;
- Jakarta Data 1.0.

Juga ada perubahan seperti:

- pruning/removal terkait ManagedBeans;
- remove requirement/use of SecurityManager;
- removal of optional specifications in Platform context.

## 8.2 Minimum Java SE 17

Web Profile 11 dan Core Profile 11 mencantumkan minimum Java SE 17 atau lebih tinggi.

Implikasi:

- Java 8 tidak lagi cukup;
- Java 11 tidak lagi cukup untuk Jakarta EE 11 target;
- records/sealed classes/pattern matching Java 17-era lebih relevan;
- SecurityManager legacy assumptions perlu dihapus;
- runtime/library harus compatible dengan Java 17+.

## 8.3 Java Records support

Records penting untuk:

- DTO;
- command;
- event;
- projection;
- immutable data carrier.

Support di platform membantu binding/serialization/validation/persistence-related integration menjadi lebih modern.

Namun jangan salah:

```text
record bagus untuk DTO/value object
record tidak otomatis cocok untuk mutable JPA entity lifecycle
```

## 8.4 Virtual thread awareness

Jakarta EE 11 menyebut JDK runtime-aware support for Virtual Threads.

Artinya platform mulai mengakui runtime modern Java 21+.

Namun virtual thread bukan berarti:

```text
semua concurrency problem selesai
```

Tetap perlu:

- DB pool bound;
- downstream bulkhead;
- transaction boundary;
- context propagation;
- ThreadLocal audit;
- observability.

## 8.5 Jakarta Data 1.0

Jakarta Data menjadi spesifikasi baru di Jakarta EE 11.

Ini penting karena Jakarta ecosystem kini punya repository abstraction standard.

Namun repository abstraction bukan pengganti domain modeling.

Bedakan:

```text
Jakarta Data repository = data access abstraction
Domain repository = domain/application port untuk aggregate persistence
```

## 8.6 SecurityManager removal context

Java modern bergerak meninggalkan SecurityManager.

Jakarta EE 11 menghapus requirement/use terkait SecurityManager.

Implikasi:

- sandboxing jangan bergantung pada SecurityManager;
- gunakan OS/container isolation;
- gunakan runtime/container permission model modern;
- review policy/security code lama.

---

# 9. Jakarta EE 12: Arah Berikutnya

Pada halaman resmi, Jakarta EE 12 tercatat under development.

## 9.1 Kenapa penting dibahas sekarang?

Karena aplikasi enterprise hidup lama.

Jika kamu membangun Jakarta EE 11 hari ini, kamu perlu sadar arah 12 agar keputusan tidak segera menjadi legacy.

## 9.2 Area yang perlu diantisipasi

Hal yang biasanya perlu dipantau:

- minimum Java baseline;
- API removals/deprecations;
- consistency improvements;
- configuration model;
- SecurityManager cleanup;
- CDI/Data/REST/Validation evolution;
- virtual thread integration;
- cloud-native alignment;
- build-time/AOT friendliness;
- TCK changes;
- runtime vendor readiness.

## 9.3 Strategy

Untuk production:

```text
Target stable current release for production.
Track next release for roadmap.
Do not adopt under-development feature as production assumption unless explicitly supported.
```

Jadi:

- gunakan Jakarta EE 11 sebagai baseline modern stabil;
- monitor Jakarta EE 12 untuk future migration;
- hindari vendor-specific feature jika akan distandardisasi segera;
- tulis ADR untuk pilihan runtime/version.

---

# 10. Profile dan Runtime

## 10.1 Runtime harus compatible dengan target profile

Jika aplikasi menargetkan Web Profile, pilih runtime yang compatible dengan Web Profile versi tersebut.

Contoh keputusan:

```text
Target:
  Jakarta EE Web Profile 11

Runtime must provide:
  Web Profile 11 compatible implementation
```

Jangan hanya:

```text
dependency compile berhasil
```

Compile berhasil tidak membuktikan runtime menyediakan behavior.

## 10.2 Modular runtime

Beberapa runtime modern bersifat modular:

```text
enable only features needed
```

Ini cocok dengan profile thinking.

Contoh mental model:

```text
REST feature
CDI feature
JSON feature
JPA feature
Security feature
```

Keuntungan:

- footprint lebih kecil;
- startup lebih cepat;
- attack surface lebih kecil;
- dependency lebih jelas.

Risiko:

- feature missing at runtime;
- config lebih banyak;
- portability perlu dicek;
- vendor feature names tidak selalu standard.

## 10.3 Compatible implementation vs “works on my runtime”

Compatible implementation berarti sudah diuji terhadap TCK untuk spec/profile terkait.

“Works on my runtime” berarti hanya berhasil pada satu runtime.

Untuk enterprise portability, prefer compatible implementation.

## 10.4 Runtime selection criteria

Saat memilih runtime:

- Jakarta EE version support;
- profile support;
- TCK compatibility;
- Java version support;
- cloud/container support;
- startup/memory;
- observability integration;
- security patch cadence;
- vendor/community support;
- operational familiarity;
- migration tooling;
- documentation quality;
- licensing.

## 10.5 Runtime lock-in

Lock-in muncul dari:

- proprietary config;
- proprietary annotation;
- runtime-specific API;
- server-specific deployment descriptor;
- non-standard transaction/security feature;
- specific classloader behavior;
- proprietary metrics format.

Lock-in tidak selalu buruk. Tapi harus sadar.

Tulis ADR jika memakai vendor-specific feature.

---

# 11. Profile dan Dependency Management

## 11.1 API dependency sesuai profile

Maven mental model:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-core-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

atau:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

atau:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 11.2 Kenapa `provided`?

Dalam deployment model klasik:

- API tersedia saat compile;
- implementation disediakan runtime/container;
- WAR tidak perlu membawa API jar/implementation container.

`provided` mencegah duplicate API classes di aplikasi.

## 11.3 Kapan `provided` bisa salah?

Jika kamu membuat executable jar yang tidak dijalankan dalam Jakarta EE runtime, maka API saja tidak cukup.

Contoh:

```text
plain java -jar app.jar
```

dengan hanya `jakarta.ws.rs-api` tidak akan membuat JAX-RS server berjalan.

Kamu butuh runtime/framework/implementation.

## 11.4 Common dependency mistakes

### Mistake 1 — API jar dianggap implementation

```xml
jakarta.persistence-api
```

tidak sama dengan Hibernate/EclipseLink.

### Mistake 2 — Mencampur API version

```text
jakarta.ws.rs-api 4.x
jakarta.validation-api 3.x
jakarta.platform 10
```

tanpa alasan jelas.

### Mistake 3 — Membawa API jar ke runtime container

Bisa menyebabkan classloading conflict.

### Mistake 4 — Mixing `javax` and `jakarta`

```text
javax.persistence.Entity
jakarta.transaction.Transactional
```

dalam stack yang tidak kompatibel.

### Mistake 5 — Transitive dependency menarik API lama

Dependency lama bisa membawa `javax.*` API.

Gunakan dependency tree.

## 11.5 Dependency strategy by profile

| Target | Dependency style |
|---|---|
| Core Profile app in compatible runtime | `jakarta.jakartaee-core-api` provided |
| Web Profile WAR | `jakarta.jakartaee-web-api` provided |
| Full Platform app | `jakarta.jakartaee-api` provided |
| Plain Java SE app using only JSON-P | individual API + implementation |
| Spring Boot app using Jakarta APIs | Spring Boot dependency management |
| Quarkus/Micronaut app | platform-specific BOM/extensions |

---

# 12. Profile dan Packaging

## 12.1 WAR

WAR cocok untuk Jakarta EE web deployment.

Biasanya:

```text
compile API dependency: provided
runtime provides implementation
deploy WAR to compatible runtime
```

Kelebihan:

- standard deployment;
- container-managed services;
- thin artifact;
- portable jika standard.

Kekurangan:

- runtime dependency external;
- operations perlu manage server/runtime;
- classloader behavior perlu dipahami.

## 12.2 EAR

EAR lebih legacy/enterprise large packaging.

Cocok jika:

- multiple modules;
- EJB legacy;
- shared library;
- application client;
- enterprise deployment model.

Untuk cloud-native microservice baru, EAR sering berlebihan.

## 12.3 Executable jar

Banyak runtime modern mendukung executable jar atau packaged runtime.

Kelebihan:

- self-contained deployment;
- container-friendly;
- simple `java -jar`;
- runtime version embedded.

Kekurangan:

- portability profile perlu dicek;
- artifact lebih besar;
- update runtime berarti rebuild artifact;
- provided dependency semantics berbeda.

## 12.4 Container image

Cloud deployment biasanya:

```text
build artifact
  → container image
  → Kubernetes
```

Profile tetap penting karena menentukan runtime capability dalam image.

## 12.5 Packaging decision

| Use case | Packaging |
|---|---|
| Traditional Jakarta web app | WAR |
| Legacy full platform | EAR/WAR |
| Cloud-native Jakarta runtime | executable jar/container image |
| Microservice core profile | runtime-specific executable/container |
| Library | jar, no runtime assumption |

---

# 13. Profile dan Cloud-Native Architecture

## 13.1 Cloud-native bukan berarti tidak Jakarta EE

Jakarta EE dapat digunakan cloud-native jika:

- runtime ringan/modular;
- startup/readiness benar;
- memory/CPU sizing jelas;
- health check tersedia;
- graceful shutdown;
- config/secrets externalized;
- logs/metrics/traces;
- stateless design or external session;
- container-friendly packaging.

## 13.2 Profile membantu cloud-native

Core Profile:

- small runtime;
- minimal APIs;
- cocok microservice kecil.

Web Profile:

- cocok REST + DB service.

Platform:

- cocok enterprise service besar, tetapi harus dikelola footprint-nya.

## 13.3 Cloud-native requirements

Untuk service Jakarta di Kubernetes:

- startup probe;
- readiness probe;
- liveness probe;
- graceful shutdown;
- resource request/limit;
- observability;
- stateless/session strategy;
- connection pool sizing;
- TLS/secrets;
- config externalization.

## 13.4 Jakarta EE dan MicroProfile

MicroProfile bukan Jakarta EE Profile.

MicroProfile fokus pada microservices patterns:

- Config;
- Fault Tolerance;
- Health;
- Metrics/Telemetry;
- JWT;
- REST client;
- OpenAPI.

Banyak runtime mendukung Jakarta EE + MicroProfile.

Mental model:

```text
Jakarta EE = standard enterprise API/platform
MicroProfile = microservice/cloud-native complementary specs
```

Namun standard boundary berbeda. Jangan menganggap MicroProfile otomatis bagian dari Jakarta EE Platform/Profile.

## 13.5 Cloud-native anti-pattern

- full platform hanya karena “default”;
- session state in-memory tanpa cluster strategy;
- liveness check DB;
- no graceful shutdown;
- DB pool tidak dihitung dengan replicas;
- runtime image terlalu besar tanpa alasan;
- logs file lokal;
- no trace propagation;
- no resource sizing.

---

# 14. Profile dan Microservices

## 14.1 Microservice tidak harus Core Profile

Microservice bisa memakai:

- Core Profile;
- Web Profile;
- Platform subset;
- Spring Boot;
- Quarkus;
- Micronaut;
- plain Java SE.

Yang menentukan adalah requirement.

## 14.2 Core Profile microservice

Cocok jika:

```text
REST + JSON + CDI + Validation
```

dan tidak butuh DB-managed persistence.

Contoh:

- scoring service;
- routing service;
- configuration lookup;
- validation service;
- transformation service.

## 14.3 Web Profile microservice

Cocok jika:

```text
REST + DB + transaction + validation
```

Contoh:

- case command service;
- licensing application service;
- profile service;
- internal admin API.

## 14.4 Platform microservice

Platform microservice masuk akal jika service butuh:

- JMS;
- Batch;
- Mail;
- enterprise resource adapter;
- EJB legacy features;
- SOAP/XML WS integration.

Namun hati-hati: jika setiap microservice memakai Full Platform tanpa alasan, estate menjadi berat.

## 14.5 Microservice profile decision

Tanya:

1. Apakah service punya DB?
2. Apakah butuh JPA/JTA?
3. Apakah butuh messaging standard Jakarta?
4. Apakah butuh batch/mail?
5. Apakah runtime target mendukung feature yang diperlukan?
6. Apakah cloud footprint penting?
7. Apakah portability profile penting?
8. Apakah team punya runtime expertise?

---

# 15. Profile dan Monolith/Modulith

## 15.1 Monolith tidak selalu buruk

Monolith/modulith bisa baik jika:

- domain masih tightly coupled;
- team kecil;
- transaction boundary kuat;
- deployment simplicity penting;
- modular boundary jelas;
- observability baik.

## 15.2 Web Profile for modulith

Banyak modulith web apps cocok dengan Web Profile:

- REST/web;
- JPA;
- transaction;
- validation;
- CDI;
- JSON;
- security.

## 15.3 Platform for enterprise monolith

Full Platform cocok jika modulith/monolith juga memakai:

- JMS;
- Batch;
- Mail;
- EJB;
- SOAP;
- Connectors;
- server-side UI legacy.

## 15.4 Modular monolith guideline

Walau target Platform, internal design tetap harus modular:

```text
case/
  domain/
  application/
  infrastructure/

profile/
  domain/
  application/
  infrastructure/
```

Jangan biarkan Full Platform membuat semua module saling bergantung.

## 15.5 Profile bukan pengganti architecture

Pilih profile hanya menjawab “runtime capability”.

Ia tidak otomatis membuat:

- domain boundary;
- module boundary;
- transaction boundary;
- testability;
- observability;
- security.

---

# 16. Profile dan Legacy Enterprise Application

## 16.1 Legacy often needs Platform

Aplikasi Java EE lama sering memakai:

- EJB;
- JMS;
- JTA;
- JAX-WS;
- JAXB;
- JSP/JSF;
- JCA;
- Mail;
- application client;
- EAR.

Untuk migrasi awal, full Platform mungkin paling realistis.

## 16.2 Jangan langsung memaksa Core/Web

Jika legacy app full platform dipaksa ke Core Profile, kamu akan melakukan rewrite besar.

Strategi lebih aman:

```text
stabilize on compatible Jakarta runtime
  ↓
migrate namespace
  ↓
upgrade Java/runtime
  ↓
extract/refactor modules gradually
  ↓
move some features to Web/Core services if justified
```

## 16.3 Strangler migration

Contoh:

```text
Legacy Full Platform app
  → expose stable API
  → new Core/Web service handles new capability
  → events sync read model
  → gradually move bounded context
```

## 16.4 Legacy modernization decision

Jangan tanya:

```text
Bagaimana membuat semuanya Core Profile?
```

Tanya:

```text
Bagian mana yang benar-benar butuh full platform?
Bagian mana yang bisa diekstrak?
Bagian mana yang bisa tetap legacy sampai risk rendah?
```

---

# 17. Decision Framework: Memilih Profile

## 17.1 Decision tree sederhana

```text
Apakah aplikasi butuh JMS/Batch/Mail/EJB/Connector/SOAP?
  ya → Platform kandidat kuat
  tidak →
    Apakah aplikasi butuh JPA/JTA/Servlet/web app?
      ya → Web Profile kandidat kuat
      tidak →
        Apakah aplikasi REST/JSON/CDI/Validation kecil?
          ya → Core Profile kandidat kuat
          tidak →
            mungkin Java SE/library standalone cukup
```

## 17.2 Decision matrix

| Requirement | Core | Web | Platform |
|---|---:|---:|---:|
| REST endpoint | good | good | good |
| JSON binding/processing | good | good | good |
| CDI/injection | good | good | good |
| Validation | good | good | good |
| Servlet filter/session | limited/no | good | good |
| JPA persistence | no/limited | good | good |
| JTA transaction | no/limited | good | good |
| JMS messaging | no | no | good |
| Batch | no | no | good |
| Mail | no | no | good |
| SOAP/XML WS | no | no | good |
| Legacy EJB | no | limited/no | good |
| Small runtime | best | medium | heavy |
| Traditional enterprise | limited | good | best |
| Cloud microservice | best/good | good | depends |

## 17.3 Non-functional factors

Selain fitur, pertimbangkan:

- startup time;
- memory footprint;
- team familiarity;
- runtime support;
- observability;
- security patching;
- deployment model;
- vendor compatibility;
- test complexity;
- migration cost;
- long-term evolution.

## 17.4 Rules of thumb

1. Mulai dari requirement, bukan dari preferensi runtime.
2. Pilih profile terkecil yang memenuhi kebutuhan dengan jelas.
3. Jangan mengorbankan simplicity untuk footprint jika tim tidak siap.
4. Jangan memakai Full Platform hanya karena historis.
5. Jangan memakai Core Profile jika akhirnya menambahkan banyak extension vendor-specific.
6. Jika butuh JPA/JTA, Web Profile biasanya baseline praktis.
7. Jika butuh JMS/Batch/Mail/EJB/JCA/SOAP, pertimbangkan Platform.
8. Jika hanya REST/JSON/CDI/Validation, Core Profile layak.
9. Jika portability penting, hindari vendor extension.
10. Jika cloud-native penting, ukur startup/memory/runtime behavior.

---

# 18. Case Study 1: REST API Sederhana

## 18.1 Requirement

```text
Service menerima JSON request, validasi input, memanggil pure domain logic, mengembalikan JSON response.
Tidak ada database.
Tidak ada messaging.
Tidak ada batch.
```

## 18.2 Candidate

Core Profile.

## 18.3 Why

Core menyediakan mental model minimal:

- REST;
- JSON;
- CDI;
- Validation;
- lifecycle/interceptor basics.

Tidak perlu Web/Profile Platform jika:

- tidak memakai JPA;
- tidak memakai Servlet-specific session;
- tidak memakai JMS/Batch/Mail.

## 18.4 Architecture

```text
JAX-RS resource
  ↓
CDI application service
  ↓
domain service
  ↓
JSON response
```

## 18.5 Risks

- runtime Core Profile support;
- observability/health mungkin butuh MicroProfile or runtime feature;
- security model mungkin butuh tambahan;
- deployment packaging runtime-specific.

## 18.6 Decision

```text
Target Jakarta EE Core Profile 11 + runtime-specific health/observability extensions.
```

Tulis ADR jika memakai MicroProfile/vendor extension.

---

# 19. Case Study 2: CRUD Web App dengan JPA dan Validation

## 19.1 Requirement

```text
REST API
PostgreSQL
JPA entities
Transaction
Validation
Security
JSON
```

## 19.2 Candidate

Web Profile.

## 19.3 Why

Butuh JPA dan transaction. Core kemungkinan tidak cukup.

Full Platform terlalu besar jika tidak butuh JMS/Batch/Mail/EJB/Connector.

## 19.4 Architecture

```text
JAX-RS Resource
  ↓
Application Service with Transaction
  ↓
Domain/Aggregate
  ↓
Repository
  ↓
JPA EntityManager
```

## 19.5 Risks

- N+1 query;
- transaction boundary leak;
- entity serialization;
- lazy loading in REST response;
- connection pool sizing;
- migration `javax.persistence` to `jakarta.persistence`.

## 19.6 Decision

```text
Target Jakarta EE Web Profile 11.
Use JPA for persistence.
Keep DTO separate from entity.
Use Testcontainers for integration tests.
```

---

# 20. Case Study 3: Enterprise Monolith dengan Messaging, Batch, dan Mail

## 20.1 Requirement

```text
REST API
Server-side admin UI
JPA
Transactions
JMS
Batch archival
Email notification
SOAP integration legacy
Security
Audit
```

## 20.2 Candidate

Full Platform.

## 20.3 Why

Messaging, batch, mail, SOAP, and broad enterprise integration go beyond Web Profile.

## 20.4 Architecture

```text
Web/API Layer
  ↓
Application modules
  ↓
Domain modules
  ↓
JPA/JTA
  ↓
JMS/Mail/Batch/SOAP adapters
```

## 20.5 Risks

- large runtime;
- operational complexity;
- module coupling;
- slow startup;
- migration complexity;
- vendor extension temptation.

## 20.6 Decision

```text
Target Jakarta EE Platform 11.
Use modular monolith structure.
Document vendor-specific config.
Add production readiness review.
```

---

# 21. Case Study 4: Cloud-Native Microservice dengan CDI + REST + JSON

## 21.1 Requirement

```text
Small service
REST
JSON
Validation
No DB
No server session
Must start fast
Low memory
Kubernetes deployment
```

## 21.2 Candidate

Core Profile.

## 21.3 Architecture

```text
Container image
  → small Jakarta runtime
  → CDI + JAX-RS + JSON-B/P + Validation
```

## 21.4 Non-standard needs

For Kubernetes you still need:

- health endpoints;
- metrics;
- tracing;
- config;
- secrets.

These may come from runtime features or MicroProfile, not necessarily Jakarta EE Core itself.

## 21.5 Decision

```text
Core Profile + MicroProfile Health/Metrics/OpenTelemetry support if runtime provides.
```

## 21.6 Warning

If after three months you add JPA, JMS, and batch, revisit profile selection. Do not grow accidental platform through ad-hoc dependencies.

---

# 22. Case Study 5: Legacy Java EE Full Platform Migration

## 22.1 Requirement

Existing application:

```text
Java EE 7/8
EAR
EJB
JMS
JPA
JAX-WS
JSP/JSF
JAXB
Mail
```

Target:

```text
Jakarta EE 11
Java 17+
Cloud/container deployment eventually
```

## 22.2 Candidate

Initial: Platform.

Long-term: decompose some modules to Web/Core.

## 22.3 Migration approach

```text
1. Inventory specs used
2. Migrate javax → jakarta
3. Upgrade runtime compatible with Jakarta EE target
4. Run compatibility tests
5. Stabilize
6. Extract bounded contexts gradually
7. Move new services to Web/Core where possible
```

## 22.4 Why not Core immediately?

Because EJB/JMS/JAX-WS/Batch/Mail needs are outside Core.

Big bang rewrite raises risk.

## 22.5 Decision

```text
Use Platform for migration compatibility.
Use Web/Core for new extracted services.
```

---

# 23. Production Risks Saat Salah Memilih Profile

## 23.1 Profile terlalu besar

Risiko:

- larger runtime footprint;
- slower startup;
- more CVE surface;
- more config;
- team uses features casually;
- hidden coupling;
- harder migration;
- harder cloud optimization.

Example:

```text
Full Platform runtime for JSON transformation service with no DB.
```

## 23.2 Profile terlalu kecil

Risiko:

- missing runtime capability;
- vendor extensions everywhere;
- custom transaction/persistence stack;
- portability lost;
- integration complexity;
- teams reinvent platform features poorly.

Example:

```text
Core Profile service manually wires JPA, transaction, connection pool, messaging, batch.
```

At that point Web/Platform may be better.

## 23.3 Profile mismatch with runtime

Compile:

```xml
jakarta.jakartaee-api
```

Deploy to Web Profile runtime.

If app uses JMS, runtime fails.

## 23.4 Profile mismatch with dependency scope

Including API jars inside WAR can conflict with container-provided APIs.

## 23.5 Profile mismatch with team skill

Core Profile with many custom extensions may require more expertise than Web Profile runtime that already provides integrated services.

## 23.6 Profile mismatch with compliance

Regulated enterprise app may need audit/security/transaction/messaging features that smaller profile does not cover directly.

---

# 24. Checklist Review Profile Selection

## 24.1 Functional requirements

- [ ] Does app expose REST API?
- [ ] Does app need Servlet/session/filter?
- [ ] Does app need JPA?
- [ ] Does app need JTA?
- [ ] Does app need Validation?
- [ ] Does app need JSON-B/JSON-P?
- [ ] Does app need Security?
- [ ] Does app need JMS?
- [ ] Does app need Batch?
- [ ] Does app need Mail?
- [ ] Does app need SOAP/XML WS?
- [ ] Does app need Connector/JCA?
- [ ] Does app need EJB legacy?

## 24.2 Runtime requirements

- [ ] Compatible runtime available?
- [ ] Java version supported?
- [ ] Container image available?
- [ ] Startup time acceptable?
- [ ] Memory footprint acceptable?
- [ ] Observability integration available?
- [ ] Security patch cadence acceptable?
- [ ] Vendor/community support acceptable?

## 24.3 Operational requirements

- [ ] Kubernetes health/readiness strategy?
- [ ] Graceful shutdown?
- [ ] Resource sizing?
- [ ] Logs/metrics/traces?
- [ ] Debuggability/JFR?
- [ ] Config/secrets?
- [ ] Rollback?

## 24.4 Portability requirements

- [ ] Are you using only standard APIs?
- [ ] Any vendor extension?
- [ ] Any proprietary config?
- [ ] Any runtime-specific class?
- [ ] ADR for non-portable decision?

## 24.5 Decision output

Document:

```text
Selected profile:
Selected runtime:
Java baseline:
Specs used:
Specs intentionally not used:
Vendor extensions:
Risks:
Validation plan:
Rollback/migration path:
```

---

# 25. Latihan Bertahap

## Latihan 1 — Classify applications

Ambil 5 aplikasi imajiner:

1. JSON transformation REST service.
2. CRUD REST + JPA service.
3. Batch archival system.
4. Legacy EJB/JMS/JSP system.
5. WebSocket notification service.

Untuk masing-masing:

- pilih Core/Web/Platform;
- jelaskan alasan;
- tulis risiko;
- tulis runtime requirement.

## Latihan 2 — Dependency profile mapping

Buat Maven project dengan tiga profile:

```text
core
web
platform
```

Lihat API classes mana yang tersedia di compile-time.

Coba import:

```java
jakarta.ws.rs.GET
jakarta.persistence.Entity
jakarta.jms.Message
jakarta.batch.api.Batchlet
```

Catat package mana tersedia pada dependency mana.

## Latihan 3 — Runtime mismatch simulation

Compile app dengan Platform API, lalu deploy ke runtime Web Profile.

Gunakan class di luar Web Profile.

Amati failure.

## Latihan 4 — Vendor extension identification

Ambil contoh config runtime Jakarta.

Pisahkan:

```text
standard Jakarta API
vendor-specific config
MicroProfile spec
custom library
```

## Latihan 5 — Profile ADR

Tulis ADR:

```text
ADR-001: Select Jakarta EE Web Profile 11 for Case Command Service
```

Harus mencakup:

- context;
- options;
- decision;
- consequences;
- validation plan.

---

# 26. Mini Project: Jakarta Profile Decision Matrix

## 26.1 Goal

Buat repository kecil:

```text
jakarta-profile-decision-matrix/
  README.md
  decisions/
  examples/
  scripts/
```

## 26.2 Deliverables

```text
README.md
PROFILE-COMPARISON.md
ADR-001-core-profile-service.md
ADR-002-web-profile-service.md
ADR-003-platform-monolith.md
DEPENDENCY-MATRIX.md
RUNTIME-MATRIX.md
```

## 26.3 Example services

### Service A — Classification API

Requirements:

- REST;
- JSON;
- Validation;
- CDI;
- no database.

Target:

```text
Core Profile
```

### Service B — Case Command API

Requirements:

- REST;
- JSON;
- Validation;
- CDI;
- JPA;
- Transaction;
- Security.

Target:

```text
Web Profile
```

### Service C — Regulatory Monolith

Requirements:

- REST;
- JPA;
- JMS;
- Batch;
- Mail;
- SOAP;
- EJB legacy.

Target:

```text
Platform
```

## 26.4 Evaluation questions

1. Why is Core sufficient for Service A?
2. Why is Web better than Core for Service B?
3. Why is Platform justified for Service C?
4. What vendor extensions are accepted?
5. What is the migration path if Service B later needs JMS?
6. What is the cloud footprint difference?
7. How do you test runtime compatibility?
8. What should be documented in ADR?
9. What profile minimizes unnecessary surface area?
10. What profile minimizes custom infrastructure code?

---

# 27. Referensi Resmi

Referensi utama:

1. Jakarta EE Specifications  
   https://jakarta.ee/specifications/

2. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

3. Jakarta EE Web Profile 11  
   https://jakarta.ee/specifications/webprofile/11/

4. Jakarta EE Core Profile 11  
   https://jakarta.ee/specifications/coreprofile/11/

5. Jakarta EE Release 11  
   https://jakarta.ee/release/11/

6. Jakarta EE Release 12 — Under Development  
   https://jakarta.ee/release/12/

7. Jakarta EE Platform 12 — Under Development  
   https://jakarta.ee/specifications/platform/12/

8. Jakarta EE Tutorial — Overview  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/intro/overview/overview.html

9. Jakarta EE Core Profile 10  
   https://jakarta.ee/specifications/coreprofile/10/

10. Jakarta EE Web Profile  
    https://jakarta.ee/specifications/webprofile/

11. Jakarta EE Core Profile  
    https://jakarta.ee/specifications/coreprofile/

---

# Penutup

Jakarta EE Platform, Web Profile, dan Core Profile bukan sekadar tiga dependency yang berbeda. Mereka adalah **tiga level kontrak runtime**.

Ringkasnya:

```text
Core Profile
  untuk smaller runtime, microservice minimal, REST/JSON/CDI/Validation style

Web Profile
  untuk web application umum, REST + JPA + Transaction + Validation

Platform
  untuk full enterprise capability: messaging, batch, mail, connectors, EJB, SOAP, legacy integration
```

Engineer yang kuat tidak memilih profile karena trend. Ia memilih profile berdasarkan:

```text
required capabilities
runtime footprint
portability
operability
migration path
team skill
long-term evolution
```

Prinsip paling penting:

> Pilih profile terkecil yang memenuhi requirement dengan jelas, tetapi jangan memaksa profile kecil sampai kamu harus menciptakan ulang platform sendiri secara ad-hoc.

Dengan mental model ini, bagian berikutnya—dependency management API/implementation/runtime/BOM—akan jauh lebih masuk akal.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-001.md](./learn-java-jakarta-part-001.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-003.md](./learn-java-jakarta-part-003.md)
