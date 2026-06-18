# Part 12 — Apache Felix Runtime: Lightweight Framework, Gogo Shell, SCR, FileInstall

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `12-apache-felix-runtime-lightweight-framework-gogo-scr-fileinstall.md`  
> Scope: Java 8 sampai Java 25  
> Fokus: Apache Felix sebagai OSGi runtime ringan, embedding, launcher, Gogo shell, SCR/Declarative Services, FileInstall, Web Console, diagnostics, dan production trade-off.

---

## 0. Posisi Part Ini dalam Series

Kita sudah membahas:

1. mental model OSGi,
2. core architecture,
3. bundle anatomy,
4. classloading,
5. dependency model,
6. resolver engineering,
7. semantic versioning,
8. service layer,
9. Declarative Services,
10. advanced DS patterns,
11. Configuration Admin dan Metatype,
12. bnd/Bndtools.

Sekarang kita masuk ke runtime konkret pertama: **Apache Felix**.

Di level mental model, Felix bukan “application server”. Felix adalah **OSGi framework implementation** yang ringan. Ia memberi kernel runtime OSGi: bundle lifecycle, module layer, resolver, service registry, framework events, dan API runtime. Fitur seperti shell, Declarative Services runtime, Config Admin, FileInstall, Web Console, Event Admin, HTTP runtime, atau Dependency Manager adalah **bundle tambahan**, bukan “inti monolitik”.

Ini penting karena banyak engineer salah paham:

> “Saya install Felix, berarti semua layanan OSGi sudah ada.”

Tidak. Felix Framework adalah kernel. Setelah itu kamu perlu memilih bundle runtime yang dibutuhkan.

Apache Felix documentation sendiri memposisikan project Felix sebagai kumpulan subproject OSGi, termasuk framework, shell, SCR, FileInstall, Web Console, Config Admin, dan lainnya. Felix Framework usage documentation juga menjelaskan konfigurasi auto-deploy bundle dan framework cache, sedangkan launching/embedding documentation menunjukkan cara membuat launcher sendiri dengan `FrameworkFactory` dan auto processor.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan perbedaan antara **Felix Framework**, **Felix Main**, **Gogo Shell**, **SCR**, **FileInstall**, dan **Web Console**.
2. Menjalankan Felix sebagai runtime minimal dan memahami apa yang benar-benar berjalan di dalamnya.
3. Membuat launcher OSGi sendiri menggunakan `FrameworkFactory`.
4. Membaca konfigurasi dasar Felix: cache, auto deploy, storage clean, start level, boot delegation, framework system packages.
5. Menggunakan Gogo shell untuk inspeksi bundle, service, package, wiring, dan DS component.
6. Memahami bagaimana SCR bekerja di Felix dan apa bedanya dengan DS specification.
7. Menggunakan FileInstall secara benar, termasuk risiko hot deploy dan config drift.
8. Menggunakan Web Console sebagai tool observability ringan, bukan sebagai security liability.
9. Mendesain layout runtime Felix untuk development, testing, dan production.
10. Memutuskan kapan Felix cukup, kapan perlu Karaf, dan kapan sebaiknya tidak memakai OSGi runtime penuh.

---

## 2. Mental Model: Felix sebagai Kernel OSGi Ringan

### 2.1 Felix Bukan Karaf

Apache Karaf adalah distribution/container OSGi yang sudah membawa banyak opini operasional: shell, feature model, provisioning, config file convention, deploy folder, logging, SSH, JAAS, wrapper service, dan distribution assembly.

Felix Framework lebih rendah levelnya.

Felix menyediakan:

- framework implementation,
- resolver,
- service registry,
- bundle lifecycle,
- module/classloading isolation,
- event delivery,
- framework properties,
- API implementasi OSGi Core.

Felix tidak otomatis memberi:

- HTTP server,
- REST runtime,
- JPA runtime,
- transaction manager,
- DS runtime,
- Config Admin,
- shell,
- file-based deployment,
- web console,
- logging backend,
- production provisioning policy.

Semua itu adalah bundle tambahan.

Mental model yang tepat:

```text
+----------------------------------------------------+
| Your Application Bundles                           |
| API bundles, impl bundles, DS components, plugins  |
+----------------------------------------------------+
| Runtime Service Bundles                            |
| SCR, Config Admin, FileInstall, EventAdmin, HTTP   |
+----------------------------------------------------+
| Apache Felix Framework                             |
| lifecycle, resolver, module layer, service registry|
+----------------------------------------------------+
| JVM Java 8..25                                     |
+----------------------------------------------------+
| OS / Container                                     |
+----------------------------------------------------+
```

Felix Framework sendiri relatif kecil. Justru kekuatan Felix adalah **komposabilitas**: kamu memilih runtime pieces sesuai kebutuhan.

### 2.2 Felix Cocok untuk Engineer yang Mau Kontrol

Felix cocok ketika kamu ingin:

- runtime kecil,
- embedded OSGi di dalam aplikasi Java,
- test framework OSGi cepat,
- plugin engine internal,
- runtime modular tanpa distribution berat,
- eksperimen resolver/classloading,
- membangun platform sendiri di atas OSGi,
- menghindari opini Karaf/p2/Eclipse.

Felix kurang cocok ketika kamu butuh:

- provisioning feature-level siap pakai,
- remote shell/security model siap pakai,
- operations convention lengkap,
- built-in distribution management,
- enterprise deployment model yang already packaged.

Untuk hal itu, Karaf sering lebih praktis.

---

## 3. Komponen Ekosistem Apache Felix yang Penting

Apache Felix adalah umbrella project. Untuk part ini, komponen yang paling relevan:

| Komponen | Peran | Wajib? |
|---|---|---:|
| Felix Framework | Implementasi OSGi Core Framework | Ya |
| Felix Main | Launcher sederhana untuk menjalankan framework | Opsional |
| Felix Gogo Runtime/Shell/Command | Command-line shell OSGi | Opsional tapi sangat berguna |
| Felix SCR | Service Component Runtime untuk Declarative Services | Praktis wajib untuk OSGi modern |
| Felix Config Admin | Implementasi Configuration Admin | Dibutuhkan jika pakai runtime config |
| Felix FileInstall | Directory-based bundle/config deployer | Berguna untuk dev/simple ops |
| Felix Web Console | Browser-based management/inspection | Berguna untuk dev/admin, harus diamankan |
| Felix EventAdmin | Event Admin implementation | Jika pakai Event Admin |
| Felix HTTP / Jetty integration | HTTP Service / Whiteboard support | Jika butuh web endpoint |
| Felix Resolver | Resolver implementation/library | Digunakan framework/tooling |
| Felix Dependency Manager | Alternative component model | Opsional; DS biasanya lebih standar |

