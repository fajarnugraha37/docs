# learn-kubernetes-mastery-for-java-engineers-part-015.md

# Part 015 — Health, Probes, and Lifecycle Management

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita membahas release engineering: bagaimana versi aplikasi masuk ke cluster melalui rolling update, rollback, canary, blue/green, feature flag, dan migrasi kompatibel. Tetapi semua strategi deployment itu bertumpu pada satu asumsi besar:

> Kubernetes harus bisa membedakan Pod yang boleh menerima traffic, Pod yang masih startup, Pod yang macet, dan Pod yang harus dimatikan.

Part ini membahas mekanisme yang membuat asumsi itu bekerja: **health probes dan lifecycle management**.

Kubernetes menyediakan tiga probe utama: `livenessProbe`, `readinessProbe`, dan `startupProbe`. Probe dijalankan oleh `kubelet` untuk memonitor container. Berdasarkan hasil probe, Kubernetes dapat me-restart container yang dianggap tidak sehat atau menghentikan pengiriman traffic ke container yang belum siap. Referensi resmi Kubernetes menjelaskan bahwa probe dapat berupa eksekusi command di container atau request jaringan seperti HTTP, TCP, dan gRPC. Lihat dokumentasi resmi Kubernetes tentang liveness, readiness, dan startup probes.

Part ini tidak akan mengulang HTTP basic, JVM basic, Docker lifecycle basic, atau Linux signal basic yang sudah disentuh di seri lain. Fokusnya adalah bagaimana Kubernetes memakai sinyal-sinyal itu untuk membuat keputusan operasional.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan makna `alive`, `started`, `ready`, `healthy`, dan `correct`.
2. Mendesain `livenessProbe`, `readinessProbe`, dan `startupProbe` untuk Java service.
3. Menentukan kapan probe harus mengecek dependency eksternal dan kapan tidak.
4. Menghindari probe yang menyebabkan restart loop, outage palsu, dan traffic blackhole.
5. Memahami termination lifecycle: `preStop`, `SIGTERM`, `terminationGracePeriodSeconds`, endpoint removal, dan connection draining.
6. Mendesain graceful shutdown untuk Java REST API, worker, scheduler, dan consumer.
7. Memahami bagaimana `PodDisruptionBudget` melindungi aplikasi dari voluntary disruption.
8. Men-debug failure seperti `CrashLoopBackOff`, `Readiness probe failed`, rollout stuck, dan node drain blocked.

---

## 2. Mental Model Utama

### 2.1 Kubernetes Tidak Tahu Semantik Aplikasi

Kubernetes tidak tahu apakah aplikasi Java kamu benar-benar “benar”. Kubernetes hanya tahu sinyal yang kamu berikan.

Kubernetes tidak tahu:

- apakah endpoint `/api/payment` benar-benar bisa memproses payment;
- apakah Kafka consumer kamu masih bisa commit offset;
- apakah DB migration kompatibel;
- apakah cache poisoning sedang terjadi;
- apakah business invariant masih benar;
- apakah aplikasi mengembalikan data salah tetapi HTTP 200.

Kubernetes hanya bisa bertanya melalui probe:

```text
"Container ini masih hidup?"
"Container ini sudah startup?"
"Container ini siap menerima traffic?"
```

Jadi probe bukan sekadar konfigurasi teknis. Probe adalah **kontrak observability minimum** antara aplikasi dan platform.

---

### 2.2 Health Bukan Satu Dimensi

Salah satu kesalahan paling umum adalah membuat satu endpoint `/health` lalu dipakai untuk semua probe.

Padahal dalam production, health punya banyak dimensi:

```text
started   : proses aplikasi sudah selesai bootstrap?
alive     : proses masih mampu melakukan progress internal?
ready     : instance ini boleh menerima traffic baru?
draining  : instance sedang berhenti dan tidak boleh menerima traffic baru?
correct   : aplikasi menghasilkan hasil bisnis yang benar?
```

Kubernetes probe hanya mengatur beberapa dimensi, bukan semua.

Mapping umumnya:

```text
startupProbe   -> apakah aplikasi sudah berhasil melewati fase startup awal?
livenessProbe  -> apakah aplikasi macet sehingga restart adalah tindakan masuk akal?
readinessProbe -> apakah instance boleh dimasukkan ke Service endpoints?
```

Dimensi `correct` biasanya bukan urusan liveness/readiness langsung. Itu lebih cocok ditangkap oleh monitoring, synthetic check, alert, canary analysis, contract test, dan domain-level validation.

---

### 2.3 Restart Bukan Obat Universal

`livenessProbe` gagal berarti Kubernetes akan restart container.

Itu berguna jika masalahnya:

- deadlock;
- event loop stuck;
- thread pool fatal exhaustion;
- unrecoverable internal corruption;
- process masih hidup tetapi tidak bisa progress;
- aplikasi masuk state yang hanya bisa pulih dengan restart.

Tetapi restart berbahaya jika masalahnya:

- database sedang down;
- dependency eksternal lambat;
- upstream outage;
- temporary network partition;
- cold start lambat;
- GC pause sesaat;
- traffic spike;
- CPU throttling;
- migration masih berjalan.

Jika dependency eksternal down lalu `livenessProbe` ikut gagal, Kubernetes akan me-restart semua replica. Hasilnya bukan recovery, tetapi **restart storm**.

