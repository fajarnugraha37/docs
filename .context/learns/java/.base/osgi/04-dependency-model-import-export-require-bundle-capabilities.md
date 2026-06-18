# Part 4 — Dependency Model: Import-Package, Export-Package, Require-Bundle, Capabilities

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `04-dependency-model-import-export-require-bundle-capabilities.md`  
Target Java: 8 sampai 25  
Level: Advanced / platform engineering

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas class loading OSGi: setiap bundle hidup dalam ruang visibilitas sendiri, class identity dipengaruhi classloader, dan runtime tidak memakai model classpath tunggal. Di part ini kita masuk ke inti kontrak dependency OSGi.

Tujuan utama part ini adalah membuat kamu paham bahwa dependency di OSGi bukan sekadar “JAR A butuh JAR B”. Dependency di OSGi adalah **kontrak runtime** yang menentukan:

1. package mana yang boleh dilihat bundle,
2. package mana yang sengaja diekspos sebagai API,
3. versi API mana yang dianggap kompatibel,
4. provider mana yang boleh dipilih resolver,
5. capability non-code apa yang harus tersedia,
6. apakah coupling diarahkan ke package, bundle, service, extender, execution environment, atau runtime feature.

Kalau mental model ini tidak kuat, OSGi akan terasa seperti kumpulan error manifest. Kalau mental model ini kuat, manifest menjadi **architecture boundary** yang bisa direview, diuji, dan di-evolve.

---

## 1. Problem Besar yang Diselesaikan Dependency Model OSGi

Dalam aplikasi Java tradisional, dependency biasanya dipahami sebagai artifact dependency:

```text
application.jar
 ├── jackson-databind.jar
 ├── jackson-core.jar
 ├── slf4j-api.jar
 └── oracle-jdbc.jar
```

Build tool seperti Maven/Gradle menyelesaikan dependency saat build. Runtime JVM lalu melihat semuanya di classpath atau module path.

Masalahnya, classpath memiliki beberapa kelemahan arsitektural:

1. **Visibility terlalu luas**  
   Semua class yang ada di classpath secara praktis dapat dilihat oleh semua kode.

2. **Tidak ada boundary eksplisit**  
   Public class di JAR bukan berarti public API, tapi classpath tidak tahu bedanya.

3. **Versi sering flatten**  
   Dalam banyak model classpath, satu versi dependency menang, versi lain kalah.

4. **Transitive dependency bocor**  
   Library implementation bisa tidak sengaja menjadi API karena consumer dapat meng-import class internal dependency.

5. **Runtime tidak tahu maksud desain**  
   Apakah dependency itu API? SPI? optional? implementation detail? hanya build tool yang tahu sebagian, JVM runtime tidak tahu.

OSGi mencoba menyelesaikan ini dengan membuat dependency menjadi eksplisit di metadata bundle:

```text
Bundle A says:
- I export package x.y.api version 1.4.0.
- I import package org.slf4j version [1.7,2).
- I require a capability osgi.extender=osgi.component.
- I do not expose my internal implementation packages.
```

Artinya, OSGi bukan hanya dependency mechanism. Ia adalah **runtime contract system**.

---

## 2. Mental Model: Dependency di OSGi Ada di Beberapa Level

OSGi dependency tidak satu dimensi. Ada beberapa level dependency, masing-masing menjawab pertanyaan berbeda.

| Level | Mekanisme | Pertanyaan yang Dijawab |
|---|---|---|
| Package dependency | `Import-Package`, `Export-Package` | Class/package apa yang terlihat? |
| Bundle dependency | `Require-Bundle` | Bundle spesifik apa yang harus ada? |
| Capability dependency | `Provide-Capability`, `Require-Capability` | Kemampuan/runtime feature apa yang dibutuhkan? |
| Host/fragment dependency | `Fragment-Host` | Fragment menempel ke bundle host mana? |
| Execution environment | `osgi.ee` capability atau legacy BREE | Java runtime level apa yang dibutuhkan? |
| Service dependency | OSGi Service Registry / DS `@Reference` | Object service apa yang tersedia saat runtime? |
| Extender dependency | `osgi.extender` capability | Runtime processor apa yang harus memproses bundle ini? |
| Native dependency | `Bundle-NativeCode` | Native library platform apa yang dibutuhkan? |

Kesalahan umum engineer baru di OSGi adalah menyamakan semua dependency dengan `Import-Package` atau `Require-Bundle`. Padahal dependency model OSGi lebih kaya.

Contoh:

- Kalau kamu butuh interface Java dari package tertentu, gunakan `Import-Package`.
- Kalau kamu butuh service object runtime, gunakan Service Registry atau Declarative Services reference.
- Kalau bundle kamu butuh Declarative Services runtime, gunakan `Require-Capability: osgi.extender; filter:="(osgi.extender=osgi.component)"`.
- Kalau kamu butuh Java 17 runtime, itu execution environment capability.
- Kalau kamu butuh bundle spesifik karena resource atau extension registry tertentu, mungkin `Require-Bundle` masuk akal, tapi harus hati-hati.

---

## 3. Core Principle: Depend on Packages, Not JARs

OSGi mendorong dependency pada **package**, bukan artifact.

Di Maven/Gradle, dependency biasanya seperti ini:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.2</version>
</dependency>
```

Di OSGi runtime, pertanyaan yang lebih penting adalah:

```text
Bundle ini sebenarnya memakai package apa?
- com.fasterxml.jackson.databind
- com.fasterxml.jackson.core
- com.fasterxml.jackson.annotation
```

OSGi akan mengekspresikannya di manifest:

```text
Import-Package: 
 com.fasterxml.jackson.databind;version="[2.17,3)",
 com.fasterxml.jackson.core;version="[2.17,3)",
 com.fasterxml.jackson.annotation;version="[2.17,3)"
```

Kenapa package-level dependency lebih kuat?

Karena artifact bukan boundary API yang akurat. Satu JAR bisa berisi:

- API package,
- implementation package,
- internal package,
- shaded package,
- optional integration package,
- legacy compatibility package.

Kalau dependency diarahkan ke JAR, consumer terikat ke seluruh bundle. Kalau diarahkan ke package, consumer hanya terikat ke package yang benar-benar digunakan.

Mental model:

```text
Classpath/Maven thinking:
  I need artifact X.

OSGi thinking:
  I need package P with version range R, and I do not care which bundle provides it,
  as long as the provider satisfies the contract.
```

Ini adalah dasar fleksibilitas OSGi.

---

## 4. `Export-Package`: Menyatakan API yang Disediakan Bundle

`Export-Package` berarti bundle menyediakan package tertentu untuk dipakai bundle lain.

Contoh:

```text
Bundle-SymbolicName: com.acme.case.api
Bundle-Version: 1.5.0
Export-Package: 
 com.acme.case.api;version="1.5.0",
 com.acme.case.api.events;version="1.2.0"
```

Artinya:

- package `com.acme.case.api` tersedia untuk bundle lain,
- versi package-nya `1.5.0`,
- package `com.acme.case.api.events` tersedia dengan versi `1.2.0`,
- package lain di bundle ini tidak otomatis terlihat.

### 4.1 Export Bukan Sekadar `public`

Dalam Java biasa, class `public` dapat diakses selama ada di classpath. Di OSGi, `public` saja tidak cukup. Class harus berada di package yang diekspor.

```java
package com.acme.case.internal;

