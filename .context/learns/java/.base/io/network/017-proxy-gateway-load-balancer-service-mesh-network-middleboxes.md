# Part 17 — Proxy, Gateway, Load Balancer, Service Mesh, and Network Middleboxes

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `017-proxy-gateway-load-balancer-service-mesh-network-middleboxes.md`  
> Scope Java: Java 8 sampai Java 25  
> Prasyarat seri: Part 0–16, terutama HTTP semantics, HTTP/1.1, HTTP/2, timeout engineering, retry/idempotency, connection pooling, dan TLS/mTLS.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membaca network path produksi sebagai rantai hop, bukan hubungan langsung `client -> server`.
2. Membedakan forward proxy, reverse proxy, gateway, tunnel, ingress, load balancer, sidecar, dan service mesh.
3. Menjelaskan bagaimana middlebox dapat mengubah timeout, retry, header, TLS, HTTP version, buffering, compression, routing, dan observability.
4. Mendesain Java HTTP/gRPC client agar tidak berasumsi bahwa remote service berada tepat di seberang socket.
5. Mendiagnosis failure seperti 502, 503, 504, connection reset, stale connection, idle timeout mismatch, missing header, wrong client IP, gRPC stream reset, retry storm, dan trace gap.
6. Menentukan boundary tanggung jawab antara application code, platform, gateway, ingress, load balancer, dan service mesh.
7. Membuat checklist production readiness untuk sistem Java yang berjalan di balik proxy/LB/mesh.

---

## 2. Core Mental Model

Di development lokal, kita sering membayangkan network call seperti ini:

```text
Java service A -> Java service B
```

Di production, bentuk sebenarnya biasanya seperti ini:

```text
Java service A
  -> local HTTP/gRPC client
  -> client connection pool/channel
  -> pod/node network
  -> sidecar proxy, optional
  -> egress gateway, optional
  -> corporate proxy, optional
  -> cloud load balancer
  -> ingress controller / API gateway
  -> service mesh sidecar, optional
  -> Kubernetes service / endpoint routing
  -> remote pod
  -> remote Java server/framework
  -> remote dependency
```

Karena itu, satu request Java tidak hanya punya satu hubungan TCP atau satu timeout. Ia bisa melewati beberapa connection segment:

```text
Client JVM -> proxy 1
proxy 1 -> proxy 2
proxy 2 -> load balancer
load balancer -> ingress
ingress -> service pod
```

Setiap segment dapat memiliki:

- TCP connection sendiri
- TLS handshake sendiri
- idle timeout sendiri
- retry policy sendiri
- buffering policy sendiri
- header mutation sendiri
- protocol version sendiri
- observability span/log sendiri
- rate limit dan circuit breaker sendiri

Top-tier engineer tidak hanya bertanya:

> “Kenapa Java client timeout?”

Tetapi bertanya:

> “Timeout terjadi pada hop mana, budget siapa yang habis, connection mana yang ditutup, siapa yang melakukan retry, dan apakah response yang dilihat client adalah response origin atau synthetic response dari intermediary?”

---

## 3. Terminology: Proxy, Gateway, Tunnel, Load Balancer, Mesh

HTTP specification membedakan beberapa bentuk intermediary. Secara praktis, istilah di lapangan sering overlap, tetapi mental model-nya tetap penting.

### 3.1 Forward Proxy

Forward proxy berada di sisi client. Client sadar bahwa ia memakai proxy.

Contoh:

```text
Java app -> corporate proxy -> internet API
```

Biasanya digunakan untuk:

- outbound internet access control
- audit access
- data loss prevention
- malware scanning
- TLS inspection, pada beberapa environment
- allowlist domain

Di Java, forward proxy dapat dikonfigurasi melalui:

- JVM system properties
- `ProxySelector`
- library-specific proxy config
- JDK `HttpClient.Builder.proxy(...)`
- Apache HttpClient route planner
- OkHttp proxy config

Failure khas:

- `407 Proxy Authentication Required`
- proxy tidak support CONNECT ke port tertentu
- TLS handshake gagal karena TLS inspection certificate tidak dipercaya JVM
- request timeout karena proxy queueing
- proxy memblokir domain, method, header, atau payload size
- DNS resolve dilakukan oleh client atau proxy tergantung mode

### 3.2 Reverse Proxy / Gateway

Reverse proxy berada di sisi server. Client mengira ia berbicara dengan origin server, padahal request diterima dulu oleh gateway/proxy.

Contoh:

```text
Browser/API client -> API Gateway -> backend Java service
```

Fungsi umum:

- TLS termination
- routing path/host-based
- authentication pre-check
- rate limiting
- request validation
- response transformation
- compression
- caching
- WAF
- observability
- canary routing

Failure khas:

- `502 Bad Gateway`: gateway tidak mendapat response valid dari upstream
- `503 Service Unavailable`: gateway/upstream unavailable atau overloaded
- `504 Gateway Timeout`: gateway menunggu upstream terlalu lama
- missing/changed headers
- wrong scheme/host karena proxy forwarding tidak benar
- body buffering mengubah streaming behavior

### 3.3 Tunnel

Tunnel melewatkan byte stream tanpa memahami seluruh HTTP semantics di dalamnya. Contoh paling umum adalah HTTP `CONNECT` untuk TLS melalui forward proxy:

```text
Java client -> HTTP proxy --CONNECT--> target:443
```

Setelah tunnel terbentuk, TLS handshake terjadi antara Java client dan target, kecuali ada TLS inspection.

### 3.4 Load Balancer

Load balancer membagi traffic ke banyak backend.

