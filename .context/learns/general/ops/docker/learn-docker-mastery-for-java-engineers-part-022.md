# learn-docker-mastery-for-java-engineers-part-022.md

# Part 022 — Debugging Running Containers: `exec`, Inspect, Events, Minimal Images

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `022`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: debugging container berjalan secara sistematis tanpa mengubah container menjadi server mutable

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membahas:

- container lifecycle
- Docker CLI sebagai runtime inspector
- Dockerfile
- BuildKit
- Java runtime di container
- `ENTRYPOINT` dan `CMD`
- filesystem dan volume
- networking
- Compose
- healthcheck
- config dan secrets
- security
- supply chain
- base image
- performance
- logging dan crash forensics

Part ini menyatukan banyak konsep tersebut menjadi satu kemampuan praktis:

> Bagaimana membaca fakta runtime dari container yang sedang berjalan, sedang crash, atau susah di-debug karena image-nya minimal?

Yang penting: debugging container bukan berarti “masuk ke container lalu memperlakukan container seperti VM kecil”. Itu kebiasaan yang berbahaya.

Container yang sehat secara desain harus:

- disposable
- reproducible
- immutable dari sisi artifact
- observable dari luar
- minim mutasi manual
- tidak bergantung pada SSH/manual repair
- dapat direcreate dari image, config, network, volume, dan runtime option yang sama

Debugging container yang matang berarti:

1. kumpulkan fakta;
2. isolasi layer masalah;
3. reproduksi dengan input yang sama;
4. hindari perubahan manual yang tidak bisa diaudit;
5. perbaiki image/config/pipeline/source, bukan “memperbaiki container langsung”.

---

## 1. Mental Model Debugging Container

Container berjalan adalah kombinasi dari beberapa hal:

```text
container runtime fact =
  image filesystem snapshot
+ container writable layer
+ process tree
+ environment variables
+ mounted volumes
+ network namespace
+ port publishing
+ resource limits
+ security options
+ healthcheck
+ restart policy
+ logging driver
+ labels
+ runtime command / entrypoint override
```

Saat container bermasalah, jangan langsung berpikir:

```text
"aplikasinya error"
```

Pikirkan sebagai sistem boundary:

```text
Masalah bisa berasal dari:
- image
- command / entrypoint
- env
- secret/config
- filesystem/mount
- network
- DNS
- permission
- resource limit
- JVM ergonomics
- application logic
- dependency eksternal
- host Docker daemon
- registry/image version mismatch
```

Debugging yang baik adalah memperkecil ruang kemungkinan.

---

## 2. Prinsip Utama: Inspect Facts First

Sebelum `docker exec`, biasanya jalankan ini dulu:

```bash
docker ps -a
docker inspect <container>
docker logs <container>
docker events --since 30m
docker stats --no-stream <container>
```

Kenapa?

Karena `exec` membuat kita masuk ke dalam konteks container, tetapi banyak masalah container justru berada di luar proses aplikasi:

- port tidak dipublish
- network tidak attached
- mount salah
- env tidak masuk
- command override berbeda
- healthcheck gagal
- restart policy memicu loop
- memory limit terlalu kecil
- image digest tidak sesuai
- bind address salah
- container jalan sebagai UID yang tidak punya permission

`docker inspect` adalah salah satu command paling penting karena mengembalikan low-level information dalam bentuk JSON untuk object Docker seperti container, image, network, dan volume. Docker CLI documentation mendefinisikan `docker inspect` sebagai command untuk mengembalikan detail low-level object Docker.

---

## 3. Debugging Flow Besar

Gunakan urutan mental ini:

```text
1. Apakah container ada?
   docker ps -a

2. Apakah container berjalan?
   STATUS, exit code, restart count

3. Apa proses utama yang dijalankan?
   docker inspect -> Config.Entrypoint, Config.Cmd, Path, Args

4. Apa log terakhir?
   docker logs --tail 200

5. Apakah exit karena resource?
   docker inspect -> State.OOMKilled, State.ExitCode
   docker stats

6. Apakah config runtime sesuai?
   env, mounts, networks, ports, user, workdir

7. Apakah app bisa dijangkau dari dalam container?
   docker exec / debug container

8. Apakah app bisa dijangkau dari container lain?
   test via same Docker network

9. Apakah app bisa dijangkau dari host?
   port publishing, bind address, firewall

10. Apakah failure berasal dari dependency?
    DNS, DB, broker, TLS, credential, migration

11. Apakah image yang berjalan benar?
    image ID, digest, labels, created time
```

Jangan lompat ke step 7 terlalu cepat.

---

## 4. Command Core untuk Debugging

Docker CLI menyediakan banyak command container-level. Dokumentasi Docker container command mencakup command seperti `exec`, `inspect`, `logs`, `cp`, `diff`, `top`, dan lainnya. Di tangan engineer yang matang, command ini bukan sekadar utility, tetapi alat observasi boundary.

### 4.1 `docker ps -a`

Gunanya:

- melihat container berjalan dan berhenti
- melihat status
- melihat restart
- melihat port publish ringkas
- melihat command ringkas
- melihat container name

Contoh:

```bash
docker ps -a
```

Output penting:

```text
CONTAINER ID   IMAGE        COMMAND       STATUS                      PORTS
abc123         myapp:1.0    "java -jar"   Exited (137) 2 minutes ago
```

Interpretasi:

- `Exited (137)` sering berhubungan dengan SIGKILL atau OOM kill
- `Exited (0)` berarti proses utama selesai normal
- `Restarting` berarti restart policy bekerja
- `Up ... (unhealthy)` berarti proses masih hidup tapi healthcheck gagal
- `Up` tidak otomatis berarti app siap

### 4.2 `docker inspect`

Contoh:

```bash
docker inspect myapp
```

Gunakan format agar tidak tenggelam dalam JSON:

```bash
docker inspect myapp --format '{{json .State}}'
docker inspect myapp --format '{{json .Config.Env}}'
docker inspect myapp --format '{{json .NetworkSettings.Networks}}'
docker inspect myapp --format '{{json .Mounts}}'
docker inspect myapp --format '{{json .HostConfig.PortBindings}}'
```

Checklist informasi penting:

```text
.State.Status
.State.Running
.State.ExitCode
.State.Error
.State.OOMKilled
.State.StartedAt
.State.FinishedAt
.State.Health

.Config.Image
.Config.Entrypoint
.Config.Cmd
.Config.Env
.Config.WorkingDir
.Config.User
.Config.ExposedPorts
.Config.Labels

.HostConfig.Binds
.HostConfig.Mounts
.HostConfig.PortBindings
.HostConfig.Memory
.HostConfig.NanoCpus
.HostConfig.RestartPolicy
.HostConfig.SecurityOpt
.HostConfig.CapDrop
.HostConfig.ReadonlyRootfs

.NetworkSettings.Networks
.NetworkSettings.Ports
.NetworkSettings.IPAddress
.NetworkSettings.Gateway

.Mounts
```

### 4.3 `docker logs`

```bash
docker logs myapp
docker logs --tail 200 myapp
docker logs --since 30m myapp
docker logs -f myapp
docker logs --timestamps myapp
```

Gunakan untuk:

- startup error
- stack trace
- config validation failure
- migration failure
- dependency connection failure
- graceful shutdown log
- OOM clue dari application level

Tetapi ingat:

- `docker logs` hanya berguna jika aplikasi menulis ke stdout/stderr atau logging driver mendukung retrieval
- file log internal container tidak otomatis muncul
- log driver tertentu bisa mengubah cara retrieval
- crash sebelum logging framework initialize bisa menghasilkan log sangat sedikit

### 4.4 `docker events`

`docker events` menunjukkan event runtime dari daemon:

```bash
docker events --since 30m
docker events --filter container=myapp
```

Useful untuk melihat:

- create
- start
- stop
- die
- restart
- health_status
- oom
- network connect/disconnect
- volume mount issue

Contoh pola:

```text
container start
container health_status: unhealthy
container die
container restart
container start
```

Ini memberi clue bahwa masalah bukan hanya “app error”, tetapi lifecycle loop.

### 4.5 `docker stats`

```bash
docker stats myapp
docker stats --no-stream myapp
```

Gunakan untuk:

- memory usage
- CPU usage
- network IO
- block IO
- PID count

Jangan membaca `docker stats` sebagai satu-satunya truth untuk Java memory. JVM memory meliputi:

- heap
- metaspace
- code cache
- thread stack
- direct buffer
- mmap
- native allocator
- JIT structures
- GC overhead
- libc/native library memory

Kalau container limit 512 MiB dan heap 450 MiB, ruang native terlalu sempit.

### 4.6 `docker top`

```bash
docker top myapp
```

Gunanya:

- melihat proses di container
- memastikan proses utama benar
- mendeteksi child process
- melihat apakah wrapper script masih menjadi PID utama
- melihat zombie process secara awal

Contoh masalah:

```text
PID 1 = /bin/sh /app/start.sh
PID 7 = java -jar app.jar
```

Jika shell script tidak `exec java ...`, signal handling bisa bermasalah.

### 4.7 `docker diff`

```bash
docker diff myapp
```

Gunanya:

- melihat perubahan filesystem di writable layer container
- mendeteksi file yang dibuat runtime
- melihat apakah aplikasi menulis ke path yang tidak diharapkan

Output:

```text
A /tmp/app-cache
C /app/config/application.yml
A /var/log/myapp/app.log
```

Arti:

- `A` = added
- `C` = changed
- `D` = deleted

Use case:

- membuktikan aplikasi menulis log ke file, bukan stdout
- menemukan config yang dimutasi saat startup
- mendeteksi temp file leak
- mendeteksi writable path yang perlu volume/tmpfs
- menemukan state tersembunyi di container

### 4.8 `docker cp`

Docker documentation menjelaskan `docker cp` dapat menyalin file/folder antara filesystem container dan local filesystem, baik container running maupun stopped.

```bash
docker cp myapp:/tmp/heapdump.hprof ./heapdump.hprof
docker cp myapp:/app/config/effective.yml ./effective.yml
docker cp ./diagnostic.sh myapp:/tmp/diagnostic.sh
```

Gunakan hati-hati.

Baik untuk:

- mengambil heap dump
- mengambil log file yang terlanjur ditulis internal
- mengambil generated report
- mengambil config efektif
- mengambil artifact crash

Hindari menjadikannya operational model normal.

Kalau setiap incident butuh `docker cp` file manual, observability/logging/export design perlu diperbaiki.

---

## 5. `docker exec`: Berguna, Tapi Jangan Dijadikan Kebiasaan Buta

Docker documentation mendefinisikan `docker exec` sebagai command untuk menjalankan command baru di container yang sedang berjalan; command itu hanya berjalan selama primary process container masih hidup.

Contoh:

```bash
docker exec -it myapp sh
docker exec myapp env
docker exec myapp pwd
docker exec myapp ls -la /app
docker exec myapp cat /etc/resolv.conf
```

### 5.1 Kapan `exec` tepat?

Gunakan `exec` ketika ingin memeriksa runtime dari dalam namespace container:

- env actual
- file actual
- DNS resolver
- connectivity keluar
- process list
- open port internal
- mounted file visibility
- permission
- timezone
- CA certificate
- JVM diagnostic command
- temporary manual probe

### 5.2 Kapan `exec` misleading?

`exec` bisa misleading jika:

- container sudah restart sejak error terjadi
- state yang ingin dilihat hanya ada sebelum crash
- image minimal tidak punya tooling
- masuk sebagai user berbeda dari app user
- command exec tidak memakai working directory yang sama
- shell tidak ada
- environment interaktif berbeda dari process utama
- kita mengubah container saat debugging

Contoh:

```bash
docker exec -it --user root myapp sh
```

Kalau aplikasi jalan sebagai UID 10001, masuk sebagai root bisa menutupi permission issue.

Lebih baik:

```bash
docker inspect myapp --format '{{.Config.User}}'
docker exec -it --user 10001 myapp sh
```

Atau jika shell tidak ada:

```bash
docker exec myapp /app/my-diagnostic-command
```

---

## 6. Masalah Image Minimal: Tidak Ada Shell, Tidak Ada Curl, Tidak Ada Ps

Image minimal/distroless bagus untuk security dan ukuran. Docker Hardened Images/distroless documentation menekankan pendekatan minimal untuk mengurangi surface dan membuat environment lebih predictable. Tetapi konsekuensinya:

```text
docker exec -it myapp sh
```

