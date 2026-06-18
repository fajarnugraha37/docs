# Part 27 — Provisioning and Deployment: Repositories, Features, p2, Karaf, Containers, and Rollback

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> Part: `27 / 35`  
> File: `27-provisioning-deployment-repositories-features-p2-karaf-containers-rollback.md`  
> Scope: Java 8 hingga Java 25, OSGi Core/Compendium, Apache Felix, Eclipse Equinox, Apache Karaf, bnd/Bndtools, p2, container/Kubernetes deployment.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas runtime OSGi dari sudut:

- bundle lifecycle;
- resolver;
- service registry;
- Declarative Services;
- configuration;
- Felix, Equinox, Karaf;
- web, persistence, messaging;
- security;
- JPMS dan Java 8–25;
- testing, observability, performance.

Sekarang kita masuk ke pertanyaan production yang paling menentukan:

> Bagaimana cara mengirim, menginstal, meng-update, me-rollback, dan mengoperasikan banyak bundle OSGi sebagai satu runtime yang reproducible, auditable, dan aman?

Ini disebut **provisioning and deployment**.

Dalam aplikasi Java biasa, deployment sering terlihat sederhana:

```text
build jar -> copy jar -> run java -jar app.jar
```

Dalam OSGi, deployment bukan hanya satu artifact. Runtime bisa terdiri dari:

```text
framework
+ system bundle
+ API bundles
+ implementation bundles
+ extender bundles
+ config admin
+ DS runtime
+ HTTP runtime
+ logging bundles
+ persistence bundles
+ plugin bundles
+ feature descriptors
+ repository metadata
+ framework properties
+ configurations
+ native fragments
+ shell/management bundles
```

Kalau assembly ini tidak dikontrol, OSGi akan berubah dari modular runtime menjadi **dependency casino**.

Part ini bertujuan membangun mental model dan playbook agar kamu bisa:

1. membedakan bundle, feature, repository, distribution, runtime image, dan deployment unit;
2. memahami provisioning berbasis requirement-capability, bukan sekadar daftar JAR;
3. menggunakan bnd resolver, Karaf features, Equinox p2, dan OBR/R5 repository secara rasional;
4. memilih immutable distribution vs mutable hot deployment;
5. mendesain update, refresh, rollback, dan migration strategy tanpa merusak state runtime;
6. menjalankan OSGi di VM, bare metal, Docker, atau Kubernetes dengan trade-off yang jelas;
7. mengontrol supply chain, reproducibility, security, dan auditability;
8. membuat release process yang defensible untuk platform modular.

---

## 1. Problem Besar Provisioning di OSGi

OSGi memberi kemampuan yang jarang dimiliki runtime Java biasa:

- bundle bisa diinstal saat runtime hidup;
- bundle bisa di-update;
- bundle bisa di-uninstall;
- service bisa muncul/hilang;
- resolver bisa melakukan wiring ulang;
- beberapa versi package bisa coexist;
- dependency bisa dipilih dari repository berdasarkan capability/requirement;
- runtime bisa dibentuk dari banyak bundle kecil.

Kemampuan ini powerful, tetapi membawa problem deployment yang lebih kompleks.

### 1.1 Deployment Bukan Hanya Copy JAR

Dalam classpath app:

```text
Semua dependency dimasukkan ke satu classpath.
Kalau class ada, JVM bisa load.
Kalau konflik, yang menang biasanya urutan classpath.
```

Dalam OSGi:

```text
Bundle harus resolve.
Package harus wired.
Capability harus satisfied.
Extender harus tersedia.
Config harus ada.
Service dependency harus satisfied.
Start level harus benar.
Refresh bisa memutus wiring lama.
```

Maka deployment OSGi harus menjawab pertanyaan:

| Pertanyaan | Mengapa penting |
|---|---|
| Bundle apa saja yang menjadi runtime final? | Karena satu bundle hilang bisa membuat graph gagal resolve. |
| Versi package apa yang dipakai? | Karena bundle bisa resolve ke provider berbeda dari yang kamu kira. |
| Dependency dipilih manual atau resolver? | Manual list rawan drift; resolver butuh metadata yang benar. |
| Config kapan dipasang? | Component bisa gagal aktif jika config belum ada. |
| Update dilakukan hot atau full restart? | Hot update butuh state migration dan refresh planning. |
| Rollback artifact atau rollback runtime state? | Bundle rollback tidak otomatis rollback DB/config/cache. |
| Bundle cache persistent atau ephemeral? | Mempengaruhi startup, reproducibility, dan recovery. |
| Runtime mutable atau immutable? | Mempengaruhi audit, security, dan predictability. |

### 1.2 OSGi Membutuhkan Deployment Graph, Bukan Deployment List

Kesalahan umum adalah memperlakukan deployment OSGi sebagai daftar bundle:

```text
install a.jar
install b.jar
install c.jar
start a
start b
start c
```

Model ini lemah karena tidak menjelaskan:

- kenapa bundle dipilih;
- versi package mana yang dibutuhkan;
- capability apa yang harus tersedia;
- apakah transitive dependency lengkap;
- apakah graph konsisten;
- apakah graph reproducible di environment lain.

Model yang benar:

```text
Application requirement
    -> resolver selects resources from repositories
        -> produces consistent bundle closure
            -> runtime installs closure
                -> framework resolves wiring
                    -> lifecycle starts components
```

Artinya, deployment OSGi yang matang harus berorientasi pada **runtime graph**.

---

## 2. Vocabulary: Bundle, Feature, Repository, Distribution, Deployment

Sebelum masuk detail, kita harus presisi dengan istilah.

### 2.1 Bundle

Bundle adalah unit modular OSGi berbasis JAR dengan manifest OSGi.

Contoh:

```text
com.acme.case.api-1.4.0.jar
com.acme.case.impl-1.4.3.jar
com.acme.validation.rules.core-2.1.0.jar
```

Bundle memiliki:

- symbolic name;
- version;
- imported packages;
- exported packages;
- required capabilities;
- provided capabilities;
- lifecycle state;
- classloader;
- wiring.

Bundle adalah unit teknis paling dasar, tetapi belum tentu unit deployment yang nyaman.

### 2.2 Feature

Feature adalah grouping beberapa bundle dan konfigurasi sebagai satu fungsi deployment.

Contoh feature:

```text
acme-case-management-feature
    - com.acme.case.api
    - com.acme.case.impl
    - com.acme.case.web
    - com.acme.case.persistence
    - config: com.acme.case.cfg
```

Feature bukan konsep core OSGi universal. Istilah ini paling terkenal di Karaf. Namun ide feature juga muncul di platform lain dalam bentuk:

- Eclipse feature;
- p2 installable unit;
- custom distribution module;
- deployment descriptor;
- bndrun application.

Feature menjawab pertanyaan:

> Untuk mengaktifkan capability bisnis X, bundle dan config apa saja yang harus hadir?

### 2.3 Repository

Repository adalah sumber resource yang bisa dipakai resolver atau provisioning tool.

Resource tidak harus selalu bundle, tetapi dalam praktik biasanya bundle.

Repository menyediakan metadata seperti:

- symbolic name;
- version;
- capabilities;
- requirements;
- package exports;
- package imports;
- service capabilities;
- extender requirements;
- content URL.

OSGi Repository Service menyediakan abstraksi untuk mengakses resource berdasarkan requirement/capability. Resolver kemudian menggunakan metadata repository untuk memilih closure yang valid.

### 2.4 Distribution

Distribution adalah runtime yang sudah dirakit.

Contoh:

```text
acme-osgi-runtime-1.8.0.zip
```

Isi distribution bisa berupa:

```text
/bin
/etc
/lib
/bundle
/system
/deploy
/data
repository/
framework.jar
config.properties
startup.properties
features.xml
```

Distribution menjawab pertanyaan:

> Apa isi runtime yang dikirim ke server/container?

### 2.5 Deployment

Deployment adalah proses membawa distribution atau bundle set ke environment target.

Deployment melibatkan:

- artifact transfer;
- config injection;
- secret binding;
- install/update;
- start;
- health check;
- readiness check;
- migration;
- rollback;
- observability;
- audit.

### 2.6 Provisioning

Provisioning adalah proses memilih, menginstal, dan mengonfigurasi resource agar requirement runtime terpenuhi.

Provisioning bisa terjadi:

- build-time;
- first boot;
- runtime;
- during update;
- via shell;
- via deployment controller;
- via repository manager.

Provisioning menjawab:

> Berdasarkan requirement ini, artifact mana yang harus ada dan bagaimana runtime dibentuk?

---

## 3. Mental Model: Deployment as Runtime Composition

OSGi deployment bukan sekadar mengirim kode. Ia adalah proses menyusun komposisi runtime.