Level umum:

```text
Layer 4 LB: TCP/UDP-level forwarding
Layer 7 LB: HTTP-aware routing
```

Layer 4 LB biasanya tidak memahami HTTP method/header/path. Layer 7 LB dapat melakukan routing berdasarkan host, path, header, cookie, method, atau metadata lain.

Failure khas:

- connection reset saat backend diganti/drained
- sticky session salah
- idle timeout mismatch
- health check tidak merepresentasikan readiness aplikasi
- load imbalance karena long-lived connection
- HTTP/2 multiplexing membuat distribusi request tidak merata

### 3.5 Kubernetes Ingress

Ingress adalah resource Kubernetes untuk mengekspos HTTP/HTTPS service. Namun Ingress tidak bekerja sendiri; harus ada Ingress Controller.

Mental model:

```text
External LB -> Ingress Controller -> Kubernetes Service -> Pod
```

Ingress Controller dapat berupa NGINX, HAProxy, Traefik, Envoy, cloud-specific controller, dan lain-lain.

### 3.6 API Gateway

API Gateway biasanya lebih opinionated dari reverse proxy biasa.

Ia bisa memiliki fitur:

- authN/authZ
- API key validation
- quota/rate limit
- request schema validation
- transformation
- developer portal
- routing by API version
- monetization/billing, di beberapa platform
- centralized policy

Gateway sering menjadi boundary kontrak eksternal. Karena itu gateway failure bukan hanya technical failure, tetapi juga contract governance issue.

### 3.7 Service Mesh

Service mesh memindahkan banyak concern service-to-service ke data plane proxy, sering berupa sidecar atau node-level proxy.

Contoh fungsi:

- service discovery
- mTLS antar service
- retries
- timeouts
- circuit breaking
- traffic splitting
- canary
- telemetry
- policy

Contoh mental path dengan sidecar:

```text
Service A JVM
  -> localhost sidecar A
  -> network
  -> sidecar B
  -> Service B JVM
```

Dari sudut Java app, remote call terlihat seperti call biasa. Tetapi secara faktual ada dua proxy tambahan dan beberapa policy platform yang mungkin ikut menentukan outcome.

---

## 4. Why Middleboxes Matter for Java Engineers

Banyak engineer hanya melihat exception di Java:

```text
java.net.SocketTimeoutException
java.net.ConnectException
javax.net.ssl.SSLHandshakeException
java.io.IOException: Connection reset by peer
java.net.http.HttpTimeoutException
io.grpc.StatusRuntimeException: DEADLINE_EXCEEDED
io.grpc.StatusRuntimeException: UNAVAILABLE
```

Tetapi exception tersebut sering bukan berasal langsung dari remote application. Bisa berasal dari:

- local proxy
- corporate proxy
- service mesh sidecar
- load balancer
- ingress controller
- API gateway
- upstream proxy
- remote server
- kernel/network path

Contoh:

```text
Java client receives 504
```

Kemungkinan artinya:

1. Origin service memang lambat.
2. Gateway timeout terlalu pendek.
3. Gateway tidak bisa connect ke upstream.
4. Upstream response streaming tetapi proxy buffering/read timeout salah.
5. Service mesh retry menghabiskan budget sebelum Java client timeout.
6. Java server sudah sukses memproses, tetapi response hilang di hop berikutnya.
7. Load balancer health check mengirim traffic ke pod yang belum ready.

Top-tier diagnosis tidak berhenti di status code. Ia memetakan hop.

---

## 5. End-to-End vs Hop-by-Hop Semantics

Salah satu konsep paling penting adalah perbedaan antara **end-to-end** dan **hop-by-hop**.

### 5.1 End-to-End

End-to-end berarti informasi berlaku dari client asli ke origin service, walaupun melewati proxy.

Contoh umum:

- application-level request id
- business idempotency key
- authorization context, dengan aturan tertentu
- trace context
- content type
- semantic HTTP method

### 5.2 Hop-by-Hop

Hop-by-hop berarti hanya berlaku untuk satu connection segment.

Contoh:

- TCP connection state
- HTTP/1.1 connection reuse
- `Connection` header semantics
- TLS session antara dua hop
- local idle timeout
- local connection pool

Jika engineer mencampur dua hal ini, desain menjadi salah.

Contoh kesalahan:

```text
“Kita sudah enable TCP keepalive di Java, jadi gateway tidak akan timeout.”
```

Salah. TCP keepalive di connection `Java -> gateway` tidak otomatis menjaga connection `gateway -> upstream`. Gateway punya pool dan idle timeout sendiri.

Contoh lain:

```text
“Client sudah mengirim timeout 30s, jadi upstream pasti berhenti setelah 30s.”
```

Belum tentu. Kecuali deadline/cancellation dipropagasi dan dihormati oleh semua hop, upstream mungkin tetap bekerja setelah client/gateway menyerah.

---

## 6. The Real Request Path: Segment-by-Segment

Misalkan Java service A memanggil Java service B melalui gateway dan mesh:

```text
A JVM
  -> A HttpClient connection pool
  -> A sidecar
  -> service mesh data plane
  -> ingress/gateway
  -> B sidecar
  -> B JVM
```

Segment-nya:

```text
Segment 1: A JVM -> A sidecar
Segment 2: A sidecar -> gateway/mesh upstream
Segment 3: gateway -> B sidecar
Segment 4: B sidecar -> B JVM
```

Masing-masing segment bisa punya:

```text
connect timeout
TLS handshake timeout
idle timeout
request timeout
read timeout
write timeout
max connection
max pending requests
max concurrent streams
retry policy
buffering policy
circuit breaker
rate limit
```

