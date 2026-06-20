# learn-kubernetes-mastery-for-java-engineers-part-010.md

# Part 010 — Kubernetes Networking Model: Pods, Services, CNI, and Network Policy

> Seri: Kubernetes Mastery for Java Engineers  
> Part: 010 dari 035  
> Status seri: **belum selesai**  
> Fokus: memahami networking Kubernetes sebagai model komunikasi distributed system, bukan sekadar “Pod bisa ping Service”.

---

## 1. Tujuan Part Ini

Setelah part ini, kamu diharapkan mampu:

1. Memahami model networking Kubernetes dari sudut pandang **Pod, Node, Service, DNS, CNI, kube-proxy/dataplane, dan NetworkPolicy**.
2. Membedakan jalur komunikasi:
   - Pod ke Pod
   - Pod ke Service
   - Pod ke external system
   - external client ke Service
   - Node ke Pod
   - control plane ke node/workload
3. Memahami bahwa Kubernetes networking adalah gabungan dari:
   - API abstraction
   - node networking
   - container networking
   - DNS
   - service proxying
   - route/iptables/IPVS/eBPF dataplane
   - policy enforcement
4. Mampu men-debug kasus umum seperti:
   - DNS gagal resolve
   - Service ada tapi tidak bisa diakses
   - Service punya endpoint tapi connection timeout
   - traffic terblokir NetworkPolicy
   - Pod bisa connect dari satu namespace tapi tidak dari namespace lain
   - Java client mengalami stale connection saat Pod rollout
   - timeout hanya terjadi cross-zone atau cross-node
5. Mampu membuat desain network yang masuk akal untuk Java microservices:
   - internal API
   - public API
   - worker/consumer
   - database dependency
   - observability endpoint
   - restricted egress
   - namespace isolation

Part ini tidak mengulang dasar TCP/IP, HTTP, TLS, DNS, Nginx, atau Linux networking yang sudah pernah dibahas. Kita fokus pada bagaimana Kubernetes menyusun semua itu menjadi model operasional cluster.

---

## 2. Mental Model Utama

Kubernetes networking bisa dipahami dengan satu kalimat:

> Kubernetes membuat banyak workload ephemeral terlihat seperti sistem jaringan yang stabil melalui kombinasi Pod IP, Service virtual IP, DNS, endpoint discovery, node dataplane, dan policy.

Tanpa Kubernetes, service discovery dan routing biasanya dikelola oleh:

- load balancer eksternal,
- service registry,
- reverse proxy,
- static config,
- DNS record manual,
- client-side discovery,
- firewall rule manual.

Di Kubernetes, sebagian besar itu dipindahkan ke object dan controller:

```text
Deployment/Pod changes
        |
        v
Pod IP changes
        |
        v
EndpointSlice updated
        |
        v
Service sees new backends
        |
        v
DNS name remains stable
        |
        v
client still calls stable Service name
```

Tetapi penting:

> Kubernetes tidak menghapus kompleksitas network. Kubernetes memindahkan kompleksitas itu ke control plane, node dataplane, CNI plugin, DNS, dan policy object.

Seorang engineer yang hanya melihat `curl http://service-name` akan bingung saat incident. Engineer yang memahami object graph network akan tahu layer mana yang harus diperiksa.

---

## 3. Core Network Invariant Kubernetes

Ada beberapa invariant utama:

### 3.1 Setiap Pod mendapatkan IP sendiri

Pod memiliki IP address sendiri di dalam cluster network. Container di dalam Pod berbagi network namespace yang sama, sehingga container-container dalam Pod yang sama dapat berkomunikasi lewat `localhost`.

Model ini membuat Pod terlihat seperti “logical host”.

```text
Pod A
  container app      -> localhost:8080
  container sidecar  -> localhost:15000
  Pod IP             -> 10.244.1.12
```

### 3.2 Pod IP bersifat ephemeral

Pod IP bukan identitas stabil. Saat Pod mati dan dibuat ulang, kemungkinan besar IP berubah.

Karena itu client Java tidak boleh mengandalkan Pod IP secara langsung untuk dependency normal.

Gunakan Service DNS name.

### 3.3 Service memberikan endpoint stabil

Service adalah abstraksi stabil untuk sekumpulan Pod yang cocok dengan selector atau endpoint yang didefinisikan.

Service memberi:

- stable DNS name,
- stable virtual IP untuk `ClusterIP`,
- stable port abstraction,
- dynamic backend membership lewat EndpointSlice.

### 3.4 EndpointSlice adalah backend membership aktual

Service bukan backend. Service menunjuk ke backend lewat EndpointSlice.

Jika Service ada tetapi EndpointSlice kosong, traffic tidak punya tujuan.

```text
Service: payment-api
Selector: app=payment-api

Pods:
- pod-a labels app=payment-api, Ready=True
- pod-b labels app=payment-api, Ready=True
- pod-c labels app=payment-api, Ready=False

EndpointSlice biasanya hanya memasukkan endpoint yang ready untuk traffic normal.
```

### 3.5 DNS memberikan nama stabil, bukan jaminan koneksi sukses

DNS resolve berhasil hanya membuktikan nama ditemukan. Itu belum membuktikan:

- Service punya endpoint,
- endpoint ready,
- network path terbuka,
- NetworkPolicy mengizinkan,
- target process listening,
- TLS cocok,
- application protocol benar.

