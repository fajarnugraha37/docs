# learn-docker-mastery-for-java-engineers-part-004.md

# Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `004 / 031`  
> Topik: container lifecycle, state machine, restart policy, exit code, stop signal, health status, dan debugging lifecycle failure  
> Target pembaca: Java software engineer yang ingin memahami Docker sebagai runtime lifecycle system, bukan sekadar command wrapper

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita membangun tiga fondasi besar:

1. **Part 000**: Docker bukan VM kecil, melainkan mekanisme packaging dan runtime boundary untuk proses.
2. **Part 001**: Container adalah proses host yang diberi boundary lewat namespace, cgroup, dan filesystem isolation.
3. **Part 002**: Docker terdiri dari CLI, daemon, containerd, runc, registry, image store, metadata, dan runtime supervision.
4. **Part 003**: Image adalah artifact immutable berbasis layer, tag, digest, manifest, dan platform.

Part ini menjawab pertanyaan berikut:

> Setelah image tersedia, bagaimana Docker mengubah image itu menjadi container yang hidup, berhenti, gagal, restart, dihapus, dan didiagnosis?

Ini penting karena banyak engineer paham `docker run`, tetapi tidak paham bahwa `docker run` menyembunyikan beberapa transisi lifecycle sekaligus. Akibatnya, saat container tidak berjalan sesuai ekspektasi, debugging menjadi spekulatif.

Part ini akan membangun mental model:

```text
image -> create container -> start process -> running -> stop / exit / crash -> restart? -> remove
```

Kita akan melihat container sebagai **runtime object dengan state machine**, bukan sebagai command yang “sekali jalan langsung jadi”.

---

## 1. Learning Objectives

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan **image**, **container object**, dan **running process**.
2. Menjelaskan apa yang terjadi saat `docker create`, `docker start`, dan `docker run`.
3. Membaca status container secara benar: `created`, `running`, `paused`, `restarting`, `exited`, dan `dead`.
4. Memahami kenapa container bisa `Exited (0)`, `Exited (1)`, `Exited (137)`, atau restart terus.
5. Memahami `docker stop` sebagai proses pengiriman signal, bukan “kill langsung”.
6. Mendesain Java service agar graceful shutdown berjalan di container.
7. Membedakan **process status** dan **health status**.
8. Menggunakan restart policy dengan benar.
9. Melakukan debugging lifecycle failure secara sistematis.
10. Menghindari anti-pattern seperti menjalankan process manager penuh di dalam container atau memperlakukan container sebagai server mutable.

---

## 2. Sumber Resmi dan Referensi

Part ini disusun berdasarkan dokumentasi resmi Docker dan praktik operasional container umum:

- Docker docs — Running containers:  
  <https://docs.docker.com/engine/containers/run/>
- Docker CLI reference — `docker container run`:  
  <https://docs.docker.com/reference/cli/docker/container/run/>
- Docker CLI reference — `docker container create`:  
  <https://docs.docker.com/reference/cli/docker/container/create/>
- Docker CLI reference — `docker container start`:  
  <https://docs.docker.com/reference/cli/docker/container/start/>
- Docker CLI reference — `docker container stop`:  
  <https://docs.docker.com/reference/cli/docker/container/stop/>
- Docker CLI reference — `docker container restart`:  
  <https://docs.docker.com/reference/cli/docker/container/restart/>
- Docker CLI reference — `docker container ls`:  
  <https://docs.docker.com/reference/cli/docker/container/ls/>
- Docker docs — Start containers automatically / restart policies:  
  <https://docs.docker.com/engine/containers/start-containers-automatically/>
- Dockerfile reference — `HEALTHCHECK`:  
  <https://docs.docker.com/reference/dockerfile/>
- Docker Compose services reference — `healthcheck`:  
  <https://docs.docker.com/reference/compose-file/services/>

Catatan penting: dokumentasi Docker menjelaskan bahwa Docker menjalankan proses dalam container yang terisolasi, dan `docker run` membuat serta menjalankan container dari image. Dokumentasi `docker create` menegaskan bahwa command tersebut membuat container dari image tanpa menjalankannya. Dokumentasi `docker stop` menjelaskan bahwa proses utama container menerima `SIGTERM`, lalu setelah grace period akan menerima `SIGKILL` bila belum berhenti.

---

## 3. Mental Model Utama: Image, Container Object, Running Process

Kesalahan paling umum dalam memahami Docker lifecycle adalah mencampur tiga konsep ini:

| Konsep | Sifat | Analogi | Contoh |
|---|---|---|---|
| Image | Immutable template | class / artifact release | `eclipse-temurin:21-jre` |
| Container object | Runtime configuration + writable layer + metadata | object instance yang belum tentu hidup | `my-api-container` |
| Running process | Proses aktual di host dalam boundary container | thread utama aplikasi | `java -jar app.jar` |

Dalam Java analogy:

```java
Image image = registry.pull("my-api:1.0.0");
Container container = docker.create(image, config);
Process process = docker.start(container);
```

Tentu Docker bukan Java object model, tetapi analogy ini membantu.

### 3.1 Image bukan container

Image tidak “berjalan”. Image hanya template filesystem + metadata default seperti:

- entrypoint
- command
- env default
- exposed port metadata
- working directory
- user default
- labels
- healthcheck default

Image bisa dipull, ditag, dihapus, discan, dan dipush. Tetapi image tidak punya lifecycle runtime seperti running/exited.

### 3.2 Container bukan selalu proses berjalan

Container bisa ada tanpa proses aktif.

Contoh:

```bash
docker create --name demo nginx:alpine
```

Setelah command ini, container object sudah ada. Ia punya:

- ID
- name
- image reference
- config
- environment
- mount configuration
- network configuration
- writable layer
- restart policy
- metadata

Tetapi proses Nginx belum berjalan.

Cek:

```bash
docker ps
```

Container tidak muncul karena default `docker ps` hanya menampilkan yang running.

Cek semua container:

```bash
docker ps -a
```

Kamu akan melihat status semacam:

```text
Created
```

### 3.3 Running process adalah pusat lifecycle

Container dianggap hidup selama proses utama container masih hidup.

