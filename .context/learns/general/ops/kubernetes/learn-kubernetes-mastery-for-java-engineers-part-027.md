# learn-kubernetes-mastery-for-java-engineers-part-027.md

# Part 027 — Service Mesh and East-West Traffic Control

## 1. Tujuan Part Ini

Part ini membahas **service mesh** sebagai lapisan kontrol untuk komunikasi **east-west traffic** di dalam platform Kubernetes.

Di seri sebelumnya kamu sudah punya fondasi HTTP, Nginx, Docker, Linux, Kafka, RabbitMQ, Redis, SQL, dan observability. Karena itu, bagian ini tidak akan mengulang:

- HTTP request/response dasar.
- TLS dasar.
- reverse proxy dasar.
- container runtime dasar.
- retry/circuit breaker sebagai pattern umum aplikasi.

Yang akan kita pelajari di sini adalah bagaimana service mesh mengubah cara service-to-service communication dikelola di Kubernetes.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan **north-south traffic** dan **east-west traffic**.
2. Memahami masalah yang diselesaikan service mesh.
3. Memahami model data plane dan control plane service mesh.
4. Menjelaskan sidecar proxy pattern dan alternatif sidecarless/ambient secara konseptual.
5. Mendesain timeout, retry, mTLS, traffic shifting, dan policy tanpa membuat sistem menjadi lebih rapuh.
6. Memahami risiko service mesh untuk Java services: connection pooling, thread pool, timeout mismatch, retry multiplication, CPU/memory overhead, dan observability ambiguity.
7. Men-debug failure mode service mesh secara sistematis.
8. Menentukan kapan service mesh masuk akal dan kapan cukup dengan application/library/platform primitive biasa.

Tujuan utamanya bukan menjadi operator Istio/Linkerd/Consul expert dalam satu part, tetapi membangun mental model yang cukup kuat agar kamu bisa mengambil keputusan arsitektural secara defensible.

---

## 2. Posisi Service Mesh dalam Kubernetes

Kubernetes menyediakan primitive dasar untuk networking:

- Pod IP.
- Service.
- EndpointSlice.
- DNS.
- Ingress.
- Gateway API.
- NetworkPolicy.

Primitive ini cukup untuk banyak aplikasi. Tetapi ketika jumlah service tumbuh, tim biasanya mulai membutuhkan kontrol yang lebih kaya atas komunikasi antar-service:

- service identity,
- mutual TLS,
- retries,
- timeouts,
- circuit breaking,
- traffic shifting,
- canary routing,
- per-route policy,
- telemetry konsisten,
- authorization service-to-service,
- fault injection,
- request tracing,
- cross-cluster service communication.

Masalahnya: kalau semua capability ini ditanam di setiap aplikasi Java secara manual, hasilnya sering tidak konsisten.

Contoh:

- service A pakai OkHttp dengan retry 3 kali,
- service B pakai WebClient tanpa retry,
- service C pakai Feign dengan timeout default terlalu panjang,
- service D punya circuit breaker Resilience4j,
- service E lupa propagasi trace header,
- service F memakai TLS tetapi tidak mTLS,
- service G punya endpoint internal tanpa authorization.

Service mesh mencoba memindahkan sebagian concern komunikasi tersebut ke lapisan infrastruktur.

Mental model sederhana:

> Service mesh adalah control plane + data plane untuk service-to-service traffic, biasanya dengan proxy yang duduk di jalur komunikasi antar-service.

Namun kalimat ini mudah disalahpahami. Service mesh bukan pengganti desain aplikasi yang baik. Ia tidak otomatis memperbaiki timeout buruk, dependency graph buruk, idempotency buruk, query lambat, atau kontrak API yang kacau.

Service mesh memberi **control surface**. Ia tidak menghapus konsekuensi distributed systems.

---

## 3. North-South vs East-West Traffic

### 3.1 North-South Traffic

North-south traffic adalah traffic dari luar cluster ke dalam cluster, atau dari dalam cluster ke luar.

Contoh:

```text
internet/client
    ↓
load balancer
    ↓
gateway/ingress
    ↓
service Kubernetes
    ↓
pod aplikasi
```

Di Kubernetes, north-south traffic sering dikelola oleh:

- LoadBalancer Service,
- Ingress Controller,
- Gateway API implementation,
- external load balancer,
- WAF,
- API gateway.

Kita sudah membahas Ingress dan Gateway API di Part 011.

### 3.2 East-West Traffic

East-west traffic adalah traffic antar-service di dalam environment.

Contoh:

```text
order-service
    ↓
payment-service
    ↓
ledger-service
```

Atau:

```text
case-management-api
    ↓
escalation-service
    ↓
notification-service
```

Traffic ini sering tidak terlihat oleh external gateway, tetapi justru menjadi mayoritas komunikasi dalam microservices platform.

Masalah east-west traffic:

- siapa boleh memanggil siapa?
- apakah service identity diverifikasi?
- bagaimana TLS antar-service dikelola?
- timeout mana yang berlaku?
- retry terjadi di client, proxy, atau keduanya?
- bagaimana tracing header dipropagasi?
- bagaimana canary dilakukan hanya untuk traffic service tertentu?
- bagaimana mengukur p95/p99 antar-service?
- bagaimana membatasi blast radius saat dependency lambat?

Service mesh terutama berfokus pada area ini.

---

## 4. Masalah yang Ingin Diselesaikan Service Mesh

Service mesh biasanya muncul saat organisasi mengalami masalah berikut.

### 4.1 Inconsistent Communication Behavior

Setiap service punya HTTP client library, timeout, retry, TLS, dan observability berbeda.

Di platform Java, variasinya bisa banyak:

- `RestTemplate`,
- `WebClient`,
- OpenFeign,
- OkHttp,
- Apache HttpClient,
- gRPC Java,
- custom SDK,
- generated client,
- internal platform library.