### 3.6 NetworkPolicy adalah allow-list, bukan firewall global otomatis

NetworkPolicy hanya berlaku jika CNI plugin mendukung enforcement NetworkPolicy.

Tanpa policy, default umumnya adalah allow. Setelah Pod dipilih oleh policy tertentu, traffic yang tidak diizinkan eksplisit dapat diblokir sesuai arah ingress/egress yang dipilih.

### 3.7 Namespace bukan network boundary otomatis

Namespace adalah boundary administrasi object. Namespace tidak otomatis mencegah Pod A di namespace X menghubungi Pod B di namespace Y.

Isolasi network membutuhkan NetworkPolicy atau mekanisme CNI/service mesh/policy lain.

---

## 4. Kubernetes Networking Layers

Untuk debugging, jangan pikir “network Kubernetes” sebagai satu benda. Pecah menjadi layer:

```text
Application Layer
  Java HTTP/gRPC/JDBC/Kafka client
  timeout, DNS cache, connection pool, TLS, retry

Kubernetes Service Discovery Layer
  Service
  EndpointSlice
  DNS

Kubernetes Policy Layer
  NetworkPolicy
  admission/policy constraints
  service mesh policy if any

Node Dataplane Layer
  kube-proxy or alternative dataplane
  iptables/IPVS/eBPF
  node routing

CNI Layer
  Pod IP allocation
  veth/interface setup
  overlay/routed network
  policy enforcement

Infrastructure Layer
  cloud VPC/VNet
  security group/firewall
  load balancer
  route table
  NAT gateway
  DNS resolver
```

Saat incident, pertanyaan pertama bukan “network-nya kenapa?”. Pertanyaan yang lebih tepat:

```text
Layer mana yang gagal?

- Nama gagal resolve? DNS layer.
- Nama resolve tapi Service tidak punya endpoint? Kubernetes discovery layer.
- Endpoint ada tapi timeout? dataplane/policy/app listening.
- Hanya gagal antar namespace? NetworkPolicy atau DNS naming.
- Hanya gagal dari node tertentu? CNI/node dataplane.
- Hanya gagal saat rollout? readiness, endpoint update, client connection reuse.
- Hanya gagal ke internet? egress/NAT/firewall/policy.
```

---

## 5. The Kubernetes Network Model

Kubernetes memiliki model dasar yang secara konseptual menginginkan:

1. Pod dapat berkomunikasi dengan semua Pod lain tanpa NAT di level Pod.
2. Node dapat berkomunikasi dengan semua Pod.
3. Agent di Node seperti kubelet dapat berkomunikasi dengan Pod di node tersebut.
4. IP yang dilihat Pod terhadap dirinya sendiri adalah IP yang sama dengan yang dilihat komponen lain terhadap Pod itu.

Implementasi detailnya tidak ditentukan oleh Kubernetes core. Itulah peran CNI dan infrastruktur.

Konsekuensi penting:

- Kubernetes tidak mewajibkan satu teknologi network tertentu.
- Cluster berbeda bisa punya perilaku performa dan debugging berbeda.
- CNI plugin sangat memengaruhi NetworkPolicy, routing, MTU, eBPF, observability, encryption, dan performance.

Contoh CNI/plugin/dataplane yang umum:

- Calico
- Cilium
- Flannel
- Weave Net
- cloud provider CNI, misalnya AWS VPC CNI, Azure CNI, GKE networking

Materi ini tidak masuk ke detail implementasi masing-masing plugin, tetapi kamu harus tahu bahwa banyak “masalah Kubernetes networking” sebenarnya adalah masalah CNI/dataplane/infrastruktur.

---

## 6. Pod Networking Deep Dive

### 6.1 Pod sebagai network namespace

Container dalam satu Pod berbagi:

- IP address,
- port space,
- loopback interface,
- network namespace.

Artinya dua container dalam Pod yang sama tidak bisa bind port yang sama.

```text
Pod payment-api
  app container     binds :8080
  metrics sidecar   binds :9090
  envoy sidecar     binds :15000
```

Jika app dan sidecar sama-sama bind `:8080`, salah satu gagal start.

### 6.2 Pod IP bukan kontrak stabil

Pod IP berubah saat Pod recreated. Karena itu:

```text
Wrong:
  PAYMENT_URL=http://10.244.1.17:8080

Better:
  PAYMENT_URL=http://payment-api.payments.svc.cluster.local:8080
```

### 6.3 Pod readiness memengaruhi endpoint

Pod bisa `Running` tetapi belum `Ready`.

Untuk Service biasa, endpoint yang belum ready umumnya tidak dipakai untuk traffic normal.

```text
Pod phase: Running
ContainersReady: True
Ready: False

Akibat:
- Pod process hidup
- logs ada
- exec bisa
- tetapi Service mungkin belum mengirim traffic ke Pod
```

Ini sering membingungkan developer:

> “Pod running, kenapa tidak menerima traffic?”

Jawaban: karena routing Service mengikuti readiness, bukan sekadar phase Running.

### 6.4 Host networking

Pod dapat memakai `hostNetwork: true`, tetapi ini adalah escape hatch.

Efeknya:

- Pod memakai network namespace Node.
- Port collision dengan process lain di Node mungkin terjadi.
- Pod tidak mendapatkan isolasi network normal.
- DNS policy perlu diperhatikan.

