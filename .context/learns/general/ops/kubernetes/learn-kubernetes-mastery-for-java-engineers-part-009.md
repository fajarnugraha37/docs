# learn-kubernetes-mastery-for-java-engineers-part-009.md

# Part 009 — Service Discovery and Service Abstractions

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `009 / 035`  
> Topik: Service Discovery, Service abstraction, EndpointSlice, DNS, connection behavior, dan Java client reality  
> Target pembaca: Java software engineer yang sudah paham Docker, HTTP, backend service, distributed systems, dan ingin mengoperasikan aplikasi Java secara benar di Kubernetes.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membahas:

- Pod sebagai unit runtime terkecil.
- Controller seperti Deployment, StatefulSet, DaemonSet, Job, dan CronJob.
- Scheduling: bagaimana Pod mendarat di Node.
- Resource model: CPU, memory, QoS, JVM, throttling, OOM.
- Configuration: ConfigMap, Secret, env var, mounted file, reloadability.

Sekarang kita masuk ke pertanyaan penting:

> Jika Pod bersifat ephemeral, IP bisa berubah, replica bisa naik turun, rollout bisa mengganti Pod kapan saja, bagaimana aplikasi lain bisa menemukan dan memanggilnya secara stabil?

Jawaban Kubernetes adalah **Service abstraction**.

Namun, untuk production engineer, `Service` bukan hanya:

> “object untuk expose Pod.”

Itu terlalu dangkal.

Mental model yang lebih tepat:

> **Service adalah kontrak jaringan stabil di depan sekumpulan endpoint dinamis.**

Kontrak ini menghubungkan dunia yang stabil:

- nama service,
- virtual IP,
- DNS name,
- port,
- protocol,
- policy,

ke dunia yang berubah terus:

- Pod baru,
- Pod mati,
- Pod belum ready,
- rollout,
- scale up,
- scale down,
- node failure,
- endpoint topology,
- network dataplane.

Sebagai Java engineer, bagian ini sangat penting karena Java application biasanya memiliki:

- connection pool,
- DNS cache,
- HTTP client keep-alive,
- JDBC pool,
- gRPC channel,
- Kafka/RabbitMQ/Redis clients,
- retry policy,
- timeout policy,
- circuit breaker,
- service discovery assumption.

Kubernetes Service abstraction bisa membantu, tetapi tidak menghapus seluruh problem distributed system.

---

## 1. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan kenapa Service diperlukan walaupun Pod sudah punya IP.
2. Membedakan `Service`, `EndpointSlice`, `Pod`, dan DNS record.
3. Memahami bagaimana selector Service memilih backend Pod.
4. Memahami kapan Service punya endpoint dan kapan tidak.
5. Membedakan tipe Service:
   - `ClusterIP`,
   - `NodePort`,
   - `LoadBalancer`,
   - `ExternalName`,
   - headless Service.
6. Menjelaskan hubungan Service dengan readiness probe.
7. Memahami DNS naming model di Kubernetes.
8. Memahami dampak Service terhadap Java client, DNS cache, connection pool, dan stale connection.
9. Mendesain service discovery untuk Java microservice secara sehat.
10. Debugging error seperti:
    - `service exists but no endpoints`,
    - `connection refused`,
    - `unknown host`,
    - DNS resolves but request timeout,
    - stale connection setelah rollout,
    - traffic masuk ke Pod yang belum siap,
    - headless Service behavior surprise.

---

## 2. Masalah Dasar: Pod Tidak Bisa Dijadikan Alamat Stabil

Pod punya IP.

Contoh:

```bash
kubectl get pods -o wide
```

Output:

```text
NAME                         READY   STATUS    IP            NODE
order-api-7b8d6c9d4f-abc12   1/1     Running   10.244.1.12   worker-1
order-api-7b8d6c9d4f-def34   1/1     Running   10.244.2.18   worker-2
order-api-7b8d6c9d4f-ghi56   1/1     Running   10.244.3.21   worker-3
```

Secara teknis, Pod lain bisa mengakses IP Pod tersebut.

Misalnya:

```bash
curl http://10.244.1.12:8080
```

Tapi ini tidak boleh menjadi kontrak antar service.

Kenapa?

Karena Pod adalah entitas ephemeral.

Pod bisa hilang karena:

- rollout Deployment,
- node failure,
- eviction,
- autoscaling,
- crash loop,
- manual delete,
- cluster upgrade,
- descheduling,
- probe failure,
- resource pressure.

Ketika Pod diganti, Pod baru biasanya mendapat IP baru.

Jadi jika service A menyimpan IP Pod service B, maka service A sedang bergantung pada sesuatu yang tidak stabil.

Itu seperti menyimpan alamat kamar hotel seseorang, padahal orangnya bisa pindah kamar kapan saja.

Yang kita butuhkan bukan alamat Pod individual.

Yang kita butuhkan adalah nama stabil:

```text
order-api.default.svc.cluster.local
```

atau minimal:

```text
order-api
```

Nama itu harus tetap valid meskipun Pod backend berubah.

Inilah fungsi utama Service.

---

## 3. Mental Model Service

Service bisa dipahami sebagai:

```text
Stable frontend contract
        |
        v
Dynamic backend endpoint set
```

Atau lebih konkret:

```text
Client
  |
  | calls http://order-api:8080
  v
Service: order-api
  |
  | selects ready Pods using label selector
  v
EndpointSlice(s)
  |
  | contains Pod IPs and ports
  v
Pods:
  - 10.244.1.12:8080
  - 10.244.2.18:8080
  - 10.244.3.21:8080
```

Service bukan Pod.

Service bukan Deployment.

Service bukan DNS server.

Service bukan Ingress.

Service adalah API object yang menyatakan:

> “Untuk nama dan port ini, arahkan traffic ke sekumpulan backend endpoint yang cocok dengan selector ini.”

Kubernetes kemudian membuat dan memperbarui EndpointSlice berdasarkan Pod yang cocok.

---

## 4. Service Object Dasar

Contoh Service paling umum:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
  namespace: default
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - name: http
      port: 8080
      targetPort: 8080
      protocol: TCP
```

Maknanya:

```text
Buat Service bernama order-api.
Service ini punya port 8080.
Traffic ke Service port 8080 dikirim ke Pod yang punya label app.kubernetes.io/name=order-api pada targetPort 8080.
```

Penting:

- `port` adalah port Service.
- `targetPort` adalah port container/Pod backend.
- `selector` menentukan Pod mana yang menjadi backend.
- `type: ClusterIP` berarti Service hanya punya virtual IP internal cluster.

---

## 5. Service, Pod, Deployment, dan EndpointSlice

Mari lihat object graph sederhana:

```text
Deployment
  |
  v
ReplicaSet
  |
  v
Pods  <------------------ Service selector
  |                              |
  |                              v
  +---------------------- EndpointSlice(s)
                                  |
                                  v
                           Service dataplane
```

Deployment tidak “mendaftarkan diri” ke Service.

Service tidak peduli Deployment.

Service hanya peduli Pod label.

Artinya, jika label Pod cocok dengan selector Service, Pod bisa menjadi backend Service.

Ini kuat, tapi juga berbahaya.

Contoh risiko:

```yaml
selector:
  app: api
```

Jika ada dua aplikasi berbeda sama-sama memakai label `app: api`, keduanya bisa tidak sengaja masuk ke Service yang sama.

Karena itu, label harus dirancang sebagai kontrak.

Gunakan label yang lebih eksplisit:

```yaml
app.kubernetes.io/name: order-api
app.kubernetes.io/component: backend
app.kubernetes.io/part-of: commerce-platform
```

---

## 6. EndpointSlice: Backend Set Aktual

Dulu Kubernetes banyak memakai object `Endpoints`.

Kubernetes modern memakai `EndpointSlice` sebagai mekanisme scalable untuk merepresentasikan endpoint backend.

Untuk melihat EndpointSlice:

```bash
kubectl get endpointslice -l kubernetes.io/service-name=order-api
```

Contoh output:

```text
NAME              ADDRESSTYPE   PORTS   ENDPOINTS
order-api-kp9z8   IPv4          8080    10.244.1.12,10.244.2.18,10.244.3.21
```

EndpointSlice menyimpan informasi seperti:

- alamat IP endpoint,
- port,
- protocol,
- readiness/serving/terminating condition,
- topology hints,
- node name,
- targetRef ke Pod.

Mental model:

```text
Service = stable contract
EndpointSlice = current backend inventory
```

Jika Service ada tetapi EndpointSlice kosong, berarti Service tidak punya backend yang usable.

---

## 7. Service Selector dan Readiness

Service selector memilih Pod berdasarkan label.

Namun, tidak semua Pod yang label-nya cocok otomatis mendapat traffic.

Readiness matter.

Jika Pod belum ready, Kubernetes tidak memasukkannya sebagai endpoint ready untuk Service biasa.

Contoh:

```text
Pod exists       : yes
Label matches   : yes
Container runs  : yes
Readiness true  : no
Service endpoint: no
```

Ini sangat penting untuk rollout.

Misalnya Deployment membuat Pod baru.

Pod status `Running`, tetapi aplikasi Java masih:

- warming up JVM,
- loading Spring context,
- establishing DB pool,
- loading cache,
- compiling JIT hot paths,
- waiting dependency,
- initializing metrics/tracing.

Jika readiness belum true, traffic tidak seharusnya masuk.

Service harus melihat Pod tersebut sebagai belum siap.

Itulah kenapa readiness probe bukan formalitas.

Readiness probe adalah sinyal routing.

---

## 8. Service Type

Kubernetes Service punya beberapa tipe utama.

### 8.1 ClusterIP

Default type.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - port: 8080
      targetPort: 8080
```

ClusterIP membuat virtual IP internal cluster.

Cocok untuk:

- service-to-service internal call,
- Java API dipanggil oleh service lain,
- internal worker dependency,
- internal admin service yang tidak diekspos keluar cluster.

Contoh akses dari Pod lain:

```bash
curl http://order-api.default.svc.cluster.local:8080
```

Atau jika namespace sama:

```bash
curl http://order-api:8080
```

### 8.2 NodePort

NodePort membuka port pada setiap Node.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  type: NodePort
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - port: 8080
      targetPort: 8080
      nodePort: 30080
```

Traffic bisa masuk melalui:

```text
<NodeIP>:30080
```

NodePort jarang menjadi interface production utama untuk aplikasi modern.

Biasanya NodePort digunakan sebagai building block oleh LoadBalancer atau ingress controller.

Risiko NodePort:

- membuka port di seluruh Node,
- port range terbatas,
- sulit dikelola untuk banyak service,
- exposure surface lebih besar,
- kurang nyaman untuk TLS/routing host/path.

### 8.3 LoadBalancer

`LoadBalancer` meminta cloud provider membuat external load balancer.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  type: LoadBalancer
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - port: 80
      targetPort: 8080
```

