# learn-java-deployment-runtime-release-delivery-engineering

## Part 7 — Packaging for Linux Servers: Bare Metal, VM, systemd, and Traditional Ops

> Seri: **Java Deployment Runtime Release Delivery Engineering**  
> Target: Java 8 sampai Java 25  
> Fokus: deployment Java di Linux server, VM, bare metal, systemd, layout rilis, operational contract, upgrade, rollback, dan runbook tradisional.

---

## 0. Kenapa Part Ini Penting?

Banyak engineer modern langsung melompat ke Docker dan Kubernetes. Itu tidak salah, tetapi ada satu kelemahan besar: mereka sering tidak memahami apa yang sebenarnya terjadi ketika Java application menjadi **proses Linux**.

Container tidak menghapus realitas OS. Container hanya membungkusnya.

Di bawah Kubernetes pun tetap ada:

- executable process;
- working directory;
- environment variable;
- user dan permission;
- filesystem writable/read-only;
- signal seperti `SIGTERM`;
- stdout/stderr;
- file descriptor;
- process exit code;
- memory limit;
- CPU scheduling;
- log lifecycle;
- restart policy;
- health verification;
- rollback procedure.

Jadi memahami deployment Java di Linux server adalah fondasi untuk memahami deployment Java di container, Kubernetes, systemd service, VM, app server, dan bahkan platform enterprise lama.

Bagian ini membahas cara membuat Java application benar-benar **operable** ketika dijalankan di bare metal atau VM.

---

## 1. Mental Model: Deployment Java di Linux Adalah Kontrak antara Artifact, Runtime, dan OS

Sebuah aplikasi Java production bukan hanya file `.jar`.

Aplikasi production adalah kombinasi dari:

```text
Application Artifact
  + Java Runtime
  + JVM Options
  + External Configuration
  + OS User
  + Filesystem Layout
  + Service Manager
  + Logging Policy
  + Restart Policy
  + Health Check
  + Upgrade/Rollback Procedure
  + Operational Runbook
```

Kalau salah satu bagian tidak eksplisit, sistem tetap bisa berjalan, tetapi operasinya rapuh.

Contoh:

- JAR benar, tapi user permission salah → app gagal membaca config.
- JVM benar, tapi working directory salah → relative path rusak.
- Service hidup, tapi readiness tidak diverifikasi → traffic masuk ke app yang belum siap.
- Restart otomatis aktif, tapi failure karena bad config → restart loop.
- Log ditulis ke file, tapi tidak dirotasi → disk penuh.
- Deployment replace file in-place → rollback tidak deterministik.
- Secret disimpan di artifact → rebuild diperlukan untuk rotation.
- Java process jalan sebagai `root` → blast radius terlalu besar.

Top 1% deployment engineer tidak hanya bertanya:

> “Bagaimana menjalankan JAR ini?”

Tetapi bertanya:

> “Apa kontrak runtime yang membuat JAR ini aman dijalankan, mudah diganti, mudah dipantau, mudah dihentikan, dan mudah dikembalikan?”

---

## 2. Deployment Unit vs Runtime Unit vs Service Unit

Ada tiga konsep yang harus dipisahkan.

### 2.1 Deployment Unit

Deployment unit adalah sesuatu yang dipromosikan dari environment ke environment.

Contoh:

- `my-service-1.8.3.jar`
- `my-service-1.8.3.tar.gz`
- `my-service-1.8.3.rpm`
- `my-service-1.8.3.deb`
- `my-service-1.8.3.war`
- `my-service-1.8.3.zip`

Deployment unit harus immutable.

Artinya:

- isi tidak berubah setelah dibuat;
- version jelas;
- checksum bisa dihitung;
- artifact yang sama bisa dipasang ulang;
- artifact yang sama bisa dipromosikan ke UAT/PROD;
- tidak ada config environment-specific di dalam artifact.

### 2.2 Runtime Unit

Runtime unit adalah aplikasi yang benar-benar dijalankan.

Contoh:

```bash
/usr/lib/jvm/temurin-21/bin/java \
  -Xms512m \
  -Xmx1024m \
  -XX:+ExitOnOutOfMemoryError \
  -jar /opt/my-service/current/app/my-service.jar
```

Runtime unit mencakup:

- Java binary;
- JVM flags;
- classpath/module path;
- working directory;
- environment;
- config path;
- process user;
- stdout/stderr target;
- signal behavior;
- exit code.

### 2.3 Service Unit

Service unit adalah definisi bagaimana OS mengelola runtime unit.

Di Linux modern biasanya memakai systemd.

Contoh:

```ini
[Unit]
Description=My Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=myservice
Group=myservice
WorkingDirectory=/opt/my-service/current
EnvironmentFile=/etc/my-service/my-service.env
ExecStart=/opt/my-service/current/bin/start.sh
Restart=on-failure
RestartSec=10
SuccessExitStatus=143
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
```

Service unit menjawab:

- kapan service boleh start;
- user apa yang dipakai;
- command apa yang dijalankan;
- working directory apa;
- environment dari mana;
- restart policy apa;
- timeout stop berapa;
- bagaimana service di-enable saat boot.

---

## 3. Deployment Layout yang Baik

Salah satu kesalahan umum deployment tradisional adalah menaruh semua hal di satu folder acak.

Contoh buruk:

```text
/home/admin/app
  app.jar
  config.properties
  logs/
  nohup.out
  start.sh
  old-app.jar
  backup-final.jar
  app-new.jar
```

Ini berbahaya karena:

- tidak jelas versi mana yang aktif;
- rollback manual dan rawan salah;
- config bercampur dengan artifact;
- log bercampur dengan binary;
- permission sering terlalu longgar;
- deployment tergantung user admin;
- sulit diaudit.

### 3.1 Layout Production yang Lebih Disiplin

Contoh layout:

```text
/opt/my-service/
  releases/
    2026-06-18T140500Z-1.8.3-a1b2c3d/
      app/
        my-service.jar
      bin/
        start.sh
        stop-check.sh
        smoke-check.sh
      lib/
      VERSION
      CHECKSUMS
    2026-06-10T091200Z-1.8.2-f9e8d7c/
      app/
      bin/
      VERSION
  current -> /opt/my-service/releases/2026-06-18T140500Z-1.8.3-a1b2c3d

/etc/my-service/
  my-service.env
  application.yml
  logging.xml
  secrets.d/

/var/log/my-service/
  application.log
  gc.log
  access.log

/var/lib/my-service/
  data/
  cache/
  state/

/run/my-service/
  my-service.pid
  sockets/

/tmp/my-service/
  scratch/
```

Pemisahan ini memberi kejelasan:

| Path | Fungsi | Mutable? |
|---|---:|---:|
| `/opt/my-service/releases/*` | artifact dan script versi tertentu | immutable setelah deploy |
| `/opt/my-service/current` | symlink ke versi aktif | berubah saat switch release |
| `/etc/my-service` | config environment-specific | mutable terkendali |
| `/var/log/my-service` | log file | mutable |
| `/var/lib/my-service` | state/data lokal | mutable |
| `/run/my-service` | runtime transient files | mutable, hilang saat reboot |
| `/tmp/my-service` | temporary scratch | mutable, tidak dijamin persistent |

