# 03 — Class Loading Deep Dive: Per-Bundle ClassLoaders and Visibility Rules

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> Part: 03 / 35  
> Target Java: 8 sampai 25  
> Fokus: class loading, class identity, visibility, TCCL, reflection, SPI, embedded dependency, boot delegation, dynamic import, fragment, dan failure analysis.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami kenapa class loading adalah pusat dari OSGi, bukan detail teknis pinggiran.
2. Membedakan classpath Java biasa, JPMS module path, dan OSGi bundle space.
3. Menjelaskan bagaimana satu bundle melihat class dari dirinya sendiri, framework, imported package, required bundle, attached fragment, dan dynamic import.
4. Men-debug `ClassNotFoundException`, `NoClassDefFoundError`, `ClassCastException`, `LinkageError`, `uses constraint violation`, dan konflik dependency versi.
5. Mendesain boundary package agar tidak terjadi class identity leak.
6. Mengenali library Java yang bermasalah di OSGi karena asumsi classpath tunggal, reflection, annotation scanning, `ServiceLoader`, atau `Thread Context ClassLoader`.
7. Mengerti strategi praktis untuk menjalankan OSGi di Java 8 sampai Java 25, terutama setelah JPMS dan strong encapsulation.

Bagian ini penting karena banyak developer mengira OSGi gagal karena “terlalu kompleks”. Seringnya bukan begitu. Yang terjadi adalah sistem classpath lama dipaksa masuk ke runtime yang menuntut dependency explicit, package boundary jelas, dan runtime visibility deterministic.

---

## 1. Core Thesis: OSGi Mengganti Classpath Global dengan Bundle Space yang Terkontrol

Di aplikasi Java tradisional, semua JAR biasanya ditaruh pada satu classpath besar. Classloader aplikasi melihat banyak JAR sekaligus. Bila ada dua versi library yang sama, urutan classpath menentukan mana yang menang. Ini menciptakan beberapa masalah klasik:

- dependency collision,
- versi library tidak eksplisit,
- package private boundary tidak benar-benar enforced,
- dependency transitif bocor ke semua tempat,
- class ditemukan bukan karena didesain terlihat, tetapi karena kebetulan ada di classpath,
- upgrade library dapat merusak modul lain secara tidak terlihat.

OSGi membalik model tersebut.

Dalam OSGi, setiap bundle punya ruang class sendiri. Bundle hanya bisa memakai class yang:

1. berasal dari bundle itu sendiri,
2. berasal dari attached fragment,
3. berasal dari Java/framework/system package yang memang diekspos,
4. berasal dari package yang di-import secara eksplisit,
5. berasal dari required bundle jika memakai `Require-Bundle`,
6. berasal dari dynamic import jika memang dikonfigurasi,
7. berasal dari mekanisme khusus seperti boot delegation atau framework hook.

Ini berarti OSGi bukan hanya “mencari class”. OSGi melakukan **visibility enforcement**.

Mental model paling penting:

```text
Classpath app:
  “Apakah class ini ada di salah satu JAR?”

OSGi app:
  “Apakah bundle ini punya hak visibility terhadap package yang berisi class itu?”
```

Perbedaan kecil ini mengubah seluruh cara berpikir.

---

## 2. Classpath Java Biasa: Satu Dunia Besar

Pada classpath biasa:

```text
java -cp app.jar:lib-a.jar:lib-b.jar:lib-c.jar com.example.Main
```

Aplikasi sering terlihat seperti ini:

```text
Application ClassLoader
 ├── app.jar
 ├── lib-a.jar
 ├── lib-b.jar
 └── lib-c.jar
```

Semua code di `app.jar` biasanya dapat melihat class dari `lib-a.jar`, `lib-b.jar`, dan `lib-c.jar`. Bahkan bila `app.jar` tidak secara eksplisit depend pada `lib-c.jar`, class tersebut tetap bisa terlihat jika ada di classpath.

Masalahnya:

```text
lib-a.jar needs jackson-databind 2.13
lib-b.jar needs jackson-databind 2.17
classpath contains only one jackson-databind version
```

Jika versi 2.17 menang, `lib-a` mungkin gagal. Jika versi 2.13 menang, `lib-b` mungkin gagal. Java classpath tidak punya konsep “bundle A pakai Jackson 2.13 sementara bundle B pakai Jackson 2.17” dalam satu application classloader yang sama.

OSGi memungkinkan isolasi seperti itu, selama package wiring dan class identity boundary didesain benar.

---

## 3. JPMS vs OSGi dari Perspektif Class Loading

JPMS atau Java Platform Module System memperkenalkan module descriptor `module-info.java`. Ia mengatur `requires`, `exports`, `opens`, dan encapsulation pada level module.

Namun JPMS dan OSGi berbeda secara fundamental:

| Aspek | JPMS | OSGi |
|---|---|---|
| Waktu graph dibentuk | launch-time / layer creation | runtime resolve/install/update |
| Unit dependency | module | package/capability/bundle |
| Dynamic install/uninstall | bukan model utama | model utama |
| Service model | `ServiceLoader` | dynamic service registry |
| Versioning module | tidak built-in seperti OSGi | bundle dan package version built-in |
| Multiple versions | terbatas/rumit | natural lewat bundle space |
| Class visibility | module exports/opens | imports/exports/wiring/classloader |
| Runtime lifecycle | bukan fokus utama | inti framework |

JPMS memperbaiki banyak hal dari classpath, terutama strong encapsulation, tetapi bukan pengganti penuh OSGi. OSGi menyelesaikan masalah lain: runtime modularity dan dynamic composition.

Di Java 9–25, kebanyakan framework OSGi tetap berjalan dengan cara bundle classes berada dalam konteks classloader framework/bundle, bukan sebagai JPMS named modules yang saling `requires` secara normal. Karena itu, issue seperti `--add-opens`, reflection ke JDK internal, dan library lama tetap perlu dipahami.

---

## 4. Bundle ClassLoader: Satu Bundle, Satu Visibility Universe

Setiap bundle normal memiliki classloader atau mekanisme class loading equivalent yang membuat bundle punya ruang visibility sendiri.

Misalnya:

```text
Bundle A: com.acme.order.api
Bundle B: com.acme.order.impl
Bundle C: com.acme.billing.impl
Bundle D: com.fasterxml.jackson.databind
```

Bundle B dapat melihat Bundle A jika ia import package API-nya:

```text
Import-Package: com.acme.order.api;version="[1.0,2.0)"
```

Bundle B dapat melihat Jackson jika ia import package Jackson:

```text
Import-Package: com.fasterxml.jackson.databind;version="[2.15,3.0)"
```

Tetapi Bundle C tidak otomatis melihat implementation package Bundle B. Bahkan jika package itu ada di VM, ia tidak visible kecuali diekspor dan di-import.

OSGi memisahkan dua pertanyaan:

```text
1. Apakah class secara fisik ada di runtime?
2. Apakah bundle ini punya visibility ke package class tersebut?
```

Classpath biasa sering hanya peduli pertanyaan pertama. OSGi peduli dua-duanya.

---

## 5. Package adalah Unit Visibility Utama

Kesalahan umum developer baru OSGi adalah berpikir dependency antar bundle selalu seperti Maven dependency antar artifact.

Di OSGi, visibility utama ada pada level **package**.

Contoh:

```text
Bundle: com.acme.customer
Export-Package:
  com.acme.customer.api;version="1.2.0"
Private-Package:
  com.acme.customer.internal
```

Bundle lain bisa import:

```text
Import-Package: com.acme.customer.api;version="[1.2,2.0)"
```

Tetapi tidak bisa memakai:

```java
com.acme.customer.internal.CustomerRepositoryImpl
```

Kecuali package internal itu ikut diekspor, yang biasanya adalah desain buruk.

Inilah discipline utama OSGi:

```text
Export only stable API.
Keep implementation private.
Import by package, not by accidental classpath reachability.
```

---

## 6. Bundle Space: Konsep yang Harus Dipegang

Bundle space adalah kumpulan resource/class yang dapat dilihat oleh bundle setelah resolution.

Secara konseptual:

```text
Bundle B class loading space
 ├── java.* / framework/system packages
 ├── own classes/resources
 ├── attached fragments
 ├── imported package wires
 ├── required bundle wires
 ├── bundle class path entries
 └── dynamic import results, if any
```

Bundle space bukan folder. Ia adalah hasil dari resolving, manifest metadata, framework policy, dan classloader behavior.

Ketika terjadi error, pertanyaan yang harus diajukan bukan:

```text
“JAR-nya ada tidak?”
```

Tetapi:

```text
“Package itu berada di bundle space bundle pemakai tidak?”
```

