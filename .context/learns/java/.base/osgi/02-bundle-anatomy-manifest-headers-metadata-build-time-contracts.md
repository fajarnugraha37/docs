# Part 2 — Bundle Anatomy: Manifest, Headers, Metadata, and Build-Time Contracts

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `02-bundle-anatomy-manifest-headers-metadata-build-time-contracts.md`  
Target Java: 8 sampai 25  
Level: Advanced / platform engineering  
Status: Part 2 dari 35

---

## 0. Tujuan Part Ini

Pada Part 0 kita membangun mental model bahwa OSGi bukan sekadar plugin framework, melainkan **dynamic module runtime**.

Pada Part 1 kita melihat OSGi sebagai **runtime state machine**: bundle bisa `INSTALLED`, `RESOLVED`, `STARTING`, `ACTIVE`, `STOPPING`, dan `UNINSTALLED`. Kita juga melihat bahwa `ACTIVE` bukan berarti semua service siap, dan `RESOLVED` bukan berarti bundle sudah berjalan.

Part 2 masuk ke benda yang terlihat sederhana tetapi sebenarnya menjadi pusat kontrak OSGi: **bundle manifest**.

Di Java biasa, JAR sering dianggap sebagai kantong class. Di OSGi, JAR berubah menjadi **runtime participant** karena ia membawa metadata yang mendefinisikan:

1. identitas modul,
2. versi modul,
3. package yang diekspos,
4. package yang dibutuhkan,
5. lifecycle entry point,
6. capability yang disediakan,
7. capability yang dibutuhkan,
8. fragment relationship,
9. execution environment,
10. service component descriptor,
11. classpath internal bundle,
12. dan kontrak build-time yang menentukan apakah runtime bisa menyelesaikan dependency graph.

Tujuan akhir part ini adalah membuat kamu bisa membaca sebuah OSGi bundle seperti engineer senior membaca contract artifact: bukan hanya “ini ada manifest”, tetapi:

- apa identitas runtime bundle ini,
- apa API publiknya,
- apa yang sengaja disembunyikan,
- apa yang dibutuhkan dari runtime,
- apa yang bisa rusak ketika versi naik,
- apa yang harus dicek di CI,
- apa yang harus dicurigai saat troubleshooting,
- dan apakah bundle ini dirancang sebagai modul sehat atau hanya JAR biasa yang dipaksa menjadi OSGi.

---

## 1. Core Mental Model: Bundle = JAR + Runtime Contract

Secara fisik, bundle adalah JAR.

Secara arsitektural, bundle adalah:

```text
Bundle = content + identity + dependency contract + visibility contract + lifecycle contract
```

Atau lebih detail:

```text
OSGi Bundle
├── Java bytecode
├── resources
├── optional embedded libraries
├── META-INF/MANIFEST.MF
│   ├── identity metadata
│   ├── lifecycle metadata
│   ├── import/export metadata
│   ├── capability/requirement metadata
│   ├── fragment metadata
│   ├── classpath metadata
│   └── tool/runtime metadata
└── optional OSGi descriptors
    ├── Declarative Services XML
    ├── Blueprint XML
    ├── Metatype XML
    └── other extender descriptors
```

Kalau Java classpath biasa bertanya:

> “Apakah class ini ada di classpath?”

OSGi bertanya:

> “Bundle mana yang menyediakan package ini, pada versi berapa, dengan constraint apa, dan apakah bundle consumer secara eksplisit mengimpornya?”

Ini pergeseran mental yang besar.

Di classpath, visibility default-nya luas. Semua JAR cenderung bisa saling melihat selama ada di classpath.

Di OSGi, visibility default-nya sempit. Bundle hanya bisa melihat:

1. package dari Java runtime,
2. package yang ada di dalam bundle sendiri,
3. package yang diimpor dari bundle lain,
4. package dari fragment attached,
5. package yang tersedia melalui special mechanisms seperti boot delegation atau dynamic import, jika diaktifkan.

Manifest adalah tempat rules ini dideklarasikan.

---

## 2. Kenapa Manifest Adalah Kontrak, Bukan Dekorasi

Dalam banyak project Java biasa, `MANIFEST.MF` jarang dipikirkan. Kadang hanya berisi:

```text
Manifest-Version: 1.0
Main-Class: com.example.Main
```

Di OSGi, manifest adalah executable metadata.

Runtime menggunakannya untuk menjawab pertanyaan seperti:

- apakah bundle ini valid?
- symbolic name-nya apa?
- versinya apa?
- package apa yang ia ekspor?
- package apa yang ia butuhkan?
- apakah import wajib atau optional?
- apakah bundle ini fragment?
- apakah bundle ini memiliki activator?
- apakah bundle ini memiliki Declarative Services component?
- apakah bundle ini menyediakan capability tertentu?
- apakah bundle ini membutuhkan extender tertentu?
- apakah bundle ini compatible dengan execution environment runtime?

Jadi manifest bukan sekadar metadata pasif. Manifest adalah **input resolver**.

Jika manifest salah, error bisa muncul di beberapa fase:

```text
Build time
  └── manifest invalid, missing import, accidental export

Install time
  └── bundle rejected karena format invalid

Resolve time
  └── unsatisfied import / capability / execution environment

Start time
  └── activator gagal, DS component gagal, missing class saat lazy path

Runtime
  └── ClassCastException, service missing, stale classloader, optional import null path
```

Top-tier OSGi engineering bukan menunggu error runtime. Ia membuat manifest menjadi artifact yang bisa diaudit, diuji, dan distabilkan di CI.

---

## 3. Struktur Fisik Bundle

Bundle pada dasarnya adalah file `.jar` dengan struktur seperti ini:

```text
my.company.case.rules-1.2.3.jar
├── META-INF/
│   ├── MANIFEST.MF
│   └── maven/...
├── OSGI-INF/
│   ├── com.mycompany.case.rules.DefaultRuleEngine.xml
│   └── metatype/...
├── com/mycompany/case/rules/api/
│   ├── Rule.class
│   ├── RuleContext.class
│   └── RuleResult.class
├── com/mycompany/case/rules/internal/
│   ├── DefaultRuleEngine.class
│   └── RuleCompiler.class
└── config/defaults.properties
```

Yang membedakan bundle sehat dan bundle bermasalah bukan hanya isi class-nya, tetapi apakah manifest-nya menyatakan boundary dengan benar.

Contoh manifest ringkas:

```text
Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.mycompany.case.rules
Bundle-Name: Case Rules Engine
Bundle-Version: 1.2.3
Bundle-Description: Rule engine for case lifecycle evaluation
Bundle-Vendor: My Company
Export-Package: com.mycompany.case.rules.api;version="1.2.0"
Private-Package: com.mycompany.case.rules.internal
Import-Package: org.osgi.service.component.annotations;version="[1.5,2)";resolution:=optional,
 com.mycompany.case.api;version="[2.1,3)",
 org.slf4j;version="[1.7,3)"
Service-Component: OSGI-INF/com.mycompany.case.rules.DefaultRuleEngine.xml
```

Perhatikan bahwa manifest ini menceritakan desain:

- bundle identity: `com.mycompany.case.rules`, version `1.2.3`,
- API yang diekspor: `com.mycompany.case.rules.api`, version `1.2.0`,
- implementasi internal disembunyikan,
- bundle membutuhkan `com.mycompany.case.api` versi `[2.1,3)`,
- bundle memakai SLF4J,
- runtime harus memproses DS descriptor.

Dengan membaca manifest saja, kita sudah bisa memahami sebagian besar contract bundle.

---

## 4. Identitas Bundle

### 4.1 `Bundle-SymbolicName`

`Bundle-SymbolicName` adalah identitas stabil bundle.

Contoh:

```text
Bundle-SymbolicName: com.mycompany.case.rules
```

Ini bukan sekadar nama file. Nama file bisa berubah:

```text
case-rules.jar
case-rules-1.2.3.jar
case-rules-prod-hotfix.jar
```

Tetapi symbolic name seharusnya tetap menjadi identitas logis bundle.

Dalam runtime, kombinasi penting biasanya:

```text
Bundle Identity = Bundle-SymbolicName + Bundle-Version
```

Prinsip desain:

1. gunakan reverse-DNS style,
2. jangan pakai nama terlalu generik,
3. jangan ubah symbolic name sembarangan,
4. symbolic name harus merepresentasikan boundary arsitektural,
5. jangan menjadikan symbolic name sebagai tempat environment, misalnya `case.rules.uat`,
6. jangan menjadikan symbolic name sebagai tempat deployment instance.

Contoh baik:

```text
com.mycompany.aceas.case.rules
com.mycompany.aceas.notification.email
com.mycompany.platform.audit.api
com.mycompany.platform.audit.provider.oracle
```

Contoh buruk:

```text
rules
case
common
utils
prod.rules
new-module
osgi-bundle-1
```

Kenapa buruk?

- tidak globally unique,
- tidak jelas boundary,
- rawan collision,
- sulit dibaca saat troubleshooting,
- sulit dipetakan ke ownership tim.

### 4.2 Symbolic Name dan Singleton

`Bundle-SymbolicName` dapat memiliki directive `singleton:=true`.

Contoh:

```text
Bundle-SymbolicName: com.mycompany.platform.kernel;singleton:=true
```

Maknanya: framework resolver tidak boleh resolve lebih dari satu bundle dengan symbolic name singleton yang sama pada waktu yang sama.

Ini berguna untuk bundle yang secara konseptual harus satu instance aktif dalam runtime, misalnya:

- platform kernel,
- extension registry,
- global UI workbench,
- framework integration bundle.

Tetapi jangan overuse.

Jika semua bundle dibuat singleton, kamu kehilangan beberapa fleksibilitas version coexistence.

Pertanyaan desain:

```text
Apakah dua versi bundle ini boleh coexist dalam runtime yang sama?
```

Jika ya, jangan singleton.

Jika tidak, pertimbangkan singleton.

### 4.3 `Bundle-Version`

Contoh:

```text
Bundle-Version: 1.2.3
```

OSGi version memiliki bentuk:

```text
major.minor.micro.qualifier
```

Contoh:

```text
1.0.0
1.2.3
2.0.0.beta1
2.1.0.20260617
```

Catatan penting:

- bundle version bukan package version,
- bundle version menunjukkan versi artifact/deployment unit,
- package version menunjukkan versi API package,
- kedua hal ini sering terkait tetapi tidak identik.

Contoh:

```text
Bundle-Version: 1.4.7
Export-Package: com.mycompany.case.rules.api;version="1.2.0"
```

Artinya bundle artifact sudah versi 1.4.7, tetapi API package yang diekspos masih versi 1.2.0.

Ini wajar jika perubahan 1.2.0 ke 1.4.7 hanya bugfix internal.

Top-tier OSGi engineer tidak otomatis menyamakan bundle version dengan package version.

### 4.4 `Bundle-Name`, `Bundle-Description`, `Bundle-Vendor`

Header ini lebih manusiawi:

```text
Bundle-Name: Case Rules Engine
Bundle-Description: Evaluates enforcement case lifecycle rules
Bundle-Vendor: My Company
```

Tidak terlalu mempengaruhi resolver, tetapi penting untuk:

- console diagnostics,
- web console,
- inventory,
- operational readability,
- support/debugging.

Prinsip:

- isi dengan jelas,
- jangan terlalu panjang,
- jangan copy-paste semua bundle dengan description sama,
- jangan isi vendor kosong untuk artifact enterprise yang perlu audit.

---

## 5. `Bundle-ManifestVersion`

Contoh:

```text
Bundle-ManifestVersion: 2
```

Ini header kecil tetapi penting.

Maknanya: bundle menggunakan aturan manifest OSGi Release 4 atau lebih baru.

Dalam praktik modern, hampir semua bundle OSGi valid menggunakan:

```text
Bundle-ManifestVersion: 2
```

Jangan bingung dengan:

```text
Manifest-Version: 1.0
```

Keduanya berbeda.

`Manifest-Version` berasal dari format JAR Java standar.

`Bundle-ManifestVersion` berasal dari OSGi.

Contoh normal:

```text
Manifest-Version: 1.0
Bundle-ManifestVersion: 2
```

Jika `Bundle-ManifestVersion` tidak ada, framework bisa memperlakukan bundle sebagai bundle lama atau bahkan bukan bundle valid tergantung konteks.

Prinsip:

- untuk bundle modern, selalu ada `Bundle-ManifestVersion: 2`,
- jangan menghapusnya karena “tidak kelihatan dipakai”,
- biarkan tool seperti bnd menghasilkan header ini.

---

## 6. Lifecycle Metadata

### 6.1 `Bundle-Activator`

Contoh:

```text
Bundle-Activator: com.mycompany.case.rules.internal.Activator
```

Activator adalah class yang mengimplementasikan `org.osgi.framework.BundleActivator`.

Bentuk dasarnya:

```java
package com.mycompany.case.rules.internal;

import org.osgi.framework.BundleActivator;
import org.osgi.framework.BundleContext;

public final class Activator implements BundleActivator {
    @Override
    public void start(BundleContext context) throws Exception {
        // startup logic
    }

    @Override
    public void stop(BundleContext context) throws Exception {
        // shutdown logic
    }
}
```

Activator memberi kontrol lifecycle rendah. Tetapi dalam OSGi modern, banyak kasus lebih baik memakai Declarative Services.

Gunakan activator jika:

1. kamu sedang membangun framework-level integration,
2. kamu perlu registrasi manual service sangat rendah level,
3. kamu membuat custom extender,
4. kamu butuh mengontrol tracker/hook/framework API secara eksplisit,
5. kamu tahu persis konsekuensi start/stop.

Hindari activator jika:

1. hanya untuk membuat service biasa,
2. hanya untuk membaca config,
3. hanya untuk dependency injection,
4. hanya untuk startup initialization yang bisa direpresentasikan sebagai DS component,
5. logic start-nya blocking lama.

Contoh anti-pattern:

```java
public void start(BundleContext context) throws Exception {
    database.connect();
    loadAllRules();
    warmupAllTemplates();
    callExternalSystem();
    startScheduler();
}
```

Masalah:

- bundle start bisa lama,
- framework startup tertahan,
- dependency ordering jadi implicit,
- failure bisa membuat bundle gagal aktif,
- testing sulit,
- runtime dynamics tidak natural.

Lebih baik pecah menjadi DS components dengan dependencies dan config yang eksplisit.

### 6.2 `Service-Component`

Contoh:

```text
Service-Component: OSGI-INF/com.mycompany.case.rules.DefaultRuleEngine.xml
```

Header ini memberi tahu Declarative Services runtime bahwa bundle ini memiliki component descriptor.

Descriptor biasanya generated dari annotation:

```java
@Component(service = RuleEngine.class)
public final class DefaultRuleEngine implements RuleEngine {
    @Reference
    private RuleRepository repository;
}
```

Menjadi XML di dalam bundle:

```text
OSGI-INF/com.mycompany.case.rules.DefaultRuleEngine.xml
```

Lalu manifest memiliki:

```text
Service-Component: OSGI-INF/com.mycompany.case.rules.DefaultRuleEngine.xml
```

Poin penting:

- DS runtime adalah extender,
- ia mencari header `Service-Component`,
- lalu membaca descriptor,
- lalu mengelola lifecycle component,
- component bisa aktif hanya jika references dan configuration terpenuhi.

Jika header ini hilang, class dengan annotation `@Component` tidak otomatis aktif. Annotation hanya build-time input. Runtime membaca descriptor, bukan source annotation.

Kesalahan umum:

```text
Saya sudah pakai @Component, tapi service tidak muncul.
```

Kemungkinan:

- DS XML tidak generated,
- `Service-Component` tidak ada,
- SCR/DS runtime belum terinstall,
- component unsatisfied,
- package import untuk annotation salah,
- config required belum ada.

Part DS akan membahas detailnya, tetapi di Part 2 kita perlu paham bahwa `Service-Component` adalah bagian manifest contract.

---

## 7. Visibility Metadata: Public API vs Private Implementation

Inilah bagian paling penting dari bundle anatomy.

OSGi memaksa kamu menjawab:

```text
Package mana yang merupakan API publik?
Package mana yang private implementation?
Package mana yang dibutuhkan dari luar?
```

Dalam classpath biasa, pertanyaan ini sering kabur. Semua public class dalam semua JAR bisa digunakan oleh siapa saja.

Di OSGi, class `public` belum tentu public untuk bundle lain. Public Java hanya berarti public di level language. Agar terlihat oleh bundle lain, package-nya harus diekspor.

### 7.1 `Export-Package`

Contoh:

```text
Export-Package: com.mycompany.case.rules.api;version="1.2.0"
```

Artinya bundle menyediakan package ini untuk diimpor bundle lain.

Ini adalah kontrak publik.

Jika kamu export package, kamu secara efektif mengatakan:

> “Bundle lain boleh compile dan run terhadap package ini sesuai versi yang saya nyatakan.”

Maka export harus diperlakukan seperti public API.

Rule desain:

1. export API package, bukan implementation package,
2. selalu beri package version,
3. jangan export `internal`, `impl`, `config`, `repository.impl`,
4. jangan export semua package karena malas,
5. jangan export third-party package kecuali memang sedang wrapping library,
6. jangan export package yang masih sering berubah tanpa versioning policy.

Contoh baik:

```text
Export-Package: \
 com.mycompany.case.rules.api;version="1.2.0",\
 com.mycompany.case.rules.spi;version="1.1.0"
```

Contoh buruk:

```text
Export-Package: com.mycompany.case.rules.*
```

Masalah:

- implementation ikut exposed,
- internal class bisa dipakai bundle lain,
- future refactor menjadi breaking,
- API surface tidak terkendali,
- baseline checking jadi noise.

### 7.2 API Package Naming

Rekomendasi struktur:

```text
com.mycompany.case.rules.api
com.mycompany.case.rules.spi
com.mycompany.case.rules.internal
com.mycompany.case.rules.internal.persistence
com.mycompany.case.rules.internal.compiler
```

Makna:

- `api`: consumer-facing contract,
- `spi`: provider/plugin-facing contract,
- `internal`: tidak boleh dipakai bundle lain.

Alternatif:

```text
com.mycompany.case.rules
com.mycompany.case.rules.spi
com.mycompany.case.rules.internal
```

Bisa juga API di package root, tetapi untuk enterprise besar biasanya suffix `api` membuat boundary lebih jelas.

### 7.3 `Private-Package`

`Private-Package` adalah instruksi build bnd, bukan header standar OSGi runtime yang sama levelnya seperti `Export-Package`.

Contoh:

```text
Private-Package: com.mycompany.case.rules.internal.*
```

Maknanya dalam bnd/build tooling:

- copy package ini ke bundle,
- tetapi jangan export.

