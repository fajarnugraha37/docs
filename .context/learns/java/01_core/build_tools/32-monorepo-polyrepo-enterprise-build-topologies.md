# Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `32-monorepo-polyrepo-enterprise-build-topologies.md`  
> Scope: Java 8–25, Maven, Gradle, enterprise repository/build architecture  
> Level: Advanced / Staff+ / Platform Engineering

---

## 1. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membahas build dari sisi:

- mental model build;
- Maven dan Gradle core;
- dependency graph;
- repository;
- reproducibility;
- compiler;
- testing;
- packaging;
- plugin;
- performance;
- CI/CD;
- release;
- security;
- governance;
- multi-module architecture;
- observability.

Bagian ini naik satu level lagi: **bagaimana seluruh source code organisasi disusun dan dioperasikan sebagai sistem build enterprise**.

Pertanyaan intinya bukan lagi:

> “Bagaimana menjalankan `mvn test` atau `gradle build`?”

Melainkan:

> “Bagaimana kita mendesain topologi repository dan build agar ratusan module/service/library bisa dikembangkan, diuji, dirilis, diamankan, dan dimigrasikan tanpa membuat organisasi tersangkut di complexity hell?”

Topologi repository adalah keputusan arsitektural. Ia memengaruhi:

- dependency ownership;
- release cadence;
- CI cost;
- developer experience;
- security governance;
- blast radius perubahan;
- build time;
- rollback;
- library reuse;
- compliance evidence;
- onboarding;
- incident recovery;
- long-term maintainability.

Engineer top 1% tidak hanya bertanya “pakai monorepo atau polyrepo?”.  
Mereka bertanya:

> “Apa unit perubahan kita? Apa unit ownership kita? Apa unit release kita? Apa unit risiko kita? Apakah topologi repository kita memperjelas atau mengaburkan batas-batas itu?”

---

## 2. Istilah Dasar

Sebelum masuk ke trade-off, kita definisikan dulu istilah dengan presisi.

### 2.1 Single Repository Single Module

Satu repository, satu build module.

Contoh:

```text
customer-service/
├── pom.xml
└── src/
```

Atau:

```text
customer-service/
├── build.gradle.kts
├── settings.gradle.kts
└── src/
```

Cocok untuk:

- aplikasi kecil;
- service independen;
- library kecil;
- proof of concept;
- project awal.

Batasannya:

- sulit berbagi build logic jika jumlah repo banyak;
- dependency antar repo lewat artifact repository;
- perubahan lintas service butuh koordinasi eksternal;
- standar build mudah drift.

---

### 2.2 Single Repository Multi-Module

Satu repository, banyak module.

Maven:

```text
platform/
├── pom.xml
├── domain/
│   └── pom.xml
├── application/
│   └── pom.xml
├── infrastructure/
│   └── pom.xml
└── web/
    └── pom.xml
```

Gradle:

```text
platform/
├── settings.gradle.kts
├── build.gradle.kts
├── domain/
│   └── build.gradle.kts
├── application/
│   └── build.gradle.kts
├── infrastructure/
│   └── build.gradle.kts
└── web/
    └── build.gradle.kts
```

Cocok untuk:

- satu aplikasi besar;
- modular monolith;
- platform service dengan beberapa module;
- library family;
- codebase yang butuh compile-time boundary internal.

---

### 2.3 Monorepo

Monorepo adalah satu repository besar yang menampung banyak project, service, library, tools, dan build logic.

Contoh:

```text
enterprise-platform/
├── build-logic/
├── libs/
│   ├── audit-core/
│   ├── security-common/
│   └── persistence-utils/
├── services/
│   ├── case-service/
│   ├── notification-service/
│   └── payment-service/
├── apps/
│   ├── admin-web/
│   └── public-api/
├── contracts/
│   ├── openapi/
│   └── protobuf/
├── deployment/
│   ├── helm/
│   └── k8s/
└── docs/
```

Monorepo bukan sekadar “satu repo besar”. Monorepo yang sehat biasanya punya:

- ownership boundary;
- affected build logic;
- incremental CI;
- central dependency governance;
- consistent tooling;
- scalable checkout strategy;
- code search;
- automated dependency graph analysis;
- strong review rules.

Tanpa itu, monorepo berubah menjadi “big ball of code”.

---

### 2.4 Polyrepo

Polyrepo berarti banyak repository, biasanya satu repo per service/library/team.

Contoh:

```text
repo: customer-service
repo: order-service
repo: payment-service
repo: audit-library
repo: java-platform-bom
repo: build-conventions
repo: deployment-config
```

Polyrepo cocok ketika:

- service benar-benar independently deployable;
- team ownership jelas;
- release cadence berbeda;
- organisasi ingin blast radius kecil;
- setiap service punya siklus hidup berbeda;
- compliance mengharuskan isolation tertentu.

Batasannya:

- dependency drift;
- duplicated build logic;
- cross-repo change sulit;
- governance perlu mekanisme eksternal;
- CI/CD standardization tidak otomatis.

---

### 2.5 Multi-Repo dengan Shared Platform

Ini variasi polyrepo yang lebih matang.

Banyak repo tetap dipertahankan, tetapi distandarkan lewat:

- corporate parent POM;
- corporate BOM;
- Gradle convention plugin;
- Gradle version catalog;
- shared CI template;
- shared release workflow;
- central artifact repository;
- policy-as-build.

Contoh:

```text
repo: enterprise-java-parent
repo: enterprise-java-bom
repo: enterprise-gradle-conventions
repo: customer-service
repo: order-service
repo: payment-service
repo: notification-service
```

Ini adalah pola umum enterprise: repo tetap terpisah, tapi build policy dibuat terpusat.

---

### 2.6 Hybrid Topology

Banyak organisasi besar berakhir di hybrid:

- satu monorepo untuk product/platform tertentu;
- banyak polyrepo untuk service independen;
- repo terpisah untuk deployment/IaC;
- shared build platform repository;
- shared contract repository.

Contoh:

```text
monorepo: core-regulatory-platform
repo: public-portal-service
repo: integration-adapter-service
repo: enterprise-java-bom
repo: enterprise-build-conventions
repo: deployment-config
repo: data-migration-tools
```

Hybrid sering lebih realistis daripada memaksakan “semua harus monorepo” atau “semua harus polyrepo”.

---

## 3. Pertanyaan Arsitektural yang Benar

Kesalahan umum adalah memulai dari preferensi tool:

> “Kita mau monorepo karena Google pakai monorepo.”  
> “Kita mau polyrepo karena microservices harus repo terpisah.”  
> “Kita mau Gradle karena monorepo.”  
> “Kita mau Maven karena enterprise.”

Cara berpikir yang lebih matang:

### 3.1 Apa Unit Ownership?

Apakah ownership per:

- service?
- bounded context?
- product?
- team?
- module?
- library?
- platform capability?

Jika satu tim memiliki semua module yang sering berubah bersama, memecahnya menjadi banyak repo bisa menambah friction.

Jika banyak tim memiliki service yang berbeda dan perubahan jarang lintas service, monorepo bisa memperbesar noise.

---

