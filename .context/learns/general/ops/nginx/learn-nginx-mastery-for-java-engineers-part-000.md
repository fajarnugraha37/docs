# learn-nginx-mastery-for-java-engineers-part-000

# Part 000 — Orientation: Nginx as Traffic Runtime, Not Just Web Server

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Target pembaca: Java Software Engineer / Backend Engineer / Tech Lead  
> Fokus: Nginx sebagai runtime traffic layer untuk sistem backend modern  
> Status seri: Part 000 dari 030  
> Catatan: Seri belum selesai. Ini adalah bagian pertama/orientasi.

---

## 0. Tujuan Part Ini

Part ini bukan tutorial konfigurasi `server { location / { ... } }` biasa.

Tujuan Part 000 adalah membentuk **mental model awal** supaya ketika nanti melihat konfigurasi Nginx yang kompleks, kamu tidak membacanya sebagai kumpulan snippet acak, tetapi sebagai **program traffic-control** yang menentukan:

- request mana diterima,
- host mana dipilih,
- route mana cocok,
- header apa dipercaya,
- upstream mana dipanggil,
- timeout mana berlaku,
- response mana di-cache,
- connection mana dipertahankan,
- traffic mana ditolak,
- log mana ditulis,
- dan failure mana akan terlihat sebagai 400, 403, 404, 413, 499, 502, 503, atau 504.

Di akhir part ini, kamu diharapkan memahami:

1. Apa itu Nginx secara arsitektural.
2. Mengapa Nginx penting untuk Java backend engineer.
3. Peran Nginx dalam sistem modern.
4. Batasan Nginx: apa yang cocok dan tidak cocok ditaruh di Nginx.
5. Cara berpikir tentang Nginx sebagai **traffic runtime**.
6. Peta besar seluruh seri.
7. Cara belajar seri ini secara efisien tanpa mengulang materi HTTP yang sudah pernah dibahas.

---

## 1. Apa Itu Nginx?

Secara sederhana, Nginx adalah software server yang dapat berperan sebagai:

- **web server** untuk static content,
- **reverse proxy** untuk meneruskan request ke backend,
- **load balancer** untuk membagi traffic ke beberapa instance aplikasi,
- **HTTP cache** untuk menyimpan response tertentu,
- **TLS terminator** untuk mengakhiri koneksi HTTPS,
- **TCP/UDP proxy** melalui stream module,
- **mail proxy** untuk protokol seperti IMAP, POP3, dan SMTP,
- dan dalam beberapa kasus sebagai **lightweight API gateway**.

Dokumentasi resmi Nginx menyebut Nginx sebagai HTTP web server, reverse proxy, content cache, load balancer, TCP/UDP proxy server, dan mail proxy server. Dokumentasi resminya juga menjelaskan bahwa Nginx menggunakan satu master process dan beberapa worker process, serta menggunakan mekanisme event-based dan OS-dependent untuk mendistribusikan request secara efisien ke worker process.

Referensi resmi:

- Nginx official site: <https://nginx.org/en/>
- Nginx beginner guide: <https://nginx.org/en/docs/beginners_guide.html>
- Nginx documentation index: <https://nginx.org/en/docs/>

Namun definisi itu masih terlalu permukaan.

Untuk backend engineer, definisi yang lebih berguna adalah:

> **Nginx adalah traffic runtime di depan aplikasi yang menjalankan keputusan routing, security, connection management, timeout, buffering, caching, observability, dan failover sebelum request menyentuh kode aplikasi.**

Artinya, Nginx bukan hanya “server untuk deploy website”. Nginx adalah bagian dari **execution path** request. Ia ikut menentukan perilaku sistem.

Jika aplikasi Java kamu menerima request, kemungkinan besar request itu sudah melewati beberapa layer seperti:

```text
Client / Browser / Mobile App
        |
        v
DNS
        |
        v
CDN / Cloud Load Balancer / WAF
        |
        v
Nginx / Ingress / Reverse Proxy
        |
        v
Java Application
        |
        v
Database / Queue / External Service
```

Di banyak sistem, Nginx berada di titik kritis antara dunia luar dan aplikasi internal.

Karena itu, kesalahan kecil di Nginx bisa menyebabkan efek besar:

- aplikasi terlihat down padahal proses Java sehat,
- login gagal karena cookie atau scheme salah,
- redirect loop karena `X-Forwarded-Proto` salah,
- file upload gagal karena body size limit,
- WebSocket putus setiap 60 detik karena timeout default,
- service A overload karena load balancing tidak sesuai pola traffic,
- user menerima data private karena cache key salah,
- incident sulit dianalisis karena log tidak memuat upstream timing.

Nginx adalah layer kecil, tetapi daya ungkitnya besar.

---

## 2. Kenapa Java Engineer Perlu Menguasai Nginx?

Banyak Java engineer fokus pada:

- Spring Boot,
- REST API,
- JPA/Hibernate,
- Kafka,
- database,
- concurrency,
- JVM tuning,
- microservices,
- Kubernetes.

Semua itu penting. Tetapi di production, aplikasi Java jarang berdiri sendiri langsung di internet. Biasanya ada layer traffic control di depannya. Nginx sering menjadi salah satu layer tersebut.

### 2.1 Karena Bug Production Sering Terlihat Seperti Bug Aplikasi, Padahal Bukan

Contoh:

#### Kasus 1 — Spring Boot redirect ke HTTP, bukan HTTPS

User mengakses:

```text
https://app.example.com/login
```

Tetapi setelah login, aplikasi redirect ke:

```text
http://app.example.com/home
```

Tim backend melihat kode Java dan tidak menemukan masalah.

Akar masalahnya bisa jadi:

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
```

Jika Nginx menerima request dari load balancer via HTTP, maka `$scheme` bisa menjadi `http`, walaupun user luar memakai HTTPS. Aplikasi Java lalu mengira original request adalah HTTP.

Solusinya bukan hanya “ubah kode Java”, tetapi memahami kontrak antara proxy dan aplikasi.

#### Kasus 2 — Client IP selalu IP Nginx

Aplikasi audit log mencatat semua request dari:

```text
10.0.1.15
```

Padahal itu IP Nginx, bukan IP user.

Akar masalahnya bisa berupa:

- Nginx tidak mengirim `X-Forwarded-For`,
- aplikasi tidak dikonfigurasi untuk mempercayai proxy header,
- chain proxy tidak jelas,
- atau header dari client tidak dibersihkan sehingga spoofable.

#### Kasus 3 — 502 Bad Gateway saat deploy

Java app restart 20 detik. Nginx masih mengirim request ke upstream yang belum ready. User melihat 502.

Masalah bukan hanya “aplikasi restart”, tetapi koordinasi antara:

- readiness,
- graceful shutdown,
- upstream connection,
- retry policy,
- load balancer health,
- deployment strategy.

#### Kasus 4 — Upload file 50 MB gagal

Aplikasi Java sudah mendukung upload 50 MB. Tetapi user menerima:

```text
413 Request Entity Too Large
```

Akar masalahnya bisa di Nginx:

```nginx
client_max_body_size 1m;
```

Aplikasi tidak pernah menerima request itu.

#### Kasus 5 — API lambat, tetapi Java metrics normal

Grafana aplikasi menunjukkan response time backend 80 ms. User merasakan 3 detik.

Bisa jadi waktu hilang di:

- client upload body,
- Nginx buffering,
- queueing connection,
- slow client download,
- TLS handshake,
- upstream connection establishment,
- DNS resolution,
- cache lock,
- rate limiting,
- atau network antara Nginx dan upstream.

Tanpa Nginx observability, analisis latency tidak lengkap.

---

## 3. Posisi Nginx dalam Arsitektur Modern

Nginx bisa muncul di banyak posisi. Jangan menganggap Nginx hanya satu bentuk.

### 3.1 Nginx sebagai Edge Reverse Proxy

Pola:

```text
Internet
   |
   v
Nginx
   |
   v
