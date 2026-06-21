# Part 31 — Spring Cloud and Distributed System Integration

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `31-spring-cloud-distributed-system-integration.md`  
> Level: Advanced / Enterprise / Platform Engineering  
> Target: Java 8 sampai Java 25, dengan perhatian khusus pada Spring Boot 2.x, 3.x, dan 4.x ecosystem

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan tidak hanya bisa menambahkan dependency `spring-cloud-*`, tetapi mampu menjawab pertanyaan arsitektural seperti:

1. Apakah service discovery masih dibutuhkan jika sistem sudah berjalan di Kubernetes?
2. Apakah config server lebih baik daripada config map, secret manager, atau GitOps?
3. Apakah API gateway harus ada di aplikasi Spring, di ingress, di service mesh, atau di dedicated gateway platform?
4. Apakah retry boleh dipasang di semua outbound call?
5. Apakah circuit breaker menyelesaikan outage downstream, atau hanya membatasi kerusakan?
6. Apakah distributed tracing cukup untuk observability, atau perlu business correlation ID?
7. Apakah Spring Cloud membuat microservices menjadi lebih sederhana, atau hanya memindahkan kompleksitas ke runtime?
8. Kapan Spring Cloud tepat, kapan terlalu berat, dan kapan lebih baik memakai primitive platform seperti Kubernetes, AWS, service mesh, atau gateway managed service?

Spring Cloud harus dipahami sebagai **toolkit untuk pola sistem terdistribusi**, bukan sebagai syarat wajib ketika membangun microservices.

---

## 1. Spring Cloud dalam Mental Model Besar Spring

Spring Framework memberi fondasi:

```text
IoC container
AOP/proxy
transaction
web runtime
resource abstraction
eventing
configuration abstraction
```

Spring Boot memberi:

```text
auto-configuration
opinionated application model
production-ready actuator
configuration binding
packaging/runtime convention
```

Spring Cloud memberi layer untuk masalah sistem terdistribusi:

```text
configuration management
service discovery
client-side load balancing
API gateway
circuit breaker
retry/rate-limit/bulkhead integration
declarative HTTP clients
contract testing
distributed tracing integration
control bus
cloud platform integration
```

Spring Cloud bukan mengganti Spring Boot. Ia berada di atas Spring Boot dan mengikuti compatibility matrix yang ketat. Untuk era modern, Spring Cloud release train harus cocok dengan versi Spring Boot yang dipakai. Contoh penting: Spring Cloud 2025.1.x adalah release train yang selaras dengan Spring Boot 4.x.

---

## 2. Masalah Dasar Distributed System yang Dicoba Diselesaikan

Ketika aplikasi berubah dari monolith ke banyak service, sejumlah asumsi lama runtuh.

Dalam monolith:

```text
method call biasanya in-process
latency sangat kecil
failure biasanya exception lokal
transaction boundary lebih mudah dikendalikan
call graph terlihat di codebase yang sama
version compatibility lebih mudah dikontrol
```

Dalam distributed system:

```text
network call bisa timeout
partial failure normal
latency berubah-ubah
service bisa restart di tengah request
schema/API bisa berbeda versi
retry bisa menggandakan side effect
load balancing bisa mengirim request ke instance tidak sehat
observability harus lintas process
security context harus melewati boundary jaringan
```

Spring Cloud tidak menghapus masalah ini. Ia menyediakan building block agar masalah ini bisa dikendalikan dengan pola yang konsisten.

---

## 3. Prinsip Utama: Distributed System Bukan Sekadar Banyak Spring Boot App

Kesalahan umum adalah menganggap microservice berarti:

```text
ambil monolith
pecah package menjadi repository berbeda
pasang REST antar service
pasang Spring Cloud
selesai
```

Itu biasanya menghasilkan **distributed monolith**:

```text
setiap service perlu service lain untuk menyelesaikan request sederhana
release harus serentak
failure satu service menjatuhkan banyak workflow
query data menjadi remote call chain
transaction diganti dengan retry tanpa idempotency
observability hanya log terpisah di banyak pod
```

Spring Cloud harus dipakai setelah boundary arsitektur jelas:

```text
bounded context jelas
ownership data jelas
API contract stabil
failure mode diketahui
operational ownership jelas
observability siap
security model lintas service jelas
```

Jika boundary belum jelas, Spring Cloud dapat mempercepat kompleksitas, bukan menyelesaikannya.

---

## 4. Compatibility Matrix: Spring Boot, Spring Cloud, dan Java

Spring Cloud memakai konsep **release train**, bukan satu versi tunggal. Ini penting karena Spring Cloud terdiri dari banyak project: Gateway, OpenFeign, CircuitBreaker, Config, Consul, Kubernetes, Contract, Stream, dan lainnya.

Mental model:

```text
Java version -> Spring Framework version -> Spring Boot version -> Spring Cloud release train
```

Contoh era:

| Era | Java Umum | Spring Boot | Spring Cloud | Catatan |
|---|---:|---|---|---|
| Legacy | 8/11 | Boot 2.x | Hoxton/2020.x/2021.x | `javax.*`, Spring Framework 5.x |
| Transitional | 17/21 | Boot 3.x | 2022.x/2023.x/2024.x/2025.0 | `jakarta.*`, Spring Framework 6.x |
| Modern | 17/21/25 | Boot 4.x | 2025.1.x / Oakwood | Spring Framework 7.x, Jakarta EE 11 alignment |

Rule praktis:

```text
Jangan upgrade Spring Boot tanpa mengecek Spring Cloud release train.
Jangan upgrade Spring Cloud tanpa mengecek semua project turunannya.
Jangan mencampur random version Spring Cloud artifact karena dependency graph-nya saling terkait.
```

Gunakan BOM:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.cloud</groupId>
      <artifactId>spring-cloud-dependencies</artifactId>
      <version>${spring-cloud.version}</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Atau Gradle platform:

```kotlin
dependencies {
    implementation(platform("org.springframework.cloud:spring-cloud-dependencies:${springCloudVersion}"))
}
```

---

## 5. Spring Cloud sebagai Pattern Toolkit

Spring Cloud mencakup pattern berikut:

| Pattern | Masalah yang Diselesaikan | Risiko Jika Salah Pakai |
|---|---|---|
| Config Server | config terpusat dan versioned | config server menjadi SPOF |
| Discovery Client | menemukan instance service dinamis | discovery tidak sama dengan readiness |
| Load Balancer | memilih instance tujuan | load balancing ke instance unhealthy |
| Gateway | routing dan cross-cutting edge concern | gateway menjadi business logic dump |
| Circuit Breaker | membatasi cascading failure | dianggap sebagai recovery otomatis |
| Retry | mengatasi transient failure | retry storm dan duplicate side effect |
| Rate Limiter | melindungi downstream | salah limit membuat self-denial-of-service |
| Bulkhead | isolasi resource | konfigurasi terlalu kecil mematikan throughput |
| OpenFeign | declarative HTTP client | remote call tersembunyi seperti method lokal |
| Contract Test | kompatibilitas producer-consumer | contract tidak merepresentasikan real behavior |
| Tracing | observability lintas service | trace tanpa business correlation tetap sulit audit |

---

## 6. Configuration Management dengan Spring Cloud Config

### 6.1 Masalah yang Dicoba Diselesaikan

Dalam distributed system, konfigurasi tersebar:

```text
service A punya timeout sendiri
service B punya endpoint downstream sendiri
service C punya feature flag sendiri
service D punya tenant-specific override
```

Tanpa tata kelola, akan muncul:

```text
config drift
secret leakage
manual production patch
perbedaan env yang tidak terdokumentasi
rollback config sulit
```

Spring Cloud Config memberikan model:

```text
central config server
backing store, biasanya Git
client mengambil config saat startup
opsional refresh runtime
```

### 6.2 Arsitektur Dasar

```text
+--------------------+
| Git / Vault / etc. |
+---------+----------+
          |
          v
+--------------------+        +--------------------+
| Config Server      | -----> | Spring Boot App A  |
+--------------------+        +--------------------+
          |                   +--------------------+
          +-----------------> | Spring Boot App B  |
                              +--------------------+
```

### 6.3 Kapan Cocok

Spring Cloud Config cocok ketika:

```text
banyak service punya config bersama
config ingin versioned di Git
perlu property source konsisten antar service
perlu profile/env-based config composition
platform belum punya mekanisme config native yang cukup
```

### 6.4 Kapan Tidak Cocok

Tidak selalu cocok jika:

```text
sistem sudah full GitOps dengan Kubernetes ConfigMap/Secret
secret sudah dikelola AWS Secrets Manager/SSM/Vault
config harus strongly controlled via deployment pipeline
runtime refresh berbahaya untuk invariant aplikasi
```

### 6.5 Runtime Refresh: Powerful tapi Berbahaya

Refresh config terdengar menarik, tetapi harus dibatasi.

Contoh config yang relatif aman di-refresh:

```text
log level
feature flag tertentu
timeout outbound tertentu
non-critical threshold
```

Contoh config yang sebaiknya tidak di-refresh sembarangan:

```text
datasource URL
schema tenant mapping
security issuer/JWK config
thread pool core size untuk critical executor
transaction timeout global
cache serialization format
```

Alasannya: beberapa konfigurasi membentuk invariant startup. Mengubahnya saat runtime bisa membuat object graph, connection pool, security policy, atau cache state tidak konsisten.

### 6.6 Failure Model Config Server

| Failure | Efek | Mitigasi |
|---|---|---|
| Config server down saat app startup | app gagal start jika fail-fast | local cache, fail-fast policy jelas, HA config server |
| Git repo tidak tersedia | config server gagal serve config baru | mirror/cache, release discipline |
| Config salah commit | semua service bisa rusak | PR review, config validation, staged rollout |
| Secret masuk Git | data exposure | secret backend terpisah, scanner, policy |
| Refresh tidak konsisten | instance beda config | version stamp, rollout controlled, observability |

