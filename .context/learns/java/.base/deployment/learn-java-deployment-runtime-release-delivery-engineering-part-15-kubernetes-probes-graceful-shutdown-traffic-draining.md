# Learn Java Deployment Runtime Release Delivery Engineering

## Part 15 — Kubernetes Probes, Graceful Shutdown, and Traffic Draining

> Seri: `learn-java-deployment-runtime-release-delivery-engineering`  
> Bagian: `15 / 35`  
> Fokus: membuat aplikasi Java di Kubernetes bisa **masuk traffic dengan aman**, **keluar traffic tanpa membunuh request**, dan **mati tanpa merusak state**.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas Kubernetes deployment untuk aplikasi Java secara umum: `Deployment`, `Pod`, `Service`, `ConfigMap`, `Secret`, `resource request/limit`, rollout, scheduling, dan lifecycle dasar.

Bagian ini memperbesar satu area yang sering menjadi penyebab incident production:

> aplikasi berhasil di-deploy, container `Running`, tetapi request gagal, request hilang saat rolling update, transaksi setengah jalan, consumer memproses duplicate message, atau pod dibunuh sebelum sempat shutdown dengan benar.

Di banyak sistem Java enterprise, failure saat deployment bukan karena algoritma bisnis salah. Failure terjadi karena **lifecycle Kubernetes** dan **lifecycle Java application** tidak disejajarkan.

Bagian ini akan membangun mental model berikut:

```text
Kubernetes ingin tahu:
  - Apakah process sudah hidup?
  - Apakah process boleh menerima traffic?
  - Apakah process masih sehat?
  - Jika process dimatikan, berapa lama boleh diberi waktu?

Java application harus menjawab:
  - Kapan dependency sudah siap?
  - Kapan thread pool siap?
  - Kapan server socket sudah listen?
  - Kapan app benar-benar boleh menerima request?
  - Kapan app harus berhenti menerima request baru?
  - Kapan app selesai menguras in-flight work?
  - Kapan app aman exit?
```

Tujuan akhirnya: kamu bisa mendesain deployment Java yang bukan hanya `kubectl apply` sukses, tetapi:

1. startup tidak dianggap gagal secara keliru;
2. readiness tidak memberikan sinyal palsu;
3. liveness tidak membunuh pod yang sebenarnya masih bisa pulih;
4. rolling update tidak memutus request aktif;
5. shutdown tidak merusak transaksi, job, atau message processing;
6. rollback tidak menambah kerusakan;
7. semua timing bisa dijelaskan sebagai engineering decision, bukan angka random.

---

## 1. Problem Besar: Kubernetes Melihat Container, Bukan Niat Aplikasi

Kubernetes tidak otomatis tahu apakah aplikasi Java kamu benar-benar siap melayani business traffic.

Container `Running` hanya berarti process utama container sudah mulai berjalan. Itu tidak sama dengan:

- Spring context selesai start;
- servlet container sudah bind port;
- datasource sudah siap;
- Flyway/Liquibase selesai;
- cache warmed up;
- message listener sudah start;
- external dependency reachable;
- schema compatible;
- keystore/truststore valid;
- thread pool tidak penuh;
- aplikasi tidak sedang shutdown.

Begitu juga saat termination. Kubernetes bisa mengirim sinyal termination ke process, tetapi Kubernetes tidak tahu secara otomatis apakah:

- request HTTP masih berjalan;
- DB transaction masih terbuka;
- file sedang ditulis;
- RabbitMQ/Kafka message belum di-ack;
- scheduled job sedang berjalan;
- async executor masih memproses work;
- audit log belum flush;
- telemetry belum terkirim.

Maka probe dan graceful shutdown adalah jembatan kontrak antara orchestrator dan aplikasi.

---

## 2. Vocabulary yang Harus Dipisahkan

Banyak engineer mencampur istilah ini. Untuk deployment production, kita harus presisi.

### 2.1 Started

Aplikasi sudah mulai berjalan sebagai process.

Contoh:

```text
java -jar app.jar
```

PID muncul. Container status mungkin `Running`.

Tetapi aplikasi belum tentu siap menerima traffic.

---

### 2.2 Live

Aplikasi masih hidup dan tidak berada dalam kondisi fatal yang butuh restart.

Liveness menjawab:

> “Apakah process ini masih layak dipertahankan, atau harus dibunuh dan dibuat ulang?”

Liveness bukan pertanyaan:

> “Apakah database reachable?”

Jika liveness bergantung pada database, maka saat database outage, semua pod bisa dibunuh berulang-ulang, padahal restart tidak menyelesaikan masalah database.

---

### 2.3 Ready

Aplikasi boleh menerima traffic baru.

Readiness menjawab:

> “Apakah pod ini boleh masuk endpoint Service sekarang?”

Readiness boleh berubah-ubah selama lifecycle aplikasi:

- false saat startup;
- true saat siap melayani;
- false saat dependency kritikal unavailable;
- false saat overload;
- false saat shutdown/draining;
- true lagi jika pulih.

Readiness adalah routing decision.

---

### 2.4 Started Successfully

Startup probe menjawab:

> “Apakah aplikasi sudah berhasil melewati fase startup yang mungkin lama?”

Startup probe melindungi aplikasi lambat dari dibunuh oleh liveness terlalu cepat.

Contoh aplikasi Java yang butuh startup probe:

- monolith besar;
- Spring Boot dengan banyak bean;
- Hibernate entity scanning besar;
- cache warm-up;
- migration ringan saat startup;
- app server dengan deployment WAR/EAR;
- cold JVM tanpa CDS;
- container dengan CPU kecil;
- Java 8 legacy service dengan startup lambat.

---

### 2.5 Draining

Draining adalah fase transisi:

```text
masih hidup, tetapi tidak ingin menerima work baru
```

Selama draining:

- readiness harus false;
- request baru harus berhenti dialirkan;
- request lama diberi waktu selesai;
- consumer berhenti mengambil message baru;
- scheduled job tidak memulai run baru;
- executor menyelesaikan work yang sudah diterima;
- server menutup koneksi secara tertib.

---

### 2.6 Terminated

Process sudah keluar.

Termination yang baik adalah:

```text
readiness false -> traffic berhenti -> work drain -> resources close -> process exit 0
```

Termination buruk adalah:

```text
SIGTERM -> tidak ditangani -> grace period habis -> SIGKILL -> work hilang
```

---

## 3. Lifecycle Ideal Aplikasi Java di Kubernetes

Lifecycle ideal bukan:

```text
start -> ready -> kill
```

Lifecycle ideal adalah:

```text
[1] image pulled
[2] container process starts
[3] JVM starts
[4] application bootstrap begins
[5] startup probe eventually succeeds
[6] readiness becomes true
[7] traffic flows
[8] rollout/scale-down/node drain begins
[9] readiness becomes false
[10] Kubernetes removes pod from Service endpoints
[11] app drains in-flight work
[12] app closes resources
[13] JVM exits before grace period expires
```

Visual:

```text
Time ───────────────────────────────────────────────────────────>

Container:  Created | Running --------------------------------| Exited
JVM:                  start ---- bootstrap ---- serve ---- drain | stop
Startup:              fail fail fail success
Readiness:            false ---------- true ---------- false
Liveness:             true  ------------------------------ true/ignored
Traffic:              none  ---------- yes ---------- stop-new
Work:                 none  ---------- active ------- in-flight-only
Signal:                                             SIGTERM
Kill:                                                       only if timeout
```

Deployment engineering adalah memastikan transisi antar state ini eksplisit.

---

## 4. Tiga Probe Kubernetes: Startup, Readiness, Liveness

Kubernetes menyediakan tiga jenis probe utama:

1. `startupProbe`
2. `readinessProbe`
3. `livenessProbe`

Masing-masing punya makna yang berbeda.

---

## 5. Startup Probe

### 5.1 Fungsi Startup Probe

Startup probe digunakan untuk aplikasi yang startup-nya bisa lama. Selama startup probe belum sukses, Kubernetes tidak menjalankan liveness/readiness dengan cara normal untuk membunuh app terlalu cepat.

Mental model:

```text
startupProbe = grace window untuk bootstrap
```

Bukan:

```text
startupProbe = health check production biasa
```

---

### 5.2 Kapan Startup Probe Diperlukan?

Gunakan startup probe jika startup time bisa melewati toleransi liveness normal.

Contoh:

- cold start 60–180 detik;
- Spring Boot monolith besar;
- app server deploy banyak WAR;
- Hibernate scanning besar;
- loading rule engine;
- initialization cache;
- first classloading berat;
- JVM pada CPU limit kecil;
- pod sering startup lambat saat node resource pressure;
- Java 8 service tanpa optimasi container modern;
- Java 21/25 service dengan banyak framework reflection/proxy.

---

### 5.3 Anti-Pattern Startup Probe

Anti-pattern:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health
    port: 8080
  failureThreshold: 3
  periodSeconds: 10
```

Jika aplikasi butuh 90 detik startup, config di atas hanya memberi 30 detik. Kubernetes akan membunuhnya sebelum siap.

Lebih realistis:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 60
  timeoutSeconds: 2
```

Total startup budget kira-kira:

```text
initialDelaySeconds + periodSeconds * failureThreshold
= 10 + 5 * 60
= 310 detik
```

Ini bukan berarti app harus startup 310 detik. Ini berarti Kubernetes memberi maksimum sekitar 310 detik sebelum menganggap startup gagal.

---

### 5.4 Endpoint Startup Seharusnya Mengecek Apa?

Startup probe sebaiknya mengecek apakah application process sudah melewati bootstrap minimal.

Untuk Spring Boot, sering memakai:

```text
/actuator/health/liveness
```

atau endpoint ringan khusus:

```text
/internal/startup
```

Startup probe tidak perlu mengecek semua dependency external secara berat. Jika dependency external lambat, kamu tidak ingin app dibunuh terus-menerus hanya karena dependency belum siap, kecuali dependency itu mutlak diperlukan untuk bootstrap.

---

## 6. Readiness Probe

### 6.1 Fungsi Readiness Probe

Readiness menentukan apakah pod boleh menerima traffic melalui Service.

Jika readiness false, pod tidak dianggap endpoint yang siap untuk menerima request baru.

Mental model:

```text
readinessProbe = traffic admission control
```

Readiness harus menjawab:

> “Jika request baru dikirim ke pod ini sekarang, apakah kemungkinan besar bisa dilayani dengan benar?”

---

### 6.2 Readiness Bukan Liveness

Readiness boleh false tanpa harus restart.

Contoh readiness false yang tidak perlu restart:

- database sementara unavailable;
- downstream API sedang outage;
- circuit breaker open;
- connection pool exhausted sementara;
- application overload;
- app sedang draining;
- config reload belum selesai;
- pod sedang warm-up;
- migration compatibility belum valid;
- dependency token belum tersedia.

Jika liveness ikut false untuk semua kondisi di atas, pod bisa restart loop, memperburuk incident.

---

### 6.3 Apa yang Harus Masuk Readiness?

Readiness harus mengecek dependency yang benar-benar dibutuhkan untuk melayani request utama.

Kategori:

```text
Hard readiness dependencies:
  - database utama untuk request sync
  - local server socket
  - critical config loaded
  - required secret/certificate loaded
  - migration state compatible
  - critical downstream if every request depends on it

Soft readiness dependencies:
  - optional search index
  - analytics sink
  - email provider
  - report generator
  - async notification channel
  - non-critical cache
```

Hard dependency boleh membuat readiness false.
Soft dependency sebaiknya tidak otomatis membuat readiness false jika aplikasi masih bisa degrade gracefully.

---

### 6.4 Readiness dan Overload

Readiness bisa dipakai sebagai sinyal overload, tetapi hati-hati.

Jika semua pod overload lalu semua readiness false, service bisa kehilangan semua endpoint.

Pattern yang lebih aman:

- readiness false hanya jika pod benar-benar tidak bisa menerima request baru;
- gunakan rate limiting, bulkhead, queue bound, dan backpressure untuk overload biasa;
- gunakan HPA untuk scale jika workload horizontal-scalable;
- gunakan circuit breaker untuk downstream outage;
- jangan menjadikan readiness sebagai satu-satunya overload control.

---

### 6.5 Readiness Saat Shutdown

Saat aplikasi menerima termination signal, readiness harus menjadi false sesegera mungkin.

Tujuannya:

```text
stop new traffic before shutting down server resources
```

Urutan ideal:

```text
SIGTERM received
  -> app marks readiness false
  -> Kubernetes/load balancer stops sending new traffic
  -> app waits for in-flight requests
  -> app stops consumers/schedulers
  -> app closes DB/cache/client resources
  -> app exits
```

---

## 7. Liveness Probe

### 7.1 Fungsi Liveness Probe

Liveness menentukan apakah container harus direstart.

Mental model:

```text
livenessProbe = last-resort self-healing trigger
```

Liveness harus conservative.

Liveness false berarti:

> “Restart process ini kemungkinan membantu.”

Jika restart tidak membantu, jangan taruh kondisi itu di liveness.

---

### 7.2 Apa yang Cocok Masuk Liveness?

Cocok:

- event loop/server thread fatal stuck;
- deadlock fatal yang bisa dideteksi;
- app internal state corrupt;
- health endpoint internal tidak bisa merespons sama sekali;
- JVM masih hidup tetapi app framework tidak bisa progress;
- application self-check fatal.

Tidak cocok:

- database down;
- Redis down;
- downstream service down;
- third-party API timeout;
- message broker outage;
- disk temporary slow;
- CPU throttling sementara;
- external DNS issue;
- network partition sementara.

Mengapa? Karena restart pod tidak memperbaiki database/downstream. Bahkan bisa memperbesar load.

---

### 7.3 Liveness Anti-Pattern yang Sangat Umum

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health
    port: 8080
```

Jika `/actuator/health` mencakup DB, Redis, broker, disk, downstream, maka liveness akan false saat dependency external bermasalah. Kubernetes lalu restart semua pod.

Akibatnya:

- connection storm ke DB setelah restart;
- cache warm-up storm;
- startup storm;
- rollout makin lambat;
- incident makin parah;
- root cause tertutup oleh restart noise.

Lebih baik:

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
  timeoutSeconds: 2
```

Dan readiness:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  failureThreshold: 2
  timeoutSeconds: 2
```

---

## 8. Probe Timing: Cara Menghitung, Bukan Menebak

Probe punya parameter umum:

```yaml
initialDelaySeconds
periodSeconds
timeoutSeconds
failureThreshold
successThreshold
```

Kamu harus bisa menghitung dampaknya.

---

### 8.1 Failure Detection Time

Secara sederhana:

```text
failure detection time ≈ timeoutSeconds/failure + periodSeconds * failureThreshold
```

Contoh:

```yaml
periodSeconds: 10
failureThreshold: 3
timeoutSeconds: 2
```

Failure terdeteksi setelah kira-kira 30 detik plus timeout behavior.

Jika request timeout business adalah 5 detik, readiness failure 30 detik mungkin terlalu lama untuk menghentikan traffic ke pod buruk.

---

### 8.2 Recovery Detection Time

Recovery detection bergantung pada:

```yaml
successThreshold
periodSeconds
```

Jika readiness butuh dua sukses berturut-turut:

```yaml
successThreshold: 2
periodSeconds: 5
```

Pod butuh sekitar 10 detik untuk dianggap ready lagi setelah pulih.

---

### 8.3 Startup Budget

Startup budget:

```text
startup budget ≈ initialDelaySeconds + periodSeconds * failureThreshold
```

Contoh:

```yaml
startupProbe:
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 60
```

Budget sekitar 310 detik.

Gunakan data nyata:

- p50 startup;
- p95 startup;
- p99 startup;
- startup under CPU limit;
- startup after node scale-up;
- startup after cold image pull;
- startup with DB slow;
- startup during traffic spike.

Jangan gunakan angka dari laptop developer.

---

## 9. Probe Endpoint Design untuk Java

### 9.1 Jangan Membuat Probe Mahal

Probe berjalan terus-menerus. Jika setiap probe melakukan query DB berat, maka probe menjadi workload tambahan.

Anti-pattern:

```java
@GetMapping("/health")
public Health health() {
    jdbcTemplate.queryForObject("select count(*) from huge_table", Long.class);
    redisTemplate.keys("*");
    callExternalPartner();
    return Health.up().build();
}
```

Masalah:

- health check membebani DB;
- timeout external membuat readiness flapping;
- probe menjadi sumber incident;
- saat load tinggi, probe berebut resource dengan request nyata.

Lebih baik:

- DB check ringan seperti `SELECT 1` atau pool validation;
- cache check ringan;
- no heavy count;
- no full scan;
- no synchronous call ke dependency optional;
- timeout kecil;
- cache result health dependency selama beberapa detik jika perlu.

---

### 9.2 Pisahkan Endpoint Internal dan Public

Probe endpoint harus internal.

Contoh path:

```text
/internal/health/live
/internal/health/ready
/internal/health/startup
```

Atau Spring Boot:

```text
/actuator/health/liveness
/actuator/health/readiness
```

Pastikan endpoint tidak mengekspos detail sensitif.

Buruk:

```json
{
  "dbPassword": "...",
  "jdbcUrl": "jdbc:oracle:thin:@prod-db...",
  "redisToken": "...",
  "stackTrace": "..."
}
```

Baik:

```json
{
  "status": "UP"
}
```

Detail dependency boleh ada di endpoint admin internal yang terlindungi, bukan di probe terbuka.

---

### 9.3 Probe Harus Punya Timeout Internal

Jika readiness mengecek DB, jangan biarkan DB call menggantung lebih lama dari `timeoutSeconds`.

Contoh prinsip:

```text
probe timeoutSeconds = 2s
DB health query timeout <= 1s
external health timeout <= 500ms
```

Kalau internal timeout lebih lama dari Kubernetes timeout, request health bisa menumpuk di server.

---

## 10. Spring Boot Availability State

Spring Boot modern menyediakan konsep availability:

- liveness state;
- readiness state.

Dengan Actuator, aplikasi bisa mengekspos endpoint health group untuk Kubernetes.

Contoh konfigurasi umum:

```yaml
management:
  endpoint:
    health:
      probes:
        enabled: true
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
```

Endpoint yang umum:

```text
/actuator/health/liveness
/actuator/health/readiness
```

Mental model penting:

```text
liveness = apakah app internal hidup
readiness = apakah app siap menerima traffic
```

Jangan memasukkan semua dependency ke liveness.

---

## 11. Graceful Shutdown: Apa yang Sebenarnya Harus Terjadi?

Graceful shutdown bukan sekadar “app menerima SIGTERM”.

Graceful shutdown adalah urutan operasi yang memastikan work tidak rusak.

Urutan ideal aplikasi Java HTTP:

```text
1. menerima SIGTERM
2. readiness menjadi false
3. berhenti menerima request baru
4. menunggu request aktif selesai
5. menolak/menutup keep-alive baru
6. menghentikan scheduled tasks
7. menghentikan message consumers
8. menunggu async executor selesai atau timeout
9. flush logs/metrics/traces
10. close DB pool/cache/client resources
11. exit dengan status jelas
```

---

## 12. Kubernetes Termination Lifecycle

Saat pod diterminasi karena rollout, scale-down, eviction, atau node drain, Kubernetes akan menjalankan termination lifecycle.

Secara praktis:

```text
pod marked Terminating
  -> endpoint removal mulai terjadi
  -> preStop hook dieksekusi jika ada
  -> TERM signal dikirim ke container process
  -> kubelet menunggu terminationGracePeriodSeconds
  -> jika process belum exit, SIGKILL dikirim
