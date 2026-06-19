# learn-nginx-mastery-for-java-engineers-part-030.md

# Part 030 — Capstone: Designing a Production-Grade Nginx Front Door for Java Microservices

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `030 / 030`  
> Status: **bagian terakhir / final capstone**

---

## 0. Tujuan Bagian Ini

Bagian ini adalah penutup seluruh seri. Setelah mempelajari Nginx dari arsitektur proses, konfigurasi, reverse proxy, TLS, cache, rate limiting, observability, container, Kubernetes, failure modeling, sampai benchmarking, sekarang kita akan menyatukan semuanya ke dalam satu desain nyata:

> **Nginx sebagai production-grade front door untuk Java microservices.**

Targetnya bukan sekadar menghasilkan konfigurasi yang “jalan”. Targetnya adalah menghasilkan konfigurasi dan model operasi yang:

1. **jelas boundary-nya**,  
2. **aman secara default**,  
3. **mudah di-debug**,  
4. **punya failure behavior yang bisa diprediksi**,  
5. **mendukung deployment bertahap**,  
6. **selaras dengan runtime Java**,  
7. **tidak menyembunyikan bottleneck**,  
8. **bisa direview seperti production code**.

Di level top engineer, Nginx tidak dipandang sebagai file konfigurasi acak di `/etc/nginx`. Ia adalah bagian dari **traffic control plane** sistem.

---

## 1. Problem Statement

Kita akan desain front door untuk sistem berikut:

```text
Internet / Browser / Mobile App
        |
        v
+------------------------------+
|           Nginx              |
| - HTTPS termination          |
| - static SPA serving         |
| - reverse proxy API          |
| - WebSocket routing          |
| - rate limiting              |
| - reverse proxy cache        |
| - security headers           |
| - access/error logging       |
+------------------------------+
        |
        +---------------------> frontend static files
        |
        +---------------------> Java API service cluster
        |
        +---------------------> Java WebSocket service cluster
        |
        +---------------------> internal admin/actuator, restricted
```

Kita asumsikan domain production:

```text
www.example.com
api.example.com
admin.example.com
```

Backend Java:

```text
api-v1 service:
  10.10.10.11:8080
  10.10.10.12:8080
  10.10.10.13:8080

api-v2 canary service:
  10.10.20.11:8080

websocket service:
  10.10.30.11:8090
  10.10.30.12:8090

admin service:
  10.10.40.11:8081
```

Frontend SPA assets:

```text
/var/www/example-spa/current
```

TLS certificate:

```text
/etc/nginx/tls/example/fullchain.pem
/etc/nginx/tls/example/privkey.pem
```

Log location:

```text
/var/log/nginx/access.json.log
/var/log/nginx/error.log
```

Cache directory:

```text
/var/cache/nginx/api_cache
```

---

## 2. Capstone Architecture Mental Model

Sebelum menulis config, kita perlu menentukan mental model.

Nginx di desain ini bertindak sebagai:

```text
edge boundary + protocol normalizer + traffic router + resilience buffer
```

Artinya:

1. **Edge boundary**  
   Nginx adalah titik pertama yang menerima koneksi external. Ia harus skeptis terhadap input client.

2. **Protocol normalizer**  
   Nginx mengubah HTTPS browser-facing menjadi HTTP atau HTTPS upstream-facing sesuai desain internal.

3. **Traffic router**  
   Nginx memutuskan request masuk ke static asset, API, WebSocket, admin, atau ditolak.

4. **Resilience buffer**  
   Nginx dapat membatasi request, melakukan buffering, melayani stale cache, dan memutus koneksi buruk sebelum merusak backend.

5. **Observability boundary**  
   Nginx mencatat apa yang terjadi di depan aplikasi: status client-facing, upstream status, latency, retry, dan request ID.

6. **Security choke point**  
   Nginx menerapkan request size limit, header policy, TLS policy, host validation, dan endpoint restriction.

Tetapi Nginx **bukan**:

- business authorization engine,
- full API management platform,
- distributed tracing system,
- queue,
- service discovery platform penuh,
- pengganti desain resilience di aplikasi,
- pengganti WAF khusus untuk threat yang kompleks,
- tempat menaruh semua logic domain.

Jika Nginx mulai berisi terlalu banyak aturan bisnis, sistem akan berubah menjadi sulit dipahami dan sulit dites.

---

## 3. Design Requirements

Kita definisikan requirement eksplisit.

### 3.1 Functional Requirements

Nginx harus mampu:

1. redirect HTTP ke HTTPS,
2. melayani SPA static assets,
3. fallback SPA route ke `index.html`,
4. proxy `/api/` ke Java API service,
5. mendukung canary routing sebagian kecil traffic ke API v2,
6. proxy `/ws/` ke WebSocket service,
7. membatasi request body size,
8. membatasi rate request endpoint sensitif,
9. cache response API yang aman untuk dicache,
10. meneruskan proxy headers yang konsisten,
11. menghasilkan JSON access log,
12. melindungi endpoint admin/internal,
13. menyediakan error page yang tidak membocorkan detail internal.

### 3.2 Non-Functional Requirements

Nginx harus:

1. bisa reload tanpa memutus koneksi aktif secara brutal,
2. konfigurasi dapat dites dengan `nginx -t`,
3. log cukup kaya untuk debugging p95/p99,
4. timeout tidak menciptakan retry storm,
5. punya limit untuk mencegah resource exhaustion,
6. aman terhadap host header spoofing,
7. tidak cache response user-specific,
8. tidak menerima domain asing secara diam-diam,
9. punya struktur config yang maintainable,
10. bisa dioperasikan oleh tim saat incident.

---

## 4. Directory Layout yang Disarankan

Untuk production, gunakan struktur yang eksplisit:

