# learn-docker-mastery-for-java-engineers-part-029.md

# Part 029 — Failure Mode Catalogue: Docker Problems Senior Engineers Must Recognize

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `029 / 031`  
> Fokus: katalog failure mode Docker, diagnostic decision tree, root cause classification, dan playbook investigasi untuk Java service containerized.

---

## 0. Tujuan Bagian Ini

Bagian ini adalah **peta insiden Docker**.

Di part sebelumnya kita sudah membangun mental model tentang:

- container sebagai proses dengan boundary
- image sebagai artifact ber-layer
- Dockerfile dan build cache
- Java runtime dalam container
- networking Docker
- volumes dan filesystem
- Compose
- healthcheck
- secrets/config
- security
- supply chain
- base image
- performance
- logging
- debugging runtime
- testing
- CI/CD
- multi-platform
- Docker Desktop vs Linux server
- local developer platform
- production tanpa Kubernetes

Part ini mengikat semuanya menjadi satu kemampuan penting:

> **mampu melihat gejala Docker, mengklasifikasikan fase kegagalannya, lalu menurunkan root cause dengan urutan investigasi yang benar.**

Engineer yang kuat dengan Docker tidak langsung menebak:

> “Mungkin port-nya salah.”  
> “Mungkin image-nya rusak.”  
> “Mungkin memorinya kurang.”  
> “Coba rebuild.”  
> “Coba prune.”  
> “Coba restart Docker.”

Engineer yang kuat bertanya:

1. Gagal di fase apa?
2. Apakah container pernah tercipta?
3. Apakah process utama pernah start?
4. Apakah process mati sendiri atau dibunuh?
5. Apakah app bind ke interface yang benar?
6. Apakah problem terjadi di build, pull, create, start, runtime, network, storage, resource, atau policy?
7. Evidence mana yang membedakan satu kemungkinan dari kemungkinan lain?

---

## 1. Prinsip Utama: Jangan Debug Docker sebagai “Satu Kotak Besar”

Docker failure sering terlihat sama di permukaan:

```bash
container exited
connection refused
permission denied
no space left on device
image pull failed
healthcheck unhealthy
```

Tetapi root cause-nya bisa sangat berbeda.

Contoh:

```text
connection refused
```

Bisa berarti:

- container belum running
- app crash
- app belum ready
- app bind ke `127.0.0.1`
- port host tidak dipublish
- port container salah
- service name salah
- network salah
- firewall host memblokir
- client pakai `localhost` dari container lain
- Java app listening di management port, bukan server port
- process listen IPv6 only
- TLS handshake gagal tetapi terlihat seperti refusal dari client wrapper

Karena itu, gunakan klasifikasi fase.

---

## 2. Docker Failure Taxonomy

Bayangkan lifecycle Docker sebagai pipeline:

```text
Source Code
   ↓
Dockerfile / Build Context
   ↓
docker build
   ↓
Image
   ↓
Registry Push/Pull
   ↓
Container Create
   ↓
Container Start
   ↓
Process Runtime
   ↓
Health / Network / Storage / Resource Behavior
   ↓
Stop / Restart / Remove
```

Setiap fase punya jenis failure berbeda.

| Fase | Pertanyaan Kunci | Contoh Gejala |
|---|---|---|
| Build | Apakah image berhasil dibuat? | `failed to solve`, cache miss, dependency gagal |
| Pull | Apakah image bisa diambil? | `manifest not found`, auth denied |
| Create | Apakah container object berhasil dibuat? | mount error, invalid env, port allocated |
| Start | Apakah process utama bisa dijalankan? | exit 126/127, permission denied, exec format |
| Runtime | Apakah process hidup stabil? | crash loop, exit 1, exit 137 |
| Health | Apakah app siap melayani? | `unhealthy`, timeout, false negative |
| Network | Apakah endpoint reachable? | connection refused, DNS fail |
| Storage | Apakah filesystem/volume benar? | no space, permission, stale data |
| Resource | Apakah CPU/memory cukup? | OOMKilled, throttling, slow startup |
| Security | Apakah policy menolak operasi? | seccomp, AppArmor, no-new-privileges |
| Host/Daemon | Apakah Docker sendiri sehat? | daemon unresponsive, corrupted state |

Mental model:

> **Jangan mulai dari command fix. Mulai dari fase failure.**

---

## 3. Golden Rule Investigasi Docker

Setiap incident Docker harus dimulai dengan lima fakta dasar:

```bash
docker ps -a
docker inspect <container>
docker logs <container>
docker events --since 10m
docker system df
```

Untuk Java service, tambahkan:

```bash
docker stats <container>
docker exec <container> ps -ef
docker exec <container> printenv
docker exec <container> sh -c 'ls -lah /app /tmp'
```

Jika image minimal tidak punya shell, gunakan pendekatan debug container / `docker debug` / image diagnostic terpisah sesuai lingkungan.

Jangan langsung `docker rm`, `docker compose down -v`, atau `docker system prune -a` sebelum evidence penting disimpan.

---

## 4. Exit Code: Sinyal Pertama, Bukan Jawaban Akhir

Exit code adalah clue.

Bukan diagnosis final.

### 4.1 Exit Code 0

```text
Exited (0)
```

Artinya process utama selesai dengan sukses.

Untuk service long-running, ini biasanya masalah.

Kemungkinan:

- command salah
- app hanya menjalankan migration lalu selesai
- `CMD` override menjadi command short-lived
- script wrapper tidak menjalankan Java process
- shell script tidak pakai `exec`
- Spring Boot app keluar karena tidak ada web server dependency
- app mode batch, bukan server
- profile salah

Diagnosis:

```bash
docker inspect <container> --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker logs <container>
```

Contoh masalah:

```Dockerfile
CMD ["java", "-jar", "app.jar", "--spring.main.web-application-type=none"]
```

atau Compose override:

```yaml
services:
  api:
    command: ["echo", "hello"]
```

Container bekerja sesuai kontrak, tetapi kontraknya salah.

---

### 4.2 Exit Code 1

Exit code 1 adalah generic application failure.

Kemungkinan:

- exception startup Java
- missing env
- config invalid
- DB unavailable
- migration gagal
- file permission
- TLS truststore error
- classpath missing
- incompatible Java version
- wrong Spring profile
- app explicitly `System.exit(1)`

Diagnosis:

```bash
docker logs <container>
docker inspect <container> --format '{{.State.Error}}'
docker inspect <container> --format '{{.State.ExitCode}}'
```

Untuk Java, logs biasanya lebih penting daripada Docker inspect.

Cari:

```text
Caused by:
Exception in thread "main"
Application run failed
BeanCreationException
IllegalStateException
AccessDeniedException
SSLHandshakeException
OutOfMemoryError
```

---

### 4.3 Exit Code 125

Docker CLI biasanya memakai exit code 125 ketika `docker run` gagal sebelum container process benar-benar berjalan.

Contoh root cause:

- invalid flag
- port already allocated
- invalid mount
- image tidak ditemukan
- name conflict
- daemon error

Diagnosis:

```bash
docker run ...
echo $?
docker ps -a
```

Jika container tidak muncul di `docker ps -a`, kemungkinan gagal sebelum container dibuat/started.

Contoh:

```bash
docker run --name api -p 8080:8080 my-api
```

Error:

```text
Conflict. The container name "/api" is already in use
```

atau:

```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

---

### 4.4 Exit Code 126

Exit code 126 berarti command ditemukan tetapi tidak bisa dieksekusi.

Kemungkinan:

- file tidak executable
- command menunjuk directory
- permission denied
- filesystem mounted `noexec`
- entrypoint script tanpa execute bit
- user non-root tidak punya permission

Contoh:

```Dockerfile
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

Tetapi lupa:

```Dockerfile
RUN chmod +x /entrypoint.sh
```

Diagnosis:

```bash
docker run --rm --entrypoint ls image -lah /entrypoint.sh
docker run --rm --entrypoint stat image /entrypoint.sh
```

Fix:

```Dockerfile
COPY --chmod=755 entrypoint.sh /entrypoint.sh
```

atau:

```Dockerfile
RUN chmod 755 /entrypoint.sh
```

Lebih baik lagi, hindari script wrapper jika tidak perlu.

---

### 4.5 Exit Code 127

Exit code 127 berarti command tidak ditemukan.

Kemungkinan:

- typo command
- shell tidak ada
- `java` tidak ada di runtime image
- path salah
- script pakai `bash` tetapi image hanya punya `sh`
- distroless image tidak punya shell
- `ENTRYPOINT ["java -jar app.jar"]` salah karena exec form mencari executable literal bernama `java -jar app.jar`

Contoh salah:

```Dockerfile
ENTRYPOINT ["java -jar app.jar"]
```

Benar:

```Dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Diagnosis:

```bash
docker inspect <container> --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker run --rm --entrypoint which image java
```

Jika image distroless, `which` pun tidak ada. Gunakan base debug image atau periksa Dockerfile/build artifact.

---

### 4.6 Exit Code 137

Exit code 137 biasanya berarti process menerima `SIGKILL`.

Karena `128 + 9 = 137`.

Penyebab umum:

- OOM kill
- manual `docker kill`
- host OOM killer
- container melebihi memory limit
- Docker/daemon/host mematikan process
- shutdown paksa setelah grace period habis

Diagnosis:

```bash
docker inspect <container> --format '{{.State.OOMKilled}} {{.State.ExitCode}} {{.State.Error}}'
docker events --since 30m
docker logs <container> --tail 200
```

Jika:

```text
OOMKilled=true
ExitCode=137
```

maka container dibunuh karena memory limit.

Tetapi:

```text
OOMKilled=false
ExitCode=137
```

mungkin process dibunuh oleh `docker kill`, host event, supervisor, atau stop grace timeout.

Untuk Java:

- cek heap limit
- cek native memory
- cek metaspace
- cek direct buffer
- cek thread count
- cek container memory limit
- cek `MaxRAMPercentage`
- cek apakah heap dump mencoba ditulis ke filesystem yang penuh

Contoh investigasi:

```bash
docker inspect api --format '{{json .HostConfig.Memory}}'
docker stats api
docker logs api | grep -i -E 'outofmemory|killed|heap|metaspace'
```

Jangan menyimpulkan semua 137 adalah JVM heap OOM.

---

### 4.7 Exit Code 143

Exit code 143 biasanya berarti process menerima `SIGTERM`.

Karena `128 + 15 = 143`.

Ini sering normal saat:

- `docker stop`
- Compose down
- deployment restart
- host shutdown
- restart policy recycle

Masalah muncul jika graceful shutdown gagal.

Diagnosis:

```bash
docker logs <container> --tail 200
docker events --since 10m
```

Untuk Spring Boot, cari apakah shutdown hook jalan:

```text
Graceful shutdown complete
```

Jika tidak, periksa:

- shell-form entrypoint
- wrapper script tidak `exec`
- PID 1 tidak forward signal
- app butuh waktu lebih lama dari stop timeout
- thread non-daemon menggantung
- request long-running tidak diberi deadline

---

## 5. Failure Mode: Build Failure

### 5.1 Gejala

```text
failed to solve
failed to compute cache key
COPY failed
no such file or directory
permission denied
network timeout
checksum mismatch
```

### 5.2 Pertanyaan Diagnosis

1. Apakah file ada di build context?
2. Apakah `.dockerignore` menghapus file yang dibutuhkan?
3. Apakah path relatif benar?
4. Apakah build pakai BuildKit?
5. Apakah cache membuat hasil terlihat aneh?
6. Apakah dependency remote sedang tidak tersedia?
7. Apakah secret dipakai sebagai secret mount, bukan ARG?
8. Apakah build architecture benar?

### 5.3 Common Root Cause

#### `.dockerignore` terlalu agresif

```dockerignore
target
```

Lalu Dockerfile:

```Dockerfile
COPY target/app.jar /app/app.jar
```

Build gagal karena `target` tidak dikirim ke build context.

#### Build context salah

Command:

```bash
docker build -f docker/Dockerfile docker/
```

Padahal source ada di root project.

Fix:

```bash
docker build -f docker/Dockerfile .
```

#### COPY path salah

```Dockerfile
COPY ./app.jar /app/app.jar
```

Tetapi file sebenarnya di:

```text
target/app.jar
```

#### Cache menutupi masalah

Gunakan:

```bash
docker build --no-cache .
```

tetapi jangan jadikan `--no-cache` sebagai fix permanen. Itu hanya alat diagnosis.

---

## 6. Failure Mode: Pull Failure

### 6.1 Gejala

```text
manifest unknown
pull access denied
repository does not exist
no matching manifest for linux/arm64
unauthorized
TLS handshake timeout
x509 certificate signed by unknown authority
```

### 6.2 Diagnosis

```bash
docker pull image:tag
docker manifest inspect image:tag
docker info
docker login <registry>
```

### 6.3 Root Cause Umum

#### Tag tidak ada

```bash
docker pull my-registry/api:prod
```

Padahal tag yang dipush:

```text
production
```

#### Registry auth salah

CI runner belum login:

```bash
docker login registry.example.com
```

#### Platform tidak tersedia

Laptop Apple Silicon mencoba pull `linux/arm64`, tetapi image hanya punya `linux/amd64`.

Fix sementara:

```bash
docker run --platform linux/amd64 image
```

Fix benar:

- publish multi-platform image
- pastikan base image tersedia untuk target architecture
- audit native dependencies

#### Corporate proxy / custom CA

Gejala:

```text
x509: certificate signed by unknown authority
```

Root cause:

- Docker daemon tidak trust corporate CA
- app container tidak trust corporate CA
- host truststore dan container truststore berbeda

Bedakan pull-time TLS problem dan app runtime TLS problem.

---

## 7. Failure Mode: Container Create Failure

Container create gagal sebelum process start.

### 7.1 Gejala

```text
invalid mount config
port is already allocated
Conflict. container name already in use
invalid reference format
invalid env file
```

### 7.2 Diagnosis

```bash
docker ps -a
docker port <container>
docker inspect <container>
docker network ls
docker volume ls
```

Jika container tidak ada di `ps -a`, create mungkin gagal total.

### 7.3 Root Cause Umum

#### Nama container bentrok

```bash
docker run --name api ...
```

Tetapi container lama masih ada.

Fix:

```bash
docker rm api
```

atau gunakan Compose service name tanpa hardcoded `container_name`.

#### Port host bentrok

```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

