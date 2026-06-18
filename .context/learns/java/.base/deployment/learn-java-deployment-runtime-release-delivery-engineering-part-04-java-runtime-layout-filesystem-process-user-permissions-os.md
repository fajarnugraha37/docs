# learn-java-deployment-runtime-release-delivery-engineering

## Part 4 — Java Runtime Layout: Filesystem, Process, User, Permissions, and OS Contracts

> Seri: **Java Deployment — Runtime, Release, and Delivery Engineering**  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Principal-minded deployment engineering  
> Fokus: bagaimana aplikasi Java hidup sebagai proses OS yang aman, predictable, observable, restartable, dan operable.

---

## 0. Posisi Part Ini dalam Series

Pada Part 0 kita membangun mental model deployment sebagai perubahan dari:

```text
source code -> artifact -> release candidate -> runtime process -> serving traffic -> observed/operated system
```

Pada Part 1 kita melihat evolusi deployment Java 8 sampai Java 25.

Pada Part 2 kita membahas bentuk artifact: JAR, WAR, EAR, thin JAR, fat JAR, layered JAR, native image.

Pada Part 3 kita membahas pemilihan runtime: JDK/JRE/OpenJDK distribution/vendor.

Sekarang kita masuk ke boundary yang sering diremehkan:

```text
Java artifact bukan deployment.
Java command bukan deployment.
Container image bukan deployment.
Deployment yang benar adalah runtime contract antara aplikasi, JVM, OS, process manager, filesystem, network, identity, security boundary, dan operator.
```

Part ini menjawab pertanyaan:

- Di mana artifact diletakkan?
- Siapa user OS yang menjalankan aplikasi?
- Direktori mana yang immutable?
- Direktori mana yang boleh ditulis?
- Bagaimana aplikasi menerima shutdown signal?
- Bagaimana process manager tahu aplikasi mati?
- Bagaimana restart dilakukan?
- Bagaimana log, PID, temp file, heap dump, crash file, dan working directory dikelola?
- Apa bedanya menjalankan Java di VM, bare metal, systemd, container, Kubernetes, Windows Service, dan application server?
- Apa invariant operasional yang harus berlaku lintas Java 8 sampai Java 25?

Bagian ini tidak membahas tuning JVM secara mendalam. Tuning JVM akan disentuh sebagai bagian dari runtime contract, tetapi pembahasan memory/CPU sizing yang lebih detail ada di Part 16.

---

## 1. Core Thesis

Aplikasi Java production harus diperlakukan sebagai **managed operating system process**, bukan sebagai “file JAR yang dijalankan”.

Mental model yang lebih benar:

```text
Java application =
  artifact bytes
  + runtime distribution
  + JVM options
  + OS process identity
  + filesystem contract
  + network binding
  + configuration contract
  + secret contract
  + lifecycle contract
  + logging/diagnostics contract
  + restart/rollback contract
  + operational ownership
```

Jika salah satu contract tidak jelas, deployment akan tetap bisa “jalan”, tetapi gagal saat:

- restart mendadak;
- full disk;
- permission berubah;
- sertifikat expired;
- process dibunuh SIGTERM;
- temporary directory penuh;
- application mencoba menulis ke lokasi read-only;
- log tidak keluar;
- heap dump gagal dibuat;
- PID tidak terlacak;
- working directory berbeda antara local dan production;
- user root di container bisa mengubah file yang tidak seharusnya;
- process manager menganggap service sehat padahal thread pool mati;
- operator tidak tahu file mana artifact dan file mana runtime state.

Top 1% engineer tidak hanya bertanya:

> “Bagaimana menjalankan JAR?”

Tetapi bertanya:

> “Apa contract runtime yang membuat aplikasi ini aman dijalankan, mudah dioperasikan, mudah diganti versinya, dan mudah dipulihkan saat gagal?”

---

## 2. Deployment Runtime Contract

Kita definisikan **deployment runtime contract** sebagai kesepakatan eksplisit antara aplikasi dan environment runtime.

Contract minimal:

| Area | Pertanyaan |
|---|---|
| Artifact | File mana yang merupakan release immutable? |
| Runtime | JDK/JRE mana yang digunakan? Versi patch apa? Vendor apa? |
| Command | Command apa yang menjalankan process? JVM options dari mana? |
| Identity | User/group OS apa yang menjalankan aplikasi? |
| Working directory | `user.dir` aplikasi berada di mana? |
| Writable path | Aplikasi boleh menulis ke mana? |
| Read-only path | Aplikasi tidak boleh mengubah apa? |
| Config | Config dibaca dari mana? Precedence-nya apa? |
| Secret | Secret disuntikkan bagaimana? File/env/volume/secret manager? |
| Logs | Log ke stdout, file, journald, sidecar, atau agent? |
| Diagnostics | Heap dump/thread dump/JFR/crash log ditaruh di mana? |
| Network | Bind host/port apa? Interface mana? IPv4/IPv6? |
| Lifecycle | Start/stop/restart/kill signal-nya bagaimana? |
| Health | Siapa yang menentukan process sehat? |
| Restart | Kapan restart otomatis dilakukan? |
| Rollback | Versi lama disimpan di mana dan bagaimana kembali? |
| Cleanup | Temp/cache/file runtime dibersihkan kapan? |

Tanpa contract ini, deployment menjadi kumpulan asumsi.

Asumsi adalah sumber incident.

---

## 3. Runtime Layout: Mengapa Layout Penting

Runtime layout adalah struktur direktori dan file yang membedakan:

1. **artifact immutable**;
2. **configuration**;
3. **secret**;
4. **runtime state**;
5. **logs**;
6. **diagnostics**;
7. **temporary files**;
8. **operator scripts**;
9. **release history**.

Deployment yang buruk biasanya mencampur semua hal ini dalam satu folder:

```text
/app
  app.jar
  application.yml
  password.txt
  logs/app.log
  tmp/upload-123
  heapdump.hprof
  old-app.jar
  run.sh
```

Masalahnya:

- sulit tahu file mana boleh dihapus;
- rollback membingungkan;
- config ikut tertimpa saat deploy;
- secret terbawa saat backup artifact;
- log memenuhi disk artifact;
- heap dump gagal karena direktori penuh;
- permission terlalu longgar;
- audit deployment tidak jelas;
- automation rentan salah hapus.

Layout yang baik membuat contract terlihat dari filesystem.

---

## 4. Canonical Layout untuk Java Service di Linux VM/Bare Metal

Tidak ada satu standar universal, tetapi layout production yang sehat biasanya memisahkan immutable dan mutable.

Contoh:

```text
/opt/acme/payment-service/
  releases/
    2026-06-18T120000Z-git-a1b2c3d/
      app.jar
      lib/
      BOOT-INF/                 # jika exploded/layered
      manifest.json
      sbom.json
      checksums.sha256
    2026-06-10T090000Z-git-9f8e7d6/
      app.jar
      manifest.json
      checksums.sha256
  current -> releases/2026-06-18T120000Z-git-a1b2c3d

/etc/acme/payment-service/
  application.yml
  logging.yml
  jvm.options
  env

/var/lib/acme/payment-service/
  data/
  cache/
  state/

/var/log/acme/payment-service/
  app.log
  gc.log

/var/run/acme/payment-service/
  payment-service.pid

/var/tmp/acme/payment-service/
  upload-buffer/
  temp-processing/

/var/crash/acme/payment-service/
  heapdumps/
  hs_err/
  jfr/
```

Prinsipnya:

```text
/opt     -> software/artifact immutable
/etc     -> host-level configuration
/var/lib -> persistent mutable application state
/var/log -> logs
/var/run -> runtime PID/socket ephemeral
/var/tmp -> temporary files that may survive reboot depending OS policy
/tmp     -> temporary files, often cleaned by OS/container lifecycle
```

Catatan: distribusi Linux dan standar organisasi bisa berbeda. Yang penting bukan nama direktori persisnya, tetapi pemisahan responsibility.

---

## 5. Minimal Layout untuk Container

Dalam container, layout harus lebih sederhana dan lebih ketat.

Contoh:

