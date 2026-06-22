# learn-java-oop-functional-reflection-codegen-modules-part-026

# JPMS Deep Dive I: Modules, Descriptors, Readability, Exports, Requires

> Seri: Java OOP, Functional, Reflection, Code Generation, Modules & Package Management  
> Part: 026  
> Fokus: Java Platform Module System tahap pertama: module sebagai boundary arsitektur, `module-info.java`, readability graph, `requires`, `exports`, module path, classpath interop, automatic module, unnamed module, split package, dan strategi migrasi.

---

## 0. Posisi Part Ini dalam Seri

Sebelum bagian ini, kita sudah membahas:

- class, object, identity, equality, immutability;
- encapsulation dan invariant;
- inheritance, interface, sealed hierarchy, record, enum;
- nested class, generics, polymorphism;
- composition dan functional style;
- reflection, method handles, annotations, annotation processing, code generation, dynamic proxy, bytecode, agents;
- package architecture.

Part ini naik satu level: dari **package boundary** menuju **module boundary**.

Package memberi namespace dan access control berbasis `public`, `protected`, package-private, dan `private`. Namun package saja tidak cukup untuk menjawab pertanyaan seperti:

- package mana yang benar-benar API publik sebuah library?
- dependency mana yang boleh dibaca oleh module ini?
- apakah runtime graph lengkap sebelum aplikasi dijalankan?
- apakah internal package dapat disembunyikan dari consumer?
- bagaimana mencegah split package dan dependency chaos?
- bagaimana membuat boundary yang bisa dipahami compiler, launcher, runtime, dan tool?

JPMS, Java Platform Module System, menjawab sebagian pertanyaan itu.

Mental model utamanya:

```text
class  -> unit perilaku dan state
package -> namespace + local encapsulation
module  -> named boundary + dependency graph + exported API surface
artifact -> distribution/build unit, misalnya JAR
runtime image -> kumpulan module yang dibawa saat aplikasi berjalan
```

Jadi, module bukan sekadar folder baru. Module adalah **kontrak antara source code, compiler, runtime, tooling, dan architecture**.

---

## 1. Masalah yang Diselesaikan JPMS

Sebelum JPMS, Java besar bergantung pada classpath. Classpath bekerja, tetapi punya beberapa masalah fundamental.

### 1.1 Classpath Tidak Punya Reliable Configuration

Classpath adalah daftar lokasi class/JAR. Runtime mencari class berdasarkan nama.

Masalahnya:

```text
app.jar: needs com.example.JsonMapper
classpath:
  lib-a.jar
  lib-b.jar
  lib-c.jar
```

Runtime tidak tahu secara formal:

- app bergantung pada module/artifact apa;
- dependency mana yang wajib;
- dependency mana yang hanya compile-time;
- package mana yang seharusnya terlihat;
- apakah ada dua JAR yang membawa package sama;
- apakah ada missing dependency sampai class tersebut benar-benar dipakai.

Akibatnya error sering baru muncul saat runtime:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
IllegalAccessError
```

JPMS memperkenalkan module graph supaya dependency dapat diselesaikan sebagai graph sebelum program berjalan penuh.

### 1.2 Classpath Tidak Punya Strong Encapsulation

Dengan classpath, `public` berarti public untuk semua orang yang bisa melihat classpath.

Contoh:

```text
com.acme.payment.api.PaymentService        -> harus public
com.acme.payment.internal.PaymentEngine    -> public karena framework/test/other package butuh
com.acme.payment.internal.SqlPaymentStore  -> public karena dipakai internal lintas package
```

Walaupun package bernama `internal`, secara bahasa class `public` tetap dapat dipakai consumer.

```java
import com.acme.payment.internal.SqlPaymentStore; // bisa selama ada di classpath
```

Konvensi `internal` hanya social contract, bukan enforced boundary.

JPMS memungkinkan module mengekspor package tertentu saja:

```java
module com.acme.payment {
    exports com.acme.payment.api;
}
```

Package internal tetap bisa berisi public class untuk kebutuhan internal antar package, tetapi tidak visible sebagai API module.

### 1.3 JDK Sendiri Terlalu Besar dan Sulit Dikecilkan

Sebelum Java 9, JDK/JRE sering diperlakukan sebagai satu platform besar. JPMS memecah JDK ke module seperti:

```text
java.base
java.sql
java.xml
java.net.http
java.management
java.compiler
jdk.compiler
jdk.jfr
...
```

Dengan module graph, tool seperti `jlink` dapat membuat runtime image yang hanya berisi module yang diperlukan. Detail `jlink` akan dibahas lebih dalam pada Part 027.

### 1.4 Dependency Boundary Tidak Terekspresikan di Source

Sebelum JPMS, dependency biasanya hidup di Maven/Gradle:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
</dependency>
```

Build tool tahu artifact dependency. Tetapi source code tidak punya descriptor standar yang menyatakan:

```text
module ini membaca module X
module ini mengekspor package Y
module ini membuka package Z untuk reflection
```

JPMS menambahkan `module-info.java` sebagai descriptor di source tree.

---

## 2. Module sebagai Unit Arsitektur

Sebuah module adalah kumpulan package yang diberi nama, dependency declaration, dan export/open policy.

Contoh paling sederhana:

```java
module com.acme.caseworkflow {
    requires java.base; // implisit, tidak perlu ditulis

    exports com.acme.caseworkflow.api;
}
```

Secara konseptual:

```text
module com.acme.caseworkflow
├── exports com.acme.caseworkflow.api
├── hides   com.acme.caseworkflow.internal
├── reads   java.base
└── contains packages/resources/classes
```

Module menjawab dua pertanyaan utama:

1. **Apa yang module ini butuhkan?**  
   Dijawab oleh `requires`.

2. **Apa yang module ini berikan kepada module lain?**  
   Dijawab oleh `exports`.

Nanti Part 027 akan menambahkan pertanyaan ketiga:

3. **Apa yang module ini buka untuk reflection/service/plugin runtime?**  
   Dijawab oleh `opens`, `uses`, dan `provides`.

---

## 3. `module-info.java`

Descriptor module ditulis dalam file bernama:

```text
module-info.java
```

Biasanya berada di root source set:

```text
src/main/java/
  module-info.java
  com/acme/caseworkflow/api/CaseWorkflow.java
  com/acme/caseworkflow/internal/DefaultCaseWorkflow.java
```

Contoh:

```java
module com.acme.caseworkflow {
    requires com.acme.common;
    requires java.sql;

    exports com.acme.caseworkflow.api;
}
```

Saat compile, `module-info.java` menjadi:

```text
module-info.class
```

Descriptor ini dibaca oleh compiler, launcher, runtime, dan tools.