---

## 7. Service Discovery

### 7.1 Masalah Dasar

Dalam monolith, dependency adalah object reference. Dalam distributed system, dependency adalah endpoint yang bisa berubah.

Instance service bisa:

```text
scale up
scale down
restart
pindah node
unhealthy
belum ready
sudah terminating
```

Service discovery menjawab:

```text
untuk logical service X, instance mana yang bisa dipanggil sekarang?
```

### 7.2 Model Discovery

```text
+-------------+       register       +-------------------+
| Service A-1 | -------------------> | Discovery Server  |
+-------------+                      +-------------------+
+-------------+       register                ^
| Service A-2 | ------------------------------|
+-------------+                               |
                                                query
                                          +-----+------+
                                          | Service B  |
                                          +------------+
```

### 7.3 Eureka, Consul, Kubernetes

Spring Cloud historically sering dipakai dengan Eureka atau Consul. Di Kubernetes, service discovery sudah tersedia melalui DNS dan Service object.

Perbandingan:

| Pilihan | Cocok Untuk | Catatan |
|---|---|---|
| Eureka | legacy Netflix-style Spring Cloud environment | umum di Boot 1/2 era |
| Consul | discovery + KV + health check | operational dependency tambahan |
| Kubernetes Service DNS | Kubernetes-native app | sering cukup tanpa discovery client eksplisit |
| Service mesh | traffic management advanced | kompleksitas platform lebih tinggi |

### 7.4 Discovery Bukan Readiness

Satu kesalahan besar:

```text
instance terdaftar = instance aman dipanggil
```

Belum tentu.

Instance bisa sudah terdaftar tetapi:

```text
DB connection belum siap
cache warm-up belum selesai
migration lock masih berjalan
thread pool saturated
app sedang graceful shutdown
```

Gunakan readiness probe dan health indicator yang benar.

### 7.5 Discovery Failure Model

| Failure | Efek |
|---|---|
| registry stale | request dikirim ke instance mati |
| health check terlalu longgar | traffic masuk ke app belum siap |
| health check terlalu ketat | instance sehat dikeluarkan dari pool |
| DNS cache terlalu lama | traffic tetap ke IP lama |
| no zone awareness | cross-zone latency/cost naik |

---

## 8. Client-Side Load Balancing

Spring Cloud LoadBalancer menyediakan client-side load balancing.

Mental model:

```text
logical service name
        |
        v
service instance list
        |
        v
load-balancing algorithm
        |
        v
chosen instance
        |
        v
HTTP request
```

### 8.1 Client-Side vs Server-Side Load Balancing

| Model | Contoh | Keunggulan | Risiko |
|---|---|---|---|
| Client-side | Spring Cloud LoadBalancer | client tahu instance list | logic tersebar di client |
| Server-side | Kubernetes Service, ALB, NLB | client sederhana | less app-level control |
| Mesh | Envoy/Istio/Linkerd | policy di platform | operational complexity |

### 8.2 Kapan Client-Side Load Balancer Berguna

```text
butuh zone-aware routing
butuh custom instance filtering
butuh metadata-based routing
butuh integrasi discovery non-Kubernetes
butuh fallback antar cluster/region secara eksplisit
```

### 8.3 Kapan Tidak Perlu

```text
cukup pakai Kubernetes service DNS
traffic policy dikelola service mesh
gateway/load balancer platform sudah handle routing
aplikasi ingin tetap sederhana
```

---

## 9. Spring Cloud Gateway

Spring Cloud Gateway adalah API gateway di ekosistem Spring. Generasi modern mendukung Spring Framework 7 dan Spring Boot 4, dan tersedia dalam flavor WebFlux maupun Web MVC.

### 9.1 Fungsi Gateway

Gateway dapat menangani:

```text
routing
path rewrite
header manipulation
authentication/authorization edge integration
rate limiting
request/response filtering
metrics/tracing
resilience policy
CORS
protocol boundary tertentu
```

### 9.2 Gateway Bukan Tempat Business Logic

Gateway boleh tahu:

```text
route policy
authentication requirement
rate limit
tenant routing hint
correlation ID
header normalization
```

Gateway sebaiknya tidak tahu:

```text
status lifecycle domain
validasi business rule mendalam
workflow transition
calculation logic
repository/database access business
```

Jika gateway mulai berisi business logic, ia menjadi mini-monolith di edge.

### 9.3 Route Mental Model

```text
request
  -> route predicate match
  -> filter chain before
  -> proxy to downstream
  -> filter chain after
  -> response
```

