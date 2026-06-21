# learn-docker-mastery-for-java-engineers-part-020.md

# Part 020 — Performance and Resource Management: CPU, Memory, IO, Startup, Image Size

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `020`  
> Fokus: memahami performa container secara realistis: CPU, memory, IO, network, startup, image size, build/pull cache, dan implikasinya untuk JVM/Java service.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi berikut:

- container adalah proses yang diberi boundary, bukan VM kecil;
- image adalah artifact immutable berbasis layer;
- container lifecycle punya state, signal, exit code, health status;
- Dockerfile adalah definisi derivasi filesystem;
- BuildKit dan cache menentukan build speed dan reproducibility;
- Java di container perlu memahami memory, CPU quota, GC, signal;
- Compose membantu memodelkan sistem lokal;
- config/secrets/security/base image adalah bagian dari runtime contract.

Part ini masuk ke pertanyaan yang sering muncul di production:

> “Apakah Docker membuat aplikasi lebih lambat?”

Jawaban yang lebih benar:

> Docker biasanya bukan sumber overhead utama. Namun Docker membuat batas resource, filesystem, network, image distribution, startup, dan observability menjadi lebih eksplisit. Jika engineer salah membaca batas-batas itu, aplikasi bisa tampak lambat, unstable, atau boros resource.

Part ini akan membangun model performa yang bisa dipakai untuk:

- mendesain resource limit container;
- membaca `docker stats` dengan benar;
- membedakan Java heap, native memory, RSS, dan container memory;
- memahami CPU quota dan efeknya ke thread pool/GC;
- mengurangi build time dan pull time;
- mengecilkan image tanpa mengorbankan operability;
- mendiagnosis container yang lambat, OOMKilled, throttled, atau lama startup.

---

## 1. Mental Model: Docker Performance Bukan Satu Dimensi

Saat orang berkata “Docker performance”, biasanya mereka mencampur beberapa hal berbeda:

1. **runtime CPU performance**  
   Apakah proses dalam container mendapat CPU cukup?

2. **runtime memory behavior**  
   Apakah proses melewati memory limit? Apakah JVM salah sizing?

3. **IO performance**  
   Apakah aplikasi lambat karena filesystem layer, bind mount, volume, logging, atau disk host?

4. **network performance**  
   Apakah ada overhead NAT, bridge, DNS, port publishing, atau masalah bind address?

5. **startup performance**  
   Apakah container lambat start karena image pull, JVM warm-up, dependency readiness, migration, atau healthcheck?

6. **build performance**  
   Apakah build lambat karena cache invalidation, build context besar, dependency download, atau urutan Dockerfile buruk?

7. **distribution performance**  
   Apakah deployment lambat karena image terlalu besar, terlalu banyak layer, registry lambat, atau cache node kosong?

8. **developer workstation performance**  
   Apakah lambat karena Docker Desktop VM, bind mount macOS/Windows, antivirus, WSL2, atau volume strategy?

Top-tier engineer tidak bertanya “Docker lambat atau cepat?” Ia bertanya:

> “Di stage mana latency/resource cost muncul, boundary mana yang terlibat, metrik mana yang membuktikannya, dan knob mana yang benar untuk diperbaiki?”

---

## 2. Resource Constraint: Container Tidak Otomatis Punya Limit

Secara default, container bisa memakai resource sebanyak yang diizinkan scheduler kernel host. Docker menyediakan flag untuk membatasi memory dan CPU container melalui konfigurasi `docker run`.

Contoh:

```bash
# Batasi memory ke 512 MiB dan CPU sekitar setengah core
docker run --memory=512m --cpus=0.5 my-java-service:dev
```

Mental model penting:

```text
host capacity
  └── Docker daemon
       └── container process
            ├── CPU scheduling boundary
            ├── memory cgroup boundary
            ├── IO accounting/throttling boundary
            └── network namespace/path boundary
```

Docker tidak “memberi resource” seperti VM hypervisor penuh. Docker mengatur batas dan accounting terhadap proses yang tetap dijadwalkan oleh kernel host.

### 2.1 Limit vs Reservation

Dalam Docker standalone, yang paling sering dipakai adalah **limit**:

- `--memory`
- `--cpus`
- `--cpu-quota`
- `--cpu-period`
- `--cpu-shares`

Dalam orchestrator atau Compose deploy spec, ada konsep:

- **limit**: batas maksimum;
- **reservation**: resource minimum/ekspektasi scheduling.

Untuk Docker lokal/standalone, jangan menganggap `reservations` selalu enforcement kuat. Banyak detail bergantung pada platform/orchestrator.

Rule praktis:

> Untuk container lokal/standalone, pikirkan `limits` sebagai enforcement. Untuk scheduling multi-node, pikirkan `reservations` sebagai input placement. Jangan campur keduanya.

---

## 3. CPU: Quota, Shares, Period, dan Efek ke Java

CPU dalam container bukan “jumlah core fisik yang dimiliki container”. CPU adalah hak scheduling dalam periode waktu tertentu.

Docker menyediakan beberapa mekanisme:

| Mechanism | Contoh | Makna Praktis |
|---|---:|---|
| `--cpus` | `--cpus=1.5` | shorthand untuk quota CPU |
| `--cpu-quota` | `50000` | jatah runtime dalam satu period CFS |
| `--cpu-period` | `100000` | panjang periode CFS dalam microsecond |
| `--cpu-shares` | `512` | bobot relatif saat CPU contention |
| `--cpuset-cpus` | `0,2` | pin ke CPU tertentu |

Contoh:

```bash
# kira-kira 1 CPU
docker run --cpus=1 my-service

# kira-kira 0.5 CPU
docker run --cpus=0.5 my-service

# ekuivalen manual: 50ms quota per 100ms period
docker run --cpu-period=100000 --cpu-quota=50000 my-service
```

### 3.1 CPU Limit Bukan CPU Reservation

Jika kamu menjalankan:

```bash
docker run --cpus=2 my-service
```

Artinya container tidak boleh menggunakan lebih dari kira-kira 2 CPU worth of runtime. Bukan berarti container dijamin selalu mendapat 2 CPU, terutama bila host overload.

### 3.2 CPU Shares Bersifat Relatif

`--cpu-shares` tidak membatasi CPU saat host idle. Ia menentukan prioritas relatif saat ada contention.

Contoh mental model:

```text
container A: cpu-shares 1024
container B: cpu-shares 512
```

Saat CPU idle, keduanya bisa memakai CPU sebanyak mungkin. Saat contention, A mendapat bobot lebih besar daripada B.

Jangan pakai `cpu-shares` sebagai hard limit.

### 3.3 CPU Quota dan JVM

Java service sensitif terhadap CPU quota karena banyak keputusan runtime bergantung pada jumlah processor yang terlihat/efektif:

- GC thread count;
- JIT compiler thread;
- ForkJoinPool parallelism;
- Netty event loop;
- Tomcat/Jetty worker;
- scheduled executor;
- async executor;
- database connection pool pressure;
- Kafka/RabbitMQ consumer concurrency;
- reactive runtime parallelism.

