# learn-docker-mastery-for-java-engineers-part-001.md

# Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Docker secara struktural, bukan sekadar menghafal command.  
> Status seri: Part 001 dari 031. Seri belum selesai.

---

## 0. Tujuan Part Ini

Part ini membangun mental model paling penting dalam Docker:

> **Container bukan mesin virtual kecil. Container adalah proses biasa di host Linux yang diberi boundary tertentu oleh kernel.**

Boundary itu terutama berasal dari:

1. **Namespace** — membatasi apa yang bisa dilihat proses.
2. **Cgroup** — membatasi dan mengukur resource yang bisa dipakai proses.
3. **Filesystem layering dan mount** — memberi root filesystem terpisah dari host.
4. **Capability/security profile** — membatasi privilege proses.
5. **Runtime contract** — menentukan executable, argument, env, mount, network, user, dan signal behavior.

Part ini tidak akan masuk terlalu dalam ke kernel internals karena itu sudah cocok untuk seri Linux Kernel. Di sini kita fokus pada **cara berpikir application engineer** saat membangun, menjalankan, dan men-debug Java service dalam container.

Setelah menyelesaikan part ini, kamu harus bisa menjawab:

- Apa sebenarnya container dari sudut pandang OS?
- Apa yang benar-benar terisolasi dan apa yang tidak?
- Mengapa container bisa melihat filesystem berbeda tetapi tetap memakai kernel host?
- Mengapa `localhost` di container sering membingungkan?
- Mengapa Java bisa OOMKilled walaupun heap terlihat aman?
- Mengapa root di container tetap berbahaya?
- Mengapa signal handling dan PID 1 penting untuk graceful shutdown?
- Mengapa container boundary adalah reliability boundary, bukan sekadar deployment convenience?

---

## 1. Core Mental Model

Docker sering dipasarkan dengan narasi sederhana:

> “Package your application and run it anywhere.”

Kalimat itu berguna untuk onboarding, tetapi tidak cukup untuk mastery.

Mental model yang lebih akurat:

> **Docker menjalankan proses di host, tetapi proses itu diberi pandangan dunia yang berbeda: filesystem berbeda, process tree berbeda, network stack berbeda, hostname berbeda, resource accounting berbeda, dan policy security berbeda.**

Dengan kata lain, container bukan objek ajaib. Container adalah hasil konfigurasi kernel dan runtime.

Secara kasar:

```text
Host Linux Kernel
│
├── Process A: normal host process
│
├── Process B: normal host process
│
└── Process C: containerized Java process
    ├── sees its own PID namespace
    ├── sees its own network namespace
    ├── sees its own mounted root filesystem
    ├── is constrained by cgroup limits
    ├── may run as non-root or root inside container
    └── still uses the same host kernel
```

Implikasinya besar:

- Container tidak membawa kernel sendiri.
- Container tidak boot OS lengkap seperti VM.
- Container startup cepat karena hanya memulai proses.
- Kernel vulnerability host bisa berdampak ke container.
- Container isolation bukan security absolut.
- Resource limit container bergantung pada mekanisme host.
- Observability harus melihat dua sisi: inside-container view dan host view.

---

## 2. Container vs VM: Bedanya Bukan Sekadar “Lebih Ringan”

Perbandingan yang sering muncul:

```text
VM        = virtualized machine with its own guest OS kernel
Container = isolated process sharing host kernel
```

Ini benar, tapi perlu diperluas.

### 2.1 VM

VM biasanya memiliki:

- virtual hardware
- guest OS
- guest kernel
- init system
- system services
- application process

Strukturnya:

```text
Physical/Cloud Host
└── Hypervisor
    ├── VM 1
    │   ├── Guest Kernel
    │   ├── OS Services
    │   └── App
    └── VM 2
        ├── Guest Kernel
        ├── OS Services
        └── App
```

VM boundary relatif kuat karena setiap VM punya kernel sendiri. Jika aplikasi dalam VM melakukan syscall, syscall itu masuk ke guest kernel, lalu diterjemahkan melalui virtualisasi ke host.

### 2.2 Container

Container tidak punya guest kernel. Aplikasi langsung melakukan syscall ke host kernel.

```text
Host
├── Host Kernel
├── Docker/container runtime
├── Container A process
├── Container B process
└── Normal host process
```

Container boundary bukan berasal dari kernel terpisah, melainkan dari fitur isolasi kernel.

### 2.3 Konsekuensi Praktis

| Aspek | VM | Container |
|---|---|---|
| Kernel | Guest kernel sendiri | Berbagi host kernel |
| Startup | Boot OS, lebih berat | Start process, lebih cepat |
| Isolation | Lebih kuat secara default | Bergantung pada namespace/cgroup/security profile |
| Image size | Biasanya lebih besar | Biasanya lebih kecil |
| Resource overhead | Lebih tinggi | Lebih rendah |
| Operational model | Machine-centric | Process/application-centric |
| Patch kernel | Per guest OS | Host kernel |
| Escape risk | Hypervisor boundary | Kernel/runtime boundary |

Hal yang sering salah dipahami:

> Container bukan “VM yang lebih kecil”. Container adalah cara menjalankan proses dengan lingkungan yang dikurasi.

Untuk Java engineer, ini berarti container harus dipahami sebagai:

- process boundary
- packaging boundary
- resource boundary
- filesystem boundary
- network boundary
- security boundary
- operational boundary

Bukan sebagai server mini yang kamu rawat seperti VM.

---

## 3. Apa yang Terjadi Saat Container Berjalan?

