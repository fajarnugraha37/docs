# learn-java-oop-functional-reflection-codegen-modules-part-025

# Package Architecture: Naming, Visibility, Boundaries, and Internal APIs

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `025`  
> Topik: Java package architecture sebagai boundary desain, bukan sekadar folder source code.

---

## 0. Tujuan Part Ini

Pada tahap sebelumnya kita sudah membahas object model, inheritance, interface, sealed hierarchy, records, enums, nested classes, generics, polymorphism, composition, functional style, reflection, annotation, annotation processing, code generation, dynamic proxy, bytecode enhancement, dan instrumentation.

Sekarang kita naik satu level:

```text
class/object design
    ↓
package design
    ↓
module/artifact design
    ↓
runtime dependency graph
```

Part ini membahas **package architecture**: bagaimana kita mengorganisasi Java code supaya boundary-nya jelas, dependency direction terkendali, internal API tidak bocor, dan codebase tetap bisa berkembang tanpa berubah menjadi tumpukan package random.

Package bukan hanya namespace. Dalam Java, package juga berperan sebagai:

1. **Nama logis type**.
2. **Unit organisasi source code**.
3. **Boundary untuk package-private access**.
4. **Bagian dari fully qualified name**.
5. **Unit yang diekspor/dibuka oleh JPMS module**.
6. **Sinyal arsitektur untuk manusia dan tooling**.
7. **Surface area yang memengaruhi compatibility dan maintainability**.

Target part ini: setelah selesai, kita bisa membaca package structure dan langsung tahu:

- apa public API-nya;
- mana internal implementation;
- mana domain model;
- mana orchestration;
- mana adapter/framework boundary;
- dependency boleh mengarah ke mana;
- package mana yang tidak boleh disentuh langsung;
- package mana yang aman diekspos lintas module/artifact;
- package mana yang akan menyulitkan refactoring jika salah desain.

---

## 1. Package: Mental Model Dasar yang Benar

Secara sederhana, package adalah namespace untuk top-level type Java:

```java
package com.acme.caseflow.escalation;

public final class EscalationPolicy {
}
```

Fully qualified name class di atas adalah:

```text
com.acme.caseflow.escalation.EscalationPolicy
```

Namun mental model yang lebih berguna untuk engineer senior adalah:

```text
Package = named architectural neighborhood
```

Artinya package berisi type-type yang seharusnya **dekat secara konseptual**, bukan hanya kebetulan sama layer teknis.

Package yang baik menjawab:

```text
Type-type ini bersama karena mereka menjaga invariant yang sama?
Type-type ini bersama karena mereka membentuk public API yang sama?
Type-type ini bersama karena mereka implementation detail dari fitur yang sama?
Type-type ini bersama karena mereka adapter ke teknologi yang sama?
```

Package yang buruk biasanya menjawab:

```text
Karena semuanya controller.
Karena semuanya service.
Karena semuanya dto.
Karena semuanya util.
Karena dulu dibuat begitu.
```

Ini bukan berarti package-by-layer selalu salah. Tetapi package-by-layer sering gagal pada sistem besar karena ia mengelompokkan code berdasarkan **mekanisme teknis**, bukan **boundary perubahan**.

---

## 2. Package Bukan Folder, Tapi Source Layout Biasanya Mengikuti Package

Dalam praktik Java modern, package biasanya dipetakan ke directory:

```text
src/main/java/com/acme/caseflow/escalation/EscalationPolicy.java
```

Namun secara konsep:

```text
Package declaration di source code adalah otoritas bahasa.
Folder hanyalah convention build/source layout.
```

Contoh buruk:

```text
src/main/java/com/acme/caseflow/escalation/EscalationPolicy.java
```

```java
package com.acme.shared;

public class EscalationPolicy {
}
```

Compiler melihat package declaration, bukan niat folder. Build tool dan IDE mungkin mengeluh atau membingungkan, tetapi bahasa Java mendasarkan package pada deklarasi `package`.

Rule praktis:

```text
Directory structure harus mencerminkan package declaration.
Jangan membuat source layout yang melawan convention Java.
```

Mengapa?

Karena tooling Java mengandalkan convention ini untuk:

- IDE navigation;
- build incremental compilation;
- static analysis;
- code search;
- source generation;
- test discovery;
- documentation;
- mental mapping developer.

---

## 3. Named Package vs Unnamed Package

Java mendukung compilation unit tanpa package declaration. Ini disebut unnamed package.

```java
public class Demo {
    public static void main(String[] args) {
    }
}
```

Ini cocok untuk:

- eksperimen kecil;
- snippet belajar;
- single-file demo;
- temporary scratch.

Tidak cocok untuk production code.

Alasannya:

1. Tidak punya namespace yang stabil.
2. Tidak bisa menjadi bagian dari package architecture yang jelas.
3. Sulit dipakai dari named package.
4. Tidak cocok untuk modularization.
5. Membingungkan build/test/tooling.

Rule:

```text
Production Java code harus selalu memakai named package.
Unnamed package hanya untuk demo kecil atau throwaway code.
```

---

## 4. Package Name: Naming sebagai Contract Jangka Panjang

Package name adalah bagian dari public identity type.

Jika sebuah class public:

```java
package com.acme.caseflow.api;

public interface CaseWorkflow {
}
```

Maka nama lengkapnya adalah:

```text
com.acme.caseflow.api.CaseWorkflow
```

Mengubah package berarti mengubah fully qualified class name. Efeknya besar:

- source compatibility break;
- binary compatibility break;
- serialization compatibility risk;
- reflection lookup break;
- configuration string break;
- generated code break;
- annotation processor mapping break;
- framework scanning break;
- documentation/API reference berubah;
- external consumers perlu migrasi import.

Jadi package name bukan kosmetik. Package name adalah bagian dari API.

### 4.1 Naming Convention Umum

Package Java biasanya lowercase, hierarchical, dan berbasis domain terbalik:

```text
com.acme.caseflow
id.company.product
sg.gov.agency.system
```

Contoh:

```text
com.acme.caseflow.application
com.acme.caseflow.domain
com.acme.caseflow.infrastructure
```

Hindari:

```text
com.acme.CaseFlow
com.acme.case_flow
com.acme.case-flow
com.acme.caseflow.NewFeature
com.acme.caseflow.test123
```

Package name sebaiknya:

