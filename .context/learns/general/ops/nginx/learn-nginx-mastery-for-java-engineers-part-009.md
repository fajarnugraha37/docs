# learn-nginx-mastery-for-java-engineers-part-009

# Part 009 — Upstream Blocks and Load Balancing

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer / tech lead  
> Fokus: memahami `upstream` dan load balancing Nginx sebagai mekanisme routing, failure containment, connection reuse, dan traffic distribution di depan aplikasi Java.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas:

- bagaimana Nginx menerima request;
- bagaimana `server` block dipilih;
- bagaimana `location` block dipilih;
- bagaimana static asset dilayani;
- bagaimana request diproxy ke aplikasi Java;
- bagaimana header proxy menjadi kontrak antara Nginx dan aplikasi.

Sekarang kita masuk ke satu level arsitektural yang lebih penting:

> Kalau aplikasi backend tidak hanya satu instance, bagaimana Nginx memilih instance mana yang menerima request?

Jawabannya adalah melalui kombinasi:

```nginx
upstream backend_pool {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
}

server {
    location /api/ {
        proxy_pass http://backend_pool;
    }
}
```

Tapi konfigurasi di atas baru permukaan. Di production, pertanyaan yang sebenarnya jauh lebih dalam:

- Bagaimana Nginx mendistribusikan request?
- Apakah distribusi itu benar-benar merata?
- Apa yang terjadi jika satu instance lambat, bukan mati?
- Apakah retry akan memperbaiki masalah atau justru membuat overload makin parah?
- Apakah session user akan tetap ke node yang sama?
- Bagaimana connection reuse dari Nginx ke backend Java?
- Bagaimana hubungan upstream Nginx dengan thread pool Tomcat, Netty event loop, database pool, dan autoscaling?
- Apa yang seharusnya dilakukan Nginx, dan apa yang seharusnya tetap menjadi tanggung jawab orchestrator/service discovery?

Part ini membangun mental model tersebut.

---

## 1. Core Mental Model

### 1.1 Nginx Load Balancing Bukan Sekadar “Bagi Rata”

Banyak engineer membayangkan load balancer seperti ini:

```text
request 1 -> app-1
request 2 -> app-2
request 3 -> app-3
request 4 -> app-1
```

Itu model yang terlalu sederhana.

Di dunia nyata, request tidak identik:

```text
request A: GET /health                 2 ms
request B: GET /products              40 ms
request C: POST /checkout            300 ms
request D: GET /report/export     30_000 ms
request E: websocket             long-lived
request F: upload file             streaming
```

Kalau semua request dianggap sama, distribusi jumlah request bisa terlihat merata, tetapi distribusi beban CPU, memory, DB query, lock contention, dan latency bisa sangat tidak merata.

Jadi load balancing harus dipahami sebagai:

> mekanisme pemilihan upstream server untuk setiap request atau connection berdasarkan algoritma tertentu, dengan konsekuensi terhadap fairness, latency, failure behavior, state affinity, dan capacity utilization.

---

### 1.2 `upstream` Adalah Abstraksi Pool Backend

`upstream` mendefinisikan sekumpulan endpoint backend yang dapat digunakan oleh directive proxy seperti `proxy_pass`.

Contoh:

```nginx
upstream order_service {
    server 10.10.1.21:8080;
    server 10.10.1.22:8080;
    server 10.10.1.23:8080;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    location /orders/ {
        proxy_pass http://order_service;
    }
}
```

Secara arsitektural:

```text
Client
  |
  v
Nginx
  |
  +--> order_service upstream
          |
          +--> 10.10.1.21:8080
          +--> 10.10.1.22:8080
          +--> 10.10.1.23:8080
```

Nginx tidak hanya meneruskan ke satu host. Ia memilih salah satu peer dari group upstream.

---

### 1.3 Boundary yang Harus Kamu Pahami

`upstream` berada di antara dua dunia:

```text
Client-facing side                      Upstream-facing side
------------------                      --------------------
Browser / mobile / API client  --->     Java application instances
TLS / HTTP/2 / public network           HTTP/1.1 / internal network
untrusted traffic                       trusted-ish service network
many slow clients                       fewer backend connections
edge timeout                            app timeout / DB timeout
```

Nginx menjadi boundary yang mengubah karakteristik traffic.

Misalnya:

- client bisa lambat membaca response;
- Nginx bisa buffering response dari Java app;
- Java app selesai cepat karena response sudah diterima Nginx;
- client masih membaca pelan-pelan dari Nginx;
- upstream connection bisa dilepas lebih cepat.

Tanpa Nginx, slow client dapat menahan thread/socket aplikasi lebih lama. Dengan Nginx, efeknya bisa dikurangi, tergantung konfigurasi buffering dan streaming.

---

## 2. Baseline Konfigurasi `upstream`

### 2.1 Minimal Upstream

```nginx
http {
    upstream app_backend {
        server 127.0.0.1:8081;
        server 127.0.0.1:8082;
    }

    server {
        listen 80;

        location / {
            proxy_pass http://app_backend;
        }
    }
}
```

Default algorithm adalah round-robin.

Maknanya:

```text
request 1 -> 127.0.0.1:8081
request 2 -> 127.0.0.1:8082
request 3 -> 127.0.0.1:8081
request 4 -> 127.0.0.1:8082
```

Tapi hati-hati: “request” di sini bukan berarti pasti sempurna bergantian dalam semua situasi. Worker process, keepalive, failure state, retry, dan dynamic connection behavior dapat membuat observasi di log tidak selalu terlihat seperti pola matematis sederhana.

---

### 2.2 Named Upstream Lebih Baik Daripada Hardcoded `proxy_pass`

Kurang ideal:

```nginx
location /api/ {
    proxy_pass http://10.0.1.10:8080;
}
```

Lebih maintainable:

```nginx
upstream api_backend {
    server 10.0.1.10:8080;
}

location /api/ {
    proxy_pass http://api_backend;
}
```

Kenapa?

Karena `upstream` memberi tempat eksplisit untuk:

- menambah instance;
- memberi weight;
- mengatur failure behavior;
- mengatur keepalive;
- mendokumentasikan pool;
- memisahkan routing rule dari backend topology.

Secara desain, ini lebih mirip dependency abstraction.

```text
location /api/ depends on logical backend "api_backend"
api_backend resolves to one or more physical backend peers
```

---

## 3. Load Balancing Algorithms

Nginx Open Source menyediakan beberapa metode umum untuk HTTP upstream:

- round robin;
- least connections;
- IP hash;
- generic hash;
- random, tergantung versi/module.

Kita bahas yang paling relevan untuk engineer backend Java.

---

## 4. Round Robin

### 4.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    server app-1.internal:8080;
    server app-2.internal:8080;
    server app-3.internal:8080;
}
```

Tidak perlu directive khusus. Ini default.

---

### 4.2 Mental Model

Round robin memilih server berikutnya secara bergiliran.

```text
r1 -> app-1
r2 -> app-2
r3 -> app-3
r4 -> app-1
r5 -> app-2
r6 -> app-3
```

Keunggulan:

- sederhana;
- predictable;
- cocok untuk backend stateless;
- cocok kalau semua instance relatif homogen;
- konfigurasi minimal.

Kelemahan:

- tidak tahu beban real-time tiap instance;
- tidak tahu request mana berat/ringan;
- tidak tahu thread pool saturation;
- tidak tahu database query sedang lambat;
- tidak ideal untuk workload yang request duration-nya sangat bervariasi.

---

### 4.3 Round Robin dan Java Backend

Round robin cocok jika instance Java kamu:

- stateless;
- punya kapasitas serupa;
- versi aplikasi serupa;
- konfigurasi JVM serupa;
- GC behavior serupa;
- koneksi database pool serupa;
- tidak menyimpan session lokal.

Contoh bagus:

```text
Spring Boot API service
  - JWT stateless auth
  - Redis/database for shared state
  - identical container resource limits
  - same JVM flags
  - same version