bisa gagal:

```text
exec: "sh": executable file not found in $PATH
```

Atau:

```text
curl: not found
ps: not found
netstat: not found
bash: not found
cat: not found
```

Ini bukan bug. Ini desain.

### 6.1 Jangan memasukkan semua tool debug ke production image secara refleks

Reaksi yang salah:

```dockerfile
RUN apt-get update && apt-get install -y curl net-tools vim procps
```

Masalahnya:

- image membesar
- attack surface naik
- patching lebih kompleks
- CVE scanner lebih ramai
- production artifact menjadi kurang minimal
- dev convenience mengalahkan security posture

### 6.2 Pola yang lebih matang

Gunakan salah satu:

1. debug variant image
2. temporary debug container
3. `docker debug` jika tersedia
4. host-level namespace inspection
5. observability endpoint yang benar
6. JVM diagnostic endpoint/tool yang sudah dipersiapkan
7. reproduce container locally dengan debug tooling

---

## 7. Docker Debug

Docker memiliki `docker debug` untuk membantu debugging image/container minimal. Dokumentasi Docker menyatakan Docker Debug membantu menjaga image tetap kecil dan aman dengan memungkinkan debugging image/container yang minimal dan sulit di-debug karena tool sudah dihapus; contoh umum `docker exec -it my-app bash` mungkin gagal pada slim container, sedangkan Docker Debug dirancang untuk skenario itu.

Konsepnya:

```text
production image tetap minimal
debugging dilakukan lewat toolbox sementara
```

Ini sejalan dengan prinsip:

```text
debuggability should not always require bloating the runtime image
```

Contoh:

```bash
docker debug myapp
```

Kegunaan:

- inspeksi proses
- inspeksi network
- inspeksi filesystem
- menjalankan tools seperti curl/ps/netstat/strace dalam konteks debug

Catatan:

- availability tergantung Docker version/edition/environment
- jangan jadikan satu-satunya mekanisme production emergency
- tetap perlu policy akses dan audit
- tetap pahami namespace/mount/network yang sedang diinspeksi

---

## 8. Debug Container Pattern

Kalau tidak memakai `docker debug`, pola umum adalah menjalankan container debug di network yang sama.

Misal service:

```bash
docker network ls
docker inspect myapp --format '{{json .NetworkSettings.Networks}}'
```

Lalu jalankan debug container:

```bash
docker run --rm -it \
  --network <network-name> \
  nicolaka/netshoot
```

Atau image ringan:

```bash
docker run --rm -it \
  --network <network-name> \
  alpine sh
```

Install sementara di debug container, bukan production container:

```bash
apk add --no-cache curl bind-tools iproute2
```

Lalu test:

```bash
curl -v http://myapp:8080/actuator/health
nslookup myapp
dig myapp
ip route
```

Keuntungan:

- production image tetap bersih
- bisa test dari network yang sama
- tidak perlu masuk ke app container
- debugging lebih eksplisit
- cocok untuk Compose environment

Keterbatasan:

- tidak masuk ke process namespace app container
- tidak melihat filesystem app kecuali mount yang sama dipasang
- tidak otomatis melihat localhost app container

---

## 9. Network Debugging: Tiga Perspektif

Masalah network container sering terjadi karena engineer hanya test dari satu perspektif.

Ada tiga perspektif:

```text
1. Inside app container
2. From another container in same Docker network
3. From host machine
```

### 9.1 Inside app container

```bash
docker exec myapp sh
curl http://localhost:8080/actuator/health
```

Makna:

- apakah process listen di dalam container?
- apakah app bind ke port benar?
- apakah endpoint internal hidup?

Kalau ini gagal, masalah kemungkinan di app process/config.

### 9.2 From another container

```bash
docker run --rm -it --network myproject_default curlimages/curl \
  curl -v http://myapp:8080/actuator/health
```

Makna:

- apakah Docker DNS resolve service/container?
- apakah app reachable via container IP/network?
- apakah app bind ke `0.0.0.0`, bukan hanya `127.0.0.1`?

Kalau inside container berhasil tapi dari container lain gagal, kemungkinan app bind ke loopback.

### 9.3 From host

```bash
curl -v http://localhost:8080/actuator/health
```

Makna:

- apakah port dipublish ke host?
- apakah host port benar?
- apakah bind address host benar?
- apakah firewall/desktop VM memengaruhi?

Kalau dari container lain berhasil tapi dari host gagal, kemungkinan port publishing.

---

## 10. Jebakan `localhost`

Ini failure yang sangat umum.

Di dalam container:

```text
localhost = container itu sendiri
```

Bukan host. Bukan container lain.

Jika service Java di container mencoba:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

Maka aplikasi mencari PostgreSQL di container Java itu sendiri.

Dalam Compose, gunakan service name:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

Jika perlu akses host dari container, gunakan mekanisme host gateway yang sesuai environment, misalnya `host.docker.internal` pada environment yang mendukung.

Debug checklist:

```bash
docker exec myapp cat /etc/hosts
docker exec myapp cat /etc/resolv.conf
docker exec myapp getent hosts postgres
docker inspect myapp --format '{{json .NetworkSettings.Networks}}'
```

---

## 11. Port Debugging

Checklist:

```bash
docker ps
docker inspect myapp --format '{{json .NetworkSettings.Ports}}'
docker inspect myapp --format '{{json .HostConfig.PortBindings}}'
```

Perbedaan penting:

```dockerfile
EXPOSE 8080
```

tidak sama dengan publish ke host.

Publish dilakukan saat run/Compose:

```bash
docker run -p 8080:8080 myapp
```

Compose:

```yaml
ports:
  - "8080:8080"
```

Masalah umum:

```text
container port benar, host port salah
app listen di 127.0.0.1
EXPOSE ada tapi ports tidak ada
host port sudah dipakai
service memakai random port
Spring profile mengubah server.port
management port berbeda
IPv6 bind behavior berbeda
```

Cek port dari dalam:

```bash
docker exec myapp ss -ltnp
```

Jika `ss` tidak ada, gunakan debug container atau Docker Debug.

---

## 12. DNS Debugging

Docker user-defined bridge network menyediakan DNS internal untuk container/service name.

Checklist:

```bash
docker inspect myapp --format '{{json .NetworkSettings.Networks}}'
docker network inspect <network>
docker exec myapp cat /etc/resolv.conf
docker exec myapp getent hosts <service-name>
```

Jika image minimal tidak punya `getent`, gunakan debug container:

```bash
docker run --rm -it --network <network> nicolaka/netshoot dig <service-name>
```

Failure patterns:

```text
no such host
temporary failure in name resolution
service tidak berada di network yang sama
container name berbeda dari service name
Compose project name berbeda
custom network tidak dipakai semua service
app cache DNS terlalu lama
```

Java nuance:

- JVM dapat cache DNS.
- TTL dapat dipengaruhi security property.
- Connection pool bisa menyimpan connection lama.
- DNS resolve berhasil bukan berarti service ready.
- DNS failure dan TCP failure harus dibedakan.

---

## 13. Filesystem Debugging

Masalah filesystem sering terlihat sebagai:

```text
permission denied
no such file or directory
read-only file system
config not found
certificate not found
cannot create temp file
disk full
```

Checklist:

```bash
docker inspect myapp --format '{{json .Mounts}}'
docker inspect myapp --format '{{.Config.WorkingDir}}'
docker inspect myapp --format '{{.Config.User}}'
docker exec myapp pwd
docker exec myapp ls -la /app
docker exec myapp ls -la /tmp
docker exec myapp id
docker diff myapp
```

Jika shell/tool tidak ada:

```bash
docker cp myapp:/path/to/file ./file
docker debug myapp
```

### 13.1 Bind mount hides image file

Dockerfile:

```dockerfile
COPY config/application.yml /app/config/application.yml
```

Run:

```bash
docker run -v ./config:/app/config myapp
```

Jika `./config` kosong di host, maka `/app/config` dari image tertutup oleh bind mount kosong.

Gejala:

```text
File ada di image saat build, tapi hilang saat run.
```

Diagnosis:

```bash
docker inspect myapp --format '{{json .Mounts}}'
```

### 13.2 UID mismatch

Container berjalan sebagai UID 10001:

```dockerfile
USER 10001
```

Bind mount host dimiliki UID berbeda:

```text
/app/data permission denied
```

Diagnosis:

```bash
docker inspect myapp --format '{{.Config.User}}'
docker exec myapp id
docker exec myapp ls -ln /app/data
```

Solusi desain:

- set ownership saat build untuk path internal
- gunakan named volume dengan init ownership
- gunakan UID/GID yang konsisten
- jangan default root hanya demi menghindari permission issue

---

## 14. Environment Debugging

Cek env container:

```bash
docker inspect myapp --format '{{json .Config.Env}}'
docker exec myapp env
```

Bedakan:

```text
env yang dimasukkan Docker
vs
config final yang dibaca Spring Boot
vs
property yang dioverride profile
vs
secret file yang dimount
```

Untuk Spring Boot, env bisa menjadi property lewat relaxed binding.

Contoh:

```bash
SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/app
SERVER_PORT=8080
MANAGEMENT_SERVER_PORT=8081
```

Masalah umum:

```text
env typo
wrong profile
.env Compose tidak seperti shell env
variable interpolation terjadi di Compose host side
secret file path salah
ARG dikira runtime ENV
ENV image dioverride runtime
```

Debug Spring Boot:

```bash
docker logs myapp | grep -i "profiles"
docker exec myapp printenv | sort
```

Jika Actuator env endpoint tersedia, gunakan hati-hati karena bisa mengekspos secret. Jangan aktifkan sembarangan di production.

---

## 15. Process Debugging

Cek proses:

```bash
docker top myapp
docker exec myapp ps aux
```

Jika `ps` tidak ada:

```bash
docker debug myapp
```

Yang dicari:

```text
PID 1 process apa?
Apakah Java menjadi PID 1?
Apakah wrapper shell menjadi PID 1?
Apakah ada zombie process?
Apakah child process masih hidup setelah parent mati?
Apakah command runtime sesuai image expectation?
```

Cek entrypoint/cmd:

```bash
docker inspect myapp --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker inspect myapp --format '{{json .Path}} {{json .Args}}'
```

Common failure:

```dockerfile
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

Masalah:

- shell menjadi PID 1
- signal bisa tidak diteruskan benar
- quoting env susah
- command injection risk jika input tidak terkendali
- observability process lebih kabur

Lebih baik:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Atau wrapper script yang benar:

```sh
#!/usr/bin/env sh
set -eu
exec java ${JAVA_OPTS:-} -jar /app/app.jar
```

---

## 16. Java-Specific Runtime Debugging

Java punya tooling observability sendiri.

Jika JDK tools tersedia:

```bash
docker exec myapp jcmd
docker exec myapp jcmd 1 VM.flags
docker exec myapp jcmd 1 VM.system_properties
docker exec myapp jcmd 1 GC.heap_info
docker exec myapp jcmd 1 Thread.print
```

Jika app process PID bukan 1:

```bash
docker top myapp
docker exec myapp jcmd <pid> Thread.print
```

### 16.1 Thread dump

```bash
docker exec myapp jcmd 1 Thread.print > thread-dump.txt
```

Use case:

- request hang
- deadlock
- connection pool starvation
- thread pool exhaustion
- blocking IO
- lock contention

### 16.2 Heap dump

```bash
docker exec myapp jcmd 1 GC.heap_dump /tmp/heapdump.hprof
docker cp myapp:/tmp/heapdump.hprof ./heapdump.hprof
```

Perhatikan:

- heap dump butuh disk space
- bisa freeze aplikasi
- mengandung sensitive data
- jangan tinggalkan di container/volume production
- path harus writable

### 16.3 JVM flags

```bash
docker exec myapp jcmd 1 VM.flags
docker exec myapp jcmd 1 VM.command_line
```

Cari:

```text
MaxRAMPercentage
InitialRAMPercentage
Xmx/Xms
ActiveProcessorCount
GC selected
HeapDumpOnOutOfMemoryError
ExitOnOutOfMemoryError
UseContainerSupport
```

### 16.4 Native memory

Jika NMT aktif:

```bash
docker exec myapp jcmd 1 VM.native_memory summary
```

Kalau tidak aktif, perlu JVM flag:

```text
-XX:NativeMemoryTracking=summary
```

Tidak semua diagnostic bisa diaktifkan setelah proses berjalan.

---

## 17. Debugging OOM dan Exit 137

Exit 137 sering berarti proses menerima SIGKILL. Dalam konteks container, sering berhubungan dengan OOM kill, meski tidak selalu.

Checklist:

```bash
docker ps -a
docker inspect myapp --format '{{json .State}}'
docker inspect myapp --format '{{.State.OOMKilled}}'
docker inspect myapp --format '{{.State.ExitCode}}'
docker stats --no-stream myapp
docker logs --tail 200 myapp
```

Interpretasi:

```text
.State.OOMKilled=true
  -> kernel/Docker melihat container kena OOM kill