```text
/app/
  app.jar
  lib/
  layers/

/config/
  application.yml
  logging.yml

/secrets/
  db-password
  tls.key
  tls.crt

/tmp/
  app-tmp/

/diag/
  heapdumps/
  hs_err/
  jfr/
```

Tetapi dalam container production modern, sebagian besar output sebaiknya:

```text
logs        -> stdout/stderr
config      -> env/file-mounted config
secrets     -> secret volume/secret manager integration
artifact    -> baked into image layer
runtime tmp -> explicit writable mount atau container writable layer
diagnostics -> writable volume jika ingin persist setelah container mati
```

Rule of thumb:

```text
Container image harus immutable.
Container filesystem sebaiknya disposable.
Aplikasi tidak boleh bergantung pada file yang ditulis di container layer kecuali memang ephemeral.
```

---

## 6. Immutable vs Mutable Boundary

Deployment harus membedakan:

### 6.1 Immutable

Immutable berarti tidak berubah selama release berjalan.

Contoh:

- `app.jar`;
- dependency JAR;
- runtime image;
- container image layer;
- startup script versi release;
- SBOM;
- checksum;
- manifest;
- static assets yang dibundel.

Immutable artifact membuat deployment:

- reproducible;
- auditable;
- rollbackable;
- cacheable;
- verifiable.

### 6.2 Mutable

Mutable berarti boleh berubah selama runtime.

Contoh:

- uploaded temporary files;
- local cache;
- generated report sementara;
- lock file;
- PID file;
- logs;
- heap dump;
- JFR recording;
- database migration marker external;
- local embedded DB jika ada;
- batch checkpoint lokal jika memang didesain begitu.

### 6.3 Anti-pattern

```text
Artifact directory juga dipakai sebagai log directory.
```

Kenapa buruk?

- deployment bisa gagal karena disk penuh oleh log;
- rollback bisa membawa log lama;
- cleanup release lama bisa menghapus file runtime;
- permission artifact harus dibuat writable;
- integrity artifact tidak bisa dijamin.

### 6.4 Invariant

```text
Release artifact must be replaceable without losing runtime state.
Runtime state must be cleanable without corrupting release artifact.
```

---

## 7. Process Identity: Jangan Jalankan Production Java sebagai Root

Aplikasi Java sebaiknya berjalan sebagai dedicated OS user.

Contoh:

```text
user: payment-svc
group: payment-svc
home: /nonexistent atau /var/lib/acme/payment-service
shell: /usr/sbin/nologin
```

Mengapa?

1. Membatasi blast radius jika aplikasi compromised.
2. Mencegah aplikasi mengubah file sistem yang tidak relevan.
3. Membuat audit lebih jelas.
4. Memisahkan ownership antara service.
5. Mengurangi risiko salah konfigurasi file permission.

Contoh Linux:

```bash
sudo useradd \
  --system \
  --no-create-home \
  --shell /usr/sbin/nologin \
  payment-svc
```

Permission contoh:

```bash
sudo chown -R root:root /opt/acme/payment-service/releases
sudo chmod -R 0755 /opt/acme/payment-service/releases

sudo chown -R root:payment-svc /etc/acme/payment-service
sudo chmod -R 0750 /etc/acme/payment-service

sudo chown -R payment-svc:payment-svc /var/lib/acme/payment-service
sudo chmod -R 0750 /var/lib/acme/payment-service

sudo chown -R payment-svc:payment-svc /var/log/acme/payment-service
sudo chmod -R 0750 /var/log/acme/payment-service

sudo chown -R payment-svc:payment-svc /var/crash/acme/payment-service
sudo chmod -R 0750 /var/crash/acme/payment-service
```

Interpretasi:

```text
artifact       -> owned by root, readable by service, not writable by service
config         -> owned by root, readable by service, not writable by service
state/log/diag -> owned by service, writable by service
```

Ini memberi boundary kuat:

```text
Aplikasi boleh berjalan, tetapi tidak boleh mengubah dirinya sendiri.
```

---

## 8. User, Group, UID, GID dalam Container

Dalam container, jangan hanya menulis:

```dockerfile
USER app
```

Tanpa memastikan UID/GID, file ownership, dan writable path.

Contoh lebih eksplisit:

```dockerfile
FROM eclipse-temurin:21-jre

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app
COPY --chown=app:app app.jar /app/app.jar

RUN mkdir -p /tmp/app /diag/heapdumps /diag/hs_err /diag/jfr \
 && chown -R app:app /tmp/app /diag

USER 10001:10001

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Tetapi ada nuance penting:

```text
Artifact boleh dimiliki root dan readable oleh app user.
Writable path dimiliki app user.
```

Versi yang lebih strict:

```dockerfile
COPY --chown=root:root app.jar /app/app.jar
RUN chmod 0444 /app/app.jar
USER 10001:10001
```

Dengan read-only root filesystem di Kubernetes, writable path harus mount volume:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: diag
    mountPath: /diag
volumes:
  - name: tmp
    emptyDir: {}
  - name: diag
    emptyDir: {}
```

Jika tidak, aplikasi Java bisa gagal saat mencoba:

- membuat file temp;
- menulis heap dump;
- menulis JFR;
- membuat font cache;
- membuat native library extraction;
- menulis ke working directory;
- memproses multipart upload.

---

## 9. Working Directory dan `user.dir`

Java memiliki konsep `user.dir`, yaitu working directory process.

Contoh:

```java
System.getProperty("user.dir")
```

Banyak bug deployment muncul karena local development dan production memiliki working directory berbeda.

Contoh buruk:

```java
Path template = Paths.get("templates/email.html");
```

Ini bergantung pada `user.dir`.

Di local mungkin:

```text
/home/fajar/project/payment-service
```

Di systemd bisa:

```text
/
```

Di container bisa:

```text
/app
```

Di app server bisa:

```text
/opt/wildfly/bin
```

Akibatnya:

```text
FileNotFoundException hanya terjadi di production.
```

Rule:

```text
Classpath resources should be loaded as classpath resources.
External files should be explicitly configured via absolute path.
Never rely on accidental working directory.
```

Contoh benar untuk classpath resource:

```java
try (InputStream in = getClass().getResourceAsStream("/templates/email.html")) {
    if (in == null) {
        throw new IllegalStateException("Missing classpath resource: /templates/email.html");
    }
}
```

Contoh benar untuk external file:

```text
-Dapp.template.dir=/etc/acme/payment-service/templates
```

```java
Path templateDir = Paths.get(System.getProperty("app.template.dir"));
Path template = templateDir.resolve("email.html");
```

Systemd dapat mengatur working directory dengan `WorkingDirectory=`. Dokumentasi systemd menjelaskan bahwa service unit mendeskripsikan proses yang dikontrol systemd, termasuk setting service seperti command dan runtime behavior.[^systemd-service]

---

## 10. Java Command sebagai Runtime Interface

Command Java bukan sekadar:

```bash
java -jar app.jar
```

Command adalah runtime interface antara process manager dan JVM.

Contoh lebih production-grade:

```bash
exec /usr/lib/jvm/temurin-21/bin/java \
  -Dfile.encoding=UTF-8 \
  -Duser.timezone=UTC \
  -Djava.io.tmpdir=/var/tmp/acme/payment-service \
  -XX:ErrorFile=/var/crash/acme/payment-service/hs_err_pid%p.log \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/var/crash/acme/payment-service/heapdumps \
  -Xlog:gc*:file=/var/log/acme/payment-service/gc.log:time,uptime,level,tags:filecount=5,filesize=20M \
  -jar /opt/acme/payment-service/current/app.jar
```

Untuk Java 8, GC logging syntax berbeda:

```bash
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-Xloggc:/var/log/acme/payment-service/gc.log \
-XX:+UseGCLogFileRotation \
-XX:NumberOfGCLogFiles=5 \
-XX:GCLogFileSize=20M
```

Untuk Java 9+, unified logging memakai `-Xlog`.

Prinsip:

```text
Command line adalah bagian dari release/runtime contract dan harus version-controlled.
```

JDK juga mendukung environment variable launcher seperti `JDK_JAVA_OPTIONS` untuk prepend option ke command `java`.[^java-command]

Namun hati-hati:

```text
JDK_JAVA_OPTIONS yang diset global bisa mengubah semua Java process di host/container.
```

