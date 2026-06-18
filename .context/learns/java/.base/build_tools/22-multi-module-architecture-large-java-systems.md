# Part 22 — Multi-Module Architecture for Large Java Systems

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `22-multi-module-architecture-large-java-systems.md`  
> Scope: Java 8–25, Maven, Gradle, enterprise Java systems, large codebases, build architecture, module boundaries

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas project layout, dependency graph, repository, reproducibility, plugin, performance, CI/CD, release, security, dan governance. Bagian ini masuk ke satu level yang lebih arsitektural: **bagaimana menyusun sistem Java besar sebagai kumpulan module yang sehat**.

Multi-module bukan sekadar memecah folder menjadi banyak subfolder. Multi-module adalah cara menjadikan **arsitektur, ownership, dependency direction, testing strategy, release boundary, dan build performance** terlihat secara eksplisit di build system.

Target setelah bagian ini:

1. Bisa membedakan module yang benar-benar punya boundary dari module yang hanya folder teknis.
2. Bisa mendesain struktur Maven/Gradle multi-module untuk sistem Java besar.
3. Bisa menghindari cyclic dependency, `common` module yang membengkak, dan API leakage.
4. Bisa memetakan arsitektur layered, hexagonal, modular monolith, shared library, dan multi-service ke module build.
5. Bisa membaca module graph sebagai indikator kesehatan arsitektur.
6. Bisa membuat strategy CI/CD yang hanya membangun module terdampak tanpa mengorbankan trust.
7. Bisa mengambil keputusan kapan memecah module, kapan menggabungkan module, dan kapan membuat repository terpisah.

---

## 1. Mental Model: Module Adalah Boundary, Bukan Folder

Kesalahan paling umum dalam multi-module adalah menganggap module sama dengan folder.

Folder hanya struktur file.

Module adalah boundary.

Boundary berarti ada batas yang mengatur:

- siapa boleh bergantung ke siapa;
- API mana yang stabil;
- detail implementasi mana yang tidak boleh bocor;
- dependency eksternal mana yang boleh masuk;
- test mana yang bertanggung jawab;
- artifact apa yang dihasilkan;
- siapa owner-nya;
- kapan module berubah;
- seberapa besar dampaknya ke module lain.

Jika sebuah module tidak mengubah aturan dependency, visibility, ownership, build, atau release, mungkin ia hanya folder yang diberi nama module.

### 1.1 Modul yang sehat menjawab pertanyaan berikut

Untuk setiap module, engineer senior harus bisa menjawab:

1. Apa tanggung jawab module ini?
2. Siapa consumer module ini?
3. Apa API publik module ini?
4. Apa implementation detail yang tidak boleh diakses consumer?
5. Apakah module ini boleh bergantung ke database, framework web, messaging, atau cloud SDK?
6. Apakah module ini menghasilkan artifact publishable?
7. Apakah module ini bisa dites sendiri?
8. Apakah module ini bisa berubah tanpa memaksa banyak module lain berubah?
9. Apakah dependency direction-nya sesuai arsitektur?
10. Apakah module ini punya owner yang jelas?

Jika jawabannya kabur, module boundary belum matang.

---

## 2. Multi-Module Sebagai Graph

Build multi-module sebenarnya adalah graph.

Node = module.  
Edge = dependency antar module.

Contoh sederhana:

```text
:web-api
   |
   v
:application-service
   |
   v
:domain-model
```

Artinya:

- `web-api` tahu `application-service`;
- `application-service` tahu `domain-model`;
- `domain-model` tidak tahu `application-service`;
- `domain-model` tidak tahu `web-api`.

Ini bukan hanya masalah compile. Ini adalah ekspresi arsitektur.

Jika `domain-model` mulai bergantung ke `web-api`, maka dependency direction rusak.

```text
:web-api  <------+
   |             |
   v             |
:application     |
   |             |
   v             |
:domain-model ---+
```

Ini cyclic dependency.

Cyclic dependency berarti module tidak lagi independen. Build graph kehilangan topological order yang jelas. Arsitektur menjadi sulit dites, sulit dirilis, dan sulit dipahami.

---

## 3. Maven Reactor vs Gradle Multi-Project

### 3.1 Maven Reactor

Dalam Maven, multi-module umumnya didefinisikan melalui aggregator POM:

```xml
<packaging>pom</packaging>

<modules>
  <module>domain</module>
  <module>application</module>
  <module>web</module>
</modules>
```

Maven reactor akan menghitung urutan build berdasarkan dependency antar module. Jika `web` bergantung ke `application`, dan `application` bergantung ke `domain`, reactor akan membangun `domain` dulu, lalu `application`, lalu `web`.

Perintah penting:

```bash
mvn clean verify
mvn -pl web -am verify
mvn -pl application -amd test
mvn -rf :web verify
```

Makna:

- `-pl`: pilih project/module tertentu;
- `-am`: also make required dependencies;
- `-amd`: also make dependents;
- `-rf`: resume from module tertentu.

Maven multi-module kuat untuk build yang mengikuti convention dan lifecycle seragam.

### 3.2 Gradle Multi-Project

Dalam Gradle, multi-project didefinisikan di `settings.gradle.kts`:

```kotlin
rootProject.name = "enterprise-platform"

include(
    "domain",
    "application",
    "web"
)
```

Dependency antar project:

```kotlin
dependencies {
    implementation(project(":application"))
}
```

Gradle memodelkan module sebagai subproject yang memiliki task sendiri. Build graph tidak hanya dependency artifact, tetapi juga dependency task.

Contoh:

```bash
./gradlew :web:build
./gradlew :application:test
./gradlew build --parallel
```

Gradle kuat ketika graph kompleks, build logic perlu diprogram, module sangat banyak, dan performance/incrementality penting.

---

## 4. Jenis-Jenis Module dalam Sistem Java Besar