### 3.2 Apa Unit Change?

Apa yang biasanya berubah bersama?

Contoh perubahan yang sering lintas module:

- upgrade Java baseline;
- upgrade Spring Boot;
- migrasi javax ke jakarta;
- perubahan common error model;
- perubahan audit logging;
- perubahan auth library;
- perubahan OpenAPI contract;
- perubahan build plugin;
- vulnerability remediation.

Jika perubahan lintas repo sangat sering, polyrepo tanpa automation akan mahal.

Jika perubahan jarang lintas service, monorepo mungkin tidak memberi benefit besar.

---

### 3.3 Apa Unit Release?

Apakah release dilakukan:

- seluruh platform sekaligus?
- per service?
- per library?
- per bounded context?
- per module internal?
- per customer/tenant?
- per deployment zone?

Monorepo tidak harus berarti single release. Polyrepo tidak otomatis berarti independent release. Yang menentukan adalah pipeline, artifact strategy, dependency versioning, dan deployment model.

---

### 3.4 Apa Unit Risk?

Jika perubahan di module A bisa merusak module B, maka build topology harus membuat hubungan itu terlihat.

Risk unit bisa berupa:

- runtime dependency;
- compile-time dependency;
- contract dependency;
- database schema dependency;
- deployment dependency;
- security policy dependency;
- shared library dependency;
- infrastructure dependency.

Topologi yang sehat membuat risk graph eksplisit.

---

### 3.5 Apa Unit Compliance Evidence?

Dalam enterprise/regulatory environment, build bukan hanya alat engineering. Build juga evidence.

Kita perlu menjawab:

- artifact ini dibangun dari commit mana?
- dependency versi apa saja yang masuk?
- siapa approve release?
- quality gate apa yang lewat?
- vulnerability apa yang diketahui?
- waiver apa yang berlaku?
- Java version apa yang digunakan?
- artifact dipromosikan dari stage mana?
- apakah artifact yang diuji sama dengan artifact yang dirilis?

Topologi repository memengaruhi seberapa mudah evidence itu dikumpulkan.

---

## 4. Monorepo: Mental Model

Monorepo yang sehat adalah **shared source graph dengan governance yang kuat**.

Kekuatan utama monorepo:

> Semua code yang saling terkait bisa berevolusi bersama dalam satu atomic change.

Misalnya:

- ubah interface library;
- update semua consumer;
- jalankan affected tests;
- merge sekali;
- tidak perlu publish intermediate SNAPSHOT;
- tidak perlu cross-repo branch choreography.

Namun monorepo hanya sehat jika ada:

- scalable build graph;
- affected project detection;
- ownership rules;
- review boundaries;
- CI partitioning;
- dependency direction enforcement;
- good local developer experience.

Tanpa itu, monorepo berubah menjadi:

- build sangat lama;
- PR noise tinggi;
- coupling meningkat;
- semua orang bisa mengubah semua hal;
- release coordination makin sulit;
- CI bottleneck;
- merge conflict tinggi.

---

## 5. Polyrepo: Mental Model

Polyrepo yang sehat adalah **distributed ownership dengan contract-based integration**.

Kekuatan utama polyrepo:

> Setiap service/library bisa memiliki lifecycle, ownership, pipeline, dan release cadence sendiri.

Ini cocok untuk:

- microservices yang benar-benar independen;
- team autonomy;
- service dengan runtime/deployment berbeda;
- compliance boundary;
- blast radius control;
- project lifecycle berbeda.

Namun polyrepo hanya sehat jika ada:

- version governance;
- contract testing;
- dependency update automation;
- shared build conventions;
- artifact repository discipline;
- release compatibility policy;
- observability lintas repo.

Tanpa itu, polyrepo berubah menjadi:

- duplicated build scripts;
- dependency drift;
- inconsistent Java baseline;
- inconsistent security scanning;
- cross-repo integration hell;
- library version chaos;
- “works in service A, fails in service B”.

---

## 6. Monorepo vs Polyrepo: Comparison Matrix

| Dimension | Monorepo | Polyrepo |
|---|---|---|
| Cross-cutting change | Mudah secara atomic | Sulit tanpa automation |
| Team autonomy | Perlu ownership tooling | Natural per repo |
| Build speed | Perlu affected build | Kecil per repo, tapi total bisa besar |
| Dependency consistency | Lebih mudah disentralisasi | Perlu BOM/platform/version catalog |
| Release independence | Bisa, tapi perlu pipeline pintar | Natural jika service independen |
| CI complexity | Tinggi di repo besar | Terdistribusi tapi banyak pipeline |
| Onboarding | Satu tempat, tapi besar | Banyak repo, butuh discovery |
| Code search | Sangat baik | Butuh tooling lintas repo |
| Access control | Lebih sulit granular | Natural per repo |
| Governance | Centralized | Federated |
| Migration | Atomic jika build scalable | Butuh rollout lintas repo |
| Blast radius | Bisa besar jika boundary lemah | Lebih kecil per repo |
| Coupling risk | Mudah terjadi implicit coupling | Contract drift risk |
| Tooling requirement | Tinggi | Sedang-tinggi tergantung scale |

Kesimpulan penting:

> Monorepo memindahkan kompleksitas ke build graph dan ownership control. Polyrepo memindahkan kompleksitas ke dependency/version/release coordination.

Tidak ada pilihan gratis.

---

## 7. Maven dalam Monorepo

Maven bisa dipakai untuk monorepo, tetapi ada batas praktis.

### 7.1 Struktur Sederhana

```text
enterprise-platform/
├── pom.xml
├── libs/
│   ├── audit-core/pom.xml
│   └── security-common/pom.xml
├── services/
│   ├── case-service/pom.xml
│   └── notification-service/pom.xml
└── tools/
    └── migration-tool/pom.xml
```

Root `pom.xml`:

```xml
<project>
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.acme.platform</groupId>
  <artifactId>enterprise-platform</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>pom</packaging>

  <modules>
    <module>libs/audit-core</module>
    <module>libs/security-common</module>
    <module>services/case-service</module>
    <module>services/notification-service</module>
    <module>tools/migration-tool</module>
  </modules>
</project>
```

Maven reactor akan mengurutkan module berdasarkan dependency antar module.

### 7.2 Selective Build dengan Maven

Maven menyediakan opsi:

```bash
mvn -pl services/case-service -am test
```

Artinya:

- build selected project;
- also make required upstream modules.

Opsi lain:

```bash
mvn -pl libs/audit-core -amd test
```

Artinya:

- build selected project;
- also make downstream modules yang bergantung kepadanya.

Ini berguna untuk affected build sederhana.

### 7.3 Batas Maven untuk Monorepo Besar

Maven memiliki lifecycle standar dan reactor yang predictable, tetapi:

- tidak sefleksibel Gradle dalam graph modeling;
- affected build kompleks perlu scripting eksternal;
- module discovery manual via `<modules>`;
- incremental build terbatas dibanding Gradle;
- remote build cache bukan konsep core Maven;
- partial build besar bisa butuh tooling tambahan.

Maven monorepo cocok jika:

- module count masih terkendali;
- lifecycle relatif seragam;
- build governance lebih penting daripada custom graph;
- team sudah kuat di Maven;
- CI bisa dipartisi dengan `-pl/-am/-amd`.

---

## 8. Gradle dalam Monorepo

Gradle kuat untuk monorepo karena build-nya graph-based dan punya konsep:

- multi-project build;
- composite build;
- configuration avoidance;
- build cache;
- configuration cache;
- included builds;
- dependency substitution;
- convention plugins;
- task graph introspection.

### 8.1 Struktur Sederhana

```text
enterprise-platform/
├── settings.gradle.kts
├── build.gradle.kts
├── build-logic/
├── libs/
│   ├── audit-core/
│   └── security-common/
└── services/
    ├── case-service/
    └── notification-service/
```

`settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://repo.company.internal/plugins")
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.internal/maven")
        mavenCentral()
    }
}

rootProject.name = "enterprise-platform"

include(":libs:audit-core")
include(":libs:security-common")
include(":services:case-service")
include(":services:notification-service")
```

### 8.2 Convention Plugin

Untuk monorepo Gradle, jangan copy-paste konfigurasi ke semua subproject.

Gunakan convention plugin:

```text
build-logic/
└── src/main/kotlin/
    ├── acme.java-library-conventions.gradle.kts
    ├── acme.spring-boot-service-conventions.gradle.kts
    └── acme.quality-conventions.gradle.kts
```

Contoh module:

```kotlin
plugins {
    id("acme.spring-boot-service-conventions")
}

dependencies {
    implementation(project(":libs:audit-core"))
}
```

Mental model:

> Build root mengatur policy. Module menyatakan intent.

### 8.3 Composite Build

Gradle composite build berguna ketika:

- ingin mengembangkan library dan service secara bersamaan;
- library berada di repo berbeda;
- tidak ingin publish SNAPSHOT dulu;
- ingin dependency substitution lokal.

Contoh:

```kotlin
// settings.gradle.kts
includeBuild("../enterprise-build-logic")
includeBuild("../audit-library")
```

Jika service bergantung pada artifact `com.acme:audit-library`, Gradle bisa menggantinya dengan source build lokal.

Ini sangat kuat untuk hybrid topology.

---

## 9. Shared Build Logic dalam Polyrepo

Polyrepo tidak berarti setiap repo menulis build dari nol.

Ada beberapa pola.

### 9.1 Maven Corporate Parent POM

Repo:

```text
enterprise-java-parent/
└── pom.xml
```

Service:

```xml
<parent>
  <groupId>com.acme.build</groupId>
  <artifactId>enterprise-java-parent</artifactId>
  <version>3.4.0</version>
</parent>
```

Parent mengatur:

- plugin versions;
- Java baseline;
- Maven Enforcer rules;
- compiler config;
- Surefire/Failsafe;
- JaCoCo;
- Checkstyle;
- repositories;
- distribution management.

Kelebihan:

- mudah dipakai;
- natural di Maven;
- centralized governance.

Risiko:

- inheritance terlalu berat;
- parent jadi “god parent”;
- perubahan parent bisa merusak banyak repo;
- sulit punya variasi policy jika parent terlalu kaku.

---

### 9.2 Maven Corporate BOM

Repo:

```text
enterprise-java-bom/
└── pom.xml
```

Service:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme.platform</groupId>
      <artifactId>enterprise-java-bom</artifactId>
      <version>5.2.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

BOM mengatur dependency versions, bukan plugin behavior.

Pola matang:

- parent POM untuk build policy;
- BOM untuk dependency alignment;
- service memilih parent + BOM.

Namun, untuk library publik/internal, sering lebih sehat memakai BOM tanpa parent agar consumer tidak dipaksa mewarisi build.

---

### 9.3 Gradle Convention Plugin Repository

Repo:

```text
enterprise-gradle-conventions/
├── settings.gradle.kts
├── build.gradle.kts
└── src/main/kotlin/
    ├── acme.java-library.gradle.kts
    ├── acme.spring-service.gradle.kts
    └── acme.quality.gradle.kts
```

Service:

```kotlin
plugins {
    id("com.acme.spring-service") version "4.1.0"
}
```

Kelebihan:

- policy bisa dikodekan;
- task bisa dibuat reusable;
- lebih fleksibel daripada copy-paste script;
- bisa diuji dengan Gradle TestKit;
- cocok untuk banyak repo.

Risiko:

- plugin compatibility harus dijaga;
- plugin bisa terlalu ajaib;
- upgrade plugin perlu changelog dan migration guide;
- configuration cache compatibility perlu disiplin.

---

### 9.4 Shared CI Template

Polyrepo butuh standardisasi CI.

Contoh abstrak:

```yaml
stages:
  - validate
  - compile
  - test
  - package
  - scan
  - publish
```

Shared CI template mengatur:

- JDK setup;
- Maven/Gradle wrapper validation;
- cache policy;
- test report upload;
- coverage upload;
- SBOM generation;
- vulnerability scanning;
- artifact publish;
- release tagging.

Tanpa shared CI template, governance akan drift walaupun parent/BOM sudah ada.

---

## 10. Dependency Governance dalam Topologi Berbeda

### 10.1 Monorepo

Dependency bisa distandarkan di satu tempat:

Gradle:

```text
gradle/libs.versions.toml
```

Maven:

```text
platform-bom/pom.xml
```

Kelebihan:

- upgrade dependency bisa atomic;
- semua module bisa dites bersama;
- konflik terlihat lebih cepat.

Risiko:

- satu upgrade bisa memaksa banyak module;
- module lama bisa menghambat modernisasi;
- dependency policy terlalu global.

### 10.2 Polyrepo

Dependency distandarkan lewat shared artifact:

- corporate BOM;
- Gradle platform;
- version catalog artifact;
- parent POM;
- convention plugin.

Kelebihan:

- tiap service bisa upgrade bertahap;
- blast radius kecil;
- service lama tidak menahan semua service.

Risiko:

- version drift;
- inconsistent vulnerability posture;
- upgrade rollout lama;
- dependency conflict muncul berbeda di setiap repo.

### 10.3 Hybrid

Hybrid biasanya memakai:

- monorepo untuk tightly-coupled platform;
- shared BOM/platform untuk semua repo;
- automated dependency update bot;
- security dashboard lintas repo.

---

## 11. Release Topology

Repository topology harus konsisten dengan release topology.

### 11.1 Monorepo Single Release

Semua module dirilis bersama.

Cocok untuk:

- modular monolith;
- tightly-coupled platform;
- shared deployment unit;
- regulated release train.

Kelebihan:

- versioning sederhana;
- compatibility antar module mudah;
- release evidence terkonsolidasi.

Kekurangan:

- release besar;
- module kecil ikut release walau tidak berubah;
- bottleneck approval.

---

### 11.2 Monorepo Independent Release

Satu repo, tetapi service/library dirilis independen.

Cocok untuk:

- monorepo microservices;
- banyak service dalam satu product;
- shared tooling kuat.

Butuh:

- affected release detection;
- per-service versioning;
- per-service changelog;
- per-service artifact publish;
- per-service deployment pipeline;
- ownership metadata.

