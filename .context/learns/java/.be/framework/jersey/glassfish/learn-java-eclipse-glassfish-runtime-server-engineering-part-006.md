# learn-java-eclipse-glassfish-runtime-server-engineering-part-006

# Part 6 — Bootstrap Lifecycle: Dari JVM Start sampai Aplikasi Ready

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Bagian: 6 dari 34/35 rencana utama  
> Fokus: memahami jalur startup GlassFish dari proses JVM, pembacaan domain configuration, aktivasi service internal, inisialisasi container, deployment application, sampai aplikasi siap menerima traffic produksi.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas beberapa control surface GlassFish:

- Admin Console.
- `asadmin`.
- REST Admin API.
- `domain.xml`.
- configuration-as-code.

Part ini masuk ke pertanyaan yang lebih dalam:

> Ketika kita menjalankan `asadmin start-domain`, sebenarnya apa yang terjadi sampai aplikasi kita bisa menerima request?

Banyak engineer hanya melihat startup sebagai operasi sederhana:

```bash
asadmin start-domain domain1
```

Lalu menunggu log:

```text
Successfully started the domain : domain1
```

Namun engineer yang benar-benar menguasai runtime melihat startup sebagai **pipeline deterministik** yang memiliki fase, dependency, failure point, dan observability point.

Di produksi, pemahaman ini sangat penting untuk menjawab pertanyaan seperti:

- Mengapa domain berhasil start tetapi aplikasi belum ready?
- Mengapa port sudah listening tetapi endpoint masih error?
- Mengapa deployment gagal hanya di UAT, bukan DEV?
- Mengapa restart server lama setelah upgrade Java?
- Mengapa perubahan JDBC resource tidak terbaca?
- Mengapa satu aplikasi gagal deploy tetapi server tetap hidup?
- Mengapa startup stuck di class scanning, CDI validation, atau JPA initialization?
- Mengapa admin console bisa diakses, tetapi aplikasi belum bisa diakses?
- Mengapa liveness sukses tetapi readiness seharusnya gagal?

Target part ini adalah membentuk **mental model boot lifecycle** yang bisa dipakai untuk troubleshooting, desain deployment, readiness check, dan operasi production-grade.

Referensi resmi yang relevan untuk part ini: GlassFish menyediakan Quick Start Guide, Administration Guide, Application Deployment Guide, Reference Manual, dan Release Notes untuk release 8. Dokumentasi resmi menjelaskan bahwa `start-domain` memulai Domain Administration Server, aplikasi dapat dideploy dengan `asadmin deploy`, dan Application Deployment Guide menjelaskan proses dan tooling deployment di lingkungan GlassFish. Sumber resmi tersebut menjadi anchor konseptual untuk materi ini.

---

## 1. Core Mental Model: Startup GlassFish Adalah Pipeline, Bukan Event Tunggal

Startup bukan satu langkah. Startup adalah rangkaian fase:

```text
[Shell/asadmin]
      |
      v
[JVM Process Creation]
      |
      v
[GlassFish Launcher]
      |
      v
[Domain Configuration Load]
      |
      v
[Internal Runtime Bootstrap]
      |
      v
[Admin Service Startup]
      |
      v
[Network Listener Startup]
      |
      v
[Container Services Startup]
      |
      v
[Resource Services Startup]
      |
      v
[Application Deployment / Reload]
      |
      v
[Post-deployment Initialization]
      |
      v
[Operational Ready]
```

Poin penting:

> `process alive` ≠ `server usable` ≠ `application deployed` ≠ `business-ready`.

Ada beberapa level “hidup”:

| Level | Makna | Contoh |
|---|---|---|
| Process alive | JVM berjalan | PID GlassFish ada |
| Admin alive | DAS/admin listener bisa menerima command | `asadmin list-applications` berhasil |
| Network alive | HTTP listener binding ke port | port 8080 listening |
| Container alive | web/EJB/JPA/JMS services aktif | container siap memuat aplikasi |
| App deployed | artifact berhasil diproses | WAR/EAR muncul di deployment list |
| App initialized | app startup listener/CDI/JPA selesai | endpoint tidak gagal karena init error |
| Business-ready | dependency eksternal siap | DB, broker, cache, downstream service tersedia |

Kesalahan umum adalah menganggap satu sinyal mewakili semuanya.

Contoh anti-pattern:

```text
Port 8080 listening -> app ready
```

Ini salah. Port bisa listening sebelum aplikasi tertentu selesai deploy, atau aplikasi bisa deploy tetapi gagal koneksi ke database saat request pertama.

---

## 2. Apa yang Dipanggil oleh `asadmin start-domain`?

Secara operasional, command umum adalah:

```bash
asadmin start-domain domain1
```

Jika nama domain tidak diberikan dan hanya ada satu domain default, GlassFish dapat memakai domain default. Namun dalam environment serius, selalu eksplisitkan nama domain:

```bash
asadmin start-domain production-domain
```

Mental model:

```text
asadmin start-domain
  -> temukan domain directory
  -> baca domain metadata/config minimal
  -> susun command line JVM
  -> launch JVM process GlassFish
  -> tunggu startup signal/status
  -> return exit code ke shell
```

`asadmin start-domain` bukan “server” itu sendiri. Ia adalah command-line utility yang meluncurkan proses server.

Perbedaannya:

```text
asadmin process:
  short-lived command process

GlassFish server process:
  long-running JVM process
```

Implikasi penting:

- Kalau `asadmin` selesai, bukan berarti semua aplikasi business-ready.
- Kalau `asadmin` gagal, server process bisa saja tidak pernah terbentuk, atau terbentuk lalu mati.
- Untuk troubleshooting, lihat `server.log`, bukan hanya output terminal.
- Di automation, exit code penting tetapi tidak cukup untuk readiness bisnis.

---

## 3. Input Bootstrap: Apa Saja yang Dibutuhkan Saat Startup?

Startup GlassFish membutuhkan beberapa input utama:

```text
+---------------------------+
| GlassFish Installation    |
| as-install / modules/lib  |
+-------------+-------------+
              |
              v
+---------------------------+
| Domain Directory          |
| domains/<domain-name>     |
+-------------+-------------+
              |
              v
+---------------------------+
| domain.xml + config files |
+-------------+-------------+
              |
              v
+---------------------------+
| JVM / JDK                 |
+-------------+-------------+
              |
              v
+---------------------------+
| OS resources              |
| ports/files/memory/users  |
+---------------------------+
```

### 3.1 GlassFish Installation

Installation home berisi binary, modules, library, script, dan runtime implementation.

Contoh area:

```text
glassfish8/
  glassfish/
    bin/
    lib/
    modules/
    domains/
```

Installation home sebaiknya diperlakukan sebagai relatif immutable.

Prinsip production:

```text
GlassFish home = product/runtime bits
Domain dir     = environment/runtime state
Application    = deployable artifact
```

Jangan campur semua menjadi satu mutable folder tanpa disiplin.

### 3.2 Domain Directory

Domain directory adalah state utama runtime:

```text
domains/domain1/
  config/
    domain.xml
    keystore.p12 / cacerts.p12 / keyfile / login.conf / etc.
  logs/
    server.log
  applications/
  generated/
  lib/
  docroot/
```

Domain menyimpan:

- konfigurasi listener;
- konfigurasi thread pool;
- resource JDBC/JMS/JCA;
- deployment metadata;
- security realm;
- keystore/truststore;
- generated artifacts;
- log runtime.

Karena domain adalah stateful, restore/backup domain sangat penting.

### 3.3 JDK yang Digunakan

JDK menentukan:

- bytecode compatibility;
- GC behavior;
- TLS behavior;
- reflection/module access behavior;
- default encoding/timezone behavior;
- removed/deprecated Java EE related APIs;
- startup performance;
- memory behavior.

Untuk Java 8 sampai 25, startup behavior bisa berubah signifikan karena:

- Java 9 module system;
- Java 11 removal of Java EE/CORBA modules dari JDK;
- Java 17 stronger encapsulation;
- Java 21 virtual threads, generational ZGC, modern TLS defaults;
- Java 25 compatibility considerations untuk latest GlassFish line.