Tidak semua module punya peran yang sama. Banyak sistem besar gagal karena semua module diperlakukan sama: semua bisa akses database, semua bisa import framework web, semua bisa punya util global.

Berikut taxonomy module yang lebih sehat.

---

## 5. Domain Module

Domain module berisi konsep bisnis inti.

Contoh:

```text
:case-domain
:licence-domain
:inspection-domain
:payment-domain
```

Isi yang cocok:

- entity/domain object;
- value object;
- domain service;
- domain event;
- business rule;
- state transition;
- domain exception;
- invariant;
- pure policy logic.

Isi yang sebaiknya dihindari:

- Spring MVC controller;
- JPA repository implementation;
- HTTP client;
- Kafka/RabbitMQ client;
- AWS SDK;
- Servlet API;
- database connection;
- framework-heavy annotation yang mengunci domain ke runtime tertentu.

Contoh domain module yang relatif bersih:

```java
package com.example.casecore.domain;

public final class CaseStatusTransitionPolicy {
    public boolean canMove(CaseStatus from, CaseStatus to, ActorRole actorRole) {
        if (from == CaseStatus.CLOSED) {
            return false;
        }
        if (to == CaseStatus.APPROVED && actorRole != ActorRole.SUPERVISOR) {
            return false;
        }
        return true;
    }
}
```

Domain module seperti ini mudah dites, mudah dipakai lintas aplikasi, dan tidak tergantung container.

### 5.1 Invariant domain module

Domain module yang sehat punya invariant:

```text
Domain module must not depend on infrastructure module.
Domain module must not depend on web module.
Domain module must not depend on persistence implementation.
Domain module should be testable without application container.
```

---

## 6. API Module

API module berisi contract yang dipakai consumer.

Contoh:

```text
:case-api
:payment-api
:notification-api
```

Isi yang cocok:

- DTO publik;
- request/response model;
- interface service;
- command/query object;
- event contract;
- error code contract;
- OpenAPI generated interface jika memang dipakai sebagai contract;
- versioned contract classes.

Isi yang sebaiknya dihindari:

- implementation detail;
- repository implementation;
- entity persistence internal;
- util internal;
- dependency framework berat yang memaksa consumer membawa transitive dependency tidak perlu.

Contoh:

```java
package com.example.caseapi;

public interface CaseQueryPort {
    CaseView getCaseById(CaseId caseId);
}
```

API module harus stabil. Perubahan di API module biasanya berdampak luas.

### 6.1 API module bukan dumping ground

Banyak tim membuat `*-api` lalu memasukkan semua DTO internal. Ini salah.

API module harus hanya berisi contract yang benar-benar dikonsumsi boundary lain.

Jika class hanya dipakai internal satu implementation, jangan taruh di API module.

---

## 7. Implementation Module

Implementation module berisi realisasi dari API/port.

Contoh:

```text
:case-application
:case-service-impl
:case-persistence-jpa
:case-notification-adapter
```

Isi yang cocok:

- application service;
- use case orchestration;
- transaction boundary;
- implementation interface;
- adapter ke database;
- adapter ke messaging;
- adapter ke external API.

Dependency direction umum:

```text
:case-web
   -> :case-application
       -> :case-domain
       -> :case-api

:case-persistence-jpa
   -> :case-domain
   -> :case-application-port
```

Implementation module boleh bergantung ke framework sesuai layer-nya. Tetapi framework dependency harus berhenti di module yang tepat.

---

## 8. Application Module

Application module mengorkestrasi use case.

Ia bukan domain murni, tetapi juga bukan adapter teknis.

Isi yang cocok:

- use case service;
- command handler;
- transaction script;
- validation orchestration;
- authorization check orchestration;
- port interface;
- event publishing intent;
- workflow coordination.

Contoh:

```java
public final class ApproveCaseUseCase {
    private final CaseRepository caseRepository;
    private final CaseStatusTransitionPolicy transitionPolicy;
    private final CaseEventPublisher eventPublisher;

    public void approve(ApproveCaseCommand command) {
        CaseRecord record = caseRepository.getRequired(command.caseId());
        record.approve(command.actor(), transitionPolicy);
        caseRepository.save(record);
        eventPublisher.publish(CaseApproved.of(record.id()));
    }
}
```

Application module boleh tahu port, domain, dan transaction abstraction. Ia sebaiknya tidak tahu detail HTTP atau SQL vendor-specific jika ingin boundary tetap bersih.

---

## 9. Adapter Module

Adapter module menghubungkan aplikasi ke dunia luar.

Jenis adapter:

```text
:web-adapter
:rest-adapter
:messaging-adapter
:persistence-jpa-adapter
:external-client-adapter
:batch-adapter
:email-adapter
```

Adapter boleh bergantung ke framework teknis:

- Spring MVC;
- Jakarta REST;
- JPA/Hibernate;
- RabbitMQ/Kafka client;
- Redis client;
- AWS SDK;
- SMTP/Jakarta Mail;
- Servlet API;
- OpenAPI client.

Tapi adapter tidak boleh menjadi tempat business rule utama.

Contoh dependency direction:

```text
:case-rest-adapter
   -> :case-application
   -> :case-domain

:case-persistence-jpa-adapter
   -> :case-application
   -> :case-domain
```

Adapter adalah edge of system. Domain adalah core of system.

---

## 10. Bootstrap / Runtime Module

Dalam banyak aplikasi Spring Boot/Jakarta, ada module khusus untuk merakit runtime.

Contoh:

```text
:app-boot
:app-war
:runtime-main
```

Isi yang cocok:

- main class;
- dependency wiring;
- framework configuration;
- component scan root;
- runtime profile config;
- packaging executable artifact;
- container deployment descriptor jika perlu.

Contoh struktur:

```text
enterprise-case-platform/
  case-domain/
  case-application/
  case-persistence-jpa/
  case-rest-adapter/
  case-messaging-adapter/
  case-app-boot/
```