Cocok untuk:

- expose service langsung ke luar cluster,
- TCP service non-HTTP,
- simple external endpoint,
- ingress/gateway controller service.

Namun untuk banyak HTTP service, biasanya lebih baik:

```text
External Load Balancer
        |
        v
Ingress Controller / Gateway
        |
        v
Internal Services
```

Bukan satu LoadBalancer per aplikasi kecil.

### 8.4 ExternalName

`ExternalName` membuat Service sebagai alias DNS ke nama eksternal.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-provider
spec:
  type: ExternalName
  externalName: api.payment.example.com
```

Aplikasi di cluster bisa mengakses:

```text
payment-provider.default.svc.cluster.local
```

Lalu DNS akan mengarah ke:

```text
api.payment.example.com
```

Cocok untuk abstraction ringan atas dependency eksternal.

Tapi hati-hati:

- tidak membuat proxy,
- tidak melakukan health check,
- tidak melakukan load balancing Kubernetes,
- tidak cocok untuk semua protocol,
- TLS hostname validation bisa bermasalah jika client memakai nama Service tetapi sertifikat untuk domain eksternal.

### 8.5 Headless Service

Headless Service memakai:

```yaml
clusterIP: None
```

Contoh:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  clusterIP: None
  selector:
    app.kubernetes.io/name: postgres
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
```

Headless Service tidak memberi satu virtual IP.

DNS mengembalikan endpoint individual.

Cocok untuk:

- StatefulSet,
- database cluster,
- broker cluster,
- peer discovery,
- client-side load balancing,
- service yang membutuhkan identity per Pod.

Contoh StatefulSet DNS:

```text
postgres-0.postgres.default.svc.cluster.local
postgres-1.postgres.default.svc.cluster.local
postgres-2.postgres.default.svc.cluster.local
```

Headless Service bukan default untuk stateless Java API.

Untuk Java REST API biasa, `ClusterIP` lebih umum.

---

## 9. DNS Naming Model di Kubernetes

Kubernetes membuat DNS record untuk Service dan Pod.

Format fully qualified domain name Service:

```text
<service-name>.<namespace>.svc.<cluster-domain>
```

Biasanya:

```text
order-api.default.svc.cluster.local
```

Jika client berada di namespace yang sama, cukup:

```text
order-api
```

Jika beda namespace:

```text
order-api.default
```

atau FQDN:

```text
order-api.default.svc.cluster.local
```

Praktik production yang lebih eksplisit:

```text
http://order-api.commerce.svc.cluster.local:8080
```

Kenapa eksplisit?

Karena mengurangi ambiguity jika service dipindah namespace atau ada nama service sama di namespace lain.

---

## 10. DNS Search Path dan Surprise

Pod biasanya punya `/etc/resolv.conf` seperti:

```text
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5
```

Jika aplikasi resolve:

```text
order-api
```

resolver akan mencoba beberapa kemungkinan berdasarkan search path.

Ini nyaman, tapi bisa menimbulkan surprise:

- DNS lookup lebih banyak dari yang disangka,
- nama eksternal tanpa titik bisa dicoba sebagai internal name dulu,
- latency DNS bisa naik jika resolver melakukan beberapa query,
- `ndots` memengaruhi urutan resolusi.

Untuk internal service, nama pendek boleh dipakai jika namespace sama.

Untuk cross-namespace atau production-critical dependency, FQDN lebih defensif.

---

## 11. Java DNS Reality

Ini bagian yang sering dilupakan.

Kubernetes bisa mengubah endpoint set secara cepat.

Tapi Java application mungkin tidak selalu mengikuti perubahan itu dengan cara yang kita harapkan.

### 11.1 JVM DNS cache

Java punya DNS caching behavior.

Jika DNS result dicache terlalu lama, aplikasi bisa terus memakai alamat lama.

Untuk Service `ClusterIP`, ini biasanya tidak terlalu bermasalah karena ClusterIP stabil.

Namun untuk headless Service, DNS mengembalikan Pod IP individual.

Jika Pod berubah tapi client cache DNS terlalu lama, client bisa mencoba IP Pod yang sudah mati.

Risiko tinggi untuk:

- headless Service,
- StatefulSet client,
- gRPC client-side load balancing,
- custom service discovery,
- Java HTTP client yang resolve sekali lalu keep connection lama.

### 11.2 Connection pool

Banyak Java client tidak resolve DNS setiap request.

Mereka membuat connection pool.

Contoh:

- Apache HttpClient,
- OkHttp,
- Netty,
- gRPC channel,
- R2DBC client,
- JDBC pool,
- Redis client,
- Kafka client,
- RabbitMQ client.

Jika connection sudah terbuka ke backend lama, DNS update tidak langsung berdampak.

Untuk ClusterIP Service, connection menuju virtual IP Service.

Namun backend Pod di balik Service bisa hilang saat rollout.

Koneksi lama bisa mengalami:

- reset,
- broken pipe,
- timeout,
- connection refused,
- HTTP 502 dari proxy,
- gRPC UNAVAILABLE.

Client tetap harus punya:

- timeout,
- retry terbatas,
- circuit breaker,
- connection eviction,
- keep-alive tuning,
- graceful shutdown compatibility.