Tanpa standardisasi, failure behavior antar-service tidak bisa diprediksi.

### 4.2 Service Identity Lemah

Dalam Kubernetes default, Pod bisa memanggil Service lain selama network policy mengizinkan. Tetapi pertanyaan yang lebih kuat adalah:

> Apakah penerima bisa memverifikasi identitas pemanggil secara cryptographic?

Service mesh biasanya menggunakan workload identity dan mTLS untuk menjawab ini.

### 4.3 TLS dan Certificate Rotation Sulit

TLS antar-service manual membutuhkan:

- certificate issuance,
- distribution,
- trust chain,
- rotation,
- reload,
- revocation strategy,
- debugging expiry.

Jika dikerjakan per aplikasi, operational burden besar.

### 4.4 Observability Tidak Seragam

Tanpa mesh, setiap aplikasi harus konsisten mengirim:

- latency metric,
- success/error rate,
- trace span,
- request metadata,
- dependency label,
- retry signal,
- timeout signal.

Service mesh bisa memberikan telemetry standar dari proxy, walaupun tetap tidak menggantikan telemetry aplikasi.

### 4.5 Traffic Management Butuh Granularitas

Kubernetes Service melakukan load balancing dasar ke endpoint. Tetapi kasus production sering lebih halus:

- 5% traffic ke versi baru,
- hanya user internal ke canary,
- mirror traffic ke service baru,
- route berdasarkan header,
- timeout berbeda per route,
- retry hanya untuk idempotent endpoint,
- failover antar-cluster.

Service mesh dapat menyediakan traffic policy yang lebih kaya.

### 4.6 Zero Trust Internal Network

Premis lama: “kalau sudah di dalam cluster, berarti trusted”.

Premis modern: “network internal juga hostile atau minimal tidak boleh dipercaya sepenuhnya”.

Service mesh mendukung model:

- identity per workload,
- encrypted service-to-service traffic,
- authorization policy,
- deny by default,
- auditability.

---

## 5. Core Mental Model: Control Plane dan Data Plane

Service mesh hampir selalu dipahami lewat dua lapisan.

### 5.1 Data Plane

Data plane adalah komponen yang benar-benar berada di jalur request.

Biasanya berupa proxy:

```text
app container
    ↓
local proxy
    ↓
network
    ↓
remote proxy
    ↓
remote app container
```

Proxy ini menangani:

- mTLS,
- routing,
- retry,
- timeout,
- metrics,
- tracing header,
- access log,
- policy enforcement,
- load balancing,
- circuit breaking.

Contoh proxy yang sering dipakai di ekosistem mesh:

- Envoy,
- Linkerd proxy,
- Consul dataplane proxy.

### 5.2 Control Plane

Control plane adalah komponen yang mengonfigurasi data plane.

Ia bertanggung jawab untuk:

- membaca Kubernetes resources,
- membaca service mesh custom resources,
- menerbitkan konfigurasi ke proxy,
- mengelola certificate/workload identity,
- mengatur policy,
- menyediakan discovery,
- mengumpulkan telemetry metadata.

Dalam mental model Kubernetes, service mesh control plane sendiri adalah controller.

Ia melihat desired state:

```yaml
traffic policy, route, authorization policy, peer authentication, destination rule, gateway, service profile
```

Lalu membuat actual behavior di proxy mendekati desired state.

### 5.3 Critical Consequence

Kalau data plane rusak, request bisa gagal.

Kalau control plane rusak, request yang sudah berjalan mungkin masih berjalan dengan konfigurasi terakhir, tetapi perubahan policy/routing/certificate mungkin gagal propagate.

Ini mirip pola Kubernetes umum:

- control plane membuat keputusan dan konfigurasi,
- data plane menjalankan traffic nyata,
- failure mode keduanya berbeda.

---

## 6. Sidecar Proxy Pattern

Model service mesh klasik memakai sidecar proxy.

Satu Pod memiliki minimal dua container:

```text
Pod: order-service

+-------------------------------+
| app container                 |
|   Java Spring Boot            |
|                               |
| sidecar proxy                 |
|   Envoy/Linkerd proxy/etc.    |
+-------------------------------+
```

Traffic keluar dari aplikasi diarahkan ke proxy lokal. Traffic masuk ke aplikasi juga melewati proxy lokal.

### 6.1 Kenapa Sidecar?

Karena Pod adalah unit shared network namespace.

Container dalam Pod berbagi:

- IP address,
- network namespace,
- loopback,
- port space,
- volume tertentu.

Jadi proxy bisa duduk di Pod yang sama dan mengintersep traffic aplikasi.

### 6.2 Apa yang Diintersep?

Biasanya:

- outbound traffic dari app ke service lain,
- inbound traffic dari service lain ke app.

Intersepsi bisa dilakukan dengan mekanisme seperti iptables/eBPF tergantung implementasi mesh.

Kamu tidak perlu menghafal detail low-level tiap mesh di part ini. Yang penting adalah memahami konsekuensinya:

> Aplikasi merasa memanggil service biasa, tetapi traffic sebenarnya melewati proxy lokal.

### 6.3 Keuntungan Sidecar

- Policy dekat dengan workload.
- Per-Pod isolation cukup kuat.
- Upgrade proxy bisa dikontrol per workload.
- Telemetry per workload detail.
- Tidak butuh perubahan besar di aplikasi.

### 6.4 Kerugian Sidecar

- Setiap Pod mendapat container tambahan.
- CPU/memory overhead meningkat.
- Startup lebih kompleks.
- Shutdown lebih kompleks.
- Debugging lebih kompleks.
- Versi proxy tersebar di banyak Pod.
- Large clusters bisa memiliki ribuan proxy.

Untuk Java workload yang sudah memakan memory besar, sidecar overhead tidak boleh dianggap gratis.

---

## 7. Sidecarless dan Ambient Model Secara Konseptual

