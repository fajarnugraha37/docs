# learn-docker-mastery-for-java-engineers-part-002.md

# Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `002 / 031`  
> Fokus: memahami arsitektur Docker dari command-level sampai container process benar-benar berjalan.  
> Target pembaca: Java software engineer yang ingin memahami Docker sebagai runtime platform, bukan sekadar kumpulan command.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 000 kita membangun orientasi bahwa Docker bukan “mini VM”, melainkan cara mengemas dan menjalankan proses dengan boundary tertentu.

Pada Part 001 kita membahas mental model container sebagai proses biasa yang diberi boundary oleh mekanisme kernel seperti namespace, cgroup, dan filesystem isolation.

Part 002 ini menjawab pertanyaan berikut:

> Ketika kita menjalankan `docker run`, siapa sebenarnya yang menerima perintah, siapa yang menarik image, siapa yang membuat container, siapa yang menjalankan proses, dan siapa yang menjaga container tersebut tetap tercatat sebagai objek Docker?

Ini penting karena banyak debugging Docker gagal bukan karena engineer tidak tahu command, tetapi karena mereka salah menebak **lapisan mana yang sedang bermasalah**.

Contoh:

```bash
docker run nginx
```

Dari luar terlihat seperti satu command sederhana. Secara internal, command ini bisa melibatkan:

- Docker CLI
- Docker Engine API
- Docker daemon (`dockerd`)
- image store
- registry
- network driver
- volume driver
- container runtime
- OCI runtime
- host kernel

Kalau container gagal start, penyebabnya bisa berada di banyak lapisan:

- CLI tidak bisa bicara ke daemon
- daemon tidak berjalan
- permission ke Docker socket ditolak
- registry tidak bisa diakses
- image manifest tidak cocok dengan architecture host
- image layer corrupt
- volume mount gagal
- port host sudah dipakai
- runtime gagal membuat namespace
- process di container langsung exit
- app Java crash karena memory, config, signal, atau permission

Part ini membangun peta mental agar kamu bisa membedakan semua itu.

---

## 1. Docker Architecture dalam Satu Kalimat

Docker Engine adalah aplikasi client-server untuk membuat dan menjalankan container.

Secara konseptual:

```text
User
  |
  v
docker CLI
  |
  v
Docker API
  |
  v
dockerd
  |
  +--> image management
  +--> container metadata
  +--> network management
  +--> volume management
  +--> build coordination
  +--> runtime orchestration
           |
           v
        containerd
           |
           v
     containerd-shim
           |
           v
          runc
           |
           v
       Linux kernel
           |
           v
   containerized process
```

Docker documentation mendeskripsikan Docker Engine sebagai client-server application yang terdiri dari:

- long-running daemon process bernama `dockerd`
- API untuk berkomunikasi dengan daemon
- command line interface bernama `docker`

Jadi ketika kamu menjalankan command Docker, kamu biasanya tidak langsung menjalankan container. Kamu mengirim instruksi ke daemon.

---

## 2. Komponen Utama Docker

## 2.1 Docker CLI

Docker CLI adalah command-line client yang kamu pakai sehari-hari:

```bash
docker run
docker build
docker ps
docker logs
docker inspect
docker exec
docker stop
docker compose up
```

Tugas CLI:

- membaca argumen command
- memvalidasi sebagian input
- mengubah command menjadi request ke Docker API
- mengirim request ke Docker daemon
- menampilkan response daemon ke terminal

CLI bukan tempat container “hidup”.

Kalau CLI kamu tutup, container tidak otomatis mati, kecuali kamu menjalankan container secara attached dan mengirim signal tertentu ke prosesnya.

Contoh:

```bash
docker run -d nginx
```

Setelah command selesai, CLI keluar. Container tetap berjalan karena lifecycle-nya dikelola daemon/runtime, bukan terminal CLI.

### Mental model

```text
docker CLI = remote control
dockerd    = control plane
container  = workload process
```

Kesalahan umum:

> “Saya sudah close terminal, kenapa container masih jalan?”

Karena terminal hanya client. Container berjalan sebagai proses di host, dikelola oleh runtime.

---

## 2.2 Docker API

Docker API adalah interface yang digunakan CLI dan tool lain untuk berkomunikasi dengan daemon.

CLI hanyalah salah satu client. Client lain bisa berupa:

- Docker Desktop UI
- Compose
- SDK
- CI agent
- IDE plugin
- custom automation
- remote management tool

Secara default di Linux, CLI biasanya bicara ke Docker daemon melalui Unix socket:

```text
/var/run/docker.sock
```

Contoh konseptual:

```text
docker ps
  -> HTTP-like request ke Docker API
  -> daemon membaca metadata container
  -> daemon mengembalikan list container
  -> CLI menampilkan tabel
```

Docker socket sangat sensitif. Akses ke socket ini pada umumnya setara dengan kemampuan mengontrol Docker daemon, yang sering berarti kemampuan sangat tinggi terhadap host.

Karena itu, mounting socket ke container adalah operasi berisiko:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

Itu bukan “sekadar memberi akses Docker”. Itu memberi container kemampuan menginstruksikan daemon host.

---

## 2.3 Docker Daemon (`dockerd`)

`dockerd` adalah server utama Docker Engine.

Tanggung jawab `dockerd` meliputi:

- menerima Docker API request
- mengelola image
- mengelola container metadata
- mengelola network Docker
- mengelola volume
- mengatur build
- berkomunikasi dengan registry
- mendelegasikan eksekusi container ke runtime
- menyimpan state Docker di host

Secara default, data Docker di Linux berada di:

```text
/var/lib/docker
```

Di sana Docker menyimpan banyak hal seperti:

- image/layer metadata
- container metadata
- writable layer container
- volume
- network state
- build cache tertentu

Penting:

> Jangan memperlakukan `/var/lib/docker` sebagai direktori aplikasi biasa yang bebas diedit manual.

Mengubah isi direktori ini langsung tanpa memahami Docker storage model bisa merusak state Docker.

---

## 2.4 Docker Engine

Docker Engine bukan satu binary tunggal dalam mental model pengguna. Ia adalah paket teknologi yang mencakup:

- daemon
- API
- CLI
- integrasi runtime
- object model Docker

Ketika orang berkata “install Docker Engine”, biasanya yang dimaksud adalah runtime Docker server-side untuk build dan run container.

Di Docker Desktop, Docker Engine tersedia di balik environment Desktop.

Di Linux server, Docker Engine biasanya berjalan langsung sebagai service systemd:

```bash
systemctl status docker
```

---

## 2.5 containerd

`containerd` adalah container runtime yang lebih rendah levelnya daripada Docker daemon.

Docker menggunakan containerd untuk lifecycle container dan image management tertentu. containerd sendiri adalah project independen yang umum digunakan di banyak container platform.

Tanggung jawab containerd secara konseptual:

- pull/push image
- manage image content
- create container
- start container task
- supervise container task
- manage snapshot
- interact dengan OCI runtime
- expose API runtime yang lebih rendah level

Docker daemon tetap menyediakan pengalaman Docker-level: CLI, API, network, volume, Compose integration, build workflow, dan Docker object model.

containerd lebih dekat ke runtime lifecycle.

### Analogi

```text
Docker CLI     = remote control
dockerd        = product-level manager
containerd     = runtime supervisor
runc           = low-level process creator
Linux kernel   = actual isolation enforcer
```

---

## 2.6 containerd-shim

`containerd-shim` adalah proses perantara antara containerd dan container process.

Kenapa shim dibutuhkan?

Secara sederhana, shim membantu:

- menjaga container tetap hidup walaupun containerd restart
- menghubungkan stdio/log stream
- menyimpan exit status
- menjadi parent/supervisor dekat untuk process container
- mengurangi coupling langsung container process ke containerd daemon

Mental model:

```text
containerd
  |
  v
containerd-shim
  |
  v
container process
```

Dalam debugging host-level, kamu mungkin melihat proses seperti:

```bash
ps aux | grep containerd-shim
```

Ini normal.

---

## 2.7 runc

`runc` adalah OCI runtime default yang digunakan Docker Engine untuk benar-benar membuat container process.

`runc` bekerja dekat dengan kernel.

Tanggung jawab konseptual runc:

- membaca OCI runtime specification
- membuat namespace
- menerapkan cgroup
- setup mount
- setup root filesystem
- apply capabilities/seccomp/AppArmor/SELinux config
- menjalankan process container

Setelah process berjalan, `runc` biasanya tidak terus menjadi long-running daemon untuk container tersebut. Ia lebih seperti executor low-level.

Docker documentation menyebut Docker Engine menggunakan `runc` sebagai default container runtime, walaupun runtime alternatif bisa dikonfigurasi.

---

## 2.8 Registry

Registry adalah tempat image disimpan dan didistribusikan.

Contoh registry:

- Docker Hub
- GitHub Container Registry
- GitLab Container Registry
- Amazon ECR
- Google Artifact Registry
- Azure Container Registry
- private self-hosted registry

Ketika kamu menjalankan:

```bash
docker pull eclipse-temurin:21-jre
```

Docker perlu:

1. resolve registry
2. resolve repository
3. resolve tag
4. fetch manifest
5. memilih platform yang cocok
6. download layer yang belum ada lokal
7. verify content digest
8. store image content

Registry tidak menjalankan container. Registry hanya menyimpan image artifact.

---

## 3. Docker Object Model

Docker mengelola beberapa object utama.

```text
Image      = immutable template
Container  = runtime instance dari image
Volume     = managed persistent storage
Network    = communication boundary
Secret     = sensitive runtime material, tergantung mode/platform
Config     = non-secret runtime config, tergantung mode/platform
Context    = target Docker endpoint
Builder    = build backend/configuration
```

Untuk Part 002, fokusnya pada object runtime dasar:

```text
Image -> Container -> Process
```

Tapi container hampir selalu terkait juga dengan:

```text
Container
  +-- image
  +-- config
  +-- env
  +-- mounts
  +-- network
  +-- ports
  +-- labels
  +-- restart policy
  +-- healthcheck
  +-- log driver
```

Itulah sebabnya `docker inspect` sangat penting. Ia menunjukkan effective runtime configuration.

---

## 4. Apa yang Terjadi Saat `docker run`?

Command:

```bash
docker run --name demo -p 8080:8080 eclipse-temurin:21-jre java -version
```

Secara high-level:

```text
1. CLI parse command
2. CLI kirim request ke daemon
3. daemon cek image lokal
4. jika image belum ada, daemon pull dari registry
5. daemon create container metadata
6. daemon setup filesystem
7. daemon setup network
8. daemon setup mount
9. daemon setup port publishing
10. daemon minta containerd create/start task
11. containerd menggunakan shim dan runc
12. runc membuat isolated process
13. process berjalan
14. stdout/stderr diarahkan ke logging driver
15. daemon/metadata mencatat status container
16. process exit
17. exit code disimpan
```

Mari kita bedah.

---

## 4.1 Step 1 — CLI Parse Command

CLI membaca:

```bash
docker run --name demo -p 8080:8080 eclipse-temurin:21-jre java -version
```

Interpretasi:

```text
container name = demo
port mapping   = host 8080 -> container 8080
image          = eclipse-temurin:21-jre
command        = java -version
```

CLI tidak tahu apakah image ada lokal, apakah port tersedia, atau apakah process nanti berhasil. Itu dicek daemon/runtime.

---

## 4.2 Step 2 — CLI Menghubungi Docker Daemon

CLI mengirim request ke daemon melalui Docker API.

Jika daemon tidak berjalan, kamu akan melihat error sejenis:

```text
Cannot connect to the Docker daemon
```

Masalah ini bukan masalah image, bukan masalah Java, bukan masalah Dockerfile.

Ini masalah client-daemon connectivity.

Kemungkinan penyebab:

- service Docker mati
- user tidak punya permission ke Docker socket
- Docker context salah
- Docker Desktop belum running
- environment variable `DOCKER_HOST` salah
- remote daemon unreachable

---

## 4.3 Step 3 — Daemon Mengecek Image Lokal

Daemon memeriksa apakah image `eclipse-temurin:21-jre` tersedia lokal.

Command terkait:

```bash
docker images
docker image ls
docker image inspect eclipse-temurin:21-jre
```

Kalau image sudah ada, Docker bisa langsung lanjut create container.

Kalau belum ada, Docker akan pull.

---

## 4.4 Step 4 — Pull Image dari Registry

Jika image belum ada, Docker melakukan pull dari registry.

Default registry untuk nama image sederhana biasanya Docker Hub.

```bash
docker pull eclipse-temurin:21-jre
```

Yang sebenarnya diambil bukan hanya satu file besar. Docker mengambil manifest dan layer.

Kemungkinan failure:

```text
pull access denied
manifest not found
no matching manifest for linux/arm64
TLS handshake timeout
certificate signed by unknown authority
toomanyrequests: rate limit exceeded
network timeout
```

