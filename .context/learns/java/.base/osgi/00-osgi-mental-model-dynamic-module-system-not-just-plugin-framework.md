# Part 0 — OSGi Mental Model: Dynamic Module System, Not Just Plugin Framework

**Series:** `learn-java-osgi-dynamic-module-runtime-engineering`  
**File:** `00-osgi-mental-model-dynamic-module-system-not-just-plugin-framework.md`  
**Target Java:** 8 sampai 25  
**Level:** Advanced / platform engineering / architecture reasoning  

---

## 0. Apa yang ingin dicapai di Part 0?

Part ini bukan tutorial membuat bundle pertama. Part ini membangun **cara berpikir** yang benar sebelum masuk ke manifest, resolver, classloading, service registry, Declarative Services, Karaf, Felix, Equinox, dan production operations.

OSGi sering terlihat seperti teknologi lama, rumit, atau “plugin framework”. Itu framing yang terlalu kecil. Secara mental model, OSGi adalah:

> **dynamic module system untuk Java yang menggabungkan modular class visibility, lifecycle management, runtime service registry, versioned dependency resolution, dan kemampuan deployment/update di dalam JVM yang sedang berjalan.**

Kalau Java biasa bertanya:

> “Class ini ada di classpath atau tidak?”

OSGi bertanya:

> “Bundle mana yang memiliki class ini, package mana yang diekspor, versi mana yang kompatibel, bundle mana yang mengimpor package tersebut, wiring mana yang dipilih resolver, service apa yang tersedia saat ini, dan apa yang terjadi jika provider itu hilang ketika runtime masih berjalan?”

Perbedaan ini mengubah cara desain software. Kamu tidak lagi hanya berpikir dalam bentuk object, package, JAR, dependency Maven, atau Spring bean. Kamu mulai berpikir dalam bentuk:

- **runtime module identity**
- **class space isolation**
- **explicit package contract**
- **dynamic lifecycle**
- **service availability**
- **versioned compatibility**
- **evolvable runtime composition**

Itulah tujuan Part 0: membangun fondasi mental sebelum semua detail teknis berikutnya.

---

## 1. OSGi dalam satu kalimat yang akurat

OSGi adalah **spesifikasi dan model runtime Java** di mana aplikasi disusun dari unit modular bernama **bundle**, setiap bundle memiliki metadata eksplisit, classloader terisolasi, lifecycle sendiri, dependency package yang di-resolve oleh framework, dan dapat berkomunikasi melalui **dynamic service registry**.

Ada beberapa kata penting di sana.

| Kata | Makna |
|---|---|
| Spesifikasi | OSGi bukan satu produk. Ada implementasi seperti Apache Felix, Eclipse Equinox, dan runtime distribusi seperti Apache Karaf. |
| Runtime | OSGi bukan hanya format build. Ia hidup di JVM dan mengelola module, lifecycle, service, dan dependency saat runtime. |
| Bundle | Unit modular, deployment, identity, metadata, classloader, lifecycle. Biasanya berupa JAR dengan manifest OSGi. |
| Metadata eksplisit | Bundle menjelaskan package yang di-export/import, capability, requirement, activator, service component, dan sebagainya. |
| Classloader terisolasi | Setiap bundle tidak otomatis melihat semua class dari semua JAR. Visibility harus disepakati. |
| Resolve | Dependency tidak sekadar “ada di Maven”; framework memilih wiring yang valid berdasarkan constraint. |
| Dynamic service registry | Bundle dapat publish/consume service saat runtime; service bisa muncul, hilang, terganti, atau berubah ranking. |

OSGi Core Release 8 mendefinisikan framework layer seperti **Security Layer**, **Module Layer**, **Life Cycle Layer**, dan **Service Layer**. Dokumentasi resmi menjelaskan bahwa Module Layer menyediakan model modularisasi Java dengan aturan ketat untuk sharing atau hiding package antar bundle, Life Cycle Layer mengelola bundle dalam Module Layer, dan Service Layer menyediakan model komunikasi antar bundle. Referensi resmi ada di OSGi Core R8 dan halaman spesifikasi OSGi.

---

## 2. Problem asli yang ingin diselesaikan OSGi

Untuk memahami OSGi, jangan mulai dari API. Mulai dari penyakit Java deployment klasik.

### 2.1 Classpath hell

Pada aplikasi Java klasik, semua dependency biasanya masuk ke satu classpath besar.

```text
java -cp app.jar:lib/a.jar:lib/b.jar:lib/c.jar com.example.Main
```

Model ini sederhana, tetapi punya masalah fundamental:

1. Semua JAR berada di ruang visibility besar yang sama.
2. Tidak ada dependency versioning di level package.
3. Dua versi library yang sama sulit hidup berdampingan.
4. Class conflict baru kelihatan saat runtime.
5. Internal package library bisa dipakai sembarangan.
6. JAR tidak menyatakan secara presisi package mana yang API dan mana yang internal.
7. Deployment unit tidak punya lifecycle modular.

Contoh masalah:

```text
module-a membutuhkan jackson-databind 2.12
module-b membutuhkan jackson-databind 2.17
```

Di classpath biasa, biasanya hanya satu versi yang menang. Yang lain diam-diam kalah. Aplikasi mungkin tetap start, tetapi error muncul jauh kemudian:

```text
NoSuchMethodError
ClassCastException
NoClassDefFoundError
LinkageError
```

Engineer biasa menyebut ini “dependency problem”. Engineer platform melihat ini sebagai **class space modelling failure**.

OSGi mencoba menyelesaikannya dengan membuat dependency menjadi eksplisit, versioned, dan scoped.

---

### 2.2 JAR bukan module yang sebenarnya

JAR hanya arsip file. JAR biasa tidak menjawab:

- Apa identitas module ini?
- Versi module ini apa?
- Package mana yang public API?
- Package mana yang private implementation?
- Package apa yang dibutuhkan?
- Versi package apa yang kompatibel?
- Apa lifecycle module ini?
- Service apa yang disediakan?
- Service apa yang dibutuhkan?
- Apakah module ini boleh di-update saat runtime?

Maven artifact sedikit membantu pada build-time:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.0</version>
</dependency>
```

Tetapi Maven dependency bukan runtime modularity contract. Maven menjawab:

> “Artifact apa yang harus diambil saat build?”

OSGi menjawab:

> “Package apa yang boleh dilihat bundle ini saat runtime, dari provider mana, dengan versi berapa, dan wiring apa yang valid?”

Itu level yang berbeda.

---

### 2.3 Plugin system yang ad-hoc cepat berubah menjadi chaos

Banyak sistem enterprise akhirnya butuh extensibility:

- dynamic business rules
- customer-specific connector
- report renderer
- document template renderer
- validation rule
- workflow/escalation handler
- custom authentication adapter
- device/protocol adapter
- regional compliance module

Tanpa runtime module system, biasanya orang membuat plugin system sendiri:

```java
public interface Plugin {
    void start();
    void stop();
}
```

Lalu plugin dimuat memakai reflection:

```java
Class<?> clazz = Class.forName(pluginClassName);
Plugin plugin = (Plugin) clazz.getDeclaredConstructor().newInstance();
plugin.start();
```

Awalnya terlihat mudah. Kemudian muncul pertanyaan:

- Bagaimana plugin membawa dependency sendiri?
- Bagaimana jika dua plugin butuh versi library berbeda?
- Bagaimana plugin expose service ke host?
- Bagaimana host memilih plugin berdasarkan metadata?
- Bagaimana update plugin tanpa restart penuh?
- Bagaimana rollback plugin?
- Bagaimana mencegah plugin memakai internal class host?
- Bagaimana plugin lifecycle dikelola?
- Bagaimana plugin config berubah saat runtime?
- Bagaimana memeriksa compatibility plugin terhadap host API?

Di titik ini, ad-hoc plugin system mulai membangun ulang sebagian kecil dari OSGi, biasanya tanpa resolver, tanpa versioning disiplin, tanpa lifecycle state machine yang matang, dan tanpa operational tooling.

OSGi adalah jawaban standar untuk problem seperti ini.

---

### 2.4 Runtime evolution

Banyak aplikasi diasumsikan statis:

```text
build -> deploy -> start -> run -> stop -> replace -> start again
```

OSGi lahir dari kebutuhan lebih dinamis:

```text
framework running
install bundle A
resolve bundle A
start bundle A
register service X
install bundle B
B consumes service X
update bundle A
service X temporarily disappears
bundle B reacts
new service X appears
runtime continues
```

Ini tidak berarti semua production system harus hot deploy. Bahkan dalam banyak environment regulated, hot deploy perlu dikontrol ketat. Tetapi mental model OSGi tetap penting: **runtime composition can change**.

Bahkan jika kamu memilih immutable deployment, OSGi tetap memberikan:

- explicit modular boundary
- package-level versioning
- service abstraction
- controlled composition
- feature-level provisioning
- runtime diagnostics

---

## 3. OSGi bukan sekadar plugin framework

OSGi sering dijelaskan sebagai plugin framework karena contoh populernya adalah Eclipse IDE. Eclipse memang berbasis OSGi/Equinox, tetapi menyebut OSGi “plugin framework” saja seperti menyebut database “file reader”.

Plugin adalah salah satu use case. Model yang lebih tepat:

```text
OSGi = dynamic module runtime + service composition platform
```

### 3.1 Plugin framework biasa

Plugin framework sederhana biasanya punya:

- plugin descriptor
- plugin loader
- extension points
- lifecycle start/stop
- maybe classloader per plugin

Tetapi sering tidak punya:

- package-level import/export
- semantic versioned package wiring
- resolver constraint solving
- dynamic service registry standar
- Declarative Services
- Configuration Admin
- Event Admin
- standardized capability/requirement model
- framework lifecycle API
- bundle state model
- runtime introspection

### 3.2 OSGi sebagai dynamic module runtime

OSGi menyediakan beberapa hal secara bersamaan:

```text
+----------------------------------------------------------+
|                    Application Semantics                 |
|  domain services, rules, plugins, connectors, UI, jobs    |
+----------------------------------------------------------+
|                    OSGi Service Layer                    |
|  service registry, service refs, ranking, dynamic binding |
+----------------------------------------------------------+
|                   OSGi Lifecycle Layer                   |
|  install, resolve, start, stop, update, uninstall         |
+----------------------------------------------------------+
|                    OSGi Module Layer                     |
|  bundle, package import/export, classloader, wiring       |
+----------------------------------------------------------+
|                    OSGi Security Layer                   |
|  permissions, signing, trust model                        |
+----------------------------------------------------------+
|                         JVM                              |
+----------------------------------------------------------+
```

Banyak framework hanya menyediakan satu lapisan. OSGi menghubungkan semuanya.

---

## 4. Empat layer mental OSGi

OSGi Core biasanya dipahami melalui beberapa layer. Untuk Part 0, kita gunakan empat layer utama.

### 4.1 Module Layer

Module Layer menjawab:

> “Bundle ini boleh melihat class/package apa?”

Di Java classpath biasa:

```text
semua melihat semua
```

Di OSGi:

```text
bundle A hanya melihat:
- class miliknya sendiri
- package yang di-import dan berhasil di-wire
- package tertentu dari framework/boot delegation
- resource tertentu sesuai rule
```

Contoh manifest:

```text
Bundle-SymbolicName: com.acme.billing.api
Bundle-Version: 1.4.0
Export-Package: com.acme.billing.api;version="1.4.0"
```

Consumer:

```text
Bundle-SymbolicName: com.acme.invoice.impl
Import-Package: com.acme.billing.api;version="[1.4,2)"
```

Artinya:

> `invoice.impl` tidak bergantung ke JAR `billing-api.jar` secara kasar, tetapi membutuhkan package `com.acme.billing.api` dengan versi minimal 1.4 dan kurang dari 2.0.

Ini precision yang jarang ada di classpath biasa.

---

### 4.2 Lifecycle Layer

Lifecycle Layer menjawab:

> “Bundle ini sedang dalam state apa dan boleh diperlakukan bagaimana?”

State utama:

```text
INSTALLED -> RESOLVED -> STARTING -> ACTIVE -> STOPPING -> RESOLVED
      \                                           /
       ---------------- UNINSTALLED -------------
