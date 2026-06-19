# learn-nginx-mastery-for-java-engineers-part-013.md

# Part 013 — HTTP/2, HTTP/3/QUIC, and Protocol-Level Trade-Offs

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `013 / 030`  
> Fokus: memahami HTTP/2 dan HTTP/3/QUIC di Nginx sebagai keputusan operasional, bukan sekadar fitur protokol.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun fondasi Nginx sebagai reverse proxy untuk aplikasi Java:

- konfigurasi dasar,
- server selection,
- location matching,
- static serving,
- reverse proxy,
- proxy header contract,
- upstream/load balancing,
- timeout/buffering/backpressure,
- connection tuning,
- TLS termination.

Part ini membahas lapisan berikutnya: **protokol yang digunakan antara client, Nginx, dan upstream**.

Namun part ini **tidak akan mengulang seri HTTP frontend/backend**. Kita tidak akan membahas ulang apa itu method, status code, header, caching browser, atau request/response dasar.

Yang kita bahas adalah:

```text
Client/browser/mobile/gRPC client
        |
        |  HTTP/1.1? HTTP/2? HTTP/3?
        v
      Nginx
        |
        |  HTTP/1.1? HTTP/2? gRPC? plaintext? TLS?
        v
Java backend / service mesh / upstream gateway
```

Pertanyaan utama part ini:

> Ketika kamu mengaktifkan HTTP/2 atau HTTP/3 di Nginx, apa sebenarnya yang berubah dalam perilaku koneksi, latency, observability, compatibility, failure mode, dan kontrak dengan aplikasi Java?

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan **client-side protocol** dan **upstream-side protocol**.
2. Memahami bahwa HTTP/2/HTTP/3 di sisi client tidak otomatis berarti backend Java juga menerima HTTP/2/HTTP/3.
3. Menjelaskan perbedaan operasional HTTP/1.1, HTTP/2, dan HTTP/3/QUIC.
4. Mengaktifkan HTTP/2 di Nginx dengan konfigurasi modern.
5. Memahami kapan HTTP/2 bermanfaat dan kapan tidak banyak membantu.
6. Memahami HTTP/3 sebagai QUIC-over-UDP, bukan “HTTP/2 versi baru di TCP”.
7. Memahami ALPN dan Alt-Svc sebagai mekanisme negosiasi protokol.
8. Mendesain konfigurasi Nginx untuk:
   - browser HTTPS traffic,
   - static asset delivery,
   - REST API,
   - gRPC,
   - WebSocket/SSE coexistence,
   - gradual HTTP/3 adoption.
9. Menganalisis failure mode seperti:
   - browser tetap pakai HTTP/1.1,
   - gRPC gagal karena HTTP/2 tidak benar,
   - HTTP/3 tidak aktif karena UDP/443 diblokir,
   - protocol mismatch ke upstream,
   - misleading benchmark.

---

## 2. Mental Model Utama

### 2.1 Nginx adalah protocol boundary

Nginx sering berada di titik di mana protokol eksternal dan internal berbeda.

Contoh umum:

```text
Browser --HTTPS/HTTP2--> Nginx --HTTP/1.1--> Spring Boot
```

Atau:

```text
gRPC client --HTTPS/HTTP2--> Nginx --h2c/HTTP2--> Java gRPC server
```

Atau:

```text
Browser --HTTP/3/QUIC/UDP--> Nginx --HTTP/1.1/TCP--> backend API
```

Ini penting karena banyak engineer keliru berpikir:

> “Kalau Nginx sudah HTTP/2, backend saya juga otomatis HTTP/2.”

Tidak. Nginx bisa menerima HTTP/2 dari client lalu meneruskan request ke upstream dengan HTTP/1.1. Nginx melakukan terminasi koneksi dan membangun koneksi baru ke upstream.

Jadi selalu tanyakan:

```text
Protocol A: client -> Nginx
Protocol B: Nginx -> upstream
```

Keduanya bisa sama, bisa berbeda.

---

### 2.2 HTTP/2 dan HTTP/3 adalah keputusan koneksi, bukan keputusan endpoint

Endpoint `/api/orders` tetap endpoint yang sama. Yang berubah adalah **cara bytes dikirim di connection layer**.

Untuk aplikasi Java biasa yang menerima request dari Nginx via HTTP/1.1, aplikasi mungkin tidak tahu client awalnya memakai HTTP/2 atau HTTP/3.

Dari perspektif aplikasi:

```java
GET /api/orders
Host: api.example.com
X-Forwarded-Proto: https
X-Forwarded-For: ...
```

Aplikasi tidak otomatis tahu:

```text
Original client protocol = h2 or h3
```

Jika informasi itu penting untuk logging/observability, kamu harus eksplisit menambahkan header dari Nginx, misalnya:

```nginx
proxy_set_header X-Forwarded-Protocol $server_protocol;
```

Tetapi hati-hati: `$server_protocol` merepresentasikan protokol request yang Nginx lihat dari client, bukan protokol ke upstream.

---

### 2.3 Protocol upgrade bukan magic performance button

HTTP/2 dan HTTP/3 bisa meningkatkan performa pada kondisi tertentu, tetapi bukan jaminan.

Faktor yang menentukan:

- jumlah resource per page,
- latency jaringan,
- packet loss,
- ukuran response,
- congestion,
- TLS handshake reuse,
- cache hit ratio,
- origin latency,
- buffering,
- backend bottleneck,
- browser behavior,
- CDN/proxy chain,
- mobile network condition.

