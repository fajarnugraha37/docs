# learn-java-deployment-runtime-release-delivery-engineering

# Part 28 — Legacy Java Deployment: Java 8, App Servers, Monoliths, and Migration Constraints

> Seri: **Java Deployment Runtime Release Delivery Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus bagian ini: memahami deployment Java legacy secara production-grade: Java 8, application server lama, monolith WAR/EAR, shared libraries, manual release, TLS lama, batch/cron, operational constraints, dan strategi migrasi tanpa merusak sistem berjalan.

---

## 0. Tujuan Bagian Ini

Legacy Java deployment bukan berarti “buruk”. Banyak sistem enterprise yang paling penting justru masih berjalan di Java 8, app server lama, WAR/EAR monolith, shared database, scheduler internal, batch job, dan release manual. Masalahnya bukan semata-mata usia teknologi. Masalahnya adalah **deployment coupling** yang sudah menumpuk selama bertahun-tahun.

Bagian ini bertujuan membangun kemampuan berikut:

1. membaca sistem Java legacy sebagai **runtime topology**, bukan hanya source code;
2. mengidentifikasi constraint deployment yang tersembunyi;
3. membedakan mana risiko legacy yang harus segera dikurangi dan mana yang bisa dikelola;
4. membuat release legacy lebih aman tanpa rewrite besar-besaran;
5. membuat roadmap migrasi Java 8/app server/monolith secara bertahap;
6. menjaga backward compatibility saat sebagian sistem masih lama dan sebagian mulai modern;
7. mengubah sistem yang tadinya “hanya bisa dideploy oleh satu orang senior” menjadi sistem yang bisa dioperasikan tim.

Prinsip utama bagian ini:

> Legacy deployment harus dipahami sebagai sistem kontrak. Kontraknya mungkin tidak terdokumentasi, tetapi tetap mengikat production.

---

## 1. Apa Itu Legacy Java Deployment?

Dalam konteks deployment, “legacy” bukan sekadar Java versi lama. Sebuah sistem bisa disebut legacy secara deployment jika banyak asumsi runtime-nya tidak eksplisit, sulit direproduksi, atau sulit diubah tanpa risiko besar.

Contoh ciri legacy deployment:

- memakai Java 8 atau lebih lama sebagai baseline utama;
- berjalan di application server seperti WebLogic, WebSphere, JBoss EAP, WildFly lama, GlassFish/Payara lama, Tomcat lama;
- artifact berupa WAR/EAR yang bergantung pada shared library server;
- dependency tidak sepenuhnya dikemas bersama aplikasi;
- konfigurasi tersebar di file server, console admin, database, environment variable, dan script shell;
- release dilakukan dengan upload manual ke console atau copy file ke folder deployment;
- rollback berarti “deploy file lama” tanpa kepastian schema/config compatible;
- banyak batch job, scheduler, cron, queue consumer, dan manual operation;
- production dan UAT tidak benar-benar sama;
- dokumentasi release kurang lengkap;
- observability terbatas pada log file dan monitoring server dasar;
- beberapa behavior bergantung pada classloader, JNDI, datasource, atau server module.

Legacy deployment sering terlihat stabil karena jarang diubah. Tetapi saat perubahan datang, risikonya muncul karena banyak dependency tidak terlihat.

---

## 2. Mental Model: Legacy Java Deployment sebagai Sistem Lapisan

Untuk memahami deployment legacy, jangan mulai dari Docker atau Kubernetes. Mulailah dari lapisan-lapisan yang benar-benar mengikat aplikasi.

```text
+-------------------------------------------------------------+
| Business Process / Regulatory Workflow                      |
+-------------------------------------------------------------+
| Application Behavior                                        |
| - servlet/controller/action                                 |
| - service/business logic                                    |
| - batch/scheduler/consumer                                  |
+-------------------------------------------------------------+
| Application Artifact                                        |
| - WAR / EAR / JAR                                           |
| - exploded deployment                                       |
| - generated classes/resources                               |
+-------------------------------------------------------------+
| Application Server / Servlet Container                      |
| - classloader                                               |
| - datasource/JNDI                                           |
| - transaction manager                                       |
| - JMS/session/security realm                                |
+-------------------------------------------------------------+
| JVM Runtime                                                 |
| - Java 8 flags                                              |
| - heap/metaspace/direct memory/thread stack                 |
| - TLS/security providers                                    |
+-------------------------------------------------------------+
| OS / VM / Filesystem                                        |
| - users/permissions                                         |
| - mounted paths                                             |
| - temp/log directories                                      |
| - cron/systemd/init scripts                                 |
+-------------------------------------------------------------+
| External Dependencies                                       |
| - database                                                  |
| - LDAP/IdP                                                  |
| - SMTP                                                      |
| - file share/SFTP                                           |
| - MQ/API gateway                                            |
+-------------------------------------------------------------+
```

Dalam sistem modern, sebagian besar kontrak ini dipindah ke manifest, image, pipeline, dan secret manager. Dalam sistem legacy, kontrak ini sering tersebar dalam:

- `setenv.sh`, `domain.xml`, `standalone.xml`, `server.xml`, `context.xml`;
- admin console application server;
- folder `lib/` server;
- shared network drive;
- shell script release;
- table konfigurasi di database;
- property file di luar artifact;
- catatan release lama;
- kebiasaan engineer senior.

Tugas deployment engineer bukan langsung mengubah semuanya, tetapi membuat kontrak tersembunyi menjadi terlihat.

---

## 3. Legacy Tidak Sama dengan Salah

Legacy sering disalahpahami sebagai “harus segera dibuang”. Itu framing yang berbahaya. Banyak sistem legacy:

- sudah terbukti menjalankan workload nyata bertahun-tahun;
- memiliki domain logic penting yang tidak mudah direwrite;
- memiliki integrasi dengan sistem eksternal yang sulit diuji ulang;
- melayani proses regulasi, finansial, atau operasional kritis;
- memiliki banyak edge case yang tidak terdokumentasi di requirement baru.

Masalah legacy bukan keberadaannya, tetapi **kondisi operasionalnya**.

Sistem Java 8 monolith dengan release discipline, monitoring cukup, backup baik, schema migration aman, dan runbook jelas bisa lebih aman daripada microservices modern yang deployment-nya tidak matang.

