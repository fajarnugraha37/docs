# learn-kubernetes-mastery-for-java-engineers-part-011.md

# Part 011 — Ingress, Gateway API, and North-South Traffic

> Seri: `learn-kubernetes-mastery-for-java-engineers`  
> Part: `011 / 035`  
> Topik: Ingress, Gateway API, dan north-south traffic  
> Fokus: bagaimana traffic dari luar cluster masuk ke aplikasi Kubernetes secara aman, stabil, observable, dan evolvable.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membangun fondasi networking Kubernetes dari sisi internal cluster:

- Pod punya IP sendiri.
- Service memberi endpoint stabil untuk sekumpulan Pod ephemeral.
- EndpointSlice menghubungkan Service dengan Pod yang siap menerima traffic.
- DNS memberi nama stabil.
- CNI menyediakan konektivitas Pod-to-Pod.
- NetworkPolicy mengatur siapa boleh bicara dengan siapa.

Part ini naik satu level: **bagaimana traffic dari luar cluster masuk ke workload di dalam cluster**.

Inilah yang biasa disebut **north-south traffic**.

Secara sederhana:

```text
Internet / corporate network / external client
        |
        v
External load balancer / edge proxy / gateway
        |
        v
Kubernetes cluster
        |
        v
Service
        |
        v
Pod aplikasi
```

Namun di production, ini tidak sesederhana “expose service ke luar”. Begitu sistem digunakan secara serius, kita harus mengurus:

- hostname
- TLS termination
- certificate lifecycle
- HTTP routing
- path routing
- header routing
- traffic split
- timeout
- retry
- redirect
- CORS
- authentication boundary
- observability
- rate limit
- multi-tenant ownership
- separation of responsibility
- platform vs application team ownership
- blast radius
- controller-specific behavior
- portability across cloud/provider/controller

Target part ini adalah agar kamu bisa memahami **Ingress dan Gateway API bukan sebagai YAML template**, tetapi sebagai **traffic contract** antara external world, platform team, dan application workload.

Setelah menyelesaikan part ini, kamu harus bisa:

1. Menjelaskan bedanya `Service`, `Ingress`, `Ingress Controller`, `GatewayClass`, `Gateway`, dan `HTTPRoute`.
2. Mendesain jalur traffic external-to-service secara eksplisit.
3. Memahami kenapa Ingress API terbatas dan Gateway API muncul sebagai evolusi modern.
4. Menentukan kapan cukup memakai Ingress dan kapan sebaiknya memakai Gateway API.
5. Membaca failure mode north-south traffic secara sistematis.
6. Menghindari anti-pattern umum seperti controller annotation sprawl, TLS mismatch, route conflict, path rewrite tidak jelas, dan ownership boundary yang kabur.
7. Mendesain routing untuk Java REST service, public API, internal API, admin endpoint, dan multi-service platform.

---

## 2. Mental Model Utama

### 2.1 Service Itu Internal Stable Endpoint, Bukan Edge Routing Policy

`Service` adalah abstraksi stabil untuk mengakses Pod. Tetapi Service sendiri tidak cukup untuk banyak kebutuhan edge traffic.

`Service` bisa bertipe:

- `ClusterIP`
- `NodePort`
- `LoadBalancer`
- `ExternalName`

Dari semua itu, `LoadBalancer` sering disalahpahami sebagai solusi final untuk expose aplikasi.

Misalnya:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-api
spec:
  type: LoadBalancer
  selector:
    app: payment-api
  ports:
    - port: 80
      targetPort: 8080
```

Ini mungkin membuat cloud provider membuat external load balancer. Tetapi Service `LoadBalancer` hanya tahu mapping port ke backend Service. Ia tidak secara standar memodelkan hal-hal seperti:

- host `api.example.com`
- path `/payments`
- TLS certificate
- HTTP redirect
- header matching
- weighted traffic split
- multiple applications behind one IP
- route delegation
- policy attachment
- shared gateway ownership

Jadi, Service adalah building block penting, tetapi bukan full edge routing model.

### 2.2 Ingress Adalah HTTP Routing Contract Lama

`Ingress` adalah object Kubernetes yang mendeskripsikan rule untuk traffic HTTP/HTTPS dari luar cluster ke Service dalam cluster.

Mental model:

```text
Ingress object = deklarasi routing HTTP/HTTPS
Ingress controller = komponen yang membaca Ingress dan mengonfigurasi proxy/load balancer nyata
```

Ingress sendiri tidak melakukan routing. Ingress hanyalah desired state.

Yang benar-benar menjalankan routing adalah **Ingress Controller**, misalnya:

- NGINX Ingress Controller
- HAProxy Ingress
- Traefik
- Kong Ingress Controller
- cloud-provider-specific ingress controller
- controller lain

Tanpa controller, membuat object `Ingress` tidak akan menghasilkan traffic path apa pun.

### 2.3 Gateway API Adalah Evolusi Role-Oriented Traffic API

Gateway API muncul karena Ingress terlalu sempit untuk kebutuhan modern.

Ingress bagus untuk use case sederhana:

```text
host + path -> Service
```

Tetapi production platform sering membutuhkan model yang lebih jelas:

```text
Infrastructure team owns GatewayClass and Gateway.
Application team owns HTTPRoute.
Security/network team attaches policy.
```

Gateway API memisahkan beberapa concerns:

```text
GatewayClass -> jenis gateway / controller / implementation
Gateway      -> instance gateway / listener / address / port / TLS boundary
Route        -> aturan routing dari Gateway ke backend Service
```

Dengan model ini, kita tidak menaruh semua tanggung jawab pada satu object besar.

---

## 3. Vocabulary Dasar

Sebelum masuk detail, kita harus mengunci istilah.

### 3.1 North-South Traffic

Traffic yang melewati batas cluster atau batas environment.

Contoh:

```text
Browser user -> api.example.com -> Kubernetes service
Mobile app -> public API gateway -> Kubernetes service
Partner system -> HTTPS endpoint -> Kubernetes service
Corporate network -> internal load balancer -> Kubernetes service
```

Disebut north-south karena secara diagram arsitektur tradisional, traffic external-internal digambar vertikal.

### 3.2 East-West Traffic

Traffic antar-service di dalam environment/cluster/network.

Contoh:

```text
order-service -> payment-service
payment-service -> fraud-service
worker-service -> inventory-service
```

East-west traffic akan lebih dalam dibahas di part Service Mesh. Namun Gateway API juga mulai bisa dipakai untuk beberapa model internal routing, tergantung implementation.

### 3.3 Edge

Edge adalah titik masuk traffic ke platform.

Bisa berupa:

- cloud load balancer
- reverse proxy
- API gateway
- ingress controller
- Kubernetes Gateway implementation
- service mesh ingress gateway
- corporate network gateway

Edge bukan hanya soal “bisa diakses”. Edge adalah boundary untuk:

- TLS
- identity
- traffic policy
- routing
- observability
- protection
- rate limiting
- sometimes authentication/authorization

### 3.4 TLS Termination

TLS termination adalah titik di mana koneksi HTTPS didekripsi.

Kemungkinan pola:

```text
Client --HTTPS--> external LB --HTTP--> cluster
Client --HTTPS--> gateway --HTTP--> Service
Client --HTTPS--> gateway --HTTPS--> Pod
Client --mTLS--> gateway --mTLS/HTTPS--> backend
```

Setiap pilihan punya konsekuensi security, observability, dan operability.

### 3.5 Backend

Dalam konteks Ingress/Gateway API, backend biasanya berarti Kubernetes Service yang menerima traffic setelah route match.

```text
HTTPRoute -> backendRefs -> Service -> EndpointSlice -> Pod
```

---

## 4. Dari Service LoadBalancer ke Ingress ke Gateway API

### 4.1 Level 0: ClusterIP Saja

Aplikasi hanya bisa diakses dari dalam cluster.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  type: ClusterIP
  selector:
    app: order-api
  ports:
    - port: 80
      targetPort: 8080
```