### 11.3 Service tidak menghapus kebutuhan timeout

Kesalahan umum:

> “Karena pakai Kubernetes Service, client call aman.”

Tidak.

Service hanya memberi discovery dan traffic distribution.

Service tidak menjamin:

- backend tidak lambat,
- backend tidak overload,
- request tidak hilang saat Pod terminating,
- retry aman,
- timeout sesuai,
- semantic correctness.

Distributed system rules tetap berlaku.

---

## 12. ClusterIP dan Load Balancing: Apa yang Sebenarnya Terjadi?

Saat client mengakses Service ClusterIP:

```text
http://order-api:8080
```

DNS resolve ke ClusterIP, misalnya:

```text
10.96.120.55
```

Traffic ke IP itu kemudian diarahkan oleh dataplane Kubernetes ke salah satu endpoint Pod.

Simplified flow:

```text
Java client Pod
  |
  | TCP connect to 10.96.120.55:8080
  v
Service virtual IP
  |
  | dataplane selects backend
  v
Pod IP: 10.244.2.18:8080
```

Service load balancing biasanya terjadi pada connection level, bukan request semantic level.

Artinya:

- satu TCP connection bisa tetap ke backend yang sama,
- HTTP keep-alive bisa membuat banyak request masuk ke backend yang sama,
- gRPC long-lived connection bisa sangat sticky,
- WebSocket long-lived connection juga sticky.

Jangan menganggap Service selalu membagi setiap request secara merata.

Untuk aplikasi Java dengan HTTP keep-alive atau gRPC, ini sangat relevan.

---

## 13. Service Ports: `port`, `targetPort`, dan `containerPort`

Tiga konsep yang sering tertukar:

```yaml
containers:
  - name: app
    ports:
      - containerPort: 8080
---
apiVersion: v1
kind: Service
spec:
  ports:
    - port: 80
      targetPort: 8080
```

Makna:

- `containerPort`: dokumentasi/metadata port yang diekspos container; berguna untuk readability dan beberapa tooling.
- `Service port`: port yang dipakai client saat memanggil Service.
- `targetPort`: port backend Pod yang menjadi tujuan traffic.

Contoh:

```text
Client calls: order-api:80
Service sends to: PodIP:8080
```

`targetPort` bisa nama port.

Contoh:

```yaml
containers:
  - name: app
    ports:
      - name: http
        containerPort: 8080
---
apiVersion: v1
kind: Service
spec:
  ports:
    - name: http
      port: 80
      targetPort: http
```

Named targetPort lebih maintainable karena port container bisa berubah tanpa mengubah Service jika nama tetap sama.

---

## 14. Service Selector: Kontrak Label yang Harus Stabil

Service selector sebaiknya memilih identity aplikasi, bukan atribut deployment sementara.

Buruk:

```yaml
selector:
  version: v1
```

Jika rollout ke `v2`, endpoint bisa hilang kecuali selector ikut diubah.

Lebih baik:

```yaml
selector:
  app.kubernetes.io/name: order-api
```

Lalu versi dikelola lewat label tambahan:

```yaml
labels:
  app.kubernetes.io/name: order-api
  app.kubernetes.io/version: "1.8.3"
```

Untuk canary, blue/green, atau progressive delivery, selector bisa sengaja diarahkan lebih spesifik, tetapi itu harus menjadi keputusan release strategy, bukan kebetulan label.

---

## 15. Service tanpa Selector

Service tidak harus punya selector.

Contoh:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: legacy-db
spec:
  ports:
    - port: 5432
      targetPort: 5432
```

Tanpa selector, Kubernetes tidak otomatis membuat EndpointSlice.

Kita bisa membuat EndpointSlice manual yang menunjuk endpoint eksternal.

Use case:

- expose database eksternal dengan nama internal cluster,
- bridge ke legacy system,
- migration phase,
- manual backend endpoint.

Tapi ini harus hati-hati.

Jika endpoint eksternal berubah, Kubernetes tidak otomatis tahu kecuali ada automation yang update EndpointSlice.

---

## 16. Readiness, Endpoint Removal, dan Rollout

Saat Pod mulai terminating, endpoint-nya perlu dikeluarkan dari routing.

Ideal lifecycle:

```text
1. Pod receives termination signal.
2. Pod readiness becomes false or endpoint marked terminating.
3. Service stops sending new traffic.
4. Existing requests finish.
5. App exits gracefully.
6. Pod removed.
```

Untuk Java service, kombinasinya biasanya:

- readiness probe yang benar,
- graceful shutdown framework,
- `terminationGracePeriodSeconds`,
- optional `preStop`,
- HTTP client timeout yang tidak terlalu panjang,
- server shutdown timeout.

Spring Boot contoh konfigurasi konseptual:

```properties
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s
management.endpoint.health.probes.enabled=true
management.health.livenessstate.enabled=true
management.health.readinessstate.enabled=true
```

Manifest:

```yaml
terminationGracePeriodSeconds: 45
containers:
  - name: app
    image: example/order-api:1.0.0
    ports:
      - name: http
        containerPort: 8080
    readinessProbe:
      httpGet:
        path: /actuator/health/readiness
        port: http
      periodSeconds: 5
      failureThreshold: 2
    livenessProbe:
      httpGet:
        path: /actuator/health/liveness
        port: http
      periodSeconds: 10
      failureThreshold: 3