Pertanyaan yang lebih tepat:

> Apakah sistem ini dapat diubah, dipatch, direstart, dirollback, dan dipulihkan dengan risiko yang dapat dipahami?

Kalau jawabannya tidak, maka problemnya adalah deployment maturity, bukan semata-mata versi Java.

---

## 4. Java 8 sebagai Deployment Baseline Legacy

Java 8 adalah salah satu baseline enterprise paling panjang umurnya. Banyak framework, app server, dan library enterprise distandardisasi di Java 8 selama bertahun-tahun.

Dari sisi deployment, Java 8 punya karakteristik penting:

1. tidak ada module system JPMS;
2. classpath adalah mekanisme utama;
3. PermGen sudah hilang dan diganti Metaspace;
4. container awareness tidak sematang Java modern;
5. TLS/security default berbeda dari versi modern;
6. banyak aplikasi masih bergantung pada library `javax.*`;
7. banyak app server Java EE 7/8 berjalan stabil di Java 8;
8. banyak tooling lama mengasumsikan layout JRE/JDK lama;
9. observability modern seperti JFR open availability tidak sama dengan Java modern;
10. banyak JVM flag lama berubah, deprecated, atau hilang di versi baru.

Konsekuensinya:

- upgrade Java 8 ke 11/17/21/25 bukan sekadar compile ulang;
- deployment script mungkin mengacu ke path JRE lama;
- TLS handshake ke sistem eksternal bisa berubah;
- library internal bisa memakai API yang dihapus dari JDK modern;
- startup flags bisa gagal karena flag sudah tidak dikenal;
- reflection bisa gagal karena strong encapsulation di Java modern;
- app server lama mungkin tidak certified untuk Java modern.

---

## 5. Inventory Pertama: Apa yang Harus Dicatat dari Sistem Legacy?

Sebelum membuat perubahan, buat inventory deployment. Ini bukan dokumentasi kosmetik. Ini adalah alat untuk mengurangi ketidakpastian.

### 5.1 Runtime Inventory

Catat:

- Java distribution: Oracle JDK, OpenJDK, IBM J9/OpenJ9, Azul, Red Hat, Corretto, Temurin, dll;
- Java exact version: misalnya `1.8.0_202`, `1.8.0_372`;
- bitness dan architecture: x86_64, aarch64;
- app server product dan versi;
- servlet/Jakarta/Java EE level;
- OS version;
- VM/container/bare metal;
- startup script;
- JVM flags;
- timezone;
- locale/encoding;
- truststore/keystore;
- installed certificates;
- native libraries;
- OS packages.

Command awal:

```bash
java -version
which java
readlink -f $(which java)
ps -ef | grep java
jcmd <pid> VM.version
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.command_line
```

Untuk Java 8, `jcmd` biasanya tersedia jika JDK dipasang, tetapi tidak selalu tersedia jika runtime hanya JRE atau image minimal.

### 5.2 Artifact Inventory

Catat:

- artifact type: WAR, EAR, JAR, exploded directory;
- artifact name dan versioning pattern;
- build timestamp;
- Git commit kalau ada;
- manifest metadata;
- dependency bundled di `WEB-INF/lib`;
- dependency yang disediakan server;
- generated code/resources;
- static assets;
- config di dalam artifact vs luar artifact.

Command awal:

```bash
jar tf app.war | head -100
jar tf app.war | grep 'WEB-INF/lib'
unzip -p app.war META-INF/MANIFEST.MF
sha256sum app.war
```

### 5.3 Server Inventory

Catat:

- server home;
- domain/base directory;
- deployment directory;
- shared `lib`;
- datasource/JNDI config;
- security realm;
- JMS/resource adapter;
- thread pool;
- connection pool;
- session configuration;
- cluster config;
- admin credentials process;
- log path;
- temp/work directory;
- health endpoint atau status command.

### 5.4 External Dependency Inventory

Catat semua dependency runtime:

- database host/schema/user;
- LDAP/AD;
- SMTP;
- file share;
- SFTP;
- message broker;
- HTTP/SOAP/REST external API;
- identity provider;
- signing service;
- PDF/reporting engine;
- scheduled integration window;
- firewall rules;
- DNS aliases;
- certificates;
- proxy settings.

Legacy production sering gagal bukan karena artifact buruk, tetapi karena satu dependency eksternal berubah.

---

## 6. WAR/EAR Legacy Deployment

### 6.1 WAR Deployment

WAR biasanya berisi:

```text
app.war
├── META-INF/
├── WEB-INF/
│   ├── web.xml
│   ├── classes/
│   └── lib/
├── static assets
└── JSP/resources
```

Dalam deployment modern executable JAR, aplikasi membawa embedded server. Dalam WAR legacy, lifecycle aplikasi dikendalikan container:

```text
Start server
  -> initialize container
  -> scan deployments
  -> create web application classloader
  -> parse descriptors/annotations
  -> initialize listeners/filters/servlets
  -> bind resources
  -> mark app available
```

Implikasi deployment:

- startup app bukan hanya `main()`;
- classloader dibuat oleh container;
- datasource sering tidak berada di artifact;
- thread pool bisa milik container;
- session lifecycle diatur container;
- reload bisa meninggalkan memory leak jika thread/static reference tidak bersih;
- shared library server bisa mengalahkan library aplikasi tergantung classloader policy.

### 6.2 EAR Deployment

EAR lebih kompleks:

```text
enterprise-app.ear
├── META-INF/application.xml
├── web-module.war
├── ejb-module.jar
├── lib/
└── connector/resource modules
```

EAR sering dipakai untuk Java EE full profile dengan EJB, JTA, JMS, resource adapters, shared library antar module.

Deployment EAR membawa risiko tambahan:

- ordering antar module;
- dependency antar WAR/EJB module;
- transaction manager binding;
- classloader hierarchy lebih kompleks;
- rollback sebagian module hampir selalu berbahaya;
- shared session/security context;
- resource adapter lifecycle.

Rule praktis:

> Untuk EAR legacy, rollback harus dianggap sebagai rollback satu unit aplikasi, bukan satu module kecil, kecuali ada evidence kuat bahwa module benar-benar isolated.