---

## 7. Simplified Class Loading Algorithm

Algoritma sebenarnya di spesifikasi lebih detail, tetapi sebagai mental model praktis, ketika Bundle X mencoba load class `p.C`, framework kira-kira mengecek:

```text
1. Apakah package p adalah java.*?
   -> delegasi ke parent/bootstrap/platform sesuai aturan JVM/framework.

2. Apakah package p di-import dari bundle lain?
   -> pakai exporter yang sudah wired saat resolve.

3. Apakah package p tersedia dari required bundle?
   -> pakai bundle yang required, termasuk re-export sesuai aturan.

4. Apakah class p.C ada di bundle sendiri atau Bundle-ClassPath?
   -> load dari isi bundle sendiri.

5. Apakah class p.C ada di attached fragment?
   -> load dari host bundle space.

6. Apakah DynamicImport-Package cocok?
   -> framework mencoba resolve import secara runtime.

7. Jika tidak ada:
   -> ClassNotFoundException atau NoClassDefFoundError tergantung konteks.
```

Urutan detail bisa berbeda tergantung framework dan kondisi, tetapi prinsipnya jelas: class loading OSGi bukan scanning semua JAR.

---

## 8. `Import-Package`: Visibility Lewat Wiring

Contoh:

```text
Import-Package: org.slf4j;version="[1.7,2.0)"
```

Artinya bundle ini membutuhkan package `org.slf4j` dari provider lain dengan version range yang cocok.

Saat bundle resolved, framework memilih exporter. Setelah dipilih, wiring bersifat spesifik:

```text
Consumer Bundle
  imports org.slf4j
      wired to
Provider Bundle slf4j-api-1.7.36
  exports org.slf4j;version=1.7.36
```

Jika runtime juga punya `slf4j-api-2.0.9`, tidak berarti consumer otomatis pakai versi baru. Ia pakai exporter yang dipilih resolver sesuai constraint.

Konsekuensi penting:

- dependency menjadi explicit,
- versi bisa dikontrol,
- dua consumer bisa wired ke provider berbeda,
- runtime dapat menjelaskan kenapa bundle tidak resolve,
- error classpath yang biasanya laten menjadi error resolution yang lebih awal.

---

## 9. `Export-Package`: API Exposure, Bukan “Share Semua Class”

Contoh buruk:

```text
Export-Package: com.acme.*
```

Jika ini membuat semua package diekspor, maka implementation detail bocor. Bundle lain mulai memakai internal class. Setelah itu, kamu tidak bisa refactor tanpa breaking consumer.

Contoh lebih benar:

```text
Export-Package: \
  com.acme.customer.api;version="1.4.0",\
  com.acme.customer.spi;version="1.4.0"
```

Dan implementation tetap private:

```text
Private-Package: \
  com.acme.customer.internal,\
  com.acme.customer.internal.persistence,\
  com.acme.customer.internal.validation
```

Rule praktis:

```text
Export package only if another bundle is supposed to compile against it.
```

Bukan karena “class ini dibutuhkan runtime”. Jika class dibutuhkan runtime internal, ia tetap bisa private dalam bundle yang sama.

---

## 10. `Require-Bundle`: Dependency Level Bundle yang Sering Terlalu Kasar

`Require-Bundle` membuat bundle bergantung pada bundle lain sebagai unit.

Contoh:

```text
Require-Bundle: com.acme.customer
```

Ini terlihat mudah, tetapi sering terlalu kasar. Masalahnya:

1. consumer menjadi tahu identity bundle provider,
2. dependency bukan lagi package contract yang granular,
3. refactoring bundle menjadi lebih sulit,
4. re-export chain bisa membingungkan,
5. coupling ke packaging, bukan API.

`Require-Bundle` umum ditemukan di Eclipse/Equinox ecosystem, terutama plugin lama. Namun untuk sistem enterprise modern, default yang lebih sehat biasanya:

```text
Import-Package > Require-Bundle
```

Kecuali ada alasan kuat seperti compatibility dengan ecosystem tertentu.

---

## 11. `Bundle-ClassPath`: Isi Bundle Sendiri dan Embedded JAR

Header `Bundle-ClassPath` menentukan classpath internal bundle.

Contoh:

```text
Bundle-ClassPath: .,lib/helper.jar
```

Artinya bundle classloader dapat load class dari root bundle dan `lib/helper.jar` di dalam bundle.

Embedded JAR berguna untuk menyembunyikan dependency implementation. Tetapi ia juga berbahaya jika salah dipakai.

### 11.1 Kapan embedded dependency masuk akal?

Masuk akal jika:

- dependency benar-benar private implementation,
- tidak ada API object dari dependency yang bocor ke bundle lain,
- dependency tidak harus shared,
- dependency tidak register service global,
- dependency tidak memakai static global state yang harus sama dengan bundle lain.

Contoh:

```text
Bundle com.acme.invoice.pdf
  embeds internal PDF helper library
  exports only com.acme.invoice.pdf.api
```

Selama API tidak expose class dari helper library, ini aman.

### 11.2 Kapan embedded dependency berbahaya?

Berbahaya jika dependency types bocor di API.

Contoh buruk:

```java
package com.acme.payment.api;

import com.fasterxml.jackson.databind.JsonNode;

public interface PaymentPayloadParser {
    JsonNode parse(String payload);
}
```

Jika provider bundle embed Jackson sendiri, sementara consumer wired ke Jackson berbeda, maka class identity bisa pecah.

`JsonNode` dari classloader provider tidak sama dengan `JsonNode` dari classloader consumer jika berasal dari wiring berbeda.

Rule penting:

```text
If a type crosses bundle boundary, its package must come from a shared, consistently wired API provider.
```

---

## 12. Class Identity: Nama Sama Tidak Berarti Class Sama

Dalam JVM, class identity bukan hanya fully qualified class name.

Class identity adalah:

```text
(classloader, fully qualified class name)
```

Jadi dua class berikut bisa berbeda:

```text
Loader A loads com.fasterxml.jackson.databind.JsonNode
Loader B loads com.fasterxml.jackson.databind.JsonNode
```

Walaupun namanya sama, JVM menganggapnya dua type berbeda.

Akibatnya:

```java
Object value = provider.getJsonNode();
JsonNode node = (JsonNode) value;
```

Bisa gagal dengan:

```text
ClassCastException: com.fasterxml.jackson.databind.node.ObjectNode cannot be cast to com.fasterxml.jackson.databind.JsonNode
```

Pesannya terlihat absurd karena class tampak sama. Tetapi classloader-nya berbeda.

Mental model:

```text
com.foo.Bar loaded by BundleClassLoader[A]
!=
com.foo.Bar loaded by BundleClassLoader[B]
```

Ini adalah sumber banyak bug advanced di OSGi.

---

## 13. Boundary Rule: Jangan Bocorkan Implementation Type

Jika bundle A memberikan service ke bundle B, method signature service harus memakai type yang stabil dan shared.

Contoh buruk:

```java
public interface ReportRenderer {
    org.thymeleaf.context.Context buildContext(ReportRequest request);
}
```

Kenapa buruk?

Karena API bundle sekarang memaksa consumer mengenal Thymeleaf. Jika renderer implementation mengganti engine ke FreeMarker, API ikut berubah. Selain itu Thymeleaf package harus di-share konsisten.

Contoh lebih baik:

```java
public interface ReportRenderer {
    RenderedReport render(ReportRequest request);
}
```

Dengan DTO milik API bundle:

```java
public final class RenderedReport {
    private final String contentType;
    private final byte[] content;
}
```

Rule:

```text
Only stable domain/API DTOs should cross bundle boundaries.
Library-specific implementation types should stay inside implementation bundle.
```

---

## 14. `ClassNotFoundException` vs `NoClassDefFoundError`

Keduanya sering muncul dalam OSGi, tetapi maknanya berbeda.

### 14.1 `ClassNotFoundException`

Biasanya muncul saat code secara eksplisit meminta class:

```java
Class.forName("com.acme.Foo")
```

Atau framework/library mencoba load class by name.

Maknanya:

```text
Class tidak ditemukan oleh classloader yang digunakan untuk lookup tersebut.
```

Dalam OSGi, penyebab umum:

- package tidak di-import,
- provider tidak export package,
- version range tidak cocok,
- lookup memakai TCCL yang salah,
- class ada di bundle lain tetapi tidak visible,
- fragment belum attached,
- optional import tidak wired,
- dynamic import tidak match.

### 14.2 `NoClassDefFoundError`

Biasanya muncul saat class pernah dikenal saat compile/linking, tetapi dependency-nya tidak tersedia saat runtime.

Contoh:

```java
public class MyComponent {
    private ObjectMapper mapper = new ObjectMapper();
}
```

Jika `ObjectMapper` atau salah satu dependency transitifnya tidak visible, bisa muncul:

```text
NoClassDefFoundError: com/fasterxml/jackson/databind/ObjectMapper
```

Atau class utama ditemukan, tetapi dependency internalnya tidak:

```text
NoClassDefFoundError: com/fasterxml/jackson/core/JsonFactory
```

Ini sering berarti:

```text
Import package untuk dependency transitif belum benar, atau embedded library tidak lengkap.
```

---

## 15. `LinkageError`: Ketika Class Ada, Tapi Tidak Konsisten

`LinkageError` lebih subtle. Class ditemukan, tetapi ada konflik saat JVM linking.

Contoh:

```text
java.lang.LinkageError: loader constraint violation
```

Atau:

```text
NoSuchMethodError
NoSuchFieldError
IncompatibleClassChangeError
UnsupportedClassVersionError
```

Dalam OSGi, penyebab umum:

1. consumer compile dengan API versi baru, runtime wired ke API versi lama,
2. dua package yang harus konsisten justru wired ke provider berbeda,
3. library internal memakai type yang berasal dari classloader lain,
4. bytecode level lebih tinggi dari JDK runtime,
5. package version range terlalu longgar,
6. resolver memilih provider yang secara semantic tidak kompatibel.

Contoh:

```text
Bundle A compiled against com.acme.api 2.1
Runtime provides com.acme.api 1.8
Import-Package: com.acme.api;version="[1.0,3.0)"
```

Range terlalu longgar. Resolver boleh memilih 1.8, tetapi method baru dari 2.1 tidak ada.

Pelajaran:

```text
Version range is architecture, not decoration.
```

---

## 16. `uses:=` Constraint: Menjaga Type Consistency

`uses:=` directive pada `Export-Package` memberi tahu resolver bahwa package yang diekspor menggunakan package lain pada API surface-nya.

Contoh:

```text
Export-Package: com.acme.report.api;version="1.0.0";uses:="com.acme.document.api"
```

Artinya package `com.acme.report.api` mengandung signature yang memakai type dari `com.acme.document.api`.

Misalnya:

```java
package com.acme.report.api;

import com.acme.document.api.Document;

public interface ReportService {
    Document generate(ReportRequest request);
}
```

Resolver harus memastikan consumer dari `com.acme.report.api` melihat `com.acme.document.api` yang sama dengan provider report API.

Tanpa consistency, consumer bisa menerima `Document` dari classloader berbeda.

### Kenapa `uses` penting?

Karena type yang keluar dari API harus punya identity sama di semua pihak.

```text
Provider sees Document from Bundle D v1.4
Consumer sees Document from Bundle D v2.0
```

Secara nama sama, tapi identity bisa berbeda. `uses` constraint mencegah wiring yang tidak konsisten.

### Kenapa `uses constraint violation` sering bikin bingung?

Karena error muncul bukan pada package yang kamu kira bermasalah, tetapi pada transitive consistency graph.

Contoh:

```text
Bundle X imports A
A uses B
X also imports B from provider berbeda
```

Resolver menolak karena X akan melihat dua realitas type B.

Cara berpikir:

```text
Jika package A memakai type dari package B pada API-nya,
semua consumer A harus melihat B yang sama dengan provider A.
```

---

## 17. Split Package: Satu Package, Banyak Bundle

Split package terjadi ketika package yang sama ada di lebih dari satu bundle.

Contoh:

```text
Bundle A exports com.acme.common
Bundle B exports com.acme.common
```

Atau:

```text
Bundle X contains com.acme.common locally
Bundle X also imports com.acme.common
```

Ini berbahaya karena package di Java adalah unit access dan class identity. OSGi dapat menangani beberapa variasi, tetapi desainnya sering rapuh.

Masalah split package:

- class tertentu ditemukan dari provider A, class lain dari provider B,
- package-private access rusak,
- sealing issue,
- resolver ambiguity,
- `uses` constraint violation,
- upgrade sulit,
- JPMS makin tidak toleran terhadap split package.

Rule praktis:

```text
One logical package should have one owner bundle.
```

Jika package perlu dibagi, biasanya package boundary-nya salah.

---

## 18. Self-Import: Kenapa Bundle Bisa Import Package yang Juga Dia Punya?

Dalam OSGi/bnd, kadang bundle mengekspor package dan juga mengimpor package yang sama. Ini disebut substitution/self-import pattern.

Contoh:

```text
Export-Package: com.acme.api;version="1.2.0"
Import-Package: com.acme.api;version="[1.2,2.0)"
```

Kenapa ini bisa berguna?

Karena bundle dapat memilih memakai package dari provider lain yang kompatibel, bukan selalu copy local-nya sendiri. Ini membantu consistency pada API package yang tertanam di beberapa bundle.

Namun untuk banyak enterprise code, self-import membingungkan jika tidak dipahami.

Rule:

```text
Self-import is advanced compatibility tooling.
Do not use it accidentally.
Understand whether the package is API copy, provider implementation, or private code.
```

Jika kamu memakai bnd, jangan langsung hapus import “aneh” tanpa memahami substitution policy.

---

## 19. Optional Import: Dependency yang Boleh Tidak Ada Saat Resolve

Contoh:

```text
Import-Package: com.acme.audit.api;resolution:=optional
```

Artinya bundle tetap bisa resolve jika package itu tidak tersedia.

Masalahnya: optional import tidak berarti class aman dipakai kapan saja.

Jika code langsung mereferensikan class optional pada path yang selalu dieksekusi:

```java
private AuditClient client;
```

atau:

```java
new AuditEvent(...)
```

Maka saat package tidak wired, runtime tetap bisa gagal.

Optional import cocok untuk:

- integration optional,
- reflective bridge,
- adapter yang hanya aktif jika dependency ada,
- library yang memiliki optional feature.

Pattern aman:

```java
public final class OptionalAuditBridge {
    public boolean isAvailable() {
        try {
            getClass().getClassLoader().loadClass("com.acme.audit.api.AuditClient");
            return true;
        } catch (ClassNotFoundException e) {
            return false;
        }
    }
}
```

Tetapi dalam OSGi modern, sering lebih baik memakai service dynamics:

```text
If audit service exists -> bind it.
If not -> component remains unsatisfied or uses no-op implementation.
```

Jangan memakai optional import sebagai pengganti service design yang sehat.

---

## 20. `DynamicImport-Package`: Emergency Door, Bukan Dependency Model Normal

Contoh:

```text
DynamicImport-Package: com.acme.plugins.*
```

Dynamic import membuat framework mencoba resolve package saat class loading terjadi, bukan saat bundle resolve.

Ini berguna untuk beberapa kasus:

- scripting,
- plugin loading by name,
- framework bridge,
- legacy reflection-heavy library,
- dynamic adapter yang tidak tahu semua package saat build.

Namun berbahaya karena:

1. dependency graph tidak eksplisit saat resolve,
2. kegagalan pindah ke runtime path tertentu,
3. wiring bisa bergantung pada timing,
4. observability menurun,
5. compatibility sulit diaudit,
6. security boundary melemah secara konseptual.

Anti-pattern:

```text
DynamicImport-Package: *
```

Ini seperti mengubah OSGi kembali menjadi classpath liar, tetapi dengan error yang lebih sulit ditebak.

Rule:

```text
Use DynamicImport only for narrowly bounded dynamic extension use cases.
Never as a lazy fix for bad manifests.
```

---

## 21. Boot Delegation: Membuka Akses ke Parent/Boot ClassLoader

Boot delegation memungkinkan package tertentu didelegasikan ke boot/parent classloader.

Contoh konfigurasi framework tertentu:

```text
org.osgi.framework.bootdelegation=sun.*,com.sun.*
```

Atau lebih luas:

```text
org.osgi.framework.bootdelegation=*
```

Yang terakhir biasanya sangat buruk.

### Kenapa boot delegation ada?

Beberapa library lama mengasumsikan class tertentu berada di boot classpath atau system classloader. Contoh historis:

- JDK internal APIs,
- XML parser lama,
- JAXP behavior,
- instrumentation/profiling agents,
- native integration,
- legacy application server integration.

### Kenapa berbahaya?

Boot delegation bisa membuat class terlihat tanpa import yang eksplisit. Ini melemahkan modularity OSGi dan dapat menyebabkan environment-specific behavior.

Di Java 9+, strong encapsulation juga membuat banyak akses internal JDK tidak lagi sekadar masalah class loading. Mungkin perlu `--add-opens` atau `--add-exports`, dan kadang tidak mungkin lagi tanpa mengganti library.

