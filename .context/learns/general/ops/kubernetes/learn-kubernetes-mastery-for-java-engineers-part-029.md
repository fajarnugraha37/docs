# learn-kubernetes-mastery-for-java-engineers-part-029.md

# Part 029 — Java Microservices on Kubernetes: Production Runtime Blueprint

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Bagian: `029 / 035`  
> Topik: Java microservices production blueprint di Kubernetes  
> Target pembaca: Java software engineer / tech lead yang sudah memahami Docker, Linux, HTTP, database, messaging, dan dasar Kubernetes dari Part 000–028.

---

## 1. Tujuan Part Ini

Part ini menyatukan banyak konsep sebelumnya menjadi satu blueprint praktis untuk menjalankan **Java microservice** di Kubernetes secara production-grade.

Kita tidak akan mengulang:

- dasar Dockerfile,
- dasar HTTP,
- dasar Spring Boot,
- dasar JVM,
- dasar database,
- dasar Kafka/RabbitMQ,
- dasar Linux.

Yang akan kita lakukan adalah menyusun **runtime contract** antara aplikasi Java dan Kubernetes.

Setelah part ini, kamu diharapkan mampu:

1. Mendesain manifest Kubernetes baseline untuk Java service.
2. Menentukan resource request/limit yang masuk akal untuk JVM.
3. Mendesain health endpoint yang tidak menyebabkan false restart atau false ready.
4. Menghubungkan config, secret, rollout, autoscaling, dan observability menjadi satu runtime model.
5. Menentukan kapan masalah berasal dari aplikasi, container, Kubernetes object, node, networking, dependency, atau delivery pipeline.
6. Menghindari anti-pattern umum seperti:
   - liveness probe yang terlalu agresif,
   - readiness probe yang berbohong,
   - memory limit yang tidak mempertimbangkan non-heap,
   - HPA berbasis CPU untuk workload yang bottleneck-nya database,
   - secret masuk environment variable tanpa alasan kuat,
   - rollout sukses tetapi release gagal secara semantik.

---

## 2. Mental Model Utama

Java service di Kubernetes bukan hanya process Java di dalam container.

Ia adalah **gabungan beberapa kontrak**:

```text
Java application
  -> JVM runtime contract
  -> container runtime contract
  -> Pod lifecycle contract
  -> Deployment rollout contract
  -> Service discovery contract
  -> health/probe contract
  -> config/secret contract
  -> resource/scheduling contract
  -> autoscaling contract
  -> observability contract
  -> security contract
  -> delivery/GitOps contract
```

Jika salah satu kontrak ini kabur, service bisa terlihat “running” tetapi tidak benar-benar reliable.

Contoh:

```text
Pod Running
Service exists
Ingress route exists
HPA active
logs normal

Tetapi:
- readiness terlalu longgar,
- app menerima traffic sebelum connection pool siap,
- GC pause tinggi karena CPU throttling,
- HPA scale out menambah koneksi DB sampai DB saturasi,
- rollout dianggap sukses padahal consumer group rebalance storm,
- secret sudah rotate tetapi app masih memakai credential lama.
```

Production readiness bukan status tunggal. Ia adalah kombinasi invariant.

---

## 3. Blueprint Object Graph

Untuk satu Java REST microservice production-grade, object graph minimal biasanya seperti ini:

```text
Namespace
  ├── ServiceAccount
  ├── ConfigMap
  ├── Secret / ExternalSecret / projected secret
  ├── Deployment
  │     └── ReplicaSet
  │           └── Pods
  ├── Service
  │     └── EndpointSlices
  ├── Ingress / HTTPRoute
  ├── HorizontalPodAutoscaler
  ├── PodDisruptionBudget
  ├── NetworkPolicy
  ├── ServiceMonitor / PodMonitor / telemetry config
  └── policy/admission constraints
```

Untuk Java worker service, object graph-nya mirip tetapi bisa berbeda:

```text
Namespace
  ├── ServiceAccount
  ├── ConfigMap
  ├── Secret
  ├── Deployment / Job / CronJob
  ├── HPA or event-driven scaler
  ├── PodDisruptionBudget, if long-running worker
  ├── NetworkPolicy
  └── observability config
```

Untuk scheduled task:

```text
CronJob
  └── Job
        └── Pod
```

Untuk one-off migration:

```text
Job
  └── Pod
```

Jangan memaksakan semua workload Java masuk Deployment. Deployment cocok untuk long-running service. Job cocok untuk finite task. CronJob cocok untuk scheduled finite task. StatefulSet hanya jika benar-benar butuh identity stabil dan biasanya bukan default untuk microservice Java biasa.

---

## 4. Reference Runtime Contract untuk Java Service

Sebuah service Java production-grade harus menjawab pertanyaan berikut.

### 4.1 Identity

```text
Apa nama service ini?
Namespace apa?
Label apa yang menjadi identity?
ServiceAccount apa yang dipakai?
Apakah ia perlu akses Kubernetes API?
Apakah ia perlu cloud identity?
```

Invariant:

```text
Label identity harus stabil dan konsisten di Deployment, Pod template, Service selector, NetworkPolicy, metrics, log, dan cost allocation.
```

Contoh label baseline:

```yaml
labels:
  app.kubernetes.io/name: payment-api
  app.kubernetes.io/instance: payment-api-prod
  app.kubernetes.io/component: api
  app.kubernetes.io/part-of: payment-platform
  app.kubernetes.io/managed-by: gitops
  app.kubernetes.io/version: "1.42.0"
```