`case-app-boot` bergantung ke semua module yang perlu dirakit menjadi aplikasi.

```text
:case-app-boot
   -> :case-rest-adapter
   -> :case-persistence-jpa
   -> :case-messaging-adapter
   -> :case-application
   -> :case-domain
```

Keuntungan:

- domain bisa dites tanpa Spring Boot;
- adapter bisa dites terpisah;
- executable packaging tidak mencemari module domain;
- module runtime menjadi composition root.

---

## 11. Shared Kernel Module

Shared kernel berisi konsep yang memang dipakai lintas bounded context.

Contoh:

```text
:shared-kernel
```

Isi yang mungkin cocok:

- `Money`;
- `EmailAddress`;
- `UserId`;
- `CaseId` jika benar-benar lintas konteks;
- common error abstraction;
- clock abstraction;
- small result type;
- base domain event marker.

Yang tidak cocok:

- semua util random;
- semua constant;
- semua DTO;
- semua exception;
- semua framework config;
- semua helper static;
- semua base class yang dipakai supaya cepat.

Shared kernel harus kecil, stabil, dan sangat dijaga.

Jika `shared-kernel` berubah setiap minggu, ia bukan kernel. Ia sudah menjadi coupling hub.

---

## 12. Common Module: Anti-Pattern Paling Berbahaya

`common` biasanya dimulai dengan niat baik:

```text
:common
```

Lalu tumbuh menjadi:

```text
common/
  DateUtils.java
  JsonUtils.java
  SecurityUtils.java
  JpaUtils.java
  AwsUtils.java
  RabbitUtils.java
  CaseDto.java
  PaymentDto.java
  Constants.java
  BaseEntity.java
  BaseController.java
  Everything.java
```

Masalahnya:

1. Semua module bergantung ke `common`.
2. `common` bergantung ke banyak library eksternal.
3. Perubahan kecil di `common` memicu rebuild besar.
4. Dependency transitive bocor ke semua module.
5. Ownership kabur.
6. Semua orang takut mengubahnya.
7. Architecture direction hancur karena semua hal bisa “diselundupkan” lewat common.

### 12.1 Cara memecah common

Daripada satu `common`, pecah berdasarkan semantic boundary:

```text
:shared-kernel
:common-test-support
:json-support
:time-support
:observability-api
:security-contract
:security-spring-adapter
:persistence-support-jpa
```

Bedakan API dan adapter:

```text
:security-api
:security-spring-adapter
```

Jangan membuat `security-api` membawa Spring Security jika consumer domain hanya perlu `CurrentActor`.

---

## 13. Test Fixture Module

Sistem besar butuh test support. Tetapi test support juga bisa menjadi coupling hub.

Pilihan:

```text
:test-fixtures
:case-test-fixtures
:integration-test-support
:contract-test-support
```

Isi yang cocok:

- object mother;
- test data builder;
- fake implementation;
- test clock;
- test container bootstrap;
- assertion helper;
- sample payload;
- contract fixture.

Isi yang tidak cocok:

- production utility;
- logic bisnis baru;
- test helper yang membuat semua test terlalu implicit;
- global mutable fixture;
- shared state antar test.

Gradle punya konsep `java-test-fixtures` yang bisa memisahkan fixture dari production API.

Maven biasanya memakai module terpisah atau test-jar classifier, tetapi harus hati-hati agar test artifact tidak masuk runtime.

---

## 14. Module Boundary dan Dependency Direction

Arsitektur multi-module yang sehat biasanya punya dependency direction satu arah.

Contoh layered architecture:

```text
:web
  -> :application
      -> :domain
          -> :shared-kernel

:persistence
  -> :application
  -> :domain
```

Aturan:

```text
Outer layer depends on inner layer.
Inner layer does not depend on outer layer.
```

Jika domain butuh mengirim email, domain tidak bergantung ke `email-adapter`. Domain mendefinisikan port atau event.

```java
public interface CaseNotificationPort {
    void notifyCaseApproved(CaseApprovedEvent event);
}
```

Implementation ada di adapter:

```text
:notification-email-adapter
   -> :case-application
```

---

## 15. API vs Implementation Leakage

Salah satu manfaat besar Gradle `java-library` adalah pemisahan `api` dan `implementation`.

Contoh:

```kotlin
dependencies {
    api(project(":case-api"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
}
```

`api` berarti dependency terlihat oleh consumer.  
`implementation` berarti dependency hanya internal module.

Maven tidak punya konsep yang sama persis. Maven `compile` dependency cenderung transitif ke consumer. Karena itu Maven project perlu lebih disiplin dalam membuat API module kecil dan menghindari dependency framework berat di public API.

### 15.1 Contoh leakage

Jika API module berisi:

```java
public interface CaseClient {
    com.fasterxml.jackson.databind.JsonNode getCase(String id);
}
```

Maka Jackson menjadi bagian dari contract publik.

Consumer sekarang terikat ke Jackson.

Lebih baik:

```java
public interface CaseClient {
    CaseView getCase(CaseId id);
}
```

Jackson tetap implementation detail adapter.

---

## 16. Module Granularity: Terlalu Besar vs Terlalu Kecil

Tidak semua hal harus jadi module.

### 16.1 Module terlalu besar

Gejala:

- ribuan class dalam satu module;
- semua tim sering menyentuh module yang sama;
- test terlalu lama;
- dependency eksternal terlalu banyak;
- perubahan kecil rebuild semua;
- sulit mengetahui owner;
- domain bercampur web/persistence/messaging.

Dampak:

- coupling tinggi;
- CI lambat;
- refactoring berisiko;
- dependency graph tidak informatif.

### 16.2 Module terlalu kecil

Gejala:

- satu module hanya berisi 1–2 class tanpa boundary jelas;
- banyak module saling bergantung chain panjang;
- overhead build tinggi;
- developer sulit navigasi;
- release management rumit;
- banyak boilerplate POM/build.gradle.