### 3.2 Invariant Layout

Deployment layout yang baik punya invariant berikut:

1. Artifact tidak diedit setelah dipasang.
2. Config tidak berada di dalam artifact.
3. Log tidak berada di dalam release directory.
4. State tidak berada di dalam release directory.
5. Versi aktif ditunjuk oleh symlink `current`.
6. Rollback cukup mengganti symlink ke release sebelumnya.
7. Semua path penting eksplisit di service unit atau env file.
8. Application tidak bergantung pada home directory user.
9. Application tidak perlu permission tulis ke `/opt` kecuali saat deploy oleh deploy user.
10. Runtime user hanya punya permission minimum.

---

## 4. Release Directory dan Symlink Pattern

Pattern paling sederhana dan kuat untuk deployment tradisional adalah **release directory + current symlink**.

### 4.1 Struktur

```text
/opt/payment-service/
  releases/
    2026-06-01T120000Z-2.4.0-abc123/
    2026-06-12T090000Z-2.4.1-def456/
    2026-06-18T153000Z-2.5.0-aef912/
  current -> releases/2026-06-18T153000Z-2.5.0-aef912
```

### 4.2 Kenapa Symlink Pattern Kuat?

Karena deployment menjadi atomic-ish pada level filesystem.

Prosesnya:

1. Upload release baru ke directory baru.
2. Validasi checksum.
3. Set ownership/permission.
4. Jalankan preflight check.
5. Update symlink `current` ke release baru.
6. Restart service.
7. Jalankan smoke test.
8. Jika gagal, arahkan symlink ke release lama.
9. Restart service.

Contoh:

```bash
ln -sfn /opt/my-service/releases/2026-06-18T153000Z-2.5.0-aef912 /opt/my-service/current
systemctl restart my-service
```

Rollback:

```bash
ln -sfn /opt/my-service/releases/2026-06-12T090000Z-2.4.1-def456 /opt/my-service/current
systemctl restart my-service
```

### 4.3 Risiko yang Perlu Dipahami

Symlink switch tidak otomatis membuat running process berubah.

Kalau proses Java sudah berjalan dengan JAR lama, mengganti symlink tidak mengubah bytecode yang sudah dimuat.

Maka switch versi harus disertai restart proses.

Selain itu, jangan delete release lama sebelum yakin rollback window selesai.

Contoh retention:

```text
Keep last 5 releases or last 14 days, whichever is larger.
```

---

## 5. User dan Permission Model

Aplikasi Java production tidak seharusnya berjalan sebagai `root`.

### 5.1 Buat Dedicated User

Contoh:

```bash
sudo groupadd --system myservice
sudo useradd \
  --system \
  --gid myservice \
  --home-dir /nonexistent \
  --shell /usr/sbin/nologin \
  myservice
```

Runtime user ini seharusnya:

- bisa membaca artifact;
- bisa membaca config yang diperlukan;
- bisa membaca secret yang diperlukan;
- bisa menulis log kalau log file digunakan;
- bisa menulis state directory kalau aplikasi punya local state;
- tidak bisa menulis release artifact;
- tidak bisa menulis config global sembarangan;
- tidak bisa melakukan administrative operation.

### 5.2 Permission Contoh

```bash
sudo mkdir -p /opt/my-service/releases
sudo mkdir -p /etc/my-service
sudo mkdir -p /var/log/my-service
sudo mkdir -p /var/lib/my-service
sudo mkdir -p /run/my-service

sudo chown -R root:root /opt/my-service
sudo chown -R root:myservice /etc/my-service
sudo chown -R myservice:myservice /var/log/my-service
sudo chown -R myservice:myservice /var/lib/my-service
sudo chown -R myservice:myservice /run/my-service

sudo chmod 755 /opt/my-service
sudo chmod 750 /etc/my-service
sudo chmod 750 /var/log/my-service
sudo chmod 750 /var/lib/my-service
```

Untuk secret:

```bash
sudo chown root:myservice /etc/my-service/my-service.env
sudo chmod 640 /etc/my-service/my-service.env
```

### 5.3 Ownership Artifact

Release artifact sebaiknya dimiliki root atau deploy user, bukan runtime user.

```bash
sudo chown -R root:root /opt/my-service/releases/2026-06-18T153000Z-2.5.0-aef912
sudo chmod -R go-w /opt/my-service/releases/2026-06-18T153000Z-2.5.0-aef912
```

Kenapa?

Kalau aplikasi compromised, ia tidak bisa mengganti binary-nya sendiri.

---

## 6. Start Script: Kapan Perlu dan Bagaimana Membuatnya

Banyak orang menaruh semua command Java langsung di systemd `ExecStart`.

Itu bisa saja, tetapi untuk aplikasi kompleks, lebih baik memakai `start.sh` yang sederhana dan eksplisit.

### 6.1 Prinsip Start Script

Start script harus:

- deterministic;
- fail fast;
- tidak daemonize sendiri;
- tidak memakai `nohup`;
- tidak background process dengan `&`;
- tidak menyembunyikan exit code;
- tidak mengubah config diam-diam;
- mencetak versi dan runtime info saat start;
- mengeksekusi `java` sebagai foreground process.

Systemd mengelola process lifecycle. Jangan membuat shell script yang melawan systemd.

### 6.2 Contoh `start.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_JAR="${APP_HOME}/app/my-service.jar"
CONFIG_FILE="${APP_CONFIG_FILE:-/etc/my-service/application.yml}"

JAVA_BIN="${JAVA_HOME:-/usr/lib/jvm/temurin-21}/bin/java"

JAVA_OPTS_DEFAULT="
  -Dfile.encoding=UTF-8
  -Duser.timezone=UTC
  -XX:+ExitOnOutOfMemoryError
  -XX:ErrorFile=/var/log/my-service/hs_err_pid%p.log
  -Xlog:gc*:file=/var/log/my-service/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
"

JAVA_OPTS_EFFECTIVE="${JAVA_OPTS_DEFAULT} ${JAVA_OPTS:-}"

if [[ ! -x "${JAVA_BIN}" ]]; then
  echo "Java binary not executable: ${JAVA_BIN}" >&2
  exit 10
fi

if [[ ! -f "${APP_JAR}" ]]; then
  echo "Application JAR not found: ${APP_JAR}" >&2
  exit 11
fi

if [[ ! -r "${CONFIG_FILE}" ]]; then
  echo "Config file not readable: ${CONFIG_FILE}" >&2
  exit 12
fi

echo "Starting my-service"
echo "APP_HOME=${APP_HOME}"
echo "APP_JAR=${APP_JAR}"
echo "CONFIG_FILE=${CONFIG_FILE}"
"${JAVA_BIN}" -version

