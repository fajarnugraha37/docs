# learn-java-reliability-part-011.md

# Part 011 — Kubernetes, Containers, and Shutdown Reality

> Seri: Graceful Shutdown, Error Handling, Exceptions, and Reliability untuk Java Engineer  
> Posisi: Part 011 dari 030  
> Status seri: belum selesai  
> Fokus: memahami mengapa graceful shutdown aplikasi Java/Spring belum cukup jika tidak dipahami bersama lifecycle container, Kubernetes, readiness, endpoint removal, load balancer, rolling update, dan termination budget.

---

## 0. Mengapa Part Ini Penting

Pada part sebelumnya kita sudah membahas graceful shutdown dari sudut pandang aplikasi:

- JVM menerima sinyal.
- Spring ApplicationContext mulai ditutup.
- Web server berhenti menerima request baru.
- In-flight request diberi kesempatan selesai.
- Executor, scheduler, pool, listener, dan resource lain ditutup secara terurut.

Namun di production modern, aplikasi Java jarang berjalan langsung sebagai proses biasa. Biasanya ia berjalan di dalam:

- container;
- Pod Kubernetes;
- Deployment / StatefulSet / Job;
- Service;
- Ingress / Gateway / Load Balancer;
- service mesh / sidecar;
- autoscaler;
- rolling update controller;
- node drain / eviction process.

Artinya, shutdown bukan hanya urusan `SpringApplication.run(...).close()` atau `Runtime.addShutdownHook(...)`. Shutdown adalah koordinasi antar beberapa layer.

Masalahnya: setiap layer punya lifecycle sendiri.

```text
Client
  -> DNS / Gateway / Load Balancer
  -> Ingress Controller
  -> Kubernetes Service
  -> EndpointSlice
  -> Pod
  -> Container runtime
  -> JVM process
  -> Spring Boot application
  -> Tomcat/Netty/Jetty/Undertow
  -> controller/service/repository/worker
```

Kalau satu layer mengira instance sudah tidak menerima traffic, tetapi layer lain masih mengirim traffic, maka request bisa tetap masuk ke proses yang sedang shutdown.

Kalau aplikasi mengira punya 30 detik untuk shutdown, tetapi `preStop` memakai 20 detik, maka aplikasi sebenarnya hanya punya sisa 10 detik sebelum `SIGKILL`.

Kalau readiness probe belum disetel benar, Kubernetes bisa tetap menganggap Pod ready saat aplikasi sudah tidak sanggup menerima beban.

Kalau liveness probe terlalu agresif, aplikasi bisa dibunuh ketika sebenarnya hanya sedang lambat karena overload sementara.

Kalau termination grace period terlalu pendek, request panjang, batch job, atau message consumer bisa dihentikan paksa di tengah side effect.

Part ini membahas realitas tersebut.

---

## 1. Core Problem

Pertanyaan utama part ini:

> Bagaimana memastikan aplikasi Java/Spring yang berjalan di Kubernetes benar-benar berhenti secara aman, tidak menerima traffic baru terlalu lama, tidak membunuh pekerjaan yang sedang berjalan terlalu cepat, dan tidak menyebabkan lost request, duplicate processing, partial side effect, atau misleading health status?

Masalahnya bukan hanya teknis konfigurasi Kubernetes. Masalahnya adalah koordinasi lifecycle.

Ada beberapa race utama:

1. **Traffic routing race**  
   Pod sudah masuk terminating, tetapi request masih bisa tiba karena load balancer, ingress, kube-proxy, atau endpoint propagation belum konvergen.

2. **Shutdown budget race**  
   `terminationGracePeriodSeconds` harus mencakup `preStop` plus waktu aplikasi berhenti. Banyak engineer salah mengira `preStop` adalah tambahan waktu.

3. **Probe semantics race**  
   Readiness, liveness, dan startup probe sering disamakan, padahal masing-masing punya arti berbeda.

4. **Application lifecycle race**  
   Web server berhenti, tetapi background worker masih berjalan; atau worker berhenti polling, tetapi masih memproses message.

5. **Dependency race**  
   Pod shutdown ketika transaksi DB, external call, atau message ack sedang berlangsung.

6. **Rolling update race**  
   Pod lama dimatikan sebelum Pod baru benar-benar siap, atau Pod baru dianggap ready sebelum warmed-up.

7. **Autoscaling/eviction race**  
   HPA, node drain, disruption, dan eviction bisa memicu termination dalam kondisi beban tinggi, bukan hanya saat deployment terkontrol.

---

## 2. Mental Model: Shutdown Adalah Distributed Protocol

Cara berpikir yang paling aman:

> Shutdown di Kubernetes adalah distributed protocol antara control plane, kubelet, container runtime, network routing, application process, dan client behavior.

Ia bukan satu function call.

Ia punya state, delay, race, timeout, dan failure mode.

### 2.1 State sederhana

```text
RUNNING
  -> NOT_READY / DRAINING
  -> TERMINATING
  -> STOPPING_APPLICATION
  -> EXITED
  -> REMOVED
```

Tetapi dalam realitas Kubernetes, state ini tidak selalu sinkron antar layer.

Contoh:

```text
Kubernetes API:       Pod deletionTimestamp set
EndpointSlice:        endpoint marked terminating / not ready after propagation
Ingress/LB:           may still have old backend for a short time
Application:          may still accept socket/request
JVM:                  still alive
Spring:               context closing
Worker:               maybe still processing message
Client:               maybe retrying
```

Jadi pertanyaan reliability yang benar bukan:

> Apakah Pod sudah terminating?

Tetapi:

> Pada setiap detik selama termination, siapa saja yang masih bisa mengirim pekerjaan ke instance ini, dan pekerjaan itu akan diapakan?