```

Contoh kurang cocok:

```text
Java monolith
  - HTTP session stored in local memory
  - background jobs only on some nodes
  - node A has 4 CPU, node B has 2 CPU
  - node C runs newer build
```

Dalam kondisi kedua, round robin bisa menutupi masalah desain sampai traffic meningkat.

---

## 5. Weighted Round Robin

### 5.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    server app-1.internal:8080 weight=5;
    server app-2.internal:8080 weight=3;
    server app-3.internal:8080 weight=1;
}
```

Makna kasar:

```text
app-1 menerima proporsi lebih besar
app-2 menerima proporsi sedang
app-3 menerima proporsi kecil
```

Jika total weight = 5 + 3 + 1 = 9, maka secara kasar:

```text
app-1: 5/9 traffic
app-2: 3/9 traffic
app-3: 1/9 traffic
```

---

### 5.2 Kapan Weight Berguna?

Weight berguna ketika backend tidak homogen.

Contoh:

```text
app-1: 8 vCPU, 16 GB RAM
app-2: 8 vCPU, 16 GB RAM
app-3: 2 vCPU, 4 GB RAM
```

Maka:

```nginx
upstream app_backend {
    server app-1.internal:8080 weight=4;
    server app-2.internal:8080 weight=4;
    server app-3.internal:8080 weight=1;
}
```

Atau untuk canary ringan:

```nginx
upstream app_backend {
    server app-stable-1.internal:8080 weight=49;
    server app-stable-2.internal:8080 weight=49;
    server app-canary-1.internal:8080 weight=2;
}
```

Tapi untuk canary production serius, weight upstream saja sering tidak cukup. Kamu juga butuh:

- observability per version;
- rollback cepat;
- error budget;
- traffic segmentation;
- header/cookie routing;
- deployment orchestration.

Nginx bisa membantu, tetapi bukan deployment platform lengkap.

---

### 5.3 Weight Bukan Capacity Guarantee

Weight bukan berarti app pasti mampu menanggung proporsi tersebut.

Misalnya:

```text
app-1 weight=5
app-2 weight=1
```

Tapi jika app-1 mengalami GC pause panjang, weight tidak otomatis turun. Nginx Open Source tidak memahami GC, heap pressure, lock contention, queue depth, atau DB pool saturation.

Karena itu, weight harus didukung oleh observability:

- p95/p99 latency per upstream;
- error rate per upstream;
- active connections;
- JVM CPU;
- GC pause;
- thread pool saturation;
- DB connection pool usage.

---

## 6. Least Connections

### 6.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    least_conn;

    server app-1.internal:8080;
    server app-2.internal:8080;
    server app-3.internal:8080;
}
```

---

### 6.2 Mental Model

`least_conn` memilih backend dengan jumlah active connection paling sedikit.

```text
app-1 active connections: 120
app-2 active connections:  40
app-3 active connections:  85

next request -> app-2
```

Ini lebih adaptif daripada round robin untuk request yang durasinya berbeda-beda.

---

### 6.3 Kapan `least_conn` Cocok?

Cocok untuk:

- long polling;
- file download;
- request yang durasinya variatif;
- API dengan beberapa endpoint berat;
- backend yang relatif homogen tetapi request time tidak homogen.

Contoh:

```text
/api/products         30 ms
/api/orders          120 ms
/api/reports/export   60 s
/api/stream/events    long-lived
```

Dengan round robin, node yang kebetulan menerima banyak export/stream bisa lebih terbebani. `least_conn` dapat mengurangi imbalance karena node dengan koneksi aktif banyak akan lebih jarang dipilih.

---

### 6.4 Kelemahan `least_conn`

`least_conn` tidak selalu lebih baik.

Ia melihat connection count, bukan real cost.

Misalnya:

```text
app-1: 10 active requests, semuanya CPU-heavy
app-2: 50 active requests, semuanya mostly idle SSE
```

`least_conn` mungkin memilih app-1 karena koneksinya lebih sedikit, padahal app-1 lebih panas CPU-nya.

Atau:

```text
app-1: 5 active requests, semua menunggu database lock
app-2: 30 active requests, semua cepat
```

Nginx tidak tahu itu.

Jadi `least_conn` adalah sinyal parsial, bukan load oracle.

---

## 7. IP Hash

### 7.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    ip_hash;

    server app-1.internal:8080;
    server app-2.internal:8080;
    server app-3.internal:8080;
}
```

Dengan `ip_hash`, IP client digunakan sebagai key untuk memilih backend. Request dari IP yang sama cenderung diarahkan ke backend yang sama selama backend tersebut tersedia.

---

### 7.2 Kenapa Orang Menggunakan IP Hash?

Biasanya untuk sticky session.

Misalnya aplikasi Java masih menyimpan session di memory lokal:

```text
user A login -> app-2
session user A stored in app-2 memory
next request user A must go to app-2
```

Kalau round robin:

```text
request login -> app-2
request profile -> app-1
app-1 tidak punya session -> user dianggap logout
```

IP hash mencoba mengurangi masalah itu:

```text
client IP 203.0.113.10 -> app-2
all requests from 203.0.113.10 -> app-2
```

---

### 7.3 Masalah Besar IP Hash

IP hash terlihat sederhana, tetapi punya banyak trap.

#### 7.3.1 NAT dan Corporate Network

Banyak user bisa muncul dari IP publik yang sama.

```text
1000 users behind office NAT -> same public IP -> same backend
```

Akibatnya:

```text
app-1: overloaded
app-2: idle
app-3: idle
```

#### 7.3.2 Mobile Network

IP client bisa berubah.

```text
user switches tower/network
old IP -> app-1
new IP -> app-3
session lost if stored locally
```

#### 7.3.3 Proxy/CDN di Depan Nginx

Jika Nginx melihat IP CDN/load balancer, bukan IP end-user, maka semua request bisa hash ke sedikit backend.

```text
client -> CDN -> Nginx -> app

Nginx sees CDN IP, not original client IP
```

Kamu bisa memperbaiki real client IP dengan `real_ip_header` dan trusted proxy config, tapi itu harus hati-hati karena spoofing.

#### 7.3.4 Scaling Mengubah Distribusi

Menambah atau menghapus backend dapat mengubah mapping IP ke backend. Efeknya bisa membuat banyak session pindah node.

---

### 7.4 Rekomendasi Untuk Aplikasi Java

Untuk sistem modern, jangan jadikan IP hash sebagai solusi utama state management.

Lebih baik:

```text
Auth/session state:
  - JWT stateless, atau
  - centralized session store seperti Redis, atau
  - database/shared store, atau
  - external identity provider
```

IP hash masih bisa dipakai sebagai mitigasi sementara, tetapi jangan dijadikan fondasi arsitektur jangka panjang.

Prinsipnya:

> Load balancer affinity should not be the only thing keeping your application correct.

---

## 8. Generic Hash