public class InternalCaseNormalizer {
}
```

Walaupun class ini `public`, bundle lain tidak bisa menggunakannya jika package `com.acme.case.internal` tidak diekspor.

Inilah kekuatan OSGi: **Java visibility + module visibility**.

```text
public class + exported package       => visible to other bundles
public class + non-exported package   => visible only inside bundle wiring
package-private class                 => Java-level private within package
```

### 4.2 Export adalah Janji Jangka Panjang

Package yang diekspor harus dianggap sebagai API contract.

Begitu kamu export package, kamu mengatakan:

```text
Bundle lain boleh compile dan runtime terhadap package ini.
Perubahan pada package ini harus mengikuti compatibility discipline.
```

Karena itu, jangan export package hanya karena “dibutuhkan sekarang”. Export harus melewati pertanyaan arsitektur:

1. Apakah package ini memang API publik modul?
2. Apakah class di dalamnya stabil?
3. Apakah exception model-nya sudah benar?
4. Apakah DTO-nya tidak membawa implementation detail?
5. Apakah package ini punya versi yang benar?
6. Apakah kita siap menjaga backward compatibility?

### 4.3 API Package vs SPI Package

Sering kali kamu perlu memisahkan API dan SPI.

Contoh:

```text
com.acme.notification.api
com.acme.notification.spi
com.acme.notification.internal
```

Maknanya:

- `api`: digunakan caller biasa.
- `spi`: digunakan plugin/provider yang ingin memperluas platform.
- `internal`: implementation detail.

Manifest:

```text
Export-Package: 
 com.acme.notification.api;version="2.1.0",
 com.acme.notification.spi;version="1.3.0"
Private-Package:
 com.acme.notification.internal.*
```

SPI biasanya lebih sensitif daripada API karena provider harus mengimplementasikan contract. Perubahan kecil bisa mematahkan plugin provider.

### 4.4 Export Implementation Package adalah Anti-Pattern

Contoh buruk:

```text
Export-Package: 
 com.acme.case.api,
 com.acme.case.internal,
 com.acme.case.internal.repository,
 com.acme.case.internal.mapper
```

Konsekuensinya:

- bundle lain mulai bergantung pada internal class,
- refactoring menjadi breaking change,
- resolver graph menjadi rapuh,
- split responsibility sulit dikendalikan,
- bug muncul saat bundle update karena consumer memakai detail yang tidak dijamin.

Rule of thumb:

```text
Export package only if you are willing to version it, document it, test it, and support it.
```

---

## 5. `Import-Package`: Menyatakan Package yang Dibutuhkan Bundle

`Import-Package` menyatakan package eksternal yang dibutuhkan bundle.

Contoh:

```text
Import-Package: 
 org.slf4j;version="[1.7,2)",
 com.acme.case.api;version="[1.5,2)",
 com.fasterxml.jackson.databind;version="[2.15,3)"
```

Maknanya:

- bundle ini butuh `org.slf4j` kompatibel dari `1.7.x` sampai sebelum `2.0.0`,
- bundle ini butuh `com.acme.case.api` minimal `1.5.0` dan sebelum `2.0.0`,
- provider package bisa berasal dari bundle mana pun, selama memenuhi constraint.

### 5.1 Import adalah Runtime Requirement

Kalau package mandatory import tidak bisa dipenuhi, bundle tidak akan resolve.

```text
Bundle state: INSTALLED
Reason: missing requirement osgi.wiring.package=com.acme.case.api
```

Ini berbeda dari classpath tradisional, di mana aplikasi mungkin start lalu gagal nanti saat class dipakai.

OSGi memindahkan banyak kegagalan dependency ke fase resolve.

### 5.2 Import Tidak Selalu Sama dengan Compile Dependency

Build tool dependency digunakan agar kode bisa dikompilasi. OSGi import digunakan agar runtime bisa resolve.

Hubungannya:

```text
Compile dependency gives classes to compiler.
Import-Package tells OSGi runtime where classes must come from.
```

bnd biasanya menganalisis bytecode untuk menghasilkan import package otomatis. Jika kode memakai `org.slf4j.Logger`, bnd akan menambahkan `org.slf4j` ke `Import-Package`.

Tetapi ada dependency yang tidak terlihat dari bytecode langsung:

- reflection,
- `Class.forName`,
- `ServiceLoader`,
- XML config,
- annotation processor runtime,
- serializer/deserializer,
- scripting,
- JDBC driver discovery,
- optional integration.

Dependency seperti itu sering perlu import manual atau desain adapter.

### 5.3 Version Range adalah Bagian dari Contract

Contoh:

```text
Import-Package: com.acme.case.api;version="[1.5,2)"
```

Makna:

- minimum: `1.5.0` inclusive,
- maximum: `2.0.0` exclusive.

Jika provider export:

```text
Export-Package: com.acme.case.api;version="1.6.3"
```

maka cocok.

Jika provider export:

```text
Export-Package: com.acme.case.api;version="2.0.0"
```

maka tidak cocok, karena major version 2 diasumsikan breaking.

### 5.4 Import Range Terlalu Lebar

Contoh buruk:

```text
Import-Package: com.acme.case.api;version="[1.0,999)"
```

Atau lebih buruk:

```text
Import-Package: com.acme.case.api
```

Konsekuensi:

- bundle bisa resolve dengan API yang tidak kompatibel,
- error muncul sebagai runtime method/class failure,
- resolver tampak berhasil padahal sistem salah.

### 5.5 Import Range Terlalu Sempit

Contoh:

```text
Import-Package: com.acme.case.api;version="[1.5.2,1.5.3)"
```

Konsekuensi:

- patch/minor upgrade sulit,
- bundle sering gagal resolve tanpa alasan arsitektural,
- operational rollout menjadi fragile.

Rule umum untuk consumer API stabil:

```text
Import range: [major.minor, next-major)
```

Contoh:

```text
[1.5,2)
```

Untuk provider yang sangat sensitif terhadap minor changes, bisa lebih ketat:

```text
[1.5,1.6)
```

Tapi harus ada alasan nyata.

---

## 6. `Private-Package`: Menyatakan Isi Bundle yang Tidak Diekspos

`Private-Package` bukan header runtime OSGi Core yang diinterpretasikan framework sebagai dependency constraint. Dalam konteks bnd, `Private-Package` adalah instruksi build untuk memasukkan package ke dalam bundle tanpa mengekspornya.

Contoh bnd:

```text
Bundle-SymbolicName: com.acme.case.impl
Private-Package: 
 com.acme.case.internal.*,
 com.acme.case.mapper.*
Import-Package: *
```

Maknanya:

- package internal dimasukkan ke output bundle,
- package tersebut tidak diekspor,
- bundle lain tidak dapat mengimpor package itu.

Mental model:

```text
Export-Package  = put package inside bundle and expose it.
Private-Package = put package inside bundle but hide it.
Import-Package  = use package from another bundle.
```

### 6.1 Private Package Bukan “Java Private”

Private package tidak mengubah modifier Java. Ia mengubah visibility di level OSGi wiring.

Class `public` dalam private package tetap public untuk class di bundle yang sama, tetapi tidak tersedia sebagai exported package untuk bundle lain.

### 6.2 Private Package dan Embedded Dependency

Misalnya kamu membuat bundle implementation yang membawa library kecil internal:

```text
Private-Package: 
 com.acme.case.internal.*,
 org.some.small.lib.*
```

Ini membuat `org.some.small.lib` menjadi private copy dalam bundle.

Keuntungan:

- dependency tidak bocor,
- versi library bisa dikontrol per bundle,
- tidak memaksa runtime menyediakan library tersebut.

Risiko:

- duplicate class di banyak bundle,
- memory lebih besar,
- bug/security patch harus diterapkan ke semua copy,
- type dari private copy tidak boleh bocor ke API.

Rule penting:

```text
Never expose a type from a private embedded package in an exported API or service contract.
```

Contoh buruk:

```java
package com.acme.case.api;

import org.some.small.lib.Result;

public interface CaseValidator {
    Result validate(CaseDraft draft);
}
```

Jika `org.some.small.lib` adalah private embedded package, consumer tidak punya class identity yang sama. Ini rawan `ClassCastException`, resolver issue, atau impossible-to-use API.

---

## 7. `Require-Bundle`: Dependency ke Bundle Spesifik

`Require-Bundle` membuat bundle bergantung pada bundle lain secara eksplisit.

Contoh:

```text
Require-Bundle: com.acme.case.api;bundle-version="[1.5,2)"
```

Ini berbeda dari `Import-Package`.

```text
Import-Package:
  I need package com.acme.case.api from any provider that satisfies version.