```

Service discovery yang baik sangat tergantung readiness yang jujur.

Jika readiness selalu true, Service akan mengirim traffic ke Pod yang belum siap.

Jika readiness terlalu ketat, Pod sehat bisa dikeluarkan dari endpoint set.

---

## 17. Common Java Service-to-Service Manifest

Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: commerce
  labels:
    app.kubernetes.io/name: order-api
    app.kubernetes.io/component: backend
    app.kubernetes.io/part-of: commerce-platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: order-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-api
        app.kubernetes.io/component: backend
        app.kubernetes.io/part-of: commerce-platform
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: registry.example.com/commerce/order-api:1.0.0
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
```

Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
  namespace: commerce
  labels:
    app.kubernetes.io/name: order-api
    app.kubernetes.io/component: backend
    app.kubernetes.io/part-of: commerce-platform
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - name: http
      port: 8080
      targetPort: http
      protocol: TCP
```

Consumer service calling it:

```properties
ORDER_API_BASE_URL=http://order-api.commerce.svc.cluster.local:8080
```

---

## 18. Client-Side vs Server-Side Discovery

Kubernetes ClusterIP Service gives you server-side-ish discovery from application perspective.

The app calls one stable name:

```text
order-api:8080
```

The cluster dataplane selects backend endpoint.

Client-side discovery means the app receives multiple endpoint addresses and chooses one.

This happens with:

- headless Service,
- some gRPC configurations,
- StatefulSet peer discovery,
- custom discovery clients,
- service mesh xDS-aware clients in some models.

Comparison:

| Model | App sees | Load balancing done by | Good for | Risk |
|---|---|---|---|---|
| ClusterIP Service | One stable virtual IP/name | Kubernetes dataplane | Normal stateless service | connection-level imbalance |
| Headless Service | Multiple Pod IPs | client | Stateful/peer-aware systems | stale DNS/client complexity |
| ExternalName | CNAME-like alias | external DNS/client | External dependency alias | TLS/name mismatch, no health |
| Service Mesh | local proxy/service proxy | proxy/control plane | advanced traffic policy | extra complexity |

For normal Java REST API, start with ClusterIP.

Reach for headless only when you need backend identity or client-side balancing.

---

## 19. StatefulSet dan Headless Service

StatefulSet biasanya memakai headless Service untuk stable network identity.

Contoh:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: ledger-db
spec:
  clusterIP: None
  selector:
    app.kubernetes.io/name: ledger-db
  ports:
    - name: db
      port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ledger-db
spec:
  serviceName: ledger-db
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: ledger-db
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ledger-db
    spec:
      containers:
        - name: db
          image: example/ledger-db:1.0.0
          ports:
            - name: db
              containerPort: 5432
```

Stable DNS names:

```text
ledger-db-0.ledger-db.default.svc.cluster.local
ledger-db-1.ledger-db.default.svc.cluster.local
ledger-db-2.ledger-db.default.svc.cluster.local
```

Ini berguna ketika setiap replica punya identity.

Untuk Java app stateless, biasanya tidak perlu identity per Pod.

---

## 20. Cross-Namespace Calls

Service name pendek hanya aman dalam namespace yang sama.

Jika `checkout-api` di namespace `commerce` memanggil `user-api` di namespace `identity`, gunakan:

```text
http://user-api.identity.svc.cluster.local:8080
```

Jangan mengandalkan nama pendek:

```text
http://user-api:8080
```

karena itu akan mencari `user-api` di namespace yang sama dulu.

Jika nanti ada `user-api` di namespace `commerce`, aplikasi bisa memanggil service yang salah.

Production rule:

```text
Same namespace     : short name acceptable
Cross namespace    : use namespace-qualified DNS
Critical dependency: use FQDN
```

---

## 21. Service Discovery dan Environment Topology

Jangan hardcode environment melalui nama Service yang aneh.

Kurang baik:

```text
order-api-dev.default.svc.cluster.local
order-api-staging.default.svc.cluster.local
order-api-prod.default.svc.cluster.local
```

Lebih baik jika environment dipisah namespace:

```text
order-api.commerce-dev.svc.cluster.local
order-api.commerce-staging.svc.cluster.local
order-api.commerce-prod.svc.cluster.local
```

Atau cluster terpisah:

```text
order-api.commerce.svc.cluster.local
```

masing-masing environment punya cluster sendiri.

Prinsip:

> Nama Service sebaiknya merepresentasikan capability aplikasi, bukan environment hack.

---

## 22. Service dan Session Affinity

Service mendukung session affinity berbasis client IP.

Contoh:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: legacy-web
spec:
  selector:
    app.kubernetes.io/name: legacy-web
  sessionAffinity: ClientIP
  ports:
    - port: 80
      targetPort: 8080
