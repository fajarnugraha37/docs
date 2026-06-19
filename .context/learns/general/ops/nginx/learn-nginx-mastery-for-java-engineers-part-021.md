# learn-nginx-mastery-for-java-engineers-part-021.md

# Part 021 — Nginx and Java Application Servers

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **021 / 030**  
> Topik: **Nginx di depan runtime Java: Spring Boot, Tomcat, Jetty, Undertow, Netty, WebFlux, Quarkus, Micronaut**  
> Target pembaca: **Java software engineer / backend engineer / tech lead**

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita sudah membangun fondasi:

- bagaimana Nginx menerima koneksi,
- bagaimana konfigurasi dipilih,
- bagaimana request dirutekan,
- bagaimana Nginx menjadi reverse proxy,
- bagaimana timeout, retry, buffering, cache, rate limit, TLS, dan observability bekerja.

Part ini masuk ke pertanyaan yang lebih dekat dengan pekerjaan backend Java sehari-hari:

> “Apa konsekuensi teknis ketika Nginx ditempatkan di depan aplikasi Java?”

Ini bukan hanya pertanyaan konfigurasi. Ini pertanyaan arsitektur runtime.

Nginx dan aplikasi Java memiliki model eksekusi yang berbeda. Nginx sangat event-driven, connection-oriented, dan bekerja sebagai traffic boundary. Banyak aplikasi Java, terutama stack servlet tradisional, bekerja dengan model thread-per-request. Stack reactive seperti Netty/WebFlux bekerja dengan model event loop. Perbedaan ini memengaruhi:

- latency,
- throughput,
- memory pressure,
- thread pool saturation,
- backpressure,
- file upload,
- streaming response,
- WebSocket,
- graceful shutdown,
- health check,
- tracing,
- client identity,
- dan failure diagnosis.

Part ini akan membantu kamu melihat Nginx bukan hanya sebagai “proxy di depan Spring Boot”, tetapi sebagai **runtime boundary** yang mengubah bentuk request sebelum request sampai ke Java.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan perbedaan runtime model Nginx dan Java application server.
2. Menilai efek Nginx terhadap servlet thread pool, reactive event loop, dan upstream connection pool.
3. Mendesain konfigurasi Nginx yang cocok untuk Spring Boot, Tomcat, Jetty, Undertow, Netty, WebFlux, Quarkus, dan Micronaut.
4. Memahami dampak buffering terhadap upload, download, memory, disk I/O, dan latency.
5. Menghindari bug umum reverse proxy seperti wrong scheme, wrong client IP, wrong redirect, broken secure cookie, dan broken absolute URL.
6. Mengonfigurasi Nginx untuk WebSocket, SSE, long polling, dan streaming response.
7. Merancang graceful shutdown Java service yang aman di belakang Nginx.
8. Membedakan readiness, liveness, health check, dan business health.
9. Membaca gejala production dari dua sisi: Nginx dan Java runtime.
10. Membuat checklist deployment Nginx + Java yang defensible untuk production.

---

## 2. Mental Model Utama

### 2.1 Nginx Bukan Servlet Container

Nginx bukan Tomcat. Nginx tidak menjalankan controller Java. Nginx tidak tahu transaction boundary, Hibernate session, `@Transactional`, security context, atau request-scoped bean.

Nginx bekerja di lapisan traffic:

```text
client
  -> TCP/TLS/HTTP boundary
  -> Nginx
  -> upstream HTTP/TCP connection
  -> Java application server
  -> business logic
```

Java application server bekerja di lapisan aplikasi:

```text
incoming request
  -> connector
  -> request parser
  -> filter/interceptor/security chain
  -> controller/resource handler
  -> service/domain layer
  -> database/queue/cache/external dependency
  -> response
```

Kesalahan umum adalah menganggap Nginx hanya meneruskan request secara transparan. Dalam praktik, Nginx bisa mengubah banyak hal:

- scheme dari `https` menjadi `http` ke upstream,
- client IP menjadi IP proxy,
- body buffering,
- response buffering,
- timeout behavior,
- retry behavior,
- header contract,
- connection reuse,
- compression,
- cache behavior,
- status code yang dilihat client,
- dan bahkan urutan observability signal.

Jadi mental model yang lebih benar:

> Nginx adalah **adapter runtime** antara dunia client/network dan dunia Java application server.

---

### 2.2 Request Tidak “Mengalir”, Request Berpindah Boundary

Dalam diagram sederhana, kita sering menggambar:

```text
Browser -> Nginx -> Spring Boot -> Database
```

Tapi secara runtime, setiap panah adalah boundary dengan kontrak berbeda.

```text
Browser
  -- internet/TLS/client timeout/client behavior -->
Nginx
  -- upstream connection/proxy headers/proxy timeout/buffering -->
Spring Boot
  -- JDBC pool/transaction timeout/query timeout -->
Database
```

Setiap boundary punya:

- protocol,
- timeout,
- retry semantics,
- queue,
- resource pool,
- identity representation,
- failure mode,
- observability signal.

Banyak incident terjadi karena boundary ini tidak konsisten.

Contoh:

```text
Nginx proxy_read_timeout       = 60s
Spring controller timeout      = none
Tomcat thread can block        = 5 minutes
Database query timeout         = none
Load balancer client timeout   = 30s
```

Hasilnya:

- client sudah timeout,
- Nginx bisa menutup koneksi,
- Java masih memproses,
- DB masih bekerja,
- thread tetap tertahan,
- retry dari client membuat beban bertambah,
- sistem terlihat “misterius lambat”.

Boundary harus dirancang, bukan dibiarkan default.

---

## 3. Runtime Model: Nginx vs Java Application Server

### 3.1 Nginx: Event-Driven Worker

Nginx menggunakan model worker process event-driven. Secara konseptual:

```text
master process
  -> worker 1: event loop
  -> worker 2: event loop
  -> worker N: event loop
```

Satu worker dapat menangani banyak koneksi karena tidak membuat satu thread per koneksi. Worker bereaksi terhadap event:

- socket readable,
- socket writable,
- timer expired,
- upstream ready,
- file ready,
- client closed,
- response chunk ready.

Konsekuensi:

- Nginx sangat efisien untuk banyak koneksi idle/keepalive.
- Nginx cocok menahan slow client.
- Nginx dapat menjadi buffer antara client lambat dan upstream cepat.
- Nginx bisa melindungi Java thread dari client yang membaca response pelan.

Tapi:

- operasi blocking di Nginx worker berbahaya,
- disk I/O untuk buffering/cache/log bisa menjadi bottleneck,
- konfigurasi yang salah bisa tetap membuat seluruh layer gagal.

---

### 3.2 Servlet Stack: Thread-Per-Request

Banyak aplikasi Java tradisional menggunakan servlet stack:

- Spring MVC di embedded Tomcat/Jetty/Undertow,
- Jakarta EE,
- legacy WAR di Tomcat,
- synchronous controller,
- blocking JDBC,
- blocking HTTP client.

Model sederhananya:

```text
request masuk
  -> connector menerima
  -> request diparsing
  -> thread dari pool menangani request
  -> thread menjalankan filter/controller/service/repository
  -> thread menunggu database/API eksternal
  -> response dikirim
  -> thread kembali ke pool
```

Artinya kapasitas sangat dipengaruhi oleh:

- jumlah thread,
- waktu blocking,
- JDBC pool,
- external API latency,
- lock contention,
- GC pause,
- CPU saturation,
- request body size,
- response size.

Jika request datang lebih cepat daripada thread kembali ke pool:

```text
incoming requests > completed requests
  -> request queue naik
  -> latency naik
  -> timeout naik
  -> retry naik
  -> throughput bisa turun
```

Nginx dapat membantu mengatur traffic, tetapi tidak bisa menyelamatkan aplikasi Java yang thread pool-nya habis karena blocking call tanpa timeout.

---

### 3.3 Reactive Stack: Event Loop di Java

Stack seperti:

- Spring WebFlux dengan Netty,
- Reactor Netty,
- Vert.x,
- beberapa mode Quarkus reactive,
- beberapa mode Micronaut reactive,

menggunakan model event loop.

Secara konseptual mirip Nginx dalam hal non-blocking I/O:

```text
event loop thread
  -> menerima event socket
  -> menjalankan callback ringan
  -> memulai operasi async
  -> kembali ke loop
```

Kapasitas reactive stack bisa sangat tinggi untuk I/O-bound workload. Tapi kelemahannya fatal jika ada blocking operation di event loop:

```java
@GetMapping("/bad")
public Mono<String> bad() {
    return Mono.just(callBlockingJdbcDirectly());
}
```

Jika blocking call terjadi di event loop:

- event loop tertahan,
- banyak request ikut tertahan,
- latency naik tajam,
- CPU mungkin tidak penuh,
- thread count mungkin rendah,
- gejala terlihat aneh.

Dengan Nginx di depan reactive backend, kamu harus memperhatikan:

- streaming behavior,
- buffering,
- timeout panjang,
- backpressure,
- connection reuse,
- dan response flushing.

---

## 4. Nginx di Depan Spring Boot

### 4.1 Deployment Shape Umum

Bentuk umum:

```text
internet
  -> cloud load balancer / firewall
  -> Nginx
  -> Spring Boot app on localhost/private network
```

Contoh:

```text
client -> https://api.example.com
Nginx  -> http://127.0.0.1:8080
Spring Boot embedded Tomcat
```

Basic reverse proxy:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
    }
}
```

Tapi konfigurasi ini belum cukup untuk production. Ia hanya bentuk awal.

---

### 4.2 Masalah Umum: Spring Boot Tidak Tahu Original Scheme

Client mengakses:

```text
https://api.example.com/login
```

Nginx meneruskan ke Spring Boot:

```text
http://127.0.0.1:8080/login
```

Dari perspektif Java app, request tampak `http`, bukan `https`, kecuali forwarded header diproses.

Dampaknya:

- redirect ke `http://...`, bukan `https://...`,
- generated absolute URL salah,
- OAuth callback URL salah,
- secure cookie tidak diset,
- HATEOAS link salah,
- Swagger/OpenAPI server URL salah,
- audit log salah,
- security middleware salah mengambil scheme.

Di sisi Nginx, kontraknya:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
```

Di sisi Spring Boot, aplikasi harus dikonfigurasi untuk mempercayai forwarded headers dari proxy yang sah.

Contoh konseptual `application.yml`:

```yaml
server:
  forward-headers-strategy: framework
```

Atau tergantung versi dan stack, konfigurasi bisa menggunakan native container support.

Prinsipnya:

> Header forwarding harus menjadi kontrak dua sisi: Nginx mengirim, Java app memproses, dan trust boundary dibatasi.

---

### 4.3 Masalah Umum: Client IP Hilang

Tanpa header forwarding, Spring Boot melihat client sebagai:

```text
127.0.0.1
```

atau IP Nginx/private proxy.

Ini merusak:

- audit trail,
- fraud detection,
- rate limit aplikasi,
- geolocation,
- security alert,
- access log Java,
- trace investigation,
- regulatory evidence.

Nginx:

```nginx
proxy_set_header X-Real-IP       $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

Java app harus hanya mempercayai header ini jika request datang dari Nginx/trusted proxy.

Jangan membuat aplikasi langsung percaya header dari internet.

Buruk:

```text
Client sends: X-Forwarded-For: 1.2.3.4
Nginx passes blindly
App trusts first IP
Audit log manipulated
```

Lebih aman:

```text
Client -> Nginx
Nginx overwrites/appends controlled forwarded headers
App trusts only traffic from Nginx network
```

---

## 5. Nginx di Depan Tomcat

### 5.1 Embedded Tomcat vs External Tomcat

Ada dua bentuk umum:

```text
Nginx -> Spring Boot embedded Tomcat
```

atau:

```text
Nginx -> external Tomcat -> WAR application
```

Dari sisi Nginx, keduanya terlihat seperti HTTP upstream. Dari sisi operasi Java, berbeda:

| Aspek | Embedded Tomcat | External Tomcat |
|---|---:|---:|
| Packaging | executable jar | WAR/container-managed |
| Config ownership | app team | platform/app server team |
| Thread pool config | app config | Tomcat config |
| Deployment | process/container | shared/standalone server |
| Isolation | usually one app/process | can be multiple apps |
| Upgrade path | app release | container/runtime release |

Nginx tidak peduli apakah upstream itu embedded atau external. Tapi kamu sebagai engineer harus peduli, karena tuning dan failure isolation berbeda.

---

### 5.2 Tomcat Thread Pool dan Nginx

Tomcat memiliki connector thread pool. Misalnya:

```yaml
server:
  tomcat:
    threads:
      max: 200
      min-spare: 20
    accept-count: 100
    max-connections: 8192
```

Secara konseptual:

```text
Nginx upstream connections
  -> Tomcat connector
  -> request queue / accept queue
  -> worker thread
```

Jika Nginx mengirim terlalu banyak concurrent request ke Tomcat:

```text
Tomcat max threads penuh
  -> request menunggu
  -> latency naik
  -> Nginx proxy_read_timeout tercapai
  -> 504 ke client
  -> Java masih bisa lanjut memproses
```

Tuning Nginx tidak boleh dipisahkan dari tuning Tomcat.

Pertanyaan desain:

- Berapa request concurrent realistis per instance?
- Berapa thread Tomcat?
- Berapa JDBC connection pool?
- Berapa external API connection pool?
- Apakah Nginx upstream keepalive lebih besar dari kapasitas backend?
- Apakah request mahal perlu rate limit di Nginx?
- Apakah endpoint lambat perlu timeout lebih pendek?

---

### 5.3 RemoteIpValve / Forwarded Headers

Untuk Tomcat-based apps, forwarded header handling dapat dilakukan di level framework atau container.

Konsepnya:

```text
Nginx sets X-Forwarded-Proto=https
Tomcat/Spring maps request.isSecure() -> true
App builds secure URL/cookie correctly
```

Jika tidak:

```java
request.isSecure() == false
```

padahal client memakai HTTPS.

Dampak:

- cookie `Secure` mungkin tidak konsisten,
- redirect salah,
- OAuth/SAML callback salah,
- security rule salah.

---

## 6. Nginx di Depan Jetty

Jetty sering digunakan untuk:

- aplikasi Java embedded,
- high concurrency server,
- aplikasi yang butuh async servlet,
- beberapa platform lama dan custom.

Dengan Nginx di depan Jetty, concern utamanya mirip Tomcat:

- forwarded headers,
- thread pool,
- async request timeout,
- connector idle timeout,
- request/response buffering,
- graceful shutdown.

Jetty biasanya sangat configurable. Ini bagus, tapi membuat mismatch lebih mudah terjadi.

Contoh mismatch:

```text
Nginx proxy_read_timeout = 60s
Jetty async timeout      = 30s
Client timeout           = 120s
```

Hasil:

- Jetty mengakhiri async request lebih dulu,
- Nginx menerima upstream close/error,
- client melihat 502/504/partial response tergantung timing.

Prinsip:

> Timeout harus dilihat sebagai rantai, bukan sebagai setting per komponen.

---

## 7. Nginx di Depan Undertow

Undertow digunakan di beberapa stack seperti WildFly/JBoss dan juga bisa menjadi embedded server.

Undertow memiliki model yang lebih dekat ke non-blocking I/O, tetapi aplikasi servlet di atasnya tetap bisa melakukan blocking.

Hal yang perlu diperhatikan:

- worker threads vs I/O threads,
- blocking handler separation,
- forwarded headers,
- HTTP/2 support jika relevan,
- request body buffering,
- streaming response,
- max entity size,
- graceful shutdown behavior.

Nginx dapat menahan client lambat, tetapi jika upstream Undertow tetap memproses blocking operation secara tidak terkendali, bottleneck tetap muncul di Java.

---

## 8. Nginx di Depan Netty / Reactor Netty / WebFlux

### 8.1 Double Event Loop Boundary

Dengan Spring WebFlux/Reactor Netty:

```text
Nginx event loop
  -> upstream TCP connection
  -> Netty event loop
  -> reactive pipeline
```

Ini bisa sangat efisien, tetapi juga sensitif terhadap:

- blocking call,
- response buffering,
- backpressure mismatch,
- long-lived connections,
- large body handling,
- thread starvation di bounded elastic scheduler,
- event loop CPU saturation.

---

### 8.2 Blocking Call Dalam Reactive Backend

Salah satu production smell:

```text
Nginx upstream_response_time naik
Java CPU tidak terlalu tinggi
Thread count tidak ekstrem
p99 latency melonjak
```

Kemungkinan:

- event loop diblokir,
- external dependency lambat,
- bounded elastic pool penuh,
- response streaming ditahan oleh buffering,
- request body besar tidak dikontrol.

Contoh anti-pattern:

```java
@GetMapping("/orders")
public Mono<List<Order>> orders() {
    List<Order> result = jdbcTemplate.query(...); // blocking
    return Mono.just(result);
}
```

Lebih benar secara konsep:

```java
@GetMapping("/orders")
public Mono<List<Order>> orders() {
    return Mono.fromCallable(() -> jdbcTemplate.query(...))
               .subscribeOn(Schedulers.boundedElastic());
}
```

Lebih baik lagi: gunakan driver reactive end-to-end jika sesuai.

Nginx tidak bisa mendeteksi “blocking di event loop” secara langsung. Yang terlihat di Nginx hanya upstream lambat.

---

## 9. Nginx di Depan Quarkus dan Micronaut

Quarkus dan Micronaut sering digunakan untuk:

- microservices,
- container-native deployment,
- fast startup,
- lower memory footprint,
- reactive atau imperative mode.

Dari sisi Nginx, yang penting bukan framework brand-nya, tetapi runtime mode-nya:

```text
imperative/blocking endpoint?
reactive/non-blocking endpoint?
HTTP/1.1 only?
HTTP/2/gRPC?
container readiness behavior?
management endpoint path?
```

Checklist:

- Apakah framework membaca `X-Forwarded-*`?
- Apakah management endpoint terpisah dari public endpoint?
- Apakah `/health` murah dan tidak memanggil dependency berat?
- Apakah graceful shutdown menunggu request berjalan?
- Apakah connection idle timeout cocok dengan Nginx?
- Apakah native image punya limit resource berbeda?
- Apakah log punya request ID dari Nginx?

---

## 10. Proxy Buffering dan Dampaknya ke Java

### 10.1 Apa Itu Proxy Buffering?

Nginx dapat membaca response dari upstream Java lalu menyimpannya sementara sebelum mengirim ke client.

Dengan buffering aktif:

```text
Java app -> sends response quickly to Nginx
Nginx -> buffers response
Nginx -> sends to slow client at client's pace
Java thread/connection can be released earlier
```

Dengan buffering nonaktif:

```text
Java app -> sends response
Nginx -> streams directly to client
slow client can slow down upstream response flow
```

Default behavior Nginx untuk proxy biasanya buffering response aktif, tergantung directive.

---

### 10.2 Kenapa Buffering Bisa Melindungi Java

Bayangkan endpoint menghasilkan response 5 MB.

Client sangat lambat.

Tanpa Nginx buffering:

```text
Java app keeps connection busy longer
Tomcat thread may stay engaged depending implementation
upstream socket remains occupied
slow client propagates backward
```

Dengan Nginx buffering:

```text
Java writes response to Nginx quickly
Nginx stores buffer/temp file
Java frees thread/connection earlier
Nginx handles slow client
```

Ini sangat berguna untuk servlet stack blocking.

---

### 10.3 Kapan Buffering Berbahaya?

Buffering tidak cocok untuk semua kasus.

Tidak cocok atau perlu hati-hati untuk:

- Server-Sent Events,
- streaming download real-time,
- chunked progress response,
- log tailing,
- incremental AI/token response,
- long-lived stream,
- WebSocket,
- gRPC streaming,
- very large response tanpa disk planning.

Untuk SSE, sering dibutuhkan:

```nginx
location /events/ {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_set_header Connection "";
}
```

Jika buffering tidak dimatikan, gejala klasik:

```text
Server mengirim event sedikit demi sedikit
Nginx menahan buffer
Client tidak menerima apa-apa
Setelah buffer penuh/response selesai, baru terkirim
SSE terlihat “macet”
```

---

## 11. Request Body Buffering dan Upload

### 11.1 Upload Flow Dengan Nginx

Request upload besar:

```text
client uploads 500 MB
  -> Nginx receives body
  -> Nginx may buffer body to memory/temp file
  -> Nginx sends body to Java upstream
```

Directive penting:

```nginx
client_max_body_size 100m;
client_body_buffer_size 128k;
proxy_request_buffering on;
```

Dengan `proxy_request_buffering on`:

```text
Nginx reads full request body first
then sends to Java
```

Dengan `proxy_request_buffering off`:

```text
Nginx streams request body to Java as it arrives
```

---

### 11.2 Manfaat Request Buffering

Untuk servlet app, buffering bisa melindungi backend dari slow upload client.

Tanpa buffering:

