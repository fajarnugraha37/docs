# learn-docker-mastery-for-java-engineers-part-017.md

# Part 017 — Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor

> Series: **learn-docker-mastery-for-java-engineers**  
> Part: **017 / 031**  
> Topic: **Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor**  
> Audience: **Java Software Engineer / Tech Lead**  
> Goal: memahami Docker security sebagai kombinasi boundary runtime, privilege minimization, host hardening, image discipline, dan operational trade-off — bukan sekadar menambahkan `USER app`.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah punya fondasi:

- container sebagai proses yang diberi boundary;
- image sebagai artifact immutable;
- Dockerfile sebagai derivasi filesystem;
- Compose sebagai model sistem lokal;
- config dan secret sebagai runtime concern;
- Java runtime behavior dalam container.

Part ini membahas **security boundary**.

Namun penting: bagian ini **bukan** pengganti AppSec, secure coding, OAuth, TLS, vulnerability management, atau threat modeling enterprise. Fokusnya adalah:

> Bagaimana membuat container Java lebih sulit disalahgunakan ketika aplikasi, dependency, atau runtime terkena kompromi.

Docker security bukan satu tombol. Ia adalah tumpukan keputusan:

```text
source code
  ↓
build dependency
  ↓
base image
  ↓
image filesystem
  ↓
container user
  ↓
Linux capabilities
  ↓
seccomp / AppArmor / SELinux
  ↓
mount / volume policy
  ↓
network exposure
  ↓
Docker daemon privilege
  ↓
host operating system
```

Jika satu lapisan gagal, lapisan lain seharusnya membatasi dampaknya.

---

## 1. Mental Model Utama: Container Security adalah Blast Radius Reduction

Docker tidak otomatis membuat aplikasi menjadi aman.

Container security berarti:

1. **Membatasi apa yang bisa dilakukan proses.**
2. **Membatasi file apa yang bisa dibaca/ditulis.**
3. **Membatasi syscall dan kernel interface yang bisa dipakai.**
4. **Membatasi privilege escalation.**
5. **Membatasi dampak ketika aplikasi diambil alih.**
6. **Membatasi akses container terhadap host dan daemon.**
7. **Membuat artifact deployment dapat diaudit.**

Model paling sehat:

> Anggap aplikasi Java bisa terkena remote code execution. Docker hardening harus membuat RCE itu tidak langsung berubah menjadi host compromise.

Contoh:

Tanpa hardening:

```text
RCE in app
  → attacker executes shell
  → app runs as root
  → container has broad capabilities
  → writable filesystem
  → host docker.sock mounted
  → attacker controls Docker daemon
  → host takeover
```

Dengan hardening:

```text
RCE in app
  → attacker executes command as non-root
  → no shell or minimal shell
  → no package manager
  → dropped capabilities
  → read-only root filesystem
  → writable only /tmp
  → no docker.sock
  → no privilege escalation
  → outbound network restricted externally
  → attacker impact constrained
```

Security tidak menghilangkan bug, tetapi mengubah konsekuensi bug.

---

## 2. Docker Security Boundary: Apa yang Dilindungi dan Apa yang Tidak

Container memberi isolasi, tetapi isolasi itu bukan VM penuh.

### 2.1 Yang biasanya diisolasi

Container bisa memiliki namespace sendiri untuk:

- process tree;
- hostname;
- mount view;
- network stack;
- IPC;
- user/group mapping;
- cgroup resource accounting.

Dari perspektif aplikasi Java:

```text
ps aux
hostname
ip addr
mount
/proc
/tmp
localhost
```

semuanya bisa terlihat seperti dunia sendiri.

### 2.2 Yang tidak otomatis diisolasi secara absolut

Container tetap berbagi:

- kernel host;
- beberapa kernel interface;
- kernel vulnerability surface;
- Docker daemon sebagai privileged control plane;
- host filesystem jika bind mount diberikan;
- host network jika `--network host`;
- host PID namespace jika `--pid host`;
- host IPC jika `--ipc host`;
- host devices jika `--device` atau `--privileged`.

Karena itu, container bukan boundary absolut seperti hypervisor VM. Ia lebih tepat dipahami sebagai:

> proses host yang diberi isolasi kernel-level dan policy runtime.

---

## 3. Threat Model untuk Java Service dalam Docker

Java service containerized biasanya punya risiko berikut:

| Risiko | Contoh |
|---|---|
| Remote Code Execution | Deserialization bug, expression injection, vulnerable library |
| Secret disclosure | Env var, mounted config, truststore, token file |
| File write abuse | Upload path, temp dir, heap dump, log file |
| Network pivot | App digunakan menyerang DB, Redis, internal service |
| Privilege escalation | Container root + capability berlebih |
| Host compromise | docker.sock mounted, privileged container, host mount |
| Supply chain compromise | Base image atau dependency berbahaya |
| Persistence | Attacker menulis binary/script ke writable layer |
| Lateral movement | Container bisa menjangkau service internal lain |

Part ini terutama fokus pada runtime hardening dan sebagian image-level decision.

Supply chain lebih dalam ada di Part 018.

---

## 4. Root di Container: Masalah yang Sering Diremehkan

Secara default, banyak image berjalan sebagai root.

Contoh Dockerfile buruk:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Jika image base default root, proses Java berjalan sebagai root di container.

### 4.1 “Root di container bukan root host” — benar tapi berbahaya jika dipahami setengah

Benar:

- root di container berada dalam namespace/mapping tertentu;
- container default punya capability terbatas;
- filesystem container bukan filesystem host penuh.

Tetapi berbahaya:

- root tetap punya privilege besar di dalam container;
- root dapat menulis ke banyak path container;
- root bisa mengubah ownership file;
- root bisa bind port privileged jika diizinkan;
- root lebih mudah mengeksploitasi misconfiguration;
- root + mounted host path bisa merusak file host sesuai permission mapping;
- root + docker.sock hampir sama dengan host root.

Jadi aturan praktis:

> Jangan jalankan aplikasi Java sebagai root kecuali ada alasan eksplisit, terdokumentasi, dan dikompensasi dengan kontrol lain.

---

## 5. Pattern Non-Root User untuk Java Image

### 5.1 Dockerfile baseline

```dockerfile
FROM eclipse-temurin:21-jre-jammy

RUN groupadd --system app \
    && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app

COPY --chown=app:app target/app.jar /app/app.jar

USER app:app

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Mental model:

- `groupadd` membuat group runtime.
- `useradd` membuat user tanpa login shell.
- `COPY --chown` memastikan app bisa membaca file.
- `USER` mengubah user effective untuk proses berikutnya dan runtime.
- Java berjalan sebagai user terbatas.

### 5.2 Numeric UID lebih stabil

Di beberapa environment, numeric UID lebih mudah dioperasikan:

```dockerfile
FROM eclipse-temurin:21-jre-jammy

RUN groupadd -g 10001 app \
    && useradd -u 10001 -g 10001 -r -s /usr/sbin/nologin -d /app app

WORKDIR /app
COPY --chown=10001:10001 target/app.jar /app/app.jar

USER 10001:10001

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kenapa numeric UID berguna:

- tidak bergantung pada `/etc/passwd` name resolution;
- lebih jelas saat bind mount;
- lebih mudah dipetakan ke policy orchestration;
- lebih mudah diaudit.

### 5.3 Pitfall: non-root tapi file tidak readable

Contoh error:

```text
Error: Unable to access jarfile /app/app.jar
```

Penyebab umum:

```dockerfile
COPY target/app.jar /app/app.jar
USER app
```

File mungkin masih dimiliki root. Biasanya tetap readable, tetapi kasus file mode/dir mode bisa membuat gagal.

Gunakan:

```dockerfile
COPY --chown=app:app target/app.jar /app/app.jar
```

atau set permission dengan hati-hati.

### 5.4 Pitfall: non-root tidak bisa menulis temp

Java sering butuh temporary directory:

- file upload multipart;
- decompression;
- temporary report;
- generated class/cache;
- JFR;
- heap dump;
- native library extraction;
- Tomcat work dir.

Jika root filesystem read-only atau `/tmp` tidak writable, aplikasi bisa gagal.

Solusi:

```dockerfile
RUN mkdir -p /app/tmp \
    && chown -R app:app /app/tmp

ENV JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/app/tmp"
```

Runtime:

```bash
docker run \
  --read-only \
  --tmpfs /app/tmp:rw,noexec,nosuid,size=128m \
  my-java-app
```

---

## 6. Capabilities: Root Tidak Harus Punya Semua Kekuatan Root

Linux membagi privilege root menjadi unit kecil yang disebut capabilities.

Docker default tidak memberi semua capability. Tetapi container masih punya beberapa capability default yang cukup untuk banyak workload.

Contoh capability:

| Capability | Makna umum |
|---|---|
| `CAP_NET_BIND_SERVICE` | bind port < 1024 |
| `CAP_CHOWN` | mengubah owner file |
| `CAP_DAC_OVERRIDE` | bypass permission file tertentu |
| `CAP_SETUID` | set user ID |
| `CAP_SETGID` | set group ID |
| `CAP_NET_RAW` | raw socket, misalnya ping |
| `CAP_SYS_ADMIN` | sangat luas, sering dianggap “near-root” |
| `CAP_SYS_PTRACE` | trace process lain |
| `CAP_MKNOD` | membuat device node |

### 6.1 Java service biasanya tidak butuh banyak capability

Untuk Java HTTP service biasa:

- tidak perlu `NET_RAW`;
- tidak perlu `SYS_ADMIN`;
- tidak perlu `SYS_PTRACE`;
- tidak perlu `MKNOD`;
- tidak perlu `DAC_OVERRIDE`;
- tidak perlu `SETUID`/`SETGID` saat sudah non-root.

Baseline kuat:

```bash
docker run \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  my-java-app
```

Tetapi `NET_BIND_SERVICE` hanya perlu jika app bind port < 1024, misalnya 80/443.

Lebih baik app bind port tinggi:

```text
8080, 8081, 8443
```

Lalu mapping di host/proxy:

```bash
docker run -p 80:8080 my-java-app
```

Dengan begitu container tidak perlu `CAP_NET_BIND_SERVICE`.

### 6.2 Compose example

```yaml
services:
  app:
    image: my-java-app:1.0.0
    user: "10001:10001"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    ports:
      - "8080:8080"
```

### 6.3 Kapan capability perlu ditambah?

Jarang untuk app Java biasa.

Kemungkinan perlu jika:

- aplikasi butuh low-level network;
- profiler/debugger tertentu perlu ptrace;
- service perlu bind privileged port;
- sidecar diagnostic khusus;
- agent observability tertentu butuh akses tambahan.

Aturan:

> Tambahkan capability satu per satu karena kebutuhan yang terbukti, bukan karena container gagal lalu langsung diberi `--privileged`.