Ini sangat penting:

> Container bukan mesin virtual yang “tetap hidup” walaupun aplikasi utamanya mati. Container hidup karena proses utamanya hidup.

Jika proses utama selesai, container keluar.

Contoh:

```bash
docker run alpine echo hello
```

Output:

```text
hello
```

Setelah itu container berhenti.

Kenapa? Karena proses utama `echo hello` selesai dengan exit code 0.

---

## 4. `docker run` Itu Bukan Satu Operasi Sederhana

Banyak engineer memulai dari:

```bash
docker run nginx
```

Tetapi `docker run` sebenarnya menggabungkan beberapa operasi:

```text
resolve image
pull image jika belum ada
create container object
attach network/mount/config
start container process
optionally attach stdout/stderr/stdin
wait or detach tergantung mode
```

Secara konseptual:

```bash
docker pull nginx

docker create --name web nginx

docker start web
```

`docker run` adalah convenience command.

### 4.1 Kenapa ini penting?

Karena failure bisa terjadi di fase berbeda.

| Fase | Contoh failure | Gejala |
|---|---|---|
| Resolve image | tag salah | `manifest unknown` |
| Pull image | registry unreachable | timeout / unauthorized |
| Create container | port conflict, mount invalid | container tidak dibuat |
| Start process | command tidak ditemukan | exited 127 |
| Runtime | app crash | exited 1 / restart loop |
| Stop | app tidak handle SIGTERM | dipaksa SIGKILL |

Jika kamu hanya berpikir “docker run gagal”, diagnosis akan kabur.

---

## 5. Container State Machine

Docker menampilkan status container melalui command seperti:

```bash
docker ps -a
```

Status umum:

```text
created
running
paused
restarting
exited
dead
```

Secara sederhana:

```text
           docker create
image  --------------------> created
                                 |
                                 | docker start
                                 v
                              running
                              /  |   \
                             /   |    \
                  docker stop    |     process exits/crashes
                           v     |      v
                         exited <-------
                           |
                           | docker start
                           v
                         running

running -- docker pause --> paused -- docker unpause --> running

running/exited -- docker rm --> removed

running crash + restart policy --> restarting --> running or exited
```

### 5.1 `created`

Container sudah dibuat, tetapi belum pernah dijalankan.

Contoh:

```bash
docker create --name c1 alpine sleep 60

docker ps -a
```

Status:

```text
Created
```

Apa yang sudah ada?

- container metadata
- writable layer
- config
- mount definition
- network definition

Apa yang belum ada?

- running process
- active PID
- running application

### 5.2 `running`

Container sedang memiliki proses utama aktif.

Contoh:

```bash
docker start c1

docker ps
```

Status:

```text
Up ...
```

`running` berarti proses utama belum selesai. Tidak berarti aplikasi sehat. Tidak berarti port reachable. Tidak berarti request bisa diproses.

Ini distinction yang sangat penting untuk production.

### 5.3 `exited`

Container pernah berjalan, tetapi proses utama sudah selesai.

Contoh:

```bash
docker run --name hello alpine echo hello

docker ps -a
```

Status:

```text
Exited (0)
```

Exit code 0 berarti proses selesai normal.

Namun dalam konteks long-running service, `Exited (0)` bisa tetap menjadi problem. Misalnya Java service tidak sengaja menjalankan migration command lalu selesai, padahal deployment mengharapkan HTTP server tetap hidup.

### 5.4 `paused`

Container dihentikan sementara menggunakan cgroup freezer mechanism.

Contoh:

```bash
docker pause my-container

docker unpause my-container
```

Untuk application engineer, `paused` jarang digunakan dalam workflow normal. Tetapi penting mengenal status ini agar tidak salah diagnosis.

Container paused:

- prosesnya tidak exit
- tetapi execution-nya dibekukan
- network connection bisa timeout
- app terlihat “hang”

### 5.5 `restarting`

Container sedang di-restart oleh restart policy.

Contoh:

```bash
docker run --restart=always my-broken-app
```

Jika app langsung crash, status bisa berulang:

```text
Restarting (1) 3 seconds ago
```

Ini sering terlihat sebagai “crash loop”.

### 5.6 `dead`

Status `dead` berarti Docker gagal membersihkan container secara normal. Ini jarang, tetapi bisa terjadi karena masalah daemon, filesystem, runtime, mount, atau resource host.

Untuk engineer aplikasi, `dead` adalah sinyal bahwa problem mungkin bukan sekadar aplikasi crash, tetapi ada isu di Docker daemon/host/runtime.

---

## 6. Command Lifecycle: Create, Start, Stop, Restart, Remove

Sekarang kita pecah command lifecycle satu per satu.

---

## 7. `docker create`: Membuat Container Object Tanpa Menjalankan

Command:

```bash
docker create --name my-api my-api:1.0.0
```

Makna:

```text
Buat container object dari image, simpan config runtime, tetapi jangan start prosesnya.
```

### 7.1 Kapan `docker create` berguna?

Untuk daily development, kamu lebih sering pakai `docker run`. Tetapi `docker create` berguna untuk memahami lifecycle dan beberapa workflow:

1. Membuat container dengan config kompleks sebelum distart.
2. Mengekstrak file dari image/container tanpa menjalankan proses.
3. Memisahkan failure create vs start.
4. Tooling internal yang ingin prepare container object dulu.

Contoh mengambil artifact dari image:

```bash
docker create --name temp my-builder-image

docker cp temp:/app/build/libs/app.jar ./app.jar

docker rm temp
```

### 7.2 Apa yang bisa gagal saat create?

Contoh failure:

```bash
docker create \
  --name my-api \
  -p 8080:8080 \
  -v /path/not/exist:/data \
  my-api:1.0.0
```

Kemungkinan:

- image tidak ada
- image platform tidak sesuai
- name conflict
- invalid mount path
- invalid flag
- invalid network
- invalid restart policy
- invalid user

`docker create` belum menjalankan aplikasi, jadi error pada fase ini biasanya bukan error aplikasi Java.

---

## 8. `docker start`: Menjalankan Container yang Sudah Ada

Command:

```bash
docker start my-api
```

Makna:

```text
Gunakan container object yang sudah ada, lalu jalankan proses utama sesuai config image/container.
```

### 8.1 Config container tidak otomatis berubah saat image berubah

Ini point penting.

Misalnya:

```bash
docker create --name my-api my-api:1.0.0
```

Lalu kamu build ulang image `my-api:1.0.0`.

```bash
docker build -t my-api:1.0.0 .
```

Lalu:

```bash
docker start my-api
```

Container `my-api` tetap menggunakan image/layer/config yang direferensikan saat container dibuat. Dalam praktik, jangan mengandalkan container lama untuk mengambil image baru. Biasanya kamu remove dan create container baru.

```bash
docker rm my-api

docker run --name my-api my-api:1.0.0
```

### 8.2 `docker start` tidak menerima semua opsi `docker run`

Ini juga sering membingungkan.

Kamu tidak bisa mengubah port mapping dengan `docker start`.

Salah:

```bash
docker start -p 8080:8080 my-api
```

Port mapping adalah create-time configuration. Untuk mengubahnya, buat container baru.

### 8.3 Start failure

Container bisa berhasil dibuat tetapi gagal distart.

Contoh:

```bash
docker create --name bad alpine /missing-command

docker start bad
```

Kemungkinan status:

```text
Exited (127)
```

Karena command tidak ditemukan.

---

## 9. `docker stop`: Graceful Stop dengan Signal

Command:

```bash
docker stop my-api
```

Makna:

```text
Kirim signal stop ke proses utama container, tunggu grace period, lalu kill jika belum berhenti.
```

Secara default di Linux, Docker mengirim `SIGTERM` ke proses utama container, menunggu timeout, lalu mengirim `SIGKILL` jika proses belum berhenti. Signal awal bisa dikonfigurasi lewat Dockerfile `STOPSIGNAL` atau flag runtime `--stop-signal`.

### 9.1 Stop bukan kill langsung

Mental model:

```text
docker stop
    |
    v
send SIGTERM to PID 1 inside container
    |
    v
wait grace period
    |
    +--> process exits cleanly -> container Exited
    |
    +--> process still alive -> send SIGKILL -> container Exited
```

### 9.2 Kenapa ini krusial untuk Java?

Java service biasanya perlu waktu untuk:

- berhenti menerima request baru
- menyelesaikan in-flight request
- flush log buffer
- close DB connection pool
- commit/rollback transaction
- close Kafka/RabbitMQ consumer gracefully
- stop scheduled jobs
- deregister dari service discovery
- flush metrics
- close file handle

Kalau app tidak menerima signal dengan benar, Docker akan menunggu lalu `SIGKILL`. `SIGKILL` tidak bisa ditangkap proses.

Akibat:

- request terputus
- transaction intermediate
- message consumer duplicate processing
- lock tidak dilepas secara graceful
- telemetry hilang
- shutdown hook tidak berjalan

### 9.3 Spring Boot dan graceful shutdown

Untuk Spring Boot modern, graceful shutdown bisa dikonfigurasi. Contoh konseptual:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Lalu Docker stop timeout perlu diselaraskan:

```bash
docker run --stop-timeout=40 my-api:1.0.0
```

Jika app butuh 30 detik graceful shutdown tetapi Docker memberi 10 detik, kamu tetap bisa dipaksa mati.

### 9.4 `docker kill` berbeda dari `docker stop`

```bash
docker kill my-api
```

Biasanya langsung mengirim signal kill, default-nya `SIGKILL`.

Perbedaan:

| Command | Default behavior | Graceful? |
|---|---|---|
| `docker stop` | SIGTERM lalu SIGKILL setelah timeout | Ya, jika app handle SIGTERM |
| `docker kill` | SIGKILL langsung secara default | Tidak |

Gunakan `docker kill` untuk kondisi paksa, bukan shutdown normal.

---

## 10. `docker restart`: Stop Lalu Start

Command:

```bash
docker restart my-api
```

Makna:

```text
Stop container, lalu start kembali container yang sama.
```

Ini bukan create container baru.

Artinya:

- port mapping tetap sama
- env tetap sama
- mount tetap sama
- image reference container tetap sama
- writable layer tetap sama
- container ID tetap sama

### 10.1 Kapan restart berguna?

- Restart local dev container.
- Apply config yang dibaca ulang saat startup tetapi container config tidak berubah.
- Recovery manual dari transient issue.

### 10.2 Kapan restart tidak cukup?

Restart tidak cukup jika kamu ingin:

- memakai image baru
- mengubah env var
- mengubah port mapping
- mengubah mount
- mengubah network config create-time
- mengganti user
- mengganti entrypoint

Untuk itu, recreate container.

---

## 11. `docker rm`: Menghapus Container Object

Command:

```bash
docker rm my-api
```

Makna:

```text
Hapus container object, metadata, dan writable layer container.
```

Jika container masih running, biasanya harus dihentikan dulu atau pakai force:

```bash
docker rm -f my-api
```

### 11.1 Menghapus container tidak selalu menghapus volume

Ini critical.

Jika container memakai named volume, volume biasanya tetap ada walaupun container dihapus.

Contoh:

```bash
docker run --name db -v pgdata:/var/lib/postgresql/data postgres

docker rm -f db

docker volume ls
```

Volume `pgdata` masih ada.

Ini bagus untuk persistence, tetapi sering menyebabkan kebingungan saat local dev:

> “Saya sudah recreate container database, kenapa data lama masih ada?”

Karena data ada di volume, bukan di container.

### 11.2 `--rm`

Command:

```bash
docker run --rm alpine echo hello
```

Makna:

```text
Jalankan container, lalu otomatis hapus container object setelah selesai.
```

Cocok untuk short-lived task:

- command utility
- one-off script
- temporary build helper
- quick test

Tidak cocok jika kamu ingin inspect container setelah exit.

Untuk debugging, jangan pakai `--rm` dulu, karena container akan hilang bersama metadata exit/log state.

---

## 12. `docker run`: Mode Interaktif, Detached, Named, Auto Remove