Gunakan dengan disiplin, terutama di shared VM.

---

## 11. Wrapper Script: Kapan Perlu, Kapan Berbahaya

Wrapper script umum:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_HOME=/opt/acme/payment-service/current
CONFIG_DIR=/etc/acme/payment-service
JAVA_HOME=/usr/lib/jvm/temurin-21

JAVA_OPTS_FILE="$CONFIG_DIR/jvm.options"
ENV_FILE="$CONFIG_DIR/env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

JAVA_OPTS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  JAVA_OPTS+=("$line")
done < "$JAVA_OPTS_FILE"

exec "$JAVA_HOME/bin/java" \
  "${JAVA_OPTS[@]}" \
  -jar "$APP_HOME/app.jar"
```

Kelebihan:

- command lebih rapi;
- jvm.options bisa dikelola terpisah;
- validation bisa ditambahkan;
- environment file bisa dibaca;
- `exec` memastikan Java process menggantikan shell sehingga signal sampai ke JVM.

Anti-pattern:

```bash
java -jar app.jar
```

Tanpa `exec` di shell script container atau systemd wrapper.

Kenapa?

```text
Process manager mengirim signal ke shell wrapper, bukan langsung ke JVM.
Jika wrapper tidak meneruskan signal, shutdown bisa tidak graceful.
```

Rule:

```text
If wrapper script starts Java, use exec unless you intentionally need parent process supervision.
```

---

## 12. PID 1 Problem dalam Container

Dalam container, process utama sering menjadi PID 1.

PID 1 di Linux memiliki behavior khusus terkait signal dan zombie process. Jika Java langsung menjadi PID 1, biasanya masih bisa menerima SIGTERM, tetapi problem bisa muncul jika:

- process utama adalah shell script tanpa `exec`;
- ada child process yang tidak direap;
- signal tidak diteruskan;
- init behavior dibutuhkan.

Contoh buruk:

```dockerfile
ENTRYPOINT ["/bin/sh", "-c", "java -jar /app/app.jar"]
```

Problem:

```text
/bin/sh menjadi PID 1.
SIGTERM bisa tidak diteruskan dengan benar ke Java process.
```

Lebih baik:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Atau wrapper dengan `exec`:

```bash
#!/usr/bin/env sh
exec java $JAVA_OPTS -jar /app/app.jar
```

Jika perlu init kecil:

```dockerfile
ENTRYPOINT ["/sbin/tini", "--", "java", "-jar", "/app/app.jar"]
```

Tetapi jangan menambahkan init hanya karena ikut template. Pahami problemnya dulu.

---

## 13. Signal Handling: SIGTERM, SIGKILL, SIGINT, SIGHUP

Process Java production harus punya shutdown contract.

Signal umum:

| Signal | Makna umum |
|---|---|
| SIGTERM | Permintaan stop graceful |
| SIGKILL | Kill paksa, tidak bisa ditangkap |
| SIGINT | Interrupt, sering dari Ctrl+C |
| SIGHUP | Reload/hangup, kadang dipakai untuk reload config |
| SIGQUIT | Pada banyak JVM, dapat memicu thread dump ke stderr |

Untuk deployment, yang paling penting:

```text
SIGTERM -> aplikasi berhenti menerima kerja baru -> menyelesaikan in-flight work -> menutup resource -> exit.
SIGKILL -> process mati tanpa cleanup.
```

Kubernetes lifecycle juga menekankan bahwa grace period mencakup eksekusi `preStop` dan waktu container stop normal; jika hook menggantung atau melewati grace period, pod akhirnya dibunuh setelah grace period.[^k8s-hooks]

Spring Boot native graceful shutdown juga bergantung pada signal yang benar, dan dokumentasinya mencatat bahwa shutdown di IDE bisa immediate jika tidak mengirim SIGTERM yang tepat.[^spring-graceful]

---

## 14. Shutdown Hook di Java

Java menyediakan shutdown hook:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("Shutdown hook running...");
}));
```

Shutdown hook berjalan saat JVM mulai shutdown normal, misalnya karena:

- `System.exit()`;
- SIGTERM;
- Ctrl+C/SIGINT;
- last non-daemon thread selesai.

Shutdown hook tidak berjalan saat:

- SIGKILL;
- `kill -9`;
- host power loss;
- container runtime force kill;
- kernel OOM kill;
- JVM crash tertentu.

Rule:

```text
Shutdown hook is best-effort cleanup, not durability guarantee.
```

Gunakan untuk:

- stop accepting new work;
- flush metrics/log buffer;
- close connection pool;
- stop scheduler;
- stop message consumer;
- release local lock;
- close file handles;
- stop background threads.

Jangan gunakan untuk:

- critical business transaction durability;
- mandatory database compensation;
- long-running migration;
- sending essential email exactly once;
- state transition yang harus pasti terjadi.

Jika state harus durable, desain harus menyimpan state sebelum shutdown, bukan berharap shutdown hook selalu berjalan.

---

## 15. Graceful Shutdown Model

Model shutdown yang sehat:

```text
T0: process receives SIGTERM
T1: readiness becomes false / service removed from traffic
T2: stop accepting new requests/messages/jobs
T3: allow in-flight work to complete within deadline
T4: close resources: HTTP server, DB pool, queues, schedulers
T5: flush observability buffers
T6: JVM exits with clear code
T7: process manager observes exit
```

Kegagalan umum:

```text
SIGTERM received
-> app still readiness true
-> load balancer still sends traffic
-> process shuts down thread pool
-> incoming request gets 500/connection reset
```

Atau:

```text
SIGTERM received
-> app stops HTTP server
-> message consumer still processes jobs
-> DB pool closes
-> job fails halfway
-> retry duplicates side effect
```

Deployment engineer harus memahami bahwa shutdown bukan sekadar mati.

Shutdown adalah state transition.

---

## 16. Process Exit Code

Exit code adalah interface antara aplikasi dan process manager.

General convention:

| Exit Code | Interpretasi umum |
|---|---|
| 0 | normal success |
| non-zero | failure |
| 130 | interrupted by Ctrl+C/SIGINT, convention shell |
| 137 | killed by SIGKILL, often OOMKilled/container kill |
| 143 | terminated by SIGTERM |

Namun jangan mengandalkan angka secara buta lintas semua platform. Gunakan sebagai operational hint.

Untuk service:

```text
Exit 0 during intended shutdown should not trigger incident.
Unexpected non-zero exit should be observable and usually restartable.
Repeated non-zero exit should trigger alert/crashloop investigation.
```

Untuk batch/job:

```text
Exit code is the job result contract.
0 means job success.
Non-zero means scheduler/orchestrator should mark failure.
```

Java example:

```java
public static void main(String[] args) {
    try {
        run();
        System.exit(0);
    } catch (ConfigurationException e) {
        System.err.println("Configuration error: " + e.getMessage());
        System.exit(78); // convention: configuration error in sysexits.h, not universal
    } catch (Exception e) {
        e.printStackTrace();
        System.exit(1);
    }
}
```

Untuk web service Spring Boot, biasanya framework yang mengatur lifecycle. Jangan sembarangan `System.exit()` dari business code.

---

## 17. File Descriptor Contract

Java process memakai file descriptor untuk:

- socket inbound;
- socket outbound;
- database connection;
- file log;
- temporary file;
- JAR file;
- native library;
- pipe stdout/stderr;
- monitoring agent;
- DNS resolver;
- TLS keystore/truststore.

Failure umum:

```text
java.io.IOException: Too many open files
```

Penyebab:

- `ulimit -n` terlalu rendah;
- file/socket leak;
- connection pool terlalu besar;
- HTTP client tidak menutup response body;
- log file rotation salah;
- banyak JAR/classpath file terbuka;
- banyak concurrent upload/download.

Deployment contract harus menetapkan:

```text
LimitNOFILE pada systemd / ulimit pada container/host.
```

Systemd contoh:

```ini
[Service]
LimitNOFILE=65536
```

Tetapi menaikkan limit bukan pengganti memperbaiki leak.

Rule:

```text
FD limit must be sized intentionally.
FD usage must be observable.
FD leak must be treated as application defect or library defect.
```