Require-Bundle:
  I need bundle com.acme.case.api specifically.
```

### 7.1 Kenapa `Require-Bundle` Sering Dianggap Lebih Coupled

Dengan `Require-Bundle`, consumer terikat ke identity bundle, bukan hanya package contract.

Dampaknya:

- provider tidak mudah diganti,
- bundle refactoring lebih sulit,
- consumer dapat melihat export dari required bundle secara lebih luas,
- transitive visibility dengan `visibility:=reexport` bisa membuat dependency graph kabur,
- sulit menghindari accidental coupling.

Contoh:

```text
Require-Bundle: com.acme.platform.core
```

Bundle consumer mungkin awalnya hanya butuh `com.acme.platform.api`, tapi karena require bundle, ia melekat ke seluruh bundle `core`.

### 7.2 Kapan `Require-Bundle` Masuk Akal

Walaupun sering tidak disarankan sebagai default, `Require-Bundle` punya use case valid:

1. **Eclipse/Equinox plugin ecosystem**  
   Banyak plugin Eclipse historis memakai `Require-Bundle` karena extension registry dan plugin model.

2. **Bundle adalah unit semantik yang tidak bisa dipisahkan**  
   Misalnya bundle host menyediakan resource, extension point, atau non-package contract tertentu.

3. **Re-export API aggregate**  
   Bundle facade ingin mengekspos beberapa bundle API sebagai satu unit migrasi.

4. **Legacy compatibility**  
   Sistem lama sudah dibangun dengan require-bundle dan migrasi langsung terlalu mahal.

5. **Fragment/host-adjacent model**  
   Ada kasus runtime tertentu yang lebih natural dengan bundle identity.

Namun untuk service-oriented OSGi modern, default yang lebih sehat biasanya:

```text
Prefer Import-Package over Require-Bundle.
```

### 7.3 `visibility:=reexport`

`Require-Bundle` dapat memakai directive `visibility:=reexport`.

Contoh:

```text
Require-Bundle: 
 com.acme.case.api;visibility:=reexport,
 com.acme.document.api;visibility:=reexport
```

Maknanya, bundle yang membutuhkan bundle ini juga bisa melihat export dari required bundle yang di-reexport.

Ini bisa berguna untuk facade/aggregate bundle, tetapi bisa berbahaya karena dependency menjadi tidak eksplisit pada consumer.

Anti-pattern:

```text
Bundle A requires Bundle B.
Bundle B reexports Bundle C.
A memakai package dari C tanpa menyatakan dependency langsung.
```

Konsekuensinya:

- dependency tersembunyi,
- refactoring B mematahkan A,
- graph sulit dibaca,
- resolver error membingungkan.

Gunakan reexport hanya untuk desain API aggregate yang disengaja dan terdokumentasi.

---

## 8. `Import-Package` vs `Require-Bundle`: Decision Framework

Gunakan framework berikut.

### 8.1 Pilih `Import-Package` Jika...

Gunakan `Import-Package` jika:

- yang kamu butuhkan adalah Java type di package tertentu,
- provider bundle boleh diganti,
- kamu ingin loose coupling,
- kamu ingin package versioning yang presisi,
- kamu ingin beberapa versi package bisa coexist,
- kamu ingin dependency graph eksplisit di level API.

Contoh:

```text
Import-Package: 
 com.acme.case.api;version="[1.5,2)",
 org.slf4j;version="[1.7,3)"
```

### 8.2 Pilih `Require-Bundle` Jika...

Gunakan `Require-Bundle` jika:

- kamu memang butuh bundle identity spesifik,
- kamu bekerja di ecosystem yang convention-nya bundle-centric,
- kamu butuh resource/extension yang melekat ke bundle tersebut,
- kamu membuat compatibility facade,
- kamu sedang menjaga legacy plugin architecture.

Contoh:

```text
Require-Bundle: org.eclipse.core.runtime;bundle-version="[3.20,4)"
```

### 8.3 Jangan Pilih `Require-Bundle` Karena...

Jangan pilih `Require-Bundle` hanya karena:

- lebih mudah ditulis,
- import package list terlalu panjang,
- tidak paham package mana yang dipakai,
- ingin “semua class dari bundle X kelihatan”,
- ingin cepat menghilangkan resolver error.

Itu biasanya memperbesar utang arsitektur.

---

## 9. `Provide-Capability` dan `Require-Capability`: Dependency yang Lebih Umum dari Package

OSGi modern menggunakan generic requirement/capability model. Package import/export sebenarnya dapat dipahami sebagai salah satu jenis capability/requirement pada namespace package.

`Provide-Capability` menyatakan bundle menyediakan kemampuan tertentu.

`Require-Capability` menyatakan bundle membutuhkan kemampuan tertentu.

Contoh sederhana:

```text
Provide-Capability: 
 com.acme.feature;name="case-management";version:Version="1.0.0"
```

Bundle lain bisa mensyaratkan:

```text
Require-Capability: 
 com.acme.feature;filter:="(&(name=case-management)(version>=1.0.0))"
```

### 9.1 Kenapa Capability Dibutuhkan?

Tidak semua dependency adalah package.

Contoh dependency non-package:

- “runtime ini harus punya Declarative Services extender”,
- “bundle ini butuh HTTP Whiteboard runtime”,
- “bundle ini butuh JavaSE 17”,
- “bundle ini menyediakan persistence provider”,
- “bundle ini menyediakan custom platform feature”,
- “bundle ini butuh vendor-specific capability”,
- “bundle ini adalah plugin tipe tertentu”.

Kalau dipaksa menjadi package import, dependency menjadi tidak akurat.

Capability membuat dependency menjadi semantik.

### 9.2 Namespace Capability Umum

Beberapa namespace penting:

| Namespace | Fungsi |
|---|---|
| `osgi.wiring.package` | Package import/export wiring |
| `osgi.wiring.bundle` | Bundle wiring |
| `osgi.wiring.host` | Fragment-host wiring |
| `osgi.ee` | Execution environment |
| `osgi.extender` | Extender runtime, misalnya DS atau Blueprint |
| `osgi.service` | Service capability metadata |
| Custom namespace | Domain/platform-specific capability |

### 9.3 Extender Capability

Declarative Services berjalan sebagai extender. Bundle yang punya component description butuh DS runtime.

Contoh konseptual:

```text
Require-Capability: 
 osgi.extender;
 filter:="(&(osgi.extender=osgi.component)(version>=1.5.0)(!(version>=2.0.0)))"
```

Maknanya:

```text
Bundle ini tidak cukup hanya punya class.
Bundle ini butuh runtime extender yang bisa memproses Declarative Services component.
```

Tanpa capability ini, bundle mungkin resolve tetapi component tidak pernah aktif karena extender tidak tersedia. Dengan requirement yang benar, masalah bisa tertangkap saat resolution.

### 9.4 Execution Environment Capability

Untuk Java 8–25, bundle harus jelas runtime Java minimum-nya.

Model lama memakai:

```text
Bundle-RequiredExecutionEnvironment: JavaSE-1.8
```

Model capability modern memakai `osgi.ee` requirement.

Contoh konseptual:

```text
Require-Capability: 
 osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

Artinya, bundle membutuhkan JavaSE 17 environment.

Dalam praktik, bnd/tooling sering menghasilkan metadata ini berdasarkan target bytecode atau konfigurasi.

### 9.5 Custom Capability untuk Platform

Misalnya kamu membangun platform enforcement lifecycle. Kamu bisa menyatakan capability plugin:

```text
Provide-Capability: 
 com.acme.enforcement.plugin;
 type="escalation-rule";
 domain="licensing";
 version:Version="1.0.0"
```

Runtime atau plugin manager bisa require:

```text
Require-Capability: 
 com.acme.enforcement.plugin;
 filter:="(&(type=escalation-rule)(domain=licensing))";
 resolution:=optional
```

Ini membuat metadata plugin dapat di-resolve dan diinspeksi bukan hanya dipahami oleh kode custom.

---

## 10. Mandatory vs Optional Dependency

OSGi mendukung dependency mandatory dan optional.

### 10.1 Mandatory Import

Default `Import-Package` adalah mandatory.

```text
Import-Package: com.acme.case.api;version="[1.5,2)"
```

Jika tidak ada provider yang cocok, bundle tidak resolve.

Gunakan mandatory jika bundle memang tidak bisa berfungsi tanpa package itu.

### 10.2 Optional Import

Contoh:

```text
Import-Package: 
 com.acme.audit.api;version="[1.0,2)";resolution:=optional
```

Maknanya:

- jika package tersedia saat resolve, bundle bisa wire ke provider,
- jika tidak tersedia, bundle tetap bisa resolve,
- tetapi class dari package itu tidak boleh dipakai sembarangan tanpa guard.

### 10.3 Risiko Optional Import

Optional import sering disalahgunakan untuk “menghilangkan resolver error”. Itu berbahaya.

Contoh buruk:

```text
Import-Package: *;resolution:=optional
```

Konsekuensi:

- bundle resolve walaupun dependency penting hilang,
- error pindah ke runtime path tertentu,
- test environment bisa lolos, production gagal,
- class loading failure menjadi nondeterministic.

Optional import benar jika:

1. kode memang memiliki jalur tanpa dependency tersebut,
2. penggunaan class diisolasi,
3. fitur bisa didisable/degrade,
4. ada test untuk dependency available dan unavailable,
5. failure mode eksplisit.

### 10.4 Pattern Optional Integration

Misalnya bundle notifikasi dapat terintegrasi dengan audit jika audit tersedia.

Desain buruk:

```java
public class NotificationService {
    private AuditClient auditClient; // type dari optional package
}
```

Desain lebih baik di OSGi:

```java
@Component
public class NotificationService {
    @Reference(cardinality = ReferenceCardinality.OPTIONAL)
    volatile AuditPublisher auditPublisher;
}
```

Dengan service reference optional, dependency runtime lebih natural dibanding optional package import.

Rule:

```text
If the optional thing is behavior, prefer optional service.
If the optional thing is type availability for integration glue, optional package can be acceptable.
```

---

## 11. Version Range Reasoning

Version range adalah salah satu area yang membedakan OSGi engineer matang dan pemula.

### 11.1 Bentuk Range

| Range | Makna |
|---|---|
| `[1.2,2)` | >= 1.2.0 dan < 2.0.0 |
| `[1.2,1.3)` | >= 1.2.0 dan < 1.3.0 |
| `[1.2,1.2.5]` | >= 1.2.0 dan <= 1.2.5 |
| `(1.2,2)` | > 1.2.0 dan < 2.0.0 |
| `1.2` | Biasanya interpreted sebagai minimum version dalam banyak header context; jangan bergantung tanpa eksplisit range |

Gunakan range eksplisit.

### 11.2 Consumer Policy

Jika bundle consumer dikompilasi terhadap API `1.5.0`, dan API mengikuti semantic versioning OSGi, consumer biasanya bisa menerima versi minor/micro lebih baru selama major tetap sama.

```text
Import-Package: com.acme.case.api;version="[1.5,2)"
```

### 11.3 Provider Policy

Provider harus export package dengan versi yang sesuai perubahan API.

Contoh:

- bugfix internal tanpa API change: `1.5.1`
- menambah method default kompatibel: tergantung contract, bisa minor
- menambah method abstract ke interface: breaking untuk implementor, biasanya major untuk SPI
- menghapus method: major
- mengubah signature: major

Versi package harus mengikuti **package API**, bukan versi bundle release.

### 11.4 Bundle Version Tidak Sama dengan Package Version

Bundle version:

```text
Bundle-Version: 2.8.3
```

Package version:

```text
Export-Package: 
 com.acme.case.api;version="1.5.0",
 com.acme.case.spi;version="2.1.0"
```

Satu bundle bisa export beberapa package dengan lifecycle versi berbeda.

Kesalahan umum:

```text
Semua exported package otomatis diberi version sama dengan Bundle-Version.
```

Ini sering terlalu kasar. Bisa diterima untuk sistem sederhana, tapi untuk platform besar, package version sebaiknya mencerminkan contract package.

---

## 12. Dependency Substitution: Provider Bisa Diganti

Dengan `Import-Package`, consumer tidak peduli bundle mana yang menyediakan package.

Misalnya:

```text
Consumer imports:
 com.acme.notification.api;version="[1.2,2)"
```

Provider A:

```text
Bundle-SymbolicName: com.acme.notification.api
Export-Package: com.acme.notification.api;version="1.3.0"
```

Provider B:

```text
Bundle-SymbolicName: com.partner.notification.compat
Export-Package: com.acme.notification.api;version="1.3.0"
```

Resolver dapat memilih provider yang memenuhi constraint.

Ini memberi fleksibilitas:

- kompatibilitas provider alternatif,
- test doubles,
- patched API bundle,
- vendor-specific provider,
- migration bridge.

Tetapi juga membawa risiko:

- provider tak terduga dipilih,
- duplicate export version sama,
- resolver result berbeda antar runtime,
- operational surprise.

Karena itu repository/provisioning harus deterministic.

Rule:

```text
Loose coupling does not mean uncontrolled provider set.
Use repository curation and resolver tests.
```

---

## 13. Split Package: Salah Satu Sumber Masalah Terbesar

Split package terjadi saat package yang sama tersebar di lebih dari satu bundle atau lebih dari satu source dalam bundle classpath.

Contoh buruk:

```text
Bundle A exports com.acme.common
Bundle B exports com.acme.common
```

Atau:

```text
Bundle C contains com.acme.common from source code
Bundle C also embeds library containing com.acme.common
```

### 13.1 Kenapa Split Package Buruk?

Karena package dalam Java secara semantik seharusnya kohesif. Dalam OSGi, package adalah unit import/export. Jika package terpecah:

- class A dari package yang sama bisa berasal dari provider berbeda,
- package-private access rusak,
- resolver tidak bisa mencampur satu package import dari dua provider,
- `uses:=` constraint mudah gagal,
- refactoring sulit,
- debugging membingungkan.

### 13.2 Contoh Failure

Bundle consumer butuh:

```java
import com.acme.common.CaseId;
import com.acme.common.CaseStatus;
```

Tetapi runtime punya:

```text
Bundle common-core exports com.acme.common containing CaseId
Bundle common-status exports com.acme.common containing CaseStatus
```

Consumer tidak bisa wire satu package ke dua bundle. Ia harus memilih satu exporter untuk `com.acme.common`.

Akibatnya salah satu class tidak ditemukan.

### 13.3 Solusi

Solusi yang benar:

```text
com.acme.common.identity.CaseId
com.acme.common.status.CaseStatus
```

atau satukan package dalam satu API bundle:

```text
Bundle-SymbolicName: com.acme.common.api
Export-Package: com.acme.common;version="1.0.0"
```

Rule:

```text
One package, one owner, one versioning policy.
```

---

## 14. `uses:=` Directive dan Type Consistency

`uses:=` directive pada export package menyatakan bahwa package yang diekspor memakai type dari package lain dalam API surface-nya.

Contoh:

```java
package com.acme.case.api;

import com.acme.identity.api.UserId;

public interface CaseService {
    Case findCase(UserId userId, String caseNo);
}
```

Manifest export bisa berisi:

```text
Export-Package: 
 com.acme.case.api;
 version="1.5.0";
 uses:="com.acme.identity.api"
```

Maknanya:

```text
Consumer yang memakai com.acme.case.api harus melihat com.acme.identity.api yang konsisten dengan provider com.acme.case.api.
```

