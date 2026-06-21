# learn-docker-mastery-for-java-engineers-part-021

# Part 021 — Logging and Diagnostics: stdout, stderr, Drivers, Crash Forensics

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus bagian ini: memahami logging container sebagai kontrak runtime, bukan sekadar `docker logs`; memahami driver logging, rotasi, disk exhaustion, structured logging, dan forensic workflow ketika container crash/restart.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai Part 020, kita sudah membangun mental model:

1. container adalah proses dengan boundary;
2. image adalah artifact immutable berbasis layer;
3. container runtime punya lifecycle eksplisit;
4. Dockerfile membentuk filesystem runtime;
5. Compose membentuk topology lokal;
6. Java dalam container punya constraint memory/CPU/signal sendiri;
7. security, base image, dan resource management adalah keputusan production.

Part ini menjawab pertanyaan operasional yang hampir selalu muncul setelah service mulai berjalan:

> “Kalau container crash, lambat, restart, atau terlihat healthy padahal user error, bukti apa yang harus kita kumpulkan?”

Untuk service Java, logging dan diagnostics sering terlihat sederhana karena Spring Boot, Logback, Log4j2, dan observability tools sudah familiar. Tetapi begitu masuk container, ada boundary baru:

- aplikasi menulis ke stdout/stderr;
- Docker menangkap stream tersebut;
- Docker logging driver memutuskan ke mana log disimpan/dikirim;
- `docker logs` tidak selalu berarti “semua log ada di sini”;
- filesystem container bisa disposable;
- log file di container bisa hilang saat container dihapus;
- log yang terlalu banyak bisa memenuhi disk host;
- crash forensic harus cepat karena container bisa restart dan evidence berubah.

Bagian ini tidak akan mengulang observability lengkap, distributed tracing, metrics platform, atau desain logging enterprise. Fokusnya adalah **Docker-specific logging and crash diagnostics**.

---

## 1. Mental Model Utama: Container Log adalah Stream Contract

Di traditional server model, aplikasi sering menulis log ke file:

```text
/var/log/my-service/app.log
/opt/app/logs/application.log
/home/app/logs/service.log
```

Di container model, kontrak default yang paling sehat adalah:

```text
Application process
  -> stdout / stderr
  -> Docker logging driver
  -> host storage or external log backend
  -> operator reads through docker logs / log platform
```

Docker CLI `docker logs` membaca output dari container stdout dan stderr yang ditangkap oleh logging driver tertentu. Dokumentasi Docker menyatakan bahwa `docker logs --follow` menampilkan output baru dari STDOUT dan STDERR container.

Konsekuensinya:

- aplikasi tidak harus tahu path log host;
- container tidak perlu mutable log directory;
- log bisa dikumpulkan konsisten oleh platform;
- container tetap disposable;
- rotasi dan forwarding menjadi tanggung jawab layer runtime/platform.

Mental model yang harus dipegang:

> Container bukan tempat arsip log permanen. Container adalah source stream. Storage log permanen ada di luar container.

---

## 2. stdout vs stderr: Bukan Sekadar “Normal vs Error”

Secara Unix, process memiliki minimal tiga stream:

```text
stdin   -> input
stdout  -> normal output
stderr  -> error/diagnostic output
```

Dalam container:

- Docker menangkap stdout dan stderr;
- log entry biasanya diberi metadata stream;
- logging driver dapat menyimpan/mengirim keduanya;
- `docker logs` menampilkan gabungan keduanya, dengan opsi untuk detail tertentu.

Untuk Java service:

- Spring Boot default logs ke console;
- console berarti stdout/stderr tergantung logging framework/appender;
- stack trace error sering tetap masuk ke stream yang sama melalui logging framework;
- tidak semua error harus ditulis ke stderr secara manual.

Prinsip praktis:

1. application log utama harus keluar ke console;
2. jangan hanya menulis log ke file internal container;
3. gunakan structured logging agar stdout/stderr tetap machine-readable;
4. gunakan log level dan correlation ID, bukan banyak file terpisah.

---

## 3. Kenapa “Log ke File di Dalam Container” Sering Salah

Misalnya aplikasi Java menulis ke:

```text
/app/logs/application.log
```

Masalahnya:

1. `docker logs my-service` bisa kosong.
2. Operator mengira aplikasi tidak menghasilkan log.
3. Jika container dihapus, log hilang bersama writable layer.
4. Jika path tersebut tidak di-mount, log tidak keluar dari runtime boundary.
5. Jika path tersebut di-mount sebagai volume, sekarang app punya mutable state baru.
6. Rotasi harus diurus lagi di dalam container.
7. Log file bisa membuat container writable layer membengkak.
8. Di production, log platform biasanya tidak membaca file internal container kecuali dikonfigurasi khusus.

Ini bukan berarti file logging selalu haram. Ada kasus khusus:

- aplikasi legacy tidak bisa log ke console;
- audit file wajib dipersist terpisah;
- Java Flight Recorder output;
- heap dump;
- access log yang memang diproses file shipper tertentu;
- forensic artifact sementara.

Tetapi default untuk service modern:

```text
application logs -> stdout/stderr
forensic artifacts -> explicit mounted directory or external storage
business/audit records -> database/event store/object storage, bukan app.log
```

---

## 4. Docker Logging Pipeline

Saat container berjalan:

```text
[Java process]
    |
    | stdout/stderr
    v
[container runtime]
    |
    v
[Docker Engine logging subsystem]
    |
    v
[logging driver]
    |
    +--> local host file
    +--> journald
    +--> syslog
    +--> fluentd
    +--> gelf
    +--> awslogs
    +--> splunk
    +--> external backend
```

Komponen penting:

| Layer | Tanggung Jawab |
|---|---|
| Java app | menghasilkan log bermakna |
| logging framework | format, level, MDC, appender |
| container stdout/stderr | transport stream sederhana |
| Docker logging driver | menyimpan/mengirim log |
| host/platform | rotasi, retention, forwarding |
| observability backend | query, alerting, correlation, archive |

Kesalahan umum adalah menganggap semua layer itu sama. Padahal bug bisa terjadi di layer mana pun:

- app tidak log;
- app log ke file, bukan console;
- logging framework misconfigured;
- Docker driver tidak mendukung `docker logs` sesuai harapan;
- disk host penuh;
- log driver gagal kirim ke backend;
- log backend drop event;
- timestamp tidak konsisten;
- JSON log rusak karena multiline stack trace.