Java Application
```

Ini pola paling sederhana.

Nginx bertugas:

- menerima koneksi client,
- terminate TLS,
- redirect HTTP ke HTTPS,
- meneruskan request ke backend Java,
- menambah proxy headers,
- membatasi ukuran body,
- menulis access log,
- menyajikan error page.

Cocok untuk:

- VM-based deployment,
- monolith Spring Boot,
- small-to-medium internal platform,
- single domain aplikasi.

### 3.2 Nginx sebagai Static Server + API Proxy

Pola:

```text
Browser
   |
   v
Nginx
   |-----------------> static files: index.html, JS, CSS, images
   |
   +-----------------> /api/* -> Java Backend
```

Contoh:

```text
GET /                -> serve Vue/React app
GET /assets/app.js   -> serve static asset
GET /api/orders      -> proxy to Spring Boot
```

Nginx menjadi boundary antara frontend static artifact dan backend API.

Cocok untuk:

- SPA deployment,
- admin dashboard,
- internal tools,
- public frontend dengan backend Java.

### 3.3 Nginx sebagai Load Balancer

Pola:

```text
Nginx
   |
   +--> app-1:8080
   +--> app-2:8080
   +--> app-3:8080
```

Nginx upstream block dapat mendistribusikan request ke beberapa server. Dokumentasi resmi Nginx menjelaskan metode load balancing seperti round-robin, least-connected, dan ip-hash. Default-nya, jika tidak dikonfigurasi metode khusus, Nginx menggunakan round-robin.

Contoh resmi sederhana:

```nginx
http {
    upstream myapp1 {
        server srv1.example.com;
        server srv2.example.com;
        server srv3.example.com;
    }

    server {
        listen 80;

        location / {
            proxy_pass http://myapp1;
        }
    }
}
```

Referensi:

- <https://nginx.org/en/docs/http/load_balancing.html>

### 3.4 Nginx sebagai TLS Terminator

Pola:

```text
Client --HTTPS--> Nginx --HTTP--> Java App
```

Atau:

```text
Client --HTTPS--> Nginx --HTTPS--> Java App
```

Nginx mengelola:

- certificate,
- private key,
- TLS protocol,
- ciphers,
- SNI,
- HTTP/2 negotiation,
- HSTS,
- redirect HTTP to HTTPS.

Java app bisa dibuat lebih sederhana karena tidak langsung mengelola TLS publik. Tetapi konsekuensinya, aplikasi harus diberi tahu original scheme melalui proxy header.

### 3.5 Nginx sebagai Cache

Pola:

```text
Client
   |
   v
Nginx Cache
   |
   v
Java Backend
```

Nginx dapat menyimpan response tertentu sehingga request berikutnya tidak perlu mencapai Java backend.

Manfaat:

- mengurangi beban backend,
- menurunkan latency,
- memberi resilience saat backend lambat,
- melindungi upstream dari traffic spike.

Risiko:

- data private bocor jika cache key salah,
- response lama tersaji terlalu lama,
- invalidation sulit,
- bug terasa seperti bug aplikasi padahal cache stale.

### 3.6 Nginx sebagai Lightweight API Gateway

Nginx dapat melakukan beberapa fungsi gateway:

- route by path,
- route by host,
- route by header,
- rate limit,
- basic auth,
- auth subrequest,
- request size limit,
- CORS headers,
- header transformation,
- traffic splitting sederhana,
- log enrichment.

Tetapi Nginx bukan selalu pengganti API gateway khusus.

Jika kamu butuh fitur seperti:

- developer portal,
- API product management,
- dynamic consumer registry,
- advanced policy engine,
- OAuth/OIDC flow lengkap,
- per-consumer analytics,
- monetization,
- schema-aware validation,
- dynamic config tanpa reload,

maka dedicated API gateway seperti Kong, Apigee, Tyk, KrakenD, Envoy-based gateway, atau cloud API gateway mungkin lebih sesuai.

### 3.7 Nginx sebagai TCP/UDP Proxy

Nginx tidak hanya HTTP. Dokumentasi resmi menyediakan bagian “How nginx processes a TCP/UDP session”, dan NGINX admin guide menjelaskan TCP/UDP load balancing dengan stream module.

Pola:

```text
Client TCP/UDP
   |
   v
Nginx stream
   |
   +--> backend-1
   +--> backend-2
```

Use case:

- TLS passthrough,
- TCP load balancing,
- UDP load balancing,
- routing berbasis SNI pada layer 4,
- proxy untuk protokol non-HTTP tertentu.

Tetapi untuk database atau broker seperti PostgreSQL, MySQL, Redis, Kafka, dan RabbitMQ, pemakaian Nginx stream perlu hati-hati karena masing-masing protokol punya semantics koneksi, transaction, authentication, cluster awareness, dan failure behavior sendiri.

---

## 4. Mental Model Utama: Nginx sebagai Deterministic Traffic State Machine

Cara paling berguna untuk memahami Nginx adalah melihatnya sebagai **state machine**.

Request masuk ke Nginx dan melewati serangkaian keputusan deterministik.

Secara konseptual:

```text
connection accepted
    |
    v
TLS handshake? SNI? ALPN?
    |
    v
choose server block
    |
    v
parse request line and headers
    |
    v
match location
    |
    v
apply rewrite / access / auth / limit / body rules
    |
    v
serve static OR proxy upstream OR return response
    |
    v
read upstream response
    |
    v
buffer/cache/filter/log
    |
    v
send response to client
```

Setiap tahap punya input, aturan, output, dan failure mode.

### 4.1 State 1 — Connection Accepted

Nginx menerima koneksi TCP dari client atau dari proxy sebelumnya.

Pertanyaan penting:

- Port mana yang menerima koneksi?
- Berapa banyak worker yang tersedia?
- Apakah file descriptor cukup?
- Apakah backlog penuh?
- Apakah client lambat?
- Apakah connection akan keepalive?

Failure yang mungkin:

- connection refused,
- timeout sebelum request lengkap,
- worker connection exhaustion,
- SYN backlog penuh,
- terlalu banyak open files.

### 4.2 State 2 — TLS Handshake

Jika listener menggunakan TLS, Nginx melakukan handshake.

Pertanyaan penting:

- Certificate mana dipilih?
- SNI cocok ke server block mana?
- TLS version diterima?
- Cipher cocok?
- ALPN memilih HTTP/1.1, HTTP/2, atau HTTP/3?

Failure yang mungkin:

- certificate expired,
- certificate chain tidak lengkap,
- hostname mismatch,
- client tidak support protocol/cipher,
- SNI tidak cocok,
- handshake timeout.

### 4.3 State 3 — Server Selection

Nginx memilih `server` block berdasarkan:

- listen address,
- port,
- `server_name`,
- default server,
- Host header,
- dan untuk TLS, SNI pada tahap handshake.

Kesalahan di tahap ini menyebabkan:

- request domain A masuk config domain B,
- certificate salah,
- default virtual host mengekspos aplikasi yang tidak dimaksud,
- unknown host tetap dilayani.

### 4.4 State 4 — Request Parsing

Nginx membaca request line dan header.

Di sini Nginx dapat menolak request sebelum menyentuh aplikasi.

Contoh failure:

- header terlalu besar,
- URI terlalu panjang,
- invalid method,
- malformed request,
- body melebihi limit.

### 4.5 State 5 — Location Matching

Setelah server block dipilih, Nginx memilih `location`.

Contoh:

```nginx
location /api/ {
    proxy_pass http://backend;
}

location /assets/ {
    root /var/www/app;
}

location / {
    try_files $uri /index.html;
}
```

Ini tampak sederhana, tetapi location matching adalah sumber banyak bug production.

Kesalahan umum:

- `/api` jatuh ke SPA fallback,
- regex location mengalahkan prefix yang diharapkan,
- `alias` salah path,
- trailing slash pada `proxy_pass` mengubah URI secara tak terduga.

### 4.6 State 6 — Policy Enforcement

Di tahap ini Nginx dapat menjalankan:

- rate limit,
- connection limit,
- IP allow/deny,
- basic auth,
- auth request,
- request body limit,
- header manipulation,
- rewrite,
- redirect.

Pertanyaan penting:

- Apakah policy berbasis IP valid jika user berada di balik NAT?
- Apakah header yang dipakai bisa dipalsukan client?
- Apakah policy dipasang di context yang benar?
- Apakah policy inherited atau overwritten?

### 4.7 State 7 — Content Handler

Nginx akhirnya memilih cara menghasilkan response:

- serve static file,
- proxy ke HTTP upstream,
- proxy ke FastCGI/uWSGI/SCGI/gRPC,
- return response langsung,
- redirect,
- internal redirect,
- cache hit,
- error page.

Inilah titik di mana Nginx menjadi server, proxy, cache, atau gateway.

### 4.8 State 8 — Upstream Interaction

Jika request diproxy, Nginx harus:

- memilih upstream,
- membuka atau menggunakan koneksi upstream,
- mengirim request,
- menunggu response header,
- membaca response body,
- menerapkan timeout,
- melakukan retry jika dikonfigurasi,
- menandai upstream gagal jika perlu.

Failure umum:

- 502 Bad Gateway,
- 503 Service Unavailable,
- 504 Gateway Timeout,
- upstream prematurely closed connection,
- no live upstreams,
- connect refused,
- DNS resolution failure.

### 4.9 State 9 — Response Filtering, Buffering, Caching

Sebelum response dikirim ke client, Nginx dapat:

- buffer response,
- compress response,
- cache response,
- rewrite headers,
- add security headers,
- stream response,
- transform error response.

Trade-off:

- buffering melindungi upstream dari slow client, tetapi buruk untuk streaming,
- compression menghemat bandwidth, tetapi memakai CPU,
- caching menurunkan latency, tetapi berisiko stale/private leak,
- header modification membantu security, tetapi bisa mematahkan aplikasi jika tidak konsisten.

### 4.10 State 10 — Logging and Finalization

Akhirnya Nginx menulis log.

Log yang baik harus menjawab:

- client siapa,
- request apa,
- status apa,
- upstream mana,
- berapa lama connect ke upstream,
- berapa lama menunggu response header,
- berapa lama total response,
- berapa byte dikirim,
- request id apa,
- apakah cache hit/miss,
- apakah rate limited.

Tanpa log yang benar, Nginx menjadi blind spot.

---

## 5. Nginx Bukan Sekadar Konfigurasi, tetapi Boundary Contract

Dalam sistem Java, Nginx membentuk kontrak antara client dan aplikasi.

Kontrak itu meliputi:

1. **Protocol contract**  
   Apakah client pakai HTTP/1.1, HTTP/2, HTTPS, WebSocket, atau gRPC?

2. **Identity contract**  
   Dari mana aplikasi tahu client IP, host, scheme, user identity, dan request id?

3. **Routing contract**  
   Path mana masuk service mana?

4. **Timeout contract**  
   Berapa lama client boleh upload? Berapa lama upstream boleh menjawab?

5. **Payload contract**  
   Berapa besar request body? Header sebesar apa diterima? MIME mana dikompresi?

6. **Security contract**  
   Header apa dibersihkan? Endpoint mana diblokir? TLS seperti apa diterima?

7. **Observability contract**  
   Field apa wajib muncul di log? Request id diteruskan atau dibuat baru?

8. **Failure contract**  
   Jika upstream mati, apakah retry? Status apa dikembalikan? Error page apa muncul?

9. **Deployment contract**  
   Saat app rolling restart, bagaimana Nginx memilih upstream? Bagaimana connection drain?

10. **Cache contract**  
   Response mana boleh disimpan, berdasarkan key apa, dan kapan stale boleh dipakai?

Jika kontrak ini tidak eksplisit, maka production behavior menjadi hasil kebetulan.

Engineer top-tier tidak memperlakukan Nginx sebagai “config deployment”. Mereka memperlakukannya sebagai **interface yang harus didesain, diuji, dan dioperasikan**.

---

## 6. Perbedaan Cara Berpikir: Beginner vs Production Engineer

### 6.1 Beginner Thinking

Beginner biasanya bertanya:

> “Snippet Nginx untuk reverse proxy Spring Boot apa?”

Lalu memakai config seperti:

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://localhost:8080;
    }
}
```

Ini bisa berjalan untuk demo.

Tetapi config ini belum menjawab:

- Apakah Host diteruskan?
- Apakah client IP benar?
- Apakah scheme HTTPS diketahui aplikasi?
- Bagaimana timeout?
- Bagaimana upload besar?
- Bagaimana WebSocket?
- Bagaimana log upstream timing?
- Bagaimana graceful reload?
- Bagaimana 502 saat deploy?
- Bagaimana body buffering?
- Bagaimana health check?
- Bagaimana error page?
- Bagaimana security headers?

### 6.2 Production Thinking

Production engineer bertanya:

> “Apa kontrak traffic antara client, Nginx, dan aplikasi, dan bagaimana kontrak itu gagal?”

Maka reverse proxy minimal production-aware terlihat lebih seperti:

```nginx
upstream app_backend {
    server 127.0.0.1:8080;
    keepalive 32;
}

server {
    listen 80;
    server_name example.com;

    access_log /var/log/nginx/example.access.log main;
    error_log  /var/log/nginx/example.error.log warn;

    client_max_body_size 20m;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID      $request_id;

        proxy_connect_timeout 3s;
        proxy_send_timeout    30s;
        proxy_read_timeout    30s;

        proxy_pass http://app_backend;
    }
}
```

Ini pun belum final. Tetapi sudah mulai menyatakan kontrak.

---

## 7. Apa yang Tidak Akan Kita Ulang dari Seri HTTP Sebelumnya

Karena kamu sudah punya seri HTTP frontend dan backend, bagian Nginx ini tidak akan mengulang detail seperti:

- apa itu HTTP method,
- arti umum status code,
- struktur umum request/response,
- REST API design,
- browser caching dasar,
- CORS dari perspektif browser secara panjang,
- cookie/session dari nol,
- TLS theory sangat mendalam,
- general API design.

Namun kita akan tetap menyentuh topik-topik itu jika ada efek langsung ke Nginx.

Contoh:

- Bukan mengulang “apa itu 502”, tetapi membahas **mengapa Nginx menghasilkan 502**.
- Bukan mengulang “apa itu cache-control”, tetapi membahas **bagaimana Nginx cache key bisa membocorkan data**.
- Bukan mengulang “apa itu TLS”, tetapi membahas **bagaimana TLS termination memengaruhi Spring Boot redirect URL**.
- Bukan mengulang “apa itu WebSocket”, tetapi membahas **kenapa WebSocket putus di balik Nginx**.

---

## 8. Peran Nginx dalam Sistem Java

Untuk Java engineer, Nginx sering menyentuh area-area berikut.

### 8.1 Spring Boot Behind Nginx

Pola umum:

```text
Nginx :443
   |
   v
Spring Boot :8080
```

Masalah khas:

- aplikasi tidak tahu original scheme HTTPS,
- absolute redirect salah,
- generated link salah,
- actuator endpoint tidak dilindungi,
- request body besar ditolak Nginx,
- WebSocket/SSE tidak bekerja karena buffering/timeout,
- log aplikasi kehilangan request id.

### 8.2 Java Thread Pool vs Nginx Event Loop

Nginx worker event loop sangat efisien menangani banyak connection. Java application server biasanya punya thread pool atau event loop sendiri tergantung stack:

- Tomcat: thread-per-request model dengan connector thread pool.
- Jetty: thread pool dengan async support.
- Undertow: XNIO/event-driven dengan worker threads.
- Netty: event loop.
- Spring WebFlux: reactive stack di atas Netty atau server lain.

Ini memengaruhi desain timeout dan buffering.

Contoh:

- Jika Nginx buffering request body, Java app baru menerima request setelah body selesai diterima Nginx.
- Jika buffering dimatikan, Java app menghadapi slow client langsung.
- Jika Nginx proxy timeout lebih pendek dari aplikasi, user menerima 504 walaupun aplikasi akhirnya berhasil.
- Jika aplikasi timeout lebih pendek dari Nginx, Nginx bisa melihat upstream close/502.

### 8.3 Graceful Shutdown

Saat rolling deployment:

```text
Nginx -> app-v1
Nginx -> app-v2
```

Jika Java app menerima SIGTERM dan langsung mati, Nginx bisa mendapat connection reset.

Production-grade deployment butuh koordinasi:

- readiness turun sebelum shutdown,
- app berhenti menerima request baru,
- in-flight request selesai,
- Nginx/load balancer berhenti mengirim traffic,
- connection idle ditutup dengan aman,
- timeout drain cukup.

### 8.4 Observability End-to-End

Request id harus mengalir:

```text
Client -> Nginx -> Java App -> downstream services
```

Jika Nginx membuat `$request_id`, Java app harus menerimanya melalui header, misalnya:

```text
X-Request-ID: <id>
```

Lalu Java app memasukkan ID itu ke MDC/log context.

Tanpa itu, debugging distributed request menjadi sulit.

---

## 9. Nginx sebagai Control Plane? Data Plane? Atau Keduanya?

Istilah ini penting.

### 9.1 Data Plane

Data plane adalah bagian yang dilewati traffic runtime.

Nginx worker process adalah data plane karena ia benar-benar menerima request dan mengirim response.

```text
client request -> nginx worker -> upstream app
```

### 9.2 Control Plane

Control plane adalah bagian yang mengatur konfigurasi dan policy.

Dalam Nginx open source tradisional, control plane biasanya berupa:

- file config,
- template,
- CI/CD pipeline,
- config reload,
- Kubernetes ConfigMap/Ingress resource,
- Ansible/Terraform/Helm,
- manual operator command.

Nginx master process membaca dan mengevaluasi konfigurasi, lalu menjaga worker process. Dokumentasi resmi menjelaskan bahwa master process bertugas membaca dan mengevaluasi configuration files serta memelihara worker process, sementara worker process melakukan actual processing of requests.

Referensi:

- <https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/>
- <https://nginx.org/en/docs/beginners_guide.html>

### 9.3 Kenapa Ini Penting?

Karena banyak masalah Nginx bukan masalah “data plane lambat”, melainkan “control plane buruk”.

Contoh:

- Config tidak versioned.
- Reload manual tanpa review.
- Tidak ada `nginx -t` di CI.
- Include file saling override.
- Default server tidak jelas.
- Sertifikat diperbarui tapi Nginx belum reload.
- Kubernetes ConfigMap berubah, tapi pod tidak reload.
- Template environment salah mengganti upstream hostname.

Top-tier engineer mengelola Nginx config seperti code.

---

## 10. Anatomy of an Nginx Deployment

Sebelum belajar detail, kita perlu melihat komponen deployment Nginx.

### 10.1 Process

Nginx umumnya berjalan dengan:

- satu master process,
- beberapa worker process,
- optional cache loader/manager jika caching aktif.

Official Nginx docs menyatakan Nginx punya one master process and one or more worker processes; jika caching aktif, cache loader dan cache manager juga berjalan saat startup.

### 10.2 Config File

Default config biasanya bernama `nginx.conf` dan berada di salah satu lokasi seperti:

- `/etc/nginx/nginx.conf`,
- `/usr/local/nginx/conf/nginx.conf`,
- `/usr/local/etc/nginx/nginx.conf`.

Nginx configuration terdiri dari directive dan parameter. Simple directive berakhir dengan `;`, sedangkan block directive menggunakan `{}`. Dokumentasi resmi juga menjelaskan context seperti main, events, http, server, dan location.

Referensi:

- <https://nginx.org/en/docs/beginners_guide.html>
- <https://docs.nginx.com/nginx/admin-guide/basic-functionality/managing-configuration-files/>

### 10.3 Logs

Biasanya ada:

- access log,
- error log.

Access log menjawab “apa yang terjadi pada request”.

Error log menjawab “apa yang salah pada proses Nginx”.

### 10.4 Runtime Control

Nginx dapat dikontrol dengan signal:

```bash
nginx -s reload
nginx -s quit
nginx -s stop
nginx -s reopen
```

Dokumentasi resmi menjelaskan bahwa saat reload, master process memeriksa syntax validity dan mencoba menerapkan konfigurasi baru. Jika gagal, perubahan di-rollback dan Nginx tetap memakai konfigurasi lama. Jika berhasil, master memulai worker baru dan meminta worker lama shutdown secara graceful.

Referensi:

- <https://nginx.org/en/docs/control.html>
- <https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/>

Ini sangat penting: reload Nginx tidak sama dengan restart brutal. Proper reload adalah operasi production-safe jika config valid dan deployment discipline benar.

---

## 11. Nginx sebagai Layer dengan Failure Semantics Sendiri

Aplikasi Java mungkin sehat, tetapi sistem tetap gagal karena Nginx memiliki failure semantics sendiri.

### 11.1 Failure Sebelum Request Mencapai Java

Contoh:

- TLS handshake gagal.
- Header terlalu besar.
- Body terlalu besar.
- IP diblokir.
- Rate limit aktif.
- Location salah.
- Static file tidak ditemukan.
- Request diarahkan ke default server salah.

Dalam kasus ini, Java app tidak tahu apa-apa.

### 11.2 Failure Saat Menghubungi Java

Contoh:

- upstream connection refused,
- upstream timeout,
- upstream reset connection,
- DNS resolution gagal,
- no live upstreams,
- proxy buffer error,
- upstream response header terlalu besar.

Java app mungkin down, lambat, atau salah protokol. Tetapi Nginx yang menerjemahkan failure itu ke status tertentu.

### 11.3 Failure Setelah Java Menghasilkan Response

Contoh:

- client disconnect,
- slow client,
- cache write gagal,
- disk penuh karena cache/log,
- compression overhead terlalu besar,
- response buffering besar.

Di sini aplikasi bisa mengira berhasil, tetapi user belum tentu menerima response.

### 11.4 Status Code yang Sering Menjadi Sinyal Nginx

Beberapa status yang sering muncul dalam konteks Nginx:

| Status | Makna umum di Nginx context |
|---|---|
| 400 | Request malformed, header invalid, atau protocol issue |
| 403 | Access denied, directory listing forbidden, permission issue |
| 404 | File/location tidak ditemukan atau fallback salah |
| 413 | Request body terlalu besar |
| 499 | Client closed request sebelum Nginx selesai merespons |
| 500 | Internal error di Nginx atau upstream tergantung context |
| 502 | Bad gateway; Nginx gagal mendapat response valid dari upstream |
| 503 | Service unavailable, no upstream, limit, maintenance, atau overload |
| 504 | Gateway timeout; upstream tidak menjawab tepat waktu |

Catatan: arti final harus selalu dibaca bersama error log dan access log. Status code sendiri tidak cukup.

---

## 12. Nginx dan “Path of Least Surprise”

Salah satu prinsip penting konfigurasi Nginx:

> Config yang baik membuat request path mudah diprediksi.

Jika engineer membaca config, ia harus bisa menjawab:

- request `GET /api/orders` masuk ke mana?
- request `GET /assets/app.js` masuk ke mana?
- request unknown host dilayani atau ditolak?
- request body 30 MB diterima atau ditolak?
- request WebSocket upgrade tetap hidup berapa lama?
- jika backend lambat 45 detik, apa yang terjadi?
- jika user disconnect, apa yang dicatat?
- jika upstream A down, apakah request dicoba ke upstream B?

Jika jawabannya harus “coba saja di production”, config itu buruk.

---

## 13. Core Operating Questions

Saat mendesain Nginx, pakai pertanyaan berikut.

### 13.1 Request Ownership

- Siapa pemilik domain/path ini?
- Apakah path dilayani Nginx langsung atau backend?
- Apakah route ini public, internal, admin, atau health?

### 13.2 Trust Boundary

- Dari mana request berasal?
- Proxy sebelumnya siapa?
- Header mana boleh dipercaya?
- Apakah `X-Forwarded-For` dari client dibersihkan?
- Apakah Nginx menerima traffic langsung dari internet atau hanya dari load balancer?

### 13.3 Failure Budget

- Berapa timeout connect ke upstream?
- Berapa timeout read response?
- Apakah retry aman?
- Endpoint mana idempotent?
- Jika upstream gagal, apakah boleh fallback/stale cache?

### 13.4 Capacity

- Berapa concurrent client connection?
- Berapa upstream connection?
- Berapa file descriptor dibutuhkan?
- Berapa memory untuk buffer/cache?
- Berapa disk untuk logs/cache?

### 13.5 Security

- Apakah TLS wajib?
- Apakah HSTS aktif?
- Apakah dotfile diblokir?
- Apakah admin endpoint diekspos?
- Apakah request body/header size dibatasi?
- Apakah sensitive headers dilog?

### 13.6 Observability

- Apakah request id ada?
- Apakah upstream timing dicatat?
- Apakah cache status dicatat?
- Apakah rate limit event terlihat?
- Apakah log JSON-ready untuk pipeline observability?

### 13.7 Operability

- Bagaimana reload dilakukan?
- Apakah config diuji sebelum deploy?
- Apakah rollback mudah?
- Apakah certificate renewal otomatis?
- Apakah perubahan config punya review?
- Apakah ada runbook untuk 502/504/499?

---

## 14. Nginx vs Alternatif Lain

Agar tidak salah pakai, penting memahami posisi Nginx dibanding alternatif.

### 14.1 Nginx vs Apache HTTP Server

Nginx terkenal dengan event-driven architecture dan efisiensi connection handling. Apache historically populer sebagai general-purpose web server dengan model module yang sangat luas. Keduanya bisa reverse proxy, serve static, dan terminate TLS.

Nginx sering dipilih untuk:

- high concurrency,
- reverse proxy sederhana,
- static serving efisien,
- deployment config yang relatif ringkas,
- load balancing HTTP.

Apache tetap relevan untuk:

- ekosistem `.htaccess`,
- konfigurasi per-directory tertentu,
- module legacy tertentu,
- deployment yang sudah mature dengan Apache.

### 14.2 Nginx vs HAProxy

HAProxy sangat kuat sebagai load balancer/proxy L4/L7 dengan observability dan runtime controls yang tajam.

Nginx lebih sering dipakai ketika butuh kombinasi:

- static serving,
- reverse proxy,
- TLS,
- caching,
- HTTP routing,
- simple gateway behavior.

HAProxy sering lebih natural untuk:

- load balancing murni,
- advanced health checks,
- TCP proxying yang sangat fokus,
- runtime backend control,
- complex traffic balancing.

### 14.3 Nginx vs Envoy

Envoy dirancang untuk cloud-native service proxy, service mesh, dynamic xDS config, observability rich, dan L7 traffic management modern.

Nginx lebih sederhana dalam banyak deployment tradisional.

Envoy lebih cocok jika sistem butuh:

- service mesh,
- dynamic config management,
- rich L7 telemetry,
- advanced retry/circuit breaking,
- per-route policy yang sangat dinamis,
- gRPC-first ecosystem.

Nginx tetap cocok untuk:

- edge reverse proxy,
- static asset serving,
- TLS termination,
- simple routing,
- controlled production configs,
- ingress sederhana.

### 14.4 Nginx vs Spring Cloud Gateway

Spring Cloud Gateway berjalan di JVM dan natural untuk tim Java yang ingin policy gateway ditulis dengan stack Java/Spring.

Nginx lebih dekat ke OS/network layer dan lebih ringan untuk:

- TLS termination,
- static file serving,
- simple reverse proxy,
- basic rate limiting,
- low-level connection handling.

Spring Cloud Gateway lebih cocok untuk:

- policy berbasis business logic,
- integration dengan Spring Security,
- dynamic route dari service registry,
- custom filters dalam Java/Kotlin,
- gateway behavior yang lebih application-aware.

### 14.5 Nginx vs Cloud Load Balancer

Cloud load balancer seperti AWS ALB/NLB, GCP Load Balancer, Azure Application Gateway, atau Cloudflare sering berada di depan Nginx atau menggantikan sebagian fungsi Nginx.

Nginx masih berguna ketika butuh:

- config portability,
- custom routing dekat aplikasi,
- static file serving,
- local reverse proxy,
- per-environment control,
- custom headers/logging,
- behavior yang tidak tersedia di managed LB.

Tetapi managed load balancer lebih unggul untuk:

- global availability,
- managed TLS,
- DDoS protection,
- cloud-native integration,
- automatic scaling,
- managed health checks.

---

## 15. Kapan Nginx Cocok Dipakai?

Nginx cocok jika kamu butuh:

1. **Reverse proxy sederhana dan stabil**  
   Misalnya satu domain ke beberapa backend Java.

2. **Static file serving**  
   Misalnya serve Vue/React build artifact.

3. **TLS termination**  
   Nginx mengelola sertifikat publik, aplikasi internal tetap HTTP.

4. **Load balancing sederhana**  
   Beberapa instance backend dengan round-robin/least connections/ip-hash.

5. **Basic traffic policy**  
   Rate limit, body size, allow/deny, basic auth.

6. **Caching response tertentu**  
   Untuk konten public, static, atau API yang aman di-cache.

7. **Operational boundary**  
   Memisahkan concerns aplikasi dan traffic infrastructure.

8. **Compatibility layer**  
   Misalnya client butuh HTTPS/HTTP2, backend hanya HTTP/1.1.

9. **Migration layer**  
   Route sebagian path ke sistem lama, sebagian ke sistem baru.

10. **Emergency control**  
   Bisa memblokir endpoint, redirect traffic, menampilkan maintenance page, atau menurunkan load tanpa rebuild aplikasi.

---

## 16. Kapan Nginx Tidak Cukup atau Tidak Ideal?

Nginx bukan jawaban untuk semua masalah.

### 16.1 Tidak Ideal untuk Business Logic Berat

Jangan memindahkan business rule kompleks ke Nginx.

Buruk:

```text
Jika user enterprise dan region Asia dan invoice overdue dan feature flag X aktif,
route ke backend Y kecuali hari Jumat setelah jam 5 sore.
```

Policy seperti itu lebih cocok di aplikasi, gateway yang programmable, atau dedicated policy engine.

### 16.2 Tidak Ideal untuk Authorization Kompleks

Nginx bisa basic auth, JWT/auth subrequest pada varian/module tertentu, atau integrate dengan auth service. Tetapi authorization domain-level yang kompleks tetap milik aplikasi atau identity-aware gateway.

### 16.3 Tidak Ideal untuk Per-User Dynamic Rate Policy yang Kompleks

Nginx bisa rate limit berdasarkan key seperti IP/header/token. Tetapi quota kompleks seperti plan-based billing, tenant-based quota, burst credit, dan adaptive throttling biasanya lebih cocok di gateway/service khusus.

### 16.4 Tidak Ideal Jika Butuh Dynamic Service Discovery Kompleks

Nginx open source tradisional berbasis config reload. Jika kamu butuh dynamic discovery sangat sering, per-route config real-time, dan control plane kaya, Envoy/service mesh/API gateway mungkin lebih sesuai.

### 16.5 Tidak Ideal untuk Menggantikan Observability Platform

Nginx bisa log dan expose metrics via module/agent. Tetapi jangan menganggap Nginx menggantikan tracing, metrics store, log pipeline, dan alerting.

---

## 17. Prinsip Desain Nginx untuk Production

### 17.1 Explicit Over Implicit

Lebih baik eksplisit:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

daripada mengandalkan default yang tidak dipahami.

### 17.2 Safe Defaults

Default server sebaiknya tidak melayani aplikasi sensitif.

Contoh defensive catch-all:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}
```

Catatan: `444` adalah kode khusus Nginx untuk menutup koneksi tanpa response HTTP. Tidak selalu cocok untuk semua environment, tetapi berguna sebagai konsep hard drop.

### 17.3 Config as Code

Nginx config harus:

- versioned,
- reviewed,
- tested,
- templated dengan disiplin,
- punya rollback,
- punya owner,
- punya style guide.

### 17.4 Observability First

Jangan menunggu incident untuk menambah log field.

Minimal access log production harus memuat:

- request id,
- remote addr,
- host,
- method,
- URI,
- status,
- bytes sent,
- request time,
- upstream addr,
- upstream status,
- upstream response time,
- cache status jika cache aktif.

### 17.5 Timeouts Are Architecture

Timeout bukan angka asal.

Timeout mendefinisikan:

- berapa lama resource ditahan,
- kapan user menerima failure,
- kapan retry terjadi,
- kapan cascading failure dimulai,
- bagaimana sistem pulih.

### 17.6 Trust Must Be Designed

Header seperti `X-Forwarded-For` tidak otomatis terpercaya.

Jika Nginx menerima request langsung dari internet, client bisa mengirim:

```text
X-Forwarded-For: 1.2.3.4
```

Jika aplikasi langsung mempercayainya, audit log dan rate limit bisa dipalsukan.

Trust boundary harus jelas:

```text
Only trust forwarded headers from known proxy layer.
```

### 17.7 Minimize Magic

Hindari config yang sulit ditebak:

- regex location terlalu banyak,
- nested includes tidak jelas,
- rewrite kompleks,
- variable `proxy_pass` tanpa alasan kuat,
- `if` di location tanpa pemahaman penuh,
- default inheritance yang tidak didokumentasikan.

---

## 18. Peta Besar Nginx Concepts

Untuk menguasai Nginx, kamu perlu memahami beberapa cluster konsep.

### 18.1 Runtime Architecture

- master process,
- worker process,
- event loop,
- non-blocking IO,
- connection handling,
- reload behavior,
- signals,
- file descriptor.

### 18.2 Configuration Language

- directive,
- context,
- inheritance,
- include,
- variables,
- maps,
- location matching,
- server selection.

### 18.3 HTTP Serving

- static file,
- root vs alias,
- index,
- try_files,
- MIME types,
- compression,
- cache headers.

### 18.4 Reverse Proxy

- proxy_pass,
- headers,
- URI rewriting,
- upstream,
- keepalive,
- buffering,
- timeout,
- retry.

### 18.5 Traffic Management

- load balancing,
- rate limiting,
- connection limiting,
- canary,
- blue-green,
- header-based routing,
- maintenance routing.

### 18.6 Security

- TLS,
- SNI,
- HSTS,
- security headers,
- request limits,
- path restrictions,
- IP access,
- auth integration,
- header trust.

### 18.7 Observability

- access log,
- error log,
- upstream timing,
- request id,
- metrics,
- tracing integration,
- log format design.

### 18.8 Operations

- install,
- reload,
- restart,
- test config,
- deployment,
- rollback,
- certificate renewal,
- log rotation,
- cache storage,
- incident runbook.

### 18.9 Advanced Protocols

- WebSocket,
- SSE,
- gRPC,
- HTTP/2,
- HTTP/3/QUIC,
- TCP/UDP stream.

---

## 19. First Mental Model Diagram

Gunakan diagram ini sebagai peta besar.

```text
                                      ┌────────────────────┐
                                      │    Client/User     │
                                      └─────────┬──────────┘
                                                │
                                                │ HTTPS / HTTP / WS / gRPC
                                                v
┌─────────────────────────────────────────────────────────────────────┐
│                              NGINX                                  │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐  │
│  │ Connection   │ → │ Server       │ → │ Location / Routing      │  │
│  │ Accept/TLS   │   │ Selection    │   │ Decision                │  │
│  └──────────────┘   └──────────────┘   └────────────┬────────────┘  │
│                                                       │               │
│                                                       v               │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐  │
│  │ Access/Rate  │ → │ Static/Proxy │ → │ Buffer/Cache/Compress   │  │
│  │ Limit/Auth   │   │ Handler      │   │ Response                │  │
│  └──────────────┘   └──────┬───────┘   └────────────┬────────────┘  │
│                            │                        │               │
│                            v                        v               │
│                    ┌──────────────┐          ┌──────────────┐       │
│                    │ Java Backend │          │ Access/Error │       │
│                    │ Upstream     │          │ Logs         │       │
│                    └──────────────┘          └──────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

Pertanyaan utama di setiap node:

- Apa input-nya?
- Apa aturan pemilihannya?
- Apa output-nya?
- Apa default-nya?
- Apa failure mode-nya?
- Bagaimana observability-nya?

---

## 20. Minimal Nginx Config: Dibaca sebagai Program

Lihat config ini:

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    upstream app_backend {
        server 127.0.0.1:8080;
    }

    server {
        listen 80;
        server_name example.com;

        location / {
            proxy_pass http://app_backend;
        }
    }
}
```

Beginner membaca:

> Nginx listen port 80 dan forward ke app 8080.

Production engineer membaca:

1. Runtime:
   - jumlah worker mengikuti CPU core.
   - setiap worker dapat membuka sampai 1024 worker connections.

2. Protocol:
   - hanya HTTP port 80.
   - tidak ada HTTPS.

3. Virtual host:
   - hanya `example.com` secara eksplisit.
   - default server behavior belum jelas jika ada server block lain.

4. Routing:
   - semua path masuk location `/`.

5. Upstream:
   - hanya satu backend `127.0.0.1:8080`.
   - tidak ada keepalive upstream eksplisit.
   - tidak ada load balancing nyata.

6. Headers:
   - tidak ada explicit `Host`, `X-Forwarded-*`, atau request id.

7. Timeout:
   - default timeout dipakai.
   - belum ada timeout budget eksplisit.

8. Body:
   - body size default.
   - buffering default.

9. Logs:
   - default logs.
   - tidak ada upstream timing custom.

10. Failure:
    - jika app mati, kemungkinan 502.
    - jika app lambat, bisa 504 tergantung timeout default.
    - jika user butuh HTTPS redirect, belum ada.

Perbedaan level engineering ada di cara membaca config.

---

## 21. Nginx Config sebagai Code: Struktur Mental

Nginx config punya struktur seperti program deklaratif.

Contoh:

```nginx
main context
├── events context
└── http context
    ├── upstream context
    ├── server context
    │   ├── location context
    │   └── location context
    └── server context
        └── location context
```

Dokumentasi resmi menyatakan directive di luar context berada di main context; `events` dan `http` berada di main context, `server` berada di `http`, dan `location` berada di `server`.

Ini mirip scope dalam bahasa pemrograman, tetapi inheritance dan override-nya tidak selalu sama dengan Java.

Kesalahan umum:

- mengira directive berlaku global padahal hanya berlaku di location,
- mengira location sibling mewarisi satu sama lain,
- mengira include order tidak penting,
- mengira regex location dievaluasi seperti route framework biasa,
- mengira `proxy_pass` selalu mempertahankan URI dengan cara sama.

Karena itu Part 003 dan Part 005 akan sangat penting.

---

## 22. Nginx dan Hidden Coupling

Nginx sering membuat coupling tersembunyi dengan aplikasi.

### 22.1 Coupling via Header

Aplikasi Java mungkin bergantung pada:

```text
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
X-Forwarded-For
X-Request-ID
```

Jika Nginx config berubah, aplikasi berubah perilakunya tanpa redeploy.

### 22.2 Coupling via Path

Frontend mungkin memanggil:

```text
/api/orders
```

Nginx route:

```nginx
location /api/ {
    proxy_pass http://api_backend/;
}
```

Trailing slash pada `proxy_pass` dapat mengubah URI yang diterima backend. Ini coupling antara route external dan route internal.

### 22.3 Coupling via Timeout

Aplikasi mungkin punya timeout 60 detik, Nginx `proxy_read_timeout` 30 detik. Maka user gagal di 30 detik, walaupun aplikasi masih bekerja.

### 22.4 Coupling via Buffering

Jika Nginx buffer upload, aplikasi tidak melihat streaming upload. Jika buffering dimatikan, aplikasi harus siap menghadapi slow client.

### 22.5 Coupling via Cache

Aplikasi mungkin mengubah response header, tetapi Nginx cache policy bisa tetap menyimpan atau menolak cache berdasarkan config.

Top-tier engineer membuat coupling ini eksplisit dan diuji.

---

## 23. Contoh Arsitektur Referensi untuk Seri Ini

Sepanjang seri, kita akan sering memakai arsitektur referensi berikut.

```text
                       ┌──────────────────────┐
                       │ Browser / Mobile App │
                       └──────────┬───────────┘
                                  │
                                  │ HTTPS
                                  v
                       ┌──────────────────────┐
                       │        Nginx         │
                       │  app.example.com     │
                       └──────────┬───────────┘
                                  │
             ┌────────────────────┼─────────────────────┐
             │                    │                     │
             v                    v                     v
     /assets/* static       /api/* Java API       /ws WebSocket
     / index.html           Spring Boot           Notification Service
                                  │
                                  v
                       ┌──────────────────────┐
                       │ PostgreSQL / Redis   │
                       └──────────────────────┘
```

Nginx responsibilities:

- TLS termination,
- HTTP to HTTPS redirect,
- static frontend serving,
- API reverse proxy,
- WebSocket proxy,
- request id propagation,
- rate limit login endpoint,
- body size limit upload endpoint,
- cache public catalog endpoint,
- add security headers,
- log upstream timing,
- safe error pages.

Java responsibilities:

- business logic,
- authentication domain,
- authorization domain,
- validation,
- persistence,
- workflow,
- transaction,
- domain events,
- audit trail.

Boundary contract:

- Nginx must pass correct forwarded headers.
- Java must be configured to interpret them safely.
- Both must agree on timeout semantics.
- Both must agree on request id propagation.
- Both must agree on deployment/graceful shutdown behavior.

---

## 24. First Production-Grade Thinking Exercise

Bayangkan kamu punya Spring Boot app di port 8080 dan Nginx di depan port 443.

Kamu diminta “pasang Nginx supaya production ready”.

Jangan langsung menulis config. Tanyakan dulu:

### 24.1 Domain and Protocol

- Domain apa?
- Apakah semua HTTP harus redirect ke HTTPS?
- Apakah ada subdomain lain?
- Apakah HSTS boleh diaktifkan?
- Apakah HTTP/2 dibutuhkan?

### 24.2 Backend Contract

- Backend listen di mana?
- Apakah backend hanya satu instance atau banyak?
- Apakah backend butuh sticky session?
- Apakah backend siap menerima forwarded headers?
- Apakah backend generate absolute URL?

### 24.3 Endpoints

- Path mana static?
- Path mana API?
- Path mana health?
- Path mana admin/internal?
- Path mana upload?
- Path mana streaming/WebSocket?

### 24.4 Limits

- Max body size global?
- Max body size upload?
- Header size normal?
- Rate limit login?
- Rate limit public API?

### 24.5 Timeout

- Connect timeout ke backend?
- Read timeout API normal?
- Read timeout report export?
- Read timeout WebSocket?
- Send timeout ke client?

### 24.6 Observability

- Request id dari client atau Nginx generate?
- Log format apa?
- Apakah log JSON?
- Field upstream apa wajib?
- Apakah sensitive data perlu redaction?

### 24.7 Security

- Security headers apa?
- Dotfiles diblokir?
- Actuator endpoint dibatasi?
- Unknown host ditolak?
- TLS cert renewal bagaimana?

### 24.8 Operations

- Config dikelola di repo mana?
- Deploy via apa?
- Bagaimana `nginx -t` dijalankan?
- Bagaimana rollback?
- Bagaimana reload?
- Bagaimana log rotation?
- Bagaimana alert 502/504/499?

Inilah perbedaan antara “menggunakan Nginx” dan “mendesain traffic layer”.

---

## 25. Common Misconceptions

### 25.1 “Nginx cuma meneruskan request”

Salah.

Nginx bisa mengubah:

- protocol,
- header,
- path,
- body buffering,
- connection lifetime,
- timeout,
- cache behavior,
- error semantics,
- logging,
- perceived latency.

### 25.2 “Kalau aplikasi sehat, user pasti sehat”

Salah.

User path mencakup DNS, TLS, proxy, network, Nginx, upstream connection, buffering, dan client download.

Aplikasi sehat hanya satu bagian.

### 25.3 “502 berarti aplikasi down”

Belum tentu.

502 bisa karena:

- upstream refused connection,
- upstream closed connection early,
- response header invalid,
- protocol mismatch,
- wrong port,
- DNS issue,
- TLS upstream issue,
- app crash,
- app restart,
- Nginx config salah.

### 25.4 “499 adalah error aplikasi”

Biasanya bukan.

499 adalah status khusus Nginx yang berarti client menutup koneksi sebelum Nginx selesai memproses request. Penyebabnya bisa:

- user cancel,
- browser timeout,
- mobile network drop,
- upstream terlalu lama,
- load balancer timeout di depan Nginx,
- client-side timeout lebih pendek dari server processing.

### 25.5 “Nginx config yang jalan berarti benar”

Salah.

Config bisa valid syntax tetapi salah semantics.

Contoh:

- route jatuh ke location salah,
- proxy header spoofable,
- cache private response,
- timeout tidak sesuai,
- TLS redirect loop,
- default server melayani host tak dikenal.

### 25.6 “Semua bisa diselesaikan dengan snippet dari internet”

Snippet bisa membantu, tetapi production config harus didesain sesuai:

- topology,
- trust boundary,
- application behavior,
- deployment process,
- traffic pattern,
- security requirement,
- observability requirement.

---

## 26. Learning Strategy untuk Seri Ini

Seri ini sebaiknya dipelajari sebagai progression.

### Stage 1 — Runtime and Configuration Foundation

Part:

- 000 Orientation
- 001 Architecture
- 002 Installation/Layout
- 003 Configuration Grammar
- 004 Server Selection
- 005 Location Matching

Tujuan:

- bisa membaca config,
- tahu bagaimana request dipilih,
- paham proses runtime,
- tidak tersesat oleh default behavior.

### Stage 2 — Serving and Proxying

Part:

- 006 Static File Serving
- 007 Reverse Proxy Fundamentals
- 008 Proxy Header Contract
- 009 Upstream and Load Balancing
- 010 Timeout/Retry/Buffering

Tujuan:

- bisa menaruh Nginx di depan Java app dengan aman,
- memahami URI/header/timeouts,
- menghindari bug klasik reverse proxy.

### Stage 3 — Performance, TLS, and Protocols

Part:

- 011 Connection Management
- 012 TLS Termination
- 013 HTTP/2/HTTP/3
- 014 Compression
- 015 Caching

Tujuan:

- memahami performa dari connection hingga response,
- tahu trade-off TLS/compression/cache,
- bisa mendesain latency dan capacity.

### Stage 4 — Security and Operability

Part:

- 016 Rate Limiting
- 017 Access Control
- 018 Security Hardening
- 019 Observability
- 020 Debugging

Tujuan:

- bisa melindungi endpoint,
- bisa menganalisis incident,
- bisa membuat Nginx observable.

### Stage 5 — Java Integration and Advanced Traffic

Part:

- 021 Java Application Servers
- 022 WebSocket/SSE/gRPC
- 023 Progressive Delivery
- 024 Lightweight API Gateway
- 025 Containers/Kubernetes
- 026 Stream Module

Tujuan:

- paham behavior Nginx dengan Java stack modern,
- bisa menangani long-lived connection,
- bisa menerapkan deployment pattern.

### Stage 6 — Production Mastery

Part:

- 027 Config Design Patterns
- 028 Failure Modeling
- 029 Performance Lab
- 030 Capstone

Tujuan:

- mampu mendesain, menguji, mengoperasikan, dan mendiagnosis Nginx untuk sistem production.

---

## 27. Glossary Awal

### Nginx

Software server/proxy/cache/load balancer yang sering ditempatkan di depan aplikasi.

### Reverse Proxy

Proxy yang menerima request dari client dan meneruskannya ke server internal. Client tidak perlu tahu lokasi backend sebenarnya.

### Upstream

Backend server atau group server tujuan proxy.

### Server Block

Blok konfigurasi yang mendefinisikan virtual server, biasanya berdasarkan `listen` dan `server_name`.

### Location Block

Blok konfigurasi untuk memilih behavior berdasarkan URI/path.

### Directive

Instruksi konfigurasi Nginx, misalnya `listen`, `server_name`, `proxy_pass`.

### Context

Scope tempat directive berada, misalnya `main`, `events`, `http`, `server`, `location`, `upstream`, `stream`.

### Worker Process

Process Nginx yang memproses koneksi/request.

### Master Process

Process Nginx yang membaca konfigurasi dan mengelola worker process.

### TLS Termination

Proses mengakhiri koneksi HTTPS di Nginx, lalu meneruskan traffic ke backend via HTTP atau HTTPS internal.

### Forwarded Headers

Header yang memberi informasi original request ke backend, seperti `X-Forwarded-For` dan `X-Forwarded-Proto`.

### Buffering

Nginx menyimpan request/response sementara sebelum meneruskan atau mengirimnya.

### Cache Key

Kunci yang digunakan Nginx untuk menentukan apakah request cocok dengan response cache tertentu.

### Graceful Reload

Reload config tanpa memutus request aktif secara brutal. Nginx master memvalidasi config baru, menjalankan worker baru, dan meminta worker lama menyelesaikan request aktif.

---

## 28. Checklist Setelah Part 000

Kamu sudah memahami Part 000 jika bisa menjawab pertanyaan berikut.

### Conceptual

- Apa beda Nginx sebagai web server dan sebagai traffic runtime?
- Mengapa Nginx penting untuk Java backend engineer?
- Apa arti Nginx sebagai deterministic traffic state machine?
- Apa saja state utama request saat melewati Nginx?
- Mengapa Nginx config adalah boundary contract?

### Architecture

- Di posisi mana saja Nginx bisa berada dalam sistem?
- Apa perbedaan Nginx sebagai edge proxy, static server, load balancer, cache, dan stream proxy?
- Apa perbedaan data plane dan control plane dalam konteks Nginx?

### Production

- Mengapa aplikasi Java sehat belum menjamin user path sehat?
- Apa contoh failure yang terjadi sebelum request mencapai aplikasi?
- Apa contoh hidden coupling antara Nginx dan aplikasi Java?
- Mengapa timeout adalah keputusan arsitektur?
- Mengapa forwarded headers harus diperlakukan sebagai trust contract?

### Operability

- Mengapa `nginx -t` dan reload discipline penting?
- Mengapa access log default sering tidak cukup?
- Field apa yang ingin kamu lihat untuk debugging upstream latency?
- Apa risiko default server yang salah?
- Mengapa config harus dikelola seperti code?

---

## 29. Mini Lab Konseptual

Belum perlu install Nginx. Cukup latihan membaca skenario.

### Lab 1 — Request Path

Skenario:

```text
GET https://app.example.com/api/orders/123
```

Pertanyaan:

1. DNS mengarah ke mana?
2. TLS terminate di mana?
3. Server block mana yang dipilih?
4. Location mana yang cocok?
5. Header apa yang diteruskan ke Java app?
6. Upstream mana yang dipilih?
7. Timeout apa yang berlaku?
8. Jika Java app mati, status apa kemungkinan muncul?
9. Log mana yang harus dicek?
10. Bagaimana request id ditemukan di Java logs?

### Lab 2 — 502 During Deployment

Skenario:

```text
Deployment Spring Boot menyebabkan 502 selama 15 detik.
```

Kemungkinan penyebab:

- app belum ready tapi sudah menerima traffic,
- Nginx upstream masih menunjuk instance lama,
- connection keepalive ke upstream lama putus,
- app shutdown tanpa graceful drain,
- health check tidak sinkron,
- proxy timeout/retry tidak sesuai,
- load balancer di depan Nginx punya behavior sendiri.

Data yang perlu dikumpulkan:

- Nginx error log,
- Nginx access log dengan upstream status,
- app startup/shutdown logs,
- deployment timeline,
- health/readiness timeline,
- process restart time,
- upstream connection error.

### Lab 3 — Wrong Client IP

Skenario:

Aplikasi audit log mencatat semua request dari IP Nginx.

Pertanyaan:

1. Apakah Nginx mengirim `X-Forwarded-For`?
2. Apakah aplikasi mempercayai forwarded header?
3. Apakah ada load balancer sebelum Nginx?
4. Apakah client bisa spoof header?
5. Apakah real IP module diperlukan?
6. Apakah audit log harus memakai remote addr atau resolved client IP?

### Lab 4 — SPA Route Broken

Skenario:

```text
GET /dashboard
```

Menghasilkan 404 setelah refresh browser.

Kemungkinan:

- Nginx mencoba mencari file `/dashboard`,
- SPA router seharusnya fallback ke `/index.html`,
- `try_files` belum benar,
- `/api` fallback ikut tertangkap SPA route.

Nanti detailnya dibahas di Part 006.

---

## 30. Referensi Utama Part Ini

Referensi resmi dan primer yang menjadi baseline:

1. Nginx official site  
   <https://nginx.org/en/>

2. Nginx documentation index  
   <https://nginx.org/en/docs/>

3. Nginx Beginner's Guide  
   <https://nginx.org/en/docs/beginners_guide.html>

4. Controlling nginx  
   <https://nginx.org/en/docs/control.html>

5. NGINX Admin Guide — Runtime Control  
   <https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/>

6. NGINX Admin Guide — Managing Configuration Files  
   <https://docs.nginx.com/nginx/admin-guide/basic-functionality/managing-configuration-files/>

7. Using nginx as HTTP load balancer  
   <https://nginx.org/en/docs/http/load_balancing.html>

8. NGINX Admin Guide — TCP and UDP Load Balancing  
   <https://docs.nginx.com/nginx/admin-guide/load-balancer/tcp-udp-load-balancer/>

---

## 31. Ringkasan Part 000

Nginx harus dipahami bukan hanya sebagai web server, tetapi sebagai **traffic runtime**.

Ia berada di jalur request dan memiliki pengaruh langsung terhadap:

- routing,
- security,
- TLS,
- headers,
- timeout,
- buffering,
- caching,
- load balancing,
- observability,
- deployment,
- dan failure semantics.

Untuk Java engineer, penguasaan Nginx berarti mampu melihat sistem dari luar aplikasi:

```text
client -> proxy -> application -> downstream
```

bukan hanya dari dalam controller/service/repository.

Mental model utama:

> **Setiap request yang melewati Nginx berjalan melalui state machine deterministik. Config Nginx adalah program yang mengatur state transition tersebut.**

Jika kamu memahami state transition itu, kamu bisa:

- mendesain config dengan lebih aman,
- mendiagnosis incident lebih cepat,
- menghindari hidden coupling,
- membuat boundary contract eksplisit,
- dan mengoperasikan aplikasi Java dengan lebih matang di production.

---

## 32. Status Seri

Part ini adalah:

```text
Part 000 dari 030
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 001 — Nginx Architecture: Master, Worker, Event Loop, and Request Lifecycle
```

Di Part 001 kita akan masuk ke internal runtime Nginx:

- master process,
- worker process,
- event loop,
- non-blocking IO,
- connection lifecycle,
- reload lifecycle,
- dan perbandingan dengan model thread pool Java application server.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-001.md">Part 001 — Nginx Architecture: Master, Worker, Event Loop, and Request Lifecycle ➡️</a>
</div>