### 14.1 Kenapa Ini Penting?

Tanpa konsistensi, bisa terjadi:

```text
Case API provider compiled against UserId from identity-api v1.
Consumer imports Case API from provider A.
Consumer imports UserId from identity-api v2.
```

Jika `UserId` class identity berbeda, method signature terlihat sama secara nama tetapi bukan class yang sama di runtime.

Efeknya:

- `ClassCastException`,
- `NoSuchMethodError`,
- resolver failure,
- atau behavior aneh.

`uses:=` membantu resolver mencegah wiring tidak konsisten.

### 14.2 `uses:=` Bukan Hiasan

bnd biasanya dapat menghitung `uses:=` dari bytecode. Jangan sembarangan menghapusnya untuk “memperbaiki” resolver error.

Jika ada `uses constraint violation`, itu biasanya sinyal desain dependency graph tidak konsisten, bukan sekadar tool cerewet.

Common root cause:

- duplicate API packages,
- provider export package versi konflik,
- embedding API package di implementation bundle,
- import range terlalu lebar,
- require-bundle reexport membingungkan,
- split package,
- javax/jakarta mixed dependencies.

---

## 15. Service Dependency vs Package Dependency

Salah satu mental model terpenting:

```text
Import-Package resolves types.
Service Registry resolves objects/behavior.
```

Jika bundle A memanggil interface `PaymentGateway`, ia butuh package interface itu.

```text
Import-Package: com.acme.payment.api;version="[1.0,2)"
```

Tetapi implementasi gateway tidak perlu di-import sebagai package. Ia ditemukan via service registry.

```java
@Component
public class CheckoutService {
    @Reference
    PaymentGateway paymentGateway;
}
```

Runtime menyediakan service:

```java
@Component(service = PaymentGateway.class)
public class StripePaymentGateway implements PaymentGateway {
}
```

### 15.1 Kenapa Ini Penting?

Kalau kamu import implementation package:

```text
Import-Package: com.acme.payment.stripe.internal
```

maka kamu menghancurkan modularity.

Desain sehat:

```text
Consumer imports API package.
Provider imports API package and registers service implementation.
Consumer references service interface.
```

Diagram:

```text
[checkout.impl]
   imports com.acme.payment.api
   references PaymentGateway service
          |
          v
[service registry]
          ^
          |
[payment.stripe.impl]
   imports com.acme.payment.api
   registers PaymentGateway service
```

Package dependency stabil. Service provider bisa dinamis.

### 15.2 Interface Bundle Pattern

Umumnya API/service interface dipisah:

```text
com.acme.payment.api bundle
  Export-Package: com.acme.payment.api

com.acme.checkout.impl bundle
  Import-Package: com.acme.payment.api
  DS reference PaymentGateway

com.acme.payment.stripe.impl bundle
  Import-Package: com.acme.payment.api
  DS component provides PaymentGateway
```

Keuntungan:

- consumer tidak tergantung provider,
- provider bisa diganti,
- test provider mudah,
- API versioning jelas,
- service dynamics natural.

---

## 16. Dependency Direction dan Modular Architecture

OSGi membuat dependency direction terlihat jelas.

Contoh domain:

```text
case.api
case.impl
appeal.api
appeal.impl
notification.api
notification.email.impl
notification.sms.impl
```

Desain sehat:

```text
case.impl imports case.api
appeal.impl imports appeal.api
case.impl imports notification.api
notification.email.impl imports notification.api
```

Desain buruk:

```text
case.api imports case.impl
appeal.impl imports case.impl.internal
notification.api imports notification.email.impl
```

Aturan dependency:

1. API tidak boleh depend pada implementation.
2. Implementation boleh depend pada API.
3. Cross-domain dependency sebaiknya lewat API atau service, bukan internal package.
4. Plugin depend pada SPI/API, bukan host internals.
5. Host tidak compile-depend pada plugin implementation.

### 16.1 Layering dengan Package

Contoh:

```text
com.acme.case.api
com.acme.case.spi
com.acme.case.impl
com.acme.case.impl.persistence
com.acme.case.impl.workflow
```

Manifest:

```text
Export-Package: 
 com.acme.case.api;version="1.0.0",
 com.acme.case.spi;version="1.0.0"
Private-Package: 
 com.acme.case.impl.*
```

### 16.2 Dependency Direction Review

Saat review bundle, tanya:

1. Package apa yang diexport?
2. Apakah semua export memang API/SPI?
3. Package apa yang diimport?
4. Apakah import mengarah ke internal package bundle lain?
5. Apakah ada `Require-Bundle` yang bisa diganti `Import-Package`?
6. Apakah optional dependency benar-benar optional?
7. Apakah service boundary sudah dipakai untuk behavior dinamis?
8. Apakah ada split package?
9. Apakah import range terlalu longgar/sempit?
10. Apakah capability requirement menangkap runtime feature yang dibutuhkan?

---

## 17. Dependency Graph Hygiene

Dependency graph OSGi yang sehat biasanya memiliki ciri:

```text
- API bundle kecil dan stabil.
- Implementation bundle tidak diexport kecuali perlu.
- Import package punya version range eksplisit.
- Tidak ada DynamicImport kecuali alasan khusus.
- Require-Bundle jarang dan terdokumentasi.
- Service dependency digunakan untuk behavior provider.
- Capability digunakan untuk runtime feature.
- Tidak ada split package.
- Tidak ada duplicate API export tidak terkendali.
- Resolver test memastikan graph konsisten.
```

Dependency graph yang buruk biasanya terlihat seperti:

```text
- Semua bundle export semua package.
- Semua import optional.
- Banyak Require-Bundle ke platform.core.
- API dan impl bercampur.
- Common package tersebar di banyak bundle.
- Embedded dependencies bocor ke API.
- Tidak ada version range.
- Runtime hanya bisa jalan karena start order kebetulan.
```

---

## 18. Case Study 1: Notification Channel Plugin

### 18.1 Requirement

Sistem punya platform notification. Channel bisa ditambah:

- email,
- SMS,
- WhatsApp,
- in-app,
- agency-specific channel.

Channel bisa diinstall/uninstall tanpa rebuild platform.

### 18.2 Bundle Design

```text
com.acme.notification.api
com.acme.notification.core
com.acme.notification.email
com.acme.notification.sms
com.acme.notification.whatsapp
```

### 18.3 API Bundle

```text
Bundle-SymbolicName: com.acme.notification.api
Bundle-Version: 1.4.0
Export-Package:
 com.acme.notification.api;version="1.4.0",
 com.acme.notification.spi;version="1.2.0"
```

API:

```java
package com.acme.notification.spi;

public interface NotificationChannel {
    String channelType();
    DeliveryResult deliver(NotificationRequest request);
}
```

### 18.4 Core Bundle

```text
Bundle-SymbolicName: com.acme.notification.core
Import-Package:
 com.acme.notification.api;version="[1.4,2)",
 com.acme.notification.spi;version="[1.2,2)",
 org.osgi.service.component.annotations;version="[1.4,2)"
Require-Capability:
 osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.4.0))"
```

Core references channel services:

```java
@Component
public class NotificationRouter {
    @Reference(
        service = NotificationChannel.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    volatile List<NotificationChannel> channels;
}
```

### 18.5 Email Channel Bundle

```text
Bundle-SymbolicName: com.acme.notification.email
Import-Package:
 com.acme.notification.spi;version="[1.2,2)",
 org.osgi.service.component.annotations;version="[1.4,2)",
 jakarta.mail;version="[2.0,3)"
Require-Capability:
 osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.4.0))"
```

Email channel registers service:

```java
@Component(service = NotificationChannel.class)
public class EmailNotificationChannel implements NotificationChannel {
    @Override
    public String channelType() {
        return "email";
    }
}
```

### 18.6 Analysis

Apa yang dicapai:

- core tidak tergantung implementation email,
- email provider bisa diganti,
- API/SPI versioning jelas,
- DS runtime requirement eksplisit,
- behavior dinamis lewat service registry,
- class dependency stabil lewat package import.

Ini desain OSGi yang idiomatik.

---

## 19. Case Study 2: Salah Desain dengan Require-Bundle dan Internal Leakage

Desain buruk:

```text
Bundle-SymbolicName: com.acme.case.web
Require-Bundle:
 com.acme.case.core,
 com.acme.notification.email,
 com.acme.audit.impl
```

Kode:

```java
import com.acme.notification.email.internal.EmailSender;
import com.acme.audit.impl.OracleAuditWriter;
```

Masalah:

1. Web bundle tergantung implementation detail.
2. Email implementation tidak bisa diganti tanpa compile/runtime break.
3. Audit implementation menjadi API de facto.
4. Refactoring internal package menjadi breaking change.
5. Testing dengan fake provider sulit.
6. Runtime graph terlalu coupled.

Desain lebih baik:

```text
com.acme.case.web imports:
 com.acme.case.api
 com.acme.notification.api
 com.acme.audit.api
```

Kode:

```java
@Component
public class CaseController {
    @Reference
    NotificationService notificationService;

    @Reference
    AuditPublisher auditPublisher;
}
```

Implementation provider:

```text
com.acme.notification.email.impl registers NotificationService/NotificationChannel
com.acme.audit.oracle.impl registers AuditPublisher
```

---

## 20. Case Study 3: javax/jakarta Transition in OSGi

Salah satu isu Java 8–25 enterprise adalah transisi `javax.*` ke `jakarta.*`.

Contoh:

```text
Bundle A imports javax.persistence;version="[2.2,3)"
Bundle B imports jakarta.persistence;version="[3.0,4)"
```

Ini bukan package yang sama. Resolver tidak akan menganggap kompatibel.

Masalah umum:

- sebagian bundle masih Java EE/Jakarta EE lama,
- provider persistence modern export `jakarta.persistence`,
- library lama butuh `javax.persistence`,
- adapter tidak tersedia.

Strategi:

1. Jangan berharap OSGi menyamakan `javax` dan `jakarta`.
2. Pisahkan runtime lama dan baru jika tidak kompatibel.
3. Gunakan adapter/bridge eksplisit jika mungkin.
4. Hindari API platform yang mencampur `javax` dan `jakarta` dalam satu contract.
5. Buat migration bundle dengan boundary jelas.
6. Gunakan resolver tests untuk memastikan tidak ada mix tak sengaja.

---

## 21. Case Study 4: Java 8 sampai 25 Execution Dependency

Bayangkan ada bundle:

```java
public class AuditHasher {
    public String hash(String input) {
        return HexFormat.of().formatHex(...);
    }
}
```

`HexFormat` tersedia sejak Java 17. Jika bundle target Java 8, ini tidak valid.

Dependency model harus menangkap runtime Java minimum.

Dengan build/tooling benar, bundle harus punya requirement JavaSE 17 atau bytecode target 17.

Jika tidak, runtime Java 8 bisa mencoba install bundle dan gagal karena:

```text
UnsupportedClassVersionError
```

atau class missing.

Top-tier practice:

- tentukan target Java per bundle,
- jangan campur Java 8-compatible API bundle dengan Java 17 implementation detail tanpa jelas,
- API bundle yang ingin luas kompatibel bisa tetap Java 8 bytecode,
- implementation bundle bisa Java 17/21/25 jika runtime memang modern,
- gunakan CI matrix.

---

## 22. Wrapping Non-OSGi Libraries

Banyak library Java tidak OSGi-ready. Kita bisa wrap library menjadi bundle.

### 22.1 Strategy A: Use Existing OSGi Metadata

Beberapa library sudah punya manifest OSGi.

Contoh:

```text
slf4j-api
org.osgi.*
Eclipse bundles
Apache Aries components
```

Pakai langsung jika metadata benar.

### 22.2 Strategy B: Create Wrapper Bundle

Jika library tidak punya metadata:

```text
Bundle-SymbolicName: com.acme.thirdparty.jackson.databind
Bundle-Version: 2.17.2
Export-Package:
 com.fasterxml.jackson.databind;version="2.17.2"
Import-Package:
 com.fasterxml.jackson.core;version="[2.17,3)",
 com.fasterxml.jackson.annotation;version="[2.17,3)",
 *
```

### 22.3 Strategy C: Embed as Private Dependency

Jika library hanya implementation detail:

```text
Private-Package:
 org.some.internal.lib.*
```

Atau embed JAR di `Bundle-ClassPath`.

Gunakan jika type library tidak bocor ke API.

### 22.4 Strategy D: Adapter Bundle

Jika library punya classloading assumption buruk, buat adapter service:

```text
com.acme.pdf.api
com.acme.pdf.itext.impl
```

API tidak expose iText type. Implementation bundle mengisolasi iText.

```java
public interface PdfRenderer {
    byte[] render(PdfRenderRequest request);
}
```

Ini membuat library dependency tidak menyebar ke platform.

---

## 23. Dependency dan Resource

Tidak semua dependency berupa class. Bundle bisa butuh resource:

- template,
- schema,
- SQL migration,
- configuration default,
- localization file,
- extension metadata.

`Import-Package` tidak menyelesaikan resource dependency antar bundle secara umum.

Jika bundle A butuh resource dari bundle B, pikirkan ulang:

1. Apakah resource itu seharusnya API?
2. Apakah lebih baik diakses lewat service?
3. Apakah resource harus ada di bundle yang sama?
4. Apakah perlu capability untuk menyatakan resource provider?
5. Apakah `Require-Bundle` memang warranted?

Contoh lebih baik:

```java
public interface TemplateProvider {
    Optional<Template> findTemplate(String name);
}
```

Bundle template provider register service, bukan consumer membaca resource langsung dari bundle lain.

---

## 24. Dependency dan Annotation Scanning

Banyak framework modern mengandalkan classpath scanning. OSGi tidak punya global classpath.

Contoh:

- JPA entity scanning,
- CDI scanning,
- JAX-RS annotation scanning,
- Jackson module discovery,
- Bean validation provider discovery,
- Spring component scan.

Dependency model yang benar harus membuat scanner tahu bundle mana yang harus diproses.

Solusi umum OSGi:

1. extender pattern,
2. manifest header sebagai marker,
3. capability requirement ke extender,
4. service registration explicit,
5. avoid global scanning.

Contoh:

```text
Service-Component: OSGI-INF/*.xml
Require-Capability: osgi.extender;filter:="(osgi.extender=osgi.component)"
```

DS extender membaca component XML, bukan scan semua class dari semua bundle secara liar.

---

## 25. Dependency dan ServiceLoader

Java `ServiceLoader` mencari provider di classloader tertentu. Di OSGi, ini bisa gagal karena provider berada di bundle lain.

Contoh library:

```java
ServiceLoader.load(MyProvider.class)
```

Jika library mengasumsikan classpath tunggal, provider discovery mungkin tidak menemukan apa-apa.

Solusi:

1. gunakan OSGi Service Registry,
2. gunakan adapter yang bridge ServiceLoader ke OSGi service,
3. atur TCCL secara terkendali jika library sulit diubah,
4. gunakan extender/mediator seperti OSGi Service Loader Mediator jika tersedia di runtime,
5. hindari provider discovery implisit untuk kontrak penting.

Dependency model harus eksplisit. Jangan sembunyikan dependency penting di `META-INF/services` tanpa mekanisme OSGi-aware.

---

## 26. Dependency Design untuk Regulated Platform

Dalam sistem regulasi/enforcement/case management, dependency bukan hanya technical concern. Ia berdampak pada auditability dan defensibility.

Misalnya platform punya modul:

```text
case-management
appeal
compliance
inspection
legal
correspondence
notification
workflow
rules
reporting
```

Jika semua modul saling import internal package, perubahan kecil bisa berdampak ke proses enforcement tanpa trace jelas.