Maka debugging harus bertanya:

```text
Apakah request sampai ke sidecar A?
Apakah sidecar A mengirim ke gateway?
Apakah gateway memilih upstream benar?
Apakah B sidecar menerima?
Apakah B JVM menerima request?
Apakah B JVM mengirim response?
Apakah response sampai kembali ke A JVM?
```

Kalau tidak ada trace/log per hop, kamu hanya menebak.

---

## 7. Header Mutation and Identity Propagation

Middlebox sering menambah, menghapus, atau mengubah header.

### 7.1 Headers Commonly Added by Proxies

```text
Forwarded
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Real-IP
Via
Host
X-Request-ID
X-Correlation-ID
traceparent
baggage
```

### 7.2 `Forwarded` vs `X-Forwarded-*`

`Forwarded` adalah header standar untuk membawa informasi yang hilang karena proxying, seperti client IP, proxy identity, host, dan scheme. Namun di banyak sistem, `X-Forwarded-*` masih lebih umum.

Contoh:

```text
Forwarded: for=203.0.113.10;proto=https;host=api.example.com
X-Forwarded-For: 203.0.113.10, 10.0.1.15
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
```

### 7.3 Trust Boundary

Jangan percaya `X-Forwarded-For` dari internet secara buta.

Problem:

```text
Client malicious sends:
X-Forwarded-For: 127.0.0.1
```

Jika aplikasi langsung percaya header itu, security logic bisa salah.

Prinsip:

1. Hanya proxy tepercaya yang boleh menetapkan forwarded headers.
2. Edge proxy harus membersihkan incoming forwarded headers dari untrusted clients.
3. Application hanya percaya forwarded headers jika request berasal dari trusted proxy network.
4. Gunakan framework/server setting yang benar untuk forwarded headers.

### 7.4 Java Server Implication

Aplikasi Java yang berjalan di balik proxy sering salah membaca:

```text
request.getScheme() -> http, padahal external client memakai https
request.getServerName() -> internal service name
request.getRemoteAddr() -> proxy IP, bukan client IP
```

Dampaknya:

- generated absolute URL salah
- redirect ke `http://` bukan `https://`
- audit log salah client IP
- rate limit salah subject
- security policy salah
- cookie `Secure`/domain/path behavior salah

Solusi bukan manual parse sembarang header di business code. Solusi harus ada di boundary infrastructure/framework configuration.

---

## 8. TLS Termination, Re-Encryption, and mTLS Across Hops

### 8.1 TLS Termination at Edge

Pola umum:

```text
Client --HTTPS--> Load Balancer/Gateway --HTTP--> Java service
```

Kelebihan:

- certificate management centralized
- offload handshake cost
- easier WAF/gateway inspection

Risiko:

- internal traffic plaintext
- app melihat scheme internal sebagai HTTP
- forwarded proto harus benar
- compliance mungkin menuntut encryption in transit end-to-end

### 8.2 TLS Re-Encryption

```text
Client --HTTPS--> Gateway --HTTPS--> Java service
```

Kelebihan:

- encrypted across internal network
- backend identity dapat diverifikasi

Risiko:

- certificate rotation lebih kompleks
- truststore harus benar di gateway dan app
- ALPN/HTTP2 compatibility harus benar

### 8.3 mTLS in Service Mesh

```text
Service A -> sidecar A ==mTLS== sidecar B -> Service B
```

Dari aplikasi, mungkin masih HTTP plaintext ke localhost sidecar, tetapi antar sidecar terenkripsi dan authenticated.

Pertanyaan desain penting:

```text
Apakah identity yang dipakai untuk authorization adalah:
- end-user identity?
- service identity?
- workload identity?
- client certificate subject?
- JWT subject?
- gateway-authenticated principal?
```

Jangan mencampur user identity dan service identity.

---

## 9. Timeout Layering Across Middleboxes

Timeout chain yang buruk:

```text
Java client timeout: 60s
Gateway timeout: 30s
Service mesh per-try timeout: 10s, retries 3
Backend DB timeout: 45s
Backend application timeout: none
```

Apa yang terjadi?

```text
0s   Java client sends request
10s  Mesh attempt 1 timeout
20s  Mesh attempt 2 timeout
30s  Gateway timeout -> returns 504
45s  Backend DB maybe still running
60s  Java client would have timed out, but already got 504
```

Masalah:

- Java client mengira origin service mengembalikan 504, padahal gateway synthetic response.
- Backend mungkin tetap mengerjakan request setelah client menyerah.
- Retry di mesh dapat menciptakan multiple backend attempts.
- Audit trail bisa punya duplicate attempt.
- Deadline tidak end-to-end.

### 9.1 Correct Timeout Hierarchy

Timeout harus mengikuti hierarchy:

```text
Caller overall deadline
  > gateway total timeout
    > mesh route timeout
      > per-try timeout
        > backend app handler budget
          > downstream dependency timeout
```

Namun “lebih besar” tidak berarti semua harus longgar. Yang penting adalah budget explicit dan tidak saling bertentangan.

### 9.2 Timeout Ownership

Tentukan siapa yang memiliki timeout utama:

```text
External API call:
- client request deadline: owned by caller
- gateway timeout: platform enforcement
- service handler timeout: application protection
- downstream dependency timeout: dependency client protection

Internal service-to-service call:
- upstream service deadline: caller
- mesh per-route timeout: platform default/guardrail
- Java client timeout: local implementation
- backend cancellation: callee cooperation
```

