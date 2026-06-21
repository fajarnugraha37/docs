# learn-java-eclipse-glassfish-runtime-server-engineering-part-002

# Part 2 — Installation, Distribution Layout, dan Runtime Anatomy

> Seri: **learn-java-eclipse-glassfish-runtime-server-engineering**  
> Part: **002 / 034**  
> Topik: **Installation, Distribution Layout, dan Runtime Anatomy**  
> Target: Java 8 sampai Java 25, dengan fokus GlassFish 5.x sampai 8.x  
> Status seri: **belum selesai**

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun peta versi, kompatibilitas, dan jalur migrasi dari Java EE 8 / `javax.*` menuju Jakarta EE modern / `jakarta.*`. Part ini turun satu level lebih konkret: **apa sebenarnya yang kita install ketika menginstall GlassFish, apa isi distribusinya, di mana konfigurasi hidup, bagaimana domain dibuat, dan bagaimana runtime mulai hidup dari direktori di disk menjadi proses JVM yang melayani request**.

Banyak engineer bisa menjalankan:

```bash
asadmin start-domain
```

Tetapi engineer yang benar-benar kuat harus bisa menjawab pertanyaan yang lebih dalam:

- Proses JVM mana yang sebenarnya hidup?
- File konfigurasi mana yang menentukan port HTTP, admin, HTTPS, JMX, JMS, thread pool, dan resource?
- Apa bedanya direktori instalasi GlassFish dengan direktori domain?
- Mana yang boleh diperlakukan immutable dan mana yang memang runtime state?
- Apa yang terjadi ketika domain dipindah, di-backup, di-restore, atau dijalankan dengan JDK berbeda?
- Mengapa `domain.xml` tidak boleh diperlakukan seperti file konfigurasi biasa yang diedit sembarangan?
- Mengapa deployment ke GlassFish menghasilkan direktori `applications`, `generated`, `osgi-cache`, atau file state lain?
- Bagaimana strategi instalasi untuk local development, shared server, UAT, production VM, dan container?

Part ini bukan sekadar “cara install”. Fokus utamanya adalah **runtime anatomy**.

---

## 1. Mental Model Utama

GlassFish dapat dipahami sebagai empat lapisan besar:

```text
+------------------------------------------------------------------+
|                         Application Layer                       |
|     WAR / EAR / EJB-JAR / RAR / libraries / descriptors          |
+------------------------------------------------------------------+
|                         Domain Runtime                          |
|     domain.xml, resources, deployed apps, logs, generated files   |
+------------------------------------------------------------------+
|                    GlassFish Installation Home                   |
|     asadmin, modules, server libraries, bootstrapping code        |
+------------------------------------------------------------------+
|                      Java + Operating System                     |
|     JDK, process model, filesystem, ports, users, limits          |
+------------------------------------------------------------------+
```

Kesalahan umum adalah menganggap GlassFish sebagai satu folder saja. Padahal secara operasional harus dibedakan:

1. **Installation home**  
   Berisi binary/runtime GlassFish: command, module, library, launcher.

2. **Domain directory**  
   Berisi konfigurasi dan runtime state domain: `domain.xml`, logs, generated artifacts, deployed apps, keystore, resource state.

3. **Application artifact**  
   WAR/EAR/RAR/JAR yang dideploy ke domain tertentu.

4. **External dependency**  
   JDK, database, message broker, reverse proxy, identity provider, filesystem, network, secret manager.

Mental model top-level:

> **GlassFish installation home adalah engine. Domain adalah kendaraan runtime yang memakai engine itu. Aplikasi adalah muatan. JDK dan OS adalah jalan serta kondisi fisik tempat kendaraan berjalan.**

Jika engine rusak, banyak domain bisa terdampak. Jika domain rusak, aplikasi pada domain itu terdampak. Jika artifact rusak, biasanya domain masih bisa hidup tetapi deployment gagal atau aplikasi error.

---

## 2. Istilah Path yang Wajib Dikuasai

Dokumentasi GlassFish menggunakan beberapa placeholder penting. Ini bukan trivia; ini memengaruhi cara kita menulis script, backup, CI/CD, Dockerfile, dan runbook.

| Placeholder | Makna | Contoh Unix/Linux | Contoh Windows |
|---|---|---|---|
| `as-install-parent` | Direktori parent dari instalasi GlassFish | `/opt/glassfish8` | `C:\glassfish8` |
| `as-install` | Base installation directory GlassFish | `/opt/glassfish8/glassfish` | `C:\glassfish8\glassfish` |
| `domain-root-dir` | Direktori tempat domain dibuat | `/opt/glassfish8/glassfish/domains` | `C:\glassfish8\glassfish\domains` |
| `domain-dir` | Direktori konfigurasi satu domain | `/opt/glassfish8/glassfish/domains/domain1` | `C:\glassfish8\glassfish\domains\domain1` |
| `instance-dir` | Direktori server instance | `domain-dir/<instance-name>` | `domain-dir\<instance-name>` |

Default domain biasanya bernama:

```text
domain1
```

Default port yang sering muncul:

| Port | Fungsi |
|---:|---|
| `4848` | Admin console / admin listener |
| `8080` | HTTP listener |
| `8181` | HTTPS listener |
| `8686` | JMX |
| `7676` | Message Queue / OpenMQ |
| `3700` | IIOP |
| `3820` | IIOP SSL |
| `3920` | IIOP SSL mutual auth |

Jangan menghafal angka ini sebagai kebenaran mutlak. Di production, port bisa dan sering diubah. Yang penting adalah tahu bahwa port-port ini berasal dari **domain configuration**, bukan dari kode aplikasi.

---

## 3. Distribusi GlassFish: Apa yang Ada di Dalam ZIP?

Distribusi GlassFish biasanya diekstrak menjadi struktur seperti ini:

```text
glassfish8/
└── glassfish/
    ├── bin/
    ├── config/
    ├── docs/
    ├── domains/
    ├── lib/
    ├── modules/
    ├── mq/
    ├── javadb/              (tergantung distribusi/versi)
    └── ...
```

Nama dan isi detail dapat berbeda antar versi, tetapi pola konseptualnya stabil.

### 3.1 `bin/`

Direktori ini berisi command-line tools, terutama:

```text
asadmin
asadmin.bat
```

`asadmin` adalah interface administratif utama. Hampir semua tindakan penting dapat dilakukan via `asadmin`:

- start/stop domain
- create/delete domain
- deploy/undeploy application
- configure JDBC pool
- configure resources
- configure JVM options
- inspect runtime state
- enable secure admin
- manage clusters/instances

Di mesin production, engineer yang hanya bisa memakai Admin Console tetapi tidak nyaman dengan `asadmin` akan terbatas. Console berguna untuk inspeksi, tetapi automation harus memakai CLI/API.

### 3.2 `modules/`

Direktori ini berisi modul-modul implementasi GlassFish. Di sinilah banyak fungsi server hidup:

- admin subsystem
- deployment subsystem
- web container
- EJB container
- connector container
- transaction service
- security service
- monitoring
- integration modules
- implementation libraries

Ini bukan tempat untuk meletakkan dependency aplikasi secara sembarangan.

Rule of thumb:

> Jangan menjadikan `modules/` sebagai tempat dumping JAR aplikasi.

Mengubah `modules/` bisa memengaruhi seluruh runtime. Ini hanya dilakukan jika benar-benar memahami efeknya, misalnya patching server module tertentu atau mengikuti instruksi resmi.

### 3.3 `lib/`

Direktori `lib/` berisi library runtime yang dipakai server dan tools. Beberapa versi menyediakan subdirektori atau mekanisme untuk library tambahan.

Di banyak environment legacy, engineer sering meletakkan JDBC driver atau library bersama di lokasi `lib`. Ini bisa berhasil, tetapi harus dipahami konsekuensinya:

- library menjadi terlihat oleh level server/domain tertentu;
- semua aplikasi bisa terdampak;
- konflik versi lebih mudah terjadi;
- upgrade server bisa menimpa atau mengubah asumsi library;
- troubleshooting `NoSuchMethodError` dan `LinkageError` menjadi lebih sulit.

