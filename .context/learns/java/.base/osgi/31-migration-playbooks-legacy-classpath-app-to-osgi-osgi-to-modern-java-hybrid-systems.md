# Part 31 — Migration Playbooks: Legacy Classpath App to OSGi, OSGi to Modern Java, and Hybrid Systems

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
Part: `31 / 35`  
Target Java: `8 → 25`  
Target reader: senior / staff / principal engineer yang perlu memigrasikan sistem Java enterprise besar tanpa merusak runtime behavior, compatibility, atau operasional production.

---

## 0. Premis utama

Migrasi ke atau dari OSGi bukan sekadar mengganti build file, menambahkan manifest, atau membungkus JAR menjadi bundle.

Migrasi OSGi adalah **behavior-preserving architectural refactoring** terhadap runtime Java.

Artinya, kita mengubah cara aplikasi:

- melihat class,
- menemukan dependency,
- memulai komponen,
- memublikasikan service,
- mengelola konfigurasi,
- memuat plugin,
- melakukan update,
- menjaga compatibility,
- dan dioperasikan di production.

Pada aplikasi classpath biasa, banyak hal bersifat implicit:

```text
Semua JAR ada di satu classpath.
Semua class bisa saling melihat.
Static singleton tampak aman.
Annotation scanning menemukan hampir semua hal.
ServiceLoader membaca META-INF/services dari classpath global.
Library bebas menggunakan TCCL.
Startup dianggap linear.
Dependency conflict sering baru meledak saat runtime.
```

Di OSGi, semua itu berubah:

```text
Visibility harus eksplisit.
Package export/import harus jelas.
Lifecycle bundle berbeda dari lifecycle service.
Service bisa muncul dan hilang.
Resolver membuat wiring berdasarkan constraint.
Class identity dipengaruhi bundle classloader.
Upgrade tidak otomatis mengganti class yang sedang dipakai.
Konfigurasi bisa mengaktifkan/menonaktifkan component.
```

Maka migrasi yang baik tidak dimulai dari pertanyaan:

> “Bagaimana cara membuat semua JAR menjadi bundle?”

Tetapi dari pertanyaan:

> “Runtime boundary apa yang ingin kita jadikan eksplisit, stabil, observable, dan evolvable?”

Itulah mental model Part 31.

---

## 1. Jenis migrasi yang akan dibahas

Ada beberapa arah migrasi yang berbeda. Jangan dicampur karena masing-masing punya risiko berbeda.

| Jenis migrasi | Dari | Ke | Tujuan utama |
|---|---|---|---|
| Classpath to OSGi | Java app biasa | OSGi runtime | Modularisasi runtime, plugin, dynamic service |
| Legacy OSGi modernization | OSGi lama | OSGi modern | DS, bnd, baseline, Java 17/21/25 |
| OSGi Java upgrade | Java 8/11 | Java 17/21/25 | Security, supportability, performance |
| javax to jakarta | Java EE namespace | Jakarta namespace | Modern enterprise compatibility |
| OSGi to JPMS | Dynamic modules | Static modules | Simpler deployment, stricter launch-time modules |
| OSGi to microservices | In-process modules | Distributed services | Team/runtime isolation, scale, deployment independence |
| Hybrid plugin island | Spring/Jakarta app | Embedded OSGi subsystem | Plugin capability without full app migration |
| OSGi extraction | Large OSGi platform | Smaller runtimes/services | Reduce complexity and blast radius |

Top-tier engineer tidak memilih satu arah secara ideologis. Ia memilih berdasarkan **runtime force**.

---

## 2. Migration decision framework

Sebelum membuat plan migrasi, jawab 8 pertanyaan berikut.

### 2.1 Apakah runtime membutuhkan dynamic module behavior?

OSGi bernilai tinggi bila sistem membutuhkan:

- plugin yang bisa ditambah tanpa rebuild seluruh aplikasi,
- product variant berbeda dari bundle composition,
- extension point yang governed,
- beberapa versi API hidup berdampingan,
- modular platform long-lived,
- runtime yang bisa inspect bundle/service/config secara eksplisit,
- dependency graph yang perlu dikontrol ketat.

OSGi bernilai rendah bila sistem hanya:

- REST CRUD service sederhana,
- stateless container yang selalu immutable redeploy,
- tidak punya plugin runtime,
- tidak butuh side-by-side module version,
- tim tidak siap versioning discipline.

### 2.2 Apakah masalah utama sebenarnya arsitektur atau dependency?

Banyak tim mengira butuh OSGi padahal yang mereka butuhkan hanya:

- dependency convergence,
- module boundary di source code,
- build refactoring,
- clean architecture,
- JPMS,
- atau microservice extraction.

OSGi bukan obat untuk desain domain yang kacau.

OSGi memperjelas kekacauan itu.

### 2.3 Apakah aplikasi punya hidden global state?

Migrasi sulit bila banyak:

- static singleton,
- static cache,
- global registry,
- ThreadLocal tanpa cleanup,
- classloader-global object,
- JVM-wide configuration,
- lazy initialization acak,
- implicit context via TCCL.

Di OSGi, hidden global state sering berubah menjadi:

- classloader leak,
- stale service reference,
- failed refresh,
- inconsistent behavior setelah update.

### 2.4 Apakah dependency ecosystem OSGi-friendly?

Periksa:

- apakah library sudah punya OSGi metadata,
- apakah bisa dianalisis bnd,
- apakah melakukan annotation scanning global,
- apakah bergantung pada `ClassLoader.getSystemClassLoader()`,
- apakah menggunakan `ServiceLoader`,
- apakah butuh TCCL,
- apakah bytecode generator kompatibel dengan Java target,
- apakah memakai internal JDK API.

### 2.5 Apakah migrasi harus hot atau bisa cold?

Ada perbedaan besar antara:

```text
Aplikasi dimigrasikan, lalu dideploy ulang penuh.
```

vs

```text
Aplikasi harus bisa update bundle saat runtime production tetap hidup.
```

Hot update membutuhkan:

- state migration,
- service draining,
- reference cleanup,
- refresh blast-radius analysis,
- rollback strategy,
- observability kuat.