Cocok untuk:

- internal service
- service-to-service communication
- backend internal
- worker-facing API

Tidak cukup untuk public/client-facing access.

### 4.2 Level 1: NodePort

`NodePort` membuka port di setiap node.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  type: NodePort
  selector:
    app: order-api
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080
```

Mental model:

```text
<node-ip>:30080 -> Service -> Pod
```

Masalah:

- port range terbatas
- tidak nyaman untuk banyak app
- expose setiap node
- tidak ideal sebagai public edge
- biasanya dipakai sebagai building block oleh load balancer/controller

### 4.3 Level 2: LoadBalancer Service

Cloud provider membuat load balancer untuk Service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
spec:
  type: LoadBalancer
  selector:
    app: order-api
  ports:
    - port: 80
      targetPort: 8080
```

Cocok untuk:

- satu service perlu satu external IP/LB
- TCP/UDP service sederhana
- internal load balancer tertentu
- quick exposure

Masalah:

- banyak service = banyak LB = cost tinggi
- tidak ada host/path routing standar
- TLS/cert/routing cenderung provider-specific
- ownership edge tidak terpusat

### 4.4 Level 3: Ingress

Satu edge controller bisa route banyak host/path ke banyak Service.

```text
api.example.com/orders   -> order-service
api.example.com/payments -> payment-service
admin.example.com        -> admin-service
```

Lebih baik untuk HTTP/HTTPS use case.

### 4.5 Level 4: Gateway API

Gateway API memodelkan traffic management dengan separation of concerns yang lebih kuat.

```text
GatewayClass: "nginx", "envoy", "istio", "kong", "gke-l7-global-external-managed"
Gateway: shared public gateway with listeners 80/443
HTTPRoute: app-owned routing rules to Services
Policy: attached timeout, retry, auth, TLS, etc depending implementation/spec
```

Cocok untuk platform modern yang butuh:

- shared infrastructure
- multi-team route delegation
- stronger portability model
- richer routing
- clearer status
- multiple protocols
- better ownership boundary

---

## 5. Ingress Deep Dive

### 5.1 Apa Itu Ingress?

Ingress adalah object Kubernetes untuk mengelola external access ke Service, umumnya HTTP/HTTPS.

Contoh minimal:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-api
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: order-api
                port:
                  number: 80
```

Object ini menyatakan:

```text
Untuk host api.example.com dan path yang prefix-nya /orders,
route traffic ke Service order-api port 80.
```

Namun object ini tidak otomatis bekerja tanpa controller.

### 5.2 Ingress Controller

Ingress Controller membaca object `Ingress` dan menerjemahkannya ke konfigurasi proxy/load balancer nyata.

Contoh alur:

```text
User apply Ingress
        |
        v
kube-apiserver stores Ingress object
        |
        v
Ingress Controller watches Ingress
        |
        v
Controller updates NGINX/Envoy/cloud LB config
        |
        v
External traffic can be routed
```

Invariant penting:

```text
Ingress object is desired routing state.
Ingress Controller is reconciler and dataplane configurator.
```

Jika controller tidak ada, salah class, crash, tidak punya RBAC, atau gagal reconcile, Ingress hanya menjadi object pasif di API server.

### 5.3 IngressClass

`IngressClass` menentukan controller mana yang harus menangani Ingress.

```yaml
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: nginx
spec:
  controller: k8s.io/ingress-nginx
```

Ingress dapat menunjuk class:

```yaml
spec:
  ingressClassName: nginx
```

Masalah umum:

- `ingressClassName` tidak sesuai controller
- ada banyak controller dan Ingress diproses controller yang salah
- default class tidak jelas
- migrasi controller menyebabkan behavior berubah

### 5.4 Host Routing

Ingress rule biasanya berbasis hostname.

```yaml
rules:
  - host: api.example.com
    http:
      paths:
        - path: /orders
          pathType: Prefix
          backend:
            service:
              name: order-api
              port:
                number: 80