---

## 5. `docker logs`: Apa yang Bisa dan Tidak Bisa Dilakukan

Command umum:

```bash
docker logs my-service
```

Follow live logs:

```bash
docker logs -f my-service
```

Ambil tail:

```bash
docker logs --tail 100 my-service
```

Ambil sejak waktu tertentu:

```bash
docker logs --since 30m my-service
```

Ambil sampai waktu tertentu:

```bash
docker logs --until 2026-06-21T10:00:00 my-service
```

Tambahkan timestamp dari Docker:

```bash
docker logs --timestamps my-service
```

Gabungan yang sering dipakai saat incident:

```bash
docker logs \
  --timestamps \
  --tail 300 \
  my-service
```

Untuk service yang restart:

```bash
docker ps -a --filter name=my-service

docker logs --timestamps --tail 500 my-service
```

Hal penting:

- `docker logs` membaca log container tertentu, bukan service abstrak;
- kalau container lama sudah dihapus dan diganti container baru, log lama bisa hilang;
- pada Compose, gunakan `docker compose logs` untuk agregasi service;
- beberapa logging driver punya behavior berbeda terhadap ketersediaan `docker logs`;
- log yang belum keluar dari process buffer bisa hilang saat crash keras.

---

## 6. Docker Compose Logs

Untuk Compose:

```bash
docker compose logs
```

Service tertentu:

```bash
docker compose logs api
```

Follow:

```bash
docker compose logs -f api
```

Tail:

```bash
docker compose logs --tail 200 api
```

Dengan timestamp:

```bash
docker compose logs --timestamps api
```

Untuk multi-service local debugging:

```bash
docker compose logs --timestamps --tail 100 api postgres redis
```

Compose penting karena container name bisa berubah, sedangkan service name stabil dalam project. Tetapi ingat:

```text
Compose service != satu container selamanya
```

Jika service recreate, container instance berubah. Untuk forensic, perlu tahu instance mana yang crash.

Command berguna:

```bash
docker compose ps

docker compose ps -a
```

---

## 7. Logging Driver: Ke Mana Log Pergi

Docker logging driver menentukan bagaimana output stdout/stderr diproses.

Melihat driver default Docker daemon:

```bash
docker info --format '{{.LoggingDriver}}'
```

Melihat driver sebuah container:

```bash
docker inspect \
  --format '{{.HostConfig.LogConfig.Type}}' \
  my-service
```

Melihat opsi log config:

```bash
docker inspect \
  --format '{{json .HostConfig.LogConfig}}' \
  my-service | jq
```

Driver umum:

| Driver | Kegunaan |
|---|---|
| `json-file` | default umum, menyimpan log sebagai JSON file di host |
| `local` | format lokal Docker, lebih aman untuk mencegah disk exhaustion karena rotasi default/lebih efisien |
| `journald` | kirim ke systemd journal |
| `syslog` | kirim ke syslog |
| `fluentd` | kirim ke Fluentd |
| `gelf` | kirim ke Graylog/GELF endpoint |
| `awslogs` | kirim ke AWS CloudWatch Logs |
| `splunk` | kirim ke Splunk |
| `none` | tidak menyimpan log |

Catatan penting:

- `json-file` historis dan banyak dipakai;
- Docker documentation merekomendasikan `local` logging driver untuk mencegah disk exhaustion;
- default `json-file` tanpa rotasi dapat membuat disk host penuh;
- tidak semua driver cocok untuk semua deployment model;
- pemilihan driver adalah keputusan operasional, bukan keputusan aplikasi.

---

## 8. Disk Exhaustion: Incident Logging yang Paling Sering Diremehkan

Skenario klasik:

1. Java service masuk error loop.
2. Tiap request menghasilkan stack trace besar.
3. Container tetap running atau restart loop.
4. Docker menyimpan stdout/stderr ke host.
5. File log host membesar.
6. Disk host penuh.
7. Container lain mulai gagal.
8. Docker daemon bermasalah.
9. Incident menjadi host-wide, bukan service-specific.

Dengan default `json-file` tanpa rotasi, log container yang sangat verbose bisa memenuhi disk. Dokumentasi Docker secara eksplisit memberi tip untuk menggunakan `local` logging driver untuk mencegah disk exhaustion, karena default `json-file` tidak melakukan log rotation secara default.

Konfigurasi daemon untuk `json-file` dengan rotasi:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Catatan dari Docker: value `log-opts` di `daemon.json` harus berupa string, jadi angka seperti `max-file` juga ditulis dengan tanda kutip.

Menggunakan `local` driver:

```json
{
  "log-driver": "local"
}
```

Per-container run:

```bash
docker run \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  my-image
```

Compose:

```yaml
services:
  api:
    image: my-api:1.0.0
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Prinsip production:

> Logging tanpa rotasi adalah resource leak.

---

## 9. `json-file` Driver: Apa yang Sebenarnya Disimpan

Pada Linux host, `json-file` menyimpan log di bawah area Docker data root, umumnya:

```text
/var/lib/docker/containers/<container-id>/<container-id>-json.log
```

Jangan jadikan path ini dependency aplikasi.

Untuk melihat path log container:

```bash
docker inspect --format '{{.LogPath}}' my-service
```

Isi file biasanya line-delimited JSON dengan informasi:

```json
{"log":"2026-06-21T10:00:00.123 INFO started\n","stream":"stdout","time":"2026-06-21T10:00:00.124567Z"}
```

Peringatan:

- jangan edit manual file ini saat Docker masih mengelola container;
- jangan gunakan aplikasi untuk membaca path internal ini;
- jangan jadikan `/var/lib/docker` sebagai interface stabil;
- gunakan `docker logs` atau log collector yang memahami Docker.

---

## 10. Local Logging Driver

`local` driver adalah driver yang menyimpan log dalam format internal Docker yang lebih efisien untuk local host use case.

Kapan cocok:

- Docker di VM kecil;
- single-host deployment;
- local development;
- ingin mencegah disk penuh dari log default;
- tidak butuh file JSON mentah di host;
- log tetap bisa diakses via Docker tooling.

Contoh daemon config:

```json
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  }
}
```

Per-service Compose:

```yaml
services:
  api:
    image: my-api:1.0.0
    logging:
      driver: local
      options:
        max-size: "20m"
        max-file: "5"