`docker run` punya banyak mode. Di Part ini kita fokus pada lifecycle consequence.

### 12.1 Foreground mode

```bash
docker run nginx
```

Terminal attach ke proses/container output. Jika kamu tekan `Ctrl+C`, tergantung kondisi, proses bisa menerima signal dan container berhenti.

### 12.2 Detached mode

```bash
docker run -d --name web nginx
```

Container berjalan di background.

Cek:

```bash
docker ps
```

Logs:

```bash
docker logs web
```

Stop:

```bash
docker stop web
```

### 12.3 Interactive terminal

```bash
docker run -it alpine sh
```

Flag:

- `-i`: keep STDIN open
- `-t`: allocate pseudo-TTY

Ketika shell exit, container exit.

### 12.4 Named container

```bash
docker run --name my-api my-api:1.0.0
```

Name memudahkan operasi, tetapi harus unik. Jika container dengan name sama masih ada, command akan gagal.

Common local dev issue:

```text
Conflict. The container name "/my-api" is already in use.
```

Solusi:

```bash
docker rm my-api
```

atau gunakan nama lain.

### 12.5 Auto remove

```bash
docker run --rm my-job:1.0.0
```

Setelah exit, container object dihapus.

Trade-off:

| Benefit | Risk |
|---|---|
| Tidak menumpuk stopped container | Sulit inspect setelah failure |
| Cocok untuk one-off | Tidak cocok untuk forensic debugging |

---

## 13. Exit Code: Bahasa Runtime yang Harus Dibaca

Container exit code berasal dari proses utama container.

Cek:

```bash
docker ps -a
```

Contoh:

```text
Exited (0)
Exited (1)
Exited (137)
Exited (143)
```

Atau lebih detail:

```bash
docker inspect my-api --format '{{.State.ExitCode}}'
```

### 13.1 Exit code 0

```text
Exited (0)
```

Artinya proses selesai normal.

Untuk batch job, ini bagus.

Untuk HTTP service, ini sering berarti aplikasi selesai terlalu cepat.

Contoh penyebab pada Java service:

- menjalankan command mode bukan server mode
- Spring Boot tidak menemukan web starter
- main method selesai
- profile salah sehingga app tidak start web server
- `java -jar` menjalankan tool migrasi lalu selesai

### 13.2 Exit code 1

Generic application error.

Penyebab:

- exception saat startup
- config missing
- DB unavailable saat startup dan app fail-fast
- migration gagal
- permission error
- invalid JVM option
- missing class

Diagnosis utama:

```bash
docker logs my-api
```

### 13.3 Exit code 125, 126, 127

Umumnya terkait Docker/runtime command failure.

| Exit code | Makna umum |
|---|---|
| 125 | Docker daemon/CLI gagal menjalankan container |
| 126 | command ditemukan tetapi tidak bisa dieksekusi |
| 127 | command tidak ditemukan |

Contoh exit 127:

```bash
docker run alpine missing-command
```

### 13.4 Exit code 137

Exit code 137 biasanya berarti proses menerima `SIGKILL`.

```text
128 + 9 = 137
```

`SIGKILL` = 9.

Dalam container, ini sering berkaitan dengan:

- OOMKilled oleh kernel/cgroup
- `docker kill`
- `docker stop` timeout lalu SIGKILL
- host-level intervention

Cek OOMKilled:

```bash
docker inspect my-api --format '{{.State.OOMKilled}}'
```

Jika `true`, container dibunuh karena memory limit.

Untuk Java, ini sangat penting karena container bisa OOM walaupun heap terlihat “aman”. Native memory, metaspace, thread stack, direct buffer, JIT, GC overhead, dan memory mapped file juga berkontribusi.

Detail JVM memory akan dibahas dalam Part 009.

### 13.5 Exit code 143

```text
128 + 15 = 143
```

`SIGTERM` = 15.

Ini sering berarti container menerima graceful stop signal dan proses keluar karena SIGTERM.

Dalam shutdown normal, `Exited (143)` tidak selalu buruk. Tetapi jika terjadi tidak terduga, cari siapa yang mengirim stop.

---

## 14. Restart Policy

Restart policy menentukan apakah Docker akan mencoba menjalankan kembali container setelah keluar.

Dokumentasi Docker menyebut restart policies digunakan untuk mengontrol apakah container otomatis start saat exit atau saat Docker restart, dan Docker merekomendasikan restart policy dibanding menjalankan process manager sendiri untuk memulai container.

Contoh:

```bash
docker run -d \
  --name my-api \
  --restart=unless-stopped \
  my-api:1.0.0
```

Policy umum:

| Policy | Behavior |
|---|---|
| `no` | Tidak restart otomatis |
| `on-failure[:max-retries]` | Restart jika exit code non-zero |
| `always` | Selalu restart jika berhenti, termasuk setelah daemon restart |
| `unless-stopped` | Restart kecuali dihentikan manual |

### 14.1 `no`

Default.

```bash
docker run --restart=no my-api
```

Cocok untuk:

- one-off job
- debugging
- test command
- container yang lifecycle-nya dikontrol sistem lain

### 14.2 `on-failure`

```bash
docker run --restart=on-failure:3 my-api
```

Restart hanya jika exit code non-zero.

Cocok untuk:

- service yang crash karena transient issue
- batch job yang boleh retry terbatas

Namun hati-hati: jika config salah permanen, retry hanya mengulang kegagalan.

### 14.3 `always`

```bash
docker run --restart=always my-api
```

Container akan direstart otomatis.

Masalah: jika kamu stop manual, policy semantics bisa membuat container start lagi ketika daemon restart tergantung situasi. Ini bisa mengejutkan di server kecil.

### 14.4 `unless-stopped`

```bash
docker run --restart=unless-stopped my-api
```

Sering lebih cocok untuk long-running service di VM standalone, karena jika kamu stop manual, Docker tidak menghidupkan lagi setelah daemon restart.

### 14.5 Restart policy bukan health recovery penuh

Restart policy hanya melihat proses exit, bukan semantic readiness aplikasi.

Jika Java app masih running tetapi deadlock, thread pool penuh, DB pool exhausted, atau endpoint selalu 500, restart policy tidak otomatis membantu.

