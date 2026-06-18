# 19 — JPMS and OSGi: Java Module System Interop from Java 9 to 25

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> Part: `19 / 35`  
> File: `19-jpms-osgi-java-module-system-interop-java-9-to-25.md`

---

## 0. Tujuan Part Ini

Part ini membahas hubungan antara **OSGi** dan **JPMS** atau **Java Platform Module System** dari Java 9 sampai Java 25.

Kita tidak akan mengulang dasar-dasar Java module system secara umum. Fokusnya adalah konsekuensi arsitektural ketika dua model modularitas hidup dalam ekosistem Java yang sama:

1. OSGi sebagai **dynamic runtime module system**.
2. JPMS sebagai **static launch-time module system**.
3. OSGi bundle berjalan di atas JVM modern yang sudah modular sejak Java 9.
4. Library Java modern mulai menyediakan `module-info.class` atau `Automatic-Module-Name`.
5. Strong encapsulation membuat banyak teknik lama OSGi, reflection, bytecode enhancement, annotation scanning, dan framework integration tidak lagi bebas seperti era Java 8.

Target setelah menyelesaikan part ini:

- Kamu bisa menjelaskan perbedaan fundamental antara OSGi module dan JPMS module.
- Kamu bisa membaca risiko ketika library punya `module-info.class`, tetapi dipakai sebagai OSGi bundle.
- Kamu bisa menentukan kapan menggunakan OSGi, kapan JPMS, kapan keduanya, dan kapan tidak memaksakan keduanya.
- Kamu bisa mendesain library yang ramah untuk OSGi dan JPMS sekaligus.
- Kamu bisa menangani masalah Java 9+ seperti `InaccessibleObjectException`, `--add-opens`, `--add-exports`, split package, service discovery, dan multi-release JAR.
- Kamu bisa membuat strategi upgrade dari Java 8 OSGi runtime ke Java 17/21/25 tanpa hanya trial-and-error.

---

## 1. Problem Besar: Java Punya Dua Model Modularitas

Sebelum Java 9, Java memiliki:

- classpath,
- JAR,
- package,
- classloader,
- visibility berbasis `public`/`protected`/package-private/private,
- tetapi tidak punya sistem modul standar yang kuat di level Java SE.

OSGi muncul jauh sebelum JPMS untuk mengisi celah tersebut. OSGi memberi:

- bundle identity,
- package import/export,
- version range,
- resolver,
- lifecycle,
- dynamic install/update/uninstall,
- service registry,
- runtime composition.

Lalu Java 9 membawa JPMS, yang memberi:

- named module,
- `module-info.java`,
- `requires`,
- `exports`,
- `opens`,
- service declaration via `uses`/`provides`,
- module path,
- strong encapsulation,
- modular JDK image.

Masalahnya: keduanya sama-sama bicara tentang modularitas, tetapi **bukan modularitas yang sama**.

JPMS menjawab pertanyaan:

> “Saat aplikasi diluncurkan, module apa saja yang dibutuhkan, dan package mana yang boleh diakses?”

OSGi menjawab pertanyaan:

> “Saat runtime sedang hidup, bundle apa saja yang tersedia, bagaimana package mereka di-wire, bagaimana lifecycle mereka berubah, dan service apa yang muncul/hilang?”

Ini perbedaan besar. JPMS adalah model **launch-time structural modularity**. OSGi adalah model **runtime dynamic modularity**.

---

## 2. Mental Model Singkat

Bayangkan ada tiga level:

```text
JVM Process
  |
  |-- JPMS Layer / Module Graph
  |      - java.base
  |      - java.logging
  |      - java.sql
  |      - named modules on module-path
  |
  |-- Application Classpath / Unnamed Module
  |      - OSGi framework jar
  |      - framework implementation
  |      - launcher
  |
  |-- OSGi Framework Runtime
         - bundle A
         - bundle B
         - bundle C
         - OSGi service registry
         - bundle classloaders
         - resolver wiring
```

Dalam banyak OSGi deployment modern, OSGi framework sendiri dijalankan dari classpath atau module path, tetapi bundle-bundle OSGi biasanya dikelola oleh OSGi framework melalui bundle classloader, bukan oleh JPMS sebagai named modules.

Artinya:

- JPMS memodulkan JDK dan mungkin launcher/framework.
- OSGi memodulkan aplikasi dinamis di dalam framework.
- `module-info.class` di dalam bundle tidak otomatis membuat bundle menjadi JPMS named module.
- OSGi resolver tidak sama dengan JPMS resolver.
- JPMS readability tidak sama dengan OSGi package wiring.

Top 1% engineer tidak menyederhanakan ini menjadi “OSGi vs JPMS”. Pertanyaannya harus lebih presisi:

> “Boundary mana yang butuh static module graph, dan boundary mana yang butuh dynamic runtime composition?”

---

## 3. JPMS dalam 10 Menit, Khusus yang Relevan untuk OSGi

JPMS memperkenalkan file:

```java
module com.acme.case.api {
    requires java.base;
    requires java.logging;

    exports com.acme.case.api;
    exports com.acme.case.spi;

    uses com.acme.case.spi.CaseRule;
}
```

Konsep penting:

| JPMS Concept | Makna |
|---|---|
| Module | Unit named module di module graph |
| `requires` | Module ini membaca module lain |
| `exports` | Package dapat diakses compile-time/runtime oleh module lain |
| `opens` | Package dibuka untuk deep reflection |
| `uses` | Module menjadi consumer service via `ServiceLoader` |
| `provides ... with ...` | Module menyediakan implementation untuk `ServiceLoader` |
| Module path | Lokasi module yang dibaca JPMS launcher |
| Classpath | Semua JAR masuk unnamed module |
| Unnamed module | Module implisit untuk classpath; membaca banyak named modules, tetapi tidak punya descriptor eksplisit |
| Automatic module | JAR non-modular di module path diberi nama module otomatis |

Yang penting untuk OSGi:

1. JPMS bekerja di level **module graph**.
2. OSGi bekerja di level **bundle wiring graph**.
3. JPMS `exports` bukan OSGi `Export-Package`.
4. JPMS `requires` bukan OSGi `Import-Package`.
5. JPMS `uses` bukan OSGi `uses:=` directive.
6. JPMS `ServiceLoader` bukan OSGi Service Registry.
7. JPMS tidak punya native concept untuk hot install/update/uninstall module seperti OSGi bundle lifecycle.

---

## 4. OSGi Module vs JPMS Module

### 4.1 Unit Identitas

OSGi:

```text
Bundle-SymbolicName: com.acme.case.api
Bundle-Version: 1.4.2
Export-Package: com.acme.case.api;version="1.4.0"
```

JPMS:

```java
module com.acme.case.api {
    exports com.acme.case.api;
}
```

Perbedaan penting:

| Dimensi | OSGi | JPMS |
|---|---|---|
| Unit utama | Bundle | Module |
| Descriptor | `MANIFEST.MF` | `module-info.class` |
| Dependency unit | Package/capability/service | Module |
| Versioning | Built-in di bundle/package/capability | Tidak ada version resolution standar di JPMS runtime |
| Lifecycle | Dynamic lifecycle | Mostly launch-time/static |
| Update runtime | Supported | Tidak dalam model aplikasi biasa |
| Resolver | OSGi resolver | JPMS resolver |
| Service model | Dynamic OSGi Service Registry | `ServiceLoader` |
| Classloader | Per-bundle classloader | Module layer/classloader arrangement |
| Multiple versions | Dapat dimodelkan, meski dengan constraint | Umumnya satu module name per layer |
| Target use case | Dynamic component platform | Strong static modularity |

### 4.2 Dependency Granularity

OSGi bergantung pada package:

```text
Import-Package: com.fasterxml.jackson.databind;version="[2.15,3)"
```

JPMS bergantung pada module:

```java
requires com.fasterxml.jackson.databind;
```

Package-level dependency lebih presisi, tetapi lebih kompleks. Module-level dependency lebih sederhana, tetapi dapat terlalu kasar untuk runtime yang butuh multiple provider/version.

OSGi mengatakan:

> “Saya butuh package ini, versi ini, dengan capability ini.”

JPMS mengatakan:

> “Saya membaca module ini.”

Dalam sistem besar, perbedaan ini memengaruhi evolusi. OSGi dapat membuat API package kecil dan versioned. JPMS cenderung mendorong artifact/module boundary yang lebih besar.

---

## 5. Kesalahan Umum: Mengira `module-info.class` Menggantikan Manifest OSGi

Sebuah JAR bisa punya:

```text
META-INF/MANIFEST.MF
module-info.class
```

Tetapi keduanya dipakai oleh mekanisme berbeda.

Manifest OSGi dipakai oleh OSGi framework untuk:

- bundle identity,
- bundle lifecycle,
- package import/export,
- fragment,
- capability/requirement,
- service component metadata,
- execution environment.

`module-info.class` dipakai oleh JPMS untuk:

- module name,
- module readability,
- exported packages,
- opened packages,
- service uses/provides.

Kalau JAR dijalankan sebagai OSGi bundle, OSGi tidak otomatis memperlakukan `module-info.class` sebagai sumber utama dependency model. OSGi tetap membutuhkan metadata OSGi.

Jadi ini salah:

```text
“Kita sudah punya module-info.java, berarti sudah OSGi-compatible.”
```

Yang benar:

```text
“JAR ini mungkin JPMS-compatible, tetapi OSGi compatibility tetap membutuhkan manifest bundle yang benar.”
```

---

## 6. OSGi Bundle di Java 9+ Biasanya Hidup di Unnamed Module

Dalam banyak runtime, OSGi framework diluncurkan seperti ini:

```bash
java -jar org.apache.felix.main.jar
```

Atau:

```bash
java -cp "felix.jar:launcher.jar" com.acme.launcher.Main
```

Dalam mode classpath, kode framework berada di **unnamed module**. Bundle-bundle OSGi kemudian dimuat oleh classloader framework. Dari perspektif JPMS, banyak kode aplikasi tidak menjadi named module JPMS.

Konsekuensinya:

1. OSGi tetap mengelola visibility antar bundle.
2. JPMS tetap mengelola access ke JDK modules.
3. Strong encapsulation JDK tetap berlaku.
4. Library yang melakukan reflection ke internal JDK bisa gagal.
5. `--add-opens` dan `--add-exports` kadang dibutuhkan di command line JVM.

Ini penting. Meski aplikasi OSGi tidak sepenuhnya memakai JPMS named modules, sejak Java 9 JVM tetap modular. Kamu tidak bisa mengabaikan JPMS.

---

## 7. Strong Encapsulation: Masalah Terbesar Java 9+ untuk OSGi Runtime Lama

Era Java 8 memberi banyak kebebasan:

- reflection ke internal JDK,
- akses `sun.misc.Unsafe`,
- annotation scanner yang membuka banyak class,
- bytecode enhancement,
- dynamic proxy,
- deep reflection ke JDK/private members,
- framework yang memakai internal API.

Java 9 memperkenalkan module system dan strong encapsulation. Pada beberapa versi awal, akses ilegal masih diberi warning atau dilonggarkan. Di Java 16/17 ke atas, banyak akses ilegal menjadi error nyata.

Error umum:

```text
java.lang.reflect.InaccessibleObjectException:
Unable to make field private final ... accessible:
module java.base does not "opens java.lang" to unnamed module
```

Atau:

```text
IllegalAccessError: class X cannot access class Y
because module java.base does not export ...
```

### 7.1 `exports` vs `opens`

Di JPMS:

- `exports` membuka package untuk akses compile-time dan public member access.
- `opens` membuka package untuk deep reflection.

Contoh:

```java
module com.acme.domain {
    exports com.acme.domain.api;
    opens com.acme.domain.model to com.fasterxml.jackson.databind;
}
```

Untuk aplikasi OSGi di classpath/unnamed module, ketika butuh membuka package JDK, biasanya memakai JVM flags:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.lang.reflect=ALL-UNNAMED
--add-exports java.base/sun.nio.ch=ALL-UNNAMED
```

Tapi ini harus dianggap sebagai **compatibility escape hatch**, bukan desain normal.

### 7.2 Rule of Thumb

Gunakan `--add-opens` hanya bila:

- library lama belum kompatibel Java 17/21/25,
- upgrade library belum memungkinkan,
- aksesnya diketahui, terbatas, dan terdokumentasi,
- ada rencana menghapus flag tersebut.

Jangan gunakan `--add-opens` sebagai default besar seperti:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens java.base/java.io=ALL-UNNAMED
--add-opens java.base/java.net=ALL-UNNAMED
--add-opens java.base/java.time=ALL-UNNAMED
```

Tanpa alasan spesifik, ini membuat runtime rapuh dan sulit diaudit.

---

## 8. `--add-exports` vs `--add-opens`

Keduanya sering tertukar.

### 8.1 `--add-exports`