```

Hal penting:

- `terminationGracePeriodSeconds` adalah total budget;
- `preStop` memakai budget yang sama;
- jika `preStop` terlalu lama, waktu aplikasi untuk shutdown berkurang;
- setelah grace period habis, process bisa dibunuh paksa;
- SIGKILL tidak bisa ditangani aplikasi.

---

## 13. `terminationGracePeriodSeconds`: Bukan Angka Default yang Aman untuk Semua

Default Kubernetes sering 30 detik. Untuk beberapa aplikasi cukup. Untuk banyak aplikasi Java enterprise, belum tentu.

Pertanyaan sizing:

```text
Berapa lama request p99 berjalan?
Berapa lama transaksi DB p99 berjalan?
Berapa lama message processing p99 berjalan?
Berapa lama scheduler job bisa berjalan?
Berapa lama async executor butuh drain?
Berapa lama telemetry flush?
Berapa lama server shutdown?
Berapa lama preStop?
```

Formula praktis:

```text
terminationGracePeriodSeconds >=
  LB propagation delay
+ readiness drain delay
+ max acceptable in-flight request time
+ message/job drain budget
+ resource close/flush budget
+ safety margin
```

Contoh:

```text
LB propagation delay:              10s
in-flight HTTP request budget:     30s
message consumer drain:            20s
resource close/flush:               5s
safety margin:                     10s
---------------------------------------
recommended grace:                 75s
```

Maka:

```yaml
terminationGracePeriodSeconds: 75
```

---

## 14. `preStop`: Kapan Dipakai dan Kapan Berbahaya

`preStop` sering dipakai untuk memberi delay agar endpoint removal sempat propagate sebelum aplikasi benar-benar shutdown.

Contoh:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
```

Tujuan:

```text
biarkan Kubernetes/Service/LB berhenti mengirim traffic baru sebelum app close socket
```

Tetapi `preStop` bukan solusi ajaib.

Risiko:

- menghabiskan grace period;
- memperlambat rollout;
- jika terlalu lama, app tidak punya waktu drain;
- shell command bisa gagal jika image distroless tidak punya `/bin/sh`;
- sleep statis tidak memahami kondisi app;
- sleep terlalu pendek di cluster tertentu;
- sleep terlalu panjang di cluster kecil memperlama deployment.

Lebih baik jika aplikasi sendiri bisa:

- mark readiness false saat SIGTERM;
- stop accepting new work;
- drain in-flight work.

`preStop sleep` bisa menjadi tambahan defensif, bukan satu-satunya graceful shutdown strategy.

---

## 15. Traffic Draining: Masalah yang Tidak Selesai Hanya dengan Readiness

Ketika readiness false, Kubernetes mulai menghapus pod dari endpoint Service. Tetapi ada propagation delay:

- kubelet update status;
- endpoint controller update EndpointSlice;
- kube-proxy/iptables/ipvs update;
- ingress controller update upstream;
- cloud load balancer update target;
- client keep-alive connection mungkin masih terbuka;
- service mesh sidecar mungkin punya drain behavior sendiri.

Maka readiness false tidak berarti traffic berhenti **instan**.

Mental model:

```text
readiness false = stop routing intent
not equal to immediate zero new request
```

Karena itu app harus tetap bisa melayani request selama beberapa detik setelah termination dimulai, atau minimal menolak dengan cara yang terkendali.

---

## 16. HTTP Server Graceful Shutdown di Java

### 16.1 Spring Boot

Spring Boot mendukung graceful shutdown untuk embedded web server.

Konfigurasi umum:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Makna:

- server berhenti menerima request baru;
- request aktif diberi waktu selesai;
- application context shutdown mengikuti lifecycle phase;
- setelah timeout, shutdown dipaksa lanjut.

Untuk Kubernetes, kombinasikan dengan:

```yaml
terminationGracePeriodSeconds: 60
```

Dan readiness endpoint yang false saat shutdown.

---

### 16.2 Tomcat Embedded

Tomcat embedded di Spring Boot dapat graceful shutdown melalui Spring lifecycle.

Hal yang perlu diperhatikan:

- keep-alive connection;
- connector thread pool;
- max request duration;
- async servlet request;
- long polling/SSE;
- upload/download besar;
- request timeout;
- executor shutdown timeout.

Jika app punya endpoint long-running, shutdown timeout harus disesuaikan atau endpoint harus didesain cancelable/resumable.

---

### 16.3 Jetty/Undertow

Jetty dan Undertow juga punya behavior shutdown masing-masing.

Prinsip tetap sama:

```text
stop accepting new requests
wait for active exchanges
close resources
exit before SIGKILL
```

Jangan asumsikan semua embedded server punya semantics identik.

---

## 17. Request In-Flight: Apa yang Harus Dilindungi?

In-flight request adalah request yang sudah diterima app tetapi belum selesai.

Risiko jika pod dibunuh paksa:

- HTTP client menerima connection reset;
- DB transaction rollback tanpa response jelas;
- external API sudah terpanggil tetapi internal state belum commit;
- duplicate retry dari client;
- audit trail hilang;
- file upload korup;
- partial side effect;
- user melihat status ambigu.

Untuk request yang idempotent, retry mungkin aman. Untuk request non-idempotent, shutdown buruk bisa menimbulkan data inconsistency.

---

## 18. Idempotency Adalah Safety Net Deployment

Graceful shutdown mengurangi risiko, tetapi tidak menghilangkan semua risiko.

Karena itu endpoint mutasi penting harus didesain idempotent atau punya deduplication key.

Contoh:

```http
POST /payments
Idempotency-Key: 2c6b1f5a-...
```

Atau dalam enterprise workflow:

```text
caseActionRequestId
submissionReferenceNo
operationCorrelationId
```

Kenapa ini deployment topic?

Karena saat rolling update:

```text
client sends request
pod begins processing
SIGTERM occurs
client times out
client retries to another pod
```

Tanpa idempotency, action bisa double-submit.

---

## 19. Database Transaction Boundary Saat Shutdown

Saat SIGTERM terjadi, aplikasi bisa sedang berada di tengah transaction.

Prinsip:

1. jangan mulai transaksi baru setelah draining dimulai;
2. transaksi yang sudah berjalan diberi waktu selesai;
3. jika timeout, rollback lebih baik daripada commit ambigu;
4. request mutasi harus idempotent;
5. audit/event publishing harus konsisten dengan commit.

Anti-pattern:

```text
SIGTERM -> close datasource immediately -> active transaction gagal acak
```

Lebih baik:

```text
SIGTERM -> readiness false -> stop request intake -> wait active tx -> close datasource
```

---

## 20. Async Executor Drain

Banyak aplikasi Java memakai async executor:

- `@Async`;
- `CompletableFuture`;
- custom `ExecutorService`;
- scheduler;
- event listener async;
- background cleanup;
- file processing;
- notification sending.