Masalah umum:

```text
Container diberi --cpus=0.5
Aplikasi Java tetap membuat banyak worker thread
Thread sering runnable tetapi tidak mendapat CPU
Latency naik
GC pause memburuk
Healthcheck timeout
Engineer menyangka network/database lambat
```

### 3.4 CPU Throttling

Jika container terus mencoba memakai lebih banyak CPU daripada quota, kernel akan melakukan throttling.

Gejala:

- CPU % terlihat tinggi;
- latency p99 naik;
- request timeout saat traffic burst;
- GC butuh waktu lebih panjang;
- startup lebih lambat;
- healthcheck intermittently gagal;
- `docker stats` tidak selalu cukup untuk melihat throttling detail.

Untuk analisis lebih dalam di Linux host, biasanya perlu cgroup metric seperti:

```bash
# cgroup v2 path tergantung host/runtime
cat /sys/fs/cgroup/<container-cgroup>/cpu.stat
```

Cari field seperti:

```text
nr_periods
nr_throttled
throttled_usec
```

Interpretasi:

- `nr_throttled` tinggi = container sering terkena throttle;
- `throttled_usec` meningkat cepat = container kehilangan banyak waktu CPU.

### 3.5 Java Thread Pool Sizing di Container

Kesalahan klasik Java engineer:

```java
int threads = Runtime.getRuntime().availableProcessors() * 4;
```

Masalahnya bukan formula itu selalu salah, tetapi konteksnya sering salah:

- `availableProcessors()` bisa dipengaruhi container awareness;
- workload IO-bound vs CPU-bound berbeda;
- CPU quota 0.5 core tidak cocok untuk puluhan worker CPU-heavy;
- connection pool besar bisa memperbesar concurrency pressure tanpa throughput naik.

Rule praktis:

| Workload | CPU Limit | Thread Strategy |
|---|---:|---|
| CPU-bound | kecil | thread mendekati CPU efektif |
| IO-bound | kecil-menengah | thread lebih banyak boleh, tapi ukur queue dan timeout |
| blocking DB | terbatas DB pool | thread tidak boleh jauh lebih besar dari DB capacity |
| reactive/event-loop | kecil | jangan block event loop |
| batch heavy | besar | pisahkan dari API container bila mungkin |

### 3.6 CPU Checklist untuk Java Service

Gunakan checklist ini sebelum menyalahkan Docker:

```text
[ ] Berapa --cpus atau CPU quota container?
[ ] Berapa availableProcessors() yang dilihat JVM?
[ ] Berapa GC thread yang aktif?
[ ] Berapa worker thread aplikasi?
[ ] Apakah thread pool queue penuh?
[ ] Apakah p95/p99 naik bersamaan dengan CPU throttling?
[ ] Apakah healthcheck timeout saat traffic spike?
[ ] Apakah container menjalankan background job di API process yang sama?
[ ] Apakah host juga CPU saturated?
```

---

## 4. Memory: Limit Container, Heap JVM, Native Memory, dan OOMKilled

Memory adalah sumber incident Docker+Java paling umum.

Kesalahan mental model:

> “Container memory limit 512 MiB, jadi saya set heap 512 MiB.”

Itu salah.

Container memory limit harus menampung semua memory proses, bukan hanya Java heap.

```text
container memory limit
  ├── Java heap
  ├── metaspace
  ├── thread stacks
  ├── code cache
  ├── direct buffer / Netty buffer
  ├── memory mapped files
  ├── GC native structures
  ├── JVM internal/native memory
  ├── libc/native libraries
  ├── temporary process memory
  └── page cache/accounting nuance
```

### 4.1 Docker Memory Flags

Beberapa flag penting:

```bash
# Hard memory limit
docker run --memory=768m my-service

# Memory + swap behavior, tergantung host config
docker run --memory=768m --memory-swap=768m my-service

# Disable OOM killer untuk container biasanya berbahaya
docker run --oom-kill-disable my-service
```

Secara praktis:

- `--memory` adalah knob utama;
- `--memory-swap` harus dipahami hati-hati;
- mematikan OOM killer jarang benar untuk app container;
- memory limit terlalu ketat bisa menyebabkan kill tanpa Java sempat membuat heap dump.

### 4.2 Java OOM vs Container OOMKilled

Dua failure ini berbeda.

#### Java `OutOfMemoryError`

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
```

Ini muncul dari JVM. Proses Java masih bisa sempat:

- menulis log;
- membuat heap dump;
- menjalankan shutdown hook, tergantung kondisi;
- keluar dengan stacktrace.

#### Container `OOMKilled`

Container dibunuh oleh kernel karena melewati cgroup memory limit.

Gejala:

```bash
docker inspect my-service --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

Output:

```text
true 137
```

Exit 137 biasanya berarti proses menerima SIGKILL. Dalam konteks memory, ini sering OOMKilled.

Perbedaan penting:

| Aspek | Java OOM | Container OOMKilled |
|---|---|---|
| Yang mendeteksi | JVM | Kernel/cgroup |
| Log Java | biasanya ada | sering tidak ada |
| Heap dump | mungkin | sering tidak sempat |
| Exit code | bervariasi | sering 137 |
| Penyebab | heap/metaspace/direct/etc | total process memory melewati limit |

### 4.3 Heap Sizing: Jangan Pakai Semua Memory Limit

Untuk container kecil, heap aman biasanya jauh di bawah limit.

Contoh kasar:

```text
container limit: 512 MiB
heap max:        256-320 MiB
sisa:            metaspace, stack, direct buffer, native, OS accounting
```