Contoh metadata:

```yaml
services:
  case-service:
    path: services/case-service
    owners:
      - team-case
    deployable: true
    javaBaseline: 21
  notification-service:
    path: services/notification-service
    owners:
      - team-platform
    deployable: true
    javaBaseline: 17
```

---

### 11.3 Polyrepo Independent Release

Setiap repo punya release sendiri.

Kelebihan:

- autonomy tinggi;
- release kecil;
- rollback jelas per service;
- lifecycle berbeda mudah.

Risiko:

- shared library upgrade lambat;
- contract compatibility krusial;
- dependency version drift.

---

### 11.4 Release Train

Release train berarti beberapa repo/module dirilis dalam jadwal tetap.

Cocok untuk:

- enterprise/regulatory release;
- banyak approval;
- UAT cycle formal;
- perubahan lintas domain.

Risiko:

- lead time besar;
- emergency fix sulit jika train terlalu kaku;
- banyak perubahan digabung sehingga root cause incident sulit.

Top 1% engineer akan membedakan:

- release train untuk compliance/coordination;
- hotfix lane untuk incident;
- library/platform cadence untuk dependency hygiene;
- app/service cadence untuk product delivery.

---

## 12. Affected Build dan Affected Test

Di repo besar, tidak semua perubahan harus membangun semua module.

Affected build menjawab:

> “Perubahan ini memengaruhi module mana saja?”

### 12.1 Input Affected Analysis

Input yang perlu dianalisis:

- changed files;
- module ownership;
- dependency graph;
- test graph;
- generated code relation;
- runtime contract relation;
- build logic changes;
- shared config changes;
- parent/BOM/version catalog changes.

### 12.2 Simple Rule

Jika file berubah di:

```text
libs/audit-core/
```

Maka affected:

- `libs/audit-core`;
- semua downstream module yang bergantung pada `audit-core`;
- tests dari downstream yang relevan.

Jika file berubah di:

```text
build-logic/
```

Maka affected bisa seluruh repo.

Jika file berubah di:

```text
gradle/libs.versions.toml
```

Maka affected bisa seluruh dependency graph.

Jika file berubah di:

```text
contracts/openapi/case.yaml
```

Maka affected:

- generated client/server module;
- provider contract tests;
- consumer contract tests;
- API documentation artifact;
- service yang memakai contract tersebut.

### 12.3 Maven Affected Build Sederhana

Maven:

```bash
mvn -pl libs/audit-core -amd test
```

Namun ini hanya bekerja jika affected module sudah diketahui.

Untuk skala besar, sering butuh script yang:

1. membaca changed files;
2. memetakan path ke module;
3. menjalankan `mvn -pl ... -am/-amd`.

### 12.4 Gradle Affected Build

Gradle bisa menjalankan task spesifik:

```bash
./gradlew :services:case-service:test
```

Dengan build cache dan task graph, Gradle bisa menghindari task yang tidak berubah. Namun affected selection tetap perlu policy:

- berdasarkan changed paths;
- berdasarkan project dependency graph;
- berdasarkan ownership metadata;
- berdasarkan contract relationships.

### 12.5 Bahaya Affected Build

Affected build yang salah lebih berbahaya daripada build lambat.

Jika affected analysis under-approximate:

- test penting tidak jalan;
- bug lolos;
- release tidak aman.

Jika over-approximate:

- build lambat;
- developer experience buruk;
- CI cost tinggi.

Prinsip aman:

> Lebih baik sedikit over-build daripada under-test pada path kritikal.

---

## 13. Build Topology dan Ownership

Topologi build harus membuat ownership terlihat.

### 13.1 CODEOWNERS

Monorepo biasanya membutuhkan `CODEOWNERS`.

Contoh:

```text
/services/case-service/ @team-case
/services/notification-service/ @team-platform
/libs/security-common/ @team-security
/build-logic/ @team-platform-engineering
/contracts/ @team-api-governance
```

Ini membantu:

- review routing;
- compliance evidence;
- domain accountability;
- preventing unauthorized changes.

### 13.2 Ownership Metadata

Untuk build yang lebih advanced, simpan metadata:

```yaml
modules:
  libs/security-common:
    owner: team-security
    type: library
    criticality: high
    javaBaseline: 17
    releaseMode: independent
  services/case-service:
    owner: team-case
    type: service
    criticality: high
    javaBaseline: 21
    releaseMode: independent
    dependsOn:
      - libs/security-common
```

Metadata ini bisa dipakai untuk:

- affected CI;
- dashboard;
- release routing;
- security scanning priority;
- upgrade planning.

### 13.3 Ownership Anti-Pattern

Anti-pattern:

- module tanpa owner;
- shared library yang semua orang bisa ubah;
- build logic tanpa maintainer;
- service ownership ambigu;
- security exceptions tidak punya expiry;
- generated code tidak jelas owner-nya;
- contract repo tidak punya approval policy.

---

## 14. Build Topology dan Security

Repository topology menentukan security boundary.

### 14.1 Monorepo Security Concerns

Risiko monorepo:

- akses terlalu luas;
- secret dalam repo lebih luas terlihat;
- semua CI job mungkin punya privilege terlalu besar;
- malicious change di build logic bisa memengaruhi banyak module;
- central pipeline compromise berdampak besar.

Mitigasi:

- least privilege CI token;
- protected paths;
- required review untuk build logic;
- dependency verification;
- signed commits/tags untuk release;
- isolated deployment credentials per service;
- no long-lived secrets in repo;
- build logic ownership ketat.

### 14.2 Polyrepo Security Concerns

Risiko polyrepo:

- policy drift;
- inconsistent scanner;
- dependency confusion antar repo;
- repo lama tidak di-upgrade;
- shared CI template tidak dipakai semua;
- artifact repository credential tersebar.

Mitigasi:

- mandatory templates;
- central policy scanning;
- repository inventory;
- build governance dashboard;
- parent/BOM/convention plugin;
- scheduled dependency updates;
- centralized secret management.

### 14.3 Build Logic as High-Risk Code

Build logic memiliki kekuasaan besar:

- membaca environment variables;
- mengakses filesystem;
- mengunduh artifacts;
- menjalankan command;
- publish artifacts;
- membaca credentials;
- memodifikasi packaged output.

Karena itu:

> Perubahan pada build logic harus diperlakukan seperti perubahan production code berisiko tinggi.

---

## 15. Build Topology dan Java 8–25

Topologi enterprise harus mendukung realitas Java version mix.

Contoh organisasi:

- legacy libraries masih Java 8;
- service modern di Java 17;
- new platform di Java 21;
- experimental modules di Java 25;
- build tool berjalan di JDK berbeda;
- runtime container berbeda.

### 15.1 Monorepo Multi-Java Baseline

Dalam monorepo, module bisa punya baseline berbeda.

Gradle:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}
```

Maven:

```xml
<properties>
  <maven.compiler.release>17</maven.compiler.release>