Diagnosis awal:

```bash
docker pull <image>
docker manifest inspect <image>
docker info
docker login
```

---

## 4.5 Step 5 — Create Container Metadata

Docker membuat objek container.

Container belum tentu langsung berjalan. Secara konsep, `docker run` melakukan create + start. Tapi command ini bisa dipisah:

```bash
docker create --name demo nginx
docker start demo
```

Metadata container meliputi:

- container ID
- name
- image reference
- command
- entrypoint
- environment
- mount
- network
- restart policy
- log config
- labels
- resource limits
- security options

Kamu bisa melihatnya dengan:

```bash
docker inspect demo
```

---

## 4.6 Step 6 — Setup Filesystem

Docker menyiapkan root filesystem container dari image layer.

Secara konseptual:

```text
base layer
  + dependency layer
  + app layer
  + container writable layer
```

Container mendapat writable layer sendiri.

Itulah sebabnya dua container dari image yang sama bisa punya perubahan filesystem berbeda.

```bash
docker run --name a image
docker run --name b image
```

`a` dan `b` berbagi image layer read-only, tetapi masing-masing punya writable layer.

---

## 4.7 Step 7 — Setup Network

Docker menghubungkan container ke network.

Default-nya biasanya network `bridge`, kecuali kamu menentukan lain.

Command terkait:

```bash
docker network ls
docker network inspect bridge
docker inspect <container>
```

Network setup bisa gagal jika:

- network tidak ditemukan
- IP pool konflik
- iptables/nftables bermasalah
- permission host bermasalah
- Docker Desktop networking layer bermasalah

---

## 4.8 Step 8 — Setup Mount dan Volume

Jika kamu memberikan mount:

```bash
docker run -v app-data:/data image
docker run -v "$PWD/config:/config:ro" image
```

Daemon harus menyiapkan mount tersebut.

Failure umum:

```text
permission denied
no such file or directory
not a directory
read-only file system
operation not permitted
```

Java implication:

- app tidak bisa menulis `/tmp`
- app tidak bisa membaca keystore
- app tidak bisa menulis log file
- app tidak bisa membuat upload directory
- UID container tidak cocok dengan owner file host

---

## 4.9 Step 9 — Setup Port Publishing

Option:

```bash
-p 8080:8080
```

Artinya:

```text
host port 8080 -> container port 8080
```

Failure umum:

```text
Bind for 0.0.0.0:8080 failed: port is already allocated
```

Ini bukan error aplikasi Java. Ini error host port allocation.

Diagnosis:

```bash
docker ps
docker port <container>
lsof -i :8080
ss -ltnp
```

---

## 4.10 Step 10 — Daemon Mendelegasikan ke containerd

Setelah konfigurasi Docker-level siap, daemon meminta containerd membuat dan menjalankan task container.

Di titik ini, failure mulai lebih dekat ke runtime/kernel.

Contoh failure:

```text
OCI runtime create failed
permission denied
operation not permitted
exec format error
no such file or directory
```

Failure ini sering berasal dari:

- entrypoint file tidak ada
- entrypoint bukan executable
- architecture image salah
- shebang script salah
- line ending Windows
- permission filesystem
- seccomp/AppArmor/capability denial
- user tidak punya akses

---

## 4.11 Step 11 — runc Membuat Container Process

`runc` menggunakan konfigurasi OCI untuk membuat process dengan boundary yang diminta.

Ia setup:

- namespace
- cgroup
- mount
- rootfs
- user
- capabilities
- seccomp
- working directory
- environment
- entrypoint/args

Kalau berhasil, process container benar-benar berjalan di host.

Penting:

> Container bukan objek abstrak yang hidup di cloud mistis. Pada akhirnya ia adalah proses host dengan isolation configuration.

---

## 4.12 Step 12 — Logging dan Exit Status

stdout/stderr process diarahkan ke logging driver Docker.

Default logging driver sering `json-file`, tapi bisa berbeda tergantung konfigurasi host.

Command:

```bash
docker logs <container>
```

Exit code disimpan pada metadata container.

Command:

```bash
docker ps -a
docker inspect <container> --format '{{.State.ExitCode}}'
```

Exit code penting:

```text
0    = process selesai sukses
1    = generic application failure
125  = Docker daemon/runtime error saat run
126  = command ditemukan tapi tidak bisa dieksekusi
127  = command tidak ditemukan
137  = biasanya SIGKILL, sering karena OOMKilled
143  = SIGTERM, sering graceful stop
```

---

## 5. Apa yang Terjadi Saat `docker build`?

Walaupun Part 006–008 akan membahas Dockerfile dan build lebih dalam, arsitektur build perlu dikenalkan di sini.

Command:

```bash
docker build -t myapp:dev .
```

High-level flow:

```text
1. CLI menentukan build context
2. CLI/BuildKit membaca Dockerfile
3. build context dikirim/diproses
4. builder membuat graph build
5. instruksi Dockerfile dieksekusi sebagai build step
6. layer/cache dibuat
7. final image disimpan di image store
8. tag diberikan ke image
```

Komponen yang terlibat:

- Docker CLI
- Docker daemon atau builder backend
- BuildKit
- image store
- registry jika ada pull base image
- filesystem snapshotter/storage driver

Build bukan runtime container biasa, tetapi banyak step build dieksekusi menggunakan mekanisme container-like isolation.

Contoh:

```dockerfile
RUN mvn package
```

Ini bukan command yang dijalankan di host shell kamu. Ini dieksekusi dalam build environment berdasarkan state image pada step tersebut.

---

## 6. Docker Desktop vs Docker Engine di Linux

Docker Desktop berbeda dari Docker Engine langsung di Linux server.

Di Linux server:

```text
docker CLI
  -> /var/run/docker.sock
  -> dockerd on same Linux host
  -> container process on same Linux host
```

Di macOS/Windows dengan Docker Desktop:

```text
docker CLI on macOS/Windows
  -> Docker Desktop integration
  -> Linux VM
  -> dockerd inside VM
  -> container process inside Linux VM
```

Implikasi:

- container Linux tidak berjalan langsung di kernel macOS
- filesystem bind mount melewati boundary host ↔ VM
- network behavior bisa berbeda
- resource limit dikontrol Docker Desktop
- path dan permission bisa berbeda
- `localhost` behavior kadang tampak “magis” karena Desktop membuat integrasi tambahan