---

## 7. Shared Library: Sumber Stabilitas dan Risiko

Banyak app server legacy memakai shared library di level server/domain:

```text
$SERVER_HOME/lib
$DOMAIN_HOME/lib
$TOMCAT_HOME/lib
$JBOSS_HOME/modules
$WEBLOGIC_DOMAIN/lib
```

Alasan historis:

- mengurangi ukuran WAR/EAR;
- satu driver JDBC dipakai banyak app;
- vendor library dikelola admin server;
- patch library tanpa rebuild aplikasi;
- comply dengan app server module system.

Tetapi shared library menciptakan coupling.

### 7.1 Risiko Shared Library

Risiko utama:

1. artifact tidak self-contained;
2. UAT dan production bisa berbeda tanpa kelihatan dari artifact;
3. patch library satu aplikasi bisa merusak aplikasi lain;
4. rollback artifact tidak otomatis rollback library;
5. dependency conflict sulit direproduksi lokal;
6. classloader behavior bisa berbeda per server;
7. vulnerability scanning artifact tidak melihat semua runtime dependency.

### 7.2 Cara Menjinakkan Shared Library

Buat manifest runtime dependency:

```text
Runtime Shared Libraries
------------------------
- ojdbc8.jar                : server lib, version 19.18
- commons-logging.jar       : bundled in WAR
- log4j-api.jar             : bundled in WAR
- vendor-connector.jar      : domain lib
- report-engine.jar         : shared module
```

Setiap release harus mencatat:

- library mana yang berubah;
- scope perubahan: app-only atau server-wide;
- siapa consumer lain;
- rollback plan library;
- restart requirement;
- compatibility matrix.

---

## 8. Classloader Legacy Failure Modes

Legacy app server sering punya classloader hierarchy yang kompleks.

Contoh konseptual:

```text
Bootstrap ClassLoader
  -> Platform/Extension ClassLoader
      -> Server ClassLoader
          -> Shared Library ClassLoader
              -> Application ClassLoader
                  -> Web Module ClassLoader
```

Failure mode umum:

### 8.1 `ClassNotFoundException`

Class tidak ditemukan saat runtime.

Penyebab:

- dependency tidak masuk WAR/EAR;
- dependency diasumsikan ada di server tapi tidak ada;
- wrong deployment profile;
- module server tidak dideklarasikan;
- library berada di classloader yang tidak terlihat.

### 8.2 `NoClassDefFoundError`

Class ditemukan saat compile tetapi gagal saat runtime, atau gagal inisialisasi.

Penyebab:

- missing transitive dependency;
- static initializer error;
- class ada di compile env tapi tidak ada di server;
- versi library berbeda.

### 8.3 `NoSuchMethodError`

Class ada, tetapi method yang dipanggil tidak ada.

Penyebab:

- versi library runtime lebih tua daripada compile;
- server shared library mengalahkan library aplikasi;
- partial upgrade dependency;
- dependency diamond conflict.

### 8.4 `ClassCastException` untuk Class yang Sama

Contoh:

```text
com.example.User cannot be cast to com.example.User
```

Ini bisa terjadi jika class yang sama dimuat oleh dua classloader berbeda.

Penyebab:

- duplicate library di shared lib dan WAR;
- app server module isolation;
- plugin architecture;
- hot reload meninggalkan classloader lama;
- static singleton lintas deployment.

### 8.5 Memory Leak saat Redeploy

Penyebab umum:

- thread dibuat aplikasi tidak dimatikan;
- `ThreadLocal` tidak dibersihkan;
- JDBC driver tidak deregister;
- timer/scheduler masih hidup;
- static cache memegang classloader;
- logging framework appender tidak ditutup;
- JMX MBean tidak unregister.

Rule praktis:

> Untuk legacy server, prefer restart instance terkontrol dibanding hot redeploy jika aplikasi tidak terbukti redeploy-safe.

---

## 9. Manual Deployment: Risiko dan Cara Mengendalikannya

Legacy deployment sering berupa langkah manual:

1. backup WAR lama;
2. stop server;
3. copy WAR baru;
4. clear temp/work directory;
5. start server;
6. check log;
7. test URL;
8. inform user.

Manual bukan otomatis salah. Yang salah adalah manual tanpa determinisme.

### 9.1 Minimum Safe Manual Deployment Checklist

Sebelum deployment:

- artifact checksum dicatat;
- artifact source jelas;
- target server jelas;
- Java/app server version dicatat;
- database migration status jelas;
- config change list jelas;
- backup artifact lama tersedia;
- rollback command tersedia;
- maintenance window disetujui;
- user communication siap;
- external dependency freeze diketahui.

Saat deployment:

- ambil current deployed artifact checksum;
- stop app/server sesuai urutan;
- deploy artifact baru;
- clear cache/temp hanya jika diperlukan dan terdokumentasi;
- start server;
- monitor startup log;
- jalankan smoke test;
- cek error log;
- cek database connectivity;
- cek external API minimal;
- cek scheduler/consumer status.

Sesudah deployment:

- catat deployed version;
- catat waktu start/end;
- catat issue;
- attach evidence;
- update release tracker;
- monitor window minimal.

### 9.2 Anti-Pattern Manual Deployment

Anti-pattern:

- “ambil file dari laptop developer”;
- “copy file yang namanya final-final2.war”;
- tidak ada checksum;
- tidak tahu server mana yang aktif;
- deploy ke salah node cluster;
- restart hanya satu node tanpa tahu load balancer behavior;
- clear semua temp/cache tanpa memahami side effect;
- rollback memakai artifact yang belum diverifikasi;
- DB migration manual tanpa script idempotent;
- tidak ada log evidence.

---

## 10. Release Layout Legacy yang Lebih Aman

Untuk server/VM legacy, gunakan release directory pattern.

```text
/opt/apps/claims/
├── releases/
│   ├── 2026-06-18_001/
│   │   ├── app.war
│   │   ├── config/
│   │   ├── checksums.txt
│   │   ├── release-notes.md
│   │   └── rollback.md
│   ├── 2026-06-25_002/
│   └── 2026-07-02_003/
├── current -> /opt/apps/claims/releases/2026-07-02_003
├── previous -> /opt/apps/claims/releases/2026-06-25_002
├── shared/
│   ├── logs/
│   ├── tmp/
│   └── uploads/
└── scripts/
    ├── deploy.sh
    ├── rollback.sh
    └── healthcheck.sh
```

