# learn-java-servlet-websocket-web-container-runtime-part-028

# Part 028 — Container Configuration: Connectors, Thread Pools, Limits, Timeouts

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Level: Advanced / production engineering  
> Fokus: konfigurasi runtime servlet container sebagai **capacity boundary, protocol boundary, overload boundary, dan failure boundary**.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas Servlet API, request/response lifecycle, async, non-blocking I/O, deployment, classloading, WebSocket, SSE, dan JSP/Jakarta Pages. Sekarang kita turun ke lapisan yang sering dianggap “ops config”, padahal untuk engineer senior/top-tier ini adalah bagian dari desain aplikasi.

Masalah produksi seperti ini jarang murni bug controller:

- tiba-tiba `504 Gateway Timeout`,
- request besar gagal dengan `413 Payload Too Large`,
- header login/SSO gagal dengan `431 Request Header Fields Too Large`,
- thread pool penuh,
- WebSocket putus tiap 60 detik,
- file upload gagal hanya di production,
- CPU rendah tapi latency tinggi,
- database aman tapi app tetap `503`,
- rolling deployment membuat request panjang mati,
- client mendapat broken response karena timeout tidak sejajar,
- container menolak koneksi padahal pod masih hidup.

Semua ini biasanya ada di perpotongan:

```text
client/browser/mobile
  ↓
CDN/WAF/API gateway
  ↓
reverse proxy / ingress / load balancer
  ↓
servlet container connector
  ↓
worker / executor / selector / virtual thread policy
  ↓
application code
  ↓
downstream: DB, Redis, MQ, external API, filesystem
```

Part ini akan membangun mental model konfigurasi container yang cukup kuat untuk:

1. membaca config Tomcat/Jetty/Undertow tanpa sekadar copy-paste,
2. memahami hubungan `maxThreads`, `maxConnections`, `acceptCount`, timeout, dan queue,
3. menyelaraskan timeout antar layer,
4. memilih limit yang defensible untuk header/body/multipart/WebSocket/SSE,
5. memahami kapan bottleneck ada di worker, connector, proxy, kernel, DB pool, atau client,
6. membuat checklist production readiness untuk Servlet/WebSocket runtime.

---

## 1. Mental Model: Container Config adalah Kontrak Kapasitas

Servlet container bukan hanya “server yang menjalankan WAR”. Ia adalah komponen yang mengubah koneksi jaringan menjadi eksekusi aplikasi.

Secara konseptual:

```text
TCP connection accepted
  ↓
HTTP bytes parsed
  ↓
request object built
  ↓
servlet/filter chain selected
  ↓
application code executed
  ↓
response bytes written
  ↓
connection closed or reused
```

Setiap panah memiliki konfigurasi:

| Boundary | Contoh konfigurasi | Risiko jika salah |
|---|---|---|
| Accept connection | backlog, acceptor, max connections | koneksi ditolak, queue menumpuk |
| Parse HTTP | header size, parameter count, URI length | DoS, 400/431, parsing overhead |
| Dispatch request | worker threads, executor, virtual thread mode | latency tinggi, starvation |
| Read body | body size, upload timeout, multipart temp dir | disk full, 413, stuck upload |
| Write response | compression, output buffer, send timeout | broken pipe, memory pressure |
| Keep alive | keep-alive timeout, max keep-alive requests | connection hoarding |
| HTTP/2 | stream concurrency, flow control | head-of-line symptoms, memory use |
| WebSocket/SSE | idle timeout, ping/pong, drain policy | ghost connection, reconnect storm |

Kunci mental model:

> **Container config adalah cara kita menyatakan berapa banyak pekerjaan yang boleh berada di sistem pada saat yang sama, berapa lama pekerjaan boleh menunggu, dan seberapa besar input yang boleh diterima.**

Tanpa batas, sistem bisa mati karena overload. Dengan batas yang salah, sistem bisa menolak traffic valid atau memberi failure yang sulit didiagnosis.

---

## 2. Empat Dimensi Konfigurasi Runtime

Untuk membaca semua config container, pecah menjadi empat dimensi.

### 2.1 Connection capacity

Pertanyaan:

- Berapa koneksi TCP yang boleh terbuka?
- Berapa koneksi idle keep-alive yang boleh disimpan?
- Berapa koneksi WebSocket/SSE long-lived yang boleh dipertahankan?

Contoh parameter:

- `maxConnections`,
- accept backlog,
- selector count,
- idle timeout,
- keep-alive timeout,
- HTTP/2 stream limit.

### 2.2 Execution capacity

Pertanyaan:

- Berapa request yang bisa dieksekusi application code bersamaan?
- Apakah modelnya platform thread, virtual thread, async, event loop, atau kombinasi?
- Apakah request blocking akan menghabiskan worker?

Contoh parameter:

- `maxThreads`,
- executor size,
- queue size,
- virtual thread executor,
- reserved threads,
- async executor.

### 2.3 Input limits

Pertanyaan:

- Seberapa besar header boleh diterima?
- Seberapa besar body/multipart boleh diterima?
- Berapa parameter boleh diparse?
- Berapa panjang URI/query string boleh diterima?

Contoh parameter:

- max header size,
- max post size,
- max swallow size,
- multipart max request size,
- multipart file size,
- max parameter count,
- max cookie count,
- request line limit.

### 2.4 Time limits

Pertanyaan:

- Berapa lama koneksi boleh idle?
- Berapa lama container menunggu request selesai dikirim client?
- Berapa lama app boleh memproses?
- Berapa lama async request boleh terbuka?
- Berapa lama WebSocket/SSE boleh idle?

Contoh parameter:

- connection timeout,
- keep-alive timeout,
- request header timeout,
- async timeout,
- proxy read timeout,
- backend idle timeout,
- graceful shutdown timeout.

---

## 3. Connector: Gerbang dari Network ke Servlet Runtime

Connector adalah komponen container yang mendengarkan port/protocol tertentu dan meneruskan request ke engine/container internal.

Pada Tomcat, HTTP Connector adalah komponen yang mendukung HTTP/1.1, membuat Tomcat bisa berfungsi sebagai web server standalone sekaligus menjalankan Servlet/JSP. Connector mendengarkan koneksi pada port tertentu dan meneruskan request ke Engine untuk diproses.

Secara konseptual:

```text
Connector
  ├─ bind address / port
  ├─ protocol handler
  ├─ acceptor(s)
  ├─ poller / selector(s)
  ├─ executor / worker threads
  ├─ parser limits
  ├─ connection timeout
  ├─ keep-alive policy
  └─ TLS / HTTP/2 options
```

### 3.1 Connector bukan servlet

Servlet code baru berjalan setelah connector:

1. menerima koneksi,
2. membaca bytes,
3. memvalidasi request line/header,
4. memilih host/context,
5. memilih mapping servlet/filter,
6. menyediakan `HttpServletRequest` dan `HttpServletResponse`.