exec "${JAVA_BIN}" \
  ${JAVA_OPTS_EFFECTIVE} \
  -jar "${APP_JAR}" \
  --spring.config.location="${CONFIG_FILE}"
```

### 6.3 Kenapa `exec` Penting?

Tanpa `exec`, proses utama systemd bisa menjadi shell, bukan Java process.

Dengan `exec`, shell diganti oleh process Java. Ini membuat signal handling lebih bersih.

```bash
exec java -jar app.jar
```

lebih baik daripada:

```bash
java -jar app.jar
```

terutama jika script menjadi process utama service.

---

## 7. systemd Service Unit untuk Java

Systemd adalah service manager utama di banyak distribusi Linux modern. Unit file service mendefinisikan bagaimana proses dimulai, dihentikan, di-restart, dan diintegrasikan dengan boot lifecycle. Dokumentasi systemd menjelaskan bahwa `ExecStart` menentukan command service dan `WorkingDirectory` menentukan directory kerja proses yang dieksekusi.

### 7.1 Contoh Unit Minimal Production

File:

```text
/etc/systemd/system/my-service.service
```

Isi:

```ini
[Unit]
Description=My Service Java Application
Documentation=file:/opt/my-service/current/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=myservice
Group=myservice
WorkingDirectory=/opt/my-service/current
EnvironmentFile=/etc/my-service/my-service.env
ExecStart=/opt/my-service/current/bin/start.sh
Restart=on-failure
RestartSec=10
SuccessExitStatus=143
TimeoutStartSec=90
TimeoutStopSec=45
KillSignal=SIGTERM

# File descriptor and process limits
LimitNOFILE=65536

# Basic hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/log/my-service /var/lib/my-service /run/my-service /tmp/my-service

[Install]
WantedBy=multi-user.target
```

### 7.2 Penjelasan Field Penting

#### `After=network-online.target`

Artinya service dimulai setelah network dianggap online.

Tetapi jangan salah: ini tidak menjamin database, Redis, Kafka, RabbitMQ, atau external API siap.

Aplikasi tetap harus punya retry/backoff.

#### `Type=simple`

Cocok untuk Java app yang berjalan foreground.

Jangan daemonize sendiri.

#### `User` dan `Group`

Menentukan runtime identity.

#### `WorkingDirectory`

Menentukan current directory proses.

Jangan bergantung pada default working directory.

#### `EnvironmentFile`

Memuat environment variable dari file.

Contoh:

```bash
JAVA_HOME=/usr/lib/jvm/temurin-21
APP_CONFIG_FILE=/etc/my-service/application.yml
JAVA_OPTS=-Xms512m -Xmx1024m -XX:MaxMetaspaceSize=256m
SPRING_PROFILES_ACTIVE=prod
```

#### `ExecStart`

Command utama.

Harus foreground dan tidak memakai `nohup`.

#### `Restart=on-failure`

Restart jika process exit dengan failure.

Jangan selalu memakai `Restart=always` tanpa memahami konsekuensinya.

#### `SuccessExitStatus=143`

Exit code 143 sering berarti process menerima SIGTERM: `128 + 15`. Untuk graceful termination, ini bisa dianggap normal.

#### `TimeoutStopSec`

Waktu yang diberikan systemd sebelum membunuh process lebih keras.

Harus lebih panjang dari waktu graceful shutdown aplikasi.

#### `LimitNOFILE`

Menaikkan batas file descriptor untuk socket, file, log, dan connection.

#### Hardening Options

- `NoNewPrivileges=true`: process tidak bisa memperoleh privilege baru.
- `PrivateTmp=true`: tmp directory terisolasi.
- `ProtectSystem=full`: membatasi write ke filesystem system.
- `ReadWritePaths=...`: whitelist path yang boleh ditulis.

Hardening harus diuji, karena aplikasi mungkin butuh write path tertentu.

---

## 8. Environment File Pattern

Environment file adalah jembatan antara service manager dan runtime configuration.

Contoh:

```bash
# /etc/my-service/my-service.env
JAVA_HOME=/usr/lib/jvm/temurin-21
APP_ENV=prod
APP_CONFIG_FILE=/etc/my-service/application.yml
SPRING_PROFILES_ACTIVE=prod

JAVA_OPTS=-Xms512m -Xmx1024m -XX:MaxMetaspaceSize=256m -XX:+ExitOnOutOfMemoryError

DB_HOST=prod-db.internal
DB_PORT=1521
DB_SERVICE=PRODDB
```

### 8.1 Apa yang Cocok di Environment File?

Cocok:

- path Java;
- environment name;
- config file path;
- JVM options;
- profile;
- endpoint internal;
- feature toggle tingkat environment.

Tidak ideal:

- secret plaintext tanpa permission ketat;
- konfigurasi kompleks multiline;
- data besar;
- routing table besar;
- policy bisnis yang sering berubah.

### 8.2 Secret di Environment File

Secret di environment variable punya risiko:

- bisa terlihat oleh process inspection tertentu tergantung permission dan OS;
- bisa ikut tercetak di diagnostic dump jika tidak hati-hati;
- bisa tersebar ke child process;
- rotasi biasanya butuh restart.

Kalau terpaksa:

- permission file harus ketat;
- jangan log environment saat startup;
- jangan taruh secret di command line argument;
- gunakan file-based secret atau secret manager jika tersedia.

Java documentation membedakan system properties dan environment variables sebagai mapping eksternal; environment variable berdampak lebih global karena terlihat oleh descendant process, sedangkan system properties lebih spesifik ke proses Java.

---

## 9. Logging di Deployment Tradisional

Ada dua pendekatan utama:

1. log ke stdout/stderr dan biarkan systemd/journald mengelola;
2. log ke file dan gunakan logrotate/collector.

### 9.1 Logging ke journald

Kelebihan:

- sederhana;
- tidak perlu file permission log;
- terintegrasi dengan `journalctl`;
- cocok dengan service manager.

Cek log:

```bash
journalctl -u my-service -f
journalctl -u my-service --since "1 hour ago"
journalctl -u my-service -p err
```

Kekurangan:

- retention tergantung config journald;
- beberapa organisasi lebih terbiasa dengan file log;
- log shipping mungkin sudah berbasis file collector.

### 9.2 Logging ke File

Contoh path:

```text
/var/log/my-service/application.log
/var/log/my-service/access.log
/var/log/my-service/gc.log
```

Kelebihan:

- mudah diambil file collector;
- familiar untuk operasi tradisional;
- bisa dipisah access/application/audit/gc.

Kekurangan:

- perlu permission;
- perlu rotation;
- risiko disk penuh;
- risiko copytruncate kehilangan log kecil;
- app harus reopen file jika rotate dengan rename/create.

### 9.3 logrotate

`logrotate` dirancang untuk memudahkan administrasi banyak file log: rotasi, kompresi, penghapusan, dan pengaturan frekuensi/ukuran. Untuk `copytruncate`, manual logrotate memperingatkan ada celah waktu kecil antara copy dan truncate sehingga sebagian data log dapat hilang.

Contoh:

```text
/var/log/my-service/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 myservice myservice
    sharedscripts
    postrotate
        systemctl kill -s HUP my-service.service >/dev/null 2>&1 || true
    endscript
}
```

Catatan:

- `create` cocok jika logger bisa reopen file setelah rotate.
- `copytruncate` mudah tetapi punya risiko kehilangan log kecil.
- Untuk logback/log4j2, lebih baik gunakan rolling policy internal atau mekanisme reopen yang benar.
- Jangan biarkan log tumbuh tanpa batas.

### 9.4 GC Log Rotation

Untuk Java modern:

```bash
-Xlog:gc*:file=/var/log/my-service/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