```

Prinsip:

```text
json-file with no rotation -> risky
json-file with rotation    -> acceptable
local driver               -> often better for single-host Docker
external driver            -> useful when platform logging is centralized
```

---

## 11. External Logging Driver

Beberapa deployment memilih mengirim log langsung dari Docker daemon ke backend:

```yaml
services:
  api:
    image: my-api:1.0.0
    logging:
      driver: fluentd
      options:
        fluentd-address: "localhost:24224"
        tag: "my-api"
```

Keuntungan:

- log tidak hanya tinggal di host;
- centralized query;
- retention policy jelas;
- correlation antar service;
- alerting lebih mudah.

Risiko:

- jika backend logging lambat/down, behavior driver harus dipahami;
- konfigurasi driver bisa membuat container start gagal;
- `docker logs` mungkin tidak berfungsi sama seperti `json-file`/`local`;
- network logging path menjadi dependency runtime;
- backpressure logging bisa mempengaruhi aplikasi/platform.

Production principle:

> Jangan pilih logging driver tanpa memahami failure behavior saat log backend unavailable.

Pertanyaan yang harus dijawab:

1. Jika log backend down, apakah container tetap jalan?
2. Apakah log dibuffer?
3. Di mana buffer berada?
4. Apakah buffer bisa memenuhi disk/memory?
5. Apakah `docker logs` masih tersedia?
6. Bagaimana operator mengambil log saat backend gagal?

---

## 12. Blocking vs Non-Blocking Logging Delivery

Dalam container logging, ada dua concern berbeda:

1. aplikasi menulis ke stdout/stderr;
2. Docker/log driver memproses output itu.

Jika output pipe atau driver mengalami bottleneck, efeknya bisa mengejutkan. Untuk aplikasi Java yang logging sangat tinggi:

- thread aplikasi bisa menghabiskan waktu untuk logging;
- async appender queue bisa penuh;
- stdout pipe bisa menjadi bottleneck;
- log driver/backing store bisa lambat;
- disk IO host meningkat;
- latency request naik karena log path, bukan business logic.

Mitigasi:

- jangan log stack trace besar untuk setiap retry normal;
- gunakan sampling untuk noisy error;
- gunakan rate limiting di logging layer bila perlu;
- hindari debug log di production;
- gunakan async logging dengan bounded queue dan policy jelas;
- pantau log throughput;
- pisahkan audit/business event dari technical log.

Anti-pattern:

```text
try {
  callDependency();
} catch (Exception e) {
  log.error("dependency failed", e);
  throw e;
}
```

Jika ini terjadi di retry loop high traffic, satu dependency failure bisa berubah menjadi disk/IO/logging incident.

---

## 13. Structured Logging dalam Container

Container environment sangat cocok untuk structured logging karena log akan dikumpulkan oleh platform.

Contoh plain text:

```text
2026-06-21 10:15:22 ERROR Failed to create case for user 123
```

Contoh structured JSON:

```json
{
  "timestamp": "2026-06-21T10:15:22.123Z",
  "level": "ERROR",
  "service": "case-api",
  "traceId": "4e2d8f1c9a",
  "spanId": "9bd23a1",
  "tenantId": "regulator-a",
  "caseId": "CASE-2026-00123",
  "event": "case.create.failed",
  "error.class": "java.sql.SQLTransientConnectionException",
  "message": "failed to acquire database connection"
}
```

Keuntungan:

- query by field;
- correlation antar service;
- filtering by tenant/case/workflow;
- alerting lebih akurat;
- parsing tidak bergantung regex;
- forensic lebih cepat.

Untuk Java/Spring Boot:

- gunakan MDC untuk `traceId`, `requestId`, `tenantId`, `caseId`;
- pastikan MDC dibersihkan setelah request;
- untuk async/reactive flow, pastikan context propagation benar;
- jangan log PII/secrets;
- jangan log seluruh request body by default;
- jangan menjadikan log sebagai source of truth business state.

---

## 14. Multiline Stack Trace: Masalah Klasik Java Logs

Java stack trace multiline:

```text
java.lang.IllegalStateException: invalid transition
  at com.example.StateMachine.transition(StateMachine.java:88)
  at com.example.CaseService.submit(CaseService.java:42)
  ...
```

Dalam log collector, multiline bisa menjadi banyak event terpisah jika tidak ditangani.

Pilihan:

1. tetap plain text multiline, collector harus multiline-aware;
2. JSON log dengan stack trace sebagai field string;
3. log error summary, stack trace hanya untuk unexpected error;
4. gunakan exception fingerprinting di backend observability.

Trade-off:

| Pendekatan | Kelebihan | Kekurangan |
|---|---|---|
| Plain multiline | mudah dibaca lokal | parsing backend sulit |
| JSON with stack field | machine-readable | output panjang, escaping banyak |
| Stack trace sampling | mengurangi noise | bisa kehilangan detail |
| Error fingerprint | bagus untuk alerting | butuh backend support |

Untuk service high-volume, jangan biarkan satu error menghasilkan ribuan baris per detik.

---

## 15. Log Level Strategy untuk Containerized Java Service

Level umum:

| Level | Makna sehat |
|---|---|
| TRACE | detail sangat rendah, hampir tidak boleh production default |
| DEBUG | diagnosis sementara, bukan steady-state production |
| INFO | lifecycle dan business milestone penting |
| WARN | abnormal tapi recoverable |
| ERROR | operasi gagal atau state tidak valid yang perlu perhatian |

Container-specific guidance:

- `INFO` startup config boleh, tetapi jangan log secret;
- `INFO` per request bisa terlalu noisy untuk high traffic;
- `WARN` untuk retry recoverable bisa jadi noise saat dependency outage;
- `ERROR` harus berarti operator perlu melihat;
- `DEBUG` dalam container production harus bisa diaktifkan sementara dan dibatasi.

Contoh startup log yang baik:

```text
service=case-api version=1.8.3 gitSha=9f3c21b profile=prod port=8080 java=21.0.4 containerMemoryLimit=512MiB
```

Contoh startup log yang buruk:

```text
DB_PASSWORD=s3cr3t
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
```

---

## 16. Startup Logs sebagai Deployment Evidence

Startup log penting karena menjawab:

- image version apa yang berjalan?
- commit SHA apa?
- config profile apa?
- port apa yang dibind?
- memory limit terbaca berapa?
- migration dijalankan atau tidak?
- dependency endpoint apa?
- service siap pada jam berapa?

Minimal startup evidence untuk Java container:

```text
application.name
application.version
git.commit
build.time
java.version
jvm.vendor
active.profile
server.port
container.memory.limit
container.cpu.limit
user.name / uid
timezone
config.source summary
```

Jangan log:

```text
password
api key
private key
session token
authorization header
full connection string with password
PII payload
```

---

## 17. Crash Forensics: Apa yang Harus Dikumpulkan

Ketika container crash, jangan langsung `docker compose down -v` atau rebuild. Kumpulkan evidence dulu.

Checklist cepat:

```bash
# 1. Lihat status semua container, termasuk exited
docker ps -a