Strategi library placement akan dibahas lebih dalam di Part 7 tentang classloading. Untuk part ini cukup pahami bahwa `lib` bukan sekadar folder bebas.

### 3.4 `domains/`

Ini adalah lokasi default domain. Setiap domain memiliki direktori sendiri:

```text
domains/
└── domain1/
    ├── config/
    ├── logs/
    ├── applications/
    ├── generated/
    ├── docroot/
    ├── lib/
    ├── osgi-cache/
    └── ...
```

Domain adalah boundary konfigurasi dan runtime state. Satu instalasi GlassFish dapat memiliki beberapa domain.

Contoh:

```text
/opt/glassfish8/glassfish/domains/dev-domain
/opt/glassfish8/glassfish/domains/sit-domain
/opt/glassfish8/glassfish/domains/uat-domain
```

Namun di production modern, lebih sering satu domain per server/pod/VM untuk mengurangi kompleksitas operasional.

### 3.5 `mq/` atau Message Queue related directories

GlassFish memiliki integrasi dengan OpenMQ/Jakarta Messaging. Beberapa distribusi menyertakan komponen message queue. Detailnya akan dibahas di part JMS/OpenMQ.

Untuk saat ini pahami saja:

- GlassFish bisa menjalankan atau mengintegrasikan messaging service;
- messaging memiliki port dan state sendiri;
- jangan menganggap GlassFish hanya HTTP server.

### 3.6 `config/` pada installation home

Jangan bingung antara:

```text
as-install/config
```

dan:

```text
domain-dir/config
```

Yang lebih sering penting untuk operasional domain adalah `domain-dir/config`. Installation-level config biasanya lebih terkait template/default/server-level files.

---

## 4. Domain Directory: Jantung Runtime GlassFish

Direktori domain adalah tempat GlassFish menyimpan konfigurasi dan state runtime untuk satu domain.

Contoh struktur konseptual:

```text
domain1/
├── config/
│   ├── domain.xml
│   ├── admin-keyfile
│   ├── keyfile
│   ├── keystore.jks / keystore.p12
│   ├── cacerts.jks / cacerts.p12
│   ├── logging.properties
│   ├── default-web.xml
│   └── ...
├── logs/
│   └── server.log
├── applications/
├── generated/
├── docroot/
├── lib/
├── osgi-cache/
├── session-store/          (tergantung fitur/versi/config)
└── ...
```

### 4.1 `config/domain.xml`

Ini file paling penting di domain.

`domain.xml` menyimpan banyak konfigurasi runtime, misalnya:

- server instances
- configs
- HTTP listeners
- network listeners
- thread pools
- JVM options
- JDBC pools
- JDBC resources
- JMS resources
- security realms
- transaction service
- monitoring configuration
- logging configuration reference
- deployed application references
- virtual servers
- admin service

Namun, meskipun `domain.xml` tampak seperti file XML biasa, jangan berpikir bahwa workflow normalnya adalah edit manual.

Rule penting:

> **Gunakan `asadmin` atau Admin API sebagai jalur utama perubahan konfigurasi. Edit manual `domain.xml` hanya untuk kondisi khusus, offline, terkontrol, dan dengan backup.**

Mengapa?

1. GlassFish memiliki model konfigurasi internal.
2. Beberapa perubahan perlu validasi.
3. Beberapa perubahan perlu sinkronisasi runtime.
4. Salah edit XML bisa membuat domain gagal start.
5. Perubahan manual mudah lolos dari audit trail.
6. Di cluster/multi-instance, config relationship lebih kompleks.

Contoh perubahan via `asadmin`:

```bash
asadmin set server-config.network-config.network-listeners.network-listener.http-listener-1.port=8080
```

Contoh anti-pattern:

```text
Edit domain.xml langsung di production pukul 23:00 tanpa backup, tanpa diff, tanpa restart plan.
```

### 4.2 `config/logging.properties`

File ini mengatur logging level dan handler tertentu. Namun konfigurasi logging juga bisa dimodifikasi via admin command.

Log GlassFish default umumnya masuk ke:

```text
domain-dir/logs/server.log
```

Dalam troubleshooting, `server.log` sering menjadi sumber pertama untuk:

- startup failure
- deployment failure
- resource binding failure
- connection pool failure
- security realm issue
- transaction warning
- thread pool warning
- exception aplikasi yang diarahkan ke server log

### 4.3 `config/default-web.xml`

Ini adalah default descriptor untuk web application behavior pada domain. Misalnya default servlet behavior, directory listing, dan konfigurasi global web tertentu.

Jangan ubah file ini sembarangan. Perubahan bisa memengaruhi semua web application dalam domain.

### 4.4 `config/keyfile`, `admin-keyfile`, dan credential files

File seperti `keyfile` dan `admin-keyfile` berkaitan dengan user/password realm internal dan admin. Ini sensitif.

Best practice:

- permission file harus ketat;
- jangan commit ke Git;
- jangan copy antar environment tanpa memahami efeknya;
- gunakan secret management untuk otomasi;
- rotate credential sesuai kebijakan.

### 4.5 Keystore dan truststore

GlassFish memakai keystore/truststore untuk TLS dan certificate-based flows.

Umumnya ada file seperti:

```text
keystore.jks
cacerts.jks
```

atau format modern lain tergantung versi/JDK.

Risiko umum:

- expired certificate;
- wrong alias;
- password mismatch;
- truststore tidak berisi CA yang dibutuhkan;
- certificate diubah tetapi listener belum restart;
- reverse proxy TLS membuat engineer lupa TLS internal masih aktif/bermasalah.

### 4.6 `logs/`

Folder ini berisi server logs.

Contoh:

```text
logs/server.log
```

Dalam production, log strategy harus jelas:

- apakah log tetap file lalu dikirim agent?
- apakah log diarahkan ke stdout di container?
- apakah rotation aktif?
- apakah retention mengikuti compliance?
- apakah sensitive data di-redact?
- apakah correlation ID tersedia?

Logging akan dibahas detail pada Part 20.

### 4.7 `applications/`

Folder ini berisi deployed applications atau referensi artifact yang sudah dikelola oleh GlassFish. Detail struktur dapat berbeda tergantung cara deploy.

Jangan menganggap deployment hanya copy WAR ke folder. GlassFish melakukan proses deployment:

- membaca metadata;
- melakukan annotation scanning;
- binding resources;
- generate artifacts;
- update domain config;
- register application ke target;
- mempersiapkan classloader;
- mengaktifkan context root.

Karena itu, manual delete folder aplikasi dapat membuat state domain tidak konsisten.

Gunakan:

```bash
asadmin undeploy <application-name>
```

bukan menghapus folder secara manual.

### 4.8 `generated/`

Folder ini berisi artifact yang dihasilkan server, misalnya hasil deployment processing, generated classes, stubs, JSP compilation, atau metadata runtime lain tergantung jenis aplikasi.

Jika terjadi masalah aneh setelah redeploy, kadang engineer membersihkan generated artifact saat domain offline. Namun ini harus dilakukan dengan prosedur hati-hati.

Pattern aman:

1. stop domain;
2. backup domain;
3. hapus generated cache tertentu sesuai kasus;
4. start domain;
5. redeploy atau observe regeneration.

### 4.9 `docroot/`

Ini document root default untuk virtual server. Jika tidak ada aplikasi default pada context root `/`, GlassFish bisa melayani konten default dari docroot.

Dalam production modern, biasanya request masuk ke aplikasi yang jelas, bukan mengandalkan docroot. Namun docroot tetap penting untuk memahami kenapa akses root kadang menampilkan halaman default GlassFish.

### 4.10 `lib/` pada domain

Domain-level `lib` dapat dipakai untuk library yang ingin tersedia pada domain. Ini berbeda dari application-level `WEB-INF/lib` atau `EAR/lib`.

Penggunaannya harus sangat hati-hati. Domain-level library dapat membuat aplikasi saling tergantung pada versi yang sama dan mempersulit isolasi.