```

Makna penting:

| State | Makna |
|---|---|
| INSTALLED | Bundle ada di framework, tetapi dependency belum resolved. |
| RESOLVED | Dependency/wiring valid, tetapi bundle belum aktif. |
| STARTING | Bundle sedang proses start. |
| ACTIVE | Bundle aktif. Bisa register service, consume service, menjalankan logic. |
| STOPPING | Bundle sedang dihentikan. |
| UNINSTALLED | Bundle sudah dihapus dari framework. |

Kesalahan pemula:

> “Bundle sudah installed berarti bisa dipakai.”

Tidak. Installed hanya berarti JAR diketahui framework. Belum tentu dependency valid.

Kesalahan berikutnya:

> “Bundle sudah resolved berarti service-nya tersedia.”

Tidak. Resolved hanya berarti class/package dependency valid. Service biasanya tersedia setelah bundle/component aktif.

Kesalahan berikutnya:

> “Bundle ACTIVE berarti aplikasi ready.”

Belum tentu. Bisa saja bundle aktif tetapi komponen DS unsatisfied, config missing, external DB down, atau service belum registered.

Top-tier OSGi engineering selalu membedakan:

```text
installed != resolved != active != ready != healthy
```

---

### 4.3 Service Layer

Service Layer menjawab:

> “Bagaimana bundle berkomunikasi tanpa saling mengikat implementasi secara statis?”

Di OSGi, service adalah object Java yang didaftarkan ke service registry berdasarkan interface/type dan properties.

Provider:

```java
public interface PostalCodeResolver {
    Address resolve(String postalCode);
}
```

Implementation:

```java
@Component(service = PostalCodeResolver.class)
public class OneMapPostalCodeResolver implements PostalCodeResolver {
    @Override
    public Address resolve(String postalCode) {
        // call external API
    }
}
```

Consumer:

```java
@Component
public class ApplicationAddressService {
    private final PostalCodeResolver resolver;

    @Activate
    public ApplicationAddressService(@Reference PostalCodeResolver resolver) {
        this.resolver = resolver;
    }
}
```

Tetapi mental model pentingnya bukan annotation. Yang penting:

- provider bisa muncul setelah consumer
- provider bisa hilang saat runtime
- provider bisa diganti oleh ranking lebih tinggi
- multiple provider bisa tersedia
- reference bisa static atau dynamic
- service object punya lifecycle
- registry bukan dependency injection container biasa

Spring bean umumnya diasumsikan stabil setelah application context start. OSGi service registry secara desain bersifat dinamis.

---

### 4.4 Security Layer

Security Layer menjawab:

> “Bundle ini boleh melakukan apa?”

Secara historis OSGi punya permission model yang cukup kaya:

- `AdminPermission`
- `ServicePermission`
- `PackagePermission`
- `CapabilityPermission`
- bundle signing
- conditional permissions

Namun di era Java modern, terutama setelah Security Manager dideprecate dan kemudian makin tidak menjadi fondasi umum untuk sandboxing, security OSGi harus dipahami realistis.

OSGi membantu:

- trust boundary antar bundle
- metadata signing
- permission modelling
- management surface control
- module encapsulation

Tetapi OSGi bukan magic sandbox untuk menjalankan arbitrary untrusted code secara aman di JVM yang sama. Untuk untrusted plugin, isolation proses/container sering tetap lebih aman.

---

## 5. Unit utama OSGi: Bundle

Bundle adalah pusat dari OSGi. Secara fisik, bundle biasanya adalah JAR. Secara runtime, bundle adalah lebih dari JAR.

Bundle memiliki:

- symbolic name
- version
- location
- manifest headers
- private classes/resources
- exported packages
- imported packages
- lifecycle state
- classloader
- wiring
- registered services
- service references
- persistent framework identity

### 5.1 JAR vs Bundle

| Aspek | JAR biasa | OSGi Bundle |
|---|---|---|
| Format fisik | ZIP/JAR | ZIP/JAR dengan manifest OSGi |
| Runtime identity | Tidak standar | `Bundle-SymbolicName` + `Bundle-Version` |
| Class visibility | Classpath global | Import/export package eksplisit |
| Lifecycle | Tidak ada | install/resolve/start/stop/update/uninstall |
| Dependency metadata | Maven/POM build-time | Manifest runtime contract |
| Service model | Tidak ada | Service registry |
| Versioning | Artifact version | Bundle version dan package version |
| Dynamic update | Tidak standar | Bagian dari framework model |

### 5.2 Bundle identity

Contoh:

```text
Bundle-SymbolicName: com.acme.case-management.rules
Bundle-Version: 2.3.1
```

Ini bukan sekadar nama file. File bisa bernama:

```text
rules.jar
rules-2.jar
latest.jar
```

Tetapi runtime identity tetap dari manifest.

Top-tier rule:

> Jangan desain sistem OSGi berdasarkan file name. Desain berdasarkan symbolic name, version, capabilities, dan exported contracts.

---

## 6. Runtime identity vs build identity

Di sistem Java modern, banyak engineer terlalu Maven-centric:

```text
groupId:artifactId:version
```

Itu penting, tetapi bukan keseluruhan cerita di OSGi.

### 6.1 Maven identity

Maven identity:

```text
com.acme:billing-api:1.4.0
```

Dipakai untuk:

- dependency resolution saat build
- artifact repository
- transitive dependency
- reproducible build
- CI/CD

### 6.2 OSGi runtime identity

OSGi identity:

```text
Bundle-SymbolicName: com.acme.billing.api
Bundle-Version: 1.4.0
Export-Package: com.acme.billing.api;version="1.4.0"
```

Dipakai untuk:

- framework runtime
- bundle lifecycle
- package wiring
- service composition
- resolver constraints
- runtime diagnostics

### 6.3 Kenapa perbedaan ini penting?

Satu Maven artifact bisa export beberapa package dengan versi berbeda.

```text
Bundle-Version: 5.0.0
Export-Package:
  com.acme.billing.api;version="2.1.0",
  com.acme.billing.spi;version="1.3.0"