### 2.2 Shutdown bukan hanya stop

Shutdown yang benar minimal terdiri dari beberapa fase:

```text
1. Signal intention to stop
2. Stop advertising readiness
3. Allow routing layer to converge
4. Stop accepting new work
5. Drain in-flight work
6. Stop polling/consuming background work
7. Finish or checkpoint current work
8. Flush/commit/rollback/release resources
9. Exit before grace period expires
10. Let orchestrator replace/remove instance
```

Kalau fase ini bercampur, sistem menjadi nondeterministic.

### 2.3 Termination budget sebagai deadline

Kubernetes punya `terminationGracePeriodSeconds`. Ini bukan guarantee bahwa aplikasi akan selesai. Ini hanya batas waktu sebelum Kubernetes boleh memaksa kill container jika belum berhenti.

Model yang benar:

```text
terminationGracePeriodSeconds
  = preStop time
  + application shutdown time
  + buffer
```

Bukan:

```text
terminationGracePeriodSeconds
  = application shutdown time

preStop time = extra time
```

Ini sangat penting. Kubernetes documentation menyatakan `PreStop` hook harus selesai sebelum TERM signal dikirim, dan grace period berlaku untuk total waktu hook plus container shutdown normal.

---

## 3. Kubernetes Termination Lifecycle

Secara konseptual, saat Pod akan dihentikan karena delete, rollout, eviction, node drain, atau scale down, Kubernetes menjalankan alur berikut.

Urutan konseptual:

```text
1. Pod ditandai terminating
2. Endpoint readiness/routing mulai diperbarui
3. kubelet menjalankan preStop hook jika ada
4. kubelet mengirim TERM signal ke container process
5. process diberi waktu untuk berhenti normal
6. jika belum berhenti saat grace habis, kubelet mengirim KILL
7. Pod dihapus
```

Namun jangan menganggap semua network component langsung berhenti mengirim traffic persis setelah step 1. Ada propagation delay.

### 3.1 `deletionTimestamp`

Ketika Pod dihapus, Kubernetes tidak selalu langsung menghilangkannya. Pod masuk terminating state dengan `deletionTimestamp`.

Dari sisi aplikasi, ini bukan event yang otomatis diketahui kecuali:

- process menerima signal;
- aplikasi memeriksa Kubernetes API;
- readiness berubah;
- lifecycle hook dipanggil;
- orchestrator mengubah routing.

Untuk aplikasi Java, sinyal utama biasanya `SIGTERM`.

### 3.2 `preStop`

`preStop` adalah hook yang bisa dijalankan tepat sebelum container dihentikan.

Contoh YAML:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
```

Pattern `sleep` sering dipakai untuk memberi waktu agar endpoint removal / load balancer deregistration mulai konvergen sebelum aplikasi benar-benar berhenti.

Namun ini harus dipahami dengan hati-hati:

- `preStop` memakan termination grace period.
- Kalau `preStop` terlalu lama, aplikasi punya sisa waktu lebih sedikit.
- Kalau `preStop` hang, Pod tetap terminating sampai grace period habis.
- `preStop` bukan tempat terbaik untuk logic bisnis kompleks.
- `preStop` tidak boleh bergantung pada service yang mungkin sudah tidak tersedia.

### 3.3 `SIGTERM`

Setelah `preStop` selesai, kubelet mengirim TERM signal ke proses utama container.

Untuk Java/Spring Boot:

- JVM menerima termination signal.
- Shutdown hooks berjalan.
- Spring context close dimulai jika proses diintegrasikan normal.
- Embedded server graceful shutdown dapat berjalan jika dikonfigurasi.

Namun aplikasi harus selesai sebelum grace period habis.

### 3.4 `SIGKILL`

Jika proses tidak berhenti sampai termination grace period habis, kubelet dapat mengirim kill signal.

`SIGKILL` tidak bisa ditangani oleh JVM.

Konsekuensinya:

- shutdown hook tidak berjalan;
- finally block yang belum dieksekusi tidak selesai;
- buffered log/metrics bisa hilang;
- in-flight request bisa putus;
- transaction mungkin rollback atau commit tergantung posisi failure;
- message ack bisa tidak terkirim;
- lock bisa tertinggal sampai TTL;
- side effect eksternal bisa sudah terjadi tanpa local state tercatat.

---

## 4. Container Reality: PID 1, Signal, dan Entrypoint

Di container, proses utama berjalan sebagai PID 1. Ini punya konsekuensi penting.

### 4.1 Pastikan Java process menerima signal

Buruk:

```dockerfile
ENTRYPOINT sh -c "java -jar app.jar"
```

Dengan bentuk ini, shell bisa menjadi process utama. Signal handling bisa menjadi tidak sesuai ekspektasi jika shell tidak meneruskan signal dengan benar.

Lebih baik:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Atau gunakan entrypoint script yang melakukan `exec`:

```sh
#!/bin/sh
exec java -jar /app/app.jar
```

Dengan `exec`, process Java menggantikan shell sehingga menerima signal sebagai PID utama.

### 4.2 Jangan menjalankan multiple long-running process tanpa supervisor yang benar

Buruk:

```sh
java -jar app.jar &
side-process &
wait
```

Kalau tidak dirancang benar:

- signal tidak diteruskan;
- child process orphan;
- exit code salah;
- shutdown tidak sinkron;
- Kubernetes mengira container sudah selesai padahal child masih bermasalah.

Untuk Java service biasa, satu container sebaiknya menjalankan satu main process.

### 4.3 Exit code itu operational signal

Exit code penting untuk membedakan:

- normal shutdown;
- fatal config error;
- crash;
- OOMKilled;
- killed by signal;
- failed startup.

Dalam incident analysis, exit reason dan restart count sering menjadi clue pertama.

---

## 5. Readiness, Liveness, dan Startup Probe

Probe adalah salah satu area paling sering disalahpahami.

### 5.1 Liveness probe

Liveness berarti:

> Apakah container ini masih hidup secara internal, atau harus direstart?

Liveness failure menyebabkan kubelet restart container.

Jadi liveness tidak boleh terlalu sensitif terhadap dependency eksternal.

Buruk:

```text
liveness = DB reachable AND Redis reachable AND external API reachable
```

Kenapa buruk?

Kalau DB outage sementara, semua Pod restart massal. Ini memperburuk incident.

Lebih benar:

```text
liveness = application process not deadlocked / event loop not permanently broken / fatal internal state absent
```

### 5.2 Readiness probe

Readiness berarti:

> Apakah Pod ini boleh menerima traffic sekarang?

Readiness failure membuat Pod dikeluarkan dari endpoint Service untuk routing traffic baru.

Readiness boleh dipengaruhi oleh:

- app belum selesai startup;
- app sedang draining;
- connection pool belum ready;
- mandatory dependency tidak tersedia;
- app overload dan ingin stop menerima traffic sementara;
- local cache belum warm;
- migration/bootstrap belum selesai.

Readiness adalah traffic admission signal.

### 5.3 Startup probe

Startup probe dipakai untuk aplikasi yang startup-nya lama.

Tanpa startup probe, liveness bisa membunuh aplikasi sebelum ia selesai startup.

Pattern:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 30
  periodSeconds: 10
```