Java OutOfMemoryError di log
  -> JVM mendeteksi OOM internal sebelum container dibunuh

Exit 137 tanpa Java OOM log
  -> proses kemungkinan dibunuh dari luar / OOM native / SIGKILL
```

Container memory harus memuat:

```text
heap
+ metaspace
+ thread stacks
+ direct buffers
+ code cache
+ native memory
+ GC structures
+ mmap
+ agent/profiler overhead
+ libc/native dependency
```

Debug action:

```bash
docker inspect myapp --format '{{.HostConfig.Memory}}'
docker exec myapp jcmd 1 GC.heap_info
docker exec myapp jcmd 1 VM.flags
docker exec myapp jcmd 1 Thread.print
```

Design fix:

- kurangi heap percentage
- batasi direct memory bila perlu
- review thread count
- review buffer usage
- aktifkan heap dump on OOM dengan path aman
- set container memory dengan headroom
- gunakan `-XX:+ExitOnOutOfMemoryError` untuk fail fast jika sesuai

---

## 18. Debugging Startup Failure

Gejala:

```text
container exits immediately
container logs kosong
container restart loop
container status Exited (0)
container status Exited (1)
```

Checklist:

```bash
docker ps -a
docker logs <container>
docker inspect <container> --format '{{json .State}}'
docker inspect <container> --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
docker inspect <container> --format '{{.Config.WorkingDir}}'
```

Common root causes:

```text
wrong command
missing jar
wrong workdir
file permission
exec format error
shell missing
env required but missing
config file not mounted
secret not mounted
DB unavailable and app exits
migration failure
port conflict inside app
```

Untuk inspect image tanpa start app:

```bash
docker image inspect myapp:tag
docker run --rm --entrypoint ls myapp:tag -la /app
docker run --rm --entrypoint env myapp:tag
```

Jika image distroless tidak punya `ls/env`, gunakan debug mechanism atau build debug variant.

---

## 19. Debugging Healthcheck Failure

Container bisa `Up` tetapi `unhealthy`.

Cek:

```bash
docker inspect myapp --format '{{json .State.Health}}'
```

Lihat:

```text
Status
FailingStreak
Log[].ExitCode
Log[].Output
```

Common failure:

```text
health command tidak ada di image
curl/wget missing
endpoint salah
management port berbeda
healthcheck start terlalu cepat
healthcheck timeout terlalu pendek
dependency check terlalu strict
health endpoint butuh auth
container network path berbeda dari host path
```

Contoh:

```dockerfile
HEALTHCHECK CMD curl -f http://localhost:8080/actuator/health || exit 1
```

Jika image tidak punya `curl`, healthcheck akan gagal meski app sehat.

Alternatif:

- gunakan binary/app internal health command
- gunakan Java/Spring Boot health endpoint dengan tool tersedia
- gunakan Compose healthcheck dengan image yang memang punya tool
- jangan membuat production image besar hanya demi `curl` tanpa pertimbangan

---

## 20. Debugging Permission dan Security Policy

Gejala:

```text
permission denied
operation not permitted
read-only file system
cannot bind privileged port
cannot create file
cannot change ownership
ptrace not permitted
```

Cek:

```bash
docker inspect myapp --format '{{.Config.User}}'
docker inspect myapp --format '{{json .HostConfig.SecurityOpt}}'
docker inspect myapp --format '{{json .HostConfig.CapDrop}}'
docker inspect myapp --format '{{json .HostConfig.CapAdd}}'
docker inspect myapp --format '{{.HostConfig.ReadonlyRootfs}}'
docker exec myapp id
```

Common causes:

```text
USER non-root tidak punya write permission
read-only root filesystem
capability di-drop
seccomp block syscall
AppArmor/SELinux denial
bind mount owner salah
privileged port <1024
tmp directory tidak writable
```

Java-specific:

```text
java.io.tmpdir tidak writable
heap dump path tidak writable
JFR output path tidak writable
truststore file unreadable
certificate mount readonly tapi path salah
logback file appender tidak bisa create file
```

Better design:

- explicit writable dirs
- `tmpfs` untuk `/tmp`
- named volume untuk mutable state
- non-root user dengan ownership tepat
- avoid privileged mode
- drop capabilities only after testing app behavior
- read-only rootfs plus writable mounted paths

---

## 21. Debugging Image Identity

Salah satu masalah production paling menjengkelkan:

```text
"Katanya sudah deploy versi baru, tapi behavior masih lama."
```

Cek:

```bash
docker inspect myapp --format '{{.Image}}'
docker inspect myapp --format '{{.Config.Image}}'
docker image inspect <image> --format '{{json .RepoTags}} {{json .RepoDigests}}'
docker image inspect <image> --format '{{.Id}} {{.Created}}'
```

Bedakan:

```text
.Config.Image = reference yang digunakan saat create container
.Image        = image ID content aktual
RepoTags      = tag lokal
RepoDigests   = registry digest reference
```

Jika deploy pakai mutable tag seperti `latest`, container lama tidak otomatis berubah.

Container yang sudah dibuat tetap memakai image ID tertentu.

Untuk memastikan:

```bash
docker pull myrepo/myapp:prod
docker image inspect myrepo/myapp:prod
docker inspect running-container
```

Production policy yang lebih baik:

```text
deploy by digest or immutable version tag
record image digest in label
record git commit SHA in label
record build timestamp in label
record source repo in label
```

---

## 22. Debugging Stopped Containers

`docker exec` tidak bisa pada container yang sudah berhenti. Tetapi banyak fakta masih bisa dibaca:

```bash
docker inspect dead-container
docker logs dead-container
docker cp dead-container:/path/file ./file
docker diff dead-container
```

Docker `cp` dapat bekerja pada container running maupun stopped.

Gunakan untuk mengambil:

- crash artifact
- generated config
- heap dump jika sempat dibuat
- internal log file
- temp output

Jika ingin menjalankan command terhadap image:

```bash
docker run --rm --entrypoint sh myimage
```

Jika shell tidak ada, gunakan debug tool atau debug variant image.

---

## 23. Jangan `docker commit` sebagai Solusi Normal

`docker commit` bisa membuat image dari perubahan container.

Tapi untuk engineering discipline, ini hampir selalu anti-pattern untuk aplikasi.

Kenapa?

```text
- perubahan tidak ada di source control
- tidak reproducible
- sulit diaudit
- sulit direview
- sulit discan
- memutus pipeline
- menyembunyikan root cause
```

Gunakan `docker commit` hanya untuk:

- eksperimen lokal sementara
- forensic snapshot
- training
- kasus emergency yang sangat terkontrol

Bukan untuk:

- hotfix production normal
- membuat release
- menyimpan config manual
- patch dependency manual
- memperbaiki permission secara langsung di container

Perbaikan sejati harus masuk ke:

```text
Dockerfile
source code
configuration
Compose/deployment manifest
CI pipeline
base image policy
runtime option
```

---

## 24. Debugging dengan `nsenter` dari Host

Pada Linux host, advanced debugging bisa dilakukan dengan masuk namespace process container via host.

Flow umum:

```bash
docker inspect myapp --format '{{.State.Pid}}'
```

Misal PID host = `12345`.

Lalu:

```bash
sudo nsenter -t 12345 -n ip addr
sudo nsenter -t 12345 -n ss -ltnp
sudo nsenter -t 12345 -m ls -la /
sudo nsenter -t 12345 -p ps aux
```

Makna:

```text
-n network namespace
-m mount namespace
-p pid namespace
-u uts namespace
-i ipc namespace
```

Kapan berguna?

- image minimal tidak punya tool
- `docker exec` tidak mungkin
- perlu inspect network namespace dengan host tools
- emergency production debugging
- low-level runtime issue

Risiko:

- butuh privilege host
- bisa melanggar security boundary
- tidak portable ke Docker Desktop dengan VM abstraction
- harus diaudit
- salah command bisa mengubah state

Untuk engineer aplikasi, pahami konsepnya; gunakan dengan governance yang benar.

---

## 25. Debugging Compose Environment

Compose menambah layer:

```text
project
services
networks
volumes
profiles
env files
override files
depends_on
healthcheck
```

Commands:

```bash
docker compose ps
docker compose logs
docker compose logs -f myapp
docker compose config
docker compose events
docker compose exec myapp sh
docker compose top
```

### 25.1 `docker compose config`

Ini sangat penting.

```bash
docker compose config
```

Gunanya melihat hasil final setelah:

- variable interpolation
- multiple files merge
- profiles
- default values
- env substitution

Banyak bug Compose berasal dari asumsi file YAML, bukan final config.

### 25.2 Compose service name

Dalam Compose:

```yaml
services:
  api:
    image: myapp
  postgres:
    image: postgres