```

Bundle version 5.0.0 tidak otomatis berarti semua API package major version 5. Package version adalah contract yang lebih granular.

Ini salah satu hal yang membuat OSGi lebih presisi daripada artifact-level dependency.

---

## 7. OSGi menjadikan “internal” benar-benar internal

Di Java biasa, package `internal` hanya konvensi.

```text
com.acme.billing.internal.PricingAlgorithm
```

Consumer tetap bisa import class itu jika ada di classpath:

```java
import com.acme.billing.internal.PricingAlgorithm;
```

Di OSGi, package internal tidak diekspor.

```text
Private-Package: com.acme.billing.internal.*
Export-Package: com.acme.billing.api;version="1.4.0"
```

Bundle lain tidak bisa melihat `com.acme.billing.internal` kecuali kamu sengaja membuka visibility.

Ini memaksa discipline:

- API harus jelas
- SPI harus jelas
- implementation hidden
- dependency illegal gagal lebih awal
- refactoring internal lebih aman

Mental model:

> OSGi mengubah boundary dari “social agreement” menjadi “runtime-enforced contract”.

---

## 8. Resolver: dependency bukan sekadar daftar, tetapi constraint graph

Di classpath biasa, dependency resolution mostly build-time. Di OSGi, framework harus menentukan wiring runtime.

Contoh:

```text
Bundle A exports com.acme.payment.api version 1.2.0
Bundle B exports com.acme.payment.api version 2.0.0
Bundle C imports com.acme.payment.api version [1.1,2)
```

Resolver memilih A, bukan B, karena C meminta versi >=1.1 dan <2.0.

Tetapi kasus nyata lebih kompleks:

```text
C imports payment.api [1.1,2)
C imports audit.api [3.0,4)
payment.api uses money.api [1.0,2)
audit.api uses money.api [2.0,3)
```

Sekarang resolver harus menjaga **class space consistency**. Tidak cukup semua package tersedia. Tipe yang saling muncul dalam signature harus berasal dari wiring yang konsisten.

Ini alasan ada konsep seperti:

- `uses:=`
- bundle wiring
- capability/requirement
- mandatory attributes
- optional imports
- resolver hook
- refresh

Part 5 nanti akan sangat dalam. Untuk sekarang, cukup pegang prinsip:

> OSGi resolver bukan “mencari JAR”. Resolver membangun class space yang konsisten.

---

## 9. Service registry: dependency yang hidup, bukan dependency yang mati

Dalam banyak framework DI, dependency dianggap fixed setelah startup.

```text
start app -> create all beans -> app runs
```

Di OSGi:

```text
service provider can appear/disappear/update while framework is running
```

### 9.1 Konsekuensi desain

Kalau service bisa hilang, maka consumer harus punya strategi:

- mandatory reference: component tidak aktif tanpa service
- optional reference: component bisa aktif dengan degraded mode
- multiple reference: component punya list provider dinamis
- dynamic policy: reference bisa berubah saat runtime
- static policy: component restart jika reference berubah
- greedy/reluctant: apakah pindah ke provider ranking lebih tinggi

### 9.2 Contoh domain

Misal sistem regulatory case management punya service:

```java
public interface EscalationRule {
    boolean supports(CaseContext context);
    EscalationDecision evaluate(CaseContext context);
}
```

Bisa ada banyak provider:

```text
late-response-rule
high-risk-agency-rule
repeat-offender-rule
manual-review-rule
```

Dalam OSGi, setiap rule bisa bundle/service sendiri. Host tidak perlu tahu class implementasi. Host hanya memilih service berdasarkan contract dan property.

```text
Service: EscalationRule
Properties:
  rule.id = high-risk-agency
  jurisdiction = SG
  priority = 100
```

Keuntungan:

- rule bisa ditambah tanpa compile host
- rule bisa diganti berdasarkan version
- rule bisa disabled via lifecycle/config
- rule bisa diuji sebagai bundle contract
- rule API bisa dibaseline

Risiko:

- service bisa hilang di tengah proses
- rule ordering harus deterministic
- version compatibility harus dijaga
- stale service reference bisa menyebabkan bug
- long-running process harus punya snapshot semantics

Top-tier design tidak hanya berkata “pakai plugin”. Ia mendefinisikan **service dynamics contract**.

---

## 10. OSGi vs Java classpath

### 10.1 Classpath model

```text
+--------------------------------------------------+
| One Application ClassLoader / large classpath     |
|                                                  |
| app.jar lib-a.jar lib-b.jar lib-c.jar             |
|                                                  |
| Everything can usually see everything             |
+--------------------------------------------------+
```

Keuntungan:

- sederhana
- mudah untuk small application
- ekosistem tooling luas
- cocok untuk Spring Boot style fat jar

Kelemahan:

- weak encapsulation
- dependency conflict sulit
- tidak ada runtime module lifecycle
- dynamic plugin sulit
- versi library berbeda sulit berdampingan
- internal API mudah bocor

### 10.2 OSGi model

```text
+-------------------+       package import/export       +-------------------+
| Bundle A          |----------------------------------->| Bundle API        |
| own classloader   |                                    | exports api pkg   |
+-------------------+                                    +-------------------+