### 4.2 Lifecycle

```text
Bagaimana service start?
Kapan dianggap live?
Kapan dianggap ready?
Bagaimana ia shutdown?
Berapa lama waktu shutdown aman?
Apakah ia perlu drain traffic?
Apakah ia perlu stop consuming message sebelum mati?
```

Invariant:

```text
Running != Ready != Correct.
```

### 4.3 Resource Envelope

```text
Berapa CPU minimum agar latency stabil?
Berapa memory container limit?
Berapa heap maksimum?
Berapa non-heap budget?
Berapa thread count maksimum?
Berapa direct buffer maksimum?
Berapa connection pool maksimum?
```

Invariant:

```text
Container memory limit harus lebih besar dari heap + non-heap + thread stacks + direct buffers + native memory + safety margin.
```

### 4.4 Dependency Contract

```text
Dependency apa yang dipakai?
Database?
Redis?
Kafka?
RabbitMQ?
External API?
Secret apa?
Timeout apa?
Retry apa?
Circuit breaker apa?
Connection pool apa?
```

Invariant:

```text
Scaling app tidak boleh tanpa sadar melampaui kapasitas dependency.
```

### 4.5 Traffic Contract

```text
Apakah service menerima HTTP?
Apakah menerima gRPC?
Apakah hanya internal?
Apakah external?
Apakah melewati Ingress/Gateway/service mesh?
Apakah membutuhkan sticky session?
Apakah connection draining benar?
```

Invariant:

```text
Readiness harus mengontrol endpoint publication.
```

### 4.6 Observability Contract

```text
Apa metric utama?
Apa log fields wajib?
Apa trace propagation header?
Apa alert SLO?
Apa dashboard minimum?
Bagaimana korelasi Pod, version, request, trace, dependency?
```

Invariant:

```text
Saat incident, engineer harus bisa membedakan app bug, rollout bug, resource bug, node bug, network bug, dependency bug, dan platform bug.
```

---

## 5. Baseline Manifest: ServiceAccount

Default ServiceAccount sering terlalu ambigu. Untuk service production, buat ServiceAccount eksplisit.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payment-api
  namespace: payments
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
automountServiceAccountToken: false
```

Default rule:

```text
Jika aplikasi tidak perlu memanggil Kubernetes API, jangan mount ServiceAccount token.
```

Jika service perlu cloud identity, gunakan mekanisme workload identity dari platform cloud/cluster kamu, bukan menyimpan long-lived cloud key sebagai Secret biasa.

---

## 6. Baseline Manifest: ConfigMap

ConfigMap cocok untuk konfigurasi non-sensitive.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: payment-api-config
  namespace: payments
  labels:
    app.kubernetes.io/name: payment-api
data:
  SPRING_PROFILES_ACTIVE: "prod"
  SERVER_PORT: "8080"
  MANAGEMENT_SERVER_PORT: "8081"
  LOG_LEVEL_ROOT: "INFO"
  DB_POOL_MAX_SIZE: "20"
  HTTP_CLIENT_CONNECT_TIMEOUT_MS: "500"
  HTTP_CLIENT_READ_TIMEOUT_MS: "2000"
```

Prinsip:

```text
ConfigMap boleh berisi konfigurasi operasional.
ConfigMap tidak boleh berisi password, token, private key, credential, atau secret material.
```

Untuk Java service, pisahkan:

```text
Application config:
- active profile
- timeout
- pool size
- feature toggle non-sensitive
- log level

Secret config:
- DB password
- API token
- client certificate key
- signing key
```

---

## 7. Baseline Manifest: Secret Reference

Secret bisa dipakai melalui environment variable atau mounted file. Untuk secret kecil seperti password DB, env var sering dipakai, tetapi memiliki risiko lebih mudah bocor melalui process environment, debug dump, atau accidental log.

Mounted file sering lebih baik untuk:

- certificate,
- private key,
- truststore,
- token yang perlu dirotasi,
- secret yang tidak seharusnya tampil di environment.

Contoh Secret reference sebagai env:

```yaml
env:
  - name: DB_USERNAME
    valueFrom:
      secretKeyRef:
        name: payment-api-db
        key: username
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: payment-api-db
        key: password
```

Contoh Secret mounted sebagai file:

```yaml
volumes:
  - name: payment-api-tls
    secret:
      secretName: payment-api-tls

containers:
  - name: app
    volumeMounts:
      - name: payment-api-tls
        mountPath: /etc/payment-api/tls
        readOnly: true
```

Important invariant:

```text
Secret update tidak otomatis berarti aplikasi sudah memakai secret baru.
```

Ada tiga pola:

1. Restart Pod saat secret berubah.
2. App reload mounted file dengan mekanisme watch/poll.
3. Sidecar/agent mengelola secret rotation.

Untuk Java service biasa, pola paling mudah diaudit adalah restart terkontrol saat secret berubah.

---

## 8. Baseline Manifest: Deployment

Berikut baseline Deployment untuk REST API Java.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/instance: payment-api-prod
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: payment-platform
    app.kubernetes.io/managed-by: gitops