Untuk itu ada healthcheck/orchestrator/monitoring.

---

## 15. Process Status vs Health Status

Ini salah satu distinction paling penting.

```text
running != healthy
exited != unhealthy
healthy != correct business behavior
```

### 15.1 Running status

`running` berarti proses utama masih hidup.

Cek:

```bash
docker ps
```

Contoh:

```text
STATUS
Up 5 minutes
```

Ini hanya menjawab:

> Apakah proses utama container masih berjalan?

### 15.2 Health status

Health status berasal dari `HEALTHCHECK`.

Contoh Dockerfile:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1
```

Atau Compose:

```yaml
services:
  api:
    image: my-api:1.0.0
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 20s
```

Status bisa menjadi:

```text
Up 2 minutes (healthy)
Up 2 minutes (unhealthy)
Up 10 seconds (health: starting)
```

### 15.3 Healthcheck exit code

Dockerfile reference menyatakan healthcheck command exit status menentukan health:

| Exit code | Makna |
|---|---|
| 0 | healthy/success |
| 1 | unhealthy/failure |
| 2 | reserved / jangan digunakan sembarangan |

### 15.4 Healthcheck bukan magic

Healthcheck hanya sebaik command yang kamu tulis.

Bad healthcheck:

```dockerfile
HEALTHCHECK CMD ps aux | grep java
```

Ini hanya membuktikan proses Java ada, bukan aplikasi ready.

Better:

```dockerfile
HEALTHCHECK CMD wget -qO- http://localhost:8080/actuator/health/readiness || exit 1
```

Tetapi hati-hati juga: healthcheck yang terlalu dependency-sensitive bisa menyebabkan false unhealthy saat dependency downstream sedang blip.

Part 015 akan membahas healthcheck secara khusus.

---

## 16. Long-Running Service vs One-Off Job

Container lifecycle harus dibaca berdasarkan jenis workload.

### 16.1 Long-running service

Contoh:

- Spring Boot REST API
- gRPC service
- worker consumer
- scheduler service
- WebSocket service

Expected lifecycle:

```text
created -> running -> running lama -> graceful stop -> exited
```

Jika service exit sendiri setelah 2 detik, itu biasanya failure.

### 16.2 One-off job

Contoh:

- database migration
- batch import
- report generator
- CLI utility
- integration test runner

Expected lifecycle:

```text
created -> running -> exited(0)
```

Untuk job, `Exited (0)` adalah sukses.

### 16.3 Worker service

Worker berada di tengah.

Misalnya Kafka consumer:

- harus long-running
- tetapi mungkin exit jika assignment/config fatal
- perlu graceful shutdown agar offset/ack ditangani benar

Jangan menganggap semua non-HTTP container sebagai batch.

---

## 17. Java-Specific Lifecycle Concerns

Docker lifecycle terlihat sederhana, tetapi Java punya beberapa karakteristik yang membuatnya perlu perhatian khusus.

### 17.1 Startup time

Java service bisa butuh waktu untuk:

- class loading
- dependency injection
- JIT warmup
- DB migration
- connection pool init
- schema validation
- cache loading
- security provider init

Akibat:

- container sudah `running`
- tetapi app belum ready

Karena itu readiness/healthcheck penting.

### 17.2 Shutdown hook

Java mendukung shutdown hook:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("Shutting down...");
}));
```

Tetapi shutdown hook hanya berjalan jika JVM menerima signal yang bisa ditangani, seperti SIGTERM. Tidak berjalan jika SIGKILL.

### 17.3 PID 1 problem

Jika Java process menjadi PID 1, ia punya responsibility signal handling dan child reaping tertentu. Detail PID 1 akan dibahas di Part 010.

Untuk sekarang, prinsipnya:

> Pastikan command container menjalankan Java process dengan exec form atau wrapper script yang melakukan `exec`, agar signal sampai ke JVM.

Good:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Risky:

```dockerfile
ENTRYPOINT java -jar /app/app.jar
```

Risky wrapper:

```sh
#!/bin/sh
java -jar /app/app.jar
```

Better wrapper:

```sh
#!/bin/sh
exec java -jar /app/app.jar
```

### 17.4 JVM memory and exit lifecycle

Java process bisa mati karena:

- Java heap OOM: biasanya ada stacktrace `java.lang.OutOfMemoryError`
- container OOMKilled: proses dibunuh dari luar, bisa tidak ada stacktrace
- native memory exhaustion
- metaspace issue
- thread creation failure

Lifecycle symptom bisa sama-sama `Exited`, tetapi root cause berbeda.

---

## 18. Diagnostic Workflow: Container Tidak Berjalan

Saat container tidak berjalan, jangan langsung rebuild image atau mengganti command random. Gunakan workflow.

### 18.1 Langkah 1 — Lihat semua container

```bash
docker ps -a
```

Perhatikan:

- status
- exit code
- created time
- command
- name

### 18.2 Langkah 2 — Lihat logs

```bash
docker logs my-api
```

Jika restart loop:

```bash
docker logs --tail=200 my-api
```

### 18.3 Langkah 3 — Inspect state

```bash
docker inspect my-api --format '{{json .State}}'
```

Atau lebih readable:

```bash
docker inspect my-api
```

Cari:

- `Status`
- `Running`
- `Paused`
- `Restarting`
- `OOMKilled`
- `Dead`
- `Pid`
- `ExitCode`
- `Error`
- `StartedAt`
- `FinishedAt`
- `Health`

### 18.4 Langkah 4 — Cek config efektif

```bash
docker inspect my-api --format '{{json .Config}}'
```

Cari:

- `Entrypoint`
- `Cmd`
- `Env`
- `WorkingDir`
- `User`
- `Healthcheck`

Banyak issue berasal dari command/env yang berbeda dari asumsi.

### 18.5 Langkah 5 — Reproduce dengan shell/debug image

Jika image punya shell:

```bash
docker run --rm -it --entrypoint sh my-api:1.0.0
```

Jika tidak punya shell, gunakan debug strategy yang akan dibahas di Part 022.

---

## 19. Failure Mode Catalogue pada Lifecycle