### 8.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    hash $request_uri consistent;

    server app-1.internal:8080;
    server app-2.internal:8080;
    server app-3.internal:8080;
}
```

Atau berdasarkan header:

```nginx
upstream tenant_backend {
    hash $http_x_tenant_id consistent;

    server app-1.internal:8080;
    server app-2.internal:8080;
    server app-3.internal:8080;
}
```

---

### 8.2 Kapan Hash Berguna?

Hash berguna saat kamu ingin routing stabil berdasarkan key tertentu:

- tenant id;
- user id;
- request URI;
- API key;
- shard key;
- custom header.

Contoh penggunaan:

```text
Tenant A -> app-1
Tenant B -> app-2
Tenant C -> app-3
```

Tapi hati-hati: ini bisa membuat hotspot.

Jika tenant A jauh lebih besar dari tenant lain:

```text
Tenant A -> app-1 -> overloaded
Tenant B -> app-2 -> normal
Tenant C -> app-3 -> normal
```

Hash bukan distribusi load sempurna. Hash adalah distribusi berdasarkan key.

---

### 8.3 Consistent Hash

`consistent` membantu mengurangi remapping saat backend ditambah/dikurangi.

Tanpa consistent hash, perubahan jumlah server bisa mengubah banyak mapping key.

Dengan consistent hash, perpindahan key lebih terbatas.

Mental model:

```text
keys distributed on hash ring
backend nodes occupy points on ring
when one node removed, mostly keys near that node move
```

Ini berguna untuk cache locality atau shard-like routing.

Tetapi tetap bukan pengganti desain data partitioning yang matang.

---

## 9. Random Load Balancing

Pada versi Nginx modern, ada dukungan random load balancing dalam upstream module. Bentuknya bisa seperti:

```nginx
upstream app_backend {
    random two least_conn;

    server app-1.internal:8080;
    server app-2.internal:8080;
    server app-3.internal:8080;
    server app-4.internal:8080;
}
```

Konsep `random two least_conn` mirip “power of two choices”:

1. pilih dua server secara random;
2. dari dua itu, pilih yang active connection-nya lebih sedikit.

Ini bisa memberi hasil baik pada pool besar karena mengurangi overhead scanning semua peer sekaligus tetap menghindari server yang sedang sangat sibuk.

Namun untuk seri ini, fokus utama tetap round robin, least_conn, hash, dan operational behavior, karena itu yang paling sering dipakai dan paling penting untuk dikuasai.

---

## 10. Server Parameters

`server` di dalam `upstream` dapat memiliki parameter.

Contoh:

```nginx
upstream app_backend {
    server app-1.internal:8080 weight=3 max_fails=2 fail_timeout=10s;
    server app-2.internal:8080 weight=3 max_fails=2 fail_timeout=10s;
    server app-3.internal:8080 backup;
}
```

Mari kita bedah.

---

## 11. `weight`

Sudah dibahas di atas.

```nginx
server app-1.internal:8080 weight=5;
server app-2.internal:8080 weight=1;
```

Gunakan untuk:

- instance berbeda kapasitas;
- traffic shaping sederhana;
- canary kasar;
- migration bertahap.

Jangan gunakan untuk:

- menutupi node yang unhealthy;
- mengatur fairness tenant kompleks;
- menggantikan autoscaling;
- menggantikan health signal.

---

## 12. `max_fails` dan `fail_timeout`

### 12.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    server app-1.internal:8080 max_fails=3 fail_timeout=10s;
    server app-2.internal:8080 max_fails=3 fail_timeout=10s;
}
```

Secara sederhana:

- `max_fails` menentukan berapa kali kegagalan boleh terjadi;
- `fail_timeout` adalah window waktu untuk menghitung kegagalan dan durasi server dianggap unavailable.

Jika server gagal `max_fails` kali dalam rentang `fail_timeout`, Nginx akan menganggap server tersebut unavailable sementara.

---

### 12.2 Failure Apa yang Dihitung?

Failure tergantung jenis event dan directive terkait, terutama saat proxying.

Contoh failure yang umum:

- connection refused;
- connection timeout;
- read timeout;
- invalid response;
- upstream closed connection prematurely;
- selected HTTP status jika dikombinasikan dengan `proxy_next_upstream` tertentu.

Penting:

> `max_fails` bukan active health check. Itu passive failure detection berdasarkan request nyata.

Artinya Nginx Open Source secara default baru tahu server bermasalah ketika ada request yang gagal terhadap server itu.

---

### 12.3 Passive Health Check vs Active Health Check

Passive:

```text
Nginx sends real request -> fails -> record failure
```

Active:

```text
Nginx periodically probes /health -> marks server healthy/unhealthy
```

Nginx Open Source punya passive failure handling. Active health checks secara resmi adalah fitur NGINX Plus untuk HTTP upstream. Dalam ekosistem Kubernetes, health checking biasanya dilakukan oleh readiness/liveness probe dan Service/Endpoint routing, bukan Nginx Open Source upstream active probe langsung.

Konsekuensi:

```text
Open Source Nginx upstream alone:
  - can react to failures observed from user traffic
  - does not continuously probe every backend by default

Kubernetes / orchestrator:
  - can remove unready pods from Service endpoints
  - can restart failed containers
  - can gate traffic via readiness
```

---

### 12.4 Trap: Single Server Upstream

Jika upstream hanya punya satu server, failure parameters tidak memberi manfaat load balancing.

```nginx
upstream app_backend {
    server app-1.internal:8080 max_fails=3 fail_timeout=10s;
}
```

Kalau hanya ada satu backend, Nginx tidak punya alternatif untuk dialihkan. Dalam praktik, kamu tetap akan melihat error jika backend itu gagal.

---

## 13. `backup`

### 13.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    server app-1.internal:8080;
    server app-2.internal:8080;
    server app-standby.internal:8080 backup;
}
```

`backup` server hanya digunakan saat primary servers unavailable.

---

### 13.2 Kapan Berguna?

Bisa berguna untuk:

- maintenance fallback;
- degraded read-only service;
- legacy fallback;
- emergency static responder;
- warm standby.

Contoh arsitektur:

```text
primary app nodes fail
  -> backup app returns limited response
  -> user gets degraded experience, not hard outage
```

Misalnya backup service hanya menampilkan:

```json
{
  "status": "degraded",
  "message": "Order service is temporarily unavailable. Please retry later."
}
```

Namun jangan membuat backup yang diam-diam menulis data ke sistem berbeda tanpa konsistensi jelas. Itu bisa menciptakan split-brain behavior.

---

## 14. `down`

### 14.1 Bentuk Konfigurasi

```nginx
upstream app_backend {
    server app-1.internal:8080;
    server app-2.internal:8080 down;
    server app-3.internal:8080;
}
```

`down` menandai server tidak tersedia secara manual.

---

### 14.2 Kapan Berguna?

- maintenance manual;
- node sedang diinvestigasi;
- mengeluarkan backend dari rotasi tanpa menghapus konfigurasinya;
- rollback bertahap.

Namun di deployment modern, ini sering kalah praktis dibanding orchestrator/service discovery.

Jika kamu harus edit config manual untuk mengeluarkan node, tanyakan:

> Kenapa lifecycle backend belum dikelola oleh deployment platform?

---

## 15. Upstream Keepalive

### 15.1 Masalah Tanpa Keepalive

Tanpa upstream keepalive, Nginx bisa membuka koneksi baru ke backend untuk banyak request.

```text
request -> TCP connect -> send HTTP -> receive response -> close
request -> TCP connect -> send HTTP -> receive response -> close
request -> TCP connect -> send HTTP -> receive response -> close
```

Biayanya:

- TCP handshake;
- TLS handshake jika upstream HTTPS;
- kernel overhead;
- backend accept overhead;
- lebih banyak ephemeral port usage;
- latency tambahan.

Untuk Java app yang menerima ribuan request per detik, churn koneksi bisa signifikan.

---

### 15.2 Mengaktifkan Keepalive

Contoh:

```nginx
upstream app_backend {
    server app-1.internal:8080;
    server app-2.internal:8080;

    keepalive 64;
}