### 9.3 Java Design Implication

Java client wrapper sebaiknya membawa:

```text
operation name
overall deadline
per-attempt timeout
retry budget
idempotency metadata
correlation id
trace context
```

Bukan hanya:

```text
Duration timeout = Duration.ofSeconds(30)
```

---

## 10. Retry Multiplication Across Layers

Retry sering ada di banyak layer:

```text
Java client retry: 3 attempts
Service mesh retry: 2 attempts
Gateway retry: 2 attempts
Cloud SDK retry: 3 attempts
```

Worst-case attempt:

```text
3 * 2 * 2 * 3 = 36 attempts
```

Untuk satu user request.

Ini salah satu penyebab retry storm.

### 10.1 Retry Ownership Rule

Gunakan prinsip:

```text
One semantic owner of retry per operation.
```

Bukan berarti layer lain tidak boleh retry sama sekali, tetapi retry policy harus dikoordinasikan.

Contoh:

```text
Application layer:
- paham idempotency
- paham business side effect
- paham operation type

Mesh/gateway layer:
- paham transport failure
- tidak selalu paham side effect
- sebaiknya hanya retry safe/idempotent operation atau failure sempit
```

### 10.2 Retry Budget Propagation

Idealnya, retry mengikuti budget:

```text
X-Retry-Budget-Remaining: 1
X-Attempt: 2
```

Atau melalui telemetry/context internal.

Untuk public API, jangan mengekspos detail internal sembarangan. Untuk internal service, metadata retry attempt sangat membantu observability.

---

## 11. Buffering: The Hidden Behavior Changer

Proxy bisa buffering request atau response.

### 11.1 Response Buffering

Jika proxy buffering response:

```text
Backend streams chunks slowly -> proxy buffers -> client receives later/all-at-once
```

Dampak:

- SSE rusak atau delay
- streaming download tidak benar-benar streaming
- memory/disk pressure di proxy
- client timeout karena tidak menerima bytes
- backend mengira sudah mengirim, client belum menerima

### 11.2 Request Buffering

Jika proxy buffering request:

```text
Client uploads large file -> proxy stores body -> backend receives only after complete
```

Dampak:

- backend tidak bisa process streaming upload
- proxy disk/memory pressure
- upload timeout di edge
- progress semantics berubah
- cancellation delay

### 11.3 Java Implication

Kalau kamu mendesain:

- file upload besar
- SSE
- long polling
- streaming JSON lines
- gRPC streaming
- chunked transfer

Maka konfigurasi proxy/gateway sama pentingnya dengan kode Java.

Pertanyaan wajib:

```text
Apakah proxy buffering aktif?
Berapa max body size?
Berapa read timeout antar chunk?
Apakah compression aktif?
Apakah HTTP/2 end-to-end atau diturunkan ke HTTP/1.1?
Apakah gateway support streaming gRPC?
```

---

## 12. Protocol Translation

Middlebox sering melakukan protocol translation:

```text
Client -> HTTP/2 -> Gateway -> HTTP/1.1 -> Backend
Client -> HTTP/3 -> Edge -> HTTP/2 -> Backend
Client -> gRPC -> Gateway -> JSON/REST -> Backend
Client -> TLS -> LB -> plaintext HTTP -> App
```

### 12.1 Why It Matters

Protocol translation dapat mengubah:

- connection concurrency model
- stream behavior
- error code mapping
- header casing/normalization
- trailers support
- flow control
- body streaming
- compression
- timeout semantics

### 12.2 gRPC Specific Concern

gRPC bergantung pada HTTP/2 semantics, termasuk:

- streams
- trailers
- HTTP/2 framing
- metadata
- status in trailers

Jika proxy tidak mendukung gRPC end-to-end dengan benar, failure bisa terlihat sebagai:

```text
UNAVAILABLE
DEADLINE_EXCEEDED
INTERNAL
RST_STREAM
upstream connect error
HTTP 502 mapped to gRPC status
missing trailers
```

### 12.3 Java Client Implication

Untuk gRPC Java:

- pastikan LB/proxy mendukung HTTP/2/gRPC, bukan hanya HTTP/1.1
- cek max concurrent streams
- cek keepalive policy
- cek idle timeout
- cek max message size
- cek support trailers
- cek health checking dan load balancing strategy

---

## 13. Load Balancing Algorithms and Java Behavior

Load balancing terlihat sederhana:

```text
request -> one of many backends
```

Tetapi perilakunya tergantung koneksi.

### 13.1 Request-Level vs Connection-Level Balancing

HTTP/1.1 dengan banyak short connections cenderung lebih mudah tersebar.

HTTP/1.1 dengan long-lived keep-alive:

```text
Client opens few connections -> LB pins connections to few backends
```

HTTP/2:

```text
One connection carries many streams -> many requests may go to one backend
```

Jika LB melakukan balancing per connection, HTTP/2 dapat menyebabkan imbalance.

### 13.2 Sticky Session

Sticky session berguna jika aplikasi memiliki server-local state, tetapi itu biasanya smell untuk scalable backend.

Risiko:

- uneven load
- failover behavior buruk
- session loss saat pod mati
- autoscaling kurang efektif
- rolling deployment unpredictable

Lebih baik:

- externalize session state
- use stateless token dengan hati-hati
- store server state di shared durable/cache layer jika perlu

### 13.3 Health Check Is Not Readiness

Health check sering terlalu dangkal:

```text
GET /health -> 200 OK
```

Padahal service tidak ready karena:

- DB pool exhausted
- migration belum selesai
- cache belum warm
- dependency critical down
- thread pool saturated
- event loop blocked