spec:
  replicas: 3
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 600
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
      app.kubernetes.io/instance: payment-api-prod
  template:
    metadata:
      labels:
        app.kubernetes.io/name: payment-api
        app.kubernetes.io/instance: payment-api-prod
        app.kubernetes.io/component: api
        app.kubernetes.io/part-of: payment-platform
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8081"
        prometheus.io/path: "/actuator/prometheus"
    spec:
      serviceAccountName: payment-api
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 45
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: registry.example.com/payment-api@sha256:REPLACE_WITH_DIGEST
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
            - name: management
              containerPort: 8081
          envFrom:
            - configMapRef:
                name: payment-api-config
          env:
            - name: JAVA_TOOL_OPTIONS
              value: >-
                -XX:MaxRAMPercentage=70
                -XX:InitialRAMPercentage=50
                -XX:+ExitOnOutOfMemoryError
                -Dfile.encoding=UTF-8
                -Duser.timezone=UTC
            - name: DB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: payment-api-db
                  key: username
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: payment-api-db
                  key: password
          resources:
            requests:
              cpu: "500m"
              memory: "768Mi"
            limits:
              memory: "1024Mi"
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            failureThreshold: 30
            periodSeconds: 5
            timeoutSeconds: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: management
            initialDelaySeconds: 0
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: management
            initialDelaySeconds: 0
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - "sleep 10"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: app-cache
              mountPath: /app/cache
      volumes:
        - name: tmp
          emptyDir: {}
        - name: app-cache
          emptyDir: {}
```

Catatan penting:

1. Image memakai digest, bukan mutable tag.
2. CPU limit tidak dipasang di contoh baseline untuk mengurangi risiko throttling, tetapi ini bergantung policy platform.
3. Memory limit tetap dipasang agar runaway memory tidak membunuh node.
4. `readOnlyRootFilesystem: true` membutuhkan mount eksplisit untuk `/tmp` atau path yang ditulis aplikasi.
5. Management port dipisah dari app port agar probe/metrics tidak tercampur dengan traffic utama.
6. `preStop sleep` bukan solusi sempurna, tetapi sering dipakai untuk memberi waktu endpoint removal dan load balancer propagation. App tetap harus handle SIGTERM dengan benar.

---

## 9. Service Manifest

Service memberi endpoint stabil ke Pod ephemeral.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-api
  namespace: payments
  labels:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/component: api
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: payment-api
    app.kubernetes.io/instance: payment-api-prod
  ports:
    - name: http
      port: 80
      targetPort: http
```

Invariant:

```text
Service selector harus match label Pod template, bukan label Deployment metadata semata.
```

Debug cepat:

```bash
kubectl -n payments get svc payment-api
kubectl -n payments get endpointslice -l kubernetes.io/service-name=payment-api
kubectl -n payments get pods -l app.kubernetes.io/name=payment-api
```

Jika Service ada tetapi endpoint kosong, biasanya:

- selector salah,
- Pod belum Ready,
- readiness probe gagal,
- Pod tidak ada,
- label Pod tidak match,
- endpoint publication delay.

---

## 10. HTTPRoute / Ingress Baseline

Jika memakai Gateway API:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: payment-api
  namespace: payments
spec:
  parentRefs:
    - name: public-gateway
      namespace: platform-ingress
  hostnames:
    - api.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /payments
      backendRefs:
        - name: payment-api
          port: 80
```

Jika memakai Ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: payment-api
  namespace: payments
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /payments
            pathType: Prefix
            backend:
              service:
                name: payment-api
                port:
                  number: 80
```

Yang harus dipikirkan untuk Java API:

```text
- Apakah app aware terhadap X-Forwarded-* headers?
- Apakah base path benar?
- Apakah timeout Gateway lebih besar dari app timeout?
- Apakah request body limit sesuai?
- Apakah TLS termination boundary jelas?
- Apakah error 502/503 bisa dibedakan dari app 5xx?
```

---

## 11. PodDisruptionBudget

Untuk service dengan minimal tiga replica:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payment-api
  namespace: payments
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: payment-api
      app.kubernetes.io/instance: payment-api-prod
```

PDB melindungi dari voluntary disruption seperti node drain. Namun PDB bukan HA ajaib.

Jika replica hanya satu:

```text
PDB dengan minAvailable: 1 bisa memblokir maintenance node.
```

Untuk singleton, lebih baik akui bahwa workload tidak highly available, atau desain ulang menjadi multi-replica.

---

## 12. HorizontalPodAutoscaler Baseline

Contoh HPA sederhana:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-api
  namespace: payments
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-api
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
```

CPU-based HPA cocok jika CPU berkorelasi dengan load. Untuk Java API, ini sering cukup sebagai awal tetapi tidak selalu benar.

Gunakan custom metrics jika bottleneck sebenarnya:

- request rate,
- p95/p99 latency,
- queue depth,
- active request count,
- thread pool saturation,
- connection pool saturation.

Untuk worker, metrik backlog sering lebih masuk akal daripada CPU.

Invariant:

```text
Autoscaling harus mempertimbangkan kapasitas downstream.
```

Jika setiap Pod membuka 20 koneksi DB dan HPA bisa scale sampai 12 replica:

```text
max DB connection from service = 12 * 20 = 240
```

Jika DB hanya aman menerima 100 koneksi dari service ini, maka konfigurasi pool atau max replica salah.

---

## 13. NetworkPolicy Baseline

NetworkPolicy harus eksplisit jika cluster mendukungnya.

Contoh default deny ingress namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

Allow dari gateway namespace ke payment-api:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-payment-api
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: payment-api
      app.kubernetes.io/instance: payment-api-prod
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: platform-ingress
      ports:
        - protocol: TCP
          port: 8080