Jadi package ada di dalam bundle dan bisa dipakai bundle sendiri, tetapi tidak visible untuk bundle lain.

Contoh:

```text
Export-Package: com.mycompany.case.rules.api;version="1.2.0"
Private-Package: com.mycompany.case.rules.internal.*
```

Hasil mental:

```text
Visible to other bundles:
  com.mycompany.case.rules.api

Only visible inside this bundle:
  com.mycompany.case.rules.internal
  com.mycompany.case.rules.internal.persistence
  com.mycompany.case.rules.internal.compiler
```

Prinsip penting:

- `Private-Package` membantu menentukan isi bundle,
- `Export-Package` membantu menentukan isi sekaligus visibility,
- jika package cocok dengan keduanya, export biasanya menang,
- jangan gunakan wildcard tanpa review,
- jangan bergantung pada default tool jika boundary penting.

### 7.4 `-exportcontents`

Dalam bnd, ada situasi ketika package sudah ada dalam bundle karena embedded dependency atau included resource, tetapi kamu ingin hanya menambahkan export metadata tanpa menyalin ulang package.

Itu bisa memakai `-exportcontents`.

Konsep ini advance dan biasanya muncul saat wrapping atau embedding library.

Mental model:

```text
Export-Package     = copy package into bundle and export it
Private-Package    = copy package into bundle but do not export it
-exportcontents    = export package already present in bundle content
```

Jangan gunakan `-exportcontents` jika belum memahami isi bundle karena bisa membuat package yang tidak kamu kontrol menjadi API publik.

---

## 8. Dependency Metadata: `Import-Package`

### 8.1 Apa Itu `Import-Package`

Contoh:

```text
Import-Package: \
 com.mycompany.case.api;version="[2.1,3)",\
 org.slf4j;version="[1.7,3)",\
 org.osgi.framework;version="[1.10,2)"
```

Ini berarti bundle membutuhkan package tersebut dari bundle lain atau framework.

OSGi resolver akan mencari provider yang mengekspor package sesuai constraints.

Poin penting:

- import adalah package-level dependency,
- bukan JAR-level dependency,
- bukan Maven artifact-level dependency,
- bukan module-level dependency seperti JPMS,
- resolver melihat package name + attributes + version range + directives.

### 8.2 Kenapa Package-Level Dependency Penting

Misalnya kamu menggunakan library `com.fasterxml.jackson.databind.ObjectMapper`.

Classpath mindset:

```text
Saya butuh jackson-databind.jar
```

OSGi mindset:

```text
Saya butuh package com.fasterxml.jackson.databind pada versi yang compatible.
```

Manifest bisa berisi:

```text
Import-Package: com.fasterxml.jackson.databind;version="[2.15,3)"
```

Runtime tidak peduli provider-nya berasal dari artifact apa selama ada bundle yang mengekspor package tersebut dengan versi compatible.

Ini memberi fleksibilitas, tetapi juga butuh disiplin.

### 8.3 Version Range

Contoh:

```text
Import-Package: com.mycompany.case.api;version="[2.1,3)"
```

Makna:

```text
minimum inclusive: 2.1.0
maximum exclusive: 3.0.0
```

Consumer mengatakan:

> “Saya compatible dengan API case versi 2.1 sampai sebelum 3.0.”

Jangan import tanpa version range untuk API penting.

Buruk:

```text
Import-Package: com.mycompany.case.api
```

Karena default range bisa terlalu luas dan membuat runtime menerima provider yang sebenarnya tidak compatible.

Terlalu sempit juga buruk:

```text
Import-Package: com.mycompany.case.api;version="[2.1.4,2.1.5)"
```

Ini membuat patch-level upgrade terlalu sulit.

General policy untuk semantic API:

```text
Provider exports: 2.1.0
Consumer imports: [2.1,3)
```

Untuk API yang belum stabil:

```text
Consumer imports: [0.3,0.4)
```

Atau lebih konservatif:

```text
Consumer imports: [1.2,1.3)
```

Policy detail akan dibahas di Part 6.

### 8.4 Mandatory vs Optional Import

Default `Import-Package` adalah mandatory.

Contoh:

```text
Import-Package: com.mycompany.audit.api;version="[1.0,2)"
```

Jika provider tidak ada, bundle tidak bisa resolve.

Optional import:

```text
Import-Package: com.mycompany.audit.api;version="[1.0,2)";resolution:=optional
```

Artinya bundle tetap bisa resolve walaupun package tidak ada.

Tetapi optional import bukan magic.

Jika code tetap memanggil class dari package optional saat package tidak wired, runtime bisa gagal.

Contoh bahaya:

```java
public final class AuditIntegration {
    private final AuditClient client = new AuditClient();
}
```

Jika `AuditClient` berasal dari optional import yang tidak tersedia, class loading bisa gagal saat class tersebut diload.

Optional import sebaiknya dipakai jika:

1. code path benar-benar guarded,
2. integration bisa disabled,
3. reflection digunakan dengan hati-hati,
4. service dynamics lebih cocok tetapi library memaksa static type,
5. bundle memang support optional feature.

Lebih baik, sering kali desain optional integration sebagai service:

```java
@Component
public final class CaseService {
    @Reference(cardinality = ReferenceCardinality.OPTIONAL)
    volatile AuditService auditService;
}
```

Dengan ini optionality berada di service layer, bukan classloading layer.

### 8.5 `bundle-symbolic-name` dan `bundle-version` di Import

`Import-Package` dapat mengunci provider bundle tertentu:

```text
Import-Package: com.mycompany.case.api;version="[2.1,3)";bundle-symbolic-name="com.mycompany.case.api.bundle"
```

Atau:

```text
Import-Package: com.mycompany.case.api;bundle-version="[2.0,3)"
```

Hati-hati.

Ini membuat dependency lebih ketat. Biasanya package version sudah cukup.

Gunakan provider constraint hanya jika:

- kamu benar-benar butuh provider tertentu,
- ada multiple exporter yang tidak semantically equivalent,
- kamu sedang mengontrol platform closed-world,
- kamu sedang menangani package yang disediakan oleh bundle wrapper khusus.

Jika tidak, kamu mengurangi substitutability OSGi.

---

## 9. `Require-Bundle`: JAR-Level Coupling dalam Dunia Package-Level

Contoh:

```text
Require-Bundle: com.mycompany.case.api;bundle-version="[2.0,3)"
```

`Require-Bundle` membuat bundle bergantung pada bundle lain, bukan hanya package tertentu.

Ini sering terasa lebih mudah karena mirip “dependency ke artifact”. Tetapi trade-off-nya berat:

- coupling lebih besar,
- bundle provider sulit diganti,
- lebih rawan dependency leakage,
- lebih sulit version coexistence,
- lebih sulit memahami API yang benar-benar dipakai.

`Require-Bundle` masih punya use case:

1. Eclipse plugin ecosystem historis,
2. bundle besar dengan extension model tertentu,
3. platform yang memang memakai bundle as unit of API,
4. re-export controlled API,
5. migration dari legacy plugin architecture.

Tetapi untuk desain OSGi modern, default preference:

```text
Prefer Import-Package over Require-Bundle
```

Karena import package lebih eksplisit dan lebih granular.

Contoh perbandingan:

```text
Require-Bundle: com.mycompany.case
```

Kamu bergantung pada seluruh bundle.

```text
Import-Package: com.mycompany.case.api;version="[2.1,3)"
```

Kamu hanya bergantung pada package API yang dipakai.

Part 4 dan 5 akan membahas dependency model dan resolver lebih dalam.

---

## 10. `Bundle-ClassPath`: Internal Classpath Bundle

### 10.1 Apa Itu `Bundle-ClassPath`

Default bundle classpath adalah root bundle:

```text
Bundle-ClassPath: .
```

Kamu bisa menambahkan embedded JAR:

```text
Bundle-ClassPath: .,lib/some-library.jar
```

Artinya classloader bundle akan mencari class di root bundle dan di embedded JAR.

Struktur:

```text
my.bundle.jar
├── META-INF/MANIFEST.MF
├── com/mycompany/app/internal/App.class
└── lib/some-library.jar
```

Manifest:

```text
Bundle-ClassPath: .,lib/some-library.jar
```

### 10.2 Kenapa Embedded JAR Menarik

Embedded JAR berguna ketika:

- library tidak tersedia sebagai OSGi bundle,
- kamu ingin membuat self-contained bundle,
- kamu ingin isolate dependency tertentu,
- kamu sedang wrapping legacy library,
- kamu butuh shade-like behavior tetapi tetap dalam bundle model.

### 10.3 Kenapa Embedded JAR Berbahaya

Embedded JAR bisa menciptakan masalah:

1. duplicate packages,
2. hidden version conflict,
3. class identity issue,
4. package tidak terlihat oleh resolver,
5. dependency transitif tersembunyi,
6. sulit patch CVE library karena terkubur di banyak bundle,
7. memory overhead karena library sama di-embed berkali-kali,
8. inconsistent provider antara embedded copy dan exported copy.

Contoh buruk:

```text
Bundle A embeds jackson-databind 2.13
Bundle B embeds jackson-databind 2.15
Bundle C imports com.fasterxml.jackson.databind from platform bundle 2.16
```

Sekarang runtime punya beberapa class identity untuk Jackson.

Masalah muncul ketika object crossing boundary:

```text
Bundle A ObjectMapper != Bundle B ObjectMapper != Platform ObjectMapper
```