Saat shutdown, executor harus diberi policy jelas:

```text
Apakah menerima task baru? Tidak.
Apakah task aktif diselesaikan? Ya, sampai timeout.
Apakah queue task lama dibuang? Tergantung criticality.
Apakah task bisa di-retry setelah restart? Harus jelas.
```

Contoh pola Java:

```java
executor.shutdown();
if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
    executor.shutdownNow();
}
```

Tetapi untuk production, ini harus dilengkapi observability:

- active task count;
- queue depth;
- shutdown timeout;
- dropped task count;
- last task duration.

---

## 21. Message Consumer Drain: Kafka, RabbitMQ, JMS

HTTP draining berbeda dengan message consumer draining.

Untuk consumer, readiness false saja tidak otomatis menghentikan konsumsi message. Aplikasi harus menghentikan listener/container/consumer.

---

### 21.1 Prinsip Consumer Shutdown

Urutan ideal:

```text
SIGTERM received
  -> readiness false
  -> stop polling/consuming new messages
  -> finish processing current message/batch
  -> commit offset / ack message only after successful processing
  -> close consumer
  -> exit
```

---

### 21.2 Kafka

Kafka consumer harus memperhatikan:

- `poll()` loop;
- max poll interval;
- offset commit;
- rebalance;
- batch processing;
- exactly-once semantics jika digunakan;
- idempotent processing;
- duplicate handling.

Shutdown buruk:

```text
message processed side effect -> pod killed before offset commit -> message reprocessed
```

Maka consumer logic harus idempotent.

---

### 21.3 RabbitMQ/JMS

Untuk RabbitMQ/JMS:

- ack setelah processing sukses;
- jangan auto-ack untuk critical command;
- stop listener container saat drain;
- set prefetch yang masuk akal;
- unacked message akan redeliver jika consumer mati;
- processing harus idempotent.

Shutdown buruk:

```text
consumer prefetch 1000
SIGTERM
pod punya 1000 unacked messages
shutdown timeout 30s
SIGKILL
mass redelivery storm
```

Mitigasi:

- prefetch lebih kecil;
- listener stop on shutdown;
- drain budget sesuai max processing;
- idempotent handler;
- DLQ policy jelas.

---

## 22. Scheduled Job dan Cron-Like Workload

Aplikasi Java sering punya scheduler internal:

- Spring `@Scheduled`;
- Quartz;
- custom cron thread;
- cleanup job;
- report generation;
- retry job;
- reconciliation job.

Problem saat rolling update:

```text
old pod masih running job
new pod juga mulai job
hasil double execution
```

Shutdown bukan satu-satunya masalah. Startup juga bisa menyebabkan duplicate scheduler.

Pattern:

1. gunakan Kubernetes CronJob untuk job yang benar-benar scheduled eksternal;
2. gunakan leader election jika scheduler ada di app replica;
3. gunakan distributed lock dengan expiry;
4. job harus idempotent;
5. saat shutdown, jangan mulai run baru;
6. active run diberi timeout drain;
7. status job disimpan durable.

---

## 23. Long-Running Request: Upload, Download, Report, SSE, WebSocket

Graceful shutdown lebih sulit untuk request panjang.

Contoh:

- report download 2 menit;
- upload file besar;
- WebSocket;
- Server-Sent Events;
- long polling;
- streaming response;
- batch trigger via HTTP.

Jika `terminationGracePeriodSeconds` 30 detik, request 2 menit tidak akan selesai.

Pilihan desain:

1. ubah menjadi async job + polling status;
2. simpan progress durable;
3. gunakan resumable upload/download;
4. set max request duration realistis;
5. route long-lived connection ke workload khusus;
6. drain WebSocket dengan close frame terkontrol;
7. jangan campur long-running endpoint dengan service yang sering rolling update jika tidak siap.

---

## 24. Probe dan Service Mesh / Ingress / Load Balancer

Jika memakai ingress controller atau service mesh, traffic draining punya lapisan tambahan.

Lapisan umum:

```text
Client
  -> Cloud Load Balancer
  -> Ingress Controller
  -> Service Mesh Proxy / Sidecar
  -> Kubernetes Service
  -> Pod IP
  -> Java Server
```

Masing-masing bisa punya:

- endpoint cache;
- keep-alive;
- connection pool;
- drain timeout;
- outlier detection;
- retry policy;
- circuit breaker;
- connection termination behavior.

Konsekuensi:

```text
readiness false at pod level does not instantly close all upstream connections
```

Saat memakai Envoy/Istio/Linkerd/Nginx/ALB, sesuaikan:

- drain timeout;
- idle timeout;
- request timeout;
- connection keep-alive;
- deregistration delay;
- retry behavior;
- max connection age.

---

## 25. Rolling Update Timing

Rolling update menyentuh beberapa angka:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Probe dan shutdown menentukan apakah rolling update aman.

Jika readiness terlalu cepat true:

```text
new pod receives traffic before ready -> errors
```

Jika readiness terlalu lambat true:

```text
rollout slow -> capacity lower longer
```

Jika termination grace terlalu pendek:

```text
old pod killed while handling request -> errors
```

Jika preStop terlalu panjang:

```text
rollout slow, old pod capacity held too long
```

Jika maxUnavailable > 0 pada service capacity tipis:

```text
deployment itself causes overload
```

---

## 26. Deployment Availability Budget

Untuk service kritikal, hitung capacity saat rollout.

Contoh:

```text
replicas: 4
maxUnavailable: 1
maxSurge: 1
per-pod safe capacity: 100 RPS
normal traffic: 320 RPS
```

Saat rollout, minimum ready pods bisa 3:

```text
3 * 100 = 300 RPS
```

Tapi traffic 320 RPS. Maka rollout bisa menyebabkan overload.

Lebih aman:

```yaml
maxUnavailable: 0
maxSurge: 1
```

Atau tambah replica sebelum rollout.

Untuk Java, startup CPU/memory juga harus dihitung. New pod startup bisa consume CPU besar, membuat existing pods terganggu jika node padat.

---

## 27. Readiness Gates dan Custom Conditions

Untuk kasus advance, Kubernetes punya readiness gates yang bisa menggabungkan readiness dengan custom Pod conditions.

Ini berguna jika readiness bukan hanya aplikasi internal, tetapi juga dependency eksternal seperti:

- sidecar ready;
- service mesh injected and synced;
- external load balancer target registered;
- warm-up controller finished;
- custom operator condition.

Namun gunakan hati-hati. Readiness gate menambah kompleksitas rollout.

---

## 28. Probe Type: HTTP, TCP, Exec, gRPC

Kubernetes mendukung beberapa mekanisme probe.

### 28.1 HTTP Probe

