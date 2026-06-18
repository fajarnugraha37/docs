# Part 1 — OSGi Core Architecture: Framework Layers and Runtime Invariants

**Series:** `learn-java-osgi-dynamic-module-runtime-engineering`  
**File:** `01-osgi-core-architecture-framework-layers-runtime-invariants.md`  
**Target Java:** 8 sampai 25  
**Level:** Advanced / platform engineering / runtime architecture / failure modelling

---

## 0. Apa yang ingin dicapai di Part 1?

Part 0 membangun mental model bahwa OSGi bukan sekadar plugin framework, melainkan **dynamic module runtime**. Part 1 masuk ke struktur inti runtime tersebut: bagaimana framework OSGi membagi tanggung jawab ke beberapa layer, bagaimana bundle bergerak melalui lifecycle, apa arti state seperti `INSTALLED`, `RESOLVED`, dan `ACTIVE`, serta invariant apa yang harus selalu kamu pegang ketika mendesain sistem berbasis OSGi.

Tujuan part ini adalah membuat kamu mampu membaca runtime OSGi sebagai **state machine yang hidup**, bukan sebagai kumpulan JAR yang kebetulan bisa di-start dan di-stop.

Setelah menyelesaikan part ini, kamu harus bisa menjawab pertanyaan seperti:

1. Apa bedanya bundle yang `RESOLVED` dengan bundle yang `ACTIVE`?
2. Kenapa bundle bisa `ACTIVE` tetapi service yang kamu butuhkan belum tersedia?
3. Kenapa install bundle tidak sama dengan resolve, dan resolve tidak sama dengan start?
4. Apa hubungan Security Layer, Module Layer, Life Cycle Layer, dan Service Layer?
5. Apa konsekuensi start level terhadap startup ordering dan production readiness?
6. Bagaimana cara berpikir tentang event framework, event bundle, dan event service?
7. Kenapa `BundleActivator` bukan model komponen ideal untuk sebagian besar aplikasi modern?
8. Kenapa runtime OSGi tidak boleh diasumsikan stabil seperti aplikasi classpath biasa?
9. Apa invariant yang harus dijaga agar sistem modular tidak berubah menjadi chaos?

Referensi utama yang menjadi dasar materi ini:

- OSGi Core Release 8 Specification — https://docs.osgi.org/specification/osgi.core/8.0.0/
- OSGi Core R8 Introduction — https://docs.osgi.org/specification/osgi.core/8.0.0/framework.introduction.html
- OSGi Core Lifecycle Layer — https://docs.osgi.org/specification/osgi.core/8.0.0/framework.lifecycle.html
- OSGi Core Module Layer — https://docs.osgi.org/specification/osgi.core/8.0.0/framework.module.html
- OSGi Core Service Layer — https://docs.osgi.org/specification/osgi.core/8.0.0/framework.service.html
- Apache Felix documentation — https://felix.apache.org/documentation/
- Eclipse Equinox documentation — https://equinox.eclipseprojects.io/
- bnd/Bndtools documentation — https://bndtools.org/

---

## 1. OSGi Framework sebagai runtime state machine

Cara paling aman memahami OSGi adalah melihatnya sebagai **runtime state machine**.

Di aplikasi Java biasa, lifecycle besar biasanya seperti ini:

```text
process starts
  -> main method runs
  -> framework bootstraps
  -> application serves traffic
  -> process stops
```

Di OSGi, lifecycle-nya lebih kaya:

```text
JVM process starts
  -> OSGi framework starts
  -> framework storage/cache is opened
  -> installed bundles are discovered or restored
  -> bundles are resolved against dependency constraints
  -> selected bundles are started according to policy/start level
  -> bundles register services
  -> other bundles bind to services
  -> services can appear/disappear while process is still alive
  -> bundles can be installed/updated/stopped/uninstalled dynamically
  -> framework may refresh wirings
  -> runtime continues
```

Artinya, aplikasi bukan satu state besar bernama “running”. Aplikasi adalah **komposisi banyak state kecil**:

- state framework
- state bundle
- state wiring
- state service
- state Declarative Services component
- state configuration
- state start level
- state classloader
- state repository/provisioning

Jika kamu hanya melihat `bundle ACTIVE`, kamu belum melihat keseluruhan kebenaran runtime. Bundle `ACTIVE` hanya berarti bundle tersebut sudah melewati lifecycle start sesuai definisi framework. Itu tidak otomatis berarti:

- semua service dependency-nya available,
- semua DS component-nya satisfied,
- semua HTTP endpoint-nya registered,
- semua database connection pool-nya sehat,
- semua plugin extension-nya compatible,
- aplikasi siap menerima traffic.

Inilah perbedaan penting antara **lifecycle state** dan **operational readiness**.

---

## 2. Struktur layer OSGi Core

OSGi Core secara konseptual dibagi ke beberapa layer besar:

```text
+---------------------------------------------------------+
| Application / Actual Services                           |
| Bundles that implement domain logic, adapters, plugins  |
+---------------------------------------------------------+
| Service Layer                                           |
| Dynamic publish/find/bind service registry              |
+---------------------------------------------------------+
| Life Cycle Layer                                        |
| Install, resolve, start, stop, update, uninstall        |
+---------------------------------------------------------+
| Module Layer                                            |
| Bundle identity, package import/export, class loading   |
+---------------------------------------------------------+
| Security Layer                                          |
| Permission model, bundle trust, protected operations    |
+---------------------------------------------------------+
| Java VM                                                 |
+---------------------------------------------------------+
```

Urutan ini bukan sekadar diagram. Ia menunjukkan dependency antar layer:

- Life Cycle Layer bergantung pada Module Layer karena bundle yang di-start harus punya class space yang valid.
- Service Layer bergantung pada Life Cycle Layer karena service didaftarkan oleh bundle yang hidup.
- Security Layer melindungi operasi di layer lain.
- Application layer memakai semua mekanisme di bawahnya.

OSGi terlihat kompleks karena ia tidak hanya menyelesaikan satu masalah. Ia menyelesaikan beberapa masalah sekaligus:

| Layer | Pertanyaan yang dijawab |
|---|---|
| Security | Siapa boleh melakukan apa terhadap bundle, package, service, capability? |
| Module | Class/package apa yang terlihat oleh bundle ini? Dari provider mana? Versi berapa? |
| Life Cycle | Bundle ini sudah diinstall, resolved, started, stopped, updated, atau uninstalled? |
| Service | Objek service apa yang tersedia saat ini? Siapa provider-nya? Bagaimana consumer bind? |
| Application | Domain capability apa yang sedang aktif di runtime? |

Top 1% engineer tidak mencampuradukkan layer-layer ini. Banyak bug OSGi terjadi karena engineer salah membaca gejala dari satu layer sebagai masalah di layer lain.

Contoh:

| Gejala | Bisa terlihat seperti | Akar masalah sebenarnya |
|---|---|---|
| `ClassNotFoundException` | Library belum ada | Package tidak di-import atau tidak diekspor provider |
| Bundle `RESOLVED` tapi feature tidak jalan | Bundle error | Bundle belum started atau DS component belum satisfied |
| Service tidak ditemukan | Provider tidak ada | Service property/filter tidak match atau provider belum aktif |
| Bundle tidak bisa resolve | Runtime broken | Version range, uses constraint, missing capability, split package |
| Endpoint tidak muncul | HTTP server mati | HTTP Whiteboard service belum tersedia atau context selector salah |