Prinsip top-tier:

> Jangan menganggap semua subproject Felix sebagai “platform default”. Pilih hanya yang kamu butuh, lalu dokumentasikan alasan setiap runtime bundle.

---

## 4. Menjalankan Felix: Tiga Mode Utama

Ada tiga pola umum menjalankan Felix:

1. **Felix Main distribution**
2. **bnd `.bndrun` executable/runtime**
3. **Embedded launcher custom**

### 4.1 Mode 1 — Felix Main Distribution

Ini cara paling cepat untuk belajar.

Struktur umum:

```text
felix/
  bin/
    felix.jar
  bundle/
    org.apache.felix.gogo.runtime.jar
    org.apache.felix.gogo.shell.jar
    org.apache.felix.gogo.command.jar
    your.bundle.jar
  conf/
    config.properties
  felix-cache/
```

Saat menjalankan:

```bash
java -jar bin/felix.jar
```

Felix Main akan membaca konfigurasi dan biasanya auto-deploy bundle dari directory `bundle/`.

Beberapa property penting:

```properties
felix.auto.deploy.dir=bundle
felix.auto.deploy.action=install,start
org.osgi.framework.storage=felix-cache
org.osgi.framework.storage.clean=onFirstInit
```

Makna:

- `felix.auto.deploy.dir`: folder tempat bundle auto-deploy.
- `felix.auto.deploy.action`: aksi terhadap bundle di folder, misalnya install/start/update/uninstall.
- `org.osgi.framework.storage`: lokasi framework cache.
- `org.osgi.framework.storage.clean`: policy membersihkan storage.

Mode ini bagus untuk:

- belajar,
- local debugging,
- PoC,
- memahami lifecycle.

Mode ini kurang ideal untuk production kompleks karena:

- auto deploy folder mudah menyebabkan drift,
- file copy tidak selalu atomic,
- rollback tidak eksplisit,
- ordering dan compatibility perlu dikelola sendiri.

### 4.2 Mode 2 — bnd `.bndrun`

Setelah Part 11, ini seharusnya terasa natural.

Contoh `app.bndrun`:

```properties
-runfw: org.apache.felix.framework
-runee: JavaSE-17

-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.example.case.runtime)'

-runbundles: \
    org.apache.felix.scr;version='[2.2.0,3)',\
    org.apache.felix.configadmin;version='[1.9.0,2)',\
    org.apache.felix.gogo.runtime;version='[1.1.0,2)',\
    org.apache.felix.gogo.command;version='[1.1.0,2)',\
    org.apache.felix.gogo.shell;version='[1.1.0,2)',\
    com.example.case.api;version='[1.0.0,1.1.0)',\
    com.example.case.impl;version='[1.0.0,1.1.0)'

-runproperties: \
    org.osgi.framework.storage=target/osgi-cache,\
    org.osgi.framework.storage.clean=onFirstInit
```

Keunggulan:

- resolver dipakai sebelum runtime,
- dependency closure lebih jelas,
- runtime assembly bisa reproducible,
- cocok untuk CI,
- cocok untuk integration test.

Ini biasanya lebih baik daripada copy manual JAR ke folder.

### 4.3 Mode 3 — Embedded Launcher Custom

Felix bisa ditanam di aplikasi Java biasa.

Contoh sederhana:

```java
package com.example.launcher;

import org.osgi.framework.Bundle;
import org.osgi.framework.BundleContext;
import org.osgi.framework.launch.Framework;
import org.osgi.framework.launch.FrameworkFactory;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.ServiceLoader;

public final class FelixEmbeddedLauncher {

    public static void main(String[] args) throws Exception {
        FrameworkFactory factory = ServiceLoader
                .load(FrameworkFactory.class)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No OSGi FrameworkFactory found"));

        Map<String, String> config = new HashMap<>();
        config.put("org.osgi.framework.storage", "runtime-cache");
        config.put("org.osgi.framework.storage.clean", "onFirstInit");

        Framework framework = factory.newFramework(config);
        framework.init();

        BundleContext context = framework.getBundleContext();

        installAndStart(context, Path.of("bundles/org.apache.felix.scr.jar"));
        installAndStart(context, Path.of("bundles/org.apache.felix.configadmin.jar"));
        installAndStart(context, Path.of("bundles/com.example.case.api.jar"));
        installAndStart(context, Path.of("bundles/com.example.case.impl.jar"));

        framework.start();

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                framework.stop();
                framework.waitForStop(10_000);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }));

        framework.waitForStop(0);
    }

    private static void installAndStart(BundleContext context, Path jar) throws Exception {
        Bundle bundle = context.installBundle(jar.toUri().toString());
        bundle.start();
    }
}
```

Tetapi contoh ini sengaja sederhana. Untuk production, launcher perlu jauh lebih disiplin:

- bundle list deterministic,
- ordering jelas,
- checksum/signature verification,
- resolver validation sebelum start,
- controlled cache clean,
- graceful shutdown,
- observability,
- config loading,
- rollback strategy,
- failure report.

Top-tier insight:

> Custom launcher adalah bagian dari platform architecture. Jangan dianggap sekadar `main()` yang start beberapa bundle.

---

## 5. Felix Framework Configuration Properties

Felix mendukung property OSGi standard dan property spesifik Felix.

### 5.1 Framework Storage

```properties
org.osgi.framework.storage=felix-cache
org.osgi.framework.storage.clean=onFirstInit
```

`org.osgi.framework.storage` menentukan lokasi persistent framework storage.

Di dalam storage, framework menyimpan informasi seperti:

- bundle cache,
- installed bundle metadata,
- persistent state,
- revision information,
- wiring-related metadata.

Kesalahan umum:

```text
Menghapus cache asal-asalan saat production incident.
```

Kadang membersihkan cache memang menyelesaikan masalah state corrupt, tetapi bisa juga:

- menghapus installed bundle state,
- mengubah runtime topology,
- menghilangkan evidence troubleshooting,
- membuat masalah tampak hilang tanpa root cause.

Untuk dev:

```properties
org.osgi.framework.storage.clean=onFirstInit
```

Untuk production immutable runtime:

```text
lebih baik image/runtime baru daripada mengandalkan cache mutation manual.
```

### 5.2 Auto Deploy

Property Felix Main:

```properties
felix.auto.deploy.dir=bundle
felix.auto.deploy.action=install,start
```

Aksi bisa mencakup:

- install,
- start,
- update,
- uninstall.

Auto deploy berguna untuk demo/dev. Tetapi di production, auto deploy harus diperlakukan hati-hati.

Masalah:

- file copy partial,
- JAR corrupt sementara terbaca,
- update tidak kompatibel,
- refresh timing mengganggu service aktif,
- deployment tidak tercatat sebagai release artifact,
- sulit rollback.

Production-grade approach:

```text
build immutable runtime distribution -> deploy as unit -> health check -> rollback by previous distribution
```

Bukan:

```text
scp random bundle.jar ke folder bundle production
```

### 5.3 Boot Delegation

```properties
org.osgi.framework.bootdelegation=sun.*,com.sun.*
```

Boot delegation membuat package tertentu dicari lewat parent/boot classloader.

Ini sering dipakai untuk library lama yang mengasumsikan classpath global, tetapi harus sangat dibatasi.

Bahaya:

- merusak isolation,
- menyembunyikan missing imports,
- membuat behavior berbeda antar JDK,
- memperparah Java 9+ strong encapsulation issue,
- mengacaukan reproducibility.

Rule:

> Boot delegation adalah emergency bridge, bukan dependency management strategy.

### 5.4 System Packages

```properties
org.osgi.framework.system.packages.extra=com.example.host.api;version=1.0.0
```

Ini menambahkan package dari system bundle agar bisa di-import bundle lain.

Use case:

- embedded launcher menyediakan host API,
- integration API berasal dari parent application,
- bridging non-OSGi host dengan OSGi plugin island.

Risiko:

- package tidak berasal dari bundle normal,
- versioning bisa tidak disiplin,
- host API menjadi hidden global dependency,
- migration ke runtime standalone menjadi sulit.

Lebih baik jika host API bisa dikemas sebagai bundle API biasa.

### 5.5 Start Level

Felix mendukung OSGi Start Level service.

Pola umum:

```text
level 1  : framework/system essentials
level 2  : logging/config/shell
level 3  : SCR/config admin/event admin
level 4  : platform API/services
level 5  : application modules
level 6  : plugins/extensions
```

Tetapi jangan terlalu mengandalkan start level untuk dependency semantics.

Start level hanya mengatur **when to start**, bukan **what dependency is valid**.

Dependency tetap harus diekspresikan via:

- Import-Package,
- Require-Capability,
- DS reference,
- Config Admin,
- service contract.

---

## 6. Gogo Shell: Runtime Microscope

### 6.1 Kenapa Shell Penting

OSGi adalah runtime dinamis. Kamu tidak cukup membaca source code. Kamu perlu melihat runtime state.

Gogo shell membantu menjawab:

- bundle apa yang terinstall?
- state bundle apa?
- package apa diekspor/diimpor?
- service apa terdaftar?
- komponen DS mana unsatisfied?
- config mana aktif?
- bundle mana wiring ke provider mana?
- apakah service ranking menyebabkan implementasi lain dipilih?

Felix Gogo biasanya terdiri dari:

- `org.apache.felix.gogo.runtime`
- `org.apache.felix.gogo.command`
- `org.apache.felix.gogo.shell`

### 6.2 Command Dasar

Command dapat berbeda tergantung bundle shell/command yang dipasang, tetapi pola umum:

```text
lb
headers <bundle-id>
start <bundle-id>
stop <bundle-id>
update <bundle-id>
uninstall <bundle-id>
services
inspect capability package <bundle-id>
inspect requirement package <bundle-id>
diag <bundle-id>
```

`lb` melihat list bundle:

```text
START LEVEL 1
   ID|State      |Level|Name
    0|Active     |    0|System Bundle
    1|Active     |    1|Apache Felix Gogo Runtime
    2|Active     |    1|Apache Felix Gogo Shell
    3|Active     |    1|Apache Felix Declarative Services
    4|Active     |    1|Case API
    5|Active     |    1|Case Implementation
```

Interpretasi:

- `Installed`: bundle belum resolved; biasanya missing dependency.
- `Resolved`: dependency class/package cukup, tetapi belum started.
- `Active`: bundle started, tetapi belum tentu semua DS component aktif.

### 6.3 `diag`: First Aid untuk Bundle Bermasalah

Jika bundle tidak resolved:

```text
diag 12
```

Kemungkinan output:

```text
com.example.case.impl [12]
  Unresolved requirement: Import-Package: com.fasterxml.jackson.databind; version="[2.15,3)"
```

Cara membaca:

- bundle butuh package `com.fasterxml.jackson.databind`,
- version minimal 2.15 dan kurang dari 3,
- runtime tidak menemukan exporter yang cocok.

Solusi yang benar bukan langsung `DynamicImport-Package:*`.

Solusi yang benar:

1. Pastikan bundle Jackson tersedia.
2. Pastikan package diekspor dengan version yang cocok.
3. Pastikan tidak ada uses constraint conflict.
4. Pastikan import range realistis.
5. Pastikan dependency tidak hanya ada di Maven compile classpath tetapi tidak ada di OSGi runtime.

### 6.4 Inspect Package Wiring

Untuk package wiring:

```text
inspect capability package 7
inspect requirement package 12
```

Mental model:

- capability = apa yang bundle tawarkan,
- requirement = apa yang bundle butuhkan,
- wire = hubungan aktual hasil resolver.

Jangan hanya melihat `MANIFEST.MF`. Yang penting adalah **actual wiring** runtime.

### 6.5 Service Inspection

Command service biasanya membantu melihat service registry.

Pertanyaan yang dijawab:

- Interface apa yang terdaftar?
- Siapa publisher-nya?
- Properties apa yang ada?
- Ranking berapa?
- Bundle mana yang menggunakan?

Contoh mental output:

```text
com.example.validation.ValidationRule
  service.id = 104
  service.bundleid = 22
  service.ranking = 100
  module = licensing
  rule.code = ACTIVE_LICENSE_REQUIRED
```

Jika consumer tidak menerima service, cek:

- interface package wiring sama atau tidak,
- target filter cocok atau tidak,
- component unsatisfied atau tidak,
- service property benar atau tidak,
- service ranking menyebabkan provider lain menang atau tidak.

---

## 7. Felix SCR: Declarative Services Runtime