- lowercase;
- stabil;
- tidak mengandung versi kecuali memang strategi API versioning;
- tidak mengandung nama orang/tim sementara;
- tidak mengandung nama sprint/ticket;
- tidak terlalu generik;
- tidak terlalu teknis jika package mewakili domain boundary.

### 4.2 Package Name yang Stabil vs Volatile

Buruk:

```text
com.acme.caseflow.newui
com.acme.caseflow.temp
com.acme.caseflow.v2final
com.acme.caseflow.service2
```

Lebih baik:

```text
com.acme.caseflow.presentation
com.acme.caseflow.workflow
com.acme.caseflow.migration
com.acme.caseflow.legacy
```

Gunakan nama yang merepresentasikan konsep jangka panjang, bukan kondisi sementara.

---

## 5. Access Control: Package sebagai Boundary Bahasa

Java punya beberapa level access:

```text
public      → bisa diakses dari mana saja selama type/module terbaca
protected   → package + subclass access dengan aturan tertentu
package     → default/no modifier; hanya satu package
private     → hanya dalam top-level/nested declaration tertentu
```

Package-private adalah fitur yang sering diremehkan.

Contoh:

```java
package com.acme.caseflow.escalation;

final class EscalationRules {
    boolean mustEscalate(CaseSnapshot snapshot) {
        return snapshot.ageInDays() > 30 && snapshot.priority().isHigh();
    }
}
```

Class ini tidak `public`. Artinya class hanya bisa dipakai oleh type lain dalam package yang sama.

Ini berguna untuk menyatakan:

```text
Class ini adalah implementation detail package ini.
Jangan dipakai dari luar.
```

### 5.1 Public Type = Janji Jangka Panjang

Begitu sebuah type dibuat public, ia menjadi lebih sulit diubah.

```java
public class EscalationRules {
    public boolean mustEscalate(CaseSnapshot snapshot) { ... }
}
```

Sekarang consumer bisa compile melawan class ini.

Risiko:

- method signature sulit diubah;
- constructor sulit dihapus;
- behavior menjadi implicit contract;
- framework bisa mereferensikan class via reflection;
- test eksternal bisa bergantung pada detail;
- generated code bisa mengikat ke class ini.

Rule:

```text
Default-kan type sebagai package-private.
Jadikan public hanya jika memang bagian dari API package.
```

### 5.2 Package-Private adalah Tool Arsitektur

Package-private bisa dipakai untuk membuat mini-boundary:

```text
com.acme.caseflow.escalation
  EscalationService.java          public façade
  EscalationPolicy.java           public/domain API if needed
  EscalationRules.java            package-private implementation
  EscalationDecisionTable.java    package-private implementation
  EscalationAuditMapper.java      package-private implementation
```

Consumer dari package lain hanya melihat:

```java
public final class EscalationService { ... }
```

Internal logic bebas berubah tanpa breaking consumer.

---

## 6. Package as API Surface: API Package vs Internal Package

Dalam sistem serius, kita perlu membedakan:

```text
API package       → boleh dipakai consumer
internal package  → implementation detail
adapter package   → boundary teknologi/framework
test package      → khusus testing
```

Contoh struktur:

```text
com.acme.caseflow.escalation
  api/
    EscalationUseCase.java
    EscalationCommand.java
    EscalationResult.java
  internal/
    DefaultEscalationUseCase.java
    EscalationPolicyEngine.java
    EscalationRuleCompiler.java
  spi/
    EscalationNotifier.java
    EscalationClock.java
  adapter/
    persistence/
      JpaEscalationRepository.java
    messaging/
      RabbitEscalationNotifier.java
    rest/
      EscalationController.java
```

Tetapi hati-hati. Struktur ini bisa terlalu dalam jika module kecil. Jangan membuat package hierarchy hanya demi terlihat enterprise.

Prinsipnya:

```text
Pisahkan public API dari implementation detail.
Pisahkan domain/application concept dari technology adapter.
```

### 6.1 `internal` Package Convention

Package bernama `internal` bukan keyword Java. Ia hanya convention.

```text
com.acme.caseflow.internal
```

Secara bahasa, class public di package internal tetap bisa diakses jika module/classpath mengizinkan.

```java
package com.acme.caseflow.internal;

public final class InternalThing { }
```

Jika masih public, consumer masih bisa import:

```java
import com.acme.caseflow.internal.InternalThing;
```

Jadi `internal` harus dikombinasikan dengan:

- package-private class jika memungkinkan;
- JPMS `exports` hanya untuk API package;
- ArchUnit/static analysis rules;
- build module boundary;
- documentation policy;
- code review enforcement.

Rule:

```text
Nama internal adalah sinyal manusia.
Package-private/JPMS/static analysis adalah enforcement.
```

---

## 7. Package-by-Layer vs Package-by-Feature vs Package-by-Component

Ini perdebatan klasik. Jawaban yang matang bukan “selalu feature” atau “selalu layer”. Jawaban yang benar bergantung pada boundary perubahan, ukuran codebase, dan ownership.

### 7.1 Package-by-Layer

Contoh:

```text
com.acme.caseflow.controller
com.acme.caseflow.service
com.acme.caseflow.repository
com.acme.caseflow.dto
com.acme.caseflow.entity
com.acme.caseflow.mapper
```

Kelebihan:

- mudah dipahami oleh pemula;
- cocok untuk aplikasi kecil;
- mengikuti banyak tutorial/framework;
- gampang menemukan semua controller/repository.

Kekurangan:

- fitur tersebar ke banyak package;
- dependency lintas fitur mudah kacau;
- package menjadi sangat besar;
- domain boundary tidak terlihat;
- perubahan satu fitur menyentuh banyak package;
- god service mudah tumbuh;
- internal detail fitur lain mudah diakses;
- ownership tim sulit.

Gejala buruk:

```text
service/ berisi 200 class.
dto/ berisi semua payload dari semua fitur.
repository/ menjadi shared dumping ground.
mapper/ penuh class tanpa boundary.
```

### 7.2 Package-by-Feature

Contoh:

```text
com.acme.caseflow.escalation
  EscalationController.java
  EscalationUseCase.java
  EscalationRepository.java
  EscalationPolicy.java
  EscalationMapper.java

com.acme.caseflow.assignment
  AssignmentController.java
  AssignmentUseCase.java
  AssignmentRepository.java
  AssignmentPolicy.java
```

Kelebihan:

- fitur lebih kohesif;
- boundary perubahan lebih jelas;
- ownership lebih mudah;
- internal package-private lebih berguna;
- dependency lintas fitur lebih terlihat;
- cocok untuk modul bisnis besar.