```text
/etc/nginx/
  nginx.conf
  conf.d/
    00-log-format.conf
    10-maps.conf
    20-upstreams.conf
    30-cache.conf
    40-rate-limit.conf
    50-security-snippets.conf
    sites/
      www.example.com.conf
      api.example.com.conf
      admin.example.com.conf
  snippets/
    proxy-headers.conf
    security-headers.conf
    tls-common.conf
    error-pages.conf
    websocket-proxy.conf
```

Prinsipnya:

- `nginx.conf` hanya kerangka global.
- `conf.d/00-*` berisi definisi reusable.
- `upstream` diletakkan terpusat.
- `map` diletakkan sebelum digunakan.
- `server` block dipisah per domain.
- snippet dipakai untuk pola berulang, bukan untuk menyembunyikan logic kritikal.

---

## 5. Base `nginx.conf`

Contoh:

```nginx
user nginx;
worker_processes auto;
worker_rlimit_nofile 200000;

pid /run/nginx.pid;

events {
    worker_connections 8192;
    multi_accept on;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    server_tokens off;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;

    keepalive_timeout 65s;
    keepalive_requests 1000;

    client_body_timeout 15s;
    client_header_timeout 15s;
    send_timeout 30s;

    client_max_body_size 10m;
    client_body_buffer_size 128k;

    large_client_header_buffers 4 16k;

    reset_timedout_connection on;

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/conf.d/sites/*.conf;
}
```

### Penjelasan Desain

`worker_processes auto` mengikuti jumlah CPU core. Ini biasanya default yang masuk akal untuk production.

`worker_connections 8192` bukan berarti otomatis bisa melayani 8192 user saja. Koneksi client, upstream connection, keepalive, dan file descriptor semua ikut menghitung kapasitas nyata.

`server_tokens off` mengurangi informasi versi yang diekspos.

`client_max_body_size 10m` adalah limit global. Endpoint upload dapat override lebih besar di location khusus.

`large_client_header_buffers` melindungi dari header terlalu besar, tetapi harus cukup untuk cookie/token normal.

`reset_timedout_connection on` membantu membebaskan resource dari koneksi yang timeout.

---

## 6. JSON Log Format

File:

```text
/etc/nginx/conf.d/00-log-format.conf
```

```nginx
log_format main_json escape=json
'{'
  '"time":"$time_iso8601",'
  '"remote_addr":"$remote_addr",'
  '"realip_remote_addr":"$realip_remote_addr",'
  '"request_id":"$request_id",'
  '"host":"$host",'
  '"server_name":"$server_name",'
  '"method":"$request_method",'
  '"uri":"$uri",'
  '"request_uri":"$request_uri",'
  '"status":$status,'
  '"body_bytes_sent":$body_bytes_sent,'
  '"request_time":$request_time,'
  '"upstream_addr":"$upstream_addr",'
  '"upstream_status":"$upstream_status",'
  '"upstream_connect_time":"$upstream_connect_time",'
  '"upstream_header_time":"$upstream_header_time",'
  '"upstream_response_time":"$upstream_response_time",'
  '"http_referer":"$http_referer",'
  '"http_user_agent":"$http_user_agent",'
  '"x_forwarded_for":"$http_x_forwarded_for"'
'}';

access_log /var/log/nginx/access.json.log main_json;
error_log  /var/log/nginx/error.log warn;
```

### Kenapa Field Ini Penting?

`request_time` mengukur total waktu dari sisi Nginx.

`upstream_response_time` mengukur waktu response dari backend. Jika `request_time` tinggi tetapi `upstream_response_time` rendah, bottleneck mungkin ada di client, buffering, atau response transfer.

`upstream_connect_time` tinggi dapat menunjukkan masalah network, backlog, DNS, atau backend accept queue.

`upstream_status` penting saat Nginx retry ke beberapa backend. Status akhir client bisa `200`, tetapi upstream pertama bisa `502` sebelum retry sukses.

`request_id` menjadi pengikat antara Nginx log dan Java application log.

---

## 7. Map untuk Routing dan Policy

File:

```text
/etc/nginx/conf.d/10-maps.conf
```

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

map $http_x_canary $use_canary {
    default 0;
    "true"  1;
}

map $request_method $is_safe_method {
    default 0;
    GET     1;
    HEAD    1;
}

map $http_authorization $has_authorization {
    default 1;
    ''      0;
}

map $http_cookie $has_cookie {
    default 1;
    ''      0;
}

map "$is_safe_method:$has_authorization:$has_cookie" $api_cache_bypass {
    default 1;
    "1:0:0" 0;
}
```

### Penjelasan

`$connection_upgrade` adalah pola umum untuk WebSocket.

`$use_canary` memungkinkan routing canary berbasis header. Untuk production nyata, routing biasanya menggunakan cookie, header internal, atau traffic splitter yang lebih formal.

`$api_cache_bypass` dibuat konservatif:

```text
Cache hanya ketika:
- method GET/HEAD,
- tidak ada Authorization,
- tidak ada Cookie.
```

Ini menghindari kebocoran data user-specific.

---

## 8. Upstream Definition

File:

```text
/etc/nginx/conf.d/20-upstreams.conf
```

```nginx
upstream api_v1_backend {
    least_conn;

    server 10.10.10.11:8080 max_fails=3 fail_timeout=10s;
    server 10.10.10.12:8080 max_fails=3 fail_timeout=10s;
    server 10.10.10.13:8080 max_fails=3 fail_timeout=10s;

    keepalive 128;
}

upstream api_v2_canary_backend {
    server 10.10.20.11:8080 max_fails=2 fail_timeout=10s;
    keepalive 32;
}

upstream websocket_backend {
    ip_hash;

    server 10.10.30.11:8090 max_fails=3 fail_timeout=10s;
    server 10.10.30.12:8090 max_fails=3 fail_timeout=10s;
}