Use case yang masih masuk akal:

- JDBC driver yang dipakai resource server;
- library integrasi tertentu yang memang domain-level;
- extension yang sengaja dikelola sebagai bagian runtime.

Namun untuk library aplikasi biasa, lebih aman dikemas bersama aplikasi.

### 4.11 `osgi-cache/`

GlassFish memiliki sejarah arsitektur modular yang terkait OSGi/HK2. Cache modul/runtime dapat muncul di domain.

Jika cache korup, server bisa gagal start atau berperilaku aneh. Tetapi menghapus cache tanpa pemahaman juga bukan rutinitas harian. Cache adalah state runtime yang biasanya bisa diregenerasi, tetapi prosedurnya harus dilakukan ketika server offline.

---

## 5. Installation Home vs Domain Directory

Ini salah satu pemisahan terpenting.

| Aspek | Installation Home | Domain Directory |
|---|---|---|
| Isi | binary GlassFish, modules, tools | config, logs, deployed apps, runtime state |
| Contoh | `/opt/glassfish8/glassfish` | `/opt/glassfish8/glassfish/domains/domain1` |
| Sifat ideal | immutable | mutable |
| Diubah saat deploy app? | seharusnya tidak | ya |
| Diubah saat configure JDBC? | seharusnya tidak | ya |
| Di-backup reguler? | cukup saat upgrade/baseline | ya, terutama config/keystore |
| Dapat dipakai banyak domain? | ya | satu domain tertentu |
| Risiko jika rusak | semua domain pada install itu | domain terkait |

Prinsip production-grade:

```text
Installation home = artifact runtime yang versioned
Domain directory   = state/config yang dikelola dan diaudit
Application WAR/EAR = release artifact yang immutable
```

Dalam container:

```text
Image layer        = installation home + mungkin pre-created domain + app
Runtime container  = active process + injected config/secrets + ephemeral logs/state
```

Dalam VM tradisional:

```text
/opt/glassfish/versions/glassfish-8.0.2/  = immutable install
/var/glassfish/domains/prod-domain/       = mutable domain
/var/log/glassfish/prod-domain/           = logs, bisa symlink/agent
```

---

## 6. Membuat Domain

Command umum:

```bash
asadmin create-domain mydomain
```

Secara default, domain dibuat di domain root default. Untuk custom location:

```bash
asadmin create-domain --domaindir /var/glassfish/domains mydomain
```

Namun opsi detail dapat berbeda antar versi. Biasakan selalu cek:

```bash
asadmin help create-domain
```

### 6.1 Kenapa membuat domain baru?

Alasan valid:

- ingin isolasi konfigurasi antar environment;
- ingin port berbeda;
- ingin resource/JDBC berbeda;
- ingin admin credential berbeda;
- ingin eksperimen tanpa merusak domain existing;
- ingin menjalankan beberapa runtime di mesin yang sama;
- ingin memisahkan workload berbeda.

Alasan yang kurang valid:

- setiap aplikasi dibuat domain sendiri tanpa alasan operasional;
- domain dijadikan cara menghindari dependency conflict yang seharusnya diselesaikan di packaging/classloading;
- domain dibuat karena tidak tahu cara undeploy/redeploy bersih.

### 6.2 Domain creation sebagai kontrak awal

Saat membuat domain, keputusan berikut penting:

- domain name;
- admin port;
- HTTP port;
- HTTPS port;
- admin user/password;
- master password;
- JDK yang dipakai;
- lokasi domain;
- apakah secure admin akan diaktifkan;
- apakah domain akan standalone atau bagian cluster;
- apakah domain akan dikelola sebagai cattle atau pet.

Untuk development lokal, default domain bisa cukup. Untuk production, domain creation harus scripted.

Contoh prinsip script:

```bash
#!/usr/bin/env bash
set -euo pipefail

GF_HOME=/opt/glassfish8/glassfish
DOMAIN_ROOT=/var/glassfish/domains
DOMAIN_NAME=prod-domain

${GF_HOME}/bin/asadmin create-domain \
  --domaindir "${DOMAIN_ROOT}" \
  "${DOMAIN_NAME}"
```

Di production real, script perlu password file, port assignment, secure admin, JVM options, resources, logging, dan validation.

---

## 7. Menjalankan dan Menghentikan Domain

Command dasar:

```bash
asadmin start-domain domain1
asadmin stop-domain domain1
asadmin restart-domain domain1
asadmin list-domains
```

Jika hanya ada satu domain, `start-domain` tanpa nama sering memakai default. Namun untuk production, sebutkan nama domain secara eksplisit.

Prefer:

```bash
asadmin start-domain prod-domain
```

Hindari:

```bash
asadmin start-domain
```

pada host yang mungkin punya lebih dari satu domain.

### 7.1 Apa yang terjadi saat `start-domain`?

Secara konseptual:

```text
1. asadmin dipanggil
2. asadmin menemukan domain directory
3. membaca konfigurasi domain
4. menentukan JVM/JDK yang dipakai
5. membangun command line JVM
6. memulai proses server
7. server bootstrap internal service
8. admin listener aktif
9. network listeners aktif
10. containers aktif
11. resources disiapkan
12. deployed applications diaktifkan
13. domain dianggap running
```

Jika gagal, sumber masalah bisa berada di banyak lapisan:

```text
filesystem → JDK → JVM option → domain.xml → port → module → resource → app deployment
```

### 7.2 Start bukan berarti aplikasi siap

`asadmin start-domain` sukses tidak selalu berarti semua aplikasi siap menerima traffic.

Kemungkinan:

- domain running tetapi app deployment gagal;
- HTTP listener aktif tetapi app context belum available;
- app aktif tetapi DB pool gagal connect saat request pertama;
- JMS resource belum valid;
- background initialization masih berjalan;
- cache warmup belum selesai.

Karena itu readiness production tidak boleh hanya berbunyi “process alive”. Minimal perlu:

- domain running;
- target HTTP port reachable;
- aplikasi context available;
- health endpoint aplikasi OK;
- dependency penting OK atau degraded secara eksplisit;
- log tidak menunjukkan deployment fatal error.

---

## 8. Memilih JDK: `JAVA_HOME`, `AS_JAVA`, dan JVM Options

GlassFish berjalan sebagai proses JVM. Maka JDK bukan detail kecil.

Ada beberapa level yang perlu dibedakan:

1. JDK untuk menjalankan `asadmin`.
2. JDK untuk menjalankan domain/server process.
3. JDK untuk compile aplikasi.
4. Target bytecode aplikasi.
5. API level Jakarta/Java EE yang dipakai aplikasi.

Kesalahan umum:

```text
Aplikasi dicompile Java 21, domain berjalan dengan Java 17 → UnsupportedClassVersionError.
```

Atau:

```text
GlassFish 8 butuh Java 21+, tetapi service startup masih menunjuk ke Java 17.
```

### 8.1 `JAVA_HOME`

`JAVA_HOME` sering dipakai shell dan tooling untuk menemukan JDK.

Contoh:

```bash
export JAVA_HOME=/usr/lib/jvm/jdk-21
export PATH=$JAVA_HOME/bin:$PATH
```

Namun dalam service production, environment variable dari shell interaktif tidak selalu berlaku. Systemd, Windows Service, container entrypoint, dan CI runner bisa punya environment sendiri.

### 8.2 `AS_JAVA`

GlassFish dapat memiliki konfigurasi JDK yang digunakan oleh server. Dalam beberapa instalasi, file konfigurasi seperti `asenv.conf` atau `asenv.bat` menyimpan nilai `AS_JAVA`.

Pola konseptual:

```text
AS_JAVA=/path/to/jdk
```

Pastikan sesuai versi GlassFish:

- GlassFish 5.x legacy biasanya terkait Java 8/Java EE 8 world.
- GlassFish 7.x Jakarta EE 10 membutuhkan Java modern sesuai release line.
- GlassFish 8.x membutuhkan baseline Java 21+.

### 8.3 JVM Options Domain