Untuk Java 8:

```bash
-XX:+PrintGCDetails \
-XX:+PrintGCDateStamps \
-Xloggc:/var/log/my-service/gc.log \
-XX:+UseGCLogFileRotation \
-XX:NumberOfGCLogFiles=5 \
-XX:GCLogFileSize=20M
```

Perbedaan ini penting untuk deployment lintas Java 8–25.

---

## 10. Health Check di Server Tradisional

Di Kubernetes, health check adalah probe. Di VM tradisional, health check sering perlu dibuat sendiri.

### 10.1 Level Health Check

Ada beberapa level:

```text
Process alive
  ↓
Port listening
  ↓
HTTP health endpoint returns OK
  ↓
Dependency check OK
  ↓
Synthetic business transaction OK
```

Jangan menyamakan process alive dengan application healthy.

### 10.2 Contoh Smoke Check Script

```bash
#!/usr/bin/env bash
set -euo pipefail

URL="${1:-http://127.0.0.1:8080/actuator/health/readiness}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
SLEEP_SECONDS=2
DEADLINE=$((SECONDS + TIMEOUT_SECONDS))

while (( SECONDS < DEADLINE )); do
  if curl -fsS --max-time 3 "${URL}" >/dev/null; then
    echo "Health check OK: ${URL}"
    exit 0
  fi
  sleep "${SLEEP_SECONDS}"
done

echo "Health check FAILED after ${TIMEOUT_SECONDS}s: ${URL}" >&2
exit 1
```

### 10.3 Post-Deploy Verification

Setelah restart:

```bash
systemctl is-active --quiet my-service
/opt/my-service/current/bin/smoke-check.sh
journalctl -u my-service --since "5 minutes ago" -p err
```

Tetapi untuk production, verification harus lebih kaya:

- service active;
- endpoint readiness OK;
- version endpoint menunjukkan versi baru;
- DB connection OK;
- queue consumer connected;
- error log tidak meningkat;
- startup tidak mengandung warning fatal;
- synthetic transaction berhasil;
- metrics baseline normal.

---

## 11. Startup Lifecycle

Startup Java bukan satu titik waktu. Ia punya fase.

```text
Process created
  ↓
JVM initialized
  ↓
Classes loaded
  ↓
Framework bootstrapped
  ↓
Configuration bound
  ↓
Database pool initialized
  ↓
Migrations maybe executed
  ↓
HTTP server bound to port
  ↓
Caches warmed
  ↓
Message consumers started
  ↓
Application ready
```

Masalah umum:

- port sudah listening tetapi app belum siap;
- DB pool belum valid tetapi health endpoint OK;
- background consumers mulai sebelum schema siap;
- cache warmup belum selesai tetapi traffic sudah masuk;
- app dianggap active oleh systemd padahal business readiness belum benar.

Di server tradisional, load balancer harus hanya mengirim traffic setelah readiness benar.

---

## 12. Graceful Shutdown di Server Tradisional

Shutdown bukan sekadar `kill -9`.

Shutdown yang benar:

```text
Stop accepting new traffic
  ↓
Drain load balancer
  ↓
Send SIGTERM
  ↓
Application stops accepting new work
  ↓
In-flight request completes or times out
  ↓
Consumers stop polling
  ↓
Schedulers stop launching new jobs
  ↓
DB transactions complete/rollback safely
  ↓
Logs flushed
  ↓
Process exits
```

### 12.1 systemd Stop Flow

Umumnya:

```bash
systemctl stop my-service
```

Systemd mengirim `SIGTERM`, menunggu `TimeoutStopSec`, lalu bisa mengirim kill lebih keras jika process belum berhenti.

### 12.2 Java Application Harus Menangani SIGTERM

Java process akan menerima SIGTERM dan JVM akan menjalankan shutdown hooks.

Framework seperti Spring Boot dapat melakukan graceful shutdown jika dikonfigurasi.

Tapi tetap perlu memperhatikan:

- thread non-daemon;
- executor shutdown;
- scheduler;
- queue consumer;
- HTTP server;
- DB pool;
- async logging;
- custom shutdown hook yang menggantung.

### 12.3 Stop Script Tidak Harus Membunuh Sendiri

Dengan systemd, jangan membuat stop script yang mencari PID lalu `kill -9` kecuali emergency.

Yang lebih benar:

```bash
systemctl stop my-service
```

Untuk emergency:

```bash
systemctl kill -s SIGKILL my-service
```

Tetapi ini harus menjadi break-glass procedure.

---

## 13. Upgrade Procedure

Upgrade production harus procedural, bukan improvisasi.

### 13.1 Pre-Deployment Checklist

Sebelum deploy:

- artifact tersedia di repository;
- checksum cocok;
- release note tersedia;
- config change diketahui;
- DB migration status jelas;
- rollback artifact tersedia;
- rollback config tersedia;
- maintenance window jika diperlukan;
- dependent service compatibility jelas;
- monitoring dashboard siap;
- on-call/owner jelas.

### 13.2 Deployment Steps

Contoh:

```bash
APP=my-service
VERSION=2.5.0
BUILD=2026-06-18T153000Z-2.5.0-aef912
RELEASE_DIR=/opt/${APP}/releases/${BUILD}

sudo mkdir -p "${RELEASE_DIR}"
sudo tar -xzf "${APP}-${VERSION}.tar.gz" -C "${RELEASE_DIR}"
sudo chown -R root:root "${RELEASE_DIR}"
sudo chmod -R go-w "${RELEASE_DIR}"

sudo -u myservice "${RELEASE_DIR}/bin/preflight.sh"

PREVIOUS=$(readlink -f "/opt/${APP}/current")
echo "Previous release: ${PREVIOUS}"

sudo ln -sfn "${RELEASE_DIR}" "/opt/${APP}/current"
sudo systemctl restart "${APP}"

sudo "/opt/${APP}/current/bin/smoke-check.sh"
```

### 13.3 Setelah Deploy

Verifikasi:

```bash
systemctl status my-service --no-pager
journalctl -u my-service --since "10 minutes ago" --no-pager
curl -fsS http://127.0.0.1:8080/actuator/health
curl -fsS http://127.0.0.1:8080/version
```

Catat evidence:

- versi sebelum;
- versi sesudah;
- waktu start;
- operator;
- hasil smoke test;
- log summary;
- rollback decision.

---

## 14. Rollback Procedure

Rollback harus disiapkan sebelum deploy.

### 14.1 Kapan Rollback?

Rollback cocok jika:

- application startup gagal;
- health check gagal;
- error rate naik tajam;
- critical endpoint rusak;
- config salah dan tidak bisa diperbaiki cepat;
- resource usage abnormal;
- dependency incompatibility ditemukan;
- release baru menyebabkan data processing berhenti.

Rollback tidak selalu aman jika:

- schema database sudah berubah tidak backward-compatible;
- data sudah dimigrasi irreversible;
- message format baru sudah diproduksi;
- external side effect sudah terjadi;
- cache/state lokal berubah format;
- job batch sudah memproses sebagian data.

### 14.2 Rollback Script

```bash
#!/usr/bin/env bash
set -euo pipefail

APP=my-service
TARGET_RELEASE="${1:?Usage: rollback.sh /opt/my-service/releases/<release>}"

if [[ ! -d "${TARGET_RELEASE}" ]]; then
  echo "Target release not found: ${TARGET_RELEASE}" >&2
  exit 1
fi

if [[ ! -x "${TARGET_RELEASE}/bin/start.sh" ]]; then
  echo "Target release invalid: missing start.sh" >&2
  exit 2
fi

CURRENT=$(readlink -f "/opt/${APP}/current")
echo "Current release: ${CURRENT}"
echo "Rolling back to: ${TARGET_RELEASE}"

ln -sfn "${TARGET_RELEASE}" "/opt/${APP}/current"
systemctl restart "${APP}"

"/opt/${APP}/current/bin/smoke-check.sh"

echo "Rollback completed"
```

### 14.3 Rollback Invariant

Rollback harus memenuhi:

1. Target release masih tersedia.
2. Config lama masih tersedia atau kompatibel.
3. Database masih kompatibel.
4. Application lama bisa membaca data baru, atau data baru belum diproduksi.
5. Traffic bisa diarahkan kembali.
6. Monitoring bisa memastikan stabilitas setelah rollback.

---

## 15. Deployment dengan Load Balancer

Untuk production multi-node tradisional, deployment harus memikirkan traffic.

### 15.1 Single Node vs Multi Node

Single node:

```text
User → App Server
```

Deploy berarti downtime kecuali app support zero-downtime via process replacement atau active standby.

Multi-node:

```text
User → Load Balancer → App Node 1
                    → App Node 2
                    → App Node 3
```

Deploy bisa rolling:

1. drain node 1;
2. deploy node 1;
3. verify node 1;
4. rejoin node 1;
5. repeat node 2;
6. repeat node 3.

### 15.2 Rolling Deployment Manual

Pseudo-runbook:

```text
For each node:
  1. Mark node out-of-service in load balancer
  2. Wait for active connections to drain
  3. Stop service
  4. Switch release symlink
  5. Start service
  6. Run local smoke check
  7. Run remote smoke check through LB if possible
  8. Mark node in-service
  9. Observe metrics for N minutes
```

### 15.3 Sticky Session Risk

Kalau aplikasi memakai in-memory session:

- drain harus menunggu session selesai;
- user bisa logout saat pindah node;
- rolling deployment bisa menyebabkan session incompatibility;
- versi lama dan baru harus kompatibel terhadap session serialization.

Solusi lebih baik:

- external session store;
- stateless session/token;
- short session migration window;
- force re-login hanya jika acceptable.

---

## 16. PID Files: Masih Perlu atau Tidak?

Dalam systemd, PID file biasanya tidak diperlukan untuk service sederhana.

Dulu init scripts sering memakai:

```text
/var/run/my-service.pid
```

Tetapi systemd sudah melacak main process.

PID file masih bisa relevan jika:

- aplikasi daemonize sendiri;
- legacy service type `forking`;
- ada tool eksternal yang membutuhkan PID;
- ada monitoring lama berbasis PID file.

Untuk Java modern foreground process:

```ini
Type=simple
ExecStart=/opt/my-service/current/bin/start.sh
```

biasanya cukup.

---

## 17. File Descriptor, Port, dan OS Limits

Java service sering gagal bukan karena heap, tetapi karena OS limit.

### 17.1 File Descriptor

Socket adalah file descriptor.

Yang memakai FD:

- inbound HTTP connection;
- outbound DB connection;
- outbound HTTP client;
- log file;
- JAR file;
- native library;
- temporary file;
- monitoring agent;
- Unix socket.

Cek limit:

```bash
cat /proc/$(pidof java)/limits
```

Atur systemd:

```ini
LimitNOFILE=65536
```

### 17.2 Port Binding

Port <1024 biasanya butuh privilege khusus.

Jangan jalankan Java sebagai root hanya demi port 80/443.

Gunakan:

- reverse proxy;
- load balancer;
- iptables redirect;
- Linux capabilities dengan sangat hati-hati;
- systemd socket activation untuk case tertentu.

### 17.3 Ephemeral Port Exhaustion

Service yang banyak outbound call bisa kehabisan ephemeral port.

Gejala:

- connection timeout;
- cannot assign requested address;
- intermittent outbound failure.

Ini bukan sekadar masalah Java. Ini masalah OS/network deployment.

---

## 18. Temporary Directory dan Local State

Java sering memakai temporary directory untuk:

- file upload multipart;
- PDF generation;
- XML processing;
- decompression;
- native library extraction;
- font cache;
- report generation;
- large response buffering.

Jangan biarkan default `/tmp` menjadi asumsi tak terlihat.

Set eksplisit:

```bash
-Djava.io.tmpdir=/tmp/my-service
```

Pastikan:

- directory ada;
- writable oleh runtime user;
- cukup kapasitas;
- dibersihkan berkala;
- tidak dipakai untuk state penting.

Untuk state penting, gunakan `/var/lib/my-service`, bukan `/tmp`.

---

## 19. Java Version Pinning di Server

Jangan bergantung pada `java` dari PATH tanpa kontrol.

Buruk:

```bash
java -jar app.jar
```

Lebih baik:

```bash
/usr/lib/jvm/temurin-21/bin/java -jar app.jar
```

Atau via env:

```bash
JAVA_HOME=/usr/lib/jvm/temurin-21
${JAVA_HOME}/bin/java -jar app.jar
```

### 19.1 Kenapa?

Karena server bisa punya beberapa Java:

```text
/usr/lib/jvm/java-8
/usr/lib/jvm/java-11
/usr/lib/jvm/java-17
/usr/lib/jvm/java-21
/usr/lib/jvm/java-25
```

Kalau PATH berubah, service bisa jalan di runtime berbeda.

Dampaknya:

- class file version error;
- illegal reflective access behavior berubah;
- TLS behavior berubah;
- GC logging flag tidak kompatibel;
- default charset/timezone bisa berbeda;
- performance berubah;
- module access error muncul.

### 19.2 Version Check Saat Start