Diagnosis:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
lsof -i :8080
```

Fix:

- ganti host port
- stop process pemilik port
- jangan publish port yang tidak perlu
- untuk Compose parallel project, gunakan project name berbeda dan dynamic port jika perlu

#### Mount path invalid

Bind mount host path tidak ada atau permission salah.

```yaml
volumes:
  - ./config/application.yml:/app/config/application.yml
```

Jika working directory berbeda, path bisa salah.

Diagnosis:

```bash
pwd
ls -lah ./config/application.yml
docker compose config
```

---

## 8. Failure Mode: Container Start Failure

Container object berhasil dibuat, tetapi process utama gagal start.

### 8.1 Gejala

```text
permission denied
exec format error
no such file or directory
standard_init_linux.go
```

### 8.2 Diagnosis

```bash
docker inspect <container> --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker logs <container>
docker inspect <container> --format '{{.State.Error}}'
```

### 8.3 Root Cause Umum

#### Entrypoint script CRLF

Script dibuat di Windows:

```text
#!/bin/sh\r
```

Error bisa terlihat seperti:

```text
no such file or directory
```

Padahal file ada.

Fix:

```bash
dos2unix entrypoint.sh
```

atau atur `.gitattributes`:

```gitattributes
*.sh text eol=lf
```

#### Script tidak executable

Lihat exit 126.

#### Wrong architecture

```text
exec format error
```

Biasanya image/ binary architecture tidak cocok.

Diagnosis:

```bash
docker image inspect image --format '{{json .Architecture}}'
docker version
uname -m
```

Fix:

```bash
docker buildx build --platform linux/amd64,linux/arm64 ...
```

#### Runtime image tidak punya Java

Multi-stage build salah:

```Dockerfile
FROM debian:bookworm-slim
COPY --from=build /app/target/app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Tetapi `debian:bookworm-slim` tidak punya `java`.

Fix: gunakan runtime Java image.

---

## 9. Failure Mode: Runtime Crash Loop

### 9.1 Gejala

```bash
docker ps
# container restarting
```

atau Compose:

```text
Restarting (1) 3 seconds ago
```

### 9.2 Diagnosis

```bash
docker ps -a
docker logs --tail 200 <container>
docker inspect <container> --format '{{.RestartCount}} {{.State.ExitCode}} {{.State.OOMKilled}}'
docker events --since 30m
```

### 9.3 Root Cause Umum

- application startup exception
- missing config
- DB not reachable
- migration gagal
- secret file missing
- permission denied
- wrong command
- OOMKilled
- healthcheck coupled to restart supervisor outside Docker
- restart policy menyembunyikan crash

### 9.4 Anti-pattern

Melihat container “running” lalu menganggap sehat.

Restart loop sering terlihat sebentar sebagai running.

Gunakan:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

Cari:

```text
Restarting
Up 3 seconds
```

---

## 10. Failure Mode: App Running But Not Reachable

Ini failure paling umum di Docker.

### 10.1 Diagnostic Tree

Pertanyaan:

1. Container running?
2. Process listening?
3. Listening di port mana?
4. Bind ke interface apa?
5. Port dipublish ke host?
6. Client berasal dari host atau container lain?
7. Network sama?
8. DNS resolve?
9. Firewall/NAT mengizinkan?
10. Protocol benar?

### 10.2 Step-by-step

```bash
docker ps
docker logs api
docker port api
docker inspect api --format '{{json .NetworkSettings.Ports}}'
```

Di dalam container jika tooling tersedia:

```bash
ss -lntp
```

atau:

```bash
netstat -lntp
```

Test dari host:

```bash
curl -v http://localhost:8080/actuator/health
```

Test dari container lain di network sama:

```bash
docker run --rm --network <network> curlimages/curl:latest curl -v http://api:8080
```

### 10.3 Common Root Cause

#### App bind ke localhost

Java app bind ke:

```text
127.0.0.1:8080
```

Di dalam container, `127.0.0.1` berarti loopback container sendiri, bukan host.

Dari host via published port, request masuk ke container IP, tetapi app hanya listen loopback.

Fix:

```properties
server.address=0.0.0.0
```

atau jangan set `server.address` sehingga framework bind ke all interfaces jika default-nya begitu.

#### `EXPOSE` dianggap publish port

Dockerfile:

```Dockerfile
EXPOSE 8080
```

Tetapi run:

```bash
docker run image
```