Dipakai untuk membuat package non-exported dari module bisa diakses oleh module lain.

```bash
--add-exports java.base/sun.nio.ch=ALL-UNNAMED
```

Artinya:

> Package `sun.nio.ch` dari module `java.base` diekspor ke classpath unnamed module.

Biasanya dibutuhkan oleh library yang mengakses internal API secara langsung.

### 8.2 `--add-opens`

Dipakai untuk deep reflection.

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
```

Artinya:

> Package `java.lang` dari module `java.base` dibuka untuk reflective access oleh unnamed module.

Biasanya dibutuhkan oleh serializer, ORM, mocking framework, instrumentation, atau legacy framework.

### 8.3 Decision Table

| Gejala | Kemungkinan Solusi |
|---|---|
| `IllegalAccessError` akses class internal | `--add-exports` atau upgrade library |
| `InaccessibleObjectException` dari reflection | `--add-opens` atau upgrade library |
| Warning illegal reflective access | upgrade library; flag sementara bila perlu |
| Error dari ByteBuddy/CGLIB/ASM lama | upgrade dependency lebih dulu |
| Error dari Hibernate/Jackson lama | upgrade library; jangan langsung buka semua JDK package |

---

## 9. ServiceLoader vs OSGi Service Registry

JPMS mendukung service discovery melalui `ServiceLoader`:

```java
module com.acme.case.api {
    uses com.acme.case.spi.CaseRule;
}
```

Provider:

```java
module com.acme.case.rule.highrisk {
    requires com.acme.case.api;
    provides com.acme.case.spi.CaseRule
        with com.acme.case.rule.highrisk.HighRiskRule;
}
```

OSGi punya service registry:

```java
@Component(service = CaseRule.class, property = {
    "rule.id=HIGH_RISK",
    "rule.priority:Integer=100"
})
public class HighRiskRule implements CaseRule {
}
```

Keduanya mirip di permukaan, tetapi berbeda besar.

| Dimensi | ServiceLoader | OSGi Service Registry |
|---|---|---|
| Discovery | Static-ish, load providers from module/classpath | Dynamic registry |
| Lifecycle | Provider tersedia selama classpath/module graph | Provider bisa muncul/hilang |
| Metadata | Terbatas | Service properties kaya |
| Ranking | Tidak native seperti OSGi service ranking | Native service ranking |
| Dynamic replacement | Tidak natural | Natural |
| Filtering | Manual | LDAP filter/target filter |
| Runtime introspection | Terbatas | Registry dapat diinspeksi |
| Use case | Static plugin/provider discovery | Dynamic service topology |

### 9.1 Bridging Strategy

Kadang kamu perlu memakai library yang berbasis `ServiceLoader` di dalam OSGi.

Contoh:

- JDBC driver discovery,
- JSON provider,
- logging provider,
- crypto provider,
- image IO provider,
- XML parser provider,
- Java SPI extension.

Masalahnya: `ServiceLoader` mengasumsikan provider bisa ditemukan dari classloader tertentu. OSGi memisahkan classloader per bundle.

Strategi:

1. Hindari `ServiceLoader` sebagai boundary internal OSGi bila bisa.
2. Convert provider menjadi OSGi service.
3. Gunakan extender/bridge khusus bila library memerlukan SPI.
4. Atur TCCL secara lokal dan aman bila library memang membutuhkan.
5. Jangan mengandalkan classpath global.

Contoh bridge sederhana:

```java
@Component(service = CaseRule.class)
public class ServiceLoaderCaseRuleBridge implements CaseRule {
    private final List<CaseRule> delegates;

    public ServiceLoaderCaseRuleBridge() {
        ClassLoader previous = Thread.currentThread().getContextClassLoader();
        try {
            Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
            this.delegates = ServiceLoader.load(CaseRule.class)
                    .stream()
                    .map(ServiceLoader.Provider::get)
                    .toList();
        } finally {
            Thread.currentThread().setContextClassLoader(previous);
        }
    }

    @Override
    public RuleResult evaluate(CaseContext context) {
        RuleResult result = RuleResult.pass();
        for (CaseRule rule : delegates) {
            result = result.combine(rule.evaluate(context));
        }
        return result;
    }
}
```

Tapi bridge seperti ini harus dilihat sebagai adapter untuk legacy/static SPI, bukan pengganti service registry.

---

## 10. Split Package: Dua Sistem, Dua Jenis Masalah

Split package terjadi ketika package yang sama ada di lebih dari satu artifact/module/bundle.

Contoh:

```text
bundle-a exports com.acme.common
bundle-b exports com.acme.common
```

Atau di JPMS:

```text
module-a contains com.acme.common
module-b contains com.acme.common
```

### 10.1 Di JPMS

JPMS sangat tidak menyukai split package. Jika dua named modules berisi package yang sama dan terbaca dalam graph, ini bisa menyebabkan error resolution.

### 10.2 Di OSGi

OSGi bisa memodelkan beberapa exporter untuk package sama, bahkan versi berbeda. Namun consumer bundle hanya akan wired ke satu provider package untuk import tertentu.

Masalahnya muncul ketika:

- package sama disediakan oleh banyak bundle,
- API type dari satu provider bercampur dengan implementation dari provider lain,
- `uses:=` constraint gagal,
- bundle punya package lokal dan juga import package sama,
- embedded dependency membawa package yang juga diekspor runtime.

### 10.3 Rule of Thumb

Jangan desain split package. Meski OSGi dapat memodelkan variasinya, split package tetap membuat reasoning jauh lebih sulit.

Lebih baik:

```text
com.acme.case.api
com.acme.case.spi
com.acme.case.internal
com.acme.case.highrisk.internal
com.acme.case.persistence.internal
```

Daripada:

```text
com.acme.case
com.acme.case
com.acme.case
```

### 10.4 Split Package Saat javax → jakarta

Migrasi `javax.*` ke `jakarta.*` bukan split package biasa, tetapi bisa menciptakan ecosystem split:

- bundle lama import `javax.servlet.*`,
- bundle baru import `jakarta.servlet.*`,
- runtime HTTP provider mungkin hanya menyediakan salah satu,
- bridge/wrapper bisa menambah kompleksitas,
- class identity berbeda total.

Jangan mencoba “menyatukan” `javax` dan `jakarta` dengan classloader trick. Perlakukan sebagai major ecosystem migration.

---

## 11. Automatic Module Name dan OSGi Symbolic Name

Library modern sering punya:

```text
Automatic-Module-Name: com.fasterxml.jackson.databind
```

OSGi bundle punya:

```text
Bundle-SymbolicName: com.fasterxml.jackson.databind
```

Keduanya bisa sama, tetapi tidak harus.

### 11.1 Kenapa Sebaiknya Konsisten?

Jika kamu maintain library yang ingin ramah JPMS dan OSGi, usahakan:

```text
Bundle-SymbolicName == Automatic-Module-Name == intended module name
```

Contoh:

```text
Bundle-SymbolicName: com.acme.case.api
Automatic-Module-Name: com.acme.case.api
```

Atau dengan `module-info.java`:

```java
module com.acme.case.api {
    exports com.acme.case.api;
}
```

Keuntungan:

- dependency reasoning lebih mudah,
- tooling lebih konsisten,
- migration path lebih jelas,
- dokumentasi tidak membingungkan.

### 11.2 Tapi Jangan Samakan Semantik

Nama boleh sama, tapi semantik tetap beda:

- OSGi symbolic name mengidentifikasi bundle.
- JPMS module name mengidentifikasi Java module.
- OSGi package version tetap ada.
- JPMS tidak menyelesaikan version range seperti OSGi.

---

## 12. Designing Dual-Mode Libraries: OSGi-Friendly dan JPMS-Friendly

Dual-mode library adalah library yang nyaman dipakai sebagai:

- normal classpath JAR,
- JPMS module,
- OSGi bundle.

Target ideal:

```text
same artifact
  ├── OSGi manifest metadata
  ├── Automatic-Module-Name or module-info.class
  ├── clean package boundary
  ├── no split package
  ├── no internal JDK dependency
  ├── no uncontrolled reflection
  └── stable exported API package