Untuk Spring Boot/API service umum:

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:InitialRAMPercentage=20"
```

Atau eksplisit:

```bash
JAVA_TOOL_OPTIONS="-Xms256m -Xmx512m"
```

Pilihan percentage vs fixed:

| Strategy | Cocok Untuk | Risiko |
|---|---|---|
| Fixed `-Xmx` | predictable service | perlu beda sizing antar env |
| `MaxRAMPercentage` | image reusable multi-env | perlu validasi di setiap limit |
| tanpa config | simple dev | production unpredictable |

### 4.4 Thread Stack Memory

Setiap thread punya stack. Jika aplikasi membuat ratusan/ribuan thread, memory non-heap bisa signifikan.

Contoh kasar:

```text
500 threads * 1 MiB stack = 500 MiB virtual/committed behavior tergantung OS/JVM
```

Walau detail commit memory tidak sesederhana perkalian penuh, banyak thread tetap memperbesar risiko memory pressure.

Periksa:

```bash
jcmd <pid> Thread.print
jcmd <pid> VM.native_memory summary
```

`VM.native_memory` perlu JVM flag:

```bash
-XX:NativeMemoryTracking=summary
```

Jangan aktifkan detail tracking di semua production service tanpa mengukur overhead.

### 4.5 Direct Memory dan Netty

Banyak Java service modern memakai direct buffer:

- Netty;
- gRPC;
- Kafka client;
- database driver tertentu;
- compression/encryption;
- memory mapped file.

Heap terlihat aman, tetapi container tetap OOMKilled.

Gejala:

```text
Heap usage: 300 MiB dari 512 MiB
Container memory usage: 740 MiB dari 768 MiB
Lalu exit 137
```

Kemungkinan:

- direct memory;
- metaspace;
- thread stacks;
- native memory;
- mmap;
- page cache;
- side process/wrapper.

Knob yang mungkin relevan:

```bash
-XX:MaxDirectMemorySize=128m
```

Tapi jangan set sembarang. Untuk Netty/gRPC/high-throughput IO, direct memory terlalu kecil bisa menurunkan performa atau menyebabkan failure lain.

### 4.6 Memory Checklist untuk Java Container

```text
[ ] Berapa container memory limit?
[ ] Berapa -Xmx atau MaxRAMPercentage?
[ ] Apakah heap + non-heap muat dalam limit?
[ ] Berapa jumlah thread saat peak?
[ ] Apakah direct memory signifikan?
[ ] Apakah ada memory leak di native/direct buffer?
[ ] Apakah container exit 137?
[ ] Apakah .State.OOMKilled true?
[ ] Apakah host memory juga pressure?
[ ] Apakah log hilang sebelum crash?
[ ] Apakah heap dump path writable dan punya ruang?
```

---

## 5. `docker stats`: Berguna, Tapi Jangan Dibaca Secara Naif

`docker stats` menampilkan live stream runtime metrics seperti CPU, memory, memory limit, network IO, dan block IO.

Contoh:

```bash
docker stats
```

Output tipikal:

```text
CONTAINER ID   NAME       CPU %   MEM USAGE / LIMIT   MEM %   NET I/O       BLOCK I/O
abc123         api        78.4%   420MiB / 768MiB     54.7%   20MB / 15MB   100MB / 2MB
```

### 5.1 Apa yang Bisa Dibaca

| Kolom | Membantu Untuk |
|---|---|
| CPU % | indikasi CPU usage relatif |
| MEM USAGE / LIMIT | container memory consumption vs limit |
| MEM % | tekanan memory relatif |
| NET I/O | traffic masuk/keluar container |
| BLOCK I/O | read/write ke block device |

### 5.2 Apa yang Tidak Cukup dari `docker stats`

`docker stats` tidak otomatis menjawab:

- apakah CPU sedang throttled;
- apakah memory adalah heap atau native;
- apakah IO lambat karena disk host;
- apakah GC pause tinggi;
- apakah latency naik karena lock contention;
- apakah request queue penuh;
- apakah registry pull lambat;
- apakah bind mount di Docker Desktop bottleneck.

Gunakan `docker stats` sebagai pintu masuk, bukan final diagnosis.

### 5.3 Membaca CPU %

CPU % bisa membingungkan karena tergantung jumlah CPU host dan quota.

Jika host punya 8 CPU, CPU % bisa terlihat lebih dari 100% untuk container yang memakai lebih dari satu CPU, tergantung format/reporting.

Pertanyaan yang lebih penting:

```text
Apakah container mendekati limit CPU efektifnya?
Apakah p99 latency naik saat CPU naik?
Apakah throttling meningkat?
```

### 5.4 Membaca Memory

Jika:

```text
MEM USAGE / LIMIT = 730MiB / 768MiB
```

Itu sudah zona bahaya untuk Java service, karena spike kecil di native memory, allocation burst, TLS, compression, atau GC overhead bisa mendorong OOMKilled.

Rule praktis:

```text
Untuk Java API service, jangan desain steady-state memory di atas 70-80% container limit kecuali sudah punya alasan dan metrik kuat.
```

---

## 6. IO Performance: Filesystem Layer, Volumes, Bind Mount, Logging

Container filesystem punya beberapa path dengan karakteristik berbeda:

```text
image read-only layers
container writable layer
named volume
bind mount
 tmpfs
```

### 6.1 Writable Layer Bukan Tempat Ideal untuk State Berat

Container writable layer cocok untuk:

- file kecil sementara;
- perubahan ephemeral;
- debug singkat.

Tidak ideal untuk:

- database data;
- log besar;
- upload file permanen;
- cache besar;
- generated report permanen;
- artifact bisnis.

Kenapa?

- lifecycle ikut container;
- copy-on-write overhead bisa muncul;
- backup tidak natural;
- sulit dipindahkan;
- mudah hilang saat container recreate;
- membuat disk host penuh tanpa disadari.

### 6.2 Named Volume vs Bind Mount

| Aspek | Named Volume | Bind Mount |
|---|---|---|
| Managed by Docker | ya | tidak sepenuhnya |
| Portable antar host | lebih mudah secara Docker | tergantung path host |
| Cocok untuk DB local | ya | bisa, tapi rawan permission/path |
| Cocok untuk live code mount | kurang | ya |
| Docker Desktop performance | biasanya lebih baik | bisa lambat pada macOS/Windows |
| Permission predictability | relatif lebih baik | sering bermasalah UID/GID |

### 6.3 Bind Mount di Docker Desktop

Pada macOS/Windows, Docker Desktop biasanya menjalankan Linux VM. Bind mount dari host ke VM/container bisa lebih lambat daripada native Linux filesystem.

Gejala:

- Maven/Gradle build dalam bind mount lambat;
- file watcher lambat atau noisy;
- hot reload lambat;
- node_modules/target/build dir memperburuk IO;
- test suite lebih lambat di container daripada host.

Strategi:

```yaml
services:
  app:
    volumes:
      - .:/workspace
      - maven-cache:/root/.m2
      - gradle-cache:/home/gradle/.gradle
      - target-cache:/workspace/target

volumes:
  maven-cache:
  gradle-cache:
  target-cache:
```

Untuk Java, sering lebih baik:

- source code bind-mounted;
- dependency cache named volume;
- build output named volume atau container-local;
- production image tidak bergantung pada bind mount.

### 6.4 Logging IO

Container best practice umum: aplikasi menulis log ke stdout/stderr.

Tapi stdout/stderr tetap punya cost:

```text
application logger
  -> stdout/stderr
  -> Docker logging driver
  -> host disk / logging backend
```

Masalah umum:

- log terlalu verbose;
- synchronous logging bottleneck;
- JSON log terlalu besar;
- exception stacktrace banjir;
- Docker json-file log tidak dirotate;
- disk host penuh;
- container lambat karena log driver blocking.

Checklist logging performance:

```text
[ ] Apakah log level production tepat?
[ ] Apakah access log terlalu verbose?
[ ] Apakah Docker log rotation dikonfigurasi?
[ ] Apakah async logging dipakai dengan backpressure yang benar?
[ ] Apakah payload besar ikut dilog?
[ ] Apakah exception berulang tidak dirate-limit?
```

Contoh daemon log rotation:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5"
  }
}
```

### 6.5 tmpfs untuk Ephemeral Sensitive/High-Churn Files