### 19.1 Container langsung exit 0

Gejala:

```text
Exited (0) 2 seconds ago
```

Kemungkinan:

- command memang selesai
- image menjalankan CLI, bukan server
- Java main method selesai
- Spring Boot tidak start web server
- salah profile
- entrypoint override salah

Diagnosis:

```bash
docker logs container

docker inspect container --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
```

Pertanyaan:

> Apakah workload ini seharusnya long-running atau one-off?

### 19.2 Container exit 1

Gejala:

```text
Exited (1)
```

Kemungkinan:

- exception startup
- config missing
- dependency unavailable
- permission denied
- migration gagal
- invalid JVM flag

Diagnosis:

```bash
docker logs container
```

Untuk Java, cari stacktrace paling awal, bukan hanya error terakhir.

### 19.3 Container restart terus

Gejala:

```text
Restarting (1) 5 seconds ago
```

Kemungkinan:

- restart policy aktif
- app crash saat startup
- dependency gagal
- config invalid
- health management external me-restart container

Diagnosis:

```bash
docker ps -a

docker logs --tail=200 container

docker inspect container --format '{{.HostConfig.RestartPolicy.Name}} {{.RestartCount}}'
```

Mitigasi debug:

```bash
docker update --restart=no container

docker stop container

docker start container
```

Atau recreate tanpa restart policy.

### 19.4 Container running tapi app tidak bisa diakses

Gejala:

```text
Up 5 minutes
```

Tetapi:

```bash
curl localhost:8080
# connection refused / timeout
```

Kemungkinan:

- port tidak dipublish
- app bind ke `127.0.0.1` di dalam container
- host port salah
- app belum ready
- firewall
- wrong protocol
- app listen di port lain

Diagnosis awal:

```bash
docker port container

docker logs container

docker inspect container --format '{{json .NetworkSettings.Ports}}'
```

Detail network ada di Part 012.

### 19.5 Container exit 137

Gejala:

```text
Exited (137)
```

Kemungkinan:

- OOMKilled
- killed manually
- stop timeout exceeded

Diagnosis:

```bash
docker inspect container --format '{{.State.OOMKilled}} {{.State.ExitCode}} {{.State.Error}}'
```

Jika OOMKilled true:

- cek memory limit
- cek heap config
- cek native memory
- cek thread count
- cek direct buffer
- cek container stats

### 19.6 Container tidak bisa dihapus

Gejala:

```text
Error response from daemon: You cannot remove a running container
```

Solusi:

```bash
docker stop container

docker rm container
```

Atau paksa:

```bash
docker rm -f container
```

Gunakan `-f` dengan sadar karena graceful shutdown bisa dilewati/terpotong.

### 19.7 Name conflict

Gejala:

```text
Conflict. The container name "/my-api" is already in use
```

Penyebab:

- container lama masih ada, mungkin exited

Diagnosis:

```bash
docker ps -a --filter name=my-api
```

Solusi:

```bash
docker rm my-api
```

atau:

```bash
docker run --name my-api-2 ...
```

### 19.8 Container created tapi tidak running

Gejala:

```text
Created
```

Penyebab:

- kamu pakai `docker create`, bukan `docker run`
- tool membuat container tapi gagal start

Solusi:

```bash
docker start container
```

Jika langsung exited:

```bash
docker logs container
```

---

## 20. State, Config, dan Mutability

Container object punya mutable dan immutable aspects.

### 20.1 Yang bisa berubah setelah create

Beberapa hal bisa berubah:

- restart policy via `docker update`
- resource limit tertentu via `docker update`
- container bisa start/stop/restart
- writable filesystem berubah saat proses menulis file
- network attachment dalam beberapa kasus bisa diubah

### 20.2 Yang umumnya create-time

Beberapa hal tidak diubah dengan `docker start`:

- initial image
- port publishing
- volume mount definition
- env vars
- entrypoint/cmd effective config
- container name, kecuali rename eksplisit

Prinsip production:

> Jika runtime contract berubah, recreate container. Jangan memperlakukan container sebagai mutable server.

---

## 21. Disposable Container Principle

Container harus dianggap disposable.

Artinya:

- container boleh dihentikan
- container boleh dihapus
- container boleh dibuat ulang dari image dan config
- state penting tidak boleh hanya tersimpan di writable layer container

### 21.1 Apa yang boleh ephemeral?

- temp files
- cache yang bisa regenerate
- PID file
- downloaded transient artifact
- test output sementara

### 21.2 Apa yang tidak boleh hanya di container writable layer?

- database data
- uploaded user file
- generated invoice final
- audit evidence
- cryptographic key
- business document
- migration state penting

Untuk data penting, gunakan:

- external database
- object storage
- named volume dengan backup
- bind mount yang dikelola
- persistent storage di orchestrator

Detail volume di Part 011.

---

## 22. Lifecycle Contract untuk Java Service

Sebuah Java service production-grade dalam Docker harus punya lifecycle contract eksplisit.

### 22.1 Startup contract

Aplikasi harus jelas:

- command apa yang menjalankan app
- config wajib apa yang divalidasi di startup
- dependency mana yang wajib saat startup
- apakah migration dijalankan otomatis
- kapan app dianggap ready
- apa log startup success marker

Contoh startup log yang baik:

```text
Starting service order-api version=1.4.2 commit=abc123 profile=prod
HTTP server listening on port 8080
Readiness state: ACCEPTING_TRAFFIC
```

### 22.2 Runtime contract

Harus jelas:

- port yang listen
- endpoint health/readiness
- stdout/stderr logging
- resource expectation
- file path yang writable
- user permission

### 22.3 Shutdown contract

Harus jelas:

- menerima SIGTERM
- stop accepting new requests
- complete in-flight work
- close consumers/producers
- flush logs/metrics
- exit sebelum Docker timeout

### 22.4 Failure contract

Harus jelas:

- kapan fail-fast
- kapan retry internal
- kapan exit non-zero
- kapan remain running but unhealthy
- kapan expose degraded readiness

Ini maturity yang membedakan “Dockerized app” dari “production-friendly containerized service”.

---

