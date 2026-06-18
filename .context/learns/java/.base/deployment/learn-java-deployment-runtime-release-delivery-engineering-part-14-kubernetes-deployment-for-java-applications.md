# learn-java-deployment-runtime-release-delivery-engineering

# Part 14 — Kubernetes Deployment for Java Applications

> Seri: **Java Deployment Runtime Release Delivery Engineering**  
> Target: Java 8 sampai Java 25  
> Level: Advanced / principal-engineer oriented  
> Fokus: memahami Kubernetes sebagai runtime deployment contract untuk aplikasi Java, bukan sekadar tempat menaruh YAML.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas:

- artifact Java: JAR, WAR, EAR, thin/fat/layered JAR, native image;
- runtime selection: JDK/JRE/distribution/vendor;
- filesystem/process/OS contract;
- configuration deployment;
- JVM options sebagai deployment contract;
- deployment di Linux server/systemd;
- containerizing Java dengan benar;
- Dockerfile patterns;
- `jlink`, `jdeps`, `jpackage`;
- classpath/module path/classloader failure;
- application server/container deployment;
- Spring Boot deployment deep dive.

Sekarang kita masuk ke **Kubernetes deployment for Java applications**.

Kubernetes bukan “server Java”. Kubernetes juga bukan “cloud magic”. Kubernetes adalah **control plane** yang mencoba menjaga desired state dari workload containerized. Dari sudut aplikasi Java, Kubernetes adalah environment yang:

1. membuat process Java hidup dalam container;
2. menentukan kapan process boleh menerima traffic;
3. menentukan kapan process harus dibunuh/diganti;
4. membatasi CPU/memory/storage/network;
5. memberi konfigurasi/secrets;
6. melakukan rollout/rollback berbasis pod replacement;
7. memindahkan workload antar node;
8. mengekspos service ke network internal/eksternal;
9. memberikan primitive scheduling, scaling, disruption, dan recovery.

Kesalahan paling umum engineer saat mulai Kubernetes adalah menganggap deployment hanya sebagai:

```yaml
apiVersion: apps/v1
kind: Deployment
...
```

Padahal untuk aplikasi Java production-grade, pertanyaan sebenarnya adalah:

> “Apakah lifecycle Java process, JVM memory, startup time, graceful shutdown, dependency readiness, connection pool, message consumer, session state, config reload, observability, dan rollout strategy sudah cocok dengan cara Kubernetes mengganti pod?”

Part ini membangun mental model tersebut.

---

## 1. Mental Model: Kubernetes Does Not Run Java; It Runs Containers Containing Java

Kubernetes tidak tahu detail Java seperti:

- heap;
- metaspace;
- direct buffer;
- GC pause;
- thread pool;
- servlet container;
- connection pool;
- Spring context initialization;
- Hibernate startup;
- classpath;
- module path;
- JFR;
- virtual threads;
- application readiness.

Kubernetes hanya melihat container/pod melalui signal terbatas:

| Kubernetes Signal | Yang Kubernetes Tahu | Yang Kubernetes Tidak Tahu |
|---|---|---|
| Container process exit code | Process mati/berhasil/gagal | Apakah root cause-nya OOME, bad config, classpath conflict, DB down, atau bug |
| Liveness probe | Container dianggap masih hidup atau perlu restart | Apakah restart aman atau justru memperparah dependency overload |
| Readiness probe | Pod boleh/tidak boleh menerima traffic | Apakah app benar-benar siap secara bisnis |
| Startup probe | App masih dalam fase startup atau tidak | Detail progress Spring/JPA/cache warmup |
| Resource usage | CPU/memory/ephemeral storage | Breakdown heap vs native vs thread stack |
| Events | Scheduling, pull image, kill, restart, eviction | Internal Java lifecycle |
| Logs | stdout/stderr container | Struktur semantik tanpa log discipline |

Karena itu, Java engineer harus menerjemahkan kondisi internal Java menjadi signal Kubernetes yang benar.

Prinsipnya:

> Kubernetes hanya bisa mengorkestrasi dengan benar jika aplikasi memberi sinyal yang benar.

Jika readiness endpoint terlalu optimis, Kubernetes akan mengirim traffic ke pod yang belum siap.

Jika liveness endpoint terlalu agresif, Kubernetes akan membunuh pod yang sebenarnya sedang lambat karena GC, cold start, dependency pressure, atau temporary overload.

Jika memory limit tidak memperhitungkan native memory, container akan `OOMKilled` walaupun heap terlihat “masih aman”.

Jika termination grace period terlalu pendek, Kubernetes akan membunuh process sebelum request/transaction/message selesai.

---

## 2. Kubernetes Objects yang Paling Relevan untuk Java Deployment

Kita tidak akan menghafal semua resource Kubernetes. Fokus kita adalah object yang paling sering memengaruhi aplikasi Java production.

### 2.1 Pod

**Pod** adalah unit deployable terkecil di Kubernetes. Biasanya satu pod berisi satu container aplikasi Java, meskipun bisa juga memiliki init container atau sidecar.

Untuk Java, pod adalah boundary untuk:

- JVM process;
- container resource limit;
- IP address;
- volume mount;
- config/secret injection;
- lifecycle hook;
- probe;
- restart policy;
- scheduling decision.

Mental model:

```text
Pod
└── Container: java process
    ├── JVM heap
    ├── JVM native memory
    ├── application threads
    ├── HTTP server
    ├── DB connections
    ├── cache clients
    ├── message consumers
    └── logs to stdout/stderr
```

Pod bersifat mortal. Pod bisa mati karena:

- rollout deployment;
- node drain;
- eviction;
- liveness failure;
- OOMKilled;
- application crash;
- image update;
- config rollout;
- manual delete;
- cluster autoscaler activity;
- spot/preemptible node termination;
- node failure.

Aplikasi Java yang baik di Kubernetes harus menganggap pod sebagai **temporary execution slot**, bukan host permanen.

### 2.2 Deployment

**Deployment** mengelola ReplicaSet dan pod replacement untuk stateless application.

Untuk Java HTTP service, Deployment adalah default primitive yang paling umum.

Deployment mengatur:

- jumlah replica;
- pod template;
- rollout strategy;
- rolling update;
- revision history;
- rollback;
- availability during replacement.

Mental model:

```text
Deployment desired state:
- run 4 replicas of app:v12
- each replica uses same pod template
- replace old pods gradually when template changes
```

Ketika image tag, env var, resource, probe, label, annotation, atau pod template berubah, Kubernetes membuat ReplicaSet baru dan melakukan rollout.

Konsekuensi untuk Java:

- setiap pod baru mengalami cold start;
- connection pool baru dibuka;
- cache lokal kosong;
- JIT belum warm;
- Spring context belum siap;
- old dan new version bisa berjalan bersamaan selama rolling update;
- backward compatibility antar versi menjadi wajib.

### 2.3 ReplicaSet

ReplicaSet biasanya tidak dikelola langsung. Deployment membuat dan mengelola ReplicaSet.

Yang penting dipahami:

```text
Deployment
├── ReplicaSet old: app:v11
└── ReplicaSet new: app:v12
```

Selama rolling update, dua versi aplikasi bisa hidup bersamaan.

Ini memunculkan invariants:

- API harus backward compatible selama rollout;
- DB schema harus support old dan new version;
- message schema harus tidak mematahkan consumer versi lama;
- distributed cache key format tidak boleh berubah sembarangan;
- session payload tidak boleh hanya bisa dibaca versi baru;
- feature flag harus mempertimbangkan mixed-version period.

### 2.4 Service

**Service** memberi stable virtual endpoint ke sekumpulan pod berdasarkan selector label.

Pod IP berubah, Service IP/name stabil.

Untuk Java service-to-service communication:

```text
Order Service calls Payment Service
http://payment-service.namespace.svc.cluster.local
```

Service memilih endpoint berdasarkan label pod yang ready.

Kritis:

- readiness probe memengaruhi apakah pod masuk endpoint Service;
- jika readiness salah, traffic routing salah;
- Service bukan load balancer semantic-aware;
- Service tidak tahu pod sedang warming up, GC pause, DB pool exhausted, atau thread pool saturated kecuali readiness mencerminkannya.

### 2.5 Ingress / Gateway

Ingress atau Gateway mengekspos HTTP(S) traffic ke Service.

Untuk Java web/API service, ini menjadi boundary untuk:

- TLS termination;
- host/path routing;
- request timeout;
- body size limit;
- header forwarding;
- X-Forwarded-*;
- WebSocket behavior;
- sticky session;
- rewrite path;
- authentication integration;
- rate limiting;
- WAF/API gateway integration.

Kesalahan deployment sering terjadi karena mismatch antara application server dan ingress:

- app menganggap scheme `http`, padahal publiknya `https`;
- redirect URL salah;
- secure cookie tidak keluar;
- context path mismatch;
- request body terlalu besar;
- timeout ingress lebih pendek dari request bisnis;
- WebSocket idle timeout;
- gzip/compression double handling;
- max header size mismatch.

### 2.6 ConfigMap

ConfigMap menyimpan konfigurasi non-secret.

Untuk Java:

- application properties;
- feature flags non-secret;
- log level config;
- endpoint config;
- config file YAML/properties;
- JVM option fragments, jika dikelola hati-hati.

ConfigMap dapat diberikan sebagai:

1. environment variable;
2. mounted file;
3. command argument;
4. projected volume.

Penting:

- environment variable dibaca saat process start;
- mounted ConfigMap bisa berubah di filesystem, tetapi aplikasi belum tentu reload;
- banyak framework Java membaca config saat startup saja;
- perubahan ConfigMap tidak otomatis restart pod;
- jika butuh restart, pakai checksum annotation pattern atau reloader controller.

### 2.7 Secret

Secret menyimpan data sensitif, tetapi jangan keliru: Kubernetes Secret secara default adalah object cluster yang butuh konfigurasi keamanan tambahan agar benar-benar aman secara enterprise.

Untuk Java:

- DB password;
- OAuth client secret;
- API key;
- keystore password;
- truststore password;
- mTLS material;
- signing key;
- SMTP credential;
- S3/SSM/Vault credential bootstrap.

Secret injection punya masalah yang mirip dengan ConfigMap:

- env var secret tidak berubah sampai restart;
- mounted secret bisa update di volume tetapi app belum tentu reload;
- rotation butuh dual-validity window;
- secret bisa bocor via logs, thread dump, env dump, `/proc`, actuator, crash report, atau misconfigured debug endpoint.

### 2.8 Job dan CronJob

Untuk Java batch, migration, scheduled work:

- `Job` cocok untuk one-off task;
- `CronJob` cocok untuk recurring schedule;
- long-running service sebaiknya tidak dicampur dengan batch scheduler internal tanpa desain leader election.

Contoh Java task:

- data migration;
- report generation;
- reconciliation;
- nightly export;
- email batch;
- index rebuild;
- cache warmup;
- one-time repair script.

Pertanyaan penting:

- Apakah task idempotent?
- Apa yang terjadi kalau pod mati di tengah task?
- Apakah retry aman?
- Apakah ada distributed lock?
- Apakah schedule overlap diizinkan?
- Apakah task bisa berjalan paralel?
- Apakah output transactional?
- Apakah observability cukup?

### 2.9 StatefulSet

StatefulSet memberikan identity stabil dan persistent volume per replica.

Untuk kebanyakan Java application service, StatefulSet bukan default. Namun bisa relevan untuk:

- broker;
- database;
- search engine;
- clustered stateful middleware;
- legacy Java service yang butuh stable identity;
- distributed system yang setiap node punya identity persistent.

Untuk Java application biasa, lebih baik desain stateless Deployment + external state store.

### 2.10 HorizontalPodAutoscaler

HPA mengubah jumlah replica berdasarkan metric seperti CPU, memory, atau custom metric.

Untuk Java, HPA harus dipahami bersama:

- startup time;
- warmup time;
- JIT warmup;
- connection pool ramp-up;
- cache warmup;
- request latency;
- CPU throttling;
- thread pool saturation;
- queue depth;
- message lag;
- GC overhead.

CPU-based autoscaling kadang cukup untuk CPU-bound service, tapi sering buruk untuk IO-bound Java service. Untuk message consumer, queue lag atau processing rate sering lebih bermakna.

---

## 3. Java Workload Classification di Kubernetes

Sebelum menulis manifest, klasifikasikan jenis aplikasi Java.

### 3.1 Stateless HTTP API

Contoh:

- Spring Boot REST API;
- Jakarta REST service;
- servlet-based API;
- GraphQL API.

Default primitive:

```text
Deployment + Service + Ingress/Gateway
```

Perhatian utama:

- readiness;
- graceful shutdown;
- connection pool sizing;
- request timeout;
- resource limit;
- rolling update compatibility;
- observability.

### 3.2 Stateful Web Application with Session

Contoh:

- traditional MVC app;
- server-side UI;
- JSF/JSP legacy;
- Spring MVC session-heavy app.

Primitive bisa tetap Deployment, tetapi perlu strategi session:

- sticky session;
- external session store;
- stateless token;
- short session;
- session replication;
- controlled rollout;
- drain old pods carefully.

Risiko:

- user logout saat pod mati;
- session serialization mismatch antar versi;
- sticky routing tidak stabil;
- failover lambat;
- memory pressure karena session in-memory.

### 3.3 Message Consumer

Contoh:

- Kafka consumer;
- RabbitMQ consumer;
- JMS listener;
- SQS worker.

Primitive:

```text
Deployment
```

Tetapi traffic tidak berasal dari Service. Traffic berasal dari broker.

Perhatian utama:

- readiness tidak otomatis menghentikan message consumption;
- SIGTERM harus pause/stop consumer;
- offset/ack semantics;
- idempotency;
- duplicate processing;
- poison message;
- retry storm;
- concurrency vs partition/queue behavior;
- shutdown drain.

### 3.4 Batch Job

Primitive:

```text
Job / CronJob
```

Perhatian utama:

- retry safety;
- idempotency;
- exit code;
- deadline;
- backoff limit;
- concurrency policy;
- resource sizing;
- logs retention;
- result persistence.

### 3.5 Scheduler Inside Application

Contoh:

- `@Scheduled` Spring;
- Quartz;
- internal timer.

Bahaya di Kubernetes:

- setiap replica menjalankan scheduler;
- duplicate execution;
- race condition;
- distributed lock diperlukan;
- rolling update bisa menjalankan old dan new scheduler bersamaan.

Pattern aman:

1. pindahkan ke CronJob jika task sederhana;
2. pakai leader election jika harus di app;
3. pakai Quartz clustered mode dengan DB lock;
4. gunakan distributed lock dengan timeout dan fencing token;
5. desain task idempotent.

### 3.6 Migration/One-Time Admin Task

Jangan sembarangan taruh migration berat di aplikasi startup.

Risiko migration-on-startup:

- semua pod mencoba migration;
- startup lambat;
- rollout stuck;
- DB lock;
- old/new version conflict;
- sulit rollback;
- readiness never true;
- crash loop.

Pattern lebih baik:

```text
CI/CD pre-deploy migration step
or
Kubernetes Job with single execution
or
Controlled manual migration runbook
```

Tetapi schema migration akan kita bahas detail di Part 18.

---

## 4. Deployment Manifest sebagai Runtime Contract

Manifest Kubernetes bukan hanya konfigurasi platform. Manifest adalah kontrak antara aplikasi dan orchestrator.

