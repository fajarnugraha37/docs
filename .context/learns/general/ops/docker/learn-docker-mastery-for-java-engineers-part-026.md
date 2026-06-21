# learn-docker-mastery-for-java-engineers-part-026.md

# Part 026 — Docker Desktop vs Linux Server: Development Convenience vs Runtime Reality

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: memahami perbedaan Docker di laptop dengan Docker di Linux server agar tidak salah membaca failure, performance, filesystem, dan networking behavior.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun mental model tentang:

- container sebagai proses yang dibatasi namespace, cgroup, dan filesystem boundary;
- Docker architecture: CLI, daemon, Engine, containerd, runc;
- image, layer, tag, digest, manifest, platform;
- Dockerfile, BuildKit, multi-stage build;
- runtime Java di container;
- Compose, healthcheck, config, security, supply chain, CI/CD, multi-platform image.

Part ini membahas sebuah sumber kebingungan besar di dunia nyata:

> Docker yang kamu pakai di laptop belum tentu identik secara operasional dengan Docker yang menjalankan service di Linux server.

Ini bukan berarti Docker tidak portable. Docker tetap memberikan packaging dan runtime contract yang sangat kuat. Namun, portability Docker bekerja di atas beberapa asumsi:

1. platform target sama atau compatible;
2. filesystem behavior cukup dekat;
3. network path dan DNS behavior dipahami;
4. resource limit dipahami;
5. dev environment tidak disamakan mentah-mentah dengan production environment.

Docker Desktop adalah tool developer experience. Docker Engine di Linux server adalah runtime yang lebih langsung terhadap kernel host. Keduanya sama-sama menjalankan container, tetapi lapisan di sekitarnya berbeda.

---

## 1. Core Thesis

Ada satu kalimat yang harus diingat:

> Di Linux server, container berjalan langsung di atas kernel host. Di Docker Desktop pada macOS/Windows, Linux container biasanya berjalan di dalam lingkungan Linux VM/WSL2 yang dikelola Docker Desktop.

Implikasinya besar:

- file yang kamu bind mount dari laptop bisa melewati boundary host OS ke VM;
- `localhost` bisa berarti host berbeda tergantung arah akses;
- resource limit container berada di dalam limit VM/Desktop;
- path, permission, file watcher, case sensitivity, dan line ending bisa berbeda;
- startup dan IO latency bisa lebih buruk di laptop dibanding Linux server;
- `host.docker.internal` adalah convenience abstraction, bukan konsep Linux container native universal;
- Docker Desktop memiliki GUI, integrasi, extension, dan VM management yang tidak identik dengan Docker Engine server.

Docker Desktop dokumentasi resmi menyebut Docker Desktop sebagai aplikasi one-click-install untuk Mac, Linux, atau Windows yang membantu build, share, dan run containerized applications dan menyediakan GUI untuk mengelola containers, applications, dan images. Docker Engine install documentation membedakan Docker Engine di Linux dari Docker Desktop yang juga menyediakan Engine di Windows/macOS/Linux melalui Desktop distribution. Sumber resmi: Docker Desktop docs, Docker Engine install docs.

---

## 2. Kenapa Ini Penting untuk Java Engineer

Java engineer sering mengembangkan service dengan stack seperti:

- Spring Boot service;
- PostgreSQL/MySQL;
- Redis;
- Kafka/RabbitMQ;
- Elasticsearch;
- MinIO;
- mock service;
- OpenTelemetry collector;
- local reverse proxy;
- integration test via Testcontainers.

Di laptop, stack ini sering dijalankan via Docker Desktop + Compose. Di production, service mungkin berjalan:

- di Linux VM dengan Docker Engine;
- di ECS/Fargate;
- di Kubernetes;
- di Nomad;
- di container runtime lain;
- di managed platform.

Walaupun part ini tidak masuk Kubernetes, prinsipnya tetap penting: local Docker bukan production runtime yang sempurna.

Contoh real-world symptoms:

1. Di Mac, rebuild lambat karena bind mount source code melewati file sharing layer.
2. Di Windows, file permission terlihat aneh karena NTFS/WSL boundary.
3. Di laptop, service bisa akses host via `host.docker.internal`; di Linux server nama itu belum tentu tersedia.
4. Di CI Linux, test case-sensitive gagal karena di Mac filesystem default bisa case-insensitive.
5. Di Docker Desktop, container terlihat OOM padahal limit Desktop VM terlalu kecil.
6. Di production Linux, performance lebih baik atau lebih buruk karena storage driver, kernel, cgroup version, dan host tuning berbeda.
7. Di laptop Apple Silicon, image ARM berjalan, tetapi production x86 gagal karena native dependency atau manifest salah.

Part ini membangun kemampuan membedakan:

- Docker semantic contract;
- Desktop convenience behavior;
- Linux runtime reality;
- application bug;
- environment mismatch.

---

## 3. Mental Model: Tiga Lapisan Runtime

Untuk memahami perbedaan Docker Desktop dan Linux Server, gunakan model tiga lapisan.

```text
┌───────────────────────────────────────────────┐
│ Application layer                              │
│ - Java process                                 │
│ - JVM, GC, thread pool, files, sockets         │
└───────────────────────────────────────────────┘
                    │
┌───────────────────────────────────────────────┐
│ Container runtime layer                        │
│ - Docker Engine / containerd / runc            │
│ - namespaces, cgroups, overlay filesystem      │
│ - image layers, networks, mounts               │
└───────────────────────────────────────────────┘
                    │
┌───────────────────────────────────────────────┐
│ Host integration layer                         │
│ - Linux server kernel directly                 │
│ - OR Docker Desktop VM / WSL2 / file sharing   │
│ - host OS networking, DNS, firewall, proxy     │
└───────────────────────────────────────────────┘
```

Pada Linux server, container runtime layer lebih dekat ke host kernel.

Pada Docker Desktop macOS/Windows, ada host integration layer tambahan:

```text
macOS / Windows host
    │
    ├── Docker Desktop app / helper services
    │
    ├── Linux VM or WSL2 backend
    │       │
    │       ├── Docker Engine
    │       ├── containerd
    │       ├── Linux kernel environment
    │       └── containers
    │
    └── file sharing / networking bridge / DNS integration
```

Akibatnya, saat kamu berkata “container saya berjalan di laptop”, secara praktis sering berarti:

> container berjalan di Linux environment yang hidup di dalam Desktop-managed VM/WSL2, lalu Desktop menyediakan jembatan ke host OS.

---

## 4. Docker Engine di Linux Server

Docker Engine di Linux server biasanya terdiri dari:

- Docker CLI;
- Docker daemon (`dockerd`);
- Docker Engine API;
- containerd;
- runc;
- storage driver;
- network driver;
- Linux kernel primitives.

Arsitektur konseptual:

```text
Linux host
  ├── dockerd
  ├── containerd
  ├── runc
  ├── image store
  ├── overlay filesystem
  ├── docker bridge/networking
  └── containers as Linux processes
```

Karakteristik penting:

1. Kernel yang dilihat container adalah kernel host Linux.
2. Cgroup limit diterapkan langsung oleh kernel host.
3. Storage driver bekerja di filesystem host.
4. Bind mount adalah mount dari filesystem Linux host.
5. Network bridge adalah Linux networking langsung.
6. Permission adalah Unix permission native.
7. Performance path lebih pendek dibanding Desktop pada macOS/Windows.

Ini membuat Linux server lebih dekat dengan container mental model yang sudah kita bahas di Part 001.

Namun, Linux server juga punya realitas production:

- host patching;
- disk pressure;
- log rotation;
- daemon config;
- cgroup v1/v2;
- SELinux/AppArmor;
- kernel version;
- firewall rules;
- corporate registry;
- systemd;
- rootless/rootful daemon;
- user namespace remapping;
- storage driver compatibility.

Jadi Linux server bukan “simple”, tetapi path-nya lebih langsung.

---

## 5. Docker Desktop di macOS

macOS tidak menjalankan Linux containers langsung di kernel macOS, karena container Linux membutuhkan Linux kernel primitives seperti namespaces dan cgroups. Docker Desktop menyediakan Linux environment melalui VM.

Simplified model:

```text
macOS host
  ├── Docker Desktop GUI
  ├── CLI integration
  ├── Desktop-managed Linux VM
  │     ├── Docker Engine
  │     ├── containerd
  │     ├── Linux kernel
  │     └── containers
  ├── file sharing bridge
  ├── port forwarding
  └── host integration helpers
```

Implikasi:

- bind mount dari `/Users/...` perlu dijembatani ke Linux VM;
- file watcher bisa lambat atau berbeda;
- ownership/permission bisa terasa tidak sama seperti Linux native;
- `localhost` dari host ke container bekerja melalui port forwarding Desktop;
- container ke host memakai mekanisme khusus seperti `host.docker.internal`;
- resource CPU/memory/disk sering dikontrol dari Docker Desktop settings;
- image architecture bisa ARM64 di Apple Silicon dan AMD64 via emulation.

Untuk Java engineer, efek paling terasa biasanya:

1. Gradle/Maven build dengan bind mount lambat.
2. Spring Boot devtools restart/file watcher tidak konsisten.
3. Testcontainers startup terasa lebih lambat dibanding Linux CI.
4. Database volume performance berbeda.
5. Native library image salah platform.

---

## 6. Docker Desktop di Windows dengan WSL2

Pada Windows modern, Docker Desktop umumnya menggunakan WSL2 backend untuk Linux containers.

Docker documentation menjelaskan bahwa Docker Desktop dengan WSL2 memungkinkan user memakai Linux workspaces dan menghindari maintain build script terpisah Linux/Windows. WSL2 menyediakan full Linux kernel dari Microsoft, peningkatan file system sharing, cold-start time lebih cepat, dan dynamic resource allocation.

Simplified model:

```text
Windows host
  ├── Docker Desktop
  ├── WSL2 backend
  │     ├── Linux kernel environment
  │     ├── Docker integration distro
  │     └── containers
  ├── Windows filesystem: C:\...
  ├── WSL filesystem: /home/...
  ├── port forwarding / networking integration
  └── host integration helpers
```

Critical distinction:

```text
C:\Users\you\project       -> Windows filesystem
/home/you/project          -> WSL Linux filesystem
```

Untuk project Java, biasanya jauh lebih baik menaruh source code di filesystem WSL (`/home/...`) bila tooling utama berjalan di WSL/container. Source di Windows filesystem yang di-mount ke WSL/container bisa mengalami overhead lebih besar, terutama pada project dengan banyak file kecil seperti Maven/Gradle dependencies, generated classes, Node modules, atau large monorepo.

Common Windows/WSL2 issues:

- line ending CRLF vs LF;
- path translation;
- file watcher inconsistency;
- permission mapping;
- antivirus scanning overhead;
- VPN/proxy/DNS issue;
- port forwarding confusion;
- Docker context menunjuk ke Desktop, bukan Engine lain;
- memory consumption WSL2 perlu dikontrol lewat `.wslconfig` atau Desktop settings.

---

## 7. Docker Desktop di Linux

Docker Desktop juga tersedia untuk Linux, tetapi berbeda dari Docker Engine native.

Docker documentation menyebut Docker Desktop for Linux dan Docker Engine dapat diinstall berdampingan, dan Docker Desktop for Linux menyimpan containers dan images di lokasi yang berbeda dari Docker Engine. Ini penting: image/container yang kamu lihat di Desktop context bisa berbeda dari Engine context.

Model mental:

```text
Linux host
  ├── Docker Engine native
  │     └── images/containers native engine
  │
  └── Docker Desktop for Linux
        └── Desktop-managed environment/images/containers
```