```

Traffic dengan `Host: api.example.com` akan dievaluasi terhadap rule ini.

Jika DNS `api.example.com` tidak mengarah ke load balancer Ingress Controller, rule tidak akan pernah dicapai.

Jadi jalur lengkapnya:

```text
DNS -> external LB address -> ingress controller dataplane -> Ingress route -> Service -> Pod
```

### 5.5 Path Routing

Ingress path punya `pathType`:

- `Exact`
- `Prefix`
- `ImplementationSpecific`

Contoh:

```yaml
- path: /orders
  pathType: Prefix
```

Makna umumnya:

```text
/orders
/orders/123
/orders/v1/search
```

Tetapi detail matching dan rewrite kadang bergantung controller, terutama jika memakai annotation.

### 5.6 TLS di Ingress

Ingress bisa mendeklarasikan TLS secret:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-api
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
      secretName: api-example-com-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: order-api
                port:
                  number: 80
```

Secret harus ada di namespace yang sama dengan Ingress.

Biasanya bentuk Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-example-com-tls
type: kubernetes.io/tls
data:
  tls.crt: <base64>
  tls.key: <base64>
```

Di production, Secret TLS biasanya tidak dibuat manual, melainkan dihasilkan oleh cert-manager atau integrasi certificate management lain.

### 5.7 Annotation Problem

Ingress API sederhana. Banyak fitur advanced tidak masuk ke spec standar, akhirnya controller memakai annotation.

Contoh annotation NGINX-style:

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
```

Masalah:

1. Annotation tidak portable antar controller.
2. Annotation bisa mengandung behavior besar yang tersembunyi.
3. Validasi annotation sering lemah.
4. Semantik bisa berubah antar versi controller.
5. Aplikasi jadi bergantung pada implementation detail.

Ini salah satu alasan Gateway API penting.

---

## 6. Gateway API Deep Dive

### 6.1 Kenapa Gateway API Ada?

Ingress API sudah stabil dan masih didukung, tetapi API-nya feature-frozen. Kubernetes project merekomendasikan Gateway API untuk pengembangan baru karena Gateway API menyediakan model yang lebih ekspresif untuk dynamic infrastructure provisioning dan advanced traffic routing.

Masalah yang ingin dipecahkan Gateway API:

- Ingress terlalu HTTP-centric dan terbatas.
- Banyak fitur advanced tersebar di annotation controller-specific.
- Tidak ada separation of concerns yang cukup jelas.
- Sulit membagi ownership antara platform team dan app team.
- Status route/gateway tidak selalu cukup kaya.
- Sulit membuat model shared gateway yang aman dan delegated.

### 6.2 Object Utama Gateway API

Gateway API punya beberapa object inti:

```text
GatewayClass
Gateway
HTTPRoute
GRPCRoute
TLSRoute
TCPRoute
UDPRoute
ReferenceGrant
```

Untuk Part 011, fokus utama kita:

```text
GatewayClass -> Gateway -> HTTPRoute -> Service -> Pod
```

### 6.3 GatewayClass

`GatewayClass` merepresentasikan jenis gateway yang tersedia di cluster.

Mental model:

```text
GatewayClass = template/class/implementation gateway
```

Contoh:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: example-gateway-class
spec:
  controllerName: example.com/gateway-controller
```

Di managed Kubernetes, class bisa merepresentasikan cloud LB tertentu.

Contoh konseptual:

```text
public-l7-global
internal-l7-regional
envoy-shared
nginx-edge
istio-gateway
kong-public
```

Biasanya GatewayClass dikelola platform/infrastructure team, bukan app team.

### 6.4 Gateway

`Gateway` adalah instance gateway yang menerima traffic.

Mental model:

```text
Gateway = listener + address + port + protocol + TLS boundary
```

Contoh:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public-gateway
  namespace: platform-ingress
spec:
  gatewayClassName: example-gateway-class
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      hostname: "*.example.com"
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - name: wildcard-example-com-tls
```

Gateway menjawab pertanyaan:

```text
Traffic masuk lewat mana?
Port apa?
Protocol apa?
Hostname apa?
TLS termination di mana?
Route dari namespace mana yang boleh attach?
```

### 6.5 HTTPRoute

`HTTPRoute` mendefinisikan aturan routing HTTP dari Gateway ke backend Service.

Mental model:

```text
HTTPRoute = app-owned routing rules
```

Contoh:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-api-route
  namespace: order
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
            value: /orders
      backendRefs:
        - name: order-api
          port: 80
```

Ini menyatakan:

```text
Attach route ini ke Gateway platform-ingress/public-gateway.
Untuk host api.example.com dan path prefix /orders,
kirim traffic ke Service order/order-api port 80.
```

### 6.6 ParentRefs

`parentRefs` menghubungkan Route ke Gateway.

```yaml
parentRefs:
  - name: public-gateway
    namespace: platform-ingress
```

Ini penting karena Gateway dan HTTPRoute bisa berada di namespace berbeda.

Dengan model ini:

- platform team bisa mengelola Gateway di namespace `platform-ingress`
- application team bisa mengelola HTTPRoute di namespace `order`

Tetapi cross-namespace attachment harus dikontrol.

### 6.7 allowedRoutes

Gateway listener bisa menentukan route dari namespace mana yang boleh attach.

Contoh konseptual:

```yaml
listeners:
  - name: https
    protocol: HTTPS
    port: 443
    hostname: "*.example.com"
    allowedRoutes:
      namespaces:
        from: Selector
        selector:
          matchLabels:
            expose-public: "true"