Secara FQCN sama, tetapi classloader berbeda.

### 10.4 Preferensi Desain

General rule:

```text
Prefer shared OSGi bundles for shared APIs/libraries.
Use embedding for private implementation details only.
```

Jika dependency tidak pernah keluar dari bundle boundary, embedding bisa diterima.

Jika type dari dependency muncul dalam public API/service contract, jangan embed private copy.

Contoh aman:

```java
// public API does not expose commons-compress type
public interface DocumentArchiveService {
    byte[] zipDocuments(List<Document> documents);
}
```

`commons-compress` bisa private embedded.

Contoh berbahaya:

```java
public interface JsonCustomizationService {
    void customize(com.fasterxml.jackson.databind.ObjectMapper mapper);
}
```

Jika `ObjectMapper` berasal dari embedded private copy, bundle lain bisa mengalami class mismatch.

### 10.5 bnd FAQ Perspective

Dalam praktik modern bnd, sering lebih disarankan untuk tahu package mana yang masuk bundle melalui `Private-Package` dan `Export-Package`, bukan asal memakai `Bundle-ClassPath` untuk mengangkut JAR penuh.

Mental model:

```text
Do not hide architecture inside embedded JARs.
Make package boundaries explicit.
```

---

## 11. Fragments: Metadata yang Mengubah Host Bundle

### 11.1 `Fragment-Host`

Fragment bundle tidak memiliki classloader sendiri. Ia attach ke host bundle dan menambahkan content ke host.

Manifest fragment:

```text
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.mycompany.case.rules.oracle.fragment
Bundle-Version: 1.0.0
Fragment-Host: com.mycompany.case.rules;bundle-version="[1.2,2)"
```

Makna:

- bundle ini fragment,
- ia attach ke host `com.mycompany.case.rules`,
- host version harus cocok dengan `[1.2,2)`.

Fragment dipakai untuk:

1. localization resources,
2. platform-specific native code,
3. test fragments,
4. patch/hotfix tertentu,
5. contribution resource ke host,
6. legacy extension model.

Fragment berbahaya karena:

- mengubah class/resource space host,
- tidak punya lifecycle independent seperti normal bundle,
- bisa menyembunyikan coupling,
- bisa membuat host behavior berubah tanpa API jelas,
- bisa sulit dilacak.

Prinsip:

```text
Use fragments when you need to extend host content/classpath, not as normal dependency mechanism.
```

Jangan gunakan fragment hanya karena ingin “mengakses internal host”. Itu biasanya tanda boundary salah.

---

## 12. Capability and Requirement Metadata

OSGi modern tidak hanya package dependency. Ia punya generic capability/requirement model.

### 12.1 `Provide-Capability`

Contoh:

```text
Provide-Capability: \
 com.mycompany.rule.engine;version:Version="1.0.0";engine="drools"
```

Bundle ini menyatakan bahwa ia menyediakan capability tertentu.

### 12.2 `Require-Capability`

Contoh:

```text
Require-Capability: \
 com.mycompany.rule.engine;filter:="(&(engine=drools)(version>=1.0.0))"
```

Bundle ini membutuhkan capability tertentu.

Capability/requirement berguna untuk dependency yang tidak cocok direpresentasikan sebagai package import.

Contoh:

- extender requirement,
- implementation feature,
- native environment,
- contract namespace,
- custom platform feature,
- Java execution environment,
- service capability metadata,
- deployment profile.

### 12.3 Extender Requirement

Contoh umum untuk Declarative Services:

```text
Require-Capability: \
 osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.5.0)(!(version>=2.0.0)))"
```

Maknanya bundle membutuhkan DS extender.

Kenapa penting?

Karena jika bundle memiliki `Service-Component`, tetapi runtime tidak menyediakan DS extender, component tidak akan diproses.

Dengan `Require-Capability`, resolver bisa gagal lebih awal daripada runtime diam-diam tidak menjalankan component.

Top-tier mindset:

```text
If runtime semantic depends on an extender, declare the extender requirement.
```

### 12.4 Execution Environment Capability

Java runtime juga dapat dimodelkan sebagai capability.

Misalnya bundle membutuhkan JavaSE 17.

Dalam OSGi modern, ini bisa direpresentasikan via capability/requirement namespace `osgi.ee`.

Contoh konsep:

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

Detail versi dan tooling bisa berbeda, tetapi mental model-nya:

```text
Bundle should explicitly declare minimum Java execution environment.
```

Untuk Java 8 sampai 25, ini penting karena:

- bytecode Java 21 tidak bisa berjalan di Java 17,
- library yang memakai API Java 11 tidak bisa berjalan di Java 8,
- reflective access berubah di Java 9+,
- javax modules hilang setelah Java 8,
- old bundle bisa jalan di JDK baru, tetapi bundle baru belum tentu jalan di JDK lama.

---

## 13. Execution Environment Metadata

### 13.1 `Bundle-RequiredExecutionEnvironment`

Header historis:

```text
Bundle-RequiredExecutionEnvironment: JavaSE-1.8
```

Atau:

```text
Bundle-RequiredExecutionEnvironment: JavaSE-11
```

Header ini menyatakan execution environment minimum.

Di OSGi modern, capability-based requirement lebih umum untuk resolver model, tetapi kamu masih akan menemukan header ini di banyak ecosystem.

### 13.2 Java 8 sampai 25 Implication

Untuk series ini, kita perlu sadar bahwa bundle metadata harus merefleksikan target Java.

Contoh matrix:

```text
Target bytecode Java 8
  -> can run on Java 8, 11, 17, 21, 25 in principle
  -> but library/runtime behavior may differ

Target bytecode Java 17
  -> cannot run on Java 8 or 11
  -> can run on Java 17, 21, 25 in principle

Target bytecode Java 21
  -> cannot run on Java 17
  -> can run on Java 21, 25 in principle

Target bytecode Java 25
  -> cannot run on Java 21 or older
```

Manifest harus konsisten dengan bytecode.

Salah satu bug buruk:

```text
Bundle says JavaSE-1.8
but bytecode is Java 17
```

Runtime Java 8 akan gagal dengan:

```text
UnsupportedClassVersionError
```

CI harus mengecek:

- compiler target,
- release flag,
- bundle EE metadata,
- dependency bytecode level,
- OSGi runtime support.

---

## 14. Header Grammar: Attribute vs Directive

OSGi manifest header punya grammar yang harus dipahami.

Contoh:

```text
Import-Package: com.mycompany.case.api;version="[2.1,3)";resolution:=optional
```

Di sini:

```text
com.mycompany.case.api    = clause path/name
version="[2.1,3)"        = attribute
resolution:=optional      = directive
```

Perbedaan:

```text
attribute uses =
directive uses :=
```

Attribute mendeskripsikan property yang bisa dipakai matching.

Directive mengarahkan behavior framework/tooling.

Contoh attributes:

```text
version="1.2.0"
bundle-version="[1.0,2)"
bundle-symbolic-name="com.mycompany.api"
```

Contoh directives:

```text
resolution:=optional
uses:="com.mycompany.case.api,org.slf4j"
singleton:=true
include:="*.class"
exclude:="*Internal*"
```

Kesalahan kecil antara `=` dan `:=` bisa mengubah makna.

Contoh salah:

```text
Import-Package: com.mycompany.audit.api;resolution=optional
```

Ini membuat `resolution` sebagai attribute biasa, bukan directive. Resolver tidak memperlakukannya sebagai optional.

Yang benar:

```text
Import-Package: com.mycompany.audit.api;resolution:=optional
```

---

## 15. Line Wrapping Manifest

Manifest JAR punya aturan format line continuation.

Contoh fisik dalam `MANIFEST.MF`:

```text
Import-Package: com.mycompany.case.api;version="[2.1,3)",com.mycompany.au
 dit.api;version="[1.0,2)",org.slf4j;version="[1.7,3)"
```

Baris lanjutan diawali satu spasi.

Ini bisa membingungkan saat membaca raw manifest.

Tool biasanya mengurus wrapping otomatis.

Jangan edit raw manifest manual kecuali benar-benar perlu.

Jika kamu salah wrapping, manifest bisa invalid atau value berubah.

Prinsip:

```text
Generate manifest with tooling. Review manifest as artifact. Do not maintain large OSGi manifests manually.
```

---

## 16. Build-Time Manifest Generation

### 16.1 Manual Manifest vs Generated Manifest

Manual manifest terlihat sederhana di awal:

```text
Bundle-SymbolicName: com.mycompany.foo
Export-Package: com.mycompany.foo.api
Import-Package: org.slf4j,com.mycompany.bar.api
```

Tetapi cepat membusuk karena:

- dependency berubah,
- package baru ditambahkan,
- import transitif berubah,
- annotation generated descriptor berubah,
- version range perlu update,
- optional import tidak direview,
- API package berubah,
- Java target berubah.

Tool seperti bnd menganalisis bytecode untuk menghasilkan import package yang diperlukan.

### 16.2 bnd Mental Model

bnd membaca:

- class files,
- package references,
- annotations,
- build instructions,
- classpath dependencies,
- version metadata,
- DS annotations,
- metatype annotations,
- baseline data.

Lalu menghasilkan:

- bundle JAR,
- manifest,
- DS XML,
- metatype XML,
- import package,
- export package,
- capability requirements,
- warnings.

Build instruction bukan sekadar packaging config. Ia adalah architecture policy.

Contoh `bnd.bnd`:

```text
Bundle-SymbolicName: com.mycompany.case.rules
Bundle-Version: 1.2.3
Bundle-Name: Case Rules Engine

Export-Package: \
    com.mycompany.case.rules.api;version=1.2.0,\
    com.mycompany.case.rules.spi;version=1.1.0

Private-Package: \
    com.mycompany.case.rules.internal.*

Import-Package: \
    com.mycompany.case.api;version="[2.1,3)",\
    org.slf4j;version="[1.7,3)",\
    *
```

Perhatikan `*` di akhir `Import-Package`.

Dalam bnd, wildcard memberi ruang tool untuk menambahkan imports yang ditemukan dari bytecode.

Tanpa `*`, kamu bisa tanpa sengaja memblokir import yang sebenarnya dibutuhkan.

### 16.3 Maven Bundle Plugin

Dengan Maven, banyak project memakai Apache Felix Maven Bundle Plugin yang berbasis bnd.

Konsepnya:

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-bundle-plugin</artifactId>
  <extensions>true</extensions>
  <configuration>
    <instructions>
      <Bundle-SymbolicName>com.mycompany.case.rules</Bundle-SymbolicName>
      <Export-Package>com.mycompany.case.rules.api;version=1.2.0</Export-Package>
      <Private-Package>com.mycompany.case.rules.internal.*</Private-Package>
    </instructions>
  </configuration>