---

## 3. Security Layer: fondasi proteksi operasi runtime

Security Layer sering diabaikan ketika belajar OSGi modern karena banyak deployment menjalankan OSGi dalam trusted environment tanpa policy security yang ketat. Tetapi secara arsitektur, Security Layer penting karena OSGi didesain untuk runtime yang bisa menerima bundle berbeda, bahkan dari pihak berbeda.

Security Layer mengatur operasi seperti:

- bundle mana boleh install/update/uninstall bundle lain,
- bundle mana boleh import/export package tertentu,
- bundle mana boleh register/get service tertentu,
- bundle mana boleh melakukan administrative operation,
- bagaimana permission diberikan berdasarkan lokasi, signer, atau kondisi tertentu.

Dalam OSGi Core, permission model mencakup konsep seperti:

- `AdminPermission`
- `ServicePermission`
- `PackagePermission`
- `CapabilityPermission`
- `BundlePermission`
- `AdaptPermission`

Namun perlu hati-hati: sejak Java modern, terutama setelah deprecation dan perubahan status Java Security Manager, model sandboxing Java klasik tidak lagi bisa diasumsikan sebagai strategi isolasi utama untuk untrusted code. Jadi, dalam desain 2026, Security Layer OSGi lebih realistis dipahami sebagai:

1. **runtime governance mechanism** untuk trusted atau semi-trusted bundles,
2. **administrative protection** untuk operasi framework,
3. **visibility and permission discipline** untuk runtime modular,
4. bukan sandbox sempurna untuk menjalankan kode jahat tanpa risiko.

### 3.1 Mental model security yang sehat

Jangan berpikir:

```text
OSGi = aman menjalankan plugin siapa saja di JVM saya
```

Pikirkan:

```text
OSGi = memberi mekanisme modular, permission, signing, dan governance,
tetapi untrusted plugin tetap membutuhkan threat model ekstra.
```

Jika sistem kamu perlu menjalankan plugin dari pihak tidak sepenuhnya dipercaya, pertimbangkan kombinasi:

- process isolation,
- container isolation,
- restricted API surface,
- signed bundles,
- repository trust,
- permission policy,
- runtime audit,
- resource quota,
- external sandbox,
- capability review,
- certification test suite.

Security OSGi akan dibahas lebih dalam di Part 18. Di Part 1, cukup pegang invariant ini:

> Runtime modular tidak otomatis berarti runtime aman. Modularity mengatur visibility dan lifecycle; trust boundary tetap harus didesain eksplisit.

---

## 4. Module Layer: class visibility sebagai kontrak runtime

Module Layer adalah salah satu bagian paling penting dari OSGi. Di sinilah OSGi berbeda drastis dari classpath Java biasa.

Di classpath biasa:

```text
Semua JAR berada dalam satu classpath besar.
Jika class ada, hampir semua code bisa melihatnya.
```

Di OSGi:

```text
Setiap bundle punya class space sendiri.
Bundle hanya bisa melihat:
1. class miliknya sendiri,
2. package yang di-import dari bundle lain,
3. package tertentu dari parent/boot sesuai aturan,
4. resource/class dari fragment yang attached,
5. class dari Bundle-ClassPath internalnya.
```

Module Layer mengubah dependency dari implicit menjadi explicit.

### 4.1 Bundle sebagai module runtime

Bundle bukan hanya JAR. Bundle adalah JAR dengan metadata OSGi yang menjelaskan:

- identity (`Bundle-SymbolicName`),
- version (`Bundle-Version`),
- packages yang diekspor (`Export-Package`),
- packages yang diimpor (`Import-Package`),
- capability yang disediakan (`Provide-Capability`),
- capability yang dibutuhkan (`Require-Capability`),
- activator (`Bundle-Activator`),
- DS metadata (`Service-Component`),
- fragment host (`Fragment-Host`),
- native code (`Bundle-NativeCode`),
- dan metadata lainnya.

Secara mental, bundle punya beberapa identity sekaligus:

```text
Bundle artifact identity    = file JAR / Maven coordinate
Bundle runtime identity     = Bundle-SymbolicName + Bundle-Version + location
Bundle class space identity = wiring hasil resolver
Bundle lifecycle identity   = state dalam framework
Bundle service identity     = service yang didaftarkan ke registry
```

Kesalahan umum adalah mengira Maven coordinate sama dengan runtime identity. Dalam OSGi, Maven hanya supply artifact. Framework yang menentukan runtime identity dan wiring.

### 4.2 Package-level dependency

OSGi lebih presisi daripada dependency JAR-level karena ia bekerja di level package.

Contoh:

```text
Bundle A imports com.fasterxml.jackson.databind; version="[2.15,3)"
Bundle B exports com.fasterxml.jackson.databind; version="2.16.1"
```

A tidak peduli JAR Maven apa yang membawa package tersebut selama provider mengekspor package yang cocok dengan constraint.

Ini memberi fleksibilitas besar, tetapi juga memaksa disiplin:

- package API harus jelas,
- package internal jangan diekspor,
- version range harus masuk akal,
- split package harus dihindari,
- uses constraint harus dipahami.

Module Layer akan dibahas jauh lebih dalam di Part 3, 4, dan 5. Di Part 1, invariant yang perlu dipegang:

> Dalam OSGi, class visibility adalah hasil kontrak metadata dan resolver wiring, bukan efek samping urutan JAR di classpath.

---

## 5. Life Cycle Layer: operasi runtime terhadap bundle

Life Cycle Layer menyediakan API dan state model untuk mengelola bundle saat runtime.

Operasi utama:

- install,
- resolve,
- start,
- stop,
- update,
- uninstall.

State utama bundle:

```text
INSTALLED -> RESOLVED -> STARTING -> ACTIVE -> STOPPING -> RESOLVED
      \                                            /
       \------------------------------------------/
                    update / uninstall / refresh
```

Lebih lengkap:

```text
                 +-------------+
                 | INSTALLED   |
                 +-------------+
                        |
                        | resolve succeeds
                        v
                 +-------------+
          +----> | RESOLVED    | <----+
          |      +-------------+      |
          |             |             |
          |             | start       | stop completed
          |             v             |
          |      +-------------+      |
          |      | STARTING    |      |
          |      +-------------+      |
          |             |             |
          |             | activator returns / lazy activation completes
          |             v             |
          |      +-------------+      |
          |      | ACTIVE      | -----+
          |      +-------------+
          |             |
          |             | stop
          |             v
          |      +-------------+
          +------| STOPPING    |
                 +-------------+

                 +-------------+
                 | UNINSTALLED |
                 +-------------+
```

### 5.1 `INSTALLED`

`INSTALLED` berarti bundle sudah masuk ke framework, metadata dasarnya bisa dibaca, tetapi dependency belum tentu valid.

Pada state ini:

- bundle punya ID runtime,
- manifest sudah dikenali,
- bundle belum punya class space lengkap,
- imports belum tentu wired,
- bundle belum siap start,
- activator belum dipanggil,
- service belum didaftarkan.

Contoh operational interpretation:

```text
Bundle ada di runtime, tetapi belum tentu usable.
```

Bundle bisa stuck di `INSTALLED` jika:

- ada missing import package,
- version range tidak match,
- required capability tidak tersedia,
- fragment host tidak cocok,
- execution environment tidak terpenuhi,
- uses constraint tidak bisa dipenuhi,
- native code clause tidak cocok.

### 5.2 `RESOLVED`