Tidak ada port host yang dipublish.

Fix:

```bash
docker run -p 8080:8080 image
```

#### Compose service menggunakan `localhost` untuk dependency

Salah:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

Dari container `api`, `localhost` adalah container `api`, bukan container `postgres`.

Benar:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

#### Host port beda dari container port

Compose:

```yaml
ports:
  - "18080:8080"
```

Host akses:

```bash
curl http://localhost:18080
```

Bukan:

```bash
curl http://localhost:8080
```

#### Service belum ready

Port terbuka belum berarti app siap.

Gunakan readiness endpoint dan startup order yang sehat.

---

## 11. Failure Mode: DNS Failure

### 11.1 Gejala

```text
UnknownHostException
Temporary failure in name resolution
no such host
Name or service not known
```

### 11.2 Diagnosis

```bash
docker network inspect <network>
docker inspect <container> --format '{{json .NetworkSettings.Networks}}'
docker exec <container> cat /etc/resolv.conf
```

Test:

```bash
docker run --rm --network <network> busybox nslookup postgres
```

### 11.3 Root Cause Umum

- containers tidak berada di network yang sama
- memakai container name yang tidak stabil
- Compose project name berubah
- service name salah
- custom DNS rusak
- corporate VPN mengubah DNS host
- rootless Docker networking limitation
- app cache DNS terlalu lama

Untuk Java, DNS cache JVM bisa relevan. Pastikan kamu tahu behavior cache DNS JDK dan security property yang digunakan environment.

---

## 12. Failure Mode: Permission Denied

### 12.1 Gejala

```text
permission denied
AccessDeniedException
Operation not permitted
Read-only file system
```

### 12.2 Klasifikasi

Permission denied bisa berasal dari:

| Layer | Contoh |
|---|---|
| Unix file permission | user tidak bisa tulis `/app` |
| Volume ownership | mounted volume owned by root |
| Read-only root FS | app tulis ke root filesystem |
| Capability missing | bind privileged port |
| Seccomp/AppArmor | syscall ditolak |
| SELinux | bind mount blocked |
| User namespace | UID mapping |
| Docker Desktop sharing | host directory not shared |

### 12.3 Diagnosis

```bash
docker inspect <container> --format '{{json .Config.User}}'
docker exec <container> id
docker exec <container> ls -lah /app /tmp
docker inspect <container> --format '{{json .Mounts}}'
docker logs <container>
```

Jika container tidak bisa start, gunakan image debug:

```bash
docker run --rm --entrypoint id image
docker run --rm --entrypoint ls image -lah /app
```

### 12.4 Java-Specific Permission Problems

#### App tidak bisa tulis temp dir

Java/Spring upload file, embedded Tomcat, atau library tertentu butuh `/tmp`.

Jika container read-only:

```yaml
read_only: true
tmpfs:
  - /tmp
```

#### Heap dump gagal

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Tetapi `/dumps` tidak writable.

#### Truststore mounted read-only salah owner

App butuh baca:

```text
/app/certs/truststore.p12
```

Pastikan user runtime bisa read.

#### Binding port 80 sebagai non-root

Non-root user biasanya tidak bisa bind port <1024 tanpa capability tertentu.

Solusi lebih aman:

- app listen 8080
- host/reverse proxy map ke 80/443

---

## 13. Failure Mode: No Space Left on Device

### 13.1 Gejala

```text
no space left on device
write failed
failed to register layer
failed to copy files
database cannot write
log append failed
```

### 13.2 Diagnosis

Host:

```bash
df -h
df -ih
docker system df
docker system df -v
du -sh /var/lib/docker/* 2>/dev/null
```

Container:

```bash
docker exec <container> df -h
docker exec <container> df -ih
```

### 13.3 Root Cause

- image layers menumpuk
- stopped containers menumpuk
- unused volumes
- BuildKit cache
- container logs membesar
- app menulis file besar ke writable layer
- database volume penuh
- inode habis walau disk bytes masih ada
- Docker Desktop disk image penuh
- host partition `/var/lib/docker` kecil

### 13.4 Safe Remediation

Lihat dulu:

```bash
docker system df
```

Bersihkan yang jelas tidak dipakai:

```bash
docker container prune
docker image prune
docker builder prune
```

Hati-hati:

```bash
docker volume prune
```

Karena volume bisa berisi state penting.

Jangan lakukan ini sembarangan:

```bash
rm -rf /var/lib/docker/overlay2/*
```

Itu dapat merusak state Docker.

### 13.5 Prevention

- log rotation
- gunakan Docker logging driver dengan batas ukuran
- jangan tulis business data ke writable layer
- cleanup CI runner
- prune terjadwal untuk build host
- monitor `/var/lib/docker`
- pisahkan data-root Docker ke disk yang cukup
- gunakan volume lifecycle policy

---

## 14. Failure Mode: Stale Volume / Dirty State

### 14.1 Gejala

- migration gagal karena schema sudah ada
- test integration flaky
- local dev tidak sesuai fresh setup
- config lama tetap terbaca
- database berisi data lama
- broker topic/queue lama masih ada
- Redis cache lama mempengaruhi test
- file upload lama muncul lagi

### 14.2 Diagnosis

```bash
docker volume ls
docker volume inspect <volume>
docker compose ps
docker compose config --volumes
```

### 14.3 Root Cause

Compose volume persistent by design.

```yaml
volumes:
  postgres_data:
```

`docker compose down` tidak menghapus volume.

Untuk reset:

```bash
docker compose down -v
```

Tetapi hati-hati: ini menghapus volume project tersebut.

### 14.4 Pattern yang Benar

Pisahkan command:

```bash
dev-up
dev-down
dev-reset
test-up
test-reset
```

Jangan jadikan `down -v` default untuk semua orang.

---

## 15. Failure Mode: Healthcheck Unhealthy

### 15.1 Gejala

```bash
docker ps
# Up 2 minutes (unhealthy)
```

Compose dependency tidak lanjut.

### 15.2 Diagnosis

```bash
docker inspect <container> --format '{{json .State.Health}}'
docker logs <container>
```

Pretty print:

```bash
docker inspect <container> \
  --format '{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}'
```

### 15.3 Root Cause