Ini akan dibahas lebih dalam di Part 026. Untuk sekarang cukup pegang mental model:

> Di macOS/Windows, “host” dari perspektif container Linux sering kali adalah Linux VM milik Docker Desktop, bukan OS desktop secara langsung.

---

## 7. Docker Context

Docker context menentukan endpoint daemon yang sedang dikontrol CLI.

Command:

```bash
docker context ls
docker context use default
docker context inspect
```

Context bisa menunjuk ke:

- local Docker Engine
- Docker Desktop
- remote Docker host
- cloud integration tertentu

Masalah yang sering terjadi:

```text
Saya menjalankan docker ps, kok container saya hilang?
```

Bisa jadi kamu sedang memakai context berbeda.

Diagnosis:

```bash
docker context ls
docker info
```

Mental model:

```text
docker CLI tidak selalu bicara ke daemon lokal yang kamu kira.
```

---

## 8. Docker Daemon sebagai Privileged Control Plane

Docker daemon biasanya berjalan dengan privilege tinggi.

Kenapa?

Karena daemon perlu:

- membuat namespace
- membuat cgroup
- setup mount
- setup network
- mengatur iptables/nftables
- mount filesystem
- membuat device/mapping tertentu
- mengatur storage
- menjalankan runtime

Implikasi keamanan:

- user yang bisa mengontrol Docker daemon sering bisa mendapatkan akses host-level
- Docker socket harus dianggap sensitive
- CI runner dengan Docker access harus diperlakukan sebagai privileged environment
- container yang diberi akses ke Docker socket bisa membuat container lain dengan mount host filesystem

Contoh berbahaya secara konseptual:

```bash
docker run -v /:/host -it alpine sh
```

Jika user bisa menjalankan ini terhadap daemon host, user bisa membaca/mengubah banyak hal di host tergantung konfigurasi.

Ini alasan kenapa Docker group di Linux bukan sekadar permission ringan.

---

## 9. Rootless Docker

Rootless mode memungkinkan daemon dan container berjalan sebagai non-root user untuk mengurangi risiko dari vulnerability pada daemon atau runtime.

Namun rootless mode bukan silver bullet.

Trade-off rootless:

Kelebihan:

- mengurangi privilege daemon
- lebih aman untuk development atau multi-user tertentu
- mengurangi blast radius beberapa kelas exploit

Keterbatasan/potensi trade-off:

- networking behavior bisa berbeda
- port privileged bisa terbatas
- storage driver support bisa berbeda
- beberapa capability/feature tidak tersedia
- troubleshooting lebih kompleks
- performance bisa berbeda pada workload tertentu

Mental model:

```text
rootful Docker  = lebih kompatibel, lebih privileged
rootless Docker = lebih terbatas, blast radius lebih kecil
```

Untuk production, pilihan rootless vs rootful harus dievaluasi berdasarkan threat model, operability, host environment, dan platform target.

---

## 10. Image Store, Container Store, Volume Store

Docker perlu menyimpan berbagai jenis data.

Secara konseptual:

```text
Image store:
  - manifest
  - layer content
  - tags
  - digests

Container store:
  - container metadata
  - writable layer
  - runtime state
  - logs

Volume store:
  - persistent data managed by Docker

Build cache:
  - intermediate build result
  - downloaded dependencies if cached
  - layer cache
```

Jangan mencampur semua ini.

Image bisa dihapus tanpa menghapus volume.

Container bisa dihapus tanpa menghapus named volume, kecuali kamu meminta eksplisit.

Contoh:

```bash
docker rm my-container
docker volume ls
```

Volume masih bisa ada.

Ini penting untuk local development:

> Kamu merasa sudah reset container, tetapi database state masih ada di volume lama.

---

## 11. `docker ps` Tidak Menampilkan Semua Kebenaran

Command:

```bash
docker ps
```

Hanya menampilkan running containers.

Untuk melihat container yang sudah exit:

```bash
docker ps -a
```

Untuk melihat detail:

```bash
docker inspect <container>
```

Untuk melihat log:

```bash
docker logs <container>
```

Untuk melihat event:

```bash
docker events
```

Untuk melihat resource:

```bash
docker stats
```

Senior engineer tidak berhenti di `docker ps`.

Mereka bertanya:

```text
Apakah container pernah dibuat?
Apakah image benar?
Apakah command benar?
Apakah container exit?
Apa exit code-nya?
Apakah OOMKilled?
Apakah healthcheck gagal?
Apakah restart policy membuatnya terlihat unstable?
Apakah network benar?
Apakah mount benar?
Apakah app bind ke interface benar?
Apakah log driver menyimpan stdout/stderr?
```

---

## 12. Container Lifecycle dari Sudut Pandang Arsitektur

Lifecycle container bukan hanya “jalan” atau “mati”.

State umum:

```text
created
running
paused
restarting
exited
dead
```

High-level state transition:

```text
image exists/pulled
      |
      v
container created
      |
      v
container started
      |
      v
process running
      |
      +--> process exits
      |       |
      |       v
      |     exited
      |
      +--> stop requested
      |       |
      |       v
      |   SIGTERM -> grace period -> SIGKILL if needed
      |
      +--> runtime/host failure
              |
              v
            dead/restarting/exited
```

Restart policy dapat membuat container exit lalu start lagi.

Itu menyebabkan fenomena:

```text
container terlihat running sebentar, lalu mati, lalu running lagi
```

Command:

```bash
docker ps
docker ps -a
docker inspect <container> --format '{{.RestartCount}}'
```

---

## 13. Mapping Command ke Layer Arsitektur

| Command | Layer yang paling terlibat | Pertanyaan diagnostik |
|---|---|---|
| `docker version` | CLI + daemon | CLI bisa bicara ke daemon? |
| `docker info` | daemon + host | daemon sehat? storage driver apa? runtime apa? |
| `docker pull` | daemon + registry + image store | registry reachable? auth? platform cocok? |
| `docker build` | builder + daemon + image store | context benar? cache? base image? |
| `docker run` | daemon + containerd + runc + kernel | create/start berhasil? |
| `docker ps` | daemon metadata | container running? |
| `docker ps -a` | daemon metadata | pernah exit? |
| `docker logs` | logging driver | app menulis stdout/stderr? |
| `docker inspect` | daemon metadata | config efektif benar? |
| `docker exec` | runtime + existing container | container running? command ada? user permission? |
| `docker stop` | daemon + runtime + signal | app handle SIGTERM? |
| `docker rm` | daemon metadata + writable layer | container masih running? data ada di volume? |
| `docker volume ls` | volume store | persistent data masih ada? |
| `docker network inspect` | network driver | container attached ke network benar? |
| `docker events` | daemon event stream | apa yang terjadi secara timeline? |