```text
Source Code
   ↓
Bundle Build
   ↓
Manifest + Metadata
   ↓
Repository Publish
   ↓
Resolve Application Requirements
   ↓
Assemble Runtime Distribution
   ↓
Inject Config/Secrets
   ↓
Start Framework
   ↓
Resolve Bundles
   ↓
Start Bundles/Components
   ↓
Expose Services/Endpoints
   ↓
Observe Health
   ↓
Update/Rollback Over Time
```

Hal penting:

> Semakin lambat dependency dipilih, semakin besar kebutuhan kontrol runtime.

| Dependency dipilih kapan? | Karakter |
|---|---|
| Compile-time | Cepat gagal, mudah reproducible, kurang fleksibel. |
| Build-time distribution | Umumnya paling aman untuk production. |
| First boot | Fleksibel, tetapi boot tergantung repository/network. |
| Runtime hot install | Sangat fleksibel, tetapi butuh governance tinggi. |
| Manual shell install | Cocok debug/lab, buruk untuk production jika tidak diaudit. |

Untuk production regulated platform, pilihan default sebaiknya:

```text
Resolve at build/release time.
Deploy immutable distribution.
Runtime mutation hanya melalui controlled operation.
```

---

## 4. Repository Metadata: Kenapa Maven Repository Saja Tidak Cukup

Maven repository menyimpan artifact dan POM.

POM menjelaskan dependency Maven:

```xml
<dependency>
  <groupId>org.foo</groupId>
  <artifactId>bar</artifactId>
  <version>1.2.3</version>
</dependency>
```

Tetapi OSGi resolver membutuhkan informasi seperti:

```text
Export-Package: com.foo.api;version="1.4.0"
Import-Package: org.slf4j;version="[1.7,2)"
Require-Capability: osgi.extender;filter:="(osgi.extender=osgi.component)"
Provide-Capability: osgi.service;objectClass:List<String>="com.acme.Rule"
```

Maven tahu artifact dependency. OSGi peduli pada package/capability wiring.

### 4.1 Maven Coordinates vs OSGi Identity

Maven identity:

```text
groupId:artifactId:version
```

OSGi identity:

```text
Bundle-SymbolicName + Bundle-Version
```

Package identity:

```text
package name + package version + exporting bundle
```

Tidak selalu satu-to-satu.

Contoh:

```text
Maven artifact:
  com.fasterxml.jackson.core:jackson-databind:2.17.0

OSGi bundle symbolic name bisa:
  com.fasterxml.jackson.core.jackson-databind

Export package:
  com.fasterxml.jackson.databind;version="2.17.0"
```

Pada beberapa library, manifest OSGi mungkin:

- benar;
- tidak lengkap;
- terlalu luas;
- terlalu sempit;
- tidak ada sama sekali.

Maka repository OSGi harus dibangun dari analisis bundle, bukan hanya POM.

### 4.2 Requirement-Capability Repository

Repository OSGi idealnya menjawab query:

```text
Find resources that provide package com.acme.case.api version [1.4,2)
Find resources that provide osgi.extender=osgi.component
Find resources that provide JavaSE execution environment 17
Find resources that provide osgi.service=com.acme.Rule
```

Bukan hanya:

```text
Find artifact with artifactId = x
```

Ini penting untuk resolver.

### 4.3 Repository sebagai Supply Chain Boundary

Repository juga boundary security.

Pertanyaan production:

- siapa boleh publish bundle?;
- apakah bundle signed?;
- apakah metadata diindeks?;
- apakah artifact immutable?;
- apakah checksum diverifikasi?;
- apakah vulnerable dependency diblokir?;
- apakah release candidate sama dengan production artifact?;
- apakah repository internal mirror digunakan?;
- apakah artifact bisa dihapus atau diganti?;

Prinsip:

```text
Production runtime should not resolve from uncontrolled public internet repositories.
```

Gunakan internal artifact repository/mirror untuk production.

---

## 5. Resolver-Based Provisioning

Resolver bisa digunakan dalam dua konteks:

1. framework resolve bundle yang sudah installed;
2. build/provisioning resolver memilih bundle dari repository yang lebih besar.

Konteks kedua sangat penting.

### 5.1 Runtime Resolver vs Provisioning Resolver

Runtime resolver:

```text
Input:
  installed bundles

Task:
  wire requirements to capabilities among installed bundles
```

Provisioning resolver:

```text
Input:
  application requirement + repository resources

Task:
  choose bundle closure that can satisfy requirements
```

Contoh requirement aplikasi:

```text
Require-Capability: osgi.identity;filter:="(osgi.identity=com.acme.case.app)"
```

Resolver memilih:

```text
com.acme.case.app
com.acme.case.api
com.acme.case.impl
com.acme.audit.api
com.acme.audit.impl
org.slf4j.api
org.apache.felix.scr
org.apache.felix.configadmin
...
```

### 5.2 Why This Matters

Tanpa resolver-based provisioning, kamu cenderung membuat list manual:

```text
bundle/a.jar
bundle/b.jar
bundle/c.jar
bundle/d.jar
```

Masalahnya:

- list bisa stale;
- transitive dependency bisa hilang;
- dependency tidak dibutuhkan tetap ikut;
- versi tidak konsisten;
- resolver error baru muncul di runtime;
- environment dev/test/prod bisa beda;
- rollback sulit karena closure tidak terekam.

Dengan resolver-based provisioning:

- application requirement eksplisit;
- repository source jelas;
- selected closure bisa disimpan;
- result bisa direview;
- CI bisa gagal sebelum production;
- runtime final lebih reproducible.

### 5.3 Resolver Output Harus Dipin

Resolver bagus, tetapi production tidak boleh bergantung pada hasil resolver yang berubah diam-diam.

Bad:

```text
At startup, resolve latest matching bundles from repository.
```

Good:

```text
At release build, resolve once.
Store resolved bundle list with exact versions.
Ship immutable runtime distribution.
```

Dengan kata lain:

```text
Use resolver to compute.
Use lock file / resolved output to deploy.
```

Dalam bnd, konsep ini dekat dengan `.bndrun` dan `-runbundles` hasil resolve.

---

## 6. bndrun-Based Runtime Assembly

bnd/Bndtools menyediakan model untuk mendeskripsikan runtime OSGi.

File `.bndrun` biasanya memuat:

```properties
-runfw: org.apache.felix.framework;version='[7,8)'
-runee: JavaSE-17
-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.case.app)'
-runrepos: \
    Workspace, MavenCentral, LocalReleaseRepo
-runproperties: \
    org.osgi.framework.storage.clean=onFirstInit
-runbundles: \
    org.apache.felix.scr;version='[2.2.0,2.3.0)', \
    org.apache.felix.configadmin;version='[1.9.0,2.0.0)', \
    com.acme.case.app;version='[1.0.0,1.0.1)'
```

### 6.1 `-runrequires`

`-runrequires` adalah requirement tingkat aplikasi.

Contoh:

```properties
-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.enforcement.runtime)'
```

Artinya:

> Runtime membutuhkan resource dengan identity `com.acme.enforcement.runtime`.

Resolver akan mencari closure dari repository.

### 6.2 `-runbundles`

`-runbundles` adalah hasil bundle list yang akan dijalankan.

Dalam workflow ideal:

```text
edit -runrequires
run resolver
review -runbundles
commit resolved output
build distribution
```

### 6.3 `-runfw`

Menentukan framework:

```properties
-runfw: org.apache.felix.framework;version='[7,8)'
```

atau Equinox:

```properties
-runfw: org.eclipse.osgi;version='[3.18,4)'
```

### 6.4 `-runee`

Menentukan Java execution environment:

```properties
-runee: JavaSE-17
```

Untuk seri ini, target bisa Java 8–25. Namun runtime production biasanya sebaiknya punya target eksplisit:

```text
JavaSE-1.8
JavaSE-11
JavaSE-17
JavaSE-21
JavaSE-25
```

Jangan biarkan bundle bytecode Java 21 masuk runtime Java 11.

### 6.5 `-runproperties`

Contoh:

```properties
-runproperties: \
    org.osgi.framework.storage=./data/cache, \
    org.osgi.framework.storage.clean=onFirstInit, \
    org.osgi.framework.startlevel.beginning=10
```

Framework properties adalah bagian dari deployment contract.

### 6.6 Application Bundle Pattern

Sering berguna membuat bundle “application aggregator” yang menyediakan capability aplikasi.

Manifest:

```properties
Bundle-SymbolicName: com.acme.enforcement.runtime
Bundle-Version: 1.8.0
Provide-Capability: \
  osgi.identity;osgi.identity="com.acme.enforcement.runtime";version:Version="1.8.0";type="osgi.bundle"
Require-Capability: \
  osgi.extender;filter:="(osgi.extender=osgi.component)", \
  osgi.service;filter:="(objectClass=com.acme.case.api.CaseService)", \
  osgi.service;filter:="(objectClass=com.acme.audit.api.AuditService)"
```