Command observability:

```bash
ls /proc/<pid>/fd | wc -l
lsof -p <pid> | head
lsof -p <pid> | awk '{print $5}' | sort | uniq -c | sort -nr | head
```

Dalam container:

```bash
kubectl exec <pod> -- sh -c 'ls /proc/1/fd | wc -l'
```

---

## 18. Temp Directory Contract

Java menggunakan temporary directory dari:

```java
System.getProperty("java.io.tmpdir")
```

Default biasanya `/tmp`, tetapi bergantung environment.

Aplikasi/framework bisa memakai temp directory untuk:

- multipart upload;
- PDF generation;
- report export;
- decompression;
- native library extraction;
- embedded server work dir;
- compiler/cache;
- large request buffering.

Problem umum:

1. `/tmp` read-only.
2. `/tmp` penuh.
3. `/tmp` terlalu kecil di container.
4. temp file tidak dibersihkan.
5. temp file berisi data sensitif.
6. multiple instance memakai path sama.
7. permission temp terlalu longgar.

Production-grade setting:

```bash
-Djava.io.tmpdir=/var/tmp/acme/payment-service
```

Container:

```yaml
volumeMounts:
  - name: app-tmp
    mountPath: /tmp
volumes:
  - name: app-tmp
    emptyDir:
      sizeLimit: 2Gi
```

Atau:

```bash
-Djava.io.tmpdir=/tmp/app
```

Invariant:

```text
Temporary path must be explicit, writable, size-bounded, monitored, and safe to delete.
```

---

## 19. Log Contract

Log adalah operational interface.

Deployment harus menjawab:

- log keluar ke mana?
- format apa?
- siapa yang collect?
- apakah stdout/stderr dipakai?
- apakah file log dipakai?
- bagaimana rotation?
- apakah log mengandung secret/PII?
- apakah timestamp timezone konsisten?
- apakah correlation ID ada?
- apakah multiline stack trace ditangani?

### 19.1 VM/systemd

Opsi:

```text
Java stdout/stderr -> journald
Java file appender -> /var/log/app/app.log -> logrotate/agent
```

Systemd contoh:

```ini
[Service]
StandardOutput=journal
StandardError=journal
```

Atau file appender dengan logback/log4j2 rotation.

### 19.2 Container/Kubernetes

Best practice umum:

```text
Application logs -> stdout/stderr
Container runtime -> log file node
Log collector -> centralized logging
```

Jangan menulis file log di container kecuali ada alasan kuat.

Jika menulis file log:

- mount volume;
- rotate;
- ensure collector membaca file;
- monitor disk;
- handle permission.

### 19.3 GC Log

GC log bisa ke stdout atau file.

Untuk Java 9+:

```bash
-Xlog:gc*:stdout:time,uptime,level,tags
```

Atau file:

```bash
-Xlog:gc*:file=/var/log/acme/payment-service/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

Untuk Java 8, pakai legacy GC logging flags.

Rule:

```text
Application log and JVM diagnostic log are different streams, but both are operational evidence.
```

---

## 20. Diagnostics Directory: Heap Dump, hs_err, JFR, Thread Dump

Diagnostics harus dirancang sebelum incident.

### 20.1 Heap Dump

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/crash/acme/payment-service/heapdumps
```

Pertanyaan penting:

- apakah direktori writable?
- apakah disk cukup besar?
- apakah heap dump mengandung data sensitif?
- apakah heap dump dipersist setelah container restart?
- siapa yang boleh membaca?
- bagaimana retention?

Heap dump sering berisi PII, token, request body, cache, entity object, session data.

Jadi:

```text
Heap dump is sensitive production evidence.
Treat it like restricted data.
```

### 20.2 JVM Fatal Error Log

```bash
-XX:ErrorFile=/var/crash/acme/payment-service/hs_err_pid%p.log
```

`hs_err_pid` sangat penting untuk native crash, JVM crash, JNI issue, SIGSEGV, fatal VM error.

### 20.3 JFR

Java Flight Recorder sangat berguna untuk production diagnostics modern.

Contoh:

```bash
-XX:StartFlightRecording=filename=/var/crash/acme/payment-service/jfr/startup.jfr,dumponexit=true,settings=profile
```

Namun jangan asal selalu profile berat. Gunakan sesuai baseline dan overhead policy.

### 20.4 Thread Dump

Thread dump bisa diambil dengan:

```bash
jcmd <pid> Thread.print
jstack <pid>
kill -3 <pid>
```

Dalam container distroless, tool seperti `jcmd` mungkin tidak tersedia. Ini harus diputuskan pada image strategy:

```text
production image minimal vs debug image/tooling sidecar/ephemeral container
```

---

## 21. Port Binding dan Network Contract

Deployment harus eksplisit tentang:

- port aplikasi;
- bind address;
- management port;
- health endpoint;
- metrics endpoint;
- TLS termination;
- proxy headers;
- IPv4/IPv6;
- DNS resolution;
- ephemeral outbound ports;
- connection timeout;
- keepalive.

Contoh:

```text
server.address=0.0.0.0
server.port=8080
management.server.port=8081
```

Di container, bind ke `127.0.0.1` membuat service tidak bisa diakses dari luar container network.

```text
Local dev: 127.0.0.1 often works.
Container production: usually bind 0.0.0.0.
```

Tetapi jangan expose management endpoint ke public traffic.

Invariant:

```text
Business traffic, management traffic, and diagnostics traffic are different surfaces.
```

---

## 22. Environment Variables vs System Properties vs Config Files

Java punya beberapa input runtime:

```text
environment variable -> visible to process
system property      -> -Dkey=value, visible inside JVM
config file          -> parsed by application/framework
command argument     -> args[] or framework parser
secret file          -> external file mounted/injected
```

JDK `java` command juga memiliki launcher options dan dapat dipengaruhi oleh `JDK_JAVA_OPTIONS`.[^java-command]

### 22.1 Environment Variable

Kelebihan:

- mudah di container/Kubernetes;
- mudah override per environment;
- cocok untuk non-sensitive config sederhana.

Kekurangan:

- bisa terlihat di process environment;
- kurang cocok untuk large structured config;
- secret di env sering bocor ke diagnostics, crash report, process listing, CI logs;
- tidak ada type safety.

### 22.2 System Property

Kelebihan:

- native Java;
- explicit di command line;
- sering dipakai framework;
- cocok untuk JVM/app property kecil.

Kekurangan:

- bisa terlihat di command line/process info;
- command bisa panjang;
- raw secret di `-Dpassword=...` buruk.

### 22.3 Config File

Kelebihan:

- struktur kompleks;
- bisa versioned;
- bisa mounted;
- lebih mudah diaudit.

Kekurangan:

- reload complexity;
- permission harus benar;
- config drift;
- perlu precedence jelas.

Rule:

```text
Use env/system property for small runtime switches.
Use config files for structured config.
Use secret manager/secret volume for secrets.
Do not put secrets in command line unless no alternative and risk accepted.
```

---

## 23. Permission Model untuk Config dan Secret

Config dan secret harus dibedakan.

```text
Config: non-sensitive behavior/control values.
Secret: credential/key/token/private material.
```

Contoh permission:

```bash
/etc/acme/payment-service/application.yml   0640 root:payment-svc
/etc/acme/payment-service/jvm.options       0640 root:payment-svc
/etc/acme/payment-service/secrets/db.pass   0440 root:payment-svc
```

Container secret mount biasanya read-only.

Anti-pattern:

```text
chmod -R 777 /app
```

Ini bukan fix permission. Ini menghapus security boundary.

Rule:

```text
Permission error should be fixed by ownership model, not by making everything writable.
```

---

## 24. Read-Only Filesystem Strategy

Read-only filesystem memaksa aplikasi punya boundary yang bersih.

Di Kubernetes:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Konsekuensi:

- `/app` tidak bisa ditulis;
- `/tmp` mungkin tidak bisa ditulis kecuali dimount;
- framework yang menulis work dir harus diarahkan;
- heap dump path harus volume;
- app server temp/work directory harus volume;
- font/native cache harus diperhatikan;
- file upload temp harus explicit.

Untuk Java app, read-only filesystem bagus jika kita siapkan:

```text
/tmp           -> emptyDir
/diag          -> emptyDir or persistent volume
/work          -> emptyDir if app server needs it
/config        -> read-only config mount
/secrets       -> read-only secret mount
```

Invariant:

```text
If root filesystem is read-only, every writable need must be explicit.
```

---

## 25. systemd Deployment Contract

Untuk VM/bare metal Linux modern, systemd sering menjadi process manager.

Contoh unit:

```ini
[Unit]
Description=Acme Payment Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=payment-svc
Group=payment-svc
WorkingDirectory=/opt/acme/payment-service/current
EnvironmentFile=/etc/acme/payment-service/env
ExecStart=/opt/acme/payment-service/current/bin/start.sh
ExecStop=/bin/kill -TERM $MAINPID
Restart=on-failure
RestartSec=10
TimeoutStartSec=120
TimeoutStopSec=45
SuccessExitStatus=143
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal

# Hardening examples; validate per app requirement
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/acme/payment-service /var/log/acme/payment-service /var/tmp/acme/payment-service /var/crash/acme/payment-service

[Install]
WantedBy=multi-user.target
```

Poin penting:

### 25.1 `Type=simple`

Cocok jika process Java tetap foreground.

Jangan daemonize Java app sendiri di systemd kecuali tahu alasannya.

### 25.2 `ExecStart`

Harus menjalankan process foreground.

Jika wrapper, gunakan `exec`.

### 25.3 `Restart=on-failure`

Restart otomatis saat failure.

Tetapi hati-hati untuk configuration error:

```text
Bad config -> restart loop -> noisy incident.
```

Untuk configuration error, lebih baik app fail fast dan alert jelas.

### 25.4 `TimeoutStopSec`

Harus lebih besar dari graceful shutdown timeout aplikasi.

Jika app butuh 30 detik graceful shutdown:

```text
TimeoutStopSec >= 35-45 seconds
```

### 25.5 `SuccessExitStatus=143`

Exit code 143 sering berarti terminated by SIGTERM. Dalam beberapa setup, ini bisa dianggap successful intended stop.

### 25.6 Hardening

`ProtectSystem=strict`, `PrivateTmp`, `NoNewPrivileges`, dan `ReadWritePaths` dapat memperkuat service, tetapi harus diuji karena bisa memblokir kebutuhan tulis aplikasi.

Systemd unit adalah file konfigurasi yang mendeskripsikan unit dan behavior; Red Hat juga menekankan unit file sebagai directive konfigurasi untuk service behavior.[^redhat-systemd]

---

## 26. Windows Service Deployment Contract

Tidak semua Java production berjalan di Linux.

Di Windows, aplikasi Java sering dijalankan sebagai service melalui:

- Apache Commons Daemon/procrun;
- WinSW;
- NSSM;
- vendor app server service wrapper;
- custom Windows Service wrapper.

Contract yang tetap sama:

```text
artifact path
runtime path
working directory
service account
config path
log path
restart policy
stop timeout
stdout/stderr handling
environment variables
```

Windows-specific concerns:

- service account permission;
- path with spaces;
- CRLF script differences;
- Windows certificate store vs Java truststore;
- log rotation;
- file locking during deployment;
- antivirus scanning JAR/log/temp;
- long path limits in older setups;
- service stop timeout;
- event viewer integration.

Example conceptual WinSW config:

```xml
<service>
  <id>payment-service</id>
  <name>Payment Service</name>
  <description>Acme Payment Service</description>
  <executable>C:\Java\jdk-21\bin\java.exe</executable>
  <arguments>-Dfile.encoding=UTF-8 -Djava.io.tmpdir=C:\Acme\payment-service\tmp -jar C:\Acme\payment-service\current\app.jar</arguments>
  <workingdirectory>C:\Acme\payment-service\current</workingdirectory>
  <logpath>C:\Acme\payment-service\logs</logpath>
  <onfailure action="restart" delay="10 sec" />
  <stoptimeout>45 sec</stoptimeout>
</service>
```

Java engineer yang top-tier tidak menganggap Windows “sekadar beda slash”. Service lifecycle, account, file lock, dan certificate integration bisa sangat berbeda.

---

## 27. Application Server Runtime Layout

Untuk WAR/EAR di Tomcat/WildFly/Payara/WebLogic/WebSphere/Open Liberty, process Java bukan aplikasi kita langsung. Process utama adalah server.

Mental model berubah:

```text
OS process = application server
Deployed unit = WAR/EAR/application artifact inside server runtime
```

Layout harus membedakan:

```text
server installation      -> immutable runtime
server configuration     -> environment/server config
application deployment   -> versioned deployable artifact
server work/temp         -> mutable runtime
server logs              -> operational evidence
shared libraries         -> explicit compatibility boundary
```

Contoh conceptual:

```text
/opt/wildfly/
  bin/
  modules/
  standalone/
    configuration/
    deployments/
    log/
    tmp/
    data/
```

Risiko umum:

- deploy WAR langsung ke folder server tanpa versioning;
- shared library berubah untuk satu app dan memecahkan app lain;
- server tmp/work tidak dibersihkan;
- datasource config manual drift;
- app server berjalan sebagai user terlalu privileged;
- hot deploy di production tanpa release control;
- rollback tidak jelas karena exploded WAR tertimpa.

Invariant:

```text
When deploying to an application server, the server itself is a runtime platform with its own lifecycle, config, state, logs, and patch cadence.
```

---

## 28. PID File dan Runtime Directory

PID file umum di deployment VM:

```text
/var/run/acme/payment-service/payment-service.pid
```

Tetapi dengan systemd, PID file sering tidak perlu untuk `Type=simple` karena systemd melacak main process.

PID file berguna jika:

- legacy init script;
- external monitoring lama;
- custom control script;
- multiple instance management.

Masalah PID file:

- stale PID setelah crash;
- PID reuse;
- permission error;
- race condition saat start;
- script membunuh process salah.

Rule:

```text
Prefer process manager native tracking over manual PID file.
Use PID file only when required by supervisor model.
```

---

## 29. Lock File, Local State, dan Multi-Instance Risk

Beberapa Java app membuat lock file atau local state:

```text
/var/lib/app/job.lock
/var/lib/app/checkpoint.dat
/var/lib/app/local-cache.db
```

Di single VM, ini mungkin aman.

Di multi-instance/Kubernetes, ini bisa berbahaya:

```text
Instance A thinks it owns job.
Instance B has different local lock.
Both run same scheduler.
Duplicate processing occurs.
```

Rule:

```text
Local lock only coordinates inside one filesystem boundary.
Distributed deployment needs distributed coordination or idempotent processing.
```

Untuk scheduler/job:

- gunakan database lock;
- gunakan Quartz clustered mode;
- gunakan Kubernetes CronJob dengan concurrency policy;
- gunakan leader election;
- gunakan message queue dengan competing consumers;
- desain idempotency.

---

## 30. File Upload dan Local Disk

Aplikasi enterprise sering memproses upload:

- document upload;
- report generation;
- batch import;
- scanned PDF;
- Excel parsing;
- generated ZIP;
- temporary image processing.

Deployment harus menentukan:

```text
Where does upload buffering happen?
How large can it be?
Is disk encrypted?
Is temp cleaned?
Can multiple pods access it?
Is it safe if pod dies halfway?
Is file persisted before response?
```

Pattern sehat:

```text
small upload -> memory threshold -> temp directory -> object storage/database after validation
large upload -> direct object storage multipart/pre-signed upload or streaming pipeline
```

Anti-pattern:

```text
Upload to local disk in pod, then async process later without persistent volume.
```

Jika pod mati, file hilang.

Invariant:

```text
Local filesystem is not durable unless explicitly designed as durable.
```

---

## 31. Timezone, Locale, Encoding Contract

Deployment Java harus eksplisit tentang:

```bash
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-Duser.language=en
-Duser.country=US
```

Tidak semua aplikasi harus UTC untuk display, tetapi runtime processing sebaiknya konsisten.

Masalah umum:

- server timezone berbeda antar node;
- log timestamp tidak bisa dikorelasikan;
- date parsing berbeda;
- decimal separator locale berubah;
- CSV export berbeda;
- file encoding default berubah;
- Java 18+ default charset menjadi UTF-8 melalui JEP 400, tetapi Java 8/11 behavior bisa bergantung OS locale.