upstream admin_backend {
    server 10.10.40.11:8081 max_fails=2 fail_timeout=10s;
    keepalive 16;
}
```

### Kenapa `least_conn` untuk API?

Untuk API request yang durasinya bervariasi, `least_conn` sering lebih masuk akal daripada round-robin karena worker yang sedang menangani request lambat tidak terus mendapat beban secara merata tanpa melihat koneksi aktif.

Tetapi ini bukan silver bullet. Jika satu backend lambat karena GC pause atau database dependency, Nginx mungkin tetap melihat koneksi aktif, bukan health semantic aplikasi.

### Kenapa `ip_hash` untuk WebSocket?

WebSocket long-lived sering membutuhkan stickiness. `ip_hash` adalah pendekatan sederhana, tetapi punya kelemahan:

- banyak user di NAT yang sama bisa menumpuk ke node yang sama,
- tidak mempertimbangkan load aktual,
- tidak cocok jika scaling dinamis sering terjadi.

Untuk sistem besar, stickiness berbasis cookie atau dedicated load balancer mungkin lebih baik.

---

## 9. Cache Configuration

File:

```text
/etc/nginx/conf.d/30-cache.conf
```

```nginx
proxy_cache_path /var/cache/nginx/api_cache
    levels=1:2
    keys_zone=api_cache_zone:100m
    max_size=5g
    inactive=30m
    use_temp_path=off;
```

### Cache Design

Cache ini hanya akan digunakan untuk endpoint API yang eksplisit aman.

Jangan cache semua `/api/` secara buta.

Aman dicache biasanya:

```text
GET /api/public/catalog
GET /api/public/config
GET /api/public/reference-data
GET /api/public/feature-flags-public
```

Berbahaya dicache:

```text
GET /api/me
GET /api/account
GET /api/orders
GET /api/cases/123
GET /api/notifications
```

Rule penting:

> Jika response berbeda antar user, jangan cache di shared reverse proxy kecuali cache key memasukkan identitas dan isolation-nya terbukti benar.

Dalam banyak sistem regulated, lebih aman tidak cache data user-specific di Nginx.

---

## 10. Rate Limit and Connection Limit

File:

```text
/etc/nginx/conf.d/40-rate-limit.conf
```

```nginx
limit_req_zone $binary_remote_addr zone=global_per_ip:20m rate=20r/s;
limit_req_zone $binary_remote_addr zone=login_per_ip:20m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api_write_per_ip:20m rate=10r/s;

limit_conn_zone $binary_remote_addr zone=conn_per_ip:20m;
```

### Prinsip Rate Limit

Rate limit bukan hanya proteksi security. Ia juga proteksi capacity.

Misalnya:

- `/api/auth/login` perlu limit ketat karena brute force dan expensive authentication.
- `/api/search` perlu limit karena bisa memicu query mahal.
- write endpoint perlu limit agar tidak membuat queue database tumbuh.
- static asset biasanya tidak perlu limit seketat API.

Rate limit harus dievaluasi dengan real traffic. Limit terlalu ketat akan menyakiti user legitimate, terutama yang berasal dari NAT atau corporate proxy.

---

## 11. Shared Proxy Headers Snippet

File:

```text
/etc/nginx/snippets/proxy-headers.conf
```

```nginx
proxy_http_version 1.1;

proxy_set_header Host              $host;
proxy_set_header X-Request-ID      $request_id;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port  $server_port;

proxy_set_header Connection "";
```

### Kontrak dengan Java App

Aplikasi Java harus dikonfigurasi untuk memahami forwarded headers.

Contoh konsekuensi jika tidak:

- redirect dari app mengarah ke `http://` bukan `https://`,
- absolute URL salah,
- cookie `Secure` tidak diset,
- audit log memakai IP Nginx, bukan IP client,
- generated link di email salah host,
- OAuth callback mismatch.

Kontrak yang harus disepakati:

```text
Nginx owns external scheme/host/port.
Application trusts forwarded headers only from Nginx network.
Application never trusts arbitrary X-Forwarded-* from public client.
```

---

## 12. TLS Snippet

File:

```text
/etc/nginx/snippets/tls-common.conf
```

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;

ssl_session_cache shared:SSL:50m;
ssl_session_timeout 1d;
ssl_session_tickets off;

ssl_stapling on;
ssl_stapling_verify on;

resolver 1.1.1.1 8.8.8.8 valid=300s;
resolver_timeout 5s;
```

### Catatan Production

Resolver harus disesuaikan dengan environment:

- cloud VPC resolver,
- Kubernetes DNS,
- corporate DNS,
- internal resolver.

Jangan copy-paste public resolver jika policy jaringan melarangnya.

`ssl_session_tickets off` menghindari risiko ticket key management yang buruk. Jika session tickets digunakan, key rotation harus dikelola dengan benar.

---

## 13. Security Headers Snippet

File:

```text
/etc/nginx/snippets/security-headers.conf
```

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
add_header X-Frame-Options "DENY" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

### CSP Tidak Sembarangan

Content Security Policy sebaiknya tidak asal ditaruh generik. CSP harus mengikuti asset, script, style, CDN, dan third-party integration aplikasi.

CSP yang terlalu longgar tidak berguna:

```text
Content-Security-Policy: default-src * 'unsafe-inline' 'unsafe-eval'
```

CSP yang terlalu ketat bisa mematikan aplikasi frontend.

Untuk capstone ini, kita tidak set CSP global. CSP harus didesain bersama frontend.

---

## 14. Error Pages Snippet

File:

```text
/etc/nginx/snippets/error-pages.conf
```

```nginx
error_page 400 401 403 404 /error/generic.html;
error_page 500 502 503 504 /error/generic.html;