Tapi health check terlalu berat juga buruk karena menyebabkan cascading failure.

Ideal:

```text
liveness: apakah process hidup dan tidak deadlocked?
readiness: apakah boleh menerima traffic baru?
startup: apakah initialization selesai?
```

Untuk Java service di Kubernetes, readiness harus mencerminkan kemampuan menerima traffic, bukan sekadar JVM hidup.

---

## 14. Common Status Codes Generated by Intermediaries

### 14.1 502 Bad Gateway

Biasanya berarti gateway/proxy mendapat response invalid atau gagal connect/read dari upstream.

Kemungkinan:

- upstream connection refused
- upstream reset connection
- TLS handshake ke upstream gagal
- protocol mismatch
- malformed upstream response
- upstream closed connection too early

### 14.2 503 Service Unavailable

Kemungkinan:

- no healthy upstream
- circuit breaker open
- rate limit/concurrency limit
- overload protection
- maintenance/draining

### 14.3 504 Gateway Timeout

Kemungkinan:

- upstream terlalu lambat
- gateway timeout terlalu pendek
- response streaming tidak mengirim chunk cukup sering
- DNS/connect ke upstream lambat
- service mesh retry menghabiskan budget

### 14.4 429 Too Many Requests

Bisa berasal dari:

- application rate limiter
- API gateway quota
- WAF/bot protection
- service mesh/local rate limit
- external provider

Handling 429 harus membaca `Retry-After` jika tersedia, tetapi tetap harus tunduk pada caller deadline dan retry budget.

---

## 15. Middlebox and Connection Lifecycle

### 15.1 Idle Timeout Mismatch

Contoh:

```text
Java pool keeps idle connection for 5 minutes
Load balancer closes idle connection after 60 seconds
Java reuses stale connection at t=120s
Request fails with connection reset
```

Solusi:

```text
client idle eviction < LB idle timeout
connection TTL reasonable
retry safe operation once if connection stale before request body side effect
pool metrics visible
```

### 15.2 Draining

Saat deployment atau scale down:

```text
LB marks backend draining
existing connections may continue for a while
new requests should stop
long-lived streams need special handling
```

Untuk Java server:

- stop accepting new traffic via readiness false
- allow in-flight requests to finish within grace period
- close HTTP/2/gRPC gracefully if possible
- avoid killing process before response flushed
- coordinate Kubernetes termination grace period with LB deregistration delay

### 15.3 Connection Pinning and DNS

Client connection pool dapat membuat traffic tetap menuju endpoint lama walaupun DNS sudah berubah.

Middlebox dapat memperparah atau memperbaiki ini:

- LB hides backend changes
- DNS LB requires client respect TTL and reconnect
- HTTP/2 long connection pins traffic longer
- gRPC channel may keep subchannels alive

---

## 16. Service Mesh: Power and Risk

Service mesh membuat network behavior konsisten, tetapi juga dapat menyembunyikan complexity.

### 16.1 Benefits

- mTLS transparan
- standardized retries/timeouts
- traffic splitting
- telemetry konsisten
- policy enforcement
- circuit breaking
- progressive delivery

### 16.2 Risks

- application engineer tidak tahu ada retry tambahan
- timeout policy mesh bertentangan dengan application deadline
- sidecar resource limit menyebabkan latency
- trace terlihat dari proxy, bukan dari business handler
- local connection ke sidecar sukses, upstream gagal
- error message berasal dari Envoy/sidecar, bukan service
- gRPC keepalive ditolak oleh proxy
- long-lived stream diputus idle timeout

### 16.3 Golden Rule

Service mesh tidak menghapus kebutuhan application-level correctness.

Mesh bisa membantu transport resilience, tetapi tidak tahu:

- apakah operation idempotent secara domain
- apakah duplicate side effect aman
- apakah audit trail harus mencatat attempt atau outcome
- apakah retry dapat melanggar SLA/regulatory timeline
- apakah cancellation harus membatalkan workflow atau hanya HTTP request

---

## 17. Java Application Design Behind Middleboxes

### 17.1 Client Wrapper Should Be Intermediary-Aware

Wrapper HTTP/gRPC internal sebaiknya punya konsep:

```text
operationName
remoteServiceName
routeName
idempotencyPolicy
overallDeadline
perAttemptTimeout
retryPolicy
expectedStatusMapping
bodyReplayability
traceContext
correlationId
tenant/user context, if allowed
```

Bukan sekadar:

```java
String call(String url, String json)
```

### 17.2 Server Should Be Proxy-Aware at Boundary

Server-side Java harus mengatur:

- trusted proxy headers
- forwarded proto/host/client IP handling
- request size limit
- header size limit
- timeout/read behavior
- graceful shutdown
- access log with correlation id
- response status mapping
- streaming compatibility

Business code tidak boleh bertanggung jawab parse infra headers secara scattered.

### 17.3 Error Model Should Identify Source

Error response internal sebaiknya bisa membedakan:

```text
origin_application_error
origin_dependency_error
gateway_timeout
proxy_connection_failure
rate_limited_by_gateway
rate_limited_by_application
circuit_open
client_cancelled
```

Tidak semua perlu dikirim ke external client, tetapi harus terlihat di logs/metrics/traces.

---

## 18. Observability Across Middleboxes

### 18.1 Correlation ID

Correlation ID harus stabil sepanjang request logical.

```text
X-Correlation-ID: logical request id
```

Tetapi per-attempt ID juga penting:

```text
X-Request-Attempt-ID: unique attempt id
```