```

Dari `api`, akses DB via:

```text
postgres:5432
```

Bukan:

```text
localhost:5432
```

### 25.3 Stale volume

Gejala:

```text
migration tidak jalan
schema lama
data lama
config lama
user/password lama
```

Debug:

```bash
docker volume ls
docker compose down
docker compose down -v
```

Hati-hati: `down -v` menghapus volume Compose terkait.

---

## 26. Debugging Checklist Berdasarkan Gejala

### 26.1 Container tidak muncul

```bash
docker ps -a
docker images
docker compose ps
docker compose config
```

Kemungkinan:

```text
create gagal
image pull gagal
Compose profile tidak aktif
service tidak didefinisikan dalam final config
nama project berbeda
```

### 26.2 Container exited langsung

```bash
docker logs <container>
docker inspect <container> --format '{{json .State}}'
docker inspect <container> --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'
```

Kemungkinan:

```text
command selesai normal
missing env
missing file
wrong entrypoint
permission denied
app startup validation gagal
```

### 26.3 Container running tapi tidak bisa diakses dari host

```bash
docker ps
docker inspect <container> --format '{{json .NetworkSettings.Ports}}'
curl localhost:<host-port>
```

Kemungkinan:

```text
port tidak dipublish
host port salah
app bind 127.0.0.1
firewall
Docker Desktop networking nuance
```

### 26.4 Container bisa dari host tapi tidak dari container lain

```bash
docker network inspect <network>
docker run --rm --network <network> curlimages/curl curl -v http://service:port
```

Kemungkinan:

```text
beda network
service name salah
app bind address salah
internal port salah
DNS issue
```

### 26.5 Container unhealthy

```bash
docker inspect <container> --format '{{json .State.Health}}'
docker logs <container>
```

Kemungkinan:

```text
health command missing
endpoint wrong
timeout too short
dependency check too strict
management port wrong
auth required
```

### 26.6 Permission denied

```bash
docker inspect <container> --format '{{.Config.User}}'
docker inspect <container> --format '{{json .Mounts}}'
docker exec <container> id
```

Kemungkinan:

```text
UID mismatch
bind mount owner
read-only rootfs
missing writable dir
capability/security policy
```

### 26.7 Exit 137

```bash
docker inspect <container> --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
docker logs <container> --tail 200
docker stats --no-stream <container>
```

Kemungkinan:

```text
container OOM
manual kill -9
orchestrator/daemon kill
JVM native memory pressure
heap too large for container
```

### 26.8 Image minimal tidak bisa di-debug

```bash
docker debug <container>
docker run --rm -it --network <network> nicolaka/netshoot
docker cp <container>:/path ./path
```

Kemungkinan:

```text
shell missing by design
debug tooling intentionally absent
need debug sidecar/toolbox
```

---

## 27. Case Study 1: Spring Boot Running, Host Cannot Access

Gejala:

```bash
docker ps
# Up 2 minutes, 0.0.0.0:8080->8080/tcp