Rule:

```text
Boot delegation should be surgical, documented, and treated as technical debt.
```

---

## 22. System Packages: Apa yang Disediakan Framework

OSGi framework mengekspos package tertentu sebagai system packages. Ini mencakup package Java standar dan package framework seperti `org.osgi.framework`.

Konfigurasi system package menentukan package apa yang dianggap tersedia dari framework/system bundle.

Contoh konsep:

```text
org.osgi.framework.system.packages.extra=\
  javax.crypto,\
  javax.net.ssl
```

Namun pada framework modern, package Java standar biasanya sudah dikelola sesuai execution environment.

Kesalahan umum:

- mengira semua JDK package otomatis visible,
- mengira package dari application server otomatis visible,
- mengandalkan `system.packages.extra` untuk library application,
- memasukkan terlalu banyak package external sebagai system package.

Rule:

```text
Application libraries should usually be bundles, not system packages.
```

System package cocok untuk package yang benar-benar disediakan runtime platform, bukan dependency bisnis.

---

## 23. Fragments dan Class Loading

Fragment bundle tidak punya lifecycle independen seperti bundle biasa. Fragment attach ke host bundle dan berkontribusi class/resource ke host class space.

Contoh:

```text
Fragment-Host: com.acme.report.engine
```

Host:

```text
Bundle: com.acme.report.engine
```

Setelah fragment attached:

```text
Host Bundle Class Space
 ├── host classes/resources
 └── fragment classes/resources
```

Kegunaan fragment:

- localization resource,
- platform-specific native library,
- test fragment,
- patch resource,
- optional extension untuk host tertentu.

Bahaya fragment:

- coupling sangat kuat ke host,
- fragment tidak punya service lifecycle sendiri,
- class/resource collision,
- debugging lebih sulit,
- bisa dipakai untuk bypass boundary secara tidak sehat.

Rule:

```text
Use fragments for host augmentation, not normal modular dependency.
```

---

## 24. Thread Context ClassLoader / TCCL

Java punya konsep `Thread.currentThread().getContextClassLoader()`.

Banyak library memakai TCCL untuk load class/resource, misalnya:

- JAXP,
- JAXB,
- JNDI,
- ServiceLoader,
- logging bridge,
- scripting engine,
- JSON/XML mapper extension,
- annotation scanner,
- ORM provider,
- template engine,
- dependency injection container.

Di classpath biasa, TCCL sering menunjuk application classloader yang bisa melihat semuanya. Di OSGi, tidak ada “application classloader yang melihat semuanya”.

Masalah:

```java
ServiceLoader.load(MyProvider.class)
```

Mungkin memakai TCCL. Jika TCCL bukan bundle classloader yang tepat, provider tidak ditemukan.

### 24.1 TCCL bridging

Kadang perlu temporarily set TCCL:

```java
ClassLoader old = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(this.getClass().getClassLoader());
    legacyLibrary.initialize();
} finally {
    Thread.currentThread().setContextClassLoader(old);
}
```

Ini boleh dilakukan, tetapi harus sangat hati-hati.

Risiko:

- lupa restore TCCL,
- leak ke thread pool,
- library async memakai TCCL lama,
- classloader leak setelah bundle update,
- behavior berbeda antar thread.

Rule:

```text
TCCL bridge is an integration adapter, not a general architecture pattern.
Always restore it. Never let it leak into pooled threads.
```

---

## 25. Reflection di OSGi

Reflection sering bermasalah karena library mencoba mencari class tanpa dependency eksplisit.

Contoh:

```java
Class<?> clazz = Class.forName("com.acme.plugin.PluginImpl");
```

`Class.forName` tanpa classloader explicit memakai caller classloader atau bootstrap behavior tertentu. Dalam OSGi, caller classloader mungkin tidak melihat target package.

Lebih baik:

```java
Class<?> clazz = bundle.loadClass("com.acme.plugin.PluginImpl");
```

Atau:

```java
Class<?> clazz = myKnownApiType.getClassLoader().loadClass(name);
```

Namun desain yang lebih OSGi-native biasanya bukan load implementation class by name, melainkan:

```text
Implementation bundle registers service.
Consumer binds service by interface.
```

Reflection tetap diperlukan untuk:

- serialization framework,
- annotation scanning,
- ORM,
- JSON mapper,
- template engine,
- plugin descriptor,
- scripting,
- command framework.

Tetapi boundary harus jelas:

```text
Who owns the classloader used for reflection?
Which packages must be visible?
Are reflected types API, SPI, or private implementation?
```

---

## 26. Annotation Scanning: Kenapa Banyak Framework Non-OSGi Bermasalah

Framework modern sering scan classpath:

```text
Find all classes annotated with @Controller
Find all classes annotated with @Entity
Find all classes annotated with @Component
Find all META-INF/services entries
Find all resources under classpath*:META-INF/...
```

Dalam OSGi tidak ada satu classpath global.

Pertanyaan yang harus dijawab:

```text
Scan bundle mana?
Scan resource mana?
Dengan classloader siapa?
Apakah scanner punya permission/visibility?
Apakah scanning dilakukan saat bundle installed, resolved, started, atau updated?
Apa yang terjadi saat bundle di-uninstall?
```

OSGi-native approach biasanya memakai extender pattern:

1. Bundle memasang metadata di manifest, XML, atau annotation-generated descriptor.
2. Extender mendeteksi bundle.
3. Extender memproses resource bundle tersebut.
4. Extender register service/component/endpoint.
5. Saat bundle stop/uninstall, extender unregister hasilnya.

Declarative Services adalah contoh extender yang sangat penting.

Rule:

```text
Classpath scanning should become bundle-scoped scanning.
Runtime discovery should have lifecycle cleanup.
```

---

## 27. `ServiceLoader` vs OSGi Service Registry

Java `ServiceLoader` mencari provider dari file:

```text
META-INF/services/com.acme.spi.PaymentProvider
```

Di classpath biasa, ini bekerja karena classpath global. Di OSGi, provider file mungkin berada di bundle lain yang tidak visible.

Masalah:

- TCCL tidak tepat,
- provider class tidak importable,
- service descriptor tidak terlihat,
- provider lifecycle tidak dynamic,
- provider tidak otomatis hilang saat bundle stop.

OSGi-native alternative:

```java
@Component(service = PaymentProvider.class)
public class StripePaymentProvider implements PaymentProvider {
}
```

Consumer:

```java
@Component
public class PaymentRouter {
    @Reference(cardinality = ReferenceCardinality.MULTIPLE)
    volatile List<PaymentProvider> providers;
}
```

Keuntungan:

- dynamic bind/unbind,
- service properties,
- ranking,
- filter,
- lifecycle-aware,
- diagnostics via service registry.

Namun kadang kamu harus integrate dengan library yang memakai `ServiceLoader`. Strategi:

1. pakai library versi OSGi-aware,
2. bridge OSGi service ke `ServiceLoader` bila library mendukung custom loader,
3. set TCCL terbatas,
4. package provider dalam bundle yang sama,
5. gunakan extender/adapter.

Rule:

```text
Inside OSGi applications, prefer OSGi service registry over ServiceLoader for runtime extension.
```

---

## 28. Resource Loading di OSGi

Class loading bukan hanya `.class`. Banyak library load resource:

```java
getClass().getResource("/templates/email.ftl")
classLoader.getResource("META-INF/spring.factories")
bundle.getEntry("/OSGI-INF/component.xml")
```

Dalam OSGi, resource lookup juga mengikuti boundary.

Perbedaan penting:

```java
bundle.getEntry(path)
```

mencari entry di bundle sendiri dan fragment attached, bukan menggunakan full class loading search seperti classloader.

```java
classLoader.getResource(path)
```

mencari berdasarkan classloader visibility.

Masalah umum:

- resource ada di bundle lain tetapi tidak visible,
- resource ada di embedded JAR tetapi `Bundle-ClassPath` tidak benar,
- scanner mengharapkan semua `META-INF/services` terlihat,
- template engine memakai TCCL yang salah,
- fragment resource override tidak dipahami.

Rule:

```text
Put resource near the bundle that owns it.
Do not rely on global resource scanning unless explicitly implemented by an extender.
```

---

## 29. Proxies dan Bytecode Generation

Banyak library membuat class runtime:

- JDK dynamic proxy,
- CGLIB,
- ByteBuddy,
- ASM,
- Hibernate proxy,
- CDI/Spring proxy,
- Mockito mock,
- annotation processor generated classes.

Dalam OSGi, generated class harus didefinisikan dalam classloader yang bisa melihat semua type pada proxy signature.

Contoh:

```java
Proxy.newProxyInstance(
    someClassLoader,
    new Class<?>[] { PaymentService.class },
    handler
)
```

Jika `someClassLoader` tidak bisa melihat `PaymentService`, gagal.

Jika proxy mengimplementasikan interface dari bundle API, classloader proxy harus compatible dengan API interface.

Rule:

```text
The proxy-defining classloader must see every interface/superclass used by the generated type.
```

Untuk OSGi service proxy, framework/extender biasanya mengurus ini. Untuk library custom, kamu harus explicit.

---

## 30. Serialization dan ClassLoader Boundary

Java serialization, JSON polymorphic deserialization, XML binding, Kryo, Avro, Protobuf dynamic schema, dan message converters sering butuh load class by name.

Masalah:

```text
Serialized payload contains class name com.acme.order.internal.OrderEntity
Consumer bundle cannot load that class.
```

Atau lebih buruk:

```text
Consumer can load same FQCN from different classloader -> ClassCastException.
```

Rule desain:

```text
Do not serialize private implementation classes across bundle boundaries.
```

Gunakan:

- API DTO,
- schema-first message,
- stable event contract,
- plain data format,
- versioned contract package,
- explicit mapper at boundary.

OSGi memaksa disiplin yang sebenarnya juga baik untuk microservices dan long-lived enterprise systems.

---

## 31. JDBC Driver Loading

JDBC historically memakai `DriverManager` dan static registration.

Di classpath biasa:

```java
DriverManager.getConnection(url, user, pass)
```

Driver bisa ditemukan lewat service provider atau static initializer.

Dalam OSGi:

- driver bundle mungkin tidak visible ke caller,
- `DriverManager` berada di JDK/system side,
- provider discovery via `META-INF/services` bisa gagal,
- driver classloader bisa tidak cocok.

OSGi-friendly approach:

```text
Register DataSource or Driver as OSGi service.
Consumer depends on DataSource service, not DriverManager global lookup.
```

Atau gunakan OSGi JDBC service/provider yang sesuai.

Rule:

```text
For OSGi, prefer service-managed DataSource over global DriverManager lookup.
```

---

## 32. Logging dan Class Loading

Logging tampak sederhana, tetapi di OSGi bisa menimbulkan konflik:

- SLF4J API vs binding,
- Logback bundle,
- Log4j2 bundle,
- JUL bridge,
- commons-logging bridge,
- multiple bindings,
- TCCL usage,
- fragment/resource config.

Prinsip:

```text
Logging API package should be consistently wired.
Logging backend should be runtime infrastructure, not embedded randomly in each bundle.
```

Jangan embed SLF4J API berbeda di banyak bundle jika API object/logging bridge melewati boundary. Gunakan shared logging API bundle dan satu backend strategy.

---

## 33. XML, JAXB, JAXP, dan Java 8–25

Java 8 masih memiliki beberapa Java EE-related APIs di JDK. Setelah Java 9/11, banyak modul Java EE/CORBA dihapus atau tidak lagi tersedia default.

Dampak untuk OSGi:

- bundle lama mengira `javax.xml.bind` tersedia dari JDK,
- activation/mail/JAXB harus disediakan sebagai bundle,
- JAXP provider discovery dapat memakai TCCL,
- XML parser provider bisa konflik,
- package `javax.*` vs `jakarta.*` transition harus jelas.

Rule:

```text
Do not assume Java 8 platform packages exist on Java 11+.
Make removed APIs explicit bundles or migrate to jakarta.* where appropriate.
```

Untuk Java 17/21/25, reflective access ke JDK internal semakin ketat. Banyak library lama butuh upgrade.

---

## 34. Java 8 sampai Java 25: Class Loading Consequences

### 34.1 Java 8

Ciri:

- classpath model dominan,
- Java EE APIs tertentu masih tersedia di JDK,
- reflective access ke internal JDK sering masih “jalan”,
- banyak OSGi legacy app berasal dari era ini.

Risiko:

- library lama mengandalkan `sun.misc.*`,
- JAXB/JAX-WS dependency tidak explicit,
- old bytecode libraries.

### 34.2 Java 9–11

Ciri:

- JPMS hadir,
- modular JDK,
- illegal reflective access warning,
- Java EE/CORBA modules deprecated/removed,
- classpath tetap ada tetapi platform berubah.

Risiko:

- package yang dulu dari JDK hilang,
- framework perlu `--add-opens`,
- old bytecode scanning gagal.

### 34.3 Java 17

Ciri:

- LTS besar untuk enterprise,
- strong encapsulation lebih nyata,
- Security Manager deprecated for removal,
- banyak ecosystem upgrade.

Risiko:

- OSGi security model lama yang mengandalkan Security Manager perlu ditinjau,
- reflection-heavy framework harus modern.

### 34.4 Java 21

Ciri:

- LTS,
- virtual threads final,
- banyak runtime modernization.

Classloading impact langsung virtual threads tidak besar, tetapi TCCL pada thread creation tetap harus dipahami. Jika membuat thread/virtual thread dari bundle, jangan membocorkan classloader bundle lama setelah update.

### 34.5 Java 25

Ciri:

- generasi JDK modern setelah Java 21,
- ecosystem makin jauh dari asumsi Java 8,
- old OSGi systems perlu dependency audit lebih serius.

Strategi:

```text
For Java 8 -> 25 OSGi systems:
  1. Upgrade framework first in isolated environment.
  2. Audit bytecode level of every bundle.
  3. Audit javax/jakarta/JDK removed packages.
  4. Audit reflection and --add-opens requirements.
  5. Replace old bytecode libraries.
  6. Run resolver tests per JDK target.
  7. Run runtime smoke test with classloading diagnostics enabled.
```

---

## 35. Library Compatibility: OSGi-Ready vs OSGi-Hostile

Tidak semua Java library sama mudahnya dipakai di OSGi.

### 35.1 OSGi-friendly library

Ciri:

- punya manifest OSGi valid,
- export package dengan version,
- import dependency dengan range masuk akal,
- tidak mengandalkan global classpath,
- tidak scan classpath sembarangan,
- tidak memakai static singleton global yang sulit di-reset,
- menyediakan integration point via service atau explicit classloader.

### 35.2 OSGi-hostile library

Ciri:

- hard-coded `Class.forName`,
- memakai TCCL tanpa kontrol,
- scan semua classpath,
- mengharapkan semua dependency visible,
- menyimpan classloader di static field,
- membuat thread pool sendiri dan tidak shutdown,
- memakai internal JDK API,
- menyembunyikan dependency transitif,
- tidak bisa dikonfigurasi classloader-nya.

### 35.3 Strategi menghadapi library non-OSGi

Pilihan:

1. cari versi yang sudah OSGi-ready,
2. wrap library menjadi bundle,
3. embed sebagai private dependency,
4. buat adapter bundle,
5. isolate di service boundary,
6. jalankan di process terpisah jika terlalu hostile,
7. ganti library.

Decision rule:

```text
If the library leaks its types across bundle boundaries, make it shared and consistently wired.
If the library is pure implementation detail, embed or hide it.
If the library assumes global classpath and cannot be controlled, isolate it behind adapter or external process.
```

---

## 36. Wrapping Non-OSGi JAR

Misalnya kamu punya library biasa:

```text
legacy-parser-1.0.jar
```

Ia tidak punya OSGi manifest. Kamu bisa wrap menjadi bundle:

```text
Bundle-SymbolicName: com.acme.thirdparty.legacy-parser
Bundle-Version: 1.0.0
Export-Package: com.legacy.parser.api;version="1.0.0"
Private-Package: com.legacy.parser.internal.*
Import-Package: *
```

Namun wrapping bukan sekadar menambah manifest. Harus dipahami:

- package mana API,
- package mana internal,
- dependency transitif apa,
- apakah library melakukan classpath scanning,
- apakah butuh TCCL,
- apakah thread-safe,
- apakah menyimpan static classloader,
- apakah type-nya bocor ke bundle lain.

Checklist wrapping:

```text
[ ] Identify public packages.
[ ] Identify internal packages.
[ ] Identify transitive dependencies.
[ ] Check META-INF/services usage.
[ ] Check reflection/Class.forName usage.
[ ] Check resource loading.
[ ] Check bytecode version.
[ ] Check Java 8/11/17/21/25 compatibility.
[ ] Run in-framework test.
[ ] Verify no unwanted exports.
```

---

## 37. Embedded vs Shared Dependency Decision Matrix