Implikasi:

- `docker context ls` menjadi penting;
- image yang sudah ada di native Engine belum tentu ada di Desktop;
- container yang jalan di native Engine belum tentu terlihat di Desktop context;
- resource path dan integration behavior bisa berbeda.

Untuk server production Linux, biasanya yang dipakai adalah Docker Engine native, bukan Docker Desktop. Docker Desktop lebih cocok untuk development workstation.

---

## 8. Comparison Table

| Aspek | Docker Desktop macOS/Windows | Docker Engine Linux Server |
|---|---|---|
| Primary goal | Developer convenience | Runtime/server operation |
| Linux kernel | Di VM/WSL2 backend | Kernel host langsung |
| Container process | Di Linux VM/WSL2 | Di host Linux |
| Filesystem bind mount | Melalui sharing/translation layer | Native Linux mount |
| Network | Desktop-managed forwarding/bridge | Native Linux bridge/iptables/nftables |
| Resource setting | Desktop/VM-level + container-level | Host cgroup langsung |
| `host.docker.internal` | Umum tersedia | Tidak selalu tersedia by default |
| Performance | Bisa dipengaruhi VM/filesharing | Lebih langsung, tergantung host |
| GUI | Ada | Biasanya tidak |
| Production usage | Umumnya tidak | Ya |
| Debug mismatch risk | Lebih tinggi | Lebih dekat ke prod Linux |

---

## 9. Filesystem Difference: Sumber Masalah Paling Umum

Filesystem adalah sumber mismatch terbesar antara laptop dan Linux server.

### 9.1 Bind Mount di Linux Server

Di Linux server:

```yaml
services:
  app:
    volumes:
      - /opt/myapp/config:/app/config:ro
```

Ini adalah mount dari path Linux host ke container. Permission, UID, GID, symlink, case sensitivity, dan inotify relatif native.

### 9.2 Bind Mount di Docker Desktop

Di macOS/Windows:

```yaml
services:
  app:
    volumes:
      - ./src:/workspace/src
```

`./src` ada di host OS, sedangkan container ada di Linux VM/WSL2. Maka file harus dijembatani.

Konsekuensi:

- operasi banyak file kecil bisa lambat;
- file watcher bisa lebih mahal;
- metadata permission bisa berbeda;
- case sensitivity bisa berbeda;
- symlink behavior bisa mengejutkan;
- path dengan spasi/special character lebih rawan;
- antivirus/indexer host bisa memengaruhi IO.

### 9.3 Java-Specific Impact

Java build tools sering melakukan banyak IO kecil:

- scan source files;
- compile banyak `.java`;
- read/write class files;
- scan resources;
- unpack dependencies;
- generate test reports;
- read Maven/Gradle cache;
- run annotation processors;
- hot reload file watch.

Jika project directory dibind-mount dari host macOS/Windows ke container, performance bisa jauh berbeda dari Linux native.

### 9.4 Praktik yang Lebih Stabil

Untuk development:

1. Jalankan Maven/Gradle di host bila container hanya untuk dependencies.
2. Jika build di container, pertimbangkan menyimpan dependency cache di named volume, bukan bind mount host.
3. Di Windows, simpan source di WSL filesystem bila workflow utama WSL/container.
4. Hindari bind mount seluruh repository jika hanya perlu config atau artifact tertentu.
5. Gunakan `.dockerignore` agresif untuk build context.
6. Pisahkan generated output dari source mount bila memungkinkan.
7. Gunakan named volume untuk data service seperti database, bukan bind mount folder project.

Example:

```yaml
services:
  app-dev:
    build: .
    volumes:
      - .:/workspace
      - maven-cache:/root/.m2
    working_dir: /workspace
    command: ./mvnw spring-boot:run

volumes:
  maven-cache:
```

Tetapi untuk performance terbaik di banyak kasus, terutama Mac/Windows:

```text
Host runs IDE + Maven/Gradle
Containers run dependencies only
```

Atau:

```text
Devcontainer/remote container owns workspace
IDE connects remotely
```

Pilihan terbaik tergantung team workflow.

---

## 10. Case Sensitivity: Bug yang Sering Lolos di Laptop

Linux filesystem umumnya case-sensitive. macOS default filesystem sering case-insensitive walau case-preserving. Windows juga umumnya case-insensitive.

Masalah:

```java
// File name: UserService.java
import com.acme.userservice;
```

Atau resource:

```text
classpath:/templates/invoice.html
classpath:/templates/Invoice.html
```

Di laptop, mungkin lolos. Di Linux CI/container, bisa gagal.

Docker Desktop tidak otomatis menghapus semua perbedaan ini jika source berasal dari host filesystem.

Rule:

> Treat production Linux case sensitivity as the source of truth.

Checklist:

- Pastikan path import/resource konsisten case-nya.
- Jalankan CI di Linux.
- Hindari rename file hanya beda kapital tanpa Git handling yang benar.
- Test Docker build di Linux runner.
- Untuk frontend+backend monorepo, perhatikan import path juga.

---

## 11. Line Endings: CRLF vs LF

Windows sering memakai CRLF. Linux shell script membutuhkan LF normal.

Dockerfile:

```dockerfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
```

Jika file punya CRLF, container Linux bisa error:

```text
exec /usr/local/bin/docker-entrypoint.sh: no such file or directory
```

Padahal file ada. Masalahnya interpreter line:

```text
#!/bin/sh
```

Linux mencari `/bin/sh`, bukan `/bin/sh`.

Solusi:

`.gitattributes`:

```gitattributes
*.sh text eol=lf
Dockerfile text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
```

Dan pastikan executable bit:

```bash
git update-index --chmod=+x docker-entrypoint.sh
```

Untuk Java engineer, ini sering muncul pada:

- entrypoint script;
- wait-for script;
- migration script;
- test bootstrap script;
- generated shell script dari Gradle/Maven wrapper.

---