Kekurangan:

- bisa menduplikasi pattern teknis;
- cross-cutting concern perlu desain hati-hati;
- jika fitur terlalu granular, package jadi banyak dan dangkal;
- developer baru mungkin perlu waktu memahami domain grouping.

### 7.3 Package-by-Component / Bounded Context

Contoh:

```text
com.acme.caseflow.caseintake
com.acme.caseflow.investigation
com.acme.caseflow.enforcement
com.acme.caseflow.appeal
com.acme.caseflow.correspondence
```

Masing-masing component bisa punya subpackage internal:

```text
com.acme.caseflow.enforcement
  api/
  application/
  domain/
  infrastructure/
```

Ini cocok untuk enterprise system besar karena boundary mengikuti capability/domain area, bukan sekadar UI feature kecil.

### 7.4 Hybrid yang Umum dan Waras

Untuk sistem besar, struktur yang sering efektif:

```text
com.acme.caseflow
  shared/
    error/
    time/
    id/
    validation/
  caseintake/
    api/
    application/
    domain/
    infrastructure/
  enforcement/
    api/
    application/
    domain/
    infrastructure/
  appeal/
    api/
    application/
    domain/
    infrastructure/
```

Ini bukan layer global. Ini feature/component-level boundary dengan sublayer lokal.

Mental model:

```text
Top-level package = business/component boundary.
Subpackage = local architecture inside boundary.
```

---

## 8. Dependency Direction di Level Package

Package architecture gagal jika dependency direction tidak jelas.

Contoh buruk:

```text
controller → service → repository → service → controller dto
```

Atau:

```text
escalation → assignment → appeal → escalation
```

Package cycle menciptakan masalah:

- sulit refactor;
- sulit test isolated;
- sulit extract module;
- sulit reason ownership;
- mudah terjadi hidden coupling;
- package-private boundary tidak berguna jika package terlalu besar;
- build modularization menjadi mahal.

### 8.1 Direction Rule

Dalam arsitektur enterprise, arah dependency bisa seperti ini:

```text
presentation adapter
    ↓
application/use case
    ↓
domain model/policy
```

Infrastructure adapter bergantung ke application/domain interfaces, bukan sebaliknya:

```text
infrastructure.persistence → application port/domain
```

Application tidak langsung bergantung ke Spring controller, JPA entity manager, RabbitMQ client, HTTP client, dsb.

Contoh package:

```text
com.acme.caseflow.enforcement.domain
com.acme.caseflow.enforcement.application
com.acme.caseflow.enforcement.adapter.persistence
com.acme.caseflow.enforcement.adapter.rest
```

Arah dependency:

```text
adapter.rest           → application
adapter.persistence    → application/domain
application            → domain
application            → spi/port
infrastructure adapter → spi/port implementation
```

### 8.2 Package Cycle Smell

Jika ada:

```text
A imports B
B imports A
```

Tanyakan:

1. Apakah ada konsep ketiga yang harus diekstrak?
2. Apakah salah satu dependency harus menjadi interface/port?
3. Apakah dua package sebenarnya satu cohesive package?
4. Apakah package terlalu granular?
5. Apakah shared concept salah tempat?

Contoh:

```text
escalation depends on assignment
assignment depends on escalation
```

Mungkin perlu:

```text
workflow-common
  CaseAssignmentView
  EscalationTrigger
```

Atau lebih baik domain event/application orchestration:

```text
assignment publishes AssignmentChanged
escalation consumes AssignmentChanged
```

Tetapi jangan langsung membuat `common` dumping ground.

---

## 9. The Dangerous `common`, `shared`, and `util` Packages

Package seperti ini sangat sering menjadi tempat sampah:

```text
com.acme.common
com.acme.shared
com.acme.util
com.acme.helper
```

Tidak selalu salah, tetapi berbahaya karena cenderung kehilangan ownership.

### 9.1 Utility Package Smell

Buruk:

```text
com.acme.util
  DateUtil
  StringUtil
  CaseUtil
  EscalationUtil
  UserUtil
  JsonUtil
  ValidationUtil
```

Masalah:

- cohesion rendah;
- dependency acak;
- sulit ownership;
- sulit test behavior;
- sering berisi static method yang menyembunyikan domain logic;
- menjadi bypass domain model.

Lebih baik:

```text
com.acme.caseflow.shared.time
  BusinessCalendar
  ClockProvider

com.acme.caseflow.enforcement.domain
  EscalationDeadlinePolicy

com.acme.caseflow.shared.text
  SlugNormalizer
```

### 9.2 Shared Harus Stabil dan Kecil

Shared package boleh ada jika isinya:

- sangat stabil;
- rendah dependency;
- tidak tergantung feature spesifik;
- tidak berisi orchestration;
- tidak menjadi jalan pintas dependency;
- punya ownership jelas;
- punya compatibility policy.

Contoh shared yang wajar:

```text
shared.id
shared.time
shared.error
shared.money
shared.pagination
shared.validation
```

Contoh shared yang mencurigakan:

```text
shared.service
shared.manager
shared.processor
shared.workflow
shared.case
```

Kalau shared mulai mengandung business process, kemungkinan boundary salah.

---

## 10. Internal API vs Public API

Dalam codebase besar, ada beberapa level API:

```text
private implementation detail
package-private implementation detail
module-internal public type
artifact-internal public type
organization-internal API
external/public API
```

Semua `public` tidak setara.

Contoh:

```java
package com.acme.caseflow.enforcement.internal;

public final class GeneratedEscalationTable {
}
```

Ini public agar bisa dipakai generated code atau framework, tetapi bukan public API untuk consumer bisnis.

Masalahnya, Java classpath tidak membedakan secara kuat.

JPMS bisa membantu:

```java
module com.acme.caseflow.enforcement {
    exports com.acme.caseflow.enforcement.api;
    // internal package tidak diekspor
}
```

Dengan module system, package yang tidak diekspor tidak menjadi public API module.

### 10.1 API Surface Checklist

Sebelum membuat class/method public:

1. Siapa consumer-nya?
2. Apakah consumer berada di package/module/artifact lain?
3. Apakah class ini bagian dari business contract?
4. Apakah method signature akan stabil 1-2 tahun?
5. Apakah ada implementation detail yang bocor?
6. Apakah type parameter/generic signature aman untuk evolusi?
7. Apakah return type terlalu konkret?
8. Apakah exception policy jelas?
9. Apakah nullability jelas?
10. Apakah package-nya memang API package?