Start script sebaiknya mencetak:

```bash
java -version
```

Atau endpoint `/version` berisi:

```json
{
  "appVersion": "2.5.0",
  "gitCommit": "aef912",
  "javaVersion": "21.0.7",
  "javaVendor": "Eclipse Adoptium",
  "os": "Linux",
  "startTime": "2026-06-18T15:31:12Z"
}
```

---

## 20. Deployment Package Format: tar.gz vs RPM vs DEB

### 20.1 tar.gz

Kelebihan:

- sederhana;
- portable;
- mudah dipahami;
- cocok untuk custom release layout;
- mudah dipakai di CI/CD.

Kekurangan:

- dependency OS tidak dikelola package manager;
- uninstall tidak otomatis;
- ownership/permission harus diatur script;
- audit package OS lebih lemah.

### 20.2 RPM/DEB

Kelebihan:

- terintegrasi package manager;
- pre/post install hooks;
- dependency bisa dideklarasikan;
- audit lebih baik;
- uninstall lebih rapi;
- cocok enterprise Linux fleet.

Kekurangan:

- packaging lebih kompleks;
- rollback package bisa tricky jika config berubah;
- butuh repository internal;
- kurang fleksibel untuk symlink release pattern jika tidak dirancang baik.

### 20.3 Kapan Memilih Apa?

| Kondisi | Pilihan Umum |
|---|---|
| deployment sederhana, CI/CD custom | tar.gz |
| enterprise VM fleet besar | RPM/DEB |
| strict OS compliance | RPM/DEB |
| app per-node manual controlled | tar.gz |
| immutable server image | baked image atau package manager |
| mixed legacy environment | tar.gz sering lebih praktis |

---

## 21. Jangan Pakai `nohup` sebagai Deployment Strategy

Anti-pattern klasik:

```bash
nohup java -jar app.jar > app.log 2>&1 &
```

Masalah:

- process lifecycle tidak jelas;
- restart policy tidak ada;
- exit code hilang;
- pid tracking manual;
- log rawan uncontrolled;
- boot startup tidak otomatis;
- graceful stop sulit;
- operator berbeda bisa menjalankan duplicate process;
- audit buruk.

`nohup` boleh untuk eksperimen cepat. Tidak untuk production service.

Production harus memakai service manager:

```bash
systemctl start my-service
systemctl stop my-service
systemctl restart my-service
systemctl status my-service
```

---

## 22. Common Failure Modes di Traditional Deployment

### 22.1 Service Active tapi App Tidak Siap

Penyebab:

- systemd hanya tahu process hidup;
- health endpoint belum valid;
- DB belum connected;
- migration belum selesai.

Mitigasi:

- post-start smoke check;
- load balancer health check;
- readiness endpoint;
- startup timeout realistis.

### 22.2 Salah Java Version

Penyebab:

- PATH berubah;
- OS update mengganti alternatives;
- admin install JDK baru;
- start script tidak pin JAVA_HOME.

Mitigasi:

- explicit JAVA_HOME;
- version endpoint;
- startup log java version;
- deployment preflight.

### 22.3 Config Drift

Penyebab:

- config diedit manual di server;
- tidak ada source of truth;
- environment file berbeda antar node;
- secret rotation tidak konsisten.

Mitigasi:

- config repository;
- checksum config;
- config management tool;
- deployment evidence;
- compare antar node.

### 22.4 Disk Penuh karena Log

Penyebab:

- no logrotate;
- debug log aktif;
- GC log tidak rotate;
- heap dump besar;
- access log terlalu verbose.

Mitigasi:

- logrotate;
- journald retention;
- GC log filecount/filesize;
- heap dump path ke partition cukup besar;
- alert disk usage.

### 22.5 Restart Loop

Penyebab:

- bad config;
- DB unavailable;
- missing secret;
- port conflict;
- incompatible JVM flag.

Mitigasi:

- `Restart=on-failure` dengan `RestartSec`;
- start limit;
- preflight validation;
- alert on restart count.

### 22.6 Rollback Gagal

Penyebab:

- release lama dihapus;
- config lama overwritten;
- DB migration incompatible;
- cache/state format berubah;
- external side effects sudah terjadi.

Mitigasi:

- keep previous release;
- backup config;
- expand-contract DB migration;
- compatibility matrix;
- rollback rehearsal.

---

## 23. Preflight Script

Preflight check menangkap masalah sebelum restart.

Contoh:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAVA_BIN="${JAVA_HOME:-/usr/lib/jvm/temurin-21}/bin/java"
CONFIG_FILE="${APP_CONFIG_FILE:-/etc/my-service/application.yml}"

fail() {
  echo "PREFLIGHT FAILED: $*" >&2
  exit 1
}

[[ -x "${JAVA_BIN}" ]] || fail "Java binary not executable: ${JAVA_BIN}"
[[ -f "${APP_HOME}/app/my-service.jar" ]] || fail "JAR missing"
[[ -r "${CONFIG_FILE}" ]] || fail "Config not readable: ${CONFIG_FILE}"
[[ -d /var/log/my-service ]] || fail "Log dir missing"
[[ -w /var/log/my-service ]] || fail "Log dir not writable"
[[ -d /var/lib/my-service ]] || fail "State dir missing"
[[ -w /var/lib/my-service ]] || fail "State dir not writable"

"${JAVA_BIN}" -version

# Optional: validate Spring Boot config without starting full server if supported.
# Optional: check DB DNS resolution.
# Optional: check required env vars.

for required in APP_ENV SPRING_PROFILES_ACTIVE; do
  [[ -n "${!required:-}" ]] || fail "Missing env var: ${required}"
done

echo "PREFLIGHT OK"
```

Preflight tidak menggantikan integration test, tetapi mengurangi failure bodoh:

- file hilang;
- permission salah;
- Java salah;
- config tidak bisa dibaca;
- log path tidak writable;
- env var kosong.

---

## 24. Service Hardening untuk Java

Systemd memiliki banyak opsi hardening. Jangan aktifkan semua tanpa memahami aplikasi.

### 24.1 Hardening yang Sering Aman

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/log/my-service /var/lib/my-service /run/my-service /tmp/my-service
```

### 24.2 Hardening yang Perlu Uji Lebih Ketat

```ini
ProtectHome=true
PrivateDevices=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallFilter=@system-service
CapabilityBoundingSet=
```

Risiko:

- native library butuh syscall tertentu;
- font/rendering/report library butuh file tertentu;
- TLS truststore path tidak terbaca;
- temp directory behavior berubah;
- monitoring agent gagal attach;
- JFR/heap dump gagal menulis file.

### 24.3 Prinsip

Hardening bukan checklist buta.

Hardening adalah proses:

```text
Start from least privilege
  ↓
Run full smoke/regression
  ↓
Observe denied operations
  ↓
Allow only required paths/capabilities
  ↓
Document reason
```

---

## 25. Deployment Evidence dan Audit Trail