JVM options domain tersimpan dalam konfigurasi domain.

Contoh command:

```bash
asadmin create-jvm-options '-Xms2g'
asadmin create-jvm-options '-Xmx2g'
asadmin create-jvm-options '-XX:+UseG1GC'
```

Untuk Java modern, opsi perlu direview. Beberapa opsi Java 8 sudah tidak relevan, deprecated, atau berubah behavior.

Contoh risiko:

```text
-XX:PermSize=256m
```

Opsi ini relevan era PermGen lama, bukan Java modern. Jika masih ada di domain legacy, upgrade JDK bisa gagal atau warning.

Prinsip:

> Setiap upgrade JDK harus menyertakan review JVM options domain.

---

## 9. Anatomy Bootstrap: Dari Disk ke Process

Mari kita lihat alur runtime lebih detail.

```text
[User/systemd/container]
        |
        v
[asadmin / launcher]
        |
        v
[Read install env + domain config]
        |
        v
[Build JVM command]
        |
        v
[JVM process starts]
        |
        v
[GlassFish bootstrap]
        |
        v
[HK2/service registry/module system]
        |
        v
[Admin service + config model]
        |
        v
[Network listeners / containers / resources]
        |
        v
[Applications deployed and enabled]
        |
        v
[Runtime serving traffic]
```

### 9.1 OS Process

Pada runtime aktif, GlassFish adalah proses Java.

Di Linux:

```bash
ps -ef | grep glassfish
jps -lv
```

Bisa terlihat proses Java dengan command line panjang yang berisi:

- classpath/module reference;
- domain name;
- domain dir;
- JVM options;
- system properties;
- logging config;
- server main class.

Engineer production harus nyaman membaca command line proses, karena sering mengungkap:

- JDK mana yang dipakai;
- heap size aktual;
- GC options aktual;
- system property environment;
- path domain aktual;
- duplicate/invalid options.

### 9.2 Port Binding

Saat startup, GlassFish bind ke port yang dikonfigurasi. Jika port sudah dipakai, startup bisa gagal.

Cek port:

```bash
# Linux
ss -ltnp | grep 8080
ss -ltnp | grep 4848

# Alternatif
lsof -i :8080
```

Di Windows:

```powershell
netstat -ano | findstr :8080
```

Failure umum:

```text
Address already in use
```

Penyebab:

- domain lain sudah memakai port sama;
- proses lama belum mati;
- service duplicate start;
- container port conflict;
- wrong config environment.

### 9.3 Module Bootstrap

GlassFish bukan satu monolit class biasa. Ia terdiri dari banyak modul internal. Saat startup, runtime memuat service-service yang dibutuhkan.

Kegagalan module bootstrap bisa muncul sebagai:

- class not found;
- service not found;
- injection failure internal;
- HK2 error;
- corrupted OSGi cache;
- incompatible module after manual patch.

Jika error seperti ini muncul setelah seseorang “menambahkan JAR ke modules”, curigai modifikasi installation home.

### 9.4 Config Model Loading

`domain.xml` dibaca dan dipetakan ke model konfigurasi internal.

Jika XML invalid atau berisi konfigurasi yang tidak kompatibel dengan versi server, domain bisa gagal start.

Contoh kasus:

- domain dibuat di versi lama lalu dipakai dengan server baru tanpa migration path;
- atribut konfigurasi tidak dikenal;
- elemen descriptor lama tidak valid;
- manual edit menghasilkan XML malformed;
- merge conflict dari Git masuk ke `domain.xml`.

### 9.5 Resource Initialization

GlassFish memiliki banyak resource:

- JDBC pools;
- JDBC resources;
- JMS connection factories;
- JMS destinations;
- mail resources;
- connector resources;
- custom resources;
- security realms.

Tidak semua resource selalu connect penuh saat startup. Beberapa validasi bisa lazy. Karena itu startup sukses tidak menjamin resource sehat.

Contoh:

```text
Domain started successfully, tetapi request pertama ke endpoint yang memakai DB gagal karena password DB salah.
```

Solusi production:

- aktifkan validation sesuai kebutuhan;
- gunakan health check aplikasi yang benar-benar menyentuh dependency penting;
- cek pool ping command;
- jangan hanya percaya process status.

### 9.6 Application Activation

Jika aplikasi sudah dideploy dan enabled, GlassFish akan mengaktifkannya saat startup.

Pada tahap ini bisa terjadi:

- classloading error;
- CDI deployment failure;
- JPA persistence unit error;
- EJB initialization error;
- servlet context listener failure;
- resource injection failure;
- descriptor mismatch;
- incompatible namespace `javax`/`jakarta`.

Jika satu aplikasi gagal deploy, perilaku domain tergantung jenis failure dan konfigurasi. Domain bisa tetap hidup tetapi aplikasi tidak tersedia.

---

## 10. Installation Pattern untuk Berbagai Environment

### 10.1 Local Development

Tujuan local dev:

- cepat start/stop;
- mudah deploy;
- mudah inspect log;
- port tidak bentrok;
- bisa reset domain.

Pattern:

```text
~/tools/glassfish8/glassfish
~/tools/glassfish8/glassfish/domains/domain1
```

Command:

```bash
asadmin start-domain domain1
asadmin deploy build/libs/myapp.war
asadmin list-applications
asadmin undeploy myapp
asadmin stop-domain domain1
```

Di Windows PowerShell:

```powershell
$GF_HOME = "C:\tools\glassfish8\glassfish"
& "$GF_HOME\bin\asadmin.bat" start-domain domain1
```

Local boleh lebih fleksibel, tetapi tetap biasakan:

- tidak mengedit `domain.xml` tanpa alasan;
- mencatat command konfigurasi;
- tidak menaruh random JAR di `modules`;
- memahami port yang dipakai.

### 10.2 Shared Development Server

Tujuan shared dev:

- beberapa developer/tester memakai server sama;
- konfigurasi cukup stabil;
- deployment sering;
- debugging masih mungkin.

Risiko:

- conflict deployment;
- config berubah tanpa koordinasi;
- dependency app saling mengganggu;
- log terlalu ramai;
- domain menjadi snowflake.

Pattern:

```text
/opt/glassfish/glassfish8/glassfish       # install
/var/glassfish/domains/dev-domain        # domain
/var/glassfish/artifacts                 # uploaded release artifacts
/var/log/glassfish/dev-domain            # logs or symlink
```

Rekomendasi:

- semua perubahan config via script;
- deployment memakai CI job atau script standar;
- jangan deploy manual dari banyak laptop tanpa naming discipline;
- gunakan environment-specific app config;
- backup domain config sebelum perubahan besar.

### 10.3 SIT/UAT

Tujuan:

- mirip production;
- controlled release;
- audit trail;
- reproducibility;
- troubleshooting realistis.

Pattern:

```text
installation home versioned
runtime domain scripted
application artifact promoted from build pipeline
config injected from controlled source
```

Yang harus dihindari:

```text
UAT dikonfigurasi manual berbeda jauh dari production.
```

Karena jika UAT tidak mirip production, UAT tidak memvalidasi production risk.

### 10.4 Production VM / Bare Metal

Tujuan:

- stabil;
- reproducible;
- secure;
- auditable;
- patchable;
- recoverable.

Recommended shape:

```text
/opt/glassfish/releases/glassfish-8.0.2/glassfish
/opt/glassfish/current -> /opt/glassfish/releases/glassfish-8.0.2/glassfish
/var/glassfish/domains/prod-domain
/var/glassfish/backups
/var/log/glassfish/prod-domain
```

Kenapa pakai symlink `current`?

- upgrade lebih terkontrol;
- rollback installation home lebih mudah;
- domain bisa tetap dipertahankan atau dimigrasikan;
- script tidak perlu mengubah path setiap release.

Namun hati-hati: domain yang sudah dimigrasikan ke versi baru tidak selalu aman dijalankan kembali dengan versi lama.

### 10.5 Container / Kubernetes

Dalam container, prinsip berubah:

```text
Container image harus immutable.
Runtime state harus minimal.
Config/secrets harus diinjeksi.
Logs idealnya keluar ke stdout/stderr atau collector.
```

Pattern Docker konseptual:

```dockerfile
FROM eclipse-temurin:21-jdk

ENV GLASSFISH_HOME=/opt/glassfish/glassfish
COPY glassfish8 /opt/glassfish
COPY target/myapp.war /opt/app/myapp.war

RUN $GLASSFISH_HOME/bin/asadmin start-domain domain1 && \
    $GLASSFISH_HOME/bin/asadmin deploy /opt/app/myapp.war && \
    $GLASSFISH_HOME/bin/asadmin stop-domain domain1

EXPOSE 8080
CMD ["/opt/glassfish/glassfish/bin/asadmin", "start-domain", "--verbose", "domain1"]
```

Catatan:

- contoh ini konseptual, bukan final production Dockerfile;
- `--verbose` sering dipakai agar proses berjalan foreground dan log terlihat;
- secrets tidak boleh dibake ke image;
- domain config bisa dibuat saat build atau saat startup tergantung strategi;
- readiness harus berdasarkan aplikasi, bukan hanya port.

Containerization akan dibahas lebih dalam di Part 26.

---

## 11. Immutable vs Mutable: Prinsip Operasional yang Sering Diabaikan

Production-grade runtime harus punya batas jelas.

### 11.1 Immutable

Yang idealnya immutable:

- GlassFish installation ZIP/extract;
- application WAR/EAR;
- bootstrap script versioned;
- base Docker image;
- release artifact;
- migration script;
- documented config command.

### 11.2 Mutable

Yang memang berubah:

- domain runtime config;
- logs;
- generated artifacts;
- deployed application registry;
- temporary files;
- session state jika dipakai;
- broker state jika embedded;
- runtime caches.

### 11.3 Dangerous Mutable

Yang berubah tetapi harus sangat dikontrol:

- `domain.xml`;
- keystore/truststore;
- admin credentials;
- password aliases;
- domain-level libraries;
- JDBC driver placement;
- JVM options;
- thread/pool sizing.

Rule:

> Semakin besar blast radius sebuah file, semakin ketat proses perubahannya.

---

## 12. Deployment Bukan Copy File

Pada server ringan seperti static server, deployment bisa berarti copy file. Pada GlassFish, deployment adalah transaksi konfigurasi/runtime.

Command:

```bash
asadmin deploy myapp.war
```

Konseptual langkah:

```text
1. menerima artifact
2. menentukan application name
3. membaca manifest/descriptors
4. scanning annotation
5. menentukan module type
6. mempersiapkan classloader
7. bind resource references
8. generate required artifacts
9. register app di domain config
10. enable app di target
11. start lifecycle callbacks/listeners
12. expose context root / endpoints
```

Implikasi:

- deploy bisa gagal walaupun file WAR valid secara ZIP;
- deploy bisa berhasil tetapi runtime request gagal;
- undeploy harus membersihkan registry dan runtime state;
- manual replace file bisa menyebabkan state tidak konsisten;
- deployment time dapat dipengaruhi annotation scanning dan classpath.

Contoh command penting:

```bash
asadmin list-applications
asadmin deploy --contextroot /myapp myapp.war
asadmin undeploy myapp
asadmin redeploy myapp.war
```

Pada part deployment nanti, kita akan bahas detail WAR/EAR/RAR dan descriptor.

---

## 13. Membaca Struktur Domain sebagai Engineer Troubleshooting

Ketika masuk ke server bermasalah, jangan langsung restart. Baca anatomy.

### 13.1 Pertanyaan awal

```text
1. GlassFish version berapa?
2. JDK yang dipakai runtime apa?
3. Domain mana yang running?
4. Domain dir di mana?
5. Port apa yang aktif?
6. Aplikasi apa yang dideploy?
7. Resource apa yang dikonfigurasi?
8. Kapan terakhir domain.xml berubah?
9. Kapan terakhir WAR/EAR berubah?
10. Error pertama di server.log apa?
```

### 13.2 Command inspection awal

```bash
asadmin version
asadmin list-domains
asadmin list-applications
asadmin list-jdbc-connection-pools
asadmin list-jdbc-resources
asadmin list-jms-resources
```

Beberapa command bisa berbeda tergantung versi/fitur, jadi gunakan:

```bash
asadmin help
asadmin help <command>
```

### 13.3 File inspection awal

```bash
# lokasi domain
ls -la $DOMAIN_DIR

# konfigurasi
ls -la $DOMAIN_DIR/config

# log terbaru
tail -n 300 $DOMAIN_DIR/logs/server.log

# deployed applications
ls -la $DOMAIN_DIR/applications

# generated artifacts
ls -la $DOMAIN_DIR/generated
```

### 13.4 Jangan langsung hapus cache

Ada budaya troubleshooting buruk:

```text
hapus generated, hapus osgi-cache, restart, coba lagi
```

Kadang berhasil, tetapi jika dilakukan tanpa diagnosis, root cause hilang.

Urutan lebih baik:

1. capture log;
2. capture config diff;
3. capture deployment artifact checksum;
4. capture process/JDK info;
5. baru lakukan tindakan korektif;
6. dokumentasikan kenapa tindakan itu valid.

---

## 14. `domain.xml`: Source of Truth atau Generated State?

Ini pertanyaan penting.

Jawaban yang lebih akurat:

> `domain.xml` adalah persisted configuration state milik GlassFish domain. Ia bisa menjadi salah satu source of truth operasional, tetapi sebaiknya bukan satu-satunya source of truth engineering.

Mengapa?

Jika hanya menyimpan `domain.xml`, kita tahu state akhir, tetapi tidak selalu tahu:

- alasan perubahan;
- siapa mengubah;
- command apa yang dipakai;
- apakah perubahan valid untuk semua environment;
- apakah secret aman;
- apakah perubahan bisa direplay;
- apakah perubahan kompatibel dengan versi baru.

Model yang lebih baik:

```text
Git repository:
  - bootstrap scripts
  - asadmin config scripts
  - environment templates
  - documented defaults
  - expected domain.xml snapshot/diff

Runtime server:
  - active domain.xml
  - logs
  - generated runtime state
```

Dengan kata lain:

```text
Desired config = scripts/templates in Git
Actual config  = domain.xml/runtime inspection
Drift          = difference between desired and actual
```

---

## 15. Backup dan Restore Domain

Domain directory berisi banyak hal penting:

- `domain.xml`;
- keystore/truststore;
- admin credential files;
- deployed app registry;
- generated files;
- logs;
- possibly runtime state.

Namun backup strategy harus membedakan **apa yang harus direstore** dan **apa yang bisa diregenerate**.

### 15.1 Yang wajib diprioritaskan

```text
config/domain.xml
config/keystore/truststore
config/admin/security files
password aliases / master password process
asadmin configuration scripts
application artifacts from artifact repository
```

### 15.2 Yang sering tidak perlu sebagai primary restore source

```text
logs              → penting untuk audit/troubleshooting, bukan restore config
 generated         → bisa diregenerate dalam banyak kasus
applications copy → sebaiknya artifact repository menjadi sumber utama
osgi-cache         → cache runtime
```

### 15.3 Backup sebelum perubahan besar

Sebelum:

- upgrade GlassFish;
- upgrade JDK;
- migrasi namespace;
- mengubah keystore;
- mengubah JDBC pool besar;
- mengubah thread pool;
- mengganti domain config;
- melakukan mass redeploy.

Lakukan:

```bash
cp -a domain1 domain1.backup-$(date +%Y%m%d-%H%M%S)
```

Atau gunakan mekanisme backup domain jika tersedia pada versi/command yang digunakan.

Tetapi backup manual harus memperhatikan:

- domain sebaiknya stop untuk consistent backup;
- file permission dipertahankan;
- owner/group dipertahankan;
- secret tidak bocor;
- backup terenkripsi bila mengandung credential.

---

## 16. File Permission dan OS User

GlassFish production sebaiknya tidak berjalan sebagai `root`.