## 12. Permission dan Ownership Mismatch

Di Linux server, UID/GID adalah native. Di Docker Desktop, mapping permission dari host OS ke Linux VM/container bisa tidak identik.

Problem umum:

```text
Permission denied writing /app/logs
Permission denied writing /tmp
Cannot create directory target
Gradle cache not writable
Maven repository locked
```

Root cause bisa berbeda:

- image menjalankan non-root user;
- bind mount dimiliki UID host yang berbeda;
- named volume dibuat oleh root dari container sebelumnya;
- file dari Windows/macOS tidak membawa Unix mode seperti yang diharapkan;
- script tidak executable;
- read-only mount;
- read-only root filesystem.

Diagnostic commands:

```bash
docker compose exec app id
docker compose exec app whoami
docker compose exec app ls -ln /workspace
docker inspect <container> --format '{{json .Mounts}}'
```

Mental model:

> Permission problem harus dibaca dari effective UID/GID di dalam container dan ownership/mode pada mount target, bukan dari nama user host.

Praktik:

1. Gunakan non-root user di runtime image.
2. Pastikan writable directory jelas: `/tmp`, `/app/tmp`, `/app/data`.
3. Jangan bind mount ke directory image yang butuh ownership khusus tanpa setup.
4. Untuk named volume, lakukan initialization ownership secara eksplisit.
5. Hindari menjalankan dev container kadang root kadang non-root pada volume yang sama.

Example:

```dockerfile
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
RUN chown -R app:app /app
USER app
```

Jika butuh writable temp:

```dockerfile
RUN mkdir -p /app/tmp && chown app:app /app/tmp
ENV JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/app/tmp"
```

---

## 13. Networking Difference: `localhost` Tidak Selalu Sama

Docker networking adalah sumber confusion kedua setelah filesystem.

### 13.1 Arah Akses Harus Jelas

Ada beberapa arah akses berbeda:

```text
A. Host -> container
B. Container -> host
C. Container -> container same network
D. Container -> internet
E. Container -> corporate/internal network via VPN/proxy
```

Setiap arah punya aturan berbeda.

### 13.2 Host ke Container

Jika container publish port:

```bash
docker run -p 8080:8080 myapp
```

Dari host:

```text
http://localhost:8080
```

Di Docker Desktop, Desktop melakukan port forwarding dari host OS ke container di Linux VM/WSL2. Di Linux server, port bind terjadi pada host network stack.

### 13.3 Container ke Container

Dalam user-defined bridge network atau Compose network:

```yaml
services:
  app:
    environment:
      DB_HOST: postgres

  postgres:
    image: postgres:16
```

Dari `app`, gunakan:

```text
postgres:5432
```

Bukan:

```text
localhost:5432
```

Karena `localhost` di dalam `app` adalah container `app` sendiri.

### 13.4 Container ke Host

Di Docker Desktop, sering bisa menggunakan:

```text
host.docker.internal
```

Contoh:

```properties
external.api.base-url=http://host.docker.internal:9000
```

Namun di Linux server, nama ini tidak selalu tersedia default. Docker menyediakan opsi tertentu seperti host gateway mapping pada beberapa setup, tetapi jangan menganggap ini portable universal tanpa eksplisit.

Compose example untuk Linux-compatible mapping:

```yaml
services:
  app:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Namun, tanyakan dulu: apakah container di production memang seharusnya call service di host? Dalam banyak production design, jawabannya sebaiknya tidak.

### 13.5 App Bind Address

Spring Boot default biasanya bind ke semua interface ketika server address tidak dibatasi. Tetapi jika aplikasi bind ke `127.0.0.1` di dalam container:

```properties
server.address=127.0.0.1
server.port=8080
```

Maka port publish host mungkin tidak bisa mengakses seperti yang diharapkan, karena service hanya listen pada loopback container.

Lebih aman untuk container service:

```properties
server.address=0.0.0.0
```

Atau jangan set `server.address` kecuali ada alasan kuat.

Diagnostic:

```bash
docker compose exec app sh -lc 'ss -lntp || netstat -lntp'
docker port app-container
docker inspect app-container --format '{{json .NetworkSettings.Ports}}'
```

---

## 14. DNS, Proxy, VPN, dan Corporate Network

Di laptop corporate, container networking sering melewati:

- VPN client;
- proxy;
- split DNS;
- endpoint security;
- firewall;
- custom CA certificate;
- private registry;
- internal artifact repository.

Docker Desktop documentation memiliki bagian networking yang menjelaskan routing network traffic dan file I/O antara containers, VM, dan host, serta bagaimana perilaku itu terlihat oleh firewall dan endpoint protection tools.

Common issues:

```text
Could not resolve host
Connection timed out
TLS certificate verify failed
No route to host
Proxy authentication required
x509: certificate signed by unknown authority
```

Untuk Java service:

- JVM truststore mungkin tidak mengenal corporate CA;
- OS image mungkin tidak punya CA certificate update;
- Maven/Gradle container build tidak bisa akses private artifact repo;
- Docker daemon tidak bisa pull image dari private registry;
- app runtime tidak bisa call internal API karena VPN DNS tidak masuk ke VM/container.

Pisahkan layer masalah:

```text
1. Docker daemon can pull image?
2. Build container can reach Maven/Gradle repository?
3. Runtime container can resolve internal DNS?
4. JVM trusts target TLS certificate?
5. Application proxy setting configured?
```

Diagnostic:

```bash
# daemon/image-level issue
docker pull registry.internal/acme/base:1.0

# container DNS/network issue
docker run --rm alpine nslookup repo.internal

# HTTP/TLS issue
docker run --rm curlimages/curl -v https://repo.internal