`tmpfs` menyimpan file di memory, bukan disk host.

Cocok untuk:

- file temporary sensitif;
- scratch kecil;
- high-churn temp file;
- menghindari write ke disk untuk data ephemeral.

Contoh:

```bash
docker run --tmpfs /tmp:rw,noexec,nosuid,size=128m my-service
```

Trade-off:

- memakai memory container/host;
- bisa memicu memory pressure;
- hilang saat container stop;
- harus sizing hati-hati.

Untuk Java:

```bash
JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/tmp"
```

Pastikan `/tmp` writable untuk user non-root.

---

## 7. Network Performance: Biasanya Bukan Bottleneck, Tapi Bisa Menipu

Docker network path bisa melibatkan:

- bridge network;
- veth pair;
- iptables/nftables NAT;
- userland proxy pada konfigurasi tertentu;
- embedded DNS;
- port publishing;
- host firewall;
- Docker Desktop VM network.

Untuk sebagian besar Java API service, overhead Docker network bukan bottleneck utama dibanding:

- database query;
- remote service latency;
- TLS;
- serialization;
- GC;
- thread pool saturation;
- connection pool starvation.

Tapi Docker network sering menyebabkan **misdiagnosis**.

### 7.1 Common Misdiagnosis

#### Case 1 — App bind ke localhost di container

```text
App listen: 127.0.0.1:8080 inside container
Docker publish: -p 8080:8080
Host request: connection refused
```

Fix:

```properties
server.address=0.0.0.0
server.port=8080
```

#### Case 2 — Container pakai `localhost` untuk service lain

Dalam container, `localhost` berarti container itu sendiri.

Salah:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
```

Benar di Compose:

```properties
spring.datasource.url=jdbc:postgresql://postgres:5432/app
```

#### Case 3 — DNS/connection reuse

Aplikasi Java bisa cache DNS lebih lama dari yang diharapkan, tergantung JVM/security config dan resolver behavior.

Jika container dependency diganti tetapi aplikasi masih memakai address lama, periksa:

- JVM DNS cache TTL;
- connection pool stale connection;
- service discovery model;
- Compose recreate behavior.

### 7.2 Network Metrics

`docker stats` memberi `NET I/O`, tetapi bukan latency.

Untuk diagnosis latency, gabungkan:

- application metrics;
- client-side timeout;
- server-side access log;
- TCP connection state;
- DNS lookup time;
- database/broker metrics;
- packet capture bila perlu.

Rule:

> Jangan menyimpulkan “Docker network lambat” hanya dari request timeout. Timeout lebih sering berasal dari thread pool, dependency, DNS, TLS, pool starvation, atau CPU throttling.

---

## 8. Startup Performance: Container Start ≠ Application Ready

Container startup terdiri dari beberapa fase:

```text
image pull
  -> container create
  -> process start
  -> JVM bootstrap
  -> framework bootstrap
  -> config load
  -> dependency connect
  -> migration/init
  -> warm-up/JIT/cache
  -> readiness healthy
```

`docker start` hanya memastikan proses utama dimulai. Bukan berarti aplikasi siap menerima traffic.

### 8.1 Pull Time

Pull time dipengaruhi oleh:

- image size;
- jumlah layer;
- registry latency;
- concurrent downloads;
- cache node;
- network bandwidth;
- decompression speed;
- platform mismatch;
- base image reuse.

Docker daemon secara default melakukan pull beberapa layer secara paralel. Pada koneksi lambat, concurrency bisa menyebabkan timeout atau pressure.

### 8.2 JVM Startup

Faktor Java startup:

- ukuran classpath;
- framework scanning;
- dependency injection graph;
- reflection;
- config binding;
- TLS keystore load;
- database migration;
- lazy vs eager initialization;
- container CPU quota;
- entropy/random source pada kasus tertentu;
- JIT warm-up.

Container dengan CPU 0.25 core bisa membuat startup Spring Boot jauh lebih lambat dibanding laptop dev.

### 8.3 Startup vs Readiness

Jangan pakai “process running” sebagai readiness.

Compose example:

```yaml
services:
  app:
    image: my-service:dev
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health/readiness"]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 30s
```

Healthcheck juga punya cost. Jangan membuat healthcheck terlalu sering atau terlalu berat.

### 8.4 Startup Optimization Strategy

Urutan optimasi yang sehat:

1. Pisahkan image pull time dari app boot time.
2. Ukur JVM/framework startup time.
3. Ukur dependency readiness time.
4. Kurangi image size jika pull dominan.
5. Kurangi classpath/scanning jika JVM dominan.
6. Hindari migration berat di startup API container jika mengganggu rollout.
7. Sesuaikan CPU limit untuk startup burst bila platform mendukung.
8. Gunakan readiness, bukan sleep.

Anti-pattern:

```yaml
command: sh -c "sleep 30 && java -jar app.jar"
```

Sleep bukan readiness. Sleep hanya menunda failure.

---

## 9. Image Size: Kecil Itu Bagus, Tapi Bukan Tujuan Tunggal

Image size memengaruhi:

- build output storage;
- registry storage;
- push time;
- pull time;
- deployment rollout speed;
- cache efficiency;
- vulnerability surface;
- developer feedback loop;
- cold-start node provisioning.

Namun image terlalu minimal bisa mengurangi:

- debuggability;
- compatibility;
- certificate/timezone completeness;
- operational tooling;
- incident response speed.

### 9.1 Image Size Sources untuk Java

Komponen umum image Java:

```text
base OS layer
JRE/JDK layer
CA certificates
timezone data
application JAR
dependencies
native libraries
shell/debug tools
package manager metadata
build artifacts accidentally copied
source/test files accidentally copied
```

### 9.2 Fat JAR vs Exploded/Layered JAR

Fat JAR sederhana:

```dockerfile
COPY target/app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Kelebihan:

- mudah;
- portable;
- familiar.

Kekurangan:

- perubahan kecil app bisa membuat seluruh JAR layer berubah;
- dependency layer tidak reusable;
- pull/push incremental kurang efisien.

Layered JAR/exploded layout:

```text
/app/dependencies/
/app/spring-boot-loader/
/app/snapshot-dependencies/
/app/application/
```

Kelebihan:

- dependency jar jarang berubah;
- application class layer kecil;
- better cache reuse;
- faster incremental push/pull.

Kekurangan:

- Dockerfile lebih kompleks;
- perlu memahami framework packaging;
- debugging classpath bisa sedikit berbeda.

### 9.3 Multi-Stage Build untuk Size

Pattern umum:

```dockerfile
# syntax=docker/dockerfile:1

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/app.jar /app/app.jar
USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Tujuan:

- build tool tidak masuk runtime image;
- source tidak masuk runtime image;
- test artifacts tidak masuk runtime image;
- image runtime lebih kecil dan aman.

### 9.4 Image Size Anti-Pattern

```dockerfile
FROM eclipse-temurin:21-jdk
WORKDIR /app
COPY . .
RUN ./mvnw package
CMD ["java", "-jar", "target/app.jar"]
```

Masalah:

- source masuk image;
- Maven cache mungkin masuk image;
- JDK masuk runtime padahal mungkin hanya butuh JRE;
- test files masuk;
- `.git` bisa ikut jika `.dockerignore` buruk;
- cache invalidation besar;
- attack surface lebih luas;
- image besar.

### 9.5 Size vs Operability Decision

| Strategy | Size | Security Surface | Debuggability | Cocok Untuk |
|---|---:|---:|---:|---|
| Full JDK OS image | besar | besar | tinggi | dev/debug |
| JRE slim | sedang | sedang | sedang | banyak production service |
| Alpine | kecil | sedang | sedang | bila compatible musl/native libs |
| Distroless | kecil | kecil | rendah | hardened prod dengan debug strategy |
| Custom jlink | kecil-sedang | kecil-sedang | sedang-rendah | service stabil dengan module analysis |

Rule:

> Jangan mengecilkan image sampai tim kehilangan kemampuan diagnosis incident. Minimal image harus disertai debug playbook.

---

## 10. Build Performance: Cache, Context, Dependency Download

Build lambat sering bukan karena Docker lambat, tapi karena Dockerfile membuat cache tidak berguna.

### 10.1 Build Context Besar

Saat build, Docker perlu mengirim build context. Jika context berisi:

- `.git`;
- `target/`;
- `build/`;
- `node_modules/`;
- logs;
- dumps;
- local database files;
- IDE metadata;

build menjadi lambat dan cache invalidation mudah terjadi.

Gunakan `.dockerignore`:

```dockerignore
.git
.idea
.vscode
*.log
target
build
.gradle
.mvn/wrapper/maven-wrapper.jar
node_modules
coverage
*.hprof
*.jfr
.env
.env.*
```

Hati-hati: jangan ignore file yang dibutuhkan build.

### 10.2 Dockerfile Ordering untuk Maven

Buruk:

```dockerfile
COPY . .
RUN mvn package
```

Setiap perubahan source invalidasi dependency download.

Lebih baik:

```dockerfile
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN ./mvnw -B dependency:go-offline

COPY src ./src
RUN ./mvnw -B package
```

Lebih baik lagi dengan BuildKit cache mount:

```dockerfile
# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B package
```

### 10.3 Gradle Cache

```dockerfile
# syntax=docker/dockerfile:1
FROM gradle:8-jdk21 AS build
WORKDIR /src
COPY settings.gradle* build.gradle* gradle.properties* ./
COPY gradle ./gradle
RUN --mount=type=cache,target=/home/gradle/.gradle gradle dependencies --no-daemon
COPY src ./src
RUN --mount=type=cache,target=/home/gradle/.gradle gradle build --no-daemon
```

### 10.4 External Build Cache di CI

CI runner ephemeral sering tidak punya cache lokal.

Solusi:

- registry cache;
- GitHub Actions cache backend;
- local cache persisted by runner;
- dependency proxy;
- private Maven/Gradle repository mirror;
- remote BuildKit builder.

Contoh Buildx cache registry:

```bash
docker buildx build \
  --cache-from=type=registry,ref=registry.example.com/app/build-cache \
  --cache-to=type=registry,ref=registry.example.com/app/build-cache,mode=max \
  -t registry.example.com/app:${GIT_SHA} \
  --push .
```

Caution:

> Build cache adalah performance tool, bukan trust boundary. Jangan menaruh secret dalam layer/cache. Gunakan BuildKit secret mount.

---

## 11. Distribution Performance: Push, Pull, Registry, Layer Reuse

Deployment tidak hanya menjalankan container. Deployment sering perlu:

```text
build image
push image
node pull image
unpack layers
create container
start process
wait readiness
```

### 11.1 Layer Reuse

Jika semua service memakai base image sama:

```text
eclipse-temurin:21-jre
```

Node hanya perlu pull base layer sekali. Service berikutnya bisa reuse layer.

Jika tiap team memakai base image berbeda:

```text
ubuntu + manual java
alpine + jre
custom debian
random vendor image
```

Layer reuse buruk, cache node fragmented, cold rollout lambat.

### 11.2 Tag Strategy dan Pull Performance

Mutable tag bisa menipu:

```bash
docker pull my-service:latest
```

Jika tag berubah, Docker perlu resolve manifest dan mungkin pull layer baru.

Production lebih baik menggunakan digest:

```bash
docker pull my-service@sha256:...
```

Untuk performance, digest membantu reproducibility, bukan otomatis lebih cepat. Kecepatan tetap bergantung pada layer cache.

### 11.3 Registry Bottleneck

Gejala registry bottleneck:

- CI push lambat;
- rollout lambat di banyak node;
- pull timeout;
- rate limit;
- image pull backoff;
- inconsistent pull across regions.

Mitigasi:

- private registry dekat cluster/VM;
- registry mirror;
- pre-pull image;
- reduce image size;
- base image standardization;
- avoid rebuilding unchanged layers;
- avoid environment-specific images.

---

## 12. Docker Desktop Performance: Jangan Samakan dengan Linux Production

Docker Desktop memberi convenience, tapi ada VM boundary.

Pada macOS/Windows:

```text
host OS
  -> Docker Desktop VM / WSL2
      -> Linux kernel
          -> container process
```

Implikasi:

- bind mount bisa lambat;
- file watching bisa berbeda;
- network path berbeda;
- memory/CPU limit Desktop memengaruhi semua container;
- Resource Saver bisa membuat cold start lebih lambat setelah idle;
- disk image Docker Desktop bisa penuh.

### 12.1 Checklist Docker Desktop Lambat

```text
[ ] Apakah source code di-bind mount dari host?
[ ] Apakah build output/dependency cache ikut bind mount?
[ ] Apakah Docker Desktop memory terlalu kecil?
[ ] Apakah CPU allocation terlalu kecil?
[ ] Apakah Resource Saver membuat VM cold start?
[ ] Apakah antivirus/indexer memindai project dir?
[ ] Apakah file watcher framework terlalu agresif?
[ ] Apakah logs terlalu besar?
[ ] Apakah volume lama membuat DB startup lambat?
```

### 12.2 Dev Strategy untuk Java

Untuk local dev:

- jalankan dependency infra di Compose;
- jalankan app Java di host bila hot reload/debug lebih nyaman;
- atau jalankan app di container dengan volume strategy yang benar;
- gunakan named volume untuk Maven/Gradle cache;
- hindari build besar di bind-mounted slow filesystem;
- siapkan reset command yang jelas.

Tidak semua harus berjalan dalam container saat development. Yang penting adalah environment contract reproducible.

---

## 13. Resource Limit Design untuk Java Service

Resource limit tidak boleh ditebak dari feeling. Ia harus datang dari workload model dan measurement.

### 13.1 Langkah Desain

1. Klasifikasikan service:
   - API latency-sensitive;
   - worker/batch;
   - stream consumer;
   - scheduled job;
   - gateway/proxy;
   - admin/internal tool.

2. Tentukan critical resource:
   - CPU-bound;
   - memory-bound;
   - IO-bound;
   - network-bound;
   - dependency-bound.

3. Ukur baseline:
   - idle memory;
   - steady traffic memory;
   - peak memory;
   - CPU at p50/p95 load;
   - startup time;
   - GC behavior;
   - thread count;
   - direct memory.

4. Tambahkan headroom:
   - traffic burst;
   - GC overhead;
   - TLS/compression spike;
   - logging spike;
   - temporary allocation;
   - migration/initialization.

5. Tentukan limit:
   - memory limit;
   - CPU limit;
   - JVM heap config;
   - direct memory config bila perlu;
   - thread/concurrency limits.

6. Validasi dengan load test.

### 13.2 Contoh Sizing Awal API Service

Misal:

```text
Spring Boot API
Traffic: moderate
DB-bound
Container memory target: 1 GiB
CPU target: 1 core
```

Awal config:

```bash
docker run \
  --memory=1g \
  --cpus=1 \
  -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:InitialRAMPercentage=20" \
  my-service:sha