`RESOLVED` berarti dependency statis bundle sudah dipenuhi dan framework telah membentuk wiring yang valid.

Pada state ini:

- imported packages sudah wired ke exporter,
- required bundles/capabilities sudah ditemukan,
- bundle classloader bisa bekerja sesuai wiring,
- bundle siap di-start,
- tetapi bundle belum tentu menjalankan logic aplikasi.

`RESOLVED` tidak berarti service tersedia. Service biasanya didaftarkan saat bundle start atau saat DS component aktif.

Operational interpretation:

```text
Bundle secara modular valid, tetapi belum tentu menjalankan behaviour.
```

### 5.3 `STARTING`

`STARTING` adalah state transisi ketika bundle sedang dimulai.

Jika bundle punya `BundleActivator`, framework memanggil:

```java
public void start(BundleContext context) throws Exception
```

Bundle bisa berada di `STARTING` karena:

- activator sedang berjalan,
- lazy activation policy membuat bundle belum sepenuhnya aktif sampai trigger tertentu,
- activation sedang menunggu pekerjaan tertentu,
- ada blocking call yang buruk di startup.

Hal yang harus dihindari di start:

- network call blocking tanpa timeout,
- migration database panjang,
- thread sleep,
- waiting service secara manual tanpa timeout,
- heavy scanning,
- synchronous remote dependency initialization,
- membuat thread non-daemon tanpa lifecycle management,
- register service sebelum object benar-benar siap.

### 5.4 `ACTIVE`

`ACTIVE` berarti bundle telah berhasil di-start.

Namun ini perlu dibaca dengan hati-hati:

```text
ACTIVE = lifecycle start sukses
ACTIVE != aplikasi siap secara bisnis
ACTIVE != semua component aktif
ACTIVE != semua dependency runtime sehat
```

Jika bundle menggunakan Declarative Services, bundle bisa `ACTIVE` tetapi DS component tertentu masih unsatisfied karena:

- mandatory service reference belum ada,
- configuration PID belum tersedia,
- target filter tidak cocok,
- component disabled,
- component activation gagal,
- referenced service punya ranking/filter yang tidak sesuai.

### 5.5 `STOPPING`

`STOPPING` adalah state transisi ketika bundle sedang dihentikan. Framework memanggil:

```java
public void stop(BundleContext context) throws Exception
```

Pada stop, bundle harus:

- unregister service,
- stop thread,
- close resource,
- release trackers,
- flush buffer jika perlu,
- stop scheduled task,
- detach listener,
- cleanup classloader references,
- jangan menunggu tak terbatas.

Kesalahan stop bisa menyebabkan:

- memory leak,
- classloader leak,
- stale thread,
- stale service reference,
- deadlock saat shutdown,
- bundle tidak bisa di-refresh bersih.

### 5.6 `UNINSTALLED`

`UNINSTALLED` berarti bundle sudah dihapus dari framework. Bundle object masih mungkin ada sebagai handle lama, tetapi operasi yang boleh dilakukan sangat terbatas.

Operationally:

```text
Jangan simpan reference ke Bundle lama sebagai runtime truth.
```

Runtime truth harus selalu dibaca ulang dari framework state.

---

## 6. Lifecycle operation: install, resolve, start, stop, update, uninstall

### 6.1 Install

Install memasukkan bundle ke framework.

Pseudo-flow:

```text
input: bundle location / stream
framework reads manifest
framework assigns bundle id
framework persists bundle in cache
state becomes INSTALLED
BundleEvent.INSTALLED is fired
```

Install tidak menjamin bundle bisa resolve.

Design implication:

> Repository/provisioning pipeline harus membedakan “artifact delivered” dari “runtime dependency graph valid”.

### 6.2 Resolve

Resolve membentuk wiring statis.

Pseudo-flow:

```text
framework inspects requirements
framework searches matching capabilities
resolver checks versions, attributes, directives
resolver checks uses constraints
resolver creates wiring
state becomes RESOLVED if successful
```

Resolve bisa terjadi eksplisit atau otomatis saat start.

Design implication:

> Production deployment sebaiknya punya resolver validation sebelum runtime update, bukan menunggu error saat bundle start.

### 6.3 Start

Start mengeksekusi lifecycle bundle.

Pseudo-flow:

```text
if bundle not resolved:
    resolve bundle
if resolved:
    state STARTING
    call BundleActivator.start if present
    process lazy activation if configured
    state ACTIVE when successful
```

Start bisa gagal walaupun resolve sukses.

Contoh:

- class dependency valid, tetapi config hilang,
- database down,
- activator melempar exception,
- service registration gagal,
- permission denied,
- native library gagal load.

### 6.4 Stop

Stop menghentikan bundle.

Pseudo-flow:

```text
state STOPPING
call BundleActivator.stop if present
unregister bundle services
release framework-managed resources
state RESOLVED
```

Stop tidak menghapus bundle. Bundle masih installed dan resolved.

### 6.5 Update

Update mengganti content bundle.

Pseudo-flow:

```text
old bundle content exists
new content is installed at same bundle identity slot
bundle may need refresh
old wiring can remain until refresh
new wiring created after refresh/resolve
```

Ini salah satu bagian paling sering disalahpahami.

Dalam OSGi, update bundle tidak selalu langsung memaksa semua dependent bundle memakai class baru. Wiring lama bisa tetap aktif sampai refresh dilakukan. Ini penting untuk stabilitas runtime, tetapi juga menciptakan risiko jika operator berpikir update langsung mengganti semua class di seluruh runtime.

Design implication:

> Update strategy harus punya model refresh, dependent impact, service draining, dan rollback.

### 6.6 Uninstall

Uninstall menghapus bundle dari framework.

Namun efek classloader dan wiring bisa tetap ada sampai refresh jika bundle masih dipakai oleh bundle lain.

Design implication:

> Uninstall bukan garbage collection instan. Runtime dependency impact harus dianalisis.

---

## 7. Bundle lifecycle bukan component lifecycle

Ini poin penting.

OSGi Core lifecycle mengatur bundle. Tetapi aplikasi modern biasanya memakai Declarative Services atau container lain di dalam bundle. Maka ada lebih dari satu lifecycle:

```text
Bundle lifecycle:
INSTALLED / RESOLVED / ACTIVE / STOPPING / UNINSTALLED

DS component lifecycle:
disabled / enabled / unsatisfied / satisfied / active

Application readiness lifecycle:
starting / warming / ready / degraded / draining / stopped
```

Contoh:

```text
Bundle: ACTIVE
DS Component A: active
DS Component B: unsatisfied because config missing
DS Component C: active but downstream DB unhealthy
HTTP endpoint: registered
Readiness: false
```

Jadi jangan membuat readiness check yang hanya bertanya:

```text
Are all bundles ACTIVE?
```

Itu terlalu dangkal.

Readiness OSGi yang sehat perlu melihat:

- framework state,
- required bundles active,
- required DS components active,
- required services registered,
- required configuration valid,
- external dependencies healthy,
- startup tasks completed,
- no unresolved critical bundle,
- no failed component activation,
- no degraded mandatory capability.

---

## 8. BundleActivator: low-level lifecycle hook

`BundleActivator` adalah entry point lifecycle dasar.

Contoh:

```java
package com.example.hello;

import org.osgi.framework.BundleActivator;
import org.osgi.framework.BundleContext;
import org.osgi.framework.ServiceRegistration;

public final class HelloActivator implements BundleActivator {
    private ServiceRegistration<HelloService> registration;

    @Override
    public void start(BundleContext context) {
        HelloService service = new DefaultHelloService();
        registration = context.registerService(
            HelloService.class,
            service,
            null
        );
    }

    @Override
    public void stop(BundleContext context) {
        if (registration != null) {
            registration.unregister();
            registration = null;
        }
    }
}
```

Manifest:

```text
Bundle-Activator: com.example.hello.HelloActivator
```

### 8.1 Kapan BundleActivator masuk akal?

Gunakan `BundleActivator` untuk:

- framework-level bootstrap,
- sangat sedikit initialization low-level,
- register service sederhana tanpa dependency kompleks,
- custom extender,
- custom tracker,
- integration dengan API framework yang memang lifecycle-level,
- eksperimen belajar OSGi Core.

### 8.2 Kapan tidak ideal?

Jangan gunakan `BundleActivator` sebagai default component model untuk aplikasi kompleks karena kamu harus mengelola sendiri:

- dependency binding,
- dynamic service arrival/departure,
- configuration update,
- service unregister,
- concurrency,
- activation ordering,
- circular dependency,
- optional dependency,
- multiple cardinality,
- lifecycle cleanup.

Untuk aplikasi modern, Declarative Services lebih aman karena dependency lifecycle dibuat declarative dan dikelola SCR runtime.

### 8.3 Activator anti-pattern

Anti-pattern umum:

```java
public void start(BundleContext context) throws Exception {
    // BAD: blocks framework startup
    databaseMigration.runHugeMigration();

    // BAD: waits forever
    while (context.getServiceReference(Foo.class) == null) {
        Thread.sleep(1000);
    }

    // BAD: global static access
    GlobalRegistry.setBundleContext(context);

    // BAD: starts unmanaged thread
    new Thread(() -> runForever()).start();
}
```

Masalahnya:

- framework startup bisa stuck,
- service dynamics diabaikan,
- shutdown tidak bersih,
- classloader leak,
- sulit test,
- hidden coupling,
- race condition.

Prinsip sehat:

> Activator harus ringan, cepat, idempotent secara operasional, dan tidak menjadi service container buatan sendiri.

---

## 9. BundleContext: handle ke dunia runtime

`BundleContext` diberikan ke activator dan merepresentasikan konteks eksekusi bundle di framework.

Dari `BundleContext`, bundle bisa:

- mendapatkan bundle dirinya sendiri,
- install bundle lain jika punya permission,
- mendapatkan daftar bundle,
- register service,
- lookup service,
- add/remove listener,
- get property framework,
- create filters,
- access data file area.

Contoh:

```java
Bundle bundle = context.getBundle();
long id = bundle.getBundleId();
String symbolicName = bundle.getSymbolicName();
Version version = bundle.getVersion();
```

### 9.1 BundleContext bukan global singleton

Kesalahan umum:

```java
public final class OsgiGlobals {
    public static BundleContext context;
}
```

Ini buruk karena:

- membuat hidden dependency,
- mempersulit test,
- raw access ke registry tersebar,
- meningkatkan risiko memory leak,
- mengaburkan ownership lifecycle,
- membuat code non-OSGi-aware tercemar API OSGi.

Lebih baik:

- gunakan Declarative Services untuk dependency injection,
- isolate OSGi API di adapter layer,
- jangan leak `BundleContext` ke domain logic,
- gunakan service contract biasa untuk business code.

---

## 10. Service Layer: dynamic registry sebagai communication model

Walaupun Service Layer akan dibahas lebih dalam di Part 7, Part 1 perlu memberi gambaran karena lifecycle bundle sangat terkait dengan service availability.

Service Layer menyediakan registry tempat bundle dapat:

- publish service,
- find service,
- bind ke service,
- unbind ketika service hilang,
- memilih service berdasarkan property/filter/ranking.

Model dasarnya:

```text
Provider bundle starts
  -> registers service object under interface + properties
  -> framework publishes ServiceEvent.REGISTERED
  -> consumer bundle/component binds
  -> service can later be modified/unregistered
```

Service registry bersifat dynamic. Maka consumer yang benar harus siap menghadapi:

- service belum ada saat consumer start,
- service muncul setelah consumer aktif,
- service hilang saat sedang runtime,
- service diganti implementasi lain,
- service property berubah,
- service ranking berubah,
- ada banyak provider untuk interface yang sama.

### 10.1 Bundle ACTIVE tidak sama dengan service registered

Contoh:

```text
payment-provider bundle: ACTIVE
PaymentGateway service: not registered
Reason: missing configuration or activation failure
```

Atau:

```text
rules-engine bundle: ACTIVE
RuleEvaluator services: registered = 0
Reason: plugin bundles not installed
```

Maka troubleshooting harus memisahkan:

- bundle state,
- component state,
- service registry state.

---

## 11. Framework events, bundle events, service events

OSGi runtime dapat diamati melalui event.

Ada beberapa kategori besar:

```text
FrameworkEvent  -> kejadian level framework
BundleEvent     -> perubahan lifecycle bundle
ServiceEvent    -> perubahan registry service
```

### 11.1 FrameworkEvent

Framework events menggambarkan kejadian seperti:

- framework started,
- framework error,
- packages refreshed,
- start level changed,
- warning/info event,
- framework stopped.

Pola penggunaannya:

```java
context.addFrameworkListener(event -> {
    int type = event.getType();
    Throwable error = event.getThrowable();
    Bundle source = event.getBundle();
    // log or react carefully
});
```

Framework event sebaiknya digunakan untuk observability atau low-level integration, bukan business flow.

### 11.2 BundleEvent

Bundle events muncul saat bundle berubah lifecycle, misalnya:

- installed,
- resolved,
- starting,
- started,
- stopping,
- stopped,
- updated,
- unresolved,
- uninstalled,
- lazy activation.

Pola:

```java
context.addBundleListener(event -> {
    Bundle bundle = event.getBundle();
    int type = event.getType();
    // inspect lifecycle transitions
});
```

Bundle listener berguna untuk:

- custom extender,
- diagnostics,
- lifecycle audit,
- plugin manager,
- runtime inventory,
- management UI.

Namun jangan terlalu mudah menjalankan business logic langsung dari BundleListener. Event lifecycle bisa datang dalam urutan yang perlu dipahami dan bisa terjadi saat framework sedang memegang internal lock tertentu.

### 11.3 ServiceEvent

Service events muncul saat service registry berubah:

- service registered,
- service modified,
- service unregistering,
- modified endmatch.

Pola:

```java
context.addServiceListener(event -> {
    ServiceReference<?> ref = event.getServiceReference();
    int type = event.getType();
    // inspect service dynamics
});
```

Untuk konsumsi service biasa, jangan manual listener kecuali perlu. Lebih aman menggunakan:

- Declarative Services,
- ServiceTracker,
- whiteboard pattern.

### 11.4 Event bukan readiness guarantee

Mendapat event `BundleEvent.STARTED` tidak berarti sistem siap. Itu hanya berarti bundle start selesai. Jika kamu membangun readiness model, event harus digabung dengan state query:

```text
observed events + current state snapshot + health checks
```

Event stream bisa dipakai untuk membangun timeline, tetapi current state harus tetap diverifikasi.

---

## 12. Start Level: ordering, boot phases, dan operational startup

Start Level adalah mekanisme untuk mengontrol urutan startup bundle dalam fase-fase.

