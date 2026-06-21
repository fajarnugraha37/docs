# learn-docker-mastery-for-java-engineers-part-000.md

# Part 000 — Orientation: Docker as Process Packaging, Not Mini VM

> Series: `learn-docker-mastery-for-java-engineers`  
> Audience: Java software engineer yang ingin memahami Docker pada level arsitektur, runtime, build, deployment, dan failure analysis.  
> Status: Part 000 dari 32. Seri belum selesai.

---

## 0. Posisi Part Ini

Part ini adalah orientasi. Tujuannya bukan membuat kamu langsung hafal command Docker, melainkan membentuk mental model yang akan dipakai sepanjang seluruh seri.

Kalau kamu memulai Docker dari command seperti:

```bash
 docker run nginx
 docker build -t my-app .
 docker compose up
```

kamu mungkin cepat bisa menjalankan sesuatu. Tetapi tanpa model internal yang benar, Docker akan terlihat seperti kumpulan magic command. Itu cukup untuk demo, tetapi rapuh untuk production, CI/CD, incident investigation, Java performance tuning, security review, atau platform engineering.

Part ini akan menjawab pertanyaan dasar:

1. Apa sebenarnya Docker?
2. Kenapa container bukan mini virtual machine?
3. Apa bedanya image, container, process, filesystem, registry, runtime, dan deployment artifact?
4. Kenapa Docker penting untuk Java engineer senior?
5. Apa skill yang membedakan pengguna Docker biasa dengan engineer yang benar-benar kuat?
6. Apa asumsi berbahaya yang harus dibuang sejak awal?
7. Bagaimana seri ini akan belajar Docker tanpa mengulang materi Linux Kernel, HTTP, Nginx, database, messaging, Redis, scripting, dan Kubernetes?

Sumber utama yang digunakan untuk orientasi ini adalah dokumentasi resmi Docker. Docker mendeskripsikan Docker sebagai platform untuk membangun, membagikan, dan menjalankan aplikasi containerized. Docker Engine sendiri adalah teknologi containerization open-source untuk membangun dan menjalankan aplikasi, dengan arsitektur client-server yang melibatkan daemon `dockerd`, API, dan CLI `docker`. Compose menyederhanakan pengelolaan application stack melalui konfigurasi YAML untuk services, networks, dan volumes. BuildKit adalah builder backend modern yang menggantikan legacy builder dan menjadi default pada Docker Desktop dan Docker Engine modern.

Referensi resmi:

- Docker overview: https://www.docker.com/
- Docker Engine: https://docs.docker.com/engine/
- Docker Build / BuildKit: https://docs.docker.com/build/ dan https://docs.docker.com/build/buildkit/
- Docker Compose: https://docs.docker.com/compose/
- Docker image concepts: https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/
- Docker registry concepts: https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-registry/

---

## 1. Docker dalam Satu Kalimat yang Benar

Docker adalah platform dan toolchain untuk membuat, mendistribusikan, dan menjalankan aplikasi sebagai container: sebuah proses yang dijalankan dengan boundary tertentu pada filesystem, network, user, resource, dan konfigurasi runtime.

Kalimat ini sengaja panjang karena Docker sering disalahpahami kalau disederhanakan terlalu ekstrem.

Docker bukan hanya:

- command line tool,
- virtual machine ringan,
- cara menjalankan Linux di laptop,
- cara mudah install PostgreSQL lokal,
- cara deploy aplikasi,
- pengganti Kubernetes,
- packaging format,
- runtime isolation mechanism,
- CI/CD tool,
- atau security sandbox absolut.

Docker bisa menyentuh semua area itu, tetapi Docker bukan hanya salah satunya.

Mental model yang lebih akurat:

```text
Source Code
   ↓
Build System
   ↓
Application Artifact
   ↓
Container Image
   ↓
Registry
   ↓
Container Runtime
   ↓
Container Instance
   ↓
Process running on a host kernel
```

Untuk Java engineer:

```text
Java source code
   ↓
Maven / Gradle build
   ↓
JAR / WAR / native executable
   ↓
Docker image containing JVM + app artifact + runtime config defaults
   ↓
Registry artifact identified by tag/digest
   ↓
Container started with env, network, volume, CPU/memory limit
   ↓
Java process running as PID inside container namespace
```

Docker mastery berarti kamu paham setiap panah di atas: apa inputnya, apa outputnya, apa invariant-nya, apa yang mutable, apa yang immutable, apa failure mode-nya, dan apa konsekuensinya untuk aplikasi Java.

---

## 2. Kenapa Docker Penting untuk Java Engineer Senior

Java engineer sering menganggap Docker sebagai urusan DevOps atau platform team. Itu pemisahan yang berbahaya.

Untuk aplikasi modern, Docker memengaruhi:

- bagaimana aplikasi dibuild,
- dependency apa yang ikut ke production,
- OS package apa yang ikut terbawa,
- JVM apa yang digunakan,
- bagaimana memory limit dibaca JVM,
- bagaimana CPU quota memengaruhi thread pool,
- bagaimana graceful shutdown berjalan,
- bagaimana log dikumpulkan,
- bagaimana config dan secret disuntikkan,
- bagaimana service ditemukan di network lokal atau deployment environment,
- bagaimana artifact dipromosikan antar environment,
- bagaimana vulnerability scanner membaca image,
- bagaimana rollback dilakukan,
- bagaimana incident ditriage.

Dengan kata lain, Docker bukan hanya packaging. Docker menjadi bagian dari runtime contract aplikasi.

Seorang Java engineer senior seharusnya tidak hanya bisa menulis kode bisnis dan menyerahkan sisanya ke platform. Dia perlu memahami bagaimana kode itu hidup sebagai proses di production.

Contoh sederhana:

```dockerfile
FROM eclipse-temurin:21
COPY target/app.jar /app/app.jar
CMD java -jar /app/app.jar
```

Ini terlihat cukup. Tetapi engineer senior akan langsung bertanya:

1. Base image ini tag mutable atau pinned?
2. Apakah menggunakan JDK penuh atau runtime yang lebih minimal?
3. Apakah aplikasi berjalan sebagai root?
4. Apakah `CMD` shell form atau exec form?
5. Apakah signal SIGTERM diterima JVM dengan benar?
6. Apakah heap sizing menghormati container memory limit?
7. Apakah timezone dan CA certificates tersedia?
8. Apakah image membawa build tool atau dependency tidak perlu?
9. Apakah layer cache optimal untuk Maven/Gradle?
10. Apakah logs keluar ke stdout/stderr?
11. Apakah image aman untuk vulnerability scanning?
12. Apakah artifact yang sama dipromosikan ke staging dan production?
13. Apakah runtime config dipisahkan dari image?
14. Apakah startup failure bisa didiagnosis dari logs dan exit code?
15. Apakah container akan mati dengan baik saat deployment rolling update?

Docker membuat pertanyaan-pertanyaan ini terlihat. Tanpa Docker, banyak pertanyaan tersebut tetap ada, tetapi tersembunyi di server manual, script deployment, systemd unit, package manager, atau tribal knowledge.