+-------------------+       service registry             +-------------------+
| Bundle B          |<---------------------------------->| Bundle C          |
| consumes service  |                                    | provides service  |
+-------------------+                                    +-------------------+
```

Keuntungan:

- strong modular boundary
- package-level dependency
- dynamic services
- runtime lifecycle
- versioned API contracts
- plugin/extensibility strong
- class space diagnosable

Kelemahan:

- learning curve tinggi
- dependency ecosystem tidak selalu OSGi-ready
- classloader issue lebih eksplisit
- runtime dynamics butuh discipline
- tooling/build harus benar
- debugging butuh mental model resolver

### 10.3 Decision heuristic

Gunakan classpath/fat jar jika:

- aplikasi kecil-menengah
- deployment immutable
- tidak butuh plugin runtime
- dependency conflict rendah
- team tidak butuh runtime modularity

Pertimbangkan OSGi jika:

- aplikasi adalah platform/extensible product
- banyak module dengan lifecycle berbeda
- butuh runtime composition
- butuh strict boundary
- butuh versioned plugin API
- butuh multi-version dependency isolation
- long-lived application harus evolved bertahap

---

## 11. OSGi vs JPMS

JPMS diperkenalkan di Java 9 sebagai Java Platform Module System. JPMS dan OSGi sama-sama bicara modularity, tetapi masalah yang diselesaikan tidak identik.

### 11.1 JPMS mental model

JPMS:

- static module graph pada launch/layer creation
- `module-info.java`
- `requires`
- `exports`
- strong encapsulation
- service loading via `uses/provides`
- sangat relevan untuk modular JDK dan aplikasi modular statis

Contoh:

```java
module com.acme.billing {
    exports com.acme.billing.api;
    requires com.acme.money;
}
```

### 11.2 OSGi mental model

OSGi:

- dynamic bundle lifecycle
- package import/export dengan version range
- runtime resolver
- service registry dinamis
- multiple versions can coexist under controlled wiring
- bundle update/install/uninstall while framework running

Contoh:

```text
Export-Package: com.acme.billing.api;version="1.4.0"
Import-Package: com.acme.money.api;version="[2.0,3)"
```

### 11.3 Perbedaan utama

| Aspek | JPMS | OSGi |
|---|---|---|
| Era | Java 9+ | Sejak jauh sebelum Java 9 |
| Fokus | Static modularity platform/application | Dynamic module runtime |
| Metadata | `module-info.java` | Manifest headers/capabilities |
| Versioning | Tidak punya version resolution built-in seperti OSGi | Package/bundle versioning dan range |
| Lifecycle | Tidak ada lifecycle bundle | install/start/stop/update/uninstall |
| Service | `ServiceLoader` style | Dynamic service registry |
| Multi-version | Tidak menjadi model utama | Bisa, via classloader/wiring |
| Runtime update | Bukan fokus | Bagian dari model |
| Encapsulation | Strong at module level | Strong via classloader/package export |

### 11.4 Cara berpikir yang sehat

Jangan bertanya:

> “OSGi atau JPMS, mana yang menang?”

Pertanyaan yang lebih tepat:

> “Saya butuh static modularity atau dynamic runtime modularity?”

Jika kamu membuat library modern untuk Java 17/21/25, JPMS metadata bisa berguna. Jika kamu membuat platform plugin dinamis, OSGi masih menyelesaikan masalah yang JPMS tidak targetkan secara langsung.

Dalam practice, kamu bisa bertemu kombinasi:

- OSGi berjalan di JVM Java 17/21/25
- bundle memakai library yang punya `module-info`
- OSGi metadata tetap dipakai untuk runtime wiring
- `--add-opens` kadang dibutuhkan untuk library reflective
- multi-release JAR harus dipahami

Part 19 dan 20 nanti akan membahas ini secara serius.

---

## 12. OSGi vs Spring Boot

Spring Boot sangat populer untuk membangun aplikasi Java modern. OSGi bukan pengganti langsung Spring Boot. Mereka berbeda axis.

### 12.1 Spring Boot mental model

Spring Boot:

```text
assemble application -> start ApplicationContext -> beans created -> app runs
```

Karakteristik:

- opinionated application assembly
- dependency injection
- auto-configuration
- fat jar/container friendly
- great developer velocity
- mostly static runtime composition

### 12.2 OSGi mental model

OSGi:

```text
start framework -> install bundles -> resolve wiring -> start bundles/components -> services appear/disappear dynamically
```

Karakteristik:

- modular runtime
- dynamic service registry
- lifecycle-managed bundles
- package-level class visibility
- runtime provisioning
- strong plugin platform capability

### 12.3 Bukan perbandingan “lebih baik”

Spring Boot unggul untuk:

- REST service
- microservice
- CRUD/API service
- cloud-native stateless service
- simple deployment
- fast onboarding

OSGi unggul untuk:

- extensible platform
- dynamic module lifecycle
- multiple product variants
- plugin runtime
- strict modular boundary
- long-lived modular JVM
- service dynamics

### 12.4 Kesalahan umum

Kesalahan framing:

> “OSGi kalah dari Spring Boot.”

Lebih akurat:

> “Untuk banyak aplikasi cloud-native stateless, Spring Boot lebih ekonomis. Untuk dynamic in-process modular platform, OSGi menyelesaikan kelas problem yang berbeda.”

Top-tier engineer tidak fanatik. Ia memilih berdasarkan force architecture.

---

## 13. OSGi vs Microservices

Microservices memecah sistem ke banyak proses/service. OSGi memecah sistem ke banyak module/bundle di dalam satu JVM.

### 13.1 Perbedaan axis decomposition

| Aspek | OSGi | Microservices |
|---|---|---|
| Boundary | In-process module | Network process/service |
| Communication | Java interface/service registry | HTTP/gRPC/message broker |
| Latency | In-memory call | Network call |
| Failure mode | Classloader/lifecycle/service dynamics | Network/partial failure/distributed consistency |
| Deployment | Bundle/runtime distribution | Service/container deployment |
| Data ownership | Bisa shared DB/in-process | Idealnya service-owned data |
| Isolation | Classloader/module | Process/container/network |
| Scaling | Per JVM/runtime | Per service |
| Team autonomy | Medium | High jika boundary benar |

### 13.2 OSGi bukan microservices mini

Jangan membawa semua pola distributed system ke OSGi secara mentah.

Contoh buruk:

```text
Bundle A memanggil Bundle B seolah-olah remote service,
menambahkan DTO berlebihan, retry internal, timeout palsu,
dan circuit breaker untuk method call in-memory.
```

Ingat:

- OSGi service call adalah Java method call biasa.
- Tidak ada network latency.
- Tidak ada serialization boundary kecuali kamu buat sendiri.
- Tetapi ada lifecycle dynamics: service bisa hilang, bundle bisa stop, classloader bisa refresh.

Jadi failure model berbeda.

### 13.3 Kapan OSGi lebih tepat daripada microservices?

OSGi bisa lebih tepat jika:

- module harus sangat low-latency
- deployment harus satu runtime karena operational constraint
- plugin harus berjalan dekat dengan host memory/model
- module count banyak tetapi tidak semua layak jadi service network
- kamu butuh product-line/runtime composition
- kamu ingin avoid distributed transaction/network complexity

### 13.4 Kapan microservices lebih tepat?

Microservices lebih tepat jika:

- team ownership perlu benar-benar independen
- scaling berbeda per capability
- fault isolation proses penting
- security boundary kuat dibutuhkan
- teknologi berbeda diperlukan
- lifecycle deployment harus independen di level service
- data ownership dapat dipisahkan jelas

### 13.5 Hybrid yang sehat

Banyak arsitektur matang bisa hybrid:

```text
Microservice A: Spring Boot
Microservice B: Quarkus
Platform service C: OSGi runtime for plugins/rules/connectors
External broker: Kafka/RabbitMQ
DB boundary: explicit
```

OSGi bisa menjadi **plugin island** di dalam landscape microservices.

---

## 14. OSGi sebagai platform untuk runtime evolution

Salah satu kekuatan OSGi adalah memisahkan konsep:

```text
application runtime != single deployable artifact != single dependency graph
```

Dalam OSGi, runtime bisa terdiri dari banyak bundle:

```text
com.acme.kernel
com.acme.case.api
com.acme.case.impl
com.acme.audit.api
com.acme.audit.impl
com.acme.notification.api
com.acme.notification.email
com.acme.notification.sms
com.acme.rules.api
com.acme.rules.highrisk
com.acme.rules.lateresponse
com.acme.web.http
com.acme.persistence.oracle
```

Kamu bisa mendesain runtime composition:

- base platform
- agency-specific bundles
- optional connector bundles
- experimental feature bundles
- replacement implementation bundles
- versioned API bundles

Ini sangat cocok untuk product/platform yang harus hidup lama dan berubah bertahap.

---

## 15. Mental model: OSGi adalah runtime operating system kecil di atas JVM

Analogi yang membantu:

| Operating System | OSGi |
|---|---|
| Process | Bundle |
| Shared library | Exported package |
| Dynamic linker | Resolver/wiring |
| Service manager | Service registry |
| Package manager | Provisioning/repository/features |
| Init system | Start levels/lifecycle |
| Kernel API | OSGi framework API |
| Permission model | OSGi permissions |

Analogi ini tidak sempurna karena bundle bukan process dan tidak punya memory isolation proses. Tetapi ia membantu secara mental:

> OSGi bukan library. OSGi adalah runtime environment.

Kalau kamu treat OSGi seperti library biasa, kamu akan frustrasi.

Kalau kamu treat OSGi seperti mini runtime OS untuk Java modules, modelnya menjadi lebih masuk akal.

---

## 16. Konsep penting: resolving bukan loading

Di Java biasa, class loading sering terjadi saat class pertama kali dipakai. Di OSGi, ada tahap **resolve** sebelum class benar-benar dipakai.

Resolve memastikan requirement bundle bisa dipenuhi:

- package imports
- required capabilities
- required execution environment
- fragment host
- bundle requirements

Tetapi resolve tidak berarti semua class sudah dimuat. Resolve membangun wiring.

```text
resolve = build valid dependency wiring
load    = actually load class when needed
```

Contoh:

```text
Bundle A imports com.fasterxml.jackson.databind [2.15,3)
Bundle B exports com.fasterxml.jackson.databind 2.17
```

Saat resolve, framework bisa wire A ke B.

Saat runtime, ketika A benar-benar memakai `ObjectMapper`, barulah class dimuat melalui wiring tersebut.

Kesalahan mental:

> “Kalau resolved berarti semua class pasti aman.”

Tidak selalu. Bisa masih ada:

- dynamic reflection ke package yang tidak di-import
- optional dependency yang tidak tersedia
- resource lookup via TCCL
- native library problem
- ServiceLoader problem
- annotation scanner problem

Resolve mengurangi classpath chaos, tetapi tidak menghapus semua failure mode Java.

---

## 17. Konsep penting: start bukan readiness

Bundle lifecycle `ACTIVE` berarti bundle sudah start. Tetapi readiness aplikasi tergantung layer di atasnya.

Contoh bundle aktif tetapi belum ready:

- DS component unsatisfied
- Config Admin belum memberi config
- database belum reachable
- HTTP endpoint belum registered
- migration belum selesai
- service dependency optional sedang unavailable
- background worker belum initialized
- cache warming belum selesai

Jadi production readiness perlu health model sendiri.

```text
Bundle ACTIVE
    != DS component SATISFIED
    != service REGISTERED
    != endpoint READY
    != business capability HEALTHY