```

### 12.1 Package Layout

Contoh baik:

```text
com.acme.case.api
com.acme.case.spi
com.acme.case.support
com.acme.case.internal
```

OSGi:

```text
Export-Package: \
  com.acme.case.api;version="1.3.0",\
  com.acme.case.spi;version="1.3.0"
Private-Package: \
  com.acme.case.internal.*
```

JPMS:

```java
module com.acme.case.api {
    exports com.acme.case.api;
    exports com.acme.case.spi;
}
```

### 12.2 Avoid Internal JDK API

Buruk:

```java
import sun.misc.Unsafe;
```

Lebih baik:

- gunakan public API,
- gunakan VarHandle,
- gunakan MethodHandles,
- gunakan supported foreign memory API bila relevan,
- isolate compatibility code.

### 12.3 Reflection Policy

Jika library perlu reflection ke user classes:

- dokumentasikan package yang perlu dibuka di JPMS,
- di OSGi, pastikan package import/export jelas,
- jangan scanning seluruh classpath,
- jangan asumsi TCCL global,
- sediakan explicit registration API.

Contoh explicit lebih baik:

```java
CaseMapperRegistry registry = new CaseMapperRegistry();
registry.register(CaseApplication.class, new CaseApplicationMapper());
```

Daripada:

```java
scan("com.acme")
```

### 12.4 Service Discovery

Sediakan adapter untuk dua dunia:

```text
Core API
  |
  |-- OSGi provider via Declarative Services
  |-- JPMS/classpath provider via ServiceLoader
```

Jangan membuat core API bergantung langsung pada OSGi atau JPMS bila library harus portable.

### 12.5 Build Metadata

Dengan bnd, library bisa menghasilkan metadata OSGi dan JPMS-friendly metadata.

Contoh conceptual bnd:

```properties
Bundle-SymbolicName: com.acme.case.api
Bundle-Version: 1.3.0
Export-Package: \
    com.acme.case.api;version="1.3.0",\
    com.acme.case.spi;version="1.3.0"
Private-Package: com.acme.case.internal.*
Automatic-Module-Name: com.acme.case.api
```

---

## 13. `module-info.java` dalam Bundle OSGi

Ada beberapa pendekatan.

### 13.1 Tidak Pakai `module-info.java`, Pakai `Automatic-Module-Name`

Ini pendekatan konservatif untuk library yang harus support Java 8.

```text
Automatic-Module-Name: com.acme.case.api
```

Keuntungan:

- tetap compatible Java 8,
- memberi stable JPMS module name saat JAR dipakai di module path,
- tidak perlu compile `module-info.java`,
- lebih mudah untuk OSGi multi-JDK support.

Kekurangan:

- tidak ada declarative `requires`, `exports`, `opens` yang kuat.

### 13.2 Multi-Release JAR dengan `module-info.class`

Struktur:

```text
com/acme/case/api/CaseService.class
META-INF/versions/9/module-info.class
```

Keuntungan:

- artifact bisa tetap Java 8 compatible,
- Java 9+ melihat module descriptor.

Kekurangan:

- build lebih kompleks,
- tooling harus benar,
- OSGi metadata tetap harus benar,
- testing matrix bertambah.

### 13.3 Native Java 9+ Module Only

Kalau library tidak perlu Java 8:

```text
module-info.class at root
```

Keuntungan:

- descriptor kuat,
- module graph jelas.

Kekurangan:

- tidak Java 8 compatible,
- OSGi handling perlu dipastikan,
- tidak cocok untuk series ini jika target mencakup Java 8.

### 13.4 Rekomendasi untuk Java 8–25

Untuk artifact yang harus support Java 8–25 dan OSGi:

1. Gunakan OSGi manifest lengkap.
2. Tambahkan `Automatic-Module-Name` untuk stable JPMS name.
3. Pertimbangkan multi-release `module-info.class` hanya jika ada kebutuhan nyata.
4. Jangan menjadikan `module-info.class` sebagai pengganti OSGi metadata.
5. Test di Java 8, 11, 17, 21, dan 25.

---

## 14. Strong Encapsulation dan Annotation Scanning

Banyak framework Java lama melakukan:

```java
ClassLoader cl = Thread.currentThread().getContextClassLoader();
Enumeration<URL> urls = cl.getResources("com/acme");
```

Atau:

```java
Reflections reflections = new Reflections("com.acme");
```

Di OSGi, ini sudah bermasalah karena:

- tidak ada classpath global,
- tiap bundle punya classloader sendiri,
- resource visibility dikontrol,
- bundle bisa muncul/hilang.

Di Java 9+, masalah bertambah:

- JPMS membatasi reflective access,
- package belum tentu exported/opened,
- scanner bisa gagal membaca module path,
- internal JDK scanning bisa gagal.

### 14.1 Desain Lebih Baik

Daripada scanning bebas, gunakan manifest/metadata/service:

```java
@Component(service = CaseRule.class, property = {
    "rule.id=HIGH_RISK",
    "rule.version=1.0.0"
})
public class HighRiskRule implements CaseRule {
}
```

Atau metadata eksplisit:

```text
Provide-Capability: \
  com.acme.case.rule;\
  rule.id="HIGH_RISK";\
  rule.version:Version="1.0.0"