| Pertanyaan | Jika Ya | Jika Tidak |
|---|---|---|
| Type dependency muncul di exported API? | Shared bundle/import | Bisa embedded |
| Dependency punya global singleton? | Shared atau isolate carefully | Embedded aman |
| Banyak bundle butuh versi sama? | Shared | Embedded boleh |
| Bundle berbeda butuh versi berbeda? | Isolate via embedded/private atau versioned providers | Shared sederhana |
| Dependency register service/provider global? | Shared/service-managed | Embedded jika private |
| Dependency besar dan mahal memory? | Shared | Embedded mungkin boros |
| Dependency sering upgrade sendiri? | Shared dengan version policy | Embedded jika private implementation |
| Dependency OSGi-hostile? | Adapter/isolate | Shared jika OSGi-ready |

Rule ringkas:

```text
Share API and infrastructure.
Hide implementation helpers.
Never leak hidden helper types across bundle boundaries.
```

---

## 38. Practical Example: Dua Versi Library dalam Satu Runtime

Misal:

```text
Bundle report-v1 needs TemplateLib 1.x
Bundle report-v2 needs TemplateLib 2.x
```

Di classpath biasa, ini sulit jika package name sama. Di OSGi, ada beberapa strategi.

### Strategi A: Dua provider export package dengan version berbeda

```text
templatelib-v1 exports com.template;version=1.8.0
templatelib-v2 exports com.template;version=2.3.0
```

Consumer:

```text
report-v1 imports com.template;version="[1.0,2.0)"
report-v2 imports com.template;version="[2.0,3.0)"
```

Bisa jalan jika package API compatible dan resolver tidak kena `uses` conflict.

### Strategi B: Embed private copy

```text
report-v1 embeds templatelib 1.x
report-v2 embeds templatelib 2.x
```

Aman jika `com.template.*` tidak bocor ke API.

### Strategi C: Shade/relocate

```text
report-v1 uses com.acme.shadow.templatelib1
report-v2 uses com.acme.shadow.templatelib2
```

Ini menghindari package conflict, tetapi menambah build complexity.

### Strategi D: Externalize

Jika library sangat kompleks dan stateful, jalankan fungsi sebagai service external.

Rule:

```text
Multiple versions are possible in OSGi, but only safe if boundary types are controlled.
```

---

## 39. Debugging Playbook: Bundle Resolved tapi Class Tidak Ditemukan

Kasus:

```text
Bundle state: ACTIVE
Error: ClassNotFoundException: com.acme.foo.Bar
```

Langkah debug:

### Step 1 — Pastikan package class

```text
Class: com.acme.foo.Bar
Package: com.acme.foo
```

OSGi import/export berdasarkan package, bukan class.

### Step 2 — Cari owner package

Di shell Felix/Karaf/Equinox/bnd, cari bundle yang export package:

```text
packages com.acme.foo
```

atau command equivalent.

Pertanyaan:

```text
Ada bundle yang export com.acme.foo?
Version berapa?
```

### Step 3 — Cek import consumer

Manifest consumer:

```text
Import-Package: com.acme.foo;version="[x,y)"
```

Apakah ada? Apakah range cocok?

### Step 4 — Cek wiring

Consumer resolved ke exporter mana?

```text
Consumer -> com.acme.foo -> Provider?
```

Jika tidak wired, import mungkin optional atau class di-load secara reflective tanpa import.

### Step 5 — Cek class benar-benar ada di provider

Provider mungkin export package tetapi class tidak ada karena build salah.

### Step 6 — Cek TCCL/reflection

Jika error dari library, classloader yang dipakai mungkin bukan bundle consumer.

### Step 7 — Cek embedded JAR dan Bundle-ClassPath

Jika class ada dalam `lib/*.jar`, pastikan `Bundle-ClassPath` mencakupnya.

### Step 8 — Cek fragment

Jika class dari fragment, pastikan fragment attached ke host compatible.

### Step 9 — Cek Java version

Jika class bytecode lebih tinggi dari runtime JDK, error bisa tampak berbeda (`UnsupportedClassVersionError`).

---

## 40. Debugging Playbook: `ClassCastException` dengan Class yang Tampak Sama

Kasus:

```text
java.lang.ClassCastException:
  com.acme.api.Customer cannot be cast to com.acme.api.Customer
```

Ini hampir selalu classloader identity issue.

Langkah:

### Step 1 — Print classloader

```java
System.out.println(obj.getClass());
System.out.println(obj.getClass().getClassLoader());
System.out.println(Customer.class.getClassLoader());
```

Jika berbeda, root cause ditemukan.

### Step 2 — Cari package owner

```text
com.acme.api exported by bundle mana saja?
```

### Step 3 — Cek duplicate API package

Mungkin API package:

- embedded di provider,
- embedded di consumer,
- juga tersedia sebagai API bundle.

### Step 4 — Pakai shared API bundle

Pattern benar:

```text
customer-api bundle exports com.acme.customer.api
customer-impl imports com.acme.customer.api
consumer imports com.acme.customer.api
```

Jangan:

```text
customer-impl embeds api copy
consumer embeds api copy
```

### Step 5 — Cek `uses` directive

Pastikan API package export punya `uses` directive untuk package type yang muncul di signature.

---

## 41. Debugging Playbook: `uses constraint violation`

Kasus:

```text
Uses constraint violation. Unable to resolve bundle.
```

Mental model:

```text
Resolver mencegah runtime melihat dua versi/type provider yang tidak konsisten.
```

Langkah:

1. Temukan package yang disebut di error.
2. Temukan exporter kandidat.
3. Temukan consumer yang import package tersebut.
4. Temukan package lain yang `uses` package itu.
5. Gambarkan graph.

Contoh:

```text
Bundle A exports com.acme.report.api;uses:=com.acme.document.api
Bundle B imports com.acme.report.api from A
Bundle B imports com.acme.document.api from D2
Bundle A imports com.acme.document.api from D1
```

Jika D1 != D2, resolver menolak.

Solusi:

- align version range,
- pastikan semua bundle wired ke provider yang sama,
- pisahkan API agar tidak expose conflicting type,
- hindari duplicate exports,
- perbaiki embedded API copy,
- perketat atau longgarkan range secara benar.

---

## 42. Debugging Playbook: Library Tidak Menemukan Provider `META-INF/services`

Kasus:

```text
ServiceConfigurationError: Provider not found
```

Langkah:

1. Cari apakah provider file ada:

```text
META-INF/services/com.acme.spi.Provider
```

2. Bundle mana yang memilikinya?
3. Library memakai classloader apa untuk `ServiceLoader`?
4. Apakah TCCL melihat provider bundle?
5. Apakah provider class package diekspor/imported?
6. Apakah lebih baik provider dijadikan OSGi service?

Solusi ideal:

```text
Replace ServiceLoader provider discovery with OSGi service registration.
```

Solusi sementara:

```text
Set TCCL around initialization or bundle provider in same class space.
```

---

## 43. Debugging Playbook: Annotation Scanner Tidak Menemukan Class

Kasus:

```text
Framework says: no annotated classes found
```

Langkah:

1. Scanner scan classpath global atau bundle-scoped?
2. Scanner dijalankan dari bundle mana?
3. Resource path benar?
4. Annotation package visible?
5. Target class package visible?
6. Bundle sudah STARTED atau baru RESOLVED?
7. Jika bundle updated, scanner membersihkan metadata lama tidak?

Solusi:

- gunakan OSGi extender,
- generate descriptor saat build,
- hindari runtime scan luas,
- register service explicit,
- gunakan Whiteboard/DS pattern.

---

## 44. Anti-Pattern Class Loading

### 44.1 Export everything

```text
Export-Package: *
```

Akibat:

- internal bocor,
- refactoring sulit,
- versioning kacau,
- consumer bergantung ke implementation.

### 44.2 DynamicImport everything

```text
DynamicImport-Package: *
```

Akibat:

- dependency graph tidak deterministic,
- resolver tidak bisa melindungi,
- runtime error lebih telat.

### 44.3 Embed API everywhere

Akibat:

- ClassCastException,
- duplicate API identity,
- service contract rusak.

### 44.4 Require-Bundle everywhere

Akibat:

- coupling ke packaging,
- refactor bundle sulit,
- dependency terlalu kasar.

### 44.5 Static classloader cache

Contoh buruk:

```java
static final ClassLoader LOADER = SomeClass.class.getClassLoader();
```

Jika bundle update/refresh, classloader lama bisa tertahan dan leak.

### 44.6 Thread pool without cleanup

Thread yang dibuat bundle menyimpan TCCL bundle classloader. Jika bundle stop tetapi thread hidup, classloader tidak bisa GC.

Rule:

```text
Every bundle that creates threads must stop them.
Every TCCL change must be restored.
Every tracker/listener must be closed.
```

---

## 45. Design Pattern: API Bundle + Implementation Bundle