Jika request gagal di connector, kode servlet tidak pernah dipanggil.

Contoh:

- header terlalu besar → gagal sebelum filter,
- URI malformed → gagal sebelum servlet,
- TLS handshake gagal → tidak pernah masuk HTTP,
- connection timeout saat client lambat → tidak pernah menjadi controller call,
- body terlalu besar di proxy → app tidak tahu request pernah ada.

### 3.2 Multi connector

Satu container bisa punya beberapa connector:

```text
:8080 HTTP internal
:8443 HTTPS direct
:8009 AJP legacy/internal
```

Dalam cloud/container modern biasanya hanya satu HTTP connector internal, karena TLS dilakukan di load balancer/ingress:

```text
client HTTPS
  ↓
ALB / ingress terminates TLS
  ↓
HTTP to pod :8080
  ↓
Tomcat connector
```

Namun ini membuat header `Forwarded` / `X-Forwarded-*` menjadi penting agar aplikasi tahu scheme asli adalah `https`, bukan `http`.

---

## 4. Acceptors, Selectors, Workers: Jangan Campur Kapasitas Network dan Kapasitas Application

Container modern biasanya memisahkan pekerjaan:

```text
acceptor thread
  receives new connections

selector / poller thread
  monitors many sockets for readiness

worker / executor thread
  runs application code or blocking processing
```

Jetty misalnya memakai `QueuedThreadPool`, dan thread pool tersebut digunakan oleh connector; untuk tiap connector, thread dapat disewa untuk acceptor dan selector. Detail implementasi berbeda antar container, tetapi prinsipnya sama: tidak semua thread adalah request worker.

### 4.1 Acceptor

Acceptor menerima koneksi baru dari OS backlog.

Masalah umum:

- acceptor terlalu sedikit jarang jadi bottleneck utama kecuali traffic ekstrem,
- OS backlog penuh menyebabkan connection refused/timeout,
- SYN backlog vs application accept queue sering disalahpahami.

### 4.2 Selector / poller

Selector/poller memantau banyak socket non-blocking.

Ia menjawab pertanyaan:

- socket mana siap dibaca,
- socket mana siap ditulis,
- koneksi mana timeout,
- request mana perlu worker.

### 4.3 Worker thread

Worker menjalankan aplikasi:

```text
filter.doFilter()
  ↓
servlet.service()
  ↓
framework dispatcher
  ↓
controller/resource/handler
  ↓
DB/API/cache calls
```

Jika worker habis, aplikasi masih bisa menerima koneksi pada level network, tetapi request tidak segera diproses.

### 4.4 Kesalahan mental model umum

Salah:

```text
maxConnections = jumlah request yang bisa diproses bersamaan
```

Lebih tepat:

```text
maxConnections = jumlah koneksi yang bisa terbuka / dikelola
maxThreads/executor = jumlah unit eksekusi blocking/application yang bisa berjalan
DB pool = jumlah query DB yang bisa aktif
HTTP client pool = jumlah panggilan downstream yang bisa aktif
```

Kapasitas efektif request biasanya minimum dari semua resource penting:

```text
effective_concurrency ≈ min(
  worker_capacity,
  DB_connection_pool,
  downstream_HTTP_pool,
  CPU_capacity_for_CPU_bound_work,
  rate_limit_downstream,
  memory_capacity_for_inflight_requests
)
```

---

## 5. Tomcat Configuration Mental Model

Tomcat sering ditemui di Spring Boot, WAR legacy, dan banyak Jakarta/Spring deployment. Jangan hafal parameter secara isolasi; pahami relasinya.

Contoh connector konseptual:

```xml
<Connector
    port="8080"
    protocol="org.apache.coyote.http11.Http11NioProtocol"
    maxThreads="200"
    maxConnections="8192"
    acceptCount="100"
    connectionTimeout="20000"
    keepAliveTimeout="15000"
    maxKeepAliveRequests="100"
    maxHttpHeaderSize="16384"
    compression="on"
/>
```

Nama parameter bisa berbeda antar versi/protocol handler, jadi selalu cek dokumentasi versi container yang dipakai.

### 5.1 `maxThreads`

`maxThreads` membatasi jumlah worker thread request processing jika connector memakai internal executor.

Implikasi:

- terlalu kecil → request queue, latency tinggi, 503/timeout upstream,
- terlalu besar → context switching, memory stack, DB pool exhaustion, downstream overload,
- menaikkan `maxThreads` tanpa menaikkan DB pool belum tentu menambah throughput.

Contoh salah:

```text
DB pool = 30
maxThreads = 500
Setiap request butuh DB rata-rata 1 query blocking
```

Hasil:

- 30 thread melakukan query,
- 470 thread bisa menunggu DB connection,
- memory naik,
- latency naik,
- throughput tidak naik signifikan,
- timeout menjadi lebih kacau.

Lebih baik:

```text
maxThreads disesuaikan dengan:
- DB pool,
- external API pool,
- CPU,
- request mix,
- timeout budget,
- target tail latency.
```

### 5.2 `maxConnections`

`maxConnections` adalah batas koneksi yang dapat diterima/dikelola. Untuk HTTP keep-alive, satu koneksi bisa idle sambil menunggu request berikutnya.

Koneksi tidak sama dengan request aktif.

```text
1000 maxConnections
200 maxThreads
```

Bisa berarti:

- 1000 koneksi terbuka,
- maksimal sekitar 200 request blocking aktif,
- sisanya idle/menunggu/dikelola selector.

Untuk WebSocket/SSE, koneksi long-lived memakai kapasitas connection jauh lebih lama daripada request HTTP biasa.

### 5.3 `acceptCount`

`acceptCount` adalah backlog queue ketika semua worker/koneksi sedang sibuk pada sisi connector.

Mental model sederhana:

```text
incoming connection
  ↓
if current connections < maxConnections: accept/manage
else if accept queue not full: wait in accept queue
else: refuse / timeout depending OS/client/proxy
```

Jangan jadikan `acceptCount` sebagai “buffer ajaib”. Queue yang terlalu besar dapat membuat client menunggu lama sampai timeout, sementara sistem sebenarnya overload.

Prinsip:

- queue pendek → fail fast, lebih mudah autoscale/retry,
- queue panjang → menyerap burst, tetapi tail latency bisa buruk,
- queue harus sesuai SLO dan retry behavior client.

### 5.4 `connectionTimeout`

`connectionTimeout` biasanya terkait waktu menunggu request data setelah koneksi diterima.

Jika terlalu tinggi:

- slowloris-like client bisa menahan connection,
- resource terikat lama.

Jika terlalu rendah:

- client lambat/jaringan buruk bisa gagal.

Dalam production di belakang proxy, client langsung biasanya adalah proxy/ingress, bukan browser. Maka timeout internal bisa lebih agresif dibanding public edge.

### 5.5 `keepAliveTimeout`