Dampak:

- ceremony tinggi;
- graph terlalu granular;
- productivity turun.

### 16.3 Heuristik granularity

Buat module baru jika minimal salah satu benar:

1. Ada dependency policy berbeda.
2. Ada owner berbeda.
3. Ada lifecycle/release berbeda.
4. Ada test strategy berbeda.
5. Ada runtime boundary berbeda.
6. Ada API yang dikonsumsi banyak module.
7. Ada domain boundary yang stabil.
8. Ada dependency berat yang harus diisolasi.
9. Ada generated code yang perlu dipisahkan.
10. Ada performance benefit signifikan untuk incremental build.

Jangan buat module baru hanya karena package sudah banyak.

Package adalah organisasi internal. Module adalah dependency boundary.

---

## 17. Bounded Context dan Multi-Module

Dalam domain-driven design, bounded context adalah batas model bisnis. Multi-module bisa membantu mengekspresikan bounded context.

Contoh:

```text
:licensing-domain
:licensing-application
:licensing-api
:licensing-persistence

:inspection-domain
:inspection-application
:inspection-api
:inspection-persistence

:payment-domain
:payment-application
:payment-api
:payment-persistence
```

Jangan langsung membuat microservice hanya karena ada bounded context. Modular monolith dengan module boundary kuat sering lebih aman.

### 17.1 Modular monolith

Modular monolith berarti satu deployable application tetapi internalnya dipisah menjadi module yang jelas.

```text
:app-boot
  -> :licensing-*
  -> :inspection-*
  -> :payment-*
```

Keuntungan:

- deployment sederhana;
- transaction lebih mudah;
- observability lebih sederhana;
- boundary tetap dilatih;
- lebih mudah diekstrak menjadi service jika perlu.

Risiko:

- jika boundary tidak dijaga, ia kembali menjadi monolith biasa;
- shared database bisa menciptakan coupling tersembunyi;
- semua module bisa tergoda import langsung.

Karena itu build harus ikut enforce boundary.

---

## 18. Enforcing Architecture dengan Build

Arsitektur yang hanya ada di diagram akan rusak.

Build harus membantu enforce aturan.

### 18.1 Maven approach

Gunakan kombinasi:

- module dependency eksplisit;
- Maven Enforcer Plugin;
- Dependency Plugin analyze;
- ArchUnit test;
- custom Maven plugin jika perlu;
- ban duplicate classes;
- ban dependency tertentu di module tertentu.

Contoh rule konseptual:

```text
:domain modules must not depend on spring-web, spring-data-jpa, jakarta.servlet-api, aws-sdk.
:web modules must not be depended on by domain/application modules.
```

### 18.2 Gradle approach

Gunakan kombinasi:

- convention plugin;
- custom dependency rules;
- `java-library` `api`/`implementation` separation;
- dependency substitution;
- dependency insight;
- custom task untuk validate module graph;
- ArchUnit;
- forbidden dependency rules.

Contoh convention plugin:

```kotlin
plugins {
    `java-library`
}

// pseudo-code
configurations.configureEach {
    resolutionStrategy.eachDependency {
        if (project.name.endsWith("-domain") && requested.group == "org.springframework") {
            throw GradleException("Domain module must not depend on Spring")
        }
    }
}
```

Lebih baik lagi: tulis plugin enterprise yang membaca policy declarative.

---

## 19. Cyclic Dependency

Cyclic dependency adalah tanda arsitektur tidak punya arah.

Contoh:

```text
:case-application -> :notification-application
:notification-application -> :case-application
```

Biasanya terjadi karena:

- dua use case saling panggil langsung;
- DTO diletakkan di module yang salah;
- common module tidak cukup spesifik;
- event contract tidak dipisah;
- domain service dipakai sebagai integration service;
- adapter dipakai langsung oleh domain.

### 19.1 Cara memecah cycle

Strategi umum:

1. Extract API module.
2. Extract event contract module.
3. Introduce port/interface.
4. Move shared concept ke shared kernel kecil.
5. Invert dependency.
6. Ganti direct call dengan domain/application event.
7. Pisahkan orchestration ke application module lebih tinggi.

Contoh sebelum:

```text
:case-service -> :notification-service
:notification-service -> :case-service
```

Sesudah:

```text
:case-service -> :notification-api
:notification-service -> :notification-api
:notification-service -> :case-api
```

Atau dengan event:

```text
:case-service -> :case-events
:notification-service -> :case-events
```

---

## 20. Shared Library vs Internal Module

Tidak semua module harus dipublish sebagai library.

Ada dua jenis module:

```text
Internal reactor/subproject module
Published library module
```

Internal module:

- hanya dipakai dalam repo/build yang sama;
- bisa berubah cepat;
- tidak perlu semantic versioning formal;
- consumer-nya terbatas.

Published library:

- dipakai repo/team lain;
- butuh versioning;
- butuh compatibility contract;
- butuh changelog;
- butuh release pipeline;
- butuh deprecation policy.

Kesalahan umum: mem-publish terlalu banyak module internal. Akibatnya organisasi tenggelam dalam version coordination.

Heuristik:

```text
Publish only when there is a stable external consumer and a compatibility contract.
```

---

## 21. Multi-Module dan Java 8–25

Java version strategy mempengaruhi module design.

Contoh:

```text
:legacy-api           -> Java 8 baseline
:modern-impl          -> Java 21 baseline
:batch-runtime        -> Java 17 baseline
:experimental-tools   -> Java 25 baseline
```

Masalah:

- module Java 8 tidak boleh bergantung ke module Java 21;
- API yang harus dipakai legacy consumer harus tetap Java 8-compatible;
- annotation processor mungkin butuh JDK lebih baru;
- runtime module harus cocok dengan deployment JDK;
- MR-JAR bisa dipakai, tetapi complexity tinggi.