Dalam enterprise, deployment bukan hanya tindakan teknis. Deployment adalah event yang harus dapat dibuktikan.

Evidence yang baik mencatat:

- application name;
- environment;
- node/server;
- previous version;
- new version;
- artifact checksum;
- Java version;
- config version/checksum;
- deployer;
- timestamp;
- preflight result;
- service restart result;
- smoke test result;
- rollback plan;
- final status.

Contoh evidence:

```text
Application: my-service
Environment: PROD
Node: app-prod-02
Previous Release: 2026-06-12T090000Z-2.4.1-def456
New Release: 2026-06-18T153000Z-2.5.0-aef912
Artifact SHA256: ...
Java Runtime: Temurin 21.0.7
Config SHA256: ...
Deployment Started: 2026-06-18T15:30:00Z
Deployment Completed: 2026-06-18T15:36:20Z
Preflight: PASS
Systemd Restart: PASS
Smoke Check: PASS
Post-deploy Error Scan: PASS
Rollback Target: 2026-06-12T090000Z-2.4.1-def456
Operator: release-bot
```

---

## 26. Traditional Deployment Automation

Walaupun bukan Kubernetes, deployment tetap bisa otomatis.

Tools yang sering dipakai:

- shell script;
- Ansible;
- Chef/Puppet/Salt;
- Jenkins remote SSH;
- GitHub Actions self-hosted runner;
- GitLab runner;
- internal release orchestrator;
- RPM/DEB repository;
- artifact repository.

### 26.1 Minimal Automation Pipeline

```text
CI builds artifact
  ↓
CI publishes artifact + checksum
  ↓
Deploy job downloads artifact
  ↓
Deploy job creates release directory
  ↓
Deploy job validates checksum
  ↓
Deploy job runs preflight
  ↓
Deploy job switches symlink
  ↓
Deploy job restarts service
  ↓
Deploy job runs smoke check
  ↓
Deploy job records evidence
```

### 26.2 Jangan SSH Manual Tanpa Idempotency

Buruk:

```bash
ssh server
cd app
cp app.jar app.jar.bak
scp new.jar
kill -9 ...
nohup java -jar new.jar &
```

Lebih baik:

- script idempotent;
- path eksplisit;
- versioned release;
- rollback target jelas;
- smoke check otomatis;
- evidence otomatis.

---

## 27. Traditional Deployment vs Immutable Infrastructure

Deployment VM tradisional sering mutable: server yang sama diubah berkali-kali.

Immutable infrastructure berbeda:

```text
Build machine image with app
  ↓
Launch new VM
  ↓
Attach to load balancer
  ↓
Drain old VM
  ↓
Terminate old VM
```

Kelebihan immutable:

- drift lebih kecil;
- rollback via image lama;
- environment lebih reproducible;
- cocok cloud auto-scaling.

Kekurangan:

- image build lebih lambat;
- patching perlu pipeline image;
- state harus eksternal;
- tidak selalu cocok legacy enterprise.

Dalam banyak organisasi, ada hybrid:

- base OS image immutable;
- app deploy via package/symlink;
- config via config management;
- state eksternal.

---

## 28. Java 8–25 Specific Notes untuk Server Deployment

### 28.1 Java 8

Perhatikan:

- GC logging syntax lama;
- PermGen sudah tidak ada sejak Java 8, tetapi banyak runbook lama masih menyebutnya;
- TLS default mungkin lebih tua tergantung update level;
- container awareness terbatas dibanding Java modern;
- banyak library legacy memakai reflection internal;
- classpath deployment dominan.

### 28.2 Java 11

Perhatikan:

- Java EE/JAXB/JAX-WS modules removed dari JDK;
- perlu dependency eksplisit;
- unified logging mulai stabil;
- stronger encapsulation mulai terasa;
- migration dari Java 8 sering gagal saat runtime, bukan compile saja.

### 28.3 Java 17

Perhatikan:

- LTS modern umum;
- strong encapsulation lebih tegas;
- illegal access workaround makin penting;
- banyak enterprise memilih 17 sebagai baseline.

### 28.4 Java 21

Perhatikan:

- LTS modern dengan virtual threads;
- deployment sizing thread model bisa berubah;
- observability dan diagnostics lebih matang;
- cocok untuk modern Spring Boot/Jakarta EE 11 ecosystem.

### 28.5 Java 25

Perhatikan:

- LTS baru setelah 21;
- perlu validasi library/tooling/support vendor;
- jangan upgrade production hanya karena versi baru;
- pastikan app server, agent, profiler, security scanner, dan CI/CD support.

---

## 29. Practical Templates

### 29.1 Directory Bootstrap

```bash
#!/usr/bin/env bash
set -euo pipefail

APP=my-service
USER=myservice
GROUP=myservice

sudo groupadd --system "${GROUP}" || true
sudo useradd --system --gid "${GROUP}" --home-dir /nonexistent --shell /usr/sbin/nologin "${USER}" || true

sudo mkdir -p "/opt/${APP}/releases"
sudo mkdir -p "/etc/${APP}"
sudo mkdir -p "/var/log/${APP}"
sudo mkdir -p "/var/lib/${APP}"
sudo mkdir -p "/run/${APP}"
sudo mkdir -p "/tmp/${APP}"

sudo chown -R root:root "/opt/${APP}"
sudo chown -R root:"${GROUP}" "/etc/${APP}"
sudo chown -R "${USER}":"${GROUP}" "/var/log/${APP}"
sudo chown -R "${USER}":"${GROUP}" "/var/lib/${APP}"
sudo chown -R "${USER}":"${GROUP}" "/run/${APP}"
sudo chown -R "${USER}":"${GROUP}" "/tmp/${APP}"

sudo chmod 755 "/opt/${APP}"
sudo chmod 750 "/etc/${APP}"
sudo chmod 750 "/var/log/${APP}"
sudo chmod 750 "/var/lib/${APP}"
sudo chmod 750 "/run/${APP}"
sudo chmod 750 "/tmp/${APP}"
```

### 29.2 systemd Unit Template

```ini
[Unit]
Description={{APP_NAME}} Java Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={{APP_USER}}
Group={{APP_GROUP}}
WorkingDirectory=/opt/{{APP_NAME}}/current
EnvironmentFile=/etc/{{APP_NAME}}/{{APP_NAME}}.env
ExecStart=/opt/{{APP_NAME}}/current/bin/start.sh
Restart=on-failure
RestartSec=10
SuccessExitStatus=143
TimeoutStartSec=90
TimeoutStopSec=45
KillSignal=SIGTERM
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/log/{{APP_NAME}} /var/lib/{{APP_NAME}} /run/{{APP_NAME}} /tmp/{{APP_NAME}}

[Install]
WantedBy=multi-user.target
```

### 29.3 Deploy Script Skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail

APP="${APP:-my-service}"
ARTIFACT="${1:?Usage: deploy.sh artifact.tar.gz release-id}"
RELEASE_ID="${2:?Usage: deploy.sh artifact.tar.gz release-id}"
RELEASE_DIR="/opt/${APP}/releases/${RELEASE_ID}"
CURRENT_LINK="/opt/${APP}/current"