---

## 14. Failure Mode Berdasarkan Lapisan

## 14.1 CLI Layer Failure

Gejala:

```text
docker: command not found
unknown flag
invalid reference format
```

Biasanya masalah:

- Docker CLI belum terinstall
- command typo
- syntax salah
- quoting shell salah
- image reference invalid

Contoh:

```bash
docker run my image
```

Docker bisa mengira `my` adalah image dan `image` adalah command, atau menghasilkan parsing error tergantung konteks.

---

## 14.2 Client-Daemon Connectivity Failure

Gejala:

```text
Cannot connect to the Docker daemon
permission denied while trying to connect to the Docker daemon socket
```

Biasanya masalah:

- daemon mati
- socket permission
- user belum masuk Docker group
- Docker Desktop belum start
- context salah
- remote daemon unreachable

Diagnosis:

```bash
docker version
docker context ls
docker info
systemctl status docker
ls -l /var/run/docker.sock
```

---

## 14.3 Registry/Image Resolution Failure

Gejala:

```text
pull access denied
manifest unknown
no matching manifest for linux/arm64/v8
repository does not exist
unauthorized
```

Biasanya masalah:

- image name salah
- tag salah
- private image tanpa login
- image tidak tersedia untuk architecture tersebut
- registry down
- rate limit
- TLS/proxy issue

Diagnosis:

```bash
docker pull <image>
docker manifest inspect <image>
docker login <registry>
docker info
```

---

## 14.4 Container Create Failure

Gejala:

```text
Conflict. The container name is already in use
port is already allocated
invalid mount config
network not found
```

Masalah terjadi sebelum process aplikasi jalan.

Diagnosis:

```bash
docker ps -a
docker network ls
docker volume ls
docker inspect <existing-container>
```

---

## 14.5 Runtime Create Failure

Gejala:

```text
OCI runtime create failed
exec format error
permission denied
no such file or directory
```

Kemungkinan:

- binary architecture salah
- entrypoint tidak ada
- permission executable tidak ada
- script pakai CRLF
- shebang mengarah ke interpreter yang tidak ada
- working directory tidak ada
- user container tidak punya akses
- security policy menolak

Diagnosis:

```bash
docker inspect <container>
docker run --entrypoint sh <image>
docker image inspect <image>
file <binary>
```

Catatan: untuk minimal image, `sh` mungkin tidak ada.

---

## 14.6 Application Runtime Failure

Gejala:

```text
container starts then exits
exit code 1
exit code 137
application logs show exception
```

Kemungkinan Java-specific:

- missing env
- invalid config
- DB unreachable
- wrong profile
- memory limit terlalu kecil
- app bind ke `127.0.0.1`
- keystore tidak kebaca
- permission writing temp/log/upload
- migration gagal
- JVM option salah
- classpath salah

Diagnosis:

```bash
docker logs <container>
docker inspect <container>
docker inspect <container> --format '{{json .State}}'
docker stats
```

---

## 14.7 Host/Storage Failure

Gejala:

```text
no space left on device
failed to register layer
input/output error
read-only file system
```

Kemungkinan:

- disk host penuh
- inode habis
- Docker data root penuh
- storage driver issue
- filesystem corrupt
- permission host berubah

Diagnosis:

```bash
docker system df
df -h
df -i
docker info
du -sh /var/lib/docker
```

Hati-hati dengan:

```bash
docker system prune -a --volumes
```

Command ini bisa menghapus data penting, terutama volume local development.

---

## 15. Docker Events sebagai Timeline Kebenaran

`docker events` berguna untuk melihat apa yang terjadi secara real-time.

```bash
docker events
```

Contoh event:

```text
pull
create
attach
connect
start
die
stop
destroy
health_status
oom
```

Dalam debugging, timeline sering lebih berguna daripada snapshot.

Contoh kasus:

```text
container terlihat tidak ada
```

Mungkin sebenarnya:

```text
create -> start -> die -> destroy
```

Jika dijalankan dengan `--rm`, container bisa hilang setelah exit.

Command:

```bash
docker run --rm myapp
```

Jika app crash cepat, container langsung dihapus. Log mungkin masih terlihat di terminal attached, tetapi container tidak ada di `docker ps -a`.

Untuk debugging, jangan pakai `--rm` dulu.

---

## 16. Relationship antara Docker dan Host Kernel

Docker daemon dan runtime mengatur container, tetapi isolation sebenarnya ditegakkan kernel.

Docker tidak “membuat kernel baru” untuk setiap container Linux.

Container Linux di host Linux berbagi kernel host.

Implikasi:

- kernel bug berdampak ke semua container
- kernel feature menentukan capability container
- container tidak bisa menjalankan kernel module secara normal tanpa privilege khusus
- system call difilter/dibatasi melalui seccomp/capability/security profile
- resource limit diterapkan melalui cgroup
- process tetap terlihat dari host dengan tool tertentu

Di Part 001 kita sudah membahas mental model ini. Di Part 002, kaitannya adalah:

```text
dockerd/containerd/runc = coordinator
kernel = enforcer
```

---

## 17. Java Engineer View: Di Mana Aplikasi Java Berada?

Untuk Java service, path-nya biasanya:

```text
Java source code
  |
  v
Maven/Gradle build
  |
  v
JAR/WAR/native binary
  |
  v
Docker image
  |
  v
Docker container
  |
  v
JVM process
  |
  v
Java application threads
```

Docker architecture relevant ke Java karena:

- JVM adalah process utama container
- JVM menerima signal dari Docker stop
- JVM melihat CPU/memory limit dari cgroup
- logs harus keluar ke stdout/stderr
- config masuk melalui env/file/secret
- filesystem write harus sesuai user/mount permission
- networking bergantung pada bind address dan published port
- healthcheck harus merepresentasikan app readiness/liveness
- image base menentukan libc, CA cert, timezone, shell/debug tools

Jika kamu debugging Java app dalam Docker, jangan langsung lompat ke Java exception. Pastikan layer Docker benar dulu.

Urutan praktis:

```text
1. Apakah daemon reachable?
2. Apakah image benar?
3. Apakah container berhasil created?
4. Apakah container berhasil started?
5. Apakah JVM process berjalan?
6. Apakah app bind ke interface/port benar?
7. Apakah config benar?
8. Apakah dependency reachable?
9. Apakah resource cukup?
10. Apakah app handle signal?
```