Dengan pattern ini, application requirement bisa menjadi single root.

### 6.7 Runtime Export

bnd dapat membuat executable JAR atau distribution yang berisi framework dan bundle closure.

Prinsip production:

```text
Build artifact should contain exact runtime closure.
Do not rely on runtime downloading arbitrary dependency.
```

---

## 7. Karaf Features Provisioning

Apache Karaf memakai konsep **features** sebagai unit provisioning.

Feature mendeskripsikan:

- bundle yang harus diinstal;
- dependency feature;
- config;
- config files;
- prerequisites;
- start level;
- dependency behavior;
- repository reference.

Contoh sederhana:

```xml
<features name="acme-features" xmlns="http://karaf.apache.org/xmlns/features/v1.6.0">

  <feature name="acme-common" version="1.8.0">
    <bundle>mvn:com.acme/common-api/1.8.0</bundle>
    <bundle>mvn:com.acme/common-impl/1.8.0</bundle>
  </feature>

  <feature name="acme-case-management" version="1.8.0">
    <feature>acme-common</feature>
    <bundle>mvn:com.acme/case-api/1.8.0</bundle>
    <bundle>mvn:com.acme/case-impl/1.8.0</bundle>
    <bundle>mvn:com.acme/case-web/1.8.0</bundle>
    <config name="com.acme.case">
      maxOpenCases = 5000
      escalationEnabled = true
    </config>
  </feature>

</features>
```

### 7.1 Feature as Operational Unit

Feature menjawab:

```text
Install case management capability.
Uninstall case management capability.
Upgrade case management capability.
List what is installed.
```

Ini lebih operasional daripada install bundle satu per satu.

### 7.2 Feature Repository

Karaf feature repository adalah XML yang dapat didaftarkan:

```shell
feature:repo-add mvn:com.acme/acme-features/1.8.0/xml/features
```

Kemudian install:

```shell
feature:install acme-case-management/1.8.0
```

Namun production sebaiknya tidak bergantung pada manual shell untuk deployment reguler.

### 7.3 Boot Features

Karaf dapat men-start feature saat boot melalui boot feature configuration.

Pattern:

```text
Build custom Karaf distribution
  -> include required features repo
  -> configure boot features
  -> ship immutable image
```

Boot features cocok untuk baseline runtime.

### 7.4 Feature Verification

Feature XML harus diverifikasi di CI:

- semua Maven URL resolve;
- semua transitive bundle tersedia;
- tidak ada version mismatch;
- bundle bisa resolve;
- boot features bisa start;
- config tersedia;
- duplicate package/provider tidak bermasalah;
- feature repository immutable.

Karaf Maven Plugin menyediakan goal untuk membantu membuat dan memverifikasi feature descriptors serta membuat custom distribution.

### 7.5 Feature vs Resolver

Karaf feature list bisa manual. Ia tidak otomatis selalu menjamin graph OSGi valid jika metadata buruk atau dependency kurang.

Maka praktik matang:

```text
Use feature for operational grouping.
Use resolver/test runtime for correctness verification.
```

### 7.6 Feature Versioning

Feature harus versioned seperti produk.

Contoh:

```text
acme-case-management 1.8.0
acme-case-management 1.8.1
acme-case-management 1.9.0
acme-case-management 2.0.0
```

Feature version tidak otomatis sama dengan semua bundle version.

Mapping bisa:

```text
feature 1.8.0:
  case-api 1.8.0
  case-impl 1.8.3
  audit-api 2.2.0
  audit-impl 2.2.1
```

Feature adalah release composition.

### 7.7 KAR Archive

KAR adalah archive Karaf yang dapat berisi feature repository dan artifacts terkait.

Gunanya:

- offline deployment;
- controlled artifact set;
- easier transfer;
- repeatable install.

Untuk regulated environment, KAR atau custom distribution lebih defensible daripada runtime download dari remote repository.

---

## 8. Equinox p2 Provisioning

Equinox/Eclipse ecosystem memakai p2 sebagai provisioning platform.

p2 mengelola:

- installable units;
- metadata repository;
- artifact repository;
- update sites;
- features;
- products;
- profiles;
- director command-line provisioning;
- install/update/uninstall.

### 8.1 Installable Unit

Dalam p2, unit provisioning disebut **Installable Unit** atau IU.

IU bisa merepresentasikan:

- bundle/plugin;
- feature;
- product;
- configuration action;
- native artifact.

p2 metadata kaya dan memungkinkan Eclipse-based applications melakukan update/installation secara terkontrol.

### 8.2 Feature and Product

Eclipse feature mengelompokkan plugin.

Product mendefinisikan aplikasi final:

```text
product
  -> features
      -> plugins/bundles
```

Ini cocok untuk RCP/desktop/platform product.

### 8.3 p2 Director

p2 director adalah command-line tool untuk install/uninstall/provision product.

Gunanya:

- build automation;
- headless provisioning;
- installing complete product;
- extending existing application.

### 8.4 p2 vs Karaf Features

| Aspek | Equinox p2 | Karaf Features |
|---|---|---|
| Ekosistem utama | Eclipse/Equinox/RCP | Server-side Karaf/Fuse |
| Unit konsep | Installable Unit, feature, product | Feature, repository, KAR |
| Update model | Eclipse update/provisioning | Karaf shell/feature lifecycle |
| Cocok untuk | IDE/RCP/product platform | OSGi server/container runtime |
| Metadata | Rich provisioning metadata | Feature XML + Maven artifacts |

### 8.5 Lessons from p2

Pelajaran penting dari p2:

- deployment modular butuh metadata kuat;
- update harus model-based, bukan copy file manual;
- product composition harus versioned;
- provisioning profile penting untuk mengetahui apa yang installed;
- uninstall/update harus mempertimbangkan dependency graph;
- artifact repository dan metadata repository bisa dipisahkan.

---

## 9. Immutable vs Mutable OSGi Runtime

Ini keputusan arsitektur deployment paling penting.

### 9.1 Mutable Runtime

Mutable runtime berarti bundle/config bisa berubah di runtime.

Contoh:

```shell
bundle:install mvn:com.acme/new-plugin/1.0.0
bundle:update 123
feature:install acme-new-feature
```

Kelebihan:

- hotfix cepat;
- plugin runtime dynamic;
- tidak perlu full redeploy;
- cocok untuk platform extension.

Kekurangan:

- drift antar node;
- audit lebih sulit;
- rollback kompleks;
- runtime state bisa berbeda dari source control;
- dependency closure bisa berubah;
- operator error risk tinggi.

### 9.2 Immutable Runtime

Immutable runtime berarti distribution final dirakit saat build, lalu deployed sebagai satu image/archive.

Contoh:

```text
acme-osgi-runtime:1.8.0 Docker image
```

Kelebihan:

- reproducible;
- mudah audit;
- mudah rollback image;
- cocok Kubernetes;
- lebih aman;
- lebih mudah test end-to-end.

Kekurangan:

- kurang dynamic;
- hot plugin install tidak natural;
- release cycle lebih formal;
- image rebuild untuk perubahan kecil.

### 9.3 Recommended Production Default

Untuk kebanyakan enterprise/regulatory system:

```text
Immutable runtime for baseline platform.
Controlled mutable extension for certified plugins only.
```

Model hybrid:

```text
Core runtime immutable.
Plugin repository controlled.
Plugin install/update melalui governed API.
Runtime mutation audited.
```

### 9.4 Runtime Drift

Runtime drift terjadi ketika environment berbeda dari artifact yang di-release.

Contoh:

```text
UAT:
  case-api 1.8.0
  case-impl 1.8.1

PROD:
  case-api 1.8.0
  case-impl 1.8.0 + manual hotfix bundle
```

Bahaya:

- bug tidak reproduce;
- rollback tidak jelas;
- audit gagal;
- support sulit;
- resolver graph berbeda;
- incident analysis lambat.

Solusi:

- runtime inventory export;
- compare against release manifest;
- block manual mutation;
- signed deployment plan;
- immutable image;
- CI-generated SBOM;
- periodic drift detection.

---

## 10. Deployment Artifact Types

### 10.1 Loose Bundle Folder

```text
runtime/
  framework.jar
  bundles/
    a.jar
    b.jar
    c.jar
```

Kelebihan:

- sederhana;
- mudah debug;
- cocok local/lab.

Kekurangan:

- rawan drift;
- kurang metadata deployment;
- kurang cocok production besar.

### 10.2 Executable OSGi JAR

Satu executable JAR berisi framework dan bundle.