### 3.1 Bentuk Umum Descriptor

```java
module com.acme.module.name {
    requires other.module;
    requires transitive another.module;
    requires static compile.only.module;

    exports com.acme.module.api;
    exports com.acme.module.spi to com.acme.consumer;

    // Part 027:
    // opens com.acme.module.internal to framework.module;
    // uses com.acme.spi.Plugin;
    // provides com.acme.spi.Plugin with com.acme.impl.DefaultPlugin;
}
```

Di Part ini kita fokus pada:

- `requires`
- `requires transitive`
- `requires static`
- `exports`
- qualified exports

---

## 4. Module Name

Module name sebaiknya global unik. Konvensi umumnya mengikuti reverse DNS, mirip package:

```java
module com.acme.caseworkflow { }
module com.acme.audit { }
module com.acme.document { }
```

Untuk module internal enterprise, penamaan yang baik membantu mencegah tabrakan:

```text
com.company.product.domain
com.company.product.caseworkflow
com.company.product.audit
com.company.product.integration.onemap
com.company.product.generated.metamodel
```

Hindari nama terlalu generik:

```java
module common { }        // buruk
module core { }          // buruk
module util { }          // buruk
module api { }           // buruk
```

Nama seperti itu akan menjadi ambiguous di graph besar.

### 4.1 Module Name Bukan Package Name

Module name dan package name sering mirip, tetapi bukan hal yang sama.

```java
module com.acme.payment {
    exports com.acme.payment.api;
}
```

Di sini:

```text
module name : com.acme.payment
package     : com.acme.payment.api
```

Satu module dapat berisi banyak package:

```text
com.acme.payment
├── com.acme.payment.api
├── com.acme.payment.spi
├── com.acme.payment.internal
├── com.acme.payment.internal.jpa
└── com.acme.payment.internal.rules
```

---

## 5. `java.base`: Module yang Selalu Ada

Setiap module secara implisit membaca `java.base`.

Artinya Anda tidak perlu menulis:

```java
module com.acme.caseworkflow {
    requires java.base; // redundant
}
```

`java.base` berisi API fundamental seperti:

- `java.lang`
- `java.util`
- `java.io`
- `java.net`
- `java.time`
- `java.math`
- `java.lang.invoke`
- `java.lang.reflect`
- sebagian besar fondasi bahasa/runtime

Mental model:

```text
Every named module -> reads java.base implicitly
```

Jadi ketika sebuah module memakai `String`, `Object`, `List`, `Optional`, `Class`, `MethodHandle`, Anda tidak perlu `requires java.base`.

---

## 6. Readability: Konsep Paling Penting di JPMS

Dalam JPMS, sebuah module tidak otomatis bisa membaca semua module lain. Module harus memiliki readability edge.

Contoh:

```java
module com.acme.caseworkflow {
    requires com.acme.audit;
}
```

Artinya:

```text
com.acme.caseworkflow reads com.acme.audit
```

Graph:

```text
com.acme.caseworkflow ──reads──> com.acme.audit
```

Jika `com.acme.caseworkflow` mencoba memakai package dari `com.acme.document`, tetapi tidak ada `requires com.acme.document`, compile akan gagal.

### 6.1 Readability Bukan Visibility Package

Ini penting.

Agar module A dapat memakai type dari module B, dua hal harus benar:

1. A membaca B.  
   Ada edge `requires B`.

2. B mengekspor package yang berisi type tersebut.  
   Ada `exports package.name`.

Contoh:

```java
module com.acme.caseworkflow {
    requires com.acme.audit;
}
```

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

Maka `caseworkflow` bisa mengakses:

```java
import com.acme.audit.api.AuditService;
```

Tetapi tidak bisa mengakses:

```java
import com.acme.audit.internal.AuditSqlStore; // tidak diekspor
```

Walaupun `AuditSqlStore` adalah `public class`, tetap tidak accessible dari module lain jika package-nya tidak diekspor.

---

## 7. `requires`

`requires` menyatakan dependency antar module.

```java
module com.acme.caseworkflow {
    requires com.acme.audit;
    requires com.acme.document;
    requires java.sql;
}
```

Artinya:

```text
com.acme.caseworkflow membaca:
- com.acme.audit
- com.acme.document
- java.sql
```

### 7.1 Kapan Menulis `requires`

Tulis `requires` jika source code module Anda memakai exported package dari module lain.

Contoh:

```java
package com.acme.caseworkflow.internal;

import com.acme.audit.api.AuditService;

final class CaseApprovalService {
    private final AuditService auditService;
}
```

Maka descriptor butuh:

```java
module com.acme.caseworkflow {
    requires com.acme.audit;
}
```

### 7.2 `requires` Bukan Maven Dependency

`requires` adalah dependency pada **module name**.

Maven/Gradle dependency adalah dependency pada **artifact coordinate**.

```text
Maven coordinate:
  groupId: com.acme
  artifactId: audit-api
  version: 1.2.0

JPMS module name:
  com.acme.audit
```

Satu artifact biasanya membawa satu module, tetapi konsepnya tetap beda.

```text
build tool resolves artifacts
JPMS resolves modules
```

Build tool menjawab:

```text
JAR mana yang harus di-download?
```

JPMS menjawab:

```text
module mana yang readable, package mana yang exported, graph mana yang valid?
```

---

## 8. `exports`

`exports` menyatakan package mana yang menjadi public API module.

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

Jika package tidak diekspor, package itu hanya bisa dipakai internal module.

Contoh struktur:

```text
com.acme.audit
├── com.acme.audit.api        exported
├── com.acme.audit.spi        maybe exported
├── com.acme.audit.internal   hidden
├── com.acme.audit.sql        hidden
└── com.acme.audit.generated  hidden or exported depending use case
```

Descriptor:

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

### 8.1 `public` Tidak Cukup

Class ini:

```java
package com.acme.audit.internal;

public final class AuditSqlStore {
}
```

Tetap tidak bisa dipakai oleh module lain jika package `com.acme.audit.internal` tidak diekspor.

Mental model:

```text
Access from another module requires:
public type/member + exported package + readable module
```

Bukan hanya `public`.

### 8.2 Export adalah API Commitment

Begitu package diekspor, package tersebut menjadi API module.

Artinya Anda perlu memikirkan:

- binary compatibility;
- semantic compatibility;
- deprecation strategy;
- documentation;
- test compatibility;
- consumer migration;
- versioning.

Jangan ekspor package hanya agar “compile dulu”. Itu menambah surface area kontrak.

Bad:

```java
module com.acme.audit {
    exports com.acme.audit.api;
    exports com.acme.audit.internal; // demi test atau framework
    exports com.acme.audit.sql;      // demi caller yang seharusnya tidak tahu SQL
}
```