### 2.6 Apakah target Java masih Java 8 atau modern Java?

Target Java menentukan strategi:

| Target | Implikasi |
|---|---|
| Java 8 | javax masih native di banyak stack lama, no JPMS, Security Manager masih ada secara historis |
| Java 11 | Java EE modules removed, mulai butuh explicit dependencies |
| Java 17 | strong encapsulation lebih terasa, banyak library lama pecah |
| Java 21 | modern LTS, virtual threads available |
| Java 25 | newest line, security/runtime assumptions lama makin tidak valid |

OSGi Core Release 8 adalah referensi spesifikasi stabil saat ini, tetapi runtime/library di sekitar OSGi harus tetap dicek terhadap target JDK aktual.

### 2.7 Apakah namespace masih `javax` atau sudah `jakarta`?

Ini bukan rename ringan.

`javax.*` ke `jakarta.*` bisa memecah:

- servlet API,
- JAX-RS,
- CDI,
- JPA,
- Validation,
- JAXB,
- Activation,
- Mail,
- annotation packages,
- HTTP Whiteboard/JAX-RS integration.

Dalam OSGi, namespace change juga berarti package identity berubah.

```text
javax.servlet != jakarta.servlet
javax.persistence != jakarta.persistence
javax.ws.rs != jakarta.ws.rs
```

Resolver tidak melihat itu sebagai versi baru dari package yang sama. Itu package berbeda.

### 2.8 Apakah tim siap menjalankan governance?

OSGi yang sukses membutuhkan:

- API review,
- package versioning,
- baseline check,
- resolver test,
- repository governance,
- plugin certification,
- runtime diagnostics,
- deployment discipline.

Tanpa itu, OSGi berubah menjadi classpath hell versi lebih eksplisit.

---

## 3. Migration principle: preserve behavior first, modularity second

Kesalahan umum migrasi adalah mengejar bentuk arsitektur baru terlalu cepat.

Urutan yang lebih aman:

```text
1. Stabilkan behavior saat ini.
2. Tambahkan observability dan test harness.
3. Inventaris dependency dan runtime assumption.
4. Pisahkan API dari implementation.
5. Jadikan dependency eksplisit.
6. Baru ubah packaging/runtime.
7. Tambahkan dynamic behavior secara bertahap.
```

Jangan langsung memecah aplikasi besar menjadi puluhan bundle tanpa contract test.

OSGi memberi modularitas runtime. Tetapi modularitas runtime tanpa behavioral safety net adalah risiko.

---

## 4. Pre-migration inventory

Sebelum menyentuh OSGi, buat inventory.

### 4.1 Source/package inventory

Petakan package menjadi kategori:

| Kategori | Contoh | Perlakuan migrasi |
|---|---|---|
| Public API | `com.acme.case.api` | export versioned package |
| SPI | `com.acme.case.spi` | export versioned package, stricter compatibility |
| Internal implementation | `com.acme.case.internal` | private package |
| DTO/contract | `com.acme.case.dto` | export bila melewati bundle boundary |
| Persistence entity | `com.acme.case.entity` | hati-hati, biasanya private ke persistence bundle |
| Web layer | `com.acme.case.web` | private kecuali ada extension contract |
| Utility umum | `com.acme.common.*` | hindari god common bundle |
| Generated code | mapper/proxy/stub | periksa classloading dan package visibility |

### 4.2 Dependency inventory

Untuk setiap dependency, catat:

```text
Artifact
Version
License
OSGi metadata exists?
Automatic imports generated by bnd?
Exports packages?
Uses ServiceLoader?
Needs TCCL?
Uses reflection?
Uses annotation scanning?
Uses bytecode generation?
Uses internal JDK API?
javax or jakarta?
Java bytecode version?
Security CVE status?
```

### 4.3 Runtime assumption inventory

Cari pola berikut:

```text
Class.forName(...)
Thread.currentThread().getContextClassLoader()
ServiceLoader.load(...)
DriverManager.getConnection(...)
System.getProperty(...)
new InitialContext(...)
static INSTANCE
static Map cache
ThreadLocal
Executors.newFixedThreadPool(...)
Runtime.getRuntime().addShutdownHook(...)
Spring classpath scanning
Reflections library scan
Hibernate entity scan
JAXBContext.newInstance(...)
ObjectInputStream
Proxy.newProxyInstance(...)
```

Ini bukan otomatis salah. Tetapi di OSGi, semuanya butuh ownership yang jelas.

### 4.4 Operational inventory

Catat:

- startup sequence,
- config source,
- secret source,
- health endpoint,
- logging setup,
- metrics setup,
- database migration process,
- deployment model,
- rollback mechanism,
- thread pools,
- scheduled jobs,
- background workers,
- external connectors,
- stateful caches,
- file system usage.

Migrasi runtime tanpa operational inventory akan menghasilkan aplikasi yang “berhasil start” tapi sulit dioperasikan.

---

## 5. Playbook A — Legacy classpath application to OSGi

Tujuan: mengubah aplikasi Java classpath biasa menjadi OSGi runtime secara bertahap.

### 5.1 Jangan mulai dengan memecah semua module

Mulai dari shell besar yang masih mirip aplikasi lama.

Tahap awal:

```text
legacy-app.jar → one big compatibility bundle
```

Ini tidak ideal sebagai desain akhir, tetapi berguna untuk:

- menguji runtime framework,
- menemukan classloading assumption,
- menjalankan behavior test,
- mengidentifikasi dependency yang sulit,
- membuat baseline performance.

### 5.2 Bentuk awal migrasi

```text
[OSGi Framework]
   |
   +-- legacy.compat.bundle
   +-- wrapped.third.party.libs
   +-- logging bundle
   +-- config bundle
   +-- diagnostic shell
```

Tujuan tahap ini bukan modularitas sempurna.

Tujuannya adalah memindahkan aplikasi ke bawah kontrol framework OSGi.

### 5.3 Langkah 1 — Buat application behavior safety net

Sebelum migration:

- endpoint regression test,
- contract test,
- persistence integration test,
- smoke test startup/shutdown,
- performance baseline,
- memory baseline,
- log baseline,
- config baseline,
- security baseline.