Jika request di-retry, correlation ID sama, attempt ID berbeda.

### 18.2 Trace Context

Gunakan trace context standar seperti W3C `traceparent` jika platform mendukung.

Trace ideal:

```text
client span
  -> proxy/gateway span
    -> service server span
      -> downstream client span
```

Namun tidak semua middlebox ikut trace. Jika trace putus, gunakan:

- access logs
- request id
- gateway logs
- LB target logs
- sidecar metrics
- application logs

### 18.3 Metrics Per Hop

Metrics yang penting:

```text
requests total by route/status/source
latency histogram by route and upstream
upstream connect failure
upstream reset
upstream timeout
retries attempted
retry overflow
circuit breaker open
pending requests
active connections
idle connections
max concurrent streams reached
response flags / error details
TLS handshake failures
mTLS auth failures
rate limited requests
request/response size
```

### 18.4 Access Log Fields

Access log gateway/proxy sebaiknya punya:

```text
timestamp
request id
trace id
method
path/template
status
upstream status
route
cluster/upstream
duration total
upstream duration
bytes in/out
client IP
user agent
retries
response flags
TLS protocol/cipher, where relevant
```

---

## 19. Failure Mode Catalogue

### Failure 1 — Java Client Gets 504, Backend Has No Log

Likely causes:

```text
gateway could not route
gateway could not connect
request rejected before backend
timeout before request reached app
different backend than expected
logging sampled/missing
```

Diagnosis:

```text
check gateway access log
check upstream cluster status
check LB target health
check route match
check service endpoint list
check sidecar logs
check trace span boundary
```

### Failure 2 — Backend Processes Successfully, Client Gets Timeout

Likely causes:

```text
response lost after backend
proxy read timeout
client timeout shorter than server processing
streaming buffered by proxy
gateway connection reset
client cancelled but backend ignored cancellation
```

Diagnosis:

```text
compare backend completion timestamp vs gateway response timestamp
look for client disconnect logs
check upstream response duration
check response size
check proxy buffering
check network resets
```

### Failure 3 — Works Locally, Fails Behind Gateway

Likely causes:

```text
header size limit
body size limit
path rewrite
host rewrite
TLS termination scheme mismatch
trailing slash route mismatch
timeout difference
gateway blocks method/content-type
```

### Failure 4 — gRPC Works Directly, Fails Through Ingress

Likely causes:

```text
ingress not configured for gRPC/HTTP2
TLS/ALPN mismatch
trailers stripped
max message size exceeded
idle timeout for stream
keepalive policy conflict
HTTP/1.1 downgrade
```

### Failure 5 — Random Connection Reset After Idle

Likely causes:

```text
LB idle timeout shorter than client pool idle
proxy closes upstream idle connection
stale pooled socket
NAT timeout
service mesh draining
```

### Failure 6 — Load Imbalance with HTTP/2/gRPC

Likely causes:

```text
few long-lived HTTP/2 connections
LB balances per connection not per request
client channel count too low
max concurrent streams high
sticky session/cookie
```

### Failure 7 — Retry Storm During Partial Outage

Likely causes:

```text
application retry + mesh retry + gateway retry
no retry budget
no jitter
all clients retry same schedule
circuit breaker threshold too high
rate limiter absent
```

---

## 20. Diagnostic Playbook

When debugging Java network call through middleboxes, follow this sequence.

### Step 1 — Identify the Logical Operation

```text
operation name
caller service
callee service
HTTP method/path or gRPC method
correlation id
trace id
time window
expected deadline
```

### Step 2 — Draw the Path

```text
caller pod
sidecar?
egress?
proxy?
LB?
ingress?
gateway?
callee sidecar?
callee pod?
```

### Step 3 — Determine Where the Request Died

Ask:

```text
Did caller send it?
Did local sidecar receive it?
Did gateway receive it?
Did gateway route it?
Did upstream app receive it?
Did upstream app respond?
Did gateway return response?
Did caller receive response?
```

### Step 4 — Compare Timeout Budgets

Collect:

```text
Java client timeout
pool acquisition timeout
gateway timeout
mesh route timeout
mesh per-try timeout
LB idle timeout
backend handler timeout
downstream dependency timeout
```

### Step 5 — Check Retry Layers

Collect:

```text
Java client attempts
mesh attempts
gateway attempts
SDK attempts
job/message retry attempts
```

### Step 6 — Check Connection Lifecycle

Collect:

```text
connection pool active/idle/pending
stale connection errors
LB idle timeout
server keep-alive timeout
HTTP/2 max streams
GOAWAY/RST_STREAM
TCP reset counts
```

### Step 7 — Check Header and Protocol Mutation

Collect:

```text
Host
Forwarded / X-Forwarded-*
traceparent
Authorization
Content-Type
Accept
Transfer-Encoding
Content-Length
grpc-status / trailers
HTTP version at each hop
```

### Step 8 — Decide the Fix Layer

Fix could belong to:

```text
Java client config
Java server config
gateway route policy
LB idle timeout
ingress annotation
service mesh virtual service/destination rule
Kubernetes readiness/lifecycle
certificate/truststore
observability instrumentation
API contract
```

Top-tier engineer fixes at the right layer, not always in application code.

---

## 21. Design Pattern: Intermediary-Aware Java HTTP Client

Pseudo-design:

```java
public final class RemoteOperation<T> {
    private final String service;
    private final String operation;
    private final URI uri;
    private final Duration deadline;
    private final RetryPolicy retryPolicy;
    private final IdempotencyPolicy idempotencyPolicy;
    private final BodyPolicy bodyPolicy;
    private final Map<String, String> semanticHeaders;
}
```