Dengan startup probe, liveness/readiness behavior dapat ditunda sampai startup berhasil.

### 5.4 Spring Boot Actuator availability

Spring Boot menyediakan konsep availability state seperti readiness dan liveness melalui Actuator jika dikonfigurasi.

Contoh endpoint umum:

```text
/actuator/health/liveness
/actuator/health/readiness
```

Konsep penting:

- liveness: apakah internal app masih hidup;
- readiness: apakah app siap menerima traffic;
- saat shutdown, readiness seharusnya berubah agar traffic baru tidak masuk;
- saat startup, readiness tidak boleh true terlalu cepat.

---

## 6. Readiness During Shutdown: DRAINING State

Aplikasi production sebaiknya punya state eksplisit:

```java
enum TrafficState {
    STARTING,
    READY,
    DRAINING,
    NOT_READY
}
```

Ketika shutdown dimulai:

```text
READY -> DRAINING -> STOPPING -> EXITED
```

Makna `DRAINING`:

- jangan terima new business request;
- request health/liveness mungkin masih boleh;
- in-flight request boleh selesai;
- background worker berhenti mengambil pekerjaan baru;
- queue consumer pause polling;
- actuator/readiness harus melaporkan not ready;
- metrics/logs masih aktif selama memungkinkan.

### 6.1 Contoh readiness indicator sederhana

```java
@Component
public final class TrafficReadiness {
    private final AtomicBoolean acceptingTraffic = new AtomicBoolean(false);

    public void markReady() {
        acceptingTraffic.set(true);
    }

    public void markDraining() {
        acceptingTraffic.set(false);
    }

    public boolean isAcceptingTraffic() {
        return acceptingTraffic.get();
    }
}
```

Spring Boot health indicator konseptual:

```java
@Component
public final class ReadinessHealthIndicator implements HealthIndicator {
    private final TrafficReadiness readiness;

    public ReadinessHealthIndicator(TrafficReadiness readiness) {
        this.readiness = readiness;
    }

    @Override
    public Health health() {
        if (readiness.isAcceptingTraffic()) {
            return Health.up()
                    .withDetail("traffic", "accepting")
                    .build();
        }

        return Health.down()
                .withDetail("traffic", "draining_or_not_ready")
                .build();
    }
}
```

Catatan: desain detail dengan Spring Boot Availability API bisa lebih idiomatik, tetapi mental modelnya sama: readiness adalah sinyal admission traffic.

---

## 7. Endpoint Removal Tidak Instan

Salah satu jebakan paling penting:

> Readiness false tidak berarti semua traffic langsung berhenti pada detik yang sama.

Kenapa?

Karena ada propagation chain:

```text
App readiness changes
  -> kubelet observes probe result
  -> Pod condition changes
  -> EndpointSlice updated
  -> kube-proxy / CNI / service mesh / ingress observes change
  -> load balancer target changes
  -> client connection pool may still hold connection
```

Setiap layer bisa punya delay.

### 7.1 Consequence

Selama beberapa detik, request masih bisa datang ke Pod yang sudah tidak ready atau sudah terminating.

Karena itu aplikasi harus tetap bisa menjawab request yang terlanjur datang.

Strategi:

- saat draining, return `503 Service Unavailable` untuk new request;
- optionally include `Retry-After`;
- jangan mulai side effect baru;
- biarkan in-flight request lama selesai;
- gunakan idempotency agar client retry aman;
- gunakan load balancer deregistration delay yang sinkron dengan app behavior.

### 7.2 Admission filter

Contoh servlet filter konseptual:

```java
@Component
public final class DrainingRejectFilter extends OncePerRequestFilter {
    private final TrafficReadiness readiness;

    public DrainingRejectFilter(TrafficReadiness readiness) {
        this.readiness = readiness;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String path = request.getRequestURI();

        if (isOperationalEndpoint(path)) {
            filterChain.doFilter(request, response);
            return;
        }

        if (!readiness.isAcceptingTraffic()) {
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            response.setHeader("Retry-After", "5");
            response.setContentType("application/problem+json");
            response.getWriter().write("""
                {
                  "type":"about:blank",
                  "title":"Service unavailable",
                  "status":503,
                  "code":"SERVICE_DRAINING",
                  "message":"This instance is draining and is not accepting new work."
                }
                """);
            return;
        }

        filterChain.doFilter(request, response);
    }

    private boolean isOperationalEndpoint(String path) {
        return path.startsWith("/actuator/health")
                || path.startsWith("/actuator/prometheus");
    }
}
```