- health endpoint salah path
- curl/wget tidak ada di image
- app belum ready saat start_period terlalu pendek
- endpoint butuh auth
- endpoint bind ke management port berbeda
- healthcheck cek dependency eksternal yang transient
- timeout terlalu rendah
- DNS dependency gagal
- TLS cert issue
- healthcheck terlalu mahal

### 15.4 Bad Healthcheck

```Dockerfile
HEALTHCHECK CMD curl -f http://localhost:8080/actuator/health || exit 1
```

Problem:

- image mungkin tidak punya curl
- actuator mungkin di `/actuator/health/readiness`
- management server port mungkin 8081
- endpoint mungkin butuh auth
- health terlalu dependency-sensitive

### 15.5 Better Healthcheck

Untuk image yang punya wget:

```Dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '"status":"UP"' || exit 1
```

Tetapi dalam production minimal image, kamu bisa memilih:

- gunakan app-native lightweight health binary
- gunakan Compose/Kubernetes probe dari luar container
- gunakan distroless plus external healthcheck strategy

---

## 16. Failure Mode: Wrong Config / Missing Env

### 16.1 Gejala

```text
Could not resolve placeholder
Missing required configuration
IllegalArgumentException: URL must not be null
Access denied for user
UnknownHostException: ${DB_HOST}
```

### 16.2 Diagnosis

```bash
docker inspect <container> --format '{{json .Config.Env}}'
docker compose config
docker exec <container> printenv | sort
```

Untuk secret files:

```bash
docker exec <container> ls -lah /run/secrets
```

### 16.3 Root Cause

- `.env` tidak dibaca dari lokasi yang diasumsikan
- variable interpolation Compose vs env runtime tertukar
- `ARG` dipakai untuk runtime config
- env file tidak dipasang
- secret file path salah
- Spring profile salah
- quote YAML salah
- variable kosong dianggap valid
- environment-specific image dibuat ulang dengan config baked-in

### 16.4 Compose Pitfall

```yaml
environment:
  DB_URL: ${DB_URL}
```

Jika `DB_URL` tidak ada, hasil bisa kosong atau warning tergantung Compose behavior.

Gunakan:

```yaml
environment:
  DB_URL: ${DB_URL:?DB_URL is required}
```

---

## 17. Failure Mode: Secret Leak

### 17.1 Gejala

Kadang tidak ada gejala runtime.

Ini ditemukan lewat audit.

Root cause:

```Dockerfile
ARG TOKEN
RUN curl -H "Authorization: Bearer $TOKEN" ...
```

atau:

```Dockerfile
ENV DB_PASSWORD=supersecret
```

atau:

```bash
docker build --build-arg PASSWORD=...
```

### 17.2 Detection

```bash
docker history --no-trunc image
docker inspect image
docker save image -o image.tar
```

Cari secret di:

- image history
- layer filesystem
- build logs
- CI logs
- environment
- Compose config output
- crash dumps

### 17.3 Correct Pattern

BuildKit secret mount:

```Dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    mvn -B package
```

Runtime secret via file mount:

```yaml
secrets:
  db_password:
    file: ./secrets/db_password.txt
```

---

## 18. Failure Mode: Image Tag Drift

### 18.1 Gejala

- “Image yang sama” berperilaku beda
- rollback tidak mengembalikan behavior lama
- environment dev/staging/prod berbeda tanpa perubahan source
- CI rebuild menghasilkan artifact berbeda
- node A dan node B menjalankan digest berbeda untuk tag sama

### 18.2 Diagnosis

```bash
docker image inspect image:tag --format '{{index .RepoDigests 0}}'
docker inspect <container> --format '{{.Image}}'
docker images --digests
```

### 18.3 Root Cause

Tag mutable.

```text
api:latest
api:prod
api:main
```

Bisa menunjuk digest berbeda dari waktu ke waktu.

### 18.4 Prevention

- deploy by digest
- tag dengan commit SHA
- promote same digest
- registry tag immutability
- record digest in deployment metadata
- never rebuild per environment

---

## 19. Failure Mode: Wrong Platform / Architecture

### 19.1 Gejala

```text
exec format error
no matching manifest for linux/arm64
native library cannot be loaded
UnsatisfiedLinkError
Illegal instruction
```

### 19.2 Diagnosis

```bash
docker image inspect image --format '{{.Os}}/{{.Architecture}}'
docker manifest inspect image
docker version
uname -m
```

Untuk Java native library:

```bash
docker exec <container> file /path/to/native.so
```

Jika `file` tidak ada, gunakan debug image.

### 19.3 Root Cause

- image hanya amd64, dijalankan di arm64
- laptop Apple Silicon vs CI x86
- QEMU emulation lambat/buggy
- dependency JNI/JNA tidak multi-arch
- base image berbeda antar platform
- build menghasilkan artifact native untuk architecture builder, bukan target

### 19.4 Prevention

- buildx multi-platform
- test per platform
- hindari dependency native jika tidak perlu
- pilih base image multi-arch
- publish manifest list
- pin platform di CI jobs tertentu

---

## 20. Failure Mode: Docker Desktop Specific

### 20.1 Gejala

- bind mount lambat
- file watcher tidak jalan
- container tidak bisa reach host
- port sudah dipublish tapi tidak reachable
- memory limit tidak sesuai host memory
- disk image penuh
- behavior beda dari Linux server

### 20.2 Root Cause

Docker Desktop berjalan melalui VM/WSL2/integration layer, bukan langsung sama seperti native Linux server.

### 20.3 Diagnosis

```bash
docker info
docker context ls
docker version
```

Cek Docker Desktop settings:

- CPU
- memory
- disk
- file sharing
- WSL integration
- proxy
- Kubernetes integration jika aktif

### 20.4 Prevention

- jangan anggap laptop sama dengan production
- gunakan CI Linux sebagai validation
- hindari bind mount source tree besar jika performance buruk
- pakai named volume untuk dependency cache
- dokumentasikan Desktop-specific setup

---

## 21. Failure Mode: Daemon / Host Problem

### 21.1 Gejala

```text
Cannot connect to the Docker daemon
context deadline exceeded
docker ps hangs
failed to start daemon
overlay2 error
iptables error
```

### 21.2 Diagnosis

Linux:

```bash
systemctl status docker
journalctl -u docker --since "30 minutes ago"
docker info
```

Docker Desktop:

```bash
docker info
docker context ls
```

### 21.3 Root Cause