```

Aplikasi config:

```properties
server.tomcat.threads.max=100
spring.datasource.hikari.maximum-pool-size=20
management.endpoint.health.probes.enabled=true
```

Validasi:

```text
[ ] p95/p99 stabil?
[ ] GC pause acceptable?
[ ] memory steady-state < 700-800 MiB?
[ ] OOMKilled false?
[ ] CPU throttling acceptable?
[ ] DB pool tidak exhausted?
[ ] healthcheck tidak false negative saat load?
```

### 13.3 Contoh Worker CPU-Bound

```bash
docker run \
  --memory=2g \
  --cpus=2 \
  -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70" \
  my-worker:sha
```

Worker config:

```properties
worker.parallelism=2
```

Jika parallelism 32 pada CPU 2, throughput belum tentu naik. Bisa malah:

- context switching naik;
- GC pressure naik;
- latency per job naik;
- queue time naik;
- downstream overwhelmed.

### 13.4 Contoh Consumer Kafka/RabbitMQ

Karena seri messaging sudah terpisah, di sini fokus Docker resource:

```text
consumer concurrency harus cocok dengan CPU, memory, dan downstream capacity
```

Jika container limit kecil tapi concurrency besar:

- message processing timeout;
- heartbeat missed;
- rebalance;
- duplicate processing;
- memory pressure;
- poison message memperparah backlog.

Resource sizing consumer harus mempertimbangkan:

- max in-flight messages;
- payload size;
- deserialization memory;
- DB/API call concurrency;
- retry buffer;
- DLQ behavior;
- graceful shutdown time.

---

## 14. Observability: Apa yang Harus Diukur

Docker-level metrics saja tidak cukup. Gabungkan beberapa layer:

```text
host metrics
  + container metrics
  + JVM metrics
  + application metrics
  + dependency metrics
  + business throughput metrics
```

### 14.1 Container Metrics

- CPU usage;
- CPU throttling;
- memory usage;
- memory limit;
- OOMKilled count;
- restart count;
- network IO;
- block IO;
- container start time;
- image pull time bila tersedia.

### 14.2 JVM Metrics

- heap used/committed/max;
- non-heap/metaspace;
- direct buffer;
- thread count;
- GC count/time/pause;
- allocation rate;
- safepoint time;
- class loaded;
- JIT/compiler if needed.

### 14.3 App Metrics

- request rate;
- latency p50/p95/p99;
- error rate;
- queue depth;
- pool usage;
- active requests;
- timeout count;
- retry count;
- circuit breaker state;
- health status.

### 14.4 Correlation Pattern

Contoh correlation:

```text
p99 latency naik
  -> CPU usage tinggi
  -> throttled_usec naik
  -> GC pause juga naik
  -> thread pool queue naik
  -> healthcheck timeout
```

Kesimpulan mungkin:

```text
CPU quota terlalu rendah untuk concurrency saat ini, bukan Docker network lambat.
```

Contoh lain:

```text
container memory naik
  -> heap stabil
  -> direct buffer naik
  -> Netty/gRPC traffic naik
  -> exit 137
```

Kesimpulan mungkin:

```text
OOMKilled disebabkan native/direct memory, bukan Java heap leak klasik.
```

---

## 15. Failure Mode Catalogue: Performance Edition

### 15.1 Container Exit 137 Saat Traffic Spike

Kemungkinan:

- container OOMKilled;
- heap terlalu besar;
- direct/native memory spike;
- terlalu banyak threads;
- logging buffer besar;
- payload besar;
- memory leak;
- host memory pressure.

Diagnosis:

```bash
docker inspect <container> --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
docker stats <container>
docker logs --tail=200 <container>
```

JVM-side:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print
```

### 15.2 Latency Naik Tapi CPU Container Tidak 100%

Kemungkinan:

- CPU throttling meskipun average CPU tampak tidak penuh;
- thread pool blocked;
- DB pool exhausted;
- IO wait;
- lock contention;
- GC pause;
- downstream timeout;
- logging blocking;
- DNS/TLS issue.

Jangan hanya melihat average CPU.

### 15.3 Build Lambat Setelah Perubahan Kecil

Kemungkinan:

- `COPY . .` terlalu awal;
- `.dockerignore` buruk;
- dependency cache invalidated;
- build context besar;
- BuildKit cache tidak digunakan;
- CI runner ephemeral tanpa external cache;
- Maven/Gradle selalu download dependency.

### 15.4 Deployment Lambat

Kemungkinan:

- image besar;
- base image tidak shared;
- registry jauh/lambat;
- node cache kosong;
- terlalu banyak environment-specific image;
- multi-arch emulation build lambat;
- healthcheck start period terlalu panjang;
- app migration di startup.

### 15.5 Local Dev Sangat Lambat

Kemungkinan:

- bind mount macOS/Windows;
- Maven/Gradle cache di bind mount;
- Docker Desktop memory kecil;
- file watcher banyak;
- antivirus/indexer;
- volume DB membesar;
- logging terlalu verbose.

---

## 16. Practical Commands

### 16.1 Melihat Live Resource

```bash
docker stats

docker stats my-service

docker compose stats
```

### 16.2 Inspect Resource Config

```bash
docker inspect my-service --format '{{json .HostConfig.Memory}}'
docker inspect my-service --format '{{json .HostConfig.NanoCpus}}'
docker inspect my-service --format '{{json .HostConfig.CpuQuota}} {{json .HostConfig.CpuPeriod}}'
```

### 16.3 Cek OOMKilled

```bash
docker inspect my-service --format 'OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}} Error={{.State.Error}}'
```

### 16.4 Cek Restart Count

```bash
docker inspect my-service --format 'RestartCount={{.RestartCount}}'
```

### 16.5 Cek Image Size dan Layers

```bash
docker image ls

docker image inspect my-service:dev --format '{{.Size}}'

docker history my-service:dev
```