Tujuannya bukan menggantikan Kubernetes readiness, tetapi menjadi safety net terhadap propagation delay.

---

## 8. Kubernetes YAML: Baseline yang Lebih Aman

Contoh baseline untuk Spring Boot service:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app: order-service
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: order-service
          image: example/order-service:1.0.0
          ports:
            - containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 5
            failureThreshold: 24
```

### 8.1 Kenapa `maxUnavailable: 0`?

Untuk rolling update service dengan traffic user, `maxUnavailable: 0` menjaga agar kapasitas lama tidak dikurangi sebelum Pod baru tersedia.

Tetapi ini bukan silver bullet.

Masih perlu:

- readiness akurat;
- startup tidak terlalu cepat true;
- resource cukup;
- PodDisruptionBudget;
- autoscaling capacity;
- load balancer behavior benar.

### 8.2 Kenapa `preStop sleep`?

Tujuannya memberi waktu agar endpoint/routing propagation mulai terjadi sebelum app menerima SIGTERM.

Namun sleep bukan solusi universal. Ia trade-off:

Kelebihan:

- sederhana;
- membantu mengurangi request masuk setelah SIGTERM;
- memberi waktu load balancer/ingress melihat endpoint change.

Kekurangan:

- memakan grace period;
- delay rollout;
- nilai sleep sering tebak-tebakan;
- tidak menyelesaikan client persistent connection;
- tidak menggantikan admission control di aplikasi.

### 8.3 Budget example

Jika:

```yaml
terminationGracePeriodSeconds: 60
preStop: sleep 10
spring.lifecycle.timeout-per-shutdown-phase: 40s
```

Maka budget kira-kira:

```text
0s   Pod termination starts
0-10s preStop sleep
10s  SIGTERM delivered
10-50s Spring graceful shutdown budget
50-60s buffer
60s  SIGKILL risk
```

Lebih buruk:

```yaml
terminationGracePeriodSeconds: 30
preStop: sleep 20
spring.lifecycle.timeout-per-shutdown-phase: 30s
```

Budget sebenarnya:

```text
0-20s preStop
20-30s app only has 10s
30s SIGKILL risk
```

Ini konfigurasi yang tampak “graceful” tetapi sebenarnya berbahaya.

---

## 9. Spring Boot Configuration untuk Kubernetes

Contoh `application.yml`:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 40s

management:
  endpoint:
    health:
      probes:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
```

Catatan:

- `server.shutdown=graceful` mengaktifkan graceful shutdown web server.
- `spring.lifecycle.timeout-per-shutdown-phase` harus lebih kecil dari sisa Kubernetes grace period setelah `preStop`.
- readiness/liveness harus dipetakan ke probe Kubernetes.
- jangan jadikan liveness bergantung penuh pada DB/external API.

---

## 10. Load Balancer dan Ingress Reality

Traffic tidak selalu berhenti hanya karena Pod tidak ready.

Ada beberapa komponen yang mungkin memiliki state sendiri:

- Kubernetes Service;
- kube-proxy;
- CoreDNS;
- ingress controller;
- cloud load balancer;
- target group health check;
- service mesh sidecar;
- client connection pool;
- HTTP keep-alive;
- gRPC persistent connection;
- WebSocket connection.

### 10.1 HTTP keep-alive

Client bisa mempertahankan koneksi HTTP keep-alive ke Pod lama.

Saat shutdown, web server harus:

- berhenti menerima request baru;
- menutup idle connection;
- menyelesaikan in-flight request;
- tidak membiarkan request baru masuk lewat connection lama jika sedang draining.

### 10.2 gRPC/WebSocket/streaming

Long-lived connection lebih sulit.

Pertanyaan desain:

- Apakah connection diputus saat draining?
- Apakah client punya reconnect logic?
- Apakah server mengirim close frame / GOAWAY?
- Apakah session state bisa dipindahkan?
- Apakah pesan terakhir sudah di-ack?

Untuk service berbasis streaming, graceful shutdown butuh desain khusus, bukan hanya setting YAML.

### 10.3 Ingress/LB deregistration delay

Cloud load balancer sering punya deregistration delay. Kalau delay lebih lama dari app shutdown, traffic bisa tetap diarahkan ke instance yang hampir mati.

Alignment yang harus dicek:

```text
LB deregistration delay
<= preStop + readiness propagation + app admission rejection behavior
<= terminationGracePeriodSeconds
```

Kalau tidak bisa dikontrol, aplikasi wajib punya admission rejection ketika draining.

---

## 11. Rolling Update Failure Modes

Rolling update tampak sederhana:

```text
create new Pod -> wait ready -> terminate old Pod
```

Namun failure mode-nya banyak.

### 11.1 Pod baru ready terlalu cepat

Jika readiness true sebelum:

- DB connection pool siap;
- cache warm;
- migration compatibility aman;
- background initialization selesai;
- external auth client siap;
- thread pool stabil;

maka traffic masuk terlalu cepat dan error rate naik.

Solusi:

- readiness harus merepresentasikan readiness bisnis minimal;
- gunakan startup probe untuk startup panjang;
- warmup critical resources;
- jangan expose ready hanya karena port terbuka.

### 11.2 Pod lama mati terlalu cepat

Jika termination grace terlalu pendek:

- in-flight request putus;
- batch berhenti di tengah;
- message tidak ack;
- duplicate processing meningkat;
- client menerima 502/503/connection reset.

Solusi:

- ukur p95/p99 request duration;
- set shutdown budget realistis;
- lakukan admission control;
- idempotency untuk request mutating;
- worker checkpointing.

### 11.3 Capacity dipotong saat update

Jika `maxUnavailable` terlalu besar, rolling update bisa mengurangi kapasitas saat traffic tinggi.

Contoh:

```yaml
replicas: 3
maxUnavailable: 1
```

Saat satu Pod tidak tersedia, kapasitas turun 33%. Kalau service sudah berjalan di 75% utilization, remaining Pod bisa overload.

Solusi:

- `maxUnavailable: 0` untuk critical services;
- `maxSurge: 1` atau lebih sesuai kapasitas cluster;
- HPA dan resource request harus cukup;
- PodDisruptionBudget untuk voluntary disruption.

### 11.4 Bad rollout karena readiness tidak mendeteksi defect

Aplikasi bisa ready secara teknis tetapi salah secara fungsional.

Contoh:

- endpoint health OK;
- migration incompatible;
- config salah;
- external credential expired;
- feature flag salah;
- schema drift;
- critical background worker gagal.

Readiness harus cukup kaya untuk mandatory dependency, tetapi tidak boleh terlalu luas sampai setiap dependency minor membuat service keluar dari rotation.

---

## 12. PodDisruptionBudget dan Availability

PodDisruptionBudget atau PDB membantu membatasi voluntary disruption.

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

PDB berguna untuk:

- node drain;
- cluster maintenance;
- voluntary eviction;
- menjaga minimal available replicas.

Namun PDB bukan jaminan availability total.

PDB tidak mencegah:

- node crash;
- process crash;
- OOMKill;
- application bug;
- dependency outage;
- readiness misconfiguration;
- resource starvation;
- forced eviction tertentu.

PDB adalah guardrail, bukan reliability architecture lengkap.

---

## 13. Resource Requests, Limits, dan Shutdown

Shutdown bisa gagal bukan karena logic salah, tetapi karena resource terlalu ketat.

### 13.1 CPU throttling during shutdown

Jika CPU limit terlalu rendah dan container throttled, shutdown tasks bisa lambat:

- flush logs lambat;
- close pool lambat;
- serialization final lambat;
- request drain melewati grace period;
- metrics exporter tidak sempat push/scrape.

### 13.2 Memory pressure and OOMKill

OOMKill bukan graceful shutdown.

Kalau JVM terkena OOMKill:

- tidak ada normal graceful path;
- JVM tidak sempat menjalankan shutdown hook;
- Pod restart;
- in-flight work hilang;
- state lokal hilang.

Java service harus mengatur:

- heap relative to container memory;
- direct memory;
- metaspace;
- thread stack;
- native memory;
- buffer memory;
- observability overhead;
- safety margin.

### 13.3 Disk pressure

Container bisa gagal karena:

- log file tumbuh;
- temp file tidak dibersihkan;
- large upload buffering;
- heap dump;
- local cache;
- node ephemeral storage pressure.

Shutdown dalam kondisi disk pressure bisa gagal flush state/log.

---

## 14. Message Consumers in Kubernetes

Untuk HTTP service, shutdown concern utama adalah request draining. Untuk consumer, concern utama adalah **acknowledgment and duplicate safety**.

### 14.1 Consumer shutdown phases

```text
1. Mark consumer draining
2. Stop polling new messages
3. Finish current message/batch if safe
4. Ack successful work
5. Nack/requeue/checkpoint unfinished work
6. Commit offset if applicable
7. Close connection/channel
8. Exit
```

### 14.2 RabbitMQ-style concern

Failure window:

```text
message received
  -> business side effect executed
  -> ack not sent
  -> Pod killed
  -> broker redelivers
  -> side effect duplicated
```

Solusi:

- idempotent consumer;
- business unique key;
- inbox table;
- deduplication key;
- ack only after durable success;
- avoid auto-ack for critical work;
- tune prefetch count;
- shorten batch size during shutdown.

### 14.3 Kafka-style concern

Failure window:

```text
record processed
  -> DB committed
  -> offset not committed
  -> Pod killed
  -> record replayed
```

Solusi:

- idempotent processing;
- transactional outbox/inbox;
- commit offset after durable side effect;
- avoid large uncommitted batch;
- cooperative rebalancing where suitable;
- graceful listener container stop.

### 14.4 Kubernetes does not understand your business transaction

Kubernetes hanya tahu process berhenti atau tidak.

Ia tidak tahu:

- apakah message sudah ack;
- apakah transaction sudah commit;
- apakah external API sudah dipanggil;
- apakah side effect aman diulang;
- apakah state machine sedang di tengah transition.

Karena itu app-level reliability tetap wajib.

---

## 15. Jobs, CronJobs, and Shutdown

Untuk Kubernetes Job/CronJob, shutdown semantics berbeda dari long-running service.

Pertanyaan penting:

- Apakah job restart-safe?
- Apakah job idempotent?
- Apakah progress tersimpan?
- Apakah partial batch aman?
- Apakah job boleh paralel?
- Apakah ada distributed lock?
- Apakah lock punya TTL?
- Apakah duplicate run mungkin?
- Apakah missed schedule diproses?

CronJob failure mode:

```text
job starts
  -> processes 70% records
  -> node drain kills Pod
  -> new job starts
  -> processes same records again
```

Solusi:

- checkpoint per item/batch;
- status table;
- idempotent writes;
- unique constraints;
- lock lease with expiry;
- resumable design;
- no large all-or-nothing memory-only progress.

---

## 16. Sidecars and Service Mesh

Jika Pod memiliki sidecar seperti Envoy/Istio/Linkerd/logging agent, shutdown jadi lebih kompleks.

Pertanyaan:

- Container mana yang menerima SIGTERM dulu?
- Apakah sidecar masih hidup saat app butuh mengirim final telemetry?
- Apakah sidecar berhenti sebelum app selesai request?
- Apakah inbound traffic masih masuk melalui sidecar?
- Apakah outbound call masih bisa dilakukan saat app draining?
- Apakah metrics/logs sempat dikirim?

Failure mode:

```text
App masih drain request
  -> sidecar sudah stopping
  -> outbound call gagal
  -> request yang seharusnya selesai jadi error
```

Atau:

```text
App sudah stop accepting
  -> sidecar masih menerima inbound connection
  -> request masuk tapi app tidak siap
```

Solusi tergantung mesh/provider, tetapi prinsipnya:

- pahami lifecycle sidecar;
- align termination grace period;
- gunakan mesh-specific drain config jika ada;
- jangan asumsikan single-container behavior;
- test dengan real Pod termination.

---

## 17. Node Drain, Eviction, dan Autoscaling

Tidak semua termination berasal dari deployment.

Termination bisa berasal dari:

- rolling update;
- scale down;
- node drain;
- cluster upgrade;
- spot interruption;
- resource pressure eviction;
- liveness failure restart;
- OOMKill;
- manual delete;
- preemption.

### 17.1 Node drain

Node drain mencoba mengeluarkan Pod dari node untuk maintenance. Jika PDB benar, disruption dapat dibatasi.

Namun jika terlalu banyak service punya PDB ketat, drain bisa macet.

Trade-off:

- PDB terlalu longgar: availability risk.
- PDB terlalu ketat: operability risk.

### 17.2 HPA scale down

Saat HPA scale down, Pod dihentikan karena dianggap kapasitas berlebih.

Namun jika traffic fluktuatif atau metrics lag, scale down bisa terjadi dekat puncak traffic.

Aplikasi harus tetap shutdown aman saat masih ada beban.

### 17.3 Eviction karena resource pressure

Eviction bisa lebih brutal daripada planned rollout.

Jika node memory/disk pressure, Pod bisa dievicted. Grace period mungkin tetap ada, tetapi sistem sedang dalam kondisi degraded.

Desain reliability tidak boleh hanya diuji saat rollout normal.

---

## 18. Common Anti-Patterns

### 18.1 Menganggap `terminationGracePeriodSeconds` cukup

Salah:

```yaml
terminationGracePeriodSeconds: 60
```

lalu menganggap graceful shutdown aman.

Tanpa app shutdown lifecycle, readiness, admission control, idempotency, dan worker drain, angka ini tidak cukup.

### 18.2 `preStop sleep` terlalu lama

```yaml
terminationGracePeriodSeconds: 30
preStop: sleep 25
```

Aplikasi hanya punya sekitar 5 detik untuk shutdown.

### 18.3 Liveness mengecek semua dependency

Jika DB down, semua Pod restart. Ini memperparah outage.

### 18.4 Readiness selalu `UP` selama process hidup

Aplikasi overloaded atau draining tetap menerima traffic.

### 18.5 Health endpoint terlalu mahal

Health endpoint melakukan query berat ke banyak dependency. Saat traffic tinggi, probe sendiri menambah beban.

### 18.6 Shutdown hook melakukan network call kompleks

Shutdown hook bergantung pada service eksternal yang mungkin lambat/down. Grace period habis.

### 18.7 Worker auto-ack message

Message dianggap sukses sebelum side effect durable. Saat process mati, data bisa hilang.

### 18.8 Tidak ada idempotency

Client retry saat Pod shutdown menyebabkan duplicate create/update.

### 18.9 Readiness true sebelum warmup selesai

Traffic masuk ke Pod yang belum punya cache/pool/config siap.

### 18.10 Tidak pernah test SIGTERM

Konfigurasi terlihat benar, tetapi real behavior tidak pernah divalidasi.

---

## 19. Failure Scenario Walkthroughs

### Scenario A — Request masuk saat Pod terminating

Timeline:

```text
T+0s   Pod deletion requested
T+1s   Endpoint update started, not fully propagated
T+2s   Client request still routed to old Pod
T+3s   App already draining
```

Correct behavior:

- app rejects new mutating request with 503;
- client retries to another Pod;
- idempotency key prevents duplicate side effect;
- logs show `SERVICE_DRAINING`;
- metrics count draining rejection.

Incorrect behavior:

- app starts processing;
- SIGKILL happens mid-transaction;
- client retries;
- duplicate row or inconsistent state occurs.

### Scenario B — Message consumer killed after DB commit before ack

Timeline:

```text
T+0s message received
T+1s DB transaction committed
T+2s Pod killed before broker ack
T+3s message redelivered
```

Correct behavior:

- consumer detects duplicate through idempotency/inbox/business key;
- second processing returns already-processed;
- ack sent safely.

Incorrect behavior:

- duplicate email sent;
- duplicate payment created;
- case state advanced twice;
- audit trail confusing.

### Scenario C — Liveness tied to DB

Timeline:

```text
T+0s DB latency spike
T+10s liveness fails on all Pods
T+20s Kubernetes restarts all Pods
T+40s cold start amplifies DB load
T+60s outage worsens
```

Correct behavior:

- readiness may fail or degrade if DB mandatory;
- liveness remains up unless app is internally dead;
- circuit breaker/backpressure protects DB;
- alert fires on DB dependency failure.

Incorrect behavior:

- self-inflicted restart storm.

### Scenario D — preStop consumes entire grace period

Timeline:

```text
terminationGracePeriodSeconds = 30
preStop sleep = 30
Spring graceful shutdown = 30
```

Actual result:

```text
T+0s  preStop starts
T+30s grace expires
T+30s SIGKILL risk
```

