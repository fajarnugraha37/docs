# Learn Java Part 016 — Modules, Packaging, dan Runtime Images

> Target: Java hingga versi 25  
> Audience: software engineer yang ingin memahami Java bukan hanya sebagai bahasa, tetapi sebagai platform deployment yang bisa dikemas, dimodularisasi, di-link, dipaketkan, dan dijalankan secara defensible di production.

---

## Daftar Isi

1. [Orientasi](#1-orientasi)
2. [Masalah yang Ingin Diselesaikan oleh JPMS](#2-masalah-yang-ingin-diselesaikan-oleh-jpms)
3. [Mental Model: Package, Module, Artifact, Runtime Image](#3-mental-model-package-module-artifact-runtime-image)
4. [Classpath vs Module Path](#4-classpath-vs-module-path)
5. [Dasar JPMS](#5-dasar-jpms)
6. [`module-info.java`](#6-module-infojava)
7. [`requires`, `requires transitive`, dan `requires static`](#7-requires-requires-transitive-dan-requires-static)
8. [`exports` vs `opens`](#8-exports-vs-opens)
9. [Service Binding: `uses` dan `provides`](#9-service-binding-uses-dan-provides)
10. [Unnamed Module dan Automatic Module](#10-unnamed-module-dan-automatic-module)
11. [Modular JAR](#11-modular-jar)
12. [Multi-Release JAR](#12-multi-release-jar)
13. [Manifest, Executable JAR, dan Fat JAR](#13-manifest-executable-jar-dan-fat-jar)
14. [JMOD](#14-jmod)
15. [Tooling JPMS](#15-tooling-jpms)
16. [`jdeps`: Dependency Analysis](#16-jdeps-dependency-analysis)
17. [`jlink`: Custom Runtime Image](#17-jlink-custom-runtime-image)
18. [`jpackage`: Native Installer / Application Image](#18-jpackage-native-installer--application-image)
19. [Runtime Image tanpa JMODs di Java Modern](#19-runtime-image-tanpa-jmods-di-java-modern)
20. [Packaging untuk Library vs Application](#20-packaging-untuk-library-vs-application)
21. [Integrasi dengan Maven dan Gradle](#21-integrasi-dengan-maven-dan-gradle)
22. [JPMS dengan Spring, Hibernate, Jackson, dan Reflection-heavy Framework](#22-jpms-dengan-spring-hibernate-jackson-dan-reflection-heavy-framework)
23. [Desain Modular untuk Enterprise / Microservice](#23-desain-modular-untuk-enterprise--microservice)
24. [Migration Strategy: Classpath ke Module Path](#24-migration-strategy-classpath-ke-module-path)
25. [Deployment dan Container](#25-deployment-dan-container)
26. [Security dan Supply Chain](#26-security-dan-supply-chain)
27. [Failure Modes dan Troubleshooting](#27-failure-modes-dan-troubleshooting)
28. [Decision Framework](#28-decision-framework)
29. [Strict Standards](#29-strict-standards)
30. [Latihan Bertahap](#30-latihan-bertahap)
31. [Mini Project: Modular Case Management CLI](#31-mini-project-modular-case-management-cli)
32. [Checklist Penguasaan](#32-checklist-penguasaan)
33. [Referensi Resmi](#33-referensi-resmi)

---

# 1. Orientasi

Bagian ini membahas bagaimana aplikasi Java **disusun, dibatasi, dikemas, di-link, dan didistribusikan**.

Sampai titik ini kita sudah membahas bahasa Java, object model, generics, fitur modern, functional programming, collections, error handling, concurrency, I/O, text/time, JVM internal, memory/GC, observability, dan security. Sekarang kita masuk ke lapisan yang sering dianggap “urusan build/deploy”, padahal sangat menentukan kualitas sistem:

- apakah boundary antar package jelas;
- apakah internal API benar-benar tertutup;
- apakah dependency graph dapat dijelaskan;
- apakah aplikasi bisa dikemas secara reproducible;
- apakah runtime bisa dikecilkan;
- apakah deployment artifact aman dan mudah dioperasikan;
- apakah upgrade Java tidak menghancurkan sistem karena ketergantungan ke internal API;
- apakah framework reflection seperti Spring/Hibernate/Jackson masih bisa bekerja;
- apakah packaging cocok untuk CLI, service, desktop app, container, atau library.

**Inti bagian ini:** Java modern bukan hanya `java -jar app.jar`. Java modern memberi beberapa level artifact:

```text
source code
  -> class files
  -> JAR / modular JAR / JMOD
  -> module graph
  -> custom runtime image
  -> application image / native installer / container image
```

JPMS atau Java Platform Module System menambahkan satu konsep penting di atas package: **module**.

Package mengorganisasi nama.
Module mengorganisasi **boundary**.

Package menjawab:

> Class ini namanya apa dan berada di namespace mana?

Module menjawab:

> Package mana yang boleh dipakai dunia luar, dependency mana yang dibaca module ini, package mana yang boleh direfleksi, dan service mana yang disediakan/dikonsumsi?

---

# 2. Masalah yang Ingin Diselesaikan oleh JPMS

Sebelum Java 9, aplikasi Java besar biasanya hidup di classpath.

Classpath sederhana:

```bash
java -cp app.jar:lib/a.jar:lib/b.jar com.example.Main
```

Di Windows:

```powershell
java -cp "app.jar;lib\a.jar;lib\b.jar" com.example.Main
```

Secara mental, classpath adalah **daftar lokasi pencarian class**.

Masalahnya: classpath terlalu permisif.

## 2.1 Masalah 1 — Tidak ada strong encapsulation antar artifact

Misal library punya package:

```text
com.payment.api
com.payment.internal
```

Tanpa module system, class public di `com.payment.internal` tetap bisa diakses oleh aplikasi lain selama ada di classpath:

```java
import com.payment.internal.DangerousPaymentDebugTool;
```

Selama class itu `public`, compiler dapat mengaksesnya.

Artinya, `internal` hanya konvensi nama, bukan aturan platform.

JPMS mengubah ini:

```java
module com.payment {
    exports com.payment.api;
}
```

Package `com.payment.internal` tidak diekspor, sehingga tidak dapat diakses dari module lain walaupun class-nya `public`.

**Mental model:**

```text
public sebelum JPMS:
  public bagi semua code di classpath

public dalam module:
  public hanya berarti dapat diakses jika package-nya diekspor dan module pembaca punya readability
```

## 2.2 Masalah 2 — Dependency graph tidak eksplisit

Classpath tidak memaksa JAR menyatakan dependency-nya.

Aplikasi bisa jalan karena kebetulan semua JAR ada di folder `lib/`.

Masalah muncul ketika:

- ada JAR hilang;
- ada versi dependency berbeda;
- ada duplicate class;
- ada library memakai class internal JDK;
- ada transitive dependency yang tidak sengaja dipakai langsung;
- ada cycle dependency antar package/artifact;
- ada deployment environment berbeda dari development environment.

JPMS membuat dependency module eksplisit:

```java
module com.case.app {
    requires com.case.domain;
    requires com.case.persistence;
    requires java.logging;
}
```

Module graph menjadi bagian dari desain.

## 2.3 Masalah 3 — JDK terlalu besar untuk semua aplikasi

Sebelum modular JDK, aplikasi kecil tetap memakai distribusi runtime besar.

Dengan JPMS dan `jlink`, kita bisa membuat runtime image yang hanya berisi module yang dibutuhkan:

```bash
jlink \
  --add-modules com.case.cli \
  --module-path mods:$JAVA_HOME/jmods \
  --output image/case-cli
```

Lalu jalan:

```bash
image/case-cli/bin/case-cli
```

Runtime image ini bisa lebih kecil, lebih predictable, dan bisa dipaketkan sebagai aplikasi mandiri.

## 2.4 Masalah 4 — Internal JDK API sering dipakai sembarangan

Banyak library lama memakai internal API seperti:

```java
sun.misc.Unsafe
com.sun.*
jdk.internal.*
```

Sebagian memang historis penting, tetapi ini membuat upgrade Java rapuh.

JPMS memperkuat encapsulation JDK internal. Akibatnya, migrasi dari Java 8 ke Java modern sering menemukan error seperti:

```text
java.lang.IllegalAccessError
java.lang.reflect.InaccessibleObjectException
```

Ini bukan bug kecil. Ini tanda bahwa sistem bergantung pada detail implementasi yang tidak pernah dijanjikan sebagai API stabil.

---

# 3. Mental Model: Package, Module, Artifact, Runtime Image

Untuk tidak bingung, bedakan empat konsep ini.

## 3.1 Package

Package adalah namespace source/class:

```java
package com.case.domain;

public final class CaseId { }
```

Package membantu:

- menghindari konflik nama;
- mengelompokkan class;
- memberi package-private visibility;
- membentuk struktur source tree;
- memberi level organisasi paling dasar.

Namun package bukan artifact deployment.

## 3.2 Module

Module adalah unit boundary JPMS.

Module punya descriptor:

```java
module com.case.domain {
    exports com.case.domain.api;
}
```

Module bisa:

- membaca module lain;
- mengekspor package;
- membuka package untuk reflection;
- memakai service;
- menyediakan service implementation.

Module bukan sekadar folder. Module adalah **contract antara code dan platform**.

## 3.3 Artifact

Artifact adalah file hasil build/deploy, misalnya:

- `.class`;
- `.jar`;
- modular `.jar`;
- multi-release `.jar`;
- `.jmod`;
- fat/uber JAR;
- distribution ZIP;
- Docker image;
- native installer.

Module bisa dikemas sebagai modular JAR.

## 3.4 Runtime image

Runtime image adalah directory berisi runtime Java siap jalan.

Contoh full JDK image:

```text
jdk-25/
  bin/
  conf/
  legal/
  lib/
  release
```

Custom runtime image dari `jlink` bisa berisi:

```text
case-runtime/
  bin/
    java
    case-cli
  conf/
  legal/
  lib/
  release
```

Runtime image bukan JAR. Runtime image adalah Java runtime yang sudah di-link dengan module tertentu.

## 3.5 Layer mental model

```text
Package
  boundary kecil di source code

Module
  boundary arsitektur dan readability

JAR / Modular JAR
  packaging artifact

JMOD
  packaging khusus untuk module + native/config metadata, terutama untuk jlink/JDK module

Runtime Image
  executable Java runtime yang berisi module yang dibutuhkan

Application Image / Installer
  package final untuk user / deployment target
```

---

# 4. Classpath vs Module Path

## 4.1 Classpath

Classpath adalah model legacy, tetap sangat banyak dipakai.

```bash
java -cp "app.jar:lib/*" com.example.Main
```

Semua class di classpath masuk ke **unnamed module**.

Karakter classpath:

- simple;
- kompatibel dengan library lama;
- cocok untuk banyak framework enterprise;
- tidak punya strong module boundary;
- dependency graph tidak diekspresikan oleh platform;
- duplicate class bisa menjadi masalah runtime;
- urutan classpath dapat memengaruhi class yang dipakai.

## 4.2 Module path

Module path adalah lokasi module observable.

```bash
java \
  --module-path mods \
  --module com.case.cli/com.case.cli.Main
```

Atau singkat:

```bash
java -p mods -m com.case.cli/com.case.cli.Main
```

Karakter module path:

- module harus punya nama;
- dependency graph diselesaikan oleh module system;
- package internal tidak otomatis dapat diakses;
- split package antar module named tidak diperbolehkan;
- module descriptor menentukan API/reflective boundary;
- bisa dipakai oleh `jlink` untuk custom runtime.

## 4.3 Perbedaan fundamental

| Aspek | Classpath | Module Path |
|---|---|---|
| Boundary | Tidak kuat | Kuat |
| Dependency declaration | External/build-tool | `module-info.java` |
| Internal package | Bisa diakses jika public | Tidak bisa kecuali exported/opened |
| Reflection | Umumnya bebas | Dikontrol `opens` |
| Duplicate package | Bisa terjadi | Split package antar named module ditolak |
| Custom runtime | Tidak langsung | Natural dengan `jlink` |
| Cocok untuk | Legacy, framework heavy, quick app | Library kuat, platform modular, runtime image |

## 4.4 Jangan salah framing

JPMS bukan pengganti Maven/Gradle.

Maven/Gradle menjawab:

> Dependency versi berapa yang harus diunduh, dibuild, dites, dipublish?

JPMS menjawab:

> Pada compile/run/link time, module mana membaca module mana, package mana yang diekspos, dan package mana yang dibuka untuk reflection?

Keduanya bisa bekerja bersama, tetapi berada di level berbeda.

---

# 5. Dasar JPMS

JPMS menambahkan beberapa konsep:

- named module;
- unnamed module;
- automatic module;
- module descriptor;
- readability;
- accessibility;
- exports;
- opens;
- services;
- module resolution;
- module graph.

## 5.1 Named module

Named module memiliki nama eksplisit di `module-info.java`:

```java
module com.case.domain {
    exports com.case.domain;
}
```

## 5.2 Module descriptor

Descriptor adalah metadata module yang dikompilasi menjadi:

```text
module-info.class
```

Biasanya source-nya:

```text
src/main/java/module-info.java
```

## 5.3 Readability

Module A dapat menggunakan public types dari Module B hanya jika:

1. A membaca B; dan
2. B mengekspor package yang berisi type tersebut; dan
3. type/member yang digunakan accessible menurut aturan Java visibility.

Contoh:

```java
module com.case.app {
    requires com.case.domain;
}
```

```java
module com.case.domain {
    exports com.case.domain.api;
}
```

`com.case.app` bisa memakai public class di `com.case.domain.api`, tetapi tidak bisa memakai public class di `com.case.domain.internal`.

## 5.4 Accessibility

JPMS menambahkan satu lapisan di atas Java visibility.

```text
Untuk mengakses class public dari module lain:
  module harus readable
  package harus exported
  class/member harus public atau sesuai visibility Java
```

## 5.5 Strong encapsulation

Strong encapsulation berarti class public di package non-exported tetap tidak bisa diakses dari luar module.

Ini sangat penting untuk desain library.

Tanpa JPMS:

```text
public internal class = bisa dipakai orang
```

Dengan JPMS:

```text
public internal class + package tidak exported = tetap internal
```

---

# 6. `module-info.java`

`module-info.java` adalah pusat deklarasi module.

Contoh sederhana:

```java
module com.case.domain {
    exports com.case.domain.api;
}
```

Contoh lebih realistis:

```java
module com.case.application {
    requires com.case.domain;
    requires com.case.audit;
    requires java.logging;

    exports com.case.application.api;

    uses com.case.application.spi.EscalationPolicy;
}
```

Contoh provider:

```java
module com.case.defaultpolicy {
    requires com.case.application;

    provides com.case.application.spi.EscalationPolicy
        with com.case.defaultpolicy.DefaultEscalationPolicy;
}
```

## 6.1 Directive utama

```java
requires other.module;
requires transitive other.module;
requires static other.module;

exports com.example.api;
exports com.example.internal to other.module;

opens com.example.model;
opens com.example.model to com.fasterxml.jackson.databind;

uses com.example.spi.Plugin;
provides com.example.spi.Plugin with com.example.impl.DefaultPlugin;
```

## 6.2 Struktur source multi-module manual

Contoh:

```text
project/
  src/
    com.case.domain/
      module-info.java
      com/case/domain/api/CaseId.java
      com/case/domain/internal/CaseRules.java
    com.case.cli/
      module-info.java
      com/case/cli/Main.java
```

Compile:

```bash
mkdir -p out
javac \
  --module-source-path src \
  -d out \
  $(find src -name "*.java")
```

Run:

```bash
java \
  --module-path out \
  --module com.case.cli/com.case.cli.Main
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force out | Out-Null
$files = Get-ChildItem src -Recurse -Filter *.java | ForEach-Object { $_.FullName }
javac --module-source-path src -d out $files
java --module-path out --module com.case.cli/com.case.cli.Main
```

---

# 7. `requires`, `requires transitive`, dan `requires static`

## 7.1 `requires`

```java
module com.case.app {
    requires com.case.domain;
}
```

Artinya module `com.case.app` membaca `com.case.domain`.

Jika `com.case.domain` mengekspor package `com.case.domain.api`, maka `com.case.app` bisa memakai public type di package itu.

## 7.2 `requires transitive`

Ini sering salah dipakai.

```java
module com.case.application {
    requires transitive com.case.domain;
    exports com.case.application.api;
}
```

Artinya: siapa pun yang `requires com.case.application` secara implisit juga membaca `com.case.domain`.

Gunakan jika API module kamu mengekspos type dari dependency itu.

Contoh:

```java
package com.case.application.api;

import com.case.domain.api.CaseId;

public interface CaseQueryService {
    CaseView findById(CaseId id);
}
```

Karena `CaseId` dari `com.case.domain` muncul di public API `com.case.application`, consumer `com.case.application` juga perlu membaca `com.case.domain`.

Maka:

```java
module com.case.application {
    requires transitive com.case.domain;
    exports com.case.application.api;
}
```

**Rule praktis:**

```text
Dependency muncul di public exported API -> requires transitive layak dipertimbangkan.
Dependency hanya implementation detail -> requires biasa.
```

## 7.3 `requires static`

```java
module com.case.app {
    requires static org.jetbrains.annotations;
}
```

Artinya dependency dibutuhkan saat compile, tetapi optional saat runtime.

Use case:

- annotation compile-time;
- static analysis annotation;
- optional integration API;
- annotation processor compile-time only.

Jangan pakai `requires static` untuk dependency yang benar-benar dipanggil saat runtime.

## 7.4 `java.base` selalu implisit

Setiap module otomatis membaca `java.base`, kecuali `java.base` sendiri.

Jadi ini tidak perlu:

```java
module com.case.domain {
    requires java.base; // tidak perlu
}
```

## 7.5 Dependency direction

Module descriptor seharusnya mencerminkan arsitektur.

Contoh buruk:

```java
module com.case.domain {
    requires com.case.persistence;
    requires com.case.web;
}
```

Domain bergantung ke persistence/web adalah arah dependency yang bocor.

Contoh lebih baik:

```text
com.case.domain
  tidak requires infrastructure

com.case.application
  requires com.case.domain

com.case.persistence
  requires com.case.domain
  provides repository implementation

com.case.web
  requires com.case.application
```

---

# 8. `exports` vs `opens`

Ini bagian paling penting untuk API design dan framework reflection.

## 8.1 `exports`

```java
module com.case.domain {
    exports com.case.domain.api;
}
```

`exports` berarti package boleh diakses secara compile-time dan runtime oleh module lain.

Jika public class berada di package exported, module lain bisa mengimpor dan memanggilnya.

## 8.2 Qualified exports

```java
module com.case.domain {
    exports com.case.domain.internal to com.case.testkit;
}
```

Artinya package hanya diekspor ke module tertentu.

Use case:

- testing module;
- migration bridge;
- internal tooling;
- limited integration.

Jangan jadikan qualified export sebagai dumping ground. Kalau terlalu banyak, boundary module kamu mungkin salah.

## 8.3 `opens`

```java
module com.case.domain {
    opens com.case.domain.model to com.fasterxml.jackson.databind;
}
```

`opens` memberi akses reflective runtime, bukan compile-time API access.

Package yang di-open tidak otomatis bisa diimport compile-time oleh module lain.

Use case:

- Jackson serialization/deserialization;
- Hibernate/JPA field access;
- dependency injection reflection;
- testing reflection;
- frameworks yang perlu inspect private members.

## 8.4 Qualified opens

Lebih aman:

```java
opens com.case.domain.model to com.fasterxml.jackson.databind;
```

Daripada:

```java
opens com.case.domain.model;
```

Yang pertama hanya membuka ke module tertentu.
Yang kedua membuka ke semua module.

## 8.5 `open module`

```java
open module com.case.app {
    requires com.case.domain;
    requires spring.context;
}
```

`open module` membuka semua package untuk deep reflection.

Ini bisa praktis untuk aplikasi framework-heavy, tetapi melemahkan encapsulation reflection.

**Rule praktis:**

```text
Library modular serius:
  Hindari open module.
  Pakai qualified opens jika perlu.

Application Spring/Hibernate pragmatis:
  open module bisa dipakai sementara, tapi catat sebagai architectural debt.
```

## 8.6 Tabel `exports` vs `opens`

| Directive | Compile-time access | Runtime normal access | Deep reflection | Use case |
|---|---:|---:|---:|---|
| `exports p` | Ya | Ya | Tidak otomatis | Public API |
| `exports p to m` | Ya, hanya ke m | Ya, hanya ke m | Tidak otomatis | Friend module |
| `opens p` | Tidak | Tidak sebagai API | Ya | Reflection broad |
| `opens p to m` | Tidak | Tidak sebagai API | Ya, hanya ke m | Reflection controlled |
| `open module` | Tergantung exports | Tergantung exports | Semua package open | Framework-heavy app |

## 8.7 Prinsip API/public/internal

```text
exports = ini API yang saya janjikan.
opens = ini bukan API, tapi framework boleh refleksi.
non-exported + non-opened = benar-benar internal.
```

---

# 9. Service Binding: `uses` dan `provides`

JPMS punya service mechanism yang bekerja dengan `ServiceLoader`.

## 9.1 SPI mental model

SPI memisahkan:

- interface service;
- consumer service;
- provider implementation.

Contoh domain:

```java
package com.case.policy.spi;

public interface EscalationPolicy {
    EscalationDecision evaluate(CaseContext context);
}
```

Module SPI:

```java
module com.case.policy.api {
    exports com.case.policy.spi;
}
```

Consumer:

```java
module com.case.application {
    requires com.case.policy.api;
    uses com.case.policy.spi.EscalationPolicy;
}
```

Provider:

```java
module com.case.policy.defaultimpl {
    requires com.case.policy.api;

    provides com.case.policy.spi.EscalationPolicy
        with com.case.policy.defaultimpl.DefaultEscalationPolicy;
}
```

Runtime:

```java
ServiceLoader<EscalationPolicy> loader = ServiceLoader.load(EscalationPolicy.class);
EscalationPolicy policy = loader.findFirst()
    .orElseThrow(() -> new IllegalStateException("No escalation policy provider"));
```

## 9.2 Kenapa service binding penting?

Tanpa service binding, app sering melakukan:

```java
new DefaultEscalationPolicy()
```

Ini membuat application bergantung langsung ke implementation.

Dengan service:

```text
application -> SPI
provider -> SPI
runtime module graph binds provider
```

Ini berguna untuk:

- plugin architecture;
- alternate implementation;
- environment-specific provider;
- test provider;
- product edition;
- compliance/regulatory policy variant.

## 9.3 `jlink --bind-services`

Saat membuat runtime image, service provider bisa ikut di-link:

```bash
jlink \
  --module-path mods:$JAVA_HOME/jmods \
  --add-modules com.case.cli \
  --bind-services \
  --output image/case-cli
```

Gunakan ketika aplikasi menggunakan `ServiceLoader` dan provider harus ikut runtime image.

---

# 10. Unnamed Module dan Automatic Module

## 10.1 Unnamed module

Semua JAR di classpath masuk unnamed module.

```bash
java -cp "lib/*:app.jar" com.case.Main
```

Karakter unnamed module:

- membaca banyak named modules secara default menurut root resolution rules;
- tidak punya `module-info.java`;
- code di dalamnya dapat saling melihat seperti classpath biasa;
- berguna untuk compatibility;
- bukan solusi modular jangka panjang.

## 10.2 Automatic module

JAR non-modular di module path menjadi automatic module.

```bash
java --module-path lib --module com.case.app/com.case.Main
```

Jika `lib/legacy-json.jar` tidak punya `module-info.class`, ia bisa menjadi automatic module.

Nama module otomatis bisa berasal dari:

1. manifest `Automatic-Module-Name` jika ada;
2. nama file JAR jika tidak ada.

Contoh:

```text
legacy-json-1.2.3.jar -> legacy.json
```

Ini rapuh karena nama file berubah bisa mengubah nama module.

## 10.3 Gunakan `Automatic-Module-Name` untuk library belum modular

Library yang belum punya `module-info.java` dapat menambahkan manifest:

```text
Automatic-Module-Name: com.vendor.legacyjson
```

Ini membantu consumer modular membutuhkan nama module stabil.

## 10.4 Automatic module sebagai bridge, bukan tujuan akhir

Automatic module berguna untuk migrasi bertahap, tetapi ada trade-off:

- nama bisa tidak stabil jika tidak ditentukan manifest;
- dependency tidak eksplisit;
- encapsulation tidak sekuat named module proper;
- bisa menyembunyikan masalah split package;
- service/opens/export behavior tidak sepresisi module descriptor.

**Rule praktis:**

```text
Gunakan automatic module untuk migrasi.
Jangan desain sistem baru bergantung permanen pada automatic module jika library bisa dimodularisasi.
```

---

# 11. Modular JAR

Modular JAR adalah JAR yang memiliki `module-info.class` di root.

```text
case-domain.jar
  module-info.class
  com/case/domain/api/CaseId.class
  com/case/domain/internal/CaseRules.class
```

## 11.1 Membuat modular JAR manual

Misal output compile:

```text
out/com.case.domain/
  module-info.class
  com/case/domain/api/CaseId.class
```

Buat JAR:

```bash
jar \
  --create \
  --file mods/com.case.domain.jar \
  --module-version 1.0.0 \
  -C out/com.case.domain .
```

Cek descriptor:

```bash
jar --describe-module --file mods/com.case.domain.jar
```

## 11.2 Menentukan main class module

```bash
jar \
  --create \
  --file mods/com.case.cli.jar \
  --main-class com.case.cli.Main \
  -C out/com.case.cli .
```

Lalu:

```bash
java --module-path mods --module com.case.cli
```

Atau eksplisit:

```bash
java --module-path mods --module com.case.cli/com.case.cli.Main
```

## 11.3 Modular JAR vs ordinary JAR

| Aspek | Ordinary JAR | Modular JAR |
|---|---|---|
| Descriptor | Manifest opsional | `module-info.class` |
| Bisa di classpath | Ya | Ya, tapi jadi unnamed module behavior |
| Bisa di module path | Bisa sebagai automatic module jika non-modular | Ya sebagai named module |
| Strong encapsulation | Tidak | Ya |
| `jlink` friendly | Tidak langsung | Ya |

## 11.4 Modular JAR bisa tetap dipakai di classpath

Jika modular JAR dijalankan di classpath:

```bash
java -cp mods/com.case.domain.jar:mods/com.case.cli.jar com.case.cli.Main
```

Maka descriptor module tidak dipakai sebagai boundary runtime named module.

Ini penting untuk compatibility, tetapi juga berarti encapsulation JPMS tidak aktif seperti module path.

---

# 12. Multi-Release JAR

Multi-release JAR memungkinkan satu JAR berisi class versi berbeda untuk target JDK berbeda.

Struktur:

```text
foo.jar
  META-INF/MANIFEST.MF
  com/example/Foo.class
  META-INF/versions/17/com/example/Foo.class
  META-INF/versions/25/com/example/Foo.class
```

Manifest:

```text
Multi-Release: true
```

Saat dijalankan di JDK 25, runtime mencari versi paling sesuai.

## 12.1 Use case

- library ingin mendukung Java 11 dan Java 25;
- ingin memakai API baru jika tersedia;
- ingin mempertahankan baseline lama;
- ingin optimasi khusus JDK baru.

## 12.2 Risiko

Multi-release JAR meningkatkan kompleksitas:

- testing matrix bertambah;
- API consistency harus dijaga;
- bug bisa hanya muncul di JDK tertentu;
- build lebih rumit;
- source maintenance lebih berat.

## 12.3 Rule praktis

Gunakan multi-release JAR jika kamu membuat library yang benar-benar perlu mendukung banyak JDK baseline sambil memanfaatkan fitur baru.

Jangan gunakan hanya untuk “terlihat modern”.

---

# 13. Manifest, Executable JAR, dan Fat JAR

## 13.1 Manifest

JAR bisa punya manifest:

```text
META-INF/MANIFEST.MF
```

Contoh:

```text
Manifest-Version: 1.0
Main-Class: com.case.Main
```

Buat executable JAR:

```bash
jar --create --file app.jar --main-class com.case.Main -C out .
```

Run:

```bash
java -jar app.jar
```

## 13.2 Thin JAR

Thin JAR berisi code aplikasi saja. Dependency tetap di luar.

```text
app.jar
lib/a.jar
lib/b.jar
```

Run:

```bash
java -cp "app.jar:lib/*" com.case.Main
```

Kelebihan:

- dependency jelas;
- lebih kecil per artifact;
- layer Docker bisa lebih optimal;
- mudah inspect dependency.

Kekurangan:

- distribusi butuh banyak file;
- runtime classpath harus benar.

## 13.3 Fat / Uber JAR

Fat JAR menggabungkan aplikasi + dependency ke satu file.

Kelebihan:

- distribusi sederhana;
- cocok untuk service deployment;
- `java -jar app.jar` mudah.

Kekurangan:

- module boundary hilang/terdistorsi;
- duplicate resource bisa konflik;
- service provider files perlu merge;
- signed JAR bisa rusak;
- class shadowing bisa terjadi;
- sulit audit dependency asli;
- tidak natural untuk `jlink`.

## 13.4 Spring Boot executable JAR

Spring Boot punya layout executable JAR sendiri, misalnya dependency berada di nested JAR.

Ini bukan ordinary flat classpath JAR biasa.

Konsekuensi:

- launcher khusus dipakai;
- `jdeps` kadang perlu unpack/konfigurasi;
- JPMS full modularity biasanya tidak menjadi jalur utama untuk Spring Boot app;
- packaging production sering lebih pragmatis memakai container + layered jar.

## 13.5 Jangan samakan artifact convenience dengan architecture boundary

Fat JAR memudahkan deployment, tetapi tidak menggantikan modular design.

Kamu bisa tetap mendesain internal modulith dengan package/module boundary walaupun final artifact-nya fat JAR.

---

# 14. JMOD

JMOD adalah format module packaging yang diperkenalkan bersama JPMS.

JMOD bisa berisi lebih dari class/resource:

- class files;
- native libraries;
- native commands;
- configuration files;
- legal notices.

JMOD biasanya dipakai untuk JDK modules dan input `jlink`, bukan untuk runtime classpath biasa.

## 14.1 Kenapa bukan selalu pakai JMOD?

JMOD tidak dirancang sebagai replacement JAR untuk distribusi umum.

Rule praktis:

```text
Library umum -> JAR / modular JAR
Application module -> modular JAR, lalu jlink jika perlu
JDK/native-heavy module untuk jlink -> JMOD bisa relevan
```

## 14.2 JAR vs JMOD

| Aspek | JAR | JMOD |
|---|---|---|
| Runtime classpath | Ya | Tidak |
| Module path | Ya jika modular/automatic | Ya untuk tools seperti jlink |
| Berisi native command/config | Terbatas | Ya |
| Distribusi library umum | Umum | Tidak umum |
| Dipakai `jlink` | Ya jika modular JAR | Ya |

---

# 15. Tooling JPMS

Tool penting:

- `javac` untuk compile module;
- `java` untuk run named module;
- `jar` untuk modular JAR;
- `jdeps` untuk dependency analysis;
- `jlink` untuk runtime image;
- `jpackage` untuk installer/application image;
- `jmod` untuk JMOD;
- `jimage` untuk inspect runtime image;
- `javap` untuk inspect class/module-info.

## 15.1 Compile module manual

Single module:

```bash
javac -d out $(find src/main/java -name "*.java")
```

Multi-module:

```bash
javac \
  --module-source-path src \
  -d out \
  $(find src -name "*.java")
```

Compile app dengan dependency module path:

```bash
javac \
  --module-path mods \
  -d out/com.case.cli \
  src/com.case.cli/module-info.java \
  src/com.case.cli/com/case/cli/Main.java
```

## 15.2 Run named module

```bash
java \
  --module-path mods \
  --module com.case.cli/com.case.cli.Main
```

Atau:

```bash
java -p mods -m com.case.cli/com.case.cli.Main
```

## 15.3 Inspect module

```bash
java --describe-module java.sql
```

```bash
jar --describe-module --file mods/com.case.domain.jar
```

```bash
javap -v out/com.case.domain/module-info.class
```

---

# 16. `jdeps`: Dependency Analysis

`jdeps` adalah tool static dependency analysis untuk class/JAR/module.

## 16.1 Kapan pakai `jdeps`?

Gunakan saat:

- ingin melihat dependency module yang dibutuhkan aplikasi;
- migrasi Java 8 ke Java modern;
- ingin mendeteksi penggunaan internal JDK API;
- ingin membuat daftar module untuk `jlink`;
- ingin memecah monolith menjadi module;
- ingin memahami dependency graph dari artifact pihak ketiga.

## 16.2 Basic usage

```bash
jdeps app.jar
```

Summary:

```bash
jdeps --summary app.jar
```

Class-level:

```bash
jdeps --verbose:class app.jar
```

Package-level:

```bash
jdeps --verbose:package app.jar
```

## 16.3 Detect JDK internal API

```bash
jdeps --jdk-internals app.jar
```

Jika output menunjukkan `sun.*` atau `jdk.internal.*`, itu warning serius untuk migrasi.

## 16.4 Generate module info

Untuk JAR legacy:

```bash
jdeps \
  --generate-module-info generated \
  legacy-lib.jar
```

Atau open module:

```bash
jdeps \
  --generate-open-module generated \
  legacy-reflection-heavy.jar
```

Hasil ini harus direview manual. Jangan langsung dianggap desain final.

## 16.5 Print deps untuk `jlink`

```bash
jdeps \
  --print-module-deps \
  --ignore-missing-deps \
  --module-path mods \
  mods/com.case.cli.jar
```

Output bisa berupa:

```text
java.base,java.logging,java.sql,com.case.domain
```

Lalu dipakai:

```bash
jlink \
  --module-path mods:$JAVA_HOME/jmods \
  --add-modules $(jdeps --print-module-deps --module-path mods mods/com.case.cli.jar) \
  --output image/case-cli
```

## 16.6 Limitasi `jdeps`

`jdeps` bersifat static analysis.

Ia tidak selalu melihat:

- class yang diload via reflection;
- class name dari string config;
- service provider yang hanya muncul runtime;
- optional dependency;
- generated proxy;
- native dependency.

Jadi `jdeps` adalah alat bukti kuat, tapi bukan oracle sempurna.

---

# 17. `jlink`: Custom Runtime Image

`jlink` membuat runtime image dari module dan transitive dependency-nya.

## 17.1 Mental model

Tanpa `jlink`:

```text
app.jar + full JDK/JRE installed elsewhere
```

Dengan `jlink`:

```text
custom runtime image berisi:
  - java launcher
  - module aplikasi
  - module JDK yang diperlukan
  - dependency module yang diperlukan
```

## 17.2 Basic command

```bash
jlink \
  --module-path mods:$JAVA_HOME/jmods \
  --add-modules com.case.cli \
  --launcher case-cli=com.case.cli/com.case.cli.Main \
  --output image/case-cli
```

Run:

```bash
image/case-cli/bin/case-cli
```

Windows:

```powershell
.\image\case-cli\bin\case-cli.bat
```

## 17.3 Common useful options

```bash
jlink \
  --module-path mods:$JAVA_HOME/jmods \
  --add-modules com.case.cli \
  --launcher case-cli=com.case.cli/com.case.cli.Main \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output image/case-cli
```

Penjelasan:

- `--strip-debug`: buang debug info;
- `--no-header-files`: tidak sertakan header files;
- `--no-man-pages`: tidak sertakan man pages;
- `--compress=2`: ZIP compression untuk resources;
- `--launcher`: buat executable launcher;
- `--bind-services`: include provider service jika pakai ServiceLoader.

## 17.4 Kapan `jlink` berguna?

Sangat berguna untuk:

- CLI tool;
- desktop app;
- appliance-like service;
- container image minimal;
- environment tanpa JDK terinstall;
- deterministic runtime;
- aplikasi modular yang tidak terlalu framework-heavy.

Kurang natural untuk:

- Spring Boot fat JAR tradisional;
- aplikasi dengan banyak dynamic class loading;
- plugin yang berubah setelah image dibuat;
- framework yang module graph-nya sulit distabilkan;
- aplikasi yang ingin update dependency tanpa rebuild runtime.

## 17.5 Siapa yang update runtime image?

Ini sering dilupakan.

Jika kamu ship custom runtime image, kamu juga bertanggung jawab patch security runtime itu.

Dengan full JDK/JRE managed by platform, patching bisa dilakukan lewat OS/base image.

Dengan `jlink` image, patching berarti rebuild dan redeploy image.

**Rule production:**

```text
Custom runtime image harus masuk patch management pipeline.
```

## 17.6 `jlink` bukan obfuscation/security boundary

Custom runtime lebih kecil, tetapi bukan berarti source/logic aman dari reverse engineering.

Jangan anggap `jlink` sebagai proteksi IP.

---

# 18. `jpackage`: Native Installer / Application Image

`jpackage` mengambil aplikasi Java + runtime image dan menghasilkan application image atau package native platform.

Contoh format:

- Windows: `exe`, `msi`;
- macOS: `dmg`, `pkg`;
- Linux: `deb`, `rpm`;
- app-image: directory aplikasi tanpa installer.

## 18.1 Packaging non-modular app

```bash
jpackage \
  --type app-image \
  --input target/lib \
  --main-jar case-cli.jar \
  --name CaseCLI
```

Jika tidak diberi runtime image, `jpackage` dapat menghasilkan runtime memakai `jlink`.

## 18.2 Packaging modular app

```bash
jpackage \
  --type app-image \
  --module-path mods \
  --module com.case.cli/com.case.cli.Main \
  --name CaseCLI
```

## 18.3 Menggunakan custom runtime

```bash
jpackage \
  --type app-image \
  --runtime-image image/case-runtime \
  --module-path mods \
  --module com.case.cli/com.case.cli.Main \
  --name CaseCLI
```

## 18.4 Platform-specific build

`jpackage` tidak cross-platform.

Jika ingin menghasilkan:

- `.exe`/`.msi`, build di Windows;
- `.dmg`/`.pkg`, build di macOS;
- `.deb`/`.rpm`, build di Linux.

Ini harus tercermin di CI/CD matrix.

## 18.5 Use case `jpackage`

Cocok untuk:

- desktop app;
- internal tool;
- CLI yang dibagikan ke non-engineer;
- installer enterprise;
- aplikasi yang harus jalan tanpa preinstalled JDK.

Kurang perlu untuk:

- microservice containerized;
- library;
- server app yang selalu jalan di orchestrator;
- aplikasi yang cukup didistribusikan sebagai Docker image.

---

# 19. Runtime Image tanpa JMODs di Java Modern

Di JDK modern, ada peningkatan `jlink` terkait linking runtime image tanpa JMODs jika JDK dibangun dengan capability tersebut.

Motivasinya: JMOD files dalam full JDK memakan ukuran signifikan. Di cloud/container environment, ukuran JDK memengaruhi network transfer, cache, storage, dan build speed.

## 19.1 Apa artinya untuk engineer?

Kamu tidak perlu mengubah command `jlink` normal.

Tetapi kamu perlu tahu:

- tidak semua vendor JDK mengaktifkan capability ini;
- `jlink --help` dapat menunjukkan capability linking from runtime image;
- behavior detail bisa berbeda antar distribusi;
- beberapa restriction berlaku jika JDK tidak membawa JMOD files.

## 19.2 Practical check

```bash
jlink --help
```

Cari bagian capability seperti:

```text
Capabilities:
    Linking from run-time image enabled
```

atau disabled.

## 19.3 Implikasi container

Jika vendor JDK menyediakan image lebih kecil karena JMOD tidak disertakan, itu bisa mengurangi ukuran base image.

Tetapi jangan asumsikan semua JDK 25 distribution identik.

**Rule:**

```text
Pin vendor + version + build metadata di CI/CD.
Verifikasi jlink capability di pipeline.
```

---

# 20. Packaging untuk Library vs Application

## 20.1 Library

Prioritas library:

- API stabil;
- binary compatibility;
- minimal transitive dependency;
- module name stabil;
- no hidden runtime side effect;
- clear exported packages;
- no accidental internal API;
- semantic versioning.

Packaging yang umum:

- ordinary JAR;
- modular JAR;
- multi-release JAR jika perlu;
- publish ke Maven repository.

Jangan publish fat JAR sebagai library umum kecuali benar-benar dimaksudkan.

## 20.2 Application

Prioritas application:

- mudah dijalankan;
- mudah diobservasi;
- mudah dipatch;
- dependency lengkap;
- startup predictable;
- configuration externalized;
- artifact cocok deployment target.

Packaging umum:

- executable JAR;
- Spring Boot JAR;
- distribution ZIP;
- Docker image;
- jlink runtime image;
- jpackage app image/installer.

## 20.3 CLI Tool

Pilihan bagus:

- modular JAR + jlink image;
- jpackage app-image;
- GraalVM native image jika startup ekstrem penting dan compatibility ok;
- plain executable script wrapper jika internal.

## 20.4 Microservice

Pilihan umum:

- layered executable JAR dalam container;
- distro ZIP + JVM base image;
- jlink runtime image jika module graph stabil;
- buildpack image.

## 20.5 Desktop App

Pilihan umum:

- jpackage;
- bundled runtime;
- signed installer jika distribusi ke end user.

---

# 21. Integrasi dengan Maven dan Gradle

## 21.1 Maven basic modular project

Struktur single module:

```text
case-domain/
  pom.xml
  src/main/java/module-info.java
  src/main/java/com/case/domain/api/CaseId.java
```

`module-info.java`:

```java
module com.case.domain {
    exports com.case.domain.api;
}
```

Maven compiler plugin perlu memakai release target:

```xml
<properties>
    <maven.compiler.release>25</maven.compiler.release>
</properties>
```

## 21.2 Maven multi-module vs JPMS module

Jangan bingung:

- Maven module = subproject build unit;
- JPMS module = Java platform module.

Biasanya satu Maven module menghasilkan satu JPMS module, tetapi tidak wajib.

Praktik yang sehat:

```text
root pom
  case-domain        -> module com.case.domain
  case-application   -> module com.case.application
  case-persistence   -> module com.case.persistence
  case-cli           -> module com.case.cli
```

## 21.3 Gradle modular project

Gradle Java plugin dapat compile source dengan `module-info.java` jika struktur benar.

Contoh minimal:

```kotlin
plugins {
    java
    application
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

application {
    mainModule.set("com.case.cli")
    mainClass.set("com.case.cli.Main")
}
```

## 21.4 Build tool tetap mengelola dependency version

JPMS tidak mengunduh dependency.

Maven/Gradle tetap mengelola:

- version;
- transitive dependency;
- conflict resolution;
- repository;
- build lifecycle;
- testing;
- packaging plugin;
- publication.

JPMS mengelola:

- readability;
- exports/opens;
- service binding;
- module graph;
- link-time image.

---

# 22. JPMS dengan Spring, Hibernate, Jackson, dan Reflection-heavy Framework

JPMS paling menantang ketika framework membutuhkan reflection.

## 22.1 Jackson

Jackson biasanya perlu:

- membaca constructor;
- membaca field/getter/setter;
- instantiate class;
- access record component;
- deserialize private/protected members tergantung config.

Jika package tidak dibuka, error bisa muncul.

Contoh:

```java
module com.case.domain {
    requires com.fasterxml.jackson.databind;

    exports com.case.domain.api;
    opens com.case.domain.api to com.fasterxml.jackson.databind;
}
```

Untuk record DTO public dengan canonical constructor, kebutuhan `opens` bisa lebih sedikit, tetapi jangan asumsikan tanpa test.

## 22.2 Hibernate/JPA

Hibernate sering butuh reflection/proxy/enhancement.

Contoh:

```java
module com.case.persistence {
    requires jakarta.persistence;
    requires org.hibernate.orm.core;

    opens com.case.persistence.entity to org.hibernate.orm.core;
}
```

Entity package biasanya tidak perlu `exports` ke semua orang. Ia butuh `opens` untuk Hibernate.

## 22.3 Spring

Spring ecosystem historically classpath-friendly.

Untuk JPMS, kamu bisa:

1. tetap pakai classpath;
2. pakai module path dengan selective opens;
3. pakai `open module` untuk pragmatis;
4. membatasi JPMS pada library/domain module, sementara app Spring tetap classpath.

Contoh pragmatic:

```java
open module com.case.webapp {
    requires spring.boot;
    requires spring.boot.autoconfigure;
    requires spring.context;
    requires spring.web;

    requires com.case.application;
}
```

Namun untuk library domain:

```java
module com.case.domain {
    exports com.case.domain.api;
}
```

## 22.4 Strategi realistis enterprise

Untuk sistem Spring Boot enterprise, sering lebih masuk akal:

```text
Internal code organization:
  strict package/module architecture via build rules/checkstyle/archunit

JPMS:
  digunakan untuk shared library, CLI, tooling, atau domain module tertentu

Deployment:
  tetap executable JAR/container
```

JPMS tidak harus dipaksakan ke seluruh sistem jika framework/dependency belum siap.

---

# 23. Desain Modular untuk Enterprise / Microservice

## 23.1 Module bukan microservice

Module adalah boundary dalam satu runtime/process.
Microservice adalah deployment/runtime boundary.

Jangan samakan.

```text
JPMS module:
  compile/link/runtime readability boundary

Microservice:
  network/deployment/data ownership boundary
```

## 23.2 Module untuk modulith

JPMS dapat membantu modulith:

```text
com.reg.case.domain
com.reg.case.application
com.reg.case.persistence
com.reg.case.api
com.reg.case.audit
com.reg.case.policy
com.reg.case.cli
```

## 23.3 Dependency direction contoh

```text
case-api
  requires case-application

case-application
  requires case-domain
  requires case-policy-api
  uses EscalationPolicy

case-domain
  no framework dependency

case-persistence
  requires case-domain
  provides CaseRepository

case-policy-default
  requires case-policy-api
  provides EscalationPolicy
```

## 23.4 Module boundary sebagai regulatory defensibility

Untuk regulatory/case management platform, modularity membantu menjawab:

- logic enforcement ada di mana;
- policy rule ada di mana;
- audit event dibuat di mana;
- persistence detail tidak bocor ke domain;
- package internal tidak dipakai sembarangan;
- dependency direction bisa dibuktikan;
- state transition API jelas.

Ini bukan hanya technical cleanliness. Ini mendukung auditability.

## 23.5 Package export pattern

Contoh:

```text
com.reg.case.domain.api       exported
com.reg.case.domain.model     maybe exported if true domain API
com.reg.case.domain.internal  not exported
com.reg.case.domain.rule      not exported or exported qualified to tests
com.reg.case.domain.event     exported if event contract public
```

## 23.6 Jangan over-modularize

Tanda over-modularization:

- terlalu banyak module kecil;
- module descriptor lebih banyak dari value-nya;
- qualified exports/opens di mana-mana;
- cycle dependency sering terjadi;
- developer bingung menaruh code;
- build lambat tanpa manfaat boundary;
- refactoring kecil menyentuh banyak module.

Rule:

```text
Module harus merepresentasikan boundary yang benar-benar berarti.
Bukan setiap package menjadi module.
```

---

# 24. Migration Strategy: Classpath ke Module Path

## 24.1 Jangan big bang

Migrasi JPMS paling aman dilakukan bertahap.

Urutan:

1. pastikan build reproducible;
2. jalankan `jdeps`;
3. hilangkan JDK internal API;
4. tambahkan `Automatic-Module-Name` untuk library internal;
5. modularisasi library leaf terlebih dahulu;
6. pisahkan API dan internal package;
7. tambahkan `module-info.java`;
8. test di module path;
9. tangani reflection dengan `opens`;
10. baru pertimbangkan `jlink`.

## 24.2 Leaf-first migration

Mulai dari module yang paling sedikit dependency:

```text
common-id
common-time
case-domain
case-policy-api
case-application
case-persistence
case-web
```

Jangan mulai dari web application utama jika dependency-nya paling kompleks.

## 24.3 Gunakan `jdeps` sebagai evidence

```bash
jdeps --summary target/*.jar
jdeps --jdk-internals target/app.jar
jdeps --generate-module-info generated target/legacy.jar
```

Dokumentasikan hasil:

```text
Evidence:
  target/case-domain.jar -> java.base only
  target/case-app.jar -> java.base, java.logging, com.case.domain
  no JDK internal API found
```

## 24.4 Handle split package

Split package terjadi ketika package sama ada di lebih dari satu module.

Contoh buruk:

```text
case-domain.jar: com.case.common.Id
case-common.jar: com.case.common.ClockProvider
```

Di classpath mungkin jalan. Di module path named modules, ini problem.

Solusi:

- gabungkan package ke satu module;
- rename package;
- pisahkan namespace lebih jelas;
- hindari package generik seperti `com.company.common` di banyak artifact.

## 24.5 Handle reflection error

Error umum:

```text
java.lang.reflect.InaccessibleObjectException:
Unable to make field private ... accessible:
module com.case.domain does not opens com.case.domain.model to com.fasterxml.jackson.databind
```

Solusi descriptor:

```java
opens com.case.domain.model to com.fasterxml.jackson.databind;
```

Solusi command-line sementara:

```bash
--add-opens com.case.domain/com.case.domain.model=com.fasterxml.jackson.databind
```

Namun command-line `--add-opens` sebaiknya dianggap migration workaround, bukan desain final.

## 24.6 Handle automatic module names

Jika dependency belum modular, cek nama:

```bash
jar --describe-module --file lib/legacy.jar
```

Jika nama tidak stabil, vendor library sebaiknya menambahkan manifest:

```text
Automatic-Module-Name: com.vendor.legacy
```

---

# 25. Deployment dan Container

## 25.1 Pilihan deployment Java service

Beberapa opsi:

```text
1. java -jar app.jar di base image JRE/JDK
2. layered jar + container
3. distro ZIP + lib folder
4. jlink custom runtime + app modules
5. jpackage installer/app image
```

## 25.2 Container dengan full runtime

Contoh Dockerfile sederhana:

```dockerfile
FROM eclipse-temurin:25-jre
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Kelebihan:

- simple;
- mudah patch base image;
- cocok untuk Spring Boot;
- familiar.

Kekurangan:

- runtime lebih besar;
- dependency boundary tidak dikuatkan oleh JPMS.

## 25.3 Container dengan jlink image

Build stage:

```dockerfile
FROM eclipse-temurin:25-jdk AS build
WORKDIR /src
COPY . .
RUN ./gradlew clean build
RUN jlink \
    --module-path build/libs:$JAVA_HOME/jmods \
    --add-modules com.case.cli \
    --launcher case-cli=com.case.cli/com.case.cli.Main \
    --strip-debug \
    --no-header-files \
    --no-man-pages \
    --compress=2 \
    --output /opt/case-runtime

FROM debian:stable-slim
COPY --from=build /opt/case-runtime /opt/case-runtime
ENTRYPOINT ["/opt/case-runtime/bin/case-cli"]
```

Kelebihan:

- image bisa lebih kecil;
- runtime deterministic;
- tidak butuh full JDK di runtime layer.

Risiko:

- patching runtime butuh rebuild;
- module graph harus stabil;
- framework dynamic behavior perlu diuji.

## 25.4 Container nuance

Perhatikan:

- CA certificates;
- timezone data;
- locale data;
- DNS resolver;
- glibc/musl compatibility;
- native libraries;
- SSL provider;
- JFR/diagnostic tools tidak selalu ada jika runtime diperkecil;
- shell tidak selalu ada di distroless image.

Jika butuh troubleshooting production, jangan menghilangkan semua tool tanpa strategi debug.

---

# 26. Security dan Supply Chain

## 26.1 Artifact integrity

JAR berbasis ZIP. Perlu perhatikan:

- duplicate entries;
- path traversal entries;
- signed JAR integrity;
- dependency provenance;
- SBOM;
- checksum;
- reproducible build;
- vulnerability scan.

`jar --validate` dapat membantu memvalidasi beberapa integrity issue pada JAR.

## 26.2 Strong encapsulation sebagai security hardening

JPMS bukan sandbox penuh, tetapi strong encapsulation membantu mengurangi accidental access ke internal implementation.

Ini berguna untuk:

- library public API discipline;
- mengurangi misuse internal class;
- membatasi reflection jika tidak dibuka;
- mengurangi coupling terhadap JDK internals.

## 26.3 `opens` adalah security-sensitive

Setiap `opens` berarti memberikan reflective access.

Audit:

```java
opens com.case.domain.model;
```

Pertanyaan:

- siapa yang butuh?
- apakah bisa qualified?
- apakah package itu berisi secret/private state?
- apakah hanya untuk test?
- apakah bisa diganti DTO/record public constructor?

Lebih baik:

```java
opens com.case.domain.model to com.fasterxml.jackson.databind;
```

## 26.4 Dependency minimization

Module system dan `jlink` membantu mengurangi runtime surface, tetapi dependency minimization tetap perlu di build tool.

Audit:

```bash
mvn dependency:tree
./gradlew dependencies
jdeps --summary app.jar
jdeps --jdk-internals app.jar
```

## 26.5 Signed JAR dan `jlink`

Saat modular signed JAR di-link, signature-related files dapat menjadi issue. `jlink` punya opsi `--ignore-signing-information`, tetapi ini harus dipakai dengan penuh kesadaran karena signature tidak ikut disalin ke runtime image.

Rule:

```text
Jangan memakai --ignore-signing-information tanpa security review.
```

---

# 27. Failure Modes dan Troubleshooting

## 27.1 `Module not found`

```text
Error occurred during initialization of boot layer
java.lang.module.FindException: Module com.case.cli not found
```

Kemungkinan:

- JAR tidak ada di module path;
- JAR bukan modular dan nama automatic module berbeda;
- salah path separator;
- output compile bukan format module expected;
- module name salah.

Debug:

```bash
jar --describe-module --file mods/com.case.cli.jar
java --list-modules
java --module-path mods --describe-module com.case.cli
```

## 27.2 `Package is declared in module X, which does not export it`

```text
package com.case.domain.internal is not visible
```

Penyebab:

- code luar memakai package internal;
- module descriptor memang tidak mengekspor package tersebut;
- desain boundary dilanggar.

Solusi terbaik:

- pindahkan API ke exported package;
- jangan expose internal;
- buat facade public.

Solusi sementara:

```java
exports com.case.domain.internal to com.case.migration;
```

## 27.3 `InaccessibleObjectException`

Penyebab:

- reflection ke package yang tidak opened.

Solusi:

```java
opens com.case.model to com.fasterxml.jackson.databind;
```

Atau migration workaround:

```bash
--add-opens com.case.domain/com.case.model=com.fasterxml.jackson.databind
```

## 27.4 `NoClassDefFoundError`

Di modular environment, bisa muncul karena:

- dependency tidak di module graph;
- classpath/module path mix salah;
- optional dependency tidak ada runtime;
- service provider tidak ikut di-link;
- multi-release class mismatch.

Debug:

```bash
jdeps --missing-deps app.jar
jdeps --print-module-deps app.jar
java --show-module-resolution -p mods -m com.case.cli
```

## 27.5 Split package error

```text
Package com.case.common in both module com.case.a and module com.case.b
```

Solusi:

- jangan split package;
- rename package;
- gabungkan module;
- pisahkan namespace.

## 27.6 Service provider tidak ditemukan

Jika memakai `ServiceLoader` dan `jlink`, provider bisa tidak ikut jika tidak menjadi root/bound.

Solusi:

```bash
jlink --bind-services ...
```

Atau tambahkan provider module:

```bash
--add-modules com.case.cli,com.case.policy.defaultimpl
```

## 27.7 `UnsupportedClassVersionError`

Penyebab:

- compile dengan JDK lebih baru daripada runtime.

Contoh:

```text
class file version 69.0
```

Java 25 memakai class file major version 69.

Solusi:

- runtime harus JDK 25+;
- atau compile dengan `--release` target yang lebih rendah.

---

# 28. Decision Framework

## 28.1 Haruskah memakai JPMS?

Gunakan JPMS jika:

- membuat library yang ingin boundary kuat;
- membuat CLI/tool yang cocok jlink;
- membuat modular platform/plugin;
- ingin enforce architecture boundary di compile/link time;
- ingin custom runtime image;
- dependency graph cukup stabil;
- framework reflection bisa dikontrol.

Tunda/full pragmatic jika:

- aplikasi Spring Boot besar dengan banyak reflection;
- dependency belum modular dan banyak automatic module rapuh;
- tim belum siap memahami module boundary;
- deployment sudah efektif dengan container/fat JAR;
- migrasi akan menghambat delivery tanpa benefit jelas.

## 28.2 Haruskah memakai `jlink`?

Gunakan jika:

- app modular;
- runtime ingin kecil/deterministic;
- distribusi ke environment tanpa JDK;
- CLI/desktop/internal tool;
- image size penting;
- patch pipeline siap rebuild runtime.

Jangan paksa jika:

- module graph tidak stabil;
- app bergantung dynamic plugin;
- service framework-heavy sulit di-link;
- patch management belum jelas.

## 28.3 Haruskah memakai `jpackage`?

Gunakan jika:

- butuh installer native;
- user bukan engineer;
- desktop app;
- internal enterprise tool;
- aplikasi harus self-contained.

Tidak perlu jika:

- aplikasi microservice containerized;
- library;
- distribusi cukup Docker image atau JAR.

## 28.4 `exports` atau `opens`?

```text
Class perlu dipakai compile-time oleh consumer?
  -> exports

Framework perlu reflection runtime?
  -> opens, preferably qualified

Keduanya?
  -> exports + opens qualified jika perlu

Tidak perlu dipakai luar?
  -> jangan exports, jangan opens
```

## 28.5 Modular JAR atau fat JAR?

```text
Library/API reusable:
  modular JAR jika siap, ordinary JAR dengan Automatic-Module-Name jika belum

Microservice Spring Boot:
  executable/layered fat JAR sering lebih pragmatis

CLI modular:
  modular JAR + jlink

Desktop app:
  modular JAR + jlink + jpackage
```

---

# 29. Strict Standards

## 29.1 Module naming

Wajib:

```text
com.company.product.area
```

Contoh:

```java
module com.acme.enforcement.case.domain { }
module com.acme.enforcement.case.application { }
module com.acme.enforcement.case.persistence { }
```

Hindari:

```java
module domain { }
module app { }
module common { }
```

## 29.2 Package naming

Package harus mencerminkan ownership:

```text
com.acme.enforcement.case.domain.api
com.acme.enforcement.case.domain.internal
com.acme.enforcement.case.application.command
com.acme.enforcement.case.persistence.jpa
```

Hindari package generik lintas module:

```text
com.acme.common
com.acme.util
com.acme.shared
```

Kecuali benar-benar module shared yang jelas contract-nya.

## 29.3 Exports policy

Wajib:

- export hanya package API;
- internal package tidak diekspor;
- qualified export harus diberi komentar alasan;
- jangan export package `internal`, `impl`, `config`, `entity` tanpa review.

Contoh:

```java
module com.case.domain {
    exports com.case.domain.api;

    // Test/migration bridge only. Remove after migration ticket CASE-1234.
    exports com.case.domain.internal to com.case.domain.testkit;
}
```

## 29.4 Opens policy

Wajib:

- prefer qualified opens;
- hindari broad opens;
- `open module` hanya untuk application module, bukan library;
- setiap opens harus punya alasan framework.

Contoh:

```java
opens com.case.persistence.entity to org.hibernate.orm.core;
opens com.case.api.dto to com.fasterxml.jackson.databind;
```

## 29.5 Requires policy

Wajib:

- `requires transitive` hanya jika dependency muncul di exported API;
- `requires static` hanya untuk compile-time optional dependency;
- domain module tidak bergantung ke framework infrastructure;
- application module boleh membaca domain dan SPI;
- infrastructure module bergantung ke domain/application contract, bukan sebaliknya.

## 29.6 Artifact policy

Library:

- jangan publish fat JAR;
- module name stabil;
- semantic versioning;
- no accidental dependency leak.

Application:

- artifact harus punya runbook;
- artifact harus bisa di-scan;
- runtime version harus tercatat;
- build harus reproducible.

## 29.7 Runtime image policy

Jika memakai `jlink`:

- catat JDK vendor/version/build;
- include patch pipeline;
- test TLS/cert/timezone/locale;
- test JFR/diagnostic availability;
- document module list;
- jangan strip tool yang dibutuhkan ops tanpa alternatif.

---

# 30. Latihan Bertahap

## Latihan 1 — Ordinary JAR

Buat aplikasi sederhana:

```java
package com.example;

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello packaging");
    }
}
```

Compile:

```bash
javac -d out src/com/example/Main.java
```

Package:

```bash
jar --create --file app.jar --main-class com.example.Main -C out .
```

Run:

```bash
java -jar app.jar
```

Pahami:

- apa isi manifest;
- apa isi JAR;
- apa beda `java -jar` dan `java -cp`.

## Latihan 2 — Modular JAR

Buat:

```text
src/com.example.app/module-info.java
src/com.example.app/com/example/app/Main.java
```

`module-info.java`:

```java
module com.example.app {
}
```

Compile:

```bash
javac --module-source-path src -d out $(find src -name "*.java")
```

Package:

```bash
jar --create --file mods/com.example.app.jar -C out/com.example.app .
```

Run:

```bash
java -p mods -m com.example.app/com.example.app.Main
```

## Latihan 3 — Exports/internal

Buat module `com.example.domain`:

```java
module com.example.domain {
    exports com.example.domain.api;
}
```

Buat class public di:

```text
com.example.domain.api.PublicCase
com.example.domain.internal.InternalRule
```

Coba import `InternalRule` dari module lain. Pastikan gagal.

## Latihan 4 — Reflection with opens

Buat class DTO package non-opened.

Coba access private field via reflection dari module lain.

Lalu tambahkan:

```java
opens com.example.domain.dto to com.example.reflector;
```

Pahami bedanya dengan `exports`.

## Latihan 5 — ServiceLoader

Buat:

```text
com.example.policy.api
com.example.policy.defaultimpl
com.example.app
```

Gunakan `uses` dan `provides`.

Run dengan module path.

Lalu buat `jlink --bind-services`.

## Latihan 6 — `jdeps`

Jalankan:

```bash
jdeps --summary app.jar
jdeps --print-module-deps app.jar
jdeps --jdk-internals app.jar
```

Catat dependency graph.

## Latihan 7 — `jlink`

Buat custom image:

```bash
jlink \
  --module-path mods:$JAVA_HOME/jmods \
  --add-modules com.example.app \
  --launcher example=com.example.app/com.example.app.Main \
  --output image/example
```

Cek:

```bash
image/example/bin/java --list-modules
image/example/bin/example
```

## Latihan 8 — `jpackage`

Buat app-image:

```bash
jpackage \
  --type app-image \
  --module-path mods \
  --module com.example.app/com.example.app.Main \
  --name ExampleApp
```

Jalankan application image.

---

# 31. Mini Project: Modular Case Management CLI

## 31.1 Tujuan

Membangun CLI modular untuk case management sederhana:

```text
case create --type COMPLAINT --subject "Noise issue"
case escalate --case-id C-001
case audit --case-id C-001
```

## 31.2 Module design

```text
com.reg.case.domain
com.reg.case.application
com.reg.case.policy.api
com.reg.case.policy.defaultimpl
com.reg.case.audit
com.reg.case.cli
```

## 31.3 Descriptor

### `com.reg.case.domain`

```java
module com.reg.case.domain {
    exports com.reg.case.domain.api;
    exports com.reg.case.domain.event;
}
```

### `com.reg.case.policy.api`

```java
module com.reg.case.policy.api {
    requires com.reg.case.domain;
    exports com.reg.case.policy.api;
}
```

### `com.reg.case.policy.defaultimpl`

```java
module com.reg.case.policy.defaultimpl {
    requires com.reg.case.domain;
    requires com.reg.case.policy.api;

    provides com.reg.case.policy.api.EscalationPolicy
        with com.reg.case.policy.defaultimpl.DefaultEscalationPolicy;
}
```

### `com.reg.case.application`

```java
module com.reg.case.application {
    requires transitive com.reg.case.domain;
    requires com.reg.case.policy.api;
    requires java.logging;

    exports com.reg.case.application.api;

    uses com.reg.case.policy.api.EscalationPolicy;
}
```

### `com.reg.case.cli`

```java
module com.reg.case.cli {
    requires com.reg.case.application;
}
```

## 31.4 Architecture constraint

Wajib:

- domain tidak bergantung ke application;
- domain tidak bergantung ke CLI;
- domain tidak bergantung ke persistence/framework;
- application memakai SPI policy;
- policy implementation dipilih via ServiceLoader;
- CLI hanya orchestration input/output;
- audit event tidak dibuat di UI layer.

## 31.5 Build manual

```bash
mkdir -p out mods image
javac --module-source-path src -d out $(find src -name "*.java")

for module in com.reg.case.domain com.reg.case.policy.api com.reg.case.policy.defaultimpl com.reg.case.application com.reg.case.cli; do
  jar --create --file mods/$module.jar -C out/$module .
done
```

Run:

```bash
java \
  --module-path mods \
  --module com.reg.case.cli/com.reg.case.cli.Main create --type COMPLAINT --subject "Noise issue"
```

Custom image:

```bash
jlink \
  --module-path mods:$JAVA_HOME/jmods \
  --add-modules com.reg.case.cli \
  --bind-services \
  --launcher case=com.reg.case.cli/com.reg.case.cli.Main \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress=2 \
  --output image/case
```

Run:

```bash
image/case/bin/case create --type COMPLAINT --subject "Noise issue"
```

## 31.6 Expected learning outcome

Setelah mini project ini, kamu harus bisa menjelaskan:

- kenapa domain exported package sedikit;
- kenapa policy implementation tidak direfer langsung;
- kenapa `uses/provides` lebih fleksibel;
- kenapa `--bind-services` diperlukan;
- kenapa `requires transitive` dipakai/tidak dipakai;
- kenapa runtime image harus dipatch;
- apa beda JAR, modular JAR, runtime image, dan app image.

---

# 32. Checklist Penguasaan

Kamu benar-benar memahami bagian ini jika bisa menjawab tanpa menghafal:

## 32.1 Conceptual checklist

- Apa beda package, module, JAR, JMOD, runtime image?
- Apa problem utama classpath?
- Apa itu readability?
- Apa beda readability dan accessibility?
- Kenapa public class tidak selalu accessible di JPMS?
- Apa beda `exports` dan `opens`?
- Kapan memakai qualified exports?
- Kapan memakai qualified opens?
- Kenapa `open module` berisiko untuk library?
- Apa itu unnamed module?
- Apa itu automatic module?
- Kenapa automatic module name harus stabil?
- Apa itu split package dan kenapa berbahaya?
- Apa itu modular JAR?
- Apa itu multi-release JAR?
- Apa fungsi manifest `Main-Class`?
- Apa risiko fat JAR?
- Apa itu JMOD?
- Apa fungsi `jdeps`?
- Apa limitasi `jdeps`?
- Apa fungsi `jlink`?
- Apa tanggung jawab patching custom runtime image?
- Apa fungsi `jpackage`?
- Kenapa `jpackage` tidak cross-platform?

## 32.2 Practical checklist

Kamu harus bisa melakukan:

- compile single module manual;
- compile multi-module manual;
- membuat modular JAR;
- inspect descriptor dengan `jar --describe-module`;
- run named module dengan `java -p -m`;
- memakai `jdeps --summary`;
- memakai `jdeps --jdk-internals`;
- memakai `jdeps --print-module-deps`;
- membuat `jlink` runtime image;
- menambahkan launcher `jlink`;
- menjalankan custom runtime image;
- membuat app-image dengan `jpackage`;
- debug `Module not found`;
- debug `InaccessibleObjectException`;
- menyelesaikan split package;
- menentukan `exports`/`opens` minimal.

## 32.3 Architecture checklist

Untuk setiap module, kamu harus bisa menjawab:

- Apa tanggung jawab module ini?
- Package mana yang benar-benar API?
- Package mana yang internal?
- Dependency mana yang implementation detail?
- Dependency mana yang muncul di exported API?
- Apakah butuh `requires transitive`?
- Apakah butuh `opens`?
- Apakah opens qualified?
- Apakah module ini library atau application?
- Apakah module ini layak masuk runtime image?
- Bagaimana module ini dipatch dan diobservasi?

---

# 33. Referensi Resmi

1. OpenJDK — JDK 25 Project  
   https://openjdk.org/projects/jdk/25/

2. JEP 261 — Module System  
   https://openjdk.org/jeps/261

3. Java Language Specification SE 25 — Chapter 7: Packages and Modules  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-7.html

4. Oracle JDK 25 Documentation  
   https://docs.oracle.com/en/java/javase/25/

5. `jar` Command — Java SE 25 Tool Specifications  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/jar.html

6. `jdeps` Command — Java SE 25 Tool Specifications  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/jdeps.html

7. `jlink` Command — Java SE 25 Tool Specifications  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html

8. `jpackage` Command — Java SE 25 Tool Specifications  
   https://docs.oracle.com/en/java/javase/25/docs/specs/man/jpackage.html

9. Oracle JDK 25 jpackage Guide — Packaging Overview  
   https://docs.oracle.com/en/java/javase/25/jpackage/packaging-overview.html

10. Oracle JDK 25 jpackage Guide — Basic Packaging  
    https://docs.oracle.com/en/java/javase/25/jpackage/basic-packaging.html

11. `jdk.jlink` Module API — Java SE 25  
    https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jlink/module-summary.html

12. `jdk.jdeps` Module API — Java SE 25  
    https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jdeps/module-summary.html

13. JEP 493 — Linking Run-Time Images without JMODs  
    https://openjdk.org/jeps/493

---

## Ringkasan Akhir

Bagian ini penting karena kualitas sistem Java modern tidak hanya ditentukan oleh class dan method, tetapi juga oleh bagaimana boundary dan artifact-nya dibangun.

Mental model paling penting:

```text
Package memberi namespace.
Module memberi boundary.
JAR memberi artifact.
JMOD memberi module artifact khusus untuk linking/native/config.
jlink memberi runtime image.
jpackage memberi aplikasi/installer self-contained.
```

Engineer Java yang kuat tidak hanya bisa menulis kode, tetapi juga bisa menjawab:

- dependency mana yang benar-benar API;
- package mana yang internal;
- framework mana yang butuh reflection;
- artifact mana yang cocok untuk deployment target;
- runtime mana yang harus dipatch;
- tool mana yang dipakai untuk membuktikan dependency graph;
- kapan modularity memberi value, dan kapan hanya menambah complexity.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java Part 015 — Security, Cryptography, dan Integrity di Java hingga Java 25](./learn-java-part-015.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 017 — Testing di Java](./learn-java-part-017.md)