---

## 3. Docker Bukan Mini Virtual Machine

Ini koreksi mental model paling penting.

Banyak orang berkata:

> Container itu seperti VM ringan.

Sebagai analogi awal, kalimat itu kadang membantu. Tetapi untuk engineer serius, analogi itu cepat menjadi racun.

Virtual machine biasanya menjalankan guest operating system lengkap di atas hypervisor. VM punya kernel sendiri. Container tidak membawa kernel sendiri. Container menjalankan proses di atas kernel host, tetapi diberi boundary menggunakan fitur kernel seperti namespace, cgroup, mount isolation, networking isolation, dan permission control.

Simplifikasi:

```text
Virtual Machine:

Hardware / Host OS
   ↓
Hypervisor
   ↓
Guest OS kernel
   ↓
Guest OS user space
   ↓
Application process
```

```text
Container:

Host OS kernel
   ↓
Container runtime boundary
   ↓
Application process + isolated user space view
```

Implikasi praktis:

1. Container Linux membutuhkan kernel Linux.
2. Container berbagi kernel host.
3. Container image biasanya membawa user space, bukan kernel.
4. Security boundary container berbeda dari VM.
5. Kernel bug atau host misconfiguration dapat berdampak ke container.
6. Resource limit container bukan hardware sungguhan, melainkan policy kernel.
7. `ps`, `/proc`, network interface, hostname, dan filesystem yang terlihat di container adalah view yang dibentuk oleh namespace.
8. Container startup cepat karena tidak boot guest OS penuh.

Untuk Java engineer, konsekuensi ini besar.

JVM bukan berjalan “di dalam VM Docker”. JVM berjalan sebagai process pada host kernel, hanya saja process itu melihat filesystem, network, PID tree, hostname, dan resource limit yang sudah dibatasi.

Artinya ketika kamu melihat:

```bash
java -jar app.jar
```

inside container, secara OS-level itu tetap proses Java biasa. Yang berubah adalah boundary-nya.

---

## 4. Docker Sebagai Boundary, Bukan Mesin Ajaib

Docker memberi beberapa boundary penting:

| Boundary | Pertanyaan yang dijawab |
|---|---|
| Filesystem | File apa yang terlihat oleh proses? |
| Process/PID | Proses lain apa yang terlihat? |
| Network | Interface, port, DNS, dan routing apa yang terlihat? |
| User/permission | UID/GID apa yang digunakan? |
| Resource | Berapa CPU/memory yang boleh digunakan? |
| Config | Env, args, mounts, secrets apa yang disuntikkan saat runtime? |
| Distribution | Artifact apa yang dikirim dan dijalankan? |

Boundary ini tidak otomatis benar. Docker hanya memberi mekanisme. Engineer tetap harus mendesain kontraknya.

Contoh:

```bash
docker run -p 8080:8080 my-app
```

Perintah ini tidak menjamin aplikasi bisa diakses. Aplikasi juga harus bind ke address yang benar di dalam container. Kalau aplikasi bind ke `127.0.0.1` inside container, host port publishing tidak selalu menghasilkan behavior yang kamu harapkan untuk semua kasus. Banyak bug Docker networking sebenarnya adalah bug mental model `localhost`.

Contoh lain:

```bash
docker run --memory=512m my-java-app
```

Ini tidak berarti heap Java otomatis 512 MB. JVM memiliki heap, metaspace, thread stack, direct buffer, JIT code cache, GC structures, native memory, dan memory lain. Kalau kamu set `-Xmx512m` di container 512 MB, container bisa OOMKilled walaupun Java heap belum terlihat “penuh” menurut asumsi sederhana.

Docker memberi boundary. Boundary harus dimengerti.

---

## 5. Vocabulary Dasar yang Harus Presisi

Sebelum masuk command, kita perlu presisi istilah.

### 5.1 Source Code

Source code adalah input development. Untuk Java:

```text
src/main/java
src/main/resources
pom.xml / build.gradle
```

Source code bukan Docker image. Source code bukan deployment artifact. Source code harus dibuild menjadi artifact.

### 5.2 Build Artifact

Build artifact adalah hasil dari Maven/Gradle atau build system lain:

```text
target/app.jar
build/libs/app.jar
```

Build artifact bisa dijalankan tanpa Docker kalau environment punya JDK/JRE yang kompatibel:

```bash
java -jar app.jar
```

Tetapi artifact ini belum membawa semua runtime contract seperti OS packages, CA certs, timezone data, native libraries, default entrypoint, user, dan filesystem layout.

### 5.3 Container Image

Container image adalah package standar yang berisi file, binary, library, dan konfigurasi yang diperlukan untuk menjalankan container. Docker documentation mendeskripsikan image sebagai standardized package untuk menjalankan container.

Untuk Java service, image biasanya berisi:

```text
JVM runtime
application JAR
config defaults
working directory
entrypoint/cmd
labels
non-root user setup
OS libraries
CA certificates
timezone data if needed
```

Image bersifat immutable dalam konsep deployment. Kamu tidak “mengubah image di production”; kamu membangun image baru.

### 5.4 Image Layer

Image tersusun dari layer. Tiap instruction tertentu dalam Dockerfile dapat membentuk layer filesystem. Layer bisa di-cache dan dibagikan antar image.

Mental model:

```text
Base image layer
+ OS package layer
+ JVM/app dependency layer
+ application artifact layer
+ metadata/config
= final image
```

Layer penting untuk:

- build speed,
- image pull speed,
- cache reuse,
- vulnerability scanning,
- storage efficiency,
- reproducibility.

### 5.5 Tag

Tag adalah nama manusiawi untuk image reference:

```text
my-service:1.2.3
my-service:latest
my-service:2026-06-21-abc123
```

Tag bukan identity immutable. Tag dapat dipindahkan ke image berbeda kecuali registry policy mencegahnya.

Ini penting untuk production. Kalau deployment hanya berkata:

```text
my-service:latest
```

maka kamu tidak benar-benar tahu artifact apa yang berjalan tanpa memeriksa digest.

### 5.6 Digest

Digest adalah content-addressed identifier, biasanya berbentuk:

```text
sha256:...
```

Digest lebih kuat untuk audit dan reproducibility karena mengacu pada content tertentu.

Production-grade promotion biasanya berpikir:

```text
Build once → push image → identify by digest → promote same digest across environments
```

Bukan:

```text
Build separately for dev, staging, production
```

karena rebuild per environment membuka peluang drift.

### 5.7 Registry

Registry adalah tempat menyimpan dan membagikan image. Docker docs mendefinisikan image registry sebagai lokasi terpusat untuk menyimpan dan membagikan container image. Docker Hub adalah registry publik default, tetapi organisasi biasanya juga memakai private registry atau cloud registry.

Registry bukan hanya storage. Registry menjadi bagian dari supply chain.

Pertanyaan penting:

- siapa boleh push?
- siapa boleh pull?
- apakah tag immutable?
- apakah image discan?
- apakah digest dicatat?
- apakah image ditandatangani?
- apakah ada retention policy?
- bagaimana rollback dilakukan?

### 5.8 Container

Container adalah instance runtime dari image.

Image:

```text
immutable template
```

Container:

```text
running or stopped instance created from image + runtime configuration
```

Satu image bisa menghasilkan banyak container:

```text
my-app:1.0 image
   ├── container A
   ├── container B
   └── container C
```

Container punya writable layer sendiri, environment sendiri, network attachment sendiri, mount sendiri, lifecycle sendiri.

### 5.9 Runtime Configuration

Runtime configuration adalah konfigurasi yang diberikan saat container dibuat atau dijalankan:

```text
environment variables
command override
entrypoint override
ports
networks
volumes
resource limits
restart policy
user
secrets
healthcheck override
```

Ini penting: image yang sama bisa berjalan berbeda karena runtime config berbeda.

Jadi saat debugging, jangan hanya membaca Dockerfile. Baca juga effective runtime config dari container.

### 5.10 Container Runtime

Container runtime adalah komponen yang benar-benar menjalankan container. Dalam ekosistem Docker modern, kamu akan mendengar:

- Docker CLI,
- Docker Engine,
- `dockerd`,
- `containerd`,
- `runc`,
- OCI runtime.

Part arsitektur detail akan dibahas di Part 002. Untuk saat ini cukup pahami bahwa Docker bukan satu binary monolitik. Docker CLI berbicara ke Docker daemon/API; daemon mengelola build/run/pull/push dan bekerja dengan runtime komponen di bawahnya.

---

## 6. Image vs Container: Kesalahan Paling Sering

Salah satu bug konseptual paling umum adalah mencampur image dan container.

Perbandingan:

| Konsep | Image | Container |
|---|---|---|
| Sifat | Template immutable | Instance runtime |
| Dibuat oleh | `docker build`, `docker pull` | `docker create`, `docker run` |
| Bisa berjalan? | Tidak langsung | Ya, kalau started |
| Punya process? | Tidak | Ya, saat running |
| Punya writable layer? | Tidak dalam arti runtime container | Ya |
| Bisa dipush ke registry? | Ya | Tidak sebagai container; harus commit/export kalau dipaksa, biasanya anti-pattern |
| Identitas production ideal | Digest | Container ID ephemeral |
| Lifecycle | build/pull/tag/push/remove | create/start/stop/restart/remove |

Analogi:

```text
Image     = class / blueprint / executable package
Container = object instance / process execution
```

Tetapi analogi OOP juga terbatas. Image bukan class Java secara literal. Container bukan object di heap. Yang penting adalah relasi template-instance.

### Contoh Mental Model

Kalau kamu menjalankan:

```bash
docker run my-app:1.0
```

Docker kira-kira melakukan:

```text
Find image my-app:1.0 locally or pull it
Create container filesystem from image layers
Create writable layer
Apply runtime config
Setup namespace/cgroup/network/mounts
Start configured process
Attach logs if requested
```

Kalau container mati, image tidak hilang.

Kalau kamu hapus container, image tidak otomatis hilang.

Kalau kamu rebuild image dengan tag yang sama, container lama tidak otomatis berubah.

Ini penting dalam deployment. Banyak orang berpikir setelah `docker build -t app:latest .`, container lama akan menggunakan image baru. Tidak. Container lama tetap dibuat dari image lama. Kamu perlu recreate container.

---

## 7. Docker Sebagai Packaging Discipline

Sebelum Docker, deployment Java sering seperti ini:

```text
Install JDK on server
Install OS packages manually
Copy JAR/WAR
Set environment variables
Configure systemd/service wrapper
Configure log path
Configure user permission
Configure firewall/ports
Hope staging and production are similar
```

Masalahnya:

- server drift,
- manual setup,
- hidden dependency,
- unclear runtime version,
- difficult rollback,
- environment-specific snowflake,
- audit sulit,
- onboarding lambat.

Docker memaksa packaging discipline:

```text
Everything required to run the process should be declared or injected through explicit runtime contract.
```

Docker image menjawab:

- aplikasi apa yang dijalankan?
- menggunakan JVM apa?
- filesystem layout-nya bagaimana?
- default command-nya apa?
- user-nya siapa?
- dependency OS apa yang ada?
- metadata build apa yang melekat?

Runtime config menjawab:

- environment spesifik apa yang diberikan?
- secret apa yang dimount?
- network apa yang digunakan?
- port apa yang dipublish?
- volume apa yang dipakai?
- resource limit apa yang diterapkan?

Dengan pemisahan ini, kamu bisa punya prinsip:

```text
Same image, different runtime configuration.
```

Bukan:

```text
Different image for every environment.
```

Ini sangat penting untuk regulatory-grade system, auditability, dan incident reconstruction. Kalau staging dan production dibuild secara terpisah dari source commit yang sama, kamu masih memiliki dua artifact berbeda. Kalau artifact berbeda, behavior bisa berbeda.

---

## 8. Docker Sebagai Delivery Contract

Container image adalah delivery contract antara development, CI/CD, platform, dan runtime environment.

Contract itu minimal mencakup:

```text
What process should run?
What files must exist?
What user should run it?
What port does it listen on?
What environment variables are required?
What filesystem paths must be writable?
What signal stops it?
How does it report health?
How does it log?
What resource assumptions does it make?
What architecture/platform is it built for?
```

Untuk Java service, contract yang baik bisa terlihat seperti:

```text
Image:
  app: enforcement-case-service
  runtime: Java 21
  base: Debian slim / distroless / chosen runtime
  user: non-root UID
  working dir: /app
  entrypoint: java ... -jar app.jar
  logs: stdout/stderr
  writable paths: /tmp only
  health endpoint: /actuator/health/readiness
  listens: 8080

Runtime requirements:
  DB_URL required
  DB_USERNAME required
  DB_PASSWORD secret required
  memory limit >= 768MiB
  CPU >= 1 core recommended
  graceful shutdown timeout >= 30s
```

Dockerfile saja tidak cukup. Compose/Kubernetes/systemd/CI config juga bagian dari contract. Tetapi Dockerfile adalah titik awal contract.

---

## 9. Docker dari Perspektif Java Engineer

Java punya karakteristik yang membuat Docker perlu dipahami dengan hati-hati.

### 9.1 JVM adalah Runtime Besar

Java bukan static binary kecil. JVM membawa:

- heap,
- metaspace,
- JIT compiler,
- code cache,
- GC threads,
- application threads,
- direct buffers,
- class loading,
- native libraries,
- TLS stack,
- truststore,
- timezone handling.

Dalam container, semua ini harus hidup dalam resource boundary.

Kesalahan umum:

```bash
-Xmx512m inside container with --memory=512m
```

Ini berisiko karena memory Java bukan hanya heap.

### 9.2 Java Sering Punya Startup Dependency

Banyak Java service butuh:

- database,
- message broker,
- config server,
- Redis,
- search engine,
- object storage,
- external API.