Spring may get no meaningful time.

Correct behavior:

```text
terminationGracePeriodSeconds = 75
preStop = 10
Spring shutdown = 50
buffer = 15
```

---

## 20. Designing a Reliable Shutdown Budget

Step-by-step approach:

### Step 1 — Measure real workload duration

Collect:

- p50/p95/p99 HTTP request duration;
- longest safe request duration;
- background job processing duration;
- message batch duration;
- DB transaction duration;
- external API timeout duration;
- log/metrics flush time;
- pool close time.

### Step 2 — Decide maximum acceptable drain time

Not every request should be allowed to run forever.

Set:

```text
max_inflight_request_drain = min(business acceptable time, operational deployment budget)
```

### Step 3 — Decide preStop delay

PreStop should cover routing convergence, not business processing.

Example:

```text
preStop = 5-15s depending on LB/Ingress behavior
```

Do not blindly copy values.

### Step 4 — Configure app shutdown timeout

Example:

```yaml
spring.lifecycle.timeout-per-shutdown-phase: 45s
```

### Step 5 — Add buffer

Always reserve buffer.

```text
buffer = 10-20% of total grace or at least several seconds
```

### Step 6 — Set Kubernetes grace period

Formula:

```text
terminationGracePeriodSeconds
  >= preStop
   + app graceful shutdown timeout
   + telemetry/resource cleanup allowance
   + buffer
```

Example:

```text
10s preStop
+ 45s app shutdown
+ 5s cleanup
+ 10s buffer
= 70s
```

Set:

```yaml
terminationGracePeriodSeconds: 75
```

### Step 7 — Test with real termination

Test:

```bash
kubectl delete pod <pod-name>
```

Observe:

- when readiness flips;
- when endpoint removed;
- whether new traffic still arrives;
- whether app rejects new traffic;
- whether in-flight requests finish;
- whether logs flush;
- whether process exits before grace;
- whether any 5xx spike occurs;
- whether consumer duplicates occur.

---

## 21. Production Checklist

### 21.1 Application

- [ ] `server.shutdown=graceful` enabled where applicable.
- [ ] Spring lifecycle timeout configured.
- [ ] Shutdown timeout is less than remaining Kubernetes grace period.
- [ ] App has explicit readiness/draining state.
- [ ] New work can be rejected during draining.
- [ ] In-flight work can finish or be cancelled safely.
- [ ] Long-running request has deadline.
- [ ] Async executor shuts down gracefully.
- [ ] Scheduler stops creating new jobs during shutdown.
- [ ] Message consumer stops polling before process exit.
- [ ] Current message/batch is acked/nacked/checkpointed safely.
- [ ] Idempotency exists for mutating operations.
- [ ] Logs include shutdown phase events.
- [ ] Metrics include shutdown duration and draining rejection count.

### 21.2 Kubernetes

- [ ] `terminationGracePeriodSeconds` is explicitly configured.
- [ ] `preStop` time is included in total grace budget.
- [ ] Readiness probe points to readiness endpoint.
- [ ] Liveness probe does not depend on fragile external dependencies.
- [ ] Startup probe exists for slow-starting app.
- [ ] Rolling update strategy preserves capacity.
- [ ] PDB exists for critical replicated workloads.
- [ ] Resource requests/limits are realistic.
- [ ] CPU throttling risk is reviewed.
- [ ] Memory headroom for JVM native/heap/direct/thread memory exists.
- [ ] Ingress/LB deregistration delay understood.
- [ ] Service mesh sidecar termination behavior understood.

### 21.3 Operational

- [ ] SIGTERM test performed.
- [ ] Rolling update observed under load.
- [ ] Scale down observed under load.
- [ ] Node drain behavior tested.
- [ ] Consumer duplicate scenario tested.
- [ ] Client retry behavior tested.
- [ ] Dashboards show terminating/draining behavior.
- [ ] Alerts distinguish crash loop vs planned termination.
- [ ] Runbook explains safe manual pod deletion.

---

## 22. Testing Playbook

### 22.1 Test HTTP in-flight request

Create endpoint that sleeps safely:

```java
@GetMapping("/test/slow")
public ResponseEntity<String> slow() throws InterruptedException {
    Thread.sleep(Duration.ofSeconds(20).toMillis());
    return ResponseEntity.ok("done");
}
```

Test:

```bash
curl http://service/test/slow &
kubectl delete pod <pod-name>
```

Expected:

- request either completes successfully within shutdown budget;
- or is rejected/cancelled predictably;
- no ambiguous partial side effect.

### 22.2 Test new request during draining

While Pod terminating, send new mutating requests.

Expected:

```text
HTTP 503 SERVICE_DRAINING
Retry-After present
No new business side effect started
```

### 22.3 Test consumer kill

Inject termination while processing message.

Expected:

- no lost message;
- duplicate redelivery handled idempotently;
- no duplicate irreversible side effect;
- audit/trace shows processing attempt.

### 22.4 Test liveness under dependency outage

Simulate DB down.

Expected:

- readiness may fail depending on dependency criticality;
- liveness should not cause mass restart unless app is truly unrecoverable.

### 22.5 Test rollout under load

Run load test while deploying new version.

Observe:

- error rate;
- p95/p99 latency;
- number of 503 draining responses;
- Pod readiness timing;
- endpoint propagation delay;
- request distribution;
- old Pod exit timing;
- new Pod warmup timing.

---

## 23. Java/Spring Implementation Pattern

### 23.1 Shutdown phase logging

```java
@Component
public final class ShutdownLogger implements ApplicationListener<ContextClosedEvent> {
    private static final Logger log = LoggerFactory.getLogger(ShutdownLogger.class);

    @Override
    public void onApplicationEvent(ContextClosedEvent event) {
        log.info("Application context closing: entering shutdown sequence");
    }
}
```