Contoh minimal Deployment untuk Java:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
  labels:
    app.kubernetes.io/name: case-service
    app.kubernetes.io/part-of: enforcement-platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: case-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: case-service
        app.kubernetes.io/part-of: enforcement-platform
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: registry.example.com/case-service:1.42.0
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:+ExitOnOutOfMemoryError
                -Dfile.encoding=UTF-8
                -Duser.timezone=UTC
          envFrom:
            - configMapRef:
                name: case-service-config
            - secretRef:
                name: case-service-secret
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1024Mi"
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 5
            failureThreshold: 24
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 20
            timeoutSeconds: 2
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
```

Manifest ini menyatakan:

- aplikasi berjalan 3 replica;
- rolling update tidak boleh mengurangi availability (`maxUnavailable: 0`);
- process diberi 60 detik untuk shutdown;
- Java diberi memory strategy eksplisit;
- pod punya startup/readiness/liveness probe;
- container memory limit 1Gi;
- CPU request 500m;
- traffic drain diberi buffer `preStop` sederhana;
- config/secret dipisah dari image.

Namun manifest ini belum tentu benar. Ia harus diuji terhadap karakter aplikasi:

- Apakah startup maksimal < 120 detik?
- Apakah `/liveness` tidak bergantung DB?
- Apakah `/readiness` mencerminkan dependency kritikal?
- Apakah 60 detik cukup untuk drain request dan shutdown pool?
- Apakah heap 70% dari 1Gi cukup setelah native memory?
- Apakah 3 replica cukup saat rolling update?
- Apakah `preStop sleep 10` cocok dengan ingress/service endpoint propagation?
- Apakah CPU limit sengaja tidak dipasang untuk menghindari throttling?

Top 1% engineer tidak hanya menulis YAML. Ia bisa menjelaskan **mengapa tiap field ada dan failure mode apa yang dicegah**.

---

## 5. Labels, Selectors, and Ownership Model

Label adalah basis discovery di Kubernetes.

Recommended labels:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: case-service
    app.kubernetes.io/instance: case-service-prod
    app.kubernetes.io/version: "1.42.0"
    app.kubernetes.io/component: backend-api
    app.kubernetes.io/part-of: enforcement-platform
    app.kubernetes.io/managed-by: argocd
```

Manfaat:

- Service selector stabil;
- observability grouping;
- cost allocation;
- security policy;
- network policy;
- rollout diagnosis;
- ownership clarity;
- incident response.

Anti-pattern:

```yaml
labels:
  app: app
```

atau:

```yaml
selector:
  matchLabels:
    version: v1
```

Jika Service selector mengandung version, traffic bisa hilang saat rollout jika label berubah tidak sinkron.

Pattern umum:

- Service selector memilih app identity stabil;
- version label dipakai untuk observability/routing advanced, bukan default Service selector;
- canary/blue-green memakai selector/routing eksplisit dengan hati-hati.

---

## 6. Image Versioning and Pull Policy

### 6.1 Jangan Pakai `latest` untuk Production

Anti-pattern:

```yaml
image: registry.example.com/case-service:latest
```

Masalah:

- tidak immutable;
- sulit rollback;
- sulit audit;
- deployment tidak reproducible;
- node cache bisa memakai image lama;
- evidence release tidak kuat;
- incident RCA menjadi kabur.

Pattern lebih baik:

```yaml
image: registry.example.com/case-service:1.42.0
```

Lebih kuat:

```yaml
image: registry.example.com/case-service:1.42.0@sha256:abc123...
```

Tag memberi readability. Digest memberi immutability.

### 6.2 Image Pull Policy

Umum:

```yaml
imagePullPolicy: IfNotPresent
```

Untuk immutable tag/digest, ini efisien.

`Always` bisa dipakai, tetapi jangan jadikan kompensasi untuk tag mutable.

Prinsip:

> Production release harus menunjuk artifact immutable, bukan berharap cluster menarik “yang terbaru”.

---

## 7. Ports and Network Contract

Java application harus expose port yang jelas.

```yaml
ports:
  - name: http
    containerPort: 8080
```

Nama port penting karena probe dan Service bisa refer by name.

Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-service
spec:
  selector:
    app.kubernetes.io/name: case-service
  ports:
    - name: http
      port: 80
      targetPort: http
```

Kontrak:

```text
Client inside cluster -> case-service:80 -> Pod containerPort 8080
```

Kesalahan umum:

- app listen di `localhost` bukan `0.0.0.0`;
- port container salah;
- management port terpisah tetapi probe ke port salah;
- ingress path rewrite tidak cocok dengan context path;
- TLS terminated di ingress tapi app generate absolute HTTP URL;
- proxy headers tidak dikonfigurasi;
- server shutdown tidak stop accept new connections.

Untuk Spring Boot di belakang proxy, perlu memahami konfigurasi forwarded headers. Untuk app server tradisional, konfigurasi proxy/connector juga harus benar.

---

## 8. Resource Requests and Limits untuk Java

Resource requests/limits adalah salah satu area paling sering salah.

### 8.1 CPU Request

CPU request memengaruhi scheduling dan share CPU minimum relatif.

```yaml
resources:
  requests:
    cpu: "500m"
```

Artinya pod meminta setengah vCPU untuk scheduling.

Java implications:

- terlalu kecil: pod padat, startup lambat, latency naik;
- terlalu besar: cluster underutilized;
- JIT/GC/thread pool mungkin melihat available processors berdasarkan cgroup;
- CPU request dipakai HPA CPU utilization baseline.

### 8.2 CPU Limit

CPU limit membatasi pemakaian CPU maksimum.

```yaml
limits:
  cpu: "1000m"
```

Untuk Java latency-sensitive service, CPU limit sering berbahaya jika menyebabkan throttling.

Banyak platform memilih:

```yaml
requests:
  cpu: "500m"
limits:
  memory: "1024Mi"
```

Tanpa CPU limit, tetapi dengan governance cluster yang jelas.

Namun tidak selalu benar. Beberapa organisasi wajib memberi CPU limit untuk fairness. Keputusan harus berdasarkan:

- multi-tenant cluster policy;
- latency SLO;
- noisy neighbor risk;
- node capacity;
- HPA behavior;
- observed throttling;
- CPU-bound vs IO-bound workload.

### 8.3 Memory Request

Memory request memengaruhi scheduling.

```yaml
requests:
  memory: "768Mi"
```

Kubernetes mencoba menempatkan pod di node yang punya kapasitas requested memory.

### 8.4 Memory Limit

Memory limit adalah batas keras container memory. Jika total RSS melewati limit, container bisa dibunuh oleh kernel/cgroup dan Kubernetes melaporkannya sebagai `OOMKilled`.

Java memory bukan hanya heap:

```text
Container memory limit
├── Java heap
├── Metaspace
├── Code cache
├── Direct buffers
├── Thread stacks
├── GC/native structures
├── JNI/native libs
├── libc allocator overhead
├── TLS/native crypto
├── mmap files
├── monitoring/agent overhead
└── application native usage
```

Jika container limit 1024Mi dan `-Xmx900m`, kemungkinan besar terlalu tinggi.

Lebih aman:

```text
Memory limit: 1024Mi
Heap target: 60–70%
Native + headroom: 30–40%
```

Contoh:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -XX:MaxRAMPercentage=65
      -XX:+ExitOnOutOfMemoryError
```

Untuk Java 8 lama, behavior container awareness tergantung update/version flags. Jangan asumsikan semua Java 8 otomatis membaca cgroup dengan benar.

### 8.5 Requests vs Limits untuk Java

Practical baseline:

| Workload | CPU Request | CPU Limit | Memory Request | Memory Limit |
|---|---:|---:|---:|---:|
| HTTP API latency-sensitive | Yes | Often avoid or generous | Yes | Yes |
| Batch CPU-bound | Yes | Maybe yes | Yes | Yes |
| Message consumer | Yes | Depends | Yes | Yes |
| Legacy app server | Yes | Conservative/generous | Yes | Yes |
| Low-priority background worker | Yes | Yes possible | Yes | Yes |

Ingat:

- CPU compresses latency;
- memory crosses hard boundary and kills process;
- Java heap must leave room for native memory;
- request affects scheduling;
- limit affects runtime behavior.

---

## 9. Probes: Startup, Readiness, Liveness

Probes adalah kontrak health antara aplikasi dan kubelet.

### 9.1 Startup Probe

Startup probe memberi waktu khusus untuk aplikasi slow start.

Cocok untuk Java karena:

- Spring context bisa lambat;
- Hibernate/JPA init bisa lambat;
- classpath scanning;
- cache warmup;
- JIT cold start;
- migration check;
- TLS truststore load;
- remote config load.

Contoh:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: http
  periodSeconds: 5
  failureThreshold: 36
```

Ini memberi window sekitar 180 detik.

Selama startup probe belum sukses, liveness/readiness behavior tidak akan membunuh app terlalu cepat.

### 9.2 Readiness Probe

Readiness menentukan apakah pod masuk endpoint Service.

Readiness harus menjawab:

> “Apakah pod ini boleh menerima traffic sekarang?”

Untuk HTTP API, readiness biasanya perlu mempertimbangkan:

- application context initialized;
- HTTP server accepting;
- DB connectivity minimal;
- critical downstream availability jika hard dependency;
- cache/client initialized;
- local warmup selesai jika wajib;
- circuit breaker state jika semua dependency critical down;
- shutdown/draining state.

Namun jangan jadikan readiness terlalu mahal.

Anti-pattern:

- readiness melakukan query berat;
- readiness memanggil semua dependency remote dengan timeout panjang;
- readiness gagal jika dependency optional down;
- readiness menyebabkan cascading failure karena semua pod remove themselves dari service saat DB overload;
- readiness endpoint butuh auth normal sehingga probe gagal.

Pattern:

- readiness cepat;
- timeout kecil;
- dependency check minimal;
- dependency critical saja;
- status cached singkat jika perlu;
- berbeda dari deep health check.

### 9.3 Liveness Probe

Liveness menjawab:

> “Apakah process ini stuck secara fatal dan perlu restart?”

Liveness **bukan** dependency check.

Jangan lakukan:

```text
/liveness checks DB, Redis, Kafka, external API
```

Jika DB down, semua pod gagal liveness, Kubernetes restart semua pod, lalu sistem makin kacau.

Liveness sebaiknya memeriksa:

- process masih responsive;
- main event loop/thread bisa menjawab;
- app tidak deadlocked total;
- internal fatal state jika memang unrecoverable.

Untuk Spring Boot, gunakan liveness/readiness groups dengan benar.

### 9.4 Probe Timing

Contoh timing:

```yaml
readinessProbe:
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

Artinya readiness dianggap gagal setelah kira-kira 30 detik kegagalan berulang.

Untuk liveness:

```yaml
livenessProbe:
  periodSeconds: 20
  timeoutSeconds: 2
  failureThreshold: 3
```

Artinya restart setelah sekitar 60 detik gagal.

Jangan terlalu agresif untuk Java service dengan GC pause, cold CPU, atau occasional latency spike.

### 9.5 HTTP vs TCP vs Exec Probe

| Probe Type | Cocok Untuk | Risiko |
|---|---|---|
| HTTP | Web/API Java service | Endpoint salah, auth, dependency overcheck |
| TCP | Hanya cek port terbuka | Port open bukan berarti app ready |
| Exec | Custom command | Overhead, image harus punya shell/tool, bisa lambat |
| gRPC | gRPC service | Butuh health protocol support |

Untuk Java HTTP app, HTTP probe paling umum.

---

## 10. Graceful Shutdown and Pod Termination

Ketika pod dihapus, kubelet mengirim `SIGTERM` ke process utama container dan menunggu `terminationGracePeriodSeconds`. Setelah grace period habis, process bisa dipaksa mati.

Untuk Java:

```text
Pod deletion / rollout / node drain
        ↓
Kubernetes marks pod terminating
        ↓
Endpoint removal begins
        ↓
preStop hook executes, if configured
        ↓
SIGTERM sent to Java process
        ↓
JVM shutdown hooks run
        ↓
Spring/Tomcat/Jetty/Undertow stops accepting new requests
        ↓
In-flight requests finish, if grace period enough
        ↓
DB/message/cache clients close
        ↓
Process exits 0
```

Masalahnya: endpoint removal, load balancer propagation, ingress drain, and app shutdown are not instantaneous.

### 10.1 `terminationGracePeriodSeconds`

Contoh:

```yaml
terminationGracePeriodSeconds: 60
```

Pilih berdasarkan:

- max normal request duration;
- DB transaction duration;
- message processing duration;
- servlet graceful shutdown timeout;
- HTTP server drain time;
- ingress/LB propagation delay;
- preStop duration;
- batch operation behavior.

### 10.2 `preStop` Hook

Sering dipakai untuk memberi delay sebelum SIGTERM atau memanggil drain endpoint.

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
```

`preStop sleep` bukan solusi elegan, tapi sering dipakai untuk memberi waktu endpoint removal menyebar sebelum process benar-benar berhenti.

Alternatif lebih matang:

- app expose `/internal/drain`;
- preStop memanggil drain endpoint;
- readiness berubah false;
- app stop accepting new work;
- wait sampai in-flight selesai;
- process exit.

### 10.3 Java Application Support

Untuk Spring Boot:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Untuk Tomcat/Jetty/Undertow standalone, perlu cek mekanisme shutdown masing-masing.

Untuk message consumer:

- pause consumer;
- stop polling;
- finish in-flight message;
- commit/ack safely;
- close consumer;
- exit.

Untuk scheduler:

- stop scheduling new task;
- decide whether running task completes or aborts;
- persist state;
- release lock.

---

## 11. Rolling Update untuk Java Service

Rolling update mengganti pod lama dengan pod baru secara bertahap.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

Artinya:

- boleh menambah 1 pod ekstra saat rollout;
- tidak boleh mengurangi jumlah available pod.

### 11.1 Timeline Rolling Update

```text
Initial:
  v1 v1 v1

Step 1:
  v1 v1 v1 + v2 starting

Step 2:
  v1 v1 v1 + v2 ready

Step 3:
  terminate one v1

Step 4:
  v1 v1 v2 + v2 starting

Step 5:
  v1 v1 v2 + v2 ready

...

Final:
  v2 v2 v2
```

Selama rollout, aplikasi berjalan mixed-version.

Konsekuensi:

- DB schema harus compatible;
- API harus compatible;
- cache format harus compatible;
- message contract harus compatible;
- session format harus compatible;
- feature flag harus hati-hati.

### 11.2 `maxUnavailable`

`maxUnavailable: 0` bagus untuk availability, tetapi butuh kapasitas ekstra karena `maxSurge`.

Jika cluster tidak punya spare capacity, rollout bisa stuck.

### 11.3 `maxSurge`

`maxSurge: 1` aman untuk service kecil.

Untuk service besar:

```yaml
maxSurge: 25%
maxUnavailable: 0
```

Atau:

```yaml
maxSurge: 1
maxUnavailable: 1
```

Tergantung SLO dan capacity.

### 11.4 Progress Deadline

```yaml
progressDeadlineSeconds: 600
```

Jika pod baru tidak ready dalam waktu ini, deployment dianggap failed/stalled.

Untuk Java app cold-start berat, deadline harus realistis.

---

## 12. Readiness and Rollout Safety

Rolling update hanya aman jika readiness benar.

Jika readiness terlalu cepat success:

```text
Pod marked ready
↓
Service sends traffic
↓
App still warming up / DB pool not ready
↓
5xx spike
```

Jika readiness terlalu strict:

```text
Temporary dependency issue
↓
All pods become unready
↓
Service has no endpoints
↓
Full outage
```

Ideal readiness:

- true saat app bisa melayani traffic;
- false saat pod sedang shutdown/drain;
- false saat dependency critical benar-benar tidak tersedia;
- tidak flapping untuk dependency transient;
- tidak melakukan check mahal;
- timeout kecil;
- clear diagnostic.

---

## 13. ConfigMap and Secret Deployment Patterns

### 13.1 Env Var Pattern

```yaml
env:
  - name: SPRING_PROFILES_ACTIVE
    value: prod
  - name: DB_HOST
    valueFrom:
      configMapKeyRef:
        name: case-service-config
        key: db.host
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: case-service-secret
        key: db.password