Jika bottleneck utama adalah query database 800 ms, mengaktifkan HTTP/2 tidak membuat API menjadi cepat secara substansial.

Jika bottleneck utama adalah banyak asset kecil pada jaringan high latency, HTTP/2 atau HTTP/3 bisa terasa lebih berguna.

---

## 3. Baseline Resmi dan Terminologi Nginx

Beberapa fakta penting dari dokumentasi resmi Nginx:

- Nginx mendukung HTTP/2 melalui modul `ngx_http_v2_module`.
- Konfigurasi modern HTTP/2 menggunakan directive `http2 on;` di context `http` atau `server`.
- Nginx menyediakan dukungan HTTP/3/QUIC sejak versi 1.25.0, dan dokumentasi resmi mengarahkan ke `ngx_http_v3_module` untuk detailnya.
- Nginx memiliki module `ngx_http_grpc_module` untuk meneruskan request ke gRPC server; module ini membutuhkan HTTP/2 module.

Catatan versi penting:

```nginx
# Format lama yang masih sering ditemukan:
listen 443 ssl http2;

# Format modern:
listen 443 ssl;
http2 on;
```

Format lama `listen ... http2` menghasilkan warning pada versi Nginx modern tertentu. Gunakan `http2 on;` agar konfigurasi lebih eksplisit dan forward-compatible.

---

## 4. HTTP/1.1 vs HTTP/2 vs HTTP/3 dalam Perspektif Nginx

### 4.1 HTTP/1.1

HTTP/1.1 di atas TCP.

Karakteristik umum:

- satu koneksi TCP dapat dipakai ulang lewat keepalive,
- request/response pada satu koneksi cenderung berurutan,
- browser biasanya membuka beberapa koneksi paralel ke satu origin,
- header dikirim sebagai teks,
- mudah di-debug dengan tools klasik,
- sangat kompatibel dengan backend Java.

Di Nginx, HTTP/1.1 masih sangat relevan, terutama untuk upstream:

```nginx
location /api/ {
    proxy_pass http://java_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
}
```

Untuk REST API biasa, HTTP/1.1 dari Nginx ke Java backend sering cukup baik, terutama jika upstream keepalive dikonfigurasi benar.

---

### 4.2 HTTP/2

HTTP/2 tetap berjalan di atas TCP, tetapi memperkenalkan framing biner dan multiplexing.

Karakteristik penting:

- banyak stream logis dalam satu koneksi TCP,
- header compression,
- lebih efisien untuk banyak request kecil,
- mengurangi kebutuhan membuka banyak TCP connection,
- lebih baik untuk browser asset loading pada kondisi tertentu,
- diperlukan untuk gRPC tradisional.

Mental model:

```text
HTTP/1.1:
Connection A: request 1 -> response 1
Connection B: request 2 -> response 2
Connection C: request 3 -> response 3

HTTP/2:
Single connection:
  stream 1: request/response
  stream 3: request/response
  stream 5: request/response
```

Namun karena HTTP/2 masih berada di atas TCP, packet loss pada TCP connection dapat memengaruhi semua stream di koneksi itu pada layer transport.

---

### 4.3 HTTP/3

HTTP/3 berjalan di atas QUIC, dan QUIC berjalan di atas UDP.

Karakteristik penting:

- bukan TCP,
- menggunakan UDP,
- TLS 1.3 terintegrasi di QUIC,
- connection migration lebih baik untuk mobile network,
- mengurangi transport-level head-of-line blocking antar stream,
- membutuhkan UDP/443 terbuka,
- membutuhkan dukungan client/browser,
- biasanya diiklankan menggunakan `Alt-Svc`.

Mental model:

```text
HTTP/2:
HTTP semantics -> HTTP/2 frames -> TLS -> TCP -> IP

HTTP/3:
HTTP semantics -> HTTP/3 frames -> QUIC + TLS 1.3 -> UDP -> IP
```

Konsekuensi operasional:

- firewall/load balancer harus mengizinkan UDP/443,
- observability TCP klasik tidak cukup,
- packet capture/debugging berbeda,
- beberapa enterprise network bisa memblokir UDP,
- fallback ke HTTP/2/HTTP/1.1 harus tetap sehat.

---

## 5. Konfigurasi HTTP/2 Dasar di Nginx

### 5.1 Minimal HTTPS + HTTP/2

```nginx
server {
    listen 443 ssl;
    http2 on;

    server_name app.example.com;

    ssl_certificate     /etc/nginx/certs/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/app.example.com/privkey.pem;

    location / {
        proxy_pass http://java_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Hal penting:

- HTTP/2 hampir selalu dipakai dengan TLS untuk browser modern.
- `http2 on;` mengaktifkan HTTP/2 pada server tersebut.
- Browser dan Nginx menegosiasikan protokol melalui ALPN saat TLS handshake.
- Jika client tidak mendukung HTTP/2, fallback ke HTTP/1.1.

---

### 5.2 Redirect HTTP ke HTTPS

```nginx
server {
    listen 80;
    server_name app.example.com;

    return 301 https://$host$request_uri;
}
```

Ini tetap HTTP/1.1/HTTP plain di port 80. Tujuannya hanya mengarahkan ke HTTPS.

Jangan taruh logic aplikasi kompleks di server port 80 jika kebijakan production adalah HTTPS-only.

---

### 5.3 Menambahkan protocol ke log

Untuk observability, tambahkan `$server_protocol`:

```nginx
log_format main_ext '$remote_addr - $host "$request" '
                    'status=$status bytes=$body_bytes_sent '
                    'protocol=$server_protocol '
                    'request_time=$request_time '
                    'upstream_addr=$upstream_addr '
                    'upstream_status=$upstream_status '
                    'upstream_response_time=$upstream_response_time';