---

## 7. `--privileged`: Tombol Bahaya

`--privileged` memberi container privilege sangat luas:

- banyak capability;
- akses device;
- relaxed security policy;
- potensi interaksi kuat dengan host.

Contoh buruk:

```bash
docker run --privileged my-java-app
```

Untuk Java service biasa, ini hampir selalu salah.

### 7.1 Kenapa orang memakai `--privileged`?

Biasanya karena:

- permission denied;
- butuh akses device;
- container menjalankan Docker-in-Docker;
- test environment malas dikonfigurasi;
- agent monitoring membutuhkan akses host;
- ada tutorial yang terlalu permisif.

### 7.2 Cara berpikir yang benar

Jika ada error permission:

Jangan langsung:

```bash
--privileged
```

Tanya:

1. File apa yang diakses?
2. User mana yang menjalankan proses?
3. Permission mount bagaimana?
4. Capability apa yang benar-benar dibutuhkan?
5. Apakah cukup dengan `--device` tertentu?
6. Apakah cukup dengan group tertentu?
7. Apakah cukup dengan tmpfs/writable dir?
8. Apakah desainnya salah karena app mencoba mengakses host?

`--privileged` harus menjadi opsi terakhir untuk workload khusus, bukan debugging default.

---

## 8. `no-new-privileges`: Mencegah Privilege Escalation

Docker mendukung security option:

```bash
docker run --security-opt no-new-privileges my-java-app
```

Compose:

```yaml
services:
  app:
    security_opt:
      - no-new-privileges:true
```

Maknanya:

> Proses dan child process tidak boleh mendapatkan privilege baru melalui mekanisme seperti setuid/setgid binary.

Untuk Java service, ini baseline yang baik.

Kenapa?

Jika RCE terjadi dan attacker mencoba menjalankan binary setuid untuk naik privilege, `no-new-privileges` membantu membatasi eskalasi.

---

## 9. Seccomp: Membatasi System Call

Seccomp adalah mekanisme kernel untuk membatasi syscall yang boleh digunakan proses.

Docker punya default seccomp profile. Default profile ini dibuat untuk kompatibilitas luas sambil memblok sebagian syscall berisiko.

### 9.1 Mental model syscall

Aplikasi Java tidak langsung “bicara” ke hardware. Pada akhirnya, JVM dan native library melakukan syscall:

```text
Java code
  ↓
JVM
  ↓
glibc / musl / native library
  ↓
Linux syscall
  ↓
kernel
```

Contoh syscall:

- `open`
- `read`
- `write`
- `socket`
- `connect`
- `clone`
- `futex`
- `mmap`
- `epoll_wait`

Seccomp dapat menolak syscall tertentu.

### 9.2 Default seccomp biasanya cukup untuk Java service

Untuk Java HTTP service biasa, default Docker seccomp umumnya kompatibel.

Jangan disable tanpa alasan:

```bash
docker run --security-opt seccomp=unconfined my-java-app
```

Ini melepas lapisan proteksi.

### 9.3 Kapan custom seccomp diperlukan?

Kemungkinan:

- low-level profiler;
- eBPF tooling;
- sandbox runtime;
- browser/headless runtime;
- database engine tertentu;
- workload dengan native component khusus.

Untuk Java service umum:

> mulai dari default seccomp, bukan unconfined.

---

## 10. AppArmor dan SELinux: Mandatory Access Control

Seccomp membatasi syscall.

AppArmor/SELinux membatasi apa yang bisa dilakukan proses terhadap resource seperti file, capability, network, dan path tertentu berdasarkan policy.

### 10.1 AppArmor

Pada banyak distro, Docker memakai profile default bernama seperti:

```text
docker-default
```

Profile ini memberi baseline confinement.

Command inspeksi host:

```bash
docker info | grep -i apparmor
```

atau:

```bash
docker inspect <container> --format '{{json .AppArmorProfile}}'
```

### 10.2 SELinux

Pada distro seperti RHEL/Fedora/CentOS, SELinux dapat mempengaruhi bind mount.

Gejala umum:

```text
permission denied
```

padahal Unix permission tampak benar.

Compose/bind mount kadang butuh label option seperti `:z` atau `:Z` pada environment tertentu.

Contoh:

```bash
docker run -v /host/data:/app/data:Z my-java-app
```

Makna praktis:

- `:z` shared label;
- `:Z` private label.

Jangan asal pakai tanpa memahami konsekuensi sharing.

### 10.3 Untuk Java engineer

Saat debugging permission denied:

Jangan hanya cek:

```bash
ls -l
```

Cek juga:

- user container;
- UID/GID;
- mount mode read-only;
- AppArmor/SELinux;
- read-only rootfs;
- path sebenarnya setelah mount;
- file dibuat oleh container lama dengan UID berbeda.

---

## 11. Read-Only Root Filesystem

Salah satu hardening paling efektif untuk Java service:

```bash
docker run --read-only my-java-app
```

Compose:

```yaml
services:
  app:
    read_only: true
```

Artinya container root filesystem tidak bisa ditulis.

### 11.1 Kenapa ini kuat?

Jika attacker mendapat RCE, ia sulit:

- menaruh binary persistence;
- mengubah config;
- menulis script ke `/usr/local/bin`;
- mengubah file aplikasi;
- mengubah truststore;
- menulis webshell;
- memodifikasi dependency jar.

### 11.2 Tapi Java sering perlu writable area