curl http://localhost:8080/actuator/health
# connection reset / connection refused
```

Debug:

```bash
docker logs myapp --tail 100
docker inspect myapp --format '{{json .NetworkSettings.Ports}}'
docker exec myapp printenv | grep SERVER
docker exec myapp ss -ltnp
```

Findings:

```text
App listens on 127.0.0.1:8080 inside container
```

Root cause:

```properties
server.address=127.0.0.1
```

Fix:

```properties
server.address=0.0.0.0
```

Mental model:

```text
Port publish maps host -> container network interface.
If app only listens on loopback inside container, external traffic cannot reach it.
```

---

## 28. Case Study 2: Java Service OOMKilled Without Java OOM Stack Trace

Gejala:

```bash
docker ps -a
# Exited (137)

docker logs myapp
# no OutOfMemoryError
```

Debug:

```bash
docker inspect myapp --format '{{json .State}}'
docker inspect myapp --format '{{.HostConfig.Memory}}'
docker inspect myapp --format '{{json .Config.Env}}'
```

Findings:

```text
Memory limit: 536870912
JAVA_TOOL_OPTIONS=-Xmx512m
State.OOMKilled=true
```

Root cause:

```text
Heap mengambil hampir seluruh memory limit.
Native memory tidak punya headroom.
```

Fix:

```text
Use MaxRAMPercentage lower than total container memory.
Reserve native headroom.
Reduce thread count/direct buffers if needed.
```

Example:

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+ExitOnOutOfMemoryError"
```

---

## 29. Case Study 3: Healthcheck Fails in Distroless Image

Dockerfile:

```dockerfile
FROM gcr.io/distroless/java21-debian12
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
HEALTHCHECK CMD curl -f http://localhost:8080/actuator/health || exit 1
```

Gejala:

```text
container runs, app reachable, health status unhealthy
```

Debug:

```bash
docker inspect myapp --format '{{json .State.Health}}'
```

Health output:

```text
curl: not found
```

Root cause:

```text
Healthcheck depends on tool not present in minimal image.
```

Fix options:

```text
- use base image with required health tool
- add tiny healthcheck binary
- use app-native health command
- externalize healthcheck at orchestrator/proxy layer
- avoid distroless if operational policy requires shell/curl
```

Trade-off:

```text
Minimal image reduces attack surface, but debugging/health tooling must be designed explicitly.
```

---

## 30. Case Study 4: Compose App Cannot Reach PostgreSQL

Spring config:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

Compose:

```yaml
services:
  api:
    build: .
    depends_on:
      - postgres

  postgres:
    image: postgres:16
```

Gejala:

```text
Connection refused to localhost:5432
```

Debug:

```bash
docker compose logs api
docker compose exec api printenv
docker compose ps
docker compose config
```

Root cause:

```text
Inside api container, localhost means api container itself.
Postgres runs in another container.
```

Fix:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

Additional fix:

```yaml
depends_on:
  postgres:
    condition: service_healthy
```

With postgres healthcheck if needed.

---

## 31. Case Study 5: File Exists in Image But Missing at Runtime

Dockerfile:

```dockerfile
COPY application.yml /app/config/application.yml
```

Run:

```bash
docker run -v ./config:/app/config myapp
```

Host:

```bash
ls ./config
# empty
```

Gejala:

```text
Application cannot find /app/config/application.yml
```

Debug:

```bash
docker inspect myapp --format '{{json .Mounts}}'
docker diff myapp
```

Root cause:

```text
Bind mount overlays /app/config, hiding file from image.
```

Fix:

```text
- mount exact file, not directory
- put default config elsewhere
- generate .env.example/config template
- validate config at startup with clear error
```

---

## 32. How to Design for Debuggability Before Incident

Debuggability bukan fitur belakangan.

Production Docker image/service harus punya:

```text
1. clear labels
   org.opencontainers.image.revision
   org.opencontainers.image.source
   org.opencontainers.image.version

2. predictable logs
   stdout/stderr
   structured JSON if appropriate
   request correlation id

3. health endpoints
   liveness
   readiness
   startup behavior

4. graceful shutdown
   SIGTERM handling
   timeout known

5. resource visibility
   JVM flags visible
   heap/native headroom
   metrics endpoint

6. writable paths explicit
   /tmp
   heap dump dir
   report dir
   upload dir

7. non-root user with correct ownership

8. debug strategy
   debug image
   Docker Debug
   sidecar toolbox
   documented commands

9. config validation
   fail fast on missing required env/secret
   clear startup error

10. immutable identity
   digest
   commit SHA
   build metadata
```

---

## 33. Debugging Discipline: What Not to Do

Avoid:

```text
- SSH into container as normal operation
- apt install tools in running production container
- manually edit config inside container
- docker commit production hotfix
- ignore image digest
- debug as root when app runs non-root
- assume container localhost is host localhost
- assume running means healthy
- assume unhealthy means process dead
- assume Java OOM equals container OOM
- assume tag name identifies image content
- assume Compose YAML is final runtime config
```

---

## 34. Senior Engineer Debugging Pattern

A senior engineer does not ask:

```text
"How do I get inside the container?"
```

They ask:

```text
"What boundary is failing?"
```

Boundary map:

```text
Source/build boundary:
  wrong artifact, wrong jar, wrong dependency

Image boundary:
  wrong base image, missing file, wrong user, missing tool

Container config boundary:
  env, command, workdir, mounts, ports, resources

Process boundary:
  PID 1, signal handling, JVM, thread, heap, startup

Filesystem boundary:
  volume, bind mount, tmp, permission, readonly

Network boundary:
  port, DNS, service discovery, bind address, bridge

Security boundary:
  user, capability, seccomp, AppArmor, SELinux

Host/runtime boundary:
  Docker daemon, disk, CPU, memory, image cache, logging driver

External dependency boundary:
  DB, broker, API, TLS, credential, DNS
```

Then they choose the smallest observation that proves or disproves a hypothesis.

---

## 35. Practical Command Cheat Sheet

### Container fact

```bash
docker ps -a
docker inspect <container>
docker inspect <container> --format '{{json .State}}'
docker inspect <container> --format '{{json .Config}}'
docker inspect <container> --format '{{json .HostConfig}}'
docker inspect <container> --format '{{json .NetworkSettings}}'
```

### Logs/events

```bash
docker logs --tail 200 <container>
docker logs --since 30m --timestamps <container>
docker events --since 30m --filter container=<container>
```

### Runtime resource

```bash
docker stats <container>
docker stats --no-stream <container>
docker top <container>
```

### Filesystem