Keep-alive memungkinkan koneksi dipakai ulang untuk banyak request.

Manfaat:

- mengurangi TCP/TLS setup,
- mengurangi latency,
- efisien untuk browser/API client.

Risiko:

- koneksi idle terlalu lama menghabiskan connection slot,
- mismatch dengan proxy menyebabkan connection reset saat reuse,
- WebSocket/SSE butuh kebijakan berbeda.

Prinsip umum:

```text
edge keep-alive timeout >= upstream keep-alive timeout
```

atau setidaknya alignment jelas agar proxy tidak mencoba reuse koneksi backend yang sudah ditutup container.

### 5.6 Header size

Header size menentukan ukuran maksimum request header yang diterima.

Penyebab header besar:

- cookie session besar,
- JWT besar,
- banyak cookie analytics,
- SSO headers dari proxy,
- tracing headers,
- `Forwarded` chain panjang,
- custom metadata headers.

Risiko menaikkan terlalu besar:

- memory per connection/request naik,
- request smuggling/DoS surface membesar,
- menyembunyikan masalah cookie bloat.

Jika perlu menaikkan header limit, audit dulu:

```text
Cookie total size
Authorization header size
X-Forwarded-* chain length
tracing baggage
proxy header limit
container header limit
framework/security filter behavior
```

---

## 6. Jetty Configuration Mental Model

Jetty banyak dipakai sebagai embedded server, standalone server, dan server protocol-rich. Jetty sangat eksplisit tentang threading dan connectors.

Konsep penting:

```text
Server
  ├─ ThreadPool
  ├─ Connectors
  │   ├─ acceptors
  │   ├─ selectors
  │   └─ connection factories
  └─ Handlers / ServletContextHandler
```

Jetty documentation menekankan arsitektur threading; `QueuedThreadPool` dipakai oleh beberapa komponen termasuk connectors, acceptors, selectors, dan reserved executor.

### 6.1 Jetty thread pool bukan hanya request handler

Karena thread pool juga dipakai oleh komponen internal, jangan set maksimum thread terlalu ketat tanpa memahami kebutuhan acceptor/selector/reserved threads.

Gejala salah config:

- server terlihat hidup tapi tidak responsif,
- selector starvation,
- request stuck,
- thread dump penuh internal Jetty task,
- low throughput walau CPU belum penuh.

### 6.2 Reserved threads

Jetty memiliki konsep reserved threads untuk menghindari starvation pada skenario tertentu. Detailnya tergantung versi, tetapi mental modelnya:

```text
semua thread sibuk menjalankan work blocking
  ↓
internal protocol task tetap butuh thread
  ↓
reserved thread membantu progress agar tidak deadlock/starve
```

Pelajaran lebih umum:

> Thread pool container tidak boleh dipahami hanya sebagai “jumlah controller concurrent”. Ada internal protocol work yang juga butuh eksekusi.

### 6.3 Connection factories

Jetty memisahkan connector dari protocol melalui connection factory:

- HTTP/1.1,
- HTTP/2,
- SSL/TLS,
- ALPN,
- WebSocket layer.

Ini berguna untuk memahami bahwa HTTP/2 bukan sekadar “aktifkan boolean”; ia mengubah multiplexing, stream concurrency, flow control, dan buffer behavior.

---

## 7. Undertow Configuration Mental Model

Undertow dikenal sebagai web server berbasis non-blocking I/O, dipakai di WildFly dan pernah populer di beberapa stack embedded.

Undertow listener adalah entry point aplikasi; listener menerjemahkan incoming request menjadi `HttpServerExchange` lalu mengirim response kembali ke client.

Konsep utama:

```text
Undertow server
  ├─ listeners: HTTP, HTTPS, AJP, HTTP/2
  ├─ I/O threads
  ├─ worker threads
  ├─ handlers
  └─ servlet deployment integration
```

### 7.1 I/O thread vs worker thread

Undertow sangat menekankan perbedaan:

- I/O thread tidak boleh diblokir lama,
- blocking operation harus dispatch ke worker thread,
- handler chain bisa sangat cepat jika non-blocking.

Salah satu anti-pattern:

```java
// pseudo-code: menjalankan blocking DB/file/API call di I/O thread
exchange.getResponseSender().send(expensiveBlockingCall());
```

Dalam servlet integration, framework biasanya menangani banyak dispatch, tetapi konsep ini tetap penting jika memakai Undertow handler langsung atau custom integration.

### 7.2 Parser limits sebagai DoS boundary

Undertow exposes options seperti maksimum parameter yang diparse untuk mencegah hash-style parameter abuse. Mental modelnya berlaku untuk semua container:

```text
parameter count limit bukan UX feature,
melainkan proteksi CPU/memory parser.
```

---

## 8. Configuration Categories yang Harus Selalu Dipikirkan

Bagian ini lebih penting daripada sintaks container tertentu.

## 8.1 Port, address, scheme

Pertanyaan:

- Container bind ke `0.0.0.0` atau `127.0.0.1`?
- Port internal sama dengan port external?
- TLS terminate di app atau di proxy?
- Aplikasi tahu scheme asli `https`?

Di Kubernetes biasanya:

```text
containerPort: 8080
servicePort: 80
ingress: 443 HTTPS
```

Maka dari sisi servlet:

```java
request.getScheme()        // mungkin "http"
request.isSecure()         // mungkin false
request.getServerPort()    // mungkin 8080
```

Padahal user melihat:

```text
https://app.example.com
```

Solusi biasanya di layer container/framework/proxy:

- configure forwarded header support,
- trusted proxy list,
- canonical host/scheme rules,
- avoid trusting arbitrary `X-Forwarded-*` dari public client.

## 8.2 Host/header canonicalization

Jika app menghasilkan absolute URL:

- redirect URL,
- email link,
- OAuth callback,
- SSO redirect,
- WebSocket URL,
- download link,

maka host/scheme/port harus benar.

Bug umum:

```text
User opens https://example.com/app
App redirects to http://10.0.3.21:8080/app/login
```

Penyebab:

- app membaca connector internal,
- forwarded headers tidak diproses,
- proxy tidak mengirim header,
- app mempercayai wrong host.

---

## 9. Thread Pool Sizing: Bukan “Semakin Besar Semakin Baik”

Thread pool sizing harus dimulai dari workload.

### 9.1 Formula kasar Little’s Law

Little’s Law:

```text
L = λ × W
```

Artinya:

```text
concurrency ≈ throughput_per_second × average_latency_seconds
```

Jika target:

```text
100 requests/second
average service time 200 ms = 0.2 s
```

Maka rata-rata concurrency:

```text
L = 100 × 0.2 = 20 concurrent requests
```

Tetapi untuk tail latency dan burst, butuh headroom.

Misal:

```text
average concurrency: 20
p95 service time: 800 ms
burst: 2x
```

Kapasitas worker mungkin perlu:

```text
100 rps × 0.8s × 2 = 160 active request capacity
```

Namun ini harus dibandingkan dengan DB pool/downstream.

### 9.2 Blocking workload

Jika request melakukan blocking I/O:

```text
request thread waits for DB/API/cache/file
```

Thread count perlu cukup untuk menutup waktu tunggu, tetapi tidak boleh melampaui downstream secara brutal.

Contoh:

```text
maxThreads = 200
DB pool = 50
External API pool = 50
```

Jika setiap request butuh DB dan API, efektif bottleneck bisa 50, bukan 200.

### 9.3 CPU-bound workload

Jika request CPU-heavy:

- JSON besar,
- PDF generation,
- encryption/signature,
- image processing,
- report aggregation,
- heavy serialization,

maka terlalu banyak thread justru membuat CPU context switching.

Rule of thumb:

```text
CPU-bound concurrency ≈ number_of_cores × small_factor
```

CPU-bound heavy work lebih baik:

- offload ke worker/batch queue,
- batasi parallelism,
- gunakan backpressure,
- jangan biarkan semua servlet threads habis untuk report berat.

### 9.4 Virtual threads

Virtual threads mengubah biaya thread blocking, tetapi tidak menghapus bottleneck downstream.

Benar:

```text
virtual threads membantu saat banyak blocking I/O dan downstream mampu melayani
```

Salah:

```text
virtual threads membuat DB pool 30 bisa melayani 3000 query aktif
```

Untuk servlet container yang mendukung virtual thread executor, kapasitas tetap harus dikontrol dengan:

- DB pool,
- outbound HTTP pool,
- semaphore/bulkhead,
- rate limit,
- timeout,
- memory per request,
- queue bound.

---

## 10. Connection Sizing: HTTP, Keep-Alive, WebSocket, SSE

### 10.1 HTTP short request

Untuk API request biasa:

```text
koneksi dibuka / reuse
request diproses
response dikirim
koneksi idle / close
```

Connection count biasanya lebih besar dari active request count karena keep-alive.

### 10.2 Keep-alive connection

Keep-alive mengurangi overhead, tetapi idle connection tetap memakai resource.

Yang perlu diperhatikan:

- banyak browser tab,
- mobile network reconnect,
- proxy connection pooling,
- backend service-to-service pooling,
- idle timeout mismatch.

### 10.3 WebSocket

WebSocket menggunakan satu koneksi long-lived.

Jika ada 20.000 user online:

```text
20.000 WebSocket connections
```

Walau message rendah, connection capacity, memory, heartbeat, load balancer idle timeout, dan cluster registry menjadi isu.

### 10.4 SSE

SSE juga connection long-lived, biasanya satu arah dari server ke browser.

Perbedaannya:

- berbasis HTTP response streaming,
- reconnect via browser `EventSource`,
- bisa terpengaruh proxy buffering,
- HTTP/1.1 per-origin connection limit perlu dipertimbangkan.

### 10.5 Jangan campur traffic profile

Satu connector melayani:

- REST API cepat,
- upload besar,
- download besar,
- SSE,
- WebSocket upgrade,
- admin report,
- health check.

Jika semua memakai pool/limit yang sama, workload berat bisa mengganggu workload ringan.

Strategi:

- pisahkan endpoint berat,
- gunakan rate limit,
- dedicated executor jika container/framework mendukung,
- dedicated service untuk WebSocket/SSE,
- separate ingress path dengan timeout berbeda,
- bulkhead di aplikasi.

---

## 11. Queue dan Backpressure

Overload tidak hilang dengan queue; overload hanya pindah tempat.

### 11.1 Tempat queue bisa muncul

```text
client retry queue
  ↓
CDN/WAF queue
  ↓
LB pending request
  ↓
OS TCP backlog
  ↓
container accept queue
  ↓
executor queue
  ↓
framework async queue
  ↓
DB pool wait queue
  ↓
external API queue
```

Jika semua layer punya queue besar, failure menjadi lambat dan mahal.

### 11.2 Queue panjang vs fail fast

Queue panjang cocok untuk:

- burst singkat,
- request murah,
- client sabar,
- ordering penting,
- downstream cepat pulih.

Fail fast cocok untuk:

- interactive API,
- strict SLO,
- retryable operation,
- autoscaling signal,
- mencegah cascading failure.

### 11.3 Backpressure contract

Backpressure harus eksplisit:

- return `429 Too Many Requests` untuk rate limit,
- return `503 Service Unavailable` untuk overload sementara,
- gunakan `Retry-After` jika masuk akal,
- reject upload besar lebih awal,
- close slow WebSocket client dengan alasan jelas,
- jangan menerima unlimited async work.

---

## 12. Timeout Alignment: Salah Satu Penyebab Terbesar 504

Timeout harus dibaca sebagai chain.

Contoh chain:

```text
Browser timeout:              variable
CDN/WAF timeout:              60s
Load balancer idle timeout:   60s
Ingress proxy read timeout:   60s
App connector timeout:        20s / idle
Servlet async timeout:        30s
DB query timeout:             25s
HTTP client timeout:          10s
Business operation target:    5s
```

Jika tidak sejajar, muncul gejala:

- proxy memberi `504` tapi app masih bekerja,
- app menulis response setelah client/proxy disconnect,
- DB query masih berjalan setelah HTTP request gagal,
- client retry membuat duplicate operation,
- log app menunjukkan success tapi user melihat failure.

### 12.1 Prinsip timeout budget

Mulai dari user-facing SLO.

Misal target API:

```text
p95 < 2s
hard client timeout 10s
```

Maka timeout budget bisa:

```text
controller total budget: 8s
DB query timeout: 3s
external API timeout: 2s
internal queue wait: 500ms
proxy read timeout: 10s
app async timeout: 9s
client timeout: 11s
```

Prinsip:

```text
inner timeout should usually be shorter than outer timeout
```

Agar app bisa mengembalikan error terkontrol sebelum proxy memotong koneksi.

### 12.2 Kapan proxy timeout lebih pendek?

Kadang sengaja:

- edge ingin melindungi resource,
- request berat harus async/job-based,
- user tidak boleh menunggu lama.

Tapi kalau demikian, aplikasi harus tahu dan desain endpoint harus sesuai.

Jangan biarkan endpoint sinkron 5 menit di belakang proxy timeout 60 detik.

### 12.3 Timeout untuk upload

Upload punya dua fase:

```text
client sends body
  ↓
server/app processes body
```

Timeout yang relevan:

- header read timeout,
- body read timeout,
- proxy request body timeout,
- app multipart parsing timeout,
- storage write timeout,
- malware scanning timeout.

Client lambat bisa menahan koneksi lama. Untuk public endpoint, ini harus dibatasi.

### 12.4 Timeout untuk WebSocket

WebSocket punya idle timeout, bukan request timeout.

Perlu align:

```text
application heartbeat interval < proxy idle timeout < app hard stale connection timeout
```