```

OSGi top-tier design lebih suka explicit runtime contract daripada scanning magic.

---

## 15. JPMS Layers vs OSGi Framework

JPMS mendukung `ModuleLayer`. Secara teori, kamu bisa membuat dynamic-ish layer:

```java
ModuleLayer parent = ModuleLayer.boot();
Configuration cf = parent.configuration().resolve(...);
ClassLoader scl = ClassLoader.getSystemClassLoader();
ModuleLayer layer = parent.defineModulesWithOneLoader(cf, scl);
```

Namun JPMS layer bukan pengganti OSGi:

| Feature | JPMS Layer | OSGi Framework |
|---|---|---|
| Install module runtime | Bisa dibuat secara programmatic, tetapi bukan app model umum | Native |
| Uninstall module | Tidak seperti bundle lifecycle | Native |
| Update module | Tidak natural | Native |
| Service dynamics | ServiceLoader static-ish | Dynamic registry |
| Version range | Tidak native | Native |
| Package version | Tidak native | Native |
| Resolver diagnostics | Terbatas | Kaya di OSGi tooling |
| Operational shell | Tidak native | Felix/Karaf/Equinox tools |

JPMS Layer cocok untuk controlled plugin loading bila requirement sederhana. OSGi cocok bila kamu butuh lifecycle, resolver, service registry, versioned packages, runtime operations, dan dynamic update.

---

## 16. Running OSGi Framework as a JPMS Module

Ada beberapa kemungkinan:

### 16.1 Framework di Classpath

```bash
java -cp "felix.jar:app-launcher.jar" com.acme.Main
```

Simple, umum, dan practical.

### 16.2 Framework di Module Path

```bash
java --module-path mods \
     --module com.acme.launcher/com.acme.Main
```

Ini membutuhkan framework/library yang punya module metadata atau automatic module.

Masalah yang perlu dicek:

- module name stabil,
- reflective access untuk framework,
- service loading framework factory,
- dependencies framework di module path,
- `uses/provides` untuk `org.osgi.framework.launch.FrameworkFactory`,
- akses ke package OSGi API.

### 16.3 FrameworkFactory via ServiceLoader

OSGi launcher biasanya bisa menemukan framework implementation lewat:

```java
ServiceLoader<FrameworkFactory> loader = ServiceLoader.load(FrameworkFactory.class);
FrameworkFactory factory = loader.iterator().next();
```

Dalam JPMS, provider harus dideklarasikan bila menjadi named module:

```java
module org.apache.felix.framework {
    requires org.osgi.framework;
    provides org.osgi.framework.launch.FrameworkFactory
        with org.apache.felix.framework.FrameworkFactory;
}
```

Atau JAR provider berada di classpath/unnamed module.

### 16.4 Practical Recommendation

Untuk production OSGi platform enterprise:

- jangan memodulkan semuanya sekaligus,
- mulai dari runtime classpath yang stabil,
- upgrade Java dan dependencies dulu,
- baru evaluasi apakah launcher/framework perlu JPMS named modules,
- jangan campur migration OSGi, JPMS, Java version, javax/jakarta, dan framework upgrade dalam satu big bang.

---

## 17. Java 8 sampai 25: Apa yang Berubah untuk OSGi?

### 17.1 Java 8

Karakteristik:

- tidak ada JPMS,
- classpath dominan,
- Java EE modules masih tersedia di JDK,
- reflection lebih bebas,
- Security Manager masih usable,
- banyak legacy OSGi runtime dibangun di era ini.

Risiko:

- library lama mengandalkan internal JDK,
- package `javax.*` tersedia dari platform atau dependency lama,
- kurang siap strong encapsulation.

### 17.2 Java 9

Karakteristik:

- JPMS hadir,
- JDK menjadi modular,
- module path hadir,
- illegal reflective access mulai muncul,
- Java EE/CORBA modules deprecated for removal.

Risiko:

- runtime OSGi lama mulai warning,
- classpath masih bekerja, tapi ada batas baru.

### 17.3 Java 11

Karakteristik:

- Java EE/CORBA modules dihapus dari JDK,
- JAXB/JAX-WS/Activation harus menjadi dependency eksternal,
- LTS modern pertama setelah Java 8.

Risiko:

- bundle lama gagal karena `javax.xml.bind` hilang,
- activation/mail/xml stack perlu dependency eksplisit,
- package wiring berubah.

### 17.4 Java 17

Karakteristik:

- strong encapsulation jauh lebih ketat,
- banyak illegal reflective access menjadi error,
- Security Manager deprecated for removal,
- LTS penting untuk modern enterprise.

Risiko:

- bytecode libraries lama gagal,
- ORM/proxy/mocking lama gagal,
- reflection hacks butuh `--add-opens` sementara,
- OSGi runtime lama perlu upgrade.

### 17.5 Java 21

Karakteristik:

- LTS,
- virtual threads finalized,
- banyak library mulai target Java 17/21,
- performance dan runtime behavior berubah.

Risiko:

- executor/thread model dalam OSGi perlu ditinjau,
- thread context classloader dengan virtual threads perlu disiplin,
- old instrumentation agents bisa bermasalah.

### 17.6 Java 25

Karakteristik:

- JDK modern setelah Java 21,
- ekosistem makin jauh dari Java 8 assumptions,
- Security Manager sudah tidak bisa dijadikan fondasi sandbox modern,
- strong encapsulation dan module discipline harus dianggap normal.

Risiko:

- OSGi runtime lama kemungkinan gagal,
- library bytecode lama makin tidak kompatibel,
- plugin sandbox in-JVM harus dievaluasi ulang,
- javax-era stack makin mahal dipertahankan.

---

## 18. Compatibility Matrix untuk OSGi + JPMS

| Target | Strategy |
|---|---|
| Java 8 only | OSGi manifest; no `module-info.class`; optional `Automatic-Module-Name` harmless for newer Java |
| Java 8–17 | OSGi manifest + `Automatic-Module-Name`; avoid Java 9 APIs in main classes |
| Java 8–25 | OSGi manifest + stable module name + CI matrix + avoid internal JDK |
| Java 11+ only | Can consider multi-release JAR or root `module-info.class` depending need |
| Java 17+ only | Strong encapsulation-aware; no illegal reflection dependency |
| OSGi runtime modern | Prefer DS, bnd, current Felix/Equinox/Karaf, explicit dependencies |
| JPMS app using OSGi island | Keep OSGi framework as controlled subsystem |
| OSGi app using JPMS-aware libs | Treat `module-info` as library metadata, but rely on OSGi manifest for bundle wiring |

---

## 19. Common Failure Modes

### 19.1 Bundle Works on Java 8, Fails on Java 17

Symptom:

```text
InaccessibleObjectException
```

Cause:

- library doing deep reflection into JDK internals or non-opened package.

Fix order:

1. Upgrade library.
2. Upgrade OSGi framework.
3. Check bytecode library versions.
4. Add minimal `--add-opens` only if unavoidable.
5. Document and schedule removal.

### 19.2 Library Has `module-info.class`, But OSGi Import Missing

Symptom:

```text
NoClassDefFoundError
```

Cause:

- OSGi manifest does not import required package.
- `module-info` was assumed to be enough.

Fix:

- generate manifest with bnd,
- inspect imports,
- add explicit import if needed,
- avoid hand-written stale manifest.

### 19.3 ServiceLoader Provider Not Found

Symptom:

```text
No provider found for X
```

Cause:

- provider is in another bundle classloader,
- TCCL wrong,
- JPMS provider declaration not visible,
- OSGi service registry not bridged.

Fix:

- convert provider to OSGi service,
- use SPI fly/bridge if available,
- set TCCL locally,
- avoid global scanning assumptions.

### 19.4 Split Package Error in JPMS Migration

Symptom:

```text
Module X reads package p from both A and B
```

Cause:

- package spread across multiple modules.

Fix:

- refactor package layout,
- merge package into one API artifact,
- rename internal packages,
- avoid partial exports.

### 19.5 `javax` and `jakarta` Collision

Symptom:

```text
ClassCastException
NoSuchMethodError
NoClassDefFoundError: javax/...
NoClassDefFoundError: jakarta/...
```

Cause:

- mixed old/new ecosystem.

Fix:

- choose runtime family,
- isolate bridge boundary,
- do not mix Servlet `javax` and `jakarta` in same web endpoint layer,
- version packages carefully,
- migrate in stages.

---

## 20. JPMS and OSGi in Library Design: Example

Suppose kamu membuat API untuk compliance rule engine.

### 20.1 Package Layout

```text
com.acme.compliance.rule.api
com.acme.compliance.rule.spi
com.acme.compliance.rule.support
com.acme.compliance.rule.internal
```

### 20.2 OSGi Manifest

```text
Bundle-SymbolicName: com.acme.compliance.rule.api
Bundle-Version: 1.2.0
Automatic-Module-Name: com.acme.compliance.rule.api
Export-Package: \
  com.acme.compliance.rule.api;version="1.2.0",\
  com.acme.compliance.rule.spi;version="1.2.0",\
  com.acme.compliance.rule.support;version="1.2.0"