# Java trust issue
java -Djavax.net.debug=ssl -jar app.jar
```

Do not fix all of these by blindly disabling TLS verification. That creates a worse production risk.

---

## 15. Resource Limit Difference

Docker Desktop has resource settings at Desktop/VM level. Container limits exist inside that larger Desktop-managed environment.

Model:

```text
Laptop physical resources
  └── Docker Desktop VM/WSL2 resources
        └── Docker container limits
              └── JVM heap/native/thread usage
```

Linux server:

```text
Server physical/VM resources
  └── Docker container limits via cgroup
        └── JVM heap/native/thread usage
```

This means:

- A container with no explicit memory limit can still be constrained by Desktop VM memory.
- `docker stats` may not tell the full host pressure story.
- Java heap ergonomics may see container cgroup limit, but if no container limit is set, it may see a larger VM/host-like value.
- On Docker Desktop, increasing container limit alone may not help if Desktop VM limit is smaller.

Example Compose:

```yaml
services:
  app:
    image: acme/app:dev
    mem_limit: 768m
    cpus: 1.0
    environment:
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70
        -XX:InitialRAMPercentage=20
```

For local development, explicit resource limits are useful to catch production-like failure earlier. But do not set them unrealistically low just to “make it lightweight”; that can produce fake local problems.

---

## 16. Performance Difference: Desktop Is Not a Benchmark for Linux Server

Docker Desktop can have extra overhead from:

- VM/hypervisor layer;
- file sharing;
- host-to-VM network forwarding;
- antivirus/endpoint security;
- emulation for non-native architecture;
- Desktop resource cap;
- host OS power management.

Linux server performance depends on:

- CPU generation;
- storage backend;
- cgroup version;
- kernel version;
- storage driver;
- network path;
- filesystem;
- noisy neighbors;
- cloud instance throttling.

A 2026 measurement paper on Docker startup performance across heterogeneous infrastructure found that infrastructure choices such as storage tier and Docker Desktop hypervisor layer can materially affect startup and runtime overhead. Treat such studies as empirical guidance, not universal law, because actual performance depends on host, workload, kernel, image, and storage configuration.

Practical rule:

> Do not use Docker Desktop latency as a production performance baseline. Use it as a developer feedback environment.

For Java services, measure separately:

1. build time;
2. image pull time;
3. container create/start time;
4. JVM bootstrap time;
5. Spring context initialization;
6. readiness time;
7. first request latency;
8. steady-state throughput;
9. GC behavior under cgroup limits;
10. disk IO path.

---

## 17. Apple Silicon and Architecture Mismatch

Modern Mac laptops often use ARM64. Many production servers still use AMD64.

This creates subtle mismatch:

```text
Laptop: linux/arm64
Production: linux/amd64
```

If image is multi-platform and pure Java, usually fine. But problems arise with:

- native libraries;
- JNI;
- JNA;
- Netty native transport;
- compression libraries;
- embedded database binaries;
- browser/test automation images;
- OS package availability;
- platform-specific base image tags.

Common error:

```text
exec format error
```

Or runtime failure:

```text
java.lang.UnsatisfiedLinkError
```

Diagnostic:

```bash
docker version --format '{{.Server.Os}}/{{.Server.Arch}}'
docker image inspect myapp:local --format '{{json .Architecture}} {{json .Os}}'
docker buildx imagetools inspect registry/acme/app:tag
```

Build explicitly when needed:

```bash
docker buildx build --platform linux/amd64 -t acme/app:amd64 .
docker buildx build --platform linux/arm64 -t acme/app:arm64 .
```

In CI, prefer building production image on production architecture or publishing multi-platform image intentionally.

---

## 18. Docker Context: You Might Be Talking to a Different Engine

Docker CLI can target different contexts.

Check:

```bash
docker context ls
docker context show
```

Common confusion:

- Docker Desktop context vs Linux Engine context;
- remote Docker host context;
- Colima/Podman context;
- CI runner context;
- WSL integration context;
- rootless vs rootful Engine context.

Symptoms:

```text
I built the image but Compose cannot find it.
I stopped the container but it is still running.
Docker Desktop shows no containers but CLI shows containers.
CLI shows old images.
Volume disappeared.
```

Often root cause:

> You are looking at a different Docker context or different image store.

Use:

```bash
docker context show
docker info
```

Before destructive commands:

```bash
docker system prune -a
```

always verify context.

---

## 19. Docker Desktop Convenience Features Are Not Production Contracts

Docker Desktop may provide:

- GUI;
- port view;
- logs view;
- extension marketplace;
- Kubernetes toggle;
- file sharing UI;
- resource slider;
- update notifications;
- Docker Scout integration;
- host integration helpers;
- `host.docker.internal`;
- credential helper integration.

These are useful. But do not design production around them unless equivalent behavior is explicitly available in production.

Examples of bad assumptions:

```text
Works locally because host.docker.internal exists.
Works locally because Docker Desktop injects proxy settings.
Works locally because Mac filesystem ignores case.
Works locally because Desktop has registry credentials.
Works locally because Desktop VM has different DNS.
Works locally because local image exists and was never pushed.
```

Production contract should be explicit:

- image digest;
- runtime env;
- secret source;
- network dependency names;
- resource limits;
- health checks;
- volume mounts;
- user/permission;
- platform architecture;
- CA/trust configuration.

---

## 20. Local Development Patterns

There are several valid local development patterns.

### Pattern A — Host Runs Java, Docker Runs Dependencies

```text
IDE + JVM + Maven/Gradle on host
Postgres/Redis/Kafka/etc in Docker Compose
```

Pros:

- fastest IDE feedback;
- easier debugger;
- avoids source bind mount performance problems;
- host file watcher works normally;
- simple for Java teams.

Cons:

- host JDK/build tool version must be managed;
- app runtime not identical to container runtime;
- developers need local Java setup.

Good default for many Java teams.

Compose example:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

volumes:
  postgres-data:
```