Top 1% rule:

> Jangan debug GlassFish startup tanpa tahu JDK mana yang benar-benar menjalankan domain.

Cek:

```bash
asadmin version --verbose
```

atau lihat command line process:

```bash
ps -ef | grep glassfish
```

atau di Windows:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*glassfish*' } | Select-Object ProcessId, CommandLine
```

### 3.4 OS Resource

Startup juga bergantung pada OS:

- port available;
- file permission;
- disk space;
- file descriptor limit;
- process limit;
- DNS resolver;
- hostname resolution;
- entropy source;
- memory limit;
- container cgroup limit;
- time sync;
- locale/encoding.

Banyak startup problem bukan bug GlassFish, tetapi resource OS.

---

## 4. Bootstrap Sequence Level 1: Process Creation

Ketika domain start, langkah paling bawah adalah membuat proses JVM.

Secara kasar:

```text
asadmin
  -> determine domain
  -> determine Java executable
  -> construct JVM options
  -> construct classpath/module path
  -> start JVM
```

JVM options dapat berasal dari:

- default GlassFish config;
- `domain.xml` JVM options;
- environment variable;
- startup script;
- custom admin config.

Contoh JVM options yang bisa muncul:

```text
-Xmx2048m
-XX:+UseG1GC
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-Dcom.sun.enterprise.security.httpsOutboundKeyAlias=...
```

### Failure Point: Java Tidak Cocok

Contoh:

```text
UnsupportedClassVersionError
```

Makna:

- class dikompilasi dengan versi Java lebih baru daripada JVM runtime;
- atau server membutuhkan Java minimum tertentu tetapi dijalankan dengan JDK lama.

Contoh scenario:

```text
GlassFish 8 requires modern Java baseline.
Domain dijalankan dengan Java 17/11/8.
Startup gagal sangat awal.
```

### Failure Point: JVM Option Tidak Valid

Contoh:

```text
Unrecognized VM option 'UseConcMarkSweepGC'
```

Pada Java modern, beberapa option lama sudah dihapus.

Contoh migrasi:

```text
Java 8:
  -XX:+UseConcMarkSweepGC

Java 17/21:
  invalid / removed
```

Prinsip:

> Upgrade Java harus selalu menyertakan review JVM options.

### Failure Point: Heap Terlalu Besar untuk Host/Container

Contoh:

```text
Could not reserve enough space for object heap
```

Atau proses mati karena OOM killer di container.

Root cause umum:

- `-Xmx` lebih besar dari memory limit;
- metaspace/direct/thread stack tidak dihitung;
- container limit tidak sesuai;
- terlalu banyak worker threads.

---

## 5. Bootstrap Sequence Level 2: Domain Configuration Load

Setelah JVM hidup, GlassFish perlu membaca domain configuration.

File utama:

```text
domains/<domain>/config/domain.xml
```

`domain.xml` bukan sekadar file XML pasif. Ia adalah persistent representation dari model konfigurasi domain.

Di dalamnya ada informasi seperti:

- server config;
- admin service;
- network listeners;
- thread pools;
- resources;
- applications;
- security service;
- transaction service;
- monitoring service;
- JVM options;
- clusters/instances/config references.

Mental model:

```text
domain.xml
  -> parsed into config model
  -> services consume config fragments
  -> runtime objects created
```

### 5.1 Config Load Harus Berhasil Sebelum Server Bisa Benar-Benar Start

Jika `domain.xml` rusak:

```text
malformed XML
missing required element
invalid attribute value
inconsistent reference
```

server bisa gagal start sebelum listener HTTP aktif.

### 5.2 Mengapa Manual Edit `domain.xml` Berbahaya?

Manual edit bisa membuat:

- XML well-formed tapi semantic invalid;
- reference ke resource yang tidak ada;
- duplicate name;
- port conflict;
- config tidak sesuai command model;
- value tidak tervalidasi seperti saat memakai `asadmin`.

Prinsip:

```text
Prefer asadmin / admin model.
Manual domain.xml edit hanya untuk emergency/recovery dengan backup.
```

### 5.3 Domain Config Load vs Application Load

Server bisa gagal pada dua level berbeda:

```text
Level A: domain config invalid
  -> server gagal start

Level B: domain config valid, application invalid
  -> server start, app gagal deploy
```

Ini penting saat membaca log.

---

## 6. Bootstrap Sequence Level 3: Internal Runtime Bootstrap

Setelah config dibaca, GlassFish menginisialisasi internal runtime services.

Secara konseptual:

```text
+--------------------+
| Core Runtime       |
+---------+----------+
          |
          v
+--------------------+
| Service Registry   |
| HK2 / internal DI  |
+---------+----------+
          |
          v
+--------------------+
| Config Services    |
+---------+----------+
          |
          v
+--------------------+
| Admin Services     |
+---------+----------+
          |
          v
+--------------------+
| Container Services |
+--------------------+
```

GlassFish menggunakan HK2 sebagai internal service locator/DI infrastructure. Kita tidak perlu langsung menghafal semua internal class, tetapi perlu memahami bahwa server terdiri dari banyak service yang saling bergantung.

Contoh service internal:

- admin service;
- config service;
- logging service;
- monitoring service;
- security service;
- transaction service;
- naming service;
- web container;
- EJB container;
- connector container;
- deployment service;
- lifecycle module service.

Mental model:

> GlassFish startup adalah aktivasi graph service, bukan eksekusi script linear sederhana.

Implikasi:

- satu service gagal bisa menggagalkan dependent service;
- urutan startup matters;
- beberapa service lazy-init, beberapa eager-init;
- aplikasi bisa trigger initialization service tertentu saat deployment.

---

## 7. Bootstrap Sequence Level 4: Logging Service

Salah satu service paling awal yang harus tersedia adalah logging.

Log utama:

```text
domains/<domain>/logs/server.log
```

Untuk setiap startup, `server.log` adalah sumber kebenaran pertama.

### 7.1 Cara Membaca Startup Log

Jangan baca log dari bawah saja. Baca sebagai timeline:

```text
[time 1] JVM/server starts
[time 2] config loaded
[time 3] services initialize
[time 4] listeners bind
[time 5] deployment begins
[time 6] app-specific init
[time 7] startup complete or failure
```

Cari marker seperti:

- version info;
- Java version;
- domain name;
- port binding;
- deployed application;
- severe/error stack trace;
- exception root cause;
- “Caused by” terdalam;
- repeated warning.

### 7.2 Warning Tidak Selalu Aman

Startup warning sering diabaikan. Namun warning dapat menunjukkan:

- deprecated config;
- invalid classpath;
- missing optional dependency;
- insecure TLS;
- failed monitoring registration;
- slow resource validation;
- non-critical app component failure.

Prinsip:

> Pada production baseline, known warning harus diklasifikasi. Warning yang tidak dikenal bukan noise.

---

## 8. Bootstrap Sequence Level 5: Admin Service Startup

Admin service memungkinkan `asadmin` remote command, Admin Console, dan REST Admin API.

Komponen penting:

- admin listener;
- admin port, biasanya 4848 untuk domain default;
- admin user/security;
- secure admin config;
- admin console loading.

Mental model:

```text
Admin service alive
  -> kita bisa inspect/control runtime
  -> belum berarti application listener/app ready
```

Contoh:

```bash
asadmin list-applications
asadmin list-jdbc-resources
asadmin get server.*
```

Kalau admin service tidak hidup, kemampuan recovery turun drastis.

### Failure Point: Admin Port Conflict

Contoh:

```text
Address already in use
```

Root cause:

- domain lain memakai port 4848;
- process lama belum mati;
- port mapping container bentrok;
- Windows behavior/port binding ambiguity;
- config cloning tanpa mengganti port.

Diagnose:

```bash
lsof -i :4848
netstat -tulpn | grep 4848
```

Windows:

```powershell
netstat -ano | findstr :4848
Get-Process -Id <pid>
```

---

## 9. Bootstrap Sequence Level 6: Network Listener Startup

GlassFish memiliki network listener untuk menerima koneksi.

Biasanya:

```text
admin-listener : 4848
http-listener-1: 8080
http-listener-2: 8181 HTTPS
```

Namun di produksi, port bisa berbeda.

Struktur konseptual:

```text
Network Listener
  -> Protocol
  -> Transport
  -> Thread Pool
  -> Virtual Server
  -> Web Container