Rule:

```text
Public API harus disengaja, bukan default karena IDE generate public class.
```

---

## 11. Package-Private Testing Strategy

Salah satu alasan developer membuat class public adalah supaya bisa dites.

Misalnya:

```java
public final class EscalationRuleCompiler { ... }
```

Padahal class ini implementation detail.

Di Java, test source bisa memakai package yang sama:

```text
src/main/java/com/acme/caseflow/escalation/EscalationRuleCompiler.java
src/test/java/com/acme/caseflow/escalation/EscalationRuleCompilerTest.java
```

Keduanya berada di package:

```java
package com.acme.caseflow.escalation;
```

Test bisa mengakses package-private class/member tanpa menjadikannya public.

Ini sangat berguna.

Rule:

```text
Jangan membuka API hanya demi test.
Gunakan same-package test untuk implementation detail bila perlu.
```

Namun jangan berlebihan. Jika terlalu banyak test package-private internal, mungkin desain public behavior kurang testable.

---

## 12. Package and Framework Scanning

Framework seperti Spring sering melakukan component scanning berdasarkan package:

```java
@SpringBootApplication(scanBasePackages = "com.acme.caseflow")
```

Atau implicit scan dari package aplikasi utama.

Ini membuat package structure berdampak pada runtime behavior.

Risiko:

1. Bean tidak terdeteksi karena package di luar scan root.
2. Bean tak sengaja terdeteksi karena berada di bawah scan root.
3. Test context terlalu besar.
4. Configuration class bocor ke module lain.
5. Component scanning menjadi dependency tersembunyi.

Contoh buruk:

```text
com.acme.common.config
com.acme.caseflow.app
```

Jika app scan hanya `com.acme.caseflow`, config di `com.acme.common.config` tidak masuk.

Atau sebaliknya:

```text
com.acme
  experimental/
  migration/
  caseflow/
```

Scan `com.acme` bisa mengambil class yang tidak seharusnya.

Rule:

```text
Package root untuk scanning harus spesifik dan disengaja.
Jangan bergantung pada package acak agar framework menemukan class.
```

Untuk library internal, lebih baik expose explicit auto-configuration atau module configuration daripada berharap consumer scan package internal.

---

## 13. Package and Reflection

Reflection sering memakai package name untuk scanning:

```text
scan com.acme.caseflow.enforcement for annotated handlers
```

Risiko:

- rename package memutus scanner;
- internal class ikut ter-scan;
- generated class ikut ter-scan;
- nested class ikut ter-scan;
- classpath scanning lambat;
- JPMS module boundary menghalangi access;
- package split di multiple JAR membingungkan scanner.

Desain yang lebih kuat:

1. Gunakan explicit registration jika memungkinkan.
2. Gunakan generated index dari annotation processor.
3. Gunakan `ServiceLoader` untuk provider discovery.
4. Gunakan package scan hanya di boundary aplikasi, bukan library core.
5. Pisahkan package marker untuk scanning.

Contoh marker:

```java
package com.acme.caseflow.enforcement;

public interface EnforcementPackageMarker {
}
```

Lalu framework config:

```java
scanPackageOf(EnforcementPackageMarker.class)
```

Ini lebih refactor-friendly daripada string literal.

---

## 14. Split Package Problem

Split package terjadi ketika package yang sama tersebar di lebih dari satu artifact/module.

Contoh:

```text
caseflow-core.jar
  com.acme.caseflow.enforcement.EscalationPolicy

caseflow-plugin.jar
  com.acme.caseflow.enforcement.PluginEscalationRule
```

Di classpath lama, ini bisa “berjalan” tetapi membingungkan.

Di JPMS, split package antar named modules adalah masalah serius karena module system mengharapkan package dimiliki secara jelas oleh module tertentu.

Risiko split package:

- class shadowing;
- unpredictable resolution;
- tooling bingung;
- module migration sulit;
- package-private access tidak melintasi JAR seperti yang sering diasumsikan;
- ownership tidak jelas.

Rule:

```text
Satu package sebaiknya dimiliki oleh satu artifact/module konseptual.
Jangan menyebar package yang sama ke banyak JAR.
```

Jika butuh plugin, gunakan subpackage berbeda:

```text
com.acme.caseflow.enforcement.core
com.acme.caseflow.enforcement.plugin.foo
```

Atau gunakan SPI:

```text
com.acme.caseflow.enforcement.spi
com.vendor.foo.enforcement.provider
```

---

## 15. Package-Private Tidak Melintasi Package, Walau Subpackage

Ini jebakan umum:

```text
com.acme.caseflow
com.acme.caseflow.internal
```

Subpackage bukan child dalam access-control sense.

Package-private member di `com.acme.caseflow` tidak bisa diakses dari `com.acme.caseflow.internal`.

```java
package com.acme.caseflow;

class PackagePrivateType { }
```

```java
package com.acme.caseflow.internal;

// Tidak bisa akses PackagePrivateType hanya karena package prefix sama.
```

Mental model:

```text
Package Java bukan hierarchy access-control.
Package name hanya string namespace yang terlihat hierarchical.
```

Ini penting saat mendesain internal subpackage. Jika internal implementation perlu saling akses package-private, mereka harus berada di package yang sama atau desain ulang boundary-nya.

---

## 16. Top-Level Package Depth: Terlalu Datar vs Terlalu Dalam

Package terlalu datar:

```text
com.acme.caseflow
  700 classes
```

Masalah:

- package-private terlalu luas;
- class sulit ditemukan;
- API/internal tercampur;
- naming collision;
- ownership kabur.

Package terlalu dalam:

```text
com.acme.caseflow.modules.enforcement.features.escalation.usecases.v1.handlers.impl.defaultimpl
```

Masalah:

- noise tinggi;
- refactor mahal;
- import panjang;
- package tidak lagi memberi informasi bermakna;
- struktur terlihat enterprise tapi tidak membantu reasoning.

Rule pragmatis:

```text
Package depth harus cukup untuk menyatakan boundary, tidak lebih.
```

Struktur yang sering cukup:

```text
com.acme.caseflow.enforcement.application
com.acme.caseflow.enforcement.domain
com.acme.caseflow.enforcement.adapter.persistence
com.acme.caseflow.enforcement.adapter.rest
```