server {
    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_pass http://app_backend;
    }
}
```

Penjelasan penting:

```nginx
proxy_http_version 1.1;
```

HTTP/1.1 dibutuhkan untuk persistent connection ke upstream secara umum.

```nginx
proxy_set_header Connection "";
```

Ini mencegah Nginx mengirim header `Connection: close` ke upstream.

```nginx
keepalive 64;
```

Ini menentukan jumlah idle keepalive connections yang disimpan per worker process untuk upstream tersebut.

---

### 15.3 `keepalive` Bukan Total Connection Limit

Ini sangat penting.

`keepalive 64` bukan berarti maksimal 64 koneksi total ke upstream.

Ia berarti kira-kira:

```text
up to 64 idle reusable connections per worker process kept in cache
```

Active connections bisa lebih banyak.

Jika kamu punya:

```text
worker_processes = 4
upstream keepalive = 64
```

Maka idle cached upstream connections bisa sampai sekitar:

```text
4 * 64 = 256 idle connections
```

per upstream group, tergantung runtime behavior.

Kalau backend Java punya connection accept/thread constraint ketat, perhatikan ini.

---

### 15.4 Hubungan Dengan Java Thread Pool

Misalkan Spring Boot Tomcat:

```properties
server.tomcat.threads.max=200
server.tomcat.accept-count=100
```

Lalu Nginx:

```nginx
worker_processes auto;

upstream app_backend {
    server app-1:8080;
    server app-2:8080;
    keepalive 256;
}
```

Jika worker banyak dan keepalive besar, jumlah idle connection dari Nginx ke aplikasi bisa terlihat besar. Biasanya idle connection tidak sama dengan active request thread, tetapi tetap mengonsumsi socket/file descriptor dan bisa memengaruhi observability.

Kamu harus membedakan:

```text
TCP connection open
HTTP request active
Java thread processing request
DB connection checked out
```

Mereka bukan hal yang sama.

---

### 15.5 Kapan Keepalive Harus Dipakai?

Umumnya sangat dianjurkan untuk:

- high RPS API;
- upstream internal network;
- TLS upstream;
- microservices dengan latency budget ketat;
- Java apps yang menerima banyak short requests.

Tapi harus disizing dengan benar.

Checklist:

- backend max connections cukup?
- file descriptor cukup?
- idle timeout sinkron?
- load balancer/cloud proxy di tengah tidak memotong koneksi terlalu agresif?
- Java server keepalive timeout cocok?
- apakah upstream connection reuse mengganggu rolling deployment drain?

---

## 16. Client Keepalive vs Upstream Keepalive

Jangan campur dua hal ini.

```text
Client <---- keepalive A ----> Nginx <---- keepalive B ----> Java backend
```

Client keepalive:

```nginx
keepalive_timeout 65;
```

Ini mengatur koneksi client ke Nginx.

Upstream keepalive:

```nginx
upstream app_backend {
    keepalive 64;
}
```

Ini mengatur koneksi idle dari Nginx ke backend.

Mereka independent.

Satu koneksi client tidak sama dengan satu koneksi upstream secara permanen.

Nginx bisa:

- menerima banyak request dari client connection yang sama;
- membuka/reuse upstream connection berbeda;
- buffering response;
- melepaskan upstream lebih cepat daripada client selesai membaca.

---

## 17. Failure Behavior: Mati, Lambat, atau Setengah Rusak

Load balancing tidak hanya tentang pembagian traffic. Ia juga tentang failure containment.

Ada beberapa tipe failure backend.

---

### 17.1 Hard Down

Backend mati total.

```text
Nginx -> app-1:8080
TCP connection refused
```

Gejala:

- 502 Bad Gateway;
- error log connection refused;
- upstream marked failed jika mencapai threshold;
- request bisa dicoba ke upstream lain tergantung `proxy_next_upstream`.

Ini relatif mudah dideteksi.

---

### 17.2 Slow Down

Backend masih menerima connection, tetapi lambat menjawab.

```text
Nginx connects successfully
Nginx sends request
Backend responds after 60 seconds
```

Gejala:

- 504 Gateway Timeout jika melewati `proxy_read_timeout`;
- rising upstream response time;
- Tomcat threads saturated;
- DB pool exhausted;
- GC pause;
- lock contention.

Ini lebih berbahaya daripada hard down, karena server terlihat “hidup” tetapi menyerap request dan membuat tail latency naik.

---

### 17.3 Partial Failure

Beberapa endpoint gagal, endpoint lain normal.

```text
GET /health       -> 200
GET /products     -> 200
POST /checkout    -> 500
GET /reports      -> timeout
```

Passive upstream failure detection mungkin tidak cukup pintar untuk membedakan endpoint-specific failure.

Jika satu endpoint berat gagal, Nginx bisa tetap menganggap backend sehat karena endpoint lain sukses.

Aplikasi harus punya observability per endpoint dan readiness signal yang meaningful.

---

### 17.4 Gray Failure

Server tidak sepenuhnya mati, tapi performanya buruk secara halus.

Contoh:

- satu node punya DNS resolver lambat;
- satu node kehilangan connection ke Redis;
- satu node mengalami minor GC terus-menerus;
- satu node punya noisy neighbor;
- satu pod terkena CPU throttling;
- satu instance punya config salah.

Nginx Open Source tidak akan otomatis memahami semua ini.

Kamu perlu:

- metrics per upstream peer;
- application health detail;
- readiness probe yang tidak terlalu dangkal;
- circuit breaker/app-level resilience;
- deployment automation.

---

## 18. Retry Behavior Dengan `proxy_next_upstream`

### 18.1 Basic Idea

Saat request ke upstream gagal, Nginx dapat mencoba upstream berikutnya.

Contoh:

```nginx
location /api/ {
    proxy_next_upstream error timeout http_502 http_503 http_504;
    proxy_pass http://app_backend;
}
```

Maknanya: jika terjadi error/timeout atau status tertentu, Nginx boleh mencoba server lain.

---

### 18.2 Retry Bisa Menolong

Kasus yang cocok:

```text
request -> app-1 connection refused
retry -> app-2 success
```

User tidak melihat error.

Ini bagus untuk failure transient seperti:

- backend restart;
- rolling deployment;
- connection refused;
- satu node down;
- temporary network blip.

---

### 18.3 Retry Bisa Berbahaya

Retry juga bisa menggandakan beban.

Misalnya semua backend lambat karena database overload:

```text
request -> app-1 waits DB -> timeout
retry -> app-2 waits same DB -> timeout
retry -> app-3 waits same DB -> timeout
```

Satu request client menjadi tiga request backend.

Akibat:

```text
incoming RPS: 1000
retry factor: 3
backend effective RPS: 3000
shared DB already overloaded -> collapse faster
```

Ini retry storm.

---

### 18.4 Idempotency Matters

Retry aman atau tidak tergantung operasi.

Relatif aman:

```text
GET /products/123
GET /catalog/search?q=x
GET /health
```

Berbahaya:

```text
POST /payments
POST /orders
POST /transfer
PATCH /account/balance
```

Jika Nginx retry POST setelah upstream menerima request tetapi response gagal dikirim, bisa terjadi duplicate side effect.

Contoh:

```text
Nginx sends POST /orders to app-1
app-1 creates order in DB
app-1 crashes before sending response
Nginx retries to app-2
app-2 creates second order
```

Karena itu, untuk operation non-idempotent, aplikasi harus punya:

- idempotency key;
- deduplication;
- transactional boundary;
- safe retry semantics;
- exactly-once expectation yang realistis.

Nginx tidak bisa menyelesaikan correctness problem ini sendiri.

---

### 18.5 Practical Retry Policy

Contoh pendekatan lebih aman:

```nginx
location /api/ {
    proxy_next_upstream error timeout http_502 http_503 http_504;
    proxy_next_upstream_tries 2;
    proxy_next_upstream_timeout 3s;
    proxy_pass http://app_backend;
}
```

Prinsip:

- batasi jumlah retry;
- batasi total waktu retry;
- jangan retry terlalu agresif;
- selaraskan dengan timeout aplikasi;
- pahami endpoint idempotency;
- observability retry harus jelas.

Untuk endpoint pembayaran/order, lebih baik pertimbangkan route khusus:

```nginx
location /api/payments/ {
    proxy_next_upstream error timeout;
    proxy_next_upstream_tries 1;
    proxy_pass http://payment_backend;
}
```

`tries 1` berarti tidak mencoba upstream berikutnya setelah attempt pertama.

---

## 19. Load Balancing dan Session State

### 19.1 Stateless Backend Adalah Default Target

Arsitektur paling sehat untuk load balancing:

```text
Nginx -> any app instance -> same behavior
```

Artinya:

- auth token bisa diverifikasi semua node;
- session shared atau stateless;
- upload state tidak lokal tanpa koordinasi;
- cache lokal bukan sumber kebenaran;
- background state tidak memengaruhi request correctness.

Jika request user bisa dikirim ke node mana pun dan tetap benar, load balancing menjadi jauh lebih sederhana.

---

### 19.2 Stateful Backend Membuat Load Balancer Ikut Menanggung Correctness

Jika state lokal:

```text
session stored in app memory
shopping cart stored in local cache
temporary upload stored in local disk
workflow lock stored in local map
```

Maka load balancer harus “ingat” routing.

Itu membuat arsitektur rapuh:

- node restart = session hilang;
- scaling = mapping berubah;
- failover = user pindah node dan kehilangan state;
- blue-green = state bisa berada di versi lama;
- debugging = request behavior tergantung node.

Untuk sistem enforcement/case management/regulatory workflow, ini berbahaya karena correctness dan auditability lebih penting daripada sekadar convenience.

State penting harus jelas ownership-nya:

```text
Durable state         -> database/event store
Session/token state   -> stateless JWT or centralized session
Workflow state        -> durable state machine
Distributed locks     -> explicit lock service/database semantics
Local cache           -> optimization only
```

---

## 20. Load Balancing dan Transaction Boundary

Nginx memilih backend sebelum aplikasi memproses request.

Nginx tidak tahu:

- request akan membuka transaksi DB atau tidak;
- request akan acquire lock atau tidak;
- request akan publish event atau tidak;
- request akan menulis audit log atau tidak;
- request akan memanggil service lain atau tidak.

Karena itu, jangan letakkan asumsi bisnis di load balancer.

Contoh asumsi buruk:

```text
“All approval requests for case X should go to the same app node so local lock works.”
```

Lebih benar:

```text
“All approval requests for case X must be serialized by durable lock/state transition rule at application/database level.”
```

Nginx boleh membantu routing, tetapi correctness workflow harus tetap berada di domain/application/data layer.

---

## 21. DNS Dalam Upstream

### 21.1 Static Hostname Resolution

Jika kamu menulis:

```nginx
upstream app_backend {
    server app-1.internal:8080;
    server app-2.internal:8080;
}
```

Nginx resolve hostname pada waktu tertentu, biasanya saat startup/reload untuk konfigurasi static. Perubahan DNS tidak selalu otomatis diikuti seperti yang banyak engineer harapkan.

Implikasi:

```text
DNS record berubah
Nginx belum reload
Nginx masih memakai IP lama
```

---

### 21.2 Service Discovery Trap

Di environment dinamis seperti Kubernetes, backend pod berubah terus.

Jangan sembarangan memasukkan pod DNS langsung ke static upstream dan berharap Nginx otomatis mengikuti semua perubahan.

Lebih umum:

```text
Nginx -> Kubernetes Service ClusterIP -> pods
```

atau gunakan ingress controller yang memang mengelola endpoint update.

---

### 21.3 Resolver dan Variable `proxy_pass`

Ada pola menggunakan variable dalam `proxy_pass` agar DNS resolve runtime:

```nginx
resolver 10.96.0.10 valid=10s;