Pattern:

```text
user: glassfish
group: glassfish
installation home: owned by root or deployment user, read-only for glassfish
 domain dir: owned by glassfish
logs: writable by glassfish
```

Contoh Linux:

```bash
useradd --system --home /var/lib/glassfish --shell /usr/sbin/nologin glassfish
chown -R root:root /opt/glassfish/releases/glassfish-8.0.2
chown -R glassfish:glassfish /var/glassfish/domains/prod-domain
```

Tujuannya:

- proses runtime bisa menulis domain/log;
- runtime tidak bisa memodifikasi binary installation sembarangan;
- kompromi aplikasi tidak langsung mengubah server modules;
- audit lebih jelas.

Anti-pattern:

```text
chmod -R 777 glassfish
```

Ini menyelesaikan error permission jangka pendek tetapi membuka risiko besar.

---

## 17. Service Manager: systemd / Windows Service / Container Entrypoint

### 17.1 systemd

Contoh konseptual unit systemd:

```ini
[Unit]
Description=Eclipse GlassFish Domain prod-domain
After=network.target

[Service]
Type=forking
User=glassfish
Group=glassfish
Environment="JAVA_HOME=/usr/lib/jvm/jdk-21"
Environment="GF_HOME=/opt/glassfish/current"
ExecStart=/opt/glassfish/current/bin/asadmin start-domain --domaindir /var/glassfish/domains prod-domain
ExecStop=/opt/glassfish/current/bin/asadmin stop-domain --domaindir /var/glassfish/domains prod-domain
Restart=on-failure
RestartSec=10
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Catatan:

- sesuaikan opsi dengan versi command;
- `Type=forking` tergantung cara start;
- di container lebih baik foreground;
- environment harus eksplisit;
- limit file descriptor penting untuk server.

### 17.2 Windows Service

Di Windows, pastikan:

- service memakai JDK benar;
- user service punya permission domain dir;
- path tidak bergantung pada shell developer;
- log location jelas;
- port tidak bentrok;
- antivirus tidak mengunci generated/app files.

### 17.3 Container Entrypoint

Dalam container, proses utama harus tetap hidup di foreground. Jika `asadmin start-domain` melakukan fork lalu command selesai, container bisa exit. Karena itu gunakan mode verbose/foreground sesuai dukungan versi.

Konsep:

```bash
exec asadmin start-domain --verbose domain1
```

---

## 18. Runtime Anatomy dan Reverse Proxy

Dalam production, GlassFish jarang langsung terekspos internet. Biasanya ada:

```text
Client
  → CDN/WAF
  → Load Balancer
  → Reverse Proxy / Ingress
  → GlassFish HTTP listener
  → Application
  → DB/JMS/External systems
```

Implikasi instalasi:

- GlassFish port internal bisa 8080;
- public HTTPS terminate di load balancer;
- aplikasi harus tahu original scheme jika generate redirect URL;
- secure cookie harus benar;
- access log harus menangkap client IP yang benar;
- health check harus tidak terlalu berat;
- admin port tidak boleh exposed publik.

Jangan pernah menganggap:

```text
GlassFish HTTP listener port = public port
```

Keduanya bisa berbeda.

---

## 19. Common Installation and Layout Failure Modes

### 19.1 Salah JDK

Gejala:

```text
UnsupportedClassVersionError
Unrecognized VM option
GlassFish fails to start
```

Diagnosis:

```bash
java -version
asadmin version
ps -ef | grep java
```

Root cause:

- service memakai JDK berbeda dari shell;
- `JAVA_HOME` salah;
- `AS_JAVA` salah;
- aplikasi dicompile bytecode lebih tinggi;
- GlassFish version butuh Java lebih baru.

### 19.2 Port conflict

Gejala:

```text
Address already in use
Domain fails to start
```

Diagnosis:

```bash
ss -ltnp | grep 8080
ss -ltnp | grep 4848
asadmin list-domains
```

Root cause:

- domain lain hidup;
- proses zombie;
- service duplicate;
- port config copy dari environment lain.

### 19.3 Domain dir salah

Gejala:

```text
No domains found
Domain not found
Unexpected domain1 starts instead of intended domain
```

Diagnosis:

```bash
asadmin list-domains --domaindir /var/glassfish/domains
find / -name domain.xml 2>/dev/null
```

Root cause:

- domain dibuat di default path;
- script memakai `--domaindir` berbeda;
- symlink salah;
- deploy ke domain yang salah.

### 19.4 Permission error

Gejala:

```text
cannot write log
cannot create generated file
deployment failed writing directory
keystore access denied
```

Diagnosis:

```bash
ls -la domain-dir
ls -la domain-dir/config
ls -la domain-dir/logs
ps -ef | grep glassfish
```

Root cause:

- runtime user tidak punya permission;
- file dibuat manual oleh root;
- restore backup tidak preserve owner;
- shared volume permission mismatch.

### 19.5 Manual edit `domain.xml` merusak startup

Gejala:

```text
XML parse error
Config exception
Unknown element/attribute
Domain start fails after config change
```

Diagnosis:

```bash
xmllint --noout domain.xml
 diff domain.xml domain.xml.backup
 tail -n 300 logs/server.log
```

Root cause:

- XML invalid;
- merge conflict;
- typo dotted config;
- config dari versi berbeda;
- manual edit saat server running.

### 19.6 Library diletakkan di tempat salah

Gejala:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
LinkageError
```

Root cause:

- duplicate library di server lib dan app lib;
- JDBC driver tidak terlihat pool;
- `javax` dan `jakarta` campur;
- library app dimasukkan ke `modules`;
- transitive dependency konflik.

---

## 20. Practical Walkthrough: Local Anatomy Exercise

Latihan ini bertujuan membuat Anda “melihat” runtime, bukan hanya menjalankan.

### 20.1 Set variable

Linux/macOS:

```bash
export GF_HOME=$HOME/glassfish8/glassfish
export DOMAIN_NAME=domain1
export DOMAIN_DIR=$GF_HOME/domains/$DOMAIN_NAME
```

Windows PowerShell:

```powershell
$GF_HOME = "$HOME\glassfish8\glassfish"
$DOMAIN_NAME = "domain1"
$DOMAIN_DIR = "$GF_HOME\domains\$DOMAIN_NAME"
```

### 20.2 Inspect install home

```bash
ls -la $GF_HOME
ls -la $GF_HOME/bin
ls -la $GF_HOME/modules | head
```

Tanyakan:

- apakah `asadmin` ada?
- apakah `modules` ada?
- apakah `domains` ada?
- apakah ini installation home atau domain dir?

### 20.3 Start domain

```bash
$GF_HOME/bin/asadmin start-domain $DOMAIN_NAME
```

### 20.4 Inspect running state

```bash
$GF_HOME/bin/asadmin list-domains
$GF_HOME/bin/asadmin version
```

Linux:

```bash
ps -ef | grep glassfish | grep -v grep
ss -ltnp | grep -E '8080|4848|8181|8686'
```

### 20.5 Inspect domain directory

```bash
ls -la $DOMAIN_DIR
ls -la $DOMAIN_DIR/config
ls -la $DOMAIN_DIR/logs
 tail -n 100 $DOMAIN_DIR/logs/server.log
```

### 20.6 Inspect active config carefully

```bash
cp $DOMAIN_DIR/config/domain.xml /tmp/domain.xml.snapshot
```

Buka snapshot, bukan file live, untuk membaca:

- HTTP listener;
- admin listener;
- JVM options;
- resources;
- deployed apps;
- configs.

### 20.7 Stop domain

```bash
$GF_HOME/bin/asadmin stop-domain $DOMAIN_NAME
```

### 20.8 Reflection

Jawab:

1. Di mana binary server?
2. Di mana config domain?
3. Di mana log?
4. Port mana yang aktif?
5. JDK mana yang menjalankan domain?
6. Apa yang berubah setelah start?
7. Apa yang berubah setelah deploy app?

Jika bisa menjawab ini tanpa menebak, Anda sudah mulai melihat GlassFish sebagai runtime, bukan black box.