Konsep:

- framework punya active start level,
- bundle punya assigned start level,
- bundle hanya eligible untuk start jika bundle start level <= framework active start level,
- framework bisa menaikkan start level bertahap.

Mental model:

```text
Framework Start Level 1:
  core framework services

Framework Start Level 2:
  logging, config, event admin

Framework Start Level 3:
  data source, transaction, persistence

Framework Start Level 4:
  domain services

Framework Start Level 5:
  web endpoints, plugin adapters
```

Contoh urutan:

```text
start level 1 -> framework infrastructure
start level 2 -> config/logging/shell
start level 3 -> database/messaging/connectors
start level 4 -> domain modules
start level 5 -> web/API modules
```

### 12.1 Start level bukan dependency injection

Start level sering disalahgunakan untuk memaksa ordering yang sebenarnya harus dimodelkan sebagai service dependency.

Salah:

```text
Bundle A harus start sebelum Bundle B karena B butuh service A.
Maka A start level 3, B start level 4.
```

Lebih benar:

```text
Bundle B mendeklarasikan mandatory reference ke service A.
DS menahan component B sampai service A tersedia.
```

Start level cocok untuk **boot phase coarse-grained**, bukan dependency antar component detail.

Gunakan start level untuk:

- framework infrastructure,
- management shell,
- configuration service,
- logging,
- provisioning phase,
- domain layer phase,
- API exposure phase.

Jangan gunakan start level untuk:

- menyelesaikan dependency service individual,
- menghindari DS reference yang benar,
- menutupi race condition,
- memaksa urutan bisnis yang brittle.

### 12.2 Failure mode start level

Beberapa failure mode:

1. Bundle start level terlalu rendah.
   - Domain bundle start sebelum config/logging siap.

2. Bundle start level terlalu tinggi.
   - Bundle tidak pernah start karena framework start level tidak dinaikkan.

3. Start level dianggap readiness.
   - Framework sudah level 5 tetapi component penting masih unsatisfied.

4. Start level dipakai sebagai dependency graph.
   - Sistem menjadi rapuh saat service provider diganti/dinamis.

5. Start level tidak terdokumentasi.
   - Operator tidak tahu kenapa bundle tidak start.

### 12.3 Production guideline

Gunakan start level sebagai **boot choreography**, bukan **business dependency model**.

Contoh policy:

| Start Level | Isi | Tujuan |
|---:|---|---|
| 1 | framework core, minimal shell | introspection awal |
| 2 | logging, config admin, event admin | observability/config tersedia |
| 3 | infrastructure adapters | DB, messaging, cache, external connector |
| 4 | domain services | business capabilities |
| 5 | API/web endpoints | expose traffic setelah domain siap |

Tetap tambahkan readiness check di atas itu.

---

## 13. Resolving is not starting

Salah satu invariant terpenting:

> Resolve membuktikan class space/dependency statis valid. Start mengeksekusi lifecycle. Keduanya berbeda.

Contoh:

```text
Bundle X imports package com.example.api version [1.2,2).
Bundle Y exports com.example.api version 1.5.0.
Resolver berhasil.
Bundle X menjadi RESOLVED.
```

Tetapi saat start:

```text
Bundle X activator reads config /etc/x.properties.
File missing.
Activator throws exception.
Bundle X fails to become ACTIVE.
```

Artinya:

```text
Dependency graph valid, runtime initialization failed.
```

Sebaliknya, start bisa terlihat sukses tetapi service belum ada jika bundle tidak mendaftarkan service karena internal condition.

### 13.1 Diagnostic separation

Ketika ada masalah, pisahkan pertanyaan:

1. Apakah bundle installed?
2. Apakah bundle resolved?
3. Jika tidak resolved, requirement mana yang gagal?
4. Apakah bundle started?
5. Jika start gagal, exception apa dari activator/component?
6. Apakah service yang dibutuhkan registered?
7. Jika tidak registered, component provider satisfied atau tidak?
8. Apakah config tersedia?
9. Apakah dependency external sehat?
10. Apakah readiness model menyatakan sistem siap?

Jangan lompat dari “feature tidak jalan” langsung ke “OSGi problem”. Bisa jadi problem ada di layer berbeda.

---

## 14. Starting is not readiness

Di cloud-native runtime, kita terbiasa dengan readiness/liveness probe. OSGi punya lifecycle internal yang lebih granular, tetapi tetap tidak sama dengan readiness aplikasi.

Contoh runtime:

```text
Framework: STARTED
Critical bundles: ACTIVE
HTTP Whiteboard: ACTIVE
OrderService: registered
DatabaseHealth: DOWN
Readiness: false
```

Atau:

```text
Framework: STARTED
All bundles: ACTIVE
Mandatory plugin services: 0 of 3 available
Readiness: false
```

### 14.1 Readiness model untuk OSGi

Readiness sebaiknya model eksplisit:

```text
ready = frameworkReady
    && criticalBundlesActive
    && criticalComponentsActive
    && requiredServicesAvailable
    && requiredConfigsValid
    && externalDependenciesHealthy
    && noCriticalResolverError
    && startupWarmupComplete
```

Implementasi bisa berupa service:

```java
public interface RuntimeReadiness {
    ReadinessReport check();
}
```

Dengan report:

```java
public final class ReadinessReport {
    private final boolean ready;
    private final List<ReadinessFailure> failures;
}
```

Di OSGi, health/readiness service dapat menginspeksi registry, DS runtime, config admin, dan adapter health.

Prinsip:

> Jangan expose traffic hanya karena framework sudah start. Expose traffic karena capability bisnis yang wajib sudah ready.

---

## 15. Dynamic runtime means state can change after startup

Di aplikasi classpath biasa, dependency graph relatif statis setelah process start. Di OSGi, state bisa berubah:

- bundle baru diinstall,
- bundle distop,
- bundle diupdate,
- service hilang,
- service baru muncul,
- config berubah,
- wiring di-refresh,
- fragment attached setelah refresh,
- start level berubah,
- repository/provisioning melakukan perubahan.

Jadi desain harus tahan terhadap perubahan runtime.

### 15.1 Static assumption yang berbahaya

Berbahaya:

```java
private static PaymentGateway gateway;

public void activate(BundleContext context) {
    ServiceReference<PaymentGateway> ref = context.getServiceReference(PaymentGateway.class);
    gateway = context.getService(ref);
}
```

Masalah:

- service bisa hilang,
- reference stale,
- static field mencegah classloader GC,
- tidak ada ungetService,
- tidak ada rebinding,
- tidak ada thread safety.

Lebih baik dengan DS:

```java
@Component
public final class PaymentProcessor {
    private volatile PaymentGateway gateway;

    @Reference(policy = ReferencePolicy.DYNAMIC)
    void bindPaymentGateway(PaymentGateway gateway) {
        this.gateway = gateway;
    }

    void unbindPaymentGateway(PaymentGateway gateway) {
        if (this.gateway == gateway) {
            this.gateway = null;
        }
    }
}
```

Atau untuk mandatory static reference:

```java
@Component
public final class PaymentProcessor {
    private final PaymentGateway gateway;

    @Activate
    public PaymentProcessor(@Reference PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

Tergantung apakah kamu ingin component restart saat dependency berubah atau ingin dynamic bind/unbind.

---

## 16. Framework storage/cache: runtime punya memori deployment

OSGi framework biasanya memiliki storage/cache area untuk menyimpan installed bundles, generated metadata, wiring state, dan data framework lain.

Implikasi:

- restart JVM tidak selalu sama dengan clean install,
- framework bisa mengingat bundle yang sudah diinstall,
- update bisa meninggalkan state sampai refresh,
- corrupted cache bisa menyebabkan failure aneh,
- clean start dapat menyembunyikan bug update path,
- production rollback harus memperhitungkan cache/runtime state.

### 16.1 Clean start vs warm restart

Clean start:

```text
hapus framework storage/cache
install semua bundle dari distribution
resolve ulang
start ulang dari kondisi bersih
```

Warm restart:

```text
framework memakai storage/cache yang ada
bundle state mungkin dipulihkan
wiring/cache lama bisa memengaruhi behavior
```

Di production, keduanya perlu dites.

| Scenario | Yang diuji |
|---|---|
| Clean start | Apakah distribution lengkap dan reproducible? |
| Warm restart | Apakah runtime bisa pulih dari state sebelumnya? |
| Update without clean | Apakah migration/update path benar? |
| Rollback | Apakah old bundle/config bisa kembali sehat? |

### 16.2 Containerized OSGi

Dalam Docker/Kubernetes, kamu perlu memutuskan:

```text
Apakah framework cache ephemeral atau persistent?
```

Ephemeral cache:

- cocok untuk immutable deployment,
- lebih reproducible,
- clean state setiap pod baru,
- startup mungkin lebih mahal.

Persistent cache:

- cocok untuk mutable/hot deploy runtime,
- bisa mempertahankan installed plugin state,
- lebih kompleks untuk rollback dan corruption recovery.

Untuk cloud-native deployment modern, immutable runtime lebih mudah dioperasikan. Hot deployment tetap bisa dipakai untuk plugin platform, tetapi harus punya governance kuat.

---

## 17. Framework launch: bagaimana runtime dimulai

OSGi framework biasanya dimulai oleh launcher. Launcher dapat berupa:

- Apache Felix Main,
- Equinox launcher,
- Karaf bootstrapping,
- bnd executable JAR,
- custom Java main yang embed framework.

Generic launching pattern:

```java
ServiceLoader<FrameworkFactory> loader = ServiceLoader.load(FrameworkFactory.class);
FrameworkFactory factory = loader.iterator().next();

Map<String, String> config = new HashMap<>();
config.put(Constants.FRAMEWORK_STORAGE, "target/osgi-cache");
config.put(Constants.FRAMEWORK_STORAGE_CLEAN, Constants.FRAMEWORK_STORAGE_CLEAN_ONFIRSTINIT);

Framework framework = factory.newFramework(config);
framework.init();
framework.start();

BundleContext context = framework.getBundleContext();
// install/start bundles
```

Mental model launcher:

```text
Launcher is not application logic.
Launcher assembles runtime, starts framework, provisions bundles, and delegates to OSGi lifecycle.
```

Launcher responsibilities:

- framework selection,
- framework properties,
- storage location,
- initial bundle installation,
- boot start levels,
- shutdown handling,
- logging bootstrap,
- provisioning source,
- management access.

Launcher should not become a hidden monolith that bypasses OSGi model.

---

## 18. Runtime identity: bundle ID, symbolic name, version, location

A bundle in framework has several identifiers:

| Identifier | Meaning |
|---|---|
| Bundle ID | numeric ID assigned by framework |
| Bundle-SymbolicName | logical stable name |
| Bundle-Version | semantic-ish version |
| Location | install source/location string |
| Last modified | update timestamp |
| State | lifecycle state |

Example:

```text
id=42
symbolicName=com.example.case.rules
version=1.4.2
location=mvn:com.example/case-rules/1.4.2
state=ACTIVE
```

### 18.1 Bundle ID is runtime-local

Bundle ID is not stable across clean installs. Jangan pakai bundle ID sebagai persisted business identity.

Gunakan symbolic name + version untuk audit deployment, dan gunakan application-level plugin identity untuk domain governance.

### 18.2 Location matters operationally

Location sering dipakai untuk update/uninstall/provisioning. Jika location berubah secara tidak konsisten, update behavior bisa tidak sesuai harapan.

Contoh buruk:

```text
install file:/tmp/plugin.jar
```

Lalu production update tidak tahu artifact asal.

Lebih baik:

```text
mvn:com.company.plugins/risk-rule-plugin/1.2.0
sha256:...
repository:approved-prod-plugins
```

OSGi sendiri tidak memaksa format location bisnis, tetapi platform kamu sebaiknya punya convention.

---

## 19. Runtime invariants yang harus kamu pegang

Bagian ini penting. Ini adalah “hukum” praktis untuk berpikir OSGi.

### Invariant 1 — Bundle adalah unit lifecycle, bukan hanya unit code

Bundle bisa diinstall, resolve, start, stop, update, uninstall.

Jika kamu membuat bundle, kamu membuat unit yang punya lifecycle sendiri. Maka kamu harus bertanya:

- Apa yang terjadi saat bundle start?
- Apa yang terjadi saat bundle stop?
- Apa resource yang dimiliki bundle?
- Apa service yang didaftarkan bundle?
- Apa dependency yang dynamic?
- Apa yang terjadi jika bundle diupdate?
- Apa state yang harus dimigrate?

### Invariant 2 — Resolve bukan start

Resolver membuktikan dependency statis. Start menjalankan code.

Jangan memakai status resolved sebagai indikator behaviour.

### Invariant 3 — Start bukan ready

Bundle ACTIVE bukan readiness bisnis.

Readiness harus dimodelkan eksplisit.

### Invariant 4 — Service bisa hilang

Jika menggunakan OSGi service, consumer harus siap service:

- belum ada,
- muncul,
- berubah,
- hilang,
- diganti.

Jika kamu tidak ingin dynamic behaviour, gunakan DS static mandatory reference agar component lifecycle dikontrol runtime.

### Invariant 5 — Class visibility eksplisit

Jika class tidak terlihat, jangan langsung menambahkan JAR sembarangan. Periksa:

- package di-export?
- package di-import?
- version range cocok?
- bundle resolved?
- class ada di private package?
- class ada di embedded dependency?
- ada split package?
- ada uses constraint?

### Invariant 6 — Framework cache adalah bagian dari runtime state

Deployment bukan hanya file system. Framework storage/cache bisa memengaruhi behavior.

### Invariant 7 — Metadata adalah kontrak arsitektur

Manifest bukan noise build. Ia adalah kontrak runtime:

- package boundary,
- version policy,
- service component declaration,
- capability requirement,
- activation model.

### Invariant 8 — Dynamic runtime membutuhkan cleanup sempurna

Setiap register harus punya unregister.
Setiap listener harus dilepas.
Setiap tracker harus ditutup.
Setiap thread harus dihentikan.
Setiap resource harus di-release.

Jika tidak, update/refresh akan bocor.

### Invariant 9 — Dependency graph tidak sama dengan startup order

Dependency graph dimodelkan oleh imports/capabilities/services.
Startup order hanya boot choreography.

### Invariant 10 — OSGi menuntut operational literacy

Engineer yang hanya bisa coding bundle tetapi tidak bisa membaca runtime state akan kesulitan di production.

Kamu harus nyaman dengan:

- shell commands,
- bundle state,
- resolver diagnostics,
- service registry,
- DS component state,
- framework events,
- logs,
- wiring graph,
- start levels,
- refresh/update semantics.

---

## 20. Mapping state ke diagnostic action

Ketika production issue terjadi, gunakan pendekatan state-first.

### 20.1 Feature tidak jalan

Pertanyaan:

```text
1. Bundle feature ada?
2. Bundle state apa?
3. Jika INSTALLED, requirement apa yang missing?
4. Jika RESOLVED, kenapa belum started?
5. Jika ACTIVE, service apa yang harus ada?
6. DS component provider active atau unsatisfied?
7. Config PID ada dan valid?
8. Service consumer bind ke provider mana?
9. Ada multiple provider/ranking issue?
10. External dependency sehat?
```

### 20.2 Bundle stuck INSTALLED

Kemungkinan:

- missing import,
- missing required capability,
- wrong Java execution environment,
- version range incompatible,
- fragment host not found,
- native code clause mismatch,
- uses constraint violation.

Aksi:

- inspect manifest,
- run resolver diagnostic,
- inspect repository capabilities,
- inspect exports available,
- check Java version,
- check package versions,
- check uses constraints.

### 20.3 Bundle RESOLVED but not ACTIVE

Kemungkinan:

- not requested to start,
- start level too high,
- start policy lazy,
- previous start failed,
- operator only installed but not started,
- bundle is fragment,
- bundle has no activator and no component requiring activation.

Aksi:

- check start level,
- check bundle type,
- manually start with diagnostics,
- inspect logs,
- inspect DS components.

### 20.4 Bundle ACTIVE but service missing

Kemungkinan:

- service registered by DS component that is unsatisfied,
- config missing,
- target filter mismatch,
- provider disabled,
- activation exception,
- service registered under different interface,
- package class identity mismatch,
- service property mismatch.

Aksi:

- inspect service registry,
- inspect DS component state,
- inspect component references,
- inspect config admin,
- check class package wiring.

### 20.5 Service exists but consumer not binding

Kemungkinan:

- consumer imports different API package provider,
- filter mismatch,
- cardinality/policy issue,
- service ranking not expected,
- consumer component inactive,
- uses constraint caused different class space,
- service registered under implementation class but consumer expects interface.

Aksi:

- inspect service object class/interface,
- inspect service properties,
- inspect consumer reference target filter,
- inspect bundle wiring for API package,
- inspect component logs.

---

## 21. Common runtime diagrams

### 21.1 Bundle state vs service state

```text
+-----------------------------+
| Bundle: com.example.payment |
| State: ACTIVE               |
+-----------------------------+
              |
              | contains DS component
              v