set $backend "app-service.default.svc.cluster.local:8080";

location /api/ {
    proxy_pass http://$backend;
}
```

Tapi ini punya konsekuensi:

- behavior URI handling berbeda saat `proxy_pass` memakai variable;
- debugging lebih sulit;
- DNS menjadi dependency runtime;
- resolver timeout bisa memengaruhi traffic;
- cache DNS harus dipahami.

Untuk production, gunakan pola ini hanya jika kamu benar-benar memahami trade-off-nya.

---

## 22. Upstream Zone dan Shared State

Dalam beberapa konfigurasi, kamu akan melihat:

```nginx
upstream app_backend {
    zone app_backend_zone 64k;

    server app-1.internal:8080;
    server app-2.internal:8080;
}
```

`zone` menyediakan shared memory untuk upstream group agar state tertentu dapat dibagi antar worker process.

Kenapa ini penting?

Tanpa shared state, beberapa informasi runtime bisa bersifat per-worker. Dalam sistem multi-worker, worker yang berbeda bisa punya observasi failure yang berbeda.

Namun detail fitur yang bergantung pada `zone` berbeda antara Nginx Open Source dan NGINX Plus. Jadi jangan copy-paste `zone` tanpa memahami apakah module/fitur yang kamu pakai memang memanfaatkannya.

Mental model cukup:

```text
worker-1 observes peer failure
worker-2 may not have identical runtime state unless shared state exists
```

Di production high traffic, per-worker behavior dapat memengaruhi distribusi dan failure reaction.

---

## 23. Observability Untuk Upstream

Jika kamu hanya melihat total request, kamu buta.

Minimal log format harus memasukkan upstream info.

Contoh:

```nginx
log_format upstream_json escape=json
'{'
  '"time":"$time_iso8601",'
  '"remote_addr":"$remote_addr",'
  '"request":"$request",'
  '"status":$status,'
  '"body_bytes_sent":$body_bytes_sent,'
  '"request_time":$request_time,'
  '"upstream_addr":"$upstream_addr",'
  '"upstream_status":"$upstream_status",'
  '"upstream_connect_time":"$upstream_connect_time",'
  '"upstream_header_time":"$upstream_header_time",'
  '"upstream_response_time":"$upstream_response_time",'
  '"request_id":"$request_id"'
'}';