```

Top-tier runtime design membuat health check di level capability, bukan hanya bundle state.

---

## 18. Konsep penting: service availability is temporal

Dalam OSGi, service bukan “benda permanen”. Service adalah registrasi runtime yang punya waktu hidup.

```text
t1: service PaymentGateway registered
t2: consumer binds service
t3: provider bundle stops
t4: service unregistered
t5: consumer unbinds or deactivates
t6: new provider registers service
t7: consumer rebinds
```

Jika kamu menyimpan reference service di static variable dan menganggap selamanya valid, kamu melawan model OSGi.

### 18.1 Service dynamics contract

Untuk setiap service penting, tanya:

1. Apakah service mandatory atau optional?
2. Kalau hilang, consumer harus stop atau degrade?
3. Kalau ada provider baru dengan ranking lebih tinggi, consumer pindah atau tetap?
4. Apakah invocation harus snapshot provider list?
5. Apakah service thread-safe?
6. Apakah service bisa dipanggil selama deactivation?
7. Apakah service method boleh blocking?
8. Bagaimana timeout/error model?
9. Bagaimana versioning service contract?
10. Bagaimana observability service binding?

Ini bukan pertanyaan framework. Ini pertanyaan architecture.

---

## 19. OSGi dan Java 8 sampai 25

Seri ini membahas Java 8–25 karena OSGi sering hidup di sistem panjang umur. Banyak platform OSGi mulai dari Java 8 atau 11, kemudian harus naik ke 17, 21, dan akhirnya 25.

### 19.1 Java 8 era

Karakteristik:

- classpath dominan
- Java EE modules masih ada di JDK
- Security Manager masih umum
- illegal reflective access belum isu besar
- OSGi banyak dipakai di app server/platform lama

### 19.2 Java 9+ era

Perubahan besar:

- JPMS hadir
- JDK internal API mulai dienkapsulasi
- module path muncul
- illegal access warning
- beberapa library reflection-heavy mulai bermasalah

### 19.3 Java 11 era

Perubahan penting:

- beberapa Java EE/CORBA module dihapus dari JDK
- JAXB/JAX-WS/Activation harus jadi dependency eksplisit
- banyak enterprise system migrasi dari Java 8 ke 11

### 19.4 Java 17 era

Perubahan penting:

- strong encapsulation makin terasa
- Security Manager deprecated for removal
- banyak framework lama perlu upgrade
- baseline modern enterprise LTS

### 19.5 Java 21 era

Perubahan penting:

- virtual threads final
- structured concurrency masih evolving/preview pada beberapa rilis
- pattern matching makin matang
- modern runtime tuning berubah

### 19.6 Java 25 era

Java 25 adalah rilis modern setelah Java 21 dan menjadi target compatibility penting untuk sistem jangka panjang. Untuk OSGi, perhatian utama bukan syntax baru, tetapi:

- bytecode compatibility
- library compatibility
- reflective access
- module encapsulation
- old bundle dependencies
- ASM/ByteBuddy/CGLIB compatibility
- javax/jakarta dependencies
- execution environment metadata
- test matrix multi-JDK

Top-tier mindset:

> OSGi compatibility bukan hanya “apakah code compile di JDK baru”, tetapi “apakah semua bundle, manifest, dependency, resolver wiring, reflective library, dan runtime framework valid di JDK baru.”

---

## 20. Kenapa OSGi terasa sulit?

OSGi sulit bukan karena API-nya terlalu banyak. OSGi sulit karena ia membuat hal yang biasanya tersembunyi menjadi eksplisit.

### 20.1 Class visibility menjadi eksplisit

Classpath biasa menyembunyikan boundary buruk. OSGi memunculkannya.

Error seperti:

```text
Unable to resolve bundle: missing requirement osgi.wiring.package
```

Bukan selalu “OSGi ribet”. Sering itu berarti dependency model kamu sebelumnya memang implicit dan rapuh.

### 20.2 Lifecycle menjadi eksplisit

Di aplikasi biasa, banyak object hidup selama proses hidup. Di OSGi, bundle/service/component punya lifecycle.

Ini memunculkan masalah:

- kapan resource dibuka?
- kapan ditutup?
- apa yang terjadi saat update?
- apakah thread dihentikan?
- apakah service unregistered?
- apakah static cache bocor?

### 20.3 Versioning menjadi eksplisit

Di banyak project, semantic versioning hanya label. Di OSGi, version range mempengaruhi resolver.

Salah range bisa membuat:

- bundle tidak resolve
- bundle resolve ke provider yang salah
- uses constraint violation
- binary incompatibility
- hidden runtime bug

### 20.4 Dynamic behavior menjadi eksplisit

Service bisa berubah saat runtime. Ini memaksa kamu memahami concurrency dan state transition.

Spring-style static injection sering membuat orang lupa bahwa dependency bisa punya lifecycle. OSGi tidak membiarkan kamu lupa.

---

## 21. OSGi cocok untuk domain apa?

### 21.1 IDE dan desktop platform

Contoh klasik: Eclipse Platform/Equinox.

Kebutuhan:

- banyak plugin
- extension points
- versioned APIs
- dynamic install/update
- long-lived platform

### 21.2 Embedded/IoT/gateway

Kebutuhan:

- module kecil
- update sebagian
- hardware/protocol adapter
- constrained runtime
- service dynamics

### 21.3 Telecom/network platforms

Kebutuhan:

- long-running runtime
- dynamic service deployment
- reliability
- modular protocol/service stacks

### 21.4 Enterprise product platform

Kebutuhan:

- product variants
- customer-specific extension
- API/SPI stability
- versioned plugin ecosystem
- controlled runtime upgrade

### 21.5 Regulated modular systems

Untuk sistem regulatory/case management, OSGi menarik jika ada kebutuhan:

- jurisdiction-specific rules
- agency-specific connector
- dynamically replaceable validation/escalation logic
- strict audit of enabled modules
- versioned business capability
- long-lived runtime with controlled changes
- plugin certification

Tetapi OSGi harus dipakai dengan governance kuat. Jika tidak, ia menjadi modular chaos.

---

## 22. Kapan OSGi tidak cocok?

OSGi tidak otomatis membuat architecture lebih baik.

### 22.1 Simple CRUD service

Jika aplikasi hanya REST CRUD service:

```text
controller -> service -> repository -> database
```

Dan deployment selalu immutable container, OSGi biasanya overhead.

### 22.2 Team belum siap versioning discipline

OSGi membutuhkan discipline:

- API package version
- baseline check
- import range policy
- exported package review
- dependency hygiene
- service lifecycle discipline

Tanpa itu, OSGi menjadi sumber error baru.

### 22.3 Semua dependency non-OSGi dan reflection-heavy

Banyak library modern bisa dipakai di OSGi dengan wrapping/bnd, tetapi tidak semua nyaman.

Masalah umum:

- annotation scanning assumption
- TCCL assumption
- ServiceLoader assumption
- hardcoded classpath scanning
- private JDK API usage
- dynamic proxies across classloader

Jika mayoritas stack sangat classpath-centric, biaya adaptasi tinggi.

### 22.4 Butuh strong isolation untuk untrusted code

OSGi classloader isolation bukan process isolation. Jika plugin benar-benar untrusted, pertimbangkan:

- separate process
- container isolation
- WASM sandbox
- remote execution
- strict network/API boundary

### 22.5 Operational model tidak mendukung runtime mutation

Jika organisasi tidak punya proses untuk:

- bundle update
- version compatibility
- runtime diagnostics
- rollback
- plugin certification
- config management

Maka kemampuan dynamic update OSGi bisa menjadi risiko, bukan benefit.

---

## 23. Bundle boundary: cara berpikir awal

Salah satu pertanyaan tersulit:

> “Apa yang seharusnya menjadi bundle?”

Jawaban buruk:

> “Setiap package jadi bundle.”

Jawaban buruk lain:

> “Satu aplikasi satu bundle besar.”

Jawaban lebih baik:

> “Bundle adalah unit runtime modularity yang punya alasan lifecycle, versioning, ownership, atau replacement yang jelas.”

### 23.1 Indikator sesuatu layak menjadi bundle

Pertimbangkan bundle terpisah jika:

- punya API stabil yang dikonsumsi module lain
- implementasinya bisa diganti
- lifecycle berbeda dari host
- bisa optional
- bisa versioned independently
- bisa diaktifkan/dinonaktifkan
- punya dependency berat yang tidak ingin bocor
- punya ownership/team boundary jelas
- merepresentasikan plugin/extension
- merepresentasikan product feature

### 23.2 Indikator jangan dipisah

Jangan buat bundle terpisah jika:

- hanya helper internal kecil
- selalu berubah bersama parent
- tidak punya lifecycle mandiri
- tidak punya public contract
- split hanya karena folder structure
- membuat package cycle
- menambah resolver complexity tanpa benefit

### 23.3 Rule of thumb

```text
If it has independent runtime meaning, consider a bundle.
If it only has code organization meaning, keep it as package/module inside a bundle.
```

---

## 24. API, SPI, dan implementation dalam OSGi

OSGi sangat cocok untuk memisahkan:

```text
API  = contract consumed by clients
SPI  = extension contract implemented by plugins/providers
Impl = private implementation
```

Contoh struktur:

```text
com.acme.case.api
  CaseService
  CaseDto
  CaseStatus

com.acme.case.spi
  CaseValidationRule
  CaseLifecycleHook

com.acme.case.internal
  DefaultCaseService
  OracleCaseRepository
  CaseStateMachineImpl
```

Manifest:

```text
Export-Package:
  com.acme.case.api;version="2.1.0",
  com.acme.case.spi;version="1.4.0"
Private-Package:
  com.acme.case.internal.*
```

Prinsip:

- API stabil untuk consumer.
- SPI stabil untuk implementer/plugin.
- Impl bebas berubah.
- Jangan export internal package.
- Jangan membuat SPI terlalu lebar.
- Jangan bocorkan implementation class dalam signature API.

### 24.1 Contoh kebocoran implementation

Buruk:

```java
public interface CaseService {
    OracleCaseEntity findCase(String id);
}
```

Masalah:

- API bocor ke persistence implementation.
- Consumer perlu package entity internal.
- Classloader/wiring makin kompleks.
- Migration DB sulit.

Lebih baik:

```java
public interface CaseService {
    CaseDto findCase(String id);
}
```

Atau untuk domain internal yang controlled:

```java
public interface CaseService {
    CaseAggregate findCase(CaseId id);
}
```

Asal aggregate berada di exported API package yang memang stabil.

---

## 25. Service contract bukan hanya Java interface

Di OSGi, service contract minimal memang Java interface. Tetapi secara engineering, contract harus lebih luas.

Service contract harus menjelaskan:

1. Thread safety.
2. Lifecycle expectation.
3. Error model.
4. Timeout/blocking behavior.
5. Idempotency.
6. Reentrancy.
7. Transaction expectation.
8. Configuration dependency.
9. Versioning policy.
10. Service properties.
11. Ranking semantics.
12. Dynamic rebinding behavior.

Contoh contract yang lemah:

```java
public interface NotificationSender {
    void send(Notification notification);
}
```

Pertanyaan yang belum terjawab:

- Apakah `send` blocking?
- Apakah retry dilakukan di dalam?
- Apakah exception checked/unchecked?
- Apakah method idempotent?
- Apakah implementation thread-safe?
- Apakah `Notification` immutable?
- Apakah provider bisa di-unregister saat send berjalan?
- Bagaimana memilih email vs SMS?

Contract lebih matang:

```java
public interface NotificationSender {
    DeliveryResult send(NotificationRequest request) throws DeliveryException;
}
```

Service properties:

```text
channel=email
region=sg
priority=100
supports.html=true
```

Contract text:

```text
- Implementations must be thread-safe.
- send() may block up to configured provider timeout.
- Callers must provide idempotencyKey.
- DeliveryException means accepted delivery could not be confirmed.
- Provider ranking selects preferred implementation for same channel.
- Consumers requiring deterministic behavior should snapshot selected service per business transaction.
```

Top-tier OSGi design menulis hal-hal ini, bukan hanya interface.

---

## 26. OSGi dan state machine thinking

OSGi sangat cocok dipahami sebagai kumpulan state machine.

### 26.1 Bundle state machine

```text
INSTALLED
  -> RESOLVED
  -> STARTING
  -> ACTIVE
  -> STOPPING
  -> RESOLVED
  -> UNINSTALLED