+-----------------------------+
| Component: PaymentProvider  |
| State: UNSATISFIED          |
| Missing config: payment.pid |
+-----------------------------+
              |
              | therefore
              v
+-----------------------------+
| Service: PaymentGateway     |
| State: NOT REGISTERED       |
+-----------------------------+
```

Lesson:

```text
ACTIVE bundle does not guarantee service existence.
```

### 21.2 Resolve vs service bind

```text
Build-time / resolve-time:

Bundle A imports com.example.payment.api [1.0,2)
Bundle B exports com.example.payment.api 1.3.0
Resolver wires A -> B for API package

Runtime service-time:

Bundle C registers PaymentGateway service
Bundle A binds PaymentGateway service
```

Package wiring and service binding are related but not identical.

### 21.3 Start level and DS dependency

```text
Framework Level 1: logging/config
Framework Level 2: datasource
Framework Level 3: domain services
Framework Level 4: HTTP endpoints

Within Level 3:
  CaseService component waits for RuleRepository service
  RuleRepository component waits for DataSource service

Start level handles phase.
DS handles dependency satisfaction.
```

---

## 22. Bundle lifecycle with fragments

Fragments are special. A fragment bundle attaches to a host bundle and contributes classes/resources to host class space. Fragment does not have independent lifecycle like normal bundle.

Important implications:

- fragment cannot be started like normal bundle,
- fragment attaches during resolve,
- host refresh may be needed for new fragment attachment,
- fragment state behavior differs from normal active bundles,
- fragment can change host class/resource space.

Example:

```text
Host bundle: com.example.platform.core
Fragment:    com.example.platform.core.resources.id_ID
```

Or native/platform-specific fragment:

```text
Host:     com.example.native.connector
Fragment: com.example.native.connector.linux.x86_64
```

Invariant:

> Not every installed artifact is an independently active runtime component. Fragment is attached capability, not running service provider by itself.

Fragments akan dibahas lebih dalam di Part 23.

---

## 23. Lazy activation

OSGi supports lazy activation policy. A bundle can be resolved and considered in `STARTING` until it is actually activated by class loading trigger.

Mental model:

```text
Bundle installed/resolved
Bundle marked for lazy activation
Bundle not fully activated yet
First relevant class access triggers activation
```

Lazy activation can improve startup time but complicates reasoning.

Risks:

- first request pays activation cost,
- activation error appears later,
- monitoring may think bundle is okay,
- classloading trigger is less obvious,
- startup testing may miss activation failure.

Use lazy activation only when:

- activation is truly optional,
- first-use delay is acceptable,
- errors are observable,
- readiness does not depend on lazy capability,
- behaviour is documented.

Do not use lazy activation to hide slow startup caused by bad design.

---

## 24. Update, refresh, and stale class spaces

OSGi allows runtime update, but update semantics are subtle.

Suppose:

```text
Bundle API v1 exports com.example.api 1.0.0
Bundle Consumer imports com.example.api [1.0,2)
Consumer is wired to API v1
```

Now API bundle updated to v1.1.0.

Question:

```text
Does Consumer instantly use v1.1.0 classes?
```

Not necessarily. Existing wiring can remain until refresh. This avoids breaking running code mid-flight, but creates two operational truths:

1. Installed bundle content may be new.
2. Active wiring may still reference old revision.

Therefore diagnostics must inspect not only bundle version, but wiring/revision state.

### 24.1 Refresh impact

Refresh can cause dependent bundles to stop/re-resolve/restart. That can be disruptive.

Operational plan should answer:

- Which bundles depend on updated bundle?
- Are there active service consumers?
- Can they tolerate provider disappearance?
- Is state persisted before refresh?
- Are requests drained?
- Can refresh be rolled back?
- Are classloader leaks tested?

### 24.2 Immutable vs mutable production

For many enterprise systems, safer model:

```text
Build full OSGi distribution image
Validate resolver graph in CI
Deploy immutable runtime
Restart process/pod for rollout
Use blue-green/canary
```

Mutable hot update is useful for plugin systems, but must be governed.

---

## 25. OSGi runtime in Java 8 sampai Java 25

Part 20 akan membahas detail compatibility. Di Part 1, cukup pahami bahwa framework layer tetap punya model yang sama, tetapi JVM environment berubah besar dari Java 8 ke Java 25.

Perubahan besar yang memengaruhi runtime OSGi:

| Area | Dampak |
|---|---|
| Java 9 JPMS | strong encapsulation, module path/classpath interaction |
| Java EE module removal | JAXB/JAX-WS/Activation tidak lagi built-in setelah Java 8 era |
| Stronger reflective access | library lama bisa gagal tanpa `--add-opens` |
| Security Manager deprecation/removal direction | OSGi security sandbox assumptions berubah |
| Classloader/runtime internals | library bytecode/proxy lama perlu upgrade |
| Multi-release JAR | perlu dipahami terhadap bundle metadata/classpath |
| Virtual threads | lifecycle thread management perlu disiplin baru |
| Modern GC/runtime | startup/memory behavior berubah |

Invariant:

> OSGi architecture tetap berbasis bundle/module/lifecycle/service, tetapi compatibility engineering harus memperhitungkan JDK runtime behaviour.

---

## 26. OSGi architecture dibanding runtime Java lain

### 26.1 Classpath application

```text
One process
One large classpath
One application lifecycle
No runtime module lifecycle
No package-level version wiring
```

Cocok untuk simple service.

### 26.2 Spring Boot

```text
One executable application
ApplicationContext manages beans
Dependency injection mostly static after startup
Classpath usually flat
Conditional beans possible
No standard runtime bundle update model
```

Cocok untuk microservice/product service modern.

### 26.3 Jakarta EE application server

```text
Server manages applications
WAR/EAR deployment model
Container services
Classloading isolation per app/module depending server
Lifecycle at app deployment level
```

Cocok untuk enterprise server model.

### 26.4 JPMS

```text
Static module graph at launch/layer creation
Strong module boundaries
No built-in dynamic service registry lifecycle like OSGi
No bundle install/update/uninstall runtime model as OSGi
```

Cocok untuk strong static modularity.

### 26.5 OSGi

```text
Dynamic runtime modules
Per-bundle lifecycle
Package-level import/export
Dynamic service registry
Runtime install/update/uninstall
Resolver and wiring model
```

Cocok untuk extensible platforms, plugin systems, modular runtimes, long-lived systems requiring controlled evolution.

---

## 27. Design exercise: membaca runtime sebagai state machine

Bayangkan sistem regulatory case management berbasis OSGi:

Bundles:

```text
com.acme.platform.api
com.acme.platform.config
com.acme.case.api
com.acme.case.core
com.acme.case.persistence
com.acme.case.web
com.acme.rules.api
com.acme.rules.engine
com.acme.rules.plugin.licensing
com.acme.notification.api
com.acme.notification.email
com.acme.audit.api
com.acme.audit.persistence
```

Scenario:

```text
Case web endpoint returns 503.
```

Jangan langsung debug controller. Baca state machine:

```text
1. Is framework started?
2. Is com.acme.case.web ACTIVE?
3. Is HTTP Whiteboard service available?
4. Is CaseCommandService registered?
5. Is com.acme.case.core ACTIVE?
6. Are DS components in case.core satisfied?
7. Is CaseRepository service registered?
8. Is DataSource service registered?
9. Is rules engine service registered?
10. Is mandatory rule plugin available?
11. Is audit service registered?
12. Are configs valid?
13. Are external systems healthy?
```

Possible root causes:

```text
A. case.web ACTIVE but CaseCommandService missing.
B. case.core ACTIVE but component unsatisfied because RuleEvaluator missing.
C. rules.plugin.licensing INSTALLED but not RESOLVED because rules.api version mismatch.
D. audit.persistence ACTIVE but DataSource unavailable.
E. HTTP Whiteboard context not registered.
F. Config PID typo prevents component activation.
```

OSGi forces you to debug with dependency state precision.

---

## 28. Production architecture implication

OSGi production runtime should expose diagnostics at least for:

- framework version,
- Java version,
- framework state,
- framework start level,
- bundle list,
- bundle states,
- unresolved bundles,
- bundle wiring,
- exported/imported packages,
- service registry,
- DS component state,
- configuration PIDs,
- feature/provisioning state,
- health/readiness state,
- recent framework/bundle/service events,
- classloader leak indicators,
- update/refresh history.

Without diagnostics, OSGi becomes opaque. With diagnostics, OSGi becomes one of the most inspectable runtime models in Java.

### 28.1 Minimal operational command concepts

Different runtimes have different shell commands, but conceptually you need ability to:

```text
list bundles
show bundle detail
start/stop bundle
inspect headers
inspect packages/wiring
list services
inspect service references
inspect DS components
inspect config
inspect start levels
refresh packages
view logs/events
```

Felix, Equinox, and Karaf provide different tooling around these ideas. Do not memorize commands first; memorize the diagnostic model.

---

## 29. Architecture checklist for Part 1

Sebelum membuat OSGi system, jawab:

### 29.1 Framework/lifecycle

- Runtime menggunakan Felix, Equinox, Karaf, atau custom embedded framework?
- Apakah runtime immutable atau mutable?
- Apakah framework cache ephemeral atau persistent?
- Bagaimana clean start diuji?
- Bagaimana warm restart diuji?
- Bagaimana shutdown dilakukan?

### 29.2 Bundle design

- Apa bundle yang benar-benar lifecycle-independent?
- Apa bundle API?
- Apa bundle implementation?
- Apa bundle plugin?
- Apa bundle infrastructure?
- Apa bundle web/API exposure?
- Apa bundle fragment?

### 29.3 Startup

- Apa start level policy?
- Apa yang harus tersedia sebelum traffic dibuka?
- Apa yang boleh lazy?
- Apa yang harus fail fast?
- Apa yang boleh degraded?

### 29.4 Service dynamics

- Service mana mandatory?
- Service mana optional?
- Service mana multiple?
- Service mana dynamic replaceable?
- Apa behaviour saat provider hilang?
- Apa behaviour saat provider baru muncul?

### 29.5 Operations

- Bagaimana melihat unresolved bundles?
- Bagaimana melihat unsatisfied components?
- Bagaimana melihat missing services?
- Bagaimana melihat config invalid?
- Bagaimana melakukan update?
- Bagaimana melakukan rollback?
- Bagaimana menghindari stale classloader?

---

## 30. Ringkasan mental model Part 1

OSGi Core Architecture dapat diringkas seperti ini:

```text
Security Layer protects operations.
Module Layer defines class/package visibility.
Life Cycle Layer manages bundle state.
Service Layer enables dynamic collaboration.
Application bundles implement actual capabilities.
```

Bundle lifecycle:

```text
INSTALLED = artifact known, dependencies not necessarily valid
RESOLVED  = static modular dependencies wired
STARTING  = start operation in progress
ACTIVE    = lifecycle start completed
STOPPING  = stop operation in progress
UNINSTALLED = removed from framework
```

Tiga pemisahan paling penting:

```text
installed != resolved
resolved  != started
started   != ready
```

Dynamic runtime invariant:

```text
A service that exists now may disappear later.
A bundle that is active now may be stopped later.
A wiring that is valid now may change after refresh.
A config that is valid now may be modified later.
```

Top-tier OSGi engineering berarti kamu mendesain dengan state transition, bukan hanya happy path startup.

---

## 31. Preview Part 2

Part berikutnya akan masuk ke **Bundle Anatomy**:

- struktur JAR OSGi,
- manifest sebagai runtime contract,
- header penting,
- directive vs attribute,
- `Bundle-SymbolicName`, `Bundle-Version`, `Import-Package`, `Export-Package`, `Private-Package`, `Require-Capability`, `Provide-Capability`, `Service-Component`, dan lainnya,
- kenapa manifest generated by tool lebih sehat daripada ditulis manual,
- bagaimana metadata bundle menjadi dokumentasi arsitektur yang executable.

Part 1 selesai. Series belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 0 — OSGi Mental Model: Dynamic Module System, Not Just Plugin Framework](./00-osgi-mental-model-dynamic-module-system-not-just-plugin-framework.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — Bundle Anatomy: Manifest, Headers, Metadata, and Build-Time Contracts](./02-bundle-anatomy-manifest-headers-metadata-build-time-contracts.md)

</div>