### 7.1 SCR adalah Runtime, Bukan Annotation Processor

Declarative Services terdiri dari beberapa bagian:

1. Annotation di source code.
2. Build tool menghasilkan XML component description.
3. Bundle membawa XML descriptor di `OSGI-INF/`.
4. Manifest memiliki `Service-Component` header.
5. SCR runtime membaca descriptor.
6. SCR mengelola lifecycle component dan service reference.

Felix SCR adalah implementasi runtime untuk poin 5 dan 6.

Poin penting:

> Tanpa SCR bundle, annotation `@Component` tidak “hidup” di runtime.

Jika kamu hanya punya bundle aplikasi dengan descriptor DS tetapi tidak memasang SCR, maka component tidak akan aktif.

### 7.2 Minimal Runtime untuk DS

Biasanya perlu:

```text
org.apache.felix.scr
org.osgi.service.component
org.osgi.util.promise / function jika dibutuhkan versi tertentu
```

Jika memakai Config Admin:

```text
org.apache.felix.configadmin
```

Jika memakai Metatype untuk UI/tooling:

```text
org.apache.felix.metatype
```

### 7.3 Debugging DS di Felix

Jika Gogo SCR commands tersedia, command umum:

```text
scr:list
scr:info <component-id>
scr:enable <component-name>
scr:disable <component-name>
```

Tergantung versi bundle command, command bisa berbeda. Di OSGi R7/R8, introspection standard dilakukan via `ServiceComponentRuntime` service.

Yang perlu dicek:

- component description ditemukan atau tidak,
- component enabled atau disabled,
- component satisfied atau unsatisfied,
- reference mana yang missing,
- config policy satisfied atau tidak,
- activation exception ada atau tidak,
- service registered atau tidak.

### 7.4 Komponen Active Belum Tentu Service Ada

Sebuah DS component bisa:

- aktif tapi tidak publish service,
- publish service setelah activation sukses,
- gagal activation sehingga tidak publish service,
- unsatisfied karena reference/config hilang,
- disabled manual.

Jangan menyamakan:

```text
bundle ACTIVE == component ACTIVE == service available == application ready
```

Itu empat konsep berbeda.

### 7.5 Felix SCR Logging

Untuk troubleshooting, kamu biasanya ingin menaikkan level log SCR.

Masalah umum:

```text
Component is unsatisfied
```

Root cause bisa:

- missing service reference,
- LDAP target filter salah,
- interface package classloader beda,
- config PID tidak ada,
- config property invalid,
- activation method throw exception,
- constructor injection gagal,
- circular dependency,
- service scope mismatch.

Diagnosis top-tier:

```text
1. Apakah descriptor DS ada di bundle?
2. Apakah Service-Component header benar?
3. Apakah SCR bundle active?
4. Apakah component terdaftar di SCR?
5. Apakah component enabled?
6. Jika unsatisfied, reference/config mana yang tidak terpenuhi?
7. Jika satisfied tapi tidak active, activation policy/lazy/service request bagaimana?
8. Jika active tapi service tidak ada, apakah component memang provides service?
```

---

## 8. Felix Config Admin

Felix Config Admin adalah implementasi OSGi Configuration Admin.

### 8.1 Config Admin di Runtime Felix Minimal

Tanpa Config Admin:

- DS component dengan `configurationPolicy = REQUIRE` tidak akan satisfied.
- `@Modified` tidak akan menerima update config.
- ManagedService tidak berjalan.
- Factory configuration tidak ada.

Dengan Config Admin:

- PID dapat diberi dictionary config,
- DS component menerima typed config,
- config update bisa memicu modified/deactivate/activate,
- factory PID dapat membuat banyak component instance.

### 8.2 Config Persistence

Implementasi Config Admin biasanya menyimpan config di storage sendiri atau menerima update dari bundle lain seperti FileInstall.

Di production, tentukan:

- config source of truth,
- config encryption/secret reference,
- audit trail,
- rollback,
- validation,
- environment separation.

Jangan sampai config runtime berubah manual tanpa tercermin di deployment source.

---

## 9. Felix FileInstall: Directory-Based Management Agent

### 9.1 Apa Itu FileInstall

Felix FileInstall adalah bundle yang memonitor directory file system.

Ia bisa:

- install bundle saat JAR diletakkan,
- start bundle,
- update bundle saat file berubah,
- stop/uninstall bundle saat file dihapus,
- membaca file config tertentu dan mengirim ke Config Admin.

Ini sangat praktis.

Tapi juga sangat mudah disalahgunakan.

### 9.2 Konfigurasi Dasar

Contoh:

```bash
java \
  -Dfelix.fileinstall.dir=./deploy \
  -Dfelix.fileinstall.poll=2000 \
  -Dfelix.fileinstall.noInitialDelay=true \
  -jar bin/felix.jar
```

Property umum:

```properties
felix.fileinstall.dir=deploy
felix.fileinstall.poll=2000
felix.fileinstall.noInitialDelay=true
felix.fileinstall.bundles.new.start=true
felix.fileinstall.bundles.startTransient=false
```

Makna:

- `dir`: directory yang dimonitor.
- `poll`: interval scan.
- `noInitialDelay`: scan langsung saat start.
- `bundles.new.start`: auto start bundle baru.
- `startTransient`: apakah start transient atau persistent.

### 9.3 FileInstall untuk Config

FileInstall dapat digunakan untuk config file seperti:

```text
com.example.connector.onemap.cfg
```

atau format lain tergantung setup.

Contoh config:

```properties
baseUrl=https://api.example.local
connectTimeoutMillis=3000
readTimeoutMillis=5000
maxRetries=3
```

Jika PID cocok dengan DS component:

```java
@Component(configurationPid = "com.example.connector.onemap")
public class OneMapConnector {
    @Activate
    void activate(Config config) {
        // use config
    }
}
```

Maka config akan diberikan ke component.

### 9.4 Risiko FileInstall

Risiko utama:

#### 1. Partial File Copy

Jika file besar dicopy langsung ke deploy directory, FileInstall bisa membaca JAR sebelum copy selesai.

Mitigasi:

```text
copy ke temp file -> atomic rename
```

#### 2. Uncontrolled Hot Update

Update bundle dapat menyebabkan:

- bundle stop/start,
- service unregister/register,
- DS component deactivate/activate,
- dependency graph refresh,
- consumer melihat service hilang sementara.

Jika sistem tidak dirancang untuk service dynamics, hot update bisa merusak flow aktif.