Better:

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

Jika reflection framework butuh access, Part 027 akan membahas `opens`, bukan `exports`.

---

## 9. `requires transitive`

`requires transitive` menyatakan bahwa dependency Anda ikut menjadi dependency yang readable oleh consumer Anda.

Contoh:

```java
module com.acme.caseworkflow.api {
    requires transitive com.acme.common.types;
    exports com.acme.caseworkflow.api;
}
```

Misalnya API Anda mengekspos type dari `com.acme.common.types`:

```java
package com.acme.caseworkflow.api;

import com.acme.common.types.CaseId;

public interface CaseWorkflow {
    CaseStatus findStatus(CaseId caseId);
}
```

Consumer:

```java
module com.acme.caseapp {
    requires com.acme.caseworkflow.api;
    // tidak perlu explicit requires com.acme.common.types jika transitive
}
```

Graph:

```text
com.acme.caseapp
  └──reads──> com.acme.caseworkflow.api
                └──requires transitive──> com.acme.common.types

=> com.acme.caseapp also reads com.acme.common.types
```

### 9.1 Kapan Pakai `requires transitive`

Gunakan jika dependency muncul di public API module Anda.

Contoh tepat:

```java
public interface DocumentService {
    DocumentId create(DocumentCommand command);
}
```

Jika `DocumentId` dan `DocumentCommand` berasal dari module `com.acme.document.types`, maka module API Anda mungkin butuh:

```java
requires transitive com.acme.document.types;
```

### 9.2 Kapan Jangan Pakai `requires transitive`

Jangan gunakan untuk dependency internal implementation.

Bad:

```java
module com.acme.caseworkflow {
    requires transitive com.fasterxml.jackson.databind; // padahal hanya internal serialization
    requires transitive com.acme.audit.sql;             // padahal hanya impl detail
}
```

Ini membocorkan dependency internal ke consumer.

Better:

```java
module com.acme.caseworkflow {
    requires com.fasterxml.jackson.databind;
    requires com.acme.audit;

    exports com.acme.caseworkflow.api;
}
```

Rule:

```text
If a dependency type appears in your exported API signatures, consider requires transitive.
If it is only used in implementation, use plain requires.
```

### 9.3 `requires transitive` Adalah API Coupling

Begitu Anda menaruh dependency sebagai transitive, Anda membuat dependency itu bagian dari public surface.

Pertanyaan review:

- apakah consumer memang perlu membaca module ini?
- apakah type dependency muncul di exported package signatures?
- apakah dependency ini stabil?
- apakah Anda rela consumer mengandalkan dependency ini?
- apakah perubahan dependency akan menjadi breaking change bagi API Anda?

---

## 10. `requires static`

`requires static` menyatakan dependency yang diperlukan saat compile tetapi optional saat runtime.

Contoh umum:

```java
module com.acme.audit {
    requires static com.github.spotbugs.annotations;

    exports com.acme.audit.api;
}
```

Atau annotation compile-time:

```java
module com.acme.domain {
    requires static org.jetbrains.annotations;
}
```

Mental model:

```text
requires static = compile-time readability, not mandatory at runtime
```

### 10.1 Kapan Pakai `requires static`

Cocok untuk:

- compile-time annotation;
- static analysis annotation;
- optional integration API;
- optional generated-code metadata;
- compile-time only helper module.

Contoh:

```java
module com.acme.rules {
    requires static com.acme.codegen.annotations;
}
```

Jika annotation diproses compile-time dan tidak dibutuhkan runtime, `requires static` bisa masuk akal.

### 10.2 Risiko `requires static`

Jangan pakai `requires static` untuk dependency yang sebenarnya dibutuhkan runtime.

Bad:

```java
module com.acme.payment {
    requires static com.acme.payment.gateway;
}
```

Jika runtime code benar-benar melakukan:

```java
new PaymentGatewayClient();
```

lalu module tidak ada saat runtime, Anda akan masuk failure seperti:

```text
NoClassDefFoundError
ClassNotFoundException
```

Rule:

```text
requires static is safe only if runtime execution can survive when module is absent.
```

---

## 11. Qualified Exports

Kadang package hanya perlu diekspor ke module tertentu.

```java
module com.acme.caseworkflow {
    exports com.acme.caseworkflow.api;
    exports com.acme.caseworkflow.testing to com.acme.caseworkflow.tests;
}
```

Bentuk:

```java
exports package.name to module.a, module.b;
```

Artinya package tersebut hanya accessible oleh target module yang disebut.

### 11.1 Use Case Qualified Export

Cocok untuk:

- testing support package;
- generated integration package;
- internal SPI untuk module tertentu;
- adapter khusus;
- migration bridge;
- white-box test module.

Contoh:

```java
module com.acme.audit {
    exports com.acme.audit.api;
    exports com.acme.audit.testsupport to com.acme.audit.tests;
}
```

### 11.2 Jangan Jadikan Qualified Export sebagai Escape Hatch Berlebihan

Bad:

```java
module com.acme.audit {
    exports com.acme.audit.internal to
        com.acme.caseworkflow,
        com.acme.document,
        com.acme.report,
        com.acme.batch,
        com.acme.integration;
}
```

Ini tanda boundary salah.

Jika terlalu banyak module butuh internal package, mungkin package itu sebenarnya:

- harus menjadi API resmi;
- harus dipindahkan ke shared abstraction;
- harus dipecah;
- atau consumer terlalu coupling dengan implementation.

---

## 12. Accessibility Formula dalam JPMS

Dari module A ke type T di module B, akses berhasil jika semua ini terpenuhi:

```text
1. module A reads module B
2. module B exports package containing T to A
3. T is public
4. accessed member is public or otherwise accessible by Java access rules
```

Contoh:

```java
module com.acme.app {
    requires com.acme.audit;
}
```

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

```java
package com.acme.audit.api;

public interface AuditService {
    void record(AuditEvent event);
}
```

Akses valid.

Tapi ini gagal:

```java
package com.acme.audit.internal;

public final class AuditSqlStore { }
```

Karena package tidak diekspor.

Dan ini juga gagal:

```java
package com.acme.audit.api;

final class DefaultAuditEvent implements AuditEvent { }
```

Karena class tidak public, walaupun package exported.

---

## 13. Module Path vs Classpath

JPMS memperkenalkan module path.

```text
classpath  -> legacy class lookup path
modulepath -> module lookup path
```

Compile contoh:

```bash
javac \
  --module-path mods \
  -d out/com.acme.caseworkflow \
  src/com.acme.caseworkflow/module-info.java \
  src/com.acme.caseworkflow/com/acme/caseworkflow/api/*.java
```

Run contoh:

```bash
java \
  --module-path mods:out \
  --module com.acme.caseworkflow/com.acme.caseworkflow.Main
```

### 13.1 Classpath Mindset

Classpath mindset:

```text
Put all jars together. Runtime finds classes by name.
```

### 13.2 Module Path Mindset

Module path mindset:

```text
Put modules on module path. Runtime resolves module graph from roots.
```

JPMS tidak hanya mencari class, tetapi menyelesaikan graph:

```text
root modules
  -> requires dependencies
  -> requires dependencies
  -> valid graph or fail early
```

### 13.3 Hybrid Mode

Dalam sistem enterprise modern, Anda sering akan berada dalam hybrid mode:

```text
some named modules on module path
legacy jars on classpath / unnamed module
some jars as automatic modules
framework requiring opens/add-opens
```

Hybrid mode itu realistis. Jangan berpikir migrasi JPMS harus big bang.

---

## 14. Named Module, Automatic Module, Unnamed Module

Ada tiga konsep penting.

### 14.1 Named Module

Named module memiliki `module-info.class`.

```text
audit.jar
└── module-info.class
```

Descriptor:

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

Ini adalah bentuk JPMS paling eksplisit.

### 14.2 Automatic Module

Automatic module adalah JAR di module path yang tidak punya explicit `module-info.class`.

JPMS memberinya module name otomatis atau dari manifest `Automatic-Module-Name`.

Contoh:

```text
legacy-json-1.2.0.jar on module path
```

Bisa menjadi automatic module bernama kurang lebih:

```text
legacy.json
```

Tergantung aturan nama.

Masalah:

- nama otomatis bisa tidak stabil;
- semua package biasanya dianggap exported;
- dependency declaration tidak eksplisit;
- cocok sebagai migration bridge, bukan desain ideal jangka panjang.

### 14.3 Unnamed Module

Classpath legacy code masuk ke unnamed module.

```text
all jars/classes on classpath -> unnamed module
```

Unnamed module:

- membaca banyak named module tertentu;
- dapat mengakses exported packages dari named modules;
- tidak punya `module-info.java`;
- tidak bisa direferensikan oleh named module dengan `requires`.

Konsekuensi besar:

```text
Named module cannot require the unnamed module.
```

Artinya jika Anda memodularisasi module A, tetapi A masih bergantung pada library yang hanya ada di classpath unnamed module, itu masalah. Library tersebut perlu berada di module path sebagai automatic module atau explicit module.

---

## 15. Root Modules dan Module Resolution

Saat menjalankan aplikasi modular, Anda memilih root module.

```bash
java --module-path mods --module com.acme.app/com.acme.app.Main
```

Root module:

```text
com.acme.app
```

Runtime lalu menyelesaikan graph:

```text
com.acme.app
├── requires com.acme.caseworkflow
│   ├── requires com.acme.audit
│   └── requires com.acme.document
└── requires java.sql
    └── requires java.xml
```

Jika dependency hilang, resolution gagal lebih awal.

Ini bagian dari reliable configuration.

---

## 16. Observable Modules

Module hanya bisa diselesaikan jika observable oleh module system.

Sumber observable module bisa berupa:

- system modules dari JDK;
- module path;
- upgrade module path;
- application module path;
- custom module finder/tooling.

Praktisnya, untuk aplikasi biasa:

```bash
--module-path mods:lib
```

menentukan lokasi module yang bisa diamati.

Jika module ada di disk tetapi tidak di module path, module itu tidak observable.

---

## 17. Split Package Problem

Split package terjadi ketika package yang sama muncul di lebih dari satu module.

Contoh buruk:

```text
module com.acme.audit.api
└── package com.acme.audit

module com.acme.audit.impl
└── package com.acme.audit
```

Atau:

```text
audit-core.jar    -> com.acme.audit.model.AuditEvent
audit-extra.jar   -> com.acme.audit.model.AuditFilter
```

Di classpath, split package sering “jalan” walaupun berbahaya. Di JPMS, split package menjadi masalah karena module system ingin package dimiliki jelas oleh satu module.

### 17.1 Kenapa Split Package Berbahaya

Karena membuat ownership kabur:

```text
Who owns com.acme.audit.model?
Which JAR provides it?
Which module exports it?
Which version wins?
```

Risiko:

- class shadowing;
- inconsistent runtime;
- accidental override;
- impossible strong encapsulation;
- sulit refactoring;
- konflik dependency transitive.

### 17.2 Cara Menghindari Split Package

Gunakan package berbeda per module:

```text
com.acme.audit.api
com.acme.audit.internal
com.acme.audit.sql
com.acme.audit.generated
```

Jika perlu memecah artifact, tetap jaga package ownership.

Bad:

```text
artifact audit-api     -> com.acme.audit
artifact audit-impl    -> com.acme.audit
```

Better:

```text
artifact audit-api     -> com.acme.audit.api
artifact audit-impl    -> com.acme.audit.impl
```

Atau better jika satu module:

```text
module com.acme.audit
├── com.acme.audit.api
├── com.acme.audit.internal
└── com.acme.audit.sql
```

---

## 18. Designing Module Boundaries

Module boundary harus mengikuti stability dan ownership, bukan sekadar layer teknis.

### 18.1 Boundary Buruk: Layer-Based Global Modules

```text
com.acme.controller
com.acme.service
com.acme.repository
com.acme.dto
com.acme.util
```

Masalah:

- semua domain bercampur;
- dependencies horizontal;
- module service bergantung ke banyak hal;
- package cycle mudah terjadi;
- API surface tidak jelas;
- domain ownership hilang.

### 18.2 Boundary Lebih Baik: Capability/Component-Based Modules

```text
com.acme.caseworkflow
com.acme.audit
com.acme.document
com.acme.notification
com.acme.identity
com.acme.common.types
```

Masing-masing module punya API sendiri:

```text
com.acme.caseworkflow
├── exports com.acme.caseworkflow.api
└── hides   com.acme.caseworkflow.internal
```

### 18.3 Boundary Berdasarkan Volatility

Pisahkan code berdasarkan tingkat perubahan.

```text
stable API types       -> module kecil, dependency minimal
business logic         -> module domain/capability
integration adapters   -> module adapter/infrastructure
generated code         -> module/package terisolasi
framework binding      -> module edge
```

Contoh:

```text
com.acme.caseworkflow.api      stable contract
com.acme.caseworkflow.core     business rules
com.acme.caseworkflow.adapter  DB/framework/integration
```

Tetapi jangan terlalu cepat memecah module. Terlalu banyak module juga menambah biaya.

---

## 19. Public API Module vs Implementation Module

Ada dua pola umum.

### 19.1 Single Module with Exported API Package