Gunakan hanya untuk kasus khusus:

- node agent,
- CNI components,
- low-level networking,
- observability agent tertentu,
- performance-sensitive daemon tertentu.

Untuk Java app biasa, `hostNetwork` hampir selalu anti-pattern.

---

## 7. Service Networking Recap dari Sudut Dataplane

Part 009 sudah membahas Service Discovery. Di sini kita lihat Service sebagai networking abstraction.

Service `ClusterIP` memberi virtual IP internal cluster.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-api
  namespace: payments
spec:
  type: ClusterIP
  selector:
    app: payment-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Maknanya:

```text
Client call:
  http://payment-api.payments.svc.cluster.local:80

Service port:
  80

Backend Pod port:
  8080
```

Service bukan process. Service tidak “listen” seperti Nginx. Service adalah API object yang direalisasikan oleh dataplane cluster.

### 7.1 kube-proxy model

`kube-proxy` berjalan di node dan mengimplementasikan bagian dari konsep Service, biasanya dengan membuat rule forwarding ke endpoint backend.

Secara mental:

```text
Client Pod -> Service ClusterIP:port
           -> node dataplane rule
           -> chosen backend PodIP:targetPort
```

Implementasi bisa berupa:

- iptables,
- IPVS,
- userspace lama,
- atau digantikan oleh eBPF dataplane dari plugin tertentu.

Kamu tidak perlu hafal rule iptables untuk menjadi app engineer yang kuat, tetapi kamu harus tahu bahwa Service VIP tidak ajaib. Ada rule di node/dataplane yang membuat VIP bisa bekerja.

### 7.2 Service without selector

Service bisa dibuat tanpa selector. Ini umum untuk:

- external backend,
- database di luar cluster,
- manual endpoint,
- migration scenario.

Tetapi ini juga berbahaya jika tim mengira endpoint otomatis dibuat.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: external-db
spec:
  ports:
    - port: 5432
      targetPort: 5432
```

Tanpa selector, tidak ada Pod yang otomatis menjadi endpoint.

### 7.3 Headless Service

Headless Service (`clusterIP: None`) tidak memberikan VIP load balancing normal. DNS dapat mengembalikan endpoint individual.

Ini sering dipakai untuk:

- StatefulSet,
- broker cluster,
- database cluster,
- client yang butuh tahu anggota individual.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: kafka-brokers
spec:
  clusterIP: None
  selector:
    app: kafka
  ports:
    - name: broker
      port: 9092
```

Untuk Java client biasa, headless service perlu dipahami karena client mungkin mendapatkan banyak IP dan melakukan connection management sendiri.

---

## 8. DNS in Kubernetes

### 8.1 Service DNS name

Format umum:

```text
<service>.<namespace>.svc.cluster.local
```

Contoh:

```text
payment-api.payments.svc.cluster.local
```

Dari Pod dalam namespace yang sama, biasanya bisa cukup:

```text
payment-api
```

Dari namespace berbeda, gunakan minimal:

```text
payment-api.payments
```

Lebih eksplisit:

```text
payment-api.payments.svc.cluster.local
```

### 8.2 DNS search path

Pod biasanya memiliki search path di `/etc/resolv.conf`, misalnya:

```text
search payments.svc.cluster.local svc.cluster.local cluster.local
```

Karena itu `payment-api` bisa diekspansi menjadi `payment-api.payments.svc.cluster.local`.

Failure yang sering terjadi:

```text
Namespace caller: orders
Service target: payment-api.payments

Code memakai:
  http://payment-api:80

Akibat:
  mencoba resolve payment-api.orders.svc.cluster.local
  bukan payment-api.payments.svc.cluster.local
```

### 8.3 Java DNS caching

Java punya DNS caching behavior yang bisa berpengaruh pada Kubernetes.

Masalah umum:

- Service DNS stabil, biasanya aman.
- Headless Service DNS berubah sesuai endpoint, caching bisa menahan IP lama.
- ExternalName atau external dependency bisa berubah, caching bisa menghambat failover.
- JVM/security properties dapat mengubah TTL cache.

Untuk Service `ClusterIP`, Java DNS cache tidak terlalu bermasalah karena nama Service resolve ke stable virtual IP. Untuk headless Service, DNS cache jauh lebih penting karena hasil resolve bisa berupa daftar Pod IP.

### 8.4 DNS berhasil bukan berarti aplikasi sehat

Contoh:

```bash
nslookup payment-api.payments.svc.cluster.local
```

Jika berhasil, artinya DNS menemukan record. Tetapi request bisa tetap gagal karena:

- Service endpoint kosong,
- target Pod tidak listening,
- NetworkPolicy block,
- port salah,
- TLS mismatch,
- app error,
- timeout karena backend overload.

DNS adalah satu layer, bukan jawaban akhir.

---

## 9. CNI: Container Network Interface

CNI adalah mekanisme plugin untuk menyediakan network bagi Pod.

Secara konseptual, saat Pod dibuat di Node:

```text
kubelet asks container runtime to create pod sandbox
        |
        v
container runtime invokes CNI plugin
        |
        v
CNI plugin:
  - creates interface
  - assigns Pod IP
  - configures route
  - configures network namespace
  - may enforce policy
```

### 9.1 Apa yang diputuskan oleh CNI?

CNI/plugin biasanya memengaruhi:

- bagaimana Pod IP dialokasikan,
- apakah network overlay atau routed,
- bagaimana traffic cross-node berjalan,
- apakah NetworkPolicy didukung,
- bagaimana policy ditegakkan,
- apakah eBPF dipakai,
- apakah traffic dienkripsi,
- bagaimana observability network tersedia,
- performa latency/throughput,
- integrasi cloud VPC.

### 9.2 Overlay vs routed networking

Secara sederhana:

```text
Overlay:
  Pod traffic dibungkus dalam tunnel antar node.
  Lebih portable, tetapi ada overhead dan potensi MTU issue.

Routed/native:
  Pod IP routable di network infrastruktur.
  Bisa lebih efisien, tetapi bergantung pada cloud/VPC/routing support.
```

Jangan hafal ini sebagai dogma. Evaluasi berdasarkan:

- cloud provider,
- skala cluster,
- multi-zone,
- security requirement,
- observability,
- NetworkPolicy support,
- operational maturity.

### 9.3 CNI failure symptom

Masalah CNI sering muncul sebagai:

- Pod stuck `ContainerCreating`,
- error create pod sandbox,
- Pod IP tidak dialokasikan,
- Pod hanya gagal connect cross-node,
- DNS Pod tidak bisa diakses,
- NetworkPolicy tidak bekerja,
- packet drop tanpa log aplikasi,
- timeout sporadis antar node.

Debugging-nya berbeda dari debugging aplikasi.

---

## 10. NetworkPolicy Mental Model

NetworkPolicy adalah object Kubernetes untuk mengontrol traffic L3/L4 ke atau dari Pod.

Pahami kalimat ini:

> NetworkPolicy memilih Pod target, lalu mendefinisikan traffic apa yang diizinkan untuk arah ingress dan/atau egress.

NetworkPolicy bukan rule global seperti firewall tradisional yang selalu dievaluasi top-down.

### 10.1 Default behavior

Jika tidak ada NetworkPolicy yang memilih sebuah Pod, Pod tersebut biasanya non-isolated untuk arah itu.

Jika ada NetworkPolicy yang memilih Pod untuk ingress, maka ingress ke Pod itu hanya diizinkan jika cocok dengan rule ingress yang mengizinkan.

Jika ada NetworkPolicy yang memilih Pod untuk egress, maka egress dari Pod itu hanya diizinkan jika cocok dengan rule egress yang mengizinkan.

### 10.2 Additive allow model

NetworkPolicy bersifat additive allow.

Jika beberapa policy memilih Pod yang sama, traffic yang diizinkan adalah gabungan allow dari policy-policy tersebut.

Tidak ada explicit deny bawaan di Kubernetes NetworkPolicy standar.

### 10.3 Minimal default deny ingress

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

Makna:

```text
Untuk semua Pod di namespace payments:
- ingress menjadi isolated
- tidak ada ingress yang diizinkan kecuali ada policy lain yang allow
```

### 10.4 Minimal default deny egress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Egress
```

Makna:

```text
Untuk semua Pod di namespace payments:
- egress menjadi isolated
- tidak ada egress yang diizinkan kecuali ada policy lain yang allow
```

Hati-hati: ini bisa langsung memutus DNS, database, metrics, tracing, dan dependency external.

### 10.5 Allow ingress from same namespace

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector: {}
```

Makna:

```text
Semua Pod di namespace payments boleh menerima traffic dari Pod lain di namespace payments.
```

### 10.6 Allow specific app to call payment-api

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-orders-to-payment-api
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: payment-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: orders
          podSelector:
            matchLabels:
              app: order-api
      ports:
        - protocol: TCP
          port: 8080
```

Makna:

```text
Pod app=payment-api di namespace payments boleh menerima TCP/8080 dari Pod app=order-api di namespace orders.
```

### 10.7 Allow DNS egress

Jika menerapkan default deny egress, biasanya perlu allow DNS ke CoreDNS.

Contoh konseptual:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

Label CoreDNS bisa berbeda tergantung cluster. Jangan copy tanpa verifikasi.

### 10.8 NetworkPolicy limitations

NetworkPolicy standar biasanya tidak mengatur:

- HTTP path,
- HTTP method,
- JWT claim,
- TLS identity,
- DNS domain egress secara portable,
- L7 authorization,
- explicit deny priority,
- host-level firewall secara penuh.

Untuk L7 policy, biasanya perlu:

- service mesh,
- API gateway,
- ingress/gateway policy,
- CNI extension tertentu,
- application authorization.

---

## 11. Traffic Path Patterns

### 11.1 Pod to Service in same namespace

```text
orders-api Pod
  calls http://payment-api:80
        |
        v
DNS expands payment-api.orders.svc.cluster.local
        |
        v
If Service exists in orders namespace -> resolve
If target service actually in payments namespace -> fail or wrong service
```

Lesson:

> Same namespace shorthand is convenient, but cross-namespace dependency should use explicit namespace.

### 11.2 Pod to Service in different namespace

```text
orders-api.orders
  calls payment-api.payments.svc.cluster.local
        |
        v
CoreDNS resolves Service ClusterIP
        |
        v
node dataplane routes to one payment-api endpoint
        |
        v