Struktur:

```text
com.acme.payment.api
  exports com.acme.payment.api

com.acme.payment.stripe
  imports com.acme.payment.api
  imports stripe/private deps as needed
  registers PaymentProvider service

com.acme.payment.router
  imports com.acme.payment.api
  binds PaymentProvider services
```

API:

```java
package com.acme.payment.api;

public interface PaymentProvider {
    PaymentResult authorize(PaymentRequest request);
}
```

Implementation:

```java
@Component(service = PaymentProvider.class, property = "provider=stripe")
public final class StripePaymentProvider implements PaymentProvider {
    @Override
    public PaymentResult authorize(PaymentRequest request) {
        // Stripe SDK stays private here
    }
}
```

Consumer:

```java
@Component
public final class PaymentRouter {
    @Reference(cardinality = ReferenceCardinality.MULTIPLE)
    private volatile List<PaymentProvider> providers;
}
```

Manfaat:

- API class identity shared,
- implementation hidden,
- provider dynamic,
- dependency library private,
- replacement possible,
- testability lebih baik.

---

## 46. Design Pattern: Adapter Bundle untuk Library Hostile

Misal `LegacyPdfEngine` sulit dipakai di OSGi.

Buat adapter:

```text
com.acme.pdf.api
  exports stable API

com.acme.pdf.legacy-adapter
  embeds legacy-pdf-engine.jar
  imports com.acme.pdf.api
  exports nothing except maybe service registration
```

API:

```java
public interface PdfRenderer {
    byte[] render(PdfRequest request);
}
```

Adapter:

```java
@Component(service = PdfRenderer.class)
public final class LegacyPdfRenderer implements PdfRenderer {
    @Override
    public byte[] render(PdfRequest request) {
        ClassLoader old = Thread.currentThread().getContextClassLoader();
        try {
            Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
            return legacyRender(request);
        } finally {
            Thread.currentThread().setContextClassLoader(old);
        }
    }
}
```

Boundary:

```text
Legacy types never leave the adapter.
```

Ini membuat kerusakan library terkandung.

---

## 47. Design Pattern: Capability-Based Class Visibility

Alih-alih consumer mengetahui bundle spesifik, gunakan capability.

Provider:

```text
Provide-Capability: com.acme.renderer;engine=pdf;version:Version="1.0.0"
```

Consumer:

```text
Require-Capability: com.acme.renderer;filter:="(&(engine=pdf)(version>=1.0.0))"
```

Ini bukan class loading langsung, tetapi resolver-level constraint. Berguna untuk menyatakan runtime requirement non-package.

Contoh:

- requires database profile,
- requires scripting engine,
- requires FIPS crypto provider,
- requires connector capability,
- requires feature flag runtime.

Class loading tetap lewat import/export/service, tetapi capability memberi semantic constraint.

---

## 48. Production Concern: Bundle Refresh dan ClassLoader Leak

Saat bundle di-update, framework bisa membuat classloader baru. Classloader lama harus bisa di-GC. Tetapi ia tidak bisa hilang jika masih direferensikan.

Penyebab leak:

- static field di bundle lain menyimpan object lama,
- service object lama masih dipakai,
- thread pool belum shutdown,
- TCCL thread masih classloader lama,
- listener/tracker belum unregister,
- cache global menyimpan `Class<?>`, `Method`, `Constructor`, annotation metadata,
- logging MDC/ThreadLocal,
- timer task,
- JDBC driver registration,
- JMX MBean tidak unregister.

Checklist stop/deactivate:

```text
[ ] Unregister services.
[ ] Close ServiceTracker.
[ ] Remove listeners.
[ ] Stop executor/thread pool.
[ ] Cancel timers.
[ ] Clear ThreadLocal.
[ ] Restore TCCL.
[ ] Close classloader-sensitive resources.
[ ] Unregister JMX/MBeans.
[ ] Deregister JDBC drivers if manually registered.
[ ] Clear static caches where applicable.
```

Rule:

```text
In OSGi, lifecycle cleanup is classloader cleanup.
```

---

## 49. Production Concern: Hot Deployment Bukan Sekadar Replace JAR

Jika bundle di-update:

```text
old bundle revision -> new bundle revision
```

Consumer yang wired ke old export mungkin tetap memakai old revision sampai refresh. Refresh dapat berdampak ke dependent bundles.

Pertanyaan operasional:

- Apakah update hanya implementation bundle?
- Apakah exported API berubah?
- Apakah dependent bundle harus refresh?
- Apakah service akan unregister/register ulang?
- Apakah in-flight call aman?
- Apakah component activation idempotent?
- Apakah config compatible?
- Apakah classloader lama leak?

Hot deploy aman hanya jika desain lifecycle dan compatibility matang.

Rule:

```text
Hot deployment is an operational protocol, not a magic feature.
```

---

## 50. OSGi Class Loading dan Microservices Analogy

OSGi classloader boundary mirip service boundary dalam microservices, tetapi lebih ketat di type identity.

Microservices:

```text
Service A and B communicate via JSON/HTTP.
Each process has separate dependency graph.
```

OSGi:

```text
Bundle A and B communicate via Java interface/service.
Each bundle has separate class visibility graph.
```

Karena komunikasi OSGi masih in-process Java object, type identity jauh lebih penting.

Jika API package duplicate, object tidak bisa cast. Dalam microservices, JSON tidak punya classloader. Dalam OSGi, Java object punya classloader identity.

Pelajaran:

```text
OSGi gives modular isolation without process boundary, but that means type contracts must be engineered with more precision.
```

---

## 51. Practical Heuristics untuk Top 1% Engineer

### 51.1 Jangan tanya “JAR ini ada?” dulu

Tanya:

```text
Package ini owner-nya siapa?
Diekspor dengan versi berapa?
Consumer import range-nya apa?
Wiring-nya ke exporter mana?
Type ini crossing boundary tidak?
```

### 51.2 Semua exported package adalah public promise

Jika package diekspor, anggap consumer boleh compile terhadapnya. Maka package itu perlu:

- semantic version,
- backward compatibility policy,
- baseline check,
- deprecation strategy,
- test compatibility.

### 51.3 Implementation dependency tidak boleh bocor

Jika kamu embed library, pastikan type-nya tidak muncul di exported API, service interface, event DTO, config object, exception public, atau annotation public.

### 51.4 Gunakan service registry untuk dynamic extension

Jangan load implementation class by name jika tujuannya plugin/service discovery. Biarkan implementation register service.

### 51.5 Treat TCCL as hazardous material

TCCL boleh dipakai untuk integrasi legacy, tetapi harus:

- local,
- restored,
- documented,
- tested,
- tidak bocor ke thread pool.

### 51.6 Resolver error adalah proteksi, bukan gangguan

Jika resolver menolak wiring, sering ia mencegah runtime ClassCastException yang lebih buruk.

### 51.7 Satu package, satu owner

Split package hampir selalu tanda desain boundary buruk.

---

## 52. Checklist Desain Bundle dari Perspektif Class Loading

Gunakan checklist ini saat review PR bundle baru.

```text
[ ] Package API dipisahkan dari implementation.
[ ] Export-Package hanya untuk package yang memang public contract.
[ ] Semua exported package punya version.
[ ] Import-Package range masuk akal.
[ ] Tidak ada DynamicImport-Package:*.
[ ] Tidak ada Require-Bundle kecuali ada alasan eksplisit.
[ ] Tidak ada split package.
[ ] API tidak expose implementation library type.
[ ] Embedded dependency tidak bocor ke service/API/event.
[ ] Library reflection-heavy diuji dalam framework.
[ ] ServiceLoader usage dipahami atau diganti OSGi service.
[ ] TCCL bridge, jika ada, restore di finally.
[ ] Thread/executor dibuat bundle akan ditutup saat deactivate.
[ ] Resource loading bundle-scoped dan deterministic.
[ ] Java target bytecode sesuai runtime target.
[ ] Java 8/11/17/21/25 compatibility dicek untuk dependency.
[ ] Resolver test tersedia untuk runtime distribution.
```

---

## 53. Class Loading Diagnostic Questions

Saat ada incident, gunakan pertanyaan ini:

### Untuk `ClassNotFoundException`

```text
1. Class package-nya apa?
2. Package itu diekspor oleh bundle mana?
3. Consumer import package itu tidak?
4. Version range cocok tidak?
5. Bundle consumer wired ke provider mana?
6. Lookup memakai classloader siapa?
7. Apakah error terjadi via reflection/TCCL/ServiceLoader?
8. Apakah class ada di embedded JAR tapi Bundle-ClassPath salah?
9. Apakah package optional import tidak wired?
```