Tanpa ini, kamu tidak tahu apakah migrasi berhasil atau hanya “tidak error saat start”.

### 5.4 Langkah 2 — Buat bundle compatibility shell

Gunakan bnd untuk menghasilkan manifest.

Contoh arah awal:

```properties
Bundle-SymbolicName: com.acme.legacy.compat
Bundle-Version: 1.0.0
Private-Package: com.acme.legacy.*
Import-Package: *
```

Jangan export semua package.

Export hanya package yang memang ingin dipakai bundle lain.

### 5.5 Langkah 3 — Wrap third-party libraries

Ada tiga strategi:

| Strategi | Kapan dipakai | Risiko |
|---|---|---|
| Pakai library yang sudah bundle | Library sudah punya manifest OSGi | paling bersih |
| Wrap library dengan bnd | Library non-OSGi tapi sederhana | perlu review import/export |
| Embed library dalam bundle | Library hanya implementation detail | risiko duplikasi dan CVE tracking |

Rule praktis:

```text
Jika dependency adalah bagian API contract, jangan embed diam-diam.
Jika dependency hanya implementation detail, embed boleh dipertimbangkan.
Jika dependency dipakai banyak bundle, jadikan bundle shared dengan versi terkontrol.
```

### 5.6 Langkah 4 — Tangani ServiceLoader dan SPI

Classpath app sering bergantung pada:

```text
META-INF/services/...
```

Di OSGi, global classpath tidak ada.

Pilihan:

1. ganti menjadi OSGi service registry,
2. gunakan SPI bridge seperti SPI-Fly,
3. set TCCL secara terkontrol saat memanggil library,
4. adaptasi library dengan wrapper service.

Preferensi jangka panjang:

```text
SPI eksternal → Adapter bundle → OSGi service contract
```

### 5.7 Langkah 5 — Pecah API dari implementation

Dari:

```text
com.acme.case.CaseService
com.acme.case.CaseServiceImpl
com.acme.case.CaseRepository
com.acme.case.CaseEntity
```

Menjadi:

```text
com.acme.case.api
  CaseService
  CaseCommand
  CaseResult

com.acme.case.impl
  CaseServiceImpl
  CasePolicyEngine

com.acme.case.persistence
  CaseRepository
  CaseEntity
```

Boundary penting:

- API package diexport.
- Implementation package private.
- Entity package tidak bocor sebagai API publik.
- DTO contract stabil dan versioned.

### 5.8 Langkah 6 — Introduce OSGi service contracts

Ubah dependency langsung:

```java
new EmailSender()
```

atau:

```java
ApplicationContext.getBean(EmailSender.class)
```

menjadi dependency via OSGi service.

Kontrak:

```java
package com.acme.notification.api;

public interface NotificationChannel {
    String channelType();
    NotificationResult send(NotificationRequest request);
}
```

Implementation bundle:

```java
@Component(service = NotificationChannel.class)
public class EmailNotificationChannel implements NotificationChannel {
    @Override
    public String channelType() {
        return "EMAIL";
    }

    @Override
    public NotificationResult send(NotificationRequest request) {
        // send email
    }
}
```

Consumer bundle:

```java
@Component
public class NotificationRouter {
    private final List<NotificationChannel> channels = new CopyOnWriteArrayList<>();

    @Reference(
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bind(NotificationChannel channel) {
        channels.add(channel);
    }

    void unbind(NotificationChannel channel) {
        channels.remove(channel);
    }
}
```

### 5.9 Langkah 7 — Replace static singleton with lifecycle-managed components

Sebelum:

```java
public final class RuleRegistry {
    public static final RuleRegistry INSTANCE = new RuleRegistry();
    private final Map<String, Rule> rules = new ConcurrentHashMap<>();
}
```

Sesudah:

```java
@Component(service = RuleRegistry.class)
public class OsgiRuleRegistry implements RuleRegistry {
    private final List<Rule> rules = new CopyOnWriteArrayList<>();

    @Reference(cardinality = ReferenceCardinality.MULTIPLE, policy = ReferencePolicy.DYNAMIC)
    void bindRule(Rule rule) {
        rules.add(rule);
    }

    void unbindRule(Rule rule) {
        rules.remove(rule);
    }
}
```

### 5.10 Langkah 8 — Migrate configuration

Jangan bawa semua `application.properties` sebagai global config.

Pisahkan berdasarkan PID:

```text
com.acme.db
com.acme.smtp
com.acme.case.rules
com.acme.audit
com.acme.integration.onemap
```

Gunakan Config Admin + Metatype untuk config yang berubah runtime.

### 5.11 Langkah 9 — Add resolver and baseline tests

Setiap release harus menjawab:

```text
Apakah semua bundle resolve?
Apakah package import range benar?
Apakah API package version naik sesuai breaking/non-breaking change?
Apakah runtime assembly reproducible?
```

### 5.12 Langkah 10 — Jalankan dual-runtime shadow test

Sebelum full cutover:

```text
Legacy runtime receives production-like traffic sample.
OSGi runtime receives mirrored/test traffic.
Compare behavior, logs, DB side effects, performance.
```

Jika tidak bisa mirror traffic, gunakan replay test dari captured business scenarios.

---

## 6. Playbook B — Legacy OSGi to modern OSGi

Banyak sistem OSGi lama berjalan, tetapi punya masalah:

- manifest manual,
- `Require-Bundle` berlebihan,
- `BundleActivator` besar,
- Blueprint XML tua,
- export package terlalu luas,
- no baseline,
- Java 8 stuck,
- hot deploy dipakai tanpa governance,
- old Equinox/Felix/Karaf,
- mixed `javax` dependencies.

Target modernisasi:

```text
Activator-heavy → DS-first
Manual manifest → bnd-generated manifest
Bundle dependency → package/capability dependency
Untested runtime → resolver/in-framework tests
Mutable snowflake runtime → reproducible distribution
Java 8-only → Java 17/21/25-compatible
```

### 6.1 Step 1 — Freeze runtime topology

Sebelum modernisasi:

- dump bundle list,
- dump versions,
- dump wiring,
- dump services,
- dump DS/Blueprint components,
- dump config,
- dump start levels,
- archive runtime repository.

Tanpa snapshot ini, kamu tidak punya baseline rollback.

### 6.2 Step 2 — Move manifest generation to bnd

Manual manifest sering mengandung:

- stale import,
- missing version range,
- accidental export,
- overbroad dynamic import,
- hidden embedded dependency.

Gunakan bnd untuk:

- calculate imports,
- control exports,
- generate DS metadata,
- generate Metatype metadata,
- run baseline checks,
- assemble runtime.

### 6.3 Step 3 — Reduce `Require-Bundle`

Ganti:

```text
Require-Bundle: com.acme.common
```

Dengan:

```text
Import-Package: com.acme.common.api;version="[2.1,3)"
```

Kecuali memang ada alasan kuat seperti:

- legacy Equinox extension registry,
- RCP plugin coupling,
- fragment/host pattern,
- atau framework-specific model.

### 6.4 Step 4 — Convert Activator to DS

Activator lama sering melakukan semuanya:

```text
read config
create thread pool
register services
open sockets
start jobs
track services
cleanup resources
```

Pecah menjadi DS components:

```text
Config-bound component
Service component
Scheduler component
Connector component
Health component
```

Keuntungan:

- lifecycle lebih jelas,
- reference management otomatis,
- config update lebih bersih,
- diagnostics lebih baik,
- test lebih mudah.

### 6.5 Step 5 — Replace custom service registry

Legacy OSGi kadang punya registry sendiri di atas service registry.

Evaluasi:

```text
Apakah registry ini hanya duplicate OSGi service registry?
Apakah metadata bisa menjadi service properties?
Apakah ranking/filter bisa menggantikan custom selector?
Apakah registry perlu domain-specific governance?
```

Jika custom registry hanya menyembunyikan service registry, hapus.

Jika custom registry menambahkan domain semantics, jadikan service di atas OSGi registry, bukan pengganti global acak.

### 6.6 Step 6 — Introduce baseline gate

Setiap API package harus punya baseline.

Breaking API change tanpa major version bump harus fail.

Non-breaking addition harus bump minor.

Implementation-only change cukup bundle micro.

### 6.7 Step 7 — Modernize runtime distribution

Dari:

```text
manual copy bundle ke deploy folder
```

Ke:

```text
resolved distribution / features / bndrun / p2 / Karaf custom distro
```

Tujuan:

- reproducible,
- auditable,
- rollbackable,
- environment-independent,
- dependency closure jelas.

---

## 7. Playbook C — Java 8 OSGi to Java 17/21/25

Ini sering paling berisiko karena sistem lama tampak stabil di Java 8 tetapi menyimpan banyak asumsi usang.

### 7.1 Migration ladder

Jangan langsung Java 8 → 25 untuk sistem besar tanpa intermediate validation.

Rute aman:

```text
Java 8 baseline
  ↓
Java 11 compatibility
  ↓
Java 17 LTS hardening
  ↓
Java 21 LTS optimization
  ↓
Java 25 compatibility validation
```

Bisa saja langsung target 21/25 di branch, tetapi test matrix harus tetap memahami breaking point.

### 7.2 Main issue: removed Java EE modules

Java 8 punya banyak module Java EE/CORBA di JDK. Java 11 menghapusnya.

Dampak:

- JAXB hilang,
- JAX-WS hilang,
- Activation hilang,
- Annotation API perlu dependency eksplisit,
- old XML/SOAP stack pecah,
- old mail stack perlu explicit artifact.

Dalam OSGi, ini berarti:

```text
Package yang dulu datang dari system bundle harus sekarang datang dari bundle dependency eksplisit.
```

### 7.3 Main issue: strong encapsulation

Java 9+ memperkenalkan JPMS.

Java modern makin membatasi reflective access ke internal JDK.

Library lama yang memakai:

```text
sun.misc.Unsafe
com.sun.*
jdk.internal.*
private reflection into JDK classes
```

bisa gagal.

Solusi sementara:

```text
--add-opens
--add-exports
```

Solusi jangka panjang:

```text
upgrade library
replace unsupported reflection
remove internal JDK dependency
```

### 7.4 Main issue: bytecode/toolchain

Pastikan:

- compiler target sesuai runtime minimum,
- bnd tidak menghasilkan manifest yang mengklaim EE salah,
- bundle dependency tidak memakai bytecode lebih tinggi dari target runtime,
- test dijalankan dengan JDK target aktual.

Contoh policy:

```text
Mainline target Java 17.
Compatibility branch supports Java 11.
No new bundle may compile above Java 17 unless runtime baseline changes.
Java 21/25 tested as forward runtime compatibility.
```

### 7.5 Main issue: Security Manager removal

Jika sistem lama mengandalkan Security Manager untuk sandbox plugin, desain itu tidak lagi defensible untuk Java 24/25.

Ganti dengan:

- trusted plugin repository,
- signed bundles,
- certification tests,
- service-level authorization,
- process isolation untuk untrusted code,
- container boundary,
- audit log,
- admission control.

### 7.6 Java upgrade checklist

```text
[ ] Runtime framework supports target JDK.
[ ] All bundles compile or run on target JDK.
[ ] Bytecode versions validated.
[ ] Removed Java EE APIs added as explicit bundles.
[ ] Internal JDK access identified.
[ ] --add-opens minimized and documented.
[ ] Reflection/proxy libraries upgraded.
[ ] ASM/ByteBuddy/CGLIB compatible.
[ ] JAXB/JAX-WS/Mail/Activation dependencies handled.
[ ] javax/jakarta compatibility decision documented.
[ ] Security Manager assumptions removed.
[ ] Performance baseline compared.
[ ] Startup baseline compared.
[ ] Memory/metaspace baseline compared.
[ ] Production rollback path tested.
```

---

## 8. Playbook D — javax to jakarta in OSGi

Namespace migration di OSGi lebih rumit daripada di classpath app.

### 8.1 Why it is hard

`javax.servlet` dan `jakarta.servlet` adalah package berbeda.