#### 3. Config Drift

Operator mengubah `.cfg` langsung di server, tetapi Git/deployment source tidak berubah.

Akibat:

- environment tidak reproducible,
- incident sulit dianalisis,
- rollback tidak jelas.

#### 4. Delete Means Uninstall

Menghapus file bisa menghentikan bundle.

Ini powerful untuk dev, berbahaya untuk production.

### 9.5 FileInstall Production Guideline

Untuk development:

```text
FileInstall sangat berguna.
```

Untuk staging:

```text
boleh, jika deployment script atomic dan terdokumentasi.
```

Untuk production critical:

```text
lebih baik immutable distribution, atau FileInstall hanya untuk controlled config dengan audit.
```

Jika tetap memakai FileInstall production:

- gunakan atomic rename,
- disable arbitrary manual write,
- folder hanya writable oleh deployment user,
- checksum sebelum deploy,
- record deployment event,
- monitor bundle events,
- health check setelah update,
- rollback script jelas,
- jangan campur config manual dan release artifact.

---

## 10. Felix Web Console

### 10.1 Fungsi

Felix Web Console adalah UI web untuk inspect/manage OSGi runtime.

Biasanya menyediakan view untuk:

- bundles,
- services,
- components,
- configuration,
- logs,
- framework properties,
- system information.

Ini berguna untuk:

- development,
- troubleshooting,
- operations internal,
- training.

### 10.2 Risiko Security

Web Console sangat powerful.

Jika exposed sembarangan, attacker bisa:

- melihat bundle dan dependency,
- membaca konfigurasi sensitif,
- stop/start/update bundle,
- mengubah config,
- mengganggu runtime.

Rule:

```text
Jangan expose Web Console ke public network.
```

Production hardening:

- bind ke localhost/internal network,
- pakai strong auth,
- disable jika tidak perlu,
- restrict role admin,
- audit access,
- jangan tampilkan secret value mentah,
- gunakan reverse proxy dengan allowlist,
- matikan upload/install capability jika tidak diperlukan.

### 10.3 Web Console Bukan Observability Platform

Web Console bagus untuk inspeksi manual.

Tapi production observability tetap perlu:

- structured logs,
- metrics,
- health checks,
- traces,
- alerting,
- deployment events,
- runtime topology snapshot.

Web Console adalah microscope, bukan monitoring system.

---

## 11. Felix Dependency Manager vs Declarative Services

Felix Dependency Manager adalah component/dependency model alternatif.

Ia mendukung pola seperti:

- service dependency,
- configuration dependency,
- bundle dependency,
- resource dependency,
- adapter,
- aspect,
- factory configuration.

Secara historis, Dependency Manager populer untuk aplikasi Felix.

Namun untuk OSGi modern, default recommendation biasanya:

```text
Pakai Declarative Services kecuali ada alasan spesifik.
```

Kenapa DS sering lebih baik:

- standardized OSGi Compendium,
- annotation resmi,
- tooling bnd mature,
- runtime introspection standard,
- portable antar Felix/Equinox/Karaf,
- lebih umum di ekosistem modern.

Dependency Manager bisa dipilih jika:

- existing codebase sudah DM,
- pattern DM tertentu sangat cocok,
- team memahami lifecycle DM,
- portability bukan masalah besar.

Jangan campur DS dan DM tanpa boundary jelas. Dual component model dapat membuat lifecycle reasoning sulit.

---

## 12. Felix HTTP Runtime Ringkas

Felix juga punya HTTP-related subprojects. Dalam konteks OSGi modern, kamu perlu memahami perbedaan:

- OSGi HTTP Service,
- HTTP Whiteboard,
- Jetty-based implementation,
- servlet registration,
- resource registration,
- context handling.

Part web HTTP OSGi akan dibahas khusus di Part 15. Di sini cukup pahami:

```text
Felix Framework tidak otomatis punya HTTP server.
```

Jika kamu ingin REST endpoint, kamu perlu memasang:

- HTTP service/whiteboard implementation,
- servlet API bundle yang sesuai,
- Jersey/CXF/JAX-RS runtime jika perlu,
- application servlet/resource bundles.

Common failure:

```text
Bundle ACTIVE, servlet tidak muncul.
```

Kemungkinan:

- HTTP Whiteboard implementation tidak ada,
- servlet context missing,
- DS reference unsatisfied,
- wrong service properties,
- servlet API package version mismatch,
- javax vs jakarta mismatch,
- Jetty bundle belum start.

---

## 13. Logging di Felix Runtime

Felix Framework sendiri tidak sama dengan logging platform.

OSGi punya Log Service specification, tetapi banyak aplikasi juga memakai:

- SLF4J,
- Logback,
- Log4j2,
- JUL,
- Pax Logging di Karaf ecosystem.

Dalam runtime Felix minimal, kamu harus eksplisit menentukan:

- API logging apa dipakai bundle,
- binding/backend apa tersedia,
- package export/import untuk logging,
- lifecycle logging saat early startup,
- log routing ke stdout/file/collector.

Common issue:

```text
SLF4J: No providers were found
```

atau:

```text
ClassCastException between org.slf4j.LoggerFactory from different bundles
```

Design rule:

- logging API package harus konsisten,
- binding sebaiknya tunggal,
- jangan embed SLF4J API di banyak bundle,
- expose logging package dari satu provider yang jelas,
- runtime distribution harus memasukkan backend.

---

## 14. Layout Runtime Felix yang Sehat

### 14.1 Development Layout

```text
runtime-dev/
  bin/
    felix.jar
  conf/
    config.properties
  bundle/
    org.apache.felix.gogo.runtime.jar
    org.apache.felix.gogo.command.jar
    org.apache.felix.gogo.shell.jar
    org.apache.felix.scr.jar
    org.apache.felix.configadmin.jar
    org.apache.felix.fileinstall.jar
  deploy/
    com.example.case.api.jar
    com.example.case.impl.jar
    com.example.case.rules.default.jar
    com.example.connector.mock.jar
  config/
    com.example.case.runtime.cfg
  felix-cache/
```

Bagus untuk local iteration.

### 14.2 Test Layout

```text
runtime-test/
  app.bndrun
  generated/
    bundles/
    reports/
    wiring.json
    components.json
```

CI sebaiknya menghasilkan:

- resolved bundle list,
- wiring report,
- baseline report,
- component state after startup,
- integration test result.

### 14.3 Production Layout Immutable