Berikan writable path eksplisit.

Contoh:

```bash
docker run \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m \
  --tmpfs /app/tmp:rw,noexec,nosuid,size=128m \
  my-java-app
```

Compose:

```yaml
services:
  app:
    image: my-java-app:1.0.0
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=128m
      - /app/tmp:rw,noexec,nosuid,size=128m
```

### 11.3 Java-specific writable paths

Periksa:

| Kebutuhan | Path umum | Rekomendasi |
|---|---|---|
| Java temp | `/tmp` | tmpfs bounded |
| Spring multipart upload | `/tmp` atau configured path | explicit tmp dir |
| Tomcat work dir | `/tmp` atau app-specific | configure |
| Heap dump | current dir atau configured path | volume khusus atau disable |
| JFR output | configured path | volume/tmpfs |
| Logs file | `/var/log/...` | stdout/stderr |
| Cache | app-specific | tmpfs/volume sesuai sifat data |

### 11.4 Jangan membuat semuanya writable lagi

Anti-pattern:

```yaml
read_only: true
volumes:
  - ./:/
```

atau:

```yaml
volumes:
  - app-data:/app
```

Kalau seluruh `/app` writable, sebagian manfaat read-only hilang.

---

## 12. Mount Security: Bind Mount adalah Jembatan ke Host

Bind mount memberi container akses ke path host.

Contoh:

```bash
docker run -v /var/log:/host-logs my-java-app
```

Jika container compromised, attacker bisa membaca/menulis sesuai permission mount.

### 12.1 Mount read-only jika hanya perlu baca

```bash
docker run -v /etc/ssl/certs:/etc/ssl/certs:ro my-java-app
```

Compose:

```yaml
services:
  app:
    volumes:
      - ./config/application.yml:/app/config/application.yml:ro
```

### 12.2 Jangan mount root host

Bahaya:

```bash
docker run -v /:/host my-java-app
```

Ini membuka host filesystem ke container.

### 12.3 Jangan mount Docker socket ke app container

Sangat bahaya:

```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock my-java-app
```

Docker socket memberi akses ke Docker daemon. Karena Docker daemon biasanya privileged, akses socket sering setara dengan kontrol host.

Serangan konseptual:

```text
RCE in app
  → attacker uses docker.sock
  → starts privileged container
  → bind mounts host /
  → modifies host
```

Aturan:

> Application container tidak boleh punya akses ke Docker socket.

Jika CI/CD butuh build image, gunakan isolated builder, rootless builder, remote builder, atau service khusus dengan policy ketat.

---

## 13. User Namespace Remapping

User namespace remapping memungkinkan UID root di container dipetakan ke UID non-root di host.

Contoh konseptual:

```text
container UID 0
  → host UID 231072
```

Jadi proses merasa root di container, tetapi di host ia bukan root.

Ini berguna sebagai defense-in-depth, terutama untuk container yang harus berjalan sebagai root di dalam namespace.

### 13.1 Batasan

User namespace remap dapat mempengaruhi:

- bind mount permission;
- volume ownership;
- compatibility dengan beberapa fitur Docker;
- operasional image store tertentu;
- file ownership yang terlihat membingungkan.

### 13.2 Kapan digunakan?

Cocok untuk:

- host multi-tenant;
- defense-in-depth production;
- workload yang belum bisa non-root;
- environment dengan policy hardening tinggi.

Tetapi tetap lebih baik menjalankan aplikasi sebagai non-root di dalam container.

Layering yang kuat:

```text
non-root app user
+ dropped capabilities
+ no-new-privileges
+ read-only rootfs
+ userns-remap/rootless
```

---

## 14. Rootless Mode

Rootless mode menjalankan Docker daemon dan container tanpa root privilege.

Bedanya dengan userns-remap:

```text
userns-remap:
  dockerd masih root
  container user namespace dipetakan

rootless:
  dockerd non-root
  container juga berjalan dalam user namespace non-root
```

### 14.1 Keuntungan

- mengurangi risiko compromise Docker daemon menjadi root host compromise;
- cocok untuk developer workstation;
- cocok untuk beberapa multi-user environment;
- mengurangi blast radius daemon.

### 14.2 Trade-off

Rootless mode bisa memiliki perbedaan/limitasi:

- networking berbeda;
- port privileged punya batasan;
- storage/network driver behavior berbeda;
- performance/compatibility case tertentu;
- observability host-level lebih terbatas;
- beberapa fitur low-level tidak tersedia.

### 14.3 Untuk Java engineer

Rootless mode bagus untuk development dan beberapa production profile, tetapi jangan anggap otomatis menyelesaikan semua masalah.

Tetap lakukan:

- non-root user;
- cap drop;
- read-only filesystem;
- no docker.sock;
- secret hygiene;
- image scanning;
- minimal base image.

---

## 15. Docker Daemon Security

Docker daemon adalah control plane kuat.

Jika user bisa mengakses Docker daemon, ia sering bisa melakukan hal yang setara root host.

### 15.1 Docker group risk

Pada Linux, user dalam group `docker` dapat menjalankan Docker command tanpa sudo.

Ini nyaman, tetapi secara security sangat kuat.

Contoh user dengan Docker access bisa:

```bash
docker run --rm -it -v /:/host ubuntu chroot /host sh
```

Jika diizinkan, ini bisa memberi akses host.

Aturan:

> Membership di group `docker` harus diperlakukan seperti privileged access, bukan akses developer biasa tanpa risiko.

