# learn-nginx-mastery-for-java-engineers-part-022.md

# Part 022 — WebSocket, SSE, gRPC, and Long-Lived Connections

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **022 dari 030**  
> Fokus: WebSocket, Server-Sent Events, gRPC, long-lived connections, timeout, buffering, HTTP/2, deployment drain, dan failure mode production di balik Nginx.  
> Target pembaca: Java software engineer yang sudah memahami backend HTTP dasar dan ingin menguasai Nginx sebagai traffic/runtime boundary.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan karakter operasional **request-response biasa** dengan **long-lived connection**.
2. Menjelaskan bagaimana Nginx memperlakukan WebSocket, SSE, dan gRPC secara berbeda.
3. Mendesain konfigurasi Nginx untuk:
   - WebSocket,
   - Secure WebSocket melalui TLS termination,
   - Server-Sent Events,
   - gRPC,
   - gRPC over TLS,
   - long polling.
4. Memahami konsekuensi timeout, buffering, keepalive, dan upstream lifecycle.
5. Menghindari failure umum:
   - WebSocket putus setiap 60 detik,
   - SSE tidak mengirim event sampai response selesai,
   - gRPC gagal karena HTTP/2 tidak aktif,
   - deploy memutus ribuan koneksi aktif,
   - load balancer membuat distribusi koneksi tidak merata,
   - satu koneksi long-lived mengikat resource backend terlalu lama.
6. Menghubungkan konfigurasi Nginx dengan runtime Java seperti Spring Boot, Tomcat, Jetty, Undertow, Netty, WebFlux, dan gRPC Java.

---

## 2. Posisi Materi Ini dalam Seri

Di bagian sebelumnya kita sudah membahas:

- reverse proxy fundamental,
- header contract,
- upstream dan load balancing,
- timeout, retry, buffering,
- TLS,
- HTTP/2 dan HTTP/3,
- observability,
- Java application server behavior.

Bagian ini adalah titik pertemuan semuanya.

WebSocket, SSE, dan gRPC terlihat seperti “fitur komunikasi real-time”, tetapi dari perspektif Nginx mereka adalah **traffic shape** yang berbeda. Perbedaan shape ini mengubah cara kamu harus berpikir tentang:

- lifetime koneksi,
- buffering,
- timeout,
- retry,
- load balancing,
- deployment,
- memory,
- thread/event-loop backend,
- observability,
- incident response.

Request HTTP biasa pendek. WebSocket, SSE, dan streaming gRPC bisa hidup lama. Itu berarti Nginx tidak lagi hanya meneruskan request; Nginx menjadi penjaga kanal komunikasi yang durasinya bisa jauh lebih panjang daripada satu transaksi backend normal.

---

## 3. Mental Model Utama: From Transaction to Channel

### 3.1 Request-response biasa adalah transaksi

HTTP request-response normal dapat dipikirkan sebagai transaksi:

```text
client -> Nginx -> Java app -> process -> response -> close/reuse
```

Karakteristiknya:

- durasi relatif pendek,
- request punya awal dan akhir jelas,
- retry kadang mungkin,
- buffering sering membantu,
- access log keluar setelah request selesai,
- load balancing terjadi per request,
- resource backend dilepas cepat.

Contoh:

```text
GET /api/orders/123
POST /api/payments
GET /assets/app.abc123.js
```

### 3.2 Long-lived communication adalah channel

WebSocket, SSE, dan streaming gRPC lebih mirip channel:

```text
client <================== persistent channel ==================> backend
                  melalui Nginx
```

Karakteristiknya:

- durasi bisa menit, jam, bahkan lebih lama,
- satu koneksi bisa membawa banyak message/event,
- retry bisa berbahaya jika stateful,
- buffering sering harus dimatikan,
- timeout harus disesuaikan,
- load balancing terjadi saat koneksi dibuat, bukan setiap message,
- draining deployment lebih sulit,
- observability lebih tricky karena log bisa baru muncul saat koneksi selesai.

### 3.3 Perubahan cara berpikir

Untuk request biasa, pertanyaan utama adalah:

> “Berapa cepat request ini selesai?”

Untuk long-lived connection, pertanyaannya berubah menjadi:

> “Berapa lama koneksi ini aman dipertahankan, siapa yang menanggung resource-nya, dan bagaimana koneksi ini mati dengan benar?”

Ini shift penting.

Long-lived traffic bukan hanya problem routing. Ini adalah problem lifecycle.

---

## 4. Tiga Pola Komunikasi yang Akan Kita Bahas

### 4.1 WebSocket

WebSocket adalah koneksi full-duplex. Setelah handshake awal HTTP, koneksi di-upgrade menjadi kanal dua arah.

Cocok untuk:

- chat,
- collaboration,
- multiplayer interaction,
- live dashboard interaktif,
- notification channel dua arah,
- trading/order book,
- terminal/browser shell,
- bidirectional device control.

Sifat penting:

- client dan server sama-sama bisa mengirim message kapan saja,
- membutuhkan HTTP/1.1 Upgrade mechanism untuk handshake klasik,
- di Nginx perlu meneruskan header `Upgrade` dan `Connection`,
- koneksi bisa idle lama,
- sticky/session affinity sering relevan jika backend menyimpan state in-memory.

### 4.2 Server-Sent Events atau SSE

SSE adalah koneksi satu arah dari server ke browser melalui HTTP response streaming.

Cocok untuk:

- notification feed,
- progress update,
- server push sederhana,
- event timeline,
- monitoring dashboard,
- AI/token streaming style output,
- job status updates.

Sifat penting:

- client mengirim request biasa,
- server membalas dengan stream `text/event-stream`,
- server bisa mengirim event berkali-kali dalam satu response,
- browser otomatis reconnect,
- lebih sederhana daripada WebSocket jika hanya butuh server-to-client,
- buffering proxy harus diperhatikan.

### 4.3 gRPC

gRPC adalah RPC framework berbasis HTTP/2. Ia mendukung:

- unary call,
- server streaming,
- client streaming,
- bidirectional streaming.

Cocok untuk:

- internal service-to-service communication,
- strongly typed RPC,
- polyglot microservices,
- high-performance backend communication,
- streaming internal pipeline,
- control plane APIs.

Sifat penting:

- membutuhkan HTTP/2 untuk gRPC native,
- memakai framing HTTP/2 dan Protocol Buffers,
- Nginx memakai `grpc_pass`, bukan `proxy_pass`, untuk gRPC native,
- browser biasa tidak bisa langsung memakai gRPC native tanpa gRPC-Web bridge,
- deadline/cancellation harus dipahami dari sisi app dan proxy.

---

## 5. Nginx sebagai Boundary untuk Long-Lived Connections

Nginx berada di antara dua koneksi:

```text
client connection <-> Nginx <-> upstream connection
```