- Docker daemon stopped
- user tidak punya permission ke socket
- disk penuh
- corrupted metadata
- incompatible storage driver
- iptables/nftables conflict
- corporate security agent interference
- rootless Docker network/storage limitation
- Docker Desktop VM stuck

### 21.4 Socket Permission

Gejala:

```text
permission denied while trying to connect to the Docker daemon socket
```

Root cause:

- user bukan anggota group docker
- socket permission berubah
- rootless/rootful context tertukar

Hati-hati:

> Menambahkan user ke group `docker` memberi privilege sangat tinggi, karena Docker daemon bisa menjalankan container privileged dan mount host filesystem.

---

## 22. Failure Mode: Security Policy Denial

### 22.1 Gejala

```text
Operation not permitted
permission denied
seccomp
apparmor="DENIED"
read-only file system
capability denied
```

### 22.2 Diagnosis

```bash
docker inspect <container> --format '{{json .HostConfig.SecurityOpt}}'
docker inspect <container> --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.CapDrop}}'
docker inspect <container> --format '{{json .HostConfig.ReadonlyRootfs}}'
```

Host logs:

```bash
dmesg | tail
journalctl -k --since "30 minutes ago"
```

### 22.3 Common Cases

#### App butuh write tetapi root filesystem read-only

Fix:

```yaml
read_only: true
tmpfs:
  - /tmp
volumes:
  - app-data:/app/data
```

#### Non-root user tidak bisa bind port 80

Fix:

- listen 8080
- publish host 80 ke container 8080
- atau capability `NET_BIND_SERVICE` jika benar-benar perlu

#### Tool butuh syscall yang diblok seccomp

Jangan langsung disable seccomp.

Investigasi:

- syscall apa?
- apakah tool debugging saja?
- apakah diperlukan production?
- apakah bisa gunakan profile lebih sempit?

---

## 23. Failure Mode: Time, Locale, Certificate, and Trust Issues

### 23.1 Gejala

```text
SSLHandshakeException
certificate has expired
certificate not yet valid
PKIX path building failed
timezone wrong
date parse error
```

### 23.2 Root Cause

- container time mengikuti host, tetapi timezone data tidak ada
- CA certificates tidak ada di image minimal
- corporate CA tidak dipasang di container
- Java truststore berbeda dari OS truststore
- distroless/minimal image tidak punya debugging tools
- app memakai local timezone implicit

### 23.3 Diagnosis

```bash
docker exec <container> date
docker exec <container> ls -lah /etc/ssl/certs
docker exec <container> java -XshowSettings:properties -version 2>&1 | grep -i trust
```

Jika image minimal, buat diagnostic variant.

### 23.4 Prevention

- gunakan UTC untuk service
- pasang CA certificates jika base image memerlukan
- kelola Java truststore eksplisit
- jangan asumsi host truststore masuk container
- test TLS endpoint dari dalam container network

---

## 24. Failure Mode: Logging Black Hole

### 24.1 Gejala

- `docker logs` kosong
- app sebenarnya crash tetapi tidak ada log
- log file ada di container tetapi hilang setelah remove
- disk penuh karena log
- structured logs rusak

### 24.2 Root Cause

- app log ke file saja
- logging config profile salah
- stdout disuppress wrapper script
- Docker logging driver tidak sesuai
- json-file tanpa rotasi
- logs terlalu verbose
- container restart cepat sebelum flush
- app async logger kehilangan buffer saat SIGKILL

### 24.3 Diagnosis

```bash
docker logs <container>
docker inspect <container> --format '{{json .HostConfig.LogConfig}}'
docker exec <container> find / -name '*.log' 2>/dev/null | head
```

### 24.4 Prevention

- log ke stdout/stderr
- configure rotation
- flush on shutdown
- avoid only-file logging
- include startup config summary
- use structured logs consistently

---

## 25. Failure Mode: Build Cache Poisoning / Non-Reproducible Build

### 25.1 Gejala

- build lokal sukses, CI gagal
- rebuild tanpa perubahan menghasilkan image berbeda
- dependency versi berubah sendiri
- stale generated file masuk image
- cache membuat hasil lama dipakai

### 25.2 Root Cause

- unpinned dependency
- `latest` base image
- dynamic downloads
- Maven/Gradle snapshot
- build context berisi artifact lama
- Dockerfile urutan salah
- cache mount dipakai untuk output final
- timestamp-sensitive build

### 25.3 Diagnosis

```bash
docker build --progress=plain .
docker build --no-cache .
docker history image
docker image inspect image
```

### 25.4 Prevention

- pin base image
- lock dependency
- separate dependency download from source copy
- avoid dynamic curl install tanpa checksum
- use reproducible build settings
- keep build context clean
- `.dockerignore` agresif tapi benar
- promote digest, not rebuild

---

## 26. Java-Specific Failure Catalogue

### 26.1 `ClassNotFoundException` / `NoClassDefFoundError`

Root cause:

- JAR salah yang dicopy
- multi-stage path salah
- dependency scope salah
- Spring Boot jar tidak executable
- exploded jar layer incomplete

Diagnosis:

```bash
docker run --rm --entrypoint jar image tf /app/app.jar | head
```

Jika `jar` tidak ada di runtime image, inspect artifact di build stage atau lokal.

### 26.2 `UnsupportedClassVersionError`

Root cause:

- compile pakai Java 21, runtime Java 17
- base runtime image salah

Diagnosis:

```bash
docker run --rm image java -version
```

### 26.3 `OutOfMemoryError` tetapi container tidak OOMKilled

Root cause:

- JVM heap/metaspace/direct memory limit internal
- bukan container kill

Evidence:

```text
java.lang.OutOfMemoryError
OOMKilled=false
ExitCode=1
```

### 26.4 OOMKilled tanpa Java OOM log

Root cause:

- container memory limit dilampaui
- process dibunuh kernel sebelum JVM sempat log
- native memory/direct buffer/thread stack

Evidence:

```text
OOMKilled=true
ExitCode=137
```

### 26.5 Slow Startup

Root cause:

- CPU quota rendah
- entropy/blocking random issue pada environment lama
- DB dependency wait
- migration berat
- image pull besar
- classpath scanning
- JIT warmup
- DNS timeout

Diagnosis:

- timestamp startup logs
- `docker stats`
- app startup metrics
- dependency logs

### 26.6 Graceful Shutdown Gagal