OSGi resolver tidak menganggap:

```text
javax.servlet;version=4
```

sebagai compatible dengan:

```text
jakarta.servlet;version=6
```

Maka kamu bisa punya dua dunia:

```text
Legacy bundles import javax.*
Modern bundles import jakarta.*
```

Tetapi objek dari dua dunia itu tidak interchangeable.

### 8.2 Migration strategies

| Strategi | Kapan cocok | Risiko |
|---|---|---|
| Big bang | Runtime kecil, test kuat | downtime/risk tinggi |
| Island migration | Modul tertentu pindah dulu | bridge complexity |
| Adapter boundary | javax side dan jakarta side dipisah DTO | extra code |
| Dual runtime | legacy OSGi dan modern app terpisah | operational complexity |
| Stay javax temporarily | stack belum siap | technical debt berlanjut |

### 8.3 Jangan bridge object API langsung

Hindari:

```text
Bundle A returns javax.servlet.HttpServletRequest to Bundle B expecting jakarta.servlet.HttpServletRequest
```

Gunakan boundary netral:

```java
public record RequestContext(
    String method,
    String path,
    Map<String, List<String>> headers,
    PrincipalInfo principal
) {}
```

### 8.4 Migration order

Urutan aman:

```text
1. Inventory all javax imports.
2. Group by API family.
3. Identify runtime provider: Servlet, JAX-RS, JPA, Validation, CDI, JAXB, Mail.
4. Decide per family: stay, migrate, adapter, isolate.
5. Migrate API bundles before implementation bundles.
6. Prevent mixed namespace in same contract package.
7. Run resolver tests for both old and new runtime assembly.
8. Use compatibility test per endpoint/use case.
```

### 8.5 javax/jakarta package policy

Contoh policy:

```text
No public API package may expose javax or jakarta types unless the API is explicitly bound to that technology.
Domain API must use domain DTOs.
Web adapter may use servlet/JAX-RS types privately.
Persistence entity must not cross service boundary.
Validation annotations in public DTO require namespace migration plan.
```

---

## 9. Playbook E — OSGi to JPMS

Kadang arah yang benar bukan menuju OSGi, tetapi keluar dari OSGi ke JPMS.

### 9.1 Kapan OSGi to JPMS masuk akal?

- Tidak butuh dynamic install/update.
- Tidak butuh runtime service registry.
- Tidak butuh plugin ecosystem.
- Deployment selalu immutable.
- Module graph bisa fixed at launch.
- Tim ingin standard Java module boundaries.
- Runtime complexity OSGi tidak lagi sebanding dengan manfaatnya.

### 9.2 Apa yang hilang?

JPMS tidak menggantikan:

- bundle lifecycle,
- service dynamics,
- Config Admin,
- DS,
- resolver repository model,
- hot deployment,
- multiple versions of same module in same layer dengan model OSGi,
- plugin governance built around service registry.

### 9.3 Migration approach

Dari OSGi bundle:

```text
Bundle-SymbolicName
Export-Package
Import-Package
Service-Component
```

Ke JPMS module:

```java
module com.acme.case.api {
    exports com.acme.case.api;
}
```

Tetapi DS component perlu diganti dengan:

- manual composition,
- DI framework,
- ServiceLoader,
- Spring/CDI,
- atau custom bootstrap.

### 9.4 Package export mapping

OSGi:

```text
Export-Package: com.acme.case.api;version="2.1.0"
```

JPMS:

```java
exports com.acme.case.api;
```

JPMS tidak membawa package version semantics.

Maka versioning pindah ke:

- artifact version,
- release governance,
- compatibility test,
- binary compatibility checker.

### 9.5 Avoid split packages before JPMS migration

JPMS sangat tidak bersahabat dengan split package.

Sebelum migrasi:

```text
Pastikan satu package hanya dimiliki satu module/artifact.
```

---

## 10. Playbook F — OSGi to microservices

Ini sering dilakukan ketika OSGi platform terlalu besar dan tim ingin deployment independence.

### 10.1 Jangan ekstrak berdasarkan bundle secara buta

Bundle boundary belum tentu service boundary.

OSGi bundle sering memisahkan:

- API,
- implementation,
- persistence,
- adapter,
- plugin.

Microservice boundary harus berdasarkan:

- business capability,
- data ownership,
- transaction boundary,
- team ownership,
- deployment reason,
- scaling reason.

### 10.2 Candidate extraction scoring

Nilai tiap capability:

| Faktor | Pertanyaan |
|---|---|
| Data ownership | Apakah punya data sendiri? |
| Change frequency | Apakah sering berubah sendiri? |
| Runtime load | Apakah scaling berbeda? |
| Failure isolation | Apakah perlu blast radius sendiri? |
| Team ownership | Apakah dimiliki tim berbeda? |
| Coupling | Apakah masih butuh transaction sync dengan core? |
| API maturity | Apakah contract stabil? |

### 10.3 Extraction pattern

```text
1. Stabilkan OSGi service API.
2. Buat remote facade di boundary yang sama.
3. Tambahkan anti-corruption layer.
4. Re-route consumer dari local service ke remote client.
5. Pindahkan implementation dan data ownership.
6. Matikan local implementation.
7. Pertahankan compatibility facade sementara.
```

### 10.4 Jangan mengubah semantic call tanpa sadar

OSGi service call:

```text
in-process
low latency
same transaction possible
same memory
same failure domain
```

Microservice call:

```text
network
partial failure
timeout
retry
idempotency
serialization
versioned API
observability required
```

Migrasi call boundary berarti migrasi failure model.

### 10.5 Transaction migration

Jika sebelumnya:

```text
CaseService → EnforcementService → NotificationService
single JVM, maybe same DB transaction
```

Setelah extraction:

```text
Case Service commits own transaction
Publishes event/outbox
Enforcement Service consumes event
Notification Service reacts separately
```

Kamu perlu:

- outbox,
- idempotent consumer,
- retry,
- compensating workflow,
- correlation ID,
- audit.

---

## 11. Playbook G — Hybrid plugin island inside Spring Boot/Jakarta app