Bayangkan kamu menjalankan:

```bash
docker run eclipse-temurin:21 java -version
```

Dari luar terlihat sederhana. Tetapi secara konseptual runtime melakukan hal seperti ini:

1. Resolve image `eclipse-temurin:21`.
2. Pull image jika belum ada lokal.
3. Siapkan root filesystem dari image layers.
4. Buat container configuration:
   - command
   - environment variable
   - working directory
   - mount
   - network
   - user
   - resource limit
   - security options
5. Buat namespace baru sesuai konfigurasi.
6. Apply cgroup resource accounting/limit.
7. Mount root filesystem container.
8. Start process `java -version` di dalam boundary itu.
9. Attach stdout/stderr ke Docker logging.
10. Tunggu proses selesai.
11. Simpan exit code.

Yang penting:

> Container hidup selama process utamanya hidup.

Tidak ada “server container” yang tetap berjalan jika process utama selesai.

Contoh:

```bash
docker run ubuntu echo hello
```

Container akan:

1. start
2. menjalankan `echo hello`
3. selesai
4. masuk status exited

Itu bukan error. Itu sesuai modelnya.

Jika kamu menjalankan Java app:

```bash
docker run my-service:1.0.0
```

Container hidup selama JVM process utama hidup.

Jika JVM crash, container keluar.
Jika JVM selesai normal, container keluar.
Jika JVM menerima SIGTERM lalu shutdown, container keluar.
Jika JVM stuck tetapi process masih hidup, container tetap dianggap running kecuali healthcheck mengatakan unhealthy.

---

## 4. Namespace: “Apa yang Bisa Dilihat Proses?”

Namespace membatasi pandangan proses terhadap sistem.

Analogi sederhana:

> Namespace bukan membatasi berapa banyak resource dipakai. Namespace membatasi “dunia mana yang terlihat”.

Beberapa namespace penting untuk Docker:

1. PID namespace
2. Mount namespace
3. Network namespace
4. UTS namespace
5. IPC namespace
6. User namespace
7. Cgroup namespace

Kita bahas dari sudut pandang engineer yang men-debug aplikasi.

---

## 5. PID Namespace: Process Tree yang Terlihat Berbeda

Di host, semua proses punya PID global.

Di dalam container, proses bisa melihat PID yang berbeda.

Contoh konseptual:

```text
Host view:
PID 1000 dockerd
PID 2100 containerd-shim
PID 2150 java -jar app.jar

Inside container view:
PID 1 java -jar app.jar
```

Proses Java yang di host PID-nya 2150 bisa terlihat sebagai PID 1 di dalam container.

### 5.1 Mengapa PID 1 Penting?

Di Linux, PID 1 punya tanggung jawab dan perilaku khusus. Dalam container, process utama sering menjadi PID 1.

Masalah umum:

- PID 1 harus menangani signal dengan benar.
- PID 1 harus melakukan reaping zombie process.
- Shell wrapper yang menjadi PID 1 bisa menelan signal.
- Java process bisa tidak menerima SIGTERM jika dibungkus script yang buruk.

Anti-pattern:

```dockerfile
ENTRYPOINT java -jar app.jar
```

Itu shell form. Biasanya dieksekusi melalui shell:

```text
/bin/sh -c "java -jar app.jar"
```

Akibatnya shell bisa menjadi PID 1, bukan Java process secara langsung.

Lebih baik:

```dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Atau jika memakai wrapper script:

```sh
#!/usr/bin/env sh
set -e
exec java -jar app.jar
```

Kata kuncinya: `exec`.

Tanpa `exec`, shell tetap menjadi PID 1 dan Java menjadi child process.
Dengan `exec`, shell digantikan oleh Java process.

### 5.2 Implikasi untuk Spring Boot

Spring Boot biasanya mendukung graceful shutdown jika:

- JVM menerima SIGTERM.
- Application context diberi waktu menutup.
- HTTP server berhenti menerima request baru.
- In-flight request diberi kesempatan selesai.
- Resource seperti datasource, executor, scheduler ditutup.

Tetapi semua itu gagal jika SIGTERM tidak sampai ke JVM.

Docker stop flow secara default:

```text
docker stop
  ├── send SIGTERM
  ├── wait grace period
  └── send SIGKILL if process still alive
```

Jika Java tidak menerima SIGTERM, container bisa mati paksa dengan SIGKILL. Efeknya:

- request terputus
- offset/ack belum selesai
- lock tidak dilepas dengan rapi
- file belum flush
- trace/log belum terkirim
- shutdown hook tidak jalan

Untuk service yang memproses transaksi, enforcement workflow, message consumption, atau state transition, ini bukan detail kecil. Ini bisa menjadi correctness issue.

---

## 6. Mount Namespace: Filesystem yang Terlihat Berbeda

Mount namespace membuat proses melihat struktur mount yang berbeda dari host.

Container biasanya punya root filesystem sendiri:

```text
Inside container:
/
├── app
├── bin
├── etc
├── lib
├── tmp
└── usr
```

Tetapi itu bukan berarti container punya disk sendiri seperti VM. Root filesystem itu disusun dari:

- image layers
- writable container layer
- volume mount
- bind mount
- tmpfs mount

### 6.1 Image Root Filesystem

Image menyediakan filesystem awal.

Misalnya image Java runtime bisa memiliki:

```text
/usr/bin/java
/opt/java/openjdk
/etc/ssl/certs
```

Ketika container dibuat, image itu digunakan sebagai template. Lalu runtime menambahkan writable layer di atasnya.

### 6.2 Writable Container Layer

Jika proses menulis file ke path yang bukan volume, tulisan itu masuk ke writable layer container.

Contoh:

```bash
touch /tmp/report.txt
```

File itu ada di container tersebut, bukan di image.

Jika container dihapus, writable layer hilang.

Konsekuensi:

> Container bukan tempat menyimpan state penting.

Untuk Java app, hati-hati dengan:

- uploaded file
- generated report
- temp processing file
- embedded database
- local cache
- log file
- heap dump
- JFR file
- exported CSV

Jika file itu penting setelah container hilang, simpan di volume, object storage, database, atau external storage.

### 6.3 Bind Mount vs Volume

Ada dua pola umum:

```text
Bind mount:
Host path directly mounted into container