Private-Package: com.acme.compliance.rule.internal.*
Import-Package: \
  org.osgi.annotation.versioning;version="[1.1,2)";resolution:=optional,\
  *
```

### 20.3 JPMS Descriptor if Java 9+ Only

```java
module com.acme.compliance.rule.api {
    exports com.acme.compliance.rule.api;
    exports com.acme.compliance.rule.spi;
    exports com.acme.compliance.rule.support;
}
```

### 20.4 API Contract

```java
package com.acme.compliance.rule.api;

public interface RuleEvaluationContext {
    String caseId();
    String agencyCode();
    Map<String, Object> attributes();
}
```

```java
package com.acme.compliance.rule.spi;

public interface ComplianceRule {
    RuleEvaluationResult evaluate(RuleEvaluationContext context);
}
```

### 20.5 OSGi Provider

```java
@Component(service = ComplianceRule.class, property = {
    "rule.id=HIGH_RISK_AGENCY",
    "rule.priority:Integer=100"
})
public final class HighRiskAgencyRule implements ComplianceRule {
    @Override
    public RuleEvaluationResult evaluate(RuleEvaluationContext context) {
        if ("CEA".equals(context.agencyCode())) {
            return RuleEvaluationResult.warn("Agency requires enhanced review");
        }
        return RuleEvaluationResult.pass();
    }
}
```

### 20.6 JPMS/ClassPath Provider via ServiceLoader

If needed:

```text
META-INF/services/com.acme.compliance.rule.spi.ComplianceRule
```

Content:

```text
com.acme.compliance.rule.highrisk.HighRiskAgencyRule
```

But in OSGi, prefer DS service provider.

---

## 21. OSGi `uses:=` vs JPMS `uses`

These are unrelated.

OSGi:

```text
Export-Package: com.acme.rule.api;version="1.2.0";uses:="com.acme.common.api"
```

Meaning:

> Consumers of `com.acme.rule.api` must use a consistent provider for `com.acme.common.api` because API types leak that package.

JPMS:

```java
uses com.acme.rule.spi.RuleProvider;
```

Meaning:

> This module consumes providers of that service through `ServiceLoader`.

Do not confuse them.

| Term | OSGi | JPMS |
|---|---|---|
| `uses:=` | Type consistency constraint in package export | Not applicable |
| `uses` | Not same syntax; OSGi has service references elsewhere | ServiceLoader consumer declaration |

---

## 22. Multi-Release JAR in OSGi

Multi-release JAR allows version-specific classes:

```text
com/acme/Foo.class                      # Java 8 version
META-INF/versions/11/com/acme/Foo.class # Java 11 version
META-INF/versions/17/com/acme/Foo.class # Java 17 version
```

Potential uses:

- use Java 8 baseline while optimizing newer Java,
- provide Java 9 `module-info.class`,
- use newer APIs conditionally.

Risks in OSGi:

- tooling must calculate imports correctly,
- bytecode version differs by runtime,
- package API must remain compatible,
- baseline comparison becomes more complex,
- tests must run on each target JDK.

Rule:

> Use multi-release JAR only when it buys real compatibility value. Do not use it as a cleverness badge.

For many OSGi libraries, `Automatic-Module-Name` is simpler and safer.

---

## 23. OSGi, JPMS, and Reflection-Based Frameworks

Frameworks that often hit JPMS/OSGi friction:

- Jackson,
- Hibernate,
- JAXB,
- CDI,
- Spring,
- Mockito,
- ByteBuddy,
- CGLIB,
- ASM-based scanners,
- scripting engines,
- expression languages,
- validation frameworks,
- JAX-RS providers.

The friction comes from four axes:

1. OSGi classloader isolation.
2. JPMS strong encapsulation.
3. Reflection/deep reflection.
4. Static classpath scanning assumptions.

### 23.1 Better Integration Model

Instead of allowing every framework to scan everything:

- register components explicitly,
- expose services explicitly,
- use extender pattern,
- generate metadata at build time,
- provide package opens only where needed,
- keep model/entity packages in known bundles,
- avoid dynamic scanning across all bundles.

---

## 24. Strategy Matrix: OSGi, JPMS, or Both?

### 24.1 Use JPMS Mostly When

- application is mostly static,
- no runtime plugin lifecycle,
- no multiple versions of same API needed,
- deployment is immutable,
- strong encapsulation is primary goal,
- runtime graph known at launch.

Example:

```text
CLI tool
static backend service
library ecosystem
modular desktop app without hot plugins
```

### 24.2 Use OSGi Mostly When

- runtime plugins/extensions matter,
- service can appear/disappear,
- versioned package contracts matter,
- controlled hot deploy/update is needed,
- long-lived runtime must evolve,
- product-line composition is needed,
- embedded/edge/gateway modularity matters.

Example:

```text
IDE/plugin platform
integration gateway
regulatory rule plugin platform
modular enterprise runtime
Karaf-based integration container
embedded device platform
```

### 24.3 Use Both When

- application runs on Java 17/21/25,
- libraries need stable JPMS names,
- runtime uses OSGi for dynamic components,
- JDK access needs module-aware handling,
- core library should be usable outside OSGi too.

Example:

```text
OSGi platform on Java 21
with libraries carrying Automatic-Module-Name
and carefully controlled --add-opens for legacy compatibility
```

### 24.4 Avoid Both Complexity When

- service is simple,
- deployment is containerized stateless service,
- team lacks versioning discipline,
- no runtime extension requirement,
- problem can be solved by clean package/module boundaries and CI.

---

## 25. Migration Playbook: Java 8 OSGi Runtime to Java 17/21/25

### Step 1 — Inventory Runtime

Collect:

```text
framework version
bundle list
bundle manifests
embedded dependencies
uses of sun.* / com.sun.*
uses of reflection
uses of ServiceLoader
uses of TCCL
javax dependencies
bytecode library versions
JPA/JAX-RS/Servlet versions
```

### Step 2 — Upgrade Tooling First

- current bnd,
- current Felix/Equinox/Karaf compatible with target Java,
- current SCR/DS runtime,
- current Config Admin,
- current HTTP provider.

### Step 3 — Run Resolver Before Runtime

Use bnd resolver or Karaf feature verification.

Catch:

- missing Java EE packages,
- wrong import ranges,
- javax/jakarta mismatch,
- old package exports,
- split packages.

### Step 4 — Run on Java 11

Java 11 catches removed Java EE modules.

Fix:

- JAXB dependency,
- activation dependency,
- annotation API,
- XML/JAX-WS legacy dependency,
- old `javax.*` package providers.

### Step 5 — Run on Java 17

Java 17 catches strong encapsulation.

Fix:

- upgrade bytecode libs,
- upgrade ORM/proxy/mocking libs,
- add minimal `--add-opens` only when needed,
- replace internal JDK API usage.

### Step 6 — Run on Java 21/25

Validate:

- framework compatibility,
- virtual thread impact if used,
- monitoring agents,
- security assumptions,
- startup and memory,
- container image.

### Step 7 — Remove Temporary Flags

Every `--add-opens` should have owner and reason:

```text
flag: --add-opens java.base/java.lang=ALL-UNNAMED
reason: legacy library X reflection
owner: platform team
target removal: after X >= 5.2 upgrade
```

### Step 8 — Lock CI Matrix

Minimum:

```text
Java 8 compile/test if still supported
Java 11 compatibility test
Java 17 compatibility test
Java 21 compatibility test
Java 25 smoke test
resolver verification
baseline verification
runtime integration test
```

---

## 26. Design Review Checklist

Use this checklist when reviewing OSGi + JPMS systems.

### 26.1 Module Metadata

- Does artifact have correct OSGi manifest?
- Is `Bundle-SymbolicName` stable?
- Are package versions correct?
- Does artifact have stable `Automatic-Module-Name` if intended for JPMS users?
- Is `module-info.class` present intentionally?
- Is `module-info.class` compatible with OSGi build tooling?

### 26.2 Package Boundary

- Are API packages separated from internal packages?
- Are internal packages not exported?
- Is there any split package?
- Are `javax` and `jakarta` not mixed accidentally?
- Are `uses:=` constraints generated/understood?

### 26.3 Strong Encapsulation

- Does runtime require `--add-opens`?
- Does runtime require `--add-exports`?
- Are flags minimal?
- Are flags documented?
- Can dependencies be upgraded to remove flags?

### 26.4 Service Discovery

- Is OSGi Service Registry used for dynamic service topology?
- Is `ServiceLoader` only used for static/legacy SPI?
- Are bridges explicit?
- Is TCCL manipulation local and restored in `finally`?

### 26.5 Java 8–25

- What is the minimum bytecode level?
- Are multi-release classes tested?
- Are internal JDK APIs avoided?
- Are Java EE removed modules supplied explicitly?
- Are old bytecode libraries upgraded?

### 26.6 Runtime Strategy

- Is OSGi framework launched from classpath or module path intentionally?
- Are bundle classloaders understood?
- Is JPMS module graph not confused with OSGi wiring graph?
- Is deployment immutable or mutable intentionally?
- Are resolver tests part of CI?

---

## 27. Anti-Patterns

### Anti-Pattern 1 — “JPMS Means We Can Delete OSGi Metadata”

Wrong. JPMS descriptor does not express OSGi lifecycle, service dynamics, package versions, capabilities, fragments, or DS metadata.

### Anti-Pattern 2 — “OSGi Means We Can Ignore JPMS”

Wrong after Java 9. JDK itself is modular, and strong encapsulation affects runtime behavior.

### Anti-Pattern 3 — Global `--add-opens` Dump

Bad:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens java.base/java.io=ALL-UNNAMED
--add-opens java.base/java.net=ALL-UNNAMED
--add-opens java.base/java.time=ALL-UNNAMED
```