Kelebihan:

- mudah run;
- cocok kecil/embedded;
- reproducible.

Kekurangan:

- update granular tidak natural;
- management layout terbatas;
- operational shell/config bisa kurang nyaman.

### 10.3 ZIP/TAR Distribution

```text
acme-runtime-1.8.0.zip
```

Berisi:

```text
bin/
etc/
bundles/
lib/
repo/
data/
```

Kelebihan:

- production friendly;
- mudah sign/checksum;
- bisa deploy ke VM/bare metal;
- bisa berisi scripts.

Kekurangan:

- harus manage install path;
- update/rollback butuh orchestration.

### 10.4 Karaf Custom Distribution

Karaf distribution dengan feature dan config preloaded.

Kelebihan:

- operational rich;
- shell, logging, config, features;
- cocok enterprise OSGi server.

Kekurangan:

- footprint lebih besar;
- Karaf-specific;
- mutable behavior harus dikontrol.

### 10.5 Docker Image

```text
registry/acme/osgi-runtime:1.8.0
```

Kelebihan:

- immutable;
- Kubernetes friendly;
- easy rollback;
- supply-chain scanning;
- consistent environment.

Kekurangan:

- hot bundle update bertentangan dengan image immutability;
- persistent framework cache perlu keputusan;
- config/secrets via env/volume/operator.

### 10.6 Kubernetes Deployment

OSGi runtime sebagai pod.

Kelebihan:

- orchestration;
- rolling update;
- probes;
- resource limits;
- config/secret management;
- horizontal scaling.

Kekurangan:

- OSGi hot deployment dan Kubernetes rollout bisa konflik;
- stateful runtime cache harus hati-hati;
- management shell exposure risk;
- readiness harus benar-benar service-level.

---

## 11. Framework Cache Strategy

OSGi framework menyimpan cache bundle/wiring/state.

Keputusan penting:

```text
Is framework cache persistent across restart?
```

### 11.1 Persistent Cache

Kelebihan:

- startup bisa lebih cepat;
- state installed bundle bisa dipertahankan;
- mutable runtime operation preserved.

Kekurangan:

- drift risk;
- stale bundle state;
- sulit immutable deployment;
- corrupted cache bisa menyebabkan boot failure;
- rollback image belum tentu rollback cache.

### 11.2 Ephemeral Cache

Cache dibersihkan saat startup.

Kelebihan:

- boot dari artifact final;
- reproducible;
- cocok container;
- stale state minim.

Kekurangan:

- startup bisa lebih lambat;
- runtime-installed bundle hilang;
- dynamic plugin perlu external source of truth.

### 11.3 Recommended Strategy

Untuk immutable container:

```text
Clean cache on first init or every boot depending framework behavior.
Install exact bundle set from image.
Do not rely on cached runtime mutation.
```

Untuk mutable platform:

```text
Persistent cache allowed.
But maintain external runtime inventory and deployment journal.
```

### 11.4 Cache and Rollback

Rollback image tanpa membersihkan cache bisa berbahaya.

Scenario:

```text
Deploy image 1.9.0 -> cache contains bundle 1.9.0
Rollback image 1.8.0 -> cache still references 1.9.0 state
```

Solusi:

- versioned cache directory per release;
- clean cache on release change;
- deployment controller manages cache;
- runtime validates installed bundle list against release manifest.

---

## 12. Update Semantics: Install, Update, Refresh, Restart

OSGi update bukan sekadar replace JAR.

### 12.1 Install

```text
Bundle installed -> INSTALLED state
```

Bundle belum tentu resolved atau active.

### 12.2 Resolve

Framework menemukan wiring yang valid.

```text
INSTALLED -> RESOLVED
```

Resolve gagal jika:

- import package tidak terpenuhi;
- capability missing;
- version range tidak cocok;
- uses constraint violation;
- execution environment tidak cocok.

### 12.3 Start

```text
RESOLVED -> STARTING -> ACTIVE
```

Start bisa gagal karena:

- activator exception;
- DS missing config;
- service dependency unsatisfied;
- extender missing;
- runtime resource unavailable.

### 12.4 Update

Bundle update mengganti content bundle.

Tetapi kelas lama mungkin masih dipakai oleh bundle lain sampai refresh.

### 12.5 Refresh

Refresh packages menyebabkan framework menghentikan dan me-resolve ulang affected bundles.

Ini bisa berdampak luas.

Mental model:

```text
Update changes bundle content.
Refresh changes active wiring.
```

### 12.6 Restart

Restart full runtime sering lebih mudah diprediksi daripada hot refresh untuk production.

Trade-off:

| Operation | Predictability | Downtime | Complexity |
|---|---:|---:|---:|
| Hot update no refresh | rendah | rendah | tinggi |
| Hot update + refresh | sedang | sedang | tinggi |
| Full runtime restart | tinggi | sedang/tinggi | rendah/sedang |
| Blue/green runtime | tinggi | rendah | sedang/tinggi |

### 12.7 Top 1% Rule

```text
Do not confuse OSGi's ability to hot update with a requirement to hot update.
```

Hot update adalah capability. Production policy harus tetap mempertimbangkan correctness, observability, state, dan rollback.

---

## 13. Refresh Blast Radius

Refresh bisa menghentikan lebih banyak bundle dari yang kamu kira.

Kenapa?

Karena wiring dependency graph.

Contoh:

```text
case-api exports com.acme.case.api
case-impl imports com.acme.case.api
audit-impl imports com.acme.case.api
web imports com.acme.case.api
rules imports com.acme.case.api
```

Update `case-api` lalu refresh bisa memengaruhi semua importer.

### 13.1 Blast Radius Analysis

Sebelum refresh, tanyakan:

- bundle mana yang exports package berubah?;
- siapa import package itu?;
- apakah ada `uses:=` chain?;
- apakah bundle affected punya DS components?;
- apakah endpoint akan hilang sementara?;
- apakah transaction sedang berjalan?;
- apakah background worker sedang memproses?;
- apakah service unregister akan memicu cascade?;
- apakah config modified akan terjadi?;
- apakah persistent state migration sudah selesai?

### 13.2 Refresh Plan

Minimal refresh plan:

```text
1. Quiesce traffic.
2. Stop affected feature or route traffic away.
3. Drain workers.
4. Install/update bundles.
5. Refresh affected bundles.
6. Start/verify components.
7. Run health checks.
8. Restore traffic.
9. Record inventory.
```

### 13.3 Avoiding Large Blast Radius

Design tactics:

- stable API bundles;
- narrow package exports;
- avoid exporting implementation packages;
- avoid split packages;
- avoid huge common API bundle;
- avoid unnecessary `uses:=` coupling;
- use DTO boundary;
- version API package carefully;
- isolate plugin API from core internal model;
- prefer service boundary for dynamic extension.

---

## 14. Rollback Is More Than Downgrading Bundles

Rollback harus mempertimbangkan empat state:

```text
Code state
Config state
Data state
Runtime state
```

### 14.1 Code State

Bundle versions/distribution image.

Rollback code:

```text
runtime 1.9.0 -> runtime 1.8.0
```

### 14.2 Config State

Config bisa berubah saat upgrade.

Contoh:

```text
1.9.0 adds required config field:
  retryPolicy = exponential
```

Rollback ke 1.8.0 mungkin:

- ignore field;
- fail parse;
- behave differently.

Config schema harus versioned.

### 14.3 Data State

Schema migration paling sulit.

Contoh:

```text
1.9.0 migrates table CASE_STATUS_HISTORY
1.8.0 code does not understand new schema
```

Rollback bundle tidak otomatis rollback database.

Strategy:

- backward-compatible migrations;
- expand/contract migration;
- delayed destructive changes;
- dual-read/dual-write temporarily;
- database backup/restore for major rollback;
- feature flags;
- schema version check.

### 14.4 Runtime State

OSGi runtime punya state:

- bundle installed state;
- service registrations;
- DS component state;
- framework cache;
- in-memory queue;
- thread pools;
- open connections;
- scheduled jobs.

Rollback harus memastikan runtime state bersih.

### 14.5 Rollback Modes

| Mode | Cocok untuk | Risiko |
|---|---|---|
| Bundle-level rollback | plugin kecil, no schema change | stale classes, refresh blast radius |
| Feature-level rollback | Karaf feature composition | config/data mismatch |
| Distribution rollback | immutable runtime | needs restart/traffic routing |
| Blue/green rollback | critical production | needs infrastructure capacity |
| Database restore rollback | destructive migration | data loss/window complexity |

### 14.6 Rollback Readiness Checklist

Sebelum release:

- exact previous artifact tersedia;
- previous config snapshot tersedia;
- DB migration reversible atau backward-compatible;
- runtime cache strategy jelas;
- health check bisa membedakan partial failure;
- traffic switch bisa dilakukan;
- service draining tersedia;
- plugin compatibility matrix jelas;
- deployment journal dibuat;
- audit trail lengkap.

---

## 15. Blue/Green and Canary for OSGi

OSGi sering diasosiasikan dengan hot deploy, tetapi untuk production besar, blue/green sering lebih aman.

### 15.1 Blue/Green

```text
Blue: current runtime 1.8.0
Green: new runtime 1.9.0

1. Deploy green.
2. Run health/smoke tests.
3. Shift traffic to green.
4. Monitor.
5. Keep blue for rollback window.
```

Kelebihan:

- predictable;
- rollback cepat;
- tidak perlu hot refresh production;
- cocok immutable runtime.

Kekurangan:

- butuh capacity dua runtime;
- DB migration harus compatible;
- background jobs harus single-active atau coordinated.

### 15.2 Canary

```text
Deploy 1.9.0 to small subset.
Route 1% traffic.
Observe.
Increase gradually.
```

OSGi-specific canary checks:

- bundle graph identical across pods;
- DS components all satisfied;
- service registry contains expected services;
- HTTP endpoints registered;
- package wiring no unexpected provider;
- config PID loaded;
- plugin count expected;
- memory/metaspace stable after refresh/start.

### 15.3 Cluster Coordination

OSGi itself is in-process. Multi-node deployment coordination is external.

Need external mechanism for:

- traffic routing;
- leader election;
- job scheduling;
- distributed lock;
- DB migration sequencing;
- message consumer partitioning;
- feature activation consistency.

Do not assume OSGi service registry is cluster-wide unless using explicit remote service/discovery infrastructure.

---

## 16. Containerizing OSGi

Containerizing OSGi is straightforward if runtime is immutable.

### 16.1 Simple Docker Layout

```dockerfile
FROM eclipse-temurin:21-jre

WORKDIR /opt/acme-osgi

COPY target/acme-osgi-runtime/ ./

RUN chmod +x ./bin/start

EXPOSE 8080

ENTRYPOINT ["./bin/start"]
```

### 16.2 Image Contents

```text
/opt/acme-osgi
  /bin
  /etc
  /bundles
  /lib
  /repo
  /data
```

For immutable image:

```text
/bundles and /lib are read-only application artifacts.
/etc may be partially generated from configmap/secret.
/data/cache may be ephemeral.
```

### 16.3 Cache in Container

Recommended:

```text
Use ephemeral framework cache unless mutable plugin state is explicitly supported.
```

If persistent plugin install is required:

- store desired plugin inventory externally;
- mount persistent volume carefully;
- validate cache against inventory;
- support cache rebuild;
- record plugin install journal.

### 16.4 Config and Secrets

Avoid baking environment secrets into image.

Use:

- Kubernetes Secret;
- ConfigMap;
- mounted files;
- external secret provider;
- cloud parameter store;
- runtime Config Admin bridge.

But keep config schema validated.

### 16.5 Readiness Probe

Bad readiness:

```text
JVM process is alive.
```

Better readiness:

```text
- framework started;
- required bundles ACTIVE/RESOLVED as expected;
- DS critical components active;
- HTTP endpoints registered;
- DB connection works;
- message consumer state correct;
- config loaded;
- no mandatory plugin missing.
```

Example readiness response:

```json
{
  "status": "UP",
  "framework": "ACTIVE",
  "release": "1.8.0",
  "bundles": {
    "installed": 142,
    "active": 139,
    "resolved": 3,
    "failed": 0
  },
  "components": {
    "criticalUnsatisfied": 0
  },
  "services": {
    "requiredMissing": []
  }
}
```

### 16.6 Liveness Probe

Liveness should be conservative.

Do not restart pod just because one optional plugin is down.

Liveness should answer:

```text
Is the process irrecoverably stuck/dead?
```

Readiness should answer:

```text
Can this instance safely receive traffic?
```

### 16.7 Graceful Shutdown

OSGi shutdown must allow:

- HTTP server stop accepting new traffic;
- in-flight requests complete;
- message consumers stop polling;
- scheduled jobs stop;
- services unregister;
- DS components deactivate;
- connection pools close;
- framework stop.

Kubernetes termination:

```text
SIGTERM
  -> readiness false
  -> drain
  -> framework stop
  -> exit before terminationGracePeriodSeconds
```

---

## 17. Kubernetes Deployment Model

### 17.1 Deployment YAML Concept

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: acme-osgi-runtime
spec:
  replicas: 3
  selector:
    matchLabels:
      app: acme-osgi-runtime
  template:
    metadata:
      labels:
        app: acme-osgi-runtime
    spec:
      containers:
        - name: runtime
          image: registry.example.com/acme/osgi-runtime:1.8.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: "-XX:MaxRAMPercentage=75"
          volumeMounts:
            - name: config
              mountPath: /opt/acme-osgi/etc/external
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: acme-osgi-config
```

### 17.2 Avoid Shell Mutation in Pods

Bad:

```text
kubectl exec pod -- karaf feature:install x
```

Why bad:

- only one pod changed;
- change lost on restart;
- no audit release artifact;
- drift across replicas;
- impossible deterministic rollback.

Better:

```text
Update image or controlled plugin inventory.
Rollout through Kubernetes.
```

### 17.3 Plugin Inventory as External Desired State

If dynamic plugins are required:

```text
PluginInventory CRD / DB / config file
  -> controller validates plugin signatures
  -> runtime installs approved plugin set
  -> status exported
```

Desired state example:

```yaml
plugins:
  - symbolicName: com.acme.rules.highrisk
    version: 2.3.0
    checksum: sha256:...
    enabled: true
  - symbolicName: com.acme.connector.agency-x
    version: 1.5.1
    checksum: sha256:...
    enabled: false
```

Runtime must converge to desired state, not accept arbitrary shell mutation.

### 17.4 Stateful vs Stateless OSGi Runtime

Stateless runtime:

- bundle graph from image;
- config from configmap/secret;
- cache ephemeral;
- DB/broker external.

Stateful runtime:

- persistent plugin install;
- local cache/data;
- embedded database;
- file-based repository;
- cluster coordination needed.

Prefer stateless unless OSGi platform specifically needs local plugin state.

---

## 18. Offline and Air-Gapped Deployment

Many enterprise/regulatory environments cannot download dependencies from internet at runtime.

### 18.1 Offline Requirements

Need package:

- framework;
- all bundles;
- feature descriptors;
- repository metadata;
- config templates;
- checksums;
- SBOM;
- signatures;
- migration scripts;
- rollback artifact;
- operational docs.

### 18.2 Offline Repository

Options:

- internal Maven repository mirror;
- static OSGi repository XML/index;
- Karaf system repository;
- KAR archive;
- p2 update site mirror;
- container image with bundled repository.

### 18.3 No Runtime Internet Assumption

Bad:

```text
feature:install downloads from Maven Central in production.
```

Good:

```text
All artifacts are pre-mirrored, pinned, scanned, and included in release repository.
```

### 18.4 Offline Validation

CI/CD should test:

```text
Can runtime boot with network disabled except required app dependencies?
```

This catches hidden runtime downloads.

---

## 19. Supply Chain and Artifact Governance

OSGi modularity increases artifact count. More artifacts means more governance needed.

### 19.1 Artifact Immutability

A released artifact must not be overwritten.

Bad:

```text
com.acme.case.impl-1.8.0.jar replaced after release
```

Good:

```text
1.8.0 immutable
1.8.1 for fix
```

### 19.2 Checksums and Signatures

Release should include:

```text
artifact.jar
artifact.jar.sha256
artifact.jar.asc or signature metadata
SBOM
release-manifest.json
```

### 19.3 Release Manifest

Example:

```json
{
  "release": "1.8.0",
  "java": "21",
  "framework": {
    "bsn": "org.apache.felix.framework",
    "version": "7.0.5"
  },
  "bundles": [
    {
      "bsn": "com.acme.case.api",
      "version": "1.8.0",
      "sha256": "..."
    },
    {
      "bsn": "com.acme.case.impl",
      "version": "1.8.3",
      "sha256": "..."
    }
  ],
  "configs": [
    {
      "pid": "com.acme.case",
      "schemaVersion": "1.2.0"
    }
  ]
}
```

Runtime can expose this manifest in diagnostics.

### 19.4 SBOM

Because OSGi runtime has many bundles, SBOM should capture:

- Maven coordinates;
- bundle symbolic name;
- bundle version;
- package exports;
- license;
- checksum;
- vulnerability status.

Mapping Maven artifact to OSGi bundle matters.

### 19.5 Repository Admission Policy

Before artifact enters production repository:

- build provenance valid;
- tests pass;
- resolver test pass;
- baseline check pass;
- vulnerability scan pass;
- license scan pass;
- signature valid;
- metadata complete;
- no forbidden imports;
- no dynamic import unless approved;
- no private package export;
- no split package conflict.

---

## 20. Deployment Pipeline for OSGi

A mature pipeline:

```text
1. Compile/test code.
2. Generate OSGi manifests.
3. Run baseline compatibility check.
4. Publish candidate bundles to staging repository.
5. Resolve application runtime from staging repository.
6. Generate resolved bundle closure.
7. Build distribution/image.
8. Run framework boot test.
9. Run resolver/integration/smoke tests.
10. Generate SBOM and release manifest.
11. Sign artifacts.
12. Promote immutable artifacts to release repository.
13. Deploy to target environment.
14. Verify runtime inventory and health.
15. Record deployment journal.
```

### 20.1 CI Gates

Essential gates:

| Gate | Purpose |
|---|---|
| Manifest check | Detect bad imports/exports early. |
| Baseline check | Prevent incompatible API change. |
| Resolver check | Ensure runtime graph valid. |
| Distribution boot test | Catch start-level/config/extender errors. |
| Service readiness test | Ensure DS components/services available. |
| Security scan | Supply-chain control. |
| SBOM generation | Audit and vulnerability response. |
| Drift comparison | Ensure deployed runtime matches release. |

### 20.2 Release Candidate Repository

Do not publish candidate directly to production repository.

Use:

```text
snapshot repo -> staging repo -> release repo
```

Important:

- release repo immutable;
- staging can be discarded;
- release promotion preserves checksums;
- production resolves only from release repo or prebuilt image.

### 20.3 Environment Promotion

```text
DEV artifact != rebuilt for UAT != rebuilt for PROD
```

Better:

```text
Build once.
Promote same artifact.
Inject environment config separately.
```

This avoids “works in UAT but PROD artifact differs”.

---

## 21. Config Deployment Strategy

OSGi code and config evolve together but must be deployed carefully.

### 21.1 Config as Artifact

Config templates should be versioned.

Example:

```text
config/
  com.acme.case.cfg
  com.acme.audit.cfg
  com.acme.connector.agencyx.cfg