payment-api Pod receives traffic on targetPort
```

Layer yang bisa gagal:

- DNS name salah,
- Service tidak ada,
- Service endpoint kosong,
- kube-proxy/dataplane bermasalah,
- NetworkPolicy ingress block,
- NetworkPolicy egress block,
- app tidak listening,
- port mismatch,
- TLS mismatch.

### 11.3 Pod to external service

```text
Pod -> DNS resolve external host -> node/CNI egress -> NAT/firewall -> internet/private network
```

Layer yang bisa gagal:

- DNS external blocked,
- egress NetworkPolicy blocked,
- cluster NAT tidak tersedia,
- cloud firewall/security group blocked,
- proxy required tapi app tidak pakai,
- corporate DNS split-horizon issue,
- TLS truststore Java tidak punya CA.

### 11.4 External client to app

Biasanya path:

```text
Client
  -> cloud load balancer
  -> ingress/gateway controller
  -> Service
  -> EndpointSlice backend
  -> Pod
```

Atau untuk `LoadBalancer` Service langsung:

```text
Client
  -> cloud load balancer
  -> Node/Service dataplane
  -> Pod
```

Part 011 akan membahas Ingress dan Gateway API lebih dalam.

---

## 12. Java-Specific Networking Concerns

Kubernetes network issue sering diperparah oleh behavior Java runtime dan library.

### 12.1 Connection pooling

Java HTTP/JDBC/gRPC/Kafka clients sering memakai persistent connection.

Saat backend Pod terminate:

```text
old connection -> old Pod
Pod receives SIGTERM
Pod removed from endpoint after readiness false
existing connection may still exist
client may reuse connection
connection reset / timeout / broken pipe
```

Mitigasi:

- readiness false sebelum shutdown,
- graceful shutdown cukup panjang,
- connection idle timeout wajar,
- retry aman untuk idempotent operation,
- client timeout eksplisit,
- server keep-alive timeout diselaraskan,
- load balancer draining diperhatikan.

### 12.2 DNS caching

Untuk ClusterIP Service, DNS stable. Untuk headless Service atau external dependency, DNS cache bisa menjadi masalah.

Periksa:

- JVM DNS TTL,
- library resolver behavior,
- Netty DNS resolver,
- gRPC name resolver,
- Kafka bootstrap/server advertised listener,
- JDBC failover DNS.

### 12.3 Timeout harus eksplisit

Di Kubernetes, network failure sering berupa timeout, bukan immediate failure.

Setiap Java client harus punya:

- connect timeout,
- read/request timeout,
- pool acquisition timeout,
- idle timeout,
- max lifetime,
- retry budget,
- circuit breaker jika relevan.

Anti-pattern:

```text
Tidak ada timeout karena “di internal network pasti cepat”.
```

Internal network tetap bisa gagal.

### 12.4 Retry storm

Jika Service dependency down, semua Pod client bisa retry bersamaan.

```text
100 order-api pods
  each retries 3 times
  each has 50 concurrent requests
        |
        v
payment-api receives retry amplification
```

Network reliability bukan hanya masalah Kubernetes. App-level resilience tetap wajib.

### 12.5 Large response and MTU issue

MTU issue kadang muncul hanya pada payload besar.

Symptom:

- request kecil berhasil,
- request besar timeout,
- hanya cross-node,
- hanya antar AZ,
- TLS handshake kadang gagal,
- gRPC streaming putus.

Ini biasanya masuk ranah CNI/overlay/infrastructure, bukan bug controller.

---

## 13. Manifest Examples

### 13.1 Basic Java API Deployment + Service

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payments
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payment-api
  template:
    metadata:
      labels:
        app: payment-api
    spec:
      containers:
        - name: app
          image: registry.example.com/payment-api:1.0.0
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: payment-api
  namespace: payments
spec:
  type: ClusterIP
  selector:
    app: payment-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

Design note:

- Service exposes port 80 internally.
- Pod app listens on 8080.
- `targetPort: http` follows named container port.
- readiness controls endpoint membership.

### 13.2 Explicit cross-namespace call config

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-api-config
  namespace: orders
data:
  PAYMENT_API_BASE_URL: "http://payment-api.payments.svc.cluster.local"
```

This avoids namespace search path ambiguity.

### 13.3 NetworkPolicy default deny + specific allow

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
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-orders-to-payment-api
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: payment-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: orders
          podSelector:
            matchLabels:
              app: order-api
      ports:
        - protocol: TCP
          port: 8080
```

Important subtlety:

- Rule port refers to target Pod port, not Service port.
- If `payment-api` container listens on 8080 but Service exposes 80, NetworkPolicy ingress to Pod should allow 8080.

---

## 14. Debugging Method: From Name to Packet to Process

Gunakan alur sistematis.

### 14.1 Identify source and destination

Jawab dulu:

```text
Source:
- Pod name?
- namespace?
- node?
- service account?
- labels?