```text
runtime-prod/
  launcher.jar
  lib/
    org.apache.felix.framework.jar
  bundles/
    runtime-services/
      org.apache.felix.scr.jar
      org.apache.felix.configadmin.jar
      org.apache.felix.eventadmin.jar
    application/
      com.example.case.api.jar
      com.example.case.impl.jar
      com.example.case.rules.core.jar
  config/
    application.cfg
  checksums/
    bundles.sha256
  VERSION
```

Properties:

```properties
org.osgi.framework.storage=/var/lib/example-osgi/cache
org.osgi.framework.storage.clean=onFirstInit
```

In containerized production, often prefer ephemeral cache:

```text
container starts -> clean cache -> install exact bundle set -> start -> ready
```

But if startup time matters, persistent cache may be used with strict cache compatibility rules.

---

## 15. Startup Sequence di Felix Runtime

Typical sequence:

```text
1. JVM starts.
2. Launcher loads Felix FrameworkFactory.
3. Framework created with properties.
4. Framework init creates system bundle and BundleContext.
5. Runtime bundles installed.
6. Framework start.
7. Runtime service bundles start: SCR, ConfigAdmin, EventAdmin, Gogo, etc.
8. Application API bundles resolve.
9. Application implementation bundles start.
10. SCR scans DS descriptors.
11. Config Admin provides configurations.
12. DS activates satisfied components.
13. Services registered.
14. Health/readiness component declares runtime ready.
```

Top-tier insight:

> `framework.start()` is not equivalent to application readiness.

Readiness should be based on:

- required bundles active/resolved,
- required DS components active/satisfied,
- required services registered,
- required config loaded,
- required external dependencies checked or degraded intentionally,
- no critical resolver/component errors.

---

## 16. Shutdown Semantics

Shutdown matters because OSGi runtime is dynamic.

Sequence ideal:

```text
1. Stop accepting new external traffic.
2. Mark readiness false.
3. Drain in-flight work.
4. Stop plugin/application bundles or lower start level.
5. Unregister services.
6. Stop runtime service bundles.
7. Stop framework.
8. Wait for stop event.
9. Exit JVM.
```

Common bug:

```java
framework.stop();
System.exit(0);
```

Tanpa `waitForStop`, component bisa tidak sempat cleanup.

Better:

```java
framework.stop();
framework.waitForStop(30_000);
```

DS components harus punya `@Deactivate` yang:

- idempotent,
- cepat,
- tidak blocking indefinite,
- menutup executor/thread,
- menutup connection/client,
- unregister listener,
- flush work secara bounded.

---

## 17. Update dan Refresh di Felix

### 17.1 Update Bundle

`bundle.update()` mengganti bundle revision.

Tetapi classloader/wiring lama bisa tetap dipakai sampai refresh.

### 17.2 Refresh Packages

Refresh menyebabkan framework menghitung ulang wiring untuk bundle terdampak. Ini bisa menghentikan dan memulai ulang bundle dependent.

Bahaya:

- service hilang sementara,
- DS deactivate/activate,
- in-flight invocation gagal,
- state transient hilang,
- class identity berubah,
- old object dari old classloader masih direferensikan.

Operational rule:

```text
Update/refresh is a runtime topology event, not a harmless file replacement.
```

### 17.3 Hot Update Safety Checklist

Sebelum hot update:

- Apakah package major version compatible?
- Apakah import range consumer menerima versi baru?
- Apakah service contract backward compatible?
- Apakah state migration diperlukan?
- Apakah component deactivate aman?
- Apakah consumer tahan service disappearing?
- Apakah rollback tested?
- Apakah wiring after update diketahui?
- Apakah health check bisa mendeteksi broken component?

Jika jawaban banyak “tidak tahu”, jangan hot update production.

---

## 18. Diagnostics Playbook Felix

### 18.1 Bundle Installed Tapi Tidak Resolved

Gejala:

```text
lb -> Installed
```

Langkah:

```text
diag <id>
headers <id>
inspect requirement package <id>
```

Kemungkinan:

- missing exported package,
- version range mismatch,
- missing execution environment,
- missing required capability,
- fragment host missing,
- native code clause mismatch,
- uses constraint conflict.

Solusi:

- tambahkan provider bundle,
- perbaiki import range,
- perbaiki export version,
- hindari split package,
- gunakan resolver di build sebelum deploy.

### 18.2 Bundle Resolved Tapi Tidak Active

Gejala:

```text
lb -> Resolved
```

Kemungkinan:

- belum di-start,
- start level belum tercapai,
- activation policy lazy,
- previous start failed,
- bundle fragment, bukan host,
- transient start hilang saat restart.

Langkah:

```text
start <id>
headers <id>
```

Cek log exception.

### 18.3 Bundle Active Tapi DS Component Tidak Ada

Kemungkinan:

- `Service-Component` header tidak ada,
- descriptor DS tidak ter-generate,
- SCR bundle tidak active,
- descriptor path salah,
- annotation tidak diproses build tool,
- component disabled.

Langkah:

```text
headers <id>
scr:list
```

### 18.4 Component Unsatisfied

Kemungkinan:

- missing mandatory reference,
- target filter salah,
- config policy require tapi config missing,
- service property mismatch,
- classloader mismatch interface,
- component condition false.

Langkah:

```text
scr:info <component>
services
```

### 18.5 Service Ada Tapi Consumer Tidak Bind

Kemungkinan:

- interface package tidak sama wiring-nya,
- target filter terlalu strict,
- reference cardinality wrong,
- service scope mismatch,
- service ranking/provider selection unexpected,
- consumer component belum satisfied karena dependency lain.

Diagnosis:

```text
check service objectClass
check service properties
check consumer reference target
check package wiring for service interface
```

### 18.6 ClassCastException Antar Bundle

Gejala:

```text
java.lang.ClassCastException: com.example.api.CaseService cannot be cast to com.example.api.CaseService
```

Ini hampir pasti class identity problem.

Penyebab:

- API package ada di dua classloader,
- consumer embed API sendiri,
- provider export API berbeda,
- Require-Bundle/embedded JAR conflict,
- split package.

Solusi:

- API package hanya diekspor dari satu API bundle,
- consumer import package,
- jangan embed API di implementation bundle,
- baseline/version API.

### 18.7 Memory Leak Setelah Bundle Update

Kemungkinan:

- thread dari old bundle masih hidup,
- static cache memegang class dari old classloader,
- service tracker tidak ditutup,
- listener tidak di-unregister,
- executor tidak shutdown,
- TCCL thread menunjuk old classloader,
- external library global registry memegang class.

Checklist deactivate:

```text
close trackers
unregister listeners
shutdown executors
clear caches
close clients
reset TCCL if changed
release service references
```

---

## 19. Felix di Java 8 sampai Java 25

### 19.1 Java 8

Java 8 adalah era banyak OSGi legacy system.

Karakteristik:

- Java EE modules masih ada di JDK,
- JAXB/JAX-WS/Activation tersedia,
- illegal reflective access belum jadi isu JPMS,
- banyak library OSGi lama masih target Java 8.

Risiko:

- library lama tidak siap Java 17+,
- old ASM/ByteBuddy/CGLIB,
- javax dependency implicit dari JDK,
- Security Manager assumptions.

### 19.2 Java 9+

JPMS masuk.

Dampak:

- strong encapsulation bertahap,
- internal JDK API makin sulit diakses,
- module path vs classpath issue,
- removed Java EE modules setelah Java 11,
- `--add-opens` kadang diperlukan untuk legacy reflection.

Felix biasanya berjalan di classpath/unnamed module mode, tetapi libraries di dalam bundle tetap bisa terkena dampak JDK encapsulation jika mengakses internal API.

### 19.3 Java 11/17/21/25

Untuk runtime modern:

- target minimal realistis sering Java 17 atau 21,
- Java 25 masuk horizon modern dengan compatibility test wajib,
- virtual threads bisa dipakai bundle aplikasi, tetapi lifecycle harus dikontrol,
- old libraries harus diupgrade,
- javax/jakarta boundary harus jelas.

### 19.4 Execution Environment

Bundle dapat menyatakan execution environment.

Tetapi jangan mengandalkan EE saja.

CI matrix harus menjalankan:

```text
Java 8  jika masih support legacy
Java 11 jika transitional
Java 17 sebagai modern baseline
Java 21 sebagai LTS modern
Java 25 sebagai latest supported target jika dibutuhkan
```

Yang dites:

- framework startup,
- resolver,
- DS activation,
- reflective libraries,
- HTTP stack,
- persistence stack,
- bytecode generation,
- logging,
- shutdown.

---

## 20. Felix vs Equinox vs Karaf

### 20.1 Felix vs Equinox

Felix:

- ringan,
- mudah embedded,
- populer untuk standalone OSGi,
- fleksibel,
- cocok custom runtime.

Equinox:

- kuat di Eclipse ecosystem,
- p2 provisioning,
- RCP platform,
- extension registry,
- cocok Eclipse-based product.

Jika membangun plugin platform non-Eclipse, Felix sering lebih sederhana.

Jika membangun Eclipse RCP/product, Equinox natural.

### 20.2 Felix vs Karaf

Felix Framework:

- kernel.

Karaf:

- distribution/container yang bisa berjalan di atas Felix atau Equinox,
- punya feature provisioning,
- shell operations,
- config convention,
- deploy folder,
- management layer.

Pilih Felix jika:

- butuh embedded/custom runtime,
- runtime kecil,
- ingin kontrol penuh,
- build distribution sendiri.

Pilih Karaf jika:

- butuh operational container siap pakai,
- banyak bundle/features,
- butuh shell/SSH/config convention,
- team ingin distribution model standar.

---

## 21. Production Engineering dengan Felix

### 21.1 Runtime Bill of Materials

Setiap runtime Felix harus punya BOM:

```text
framework:
  org.apache.felix.framework: x.y.z
runtime services:
  org.apache.felix.scr: a.b.c
  org.apache.felix.configadmin: a.b.c
  org.apache.felix.eventadmin: a.b.c
  org.apache.felix.gogo.runtime: a.b.c
application bundles:
  com.example.case.api: 1.4.0
  com.example.case.impl: 1.4.2
java:
  21.0.x / 25.x
```

Tanpa BOM, production runtime tidak reproducible.

### 21.2 Runtime Topology Snapshot

Saat startup, generate/report:

- bundle list,
- bundle state,
- package wiring,
- registered services,
- DS component state,
- config PID list,
- framework properties,
- Java version,
- build version.

Ini sangat membantu incident response.

### 21.3 Health Model

Health tidak boleh hanya:

```text
JVM process alive
```

Health harus mencakup:

- critical bundles active,
- critical DS components satisfied/active,
- critical services registered,
- critical config present,
- no unresolved bundle,
- no repeated activation failure,
- external connector degraded/healthy sesuai policy.

### 21.4 Deployment Model

Production deployment sebaiknya:

```text
resolve at build time
assemble runtime
sign/checksum artifacts
deploy as immutable unit
start with clean known config
verify health
promote or rollback
```

Bukan:

```text
copy JAR manually into running deploy folder
```

### 21.5 Incident Evidence

Saat incident:

Capture sebelum restart:

- `lb` output,
- `diag` unresolved bundles,
- SCR component list/info,
- service list relevant,
- framework logs,
- thread dump,
- heap/class histogram if leak suspected,
- config snapshot,
- recently changed bundle/config list.

Jangan langsung clean cache tanpa evidence.

---

## 22. Case Study: Felix sebagai Runtime Plugin Validasi Enforcement

Bayangkan sistem regulatory case management punya validation rules yang berbeda per module:

- licensing,
- appeal,
- enforcement,
- correspondence,
- inspection,
- revenue,
- document.

Kita ingin plugin rules bisa ditambah/diupdate tanpa mengubah core.

### 22.1 Bundle Layout

```text
com.example.validation.api
com.example.validation.engine
com.example.validation.rules.licensing
com.example.validation.rules.enforcement
com.example.validation.rules.revenue
com.example.case.api
com.example.case.impl
```

### 22.2 API Bundle

```java
package com.example.validation.api;

public interface ValidationRule {
    ValidationResult validate(ValidationContext context);
}
```

Manifest:

```text
Bundle-SymbolicName: com.example.validation.api
Export-Package: com.example.validation.api;version="1.0.0"
```

### 22.3 Rule Bundle

```java
@Component(
    service = ValidationRule.class,
    property = {
        "module=licensing",
        "rule.code=ACTIVE_LICENSE_REQUIRED",
        "rule.order:Integer=100"
    }
)
public final class ActiveLicenseRequiredRule implements ValidationRule {
    @Override
    public ValidationResult validate(ValidationContext context) {
        // rule logic
        return ValidationResult.pass();
    }
}
```