Named volume:
Docker-managed storage mounted into container
```

Bind mount cocok untuk:

- development source code
- local config
- mounting certificate dari host
- debugging

Named volume cocok untuk:

- local database data
- persistent dev state
- Docker-managed lifecycle

Tetapi untuk production-grade application state, sering kali lebih tepat menggunakan external system, bukan volume lokal container host, kecuali deployment modelnya memang single-host dan backup strategy jelas.

### 6.4 File Hidden by Mount

Salah satu bug umum:

Image memiliki file:

```text
/app/config/default.yaml
```

Lalu kamu mount host directory ke `/app/config`.

```bash
docker run -v ./config:/app/config my-app
```

Isi `/app/config` dari image tertutup oleh mount. Jika host directory kosong, file `default.yaml` seolah “hilang”.

Ini sering membuat engineer bingung:

> “Padahal file ada di image, kenapa container bilang missing?”

Jawabannya: mount menutupi path image.

---

## 7. Network Namespace: `localhost` Tidak Selalu yang Kamu Maksud

Network namespace memberi container network stack sendiri.

Container biasanya punya:

- interface sendiri
- IP sendiri di Docker network
- routing table sendiri
- port binding sendiri
- DNS view sendiri

### 7.1 `localhost` di Dalam Container

Ini sumber bug paling sering.

Jika Java app di container mencoba connect ke:

```text
localhost:5432
```

Maka `localhost` berarti container itu sendiri, bukan host, bukan container database lain.

Jika PostgreSQL berjalan di container lain, `localhost` salah.

Dalam Compose, biasanya pakai service name:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/appdb
```

Bukan:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/appdb
```

### 7.2 Binding Address

Masalah lain: aplikasi bind ke `127.0.0.1` di dalam container.

Misalnya Spring Boot hanya listen di:

```text
127.0.0.1:8080
```

Port sudah dipublish:

```bash
docker run -p 8080:8080 my-app
```

Tetapi dari host tetap tidak bisa akses.

Kenapa?

Karena app hanya menerima koneksi dari loopback interface container. Untuk menerima koneksi dari luar namespace container, app harus bind ke:

```text
0.0.0.0:8080
```

Dalam Spring Boot:

```properties
server.address=0.0.0.0
server.port=8080
```

Biasanya default Spring Boot sudah listen ke semua interface jika tidak diubah, tetapi config custom bisa merusaknya.

### 7.3 Port Publish Bukan Membuka Port di Container Saja

Ada tiga hal berbeda:

```text
Application listens on container port
Docker publishes container port to host port
Client connects to host port
```

Contoh:

```bash
docker run -p 8081:8080 my-app
```

Artinya:

```text
Host port 8081 -> Container port 8080
```

Jika app listen di 9090 tetapi kamu publish 8080, gagal.

Jika app listen di 8080 tetapi kamu akses host 8080 padahal publish ke 8081, gagal.

Jika app bind ke 127.0.0.1 di container, publish bisa tetap tidak membantu.

---

## 8. UTS Namespace: Hostname dan Domain Name

UTS namespace membuat container bisa punya hostname sendiri.

Di dalam container:

```bash
hostname
```

Bisa menghasilkan container ID atau hostname yang kamu set.

Pentingnya:

- logging bisa mencatat hostname container
- distributed tracing bisa memakai host identity
- beberapa legacy Java library membaca hostname
- cluster membership kadang memakai hostname

Namun hati-hati:

> Hostname container bukan identity bisnis, bukan stable service identity, dan bukan pengganti service discovery.

Container bisa dihapus dan dibuat ulang. Hostname bisa berubah.

Untuk service identity, gunakan:

- service name
- instance ID eksplisit
- deployment metadata
- tracing resource attributes
- environment variable yang dikontrol

---

## 9. IPC Namespace: Shared Memory dan Inter-Process Communication

IPC namespace mengisolasi mekanisme seperti:

- System V IPC
- POSIX message queue
- shared memory

Untuk banyak Java web service, IPC namespace jarang terlihat langsung.

Tetapi bisa relevan untuk:

- aplikasi yang memakai shared memory
- native library
- high-performance local IPC
- database embedded/native
- browser/headless testing
- ML/runtime tertentu

Masalah umum:

- shared memory terlalu kecil
- `/dev/shm` default tidak cukup
- Chrome/headless browser gagal di container

Contoh Docker option yang kadang diperlukan:

```bash
docker run --shm-size=1g ...
```

Untuk Java backend biasa, ini bukan default concern, tapi senior engineer perlu tahu karena failure-nya sering tampak aneh.

---

## 10. User Namespace: Root Inside Container Tidak Sesederhana Kelihatannya

Di dalam container, proses bisa berjalan sebagai UID 0:

```bash
whoami
# root
```

Tetapi ada dua kondisi besar:

1. Root di container dipetakan langsung ke root host.
2. Root di container dipetakan ke unprivileged host user melalui user namespace remapping/rootless mode.

Secara default pada banyak instalasi, container root masih terlalu powerful jika ada misconfiguration atau runtime vulnerability.

### 10.1 Kenapa Running as Root Berbahaya?

Jika aplikasi di-container compromise dan berjalan sebagai root, attacker memiliki lebih banyak kemampuan di dalam container:

- menulis ke path yang root-writable
- mengubah permission
- membaca file yang hanya root-readable di container
- mencoba escape surface dengan privilege lebih tinggi
- menyalahgunakan mounted Docker socket jika ada
- memodifikasi mounted host path jika permission memungkinkan

Jangan berpikir:

> “Aman karena root-nya cuma root container.”

Lebih tepat:

> “Root di container lebih sempit daripada root host dalam beberapa konfigurasi, tetapi tetap privilege tinggi dalam boundary container dan bisa berbahaya jika boundary bocor.”

### 10.2 Java App Seharusnya Tidak Butuh Root

Java service normal biasanya hanya butuh:

- membaca app jar
- membaca config
- membaca cert/truststore
- menulis ke `/tmp` atau workdir tertentu
- listen di non-privileged port seperti 8080

Maka production image sebaiknya:

```dockerfile
USER 10001:10001
```

Atau user bernama:

```dockerfile
RUN addgroup --system app && adduser --system --ingroup app app
USER app
```

Tantangannya:

- file ownership harus benar
- mounted volume permission harus cocok
- heap dump/JFR path harus writable
- temp dir harus writable
- truststore/cert harus readable

Security bukan hanya menambahkan `USER`. Security harus cocok dengan filesystem dan runtime behavior.

---

## 11. Cgroup: “Berapa Banyak Resource yang Boleh Dipakai?”

Jika namespace menjawab “apa yang terlihat”, cgroup menjawab:

> “Berapa banyak resource yang bisa dipakai dan bagaimana resource itu dihitung?”

Cgroup mengatur/mengukur:

- memory
- CPU
- process count
- block IO
- device access
- network class/accounting tertentu

Untuk Java engineer, cgroup sangat penting karena JVM melakukan banyak keputusan berdasarkan resource yang terlihat.

---

## 12. Memory Limit: Heap Bukan Satu-Satunya Memory

Misalnya container diberi memory limit:

```bash
docker run --memory=512m my-java-app
```

Banyak engineer berpikir:

> “Berarti set `-Xmx512m` aman.”

Itu salah.

JVM memory bukan hanya heap.

Komponen memory Java process:

```text
Container memory limit
└── JVM process memory
    ├── Java heap
    ├── metaspace
    ├── code cache
    ├── thread stacks
    ├── direct buffers
    ├── GC structures
    ├── JNI/native memory
    ├── malloc allocations
    ├── mapped files
    ├── agent overhead
    └── JVM internal structures