Atau untuk fitur kecil:

```text
com.acme.caseflow.escalation
```

---

## 17. Package Naming by Semantic Role

Beberapa nama package yang umum dan maknanya:

### 17.1 `api`

```text
com.acme.caseflow.enforcement.api
```

Berisi contract yang boleh dipakai consumer.

Cocok untuk:

- use case interface;
- command/result record;
- public exception/result type;
- public DTO untuk boundary internal library.

Jangan isi dengan implementation.

### 17.2 `internal`

```text
com.acme.caseflow.enforcement.internal
```

Berisi implementation detail.

Gunakan enforcement tambahan:

- JPMS non-export;
- package-private;
- ArchUnit;
- documentation.

### 17.3 `domain`

```text
com.acme.caseflow.enforcement.domain
```

Berisi model/policy/invariant domain.

Harus minim dependency framework.

### 17.4 `application`

```text
com.acme.caseflow.enforcement.application
```

Berisi use case orchestration, transaction boundary, port usage.

### 17.5 `adapter`

```text
com.acme.caseflow.enforcement.adapter.rest
com.acme.caseflow.enforcement.adapter.persistence
com.acme.caseflow.enforcement.adapter.messaging
```

Berisi integrasi teknologi.

### 17.6 `spi`

```text
com.acme.caseflow.enforcement.spi
```

Service Provider Interface. Contract untuk extension/provider.

Bedakan API vs SPI:

```text
API = consumer memanggil kita.
SPI = provider mengimplementasikan extension point kita.
```

### 17.7 `config`

Berisi configuration/framework wiring.

Hati-hati agar config tidak menjadi tempat business logic.

### 17.8 `support`

Lebih spesifik daripada `util`, tetapi tetap hati-hati.

`support` sebaiknya mendukung package/feature tertentu, bukan global dumping ground.

---

## 18. DTO, Command, Event, Entity: Jangan Semua Ditaruh di `dto`

Package global `dto` sering menjadi smell:

```text
com.acme.caseflow.dto
  CreateCaseRequest
  AppealResponse
  EscalationEvent
  UserDto
  SearchCaseDto
```

Masalahnya DTO dari boundary berbeda bercampur:

- REST request;
- REST response;
- application command;
- domain event;
- persistence projection;
- external API payload;
- message payload.

Ini berbahaya karena tiap boundary punya compatibility dan semantics berbeda.

Lebih baik:

```text
com.acme.caseflow.enforcement.adapter.rest
  EscalateCaseHttpRequest
  EscalateCaseHttpResponse

com.acme.caseflow.enforcement.application
  EscalateCaseCommand
  EscalateCaseResult

com.acme.caseflow.enforcement.domain
  CaseEscalated

com.acme.caseflow.enforcement.adapter.persistence
  EscalationRow
```

Mental model:

```text
Payload harus tinggal dekat boundary tempat ia bermakna.
```

Jangan membuat satu DTO dipakai untuk REST, DB, messaging, dan domain sekaligus. Itu menciptakan coupling multi-boundary.

---

## 19. Entity Package: Domain Entity vs Persistence Entity

Istilah `entity` ambigu.

Bisa berarti:

1. Domain entity: object dengan identity dan invariant.
2. Persistence entity: class mapping database table.

Jika memakai package:

```text
com.acme.caseflow.entity
```

Tidak jelas ini yang mana.

Lebih eksplisit:

```text
com.acme.caseflow.enforcement.domain
  EnforcementCase

com.acme.caseflow.enforcement.adapter.persistence
  EnforcementCaseJpaEntity
```

Atau:

```text
com.acme.caseflow.enforcement.persistence.entity
```

Jika domain model dan JPA entity sama class, sadari trade-off:

- domain model terikat annotation persistence;
- lazy loading/proxy masuk ke domain reasoning;
- equality/hashCode makin sulit;
- package boundary mencampur domain dan infrastructure;
- testing lebih berat.

Tidak selalu salah, tapi harus sadar.

---

## 20. Package Boundary for Generated Code

Generated code harus ditempatkan secara sengaja.

Pilihan:

```text
com.acme.caseflow.enforcement.generated
com.acme.caseflow.enforcement.internal.generated
com.acme.caseflow.generated.enforcement
```

Pertanyaan penting:

1. Apakah generated code public API?
2. Apakah generated code boleh diimport manual?
3. Apakah generated code implementation detail?
4. Apakah generated code perlu package-private access?
5. Apakah generated code butuh reflection access?
6. Apakah generated code perlu diekspor oleh JPMS?

Rule umum:

```text
Generated code sebaiknya bukan public API, kecuali memang contract generator.
```

Contoh baik:

```text
com.acme.caseflow.enforcement
  EscalationEngine.java          public façade
  GeneratedEscalationEngine.java package-private generated impl
```

Jika annotation processor perlu generate type di package yang sama untuk package-private access, pastikan tidak menciptakan nama yang konflik.

Tambahkan header:

```java
// Generated by EscalationProcessor. Do not edit manually.
```

Dan dokumentasikan ownership:

```text
Source of truth: escalation-rules.yaml
Generated output: target/generated-sources/annotations/...
```

---

## 21. Package Boundary and Annotation Processing

Annotation processor membaca element berdasarkan package/type structure.

Misalnya annotation:

```java
@WorkflowHandler
public final class EscalationHandler { ... }
```

Processor bisa enforce rule:

```text
@WorkflowHandler hanya boleh berada di package ..application.handler
@JpaEntity hanya boleh berada di package ..adapter.persistence
@Controller tidak boleh berada di ..domain
```

Ini powerful untuk architecture governance.

Contoh compile-time validation concept:

```text
Reject if type annotated with @DomainService imports org.springframework.web.*
Reject if package ..domain depends on package ..adapter..
Reject if public type exists under ..internal.. and module exports it
```

Annotation processor bukan satu-satunya tool. Static analysis seperti ArchUnit sering lebih cocok untuk dependency rules.

---

## 22. Package Boundary and JPMS

JPMS membawa package architecture ke level module descriptor:

```java
module com.acme.caseflow.enforcement {
    exports com.acme.caseflow.enforcement.api;
    exports com.acme.caseflow.enforcement.spi;

    requires com.acme.caseflow.shared;

    uses com.acme.caseflow.enforcement.spi.EscalationRuleProvider;
}
```

Package internal tidak diekspor:

```text
com.acme.caseflow.enforcement.internal
com.acme.caseflow.enforcement.adapter.persistence
```