```

Kelebihan:

- simple;
- cocok untuk config startup;
- mudah dipakai framework.

Kekurangan:

- tidak reload tanpa restart;
- secret bisa terlihat di environment introspection;
- env var besar tidak ideal;
- struktur config kompleks sulit.

### 13.2 Mounted File Pattern

```yaml
volumeMounts:
  - name: app-config
    mountPath: /app/config
    readOnly: true
volumes:
  - name: app-config
    configMap:
      name: case-service-config-files
```

Aplikasi membaca:

```bash
java -jar app.jar --spring.config.additional-location=file:/app/config/
```

Kelebihan:

- cocok untuk YAML/properties kompleks;
- bisa update di filesystem;
- lebih mirip external config file.

Kekurangan:

- app belum tentu reload;
- symlink/update semantics perlu dipahami;
- permission/mount path bisa salah;
- config drift jika restart tidak dipaksa.

### 13.3 Checksum Annotation Pattern

Agar perubahan ConfigMap/Secret memicu rollout:

```yaml
metadata:
  annotations:
    checksum/config: "{{ sha256sum configmap-content }}"
```

Jika checksum berubah, pod template berubah, Deployment rollout.

Ini umum di Helm/Kustomize/GitOps.

### 13.4 Secret Rotation Pattern

Secret rotation production-grade biasanya butuh:

1. create new secret value;
2. make both old and new credentials valid;
3. rollout app using new secret;
4. verify all pods use new credential;
5. revoke old credential;
6. monitor failures;
7. document evidence.

Jangan hanya mengganti secret object dan berharap semua app reload aman.

---

## 14. Init Containers untuk Java Deployment

Init container berjalan sebelum app container.

Use case:

- wait for dependency minimal;
- download config artifact;
- prepare truststore;
- copy agent;
- run lightweight validation;
- set file permissions on mounted volume;
- schema readiness check, bukan heavy migration.

Contoh:

```yaml
initContainers:
  - name: prepare-truststore
    image: registry.example.com/java-truststore-builder:1.0.0
    command: ["/bin/sh", "-c"]
    args:
      - cp /input/truststore.p12 /work/truststore.p12 && chmod 0440 /work/truststore.p12
    volumeMounts:
      - name: truststore-input
        mountPath: /input
        readOnly: true
      - name: truststore-work
        mountPath: /work
```

Anti-pattern:

- init container infinite wait for DB;
- init container heavy migration uncontrolled;
- init container hides platform failure;
- init container pulls from internet at runtime without caching;
- init container mutates shared state unsafely.

---

## 15. Sidecars and Java

Sidecar adalah container tambahan dalam pod yang berbagi network namespace/volumes.

Contoh sidecar:

- service mesh proxy;
- log shipper;
- metrics exporter;
- certificate reloader;
- local config agent;
- file sync;
- security agent.

Konsekuensi untuk Java:

- memory/cpu total pod bertambah;
- startup ordering bisa kompleks;
- shutdown ordering penting;
- localhost traffic bisa melewati proxy;
- mTLS mesh bisa mengubah connection behavior;
- readiness bisa tergantung sidecar;
- logs/traces bisa diperkaya atau menjadi bottleneck.

Jangan lupa resource sidecar masuk total pod resource.

```text
Pod memory usage = Java container + sidecar + init residue? + volumes/tmpfs
```

---

## 16. Volumes, Filesystem, and Ephemeral Storage

Aplikasi Java sering menulis file tanpa sadar:

- `/tmp`;
- uploaded file temporary;
- generated report;
- heap dump;
- GC logs;
- JFR recording;
- embedded server temp directory;
- font cache;
- native library extraction;
- lucene/index temp;
- multipart upload staging.

Di Kubernetes, container filesystem ephemeral. Saat pod mati, data hilang.

### 16.1 `emptyDir`

Untuk temporary working directory:

```yaml
volumes:
  - name: tmp
    emptyDir:
      sizeLimit: 1Gi
volumeMounts:
  - name: tmp
    mountPath: /tmp
```

Manfaat:

- eksplisit;
- bisa diberi size limit;
- mudah diaudit;
- tidak mencampur dengan image filesystem.

### 16.2 Read-Only Root Filesystem

Security hardening:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Tetapi Java app harus diberi writable path eksplisit:

```yaml
volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: logs-or-dumps
    mountPath: /var/run/app
```

Jika tidak, app bisa gagal karena:

- embedded Tomcat temp;
- Netty native library extraction;
- JFR dump;
- heap dump;
- upload temp;
- font cache.

### 16.3 Heap Dump in Kubernetes

Jika memakai:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Pastikan `/dumps`:

- writable;
- cukup besar;
- tidak memenuhi ephemeral storage node;
- bisa diambil setelah crash;
- tidak menyimpan PII sembarangan;
- punya retention policy.

Heap dump bisa berisi data sensitif.

---

## 17. Security Context untuk Java Pod

Baseline:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  seccompProfile:
    type: RuntimeDefault
containers:
  - name: app
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
```

Manfaat:

- mengurangi blast radius;
- mencegah root container;
- mengurangi capability OS;
- membuat write path eksplisit;
- lebih sesuai policy enterprise.

Namun cek compatibility:

- port <1024 butuh privilege/capability;
- truststore path readable;
- temp path writable;
- mounted secret permission;
- app server write directory;
- JFR/heap dump path;
- native library extraction.

---

## 18. Service Account, RBAC, and Java App Permissions

Default pod sering memakai service account default. Ini buruk.

Pattern:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: case-service
```

Deployment:

```yaml
spec:
  serviceAccountName: case-service
```

Jika aplikasi tidak perlu akses Kubernetes API, jangan beri RBAC tambahan.

Anti-pattern:

- semua pod memakai `default` service account;
- service account punya cluster-admin;
- token automount aktif padahal tidak perlu.

Jika tidak perlu token:

```yaml
spec:
  automountServiceAccountToken: false
```

Tetapi perhatikan service mesh/agent/platform tertentu mungkin membutuhkan token.

---

## 19. Scheduling: Node, Zone, Affinity, Anti-Affinity, Spread

Untuk availability, replica Java service tidak boleh semua jatuh ke satu node/zone.

### 19.1 Pod Anti-Affinity

```yaml
podAntiAffinity:
  preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchLabels:
            app.kubernetes.io/name: case-service
        topologyKey: kubernetes.io/hostname
```

Ini mendorong replica tersebar antar node.

### 19.2 Topology Spread Constraints

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: case-service
```

Tujuan:

- mengurangi single-zone failure;
- menjaga rollout stabil;
- meningkatkan resilience.

### 19.3 Node Selector / Affinity

Gunakan jika workload butuh node tertentu:

- memory-optimized nodes;
- compute-optimized nodes;
- intranet/internet zone;
- GPU/native requirement;
- compliance-isolated node;
- architecture x86/arm.

Namun terlalu ketat bisa membuat pod pending.

---

## 20. PodDisruptionBudget

PDB membatasi voluntary disruption.