access_log /var/log/nginx/access.log upstream_json;
```

Field penting:

```text
$upstream_addr
```

Backend yang dipilih. Jika retry terjadi, bisa berisi beberapa alamat.

```text
$upstream_status
```

Status dari upstream. Jika retry terjadi, bisa berisi beberapa status.

```text
$upstream_connect_time
```

Waktu connect ke upstream.

```text
$upstream_header_time
```

Waktu sampai header response diterima.

```text
$upstream_response_time
```

Waktu sampai response upstream selesai diterima.

```text
$request_time
```

Total waktu request dari sisi Nginx, termasuk client interaction.

---

## 24. Cara Membaca Log Upstream

Contoh log konseptual:

```json
{
  "status": 200,
  "request_time": 0.120,
  "upstream_addr": "10.0.1.11:8080",
  "upstream_status": "200",
  "upstream_connect_time": "0.002",
  "upstream_header_time": "0.080",
  "upstream_response_time": "0.118"
}
```

Interpretasi:

```text
connect cepat
backend mulai memberi header dalam 80 ms
response selesai 118 ms
request total 120 ms
```

Backend kemungkinan dominan di latency.

---

Contoh retry:

```json
{
  "status": 200,
  "request_time": 1.240,
  "upstream_addr": "10.0.1.10:8080, 10.0.1.11:8080",
  "upstream_status": "504, 200",
  "upstream_connect_time": "0.001, 0.002",
  "upstream_header_time": "1.000, 0.100",
  "upstream_response_time": "1.000, 0.110"
}
```

Interpretasi:

```text
first upstream timed out / failed
second upstream succeeded
user saw 200 but latency includes failed attempt
```

Kalau kamu hanya lihat final status `200`, kamu melewatkan failure tersembunyi.

---

## 25. Metrics Yang Harus Dipantau

Untuk upstream/load balancing, pantau:

### Dari Nginx

- request rate per upstream group;
- status code per upstream;
- 502/503/504 rate;
- 499 rate;
- upstream response time p50/p95/p99;
- upstream connect time;
- retry count;
- bytes sent/received;
- active connections;
- error log pattern.

### Dari Java App

- HTTP server request duration;
- Tomcat/Jetty/Netty active connections;
- Tomcat thread pool active/busy/max;
- queue length;
- JVM CPU;
- heap usage;
- GC pause;
- DB connection pool active/idle/pending;
- error rate per endpoint;
- request count per instance;
- readiness state.

### Dari Infrastruktur

- CPU throttling;
- network errors;
- DNS failures;
- pod/container restarts;
- node pressure;
- load balancer health;
- security group/firewall rejects.

---

## 26. Capacity Thinking

Misalkan:

```text
incoming traffic: 3000 RPS
3 backend instances
round robin
```

Kamu mungkin berharap:

```text
1000 RPS per instance
```

Tapi realita tergantung:

- request mix;
- long-lived connections;
- retries;
- keepalive;
- worker distribution;
- upstream failures;
- GC pause;
- DB bottleneck;
- cache hit/miss;
- client behavior.

### 26.1 Simple Capacity Model

Misalkan satu Java instance aman di:

```text
sustainable RPS: 800
p95 target: < 200 ms
CPU target: < 70%
DB pool saturation: < 80%
```

Dengan 3 instance:

```text
theoretical capacity = 3 * 800 = 2400 RPS
```

Tapi production safe capacity jangan 2400.

Berikan headroom untuk:

- one instance down;
- traffic spike;
- retry overhead;
- GC variation;
- deployment rolling update;
- noisy neighbor;
- cache cold start.

Jika harus survive one instance down:

```text
available instances during failure = 2
safe capacity = 2 * 800 = 1600 RPS
```

Lalu beri margin:

```text
operational target maybe 1200-1400 RPS
```

Load balancer tidak menciptakan kapasitas. Ia hanya mendistribusikan beban ke kapasitas yang sudah ada.

---

## 27. Deployment Interaction

### 27.1 Rolling Restart

Saat rolling deploy Java app:

```text
app-1 stopping
app-2 running
app-3 running
```

Jika Nginx masih mengirim request ke app-1 saat app-1 shutdown, kamu bisa melihat:

- connection refused;
- 502;
- incomplete response;
- long request terminated;
- WebSocket dropped.

Solusi bukan hanya Nginx. Perlu koordinasi lifecycle:

```text
1. mark instance unready
2. stop receiving new traffic
3. wait drain period
4. finish in-flight requests
5. shutdown app gracefully
6. terminate process/container
```

Untuk Spring Boot/Tomcat, aktifkan graceful shutdown di aplikasi dan gunakan readiness probe yang benar.

---

### 27.2 Nginx Reload Saat Upstream Berubah

Jika upstream static config berubah, reload diperlukan.

```bash
nginx -t
nginx -s reload
```

Atau via systemd:

```bash
systemctl reload nginx
```

Reload Nginx bersifat graceful jika config valid:

- master process membaca config baru;
- worker baru dibuat;
- worker lama menyelesaikan existing connections;
- worker lama keluar.

Namun jika config invalid, reload gagal dan worker lama tetap berjalan dengan config lama. Ini bagus untuk safety, tetapi bisa membuat engineer keliru mengira perubahan sudah aktif.

Selalu verifikasi dengan:

```bash
nginx -T | less
```

---

## 28. Design Patterns

### 28.1 Stateless API Pool

```nginx
upstream api_backend {
    least_conn;

    server api-1.internal:8080 max_fails=3 fail_timeout=10s;
    server api-2.internal:8080 max_fails=3 fail_timeout=10s;
    server api-3.internal:8080 max_fails=3 fail_timeout=10s;

    keepalive 128;
}