Root cause:

- shell-form entrypoint
- wrapper tidak `exec`
- stop timeout terlalu pendek
- app tidak handle SIGTERM
- executor tidak shutdown
- long request tidak diberi deadline

Diagnosis:

```bash
docker stop -t 30 api
docker logs api
docker events --since 5m
```

---

## 27. Diagnostic Decision Tree

Gunakan urutan ini saat incident.

### Step 1 — Apakah container ada?

```bash
docker ps -a | grep api
```

Jika tidak ada:

- build/pull/create gagal
- cek command run/compose output
- cek image/tag/registry
- cek port/name/mount conflict

Jika ada, lanjut.

---

### Step 2 — Status container apa?

```bash
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'
```

Interpretasi:

| Status | Makna |
|---|---|
| Created | dibuat tapi belum start |
| Up | process berjalan |
| Up (healthy) | process berjalan dan healthcheck sukses |
| Up (unhealthy) | process berjalan tetapi healthcheck gagal |
| Exited (0) | process selesai normal |
| Exited (1) | app error umum |
| Exited (137) | killed |
| Restarting | crash loop atau restart policy |

---

### Step 3 — Apa exit code dan OOMKilled?

```bash
docker inspect api --format 'Exit={{.State.ExitCode}} OOM={{.State.OOMKilled}} Error={{.State.Error}}'
```

---

### Step 4 — Apa kata logs?

```bash
docker logs --tail 300 api
```

Untuk logs panjang:

```bash
docker logs --since 30m api
```

---

### Step 5 — Apa effective config?

```bash
docker inspect api
docker compose config
```

Periksa:

- image digest
- entrypoint
- cmd
- env
- user
- mounts
- ports
- networks
- healthcheck
- restart policy
- memory/cpu limit
- security options

---

### Step 6 — Apakah network benar?

```bash
docker port api
docker network inspect <network>
```

Test dari lokasi yang benar:

- host ke published port
- container lain ke service name
- container itu sendiri ke localhost

---

### Step 7 — Apakah storage benar?

```bash
docker inspect api --format '{{json .Mounts}}'
docker exec api df -h
docker exec api id
docker exec api ls -lah /app /tmp
```

---

### Step 8 — Apakah resource bottleneck?

```bash
docker stats api
docker inspect api --format '{{json .HostConfig.Memory}} {{json .HostConfig.NanoCpus}}'
```

---

### Step 9 — Apakah host/daemon sehat?

```bash
docker info
docker system df
systemctl status docker
journalctl -u docker --since "30 minutes ago"
```

---

## 28. Symptom-to-Cause Matrix

| Symptom | Most Likely Causes | First Evidence |
|---|---|---|
| `Exited (0)` | command selesai, app mode salah | inspect entrypoint/cmd, logs |
| `Exited (1)` | app startup failure | logs |
| `Exited (126)` | command not executable | entrypoint permission |
| `Exited (127)` | command not found | entrypoint/cmd, PATH |
| `Exited (137)` | SIGKILL/OOM/manual kill | inspect OOMKilled, events |
| `Restarting` | crash loop + restart policy | logs, restart count |
| `unhealthy` | healthcheck salah/app not ready | inspect health log |
| `connection refused` | app not listening/wrong port | docker port, ss, logs |
| `no such host` | DNS/network mismatch | network inspect, nslookup |
| `permission denied` | user/mount/security | id, ls, inspect mounts/security |
| `no space left` | disk/inode/log/cache/volume | df, docker system df |
| `exec format error` | architecture mismatch | image inspect, manifest |
| `x509 unknown authority` | CA/truststore missing | cert config, Java truststore |
| `manifest unknown` | tag missing | registry/tag inspect |
| `pull access denied` | auth/repo permission | docker login, registry policy |
| app sees old data | stale volume | volume inspect, down -v |
| logs missing | file logging/wrong driver | docker logs, log config |
| slow startup | CPU/migration/DNS/pull size | stats, timestamps |

---

## 29. Postmortem Framing for Docker Incidents

Saat menulis postmortem, jangan berhenti di:

```text
Container crashed.
```

Tulis dengan struktur:

```text
Phase:
  Runtime after successful start.

Primary symptom:
  Container entered restart loop every 8-12 seconds.

Immediate trigger:
  Application exited with code 1 due to missing DB_PASSWORD environment variable.

Root cause:
  Compose production override referenced ${DB_PASSWORD}, but deployment environment did not define it and no required-variable guard was configured.

Contributing factors:
  - No startup config validation summary.
  - Healthcheck did not run because process exited before health start period.
  - CI only tested default .env, not production override.
  - Secret file migration was incomplete.

Detection:
  Docker restart count increased; service unavailable alert fired.

Resolution:
  Injected secret correctly and redeployed same image digest.

Prevention:
  - Add Compose required variable guard.
  - Add startup validation.
  - Add CI config rendering check.
  - Promote image by digest and validate runtime config separately.
```

Tujuan postmortem bukan menyalahkan Docker, tetapi mengidentifikasi kontrak mana yang tidak eksplisit.

---

## 30. Senior-Level Heuristics

### 30.1 Jangan Menghapus Evidence Terlalu Cepat

Hindari refleks:

```bash
docker compose down -v
docker system prune -a
```

Sebelum:

- logs disimpan
- inspect disimpan
- events dicek
- volume dipahami
- image digest dicatat

### 30.2 Jangan Percaya Nama Tag

Selalu cek digest.

```bash
docker image inspect image:tag --format '{{json .RepoDigests}}'
```

### 30.3 Jangan Debug dari Tempat yang Salah

Test network harus dari lokasi client sebenarnya.

- host client: curl host published port
- container client: curl service name
- app internal: curl localhost inside same container

### 30.4 Jangan Menyimpulkan `unhealthy` sebagai App Mati

Process bisa running, tetapi healthcheck salah.

### 30.5 Jangan Menyimpulkan `running` sebagai App Siap

Process bisa running, tetapi app belum ready.

### 30.6 Jangan Menganggap OOM Selalu Heap

Container memory = heap + metaspace + direct memory + thread stack + code cache + native libs + allocator overhead + OS/process overhead.

### 30.7 Jangan Menyelesaikan Permission dengan Root Terus-Menerus

Jika fix-nya:

```Dockerfile
USER root
```