```

Listener startup berarti GlassFish berhasil bind ke port tertentu.

Tetapi:

```text
listener started ≠ app endpoint ready
```

### 9.1 Port Binding Failure

Penyebab umum:

- port dipakai process lain;
- privilege issue untuk low port;
- wrong bind address;
- IPv4/IPv6 mismatch;
- container port tidak expose;
- OS firewall/security group;
- config duplikat.

### 9.2 Listener Ada, Tapi Request 404

Kemungkinan:

- app belum deploy;
- context root berbeda;
- deploy target salah;
- virtual server mismatch;
- reverse proxy path rewrite salah;
- app disabled;
- deployment failed tetapi server tetap hidup.

### 9.3 Listener Ada, Tapi Request 503/504 dari Proxy

Kemungkinan:

- proxy health check path salah;
- app startup lambat;
- thread pool habis;
- backend connection timeout;
- TLS mismatch;
- app stuck initialization;
- request diarahkan sebelum ready.

---

## 10. Bootstrap Sequence Level 7: Container Services Startup

GlassFish adalah full Jakarta EE runtime. Banyak container/service diaktifkan.

Contoh container:

```text
Web Container
EJB Container
CDI Container
JPA Provider Integration
Transaction Service
Connector Container
JMS Service
Security Service
Naming/JNDI Service
```

Tidak semua container sama-sama aktif berat. Banyak behavior dipicu oleh aplikasi yang dideploy.

Contoh:

- WAR sederhana mungkin mainly memakai web container.
- App dengan JPA memicu persistence unit processing.
- App dengan EJB memicu EJB container metadata processing.
- App dengan MDB memicu JMS/JCA integration.
- App dengan CDI memicu bean discovery/validation.

### 10.1 Web Container

Web container menyiapkan:

- servlet context;
- filters;
- listeners;
- session manager;
- web fragments;
- annotation scanning;
- JSP engine;
- security constraints.

Failure point:

- invalid `web.xml`;
- duplicate servlet mapping;
- listener startup exception;
- missing class in `WEB-INF/lib`;
- incompatible library;
- invalid security role mapping.

### 10.2 CDI Container

CDI startup bisa melibatkan:

- bean discovery;
- injection point validation;
- interceptor/decorator processing;
- producer validation;
- observer method registration;
- extension execution.

Failure point:

- ambiguous dependency;
- unsatisfied dependency;
- proxyability issue;
- circular initialization;
- extension incompatible dengan Jakarta version.

### 10.3 JPA Provider Integration

JPA initialization bisa melibatkan:

- parsing `persistence.xml`;
- datasource lookup;
- entity scanning;
- metadata validation;
- weaving/enhancement;
- schema validation/generation jika dikonfigurasi;
- connection acquisition tergantung provider/config.

Failure point:

- JNDI datasource tidak ditemukan;
- driver missing;
- DB unreachable;
- wrong dialect/platform;
- entity mapping invalid;
- namespace mismatch `javax.persistence` vs `jakarta.persistence`;
- schema validation fail.

### 10.4 EJB Container

EJB startup bisa melibatkan:

- session bean metadata;
- transaction attributes;
- security roles;
- interceptors;
- timer service;
- remote interface;
- pool/cache config.

Failure point:

- invalid remote interface;
- serialization issue;
- timer recovery failure;
- injection issue;
- transaction/resource mismatch.

### 10.5 Connector/JMS Container

Connector and JMS startup bisa melibatkan:

- JMS service;
- embedded/remote broker;
- connection factory;
- destination;
- resource adapter;
- MDB endpoint activation.

Failure point:

- broker unavailable;
- destination missing;
- resource adapter invalid;
- MDB activation failure;
- transaction support mismatch.

---

## 11. Bootstrap Sequence Level 8: Resource Services Startup

Resources adalah jembatan antara aplikasi dan dependency eksternal.

Contoh resources:

- JDBC connection pool;
- JDBC resource;
- JMS connection factory;
- JMS destination;
- connector resource;
- custom resource;
- mail resource;
- managed executor service;
- security realm;
- thread pool.

### 11.1 Resource Definition vs Resource Usability

Penting membedakan:

```text
Resource exists in config
  ≠ resource can connect to external dependency
```

Contoh:

```text
jdbc/MyDS exists
  tetapi database down
```

Aplikasi bisa:

- gagal deploy jika resource divalidasi saat startup;
- berhasil deploy tetapi gagal request pertama;
- lambat startup karena mencoba koneksi;
- stuck karena timeout eksternal terlalu panjang.

### 11.2 JDBC Pool Bootstrap

JDBC pool bisa punya behavior berbeda tergantung konfigurasi:

- initial pool size;
- validation setting;
- fail-all-connections;
- datasource class;
- driver location;
- connection creation timeout;
- DB availability.

Jika initial pool size > 0 dan DB lambat/down, startup bisa terpengaruh.

### 11.3 Naming/JNDI Binding

Resource harus dibind ke JNDI supaya aplikasi bisa lookup/inject.

Failure point:

```text
javax.naming.NameNotFoundException
jakarta.naming.NameNotFoundException
```

Kemungkinan:

- resource belum dibuat;
- resource dibuat di target salah;
- JNDI name berbeda;
- descriptor mapping salah;
- app deployed ke cluster/instance yang tidak punya resource target.

---

## 12. Bootstrap Sequence Level 9: Application Deployment / Reload

Setelah runtime siap, GlassFish memproses aplikasi yang dideploy.

Deployment dapat terjadi lewat:

- explicit `asadmin deploy`;
- existing deployed app saat server restart;
- autodeploy di development mode;
- admin console;
- REST admin API;
- deployment metadata di domain config.

Application Deployment Guide resmi GlassFish menjelaskan tooling dan proses deployment aplikasi/module pada lingkungan GlassFish.

### 12.1 Deployment Bukan Sekadar Copy File

Deployment melibatkan:

```text
artifact accepted
  -> archive inspection
  -> descriptor parsing
  -> annotation scanning
  -> classloading setup
  -> module type detection
  -> dependency resolution
  -> container-specific processing
  -> resource reference resolution
  -> generated artifacts
  -> lifecycle callbacks
  -> application enablement
```

### 12.2 Deployment Artifact Types

GlassFish dapat memproses beberapa jenis artifact:

- WAR;
- EAR;
- EJB-JAR;
- RAR;
- application client;
- exploded directory.

Masing-masing punya bootstrap behavior berbeda.

### 12.3 WAR Deployment Lifecycle

WAR deployment secara konseptual:

```text
WAR archive
  -> web.xml/web-fragment parsing
  -> annotation scan
  -> classloader creation
  -> servlet/filter/listener registration
  -> CDI integration if beans.xml/discovery active
  -> security constraints
  -> JSP setup/precompile if configured
  -> ServletContextListener execution
  -> context root activation
```

Failure paling umum:

- listener throw exception;
- duplicate servlet/filter mapping;
- incompatible library;
- class not found;
- CDI validation failure;
- context root collision;
- wrong Jakarta namespace.

### 12.4 EAR Deployment Lifecycle

EAR lebih kompleks:

```text
EAR
  -> application.xml parsing
  -> EAR lib classloader
  -> module ordering
  -> WAR/EJB/JAR processing
  -> shared resources/references
  -> cross-module injection/reference
  -> application-level lifecycle
```

Failure umum:

- classloader ambiguity;
- module dependency order issue;
- duplicate classes;
- EJB reference not found;
- shared library conflict;
- deployment descriptor mismatch.

### 12.5 RAR Deployment Lifecycle

Resource adapter deployment melibatkan connector container:

```text
RAR
  -> ra.xml parsing
  -> managed connection factory
  -> admin object config
  -> work manager integration
  -> transaction/security contract
  -> endpoint activation if inbound