Kadang seluruh aplikasi tidak perlu menjadi OSGi. Yang dibutuhkan hanya plugin subsystem.

### 11.1 Architecture

```text
Spring Boot / Jakarta Main Application
   |
   +-- Stable host API
   |
   +-- Embedded OSGi Framework
          |
          +-- Plugin API bundle
          +-- Plugin implementation bundles
          +-- Adapter service bundle
```

Host tetap Spring/Jakarta.

OSGi menjadi plugin island.

### 11.2 Kapan cocok?

- Aplikasi utama sudah stabil di Spring/Jakarta.
- Hanya rule/connector/renderer/plugin yang perlu dynamic.
- Tim tidak ingin memigrasikan semua runtime.
- Plugin perlu versioning dan isolation lebih baik dari classpath.
- Host API bisa dibuat kecil dan stabil.

### 11.3 Boundary rule

Host jangan expose internal Spring beans langsung ke plugin.

Gunakan API kecil:

```java
public interface HostCaseAccess {
    CaseSnapshot findCase(String caseId);
    void appendAudit(AuditEntry entry);
}
```

Plugin tidak boleh tahu:

- JPA entity,
- Spring repository,
- transaction manager internal,
- servlet request,
- security context object internal,
- implementation class host.

### 11.4 Bridge pattern

Host side:

```java
public final class SpringToOsgiBridge {
    private final Framework framework;

    public void publishHostServices() {
        BundleContext ctx = framework.getBundleContext();
        ctx.registerService(HostCaseAccess.class, new HostCaseAccessAdapter(), Map.of());
    }
}
```

Plugin side:

```java
@Component(service = RulePlugin.class)
public class HighRiskCaseRule implements RulePlugin {
    private HostCaseAccess hostCaseAccess;

    @Reference
    void bind(HostCaseAccess hostCaseAccess) {
        this.hostCaseAccess = hostCaseAccess;
    }
}
```

### 11.5 Risks

- lifecycle mismatch,
- classloader leak when plugin unloaded,
- Spring object leaking into OSGi,
- transaction boundary confusion,
- security model unclear,
- plugin thread pools unmanaged,
- config split-brain.

### 11.6 Governance

Plugin island tetap butuh:

- API versioning,
- plugin certification,
- bundle repository,
- resolver test,
- runtime diagnostics,
- unload test,
- memory leak test.

---

## 12. Playbook H — OSGi platform reduction

Kadang OSGi platform terlalu luas.

Tujuan bukan keluar total, tetapi mengurangi bagian yang dynamic.

### 12.1 Identify dynamic vs static modules

| Module type | Perlakuan |
|---|---|
| Truly dynamic plugin | tetap OSGi |
| Stable domain core | bisa menjadi normal library/module |
| Web adapter | bisa keluar ke Spring/Jakarta runtime |
| Persistence | sering lebih aman static |
| Integration connector dynamic | tetap OSGi atau external service |
| Common utilities | normal library, no runtime service |

### 12.2 Shrink kernel

Kernel OSGi idealnya kecil:

```text
framework
service registry
plugin API
config bridge
diagnostics
plugin manager
minimal host access
```

Bukan seluruh aplikasi.

### 12.3 Extract stable parts

Pindahkan stable core ke:

- normal JAR,
- JPMS module,
- Spring/Jakarta application,
- external service,
- shared library.

OSGi tetap dipakai untuk bagian yang memang butuh dynamic extension.

---

## 13. Migration risk taxonomy

### 13.1 Classloading risk

Gejala:

```text
ClassNotFoundException
NoClassDefFoundError
ClassCastException
LinkageError
uses constraint violation
```

Mitigasi:

- bnd analysis,
- resolver test,
- explicit import range,
- no split package,
- no duplicate API classes,
- controlled TCCL.

### 13.2 Lifecycle risk

Gejala:

```text
component active but not ready
service missing after restart
thread still running after bundle stop
old implementation still used after update
```

Mitigasi:

- DS lifecycle,
- idempotent activate/deactivate,
- close trackers,
- stop executors,
- readiness checks,
- refresh plan.

### 13.3 Compatibility risk

Gejala:

```text
plugin compiled but behavior breaks
minor version breaks consumers
old bundle cannot resolve after API update
```

Mitigasi:

- package semantic versioning,
- baseline check,
- compatibility tests,
- API deprecation policy,
- side-by-side major version.

### 13.4 Operational risk

Gejala:

```text
runtime works locally but not prod
manual bundle set differs by environment
rollback impossible
no visibility into unsatisfied component
```

Mitigasi:

- reproducible runtime,
- immutable distribution,
- deployment manifest,
- runtime diagnostics,
- config audit,
- rollback test.

### 13.5 Security risk

Gejala:

```text
plugin can access too much
management shell exposed
unsigned bundles deployed
secrets leaked via config
```

Mitigasi:

- repository governance,
- signed bundles,
- plugin certification,
- restricted management endpoints,
- secrets reference pattern,
- process isolation for untrusted code.

---

## 14. Migration sequencing patterns

### 14.1 Strangler inside JVM

Gunakan untuk classpath → OSGi.

```text
Legacy core stays intact.
New extension points implemented as OSGi services.
Over time, legacy modules extracted into bundles.
```

### 14.2 API-first extraction

```text
Extract API package first.
Stabilize contract.
Move implementation later.
```

### 14.3 Adapter-first migration

```text
Wrap old implementation behind OSGi service.
Consumers depend on service API.
Replace implementation later.
```

### 14.4 Parallel runtime validation

```text
Run old and new runtime side by side.
Replay same scenario.
Compare output, events, DB state, logs.
```

### 14.5 Compatibility bridge

```text
Old API v1 remains.
New API v2 introduced.
Bridge maps v1 to v2 temporarily.
Consumers migrate gradually.
```

### 14.6 Freeze-and-replace

Cocok untuk module kecil.

```text
Freeze old module.
Build new OSGi equivalent.
Switch at release boundary.
Remove old module.
```

---

## 15. Example migration: enforcement rule engine

### 15.1 Starting point

Legacy classpath code:

```java
public class EnforcementEngine {
    private final List<Rule> rules = List.of(
        new HighRiskApplicantRule(),
        new LateRenewalRule(),
        new MissingDocumentRule()
    );

    public Decision evaluate(Application app) {
        for (Rule rule : rules) {
            Decision decision = rule.evaluate(app);
            if (decision.isBlocking()) {
                return decision;
            }
        }
        return Decision.pass();
    }
}
```

Problems:

- rules compiled into core,
- no runtime extension,
- no rule version identity,
- no agency-specific rule set,
- no dynamic enable/disable,
- difficult certification.

### 15.2 Step 1 — Define stable API bundle

```java
package com.acme.enforcement.rule.api;

public interface EnforcementRule {
    RuleDescriptor descriptor();
    RuleDecision evaluate(RuleContext context);
}
```

DTO boundary:

```java
public record RuleContext(
    String caseId,
    String applicationType,
    Map<String, Object> attributes
) {}
```

Do not expose JPA entity.

### 15.3 Step 2 — Implement rule as DS service

```java
@Component(
    service = EnforcementRule.class,
    property = {
        "rule.code=HIGH_RISK_APPLICANT",
        "rule.version=1.0.0",
        "agency=CEA"
    }
)
public class HighRiskApplicantRule implements EnforcementRule {
    @Override
    public RuleDescriptor descriptor() {
        return new RuleDescriptor("HIGH_RISK_APPLICANT", "1.0.0");
    }

    @Override
    public RuleDecision evaluate(RuleContext context) {
        // rule logic
        return RuleDecision.pass();
    }
}
```

### 15.4 Step 3 — Registry uses dynamic references

```java
@Component(service = RuleEngine.class)
public class OsgiRuleEngine implements RuleEngine {
    private final List<EnforcementRule> rules = new CopyOnWriteArrayList<>();

    @Reference(
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindRule(EnforcementRule rule) {
        rules.add(rule);
    }

    void unbindRule(EnforcementRule rule) {
        rules.remove(rule);
    }

    @Override
    public RuleDecision evaluate(RuleContext context) {
        List<EnforcementRule> snapshot = List.copyOf(rules);
        for (EnforcementRule rule : snapshot) {
            RuleDecision decision = rule.evaluate(context);
            if (decision.blocking()) {
                return decision;
            }
        }
        return RuleDecision.pass();
    }
}
```

### 15.5 Step 4 — Add governance

Rule plugin release requires:

```text
[ ] API package range compatible.
[ ] Rule descriptor unique.
[ ] Rule version declared.
[ ] Rule test cases pass.
[ ] No forbidden imports.
[ ] No internal host package usage.
[ ] No unmanaged threads.
[ ] No direct DB access unless allowed.
[ ] Bundle resolves in certified runtime.
[ ] Bundle can stop/uninstall cleanly.
[ ] Audit events generated.
```

### 15.6 Step 5 — Migration completed gradually

Legacy rules can be adapted first:

```java
@Component(service = EnforcementRule.class)
public class LegacyLateRenewalRuleAdapter implements EnforcementRule {
    private final LegacyLateRenewalRule delegate = new LegacyLateRenewalRule();

    @Override
    public RuleDecision evaluate(RuleContext context) {
        return RuleDecision.fromLegacy(delegate.evaluate(toLegacy(context)));
    }
}
```

Then old code removed after behavior parity.

---

## 16. Migration observability checklist

During migration, observe:

```text
Bundle states
Resolver errors
Package wiring
Service registrations
Unsatisfied DS components
Configuration updates
Framework events
Service events
Startup duration
Activation duration
Thread count
Metaspace usage
Classloader count
Heap after update/refresh
Old class retention
Endpoint readiness
Plugin health
Error rate
Latency
DB connection count
Event backlog
```

Without this, migration defects become anecdotal.

---

## 17. Migration testing matrix

### 17.1 Static checks

```text
[ ] bnd manifest analysis
[ ] no unintended exports
[ ] no split packages
[ ] no DynamicImport wildcard
[ ] no forbidden internal imports
[ ] package version baseline
[ ] bytecode level check
[ ] license/CVE check
```

### 17.2 Resolver checks

```text
[ ] Full runtime resolves.
[ ] Minimal runtime resolves.
[ ] Plugin runtime resolves.
[ ] Java 8 runtime resolves if still supported.
[ ] Java 17/21/25 runtime resolves for target.
[ ] javax and jakarta variants tested if relevant.
```

### 17.3 Lifecycle checks

```text
[ ] install
[ ] start
[ ] stop
[ ] update
[ ] refresh
[ ] uninstall
[ ] restart framework
[ ] config update
[ ] service provider disappears
[ ] service provider replaced
```

### 17.4 Behavioral checks

```text
[ ] same input produces same domain output
[ ] same validation decision
[ ] same audit trail
[ ] same security decision
[ ] same persistence side effect
[ ] same external call behavior or mocked expectation
```

### 17.5 Operational checks

```text
[ ] health endpoint works
[ ] readiness waits for required components
[ ] logs include bundle/component identity
[ ] metrics include runtime state
[ ] rollback tested
[ ] failed plugin does not crash host
[ ] invalid config fails safely
```

---

## 18. Rollback strategy

Rollback must be designed before migration.

### 18.1 Immutable runtime rollback

Best for production.

```text
Deploy version N+1 as new immutable runtime.
If failure, route traffic back to version N.
```

Pros:

- clean,
- predictable,
- compatible with containers,
- avoids partial bundle mutation.

Cons:

- slower than hot update,
- needs infra support.

### 18.2 Bundle-level rollback

Possible but risky.

Need know:

- whether bundle exports packages used by others,
- whether refresh required,
- whether consumers can survive refresh,
- whether state migration happened,
- whether old classes retained.

### 18.3 Config rollback

Config change can break runtime as much as code.

Config must be:

- versioned,
- audited,
- diffable,
- validated,
- restorable.

### 18.4 Data rollback

Hardest part.

If migration changes schema or persisted semantics, code rollback may not be enough.

Need:

- backward-compatible schema migration,
- expand/contract pattern,
- data migration verification,
- feature toggle,
- read compatibility,
- backup/restore plan.