Beberapa mesh modern mengeksplorasi model sidecarless atau ambient.

Motivasi utamanya:

- mengurangi per-Pod overhead,
- menyederhanakan onboarding,
- memisahkan L4 security dari L7 routing,
- mengurangi kebutuhan restart workload saat inject sidecar,
- mengurangi jumlah proxy.

Secara konseptual, traffic dapat melewati node-level proxy atau waypoint proxy alih-alih sidecar per Pod.

Penting: model ini tidak berarti “tidak ada data plane”. Tetap ada komponen yang berada di jalur traffic. Yang berubah adalah lokasi dan granularitasnya.

Pertanyaan desain yang harus diajukan:

- Di mana policy enforcement terjadi?
- Seberapa granular identitas workload?
- Bagaimana mTLS dilakukan?
- Bagaimana L7 routing dilakukan?
- Apa blast radius jika proxy node-level gagal?
- Bagaimana observability per workload dijaga?
- Bagaimana upgrade data plane dilakukan?

Sidecarless bukan magic. Ia hanya memindahkan trade-off.

---

## 8. Service Identity dan mTLS

### 8.1 Masalah Identity

Dalam sistem distributed, IP address bukan identity yang stabil.

Pod IP ephemeral.

Service name juga bukan bukti cryptographic.

DNS bisa menjawab nama service, tetapi penerima masih perlu tahu:

> Apakah caller ini benar-benar workload yang diizinkan?

Service mesh biasanya memberi identity berbasis workload, sering dikaitkan dengan Kubernetes ServiceAccount.

Contoh mental model:

```text
namespace: payments
serviceAccount: payment-api
identity: payment-api.payments.cluster.local / SPIFFE-like identity
```

### 8.2 mTLS

Mutual TLS berarti kedua sisi saling memverifikasi certificate:

- client memverifikasi server,
- server memverifikasi client.

Dalam service mesh:

```text
order-service proxy  ← mTLS →  payment-service proxy
```

Aplikasi Java mungkin hanya berbicara plain HTTP ke local proxy, lalu proxy mengubah komunikasi antar-workload menjadi mTLS.

### 8.3 Keuntungan mTLS Mesh

- encryption in transit antar-service,
- workload identity,
- certificate issuance otomatis,
- certificate rotation otomatis,
- policy berbasis identity,
- auditability lebih baik.

### 8.4 Risiko mTLS Mesh

- debugging TLS issue pindah ke proxy layer,
- certificate expiry tetap bisa outage kalau control plane bermasalah,
- legacy client/server bisa tidak kompatibel,
- traffic non-mesh ke mesh service perlu dipikirkan,
- Java app yang juga melakukan TLS sendiri bisa memiliki double TLS atau trust ambiguity.

### 8.5 Pertanyaan Praktis

Untuk setiap service:

- Apakah inbound harus menerima hanya mTLS?
- Apakah ada caller non-mesh?
- Apakah ada job/batch lama yang belum inject sidecar?
- Apakah health check dari kubelet melewati proxy atau langsung ke app?
- Apakah external monitoring masuk lewat gateway atau langsung ke Pod?

Jika pertanyaan ini tidak dijawab, mTLS rollout bisa memutus traffic yang sebelumnya berjalan.

---

## 9. Authorization Policy

mTLS membuktikan siapa caller. Authorization menentukan apakah caller boleh melakukan aksi.

Contoh policy konseptual:

```text
payment-api hanya boleh dipanggil oleh:
- checkout-api
- refund-worker
- internal-admin-api
```

Atau lebih granular:

```text
checkout-api boleh POST /payments
refund-worker boleh POST /refunds
reporting-service hanya boleh GET /payments/summary
```

Service mesh sering menyediakan authorization policy di L4 atau L7.

### 9.1 L4 Authorization

Berbasis:

- source identity,
- destination service,
- port,
- namespace.

Contoh:

```text
ServiceAccount A boleh connect ke Service B port 8080.
```

### 9.2 L7 Authorization

Berbasis:

- HTTP method,
- path,
- header,
- JWT claim,
- host,
- route.

Contoh:

```text
ServiceAccount checkout-api boleh POST /v1/payments tetapi tidak boleh GET /v1/admin/reconciliation.
```

### 9.3 Trade-off

L7 authorization lebih powerful tetapi lebih kompleks.

Risikonya:

- path matching salah,
- route rewrite membuat policy tidak cocok,
- gRPC method matching berbeda,
- non-HTTP protocol tidak bisa dipahami L7 proxy,
- policy terlalu granular menjadi sulit di-maintain.

Untuk banyak organisasi, langkah matang pertama adalah:

1. mTLS untuk identity.
2. L4 allowlist antar-service.
3. L7 policy hanya untuk boundary sensitif.

---

## 10. Traffic Policy: Timeout, Retry, Circuit Breaking

Service mesh sering dipakai untuk mengatur resilience policy. Ini area paling berbahaya kalau tidak disiplin.

### 10.1 Timeout

Timeout adalah batas waktu menunggu response.

Tanpa timeout, thread/request bisa menggantung terlalu lama.

Dengan timeout terlalu pendek, request valid bisa gagal.

Dengan timeout terlalu panjang, failure propagation lambat.

Dalam Java service, timeout bisa muncul di banyak layer:

```text
incoming gateway timeout
    ↓
mesh route timeout
    ↓
Java servlet/reactive request timeout
    ↓
HTTP client timeout
    ↓
mesh outbound timeout
    ↓
downstream service timeout
    ↓
database/message broker timeout
```

Jika setiap layer punya timeout yang tidak diselaraskan, hasilnya sulit diprediksi.

Prinsip:

> Timeout harus mengikuti budget end-to-end, bukan disetel lokal tanpa konteks.

Contoh budget:

```text
External API SLO p95: 300 ms
Gateway timeout: 1000 ms
order-service internal budget: 800 ms
payment-service call budget: 250 ms
inventory-service call budget: 150 ms
fraud-service call budget: 200 ms
fallback/response assembly: 100 ms
```