```java
module com.acme.audit {
    exports com.acme.audit.api;

    requires java.sql;
}
```

Struktur:

```text
com.acme.audit
├── api
├── internal
└── sql
```

Kelebihan:

- sederhana;
- cocok untuk codebase internal;
- minim artifact;
- internal package tersembunyi.

Kekurangan:

- consumer membawa implementation dependency jika artifact sama;
- API dan impl versioning terikat.

### 19.2 Separate API and Implementation Modules

```java
module com.acme.audit.api {
    exports com.acme.audit.api;
}
```

```java
module com.acme.audit.impl {
    requires com.acme.audit.api;
    requires java.sql;
}
```

Kelebihan:

- API lebih stabil;
- implementation bisa diganti;
- dependency API kecil;
- cocok untuk plugin/SPI/provider.

Kekurangan:

- lebih banyak module/artifact;
- dependency graph lebih kompleks;
- wiring lebih explicit;
- risiko overengineering.

Rule praktis:

```text
Internal enterprise app: start with single module + exported API package.
Reusable platform library/SPI: consider separate API and implementation modules.
```

---

## 20. JPMS dan Maven/Gradle

JPMS tidak menggantikan Maven/Gradle.

```text
Maven/Gradle:
- download artifacts
- resolve versions
- build lifecycle
- compile/test/package
- publish artifact

JPMS:
- resolve module graph
- enforce readability
- enforce exports/opens
- support modular runtime
```

Keduanya saling melengkapi.

### 20.1 Maven Multi-Module vs JPMS Module

Maven module:

```text
parent-pom
├── audit-api
├── audit-impl
└── caseworkflow
```

JPMS module:

```java
module com.acme.audit.api { }
module com.acme.audit.impl { }
module com.acme.caseworkflow { }
```

Biasanya satu Maven artifact membawa satu JPMS module, tetapi tidak wajib secara konseptual.

Good practical rule:

```text
one published JAR -> one JPMS module
```

### 20.2 Gradle Subproject vs JPMS Module

Gradle subproject:

```text
:modules:audit-api
:modules:audit-impl
:modules:caseworkflow
```

JPMS module descriptor tetap ada di masing-masing source set:

```text
modules/audit-api/src/main/java/module-info.java
```

---

## 21. Automatic-Module-Name

Untuk library yang belum full modular, manifest dapat menambahkan:

```text
Automatic-Module-Name: com.acme.audit
```

Ini membantu memberi nama stabil ketika JAR dipakai sebagai automatic module.

Tanpa itu, module name bisa diturunkan dari nama JAR, misalnya:

```text
audit-core-1.2.0.jar -> audit.core
```

Nama turunan bisa berubah jika nama artifact berubah.

### 21.1 Kapan Gunakan Automatic-Module-Name

Cocok untuk library yang:

- belum siap full JPMS;
- ingin memberi module name stabil;
- masih perlu kompatibel dengan Java 8/classpath;
- ingin mempermudah consumer modular.

Ini migration bridge yang baik.

---

## 22. Migration Strategy dari Classpath ke JPMS

Jangan mulai dengan menambahkan `module-info.java` ke semua hal sekaligus.

Gunakan strategi bertahap.

### 22.1 Step 1 — Stabilkan Package Boundary

Sebelum module, rapikan package.

Checklist:

- tidak ada split package;
- package `internal` benar-benar internal;
- API package jelas;
- dependency direction jelas;
- tidak ada import liar ke package internal;
- generated package dipisahkan;
- test support package dipisahkan.

Jika package kacau, JPMS akan mengekspos kekacauan itu.

### 22.2 Step 2 — Identifikasi API Surface

Untuk setiap artifact/module kandidat:

```text
exports apa?
hidden apa?
requires apa?
optional apa?
reflection butuh apa?
```

Tulis tabel:

| Candidate Module | Exported Packages | Internal Packages | Dependencies | Reflection Needs |
|---|---|---|---|---|
| com.acme.audit | com.acme.audit.api | internal, sql | java.sql, common.types | maybe opens internal.model |
| com.acme.caseworkflow | api | internal, rules | audit, document | none |

### 22.3 Step 3 — Tambahkan Automatic-Module-Name

Jika belum bisa full JPMS, tambahkan manifest stable name.

Maven contoh:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-jar-plugin</artifactId>
  <configuration>
    <archive>
      <manifestEntries>
        <Automatic-Module-Name>com.acme.audit</Automatic-Module-Name>
      </manifestEntries>
    </archive>
  </configuration>
</plugin>
```

### 22.4 Step 4 — Modularisasi Library Paling Stabil Dulu

Mulai dari:

- common types;
- pure domain model;
- utility yang benar-benar stabil;
- API-only module;
- generated metadata module.

Jangan mulai dari:

- Spring/Jakarta-heavy application module;
- ORM-heavy module;
- reflection-heavy framework binding;
- giant legacy monolith.

### 22.5 Step 5 — Jalankan Hybrid Mode

Biarkan sebagian masih classpath.

```text
modular core + legacy edge
```

Bukan:

```text
all-or-nothing migration
```

### 22.6 Step 6 — Tambahkan `exports` Minimal

Mulai dengan:

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

Jangan ekspor internal package sampai ada alasan kuat.

### 22.7 Step 7 — Tangani Reflection dengan `opens`, Bukan `exports`

Jika framework butuh deep reflection, jangan langsung:

```java
exports com.acme.audit.internal.model;
```

Part 027 akan membahas:

```java
opens com.acme.audit.internal.model to com.fasterxml.jackson.databind;
```

Export untuk compile-time API.  
Open untuk deep reflection runtime.

---

## 23. JPMS untuk Enterprise Application: Realistic View

Banyak enterprise Java app tidak sepenuhnya modular karena:

- framework reflection;
- classpath-based plugin;
- generated proxy;
- legacy dependencies;
- annotation processors;
- ORM enhancement;
- test tooling;
- application server/container conventions;
- Spring Boot fat JAR packaging;
- Jakarta runtime integration.

Jadi target realistis bukan selalu “semua harus named module”.

Target realistis:

```text
Use JPMS thinking to design boundaries,
even if deployment remains partly classpath-based.
```

Artinya:

- package API/internal jelas;
- dependency direction enforced by build/lint;
- exported API minim;
- reflection boundary eksplisit;
- generated code dipisah;
- split package dihindari;
- future modularization possible.

---

## 24. Module Design for Regulatory Case Management System

Misalkan sistem punya domain:

- case management;
- appeal;
- compliance;
- audit trail;
- document;
- notification;
- correspondence;
- screening;
- enforcement action;
- report.

Package-by-layer buruk:

```text
com.gov.controller
com.gov.service
com.gov.repository
com.gov.dto
com.gov.util
```

JPMS-friendly design lebih baik:

```text
module com.gov.caseworkflow
module com.gov.audittrail
module com.gov.document
module com.gov.notification
module com.gov.screening
module com.gov.common.types
```

Contoh descriptor:

```java
module com.gov.audittrail {
    requires com.gov.common.types;
    requires java.sql;