```

### 26.2 Component state machine

Untuk Declarative Services:

```text
DISABLED
  -> ENABLED
  -> UNSATISFIED_REFERENCE / UNSATISFIED_CONFIGURATION
  -> SATISFIED
  -> ACTIVE
  -> DEACTIVATING
```

### 26.3 Service reference state machine

```text
UNBOUND
  -> BOUND(provider A)
  -> REBINDING(provider B)
  -> UNBOUND
```

### 26.4 Configuration state machine

```text
ABSENT
  -> PRESENT_VALID
  -> PRESENT_INVALID
  -> UPDATED
  -> DELETED
```

### 26.5 Runtime capability state machine

Contoh capability “postal code resolution”:

```text
UNAVAILABLE
  -> AVAILABLE_DEGRADED(cache-only)
  -> AVAILABLE_FULL(api+cache)
  -> DEGRADED(rate-limited)
  -> UNAVAILABLE(config-error)
```

Engineer top-tier tidak hanya melihat “bundle aktif”. Ia memodelkan capability dan transisi failure.

---

## 27. Dynamic runtime membutuhkan idempotency

Karena bundle/service/component bisa start/stop/update, lifecycle method harus idempotent secara praktis.

### 27.1 Buruk

```java
public void start(BundleContext context) {
    executor = Executors.newSingleThreadExecutor();
    executor.submit(this::runForever);
}

public void stop(BundleContext context) {
    // forgot shutdown
}
```

Masalah:

- thread leak saat bundle stop/update
- old classloader tertahan
- memory leak
- duplicate worker setelah restart

### 27.2 Lebih baik

```java
public void start(BundleContext context) {
    executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "case-worker");
        t.setDaemon(false);
        return t;
    });
    running.set(true);
    future = executor.submit(this::runLoop);
}

public void stop(BundleContext context) {
    running.set(false);
    if (future != null) {
        future.cancel(true);
    }
    if (executor != null) {
        executor.shutdownNow();
    }
}
```

Lebih baik lagi: gunakan DS lifecycle dan managed executor/service pattern jika sesuai.

Prinsip:

> Setiap resource yang dibuat saat activate/start harus punya pasangan cleanup saat deactivate/stop.

Resource termasuk:

- thread
- executor
- timer
- scheduled task
- socket
- file handle
- DB connection
- service registration
- service tracker
- listener
- MBean
- cache
- classloader-bound object

---

## 28. OSGi membuat coupling terlihat

Di sistem non-OSGi, coupling sering tersembunyi:

```java
import com.acme.case.internal.DefaultCaseService;
import com.acme.audit.impl.OracleAuditWriter;
```

Selama compile, semua aman. Setelah bertahun-tahun, refactoring sulit.

Di OSGi, jika package internal tidak diexport, coupling seperti ini gagal.

Itu bukan kelemahan. Itu feedback architecture.

### 28.1 Coupling yang harus dilihat

OSGi membantu melihat:

- package coupling
- service coupling
- lifecycle coupling
- version coupling
- implementation leakage
- classloader coupling
- optional dependency coupling

### 28.2 Coupling yang sehat

Coupling tidak bisa dihapus. Yang benar adalah membuatnya eksplisit dan stabil.

Sehat:

```text
case.impl imports case.api
case.impl imports audit.api
case.impl references AuditService
```

Tidak sehat:

```text
case.impl imports audit.internal.oracle
case.impl reflectively loads audit implementation
case.impl assumes audit service always exists
```

---

## 29. OSGi design forces: apa yang harus ditimbang?

Saat memutuskan OSGi architecture, pertimbangkan force berikut.

### 29.1 Modularity force

Apakah kita butuh boundary kuat atau hanya code organization?

Jika hanya code organization, Java package/Maven module mungkin cukup.

Jika butuh runtime boundary, OSGi relevan.

### 29.2 Evolution force

Apakah module berubah dengan cadence berbeda?

Jika semua selalu release bersama, OSGi mungkin overhead.

Jika API stable dan provider/plugin berubah independen, OSGi cocok.

### 29.3 Runtime dynamics force

Apakah module harus bisa muncul/hilang/diganti saat runtime?

Jika ya, OSGi sangat relevan.

Jika tidak, OSGi masih bisa dipakai untuk modularity, tetapi benefit dynamic-nya berkurang.

### 29.4 Dependency conflict force

Apakah sistem punya banyak dependency conflict?

OSGi bisa membantu, tetapi tidak gratis. Kamu harus paham resolver dan classloading.

### 29.5 Operational force

Apakah tim bisa mengoperasikan OSGi runtime?

Butuh:

- shell/diagnostics
- bundle state monitoring
- service graph inspection
- provisioning discipline
- rollback strategy
- config management

### 29.6 Organization force

Apakah tim bisa menjaga API/SPI contract?

Tanpa governance, OSGi hanya memindahkan chaos dari classpath ke manifest.

---

## 30. Contoh arsitektur OSGi untuk regulatory/case platform

Bayangkan platform enforcement lifecycle.

### 30.1 Non-OSGi monolith

```text
case-management.jar
  controller
  service
  repository
  escalation rules
  validation rules
  email sender
  document renderer
  external connectors
  audit writer
```

Masalah setelah sistem besar:

- rule makin banyak
- connector beda agency
- perubahan satu rule trigger regression besar
- internal class saling dipakai
- sulit disable feature
- sulit maintain API/SPI
- deployment selalu all-or-nothing

### 30.2 OSGi platform

```text
com.acme.platform.kernel
com.acme.case.api
com.acme.case.impl
com.acme.case.spi
com.acme.case.rules.late-response
com.acme.case.rules.high-risk
com.acme.case.rules.repeat-offender
com.acme.audit.api
com.acme.audit.impl.oracle
com.acme.notification.api
com.acme.notification.email.smtp
com.acme.document.api
com.acme.document.freemarker
com.acme.connector.api
com.acme.connector.onemap
com.acme.connector.singpass
com.acme.web.http
```

### 30.3 Service registry view

```text
EscalationRule services:
  - late-response-rule       priority=100 jurisdiction=SG
  - high-risk-rule           priority=200 jurisdiction=SG
  - repeat-offender-rule     priority=150 jurisdiction=SG

NotificationSender services:
  - smtp-email-sender        channel=email priority=100
  - mock-email-sender        channel=email priority=10 env=dev

AddressResolver services:
  - onemap-address-resolver  country=SG priority=100
  - cache-only-resolver      country=SG priority=10 degraded=true
```

### 30.4 Architecture question

Untuk setiap business capability, tanya:

- Apakah ini API, SPI, atau impl?
- Apakah provider bisa multiple?
- Apakah provider optional?
- Bagaimana ranking ditentukan?
- Bagaimana versioning contract?
- Bagaimana failure handled?
- Apakah lifecycle independent?
- Apakah config per provider?
- Apakah runtime update boleh?
- Bagaimana audit terhadap provider aktif?

Inilah cara OSGi membuat architecture lebih eksplisit.

---

## 31. “Hot deployment” bukan selalu tujuan

Banyak orang mengira OSGi berarti harus hot deploy di production. Tidak.

OSGi memungkinkan runtime update, tetapi strategi production bisa berbeda.

### 31.1 Mutable runtime

```text
runtime stays running
install/update bundles dynamically
refresh wiring if needed
```

Cocok untuk:

- development
- controlled plugin platform
- desktop/IDE
- embedded/gateway tertentu
- low-risk modules

Risiko:

- partial update
- state migration
- old classloader retained
- in-flight operation impact
- rollback complexity

### 31.2 Immutable distribution

```text
build full OSGi distribution
deploy as immutable artifact/container
restart runtime
```

Cocok untuk:

- regulated production
- Kubernetes/container environment
- strict release process
- simpler rollback

Tetap mendapatkan benefit OSGi:

- modular boundary
- resolver validation
- package versioning
- service architecture
- feature composition
- runtime diagnostics

### 31.3 Top-tier view

> OSGi gives you dynamic capability. Production policy decides how much dynamism is allowed.

Jangan samakan capability dengan policy.

---

## 32. “Bundle ACTIVE” tidak berarti semua aman: contoh failure chain

Misal runtime punya:

```text
case.impl -> AuditService -> audit.impl.oracle -> Oracle DataSource
```

Kondisi:

- `audit.impl.oracle` bundle ACTIVE
- `AuditService` registered
- DataSource config salah
- connection pool belum bisa connect

Apa yang terjadi?

Kemungkinan:

1. AuditService registered tetapi gagal saat method dipanggil.
2. Component tidak aktif karena config invalid.
3. Component aktif dalam degraded mode.
4. Service registered dengan property `health=degraded`.
5. Consumer tidak tahu dan tetap memanggil.

OSGi tidak otomatis menentukan business semantics. Kamu yang harus desain.

Better design:

```text
AuditService registered only when minimum capability available
AuditHealth service exposes readiness
CaseService has policy for audit failure:
  - fail closed for enforcement action
  - allow but queue audit for non-critical draft save