```

Failure umum:

- incompatible resource adapter;
- invalid transaction support;
- missing admin object;
- classloader conflict;
- endpoint activation failure.

---

## 13. Application Startup Code: Titik Paling Sering Membuat “Server Start Tapi App Tidak Ready”

Banyak aplikasi menjalankan kode saat startup.

Contoh:

- `ServletContextListener.contextInitialized`;
- CDI observer startup event;
- `@PostConstruct` bean;
- EJB singleton `@Startup`;
- scheduled/timer initialization;
- JPA schema validation;
- cache warmup;
- remote config loading;
- DB migration trigger;
- external API token fetch;
- message consumer activation.

Ini sering menyebabkan masalah:

```text
GlassFish server ready
  tetapi aplikasi gagal init karena startup code throw exception
```

### 13.1 Anti-pattern: Startup Terlalu Banyak Melakukan External Call

Contoh buruk:

```text
At app startup:
  - call DB
  - call Redis
  - call 5 downstream APIs
  - fetch token
  - warm up all caches
  - validate every remote endpoint
```

Akibat:

- startup lambat;
- deploy gagal karena dependency sementara down;
- rolling deployment berisiko;
- restart incident makin lama;
- readiness sulit dibedakan.

### 13.2 Prinsip Desain Startup Code

Startup code sebaiknya:

- cepat;
- deterministik;
- gagal dengan pesan jelas;
- tidak menggantung tanpa timeout;
- tidak melakukan operasi irreversible;
- tidak menjalankan long-running job di thread startup;
- membedakan required dependency vs optional dependency;
- mendukung readiness check.

Rule:

> Startup boleh memvalidasi kontrak kritis, tetapi jangan ubah startup menjadi distributed dependency ceremony yang rapuh.

---

## 14. Ready vs Healthy: Kenapa Startup Signal Harus Bertingkat

Dalam sistem modern, terutama container/Kubernetes, ada beberapa probe:

- startup probe;
- liveness probe;
- readiness probe.

GlassFish tradisional tidak otomatis tahu business readiness aplikasi Anda. Anda harus mendesainnya.

### 14.1 Liveness

Pertanyaan:

```text
Apakah process masih hidup dan tidak perlu direstart?
```

Contoh:

```text
GET /health/live
```

Liveness tidak harus cek database.

Kalau liveness terlalu agresif cek dependency eksternal, aplikasi bisa restart loop hanya karena DB lambat.

### 14.2 Readiness

Pertanyaan:

```text
Apakah instance ini boleh menerima traffic?
```

Readiness bisa cek:

- app initialized;
- DB pool usable;
- required cache available;
- migration completed;
- mandatory config loaded;
- message consumer ready jika workload-nya messaging.

### 14.3 Startup Probe

Pertanyaan:

```text
Apakah aplikasi masih dalam fase startup normal?
```

Berguna untuk aplikasi yang butuh waktu startup lama, supaya liveness tidak membunuh proses terlalu cepat.

### 14.4 Mapping ke GlassFish

```text
GlassFish process alive        -> weak liveness
Admin command works            -> admin liveness
HTTP listener responds         -> network liveness
App health endpoint responds   -> app liveness/readiness
Business dependency check pass -> business readiness
```

Top-level engineer tidak menyamakan semuanya.

---

## 15. Startup Failure Taxonomy

Untuk troubleshooting cepat, klasifikasikan failure berdasarkan fase.

```text
A. JVM/process failure
B. Domain config failure
C. Internal service failure
D. Port/listener failure
E. Resource failure
F. Deployment failure
G. Application initialization failure
H. Business readiness failure
```

### 15.1 A — JVM/Process Failure

Gejala:

- process tidak muncul;
- `asadmin start-domain` gagal cepat;
- tidak ada log lengkap;
- error Java option;
- unsupported class version.

Cek:

```bash
java -version
asadmin version --verbose
cat domains/<domain>/logs/server.log
```

### 15.2 B — Domain Config Failure

Gejala:

- server gagal sebelum listener aktif;
- XML/config error;
- perubahan terakhir di `domain.xml`.

Cek:

- backup config terakhir;
- recent `asadmin set`;
- manual edit;
- duplicate ports;
- invalid reference.

### 15.3 C — Internal Service Failure

Gejala:

- server mulai bootstrap tapi service tertentu gagal;
- stack trace internal GlassFish;
- dependency module issue.

Cek:

- version mismatch;
- missing module;
- corrupted installation;
- library ditaruh salah di server lib;
- incompatible Java version.

### 15.4 D — Port/Listener Failure

Gejala:

```text
Address already in use
Permission denied
Cannot assign requested address
```

Cek:

```bash
lsof -i :8080
lsof -i :4848
netstat -tulpn
```

### 15.5 E — Resource Failure

Gejala:

- JDBC pool error;
- JMS service error;
- JNDI name not found;
- realm cannot connect;
- external broker down.

Cek:

```bash
asadmin list-jdbc-connection-pools
asadmin list-jdbc-resources
asadmin ping-connection-pool <pool-name>
```

### 15.6 F — Deployment Failure

Gejala:

- server hidup;
- app tidak listed atau disabled;
- stack trace saat deploy;
- 404 context root.

Cek:

```bash
asadmin list-applications
asadmin list-components
asadmin deploy --force=true app.war
```

### 15.7 G — Application Initialization Failure

Gejala:

- artifact deploy started;
- app listener/CDI/JPA/EJB startup gagal;
- context tidak aktif.

Cek:

- `ServletContextListener`;
- `@PostConstruct`;
- CDI validation;
- JPA provider logs;
- EJB startup singleton;
- external calls saat startup.

### 15.8 H — Business Readiness Failure

Gejala:

- app deploy sukses;
- endpoint health dasar sukses;
- fitur bisnis gagal.

Cek:

- config bisnis;
- DB schema version;
- reference data;
- downstream credential;
- external token;
- message route;
- feature flags.

---

## 16. Startup Timeline: Cara Membuat Diagnosis Lebih Cepat

Saat incident, jangan langsung random mencoba restart berkali-kali. Buat timeline.

Template:

```text
T0  operator menjalankan start-domain
T1  JVM process created
T2  server.log mulai menulis version info
T3  admin listener started
T4  http listener started
T5  application deployment started
T6  CDI/JPA/EJB initialization started
T7  error muncul
T8  process exited / app disabled / server stayed up
```

Pertanyaan kunci:

1. Failure terjadi sebelum atau sesudah JVM hidup?
2. Failure terjadi sebelum atau sesudah domain config load?
3. Failure terjadi sebelum atau sesudah port bind?
4. Failure terjadi sebelum atau sesudah application deployment?
5. Failure terjadi pada server runtime atau application code?
6. Failure membutuhkan restart server atau cukup redeploy app?
7. Failure deterministic atau intermittent?
8. Failure hanya terjadi di environment tertentu?

---

## 17. Deployment on Startup: Mengapa Restart Bisa Mengubah Hasil

Saat server restart, aplikasi yang sudah dideploy dapat diproses ulang.

Efeknya:

- dependency yang sebelumnya loaded bisa dimuat ulang;
- generated artifacts bisa direkonstruksi;
- stale state bisa hilang;
- atau justru error baru muncul karena startup path berbeda dari hot deploy.

Contoh:

```text
Aplikasi berhasil hot deploy.
Server restart.
Aplikasi gagal deploy saat boot.
```

Kemungkinan:

- dependency tersedia hanya karena classloader lama;
- generated artifact stale;
- resource dibuat manual setelah deploy dan tidak persist benar;
- startup ordering berbeda;
- environment variable hanya ada di interactive shell, tidak di service manager;
- filesystem permission berubah.

Prinsip:

> Deployment dianggap valid hanya jika bisa survive clean restart.

Checklist:

```bash
asadmin stop-domain domain1
asadmin start-domain domain1
asadmin list-applications
curl /health/ready
```

---

## 18. Autodeploy vs Explicit Deploy

GlassFish mendukung mekanisme yang nyaman untuk development, tetapi production harus disiplin.

### 18.1 Autodeploy

Autodeploy biasanya berguna untuk lokal/dev:

```text
copy WAR ke autodeploy dir
server mendeteksi dan deploy
```

Kelebihan:

- cepat;
- mudah;
- cocok untuk eksperimen.

Kekurangan:

- kurang audit-friendly;
- timing bisa tidak deterministik;
- error handling kurang eksplisit;
- tidak ideal untuk CI/CD produksi;
- raw copy bisa terjadi sebelum file lengkap.

### 18.2 Explicit Deploy

Production sebaiknya memakai explicit command:

```bash
asadmin deploy --target server --contextroot myapp /artifacts/myapp.war
```

Kelebihan:

- command tercatat;
- exit code jelas;
- parameter eksplisit;
- mudah dimasukkan pipeline;
- bisa dibuat idempotent;
- cocok untuk rollback.

Rule:

```text
Autodeploy untuk developer convenience.
Explicit deploy untuk controlled environment.
```

---

## 19. Generated Artifacts: Folder yang Sering Dilupakan

GlassFish dapat membuat generated artifacts saat deployment.

Contoh area:

```text
domains/<domain>/generated/
```

Isinya dapat terkait:

- compiled JSP;
- generated stubs;
- deployment-generated metadata;
- enhanced classes;
- temporary deployment processing.

Masalah yang mungkin muncul:

- stale generated file;
- permission issue;
- disk penuh;
- generated artifact dari versi lama;
- redeploy tidak membersihkan semua state;
- cluster/instance state tidak konsisten.

Saat debugging aneh, terkadang clean redeploy atau membersihkan generated state di environment non-prod dapat membantu. Namun di production, jangan hapus sembarang tanpa runbook.

Prinsip:

> Generated state adalah cache/derived state, tetapi tetap bisa memengaruhi behavior runtime.

---

## 20. Startup dan Classloading: Kenapa Error Baru Muncul Saat Boot

Classloading sering terjadi bertahap.

Tidak semua class dimuat saat JVM start. Banyak class baru dimuat saat:

- deployment scanning;
- annotation processing;
- CDI validation;
- servlet initialization;
- first request;
- lazy singleton access;
- JPA entity manager factory creation;
- JMS consumer activation.

Karena itu, error seperti ini bisa muncul di fase berbeda:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
LinkageError
UnsupportedClassVersionError
```