without diagnosis.

This hides architectural debt.

### Anti-Pattern 4 — Mixing `javax` and `jakarta` Randomly

Do not let plugins choose freely between `javax.servlet` and `jakarta.servlet` in same web runtime.

### Anti-Pattern 5 — ServiceLoader as Dynamic Plugin Architecture

ServiceLoader is not a replacement for OSGi Service Registry when dynamic lifecycle matters.

### Anti-Pattern 6 — Split Packages for Convenience

Split packages make both JPMS and OSGi reasoning harder.

### Anti-Pattern 7 — Over-Modularizing with Two Systems

A simple service does not become better because it has JPMS modules inside OSGi bundles inside a container. Complexity must buy runtime capability.

---

## 28. Case Study: Regulatory Rule Platform on Java 21

Imagine a regulatory enforcement system with:

- core case management,
- dynamic rule plugins,
- different agency-specific validation rules,
- reporting plugins,
- external connector plugins,
- long-lived runtime,
- controlled plugin rollout.

### 28.1 Recommended Architecture

```text
JVM Java 21
  |
  |-- OSGi Framework
      |
      |-- com.acme.case.api
      |-- com.acme.case.core
      |-- com.acme.rule.api
      |-- com.acme.rule.engine
      |-- com.acme.rule.plugin.cea
      |-- com.acme.rule.plugin.cpds
      |-- com.acme.connector.api
      |-- com.acme.connector.onemap
      |-- com.acme.web.http
```