Dalam Compose, service dependency sering terlihat seperti:

```yaml
services:
  app:
    depends_on:
      - postgres
```

Tetapi “container postgres started” tidak sama dengan “PostgreSQL ready menerima koneksi”. Ini akan dibahas pada Compose dan healthcheck part.

### 9.3 Java Punya Graceful Shutdown yang Penting

Saat deployment, orchestrator atau Docker mengirim signal. Aplikasi harus berhenti dengan benar:

- stop menerima request baru,
- selesaikan request aktif,
- flush logs/metrics,
- close DB pool,
- commit/rollback transaction,
- stop consumer message broker,
- release lock,
- shutdown executor.

Kalau ENTRYPOINT salah, wrapper script tidak `exec`, atau process tidak menerima SIGTERM, graceful shutdown bisa gagal.

### 9.4 Java Image Bisa Besar

Fat JAR + JDK + OS package + build tool bisa membuat image besar. Image besar berdampak pada:

- build time,
- push time,
- pull time,
- rollout speed,
- registry storage,
- attack surface,
- vulnerability count.

Tetapi image paling kecil juga tidak selalu paling baik. Distroless/minimal image sulit didebug. Senior engineer harus bisa memilih trade-off.

### 9.5 Java Dependency Chain Panjang

Satu image Java bisa membawa:

- base OS,
- libc,
- CA certificates,
- timezone data,
- JVM distribution,
- Java dependencies,
- native dependencies,
- app resources,
- build plugins,
- generated code.

Supply chain Docker untuk Java bukan hanya `pom.xml`. Base image juga dependency production.

---

## 10. Skill Map Docker untuk Java Engineer

Docker skill bisa dibagi menjadi beberapa level.

### Level 0 — Can Run Commands

Ciri-ciri:

- bisa `docker run`, `docker ps`, `docker stop`, `docker rm`,
- bisa menjalankan database lokal,
- bisa mengikuti tutorial.

Batasan:

- belum paham image/container/layer,
- bingung saat container exit,
- sering pakai `latest`,
- sering trial-and-error.

### Level 1 — Can Containerize an App

Ciri-ciri:

- bisa menulis Dockerfile sederhana,
- bisa build image Java,
- bisa expose port,
- bisa menjalankan app dengan env var,
- bisa pakai Compose sederhana.

Batasan:

- image mungkin besar,
- build cache buruk,
- root user default,
- secret handling lemah,
- graceful shutdown belum dipikirkan.

### Level 2 — Understand Runtime Semantics

Ciri-ciri:

- paham ENTRYPOINT vs CMD,
- paham port publishing,
- paham bind mount vs volume,
- paham `docker inspect`,
- paham exit code,
- paham logs stdout/stderr,
- bisa debug DNS/container networking sederhana.

Batasan:

- belum kuat pada supply chain,
- belum optimal pada BuildKit/cache,
- belum mendalam pada JVM container behavior.

### Level 3 — Production-Ready Containerization

Ciri-ciri:

- image kecil tapi tetap operable,
- non-root user,
- multi-stage build,
- dependency cache optimal,
- runtime config clean,
- healthcheck masuk akal,
- Java memory tuned terhadap container limit,
- graceful shutdown benar,
- tag/digest strategy jelas,
- logs dan diagnostics siap.

### Level 4 — Platform and Failure-Oriented Thinking

Ciri-ciri:

- bisa desain local dev platform dengan Compose,
- bisa membuat CI image pipeline aman,
- bisa membaca failure mode dari logs/inspect/events,
- bisa membedakan Docker problem vs app problem vs host problem,
- bisa mengevaluasi base image strategy,
- bisa melakukan supply chain review,
- bisa menjelaskan risiko rootful Docker, user namespace, rootless mode,
- bisa membuat postmortem container incident.

### Level 5 — Top-Tier Docker Fluency

Ciri-ciri:

- Docker bukan command set, tapi runtime model,
- bisa membuat invariant deployment artifact,
- bisa mendesain promotion by digest,
- bisa mengoptimalkan build graph,
- bisa menangani multi-platform image,
- bisa membuat debug strategy untuk minimal/distroless image,
- bisa menghubungkan Docker behavior dengan JVM, OS, network, CI, registry, dan security,
- bisa membuat standar containerization untuk tim Java.

Target seri ini adalah membawa kamu minimal ke Level 4, dengan cukup fondasi untuk bergerak ke Level 5 melalui praktik nyata.

---

## 11. Apa yang Tidak Akan Diulang dari Seri Lain

Karena kamu sudah atau akan memiliki banyak seri lain, Docker series ini harus efisien.

### 11.1 Tidak Mengulang Linux Kernel

Kita akan menyebut namespace, cgroup, UID/GID, mount, signal, dan process. Tetapi hanya dari perspektif Docker runtime. Kita tidak akan masuk detail kernel internals yang sudah masuk seri Linux Kernel.

Contoh yang akan dibahas:

```text
Kenapa PID 1 di container penting untuk signal handling?
```

Contoh yang tidak akan diulang:

```text
Implementasi internal Linux scheduler atau VFS secara mendalam.
```

### 11.2 Tidak Mengulang HTTP Backend/Frontend

Kita akan membahas port binding, container networking, health endpoint, dan logs. Tetapi tidak mengulang HTTP semantics, cache, header, browser behavior, proxy semantics, dan API design.

Contoh yang akan dibahas:

```text
Kenapa service bind ke 127.0.0.1 inside container tidak reachable dari container network lain?
```

Contoh yang tidak akan diulang:

```text
HTTP caching, ETag, CORS, TLS handshake detail.
```

### 11.3 Tidak Mengulang Nginx

Kita bisa memakai Nginx sebagai contoh container, tetapi tidak mendalami Nginx config mastery.

### 11.4 Tidak Mengulang Database/Messaging Internals

Kita akan menjalankan PostgreSQL, Redis, Kafka, RabbitMQ, Elasticsearch, dan service lain di Compose sebagai dependency lokal. Tetapi fokusnya adalah lifecycle, volume, healthcheck, network, dan reset strategy, bukan internals masing-masing sistem.

### 11.5 Tidak Mengulang Scripting

Kita akan menyebut Makefile/script wrapper hanya sebagai developer UX. Tidak mendalami Bash/Powershell/Makefile.

### 11.6 Tidak Mengulang Kubernetes

Kita akan membahas batas Docker vs orchestrator. Tetapi tidak membahas Kubernetes object model, scheduler, controller, pod, service, ingress, deployment, dan sebagainya secara mendalam.

Docker adalah fondasi penting untuk Kubernetes, tetapi seri ini bukan Kubernetes series.

---

## 12. Docker Workflow Besar

Docker workflow biasanya terdiri dari lima fase:

```text
1. Author
2. Build
3. Share
4. Run
5. Observe/Operate
```

### 12.1 Author

Kamu menulis:

```text
Dockerfile
.dockerignore
compose.yaml
entrypoint script if needed
healthcheck definition
```

Untuk Java, kamu juga menyiapkan:

```text
pom.xml / build.gradle
Spring Boot config conventions
JVM options
logging config
actuator health endpoints
```

### 12.2 Build

Kamu menjalankan:

```bash
docker build -t my-service:dev .
```

Modern Docker build memakai Buildx/BuildKit. BuildKit menyelesaikan instruksi build dan menjalankan build steps. Docker docs menjelaskan BuildKit sebagai improved backend yang menggantikan legacy builder dan menjadi default untuk Docker Desktop dan Docker Engine modern.

Build bukan hanya “menjalankan script”. Build menghasilkan image layer graph.

### 12.3 Share

Kamu push image ke registry:

```bash
docker push registry.example.com/my-service:1.2.3
```

Registry menyimpan image agar environment lain bisa pull.

### 12.4 Run

Kamu menjalankan container:

```bash
docker run --name my-service -p 8080:8080 registry.example.com/my-service:1.2.3
```

Atau menjalankan stack lokal:

```bash
docker compose up
```

Compose memudahkan kontrol stack aplikasi dengan services, networks, dan volumes dalam satu YAML configuration.

### 12.5 Observe/Operate

Kamu melihat:

```bash
docker ps
docker logs
docker inspect
docker stats
docker events
```

Kamu mendiagnosis:

- process status,
- exit code,
- health status,
- restart count,
- logs,
- resource usage,
- network,
- mount,
- runtime config.

---

## 13. Dockerfile Pertama yang Sengaja Belum Ideal

Bayangkan aplikasi Java sederhana menghasilkan `target/app.jar`.

Dockerfile sangat sederhana:

```dockerfile
FROM eclipse-temurin:21
WORKDIR /app
COPY target/app.jar app.jar
CMD ["java", "-jar", "app.jar"]
```

Build:

```bash
docker build -t my-java-app:dev .
```

Run:

```bash
docker run --rm -p 8080:8080 my-java-app:dev
```

Ini cukup untuk orientasi. Tetapi sebagai engineer senior, kamu harus melihat banyak pertanyaan terbuka.

### 13.1 Apa yang Baik dari Dockerfile Ini?

- Sederhana.
- Menggunakan `WORKDIR` eksplisit.
- Menggunakan exec form `CMD`, bukan shell form.
- Artifact aplikasi jelas.
- Bisa dijalankan di environment lain selama platform kompatibel.

### 13.2 Apa yang Belum Ideal?

1. Base image belum dipilih dengan strategi jelas.
2. Tag `eclipse-temurin:21` mungkin berubah dari waktu ke waktu.
3. App kemungkinan berjalan sebagai root.
4. Tidak ada healthcheck.
5. Tidak ada label metadata.
6. Tidak ada memory/JVM tuning.
7. Tidak ada multi-stage build.
8. Build artifact diasumsikan sudah ada di host.
9. Tidak ada `.dockerignore`.
10. Tidak ada distinction dev vs production.
11. Tidak ada supply chain consideration.
12. Tidak ada explicit writable path policy.
13. Tidak ada graceful shutdown verification.

Part berikutnya akan memperbaiki model ini secara bertahap. Jangan lompat langsung ke “best Dockerfile” tanpa memahami kenapa pola itu dibutuhkan.

---

## 14. Docker Compose Pertama yang Sengaja Belum Ideal

Untuk local dev, kamu mungkin punya:

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      DB_URL: jdbc:postgresql://postgres:5432/app
      DB_USERNAME: app
      DB_PASSWORD: app
    depends_on:
      - postgres

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "5432:5432"
```

Ini berguna. Tetapi belum production-grade dan bahkan belum tentu robust untuk local dev.

Pertanyaan penting:

1. Apakah `postgres:16` cukup spesifik?
2. Apakah volume dibutuhkan agar data persistent?
3. Apakah sebaiknya data ephemeral untuk test?
4. Apakah app menunggu PostgreSQL ready, atau hanya container started?
5. Apakah password aman? Untuk local mungkin oke, untuk production tidak.
6. Apakah port 5432 perlu dipublish ke host?
7. Apakah ada healthcheck?
8. Apakah network default cukup?
9. Apakah migration dijalankan oleh app, init container-like process, atau manual?
10. Bagaimana reset environment?

Compose bukan hanya “run multiple containers”. Compose adalah model sistem lokal. Kalau modelnya buruk, tim akan mengalami flaky local environment.

---

## 15. Docker dan Reproducibility

Salah satu janji Docker adalah reproducibility. Tetapi Docker tidak otomatis membuat sistem reproducible.

### 15.1 Apa yang Dibantu Docker

Docker membantu karena image mendeklarasikan runtime filesystem dan metadata. Environment tidak sepenuhnya tergantung server manual.

Dengan Docker, kamu bisa berkata:

```text
Run this image digest with these env vars, mounts, ports, and resource limits.
```

Itu lebih presisi daripada:

```text
Install Java, copy jar, configure server like staging.
```

### 15.2 Apa yang Masih Bisa Tidak Reproducible

Docker build bisa tetap tidak reproducible jika:

- base image tag berubah,
- OS package tidak dipin,
- dependency Maven/Gradle berubah,
- build memakai timestamp tidak stabil,
- build download dari internet tanpa lock,
- Dockerfile memakai `latest`,
- build context berisi file tak terduga,
- CI rebuild per environment,
- artifact dibuat di luar Docker dengan toolchain berbeda,
- secret/config masuk saat build.

Jadi Docker adalah alat untuk reproducibility, bukan jaminan.

### 15.3 Reproducibility yang Benar

Targetnya:

```text
Given source revision + locked dependencies + pinned base + deterministic build config,
produce image with known digest,
then promote exactly that digest.
```

Untuk production, digest lebih penting daripada tag manusiawi.

---

## 16. Docker dan Immutability

Container image harus dianggap immutable. Setelah image dibuild, image tidak diubah. Kalau butuh perubahan, build image baru.

Container instance harus dianggap disposable. Kalau container rusak, jangan SSH dan patch manual. Recreate dari image dan runtime config yang benar.

Prinsip:

```text
Do not repair containers. Repair the image, config, or environment, then recreate.
```

Anti-pattern klasik:

```bash
docker exec -it app bash
apt-get install something
edit config file manually
restart process inside container
```

Ini mungkin berguna untuk debugging sementara, tetapi bukan operational model.

Kalau kamu memperbaiki production dengan mutation manual inside container, kamu menciptakan snowflake runtime yang tidak bisa direproduksi.

---

## 17. Docker dan State

Container sebaiknya disposable, tetapi aplikasi sering butuh state.

State bisa berupa:

- database data,
- uploaded files,
- logs,
- cache,
- temporary files,
- generated reports,
- queue data,
- search index,
- object storage,
- local embedded DB,
- certificates,
- config files.

Docker memaksa kamu bertanya:

```text
State ini milik image, container writable layer, volume, bind mount, external service, atau object storage?
```

Prinsip umum:

| Jenis data | Tempat ideal |
|---|---|
| Application binary | Image |
| Static runtime default | Image |
| Environment-specific config | Runtime env/config mount |
| Secret | Secret manager/file mount/runtime injection |
| Business data | External database/storage |
| Logs | stdout/stderr, collector |
| Temporary files | `/tmp` or tmpfs with limits |
| Cache | Explicit volume or external cache depending need |

Kesalahan umum:

```text
App writes important uploaded files into container filesystem.
Container removed.
Data gone.
```

Atau:

```text
Logs only written to /var/log/app.log inside container.
No log driver/volume.
Container recreated.
Logs gone.
```

Docker tidak menghapus kebutuhan desain state. Docker membuat desain state lebih eksplisit.

---

## 18. Docker dan Network Mental Model

Di host biasa, aplikasi Java mungkin listen di:

```text
localhost:8080
```

Dalam Docker, `localhost` bisa berarti beberapa hal tergantung posisi kamu:

| Dari mana? | `localhost` menunjuk ke mana? |
|---|---|
| Host machine | Host network namespace |
| Container app | Container itu sendiri |
| Container A | Container A, bukan Container B |
| Container B | Container B, bukan host |

Ini sumber bug sangat sering.

Kalau app di container ingin connect ke PostgreSQL service di Compose, biasanya bukan:

```text
localhost:5432
```

melainkan:

```text
postgres:5432
```

karena Compose memberi DNS service name pada network Compose. Docker Compose docs menjelaskan bahwa dalam default network Compose, container untuk service dapat saling mencapai dan discoverable by service name.

Port publishing juga sering disalahpahami:

```yaml
ports:
  - "8080:8080"