```

Egress harus hati-hati karena DNS juga egress.

Failure umum:

```text
App tidak bisa connect DB karena NetworkPolicy egress terlalu ketat.
App tidak bisa resolve DNS karena UDP/TCP 53 ke CoreDNS tidak diizinkan.
Probe gagal karena traffic dari node/gateway tidak diizinkan.
```

---

## 14. Java Runtime Flags di Kubernetes

Baseline JVM flags bukan template universal, tetapi starting point.

```text
-XX:MaxRAMPercentage=70
-XX:InitialRAMPercentage=50
-XX:+ExitOnOutOfMemoryError
-Dfile.encoding=UTF-8
-Duser.timezone=UTC
```

Makna praktis:

- `MaxRAMPercentage` membatasi heap sebagai persentase memory yang terlihat oleh JVM.
- Jangan gunakan 100% memory untuk heap karena container juga butuh non-heap.
- `ExitOnOutOfMemoryError` membuat process exit saat OOM fatal sehingga Kubernetes bisa mengganti Pod.
- Timezone UTC mengurangi ambiguity log dan audit.

Namun angka 70% tidak sakral.

Untuk service dengan banyak thread, Netty direct buffer, TLS, off-heap cache, atau heavy native library, heap percentage harus lebih rendah.

Perkiraan kasar:

```text
container memory limit = heap + metaspace + code cache + thread stacks + direct buffer + native + tmp + safety margin
```

Contoh:

```text
memory limit: 1024Mi
heap max: ~700Mi
non-heap + native + threads + margin: ~324Mi
```

Jika aplikasi punya 300 thread dengan stack 1Mi, thread stack saja bisa menghabiskan ratusan MiB.

---

## 15. CPU Request, CPU Limit, dan Latency

CPU request menentukan scheduling dan HPA CPU utilization baseline.

```text
HPA CPU utilization = actual CPU usage / requested CPU
```

Jika request terlalu kecil, HPA bisa scale terlalu agresif.

Jika request terlalu besar, cluster boros dan HPA terlihat underutilized.

CPU limit dapat menyebabkan throttling. Untuk latency-sensitive Java API, throttling bisa meningkatkan p99 latency dan memperpanjang GC pause wall-clock.

Praktik umum:

```text
Set CPU request.
Pertimbangkan tidak memakai CPU limit untuk latency-sensitive service jika policy platform mengizinkan.
Tetap monitor actual CPU, throttling, latency, dan GC.
```

Jika organisasi mewajibkan CPU limit, pastikan limit cukup longgar dan observability mencakup throttling.

---

## 16. Probe Design untuk Spring Boot

Spring Boot Actuator menyediakan health endpoint yang bisa dipetakan ke liveness dan readiness.

Recommended split:

```text
/actuator/health/liveness
  -> apakah process internal masih hidup?

/actuator/health/readiness
  -> apakah app boleh menerima traffic sekarang?
```

Liveness tidak boleh terlalu bergantung pada dependency eksternal.

Bad liveness:

```text
Liveness gagal jika database lambat.
```

Akibat:

```text
DB lambat -> semua Pod restart -> connection storm -> DB makin lambat -> outage membesar.
```

Readiness boleh mempertimbangkan dependency kritikal, tetapi harus didesain hati-hati.

Readiness terlalu ketat:

```text
Satu downstream lambat -> semua Pod NotReady -> traffic hilang total.
```

Readiness terlalu longgar:

```text
Pod menerima traffic padahal belum bisa melayani request dengan benar.
```

Rule praktis:

```text
Liveness = process should be restarted?
Readiness = should receive traffic?
Startup = give slow startup enough time before liveness applies.
```

---

## 17. Graceful Shutdown untuk HTTP API

Saat Pod dihapus:

1. Pod mendapat `deletionTimestamp`.
2. Endpoint mulai dihapus dari Service/EndpointSlice.
3. Kubelet menjalankan `preStop` jika ada.
4. Runtime mengirim SIGTERM.
5. App diberi waktu sampai `terminationGracePeriodSeconds`.
6. Jika belum mati, SIGKILL.

Aplikasi Java harus:

- berhenti menerima request baru,
- menyelesaikan request in-flight,
- menutup connection pool dengan benar,
- flush log/metrics/traces,
- exit sebelum grace period habis.

Spring Boot config umum:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
```

Kubernetes config harus selaras:

```yaml
terminationGracePeriodSeconds: 45
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
```

Kenapa ada sleep?

Karena endpoint removal dan load balancer propagation tidak selalu instan. Sleep memberi waktu agar traffic baru berhenti sebelum process benar-benar terminate.

Namun sleep bukan pengganti graceful shutdown aplikasi.

---

## 18. Graceful Shutdown untuk Worker

Worker lebih sulit daripada HTTP API karena ada work in progress.

Untuk Kafka consumer:

```text
SIGTERM diterima
-> stop polling message baru
-> selesaikan processing message yang sudah diambil
-> commit offset jika aman
-> close consumer
-> exit
```

Untuk RabbitMQ worker:

```text
SIGTERM diterima
-> stop basic consume / cancel consumer
-> selesaikan message aktif
-> ack jika sukses
-> nack/requeue jika belum aman
-> close channel/connection
-> exit
```

Untuk Job:

```text
Task harus idempotent.
Retry bisa menjalankan ulang sebagian pekerjaan.
```

Kubernetes hanya tahu process exit code. Kubernetes tidak tahu apakah business operation sudah committed dengan benar.