Destination:
- DNS name?
- Service?
- namespace?
- port?
- protocol?
- expected backend pods?
```

Jangan mulai dari `kubectl logs` saja.

### 14.2 Check DNS

```bash
kubectl exec -n orders deploy/order-api -- nslookup payment-api.payments.svc.cluster.local
```

Jika image tidak punya `nslookup`, gunakan debug Pod:

```bash
kubectl run -n orders dnsutils --image=registry.k8s.io/e2e-test-images/agnhost:2.39 -- sleep 3600
kubectl exec -n orders dnsutils -- nslookup payment-api.payments.svc.cluster.local
```

Periksa:

```bash
kubectl get svc -n payments payment-api
kubectl get endpointslice -n payments -l kubernetes.io/service-name=payment-api
```

### 14.3 Check Service and endpoints

```bash
kubectl describe svc -n payments payment-api
kubectl get endpointslice -n payments -l kubernetes.io/service-name=payment-api -o wide
```

Jika endpoint kosong:

```bash
kubectl get pods -n payments -l app=payment-api --show-labels
kubectl get pods -n payments -l app=payment-api -o wide
kubectl describe pod -n payments <pod-name>
```

Kemungkinan:

- selector salah,
- Pod label tidak cocok,
- Pod belum Ready,
- readiness probe gagal,
- target port mismatch.

### 14.4 Check port and process

Dari dalam Pod target:

```bash
kubectl exec -n payments <payment-pod> -- sh -c 'netstat -tulpn || ss -tulpn'
```

Tidak semua image punya `netstat` atau `ss`. Bisa pakai ephemeral container jika diizinkan.

Periksa apakah app listen pada:

```text
0.0.0.0:8080  good for Pod access
127.0.0.1:8080 only localhost inside Pod
```

Jika Java app bind ke `127.0.0.1`, Service tidak bisa menjangkaunya dari luar Pod.

### 14.5 Check NetworkPolicy

```bash
kubectl get networkpolicy -A
kubectl describe networkpolicy -n payments
kubectl describe networkpolicy -n orders
```

Cari:

- policy yang memilih source Pod untuk egress,
- policy yang memilih destination Pod untuk ingress,
- namespace labels,
- pod labels,
- port mismatch,
- DNS egress blocked.

### 14.6 Check node locality

```bash
kubectl get pods -n orders -o wide
kubectl get pods -n payments -o wide
```

Jika hanya gagal antar node, curigai:

- CNI,
- route,
- security group,
- MTU,
- kube-proxy/dataplane,
- node firewall.

### 14.7 Check CoreDNS

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns
kubectl get svc -n kube-system kube-dns
```

Label bisa berbeda tergantung cluster.

### 14.8 Check kube-proxy/dataplane

Jika cluster memakai kube-proxy:

```bash
kubectl get pods -n kube-system -l k8s-app=kube-proxy -o wide
kubectl logs -n kube-system -l k8s-app=kube-proxy
```

Jika memakai Cilium/eBPF atau dataplane lain, command berbeda.

---

## 15. Common Failure Modes

### 15.1 Service exists but no endpoints

Symptom:

```text
DNS resolves Service name.
Curl timeout or connection refused.
kubectl get endpointslice shows no ready endpoints.
```

Causes:

- selector tidak cocok,
- Pod label salah,
- readiness probe gagal,
- Pod crash,
- target workload di namespace berbeda,
- Service selector terlalu spesifik.

Fix:

- samakan label selector,
- cek readiness,
- cek `kubectl describe svc`,
- cek EndpointSlice.

### 15.2 Wrong targetPort

Service:

```yaml
ports:
  - port: 80
    targetPort: 8080
```

App ternyata listen di 8081.

Symptom:

- endpoint ada,
- DNS resolve,
- connection refused.

Fix:

- perbaiki `targetPort`,
- gunakan named port agar lebih jelas.

### 15.3 App binds to localhost

Spring Boot atau app server bind ke `127.0.0.1`.

Symptom:

- health check via exec lokal berhasil,
- Service access gagal,
- `kubectl port-forward` mungkin membingungkan hasilnya.

Fix:

- bind ke `0.0.0.0`,
- set server address config dengan benar.

### 15.4 DNS blocked by egress NetworkPolicy

Symptom:

```text
UnknownHostException
Temporary failure in name resolution
nslookup timeout
```

Cause:

- default deny egress tanpa allow UDP/TCP 53 ke CoreDNS.

Fix:

- allow DNS egress ke CoreDNS,
- verifikasi label CoreDNS.

### 15.5 Namespace shorthand bug

Code:

```text
http://payment-api
```

Source Pod namespace:

```text
orders
```

Target Service namespace:

```text
payments
```

Result:

- resolve payment-api.orders.svc.cluster.local,
- service not found,
- or worse: service dengan nama sama di namespace orders terpakai.

Fix:

```text
http://payment-api.payments.svc.cluster.local
```

### 15.6 NetworkPolicy port mismatch

Service exposes 80, Pod listens 8080.

Policy allows 80 to Pod.

Result:

- traffic blocked because actual destination Pod port is 8080.

Fix:

- allow target container port.

### 15.7 CNI does not enforce NetworkPolicy

NetworkPolicy dibuat, tapi traffic tetap lewat.

Cause:

- CNI plugin tidak mendukung NetworkPolicy enforcement,
- policy controller tidak terpasang,
- policy syntax tidak memilih Pod yang diharapkan.

Fix:

- verifikasi CNI support,
- test policy dengan known source/destination,
- jangan asumsikan NetworkPolicy bekerja hanya karena object diterima API server.

### 15.8 Cross-node only failure

Symptom:

- Pod di node sama bisa connect,
- Pod di node berbeda timeout.

Causes:

- CNI routing,
- overlay tunnel,
- MTU,
- node firewall,
- cloud security group,
- kube-proxy inconsistency.

Fix:

- cek node placement,
- test same-node vs cross-node,
- inspect CNI logs,
- inspect node route/security group.