Ini berarti public class di package internal tetap public secara bytecode, tetapi tidak accessible sebagai API module normal dari module lain jika package tidak diekspor.

JPMS mengubah mental model:

```text
public class ≠ public module API
public class in exported package = module API candidate
```

### 22.1 `exports` vs `opens`

`exports`:

```java
exports com.acme.caseflow.enforcement.api;
```

Mengizinkan compile-time dan runtime access ke public types package tersebut.

`opens`:

```java
opens com.acme.caseflow.enforcement.adapter.persistence to org.hibernate.orm.core;
```

Mengizinkan deep reflection untuk package tertentu.

Prinsip:

```text
Export API package.
Open reflection package hanya ke framework yang perlu.
Jangan open seluruh module kecuali benar-benar perlu.
```

Part JPMS berikutnya akan membahas detail ini lebih dalam.

---

## 23. Package Boundary and Artifact Boundary

Package bukan artifact. Artifact adalah unit distribusi seperti JAR.

Contoh Maven artifact:

```text
caseflow-enforcement-api.jar
caseflow-enforcement-core.jar
caseflow-enforcement-spring-adapter.jar
```

Package di dalamnya:

```text
caseflow-enforcement-api.jar
  com.acme.caseflow.enforcement.api
  com.acme.caseflow.enforcement.spi

caseflow-enforcement-core.jar
  com.acme.caseflow.enforcement.internal
  com.acme.caseflow.enforcement.domain
  com.acme.caseflow.enforcement.application

caseflow-enforcement-spring-adapter.jar
  com.acme.caseflow.enforcement.adapter.spring
```

Pertanyaan desain:

```text
Apakah API dan implementation perlu dipisah artifact?
Apakah adapter framework perlu artifact sendiri?
Apakah domain core harus bebas dari Spring/JPA?
Apakah plugin/provider akan dikembangkan tim/vendor lain?
```

Jangan memecah artifact terlalu cepat. Tetapi package architecture yang baik membuat pemecahan artifact di masa depan lebih mudah.

---

## 24. Package and Binary Compatibility

Mengubah package class public sama dengan mengganti nama class.

Contoh perubahan:

```text
com.acme.caseflow.escalation.EscalationPolicy
↓
com.acme.caseflow.enforcement.escalation.EscalationPolicy
```

Bagi consumer, ini bukan rename ringan. Ini class berbeda.

Dampak:

- import break;
- compiled binary lama gagal load class;
- serialized data bisa gagal deserialize;
- reflection string gagal;
- configuration gagal;
- generated code stale;
- scripts/integration references rusak.

Strategi migrasi:

1. Buat class adapter/deprecated di package lama.
2. Delegasikan ke package baru.
3. Tandai `@Deprecated(forRemoval = true)` jika benar-benar akan dihapus.
4. Berikan migration guide.
5. Pertahankan selama beberapa release.
6. Jalankan compatibility tests.

Contoh:

```java
package com.acme.caseflow.escalation;

/**
 * @deprecated use {@link com.acme.caseflow.enforcement.escalation.EscalationPolicy}
 */
@Deprecated(forRemoval = true, since = "3.2")
public final class EscalationPolicy {
    private final com.acme.caseflow.enforcement.escalation.EscalationPolicy delegate;
}
```

Namun adapter tidak selalu mudah jika constructor/static/final/records/sealed involved.

Rule:

```text
Pikirkan package public API sebelum release. Rename package setelah consumer banyak itu mahal.
```

---

## 25. Package Structure as Documentation

Package structure harus bisa dibaca seperti peta sistem.

Contoh buruk:

```text
com.acme.caseflow.service
com.acme.caseflow.service.impl
com.acme.caseflow.service.impl2
com.acme.caseflow.service.newimpl
com.acme.caseflow.data
com.acme.caseflow.model
com.acme.caseflow.vo
com.acme.caseflow.dto
```

Pembaca tidak tahu:

- boundary domain;
- use case utama;
- public API;
- internal implementation;
- adapter teknologi;
- dependency direction.

Contoh lebih informatif:

```text
com.acme.caseflow.enforcement
  api
  application
  domain
  adapter.rest
  adapter.persistence
  adapter.messaging
  internal.generated

com.acme.caseflow.appeal
  api
  application
  domain
  adapter.rest
  adapter.persistence
```

Dari struktur ini, pembaca langsung memahami sistem memiliki capability enforcement dan appeal, masing-masing punya boundary internal.

---

## 26. Case Study: Regulatory Case Management Package Design

Misal kita punya domain enforcement lifecycle:

- case intake;
- assessment;
- investigation;
- escalation;
- legal review;
- enforcement action;
- appeal;
- correspondence;
- audit trail.

Struktur package awal bisa:

```text
com.acme.regsys
  shared
    id
    time
    error
    pagination
    security

  caseintake
    api
    application
    domain
    adapter.rest
    adapter.persistence

  investigation
    api
    application
    domain
    adapter.rest
    adapter.persistence

  enforcement
    api
    application
    domain
    adapter.rest
    adapter.persistence
    adapter.messaging
    spi
    internal.generated

  appeal
    api
    application
    domain
    adapter.rest
    adapter.persistence

  correspondence
    api
    application
    domain
    adapter.email
    adapter.template

  audit
    api
    application
    domain
    adapter.persistence
```

### 26.1 Cross-Package Interaction

Buruk:

```java
// enforcement directly uses appeal persistence entity
import com.acme.regsys.appeal.adapter.persistence.AppealJpaEntity;
```

Ini melanggar boundary. Enforcement tidak seharusnya tahu persistence detail Appeal.

Lebih baik:

```java
import com.acme.regsys.appeal.api.AppealQuery;
import com.acme.regsys.appeal.api.AppealStatusView;
```

Atau event:

```java
import com.acme.regsys.appeal.api.AppealFiledEvent;
```

Package direction:

```text
enforcement.application → appeal.api
not
enforcement.application → appeal.adapter.persistence
```

### 26.2 Internal Rule Engine

```text
com.acme.regsys.enforcement.domain
  EnforcementCase
  EnforcementStage
  EnforcementDecision

com.acme.regsys.enforcement.application
  StartEnforcementUseCase
  EscalateCaseUseCase

com.acme.regsys.enforcement.internal.generated
  GeneratedEscalationRuleTable

com.acme.regsys.enforcement.spi
  EnforcementNotifier
```