### 15.2 Jangan expose Docker daemon TCP tanpa TLS

Sangat berbahaya:

```text
tcp://0.0.0.0:2375
```

Tanpa TLS/auth, siapa pun yang dapat menjangkau port itu dapat mengontrol Docker daemon.

Gunakan:

- Unix socket lokal dengan permission ketat;
- TLS mutual auth jika remote daemon benar-benar diperlukan;
- firewall;
- remote builder khusus;
- least privilege automation.

---

## 16. Network Exposure Security

Container hardening bukan hanya user/capability.

Network exposure juga penting.

### 16.1 Bind address

Jangan publish ke semua interface jika tidak perlu:

```bash
docker run -p 8080:8080 my-java-app
```

Ini biasanya bind ke semua interface host.

Lebih ketat:

```bash
docker run -p 127.0.0.1:8080:8080 my-java-app
```

Compose:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

### 16.2 Internal-only service

Untuk service dependency internal Compose:

```yaml
services:
  postgres:
    image: postgres:16
    expose:
      - "5432"
```

Tidak perlu:

```yaml
ports:
  - "5432:5432"
```

Jika host tidak perlu mengakses DB, jangan publish.

### 16.3 Java actuator/security

Spring Boot actuator endpoint seperti:

- `/actuator/env`
- `/actuator/heapdump`
- `/actuator/logfile`
- `/actuator/threaddump`
- `/actuator/metrics`

harus diproteksi.

Container network bukan pengganti authorization.

---

## 17. Environment Variables dan Secret Exposure

Part 016 sudah membahas config/secrets. Dari security perspective:

Env var bisa terlihat melalui:

```bash
docker inspect <container>
```

oleh user yang punya Docker access.

Secret di env juga bisa muncul di:

- crash dump;
- debug endpoint;
- logs;
- process environment;
- support bundle;
- telemetry.

Lebih baik untuk secret sensitif:

- file-based secret;
- secret manager;
- short-lived credential;
- mounted read-only file;
- BuildKit secret hanya saat build.

Jangan:

```dockerfile
ENV DB_PASSWORD=super-secret
```

Jangan:

```dockerfile
ARG TOKEN
RUN curl -H "Authorization: Bearer $TOKEN" ...
```

kecuali memakai secret mount yang tidak terekam layer/history.

---

## 18. Image-Level Security Baseline

Runtime hardening tidak cukup jika image buruk.

Baseline image security:

1. Pakai base image tepercaya.
2. Pin versi.
3. Hindari `latest`.
4. Remove package manager jika tidak perlu.
5. Jangan include build tool di runtime image.
6. Jangan include source code jika tidak perlu.
7. Jangan include `.git`, test data, credential.
8. Jalankan sebagai non-root.
9. Buat filesystem final minimal.
10. Scan image.
11. Update base image secara berkala.
12. Gunakan digest untuk production promotion.

Contoh `.dockerignore`:

```dockerignore
.git
.gitignore
target/
build/
.gradle/
.mvn/wrapper/maven-wrapper.jar
node_modules/
*.log
.env
.env.*
secrets/
docker-compose*.yml
README.md
```

Catatan: jangan ignore artifact build jika Dockerfile memang butuh menyalin artifact dari host. Sesuaikan dengan strategi build.

---

## 19. Distroless dan Minimal Image: Security vs Operability

Minimal image mengurangi attack surface.

Contoh manfaat:

- tidak ada shell;
- tidak ada package manager;
- lebih sedikit binary;
- lebih sedikit CVE OS package;
- lebih kecil.

Tetapi trade-off:

- debugging lebih sulit;
- tidak bisa `sh` ke container;
- tidak ada `curl`, `ps`, `netstat`;
- certificate/timezone/native dependency perlu dipastikan;
- incident response butuh debug pattern lain.

### 19.1 Pattern yang sehat

Gunakan dua image profile:

```text
runtime image:
  minimal, non-root, no shell

debug image:
  same app artifact
  extra diagnostic tools
  restricted use
```

Atau gunakan debug container terpisah di network namespace yang sama jika platform mendukung.

### 19.2 Jangan mengejar image kecil secara buta

Security bukan hanya ukuran.

Image kecil tetapi:

- berjalan root;
- punya secret baked-in;
- pakai tag mutable;
- tanpa update cadence;
- tidak bisa diaudit;

tetap buruk.

---

## 20. Java-Specific Security Concerns

### 20.1 Privileged ports

Java app tidak perlu bind 80/443 di container.

Gunakan:

```text
server.port=8080
```

Lalu host/proxy mapping:

```bash
-p 80:8080
```

Manfaat:

- tidak butuh `CAP_NET_BIND_SERVICE`;
- lebih portable;
- lebih jelas.

### 20.2 Heap dump dapat berisi secret

Heap dump bisa mengandung:

- password;
- token;
- session;
- PII;
- request body;
- decrypted secret;
- private key object.

Jangan sembarang enable:

```text
-XX:+HeapDumpOnOutOfMemoryError
```

Jika perlu:

```text
-XX:HeapDumpPath=/dumps
```

Mount `/dumps` dengan permission ketat, lifecycle jelas, dan akses terbatas.

### 20.3 Truststore dan keystore

Java TLS sering memakai:

- `cacerts`;
- custom truststore;
- keystore;
- mTLS private key.

Jangan bake private key ke image.

Lebih baik:

```yaml
volumes:
  - ./secrets/client-keystore.p12:/run/secrets/client-keystore.p12:ro
```