### 23.2 Mark draining on context close

```java
@Component
public final class DrainingOnShutdown implements ApplicationListener<ContextClosedEvent> {
    private final TrafficReadiness readiness;

    public DrainingOnShutdown(TrafficReadiness readiness) {
        this.readiness = readiness;
    }

    @Override
    public void onApplicationEvent(ContextClosedEvent event) {
        readiness.markDraining();
    }
}
```

Caveat: In Kubernetes, traffic may still arrive before app receives SIGTERM. For stronger control, you may also expose an internal endpoint or lifecycle integration that marks draining earlier, but secure it carefully.

### 23.3 Executor shutdown configuration

```java
@Bean
public ThreadPoolTaskExecutor applicationTaskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(16);
    executor.setMaxPoolSize(64);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("app-worker-");
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(30);
    executor.initialize();
    return executor;
}
```

Principle:

- stop accepting new tasks;
- wait bounded time;
- do not block forever;
- ensure tasks are idempotent/cancellable where possible.

### 23.4 Avoid shutdown work that cannot finish

Bad:

```java
@PreDestroy
public void onDestroy() {
    externalBillingClient.reconcileEverything();
}
```

Better:

```java
@PreDestroy
public void onDestroy() {
    log.info("Stopping billing worker; unfinished work will be resumed by checkpoint");
    billingWorker.stopPolling();
}
```

Heavy recovery should be resumable, not performed inside shutdown hook.

---

## 24. Decision Matrix

| Situation | Kubernetes signal | App behavior | Correct reliability primitive |
|---|---|---|---|
| Pod rolling update | SIGTERM after preStop | Drain request, stop new work | readiness + graceful shutdown |
| Client request during termination | request still routed | reject or finish safely | admission control + idempotency |
| Consumer processing message | SIGTERM | stop polling, finish/checkpoint | ack discipline + idempotency |
| DB temporary outage | dependency failure | stop ready or degrade | readiness/circuit breaker, not liveness restart |
| App deadlocked | liveness failure | restart | liveness probe |
| Startup slow | startup incomplete | avoid premature restart | startup probe |
| Node drain | eviction | preserve availability | PDB + grace period |
| Scale down | Pod deletion | drain safely | HPA config + shutdown lifecycle |
| OOMKill | forced kill | cannot graceful | memory sizing + idempotency |
| LB still routes traffic | stale backend | reject new work | preStop + readiness + admission filter |

---

## 25. Review Questions

Gunakan pertanyaan ini untuk review service nyata.

1. Berapa lama p99 request mutating service ini?
2. Apakah `terminationGracePeriodSeconds` lebih besar dari `preStop + app shutdown + buffer`?
3. Apakah readiness berubah saat app draining?
4. Apakah liveness terlalu bergantung pada dependency eksternal?
5. Apakah startup probe diperlukan?
6. Apakah Pod baru dianggap ready sebelum cache/pool/dependency mandatory siap?
7. Apakah new request selama draining ditolak dengan aman?
8. Apakah request mutating punya idempotency key atau dedup mechanism?
9. Apakah message consumer bisa duplicate-safe setelah kill?
10. Apakah ack/offset commit dilakukan setelah durable side effect?
11. Apakah executor menunggu task selesai dengan bounded timeout?
12. Apakah scheduler berhenti membuat job baru saat shutdown?
13. Apakah LB/Ingress deregistration delay dipahami?
14. Apakah service mesh sidecar memengaruhi shutdown ordering?
15. Apakah node drain pernah dites?
16. Apakah rolling update pernah dites saat load tinggi?
17. Apakah logs/metrics cukup untuk membedakan planned shutdown dan crash?
18. Apakah OOMKill pernah terjadi dan bagaimana dampaknya ke in-flight work?
19. Apakah PDB tersedia untuk service critical?
20. Apakah runbook menjelaskan safe pod deletion/restart?

---

## 26. Key Takeaways

1. Kubernetes graceful termination dan Spring graceful shutdown adalah dua lifecycle berbeda yang harus disejajarkan.
2. `preStop` memakai termination grace period; ia bukan tambahan waktu gratis.
3. `SIGKILL` tidak bisa ditangani JVM; jika grace habis, graceful shutdown gagal.
4. Readiness adalah traffic admission signal; liveness adalah restart signal.
5. Liveness yang mengecek dependency eksternal dapat menciptakan restart storm.
6. Endpoint removal tidak instan; aplikasi tetap harus aman jika request datang saat draining.
7. Rolling update aman hanya jika readiness benar, kapasitas cukup, dan shutdown budget realistis.
8. Message consumer shutdown membutuhkan ack discipline dan idempotency.
9. Kubernetes tidak memahami transaksi bisnis; aplikasi tetap harus mendesain consistency dan recovery.
10. Shutdown behavior harus dites dengan real SIGTERM/delete pod, bukan diasumsikan dari konfigurasi.

---

## 27. Referensi

- Kubernetes Documentation — Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes Documentation — Container Lifecycle Hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- Kubernetes Documentation — Configure Liveness, Readiness and Startup Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Spring Blog — Liveness and Readiness Probes with Spring Boot: https://spring.io/blog/2020/03/25/liveness-and-readiness-probes-with-spring-boot
- Spring Boot Reference — Graceful Shutdown: https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html

---

# Status Seri

```text
Part 011 / 030 completed
Seri belum selesai.
```

Part berikutnya:

```text
Part 012 — Request Draining and In-Flight Work Management
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-reliability-part-010.md">⬅️ Part 010 — Spring Boot Graceful Shutdown Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-reliability-part-012.md">Part 012 — Request Draining and In-Flight Work Management ➡️</a>
</div>