```

Ini berarti:

```text
host port 8080 → container port 8080
```

Bukan berarti aplikasi otomatis listen di port itu. Aplikasi tetap harus listen di container port yang benar.

---

## 19. Docker dan Security Mental Model

Docker bukan security boundary absolut.

Container memberi isolation, tetapi:

- container berbagi kernel host,
- Docker daemon biasanya privileged,
- root inside container bisa berbahaya jika dikombinasikan dengan mount/capability tertentu,
- image bisa membawa vulnerable packages,
- secret bisa bocor ke layer/history/log/env,
- bind mount bisa memberi akses host filesystem,
- privileged container bisa mendekati host-level power.

Docker docs menyebut rootless mode menjalankan Docker daemon dan containers di dalam user namespace, sehingga daemon dan container berjalan tanpa root privileges. Docker juga mendukung user namespace remapping untuk memetakan root container ke user host yang lebih rendah privilege.

Baseline mental model:

```text
Container isolation reduces blast radius, but does not remove need for least privilege.
```

Untuk Java service, baseline hardening biasanya:

- jangan run sebagai root,
- gunakan base image terpercaya,
- update base image secara rutin,
- jangan bake secret ke image,
- gunakan read-only filesystem jika memungkinkan,
- batasi writable path,
- drop capability jika relevan,
- pin image/digest untuk production,
- scan image,
- log ke stdout/stderr,
- hindari privileged container,
- hindari mount Docker socket ke container kecuali benar-benar paham risikonya.

---

## 20. Docker dan Observability

Docker tidak menggantikan observability, tetapi memberi surface untuk observability runtime.

Minimal yang bisa kamu lihat:

```bash
docker ps
docker logs <container>
docker inspect <container>
docker stats <container>
docker events
docker top <container>
```

Untuk Java, kamu juga perlu:

- application logs,
- health endpoint,
- metrics,
- tracing,
- thread dump,
- heap dump,
- GC logs,
- JFR,
- exit code,
- OOMKilled status,
- restart count.

Container incident sering membutuhkan korelasi:

```text
Docker says container exited 137
   ↓
Was it OOMKilled?
   ↓
What was memory limit?
   ↓
What were JVM heap/native settings?
   ↓
Were there traffic spikes?
   ↓
Any thread explosion/direct buffer leak?
   ↓
Was host under memory pressure?
```

Docker memberi clue, bukan jawaban lengkap.

---

## 21. Docker dan CI/CD

Docker image adalah artifact ideal untuk CI/CD karena bisa dipromosikan.

Pipeline yang sehat:

```text
Commit source
   ↓
Run tests
   ↓
Build application artifact
   ↓
Build container image
   ↓
Scan image
   ↓
Push image to registry
   ↓
Record digest
   ↓
Deploy by digest to environment
   ↓