```

Ini mengurangi risiko sembarang namespace menempelkan route ke public gateway.

### 6.8 ReferenceGrant

`ReferenceGrant` dipakai untuk mengizinkan reference lintas namespace tertentu.

Contoh kasus:

- Route di namespace app ingin refer ke Service di namespace lain.
- Gateway di namespace platform ingin refer ke Secret di namespace security.

Gateway API sengaja membuat cross-namespace reference eksplisit agar lebih aman.

Mental model:

```text
Cross-namespace reference should be opt-in by target namespace owner.
```

### 6.9 Route Status

Gateway API memiliki status yang lebih kaya.

Kita bisa melihat apakah route:

- accepted
- not accepted
- resolved refs
- punya conflict
- gateway listener valid
- backend reference valid

Contoh command:

```bash
kubectl describe httproute order-api-route -n order
kubectl get httproute order-api-route -n order -o yaml
kubectl describe gateway public-gateway -n platform-ingress
```

Status ini sangat penting untuk debugging.

---

## 7. Ingress vs Gateway API

### 7.1 Perbandingan Konsep

| Concern | Ingress | Gateway API |
|---|---|---|
| Primary protocol | HTTP/HTTPS | HTTP, gRPC, TLS, TCP, UDP depending route type/support |
| Edge object | Ingress | Gateway |
| Route object | Ingress rule | HTTPRoute/GRPCRoute/TCPRoute/etc |
| Controller binding | IngressClass | GatewayClass |
| Multi-team ownership | Terbatas | Lebih eksplisit |
| Advanced routing | Banyak lewat annotation | Lebih banyak dimodelkan sebagai field/policy |
| Cross-namespace delegation | Terbatas | Lebih eksplisit |
| API evolution | Frozen | Aktif dikembangkan |
| Portability | Sering terikat annotation | Lebih baik, meski implementation support tetap perlu dicek |

### 7.2 Kapan Ingress Masih Masuk Akal?

Ingress masih bisa masuk akal jika:

- cluster existing sudah mature dengan Ingress Controller
- routing sederhana host/path ke Service
- tidak butuh delegation kompleks
- tidak butuh multi-protocol advanced routing
- platform sudah punya standar annotation yang terkendali
- migrasi Gateway API belum didukung provider/controller

Jangan migrasi hanya karena tren jika sistem existing stabil dan risiko migrasi tinggi.

### 7.3 Kapan Gateway API Lebih Tepat?

Gateway API lebih tepat jika:

- membangun platform baru
- butuh shared gateway untuk banyak team
- butuh separation of concerns yang jelas
- butuh route delegation lintas namespace
- butuh HTTPRoute yang lebih ekspresif
- ingin mengurangi annotation vendor lock-in
- butuh status/debuggability lebih baik
- provider/controller sudah mendukung Gateway API dengan baik

### 7.4 Keputusan Arsitektural Realistis

Pilihan bukan sekadar:

```text
Ingress buruk, Gateway baik.
```

Pilihan yang lebih benar:

```text
Ingress adalah API stabil lama yang cukup untuk banyak HTTP use case sederhana.
Gateway API adalah model baru yang lebih cocok untuk platform traffic management modern.
```

Untuk engineer/architect, pertanyaan yang benar:

1. Siapa yang memiliki edge infrastructure?
2. Siapa yang boleh expose route public?
3. Apakah route perlu lintas namespace?
4. Apakah butuh fitur routing advanced?
5. Apakah controller mendukung fitur yang dibutuhkan?
6. Apakah policy/security bisa ditegakkan konsisten?
7. Apakah observability route cukup jelas?
8. Apakah migrasi aman dan bisa rollback?

---

## 8. End-to-End Traffic Path

### 8.1 Ingress Path

Contoh jalur:

```text
Client
  |
  | DNS api.example.com
  v
External Load Balancer
  |
  v
Ingress Controller Pod / dataplane
  |
  | reads Ingress rule
  v
Service order-api
  |
  v
EndpointSlice
  |
  v
Ready Pod order-api-xxxxx
  |
  v
Java process port 8080
```

Jika request gagal, jangan langsung salahkan aplikasi.

Setiap layer bisa gagal:

- DNS salah
- external LB belum provisioned
- security group/firewall salah
- ingress controller tidak running
- ingressClass salah
- TLS secret tidak ada
- host mismatch
- path mismatch
- Service salah port
- Service selector tidak match Pod
- Pod not ready
- NetworkPolicy block
- Java app listening di port berbeda
- app returns 404 karena context path mismatch

### 8.2 Gateway API Path

```text
Client
  |
  | DNS api.example.com
  v
Gateway address / external LB
  |
  v
Gateway listener 443 HTTPS
  |
  v
HTTPRoute match host/path/header
  |
  v
backendRef Service order-api:80
  |
  v
EndpointSlice
  |
  v
Ready Pod
  |
  v
Java process
```

Debugging Gateway API harus membaca:

- GatewayClass status
- Gateway status
- Listener status
- HTTPRoute status
- backendRefs resolution
- Service endpoints
- controller logs/events

---

## 9. Java Service Considerations

### 9.1 Context Path vs Gateway Path

Misalnya route external:

```text
/api/orders -> order-service
```

Aplikasi Java bisa didesain dua cara.

#### Pattern A — App Aware of Prefix

Spring Boot app memang melayani `/api/orders`.

```text
External: /api/orders
Internal app: /api/orders
```

Kelebihan:

- no rewrite magic
- logs/traces konsisten
- easier debugging

Kekurangan:

- app tahu external path prefix
- refactor route bisa butuh app change

#### Pattern B — Gateway Rewrite

Gateway menerima `/api/orders`, lalu rewrite ke `/orders` atau `/`.

```text
External: /api/orders
Internal app: /orders
```

Kelebihan:

- app lebih internal-centric
- external path bisa berubah di edge

Kekurangan:

- rewrite behavior controller-specific jika Ingress annotation
- debugging 404 lebih sulit
- generated links bisa salah
- OpenAPI docs bisa mismatch
- redirect Location header bisa salah

Untuk public API, hindari rewrite kompleks kecuali benar-benar diperlukan dan distandardisasi.

### 9.2 Forwarded Headers

Saat traffic melewati proxy/gateway, aplikasi Java sering perlu memahami header:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
Forwarded
```

Gunanya:

- generate absolute URL
- redirect HTTP -> HTTPS dengan benar
- audit client IP
- security logging
- rate limiting app-level

Masalah umum:

- app mengira request datang via HTTP padahal external HTTPS
- redirect ke internal hostname
- client IP yang dilog adalah proxy IP
- trust boundary forwarded header tidak jelas

Prinsip:

```text
Forwarded headers are security-sensitive. Only trust them from trusted proxies.
```

### 9.3 Timeouts