```

Jika container limit 512 MB dan heap 512 MB, total process memory bisa melewati limit. Kernel bisa membunuh process. Docker akan menunjukkan OOMKilled.

### 12.1 Java OOM vs Container OOMKilled

Dua failure ini berbeda.

Java heap OOM:

```text
java.lang.OutOfMemoryError: Java heap space
```

Container OOMKilled:

```text
Container killed by kernel because cgroup memory limit exceeded
Exit code often 137
```

Perbedaannya:

| Aspek | Java OOM | Container OOMKilled |
|---|---|---|
| Pelaku | JVM | Kernel/cgroup OOM killer |
| Error Java terlihat? | Biasanya iya | Sering tidak |
| Shutdown hook jalan? | Mungkin | Tidak jika SIGKILL |
| Exit code | Bisa 1 atau configured | Sering 137 |
| Heap dump | Bisa jika configured | Tidak selalu |
| Root cause | Heap/metaspace/direct/etc | Total memory melewati cgroup limit |

### 12.2 Rule of Thumb

Untuk container kecil, jangan set heap sama dengan limit.

Contoh kasar:

```text
Container memory: 512 MB
Max heap: 60–70% dari limit
Sisa: native memory, thread stack, metaspace, direct buffer, overhead
```

Untuk Java modern, gunakan percentage-based setting:

```bash
-XX:MaxRAMPercentage=70
-XX:InitialRAMPercentage=30
```

Namun angka final harus berdasarkan profiling dan workload, bukan copy-paste.

---

## 13. CPU Limit: Core yang “Terlihat” dan Scheduler Reality

Docker bisa memberi CPU constraint:

```bash
docker run --cpus=1.5 my-java-app
```

Atau menggunakan quota/period.

JVM dan framework Java sering memakai jumlah CPU untuk menentukan:

- GC thread count
- ForkJoinPool parallelism
- Netty event loop count
- Tomcat worker defaults
- scheduler pool
- compression/concurrency decisions

Masalahnya:

> “CPU yang tersedia secara scheduling” tidak selalu sama dengan “jumlah core fisik host”.

Jika app melihat banyak core tetapi sebenarnya dibatasi quota kecil, thread pool bisa terlalu besar.

Efeknya:

- context switching tinggi
- GC overhead naik
- latency spike
- throughput tidak naik
- noisy neighbor lebih terasa

Untuk service latency-sensitive, CPU limit harus dikaitkan dengan:

- JVM GC ergonomics
- request concurrency
- DB pool size
- HTTP client pool
- message consumer concurrency
- async executor
- batch job parallelism

Container CPU bukan hanya angka infra. Ia mempengaruhi application-level concurrency model.

---

## 14. Filesystem Boundary Bukan Security Boundary Absolut

Container memiliki root filesystem sendiri, tetapi bisa diberi mount dari host.

Contoh berbahaya:

```bash
docker run -v /:/host ubuntu
```

Container bisa melihat filesystem host di `/host`.

Lebih berbahaya:

```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock docker
```

Mount Docker socket memberi proses di container kemampuan mengontrol Docker daemon host. Ini hampir setara dengan root-level host control dalam banyak setup.

Anti-pattern:

> “Butuh deploy dari container, jadi mount Docker socket saja.”

Itu sering menjadi security hole besar.

Jika perlu CI/CD, gunakan:

- isolated runner
- rootless builder
- remote builder dengan policy
- build service terkontrol
- least privilege registry credential
- tidak sembarang mount host socket

---

## 15. Container Isolation: Apa yang Terisolasi dan Apa yang Tidak?

### 15.1 Biasanya Terisolasi

Dalam konfigurasi default, container biasanya punya boundary untuk:

- process ID view
- network interface
- mount table
- hostname
- IPC resource
- cgroup accounting
- filesystem root
- selected capabilities

### 15.2 Tidak Sepenuhnya Terisolasi

Container tetap berbagi:

- host kernel
- kernel scheduler
- host memory pressure
- host disk IO
- host network stack at lower layers
- host time
- kernel bugs
- hardware
- Docker daemon trust boundary

### 15.3 Bisa Sengaja Dibuka

Docker option bisa melemahkan isolation:

```bash
--privileged
--network host
--pid host
--ipc host
-v /:/host
-v /var/run/docker.sock:/var/run/docker.sock
--cap-add SYS_ADMIN
```

Option seperti ini kadang sah untuk kasus tertentu, tetapi harus dianggap exception yang butuh justifikasi.

Prinsip:

> Setiap boundary yang dibuka harus punya alasan operasional yang kuat dan mitigasi yang jelas.

---

## 16. Container sebagai Runtime Contract

Container bukan hanya isolasi. Container juga adalah kontrak.

Sebuah image/container mendefinisikan:

- executable apa yang dijalankan
- argumen default
- environment variable
- working directory
- filesystem content
- user identity
- exposed port metadata
- healthcheck
- volume expectation
- signal behavior
- dependency assumption
- resource expectation

Untuk Java service, contract ini harus menjawab:

```text
How to start?
Which port does it listen on?
Which config must be supplied?
Where does it write temporary data?
Can it run as non-root?
How does it shut down?
How much memory does it need?
What happens when dependency is unavailable?
How do we know it is healthy?
What logs does it emit?
What architecture does it support?
```

Jika Dockerfile hanya “membuat image yang bisa jalan”, itu belum cukup.

Dockerfile yang bagus adalah executable contract antara:

- developer
- CI system
- deployment platform
- runtime host
- security scanner
- incident responder
- future maintainer

---

## 17. Java-Specific Container Reality

Java punya karakteristik yang membuat container reasoning lebih kompleks daripada aplikasi statis kecil.

### 17.1 JVM adalah Runtime di Dalam Runtime

Container runtime membatasi process.
JVM runtime mengelola heap, threads, class loading, JIT, GC, native memory.

Maka ada dua layer ergonomics:

```text
Host kernel / cgroup
└── Container runtime boundary
    └── JVM runtime
        └── Java application framework
            └── Business logic