### 15.9 Stale Java connections after rollout

Symptom:

- error spike during deployment,
- `Connection reset by peer`,
- `Broken pipe`,
- sporadic 5xx.

Cause:

- connection pool reuses connection to terminating Pod,
- readiness removed too late,
- termination grace too short,
- server shutdown not graceful,
- load balancer draining not aligned.

Fix:

- implement graceful shutdown,
- readiness false before terminating,
- tune keep-alive,
- tune terminationGracePeriodSeconds,
- client retry for safe requests.

---

## 16. Network Design for Java Microservices

### 16.1 Internal service naming convention

Use explicit DNS for cross-namespace dependencies:

```text
http://<service>.<namespace>.svc.cluster.local
```

For config readability:

```yaml
data:
  PAYMENT_API_BASE_URL: "http://payment-api.payments.svc.cluster.local"
  INVENTORY_API_BASE_URL: "http://inventory-api.inventory.svc.cluster.local"
```

### 16.2 Namespace boundary plus NetworkPolicy

A practical production model:

```text
Namespace: orders
  order-api
  order-worker

Namespace: payments
  payment-api
  payment-worker

Namespace: observability
  prometheus
  otel-collector

Policies:
  - default deny ingress per app namespace
  - allow ingress only from known callers
  - allow metrics scraping from observability
  - default deny egress for sensitive namespaces
  - allow egress to DNS, DB, broker, external APIs as needed
```

### 16.3 Separate public and internal entrypoints

Avoid exposing internal app Service directly.

```text
External:
  Gateway/Ingress -> public-api Service -> Pods

Internal:
  internal ClusterIP Services only
```

### 16.4 Metrics port policy

If Prometheus scrapes `/actuator/prometheus`, allow only observability namespace.

```text
observability/prometheus -> app namespace Pod metrics port
```

Do not expose actuator admin endpoints publicly.

### 16.5 Egress discipline

For regulated systems, egress matters as much as ingress.

Classify dependency:

```text
Internal cluster service
Managed DB private endpoint
Message broker private endpoint
Object storage endpoint
External government/regulatory API
Payment provider API
Observability collector
DNS
NTP if needed
```

Then model allowed egress explicitly.

---

## 17. Security Perspective

Kubernetes networking security baseline:

1. Namespace alone is not enough.
2. ServiceAccount alone is not network identity in plain NetworkPolicy.
3. Labels become security selectors; protect label governance.
4. NetworkPolicy is L3/L4, not application authorization.
5. DNS egress must be deliberately allowed if default deny egress is used.
6. Sensitive workloads should not have broad egress.
7. Observability endpoints need network restriction.
8. Internal Service does not mean secure Service.

Important principle:

> NetworkPolicy reduces blast radius; it does not replace authentication, authorization, input validation, TLS, or application-level access control.

---

## 18. Operational Checklist

Before declaring a Java service production-ready in Kubernetes networking terms:

### Service discovery

- [ ] Service name is stable and documented.
- [ ] Cross-namespace dependencies use explicit DNS names.
- [ ] Service selector matches Pod labels.
- [ ] EndpointSlice shows ready endpoints.
- [ ] Named ports are used where useful.

### Application binding

- [ ] App binds to `0.0.0.0`, not only `127.0.0.1`.
- [ ] Container port matches actual app port.
- [ ] Service targetPort matches container port.
- [ ] Health endpoints are reachable from kubelet.

### Java client behavior

- [ ] Connect timeout configured.
- [ ] Request/read timeout configured.
- [ ] Connection pool max lifetime configured.
- [ ] Idle timeout configured.
- [ ] Retry policy bounded.
- [ ] Retry only safe/idempotent operations unless explicitly designed.

### Rollout and draining

- [ ] Readiness goes false before shutdown completes.
- [ ] terminationGracePeriodSeconds is sufficient.
- [ ] Keep-alive behavior understood.
- [ ] Error spike during rollout is monitored.

### Policy

- [ ] NetworkPolicy support verified in CNI.
- [ ] Default deny strategy decided.
- [ ] DNS egress allowed when needed.
- [ ] Metrics scraping allowed only from observability.
- [ ] Sensitive egress restricted.
- [ ] Policy tested, not merely applied.

### Debuggability

- [ ] Debug image or ephemeral container strategy exists.
- [ ] Team knows how to inspect Service and EndpointSlice.
- [ ] Team knows how to test DNS inside namespace.
- [ ] NetworkPolicy ownership is documented.

---

## 19. Anti-Patterns

### 19.1 Using Pod IP in application config

Pod IP is ephemeral. Use Service DNS.

### 19.2 Assuming namespace means isolation

Namespace without NetworkPolicy is not network isolation.

### 19.3 Applying default deny egress without DNS allow

This breaks almost everything in confusing ways.

### 19.4 Allowing all egress forever

Convenient, but bad for regulated and high-security environments.

### 19.5 Using NetworkPolicy as application authorization

NetworkPolicy can say “Pod A may connect to Pod B on TCP/8080”. It cannot say “user X may approve case Y”.

### 19.6 Exposing actuator/admin endpoints broadly

Metrics and health endpoints are useful. Admin endpoints can be dangerous.

### 19.7 No timeouts in Java clients

Kubernetes cannot save an app that waits forever.

### 19.8 Not testing network policy behavior