Invariant:

```text
Semua worker production harus punya idempotency model.
```

---

## 19. Config Reload Strategy

Ada tiga strategi konfigurasi.

### 19.1 Immutable-per-release

Config berubah -> commit Git -> rollout Pod baru.

Kelebihan:

- predictable,
- auditable,
- mudah rollback,
- cocok untuk GitOps.

Kekurangan:

- perubahan config butuh rollout.

### 19.2 Runtime reload

ConfigMap/Secret mounted sebagai file dan app reload saat file berubah.

Kelebihan:

- tidak perlu restart.

Kekurangan:

- app harus benar-benar reload aman,
- partial reload bisa sulit,
- secret rotation lifecycle lebih kompleks.

### 19.3 External dynamic config

App membaca config dari config service.

Kelebihan:

- dynamic,
- centralized.

Kekurangan:

- dependency tambahan,
- failure mode baru,
- consistency dan audit lebih kompleks.

Untuk kebanyakan Java microservice, mulai dari immutable-per-release lebih aman.

---

## 20. Logging Contract

Log production harus structured.

Minimum fields:

```text
timestamp
level
service
version
environment
namespace
pod
container
trace_id
span_id
request_id
user_or_actor_id, jika aman dan compliant
operation
error_code
latency_ms
```

Jangan log:

```text
password
token
cookie session
authorization header
private key
full PII tanpa masking
large request body tanpa kontrol
```

Kubernetes best practice:

```text
Aplikasi tulis log ke stdout/stderr.
Agent node/sidecar mengumpulkan log.
Jangan bergantung pada file log lokal di Pod ephemeral.
```

---

## 21. Metrics Contract

Minimum app metrics:

```text
HTTP request rate
HTTP error rate
HTTP latency histogram
in-flight requests
JVM heap used/max
JVM non-heap
GC pause
thread count
connection pool active/idle/pending
executor queue depth
downstream latency/error
business operation success/failure
```

Minimum Kubernetes metrics:

```text
pod restarts
container memory usage
container CPU usage
CPU throttling
OOMKilled count
readiness status
replica available/desired
HPA desired/current replicas
node pressure
```

Golden signal mapping:

```text
Latency -> user impact
Traffic -> demand
Errors -> correctness/availability
Saturation -> capacity risk
```

Untuk Java, saturation sering muncul di:

- DB connection pool,
- HTTP client pool,
- executor queue,
- Kafka consumer lag,
- JVM heap pressure,
- CPU throttling,
- GC pause.

---

## 22. Tracing Contract

Distributed tracing penting karena Kubernetes memperbanyak hop:

```text
client
-> gateway/ingress
-> service A Pod
-> service B Pod
-> database/cache/broker/external API
```

Trace contract:

```text
Propagate trace context across HTTP/gRPC/messaging.
Attach service.name, version, namespace, pod, node if possible.
Record downstream latency and error.
Avoid high-cardinality labels/tags yang tidak terkendali.
```

Untuk Java, OpenTelemetry agent bisa membantu, tetapi tetap perlu desain semantik:

```text
Span name harus stabil.
Attribute cardinality harus dikontrol.
Business identifiers harus dipertimbangkan dari sisi privacy dan cost.
```

---

## 23. Alerting Contract

Alert jangan hanya berbasis gejala Kubernetes mentah.

Bad alert:

```text
Pod restarted once.
CPU > 80%.
Memory > 70%.
```

Good alert lebih dekat ke user impact dan actionable:

```text
payment-api p99 latency > SLO for 10 minutes
payment-api 5xx rate > threshold for 5 minutes
available replicas < min required for 5 minutes
HPA at maxReplicas and latency increasing
DB pool pending threads > threshold
Kafka consumer lag increasing while all replicas ready
OOMKilled repeated after latest rollout
```

Alert harus menjawab:

```text
Apa yang rusak?
Siapa yang terdampak?
Apakah butuh tindakan manusia?
Apa runbook-nya?
```

---

## 24. Security Baseline untuk Java Service

Baseline hardening:

```yaml
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

Pod-level:

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

ServiceAccount:

```yaml
automountServiceAccountToken: false
```

Image:

```text
Use digest.
Scan image.
Minimal runtime image.
No shell if operationally acceptable.
No secret in image layer.
No mutable latest tag.
```

Network:

```text
Default deny where possible.
Allow only required ingress/egress.
Do not treat namespace as hard security boundary by itself.
```

Secret:

```text
Never commit plain secret to Git.
Prefer external secret manager for high-value credentials.
Rotate secrets.
Test app behavior during rotation.
```

---

## 25. Release Compatibility Matrix

Sebelum release Java service, cek compatibility berikut.

```text
New app version <-> old app version
New app version <-> old DB schema
Old app version <-> new DB schema
New producer <-> old consumer
Old producer <-> new consumer
New API response <-> old client
Old API request <-> new server
New config <-> old image
Old config <-> new image
New secret format <-> old app
```

Kubernetes rollout hanya mengganti Pod. Ia tidak menjamin semantic compatibility.

Deployment sukses jika:

```text
Replica baru tersedia.
```

Release sukses jika:

```text
User impact baik.
Dependency sehat.
Business invariant tetap benar.
Rollback path aman.
```

---

## 26. Database Migration Pattern

Jangan menjalankan migration di setiap replica app tanpa kontrol.

Anti-pattern:

```text
Setiap Pod startup menjalankan Flyway/Liquibase migration secara otomatis.
```

Risiko:

- race condition,
- startup lambat,
- readiness delay,
- rollback sulit,
- migration long-running menyebabkan rollout stuck,
- semua replica bersaing lock migration.

Pattern lebih aman:

```text
1. Migration Job terpisah.
2. Migration backward-compatible.
3. App deploy setelah migration aman.
4. Cleanup destructive dilakukan release berikutnya.
```

Expand-contract pattern:

```text
Release N:
- add nullable column / new table / dual write support