Prinsipnya:

> Liveness harus menjawab: “apakah restart container ini kemungkinan besar memperbaiki masalah?”

Jika jawabannya tidak, jangan masukkan kondisi itu ke liveness.

---

## 3. Tiga Probe Utama

## 3.1 `startupProbe`

`startupProbe` mengecek apakah aplikasi sudah selesai startup. Jika `startupProbe` dikonfigurasi, Kubernetes tidak menjalankan liveness dan readiness probe sampai startup probe berhasil. Ini penting untuk aplikasi yang butuh waktu bootstrap lama. Dokumentasi Kubernetes menjelaskan startup probe sebagai probe yang dijalankan saat startup dan berguna untuk container yang butuh waktu lama sebelum masuk service.

Cocok untuk:

- Spring Boot aplikasi besar;
- service dengan classpath besar;
- aplikasi dengan warmup cache;
- service yang melakukan schema validation saat boot;
- JVM yang butuh waktu inisialisasi;
- aplikasi dengan JIT/warmup awal;
- service yang startup-nya bisa sangat bervariasi tergantung resource.

Contoh:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/startup
    port: 8080
  failureThreshold: 60
  periodSeconds: 2
```

Artinya Kubernetes memberi waktu sampai sekitar:

```text
60 * 2 seconds = 120 seconds
```

untuk startup berhasil sebelum container dianggap gagal startup.

### Kesalahan Umum

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health
    port: 8080
  initialDelaySeconds: 10
```

Untuk Spring Boot yang kadang startup 45 detik, konfigurasi ini bisa menyebabkan container dibunuh sebelum sempat hidup. Solusi modern biasanya bukan menaikkan `initialDelaySeconds` secara membabi buta, tetapi memakai `startupProbe`.

---

## 3.2 `livenessProbe`

`livenessProbe` menjawab:

> Apakah container ini masih hidup dan mampu melakukan progress sehingga tidak perlu di-restart?

Jika liveness gagal melebihi threshold, kubelet akan me-restart container sesuai restart policy Pod.

Contoh:

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 0
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

Dengan konfigurasi ini, container akan dianggap tidak live jika gagal 3 kali berturut-turut dengan interval 10 detik.

### Liveness yang Baik

Liveness yang baik biasanya mengecek hal-hal internal:

- process masih bisa menerima request di endpoint local;
- event loop atau servlet container tidak deadlock;
- application context tidak fatal corrupted;
- critical internal component masih berjalan;
- aplikasi tidak berada dalam unrecoverable state.

### Liveness yang Buruk

Liveness yang buruk mengecek hal eksternal yang tidak bisa diperbaiki oleh restart:

```text
- database down
- Kafka unavailable
- Redis timeout
- downstream payment gateway error
- object storage unavailable
- DNS eksternal bermasalah
```

Jika semua Pod mengecek DB di liveness dan DB down, semua Pod bisa restart bersama-sama. Saat DB pulih, aplikasi justru masih cold start atau dalam crash loop.

---

## 3.3 `readinessProbe`

`readinessProbe` menjawab:

> Apakah Pod ini boleh menerima traffic baru dari Service?

Jika readiness gagal, Pod tidak langsung di-restart. Kubernetes akan mengeluarkan Pod dari endpoint Service sehingga traffic baru tidak diarahkan ke Pod tersebut.

Contoh:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
  successThreshold: 1
```

Readiness cocok untuk kondisi seperti:

- aplikasi belum selesai bootstrap;
- aplikasi sedang warmup;
- thread pool penuh;
- local dependency belum siap;
- instance sedang draining;
- cache penting belum terisi;
- aplikasi tidak ingin menerima traffic baru.

### Readiness Boleh Mengecek Dependency?

Jawaban realistis: **tergantung dependency dan konsekuensi traffic routing**.

Untuk dependency kritikal seperti database utama:

- Jika aplikasi sama sekali tidak bisa melayani request tanpa DB, readiness boleh mempertimbangkan DB.
- Tetapi hati-hati: jika semua replica menjadi unready karena DB down, Service bisa kehilangan semua endpoint.
- Dari sudut client, hasilnya bisa berubah dari error aplikasi yang jelas menjadi connection failure/503 dari gateway.

Untuk dependency optional seperti cache:

- Biasanya jangan membuat Pod unready hanya karena cache down.
- Lebih baik degrade gracefully.

Untuk dependency downstream yang hanya dipakai sebagian endpoint:

- Jangan membuat seluruh Pod unready jika hanya satu fitur downstream yang gagal.
- Lebih baik expose health detail ke monitoring, bukan readiness global.

Prinsipnya:

> Readiness harus merepresentasikan kemampuan instance menerima traffic secara aman, bukan status seluruh dunia eksternal.

---

## 4. Probe Types

Kubernetes mendukung beberapa cara melakukan probe.

## 4.1 HTTP Probe

Paling umum untuk Java web service.

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
    scheme: HTTP
  periodSeconds: 5
  timeoutSeconds: 2
```

Kelebihan:

- mudah dipahami;
- cocok untuk Spring Boot Actuator;
- bisa memisahkan liveness/readiness/startup;
- bisa memberi HTTP status jelas.

Kekurangan:

- jika servlet thread pool penuh, probe bisa ikut timeout;
- jika endpoint health terlalu berat, probe menambah load;
- jika endpoint health mengecek terlalu banyak dependency, probe menjadi penyebab gangguan.

---

## 4.2 TCP Probe

TCP probe hanya mengecek apakah port bisa dibuka.

```yaml
livenessProbe:
  tcpSocket:
    port: 8080
  periodSeconds: 10
```

Kelebihan:

- ringan;
- cocok untuk aplikasi non-HTTP;
- tidak butuh endpoint khusus.

Kekurangan:

- terlalu dangkal;
- port terbuka bukan berarti aplikasi sehat;
- tidak tahu apakah request bisa diproses.

TCP probe bisa berguna sebagai liveness minimal, tetapi jarang cukup untuk readiness aplikasi kompleks.

---

## 4.3 Exec Probe

Exec probe menjalankan command di dalam container.

```yaml
livenessProbe:
  exec:
    command:
      - /bin/sh
      - -c
      - test -f /tmp/app-live
  periodSeconds: 10
```

Kelebihan:

- bisa mengecek file, process, local state;
- tidak butuh HTTP server.

Kekurangan:

- command terlalu berat bisa membebani node;
- shell/script bisa punya bug;
- image minimal mungkin tidak punya shell;
- security surface bertambah;
- hasil probe tergantung tool di image.

Untuk Java service modern, HTTP probe biasanya lebih bersih.

---

## 4.4 gRPC Probe

Kubernetes juga mendukung gRPC health checking untuk aplikasi yang expose gRPC health service.

Cocok untuk:

- service internal gRPC;
- aplikasi yang tidak expose HTTP;
- workload dengan standard gRPC Health Checking Protocol.

Tetapi untuk banyak aplikasi Java/Spring Boot REST, HTTP probe tetap pilihan utama.

---

## 5. Parameter Probe yang Wajib Dipahami

Contoh lengkap:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 2
  successThreshold: 1
  failureThreshold: 3
```

### 5.1 `initialDelaySeconds`

Delay sebelum probe pertama dijalankan setelah container start.

Namun untuk startup lambat, lebih baik gunakan `startupProbe` daripada `initialDelaySeconds` besar.

---

### 5.2 `periodSeconds`

Interval antar probe.

Terlalu kecil:

- menambah load;
- memperbesar noise;
- mempercepat restart tidak perlu.

Terlalu besar:

- lambat mendeteksi failure;
- rollout/drain terasa lambat.

---

### 5.3 `timeoutSeconds`

Batas waktu setiap probe.

Untuk Java service, timeout terlalu agresif bisa gagal saat:

- GC pause;
- CPU throttling;
- cold JIT;
- node load tinggi;
- thread pool saturation.

Tetapi timeout terlalu longgar bisa membuat deteksi failure lambat.

---

### 5.4 `failureThreshold`

Jumlah kegagalan berturut-turut sebelum dianggap gagal.

Jika:

```yaml
periodSeconds: 10
failureThreshold: 3
```

maka failure perlu bertahan sekitar 30 detik sebelum tindakan dilakukan.

---

### 5.5 `successThreshold`

Jumlah keberhasilan berturut-turut sebelum dianggap sukses lagi.

Untuk readiness, kadang berguna menaikkan ini agar Pod tidak bolak-balik ready/unready.

---

## 6. Spring Boot Actuator Mapping

Spring Boot modern menyediakan konsep health group yang bisa dipakai untuk Kubernetes probe.

Pattern yang umum:

```text
/actuator/health/liveness
/actuator/health/readiness
```

Konfigurasi contoh:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  endpoint:
    health:
      probes:
        enabled: true
      show-details: never
```