```

But secret values should not be committed.

### 21.2 Config Schema Version

Typed config should include version concept.

```java
@ObjectClassDefinition(name = "Case Management Config")
public @interface CaseConfig {
    String schemaVersion() default "1.2.0";
    int maxOpenCases() default 5000;
    boolean escalationEnabled() default true;
}
```

### 21.3 Config Migration

When config schema changes:

```text
old config -> migration -> new config
```

Migration should be:

- idempotent;
- auditable;
- validated;
- rollback-aware.

### 21.4 Config Loading Race

Problem:

```text
Bundle starts before config is loaded.
Component remains unsatisfied or starts with defaults.
```

Solutions:

- DS configuration policy REQUIRE;
- start config admin/fileinstall before app bundles;
- boot order/start level;
- readiness waits for config-loaded state;
- fail fast for missing required config.

### 21.5 Secrets

Never expose raw secret as service property if unnecessary.

Prefer:

```text
config contains secret reference
runtime secret service resolves actual value
component receives credential object or connection factory
```

---

## 22. Database Migration Coordination

OSGi deployment frequently includes DB migration.

### 22.1 Migration Timing

Options:

| Timing | Pros | Cons |
|---|---|---|
| Before app start | App sees correct schema | Rollback harder if destructive |
| During app start | Self-contained | Race in multi-node |
| Separate migration job | Controlled | More pipeline complexity |
| Lazy migration | Flexible | Hard to reason/test |

Recommended for production:

```text
Separate controlled migration step for non-trivial schema changes.
```

### 22.2 Multi-Node Race

If every pod runs Flyway/Liquibase at startup:

- lock contention;
- partial failure;
- startup delay;
- all pods blocked;
- rollback uncertainty.

Better:

```text
Run migration once as deployment job.
Then start OSGi runtime.
```

### 22.3 Expand/Contract for Rollback

Release N:

```text
Add nullable column / new table.
Code writes old + new.
```

Release N+1:

```text
Code reads new.
```

Release N+2:

```text
Remove old column after rollback window.
```

This is more important than OSGi-specific hot deploy.

---

## 23. Plugin Deployment Model

OSGi shines for plugin platforms. But plugin deployment must be controlled.

### 23.1 Plugin Lifecycle

```text
Submitted
  -> scanned
  -> signed
  -> certified
  -> published to plugin repo
  -> installed in environment
  -> enabled
  -> monitored
  -> disabled
  -> updated/removed
```

### 23.2 Plugin Repository Metadata

Plugin repository should record:

- symbolic name;
- version;
- vendor;
- checksum;
- signature;
- compatible platform versions;
- required API package ranges;
- required capabilities;
- exported packages;
- permissions;
- config schema;
- migration requirements;
- test certification result.

### 23.3 Plugin Compatibility

Plugin should declare platform compatibility:

```text
Require-Capability: \
  com.acme.platform;filter:="(&(platform=case-platform)(version>=1.8.0)(!(version>=2.0.0)))"