```text
client uploads slowly
Java connection held while body arrives
Tomcat thread/resource may be tied up
```

Dengan buffering:

```text
Nginx absorbs slow upload
Java receives body faster once complete
```

Ini bisa sangat berguna untuk aplikasi Java yang tidak dirancang menangani slow client.

---

### 11.3 Kerugian Request Buffering

Request buffering juga punya konsekuensi:

- Nginx butuh memory/temp disk.
- Upload besar bisa memenuhi disk temp.
- Java app baru mulai proses setelah upload lengkap.
- Tidak cocok untuk streaming upload use case tertentu.
- Progress upload dari backend bisa tidak akurat.
- Latency end-to-end bisa terasa lebih tinggi untuk request yang bisa diproses streaming.

Untuk endpoint upload besar, kamu harus mendesain:

```text
client_max_body_size
client_body_temp_path capacity
proxy_request_buffering policy
Java max request size
storage strategy
virus scanning strategy
request timeout
rate limit
```

---

### 11.4 Upload Langsung ke Object Storage

Untuk banyak sistem modern, pola lebih baik:

```text
client -> app asks for pre-signed URL
client -> uploads directly to object storage
object storage -> callback/event
app -> processes metadata
```

Daripada:

```text
client -> Nginx -> Java -> object storage
```

Nginx bisa melayani upload, tetapi bukan berarti semua upload harus melewati Java app.

Untuk file besar, pertanyaan arsitektural:

- Apakah Java perlu melihat byte stream?
- Apakah bisa direct upload ke S3/GCS/MinIO?
- Apakah perlu scanning sebelum publish?
- Apakah metadata bisa dipisahkan dari binary payload?
- Apakah retry idempotent?

---

## 12. Streaming Download

### 12.1 Static Download vs App-Generated Download

Ada dua tipe download:

```text
static file download:
Nginx serves file directly
```

```text
app-generated download:
Java generates CSV/PDF/report -> Nginx -> client
```

Jika file sudah ada di disk/object storage/CDN, jangan otomatis memaksa Java menjadi data pump.

Buruk:

```text
Java reads file from disk/object storage
Java writes bytes to response
Nginx forwards bytes
```

Lebih baik dalam banyak kasus:

```text
Nginx serves static file
```

atau:

```text
Java authorizes request
Java returns internal redirect / signed URL
Nginx or object storage serves file
```

---

### 12.2 X-Accel-Redirect Pattern

Nginx mendukung pattern internal redirect untuk file serving setelah authorization dilakukan aplikasi.

Flow:

```text
client asks /download/123
Nginx proxies to Java
Java checks auth
Java returns X-Accel-Redirect: /internal-files/report-123.pdf
Nginx serves internal file
client never sees real path
```

Contoh Nginx:

```nginx
location /download/ {
    proxy_pass http://app;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /internal-files/ {
    internal;
    alias /srv/protected-files/;
}
```

Java response concept:

```text
HTTP/1.1 200 OK
X-Accel-Redirect: /internal-files/report-123.pdf
Content-Type: application/pdf
```

Manfaat:

- Authorization tetap di Java.
- Byte serving dilakukan Nginx.
- Java thread tidak dipakai untuk transfer file panjang.
- Path fisik tidak terekspos.
- Lebih efisien untuk file besar.

---

## 13. WebSocket Dengan Java Backend

### 13.1 WebSocket Butuh Upgrade

WebSocket dimulai sebagai HTTP request dengan upgrade.