Library metadata:

```text
OSGi manifest: required
Automatic-Module-Name: recommended for reusable API libraries
module-info.class: optional, only if tested
```

Runtime flags:

```text
No broad --add-opens by default.
Only minimal flags if a specific dependency requires them.
```

Service model:

```text
Rules are OSGi services.
Connectors are OSGi services.
Report renderers are OSGi services.
Web endpoints use HTTP Whiteboard/JAX-RS Whiteboard.
```

JPMS role:

```text
JDK modularity affects runtime access.
Reusable libraries carry stable JPMS names.
OSGi remains dynamic module/runtime composition model.
```

### 28.2 Bad Architecture

```text
All plugins discovered by ServiceLoader.
All bundles export all packages.
Every package also has module-info exports.
Runtime uses broad --add-opens for everything.
javax and jakarta bundles mixed freely.
No resolver tests.
No baseline tests.
```

This system will work in demos and fail in controlled production evolution.

---

## 29. Practical Heuristics

### 29.1 When Building an OSGi Bundle

Ask:

```text
Is this bundle meant to be consumed outside OSGi?
```

If yes:

- add stable `Automatic-Module-Name`,
- avoid OSGi-specific API in public API,
- keep OSGi DS in provider bundle, not API bundle.

If no:

- OSGi manifest and DS metadata are enough,
- don't add JPMS complexity unnecessarily.

### 29.2 When Adding `module-info.java`

Add it only if:

- target Java is 9+ or multi-release build is justified,
- build tooling supports it,
- tests cover module path,
- OSGi manifest generation still correct,
- package exports match intended API boundary.

### 29.3 When Seeing `InaccessibleObjectException`

Do not immediately add `--add-opens`.

First ask:

1. Which dependency caused it?
2. Is dependency outdated?
3. Is there a newer Java-compatible version?
4. Is it reflecting into JDK or application classes?
5. Is this reflection necessary?
6. Can we configure explicit registration instead?
7. Can we scope `--add-opens` narrowly?

### 29.4 When Seeing Split Package

Default action:

```text
refactor package ownership
```

Not:

```text
fight resolver with directives until it works
```

---

## 30. Summary

OSGi and JPMS both solve modularity problems, but they solve different categories of modularity.

JPMS is strong at:

- static module graph,
- JDK modularization,
- strong encapsulation,
- reliable module names,
- launch-time readability,
- public API exposure control.

OSGi is strong at:

- dynamic runtime lifecycle,
- package-level versioning,
- runtime service registry,
- multiple provider selection,
- plugin architecture,
- controlled update/refresh,
- repository/provisioning-driven composition.

The correct mental model is not:

```text
OSGi vs JPMS
```

The correct mental model is:

```text
JPMS governs the Java platform/module-access world.
OSGi governs the dynamic bundle/service/runtime-composition world.
```

For Java 8–25 engineering, the safest approach is usually:

```text
OSGi manifest remains the source of truth for OSGi runtime.
Automatic-Module-Name gives stable JPMS identity for reusable libraries.
module-info.class is optional and must be tested deliberately.
Strong encapsulation issues must be fixed by dependency upgrades first,
not hidden behind broad --add-opens flags.
```

Top-tier OSGi engineering is not about using every modularity mechanism available. It is about choosing the right boundary, making runtime contracts explicit, and preserving evolvability across Java versions.

---

## 31. Key Takeaways

1. JPMS and OSGi are different modularity systems with different lifecycle assumptions.
2. `module-info.class` does not replace OSGi manifest metadata.
3. Most OSGi bundle code on Java 9+ still lives under OSGi classloader control, but JDK strong encapsulation still affects it.
4. `ServiceLoader` is not equivalent to OSGi Service Registry.
5. `uses` in JPMS and `uses:=` in OSGi mean completely different things.
6. Split package is a serious design smell in both JPMS and OSGi.
7. `--add-opens` and `--add-exports` are compatibility escape hatches, not architectural foundations.
8. `Automatic-Module-Name` is often the most pragmatic JPMS-friendly metadata for Java 8–25 compatible OSGi libraries.
9. Migration from Java 8 to Java 17/21/25 should be staged: tooling, resolver, Java 11, Java 17, Java 21/25.
10. The real goal is not maximum modularity; it is controlled evolvability.

---

## 32. References

- OSGi Core Release 8 — Module Layer and Framework architecture.
- OSGi Core Release 8 — Service Layer, Bundle lifecycle, Framework launching.
- bnd documentation — JPMS libraries, OSGi metadata generation, `Automatic-Module-Name`, module-info handling.
- OpenJDK JEP 261 — Java Platform Module System.
- Oracle Java migration documentation — migration from JDK 8 to later releases, `--add-exports`, `--add-opens`, strong encapsulation.
- dev.java module documentation — strong encapsulation, `--add-exports`, `--add-opens`.
- Apache Felix documentation — OSGi framework runtime and launcher behavior.
- Eclipse Equinox documentation — execution environments and OSGi runtime behavior.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 18 — Security Model: Permissions, Conditional Permission Admin, Signing, and Sandboxing Reality](./18-security-model-permissions-conditional-permission-admin-signing-sandboxing-reality.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 20 — Java 8 to 25 Compatibility Engineering for OSGi Systems](./20-java-8-to-25-compatibility-engineering-osgi-systems.md)