Contoh:

```text
heartbeat every 25s
LB idle timeout 60s
server stale timeout 90s
client reconnect after missing 2 heartbeats
```

---

## 13. Header, URI, Parameter, dan Cookie Limits

### 13.1 Request header size

Header terlalu besar bisa menghasilkan:

- `400 Bad Request`,
- `431 Request Header Fields Too Large`,
- connection close tanpa response jelas,
- proxy-level rejection.

Penyebab utama di enterprise:

```text
Cookie: JSESSIONID=...; SSO=...; analytics=...; preferences=...; appstate=...
Authorization: Bearer very-large-jwt
X-Forwarded-For: long chain
traceparent/baggage: many values
```

### 13.2 Cookie bloat

Cookie dikirim pada setiap request ke domain/path terkait.

Jika aplikasi menyimpan state besar di cookie:

- semua static/API request membawa overhead,
- header parsing lebih mahal,
- proxy/container limit cepat kena,
- mobile latency naik.

Prinsip:

```text
cookie should identify state, not contain large state
```

### 13.3 URI/query limit

Query string besar biasanya tanda desain API buruk.

Contoh buruk:

```text
GET /search?ids=1,2,3,...10000
```

Risiko:

- URI too long,
- proxy limit beda dari app limit,
- access log besar,
- sensitive data bocor di log/history,
- cache key buruk.

Gunakan POST dengan body untuk request kompleks yang tidak cocok sebagai resource query sederhana.

### 13.4 Parameter count limit

Parameter count limit melindungi parser dari CPU/memory abuse.

Serangan klasik:

```text
?a1=x&a2=x&a3=x...a100000=x
```

Jangan menaikkan limit tanpa memahami form yang valid.

---

## 14. Body Size, Multipart, dan Upload Limits

Request body limit bisa ada di banyak layer:

```text
browser/client
  ↓
CDN/WAF max body
  ↓
LB/ingress max body
  ↓
reverse proxy max body
  ↓
container max body/post size
  ↓
framework multipart config
  ↓
application validation
  ↓
storage quota
```

Jika user upload 50 MB tetapi proxy limit 10 MB, servlet tidak akan melihat request.

### 14.1 Align limit dengan user contract

Misal requirement:

```text
max upload file = 20 MB
max files per request = 5
max request = 100 MB
```

Maka config harus konsisten:

```text
WAF/CDN limit >= 100 MB + overhead
Ingress body limit >= 100 MB + overhead
Container request body limit >= 100 MB + overhead
Multipart maxRequestSize = 100 MB
Multipart maxFileSize = 20 MB
Application validation = 20 MB per file, max 5 files
Storage quota/check = explicit
```

### 14.2 Temp storage

Multipart sering memakai temp file jika melewati threshold.

Risiko:

- temp disk penuh,
- file leak setelah exception,
- concurrent upload menghabiskan ephemeral storage,
- Kubernetes pod evicted karena ephemeral storage usage.

Sizing kasar:

```text
max concurrent uploads × max request size × safety factor
```

Jika:

```text
20 concurrent uploads × 100 MB = 2 GB
```

Dengan overhead dan retries, ephemeral storage 2 GB tidak cukup defensible.

### 14.3 Reject early vs after buffering

Idealnya request besar ditolak sedekat mungkin dengan edge:

```text
WAF/proxy rejects huge body
```

Tetapi error UX/API consistency mungkin perlu app-level validation.

Trade-off:

- edge reject lebih murah,
- app reject lebih kaya error semantics,
- keduanya perlu konsisten.

---

## 15. Response Buffer, Compression, dan Large Response

### 15.1 Response buffer

Response buffer memberi container kesempatan:

- mengatur header sebelum commit,
- menghitung content length jika kecil,
- menghindari small writes terlalu banyak.

Jika buffer terlalu kecil:

- response cepat committed,
- error handling setelah partial write sulit,
- banyak flush kecil.

Jika buffer terlalu besar:

- memory per active response naik.

### 15.2 Compression

Compression mengurangi bandwidth, tetapi memakai CPU dan bisa memperburuk latency untuk payload kecil.

Cocok untuk:

- JSON besar,
- HTML/CSS/JS text,
- text/event-stream dengan hati-hati,
- API response besar.

Tidak cocok/kurang berguna untuk:

- already compressed files: zip, jpg, png, pdf tertentu,
- tiny payload,
- streaming yang butuh flush real-time jika compression buffering menghambat.

Security caveat:

- compression + secret reflected content bisa terkait kelas serangan seperti BREACH pada konteks tertentu,
- jangan asal compress response yang mengandung secret dan attacker-controlled reflection.

### 15.3 Download besar

Untuk download besar:

- hindari memuat seluruh file ke memory,
- gunakan streaming,
- set `Content-Disposition`,
- set `Content-Type` aman,
- pertimbangkan `Content-Length`,
- dukung range request jika media/large file,
- pertimbangkan offload ke object storage signed URL.

### 15.4 Proxy buffering

Reverse proxy bisa buffer response.

Untuk SSE/streaming, buffering dapat membuat client tidak menerima event sampai buffer penuh.

Perlu config:

- disable buffering untuk path SSE,
- flush heartbeat,
- content type tepat,
- proxy timeout sesuai.

---

## 16. HTTP/2 Configuration

HTTP/2 mengubah karakteristik koneksi.

HTTP/1.1:

```text
1 TCP connection handles requests sequentially unless multiple connections used
```

HTTP/2:

```text
1 TCP connection can multiplex multiple streams
```

Implikasi:

- `maxConnections` tidak lagi berbanding langsung dengan active request,
- satu koneksi bisa membawa banyak concurrent streams,
- flow control penting,
- header compression mengubah memory/security considerations,
- server push historis ada tetapi tidak selalu berguna dan banyak browser/platform mengurangi/meninggalkan manfaat praktisnya.

Jakarta Servlet 6.1 menyebut container dapat mendukung HTTP/2 server push jika client mendukung dan tidak mematikan server push. Namun di praktik modern, HTTP/2 server push jarang menjadi strategi utama; preload/resource hints/CDN strategy sering lebih realistis.

### 16.1 HTTP/2 stream concurrency

Limit penting:

```text
max concurrent streams per connection
```

Jika terlalu tinggi:

- satu client/proxy bisa memberi banyak work,
- memory per connection naik,
- fairness antar client turun.

Jika terlalu rendah:

- multiplexing benefit turun,
- browser/proxy harus membuka koneksi tambahan atau menunggu.

### 16.2 HTTP/2 behind proxy

Banyak deployment:

```text
client --HTTP/2--> ALB/ingress --HTTP/1.1--> app
```

atau:

```text
client --HTTP/2--> proxy --HTTP/2--> app
```

Jangan mengasumsikan app connector menerima HTTP/2 hanya karena public endpoint HTTP/2.

Checklist:

- HTTP/2 di edge?
- HTTP/2 ke backend?
- TLS/ALPN di mana?
- WebSocket support di path yang sama?
- stream timeout vs request timeout?
- access log menunjukkan protocol apa?

---

## 17. TLS at Container vs TLS at Proxy

### 17.1 TLS at proxy

Umum di Kubernetes/cloud:

```text
client HTTPS
  ↓
LB/ingress terminates TLS
  ↓
HTTP to app pod
```

Kelebihan:

- certificate management terpusat,
- offload CPU TLS,
- WAF/CDN integration,
- simpler app container.

Risiko:

- app melihat `http` kecuali forwarded headers diproses,
- secure cookie generation salah,
- redirect URL salah,
- `isSecure()` false,
- absolute URL OAuth/SSO salah.

### 17.2 TLS at app container

Kadang diperlukan untuk:

- mTLS end-to-end,
- strict internal encryption,
- legacy direct deployment,
- compliance isolation.

Konsekuensi:

- certificate/key rotation di app layer,
- ALPN config untuk HTTP/2,
- keystore/truststore config,
- reload strategy,
- startup failure jika secret invalid.

### 17.3 Re-encryption

Model:

```text
client HTTPS
  ↓
LB terminates TLS
  ↓
LB opens HTTPS to app
```

Digunakan saat internal network juga harus encrypted.

Tetap butuh forwarded headers agar app tahu external host/scheme yang benar.

---

## 18. Access Log dan Error Report

### 18.1 Access log bukan application log

Access log menjawab:

- request apa yang masuk,
- status code apa yang keluar,
- berapa byte,
- berapa durasi,
- client/proxy IP,
- user-agent,
- path,
- protocol.

Application log menjawab:

- business operation apa,
- correlation id,
- user/entity id,
- validation/business failure,
- downstream call,
- stack trace.

Keduanya harus bisa di-correlate.

### 18.2 Minimum useful access log fields

Untuk production, access log sebaiknya punya:

```text
timestamp
remote address / forwarded client IP
method
path/query policy
status
response bytes
duration
protocol
user-agent
request id / trace id
host
referer optional
```

Hati-hati query string karena bisa mengandung sensitive data.

### 18.3 Error report page

Default container error page sering membocorkan:

- server version,
- stack trace,
- implementation detail,
- internal path.

Production harus:

- custom error page/JSON,
- hide server banner jika memungkinkan,
- align app/proxy error response,
- tetap log cause internal.

---

## 19. Health, Readiness, and Graceful Shutdown at Container Level

### 19.1 Liveness vs readiness

Liveness:

```text
Should this process be restarted?
```

Readiness:

```text
Should this instance receive traffic?
```

Jangan pakai health check yang sama secara naif.

Contoh buruk:

```text
/liveness checks DB and fails during DB maintenance
→ Kubernetes restarts all pods
→ outage worsens
```

Liveness harus minimal. Readiness boleh cek dependency kritikal, tetapi perlu hati-hati agar tidak membuat cascading removal.

### 19.2 Startup probe

Aplikasi Java besar bisa butuh waktu startup karena:

- classloading,
- framework initialization,
- migration/checks,
- cache warmup,
- JIT warmup,
- connection pool initialization.

Startup probe mencegah liveness membunuh app yang belum selesai start.

### 19.3 Graceful shutdown

Saat shutdown:

```text
mark not ready
  ↓
stop receiving new traffic
  ↓
wait load balancer drain
  ↓
finish in-flight requests
  ↓
close WebSocket/SSE politely
  ↓
stop background executors
  ↓
close pools/resources
  ↓
exit
```

Timeout harus align:

```text
Kubernetes terminationGracePeriodSeconds
preStop sleep/drain
LB deregistration delay
container graceful shutdown timeout
app async timeout
max request duration
WebSocket close grace
```

Jika tidak align:

- pod mati saat request masih berjalan,
- client melihat connection reset,
- duplicate retry,
- WebSocket reconnect storm saat rolling update.

---

## 20. WebSocket/SSE-Specific Container Configuration

### 20.1 Idle timeout

Untuk WebSocket/SSE, request timeout biasa tidak relevan. Yang relevan:

- idle timeout,
- ping/pong heartbeat,
- proxy read timeout,
- LB idle timeout,
- app stale connection timeout.

Jika LB idle timeout 60s dan app heartbeat 120s, koneksi akan diputus sebelum heartbeat.

### 20.2 Max message size

WebSocket perlu limit:

- max text message size,
- max binary message size,
- max frame size jika tersedia,
- max sessions per user/IP,
- outbound queue size.

Tanpa limit, satu client bisa mengirim payload besar atau membuat server menumpuk message.

### 20.3 Upgrade header path

Proxy/ingress harus meneruskan:

```text
Connection: Upgrade
Upgrade: websocket
```

Jika tidak:

- handshake gagal,
- endpoint tidak pernah dipanggil,
- client melihat 400/404/502,
- container tampak normal.

### 20.4 Sticky sessions

Jika WebSocket session state node-local:

- initial connection harus sampai ke node tertentu,
- setelah connection established, koneksi tetap ke node yang sama,
- reconnect bisa ke node lain sehingga state harus bisa dipulihkan.

Jangan mengandalkan sticky session sebagai satu-satunya correctness mechanism untuk presence/subscription penting.

---

## 21. Capacity Planning by Workload Type

### 21.1 CRUD API cepat

Karakteristik:

- small body,
- short DB transaction,
- response kecil,
- SLO rendah.

Prioritas config:

- worker threads sesuai DB pool,
- short request timeout,
- keep-alive enabled,
- header/body limit ketat,
- access log duration,
- fail fast overload.

### 21.2 Report generation sync

Karakteristik:

- CPU/DB heavy,
- response besar,
- durasi panjang.

Lebih baik:

- async job model,
- polling/SSE progress,
- signed download,
- dedicated worker queue,
- strict concurrency limit.

Jika tetap sync:

- timeout chain harus sengaja,
- worker isolation,
- response streaming,
- cancellation handling.

### 21.3 File upload

Prioritas:

- body/multipart limit align,
- temp storage capacity,
- upload timeout,
- virus scan/quarantine,
- checksum,
- cleanup,
- storage error handling.

### 21.4 WebSocket notification

Prioritas:

- max connections,
- heartbeat < LB idle timeout,
- bounded outbound queue,
- slow client close,
- presence cleanup,
- broker fan-out if clustered,
- graceful rolling drain.

### 21.5 SSE dashboard

Prioritas:

- proxy buffering off,
- heartbeat comment,
- reconnect `Last-Event-ID`,
- per-user stream limit,
- HTTP/2 behavior,
- backend pub-sub.

---

## 22. Common Misconfigurations and Symptoms

## 22.1 `504 Gateway Timeout` tetapi app log sukses

Kemungkinan:

- proxy timeout lebih pendek dari app processing,
- app masih bekerja setelah proxy disconnect,
- response write gagal tapi business operation sudah commit,
- client retry menghasilkan duplicate operation.

Fix:

- inner timeout lebih pendek,
- idempotency key,
- async job untuk operasi panjang,
- cancellation propagation,
- log client abort/broken pipe.

## 22.2 CPU rendah, latency tinggi

Kemungkinan:

- thread menunggu DB pool,
- worker pool queue,
- downstream API lambat,
- connection pool exhausted,
- lock contention,
- request queue terlalu panjang.

Jangan langsung menaikkan CPU.

Check:

```text
active threads
executor queue
DB pool active/wait
outbound HTTP pool
thread dump
p95/p99 dependency latency
```

## 22.3 Banyak `Broken pipe` / `Connection reset`

Kemungkinan:

- client/proxy timeout duluan,
- user cancel download,
- mobile network drop,
- streaming heartbeat tidak cukup,
- response terlalu lama setelah commit.

Tidak semua broken pipe adalah server bug, tetapi rate-nya harus dipantau.

## 22.4 `413` hanya di production

Kemungkinan:

- ingress/proxy body limit lebih kecil dari local,
- WAF limit,
- multipart config beda,
- fileSizeThreshold temp storage issue,
- compression/chunked behavior beda.

## 22.5 `431` setelah login SSO

Kemungkinan:

- cookie terlalu besar,
- JWT/cookie ditumpuk,
- logout tidak menghapus cookie lama,
- domain/path cookie mismatch,
- forwarded/tracing headers menambah ukuran.

## 22.6 WebSocket disconnect tepat setiap N detik

Kemungkinan:

- LB idle timeout,
- proxy read timeout,
- heartbeat interval terlalu jarang,
- ping/pong tidak melewati proxy issue,
- container idle timeout.

## 22.7 Health check sukses, user request gagal

Kemungkinan:

- health check terlalu dangkal,
- worker pool penuh tapi health endpoint cepat karena tidak memakai dependency,
- readiness tidak mempertimbangkan saturation,
- path user terkena proxy limit berbeda.

Health check bukan pengganti saturation metrics.

---

## 23. Practical Configuration Strategy

### 23.1 Mulai dari contract, bukan angka default

Definisikan:

```text
Max request body per endpoint
Max upload size
Max header size expectation
Max request duration per endpoint class
Max concurrent expensive operations
Expected WebSocket/SSE users
Expected rps and burst
Downstream pool/rate limits
SLO p95/p99
```

Baru mapping ke config.

### 23.2 Pisahkan kelas traffic

Minimal kelompok:

| Class | Contoh | Perlakuan |
|---|---|---|
| Cheap API | CRUD/read kecil | normal pool, short timeout |
| Expensive API | report/export/search berat | concurrency limit, async/job |
| Upload | multipart file | body/temp/storage limits |
| Download | large file | streaming/offload |
| Realtime | WebSocket/SSE | idle/heartbeat/drain policy |
| Health | readiness/liveness | fast, isolated, safe |

### 23.3 Set limit berlapis dan konsisten

Untuk setiap endpoint penting, cek:

```text
Edge/WAF
Load balancer
Ingress/reverse proxy
Servlet container
Framework config
Application validation
Downstream/storage
```

Limit harus sengaja. Jangan biarkan default acak antar environment.

### 23.4 Instrument sebelum tuning

Jangan tuning berdasarkan feeling.

Minimal metrics:

- request count by status,
- p50/p95/p99 latency,
- active requests,
- active connections,
- worker busy threads,
- executor queue,
- rejected requests,
- DB pool active/idle/wait,
- outbound HTTP pool,
- GC pause,
- CPU/memory,
- WebSocket active sessions,
- SSE active streams,
- client abort count,
- async timeout count.

---

## 24. Example: Reasoning Through a Production API

Misal aplikasi:

```text
Traffic: 150 rps normal, burst 300 rps
p95 target: 500 ms
DB pool: 80
External API pool: 40
Average request: DB + maybe external API
Upload endpoint: max 20 MB
WebSocket users: 5000 online
Ingress timeout: 60s
```

### 24.1 Worker sizing

Jika p95 500ms dan burst 300 rps:

```text
concurrency at p95 ≈ 300 × 0.5 = 150
```

Tapi external API pool hanya 40. Jika banyak request butuh external API, worker 300 hanya membuat antrian external API.

Better:

- normal API worker budget 150-200,
- external API bulkhead 40-60 depending timeout,
- DB pool 80 checked against query time,
- expensive endpoint separate concurrency limit.

### 24.2 Timeout

Jika ingress 60s tapi target p95 500ms:

- API timeout app mungkin 5-10s,
- DB query timeout 2-3s,
- external API timeout 1-2s,
- ingress 60s terlalu long tetapi acceptable as outer guard,
- long report should not be sync.

### 24.3 Upload

20 MB upload:

- ingress body limit 25 MB,
- container/multipart max request 25 MB,
- app validation 20 MB file,
- temp storage: concurrent uploads × 25 MB × factor,
- upload path timeout longer than normal API.

### 24.4 WebSocket

5000 users:

- max connections >= normal HTTP keep-alive + 5000 WS + headroom,
- heartbeat 25s if LB idle 60s,
- bounded outbound queue per session,
- close slow clients,
- rolling deploy drain sends close/reconnect instruction,
- session registry cleanup idempotent.

---

## 25. Example Tomcat/Spring Boot-Style Properties

Spring Boot property names vary by version. Treat this as conceptual, not universal.

```properties
server.port=8080
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=30s

server.tomcat.threads.max=200
server.tomcat.threads.min-spare=20
server.tomcat.max-connections=8192
server.tomcat.accept-count=100
server.tomcat.connection-timeout=20s
server.tomcat.keep-alive-timeout=15s
server.tomcat.max-http-form-post-size=20MB
server.max-http-request-header-size=16KB

spring.servlet.multipart.max-file-size=20MB
spring.servlet.multipart.max-request-size=25MB
spring.servlet.multipart.file-size-threshold=1MB
```

Caveat:

- Boot property mapping berubah antar versi,
- embedded container berbeda punya property berbeda,
- beberapa setting perlu `WebServerFactoryCustomizer`,
- proxy/ingress limit tetap harus diset terpisah.

---

## 26. Example Kubernetes/Ingress Alignment

Konseptual:

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 5
            failureThreshold: 30