Untuk request biasa, dua koneksi ini mungkin hidup singkat. Untuk long-lived traffic, keduanya bisa hidup lama.

Artinya ada dua lifecycle:

1. lifecycle client-to-Nginx,
2. lifecycle Nginx-to-upstream.

Masalah sering muncul ketika engineer hanya memikirkan satu sisi.

Contoh:

```nginx
proxy_read_timeout 60s;
```

Jika WebSocket atau SSE idle lebih dari 60 detik tanpa data dari upstream, Nginx bisa menutup koneksi. Dari sisi aplikasi, “server tidak error”. Dari sisi client, “WebSocket selalu reconnect tiap 60 detik”. Dari sisi Nginx, “timeout bekerja sesuai konfigurasi”.

Inilah kenapa long-lived traffic harus dirancang sebagai lifecycle chain, bukan endpoint handler saja.

---

## 6. WebSocket Deep Dive

### 6.1 Bagaimana WebSocket handshake bekerja di balik Nginx

WebSocket biasanya dimulai sebagai HTTP/1.1 request:

```http
GET /ws/chat HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13
```

Backend membalas:

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: ...
```

Setelah itu koneksi tidak lagi mengikuti pola HTTP request-response biasa. Ia menjadi kanal WebSocket.

Nginx perlu meneruskan upgrade intent dari client ke upstream.

### 6.2 Konfigurasi dasar WebSocket

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream websocket_backend {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location /ws/ {
        proxy_pass http://websocket_backend;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Hal penting:

```nginx
proxy_http_version 1.1;
```

WebSocket Upgrade tradisional butuh HTTP/1.1 ke upstream.

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
```

Tanpa dua header ini, backend tidak melihat permintaan upgrade secara benar.

### 6.3 Mengapa pakai `map` untuk `Connection`

Konfigurasi yang sering ditemukan:

```nginx
proxy_set_header Connection "upgrade";
```

Ini bekerja untuk location khusus WebSocket. Namun jika location yang sama juga melayani request non-WebSocket, lebih aman memakai `map`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Artinya:

- jika client mengirim `Upgrade`, teruskan `Connection: upgrade`,
- jika tidak, pakai `Connection: close`.

Ini menghindari mengirim sinyal upgrade palsu ke backend untuk request biasa.

### 6.4 WebSocket dengan path API yang sama

Kadang backend Java punya API dan WebSocket di service yang sama:

```text
/api/orders
/api/users
/ws/notifications
```

Konfigurasi yang lebih eksplisit:

```nginx
upstream java_app {
    server 10.0.10.11:8080;
    server 10.0.10.12:8080;
}

server {
    listen 443 ssl;
    server_name app.example.com;

    location /api/ {
        proxy_pass http://java_app;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 3s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    location /ws/ {
        proxy_pass http://java_app;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Kenapa dipisah?

Karena API biasa dan WebSocket butuh timeout dan header behavior berbeda.

### 6.5 Failure mode: WebSocket disconnect setiap 60 detik

Gejala:

- browser reconnect secara periodik,
- frontend melihat `WebSocket closed`,
- backend tidak crash,
- access log Nginx menunjukkan durasi sekitar 60 detik,
- error log bisa menunjukkan upstream timed out.

Penyebab umum:

```nginx
proxy_read_timeout 60s;
```

Jika upstream tidak mengirim apa pun selama 60 detik, Nginx menganggap upstream idle terlalu lama.

Solusi:

1. Naikkan `proxy_read_timeout` untuk WebSocket location.
2. Implement heartbeat/ping dari server atau aplikasi.
3. Jangan samakan timeout WebSocket dengan API biasa.

Contoh:

```nginx
location /ws/ {
    proxy_pass http://java_app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

Namun jangan asal set ke `24h` tanpa memahami kapasitas. Timeout panjang berarti koneksi dan resource juga bisa tertahan lama.

### 6.6 Heartbeat sebagai kontrak lifecycle

Untuk WebSocket production, biasanya perlu heartbeat.

Model:

```text
client <--- ping/pong ---> server
```

Tujuan heartbeat:

- menjaga koneksi tidak dianggap idle oleh proxy/load balancer,
- mendeteksi client mati tanpa TCP close yang bersih,
- membersihkan session/resource backend,
- memberi observability terhadap koneksi sehat.

Kontrak yang baik:

```text
Nginx proxy_read_timeout = 75s
application heartbeat interval = 30s
client reconnect backoff = exponential, jittered
```

Artinya sebelum Nginx idle timeout, sudah ada traffic heartbeat.

### 6.7 WebSocket dan load balancing

Load balancing WebSocket terjadi saat handshake.

Setelah koneksi established, semua message di koneksi itu tetap ke upstream yang sama.

```text
client A -> Nginx -> backend-1  [selama koneksi hidup]
client B -> Nginx -> backend-2  [selama koneksi hidup]
```

Konsekuensi:

- distribusi beban bukan hanya jumlah request, tetapi jumlah koneksi aktif,
- backend yang menerima banyak koneksi lama bisa lebih berat,
- rolling deploy perlu drain koneksi,
- jika backend menyimpan subscription in-memory, reconnect bisa berubah node.

### 6.8 Session affinity untuk WebSocket

Jika backend WebSocket stateless dan semua state ada di shared broker seperti Redis/Kafka/NATS, affinity tidak terlalu penting.

Jika backend menyimpan state in-memory, affinity bisa dibutuhkan.

Contoh:

```nginx
upstream websocket_backend {
    ip_hash;
    server 10.0.10.11:8080;
    server 10.0.10.12:8080;
}
```

Tapi `ip_hash` punya masalah:

- semua user di belakang NAT bisa masuk ke node yang sama,
- client mobile sering ganti IP,
- tidak cocok untuk fairness tinggi,
- failover mengubah mapping.

Alternatif arsitektural yang lebih baik:

- backend WebSocket stateless,
- session/subscription state di shared store atau broker,
- message fanout melalui Redis Pub/Sub, Kafka, RabbitMQ, NATS, atau dedicated realtime infra,
- client reconnect bisa masuk node mana pun.

### 6.9 Java backend implications untuk WebSocket

Pada Spring Boot/Tomcat style runtime:

- WebSocket connection bukan request servlet biasa yang cepat selesai.
- Setiap koneksi bisa memegang session object, buffer, subscription, dan resource app.
- Thread model tergantung container dan library.
- Blocking operation di handler WebSocket bisa mengurangi kapasitas drastis.

Pada Netty/WebFlux style runtime:

- WebSocket event berjalan di event loop.
- Blocking call di event loop sangat berbahaya.
- Harus offload operasi blocking ke scheduler/thread pool yang tepat.

Checklist backend:

- Apakah WebSocket handler melakukan blocking database call?
- Apakah setiap connection punya memory footprint yang diketahui?
- Apakah ada limit jumlah connection per user/IP/token?
- Apakah unsubscribe/cleanup terjadi saat disconnect?
- Apakah reconnect storm ditangani?
- Apakah heartbeat diimplementasikan?
- Apakah deployment bisa drain?

---

## 7. Server-Sent Events Deep Dive

### 7.1 Apa itu SSE dari sisi Nginx

SSE terlihat seperti HTTP response biasa yang tidak langsung selesai.

Request:

```http
GET /events/stream HTTP/1.1
Accept: text/event-stream
```

Response:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

id: 1
event: notification
data: {"message":"hello"}

id: 2
event: notification
data: {"message":"world"}

```

Server terus menulis event ke response.

### 7.2 Masalah utama SSE dengan proxy buffering

Nginx default-nya bisa melakukan response buffering untuk proxy response. Untuk response biasa, ini sering bagus. Untuk SSE, buffering bisa membuat event tertahan.

Gejala:

- backend mengirim event,
- client tidak menerima event langsung,
- event baru muncul setelah buffer penuh atau koneksi selesai,
- frontend terlihat “delay” atau “hang”.

Konfigurasi SSE biasanya perlu:

```nginx
proxy_buffering off;
```

### 7.3 Konfigurasi dasar SSE

```nginx
upstream sse_backend {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl;
    server_name app.example.com;

    location /events/ {
        proxy_pass http://sse_backend;

        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;

        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

### 7.4 Header SSE yang baik dari backend

Backend sebaiknya mengirim:

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Di beberapa setup, backend juga bisa mengirim:

```http
X-Accel-Buffering: no
```

Header ini memberi sinyal ke Nginx untuk tidak melakukan buffering pada response tersebut. Namun untuk desain yang eksplisit, location SSE tetap sebaiknya punya `proxy_buffering off` agar policy terlihat di boundary config.

### 7.5 SSE dan retry semantics

Browser EventSource punya reconnect behavior.

Jika koneksi putus, browser bisa reconnect otomatis.

SSE mendukung `id`:

```text
id: 42
data: event payload

```

Client bisa mengirim `Last-Event-ID` saat reconnect.

Konsekuensi backend:

- backend harus tahu apakah event bisa direplay,
- stream harus idempotent dari perspektif konsumsi,
- jika tidak bisa replay, client mungkin kehilangan event,
- jika replay salah, client bisa menerima duplicate event.

### 7.6 SSE untuk progress update

Contoh use case Java:

```text
POST /jobs -> returns jobId
GET /jobs/{jobId}/events -> SSE stream progress
```

Nginx config:

```nginx
location ~ ^/jobs/.+/events$ {
    proxy_pass http://java_app;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 30m;
    proxy_send_timeout 30m;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Backend design:

- jangan menahan servlet thread secara blocking kalau traffic besar,
- gunakan async request processing atau reactive streaming,
- batasi jumlah stream per user,
- kirim heartbeat/comment untuk menjaga koneksi aktif:

```text
: heartbeat

```

### 7.7 Java backend implications untuk SSE

Spring MVC bisa mendukung SSE dengan `SseEmitter`, tapi perlu hati-hati:

- setiap emitter punya lifecycle,
- emitter harus di-complete atau di-cleanup saat timeout/error,
- jangan leak emitter di map in-memory,
- jangan blocking thread request terlalu lama,
- pastikan executor cukup,
- pastikan timeout aplikasi selaras dengan Nginx timeout.

Spring WebFlux lebih natural untuk streaming, tetapi tetap harus menghindari blocking operation di event loop.

Checklist SSE:

- `proxy_buffering off`?
- `proxy_cache off`?
- `proxy_read_timeout` cukup?
- backend mengirim `text/event-stream`?
- heartbeat ada?
- reconnect semantics jelas?
- event ID/replay strategy ada?
- cleanup saat disconnect ada?

---

## 8. Long Polling

Long polling adalah teknik sebelum WebSocket/SSE umum digunakan.

Flow:

```text
client -> GET /poll
server menahan request sampai ada event atau timeout
server -> response event/empty
client langsung request lagi
```

Long polling bukan persistent channel yang sama, tetapi menciptakan banyak request panjang.

### 8.1 Nginx config untuk long polling

```nginx
location /poll/ {
    proxy_pass http://java_app;
    proxy_http_version 1.1;

    proxy_buffering off;
    proxy_read_timeout 90s;
    proxy_send_timeout 90s;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 8.2 Long polling failure mode

Masalah umum:

- banyak request pending menghabiskan thread backend,
- timeout Nginx lebih pendek dari timeout aplikasi,
- client reconnect serentak setelah outage,
- retry storm,
- load balancer melihat banyak request aktif padahal payload kecil.

Desain lebih baik:

```text
Nginx timeout > app long poll timeout > expected event wait
```

Contoh:

```text
app long poll timeout: 55s
Nginx proxy_read_timeout: 65s
client reconnect delay: 0.5s - 5s jitter
```

Jangan membuat semua client reconnect tepat setiap 60 detik tanpa jitter. Itu menciptakan traffic wave.

---

## 9. gRPC Deep Dive

### 9.1 gRPC native membutuhkan HTTP/2

gRPC native berjalan di atas HTTP/2. Ini bukan sekadar HTTP endpoint JSON yang dipanggil lewat `proxy_pass`.

Di Nginx, gRPC native memakai module `ngx_http_grpc_module` dan directive `grpc_pass`.

Contoh minimal:

```nginx
server {
    listen 443 ssl http2;
    server_name grpc.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        grpc_pass grpc://grpc_backend;
    }
}

upstream grpc_backend {
    server 127.0.0.1:50051;
}
```

Hal penting:

```nginx
listen 443 ssl http2;
```

Client-facing Nginx harus menerima HTTP/2 untuk gRPC.

```nginx
grpc_pass grpc://grpc_backend;
```

Gunakan `grpc_pass`, bukan `proxy_pass`, untuk gRPC native.

### 9.2 gRPC plaintext upstream vs TLS upstream

Jika upstream gRPC plaintext:

```nginx
grpc_pass grpc://grpc_backend;
```

Jika upstream gRPC memakai TLS:

```nginx
grpc_pass grpcs://grpc_backend;
```

Contoh:

```nginx
upstream grpc_backend_tls {
    server 10.0.20.11:50051;
    server 10.0.20.12:50051;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location /com.example.OrderService/ {
        grpc_pass grpcs://grpc_backend_tls;
        grpc_ssl_server_name on;
    }
}
```

### 9.3 Routing gRPC by service/method

gRPC path biasanya berbentuk:

```text
/package.Service/Method
```

Contoh:

```text
/com.example.orders.OrderService/GetOrder
/com.example.payments.PaymentService/CreatePayment
```

Kamu bisa route berdasarkan prefix:

```nginx
location /com.example.orders.OrderService/ {
    grpc_pass grpc://orders_grpc;
}

location /com.example.payments.PaymentService/ {
    grpc_pass grpc://payments_grpc;
}
```

Ini membuat Nginx bisa menjadi routing boundary untuk beberapa gRPC service.

### 9.4 gRPC timeout

Directive gRPC punya timeout sendiri:

```nginx
grpc_connect_timeout 3s;
grpc_send_timeout 60s;
grpc_read_timeout 60s;
```

Untuk streaming gRPC, `grpc_read_timeout` harus sesuai lifecycle stream.

Contoh server streaming yang bisa idle lama:

```nginx
location /com.example.NotificationService/Subscribe {
    grpc_pass grpc://notification_grpc;

    grpc_connect_timeout 3s;
    grpc_send_timeout 1h;
    grpc_read_timeout 1h;
}
```

### 9.5 gRPC error handling

gRPC punya status sendiri di trailer, misalnya:

```text
grpc-status: 0
grpc-message: OK
```

HTTP status tidak selalu cukup untuk membaca hasil gRPC.

Masalah:

- Nginx access log default mungkin hanya menunjukkan HTTP status,
- gRPC application error bisa tidak terlihat sebagai HTTP 5xx,
- observability harus membaca gRPC status/trailer di layer aplikasi atau telemetry.

Nginx tetap berguna untuk:

- connection failure,
- upstream unavailable,
- TLS error,
- timeout,
- routing error,
- HTTP/2 negotiation issue.

Tapi business-level gRPC status sebaiknya diobservasi dari aplikasi atau OpenTelemetry.

### 9.6 gRPC-Web bukan gRPC native

Browser tidak mendukung gRPC native secara langsung seperti service-to-service backend. gRPC-Web adalah protocol berbeda yang membutuhkan translation/proxy layer.

Nginx Open Source `grpc_pass` untuk gRPC native tidak otomatis menjadi gRPC-Web transcoder.

Arsitektur umum:

```text
browser -> gRPC-Web -> Envoy/grpcwebproxy -> gRPC backend
```

Atau:

```text
browser -> REST/JSON -> backend adapter -> gRPC internal
```

Jangan mengira `grpc_pass` otomatis membuat React/Vue browser app bisa memanggil gRPC native.

### 9.7 Java gRPC backend implications

Untuk Java gRPC server:

- biasanya berjalan di Netty,
- streaming call bisa hidup lama,
- deadline/cancellation harus dihormati,
- backpressure harus dipahami,
- blocking service implementation harus diberi executor yang tepat,
- jangan melakukan blocking berat di event loop,
- monitor active calls dan active streams.

Checklist:

- Apakah client mengirim deadline?
- Apakah server menghentikan work saat call cancelled?
- Apakah streaming punya heartbeat?
- Apakah Nginx timeout lebih panjang dari expected idle stream?
- Apakah retry policy aman untuk method tersebut?
- Apakah unary dan streaming dipisah timeout-nya?

---

## 10. Timeout Design untuk Long-Lived Traffic

### 10.1 Timeout bukan angka teknis, tapi policy lifecycle

Timeout menjawab pertanyaan:

> “Berapa lama kita bersedia mempertahankan resource ketika tidak ada progress?”

Untuk API biasa:

```text
connect timeout: pendek
read timeout: sesuai SLA endpoint
send timeout: sesuai ukuran request
```

Untuk long-lived:

```text
connect timeout: tetap pendek
read timeout: sesuai idle period channel
send timeout: sesuai kemampuan client/upstream menerima data
```

### 10.2 Pattern timeout yang sehat

Untuk WebSocket/SSE:

```text
heartbeat interval < proxy_read_timeout < outer load balancer idle timeout
```

Contoh:

```text
application heartbeat: 25s
Nginx proxy_read_timeout: 75s
cloud load balancer idle timeout: 120s
```

Kalau outer load balancer punya idle timeout 60 detik, maka Nginx timeout 1 jam tidak cukup. Koneksi tetap bisa diputus di layer luar.

### 10.3 Jangan menyamakan semua timeout

Anti-pattern:

```nginx
proxy_read_timeout 300s;
```

Ditaruh global untuk semua endpoint.

Masalah:

- API biasa bisa menggantung terlalu lama,
- thread backend tertahan,
- client menunggu lama,
- failure detection lambat,
- retry dari client/app bisa numpuk.

Lebih baik:

```nginx
location /api/ {
    proxy_read_timeout 30s;
}

location /ws/ {
    proxy_read_timeout 1h;
}

location /events/ {
    proxy_read_timeout 1h;
    proxy_buffering off;
}
```

Timeout adalah bagian dari route contract.

---

## 11. Buffering Design

### 11.1 Buffering membantu request-response biasa

Untuk API biasa, buffering bisa membantu:

- melindungi backend dari slow client,
- menyerap response sebelum dikirim ke client,
- mengurangi waktu backend memegang koneksi,
- memungkinkan Nginx mengirim response ke client lambat.

### 11.2 Buffering bisa merusak streaming

Untuk SSE dan streaming response:

```nginx
proxy_buffering off;
```

Untuk request streaming besar, perlu juga memahami:

```nginx
proxy_request_buffering off;
```

Namun `proxy_request_buffering off` bukan default yang selalu baik. Jika dimatikan, backend langsung terkena slow upload dari client.

### 11.3 WebSocket bukan response buffering biasa

Setelah upgrade, WebSocket adalah tunnel-like proxied connection. Fokus utama bukan `proxy_buffering`, tetapi:

- HTTP version,
- Upgrade/Connection header,
- read/send timeout,
- connection lifetime,
- backend connection capacity.

### 11.4 SSE buffering checklist

Untuk SSE location:

```nginx
proxy_buffering off;
proxy_cache off;
gzip off;
```

Kenapa `gzip off` kadang dipertimbangkan?

Karena compression dapat memperkenalkan buffering tambahan dan membuat event kecil tidak langsung flush. Tidak selalu wajib, tetapi sering lebih aman untuk event stream yang butuh low-latency flush.

---

## 12. Load Balancing Long-Lived Connections

### 12.1 Request count bukan lagi metrik cukup

Untuk API biasa:

```text
backend A: 1000 request/min
backend B: 1000 request/min
```

Terlihat seimbang.

Untuk WebSocket:

```text
backend A: 10.000 active connections
backend B: 2.000 active connections
```

Meskipun request count awalnya seimbang, lifetime koneksi bisa membuat beban tidak seimbang.

### 12.2 Round robin dan long-lived connection

Round robin memilih upstream saat koneksi dimulai. Jika koneksi panjang, backend yang kebetulan menerima banyak koneksi panjang akan tetap terbebani.

```nginx
upstream ws_backend {
    server 10.0.10.11:8080;
    server 10.0.10.12:8080;
}
```

Sederhana, tetapi tidak selalu optimal untuk connection-heavy workload.

### 12.3 Least connections

```nginx
upstream ws_backend {
    least_conn;
    server 10.0.10.11:8080;
    server 10.0.10.12:8080;
}
```

Ini bisa lebih cocok untuk long-lived connection karena mempertimbangkan active connection count.

Namun tetap tidak sempurna:

- satu koneksi bisa ringan atau berat,
- satu user bisa membuka banyak subscription,
- message rate antar koneksi berbeda.

### 12.4 State externalization

Desain paling scalable biasanya:

```text
Nginx -> any WebSocket node -> shared broker/state
```

Bukan:

```text
Nginx -> sticky WebSocket node with all state in memory
```

Shared broker/state memungkinkan:

- reconnect ke node berbeda,
- rolling deploy lebih aman,
- horizontal scaling,
- failure recovery lebih baik,
- observability lebih terpusat.

---

## 13. Deployment dan Draining

### 13.1 Mengapa rolling deploy lebih sulit

Untuk API biasa:

```text
stop accepting new requests
finish in-flight requests
shutdown
```

Untuk WebSocket/SSE/gRPC streaming:

```text
stop accepting new connections
existing connections may live for hours
need drain policy
```

Jika langsung kill backend:

- semua connection putus,
- client reconnect serentak,
- traffic spike,
- auth/session refresh spike,
- subscription replay spike,
- thundering herd.

### 13.2 Drain strategy

Ideal flow:

```text
1. mark instance not ready
2. Nginx/load balancer stops sending new connections
3. existing connections continue for grace period
4. app sends graceful close/drain message
5. clients reconnect with jitter
6. instance exits after max drain deadline
```

### 13.3 Nginx upstream drain di open source context

Nginx Open Source tidak punya semua fitur active health/drain canggih seperti NGINX Plus. Dalam praktik, drain sering dikelola oleh:

- Kubernetes readiness probe,
- service endpoint removal,
- orchestration layer,
- deployment controller,
- external load balancer,
- config reload removing upstream gradually,
- app-level graceful shutdown.

### 13.4 Client reconnect policy

Client harus punya reconnect dengan backoff dan jitter.

Anti-pattern:

```text
on disconnect -> reconnect immediately
```

Lebih baik:

```text
on disconnect -> wait random 500ms-3000ms
repeated failure -> exponential backoff with max cap
successful connection -> reset backoff
```

Untuk ribuan/millions client, reconnect policy adalah bagian dari reliability design.

---

## 14. Observability untuk Long-Lived Traffic

### 14.1 Access log keluar saat request selesai

Untuk WebSocket/SSE/gRPC streaming, access log biasanya tercatat ketika koneksi selesai.

Artinya real-time visibility dari access log terbatas.

Kamu perlu metrik tambahan:

- active connections,
- active WebSocket sessions,
- active SSE emitters,
- active gRPC streams,
- message rate,
- bytes in/out,
- reconnect rate,
- abnormal close count,
- backend cancellation count,
- heartbeat failures,
- timeout close count.

### 14.2 Log format yang membantu

Contoh log format Nginx:

```nginx
log_format upstream_timing escape=json
'{'
  '"time":"$time_iso8601",'
  '"remote_addr":"$remote_addr",'
  '"host":"$host",'
  '"request":"$request",'
  '"status":$status,'
  '"body_bytes_sent":$body_bytes_sent,'
  '"request_time":$request_time,'
  '"upstream_addr":"$upstream_addr",'
  '"upstream_status":"$upstream_status",'
  '"upstream_connect_time":"$upstream_connect_time",'
  '"upstream_header_time":"$upstream_header_time",'
  '"upstream_response_time":"$upstream_response_time",'
  '"http_upgrade":"$http_upgrade",'
  '"request_id":"$request_id"'
'}';
```

Untuk WebSocket, `request_time` bisa menunjukkan durasi koneksi. Ini berguna, tetapi baru diketahui setelah koneksi selesai.

### 14.3 Status code khas

Untuk long-lived connection:

- `101` untuk WebSocket switching protocols,
- `200` untuk SSE stream,
- `499` ketika client menutup koneksi sebelum Nginx selesai,
- `502` upstream gagal/refused/reset,
- `504` upstream timeout,
- `499` tinggi bisa normal untuk long-lived client disconnect, tapi bisa juga indikasi network/client timeout.

Jangan langsung menganggap semua `499` sebagai error aplikasi. Interpretasi harus melihat endpoint dan traffic type.

### 14.4 Java metrics yang wajib ada

Untuk WebSocket:

- active sessions,
- sessions per node,
- messages in/out,
- failed sends,
- close reason,
- reconnect/auth rate,
- memory per session approximation.

Untuk SSE:

- active emitters/subscribers,
- event delivery latency,
- emitter timeout count,
- broken pipe count,
- replay count,
- dropped event count.

Untuk gRPC:

- active calls,
- active streams,
- call duration,
- deadline exceeded,
- cancelled,
- unavailable,
- message size,
- retry count,
- per-method latency/status.

---

## 15. Security Considerations

### 15.1 Long-lived connection memperpanjang attack window

Long-lived connection berarti:

- resource ditahan lebih lama,
- authorization decision bisa stale,
- revoked token mungkin tetap punya koneksi aktif,
- rate limiting per request tidak cukup,
- connection exhaustion lebih mudah terjadi.

### 15.2 Authentication dan authorization

Pertanyaan desain:

- Apakah token divalidasi hanya saat connect?
- Apa yang terjadi jika user logout atau token dicabut?
- Apakah server bisa menutup koneksi berdasarkan revocation event?
- Apakah setiap message WebSocket butuh authorization tambahan?
- Apakah subscription SSE dicek per resource?
- Apakah gRPC streaming method punya authorization per message atau per call?

### 15.3 Limit jumlah koneksi

Nginx bisa membantu dengan `limit_conn`:

```nginx
limit_conn_zone $binary_remote_addr zone=perip_conn:10m;

server {
    location /ws/ {
        limit_conn perip_conn 20;
        proxy_pass http://java_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

Tapi hati-hati:

- banyak user bisa berada di balik NAT yang sama,
- per-IP limit bisa unfair,
- lebih baik jika bisa limit berdasarkan authenticated identity di application layer.

### 15.4 Message-level abuse

Nginx melihat koneksi, tetapi tidak selalu memahami message semantics WebSocket atau gRPC payload.

Untuk WebSocket:

- rate limit per message harus di aplikasi,
- validasi payload di aplikasi,
- size limit di aplikasi,
- authz per action di aplikasi.

Untuk gRPC:

- per-method rate limit bisa sulit di Nginx OSS,
- interceptor di Java gRPC sering lebih tepat,
- observability per method harus di application/telemetry layer.

---

## 16. Common Production Recipes

### 16.1 WebSocket production template

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream websocket_backend {
    least_conn;
    server 10.0.10.11:8080 max_fails=3 fail_timeout=30s;
    server 10.0.10.12:8080 max_fails=3 fail_timeout=30s;
    keepalive 64;
}

server {
    listen 443 ssl;
    server_name realtime.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    access_log /var/log/nginx/realtime_access.log upstream_timing;
    error_log  /var/log/nginx/realtime_error.log warn;

    location /ws/ {
        proxy_pass http://websocket_backend;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 3s;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

Catatan:

- Timeout 75s diasumsikan aplikasi mengirim heartbeat lebih sering, misalnya 25-30s.
- Untuk koneksi yang benar-benar idle lama, timeout bisa lebih panjang, tetapi harus selaras dengan outer load balancer.

### 16.2 SSE production template

```nginx
upstream event_backend {
    least_conn;
    server 10.0.20.11:8080 max_fails=3 fail_timeout=30s;
    server 10.0.20.12:8080 max_fails=3 fail_timeout=30s;
}

server {
    listen 443 ssl;
    server_name events.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location /events/ {
        proxy_pass http://event_backend;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        gzip off;

        proxy_connect_timeout 3s;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

### 16.3 gRPC production template

```nginx
upstream order_grpc_backend {
    least_conn;
    server 10.0.30.11:50051 max_fails=3 fail_timeout=30s;
    server 10.0.30.12:50051 max_fails=3 fail_timeout=30s;
}

server {
    listen 443 ssl http2;
    server_name grpc.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location /com.example.orders.OrderService/ {
        grpc_pass grpc://order_grpc_backend;

        grpc_set_header Host $host;
        grpc_set_header X-Real-IP $remote_addr;
        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        grpc_set_header X-Forwarded-Proto $scheme;

        grpc_connect_timeout 3s;
        grpc_send_timeout 60s;
        grpc_read_timeout 60s;
    }
}
```

Untuk streaming method, buat location yang lebih spesifik:

```nginx
location /com.example.orders.OrderStreamService/WatchOrders {
    grpc_pass grpc://order_grpc_backend;
    grpc_connect_timeout 3s;
    grpc_send_timeout 1h;
    grpc_read_timeout 1h;
}
```

---

## 17. Failure Mode Catalog

### 17.1 WebSocket gagal connect dengan 400/426

Kemungkinan:

- `proxy_http_version 1.1` tidak diset,
- `Upgrade` header tidak diteruskan,
- `Connection` header salah,
- backend endpoint bukan WebSocket endpoint,
- path salah akibat `proxy_pass` slash semantics,
- TLS/WSS mismatch.

Debug:

```bash
curl -i \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==' \
  https://app.example.com/ws/
```

### 17.2 WebSocket connect berhasil tapi putus periodik

Kemungkinan:

- `proxy_read_timeout` terlalu pendek,
- outer load balancer idle timeout,
- tidak ada heartbeat,
- mobile network/proxy menutup idle connection,
- backend menutup session idle.

Debug:

- lihat durasi koneksi di access log,
- bandingkan dengan timeout Nginx dan cloud LB,
- cek heartbeat interval,
- cek close code di client/backend.

### 17.3 SSE event tertahan

Kemungkinan:

- `proxy_buffering on`,
- gzip/compression buffering,
- backend tidak flush,
- framework buffering response,
- content type salah,
- cache layer menahan response.

Solusi:

```nginx
proxy_buffering off;
proxy_cache off;
gzip off;
```

Backend harus flush event.

### 17.4 SSE reconnect terus-menerus

Kemungkinan:

- timeout terlalu pendek,
- backend emitter timeout,
- proxy/load balancer idle timeout,
- tidak ada heartbeat comment,
- client menerima malformed event stream.

Solusi:

- heartbeat `: ping\n\n`,
- timeout alignment,
- event format valid,
- cleanup emitter.

### 17.5 gRPC 502

Kemungkinan:

- upstream bukan gRPC server,
- memakai `proxy_pass` bukan `grpc_pass`,
- HTTP/2 tidak aktif di listener,
- upstream TLS/plaintext mismatch,
- service path salah,
- backend refused connection,
- frame/protocol mismatch.

Debug:

```bash
grpcurl -v grpc.example.com:443 list
```

Atau plaintext internal:

```bash
grpcurl -plaintext 127.0.0.1:50051 list
```

### 17.6 Banyak 499 pada endpoint streaming

Kemungkinan:

- client disconnect normal,
- browser tab ditutup,
- mobile network putus,
- client timeout,
- deploy/reconnect storm,
- proxy/load balancer di depan Nginx menutup koneksi.

Interpretasi:

- 499 pada API biasa sering perlu investigasi latency.
- 499 pada SSE/WebSocket bisa normal dalam volume tertentu.
- Kenaikan mendadak tetap perlu investigasi.

### 17.7 Backend memory naik terus

Kemungkinan:

- WebSocket session tidak dibersihkan,
- SSE emitter leak,
- subscription tidak unsubscribe,
- reconnect membuat duplicate subscription,
- per-connection buffer terlalu besar,
- client lambat membuat queue menumpuk,
- message fanout tidak punya backpressure.

Solusi:

- cleanup on close/error/timeout,
- bounded queue,
- per-user connection limit,
- backpressure/drop policy,
- memory profiling,
- active session metrics.

---

## 18. Debugging Playbook

### 18.1 Klasifikasi traffic dulu

Sebelum debug, jawab:

```text
Apakah ini request-response biasa, WebSocket, SSE, long polling, unary gRPC, atau streaming gRPC?
```

Tanpa klasifikasi, kamu bisa memakai tool/timeout yang salah.

### 18.2 Cek effective config

```bash
nginx -T | less
```

Cari:

```bash
nginx -T | grep -n "location /ws"
nginx -T | grep -n "proxy_read_timeout"
nginx -T | grep -n "grpc_pass"
nginx -T | grep -n "proxy_buffering"
```

### 18.3 Test config syntax

```bash
nginx -t
```

### 18.4 Debug WebSocket

Gunakan tool seperti `websocat`:

```bash
websocat -v wss://app.example.com/ws/notifications
```

Atau `wscat`:

```bash
wscat -c wss://app.example.com/ws/notifications
```

Cek response handshake:

```bash
curl -i \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==' \
  https://app.example.com/ws/notifications
```

Expected:

```text
HTTP/1.1 101 Switching Protocols
```

### 18.5 Debug SSE

```bash
curl -N -v https://app.example.com/events/stream
```

`-N` membuat curl tidak melakukan buffering output.

Cek apakah event muncul langsung:

```text
: heartbeat

event: notification
data: {...}

```

Jika backend log bilang event terkirim tapi curl tidak menerima, curigai buffering.

### 18.6 Debug gRPC

```bash
grpcurl -v grpc.example.com:443 list
```

Dengan proto:

```bash
grpcurl \
  -proto order.proto \
  -d '{"id":"123"}' \
  grpc.example.com:443 \
  com.example.orders.OrderService/GetOrder
```

Internal plaintext:

```bash
grpcurl -plaintext 10.0.30.11:50051 list
```

Jika direct upstream berhasil tapi melalui Nginx gagal, masalah ada pada Nginx listener, TLS, HTTP/2, route, atau `grpc_pass`.

### 18.7 Cek outer load balancer

Untuk disconnect periodik, jangan berhenti di Nginx.

Cek juga:

- cloud load balancer idle timeout,
- Kubernetes ingress timeout,
- CDN/proxy timeout,
- corporate proxy,
- mobile network behavior,
- browser limits.

Nginx bukan selalu layer yang memutus koneksi.

---

## 19. Design Decision Matrix

| Kebutuhan | WebSocket | SSE | gRPC Streaming | Long Polling |
|---|---:|---:|---:|---:|
| Browser native | Ya | Ya | Tidak native | Ya |
| Server ke client | Ya | Ya | Ya | Ya, via repeated response |
| Client ke server realtime | Ya | Tidak | Ya | Terbatas |
| Full-duplex | Ya | Tidak | Ya untuk bidi streaming | Tidak |
| Simple implementation | Sedang | Tinggi | Sedang/Rumit | Sedang |
| Strong typing | Tidak bawaan | Tidak bawaan | Ya | Tidak bawaan |
| Cocok internal microservice | Kadang | Jarang | Ya | Jarang |
| Proxy buffering concern | Timeout/header | Sangat penting | Timeout/protocol | Timeout/buffering |
| Browser reconnect built-in | Tidak standar universal | Ya | Tidak native | Manual |
| Load balancing concern | Active connections | Active streams | Active streams | Pending requests |

### Rekomendasi praktis

Gunakan SSE jika:

- hanya butuh server-to-client,
- browser client,
- event sederhana,
- ingin fallback/reconnect lebih mudah.

Gunakan WebSocket jika:

- butuh bidirectional realtime,
- message frequent dari dua arah,
- client dan server punya interaction loop.

Gunakan gRPC streaming jika:

- service-to-service internal,
- kontrak strongly typed,
- butuh streaming efisien,
- client bukan browser biasa.

Gunakan long polling jika:

- environment tidak mendukung WebSocket/SSE,
- kebutuhan realtime rendah,
- ingin kompatibilitas maksimal,
- kamu siap menangani pending request load.

---

## 20. Architecture Patterns

### 20.1 Pattern: Browser notification dengan SSE

```text
Browser
  -> Nginx /events/stream
    -> Java Notification Service
      -> Redis/Kafka topic
```

Nginx:

- disables buffering,
- long read timeout,
- TLS termination,
- logs duration.

Java:

- subscribes user to topic,
- sends event stream,
- heartbeat,
- replay using event ID.

### 20.2 Pattern: Collaborative app dengan WebSocket

```text
Browser
  -> Nginx /ws/collab
    -> Java WebSocket Gateway
      -> Redis/NATS/Kafka
      -> Collaboration state service
```

Nginx:

- upgrade headers,
- least_conn,
- connection timeout,
- connection limiting.

Java:

- validates user/session,
- handles messages,
- externalizes room state,
- cleanup on disconnect,
- reconnect resume.

### 20.3 Pattern: Internal Java microservices dengan gRPC

```text
Service A
  -> Nginx or internal gateway
    -> gRPC Service B
```

Nginx:

- `listen ... http2`,
- `grpc_pass`,
- route by service prefix,
- TLS/mTLS boundary,
- timeout per method group.

Java:

- deadlines,
- cancellation,
- interceptors,
- OpenTelemetry,
- per-method metrics.

---

## 21. Anti-Patterns

### 21.1 Satu location untuk semua traffic

```nginx
location / {
    proxy_pass http://java_app;
    proxy_read_timeout 1h;
    proxy_buffering off;
}
```

Masalah:

- API biasa punya timeout terlalu panjang,
- buffering mati untuk semua response,
- performa turun,
- failure detection lambat,
- behavior tidak spesifik.

Lebih baik pisahkan:

```nginx
location /api/ { ... }
location /ws/ { ... }
location /events/ { ... }
```

### 21.2 WebSocket state penuh di memory node

Masalah:

- reconnect ke node lain kehilangan state,
- deploy memutus state,
- node crash kehilangan semua session/subscription,
- scaling sulit.

Lebih baik externalize state atau minimal desain reconnect/resume.

### 21.3 SSE tanpa heartbeat

Masalah:

- idle timeout memutus koneksi,
- client reconnect sering,
- tidak jelas apakah koneksi sehat.

Lebih baik kirim comment heartbeat:

```text
: heartbeat

```

### 21.4 gRPC tanpa deadline

Masalah:

- call bisa menggantung,
- resource tertahan,
- cancellation tidak jelas,
- cascading failure.

Client gRPC harus mengirim deadline yang masuk akal. Server harus menghormati cancellation.

### 21.5 Reconnect tanpa jitter

Masalah:

- outage kecil menjadi traffic storm,
- semua client reconnect bersamaan,
- backend yang baru naik langsung overload.

Gunakan exponential backoff + jitter.

---

## 22. Production Checklist

### 22.1 WebSocket checklist

- [ ] Location WebSocket dipisah dari API biasa.
- [ ] `proxy_http_version 1.1` diset.
- [ ] `Upgrade` header diteruskan.
- [ ] `Connection` header memakai `map` atau diset benar.
- [ ] `proxy_read_timeout` sesuai heartbeat.
- [ ] Heartbeat ada.
- [ ] Reconnect client memakai backoff + jitter.
- [ ] Active connection metric ada.
- [ ] Cleanup on disconnect ada.
- [ ] Per-user/per-IP connection limit dipertimbangkan.
- [ ] Deployment drain strategy ada.
- [ ] State tidak bergantung penuh pada satu node, atau ada resume strategy.

### 22.2 SSE checklist

- [ ] Location SSE dipisah.
- [ ] `proxy_buffering off`.
- [ ] `proxy_cache off`.
- [ ] Compression behavior dipahami.
- [ ] Backend mengirim `text/event-stream`.
- [ ] Backend flush event.
- [ ] Heartbeat comment ada.
- [ ] Event ID/replay strategy jelas jika event penting.
- [ ] Active emitter metric ada.
- [ ] Cleanup emitter on timeout/error ada.

### 22.3 gRPC checklist

- [ ] Listener client-facing memakai HTTP/2.
- [ ] Menggunakan `grpc_pass`, bukan `proxy_pass`.
- [ ] Plaintext/TLS upstream benar: `grpc://` vs `grpcs://`.
- [ ] Timeout unary dan streaming dibedakan.
- [ ] Deadline/cancellation di aplikasi dipakai.
- [ ] Per-method observability ada.
- [ ] gRPC-Web tidak diasumsikan otomatis didukung.
- [ ] Routing service/method path eksplisit.
- [ ] Load balancing sesuai active streams/calls.

### 22.4 General long-lived checklist

- [ ] Outer load balancer idle timeout diketahui.
- [ ] Nginx timeout selaras dengan outer layer.
- [ ] Backend timeout selaras dengan Nginx.
- [ ] Client reconnect policy aman.
- [ ] Rolling deploy tidak memutus semua koneksi tanpa kontrol.
- [ ] Capacity dihitung berdasarkan active connections, bukan hanya RPS.
- [ ] File descriptor limit cukup.
- [ ] Memory per connection dipahami.
- [ ] 499/502/504 dimonitor per endpoint type.

---

## 23. Mini Lab

### Lab 1 — WebSocket echo behind Nginx

Tujuan:

- menjalankan WebSocket backend sederhana,
- proxy melalui Nginx,
- menguji upgrade header,
- mengamati disconnect karena timeout.

Eksperimen:

1. Set `proxy_read_timeout 10s`.
2. Jangan kirim heartbeat.
3. Amati koneksi putus sekitar 10 detik idle.
4. Tambahkan heartbeat tiap 5 detik.
5. Amati koneksi tetap hidup.

Pelajaran:

> Timeout bukan error jika tidak ada progress; timeout adalah policy.

### Lab 2 — SSE buffering

Tujuan:

- melihat efek `proxy_buffering on/off`.

Eksperimen:

1. Backend mengirim event setiap 1 detik.
2. Nginx default buffering.
3. Test dengan `curl -N`.
4. Tambahkan `proxy_buffering off`.
5. Bandingkan latency event.

Pelajaran:

> Response streaming membutuhkan proxy policy berbeda dari response biasa.

### Lab 3 — gRPC through Nginx

Tujuan:

- membedakan `proxy_pass` dan `grpc_pass`.

Eksperimen:

1. Jalankan gRPC Java server di port 50051.
2. Konfigurasi Nginx dengan `proxy_pass`; amati gagal.
3. Ganti ke `grpc_pass` dan `listen ... http2`.
4. Test dengan `grpcurl`.

Pelajaran:

> gRPC native bukan HTTP JSON endpoint; protocol layer harus benar.

---

## 24. Latihan Desain

### Skenario

Kamu membangun platform case management internal dengan fitur:

1. UI Vue/React.
2. Backend Java Spring Boot.
3. Notification realtime untuk assigned case.
4. Progress streaming untuk long-running enforcement workflow.
5. Internal service-to-service RPC untuk decision engine.

Tentukan:

- WebSocket, SSE, atau gRPC untuk masing-masing kebutuhan.
- Route Nginx untuk setiap traffic type.
- Timeout masing-masing.
- Buffering policy.
- Load balancing strategy.
- Observability metric.
- Deployment drain policy.

### Jawaban contoh

```text
Notification realtime:
  Browser-facing.
  Jika hanya server-to-client -> SSE.
  Jika user juga mengirim realtime interaction -> WebSocket.

Progress workflow:
  SSE cocok karena server mengirim progress event.
  Butuh replay/event ID jika progress penting.

Decision engine internal:
  gRPC cocok karena typed internal service contract.
  Unary untuk keputusan biasa, streaming jika ada incremental result.
```

Nginx route:

```nginx
location /api/      { proxy_pass http://java_api; }
location /events/   { proxy_pass http://java_api; proxy_buffering off; }
location /ws/       { proxy_pass http://java_api; websocket headers; }
location /grpc...   { grpc_pass grpc://decision_engine; }
```

---

## 25. Ringkasan Mental Model

Long-lived traffic mengubah Nginx dari sekadar reverse proxy request-response menjadi **connection lifecycle manager**.

Perbedaan penting:

```text
HTTP API biasa:
  optimize completion
  timeout pendek
  buffering sering membantu
  retry kadang mungkin
  log cepat keluar

WebSocket/SSE/gRPC streaming:
  manage channel lifetime
  timeout berdasarkan heartbeat/idle policy
  buffering sering harus dikontrol
  retry/reconnect harus hati-hati
  observability perlu active connection metrics
```

Rule of thumb:

1. Pisahkan route berdasarkan traffic shape.
2. Jangan pakai timeout global untuk semua endpoint.
3. Streaming biasanya tidak cocok dengan buffering default.
4. Heartbeat adalah bagian dari protocol contract.
5. Load balancing long-lived connection harus melihat active connection, bukan hanya RPS.
6. Rolling deploy butuh drain strategy.
7. Security harus mempertimbangkan koneksi yang tetap hidup setelah auth decision awal.
8. gRPC native butuh HTTP/2 dan `grpc_pass`.
9. Browser gRPC-Web bukan gRPC native.
10. Observability harus mencakup active sessions/streams, bukan hanya access log.

---

## 26. Referensi Utama

- NGINX official documentation — WebSocket proxying: `https://nginx.org/en/docs/http/websocket.html`
- NGINX official documentation — ngx_http_proxy_module: `https://nginx.org/en/docs/http/ngx_http_proxy_module.html`
- NGINX official documentation — ngx_http_grpc_module: `https://nginx.org/en/docs/http/ngx_http_grpc_module.html`
- NGINX documentation — TCP and UDP load balancing: `https://docs.nginx.com/nginx/admin-guide/load-balancer/tcp-udp-load-balancer/`

---

## 27. Penutup Part 022

Pada bagian ini kita membangun pemahaman bahwa WebSocket, SSE, gRPC, dan long polling bukan sekadar variasi endpoint. Mereka adalah variasi **connection lifecycle**.

Untuk engineer backend Java, pemahaman ini penting karena kesalahan di Nginx sering terlihat sebagai bug aplikasi:

- WebSocket dianggap “backend unstable”, padahal timeout proxy salah.
- SSE dianggap “frontend tidak receive event”, padahal response dibuffer.
- gRPC dianggap “service unavailable”, padahal listener HTTP/2 atau `grpc_pass` salah.
- Deploy dianggap “normal”, padahal reconnect storm menjatuhkan cluster.

Bagian berikutnya akan membahas **Part 023 — Blue-Green, Canary, Shadow Traffic, and Progressive Delivery**, yaitu bagaimana Nginx dapat membantu rollout, routing terkontrol, eksperimen traffic, dan rollback dengan risiko lebih rendah.