```

Bug bisa muncul di layer mana saja.

Contoh:

- cgroup memory terlalu kecil → container OOMKilled
- JVM heap terlalu kecil → Java OOM
- thread pool terlalu besar → latency buruk
- app bind ke wrong address → network unreachable
- signal tidak sampai → graceful shutdown gagal
- file permission salah → app gagal start
- timezone/cert missing → TLS/date bug

### 17.2 Spring Boot Fat JAR dan Container Image

Spring Boot fat JAR mudah dijalankan:

```bash
java -jar app.jar
```

Tetapi image design tetap penting:

- apakah dependency layer bisa di-cache?
- apakah app layer berubah terlalu sering?
- apakah runtime image membawa build tool?
- apakah image berjalan sebagai root?
- apakah config externalized?
- apakah graceful shutdown aktif?
- apakah health endpoint benar?
- apakah JVM memory container-aware?

### 17.3 Thread dan CPU Limit

Java service sering punya banyak concurrency source:

- HTTP server threads
- DB connection pool
- async executor
- scheduler
- Kafka/RabbitMQ consumers
- Netty event loops
- common ForkJoinPool
- virtual threads, jika memakai Java modern
- GC threads

Jika container diberi CPU kecil tetapi concurrency default besar, service bisa tampak “hidup” tetapi latency buruk.

Docker tidak memperbaiki concurrency design. Docker hanya membuat batasnya lebih eksplisit.

---

## 18. Common Misleading Statements

### 18.1 “Container Isolated, Jadi Aman”

Lebih benar:

> Container memberikan isolation boundary, tetapi security bergantung pada konfigurasi, runtime, kernel, capability, user, mount, dan supply chain.

### 18.2 “Image Kecil Pasti Lebih Baik”

Lebih benar:

> Image kecil mengurangi transfer dan attack surface, tetapi terlalu minimal bisa mengurangi debuggability. Untuk production bisa pakai minimal runtime image, tetapi siapkan debug strategy.

### 18.3 “Kalau Jalan di Laptop, Pasti Jalan di Server”

Lebih benar:

> Docker mengurangi environment drift, tetapi tidak menghapus perbedaan architecture, kernel, filesystem, network, DNS, resource limit, certificate, timezone, dan host policy.

### 18.4 “Compose Sama dengan Production Orchestrator”

Lebih benar:

> Compose bagus untuk local topology dan small deployment tertentu, tetapi tidak menyediakan full scheduler, multi-node reconciliation, autoscaling, rollout strategy, dan cluster-level self-healing seperti orchestrator.

### 18.5 “Container Mati Berarti Docker Bermasalah”

Lebih benar:

> Container mati berarti process utama selesai, crash, dibunuh, atau gagal start. Root cause bisa Docker, app, config, dependency, host, resource limit, permission, atau security policy.

---

## 19. A Practical Debugging Model

Ketika container bermasalah, jangan mulai dari tebak-tebakan. Mulai dari state machine dan boundary.

Pertanyaan dasar:

```text
1. Apakah image benar?
2. Apakah container berhasil dibuat?
3. Apakah process utama berhasil start?
4. Apakah process masih running?
5. Apa exit code-nya?
6. Apa log terakhir?
7. Apakah signal/kill terjadi?
8. Apakah OOMKilled?
9. Apakah port benar-benar listen?
10. Apakah app bind ke address yang benar?
11. Apakah env/config benar?
12. Apakah mount menutupi file yang dibutuhkan?
13. Apakah permission cocok dengan USER?
14. Apakah network namespace benar?
15. Apakah dependency reachable dari dalam container?
```

Command yang biasanya berguna:

```bash
docker ps -a
docker logs <container>
docker inspect <container>
docker stats <container>
docker exec -it <container> sh
docker events
docker port <container>
docker top <container>
```

Tetapi command hanya alat. Mental model menentukan apa yang kamu cari.

---

## 20. Mini Scenario: App Jalan tapi Tidak Bisa Diakses

Problem:

```text
User menjalankan Java service dengan Docker.
Container status running.
docker logs menunjukkan Spring Boot started on port 8080.
Tetapi curl localhost:8080 dari host gagal.
```

Kemungkinan root cause:

### Case 1 — Port Tidak Dipublish

Container listen di 8080, tetapi user menjalankan:

```bash
docker run my-app
```

Tidak ada `-p`.

Fix:

```bash
docker run -p 8080:8080 my-app
```

### Case 2 — Salah Host Port

User menjalankan:

```bash
docker run -p 8081:8080 my-app
```

Tetapi curl:

```bash
curl localhost:8080
```

Fix:

```bash
curl localhost:8081
```

### Case 3 — App Bind ke 127.0.0.1 di Container

App listen hanya di loopback container.

Fix:

```properties
server.address=0.0.0.0
```

### Case 4 — App Listen di Port Berbeda

Log bilang 9090 tetapi publish 8080.

Fix:

```bash
docker run -p 8080:9090 my-app
```

### Case 5 — Health Endpoint Jalan, Business Endpoint Tidak

Container reachable, tetapi endpoint tertentu gagal karena DB dependency.

Root cause bukan Docker networking, tetapi app readiness/dependency.

Pelajaran:

> “Container running” hanya berarti process hidup. Itu tidak berarti app reachable, ready, atau correct.

---

## 21. Mini Scenario: Java Container Mati dengan Exit 137

Problem:

```text
Container Java service restart terus.
docker ps -a menunjukkan exit code 137.
```

Exit 137 sering berarti process menerima SIGKILL. Dalam konteks container, penyebab umum adalah OOMKilled.

Langkah diagnosis:

```bash
docker inspect <container>
```

Cari:

```json
"OOMKilled": true
```

Kemungkinan root cause:

- heap terlalu besar dibanding container memory limit
- direct buffer besar
- terlalu banyak thread
- metaspace leak
- native memory leak
- image/app melakukan operasi memory spike saat startup
- memory limit terlalu agresif

Fix bukan sekadar menaikkan memory.

Analisis yang lebih benar:

```text
1. Berapa container memory limit?
2. Berapa MaxHeap efektif?
3. Berapa jumlah thread?
4. Apakah memakai Netty/direct buffer?
5. Apakah ada native agent?
6. Apakah ada burst saat startup/migration/cache warmup?
7. Apakah workload berubah?
8. Apakah container punya swap?
9. Apakah host memory pressure mempengaruhi?
```

Prinsip:

> Java memory tuning dalam container harus melihat total process memory, bukan heap saja.

---

## 22. Mini Scenario: File Ada di Image tapi Hilang Saat Runtime

Problem:

Dockerfile:

```dockerfile
COPY config/default.yaml /app/config/default.yaml
```

Saat container tanpa volume:

```bash
docker run my-app ls /app/config
# default.yaml
```

Saat Compose:

```yaml
services:
  app:
    image: my-app
    volumes:
      - ./config:/app/config