### 20.1 Startup Classloading Error

Jika class diperlukan saat deployment, app gagal deploy.

Contoh:

```text
CDI bean references missing class
Servlet listener class missing
JPA entity references missing type
```

### 20.2 Runtime Classloading Error

Jika class hanya dipakai saat request tertentu, deployment bisa sukses tetapi request gagal.

Contoh:

```text
Optional integration library missing
Report generator class missing
Rare code path uses old method signature
```

Prinsip:

> Deployment success menurunkan risiko classpath, tetapi tidak membuktikan semua code path class-safe.

---

## 21. Startup dan Jakarta Namespace Migration

Untuk Java 8 sampai 25, salah satu risiko terbesar adalah transisi `javax.*` ke `jakarta.*`.

GlassFish 5 era Java EE 8 banyak memakai `javax.*`.
GlassFish 6+ bergerak ke Jakarta namespace.
GlassFish 8 berada di era Jakarta EE 11.

Startup/deployment failure bisa muncul karena:

- aplikasi dikompilasi dengan `javax.servlet.*`, server berharap `jakarta.servlet.*`;
- library lama membawa `javax.*` API jar;
- descriptor namespace lama;
- CDI/JPA/JAX-RS annotation tidak dikenali karena package berbeda;
- transitive dependency campur.

Contoh:

```text
App compiled for Java EE 8:
  javax.servlet.Filter

Runtime Jakarta EE 10/11:
  jakarta.servlet.Filter
```

Ini bukan sekadar rename kosmetik. Ini perubahan binary incompatible.

Diagnosis:

```bash
jar tf app.war | grep 'javax/'
jar tf app.war | grep 'jakarta/'
```

Atau cari source/dependency:

```bash
grep -R "import javax\." src/main/java
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

Rule:

> Jangan mengharapkan aplikasi Java EE 8 `javax.*` berjalan langsung di runtime Jakarta EE modern tanpa migration strategy.

---

## 22. Startup dan Java Version Migration

Selain namespace, Java version juga memengaruhi startup.

### 22.1 Java 8 ke Java 11+

Potensi masalah:

- JAXB/JAX-WS/JAF tidak lagi bundled di JDK;
- CORBA removed;
- TLS defaults berubah;
- illegal reflective access warning;
- dependency lama belum support Java 11.

### 22.2 Java 11 ke Java 17+

Potensi masalah:

- stronger encapsulation;
- reflective access lebih ketat;
- old bytecode instrumentation library bermasalah;
- GC option lama invalid;
- security provider behavior berubah.

### 22.3 Java 17 ke Java 21/25

Potensi masalah:

- library instrumentation lama;
- agent monitoring lama;
- JVM flags berubah;
- virtual thread expectation salah;
- runtime baseline GlassFish harus sesuai.

Checklist startup setelah upgrade Java:

```text
[ ] java -version sesuai
[ ] asadmin version --verbose sesuai
[ ] JVM options valid
[ ] GC logs aktif
[ ] app compile target sesuai
[ ] dependency tree bebas library kuno kritis
[ ] startup log bebas illegal/inaccessible reflection fatal
[ ] smoke test setelah clean restart
```

---

## 23. Startup Performance: Kenapa Server Lambat Naik?

Startup lambat bisa berasal dari banyak titik.

```text
Slow startup
  ├─ JVM warmup/class loading
  ├─ domain config complexity
  ├─ many deployed apps
  ├─ huge classpath
  ├─ annotation scanning
  ├─ CDI bean discovery
  ├─ JPA entity scanning/schema validation
  ├─ JSP compilation
  ├─ JDBC initial connections
  ├─ JMS/broker connection
  ├─ external API startup calls
  ├─ DNS delay
  ├─ entropy/TLS delay
  ├─ disk IO slow
  └─ container CPU throttling
```

### 23.1 Cara Mengukur Startup

Jangan hanya bilang “lama”. Pecah waktunya:

```text
T_start_command
T_first_log
T_admin_listener
T_http_listener
T_deployment_start
T_deployment_end
T_health_live
T_health_ready
```

Tambahkan timestamp di pipeline:

```bash
date -Iseconds
asadmin start-domain domain1
date -Iseconds
curl -f http://localhost:8080/myapp/health/ready
date -Iseconds
```

### 23.2 Optimasi Startup

Strategi:

- kurangi dependency tidak perlu;
- hindari fat WAR dengan duplicate jars;
- set bean discovery mode yang tepat;
- precompile JSP jika relevan;
- hindari startup remote calls yang tidak wajib;
- gunakan timeout pendek untuk dependency check;
- split aplikasi besar jika deployment terlalu berat;
- review JPA scanning;
- review logging verbosity;
- pastikan disk dan CPU cukup;
- hindari cold DB connection storm.

---

## 24. Graceful Shutdown sebagai Pasangan Startup

Startup tidak bisa dipisahkan dari shutdown.

Jika shutdown buruk:

- port lama belum release;
- lock file tersisa;
- transaction recovery state inconsistent;
- JMS consumer tidak close;
- thread custom masih hidup;
- redeploy berikutnya gagal;
- container menganggap app stuck.

### 24.1 Shutdown Sequence Konseptual

```text
stop command / SIGTERM
  -> stop accepting new admin/app operations
  -> application lifecycle shutdown
  -> close resources
  -> stop listeners
  -> stop containers
  -> flush logs/state
  -> JVM exits