Java service timeout harus disejajarkan dengan gateway/proxy timeout.

Contoh problem:

```text
Gateway timeout: 30s
Java app async timeout: 60s
DB query timeout: 120s
Client timeout: 10s
```

Hasilnya:

- client sudah timeout
- gateway mungkin memutus request
- app masih kerja
- DB masih kerja
- retry dari client/gateway bisa menggandakan beban

Desain yang lebih baik:

```text
Client timeout <= gateway timeout <= app timeout <= downstream timeout?
```

Atau lebih tepat:

```text
Budget request harus eksplisit dari edge sampai dependency.
```

Untuk public API, kamu perlu menentukan:

- max request duration
- idle timeout
- read timeout
- write timeout
- upstream timeout
- retry policy
- cancellation behavior

### 9.4 Retries

Gateway bisa melakukan retry, client bisa retry, Java app bisa retry ke downstream.

Retry multiplication:

```text
Client retries 3x
Gateway retries 2x
App retries DB 3x
Total possible attempts = 3 * 2 * 3 = 18
```

Ini bisa mengubah outage kecil menjadi overload besar.

Prinsip:

- retry hanya untuk error yang aman
- gunakan timeout pendek dan backoff
- jangan retry non-idempotent command tanpa idempotency key
- observability retry harus jelas
- gateway retry harus selaras dengan application semantics

### 9.5 Health Endpoints and Edge Routing

Gateway/Ingress biasanya route ke Service, lalu Service hanya mengirim ke Pod yang ready.

Namun readiness endpoint harus benar.

Jika Java app readiness terlalu longgar:

```text
Pod ready -> Service endpoint active -> Gateway sends traffic -> app semantically not ready
```

Jika readiness terlalu ketat:

```text
temporary downstream degradation -> all pods unready -> no endpoints -> 503 at gateway
```

Untuk REST API production:

- liveness: proses tidak deadlocked/fatal
- readiness: bisa melayani request kelas utama
- startup: app selesai warmup awal
- dependency readiness: jangan terlalu naif; bedakan hard dependency dan soft dependency

---

## 10. TLS Design

### 10.1 Terminate at Edge

Pola umum:

```text
Client --HTTPS--> Gateway/Ingress --HTTP--> Service/Pod
```

Kelebihan:

- sederhana
- observability gateway mudah
- cert management terpusat
- backend tidak perlu TLS

Kekurangan:

- traffic internal gateway-to-pod plaintext
- tidak cukup untuk zero-trust internal network
- compliance tertentu mungkin butuh encryption end-to-end

### 10.2 Re-encrypt to Backend

```text
Client --HTTPS--> Gateway --HTTPS--> Pod
```

Kelebihan:

- encryption end-to-end secara transport
- backend identity bisa lebih kuat

Kekurangan:

- cert lifecycle lebih kompleks
- Java TLS config lebih rumit
- truststore/keystore management
- debugging lebih sulit
- performance overhead

### 10.3 mTLS

```text
Client/Gateway --mTLS--> Backend
```

mTLS memberi mutual identity, tetapi jangan gunakan hanya karena terdengar secure. Pastikan ada kebutuhan:

- workload identity
- compliance
- internal zero trust
- service mesh integration
- partner integration

mTLS membawa kompleksitas:

- certificate issuance
- rotation
- trust anchor
- revocation/story
- client identity mapping
- debugging handshake

### 10.4 TLS Secret Ownership

Pertanyaan desain:

- Siapa yang membuat certificate?
- Namespace mana menyimpan Secret?
- Apakah app team boleh membaca private key?
- Apakah wildcard certificate dipakai bersama?
- Bagaimana rotation dilakukan?
- Bagaimana expired cert terdeteksi?

Dalam Gateway API, separation antara Gateway dan HTTPRoute membantu membuat ownership TLS lebih eksplisit.

---

## 11. Route Ownership and Platform Design

### 11.1 Problem dengan Semua App Mengelola Ingress Sendiri

Jika setiap team membuat Ingress sendiri:

```text
team-a creates api.example.com/foo
team-b creates api.example.com/bar
team-c creates wildcard route
team-d adds risky annotation
```

Risiko:

- host conflict
- path conflict
- annotation dangerous
- inconsistent TLS
- no central policy
- hard to audit public exposure
- accidental public admin endpoint

### 11.2 Gateway API Role Model

Gateway API mendorong role separation:

```text
Infrastructure provider / cluster operator:
  - GatewayClass
  - Gateway implementation
  - external addresses
  - load balancer class

Platform/network team:
  - shared Gateway
  - listener
  - TLS boundary
  - allowedRoutes
  - global policy

Application team:
  - HTTPRoute
  - backend Service
  - app-specific routing rules
```

Ini cocok dengan platform engineering modern.

### 11.3 Namespace Delegation

Contoh:

```text
Namespace order has label expose-public=true.
Gateway listener allows routes from namespaces with expose-public=true.
Order team can attach HTTPRoute to public gateway.
```

Tapi tetap butuh guardrail:

- allowed hostnames
- route approval process
- policy validation
- security scanning
- admin endpoint restriction
- DNS ownership
- certificate ownership

### 11.4 Public vs Internal Gateway

Sebaiknya pisahkan gateway berdasarkan exposure class:

```text
public-gateway
  - internet-facing
  - strict policy
  - public cert
  - WAF/rate limit possible

internal-gateway
  - private network only
  - internal cert
  - corporate/service clients

admin-gateway
  - restricted access
  - strong auth
  - maybe VPN/private only
```

Jangan expose semua melalui satu gateway tanpa policy boundary yang jelas.

---

## 12. Manifest Examples

### 12.1 Baseline Java Service

Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: order
  labels:
    app.kubernetes.io/name: order-api
    app.kubernetes.io/component: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: order-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: order-api
        app.kubernetes.io/component: api
    spec:
      containers:
        - name: app
          image: registry.example.com/order-api:1.0.0
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            failureThreshold: 30
            periodSeconds: 5