A policy object accepted by API server does not prove traffic is blocked or allowed as intended.

### 19.9 Ignoring DNS cache with headless services

Headless Service returns endpoint records. Client caching behavior becomes important.

### 19.10 Treating CNI as invisible

CNI choice affects performance, security, observability, and failure modes.

---

## 20. Exercises

### Exercise 1 — Trace Service Path

Given:

```text
order-api.orders -> payment-api.payments.svc.cluster.local:80
```

Draw the path through:

- DNS,
- Service,
- EndpointSlice,
- node dataplane,
- target Pod port.

Then list five possible failure points.

### Exercise 2 — Debug Empty Endpoint

Create a Service selector that does not match any Pod label.

Observe:

```bash
kubectl get svc
kubectl get endpointslice
kubectl describe svc
```

Then fix the label mismatch.

### Exercise 3 — Namespace DNS Ambiguity

Create two namespaces:

```text
orders
payments
```

Create `payment-api` only in `payments`.

From `orders`, test:

```text
payment-api
payment-api.payments
payment-api.payments.svc.cluster.local
```

Explain the difference.

### Exercise 4 — Default Deny Ingress

Apply default deny ingress in one namespace.

Then allow traffic only from one app label.

Verify from:

- allowed Pod,
- denied Pod,
- different namespace.

### Exercise 5 — DNS Egress Failure

Apply default deny egress.

Observe DNS failure.

Then add DNS allow policy.

Explain why TCP and UDP 53 may both matter.

### Exercise 6 — Java Client Rollout Error

Simulate rolling restart of backend while a Java client sends continuous requests.

Observe:

- connection reset,
- timeout,
- retry behavior,
- readiness transition.

Tune graceful shutdown and client timeout.

---

## 21. Production Case Study: “DNS Works, But Payment API Times Out”

### Symptom

`order-api` in namespace `orders` reports:

```text
java.net.SocketTimeoutException: Connect timed out
```

Target:

```text
http://payment-api.payments.svc.cluster.local
```

### Step 1 — DNS

Inside `order-api` Pod:

```bash
nslookup payment-api.payments.svc.cluster.local
```

DNS resolves to ClusterIP.

Conclusion:

```text
DNS not root cause.
```

### Step 2 — Service endpoint

```bash
kubectl get endpointslice -n payments -l kubernetes.io/service-name=payment-api -o wide
```

Endpoints exist and are ready.

Conclusion:

```text
Service discovery not root cause.
```

### Step 3 — Direct Pod test

From debug Pod in `orders`, direct call to Pod IP timeout.

Conclusion:

```text
Problem below Service abstraction or policy.
```

### Step 4 — NetworkPolicy

```bash
kubectl get networkpolicy -n payments
kubectl describe networkpolicy -n payments allow-payment-api
```

Policy allows:

```text
namespaceSelector: name=orders
podSelector: app=orders-api
port: 80
```

But payment Pod listens on 8080, while Service port is 80.

### Root cause

NetworkPolicy allowed the Service port, not the destination Pod port.

Actual packet destination at Pod level is TCP/8080.

### Fix

Allow TCP/8080 in NetworkPolicy.

### Prevention

- Use named ports consistently.
- Document Service port vs targetPort.
- Add network policy tests in staging.
- Include EndpointSlice and NetworkPolicy checks in runbook.

---

## 22. Summary

Kubernetes networking is not one abstraction. It is a stack:

```text
App client behavior
DNS
Service
EndpointSlice
kube-proxy/dataplane
CNI
NetworkPolicy
Node/cloud infrastructure
Target process
```

The most important mental models:

1. Pod IP is real but ephemeral.
2. Service gives stable abstraction but is not a process.
3. EndpointSlice tells you actual backend membership.
4. DNS success does not imply connectivity success.
5. NetworkPolicy is additive allow and depends on CNI enforcement.
6. Namespace is not network isolation.
7. Java clients must be designed for timeout, stale connection, rollout, DNS caching, and retry control.
8. Debugging must move layer by layer: name → Service → endpoint → policy → dataplane → process.

A strong Kubernetes engineer does not simply ask “is the Service up?”. They ask:

```text
- What name did the client resolve?
- Which Service object owns that name?
- Which EndpointSlices back that Service?
- Which Pods are ready?
- Which targetPort is used?
- Which NetworkPolicies isolate source or destination?
- Which node dataplane handles this path?
- Is the target process actually listening?
- What does the Java client do with connection reuse, DNS cache, timeout, and retry?
```

That is the difference between YAML-level knowledge and production-level Kubernetes networking understanding.

---

## 23. References

- Kubernetes Documentation — Services, Load Balancing, and Networking
- Kubernetes Documentation — Service
- Kubernetes Documentation — DNS for Services and Pods
- Kubernetes Documentation — Network Policies
- Kubernetes Documentation — Cluster Networking
- Kubernetes Documentation — Virtual IPs and Service Proxies
- Kubernetes Documentation — kube-proxy
- Kubernetes Documentation — Debugging DNS Resolution
- Kubernetes Documentation — Pods

---

## 24. Status Seri

```text
Seri belum selesai.
Part saat ini: 010 dari 035.
Part berikutnya: 011 — Ingress, Gateway API, and North-South Traffic.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Service Discovery and Service Abstractions</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-011.md">Part 011 — Ingress, Gateway API, and North-South Traffic ➡️</a>
</div>