```

### 24.2 Application Responsibility

Aplikasi harus menutup:

- custom executor;
- scheduler;
- HTTP client;
- file watcher;
- cache client;
- long-running background thread.

Anti-pattern:

```java
new Thread(() -> { while (true) { ... } }).start();
```

tanpa lifecycle management.

Di application server, unmanaged thread bisa mengganggu shutdown/redeploy.

---

## 25. Clean Restart, Hot Redeploy, dan Full Recreate

Ada beberapa level “mengulang” runtime:

| Level | Apa yang dilakukan | Cocok untuk |
|---|---|---|
| Hot redeploy | redeploy aplikasi | perubahan app biasa |
| Restart domain | stop/start server | config/JVM/resource change |
| Recreate domain | buat ulang domain dari script | drift recovery, environment rebuild |
| Rebuild image | build container/VM image baru | immutable infrastructure |

### 25.1 Hot Redeploy Tidak Sama dengan Clean Restart

Hot redeploy bisa menyisakan:

- classloader leak;
- thread leak;
- static state;
- cached provider;
- generated artifacts;
- connection/resource state.

Clean restart memberi validasi lebih kuat.

### 25.2 Recreate Domain Adalah Test Configuration-as-Code

Jika domain tidak bisa direcreate dari script, configuration-as-code belum matang.

Target maturity:

```text
Given: clean GlassFish installation
And: config scripts
And: app artifacts
When: bootstrap environment
Then: environment equivalent to UAT/PROD baseline
```

---

## 26. Operational Readiness Checklist Setelah Startup

Setelah `start-domain`, jangan langsung anggap sukses. Gunakan checklist.

### 26.1 Server-Level Checklist

```text
[ ] JVM process alive
[ ] Java version correct
[ ] domain name correct
[ ] server.log has no new SEVERE error
[ ] admin listener reachable if expected
[ ] HTTP/HTTPS listener reachable
[ ] expected ports listening
[ ] no unexpected port binding
[ ] thread pools created
[ ] monitoring enabled as expected
```

### 26.2 Resource-Level Checklist

```text
[ ] JDBC resources listed
[ ] JDBC pools ping successfully
[ ] JMS resources listed
[ ] required realms available
[ ] JNDI resources resolvable
[ ] external dependencies reachable within timeout
```

### 26.3 Application-Level Checklist

```text
[ ] expected apps listed
[ ] apps enabled
[ ] context roots correct
[ ] deployment logs clean
[ ] health/live returns success
[ ] health/ready returns success
[ ] smoke test critical endpoint success
[ ] background consumers active if required
[ ] scheduled/timer jobs not duplicated
```

### 26.4 Business-Level Checklist

```text
[ ] DB schema version expected
[ ] reference data available
[ ] login/auth works
[ ] critical transaction flow works
[ ] outbound integration credential valid
[ ] message processing end-to-end works
[ ] audit/logging/correlation works
```

---

## 27. Runbook: Domain Tidak Bisa Start

Gunakan flow berikut.

```text
1. Cek command output
2. Cek server.log
3. Cek Java version
4. Cek JVM options
5. Cek port conflict
6. Cek domain.xml recent change
7. Cek disk/memory/permission
8. Cek installation corruption/version mismatch
9. Restore config backup jika config rusak
10. Start ulang dengan controlled command
```

Command contoh:

```bash
java -version
asadmin version --verbose
asadmin list-domains
cat /path/to/domain/logs/server.log | tail -300
lsof -i :4848
lsof -i :8080
df -h
free -m
ulimit -a
```

Windows:

```powershell
java -version
asadmin version --verbose
asadmin list-domains
Get-Content C:\glassfish\glassfish\domains\domain1\logs\server.log -Tail 300
netstat -ano | findstr :8080
Get-PSDrive
```

Decision:

```text
If no JVM process -> process/JDK/JVM option issue
If JVM exits quickly -> server.log/root cause
If port conflict -> stop conflicting process/change port
If config invalid -> restore known-good domain.xml or fix via backup
If app deploy failure only -> server can start; isolate application
```

---

## 28. Runbook: Server Start, Tapi Aplikasi 404

Flow:

```text
1. Confirm listener responds
2. Confirm application deployed
3. Confirm context root
4. Confirm target
5. Confirm virtual server
6. Confirm app enabled
7. Confirm deployment error absent
8. Confirm reverse proxy rewrite
```

Commands:

```bash
asadmin list-applications
asadmin list-components
asadmin get applications.application.*
curl -i http://localhost:8080/
curl -i http://localhost:8080/<context-root>/
```

Root cause umum:

- context root berbeda;
- app deploy gagal;
- app disabled;
- wrong target;
- path rewrite nginx/ALB salah;
- virtual server mismatch;
- request ke port salah.

---

## 29. Runbook: Server Start, Tapi Aplikasi 500 Saat Request Pertama

Kemungkinan besar app lazy initialization.

Flow:

```text
1. Ambil request timestamp
2. Cari stack trace pada timestamp sama
3. Bedakan classloading/resource/business error
4. Cek apakah error hanya endpoint tertentu
5. Cek dependency eksternal
6. Cek connection pool
7. Cek classpath/library conflict
```

Indikasi:

```text
ClassNotFoundException      -> dependency packaging/classloader
NoSuchMethodError           -> version conflict
JNDI NameNotFoundException  -> resource mapping/target
SQLException                -> DB/pool/schema/credential
CDI exception               -> injection/bean discovery
Transaction exception       -> JTA/resource boundary
```

---

## 30. Runbook: Startup Lambat/Stuck

Flow:

```text
1. Tentukan stuck atau lambat
2. Ambil timestamp log
3. Ambil thread dump berkala
4. Cari banyak thread blocked/waiting pada resource sama
5. Cek DB/network/DNS timeout
6. Cek CPU throttling
7. Cek disk IO
8. Cek app startup code
```

Ambil thread dump:

```bash
jcmd <pid> Thread.print > thread-1.txt
sleep 10
jcmd <pid> Thread.print > thread-2.txt
sleep 10
jcmd <pid> Thread.print > thread-3.txt
```

Cari pola:

- socket read ke DB/downstream;
- classloading lock;
- file IO;
- DNS lookup;
- deadlock;
- waiting on pool;
- blocked on application static lock.

Prinsip:

> Untuk stuck startup, thread dump sering lebih jujur daripada log.

---

## 31. Design Pattern: Startup Barrier Internal Aplikasi

Untuk aplikasi enterprise penting, buat internal startup state.

Contoh state:

```text
STARTING
CONFIG_LOADED
CONTAINERS_READY
DEPENDENCIES_CHECKED
READY
DEGRADED
FAILED
```

Health endpoint dapat membaca state ini.

Pseudo-code:

```java
public enum AppReadinessState {
    STARTING,
    CONFIG_LOADED,
    REQUIRED_DEPENDENCIES_READY,
    READY,
    DEGRADED,
    FAILED
}
```

Readiness response:

```json
{
  "status": "DOWN",
  "state": "STARTING",
  "checks": {
    "database": "UP",
    "redis": "UP",
    "externalPayment": "SKIPPED_OPTIONAL",
    "schemaVersion": "UP"
  }
}
```

Manfaat:

- load balancer tidak kirim traffic terlalu cepat;
- diagnosis lebih cepat;
- startup failure lebih eksplisit;
- optional dependency tidak salah membunuh app;
- deployment pipeline punya signal yang jelas.

---

## 32. Design Pattern: Separate Startup Validation dari Runtime Operation

Bedakan tiga jenis check:

### 32.1 Static Configuration Validation

Cek yang tidak butuh dependency eksternal.

Contoh:

- required env/property ada;
- URL format valid;
- numeric range valid;
- feature flag konsisten;
- mandatory secret name ada.

Ini aman dilakukan saat startup.

### 32.2 Critical Dependency Validation

Cek dependency yang wajib agar instance menerima traffic.

Contoh:

- DB reachable;
- schema version cocok;
- message broker reachable untuk worker service;
- auth public key/JWKS tersedia.

Ini cocok untuk readiness, bukan selalu liveness.

### 32.3 Optional Dependency Validation

Cek dependency yang tidak harus mencegah service utama.

Contoh:

- analytics service;
- optional notification provider;
- non-critical reporting engine.

Ini sebaiknya memberi status degraded, bukan membuat app gagal total.

---

## 33. Design Pattern: Startup Timeout Budget

Setiap startup operation harus punya timeout.

Buruk:

```text
Startup call external API with default infinite timeout
```

Baik:

```text
DB validation timeout: 3s
Redis validation timeout: 2s
JWKS fetch timeout: 3s
Optional downstream validation: skip or async refresh
Total readiness budget: 30s
```

Mental model:

```text
Startup budget = waktu maksimum sebelum instance dianggap gagal ready
```

Kalau di Kubernetes:

```text
startupProbe budget > worst-case normal startup
readinessProbe period cukup cepat
livenessProbe tidak membunuh startup normal
terminationGracePeriod cukup untuk shutdown
```

---

## 34. Environment-Specific Startup Differences

Startup bisa berbeda antar environment karena:

| Faktor | DEV | UAT/PROD |
|---|---|---|
| JDK | berbeda minor/major | baseline controlled |
| DB | local/dev schema | real schema/latency |
| Network | direct | proxy/firewall |
| TLS | self-signed | enterprise CA |
| Secrets | local file | secret manager |
| CPU/memory | laptop | container/VM limit |
| Deployment | autodeploy | pipeline/asadmin |
| Logging | verbose | controlled |
| App count | satu app | banyak app |

Prinsip:

> “Works on DEV” tidak membuktikan bootstrap invariant benar.

Yang harus sama antar environment:

- artifact build;
- Java major version sesuai target;
- GlassFish major/minor line;
- deployment command pattern;
- resource naming convention;
- health endpoint contract;
- timeout philosophy;
- config schema.

Yang boleh beda:

- host/port;
- credentials;
- pool size;
- log level;
- resource capacity;
- external endpoint URL.

---

## 35. Bootstrap Dalam Container/Kubernetes

Jika GlassFish berjalan di container, ada tambahan layer.

```text
Container runtime
  -> entrypoint script
  -> domain creation/config injection
  -> asadmin start-domain or startserv
  -> foreground process
  -> probes
  -> SIGTERM shutdown