Release N+1:
- app mulai baca field baru

Release N+2:
- stop write old field

Release N+3:
- drop old field setelah aman
```

---

## 27. Example End-to-End Bundle

Minimal resources untuk `payment-api`:

```text
00-namespace.yaml
01-serviceaccount.yaml
02-configmap.yaml
03-secret-ref.yaml, usually managed externally
04-deployment.yaml
05-service.yaml
06-httproute.yaml
07-pdb.yaml
08-hpa.yaml
09-networkpolicy.yaml
10-servicemonitor.yaml, if using Prometheus Operator
```

Repository structure:

```text
apps/payment-api/
  base/
    serviceaccount.yaml
    deployment.yaml
    service.yaml
    pdb.yaml
    hpa.yaml
    networkpolicy.yaml
    kustomization.yaml
  overlays/
    dev/
      configmap.yaml
      kustomization.yaml
    staging/
      configmap.yaml
      kustomization.yaml
    prod/
      configmap.yaml
      hpa-patch.yaml
      resources-patch.yaml
      kustomization.yaml
```

Prinsip:

```text
Base menyatakan contract umum.
Overlay menyatakan perbedaan environment.
Jangan membuat overlay menjadi copy-paste deployment penuh.
```

---

## 28. Production Readiness Checklist

### 28.1 Deployment

```text
[ ] Image menggunakan immutable digest.
[ ] Deployment memiliki replica count minimum sesuai availability target.
[ ] RollingUpdate tidak menurunkan kapasitas di bawah batas aman.
[ ] revisionHistoryLimit diset.
[ ] progressDeadlineSeconds masuk akal.
[ ] Rollback sudah diuji.
```

### 28.2 Resources

```text
[ ] CPU request berdasarkan pengukuran load test.
[ ] Memory limit mempertimbangkan heap dan non-heap.
[ ] JVM MaxRAMPercentage eksplisit.
[ ] OOMKilled dimonitor.
[ ] CPU throttling dimonitor.
[ ] GC pause dimonitor.
```

### 28.3 Health

```text
[ ] startupProbe ada untuk service yang startup lambat.
[ ] liveness tidak bergantung berat pada dependency eksternal.
[ ] readiness merepresentasikan kemampuan menerima traffic.
[ ] Probe timeout/failureThreshold tidak terlalu agresif.
[ ] Graceful shutdown diuji.
```

### 28.4 Config and Secret

```text
[ ] Config non-sensitive ada di ConfigMap.
[ ] Secret tidak masuk Git plain text.
[ ] Secret consumption path jelas.
[ ] Rotation behavior diuji.
[ ] Config change memicu rollout jika immutable-per-release.
```

### 28.5 Networking

```text
[ ] Service selector benar.
[ ] EndpointSlice muncul saat Pod Ready.
[ ] Gateway/Ingress timeout selaras dengan app timeout.
[ ] X-Forwarded-* handling benar.
[ ] NetworkPolicy tidak memblokir DNS/probe/dependency.
```

### 28.6 Autoscaling

```text
[ ] HPA metric sesuai bottleneck.
[ ] minReplicas sesuai availability.
[ ] maxReplicas sesuai dependency budget.
[ ] scaleDown stabilization cukup.
[ ] JVM warmup dipertimbangkan.
[ ] Downstream capacity dihitung.
```

### 28.7 Observability

```text
[ ] Structured logs dengan trace/request ID.
[ ] Metrics JVM tersedia.
[ ] Metrics HTTP tersedia.
[ ] Metrics dependency tersedia.
[ ] Dashboard service tersedia.
[ ] Alert actionable.
[ ] Runbook incident tersedia.
```

### 28.8 Security

```text
[ ] runAsNonRoot.
[ ] allowPrivilegeEscalation false.
[ ] readOnlyRootFilesystem jika memungkinkan.
[ ] capabilities drop ALL.
[ ] ServiceAccount token tidak dimount jika tidak perlu.
[ ] RBAC least privilege.
[ ] Image scanned/signed jika platform mendukung.
[ ] Secret access dibatasi.
```

---

## 29. Failure Mode Catalogue

### 29.1 Pod Running tapi tidak bisa menerima traffic

Kemungkinan:

```text
readiness gagal
Service selector salah
EndpointSlice kosong
NetworkPolicy memblokir traffic
Ingress/Gateway route salah
app binding hanya localhost
port mismatch
management port dan app port tertukar
```

Investigasi:

```bash
kubectl -n payments get pod -l app.kubernetes.io/name=payment-api
kubectl -n payments describe pod <pod>
kubectl -n payments get svc payment-api -o yaml
kubectl -n payments get endpointslice -l kubernetes.io/service-name=payment-api
kubectl -n payments logs <pod>
```

### 29.2 Rollout stuck

Kemungkinan:

```text
new Pod readiness gagal
image pull gagal
startup terlalu lama
resource unschedulable
quota penuh
admission policy reject
migration startup blocking
secret/config missing
```

Investigasi:

```bash
kubectl -n payments rollout status deploy/payment-api
kubectl -n payments describe deploy payment-api
kubectl -n payments get rs
kubectl -n payments describe pod <new-pod>
```

### 29.3 OOMKilled

Kemungkinan:

```text
heap terlalu besar
non-heap tidak dihitung
direct buffer besar
thread terlalu banyak
memory leak
large request/response buffering
cache unbounded
native memory leak
```

Investigasi:

```bash
kubectl -n payments describe pod <pod>
kubectl -n payments top pod <pod>
# Lihat last state terminated reason OOMKilled
```

App-level:

```text
heap dump jika aman
JVM memory metrics
GC logs
thread count
native memory tracking jika diaktifkan
```

### 29.4 CPU throttling dan p99 latency naik

Kemungkinan:

```text
CPU limit terlalu rendah
GC butuh CPU lebih besar
request spike
serialization/deserialization mahal
TLS overhead
thread pool contention
```

Remediasi:

```text
naikkan CPU request
hapus/perbesar CPU limit jika policy mengizinkan
optimasi GC/thread pool
scale out jika CPU memang bottleneck
ukur p95/p99 sebelum dan sesudah
```

### 29.5 HPA membuat downstream collapse

Kemungkinan:

```text
HPA scale out menambah koneksi DB
consumer scale out menyebabkan rebalance storm
retry storm
thread pool dan connection pool terlalu besar per Pod
maxReplicas tidak mempertimbangkan dependency
```

Remediasi:

```text
limit maxReplicas
kurangi pool per Pod
pakai bulkhead
pakai custom metric yang lebih tepat
atur scaleUp policy
atur retry budget
```

### 29.6 Secret rotate tapi app masih gagal auth

Kemungkinan:

```text
secret updated but env var immutable until restart
mounted file updated but app tidak reload
connection pool masih memakai old credential
external secret controller delay
secret name/key mismatch
```

Remediasi:

```text
restart rollout terkontrol
implement reload jika perlu
validate secret version
monitor auth failure setelah rotation
```

### 29.7 Readiness causes full outage

Kemungkinan:

```text
readiness check memasukkan dependency yang sedang degraded
semua Pod NotReady bersamaan
Service endpoint kosong
Gateway return 503
```

Remediasi:

```text
review readiness semantics
bedakan critical local readiness vs external dependency state
pakai circuit breaker/degraded mode jika sesuai
hindari all-or-nothing readiness untuk dependency non-critical
```

---

## 30. Anti-Pattern yang Sering Terjadi

### 30.1 Liveness sama dengan readiness

```text
/health dipakai untuk startup, liveness, readiness, external monitoring.
```

Masalah:

```text
Semua jenis health punya makna berbeda.
Satu endpoint universal sering membuat restart salah atau traffic salah.
```

### 30.2 Memory limit 512Mi dengan heap 512Mi

Masalah:

```text
Container memory bukan hanya heap.
Non-heap akan membuat OOMKilled.
```

### 30.3 HPA CPU untuk worker backlog

Masalah:

```text
Worker bottleneck bisa IO/broker/downstream, bukan CPU.
CPU rendah tidak berarti backlog aman.
```

### 30.4 latest tag

Masalah:

```text
Rollback tidak deterministic.
Audit sulit.
GitOps diff tidak cukup.
Node cache bisa menjalankan image berbeda.
```

### 30.5 Admin actuator exposed externally

Masalah:

```text
Management endpoint bisa membocorkan info internal atau memberi kontrol runtime.
```

### 30.6 No resource request

Masalah:

```text
Scheduler tidak punya sinyal kapasitas.
QoS buruk.
HPA CPU utilization tidak bisa bekerja benar.
Noisy neighbor meningkat.
```

### 30.7 Migration in every replica

Masalah:

```text
Race, lock contention, rollout stuck, rollback berbahaya.
```

### 30.8 Readiness always true

Masalah:

```text
Pod menerima traffic sebelum siap.
Rollout terlihat sukses padahal user error meningkat.
```

---

## 31. Decision Framework: Menentukan Manifest Berdasarkan Workload

### 31.1 Stateless REST API

Gunakan:

```text
Deployment
Service
Ingress/HTTPRoute
HPA
PDB
NetworkPolicy
ConfigMap/Secret
ServiceAccount
```

Fokus:

```text
readiness, graceful shutdown, autoscaling, latency, resource sizing
```

### 31.2 Internal gRPC Service

Gunakan:

```text
Deployment
Service
possibly mesh/Gateway internal
HPA
PDB
NetworkPolicy
```

Fokus:

```text
HTTP/2 connection draining
timeouts
load balancing
keepalive
mTLS if needed
```

### 31.3 Kafka/RabbitMQ Worker

Gunakan:

```text
Deployment
HPA/KEDA/custom scaler
PDB carefully
ConfigMap/Secret
NetworkPolicy
```

Fokus:

```text
idempotency
shutdown
ack/commit semantics
rebalance
backlog metric
retry budget
```

### 31.4 Scheduled Task

Gunakan:

```text
CronJob
Job
ConfigMap/Secret
```

Fokus:

```text
concurrencyPolicy
startingDeadlineSeconds
idempotency
backoffLimit
history limit
```

### 31.5 Migration

Gunakan:

```text
Job
GitOps/CI gate
manual approval for production if needed
```

Fokus:

```text
backward compatibility
single execution
rollback strategy
observability
```

---

## 32. Practical Debugging Flow untuk Java Service

Saat service bermasalah, jangan langsung lihat log aplikasi saja.

Ikuti flow:

```text
1. Apakah Deployment available?
2. Apakah replica desired == available?
3. Apakah Pod Running?
4. Apakah Pod Ready?
5. Apakah restart count naik?
6. Apakah events menunjukkan scheduling/image/probe/resource issue?
7. Apakah Service punya EndpointSlice?
8. Apakah route Gateway/Ingress benar?
9. Apakah app logs menunjukkan error?
10. Apakah metrics menunjukkan saturation?
11. Apakah dependency sehat?
12. Apakah masalah dimulai setelah rollout/config/secret/policy change?
```

Command baseline:

```bash
kubectl -n payments get deploy payment-api
kubectl -n payments rollout status deploy/payment-api
kubectl -n payments get pods -l app.kubernetes.io/name=payment-api -o wide
kubectl -n payments describe pod <pod>
kubectl -n payments logs <pod> --previous
kubectl -n payments get svc payment-api -o yaml
kubectl -n payments get endpointslice -l kubernetes.io/service-name=payment-api
kubectl -n payments get hpa payment-api
kubectl -n payments describe hpa payment-api
kubectl -n payments get events --sort-by=.lastTimestamp
```

---

## 33. Latihan

### Latihan 1 — Review Manifest

Ambil satu manifest Java service yang kamu punya. Tandai:

```text
[ ] labels konsisten
[ ] Service selector benar
[ ] probes masuk akal
[ ] requests/limits masuk akal
[ ] JVM flags eksplisit
[ ] graceful shutdown ada
[ ] ServiceAccount eksplisit
[ ] token tidak dimount jika tidak perlu
[ ] secret tidak hardcoded
[ ] PDB sesuai replica
[ ] HPA maxReplicas sesuai dependency budget
```

### Latihan 2 — Failure Simulation

Di local kind/minikube:

1. Deploy service dummy.
2. Buat readiness gagal.
3. Lihat EndpointSlice kosong.
4. Perbaiki readiness.
5. Buat memory limit terlalu kecil.
6. Amati OOMKilled.
7. Buat Service selector salah.
8. Debug dari Service ke Pod label.

### Latihan 3 — Resource Budget

Untuk service Java:

```text
memory limit = 1024Mi
MaxRAMPercentage = 70
thread max = 200
DB pool = 30
maxReplicas = 10
```

Jawab:

```text
Berapa estimasi heap?
Berapa DB connection maksimum?
Apakah DB mampu?
Apa risiko thread stack?
Apa metric yang harus dimonitor?
```

### Latihan 4 — Release Compatibility

Buat matrix untuk perubahan API berikut:

```text
payment-api v1 mengembalikan field `status`.
payment-api v2 mengganti `status` menjadi `state`.
Ada client lama yang masih membaca `status`.
```

Rancang release aman tanpa breaking client.

---

## 34. Ringkasan

Java microservice production di Kubernetes membutuhkan lebih dari Deployment dan Service.

Blueprint production harus menyatukan:

```text
identity
lifecycle
resources
JVM runtime
probes
config
secrets
traffic
network policy
autoscaling
observability
security
release compatibility
failure debugging
```

Kubernetes memberi primitive untuk menjalankan desired state, tetapi kualitas production tetap ditentukan oleh kontrak yang kamu desain.

Pod `Running` bukan bukti aplikasi sehat.
Deployment `Available` bukan bukti release benar.
HPA aktif bukan bukti scaling aman.
Secret ada bukan bukti credential lifecycle aman.
Log ada bukan bukti observability cukup.

Sebagai Java engineer, fokus utama bukan menghafal YAML, tetapi memahami invariant:

```text
App runtime behavior must align with Kubernetes lifecycle behavior.
```

Jika lifecycle, resource, health, traffic, dependency, dan observability selaras, Kubernetes menjadi platform yang sangat kuat.

Jika tidak, Kubernetes hanya mempercepat dan memperbesar failure mode yang sebelumnya tersembunyi.

---

## 35. Checklist Pemahaman

Kamu siap lanjut jika bisa menjawab:

1. Kenapa liveness probe tidak boleh sembarang mengecek database?
2. Apa bedanya `Running`, `Ready`, dan `Available`?
3. Kenapa heap tidak boleh sama dengan memory limit?
4. Apa efek HPA terhadap connection pool downstream?
5. Kenapa Service selector lebih penting daripada nama Deployment?
6. Apa yang terjadi saat Pod mendapat SIGTERM?
7. Kenapa migration sebaiknya tidak dijalankan oleh semua replica?
8. Apa bedanya rollout success dan release success?
9. Apa risiko mutable image tag?
10. Apa minimum observability contract untuk Java service production?

---

## 36. Posisi Part Ini dalam Seri

Kita sudah menyusun blueprint production runtime untuk Java microservice.

Part berikutnya akan naik satu level ke **platform engineering**:

```text
Part 030 — Platform Engineering: Building Internal Kubernetes Developer Platforms
```

Di sana kita akan membahas bagaimana organisasi tidak seharusnya meminta setiap developer menulis semua YAML mentah dari nol, tetapi membangun golden path, platform API, guardrails, templates, policy, dan ownership model yang tetap fleksibel.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Batch, Scheduling, Workers, and Event-Driven Workloads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-030.md">Part 030 — Platform Engineering: Building Internal Kubernetes Developer Platforms ➡️</a>
</div>