### 16.6 Cek Disk Usage Docker

```bash
docker system df

docker system df -v
```

### 16.7 Bersih-Bersih Hati-Hati

```bash
# remove stopped containers, unused networks, dangling images, build cache tertentu
docker system prune

# termasuk unused images, lebih agresif
docker system prune -a

# volume prune bisa menghapus data DB local
docker volume prune
```

Jangan jalankan prune agresif di environment yang datanya belum dipahami.

---

## 17. Compose Resource Example untuk Java

Compose file untuk local performance experiment:

```yaml
services:
  api:
    image: my-java-api:dev
    ports:
      - "8080:8080"
    environment:
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=60
        -XX:InitialRAMPercentage=20
        -XX:+ExitOnOutOfMemoryError
      SPRING_PROFILES_ACTIVE: docker
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1g
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/actuator/health/readiness"]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 30s
```

Catatan penting:

- behavior `deploy.resources` pada Docker Compose non-Swarm pernah punya perbedaan historis; validasi di versi Compose yang dipakai;
- untuk eksperimen lokal, `docker run --memory --cpus` lebih langsung;
- di orchestrator production, limit/reservation biasanya dikelola oleh platform deployment.

Alternatif Compose syntax yang sering dipakai di local Docker Compose:

```yaml
services:
  api:
    image: my-java-api:dev
    mem_limit: 1g
    cpus: 1.0
```

Selalu cek hasil aktual:

```bash
docker inspect <container> | jq '.[0].HostConfig | {Memory, NanoCpus, CpuQuota, CpuPeriod}'
```

---

## 18. Load Testing Container dengan Benar

Load test yang buruk bisa menghasilkan kesimpulan salah.

### 18.1 Pisahkan Variabel

Jangan ubah semua sekaligus:

```text
image baru + config baru + CPU limit baru + DB baru + test data baru
```

Ubah satu dimensi:

- CPU limit;
- memory limit;
- heap percentage;
- thread pool;
- image layout;
- base image;
- logging mode;
- volume strategy.

### 18.2 Ukur Warm-up

Java punya warm-up:

- class loading;
- JIT compilation;
- connection pool initialization;
- cache fill;
- branch/profile optimization.

Jangan membandingkan cold p99 dengan warm p99 tanpa konteks.

### 18.3 Ukur Failure, Bukan Hanya Throughput

Top-tier performance test melihat:

- error rate;
- timeout;
- retry;
- p99;
- queue depth;
- GC pause;
- CPU throttling;
- memory headroom;
- restart/OOMKilled;
- readiness flapping;
- downstream saturation.

Throughput tinggi dengan p99 buruk mungkin bukan sukses.

---

## 19. Design Rules of Thumb

### 19.1 CPU

```text
CPU-bound workload: jangan over-thread jauh di atas CPU efektif.
IO-bound workload: boleh concurrency lebih tinggi, tapi batasi dengan pool/backpressure.
Latency-sensitive API: pantau throttling, bukan hanya CPU average.
Worker/batch: pisahkan resource profile dari API.
```

### 19.2 Memory

```text
Container limit harus lebih besar dari JVM heap.
Sisakan headroom untuk non-heap/native/direct/thread stack.
Exit 137 + OOMKilled true bukan Java heap OOM biasa.
Jangan set -Xmx sama dengan container limit.
```

### 19.3 IO

```text
State penting jangan di writable layer.
DB local pakai named volume.
Bind mount bagus untuk source, buruk untuk heavy generated files di Docker Desktop.
Log rotation wajib.
```

### 19.4 Image

```text
Kecilkan image dengan multi-stage dan .dockerignore.
Jangan korbankan debuggability tanpa debug plan.
Gunakan base image standar antar service untuk layer reuse.
Promosikan digest yang sama antar environment.
```

### 19.5 Build

```text
Urutkan Dockerfile dari dependency jarang berubah ke source sering berubah.
Gunakan BuildKit cache mount untuk Maven/Gradle.
Gunakan external cache di CI ephemeral.
Jangan taruh secret di ARG/COPY/layer.
```

---

## 20. Anti-Pattern yang Harus Dihindari

### Anti-Pattern 1 — Heap Sama dengan Container Limit

```bash
docker run --memory=512m -e JAVA_TOOL_OPTIONS="-Xmx512m" my-service
```

Masalah:

- non-heap tidak punya ruang;
- direct memory/thread stack bisa mendorong OOMKilled;
- crash sering tanpa log jelas.

Lebih aman:

```bash
docker run --memory=512m -e JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60" my-service
```

### Anti-Pattern 2 — Thread Pool Besar di CPU Kecil

```properties
server.tomcat.threads.max=500
```

Dengan:

```bash
--cpus=0.5
```

Masalah:

- context switching;
- queueing;
- timeout;
- GC pressure;
- downstream overload.

### Anti-Pattern 3 — Image Production Berisi Build Tool

```dockerfile
FROM maven:3.9-eclipse-temurin-21
COPY . .
RUN mvn package
CMD ["java", "-jar", "target/app.jar"]
```

Masalah:

- besar;
- lambat pull;
- attack surface luas;
- source masuk image;
- build cache buruk.

### Anti-Pattern 4 — Semua Data di Container Writable Layer

```text
/app/uploads
/app/logs
/app/cache
```

Masalah:

- hilang saat recreate;
- disk host penuh;
- backup sulit;
- performance tidak predictable.

### Anti-Pattern 5 — Sleep untuk Readiness

```yaml
command: sh -c "sleep 60 && java -jar app.jar"
```

Masalah:

- dependency bisa ready lebih cepat atau lebih lambat;
- failure disembunyikan;
- rollout lambat;
- debugging buruk.

---

## 21. Worked Example: Diagnosing Slow Java Container

### 21.1 Gejala

```text
Spring Boot API container
Memory limit: 768 MiB
CPU limit: 0.5
p99 latency naik dari 300ms ke 5s saat traffic sedang
Kadang healthcheck gagal
Tidak ada error database jelas
```

### 21.2 Data Awal

```bash
docker stats api
```

```text
CPU %: 95-110%
MEM: 610MiB / 768MiB
NET I/O: normal
BLOCK I/O: low
```

Inspect:

```bash
docker inspect api --format 'OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}}'
```

```text
OOMKilled=false ExitCode=0
```

JVM metrics:

```text
heap used: 360 MiB
threads: 220
GC pause p99: 250ms
Tomcat busy threads: high
DB pool active: maxed at 30
```

### 21.3 Reasoning

Bukan OOMKilled. Memory cukup tinggi tapi belum crash. CPU tampak sangat tinggi terhadap quota. Thread banyak. DB pool maxed. GC pause meningkat.

Kemungkinan causal chain:

```text
CPU limit 0.5 terlalu kecil
  -> request processing lambat
  -> Tomcat threads menumpuk
  -> DB connection ditahan lebih lama
  -> pool penuh
  -> request queue naik
  -> allocation lifetime berubah
  -> GC pause naik
  -> healthcheck timeout
```