```

### 35.1 Foreground vs Background Process

Di container, proses utama harus tetap foreground. Jika `asadmin start-domain` hanya meluncurkan server background lalu command keluar, container bisa mati.

Pattern perlu disesuaikan:

- gunakan mode verbose/foreground jika tersedia;
- atau entrypoint menunggu process dengan benar;
- log diarahkan ke stdout/stderr atau dikumpulkan sidecar/agent.

### 35.2 Readiness di Kubernetes

Jangan hanya probe port 8080.

Lebih baik:

```yaml
readinessProbe:
  httpGet:
    path: /myapp/health/ready
    port: 8080
```

Liveness:

```yaml
livenessProbe:
  httpGet:
    path: /myapp/health/live
    port: 8080
```

Startup:

```yaml
startupProbe:
  httpGet:
    path: /myapp/health/live
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

### 35.3 Config Injection Timing

Dalam container, config bisa diinject dari:

- environment variable;
- mounted ConfigMap;
- mounted Secret;
- generated domain.xml;
- startup script `asadmin set`;
- baked image.

Rule:

```text
Do not mutate critical config after readiness becomes true.
```

---

## 36. Bootstrap Security Considerations

Startup juga membawa risiko security.

### 36.1 Secrets Pada Startup

Secrets bisa diperlukan untuk:

- admin password;
- JDBC credential;
- keystore password;
- external API credential;
- JMS credential.

Risiko:

- secret muncul di command line;
- secret tertulis di log;
- secret tersimpan plaintext di script;
- file permission longgar;
- container env dapat dibaca oleh process lain;
- admin password file tertinggal.

Prinsip:

- gunakan password alias/secret mechanism yang sesuai;
- batasi permission file;
- jangan echo secret di pipeline;
- jangan taruh credential dalam artifact;
- rotasi credential butuh runbook restart/reload.

### 36.2 Admin Surface Saat Startup

Admin listener harus diproteksi.

Checklist:

```text
[ ] admin user not default/weak
[ ] secure admin sesuai kebutuhan
[ ] admin listener tidak exposed publik
[ ] firewall/security group membatasi akses
[ ] admin action auditable
[ ] credentials tidak bocor di logs/scripts
```

---

## 37. Bootstrap Observability Minimum

Untuk production, minimal kita butuh sinyal ini:

### 37.1 Log Signals

```text
server startup begin
Java version
GlassFish version
domain name
listener started
app deployment started
app deployment completed/failed
health readiness changed
startup completed
```

### 37.2 Metrics Signals

```text
process uptime
JVM memory
thread count
HTTP listener status
request count/error count
JDBC pool active/available/wait queue
deployment status
health status
```

### 37.3 Trace/Correlation

Startup biasanya belum punya request trace, tetapi aplikasi harus punya correlation untuk:

- smoke test;
- health check;
- first request after deploy;
- background consumer startup.

---

## 38. Bootstrap Review Checklist untuk Pull Request / Release

Sebelum release aplikasi GlassFish, review:

```text
[ ] Tidak ada startup external call tanpa timeout
[ ] Tidak ada unmanaged thread tanpa shutdown hook/container lifecycle
[ ] Health endpoint memisahkan live dan ready
[ ] Required vs optional dependency jelas
[ ] JNDI resource name sesuai environment
[ ] Deployment descriptor sesuai Jakarta/Java EE target
[ ] Tidak ada campuran javax/jakarta salah target
[ ] Build target bytecode sesuai runtime Java
[ ] Dependency tree tidak membawa duplicate API jar berbahaya
[ ] App bisa clean restart
[ ] App bisa redeploy tanpa leak jelas di non-prod
[ ] Logs cukup jelas untuk startup failure
[ ] Tidak ada secret tercetak di startup log
[ ] Smoke test otomatis setelah deploy
```

---

## 39. Top 1% Mental Model: Where Is the Boundary?

Saat startup gagal, engineer top-level selalu mencari boundary.

```text
Is this failure in:
  - OS boundary?
  - JVM boundary?
  - GlassFish installation boundary?
  - domain configuration boundary?
  - admin/runtime service boundary?
  - network listener boundary?
  - resource/JNDI boundary?
  - deployment/classloading boundary?
  - application initialization boundary?
  - external dependency boundary?
  - business configuration boundary?
```

Tanpa boundary, troubleshooting menjadi random.

Dengan boundary, diagnosis menjadi terarah.

Contoh:

```text
Symptom:
  App returns 500 on first request.

Weak diagnosis:
  GlassFish error.

Strong diagnosis:
  Server bootstrap completed, listener active, deployment succeeded.
  Failure occurs during lazy initialization of report module.
  Root cause is NoSuchMethodError from conflicting PDF library inside WAR.
  Boundary: application classpath, not GlassFish server config.
```

---

## 40. Contoh Full Startup Reasoning

Scenario:

```text
After deployment to UAT, asadmin start-domain succeeds.
Port 8080 is open.
Admin console is accessible.
But /aceas/api/health/ready returns 500.
```

Langkah reasoning:

1. JVM process alive: yes.
2. DAS/admin service alive: yes.
3. HTTP listener alive: yes.
4. Application deployed: verify `asadmin list-applications`.
5. Context root correct: verify URL/context root.
6. App health endpoint reached: yes, returns 500 not 404.
7. Failure inside app runtime, not listener.
8. Check server.log at request timestamp.
9. Stack trace shows `NameNotFoundException: jdbc/ACEASDS`.
10. Check resource:

```bash
asadmin list-jdbc-resources
asadmin list-jdbc-connection-pools
```

11. Resource exists in DEV but not targeted to UAT server/cluster.
12. Root cause: config promotion incomplete.
13. Fix: create/target resource via idempotent asadmin script.
14. Add pipeline check: verify required JNDI resources before traffic.

Kesimpulan:

```text
Startup server sukses, readiness gagal karena resource boundary.
```

---

## 41. Mini Lab: Membuat Startup Observation Script

Contoh Bash sederhana:

```bash
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="domain1"
APP_CONTEXT="myapp"
BASE_URL="http://localhost:8080/${APP_CONTEXT}"

echo "[1] Java version"
java -version

echo "[2] Starting domain"
date -Iseconds
asadmin start-domain "${DOMAIN}"
date -Iseconds

echo "[3] Listing applications"
asadmin list-applications

echo "[4] Checking live endpoint"
curl -fsS "${BASE_URL}/health/live"
echo

echo "[5] Checking ready endpoint"
curl -fsS "${BASE_URL}/health/ready"
echo

echo "[6] Recent server log errors"
tail -300 "${GLASSFISH_HOME}/glassfish/domains/${DOMAIN}/logs/server.log" | grep -E "SEVERE|Exception|Caused by" || true
```

