# learn-java-deployment-runtime-release-delivery-engineering

# Part 0 — Deployment Mental Model: From Source Code to Running Production System

> **Target pembaca:** engineer Java yang sudah memahami Java core, JVM, Jakarta/Spring, build tools, testing, database, security, dan ingin naik ke level deployment engineering yang matang secara production, enterprise, dan regulatory.
>
> **Scope Java:** Java 8 sampai Java 25.
>
> **Fokus:** bukan cara menjalankan `java -jar` saja, melainkan cara berpikir end-to-end dari source code sampai sistem production yang aman, observable, rollbackable, auditable, dan operable.

---

## 0.1. Kenapa deployment layak dipelajari sedalam ini?

Banyak engineer melihat deployment sebagai tahap terakhir:

```text
code selesai -> build -> deploy -> done
```

Mental model seperti ini terlalu dangkal untuk sistem production. Dalam sistem nyata, terutama sistem enterprise, pemerintahan, finansial, enforcement, case management, atau platform yang punya audit trail dan workflow panjang, deployment bukan sekadar “memindahkan binary ke server”. Deployment adalah proses mengubah keadaan sistem yang sedang hidup.

Sistem yang sedang hidup memiliki:

- traffic aktif;
- user session;
- background job;
- message consumer;
- database transaction;
- cache state;
- scheduled task;
- token dan certificate;
- dependency ke service lain;
- observability pipeline;
- approval dan evidence;
- rollback constraint;
- regulatory expectation.

Karena itu deployment bukan aktivitas teknis kecil, tetapi **controlled state transition**.

```text
Current Production State
        |
        | controlled change
        v
Next Production State
```

Engineer biasa bertanya:

> “Bagaimana cara deploy aplikasi ini?”

Engineer senior bertanya:

> “Apa state yang berubah, siapa yang terdampak, bagaimana sistem membuktikan sehat, dan bagaimana kita kembali aman jika asumsi kita salah?”

Engineer top-tier bertanya lebih jauh:

> “Apa invariant yang tidak boleh rusak selama perubahan ini, dan desain deployment seperti apa yang membuat kegagalan menjadi terbatas, terdeteksi, dan dapat dipulihkan?”

Itulah fokus series ini.

---

## 0.2. Definisi dasar: build, package, release, deploy, run, operate

Sebelum masuk tool, kita perlu memisahkan istilah. Banyak incident terjadi karena tim mencampuradukkan istilah berikut.

### 0.2.1. Build

**Build** adalah proses mengubah source code menjadi output teknis yang bisa diuji dan dikemas.

Contoh output build:

- `.class` files;
- JAR;
- WAR;
- EAR;
- generated source;
- generated metadata;
- test report;
- coverage report;
- dependency lock;
- SBOM;
- checksum;
- container layer intermediate.

Build menjawab:

```text
Apakah source code ini bisa dikompilasi dan menghasilkan artifact yang konsisten?
```

Build yang baik harus:

- deterministic sebisa mungkin;
- tidak bergantung pada state laptop developer;
- tidak mengambil dependency dari lokasi tidak jelas;
- menghasilkan artifact dengan identitas jelas;
- bisa diulang di CI;
- bisa dibuktikan asal-usulnya.

Dalam Java, build sering dilakukan oleh Maven atau Gradle, tetapi deployment engineer tidak berhenti di Maven/Gradle. Build hanyalah awal dari delivery chain.

---

### 0.2.2. Package

**Package** adalah proses membentuk output build menjadi unit yang siap dipindahkan atau dijalankan di lingkungan target.

Contoh package:

- executable JAR;
- thin JAR + dependency directory;
- shaded/fat JAR;
- Spring Boot layered JAR;
- WAR untuk Tomcat;
- EAR untuk application server;
- Docker/OCI image;
- RPM/DEB package;
- tarball;
- custom runtime image via `jlink`;
- native image.

Package menjawab:

```text
Dalam bentuk apa aplikasi ini dikirim ke runtime environment?
```

Pilihan package menentukan banyak hal:

- startup time;
- ukuran artifact;
- classpath behavior;
- patching dependency;
- image layer cache;
- vulnerability scanning;
- debug capability;
- rollback speed;
- compatibility dengan platform.

Satu source code yang sama bisa menghasilkan beberapa bentuk package.

```text
Source Code
   |
   +--> app.jar
   +--> app.war
   +--> container image
   +--> jlink runtime image
   +--> native executable
```

Tidak ada bentuk package yang selalu benar. Yang ada adalah bentuk yang sesuai dengan constraint sistem.

---

### 0.2.3. Release

**Release** adalah kombinasi artifact dan konfigurasi yang disetujui untuk dijalankan pada lingkungan tertentu.

Konsep ini penting. Artifact saja bukan release.

Contoh:

```text
Artifact:
  aceas-case-service-2.14.7.jar

Config for UAT:
  DB_URL=uat-db
  OIDC_ISSUER=https://uat-idp
  FEATURE_X=false

Config for PROD:
  DB_URL=prod-db
  OIDC_ISSUER=https://prod-idp
  FEATURE_X=true
```

Artifact yang sama bisa menjadi release berbeda ketika digabung dengan konfigurasi berbeda.