JVM option:

```text
-Djavax.net.ssl.keyStore=/run/secrets/client-keystore.p12
-Djavax.net.ssl.keyStorePasswordFile=/run/secrets/client-keystore-password
```

Tidak semua library support `PasswordFile`; kadang perlu bootstrap code untuk membaca file secret.

### 20.4 Remote debugging port

Jangan expose JDWP di production.

Buruk:

```bash
-p 5005:5005
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

JDWP yang terbuka bisa menjadi remote code execution.

Jika debugging sangat perlu:

- bind ke localhost;
- pakai SSH tunnel/VPN;
- temporary only;
- audit;
- never public.

### 20.5 JMX

JMX remote juga sensitif.

Risiko:

- information disclosure;
- operation invocation;
- weak auth;
- RMI port confusion;
- accidental public exposure.

Gunakan dengan sangat hati-hati.

### 20.6 Java agents

Observability/security agents dapat butuh:

- file write;
- network egress;
- additional env;
- mounted config;
- sometimes extra permissions.

Audit agent seperti dependency production.

---

## 21. Recommended Hardened Java Dockerfile

Contoh seimbang untuk Spring Boot JAR:

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jre-jammy

ARG APP_UID=10001
ARG APP_GID=10001

RUN groupadd --gid ${APP_GID} app \
    && useradd \
        --uid ${APP_UID} \
        --gid ${APP_GID} \
        --system \
        --home-dir /app \
        --shell /usr/sbin/nologin \
        app

WORKDIR /app

RUN mkdir -p /app/tmp \
    && chown -R app:app /app

COPY --chown=app:app target/app.jar /app/app.jar

ENV JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/app/tmp"

USER ${APP_UID}:${APP_GID}

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Runtime:

```bash
docker run \
  --rm \
  --name my-java-app \
  --user 10001:10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --read-only \
  --tmpfs /app/tmp:rw,noexec,nosuid,size=128m \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -p 127.0.0.1:8080:8080 \
  my-java-app:1.0.0
```

Compose:

```yaml
services:
  app:
    image: my-java-app:1.0.0
    user: "10001:10001"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /app/tmp:rw,noexec,nosuid,size=128m
      - /tmp:rw,noexec,nosuid,size=64m
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      JAVA_TOOL_OPTIONS: >-
        -Djava.io.tmpdir=/app/tmp
        -XX:MaxRAMPercentage=75
```

---

## 22. Security Options Decision Matrix

| Control | Default? | Java service recommendation |
|---|---:|---|
| Non-root user | Often no | Yes |
| Drop capabilities | No | Yes, if app compatible |
| `no-new-privileges` | No | Yes |
| Default seccomp | Yes on Linux | Keep enabled |
| Custom seccomp | No | Only if justified |
| AppArmor default | Often yes | Keep enabled |
| SELinux labels | Host-dependent | Respect, do not bypass blindly |
| Read-only rootfs | No | Strongly recommended |
| tmpfs writable dirs | No | Use for `/tmp` and app temp |
| No docker.sock | N/A | Never mount into app |
| No privileged | No | Never for ordinary Java app |
| Bind localhost | No | Use for local-only exposure |
| Secret file mount | No | Prefer for sensitive values |
| Digest pinning | No | Recommended for production |

---

## 23. Debugging Security-Related Failures

### 23.1 `permission denied`

Decision tree:

```text
permission denied
  ↓
Is process non-root?
  ↓
What UID/GID?
  ↓
Who owns the file/path?
  ↓
Is mount read-only?
  ↓
Is root filesystem read-only?
  ↓
Is tmp path writable?
  ↓
Is SELinux/AppArmor denying?
  ↓
Was capability dropped?
```

Commands:

```bash
docker inspect app --format '{{json .Config.User}}'
docker exec app id
docker exec app ls -ld /app /app/tmp /tmp
docker inspect app --format '{{json .HostConfig.ReadonlyRootfs}}'
docker inspect app --format '{{json .HostConfig.CapDrop}}'
docker inspect app --format '{{json .HostConfig.SecurityOpt}}'
```

### 23.2 App fails only with `read_only: true`

Likely writes to:

- `/tmp`;
- working directory;
- logging file;
- embedded server temp;
- extracted native lib path;
- generated cache;
- heap dump path.

Fix by explicit tmpfs/volume and config.

### 23.3 App fails after `cap_drop: ALL`

Likely needs capability:

- binding port < 1024;
- raw socket;
- special native library;
- profiler.

Prefer changing app port before adding capability.

### 23.4 App fails under non-root but works as root

Likely:

- file ownership;
- directory permission;
- bind mount UID mismatch;
- certificate file permission;
- generated file location;
- process tries to write under `/root`, `/var`, or `/app`.

Fix root cause, do not revert to root blindly.

---

## 24. Common Anti-Patterns

### 24.1 Running Java as root

```dockerfile
FROM eclipse-temurin:21-jre
COPY app.jar /app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

Problem:

- unnecessary privilege;
- poor blast radius;
- bad default for production.

### 24.2 `chmod -R 777`

```dockerfile
RUN chmod -R 777 /app
```

Problem:

- hides ownership design;
- allows arbitrary modification;
- makes compromise worse.

Prefer:

```dockerfile
RUN chown -R app:app /app
```

and precise permissions.

### 24.3 `--privileged` for app

```bash
docker run --privileged my-java-app
```

Problem:

- defeats container confinement.