location = /error/generic.html {
    internal;
    root /var/www/error-pages;
}
```

### Prinsip Error Page

Error page tidak boleh membocorkan:

- upstream hostname,
- internal IP,
- stack trace,
- framework version,
- path filesystem,
- detail query/database.

Untuk API, lebih baik aplikasi menghasilkan JSON error sendiri. Tetapi untuk error yang terjadi di Nginx sebelum sampai aplikasi, Nginx perlu response aman.

---

## 15. WebSocket Snippet

File:

```text
/etc/nginx/snippets/websocket-proxy.conf
```

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;

proxy_set_header Host              $host;
proxy_set_header X-Request-ID      $request_id;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Port  $server_port;

proxy_read_timeout 1h;
proxy_send_timeout 1h;
proxy_buffering off;
```

### Kenapa Berbeda dari Proxy API Biasa?

WebSocket adalah koneksi long-lived. Jika timeout terlalu pendek, user akan disconnect periodik.

`proxy_buffering off` menghindari pola buffering yang tidak cocok untuk komunikasi real-time.

---

## 16. HTTP to HTTPS Redirect Server

File:

```text
/etc/nginx/conf.d/sites/00-redirect-http.conf
```

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    return 301 https://$host$request_uri;
}
```

### Catatan Host Header

Redirect memakai `$host`. Pada environment dengan banyak domain, ini umum. Tetapi host asing juga bisa diarahkan.

Untuk security ketat, kita bisa buat catch-all yang menolak unknown host, dan server khusus untuk domain valid.

Contoh lebih ketat:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 80;
    server_name www.example.com api.example.com admin.example.com;
    return 301 https://$host$request_uri;
}
```

Pendekatan kedua lebih defensif.

---

## 17. Catch-All HTTPS Server

File:

```text
/etc/nginx/conf.d/sites/01-catch-all-https.conf
```

```nginx
server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;

    server_name _;

    ssl_certificate     /etc/nginx/tls/example/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/example/privkey.pem;
    include /etc/nginx/snippets/tls-common.conf;

    return 444;
}
```

### Kenapa Catch-All Penting?

Tanpa catch-all, request untuk host yang tidak dikenal bisa masuk ke server block pertama. Ini berbahaya karena:

- domain asing bisa menampilkan aplikasi kita,
- Host header attack lebih mudah,
- audit log membingungkan,
- tenant/domain isolation rusak,
- certificate/SNI behavior bisa tidak sesuai ekspektasi.

`444` adalah Nginx-specific close connection tanpa response. Di beberapa organisasi, lebih baik return `421` atau `404` agar observability lebih jelas.

---

## 18. `www.example.com`: Static SPA Server

File:

```text
/etc/nginx/conf.d/sites/www.example.com.conf
```

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name www.example.com;

    ssl_certificate     /etc/nginx/tls/example/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/example/privkey.pem;
    include /etc/nginx/snippets/tls-common.conf;
    include /etc/nginx/snippets/security-headers.conf;

    root /var/www/example-spa/current;
    index index.html;

    access_log /var/log/nginx/www.access.json.log main_json;

    location = /favicon.ico {
        try_files /favicon.ico =404;
        access_log off;
    }

    location = /robots.txt {
        try_files /robots.txt =404;
        access_log off;
    }

    location ~* \.(?:js|css|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }

    location ~ /\. {
        deny all;
    }
}
```

### Penjelasan

Hashed static assets aman diberi cache panjang:

```text
app.8f3a9c1.js
style.901abc.css
```

Karena ketika konten berubah, filename juga berubah.

`index.html` tidak boleh cache terlalu lama karena ia menunjuk asset versi terbaru. Jika `index.html` cached lama, user bisa mendapat HTML lama yang menunjuk asset yang sudah hilang.

SPA fallback:

```nginx
try_files $uri $uri/ /index.html;
```

Ini membuat route seperti `/cases/123` tetap mengembalikan `index.html` agar frontend router mengambil alih.

Namun jangan gunakan fallback ini di domain API, karena bisa menyembunyikan 404 API.

---

## 19. `api.example.com`: Java API Reverse Proxy

File:

```text
/etc/nginx/conf.d/sites/api.example.com.conf
```

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name api.example.com;

    ssl_certificate     /etc/nginx/tls/example/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/example/privkey.pem;
    include /etc/nginx/snippets/tls-common.conf;
    include /etc/nginx/snippets/security-headers.conf;

    access_log /var/log/nginx/api.access.json.log main_json;

    client_max_body_size 10m;

    limit_conn conn_per_ip 50;
    limit_req zone=global_per_ip burst=40 nodelay;

    location = /healthz {
        access_log off;
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }

    location = /api/auth/login {
        limit_req zone=login_per_ip burst=5 nodelay;

        proxy_pass http://api_v1_backend;
        include /etc/nginx/snippets/proxy-headers.conf;

        proxy_connect_timeout 2s;
        proxy_send_timeout 10s;
        proxy_read_timeout 15s;

        proxy_buffering on;
    }

    location ~ ^/api/public/(catalog|config|reference-data) {
        proxy_pass http://api_v1_backend;
        include /etc/nginx/snippets/proxy-headers.conf;

        proxy_connect_timeout 2s;
        proxy_send_timeout 10s;
        proxy_read_timeout 20s;

        proxy_cache api_cache_zone;
        proxy_cache_methods GET HEAD;
        proxy_cache_key "$scheme$request_method$host$request_uri";
        proxy_cache_bypass $api_cache_bypass;
        proxy_no_cache $api_cache_bypass;

        proxy_cache_valid 200 5m;
        proxy_cache_valid 404 30s;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_lock on;

        add_header X-Cache-Status $upstream_cache_status always;
    }

    location /api/ {
        limit_req zone=api_write_per_ip burst=20 nodelay;

        if ($use_canary) {
            proxy_pass http://api_v2_canary_backend;
            break;
        }

        proxy_pass http://api_v1_backend;
        include /etc/nginx/snippets/proxy-headers.conf;

        proxy_connect_timeout 2s;
        proxy_send_timeout 15s;
        proxy_read_timeout 30s;

        proxy_buffering on;
        proxy_request_buffering on;

        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
    }

    location ~ /\. {
        deny all;
    }
}
```