access_log /var/log/nginx/access.log main_ext;
```

Contoh log bisa menunjukkan:

```text
protocol=HTTP/2.0
protocol=HTTP/1.1
protocol=HTTP/3.0
```

Berguna untuk menjawab:

- apakah client benar-benar pakai HTTP/2?
- apakah HTTP/3 adoption terjadi?
- apakah error tertentu hanya terjadi pada protokol tertentu?

---

## 6. ALPN: Bagaimana Client dan Nginx Memilih HTTP/2

ALPN adalah ekstensi TLS yang memungkinkan client dan server memilih protokol aplikasi saat TLS handshake.

Contoh negosiasi konseptual:

```text
Client: saya mendukung h2 dan http/1.1
Server: saya pilih h2
```

Atau:

```text
Client: saya hanya mendukung http/1.1
Server: kita pakai http/1.1
```

Nginx tidak “memaksa” semua client menjadi HTTP/2. Nginx menawarkan, client memilih/menegosiasikan.

Debug dengan curl:

```bash
curl -I --http2 https://app.example.com
```

Lihat output verbose:

```bash
curl -v --http2 https://app.example.com
```

Cari indikasi seperti:

```text
ALPN: server accepted h2
using HTTP/2
```

Dengan OpenSSL:

```bash
openssl s_client -connect app.example.com:443 -servername app.example.com -alpn h2
```

Cari:

```text
ALPN protocol: h2
```

Jika tidak muncul, kemungkinan:

- Nginx tidak build dengan HTTP/2 module,
- `http2 on;` belum aktif,
- TLS/server block salah,
- SNI salah,
- ada proxy/CDN di depan,
- client/tool tidak mendukung HTTP/2.

---

## 7. Client-Facing HTTP/2 vs Upstream-Facing HTTP/1.1

Konfigurasi umum:

```nginx
upstream java_app {
    server 127.0.0.1:8080;
    keepalive 64;
}