    exports com.gov.audittrail.api;
}
```

```java
module com.gov.caseworkflow {
    requires com.gov.common.types;
    requires com.gov.audittrail;
    requires com.gov.document;
    requires com.gov.notification;

    exports com.gov.caseworkflow.api;
}
```

Pertanyaan arsitektur:

- apakah `caseworkflow` boleh tahu SQL audit trail?
- apakah `document` boleh memanggil `caseworkflow.internal`?
- apakah `screening` hanya provider SPI atau direct dependency?
- apakah event type berada di common module atau owned module?
- apakah report membaca domain API atau langsung table/view?

JPMS memaksa pertanyaan ini muncul secara formal.

---

## 25. API/Internal Split dalam Module

Contoh:

```text
com.gov.caseworkflow
├── com.gov.caseworkflow.api
│   ├── CaseWorkflowService
│   ├── CaseDecision
│   ├── CaseCommand
│   └── CaseWorkflowException
├── com.gov.caseworkflow.internal
│   ├── DefaultCaseWorkflowService
│   └── CaseWorkflowEngine
├── com.gov.caseworkflow.internal.rules
│   ├── EscalationRule
│   └── AssignmentRule
└── com.gov.caseworkflow.internal.persistence
    ├── CaseWorkflowRepository
    └── SqlCaseWorkflowRepository
```

Descriptor:

```java
module com.gov.caseworkflow {
    requires com.gov.common.types;
    requires com.gov.audittrail;
    requires java.sql;

    exports com.gov.caseworkflow.api;
}
```

Consumer hanya melihat API:

```java
import com.gov.caseworkflow.api.CaseWorkflowService;
```

Consumer tidak bisa:

```java
import com.gov.caseworkflow.internal.CaseWorkflowEngine;
```

Walaupun class internal public, package tidak exported.

---

## 26. Dependency Direction dengan JPMS

JPMS graph harus acyclic.

Bad:

```text
caseworkflow -> document
document     -> audittrail
audittrail   -> caseworkflow
```

Cycle seperti ini menunjukkan ownership kabur.

Cara memperbaiki:

### 26.1 Extract Common Types

```text
caseworkflow -> common.types
document     -> common.types
audittrail   -> common.types
```

### 26.2 Introduce Event/API Boundary

```text
caseworkflow -> audittrail.api
caseworkflow -> document.api
```

Audit trail tidak perlu balik memanggil caseworkflow.

### 26.3 Use SPI/Service Provider

Untuk plugin-like behavior:

```text
caseworkflow uses ScreeningProvider
screening provides ScreeningProvider
```

Ini akan dibahas di Part 027.

### 26.4 Use Application Orchestrator Module

Kadang dependency dua domain terjadi karena orchestration salah tempat.

Bad:

```text
document -> caseworkflow
caseworkflow -> document
```

Better:

```text
application.orchestrator -> document
application.orchestrator -> caseworkflow
```

Domain module tidak saling cyclic.

---

## 27. `exports` vs Package-Private: Layered Encapsulation

JPMS memberi lapisan tambahan.

```text
private/member-level
package-private/package-level
public/package-level
exports/module-level
requires/graph-level
```

Contoh:

```java
module com.acme.audit {
    exports com.acme.audit.api;
}
```

```java
package com.acme.audit.api;

public interface AuditService { }
```

```java
package com.acme.audit.api;

final class AuditEventValidator { } // package-private helper inside exported package
```

Walaupun package diekspor, package-private class tetap tidak accessible dari package lain.

Layering:

```text
exported package != all classes public API
```

API package boleh punya package-private helpers.

---

## 28. Anti-Patterns dalam JPMS

### 28.1 Export Everything

```java
module com.acme.app {
    exports com.acme.app.api;
    exports com.acme.app.internal;
    exports com.acme.app.internal.sql;
    exports com.acme.app.internal.generated;
}
```

Ini membuat JPMS tidak berguna.

### 28.2 `requires transitive` Everywhere

```java
module com.acme.app {
    requires transitive java.sql;
    requires transitive com.fasterxml.jackson.databind;
    requires transitive org.slf4j;
}
```

Ini membocorkan implementation dependency ke consumer.

### 28.3 Module per Package

```text
module com.acme.caseworkflow.api
module com.acme.caseworkflow.internal
module com.acme.caseworkflow.rules
module com.acme.caseworkflow.persistence
```

Terlalu granular untuk banyak aplikasi. Module graph menjadi noisy.

### 28.4 One Giant Module

```java
module com.acme.everything {
    exports dozens.of.packages;
    requires dozens.of.modules;
}
```

Ini hanya classpath dengan nama module.

### 28.5 Naming Module Berdasarkan Teknologi

```text
com.acme.spring
com.acme.jpa
com.acme.kafka
```

Kadang valid untuk adapter, tetapi sering menandakan boundary teknis, bukan capability.

### 28.6 Menggunakan `exports` untuk Reflection

Jika framework butuh reflection, `exports` bukan jawaban utama. Gunakan `opens` atau qualified `opens`. Ini Part 027.

---

## 29. Failure Model JPMS Part I

### 29.1 Module Not Found

Penyebab:

- module tidak ada di module path;
- salah module name;
- artifact belum membawa module descriptor/automatic name;
- build tidak memasukkan dependency.

Gejala:

```text
java.lang.module.FindException: Module X not found
```

Cara berpikir:

```text
Is the artifact present?
Is it on module path, not only classpath?
What is its module name?
Is the root module correct?
```

### 29.2 Package Not Visible

Penyebab:

- module dependency ada, tetapi package tidak exported;
- qualified export tidak menarget module Anda;
- type berada di internal package.

Gejala compile:

```text
package ... is not visible
```

Cara berpikir:

```text
Does my module read the provider module?
Does provider export the package to me?
Should I really depend on this package?
```

### 29.3 Missing `requires`

Penyebab:

- source memakai type dari module lain;
- descriptor belum punya `requires`.

Cara berpikir:

```text
Import type belongs to which module?
Should dependency be plain, transitive, or static?
```

### 29.4 Split Package

Penyebab:

- package sama muncul di dua modules;
- artifact lama memecah package;
- generated code masuk package yang salah;
- test fixture duplicate package.

Cara berpikir:

```text
Who owns this package?
Can we rename package per module?
Can generated code move to .generated package?
```

### 29.5 Runtime Works on Classpath, Fails on Module Path

Penyebab umum:

- internal package tidak exported/opened;
- reflection framework butuh `opens`;
- automatic module name tidak sesuai;
- split package yang dulu tersembunyi;
- dependency transitive classpath dulu tidak formal.

Cara berpikir:

```text
Classpath tolerates ambiguity. Module path exposes it.
```

---

## 30. Checklist Mendesain `module-info.java`

Untuk setiap module, jawab:

### 30.1 Identity

- Apa nama module?
- Apakah nama stabil?
- Apakah mengikuti ownership organisasi?
- Apakah terlalu generik?

### 30.2 API Surface

- Package mana yang diekspor?
- Apakah setiap exported package benar-benar API?
- Apakah ada internal package yang bocor?
- Apakah test/support package butuh qualified export?

### 30.3 Dependency

- Module apa yang dibaca?
- Dependency mana yang implementation-only?
- Dependency mana yang muncul di public API?
- Mana yang harus `requires transitive`?
- Mana yang compile-time only dan bisa `requires static`?

### 30.4 Package Ownership

- Apakah ada split package?
- Apakah generated code punya package sendiri?
- Apakah API/internal/testsupport dipisahkan?

### 30.5 Migration

- Apakah semua dependency punya module name?
- Apakah perlu `Automatic-Module-Name`?
- Apakah ada framework reflection yang nanti perlu `opens`?
- Apakah bisa hybrid dulu?

---

## 31. Worked Example: From Package Design to Module Descriptor

Misal package awal:

```text
com.acme.workflow
├── CaseWorkflowService.java
├── CaseWorkflowEngine.java
├── SqlCaseRepository.java
├── AuditClient.java
├── CaseCommand.java
└── CaseStatus.java
```

Masalah:

- API dan internal campur;
- SQL implementation visible;
- audit integration visible;
- sulit tahu yang public contract.

Refactor package:

```text
com.acme.caseworkflow.api
├── CaseWorkflowService.java
├── CaseCommand.java
├── CaseStatus.java
└── CaseWorkflowException.java