</properties>
```

Namun perlu policy:

- shared library yang dikonsumsi Java 8 tidak boleh compile ke Java 17;
- service Java 21 boleh depend pada library Java 8;
- library Java 8 tidak boleh depend pada library Java 17;
- annotation processors harus kompatibel dengan JDK build;
- CI matrix harus menangkap runtime mismatch.

### 15.2 Polyrepo Multi-Java Baseline

Polyrepo memudahkan setiap service memilih baseline, tetapi governance sulit.

Perlu inventory:

```text
repo                  build-jdk    target-release    runtime-jdk
customer-service      17           17                17
legacy-adapter        8            8                 8
case-service          21           21                21
shared-audit-lib      17           8                 8/17/21
```

Tanpa inventory, upgrade Java menjadi tebakan.

### 15.3 Cross-Version Dependency Rule

Aturan sederhana:

> Consumer hanya bisa memakai producer yang class file version-nya <= runtime/compile capability consumer.

Jika service Java 8 depend pada library compiled Java 17:

```text
UnsupportedClassVersionError
```

akan muncul cepat atau lambat.

---

## 16. Monorepo dengan Maven: Blueprint

### 16.1 Directory Layout

```text
regulatory-platform/
├── pom.xml
├── platform-bom/
│   └── pom.xml
├── build-parent/
│   └── pom.xml
├── libs/
│   ├── common-domain/
│   ├── audit-core/
│   ├── security-core/
│   └── test-fixtures/
├── services/
│   ├── case-service/
│   ├── compliance-service/
│   └── notification-service/
├── contracts/
│   ├── case-api/
│   └── notification-api/
└── tools/
    └── data-migration-tool/
```

### 16.2 Root Aggregator

```xml
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.acme.regulatory</groupId>
  <artifactId>regulatory-platform-root</artifactId>
  <version>${revision}</version>
  <packaging>pom</packaging>

  <modules>
    <module>platform-bom</module>
    <module>build-parent</module>
    <module>libs/common-domain</module>
    <module>libs/audit-core</module>
    <module>libs/security-core</module>
    <module>contracts/case-api</module>
    <module>services/case-service</module>
    <module>services/compliance-service</module>
    <module>services/notification-service</module>
    <module>tools/data-migration-tool</module>
  </modules>
</project>
```

### 16.3 CI Commands

Full verification:

```bash
mvn -B -U clean verify
```

Affected module with upstream:

```bash
mvn -B -pl services/case-service -am verify
```

Downstream impact of library:

```bash
mvn -B -pl libs/audit-core -amd verify
```

Resume failed build:

```bash
mvn -B -rf :case-service verify
```

### 16.4 Governance

Use:

- Maven Enforcer;
- dependency plugin;
- versions plugin;
- flattened POM for publishing;
- corporate BOM;
- CI-friendly versions;
- explicit plugin versions.

---

## 17. Monorepo dengan Gradle: Blueprint

### 17.1 Directory Layout

```text
regulatory-platform/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle/
│   └── libs.versions.toml
├── build-logic/
│   └── convention-plugins/
├── libs/
│   ├── common-domain/
│   ├── audit-core/
│   ├── security-core/
│   └── test-fixtures/
├── contracts/
│   ├── case-api/
│   └── notification-api/
├── services/
│   ├── case-service/
│   ├── compliance-service/
│   └── notification-service/
└── tools/
    └── data-migration-tool/
```

### 17.2 Settings

```kotlin
pluginManagement {
    includeBuild("build-logic/convention-plugins")
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://repo.company.internal/plugins")
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://repo.company.internal/maven")
        mavenCentral()
    }
}

rootProject.name = "regulatory-platform"

include(":libs:common-domain")
include(":libs:audit-core")
include(":libs:security-core")
include(":libs:test-fixtures")

include(":contracts:case-api")
include(":contracts:notification-api")

include(":services:case-service")
include(":services:compliance-service")
include(":services:notification-service")

include(":tools:data-migration-tool")
```

### 17.3 Module Build

```kotlin
plugins {
    id("acme.spring-service")
}

dependencies {
    implementation(project(":libs:common-domain"))
    implementation(project(":libs:audit-core"))
    implementation(project(":contracts:case-api"))

    testImplementation(project(":libs:test-fixtures"))
}
```

### 17.4 CI Commands

Full:

```bash
./gradlew clean build
```

Single service:

```bash
./gradlew :services:case-service:build
```

With build cache:

```bash
./gradlew build --build-cache
```

Configuration cache:

```bash
./gradlew build --configuration-cache
```

Dependency insight:

```bash
./gradlew :services:case-service:dependencyInsight \
  --dependency jackson-databind \
  --configuration runtimeClasspath
```

---

## 18. Polyrepo Enterprise Blueprint

### 18.1 Repositories

```text
enterprise-java-bom
enterprise-java-parent
enterprise-gradle-conventions
customer-service
case-service
notification-service
audit-library
security-library
api-contracts
deployment-config
```

### 18.2 Common Policy

Each app repo must have:

- wrapper;
- pinned Maven/Gradle/plugin versions;
- corporate repository;
- dependency scanning;
- SBOM generation;
- test reports;
- coverage reports;
- artifact publishing;
- CI template;
- release workflow;
- CODEOWNERS;
- Java baseline metadata.

### 18.3 Maven Service

```xml
<parent>
  <groupId>com.acme.build</groupId>
  <artifactId>enterprise-java-parent</artifactId>
  <version>4.3.0</version>
</parent>

<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme.platform</groupId>
      <artifactId>enterprise-java-bom</artifactId>
      <version>7.1.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

### 18.4 Gradle Service

```kotlin
plugins {
    id("com.acme.spring-service") version "4.3.0"
}

dependencies {
    implementation(platform("com.acme.platform:enterprise-java-platform:7.1.0"))
}
```

---

## 19. Hybrid Topology Blueprint

Hybrid contoh:

```text
monorepo: regulatory-core-platform
  - core domain modules
  - case management modules
  - shared contracts
  - common test fixtures
  - build logic

polyrepo:
  - external-integration-adapter
  - public-portal
  - reporting-service
  - batch-archival-tool
  - enterprise-java-bom
  - deployment-config
```

Kapan hybrid masuk akal:

- core platform tightly coupled;
- external adapters punya lifecycle berbeda;
- public-facing services punya security/deployment boundary berbeda;
- reporting/batch tools punya cadence berbeda;
- shared BOM/conventions menjaga standardisasi.

Risiko hybrid:

- boundary ambigu;
- shared code bisa tersebar;
- dependency direction tidak jelas;
- local development lintas repo lebih sulit.

Mitigasi:

- clear ownership map;
- shared artifact repository;
- composite build untuk Gradle;
- local Maven install workflow untuk Maven;
- contract testing;
- release compatibility policy.

---

## 20. Contract Repository Pattern

Kadang contract perlu repo sendiri.

Contoh:

```text
api-contracts/
├── openapi/
│   ├── case-service.yaml
│   └── notification-service.yaml
├── protobuf/
│   └── audit-event.proto
└── asyncapi/
    └── notification-events.yaml
```

Kelebihan:

- contract review terpusat;
- consumer/provider bisa sync;
- generated code bisa publish sebagai artifact;
- governance API lebih jelas.

Risiko:

- contract berubah tanpa implementation;
- stale generated clients;
- release coordination ekstra;
- versioning contract rumit.

Policy sehat:

- contract change requires provider + consumer review;
- breaking change harus versioned;
- generated artifact harus reproducible;
- consumer contract test harus jalan;
- schema compatibility dicek di CI.

---

## 21. Deployment Repository Pattern

Banyak enterprise memisahkan deployment config:

```text
deployment-config/
├── environments/
│   ├── dev/
│   ├── uat/
│   └── prod/
├── helm/
├── kustomize/
└── pipelines/
```

Kelebihan:

- access control prod config lebih ketat;
- app dev tidak otomatis bisa ubah deployment;
- GitOps lebih jelas;
- environment promotion bisa dikontrol.

Risiko:

- app change dan deployment change tidak atomic;
- drift antara artifact dan config;
- rollback butuh koordinasi;
- config compatibility perlu diuji.

Prinsip:

> Application build menghasilkan immutable artifact. Deployment repo memilih artifact version dan environment config.

---

## 22. Build Boundary untuk Shared Libraries

Shared library adalah sumber reuse sekaligus coupling.

### 22.1 Library dalam Monorepo

Kelebihan:

- consumer update atomic;
- breaking change terlihat cepat;
- no publish-local loop.

Risiko:

- library berubah mengikuti satu consumer;
- semua consumer ikut terkena;
- internal API bisa bocor.

### 22.2 Library dalam Polyrepo

Kelebihan:

- versioned contract jelas;
- consumer upgrade sadar;
- release cadence independen.

Risiko:

- consumer tertinggal versi lama;
- vulnerability fix rollout lambat;
- banyak versi hidup bersamaan.

### 22.3 Library Governance

Library shared harus punya:

- semantic versioning;
- compatibility tests;
- changelog;
- deprecation policy;
- owner;
- supported Java baseline;
- dependency minimal;
- no framework leakage unless intentional;
- no runtime side effects.

---

## 23. Service Boundary dan Build Boundary

Kesalahan umum:

> “Karena microservice, berarti harus polyrepo.”

Tidak selalu.

Microservice adalah runtime/deployment boundary. Repository adalah source/build/ownership boundary. Mereka berkaitan, tetapi tidak identik.

Satu monorepo bisa berisi banyak microservice jika:

- setiap service punya artifact sendiri;
- deployment pipeline per service;
- ownership jelas;
- CI affected build sehat;
- dependency direction tidak membuat service tightly coupled.

Sebaliknya, polyrepo tidak menjamin microservice sehat jika:

- semua service depend pada god library;
- shared database;
- lockstep release;
- copy-paste code;
- version drift tidak dikontrol.

---

## 24. Topology Smells

### 24.1 Monorepo Smells

- full build wajib untuk semua PR kecil;
- tidak ada affected test;
- tidak ada CODEOWNERS;
- semua module bisa depend pada semua module;
- common module sangat besar;
- build logic berubah tanpa review ketat;
- CI queue sangat panjang;
- developer checkout terlalu berat;
- module tidak punya owner;
- release semua hal untuk perubahan kecil.

### 24.2 Polyrepo Smells

- 100 repo dengan build script copy-paste;
- dependency versions berbeda liar;
- Java baseline tidak diketahui;
- security scan inconsistent;
- library release tanpa changelog;
- shared library punya breaking change diam-diam;
- service pakai SNAPSHOT di production;
- cross-repo change butuh koordinasi manual berhari-hari;
- tidak ada inventory repo;
- tidak ada dashboard vulnerability lintas repo.

### 24.3 Hybrid Smells

- sebagian shared code di monorepo, sebagian di repo lain tanpa alasan;
- contract tersebar di service masing-masing;
- deployment config kadang di app repo, kadang di deployment repo;
- ownership tidak konsisten;
- release strategy berbeda-beda tanpa policy.

---

## 25. Migration Topology

Migrasi topologi perlu hati-hati.

### 25.1 Polyrepo ke Monorepo

Alasan:

- cross-cutting change terlalu mahal;
- banyak duplicated build logic;
- shared libraries terlalu tightly coupled;
- ingin atomic refactor;
- ingin centralized CI.

Risiko:

- history migration sulit;
- ownership kabur;
- CI lambat;
- access control berubah;
- release process harus didesain ulang.

Strategi:

1. inventory repo;
2. kelompokkan berdasarkan bounded context;
3. migrasi build logic dulu;
4. import repos bertahap;
5. jaga artifact identity;
6. buat CODEOWNERS;
7. enable affected build;
8. jangan langsung ubah release strategy;
9. ukur build time dan CI queue;
10. hapus duplicated logic bertahap.

---

### 25.2 Monorepo ke Polyrepo

Alasan:

- ownership perlu isolasi;
- release cadence sangat berbeda;
- repo terlalu besar;
- compliance/access control;
- service mature dan independen.

Risiko:

- dependency graph berubah menjadi artifact graph;
- cross-cutting changes lebih sulit;
- duplicated build logic;
- local development lebih kompleks;
- contract/versioning harus matang.

Strategi:

1. identifikasi module kandidat;
2. pastikan module punya API boundary jelas;
3. publish artifact dari module;
4. ubah consumer memakai artifact version;
5. tambahkan contract tests;
6. buat release workflow;
7. pindahkan code ke repo baru;
8. pertahankan compatibility;
9. monitor adoption;
10. hapus module lama.

---

### 25.3 Multi-Module ke Modular Monolith Sehat

Kadang masalah bukan topologi repo, tetapi module boundary.

Strategi:

- hapus cyclic dependency;
- pisahkan API/implementation;
- kecilkan common module;
- pisahkan test fixtures;
- enforce ArchUnit/layering;
- pakai Maven Enforcer/Gradle rules;
- jangan pindah repo sebelum boundary sehat.

---

## 26. CI/CD Strategy per Topology

### 26.1 Monorepo CI

Harus punya:

- changed-path detection;
- affected module graph;
- task/build cache;
- parallel execution;
- CODEOWNERS integration;
- path-based pipeline routing;
- dependency graph reports;
- per-service artifact publish;
- build logic review gate.

Pipeline:

```text
detect changes
  -> map to modules
  -> expand upstream/downstream dependencies
  -> run affected compile/test/static analysis
  -> run global policy checks if shared files changed
  -> package affected deployables
  -> publish artifacts
```

### 26.2 Polyrepo CI

Harus punya:

- shared pipeline template;
- dependency update automation;
- central vulnerability dashboard;
- consistent artifact publishing;
- contract test trigger;
- cross-repo release notification;
- BOM/platform update flow.

Pipeline:

```text
checkout repo
  -> validate wrapper/build policy
  -> compile/test/package
  -> scan dependency/SBOM
  -> publish artifact
  -> notify consumers if library
```

### 26.3 Hybrid CI

Harus punya dua layer:

- local pipeline per repo/monorepo;
- global governance pipeline lintas inventory.

Global pipeline bisa menjawab:

- repo mana masih Java 8?
- repo mana memakai vulnerable dependency?
- service mana belum upgrade BOM?
- repo mana belum punya SBOM?
- pipeline mana belum memakai shared template?
- library mana punya banyak consumer?