PowerShell variant:

```powershell
$Domain = "domain1"
$AppContext = "myapp"
$BaseUrl = "http://localhost:8080/$AppContext"

Write-Host "[1] Java version"
java -version

Write-Host "[2] Starting domain"
Get-Date -Format o
asadmin start-domain $Domain
Get-Date -Format o

Write-Host "[3] Listing applications"
asadmin list-applications

Write-Host "[4] Checking live endpoint"
Invoke-WebRequest "$BaseUrl/health/live" -UseBasicParsing

Write-Host "[5] Checking ready endpoint"
Invoke-WebRequest "$BaseUrl/health/ready" -UseBasicParsing

Write-Host "[6] Recent server log errors"
$Log = "$env:GLASSFISH_HOME\glassfish\domains\$Domain\logs\server.log"
Get-Content $Log -Tail 300 | Select-String "SEVERE|Exception|Caused by"
```

Script ini belum production-grade penuh, tetapi membentuk kebiasaan penting:

- catat waktu;
- validasi Java;
- start domain;
- inspect deployment;
- cek health;
- baca error log.

---

## 42. Common Anti-Patterns

### 42.1 Menganggap `start-domain` Sukses = Deployment Sukses

Salah karena server bisa start tanpa app healthy.

### 42.2 Menganggap Port Listening = App Ready

Salah karena listener bisa aktif sebelum/meski app gagal.

### 42.3 Startup Melakukan Semua Validasi Eksternal Tanpa Timeout

Membuat startup rapuh dan lambat.

### 42.4 Manual Fix di Console Setelah Startup Gagal

Boleh untuk emergency, tetapi harus dikembalikan ke script/config-as-code.

### 42.5 Tidak Melakukan Clean Restart Setelah Deploy

Hot deploy sukses tidak membuktikan restart-safety.

### 42.6 Mencampur Java Upgrade dan Jakarta Migration Tanpa Isolasi

Membuat failure space terlalu besar.

### 42.7 Menaruh Library Sembarangan di Server `lib`

Bisa mengubah bootstrap/classloading semua aplikasi.

### 42.8 Readiness Check Terlalu Dangkal

Contoh readiness hanya return `200 OK` tanpa cek resource penting.

### 42.9 Liveness Check Terlalu Berat

Contoh liveness cek DB, lalu app restart saat DB lambat.

---

## 43. Ringkasan Mental Model

Startup GlassFish harus dipahami sebagai pipeline bertingkat:

```text
JVM process
  -> GlassFish launcher
  -> domain config
  -> internal services
  -> admin service
  -> network listeners
  -> containers
  -> resources
  -> deployment
  -> app initialization
  -> readiness
```

Setiap level punya failure mode sendiri.

Top-level understanding:

1. **Server start bukan app ready.**
2. **Port listening bukan business readiness.**
3. **Deployment success bukan semua code path aman.**
4. **Resource exists bukan resource usable.**
5. **Hot deploy success bukan clean restart proof.**
6. **Java upgrade dan Jakarta migration adalah risiko berbeda.**
7. **Startup harus observable, bounded by timeout, dan diagnosable.**
8. **Boundary diagnosis lebih penting daripada restart berulang.**

---

## 44. Latihan Pemahaman

Jawab pertanyaan berikut tanpa melihat jawaban:

1. Apa perbedaan process alive, listener alive, app deployed, dan business-ready?
2. Mengapa `asadmin start-domain` sukses tidak cukup untuk menyatakan deployment sukses?
3. Di fase mana `domain.xml` dibaca?
4. Apa risiko manual edit `domain.xml`?
5. Mengapa app bisa 404 padahal port 8080 listening?
6. Mengapa app bisa 500 hanya pada request pertama?
7. Apa perbedaan liveness dan readiness?
8. Mengapa liveness sebaiknya tidak mengecek DB?
9. Mengapa clean restart penting setelah deployment?
10. Apa saja failure point saat upgrade Java 8 ke Java 17/21?
11. Mengapa `javax` ke `jakarta` bukan perubahan kosmetik?
12. Bagaimana cara membedakan server config failure vs application initialization failure?
13. Apa yang harus dicek jika startup lambat/stuck?
14. Mengapa thread dump berguna untuk stuck startup?
15. Apa prinsip startup timeout budget?

---

## 45. Jawaban Singkat Latihan

1. Process alive berarti JVM hidup; listener alive berarti port menerima koneksi; app deployed berarti artifact diproses; business-ready berarti dependency dan kondisi bisnis siap.
2. Karena `start-domain` hanya membuktikan domain/server process start, bukan semua app berhasil deploy dan siap.
3. Setelah JVM/launcher mulai, sebelum service runtime dibuat penuh.
4. Bisa membuat config semantic invalid, drift, duplicate reference, atau value tidak tervalidasi command model.
5. Context root salah, app belum deploy, app disabled, target salah, virtual server/proxy salah.
6. Lazy initialization, missing class, resource lookup, DB connection, atau code path tertentu baru berjalan saat request.
7. Liveness menjawab “perlu restart atau tidak”; readiness menjawab “boleh menerima traffic atau tidak”.
8. DB lambat/down bisa membuat app sehat direstart terus, padahal masalahnya dependency eksternal.
9. Karena hot deploy bisa menyisakan state dan tidak membuktikan app survive full bootstrap.
10. JVM option invalid, removed modules, reflection restrictions, TLS behavior, dependency incompatibility.
11. Package berubah dan binary incompatible; class `javax.servlet.Filter` bukan `jakarta.servlet.Filter`.
12. Lihat apakah failure terjadi sebelum server/listener hidup, saat deploy, atau saat app lifecycle callback.
13. Timestamp log, thread dump berkala, DB/network/DNS, CPU/disk, startup code.
14. Karena thread dump menunjukkan thread sedang menunggu apa meski log tidak bergerak.
15. Semua startup dependency operation harus punya batas waktu dan failure semantics jelas.

---

## 46. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk Part 6:

- Eclipse GlassFish Quick Start Guide, Release 8 — dokumentasi start domain, deploy aplikasi, dan command dasar.
- Eclipse GlassFish Application Deployment Guide, Release 8 — dokumentasi proses dan tooling deployment aplikasi/module di GlassFish.
- Eclipse GlassFish Administration Guide, Release 8 — dokumentasi administrasi domain, service, monitoring, dan konfigurasi.
- Eclipse GlassFish Reference Manual, Release 8 — dokumentasi detail command `asadmin` seperti `start-domain`, `deploy`, `list-applications`, dan command administrasi lain.
- Eclipse GlassFish Release Notes, Release 8 — dokumentasi versi, compatibility, dan dokumentasi terkait release.

---

## 47. Penutup Part 6

Pada part ini kita membangun mental model bahwa startup GlassFish adalah pipeline:

```text
OS/JVM -> domain config -> internal runtime -> listeners -> containers -> resources -> deployments -> app readiness
```

Kita juga membahas failure taxonomy, readiness/liveness, deployment-on-startup, Java version risk, Jakarta namespace risk, startup troubleshooting, dan runbook dasar.

Dengan pemahaman ini, kita tidak lagi melihat GlassFish sebagai black box yang “kadang start kadang error”, tetapi sebagai runtime dengan fase dan boundary yang bisa ditelusuri.

Part berikutnya:

> **Part 7 — Classloading Architecture: Parent Delegation, Isolation, Libraries, dan Konflik Dependency**

Part 7 akan masuk ke salah satu area paling penting dan paling sering menyebabkan incident pada application server: classloader hierarchy, dependency conflict, `javax`/`jakarta` collision, server lib vs app lib, EAR/WAR isolation, dan diagnosis `ClassNotFoundException`, `NoClassDefFoundError`, `NoSuchMethodError`, serta `LinkageError`.

**Status seri: belum selesai. Ini adalah Part 6 dari 35.**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-005.md">⬅️ Part 5 — Admin Console, REST Admin API, dan Configuration as Code</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-007.md">Part 7 — Classloading Architecture: Parent Delegation, Isolation, Libraries, dan Konflik Dependency ➡️</a>
</div>