```

Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api
  namespace: order
  labels:
    app.kubernetes.io/name: order-api
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: order-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

### 12.2 Ingress Example

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: order-api
  namespace: order
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
      secretName: api-example-com-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: order-api
                port:
                  number: 80
```

### 12.3 Gateway API Example

Gateway managed by platform team:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public-gateway
  namespace: platform-ingress
spec:
  gatewayClassName: example-gateway-class
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "api.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - name: api-example-com-tls
      allowedRoutes:
        namespaces:
          from: Selector
          selector:
            matchLabels:
              gateway-access: public-api
```

Namespace label:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: order
  labels:
    gateway-access: public-api
```

HTTPRoute managed by app team:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-api
  namespace: order
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
            value: /orders
      backendRefs:
        - name: order-api
          port: 80
```

### 12.4 Weighted Traffic Split

Gateway API can model weighted backend routing, depending on support.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-api-canary
  namespace: order
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
            value: /orders
      backendRefs:
        - name: order-api-stable
          port: 80
          weight: 90
        - name: order-api-canary
          port: 80
          weight: 10
```

Caution:

```text
Traffic split at gateway layer is not the same as semantic canary safety.
```

Kamu tetap perlu:

- metrics by version
- error rate comparison
- latency comparison
- rollback plan
- DB compatibility
- idempotency
- downstream behavior awareness

---

## 13. Debugging North-South Traffic

### 13.1 Debugging Method

Gunakan method berlapis:

```text
1. Is DNS correct?
2. Is external address provisioned?
3. Is the gateway/ingress controller healthy?
4. Is the route object accepted?
5. Is host/path matching correct?
6. Is TLS certificate valid and referenced correctly?
7. Is backend Service correct?
8. Does Service have endpoints?
9. Are Pods ready?
10. Is NetworkPolicy blocking traffic?
11. Is Java app listening on the right port/path?
12. Are timeouts/retries causing apparent failure?
```

### 13.2 Commands for Ingress

```bash
kubectl get ingress -A
kubectl describe ingress order-api -n order
kubectl get ingress order-api -n order -o yaml
kubectl get ingressclass
kubectl describe ingressclass nginx
kubectl get svc -n ingress-nginx
kubectl get pods -n ingress-nginx
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller
```

Check Service and endpoints:

```bash
kubectl get svc order-api -n order
kubectl get endpointslice -n order -l kubernetes.io/service-name=order-api
kubectl get pods -n order -l app.kubernetes.io/name=order-api
kubectl describe pod -n order -l app.kubernetes.io/name=order-api
```

### 13.3 Commands for Gateway API

```bash
kubectl get gatewayclass
kubectl get gateway -A
kubectl describe gateway public-gateway -n platform-ingress
kubectl get httproute -A
kubectl describe httproute order-api -n order
kubectl get httproute order-api -n order -o yaml
```

Look for conditions:

```text
Accepted
Programmed
ResolvedRefs
Conflicted
```

Names vary depending object/controller, but the key idea is:

```text
Route status tells you whether the controller accepted and programmed the route.
```

### 13.4 Test from Outside

```bash
curl -v https://api.example.com/orders
curl -vk https://api.example.com/orders
curl -H 'Host: api.example.com' http://<lb-ip>/orders
```

Check TLS:

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com
```

### 13.5 Test from Inside Cluster

Run temporary debug Pod:

```bash
kubectl run tmp-curl -n order --rm -it --image=curlimages/curl -- sh
```

Inside:

```bash
curl -v http://order-api.order.svc.cluster.local
curl -v http://order-api.order.svc.cluster.local/actuator/health/readiness
```

If internal Service works but external route fails, issue is likely in:

- DNS
- LB
- gateway/ingress controller
- route rule
- TLS
- network edge policy

If internal Service also fails, issue is likely in:

- Service selector
- Pod readiness
- application port
- NetworkPolicy
- app crash

---

## 14. Common Failure Modes

### 14.1 Ingress Exists but Does Nothing

Symptoms:

```text
kubectl get ingress shows object
but no external traffic works
```

Likely causes:

- no Ingress Controller installed
- wrong `ingressClassName`
- controller has no RBAC
- controller crashlooping
- cloud LB provisioning failed
- Ingress ignored due to class mismatch

Debug:

```bash
kubectl get ingressclass
kubectl describe ingress <name> -n <namespace>
kubectl get pods -A | grep ingress
kubectl logs <controller-pod>
```

Invariant:

```text
Ingress requires a controller. Object existence is not dataplane existence.
```

### 14.2 Gateway Route Not Accepted

Symptoms:

```text
HTTPRoute exists but traffic not routed
```

Likely causes:

- parentRefs wrong
- Gateway listener does not allow route namespace
- hostname not compatible with listener hostname
- backendRef invalid
- cross-namespace reference not allowed
- controller does not support route feature

Debug:

```bash
kubectl describe httproute <route> -n <ns>
kubectl describe gateway <gateway> -n <ns>
```

Look at conditions.

Invariant:

```text
HTTPRoute must be accepted by a Gateway listener before it affects traffic.
```

### 14.3 TLS Certificate Mismatch

Symptoms:

```text
browser certificate warning
curl reports certificate subject mismatch
```

Likely causes:

- certificate CN/SAN does not include hostname
- wrong Secret referenced
- Secret in wrong namespace
- Gateway/Ingress not reloaded
- DNS points to wrong LB

Debug:

```bash
kubectl get secret <secret> -n <ns>
openssl s_client -connect api.example.com:443 -servername api.example.com
```

Invariant:

```text
Hostname, DNS, listener, route, and certificate SAN must align.
```

### 14.4 404 from Gateway/Ingress

Symptoms:

```text
HTTP 404 returned by gateway/ingress controller
```

Likely causes:

- host mismatch
- path mismatch
- route not attached
- wrong path type
- rewrite issue
- default backend response

Differentiate:

```text
404 from gateway/proxy != 404 from Java app
```

Check response headers/body. Controller may add identifiable headers.

### 14.5 503 No Healthy Upstream / No Endpoints

Symptoms:

```text
503 Service Unavailable
no healthy upstream
```

Likely causes:

- Service has no endpoints
- Pod not ready
- selector mismatch
- readiness probe failing
- backend port mismatch
- NetworkPolicy prevents controller-to-backend

Debug:

```bash
kubectl get svc <svc> -n <ns> -o yaml
kubectl get endpointslice -n <ns> -l kubernetes.io/service-name=<svc>
kubectl get pods -n <ns> --show-labels
kubectl describe pod <pod> -n <ns>
```

Invariant:

```text
Gateway/Ingress routes to Service, but Service needs ready endpoints.
```

### 14.6 502 Bad Gateway

Likely causes:

- backend connection refused
- app not listening on targetPort
- protocol mismatch HTTP/HTTPS
- upstream reset connection
- app closes connection unexpectedly
- proxy expects HTTP but backend speaks gRPC/TLS/TCP

Debug:

```bash
kubectl port-forward svc/<svc> 8080:80 -n <ns>
curl -v http://localhost:8080
```

### 14.7 Timeout

Likely causes:

- NetworkPolicy block
- backend overloaded
- app thread pool exhausted
- DB downstream slow
- gateway upstream timeout too low
- connection pool stale
- DNS/LB issue
- request body too large/slow

Debug:

- check ingress/gateway logs
- check app latency metrics
- check backend saturation
- check network policy
- check Java thread dump if needed
- check p99 latency, not only average

### 14.8 Route Conflict

Symptoms:

- one route works, another ignored
- unexpected backend receives traffic
- controller reports conflict

Likely causes:

- same host/path claimed by multiple teams
- wildcard route overlaps specific route
- precedence not understood
- multiple controllers watching same object

Invariant:

```text
Shared edge requires explicit route ownership and conflict policy.
```

### 14.9 Admin Endpoint Accidentally Public

Symptoms:

```text
/actuator, /metrics, /admin, /internal exposed publicly
```

Likely causes:

- broad path prefix `/`
- app exposes management endpoints on same port
- no route-level restriction
- no separate management Service
- no security policy validation

Prevention:

- separate management port if possible
- do not route admin paths publicly
- add admission/policy checks
- use internal gateway for admin
- restrict actuator exposure in Spring Boot

---

## 15. Design Patterns

### 15.1 Public API Gateway Pattern

```text
public-gateway
  api.example.com/orders   -> order-api
  api.example.com/payments -> payment-api
  api.example.com/users    -> user-api