### Catatan Penting: `if` di Nginx

Contoh canary dengan `if` di atas sengaja dibuat sederhana untuk pembelajaran, tetapi dalam production lebih baik menghindari `if` kompleks di dalam `location`.

Alternatif lebih bersih adalah menggunakan `map` ke upstream name, tetapi Nginx OSS memiliki keterbatasan dynamic upstream variable dengan keepalive dan resolusi nama. Untuk traffic splitting serius, pertimbangkan:

- separate server/location,
- cookie/header-based route eksplisit,
- deployment platform,
- NGINX Plus,
- Envoy/Kong/service mesh,
- Kubernetes Ingress/Gateway controller dengan fitur canary.

### Timeout Budget

Contoh API timeout:

```text
connect_timeout = 2s
send_timeout    = 15s
read_timeout    = 30s
```

Ini harus selaras dengan:

- timeout client/mobile,
- timeout application handler,
- database query timeout,
- downstream service timeout,
- load balancer idle timeout di depan Nginx,
- circuit breaker di aplikasi.

Jika backend Java punya endpoint dengan SLA 2 detik, jangan beri `proxy_read_timeout 300s` secara global. Itu akan menyembunyikan masalah dan membuat resource tertahan terlalu lama.

---

## 20. `api.example.com`: Alternative Canary Using Separate Path

Untuk production awal, lebih aman membuat path eksplisit:

```nginx
location /api-canary/ {
    proxy_pass http://api_v2_canary_backend/;
    include /etc/nginx/snippets/proxy-headers.conf;

    proxy_connect_timeout 2s;
    proxy_send_timeout 15s;
    proxy_read_timeout 30s;
}
```

Ini membuat canary tidak diam-diam memengaruhi semua user. QA, internal user, atau synthetic monitor bisa menguji versi baru dengan path jelas.

Namun path-based canary dapat mengubah semantics URL. Untuk app nyata, header/cookie-based routing biasanya lebih realistis.

---

## 21. `api.example.com`: WebSocket Location

Tambahkan di server `api.example.com`:

```nginx
location /ws/ {
    proxy_pass http://websocket_backend;
    include /etc/nginx/snippets/websocket-proxy.conf;
}
```

### Failure Mode WebSocket

Gejala umum:

```text
WebSocket disconnect setiap 60 detik
```

Kemungkinan penyebab:

- `proxy_read_timeout` terlalu pendek,
- cloud load balancer idle timeout lebih pendek,
- backend tidak kirim ping/pong,
- mobile network idle drop,
- proxy buffering tidak sesuai,
- deployment tidak drain koneksi.

Untuk long-lived connection, konfigurasi Nginx hanya satu bagian. Backend Java juga harus:

- mengirim heartbeat,
- handle reconnect,
- graceful shutdown,
- tidak menyimpan state kritikal hanya di memory koneksi,
- siap terhadap duplicate reconnect.

---

## 22. `admin.example.com`: Restricted Admin Boundary

File:

```text
/etc/nginx/conf.d/sites/admin.example.com.conf
```

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name admin.example.com;

    ssl_certificate     /etc/nginx/tls/example/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/example/privkey.pem;
    include /etc/nginx/snippets/tls-common.conf;
    include /etc/nginx/snippets/security-headers.conf;

    access_log /var/log/nginx/admin.access.json.log main_json;

    allow 203.0.113.0/24;
    allow 198.51.100.10;
    deny all;

    client_max_body_size 5m;

    location / {
        proxy_pass http://admin_backend;
        include /etc/nginx/snippets/proxy-headers.conf;

        proxy_connect_timeout 2s;
        proxy_send_timeout 10s;
        proxy_read_timeout 30s;
    }

    location ~ ^/(actuator|metrics|internal) {
        deny all;
    }
}
```

### Catatan Penting

IP allowlist bukan authorization penuh.

Admin app tetap harus punya:

- authentication,
- authorization,
- audit log,
- CSRF protection jika berbasis browser,
- session protection,
- role-based access,
- approval workflow bila domain regulated.

Nginx hanya lapisan pertahanan awal.

---

## 23. Java Application Configuration Alignment

Nginx config tidak berdiri sendiri. Backend Java harus disejajarkan.

### 23.1 Spring Boot Forwarded Headers

Contoh property:

```properties
server.forward-headers-strategy=framework
```

Atau tergantung deployment:

```properties
server.tomcat.remoteip.remote-ip-header=x-forwarded-for
server.tomcat.remoteip.protocol-header=x-forwarded-proto
server.tomcat.remoteip.host-header=x-forwarded-host
```

Validasi behavior:

```java
request.getScheme()      // harus https untuk request external HTTPS
request.getServerName()  // harus api.example.com
request.getRemoteAddr()  // sesuai trust model
```

### 23.2 Cookie Security

Jika TLS terminate di Nginx, app tetap harus tahu external scheme HTTPS agar cookie aman:

```text
Set-Cookie: SESSION=...; Secure; HttpOnly; SameSite=Lax
```

Jika app mengira request adalah HTTP, ia mungkin tidak menandai cookie sebagai Secure.

### 23.3 Redirect and Absolute URL

OAuth, SAML, email link, file download URL, dan pagination link bisa rusak jika host/scheme salah.

Contract test perlu memverifikasi:

```text
External request https://api.example.com/login
App-generated redirect tetap https://api.example.com/...
```

---

## 24. End-to-End Request Lifecycle

Mari ikuti satu request:

```text
GET https://api.example.com/api/public/catalog
```

Flow:

```text
1. Client melakukan TCP connect ke 443.
2. TLS handshake terjadi; SNI = api.example.com.
3. Nginx memilih server block api.example.com.
4. HTTP/2 atau HTTP/1.1 dinegosiasikan via ALPN.
5. Nginx mengevaluasi location.
6. Cocok ke /api/public/(catalog|config|reference-data).
7. Nginx cek rate limit dan connection limit.
8. Nginx cek cache key.
9. Jika HIT, response dikirim tanpa menyentuh Java backend.
10. Jika MISS, request diproxy ke api_v1_backend.
11. Nginx menambahkan proxy headers.
12. Backend Java memproses request.
13. Response kembali ke Nginx.
14. Jika memenuhi policy, response disimpan di cache.
15. Nginx menulis access log dengan upstream timing dan cache status.
16. Client menerima response.
```

Yang penting:

```text
Nginx decision terjadi sebelum aplikasi melihat request.
```

Jadi error di Nginx bisa membuat aplikasi tidak pernah menerima request sama sekali.

---

## 25. Threat Model

### 25.1 Asset yang Dilindungi

- API data,
- user session,
- admin endpoints,
- backend service availability,
- TLS private key,
- internal network topology,
- logs containing personal/sensitive data,
- deployment integrity,
- cache correctness.

### 25.2 Threat Actors

- anonymous internet client,
- abusive authenticated user,
- bot/scraper,
- compromised internal client,
- misconfigured upstream service,
- accidental engineer change,
- malicious config modification.

### 25.3 Attack/Fault Surface

```text
Host header
X-Forwarded-* spoofing
oversized headers/body
path traversal
cache poisoning
admin endpoint exposure
TLS misconfiguration
redirect loop
slowloris-style behavior
log injection
sensitive data in logs
unbounded uploads
WebSocket connection exhaustion
config drift
```

### 25.4 Controls in This Design

```text
Catch-all server rejects unknown host
TLS policy centralized
body/header limits set
rate limits defined per endpoint class
admin allowlist added
security headers applied
shared proxy header contract used
cache bypass conservative
JSON logs provide traceability
error pages avoid internal leakage
```

---

## 26. Failure Model

### 26.1 Backend Java Down

Symptoms:

```text
502 Bad Gateway
upstream_status=502
connect() failed
connection refused
```

Likely causes:

- app process down,
- port wrong,
- service not listening,
- firewall/security group,
- Kubernetes Service has no endpoints,
- app during restart.

Immediate actions:

```bash
nginx -T | grep -A20 upstream
ss -lntp | grep 8080
curl -v http://10.10.10.11:8080/actuator/health
```

Mitigation:

- remove bad upstream,
- rollback backend,
- route to healthy pool,
- enable stale cache for safe endpoints.

### 26.2 Backend Slow

Symptoms:

```text
504 Gateway Timeout
high upstream_response_time
low Nginx CPU
backend thread pool saturated
```

Likely causes:

- database slow,
- Java GC pause,
- thread pool exhaustion,
- downstream dependency timeout too long,
- lock contention,
- high request fanout.

Mitigation:

- reduce timeout budget,
- shed load,
- rate limit expensive endpoint,
- serve stale cache,
- rollback recent release,
- scale backend if bottleneck is parallelizable.

### 26.3 Client Disconnects

Symptoms:

```text
499 Client Closed Request
```

Possible meaning:

- user navigated away,
- mobile network dropped,
- client timeout shorter than backend latency,
- frontend aborts request,
- load balancer in front terminated connection.

Important:

499 is not always “Nginx problem”. It is a client-side close observed by Nginx.

### 26.4 Cache Poisoning

Symptoms:

```text
User receives wrong response
X-Cache-Status=HIT
Issue only appears after one user/request pattern
```

Likely causes:

- cache key missing header/query/host,
- response with Authorization cached,
- cookie-specific response cached,
- backend forgot `Cache-Control: private/no-store`,
- Nginx policy too permissive.

Mitigation:

- disable cache immediately for affected location,
- purge cache directory/zone if needed,
- inspect cache key design,
- add contract tests.

### 26.5 Config Reload Failure

Symptoms:

```text
nginx -s reload fails
systemctl reload nginx fails
old config still active
```

Important:

Nginx graceful reload validates config before switching. If config invalid, old workers continue serving old config.

Immediate actions:

```bash
nginx -t
nginx -T > /tmp/effective-nginx.conf
journalctl -u nginx -n 100
```

Mitigation:

- fix syntax,
- run config test in CI,
- avoid manual production edits,
- use version-controlled config.

---

## 27. Deployment and Rollback Model

### 27.1 Safe Config Deployment Flow

Recommended flow:

```text
1. Edit config in version control.
2. Run static review.
3. Run nginx -t in CI container.
4. Run integration smoke test.
5. Deploy to staging.
6. Run synthetic request suite.
7. Deploy to production node subset.
8. Validate logs and metrics.
9. Roll out gradually.
10. Keep rollback artifact ready.
```

### 27.2 Commands

```bash
sudo nginx -t
sudo nginx -T | less
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
```

### 27.3 Rollback Principle

Rollback must restore:

- config file,
- snippets,
- certificates if changed,
- cache policy if changed,
- upstream definitions,
- rate limit zones if changed.

Do not rollback only one file if config is composed from includes.

---

## 28. Production Readiness Checklist

### 28.1 Routing

- [ ] Unknown HTTP host rejected or safely redirected.
- [ ] Unknown HTTPS host rejected.
- [ ] `server_name` explicit.
- [ ] SPA fallback only applied to frontend server.
- [ ] API 404 not swallowed by `index.html`.
- [ ] WebSocket route has upgrade headers.
- [ ] Admin route restricted.

### 28.2 Proxy Contract

- [ ] `Host` forwarded intentionally.
- [ ] `X-Request-ID` forwarded.
- [ ] `X-Forwarded-For` chain understood.
- [ ] Java app trusts forwarded headers only from Nginx.
- [ ] Redirect URL verified.
- [ ] Secure cookie verified.
- [ ] Client IP audit verified.

### 28.3 TLS

- [ ] TLS 1.2/1.3 only.
- [ ] Certificate chain valid.
- [ ] Private key permission restricted.
- [ ] Renewal monitored.
- [ ] HSTS intentionally enabled.
- [ ] OCSP stapling configured if appropriate.
- [ ] SNI behavior tested.

### 28.4 Limits and Backpressure

- [ ] `client_max_body_size` set.
- [ ] Header buffer reasonable.
- [ ] Rate limits per endpoint class.
- [ ] Connection limits considered.
- [ ] Timeout budget aligned with Java/database/client.
- [ ] Retry count bounded.
- [ ] No unbounded long request globally.

### 28.5 Cache

- [ ] Cache only for safe endpoints.
- [ ] Authorization/Cookie bypass enforced.
- [ ] Cache key includes required dimensions.
- [ ] Stale policy intentional.
- [ ] Cache purge/disable procedure known.
- [ ] `X-Cache-Status` observable.

### 28.6 Observability

- [ ] JSON access logs enabled.
- [ ] Error log level appropriate.
- [ ] Upstream timing logged.
- [ ] Request ID propagated to Java logs.
- [ ] 499/502/503/504 dashboard exists.
- [ ] Cache hit/miss visible.
- [ ] Rate limit rejections visible.

### 28.7 Operations

- [ ] `nginx -t` in CI.
- [ ] Effective config review possible via `nginx -T`.
- [ ] Reload procedure documented.
- [ ] Rollback procedure documented.
- [ ] Config in version control.
- [ ] No manual snowflake production config.
- [ ] Certificate expiry alert exists.
- [ ] Disk usage alert for logs/cache exists.

---

## 29. Common Design Mistakes

### Mistake 1: Nginx as Random Copy-Paste Config

Bad sign:

```text
No one knows why directive exists.
Changing one route breaks another.
Different environments have unrelated config.
```

Better:

```text
Treat config as code with ownership, review, tests, and documented invariants.
```

### Mistake 2: Caching User-Specific API

Bad:

```nginx
location /api/ {
    proxy_cache api_cache_zone;
}
```

This can leak private data.

Better:

```text
Only cache explicit public endpoints with conservative bypass rules.
```

### Mistake 3: Timeout Too High Everywhere

Bad:

```nginx
proxy_read_timeout 300s;
```

This hides backend failure and holds resources.

Better:

```text
Use endpoint-specific timeout budgets aligned with SLA.
```

### Mistake 4: Trusting X-Forwarded-For Blindly

Bad:

```text
Application trusts whatever X-Forwarded-For arrives from internet.
```

Better:

```text
Nginx normalizes forwarding headers; app trusts only Nginx/proxy network.
```

### Mistake 5: No Catch-All Server

Bad:

```text
Unknown domains route to production app.
```

Better:

```text
Reject unknown host explicitly.
```

### Mistake 6: Using Nginx for Business Authorization

Bad:

```text
Complex role/business rules encoded in location/if/map spaghetti.
```

Better:

```text
Nginx handles coarse traffic controls; app handles domain authorization.
```

---

## 30. Capstone Testing Plan

### 30.1 Config Syntax

```bash
nginx -t
nginx -T > effective.conf
```

### 30.2 Host Routing

```bash
curl -I http://www.example.com/
curl -I https://www.example.com/
curl -k -H 'Host: unknown.example.com' https://127.0.0.1/
```

Expected:

- valid hosts route correctly,
- unknown hosts rejected.

### 30.3 Static Asset Cache

```bash
curl -I https://www.example.com/assets/app.abc123.js
curl -I https://www.example.com/
```

Expected:

```text
assets: Cache-Control public, immutable
index:  Cache-Control no-cache
```

### 30.4 API Proxy Header

Create backend debug endpoint in non-production:

```text
GET /api/debug/request-context
```

Validate:

```text
scheme=https
host=api.example.com
requestId present
client IP expected
```

### 30.5 Cache Safety

```bash
curl -I https://api.example.com/api/public/catalog
curl -I -H 'Authorization: Bearer token' https://api.example.com/api/public/catalog
curl -I -H 'Cookie: SESSION=abc' https://api.example.com/api/public/catalog
```

Expected:

- anonymous GET may cache,
- Authorization request bypasses cache,
- Cookie request bypasses cache.

### 30.6 Login Rate Limit

Use controlled test:

```bash
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://api.example.com/api/auth/login
 done