Generated rule table internal. Use case calls public façade/policy, not generated class directly from outside package.

---

## 27. Anti-Patterns Package Architecture

### 27.1 God Package

```text
com.acme.caseflow.service
```

Berisi ratusan class dari semua fitur.

Dampak:

- package-private tidak berarti;
- tidak ada boundary;
- semua saling akses;
- refactor sulit.

### 27.2 Layer Dumping Ground

```text
controller/service/repository/dto/entity/mapper
```

Semua fitur dicampur.

Dampak:

- fitur tidak kohesif;
- cross-feature dependency tidak terlihat;
- ownership blur.

### 27.3 Util Gravity Well

```text
common.util.*
```

Semua logic yang “bingung ditaruh di mana” masuk util.

Dampak:

- domain logic jadi static helper;
- dependency kacau;
- test buruk.

### 27.4 Public Everything

Semua class public karena default IDE/template.

Dampak:

- API surface meledak;
- internal detail sulit diubah;
- consumer bebas import apa saja.

### 27.5 Internal but Exported

```java
module x {
    exports com.acme.x.internal;
}
```

Atau public internal package di classpath tanpa rule.

Dampak:

- `internal` hanya nama, tidak ada enforcement.

### 27.6 Cyclic Feature Packages

```text
case → appeal → enforcement → case
```

Dampak:

- module extraction hampir mustahil;
- test setup berat;
- change impact sulit diprediksi.

### 27.7 Package Named by Implementation Detail

```text
com.acme.caseflow.arraylistimpl
com.acme.caseflow.mysql
```

Jika implementation berubah, package jadi misleading.

Gunakan teknologi package hanya untuk adapter:

```text
adapter.persistence.mysql
adapter.search.elasticsearch
```

### 27.8 Versioned Package Abuse

```text
com.acme.api.v1
com.acme.api.v2
com.acme.api.v3
```

Kadang perlu untuk external API, tetapi buruk jika dipakai untuk internal refactor biasa.

Jangan membuat versi package untuk menghindari desain compatibility yang benar.

---

## 28. Package Refactoring Strategy

Refactor package harus hati-hati, terutama public API.

### 28.1 Langkah Aman

1. Petakan package saat ini.
2. Identifikasi public API vs internal.
3. Hitung dependency graph.
4. Cari cycles.
5. Tentukan target package boundary.
6. Pindahkan internal code dulu.
7. Tambahkan adapter/deprecated class untuk public API bila perlu.
8. Update imports otomatis via IDE.
9. Jalankan test.
10. Jalankan static analysis.
11. Cek reflection/config string.
12. Cek generated code.
13. Cek serialization/event payload.
14. Dokumentasikan migration.

### 28.2 Jangan Lupa String References

Package/class name bisa muncul di:

- YAML/properties config;
- XML config;
- annotation value;
- reflection code;
- test fixtures;
- generated source;
- migration scripts;
- serialized payload;
- database column storing class name;
- logging/metric names;
- documentation.

Search import saja tidak cukup.

---

## 29. Enforcing Package Architecture

Package architecture yang hanya ada di README akan rusak.

Gunakan enforcement:

### 29.1 Code Review Rule

Contoh:

```text
Domain package must not import adapter package.
Internal package must not be imported outside owning component.
REST DTO must not be used as application command directly.
Persistence entity must not cross adapter boundary.
```

### 29.2 Static Analysis

Tools seperti ArchUnit bisa mengekspresikan rule:

```text
classes in ..domain.. should not depend on ..adapter..
classes in ..internal.. should only be accessed by owning package/module
classes in ..adapter.rest.. should not be accessed by ..domain..
```

### 29.3 Build Module Boundary

Pisahkan artifact jika boundary penting:

```text
enforcement-api
enforcement-core
enforcement-spring-adapter
```

### 29.4 JPMS

Gunakan module descriptor untuk export package API saja.

### 29.5 Annotation Processor

Bisa enforce annotation placement dan dependency rules tertentu saat compile-time.

---

## 30. Package Design Decision Matrix

| Situasi | Struktur yang Cocok | Catatan |
|---|---|---|
| aplikasi kecil CRUD | package-by-feature sederhana | jangan over-engineer |
| aplikasi enterprise besar | component/bounded-context package | sublayer lokal per component |
| reusable library | `api`, `spi`, `internal` | public surface harus kecil |
| framework extension | `spi` + provider package | pertimbangkan ServiceLoader |
| generated implementation | `internal.generated` | jangan jadikan API kecuali sengaja |
| heavy Spring app | feature + adapter package | hindari scan root terlalu luas |
| domain core harus portable | `domain` bebas framework | adapter tergantung domain, bukan sebaliknya |
| migration from legacy layer package | hybrid bertahap | jangan big-bang tanpa compatibility plan |

---

## 31. Practical Package Templates

### 31.1 Simple Feature Package

Cocok untuk fitur kecil/medium:

```text
com.acme.caseflow.escalation
  EscalationController.java
  EscalationUseCase.java
  EscalationCommand.java
  EscalationResult.java
  EscalationPolicy.java
  EscalationRepository.java
  EscalationJpaRepository.java
```

Boleh jika package masih kecil dan boundary jelas.

### 31.2 Medium Feature with Local Layers

```text
com.acme.caseflow.escalation
  api
    EscalationCommand.java
    EscalationResult.java
  application
    EscalationUseCase.java
    DefaultEscalationUseCase.java
  domain
    EscalationPolicy.java
    EscalationDecision.java
  adapter.rest
    EscalationController.java
  adapter.persistence
    EscalationJpaEntity.java
    JpaEscalationRepository.java
```

### 31.3 Library Package

```text
com.acme.workflow
  api
    WorkflowEngine.java
    WorkflowDefinition.java
    WorkflowResult.java
  spi
    WorkflowActionProvider.java
  internal
    DefaultWorkflowEngine.java
    WorkflowCompiler.java
  internal.generated
    GeneratedWorkflowTable.java
```

### 31.4 JPMS-Friendly Library

```text
module com.acme.workflow {
    exports com.acme.workflow.api;
    exports com.acme.workflow.spi;

    uses com.acme.workflow.spi.WorkflowActionProvider;
}
```

Internal package tidak diekspor.

---

## 32. Package Review Checklist

Saat review package architecture, tanya:

### 32.1 Naming