```

Good when:

- many services share one domain
- clients expect unified API surface
- platform wants centralized TLS and policy

Risks:

- path ownership conflict
- versioning complexity
- accidental coupling between teams

### 15.2 Domain-per-Service Pattern

```text
orders.example.com   -> order-api
payments.example.com -> payment-api
users.example.com    -> user-api
```

Good when:

- services are independently exposed
- ownership by domain clearer
- less path conflict

Risks:

- many DNS/cert entries
- client integration fragmented
- policy duplication if not centralized

### 15.3 Public/Internal Split

```text
api.example.com             -> public routes only
internal-api.example.local   -> internal corporate/service routes
admin.example.local          -> admin routes only
```

Good when:

- strict exposure boundary needed
- admin/internal APIs must never be public
- compliance/security matters

### 15.4 Backend-for-Frontend Edge

```text
web.example.com -> web-bff
mobile.example.com -> mobile-bff
```

BFF handles client-specific API aggregation. Gateway only routes.

Avoid putting business orchestration into gateway annotations/policies unless gateway is intentionally your API management layer.

### 15.5 Canary Route Pattern

```text
90% -> stable Service
10% -> canary Service
```

Works if:

- both versions compatible
- metrics separated by version
- rollback quick
- route split actually representative

Be careful with:

- sticky sessions
- long-lived connections
- cache behavior
- non-idempotent requests
- DB migration compatibility

---

## 16. Anti-Patterns

### 16.1 Treating Ingress/Gateway as Mere YAML Snippets

Bad mental model:

```text
copy paste ingress yaml until it works
```

Better mental model:

```text
model the traffic contract from client to backend and define ownership at every boundary
```

### 16.2 One Wildcard Route to Rule Them All

Example dangerous pattern:

```text
*.example.com / -> some backend
```

Risk:

- accidental host capture
- debugging ambiguity
- security exposure
- route conflict

### 16.3 Path Rewrite Without Contract

If external path and internal path differ, document it.

Bad:

```text
Nobody knows gateway rewrites /api/foo to /
```

Consequences:

- broken redirects
- incorrect OpenAPI URL
- wrong metrics labels
- confusing logs

### 16.4 Public Actuator

Never expose all Spring Boot actuator endpoints publicly.

Especially dangerous:

- `/actuator/env`
- `/actuator/configprops`
- `/actuator/heapdump`
- `/actuator/threaddump`
- `/actuator/loggers`

Even `/actuator/health` should be intentionally designed.

### 16.5 Inconsistent Timeout Stack

Bad:

```text
client timeout 5s
edge timeout 60s
app timeout 120s
db timeout infinite
```

This causes wasted work and retry storms.

### 16.6 Controller-Specific Annotation Sprawl

If every service has dozens of annotations, you no longer have a clean platform contract. You have hidden imperative configuration encoded as strings.

### 16.7 Shared Gateway Without Governance

If every namespace can attach any route to public gateway, you have no real exposure control.

---

## 17. Production Checklist

### 17.1 Exposure Checklist

For every externally exposed service, answer:

```text
- Is this service meant to be public, internal, partner-only, or admin-only?
- What hostname owns it?
- What path owns it?
- Who owns DNS?
- Who owns certificate?
- Who owns route object?
- Who approves public exposure?
- Which gateway/ingress controller handles it?
- What is the rollback plan?
```

### 17.2 TLS Checklist

```text
- Certificate SAN matches hostname.
- Secret exists in expected namespace.
- Certificate rotation is automated.
- Expiry is monitored.
- TLS termination point is documented.
- Backend protocol HTTP/HTTPS is explicit.
```

### 17.3 Routing Checklist

```text
- Host match is explicit.
- Path match is explicit.
- Rewrite behavior is avoided or documented.
- Route conflict policy is known.
- Backend Service name/port is correct.
- Service has ready endpoints.
- Gateway/Ingress status is healthy.
```

### 17.4 Java Service Checklist

```text
- App listens on expected containerPort.
- Service targetPort references named port.
- Readiness probe reflects traffic readiness.
- Startup probe handles warmup.
- Management endpoint exposure is restricted.
- Forwarded headers are configured safely.
- Timeout budget is aligned.
- Retry behavior is intentional.
- Logs include request ID/correlation ID.
```

### 17.5 Security Checklist

```text
- Public route is intentionally approved.
- Admin/internal paths are not public.
- NetworkPolicy allows gateway-to-backend only where needed.
- ServiceAccount/RBAC for controller is scoped appropriately.
- Secret access is limited.
- Dangerous annotations/policies are restricted.
```

### 17.6 Observability Checklist

```text
- Edge request count by host/path/status.
- Edge latency percentiles.
- Upstream/backend error rate.
- TLS handshake/cert errors.
- Route accepted/programmed status.
- Backend endpoint availability.
- App logs correlated with edge request ID.
```

---

## 18. Decision Framework

### 18.1 Selecting Exposure Primitive

Use this simple decision model:

```text
Need only internal access?
  -> ClusterIP Service