Contoh:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: case-service-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: case-service
```

Manfaat:

- node drain tidak mematikan terlalu banyak replica sekaligus;
- cluster maintenance lebih aman;
- availability lebih terjaga.

Tapi PDB bukan magic:

- tidak mencegah node crash;
- tidak mencegah OOMKilled;
- bisa menghambat node upgrade jika replica terlalu sedikit;
- harus disesuaikan dengan replica count.

Jika replicas = 1 dan minAvailable = 1, node drain bisa blocked.

---

## 21. HPA untuk Java: Jangan Hanya CPU Kalau Signal Salah

Contoh HPA:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: case-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: case-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

CPU-based HPA cocok jika CPU utilization berkorelasi dengan saturation.

Untuk Java IO-bound API, saturation bisa muncul sebagai:

- thread pool penuh;
- DB pool penuh;
- latency naik;
- queue waiting;
- request timeout;
- downstream slow;
- GC overhead;
- memory pressure.

Metric yang sering lebih baik:

- request rate per pod;
- p95/p99 latency;
- active requests;
- servlet thread pool utilization;
- DB pool usage;
- queue depth;
- Kafka consumer lag;
- RabbitMQ queue length;
- custom business backlog.

Namun custom metric lebih kompleks. Jangan memakai metric yang mudah flapping.

### 21.1 HPA and Java Startup

Jika startup 90 detik, autoscaling reaktif akan terlambat.

Mitigasi:

- min replicas cukup;
- predictive/scheduled scaling untuk traffic pattern;
- optimize startup;
- reduce image pull time;
- warmup endpoint;
- avoid cold dependency initialization on first request;
- use canary/pre-warming for critical service.

---

## 22. Java Agent Deployment in Kubernetes

Java agent umum:

- OpenTelemetry Java agent;
- APM agent;
- security agent;
- profiler agent;
- JMX exporter agent;
- custom instrumentation.

Pattern:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -javaagent:/otel/opentelemetry-javaagent.jar
      -Dotel.service.name=case-service
      -Dotel.exporter.otlp.endpoint=http://otel-collector:4317
```

Agent delivery options:

1. baked into image;
2. init container copies agent to shared volume;
3. sidecar/auto-instrumentation operator;
4. mounted volume from platform.

Trade-off:

| Pattern | Kelebihan | Risiko |
|---|---|---|
| Baked into image | Reproducible | Update agent butuh rebuild |
| Init container | Centralized | Runtime dependency tambahan |
| Operator injection | Easy adoption | Less explicit, surprise changes |
| Mounted volume | Flexible | Version drift |

Agent overhead harus dihitung:

- memory;
- startup time;
- CPU;
- network;
- cardinality;
- classloading;
- compatibility with Java version.

---

## 23. JVM Diagnostics in Kubernetes

Production Java di Kubernetes harus punya cara mengambil evidence.

### 23.1 Logs

Aplikasi harus log ke stdout/stderr.

```text
Java app -> stdout/stderr -> container runtime -> log collector
```

Jangan hanya log ke file internal container kecuali ada sidecar/volume strategy.

### 23.2 Thread Dump

Cara umum:

- `jcmd <pid> Thread.print`;
- `jstack` jika tersedia;
- actuator threaddump endpoint, jika aman;
- `kill -3 <pid>` dumps to stdout for HotSpot;
- ephemeral debug container jika cluster mendukung dan image minim tools.

Jika memakai distroless, tool tidak ada. Solusinya:

- debug variant image;
- ephemeral container dengan tools;
- JDK tools mounted;
- JFR/actuator endpoints;
- sidecar diagnostics.

### 23.3 Heap Dump

Harus hati-hati karena:

- ukuran besar;
- data sensitif;
- bisa memenuhi disk;
- butuh upload/retention;
- sulit diambil setelah pod mati.

### 23.4 JFR

JFR sangat berguna untuk production diagnosis:

```bash
-XX:StartFlightRecording=filename=/recordings/startup.jfr,dumponexit=true,settings=profile
```

Namun butuh storage strategy.

### 23.5 GC Logs

Modern Java:

```bash
-Xlog:gc*:stdout:time,uptime,level,tags
```

Java 8 legacy berbeda.

Pastikan log collector tidak overwhelmed.

---

## 24. Network Policies and Java Services

NetworkPolicy membatasi traffic antar pod.

Untuk Java microservice:

- allow ingress dari gateway/service tertentu;
- allow egress ke DB/cache/broker/external API tertentu;
- block default lateral movement;
- isolate admin endpoints.

Contoh konsep:

```text
case-service may call:
- oracle-db
- redis
- rabbitmq
- document-service
- otel-collector

case-service may receive from:
- api-gateway
- internal worker
```

Tanpa egress policy, pod compromise bisa memanggil banyak target internal.

Tetapi NetworkPolicy butuh CNI support.

---

## 25. Ingress/Gateway Timeout Alignment

Java app timeout harus konsisten dari edge sampai backend.

```text
Client timeout
↓
CDN/WAF/API Gateway timeout
↓
Ingress timeout
↓
Service proxy timeout
↓
Java server timeout
↓
DB/downstream timeout
```

Jika urutan timeout salah:

- ingress timeout dulu, Java masih kerja sia-sia;
- DB timeout lebih lama dari HTTP timeout;
- client retry menyebabkan duplicate operation;
- pod dianggap slow lalu liveness gagal;
- thread pool habis.

Prinsip:

> Timeout paling dalam harus lebih pendek dari timeout caller, dan semua retry harus idempotent-aware.

Untuk deployment, dokumentasikan timeout sebagai contract.

---

## 26. Environment Parity in Kubernetes

DEV/SIT/UAT/PROD sering berbeda:

- replica count;
- resource limit;
- node type;
- ingress controller;
- DB size;
- secret provider;
- DNS;
- TLS cert;
- external endpoint;
- autoscaling;
- PDB;
- network policy;
- service mesh;
- observability.

Semakin jauh perbedaannya, semakin banyak deployment bug baru muncul di PROD.

Minimal parity untuk Java deployment:

- same image;
- same Java runtime;
- same JVM option pattern;
- same health endpoint behavior;
- same config key names;
- same secret injection pattern;
- same startup/shutdown behavior;
- same migration strategy;
- same log format;
- same observability agent version, jika memungkinkan.

Boleh beda value, jangan beda mekanisme tanpa alasan.

---

## 27. GitOps/Helm/Kustomize View

Kubernetes deployment jarang ditulis manual langsung ke cluster.

Umum:

- Helm chart;
- Kustomize overlays;
- Argo CD;
- Flux;
- Jenkins/GitLab/GitHub Actions applying manifests;
- platform templates.

### 27.1 Helm Values Risk

Helm memudahkan reuse, tetapi bisa menyembunyikan kontrak penting.

Risk:

- default values tidak production-safe;
- resource/probe kosong;
- secret inline di values;
- template terlalu magical;
- chart upgrade mengubah behavior tersembunyi;
- checksum annotation lupa;
- env var typo sulit terlihat.

### 27.2 Kustomize Overlay Pattern

```text
base/
  deployment.yaml
  service.yaml
  configmap.yaml

overlays/dev/
  kustomization.yaml
  patch-resources.yaml

overlays/prod/
  kustomization.yaml
  patch-replicas.yaml
  patch-resources.yaml
  patch-ingress.yaml
```

Kelebihan:

- manifest tetap terlihat;
- environment diff eksplisit;
- cocok untuk GitOps.

### 27.3 GitOps Principle

Cluster state harus bisa dijelaskan dari Git:

```text
Git desired state -> reconciler -> cluster state
```

Untuk auditability:

- siapa mengubah deployment;
- image apa yang dirilis;
- config apa yang berubah;
- kapan rollout;
- commit apa;
- approval apa;
- rollback ke revision mana.

---

## 28. Common Java-on-Kubernetes Failure Modes

### 28.1 CrashLoopBackOff Because Bad JVM Flag

Gejala:

```text
Unrecognized VM option '...'
```

Penyebab:

- flag Java 17 dipakai di Java 8;
- flag lama dihapus di Java baru;
- typo `JAVA_TOOL_OPTIONS`;
- image runtime berbeda dari asumsi.

Mitigasi:

- runtime version pinned;
- startup smoke test;
- CI validates JVM flags;
- separate flags per Java baseline;
- inspect logs and exit code.

### 28.2 OOMKilled Despite Heap Not Full

Penyebab:

- native memory;
- direct buffers;
- thread stacks;
- metaspace;
- agent overhead;
- heap too close to container limit;
- memory leak outside heap;
- file mmap;
- sidecar counted in pod total? container limit per container but node pressure still relevant.

Mitigasi:

- MaxRAMPercentage conservative;
- Native Memory Tracking in diagnostics env;
- memory headroom;
- reduce thread count;
- monitor RSS/container memory;
- heap dump + JFR + NMT if reproducible.

### 28.3 Readiness True Too Early

Penyebab:

- endpoint returns UP before app initialized;
- readiness equals liveness;
- DB pool lazy initializes on first request;
- cache warmup async not complete.

Mitigasi:

- startup probe;
- readiness group;
- explicit warmup state;
- dependency validation;
- synthetic post-deploy test.

### 28.4 Liveness Kills Healthy-but-Slow Pod

Penyebab:

- liveness timeout too low;
- DB dependency in liveness;
- CPU throttling;
- GC pause;
- node pressure;
- thread pool saturation.

Mitigasi:

- liveness only local process health;
- increase thresholds;
- remove dependency checks;
- monitor throttling and GC.

### 28.5 Rollout Stuck

Penyebab:

- pod pending due resource;
- image pull error;
- startup too slow;
- readiness never true;
- config/secret missing;
- network policy blocks dependency;
- migration lock.

Mitigasi:

- describe deployment/pod;
- inspect events;
- check image pull secret;
- check resource quota;
- check logs;
- validate config/secret;
- use progress deadline.

### 28.6 Old and New Version Conflict

Penyebab:

- DB schema not backward compatible;
- cache format changed;
- message schema changed;
- session serialization changed;
- API contract broken.

Mitigasi:

- expand-contract migration;
- versioned message schema;
- feature flags;
- canary;
- compatibility tests;
- avoid destructive DB changes in same release.

### 28.7 All Replicas on Same Node

Penyebab:

- no topology spread;
- scheduler packs pods;
- resource constraints.

Mitigasi:

- topology spread constraints;
- anti-affinity;
- capacity planning;
- PDB.

### 28.8 Config Change Not Applied

Penyebab:

- ConfigMap changed but pod not restarted;
- env var immutable after start;
- mounted file changed but app doesn't reload;
- checksum annotation missing.

Mitigasi:

- rollout restart;
- checksum annotation;
- config reload mechanism;
- deployment evidence.

### 28.9 Secret Rotation Causes Outage

Penyebab:

- old credential revoked before all pods updated;
- connection pool keeps old connection;
- secret mounted but app does not reload;
- no dual-validity window.

Mitigasi:

- staged rotation;
- restart rollout;
- verify active credential;
- revoke after confirmation;
- monitoring.

---

## 29. Production-Grade Manifest Blueprint

Berikut blueprint yang lebih lengkap.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
  labels:
    app.kubernetes.io/name: case-service
    app.kubernetes.io/component: backend-api
    app.kubernetes.io/part-of: enforcement-platform
spec:
  replicas: 4
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 600
  selector:
    matchLabels:
      app.kubernetes.io/name: case-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: case-service
        app.kubernetes.io/component: backend-api
        app.kubernetes.io/part-of: enforcement-platform
        app.kubernetes.io/version: "1.42.0"
      annotations:
        checksum/config: "RENDERED_CONFIG_CHECKSUM"
    spec:
      serviceAccountName: case-service
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 75
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: case-service
      containers:
        - name: app
          image: registry.example.com/case-service:1.42.0@sha256:REPLACE_WITH_DIGEST
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          ports:
            - name: http
              containerPort: 8080
            - name: management
              containerPort: 8081
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=65
                -XX:+ExitOnOutOfMemoryError
                -Dfile.encoding=UTF-8
                -Duser.timezone=UTC
                -Djava.security.egd=file:/dev/urandom
            - name: SPRING_PROFILES_ACTIVE
              value: prod
          envFrom:
            - configMapRef:
                name: case-service-config
            - secretRef:
                name: case-service-secret
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: dumps
              mountPath: /dumps
          resources:
            requests:
              cpu: "750m"
              memory: "1024Mi"
            limits:
              memory: "1536Mi"
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 36
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            periodSeconds: 20
            timeoutSeconds: 2
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 1Gi
        - name: dumps
          emptyDir:
            sizeLimit: 2Gi
```

Catatan:

- CPU limit sengaja tidak dipasang di contoh untuk menghindari throttling; ini harus cocok dengan policy cluster.
- Management port dipisah agar endpoint actuator/probe tidak selalu terekspos ke public traffic.
- `automountServiceAccountToken: false` hanya aman jika app/mesh tidak butuh token.
- `readOnlyRootFilesystem` butuh writable `/tmp` dan `/dumps`.
- Heap dump di emptyDir hilang saat pod hilang; untuk forensic, butuh extraction mechanism.

---

## 30. Service Blueprint

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-service
  labels:
    app.kubernetes.io/name: case-service
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: case-service
  ports:
    - name: http
      port: 80
      targetPort: http
```

Jika management endpoint tidak boleh diekspos, jangan masukkan port management ke public Service.

Bisa buat Service internal terpisah untuk monitoring jika perlu:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-service-management
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: case-service
  ports:
    - name: management
      port: 8081
      targetPort: management
```

---

## 31. PDB Blueprint

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: case-service
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: case-service
```

Jika replicas = 4, minAvailable = 3 berarti satu voluntary disruption diperbolehkan.

---

## 32. HPA Blueprint

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: case-service
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: case-service
  minReplicas: 4
  maxReplicas: 12
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

Untuk service kritikal, scale down harus lebih konservatif daripada scale up.

---

## 33. Decision Framework: Sebelum Deploy Java ke Kubernetes

Tanyakan ini sebelum manifest dianggap production-ready.

### 33.1 Runtime

- Java version apa?
- JDK distribution apa?
- Apakah runtime image immutable?
- Apakah JVM flags valid untuk versi tersebut?
- Apakah container-aware behavior sudah dipahami?

### 33.2 Artifact

- Fat JAR, layered JAR, WAR, native image, atau custom runtime?
- Apakah image punya user non-root?
- Apakah writable path eksplisit?
- Apakah diagnostics tool tersedia atau ada debug plan?

### 33.3 Resource

- Berapa memory limit?
- Berapa heap percentage?
- Berapa native memory headroom?
- Apakah CPU limit dipakai?
- Apakah request cukup untuk startup dan steady traffic?
- Apakah sidecar overhead dihitung?

### 33.4 Lifecycle

- Berapa startup time realistis?
- Apakah startup probe cukup?
- Apakah readiness benar?
- Apakah liveness tidak over-check dependency?
- Apakah graceful shutdown aktif?
- Apakah termination grace cukup?
- Apakah preStop perlu?

### 33.5 Traffic

- Service selector stabil?
- Ingress timeout cocok?
- Proxy headers benar?
- Management endpoint tidak terekspos publik?
- TLS termination jelas?

### 33.6 State

- Apakah app stateless?
- Jika ada session, di mana session disimpan?
- Jika ada scheduler, bagaimana menghindari duplicate run?
- Jika ada message consumer, bagaimana drain/ack saat shutdown?

### 33.7 Config/Secret

- Config non-secret dan secret dipisah?
- Secret rotation plan ada?
- Perubahan config trigger rollout?
- Sensitive value tidak muncul di logs?

### 33.8 Rollout

- Rolling update parameter sesuai capacity?
- Mixed-version compatibility aman?
- DB schema backward compatible?
- Rollback realistis?
- Deployment verification ada?

### 33.9 Observability

- Log structured?
- Metrics tersedia?
- Tracing tersedia?
- JFR/thread dump/heap dump strategy ada?
- Dashboard per version/replica tersedia?
- Alert terkait rollout ada?

### 33.10 Governance

- Image traceable ke commit?
- Config change traceable?
- Approval/evidence cukup?
- Runbook tersedia?
- Ownership label jelas?