```

Part 25 nanti akan membahas observability dan troubleshooting. Tetapi mental modelnya dimulai di sini.

---

## 33. OSGi dan classloader leak

Karena setiap bundle punya classloader, update bundle bisa meninggalkan old classloader jika ada reference yang menahannya.

Contoh penyebab:

- static singleton di bundle lain menyimpan object dari old bundle
- thread yang dibuat bundle lama masih hidup
- ThreadLocal menyimpan class dari old bundle
- JDBC driver tidak deregister
- logger/appender menyimpan class
- service tracker tidak ditutup
- listener tidak di-unregister
- executor tidak shutdown

Akibat:

```text
bundle updated
new classloader created
old classloader retained
memory grows
old behavior still appears
ClassCastException between old/new classes
```

Apache Felix FAQ bahkan membahas situasi bundle update tetapi class lama masih digunakan; salah satu penyebabnya adalah exported package masih dipakai bundle lain sehingga refresh/wiring belum berubah.

Prinsip:

> Dalam OSGi, lifecycle cleanup bukan hygiene biasa. Ia menentukan apakah runtime bisa berevolusi tanpa bocor.

---

## 34. Cara membaca error OSGi secara mental

### 34.1 Missing requirement

```text
Unable to resolve bundle com.acme.case.impl
Missing requirement: osgi.wiring.package=com.acme.audit.api; version>=2.0.0
```

Artinya:

- bundle butuh package `com.acme.audit.api`
- tidak ada exporter yang cocok
- atau exporter ada tapi version range tidak cocok
- atau exporter tidak resolved
- atau uses constraint membuat pilihan invalid

Jangan langsung tambahkan dependency sembarangan. Tanya:

1. Siapa yang seharusnya export package itu?
2. Apakah package itu memang API?
3. Versinya benar?
4. Consumer range benar?
5. Apakah bundle exporter installed?
6. Apakah exporter resolved?
7. Apakah ada duplicate exporter?

### 34.2 ClassCastException

```text
com.acme.api.CaseDto cannot be cast to com.acme.api.CaseDto
```

Ini terlihat absurd, tetapi dalam classloader world masuk akal.

Maknanya:

```text
same FQCN, different classloader/wiring
```

Penyebab umum:

- package duplicated in multiple bundles
- API embedded in consumer and provider
- split package
- wrong import/export
- TCCL loads different copy

### 34.3 NoClassDefFoundError

Bisa berarti:

- package tidak di-import
- optional import tidak tersedia
- class referenced only reflectively
- dependency embedded tidak masuk Bundle-ClassPath
- JPMS strong encapsulation issue
- dynamic generated class tidak bisa melihat type

Mental model:

> Error classloading adalah gejala class space. Jangan debug hanya dari Maven tree.

---

## 35. OSGi architecture smell list sejak awal

Kamu akan mendalami anti-pattern di Part 30, tapi sejak Part 0 perlu kenal baunya.

### 35.1 Export everything

```text
Export-Package: com.acme.*
```

Buruk karena internal implementation bocor.

### 35.2 DynamicImport everywhere

```text
DynamicImport-Package: *
```

Buruk karena mengembalikan sebagian classpath chaos.

### 35.3 Require-Bundle everywhere

```text
Require-Bundle: com.acme.audit.impl
```

Sering terlalu coupling ke bundle, bukan package/API.

### 35.4 API bundle membawa implementation dependency

API bundle seharusnya ringan dan stabil. Jika API bundle import Hibernate/Jackson internal/DB driver, kemungkinan boundary salah.

### 35.5 Service interface bocor ke implementation type

```java
OracleAuditEntity audit(CaseEntity entity);
```

Ini bukan API stabil.

### 35.6 Static global registry

Membuat service locator static sendiri mengabaikan service registry OSGi.

### 35.7 Long-running thread tidak dihentikan

Menyebabkan classloader leak dan shutdown/update issue.

### 35.8 Version range asal-asalan

```text
Import-Package: com.acme.api;version="0.0.0"
```

Atau range terlalu luas tanpa compatibility guarantee.

### 35.9 Split package

Package yang sama tersebar di beberapa bundle. Bisa menyebabkan wiring dan class identity problem.

### 35.10 Tidak ada baseline check

API berubah tetapi version tidak dinaikkan dengan benar.

---

## 36. Bagaimana OSGi mengubah cara desain package

Di Java biasa, package sering hanya struktur folder.

Di OSGi, package adalah unit visibility dan versioning.

### 36.1 Package sebagai API boundary

```text
com.acme.payment.api        exported, versioned
com.acme.payment.spi        exported, versioned, for providers
com.acme.payment.internal   private
```

### 36.2 Package versioning

Package API punya version sendiri:

```text
Export-Package: com.acme.payment.api;version="1.3.0"
```

Consumer menyatakan range:

```text
Import-Package: com.acme.payment.api;version="[1.2,2)"
```

### 36.3 Design implication

Perubahan kecil di API harus dievaluasi:

- binary compatible?
- source compatible?
- semantic compatible?
- provider compatible?
- consumer compatible?
- perlu minor/major bump?

OSGi memaksa package menjadi contract, bukan folder.

---

## 37. Bagaimana OSGi mengubah cara desain dependency

Di Maven, dependency biasanya artifact-level:

```text
A depends on B
```

Di OSGi, lebih presisi:

```text
A imports package x.y.z version [1.2,2)
```

### 37.1 Artifact-level thinking

```text
case-impl depends on audit-impl
```

Ini coupling kasar.

### 37.2 Package/service-level thinking

```text
case-impl imports audit-api package
case-impl references AuditService
audit-oracle-impl provides AuditService
```

Ini lebih sehat.

### 37.3 Dependency inversion alami

OSGi mendorong:

```text
consumer -> api
provider -> api
provider registers service
consumer binds service
```

Bukan:

```text
consumer -> provider implementation
```

---

## 38. Bagaimana OSGi mengubah cara desain deployment

Di deployment biasa:

```text
one app artifact
```

Di OSGi:

```text
runtime distribution = framework + bundles + configuration + repository/provisioning metadata
```

Deployment bukan hanya JAR, tetapi composition.

### 38.1 Distribution contents

```text
runtime/
  framework/
  bundles/
    org.apache.felix.framework.jar
    com.acme.case.api.jar
    com.acme.case.impl.jar
    com.acme.audit.api.jar
    com.acme.audit.impl.oracle.jar
  config/
    com.acme.audit.impl.oracle.cfg
  launch.properties
  repositories/
  logs/
```

### 38.2 Provisioning question

- Bundle apa yang wajib?
- Bundle apa yang optional?
- Feature apa yang aktif?
- Version set mana yang certified?
- Config mana yang cocok dengan bundle version?
- Rollback ke set mana?
- Apakah framework cache persistent?
- Apakah runtime immutable?

Ini membuat release engineering lebih mirip platform distribution.

---

## 39. OSGi dan governance

OSGi memberi power. Tanpa governance, power itu menjadi masalah.

### 39.1 Governance minimal

Untuk OSGi serius, butuh aturan:

1. Semua exported package harus direview.
2. Semua API package harus punya version.
3. Baseline check wajib di CI.
4. `DynamicImport-Package: *` dilarang kecuali exceptional dan documented.
5. `Require-Bundle` harus justified.
6. Split package dilarang.
7. Bundle activator tidak boleh melakukan heavy blocking startup.
8. Lifecycle cleanup wajib.
9. Service contract harus document thread-safety dan dynamics.
10. Runtime distribution harus reproducible.

### 39.2 Architecture Decision Record

Contoh ADR untuk OSGi:

```text
ADR: Use OSGi service registry for case rule extensions

Context:
- Regulatory rules vary by agency/jurisdiction.
- Rules need versioned API/SPI boundaries.
- Host must not depend on rule implementation.

Decision:
- Define com.acme.case.rules.spi as exported package.
- Rule providers register EscalationRule services with properties.
- Host consumes multiple services with deterministic ordering.
- Runtime deployment uses immutable distribution in production.

Consequences:
- Need baseline checks for SPI.
- Need resolver tests for rule bundles.
- Need service graph diagnostics.
- Need governance for service properties.
```

Top-tier OSGi engineering adalah kombinasi technical model + governance model.

---

## 40. Minimal vocabulary sebelum lanjut Part 1

| Istilah | Makna singkat |
|---|---|
| Framework | Runtime OSGi yang mengelola bundle, lifecycle, service, resolver. |
| Bundle | Unit modular/deployment/runtime identity. Biasanya JAR dengan manifest OSGi. |
| Manifest | Metadata bundle di `META-INF/MANIFEST.MF`. |
| Bundle-SymbolicName | Nama unik bundle di runtime. |
| Bundle-Version | Versi bundle. |
| Package Version | Versi contract package yang diexport. |
| Export-Package | Package yang dibuka untuk bundle lain. |
| Import-Package | Package yang dibutuhkan dari bundle lain. |
| Private-Package | Package yang masuk bundle tetapi tidak diexport. |
| Resolver | Komponen yang menentukan wiring valid antar bundle. |
| Wiring | Hubungan resolved antara requirement dan capability/package provider. |
| Service Registry | Registry runtime untuk publish/lookup/bind service object. |
| Service Reference | Handle metadata/reference ke service registered. |
| Declarative Services | Model component declarative untuk register/consume service. |
| Bundle Lifecycle | State install/resolve/start/stop/update/uninstall. |
| Start Level | Mekanisme ordering startup framework/bundle. |
| Fragment | Bundle yang menempel ke host bundle. |
| Capability | Kemampuan yang disediakan resource/bundle. |
| Requirement | Kebutuhan yang harus dipenuhi resolver. |
| Class Space | Ruang class visible untuk bundle berdasarkan classloader dan wiring. |
| Uses Constraint | Constraint agar type yang berhubungan memakai class space konsisten. |
| Refresh | Proses memperbarui wiring dan classloader setelah update. |

---

## 41. Cara berpikir top 1% ketika melihat sistem OSGi

Saat melihat sistem OSGi, jangan mulai dari code. Mulai dari runtime model.

### 41.1 Pertanyaan pertama: runtime composition

```text
Bundle apa saja yang membentuk runtime ini?
```

Lihat:

- framework implementation
- API bundles
- implementation bundles
- extender bundles
- config bundles
- web bundles
- persistence bundles
- plugin bundles
- third-party wrapped bundles

### 41.2 Pertanyaan kedua: boundary

```text
Package mana yang diexport dan kenapa?
```

Jika terlalu banyak export, boundary buruk.

### 41.3 Pertanyaan ketiga: wiring

```text
Siapa mengimpor package dari siapa?
```

Jangan hanya lihat Maven dependency tree. Lihat resolved wiring.

### 41.4 Pertanyaan keempat: service graph

```text
Service apa yang tersedia, provider-nya siapa, consumer-nya siapa?
```

Service graph sering lebih penting daripada bundle graph.

### 41.5 Pertanyaan kelima: lifecycle dynamics

```text
Apa yang terjadi jika provider berhenti?
Apa yang terjadi jika config berubah?
Apa yang terjadi jika bundle update?
```

### 41.6 Pertanyaan keenam: compatibility

```text
Apakah package version dan import range benar?
```

### 41.7 Pertanyaan ketujuh: operational model

```text
Bagaimana runtime diprovision, dimonitor, didiagnosa, dirollback?
```

Top-tier engineer melihat OSGi sebagai living runtime graph.

---

## 42. Latihan mental: mengubah fitur menjadi desain OSGi

Ambil fitur:

> Sistem harus mendukung beberapa cara mengirim notifikasi: email SMTP, SMS vendor, mock sender untuk testing, dan future WhatsApp sender.

### 42.1 Desain naive

```java
public class NotificationService {
    private final SmtpClient smtp;
    private final SmsClient sms;