```

Expected:

- after threshold, status `429` or configured limit status.

### 30.7 WebSocket

Use WebSocket client:

```bash
wscat -c wss://api.example.com/ws/notifications
```

Validate:

- connection upgrades,
- heartbeat works,
- no disconnect at short timeout,
- deploy drain behavior known.

---

## 31. Operational Runbook

### 31.1 Before Deploying Config

```bash
nginx -t
nginx -T | grep -n "server_name"
nginx -T | grep -n "proxy_pass"
```

Check:

- target upstream correct,
- no duplicate ambiguous server block,
- no accidental broad regex,
- snippets included in intended order.

### 31.2 After Reload

```bash
systemctl reload nginx
systemctl status nginx --no-pager
journalctl -u nginx -n 100 --no-pager
```

Then synthetic checks:

```bash
curl -I https://www.example.com/
curl -I https://api.example.com/healthz
curl -I https://admin.example.com/
```

### 31.3 During Incident

Start with classification:

```text
Is this all traffic or one route?
Is this one domain or all domains?
Is this client-facing TLS/routing or upstream backend?
Is Nginx returning error before upstream?
Is upstream returning error through Nginx?
Is latency from Nginx, network, backend, or client?
```

Use log fields:

```text
status
upstream_status
request_time
upstream_connect_time
upstream_header_time
upstream_response_time
upstream_addr
request_id
```

Decision table:

| Symptom | Likely Area | First Check |
|---|---|---|
| 400 spike | client/header/request syntax | error log, header size |
| 403 spike | access rule | allow/deny, auth, location |
| 404 API | routing/location/app route | location match, upstream log |
| 413 | body limit | client_max_body_size |
| 429 | rate limit | limit_req logs, traffic source |
| 499 | client disconnect | client timeout, latency |
| 502 | upstream connection/error | backend port, service health |
| 503 | upstream unavailable/limit | upstream pool, overload |
| 504 | upstream timeout | backend latency, timeout budget |

---

## 32. Final Mental Model

Jika harus diringkas, Nginx production mastery adalah kemampuan menjawab lima pertanyaan ini untuk setiap request:

### 32.1 Who accepted the request?

```text
server block mana?
listen mana?
SNI/Host mana?
default server atau explicit server?
```

### 32.2 Which route handled it?

```text
location mana?
exact, prefix, regex, atau fallback?
try_files atau proxy_pass?
```

### 32.3 What contract was applied?

```text
headers apa yang diteruskan?
timeout apa yang berlaku?
body/header limit apa?
cache/rate/security policy apa?
```

### 32.4 What happened upstream?

```text
upstream mana?
server mana?
connect time?
response time?
retry terjadi?
cache hit/miss?
```

### 32.5 What evidence exists?

```text
access log?
error log?
request ID?
Java application log?
metrics?
trace?
```

Engineer yang kuat tidak hanya menghafal directive. Ia bisa merekonstruksi perjalanan request secara deterministik.

---

## 33. What Top 1% Understanding Looks Like

Top-level understanding terhadap Nginx berarti kamu mampu:

1. membaca config besar dan menemukan routing actual,
2. menjelaskan kenapa request masuk ke upstream tertentu,
3. mendesain proxy header contract yang aman,
4. menyelaraskan timeout Nginx dengan Java dan database,
5. membedakan error Nginx vs error backend,
6. melakukan reload aman tanpa downtime yang tidak perlu,
7. membuat cache yang meningkatkan resilience tanpa membocorkan data,
8. membuat rate limit yang melindungi sistem tanpa merusak user legitimate,
9. menghubungkan access log dengan application log,
10. membuat incident playbook berbasis sinyal,
11. menolak penggunaan Nginx untuk logic yang seharusnya ada di application/gateway/platform,
12. menganggap config sebagai artefak engineering yang harus dites, direview, dan dimonitor.

---

## 34. Final Capstone Exercise

Desain ulang config capstone ini untuk skenario berikut:

```text
Company has:
- public SPA
- B2B API
- mobile API
- admin console
- webhook receiver
- file upload endpoint
- SSE notification endpoint
- Spring Boot monolith being split into services
```

Buat keputusan:

1. domain mana saja,
2. route mana ke backend mana,
3. endpoint mana yang boleh cache,
4. endpoint mana yang harus rate limit,
5. timeout per endpoint class,
6. body size limit per endpoint,
7. WebSocket/SSE policy,
8. proxy header contract,
9. logging format,
10. incident playbook untuk 502 dan 504,
11. rollback strategy,
12. production checklist.

Jawaban yang baik bukan config paling panjang. Jawaban yang baik adalah config yang memiliki invariant jelas.

---

## 35. Seri Selesai

Dengan selesainya Part 030, seri:

```text
learn-nginx-mastery-for-java-engineers
```

resmi selesai.

Total bagian:

```text
Part 000 sampai Part 030
31 file markdown
```

Cakupan yang sudah diselesaikan:

1. orientasi dan mental model,
2. arsitektur proses Nginx,
3. instalasi dan layout runtime,
4. grammar konfigurasi,
5. server selection,
6. location matching,
7. static file serving,
8. reverse proxy ke Java,
9. proxy header contract,
10. upstream dan load balancing,
11. timeout/retry/buffering/backpressure,
12. connection dan performance tuning,
13. TLS termination,
14. HTTP/2 dan HTTP/3,
15. compression,
16. reverse proxy cache,
17. rate limiting,
18. access control,
19. security hardening,
20. observability,
21. debugging production,
22. interaksi dengan Java application server,
23. WebSocket/SSE/gRPC,
24. progressive delivery,
25. lightweight API gateway,
26. container dan Kubernetes,
27. stream module TCP/UDP,
28. config design pattern,
29. incident/failure modeling,
30. benchmarking dan capacity planning,
31. capstone production design.

---

## 36. Penutup

Nginx adalah salah satu komponen yang tampak sederhana tetapi berada di posisi sangat kritis. Ia duduk di antara dunia luar dan sistem internal. Ia bisa memperbaiki resilience, mengurangi latency, menyederhanakan routing, dan memperkuat observability. Tetapi ia juga bisa menjadi sumber outage jika dikonfigurasi tanpa model mental yang kuat.

Cara berpikir yang harus dibawa setelah seri ini:

```text
Every request has a path.
Every directive changes a boundary.
Every timeout encodes a failure policy.
Every cache rule encodes a data-safety assumption.
Every proxy header is a trust contract.
Every config change has blast radius.
```

Jika kamu bisa melihat Nginx dengan cara itu, kamu tidak lagi sekadar “bisa konfigurasi Nginx”. Kamu bisa mendesain dan mengoperasikan traffic boundary yang bisa dipertanggungjawabkan.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-029.md">⬅️ Part 029 — Performance Lab: Benchmarking, Capacity Planning, and Tuning Experiments</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