com.acme.caseworkflow.internal
├── DefaultCaseWorkflowService.java
└── CaseWorkflowEngine.java

com.acme.caseworkflow.internal.persistence
└── SqlCaseRepository.java

com.acme.caseworkflow.internal.audit
└── AuditClient.java
```

Descriptor:

```java
module com.acme.caseworkflow {
    requires com.acme.audit;
    requires com.acme.common.types;
    requires java.sql;

    exports com.acme.caseworkflow.api;
}
```

Jika `CaseCommand` memakai `UserId` dari `com.acme.common.types`:

```java
public record CaseCommand(UserId submittedBy, String caseNo) { }
```

Maka pertimbangkan:

```java
requires transitive com.acme.common.types;
```

Karena consumer API perlu membaca `UserId` juga.

Descriptor final:

```java
module com.acme.caseworkflow {
    requires com.acme.audit;
    requires transitive com.acme.common.types;
    requires java.sql;

    exports com.acme.caseworkflow.api;
}
```

Review:

```text
com.acme.audit plain requires? yes, implementation detail.
com.acme.common.types transitive? yes, appears in exported API.
java.sql plain requires? yes, internal persistence only.
exports only api? yes.
split package? no.
```

---

## 32. JPMS and Public API Minimalism

JPMS membuat API minimalism lebih konkret.

Sebelum JPMS:

```text
public class accidentally becomes available to everyone on classpath.
```

Dengan JPMS:

```text
public class in non-exported package remains internal to module.
```

Ini mengubah desain library:

- Anda bisa membuat class public untuk internal cross-package use;
- Anda tidak harus membuat semua internal helper package-private dalam satu package raksasa;
- Anda bisa menyusun internal package dengan lebih bersih;
- Anda bisa mengekspor API yang kecil dan stabil.

Contoh:

```text
com.acme.audit.internal.validation
com.acme.audit.internal.persistence
com.acme.audit.internal.mapping
```

Semua boleh punya `public` class antar internal package jika perlu, tetapi tidak exported.

---

## 33. JPMS and Testing

Testing modular code butuh keputusan boundary.

Pendekatan:

### 33.1 Test Through Public API

Paling ideal untuk banyak module:

```text
test module -> requires module under test -> uses exported API
```

Kelebihan:

- menjaga boundary;
- test menyerupai consumer;
- refactoring internal lebih aman.

Kekurangan:

- sulit menguji edge internal tertentu;
- kadang butuh fixture lebih besar.

### 33.2 Qualified Export Test Support

```java
module com.acme.caseworkflow {
    exports com.acme.caseworkflow.api;
    exports com.acme.caseworkflow.testsupport to com.acme.caseworkflow.tests;
}
```

Cocok untuk fixture/builder khusus test.

### 33.3 Avoid Exporting Internal Just for Tests

Bad:

```java
exports com.acme.caseworkflow.internal;
```

Hanya demi test.

Better:

- test via API;
- pindahkan stable test helper ke testsupport;
- gunakan package-private tests jika masih non-modular;
- gunakan build-tool-specific test access dengan sadar;
- jangan ubah production API hanya demi test convenience.

---

## 34. JPMS and Code Generation

Generated code harus dirancang sejak awal dalam module boundary.

Pertanyaan:

- generated code berada di package mana?
- apakah generated package perlu diekspor?
- apakah generated code implementation detail?
- apakah annotation processor menghasilkan class yang dipakai consumer?
- apakah generated code punya dependency tambahan?

Contoh generated implementation detail:

```text
com.acme.caseworkflow.internal.generated
```

Tidak perlu export.

Contoh generated API metamodel:

```text
com.acme.caseworkflow.metamodel
```

Jika consumer butuh:

```java
exports com.acme.caseworkflow.metamodel;
```

Tapi pikirkan compatibility-nya. Generated API tetap API.

---

## 35. JPMS and Reflection Preview

Part ini fokus pada `exports`. Namun reflection-heavy framework akan terkena JPMS.

Perbedaan sederhana:

```text
exports -> compile-time and ordinary access to public types/members
opens   -> deep reflection access at runtime
```

Jangan campur:

```java
exports com.acme.domain.internal.model; // salah jika hanya untuk serializer reflection
```

Lebih tepat:

```java
opens com.acme.domain.internal.model to com.fasterxml.jackson.databind;
```

Detail ini Part 027.

---

## 36. Design Decision Matrix

| Situation | JPMS Choice | Reason |
|---|---|---|
| Module uses another module internally | `requires` | Implementation dependency |
| Dependency type appears in exported API | `requires transitive` | Consumer also needs readability |
| Compile-time annotation only | `requires static` | Not mandatory at runtime |
| Package is stable public API | `exports` | Consumer can compile against it |
| Package is only for selected module | qualified `exports ... to` | Controlled API exposure |
| Package is internal implementation | no export | Strong encapsulation |
| Framework needs reflection | `opens` | Part 027 |
| Service provider/plugin | `uses` / `provides` | Part 027 |
| Legacy JAR no module-info | automatic module / classpath | Migration bridge |
| Java 8-compatible library wants stable module name | `Automatic-Module-Name` | Migration-friendly |

---

## 37. Practical Heuristics

### 37.1 Default to No Export

Start from:

```java
module com.acme.foo {
}
```

Then add only needed exports.

### 37.2 Export API, Not Implementation

```java
exports com.acme.foo.api;
```

Not:

```java
exports com.acme.foo.internal;
```

### 37.3 Use `requires transitive` Sparingly

Only when public API forces it.

### 37.4 Avoid Split Package Before Modularization

Split package is a migration blocker.

### 37.5 Keep Module Graph Understandable

A module descriptor should tell a story:

```java
module com.acme.caseworkflow {
    requires transitive com.acme.common.types;
    requires com.acme.audit;
    requires com.acme.document;
    requires java.sql;