Promote same digest to next environment
```

Pipeline yang lemah:

```text
Build for dev
Build again for staging
Build again for production
Use same tag name
Hope all builds are equivalent
```

Masalah:

- dependency bisa berubah antar build,
- base image bisa berubah,
- build plugin bisa berubah,
- network artifact bisa berbeda,
- tag bisa overwrite,
- audit sulit.

Docker bisa memperbaiki CI/CD jika dipakai dengan prinsip artifact immutability.

---

## 22. Docker dan Developer Experience

Docker sering dipakai untuk local development:

```bash
docker compose up
```

Tujuannya bukan hanya “jalanin dependency”. Tujuannya membuat onboarding dan workflow tim lebih deterministik.

Local developer platform yang baik menjawab:

```text
How do I start the app?
How do I start dependencies?
How do I reset data?
How do I run migrations?
How do I seed test data?
How do I see logs?
How do I run integration tests?
How do I avoid port conflicts?
How do I configure env safely?
How do I run only the subset I need?
```

Docker yang buruk untuk developer experience menghasilkan:

- container zombie,
- stale volume,
- port conflict,
- hidden env var,
- magic script,
- slow bind mount,
- inconsistent local data,
- “works on my machine” versi baru.

Docker yang baik membuat sistem lokal lebih eksplisit dan resettable.

---

## 23. Common Misconceptions

### 23.1 “Container adalah VM ringan”

Lebih tepat:

```text
Container is an isolated process with packaged filesystem view and resource/network boundaries.
```

### 23.2 “Kalau jalan di Docker, pasti jalan di production”

Tidak selalu. Perbedaan bisa berasal dari:

- platform architecture,
- runtime config,
- resource limit,
- network policy,
- volume permission,
- host kernel,
- base image update,
- registry tag mutation,
- secret/config difference,
- Docker Desktop vs Linux server.

### 23.3 “Image kecil selalu lebih baik”

Image kecil mengurangi attack surface dan transfer time. Tetapi image terlalu minimal bisa sulit didebug. Pilihan terbaik tergantung environment, operational maturity, dan debug strategy.

### 23.4 “Compose sama dengan production orchestrator”

Compose bagus untuk local multi-service model dan kadang cukup untuk small production. Tetapi Compose bukan scheduler multi-node, bukan autoscaler, bukan Kubernetes replacement penuh.

### 23.5 “`depends_on` berarti dependency siap”

Tidak selalu. `depends_on` dasar menunjukkan order start, bukan readiness aplikasi secara semantik. Healthcheck-aware dependency perlu didesain.

### 23.6 “ENV aman untuk secret”

Env var mudah digunakan, tetapi bisa terlihat melalui inspect/process environment/log/crash dump tergantung sistem. Secret perlu diperlakukan hati-hati.

### 23.7 “Kalau pakai Docker, tidak perlu install apa pun di host”

Host tetap butuh Docker Engine/Desktop, kernel, storage driver, network setup, disk space, security policy, registry access, dan resource capacity.

### 23.8 “Dockerfile adalah script shell”

Dockerfile bukan sekadar script. Dockerfile membangun filesystem/image layer graph. Urutan instruction memengaruhi cache, size, reproducibility, dan security.

---

## 24. Invariant yang Harus Kamu Pegang Sepanjang Seri

Invariant adalah aturan yang membantu berpikir saat kompleksitas meningkat.

### Invariant 1 — Image adalah template immutable

Kalau butuh perubahan, build image baru.

### Invariant 2 — Container adalah runtime instance yang disposable

Jangan treat container seperti server permanen.

### Invariant 3 — Runtime config bukan build config

Jangan bake environment-specific config ke image.

### Invariant 4 — Tag bukan identity final

Digest lebih kuat untuk audit dan reproducibility.

### Invariant 5 — Container bukan VM

Container berbagi kernel host.

### Invariant 6 — Logs harus keluar dari process boundary

Default terbaik: stdout/stderr.

### Invariant 7 — State harus eksplisit

Tentukan apakah state berada di image, writable layer, volume, atau external service.

### Invariant 8 — Health bukan sekadar process alive

Aplikasi running belum tentu ready.

### Invariant 9 — Build harus deterministik sejauh mungkin

Pin dependency, kontrol cache, dan catat digest.

### Invariant 10 — Security adalah konfigurasi, bukan efek otomatis

Rootless, non-root user, user namespace, capabilities, secret handling, dan scanning perlu didesain.

---

## 25. Docker Problem vs Application Problem

Engineer kuat bisa membedakan sumber masalah.

### 25.1 Docker Problem

Contoh:

- image tidak bisa dipull,
- registry auth gagal,
- container tidak bisa dibuat,
- port host sudah dipakai,
- volume mount gagal,
- platform architecture salah,
- daemon error,
- storage penuh,
- network Docker corrupt.

### 25.2 Application Problem

Contoh:

- Spring Boot gagal start,
- DB migration gagal,
- config missing,
- port salah,
- app bind ke localhost,
- connection pool salah,
- schema mismatch,
- Java OOM,
- uncaught exception.

### 25.3 Runtime Contract Problem

Ini kategori paling menarik.

Contoh:

- image benar, app benar, tetapi env var production salah,
- app butuh writable `/tmp`, tetapi filesystem read-only,
- app butuh CA cert, base image tidak punya,
- JVM heap config tidak sesuai memory limit,
- wrapper script menelan SIGTERM,
- healthcheck terlalu agresif sehingga restart terus,
- Compose dependency started tetapi belum ready.

Docker mastery banyak berada di kategori ketiga: memahami kontrak antara image, app, dan runtime environment.

---

## 26. Cara Membaca Incident Docker

Saat ada masalah container, jangan langsung random command. Pakai urutan berpikir.

### 26.1 Pertanyaan Pertama

```text
Apakah container berhasil dibuat?
Apakah container pernah start?
Apakah process masih running?
Kalau exit, exit code berapa?
Apakah OOMKilled?
Apa log terakhir?
Apa command/entrypoint efektif?
Apa env efektif?
Apa mount efektif?
Apa network efektif?
Apa resource limit efektif?
Apa image digest/tag yang dipakai?
```

### 26.2 Minimal Command Surface

```bash
docker ps -a
docker logs <container>
docker inspect <container>
docker stats <container>
docker events
```

### 26.3 Interpretasi Cepat

```text
Container not found
  → naming/project/lifecycle issue

Image not found
  → build/pull/tag/registry issue

Exit 0 immediately
  → command selesai; mungkin bukan long-running process

Exit 1
  → application/config/startup failure

Exit 125
  → docker run/create failure

Exit 126/127
  → command permission/not found issue

Exit 137
  → often SIGKILL/OOMKilled; verify inspect

Connection refused
  → process not listening, wrong port, wrong address, not ready

No such host
  → DNS/network/service name issue

Permission denied
  → UID/GID/mount/filesystem/security policy issue