```

Or via repository metadata.

### 23.4 Plugin Enablement vs Installation

Installation does not mean enabled.

Better model:

```text
Installed bundle available.
Plugin service only active if config/feature flag enables it.
```

This allows safe preloading.

### 23.5 Plugin Rollback

Plugin rollback must consider:

- plugin config;
- plugin-created data;
- event handlers;
- scheduled jobs;
- service ranking;
- in-flight workflow instances;
- compatibility with platform API.

For workflow/rule plugin:

```text
Do not remove plugin version while active cases still reference its rule version.
```

Use versioned rule identity.

---

## 24. Runtime Inventory and Drift Detection

Production runtime must expose inventory.

### 24.1 Bundle Inventory

Capture:

```text
bundle id
symbolic name
version
state
location
checksum
start level
last modified
```

### 24.2 Wiring Inventory

Capture:

```text
imported package -> exporting bundle/version
required capability -> provider
uses chain
```

### 24.3 Service Inventory

Capture:

```text
service interface
service id
bundle provider
ranking
scope
properties
consumers if available
```

### 24.4 Component Inventory

Capture:

```text
DS component name
state
configuration PID
unsatisfied references
activation errors
```

### 24.5 Compare Against Release Manifest

Algorithm:

```text
releaseManifest.bundles - runtime.bundles = missing
runtime.bundles - releaseManifest.bundles = unexpected
same bsn different version = drift
same bsn/version different checksum = artifact mutation
```

Drift response:

- warn in non-prod;
- fail readiness for critical drift;
- alert production;
- block further update;
- require reconcile.

---

## 25. Deployment Observability

Deployment should emit events.

### 25.1 Deployment Journal

Record:

```text
release id
operator/automation id
start time
end time
source artifact
target environment
bundle count
config version
migration version
health result
rollback point
```

### 25.2 Runtime Events

Emit metrics/logs for:

- bundle install/update/uninstall;
- bundle resolve failure;
- refresh start/end;
- service registration/unregistration;
- DS unsatisfied component;
- config update;
- feature install/uninstall;
- plugin enable/disable;
- readiness transition;
- drift detected.

### 25.3 Deployment Metrics

Examples:

```text
osgi_bundles_total{state="ACTIVE"}
osgi_components_total{state="UNSATISFIED"}
osgi_services_total{objectClass="com.acme.Rule"}
osgi_deployment_release_info{version="1.8.0"}
osgi_runtime_drift_total
osgi_refresh_duration_seconds
osgi_startup_duration_seconds
```

### 25.4 Logs Must Include Release Identity

Every log line should be correlate-able to release:

```text
release=1.8.0 runtimeNode=case-runtime-2 bundle=com.acme.case.impl version=1.8.3
```

---

## 26. Common Deployment Anti-Patterns

### 26.1 Manual Shell Deployment in Production

```shell
feature:install x
bundle:update y
```

without deployment record.

Why bad:

- no reproducibility;
- node drift;
- no approval trail;
- rollback unclear.

### 26.2 Resolve from Internet at Startup

Runtime boot depends on external repository availability and mutable artifacts.

### 26.3 Snapshot Bundles in Production

```text
com.acme.case.impl-1.8.0-SNAPSHOT.jar
```

Never defensible for production.

### 26.4 Overusing Hot Deploy

Using hot deploy for every change because OSGi can.

Reality:

- refresh can disrupt graph;
- state migration still hard;
- observability burden high.

### 26.5 No Release Manifest

If you cannot answer “exactly what is running?”, you do not have production-grade deployment.

### 26.6 Mutable Framework Cache in Immutable Container

Container says image `1.8.0`, cache says bundle `1.9.0`.

### 26.7 Config Drift

Operators edit config directly on server without source of truth.

### 26.8 Feature Descriptor Without Verification

Feature XML installs bundles, but nobody tests whether full graph resolves and starts.

### 26.9 One Giant Feature

All bundles in one feature:

```text
acme-everything
```

Hard to upgrade, test, reason, rollback.

### 26.10 Too Many Tiny Features

Every bundle as a feature.

Operationally noisy and dependency management becomes painful.

### 26.11 Ignoring Java Runtime Version

Deploying Java 21 bytecode into Java 17 runtime.

### 26.12 Mixing javax/jakarta Blindly

Feature includes both old and new API bundles with conflicting web/JPA/JAX-RS runtime.

### 26.13 No Plugin Certification

Letting arbitrary plugin bundle enter runtime because it resolves.

Resolving does not mean safe.

---

## 27. Practical Deployment Patterns

### 27.1 Pattern A — Immutable bnd Distribution

Use when:

- custom OSGi runtime;
- no need Karaf shell/features;
- high reproducibility;
- container deployment.

Flow:

```text
bndrun -> resolve -> export distribution -> build Docker image -> deploy
```

Pros:

- clean;
- lightweight;
- reproducible;
- good for cloud.

Cons:

- you build more operational tooling yourself.

### 27.2 Pattern B — Karaf Custom Distribution

Use when:

- need operational shell;
- features model useful;
- enterprise OSGi server;
- existing Karaf/Fuse ecosystem.

Flow:

```text
build bundles -> build features XML -> verify -> build custom Karaf distro -> deploy
```

Pros:

- mature ops model;
- feature install;
- config/logging/security infrastructure.

Cons:

- heavier;
- Karaf-specific;
- mutable by default unless restricted.

### 27.3 Pattern C — Equinox/p2 Product

Use when:

- Eclipse RCP;
- desktop/plugin product;
- Equinox ecosystem;
- p2 update sites required.

Flow:

```text
plugins -> features -> p2 repository -> product -> p2 director/install/update
```

Pros:

- rich update model;
- product/provisioning metadata;
- strong Eclipse ecosystem fit.

Cons:

- not ideal for generic server OSGi if no Equinox/p2 need.

### 27.4 Pattern D — Hybrid Immutable Core + Dynamic Plugin Repo

Use when:

- regulated platform with extension plugins;
- core must be stable;
- plugins change independently.

Flow:

```text
core runtime image immutable
plugin repo controlled
plugin inventory desired state
runtime installs certified plugin set
```

Pros:

- balances stability and extensibility;
- good governance.

Cons:

- requires plugin lifecycle tooling.

### 27.5 Pattern E — Full Hot Deploy Platform

Use when:

- runtime must install/update modules without restart;
- embedded/edge/desktop/long-lived device;
- strict plugin governance exists.

Pros:

- maximum dynamic capability.

Cons:

- highest operational complexity.

---

## 28. Case Study: Regulatory Enforcement Platform Deployment

Bayangkan platform modular untuk enforcement lifecycle.

### 28.1 Runtime Modules

```text
com.acme.platform.api
com.acme.platform.kernel
com.acme.case.api
com.acme.case.impl
com.acme.audit.api
com.acme.audit.impl
com.acme.workflow.api
com.acme.workflow.impl
com.acme.rules.api
com.acme.rules.engine
com.acme.rules.highrisk
com.acme.rules.renewal
com.acme.notification.api
com.acme.notification.email
com.acme.connector.agency-a
com.acme.connector.agency-b
com.acme.web.case
com.acme.web.admin
```

### 28.2 Feature Design

```text
acme-platform-core
  platform api/kernel
  config admin
  DS runtime
  logging

acme-case-management
  case api/impl/web
  audit api/impl

acme-workflow
  workflow api/impl

acme-rules-base
  rules api/engine

acme-rules-highrisk
  highrisk rule plugin

acme-connectors
  agency connectors
```

### 28.3 Release 1.8.0

Release manifest:

```json
{
  "release": "1.8.0",
  "java": "21",
  "features": [
    "acme-platform-core/1.8.0",
    "acme-case-management/1.8.0",
    "acme-workflow/1.8.0",
    "acme-rules-base/1.8.0",
    "acme-connectors/1.8.0"
  ],
  "plugins": [
    "com.acme.rules.highrisk/2.3.0",
    "com.acme.rules.renewal/1.6.1"
  ]
}
```

### 28.4 Deployment Plan

```text
1. Build release from staging repo.
2. Run resolver and framework boot test.
3. Run DB migration compatibility check.
4. Generate Docker image.
5. Deploy green environment.
6. Run smoke tests:
   - case create
   - workflow escalation
   - rule evaluation
   - audit write
   - notification enqueue
7. Compare runtime inventory to release manifest.
8. Shift traffic.
9. Monitor metrics.
10. Keep blue for rollback window.
```

### 28.5 Plugin Update Scenario

Need update high-risk rule plugin:

```text
com.acme.rules.highrisk 2.3.0 -> 2.3.1
```

Checklist:

- API import range compatible;
- no DB schema change;
- rule output schema unchanged;
- certification tests pass;
- plugin signed;
- service ranking unchanged;
- old plugin drains;
- active cases referencing 2.3.0 still reproducible;
- audit records rule version.

Deployment option:

```text
If core immutable and plugin dynamic allowed:
  update plugin inventory desired state.
  runtime installs 2.3.1.
  disable 2.3.0 only after no active references or route new evaluations to 2.3.1.