Nginx perlu meneruskan header upgrade:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name ws.example.com;

    location /ws/ {
        proxy_pass http://app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host       $host;

        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Tanpa ini, gejala:

- handshake gagal,
- status 400/426,
- koneksi langsung close,
- browser console menunjukkan WebSocket error.

---

### 13.2 WebSocket dan Load Balancing

WebSocket adalah long-lived connection.

Konsekuensi load balancing:

- satu koneksi menempel pada satu backend selama hidup koneksi,
- load tidak seimbang jika koneksi panjang dan jumlah backend berubah,
- deployment rolling update perlu drain,
- session affinity mungkin diperlukan jika state ada di memory,
- autoscaling berdasarkan request per second tidak cukup.

Jika backend Java menyimpan session WebSocket lokal:

```text
client A -> app-1
client A reconnect -> app-2
state missing
```

Solusi arsitektural:

- externalize state,
- use message broker/pub-sub,
- sticky routing sebagai mitigasi sementara,
- graceful connection drain saat deployment,
- reconnect protocol yang robust.

---

## 14. Server-Sent Events Dengan Java Backend

SSE menggunakan HTTP response yang tetap terbuka dan mengirim event bertahap.

Nginx config tipikal:

```nginx
location /sse/ {
    proxy_pass http://app;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;

    add_header X-Accel-Buffering no;
}
```

Di Java, misalnya Spring MVC `SseEmitter` atau WebFlux `Flux<ServerSentEvent<?>>`.

Failure mode:

| Gejala | Kemungkinan penyebab |
|---|---|
| Event tidak muncul sampai response selesai | Nginx buffering aktif |
| Disconnect tiap 60 detik | timeout default terlalu pendek |
| Banyak connection idle | SSE memang long-lived, capacity perlu dihitung |
| App thread habis | SSE diimplementasikan blocking tanpa async model |
| Memory naik | subscriber tidak dibersihkan saat disconnect |

---

## 15. Long Polling

Long polling:

```text
client sends request
server waits until data available or timeout
response sent
client immediately sends another request
```

Nginx concern:

- `proxy_read_timeout` harus lebih panjang dari long polling wait time.
- Rate limit harus disesuaikan agar reconnect pattern tidak dianggap abuse.
- Upstream thread model harus aman.
- Client disconnect harus terdeteksi.

Contoh:

```nginx
location /poll/ {
    proxy_pass http://app;
    proxy_read_timeout 70s;
    proxy_send_timeout 70s;
}
```

Jika aplikasi long poll menunggu maksimal 60s, Nginx timeout sebaiknya sedikit lebih panjang.

Jangan:

```text
app waits 60s
Nginx proxy_read_timeout 30s
```

Karena Nginx akan memutus request sebelum aplikasi selesai.

---

## 16. gRPC dan Java Backend

gRPC biasanya berjalan di atas HTTP/2.

Dengan Nginx, ada perbedaan antara proxy HTTP biasa dan gRPC proxy.

Konsep:

```nginx
server {
    listen 443 ssl http2;
    server_name grpc.example.com;

    location / {
        grpc_pass grpc://grpc_backend;
    }
}

upstream grpc_backend {
    server 127.0.0.1:9090;
}
```

Hal yang harus dipahami:

- gRPC bukan REST biasa.
- Deadline gRPC harus diselaraskan dengan Nginx timeout.
- Streaming gRPC punya karakter long-lived.
- Error mapping berbeda dari status HTTP biasa.
- Observability harus membaca gRPC status juga.
- Load balancing gRPC bisa tricky karena HTTP/2 multiplexing.

Untuk Java gRPC server, pertimbangkan:

- max inbound message size,
- keepalive,
- deadline propagation,
- cancellation handling,
- graceful shutdown,
- reflection endpoint exposure.

---

## 17. Health Check: Liveness, Readiness, dan Real Health

### 17.1 Jangan Campur Semua Health Menjadi Satu

Banyak sistem punya endpoint:

```text
/health
```

Tapi “health” bisa berarti banyak hal.

Pisahkan secara mental:

| Jenis | Pertanyaan | Dipakai untuk |
|---|---|---|
| Liveness | Apakah proses masih hidup? | restart jika deadlock/crash |
| Readiness | Apakah siap menerima traffic? | routing/load balancing |
| Startup | Apakah boot selesai? | startup grace period |
| Dependency health | Apakah DB/Redis/API sehat? | observability/alerting |
| Business health | Apakah fungsi bisnis berjalan? | synthetic monitoring |

Nginx open source tidak punya active health check upstream HTTP seperti NGINX Plus, tetapi bisa bekerja dengan passive failure behavior, atau health check dikelola oleh orchestrator/load balancer di luar Nginx.

Di Kubernetes, readiness biasanya dilakukan oleh kubelet/service endpoint selection, bukan oleh Nginx manual.

---

### 17.2 Health Endpoint Untuk Java App

Untuk Spring Boot Actuator, endpoint umum:

```text
/actuator/health/liveness
/actuator/health/readiness
```

Prinsip:

- readiness tidak boleh mahal,
- readiness tidak boleh terlalu sensitif,
- readiness harus turun saat app tidak bisa melayani traffic,
- liveness tidak boleh bergantung pada dependency eksternal yang flapping,
- management endpoint sebaiknya tidak publik.

Nginx access control:

```nginx
location /actuator/ {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://app;
}
```

Atau lebih baik pisahkan management port dan tidak expose lewat public Nginx.

---

## 18. Graceful Shutdown

### 18.1 Kenapa Graceful Shutdown Penting

Tanpa graceful shutdown:

```text
deployment starts
old Java process receives SIGTERM
process exits quickly
active requests dropped
Nginx sees upstream close/reset
clients see 502/connection reset
```

Dengan graceful shutdown:

```text
instance marked not ready
new traffic stops
existing requests finish
connection drained
process exits
```

Nginx hanyalah satu bagian dari rantai. Orchestrator juga harus berperan.

---

### 18.2 Deployment Drain Model

Ideal rolling deployment:

```text
1. Mark app instance not ready
2. Stop sending new traffic to instance
3. Wait for in-flight requests
4. Close long-lived connections carefully
5. Terminate process
6. Start new instance
7. Wait until ready
8. Add to traffic
```

Jika Nginx menggunakan static upstream list, kamu harus punya mekanisme reload/update upstream atau memakai service discovery/load balancer layer.

Dalam Kubernetes:

```text
readiness probe false
  -> pod removed from service endpoints
  -> Nginx ingress/service stops routing new requests
  -> terminationGracePeriodSeconds allows in-flight completion
```

Tapi untuk WebSocket/SSE, in-flight bisa sangat panjang. Kamu perlu policy:

- force reconnect after deployment window,
- server sends “going away” event,
- client reconnects,
- max connection lifetime,
- drain timeout.

---

## 19. Timeout Alignment Nginx + Java

### 19.1 Timeout Chain

Request melewati banyak timeout:

```text
client timeout
cloud load balancer timeout
Nginx client timeout
Nginx proxy timeout
Java server timeout
application timeout
HTTP client timeout
JDBC query timeout
database statement timeout
```

Jika tidak diselaraskan, failure sulit dibaca.

Contoh buruk:

```text
Client timeout:             30s
Nginx proxy_read_timeout:   60s
Spring controller:          no timeout
HTTP client to dependency:  no timeout
DB query timeout:           no timeout
```

Client sudah pergi di 30s, tapi backend bisa terus bekerja.

Lebih baik:

```text
client expected SLA:             2s p95, 5s max
Nginx proxy_read_timeout:        6s
application request timeout:     5s
external HTTP client timeout:    2s
DB statement timeout:            1.5s-3s depending endpoint
fallback/degradation:            explicit
```

Tidak ada angka universal. Yang penting adalah hierarki.

---

### 19.2 Timeout Budget

Desain timeout dari atas:

```text
User-facing max latency budget = 5s
```

Breakdown:

```text
Nginx overhead             50ms
Java processing budget     4500ms
Safety margin              450ms
```

Java processing:

```text
auth/cache lookup          100ms
database                   1500ms
external service           1000ms
business processing        500ms
serialization              200ms
margin                     1200ms
```

Nginx timeout harus lebih panjang dari app budget, tetapi tidak terlalu panjang sehingga zombie request menumpuk.

---

## 20. Upstream Keepalive dan Java Connection Handling

### 20.1 Apa Yang Dilakukan Upstream Keepalive

Nginx dapat menjaga koneksi ke upstream agar reusable.

```nginx
upstream app {
    server 127.0.0.1:8080;
    keepalive 64;
}

server {
    location / {
        proxy_pass http://app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

Manfaat:

- mengurangi TCP handshake,
- mengurangi latency,
- mengurangi CPU overhead,
- lebih efisien untuk traffic tinggi.

---

### 20.2 Risiko Keepalive Yang Tidak Diselaraskan

Jika Nginx menyimpan terlalu banyak idle upstream connection:

```text
Nginx workers x keepalive count x upstreams
```

bisa menghasilkan koneksi idle yang besar.

Java backend juga punya limit:

- max connections,
- accept queue,
- idle timeout,
- file descriptor,
- memory per connection.

Mismatch:

```text
Nginx upstream keepalive high
Java max connections low
multiple Nginx instances
autoscaling adds more proxies
backend connection exhaustion
```

Estimasi:

```text
Total possible idle upstream connections
= number_of_nginx_instances
  x worker_processes_per_instance
  x keepalive_per_upstream
  x number_of_upstream_groups_used
```

Jangan melihat `keepalive 64` sebagai angka kecil tanpa mengalikan seluruh topology.

---

## 21. Request Size dan Header Size Alignment

Nginx dan Java sama-sama punya limit.

Contoh Nginx:

```nginx
client_max_body_size 20m;
large_client_header_buffers 4 16k;
```

Spring/Tomcat contoh konseptual:

```yaml
server:
  max-http-request-header-size: 16KB
spring:
  servlet:
    multipart:
      max-file-size: 20MB
      max-request-size: 20MB
```

Jika Nginx limit lebih kecil:

```text
Nginx returns 413/400 before Java sees request
```

Jika Java limit lebih kecil:

```text
Nginx forwards request
Java rejects
client sees app-specific error/status
```

Mana yang lebih baik?

Biasanya, reject sedini mungkin di Nginx untuk request jelas terlalu besar. Tetapi aplikasi tetap harus punya limit sendiri sebagai defense in depth.

---

## 22. Error Mapping: Apa Yang Dilihat Client vs Apa Yang Terjadi di Java

Nginx dapat mengembalikan error tanpa Java pernah melihat request.

Contoh:

| Status | Bisa berasal dari | Java melihat request? |
|---|---|---:|
| 400 | invalid request/header too large | belum tentu |
| 403 | Nginx deny/basic auth/internal rule | tidak |
| 404 | Nginx location/static miss | belum tentu |
| 413 | body terlalu besar di Nginx | tidak |
| 499 | client close sebelum response | Java mungkin sedang proses |
| 502 | upstream bad gateway/connection reset | mungkin |
| 503 | no upstream/rate limit/custom | belum tentu |
| 504 | upstream timeout | ya, sering masih proses |

Jangan otomatis mencari semua error di log aplikasi Java. Kadang request tidak pernah sampai.

Debug order:

```text
1. Nginx access log
2. Nginx error log
3. upstream timing fields
4. Java access log
5. Java application log
6. dependency logs/metrics
```

---

## 23. Correlation ID: Kontrak Observability Nginx + Java

Nginx harus membantu membentuk request identity.

Contoh:

```nginx
map $http_x_request_id $req_id {
    default $http_x_request_id;
    ''      $request_id;
}

proxy_set_header X-Request-ID $req_id;
```

Log format:

```nginx
log_format app_json escape=json
'{'
  '"time":"$time_iso8601",'
  '"request_id":"$req_id",'
  '"remote_addr":"$remote_addr",'
  '"method":"$request_method",'
  '"uri":"$request_uri",'
  '"status":$status,'
  '"request_time":$request_time,'
  '"upstream_response_time":"$upstream_response_time",'
  '"upstream_status":"$upstream_status"'
'}';
```

Java app harus membaca `X-Request-ID` dan memasukkannya ke MDC/log context.

Spring filter contoh konseptual:

```java
String requestId = request.getHeader("X-Request-ID");
MDC.put("request_id", requestId);
try {
    chain.doFilter(request, response);
} finally {
    MDC.remove("request_id");
}
```

Tanpa correlation ID:

```text
Nginx says upstream took 4.8s
Java has 10,000 logs in same second
investigation becomes guesswork
```

---

## 24. Security Boundary Untuk Java Management Endpoint

Aplikasi Java sering punya endpoint seperti:

- `/actuator/health`,
- `/actuator/metrics`,
- `/actuator/env`,
- `/actuator/loggers`,
- `/metrics`,
- `/prometheus`,
- `/admin`,
- `/internal`.

Jangan expose semua endpoint ini lewat Nginx public server.

Contoh buruk:

```nginx
location / {
    proxy_pass http://app;
}
```

Jika app expose `/actuator/env`, bisa bocor konfigurasi.

Lebih aman:

```nginx
location /actuator/health {
    allow 10.0.0.0/8;
    deny all;
    proxy_pass http://app;
}

location /actuator/ {
    deny all;
}
```

Lebih baik lagi:

```text
public app port:     8080
management port:     8081 private only
Nginx public routes: only app port
monitoring system:   private access to management port
```

Prinsip:

> Jangan bergantung pada “endpoint tidak diketahui orang”. Eksposur management endpoint adalah desain eksplisit.

---

## 25. CORS: Jangan Duplikasi Tanpa Desain

Walaupun seri HTTP sudah membahas CORS, dalam konteks Nginx + Java ada satu hal penting:

> Jangan biarkan Nginx dan Java sama-sama mengelola CORS tanpa kontrak.

Buruk:

```text
Nginx adds Access-Control-Allow-Origin: *
Java adds Access-Control-Allow-Credentials: true
Browser rejects or security weakens
```

Atau:

```text
Nginx handles OPTIONS
Java expects to handle preflight for auth logic
behavior diverges
```

Pilih salah satu ownership:

1. CORS di Nginx untuk route sederhana dan edge-controlled API.
2. CORS di Java jika policy tergantung tenant/user/app config.
3. Hybrid hanya jika jelas route mana dimiliki siapa.

Dokumentasikan.

---

## 26. Recommended Baseline Config Untuk Java Backend

Contoh baseline, bukan template universal:

```nginx
upstream java_app {
    server 127.0.0.1:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;
}

map $http_x_request_id $req_id {
    default $http_x_request_id;
    ''      $request_id;
}

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 20m;

    access_log /var/log/nginx/api.access.log app_json;
    error_log  /var/log/nginx/api.error.log warn;

    location /actuator/ {
        deny all;
    }

    location / {
        proxy_pass http://java_app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
        proxy_set_header X-Request-ID      $req_id;

        proxy_connect_timeout 2s;
        proxy_send_timeout    30s;
        proxy_read_timeout    30s;

        proxy_buffering on;
    }
}
```

Catatan:

- Untuk SSE/WebSocket/gRPC, perlu location terpisah.
- Untuk upload besar, perlu policy khusus.
- Untuk admin/actuator, jangan expose public.
- Untuk multi-instance, upstream perlu daftar backend/service discovery.
- Untuk Kubernetes, bentuknya bisa berbeda karena Ingress Controller/Service.

---

## 27. Pattern: Split Route Berdasarkan Karakteristik Runtime

Jangan semua route memakai setting yang sama.

Lebih baik klasifikasikan route:

```text
/static/        -> Nginx static, aggressive cache
/api/           -> normal Java API, buffering on, timeout moderate
/upload/        -> body size larger, request buffering policy explicit
/download/      -> X-Accel-Redirect or streaming policy
/ws/            -> WebSocket, upgrade, long timeout
/sse/           -> buffering off, long timeout
/admin/         -> restricted access
/actuator/      -> private/deny public
```

Contoh:

```nginx
location /api/ {
    proxy_pass http://java_app;
    proxy_read_timeout 30s;
    proxy_buffering on;
}