Spring config on host:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
spring.data.redis.host=localhost
```

### Pattern B — App Runs in Container, Source Bind Mounted

```text
IDE on host
App process in container
Source bind mounted
```

Pros:

- app runs in Linux container;
- runtime closer to production;
- easy environment bootstrap.

Cons:

- bind mount performance issues;
- debugger setup more complex;
- file watcher issues;
- permission issues;
- laptop-specific behavior.

Example:

```yaml
services:
  app:
    build:
      context: .
      target: dev
    volumes:
      - .:/workspace
      - maven-cache:/root/.m2
    working_dir: /workspace
    command: ./mvnw spring-boot:run
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/app
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  maven-cache:
```

Good for teams that value containerized toolchain more than raw speed.

### Pattern C — Dev Container / Remote Container Owns Workspace

```text
Workspace lives inside Linux environment
IDE connects remotely
```

Pros:

- more Linux-native behavior;
- better consistency;
- avoids host filesystem mismatch;
- onboarding can be strong.

Cons:

- tooling complexity;
- IDE integration required;
- cache/storage strategy must be designed;
- harder for some workflows.

Good for large teams with strong platform investment.

### Pattern D — Full Local System in Compose

```text
App + dependencies + mock services all in Compose
```

Pros:

- topology explicit;
- demo/integration environment reproducible;
- easy reset;
- good for cross-service testing.

Cons:

- can become mini-production fantasy;
- resource heavy;
- slow feedback if used for every code change;
- readiness and data reset complexity.

Good for integration tests, demos, and onboarding—not always for tight inner loop.

---

## 21. Inner Loop vs Outer Loop

A mature Docker workflow distinguishes inner loop and outer loop.

### Inner Loop

Goal: fast edit-run-debug.

May use:

- host JVM;
- local Compose dependencies;
- hot reload;
- IDE debugger;
- Testcontainers for selected tests.

Optimize for:

- speed;
- developer feedback;
- debuggability;
- low friction.

### Outer Loop

Goal: verify production-like artifact.

Should use:

- Dockerfile build;
- same base image strategy;
- same `ENTRYPOINT`/`CMD`;
- production-like resource limit;
- healthcheck;
- image scanning;
- CI Linux runner;
- integration tests against built image.

Optimize for:

- reproducibility;
- deployability;
- security;
- parity with production contract.

Do not force all inner-loop work through production-like container if it slows every code change. Do not skip outer-loop container validation because host-run Java is faster.

The right model is:

```text
Fast local feedback + strict artifact validation
```

not:

```text
Everything local must perfectly mimic production
```

and not:

```text
Works on laptop, ship it
```

---

## 22. Designing a Local Environment That Approximates Production Honestly

Production parity is not binary. It is a set of explicit decisions.

For each axis, decide whether local should match production or optimize for speed.

| Axis | Local Should Match? | Notes |
|---|---:|---|
| Java major version | Yes | Avoid JDK drift |
| Base image | Outer loop yes | Inner loop may use host JVM |
| CPU/memory limits | Approximate | Catch OOM/thread bugs early |
| Database version | Yes | Avoid SQL behavior mismatch |
| Broker version | Usually yes | Avoid protocol/config mismatch |
| TLS/CA | For integration yes | Local can simplify, but validate real trust path |
| Secrets source | No direct prod secrets | Use local equivalents |
| Network names | Compose should be explicit | Avoid localhost confusion |
| Filesystem case sensitivity | CI must enforce Linux | Laptop may differ |
| Architecture | CI must match/publish target | Apple Silicon needs care |
| Observability | Enough locally | Full stack optional |

A good local platform has:

- `compose.yml` as base topology;
- `compose.override.yml` for developer-specific overrides;
- `.env.example` documented;
- reset command;
- healthchecks;
- named volumes for stateful dependencies;
- clear port allocation;
- no production secrets;
- explicit platform assumptions;
- Linux CI validation.

---

## 23. Example: Java Service Local Setup with Honest Parity

Directory:

```text
service-a/
  Dockerfile
  compose.yml
  compose.dev.yml
  compose.test.yml
  .env.example
  src/
  pom.xml
```

### 23.1 `compose.yml` — Shared Dependency Topology

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: service_a
      POSTGRES_USER: service_a
      POSTGRES_PASSWORD: service_a
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U service_a -d service_a"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres-data:
```

### 23.2 `compose.dev.yml` — Optional App Container

```yaml
services:
  app:
    build:
      context: .
      target: dev
    ports:
      - "8080:8080"
      - "5005:5005"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/service_a
      SPRING_DATASOURCE_USERNAME: service_a
      SPRING_DATASOURCE_PASSWORD: service_a
      SPRING_DATA_REDIS_HOST: redis
      JAVA_TOOL_OPTIONS: >-
        -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
        -XX:MaxRAMPercentage=70
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

Use host JVM inner loop:

```bash
docker compose up -d postgres redis
./mvnw spring-boot:run
```

Use containerized app outer-ish loop:

```bash
docker compose -f compose.yml -f compose.dev.yml up --build app
```

### 23.3 `compose.test.yml` — Built Image Test

```yaml
services:
  app-under-test:
    image: service-a:${IMAGE_TAG:-local}
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/service_a
      SPRING_DATASOURCE_USERNAME: service_a
      SPRING_DATASOURCE_PASSWORD: service_a
      SPRING_DATA_REDIS_HOST: redis
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

This separates:

- dependencies-only local speed;
- app-in-container dev mode;
- built-image validation mode.

---

## 24. Common Failure Scenarios and How to Read Them

### Scenario 1 — Works on Mac, Fails in Linux CI: File Not Found

Symptom:

```text
java.io.FileNotFoundException: classpath resource templates/Invoice.html not found
```

Likely causes:

- case mismatch;
- resource path differs;
- build context excludes file;
- `.dockerignore` too broad.

Check:

```bash
git ls-files | grep -i invoice
docker run --rm image sh -lc 'find /app -iname "*invoice*"'
```

Fix:

- correct case;
- enforce Linux CI;
- avoid relying on case-insensitive filesystem.