Need simple TCP/UDP exposure, one service, one LB?
  -> LoadBalancer Service

Need simple HTTP host/path routing and existing platform uses Ingress?
  -> Ingress

Need modern shared edge, route delegation, richer routing, multi-team ownership?
  -> Gateway API

Need service-to-service traffic policy, mTLS, retries, circuit breaking across mesh?
  -> Service Mesh / Gateway API integration depending platform
```

### 18.2 Architecture Questions

Before choosing Ingress/Gateway, ask:

1. Is this public internet, private network, or internal cluster traffic?
2. Is traffic HTTP, gRPC, TLS passthrough, TCP, or UDP?
3. Is TLS terminated at edge or backend?
4. Who owns certificate?
5. Who owns DNS?
6. Who owns the edge controller?
7. Who owns application route?
8. How are conflicts prevented?
9. How are route changes reviewed?
10. How is exposure audited?
11. What is the failure blast radius?
12. How is rollback performed?

---

## 19. Practical Lab

### 19.1 Lab Goal

Build a mental and practical flow:

```text
Browser/curl -> Gateway/Ingress -> Service -> Java Pod
```

You can use any sample HTTP app, but ideally use a simple Spring Boot service.

### 19.2 Lab A — Internal Baseline

1. Deploy Java app.
2. Create ClusterIP Service.
3. Test from inside cluster.
4. Verify EndpointSlice.

Commands:

```bash
kubectl get deploy,svc,pod -n order
kubectl get endpointslice -n order -l kubernetes.io/service-name=order-api
kubectl run tmp-curl -n order --rm -it --image=curlimages/curl -- sh
```

Inside tmp Pod:

```bash
curl -v http://order-api.order.svc.cluster.local/actuator/health/readiness
```

### 19.3 Lab B — Expose with Ingress

1. Install an Ingress Controller in local cluster.
2. Create Ingress.
3. Map hostname locally if needed.
4. Test with curl Host header.

```bash
curl -H 'Host: api.example.local' http://localhost/orders
```

Observe:

```bash
kubectl describe ingress order-api -n order
kubectl logs -n <ingress-namespace> <controller-pod>
```

### 19.4 Lab C — Expose with Gateway API

1. Install Gateway API CRDs if needed.
2. Install a Gateway implementation/controller.
3. Create GatewayClass/Gateway depending implementation.
4. Create HTTPRoute.
5. Inspect status conditions.

```bash
kubectl get gatewayclass
kubectl get gateway -A
kubectl get httproute -A
kubectl describe httproute order-api -n order
```

### 19.5 Lab D — Break Things Intentionally

Break one thing at a time:

- wrong Service port
- wrong path
- wrong hostname
- remove readiness
- wrong label selector
- route from disallowed namespace
- missing TLS secret
- wrong Gateway parentRef

For each failure, record:

```text
Symptom:
Layer:
Object involved:
Command that revealed it:
Root cause:
Fix:
Invariant learned:
```

This is how you build real Kubernetes fluency.

---

## 20. Summary

Ingress and Gateway API are not merely ways to “open access to a service”. They are **north-south traffic contracts**.

Core mental model:

```text
External client
  -> DNS
  -> external load balancer / gateway address
  -> ingress/gateway dataplane
  -> route rule
  -> Service
  -> EndpointSlice
  -> Ready Pod
  -> Java process
```

Ingress is the older stable HTTP routing API. It is still usable and widely deployed, but its API is frozen and advanced features often rely on controller-specific annotations.

Gateway API is the modern evolution. It separates infrastructure class, gateway listener, and application route into distinct resources:

```text
GatewayClass -> Gateway -> HTTPRoute -> Service -> Pod
```

The most important production lesson:

```text
A route object existing in Kubernetes does not mean traffic is working.
You must verify controller acceptance, dataplane programming, Service endpoints, Pod readiness, and application behavior.
```

For Java engineers, edge routing must be aligned with:

- context path
- forwarded headers
- readiness
- startup behavior
- timeout budget
- retry semantics
- management endpoint exposure
- observability correlation

A top-tier engineer does not debug north-south traffic by guessing. They walk the chain from DNS to Java process and verify each contract boundary.

---

## 21. Referensi Utama

- Kubernetes Documentation — Ingress
- Kubernetes Documentation — Ingress Controllers
- Kubernetes Documentation — Gateway API
- Gateway API Documentation — API Overview
- Gateway API Documentation — API Reference
- Kubernetes Documentation — Services
- Kubernetes Documentation — DNS for Services and Pods
- Kubernetes Documentation — Network Policies

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Kubernetes Networking Model: Pods, Services, CNI, and Network Policy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-012.md">Part 012 — Storage: Volumes, PersistentVolume, PVC, StorageClass, CSI ➡️</a>
</div>