### 10.2 Retry

Retry bisa membantu transient failure.

Tetapi retry juga bisa memperbesar traffic saat dependency sedang sakit.

Jika service A retry 3 kali ke B, dan B retry 3 kali ke C, maka satu request user bisa menjadi banyak request internal.

Contoh retry multiplication:

```text
client → A retry 3x
A → B retry 3x
B → C retry 3x

Worst-case attempt ke C ≈ 3 × 3 × 3 = 27
```

Ini bisa berubah menjadi retry storm.

### 10.3 Retry di Mesh vs Retry di Aplikasi

Pertanyaan penting:

> Siapa yang berhak melakukan retry: client library Java, service mesh proxy, gateway, message consumer, atau semuanya?

Jawaban mature biasanya:

- retry harus sedikit,
- hanya untuk operasi idempotent,
- punya timeout total,
- punya backoff/jitter,
- observability retry harus jelas,
- tidak dilakukan di semua layer sekaligus.

### 10.4 Circuit Breaking

Circuit breaker mencegah caller terus menghantam dependency yang sedang gagal.

Dalam mesh, circuit breaking bisa berbasis:

- connection limit,
- pending request limit,
- outlier detection,
- error rate,
- ejection host.

Dalam aplikasi Java, circuit breaker bisa berbasis:

- method call,
- exception classification,
- fallback logic,
- business semantics.

Mesh circuit breaker tidak memahami seluruh business semantics. Ia bagus untuk transport-level protection, bukan business fallback yang kompleks.

### 10.5 Golden Rule

> Mesh resilience policy harus melengkapi application resilience, bukan bertarung dengannya.

Jika app punya Resilience4j dan mesh juga punya retry/circuit breaker, keduanya harus didesain bersama.

---

## 11. Traffic Shifting, Canary, Mirroring, dan Fault Injection

### 11.1 Traffic Shifting

Service mesh bisa mengarahkan sebagian traffic ke versi tertentu.

Contoh konseptual:

```text
90% → payment-service v1
10% → payment-service v2
```

Ini berguna untuk canary.

Namun traffic shifting sehat hanya jika:

- metrics per version tersedia,
- error budget jelas,
- rollback cepat,
- DB/schema compatibility dijaga,
- sticky session tidak mengacaukan distribusi,
- traffic sample cukup representatif.

### 11.2 Header-Based Routing

Contoh:

```text
Header: x-user-segment: internal
Route: payment-service v2
```

Berguna untuk internal testing atau beta users.

Risiko:

- header bisa spoofed jika tidak dibatasi,
- gateway dan mesh policy tidak konsisten,
- app logging tidak jelas,
- cache behavior berubah.

### 11.3 Traffic Mirroring

Traffic mirror mengirim salinan request ke service lain tanpa memengaruhi response utama.

Contoh:

```text
production traffic → payment-service v1
                 ↘ mirror → payment-service-v2-shadow
```

Risiko besar:

- mirrored request tidak boleh punya side effect,
- downstream call harus dimatikan atau disandbox,
- idempotency wajib,
- cost naik,
- PII/data compliance harus diperhatikan.

### 11.4 Fault Injection

Fault injection memasukkan delay/error untuk menguji resilience.

Contoh:

- tambah latency 500 ms,
- return 503 untuk 5% request,
- drop connection.

Ini berguna untuk chaos testing, tetapi harus sangat terkontrol.

Jangan melakukan fault injection di production tanpa blast radius, observability, dan rollback yang jelas.

---

## 12. Observability dalam Service Mesh

Service mesh dapat menghasilkan telemetry dari proxy:

- request count,
- latency,
- error rate,
- source identity,
- destination identity,
- route,
- response code,
- mTLS status,
- retry count,
- connection metrics.

Ini sangat berguna karena konsisten antar-service.

Namun ada batas penting.

### 12.1 Proxy Telemetry Bukan App Telemetry

Proxy tahu:

```text
HTTP 500 dari payment-service ke order-service
latency 240 ms
source=order-service
destination=payment-service
```

Proxy tidak selalu tahu:

```text
kenapa payment gagal?
apakah karena insufficient balance?
apakah karena fraud rule?
apakah karena DB lock?
apakah karena downstream bank timeout?
```

Jadi kamu tetap butuh:

- application metrics,
- business metrics,
- structured logs,
- traces dari aplikasi,
- correlation ID,
- domain-level error classification.

### 12.2 Double Counting

Saat proxy dan aplikasi sama-sama emit metric, kamu harus jelas:

- metric mana dari app,
- metric mana dari proxy,
- apakah latency dihitung dari sisi client proxy atau server proxy,
- apakah retry attempt dihitung sebagai request terpisah,
- apakah 5xx berasal dari app atau proxy.

### 12.3 Distributed Tracing

Mesh dapat membantu propagasi trace context, tetapi aplikasi tetap harus membuat span bermakna.

Proxy span memberi jalur network.

App span memberi jalur business logic.

Trace bagus harus menggabungkan keduanya.

---

## 13. Service Mesh vs API Gateway vs Ingress vs Gateway API

Ini sering membingungkan.

### 13.1 API Gateway

Biasanya untuk north-south traffic:

- auth user/client eksternal,
- rate limiting eksternal,
- API key,
- request transformation,
- external routing,
- developer portal,
- public API management.

### 13.2 Ingress

Kubernetes resource lama untuk exposing HTTP/S service dari luar cluster.

Fungsinya relatif sederhana.

### 13.3 Gateway API

Kubernetes-native API modern untuk traffic routing, role separation, dan extensible routing.

Bisa dipakai untuk north-south dan dalam beberapa implementasi bisa overlap dengan mesh routing.

### 13.4 Service Mesh

Biasanya untuk east-west traffic:

- workload identity,
- mTLS,
- service-to-service authorization,
- internal traffic policy,
- internal telemetry,
- canary antar-service,
- cross-service resilience.

### 13.5 Boundary Practical

Mapping sederhana:

```text
External client → API Gateway / Gateway / Ingress
Service A → Service B → Service Mesh
Service B → database → usually not mesh L7 HTTP; may use network/security controls
Service → Kafka/RabbitMQ → mesh may encrypt TCP, but protocol semantics remain app/client responsibility
```

Jangan memasukkan semua traffic ke semua layer tanpa alasan. Layer bertumpuk bisa membuat timeout, retry, auth, dan logs menjadi sulit dipahami.

---

## 14. Service Mesh vs Application Library

Sebagai Java engineer, pertanyaan kuncinya:

> Mana yang sebaiknya di-handle aplikasi, mana yang sebaiknya di-handle mesh?

### 14.1 Cocok untuk Mesh

Biasanya cocok:

- mTLS antar-service,
- workload identity,
- basic service-to-service authorization,
- consistent transport metrics,
- L4/L7 routing policy,
- canary traffic split,
- low-level connection policy,
- zero-trust enforcement,
- standardized access logging.

### 14.2 Cocok untuk Aplikasi

Biasanya tetap harus di aplikasi:

- business fallback,
- idempotency,
- domain-specific error handling,
- user-visible error mapping,
- transaction boundary,
- saga/compensation,
- validation,
- concurrency control,
- database transaction,
- message acknowledgement semantics,
- business metrics.

### 14.3 Shared Responsibility

Area yang harus disepakati bersama:

- timeout,
- retry,
- circuit breaker,
- tracing,
- rate limiting,
- authentication context propagation,
- authorization model.

Jika tidak disepakati, layer-layer ini akan saling mengganggu.

---

## 15. Java-Specific Considerations

### 15.1 Connection Pooling

Java HTTP clients sering memakai connection pool.

Masalah muncul saat:

- downstream Pod diganti saat rollout,
- Service endpoint berubah,
- proxy melakukan load balancing sendiri,
- DNS cache terlalu lama,
- idle connection tidak dibersihkan,
- mTLS connection reuse terjadi di proxy.

Dalam mesh, aplikasi biasanya connect ke local proxy. Proxy yang mengelola koneksi ke downstream.

Konsekuensi:

- app pool ke local proxy bisa stabil,
- proxy pool ke downstream harus diobservasi,
- stale downstream connection bisa terlihat sebagai 503/connection reset,
- tuning pool di app saja tidak cukup.

### 15.2 Timeout Alignment

Java client punya banyak timeout:

- connection timeout,
- read timeout,
- write timeout,
- response timeout,
- pool acquisition timeout,
- request timeout,
- circuit breaker timeout.

Mesh juga punya route timeout/retry timeout.

Prinsip:

```text
client total timeout <= caller request budget
mesh route timeout <= client total timeout or intentionally coordinated
server processing timeout <= upstream expectation
```

Jangan sampai proxy timeout setelah aplikasi sudah menyerah, atau aplikasi menunggu lebih lama dari proxy sehingga error terlihat aneh.

### 15.3 Thread Pool dan Blocking Calls

Jika Java service memakai blocking servlet model, dependency lambat bisa menghabiskan request threads.

Mesh retry tidak menyelamatkan thread starvation. Bahkan bisa memperburuk.

Kalau dependency lambat:

- thread app menunggu,
- proxy mungkin retry,
- downstream makin terbebani,
- latency makin tinggi,
- HPA mungkin scale berdasarkan CPU tetapi CPU rendah karena thread blocked,
- sistem gagal tanpa scale-up efektif.

### 15.4 Reactive Stack

Reactive stack seperti WebFlux tidak otomatis bebas dari masalah.

Masalah bisa pindah ke:

- event loop blocking,
- connection pool exhaustion,
- backpressure tidak sampai ke downstream,
- timeout mismatch,
- retry storm.

### 15.5 Spring Boot Actuator dan Mesh

Health endpoint harus dipikirkan:

- apakah kubelet probe langsung ke app?
- apakah probe melewati sidecar?
- apakah readiness app mempertimbangkan dependency mesh?
- apakah sidecar sudah siap sebelum app menerima traffic?
- apakah app shutdown lebih dulu atau proxy lebih dulu?

Readiness yang benar harus merepresentasikan kesiapan menerima traffic dari jalur nyata.

### 15.6 Graceful Shutdown

Dengan sidecar, termination menjadi multi-container problem.

Urutan buruk:

```text
proxy berhenti lebih dulu
app masih mencoba flush request / emit telemetry / call downstream
traffic gagal
```

Atau:

```text
app berhenti lebih dulu
proxy masih menerima inbound
request masuk ke app yang sudah mati
```

Production mesh biasanya punya pola khusus untuk sidecar startup/shutdown. Jangan menganggap lifecycle Pod single-container masih cukup.

---

## 16. Mesh for Non-HTTP Protocols

Service mesh paling kuat saat traffic berbasis HTTP/gRPC karena proxy bisa memahami L7 semantics.

Untuk TCP protocol seperti:

- PostgreSQL,
- MySQL,
- Redis,
- Kafka,
- RabbitMQ,
- custom binary protocol,

mesh mungkin masih bisa memberi:

- mTLS,
- L4 identity,
- connection telemetry,
- basic policy.

Tetapi mesh tidak otomatis memahami:

- SQL transaction,
- Redis command semantics,
- Kafka partition assignment,
- RabbitMQ ack/nack,
- DB failover semantics,
- consumer group rebalance.

Jangan berharap mesh memperbaiki protocol-level behavior yang bukan HTTP/gRPC.

Untuk Kafka/RabbitMQ consumers, retry dan backpressure biasanya tetap harus dikendalikan oleh client/application layer.

---

## 17. Rollout Strategy untuk Service Mesh