- Apakah package name stabil?
- Apakah lowercase dan meaningful?
- Apakah nama package merepresentasikan konsep, bukan temporary implementation?
- Apakah ada package `misc`, `helper`, `common` yang mencurigakan?

### 32.2 Boundary

- Mana public API?
- Mana internal implementation?
- Mana adapter teknologi?
- Mana domain/application logic?
- Apakah public type terlalu banyak?

### 32.3 Dependency Direction

- Apakah domain bebas dari adapter/framework?
- Apakah adapter bergantung ke application/domain, bukan sebaliknya?
- Apakah package cycles ada?
- Apakah cross-feature access melewati API package?

### 32.4 Encapsulation

- Apakah class internal bisa package-private?
- Apakah test memaksa public API yang tidak perlu?
- Apakah `internal` benar-benar enforced?
- Apakah JPMS exports hanya API package?

### 32.5 Evolution

- Apakah package public API bisa bertahan lama?
- Apakah rename akan memecahkan consumer?
- Apakah serialized/config/reflection references aman?
- Apakah generated code tergantung package name?

### 32.6 Framework

- Apakah component scanning root tepat?
- Apakah reflection package perlu `opens`?
- Apakah DTO/entity tidak bocor lintas boundary?
- Apakah framework annotation tidak masuk domain core tanpa alasan?

---

## 33. Deep Mental Model: Package as Change Boundary

Package terbaik bukan yang paling rapi secara folder. Package terbaik adalah yang membuat perubahan lokal tetap lokal.

Pertanyaan utama:

```text
Jika rule escalation berubah, package mana yang berubah?
Jika persistence enforcement berubah dari JPA ke MyBatis, package mana yang berubah?
Jika REST contract berubah, apakah domain ikut berubah?
Jika appeal module berubah, apakah enforcement internal ikut compile error?
Jika generated rule engine berubah, apakah public API consumer terdampak?
```

Package architecture yang baik membuat jawaban seperti:

```text
Rule domain berubah → domain/application package saja.
Persistence berubah → adapter.persistence saja.
REST berubah → adapter.rest + mapping saja.
Cross-component integration berubah → api/event/port package saja.
Generated engine berubah → internal.generated + façade saja.
```

Package architecture yang buruk membuat perubahan kecil menyentuh semua layer global.

---

## 34. Final Guidance: Cara Mendesain Package dari Nol

Gunakan langkah ini:

### Step 1 — Identifikasi capability utama

```text
caseintake
investigation
enforcement
appeal
correspondence
audit
```

### Step 2 — Tentukan public API tiap capability

```text
enforcement.api
appeal.api
audit.api
```

### Step 3 — Letakkan domain invariant dekat capability

```text
enforcement.domain
```

### Step 4 — Pisahkan orchestration

```text
enforcement.application
```

### Step 5 — Pisahkan adapter teknologi

```text
enforcement.adapter.rest
enforcement.adapter.persistence
enforcement.adapter.messaging
```

### Step 6 — Batasi shared

```text
shared.id
shared.time
shared.error
```

### Step 7 — Enforce dependency rules

```text
domain must not depend on adapter
application must not depend on rest/persistence implementation
adapter may depend on application/domain
internal package not imported outside owner
```

### Step 8 — Rencanakan JPMS/artifact masa depan

Walau belum modular, desain package seolah-olah nanti bisa dimodularisasi.

---

## 35. Ringkasan Part 025

Package architecture adalah salah satu alat paling murah tetapi paling berdampak untuk menjaga sistem Java tetap bisa dirawat.

Poin paling penting:

1. Package bukan sekadar folder; package adalah namespace dan architectural boundary.
2. Public type dalam package public adalah janji jangka panjang.
3. Package-private adalah alat desain yang sangat berguna.
4. Subpackage tidak punya special access terhadap parent package.
5. `internal` hanyalah convention kecuali dienforce dengan package-private, JPMS, static analysis, atau build boundary.
6. Package-by-layer mudah untuk awal, tetapi sering gagal pada sistem besar.
7. Package-by-feature/component lebih baik untuk change locality dan ownership.
8. `common`, `shared`, dan `util` harus sangat hati-hati.
9. DTO/entity/event/command harus tinggal dekat boundary semantiknya.
10. Split package harus dihindari, terutama untuk JPMS.
11. Package rename untuk public API adalah breaking change besar.
12. Package structure harus menjadi dokumentasi arsitektur yang bisa dibaca dari source tree.
13. Enforce package rules; jangan hanya berharap developer disiplin.

---

## 36. Latihan Praktis

Ambil satu module/service Java yang cukup besar, lalu buat inventory:

```text
1. List semua top-level package.
2. Tandai package API/internal/adapter/domain/application/shared.
3. Hitung class public vs package-private.
4. Cari package bernama common/shared/util/helper.
5. Cari dependency dari domain ke framework/adapter.
6. Cari package cycle.
7. Cari DTO yang dipakai lintas REST/application/event/persistence.
8. Cari public class di package internal.
9. Cari reflection/config string yang menyimpan package/class name.
10. Buat target package map yang lebih sehat.
```

Output yang diharapkan:

```text
Current package map
Dependency smell list
Public API inventory
Internal API leakage list
Refactoring sequence
Compatibility risks
Enforcement rules
```

---

## 37. Referensi Resmi dan Lanjutan

Referensi yang relevan untuk part ini:

1. Java Language Specification, Java SE 25 — Packages, Names, Access Control, Compilation Units.  
   https://docs.oracle.com/javase/specs/jls/se25/html/index.html

2. JLS Chapter 7 — Packages and Modules.  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-7.html

3. JLS Chapter 6 — Names and Access Control.  
   https://docs.oracle.com/javase/specs/jls/se25/html/jls-6.html

4. JEP 261 — Module System.  
   https://openjdk.org/jeps/261

5. Java SE 25 API Documentation — All Packages and module/package documentation model.  
   https://docs.oracle.com/en/java/javase/25/docs/api/index.html

6. Java SE 25 API — `java.lang.Package`.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Package.html

7. JEP 403 — Strongly Encapsulate JDK Internals.  
   https://openjdk.org/jeps/403

---

## 38. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-oop-functional-reflection-codegen-modules-part-026.md
```

Topik berikutnya:

```text
JPMS Deep Dive I: Modules, Descriptors, Readability, Exports, Requires
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-024](./learn-java-oop-functional-reflection-codegen-modules-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-026](./learn-java-oop-functional-reflection-codegen-modules-part-026.md)

</div>