---

## 21. Production Layout Blueprint

Berikut blueprint konseptual untuk VM production.

```text
/opt/glassfish/
├── releases/
│   ├── glassfish-8.0.1/
│   └── glassfish-8.0.2/
├── current -> /opt/glassfish/releases/glassfish-8.0.2/glassfish
└── scripts/
    ├── create-domain.sh
    ├── configure-jvm.sh
    ├── configure-http.sh
    ├── configure-jdbc.sh
    ├── configure-logging.sh
    ├── deploy.sh
    └── smoke-test.sh

/var/glassfish/
├── domains/
│   └── prod-domain/
├── backups/
├── artifacts/
└── tmp/

/var/log/glassfish/
└── prod-domain/
```

Dengan prinsip:

- `/opt/glassfish/releases` read-only untuk runtime user;
- `/var/glassfish/domains` writable oleh runtime user;
- app artifact berasal dari artifact repository;
- config changes berasal dari scripts;
- backup domain sebelum upgrade;
- logs dikirim ke central logging;
- admin port dibatasi network.

---

## 22. Domain Naming Convention

Naming penting karena akan muncul di script, logs, runbook, monitoring, dan backup.

Contoh:

```text
aceas-dev-domain
aceas-sit-domain
aceas-uat-domain
aceas-prod-domain
```

Atau jika multi-node:

```text
prod-domain
prod-admin-domain
prod-batch-domain
```

Hindari nama generik untuk production:

```text
domain1
server
newdomain
test2
backupdomain
```

Naming yang buruk membuat incident response lambat.

---

## 23. Checklist Instalasi Production-Grade

### 23.1 Sebelum install

- [ ] Tentukan GlassFish major version.
- [ ] Tentukan JDK version.
- [ ] Validasi kompatibilitas app Java bytecode.
- [ ] Validasi `javax` vs `jakarta` namespace.
- [ ] Tentukan OS user runtime.
- [ ] Tentukan directory layout.
- [ ] Tentukan port matrix.
- [ ] Tentukan TLS termination model.
- [ ] Tentukan reverse proxy/load balancer model.
- [ ] Tentukan secret management.
- [ ] Tentukan log shipping.
- [ ] Tentukan backup/restore approach.

### 23.2 Saat install

- [ ] Extract GlassFish ke versioned installation path.
- [ ] Set ownership/permission.
- [ ] Configure JDK explicitly.
- [ ] Create domain dengan scripted command.
- [ ] Configure admin security.
- [ ] Configure JVM options.
- [ ] Configure HTTP/HTTPS listener.
- [ ] Configure JDBC/JMS/resource baseline.
- [ ] Configure logging.
- [ ] Deploy application.
- [ ] Run smoke test.
- [ ] Capture domain config snapshot.

### 23.3 Setelah install

- [ ] Validate process user.
- [ ] Validate port binding.
- [ ] Validate admin port exposure.
- [ ] Validate app health.
- [ ] Validate DB pool.
- [ ] Validate logs.
- [ ] Validate restart from service manager.
- [ ] Validate backup.
- [ ] Validate restore procedure in non-prod.
- [ ] Document final runtime anatomy.

---

## 24. Decision Framework: Di Mana Meletakkan Apa?

### 24.1 JDBC Driver

Pertanyaan:

- Apakah driver dipakai oleh GlassFish JDBC pool?
- Apakah semua aplikasi memakai versi sama?
- Apakah driver harus tersedia saat resource initialization?

Biasanya:

```text
Domain/server-level library location lebih masuk akal untuk JDBC driver yang dipakai pool.
```

Namun pastikan tidak ada versi driver lain di aplikasi yang konflik.

### 24.2 Application Library

Biasanya:

```text
WAR WEB-INF/lib atau EAR/lib
```

Karena isolasi aplikasi lebih baik.

### 24.3 Shared Internal Company Library

Jika library benar-benar shared:

- pertimbangkan packaging per app tetap lebih aman;
- domain-level library hanya jika versi dikontrol ketat;
- jangan campur library shared yang sering berubah dengan server runtime.

### 24.4 Environment Config

Jangan hardcode ke WAR jika berbeda per environment.

Opsi:

- JNDI resources;
- system properties;
- environment variables;
- external config file;
- secret manager;
- deployment descriptor mapping;
- MicroProfile Config jika tersedia/digunakan.

### 24.5 Logs

Untuk VM:

```text
domain-dir/logs → agent → central logging
```

Untuk container:

```text
stdout/stderr → container runtime → log pipeline
```

---

## 25. Operational Invariants

Invariants adalah hal yang harus selalu benar agar runtime sehat.

### 25.1 Installation invariant

```text
GlassFish installation home tidak boleh berubah tanpa release/patch process.
```

### 25.2 Domain invariant

```text
Setiap domain harus punya konfigurasi yang dapat direkonstruksi dari script/source-controlled baseline.
```

### 25.3 JDK invariant

```text
JDK runtime domain harus eksplisit dan kompatibel dengan GlassFish serta bytecode aplikasi.
```

### 25.4 Port invariant

```text
Setiap domain harus punya port matrix yang diketahui, tidak konflik, dan sesuai exposure policy.
```

### 25.5 Security invariant

```text
Admin listener tidak boleh terekspos tanpa kontrol network dan credential yang kuat.
```

### 25.6 Deployment invariant

```text
Aplikasi harus dideploy/undeploy melalui mekanisme GlassFish, bukan manipulasi manual folder runtime.
```

### 25.7 Backup invariant

```text
Sebelum perubahan besar, domain config dan secret material harus bisa dipulihkan.
```

### 25.8 Observability invariant

```text
Setelah start, engineer harus bisa menemukan log, port, process, JDK, domain dir, deployed apps, dan resource state dalam beberapa menit.
```

---

## 26. Anti-Pattern yang Harus Dihindari

### 26.1 Treat GlassFish folder as random mutable folder

Contoh:

```text
copy JAR ke modules, edit domain.xml, hapus generated, restart, tanpa catatan.
```

Dampak:

- tidak reproducible;
- sulit troubleshoot;
- upgrade berisiko;
- audit buruk.

### 26.2 Semua environment punya config manual berbeda

DEV, UAT, PROD menjadi snowflake. Bug hanya muncul di production karena UAT tidak merepresentasikan production.

### 26.3 Menganggap start-domain = ready

Process alive bukan readiness. App, resource, DB, JMS, dan health harus tervalidasi.

### 26.4 Menyimpan secrets di script plaintext

Terutama:

- DB password;
- admin password;
- keystore password;
- master password;
- API token.

Gunakan password file, alias, secret manager, atau injection mechanism sesuai environment.

### 26.5 Menghapus runtime state tanpa capture evidence

Saat incident, evidence penting. Hapus cache/log/generated tanpa capture bisa menghilangkan root cause.

### 26.6 Upgrade dengan menimpa installation home lama

Lebih aman gunakan versioned install path:

```text
glassfish-8.0.1
glassfish-8.0.2
current -> glassfish-8.0.2
```

Menimpa folder lama membuat rollback sulit.

---

## 27. Mini Case Study: Domain Gagal Start Setelah Upgrade JDK

### Situasi

Aplikasi sebelumnya berjalan di GlassFish lama dengan Java 8. Tim menginstall JDK 21 dan mengubah `JAVA_HOME`. Setelah restart, domain gagal start.

### Kemungkinan penyebab

1. GlassFish version tidak kompatibel dengan JDK 21.
2. JVM options lama tidak valid.
3. Aplikasi bytecode/dependency tidak kompatibel.
4. Library `javax`/`jakarta` mismatch jika server juga diganti.
5. `AS_JAVA` masih menunjuk JDK lama sehingga shell dan service berbeda.
6. TLS keystore format/password bermasalah di JDK baru.
7. Strong encapsulation Java modern memengaruhi reflective access library lama.

### Diagnosis step-by-step

```bash
java -version
asadmin version
ps -ef | grep java
cat glassfish/config/asenv.conf
 tail -n 300 domain-dir/logs/server.log
```