Service mesh sebaiknya tidak diaktifkan sekaligus ke semua namespace production tanpa tahapan.

### 17.1 Tahap 1 — Observe Only

Aktifkan telemetry minimal pada workload non-critical.

Tujuan:

- lihat overhead,
- pahami metric,
- pahami log,
- validasi compatibility,
- ukur latency tambahan.

### 17.2 Tahap 2 — mTLS Permissive

Gunakan mode yang menerima traffic mesh dan non-mesh.

Tujuan:

- migrasi bertahap,
- identifikasi caller legacy,
- hindari pemutusan traffic mendadak.

### 17.3 Tahap 3 — Strict mTLS per Boundary

Aktifkan strict mTLS pada namespace/service tertentu.

Mulai dari service internal yang caller-nya jelas.

### 17.4 Tahap 4 — Authorization Policy

Terapkan allowlist antar-service.

Mulai dari:

- service sensitif,
- namespace production,
- admin/internal API,
- write endpoint.

### 17.5 Tahap 5 — Traffic Management

Baru setelah visibility dan identity matang, pakai:

- canary,
- traffic split,
- fault injection,
- advanced retries.

### 17.6 Tahap 6 — Platform Standardization

Masukkan ke golden path:

- manifest template,
- annotation/label standard,
- policy baseline,
- dashboard,
- runbook,
- onboarding guide.

---

## 18. Failure Mode Catalogue

### 18.1 Retry Storm

Gejala:

- downstream error meningkat,
- request count internal jauh lebih tinggi dari external traffic,
- latency naik,
- CPU proxy/app naik,
- dependency makin overload.

Akar umum:

- retry di gateway + mesh + app,
- retry untuk non-idempotent endpoint,
- timeout terlalu panjang,
- tidak ada backoff/jitter,
- circuit breaker tidak efektif.

Mitigasi:

- tentukan satu layer utama untuk retry,
- batasi retry count,
- gunakan retry budget,
- hanya retry idempotent operation,
- observasi retry attempt metric,
- turunkan timeout,
- pakai circuit breaker/load shedding.

### 18.2 Timeout Mismatch

Gejala:

- app log menunjukkan client cancelled,
- proxy log menunjukkan upstream timeout,
- caller melihat 503/504,
- downstream tetap memproses request setelah caller menyerah.

Akar umum:

- timeout proxy lebih pendek dari app,
- timeout app lebih panjang dari gateway,
- DB timeout lebih panjang dari HTTP timeout,
- no end-to-end budget.

Mitigasi:

- buat latency budget,
- dokumentasikan timeout tiap layer,
- sejajarkan client/proxy/server timeout,
- pastikan cancellation dipropagasi.

### 18.3 mTLS Breaks Legacy Caller

Gejala:

- service tertentu tiba-tiba tidak bisa connect,
- error TLS handshake,
- 503 dari proxy,
- caller non-mesh gagal.

Akar umum:

- strict mTLS terlalu cepat,
- job lama belum inject sidecar,
- external monitor memanggil Pod/Service langsung,
- namespace belum onboard mesh.

Mitigasi:

- rollout permissive dulu,
- inventory caller,
- allow exception sementara,
- migrasi caller,
- observasi plaintext traffic sebelum enforce.

### 18.4 Authorization Policy Too Strict

Gejala:

- 403 dari proxy,
- app tidak menerima request,
- hanya route/method tertentu gagal,
- traffic antar-namespace gagal.

Akar umum:

- source identity salah,
- namespace selector salah,
- path matching salah,
- method tidak dicakup,
- service account berbeda antara env.

Mitigasi:

- mulai audit/warn mode jika tersedia,
- gunakan policy kecil dan eksplisit,
- test dengan traffic nyata,
- version-control policy,
- dashboard denied traffic.

### 18.5 Proxy Resource Starvation

Gejala:

- app terlihat sehat tetapi request gagal,
- proxy OOMKilled,
- proxy CPU throttled,
- latency naik tanpa perubahan app.

Akar umum:

- proxy resource request/limit terlalu kecil,
- traffic volume naik,
- telemetry/log terlalu berat,
- high cardinality metrics,
- TLS overhead tidak diperhitungkan.

Mitigasi:

- set resource request/limit proxy,
- monitor proxy CPU/memory,
- sampling log/trace,
- batasi metric cardinality,
- capacity planning mesh.

### 18.6 Sidecar Startup Race

Gejala:

- app mulai memanggil dependency saat proxy belum siap,
- startup gagal,
- readiness flapping,
- first requests gagal setelah Pod Running.

Akar umum:

- app startup tidak menunggu network path siap,
- sidecar readiness tidak dipertimbangkan,
- init order buruk.

Mitigasi:

- gunakan readiness yang benar,
- pahami startup ordering mesh,
- jangan melakukan dependency call kritis terlalu awal,
- pakai startupProbe untuk app warmup.

### 18.7 Telemetry Ambiguity

Gejala:

- app metric dan proxy metric berbeda,
- error rate tidak cocok,
- latency p95 berbeda jauh,
- trace tidak lengkap.

Akar umum:

- proxy menghitung retry attempt,
- app menghitung final request,
- missing trace propagation,
- sampling berbeda,
- status code diubah proxy.

Mitigasi:

- definisikan source of truth metric,
- dashboard pisahkan app/proxy,
- propagasi trace context,
- log response flag/proxy error,
- dokumentasikan semantic metric.

---

## 19. Debugging Method untuk Service Mesh

Saat service mesh terlibat, jangan langsung menyalahkan aplikasi atau mesh. Gunakan alur berlapis.

### 19.1 Tentukan Jalur Traffic

Tanyakan:

```text
caller app → caller proxy → network → callee proxy → callee app
```

Mana yang gagal?

### 19.2 Cek Apakah Request Sampai ke App

Jika app log tidak mencatat request, kemungkinan gagal sebelum app:

- caller proxy,
- network,
- callee proxy,
- authorization policy,
- mTLS,
- routing.

Jika app menerima request tetapi gagal, kemungkinan:

- business logic,
- downstream dependency,
- app timeout,
- exception,
- thread pool,
- DB/broker/cache.

### 19.3 Cek Proxy Logs dan Metrics

Cari:

- response code,
- upstream reset,
- downstream disconnect,
- TLS handshake error,
- policy denied,
- route not found,
- no healthy upstream,
- timeout,
- retry count.

### 19.4 Cek Identity dan Policy

Validasi:

- ServiceAccount caller,
- namespace caller,
- destination service,
- policy selector,
- mTLS mode,
- authorization rule.

### 19.5 Cek Kubernetes Object

Lihat:

- Pod readiness,
- Service endpoints,
- EndpointSlice,
- NetworkPolicy,
- sidecar container status,
- resource throttling/OOM,
- events.

### 19.6 Cek Timeout Budget

Buat timeline:

```text
T0 caller receives request
T+20ms caller calls downstream
T+250ms proxy timeout
T+300ms Java client timeout
T+1000ms gateway timeout
```

Jika timeline tidak masuk akal, timeout mismatch mungkin akar masalah.

### 19.7 Isolate by Bypass Carefully

Kadang debugging butuh bypass proxy atau memanggil service langsung. Ini harus hati-hati karena bisa melanggar security policy.

Gunakan hanya di environment aman atau dengan approval production incident.

---

## 20. Design Checklist Sebelum Mengadopsi Service Mesh

Sebelum memasukkan mesh ke platform, jawab pertanyaan berikut.

### 20.1 Problem Clarity

- Masalah spesifik apa yang ingin diselesaikan?
- Apakah masalahnya identity, TLS, observability, traffic routing, atau governance?
- Apakah masalah bisa diselesaikan lebih sederhana dengan Gateway API, NetworkPolicy, atau library standard?

### 20.2 Ownership

- Siapa mengoperasikan mesh control plane?
- Siapa menulis traffic policy?
- Siapa menulis authorization policy?
- Siapa on-call saat proxy menyebabkan outage?
- Siapa melakukan upgrade mesh?

### 20.3 Developer Experience

- Apakah developer perlu tahu annotation tertentu?
- Apakah manifest berubah?
- Bagaimana debugging dilakukan?
- Apakah dashboard tersedia?
- Apakah runbook tersedia?

### 20.4 Reliability

- Apa failure mode control plane?
- Apa failure mode data plane?
- Bagaimana rollback mesh config?
- Bagaimana policy diuji sebelum enforce?
- Bagaimana certificate expiry dimonitor?

### 20.5 Security

- Apakah mTLS strict atau permissive?
- Apakah identity berbasis ServiceAccount?
- Apakah default deny diterapkan?
- Bagaimana exception policy dikelola?
- Apakah audit log tersedia?

### 20.6 Cost

- Berapa CPU/memory overhead sidecar/proxy?
- Berapa telemetry cost?
- Berapa latency overhead?
- Apakah cluster autoscaler memperhitungkan proxy resource?
- Apakah resource request proxy disetel?

---

## 21. Minimal Reference Architecture untuk Java Services dengan Mesh

Contoh target architecture:

```text
External client
    ↓
Gateway API / API Gateway
    ↓
order-api Pod
  [Java app + proxy]
    ↓ mTLS
payment-api Pod
  [Java app + proxy]
    ↓ mTLS
ledger-api Pod
  [Java app + proxy]
```

Policy baseline:

```text
1. mTLS enabled untuk namespace production.
2. Authorization default deny untuk service sensitif.
3. order-api hanya boleh call payment-api.
4. payment-api hanya boleh call ledger-api dan fraud-api.
5. Retry hanya di satu layer untuk idempotent endpoint.
6. Timeout route diselaraskan dengan Java client timeout.
7. Proxy metrics masuk ke dashboard platform.
8. App metrics tetap wajib.
9. Trace context dipropagasi end-to-end.
10. Mesh policy disimpan di GitOps repo.
```

Java app baseline:

```text
- Actuator readiness/liveness dipisah.
- HTTP client timeout eksplisit.
- Connection pool eksplisit.
- Retry app hanya untuk operation yang benar-benar aman.
- Correlation ID wajib.
- OpenTelemetry instrumentation aktif.
- Graceful shutdown diuji dengan sidecar.
```

---

## 22. Anti-Pattern

### 22.1 “Kita Pakai Mesh Agar Tidak Perlu Memikirkan Timeout”

Ini salah.

Mesh menambah tempat timeout dikonfigurasi. Ia tidak menghapus kebutuhan desain timeout.

### 22.2 “Retry Lebih Banyak Berarti Lebih Reliable”

Salah.

Retry tanpa budget adalah amplification mechanism.

### 22.3 “mTLS Berarti Sistem Sudah Secure”

mTLS hanya satu bagian.

Kamu tetap perlu:

- authorization,
- RBAC,
- secret hygiene,
- image security,
- network policy,
- application authz,
- audit.

### 22.4 “Semua Policy Harus L7”

L7 policy terlalu granular bisa menjadi fragile.

Gunakan L7 untuk boundary yang memang butuh, bukan semua endpoint.

### 22.5 “Proxy Metrics Cukup untuk Observability”

Proxy tidak tahu business semantics.

App telemetry tetap wajib.

### 22.6 “Mesh Dinyalakan Sekaligus untuk Semua Production”

Ini undangan outage.

Rollout bertahap lebih aman.

### 22.7 “Service Mesh Menggantikan Platform Design”

Mesh adalah komponen platform, bukan platform itu sendiri.

Tanpa ownership, runbook, GitOps, policy lifecycle, dan observability, mesh hanya menambah kompleksitas.

---

## 23. Latihan Praktis