sudo mkdir -p "${RELEASE_DIR}"
sudo tar -xzf "${ARTIFACT}" -C "${RELEASE_DIR}"
sudo chown -R root:root "${RELEASE_DIR}"
sudo chmod -R go-w "${RELEASE_DIR}"

PREVIOUS=""
if [[ -L "${CURRENT_LINK}" ]]; then
  PREVIOUS=$(readlink -f "${CURRENT_LINK}")
fi

echo "Previous release: ${PREVIOUS:-none}"
echo "New release: ${RELEASE_DIR}"

sudo -u myservice "${RELEASE_DIR}/bin/preflight.sh"

sudo ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"
sudo systemctl restart "${APP}.service"

sudo "${CURRENT_LINK}/bin/smoke-check.sh"

echo "Deployment OK"
```

---

## 30. Senior-Level Review Questions

Gunakan pertanyaan ini untuk mengevaluasi apakah deployment tradisional sudah matang.

1. Apakah artifact immutable setelah dibuat?
2. Apakah config environment-specific dipisahkan dari artifact?
3. Apakah runtime Java version dipin secara eksplisit?
4. Apakah service berjalan sebagai non-root user?
5. Apakah runtime user bisa menulis ke artifact directory?
6. Apakah log punya rotation dan retention?
7. Apakah GC log punya rotation?
8. Apakah startup log mencetak app version dan Java version?
9. Apakah deployment punya preflight check?
10. Apakah deployment punya smoke check?
11. Apakah rollback target selalu tersedia?
12. Apakah rollback tetap aman setelah DB migration?
13. Apakah service stop graceful?
14. Apakah `TimeoutStopSec` sesuai shutdown time aplikasi?
15. Apakah restart policy bisa menyebabkan restart loop berbahaya?
16. Apakah file descriptor limit cukup?
17. Apakah temp directory eksplisit dan punya kapasitas cukup?
18. Apakah load balancer drain dilakukan sebelum restart node?
19. Apakah deployment evidence tercatat?
20. Apakah operator baru bisa deploy memakai runbook tanpa improvisasi?

---

## 31. Anti-Pattern Catalog

### Anti-Pattern 1 — Artifact Ditimpa In-Place

```bash
cp new.jar /opt/app/app.jar
```

Masalah:

- versi lama hilang;
- rollback sulit;
- checksum tidak jelas;
- running process mungkin masih memakai file lama/terbuka.

Solusi:

- release directory;
- symlink `current`;
- retention release lama.

### Anti-Pattern 2 — Run as Root

Masalah:

- blast radius besar;
- file ownership rusak;
- compromise menjadi fatal.

Solusi:

- dedicated system user;
- least privilege;
- systemd hardening.

### Anti-Pattern 3 — Config di Dalam JAR

Masalah:

- rebuild untuk config change;
- artifact tidak reusable antar environment;
- secret bisa bocor;
- audit sulit.

Solusi:

- external config;
- env file;
- secret manager;
- config checksum.

### Anti-Pattern 4 — `nohup` Production

Masalah:

- lifecycle tidak jelas;
- restart tidak otomatis;
- log tidak terkendali;
- operator bisa membuat duplicate process.

Solusi:

- systemd service.

### Anti-Pattern 5 — Health Check Hanya Port

Masalah:

- port listening tidak berarti app ready;
- dependency failure tidak terdeteksi.

Solusi:

- readiness endpoint;
- dependency-aware smoke test;
- synthetic transaction.

### Anti-Pattern 6 — Rollback Tidak Diuji

Masalah:

- rollback procedure ada di dokumen tetapi gagal saat incident;
- config lama hilang;
- DB tidak kompatibel.

Solusi:

- rollback rehearsal;
- keep previous release;
- expand-contract migration.

---

## 32. Mental Model Akhir

Deployment Java di Linux tradisional bukan sekadar:

```bash
java -jar app.jar
```

Deployment production adalah sistem kontrak:

```text
Immutable artifact
  + Explicit Java runtime
  + External config
  + Dedicated runtime user
  + Stable filesystem layout
  + Service manager lifecycle
  + Log lifecycle
  + Health verification
  + Upgrade procedure
  + Rollback procedure
  + Evidence
```

Kalau semua kontrak ini eksplisit, aplikasi menjadi:

- lebih aman;
- lebih mudah dioperasikan;
- lebih mudah di-debug;
- lebih mudah di-rollforward;
- lebih mudah di-rollback;
- lebih defensible untuk audit;
- lebih siap dimigrasikan ke container/Kubernetes.

Inilah fondasi yang akan sangat berguna saat masuk ke Part 8 tentang containerizing Java applications.

---

## 33. Referensi Resmi dan Teknis

- systemd service execution and unit behavior: https://www.freedesktop.org/software/systemd/man/systemd.exec.html
- Red Hat documentation on systemd unit files: https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_systemd_unit_files_to_customize_and_optimize_your_system/assembly_working-with-systemd-unit-files_working-with-systemd
- logrotate manual: https://man7.org/linux/man-pages/man8/logrotate.8.html
- logrotate configuration manual: https://man7.org/linux/man-pages/man5/logrotate.conf.5.html
- Java command documentation: https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html
- Java System environment variables and properties: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/System.html

---

## 34. Ringkasan Part 7

Di bagian ini kita mempelajari:

- perbedaan deployment unit, runtime unit, dan service unit;
- layout direktori production untuk Java service;
- release directory dan symlink pattern;
- permission model dan dedicated runtime user;
- start script yang benar;
- systemd unit production-grade;
- environment file pattern;
- logging ke journald/file;
- logrotate dan risiko `copytruncate`;
- health check dan smoke check;
- startup lifecycle;
- graceful shutdown;
- upgrade dan rollback procedure;
- load balancer drain;
- OS limits seperti file descriptor;
- temp directory dan local state;
- Java version pinning;
- tar.gz vs RPM/DEB;
- anti-pattern seperti `nohup`, run as root, config in JAR;
- deployment evidence dan auditability.

Part ini adalah jembatan antara artifact Java dan platform modern. Setelah memahami ini, container deployment akan terasa sebagai kelanjutan natural, bukan magic.

---

## 35. Status Series

Selesai:

- Part 0 — Deployment Mental Model
- Part 1 — Java Deployment Evolution: Java 8 to Java 25
- Part 2 — Artifact Taxonomy
- Part 3 — Runtime Selection Engineering
- Part 4 — Java Runtime Layout
- Part 5 — Configuration Deployment
- Part 6 — JVM Options as Deployment Contract
- Part 7 — Packaging for Linux Servers: Bare Metal, VM, systemd, and Traditional Ops

Belum selesai. Berikutnya:

- Part 8 — Containerizing Java Applications Correctly

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-06-jvm-options-as-deployment-contract.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-08-containerizing-java-applications-correctly.md)

</div>