Untuk deployment lintas Java 8–25, explicit encoding sangat penting.

Rule:

```text
Do not rely on host default timezone, charset, or locale.
```

---

## 32. CA Certificates, Truststore, and OS/JDK Boundary

Java TLS memakai truststore Java, bukan selalu OS trust store.

Deployment harus menjawab:

- JDK truststore berasal dari mana?
- Apakah corporate CA masuk?
- Apakah mTLS client cert dipakai?
- Apakah truststore baked into image atau mounted?
- Bagaimana rotasi certificate?
- Bagaimana expiry dimonitor?
- Apakah Java 8 dan Java 21 punya default disabled algorithms berbeda?

Common paths:

```text
$JAVA_HOME/lib/security/cacerts
```

Custom:

```bash
-Djavax.net.ssl.trustStore=/etc/acme/payment-service/truststore.p12
-Djavax.net.ssl.trustStorePassword=changeit
-Djavax.net.ssl.trustStoreType=PKCS12
```

Password di command line buruk jika sensitif. Lebih baik file/secret manager jika memungkinkan.

Invariant:

```text
TLS trust is deployment configuration, not just application code.
```

Certificate rotation akan dibahas lebih dalam di Part 20.

---

## 33. Native Libraries dan OS Compatibility

Java sering dianggap platform-independent, tetapi deployment bisa bergantung native component:

- JNI/JNA library;
- compression library;
- image processing;
- font rendering;
- netty native transport;
- tcnative/OpenSSL;
- database wallet/native client;
- Kerberos/GSSAPI;
- OS DNS resolver;
- glibc/musl differences;
- architecture x86_64/aarch64.

Jika memakai Alpine Linux, perbedaan musl vs glibc bisa berdampak pada library tertentu.

Jika memakai distroless, shell dan debugging tools tidak ada.

Rule:

```text
Java portability ends at the boundary of native dependency, OS package, libc, CPU architecture, and certificate/DNS behavior.
```

Deployment verification harus memasukkan native dependency checks jika ada.

---

## 34. DNS, `/etc/hosts`, Resolver, and Runtime Surprises

Aplikasi Java bergantung DNS untuk:

- database endpoint;
- service discovery;
- OAuth/JWKS endpoint;
- object storage;
- message broker;
- external API;
- SMTP;
- LDAP;
- Redis;
- internal service.

Deployment concerns:

- DNS caching JVM;
- OS resolver config;
- Kubernetes CoreDNS;
- Route53/private hosted zone;
- `/etc/hosts` injection;
- IPv6 preference;
- stale IP after failover;
- TTL ignored/misunderstood;
- negative DNS caching.

Java DNS cache can be affected by security properties and runtime behavior. For production, do not assume every DNS change is immediately respected by a long-running JVM.

Deployment strategy:

- use stable DNS names;
- set timeout on clients;
- avoid infinite DNS cache if failover required;
- understand JVM/networkaddress.cache.ttl;
- restart may be required in some incidents;
- test DNS failover behavior.

Invariant:

```text
Endpoint hostname is configuration. Resolved IP is runtime state.
```

---

## 35. Process Manager vs Application Health

A process manager can know:

```text
process exists or exited
exit code
restart count
resource limits
logs/stdout/stderr
```

But process manager may not know:

```text
DB pool exhausted
thread pool deadlocked
message consumer stuck
readiness false
cache unavailable
business dependency down
migration half-applied
```

So deployment needs both:

```text
process supervision + application health model
```

In systemd:

- process alive is not enough;
- watchdog can be added for advanced cases;
- external health check may be needed.

In Kubernetes:

- liveness = should container be restarted?
- readiness = should traffic be sent?
- startup = is slow startup still acceptable?

This will be deep-dived in Part 15.

---

## 36. Restart Policy

Restart policy must distinguish failure types.

### 36.1 Good Restart Candidate

- transient network issue;
- deadlock not recoverable;
- memory leak after OOM;
- corrupted in-memory state;
- dependency unavailable at startup but later restored.

### 36.2 Bad Restart Candidate

- invalid config;
- missing secret;
- incompatible DB schema;
- port already in use due to duplicate instance;
- permission error;
- wrong Java version;
- bad artifact.

Restarting bad config repeatedly creates noise and hides root cause.

Rule:

```text
Restart policy is not a substitute for startup validation.
```

Application should fail fast with clear logs when contract is invalid.

---

## 37. Startup Validation

Production Java app should validate runtime assumptions at startup:

- required config exists;
- secret file readable;
- writable temp directory exists;
- diagnostics directory writable if configured;
- DB connectivity if required before serving;
- migration compatibility;
- required external endpoint config present;
- keystore/truststore readable;
- local cache directory permission;
- port binding works;
- profile/environment allowed;
- Java version supported.

Example:

```java
static void validateRuntimeContract() {
    requireWritableDirectory(Paths.get(System.getProperty("java.io.tmpdir")));
    requireReadableFile(Paths.get(System.getProperty("app.config.file")));
    requireJavaVersionAtLeast(17);
}
```

But be careful:

```text
Do not make optional dependency startup check block app if app can run degraded by design.
```

Startup validation should reflect availability strategy.

---

## 38. Release Symlink Pattern

On VM/bare metal, symlink release pattern is powerful.

```text
/opt/acme/payment-service/releases/2026-06-18T120000Z-git-a1b2c3d
/opt/acme/payment-service/releases/2026-06-10T090000Z-git-9f8e7d6
/opt/acme/payment-service/current -> releases/2026-06-18T120000Z-git-a1b2c3d
```

Deploy new version:

```bash
NEW_RELEASE=/opt/acme/payment-service/releases/2026-06-18T120000Z-git-a1b2c3d

# verify checksum
sha256sum -c "$NEW_RELEASE/checksums.sha256"

# switch atomically
ln -sfn "$NEW_RELEASE" /opt/acme/payment-service/current

# restart
systemctl restart payment-service
```

Rollback:

```bash
ln -sfn /opt/acme/payment-service/releases/2026-06-10T090000Z-git-9f8e7d6 /opt/acme/payment-service/current
systemctl restart payment-service
```

Caveats:

- app must not write into `current`;
- config externalized;
- database migration may not be rollbackable;
- running process may hold old file handles;
- cleanup old releases only after retention window.

Invariant:

```text
Filesystem rollback only works if runtime state and schema are backward compatible.
```

---

## 39. Atomicity of Deployment Operations

Deployment operation should avoid half-state.

Bad:

```bash
cp app.jar /opt/app/app.jar
systemctl restart app
```

If copy interrupted, artifact corrupt.

Better:

```bash
cp app.jar /opt/app/releases/new/app.jar.tmp
sha256sum -c checksums.sha256
mv app.jar.tmp app.jar
ln -sfn /opt/app/releases/new /opt/app/current
systemctl restart app
```

Container equivalent:

```text
Do not mutate running container.
Build new image -> push immutable tag/digest -> deploy new pod.
```

Kubernetes should deploy by image digest or immutable tag policy, not mutable `latest`.

---

## 40. Runtime Manifest

Each release should include manifest metadata.

Example `manifest.json`:

```json
{
  "service": "payment-service",
  "version": "1.42.0",
  "gitCommit": "a1b2c3d4",
  "buildTime": "2026-06-18T12:00:00Z",
  "javaTarget": "21",
  "runtimeTested": ["Eclipse Temurin 21.0.7"],
  "artifactSha256": "...",
  "sbom": "sbom.json",
  "buildPipeline": "jenkins/payment-service/1842"
}
```

Expose via endpoint:

```text
/actuator/info
/version
/build-info
```

Or log at startup:

```text
Starting payment-service version=1.42.0 git=a1b2c3d4 build=2026-06-18T12:00:00Z java=21.0.7 vendor=Eclipse Adoptium
```

Invariant:

```text
At runtime, operator must be able to know exactly what version is running.
```

---

## 41. Runtime User Journey: Start

A clean start sequence:

```text
1. process manager starts service
2. Java command executes
3. JVM parses options
4. classpath/module path resolved
5. application bootstrap starts
6. config loaded
7. runtime contract validated
8. logging initialized
9. database/cache/queue clients initialized
10. HTTP server binds port
11. health/readiness transitions to ready
12. traffic starts
```

Failure classification:

| Stage | Failure Example | Likely Root Cause |
|---|---|---|
| JVM parse | unrecognized VM option | wrong Java version/flag |
| classpath | NoClassDefFoundError | artifact/dependency issue |
| config load | missing config | deployment config issue |
| validation | temp not writable | permission/layout issue |
| dependency init | DB auth failed | secret/network issue |
| bind | port in use | duplicate process/config issue |
| ready | readiness false | app/dependency health issue |

This classification speeds up incident triage.

---

## 42. Runtime User Journey: Stop

A clean stop sequence:

```text
1. operator/orchestrator requests stop
2. process receives SIGTERM
3. readiness becomes false
4. traffic drains
5. new work rejected
6. in-flight work completes or times out
7. resources close
8. logs/metrics flushed
9. JVM exits
10. process manager records stop
```

Failure classification:

| Stage | Failure Example | Likely Root Cause |
|---|---|---|
| signal | app ignores SIGTERM | wrapper/PID1 issue |
| readiness | still receives traffic | probe/LB drain issue |
| work drain | duplicate jobs | queue/scheduler shutdown issue |
| resource close | timeout | long transaction/thread stuck |
| forced kill | exit 137 | grace period too short/hang/OOM |

---

## 43. Runtime User Journey: Restart

Restart is stop + start, but risks compound.

Systemd documentation notes restart operations are implemented as stop followed by start in service management contexts.[^systemd-service-ubuntu]

Restart failure pattern:

```text
Old process receives SIGTERM
New process starts too early
Port still in use
Health check fails
Restart loop begins
```

Or:

```text
Old process drains queue
New process also consumes queue
Duplicate processing occurs
```

Rule:

```text
Restart is a state transition, not a button.
```

---

## 44. Runtime User Journey: Rollback

Rollback is not simply “run old JAR”.

Rollback must check:

- old artifact still available;
- old runtime compatible;
- config compatible;
- secret compatible;
- DB schema compatible;
- message schema compatible;
- cache format compatible;
- session format compatible;
- file format compatible;
- feature flags compatible;
- traffic routing clean.

Filesystem layout helps rollback artifact. It does not solve data compatibility.

Invariant:

```text
Rollback is only safe if external state remains compatible with the old version.
```

---

## 45. Runtime Security Boundary

At OS level, Java deployment security includes:

- non-root user;
- least privilege file permission;
- read-only artifact;
- no writable app binary path;
- no world-readable secrets;
- limited outbound network if possible;
- management endpoint isolation;
- no debug port exposed;
- JMX secured or disabled;
- heap dump protected;
- no shell in production image unless required;
- no package manager in minimal image unless accepted;
- no embedded admin credential in config;
- no `chmod 777`.

Deployment hardening is not optional decoration.

It defines the blast radius when something goes wrong.

---

## 46. Practical systemd Example: End-to-End

Directory creation:

```bash
sudo mkdir -p /opt/acme/payment-service/releases
sudo mkdir -p /etc/acme/payment-service
sudo mkdir -p /var/lib/acme/payment-service
sudo mkdir -p /var/log/acme/payment-service
sudo mkdir -p /var/tmp/acme/payment-service
sudo mkdir -p /var/crash/acme/payment-service/{heapdumps,hs_err,jfr}

sudo useradd --system --no-create-home --shell /usr/sbin/nologin payment-svc || true

sudo chown -R root:root /opt/acme/payment-service
sudo chown -R root:payment-svc /etc/acme/payment-service
sudo chown -R payment-svc:payment-svc /var/lib/acme/payment-service
sudo chown -R payment-svc:payment-svc /var/log/acme/payment-service
sudo chown -R payment-svc:payment-svc /var/tmp/acme/payment-service
sudo chown -R payment-svc:payment-svc /var/crash/acme/payment-service

sudo chmod 0755 /opt/acme/payment-service
sudo chmod 0750 /etc/acme/payment-service
sudo chmod 0750 /var/lib/acme/payment-service
sudo chmod 0750 /var/log/acme/payment-service
sudo chmod 0750 /var/tmp/acme/payment-service
sudo chmod 0750 /var/crash/acme/payment-service
```

`/etc/acme/payment-service/jvm.options`:

```text
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
-Djava.io.tmpdir=/var/tmp/acme/payment-service
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/crash/acme/payment-service/heapdumps
-XX:ErrorFile=/var/crash/acme/payment-service/hs_err/hs_err_pid%p.log
-Xlog:gc*:file=/var/log/acme/payment-service/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

`/etc/acme/payment-service/env`:

```bash
APP_ENV=prod
APP_CONFIG_FILE=/etc/acme/payment-service/application.yml
JAVA_HOME=/usr/lib/jvm/temurin-21
```

`start.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_HOME=/opt/acme/payment-service/current
CONFIG_DIR=/etc/acme/payment-service
JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/temurin-21}

JAVA_OPTS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  JAVA_OPTS+=("$line")
done < "$CONFIG_DIR/jvm.options"

exec "$JAVA_HOME/bin/java" \
  "${JAVA_OPTS[@]}" \
  -Dapp.config.file="$APP_CONFIG_FILE" \
  -jar "$APP_HOME/app.jar"
```

Unit:

```ini
[Unit]
Description=Acme Payment Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=payment-svc
Group=payment-svc
WorkingDirectory=/opt/acme/payment-service/current
EnvironmentFile=/etc/acme/payment-service/env
ExecStart=/opt/acme/payment-service/current/bin/start.sh
Restart=on-failure
RestartSec=10
TimeoutStartSec=120
TimeoutStopSec=45
SuccessExitStatus=143
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/acme/payment-service /var/log/acme/payment-service /var/tmp/acme/payment-service /var/crash/acme/payment-service

[Install]
WantedBy=multi-user.target
```

Deploy:

```bash
RELEASE_ID="2026-06-18T120000Z-git-a1b2c3d"
RELEASE_DIR="/opt/acme/payment-service/releases/$RELEASE_ID"

sudo mkdir -p "$RELEASE_DIR/bin"
sudo cp app.jar "$RELEASE_DIR/app.jar"
sudo cp start.sh "$RELEASE_DIR/bin/start.sh"
sudo chmod 0555 "$RELEASE_DIR/bin/start.sh"
sudo chown -R root:root "$RELEASE_DIR"
sudo chmod -R go-w "$RELEASE_DIR"

cd "$RELEASE_DIR"
sha256sum app.jar > checksums.sha256

sudo ln -sfn "$RELEASE_DIR" /opt/acme/payment-service/current
sudo systemctl daemon-reload
sudo systemctl restart payment-service
sudo systemctl status payment-service --no-pager
```

Verify:

```bash
systemctl is-active payment-service
journalctl -u payment-service -n 100 --no-pager
curl -fsS http://localhost:8080/actuator/health
```

---

## 47. Practical Container Example: End-to-End

Dockerfile:

```dockerfile
FROM eclipse-temurin:21-jre

ARG APP_VERSION
ARG GIT_COMMIT

LABEL org.opencontainers.image.title="payment-service" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_COMMIT"

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app
COPY --chown=root:root app.jar /app/app.jar
RUN chmod 0444 /app/app.jar \
 && mkdir -p /tmp/app /diag/heapdumps /diag/hs_err /diag/jfr \
 && chown -R app:app /tmp/app /diag

USER 10001:10001

ENV JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8 -Duser.timezone=UTC -Djava.io.tmpdir=/tmp/app -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/diag/heapdumps -XX:ErrorFile=/diag/hs_err/hs_err_pid%p.log"

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kubernetes snippet:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: payment-service
          image: registry.example.com/payment-service@sha256:...
          ports:
            - containerPort: 8080
          env:
            - name: APP_ENV
              value: prod
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            runAsGroup: 10001
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: diag
              mountPath: /diag
            - name: config
              mountPath: /config
              readOnly: true
            - name: secrets
              mountPath: /secrets
              readOnly: true
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 5
            failureThreshold: 24
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 2Gi
        - name: diag
          emptyDir:
            sizeLimit: 4Gi
        - name: config
          configMap:
            name: payment-service-config
        - name: secrets
          secret:
            secretName: payment-service-secrets