### 24.4 Mounting Docker socket

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

Problem:

- app compromise can become Docker daemon compromise.

### 24.5 Baking secrets

```dockerfile
ENV API_KEY=...
```

Problem:

- secret stored in image metadata/history.

### 24.6 Disabling seccomp

```bash
--security-opt seccomp=unconfined
```

Problem:

- removes syscall filter.

### 24.7 Publishing all ports to all interfaces

```yaml
ports:
  - "8080:8080"
```

Problem if intended local-only.

Prefer:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

### 24.8 Writable application directory

If `/app` is writable, attacker can modify runtime files.

Prefer:

- app artifact read-only;
- tmp/cache elsewhere;
- read-only rootfs.

---

## 25. Security Review Checklist untuk Java Docker Service

### Image

- [ ] Base image tepercaya.
- [ ] Tidak memakai `latest` untuk production.
- [ ] Runtime image tidak berisi build tool.
- [ ] Tidak ada `.git`, `.env`, secret, test fixture.
- [ ] Tidak ada private key di image.
- [ ] Image discan.
- [ ] Dependency update cadence jelas.
- [ ] Image dapat dihubungkan ke commit/build provenance.

### Dockerfile

- [ ] `USER` non-root.
- [ ] `COPY --chown` digunakan.
- [ ] Tidak ada secret dalam `ARG`/`ENV`.
- [ ] Tidak ada `chmod -R 777`.
- [ ] `ENTRYPOINT` exec form.
- [ ] App bind port non-privileged.
- [ ] Writable path eksplisit.

### Runtime

- [ ] `cap_drop: [ALL]` atau minimal capabilities.
- [ ] `no-new-privileges:true`.
- [ ] Read-only root filesystem jika memungkinkan.
- [ ] tmpfs untuk `/tmp`/app temp.
- [ ] No docker.sock mount.
- [ ] Bind mount read-only jika hanya baca.
- [ ] Port local-only jika tidak public.
- [ ] Resource limits diset.
- [ ] Healthcheck tidak membocorkan data.
- [ ] Logs ke stdout/stderr.

### Java

- [ ] Heap dump path aman atau disabled.
- [ ] JDWP tidak terbuka public.
- [ ] JMX tidak terbuka public.
- [ ] Actuator endpoint diproteksi.
- [ ] TLS keystore/truststore via secret mount.
- [ ] Temp dir dikontrol.
- [ ] Graceful shutdown tetap bekerja dengan hardening.

### Host/Daemon

- [ ] Docker group membership dibatasi.
- [ ] Docker daemon tidak expose TCP unauthenticated.
- [ ] Rootless/userns-remap dipertimbangkan.
- [ ] Host patching dan kernel update policy ada.
- [ ] Audit akses registry dan daemon.

---

## 26. Production Baseline Example

Compose production-like baseline:

```yaml
services:
  app:
    image: registry.example.com/team/my-java-app:1.4.7
    user: "10001:10001"
    read_only: true

    cap_drop:
      - ALL

    security_opt:
      - no-new-privileges:true

    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
      - /app/tmp:rw,noexec,nosuid,size=128m

    environment:
      JAVA_TOOL_OPTIONS: >-
        -Djava.io.tmpdir=/app/tmp
        -XX:MaxRAMPercentage=75
        -XX:+ExitOnOutOfMemoryError

    volumes:
      - ./config/application.yml:/app/config/application.yml:ro
      - ./secrets/truststore.p12:/run/secrets/truststore.p12:ro

    ports:
      - "127.0.0.1:8080:8080"

    restart: unless-stopped

    healthcheck:
      test: ["CMD", "java", "-version"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
```

Catatan:

- Healthcheck `java -version` hanya contoh minimal process/runtime check, bukan readiness HTTP.
- Untuk Spring Boot, biasanya pakai endpoint readiness:
  - `/actuator/health/readiness`
- Namun jika image minimal tidak punya `curl`, healthcheck perlu binary/tool tersedia atau pendekatan lain.

---

## 27. Better Healthcheck untuk Minimal Java Image

Jika tidak ada `curl`, beberapa opsi:

### Opsi 1: Tambah small HTTP checker binary

Pros:

- tidak butuh shell/curl;
- bisa kecil.

Cons:

- artifact tambahan.

### Opsi 2: Gunakan Java-based health checker

Misalnya class kecil yang melakukan HTTP GET ke localhost.

Pros:

- tetap Java-only.

Cons:

- menambah kompleksitas.

### Opsi 3: Platform external healthcheck

Biarkan orchestrator/load balancer memanggil endpoint health dari luar.

Pros:

- runtime image tetap minimal.

Cons:

- Docker standalone `HEALTHCHECK` tidak memberi status internal.

### Opsi 4: Pakai base image dengan tool minimal

Pros:

- mudah.

Cons:

- attack surface lebih besar.

Tidak ada satu jawaban universal. Pilih berdasarkan:

- security profile;
- operability;
- platform;
- incident response;
- image policy.

---

## 28. Failure Scenario: RCE di Java App

Bayangkan aplikasi punya vulnerability yang memungkinkan attacker menjalankan command.

### 28.1 Tanpa hardening

```text
whoami → root
pwd → /app
touch /usr/local/bin/backdoor → success
cat /run/secrets/db-password → success
curl metadata/internal services → success
docker ps via mounted socket → success
docker run privileged container → host compromise
```

### 28.2 Dengan hardening