---

## 34. Top 1% Mental Model

Engineer biasa melihat Kubernetes deployment sebagai YAML.

Engineer senior melihatnya sebagai rollout mechanism.

Top 1% deployment engineer melihatnya sebagai **distributed runtime contract** antara:

```text
Application semantics
JVM behavior
Container boundary
Kubernetes lifecycle
Network routing
State dependencies
Release strategy
Operational evidence
Governance requirements
```

Kubernetes tidak menyelesaikan masalah deployment. Kubernetes hanya memberi primitive yang bisa membuat deployment lebih aman atau lebih berbahaya tergantung kontraknya.

Untuk Java, kontrak paling penting adalah:

1. **Startup contract**  
   Kapan app dianggap mulai? Kapan boleh dibunuh? Kapan boleh diberi traffic?

2. **Readiness contract**  
   Apa arti “boleh menerima request” secara teknis dan bisnis?

3. **Liveness contract**  
   Apa arti “harus direstart” tanpa menimbulkan cascading restart?

4. **Memory contract**  
   Bagaimana heap, native memory, threads, agent, and sidecars hidup dalam container limit?

5. **Shutdown contract**  
   Bagaimana request/message/transaction selesai ketika pod diganti?

6. **Compatibility contract**  
   Bagaimana old dan new version hidup bersama saat rolling update?

7. **State contract**  
   State apa yang lokal, eksternal, durable, idempotent, atau recoverable?

8. **Configuration contract**  
   Apa yang immutable di image, apa yang external, apa yang secret, apa yang reloadable?

9. **Observability contract**  
   Evidence apa yang tersedia saat deployment gagal?

10. **Rollback contract**  
   Apakah rollback benar-benar mengembalikan sistem, atau hanya mengganti image?

---

## 35. Ringkasan

Kubernetes deployment untuk Java bukan sekadar membuat manifest.

Yang harus dipahami:

- Pod adalah execution slot sementara untuk JVM process.
- Deployment mengganti pod, bukan mengubah process in-place.
- Rolling update berarti old dan new version berjalan bersamaan.
- Service routing bergantung pada readiness.
- Liveness yang salah bisa menyebabkan restart storm.
- Startup Java butuh startup probe yang realistis.
- Memory limit harus mencakup heap dan native memory.
- CPU limit bisa menyebabkan throttling dan latency spike.
- ConfigMap/Secret update tidak otomatis berarti aplikasi memakai value baru.
- Graceful shutdown wajib untuk HTTP request, message consumer, scheduler, dan transaction safety.
- Observability dan diagnostics harus dirancang sebelum incident.
- YAML adalah hasil akhir dari reasoning, bukan pengganti reasoning.

Jika Anda bisa menjelaskan manifest Kubernetes sebagai kontrak runtime Java, bukan hanya resource declaration, Anda sudah naik level dari “bisa deploy” menjadi “bisa merancang deployment yang aman”.

---

## 36. Checklist Praktis

Sebelum production deploy Java app ke Kubernetes:

- [ ] Image immutable, bukan `latest`.
- [ ] Java version dan vendor jelas.
- [ ] JVM flags cocok dengan Java version.
- [ ] `JAVA_TOOL_OPTIONS` terdokumentasi.
- [ ] Heap percentage tidak terlalu dekat dengan memory limit.
- [ ] Native memory headroom tersedia.
- [ ] CPU request realistis.
- [ ] CPU limit sengaja dipilih atau sengaja dihindari.
- [ ] Startup probe ada untuk app slow start.
- [ ] Readiness endpoint benar-benar merepresentasikan traffic readiness.
- [ ] Liveness tidak bergantung pada DB/external dependency.
- [ ] Graceful shutdown aktif di framework/server.
- [ ] `terminationGracePeriodSeconds` cukup.
- [ ] preStop/drain strategy dipahami.
- [ ] ConfigMap/Secret injection jelas.
- [ ] Config/Secret change rollout strategy ada.
- [ ] Writable paths eksplisit.
- [ ] Root filesystem bisa dibuat read-only atau alasannya jelas jika tidak.
- [ ] Container berjalan non-root.
- [ ] Service account least privilege.
- [ ] Service selector stabil.
- [ ] Management endpoint tidak terekspos publik.
- [ ] Replica tersebar antar node/zone jika critical.
- [ ] PDB sesuai replica count.
- [ ] HPA metric sesuai saturation signal.
- [ ] Rollout strategy sesuai capacity.
- [ ] Mixed-version compatibility sudah diuji.
- [ ] DB migration tidak mematahkan old version.
- [ ] Logs, metrics, traces tersedia.
- [ ] Thread dump/heap dump/JFR strategy ada.
- [ ] Rollback plan realistis.
- [ ] Runbook tersedia.

---

## 37. Latihan Pemahaman

### Latihan 1 — Review Manifest

Ambil manifest Kubernetes Java service di project Anda. Jawab:

1. Apa arti readiness endpoint-nya?
2. Apa yang terjadi jika DB down?
3. Apakah liveness akan restart semua pod saat dependency down?
4. Apakah memory limit cukup untuk heap + native memory?
5. Apakah shutdown memberi waktu in-flight request selesai?
6. Apakah old dan new version bisa berjalan bersama?
7. Apakah config update memicu rollout?
8. Apakah secret rotation aman?

### Latihan 2 — Design Deployment Contract

Untuk service Java berikut:

```text
Spring Boot REST API
- Java 21
- startup 75 detik
- p95 request 300ms
- max normal request 15 detik
- DB Oracle
- Redis cache
- RabbitMQ publisher
- OpenTelemetry agent
- 4 replicas
```

Desain:

- resource request/limit;
- JVM memory percentage;
- startup/readiness/liveness probe;
- terminationGracePeriodSeconds;
- rollout strategy;
- PDB;
- config/secret injection;
- diagnostics strategy.

### Latihan 3 — Failure Diagnosis

Deployment stuck dengan gejala:

```text
New pods start, but readiness never becomes true.
Old pods remain running.
Deployment progress deadline exceeded.
```

Susun diagnosis tree:

- image pull?
- process running?
- logs?
- config/secret?
- dependency blocked?
- network policy?
- readiness endpoint path/port?
- startup time?
- DB migration lock?
- resource throttling?

---

## 38. Referensi Teknis

- Kubernetes Documentation — Pods, Deployments, Services, ConfigMaps, Secrets, Probes, Resource Management, Pod Lifecycle.
- Kubernetes Documentation — Configure Liveness, Readiness and Startup Probes.
- Kubernetes Documentation — Resource Management for Pods and Containers.
- Kubernetes Documentation — Pod Lifecycle and Termination.
- Spring Boot Documentation — Actuator Kubernetes Probes and Graceful Shutdown.
- OpenJDK / Oracle Java documentation — Java command, JVM options, container support behavior.

---

## 39. Penutup Part 14

Part ini membahas Kubernetes sebagai runtime deployment layer untuk aplikasi Java.

Kita belum masuk terlalu dalam ke satu area khusus seperti graceful shutdown, resource sizing, rollout strategy, atau database-aware deployment karena masing-masing punya part sendiri setelah ini.

Bagian berikutnya akan memperbesar satu topik yang paling sering menjadi sumber incident:

> **Part 15 — Kubernetes Probes, Graceful Shutdown, and Traffic Draining**

Di sana kita akan membedah secara jauh lebih detail bagaimana startup/readiness/liveness, endpoint removal, SIGTERM, preStop, load balancer propagation, servlet shutdown, message consumer drain, dan transaction boundary bekerja bersama.

**Status series:** belum selesai. Saat ini selesai sampai **Part 14 dari 35**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java Deployment Runtime Release Delivery Engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-13-spring-boot-deployment-deep-dive.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Deployment Runtime Release Delivery Engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-15-kubernetes-probes-graceful-shutdown-traffic-draining.md)