# 2. Inspect container
docker inspect my-service > inspect-my-service.json

# 3. Ambil log terakhir
docker logs --timestamps --tail 1000 my-service > my-service-last-1000.log

# 4. Lihat exit code dan OOMKilled
docker inspect \
  --format 'ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}} FinishedAt={{.State.FinishedAt}}' \
  my-service

# 5. Lihat restart count
docker inspect \
  --format 'RestartCount={{.RestartCount}}' \
  my-service

# 6. Lihat health status jika ada
docker inspect \
  --format '{{json .State.Health}}' \
  my-service | jq
```

Untuk Compose:

```bash
docker compose ps -a

docker compose logs --timestamps --tail 1000 api > api-last-1000.log
```

Evidence yang ingin dikumpulkan:

| Evidence | Kenapa penting |
|---|---|
| container state | tahu running/exited/restarting |
| exit code | klasifikasi penyebab awal |
| OOMKilled | bedakan JVM OOM vs kernel/container kill |
| restart count | deteksi crash loop |
| finishedAt | timeline incident |
| logs before exit | symptom aplikasi |
| inspect env/mount/network | verify runtime config |
| image digest/tag | verify artifact yang berjalan |
| host disk/memory | cek resource host |
| events | lihat lifecycle sequence |

---

## 18. Exit Code Interpretation

Exit code bukan root cause final, tetapi sinyal awal.

| Exit Code | Arti umum |
|---:|---|
| 0 | proses selesai normal |
| 1 | application/general error |
| 2 | misuse shell/builtin, tergantung proses |
| 126 | command ditemukan tapi tidak executable |
| 127 | command tidak ditemukan |
| 130 | terminated by Ctrl+C/SIGINT |
| 137 | killed, sering SIGKILL/OOMKill |
| 143 | terminated by SIGTERM, sering graceful stop |

Docker-specific nuance:

- exit 137 sering berarti container menerima SIGKILL; bisa karena memory limit/OOMKilled atau forced kill;
- exit 143 sering normal saat `docker stop` mengirim SIGTERM;
- exit 0 pada service server biasanya mencurigakan jika service seharusnya long-running;
- exit 127 sering Dockerfile/ENTRYPOINT/CMD path problem;
- exit 126 sering permission/shebang/line ending problem.

Command:

```bash
docker inspect --format '{{.State.ExitCode}}' my-service
```

OOMKilled:

```bash
docker inspect --format '{{.State.OOMKilled}}' my-service
```

---

## 19. JVM OOM vs Container OOMKilled

Dua kejadian berbeda:

### 19.1 JVM OutOfMemoryError

Aplikasi masih sempat melempar exception:

```text
java.lang.OutOfMemoryError: Java heap space
```

Ciri:

- log Java OOM muncul;
- process bisa tetap hidup atau mati tergantung handling;
- exit code bisa 1 atau lainnya;
- heap dump mungkin dibuat jika dikonfigurasi.

### 19.2 Container OOMKilled

Kernel membunuh proses karena melewati memory limit cgroup.

Ciri:

```bash
docker inspect --format '{{.State.OOMKilled}}' my-service
# true
```

Sering exit code:

```text
137
```

Log Java bisa tidak sempat muncul.

Penyebab container OOMKilled bisa berasal dari:

- heap terlalu besar;
- metaspace;
- direct buffer;
- thread stack;
- native memory;
- mmap;
- JIT/code cache;
- agent/profiler;
- log buffer;
- off-heap cache.

Karena itu Part 009 penting: container memory limit bukan hanya heap.

---

## 20. Docker Events sebagai Timeline Runtime

`docker events` membantu melihat lifecycle event:

```bash
docker events
```

Filter container:

```bash
docker events --filter container=my-service
```

Filter sejak waktu tertentu:

```bash
docker events --since 30m
```

Event berguna untuk menjawab:

- container kapan start?
- kapan die?
- apakah restart policy bekerja?
- apakah health status berubah?
- apakah image pull terjadi?
- apakah network connect/disconnect terjadi?

Saat incident, event timeline sering lebih objektif daripada ingatan manusia.

---

## 21. `docker inspect` untuk Diagnostics

`docker inspect` adalah runtime fact source.

Beberapa query penting:

```bash
# State lengkap
docker inspect --format '{{json .State}}' my-service | jq

# Image ID
docker inspect --format '{{.Image}}' my-service

# Args/Entrypoint effective
docker inspect --format 'Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}}' my-service

# Env
docker inspect --format '{{json .Config.Env}}' my-service | jq

# Mounts
docker inspect --format '{{json .Mounts}}' my-service | jq

# Network settings
docker inspect --format '{{json .NetworkSettings.Networks}}' my-service | jq

# Log config
docker inspect --format '{{json .HostConfig.LogConfig}}' my-service | jq

# Restart policy
docker inspect --format '{{json .HostConfig.RestartPolicy}}' my-service | jq

# Resource limits
docker inspect --format 'Memory={{.HostConfig.Memory}} NanoCPUs={{.HostConfig.NanoCpus}} CpuQuota={{.HostConfig.CpuQuota}} CpuPeriod={{.HostConfig.CpuPeriod}}' my-service
```

Prinsip:

> Saat log membingungkan, inspect runtime facts.

---

## 22. Thread Dump, Heap Dump, dan JFR dalam Container

Log sering tidak cukup. Untuk Java, diagnostics tambahan sangat penting.

### 22.1 Thread dump

Jika tools tersedia di image:

```bash
docker exec my-service jcmd 1 Thread.print
```

Atau:

```bash
docker exec my-service jstack 1
```

Jika Java process bukan PID 1:

```bash
docker exec my-service ps -ef
```

Lalu:

```bash
docker exec my-service jcmd <pid> Thread.print
```

### 22.2 Heap dump

```bash
docker exec my-service jcmd 1 GC.heap_dump /tmp/heap.hprof