Execution model:

```text
1. Resolve operation policy.
2. Calculate remaining deadline.
3. Acquire concurrency permit/bulkhead.
4. Build request with trace/correlation/idempotency headers.
5. Send attempt with per-attempt timeout.
6. Classify result:
   - origin success
   - origin business error
   - gateway/proxy timeout
   - connection failure
   - rate limit
   - client cancellation
7. Retry only if semantic policy allows.
8. Record attempt metrics and trace attributes.
9. Return typed outcome.
```

Key point:

```text
The wrapper should treat intermediary-generated responses differently from origin-generated domain responses.
```

Example classification:

```text
HTTP 400 from origin -> probably caller/domain error, do not retry
HTTP 409 from origin -> concurrency conflict, domain handling
HTTP 429 from gateway -> obey Retry-After if within budget
HTTP 502 from gateway -> maybe retry safe operation
HTTP 503 with circuit-open metadata -> do not hammer
HTTP 504 from gateway -> retry only if idempotent and budget remains
IOException reset before response -> retry only if request body replayable and operation safe
```

---

## 22. Design Pattern: Gateway-Aware Java Server

A Java service behind gateway should define boundary behavior explicitly.

### 22.1 Request Context Extraction

At request boundary:

```text
correlation id
trace context
authenticated principal
trusted client IP
external scheme
external host
tenant/context
idempotency key
request deadline, if internal
```

Do this once in filter/interceptor, not scattered in controllers.

### 22.2 Deadline Awareness

If internal calls carry deadline:

```text
remainingDeadline = incomingDeadline - now
```

Then downstream calls should use smaller budget.

Do not start expensive work if budget already impossible.

### 22.3 Client Cancellation

If server can detect client disconnect/cancellation, decide:

```text
Cancel work if safe.
Continue work if operation must complete once accepted.
Record cancellation outcome.
Expose final state via async/job resource if needed.
```

In regulatory/case workflow systems, cancellation semantics must be domain-specific. Client timeout does not necessarily mean business transaction should rollback if it has crossed a committed boundary.

---

## 23. Middlebox-Aware API Contract

If API is exposed through gateway, contract should include:

```text
max request size
max response size
timeout/SLA expectation
rate limit behavior
Retry-After behavior
idempotency key support
correlation id support
error format
async operation pattern for long-running work
streaming support or non-support
pagination strategy
file upload protocol
```

Do not hide gateway limits from API consumers. Hidden limits become production incidents.

---

## 24. Regulatory / Case Management Example

Imagine an enforcement lifecycle platform:

```text
Frontend -> Internet Gateway -> Backend API -> Case Service -> Document Service -> Email Service
```

Operation:

```text
Submit enforcement notice with attachments
```

Potential middlebox concerns:

```text
Gateway max body size
Gateway request timeout
Proxy buffering upload
Backend file scan timeout
Document service retry
Email service asynchronous dispatch
Audit trail correlation
User IP correctness
mTLS service identity
Idempotency key for submit action
```

Bad design:

```text
POST /submit
- no idempotency key
- 60MB upload through gateway with 30s timeout
- Java service reads entire file into memory
- gateway buffers full body
- retry from frontend on timeout
- duplicate notice created
- audit shows two submissions
```

Better design:

```text
1. Create draft submission.
2. Upload attachment via resumable/object-storage-backed protocol.
3. Validate attachment asynchronously.
4. Submit with idempotency key.
5. Return 202 Accepted for long-running process.
6. Expose operation status resource.
7. Audit every attempt and final transition separately.
8. Gateway/body/time limits are explicit in contract.
```

This is the difference between endpoint coding and protocol-aware workflow design.

---

## 25. Configuration Checklist

### 25.1 Java Client

```text
[ ] Uses named/reused client per dependency.
[ ] Has explicit connect timeout.
[ ] Has request/deadline timeout.
[ ] Has bounded concurrency/bulkhead.
[ ] Has retry policy only for safe/idempotent operations.
[ ] Emits trace/correlation id.
[ ] Records status by source: origin/proxy/gateway/client.
[ ] Handles 429/503/504 intentionally.
[ ] Handles stale connection safely.
[ ] Does not log secrets.
[ ] Supports proxy config if environment requires it.
[ ] TLS truststore/keystore strategy documented.
```

### 25.2 Java Server

```text
[ ] Correct forwarded header handling.
[ ] Trusted proxy boundary configured.
[ ] Request size limit explicit.
[ ] Header size limit known.
[ ] Timeout/read behavior known.
[ ] Graceful shutdown implemented.
[ ] Readiness reflects traffic acceptance.
[ ] Access logs include correlation/trace id.
[ ] Error mapping distinguishes domain vs infrastructure failure internally.
[ ] Streaming endpoints tested through real proxy path.
```

### 25.3 Gateway / Ingress / LB

```text
[ ] Route rules documented.
[ ] Path rewrite behavior documented.
[ ] Host header behavior documented.
[ ] TLS termination/re-encryption model documented.
[ ] Idle timeout aligned with client/server pools.
[ ] Request timeout aligned with application deadline.
[ ] Retry policy coordinated with app retry.
[ ] Max body size documented.
[ ] Buffering behavior known.
[ ] HTTP/2/gRPC support verified if needed.
[ ] Health check path and semantics correct.
[ ] Draining/deregistration behavior tested.
[ ] Access logs enabled.
```

### 25.4 Service Mesh