### 22.4 Engine Bundle

```java
@Component(service = ValidationEngine.class)
public final class OsgiValidationEngine implements ValidationEngine {

    private final AtomicReference<List<ValidationRule>> rules =
            new AtomicReference<>(List.of());

    @Reference(
        service = ValidationRule.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC,
        policyOption = ReferencePolicyOption.GREEDY
    )
    void bindRule(ValidationRule rule, Map<String, Object> props) {
        updateRules();
    }

    void unbindRule(ValidationRule rule, Map<String, Object> props) {
        updateRules();
    }

    private void updateRules() {
        // build immutable sorted snapshot in real implementation
    }
}
```

Better pattern: use bind/unbind to maintain map, then publish immutable snapshot.

### 22.5 Runtime Felix

Need:

```text
Felix Framework
Felix SCR
Felix ConfigAdmin
Gogo shell for diagnostics
Application bundles
Rule bundles
```

### 22.6 Failure Mode

Rule bundle update during validation:

- old service unregisters,
- engine receives unbind,
- snapshot updated,
- new service registers,
- engine receives bind,
- new snapshot active.

To avoid inconsistent validation:

- each validation request captures snapshot once,
- snapshot immutable,
- in-flight request continues with old snapshot,
- new requests use new snapshot.

This is the kind of design OSGi expects.

---

## 23. Anti-Patterns Felix Runtime

### 23.1 Treating Felix Like Plain Classpath

Bad:

```text
Put all JARs in bundle folder and hope it works.
```

Good:

```text
Resolve runtime closure, inspect imports/exports, test wiring.
```

### 23.2 Installing SCR But Forgetting DS Metadata

Bad:

```java
@Component
public class MyService {}
```

But build does not generate `OSGI-INF/*.xml`.

Good:

```text
Use bnd annotations processing and verify Service-Component header.
```

### 23.3 Web Console Exposed Publicly

Bad:

```text
/webconsole accessible from internet
```

Good:

```text
internal only, authenticated, audited, or disabled.
```

### 23.4 FileInstall as Release Management

Bad:

```text
Production release = copy bundle to deploy folder.
```

Good:

```text
Production release = immutable runtime distribution.
```

### 23.5 Boot Delegation to Hide Dependency Problems

Bad:

```properties
org.osgi.framework.bootdelegation=*
```

This destroys modularity.

Good:

```text
Fix imports/exports/wrapping; use boot delegation only for narrow legacy bridge.
```

### 23.6 No Runtime Shell in Dev/Test

Without shell or introspection, engineers guess.

Good:

```text
Provide Gogo/SCR commands in dev/test, restricted/removed/secured in production.
```

### 23.7 No Cache Policy

Bad:

```text
Cache sometimes reused, sometimes deleted manually.
```

Good:

```text
Define cache strategy per environment.
```

---

## 24. Review Checklist untuk Felix Runtime

### 24.1 Runtime Composition

- [ ] Felix Framework version pinned.
- [ ] Runtime service bundles version pinned.
- [ ] Application bundles version pinned.
- [ ] Runtime BOM exists.
- [ ] No random untracked bundle in production.
- [ ] Resolver validation done before deployment.

### 24.2 Framework Configuration

- [ ] `org.osgi.framework.storage` explicitly set.
- [ ] Cache clean policy documented.
- [ ] Boot delegation minimized.
- [ ] System packages extra justified.
- [ ] Start level policy documented.
- [ ] Java version target documented.

### 24.3 Diagnostics

- [ ] Gogo available in dev/test.
- [ ] SCR introspection available.
- [ ] Bundle state report available.
- [ ] Service registry report available.
- [ ] Component state report available.
- [ ] Config snapshot available.

### 24.4 Declarative Services

- [ ] SCR bundle installed and active.
- [ ] DS descriptors generated.
- [ ] `Service-Component` header exists.
- [ ] Required config available.
- [ ] Required references satisfied.
- [ ] Activation/deactivation bounded and idempotent.

### 24.5 FileInstall

- [ ] Used only where justified.
- [ ] Atomic deployment method used.
- [ ] Directory permissions restricted.
- [ ] Config drift controlled.
- [ ] Delete/update semantics understood.
- [ ] Rollback tested.

### 24.6 Security

- [ ] Web Console disabled or secured.
- [ ] Shell access restricted.
- [ ] Management endpoints internal only.
- [ ] Secrets not exposed in config UI/logs.
- [ ] Bundle sources trusted.
- [ ] Checksums/signatures considered.

### 24.7 Production Readiness

- [ ] Health model checks OSGi state, not just process.
- [ ] Startup readiness waits for critical components.
- [ ] Shutdown graceful.
- [ ] Hot update policy defined.
- [ ] Incident capture procedure exists.
- [ ] Java 8–25 compatibility tested as required.

---

## 25. Kesimpulan

Apache Felix adalah runtime OSGi yang sangat penting untuk dipahami karena ia memperlihatkan OSGi dalam bentuk paling jelas: **framework kernel + bundle runtime services yang kamu pilih sendiri**.

Felix mengajarkan disiplin platform engineering:

- runtime harus dirakit secara eksplisit,
- bundle state tidak sama dengan application readiness,
- shell dan introspection adalah kebutuhan, bukan nice-to-have,
- DS butuh SCR runtime dan metadata yang benar,
- FileInstall adalah alat kuat tapi berbahaya jika dipakai sebagai deployment sembarangan,
- Web Console berguna tetapi harus diamankan,
- cache, update, refresh, dan lifecycle adalah bagian dari desain sistem,
- production runtime harus reproducible.

Jika Part 0–11 membangun mental model dan tooling, Part 12 ini menunjukkan bagaimana konsep tersebut hidup di runtime konkret.

Di part berikutnya, kita akan membahas **Eclipse Equinox Runtime**: framework yang sangat berpengaruh di Eclipse ecosystem, p2 provisioning, extension registry, RCP lessons, dan perbedaannya dengan Felix.

---

## 26. Status Series

```text
Part 12 dari 35 selesai.
Series belum selesai.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 11 — bnd and Bndtools: Build Intelligence for OSGi Engineering](./11-bnd-bndtools-build-intelligence-osgi-engineering.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 13 — Eclipse Equinox Runtime: Eclipse Platform, p2, Extension Registry, Enterprise Lessons](./13-eclipse-equinox-runtime-eclipse-platform-p2-extension-registry-enterprise-lessons.md)