docker cp my-service:/tmp/heap.hprof ./heap.hprof
```

Masalah:

- heap dump besar;
- `/tmp` mungkin tidak cukup;
- read-only filesystem bisa gagal;
- distroless image mungkin tidak punya `jcmd`;
- production policy bisa melarang heap dump karena PII/secrets di memory.

Lebih aman:

```yaml
services:
  api:
    volumes:
      - ./diagnostics:/diagnostics
```

Lalu:

```bash
docker exec my-service jcmd 1 GC.heap_dump /diagnostics/heap.hprof
```

### 22.3 Java Flight Recorder

JFR dapat dipakai untuk CPU allocation/lock/thread diagnosis:

```bash
docker exec my-service jcmd 1 JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr

docker cp my-service:/tmp/incident.jfr ./incident.jfr
```

Untuk production, tentukan sebelumnya:

- apakah JFR enabled?
- apakah image punya tools?
- di mana output ditulis?
- siapa boleh mengambil artifact?
- bagaimana menghapus artifact setelah incident?

---

## 23. Minimal/Distroless Image dan Masalah Debuggability

Image kecil sering tidak punya:

```text
sh
bash
ps
curl
netstat
ss
jcmd
jstack
jmap
cat
ls
```

Akibat:

```bash
docker exec -it my-service sh
# executable file not found
```

Ini bukan bug. Ini trade-off.

Strategi:

1. gunakan debug image terpisah dengan tools;
2. gunakan multi-stage build untuk production minimal dan debug variant;
3. gunakan sidecar/debug container di network namespace yang sama jika platform mendukung;
4. expose diagnostics endpoint yang aman;
5. gunakan JDK runtime image saat operability lebih penting dari ukuran minimum;
6. dokumentasikan playbook debug untuk minimal image.

Contoh debug variant sederhana:

```dockerfile
FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]

FROM eclipse-temurin:21-jdk AS debug
WORKDIR /app
COPY app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Build:

```bash
docker build --target runtime -t case-api:runtime .
docker build --target debug -t case-api:debug .
```

---

## 24. Diagnostics Tanpa Mengubah Container Menjadi Server Mutable

Anti-pattern:

```bash
docker exec -it my-service bash
apt-get update
apt-get install curl vim net-tools
edit config file
restart app manually
```

Masalah:

- perubahan tidak reproducible;
- container state menyimpang dari image;
- root cause jadi kabur;
- audit buruk;
- fix hilang saat recreate;
- debugging bisa merusak evidence.

Lebih baik:

- inspect;
- logs;
- copy diagnostics artifact;
- reproduce locally with same image digest;
- build debug image jika perlu;
- patch Dockerfile/config lalu redeploy;
- dokumentasikan root cause dan prevention.

Prinsip:

> Mutating a running container is a last-resort forensic action, not an operational model.

---

## 25. Logging untuk Spring Boot di Docker

Spring Boot secara default log ke console, dan tidak menulis file kecuali `logging.file.name` atau `logging.file.path` diset.

Container-friendly default:

```properties
spring.application.name=case-api
logging.level.root=INFO
```

Hindari default production seperti:

```properties
logging.file.name=/app/logs/application.log
```

Kecuali ada alasan eksplisit dan path tersebut dikelola benar.

Untuk structured logging, gunakan encoder JSON seperti Logstash Logback Encoder atau mekanisme logging JSON lain.

Konsep Logback dengan console appender JSON:

```xml
<configuration>
  <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder" />
  </appender>

  <root level="INFO">
    <appender-ref ref="CONSOLE" />
  </root>
</configuration>
```

MDC example:

```java
try {
    MDC.put("requestId", requestId);
    MDC.put("caseId", caseId);
    log.info("case submission started");
    service.submit(command);
    log.info("case submission completed");
} finally {
    MDC.clear();
}
```

Dalam aplikasi async/reactive, pastikan MDC propagation tidak hilang antar thread.

---

## 26. Access Logs: Application vs Proxy vs Container

Untuk Java web service, access log bisa berasal dari:

- embedded Tomcat/Jetty/Netty;
- reverse proxy seperti Nginx;
- load balancer;
- API gateway;
- service mesh/proxy;
- application custom filter.

Dalam Docker local environment, jangan duplikasi semua layer tanpa tujuan.

Pertanyaan desain:

1. Siapa authoritative source untuk request log?
2. Apakah app log perlu access log per request?
3. Apakah trace ID sudah muncul di access log?
4. Apakah healthcheck request perlu dilog?
5. Apakah static asset/request noise perlu difilter?
6. Apakah request body aman untuk dilog?

Untuk service Java API, sering cukup:

- structured application event logs;
- error logs dengan trace ID;
- access logs di ingress/proxy layer;
- sampling untuk high-volume endpoints.

---

## 27. Sensitive Data Leakage di Logs

Container logs biasanya mudah dikumpulkan dan disebarkan. Karena itu leakage lebih berbahaya.

Jangan log:

```text
Authorization header
Cookie
JWT raw token
API key
password
private key
database URL dengan password
PII sensitif
full request body untuk endpoint sensitif
credit card / national ID / medical data
```

Docker-specific leakage paths:

- `docker logs` dapat diakses operator host;
- log driver mengirim ke backend shared;
- support bundle menyertakan log;
- crash dump berisi memory secret;
- startup log mencetak env;
- exception message dari library bisa menyertakan connection string.

Mitigasi:

- redaction filter;
- allowlist fields, bukan blacklist;
- structured logging dengan field classification;
- separate audit event from diagnostic log;
- log retention policy;
- restricted access to log backend;
- avoid printing full env at startup.

---

## 28. Correlation ID, Trace ID, dan Workflow Context

Dalam distributed Java systems, log tanpa correlation ID hampir tidak berguna saat incident.

Minimal fields:

```text
traceId
spanId
requestId
service
version
environment
containerId or hostname
```

Untuk regulatory/case-management system, tambahan domain context bisa sangat berguna:

```text
tenantId
caseId
workflowId
transitionName
actorType
commandId
correlationId
causationId
```

Tetapi hati-hati:

- jangan log PII detail;
- jangan log data evidence sensitif;
- jangan jadikan log sebagai legal record utama kecuali sistem dirancang untuk itu;
- pastikan retention sesuai compliance.

Good log event:

```json
{
  "level": "INFO",
  "event": "case.transition.accepted",
  "caseId": "CASE-2026-000123",
  "workflowId": "WF-9981",
  "fromState": "UNDER_REVIEW",
  "toState": "ESCALATED",
  "commandId": "CMD-7781",
  "traceId": "abc123",
  "service": "case-workflow-api"
}
```

Bad log event:

```json
{
  "level": "INFO",
  "message": "user submitted case",
  "fullPayload": "{...massive sensitive request body...}"
}
```

---

## 29. Docker Stats and Logs: Correlating Symptoms

Saat service lambat, logs saja tidak cukup.

Gunakan:

```bash
docker stats my-service
```

Lihat:

- CPU %;
- memory usage/limit;
- network IO;
- block IO;
- PIDs.

Correlate dengan logs:

| Symptom | Logs | Stats | Dugaan |
|---|---|---|---|
| high latency | timeout warnings | CPU 100% | CPU saturation/GC |
| restart | startup repeated | memory near limit | OOM/restart loop |
| no logs | app silent | container exited | startup failure before logging |
| many errors | stack traces | disk IO high | logging storm |
| request timeout | dependency warn | network IO low | dependency DNS/connectivity |

Jangan langsung menyimpulkan Docker lambat. Docker hanya memberi boundary; bottleneck sering ada di:

- JVM config;
- dependency;
- DB pool;
- logging storm;
- CPU quota;
- host disk;
- network DNS;
- GC pressure.

---

## 30. `docker top`, `docker exec`, dan Runtime Process Diagnostics

Melihat process di container:

```bash
docker top my-service
```

Masuk ke container jika shell tersedia:

```bash
docker exec -it my-service sh
```

Melihat env dari dalam:

```bash
docker exec my-service env
```

Melihat file:

```bash
docker exec my-service ls -lah /app
```

Melihat port listening jika tool tersedia:

```bash
docker exec my-service ss -lntp
```

Untuk Java:

```bash
docker exec my-service jcmd 1 VM.version

docker exec my-service jcmd 1 VM.flags

docker exec my-service jcmd 1 VM.system_properties

docker exec my-service jcmd 1 VM.native_memory summary
```

`VM.native_memory` membutuhkan JVM Native Memory Tracking diaktifkan:

```bash
-XX:NativeMemoryTracking=summary
```

Trade-off: NMT punya overhead, sehingga gunakan dengan sengaja.

---

## 31. Healthcheck Logs dan Noise

Healthcheck bisa menghasilkan banyak log jika endpoint dilog seperti request biasa.

Contoh masalah:

```text
GET /actuator/health 200
GET /actuator/health 200
GET /actuator/health 200
...
```

Jika interval healthcheck 5 detik, satu service menghasilkan 17.280 log healthcheck per hari.

Mitigasi:

- exclude health endpoint dari access log;
- log hanya health transition, bukan setiap check;
- gunakan separate readiness/liveness semantics;
- pastikan healthcheck timeout realistis;
- jangan healthcheck membuat query mahal ke DB setiap beberapa detik.

Container health dan logging saling berkaitan: healthcheck yang buruk bisa menjadi noise dan beban.

---

## 32. Log Retention: Runtime, Host, Backend

Ada tiga level retention:

```text
container/driver retention
host retention
central backend retention
```

Pertanyaan:

1. Berapa lama log tersedia lewat `docker logs`?
2. Berapa besar log file per container?
3. Apa yang terjadi saat container recreate?
4. Apakah log dikirim ke central backend?
5. Berapa retention backend?
6. Siapa boleh mengakses log?
7. Bagaimana menghapus log sensitif?
8. Apakah log termasuk dalam backup?

Local/dev boleh sederhana. Production harus eksplisit.

Contoh local Compose:

```yaml
services:
  api:
    image: case-api:dev
    logging:
      driver: local
      options:
        max-size: "10m"
        max-file: "3"
```

Contoh single-host production minimal:

```yaml
services:
  api:
    image: registry.example.com/case-api@sha256:...
    logging:
      driver: local
      options:
        max-size: "50m"
        max-file: "5"
```

Dengan external collector, tetap tentukan fallback jika collector gagal.

---

## 33. Incident Playbook: Java Container Crash Loop

Skenario:

```text
case-api restarting terus setiap beberapa detik
```

Langkah:

```bash
# 1. Lihat status
docker compose ps -a

# 2. Ambil logs
docker compose logs --timestamps --tail 500 api

# 3. Inspect state
docker inspect case-api-container-name \
  --format 'ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}} Error={{.State.Error}}'

# 4. Inspect config
docker inspect case-api-container-name \
  --format 'Image={{.Image}} Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}}'

# 5. Cek mounts/env/network jika log menunjuk config issue
docker inspect case-api-container-name --format '{{json .Mounts}}' | jq
docker inspect case-api-container-name --format '{{json .Config.Env}}' | jq

# 6. Cek events
docker events --since 15m --filter container=case-api-container-name
```

Interpretasi cepat:

| Finding | Kemungkinan |
|---|---|
| ExitCode=127 | command/entrypoint tidak ditemukan |
| ExitCode=126 | permission/shebang/line ending |
| ExitCode=137 + OOMKilled=true | memory limit/container OOM |
| ExitCode=143 | stop/restart normal via SIGTERM |
| log `Connection refused` DB | dependency belum ready/salah host |
| log `permission denied` | user/mount ownership |
| log kosong + exit cepat | process tidak start, entrypoint issue |
| repeated startup banner | restart loop |

---

## 34. Incident Playbook: Container Running but No Logs

Skenario:

```bash
docker logs api
# kosong
```

Kemungkinan:

1. aplikasi belum menghasilkan log;
2. aplikasi log ke file, bukan console;
3. logging level terlalu tinggi;
4. process bukan yang diharapkan;
5. log driver `none`;
6. log driver external dan `docker logs` tidak menampilkan sesuai ekspektasi;
7. container sudah recreate dan yang dilihat container baru;
8. app hang sebelum logging initialized.

Langkah:

```bash
# cek process
docker top api

# cek log driver
docker inspect --format '{{json .HostConfig.LogConfig}}' api | jq

# cek entrypoint/cmd
docker inspect --format 'Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}}' api

# cek apakah ada file log internal
docker exec api find /app -maxdepth 3 -type f -name "*.log" 2>/dev/null

# cek stdout manual jika memungkinkan
docker exec api sh -c 'echo test-from-container'
```

Jika Spring Boot:

- cek apakah `logging.file.name` diset;
- cek apakah Logback config hanya file appender;
- cek apakah profile production mengganti appender;
- cek apakah startup gagal sebelum logging framework initialized.

---

## 35. Incident Playbook: Host Disk Penuh karena Logs

Skenario:

```text
no space left on device
Docker daemon unstable
container cannot start
```

Langkah investigasi:

```bash
# host disk
 df -h

# docker disk usage
 docker system df

# cari log path container tertentu
 docker inspect --format '{{.LogPath}}' my-service

# ukuran log jika pakai json-file
 sudo du -h $(docker inspect --format '{{.LogPath}}' my-service)
```

Jangan sembarang hapus file di bawah `/var/lib/docker` saat daemon berjalan tanpa memahami dampaknya.

Mitigasi jangka pendek:

- stop service noisy jika perlu;
- rotate/truncate dengan prosedur aman;
- collect sample evidence dulu;
- kurangi log level;
- aktifkan log rotation;
- pindah ke local/external driver.

Mitigasi permanen:

```json
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  }
}
```

Atau per Compose service:

```yaml
logging:
  driver: local
  options:
    max-size: "20m"
    max-file: "5"
```

Prevention:

- disk alert;
- log volume alert;
- noisy log detection;
- default daemon log rotation;
- avoid stack trace storms.

---

## 36. Incident Playbook: Need Heap Dump but Container Is Read-Only

Skenario:

```text
Container memory leak suspected.
Root filesystem read-only.
Need heap dump.
```

Jika tidak ada writable diagnostics mount, heap dump bisa gagal.

Better design before incident:

```yaml
services:
  api:
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - diagnostics:/diagnostics

volumes:
  diagnostics:
```

Runtime:

```bash
docker exec api jcmd 1 GC.heap_dump /diagnostics/heap-$(date +%s).hprof
```

Copy out:

```bash
docker cp api:/diagnostics/heap-1718950000.hprof ./heap.hprof
```

Security concern:

- heap dump bisa mengandung secret dan PII;
- treat as sensitive artifact;
- encrypt/store carefully;
- delete after analysis according to policy.

---

## 37. Observability Boundary: Logs, Metrics, Traces, Dumps

Jangan paksa log menyelesaikan semua masalah.

| Signal | Cocok untuk |
|---|---|
| Logs | discrete events, errors, state transitions |
| Metrics | rates, saturation, latency, resource usage |
| Traces | request path across services |
| Profiles/JFR | CPU allocation locks internals |
| Thread dump | deadlock, blocked threads |
| Heap dump | memory retention/leak |
| Docker inspect | runtime configuration truth |
| Docker events | lifecycle timeline |

Top-tier engineer tidak hanya bertanya:

```text
mana lognya?
```

Tetapi:

```text
sinyal apa yang paling tepat untuk hipotesis ini?
```

Contoh:

- latency naik -> metrics + traces + GC logs;
- deadlock -> thread dump;
- memory leak -> metrics + heap dump;
- config mismatch -> inspect + startup logs;
- crash loop -> exit code + logs + events;
- deployment wrong version -> image digest + startup metadata.

---

## 38. GC Logs dalam Container

GC logs sering berguna untuk Java performance incident.

Java 9+ unified logging:

```bash
-Xlog:gc*:stdout:time,uptime,level,tags
```

Ke stdout:

```bash
JAVA_TOOL_OPTIONS="-Xlog:gc*:stdout:time,uptime,level,tags"
```

Atau file jika perlu artifact:

```bash
-Xlog:gc*:file=/diagnostics/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

Container principle:

- untuk normal operations, GC summary ke stdout bisa cukup;
- untuk deep incident, file GC log ke diagnostics mount bisa lebih baik;
- jangan tulis GC log besar ke container writable layer tanpa rotasi.

---

## 39. Designing a Container-Friendly Logging Contract

Sebuah Java service Docker-ready sebaiknya punya logging contract tertulis:

```text
1. App logs go to stdout/stderr.
2. Logs are structured JSON in production.
3. Every request has traceId/requestId.
4. Domain commands include safe correlation fields.
5. Secrets and PII are redacted.
6. Docker logging driver has rotation.
7. Startup logs include version, digest/commit, profile, port, JVM, limits.
8. Healthcheck noise is suppressed.
9. Crash forensic commands are documented.
10. Heap/JFR dumps go to explicit diagnostics location, not random container path.
```

This turns logging from accidental output into operational interface.

---

## 40. Example: Production-ish Compose Logging for Java Service

```yaml
services:
  case-api:
    image: registry.example.com/case-api@sha256:REPLACE_WITH_DIGEST
    restart: unless-stopped
    environment:
      SPRING_PROFILES_ACTIVE: production
      SERVER_PORT: "8080"
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70
        -XX:+ExitOnOutOfMemoryError
        -Xlog:gc*:stdout:time,uptime,level,tags
    ports:
      - "8080:8080"
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - diagnostics:/diagnostics
    logging:
      driver: local
      options:
        max-size: "50m"
        max-file: "5"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health/readiness"]
      interval: 10s
      timeout: 3s
      retries: 6
      start_period: 40s

volumes:
  diagnostics:
```

Catatan:

- `local` driver membatasi risiko disk exhaustion;
- diagnostics volume disediakan untuk dump/JFR;
- root filesystem read-only menjaga immutability;
- healthcheck punya start period;
- GC logs ke stdout agar masuk logging pipeline;
- image by digest menjaga traceability.

Untuk image minimal yang tidak punya `wget`, healthcheck harus disesuaikan, misalnya memakai binary kecil, app-native healthcheck, atau platform-level probe.

---

## 41. Example: Spring Boot Logback JSON + MDC

Pseudo dependency:

```xml
<dependency>
  <groupId>net.logstash.logback</groupId>
  <artifactId>logstash-logback-encoder</artifactId>
  <version>${logstash-logback-encoder.version}</version>