### Untuk `ClassCastException`

```text
1. Print classloader object actual dan target.
2. Apakah API package duplicated?
3. Apakah provider dan consumer import API dari bundle yang sama?
4. Apakah API embedded di implementation bundle?
5. Apakah uses constraint hilang/salah?
```

### Untuk resolver failure

```text
1. Requirement mana yang tidak satisfied?
2. Capability provider kandidat apa saja?
3. Version range menolak provider atau tidak?
4. Mandatory attributes cocok tidak?
5. uses constraint conflict di mana?
6. Ada duplicate export package?
7. Ada split package/self-import yang tidak disengaja?
```

---

## 54. Mini Case Study: Enforcement Rule Plugin Runtime

Bayangkan sistem case management regulatory memiliki plugin rule:

```text
case-core-api
case-core-impl
rule-api
rule-engine
rule-plugin-license-check
rule-plugin-risk-score
rule-plugin-escalation
```

### API bundle

```text
Bundle: com.acme.case.api
Export-Package:
  com.acme.case.api;version="1.0.0"
```

```java
public interface CaseRecord {
    String caseId();
    String status();
}
```

### Rule API

```text
Bundle: com.acme.rule.api
Export-Package:
  com.acme.rule.api;version="1.0.0";uses:="com.acme.case.api"
Import-Package:
  com.acme.case.api;version="[1.0,2.0)"
```

```java
public interface CaseRule {
    RuleResult evaluate(CaseRecord record);
}
```

### Plugin bundle

```text
Bundle: com.acme.rule.plugin.risk-score
Import-Package:
  com.acme.rule.api;version="[1.0,2.0)",
  com.acme.case.api;version="[1.0,2.0)",
  *
```

Implementation:

```java
@Component(service = CaseRule.class, property = "rule=risk-score")
public final class RiskScoreRule implements CaseRule {
    @Override
    public RuleResult evaluate(CaseRecord record) {
        // internal model/scoring library stays private
    }
}
```

### Rule engine

```java
@Component
public final class RuleEngine {
    @Reference(cardinality = ReferenceCardinality.MULTIPLE, policy = ReferencePolicy.DYNAMIC)
    private volatile List<CaseRule> rules;
}
```

### Kenapa desain ini sehat?

- `CaseRecord` berasal dari API bundle yang sama untuk semua pihak.
- Rule plugins tidak expose scoring library internal.
- Rule engine tidak load plugin class by name.
- Plugin bisa datang/pergi sebagai service.
- `uses:=com.acme.case.api` menjaga consistency type.
- Version range memberi ruang upgrade minor.

### Apa yang buruk?

Jika plugin API seperti ini:

```java
public interface CaseRule {
    com.acme.case.impl.JpaCaseEntity evaluate(com.acme.case.impl.JpaCaseEntity entity);
}
```

Maka implementation detail persistence bocor ke plugin. Itu melanggar modularity, membuat classloading rapuh, dan mengunci rule plugin ke internal persistence model.

---

## 55. Mental Model Final

OSGi class loading bukan hambatan tambahan. Ia adalah mekanisme untuk membuat dependency nyata terlihat.

Classpath biasa sering membuat sistem tampak jalan karena semua class terlihat. Tetapi visibility global menyembunyikan coupling. OSGi memaksa kamu menyatakan:

```text
Apa API publik?
Siapa owner package?
Versi contract berapa?
Consumer boleh melihat apa?
Implementation dependency boleh bocor tidak?
Apa yang terjadi saat provider berubah?
Apa yang terjadi saat bundle hilang?
```

Engineer biasa menyelesaikan classloading error dengan menambah JAR.

Engineer bagus menyelesaikannya dengan menambah import/export yang benar.

Engineer top-tier bertanya:

```text
Mengapa boundary ini membutuhkan visibility tersebut?
Apakah type ini pantas crossing boundary?
Apakah version range ini menjaga compatibility?
Apakah resolver sedang mencegah desain yang salah?
Apakah library ini harus shared, embedded, adapted, atau isolated?
```

Itulah perbedaan utamanya.

---

## 56. Ringkasan

Poin utama bagian ini:

1. OSGi mengganti classpath global dengan per-bundle visibility.
2. Unit visibility utama adalah package, bukan JAR.
3. Class identity adalah kombinasi classloader dan fully qualified class name.
4. `Import-Package` dan `Export-Package` adalah kontrak runtime, bukan metadata dekoratif.
5. `Require-Bundle` lebih kasar dan sering menciptakan coupling packaging.
6. Embedded dependency aman hanya jika tidak bocor ke boundary.
7. `DynamicImport-Package` dan boot delegation adalah alat khusus, bukan default.
8. TCCL adalah sumber integrasi sekaligus sumber leak.
9. Reflection, annotation scanning, `ServiceLoader`, proxy, ORM, JDBC, XML, logging, dan serialization semua punya konsekuensi classloader.
10. Java 8 sampai 25 menambah dimensi compatibility: removed APIs, JPMS, strong encapsulation, bytecode level, dan library modernization.
11. Debugging OSGi classloading harus dimulai dari package ownership dan wiring graph.
12. Resolver error sering merupakan proteksi terhadap runtime type inconsistency.

---

## 57. Latihan Praktis

### Latihan 1 — Package Ownership Map

Ambil satu aplikasi Java modular. Buat tabel:

| Package | Owner Bundle | Exported? | Version | Consumer | Notes |
|---|---|---:|---|---|---|
| `com.acme.case.api` | `case-api` | yes | 1.0.0 | rule-engine, case-web | stable API |
| `com.acme.case.internal` | `case-impl` | no | - | none | private |

Tujuan: melatih melihat package sebagai unit arsitektur.

### Latihan 2 — API Leak Detection

Cari semua exported interface. Tandai method signature yang memakai type dari library external.

Contoh:

```java
ObjectMapper getMapper();
JsonNode parse(String payload);
JpaEntity getEntity();
HttpServletRequest getRequest();
```

Tentukan apakah type tersebut pantas crossing bundle boundary.

### Latihan 3 — ClassLoader Print

Buat dua bundle yang masing-masing embed class dengan FQCN sama. Print:

```java
obj.getClass().getName()
obj.getClass().getClassLoader()
Target.class.getClassLoader()
```

Amati kenapa nama sama belum tentu type sama.

### Latihan 4 — TCCL Leak Simulation

Buat bundle yang membuat executor dan set TCCL ke bundle classloader. Stop bundle tanpa shutdown executor. Amati classloader leak dengan heap dump.

### Latihan 5 — Optional Import Failure

Buat bundle dengan optional import. Jalankan path code yang mereferensikan class optional saat provider tidak ada. Amati error. Ubah desain menjadi service optional binding.

---

## 58. Preview Part Berikutnya

Part berikutnya adalah:

```text
04-dependency-model-import-export-require-bundle-capabilities.md
```

Kita akan membahas dependency model OSGi secara lebih sistematis:

- `Import-Package`,
- `Export-Package`,
- `Require-Bundle`,
- `Provide-Capability`,
- `Require-Capability`,
- namespaces,
- mandatory attributes,
- optional dependency,
- dependency substitution,
- dan cara mendesain graph dependency yang sehat.

Jika Part 3 fokus pada **bagaimana class terlihat**, Part 4 fokus pada **bagaimana dependency dinyatakan dan dinegosiasikan**.

---

## Referensi

- OSGi Core Release 8 — Module Layer: https://docs.osgi.org/specification/osgi.core/8.0.0/framework.module.html
- OSGi Core Release 8 — Framework API: https://docs.osgi.org/specification/osgi.core/8.0.0/framework.api.html
- OSGi Core Release 8 — Bundle Wiring and Module Layer: https://docs.osgi.org/specification/osgi.core/8.0.0/framework.module.html
- Apache Felix OSGi FAQ: https://felix.apache.org/documentation/tutorials-examples-and-presentations/apache-felix-osgi-faq.html
- Apache Felix OSGi Tutorial: https://felix.apache.org/documentation/tutorials-examples-and-presentations/apache-felix-osgi-tutorial.html
- Eclipse Equinox Boot Delegation: https://equinox.eclipseprojects.io/articles/Boot_Delegation.html
- bnd / Bndtools Documentation: https://bnd.bndtools.org/

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./02-bundle-anatomy-manifest-headers-metadata-build-time-contracts.md">⬅️ Part 2 — Bundle Anatomy: Manifest, Headers, Metadata, and Build-Time Contracts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./04-dependency-model-import-export-require-bundle-capabilities.md">Part 4 — Dependency Model: Import-Package, Export-Package, Require-Bundle, Capabilities ➡️</a>
</div>