OSGi dependency model bisa membantu:

1. API contract antar modul eksplisit.
2. Version range menunjukkan compatibility assumption.
3. Plugin rule dapat dinyatakan sebagai capability/service.
4. Runtime dapat diinspeksi: bundle apa active, package apa wired, service apa registered.
5. Hot update dapat dibatasi ke bundle tertentu.
6. Audit change dapat mengaitkan deployment artifact ke runtime dependency graph.

Contoh desain capability untuk rule plugin:

```text
Provide-Capability:
 com.acme.enforcement.rule;
 ruleType="escalation";
 agency="CEA";
 version:Version="1.2.0"
```

Service:

```java
public interface EscalationRule {
    RuleDecision evaluate(CaseContext context);
}
```

Plugin bundle:

```text
Import-Package:
 com.acme.enforcement.rule.api;version="[1.2,2)"
Require-Capability:
 osgi.extender;filter:="(osgi.extender=osgi.component)"
Provide-Capability:
 com.acme.enforcement.rule;ruleType="escalation";agency="CEA";version:Version="1.2.0"
```

Ini lebih defensible daripada meletakkan rule dalam classpath global.

---

## 27. Practical Manifest Examples

### 27.1 API Bundle

```text
Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.case.api
Bundle-Version: 1.5.0
Bundle-Name: ACME Case API
Export-Package: 
 com.acme.case.api;version="1.5.0",
 com.acme.case.api.event;version="1.1.0"
Import-Package: 
 org.osgi.annotation.versioning;version="[1.1,2)"
```

Characteristics:

- mostly export,
- minimal imports,
- no implementation dependency,
- stable package versioning.

### 27.2 Implementation Bundle with DS

```text
Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.case.impl
Bundle-Version: 1.5.3
Bundle-Name: ACME Case Implementation
Private-Package: 
 com.acme.case.impl.*
Import-Package: 
 com.acme.case.api;version="[1.5,2)",
 com.acme.audit.api;version="[1.0,2)",
 org.osgi.service.component.annotations;version="[1.4,2)",
 org.slf4j;version="[1.7,3)",
 *
Service-Component: OSGI-INF/*.xml
Require-Capability: 
 osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.4.0))"
```

Characteristics:

- implementation private,
- API imported,
- DS extender required,
- no internal export.

### 27.3 Plugin Bundle

```text
Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.partner.cea.escalation.rules
Bundle-Version: 1.2.0
Bundle-Name: CEA Escalation Rules Plugin
Private-Package:
 com.partner.cea.escalation.internal.*
Import-Package:
 com.acme.enforcement.rule.api;version="[1.2,2)",
 com.acme.case.api;version="[1.5,2)",
 org.osgi.service.component.annotations;version="[1.4,2)",
 *
Service-Component: OSGI-INF/*.xml
Provide-Capability:
 com.acme.enforcement.rule;ruleType="escalation";agency="CEA";version:Version="1.2.0"
Require-Capability:
 osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.4.0))"
```

Characteristics:

- plugin exposes capability, not implementation package,
- provides behavior through service,
- depends on stable API range.

### 27.4 Compatibility Facade Bundle

Sometimes during migration you create facade:

```text
Bundle-SymbolicName: com.acme.legacy.compat
Bundle-Version: 3.0.0
Require-Bundle:
 com.acme.case.api;bundle-version="[1.5,2)";visibility:=reexport,
 com.acme.document.api;bundle-version="[2.0,3)";visibility:=reexport
```

Use only if documented as compatibility bridge.

---

## 28. How Resolver Thinks About These Dependencies

Simplified resolver algorithm:

```text
For each bundle resource:
  read requirements
  read capabilities

For each requirement:
  find candidate capabilities in repository/runtime
  filter by namespace, attributes, directives, version range
  apply mandatory attributes
  apply uses constraints
  build consistent wiring graph

If graph found:
  bundle can resolve
Else:
  bundle remains installed with unresolved requirement
```

Important:

- resolver does not start services,
- resolver does not instantiate DS components,
- resolver does not validate business semantics,
- resolver only builds consistent class/capability wiring.

So a bundle can be `RESOLVED` but still non-functional because:

- DS component unsatisfied,
- config missing,
- database unavailable,
- service reference absent,
- runtime extender not started,
- business initialization failed.

Dependency model helps early validation, but not everything is resolvable at module layer.

---

## 29. Debugging Dependency Problems

### 29.1 Bundle Stuck `INSTALLED`

Symptoms:

```text
Bundle is INSTALLED, not RESOLVED.
```

Likely causes:

- missing mandatory import,
- version range not satisfied,
- missing required capability,
- Java execution environment mismatch,
- fragment host missing,
- uses constraint violation.

Questions:

1. What requirement is unresolved?
2. Is there any provider exporting matching package?
3. Does version range match?
4. Is provider bundle resolved?
5. Is there duplicate provider causing uses conflict?
6. Is Java version compatible?

### 29.2 Bundle Resolved But Component Missing

Likely causes:

- DS extender not installed/running,
- `Service-Component` header missing,
- component XML not generated,
- DS annotations not processed,
- required service reference unsatisfied,
- config required but missing.

This is not purely package dependency issue.

### 29.3 ClassNotFoundException

Likely causes:

- package not imported,
- class is in private package of another bundle,
- optional import unavailable,
- reflection dependency not detected,
- TCCL issue,
- embedded dependency missing from Bundle-ClassPath.

### 29.4 ClassCastException Across Same Class Name

Likely causes:

- same package embedded in multiple bundles,
- API class duplicated as private copy,
- provider and consumer wired to different exporters,
- split package,
- TCCL/reflection loaded class from unexpected loader.

### 29.5 Uses Constraint Violation

Likely causes:

- incompatible transitive package wiring,
- duplicate API exports,
- mixed versions of same API,
- require-bundle reexport conflict,
- embedding public API in implementation bundle.

Do not remove `uses:=` blindly. Fix graph consistency.

---

## 30. Dependency Review Checklist

Gunakan checklist ini saat review bundle.

### 30.1 Export Review

- Apakah semua exported package memang API/SPI?
- Apakah package version explicit?
- Apakah package version sesuai perubahan API?
- Apakah exported package membawa type internal/private dependency?
- Apakah ada implementation class yang bocor?
- Apakah ada package yang harusnya private tapi diexport?
- Apakah `uses:=` generated benar?

### 30.2 Import Review

- Apakah import range explicit?
- Apakah range terlalu longgar?
- Apakah range terlalu sempit?
- Apakah optional import benar-benar optional?
- Apakah ada import ke package internal bundle lain?
- Apakah reflection/SPI dependency sudah dipertimbangkan?
- Apakah Java version compatibility jelas?

### 30.3 Bundle Dependency Review

- Apakah `Require-Bundle` benar-benar diperlukan?
- Bisa diganti `Import-Package`?
- Apakah `visibility:=reexport` disengaja?
- Apakah ada dependency tersembunyi melalui reexport?

### 30.4 Capability Review

- Apakah bundle butuh DS/Blueprint/HTTP Whiteboard extender?
- Apakah requirement extender sudah eksplisit?
- Apakah execution environment benar?
- Apakah custom capability berguna untuk plugin/runtime feature?
- Apakah optional capability punya fallback?

### 30.5 Architecture Review

- Apakah API bergantung pada implementation?
- Apakah implementation package bocor ke consumer?
- Apakah service registry digunakan untuk behavior dynamic?
- Apakah package import digunakan untuk type contract?
- Apakah ada split package?
- Apakah dependency graph bisa dijelaskan dalam satu diagram?

---

## 31. Top-Tier Heuristics

Berikut heuristics praktis yang sering dipakai engineer matang di OSGi.

### 31.1 Export Lebih Mahal daripada Import

Import adalah kebutuhan. Export adalah janji.

```text
Be conservative in what you export.
Be explicit in what you import.
```

### 31.2 API Bundle Harus Membosankan