```text
whoami → app
touch /usr/local/bin/backdoor → read-only filesystem
apk/apt install → no package manager / no permission
mount → permission denied
setuid escalation → no-new-privileges blocks
raw socket → capability missing
docker socket → not mounted
secret files → least privilege path and permission
```

Attacker masih bisa melakukan hal-hal dalam boundary aplikasi, tetapi blast radius jauh lebih kecil.

---

## 29. Practical Hardening Progression

Jangan langsung menerapkan semua kontrol tanpa test. Lakukan bertahap.

### Stage 1 — Basic hygiene

- non-root user;
- no secret in image;
- no docker.sock;
- no privileged;
- app port 8080.

### Stage 2 — Runtime restrictions

- `no-new-privileges`;
- drop capabilities;
- read-only rootfs;
- tmpfs explicit.

### Stage 3 — Host/daemon hardening

- restrict Docker group;
- userns-remap/rootless evaluation;
- daemon socket policy;
- registry auth control.

### Stage 4 — Supply chain

- scanning;
- SBOM;
- signed/provenance artifact;
- digest promotion.

### Stage 5 — Operational maturity

- debug image;
- incident playbook;
- least-privilege network;
- secret rotation;
- audit trail.

---

## 30. Key Takeaways

1. Docker security adalah **blast radius reduction**, bukan magic sandbox.
2. Java service hampir selalu bisa berjalan sebagai non-root.
3. `--privileged` hampir tidak pernah benar untuk application container.
4. Docker socket mount adalah salah satu risiko terbesar.
5. Capabilities harus minimum; mulai dari drop all jika memungkinkan.
6. Default seccomp dan AppArmor/SELinux adalah lapisan penting.
7. Read-only root filesystem sangat efektif, tetapi Java butuh writable temp path eksplisit.
8. Secret tidak boleh masuk image layer, Dockerfile history, atau env yang mudah diinspect.
9. Rootless mode dan userns-remap menambah defense-in-depth, tetapi tidak menggantikan hardening container.
10. Security yang baik harus tetap operable: siapkan debug strategy, healthcheck strategy, dan incident workflow.

---

## 31. Latihan

### Latihan 1 — Hardening Dockerfile

Ambil Dockerfile Java sederhana:

```dockerfile
FROM eclipse-temurin:21-jre
COPY target/app.jar /app.jar
ENTRYPOINT ["java", "-jar", "/app.jar"]
```

Ubah agar:

- memakai non-root user;
- file dimiliki user app;
- app berjalan di `/app`;
- temp dir eksplisit;
- port 8080 diexpose;
- `ENTRYPOINT` tetap exec form.

### Latihan 2 — Hardening Compose

Buat Compose service dengan:

- `user`;
- `cap_drop`;
- `security_opt`;
- `read_only`;
- `tmpfs`;
- read-only config mount;
- port bind ke localhost.

### Latihan 3 — Debug Permission Denied

Simulasikan container non-root yang gagal menulis `/app`.

Jawab:

- UID proses berapa?
- owner `/app` siapa?
- apakah rootfs read-only?
- apakah mount override path?
- perbaikan terbaik apa?

### Latihan 4 — Threat Modeling

Asumsikan attacker mendapatkan RCE di aplikasi.

Tuliskan apa yang bisa dan tidak bisa dilakukan attacker jika container memakai:

- root user;
- non-root user;
- non-root + read-only;
- non-root + read-only + cap drop + no-new-privileges;
- semua di atas tetapi docker.sock mounted.

### Latihan 5 — Java Runtime Path Audit

Audit aplikasi Java kamu:

- path temp;
- path log;
- heap dump path;
- JFR path;
- upload path;
- truststore/keystore path;
- config path.

Tentukan mana yang harus read-only, writable tmpfs, atau persistent volume.

---

## 32. Sumber Utama

Sumber resmi dan referensi yang relevan:

- Docker Engine security documentation.
- Docker rootless mode documentation.
- Docker user namespace remapping documentation.
- Docker seccomp security profile documentation.
- Docker AppArmor security profile documentation.
- Docker CLI `docker run` reference.
- Docker Compose services reference, terutama `security_opt`, `cap_drop`, `read_only`, `tmpfs`, `user`.
- Spring Boot documentation untuk graceful shutdown, Actuator health, dan externalized configuration.

---

## 33. Hubungan ke Part Berikutnya

Part ini membahas runtime hardening.

Part berikutnya akan masuk ke supply chain:

```text
Part 018 — Image Supply Chain: Registry, Tags, Digests, SBOM, Signing, Scanning
```

Di sana fokusnya bergeser dari:

```text
“container ini boleh melakukan apa saat berjalan?”
```

menjadi:

```text
“artifact ini berasal dari mana, berisi apa, bisa dipercaya sejauh apa, dan bagaimana kita mempromosikannya secara aman?”
```

---

# Status Seri

Selesai:

- Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
- Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
- Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc
- Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform
- Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove
- Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector
- Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes
- Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit
- Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
- Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals
- Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1
- Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State
- Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing
- Part 013 — Docker Compose as Local System Model
- Part 014 — Compose for Java Development: Databases, Brokers, Mock Services
- Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics
- Part 016 — Configuration and Secrets: Env, Files, Build Args, Runtime Injection
- Part 017 — Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor

Belum selesai:

- Part 018–031

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Configuration and Secrets: Env, Files, Build Args, Runtime Injection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-018.md">Part 018 — Image Supply Chain: Registry, Tags, Digests, SBOM, Signing, Scanning ➡️</a>
</div>