```text
[ ] mTLS mode understood.
[ ] Retry policy explicit.
[ ] Timeout policy explicit.
[ ] Circuit breaker thresholds explicit.
[ ] Outlier detection behavior understood.
[ ] gRPC keepalive compatibility checked.
[ ] Telemetry labels/cardinality controlled.
[ ] Sidecar resource limits sized.
[ ] Failure injection tested.
```

---

## 26. Anti-Patterns

### Anti-Pattern 1 — “The Gateway Will Handle Resilience”

Gateway can help, but it does not know domain idempotency. Blind gateway retry can duplicate side effects.

### Anti-Pattern 2 — “Everything Gets 30 Seconds”

Uniform timeout ignores operation class, hop budget, retry, and downstream cost.

### Anti-Pattern 3 — “Trust X-Forwarded-For Everywhere”

Forwarded headers are only trustworthy from trusted proxies.

### Anti-Pattern 4 — “Enable HTTP/2 and Assume Load Balancing Improves”

HTTP/2 multiplexing can reduce connection count and create imbalance if LB is connection-based.

### Anti-Pattern 5 — “Streaming Works Because Java Streams”

Proxy buffering can destroy streaming semantics.

### Anti-Pattern 6 — “504 Means Backend Failed”

504 often means an intermediary gave up waiting. Backend may have succeeded, failed, or never received the request.

### Anti-Pattern 7 — “Service Mesh Means App Does Not Need Timeouts”

Application still needs deadline, cancellation, idempotency, and resource protection.

---

## 27. Practical Decision Matrix

| Problem | Prefer App-Level | Prefer Gateway/LB/Mesh-Level | Reason |
|---|---:|---:|---|
| Domain idempotency | Yes | No | Requires business semantics |
| Authentication at edge | Sometimes | Yes | Central policy useful |
| User authorization | Yes | Sometimes | Often domain/resource-specific |
| TLS termination | Sometimes | Yes | Infra ownership common |
| mTLS service identity | Sometimes | Yes | Mesh/platform can standardize |
| Retry transport reset | Sometimes | Sometimes | Must coordinate |
| Retry POST command | Yes | No | Requires idempotency key |
| Rate limit public API | Sometimes | Yes | Gateway visibility useful |
| Per-tenant business quota | Yes | Sometimes | Domain data required |
| Path routing | No | Yes | Gateway/ingress concern |
| Request schema validation | Sometimes | Sometimes | Depends on contract ownership |
| Circuit breaking dependency | Yes | Sometimes | App knows degradation path |
| Traffic split/canary | No | Yes | Platform routing concern |
| Observability correlation | Yes | Yes | Must be end-to-end |

---

## 28. Exercises

### Exercise 1 — Draw the Hop Map

Choose one real service-to-service call in your system. Draw:

```text
caller
client library
proxy/sidecar
gateway/LB
ingress
callee sidecar
callee app
```

For each hop, write:

```text
protocol
TLS/plaintext
timeout
retry
idle timeout
logs available
metrics available
owner team
```

### Exercise 2 — Timeout Alignment

Given:

```text
Java client timeout = 60s
gateway timeout = 30s
mesh per-try timeout = 10s
mesh attempts = 3
backend DB timeout = 45s
```

Redesign it with explicit end-to-end deadline and retry budget.

### Exercise 3 — 504 Investigation

A user reports intermittent 504 from API gateway. Backend logs sometimes show success after 40s. Gateway timeout is 30s.

Write:

1. likely timeline
2. data to collect
3. short-term mitigation
4. long-term API design fix

### Exercise 4 — gRPC Through Ingress

A gRPC Java client works when calling service directly but fails through ingress with `UNAVAILABLE`.

List at least 10 things to verify.

### Exercise 5 — Forwarded Header Security

Design a safe strategy for extracting original client IP in a Java service behind two proxies.

---

## 29. Summary

Production Java networking is rarely direct.

The application sees:

```text
HTTP status
IOException
gRPC status
timeout
```

But the real system contains:

```text
client pool
proxy
gateway
load balancer
ingress
sidecar
service mesh
server runtime
downstream dependency
```

Each layer may enforce its own policy.

The key mental models from this part:

1. A network call is a chain of hops, not one socket.
2. End-to-end semantics and hop-by-hop mechanics must not be confused.
3. Middleboxes can generate responses, mutate headers, buffer bodies, terminate TLS, retry requests, and close connections.
4. Timeout and retry must be coordinated across layers.
5. Streaming and gRPC require explicit proxy/LB support.
6. Observability must correlate application and intermediary views.
7. Correctness-sensitive behavior like idempotency and domain retry cannot be delegated blindly to infrastructure.

If you can draw the real path, identify policy at each hop, and decide which layer should own each behavior, you move from “Java backend developer” toward “network systems engineer.”

---

## 30. Referensi

- RFC 9110 — HTTP Semantics, especially intermediary concepts.
- RFC 7239 — Forwarded HTTP Extension.
- AWS Elastic Load Balancing documentation — Application Load Balancer attributes and keepalive/idle timeout behavior.
- Kubernetes documentation — Ingress and Ingress Controllers.
- NGINX documentation — `ngx_http_proxy_module`, response buffering, proxy timeouts.
- NGINX Ingress Controller documentation — proxy timeout and buffering annotations.
- HAProxy documentation — client/server/connect timeout concepts.
- Envoy documentation — circuit breaking, retry budgets, upstream route timeout concepts.
- Istio documentation — traffic management, retries, timeouts, circuit breakers.
- OpenTelemetry semantic conventions — HTTP spans, HTTP metrics, tracing conventions.