### 21.1 Dependency direction berdasarkan Java baseline

Aturan sehat:

```text
Lower baseline module must not depend on higher baseline module.
```

Contoh salah:

```text
:legacy-client-java8 -> :core-java21
```

Contoh benar:

```text
:core-api-java8
:core-impl-java21 -> :core-api-java8
```

Jadi contract tetap Java 8, implementation bisa modern.

---

## 22. Generated Code Module

Generated code sering membuat build graph kotor jika dicampur ke module utama.

Contoh codegen:

- OpenAPI client/server;
- JAXB;
- Protobuf/gRPC;
- jOOQ;
- QueryDSL;
- JPA metamodel;
- Avro;
- GraphQL.

Strategi sehat:

```text
:case-openapi-contract
:case-openapi-generated-client
:case-application
:case-rest-adapter
```

Generated module membantu:

- isolasi dependency generator;
- menghindari source utama tercampur generated code;
- mempermudah caching;
- mempermudah review perubahan contract;
- meminimalkan rebuild.

Risiko:

- terlalu banyak generated module kecil;
- generated code committed dan generated-on-build tidak konsisten;
- generator version tidak dipin;
- generated output tidak reproducible.

---

## 23. Persistence Module dan Database Boundary

Persistence module sering menjadi sumber coupling tersembunyi.

Contoh buruk:

```text
:domain -> :persistence-jpa
```

Domain sekarang tahu JPA.

Contoh lebih sehat:

```text
:domain
:application -> :domain
:persistence-jpa -> :application
:persistence-jpa -> :domain
```

Application mendefinisikan port:

```java
public interface CaseRepository {
    CaseRecord getRequired(CaseId id);
    void save(CaseRecord record);
}
```

Persistence adapter implement:

```java
public final class JpaCaseRepository implements CaseRepository {
    // EntityManager / Spring Data / Hibernate details
}
```

### 23.1 JPA entity: domain atau persistence?

Ada dua model:

1. JPA entity sebagai domain model.
2. JPA entity sebagai persistence model terpisah.

Model 1 lebih sederhana tetapi domain terikat JPA.

Model 2 lebih bersih tetapi butuh mapping.

Untuk sistem enterprise besar, pilih berdasarkan constraint:

- Jika domain rule kompleks dan harus testable tanpa JPA, pisahkan.
- Jika CRUD-heavy dan domain behavior tipis, JPA entity sebagai domain mungkin acceptable.
- Jika module dipakai lintas runtime/non-JPA, jangan bocorkan JPA ke API/domain.

---

## 24. Web Module dan API Boundary

Web module berisi boundary HTTP.

Isi yang cocok:

- controller/resource;
- request mapping;
- HTTP request/response DTO;
- authentication principal mapping;
- exception handler;
- OpenAPI annotation;
- validation adapter;
- serialization config.

Isi yang tidak cocok:

- domain rule inti;
- database query langsung;
- transaction orchestration berat;
- messaging detail;
- shared util untuk semua layer.

Contoh:

```text
:case-web
   -> :case-application
   -> :case-api
```

Controller harus tipis:

```java
@RestController
final class CaseController {
    private final ApproveCaseUseCase approveCaseUseCase;

    @PostMapping("/cases/{id}/approve")
    ResponseEntity<Void> approve(@PathVariable String id) {
        approveCaseUseCase.approve(new ApproveCaseCommand(id));
        return ResponseEntity.noContent().build();
    }
}
```

---

## 25. Messaging Module

Messaging module menghubungkan sistem ke event bus/message broker.

Contoh:

```text
:case-events
:case-messaging-publisher
:case-messaging-consumer
```

Pisahkan event contract dari broker implementation.

```text
:case-events
   contains CaseApprovedEvent

:rabbitmq-case-publisher
   depends on :case-events
   depends on RabbitMQ client
```

Keuntungan:

- event contract bisa dipakai consumer tanpa membawa RabbitMQ/Kafka dependency;
- broker bisa diganti lebih mudah;
- test contract lebih jelas;
- serialization compatibility bisa dikontrol.

---

## 26. Module untuk Observability

Observability sering bocor ke semua module.

Strategi sehat:

```text
:observability-api
:observability-micrometer-adapter
:observability-logback-adapter
```

Domain/application cukup tahu abstraction kecil:

```java
public interface AuditTrail {
    void record(AuditEvent event);
}
```

Adapter tahu Micrometer/Logback/OpenTelemetry.

Jangan membuat domain bergantung langsung ke OpenTelemetry SDK kecuali memang policy organisasi mengizinkan.

---

## 27. Module Ownership

Multi-module tanpa ownership akan menjadi distributed mess.

Untuk setiap module, tentukan:

```text
module: case-application
owner: Case Management Team
reviewer: case-platform-maintainers
java baseline: 17
published: no
allowed dependencies:
  - case-domain
  - case-api
  - shared-kernel
forbidden dependencies:
  - spring-web
  - servlet-api
  - aws-sdk
```

Ownership bisa dimasukkan ke:

- CODEOWNERS;
- module metadata file;
- build convention;
- architecture decision record;
- repository docs;
- CI check.

---

## 28. Multi-Module dan CI Impact

Module graph bisa mempercepat CI jika digunakan dengan benar.

### 28.1 Full build

```bash
mvn clean verify
./gradlew clean build
```

Full build penting untuk trust.

### 28.2 Affected module build

Maven:

```bash
mvn -pl :case-web -am verify
```

Gradle:

```bash
./gradlew :case-web:build
```

Tetapi affected build harus hati-hati:

- perubahan di parent/convention plugin mempengaruhi semua module;
- perubahan di BOM/platform mempengaruhi semua module;
- perubahan di shared kernel mempengaruhi banyak module;
- perubahan test fixture bisa mempengaruhi test banyak module;
- perubahan generated contract bisa mempengaruhi consumer.