---

## 27. Repository Inventory

Enterprise butuh repository inventory.

Minimal fields:

```yaml
repositories:
  case-service:
    type: service
    owner: team-case
    buildTool: maven
    javaBaseline: 21
    runtime: eks
    criticality: high
    releaseMode: independent
    artifact:
      groupId: com.acme.case
      artifactId: case-service
    dependencies:
      bom: enterprise-java-bom:7.1.0
      parent: enterprise-java-parent:4.3.0

  audit-library:
    type: library
    owner: team-platform
    buildTool: gradle
    javaBaseline: 8
    criticality: high
    consumers:
      - case-service
      - notification-service
```

Ini membantu:

- audit;
- migration;
- security;
- dependency update;
- ownership;
- release planning.

Tanpa inventory, enterprise build governance hanya reaktif.

---

## 28. Decision Framework

Gunakan pertanyaan berikut.

### 28.1 Pilih Monorepo Jika

- perubahan lintas module sering;
- codebase berada dalam satu product/platform;
- ownership bisa dikelola dengan CODEOWNERS;
- CI mampu affected build;
- build graph bisa dipelihara;
- dependency consistency penting;
- refactor besar sering terjadi;
- team bisa menerima shared workflow.

### 28.2 Pilih Polyrepo Jika

- service benar-benar independen;
- ownership butuh isolation;
- access control berbeda;
- release cadence berbeda jauh;
- domain lifecycle berbeda;
- compliance boundary membutuhkan repo terpisah;
- build per service sederhana;
- shared governance bisa dilakukan lewat parent/BOM/plugin/template.

### 28.3 Pilih Hybrid Jika

- core platform tightly coupled;
- sebagian service independent;
- shared build platform diperlukan;
- deployment/config butuh repo terpisah;
- migration tidak bisa big-bang;
- organisasi sudah besar dan domain beragam.

---

## 29. Enterprise Build Topology Maturity Model

### Level 0 — Accidental Topology

Ciri:

- repo dibuat tanpa policy;
- build script copy-paste;
- dependency version liar;
- tidak ada inventory;
- CI berbeda-beda;
- owner tidak jelas.

### Level 1 — Basic Standardization

Ciri:

- shared parent/BOM mulai ada;
- CI template sebagian dipakai;
- repository manager dipakai;
- Java baseline mulai dicatat;
- basic dependency scanning.

### Level 2 — Governed Build Platform

Ciri:

- parent/BOM/convention plugin versioned;
- CI template mandatory;
- SBOM generated;
- vulnerability dashboard;
- artifact publishing standar;
- CODEOWNERS;
- build reports retained.

### Level 3 — Graph-Aware Build

Ciri:

- affected build/test;
- dependency graph inventory;
- ownership metadata;
- release impact analysis;
- cross-repo dependency tracking;
- monorepo/polyrepo topology punya rationale.

### Level 4 — Policy-as-Build and Evidence

Ciri:

- policy enforced in build;
- waiver with expiry;
- provenance;
- reproducible artifact;
- release evidence automatic;
- security and compliance integrated;
- build observability dashboard.

### Level 5 — Self-Service Platform

Ciri:

- new service scaffolded dengan policy benar;
- dependency upgrade automated;
- Java baseline migration automated;
- CI/CD generated from metadata;
- developers fokus domain logic;
- platform team menjaga guardrails.

---

## 30. Case Study: Regulatory Case Management Platform

Bayangkan platform enterprise Java:

- banyak module: case, compliance, correspondence, document, profile, report;
- Spring/Jakarta stack;
- Oracle DB;
- Keycloak SPI;
- OpenAPI integrations;
- batch jobs;
- audit trail;
- multiple environments;
- regulatory release evidence;
- beberapa service external adapter.

### 30.1 Topology Kandidat

#### Option A — One Giant Monorepo

Kelebihan:

- cross-module refactor mudah;
- centralized build policy;
- audit evidence satu tempat;
- dependency consistency.

Risiko:

- CI berat;
- FE/BE/integration noise;
- service independent ikut terdampak;
- ownership perlu disiplin.

#### Option B — Pure Polyrepo

Kelebihan:

- service autonomy;
- access control mudah;
- pipeline kecil.

Risiko:

- shared domain model drift;
- dependency governance sulit;
- cross-cutting auth/audit change mahal;
- release evidence tersebar.

#### Option C — Hybrid

Rekomendasi realistis:

```text
monorepo: aceas-core-platform
  - domain modules
  - case modules
  - audit core
  - shared build logic
  - common contracts
  - test fixtures

polyrepo:
  - external connector service
  - reporting/batch tools if lifecycle differs
  - deployment config
  - enterprise BOM/convention plugin if reused outside platform
```

Alasan:

- core modules punya coupling tinggi;
- audit/auth/case workflow sering cross-cutting;
- external adapter bisa punya lifecycle berbeda;
- deployment config perlu environment governance;
- shared BOM/conventions bisa dipakai lintas repo.

### 30.2 Build Policy

- core monorepo memakai affected build;
- `common` module dibatasi;
- API/implementation split;
- generated code module jelas;
- CI menghasilkan release evidence;
- SBOM per deployable artifact;
- Java baseline per module;
- vulnerability waiver harus expiry;
- dependency update monthly train;
- hotfix lane terpisah.

---

## 31. Checklist Desain Topologi

Sebelum memilih topologi, jawab:

### Ownership

- Apakah setiap module/repo punya owner?
- Apakah ownership terlihat di CODEOWNERS/metadata?
- Siapa owner build logic?
- Siapa owner shared library?
- Siapa approve contract changes?

### Dependency

- Apakah dependency direction jelas?
- Apakah ada cyclic dependency?
- Apakah common module terlalu besar?
- Apakah Java baseline kompatibel?
- Apakah dependency version dikelola terpusat?

### CI/CD

- Apakah build full terlalu lambat?
- Apakah affected build tersedia?
- Apakah test reports retained?
- Apakah artifact promotion jelas?
- Apakah release artifact immutable?

### Security

- Apakah build logic punya review gate?
- Apakah dependency scanning konsisten?
- Apakah SBOM generated?
- Apakah secret tidak masuk artifact/log?
- Apakah CI credentials least privilege?

### Release

- Apakah release unit jelas?
- Apakah versioning jelas?
- Apakah rollback jelas?
- Apakah library compatibility diuji?
- Apakah release evidence otomatis?

### Developer Experience

- Apakah local build mudah?
- Apakah IDE import stabil?
- Apakah onboarding jelas?
- Apakah command standar?
- Apakah error build diagnosable?

---

## 32. Anti-Pattern Catalog

### 32.1 “Monorepo Without Monorepo Tooling”

Satu repo besar tetapi:

- semua PR menjalankan full build;
- tidak ada affected build;
- tidak ada owner;
- build logic copy-paste;
- dependency bebas.

Ini bukan monorepo sehat. Ini hanya repo besar.

### 32.2 “Polyrepo Without Platform”

Banyak repo tetapi:

- tidak ada parent/BOM/convention;
- CI berbeda-beda;
- dependency drift;
- scanner tidak konsisten;
- Java baseline tidak diketahui.

Ini bukan autonomy. Ini fragmentation.

### 32.3 “Shared Library as Distributed Monolith”

Semua service depend pada library besar:

```text
enterprise-common.jar
```

Isinya:

- domain semua modul;
- utils;
- JPA entities;
- Spring config;
- security;
- HTTP clients;
- constants;
- exception model;
- validation;
- database helpers.

Akibat:

- semua service coupled;
- breaking change menyebar;
- Java baseline susah naik;
- vulnerability fix sulit;
- release independent hanya ilusi.

### 32.4 “Contract Hidden Inside Provider”

API contract hanya ada di service provider, consumer copy manual.

Akibat:

- drift;
- generated client stale;
- breaking change tidak ketahuan;
- integration failure di UAT/production.

### 32.5 “Build Logic as Copy-Paste”

Setiap repo punya plugin config sendiri.

Akibat:

- security gate inconsistent;
- upgrade plugin mahal;
- build performance berbeda;
- troubleshooting sulit.

### 32.6 “Repo Boundary as Team Politics”

Repo dipisah bukan karena boundary teknis, tapi karena konflik ownership.

Akibat:

- architecture tidak membaik;
- integration cost naik;
- shared responsibility kabur.

---

## 33. Practical Heuristics

### 33.1 Heuristic 1 — Change Together, Build Together

Jika module sering berubah bersama, pertimbangkan satu repo atau composite workflow yang kuat.

### 33.2 Heuristic 2 — Release Separately, Version Explicitly

Jika artifact dirilis terpisah, versioning dan compatibility policy harus eksplisit.

### 33.3 Heuristic 3 — Shared Build Logic Must Be Productized

Parent POM, BOM, convention plugin, dan CI template adalah produk internal. Mereka butuh:

- versioning;
- changelog;
- backward compatibility;
- migration guide;
- owner;
- tests.

### 33.4 Heuristic 4 — Repository Boundary Is Not Architecture Boundary by Itself

Architecture boundary harus ditegakkan oleh:

- dependency direction;
- API contracts;
- module visibility;
- build rules;
- tests;
- ownership.

### 33.5 Heuristic 5 — Prefer Explicit Graph Over Implicit Coordination

Jika dependency, owner, release, dan Java baseline hanya diketahui lewat “orang lama”, sistem build belum matang.

### 33.6 Heuristic 6 — Optimize for Common Change, Protect Against Dangerous Change

Topologi harus membuat perubahan umum mudah dan perubahan berbahaya aman.

---

## 34. Ringkasan Mental Model

Monorepo, polyrepo, dan hybrid bukan pilihan ideologis.

Mereka adalah cara berbeda untuk mendistribusikan complexity:

```text
monorepo
  -> complexity in build graph, ownership, affected CI

polyrepo
  -> complexity in versioning, coordination, governance

hybrid
  -> complexity in boundaries and integration policy
```

Build topology yang baik harus menjawab:

- siapa pemilik code ini?
- apa yang berubah bersama?
- apa yang dirilis bersama?
- apa yang diuji bersama?
- apa yang bisa gagal bersama?
- apa yang perlu evidence bersama?
- bagaimana dependency dikontrol?
- bagaimana security dikontrol?
- bagaimana Java baseline dikontrol?
- bagaimana developer bisa bekerja cepat tanpa mengorbankan trust?

Top 1% engineer melihat repository bukan folder Git, tetapi **socio-technical architecture**: gabungan struktur code, struktur team, struktur release, struktur dependency, struktur risiko, dan struktur evidence.

---

## 35. Latihan Pemahaman

Jawab secara tertulis untuk sistem Anda sendiri:

1. Apakah sistem Anda monorepo, polyrepo, atau hybrid?
2. Apa unit ownership utama?
3. Apa unit release utama?
4. Apa module/service yang paling sering berubah bersama?
5. Apa dependency shared paling berisiko?
6. Apakah Java baseline setiap repo/module diketahui?
7. Apakah CI bisa melakukan affected build?
8. Apakah shared build logic versioned?
9. Apakah dependency vulnerability dashboard lintas repo tersedia?
10. Apakah build logic punya owner dan review gate?
11. Apakah contract changes punya approval policy?
12. Apakah rollback artifact jelas?
13. Apakah artifact yang diuji sama dengan artifact yang dirilis?
14. Apakah common module terlalu besar?
15. Jika besok harus upgrade satu dependency kritikal lintas semua service, berapa lama?

Jika banyak jawaban tidak jelas, masalah utama bukan Maven atau Gradle. Masalah utama adalah **build topology governance**.

---

## 36. Mini Checklist untuk Review Topologi

```text
[ ] Repository topology punya rationale eksplisit
[ ] Setiap repo/module punya owner
[ ] Shared build logic tidak copy-paste
[ ] Dependency versions dikelola terpusat
[ ] Java baseline diinventarisasi
[ ] CI command standar
[ ] Artifact publishing standar
[ ] SBOM/security scan standar
[ ] Release unit jelas
[ ] Contract/version compatibility jelas
[ ] Affected build tersedia atau full build masih acceptable
[ ] Build logic punya review gate
[ ] Common module tidak menjadi god module
[ ] Cross-cutting migration punya playbook
[ ] Observability build lintas repo tersedia
```

---

## 37. Apa yang Harus Dikuasai Setelah Bagian Ini

Setelah bagian ini, Anda seharusnya bisa:

- membedakan monorepo, polyrepo, multi-repo shared platform, dan hybrid topology;
- menjelaskan trade-off topology tanpa fanatisme;
- mendesain repository layout untuk enterprise Java;
- menentukan kapan Maven monorepo cukup dan kapan Gradle lebih kuat;
- mendesain shared parent/BOM/convention plugin;
- memahami affected build dan affected test;
- menghubungkan topology dengan ownership, release, security, dan compliance;
- mendeteksi smell seperti god common module, copy-paste build logic, dan ungoverned polyrepo;
- merancang migration path dari satu topology ke topology lain;
- memimpin diskusi arsitektural repository/build di level senior/staff/platform engineer.

---

## 38. Posisi Bagian Ini dalam Seri

Bagian ini menyatukan banyak bagian sebelumnya:

- Part 5: project layout;
- Part 6–8: dependency dan repository;
- Part 17–18: performance dan CI/CD;
- Part 20–21: security dan governance;
- Part 22: multi-module architecture;
- Part 31: observability.

Bagian berikutnya akan masuk ke studi kasus enterprise secara lebih konkret:

> **Part 33 — Real-World Case Study: Designing Build System for Enterprise Java Platform**

Di sana kita akan menerapkan semua konsep Maven/Gradle/build engineering untuk merancang sistem build enterprise end-to-end.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./31-build-observability.md">⬅️ Part 31 — Build Observability: Logs, Reports, Build Scan, Metrics, Flakiness, Trend Analysis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./33-real-world-case-study-enterprise-java-platform-build-system.md">Part 33 — Real-World Case Study: Designing Build System for Enterprise Java Platform ➡️</a>
</div>