server {
    listen 443 ssl;
    server_name api.example.com;

    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 3s;

        proxy_pass http://api_backend;
    }
}
```

Cocok untuk:

- stateless REST API;
- mostly homogeneous instances;
- request duration bervariasi;
- high RPS.

Catatan:

- retry dibatasi;
- keepalive aktif;
- headers eksplisit;
- least_conn membantu request duration variance.

---

### 28.2 Session-Affinity Legacy Pool

```nginx
upstream legacy_backend {
    ip_hash;

    server legacy-1.internal:8080 max_fails=2 fail_timeout=10s;
    server legacy-2.internal:8080 max_fails=2 fail_timeout=10s;
}
```

Cocok hanya sebagai transisi untuk aplikasi yang masih menyimpan session lokal.

Risiko:

- NAT hotspot;
- failover session loss;
- scaling remap;
- user behavior sulit diprediksi.

Rekomendasi:

```text
Use this while migrating session state out of local memory.
Do not treat this as final architecture.
```

---

### 28.3 Canary Weight Pool

```nginx
upstream api_backend {
    server api-v1-1.internal:8080 weight=49;
    server api-v1-2.internal:8080 weight=49;
    server api-v2-canary.internal:8080 weight=2;

    keepalive 128;
}
```

Cocok untuk traffic canary sederhana.

Tapi harus dilengkapi:

- log field versi app;
- metrics per version;
- error budget;
- fast rollback;
- synthetic test;
- canary-specific alerting.

---

### 28.4 Degraded Backup

```nginx
upstream api_backend {
    server api-1.internal:8080;
    server api-2.internal:8080;
    server degraded-api.internal:8080 backup;
}
```

Backup bisa melayani response terbatas saat primary down.

Pastikan backup behavior eksplisit dan aman:

- read-only;
- no hidden writes;
- clear degraded response;
- auditable;
- tidak menciptakan data inconsistency.

---

## 29. Anti-Patterns

### 29.1 Menggunakan Load Balancer Untuk Menutupi Aplikasi Tidak Stateless

Buruk:

```text
“Kita pakai ip_hash saja supaya session lokal aman.”
```

Lebih benar:

```text
“Pakai ip_hash sementara, lalu migrasi session ke shared/stateless model.”
```

---

### 29.2 Retry Tanpa Idempotency

Buruk:

```nginx
proxy_next_upstream error timeout http_500 http_502 http_503 http_504;
```

Untuk semua endpoint termasuk payment/order.

Risiko:

- duplicate order;
- duplicate payment;
- double approval;
- inconsistent workflow transition;
- audit log membingungkan.

---

### 29.3 Health Check Dangkal

Buruk:

```text
/health returns 200 if process alive
```

Padahal aplikasi tidak bisa:

- connect database;
- acquire required resources;
- access message broker;
- load critical config;
- serve business requests.

Lebih baik readiness mencerminkan kemampuan menerima traffic, bukan sekadar JVM hidup.

---

### 29.4 Semua Backend Dianggap Sama Padahal Tidak Sama

Buruk:

```nginx
upstream app_backend {
    server old-small-node:8080;
    server new-large-node:8080;
}
```

Tanpa weight, observability, atau capacity planning.

---

### 29.5 Tidak Melog Upstream Peer

Buruk:

```nginx
log_format basic '$remote_addr $request $status $request_time';
```

Kamu tidak tahu backend mana yang lambat/gagal.

Lebih baik memasukkan:

```text
$upstream_addr
$upstream_status
$upstream_response_time
$upstream_connect_time
```

---

## 30. Failure Scenarios

### 30.1 Scenario: Satu Backend Mati

```text
app-1 down
app-2 healthy
app-3 healthy
```

Expected behavior:

- sebagian request awal ke app-1 gagal atau retry;
- Nginx menandai app-1 failed setelah threshold;
- traffic bergeser ke app-2/app-3;
- kapasitas total turun;
- latency bisa naik jika remaining nodes mendekati saturation.

Checklist:

- apakah 502/504 naik?
- apakah retry berhasil?
- apakah app-2/app-3 CPU naik?
- apakah DB pool makin saturasi?
- apakah autoscaling bereaksi?
- apakah alert berbasis user impact aktif?

---

### 30.2 Scenario: Satu Backend Lambat

```text
app-1 still accepts requests but response time 10x slower
```

Gejala:

- p99 naik;
- `$upstream_response_time` tinggi untuk app-1;
- final status mungkin tetap 200;
- user experience buruk;
- Nginx mungkin tidak mengeluarkan app-1 jika tidak timeout/error.

Tindakan:

- identifikasi upstream peer lambat;
- remove from rotation via orchestrator/config;
- cek JVM metrics;
- cek GC, CPU throttling, DB pool, thread dump;
- cek deployment/config drift.

---

### 30.3 Scenario: DB Lambat Semua Backend

```text
all apps depend on same database
DB slow
all app instances slow
```

Retry ke upstream lain tidak menolong.

Malah bisa memperburuk:

```text
one user request -> multiple backend attempts -> more DB pressure
```

Mitigasi:

- reduce retry;
- lower timeout budget;
- shed load;
- rate limit;
- return controlled degradation;
- protect DB;
- circuit breaker at application layer;
- cache if safe.

---

### 30.4 Scenario: NAT Hotspot Dengan IP Hash

```text
large corporate client behind one public IP
ip_hash sends all users to app-2
```

Gejala:

- app-2 overloaded;
- app-1/app-3 idle;
- traffic distribution by request count maybe skewed;
- users from one organization complain.

Solusi:

- avoid IP hash if possible;
- migrate session state;
- use cookie-based affinity if available/appropriate;
- shard by better key if truly needed;
- monitor distribution per upstream.

---

## 31. Java-Specific Considerations

### 31.1 Tomcat Thread Pool

Nginx bisa mengirim lebih banyak concurrent requests daripada Tomcat mampu proses.

Tomcat punya:

- max threads;
- accept queue;
- connection timeout;
- keepalive handling.

Jika Tomcat max threads penuh:

```text
Nginx connects
request queued / delayed
proxy_read_timeout may trigger
Nginx retries elsewhere
more load
```

Pantau:

- `tomcat.threads.busy`;
- `tomcat.threads.current`;
- request queue;
- response time;
- rejected connections.

---

### 31.2 Netty / WebFlux

Untuk reactive stack:

- event loop tidak boleh blocking;
- satu endpoint blocking bisa merusak banyak request;
- upstream least_conn tidak tahu event loop saturation;
- p99 latency harus dipantau ketat.

Jika WebFlux app melakukan blocking DB call di event loop, Nginx hanya melihat backend lambat.

Correctness tetap di aplikasi.

---

### 31.3 JVM GC Pause

Jika satu instance mengalami GC pause:

```text
Nginx -> app-1
TCP connection established
request sent
no response while JVM paused
```

Dari Nginx tampak seperti upstream lambat/time out.

Solusi observability:

- correlate `$upstream_addr` with JVM GC logs/metrics;
- expose instance id in response header/log;
- include pod name / hostname in app logs;
- monitor GC pause per instance.

---

### 31.4 Database Pool Saturation

Java app mungkin punya DB pool:

```text
maxPoolSize=30
```

Jika Nginx mengirim 200 concurrent requests ke satu instance, banyak request bisa menunggu DB connection.

Nginx hanya melihat response lambat.

Aplikasi harus punya:

- bounded concurrency;
- queue timeout;
- DB pool metrics;
- graceful failure;
- bulkhead untuk endpoint berat.

---

## 32. Production Checklist

Sebelum memakai upstream/load balancing di production, pastikan:

### Topology

- [ ] Setiap upstream group punya nama jelas.
- [ ] Backend instances homogen atau weight dijustifikasi.
- [ ] Tidak ada node lama/eksperimen masuk pool tanpa label.
- [ ] Service discovery/reload strategy jelas.

### Algorithm

- [ ] Round robin digunakan untuk stateless homogeneous workload.
- [ ] `least_conn` dipertimbangkan untuk request duration bervariasi.
- [ ] `ip_hash` hanya dipakai jika state/affinity benar-benar dibutuhkan.
- [ ] Hash key dipilih dengan memahami hotspot risk.

### Failure

- [ ] `max_fails` dan `fail_timeout` diset sadar.
- [ ] Retry policy dibatasi.
- [ ] Non-idempotent endpoint tidak diretry sembarangan.
- [ ] Timeout Nginx selaras dengan timeout aplikasi.
- [ ] Readiness/lifecycle backend jelas.

### Connection

- [ ] Upstream keepalive dipakai untuk high RPS jika sesuai.
- [ ] `proxy_http_version 1.1` dan `Connection ""` diset jika perlu.
- [ ] Backend file descriptor cukup.
- [ ] Java server keepalive timeout dipahami.

### Observability

- [ ] Access log mencatat upstream peer.
- [ ] Access log mencatat upstream status/time.
- [ ] Metrics per backend instance tersedia.
- [ ] App instance id bisa dikorelasikan.
- [ ] Retry tersembunyi bisa terlihat.

### Application Correctness

- [ ] Backend stateless atau state shared.
- [ ] Session lokal tidak menjadi dependency correctness.
- [ ] Idempotency key tersedia untuk operasi sensitif.
- [ ] Workflow/business transaction tidak bergantung pada sticky routing.

---

## 33. Debugging Checklist

### Jika Banyak 502

Cek:

```bash
nginx -T | grep -A20 'upstream app_backend'
```

```bash
ss -tnp | grep ':8080'
```

```bash
curl -v http://app-1.internal:8080/health
curl -v http://app-2.internal:8080/health
```

Lihat error log:

```bash
tail -f /var/log/nginx/error.log
```

Cari:

- connection refused;
- no route to host;
- upstream prematurely closed connection;
- invalid header;
- connect timeout.

---

### Jika Banyak 504

Cek:

- `$upstream_response_time`;
- `$upstream_addr`;
- Java thread pool;
- DB pool;
- GC pause;
- external service latency;
- `proxy_read_timeout`.

Pertanyaan kunci:

```text
Apakah semua upstream lambat, atau hanya satu peer?
```

Kalau satu peer:

```text
instance-level issue
```

Kalau semua peer:

```text
shared dependency issue / traffic overload / DB issue
```

---

### Jika Load Tidak Merata

Cek:

- algorithm yang dipakai;
- weight;
- IP hash/NAT;
- long-lived connections;
- worker distribution;
- retry behavior;
- client traffic source;
- CDN/proxy real IP;
- backend capacity mismatch.

---

### Jika User Sering Logout

Cek:

- apakah session lokal?
- apakah round robin aktif?
- apakah IP hash berubah karena real IP salah?
- apakah ada CDN di depan Nginx?
- apakah session cookie domain/path benar?
- apakah aplikasi membaca forwarded proto/host benar?

Solusi jangka panjang:

```text
remove local session dependency
```

---

## 34. Latihan Praktis

### Latihan 1 — Basic Pool

Buat 3 instance Spring Boot sederhana di port:

```text
8081
8082
8083
```

Masing-masing return hostname/instance id:

```json
{
  "instance": "app-1"
}
```

Konfigurasikan:

```nginx
upstream lab_backend {
    server 127.0.0.1:8081;
    server 127.0.0.1:8082;
    server 127.0.0.1:8083;
}