### 28.3 CI strategy sehat

```text
PR pipeline:
  - affected compile/test
  - architecture checks
  - dependency checks
  - selected integration tests

Main pipeline:
  - full clean verify
  - full integration/security gates

Release pipeline:
  - clean environment
  - no local cache trust unless controlled
  - publish immutable artifact
```

---

## 29. Multi-Module dan Build Performance

Multi-module bisa mempercepat atau memperlambat build.

Mempercepat jika:

- dependency graph jelas;
- incremental build bekerja;
- module independen bisa parallel;
- heavy dependency diisolasi;
- test terdistribusi;
- changed module kecil.

Memperlambat jika:

- terlalu banyak module kecil;
- semua module bergantung ke `common`;
- root build script melakukan eager configuration;
- annotation processor berat ada di semua module;
- integration test ditempel di semua module;
- generated code selalu berubah;
- dependency resolution berulang.

### 29.1 Performance smell

```text
Every module depends on common.
Every module applies every plugin.
Every module has Spring Boot plugin.
Every module has annotation processors it does not need.
Every module runs integration tests.
Every module generates code.
```

Spring Boot plugin, container image plugin, codegen plugin, signing plugin, dan publishing plugin tidak perlu diterapkan ke semua module.

---

## 30. Maven Multi-Module Blueprint

Contoh struktur Maven enterprise modular monolith:

```text
case-platform/
  pom.xml                       # aggregator + parent if desired
  build-parent/
    pom.xml                     # corporate/project parent
  platform-bom/
    pom.xml                     # dependencyManagement BOM
  shared-kernel/
    pom.xml
  case-api/
    pom.xml
  case-domain/
    pom.xml
  case-application/
    pom.xml
  case-persistence-jpa/
    pom.xml
  case-rest-adapter/
    pom.xml
  case-messaging-adapter/
    pom.xml
  case-app-boot/
    pom.xml
```

Aggregator root:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>case-platform</artifactId>
  <version>${revision}</version>
  <packaging>pom</packaging>

  <modules>
    <module>platform-bom</module>
    <module>shared-kernel</module>
    <module>case-api</module>
    <module>case-domain</module>
    <module>case-application</module>
    <module>case-persistence-jpa</module>
    <module>case-rest-adapter</module>
    <module>case-messaging-adapter</module>
    <module>case-app-boot</module>
  </modules>
</project>
```

Application dependency:

```xml
<dependencies>
  <dependency>
    <groupId>com.example</groupId>
    <artifactId>case-domain</artifactId>
    <version>${project.version}</version>
  </dependency>
  <dependency>
    <groupId>com.example</groupId>
    <artifactId>case-api</artifactId>
    <version>${project.version}</version>
  </dependency>
</dependencies>
```

Use Maven Enforcer untuk menjaga convergence.

---

## 31. Gradle Multi-Project Blueprint

Contoh struktur Gradle:

```text
case-platform/
  settings.gradle.kts
  build.gradle.kts
  build-logic/
    convention-plugins/
  gradle/libs.versions.toml
  shared-kernel/
  case-api/
  case-domain/
  case-application/
  case-persistence-jpa/
  case-rest-adapter/
  case-messaging-adapter/
  case-app-boot/