Paling umum untuk Java web service.

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
```

Kelebihan:

- semantic;
- bisa membedakan liveness/readiness;
- mudah observasi;
- cocok untuk Spring Boot/JAX-RS.

Kekurangan:

- butuh server HTTP siap;
- bisa ikut terkena thread pool starvation;
- endpoint harus aman.

---

### 28.2 TCP Probe

Mengecek port terbuka.

```yaml
tcpSocket:
  port: 8080
```

Kelebihan:

- sederhana;
- cocok untuk service non-HTTP.

Kekurangan:

- port terbuka tidak berarti aplikasi siap;
- tidak tahu dependency;
- sering menghasilkan false readiness.

---

### 28.3 Exec Probe

Menjalankan command di container.

```yaml
exec:
  command: ["/bin/sh", "-c", "test -f /tmp/ready"]
```

Kelebihan:

- cocok untuk proses non-HTTP;
- bisa cek file/signal lokal.

Kekurangan:

- butuh shell/tool di image;
- tidak cocok untuk distroless minimal;
- command mahal bisa membebani;
- security surface lebih besar.

---

### 28.4 gRPC Probe

Untuk service gRPC, gunakan gRPC health checking jika sesuai.

Kelebihan:

- cocok untuk gRPC-native service;
- semantic lebih baik daripada TCP.

Kekurangan:

- harus implement health protocol;
- dependency framework;
- pastikan timeout dan service name benar.

---

## 29. Probe Failure Mode Catalog

### 29.1 False Positive Readiness

Pod dianggap ready padahal belum siap.

Penyebab:

- readiness hanya TCP port;
- app bind port sebelum initialization selesai;
- health endpoint tidak cek critical config;
- dependency lazy failure baru terjadi di request pertama;
- cache belum warm untuk request wajib;
- schema mismatch tidak dicek.

Dampak:

- request awal gagal setelah rollout;
- canary terlihat buruk;
- rolling update menyebarkan versi rusak.

---

### 29.2 False Negative Readiness

Pod dianggap not ready padahal sebenarnya bisa serve.

Penyebab:

- readiness terlalu banyak dependency optional;
- health endpoint timeout terlalu agresif;
- DB health check berat;
- temporary network blip;
- probe berebut thread dengan request;
- GC pause pendek dianggap failure.

Dampak:

- traffic terkonsentrasi ke pod lain;
- cascading overload;
- rollout stuck;
- autoscaling salah membaca capacity.

---

### 29.3 Liveness Restart Storm

Semua pod restart karena liveness dependency external.

Penyebab:

- liveness cek DB/downstream;
- timeout terlalu pendek;
- failureThreshold terlalu kecil;
- startup lambat tanpa startupProbe;
- CPU throttling membuat probe timeout.

Dampak:

- outage makin parah;
- DB connection storm;
- logs penuh restart noise;
- root cause sulit ditemukan.

---

### 29.4 Probe Thread Starvation

Health endpoint gagal karena server thread pool penuh.

Ini tricky. Jika semua worker thread sibuk, health endpoint tidak mendapat thread untuk menjawab.

Interpretasi:

- Untuk readiness, mungkin masuk akal false karena app overload.
- Untuk liveness, hati-hati: restart bisa membantu jika stuck, tapi bisa memperburuk jika load external tetap tinggi.

Mitigasi:

- dedicated management port/thread pool jika framework mendukung;
- rate limit request;
- bounded queues;
- bulkhead;
- overload shedding;
- realistic timeout.

---

### 29.5 Shutdown Race

Pod masih menerima request setelah mulai shutdown.

Penyebab:

- readiness tidak false saat shutdown;
- LB endpoint propagation delay;
- keep-alive connection;
- preStop tidak ada atau terlalu pendek;
- app langsung close server;
- terminationGracePeriod terlalu pendek.

Dampak:

- connection reset;
- partial transaction;
- user error saat deployment;
- duplicate retry.

---

## 30. Reference Kubernetes Manifest untuk Spring Boot Java Service

Contoh baseline yang lebih aman:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: case-service
  template:
    metadata:
      labels:
        app: case-service
    spec:
      terminationGracePeriodSeconds: 75
      containers:
        - name: app
          image: registry.example.com/case-service:1.42.0
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:+ExitOnOutOfMemoryError
                -XX:ErrorFile=/tmp/hs_err_pid%p.log
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 60
            timeoutSeconds: 2
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 5
            failureThreshold: 2
            successThreshold: 1
            timeoutSeconds: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
            failureThreshold: 3
            timeoutSeconds: 2
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
```

Catatan:

- `maxUnavailable: 0` menjaga capacity selama rollout;
- `startupProbe` memberi waktu startup panjang;
- readiness dan liveness dipisah;
- `terminationGracePeriodSeconds` lebih besar dari shutdown budget;
- `preStop sleep` dipakai defensif, tetapi harus disesuaikan image;
- distroless image tidak punya `/bin/sh`, jadi preStop exec seperti ini tidak cocok;
- Spring Boot graceful shutdown harus diaktifkan di config aplikasi.

---

## 31. Spring Boot Config Baseline

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s

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
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
```

Jika ingin memisahkan management port:

```yaml
management:
  server:
    port: 8081
```

Lalu probe Kubernetes diarahkan ke port management.

Trade-off:

- management port dedicated bisa lebih reliable;
- tetapi perlu NetworkPolicy/security tambahan;
- pastikan port tidak terekspos public.

---

## 32. Application-Level Shutdown Hook

Java mendukung shutdown hook:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    // cleanup
}));
```

Namun dalam framework seperti Spring Boot, lebih baik gunakan lifecycle abstraction:

- `SmartLifecycle`;
- `DisposableBean`;
- `@PreDestroy`;
- listener availability state;
- graceful shutdown config;
- listener container lifecycle untuk messaging.

Shutdown hook mentah berisiko:

- ordering sulit;
- timeout tidak jelas;
- blocking terlalu lama;
- tidak terintegrasi dengan Spring context;
- sulit diobservasi.

---

## 33. Designing Readiness State Manually

Kadang readiness perlu custom state.

Contoh:

```java
@Component
public class DrainState {
    private final AtomicBoolean draining = new AtomicBoolean(false);

    public void startDraining() {
        draining.set(true);
    }

    public boolean isDraining() {
        return draining.get();
    }
}
```

Readiness health indicator:

```java
@Component
public class CustomReadinessIndicator implements HealthIndicator {
    private final DrainState drainState;
    private final CriticalDependencyChecker dependencyChecker;

    public CustomReadinessIndicator(
            DrainState drainState,
            CriticalDependencyChecker dependencyChecker) {
        this.drainState = drainState;
        this.dependencyChecker = dependencyChecker;
    }

    @Override
    public Health health() {
        if (drainState.isDraining()) {
            return Health.down().withDetail("reason", "draining").build();
        }

        if (!dependencyChecker.isReady()) {
            return Health.down().withDetail("reason", "critical_dependency_unavailable").build();
        }

        return Health.up().build();
    }
}
```