```

Part 029 nanti akan menjadi catalogue failure yang jauh lebih detail.

---

## 27. Docker dalam Arsitektur Sistem

Docker berada di antara beberapa dunia:

```text
Application architecture
Build system
Operating system
Networking
Security
CI/CD
Runtime operations
Developer platform
```

Karena itu, Docker sering menjadi titik temu konflik.

Contoh konflik:

### 27.1 Dev Ingin Cepat, Security Ingin Ketat

Dev ingin image dengan shell, curl, debug tools.

Security ingin distroless, non-root, minimal packages.

Solusi senior:

```text
Use minimal runtime image + separate debug image / debug workflow.
```

### 27.2 CI Ingin Cache Cepat, Security Ingin Fresh Dependencies

Cache mempercepat build, tetapi cache bisa menyembunyikan update security.

Solusi senior:

```text
Use controlled cache, scheduled base rebuild, vulnerability scanning, and dependency pinning.
```

### 27.3 App Ingin Startup Cepat, Dependency Belum Ready

Compose start order bukan readiness.

Solusi senior:

```text
App should tolerate dependency startup, use retries/backoff, and expose readiness accurately.
```

### 27.4 Image Kecil, Tapi Incident Sulit

Distroless image tidak punya shell.

Solusi senior:

```text
Do not debug by mutating production container. Use inspect/logs, ephemeral debug container, or debug variant image.
```

---

## 28. Docker untuk Regulatory/Case Management Systems

Karena konteksmu berkaitan dengan regulatory systems, enforcement lifecycle, complex case management, dan defensibility, Docker punya dimensi tambahan.

Sistem semacam ini biasanya butuh:

- auditability,
- traceability,
- reproducibility,
- controlled change,
- rollback clarity,
- environment parity,
- evidence integrity,
- operational explainability.

Docker bisa membantu jika dipakai dengan disiplin:

### 28.1 Artifact Traceability

Setiap deployment harus bisa menjawab:

```text
Source commit apa?
Build pipeline run apa?
Image digest apa?
Base image apa?
Dependency set apa?
Config version apa?
Siapa approve?
Kapan dipromosikan?
```

### 28.2 Reproducible Runtime

Untuk kasus regulatory, “kita deploy ulang dari branch yang sama” belum cukup kuat. Lebih baik:

```text
We deployed the exact same image digest that passed staging verification.
```

### 28.3 Controlled Runtime Mutation

Manual patch inside container harus dianggap pelanggaran operational discipline kecuali dalam emergency break-glass dengan audit.

### 28.4 Evidence During Incident

Saat incident, Docker metadata membantu:

- image digest,
- env config,
- mount,
- network,
- exit code,
- health status,
- restart count,
- logs,
- resource limit.

Tetapi metadata ini harus dikumpulkan sebelum container/log dihapus.

---

## 29. Mini Case Study: “Works on My Machine”

### Situasi

Developer menjalankan service Java lokal tanpa Docker:

```bash
java -jar app.jar
```

Berjalan baik.

Di Docker:

```bash
docker run -p 8080:8080 app
```

Tidak bisa diakses.

### Kemungkinan Root Cause

1. App listen di port berbeda.
2. App bind ke `127.0.0.1`, bukan `0.0.0.0`.
3. Container crash setelah startup.
4. Port host sudah dipakai.
5. Wrong image version.
6. App butuh env var yang tidak diberikan.
7. Health endpoint OK tapi business endpoint gagal.
8. Firewall/security policy host.
9. Docker Desktop networking difference.

### Cara Berpikir

Jangan langsung ubah Dockerfile.

Pertama lihat fakta:

```bash
docker ps -a
docker logs app
docker inspect app
docker port app
```

Lalu jawab:

```text
Apakah process running?
Apakah app log menunjukkan listening port?
Apakah container port benar?
Apakah host port benar?
Apakah app bind address benar?
Apakah env lengkap?
```

Docker debugging adalah proses mempersempit boundary.

---

## 30. Mini Case Study: Java Container Mati Exit 137

### Situasi

Container Java mati tiba-tiba. `docker ps -a` menunjukkan exit 137.

### Interpretasi Awal

Exit 137 sering berarti process menerima SIGKILL. Dalam container, ini sering terkait OOMKilled, tetapi harus diverifikasi.

### Pertanyaan

```text
Apakah inspect menunjukkan OOMKilled true?
Apa memory limit container?
Apa JVM -Xmx?
Apakah direct memory besar?
Apakah thread count naik?
Apakah container punya swap?
Apakah host memory pressure?
Apakah logs menunjukkan Java OutOfMemoryError atau langsung mati?
```

### Perbedaan Penting

Java `OutOfMemoryError`:

```text
JVM masih hidup cukup lama untuk throw error/log stacktrace.
```

Container OOMKilled:

```text
Kernel membunuh process. Aplikasi bisa tidak sempat log apa pun.
```

Ini alasan Docker dan JVM harus dipahami bersama.

---

## 31. Mini Case Study: Image Sama, Behavior Beda

### Situasi

Image digest sama berjalan baik di staging, gagal di production.

### Kesimpulan Awal

Kalau digest sama, binary/filesystem image sama. Maka perbedaan kemungkinan ada di runtime environment atau external dependency.

### Area Investigasi

```text
environment variables
secret values
network policy
DNS
volume mounts
file permissions
resource limits
CPU architecture
host kernel/runtime version
external service version
TLS certificates
clock/timezone
feature flags
```

Docker membantu mempersempit investigasi. Kalau image digest sama, jangan mulai dengan asumsi “code beda”. Mulai dari runtime contract.

---

## 32. Command yang Boleh Dikenal Sekarang

Part ini bukan command tutorial, tetapi beberapa command akan sering muncul.

```bash
# Lihat container aktif
docker ps

# Lihat semua container, termasuk exited
docker ps -a

# Lihat image lokal
docker images

# Build image dari Dockerfile
docker build -t my-app:dev .

# Run container
docker run --rm -p 8080:8080 my-app:dev

# Lihat logs
docker logs <container>

# Inspect detail container/image
docker inspect <container-or-image>

# Jalankan command di container running
docker exec -it <container> sh

# Lihat resource usage
docker stats

# Start Compose stack
docker compose up

# Stop Compose stack
docker compose down
```

Kita akan membedah command-command ini berdasarkan mental model, bukan hafalan.

---

## 33. Checklist Mental Model Setelah Part 000

Setelah membaca part ini, kamu seharusnya bisa menjelaskan:

- Docker bukan mini VM.
- Container adalah process dengan boundary.
- Image adalah template immutable.
- Container adalah runtime instance.
- Tag bukan identity immutable.
- Digest lebih kuat untuk production audit.
- Registry adalah bagian dari supply chain.
- Runtime config berbeda dari build config.
- Container writable layer bukan tempat state penting.
- Java dalam container butuh perhatian memory, CPU, signal, logs, dan dependency.
- Compose adalah local system model, bukan sekadar command untuk menjalankan banyak container.
- Docker membantu reproducibility, tetapi tidak menjaminnya otomatis.
- Docker security bukan otomatis aman; least privilege tetap perlu.
- Debugging Docker harus dimulai dari fakta runtime.

---

## 34. Latihan Konseptual

Jawab tanpa menjalankan command dulu.

### Latihan 1

Kamu punya image `case-service:latest`. Kemarin image itu berjalan baik. Hari ini deployment dengan tag sama gagal. Apa kemungkinan penyebabnya?

Petunjuk:

- Apakah tag immutable?
- Apakah digest sama?
- Apakah runtime config sama?
- Apakah dependency eksternal sama?

### Latihan 2

Container Java mati tanpa log error. Exit code 137. Apa saja hipotesis yang perlu diuji?

Petunjuk:

- SIGKILL.
- OOMKilled.
- Memory limit.
- JVM heap vs native memory.
- Host pressure.

### Latihan 3

Aplikasi berjalan dalam container dan log menunjukkan `Started on port 8080`, tetapi tidak bisa diakses dari host. Apa saja yang harus dicek?

Petunjuk:

- `docker ps` port mapping.
- App bind address.
- Host port collision.
- Firewall.
- Container masih running atau sudah exit.

### Latihan 4

Kenapa menjalankan database dalam container untuk local dev tidak sama dengan mendesain database production?

Petunjuk:

- Docker lifecycle.
- Volume.
- Persistence.
- Backup.
- Performance.
- Security.
- HA.

### Latihan 5

Kenapa image kecil tidak selalu otomatis lebih baik?

Petunjuk:

- Attack surface.
- Pull time.
- Debuggability.
- Operational maturity.
- Separate debug strategy.

---

## 35. Ringkasan Part 000

Docker harus dipahami sebagai gabungan dari:

```text
Packaging discipline
Runtime boundary
Artifact distribution
Developer workflow
CI/CD primitive
Operational diagnostic surface
Security configuration surface
```

Untuk Java engineer, Docker menyentuh build artifact, JVM runtime, memory behavior, startup dependency, graceful shutdown, logs, healthcheck, dependency packaging, dan production promotion.

Kalau hanya menghafal command, Docker akan terasa mudah sampai incident pertama. Kalau memahami modelnya, Docker menjadi alat untuk membuat sistem lebih eksplisit, reproducible, debuggable, dan defensible.

Part berikutnya akan masuk ke mental model container sebagai process boundary: namespace, cgroup, filesystem view, user boundary, dan resource control dari perspektif Docker tanpa mengulang Linux Kernel internals.

---

## 36. Status Seri

- File ini: `learn-docker-mastery-for-java-engineers-part-000.md`
- Part saat ini: 000 dari 031
- Status: seri belum selesai
- Lanjut berikutnya: `learn-docker-mastery-for-java-engineers-part-001.md` — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-001.md">Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary ➡️</a>
</div>