Manifest contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: registry.example.com/order-service:1.8.0
          ports:
            - containerPort: 8080
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 2
            failureThreshold: 60
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
```

Catatan penting:

- `startupProbe` boleh memakai liveness endpoint karena tujuannya memastikan aplikasi sudah bisa menjawab minimal.
- `readinessProbe` harus lebih sensitif terhadap kemampuan menerima traffic.
- Jangan expose detail secret/dependency internal ke publik.
- Pastikan endpoint actuator tidak terbuka dari internet melalui Ingress/Gateway tanpa kontrol.

---

## 7. Designing Liveness for Java Services

## 7.1 Tujuan Liveness

Liveness harus menjadi sinyal bahwa restart lokal bisa membantu.

Contoh kondisi yang masuk akal:

```text
- aplikasi deadlock
- request handling loop tidak merespons sama sekali
- application context fatal
- internal scheduler utama mati permanen
- service masuk state unrecoverable
```

Liveness tidak harus membuktikan semua fitur sehat.

---

## 7.2 Liveness Minimalist Pattern

Untuk banyak Java REST API:

```text
liveness = process HTTP server can respond + internal application not marked fatal
```

Jangan cek:

```text
- PostgreSQL
- Kafka
- Redis
- Elasticsearch
- payment gateway
- email provider
```

Karena restart aplikasi tidak memperbaiki dependency tersebut.

---

## 7.3 Liveness dan Deadlock

HTTP liveness bisa gagal mendeteksi deadlock jika endpoint health masih dilayani oleh thread berbeda atau tidak menyentuh path yang macet.

Namun liveness juga tidak boleh menjadi synthetic transaction berat.

Pendekatan seimbang:

- gunakan endpoint ringan;
- expose internal fatal state jika aplikasi tahu dirinya rusak;
- gunakan metrics/alerts untuk deteksi lebih kaya;
- jangan menjadikan liveness sebagai observability lengkap.

---

## 8. Designing Readiness for Java Services

## 8.1 Tujuan Readiness

Readiness mengontrol endpoint publication.

Saat readiness false:

```text
Pod tetap berjalan,
tetapi Service tidak lagi mengirim traffic baru ke Pod itu.
```

Ini sangat penting untuk:

- startup;
- graceful shutdown;
- warmup;
- dependency local;
- overload protection;
- manual draining;
- rollout safety.

---

## 8.2 Readiness untuk REST API

Readiness REST API sebaiknya menjawab:

```text
Apakah instance ini bisa menerima request baru dengan peluang sukses yang wajar?
```

Bisa mempertimbangkan:

- application context ready;
- HTTP server ready;
- DB connection pool initialized;
- migration compatibility verified;
- local cache minimum loaded jika wajib;
- instance tidak sedang shutdown;
- thread pool tidak dalam kondisi fatal saturation.

Tetapi jangan otomatis gagal hanya karena semua downstream optional gagal.

---

## 8.3 Readiness untuk Worker/Consumer

Untuk worker yang tidak menerima traffic HTTP dari Service, readiness tetap berguna jika:

- workload punya Service untuk metrics/admin;
- rollout controller perlu tahu kapan instance siap;
- worker harus menunggu dependency sebelum mulai consume;
- operator/platform butuh status standar.

Tetapi readiness tidak menghentikan Kafka/RabbitMQ mengirim message jika client sudah consume sendiri. Untuk consumer, lifecycle konsumsi message harus dikelola oleh aplikasi:

```text
SIGTERM diterima
-> stop menerima message baru
-> selesaikan message in-flight
-> commit/ack/nack sesuai semantik
-> shutdown bersih sebelum grace period habis
```

Jangan mengandalkan readiness saja untuk menghentikan konsumsi queue.

---

## 8.4 Readiness dan Overload

Aplikasi bisa membuat readiness false saat overload berat untuk menolak traffic baru. Tetapi ini perlu hati-hati.

Jika semua replica menjadi unready karena overload, Service bisa kehilangan semua endpoints. Gateway/client akan melihat 503/connection failure.

Alternatif:

- gunakan load shedding di aplikasi;
- return HTTP 429/503 secara terkendali;
- gunakan circuit breaker;
- scale out dengan HPA;
- perbaiki resource request/limit;
- jangan flap readiness terlalu agresif.

---

## 9. Startup Probe untuk Java: Kenapa Sangat Penting

Aplikasi Java sering punya startup yang tidak konstan:

```text
- classpath scanning
- dependency injection
- JPA metadata initialization
- Hibernate validation
- Flyway/Liquibase coordination
- TLS truststore loading
- cache warmup
- JIT warmup
- slow CPU karena throttling
- cold node image pull
```

Tanpa startup probe, liveness probe bisa mulai terlalu cepat dan membunuh aplikasi yang sebenarnya masih normal startup.

Pattern:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 2
  failureThreshold: 90
```

Ini memberi waktu 180 detik.

Setelah startup sukses, barulah liveness dan readiness probe normal dijalankan.

---

## 10. Lifecycle Hooks

Kubernetes menyediakan container lifecycle hook seperti `PostStart` dan `PreStop`. Untuk shutdown, yang paling sering relevan adalah `preStop`.

Dokumentasi Kubernetes menjelaskan bahwa countdown `terminationGracePeriodSeconds` dimulai sebelum `preStop` dijalankan, sehingga hook tetap harus selesai dalam grace period. Jika hook terlalu lama, container tetap akan dihentikan saat grace period habis.

## 10.1 `preStop`

`preStop` dijalankan sebelum container menerima termination final dari runtime.

Contoh:

```yaml
lifecycle:
  preStop:
    exec:
      command:
        - /bin/sh
        - -c
        - sleep 10
```

Pattern `sleep` sering dipakai untuk memberi waktu endpoint removal menyebar ke load balancer/proxy sebelum process mati.

Namun `sleep` bukan solusi ideal untuk semua kasus. Lebih baik aplikasi sendiri mengelola draining dengan benar.

---

## 10.2 Kapan `preStop sleep` Berguna?

Berguna jika:

- external load balancer masih mungkin mengirim traffic sesaat setelah Pod terminating;
- endpoint propagation butuh waktu;
- aplikasi belum punya draining internal yang baik;
- ingin memberi buffer sebelum SIGTERM diproses.

Berbahaya jika:

- membuat shutdown terlalu lama;
- menghabiskan grace period;
- dipakai sebagai pengganti lifecycle handling aplikasi;
- menghambat rollout besar;
- membuat node drain lama.

---

## 11. Pod Termination Flow

Saat Pod dihapus, rollout mengganti replica, node drain terjadi, atau autoscaler mengurangi replica, Kubernetes melakukan termination flow.

Secara konseptual:

```text
1. Pod diberi deletionTimestamp.
2. Pod masuk fase terminating dari sudut operasional.
3. EndpointSlice/Service mulai menandai Pod tidak siap/terminating.
4. preStop hook dijalankan jika ada.
5. Container menerima SIGTERM.
6. Aplikasi punya waktu sampai terminationGracePeriodSeconds habis.
7. Jika belum selesai, container menerima SIGKILL.
8. Pod dihapus setelah container berhenti dan cleanup selesai.
```