```

Gunakan dengan hati-hati.

Untuk Java backend modern, session affinity sering menjadi tanda desain stateful yang perlu dievaluasi.

Risiko:

- load imbalance,
- sticky ke Pod yang overload,
- failure recovery lebih buruk,
- scaling tidak efektif,
- user session hilang jika Pod mati.

Lebih baik:

- session externalized ke Redis/database,
- stateless token,
- sticky only jika memang ada legacy constraint.

---

## 23. Internal Traffic Policy dan Topology Awareness

Kubernetes punya fitur untuk memengaruhi bagaimana traffic internal diarahkan, misalnya internal traffic policy dan topology-aware routing.

Tujuannya:

- mengurangi cross-node/cross-zone traffic,
- menghemat biaya network,
- mengurangi latency,
- menjaga locality.

Namun jangan langsung mengaktifkan locality policy tanpa memahami konsekuensi.

Jika traffic hanya diarahkan ke endpoint lokal, lalu endpoint lokal tidak tersedia, traffic bisa gagal walaupun endpoint di node/zona lain tersedia, tergantung policy.

Production rule:

> Locality optimization boleh dilakukan setelah reliability baseline benar.

Jangan mengorbankan availability untuk micro-optimization latency/cost tanpa data.

---

## 24. Debugging: Service Exists but No Endpoints

Gejala:

```bash
curl http://order-api:8080
```

Error:

```text
connection refused
```

atau timeout.

Langkah debugging:

### 24.1 Cek Service

```bash
kubectl get svc order-api -n commerce
kubectl describe svc order-api -n commerce
```

Perhatikan:

- selector,
- port,
- targetPort,
- type,
- endpoints summary.

### 24.2 Cek Pod label

```bash
kubectl get pods -n commerce --show-labels
```

Pastikan label Pod cocok dengan selector Service.

Jika Service selector:

```yaml
app.kubernetes.io/name: order-api
```

Pod harus punya label:

```text
app.kubernetes.io/name=order-api
```

### 24.3 Cek EndpointSlice

```bash
kubectl get endpointslice -n commerce -l kubernetes.io/service-name=order-api
```

Lalu:

```bash
kubectl describe endpointslice -n commerce -l kubernetes.io/service-name=order-api
```

Jika kosong, berarti tidak ada backend endpoint ready.

### 24.4 Cek readiness

```bash
kubectl get pods -n commerce
kubectl describe pod <pod-name> -n commerce
```

Cari:

```text
Readiness probe failed
```

### 24.5 Cek targetPort

Service:

```yaml
ports:
  - port: 8080
    targetPort: http
```

Pod:

```yaml
ports:
  - name: http
    containerPort: 8080
```

Jika `targetPort: http` tetapi Pod tidak punya named port `http`, routing akan gagal.

---

## 25. Debugging: DNS Fails

Gejala:

```text
java.net.UnknownHostException: order-api
```

Langkah:

### 25.1 Test dari dalam cluster

```bash
kubectl run dns-debug --rm -it --image=busybox:1.36 --restart=Never -- sh
```

Di dalam Pod:

```sh
nslookup order-api.commerce.svc.cluster.local
nslookup kubernetes.default.svc.cluster.local
cat /etc/resolv.conf
```

### 25.2 Cek CoreDNS

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns
```

### 25.3 Cek Service DNS name

Pastikan namespace benar.

Kesalahan umum:

```text
order-api.default.svc.cluster.local
```

padahal service ada di:

```text
commerce
```

Yang benar:

```text
order-api.commerce.svc.cluster.local
```

### 25.4 Cek NetworkPolicy

DNS biasanya butuh akses ke CoreDNS.

Jika NetworkPolicy default deny diterapkan, Pod mungkin tidak bisa query DNS.

Gejala:

- app tidak bisa resolve nama,
- semua outbound dependency gagal,
- IP langsung bisa tetapi hostname gagal.

---

## 26. Debugging: DNS Resolves but Request Timeout

Jika DNS resolve berhasil tetapi request timeout, problem bukan DNS.

Kemungkinan:

- Service tidak punya endpoint ready,
- NetworkPolicy block traffic,
- targetPort salah,
- aplikasi tidak listen di port tersebut,
- Pod listen hanya di `127.0.0.1`, bukan `0.0.0.0`,
- container firewall/security context issue,
- kube-proxy/dataplane issue,
- CNI issue,
- app thread pool saturated,
- GC pause,
- dependency downstream lambat.

Test:

```bash
kubectl exec -n commerce deploy/checkout-api -- curl -v http://order-api.commerce.svc.cluster.local:8080/actuator/health
```

Lalu test langsung ke Pod IP:

```bash
kubectl get pod -n commerce -o wide
kubectl exec -n commerce deploy/checkout-api -- curl -v http://10.244.2.18:8080/actuator/health
```

Interpretasi:

| Test Service | Test Pod IP | Kemungkinan |
|---|---|---|
| gagal | berhasil | Service selector/port/dataplane issue |
| berhasil | gagal | test Pod IP salah atau Pod-specific issue |
| gagal | gagal | app/network/policy issue |
| DNS gagal | Pod IP berhasil | DNS/CoreDNS/resolv.conf issue |

---

## 27. Debugging: Stale Connection after Rollout

Gejala Java:

```text
java.net.SocketException: Connection reset
java.io.IOException: Broken pipe
io.grpc.StatusRuntimeException: UNAVAILABLE
java.net.SocketTimeoutException: Read timed out
```

Terjadi saat rollout atau scale down.

Penyebab umum:

- client punya keep-alive connection ke Pod yang terminating,
- server menutup connection saat shutdown,
- readiness terlambat false,
- preStop/graceful shutdown tidak cukup,
- client retry terlalu agresif atau tidak ada retry,
- load balancer/proxy masih mengirim traffic sebentar,
- long-lived gRPC channel tidak re-resolve.

Solusi desain:

1. Readiness harus berubah false sebelum shutdown penuh.
2. Server Java graceful shutdown diaktifkan.
3. `terminationGracePeriodSeconds` cukup.
4. Client punya timeout pendek dan retry terbatas untuk idempotent request.
5. Connection pool punya max lifetime/idle eviction yang wajar.
6. gRPC keepalive dan name resolution dipahami.
7. Rollout `maxUnavailable` tidak terlalu agresif.

---

## 28. Anti-Pattern Service Discovery

### 28.1 Memanggil Pod IP langsung

Buruk:

```properties
ORDER_API_URL=http://10.244.1.12:8080
```

Kenapa buruk:

- Pod IP ephemeral,
- rollout akan memutus dependency,
- tidak melewati readiness routing,
- tidak scalable.

Gunakan:

```properties
ORDER_API_URL=http://order-api.commerce.svc.cluster.local:8080
```

### 28.2 Selector terlalu generic

Buruk:

```yaml
selector:
  app: api
```

Gunakan:

```yaml
selector:
  app.kubernetes.io/name: order-api
```

### 28.3 Readiness sama dengan liveness

Buruk:

```yaml
readinessProbe:
  httpGet:
    path: /actuator/health
    port: http
livenessProbe:
  httpGet:
    path: /actuator/health
    port: http
```

Jika `/health` mengecek dependency berat, liveness bisa membunuh Pod karena dependency sementara down.

Lebih baik pisah:

```text
/actuator/health/liveness
/actuator/health/readiness
```

### 28.4 Menggunakan LoadBalancer untuk semua internal service

Buruk:

```text
Setiap microservice punya external LoadBalancer.
```

Risiko:

- mahal,
- surface area besar,
- security exposure,
- sulit governance,
- routing/TLS tersebar.

Untuk internal call, gunakan ClusterIP.

Untuk external HTTP, gunakan Gateway/Ingress di part berikutnya.

### 28.5 Menganggap Service membagi request merata

Service tidak selalu request-level load balancer.

HTTP keep-alive/gRPC bisa membuat koneksi sticky.

Jika butuh request-aware routing, pertimbangkan:

- ingress/gateway,
- service mesh,
- application-level load balancing,
- connection pool tuning.

### 28.6 Headless Service untuk semua hal

Headless Service memberi kontrol lebih ke client, tapi juga kompleksitas lebih besar.

Jangan gunakan headless untuk REST API biasa hanya karena terlihat lebih “langsung”.

---

## 29. Service Design Checklist untuk Java Microservices

Untuk setiap Java service, jawab pertanyaan ini:

### Identity

- Apa nama capability service ini?
- Namespace mana yang memilikinya?
- Apakah nama Service stabil lintas release?

### Selector

- Label apa yang dipakai selector?
- Apakah label itu unik untuk aplikasi ini?
- Apakah selector tidak bergantung pada version/build?

### Port

- Service port apa yang dipakai client?
- Target port apa yang dipakai container?
- Apakah targetPort memakai named port?
- Apakah protocol benar?

### Readiness

- Apakah Pod hanya masuk endpoint ketika siap menerima traffic?
- Apakah readiness cukup cepat berubah saat shutdown?
- Apakah readiness tidak terlalu mahal?

### Client Behavior

- Apakah client punya timeout?
- Apakah retry hanya untuk operasi idempotent?
- Apakah connection pool punya eviction/max lifetime?
- Apakah DNS caching sesuai, terutama untuk headless Service?

### Exposure

- Apakah service ini internal-only?
- Apakah benar butuh LoadBalancer?
- Apakah lebih cocok lewat Gateway/Ingress?

### Debuggability

- Apakah label konsisten?
- Apakah endpoint bisa dilihat jelas?
- Apakah health endpoint observable?
- Apakah logs menunjukkan target dependency name?

---

## 30. Latihan Praktik

### Latihan 1 — Buat Service untuk Deployment

Buat Deployment `hello-api` dengan 3 replica dan label:

```yaml
app.kubernetes.io/name: hello-api
```

Expose dengan ClusterIP Service.

Test dari Pod lain:

```bash
curl http://hello-api:8080
```

Validasi:

```bash
kubectl get svc
kubectl get endpointslice -l kubernetes.io/service-name=hello-api
```

### Latihan 2 — Break Selector

Ubah selector Service menjadi label yang salah.

Amati:

```bash
kubectl describe svc hello-api
kubectl get endpointslice -l kubernetes.io/service-name=hello-api
```

Pertanyaan:

- Apakah Service masih ada?
- Apakah DNS masih resolve?
- Apakah endpoint ada?
- Error client menjadi apa?

### Latihan 3 — Readiness Controls Endpoint

Buat readiness probe yang sengaja gagal.

Amati apakah Pod masuk EndpointSlice.

Pertanyaan:

- Pod Running atau tidak?
- Pod Ready atau tidak?
- Service punya endpoint atau tidak?

### Latihan 4 — Cross Namespace DNS

Buat namespace:

```bash
kubectl create namespace commerce
kubectl create namespace identity
```

Deploy `user-api` di `identity`.

Dari Pod di `commerce`, test:

```bash
curl http://user-api:8080
curl http://user-api.identity:8080
curl http://user-api.identity.svc.cluster.local:8080
```

Jelaskan hasilnya.

### Latihan 5 — Headless Service

Buat headless Service untuk StatefulSet kecil.

Amati DNS record:

```bash
nslookup service-name.namespace.svc.cluster.local
nslookup pod-0.service-name.namespace.svc.cluster.local
```

Pertanyaan:

- Apa perbedaan hasil DNS dengan ClusterIP Service?
- Kapan ini berguna?

---

## 31. Production Failure Scenarios

### Scenario 1 — Service Ada, Tapi Traffic Gagal

Symptom:

```text
checkout-api cannot call order-api
```

Investigation:

```bash
kubectl get svc order-api -n commerce
kubectl describe svc order-api -n commerce
kubectl get pods -n commerce --show-labels
kubectl get endpointslice -n commerce -l kubernetes.io/service-name=order-api
```

Root cause:

```text
Deployment label changed from app.kubernetes.io/name=order-api to app=order-api.
Service selector still expects app.kubernetes.io/name=order-api.
```

Invariant learned:

> Service selector is a production contract. Do not mutate labels casually.

### Scenario 2 — Rollout Causes Intermittent 503

Symptom:

```text
5xx spike during deployment.
```

Root cause possibilities:

- readiness true too early,
- app accepts traffic before DB pool ready,
- graceful shutdown missing,
- old Pod killed while still handling request,
- client retries non-idempotent request badly,
- ingress/gateway still routes to terminating backend briefly.

Invariant learned:

> Running is not ready. Terminating is not immediately gone. Client must tolerate transient failure.

### Scenario 3 — Headless Service Causes Stale Pod IP Calls

Symptom:

```text
Java client keeps connecting to Pod IP that no longer exists.
```

Root cause:

- headless Service returns Pod IPs,
- JVM/client caches DNS,
- connection pool keeps old destination,
- Pod replaced during rollout.

Invariant learned:

> Headless Service transfers more discovery responsibility to the client.

### Scenario 4 — DNS Fails Only in One Namespace

Symptom:

```text
Services in namespace app-prod cannot resolve any internal name.
```

Root cause:

- NetworkPolicy default deny blocks egress to CoreDNS.

Invariant learned:

> DNS is network traffic. NetworkPolicy can break service discovery.

---

## 32. Recommended Defaults

Untuk Java microservice stateless:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
  namespace: commerce
  labels:
    app.kubernetes.io/name: order-api
    app.kubernetes.io/component: backend
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - name: http
      port: 8080
      targetPort: http
      protocol: TCP
```

Recommended conventions:

```text
Internal REST service      : ClusterIP
External HTTP exposure     : Gateway/Ingress -> ClusterIP
Stateful peer identity     : Headless Service + StatefulSet
External dependency alias  : ExternalName or selectorless Service, carefully
One-off direct exposure    : LoadBalancer, only when justified
NodePort direct usage      : avoid for app teams unless platform pattern requires it
```

Recommended client config:

```text
Use explicit URL:
http://service.namespace.svc.cluster.local:port

Set:
- connect timeout
- read/request timeout
- bounded retry
- circuit breaker
- connection pool max lifetime
- connection idle eviction
- observability tags for dependency name
```

---

## 33. Key Mental Models

### 33.1 Service is not the workload

Service does not run your app.

Pod runs your app.

Service points to ready endpoints.

### 33.2 DNS success does not mean backend success

DNS can resolve Service name even if Service has no ready endpoint.

So:

```text
DNS success != service healthy
```

### 33.3 Running Pod does not mean Service endpoint

Pod must match selector and be ready.

```text
Running + label match + readiness true = endpoint candidate
```

### 33.4 Labels are routing contracts

Changing labels can change traffic flow.

Treat selector labels as API compatibility surface.

### 33.5 ClusterIP hides endpoint churn, not distributed failure

Service gives stable addressing.

It does not remove need for:

- timeout,
- retry,
- idempotency,
- graceful shutdown,
- circuit breaker,
- observability.

---

## 34. Summary

Kubernetes Service solves a fundamental problem:

> Pod IPs are unstable, but service-to-service communication needs a stable contract.

The Service object provides that stable contract through:

- stable name,
- stable virtual IP for ClusterIP,
- port mapping,
- label selector,
- endpoint publication,
- DNS integration.

EndpointSlice represents the current backend set selected by Service.

Readiness determines whether a matching Pod should receive traffic.

For Java engineers, the hard part is not merely creating a Service YAML.

The hard part is aligning Kubernetes discovery with application runtime behavior:

- JVM DNS caching,
- HTTP keep-alive,
- connection pools,
- gRPC channels,
- graceful shutdown,
- retries,
- readiness,
- rollout behavior,
- network policy,
- observability.

A strong production design does not treat Service as magic.

It treats Service as one part of a larger reliability contract between caller, network, Kubernetes control plane, dataplane, and application lifecycle.

---

## 35. Part Berikutnya

Part berikutnya:

```text
Part 010 — Kubernetes Networking Model: Pods, Services, CNI, and Network Policy
```

Kita akan masuk lebih dalam ke networking model Kubernetes:

- pod-to-pod communication,
- pod-to-service communication,
- service dataplane,
- CNI,
- kube-proxy/eBPF secara konseptual,
- CoreDNS,
- NetworkPolicy,
- default allow/default deny,
- debugging network failure.

---

## 36. Status Seri

```text
Seri belum selesai.
Part saat ini: 009 dari 035.
Part berikutnya: 010 — Kubernetes Networking Model: Pods, Services, CNI, and Network Policy.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Configuration: ConfigMap, Secret, Environment, Files, and Reloadability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-010.md">Part 010 — Kubernetes Networking Model: Pods, Services, CNI, and Network Policy ➡️</a>
</div>