maka kemungkinan kamu menghindari root cause.

Lebih baik:

- ownership benar saat build
- writable path eksplisit
- volume ownership jelas
- temp dir disediakan
- non-root runtime tetap dipakai

### 30.8 Jangan Mengandalkan `latest`

`latest` adalah tag, bukan freshness guarantee, bukan immutability guarantee, dan bukan deployment identity.

---

## 31. Minimal Incident Command Pack

Untuk service bernama `api`:

```bash
docker ps -a --filter name=api
docker inspect api > inspect-api.json
docker logs --timestamps --tail 500 api > logs-api.txt
docker events --since 30m > events.txt
docker stats --no-stream api
docker port api
docker image inspect $(docker inspect api --format '{{.Image}}') > image-api.json
docker system df -v
```

Untuk Compose project:

```bash
docker compose ps
docker compose logs --timestamps --tail=300
docker compose config > compose-rendered.yml
docker compose events --json
```

Untuk network:

```bash
docker network ls
docker network inspect <network>
docker run --rm --network <network> curlimages/curl:latest curl -v http://api:8080/actuator/health
```

Untuk disk:

```bash
df -h
df -ih
docker system df -v
docker builder du
```

Untuk Java:

```bash
docker exec api printenv | sort
docker exec api sh -c 'ps -ef || true'
docker exec api sh -c 'java -version || true'
docker exec api sh -c 'df -h && id && ls -lah /tmp /app || true'
```

Jika shell tidak tersedia, gunakan debug strategy dari Part 022.

---

## 32. Practice Scenarios

### Scenario A — Container Exited 0

Gejala:

```text
api Exited (0)
```

Kemungkinan root cause:

- command override menjalankan `java -version`
- app mode batch
- script selesai tanpa menjalankan app

Evidence:

```bash
docker inspect api --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker logs api
```

---

### Scenario B — Running But Connection Refused

Gejala:

```bash
curl localhost:8080
# connection refused
```

Checklist:

```bash
docker ps
docker port api
docker logs api
docker exec api ss -lntp
```

Common answer:

- app bind `127.0.0.1`
- host port bukan 8080
- app listen 8081
- no `-p`

---

### Scenario C — Exit 137

Checklist:

```bash
docker inspect api --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
docker stats api
docker logs api
```

Jika OOMKilled true:

- memory limit terlalu kecil
- heap terlalu besar
- native memory tinggi

Jika false:

- manual kill
- stop timeout
- host pressure
- external supervisor

---

### Scenario D — Compose DB Connection Fails

Gejala:

```text
Connection refused localhost:5432
```

Root cause paling sering:

```properties
jdbc:postgresql://localhost:5432/app
```

Dalam container `api`, harus:

```properties
jdbc:postgresql://postgres:5432/app
```

Dengan `postgres` sebagai Compose service name.

---

### Scenario E — Works on My Machine, Fails in CI

Kemungkinan:

- architecture berbeda
- build context berbeda
- `.dockerignore` berbeda efek
- env/secret tidak ada
- cache tidak ada
- network restricted
- private registry auth
- base image tag berubah
- Docker version/BuildKit behavior berbeda

Evidence:

```bash
docker version
docker info
docker build --progress=plain
docker manifest inspect image
```

---

## 33. Checklist Produksi untuk Mengurangi Failure Mode

Sebelum service Java Dockerized dianggap production-ready:

```text
[ ] Dockerfile memakai exec-form ENTRYPOINT.
[ ] Runtime image tidak membawa build tool.
[ ] App berjalan sebagai non-root.
[ ] Writable path eksplisit.
[ ] /tmp tersedia jika root filesystem read-only.
[ ] JVM memory dikonfigurasi sadar container limit.
[ ] Graceful shutdown diuji dengan docker stop.
[ ] Healthcheck/readiness tidak false positive.
[ ] Logs ke stdout/stderr.
[ ] Logging rotation tersedia di host/runtime.
[ ] Image tag immutable atau deployment pakai digest.
[ ] Base image dipilih secara sadar.
[ ] Secret tidak ada di image history/layer.
[ ] Compose config dapat dirender dan divalidasi.
[ ] Network dependency memakai service name, bukan localhost.
[ ] Volume lifecycle jelas.
[ ] Disk usage Docker dimonitor.
[ ] CI build reproducible.
[ ] Multi-platform strategy jelas.
[ ] Debug strategy untuk minimal image tersedia.
[ ] Incident command pack terdokumentasi.
```

---

## 34. Kesimpulan

Docker failure jarang benar-benar random.

Sebagian besar bisa dipetakan ke salah satu fase:

```text
build → pull → create → start → runtime → health → network/storage/resource/security
```

Kunci engineer senior bukan menghafal semua error, melainkan mampu:

1. mengklasifikasikan fase failure,
2. mengambil evidence yang tepat,
3. membedakan symptom dari root cause,
4. memperbaiki kontrak yang salah,
5. mencegah recurrence dengan guardrail.

Docker membuat packaging dan runtime lebih eksplisit, tetapi juga membuat asumsi lama terlihat:

- asumsi bahwa app selalu punya filesystem writable
- asumsi bahwa localhost berarti dependency
- asumsi bahwa memory host sama dengan memory app
- asumsi bahwa tag adalah identity
- asumsi bahwa process menerima signal dengan benar
- asumsi bahwa environment lokal sama dengan server
- asumsi bahwa root adalah default aman

Part ini harus menjadi referensi saat debugging semua part berikutnya.

---

## 35. Koneksi ke Part Berikutnya

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-030.md
```

Judul:

```text
Design Patterns and Anti-Patterns for Java Services in Docker
```

Kita akan mengubah katalog failure ini menjadi pattern desain:

- Dockerfile production-grade
- non-root runtime
- layered Spring Boot image
- healthcheck contract
- graceful shutdown contract
- externalized config
- immutable image
- digest-based deployment
- anti-pattern catalogue
- decision matrix untuk Java Docker service

---

## Status Seri

```text
Selesai:
- Part 000 sampai Part 029

Belum selesai:
- Part 030
- Part 031

Seri belum mencapai bagian terakhir.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Production Readiness Without Kubernetes: Docker on VM, Systemd, Restart, Backup</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-030.md">Part 030 — Design Patterns and Anti-Patterns for Java Services in Docker ➡️</a>
</div>