Lalu cek JVM options:

```bash
asadmin list-jvm-options
```

Jika domain tidak bisa start, baca `domain.xml` snapshot untuk JVM options.

### Kesimpulan engineering

Upgrade JDK bukan operasi tunggal. Ia menyentuh:

```text
server compatibility
JVM options
application bytecode
reflection behavior
TLS/security provider
third-party libraries
service manager environment
```

Karena itu harus diperlakukan sebagai migration event.

---

## 28. Mini Case Study: Aplikasi Dideploy tetapi 404

### Situasi

`asadmin deploy myapp.war` sukses. Tetapi akses:

```text
http://server:8080/
```

menampilkan halaman default GlassFish atau 404.

### Penyebab mungkin

1. Context root bukan `/`.
2. WAR dideploy sebagai `/myapp`.
3. Aplikasi ditargetkan ke virtual server berbeda.
4. App disabled.
5. Deployment sukses sebagian tetapi web module tidak aktif.
6. Reverse proxy path salah.
7. Health check mengakses path salah.

### Diagnosis

```bash
asadmin list-applications
asadmin show-component-status myapp
```

Cek log deployment:

```bash
grep -i "myapp" domain-dir/logs/server.log | tail -n 100
```

Cek context root dari deployment command atau descriptor.

### Lesson

URL aplikasi dibentuk oleh:

```text
scheme + host + port + context-root + servlet/JAX-RS mapping
```

GlassFish running di port 8080 tidak berarti aplikasi tersedia di `/`.

---

## 29. Mini Case Study: Deploy Gagal karena JDBC Driver

### Situasi

Aplikasi memakai JPA persistence unit yang refer ke datasource:

```text
jdbc/MyDS
```

Deployment gagal karena datasource tidak bisa dibuat atau driver class tidak ditemukan.

### Penyebab mungkin

1. JDBC pool belum dibuat.
2. JDBC resource belum dibuat.
3. JNDI name berbeda.
4. Driver JAR tidak tersedia untuk server resource.
5. Driver class name salah.
6. App membawa driver versi lain yang konflik.
7. DB URL/password salah.

### Diagnosis

```bash
asadmin list-jdbc-connection-pools
asadmin list-jdbc-resources
asadmin ping-connection-pool <pool-name>
```

Cek server log:

```bash
grep -i "jdbc\|datasource\|ClassNotFound\|SQLException" domain-dir/logs/server.log | tail -n 200
```

### Lesson

JDBC pool adalah resource server. Aplikasi hanya melakukan lookup/injection resource. Jika server tidak bisa melihat driver atau resource tidak benar, aplikasi tidak bisa berjalan walaupun kode JPA-nya benar.

---

## 30. Dari “Bisa Jalan” ke “Bisa Dioperasikan”

Level engineer dalam memahami GlassFish installation bisa dibedakan:

### Level 1 — Bisa jalan

- unzip;
- start domain;
- deploy WAR;
- buka browser.

### Level 2 — Bisa konfigurasi

- ubah port;
- buat JDBC pool;
- lihat log;
- undeploy/redeploy;
- pakai admin console.

### Level 3 — Bisa otomasi

- create domain scripted;
- configure resources scripted;
- deploy via CI/CD;
- environment config reproducible;
- backup/restore config.

### Level 4 — Bisa troubleshoot production

- baca process/JDK/domain anatomy;
- diagnosis startup failure;
- diagnosis port/resource/classloading issue;
- capture evidence;
- root cause analysis.

### Level 5 — Bisa design runtime platform

- immutable install;
- domain lifecycle strategy;
- security baseline;
- observability baseline;
- upgrade/rollback strategy;
- container/VM topology;
- operational invariants.

Target seri ini adalah Level 5.

---

## 31. Checklist Pemahaman Part 2

Anda dianggap memahami part ini jika bisa menjelaskan:

- beda `as-install`, `domain-root-dir`, `domain-dir`, dan `instance-dir`;
- kenapa installation home sebaiknya immutable;
- kenapa domain directory adalah mutable runtime state;
- fungsi utama `domain.xml`;
- risiko edit manual `domain.xml`;
- apa yang terjadi saat `asadmin start-domain`;
- kenapa process alive bukan readiness;
- bagaimana memilih JDK runtime;
- kenapa `JAVA_HOME` shell bisa berbeda dari JDK service;
- di mana log GlassFish berada;
- kenapa deployment bukan sekadar copy WAR;
- bagaimana membaca port, process, config, dan deployed apps;
- bagaimana membedakan app failure, resource failure, dan server startup failure;
- bagaimana membuat layout production yang auditable dan recoverable.

---

## 32. Practice Questions

Jawab dengan reasoning, bukan hafalan.

1. Mengapa lebih aman memisahkan `/opt/glassfish/releases/...` dan `/var/glassfish/domains/...`?
2. Apa risiko menjalankan GlassFish sebagai `root`?
3. Mengapa `domain.xml` tidak ideal dijadikan satu-satunya source of truth?
4. Jika `asadmin start-domain` sukses tetapi aplikasi 404, apa saja kemungkinan penyebabnya?
5. Jika deployment gagal karena `ClassNotFoundException` pada JDBC driver, di mana Anda akan memeriksa terlebih dahulu?
6. Mengapa upgrade JDK bisa gagal walaupun kode aplikasi tidak berubah?
7. Apa bedanya domain-level library dan application-level library?
8. Apa yang harus dibackup sebelum upgrade GlassFish?
9. Apa indikator bahwa environment UAT adalah snowflake dan tidak bisa dipercaya untuk validasi production?
10. Dalam container, mengapa proses GlassFish perlu berjalan foreground?

---

## 33. Ringkasan Mental Model

GlassFish bukan hanya folder hasil unzip dan bukan hanya proses Java.

Ia adalah kombinasi dari:

```text
JDK
  + GlassFish installation home
  + domain configuration/state
  + deployed application artifacts
  + external resources
  + OS/network/security constraints
```

Kesalahan paling mahal biasanya muncul saat boundary ini kabur:

- library aplikasi dimasukkan ke server module;
- config domain diedit manual tanpa script;
- JDK shell berbeda dari JDK service;
- process running dianggap app ready;
- domain backup tidak mencakup keystore;
- deployment dilakukan dengan manipulasi folder;
- production environment menjadi snowflake.

Engineer top-level selalu bertanya:

```text
Apa source of truth-nya?
Apa runtime state-nya?
Apa yang immutable?
Apa yang mutable?
Apa blast radius perubahan ini?
Bagaimana saya membuktikan domain ini bisa direkonstruksi?
```

Jika Anda bisa menjawab itu, Anda tidak lagi memperlakukan GlassFish sebagai black box.

---

## 34. Referensi Resmi yang Relevan

- Eclipse GlassFish 8 Quick Start Guide — default path, default ports, domain start/stop, admin console, deployment basics.  
  https://glassfish.org/docs/latest/quick-start-guide.html

- Eclipse GlassFish 8 Administration Guide — administrasi aplikasi, web container, domain/server administration, configuration topics.  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish 8 Reference Manual — `asadmin`, subcommands, administration concepts.  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse GlassFish project repository.  
  https://github.com/eclipse-ee4j/glassfish

---

## 35. Status Seri

Part ini adalah:

```text
Part 2 — Installation, Distribution Layout, dan Runtime Anatomy
```

Status:

```text
Belum selesai.
```

Part berikutnya:

```text
Part 3 — Domain Model: DAS, Instance, Node, Cluster, Config, dan Target
```

Di part berikutnya kita akan membedah model domain lebih dalam: apa itu DAS, instance, node, cluster, config, target, bagaimana relasinya, dan bagaimana cara berpikir tentang GlassFish sebagai control plane + data plane.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-001.md">⬅️ Part 1 — Version Matrix, Compatibility, dan Migration Map dari Java 8 sampai Java 25</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-003.md">Part 3 — Domain Model: DAS, Instance, Node, Cluster, Config, dan Target ➡️</a>
</div>