```

Note:

```text
readOnlyRootFilesystem=true forces /tmp and /diag to be explicit.
terminationGracePeriodSeconds must align with application shutdown timeout.
```

---

## 48. Common Failure Modes and Diagnosis

### 48.1 Permission Denied at Startup

Symptom:

```text
java.nio.file.AccessDeniedException: /var/tmp/app
```

Likely cause:

- wrong ownership;
- read-only filesystem;
- wrong UID in container;
- mounted volume overrides image directory permission.

Diagnosis:

```bash
id
ls -ld /var/tmp/app
mount | grep app
```

Fix:

- correct ownership;
- explicit writable mount;
- init container chown if allowed;
- avoid writing to artifact path.

### 48.2 App Ignores Shutdown

Symptom:

```text
Pod stuck Terminating then killed.
Exit code 137.
```

Likely cause:

- shell wrapper does not `exec`;
- non-daemon thread stuck;
- shutdown hook hangs;
- thread pool not closed;
- long DB transaction;
- grace period too short.

Diagnosis:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
jcmd <pid> Thread.print
```

Fix:

- use exec form ENTRYPOINT;
- implement graceful shutdown;
- reduce shutdown hook work;
- set bounded timeout;
- align termination grace period.

### 48.3 Heap Dump Not Created

Symptom:

```text
OutOfMemoryError happened, but no heap dump file.
```

Likely cause:

- HeapDumpOnOutOfMemoryError not enabled;
- path not writable;
- disk too small;
- container killed by cgroup before Java OOME;
- OOMKilled by kernel, not Java heap OOME.

Fix:

- set heap dump path;
- writable diagnostics volume;
- memory sizing;
- monitor OOMKilled vs Java OOME.

### 48.4 Log Missing

Symptom:

```text
App running but no logs in centralized system.
```

Likely cause:

- logs written to file not collected;
- stdout buffered/unflushed;
- logging config points to unwritable file;
- container logging driver issue;
- multiline parser drops stack traces.

Fix:

- stdout/stderr in container;
- configure collector;
- verify log format;
- avoid hidden file logs.

### 48.5 Works Locally, Fails in systemd

Likely differences:

- working directory;
- environment variables not loaded;
- user permission;
- PATH/JAVA_HOME;
- timezone/locale;
- ulimit;
- current directory relative paths;
- no interactive shell profile.

Rule:

```text
systemd does not run your login shell.
```

Make every dependency explicit.

---

## 49. Runtime Layout Checklist

Use this before production deployment.

### Artifact

- [ ] Artifact path immutable.
- [ ] Artifact checksum stored.
- [ ] Release version identifiable.
- [ ] Previous release retained for rollback.
- [ ] Application does not write to artifact directory.

### Runtime

- [ ] Java version explicit.
- [ ] Java vendor/distribution known.
- [ ] JVM options version-compatible.
- [ ] Java command version-controlled.
- [ ] No hidden global `JDK_JAVA_OPTIONS` surprise.

### Identity

- [ ] Dedicated OS/container user.
- [ ] Non-root in production.
- [ ] File ownership model documented.
- [ ] No `chmod 777`.
- [ ] Secrets not world-readable.

### Filesystem

- [ ] Working directory explicit.
- [ ] Temp directory explicit.
- [ ] Writable directories explicit.
- [ ] Diagnostics directory writable.
- [ ] Logs path/strategy explicit.
- [ ] Read-only filesystem tested if used.

### Lifecycle

- [ ] Signal path tested.
- [ ] Wrapper uses `exec`.
- [ ] Graceful shutdown timeout configured.
- [ ] Process manager stop timeout aligned.
- [ ] Restart policy intentional.
- [ ] Startup validation implemented.

### Observability

- [ ] Startup logs include version/runtime.
- [ ] Logs collected centrally.
- [ ] GC logs policy defined.
- [ ] Heap dump/JFR/hs_err path defined.
- [ ] Health endpoint separated from process liveness.

### Network

- [ ] Bind address correct.
- [ ] Port explicit.
- [ ] Management endpoint protected.
- [ ] DNS behavior understood.
- [ ] TLS truststore/cert path explicit.

### Operations

- [ ] Start procedure documented.
- [ ] Stop procedure documented.
- [ ] Restart procedure documented.
- [ ] Rollback procedure documented.
- [ ] Cleanup policy documented.

---

## 50. Senior-Level Reasoning Patterns

### Pattern 1: “Can the app modify itself?”

If yes, deployment boundary is weak.

```text
Artifact should be immutable to the app process.
```

### Pattern 2: “Can we kill this process safely?”

If no, lifecycle contract is weak.

```text
SIGTERM behavior must be tested, not assumed.
```

### Pattern 3: “Can we tell what version is running?”

If no, auditability is weak.

```text
Runtime version identity must be observable.
```

### Pattern 4: “Can this app survive read-only filesystem?”

If no, writable assumptions are hidden.

```text
Writable paths should be explicit.
```

### Pattern 5: “Can rollback be done without touching state?”

If no, release and state are coupled.

```text
Artifact rollback and state rollback are different problems.
```

### Pattern 6: “Will diagnostics exist after failure?”

If no, incident recovery is guesswork.

```text
Diagnostic output must be planned before incident.
```

---

## 51. What Top 1% Engineers Internalize

A top-tier Java deployment engineer understands that production runtime is a system of contracts.

They do not stop at:

```text
java -jar app.jar works
```

They ask:

```text
Under which user?
With which JDK?
With which JVM options?
From which working directory?
Writing to which paths?
Receiving which signals?
Restarted by whom?
Observed how?
Killed after what deadline?
Rolling back to what artifact?
With what state compatibility?
```

They see filesystem, process, permission, signal, and service manager as first-class parts of Java deployment architecture.

---

## 52. Summary

Part ini membangun mental model bahwa Java deployment bukan sekadar menjalankan artifact.

Java application production harus memiliki:

1. immutable artifact layout;
2. explicit mutable state layout;
3. dedicated process identity;
4. clear working directory;
5. explicit writable paths;
6. managed temp directory;
7. log and diagnostics contract;
8. lifecycle/signal handling;
9. restart and rollback model;
10. OS/container security boundary;
11. process manager integration;
12. observable runtime version.

Jika Part 0 memberi peta besar deployment, Part 4 memberi fondasi OS-level agar aplikasi Java benar-benar bisa hidup di production secara aman dan operable.

---

## 53. Referensi

[^java-command]: Oracle Java SE 21 `java` command documentation describes the Java launcher and `JDK_JAVA_OPTIONS` behavior. https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html

[^systemd-service]: `systemd.service(5)` documents service unit configuration for processes controlled and supervised by systemd. https://man7.org/linux/man-pages/man5/systemd.service.5.html

[^redhat-systemd]: Red Hat Enterprise Linux documentation explains systemd unit files as configuration directives describing units and their behavior. https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_systemd_unit_files_to_customize_and_optimize_your_system/assembly_working-with-systemd-unit-files_working-with-systemd

[^spring-graceful]: Spring Boot reference documentation covers graceful shutdown and notes SIGTERM behavior. https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html

[^k8s-hooks]: Kubernetes documentation explains container lifecycle hooks, including `PreStop` and termination grace period semantics. https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/

[^systemd-service-ubuntu]: Ubuntu manpage for `systemd.service` notes service restart requests are implemented as stop operations followed by start operations. https://manpages.ubuntu.com/manpages/focal/man5/systemd.service.5.html

---

## 54. Status Series

Saat ini selesai:

- Part 0 — Deployment Mental Model
- Part 1 — Java Deployment Evolution: Java 8 to Java 25
- Part 2 — Artifact Taxonomy
- Part 3 — Runtime Selection Engineering
- Part 4 — Java Runtime Layout: Filesystem, Process, User, Permissions, and OS Contracts

Series belum selesai.

Berikutnya:

**Part 5 — Configuration Deployment: Config Files, Env Vars, System Properties, Secrets, Profiles**