Saat shutdown event:

```java
@Component
public class ShutdownDrainListener {
    private final DrainState drainState;

    public ShutdownDrainListener(DrainState drainState) {
        this.drainState = drainState;
    }

    @PreDestroy
    public void onDestroy() {
        drainState.startDraining();
    }
}
```

Catatan: `@PreDestroy` mungkin terjadi ketika context sudah mulai shutdown. Untuk readiness false lebih awal, gunakan mekanisme framework availability/lifecycle yang sesuai.

---

## 34. Stop Accepting New Work

Saat draining, aplikasi harus menolak work baru.

Untuk HTTP:

- readiness false;
- server graceful shutdown;
- optional request filter yang mengembalikan `503 Retry-After` untuk request baru jika draining.

Contoh filter konseptual:

```java
@Component
public class DrainingFilter extends OncePerRequestFilter {
    private final DrainState drainState;

    public DrainingFilter(DrainState drainState) {
        this.drainState = drainState;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        if (drainState.isDraining() && isBusinessRequest(request)) {
            response.setStatus(503);
            response.setHeader("Retry-After", "10");
            return;
        }

        filterChain.doFilter(request, response);
    }

    private boolean isBusinessRequest(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/actuator");
    }
}
```

Tetapi filter ini harus hati-hati. Jangan sampai menolak request in-flight yang sudah masuk sebelum draining.

---

## 35. Observability Saat Startup dan Shutdown

Tanpa observability, graceful shutdown hanya asumsi.

Log yang wajib ada:

```text
application startup started
application startup completed
readiness changed to ACCEPTING_TRAFFIC
SIGTERM received
readiness changed to REFUSING_TRAFFIC / DRAINING
http server graceful shutdown started
active requests count
message consumers stopped accepting new messages
async executor shutdown started
async executor completed / timed out
resources closed
application shutdown completed
```

Metric yang berguna:

```text
app_startup_duration_seconds
app_readiness_state
app_liveness_state
app_shutdown_duration_seconds
app_active_http_requests
app_active_message_handlers
app_executor_active_threads
app_executor_queue_size
app_shutdown_forced_total
app_draining_rejected_requests_total
```

Trace/log correlation:

- request id;
- deployment version;
- pod name;
- container id;
- Git SHA;
- rollout id;
- termination reason.

---

## 36. Post-Deployment Verification

Setelah rollout, verifikasi bukan hanya `kubectl rollout status`.

Checklist:

```text
[ ] All new pods Ready
[ ] No liveness restart during rollout
[ ] Startup duration within expected p95
[ ] Readiness transition normal
[ ] No spike 5xx
[ ] No connection reset spike
[ ] No DB connection storm
[ ] No message redelivery spike
[ ] No duplicate job execution
[ ] No OOMKilled
[ ] No CPU throttling severe
[ ] No probe timeout spike
[ ] Old pods terminated gracefully
[ ] Shutdown duration below grace period
[ ] Ingress/LB target health stable
```

---

## 37. Debugging Probe Issues

Command dasar:

```bash
kubectl get pods
kubectl describe pod <pod>
kubectl logs <pod> -c app
kubectl logs <pod> -c app --previous
kubectl get events --sort-by=.lastTimestamp
kubectl get endpointslice
kubectl rollout status deployment/<name>
kubectl rollout history deployment/<name>
```

Yang dicari:

```text
Readiness probe failed
Liveness probe failed
Startup probe failed
Killing container
Back-off restarting failed container
OOMKilled
Error: context deadline exceeded
connection refused
HTTP probe failed with statuscode: 503
```

Interpretasi:

- `connection refused`: server belum bind port atau sudah close;
- `timeout`: endpoint tidak responsif atau thread starvation;
- `500`: health endpoint error;
- `503 readiness`: mungkin draining atau dependency critical unavailable;
- repeated liveness failure: cek apakah liveness terlalu luas;
- startup failure: cek startup budget vs actual startup.

---

## 38. Probe Decision Matrix

| Kondisi | Startup | Readiness | Liveness | Restart? | Terima Traffic? |
|---|---:|---:|---:|---:|---:|
| JVM booting | false | false | not relevant | no | no |
| App bootstrap lama | false | false | suppressed by startup | no | no |
| App ready normal | true | true | true | no | yes |
| DB down sementara | true | false | true | no | no / degrade |
| Optional email provider down | true | true | true | no | yes |
| App internal deadlocked | true | false/timeout | false | yes | no |
| CPU overload sementara | true | maybe false | usually true | usually no | maybe |
| Shutdown draining | true | false | true | no | no new traffic |
| Fatal corrupt state | true | false | false | yes | no |

---

## 39. Top 1% Mental Model: Probes Are Control-Plane Signals

Engineer biasa melihat probe sebagai health check.

Engineer senior melihat probe sebagai control-plane signal.

```text
startupProbe controls bootstrap tolerance
readinessProbe controls traffic admission
livenessProbe controls restart decision
terminationGracePeriod controls shutdown budget
preStop controls termination ordering/delay
```

Jika sinyal salah, control plane mengambil keputusan salah.

Sinyal salah menghasilkan:

- traffic ke pod yang belum siap;
- pod sehat dibunuh;
- pod rusak tetap menerima traffic;
- rollout stuck;
- connection reset saat shutdown;
- duplicate processing;
- cascading failure.

Maka probe design adalah bagian dari architecture, bukan YAML detail.

---

## 40. Practical Design Recipe

Untuk setiap Java service, jawab pertanyaan ini:

### Startup

```text
Berapa p95/p99 startup time di cluster?
Apakah startup bisa lambat karena DB/cache/dependency?
Apakah startup harus menunggu migration?
Apakah startup probe cukup besar?
```

### Readiness

```text
Apa dependency wajib untuk request utama?
Apa dependency optional?
Apakah readiness false saat draining?
Apakah readiness terlalu mahal?
Apakah readiness bisa flapping?
```

### Liveness

```text
Kondisi apa yang restart benar-benar bisa perbaiki?
Apakah liveness bebas dari dependency external?
Apakah timeout terlalu agresif?
Apakah startupProbe melindungi liveness?
```

### Shutdown

```text
Berapa request terlama yang boleh diselesaikan?
Apakah app stop menerima request baru?
Apakah consumer berhenti polling?
Apakah scheduler berhenti mulai job baru?
Apakah executor drain?
Apakah grace period cukup?
```

### Traffic