```

`settings.gradle.kts`:

```kotlin
pluginManagement {
    includeBuild("build-logic")
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "case-platform"

include(
    "shared-kernel",
    "case-api",
    "case-domain",
    "case-application",
    "case-persistence-jpa",
    "case-rest-adapter",
    "case-messaging-adapter",
    "case-app-boot"
)
```

`case-application/build.gradle.kts`:

```kotlin
plugins {
    id("com.example.java-library-conventions")
}

dependencies {
    api(project(":case-api"))
    implementation(project(":case-domain"))
    implementation(project(":shared-kernel"))

    testImplementation(libs.junit.jupiter)
}
```

`case-app-boot/build.gradle.kts`:

```kotlin
plugins {
    id("com.example.spring-boot-application-conventions")
}

dependencies {
    implementation(project(":case-rest-adapter"))
    implementation(project(":case-persistence-jpa"))
    implementation(project(":case-messaging-adapter"))
}
```

---

## 32. Module Metadata File

Untuk sistem besar, build script saja kadang tidak cukup. Tambahkan metadata module.

Contoh `module.yaml`:

```yaml
name: case-domain
owner: case-management-team
kind: domain
javaBaseline: 17
published: false
allowedDependencies:
  - shared-kernel
forbiddenGroups:
  - org.springframework
  - jakarta.servlet
  - software.amazon.awssdk
```

Custom Maven/Gradle plugin bisa membaca metadata ini dan enforce policy.

Keuntungan:

- policy explicit;
- review lebih mudah;
- onboarding lebih cepat;
- governance bisa otomatis;
- module graph bisa divisualisasikan.

---

## 33. Visualisasi Module Graph

Untuk sistem besar, visualisasi membantu.

Contoh graph sehat:

```text
                      +----------------+
                      |  shared-kernel |
                      +----------------+
                              ^
                              |
+----------+          +---------------+          +----------------+
| case-api | <------- | case-domain   | <------- | case-application |
+----------+          +---------------+          +----------------+
       ^                                            ^       ^
       |                                            |       |
+-------------+                              +-------------+-------------+
| rest-adapter|                              | persistence | messaging   |
+-------------+                              +-------------+-------------+
       ^                                            ^       ^
       +--------------------+-----------------------+-------+
                            |
                      +------------+
                      | app-boot   |
                      +------------+
```

Graph tidak harus sempurna, tetapi harus punya arah.

Graph buruk:

```text
common <--- everything
  |
  v
spring-web, jpa, aws-sdk, jackson, rabbitmq, servlet, security
```

Jika semua module bergantung ke common, graph tidak lagi memberi informasi arsitektural.

---

## 34. Binary Compatibility dan Module API

Jika module dipublish atau dipakai banyak module, compatibility penting.

Perubahan API yang breaking:

- menghapus public class;
- mengubah method signature;
- mengubah return type;
- mengubah checked exception;
- mengubah semantic behavior;
- mengubah field serializable;
- menaikkan Java baseline;
- mengganti dependency type di public API.

Gunakan tools:

- Revapi;
- japicmp;
- Gradle binary compatibility validator untuk Kotlin/JVM jika relevan;
- semantic versioning policy;
- deprecation strategy.

Internal module tidak selalu perlu strict binary compatibility, tetapi API module yang dipublish perlu.

---

## 35. Module dan JPMS

Java Platform Module System memperkenalkan `module-info.java`.

Contoh:

```java
module com.example.case.domain {
    exports com.example.case.domain;
}
```

JPMS bisa membantu strong encapsulation, tetapi banyak enterprise Java project tetap memakai classpath karena:

- framework reflection;
- annotation processing;
- legacy dependencies;
- Jakarta/Spring ecosystem constraints;
- migration cost.

Prinsip penting:

Build module Maven/Gradle tidak sama dengan JPMS module.

```text
Maven/Gradle module = build/project/artifact boundary.
JPMS module = Java runtime/compile-time module boundary.
```

Keduanya bisa aligned, tetapi tidak wajib.

Untuk Java 8 compatibility, JPMS tidak tersedia. Jika target mendukung Java 8–25, jangan memaksa seluruh codebase ke JPMS kecuali ada strategy jelas.

---

## 36. Multi-Module Migration Strategy

Memecah sistem besar harus bertahap.

### 36.1 Jangan big bang

Big bang refactor biasanya gagal karena:

- terlalu banyak file bergerak;
- test tidak cukup;
- dependency graph belum dipahami;
- ownership belum siap;
- CI belum siap;
- developer bingung.

### 36.2 Langkah migration sehat

1. Inventory package dan dependency.
2. Generate dependency graph awal.
3. Identifikasi domain/API/adapter boundary.
4. Pisahkan module paling aman dulu.
5. Buat shared kernel kecil jika perlu.
6. Pindahkan test bersama code.
7. Enforce dependency rule minimal.
8. Ubah CI untuk build affected module.
9. Monitor build time dan failure rate.
10. Ulangi per bounded context.

### 36.3 Urutan extraction yang aman

Biasanya mulai dari:

```text
1. shared-kernel kecil
2. API/contract module
3. domain module
4. application module
5. adapter module
6. boot/runtime module
```

Jangan mulai dari memecah persistence jika domain masih bercampur controller/service.

---

## 37. Case Study: Modular Case Management Platform

Bayangkan sistem case management enterprise:

- application intake;
- case lifecycle;
- compliance inspection;
- enforcement action;
- correspondence;
- document management;
- payment/revenue;
- user/profile;
- notification;
- audit trail;
- reporting.

Struktur naïve:

```text
:app
:common
```

Masalah:

- semua rule bercampur;
- semua dependency bocor;
- audit/reporting bisa akses semua entity;
- test lambat;
- perubahan kecil memicu full regression;
- tidak jelas owner module.

Struktur lebih sehat:

```text
:shared-kernel
:audit-api
:audit-application
:audit-persistence

:case-api
:case-domain
:case-application
:case-persistence
:case-rest
:case-events

:correspondence-api
:correspondence-domain
:correspondence-application
:correspondence-email-adapter

:document-api
:document-application
:document-storage-adapter

:reporting-api
:reporting-application
:reporting-persistence-readmodel

:app-boot
```

Dependency direction:

```text
:app-boot -> all adapters/app modules
:case-rest -> :case-application
:case-application -> :case-domain, :case-api, :audit-api
:case-persistence -> :case-application, :case-domain
:correspondence-email-adapter -> :correspondence-application
:reporting-application -> read model contracts, not every persistence implementation
```

Policy:

```text
Domain modules: no Spring Web, no Servlet, no AWS SDK, no database clients.
API modules: no implementation framework leakage.
Adapter modules: framework-specific allowed.
Boot module: composition root only.
```

---

## 38. Anti-Pattern Catalog

### 38.1 God common module

Semua hal masuk common. Semua module bergantung common. Common bergantung semua library.

Perbaikan:

- pecah common berdasarkan semantic boundary;
- audit dependency common;
- pindahkan framework-specific helper ke adapter-specific support;
- buat shared kernel kecil.

### 38.2 Domain depends on infrastructure

Domain import JPA repository, Spring service, HTTP client, atau messaging template.

Perbaikan:

- introduce port;
- pindahkan implementation ke adapter;
- domain hanya tahu abstraction/event.

### 38.3 API module leaks implementation dependency

Public API memakai framework type.

Perbaikan:

- ganti dengan domain-specific DTO/value object;
- pindahkan serialization/framework detail ke adapter;
- gunakan Gradle `api`/`implementation` dengan disiplin.

### 38.4 Every module applies every plugin

Semua module punya Spring Boot plugin, publishing plugin, codegen plugin, signing plugin.

Perbaikan:

- gunakan convention plugin per module type;
- apply plugin hanya di module relevan.

### 38.5 Cyclic module dependency

Dua module saling butuh.

Perbaikan:

- extract contract;
- invert dependency;
- event-based interaction;
- shared kernel kecil.

### 38.6 Test fixture as production dependency

Test helper masuk runtime.

Perbaikan:

- pisahkan test fixture;
- gunakan test scope/configuration;
- audit dependency tree.

### 38.7 Multi-module without ownership

Module banyak tetapi tidak ada owner.

Perbaikan:

- CODEOWNERS;
- module metadata;
- review policy;
- architecture governance.

---

## 39. Review Checklist untuk Multi-Module Architecture

Gunakan checklist ini saat review repository besar.

### 39.1 Boundary

- [ ] Apakah setiap module punya tanggung jawab jelas?
- [ ] Apakah setiap module punya consumer jelas?
- [ ] Apakah module hanya dibuat karena folder terlalu besar?
- [ ] Apakah module punya API publik yang jelas?
- [ ] Apakah implementation detail tidak bocor?

### 39.2 Dependency direction

- [ ] Apakah graph punya arah?
- [ ] Apakah ada cyclic dependency?
- [ ] Apakah domain bebas dari infrastructure?
- [ ] Apakah web/adapter tidak dipakai oleh inner layer?
- [ ] Apakah shared kernel kecil dan stabil?

### 39.3 Build health

- [ ] Apakah module bisa dites sendiri?
- [ ] Apakah heavy plugin hanya diterapkan di module relevan?
- [ ] Apakah affected build bisa dipercaya?
- [ ] Apakah dependency graph dipakai untuk CI optimization?
- [ ] Apakah build parallel/incremental bekerja?

### 39.4 Dependency hygiene

- [ ] Apakah API module bebas dari dependency berat?
- [ ] Apakah test fixture tidak bocor ke runtime?
- [ ] Apakah common module tidak menjadi dumping ground?
- [ ] Apakah Java baseline antar module konsisten?
- [ ] Apakah generated code diisolasi?

### 39.5 Governance

- [ ] Apakah module punya owner?
- [ ] Apakah module punya allowed/forbidden dependency policy?
- [ ] Apakah exception/waiver tercatat?
- [ ] Apakah architecture rules dijalankan di CI?
- [ ] Apakah module graph divisualisasikan secara periodik?

---

## 40. Prinsip Senior: Module Graph Harus Menceritakan Arsitektur

Top 1% engineer tidak melihat multi-module sebagai konfigurasi build saja.

Mereka melihat module graph sebagai:

- dependency map;
- ownership map;
- risk map;
- test impact map;
- release impact map;
- coupling map;
- migration map;
- organizational communication map.

Jika graph module tidak membantu menjawab “bagian mana yang terdampak jika saya mengubah X?”, maka graph belum cukup baik.

Jika semua module bergantung ke common, graph kehilangan makna.

Jika API module membawa implementation dependency, boundary bocor.

Jika domain module tahu database/web/messaging, arsitektur terbalik.

Jika module terlalu kecil tanpa semantic boundary, build menjadi ceremony.

Jika module terlalu besar, build tidak membantu mengontrol kompleksitas.

Multi-module architecture yang baik adalah titik tengah: cukup granular untuk memberi boundary, cukup sederhana untuk tetap produktif.

---

## 41. Ringkasan

Multi-module architecture untuk sistem Java besar adalah seni mengubah kompleksitas menjadi graph yang bisa dipahami dan dikontrol.

Poin utama:

1. Module adalah boundary, bukan folder.
2. Dependency direction adalah ekspresi arsitektur.
3. Maven reactor dan Gradle multi-project sama-sama bisa memodelkan sistem besar, tetapi dengan gaya berbeda.
4. Domain/API/application/adapter/runtime/test-fixture module harus dipisah berdasarkan tanggung jawab.
5. `common` module harus dijaga sangat ketat atau dipecah.
6. Cyclic dependency harus dianggap architecture failure, bukan sekadar build annoyance.
7. API leakage menciptakan coupling jangka panjang.
8. Java baseline antar module harus dirancang, terutama untuk Java 8–25.
9. Build system harus membantu enforce architecture rules.
10. Module graph yang sehat mempercepat CI, debugging, migration, dan onboarding.

---

## 42. Latihan Praktis

### Latihan 1 — Audit common module

Ambil project besar yang punya `common`, `shared`, atau `utils`.

Klasifikasikan isi menjadi:

```text
shared-kernel
json-support
time-support
security-api
security-adapter
persistence-support
test-fixtures
module-specific helper
should not be shared
```

Output:

- daftar class yang tetap shared;
- daftar class yang harus dipindah;
- dependency yang harus dihapus dari common;
- risiko migration.

### Latihan 2 — Gambar module graph

Gambar graph module saat ini.

Tandai:

```text
red: dependency melawan arah arsitektur
yellow: dependency mencurigakan
green: dependency sehat
```

Cari:

- cycle;
- god module;
- framework leakage;
- test fixture leakage;
- Java baseline mismatch.

### Latihan 3 — Desain modular monolith

Untuk sistem case management, desain module:

```text
case
inspection
enforcement
correspondence
document
audit
reporting
notification
```

Untuk setiap bounded context, tentukan:

- domain module;
- API module;
- application module;
- adapter module;
- persistence module;
- event module;
- owner;
- allowed dependencies;
- forbidden dependencies.

### Latihan 4 — Enforce rule

Buat rule:

```text
Any module ending with -domain must not depend on Spring, Servlet, JPA, AWS SDK, RabbitMQ, Kafka.
```

Implementasikan dengan salah satu:

- Maven Enforcer/custom plugin;
- Gradle convention plugin;
- ArchUnit test;
- CI script awal.

---

## 43. Koneksi ke Part Berikutnya

Part ini membahas struktur module besar sebagai arsitektur. Bagian berikutnya akan masuk ke integrasi build dengan ekosistem enterprise Java:

```text
Part 23 — Jakarta/Spring/Enterprise Java Build Integration
```

Di sana kita akan membahas bagaimana Maven/Gradle mengintegrasikan Spring Boot, Jakarta EE, WAR, provided scope, JPA metamodel, OpenAPI, Keycloak SPI packaging, Flyway/Liquibase, jOOQ, dan enterprise runtime tanpa mengotori module boundary yang sudah dirancang di Part 22.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — Enterprise Governance: Corporate Parent POM, Convention Plugin, Policy-as-Build](./21-enterprise-governance.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — Jakarta/Spring/Enterprise Java Build Integration](./23-jakarta-spring-enterprise-java-build-integration.md)