server {
    listen 443 ssl;
    http2 on;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api/privkey.pem;

    location / {
        proxy_pass http://java_app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Artinya:

```text
Client -> Nginx: HTTP/2 over TLS
Nginx -> Java: HTTP/1.1 over TCP
```

Ini valid dan umum.

Keuntungannya:

- browser mendapat manfaat HTTP/2,
- backend Java tetap sederhana,
- tidak perlu membuat Tomcat/Spring Boot menerima HTTP/2 langsung,
- TLS certificate dikelola di Nginx,
- upstream keepalive tetap bisa efisien.

Konsekuensinya:

- aplikasi Java tidak melihat HTTP/2 stream secara native,
- gRPC tidak bisa diperlakukan seperti REST biasa dengan `proxy_pass`,
- beberapa fitur streaming butuh konfigurasi khusus,
- observability harus eksplisit.

---

## 8. HTTP/2 untuk Static Asset Delivery

HTTP/2 sering bermanfaat untuk static assets karena satu page modern bisa memuat banyak resource:

- JS chunks,
- CSS,
- images,
- fonts,
- source maps,
- icons,
- JSON config.

Dengan HTTP/1.1, browser membuka beberapa koneksi paralel. Dengan HTTP/2, banyak resource bisa multiplex di satu koneksi.

Contoh server static SPA:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name www.example.com;

    ssl_certificate     /etc/nginx/certs/www/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/www/privkey.pem;

    root /var/www/app;
    index index.html;

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

Perhatikan: HTTP/2 tidak menggantikan cache policy. Asset hashed tetap perlu cache header yang benar.

HTTP/2 membantu transport, sedangkan cache header membantu menghindari request sama sekali.

Urutan optimasi yang sehat:

```text
1. Correct caching
2. Compression
3. CDN/edge strategy
4. HTTP/2 or HTTP/3
5. Asset bundling/splitting strategy
```

Jangan berharap HTTP/2 memperbaiki asset strategy yang buruk.

---

## 9. HTTP/2 dan REST API

Untuk REST API, manfaat HTTP/2 tergantung pola traffic.

Bermanfaat jika:

- client membuat banyak request kecil ke origin yang sama,
- mobile latency tinggi,
- koneksi sering reuse,
- header overhead signifikan,
- client melakukan request paralel.

Kurang terasa jika:

- API call sedikit dan besar,
- bottleneck utama database,
- response computation berat,
- client tidak reuse connection,
- Nginx/backend timeout buruk,
- service-to-service sudah berada di network lokal cepat.

Contoh:

```text
Case A:
Page load membuat 40 request kecil ke /api dan /assets.
HTTP/2 bisa membantu.

Case B:
Satu request /report membutuhkan query database 5 detik.
HTTP/2 hampir tidak menyelesaikan masalah utama.
```

Untuk engineer backend, ini penting: jangan menjual HTTP/2 sebagai solusi untuk slow business transaction.

---

## 10. gRPC dan Nginx

### 10.1 gRPC bukan REST biasa

gRPC menggunakan HTTP/2 sebagai transport utama.

Karena itu, konfigurasi REST reverse proxy biasa tidak cukup:

```nginx
# Ini untuk HTTP API biasa, bukan konfigurasi utama gRPC:
proxy_pass http://backend;
```

Untuk gRPC, gunakan `grpc_pass`:

```nginx
upstream grpc_backend {
    server 127.0.0.1:9090;
}

server {
    listen 443 ssl;
    http2 on;
    server_name grpc.example.com;

    ssl_certificate     /etc/nginx/certs/grpc/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/grpc/privkey.pem;

    location / {
        grpc_pass grpc://grpc_backend;
        grpc_set_header Host $host;
        grpc_set_header X-Real-IP $remote_addr;
        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        grpc_set_header X-Forwarded-Proto $scheme;
    }
}
```

Jika backend gRPC memakai TLS:

```nginx
grpc_pass grpcs://grpc_backend;
```

---

### 10.2 gRPC failure handling

gRPC client mengharapkan status gRPC, bukan hanya HTTP status.

Jika upstream down dan Nginx mengembalikan HTTP 502 biasa, client bisa menerima error yang kurang idiomatis.

Pola yang sering dipakai:

```nginx
location / {
    grpc_pass grpc://grpc_backend;
    error_page 502 = /grpc_unavailable;
}

location = /grpc_unavailable {
    internal;
    default_type application/grpc;
    add_header grpc-status 14;
    add_header grpc-message "unavailable";
    return 204;
}
```

`grpc-status: 14` berarti `UNAVAILABLE`.

Ini lebih cocok untuk client gRPC yang punya retry policy berdasarkan status gRPC.

---

### 10.3 REST dan gRPC pada domain yang sama

Bisa, tapi harus hati-hati.

Contoh konseptual:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api/privkey.pem;

    location /grpc.mycompany.orders.OrderService/ {
        grpc_pass grpc://order_grpc_backend;
    }

    location /api/ {
        proxy_pass http://rest_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

Masalah umum:

- salah location sehingga request gRPC masuk ke REST backend,
- REST endpoint menerima HTTP/2 client traffic tetapi diteruskan sebagai HTTP/1.1, yang sebenarnya normal,
- gRPC client gagal karena server block tidak `http2 on;`,
- load balancer/CDN di depan tidak mendukung gRPC end-to-end,
- timeout terlalu pendek untuk streaming gRPC.

---

## 11. HTTP/2 dan WebSocket/SSE

### 11.1 WebSocket

WebSocket historis menggunakan HTTP/1.1 Upgrade.

Konfigurasi umum:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    http2 on;
    server_name app.example.com;

    location /ws/ {
        proxy_pass http://java_ws_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
    }
}
```

Walaupun server block mengaktifkan HTTP/2 untuk client umum, WebSocket proxying ke backend biasanya tetap menggunakan HTTP/1.1 semantics.

Jangan anggap WebSocket otomatis menjadi HTTP/2 stream.

---

### 11.2 SSE

Server-Sent Events adalah response streaming.

Masalah umum dengan Nginx:

- response dibuffer,
- event tidak sampai real-time,
- timeout memutus koneksi,
- client reconnect terlalu sering.

Konfigurasi dasar:

```nginx
location /events/ {
    proxy_pass http://java_sse_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

HTTP/2 bisa membawa SSE ke client, tetapi poin pentingnya tetap:

- buffering harus sesuai,
- timeout harus sesuai,
- backend harus benar-benar flush event.

---

## 12. HTTP/3/QUIC di Nginx

### 12.1 Konsep dasar

HTTP/3 membutuhkan QUIC, dan QUIC memakai UDP.

Artinya server perlu listen UDP/443 selain TCP/443.

Konfigurasi konseptual:

```nginx
server {
    listen 443 ssl;
    listen 443 quic reuseport;

    http2 on;
    http3 on;

    server_name app.example.com;

    ssl_certificate     /etc/nginx/certs/app/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/app/privkey.pem;

    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    location / {
        proxy_pass http://java_app;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Catatan:

- Pastikan build Nginx mendukung HTTP/3/QUIC.
- Pastikan UDP/443 terbuka di firewall/security group/load balancer.
- Pastikan TLS/certificate valid.
- Pastikan fallback TCP/443 tetap berjalan.

---

### 12.2 Alt-Svc

Browser biasanya menemukan HTTP/3 melalui header `Alt-Svc`.

Contoh:

```nginx
add_header Alt-Svc 'h3=":443"; ma=86400' always;
```

Maknanya secara sederhana:

```text
Untuk origin ini, client boleh mencoba HTTP/3 di port 443 selama periode tertentu.
```

Flow umum:

```text
1. Browser mengakses https://app.example.com via HTTP/2 atau HTTP/1.1.
2. Nginx mengirim Alt-Svc: h3=":443".
3. Browser mencatat bahwa HTTP/3 tersedia.
4. Request berikutnya bisa mencoba QUIC/HTTP3 via UDP/443.
5. Jika gagal, browser fallback ke HTTP/2/HTTP/1.1.
```

Karena itu, saat testing HTTP/3, jangan bingung jika request pertama belum memakai HTTP/3.

---

### 12.3 HTTP/3 tidak selalu aktif walaupun config benar

Kemungkinan penyebab:

- client/browser tidak mendukung HTTP/3,
- HTTP/3 dimatikan di browser,
- UDP/443 diblokir firewall,
- cloud load balancer tidak meneruskan UDP,
- container ingress tidak expose UDP,
- Nginx tidak dibuild dengan HTTP/3,
- server block yang kena bukan yang kamu konfigurasi,
- `Alt-Svc` tidak terkirim,
- ada CDN/proxy di depan yang men-terminate traffic.

Debugging harus mencakup network path, bukan hanya `nginx.conf`.

---

## 13. Diagram Protocol Boundary

### 13.1 Browser HTTP/2 ke backend HTTP/1.1

```text
+---------+         TLS + HTTP/2          +-------+        HTTP/1.1        +-------------+
| Browser | ---------------------------> | Nginx | ---------------------> | Spring Boot |
+---------+                              +-------+                        +-------------+

Nginx terminates TLS and HTTP/2.
Backend sees proxied HTTP/1.1 request.
```

Use case:

- common web app,
- REST API,
- SPA + API,
- backend not gRPC.

---

### 13.2 Browser HTTP/3 ke backend HTTP/1.1

```text
+---------+       QUIC/UDP + HTTP/3       +-------+        HTTP/1.1        +-------------+
| Browser | ---------------------------> | Nginx | ---------------------> | Spring Boot |
+---------+                              +-------+                        +-------------+

HTTP/3 exists only on client-facing edge.
Internal backend can stay HTTP/1.1.
```

Use case:

- public web traffic,
- mobile clients,
- gradual HTTP/3 adoption.

---

### 13.3 gRPC client to Java gRPC backend

```text
+-------------+       TLS + HTTP/2        +-------+       HTTP/2/gRPC       +------------------+
| gRPC Client | -----------------------> | Nginx | ---------------------> | Java gRPC Server |
+-------------+                          +-------+                        +------------------+

Use grpc_pass, not normal proxy_pass.
```

Use case:

- external gRPC API,
- internal gRPC gateway,
- polyglot service interface.

---

## 14. Decision Matrix

| Scenario | Client -> Nginx | Nginx -> Upstream | Recommended Nginx Feature |
|---|---:|---:|---|
| Public website / SPA | HTTP/2 or HTTP/3 | HTTP/1.1 | `http2 on`, optional `http3 on`, static caching |
| REST API for browser/mobile | HTTP/2 | HTTP/1.1 | `proxy_pass`, upstream keepalive |
| REST API with heavy DB latency | HTTP/2 optional | HTTP/1.1 | Focus on app/db latency first |
| External gRPC API | HTTP/2 | HTTP/2/gRPC | `grpc_pass`, `http2 on` |
| WebSocket | Usually HTTP/1.1 upgrade | HTTP/1.1 upgrade | `Upgrade`, `Connection`, long timeout |
| SSE | HTTP/1.1 or HTTP/2 | HTTP/1.1 | `proxy_buffering off`, long timeout |
| Mobile unstable network | HTTP/3 can help | HTTP/1.1 or gRPC | HTTP/3 trial with fallback |
| Internal service-to-service | Depends | Depends | Often service mesh/gRPC/Envoy may be better |

---

## 15. Performance Trade-Offs

### 15.1 HTTP/2 benefits

Potential benefits:

- fewer TCP connections,
- better multiplexing,
- header compression,
- better page load for many assets,
- required for gRPC.

Costs/risks:

- harder debugging than plain HTTP/1.1,
- multiplexing can hide per-request bottlenecks,
- one TCP connection can become shared fate under packet loss,
- some old clients/proxies have compatibility issues,
- not all Nginx modules/features behave identically across protocols.

---

### 15.2 HTTP/3 benefits

Potential benefits:

- avoids TCP transport-level head-of-line blocking between QUIC streams,
- faster connection establishment in some cases,
- better behavior during network migration,
- useful for mobile/flaky networks,
- modern browser support.

Costs/risks:

- UDP/443 must be allowed,
- observability and packet debugging more complex,
- enterprise networks may block UDP,
- more moving parts,
- not always faster,
- adoption/benefit depends heavily on client and network.

---

### 15.3 Backend bottleneck still dominates

Suppose request lifecycle:

```text
TLS/protocol overhead: 10 ms
Nginx proxying:        2 ms
Java app processing:   80 ms
Database query:        900 ms
Response transfer:     20 ms
```

Total around 1012 ms.

Even if HTTP/2 or HTTP/3 saves 10–20 ms, user still waits around one second.

Protocol optimization matters, but only after you understand the critical path.

---

## 16. Observability Strategy

### 16.1 Log protocol

```nginx
log_format protocol_json escape=json
'{'
  '"time":"$time_iso8601",'
  '"remote_addr":"$remote_addr",'
  '"host":"$host",'
  '"request":"$request",'
  '"status":$status,'
  '"protocol":"$server_protocol",'
  '"request_time":$request_time,'
  '"upstream_addr":"$upstream_addr",'
  '"upstream_status":"$upstream_status",'
  '"upstream_response_time":"$upstream_response_time"'
'}';

access_log /var/log/nginx/access.json protocol_json;
```

Pertanyaan yang bisa dijawab:

- Berapa persen request memakai HTTP/2?
- Apakah HTTP/3 sudah dipakai?
- Apakah 499 lebih sering di HTTP/3?
- Apakah latency p95 berbeda antara HTTP/1.1 dan HTTP/2?
- Apakah upstream latency berubah? Jika tidak, bottleneck bukan protokol client-facing.

---

### 16.2 Tambahkan header diagnostik secara terbatas

Untuk staging:

```nginx
add_header X-Debug-Protocol $server_protocol always;
```

Jangan sembarangan expose terlalu banyak detail di production public endpoint. Untuk debugging internal, header seperti ini berguna.

---

### 16.3 Correlate dengan Java logs

Nginx log:

```text
request_id=abc protocol=HTTP/2.0 request_time=0.432 upstream_response_time=0.410
```

Java log:

```text
traceId=abc handler=CreateOrder durationMs=397 dbMs=310
```

Dari sini kamu tahu:

```text
Total Nginx time ≈ 432 ms
Java app time ≈ 397 ms
DB time ≈ 310 ms
Protocol overhead bukan masalah utama.
```

---

## 17. Debugging Playbook

### 17.1 Apakah HTTP/2 aktif?

```bash
curl -I --http2 https://app.example.com
curl -v --http2 https://app.example.com
```

Cari:

```text
using HTTP/2
ALPN: server accepted h2
```

Jika tidak aktif:

1. Jalankan `nginx -T` dan cari server block yang benar.
2. Pastikan `listen 443 ssl;` dan `http2 on;` ada.
3. Pastikan request memakai SNI yang benar.
4. Pastikan certificate valid.
5. Pastikan tidak ada CDN/load balancer yang mengubah perilaku.

---

### 17.2 Apakah HTTP/3 aktif?

Gunakan curl yang mendukung HTTP/3:

```bash
curl -I --http3 https://app.example.com
```

Atau cek header:

```bash
curl -I https://app.example.com | grep -i alt-svc
```

Checklist:

1. Nginx build mendukung HTTP/3.
2. `listen 443 quic reuseport;` ada.
3. `http3 on;` ada.
4. `Alt-Svc` terkirim.
5. UDP/443 terbuka dari internet ke Nginx.
6. Tidak ada load balancer TCP-only yang menghalangi UDP.
7. Browser/client mendukung HTTP/3.

---

### 17.3 gRPC gagal lewat Nginx

Gejala:

- `UNAVAILABLE`,
- HTTP 502,
- connection closed,
- protocol error,
- request masuk ke REST backend,
- TLS handshake error.

Checklist:

1. Client-facing server block memakai `http2 on;`.
2. Location gRPC benar.
3. Gunakan `grpc_pass`, bukan `proxy_pass`.
4. Upstream benar-benar gRPC server.
5. Jika upstream TLS, gunakan `grpcs://`.
6. Timeout cukup untuk streaming.
7. Error mapping sesuai status gRPC.
8. Load balancer/CDN di depan mendukung gRPC.

---

### 17.4 HTTP/2 aktif tapi tidak lebih cepat

Jangan langsung menyimpulkan HTTP/2 gagal.

Periksa:

- cache headers,
- compression,
- number of requests,
- payload size,
- upstream response time,
- database time,
- TLS reuse,
- CDN behavior,
- network condition,
- browser waterfall,
- Nginx buffering,
- backend thread pool saturation.

HTTP/2 bukan pengganti profiling.

---

## 18. Common Misconceptions

### Misconception 1: “HTTP/2 membuat semua request paralel di backend.”

Tidak otomatis. HTTP/2 multiplexing terjadi pada koneksi client ke Nginx. Nginx tetap meneruskan ke upstream sesuai konfigurasi upstream connection/proxy.

---

### Misconception 2: “Kalau browser pakai HTTP/3, Spring Boot juga menerima HTTP/3.”

Tidak. Nginx biasanya men-terminate HTTP/3 lalu meneruskan request sebagai HTTP/1.1 ke backend.

---

### Misconception 3: “HTTP/3 pasti lebih cepat daripada HTTP/2.”

Tidak selalu. HTTP/3 bisa lebih baik pada kondisi tertentu, terutama network mobile/flaky/high latency, tetapi bisa juga netral atau bahkan lebih rumit secara operasional.

---

### Misconception 4: “gRPC bisa diproxy seperti REST.”

Tidak tepat. gRPC butuh handling khusus dengan `grpc_pass` dan HTTP/2.

---

### Misconception 5: “Enable HTTP/2 cukup untuk semua streaming use case.”

Tidak. SSE, WebSocket, and gRPC punya mekanisme dan konfigurasi berbeda.

---

## 19. Java Backend Implications

### 19.1 Spring Boot REST API

Untuk REST API biasa:

```text
Browser/mobile -> Nginx HTTP/2
Nginx -> Spring Boot HTTP/1.1
```

Biasanya cukup.

Yang perlu benar:

- forwarded headers,
- scheme awareness,
- upstream keepalive,
- timeout,
- body size,
- buffering,
- request ID propagation.

HTTP/2 di edge tidak memerlukan Spring Boot HTTP/2 aktif.

---

### 19.2 Java gRPC

Untuk Java gRPC:

```text
gRPC client -> Nginx HTTP/2/gRPC
Nginx -> Java gRPC HTTP/2/gRPC
```

Yang perlu benar:

- `grpc_pass`,
- `http2 on`,
- gRPC status mapping,
- deadline propagation,
- streaming timeout,
- max message size,
- TLS/mTLS policy,
- health check strategy.

---

### 19.3 Reactive Java / Netty / WebFlux

HTTP/2 di client-facing Nginx tidak otomatis membuat WebFlux menerima HTTP/2 stream. Jika Nginx meneruskan HTTP/1.1, WebFlux tetap melihat HTTP/1.1 request.

Tetapi reactive backend tetap bisa bermanfaat untuk:

- high concurrency,
- non-blocking IO,
- SSE,
- streaming,
- long polling,
- backpressure-aware app design.

Jangan mencampuradukkan:

```text
HTTP/2 multiplexing at edge
```

Dengan:

```text
Reactive non-blocking execution inside application
```

Keduanya berbeda.

---

## 20. Production Config Examples

### 20.1 SPA + REST API with HTTP/2

```nginx
upstream api_backend {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    keepalive 64;
}

server {
    listen 80;
    server_name app.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name app.example.com;

    ssl_certificate     /etc/nginx/certs/app/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/app/privkey.pem;

    root /var/www/app;
    index index.html;

    access_log /var/log/nginx/app.access.log main_ext;
    error_log  /var/log/nginx/app.error.log warn;

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /api/ {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Protocol $server_protocol;

        proxy_connect_timeout 2s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
}
```

---

### 20.2 HTTP/2 + HTTP/3 edge, HTTP/1.1 upstream

```nginx
upstream api_backend {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    keepalive 64;
}

server {
    listen 443 ssl;
    listen 443 quic reuseport;

    http2 on;
    http3 on;

    server_name api.example.com;

    ssl_certificate     /etc/nginx/certs/api/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/api/privkey.pem;

    add_header Alt-Svc 'h3=":443"; ma=86400' always;

    location / {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Protocol $server_protocol;
    }
}
```

Operational note:

```text
Opening TCP/443 is not enough.
HTTP/3 requires UDP/443.
```

---

### 20.3 gRPC service behind Nginx

```nginx
upstream order_grpc {
    server 10.0.2.10:9090;
    server 10.0.2.11:9090;
}

server {
    listen 443 ssl;
    http2 on;
    server_name grpc.example.com;

    ssl_certificate     /etc/nginx/certs/grpc/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/grpc/privkey.pem;

    location / {
        grpc_pass grpc://order_grpc;
        grpc_set_header Host $host;
        grpc_set_header X-Real-IP $remote_addr;
        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        grpc_set_header X-Forwarded-Proto $scheme;

        grpc_connect_timeout 2s;
        grpc_send_timeout 60s;
        grpc_read_timeout 60s;

        error_page 502 = /grpc_unavailable;
    }

    location = /grpc_unavailable {
        internal;
        default_type application/grpc;
        add_header grpc-status 14;
        add_header grpc-message "unavailable";
        return 204;
    }
}
```

---

## 21. Failure Mode Catalog

### 21.1 Browser stays on HTTP/1.1

Possible causes:

- HTTP/2 not enabled,
- ALPN not negotiated,
- TLS issue,
- old client,
- wrong server block,
- CDN/proxy behavior.

Response:

- verify with `curl -v --http2`,
- inspect `nginx -T`,
- check access log `$server_protocol`.

---

### 21.2 HTTP/3 configured but no traffic uses it

Possible causes:

- UDP/443 blocked,
- no `Alt-Svc`,
- unsupported Nginx build,
- unsupported client,
- intermediate load balancer drops UDP,
- testing only first request.

Response:

- test UDP path,
- inspect browser net internals/devtools,
- use `curl --http3`,
- check server logs.

---

### 21.3 gRPC returns 502

Possible causes:

- backend down,
- wrong `grpc_pass`,
- protocol mismatch,
- TLS mismatch,
- route mismatch,
- timeout,
- upstream does not speak gRPC.

Response:

- test backend directly,
- confirm HTTP/2 server block,
- check Nginx error log,
- add proper gRPC error mapping.

---

### 21.4 HTTP/2 causes high memory/connection pressure

Possible causes:

- too many concurrent streams,
- long-lived requests,
- slow clients,
- large responses,
- buffering/memory pressure,
- insufficient worker/file descriptor settings.

Response:

- inspect connection metrics,
- tune timeouts,
- review buffering,
- check worker limits,
- capacity test with realistic concurrency.

---

### 21.5 Misleading benchmark

Possible causes:

- benchmark tool not actually using HTTP/2/HTTP/3,
- no TLS reuse,
- unrealistic payload,
- local network only,
- no browser-like concurrency,
- backend bottleneck ignored,
- cache warming ignored,
- coordinated omission.

Response:

- log `$server_protocol`,
- use browser waterfall,
- compare p95/p99,
- isolate static vs API,
- benchmark end-to-end and component-level.

---

## 22. Design Heuristics

### 22.1 Default public web app

Use:

```text
Client -> Nginx: HTTP/2 over TLS
Nginx -> Java: HTTP/1.1 with keepalive
```

Add HTTP/3 only after:

- HTTP/2 is stable,
- observability exists,
- UDP path is supported,
- fallback works,
- you can measure adoption.

---

### 22.2 Default internal REST service

Do not blindly add HTTP/2.

Ask:

- Is there a real latency/concurrency problem?
- Is the service behind service mesh already?
- Is the client connection reused?
- Is payload/request pattern suitable?
- Is the operational complexity justified?

Often, good HTTP/1.1 keepalive and sane timeout are enough.

---

### 22.3 gRPC service

Use HTTP/2 by design.

Prefer:

```text
gRPC client -> Nginx: HTTP/2
Nginx -> backend: gRPC via grpc_pass
```

But validate:

- deadline behavior,
- retry behavior,
- streaming behavior,
- load balancing behavior,
- observability.

---

### 22.4 HTTP/3 adoption

Treat HTTP/3 as progressive enhancement.

Rules:

1. Never break HTTP/2 fallback.
2. Never rely on HTTP/3 for correctness.
3. Measure adoption by protocol logs.
4. Validate UDP path from real user networks.
5. Roll out gradually.
6. Keep incident rollback simple.

---

## 23. Checklist Production Readiness

### HTTP/2 Checklist

- [ ] Nginx build supports HTTP/2.
- [ ] `listen 443 ssl;` configured.
- [ ] `http2 on;` configured.
- [ ] TLS certificate valid.
- [ ] ALPN verified.
- [ ] Access log includes `$server_protocol`.
- [ ] REST upstream keepalive configured if needed.
- [ ] gRPC uses `grpc_pass`, not `proxy_pass`.
- [ ] Timeout and buffering reviewed.
- [ ] Browser/client compatibility verified.

### HTTP/3 Checklist

- [ ] Nginx build supports HTTP/3/QUIC.
- [ ] `listen 443 quic reuseport;` configured.
- [ ] `http3 on;` configured.
- [ ] UDP/443 open end-to-end.
- [ ] `Alt-Svc` header configured.
- [ ] HTTP/2 fallback remains active.
- [ ] Real client test performed.
- [ ] Logs differentiate HTTP/1.1, HTTP/2, HTTP/3.
- [ ] Rollback plan exists.

### gRPC Checklist

- [ ] Client-facing HTTP/2 enabled.
- [ ] `grpc_pass` used.
- [ ] Upstream protocol `grpc://` or `grpcs://` correct.
- [ ] Timeouts appropriate for unary/streaming calls.
- [ ] Error mapping returns gRPC status.
- [ ] Load balancing behavior understood.
- [ ] Deadline/retry semantics tested.
- [ ] Logs and tracing correlated.

---

## 24. Practice Scenarios

### Scenario 1 — HTTP/2 enabled but browser uses HTTP/1.1

You see:

```text
protocol=HTTP/1.1
```

Even after adding:

```nginx
http2 on;
```

Investigate:

1. Is request hitting the intended server block?
2. Is TLS enabled on that block?
3. Does `curl -v --http2` show ALPN?
4. Is a CDN terminating TLS before Nginx?
5. Does the Nginx binary include HTTP/2 support?

---

### Scenario 2 — gRPC client gets HTTP 502

Likely mistakes:

```nginx
location / {
    proxy_pass http://grpc_backend;
}
```

Correct direction:

```nginx
location / {
    grpc_pass grpc://grpc_backend;
}
```

Then verify backend gRPC port and TLS/plaintext expectation.

---

### Scenario 3 — HTTP/3 works locally but not from office network

Likely cause:

```text
UDP/443 blocked by corporate network or intermediate firewall.
```

Design conclusion:

```text
HTTP/3 must be optional. HTTP/2 fallback must remain correct.
```

---

### Scenario 4 — SSE endpoint delays messages

HTTP/2 is not the main issue. Check buffering:

```nginx
proxy_buffering off;
proxy_read_timeout 1h;
```

Also check Java backend flush behavior.

---

## 25. Key Takeaways

1. Nginx is a protocol boundary. Always separate `client -> Nginx` from `Nginx -> upstream`.
2. HTTP/2 at the edge does not imply HTTP/2 at the Java backend.
3. HTTP/2 is valuable for multiplexing, header compression, and gRPC, but it does not fix slow application logic.
4. HTTP/3 is QUIC over UDP, not HTTP/2 over a newer TCP.
5. HTTP/3 requires UDP/443 and must be treated as progressive enhancement with fallback.
6. gRPC requires `grpc_pass` and HTTP/2-aware configuration.
7. WebSocket, SSE, and gRPC are different long-lived/streaming models; do not configure them as if they were identical.
8. Observability must include protocol visibility, otherwise you cannot know what clients are actually using.
9. Performance decisions must be measured with realistic traffic, not assumed from protocol marketing.
10. The best production default for many Java REST systems is: HTTP/2 at Nginx edge, HTTP/1.1 keepalive to backend.

---

## 26. Bridge to Part 014

Part ini membahas protokol transport/application framing di Nginx boundary.

Part berikutnya akan membahas:

```text
Part 014 — Compression, Decompression, and Content Transformation
```

Kita akan masuk ke gzip, Brotli consideration, static compressed assets, CPU vs bandwidth trade-off, MIME targeting, double compression, compression and caching, serta hubungan antara compression di Nginx dan compression di Java backend.

---

## Status Seri

```text
Selesai:
- Part 000 — Orientation
- Part 001 — Nginx Architecture
- Part 002 — Installation, Packaging, Runtime Layout
- Part 003 — Configuration Grammar
- Part 004 — Server Selection
- Part 005 — Location Matching
- Part 006 — Static File Serving
- Part 007 — Reverse Proxy Fundamentals
- Part 008 — Proxy Header Contract
- Part 009 — Upstream Blocks and Load Balancing
- Part 010 — Timeouts, Retries, Buffering, and Backpressure
- Part 011 — Connection Management and Performance Tuning
- Part 012 — TLS Termination
- Part 013 — HTTP/2, HTTP/3/QUIC, and Protocol-Level Trade-Offs

Belum selesai:
- Part 014 sampai Part 030
```

Seri belum selesai. Bagian terakhir adalah **Part 030 — Capstone: Designing a Production-Grade Nginx Front Door for Java Microservices**.