## 23. Practical Lab: Melihat Lifecycle Secara Langsung

Bagian ini bisa kamu jalankan lokal jika Docker tersedia.

### 23.1 Created state

```bash
docker create --name lifecycle-demo alpine sleep 60

docker ps -a --filter name=lifecycle-demo
```

Expected:

```text
Created
```

Start:

```bash
docker start lifecycle-demo

docker ps --filter name=lifecycle-demo
```

Stop:

```bash
docker stop lifecycle-demo

docker ps -a --filter name=lifecycle-demo
```

Remove:

```bash
docker rm lifecycle-demo
```

### 23.2 Exited 0

```bash
docker run --name exit-zero alpine sh -c 'echo done'

docker ps -a --filter name=exit-zero

docker rm exit-zero
```

### 23.3 Exited 1

```bash
docker run --name exit-one alpine sh -c 'echo failing; exit 1'

docker ps -a --filter name=exit-one

docker logs exit-one

docker rm exit-one
```

### 23.4 Exit 127

```bash
docker run --name exit-127 alpine missing-command

docker ps -a --filter name=exit-127

docker logs exit-127

docker rm exit-127
```

### 23.5 Restart policy demo

```bash
docker run -d \
  --name restart-demo \
  --restart=on-failure:3 \
  alpine sh -c 'echo crash; exit 1'

sleep 5

docker ps -a --filter name=restart-demo

docker inspect restart-demo --format 'RestartCount={{.RestartCount}} ExitCode={{.State.ExitCode}} Status={{.State.Status}}'

docker logs restart-demo

docker rm restart-demo
```

### 23.6 Stop signal demo

```bash
docker run -d --name signal-demo alpine sh -c 'trap "echo got TERM; exit 0" TERM; while true; do sleep 1; done'

docker stop signal-demo

docker logs signal-demo

docker rm signal-demo
```

Expected log:

```text
got TERM
```

Ini menunjukkan bahwa `docker stop` memberi kesempatan graceful shutdown.

---

## 24. Common Misconceptions

### Misconception 1: “Container itu running kalau image ada”

Salah. Image bisa ada tanpa container. Container bisa ada tanpa proses running.

### Misconception 2: “Exited berarti Docker error”

Tidak selalu. Exited bisa berarti proses selesai normal.

### Misconception 3: “Restart memperbarui image”

Tidak. Restart menjalankan ulang container yang sama.

### Misconception 4: “Healthcheck menentukan apakah container running”

Tidak. Healthcheck menentukan health status, bukan process existence.

### Misconception 5: “`docker stop` langsung mematikan paksa”

Tidak. `docker stop` memberi signal graceful terlebih dahulu.

### Misconception 6: “Jika container dihapus, semua data pasti hilang”

Tidak. Named volume bisa tetap ada.

### Misconception 7: “Kalau `docker ps` kosong berarti tidak ada container”

Tidak. `docker ps` default hanya running container. Gunakan:

```bash
docker ps -a
```

---

## 25. Anti-Patterns

### 25.1 Menggunakan container sebagai server mutable

Contoh buruk:

```bash
docker exec -it my-api sh
apk add vim
edit config manually
restart app inside container
```

Masalah:

- perubahan tidak reproducible
- hilang saat recreate
- tidak tercatat dalam image/config
- sulit diaudit

Lebih baik:

- ubah Dockerfile/config source
- rebuild image
- recreate container

### 25.2 Menjalankan process manager penuh di satu container

Contoh:

- supervisord menjalankan app + cron + nginx + worker + sshd

Container idealnya menjalankan satu process tree utama dengan lifecycle jelas. Bukan berarti tidak boleh ada child process sama sekali, tetapi process utama harus menjadi lifecycle owner yang jelas.

### 25.3 Mengandalkan restart policy untuk semua failure

Restart policy tidak memperbaiki:

- config salah
- schema incompatible
- dependency permanen down
- memory leak fundamental
- deadlock tanpa process exit
- request-level failure

Restart policy adalah recovery primitive sederhana, bukan reliability architecture.

### 25.4 Pakai `--rm` saat butuh forensic

Jika container gagal dan langsung dihapus, kamu kehilangan metadata inspect.

Saat debugging, gunakan container tanpa `--rm`.

### 25.5 Tidak membaca exit code

Exit code adalah clue paling awal. Jangan langsung membaca 1000 baris log tanpa melihat:

```bash
docker inspect container --format '{{.State.ExitCode}} {{.State.OOMKilled}}'
```

---

## 26. Production Heuristics

Untuk long-running Java service:

1. Gunakan exec form `ENTRYPOINT`.
2. Pastikan JVM menerima SIGTERM.
3. Set graceful shutdown app lebih kecil dari Docker stop timeout.
4. Jangan simpan state penting di writable layer container.
5. Gunakan restart policy secara sadar jika menjalankan di single VM.
6. Jangan bergantung pada restart policy jika sudah dikelola orchestrator lain.
7. Pisahkan process status dan health status.
8. Log ke stdout/stderr.
9. Validasi config wajib saat startup.
10. Buat startup failure eksplisit dengan exit non-zero.
11. Gunakan healthcheck yang relevan tapi tidak terlalu agresif.
12. Untuk deployment image baru, recreate container, bukan restart container lama.
13. Jangan pakai `latest` untuk production lifecycle.
14. Jangan gunakan `--rm` untuk service yang butuh investigasi pasca-failure.

---

## 27. Decision Table

### 27.1 Mau menjalankan command sekali lalu hilang

Gunakan:

```bash
docker run --rm image command
```

Cocok untuk:

- utility
- test cepat
- disposable shell

### 27.2 Mau menjalankan service background

Gunakan:

```bash
docker run -d --name service image
```

Tambahkan:

```bash
--restart=unless-stopped
```

jika memang single-host service perlu auto-start.

### 27.3 Mau inspect setelah gagal

Jangan gunakan `--rm`.

Gunakan:

```bash
docker ps -a

docker logs container

docker inspect container
```

### 27.4 Mau update image service

Gunakan recreate:

```bash
docker stop service

docker rm service

docker run -d --name service new-image
```

Dalam Compose:

```bash
docker compose up -d --force-recreate
```

atau setelah pull/build sesuai kebutuhan.

### 27.5 Mau mengubah env/port/mount

Recreate container.

---

## 28. Mental Model Ringkas

Ingat model ini:

```text
Image adalah template immutable.
Container adalah object runtime yang dibuat dari image.
Running container berarti proses utama masih hidup.
Exited container berarti proses utama selesai.
Restart policy menentukan apakah Docker mencoba menjalankan proses lagi.
Healthcheck menentukan interpretasi semantic health, bukan existence proses.
Remove menghapus container object, bukan selalu persistent volume.
```

Dan untuk Java:

```text
Docker lifecycle harus selaras dengan JVM lifecycle:
startup readiness,
runtime process ownership,
SIGTERM handling,
graceful shutdown,
resource exhaustion,
exit code clarity.
```

---

## 29. Checklist Debugging Cepat

Saat container bermasalah:

```bash
# 1. Lihat semua container, termasuk exited
docker ps -a

# 2. Baca logs
docker logs <container>

# 3. Baca state ringkas
docker inspect <container> --format 'Status={{.State.Status}} ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}} Restarting={{.State.Restarting}}'

# 4. Baca restart count/policy
docker inspect <container> --format 'RestartCount={{.RestartCount}} RestartPolicy={{.HostConfig.RestartPolicy.Name}}'

# 5. Baca entrypoint/cmd/env
docker inspect <container> --format 'Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}}'

# 6. Jika network issue
docker port <container>

# 7. Jika health issue
docker inspect <container> --format '{{json .State.Health}}'
```

Pertanyaan diagnosis:

1. Apakah container gagal dibuat atau gagal start?
2. Apakah proses exit normal atau error?
3. Apakah exit code menunjukkan signal?
4. Apakah OOMKilled true?
5. Apakah restart policy menyembunyikan crash loop?
6. Apakah app running tetapi belum ready?
7. Apakah healthcheck salah atau app benar-benar unhealthy?
8. Apakah kita sedang melihat container lama dari image lama?
9. Apakah data/config ada di volume lama?
10. Apakah Java process menerima SIGTERM dengan benar?

---

## 30. What Top Engineers Internalize

Engineer yang kuat dengan Docker tidak sekadar bertanya:

> “Kenapa Docker saya tidak jalan?”

Mereka memecahnya menjadi:

- Apakah image resolve/pull berhasil?
- Apakah container object berhasil dibuat?
- Apakah start process berhasil?
- Apakah proses utama exit?
- Exit code berapa?
- Apakah exit karena signal?
- Apakah OOMKilled?
- Apakah restart policy aktif?
- Apakah container running tetapi unhealthy?
- Apakah runtime config sesuai asumsi?
- Apakah container lama masih memakai image/config lama?
- Apakah persistent volume membawa state lama?

Itulah perbedaan antara command-level Docker usage dan lifecycle-level Docker mastery.

---

## 31. Latihan Berpikir

Jawab tanpa menjalankan command dulu.

### Case 1

Kamu menjalankan:

```bash
docker run --name api my-api:1.0.0
```

Container langsung `Exited (0)`.

Pertanyaan:

1. Apakah Docker gagal?
2. Apakah ini selalu problem?
3. Apa yang kamu cek pertama?

Jawaban yang diharapkan:

1. Belum tentu. Proses bisa selesai normal.
2. Jika workload batch, mungkin sukses. Jika HTTP service, kemungkinan problem.
3. `docker logs api`, lalu inspect `Entrypoint`/`Cmd`.

### Case 2

Container `Up 5 minutes`, tetapi `curl localhost:8080` gagal.

Pertanyaan:

1. Apakah container pasti gagal?
2. Apa kemungkinan utama?

Jawaban:

1. Tidak. Process running.
2. Port belum dipublish, app bind ke wrong interface, wrong port, app belum ready, atau network path salah.

### Case 3

Container `Exited (137)` dan log terakhir normal.

Pertanyaan:

1. Apa dugaan awal?
2. Command apa yang dicek?

Jawaban:

1. OOMKilled atau SIGKILL.
2. `docker inspect container --format '{{.State.OOMKilled}} {{.State.ExitCode}}'`.

### Case 4

Kamu rebuild `my-api:latest`, lalu `docker restart my-api`, tetapi behavior tidak berubah.

Pertanyaan:

1. Kenapa?
2. Apa yang seharusnya dilakukan?

Jawaban:

1. Restart tidak recreate container dari image baru.
2. Stop/remove/create ulang container atau gunakan compose recreate.

---

## 32. Ringkasan Part 004

Di part ini kita mempelajari:

- `docker run` adalah gabungan resolve/pull/create/start.
- `docker create` membuat container object tanpa menjalankan proses.
- `docker start` menjalankan container object yang sudah ada.
- `docker stop` mengirim signal graceful lalu kill jika timeout.
- `docker restart` tidak mengambil image baru; ia menjalankan ulang container yang sama.
- `docker rm` menghapus container object, tetapi tidak selalu menghapus named volume.
- Container state harus dibaca sebagai lifecycle state machine.
- Exit code adalah clue penting.
- Restart policy berguna, tetapi bukan pengganti health management.
- Running status berbeda dari health status.
- Java service harus menyelaraskan startup, readiness, SIGTERM, graceful shutdown, dan resource behavior dengan Docker lifecycle.

---

## 33. Status Seri

Part ini selesai:

```text
learn-docker-mastery-for-java-engineers-part-004.md
```

Status seri:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 belum dibuat
...
Part 031 belum dibuat
```

Seri **belum selesai**. Masih ada Part 005 sampai Part 031.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-005.md
```

Judul:

```text
Docker CLI Fluency: From Command User to Runtime Inspector
```

Fokus berikutnya:

- `docker ps`
- `docker inspect`
- `docker logs`
- `docker exec`
- `docker cp`
- `docker stats`
- `docker events`
- `docker top`
- `docker diff`
- `docker port`
- membaca Docker CLI sebagai runtime observability interface, bukan sekadar daftar command

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-005.md">Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector ➡️</a>
</div>