Poin penting:

> `terminationGracePeriodSeconds` bukan waktu setelah `preStop`, melainkan total budget termination.

Jika grace period 30 detik dan `preStop` sleep 20 detik, aplikasi hanya punya sekitar 10 detik untuk shutdown setelah itu.

---

## 12. Graceful Shutdown untuk Java REST API

Java REST API harus bisa melakukan shutdown seperti ini:

```text
SIGTERM diterima
-> readiness menjadi false / tidak menerima traffic baru
-> server berhenti menerima connection/request baru
-> request in-flight diberi waktu selesai
-> background task dihentikan
-> connection pool ditutup
-> telemetry flush
-> process exit dengan kode sukses
```

Untuk Spring Boot, pastikan graceful shutdown diaktifkan sesuai versi dan stack yang dipakai.

Contoh konsep konfigurasi:

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Manifest:

```yaml
terminationGracePeriodSeconds: 45
```

Jangan set grace period terlalu kecil untuk aplikasi yang punya request panjang.

---

## 13. Graceful Shutdown untuk Message Consumer

Untuk Kafka/RabbitMQ worker, termination jauh lebih sensitif.

Shutdown ideal:

```text
SIGTERM diterima
-> stop polling/consume message baru
-> selesaikan message in-flight
-> commit offset / ack message yang sukses
-> nack/requeue message yang belum aman
-> close consumer cleanly
-> exit
```

Failure jika tidak graceful:

- duplicate processing;
- lost message;
- offset commit salah;
- consumer group rebalance storm;
- partial side effect;
- long retry karena message stuck.

Untuk consumer, readiness tidak cukup. Aplikasi harus punya signal handling dan consumer shutdown logic.

---

## 14. Graceful Shutdown untuk Scheduler dan Leader Election

Jika aplikasi punya internal scheduler, hati-hati saat running multiple replicas.

Pattern:

```text
- gunakan Kubernetes CronJob untuk schedule sederhana; atau
- gunakan leader election jika scheduler ada di aplikasi; atau
- pastikan job idempotent dan locked secara distributed.
```

Saat shutdown:

```text
SIGTERM
-> stop scheduling pekerjaan baru
-> selesaikan pekerjaan berjalan jika aman
-> release leadership/lock
-> exit
```

Jika tidak, rollout bisa menyebabkan:

- duplicate scheduled job;
- job berhenti di tengah;
- lock tidak dilepas;
- scheduler lama dan baru overlap.

---

## 15. Readiness Gates

Selain readiness probe, Kubernetes punya konsep `readinessGates` yang memungkinkan kondisi tambahan pada Pod menentukan apakah Pod dianggap ready.

Ini biasanya dipakai oleh integrasi controller/platform yang menambahkan custom condition ke Pod status.

Contoh use case:

- service mesh sidecar siap;
- external load balancer registration selesai;
- custom admission/platform readiness;
- workload membutuhkan sinyal eksternal sebelum masuk endpoint.

Namun readiness gate menambah kompleksitas. Gunakan jika ada controller yang benar-benar mengelola condition tersebut.

---

## 16. PodDisruptionBudget

`PodDisruptionBudget` atau PDB membatasi berapa banyak Pod dari aplikasi replicated yang boleh unavailable akibat voluntary disruption. Dokumentasi Kubernetes menjelaskan PDB sebagai cara application owner membatasi jumlah Pod yang down secara bersamaan akibat voluntary disruption, misalnya saat node drain atau maintenance.

Contoh:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: order-service-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: order-service
```

Dengan 3 replica, PDB ini mengatakan minimal 2 harus available.

Artinya saat node drain, Kubernetes tidak boleh secara sukarela meng-evict terlalu banyak Pod sehingga available replica turun di bawah 2.

---

## 16.1 PDB Bukan High Availability Sendirian

PDB tidak membuat aplikasi highly available jika:

- replica hanya 1;
- semua Pod berada di node yang sama;
- readiness salah;
- aplikasi tidak stateless;
- dependency utama single point of failure;
- topology spread tidak benar;
- resource tidak cukup untuk reschedule.

PDB hanya melindungi dari voluntary disruption tertentu.

PDB tidak mencegah:

- node crash;
- kernel panic;
- cloud instance mati mendadak;
- container OOMKilled;
- app crash;
- disk failure;
- network partition;
- involuntary disruption.

---

## 16.2 PDB dan Rollout

PDB bisa berinteraksi dengan Deployment rollout.

Misal:

```text
replicas: 2
PDB minAvailable: 2
Deployment maxUnavailable: 1
```

Ini bisa membuat beberapa operasi maintenance sulit karena PDB menuntut dua Pod selalu available.

Untuk aplikasi 2 replica, `minAvailable: 1` sering lebih realistis, tetapi trade-off availability-nya harus disadari.

---

## 16.3 PDB dan Node Drain

Saat cluster upgrade, node drain mencoba evict Pod dari node. Jika PDB tidak mengizinkan eviction, drain bisa blocked.

Ini bagus jika mencegah downtime. Tetapi bisa buruk jika:

- PDB terlalu ketat;
- replica tidak cukup;
- Pod stuck unready;
- workload singleton diberi PDB mustahil;
- cluster upgrade tertahan.

Debug:

```bash
kubectl get pdb
kubectl describe pdb order-service-pdb
kubectl get pods -l app=order-service -o wide
```

---

## 17. Probe Design Matrix

| Workload Type | Startup Probe | Liveness Probe | Readiness Probe | Shutdown Concern |
|---|---|---|---|---|
| Java REST API | Sangat disarankan | Internal fatal/deadlock | Siap menerima HTTP traffic | Drain request in-flight |
| Java Kafka Consumer | Berguna | Consumer process fatal | Tidak selalu mengontrol message flow | Stop polling, commit/ack aman |
| Batch Job | Jarang perlu | Hati-hati, bisa mengganggu job panjang | Biasanya tidak penting | Idempotency dan retry |
| CronJob | Jarang perlu | Biasanya tidak | Biasanya tidak | Completion semantics |
| Stateful Service | Bergantung | Sangat hati-hati | Harus aware quorum/role | Ordered shutdown, data safety |
| Admin/Control App | Bergantung | Internal fatal | Role/control-plane ready | Avoid partial control action |

---

## 18. Anti-Pattern Probe

## 18.1 Satu Endpoint untuk Semua

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health
readinessProbe:
  httpGet:
    path: /actuator/health
startupProbe:
  httpGet:
    path: /actuator/health
```