```text
Apakah ingress/LB punya deregistration delay?
Apakah keep-alive connection masih mengirim request?
Apakah service mesh punya drain timeout?
Apakah retry policy aman untuk non-idempotent endpoint?
```

### Data Safety

```text
Apakah mutation idempotent?
Apakah transaction boundary jelas?
Apakah message ack setelah commit?
Apakah duplicate processing aman?
```

---

## 41. Anti-Pattern Catalog

### Anti-Pattern 1 — One Endpoint for Everything

```text
/health checks app, DB, Redis, Kafka, email, disk, downstream,
and used for startup, readiness, liveness.
```

Masalah: semua sinyal tercampur.

---

### Anti-Pattern 2 — Liveness Checks Database

Saat DB outage, semua pod restart.

---

### Anti-Pattern 3 — Readiness Only Checks Port

Pod menerima traffic sebelum app benar-benar siap.

---

### Anti-Pattern 4 — No Startup Probe for Slow Java App

Liveness membunuh app saat masih bootstrap.

---

### Anti-Pattern 5 — Grace Period Default untuk Semua Service

Request 90 detik, grace 30 detik. Hasilnya SIGKILL.

---

### Anti-Pattern 6 — preStop Sleep Tanpa Menghitung Budget

Sleep 30 detik, grace 30 detik. App tidak punya waktu shutdown.

---

### Anti-Pattern 7 — Consumer Tetap Polling Saat Shutdown

Pod terus mengambil message baru saat seharusnya drain.

---

### Anti-Pattern 8 — Scheduler Aktif di Semua Replica Tanpa Lock

Rolling update menyebabkan job double-run.

---

### Anti-Pattern 9 — Probe Timeout Terlalu Rendah untuk CPU-Throttled Java

Probe timeout 1 detik, pod CPU throttled, liveness restart loop.

---

### Anti-Pattern 10 — Tidak Ada Observability Shutdown

Tim mengklaim graceful shutdown aktif, tetapi tidak ada bukti log/metric.

---

## 42. Enterprise/Regulatory Lens

Untuk sistem case management, enforcement lifecycle, workflow, approval, audit, atau regulatory platform, shutdown safety lebih penting daripada sekadar zero downtime.

Risiko domain:

- case action double-submit;
- approval state berubah dua kali;
- audit trail tidak lengkap;
- notification terkirim tetapi transaction rollback;
- appeal/review workflow masuk state ambigu;
- scheduled escalation jalan ganda;
- SLA timer job duplicate;
- document generation partial;
- external agency integration duplicate call.

Karena itu deployment design harus memasukkan:

```text
idempotency key
state transition guard
optimistic locking
transactional outbox
message deduplication
workflow invariant
shutdown drain
post-deployment evidence
```

Deployment bukan sekadar infra. Deployment bisa mempengaruhi legal defensibility data.

---

## 43. Minimal Production Standard

Untuk Java service di Kubernetes, minimal production standard:

```text
[ ] startupProbe configured for realistic startup p99
[ ] readinessProbe separate from livenessProbe
[ ] livenessProbe does not depend on external DB/downstream
[ ] readiness becomes false during shutdown
[ ] graceful shutdown enabled in framework/server
[ ] terminationGracePeriodSeconds sized from workload
[ ] preStop used intentionally, not blindly
[ ] HTTP request in-flight drain understood
[ ] message consumer shutdown behavior tested
[ ] scheduled job duplicate prevention exists
[ ] mutation endpoints idempotent or guarded
[ ] probe endpoints are cheap and protected
[ ] rollout strategy preserves capacity
[ ] shutdown logs and metrics exist
[ ] rollout tested under traffic, not only idle
```

---

## 44. Latihan Desain

Ambil satu Java service dan jawab:

```text
1. Apa endpoint liveness-nya?
2. Apa endpoint readiness-nya?
3. Apa bedanya?
4. Apa dependency yang membuat readiness false?
5. Dependency apa yang tidak boleh membuat liveness false?
6. Berapa p95 startup time?
7. Berapa startupProbe budget?
8. Berapa request p99 duration?
9. Berapa terminationGracePeriodSeconds?
10. Apa yang terjadi saat SIGTERM?
11. Apakah consumer/scheduler berhenti menerima work baru?
12. Bagaimana memastikan request mutasi tidak double-submit?
13. Metric apa yang membuktikan shutdown graceful?
```

Jika pertanyaan ini tidak bisa dijawab, deployment service tersebut belum production-grade.

---

## 45. Ringkasan

Bagian ini membangun mental model bahwa Kubernetes probe dan graceful shutdown adalah kontrak antara aplikasi Java dan control plane Kubernetes.

Inti penting:

1. `startupProbe` melindungi startup lambat.
2. `readinessProbe` mengatur apakah pod boleh menerima traffic.
3. `livenessProbe` mengatur apakah pod harus direstart.
4. Jangan mencampur readiness dan liveness.
5. Jangan membuat liveness bergantung pada dependency external.
6. Readiness harus false saat draining.
7. Graceful shutdown harus menghentikan work baru dan menyelesaikan work aktif.
8. `terminationGracePeriodSeconds` harus dihitung dari workload nyata.
9. `preStop` memakai budget grace period yang sama, jadi harus digunakan hati-hati.
10. Message consumer dan scheduler butuh shutdown logic sendiri.
11. Idempotency adalah safety net saat deployment race terjadi.
12. Observability adalah bukti bahwa shutdown benar-benar graceful.

Top 1% engineer tidak hanya bertanya:

```text
Apakah pod Running?
```

Mereka bertanya:

```text
Apakah pod masuk traffic pada waktu yang benar,
keluar traffic pada waktu yang benar,
dan mati tanpa merusak work yang sedang berjalan?
```

---

## 46. Referensi

- Kubernetes Documentation — Configure Liveness, Readiness and Startup Probes.
- Kubernetes Documentation — Pod Lifecycle.
- Kubernetes Documentation — Container Lifecycle Hooks.
- Kubernetes Documentation — Liveness, Readiness, and Startup Probes.
- Spring Boot Reference Documentation — Actuator Health, Kubernetes Probes, Availability State, Graceful Shutdown.
- Google Cloud Blog — Kubernetes best practices: terminating with grace.
- CNCF Blog — Decoding the pod termination lifecycle in Kubernetes.

---

## 47. Status Series

Selesai:

```text
Part 15 — Kubernetes Probes, Graceful Shutdown, and Traffic Draining
```

Belum selesai. Masih lanjut ke:

```text
Part 16 — Resource Sizing: CPU, Memory, Heap, Non-Heap, Threads, and Containers
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-14-kubernetes-deployment-for-java-applications.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-16-resource-sizing-cpu-memory-heap-nonheap-threads-containers.md)

</div>