```

Di container:

```bash
ls /app/config
# empty
```

Root cause:

> Bind mount `./config` menutupi `/app/config` dari image.

Fix options:

- Jangan mount ke path yang sama.
- Isi host directory dengan config yang dibutuhkan.
- Mount file spesifik, bukan directory.
- Pakai path runtime config terpisah.
- Validasi config saat startup.

Contoh:

```yaml
volumes:
  - ./config/local.yaml:/app/runtime-config/local.yaml:ro
```

---

## 23. Mini Scenario: Permission Denied Setelah Menambahkan USER

Problem:

Dockerfile awal berjalan sebagai root. Lalu di-hardening:

```dockerfile
USER 10001:10001
```

Container gagal:

```text
Permission denied: /app/logs/app.log
```

Root cause:

File/directory dimiliki root dan tidak writable oleh UID 10001.

Fix:

```dockerfile
RUN mkdir -p /app/logs && chown -R 10001:10001 /app
USER 10001:10001
```

Tapi lebih baik untuk logs:

> Write logs to stdout/stderr, not application file path inside container.

Jika butuh heap dump:

```dockerfile
RUN mkdir -p /app/dumps && chown -R 10001:10001 /app/dumps
```

Runtime option:

```bash
-XX:HeapDumpPath=/app/dumps
```

Pelajaran:

> Security hardening harus diuji bersama filesystem write behavior aplikasi.

---

## 24. Container Boundary sebagai Failure Domain

Untuk sistem production, container adalah failure domain kecil.

Satu container bisa gagal karena:

- process crash
- OOMKilled
- disk penuh
- mount missing
- wrong config
- dependency unreachable
- security policy denial
- wrong platform image
- DNS issue
- corrupted local volume

Yang bagus dari container:

- failure lebih terlokalisir
- instance bisa diganti
- image bisa dipromosikan sebagai artifact immutable
- rollback bisa memakai digest/tag sebelumnya
- local reproduction lebih mudah

Yang tidak otomatis:

- data consistency
- graceful shutdown
- idempotency
- retry safety
- resource sizing
- deployment orchestration
- security hardening
- observability

Docker memberi boundary. Engineer tetap harus mendesain behavior di dalam boundary itu.

---

## 25. Container sebagai Unit Deployment Java Service

Untuk Java backend, container sering menjadi unit deployment:

```text
source code -> build artifact -> image -> container -> service instance
```

Tetapi jangan campur semua konsep.

### 25.1 Source Code

Contoh:

```text
src/main/java
pom.xml
build.gradle
```

Ini input build.

### 25.2 Build Artifact

Contoh:

```text
target/app.jar
build/libs/app.jar
```

Ini hasil build Java.

### 25.3 Image Artifact

Contoh:

```text
registry.example.com/payment-service:1.4.2
registry.example.com/payment-service@sha256:...
```

Ini artifact deployment.

### 25.4 Container Instance

Contoh:

```text
payment-service-abc123 running on host node-7
```

Ini eksekusi dari image dengan config tertentu.

### 25.5 Service

Service adalah konsep lebih tinggi:

```text
payment-service = multiple container instances + routing + config + dependencies + SLO
```

Docker sendiri tidak menyelesaikan semua service-level concern.

---

## 26. Invariants yang Harus Kamu Pegang

Invariants adalah aturan mental yang membantu menghindari kebingungan.

### Invariant 1 — Container Adalah Process Boundary

Jika process utama selesai, container selesai.

### Invariant 2 — Image Immutable, Container Mutable

Image tidak berubah saat container menulis file. Container writable layer berubah.

### Invariant 3 — Tag Bukan Identity Absolut

Tag bisa dipindahkan. Digest lebih kuat sebagai identity artifact.

### Invariant 4 — `localhost` Adalah Local terhadap Namespace

`localhost` dalam container berarti container itu sendiri.

### Invariant 5 — Heap Bukan Total Memory

Java process memory mencakup heap dan non-heap/native memory.

### Invariant 6 — Running Bukan Ready

Container running hanya berarti process hidup.

### Invariant 7 — Root di Container Tetap Risiko

Jalankan aplikasi sebagai non-root jika memungkinkan.

### Invariant 8 — Mount Bisa Menutupi Isi Image

Path yang dimount menggantikan view filesystem pada path itu.

### Invariant 9 — Docker Boundary Bisa Dibuka

Option seperti `--privileged`, host network, host PID, dan Docker socket mount melemahkan isolation.

### Invariant 10 — Container Bukan Tempat State Bisnis Permanen

State penting harus berada di external durable system atau volume dengan lifecycle/backup jelas.

---

## 27. Mental Model Diagram

```text
Developer intent
    │
    ▼