### 21.4 Eksperimen

Eksperimen A:

```bash
--cpus=1.0
```

Eksperimen B:

```properties
server.tomcat.threads.max=80
spring.datasource.hikari.maximum-pool-size=15
```

Eksperimen C:

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=55"
```

### 21.5 Fix Kemungkinan

- Naikkan CPU limit untuk API container;
- turunkan thread pool agar sesuai CPU/downstream;
- pisahkan background job;
- set readiness timeout realistis;
- pantau CPU throttling;
- set memory headroom lebih aman.

Kesimpulan:

> Masalah bukan “Docker lambat”, tetapi resource contract container tidak cocok dengan concurrency model aplikasi Java.

---

## 22. Worked Example: Image Pull Membuat Rollout Lambat

### 22.1 Gejala

```text
Deployment ke VM baru butuh 6 menit sebelum app mulai boot.
App boot sendiri hanya 25 detik.
```

### 22.2 Data

```bash
docker image ls
```

```text
my-service   latest   1.8GB
```

```bash
docker history my-service:latest
```

Menunjukkan:

```text
COPY . .                 besar
RUN mvn package          besar
Maven repo masuk image   besar
JDK runtime              besar
```

### 22.3 Root Cause

- runtime image berisi build tools;
- `.m2` masuk layer;
- source/test masuk image;
- dependency dan app tidak dilayer dengan baik;
- base image tidak shared dengan service lain.

### 22.4 Fix

- multi-stage build;
- `.dockerignore`;
- JRE/slim runtime;
- layered JAR;
- standardisasi base image;
- promote same digest;
- pre-pull image jika perlu.

Target hasil:

```text
1.8GB -> 250-450MB tergantung base/runtime/debug needs
```

Bukan sekadar angka kecil; yang penting rollout cold node membaik dan operability tetap aman.

---

## 23. Production Checklist

Sebelum Java Docker service dianggap production-ready dari sisi performance/resource:

```text
[ ] Container memory limit ditentukan dari measurement, bukan default.
[ ] JVM heap tidak menghabiskan seluruh container limit.
[ ] Non-heap/native/direct memory dipertimbangkan.
[ ] CPU limit sesuai concurrency model.
[ ] CPU throttling dipantau.
[ ] Thread pool dan connection pool disesuaikan dengan resource.
[ ] Healthcheck timeout realistis di bawah load.
[ ] Startup time dipisah antara pull time dan app readiness.
[ ] Image memakai multi-stage build.
[ ] Build context kecil dan .dockerignore benar.
[ ] Maven/Gradle cache tidak masuk runtime image.
[ ] Image size dievaluasi terhadap rollout dan debuggability.
[ ] Base image distandardisasi antar service bila mungkin.
[ ] Log rotation aktif.
[ ] State berat tidak ditulis ke container writable layer.
[ ] Volume/bind mount strategy jelas.
[ ] docker stats/container metrics dikorelasikan dengan JVM/app metrics.
[ ] Exit 137/OOMKilled punya runbook.
[ ] Load test mencakup p95/p99, error, GC, CPU, memory, restart.
```

---

## 24. Ringkasan Mental Model

Docker performance harus dipahami sebagai kontrak antara aplikasi dan host:

```text
Java service
  -> JVM ergonomics
  -> container resource limits
  -> cgroup accounting
  -> host scheduler/storage/network
  -> image/build/distribution pipeline
```

Yang paling penting:

1. Docker tidak otomatis membuat aplikasi lambat.
2. Docker membuat resource boundary eksplisit.
3. Java heap hanyalah sebagian dari container memory.
4. CPU quota memengaruhi concurrency, GC, startup, dan latency.
5. `docker stats` berguna, tapi tidak cukup untuk root cause.
6. Image size memengaruhi deployment speed, bukan hanya disk usage.
7. Build speed bergantung pada context, cache, dan Dockerfile ordering.
8. Docker Desktop performance tidak identik dengan Linux production.
9. Resource tuning harus dikaitkan dengan workload, bukan angka generik.
10. Performance incident container sering merupakan mismatch antara application model dan container contract.

---

## 25. Latihan Praktis

### Latihan 1 — CPU Quota Experiment

1. Jalankan Java API dengan `--cpus=0.5`.
2. Jalankan load test ringan.
3. Catat p95/p99, CPU %, GC pause, thread count.
4. Ubah ke `--cpus=1.0`.
5. Bandingkan.

Pertanyaan:

```text
Apakah throughput naik linear?
Apakah p99 membaik?
Apakah GC pause berubah?
Apakah thread pool masih terlalu besar?
```

### Latihan 2 — Memory Headroom Experiment

1. Set `--memory=512m`.
2. Jalankan dengan `-XX:MaxRAMPercentage=80`.
3. Ulangi dengan `60`.
4. Bandingkan OOM risk, GC, throughput.

Pertanyaan:

```text
Berapa memory steady-state?
Berapa non-heap?
Apakah direct memory terlihat?
Apakah ada exit 137?
```

### Latihan 3 — Build Cache Experiment

1. Buat Dockerfile dengan `COPY . .` sebelum dependency download.
2. Build dua kali.
3. Ubah satu file Java.
4. Lihat cache invalidation.
5. Ubah Dockerfile agar dependency layer dipisah.
6. Bandingkan build time.

### Latihan 4 — Image Size Experiment

1. Buat image runtime berbasis JDK.
2. Buat image runtime berbasis JRE/slim.
3. Buat multi-stage build.
4. Bandingkan:
   - image size;
   - layer history;
   - pull time;
   - startup behavior;
   - debuggability.

---

## 26. Referensi Resmi dan Bacaan Lanjutan

- Docker Docs — Resource constraints: memory and CPU limits.
- Docker Docs — `docker stats` and runtime metrics.
- Docker Docs — Running containers and CPU quota options.
- Docker Docs — Build cache and cache optimization.
- Docker Docs — Image pull and concurrent layer downloads.
- Docker Docs — Docker Desktop resource settings and Resource Saver.
- OpenJDK documentation — container awareness, JVM ergonomics, native memory tracking.
- Spring Boot documentation — Actuator metrics, graceful shutdown, container images.

---

## 27. Apa yang Akan Dibahas di Part Berikutnya

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-021.md
```

Topik:

```text
Logging and Diagnostics: stdout, stderr, Drivers, Crash Forensics
```

Kita akan membahas logging container sebagai runtime contract, Docker logging driver, log rotation, structured logs, crash forensics, heap/thread dump, JFR, dan bagaimana mendiagnosis container Java yang mati atau degraded dari jejak runtime yang tersedia.

---

## 28. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Selesai: Part 000 sampai Part 020
Belum:   Part 021 sampai Part 031
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Base Image Strategy for Java: JDK, JRE, Alpine, Distroless, Slim</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-021.md">Part 021 — Logging and Diagnostics: stdout, stderr, Drivers, Crash Forensics ➡️</a>
</div>