Contoh konseptual route:

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: case-service
          uri: http://case-service
          predicates:
            - Path=/api/cases/**
          filters:
            - StripPrefix=1
```

### 9.4 Gateway Filter Chain

Filter bisa melakukan:

```text
add/remove header
rewrite path
set request host
rate limit
retry
circuit breaker
modify response body
```

Namun setiap filter menambah:

```text
latency
complexity
failure mode
observability requirement
```

### 9.5 Gateway Placement

| Placement | Cocok Untuk |
|---|---|
| Spring Cloud Gateway app | team punya kontrol routing di codebase Spring |
| Kubernetes Ingress | routing L7 sederhana |
| API Gateway managed service | publik API, auth, throttling managed |
| Service mesh ingress | traffic policy platform-heavy |
| Nginx/Envoy edge | low-level routing/performance/custom infra |

### 9.6 Gateway Failure Model

| Failure | Dampak |
|---|---|
| route salah | traffic masuk service salah |
| filter body modify salah | payload corrupt |
| auth header tidak dipropagasi | downstream reject atau security bypass |
| retry di gateway + retry di client | retry multiplication |
| rate limit global salah | semua user terdampak |
| gateway saturated | semua downstream tampak down |

---

## 10. Circuit Breaker dengan Spring Cloud CircuitBreaker

Circuit breaker bukan retry. Circuit breaker adalah mekanisme untuk **berhenti memanggil dependency yang sedang bermasalah sementara waktu** agar caller tidak ikut hancur.

### 10.1 State Mental Model

```text
CLOSED
  request normal
  failure dihitung

OPEN
  request ditolak cepat
  downstream tidak dipanggil

HALF_OPEN
  beberapa request percobaan dilewatkan
  jika sukses -> CLOSED
  jika gagal -> OPEN
```

### 10.2 Circuit Breaker Menjawab Masalah Apa?

Tanpa circuit breaker:

```text
service A memanggil service B
service B lambat
thread service A menunggu
thread pool service A habis
service A ikut down
caller service A ikut down
```

Dengan circuit breaker:

```text
service B gagal/lambat melewati threshold
circuit dibuka
service A fail-fast / fallback
thread tidak habis menunggu B
kerusakan dibatasi
```

### 10.3 Circuit Breaker Tidak Menyelesaikan Root Cause

Circuit breaker tidak:

```text
memperbaiki service downstream
mengembalikan data yang benar secara ajaib
menjamin fallback aman secara domain
menghapus kebutuhan timeout
menghapus kebutuhan capacity planning
```

### 10.4 Fallback Harus Domain-Safe

Fallback yang aman:

```text
return cached public reference data
return degraded read-only view
return "temporarily unavailable" dengan retry-after
queue command untuk diproses nanti jika idempotent
```

Fallback yang berbahaya:

```text
anggap user authorized karena auth service down
anggap payment sukses karena payment service down
anggap case eligible karena rules service down
return empty list untuk data wajib audit
```

### 10.5 Circuit Breaker Configuration

Key parameters:

```text
failure rate threshold
slow call rate threshold
slow call duration threshold
minimum number of calls
sliding window size
wait duration in open state
permitted calls in half-open state
time limiter
```

Jangan copy-paste konfigurasi. Parameter harus mengikuti:

```text
latency normal downstream
SLO caller
criticality operation
idempotency
traffic volume
error semantics
```

---

## 11. Retry, Backoff, dan Retry Storm

Retry adalah pedang bermata dua.

Retry membantu jika failure transient:

```text
temporary network glitch
connection reset
short downstream overload
leader election sebentar
HTTP 503/429 tertentu
```

Retry merusak jika:

```text
request non-idempotent
failure permanent
downstream sudah overloaded
semua instance retry serentak
retry terjadi di banyak layer sekaligus
```

### 11.1 Retry Multiplication

Misal:

```text
browser retry 2x
gateway retry 3x
service A retry 3x
service B client retry 3x
```

Total potensi call:

```text
2 * 3 * 3 * 3 = 54 attempts
```

Satu request user bisa menjadi puluhan request downstream.

### 11.2 Retry Policy yang Baik

Policy harus menjawab:

```text
error apa yang retryable?
berapa kali retry?
berapa delay?
apakah memakai jitter?
apakah operation idempotent?
apakah ada global deadline?
apakah retry budget dibatasi?
```

Contoh prinsip:

```text
retry hanya untuk transient error
pakai exponential backoff + jitter
pasang timeout per attempt
pasang total timeout/deadline
jangan retry 4xx kecuali 409/429 dengan aturan jelas
jangan retry command non-idempotent tanpa idempotency key
```

---

## 12. Rate Limiter

Rate limiter membatasi jumlah request agar downstream atau sistem sendiri tidak overload.

### 12.1 Jenis Rate Limit

```text
per user
per tenant
per client application
per API key
per route
per downstream dependency
per cluster
```

### 12.2 Gateway vs Service Rate Limit

| Lokasi | Kelebihan | Risiko |
|---|---|---|
| Gateway | melindungi edge sebelum masuk service | kurang tahu domain context mendalam |
| Service | bisa domain-aware | resource service sudah terpakai |
| Downstream client | melindungi dependency tertentu | policy tersebar |
| Platform/mesh | konsisten lintas bahasa | butuh maturity platform |

### 12.3 Rate Limit dan Fairness

Global rate limit saja sering tidak adil.

Contoh:

```text
limit global 1000 request/minute
tenant besar menghabiskan 950
tenant kecil hanya dapat sisa 50
```

Untuk enterprise/multi-tenant, gunakan:

```text
tenant-aware key
user/client-aware key
burst allowance
priority class
admin override
metrics per tenant
```

---

## 13. Bulkhead

Bulkhead mengisolasi resource agar satu dependency tidak menghabiskan semua thread/connection.

Tanpa bulkhead:

```text
semua outbound call memakai executor/pool sama
service X lambat
semua worker habis menunggu X
call ke service Y ikut gagal
```

Dengan bulkhead:

```text
pool X terbatas
pool Y terpisah
kegagalan X tidak menghabiskan kapasitas Y
```

Bulkhead bisa berupa:

```text
thread pool terpisah
semaphore limit
connection pool terpisah
queue limit
rate limit per dependency
```

Spring Cloud CircuitBreaker dengan Resilience4j dapat mengintegrasikan bulkhead, tetapi desain kapasitas tetap harus dipikirkan.

---

## 14. OpenFeign dan Declarative HTTP Client

Spring Cloud OpenFeign memudahkan HTTP client berbasis interface.

Contoh konseptual:

```java
@FeignClient(name = "case-service", path = "/api/cases")
public interface CaseClient {

    @GetMapping("/{id}")
    CaseResponse getCase(@PathVariable String id);
}
```

### 14.1 Kelebihan

```text
client contract ringkas
integrasi Spring MVC annotation
integrasi load balancing/discovery
integrasi config property
integrasi decoder/encoder/error decoder
mudah distandardisasi via internal starter
```

### 14.2 Risiko

Feign dapat membuat remote call terlihat seperti method lokal.

Ini berbahaya karena remote call punya sifat:

```text
latency
partial failure
timeout
retry risk
version compatibility
security boundary
observability requirement
```

Karena itu interface Feign sebaiknya ditempatkan di adapter/infrastructure layer, bukan di domain service murni.

### 14.3 Error Decoder

Jangan biarkan semua non-2xx menjadi exception generik.

Buat mapping:

```text
404 -> dependency resource not found / maybe domain not found
409 -> conflict, maybe retryable only if optimistic conflict has strategy
429 -> rate limited, retryable with backoff if allowed
503 -> unavailable, transient candidate
401/403 -> security/config issue, usually not retryable
```

### 14.4 Timeout Wajib

HTTP client tanpa timeout adalah bug produksi.

Minimal punya:

```text
connect timeout
read/response timeout
pool acquisition timeout
optional total deadline
```

---

## 15. Spring Cloud Contract

Distributed system membutuhkan contract antara producer dan consumer.

### 15.1 Masalah

Producer mengubah response:

```json
{
  "caseId": "C-001",
  "status": "OPEN"
}
```

Menjadi:

```json
{
  "id": "C-001",
  "state": "OPEN"
}
```

Consumer bisa rusak walau producer test sendiri lulus.

### 15.2 Contract Testing

Contract test bertujuan memastikan:

```text
producer memenuhi contract yang consumer butuhkan
consumer diuji terhadap stub contract producer
breaking change terdeteksi sebelum deploy
```

### 15.3 Contract Bukan Pengganti E2E Test

Contract test memvalidasi compatibility. Ia tidak membuktikan seluruh workflow bisnis berjalan.

Gunakan kombinasi:

```text
unit test untuk logic lokal
slice/integration test untuk adapter
contract test untuk API compatibility
limited E2E test untuk critical journey
synthetic monitoring untuk production path
```

---

## 16. Distributed Tracing dan Observability

Spring Boot modern memakai Micrometer Observation sebagai abstraction untuk metrics/tracing.

Spring Cloud dapat berintegrasi dengan tracing stack seperti OpenTelemetry melalui ekosistem Micrometer.

### 16.1 Trace ID vs Business Correlation ID

Trace ID menjawab:

```text
request ini melewati service mana saja?
span mana yang lambat?
call mana yang error?
```

Business correlation ID menjawab:

```text
case ID apa yang terdampak?
tenant mana?
workflow instance mana?
submission ID apa?
command ID apa?
```

Dalam sistem regulatory/case-management, trace ID saja tidak cukup. Harus ada correlation dengan entitas bisnis.

### 16.2 Propagation

Pastikan propagation lintas:

```text
HTTP inbound
HTTP outbound
message broker
async executor
scheduler
batch job
manual thread/virtual thread
```

### 16.3 Cardinality Risk

Jangan masukkan high-cardinality value sebagai metric tag:

```text
userId
caseId
email
token
full URL dengan ID
request body field
```

Gunakan sebagai log field atau trace attribute dengan kebijakan yang aman, bukan metric label sembarangan.

---

## 17. Control Bus dan Runtime Coordination

Spring Cloud Bus memungkinkan broadcast event antar instance, sering dipakai untuk config refresh.

Namun prinsipnya:

```text
runtime control plane harus dikendalikan sangat ketat
```

Risiko:

```text
refresh semua service serentak
config berubah tanpa deployment audit
event bus menjadi backdoor operasional
security endpoint lemah
```

Untuk sistem enterprise, runtime bus harus punya:

```text
authentication kuat
authorization granular
audit trail
change ticket/reference
rate limit
rollout strategy
rollback plan
```

---

## 18. Spring Cloud Kubernetes

Di Kubernetes, beberapa kemampuan Spring Cloud bisa digantikan primitive Kubernetes:

```text
service discovery -> Kubernetes Service DNS
config -> ConfigMap/Secret
load balancing -> Service kube-proxy / CNI / mesh
health -> readiness/liveness probes
rolling deploy -> Deployment controller
```

Spring Cloud Kubernetes berguna ketika aplikasi ingin mengakses primitive Kubernetes secara Spring-native.

Namun hati-hati: jangan membuat aplikasi terlalu sadar Kubernetes jika target deployment bisa berubah.

Rule:

```text
platform-specific integration harus masuk infrastructure adapter
core application service tidak boleh tahu Kubernetes API
```

---

## 19. Gateway vs Service Mesh vs Client Library

Banyak pattern bisa ditempatkan di beberapa layer.

| Concern | Client Library | Gateway | Mesh | Service |
|---|---|---|---|---|
| Retry | bisa domain-aware | mudah sentral | policy platform | paling domain-aware |
| Circuit breaker | dekat caller | edge only | platform-level | domain-aware |
| AuthN | outbound token | edge auth | mTLS | method/domain auth |
| Rate limit | per dependency | edge/API | global traffic | domain-aware |
| Tracing | app detail | edge span | network span | business span |
| Transformation | adapter-specific | risky if business | limited | domain-safe |

Tidak ada jawaban tunggal. Prinsipnya:

```text
semakin dekat ke domain, semakin bisa domain-aware
semakin dekat ke platform, semakin konsisten lintas service
```

---

## 20. Anti-Pattern: Distributed Monolith

Ciri-ciri:

```text
request sederhana memanggil 5-10 service
service tidak bisa deploy independen
setiap service punya shared database atau shared entity model
fallback tidak jelas
contract tidak stabil
retry dipasang tanpa idempotency
transaksi bisnis tersebar tanpa saga/outbox
monitoring hanya CPU/memory/log
```

Penyebab umum:

```text
pecah berdasarkan technical layer, bukan bounded context
remote repository pattern
shared common library terlalu besar
semua service saling tahu domain internal
API dibuat dari entity
platform pattern dipasang sebelum domain boundary matang
```

Mitigasi:

```text
mulai dari modular monolith
verifikasi module dependency
stabilkan domain events
baru ekstrak service jika boundary dan ownership jelas
gunakan contract testing
buat failure mode eksplisit
```

---

## 21. Anti-Pattern: Remote Call seperti Local Call

Kode seperti ini tampak bersih:

```java
public CaseSummary getCaseSummary(String caseId) {
    CaseResponse c = caseClient.getCase(caseId);
    ApplicantResponse a = applicantClient.getApplicant(c.applicantId());
    PaymentResponse p = paymentClient.getPayment(c.paymentId());
    return mapper.toSummary(c, a, p);
}
```

Tapi secara runtime:

```text
3 remote calls
3 timeout points
3 auth propagation points
3 version compatibility risks
3 observability spans
partial failure possibility
latency aggregation
```

Pertanyaan desain:

```text
apakah summary ini harus real-time?
apakah bisa denormalized read model?
apakah semua data dimiliki service berbeda?
apakah endpoint aggregator boleh degraded?
apakah setiap call punya timeout dan fallback aman?
apakah response harus konsisten secara transaction?
```

---

## 22. Anti-Pattern: Retry Without Idempotency

Command seperti:

```text
approve case
submit payment
send notification
create account
issue certificate
```

Tidak boleh di-retry sembarangan.

Gunakan:

```text
idempotency key
command ID
deduplication table
outbox/inbox
unique business constraint
state transition guard
```

Contoh invariant:

```text
ApproveCaseCommand(commandId, caseId, actorId, expectedVersion)
```

Rule:

```text
same commandId + same payload -> same result
same commandId + different payload -> reject conflict
state already approved -> return idempotent success only if caused by same command
```

---

## 23. Anti-Pattern: Shared Common Library sebagai Distributed Coupling

Common library berguna untuk:

```text
logging utilities
correlation context
error envelope types yang stabil
security helper generic
starter auto-configuration
contract generated types jika governance jelas
```

Common library berbahaya jika berisi:

```text
domain entity bersama
business rule bersama tanpa ownership
repository interface bersama
database enum lifecycle bersama
client internal model semua service
```

Semakin besar common library, semakin kecil independensi service.

---

## 24. Spring Cloud dan Security Boundary

Distributed system butuh security di beberapa level:

```text
edge authentication
service-to-service authentication
authorization per request
method/domain authorization
tenant isolation
secret rotation
token propagation
mTLS atau workload identity
```

Jangan hanya forward user token tanpa berpikir:

```text
apakah downstream boleh menerima semua scope user?
apakah service harus memakai token exchange?
apakah internal service membutuhkan client credential?
apakah ada confused deputy risk?
apakah audit actor harus user, service, atau keduanya?
```

Model audit yang lebih kuat:

```text
endUserActor = user yang memicu aksi
serviceActor = service yang mengeksekusi aksi
tenant = tenant aktif
correlationId = request/workflow correlation
commandId = idempotency/audit command
```

---

## 25. Spring Cloud dan Data Consistency

Spring Cloud bukan distributed transaction manager.

Jika service punya database masing-masing:

```text
2PC jarang ideal
saga/outbox/inbox lebih umum
read model eventual consistency perlu diterima
compensation perlu didesain eksplisit
```

Pattern yang relevan:

```text
transactional outbox
inbox/dedup consumer
saga orchestration/choreography
idempotent command
versioned event
reconciliation job
compensation workflow
```

Spring Cloud membantu transport/resilience, tetapi consistency semantics tetap tugas desain aplikasi.

---

## 26. Cloud-Native Deployment Considerations

Spring Cloud app di Kubernetes/EKS/AKS/GKE harus memperhatikan:

```text
readiness/liveness probe
startup probe untuk cold startup
terminationGracePeriodSeconds
graceful shutdown Spring Boot
connection draining
pod disruption budget
resource request/limit
HPA metric yang benar
config rollout
secret rotation
zone-aware topology
```

Spring Cloud Gateway, Config Server, dan discovery infrastructure harus dianggap critical shared component.

Artinya perlu:

```text
HA deployment
horizontal scaling
persistent config source
observability
alerting
backup/restore
runbook
security hardening
```

---

## 27. Decision Matrix: Perlukah Spring Cloud?

Gunakan pertanyaan berikut.

### 27.1 Config Server

Pakai jika:

```text
banyak service butuh config versioned terpusat
platform belum punya GitOps config matang
butuh profile composition lintas service
```

Hindari jika:

```text
Kubernetes/GitOps/SSM/Vault sudah menjadi standard kuat
runtime refresh tidak diinginkan
config server menjadi SPOF tanpa tim operasi
```

### 27.2 Discovery Client

Pakai jika:

```text
non-Kubernetes dynamic instance environment
butuh registry-level metadata
butuh client-side routing advanced
```

Hindari jika:

```text
Kubernetes Service DNS cukup
service mesh/platform sudah handle discovery
```

### 27.3 Gateway

Pakai jika:

```text
butuh Spring-programmable routing/filtering
edge concern perlu dekat ekosistem Spring
team siap mengoperasikan gateway sebagai platform component
```

Hindari jika:

```text
managed API gateway/ingress sudah cukup
routing sederhana
team belum siap mengoperasikan critical shared gateway
```

### 27.4 OpenFeign

Pakai jika:

```text
butuh declarative HTTP client
service-to-service API banyak dan contract relatif stabil
standardization via internal starter penting
```

Hindari jika:

```text
remote call bisa terlihat terlalu lokal
butuh streaming/reactive advanced
HTTP service interface Spring Framework sudah cukup
```

### 27.5 Circuit Breaker

Pakai jika:

```text
downstream failure bisa membuat caller ikut overload
fallback/fail-fast semantics jelas
metrics tersedia untuk tuning
```

Hindari jika:

```text
tidak ada timeout
fallback tidak aman
failure semantics belum dipahami
```

---

## 28. Reference Architecture: Spring Cloud Service-to-Service

```text
+-------------------+
| External Client   |
+---------+---------+
          |
          v
+-------------------+
| API Gateway       |
| - routing         |
| - auth edge       |
| - rate limit      |
| - correlation ID  |
+---------+---------+
          |
          v
+-------------------+        +-------------------+
| Case Service      | -----> | Applicant Service |
| - domain authz    |        | - owner data      |
| - transaction     |        | - contract API    |
| - outbox          |        +-------------------+
| - metrics/traces  |
+---------+---------+
          |
          v
+-------------------+
| Message Broker    |
+---------+---------+
          |
          v
+-------------------+
| Notification Svc  |
| - idempotent      |
| - retry/DLQ       |
+-------------------+
```

Important boundaries:

```text
gateway tidak mengambil alih domain authorization
service tidak mengandalkan gateway sebagai satu-satunya security
outbound call punya timeout
command punya idempotency key
message consumer idempotent
trace ID + business correlation ID dipropagasi
```

---

## 29. Failure Scenario Walkthrough

Scenario:

```text
Case Service memanggil Document Service saat submit application.
Document Service lambat karena storage issue.
```

Tanpa resilience design:

```text
Case Service thread menunggu Document Service
thread pool habis
submit lain ikut gagal
health check Case Service gagal
orchestrator restart pod
retry dari client menambah beban
Document Service makin overload
```

Dengan design lebih baik:

```text
connect timeout pendek
response timeout sesuai SLO
circuit breaker membuka setelah threshold
submit command disimpan dengan state PENDING_DOCUMENT_CHECK jika domain mengizinkan
outbox menerbitkan DocumentCheckRequested
consumer retry dengan backoff dan DLQ
user mendapat status pending, bukan silent failure
operator melihat alert slow call rate + backlog
reconciliation job tersedia
```

Perhatikan: solusi bukan hanya circuit breaker. Solusi adalah kombinasi:

```text
timeout
circuit breaker
state model
async processing
idempotency
observability
operator runbook
```

---

## 30. Production Checklist

Sebelum Spring Cloud pattern dipakai production, pastikan:

### Compatibility

```text
Spring Boot dan Spring Cloud release train cocok
BOM digunakan
Tidak ada version override liar
Java baseline sesuai
Jakarta namespace cocok
```

### Config

```text
config source jelas
secret tidak masuk Git
config validation aktif
profile/env naming konsisten
refresh runtime dibatasi
rollback config tersedia
```

### Discovery/Load Balancing

```text
discovery source jelas
readiness digunakan
stale registry/DNS dipahami
zone/topology policy diketahui
```

### Gateway

```text
route terdokumentasi
filter tidak berisi business logic
rate limit key benar
auth boundary jelas
trace/correlation propagated
```

### HTTP Client

```text
connect timeout ada
read/response timeout ada
pool acquisition timeout ada
error decoder jelas
retry hanya untuk retryable condition
idempotency untuk command
```

### Resilience

```text
circuit breaker per dependency penting
fallback domain-safe
bulkhead untuk dependency kritis
rate limiter tenant/client-aware jika perlu
metrics digunakan untuk tuning
```

### Security

```text
service-to-service auth jelas
token propagation aman
tenant context tidak hanya dari header trustless
authorization tetap dicek di service
```

### Observability

```text
trace propagation lintas HTTP/message/async
business correlation ID ada
metrics cardinality aman
log tidak bocor PII/secret
alert berbasis SLO/failure mode
```

### Data Consistency

```text
tidak ada asumsi distributed transaction magic
outbox/inbox untuk side effect penting
consumer idempotent
reconciliation job tersedia
```

---

## 31. Review Heuristics untuk Senior/Principal Engineer

Saat review desain Spring Cloud, tanyakan:

1. Boundary service ini berdasarkan domain atau hanya technical layer?
2. Apa yang terjadi jika downstream timeout selama 10 menit?
3. Apakah retry bisa menggandakan side effect?
4. Apakah fallback menghasilkan data yang legal secara domain?
5. Apakah authorization dicek ulang di service, bukan hanya gateway?
6. Apakah correlation ID cukup untuk audit kasus nyata?
7. Apakah config refresh bisa melanggar invariant runtime?
8. Apakah gateway menjadi tempat business logic?
9. Apakah service masih bisa deploy independen?
10. Apakah observability menjawab “tenant/case/user/workflow mana terdampak?”

Jika jawaban belum jelas, masalahnya bukan kurang library Spring Cloud. Masalahnya adalah desain sistem terdistribusi belum matang.

---

## 32. Kesimpulan

Spring Cloud adalah toolkit kuat untuk membangun common patterns sistem terdistribusi:

```text
config
discovery
load balancing
gateway
resilience
HTTP client
contract testing
tracing/control plane
```

Tetapi Spring Cloud tidak otomatis membuat arsitektur menjadi baik. Ia hanya mengimplementasikan pattern. Kualitas sistem tetap bergantung pada:

```text
bounded context
data ownership
transaction boundary
idempotency
failure semantics
security model
observability
operational discipline
```

Engineer top-tier tidak bertanya “pakai Spring Cloud apa tidak?” terlebih dahulu. Ia bertanya:

```text
failure apa yang harus ditahan?
boundary apa yang harus dijaga?
data mana yang harus konsisten?
siapa caller dan siapa owner capability?
bagaimana sistem diamati dan dipulihkan?
pattern mana yang paling sederhana yang cukup?
```

Spring Cloud berguna ketika jawaban-jawaban itu sudah jelas.

---

## 33. Referensi Resmi dan Lanjutan

- Spring Cloud project overview: https://spring.io/projects/spring-cloud
- Spring Cloud release train reference: https://docs.spring.io/spring-cloud-release/reference/index.html
- Spring Cloud Gateway reference: https://docs.spring.io/spring-cloud-gateway/reference/index.html
- Spring Cloud CircuitBreaker reference: https://docs.spring.io/spring-cloud-circuitbreaker/docs/current/reference/html/
- Spring Cloud OpenFeign reference: https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/
- Resilience4j documentation: https://resilience4j.readme.io/docs
- Spring Boot Actuator and Observability: https://docs.spring.io/spring-boot/reference/actuator/index.html

---

## 34. Status Seri

```text
Part saat ini : 31 dari 35
Status        : belum selesai
Berikutnya    : 32-spring-security-advanced-authorization-policy.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./30-performance-engineering-for-spring-applications.md">⬅️ Part 30 — Performance Engineering for Spring Applications</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./32-spring-security-advanced-authorization-policy.md">Spring Security Advanced: Authorization Architecture and Policy Enforcement ➡️</a>
</div>