Dockerfile
    │ defines
    ▼
Image
    │ immutable template
    ▼
Container configuration
    ├── command / entrypoint
    ├── env
    ├── user
    ├── mounts
    ├── network
    ├── resource limits
    ├── security policy
    └── healthcheck
    │
    ▼
Container instance
    │ starts
    ▼
Main process
    ├── PID namespace view
    ├── mount namespace view
    ├── network namespace view
    ├── cgroup constraints
    ├── capabilities
    └── logging streams
    │
    ▼
Exit code / health / logs / metrics
```

Docker mastery berarti kamu bisa menelusuri panah ini ke dua arah:

- dari Dockerfile ke runtime behavior
- dari runtime failure kembali ke root cause di image/config/host/app

---

## 28. Checklist: Apakah Kamu Sudah Memahami Part Ini?

Kamu siap lanjut jika bisa menjelaskan tanpa hafalan:

1. Mengapa container bukan VM kecil.
2. Mengapa container tetap berbagi kernel host.
3. Apa fungsi namespace secara konseptual.
4. Apa fungsi cgroup secara konseptual.
5. Mengapa PID 1 penting untuk Java graceful shutdown.
6. Mengapa `localhost` di container sering salah.
7. Mengapa published port berbeda dari container listen port.
8. Mengapa mount bisa membuat file image “hilang”.
9. Mengapa root di container tetap risiko.
10. Mengapa Java container bisa OOMKilled tanpa Java stacktrace.
11. Mengapa container running belum tentu app ready.
12. Mengapa Docker adalah runtime contract, bukan hanya packaging tool.

---

## 29. Latihan Praktis

Latihan ini dirancang untuk membentuk intuisi, bukan sekadar menjalankan command.

### Latihan 1 — Proses Selesai, Container Selesai

Jalankan:

```bash
docker run --name hello-once ubuntu echo hello
```

Lihat status:

```bash
docker ps -a
```

Pertanyaan:

- Mengapa container tidak tetap running?
- Apa process utama container itu?
- Apa exit code-nya?

Bersihkan:

```bash
docker rm hello-once
```

### Latihan 2 — PID Namespace

Jalankan:

```bash
docker run --name pid-demo -d ubuntu sleep 1000
```

Cek dari host:

```bash
docker top pid-demo
```

Cek dari dalam container:

```bash
docker exec pid-demo ps aux
```

Pertanyaan:

- PID `sleep` di host berapa?
- PID `sleep` di container berapa?
- Apa artinya?

Bersihkan:

```bash
docker rm -f pid-demo
```

### Latihan 3 — Localhost Confusion

Jalankan nginx:

```bash
docker run --name web-demo -d nginx
```

Coba dari host:

```bash
curl localhost:80
```

Kemungkinan gagal karena port belum dipublish.

Cek IP container:

```bash
docker inspect web-demo
```

Bersihkan dan jalankan dengan publish:

```bash
docker rm -f web-demo
docker run --name web-demo -d -p 8080:80 nginx
curl localhost:8080
```

Pertanyaan:

- Apa beda container port dan host port?
- Mengapa `EXPOSE 80` di image saja tidak cukup?

Bersihkan:

```bash
docker rm -f web-demo
```

### Latihan 4 — Mount Menutupi File

Buat image sederhana:

```dockerfile
FROM ubuntu
RUN mkdir -p /app/config && echo default > /app/config/default.txt
CMD ["cat", "/app/config/default.txt"]
```

Build:

```bash
docker build -t mount-demo .
```

Run tanpa mount:

```bash
docker run --rm mount-demo
```

Run dengan mount directory kosong:

```bash
mkdir -p empty-config
docker run --rm -v "$PWD/empty-config:/app/config" mount-demo
```

Pertanyaan:

- Mengapa file hilang?
- Apakah image berubah?
- Apa yang sebenarnya berubah?

### Latihan 5 — Memory Limit Intuition

Jalankan Java app kecil dengan memory limit jika kamu punya image Java sendiri.

Contoh konseptual:

```bash
docker run --memory=256m my-java-app
```

Cek:

```bash
docker stats
```

Pertanyaan:

- Berapa heap efektif?
- Berapa total memory process?
- Apakah ada direct buffer/thread/metaspace signifikan?
- Apa beda Java OOM dan OOMKilled?

---

## 30. Kesalahan Umum yang Harus Dihindari Sejak Awal

1. Menganggap container sebagai VM kecil.
2. Menyimpan state penting di writable layer container.
3. Menggunakan `localhost` untuk dependency container lain.
4. Tidak publish port lalu mengira app mati.
5. Menjalankan Java sebagai root tanpa alasan.
6. Set heap sama dengan container memory limit.
7. Mengabaikan signal handling.
8. Pakai shell wrapper tanpa `exec`.
9. Mount Docker socket ke container tanpa memahami risikonya.
10. Menganggap image kecil otomatis lebih production-ready.
11. Menganggap container running berarti service ready.
12. Mengabaikan architecture mismatch antara laptop ARM dan server amd64.
13. Men-debug berdasarkan Dockerfile, bukan runtime config aktual.
14. Tidak melihat `docker inspect` saat troubleshooting.
15. Mengira Docker menghapus kebutuhan operational design.

---

## 31. Ringkasan

Container adalah proses host yang diberi boundary. Boundary itu membuat proses melihat dunia yang berbeda, tetapi tidak menciptakan mesin virtual lengkap.

Mental model penting:

```text
Container = process + namespaces + cgroups + filesystem view + security policy + runtime config
```

Untuk Java engineer, container membawa konsekuensi khusus:

- JVM harus hidup dalam memory/CPU cgroup.
- Heap bukan total memory.
- PID 1 dan signal menentukan graceful shutdown.
- Network namespace mengubah arti `localhost`.
- Filesystem mount bisa menutupi isi image.
- Root di container tetap risiko.
- Running bukan ready.
- Image adalah artifact, container adalah instance.

Jika kamu menguasai model ini, command Docker berikutnya akan terasa masuk akal. Tanpa model ini, Docker hanya menjadi kumpulan mantra CLI.

---

## 32. Preview Part Berikutnya

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-002.md
```

Judul:

```text
Docker Architecture: Client, Daemon, Engine, containerd, runc
```

Kita akan membongkar apa yang terjadi di balik command Docker:

```bash
docker run ...
```

Fokusnya:

- Docker CLI vs Docker daemon
- Docker Engine
- containerd
- runc
- containerd-shim
- image pull lifecycle
- container create/start lifecycle
- failure mode saat daemon, runtime, registry, atau network bermasalah

---

## Status Seri

Selesai:

- Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
- Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary

Belum selesai:

- Part 002 sampai Part 031

Seri belum mencapai bagian terakhir.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — Orientation: Docker as Process Packaging, Not Mini VM</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-002.md">Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc ➡️</a>
</div>