</plugin>
```

Maven plugin cocok untuk organisasi Maven-heavy.

Tetapi untuk OSGi-native workflow, bnd workspace / Bndtools sering memberi pengalaman resolver/testing yang lebih eksplisit.

### 16.4 Gradle + bnd

Dengan Gradle, kamu bisa memakai plugin bnd atau plugin yang mengintegrasikan OSGi manifest generation.

Prinsip tetap sama:

- manifest jangan ditulis raw manual,
- package boundary harus deliberate,
- generated manifest harus direview,
- warnings harus dianggap design signal.

---

## 17. Descriptor Files: Manifest Bukan Satu-satunya Metadata

Bundle bisa membawa descriptor tambahan.

### 17.1 Declarative Services Descriptor

Lokasi umum:

```text
OSGI-INF/com.mycompany.case.rules.DefaultRuleEngine.xml
```

Manifest:

```text
Service-Component: OSGI-INF/com.mycompany.case.rules.DefaultRuleEngine.xml
```

### 17.2 Metatype Descriptor

Lokasi umum:

```text
OSGI-INF/metatype/com.mycompany.case.rules.RuleEngineConfig.xml
```

Dipakai untuk configuration schema.

### 17.3 Blueprint Descriptor

Lokasi umum:

```text
OSGI-INF/blueprint/context.xml
```

Blueprint container akan memprosesnya jika runtime memiliki Blueprint extender.

### 17.4 Web Resources / Whiteboard Metadata

HTTP Whiteboard sering memakai service registration property, bukan file descriptor. Tetapi beberapa stack web/REST punya descriptor sendiri.

### 17.5 Extender-Based Metadata

OSGi sering memakai pattern:

```text
Bundle provides descriptor
Extender sees manifest/header/resource
Extender creates runtime behavior
```

Contoh:

```text
Declarative Services:
  Header: Service-Component
  Resource: OSGI-INF/*.xml
  Extender: SCR/DS runtime

Blueprint:
  Resource: OSGI-INF/blueprint/*.xml
  Extender: Blueprint container

JPA:
  Resource: META-INF/persistence.xml
  Extender/provider: JPA integration
```

Top-tier implication:

```text
If your bundle depends on an extender, declare that dependency explicitly.
```

---

## 18. Localization Metadata

OSGi supports localization of bundle headers.

Example:

```text
Bundle-Name: %bundle.name
Bundle-Description: %bundle.description
Bundle-Localization: OSGI-INF/l10n/bundle
```

Resource:

```text
OSGI-INF/l10n/bundle.properties
OSGI-INF/l10n/bundle_id.properties
```

This matters more in product/platform/UI systems such as Eclipse RCP.

For backend systems, localization metadata is less common, but still useful for:

- admin console,
- plugin marketplace,
- multi-language product distribution,
- operator-facing bundle descriptions.

Prinsip:

- jangan overcomplicate backend bundle jika tidak ada kebutuhan,
- tetapi pahami karena fragment localization sering muncul di Equinox/Eclipse ecosystem.

---

## 19. Bundle Signing and Security Metadata

Bundle JAR dapat ditandatangani seperti JAR biasa.

Struktur:

```text
META-INF/
├── MANIFEST.MF
├── MYKEY.SF
└── MYKEY.RSA
```

OSGi security model dapat memakai signing/certificate untuk trust dan permission.

Dalam sistem enterprise regulated, signing bisa relevan untuk:

- plugin provenance,
- supply-chain trust,
- ensuring only approved bundles deployed,
- audit trail,
- tamper detection.

Tetapi signing bukan silver bullet.

Hal yang tetap perlu:

- repository trust,
- checksum verification,
- SBOM,
- dependency scanning,
- deployment approval,
- runtime permission policy,
- operational access control.

Part security akan membahas lebih dalam.

---

## 20. Naming and Package Boundary Strategy

Bundle anatomy yang sehat membutuhkan naming strategy yang disiplin.

### 20.1 Bundle Naming Pattern

Pattern enterprise:

```text
<org>.<platform|product>.<domain>.<role>
```

Contoh:

```text
com.mycompany.aceas.case.api
com.mycompany.aceas.case.provider
com.mycompany.aceas.case.web
com.mycompany.aceas.case.persistence.oracle
com.mycompany.aceas.case.rules.spi
com.mycompany.aceas.case.rules.default
com.mycompany.aceas.audit.api
com.mycompany.aceas.audit.provider.oracle
com.mycompany.platform.config.api
```

### 20.2 Package Naming Pattern

API bundle:

```text
com.mycompany.aceas.case.api
com.mycompany.aceas.case.api.dto
com.mycompany.aceas.case.api.event
```

Provider bundle:

```text
com.mycompany.aceas.case.internal
com.mycompany.aceas.case.internal.service
com.mycompany.aceas.case.internal.persistence
```

SPI bundle:

```text
com.mycompany.aceas.case.spi
com.mycompany.aceas.case.spi.rule
com.mycompany.aceas.case.spi.extension
```

### 20.3 Bundle Types

Useful classification:

```text
API bundle
  exports interfaces, DTOs, constants, exceptions
  minimal dependencies
  no heavy implementation

SPI bundle
  exports provider-facing interfaces
  stable extension contract

Provider bundle
  implements services
  imports API/SPI
  exports little or nothing

Web/API adapter bundle
  registers HTTP/JAX-RS endpoints
  depends on domain services

Persistence bundle
  owns persistence implementation
  hides ORM/JDBC details if possible

Integration bundle
  wraps external system connector

Feature bundle / aggregator
  no code or little code
  groups capabilities/config

Fragment bundle
  contributes resources/classes to host
```

### 20.4 Avoid `common` as Dumping Ground

OSGi punishes unclear boundaries.

Bad:

```text
com.mycompany.common
com.mycompany.util
com.mycompany.shared
```

Usually these become:

- random DTOs,
- date utils,
- constants,
- exceptions,
- framework wrappers,
- domain leakage,
- transitive dependency magnets.

Better:

```text
com.mycompany.platform.time.api
com.mycompany.platform.money.api
com.mycompany.platform.audit.api
com.mycompany.platform.identity.api
com.mycompany.platform.validation.api
```

If it is truly common, define its semantic domain.

---

## 21. Public API Design Inside Bundle

A package exported by OSGi is a stronger public commitment than a Java `public` class in an internal application.

### 21.1 What Belongs in Exported API

Good API package content:

- interfaces,
- immutable DTOs,
- stable value objects,
- checked/unchecked exceptions with semantic meaning,
- enums only if evolution risk accepted,
- annotations intended for consumers,
- small helper types directly part of contract.

Avoid exporting:

- implementation classes,
- framework-specific classes unless intentional,
- JPA entities unless persistence model is API,
- Hibernate proxies,
- Spring classes,
- internal config objects,
- generated mappers,
- utility dumping ground,
- classes with unstable dependencies.

### 21.2 DTO Boundary

Good:

```java
public record CaseDecisionRequest(
    String caseId,
    String currentState,
    Map<String, Object> facts
) {}
```

But if Java 8 support is required, avoid records in API bundles targeting Java 8.

For Java 8 compatibility:

```java
public final class CaseDecisionRequest {
    private final String caseId;
    private final String currentState;
    private final Map<String, Object> facts;

    public CaseDecisionRequest(String caseId, String currentState, Map<String, Object> facts) {
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.currentState = Objects.requireNonNull(currentState, "currentState");
        this.facts = Collections.unmodifiableMap(new LinkedHashMap<>(facts));
    }

    public String getCaseId() {
        return caseId;
    }

    public String getCurrentState() {
        return currentState;
    }

    public Map<String, Object> getFacts() {
        return facts;
    }
}
```

Top-tier OSGi API design asks:

```text
Can this type cross bundle boundaries safely across versions and classloaders?
```

### 21.3 Avoid Leaking Implementation Dependency

Bad API:

```java
public interface RuleRepository {
    org.hibernate.Session currentSession();
}
```

This forces consumers to import Hibernate and couples API to provider implementation.

Better:

```java
public interface RuleRepository {
    Optional<RuleDefinition> findByCode(String code);
}
```

Implementation can use Hibernate privately.

### 21.4 Avoid Exposing Mutable Internals

Bad:

```java
public interface CaseModelProvider {
    List<CaseState> getStates();
}
```

If implementation returns mutable internal list, consumers can corrupt state.

Better:

```java
public interface CaseModelProvider {
    List<CaseState> getStates(); // documented immutable snapshot
}
```

Even better in Java 10+:

```java
return List.copyOf(states);
```

But for Java 8 compatibility:

```java
return Collections.unmodifiableList(new ArrayList<>(states));
```

### 21.5 API and Java Version

If series target Java 8 to 25, exported API must be deliberate:

- If API bundle targets Java 8, do not use records, sealed classes, var handles, virtual-thread-specific types, etc.
- If API bundle targets Java 17+, declare execution environment accordingly.
- If API bundle targets Java 21/25, consumers on older runtime are excluded.

Rule:

```text
Set API bundle Java target as low as practical, implementation bundle Java target as high as allowed by runtime policy.
```

Example:

```text
case-api bundle: Java 8 bytecode
case-provider-modern bundle: Java 21 bytecode
```

This allows old consumers to compile against API while modern runtime provider uses newer Java features internally, assuming runtime supports it.

---

## 22. Wrapping Non-OSGi Libraries

Many Java libraries are not proper OSGi bundles. You may need to wrap them.

### 22.1 What Is Wrapping?

Wrapping means creating a bundle whose content is an existing library plus generated OSGi metadata.

Example:

```text
legacy-rule-engine.jar
```

Wrapped as:

```text
com.mycompany.thirdparty.legacy-rule-engine-4.2.0.jar
├── META-INF/MANIFEST.MF
└── legacy library classes
```

Manifest:

```text
Bundle-SymbolicName: com.mycompany.thirdparty.legacy.ruleengine
Bundle-Version: 4.2.0
Export-Package: com.vendor.ruleengine.api;version="4.2.0"
Private-Package: com.vendor.ruleengine.internal.*
Import-Package: org.slf4j;version="[1.7,3)",*
```

### 22.2 Wrap vs Embed Decision

Ask:

```text
Will other bundles need to use types from this library?
```

If yes, wrap as shared bundle.

If no, embed privately.

```text
Library types cross bundle boundary?
  yes -> shared wrapped bundle
  no  -> private package or embedded dependency may be OK
```

### 22.3 Wrapping Dangers

Wrapping can create false API.

If you export every package from third-party library:

```text
Export-Package: com.vendor.*
```

You expose internal vendor implementation.

Better:

```text
Export-Package: com.vendor.ruleengine.api;version="4.2.0"
Private-Package: com.vendor.ruleengine.internal.*
```

But sometimes third-party library internals are used by its own API. You must inspect package coupling.

### 22.4 Dependency Discovery

A wrapped library may reference packages not present in the library itself.

bnd will generate imports such as:

```text
Import-Package: \
 javax.xml.parsers,\
 org.slf4j,\
 com.fasterxml.jackson.databind,\
 sun.misc;resolution:=optional
```

You must review these.

Potential issues:

- `sun.misc` internal JDK API,
- optional imports generated because code has optional integrations,
- javax packages removed from newer JDK,
- dependencies not available as OSGi bundles,
- version ranges missing.

Wrapping is not just packaging. It is compatibility engineering.

---

## 23. The Manifest as Architecture Review Artifact

A senior OSGi review should inspect manifest like this:

### 23.1 Identity Review

Questions:

```text
Is Bundle-SymbolicName stable and globally meaningful?
Is Bundle-Version correct?
Is singleton directive intentional?
Does Bundle-Name help operations?
```

### 23.2 Export Review

Questions:

```text
Which packages are exported?
Are all exported packages intentionally public API?
Do exported packages have versions?
Do exported packages leak implementation types?
Do exported APIs depend on unstable third-party packages?
Is uses directive generated correctly?
```

### 23.3 Import Review

Questions:

```text
Are imports versioned?
Are version ranges reasonable?
Are optional imports truly optional?
Is DynamicImport used?
Are there suspicious imports to internal packages?
Are there javax/jakarta conflicts?
Are there imports to sun.* or com.sun.*?
```

### 23.4 Content Review

Questions:

```text
What packages are actually inside the bundle?
Are embedded JARs present?
Are duplicate packages present?
Does content match Private-Package/Export-Package intent?
Are resources included intentionally?
```

### 23.5 Lifecycle Review

Questions:

```text
Is Bundle-Activator present?
Should it be DS instead?
Is Service-Component present?
Does bundle require DS extender?
Are descriptors included?
```

### 23.6 Runtime Review

Questions:

```text
Does bundle declare required execution environment?
Does it need capabilities?
Does it require native code?
Does it attach as fragment?
Can it resolve in target runtime?
```

---

## 24. Example: Bad Bundle Manifest

```text
Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: common
Bundle-Version: 1.0.0
Export-Package: *
Import-Package: *;resolution:=optional
Bundle-ClassPath: .,lib/jackson-databind.jar,lib/hibernate-core.jar
Bundle-Activator: com.company.common.Activator
```

This is dangerous.

Problems:

1. symbolic name `common` is meaningless,
2. exports everything,
3. all imports optional,
4. embeds large shared libraries,
5. activator likely doing too much,
6. no versioned exports,
7. no version ranges,
8. no clear API/private boundary,
9. hidden dependency conflicts,
10. impossible to reason about compatibility.

This bundle is not modular architecture. It is classpath chaos wearing OSGi clothing.

---

## 25. Example: Better Bundle Manifest

```text
Manifest-Version: 1.0
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.mycompany.aceas.case.rules.default
Bundle-Name: ACEAS Case Rules Default Provider
Bundle-Description: Default rule evaluation provider for ACEAS case lifecycle
Bundle-Vendor: My Company
Bundle-Version: 1.4.2

Export-Package: \
 com.mycompany.aceas.case.rules.api;version="1.2.0",\
 com.mycompany.aceas.case.rules.spi;version="1.1.0"

Import-Package: \
 com.mycompany.aceas.case.api;version="[2.3,3)",\
 com.mycompany.aceas.audit.api;version="[1.4,2)";resolution:=optional,\
 org.osgi.service.component;version="[1.5,2)",\
 org.slf4j;version="[1.7,3)",\
 *

Service-Component: OSGI-INF/com.mycompany.aceas.case.rules.internal.DefaultRuleEngine.xml

Require-Capability: \
 osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.5.0)(!(version>=2.0.0)))",\
 osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

This is better because:

- identity is meaningful,
- API/SPI are explicit,
- package versions exist,
- imports are versioned,
- optional audit integration is explicit,
- DS dependency is declared,
- Java execution environment is declared,
- implementation is not exported.

Potential further questions:

- Why is API exported by provider bundle? Should API be separate bundle?
- Is audit optional safely implemented?
- Is JavaSE 17 acceptable for all target deployments?
- Are version ranges generated or manually maintained?
- Are `uses` directives generated by bnd?

Good manifest does not mean no review. It means review is possible.

---

## 26. API Bundle vs Provider Bundle Split

In serious OSGi systems, a common pattern is to split API and implementation.

### 26.1 API Bundle

```text
Bundle-SymbolicName: com.mycompany.aceas.case.rules.api
Bundle-Version: 1.2.0
Export-Package: com.mycompany.aceas.case.rules.api;version="1.2.0"
Import-Package: org.osgi.annotation.versioning;resolution:=optional,*
```

Contains:

```text
RuleEngine
Rule
RuleContext
RuleResult
RuleException
```

Should be small and stable.

### 26.2 Provider Bundle

```text
Bundle-SymbolicName: com.mycompany.aceas.case.rules.provider.default
Bundle-Version: 1.4.2
Import-Package: \
 com.mycompany.aceas.case.rules.api;version="[1.2,2)",\
 com.mycompany.aceas.case.api;version="[2.3,3)",\
 org.osgi.service.component;version="[1.5,2)",\
 *
Service-Component: OSGI-INF/*.xml
```

Exports nothing or only provider-specific diagnostics API.

Benefits:

- consumers depend only on API,
- providers can be replaced,
- multiple providers can coexist,
- API lifecycle is independent,
- implementation can use modern Java/internal dependencies,
- resolver graph is cleaner.

### 26.3 When Not to Split

Don't split every tiny thing blindly.

If a bundle is internal and has no external consumers, splitting API can add overhead.

Ask:

```text
Will another independently versioned bundle consume this contract?
Will there be multiple providers?
Will this API remain stable across implementation changes?
Is this boundary meaningful to architecture or operations?
```

If yes, split.

If no, keep simpler.

---

## 27. Internal Packages and `x-internal` / `x-friends`

Some ecosystems, especially Eclipse, use metadata like:

```text
Export-Package: com.mycompany.foo.internal;x-internal:=true
```

or:

```text
Export-Package: com.mycompany.foo.internal;x-friends:="com.mycompany.bar"
```

These are not generic enforcement mechanisms in all OSGi frameworks; they are conventions/tooling hints in some ecosystems.

Do not rely on them as hard security boundary.

If a package should not be used, do not export it.

If it must be exported for technical reasons but is not public API, document and enforce with tooling.

---

## 28. `DynamicImport-Package`: Escape Hatch

Example:

```text
DynamicImport-Package: *
```

This allows package imports to be resolved dynamically at class load time.

It can be useful for:

- scripting engines,
- dynamic plugin class loading,
- legacy reflection-heavy frameworks,
- emergency compatibility bridge,
- certain SPI discovery cases.

But it is dangerous because:

- reduces resolver predictability,
- hides dependencies,
- can make runtime behavior order-dependent,
- weakens modularity,
- makes production failures harder to reproduce.

Avoid:

```text
DynamicImport-Package: *
```

Prefer narrow:

```text
DynamicImport-Package: com.mycompany.plugins.*
```

Even then, ask:

```text
Can this be modeled with service registry, whiteboard, or explicit capability instead?
```

Most enterprise bundles should not need dynamic import.

---

## 29. Service Metadata vs Package Metadata

A common confusion:

```text
If a bundle exports a package, does that mean it registers a service?
```

No.

Exporting package means other bundles can load classes from that package.

Registering service means runtime service object is available in service registry.

Example:

```text
Export-Package: com.mycompany.case.rules.api;version="1.2.0"
```

This exposes interface `RuleEngine`.

But no service exists unless provider registers it:

```java
@Component(service = RuleEngine.class)
public final class DefaultRuleEngine implements RuleEngine {
}
```

Or manually:

```java
context.registerService(RuleEngine.class, new DefaultRuleEngine(), properties);
```

Manifest and service registry solve different problems:

```text
Manifest package metadata:
  Can consumer load the type RuleEngine?

Service registry:
  Is there a runtime object implementing RuleEngine available now?
```

Both are necessary.

---

## 30. Dependency Coordinates: Maven vs OSGi

Maven dependency:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.2</version>
</dependency>
```

OSGi import:

```text
Import-Package: com.fasterxml.jackson.databind;version="[2.17,3)"
```

These are different worlds.

Maven resolves build-time artifacts.

OSGi resolves runtime package capabilities.

Build-time dependency may not become runtime import if:

- classes are only used in tests,
- dependency is embedded,
- package is private inside same bundle,
- dependency is optional and guarded,
- bytecode analyzer does not see reflective usage.

Runtime import may appear even if you did not explicitly list Maven dependency, because transitive classpath or generated code references it.

Top-tier practice:

```text
Review both Maven/Gradle dependency graph and OSGi manifest import graph.
They are related but not equivalent.
```

---

## 31. `uses` Directive Preview

You will often see generated exports like:

```text
Export-Package: com.mycompany.case.rules.api;version="1.2.0";uses:="com.mycompany.case.api"
```

`uses` says exported package's types use types from another package.

Example:

```java
package com.mycompany.case.rules.api;

import com.mycompany.case.api.CaseContext;

public interface RuleEngine {
    RuleResult evaluate(CaseContext context);
}
```

The exported API package `case.rules.api` uses `case.api`.

Resolver must ensure class space consistency, so consumers of `case.rules.api` and `case.api` get compatible wiring.

Do not manually delete `uses` directive just because it causes resolver error. The error often reveals real class space inconsistency.

Part 5 will go deep on this.

For now:

```text
uses directive protects type consistency across bundle classloaders.
```

---

## 32. Bundle Content Inspection Commands

For any `.jar`, inspect manifest:

```bash
jar xf my.bundle.jar META-INF/MANIFEST.MF
cat META-INF/MANIFEST.MF
```

Or:

```bash
unzip -p my.bundle.jar META-INF/MANIFEST.MF
```

List content:

```bash
jar tf my.bundle.jar
```

Find embedded JARs:

```bash
jar tf my.bundle.jar | grep '\.jar$'
```

Find OSGi descriptors:

```bash
jar tf my.bundle.jar | grep '^OSGI-INF/'
```

Check package layout:

```bash
jar tf my.bundle.jar | grep '\.class$' | sed 's|/[^/]*\.class$||' | sort -u
```

In Karaf:

```text
bundle:list
bundle:headers <id>
bundle:classes <id>
package:exports
package:imports
service:list
scr:list
scr:info <component>
```

In Felix Gogo shell, commands depend on installed command bundles, but commonly:

```text
lb
headers <bundle-id>
inspect capability package <bundle-id>
inspect requirement package <bundle-id>
services
scr:list
scr:info
```

Operational habit:

```text
When debugging, inspect actual runtime headers, not only source build config.
```

Because deployed bundle may not match source expectation.

---

## 33. Common Bundle Anatomy Failure Modes

### 33.1 Bundle Has No `Bundle-SymbolicName`

Symptom:

```text
Framework does not treat JAR as valid bundle
```

Cause:

- ordinary JAR deployed as bundle,
- build plugin not configured,
- manifest overwritten by packaging step.

Fix:

- generate OSGi manifest,
- wrap library,
- check final artifact.

### 33.2 Package Not Exported

Symptom:

```text
Consumer cannot resolve Import-Package com.mycompany.foo.api
```

Cause:

- provider has class but does not export package,
- export wildcard missed package,
- package version mismatch,
- provider bundle not installed/resolved.

Fix:

- export API package intentionally,
- add package version,
- install provider,
- review resolver output.

### 33.3 Implementation Accidentally Exported

Symptom:

- other bundles start depending on internal classes,
- later refactor breaks consumers,
- baseline reports unexpected API changes.

Cause:

```text
Export-Package: com.mycompany.foo.*
```

Fix:

- explicit export list,
- move internals under `.internal`,
- enforce no imports to internal packages,
- baseline public API only.

### 33.4 Import Missing Because Reflection

Symptom:

```text
ClassNotFoundException at runtime
```

Cause:

- bnd bytecode analysis did not see reflective class usage,
- ServiceLoader usage,
- string-based class name,
- XML descriptor references class.

Example:

```java
Class.forName("com.vendor.Driver")
```

Fix:

- add explicit `Import-Package`,
- use service registry,
- use proper extender metadata,
- avoid reflection where possible.

### 33.5 Optional Import Not Actually Optional

Symptom:

```text
Bundle resolves but fails when class is loaded
```

Cause:

- optional package class referenced in mandatory class initialization path.

Fix:

- isolate optional integration into separate class/component,
- guard class loading,
- use service optional references,
- split optional feature into separate bundle.

### 33.6 Duplicate Embedded Libraries

Symptom:

```text
ClassCastException: com.fasterxml.jackson.databind.ObjectMapper cannot be cast to com.fasterxml.jackson.databind.ObjectMapper
```

Cause:

- same FQCN loaded by different bundle classloaders,
- embedded library crossing service boundary.

Fix:

- do not expose embedded dependency types,
- use shared API bundle,
- import package from common provider,
- redesign service boundary.

### 33.7 DS Component Not Starting

Symptom:

```text
Bundle ACTIVE but service not registered
```

Cause:

- `Service-Component` missing,
- DS extender missing,
- component unsatisfied,
- config missing,
- descriptor not packaged.

Fix:

- inspect manifest,
- inspect `OSGI-INF`,
- inspect SCR component state,
- declare extender requirement,
- add config.

### 33.8 Wrong Java Target

Symptom:

```text
UnsupportedClassVersionError
```

Cause:

- built with Java 17/21/25 but runtime Java older,
- manifest says older EE,
- dependency bytecode too new.

Fix:

- use `--release`,
- enforce toolchain,
- check bytecode in CI,
- align `Require-Capability osgi.ee`,
- upgrade runtime.

---

## 34. Designing Bundle Anatomy Step by Step

When creating a new OSGi bundle, follow this process.

### Step 1: Define Bundle Role

Choose one:

```text
API
SPI
Provider
Adapter
Web endpoint
Persistence
Integration connector
Extender
Fragment
Feature aggregator
```

If you cannot say the role, the bundle boundary is probably unclear.

### Step 2: Define Public Packages

Ask:

```text
Which packages should other bundles compile against?
```

Export only those.

### Step 3: Define Private Packages

Ask:

```text
Which packages are implementation details?
```

Put them under `.internal` and keep private.

### Step 4: Define Dependencies

Ask:

```text
Which package dependencies are required?
Which are optional?
Which should be service references instead?
```

### Step 5: Define Version Policy

Ask:

```text
What is the version of each exported API package?
What import range should consumers use?
Does this bundle version reflect artifact changes?
```

### Step 6: Define Runtime Semantics

Ask:

```text
Does this bundle need DS?
Config Admin?
Blueprint?
HTTP Whiteboard?
JPA extender?
Specific Java EE?
```

Declare capability requirements where appropriate.

### Step 7: Define Content Strategy

Ask:

```text
Should dependencies be shared OSGi bundles, private packages, or embedded JARs?
```

### Step 8: Generate Manifest

Use bnd/Maven/Gradle tooling.

### Step 9: Inspect Final Artifact

Never trust source config alone.

Inspect:

```text
META-INF/MANIFEST.MF
OSGI-INF/*
embedded JARs
exported packages
imported packages
```

### Step 10: Run Resolver Test

Check that target runtime can resolve the bundle with intended providers.

---

## 35. Practical Mini Example

### 35.1 Requirement

We want a rule engine API and default implementation.

Consumers should depend on API only.

Provider should register service via DS.

Audit integration is optional.

Runtime minimum is Java 17.

### 35.2 API Bundle

Package:

```text
com.mycompany.rules.api
```

Interface:

```java
package com.mycompany.rules.api;

public interface RuleEngine {
    RuleResult evaluate(RuleRequest request);
}
```

bnd:

```text
Bundle-SymbolicName: com.mycompany.rules.api
Bundle-Version: 1.0.0
Bundle-Name: Rule Engine API

Export-Package: \
    com.mycompany.rules.api;version="1.0.0"

Import-Package: \
    *

Require-Capability: \
    osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=8))"
```

If API uses only Java 8 constructs, keep it Java 8-compatible.

### 35.3 Provider Bundle

Implementation:

```java
package com.mycompany.rules.provider.internal;

import com.mycompany.rules.api.RuleEngine;
import com.mycompany.rules.api.RuleRequest;
import com.mycompany.rules.api.RuleResult;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.component.annotations.ReferenceCardinality;
import org.osgi.service.component.annotations.ReferencePolicy;

@Component(service = RuleEngine.class)
public final class DefaultRuleEngine implements RuleEngine {
    private volatile AuditSink auditSink;

    @Reference(
        cardinality = ReferenceCardinality.OPTIONAL,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindAuditSink(AuditSink auditSink) {
        this.auditSink = auditSink;
    }

    void unbindAuditSink(AuditSink auditSink) {
        if (this.auditSink == auditSink) {
            this.auditSink = null;
        }
    }

    @Override
    public RuleResult evaluate(RuleRequest request) {
        RuleResult result = evaluateInternal(request);
        AuditSink sink = auditSink;
        if (sink != null) {
            sink.record(request, result);
        }
        return result;
    }

    private RuleResult evaluateInternal(RuleRequest request) {
        // implementation
        return RuleResult.accepted();
    }
}
```

Provider bnd:

```text
Bundle-SymbolicName: com.mycompany.rules.provider.default
Bundle-Version: 1.0.0
Bundle-Name: Default Rule Engine Provider

Private-Package: \
    com.mycompany.rules.provider.internal.*

Import-Package: \
    com.mycompany.rules.api;version="[1.0,2)",\
    com.mycompany.audit.api;version="[1.0,2)";resolution:=optional,\
    org.osgi.service.component;version="[1.5,2)",\
    org.osgi.service.component.annotations;resolution:=optional,\
    *

Service-Component: OSGI-INF/*.xml

Require-Capability: \
    osgi.extender;filter:="(&(osgi.extender=osgi.component)(version>=1.5.0)(!(version>=2.0.0)))",\
    osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

Note:

- API bundle can target Java 8,
- provider can target Java 17,
- provider exports nothing,
- audit optionality should ideally be service optional, not package optional if possible,
- DS annotation package can often be optional because annotations are build-time only, depending on build setup.

---

## 36. What Makes a Bundle “Good”?

A good OSGi bundle is not just one that resolves.

A good bundle has these properties:

### 36.1 Clear Identity

```text
The symbolic name tells what the bundle is.
The version tells artifact evolution.
The name/description helps operators.
```

### 36.2 Small Public Surface

```text
Exports are intentional.
Internal implementation is hidden.
API package versions are maintained.
```

### 36.3 Explicit Dependencies

```text
Imports are generated and reviewed.
Version ranges are meaningful.
Optional dependencies are truly optional.
```

### 36.4 Runtime Semantics Declared

```text
Extender requirements are explicit.
Execution environment is explicit.
Service descriptors are packaged.
```

### 36.5 Build Is Reproducible

```text
Manifest is generated consistently.
Warnings are treated seriously.
Final artifact is inspected.
```

### 36.6 Boundary Is Stable

```text
Public API does not leak internals.
Implementation can change without breaking consumers.
Dependencies do not escape unnecessarily.
```

### 36.7 Operationally Inspectable

```text
Operators can inspect headers, components, services, and wiring.
Bundle naming helps incident response.
```

---

## 37. Senior-Level Heuristics

### Heuristic 1: Export Less Than You Think

If unsure, keep package private.

You can export later as API matures. Removing export later is breaking.

### Heuristic 2: API Bundles Should Be Boring

An API bundle should have minimal dependencies and low runtime complexity.

If your API bundle imports Hibernate, Jackson databind, Spring, internal platform packages, and database classes, it is probably not an API bundle. It is a coupling magnet.

### Heuristic 3: Optional Import Is a Smell, Not Always a Bug

Optional import can be valid, but it demands proof.

Ask:

```text
Can this class be loaded when optional dependency is absent?
Is every code path guarded?
Would service optionality be better?
```

### Heuristic 4: Embedded JAR Is Private Until It Crosses Boundary

Embedding is safe only while types do not cross bundle/service/API boundary.

Once an embedded type appears in exported package or service contract, it becomes a class identity risk.

### Heuristic 5: Manifest Diff Is Architecture Diff

When a PR changes manifest exports/imports, it is not merely build output.

It may indicate:

- new public API,
- new runtime dependency,
- new Java requirement,
- accidental internal leakage,
- new extender need,
- compatibility break.

Review it seriously.

### Heuristic 6: `Require-Bundle` Should Require Justification

Default to `Import-Package`.

If you use `Require-Bundle`, document why bundle-level coupling is intentional.

### Heuristic 7: Avoid “Common” Bundle Unless Domain Is Clear

A `common` bundle often becomes a dumping ground.

Split common concepts into semantic platform APIs.

### Heuristic 8: Generated Does Not Mean Correct

bnd can generate technically valid manifest, but architecture intent still belongs to you.

Tooling can infer references. It cannot infer your domain boundary.

---

## 38. Checklist: Bundle Anatomy Review

Use this checklist for every bundle.

```text
Identity
[ ] Bundle-SymbolicName is globally meaningful
[ ] Bundle-Version follows version policy
[ ] Bundle-Name and Description are useful
[ ] singleton directive is intentional if present

Manifest validity
[ ] Bundle-ManifestVersion is present
[ ] Manifest generated by tooling
[ ] Final artifact manifest inspected

Exports
[ ] Exported packages are intentional API/SPI
[ ] Exported packages have versions
[ ] No internal/impl package exported accidentally
[ ] API does not leak implementation libraries
[ ] uses directives are preserved/generated

Private content
[ ] Private packages are explicit
[ ] Internal packages use clear naming
[ ] No accidental duplicate packages

Imports
[ ] Imports have reasonable version ranges
[ ] Optional imports are truly optional
[ ] No suspicious sun.*, com.sun.*, internal imports unless justified
[ ] javax/jakarta imports are intentional
[ ] wildcard import policy understood

Dependencies
[ ] Prefer Import-Package over Require-Bundle
[ ] Require-Bundle is justified if used
[ ] DynamicImport-Package absent or narrowly justified

Lifecycle
[ ] Bundle-Activator absent unless needed
[ ] DS components packaged if used
[ ] Service-Component header present if DS used
[ ] Extender requirements declared where appropriate

Content
[ ] Embedded JARs are intentional
[ ] Embedded dependency types do not cross public boundary
[ ] Resources/descriptors are packaged correctly

Runtime
[ ] Execution environment declared
[ ] Java bytecode target matches EE
[ ] Native/fragments/capabilities intentional

Operations
[ ] Bundle can be diagnosed via headers/services/components
[ ] Naming helps support and incident response
```

---

## 39. Part 2 Summary

A bundle is not “just a JAR”. It is a JAR with a runtime contract.

The manifest defines:

- who the bundle is,
- what it exposes,
- what it hides,
- what it requires,
- what lifecycle mechanism it uses,
- what runtime semantics it depends on,
- what Java environment it expects,
- and how the resolver should wire it.

The most important mental model:

```text
In OSGi, modularity is not inferred from project folders.
It is enforced by runtime-visible metadata.
```

Good OSGi engineers write Java code.

Great OSGi engineers design bundle contracts.

Top 1% OSGi engineers treat manifest metadata as architecture, compatibility, and operations surface.

---

## 40. What Comes Next

Part 3 will go deeper into:

```text
Class Loading Deep Dive:
Per-Bundle ClassLoaders and Visibility Rules
```

We will examine:

- why class identity depends on classloader,
- how imports connect class spaces,
- why same FQCN can still be different class,
- how TCCL breaks or saves frameworks,
- how reflection, proxies, JDBC, JAXB, SPI, and annotation scanning behave in OSGi,
- and how to debug `ClassNotFoundException`, `NoClassDefFoundError`, and `ClassCastException` in modular runtimes.

---

## References

- OSGi Core Release 8 Specification — Module Layer and Bundle Metadata: https://docs.osgi.org/specification/osgi.core/8.0.0/framework.module.html
- OSGi Bundle Headers Reference: https://docs.osgi.org/reference/bundle-headers.html
- OSGi Core Release 8 Table of Contents: https://docs.osgi.org/specification/osgi.core/8.0.0/toc.html
- OSGi Core Release 8 Service Layer: https://docs.osgi.org/specification/osgi.core/8.0.0/framework.service.html
- bnd Private-Package Documentation: https://bnd.bndtools.org/heads/private_package.html
- bnd FAQ, Bundle-ClassPath guidance: https://bnd.bndtools.org/chapters/920-faq.html
- Apache Felix Maven Bundle Plugin documentation: https://felix.apache.org/documentation/subprojects/apache-felix-maven-bundle-plugin-bnd.html
- Apache Felix OSGi Tutorial: https://felix.apache.org/documentation/tutorials-examples-and-presentations/apache-felix-osgi-tutorial.html
- Equinox Execution Environment Descriptions: https://equinox.eclipseprojects.io/launcher/execution_environment_descriptions.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 1 — OSGi Core Architecture: Framework Layers and Runtime Invariants](./01-osgi-core-architecture-framework-layers-runtime-invariants.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: 03 — Class Loading Deep Dive: Per-Bundle ClassLoaders and Visibility Rules](./03-class-loading-per-bundle-classloaders-visibility-rules.md)

</div>