Masalah:

- liveness bisa gagal karena dependency eksternal;
- readiness tidak membedakan startup dan runtime;
- startup lambat bisa dibunuh;
- endpoint terlalu berat.

---

## 18.2 Liveness Mengecek Database

```text
DB down -> liveness fail -> all Pods restart -> DB still down -> restart storm
```

Ini salah karena restart Pod tidak memperbaiki DB.

---

## 18.3 Probe Timeout Terlalu Agresif

```yaml
timeoutSeconds: 1
periodSeconds: 2
failureThreshold: 1
```

Untuk Java service di node sibuk, ini bisa menyebabkan false positive.

---

## 18.4 Tidak Ada Startup Probe untuk Aplikasi Lambat

Akibat:

- liveness mulai terlalu cepat;
- container restart sebelum startup selesai;
- `CrashLoopBackOff`;
- rollout stuck.

---

## 18.5 Readiness Selalu True

Aplikasi return HTTP 200 walaupun:

- belum selesai warmup;
- connection pool belum siap;
- sedang shutdown;
- thread pool saturated;
- migration belum kompatibel.

Akibat: traffic dikirim ke instance yang belum siap.

---

## 18.6 Shutdown Mengandalkan SIGKILL

Jika aplikasi tidak handle SIGTERM dan grace period terlalu pendek:

- request terputus;
- message duplicate;
- transaction partial;
- telemetry hilang;
- connection pool tidak clean close.

---

## 19. Debugging Probe Failure

## 19.1 Lihat Pod Status

```bash
kubectl get pod order-service-abc123
kubectl describe pod order-service-abc123
```

Cari event seperti:

```text
Liveness probe failed
Readiness probe failed
Startup probe failed
Back-off restarting failed container
Killing container
```

---

## 19.2 Lihat Logs Sebelumnya

Jika container restart:

```bash
kubectl logs order-service-abc123 --previous
```

Tanpa `--previous`, kamu mungkin hanya melihat log container baru, bukan penyebab crash sebelumnya.

---

## 19.3 Test Endpoint dari Dalam Cluster

```bash
kubectl exec -it order-service-abc123 -- wget -qO- http://localhost:8080/actuator/health/readiness
```

Atau dari Pod debug lain:

```bash
kubectl run curl --rm -it --image=curlimages/curl -- sh
curl -v http://order-service.default.svc.cluster.local:8080/actuator/health/readiness
```

---

## 19.4 Cek Endpoint Service

```bash
kubectl get endpointslice -l kubernetes.io/service-name=order-service
kubectl get endpoints order-service
```

Jika Pod unready, endpoint mungkin tidak menerima traffic normal.

---

## 19.5 Cek Timing

Bandingkan:

```text
startup duration aplikasi
initialDelaySeconds
startupProbe failureThreshold * periodSeconds
liveness failureThreshold * periodSeconds
timeoutSeconds
terminationGracePeriodSeconds
preStop duration
```

Banyak masalah probe adalah masalah timing, bukan logic.

---

## 20. Debugging Rollout Stuck Karena Readiness

Gejala:

```bash
kubectl rollout status deployment/order-service
```

Output mungkin tertahan karena replica baru tidak ready.

Langkah:

```bash
kubectl get deploy order-service
kubectl get rs -l app=order-service
kubectl get pods -l app=order-service
kubectl describe pod <new-pod>
kubectl logs <new-pod>
```

Cari:

- readiness probe failed;
- app startup error;
- config missing;
- DB connection failed;
- port salah;
- path probe salah;
- actuator tidak expose endpoint;
- resource terlalu kecil;
- CPU throttling;
- migration lock.

---

## 21. Debugging Graceful Shutdown

Gejala:

- request terputus saat rollout;
- 502/503 spike saat deployment;
- Kafka duplicate meningkat saat rolling update;
- Pod lama masih menerima traffic setelah terminating;
- rollout lambat;
- node drain lama.