```bash
docker diff <container>
docker cp <container>:/path ./path
docker inspect <container> --format '{{json .Mounts}}'
```

### Exec

```bash
docker exec <container> env
docker exec -it <container> sh
docker exec --user <uid> -it <container> sh
docker exec <container> pwd
```

### Network

```bash
docker network ls
docker network inspect <network>
docker inspect <container> --format '{{json .NetworkSettings.Networks}}'
docker inspect <container> --format '{{json .NetworkSettings.Ports}}'
```

### Java

```bash
docker exec <container> jcmd
docker exec <container> jcmd 1 VM.flags
docker exec <container> jcmd 1 VM.command_line
docker exec <container> jcmd 1 GC.heap_info
docker exec <container> jcmd 1 Thread.print
docker exec <container> jcmd 1 GC.heap_dump /tmp/heapdump.hprof
docker cp <container>:/tmp/heapdump.hprof ./heapdump.hprof
```

### Compose

```bash
docker compose ps
docker compose logs --tail 200
docker compose logs -f <service>
docker compose config
docker compose events
docker compose exec <service> sh
docker compose top
docker compose down -v
```

---

## 36. Mini Lab: Debugging a Broken Java Container

### Scenario

A Spring Boot service fails in container but works locally.

Given:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Run:

```bash
docker run --name api \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/app \
  -p 8080:8080 \
  --memory=512m \
  api:local
```

Failure:

```text
Application fails to connect to database.
```

### Debug sequence

```bash
docker ps -a
docker logs api --tail 100
docker inspect api --format '{{json .Config.Env}}'
docker inspect api --format '{{json .NetworkSettings.Ports}}'
docker inspect api --format '{{json .State}}'
```

Interpretation:

```text
Database URL points to localhost.
Inside container, localhost is api container.
Database is not there.
```

Correct approach:

Run DB in same network:

```bash
docker network create appnet

docker run -d --name postgres \
  --network appnet \
  -e POSTGRES_DB=app \
  -e POSTGRES_USER=app \
  -e POSTGRES_PASSWORD=secret \
  postgres:16

docker run --rm --name api \
  --network appnet \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/app \
  -p 8080:8080 \
  --memory=512m \
  api:local
```

Then debug:

```bash
docker run --rm -it --network appnet nicolaka/netshoot
curl -v http://api:8080/actuator/health
dig postgres
```

---

## 37. Production Debugging Decision Tree

```text
Incident: service unavailable

1. Is container running?
   no  -> inspect state, logs, exit code, restart policy
   yes -> continue

2. Is it healthy?
   no  -> inspect health output
   yes -> continue

3. Is app reachable inside container?
   no  -> process/app/config issue
   yes -> continue

4. Is app reachable from same Docker network?
   no  -> bind address/network/DNS issue
   yes -> continue

5. Is app reachable from host/load balancer?
   no  -> port publishing/firewall/proxy issue
   yes -> continue

6. Are dependencies reachable from app container?
   no  -> DNS/credential/TLS/network/dependency readiness
   yes -> continue

7. Are resources constrained?
   yes -> CPU/memory/thread/IO diagnosis
   no  -> app-level diagnosis

8. Is image identity correct?
   no  -> deploy/tag/digest issue
   yes -> continue

9. Is config identity correct?
   no  -> env/secret/mount/profile issue
   yes -> deeper application tracing
```

---

## 38. Key Takeaways

1. Debugging container yang baik dimulai dari fakta runtime, bukan dari masuk shell.
2. `docker inspect` adalah sumber informasi paling kaya untuk container configuration dan state.
3. `docker exec` berguna, tetapi bisa misleading jika user, workdir, shell, atau runtime state berbeda dari proses utama.
4. Image minimal/distroless mengharuskan strategi debug eksplisit.
5. Jangan memperbesar production image hanya karena ingin nyaman debugging.
6. Gunakan debug container, Docker Debug, debug image variant, atau host namespace inspection sesuai konteks.
7. Docker network harus diuji dari tiga perspektif: inside container, same network container, dan host.
8. `localhost` di container bukan host dan bukan service lain.
9. Java debugging harus melihat heap dan native memory, bukan heap saja.
10. Container yang sudah berhenti masih bisa diinspect, dilihat logs-nya, di-diff, dan di-copy artifact-nya.
11. Jangan menjadikan `docker commit`, manual edit, atau install tool dalam container sebagai normal operation.
12. Debuggability harus dirancang sebelum incident.

---

## 39. Referensi

- Docker CLI Reference — `docker inspect`: https://docs.docker.com/reference/cli/docker/inspect/
- Docker CLI Reference — `docker container`: https://docs.docker.com/reference/cli/docker/container/
- Docker CLI Reference — `docker container exec`: https://docs.docker.com/reference/cli/docker/container/exec/
- Docker CLI Reference — `docker container logs`: https://docs.docker.com/reference/cli/docker/container/logs/
- Docker CLI Reference — `docker container cp`: https://docs.docker.com/reference/cli/docker/container/cp/
- Docker CLI Reference — `docker debug`: https://docs.docker.com/reference/cli/docker/debug/
- Docker Hardened Images — Troubleshoot: https://docs.docker.com/dhi/troubleshoot/
- Docker Hardened Images — Minimal or distroless images: https://docs.docker.com/dhi/core-concepts/distroless/
- Docker Compose CLI Reference: https://docs.docker.com/reference/cli/docker/compose/
- Spring Boot Actuator and production readiness documentation: https://docs.spring.io/spring-boot/reference/actuator/endpoints.html

---

## 40. Penutup

Part ini adalah jembatan dari teori container ke operational skill.

Setelah memahami debugging running container, part berikutnya akan membahas Docker untuk automated testing:

```text
learn-docker-mastery-for-java-engineers-part-023.md
```

Fokus berikutnya:

```text
Docker for Automated Testing: Integration Test, Testcontainers, Ephemeral Infra
```

Kita akan membahas bagaimana Docker dipakai untuk membuat test Java lebih realistis tanpa membuat test suite lambat, flaky, atau bergantung pada environment lokal developer.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Logging and Diagnostics: stdout, stderr, Drivers, Crash Forensics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-023.md">Part 023 — Docker for Automated Testing: Integration Test, Testcontainers, Ephemeral Infra ➡️</a>
</div>