```

Ingress/proxy conceptual annotations depend on controller, but align:

```text
proxy read timeout:          > app normal max response time
proxy body size:             >= app upload max request size
proxy buffering for SSE:     off on SSE path
websocket upgrade:           enabled
LB idle timeout:             > heartbeat interval
```

---

## 27. Configuration Review Checklist

Gunakan checklist ini saat review production web runtime.

### 27.1 Connector

- [ ] Port/bind address benar.
- [ ] TLS termination model jelas.
- [ ] Forwarded headers hanya dipercaya dari proxy tepercaya.
- [ ] `scheme`, host, port external benar untuk redirect/callback.
- [ ] HTTP/2 expectation jelas: edge only atau backend too.

### 27.2 Threads/execution

- [ ] Worker max/min diset sengaja.
- [ ] Worker sizing dibandingkan DB pool dan outbound pool.
- [ ] CPU-bound endpoint dibatasi.
- [ ] Expensive operation punya bulkhead.
- [ ] Async executor bounded.
- [ ] Virtual thread mode, jika ada, tetap punya downstream limit.

### 27.3 Connections

- [ ] Max connections cukup untuk keep-alive + WebSocket/SSE + headroom.
- [ ] Keep-alive timeout align dengan proxy.
- [ ] Accept queue tidak terlalu besar tanpa alasan.
- [ ] Idle connection policy jelas.

### 27.4 Limits

- [ ] Header size limit sesuai cookie/JWT/SSO reality.
- [ ] URI/query size wajar.
- [ ] Parameter count limit wajar.
- [ ] Body/multipart limit align edge-proxy-container-framework-app.
- [ ] Temp upload storage sized.
- [ ] WebSocket message size limit ada.

### 27.5 Timeouts

- [ ] App timeout lebih pendek dari proxy timeout untuk normal API.
- [ ] DB/external API timeout lebih pendek dari app timeout.
- [ ] Async timeout explicit.
- [ ] Upload timeout explicit.
- [ ] WebSocket/SSE heartbeat align dengan LB idle timeout.
- [ ] Graceful shutdown timeout align dengan LB drain/Kubernetes termination.

### 27.6 Observability

- [ ] Access log aktif dengan duration dan request id.
- [ ] App log punya correlation id.
- [ ] Worker/thread metrics tersedia.
- [ ] Connection metrics tersedia.
- [ ] DB/outbound pool metrics tersedia.
- [ ] Header/body rejection count diamati.
- [ ] Async timeout/client abort/broken pipe diamati.
- [ ] WebSocket active/close code metrics tersedia.

### 27.7 Failure UX

- [ ] Error page default container tidak bocor detail.
- [ ] JSON error konsisten untuk API.
- [ ] Proxy error page tidak membingungkan API client.
- [ ] `Retry-After` dipakai untuk overload/rate limit jika sesuai.
- [ ] Idempotency untuk operation yang bisa retry.

---

## 28. Anti-Patterns

### 28.1 “Naikkan maxThreads sampai timeout hilang”

Biasanya hanya memindahkan bottleneck ke DB/downstream dan memperburuk tail latency.

### 28.2 “Semua timeout 5 menit biar aman”

Ini membuat resource tertahan lama, retry terlambat, dan failure tidak cepat terlihat.

### 28.3 “Header limit besar saja”

Bisa menyembunyikan cookie/JWT bloat dan memperbesar memory/DoS surface.

### 28.4 “Upload limit cuma di aplikasi”

Jika proxy lebih kecil, aplikasi tidak pernah melihat request. Jika proxy lebih besar tanpa app/temp storage siap, pod bisa kehabisan disk.

### 28.5 “Health check sukses berarti aplikasi sehat”

Health endpoint bisa sukses saat worker pool, DB pool, atau outbound pool sudah jenuh.

### 28.6 “WebSocket cukup asal endpoint connect”

Tanpa heartbeat, idle timeout alignment, bounded queue, cleanup, dan drain policy, WebSocket akan gagal di production scale.

### 28.7 “Default container config cukup untuk production”

Default dibuat untuk general case, bukan workload spesifik, SLO spesifik, compliance spesifik, atau traffic burst spesifik.

---

## 29. Mental Model Final

Container configuration harus dibaca sebagai state machine kapasitas:

```text
connection arrives
  ↓
accepted? or backlog/full?
  ↓
header valid and within limit?
  ↓
body allowed and readable within timeout?
  ↓
worker/executor available?
  ↓
downstream capacity available?
  ↓
response generated before outer timeout?
  ↓
client/proxy still connected?
  ↓
connection reused, closed, upgraded, or drained?
```

Engineer top-tier tidak hanya bertanya:

```text
Config Tomcat maxThreads berapa?
```

Tetapi bertanya:

```text
Untuk traffic mix ini, berapa active request yang boleh berada di sistem?
Di mana queue boleh terjadi?
Layer mana yang reject duluan?
Timeout mana yang menang?
Apakah failure user akan konsisten?
Apakah retry aman?
Apakah metric cukup untuk membedakan worker saturation, DB saturation, proxy timeout, dan client abort?
```

Itulah perbedaan antara “server bisa jalan” dan “runtime bisa dipertanggungjawabkan”.

---

## 30. Ringkasan

Di part ini kita mempelajari:

- connector sebagai gerbang network ke servlet runtime,
- perbedaan connection capacity dan execution capacity,
- peran acceptor, selector/poller, worker,
- hubungan `maxThreads`, `maxConnections`, `acceptCount`, keep-alive, dan timeout,
- mental model Tomcat, Jetty, dan Undertow,
- sizing thread pool berdasarkan workload dan downstream,
- queue/backpressure sebagai desain eksplisit,
- timeout alignment antar browser/proxy/container/app/downstream,
- header/body/multipart limits,
- compression/response buffer/large response,
- HTTP/2 implications,
- TLS termination dan forwarded headers,
- access log/error page/health/graceful shutdown,
- WebSocket/SSE container concerns,
- production checklist dan anti-pattern.

Part berikutnya akan naik satu layer keluar dari container: **reverse proxy, load balancer, Kubernetes, dan cloud runtime**. Di sana kita akan melihat bagaimana konfigurasi container harus diselaraskan dengan Nginx/HAProxy/ALB/Ingress, sticky session, WebSocket upgrade, idle timeout, rolling update, dan graceful drain.

---

## 31. Referensi

- Jakarta Servlet 6.1 Specification — https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Apache Tomcat 11 HTTP Connector Configuration Reference — https://tomcat.apache.org/tomcat-11.0-doc/config/http.html
- Eclipse Jetty 12.1 Operations Guide — https://jetty.org/docs/jetty/12.1/operations-guide/index.html
- Eclipse Jetty 12.1 Threading Architecture — https://jetty.org/docs/jetty/12.1/programming-guide/arch/threads.html
- Undertow Listeners Documentation — https://undertow.io/undertow-docs/undertow-docs-2.1.0/listeners.html
- Undertow Options API Documentation — https://undertow.io/javadoc/2.0.x/io/undertow/UndertowOptions.html
- Kubernetes Probes Documentation — https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- RFC 9110 — HTTP Semantics — https://www.rfc-editor.org/rfc/rfc9110.html

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime — Part 027](./learn-java-servlet-websocket-web-container-runtime-part-027.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime — Part 029](./learn-java-servlet-websocket-web-container-runtime-part-029.md)

</div>