Walaupun app server tetap butuh deployment ke directory tertentu, release layout ini membantu:

- traceability;
- repeatability;
- rollback;
- audit evidence;
- artifact retention;
- separation antara immutable release dan mutable data.

Prinsip:

> Release directory immutable. Yang mutable harus berada di `shared/`, database, object storage, atau external state yang jelas.

---

## 11. Java 8 JVM Flags dalam Sistem Legacy

Java 8 deployment sering memiliki flag seperti:

```bash
-Xms2048m
-Xmx4096m
-XX:MaxMetaspaceSize=512m
-XX:+UseG1GC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-Dfile.encoding=UTF-8
-Duser.timezone=Asia/Jakarta
-Djavax.net.ssl.trustStore=/opt/certs/truststore.jks
-Djavax.net.ssl.trustStorePassword=changeit
```

Saat migrasi ke Java modern, beberapa flag berubah. Contoh:

- GC logging Java 9+ memakai unified logging `-Xlog:gc*`;
- beberapa CMS flags dihapus;
- PermGen flags tidak valid;
- illegal reflective access berubah;
- module opens mungkin diperlukan;
- TLS default dan disabled algorithms berubah;
- container memory flags berkembang.

Maka inventory flags harus menjadi input upgrade.

### 11.1 Flag Classification

Klasifikasikan flag:

| Kategori | Contoh | Risiko saat upgrade |
|---|---|---|
| Memory sizing | `-Xmx`, `-Xms`, metaspace | Perlu dikaji ulang karena container/heap ergonomics berubah |
| GC | CMS/G1/Parallel flags | Sebagian deprecated/removed |
| Logging | `-Xloggc`, `PrintGC*` | Format berubah Java 9+ |
| Diagnostics | heap dump, error file | Biasanya bisa dipertahankan dengan penyesuaian |
| Security/TLS | truststore, protocol | Sangat sensitif terhadap versi JDK |
| System behavior | timezone, encoding | Harus eksplisit |
| App config | `-Dspring.*`, `-Dapp.*` | Harus dipisahkan dari JVM behavior |
| Compatibility | endorsed/ext dirs, bootclasspath | Banyak yang tidak berlaku di Java modern |

---

## 12. TLS dan Certificate Problem pada Java 8 Legacy

Sistem Java 8 sering bertemu masalah TLS saat external endpoint berubah.

Failure umum:

```text
javax.net.ssl.SSLHandshakeException
PKIX path building failed
Received fatal alert: handshake_failure
No appropriate protocol
Algorithm constraints check failed
```

Penyebab:

- CA root belum ada di truststore Java lama;
- endpoint menonaktifkan TLS 1.0/1.1;
- cipher suite lama tidak didukung;
- sertifikat intermediate tidak lengkap;
- hostname mismatch;
- truststore custom outdated;
- Java 8 update level terlalu tua;
- provider/security policy berbeda.

### 12.1 Prinsip Deployment untuk TLS Legacy

Jangan patch TLS secara trial-and-error di production.

Buat inventory:

```bash
java -version
keytool -list -keystore $JAVA_HOME/jre/lib/security/cacerts | head
keytool -list -keystore /path/custom-truststore.jks
openssl s_client -connect host:443 -servername host -showcerts
```

Catat:

- JDK update version;
- default truststore vs custom truststore;
- TLS protocol yang dipakai;
- certificate chain;
- expiry;
- external endpoint change window;
- apakah restart diperlukan setelah truststore update.

Rule praktis:

> Pada Java legacy, truststore deployment harus diperlakukan seperti artifact deployment: versioned, checksumed, tested, dan rollbackable.

---

## 13. Encoding, Timezone, Locale: Tiga Sumber Bug Legacy

Banyak sistem legacy gagal secara halus karena environment berbeda.

### 13.1 Encoding

Jika tidak eksplisit, Java 8 memakai default encoding dari OS locale.

Risiko:

- file CSV rusak;
- nama user karakter non-ASCII rusak;
- email template rusak;
- PDF/report salah render;
- signature/hash berubah karena byte representation beda.

Set eksplisit:

```bash
-Dfile.encoding=UTF-8
```

Tetapi validasi juga perlu di level file reader/writer. Jangan hanya mengandalkan global flag.

### 13.2 Timezone

Risiko:

- scheduled job jalan di jam salah;
- cutoff date salah;
- report harian bergeser;
- audit timestamp membingungkan;
- token expiry salah dipersepsikan.

Set eksplisit:

```bash
-Duser.timezone=Asia/Jakarta
```

Tetapi database timezone, OS timezone, dan application timezone tetap harus konsisten.

### 13.3 Locale

Risiko:

- format tanggal berubah;
- decimal separator berubah;
- case conversion berbeda;
- sorting berbeda;
- report berbeda.

Rule:

> Legacy deployment harus menjadikan encoding, timezone, dan locale sebagai deployment contract, bukan implicit OS behavior.

---

## 14. File System Coupling pada Monolith Legacy

Legacy monolith sering memakai filesystem untuk:

- upload file;
- generated report;
- temporary export;
- batch input/output;
- SFTP staging;
- document archive;
- scanned files;
- template files;
- cache lokal;
- lock files.

Risiko:

- path hardcoded;
- permission berubah setelah deployment;
- shared folder tidak mounted;
- node cluster tidak melihat file yang sama;
- temp file tidak dibersihkan;
- rollback code tidak rollback file format;
- deployment clear temp menghapus data penting;
- backup tidak mencakup filesystem.

### 14.1 Inventory Path

Cari path hardcoded:

```bash
grep -R "/opt/\|/var/\|C:\\\\|/tmp\|/mnt" src/main resources config -n
```

Untuk runtime process:

```bash
lsof -p <pid> | grep REG
lsof -p <pid> | grep DIR
```

Dokumentasikan:

| Path | Purpose | Mutable? | Shared? | Backup? | Owner | Permission | Cleanup |
|---|---|---:|---:|---:|---|---|---|
| `/data/upload` | user upload | yes | yes | yes | app | 750 | no auto delete |
| `/tmp/app` | temp export | yes | no | no | app | 700 | daily cleanup |
| `/opt/app/templates` | templates | no | deployed | yes | app | 750 | release controlled |

---

## 15. Batch, Cron, and Scheduler Legacy

Legacy Java sering bukan hanya web app. Ia juga punya:

- cron script memanggil Java main;
- Quartz scheduler embedded;
- EJB timer;
- Spring scheduler;
- database polling job;
- file watcher;
- batch import/export;
- reconciliation job;
- email retry job.

Deployment web app bisa aman, tetapi batch bisa rusak diam-diam.

### 15.1 Deployment Questions untuk Scheduler

Sebelum deploy, tanya:

1. Job apa yang sedang berjalan?
2. Apakah job bisa dihentikan aman?
3. Apakah job idempotent?
4. Apakah job menyimpan checkpoint?
5. Apakah ada duplicate prevention?
6. Apakah cluster menjalankan job di banyak node?
7. Apakah job bergantung pada schema baru/lama?
8. Apakah rollback code compatible dengan job state baru?
9. Apakah ada job window yang harus dihindari?
10. Apakah ada manual rerun procedure?

### 15.2 Pattern Safe Deployment untuk Batch

Pattern aman:

```text
1. Disable scheduler trigger
2. Wait active job complete or drain safely
3. Deploy app/artifact
4. Run migration if needed
5. Start app
6. Validate app health
7. Re-enable scheduler
8. Monitor first run
```

Jika job tidak bisa dihentikan:

- gunakan maintenance window;
- gunakan distributed lock;
- buat job version-aware;
- pisahkan job runner dari web app;
- tambahkan checkpoint dan idempotency sebelum migration besar.

---

## 16. Database Coupling pada Legacy Monolith

Legacy monolith sering punya coupling kuat ke database:

- SQL tersebar di code;
- stored procedure/package;
- trigger;
- view;
- synonym;
- DB link;
- sequence;
- materialized view;
- temporary table;
- schema shared dengan aplikasi lain;
- manual DDL;
- data patch script.

Deployment app tanpa memahami DB coupling berbahaya.

### 16.1 Minimum Database Deployment Inventory

Catat:

- schema yang dipakai;
- table yang dibaca/tulis;
- stored procedure dependency;
- trigger side effect;
- view dependency;
- cross-schema grant;
- DB link;
- migration scripts;
- data patch;
- rollback script;
- locking risk;
- long-running query;
- index dependency.

### 16.2 Legacy DB Migration Rule

Untuk legacy, jangan langsung melakukan destructive migration.

Gunakan expand-contract:

```text
Release A:
- Add nullable column/new table/new index safely
- Old app still works

Release B:
- New app writes both old and new shape if needed
- Backfill data
- Validate consistency

Release C:
- Switch reads to new shape
- Keep old shape temporarily

Release D:
- Remove old column/table only after evidence
```

Rollback harus diuji berdasarkan **data state**, bukan hanya artifact.

---

## 17. Logging Legacy

Legacy Java logging bisa memakai:

- `java.util.logging`;
- Log4j 1.x;
- Log4j 2;
- Logback;
- Commons Logging;
- SLF4J bridge;
- app server logging subsystem;
- custom audit logger;
- database logging.

Masalah umum:

- log path berubah antar environment;
- log tidak rotate;
- app server menangkap stdout/stderr;
- duplicate logging karena bridge conflict;
- sensitive data masuk log;
- correlation ID tidak ada;
- timezone log berbeda;
- multi-node log sulit dikorelasikan.

### 17.1 Minimal Deployment Logging Contract

Setiap deployment harus menjawab:

- startup log ada di mana?
- application error log ada di mana?
- access log ada di mana?
- GC log ada di mana?
- audit log ada di mana?
- apakah log rotate?
- retention berapa hari?
- apakah log ship ke centralized logging?
- format timestamp apa?
- timezone apa?
- apakah version/build id muncul saat startup?

Tambahkan startup banner yang berguna:

```text
Application: claims-web
Version: 2026.06.18.001
Git Commit: abc1234
Build Time: 2026-06-18T10:00:00Z
Java: 1.8.0_382
Server: WebLogic 12.2.1.4
Environment: UAT
```

---

## 18. Monitoring Legacy: Dari “Server Up” ke “Business Capability Up”

Legacy monitoring sering hanya mengecek:

- port terbuka;
- server process hidup;
- CPU/memory;
- disk;
- HTTP 200 homepage.

Itu tidak cukup.

Aplikasi bisa hidup tetapi:

- datasource down;
- LDAP down;
- scheduler mati;
- queue stuck;
- email gagal;
- report generation gagal;
- file share unmounted;
- stored procedure invalid;
- certificate expired;
- app stuck di thread pool.

### 18.1 Legacy Health Model

Buat health check bertingkat:

```text
L0 Process Health
- JVM alive
- app server alive
- port open

L1 Application Health
- app context started
- servlet/controller responds
- version endpoint returns expected build

L2 Dependency Health
- DB connection works
- cache/broker reachable
- LDAP/IdP reachable if critical
- file share writable/readable

L3 Capability Health
- create draft transaction works in test mode
- search endpoint works
- report template loads
- queue consumer can consume test message

L4 Business Health
- no abnormal failed jobs
- no backlog spike
- no error-rate spike
- key workflow synthetic transaction passes
```

Untuk legacy, L2/L3 sering harus ditambahkan secara bertahap.

---

## 19. Clustered Legacy Deployment

Banyak enterprise legacy memakai cluster app server di belakang load balancer.

Risiko deployment cluster:

- deploy hanya ke sebagian node;
- version skew tidak compatible;
- sticky session menahan user di node lama;
- session replication gagal karena class serialVersionUID berubah;
- shared cache inconsistent;
- scheduled job berjalan di semua node;
- rolling restart mengganggu in-flight transaction;
- load balancer belum drain connection;
- node dianggap up sebelum app ready.

### 19.1 Cluster Deployment Pattern

Pattern aman:

```text
1. Mark node A out of load balancer
2. Wait connection drain
3. Stop app/server on node A
4. Deploy artifact/config
5. Start node A
6. Run node-local health check
7. Put node A back into load balancer with low traffic if possible
8. Observe
9. Repeat for node B/C
```

Tetapi ini hanya aman jika:

- old and new versions can coexist;
- DB schema backward compatible;
- session serialization compatible;
- shared cache schema compatible;
- external API behavior compatible.

Jika tidak, gunakan blue-green atau maintenance window.

---

## 20. Session Compatibility in Legacy Web Apps

Legacy web app sering menyimpan banyak object di HTTP session.

Risiko:

- class berubah dan session lama tidak bisa deserialize;
- field berubah;
- `serialVersionUID` berubah;
- object graph berisi entity Hibernate detached;
- session terlalu besar;
- session replication lambat;
- sticky session menyembunyikan masalah;
- rollback gagal karena session state dibuat oleh versi baru.

Rule deployment:

> Jika session object tidak version-tolerant, rolling deployment tidak aman untuk user yang sedang login.

Mitigasi:

- buat session minimal;
- simpan hanya ID, bukan object besar;
- gunakan explicit `serialVersionUID` jika serialization dipakai;
- invalidate session saat major release;
- gunakan maintenance window;
- test rolling deployment dengan active session;
- dokumentasikan session compatibility.

---

## 21. Security Legacy: Jangan Hanya Fokus CVE

Legacy security deployment mencakup lebih dari dependency CVE.

Periksa:

- JDK patch level;
- app server patch level;
- TLS protocol/cipher;
- truststore update;
- admin console exposure;
- default credentials;
- management port firewall;
- JMX exposure;
- debug port;
- HTTP headers;
- cookie flags;
- session timeout;
- old libraries;
- log leakage;
- file upload path;
- temporary file permission;
- OS user privilege.

### 21.1 Legacy Management Surface

Application server lama sering punya management surface:

- admin console;
- deployment manager;
- JMX port;
- remote EJB/IIOP;
- JNDI remote lookup;
- server status page;
- AJP connector;
- debug port;
- custom admin endpoint.

Rule:

> Management surface harus berada di management network, bukan user-facing network.

---

## 22. Migrasi Legacy: Jangan Mulai dari Rewrite

Rewrite besar sering gagal karena domain behavior tidak terlihat. Strategi lebih aman adalah mengurangi deployment risk sambil mempertahankan behavior.

### 22.1 Urutan Modernisasi yang Rasional

Urutan yang biasanya aman:

```text
1. Inventory runtime dan deployment contract
2. Stabilize release procedure
3. Add version endpoint and startup metadata
4. Add health/smoke checks
5. Externalize and version config
6. Version truststore/keystore/secrets
7. Add artifact repository and checksum
8. Automate deployment steps partially
9. Remove shared library ambiguity
10. Improve logging/metrics
11. Make DB migration repeatable
12. Separate scheduler/batch if needed
13. Upgrade patch level within same major Java/app server
14. Upgrade app server minor/major with compatibility tests
15. Upgrade Java baseline
16. Consider containerization or platform migration
17. Break monolith only after boundaries are understood
```

Jangan melompat dari “manual WebLogic Java 8 monolith” langsung ke “Kubernetes microservices Java 21” tanpa mengurangi hidden coupling. Itu bukan migrasi; itu risk multiplication.

---

## 23. Java 8 ke Java Modern: Deployment Migration Thinking

Upgrade Java legacy harus diperlakukan sebagai multi-axis migration.

Axis:

```text
Language/source compatibility
Library compatibility
Build tool compatibility
Application server compatibility
JVM flag compatibility
TLS/security compatibility
GC/memory behavior
Reflection/module access
Observability tooling
Deployment scripts
Operational runbook
```

### 23.1 Migration Matrix

Contoh matrix:

| Axis | Current | Target | Risk | Validation |
|---|---|---|---|---|
| Java | 8u202 | 17/21 | TLS, removed APIs, flags | compile + integration + TLS test |
| App Server | WebLogic 12.2 | 14.x | certification, config migration | vendor matrix + staging deploy |
| API namespace | `javax.*` | still `javax.*` or `jakarta.*` | huge breaking change if Jakarta | dependency scan |
| Build | Maven old | Maven modern | plugin compatibility | reproducible build |
| GC | Parallel/CMS | G1/ZGC | latency/memory | load test |
| Deployment | manual WAR | automated WAR/container | process change | dry run |

### 23.2 Avoid Big-Bang Namespace Migration

Migrasi `javax.*` ke `jakarta.*` sangat besar. Untuk banyak sistem Java EE/Spring legacy, ini bukan sekadar rename import. Ini menyentuh:

- app server version;
- framework version;
- dependency ecosystem;
- servlet/JPA/JAX-RS/JMS APIs;
- generated code;
- reflection/scanning;
- deployment descriptors;
- test framework;
- shared libraries.

Jika target awal hanya runtime Java lebih baru, usahakan tetap di platform yang mendukung `javax.*` sampai siap migrasi namespace.

---

## 24. Strangler Pattern untuk Deployment Legacy

Strangler bukan selalu microservices. Dalam deployment legacy, strangler bisa berarti memindahkan capability tertentu keluar dari monolith secara bertahap.

Contoh kandidat:

- report generation;
- email sending;
- document conversion;
- external API integration;
- scheduled reconciliation;
- read-only search;
- notification;
- audit export;
- file ingestion.

Kriteria kandidat bagus:

- boundary data jelas;
- side effect terbatas;
- bisa dibuat idempotent;
- bisa dijalankan paralel;
- failure tidak langsung merusak core transaction;
- observability bisa ditambahkan;
- contract bisa didefinisikan.

Kandidat buruk:

- core transaction kompleks;
- banyak shared mutable state;
- hidden DB trigger dependency;
- synchronous critical path tanpa fallback;
- tidak ada test data;
- user journey tidak dipahami.

---

## 25. Containerizing Legacy: Kapan Masuk Akal, Kapan Tidak

Legacy WAR/app server bisa dicontainerize, tetapi container bukan obat otomatis.

Masuk akal jika:

- runtime bisa dipaketkan reproducibly;
- config bisa externalized;
- writable path jelas;
- license app server compatible;
- startup/shutdown bisa dikontrol;
- health check tersedia;
- logs bisa ke stdout/file shipper;
- cluster/session strategy jelas;
- persistent state tidak bergantung pada local container filesystem.

Tidak masuk akal jika:

- app server state banyak di admin console dan tidak bisa diexport;
- deployment butuh GUI/manual step;
- filesystem lokal menyimpan data penting;
- app memakai hostname/IP statis;
- license terikat host;
- startup sangat rapuh;
- node identity penting tapi tidak didesain;
- tidak ada cara health check.

Rule:

> Containerization legacy harus didahului dengan runtime inventory dan filesystem/config externalization.

---

## 26. Runbook Legacy Deployment

Runbook legacy harus lebih eksplisit daripada runbook modern, karena banyak langkah tidak dikodekan di pipeline.

### 26.1 Struktur Runbook

```text
1. Scope Release
2. Systems Affected
3. Artifact List
4. Config Changes
5. DB Changes
6. External Dependency Changes
7. Pre-Deployment Checks
8. Deployment Steps
9. Post-Deployment Verification
10. Rollback Decision Criteria
11. Rollback Steps
12. Monitoring Window
13. Known Failure Modes
14. Contacts and Escalation
15. Evidence Checklist
```

### 26.2 Rollback Decision Criteria

Jangan rollback berdasarkan panik. Tetapkan trigger:

- application cannot start after X minutes;
- error rate above threshold;
- critical workflow fails smoke test;
- DB migration failed before irreversible step;
- external dependency handshake fails;
- queue backlog grows beyond threshold;
- CPU/memory abnormal and user impact confirmed;
- security misconfiguration detected.

### 26.3 Rollback Reality

Rollback artifact aman hanya jika:

- schema masih compatible;
- config lama tersedia;
- shared library tidak berubah atau bisa dirollback;
- session/cache state compatible;
- job state compatible;
- external API contract unchanged;
- data written by new version can be read by old version.

Jika tidak, rollback perlu data repair atau roll-forward.

---

## 27. Legacy Deployment Risk Register

Buat risk register yang konkret.

| Risk | Signal | Impact | Mitigation |
|---|---|---|---|
| Unknown shared library | WAR works only on PROD | UAT false confidence | inventory server libs |
| Manual DB patch | inconsistent schema | runtime failure | versioned migration script |
| Hot redeploy leak | metaspace/thread leak | restart needed | full restart deployment |
| Session incompatibility | user error after rolling deploy | transaction loss | maintenance window/session invalidation |
| TLS old JDK | handshake failure | external API down | patch JDK/truststore test |
| Scheduler duplicate | same job runs on all nodes | duplicate processing | lock/disable scheduler during deploy |
| Hardcoded path | file not found | business process fails | path inventory/external config |
| Admin console exposed | compromise risk | security incident | network isolation/MFA |
| No version endpoint | cannot identify deployed build | slow RCA | add build metadata endpoint |
| No rollback evidence | uncertain recovery | extended outage | release directory/checksum |

---

## 28. Practical Assessment Framework

Nilai legacy deployment maturity dari 0–5.

### Level 0 — Tribal Deployment

- hanya satu orang tahu cara deploy;
- artifact dari laptop;
- tidak ada checksum;
- tidak ada runbook;
- rollback improvisasi.

### Level 1 — Documented Manual Deployment

- ada langkah deployment;
- artifact disimpan;
- rollback manual tersedia;
- masih banyak hidden dependency.

### Level 2 — Controlled Manual Deployment

- checksum;
- release notes;
- config list;
- DB scripts versioned;
- smoke test manual;
- evidence captured.

### Level 3 — Partially Automated Deployment

- artifact repository;
- deployment script;
- environment config versioned;
- health check;
- repeatable rollback;
- server inventory maintained.

### Level 4 — Automated and Observable Deployment

- pipeline promotion;
- deployment gates;
- centralized logs/metrics;
- dependency checks;
- automated evidence;
- rollback criteria clear.

### Level 5 — Modernized Runtime with Legacy-Safe Boundaries

- reproducible runtime;
- config/secret management mature;
- app server/container strategy clear;
- schema migration disciplined;
- legacy components isolated;
- migration roadmap evidence-driven.

Target realistis banyak enterprise bukan langsung Level 5. Naik dari Level 0/1 ke Level 3 saja sering sudah mengurangi incident besar.

---

## 29. Checklist Audit Legacy Java Deployment

### Runtime

- [ ] Java version exact known
- [ ] JDK vendor known
- [ ] app server version known
- [ ] OS version known
- [ ] JVM flags documented
- [ ] timezone/encoding explicit
- [ ] truststore/keystore versioned
- [ ] startup script versioned

### Artifact

- [ ] artifact stored in repository
- [ ] checksum recorded
- [ ] build metadata available
- [ ] dependencies inventoried
- [ ] shared libs documented
- [ ] rollback artifact available

### Config

- [ ] config source known
- [ ] environment differences documented
- [ ] secrets not embedded in artifact
- [ ] config change reviewed
- [ ] config rollback available

### Database

- [ ] schema changes scripted
- [ ] data patch scripted
- [ ] rollback/roll-forward strategy known
- [ ] locking risk assessed
- [ ] version compatibility known

### Operations

- [ ] health check available
- [ ] smoke test defined
- [ ] logs known
- [ ] monitoring window defined
- [ ] scheduler/consumer handling defined
- [ ] cluster rollout plan defined
- [ ] load balancer drain defined

### Security

- [ ] admin console isolated
- [ ] JMX/debug ports closed or restricted
- [ ] TLS protocol/cipher acceptable
- [ ] certificates monitored
- [ ] OS user least privilege
- [ ] log redaction reviewed

---

## 30. Concrete Modernization Plan Example

Misalnya sistem saat ini:

```text
Java 8
WebLogic 12c
EAR monolith
Oracle DB
Manual deployment via admin console
Shared libraries in domain/lib
Quartz jobs embedded
Logs on VM
No version endpoint
```

Roadmap aman:

### Phase 1 — Visibility