The Twelve-Factor App menekankan pemisahan build, release, dan run: code menjadi build, build digabung dengan config menjadi release, lalu release dijalankan sebagai process. Referensi ini relevan karena membantu kita melihat release sebagai objek yang bisa ditelusuri dan dipromosikan antar environment, bukan aktivitas manual acak. [Twelve-Factor App — Build, release, run](https://12factor.net/build-release-run)

Release menjawab:

```text
Versi aplikasi dan konfigurasi mana yang secara resmi siap dijalankan di environment ini?
```

Release yang baik memiliki:

- artifact identity;
- config identity;
- source commit;
- build number;
- dependency snapshot;
- deployment manifest;
- approval evidence;
- rollback target;
- release note;
- migration state jika ada database change.

Dalam organisasi enterprise, release adalah objek audit.

---

### 0.2.4. Deploy

**Deploy** adalah proses menerapkan release ke environment target.

Deploy bisa berarti:

- copy JAR ke VM;
- update symlink;
- restart systemd service;
- upload WAR ke Tomcat;
- apply Kubernetes manifest;
- update Helm release;
- trigger Argo CD sync;
- switch blue-green traffic;
- run database migration;
- rotate secret;
- update app server domain config.

Deploy menjawab:

```text
Bagaimana release ini diterapkan ke environment secara aman?
```

Deploy bukan hanya “start versi baru”. Deploy mencakup transisi:

```text
old version serving traffic
        |
        | rollout
        v
new version serving traffic
```

Selama transisi, sistem bisa berada dalam keadaan campuran:

```text
Pod A: version 1.8.3
Pod B: version 1.8.3
Pod C: version 1.8.4
Database schema: expanded
Cache: mixed keys
Consumers: both old and new active
```

Banyak bug deployment hanya muncul pada state campuran, bukan ketika semua instance sudah versi baru.

---

### 0.2.5. Run

**Run** adalah fase ketika release menjadi process hidup.

Dalam Java, run berarti JVM process benar-benar berjalan:

```text
java [JVM options] -jar app.jar [app args]
```

atau:

```text
Tomcat process loads WAR
WildFly process deploys EAR
Kubernetes starts container process
systemd starts JVM service
```

Run menjawab:

```text
Bagaimana artifact + config + runtime menjadi process yang melayani workload?
```

Fase run dipengaruhi oleh:

- JDK/JRE distribution;
- Java version;
- JVM flags;
- OS user;
- CPU quota;
- memory limit;
- classpath/module path;
- environment variables;
- file permissions;
- network DNS;
- secrets;
- truststore;
- timezone;
- locale;
- signal handling;
- startup order;
- dependency readiness.

Aplikasi yang “berhasil start” belum tentu siap melayani traffic.

---

### 0.2.6. Operate

**Operate** adalah fase menjaga sistem tetap benar setelah running.

Operate mencakup:

- monitoring;
- alerting;
- log analysis;
- tracing;
- incident response;
- scaling;
- restart;
- rollback;
- certificate rotation;
- credential rotation;
- capacity review;
- patching;
- vulnerability remediation;
- audit evidence;
- disaster recovery;
- post-release verification.

Operate menjawab:

```text
Bagaimana kita tahu sistem masih benar, dan apa yang kita lakukan saat tidak benar?
```

Dalam sistem mature, deployment tidak selesai saat command berhasil. Deployment selesai ketika release terbukti sehat berdasarkan signal yang disepakati.

```text
Deploy command success != Production success
```

Deployment success harus dibuktikan oleh:

- health endpoint;
- readiness state;
- error rate;
- latency;
- saturation;
- logs;
- business transaction success;
- queue backlog;
- DB connection health;
- synthetic check;
- user-impact metric;
- rollback readiness.

---

## 0.3. Deployment sebagai state transition

Cara berpikir paling kuat untuk deployment adalah state transition.

```text
State A: production sebelum release
State B: production setelah release
Transition: deployment process
```

Setiap transition memiliki:

- precondition;
- action;
- postcondition;
- invariant;
- rollback path;
- observability signal.

Contoh sederhana:

```text
Precondition:
  - artifact sudah tersedia di registry
  - database migration sudah backward-compatible
  - secret sudah tersedia
  - dependency eksternal sehat

Action:
  - deploy version 2.3.1 secara rolling

Postcondition:
  - semua pod running version 2.3.1
  - readiness true
  - error rate tidak naik
  - queue backlog stabil

Invariant:
  - tidak ada request sukses palsu
  - tidak ada data hilang
  - tidak ada double-processing
  - audit trail tetap tercatat

Rollback:
  - kembali ke version 2.3.0
  - tidak rollback destructive DB migration

Observability:
  - metric, logs, traces, health check, synthetic test
```

Dengan model ini, deployment bukan ritual. Deployment menjadi perubahan state yang bisa dianalisis.

---

## 0.4. Invariant deployment

Invariant adalah hal yang harus tetap benar sebelum, selama, dan setelah deployment.

Dalam sistem Java production, invariant deployment biasanya lebih penting daripada tool yang dipakai.

### 0.4.1. Availability invariant

Sistem tetap tersedia untuk workload yang disepakati.

Contoh:

```text
Public API must continue serving read requests during rolling deployment.
```

Ini tidak selalu berarti zero downtime untuk semua fitur. Kadang sistem menerima maintenance window. Yang penting adalah invariant-nya eksplisit.

Pertanyaan yang harus dijawab:

- Apakah boleh downtime?
- Berapa lama?
- Untuk user mana?
- Untuk endpoint mana?
- Apakah background job boleh berhenti?
- Apakah consumer boleh pause?
- Apakah admin module boleh maintenance sementara public module tetap hidup?

---

### 0.4.2. Correctness invariant

Sistem tidak boleh menghasilkan hasil yang salah.

Availability tanpa correctness bisa lebih berbahaya daripada downtime.

Contoh:

```text
Case status transition must not skip mandatory approval state.
```

Selama deployment, versi lama dan baru bisa berjalan bersamaan. Jika state machine berubah, harus dipastikan versi lama dan baru kompatibel.

Pertanyaan:

- Apakah versi lama bisa membaca data yang ditulis versi baru?
- Apakah versi baru bisa membaca data lama?
- Apakah event schema backward-compatible?
- Apakah enum baru akan membuat versi lama crash?
- Apakah workflow state baru dikenali oleh reporting module lama?

---

### 0.4.3. Durability invariant

Data yang sudah diterima tidak hilang.

Contoh:

```text
Once an application submission is acknowledged, it must be persisted and recoverable.
```

Deployment risk:

- in-flight transaction mati saat pod termination;
- message sudah di-ack tapi belum dipersist;
- file upload temporary hilang;
- cache dianggap source of truth;
- scheduled job interrupted tanpa checkpoint;
- local disk dipakai di container ephemeral.

---

### 0.4.4. Idempotency invariant

Retry atau duplicate execution tidak boleh merusak data.

Deployment sering memicu retry:

- HTTP client retry karena connection reset;
- message broker redelivery;
- job restart;
- scheduler overlap;
- user double submit;
- Kubernetes restart;
- load balancer reconnect.

Invariant:

```text
Executing the same business operation more than once must not create inconsistent business state.
```

Ini sangat penting untuk:

- payment;
- case creation;
- license renewal;
- notification sending;
- email delivery;
- workflow transition;
- external system submission.

---

### 0.4.5. Observability invariant

Setiap release harus bisa diamati.

Contoh:

```text
Every request must expose version, correlation id, latency, outcome, and error category.
```

Tanpa observability, deployment menjadi tebakan.

Invariant observability:

- log tetap keluar setelah deploy;
- metric tetap scraped;
- trace tetap correlated;
- version label benar;
- health endpoint akurat;
- dashboard bisa membedakan old vs new version;
- alert tidak silent karena label berubah;
- audit trail tidak terputus.

---

### 0.4.6. Security invariant

Deployment tidak boleh menurunkan security posture.

Contoh:

```text
No production deployment may expose debug port, admin endpoint, plaintext secret, or unauthenticated actuator endpoint.
```

Deployment sering membuka celah karena:

- temporary debug flag lupa dimatikan;
- new image memakai root user;
- secret disisipkan ke image;
- default password app server;
- trust-all TLS untuk testing terbawa ke production;
- actuator exposed ke public network;
- JMX remote terbuka;
- old vulnerable base image.

---

### 0.4.7. Auditability invariant

Untuk sistem enterprise/regulatory, deployment harus meninggalkan bukti.

Contoh:

```text
For every production deployment, we can prove who approved it, what artifact ran, what config was used, when it changed, and what verification was performed.
```

Auditability mencakup:

- commit hash;
- build ID;
- artifact digest;
- image digest;
- approver;
- deployment time;
- environment;
- change request;
- rollback plan;
- post-deploy evidence;
- migration evidence;
- incident linkage jika ada.

---

## 0.5. Deployment pipeline sebagai supply chain

Deployment Java modern adalah supply chain.

```text
Developer workstation
   -> Git repository
   -> CI runner
   -> dependency repository
   -> build artifact
   -> artifact repository
   -> container image
   -> image registry
   -> deployment manifest
   -> CD controller
   -> runtime cluster/server
   -> observability system
   -> audit evidence
```

Setiap node dalam chain bisa menjadi sumber risiko.

### 0.5.1. Source risk

Risiko:

- branch salah;
- unreviewed commit;
- generated code tidak committed;
- secret masuk repository;
- dependency version tidak dikunci;
- build script berubah tanpa review.

Pertanyaan:

```text
Apakah artifact ini benar-benar berasal dari source yang disetujui?
```

---

### 0.5.2. Dependency risk

Risiko:

- dependency compromise;
- transitive CVE;
- repository spoofing;
- snapshot dependency berubah;
- dependency conflict;
- license issue.

Pertanyaan:

```text
Apakah dependency yang dibawa ke production diketahui dan dapat dipertanggungjawabkan?
```

---

### 0.5.3. Build risk

Risiko:

- build runner compromised;
- test dilewati;
- artifact manual dari laptop;
- environment CI berbeda;
- timestamp/randomness membuat artifact tidak reproducible;
- build memakai credential terlalu luas.

Pertanyaan:

```text
Apakah build environment dapat dipercaya?
```

---

### 0.5.4. Artifact risk

Risiko:

- artifact tertukar;
- version tag mutable;
- image tag `latest`;
- checksum tidak diverifikasi;
- artifact tanpa provenance;
- artifact lama overwritten.

Pertanyaan:

```text
Apakah artifact yang dideploy sama persis dengan artifact yang diuji?
```

---

### 0.5.5. Config risk

Risiko:

- config production salah;
- secret expired;
- feature flag salah;
- URL dependency menunjuk environment lain;
- truststore tidak update;
- config tidak versioned;
- precedence membingungkan.

Pertanyaan:

```text
Apakah release ini membawa konfigurasi yang benar untuk environment target?
```

---

### 0.5.6. Runtime risk

Risiko:

- JDK version beda;
- JVM option beda;
- timezone beda;
- OS CA bundle beda;
- CPU/memory limit beda;
- file permission beda;
- DNS behavior beda;
- container base image beda.

Pertanyaan:

```text
Apakah runtime environment cocok dengan asumsi aplikasi?
```

---

### 0.5.7. Operation risk

Risiko:

- health check false positive;
- rollback tidak diuji;
- log tidak terkirim;
- alert tidak aktif;
- migration irreversible;
- on-call tidak punya runbook;
- deployment evidence tidak lengkap.

Pertanyaan:

```text
Apakah tim bisa mendeteksi, memahami, dan memulihkan kegagalan release ini?
```

---

## 0.6. Mental model end-to-end Java deployment

Kita akan memakai model berikut sepanjang series.

```text
┌─────────────────────────────────────────────────────────────┐
│  1. Source                                                   │
│     code, tests, config templates, build scripts             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  2. Build                                                    │
│     compile, test, analyze, assemble                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  3. Package                                                  │
│     JAR, WAR, EAR, image, native binary, jlink runtime        │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  4. Publish                                                  │
│     artifact repo, container registry, checksum, SBOM         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  5. Release                                                  │
│     artifact + config + approval + migration plan             │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  6. Deploy                                                   │
│     rollout, traffic shift, migration, secret/config update   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  7. Run                                                      │
│     JVM process, app server, container, OS, network           │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  8. Verify                                                   │
│     health, smoke, metrics, logs, traces, business checks     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        v
┌─────────────────────────────────────────────────────────────┐
│  9. Operate                                                  │
│     observe, scale, patch, rotate, rollback, audit            │
└─────────────────────────────────────────────────────────────┘
```

Jika salah satu tahap tidak jelas, production risk meningkat.

---

## 0.7. Deployment boundary: apa saja yang sebenarnya berubah?

Deployment sering dibayangkan hanya mengganti aplikasi. Padahal satu deployment bisa mengubah banyak boundary.

### 0.7.1. Code boundary

Perubahan code:

- endpoint baru;
- business rule baru;
- state transition baru;
- validation baru;
- query baru;
- background job baru;
- message handler baru;
- external integration baru.

Pertanyaan:

```text
Apakah code baru kompatibel dengan state lama?
```

---

### 0.7.2. Binary boundary

Perubahan binary:

- dependency baru;
- dependency version berubah;
- shaded class berubah;
- generated bytecode berubah;
- classpath berubah;
- module descriptor berubah.

Pertanyaan:

```text
Apakah binary baru kompatibel dengan runtime dan dependency sekitarnya?
```

---

### 0.7.3. Runtime boundary

Perubahan runtime:

- Java 8 ke 11;
- Java 11 ke 17;
- Java 17 ke 21;
- Java 21 ke 25;
- vendor JDK berubah;
- JVM flags berubah;
- container base image berubah;
- OS library berubah.

Pertanyaan:

```text
Apakah aplikasi bergantung pada behavior runtime lama?
```

Contoh risiko:

- reflective access lebih ketat;
- TLS default berubah;
- removed/deprecated JVM option;
- GC default/behavior berubah;
- font/locale/CA certificate tidak tersedia;
- illegal access yang dulu warning menjadi error;
- internal JDK API tidak tersedia.

JDK 25 sudah menjadi Reference Implementation Java SE 25 dan GA pada 16 September 2025, sehingga Java 8–25 mencakup rentang perubahan runtime yang sangat besar. [OpenJDK JDK 25](https://openjdk.org/projects/jdk/25/)

---

### 0.7.4. Configuration boundary

Perubahan config:

- endpoint external service;
- database URL;
- pool size;
- timeout;
- feature flag;
- logging level;
- security policy;
- OAuth issuer;
- certificate path;
- scheduler cron;
- rate limit.

Pertanyaan:

```text
Apakah config baru benar untuk environment ini, dan apakah perubahan config membutuhkan restart?
```

The Twelve-Factor App juga menekankan config sebagai hal yang berbeda dari code dan sebaiknya dapat berubah antar deploy tanpa mengubah code. [Twelve-Factor App — Config](https://12factor.net/config)

---

### 0.7.5. Data boundary

Perubahan data:

- schema migration;
- new table;
- new column;
- enum value;
- index;
- constraint;
- data backfill;
- materialized view;
- stored procedure;
- reference data;
- audit table format.

Pertanyaan:

```text
Apakah versi aplikasi lama dan baru bisa hidup bersama dengan database state ini?
```

---

### 0.7.6. Traffic boundary

Perubahan traffic:

- route baru;
- load balancer target berubah;
- ingress rule berubah;
- DNS berubah;
- service mesh route berubah;
- canary percentage berubah;
- timeout/retry policy berubah.

Pertanyaan:

```text
Apakah traffic masuk ke instance yang benar-benar ready?
```

Kubernetes membedakan liveness, readiness, dan startup probe. Readiness menentukan apakah container siap menerima traffic, sementara liveness bisa membuat container direstart ketika dianggap tidak sehat. [Kubernetes — Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)

---

### 0.7.7. State boundary

Perubahan state:

- HTTP session;
- distributed cache;
- local cache;
- queue offset;
- job checkpoint;
- file temporary;
- in-flight workflow;
- lock;
- leader election;
- scheduler ownership.

Pertanyaan:

```text
Apa yang terjadi pada state saat process lama dimatikan dan process baru dinyalakan?
```

---

### 0.7.8. Operational boundary

Perubahan operasi:

- dashboard label berubah;
- metric name berubah;
- log format berubah;
- alert threshold berubah;
- runbook berubah;
- on-call procedure berubah;
- rollback target berubah.

Pertanyaan:

```text
Apakah operator masih bisa memahami sistem setelah release ini?
```

---

## 0.8. Deployment unit vs runtime unit vs scaling unit

Tiga hal ini sering disamakan, padahal berbeda.

### 0.8.1. Deployment unit

Deployment unit adalah unit yang dirilis bersama.

Contoh:

- satu JAR;
- satu WAR;
- satu container image;
- satu Helm chart;
- satu group microservices;
- satu app server domain package.

Pertanyaan:

```text
Apa yang berubah sebagai satu paket release?
```

---

### 0.8.2. Runtime unit

Runtime unit adalah process yang benar-benar berjalan.

Contoh:

- satu JVM process;
- satu Tomcat process;
- satu WildFly server;
- satu Kubernetes container;
- satu systemd service;
- satu native executable process.

Pertanyaan:

```text
Apa yang bisa crash, restart, dan mengonsumsi CPU/memory secara independen?
```

---

### 0.8.3. Scaling unit

Scaling unit adalah unit yang ditambah/dikurangi saat kapasitas berubah.

Contoh:

- Kubernetes pod replica;
- VM instance;
- app server node;
- consumer instance;
- worker process.

Pertanyaan:

```text
Apa yang diperbanyak untuk menangani load?
```

---

### 0.8.4. Contoh mismatch

Misalnya:

```text
Deployment unit: one EAR
Runtime unit: one app server process
Scaling unit: one VM node
```

Atau:

```text
Deployment unit: one container image
Runtime unit: one JVM process inside one container
Scaling unit: Kubernetes pod replica
```

Atau:

```text
Deployment unit: one Helm release with 8 microservices
Runtime unit: 8 different JVM processes
Scaling unit: each deployment independently
```

Maturity deployment meningkat ketika tim sadar unit mana yang sedang dibicarakan.

---

## 0.9. Deployment topology

Deployment selalu terjadi dalam topology tertentu. Topology menentukan failure mode.

### 0.9.1. Single process on VM

```text
VM
└── systemd
    └── java -jar app.jar
```

Kelebihan:

- sederhana;
- mudah debug;
- fewer moving parts;
- cocok untuk internal tool atau legacy app kecil.

Risiko:

- host failure berdampak besar;
- manual drift;
- rollback tergantung script;
- scaling lambat;
- dependency OS sering tidak eksplisit;
- secrets/config mudah tersebar.

---

### 0.9.2. Multiple JVMs on VM

```text
VM
├── service-a JVM
├── service-b JVM
├── worker JVM
└── scheduler JVM
```

Kelebihan:

- hemat VM;
- cocok untuk environment kecil.

Risiko:

- noisy neighbor;
- port conflict;
- memory contention;
- file permission campur;
- restart satu service bisa mengganggu yang lain;
- capacity planning sulit.

---

### 0.9.3. App server deployment

```text
VM / Container
└── Application Server
    ├── app-a.war
    ├── app-b.war
    └── shared datasource/JNDI/security realm
```

Kelebihan:

- managed resources;
- enterprise integration;
- centralized admin;
- cocok untuk WAR/EAR/Jakarta EE.

Risiko:

- shared classloader issue;
- shared resource coupling;
- hot deploy risk;
- server config drift;
- satu server process menampung banyak app;
- app lifecycle terikat container.

---

### 0.9.4. Container per JVM

```text
Kubernetes Pod
└── Container
    └── JVM process
```

Kelebihan:

- isolation lebih baik;
- immutable image;
- scaling dan rollout lebih standar;
- resource request/limit eksplisit;
- cocok untuk microservices.

Risiko:

- container memory misunderstood;
- probe salah;
- graceful shutdown salah;
- image vulnerability;
- ephemeral filesystem;
- distributed debugging lebih sulit.

Kubernetes sendiri mendeskripsikan platformnya sebagai sistem untuk otomasi deployment, scaling, dan management aplikasi containerized. [Kubernetes](https://kubernetes.io/)

---

### 0.9.5. Sidecar topology

```text
Pod
├── app container: JVM
├── sidecar: log/agent/proxy
└── init container: setup
```

Kelebihan:

- cross-cutting concern dipisahkan;
- service mesh;
- log/telemetry agent;
- init logic.

Risiko:

- lifecycle antar container berbeda;
- resource contention;
- startup order;
- shutdown order;
- sidecar failure mempengaruhi app;
- observability menjadi lebih kompleks.

---

## 0.10. Lifecycle Java process dalam deployment

Untuk menguasai deployment, kita perlu memahami lifecycle process.

```text
Image/artifact available
        |
        v
Process created
        |
        v
JVM initialized
        |
        v
Classes loaded
        |
        v
Application context starts
        |
        v
Dependencies connected
        |
        v
Ready for traffic
        |
        v
Serving workload
        |
        v
Draining
        |
        v
Shutdown hooks run
        |
        v
Process exits
```

### 0.10.1. Process created bukan ready

Saat process dibuat, belum tentu:

- port sudah bind;
- dependency connected;
- database migration selesai;
- cache warm;
- thread pool siap;
- scheduler aman;
- health endpoint benar.

Jika load balancer mengirim traffic terlalu awal, user terkena error.

---

### 0.10.2. Port open bukan ready

Banyak aplikasi membuka HTTP port sebelum semua dependency siap.

Contoh:

```text
HTTP server started
DB pool still initializing
Kafka consumer not assigned
Redis unavailable
Config refresh failed
```

Health endpoint yang hanya menjawab `200 OK` karena process hidup adalah readiness palsu.

---

### 0.10.3. Ready bukan healthy selamanya

Aplikasi bisa ready pada awalnya, lalu menjadi tidak sehat karena:

- DB pool exhausted;
- deadlock;
- external dependency down;
- disk full;
- thread pool saturated;
- memory leak;
- certificate expired;
- queue backlog exploding.

Karena itu readiness/liveness harus merepresentasikan kondisi yang tepat, bukan sekadar process alive.

---

### 0.10.4. Shutdown bukan kill

Shutdown production harus graceful.

Urutan ideal:

```text
1. Stop accepting new traffic
2. Mark instance not ready
3. Drain in-flight requests
4. Stop consumers/schedulers safely
5. Commit/rollback transactions
6. Flush telemetry/logs if needed
7. Close resources
8. Exit process
```

Kubernetes Pod deletion memiliki grace period; kubelet mencoba graceful shutdown sebelum memaksa proses berhenti. [Kubernetes — Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)

---

## 0.11. Deployment correctness: yang diuji bukan hanya artifact

Testing sebelum deploy penting, tetapi tidak cukup. Deployment memperkenalkan dimensi yang tidak selalu muncul di test suite.

### 0.11.1. Test artifact correctness

Pertanyaan:

```text
Apakah code bekerja sesuai test?
```

Validasi:

- unit test;
- integration test;
- contract test;
- performance test;
- security test;
- static analysis.

---

### 0.11.2. Test release correctness

Pertanyaan:

```text
Apakah artifact + config benar untuk environment ini?
```

Validasi:

- config validation;
- secret exists;
- endpoint reachable;
- database connectivity;
- migration dry-run;
- truststore validation;
- feature flag review;
- environment variable completeness.

---

### 0.11.3. Test rollout correctness

Pertanyaan:

```text
Apakah perubahan dari old ke new aman saat keduanya hidup bersamaan?
```

Validasi:

- rolling deployment test;
- backward compatibility check;
- canary;
- mixed-version test;
- old/new schema compatibility;
- queue consumer compatibility;
- session compatibility.

---

### 0.11.4. Test operational correctness

Pertanyaan:

```text
Apakah sistem bisa diamati dan dipulihkan?
```

Validasi:

- log present;
- metric present;
- trace present;
- alert works;
- dashboard updated;
- rollback tested;
- runbook reviewed;
- on-call knows failure mode.

---

## 0.12. The five planes of deployment

Deployment bisa dipahami sebagai lima plane.

```text
┌──────────────────────────────────────────────┐
│  Control Plane      deploy, orchestrate       │
├──────────────────────────────────────────────┤
│  Data Plane         user/business traffic     │
├──────────────────────────────────────────────┤
│  State Plane        DB, cache, queue, files    │
├──────────────────────────────────────────────┤
│  Identity Plane     secrets, certs, tokens     │
├──────────────────────────────────────────────┤
│  Observability Plane logs, metrics, traces     │
└──────────────────────────────────────────────┘
```

### 0.12.1. Control plane

Control plane adalah mekanisme yang melakukan deployment.

Contoh:

- Jenkins;
- GitHub Actions;
- GitLab CI;
- Azure DevOps;
- Argo CD;
- Flux;
- Kubernetes API;
- Helm;
- Ansible;
- app server admin API;
- manual script.

Failure control plane:

- deployment stuck;
- partial apply;
- wrong namespace;
- wrong inventory;
- rollback command gagal;
- manifest drift.

---

### 0.12.2. Data plane

Data plane adalah jalur traffic user atau service-to-service.

Contoh:

- HTTP API;
- gRPC;
- WebSocket;
- message consumer;
- batch input;
- scheduler execution.

Failure data plane:

- 5xx spike;
- timeout;
- connection reset;
- stale endpoint;
- wrong route;
- retry storm.

---

### 0.12.3. State plane

State plane adalah tempat state hidup.

Contoh:

- database;
- Redis;
- RabbitMQ/Kafka;
- object storage;
- local filesystem;
- distributed lock;
- session store;
- search index.

Failure state plane:

- schema mismatch;
- lock contention;
- queue redelivery;
- duplicate processing;
- cache poisoning;
- local state lost.

---

### 0.12.4. Identity plane

Identity plane adalah semua yang membuat aplikasi boleh terhubung dan dipercaya.

Contoh:

- DB password;
- OAuth client secret;
- mTLS certificate;
- truststore;
- keystore;
- service account;
- IAM role;
- API key;
- signing key.

Failure identity plane:

- expired certificate;
- wrong issuer;
- invalid trust chain;
- secret not mounted;
- token audience mismatch;
- permission denied.

---

### 0.12.5. Observability plane

Observability plane adalah signal untuk memahami sistem.

Contoh:

- logs;
- metrics;
- traces;
- audit events;
- deployment events;
- release markers;
- health reports.

Failure observability plane:

- silent failure;
- missing label;
- dashboard stale;
- alert not firing;
- correlation ID lost;
- no version dimension.

Top-tier engineer tidak hanya bertanya “aplikasinya jalan?” tetapi “kelima plane ini konsisten?”

---

## 0.13. Environment sebagai kontrak

Environment bukan tempat kosong. Environment adalah kontrak.

```text
Application expects environment
Environment provides capabilities
```

### 0.13.1. Runtime capability

Environment harus menyediakan:

- Java version;
- OS library;
- CPU architecture;
- memory;
- filesystem;
- network;
- DNS;
- certificates;
- timezone;
- locale;
- entropy source.

---

### 0.13.2. Dependency capability

Environment harus menyediakan:

- database;
- cache;
- broker;
- external API;
- identity provider;
- object storage;
- email server;
- reporting engine.

---

### 0.13.3. Operational capability

Environment harus menyediakan:

- log collection;
- metrics collection;
- tracing;
- alerting;
- backup;
- secret management;
- deployment access;
- rollback mechanism.

---

### 0.13.4. Governance capability

Environment enterprise harus menyediakan:

- approval workflow;
- change record;
- access control;
- audit evidence;
- segregation of duties;
- emergency process;
- production data protection.

Jika environment tidak menyediakan capability yang diasumsikan aplikasi, deployment akan rapuh.

---

## 0.14. Java-specific deployment concerns

Java punya karakteristik deployment yang berbeda dari runtime lain.

### 0.14.1. JVM process punya memory multi-region

Java bukan hanya heap.

Secara deployment, memory yang perlu dipikirkan:

- heap;
- metaspace;
- code cache;
- thread stacks;
- direct buffers;
- GC native structures;
- JIT compiler memory;
- mapped files;
- JNI/native libraries;
- agent overhead;
- libc allocator;
- app server overhead.

Jika container limit 1 GB lalu heap diset 1 GB, process bisa OOMKilled karena RSS melebihi limit.

---

### 0.14.2. Java startup punya fase kompleks

Startup bisa lambat karena:

- classloading;
- annotation scanning;
- dependency injection;
- JPA metamodel;
- Hibernate validation;
- TLS initialization;
- cache warmup;
- app server deployment scanning;
- bytecode enhancement;
- Spring context initialization;
- JIT warmup setelah startup.

Konsekuensi deployment:

- startup probe perlu realistis;
- readiness tidak boleh terlalu cepat;
- rolling update harus memperhitungkan warmup;
- autoscaling tidak instan.

---

### 0.14.3. Java dependency graph bisa sangat besar

Aplikasi Java enterprise mudah membawa ratusan dependency.

Risiko deployment:

- duplicate class;
- conflicting transitive dependency;
- classpath order issue;
- app server provided dependency conflict;
- old library incompatible dengan Java baru;
- reflection blocked oleh module encapsulation;
- vulnerable dependency terbawa ke image.

---

### 0.14.4. Java runtime version sangat penting

Java 8, 11, 17, 21, dan 25 bukan sekadar angka.

Perbedaan deployment bisa meliputi:

- removed Java EE modules setelah Java 8;
- stricter module encapsulation;
- container-awareness improvement;
- GC evolution;
- TLS and security defaults;
- logging flags;
- removed/obsolete JVM options;
- default charset behavior;
- virtual threads pada Java modern;
- compatibility dengan app server/library.

Karena itu deployment harus menyatakan Java version secara eksplisit.

```text
Bad:
  Uses whatever java is installed on server.

Better:
  Runs with Eclipse Temurin 21.0.x image digest sha256:...

Best:
  Runtime version, vendor, image digest, JVM flags, and compatibility evidence are recorded in release metadata.
```

---

### 0.14.5. Java sering hidup dalam container lain

Ada dua makna “container” dalam Java deployment:

1. OS/container image seperti Docker/OCI/Kubernetes.
2. Application container seperti Tomcat, Jetty, WildFly, WebLogic, Open Liberty.

Contoh:

```text
Kubernetes container
└── WildFly application server
    └── EAR/WAR application
```

Atau:

```text
Kubernetes container
└── java -jar spring-boot-app.jar
```

Keduanya punya deployment lifecycle berbeda.

---

## 0.15. Deployment safety model

Deployment aman bukan berarti tidak pernah gagal. Deployment aman berarti kegagalan:

- kecil dampaknya;
- cepat terdeteksi;
- bisa dihentikan;
- bisa di-rollback atau di-roll-forward;
- meninggalkan evidence;
- tidak merusak data.

Kita bisa memakai model berikut.

```text
Safety = Limit blast radius
       + Detect quickly
       + Recover reliably
       + Preserve correctness
       + Preserve evidence
```

### 0.15.1. Limit blast radius

Cara membatasi dampak:

- canary deployment;
- blue-green;
- feature flag;
- ring rollout;
- deploy satu module dulu;
- traffic percentage kecil;
- disable job sementara;
- read-only mode;
- maintenance window terbatas.

---

### 0.15.2. Detect quickly

Cara mendeteksi cepat:

- health check akurat;
- error budget burn;
- latency percentile;
- log anomaly;
- synthetic transaction;
- canary analysis;
- DB metric;
- queue backlog;
- business KPI.

---

### 0.15.3. Recover reliably

Cara recover:

- rollback artifact;
- rollback config;
- disable feature flag;
- scale down new version;
- drain consumer;
- replay message;
- restore backup;
- run compensating migration;
- failover dependency;
- emergency patch.

---

### 0.15.4. Preserve correctness

Cara menjaga correctness:

- backward-compatible schema;
- idempotency key;
- transaction boundary jelas;
- exactly-once illusion dihindari;
- validation consistent;
- state machine transition guarded;
- old/new version compatibility.

---

### 0.15.5. Preserve evidence

Cara menjaga evidence:

- deployment event logged;
- release ID visible;
- audit trail intact;
- approval captured;
- migration logs saved;
- rollback reason documented;
- incident timeline retained.

---

## 0.16. Rollback bukan undo magic

Salah satu kesalahan terbesar adalah menganggap rollback selalu mudah.

```text
Deploy v2 failed -> rollback to v1 -> solved
```

Dalam sistem nyata, rollback bisa sulit karena state sudah berubah.

### 0.16.1. Artifact rollback

Paling mudah:

```text
Run previous binary again.
```

Aman jika:

- database schema masih kompatibel;
- config lama tersedia;
- dependency external masih sama;
- data baru bisa dibaca versi lama;
- message schema masih kompatibel.

---

### 0.16.2. Config rollback

Lebih tricky karena config bisa menyangkut secret, endpoint, feature flag, atau security.

Contoh:

```text
OIDC issuer changed
DB password rotated
feature flag enabled
rate limit changed
```

Rollback config harus tahu precedence dan propagation behavior.

---

### 0.16.3. Database rollback

Paling berisiko.

Contoh sulit:

- drop column;
- transform data destructive;
- merge rows;
- change enum semantics;
- rewrite workflow state;
- delete reference data;
- irreversible migration.

Karena itu zero-downtime deployment biasanya memakai expand-contract:

```text
1. Expand schema backward-compatibly
2. Deploy app that can use old and new schema
3. Backfill safely
4. Switch reads/writes
5. Later contract old schema
```

---

### 0.16.4. Message rollback

Jika versi baru sudah publish event format baru, versi lama mungkin tidak bisa consume.

Pertanyaan:

- Apakah event schema versioned?
- Apakah unknown fields ignored?
- Apakah enum baru breaking?
- Apakah consumer lama crash?
- Apakah dead-letter queue siap?

---

### 0.16.5. Business rollback

Kadang rollback teknis tidak cukup.

Contoh:

```text
New release approved 1,000 applications with wrong rule.
```

Rollback binary tidak membatalkan keputusan bisnis. Perlu:

- data correction;
- audit annotation;
- user notification;
- management approval;
- compensating action;
- legal/regulatory review.

Top-tier engineer selalu membedakan:

```text
technical rollback != business rollback
```

---

## 0.17. Deployment maturity levels

Kita bisa menilai maturity deployment Java dalam beberapa level.

### Level 0 — Manual and tribal

Ciri:

- deploy dari laptop;
- copy file manual;
- config edit langsung di server;
- tidak ada artifact identity;
- rollback mengandalkan ingatan;
- log dicek manual;
- tidak ada evidence.

Risiko:

- tidak repeatable;
- sulit audit;
- rawan salah environment;
- sulit RCA.

---

### Level 1 — Scripted

Ciri:

- ada shell/PowerShell script;
- artifact dari CI;
- restart service otomatis;
- config masih manual sebagian;
- rollback script sederhana.

Risiko:

- script drift;
- error handling lemah;
- observability belum menjadi gate;
- approval/evidence masih terpisah.

---

### Level 2 — Pipeline-driven

Ciri:

- CI/CD pipeline;
- artifact repository;
- environment promotion;
- automated tests;
- release note;
- deployment approval;
- basic smoke test.

Risiko:

- pipeline success dianggap production success;
- rollback belum sering diuji;
- DB migration masih rawan;
- observability belum cukup.

---

### Level 3 — Progressive and observable

Ciri:

- rolling/canary/blue-green;
- health/readiness meaningful;
- automated verification;
- dashboards with version labels;
- rollback target known;
- migration strategy defined;
- secret rotation managed.

Risiko:

- distributed compatibility masih sulit;
- business correctness metric belum lengkap;
- governance bisa belum kuat.

---

### Level 4 — Governed and resilient

Ciri:

- deployment as audited state transition;
- release metadata lengkap;
- SBOM/provenance/signing;
- policy gates;
- backward compatibility discipline;
- DR/failover tested;
- runbook mature;
- incident learning loop.

Ini target enterprise-grade.

---

### Level 5 — Platformized

Ciri:

- golden path untuk Java services;
- reusable templates;
- standardized JVM flags;
- approved base images;
- automated vulnerability policy;
- service onboarding checklist;
- self-service deployment;
- built-in observability;
- safe defaults;
- governance automated.

Ini level yang biasa dimiliki organisasi engineering mature.

---

## 0.18. Common deployment illusions

### 0.18.1. “It works locally” illusion

Local environment tidak membuktikan production readiness.

Local biasanya berbeda dalam:

- Java version;
- CPU/memory;
- network latency;
- database size;
- TLS certificate;
- timezone;
- file path;
- concurrency;
- permissions;
- secrets;
- service discovery.

---

### 0.18.2. “Build passed” illusion

Build passed hanya membuktikan artifact dibuat dan test tertentu lulus.

Tidak membuktikan:

- config benar;
- secret valid;
- DB migration aman;
- traffic routing benar;
- probes akurat;
- rollback aman;
- observability lengkap.

---

### 0.18.3. “Health check green” illusion

Health green bisa palsu jika hanya memeriksa process hidup.

Health yang buruk:

```text
GET /health -> 200 OK
```

Health yang lebih baik:

```text
liveness: process not deadlocked
readiness: app can serve traffic
startup: app still initializing
```

Tetapi bahkan readiness tidak boleh terlalu berat sampai membuat dependency down menyebabkan cascade restart.

---

### 0.18.4. “Rollback solves everything” illusion

Rollback tidak menyelesaikan:

- destructive migration;
- corrupted data;
- sent email;
- external API side effect;
- duplicated message;
- approved workflow action;
- exposed secret;
- expired certificate;
- user-visible decision.

---

### 0.18.5. “Kubernetes gives zero downtime automatically” illusion

Kubernetes menyediakan primitive, bukan jaminan otomatis.

Zero downtime membutuhkan:

- readiness benar;
- sufficient replicas;
- resource capacity;
- graceful shutdown;
- proper termination grace;
- load balancer drain;
- backward compatibility;
- database migration safety.

Tanpa itu, rolling update tetap bisa menghasilkan downtime.

---

### 0.18.6. “Container makes environment identical” illusion

Container membantu, tetapi tidak membuat semua identical.

Masih bisa berbeda:

- kernel;
- CPU architecture;
- cgroup version;
- DNS;
- network policy;
- mounted secrets;
- node pressure;
- image pull policy;
- registry mirror;
- storage driver;
- CA bundle update;
- time sync.

---

## 0.19. Deployment questions a top-tier engineer asks

Sebelum approve deployment, engineer matang bertanya:

### Artifact

- Artifact apa yang dideploy?
- Dibangun dari commit mana?
- Dependency apa yang berubah?
- Apakah artifact immutable?
- Apakah checksum/digest diketahui?
- Apakah artifact yang sama sudah diuji?

### Runtime

- Java version dan vendor apa?
- JVM flags apa?
- Base image/OS apa?
- CPU/memory limit apa?
- Apakah heap sizing cocok dengan container limit?
- Apakah timezone/locale/encoding eksplisit?

### Config

- Config apa yang berubah?
- Secret apa yang dipakai?
- Apakah config versioned?
- Apakah ada feature flag?
- Apakah ada environment mismatch?
- Apakah restart dibutuhkan untuk config berlaku?

### State

- Apakah schema berubah?
- Apakah migration backward-compatible?
- Apakah ada data backfill?
- Apakah versi lama bisa membaca data baru?
- Apakah message/event schema berubah?
- Apakah session/cache/local state terdampak?

### Traffic

- Strategi rollout apa?
- Berapa replica tersedia?
- Apakah readiness akurat?
- Apakah load balancer drain benar?
- Apakah client retry behavior aman?
- Apakah deployment bisa dihentikan di tengah?

### Observability

- Metric apa yang harus dipantau?
- Log apa yang membuktikan release sehat?
- Trace/correlation ID masih ada?
- Dashboard bisa filter version?
- Alert apa yang relevan?
- Smoke/synthetic test apa yang dijalankan?

### Rollback

- Rollback target apa?
- Rollback command apa?
- Apa yang tidak bisa dirollback?
- Siapa yang memutuskan rollback?
- Berapa lama rollback dilakukan?
- Evidence apa yang dicatat?

### Governance

- CR/approval ada?
- Release note lengkap?
- User impact diketahui?
- Maintenance window perlu?
- Segregation of duties terpenuhi?
- Audit trail deployment tersimpan?

---

## 0.20. Practical example: naive vs mature deployment thinking

### Scenario

Aplikasi Java Spring Boot `case-service` akan deploy dari `1.12.0` ke `1.13.0`.

Perubahan:

- field baru `case_priority`;
- endpoint baru untuk escalation;
- scheduler baru untuk auto-escalation;
- dependency baru untuk external notification;
- Java runtime naik dari 17 ke 21;
- container memory tetap 1Gi;
- rolling deployment di Kubernetes.

---

### Naive thinking

```text
Build passed.
Docker image created.
Deploy to UAT.
If okay, deploy to PROD.
```

Masalah yang terlewat:

- DB schema harus expand dulu;
- versi lama mungkin tidak mengenal `case_priority`;
- scheduler baru bisa berjalan di semua replica dan double process;
- external notification bisa mengirim duplicate;
- Java 21 runtime mungkin mengubah behavior dependency lama;
- memory 1Gi mungkin tidak cukup karena dependency/agent baru;
- readiness mungkin green sebelum scheduler/DB ready;
- rollback ke 1.12.0 mungkin gagal membaca data baru;
- audit trail harus mencatat auto-escalation.

---

### Mature thinking

Deployment diperlakukan sebagai state transition.

```text
Precondition:
  - schema expanded with nullable case_priority
  - old version ignores new column safely
  - scheduler guarded by leader lock/idempotency
  - notification uses idempotency key
  - Java 21 compatibility tested
  - memory headroom validated
  - readiness checks DB and critical dependencies appropriately
  - rollback to 1.12.0 tested against expanded schema

Deployment:
  - deploy canary 1 replica
  - observe error rate, escalation metric, notification duplicate count
  - progressively roll out

Postcondition:
  - all pods 1.13.0
  - no queue backlog increase
  - no duplicate notification
  - audit trail contains auto-escalation actor/reason

Rollback:
  - disable scheduler feature flag first
  - rollback image if necessary
  - keep expanded schema
  - no destructive DB rollback
```

Perbedaannya bukan tool. Perbedaannya adalah mental model.

---

## 0.21. Deployment and version compatibility matrix

Untuk Java deployment, compatibility harus dilihat dalam matrix.

```text
                 Runtime  Config  Schema  Message  Client  Dependency
App v1.0              OK      OK      OK      OK      OK        OK
App v1.1              OK      ?       ?       OK      OK        ?
App v1.2              ?       ?       ?       ?       OK        ?
```

Contoh matrix lebih konkret:

| Component | Old | New | Compatibility question |
|---|---:|---:|---|
| App version | 1.12.0 | 1.13.0 | Can both run during rolling deploy? |
| Java runtime | 17 | 21 | Are libraries and JVM flags compatible? |
| DB schema | S1 | S2 | Can old app read/write S2? |
| Event schema | E1 | E2 | Can old consumers ignore new fields? |
| API client | C1 | C1/C2 | Are API changes backward-compatible? |
| Config | K1 | K2 | Can rollback restore config safely? |

Top-tier deployment engineering is largely compatibility engineering.

---

## 0.22. Deployment is not one event; it is a lifecycle

Deployment lifecycle:

```text
1. Plan
2. Build
3. Package
4. Scan
5. Publish
6. Promote
7. Precheck
8. Deploy
9. Verify
10. Monitor
11. Stabilize
12. Close change
13. Learn
```

### 0.22.1. Plan

Menentukan:

- scope;
- risk;
- dependencies;
- migration;
- rollout strategy;
- rollback strategy;
- owner;
- evidence.

### 0.22.2. Build/package/scan/publish

Menentukan:

- artifact identity;
- image digest;
- SBOM;
- vulnerability result;
- test evidence.

### 0.22.3. Promote

Promosi berarti artifact yang sama bergerak antar environment.

```text
DEV -> SIT -> UAT -> PROD
```

Anti-pattern:

```text
rebuild artifact for PROD from same branch
```

Lebih baik:

```text
build once, promote same artifact, bind environment config at release time
```

### 0.22.4. Precheck

Sebelum deploy:

- environment sehat;
- dependency reachable;
- capacity cukup;
- migration ready;
- secret valid;
- certificate valid;
- backup/snapshot jika perlu;
- rollback target available.

### 0.22.5. Deploy

Melakukan perubahan controlled.

### 0.22.6. Verify

Membuktikan release sehat.

### 0.22.7. Monitor/stabilize

Memantau sampai confidence window cukup.

### 0.22.8. Close change

Mencatat evidence dan status akhir.

### 0.22.9. Learn

Jika ada issue, lakukan RCA dan update checklist/runbook.

---

## 0.23. Deployment evidence model

Untuk sistem enterprise, evidence bukan birokrasi kosong. Evidence adalah cara membuktikan bahwa perubahan production terkendali.

Minimal evidence:

```text
Release ID:
Artifact:
Artifact digest:
Source commit:
Build ID:
Java runtime:
Container image:
Environment:
Deployment start:
Deployment end:
Approver:
Operator:
Migration executed:
Smoke test result:
Monitoring window:
Rollback target:
Known issues:
```

Contoh:

```text
Release ID: case-service-prod-2026.06.17-001
Artifact: case-service-1.13.0.jar
Image digest: sha256:abc123...
Source commit: 4f8a92c
Build ID: jenkins-7821
Runtime: Eclipse Temurin JDK 21.0.7
Environment: PROD intranet
Deployment strategy: rolling, maxUnavailable=0, maxSurge=1
Migration: V20260617_01__add_case_priority.sql
Verification: smoke-test-prod-482 passed
Post-deploy monitor: 30 minutes, no error spike
Rollback target: case-service:1.12.0 sha256:def456...
```

Evidence membuat deployment defensible.

---

## 0.24. Deployment design principles

### Principle 1 — Build once, promote many

Artifact yang diuji sebaiknya artifact yang sama dengan yang diproduksi.

```text
Bad:
  build separately for UAT and PROD

Good:
  same artifact, different release config
```

---

### Principle 2 — Immutable artifact, mutable config

Artifact tidak diedit setelah build.

```text
Bad:
  unzip JAR, edit properties, zip again

Good:
  artifact immutable, config supplied by environment/release
```

---

### Principle 3 — Explicit runtime

Jangan bergantung pada “Java yang kebetulan ada”.

```text
Bad:
  /usr/bin/java

Good:
  pinned JDK vendor/version/image digest
```

---

### Principle 4 — Backward compatibility during rollout

Selama rolling deployment, old dan new bisa hidup bersama.

```text
Deployment-safe change must tolerate mixed versions.
```

---

### Principle 5 — Separate deploy from release activation

Deploy code tidak harus langsung mengaktifkan fitur.

Gunakan:

- feature flag;
- dark launch;
- config switch;
- gradual enablement;
- role-based exposure.

---

### Principle 6 — Prefer reversible changes first

Urutkan perubahan agar rollback masih mungkin.

```text
1. Add compatible schema
2. Deploy compatible code
3. Enable feature
4. Observe
5. Remove old path later
```

---

### Principle 7 — Health must represent serving ability

Health/readiness harus merefleksikan kemampuan melayani workload yang relevan.

---

### Principle 8 — Deployment must be observable by version

Metric/log/trace harus bisa membedakan versi.

```text
service=case-service
version=1.13.0
environment=prod
instance=pod-abc
```

---

### Principle 9 — Rollback is designed before deployment

Jika rollback baru dipikirkan saat incident, sudah terlambat.

---

### Principle 10 — Operational simplicity beats cleverness

Deployment design yang terlalu pintar tetapi sulit dipahami akan gagal saat incident.

---

## 0.25. Java deployment anti-pattern catalog

### Anti-pattern 1 — Environment-specific artifact

```text
app-uat.jar
app-prod.jar
```

Masalah:

- artifact yang diuji bukan artifact production;
- sulit trace;
- rawan salah file;
- config bercampur code.

Better:

```text
app-1.4.2.jar + environment config
```

---

### Anti-pattern 2 — Mutable image tag

```text
image: case-service:latest
```

Masalah:

- tidak tahu binary mana yang running;
- rollback tidak deterministik;
- audit buruk.

Better:

```text
image: case-service@sha256:...
```

atau minimal:

```text
image: case-service:1.4.2-build.781
```

---

### Anti-pattern 3 — JVM flags copy-paste lintas versi

Flag Java 8 belum tentu valid di Java 17/21/25.

Contoh risiko:

- obsolete GC flags;
- removed logging flags;
- illegal reflective access workaround;
- PermGen flags di Java modern;
- container memory flags lama.

Better:

- version-specific JVM option baseline;
- startup failure check;
- documented reason per flag.

---

### Anti-pattern 4 — Readiness checks only `/ping`

```text
/ping -> 200 OK
```

Masalah:

- app menerima traffic sebelum siap;
- dependency failure tidak tercermin;
- false green.

Better:

- liveness ringan;
- readiness meaningful;
- startup probe untuk init lambat.

---

### Anti-pattern 5 — Destructive migration in same release

```text
ALTER TABLE DROP COLUMN old_status;
Deploy app that no longer uses it.
```

Masalah:

- rollback app lama gagal;
- data hilang;
- mixed version rusak.

Better:

- expand-contract;
- delayed cleanup;
- backward-compatible release.

---

### Anti-pattern 6 — Scheduler runs on every replica accidentally

Deployment scaling membuat scheduler berjalan ganda.

Masalah:

- duplicate email;
- duplicate escalation;
- duplicate billing;
- lock contention.

Better:

- leader election;
- distributed lock;
- idempotency;
- dedicated worker deployment;
- external scheduler.

---

### Anti-pattern 7 — Secrets baked into image

Masalah:

- image leak = secret leak;
- rotation sulit;
- environment coupling;
- registry becomes secret store.

Better:

- secret manager;
- runtime injection;
- short-lived credentials;
- rotation plan.

---

### Anti-pattern 8 — Manual hotfix on server

Masalah:

- source of truth hilang;
- rebuild tidak sama;
- audit buruk;
- patch tertimpa release berikutnya.

Better:

- hotfix branch;
- CI build;
- emergency release process;
- documented approval.

---

### Anti-pattern 9 — No version in logs/metrics

Saat incident:

```text
error increased after deploy, but which instance/version?
```

Better:

- include version/build in log MDC;
- metric label version;
- deployment marker in dashboard;
- endpoint `/info` exposes release metadata.

---

### Anti-pattern 10 — Treating deploy as success before business verification

Deployment command success tidak membuktikan business transaction sukses.

Better:

- smoke test;
- synthetic transaction;
- queue check;
- audit trail check;
- module-specific validation.

---

## 0.26. Release readiness checklist

Gunakan checklist ini sebagai awal. Nanti setiap part akan memperdalamnya.

### Artifact readiness

- [ ] Artifact immutable.
- [ ] Source commit known.
- [ ] Build ID known.
- [ ] Dependency list known.
- [ ] SBOM available if required.
- [ ] Artifact checksum/digest known.
- [ ] Same artifact tested in lower environment.

### Runtime readiness

- [ ] Java version explicit.
- [ ] JDK vendor explicit.
- [ ] JVM flags reviewed.
- [ ] Container/base image explicit.
- [ ] CPU/memory request/limit reviewed.
- [ ] Timezone/locale/encoding explicit if relevant.
- [ ] Truststore/CA available.

### Config readiness

- [ ] Required config present.
- [ ] Secrets present and valid.
- [ ] Feature flags reviewed.
- [ ] Environment endpoint correct.
- [ ] Config precedence understood.
- [ ] Reload/restart behavior known.

### Data readiness

- [ ] DB migration reviewed.
- [ ] Migration backward-compatible.
- [ ] Rollback impact known.
- [ ] Backfill plan if needed.
- [ ] Index/lock impact reviewed.
- [ ] Old/new app compatibility confirmed.

### Traffic readiness

- [ ] Rollout strategy chosen.
- [ ] Readiness probe meaningful.
- [ ] Liveness probe safe.
- [ ] Startup probe configured if needed.
- [ ] Graceful shutdown configured.
- [ ] Capacity enough during rollout.
- [ ] Load balancer drain understood.

### State readiness

- [ ] Sessions safe.
- [ ] Cache compatibility known.
- [ ] Message consumers safe.
- [ ] Scheduler behavior safe.
- [ ] Idempotency considered.
- [ ] In-flight work handling known.

### Observability readiness

- [ ] Logs available.
- [ ] Metrics available.
- [ ] Traces available if applicable.
- [ ] Version/build label visible.
- [ ] Dashboard ready.
- [ ] Alert relevant.
- [ ] Smoke/synthetic checks ready.

### Rollback readiness

- [ ] Previous artifact available.
- [ ] Previous config available.
- [ ] DB rollback/forward plan known.
- [ ] Feature disable path known.
- [ ] Rollback owner known.
- [ ] Rollback trigger defined.

### Governance readiness

- [ ] Change request approved.
- [ ] Release note prepared.
- [ ] Deployment window agreed.
- [ ] Stakeholders informed.
- [ ] Evidence path known.
- [ ] Post-deployment sign-off defined.

---

## 0.27. How this Part 0 connects to the rest of the series

Part 0 memberi bahasa dasar. Part berikutnya akan memperdalam area spesifik:

```text
Part 1  -> Java 8-25 deployment evolution
Part 2  -> artifact taxonomy
Part 3  -> runtime selection
Part 4  -> OS/process/filesystem contract
Part 5  -> configuration deployment
Part 6  -> JVM options as deployment contract
Part 7  -> VM/systemd deployment
Part 8  -> containerizing Java correctly
Part 9  -> Dockerfile patterns
Part 10 -> jlink/jdeps/jpackage
...
Part 35 -> mastery review
```

Setiap bagian akan selalu kembali ke pertanyaan Part 0:

```text
What changes?
What must remain true?
How do we know?
How do we recover?
How do we prove it?
```

---

## 0.28. Mini mental model: deployment as a contract stack

Aplikasi production berjalan di atas stack kontrak.

```text
Business Contract
  correctness, SLA, auditability, user impact

Application Contract
  APIs, state transitions, idempotency, compatibility

Runtime Contract
  Java version, JVM flags, memory, classpath, process lifecycle

Platform Contract
  OS/container/Kubernetes/app server/network/storage

Operational Contract
  observability, runbook, rollback, alerting, evidence
```

Kegagalan deployment biasanya terjadi saat satu layer berubah tetapi layer lain tidak sadar.

Contoh:

```text
Runtime changed Java 17 -> 21
Application contract assumes old reflective access
Deployment fails at startup
```

Atau:

```text
Application adds new enum state
Reporting module old version cannot parse it
Business dashboard fails
```

Atau:

```text
Kubernetes kills pod after 30 seconds
Java app needs 90 seconds to drain long request
User transaction interrupted
```

Deployment engineer yang kuat berpikir lintas layer.

---

## 0.29. Practical exercise

Ambil satu aplikasi Java yang pernah kamu deploy. Jawab pertanyaan berikut.

### A. Artifact

```text
1. Apa nama artifact-nya?
2. Dibangun dari commit mana?
3. Apakah artifact yang sama dipakai di UAT dan PROD?
4. Apakah artifact immutable?
5. Apakah dependency list diketahui?
```

### B. Runtime

```text
1. Java version apa?
2. Vendor JDK apa?
3. JVM flags apa?
4. Heap dan non-heap headroom bagaimana?
5. OS/container base image apa?
```

### C. Config

```text
1. Config datang dari mana?
2. Secret datang dari mana?
3. Apakah config versioned?
4. Apakah ada config yang beda antar pod/server?
5. Bagaimana rotasi secret dilakukan?
```

### D. State

```text
1. Apakah app punya DB migration?
2. Apakah punya local cache?
3. Apakah punya scheduler?
4. Apakah consume queue?
5. Apa yang terjadi jika process mati saat workload aktif?
```

### E. Rollout

```text
1. Strategi deployment apa?
2. Apakah old/new version berjalan bersamaan?
3. Apakah readiness akurat?
4. Apakah shutdown graceful?
5. Apakah capacity cukup selama rolling update?
```

### F. Recovery

```text
1. Bagaimana rollback dilakukan?
2. Apa yang tidak bisa dirollback?
3. Siapa yang memutuskan rollback?
4. Signal apa yang memicu rollback?
5. Berapa lama rollback biasanya?
```

### G. Evidence

```text
1. Apa bukti deployment sukses?
2. Di mana release note?
3. Di mana approval?
4. Di mana deployment log?
5. Di mana post-deploy verification?
```

Jika banyak jawaban belum jelas, itu bukan kegagalan pribadi. Itu tanda area deployment maturity yang bisa diperbaiki.

---

## 0.30. Summary Part 0

Deployment Java production bukan sekadar menjalankan JAR/WAR. Deployment adalah perubahan state sistem yang harus:

- direncanakan;
- dikemas;
- dirilis;
- diterapkan;
- dijalankan;
- diverifikasi;
- dioperasikan;
- dipulihkan;
- dibuktikan.

Mental model utama:

```text
Source -> Build -> Package -> Publish -> Release -> Deploy -> Run -> Verify -> Operate
```

Pertanyaan paling penting:

```text
What changes?
What must remain true?
How do we know?
How do we recover?
How do we prove it?
```

Jika kamu menguasai lima pertanyaan itu, kamu tidak lagi melihat deployment sebagai command. Kamu melihatnya sebagai engineering discipline.

---

## 0.31. Referensi resmi dan relevan

- OpenJDK — JDK 25: https://openjdk.org/projects/jdk/25/
- Oracle — JDK 25 Release Notes: https://www.oracle.com/java/technologies/javase/25all-relnotes.html
- Twelve-Factor App — Build, release, run: https://12factor.net/build-release-run
- Twelve-Factor App — Config: https://12factor.net/config
- Kubernetes — Production-Grade Container Orchestration: https://kubernetes.io/
- Kubernetes — Liveness, Readiness, and Startup Probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes — Configure Liveness, Readiness and Startup Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Kubernetes — Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/

---

## Status series

Part 0 selesai.

Series ini belum selesai. Kita masih berada di awal dari total rencana 35 part.

Berikutnya:

```text
Part 1 — Java Deployment Evolution: Java 8 to Java 25
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-data-types-part-034.md](../data_type/learn-java-data-types-part-034.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-01-java-deployment-evolution-java-8-to-25.md)

</div>