server {
    listen 8080;

    location / {
        proxy_pass http://lab_backend;
    }
}
```

Kirim request:

```bash
for i in {1..20}; do curl -s http://localhost:8080/instance; echo; done
```

Amati distribusi.

---

### Latihan 2 — Least Connection

Tambahkan endpoint lambat:

```text
GET /slow?sleep=5000
```

Jalankan beberapa request slow paralel ke satu instance, lalu test round robin vs least_conn.

Amati apakah least_conn mengurangi pemilihan backend yang punya active request banyak.

---

### Latihan 3 — Retry Visibility

Matikan satu backend.

Konfigurasi log dengan:

```text
$upstream_addr
$upstream_status
$upstream_response_time
```

Aktifkan:

```nginx
proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 2;
```

Amati log saat request final status tetap 200 tetapi upstream pertama gagal.

---

### Latihan 4 — Session Affinity Smell

Buat aplikasi yang menyimpan session lokal di memory.

Test dengan round robin.

Lalu test dengan `ip_hash`.

Catat:

- apakah masalah login hilang?
- apa yang terjadi jika backend target dimatikan?
- apa yang terjadi jika jumlah backend berubah?

Kesimpulan yang diharapkan:

```text
ip_hash can mask the symptom, but does not solve state architecture.
```

---

## 35. Design Exercise Untuk Tech Lead

Kamu punya service Java berikut:

```text
Order Service
- 6 Spring Boot instances
- stateless JWT auth
- PostgreSQL shared database
- Redis cache
- p95 target < 250 ms
- POST /orders must not duplicate
- GET /orders/{id} can be retried
- occasional report endpoint takes 20 seconds
```

Rancang Nginx upstream policy.

Pertanyaan:

1. Algorithm apa yang kamu pilih?
2. Apakah pakai keepalive?
3. Berapa retry tries?
4. Apakah retry policy sama untuk GET dan POST?
5. Apa log field wajib?
6. Apa readiness signal minimal?
7. Apa risiko jika DB lambat?
8. Apa yang harus dilakukan aplikasi untuk idempotency?
9. Bagaimana melakukan rolling deployment aman?
10. Bagaimana mendeteksi satu instance gray failure?

Jawaban yang matang biasanya:

- pakai `least_conn` atau round robin tergantung workload;
- keepalive aktif;
- retry dibatasi;
- POST sensitif tidak diretry tanpa idempotency key;
- log upstream detail;
- readiness bukan sekadar process alive;
- DB bottleneck tidak diselesaikan retry;
- app harus enforce idempotency;
- drain via readiness/graceful shutdown;
- metrics per instance wajib.

---

## 36. Ringkasan Mental Model

`upstream` bukan sekadar daftar server.

Ia adalah tempat di mana Nginx membuat keputusan:

```text
Which backend should receive this request?
What happens if that backend fails?
Should another backend be tried?
Should connections be reused?
Should traffic be sticky?
How visible is the chosen backend in logs?
```

Load balancing yang baik membutuhkan keselarasan antara:

```text
Nginx config
  + application statelessness
  + timeout budget
  + retry semantics
  + backend capacity
  + deployment lifecycle
  + observability
  + data correctness
```

Untuk Java engineer, poin paling penting:

> Nginx can distribute traffic, but it cannot fix unsafe state, unsafe retries, insufficient capacity, poor readiness, or hidden application bottlenecks.

---

## 37. Checklist Pemahaman

Kamu memahami part ini jika bisa menjawab:

- Apa beda round robin, weighted round robin, least_conn, ip_hash, dan hash?
- Kapan IP hash justru berbahaya?
- Kenapa retry bisa membuat outage lebih buruk?
- Kenapa keepalive upstream bukan total connection limit?
- Apa bedanya client keepalive dan upstream keepalive?
- Bagaimana membaca `$upstream_addr` jika terjadi retry?
- Mengapa 200 response masih bisa menyembunyikan upstream failure?
- Apa hubungan load balancing dengan session state?
- Mengapa non-idempotent POST tidak boleh diretry sembarangan?
- Bagaimana membedakan satu instance lambat vs shared dependency lambat?

Jika belum bisa menjawab ini, jangan lanjut ke tuning timeout sebelum mengulang bagian failure dan retry.

---

## 38. Apa Yang Akan Dibahas Di Part Berikutnya

Part berikutnya:

```text
Part 010 — Timeouts, Retries, Buffering, and Backpressure
```

Kita akan masuk lebih dalam ke:

- `proxy_connect_timeout`;
- `proxy_send_timeout`;
- `proxy_read_timeout`;
- `send_timeout`;
- `keepalive_timeout`;
- `proxy_next_upstream`;
- request buffering;
- response buffering;
- streaming;
- backpressure;
- cascading failure;
- timeout budget antara client, Nginx, Java app, database, dan downstream services.

Part 009 memberi kita pool dan failure model. Part 010 akan memberi kita control surface untuk waktu, buffering, dan pressure propagation.

---

## Referensi Utama

- NGINX official documentation — Using nginx as HTTP load balancer: `https://nginx.org/en/docs/http/load_balancing.html`
- NGINX official documentation — `ngx_http_upstream_module`: `https://nginx.org/en/docs/http/ngx_http_upstream_module.html`
- NGINX Admin Guide — HTTP Load Balancing: `https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/`
- NGINX official documentation — Reverse proxy guide: `https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Proxy Header Contract: The Boundary Between Nginx and Application</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-010.md">Part 010 — Timeouts, Retries, Buffering, and Backpressure ➡️</a>
</div>