```

Better for audit:

```text
Keep old plugin available for historical re-evaluation.
Route new cases to new rule version.
```

---

## 29. Java 8–25 Deployment Considerations

### 29.1 Bytecode Compatibility

Ensure build tool uses correct `--release` or target compatibility.

```text
Runtime Java 8  -> max class file 52
Runtime Java 11 -> max class file 55
Runtime Java 17 -> max class file 61
Runtime Java 21 -> max class file 65
Runtime Java 25 -> max class file 69
```

If bundle bytecode too new:

```text
UnsupportedClassVersionError
```

### 29.2 Execution Environment

Set explicit EE requirement.

```properties
-runee: JavaSE-17
```

Bundle manifest may include requirement for JavaSE capability.

### 29.3 Removed Java EE Modules

For Java 11+, do not assume JAXB/JAX-WS/Activation are in JDK.

Provision them explicitly as bundles if needed.

### 29.4 Strong Encapsulation

For Java 17+, illegal reflective access becomes more painful.

Deployment may need:

```text
--add-opens
--add-exports
```

But treat these as technical debt.

Track them in release manifest.

### 29.5 Security Manager Removal

For Java 24/25, do not rely on Security Manager-based sandboxing.

Deployment governance must use:

- signed artifacts;
- repository admission;
- plugin certification;
- process/container isolation;
- restricted management access.

### 29.6 Virtual Threads

Java 21+ virtual threads may simplify blocking service handlers, but deployment must ensure:

- observability tools handle many virtual threads;
- thread dumps understood;
- libraries compatible;
- OSGi lifecycle still closes executors;
- no ThreadLocal leaks.

### 29.7 Multi-Release JARs

If using MR-JAR:

- verify bnd manifest generation;
- test on all target Java versions;
- avoid changing exported API behavior per JDK unless intentional;
- ensure resolver metadata matches runtime reality.

---

## 30. Operational Runbook

### 30.1 Before Deployment

```text
[ ] Release artifact immutable.
[ ] Release manifest generated.
[ ] SBOM generated.
[ ] Bundle checksums verified.
[ ] Resolver test passed.
[ ] Framework boot test passed.
[ ] DS critical components active in test.
[ ] Config schema validated.
[ ] DB migration plan approved.
[ ] Rollback artifact available.
[ ] Runtime cache strategy defined.
[ ] Health/readiness checks updated.
[ ] Management access locked down.
```

### 30.2 During Deployment

```text
[ ] Drain or route traffic as planned.
[ ] Apply DB migration if required.
[ ] Deploy runtime image/distribution.
[ ] Start runtime.
[ ] Verify bundle inventory.
[ ] Verify wiring/service/component state.
[ ] Verify config loaded.
[ ] Run smoke tests.
[ ] Check logs for resolver/DS errors.
[ ] Enable traffic.
[ ] Monitor error rate/latency/memory.
```

### 30.3 After Deployment

```text
[ ] Save deployment journal.
[ ] Compare runtime inventory to release manifest.
[ ] Confirm no drift.
[ ] Confirm no unexpected bundle refresh loop.
[ ] Confirm no unsatisfied critical components.
[ ] Confirm DB migration version.
[ ] Confirm plugin inventory.
[ ] Keep rollback window active.
```

### 30.4 Rollback

```text
[ ] Stop traffic to bad runtime.
[ ] Confirm rollback compatibility with DB/config.
[ ] Deploy previous distribution/image.
[ ] Clean or switch framework cache if needed.
[ ] Restore previous config if needed.
[ ] Start previous runtime.
[ ] Verify health and inventory.
[ ] Shift traffic.
[ ] Record incident and runtime state.
```

---

## 31. Design Review Checklist

### 31.1 Repository

```text
[ ] Are all production artifacts from internal trusted repository?
[ ] Are artifacts immutable?
[ ] Are checksums/signatures verified?
[ ] Is repository metadata complete?
[ ] Can runtime boot offline?
[ ] Is public internet avoided at runtime?
```

### 31.2 Runtime Assembly

```text
[ ] Is runtime resolved at build/release time?
[ ] Is selected bundle closure pinned?
[ ] Is framework version pinned?
[ ] Is Java runtime version explicit?
[ ] Is start level intentional?
[ ] Are extender bundles included?
[ ] Are config admin/logging/DS available before app bundles?
```

### 31.3 Deployment

```text
[ ] Is deployment artifact immutable?
[ ] Is environment config separated from code?
[ ] Is release promoted, not rebuilt?
[ ] Is runtime cache strategy compatible with deployment model?
[ ] Is readiness service-level, not process-level?
[ ] Is graceful shutdown tested?
```

### 31.4 Update/Rollback

```text
[ ] Is refresh blast radius known?
[ ] Are API package changes baseline-checked?
[ ] Is DB migration backward-compatible?
[ ] Is config migration rollback-aware?
[ ] Is previous artifact available?
[ ] Is runtime inventory exported?
```

### 31.5 Plugin Platform

```text
[ ] Are plugin APIs versioned?
[ ] Are plugins signed/certified?
[ ] Is plugin repository controlled?
[ ] Is plugin compatibility declared?
[ ] Is plugin enablement separate from installation?
[ ] Are active references/versioned workflows handled?
```

---

## 32. Key Heuristics

### 32.1 Resolve Early, Deploy Exact

```text
Use resolver during build/release.
Deploy exact resolved output.
```

### 32.2 Immutable by Default

```text
Mutable runtime is an advanced feature, not default production posture.
```

### 32.3 Hot Update Is Not Free

```text
Every hot update has refresh, state, compatibility, and rollback implications.
```

### 32.4 Feature Is Not Correctness Proof

```text
Feature descriptor groups bundles.
Resolver/integration tests prove the graph works.
```

### 32.5 Rollback Requires State Thinking

```text
Code rollback without config/data/runtime rollback can make things worse.
```

### 32.6 Do Not Hide Runtime Drift

```text
If runtime differs from release manifest, treat it as a production condition.
```

### 32.7 OSGi Dynamics Need Governance

```text
Dynamic install/update is powerful only when policy, audit, and diagnostics exist.
```

---

## 33. Minimal Example: Release Manifest and Runtime Check

### 33.1 Release Manifest

```json
{
  "release": "1.8.0",
  "java": "21",
  "framework": "org.apache.felix.framework:7.0.5",
  "bundles": [
    { "bsn": "org.apache.felix.scr", "version": "2.2.8", "sha256": "..." },
    { "bsn": "org.apache.felix.configadmin", "version": "1.9.26", "sha256": "..." },
    { "bsn": "com.acme.case.api", "version": "1.8.0", "sha256": "..." },
    { "bsn": "com.acme.case.impl", "version": "1.8.3", "sha256": "..." }
  ]
}
```

### 33.2 Runtime Drift Pseudocode

```java
public final class RuntimeDriftChecker {
    public DriftReport compare(ReleaseManifest expected, List<BundleInfo> actual) {
        Map<String, BundleInfo> actualByKey = actual.stream()
            .collect(Collectors.toMap(
                b -> b.symbolicName() + ":" + b.version(),
                Function.identity()
            ));

        List<String> missing = new ArrayList<>();
        List<String> unexpected = new ArrayList<>();
        List<String> checksumMismatch = new ArrayList<>();

        for (ManifestBundle expectedBundle : expected.bundles()) {
            String key = expectedBundle.bsn() + ":" + expectedBundle.version();
            BundleInfo runtimeBundle = actualByKey.get(key);

            if (runtimeBundle == null) {
                missing.add(key);
                continue;
            }

            if (!Objects.equals(expectedBundle.sha256(), runtimeBundle.sha256())) {
                checksumMismatch.add(key);
            }
        }

        Set<String> expectedKeys = expected.bundles().stream()
            .map(b -> b.bsn() + ":" + b.version())
            .collect(Collectors.toSet());

        for (BundleInfo runtimeBundle : actual) {
            String key = runtimeBundle.symbolicName() + ":" + runtimeBundle.version();
            if (!expectedKeys.contains(key)) {
                unexpected.add(key);
            }
        }

        return new DriftReport(missing, unexpected, checksumMismatch);
    }
}
```

### 33.3 What to Do With Drift

```text
No drift:
  ready

Optional unexpected diagnostic bundle:
  warn, depending policy

Missing critical bundle:
  readiness false

Checksum mismatch:
  security incident until proven otherwise
```

---

## 34. Final Mental Model

OSGi provisioning and deployment is about controlling **runtime composition over time**.

The top-level model:

```text
Repository
  contains resources and metadata

Resolver
  selects a valid closure

Distribution
  packages exact runtime composition

Deployment
  installs/runs it in an environment

Runtime
  resolves, wires, starts, and exposes services

Operations
  observe, update, rollback, and audit the runtime
```

The critical invariant:

> Production OSGi runtime must be explainable.

Explainable means you can answer:

```text
What is running?
Why is it running?
Where did it come from?
Which packages are wired to whom?
Which services are registered?
Which configs are active?
Which release does this match?
How do we rollback?
What state will rollback not undo?
```

If you cannot answer these, OSGi dynamics become operational risk.

If you can answer them, OSGi becomes a powerful platform mechanism for modular, evolvable, long-lived systems.

---

## 35. References

Primary references used for this part:

1. OSGi Repository Service Specification — capability/requirement-aware repository model.  
   https://docs.osgi.org/specification/osgi.enterprise/7.0.0/service.repository.html
2. OSGi Core Release 8 Resolver Service Specification — repository and resolver context relationship.  
   https://docs.osgi.org/specification/osgi.core/8.0.0/service.resolver.html
3. bnd/Bndtools Resolving Application Note — using OSGi resolver to select bundles from a repository.  
   https://bndtools.org/appnotes/resolving.html
4. Apache Karaf Provisioning documentation — features and feature repositories.  
   https://karaf.apache.org/manual/latest/provisioning
5. Apache Karaf Maven Plugin documentation — feature verification and custom distribution support.  
   https://karaf.apache.org/manual/latest/karaf-maven-plugin.html
6. Eclipse p2 Provisioning Platform documentation — provisioning and managing Equinox/Eclipse applications.  
   https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/p2_overview.htm
7. Eclipse p2 Director documentation — command-line provisioning.  
   https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/p2_director.html

---

## 36. Ringkasan

Di part ini kita belajar bahwa deployment OSGi bukan sekadar meng-copy bundle, tetapi mengelola runtime composition.

Poin paling penting:

- OSGi deployment harus dipikirkan sebagai graph, bukan list.
- Repository metadata penting karena resolver membutuhkan capability/requirement, bukan hanya Maven coordinates.
- Resolver sebaiknya dipakai saat build/release, lalu output-nya dipin untuk production.
- Karaf features berguna sebagai operational grouping, tetapi tetap perlu verification.
- Equinox p2 cocok untuk product/update-site style provisioning.
- Immutable runtime adalah default paling aman untuk production modern.
- Mutable/hot deploy harus dikontrol dengan inventory, audit, signature, dan rollback strategy.
- Refresh blast radius harus dianalisis sebelum update.
- Rollback mencakup code, config, data, dan runtime state.
- Container/Kubernetes cocok untuk OSGi jika cache, config, readiness, dan graceful shutdown dirancang benar.
- Supply-chain governance menjadi semakin penting karena OSGi runtime terdiri dari banyak artifact.

Part berikutnya akan masuk ke **designing plugin platforms with OSGi**: extension contracts, isolation, plugin governance, compatibility, certification, versioned extension points, dan bagaimana merancang OSGi sebagai platform ekstensi yang serius, bukan sekadar dynamic class loading.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 26 — Performance Engineering: Startup, Resolver Cost, Service Lookup, Classloading, Memory](./26-performance-engineering-startup-resolver-service-lookup-classloading-memory.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 28 — Designing Plugin Platforms with OSGi: Extension Contracts, Isolation, Governance](./28-designing-plugin-platforms-extension-contracts-isolation-governance.md)

</div>