</dependency>
```

`logback-spring.xml` conceptual example:

```xml
<configuration>
  <springProperty scope="context" name="appName" source="spring.application.name" />

  <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
      <customFields>{"service":"${appName}"}</customFields>
    </encoder>
  </appender>

  <root level="INFO">
    <appender-ref ref="CONSOLE" />
  </root>
</configuration>
```

Request filter concept:

```java
@Component
public class RequestCorrelationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String requestId = Optional.ofNullable(request.getHeader("X-Request-Id"))
                .filter(s -> !s.isBlank())
                .orElse(UUID.randomUUID().toString());

        try {
            MDC.put("requestId", requestId);
            response.setHeader("X-Request-Id", requestId);
            filterChain.doFilter(request, response);
        } finally {
            MDC.clear();
        }
    }
}
```

This is not Docker-specific, but Docker makes it more important because logs are often the first runtime evidence.

---

## 42. Anti-Patterns

### 42.1 Logging only to file

```properties
logging.file.name=/app/logs/app.log
```

Without console appender, `docker logs` becomes useless.

### 42.2 No log rotation

```text
json-file default + verbose production logs = disk exhaustion risk
```

### 42.3 Logging secrets at startup

```text
Loaded config: DB_PASSWORD=...
```

### 42.4 Treating stack trace storm as observability

A million identical stack traces is not insight. It is an outage amplifier.

### 42.5 Debugging by mutating container

```bash
apt install vim
edit config
restart manually
```

This destroys reproducibility.

### 42.6 Assuming `docker logs` always works with every driver

Check logging driver.

### 42.7 No startup version evidence

Without version/commit/image metadata in logs, rollback/debug becomes guesswork.

### 42.8 Healthcheck noise

Logging every healthcheck can dominate logs.

### 42.9 Heap dump into writable layer

Large dump can fill container/host storage.

### 42.10 Log as business source of truth

Logs are diagnostic evidence, not primary transactional storage.

---

## 43. Diagnostic Decision Tree

```text
Problem: service unhealthy or failed

1. Is container running?
   ├─ no  -> docker ps -a, inspect exit code, logs, events
   └─ yes -> continue

2. Are logs available?
   ├─ no  -> inspect log driver, appender config, process, file logs
   └─ yes -> tail recent logs with timestamps

3. Did it restart?
   ├─ yes -> restart count, previous logs, exit code, OOMKilled
   └─ no  -> continue

4. Is resource pressure visible?
   ├─ yes -> docker stats, JVM metrics, GC logs, heap/thread dump
   └─ no  -> continue

5. Is config/runtime mismatch suspected?
   ├─ yes -> inspect env, mounts, entrypoint, image digest, networks
   └─ no  -> continue

6. Is dependency issue suspected?
   ├─ yes -> network checks, DNS, dependency logs, health status
   └─ no  -> collect deeper Java diagnostics

7. Is evidence enough?
   ├─ yes -> fix/redeploy with immutable change
   └─ no  -> reproduce same image digest in controlled environment
```

---

## 44. Checklist: Docker Logging Readiness for Java Service

Before production:

```text
[ ] Application logs to stdout/stderr.
[ ] Console logging remains enabled in production profile.
[ ] Logs are structured or consistently parseable.
[ ] Trace/request ID exists in every request log.
[ ] Startup log contains app version, commit, profile, port, Java version.
[ ] Startup log does not leak env/secrets.
[ ] Docker logging driver is explicitly chosen.
[ ] Log rotation is configured.
[ ] Healthcheck access logs are suppressed or controlled.
[ ] Error logs avoid stack trace storms.
[ ] Docker inspect/logs/events playbook exists.
[ ] Heap dump/JFR output path is explicit.
[ ] Diagnostics artifacts are treated as sensitive.
[ ] Minimal image debug strategy exists.
[ ] Host disk monitoring exists.
```

---

## 45. Key Takeaways

1. Docker logging starts from stdout/stderr, not from random files inside container.
2. `docker logs` is useful, but its behavior depends on logging driver and container lifecycle.
3. Logging driver choice is an operational architecture decision.
4. Default `json-file` without rotation can fill host disk.
5. The `local` driver is often a safer single-host default.
6. Java stack traces can become logging storms.
7. Structured logs are much more useful in containerized environments.
8. Crash forensics requires logs, inspect, exit code, OOMKilled, restart count, and events.
9. JVM OOM and container OOMKilled are different failure modes.
10. Minimal images improve security/surface area but reduce ad-hoc debuggability.
11. Diagnostics artifacts such as heap dump and JFR need explicit writable paths.
12. Mutating running containers is not an operational model.
13. A senior engineer designs logging as a runtime contract.

---

## 46. Referensi

- Docker documentation — `docker container logs`: https://docs.docker.com/reference/cli/docker/container/logs/
- Docker documentation — Configure logging drivers: https://docs.docker.com/engine/logging/configure/
- Docker documentation — JSON File logging driver: https://docs.docker.com/engine/logging/drivers/json-file/
- Docker documentation — Local file logging driver: https://docs.docker.com/engine/logging/drivers/local/
- Docker documentation — Docker inspect CLI reference: https://docs.docker.com/reference/cli/docker/inspect/
- Docker documentation — Docker stats CLI reference: https://docs.docker.com/reference/cli/docker/container/stats/
- Docker documentation — Docker events CLI reference: https://docs.docker.com/reference/cli/docker/system/events/
- Spring Boot documentation — Logging: https://docs.spring.io/spring-boot/reference/features/logging.html

---

## 47. Status Seri

Part ini adalah:

```text
Part 021 dari 031
```

Yang sudah selesai:

```text
Part 000-021
```

Seri belum selesai.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-022.md
```

Dengan topik:

```text
Debugging Running Containers: exec, nsenter, Inspect, Events, Minimal Images
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Performance and Resource Management: CPU, Memory, IO, Startup, Image Size</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-022.md">Part 022 — Debugging Running Containers: `exec`, Inspect, Events, Minimal Images ➡️</a>
</div>