- add version endpoint;
- add startup metadata log;
- inventory JVM flags;
- inventory shared libs;
- document datasource/JMS/security realm;
- capture artifact checksum;
- define smoke test.

### Phase 2 — Control

- store artifact in repository;
- create release directory;
- version config files;
- script deploy steps where possible;
- define rollback runbook;
- disable scheduler during deployment;
- add DB migration script discipline.

### Phase 3 — Observability

- centralize logs;
- add health endpoint;
- monitor DB pool/thread pool;
- monitor job status;
- add certificate expiry monitoring;
- add GC logs and heap dump path.

### Phase 4 — Runtime Stabilization

- patch Java 8 to supported update;
- patch app server within certified range;
- remove unused shared libs;
- standardize truststore;
- remove hardcoded paths.

### Phase 5 — Migration Option

Choose one:

1. stay WAR/EAR but automate app server deployment;
2. move WAR to newer certified app server;
3. split selected capability with strangler;
4. containerize app server if runtime is reproducible;
5. migrate Java baseline after compatibility testing;
6. move from Java EE `javax.*` to Jakarta only when dependency ecosystem ready.

---

## 31. Common Mistakes by Strong Engineers

Even strong engineers make mistakes with legacy deployment because they underestimate hidden contracts.

### Mistake 1 — Treating Legacy as Just Old Code

Reality: legacy is old code plus old runtime plus old deployment assumptions plus old operational habits.

### Mistake 2 — Assuming Build Success Means Deployability

A WAR can compile perfectly and still fail because datasource, JNDI, classloader, shared library, or server descriptor differs.

### Mistake 3 — Forcing Containerization Too Early

If config, filesystem, startup, health, and state are not understood, containerization only moves chaos into an image.

### Mistake 4 — Ignoring Session and Scheduler State

Rolling deployment is unsafe if session serialization or scheduled jobs are not version-compatible.

### Mistake 5 — Upgrading Java Without TLS Testing

Java upgrade can alter TLS protocols, ciphers, disabled algorithms, trust behavior, and external handshake compatibility.

### Mistake 6 — Believing Rollback Is Always Deploying Old Artifact

Rollback can fail if DB, config, shared library, cache, session, or external data contract changed.

### Mistake 7 — Removing Shared Libraries Without Understanding Consumers

Shared libs may be ugly, but they may also be shared by multiple apps. Removing them blindly can break unrelated deployments.

---

## 32. Senior-Level Heuristics

Gunakan heuristic berikut saat menilai legacy deployment.

### 32.1 If You Cannot Inventory It, You Cannot Safely Change It

Unknown dependency is deployment risk.

### 32.2 Prefer Stabilization Before Modernization

Make deployment repeatable before changing runtime platform.

### 32.3 Legacy Rollout Requires Compatibility Proof

Rolling update requires old/new app, old/new schema, old/new session/cache, and old/new message compatibility.

### 32.4 Do Not Delete Before Observing

Before removing old paths, old columns, old libraries, or old jobs, observe whether they are still used.

### 32.5 Migration Is a Sequence of Risk Reductions

Good migration removes uncertainty step by step. Bad migration bundles all uncertainty into one heroic release.

### 32.6 App Server Is Part of the Application

In legacy Java, app server config is not infrastructure detail. It is part of the application runtime contract.

---

## 33. Reference Notes

This part is based on stable deployment engineering principles and official platform behavior references, including:

- Oracle Java SE Support Roadmap: https://www.oracle.com/java/technologies/java-se-support-roadmap.html
- Apache Tomcat Migration Guide: https://tomcat.apache.org/migration.html
- Apache Tomcat 11 Migration Guide: https://tomcat.apache.org/migration-11.0.html
- WildFly 26.1 Release Notes: https://www.wildfly.org/news/2022/04/14/WildFly-26-1-is-released/
- Oracle WebLogic Server Compatibility Documentation: https://docs.oracle.com/en/middleware/standalone/weblogic-server/14.1.1.0/intro/compatibility.html
- Oracle Fusion Middleware Certification Matrix: https://www.oracle.com/middleware/technologies/fusion-certification.html

The exact support status of Java runtimes, app servers, and vendor products changes over time. In real production planning, always verify the vendor certification matrix for the exact product version, operating system, CPU architecture, and Java update level.

---

## 34. Ringkasan

Legacy Java deployment harus dilihat sebagai sistem kontrak yang tersebar di artifact, app server, JVM, OS, database, filesystem, scheduler, external dependencies, dan human runbook.

Poin terpenting:

1. Legacy tidak otomatis salah, tetapi hidden contract membuat perubahan berisiko.
2. Java 8 deployment memiliki karakteristik berbeda dari Java modern.
3. WAR/EAR bergantung pada container lifecycle dan classloader.
4. Shared library harus diinventarisasi karena memengaruhi reproducibility.
5. Manual deployment bisa aman jika deterministic, versioned, dan evidenced.
6. TLS, timezone, encoding, filesystem, session, dan scheduler adalah sumber bug legacy yang sering diremehkan.
7. Rolling deployment legacy hanya aman jika compatibility terbukti.
8. Migrasi harus dimulai dari visibility dan control, bukan rewrite.
9. Rollback bukan hanya artifact rollback; rollback adalah state compatibility problem.
10. Tujuan awal modernisasi legacy adalah mengurangi ketidakpastian.

---

## 35. Koneksi ke Part Berikutnya

Bagian ini membahas deployment legacy. Part berikutnya akan membahas sisi sebaliknya:

> **Part 29 — Modern Java Deployment: Java 17, 21, 25, Containers, Virtual Threads, Cloud Native**

Di sana kita akan melihat bagaimana deployment berubah pada Java modern: container-aware runtime, Java 17/21/25 baseline, virtual threads, observability agent, jlink, native image, modern TLS defaults, structured concurrency implications, dan cloud-native runtime contracts.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 27 — Multi-Service and Distributed Java Deployment](./learn-java-deployment-runtime-release-delivery-engineering-part-27-multi-service-distributed-java-deployment.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 29 — Modern Java Deployment: Java 17, 21, 25, Containers, Virtual Threads, Cloud Native](./learn-java-deployment-runtime-release-delivery-engineering-part-29-java-17-21-25-containers-virtual-threads-cloud-native.md)