### Latihan 1 — Traffic Path Mapping

Ambil satu service Java yang memanggil service lain.

Gambar jalur:

```text
caller app
caller proxy
Service/EndpointSlice
callee proxy
callee app
```

Untuk setiap hop, tulis:

- timeout,
- retry,
- identity,
- telemetry,
- failure signal.

### Latihan 2 — Retry Budget Audit

Pilih satu endpoint penting.

Cari retry di:

- gateway,
- service mesh,
- Java HTTP client,
- Resilience4j/Spring Retry,
- downstream service,
- message queue consumer.

Hitung worst-case amplification.

### Latihan 3 — mTLS Migration Plan

Buat rencana migrasi namespace dari plaintext ke strict mTLS:

1. inventory caller,
2. permissive mode,
3. telemetry validation,
4. exception list,
5. strict mode,
6. authorization policy,
7. rollback plan.

### Latihan 4 — Authorization Policy Design

Untuk domain case management:

```text
case-api
escalation-service
audit-service
notification-service
reporting-service
```

Tentukan:

- siapa boleh memanggil siapa,
- endpoint mana yang write-sensitive,
- apakah perlu L4 atau L7 policy,
- bagaimana policy diuji.

### Latihan 5 — Sidecar Resource Sizing

Ambil traffic estimate service:

```text
RPS: 500
p95 payload: 30 KB
mTLS enabled: yes
access log: sampled
trace: sampled 10%
```

Tentukan proxy resource request awal:

- CPU,
- memory,
- metric yang dipantau,
- threshold untuk adjustment.

---

## 24. Production Checklist

Sebelum service Java dianggap production-ready dalam mesh:

```text
[ ] Workload identity jelas berbasis ServiceAccount.
[ ] mTLS mode diketahui dan diuji.
[ ] Caller inventory tersedia.
[ ] Authorization policy minimal tersedia untuk service sensitif.
[ ] Timeout app dan mesh diselaraskan.
[ ] Retry tidak terjadi di terlalu banyak layer.
[ ] Retry hanya untuk operasi idempotent.
[ ] Circuit breaker/load shedding jelas layer-nya.
[ ] Proxy resource request/limit disetel.
[ ] Proxy metrics ada di dashboard.
[ ] App metrics tetap ada.
[ ] Distributed tracing diuji end-to-end.
[ ] Health probe tidak terganggu sidecar.
[ ] Graceful shutdown diuji dengan sidecar.
[ ] Canary/traffic split memiliki metric per version.
[ ] Policy disimpan di GitOps repo.
[ ] Rollback policy jelas.
[ ] Certificate expiry/rotation dimonitor.
[ ] Runbook mesh incident tersedia.
[ ] On-call tahu cara membaca proxy error.
```

---

## 25. Decision Framework: Kapan Service Mesh Masuk Akal?

Service mesh masuk akal jika sebagian besar kondisi ini benar:

```text
- Jumlah service cukup banyak.
- Service-to-service traffic kompleks.
- Ada kebutuhan kuat untuk mTLS internal.
- Ada kebutuhan service identity dan authorization.
- Ada kebutuhan traffic shifting internal.
- Ada kebutuhan telemetry konsisten antar-service.
- Platform team siap mengoperasikan mesh.
- Developer experience dan runbook disiapkan.
- Overhead resource/latency bisa diterima.
```

Service mesh mungkin belum perlu jika:

```text
- Service masih sedikit.
- Traffic internal sederhana.
- Problem utama ada di app design, bukan network policy.
- Tidak ada tim yang siap mengoperasikan mesh.
- Observability dasar belum matang.
- Timeout/retry aplikasi belum disiplin.
- Kubernetes policy/RBAC/NetworkPolicy saja belum rapi.
```

Prinsipnya:

> Jangan memakai service mesh untuk terlihat cloud-native. Pakai jika problem komunikasi internal sudah cukup nyata dan organisasi siap mengoperasikan tambahan control plane.

---

## 26. Ringkasan

Service mesh adalah lapisan kontrol untuk east-west traffic di Kubernetes.

Ia biasanya terdiri dari:

- data plane proxy,
- control plane,
- policy resources,
- certificate/identity system,
- telemetry integration.

Kemampuan utamanya:

- mTLS,
- workload identity,
- authorization,
- traffic shifting,
- timeout/retry/circuit breaking,
- telemetry,
- fault injection,
- internal routing.

Namun service mesh juga membawa biaya:

- resource overhead,
- latency overhead,
- operational complexity,
- debugging complexity,
- policy complexity,
- new failure modes.

Untuk Java services, perhatian utama adalah:

- connection pool,
- timeout alignment,
- retry multiplication,
- thread starvation,
- graceful shutdown,
- app telemetry vs proxy telemetry,
- health probe interaction,
- sidecar resource sizing.

Kesimpulan penting:

> Service mesh bukan pengganti arsitektur aplikasi yang benar. Ia adalah alat platform untuk membuat komunikasi antar-service lebih terkontrol, teramati, dan aman — selama timeout, retry, identity, policy, dan ownership didesain dengan disiplin.

---

## 27. Apa yang Akan Dibahas di Part Berikutnya

Part berikutnya adalah:

```text
Part 028 — Batch, Scheduling, Workers, and Event-Driven Workloads
```

Kita akan membahas cara menjalankan workload non-request/response di Kubernetes:

- Job,
- CronJob,
- worker deployment,
- queue consumer,
- Kafka consumer,
- RabbitMQ worker,
- idempotency,
- graceful shutdown,
- backlog-based scaling,
- partition/rebalance impact,
- duplicate execution,
- scheduler singleton,
- event-driven autoscaling.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-kubernetes-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Operators, CRDs, and Extending Kubernetes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-kubernetes-mastery-for-java-engineers-part-028.md">Part 028 — Batch, Scheduling, Workers, and Event-Driven Workloads ➡️</a>
</div>