---

## 18. Docker Compose dalam Arsitektur Ini

Compose bukan runtime container baru. Compose adalah client/orchestration layer di atas Docker API.

Ketika kamu menjalankan:

```bash
docker compose up
```

Compose membaca Compose file, lalu menginstruksikan Docker daemon untuk membuat:

- network
- volume
- container untuk setiap service
- port mapping
- env
- healthcheck
- dependency order tertentu

Secara arsitektur:

```text
docker compose CLI/plugin
  |
  v
Docker API
  |
  v
dockerd
  |
  v
containerd/runc/kernel
```

Compose tidak menggantikan daemon.

Itulah sebabnya kalau Docker daemon mati, Compose juga tidak bisa menjalankan service.

---

## 19. Docker Buildx dan BuildKit dalam Arsitektur Ini

BuildKit adalah builder backend modern untuk Docker build.

Part 007 akan membahas lebih dalam. Untuk Part 002, cukup pahami:

```text
docker build
  |
  v
builder backend
  |
  +--> legacy builder, historically
  +--> BuildKit, modern default in many environments
```

BuildKit dapat menjalankan build sebagai graph, memakai cache lebih canggih, secret mount, SSH mount, dan multi-platform build.

Arsitektur build tidak identik dengan runtime container, tetapi hasil akhirnya tetap image yang masuk ke image store atau registry.

---

## 20. Remote Docker Daemon: Power and Danger

Docker CLI bisa mengontrol daemon remote.

Contoh konseptual:

```bash
DOCKER_HOST=tcp://server:2376 docker ps
```

Atau via context.

Ini berguna untuk:

- remote build machine
- CI
- development server
- centralized Docker host

Tapi berbahaya jika tidak diamankan:

- siapa pun yang bisa bicara ke daemon bisa menjalankan container
- menjalankan container bisa berarti mount host filesystem
- remote daemon tanpa TLS/auth adalah risiko serius

Prinsip:

> Docker daemon API bukan endpoint publik biasa. Perlakukan seperti root-equivalent control plane.

---

## 21. Observability Minimal untuk Arsitektur Docker

Saat debugging Docker host, command minimal:

```bash
docker version
docker info
docker context ls
docker ps -a
docker images
docker system df
docker events
```

Untuk container tertentu:

```bash
docker inspect <container>
docker logs <container>
docker stats <container>
docker top <container>
docker port <container>
docker diff <container>
```

Untuk image tertentu:

```bash
docker image inspect <image>
docker history <image>
docker manifest inspect <image>
```

Untuk network:

```bash
docker network ls
docker network inspect <network>
```

Untuk volume:

```bash
docker volume ls
docker volume inspect <volume>
```

---

## 22. Practical Mental Model: Four Planes

Docker bisa dipahami melalui empat plane.

## 22.1 Client Plane

Tempat user/tool mengirim perintah.

```text
docker CLI
docker compose
IDE
CI runner
SDK
```

Pertanyaan:

```text
Apakah command mengarah ke daemon yang benar?
Apakah user punya permission?
Apakah syntax benar?
```

## 22.2 Control Plane

Tempat Docker memutuskan dan mencatat state.

```text
dockerd
Docker API
metadata store
network/volume/image management
```

Pertanyaan:

```text
Apakah daemon sehat?
Apakah object Docker ada?
Apakah config efektif benar?
```

## 22.3 Runtime Plane

Tempat container process dibuat dan disupervisi.

```text
containerd
shim
runc
kernel
```

Pertanyaan:

```text
Apakah runtime bisa membuat process?
Apakah namespace/cgroup/mount berhasil?
Apakah entrypoint bisa dieksekusi?
```

## 22.4 Workload Plane

Tempat aplikasi berjalan.

```text
JVM
Spring Boot
Netty/Tomcat/Jetty
application threads
database client
message client
```

Pertanyaan:

```text
Apakah app sehat?
Apakah config benar?
Apakah resource cukup?
Apakah dependency reachable?
Apakah app handle shutdown?
```

Banyak engineer mencampur semua plane ini.

Contoh:

```text
Error: Cannot connect to Docker daemon
```

Ini client/control plane, bukan workload Java.

```text
java.lang.OutOfMemoryError
```

Ini workload plane, tetapi bisa dipicu oleh runtime plane resource limit.

```text
port is already allocated
```

Ini control/runtime setup, bukan HTTP framework.

```text
connection refused ke localhost
```

Bisa workload, network, atau mental model alamat salah.

---

## 23. Case Study 1 — “Container Saya Tidak Jalan”

Gejala:

```bash
docker run myapp
```

Output:

```text
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
```

Analisis:

Sebelum bicara image, Java, Dockerfile, port, atau network, command bahkan belum mencapai daemon.

Layer:

```text
CLI -> daemon connectivity
```

Checklist:

```bash
docker version
docker context ls
systemctl status docker
ls -l /var/run/docker.sock
```

Kemungkinan:

- Docker daemon mati
- user tidak punya permission
- Docker Desktop belum start
- context salah

---

## 24. Case Study 2 — “Image Bisa Dipull di Laptop, Tapi CI Gagal”

Gejala:

```text
no matching manifest for linux/amd64 in the manifest list entries
```

Atau sebaliknya:

```text
no matching manifest for linux/arm64/v8
```

Analisis:

Masalah bukan Java. Masalah image platform.

Layer:

```text
registry/image resolution
```

Kemungkinan:

- laptop Apple Silicon memakai arm64
- CI memakai amd64
- image hanya tersedia untuk satu architecture
- build multi-platform belum benar

Diagnosis:

```bash
docker manifest inspect <image>
docker buildx imagetools inspect <image>
docker info
```

Akan dibahas mendalam di Part 025.

---

## 25. Case Study 3 — “Container Running Tapi Aplikasi Tidak Bisa Diakses”

Gejala:

```bash
docker ps
```

Menampilkan:

```text
0.0.0.0:8080->8080/tcp
```

Tapi browser gagal.

Kemungkinan:

1. App tidak bind ke port 8080
2. App bind ke `127.0.0.1` di dalam container
3. App belum ready
4. App crash setelah startup
5. Firewall host
6. Docker Desktop network issue
7. Health endpoint salah
8. TLS/plain HTTP mismatch

Layer yang mungkin:

```text
runtime network setup
workload app binding
host firewall
client request
```

Diagnosis:

```bash
docker logs <container>
docker inspect <container>
docker port <container>
docker exec <container> ss -ltnp
```

Kalau image minimal tidak punya `ss`, gunakan debug container atau image lain pada network yang sama.

---

## 26. Case Study 4 — “Container Langsung Exit 0”

Gejala:

```bash
docker run myimage
docker ps
# tidak ada container
docker ps -a
# Exited (0)
```

Analisis:

Exit 0 berarti process utama selesai sukses.

Docker menjalankan process utama. Jika process selesai, container selesai.

Kemungkinan:

- image menjalankan command one-shot
- command override salah
- app bukan long-running server
- `CMD` hanya `java -version`
- script startup selesai tanpa menjalankan app
- shell wrapper tidak `exec` atau tidak menunggu child

Layer:

```text
workload process lifecycle
Docker ENTRYPOINT/CMD contract
```

Diagnosis:

```bash
docker inspect <container> --format '{{json .Config.Cmd}}'
docker inspect <container> --format '{{json .Config.Entrypoint}}'
docker logs <container>
```

---

## 27. Case Study 5 — “Exit 137”

Gejala:

```text
Exited (137)
```

Analisis:

Exit 137 biasanya berarti process menerima SIGKILL. Dalam Docker context, sering terjadi karena OOMKilled.

Tapi jangan langsung menyimpulkan. Verifikasi.

Diagnosis:

```bash
docker inspect <container> --format '{{.State.OOMKilled}}'
docker inspect <container> --format '{{.State.ExitCode}}'
docker stats
```

Jika Java:

- heap terlalu besar
- native memory tidak dihitung dalam heap
- thread terlalu banyak
- direct buffer besar
- metaspace/code cache
- memory limit container kecil
- JVM flags tidak sesuai

Layer:

```text
runtime resource limit + JVM memory model
```

Akan dibahas detail di Part 009 dan Part 020.

---

## 28. Case Study 6 — “Docker Daemon Restart, Apa Container Mati?”

Jawabannya tergantung konfigurasi, runtime, dan kondisi.

Secara modern, containerd/shim membantu decouple lifecycle container dari daemon. Container yang sudah berjalan dapat tetap berjalan saat daemon restart dalam banyak skenario.

Namun jangan jadikan ini asumsi reliability utama.

Yang perlu dipahami:

- daemon menyimpan/menyajikan control plane state
- container process berjalan di runtime/host
- restart daemon bisa mengganggu operasi management
- restart policy dan live-restore setting dapat memengaruhi behavior
- update Docker Engine dapat berdampak ke running workloads

Untuk production, validasi behavior pada platformmu, jangan hanya mengandalkan teori.

---

## 29. Case Study 7 — “Saya Hapus Container Tapi Data Database Masih Ada”

Gejala:

```bash
docker rm postgres
docker run postgres
```

Data lama masih muncul.

Analisis:

Kemungkinan data ada di named volume.

Layer:

```text
volume store, bukan container writable layer
```

Diagnosis:

```bash
docker volume ls
docker inspect <container>
docker volume inspect <volume>
```

Menghapus container tidak otomatis menghapus named volume.

Command berisiko:

```bash
docker volume rm <volume>
docker compose down -v
```

Gunakan sadar, karena itu menghapus persistent data.

---

## 30. Design Implication untuk Java Team

Arsitektur Docker mengubah cara kita mendesain lifecycle aplikasi.

## 30.1 Build Artifact Harus Jelas

Java team sering punya artifact:

```text
target/app.jar
build/libs/app.jar
```

Docker image harus mengemas artifact itu dengan deterministic.

Jangan membiarkan runtime container melakukan build ulang secara tidak sengaja.

Buruk:

```dockerfile
FROM maven:3-eclipse-temurin-21
COPY . .
CMD ["mvn", "spring-boot:run"]
```

Masalah:

- runtime image membawa Maven
- startup lambat
- environment runtime tergantung build tool
- dev/prod behavior blur
- dependency download saat runtime
- attack surface lebih besar

Lebih baik:

```text
build stage -> compile/test/package
runtime stage -> hanya JRE + app artifact
```

## 30.2 Runtime Contract Harus Eksplisit

Container production harus jelas:

- process utama apa?
- port apa?
- config dari mana?
- user apa?
- working directory apa?
- healthcheck apa?
- graceful shutdown bagaimana?
- data ditulis ke mana?
- log keluar ke mana?

Docker architecture memaksa kita membuat implicit server knowledge menjadi explicit runtime contract.

## 30.3 Debugging Harus Berdasarkan Layer

Saat incident:

```text
service unavailable
```

Jangan langsung masuk ke kode Java.

Layered diagnosis:

```text
Is daemon reachable?
Is container running?
Is process listening?
Is port published?
Is app healthy?
Is dependency reachable?
Is config correct?
Is resource exhausted?
```

Ini menghemat banyak waktu.

---

## 31. Checklist: Memahami Arsitektur Docker

Setelah Part 002, kamu seharusnya bisa menjawab:

- Apa bedanya Docker CLI dan Docker daemon?
- Kenapa container tetap berjalan setelah CLI keluar?
- Apa fungsi Docker API?
- Kenapa akses ke `/var/run/docker.sock` berbahaya?
- Apa fungsi `dockerd`?
- Apa peran containerd?
- Apa peran containerd-shim?
- Apa peran runc?
- Di mana registry masuk dalam flow?
- Apa yang terjadi saat `docker run`?
- Apa yang terjadi saat `docker build`?
- Kenapa Docker Desktop berbeda dari Linux server?
- Apa itu Docker context?
- Kenapa daemon biasanya privileged?
- Apa yang disimpan di `/var/lib/docker`?
- Kenapa `docker ps` saja tidak cukup?
- Bagaimana membedakan error CLI, daemon, registry, runtime, dan app?
- Bagaimana memetakan Docker failure ke layer arsitektur?

---

## 32. Mini Lab: Melihat Arsitektur Docker di Mesin Sendiri

> Jalankan hanya di environment development.

## 32.1 Cek CLI dan Daemon

```bash
docker version
```

Perhatikan bagian:

```text
Client
Server
```

Kalau hanya Client yang muncul dan Server error, CLI tidak bisa bicara ke daemon.

---

## 32.2 Cek Info Daemon

```bash
docker info
```

Perhatikan:

```text
Server Version
Storage Driver
Logging Driver
Cgroup Driver
Cgroup Version
Runtimes
Default Runtime
Docker Root Dir
Operating System
Architecture
```