### Scenario 2 — Works on Host, Fails in Container: Cannot Reach DB

Host config:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

Container config should be:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

Because `localhost` inside app container is the app container.

### Scenario 3 — Slow Build on Docker Desktop

Symptoms:

```text
mvn test slow
Gradle sync slow
Spring restart slow
```

Likely causes:

- source bind mount through Desktop file sharing;
- dependency cache on bind mount;
- many small files;
- antivirus/indexer;
- cross-architecture emulation.

Fix options:

- run JVM/build on host, dependencies in Docker;
- use named volume for Maven/Gradle cache;
- store source in WSL filesystem on Windows;
- use BuildKit cache mount;
- avoid mounting entire repo unnecessarily.

### Scenario 4 — App OOMs Locally But Not in CI

Likely causes:

- Docker Desktop VM memory too small;
- no explicit container memory limit;
- JVM heap ergonomics differ;
- parallel tests too high;
- Testcontainers starts many dependencies.

Check:

```bash
docker stats
docker inspect container --format '{{json .HostConfig.Memory}}'
docker info
```

Fix:

- set realistic local container limits;
- tune JVM MaxRAMPercentage;
- increase Desktop VM memory if needed;
- reduce test parallelism;
- avoid running full stack for every inner-loop change.

### Scenario 5 — `exec format error`

Likely cause:

- image architecture mismatch.

Check:

```bash
docker version --format '{{.Server.Arch}}'
docker image inspect image --format '{{.Architecture}}'
docker buildx imagetools inspect image:tag
```

Fix:

- build for correct platform;
- publish multi-platform image;
- avoid pulling architecture-specific tag accidentally.

### Scenario 6 — Script Exists But Container Says No Such File

Likely cause:

- CRLF line ending;
- missing executable bit;
- wrong shebang;
- interpreter not installed in minimal image.

Check:

```bash
file docker-entrypoint.sh
head -1 docker-entrypoint.sh | cat -v
git ls-files --stage docker-entrypoint.sh
```

Fix:

- LF endings;
- `chmod +x` tracked by Git;
- use `/bin/sh` only if image has it;
- prefer exec-form entrypoint when possible.

---

## 25. Docker Desktop vs Linux Server Diagnostic Checklist

When behavior differs between laptop and server, ask these questions in order.

### 25.1 Runtime Target

```bash
docker context show
docker info
```

Questions:

- Am I talking to Docker Desktop or Linux Engine?
- Is this rootless or rootful?
- What is server architecture?
- What is cgroup version?
- What storage driver?

### 25.2 Image Identity

```bash
docker image inspect image:tag
docker buildx imagetools inspect image:tag
```

Questions:

- Same image digest?
- Same platform?
- Same base image?
- Is tag mutable?

### 25.3 Filesystem

```bash
docker inspect container --format '{{json .Mounts}}'
docker exec container id
docker exec container ls -ln /path
```

Questions:

- Bind mount or named volume?
- Host path from macOS/Windows/WSL/Linux?
- Permission mismatch?
- Case sensitivity issue?
- CRLF issue?

### 25.4 Network

```bash
docker port container
docker inspect container --format '{{json .NetworkSettings.Networks}}'
docker exec container getent hosts postgres
```

Questions:

- Host-to-container, container-to-host, or container-to-container?
- Is app binding `0.0.0.0` or `127.0.0.1`?
- Is service name correct?
- Is `host.docker.internal` assumed?
- Is VPN/proxy/DNS involved?

### 25.5 Resource

```bash
docker stats
docker inspect container --format '{{json .HostConfig.Memory}} {{json .HostConfig.NanoCpus}}'
```

Questions:

- Container limit set?
- Desktop VM limit set?
- JVM heap/native memory tuned?
- Exit 137?
- CPU quota affecting GC/thread pool?

### 25.6 Security

```bash
docker inspect container --format '{{json .HostConfig.SecurityOpt}} {{json .HostConfig.CapDrop}}'
docker exec container id
```

Questions:

- Running as non-root?
- Read-only root filesystem?
- Capability dropped?
- Seccomp/AppArmor/SELinux difference?
- Bind mount permission?

---

## 26. What Not to Do

Avoid these patterns.

### 26.1 Do Not Treat Docker Desktop as Production

Bad:

```text
It works on Docker Desktop, therefore production is safe.
```

Better:

```text
It works on Desktop for developer flow. CI validates built image on Linux with production-like platform and limits.
```

### 26.2 Do Not Hide Environment Differences

Bad:

```yaml
extra_hosts:
  - "prod-db:host.docker.internal"
```

This makes local look like production but actually points to a different topology.

Better:

```text
Use explicit local env names and explicit production env names.
```

### 26.3 Do Not Use Bind Mounts as Production Persistence Model

Bind mounts are fine for local config/source. Production state should be designed deliberately.

Bad:

```yaml
volumes:
  - ./postgres:/var/lib/postgresql/data
```

Better for local:

```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data
```

Better for production:

```text
Use managed database or deliberate host volume/backups depending on architecture.
```

### 26.4 Do Not Use `latest` to “Simplify” Local/Prod

Mutable tags make environment mismatch harder.

Use:

```text
service-a:git-sha
service-a:1.4.2
service-a@sha256:...
```

### 26.5 Do Not Debug by Mutating Container Until It Works

Bad:

```bash
docker exec -it app bash
apt-get update && apt-get install something
vi config
```

Better:

- inspect;
- reproduce;
- modify Dockerfile/Compose/config;
- rebuild;
- rerun.

Containers should remain disposable.

---

## 27. Recommended Team Policy

For a Java team, a practical policy might be:

1. Production images are built in Linux CI.
2. Production deployment references immutable digest or commit-SHA tag.
3. Docker Desktop is supported for local dependencies and optional app container mode.
4. Host-run Java is allowed for fast inner loop.
5. Compose dependency versions match production major/minor where possible.
6. Apple Silicon users must validate AMD64 image path in CI.
7. Windows users should keep repo in WSL filesystem for container-heavy workflows.
8. `.gitattributes` enforces LF for shell/Docker/Compose files.
9. `.dockerignore` prevents huge build context.
10. Local environment uses no production secrets.
11. CI runs containerized integration tests against built image.
12. Troubleshooting starts with `docker context show`, image digest, mounts, networks, resource limits.

This policy avoids both extremes:

- forcing everyone into slow local production emulation;
- relying on host-only behavior that never validates the deployable artifact.

---

## 28. Minimal Commands to Memorize for This Topic

```bash
# Which engine am I talking to?
docker context ls
docker context show
docker info

# What platform is this engine?
docker version --format '{{.Server.Os}}/{{.Server.Arch}}'

# What platform is this image?
docker image inspect myapp:local --format '{{.Os}}/{{.Architecture}}'
docker buildx imagetools inspect registry/acme/myapp:tag

# What mounts does this container have?
docker inspect myapp --format '{{json .Mounts}}'

# What ports are published?
docker port myapp
docker inspect myapp --format '{{json .NetworkSettings.Ports}}'

# What networks is it attached to?
docker inspect myapp --format '{{json .NetworkSettings.Networks}}'

# What resource limits are set?
docker inspect myapp --format '{{json .HostConfig.Memory}} {{json .HostConfig.NanoCpus}}'
docker stats

# What user is process running as?
docker exec myapp id

# Can it resolve another service?
docker exec myapp getent hosts postgres
```

These commands turn Desktop-vs-server guessing into fact gathering.

---

## 29. Mental Model Recap

The key distinction:

```text
Docker Engine on Linux server:
  container -> Linux kernel host directly

Docker Desktop on macOS/Windows:
  container -> Linux VM/WSL2 -> host OS integration layer
```

This affects:

- filesystem performance;
- bind mount behavior;
- permission mapping;
- line endings;
- case sensitivity;
- networking;
- localhost semantics;
- DNS/proxy/VPN behavior;
- resource limits;
- architecture/platform;
- debugging assumptions.

A senior Docker user does not ask:

```text
Why is Docker inconsistent?
```

They ask:

```text
Which layer changed: image, container config, Desktop integration, host filesystem, network path, resource limit, platform architecture, or application behavior?
```

That question is the difference between guessing and diagnosis.

---

## 30. Practical Checklist for New Java Projects

For a new Java service, set this up early:

### Repository hygiene

```text
.dockerignore
.gitattributes
compose.yml
compose.dev.yml
Dockerfile
README local setup section
```

### `.gitattributes`

```gitattributes
*.sh text eol=lf
Dockerfile text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.properties text eol=lf
*.gradle text eol=lf
pom.xml text eol=lf
```

### `.dockerignore`

```dockerignore
.git
.idea
.vscode
target
build
.gradle
.mvn/wrapper/maven-wrapper.jar
*.iml
.DS_Store
node_modules
coverage
*.log
```

Adjust depending on Maven/Gradle wrapper strategy.

### Local dependencies

Use Compose for dependencies, not necessarily for the Java inner loop.

### CI validation

CI must:

- build Docker image;
- run tests on Linux;
- verify target architecture;
- scan image;
- publish immutable tag/digest;
- run at least smoke test against built image.

### Developer docs

Document explicitly:

- macOS notes;
- Windows/WSL2 notes;
- Apple Silicon notes;
- required Docker Desktop resources;
- common reset command;
- how to inspect context;
- how to avoid production secrets.

---

## 31. Closing Model

Docker Desktop is not “fake Docker”. It is real Docker with additional developer integration layers. Docker Engine on Linux server is not “better Docker” in every dimension; it is simply closer to the production runtime model for Linux containers.

Use Docker Desktop for what it is excellent at:

- fast onboarding;
- local dependencies;
- container build/test loops;
- Compose environments;
- developer-friendly inspection;
- cross-platform local workflow.

Use Linux CI/server validation for what Desktop cannot guarantee:

- production platform correctness;
- Linux filesystem semantics;
- target architecture;
- real resource envelope;
- deployment artifact integrity;
- production-like networking and security assumptions.

The mature position is not “make local identical to production”. That is often impossible and wasteful.

The mature position is:

> Make local differences explicit, make production artifact validation strict, and debug by identifying which layer changed.

---

## 32. References

- Docker Docs — Docker Desktop overview: `https://docs.docker.com/desktop/`
- Docker Docs — Install Docker Engine: `https://docs.docker.com/engine/install/`
- Docker Docs — Docker Desktop WSL2 backend: `https://docs.docker.com/desktop/features/wsl/`
- Docker Docs — Docker Desktop networking: `https://docs.docker.com/desktop/features/networking/`
- Docker Docs — Docker Desktop for Linux install notes: `https://docs.docker.com/desktop/setup/install/linux/`
- Docker Docs — Docker Engine networking: `https://docs.docker.com/engine/network/`
- Docker Docs — Resource constraints: `https://docs.docker.com/engine/containers/resource_constraints/`
- Docker Docs — Compose file reference: `https://docs.docker.com/reference/compose-file/`
- Docker Docs — Multi-platform builds: `https://docs.docker.com/build/building/multi-platform/`
- Docker Docs — Build cache optimization: `https://docs.docker.com/build/cache/optimize/`
- Research note: Decomposing Docker Container Startup Performance: A Three-Tier Measurement Study on Heterogeneous Infrastructure, arXiv 2026.

---

## Status Seri

Selesai: Part 026 dari 031.

Seri belum selesai. Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-027.md
```

Topik berikutnya:

```text
Local Developer Platform: Docker as Team Workflow Contract
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Multi-Platform Images: amd64, arm64, Buildx, Manifest Lists</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-027.md">Local Developer Platform: Docker as Team Workflow Contract ➡️</a>
</div>