location /sse/ {
    proxy_pass http://java_app;
    proxy_read_timeout 1h;
    proxy_buffering off;
    add_header X-Accel-Buffering no;
}

location /ws/ {
    proxy_pass http://java_app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 1h;
}

location /upload/ {
    client_max_body_size 200m;
    proxy_request_buffering on;
    proxy_pass http://java_app;
}
```

Ini lebih defensible daripada satu giant `location /` untuk semua perilaku.

---

## 28. Capacity Model: Dari Nginx ke Java

### 28.1 Basic Capacity Equation

Untuk Java servlet backend, perkiraan kasar:

```text
max useful concurrent requests per instance
≈ min(
  servlet max threads,
  JDBC pool capacity adjusted by DB latency,
  external dependency pool capacity,
  CPU capacity,
  memory/GC headroom
)
```

Nginx bisa menerima ribuan koneksi, tetapi Java instance mungkin hanya efektif menangani ratusan request aktif.

Jika:

```text
Nginx can hold 20,000 client connections
Java can process 200 concurrent expensive requests
```

maka kamu butuh:

- rate limit,
- queueing strategy,
- load shedding,
- timeout,
- autoscaling,
- endpoint classification,
- caching,
- asynchronous processing,
- atau redesign.

---

### 28.2 Contoh Perhitungan

Misal satu Spring Boot instance:

```text
Tomcat max threads: 200
JDBC pool:          50
Average DB time:    100ms
Average app time:   150ms
p95 app time:       800ms
```

Endpoint A butuh DB connection hampir sepanjang request. Maka kapasitas efektif bisa lebih dekat ke JDBC pool daripada Tomcat thread.

```text
50 DB connections -> at most around 50 DB-bound requests actively querying
```

Jika Nginx mengirim 300 concurrent request ke satu instance:

```text
200 Tomcat threads can fill
50 JDBC connections can fill
150 threads may wait for DB pool
latency rises
Nginx sees upstream_response_time rise
clients retry
system degrades
```

Solusi bukan sekadar menaikkan Tomcat thread menjadi 500. Itu bisa memperburuk DB contention.

---

## 29. Production Failure Scenarios

### 29.1 Scenario: 504 Dari Nginx, Java Masih Memproses

Gejala:

```text
Nginx access log: status=504 upstream_response_time=60.000
Java log: request completed after 83s
Client: gateway timeout
```

Penyebab:

- `proxy_read_timeout` 60s,
- Java tidak punya request timeout,
- downstream dependency lambat,
- client mungkin retry.

Perbaikan:

- set application timeout lebih pendek dari Nginx timeout,
- set DB/HTTP client timeout,
- cancel work saat client disconnect jika memungkinkan,
- return controlled error,
- tambahkan circuit breaker/fallback untuk dependency.

---

### 29.2 Scenario: 499 Naik Saat Deploy

Gejala:

```text
Nginx status 499 meningkat
Java rolling deployment sedang berjalan
WebSocket/SSE clients reconnect
```

Penyebab mungkin:

- client menutup koneksi karena deploy/drain,
- frontend timeout terlalu pendek,
- mobile network instability,
- Nginx/backend restart memutus long-lived connections.

Investigasi:

- lihat deploy timestamp,
- lihat user agent/network,
- lihat endpoint pattern,
- bedakan `/api/` biasa vs `/sse/`/`/ws/`,
- cek graceful shutdown.

---

### 29.3 Scenario: Java CPU Rendah Tapi Nginx 502/504 Tinggi

Kemungkinan:

- Java thread pool habis menunggu DB/external API,
- event loop blocked,
- JDBC pool exhausted,
- upstream connection refused karena app restarting,
- accept queue penuh,
- GC pause,
- DNS/upstream address stale,
- Nginx timeout terlalu pendek.

Jangan menyimpulkan “CPU rendah berarti aplikasi sehat”.

Untuk aplikasi I/O-bound, CPU rendah bisa berarti thread sedang menunggu.

---

### 29.4 Scenario: Secure Cookie Tidak Muncul

Gejala:

- login berhasil tapi session hilang,
- cookie tidak tersimpan,
- browser devtools menunjukkan cookie policy issue,
- redirect HTTP/HTTPS aneh.

Kemungkinan:

- app melihat request sebagai HTTP,
- forwarded proto tidak diproses,
- `Secure`/`SameSite` policy salah,
- domain/path cookie salah,
- Nginx tidak meneruskan Host asli.

Perbaikan:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

Dan aktifkan forwarded header handling di Java framework.

---

## 30. Testing Strategy

### 30.1 Test Dari Luar Boundary

Jangan hanya test Java app langsung ke port 8080.

Test path production:

```bash
curl -vk https://api.example.com/health
curl -vk https://api.example.com/api/orders
curl -vk -H 'X-Request-ID: test-123' https://api.example.com/api/orders
```

Verifikasi:

- scheme benar,
- host benar,
- redirect benar,
- cookie benar,
- request ID masuk log Java,
- client IP masuk audit log,
- error response benar,
- timeout behavior benar.

---

### 30.2 Test Header Contract

Buat endpoint internal/debug di non-production yang mengembalikan:

```json
{
  "scheme": "https",
  "serverName": "api.example.com",
  "serverPort": 443,
  "remoteAddr": "203.0.113.10",
  "requestId": "abc"
}
```

Gunakan hanya di staging atau environment aman.

Tujuan:

- memvalidasi forwarded headers,
- memvalidasi trust boundary,
- mendeteksi perubahan proxy config,
- mencegah bug redirect/cookie/OAuth.

---

### 30.3 Test Streaming

Untuk SSE:

```bash
curl -N https://api.example.com/sse/events
```

Jika event muncul bertahap, buffering kemungkinan benar.

Jika event muncul sekaligus setelah lama, buffering masih aktif.

Untuk WebSocket:

```bash
wscat -c wss://api.example.com/ws
```

Untuk upload:

```bash
dd if=/dev/zero of=/tmp/test.bin bs=1M count=50
curl -vk -F file=@/tmp/test.bin https://api.example.com/upload
```

Untuk timeout:

```bash
curl -vk https://api.example.com/debug/sleep?seconds=40
```

Hanya lakukan endpoint sleep di environment aman.

---

## 31. Checklist Production Nginx + Java

### 31.1 Header Contract

- [ ] `Host` diteruskan dengan benar.
- [ ] `X-Forwarded-For` diset dengan benar.
- [ ] `X-Forwarded-Proto` diset dengan benar.
- [ ] `X-Forwarded-Host` diset jika aplikasi membutuhkannya.
- [ ] `X-Request-ID` dibuat/dipropagasikan.
- [ ] Java app dikonfigurasi untuk memproses forwarded headers.
- [ ] App hanya mempercayai proxy header dari trusted proxy.

### 31.2 Timeout

- [ ] `proxy_connect_timeout` ditentukan.
- [ ] `proxy_read_timeout` ditentukan per route behavior.
- [ ] Java request timeout ada.
- [ ] HTTP client timeout di Java ada.
- [ ] DB query/transaction timeout ada.
- [ ] Client-facing SLA jelas.

### 31.3 Buffering

- [ ] Default API buffering dipahami.
- [ ] SSE buffering dimatikan.
- [ ] WebSocket upgrade dikonfigurasi.
- [ ] Upload endpoint punya body size policy.
- [ ] Large download tidak membebani Java jika bisa dihindari.

### 31.4 Capacity

- [ ] Tomcat/Jetty/Undertow thread pool dipahami.
- [ ] JDBC pool tidak kalah dari concurrency design.
- [ ] Upstream keepalive dihitung lintas Nginx instances/workers.
- [ ] Rate limit diterapkan untuk endpoint mahal.
- [ ] Load test melewati Nginx, bukan hanya port app langsung.

### 31.5 Security

- [ ] Management endpoint tidak public.
- [ ] Request size/header size dibatasi.
- [ ] TLS termination jelas.
- [ ] Secure cookie behavior diuji.
- [ ] CORS ownership jelas.
- [ ] Internal download menggunakan `internal`/controlled path jika perlu.

### 31.6 Observability

- [ ] Nginx access log memuat upstream timing.
- [ ] Java log memuat request ID yang sama.
- [ ] Error 499/502/504 punya runbook.
- [ ] Dashboard membedakan Nginx error dan Java error.
- [ ] Metrics Java thread pool/JDBC pool tersedia.

### 31.7 Deployment

- [ ] Readiness benar.
- [ ] Graceful shutdown aktif.
- [ ] Long-lived connection punya drain policy.
- [ ] Rolling deploy diuji.
- [ ] Upstream reload/update aman.

---

## 32. Common Anti-Patterns

### Anti-Pattern 1: Semua Route Dalam `location /`

```nginx
location / {
    proxy_pass http://app;
}
```

Masalah:

- API, upload, SSE, WebSocket, admin, static semua mendapat policy sama.
- Timeout tidak sesuai per route.
- Buffering bisa salah.
- Security endpoint bisa ikut exposed.

Lebih baik: split berdasarkan karakteristik runtime.

---

### Anti-Pattern 2: Nginx Timeout Panjang Untuk Menutupi App Lambat

```nginx
proxy_read_timeout 600s;
```

Ini sering hanya menyembunyikan masalah.

Jika endpoint memang batch job panjang, gunakan pola async:

```text
POST /jobs -> 202 Accepted + jobId
GET /jobs/{id} -> status
GET /jobs/{id}/result -> result
```

Bukan memaksa HTTP request sinkron 10 menit.

---

### Anti-Pattern 3: Menganggap 502 Selalu Bug Nginx

502 sering berarti Nginx gagal berkomunikasi dengan upstream:

- app down,
- connection refused,
- upstream reset,
- protocol mismatch,
- app crash,
- bad response,
- reload/deploy timing.

Nginx adalah messenger. Jangan tembak messenger sebelum melihat upstream.

---

### Anti-Pattern 4: Trust Semua `X-Forwarded-For`

Buruk:

```java
String ip = request.getHeader("X-Forwarded-For");
```

Tanpa validasi trusted proxy, user bisa memalsukan IP.

Lebih aman:

- Nginx overwrite/appends secara konsisten.
- App framework memproses forwarded header hanya dari trusted proxy.
- Edge layer membersihkan header spoofed jika perlu.

---

### Anti-Pattern 5: Health Check Memanggil Semua Dependency Berat

Buruk:

```text
/health checks DB, Redis, Kafka, third-party API, S3, payment gateway
```

Jika satu dependency flapping, semua pod dianggap not ready, traffic bisa kolaps.

Lebih baik:

- readiness: apakah instance bisa menerima traffic dasar,
- dependency health: metrics/alert terpisah,
- business synthetic: monitor terpisah,
- liveness: proses deadlock/crash, bukan dependency status.

---

## 33. Latihan Praktis

### Latihan 1 — Header Contract Verification

Buat endpoint staging `/debug/request-info` di Java app yang mengembalikan:

- scheme,
- host,
- port,
- remote address,
- forwarded headers,
- request ID.

Test lewat Nginx dan langsung ke app. Bandingkan hasilnya.

Pertanyaan:

- Apakah app melihat scheme sebagai `https`?
- Apakah host benar?
- Apakah client IP benar?
- Apakah request ID masuk log Java?

---

### Latihan 2 — SSE Buffering

Buat endpoint SSE yang mengirim event setiap 1 detik.

Test:

```bash
curl -N https://your-domain/sse/events
```

Kemudian aktifkan dan matikan `proxy_buffering`.

Amati:

- apakah event muncul real-time,
- apakah muncul sekaligus,
- bagaimana access log mencatat request time.

---

### Latihan 3 — Timeout Alignment

Buat endpoint staging:

```text
/debug/sleep?seconds=10
/debug/sleep?seconds=40
/debug/sleep?seconds=70
```

Set:

```nginx
proxy_read_timeout 30s;
```

Amati:

- response 10 detik,
- response 40 detik,
- log Nginx,
- log Java,
- apakah Java tetap berjalan setelah Nginx timeout.

---

### Latihan 4 — Upload Boundary

Test upload file 5 MB, 20 MB, 50 MB.

Atur:

```nginx
client_max_body_size 20m;
```

Atur Java multipart limit juga 20 MB.

Pertanyaan:

- Siapa yang mengembalikan 413?
- Apakah response error konsisten?
- Apakah Nginx temp directory aman?
- Apakah log cukup menjelaskan?

---

### Latihan 5 — Graceful Shutdown

Di staging:

1. Jalankan request yang tidur 20 detik.
2. Trigger deployment/restart Java app.
3. Lihat apakah request selesai atau terputus.
4. Cek Nginx status: 499, 502, 504?
5. Cek Java shutdown log.

Tujuan: validasi drain behavior.

---

## 34. Ringkasan Mental Model

Nginx di depan Java app bukan hanya reverse proxy pasif.

Ia adalah boundary yang menentukan:

- request mana boleh masuk,
- header apa yang dipercaya,
- scheme/host/IP apa yang dilihat app,
- timeout mana yang menang,
- siapa menahan slow client,
- siapa menahan upload body,
- siapa men-stream response,
- bagaimana error muncul ke client,
- bagaimana request dilacak,
- bagaimana deployment tidak memutus traffic.

Untuk Java engineer, kunci utamanya:

```text
Nginx capacity != Java capacity
Nginx timeout != app timeout
Nginx sees network truth
Java sees application truth
Proxy headers bridge both worlds
Buffering changes runtime behavior
Long-lived traffic needs separate policy
Health and readiness determine routing safety
```

Jika kamu memahami boundary ini, kamu bisa mendesain sistem yang lebih stabil, lebih mudah di-debug, dan lebih aman saat traffic production nyata datang.

---

## 35. Checklist Sebelum Lanjut

Sebelum masuk ke part berikutnya, pastikan kamu bisa menjawab:

1. Apa perbedaan runtime model Nginx dan servlet container?
2. Kenapa forwarded header harus dianggap kontrak, bukan detail teknis kecil?
3. Apa risiko jika Nginx buffering aktif untuk SSE?
4. Apa risiko jika request upload besar langsung diteruskan streaming ke servlet app?
5. Kenapa 504 dari Nginx tidak berarti Java berhenti bekerja?
6. Bagaimana menghitung risiko upstream keepalive lintas banyak Nginx worker/instance?
7. Kenapa readiness tidak sama dengan liveness?
8. Bagaimana graceful shutdown mencegah 502 saat deployment?
9. Kenapa route WebSocket tidak boleh diperlakukan seperti API biasa?
10. Bagaimana menghubungkan access log Nginx dengan log Java?

Jika jawabanmu sudah jelas, kamu siap masuk ke Part 022.

---

# Status Seri

- Part 000: selesai
- Part 001: selesai
- Part 002: selesai
- Part 003: selesai
- Part 004: selesai
- Part 005: selesai
- Part 006: selesai
- Part 007: selesai
- Part 008: selesai
- Part 009: selesai
- Part 010: selesai
- Part 011: selesai
- Part 012: selesai
- Part 013: selesai
- Part 014: selesai
- Part 015: selesai
- Part 016: selesai
- Part 017: selesai
- Part 018: selesai
- Part 019: selesai
- Part 020: selesai
- Part 021: selesai
- Part 022: berikutnya

Seri **belum selesai**. Masih ada Part 022 sampai Part 030.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-020.md">⬅️ Part 020 — Debugging Nginx Like a Production Engineer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-022.md">Part 022 — WebSocket, SSE, gRPC, and Long-Lived Connections ➡️</a>
</div>