    exports com.acme.caseworkflow.api;
}
```

Story:

```text
caseworkflow exposes API using common types,
uses audit/document/sql internally,
and exports only its API package.
```

### 37.6 Do Not Modularize Chaos

If package architecture is weak, fix package architecture first.

---

## 38. Mental Model Summary

JPMS introduces module as a first-class program component.

A module:

```text
has a name
contains packages
reads other modules
exports selected packages
hides non-exported packages
participates in a resolved graph
```

Key formula:

```text
To access public type T from module B:
A must read B,
B must export T's package to A,
T must be public,
and the member must be accessible.
```

Most important design insight:

```text
JPMS is not just deployment technology.
It is architecture made visible to compiler and runtime.
```

---

## 39. Common Review Questions for Senior Engineers

When reviewing modular Java code, ask:

1. Does this module name represent ownership or just technology?
2. Are exported packages genuinely stable API?
3. Is any internal package exported only because of convenience?
4. Is `requires transitive` justified by exported API signatures?
5. Are optional compile-time dependencies marked `requires static`?
6. Are there split packages across artifacts?
7. Does package naming reveal domain/capability boundary?
8. Does this module depend on too many modules?
9. Does this module act as a god module?
10. Is this descriptor future-proof for reflection needs via `opens`?
11. Are generated packages intentionally exported or hidden?
12. Does the graph have cycles at conceptual architecture level?
13. Can a new engineer infer architecture from `module-info.java`?
14. Does Maven/Gradle artifact boundary match module boundary?
15. Can the module be tested through public API?

---

## 40. Exercises

### Exercise 1 — Classify Dependency

Given:

```java
public interface CaseWorkflowService {
    CaseId createCase(CreateCaseCommand command);
}
```

`CaseId` and `CreateCaseCommand` are in `com.acme.common.types`.

Question:

```java
requires com.acme.common.types;
```

or:

```java
requires transitive com.acme.common.types;
```

Answer:

Use `requires transitive` if consumer of `CaseWorkflowService` must also read those types through API signatures.

### Exercise 2 — Export or Not

Package:

```text
com.acme.audit.internal.sql
```

Contains:

```java
public final class SqlAuditStore { }
```

Question: should it be exported?

Answer: normally no. Public class in hidden package can remain internal module implementation.

### Exercise 3 — Split Package Fix

Given:

```text
audit-api.jar  -> com.acme.audit.AuditService
audit-impl.jar -> com.acme.audit.DefaultAuditService
```

Fix:

```text
audit-api.jar  -> com.acme.audit.api.AuditService
audit-impl.jar -> com.acme.audit.internal.DefaultAuditService
```

or combine into one module with clear packages.

### Exercise 4 — `requires static`

Given annotation:

```java
@NullMarked
package com.acme.caseworkflow.api;
```

If annotation is compile-time/static-analysis only and not required at runtime, `requires static` may be appropriate.

### Exercise 5 — Descriptor Review

Review:

```java
module com.acme.caseworkflow {
    requires transitive java.sql;
    requires transitive com.fasterxml.jackson.databind;
    requires transitive com.acme.audit;

    exports com.acme.caseworkflow.api;
    exports com.acme.caseworkflow.internal;
}
```

Problems:

- `java.sql` likely implementation detail, not transitive;
- Jackson likely implementation detail;
- audit likely implementation detail unless audit types appear in API;
- internal package exported;
- descriptor leaks too much.

Better:

```java
module com.acme.caseworkflow {
    requires java.sql;
    requires com.fasterxml.jackson.databind;
    requires com.acme.audit;

    exports com.acme.caseworkflow.api;
}
```

If common API types appear in API:

```java
requires transitive com.acme.common.types;
```

---

## 41. References

- Oracle Java SE 25 API, `java.base` module summary: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html
- Oracle Java SE 25 API, `java.lang.module` package: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/module/package-summary.html
- Oracle Java SE 25 API overview: https://docs.oracle.com/en/java/javase/25/docs/api/index.html
- OpenJDK JEP 261, Module System: https://openjdk.org/jeps/261
- Oracle JDK Migration Guide, migrating from JDK 8 to later JDK releases: https://docs.oracle.com/en/java/javase/17/migrate/migrating-jdk-8-later-jdk-releases.html
- dev.java, implied readability with `requires transitive`: https://dev.java/learn/modules/implied-readability/

---

## 42. Closing

Part ini membangun fondasi JPMS tahap pertama:

- module sebagai named boundary;
- `module-info.java` sebagai descriptor arsitektur;
- readability graph dengan `requires`;
- API surface dengan `exports`;
- public API dependency dengan `requires transitive`;
- compile-time optional dependency dengan `requires static`;
- module path vs classpath;
- named/automatic/unnamed module;
- split package problem;
- migration strategy.

Bagian berikutnya akan membahas sisi runtime dan framework-heavy dari JPMS:

```text
Part 027 — JPMS Deep Dive II: Opens, Reflection, Services, Layers, and Runtime Images
```

Di sana kita akan masuk ke:

- `opens`;
- qualified opens;
- open module;
- reflection under JPMS;
- `uses` / `provides`;
- `ServiceLoader`;
- `ModuleLayer`;
- plugin architecture;
- `jlink` runtime image;
- testing modular applications;
- framework compatibility.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-025.md">⬅️ Package Architecture: Naming, Visibility, Boundaries, and Internal APIs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-027.md">JPMS Deep Dive II: Opens, Reflection, Services, Layers, and Runtime Images ➡️</a>
</div>