Langkah:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --timestamps
kubectl get endpointslice -w
kubectl rollout restart deployment/order-service
```

Instrument aplikasi:

```text
- log saat SIGTERM diterima
- log saat readiness false
- log saat server stop menerima traffic
- log jumlah request in-flight
- log saat shutdown complete
- metric shutdown duration
```

Tanpa log lifecycle, graceful shutdown sulit dibuktikan.

---

## 22. Recommended Baseline untuk Java REST API

Baseline awal, bukan angka final:

```yaml
terminationGracePeriodSeconds: 45
containers:
  - name: app
    image: registry.example.com/order-service:1.8.0
    ports:
      - containerPort: 8080
    startupProbe:
      httpGet:
        path: /actuator/health/liveness
        port: 8080
      periodSeconds: 2
      failureThreshold: 60
      timeoutSeconds: 2
    livenessProbe:
      httpGet:
        path: /actuator/health/liveness
        port: 8080
      periodSeconds: 10
      failureThreshold: 3
      timeoutSeconds: 2
    readinessProbe:
      httpGet:
        path: /actuator/health/readiness
        port: 8080
      periodSeconds: 5
      failureThreshold: 2
      timeoutSeconds: 2
```

PDB:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: order-service-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: order-service
```

Untuk 3 replica, ini baseline masuk akal.

---

## 23. Recommended Baseline untuk Java Consumer

```yaml
terminationGracePeriodSeconds: 90
containers:
  - name: consumer
    image: registry.example.com/order-consumer:1.8.0
    startupProbe:
      httpGet:
        path: /actuator/health/liveness
        port: 8080
      periodSeconds: 2
      failureThreshold: 60
    livenessProbe:
      httpGet:
        path: /actuator/health/liveness
        port: 8080
      periodSeconds: 10
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /actuator/health/readiness
        port: 8080
      periodSeconds: 5
      failureThreshold: 2
```

Namun yang paling penting ada di aplikasi:

```text
on SIGTERM:
  stop consuming new messages
  finish in-flight messages
  commit/ack safely
  close client
  exit before grace period
```

---

## 24. Probe dan Deployment Strategy

Readiness menentukan apakah replica baru dianggap available saat rolling update.

Jika readiness terlalu longgar:

```text
rollout cepat selesai,
tetapi traffic masuk ke Pod yang belum siap.
```

Jika readiness terlalu ketat:

```text
rollout stuck,
replica baru tidak pernah available,
Deployment mungkin melewati progressDeadlineSeconds.
```

Liveness menentukan apakah Pod lama atau baru akan restart.

Jika liveness salah:

```text
rollout menghasilkan restart storm,
bukan deployment sehat.
```

Startup probe menentukan apakah aplikasi diberi waktu cukup.

Jika startup probe tidak ada:

```text
aplikasi lambat dianggap mati,
Pod masuk CrashLoopBackOff.
```

---

## 25. Probe dan Autoscaling

Probe juga berinteraksi dengan autoscaling.

Saat HPA scale out:

- Pod baru perlu startup;
- startup probe memberi waktu;
- readiness menahan traffic sampai siap;
- terlalu lambat readiness berarti scale-out response lambat;
- terlalu cepat readiness berarti cold instance menerima traffic terlalu awal.

Untuk Java service dengan warmup signifikan, readiness bisa mempertimbangkan warmup minimal, tetapi jangan terlalu berat sehingga scale-out lambat.

---

## 26. Probe dan Service Mesh / Gateway

Dalam environment dengan service mesh atau gateway:

- readiness Pod memengaruhi endpoint discovery;
- proxy sidecar juga punya lifecycle;
- gateway bisa punya health check sendiri;
- upstream timeout harus align dengan app shutdown;
- retry policy bisa memperbesar dampak Pod terminating.

Masalah umum:

```text
Pod sudah terminating,
readiness false,
tetapi proxy/gateway masih punya koneksi lama.
```

Solusi biasanya kombinasi:

- graceful shutdown aplikasi;
- connection draining proxy;
- `preStop` buffer jika perlu;
- timeout/retry yang konsisten;
- observability terhadap terminating endpoints.

---

## 27. Failure Mode Catalogue

## 27.1 Startup Probe Terlalu Pendek

Gejala:

```text
Startup probe failed
Back-off restarting failed container
CrashLoopBackOff
```

Penyebab:

- aplikasi startup lebih lama dari budget;
- CPU request terlalu kecil;
- image pull/warmup lambat;
- migration lock;
- config validation lambat.

Remediasi:

- ukur startup p95/p99;
- naikkan startup probe budget;
- perbaiki CPU request;
- kurangi startup work;
- pisahkan migration dari startup jika perlu.

---

## 27.2 Liveness Mengecek Dependency Eksternal

Gejala:

```text
semua Pod restart saat DB/Kafka down
```

Remediasi:

- keluarkan dependency eksternal dari liveness;
- pindahkan ke readiness jika benar-benar perlu;
- monitor dependency via metrics/alerts;
- gunakan circuit breaker/degraded mode.

---

## 27.3 Readiness Flapping

Gejala:

```text
Pod bolak-balik Ready/NotReady
traffic unstable
latency naik
gateway 503 sporadis
```

Penyebab:

- readiness terlalu sensitif;
- dependency latency flapping;
- timeout terlalu rendah;
- CPU throttling;
- overload;
- health endpoint terlalu berat.

Remediasi:

- tambah `failureThreshold`;
- tambah `successThreshold` untuk readiness;
- sederhanakan endpoint;
- perbaiki resource;
- gunakan load shedding.

---

## 27.4 Grace Period Terlalu Pendek

Gejala:

```text
SIGKILL sebelum request selesai
message duplicate
request reset saat rollout
```

Remediasi:

- ukur request max duration;
- set `terminationGracePeriodSeconds` realistis;
- aktifkan graceful shutdown;
- stop menerima traffic baru saat termination;
- tune preStop.

---

## 27.5 PDB Blocks Node Drain

Gejala:

```text
cannot evict pod as it would violate the pod's disruption budget
```

Penyebab:

- PDB terlalu ketat;
- replica kurang;
- Pod lain unready;
- scheduling constraint mencegah replacement;
- rollout sedang bermasalah.

Remediasi:

- cek `kubectl describe pdb`;
- tambah replica;
- perbaiki readiness;
- perbaiki scheduling;
- sesuaikan PDB secara sadar.

---

## 28. Production Checklist

Untuk setiap Java service di Kubernetes, pastikan:

```text
[ ] Ada startupProbe untuk aplikasi yang startup-nya tidak trivial.
[ ] Liveness tidak mengecek dependency eksternal yang tidak bisa diperbaiki restart.
[ ] Readiness merepresentasikan kemampuan menerima traffic baru.
[ ] Endpoint liveness/readiness dipisahkan secara semantik.
[ ] Health endpoint ringan dan tidak membebani dependency.
[ ] Timeout dan threshold didasarkan pada pengukuran, bukan tebakan.
[ ] Graceful shutdown aktif di aplikasi.
[ ] terminationGracePeriodSeconds cukup untuk shutdown normal.
[ ] SIGTERM di-log dan diamati.
[ ] Request/message in-flight ditangani saat shutdown.
[ ] PDB dikonfigurasi untuk workload replicated penting.
[ ] PDB tidak mustahil dipenuhi.
[ ] Rollout diuji dengan traffic nyata atau synthetic traffic.
[ ] Endpoint removal diamati saat Pod terminating.
[ ] Probe failure punya alert/runbook yang jelas.
```

---

## 29. Latihan Praktis

### Latihan 1 — Desain Probe REST API

Ambil satu Spring Boot service. Tentukan:

```text
startupProbe path:
livenessProbe path:
readinessProbe path:
startup budget:
liveness threshold:
readiness threshold:
termination grace period:
```

Jelaskan alasan setiap angka.

---

### Latihan 2 — Simulasi Startup Lambat

Tambahkan delay startup 60 detik pada aplikasi. Coba tanpa startup probe dan dengan startup probe.

Amati:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get pods -w
```

---

### Latihan 3 — Simulasi Dependency Down

Matikan database atau dependency dummy.

Bandingkan jika dependency dicek oleh:

```text
- liveness
- readiness
- metrics only
```

Catat dampaknya ke rollout dan traffic.

---

### Latihan 4 — Simulasi Graceful Shutdown

Jalankan request panjang, lalu rollout restart.

```bash
kubectl rollout restart deployment/order-service
```

Amati apakah request selesai atau terputus.

---

### Latihan 5 — PDB dan Node Drain

Buat Deployment 3 replica dan PDB `minAvailable: 2`. Lakukan drain node pada cluster lokal/multi-node test.

Amati eviction behavior.

---

## 30. Ringkasan

Probe dan lifecycle management adalah fondasi reliability Kubernetes.

Inti part ini:

```text
startupProbe   -> beri aplikasi waktu startup sebelum liveness/readiness aktif
livenessProbe  -> restart hanya jika restart lokal mungkin memperbaiki masalah
readinessProbe -> kontrol apakah Pod boleh menerima traffic baru
preStop/SIGTERM/terminationGracePeriodSeconds -> kontrak shutdown
PDB            -> batasi voluntary disruption
```

Kesalahan paling mahal biasanya bukan tidak punya probe, tetapi punya probe yang salah semantik:

```text
- liveness terlalu berat
- readiness terlalu longgar
- startup probe tidak ada
- grace period terlalu pendek
- PDB terlalu ketat atau tidak ada sama sekali
```

Untuk Java engineer, probe harus dipahami sebagai bagian dari desain aplikasi, bukan sekadar YAML platform. Aplikasi harus menyediakan endpoint health yang semantik, murah, dan sesuai lifecycle. Kubernetes hanya bisa mengambil keputusan berdasarkan sinyal yang kita berikan.

---

## 31. Apa yang Akan Dibahas Berikutnya

Part berikutnya adalah:

```text
Part 016 — Autoscaling: HPA, VPA, Cluster Autoscaler, KEDA Concepts
```

Kita akan membahas bagaimana Kubernetes menambah/mengurangi kapasitas berdasarkan metrik, event backlog, resource usage, dan demand. Ini akan melanjutkan diskusi probe karena autoscaling hanya aman jika startup, readiness, resource request, dan workload semantics sudah benar.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Deployment Strategies and Release Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-016.md">Part 016 — Autoscaling: HPA, VPA, Node Autoscaling, and KEDA Concepts ➡️</a>
</div>