API bundle yang bagus biasanya kecil, stabil, minim dependency, dan tidak menarik.

Jika API bundle butuh banyak framework, persistence provider, HTTP type, atau implementation dependency, kemungkinan boundary-nya salah.

### 31.3 Implementation Bundle Boleh Kompleks, Tapi Kompleksitas Tidak Boleh Bocor

Implementation bundle bisa memakai Jackson, Hibernate, HTTP client, scheduler, atau connector vendor. Tetapi exported API jangan expose type tersebut kecuali memang platform contract.

### 31.4 Optional Dependency Harus Punya Behavior Story

Jangan hanya bilang “optional karena kadang tidak ada”. Jelaskan:

- apa yang terjadi jika tidak ada,
- fitur apa yang disable,
- log apa yang muncul,
- metric apa yang berubah,
- test apa yang membuktikan fallback.

### 31.5 `Require-Bundle` Harus Bisa Dipertanggungjawabkan

Setiap `Require-Bundle` harus punya alasan desain. Jika alasannya hanya “lebih mudah”, itu bau arsitektur.

### 31.6 Resolver Error adalah Design Feedback

Jangan treat resolver error sebagai noise. Resolver sering menunjukkan:

- boundary salah,
- versioning salah,
- duplicate API,
- split package,
- dependency terlalu implicit.

### 31.7 Service untuk Behavior, Package untuk Type

Ini rule paling penting:

```text
Types are wired by package imports.
Behavior providers are wired by services.
```

---

## 32. Common Anti-Patterns

### 32.1 Export Everything

```text
Export-Package: *
```

Efek:

- semua internal menjadi API,
- refactoring mati,
- consumer coupling liar.

### 32.2 Optional Everything

```text
Import-Package: *;resolution:=optional
```

Efek:

- resolver tidak lagi melindungi runtime,
- failure pindah ke production path.

### 32.3 Require Platform Core Everywhere

```text
Require-Bundle: com.acme.platform.core
```

Efek:

- semua bundle terikat ke core,
- modularity palsu,
- update core menjadi high-risk.

### 32.4 Duplicate API Bundle

```text
com.acme.case.api exported by:
- com.acme.case.api
- com.acme.case.impl
- com.acme.legacy.compat
```

Efek:

- resolver ambiguity,
- uses violation,
- class identity issue.

### 32.5 Expose Third-Party Implementation Types in API

```java
public interface ReportService {
    org.apache.poi.ss.usermodel.Workbook export(...);
}
```

Jika Apache POI bukan platform API yang sengaja distabilkan, ini membuat semua consumer tergantung POI.

Lebih baik:

```java
public interface ReportService {
    ReportDocument export(...);
}
```

atau:

```java
public interface ReportService {
    byte[] export(...);
}
```

### 32.6 Hidden Reflection Dependency

Kode:

```java
Class.forName("com.vendor.Driver")
```

Manifest tidak import package vendor karena bnd tidak melihat bytecode reference langsung.

Solusi:

- import manual,
- service-based adapter,
- explicit driver service,
- controlled TCCL bridge.

---

## 33. Mini Exercise

Coba evaluasi manifest ini:

```text
Bundle-SymbolicName: com.acme.case.web
Bundle-Version: 1.0.0
Export-Package: com.acme.case.web.*, com.acme.case.internal.*
Require-Bundle: com.acme.platform.core, com.acme.audit.impl
Import-Package: *;resolution:=optional
```

Masalah:

1. Web package diexport tanpa alasan jelas.
2. Internal package diexport.
3. Bergantung ke `platform.core` dan `audit.impl` via bundle identity.
4. Semua import optional, resolver protection hilang.
5. Tidak ada version range.
6. Tidak jelas API/service boundary.

Refactor:

```text
Bundle-SymbolicName: com.acme.case.web
Bundle-Version: 1.0.0
Private-Package: com.acme.case.web.internal.*
Import-Package:
 com.acme.case.api;version="[1.5,2)",
 com.acme.audit.api;version="[1.0,2)",
 com.acme.notification.api;version="[1.0,2)",
 org.osgi.service.component.annotations;version="[1.4,2)",
 jakarta.servlet;version="[6.0,7)",
 *
Service-Component: OSGI-INF/*.xml
Require-Capability:
 osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.4.0))"
```

Lalu gunakan DS reference untuk services.

---

## 34. Ringkasan Mental Model

Dependency model OSGi bisa diringkas seperti ini:

```text
Export-Package:
  I provide this package as API/SPI.

Import-Package:
  I need this package contract from any compatible provider.

Private-Package:
  I include this package in my bundle but do not expose it.

Require-Bundle:
  I need this specific bundle identity.

Provide-Capability:
  I provide a named runtime capability.

Require-Capability:
  I need a named runtime capability.

Service Registry:
  I need/provide runtime behavior object, dynamically.
```

Top-tier OSGi engineering bukan sekadar membuat manifest resolve. Ia adalah seni mendesain dependency graph yang:

- eksplisit,
- stabil,
- evolvable,
- testable,
- diagnosable,
- resilient terhadap perubahan versi,
- tidak membocorkan implementation detail,
- tidak membuat runtime dynamic menjadi chaos.

---

## 35. Apa yang Harus Kamu Kuasai Sebelum Lanjut

Sebelum masuk ke Part 5, pastikan kamu bisa menjawab:

1. Kenapa OSGi lebih suka package dependency daripada artifact dependency?
2. Apa bedanya `Export-Package` dan `Private-Package`?
3. Kenapa exported package adalah janji compatibility?
4. Kenapa `Require-Bundle` lebih coupled daripada `Import-Package`?
5. Kapan `Require-Bundle` masih masuk akal?
6. Apa fungsi `Provide-Capability` dan `Require-Capability`?
7. Kenapa optional import berbahaya jika dipakai sembarangan?
8. Apa bedanya package dependency dan service dependency?
9. Kenapa split package buruk?
10. Apa yang dilakukan `uses:=` directive?
11. Bagaimana dependency model membantu plugin architecture?
12. Bagaimana Java 8–25 memengaruhi dependency metadata?

Jika jawabanmu sudah jelas, kamu siap masuk ke resolver engineering.

---

## 36. Koneksi ke Part Berikutnya

Part ini membahas dependency declaration. Part berikutnya akan membahas bagaimana framework mengambil declaration tersebut dan menyelesaikannya menjadi wiring graph.

Part 5 akan masuk ke:

- resolver as constraint solver,
- requirement/capability matching,
- candidate selection,
- package wiring,
- bundle wiring,
- `uses:=` constraint secara lebih dalam,
- version range mathematics,
- optional dependency nondeterminism,
- resolver failure analysis,
- case study resolver error yang realistis.

Dengan kata lain:

```text
Part 4: How dependencies are declared.
Part 5: How dependencies are resolved.
```

---

## 37. Referensi

Referensi utama untuk pendalaman:

1. OSGi Core Release 8 Specification — Module Layer, Life Cycle Layer, Framework Namespaces, Bundle Manifest Headers.
2. OSGi Core Release 8 — Requirement/Capability model.
3. OSGi Compendium Release 8 — Declarative Services and extender-related runtime model.
4. bnd / Bndtools documentation — `Export-Package`, `Private-Package`, manifest generation, baseline, resolver.
5. Apache Felix documentation — bundle model, framework behavior, troubleshooting.
6. Eclipse Equinox documentation — OSGi implementation behavior, execution environment, plugin dependency model.
7. IBM OSGi guidance — package export/import, package versions, and multiple package versions at runtime.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: 03 — Class Loading Deep Dive: Per-Bundle ClassLoaders and Visibility Rules](./03-class-loading-per-bundle-classloaders-visibility-rules.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 5 — Resolver Engineering: Constraint Solving, Wiring, Uses Constraints, and Failure Analysis](./05-resolver-engineering-constraint-solving-wiring-uses-constraints-failure-analysis.md)