Pertanyaan:

- runtime default apa?
- storage driver apa?
- architecture host apa?
- Docker Root Dir di mana?
- cgroup version berapa?

---

## 32.3 Cek Context

```bash
docker context ls
docker context inspect
```

Pastikan kamu tahu CLI sedang bicara ke daemon mana.

---

## 32.4 Jalankan Container Sederhana

```bash
docker run --name arch-demo hello-world
```

Lihat hasil:

```bash
docker ps -a
docker inspect arch-demo
docker logs arch-demo
```

Container `hello-world` exit karena memang prosesnya selesai.

---

## 32.5 Lihat Event

Terminal 1:

```bash
docker events
```

Terminal 2:

```bash
docker run --rm busybox echo "hello"
```

Amati event create/start/die/destroy.

---

## 32.6 Lihat Process di Host

Jalankan container long-running:

```bash
docker run -d --name sleep-demo busybox sleep 3600
```

Lihat:

```bash
docker ps
docker top sleep-demo
```

Di Linux host, kamu juga bisa:

```bash
ps aux | grep sleep
ps aux | grep containerd-shim
```

Bersihkan:

```bash
docker rm -f sleep-demo
docker rm arch-demo
```

---

## 33. Common Misconceptions

## 33.1 “Docker CLI Menjalankan Container”

Tidak tepat.

CLI mengirim request. Daemon/runtime menjalankan container.

## 33.2 “Container Hilang Berarti Tidak Pernah Jalan”

Tidak selalu.

Jika pakai `--rm`, container bisa dibuat, start, exit, lalu langsung dihapus.

## 33.3 “Docker Error Berarti Aplikasi Saya Error”

Tidak selalu.

Bisa error daemon, registry, image, runtime, network, mount, atau host.

## 33.4 “Image Sudah Ada Berarti Bisa Jalan”

Tidak selalu.

Image bisa ada, tetapi:

- command salah
- platform salah
- mount gagal
- env kurang
- app crash
- port konflik
- user permission salah

## 33.5 “Container Running Berarti Service Healthy”

Tidak selalu.

Container running hanya berarti process utama masih hidup.

App bisa:

- belum ready
- deadlocked
- tidak bind port
- gagal connect dependency
- healthcheck failing
- melayani sebagian request saja

## 33.6 “Docker Desktop Sama dengan Linux Production”

Tidak sama.

Docker Desktop memberi developer UX yang nyaman, tetapi ada VM, filesystem bridge, dan network integration yang bisa berbeda dari Linux production.

---

## 34. Architectural Invariants

Pegang invariants berikut sepanjang seri:

1. Docker CLI adalah client, bukan runtime.
2. Docker daemon adalah control plane utama Docker Engine.
3. Docker API adalah kontrak antara client dan daemon.
4. containerd mengelola lifecycle container pada level runtime.
5. runc membuat process container sesuai OCI runtime spec.
6. Kernel host menegakkan isolation.
7. Registry menyimpan image, bukan menjalankan container.
8. Image adalah artifact immutable; container adalah runtime instance.
9. Container hidup selama process utamanya hidup.
10. `docker inspect` adalah sumber kebenaran konfigurasi efektif.
11. `docker logs` hanya menampilkan apa yang masuk ke logging driver.
12. `docker ps` hanya snapshot terbatas.
13. Docker Desktop menambahkan VM/integration layer.
14. Docker socket adalah privileged control interface.
15. Failure Docker harus didiagnosis berdasarkan layer.

---

## 35. Java-Specific Takeaways

Untuk Java engineer, arsitektur Docker berarti:

- JAR bukan deployment unit terakhir; image adalah deployment artifact.
- JVM adalah process utama container.
- Docker stop mengirim signal ke process utama.
- JVM memory harus dibaca dalam konteks cgroup.
- Docker port publishing tidak memperbaiki app yang bind ke alamat salah.
- Docker healthcheck tidak otomatis tahu readiness Spring Boot.
- Docker daemon failure berbeda dari Java app failure.
- Registry tag bukan guarantee immutable.
- CI/CD harus mempromosikan image digest, bukan rebuild per environment.
- Debugging Java in container dimulai dari Docker layer facts.

---

## 36. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

- Docker Engine documentation — konsep Docker Engine sebagai client-server application dengan daemon, API, dan CLI.
  - https://docs.docker.com/engine/
- Docker overview — penjelasan Docker daemon, client, registry, image, dan container.
  - https://docs.docker.com/get-started/docker-overview/
- Docker daemon configuration overview — data directory dan konfigurasi daemon.
  - https://docs.docker.com/engine/daemon/
- Docker alternative runtimes — Docker Engine menggunakan `runc` sebagai default runtime dan mendukung runtime alternatif.
  - https://docs.docker.com/engine/daemon/alternative-runtimes/
- containerd project — container runtime untuk lifecycle, image transfer/storage, execution, supervision, storage, dan network attachments.
  - https://github.com/containerd/containerd
- Docker rootless mode — menjalankan daemon dan container sebagai non-root user.
  - https://docs.docker.com/engine/security/rootless/
- Docker Desktop documentation — environment local untuk build, share, dan run containerized applications.
  - https://docs.docker.com/desktop/

---

## 37. Ringkasan

Docker architecture bisa terlihat kompleks, tetapi modelnya menjadi jelas jika dipisahkan menjadi beberapa lapisan:

```text
CLI / client
  -> Docker API
  -> dockerd
  -> containerd
  -> shim
  -> runc
  -> kernel
  -> containerized process
```

Untuk Java engineer, pemahaman ini penting karena container incident sering tampak seperti application incident, padahal akar masalahnya bisa berada pada daemon, image, registry, runtime, network, mount, atau host resource.

Part ini belum mengajarkan semua command secara mendalam. Tujuannya lebih fundamental:

> Membuat kamu bisa melihat Docker bukan sebagai magic box, tetapi sebagai sistem berlapis yang bisa diobservasi, didiagnosis, dan dirancang dengan benar.

Di part berikutnya, kita akan masuk ke image mental model:

```text
Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform
```

Kita akan membahas kenapa image bukan “file besar”, kenapa tag bukan identity, kenapa digest penting, bagaimana layer bekerja, dan kenapa platform `amd64` vs `arm64` bisa membuat build/run gagal.

---

## Status Seri

Selesai:

- Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
- Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
- Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc

Belum selesai:

- Part 003 sampai Part 031

Seri belum mencapai bagian terakhir.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-003.md">Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform ➡️</a>
</div>