---

## 19. Migration anti-patterns

### 19.1 Big bang bundle explosion

Breaking app into 80 bundles before tests exist.

Result:

- resolver chaos,
- no ownership,
- performance regression,
- debugging nightmare.

### 19.2 Export all packages

```text
Export-Package: *
```

This destroys boundary.

### 19.3 Make every import optional

```text
Import-Package: *;resolution:=optional
```

This hides failure until runtime.

### 19.4 DynamicImport as migration shortcut

```text
DynamicImport-Package: *
```

This brings classpath chaos back through the side door.

### 19.5 Embed every dependency

This creates:

- duplicate classes,
- CVE tracking problem,
- class identity bug,
- larger bundles,
- inconsistent dependency versions.

### 19.6 Expose persistence entity as API

This couples:

- service contract,
- persistence provider,
- classloader,
- transaction model,
- schema evolution.

### 19.7 Migrate namespace and architecture at once

Doing all together:

```text
Java 8 → 21
javax → jakarta
Spring → OSGi
manual runtime → Karaf
old API → new API
```

is high-risk.

Separate axes where possible.

### 19.8 Treat ACTIVE as ready

A bundle can be ACTIVE while its business capability is unusable.

Use service/component/readiness semantics.

---

## 20. Practical migration roadmap template

### Phase 0 — Assessment

```text
Duration: 1–3 weeks for medium system
Output:
- dependency inventory
- package inventory
- runtime assumption inventory
- risk register
- target architecture candidate
- migration options
```

### Phase 1 — Safety net

```text
Output:
- regression tests
- startup smoke tests
- runtime metrics baseline
- resolver test prototype
- deployment rollback prototype
```

### Phase 2 — Compatibility runtime

```text
Output:
- app runs under OSGi with minimal split
- wrapped dependencies identified
- classloading issues cataloged
- no dynamic plugin yet
```

### Phase 3 — Boundary extraction

```text
Output:
- API bundles
- implementation bundles
- service contracts
- DS components
- Config Admin integration
```

### Phase 4 — Dynamic capability

```text
Output:
- plugin bundle support
- service ranking/filtering
- certification tests
- plugin lifecycle management
```

### Phase 5 — Production hardening

```text
Output:
- immutable distribution
- operational runbook
- rollback tested
- observability complete
- security governance
```

### Phase 6 — Modernization

```text
Output:
- Java 17/21/25 support
- javax/jakarta decision implemented
- old activators removed
- manual manifest removed
- baseline enforced in CI
```

---

## 21. Migration ADR examples

### ADR: Why OSGi?

```text
We need runtime extensibility for agency-specific enforcement rules and external connector plugins.
JPMS alone cannot provide dynamic install/update or service registry behavior.
Microservices would add network failure and deployment complexity for logic that must execute in-process with low latency.
Therefore, OSGi is used as a plugin/runtime composition subsystem.
```

### ADR: Why not full app migration?

```text
Only rule and connector subsystems require runtime extension.
Core case management remains stable and benefits from simpler Spring/Jakarta deployment.
Therefore, OSGi is embedded as a plugin island rather than used as the entire application runtime.
```

### ADR: Why DS over BundleActivator?

```text
Declarative Services provides explicit component lifecycle, dependency tracking, config integration, diagnostics, and safer dynamic binding.
BundleActivator is reserved for low-level bootstrap only.
```

### ADR: Why immutable runtime over hot production update?

```text
Hot update has complex state, refresh, and rollback semantics.
Production reliability and auditability are more important than update speed.
Therefore, releases are assembled as immutable distributions and deployed via blue/green rollout.
```

---

## 22. Final mental model

Migration is not about making OSGi happy.

Migration is about making runtime assumptions explicit.

A strong OSGi migration makes these boundaries visible:

```text
What is API?
What is implementation?
Who owns lifecycle?
Who owns configuration?
Who owns class visibility?
Who owns service availability?
Who owns version compatibility?
Who owns operational readiness?
Who owns rollback?
```

If those answers are unclear before migration, OSGi will expose the ambiguity.

If those answers are clear, OSGi can become a very powerful runtime architecture tool.

Top-tier engineering judgment is not “always use OSGi” or “never use OSGi”.

It is knowing when runtime modularity, dynamic service composition, and governed plugin architecture are worth the cost.

---

## 23. Part 31 summary

Key takeaways:

1. OSGi migration is runtime refactoring, not packaging conversion.
2. Start with inventory and behavior safety net.
3. Preserve behavior first; modularize second.
4. API/implementation separation must precede dynamic plugins.
5. Use bnd, resolver tests, and baseline checks as migration guardrails.
6. Java 8→25 migration must handle removed Java EE modules, strong encapsulation, bytecode compatibility, and Security Manager removal.
7. `javax`→`jakarta` is a package identity migration, not a rename.
8. OSGi to JPMS is valid when dynamic runtime behavior is no longer needed.
9. OSGi to microservices changes the failure model from in-process to distributed.
10. Hybrid plugin island is often the pragmatic architecture.
11. Rollback, observability, and governance must be designed before production migration.
12. The goal is not more bundles; the goal is controlled runtime evolution.

---

## 24. References

- OSGi Core Release 8 Specification — Module Layer, Lifecycle Layer, Service Layer, Resolver, Framework behavior.
- OSGi Compendium Release 8 / 8.1 — Declarative Services, Configuration Admin, Metatype, Event Admin, enterprise services.
- bnd / Bndtools documentation — manifest generation, resolver, baseline, workspace, bndrun testing.
- Apache Felix documentation — framework usage, lifecycle commands, update/refresh behavior, Gogo shell, SCR.
- Eclipse Equinox documentation — execution environment descriptions, launcher, p2, runtime diagnostics.
- Apache Karaf documentation — features, provisioning, custom distribution, operational commands.
- OpenJDK migration material — JPMS, strong encapsulation, removed Java EE modules, Java version migration.

---

# Series status

```text
Part 31 of 35 complete.
Series is not complete yet.
Next part: 32-building-production-grade-osgi-case-study-runtime-from-scratch.md
```