    public void send(Notification n) {
        if (n.channel().equals("email")) smtp.send(n);
        if (n.channel().equals("sms")) sms.send(n);
    }
}
```

Masalah:

- host tahu semua implementation
- dependency vendor bocor
- sulit tambah channel
- sulit disable provider
- sulit mock runtime
- deployment semua provider jadi satu

### 42.2 Desain OSGi

API bundle:

```text
com.acme.notification.api
```

Interface:

```java
public interface NotificationSender {
    DeliveryResult send(NotificationRequest request) throws DeliveryException;
}
```

Provider bundles:

```text
com.acme.notification.email.smtp
com.acme.notification.sms.vendorx
com.acme.notification.mock
```

Service properties:

```text
channel=email
provider=smtp
priority=100
```

Consumer:

```text
NotificationRouter references multiple NotificationSender services
selects by channel/provider/ranking
```

### 42.3 Design questions

- Apakah sender mandatory?
- Jika channel tidak ada, fail atau queue?
- Apakah provider bisa berubah saat runtime?
- Apakah selection deterministic?
- Apakah result idempotent?
- Apakah provider config valid sebelum register service?
- Apakah request DTO stable?
- Apakah provider version compatible?

Inilah bedanya memakai OSGi sebagai architecture tool, bukan sekadar framework.

---

## 43. Latihan mental: rule engine sebagai OSGi services

Fitur:

> Case escalation rule bisa berbeda per module, jurisdiction, dan agency.

### 43.1 API/SPI

```java
public interface EscalationRule {
    RuleEvaluation evaluate(CaseSnapshot snapshot);
}
```

Service properties:

```text
rule.id=late-response
jurisdiction=SG
agency=CEA
priority=100
version=1.2.0
```

### 43.2 Runtime behavior

Host references multiple rules:

```text
List<EscalationRule>
```

But must define:

- sort order
- filtering
- conflict resolution
- timeout
- exception policy
- audit trail
- deterministic snapshot

### 43.3 Snapshot problem

Jika service list dynamic, jangan biarkan list berubah di tengah evaluasi case.

Better:

```text
At transaction start:
  snapshot available rule services and metadata
Evaluate fixed snapshot
Audit rule ids + versions used
```

Ini sangat penting untuk regulated systems.

### 43.4 Auditability

OSGi runtime harus bisa menjawab:

```text
Pada 2026-06-17 10:15:00,
case X dievaluasi memakai rule bundle apa,
versi berapa,
service property apa,
dan wiring API versi berapa?
```

Ini contoh bagaimana OSGi bisa mendukung defensible runtime architecture jika didesain benar.

---

## 44. The OSGi mindset in one diagram

```text
                         +----------------------+
                         | Runtime Distribution |
                         | bundles + config     |
                         +----------+-----------+
                                    |
                                    v
+-------------------+     +---------+----------+      +--------------------+
| Bundle Metadata   |---->| Resolver / Wiring  |<-----| Repositories        |
| imports/exports   |     | class space graph   |      | capabilities        |
+-------------------+     +---------+----------+      +--------------------+
                                    |
                                    v
                         +----------+-----------+
                         | Bundle Lifecycle     |
                         | install/start/stop   |
                         +----------+-----------+
                                    |
                                    v
                         +----------+-----------+
                         | Service Registry     |
                         | dynamic services     |
                         +----------+-----------+
                                    |
                                    v
                         +----------+-----------+
                         | Business Capability  |
                         | rules/connectors/web |
                         +----------------------+
```

Jika ada bug di business capability, jangan hanya debug business code. Periksa juga:

- metadata
- resolver wiring
- lifecycle state
- service binding
- configuration
- runtime distribution

---

## 45. Checklist pemahaman Part 0

Kamu siap lanjut ke Part 1 jika bisa menjawab pertanyaan berikut.

### 45.1 Conceptual

1. Apa perbedaan JAR biasa dan OSGi bundle?
2. Kenapa OSGi bukan sekadar plugin framework?
3. Apa perbedaan build-time dependency dan runtime wiring?
4. Apa perbedaan bundle version dan package version?
5. Apa arti package sebagai contract?
6. Kenapa `ACTIVE` tidak sama dengan ready?
7. Kenapa service registry disebut dynamic?
8. Apa konsekuensi service bisa hilang saat runtime?
9. Apa bedanya OSGi dan JPMS?
10. Apa bedanya OSGi dan microservices?

### 45.2 Architecture

1. Kapan sesuatu layak menjadi bundle?
2. Kapan tidak layak menjadi bundle?
3. Bagaimana memisahkan API, SPI, dan implementation?
4. Apa smell dari export semua package?
5. Apa smell dari DynamicImport everywhere?
6. Apa governance minimal untuk OSGi project?
7. Bagaimana mendesain plugin rule agar auditably deterministic?
8. Bagaimana membedakan capability health dan bundle state?

### 45.3 Operational

1. Apa yang harus dibersihkan saat bundle stop?
2. Kenapa old classloader bisa retained setelah update?
3. Apa bedanya mutable runtime dan immutable OSGi distribution?
4. Apa yang perlu dimonitor selain bundle ACTIVE?
5. Bagaimana rollback dipikirkan dalam OSGi?

---

## 46. Ringkasan prinsip utama

1. **OSGi adalah dynamic module system, bukan hanya plugin framework.**
2. **Bundle adalah runtime identity, bukan sekadar JAR file.**
3. **Package adalah visibility dan versioning contract.**
4. **Resolver membangun class space yang konsisten.**
5. **Service registry adalah dynamic service model, bukan DI container statis.**
6. **Lifecycle adalah bagian dari desain, bukan detail framework.**
7. **Classloader isolation membuat coupling terlihat.**
8. **Hot deployment adalah capability, bukan kewajiban production.**
9. **OSGi dan JPMS menyelesaikan problem modularity yang berbeda.**
10. **OSGi dan microservices memecah sistem pada axis berbeda.**
11. **OSGi cocok untuk platform yang butuh extensibility, versioned runtime composition, dan long-term evolution.**
12. **OSGi gagal jika dipakai tanpa governance versioning, boundary, dan operational discipline.**

---

## 47. Referensi utama

Referensi ini dipakai sebagai basis konseptual untuk Part 0 dan akan muncul lagi di part berikutnya:

1. OSGi Core Release 8 Specification — terutama bagian Introduction, Module Layer, Life Cycle Layer, Service Layer, Wiring, dan Framework API.  
2. OSGi Specifications page — daftar rilis Core/Compendium resmi.  
3. Apache Felix OSGi Tutorial — contoh bertahap bundle dan service pada implementasi Felix.  
4. Apache Felix FAQ — troubleshooting seperti bundle update dan class lama masih digunakan.  
5. Eclipse Equinox documentation — konteks implementasi framework dan execution environment.  
6. bnd/Bndtools documentation — tooling modern untuk build, manifest generation, resolver, dan runtime assembly.

---

## 48. Apa yang akan dibahas di Part 1?

Part berikutnya:

```text
01-osgi-core-architecture-framework-layers-runtime-invariants.md
```

Fokusnya:

- struktur OSGi Core secara sistematis
- framework sebagai state machine
- bundle lifecycle detail
- bundle events
- service events
- start levels
- framework cache
- install vs resolve vs start
- invariants yang harus selalu benar
- failure model awal sebelum masuk classloading dan resolver detail

Part 0 belum masuk terlalu dalam ke API karena tugasnya membentuk mental model. Part 1 mulai membedah runtime core secara lebih formal dan operasional.

---

## Status series

Series **belum selesai**.  
Kita baru menyelesaikan:

```text
Part 0 dari 35
```

