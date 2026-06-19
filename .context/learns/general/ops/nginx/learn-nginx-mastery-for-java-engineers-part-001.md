# learn-nginx-mastery-for-java-engineers-part-001

# Part 001 — Nginx Architecture: Master, Worker, Event Loop, and Request Lifecycle

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Target pembaca: Java Software Engineer / Backend Engineer / Tech Lead  
> Fokus: memahami cara Nginx benar-benar menjalankan traffic di runtime  
> Status seri: Part 001 dari 030  
> Catatan: Seri belum selesai. Ini adalah fondasi arsitektur internal Nginx.

---

## 0. Tujuan Part Ini

Di Part 000, kita membingkai Nginx sebagai **traffic runtime**: layer yang menjalankan keputusan routing, proxying, TLS, caching, timeout, buffering, rate limiting, dan observability sebelum request menyentuh aplikasi Java.

Part 001 masuk ke fondasi yang lebih dalam:

> **Bagaimana Nginx bekerja secara runtime ketika traffic benar-benar masuk?**

Kita akan membahas:

1. Struktur proses Nginx: master, worker, cache manager, cache loader.
2. Mengapa Nginx menggunakan model event-driven, bukan thread-per-request.
3. Bagaimana worker menerima koneksi dan memproses request.
4. Apa arti `worker_processes`, `worker_connections`, event loop, dan file descriptor.
5. Bagaimana request lifecycle berjalan dari socket sampai response.
6. Bagaimana reload bisa dilakukan tanpa menjatuhkan koneksi aktif.
7. Apa bedanya model Nginx dengan Java server seperti Tomcat, Jetty, Undertow, Netty, dan Spring WebFlux.
8. Failure mode yang muncul dari arsitektur ini.
9. Cara membaca gejala produksi dari sudut pandang proses dan event loop Nginx.

Tujuan akhirnya bukan sekadar tahu bahwa “Nginx itu cepat”, tetapi memahami **kenapa** ia bisa efisien, **di mana batasnya**, dan **bagaimana keputusan konfigurasi kecil bisa mengubah karakter traffic sistem**.

---

## 1. Baseline Resmi: Apa yang Dikatakan Dokumentasi Nginx

Dokumentasi resmi Nginx menjelaskan bahwa Nginx memiliki satu **master process** dan satu atau lebih **worker process**. Master process bertugas membaca dan mengevaluasi konfigurasi serta menjaga worker process, sedangkan worker process menjalankan pemrosesan request aktual. Jika caching aktif, Nginx juga dapat menjalankan proses tambahan seperti cache loader dan cache manager.

Referensi resmi NGINX Admin Guide menjelaskan hal ini secara eksplisit: master process membaca dan mengevaluasi konfigurasi, menjaga worker process, dan worker process melakukan pemrosesan request aktual.  
Sumber: <https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/>

Dokumentasi `nginx.org` juga menjelaskan bahwa Nginx dapat dikontrol melalui signal; untuk reload konfigurasi, signal `HUP` dikirim ke master process. Master akan mengecek validitas konfigurasi, mencoba membuka log file dan listen socket baru, lalu jika sukses membuat worker baru dan meminta worker lama shutdown secara graceful. Jika gagal, Nginx rollback dan tetap berjalan dengan konfigurasi lama.  
Sumber: <https://nginx.org/en/docs/control.html>

NGINX engineering blog menjelaskan bahwa Nginx berbeda dari banyak server yang memakai model thread/process per request; Nginx memakai arsitektur event-driven yang memungkinkan concurrency tinggi dengan resource relatif rendah.  
Sumber: <https://blog.nginx.org/blog/inside-nginx-how-we-designed-for-performance-scale>

Dokumentasi core module juga menjelaskan directive seperti `worker_processes`, `worker_connections`, `accept_mutex`, dan `multi_accept`, yang berkaitan langsung dengan cara worker menerima koneksi.  
Sumber: <https://nginx.org/en/docs/ngx_core_module.html>

Part ini memakai baseline tersebut, lalu menurunkannya menjadi mental model yang berguna untuk engineer Java.

---

## 2. Mental Model Utama

Cara paling berguna memahami Nginx adalah seperti ini:

```text
Nginx = process manager + event loop workers + configurable request state machine
```

Atau lebih rinci:

```text
Master Process
  - membaca konfigurasi
  - validasi konfigurasi
  - membuka resource penting
  - membuat worker
  - menerima signal runtime
  - melakukan graceful reload/shutdown

Worker Processes
  - menerima koneksi client
  - menjalankan event loop
  - membaca request
  - memilih virtual server
  - memilih location
  - menjalankan handler
  - membaca/menulis upstream
  - menulis response ke client
  - menulis log

Optional Processes
  - cache loader
  - cache manager
```

Nginx bukan aplikasi request handler biasa. Ia lebih mirip **traffic virtual machine** yang menjalankan konfigurasi sebagai program.

Konfigurasi Nginx menentukan:

- socket mana yang didengar,
- host mana yang valid,
- route mana yang cocok,
- apakah request dilayani dari file,
- apakah request diteruskan ke upstream,
- bagaimana header dimodifikasi,
- kapan request dianggap timeout,
- kapan upstream dianggap gagal,
- apakah response di-buffer,
- apakah response di-cache,
- apa yang ditulis ke log,
- bagaimana koneksi ditutup atau dipertahankan.

Master dan worker adalah runtime yang mengeksekusi semua keputusan itu.

---

## 3. Gambaran Arsitektur Proses

Secara sederhana:

```text
                +----------------+
                | master process |
                +----------------+
                    |    |    |
         fork/spawn |    |    | manage/signals
                    v    v    v
              +--------+ +--------+ +--------+
              | worker | | worker | | worker |
              +--------+ +--------+ +--------+
                  |          |          |
                  |          |          |
                  v          v          v
              client / upstream / file / cache / log I/O
```

Jika proxy cache aktif, dapat ada proses tambahan:

```text
                +----------------+
                | master process |
                +----------------+
                    |    |    |
                    v    v    v
              +--------+ +--------+ +---------------+
              | worker | | worker | | cache manager |
              +--------+ +--------+ +---------------+
                              |
                              v
                         cache loader
```

Tidak semua deployment memakai cache, jadi tidak semua proses tambahan selalu ada.

---

## 4. Master Process

### 4.1 Peran Master Process

Master process bukan pemroses request utama.

Perannya adalah:

1. Membaca konfigurasi.
2. Mengecek syntax dan validitas konfigurasi.
3. Membuka listen socket.
4. Membuka log file.
5. Membuat worker process.
6. Menjaga worker tetap hidup.
7. Menerima signal:
   - reload,
   - stop,
   - quit,
   - reopen log,
   - upgrade binary.
8. Mengatur graceful reload.
9. Mengatur graceful shutdown.

Yang penting:

> Jika kamu mengubah konfigurasi Nginx, master process adalah pihak yang mengevaluasi apakah konfigurasi baru dapat diterapkan.

### 4.2 Master Process sebagai Control Plane Lokal

Dalam istilah sistem modern, master process bisa dipahami sebagai **local control plane**.

Ia tidak memproses traffic data-plane secara langsung, tetapi mengatur worker yang memproses traffic.

```text
Control plane:
  master process

Data plane:
  worker processes
```

Ini mirip pemisahan:

```text
Kubernetes control plane  -> mengatur pod/service/endpoint
Nginx master process      -> mengatur worker/socket/config
```

Bedanya, master process jauh lebih lokal dan ringan.

### 4.3 Kenapa Ini Penting untuk Production

Karena reload dan restart punya konsekuensi berbeda.

#### Reload

Reload berarti:

```text
old config + old workers masih menangani koneksi aktif
new config divalidasi
new workers dibuat dengan config baru
old workers diminta berhenti setelah selesai
```

Jika konfigurasi baru gagal validasi atau gagal membuka resource penting, Nginx tetap memakai konfigurasi lama.

Ini sangat penting untuk production karena reload dapat menjadi operasi low-risk jika dilakukan benar.

#### Restart

Restart berarti proses dihentikan lalu dimulai ulang.

Konsekuensinya lebih besar:

- koneksi aktif dapat terputus,
- listen socket sementara tidak tersedia,
- deployment lebih berisiko,
- transient error lebih mungkin muncul.

Prinsip production:

> Untuk perubahan konfigurasi normal, gunakan reload. Gunakan restart hanya jika benar-benar diperlukan.

---

## 5. Worker Process

### 5.1 Peran Worker

Worker process adalah pihak yang memproses traffic aktual.

Worker melakukan:

- accept koneksi client,
- membaca bytes dari socket,
- parsing request,
- menjalankan phase HTTP Nginx,
- memilih server block,
- memilih location,
- melayani static file,
- meneruskan ke upstream,
- membaca response upstream,
- menerapkan buffering/caching/filter,
- menulis response ke client,
- menulis access log,
- menangani keepalive,
- menutup koneksi.

Worker adalah **data plane**.

### 5.2 Worker Biasanya Single-Threaded Event Loop

Secara umum, satu worker Nginx bekerja dengan model event loop: satu worker menangani banyak koneksi secara non-blocking.

Bukan seperti:

```text
1 request = 1 thread
```

Tetapi lebih seperti:

```text
1 worker = 1 event loop = many connections
```

Ilustrasi:

```text
Worker 1
  event loop
    connection A: waiting for client body
    connection B: waiting for upstream response
    connection C: ready to write response
    connection D: keepalive idle
    connection E: reading static file metadata
```

Worker tidak duduk diam menunggu satu request selesai. Ia berpindah antar event yang siap diproses.

### 5.3 Mengapa Ini Efisien

Thread-per-request punya overhead:

- memory stack per thread,
- context switching,
- scheduling overhead,
- lock contention,
- batas jumlah thread praktis,
- risk thread pool exhaustion.

Event-driven worker mengurangi overhead tersebut karena banyak koneksi dapat ditangani oleh sedikit process/thread.

Namun ini bukan sihir. Event-driven architecture efisien jika operasi I/O tidak memblokir event loop terlalu lama.

Nginx dirancang agar operasi network I/O berjalan non-blocking. Karena itu ia cocok untuk:

- reverse proxy,
- static file serving,
- load balancing,
- TLS termination,
- buffering,
- connection multiplexing,
- high concurrency idle/slow clients.

### 5.4 Batas Event Loop

Event loop bukan berarti infinite capacity.

Worker tetap dibatasi oleh:

- CPU,
- memory,
- file descriptor,
- `worker_connections`,
- bandwidth network,
- disk I/O,
- TLS cost,
- log write cost,
- upstream latency,
- kernel limits,
- konfigurasi timeout,
- buffer size.

Mental model yang benar:

> Nginx bisa menangani concurrency tinggi karena tidak mengikat satu koneksi ke satu thread mahal, tetapi tetap membutuhkan resource untuk setiap koneksi dan setiap operasi I/O.

---

## 6. Event Loop: Intuisi Dasar

Event loop adalah pola eksekusi seperti ini:

```text
while running:
    wait for events from OS
    for each ready event:
        execute small non-blocking step
        update connection/request state
```

Contoh event:

- socket client bisa dibaca,
- socket client bisa ditulis,
- socket upstream bisa dibaca,
- socket upstream bisa ditulis,
- timeout terjadi,
- file ready,
- connection closed,
- signal diterima.

Nginx memakai mekanisme event OS-dependent, misalnya `epoll` di Linux, `kqueue` di BSD/macOS, atau mekanisme lain tergantung platform.

Ilustrasi sederhana:

```text
Client A mengirim request header     -> read event
Client B belum kirim body lengkap    -> no event, worker tidak menunggu aktif
Upstream C mengirim response         -> read event
Client D siap menerima response      -> write event
Client E idle keepalive              -> timer event nanti
```

Worker hanya melakukan pekerjaan ketika ada event yang siap.

---

## 7. Nginx vs Java Server Runtime

Sebagai Java engineer, perbandingan ini penting karena banyak bug produksi muncul saat asumsi dari servlet container dibawa ke Nginx atau sebaliknya.

### 7.1 Model Tradisional Servlet Container

Model klasik Tomcat/Jetty servlet blocking kira-kira seperti:

```text
connection/request masuk
    -> worker thread dari thread pool
        -> jalankan filter chain
        -> jalankan servlet/controller
        -> blocking I/O ke DB/service lain
        -> tulis response
    -> thread kembali ke pool
```

Batas utamanya:

- jumlah thread,
- panjang queue,
- blocking dependency,
- memory per thread,
- garbage collection pressure,
- CPU context switching.

Jika downstream lambat, thread bisa habis.

### 7.2 Model Nginx

Nginx tidak menjalankan business logic aplikasi. Ia menjalankan I/O dan keputusan traffic.

```text
connection/request masuk
    -> worker event loop
        -> parse request
        -> route/proxy/static/cache
        -> non-blocking I/O ke upstream/client
        -> log
```

Batas utamanya:

- event loop saturation,
- file descriptor,
- worker connections,
- CPU per byte/TLS/compression,
- upstream latency,
- buffer memory,
- kernel/network.

### 7.3 Netty, Undertow, WebFlux

Java modern juga punya runtime event-driven seperti Netty, Undertow XNIO, dan Spring WebFlux/Reactor Netty.

Namun perannya beda.

```text
Nginx event loop:
  traffic layer, proxy, TLS, routing, buffering, caching, static, logs

Netty/WebFlux event loop:
  application protocol/runtime/business request handling
```

Keduanya bisa sama-sama event-driven, tapi failure mode-nya berbeda.

Pada Java reactive server, event loop bisa terganggu oleh blocking code aplikasi:

```java
// Contoh buruk di reactive/event-loop context
Mono.just(userId)
    .map(id -> jdbcTemplate.queryForObject(...)) // blocking call
```

Pada Nginx, event loop bisa terganggu oleh operasi yang mahal atau resource bottleneck seperti TLS CPU, logging disk, buffer pressure, atau koneksi upstream yang tidak dikelola baik.

### 7.4 Model Kombinasi Umum

Arsitektur umum:

```text
Client
  -> Nginx worker event loop
      -> upstream keepalive connection
          -> Java server acceptor
              -> Java worker thread / event loop
                  -> application code
                      -> database/service/cache
```

Setiap layer punya queue, timeout, dan resource limit sendiri.

Masalah besar terjadi ketika limit antar-layer tidak sejajar.

Contoh:

```text
Nginx proxy_read_timeout = 60s
Java server request timeout = none
DB timeout = 120s
Client timeout = 10s
```

Hasilnya:

- client sudah menyerah,
- Nginx mungkin masih menunggu,
- Java masih memproses,
- DB masih sibuk,
- kapasitas habis untuk request yang sudah tidak berguna.

Kita akan bahas ini detail di Part 010, tetapi fondasinya dimulai dari memahami request lifecycle.

---

## 8. Request Lifecycle di Nginx

Sekarang kita bangun lifecycle dari awal sampai akhir.

### 8.1 High-Level Lifecycle

```text
1. Nginx start
2. Master membaca konfigurasi
3. Master membuka listen socket
4. Master membuat worker
5. Worker menunggu event koneksi
6. Client connect
7. Worker accept connection
8. Worker membaca request
9. Nginx memilih server block
10. Nginx memilih location
11. Nginx menjalankan handler
12. Handler melayani static/proxy/cache/rewrite/dll
13. Jika proxy, worker connect ke upstream
14. Worker mengirim request ke upstream
15. Worker membaca response upstream
16. Worker menerapkan filter/buffer/cache
17. Worker menulis response ke client
18. Access log ditulis
19. Connection ditutup atau dipertahankan sebagai keepalive
```

### 8.2 Start Phase

Ketika Nginx start:

```text
nginx binary executed
  -> parse nginx.conf
  -> load included config files
  -> validate directives/context
  -> open logs
  -> bind listen sockets
  -> initialize modules
  -> spawn workers
```

Jika ada error konfigurasi, Nginx tidak start.

Contoh:

```bash
nginx -t
```

Output sukses umumnya:

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 8.3 Listen Socket

Nginx mendengar port berdasarkan directive `listen`.

Contoh:

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://app;
    }
}
```

Saat config diterapkan, Nginx perlu membuka socket untuk port 80.

Jika port sudah dipakai proses lain:

```text
bind() to 0.0.0.0:80 failed (98: Address already in use)
```

Maka start/reload bisa gagal.

### 8.4 Accept Phase

Client membuat koneksi TCP ke socket Nginx.

Worker menerima koneksi itu.

Pertanyaan penting:

> Worker mana yang menerima koneksi?

Ini dipengaruhi oleh OS, konfigurasi event, `accept_mutex`, `reuseport`, jumlah worker, dan mekanisme kernel.

Untuk pemahaman awal:

```text
listen socket menerima koneksi
    -> salah satu worker accept connection
    -> connection masuk ke event loop worker tersebut
```

Setelah sebuah koneksi diterima oleh worker, koneksi itu biasanya dikelola oleh worker tersebut sampai selesai.

### 8.5 Read Request Phase

Worker membaca bytes dari client socket.

Untuk HTTP request, Nginx perlu membaca:

- request line,
- header,
- mungkin body.

Contoh request:

```http
GET /api/orders/123 HTTP/1.1
Host: example.com
User-Agent: curl/8.0
Accept: application/json
```

Nginx kemudian memutuskan:

- server block mana,
- location mana,
- module/handler mana,
- apakah request valid,
- apakah body perlu dibaca penuh dulu,
- apakah request perlu diteruskan ke upstream.

### 8.6 Server Selection Phase

Nginx memilih server block berdasarkan:

- address/port,
- `server_name`,
- Host header,
- SNI untuk TLS.

Detailnya akan dibahas di Part 004.

Untuk lifecycle saat ini, cukup pahami:

```text
connection accepted on :443
  -> TLS SNI may influence server selection
  -> HTTP Host header influences virtual host selection
```

### 8.7 Location Selection Phase

Setelah server block dipilih, Nginx memilih `location` berdasarkan URI.

Contoh:

```nginx
location /assets/ {
    root /var/www/app;
}

location /api/ {
    proxy_pass http://java_backend;
}

location / {
    try_files $uri /index.html;
}
```

Request:

```text
/api/orders/123
```

Masuk ke:

```nginx
location /api/
```

Detail location matching akan dibahas sangat dalam di Part 005.

### 8.8 Handler Phase

Setelah location dipilih, handler menentukan apa yang dilakukan.

Contoh handler:

- static file handler,
- reverse proxy handler,
- FastCGI handler,
- uwsgi handler,
- gRPC handler,
- return handler,
- rewrite/internal redirect,
- auth request,
- cache lookup.

Untuk Java backend, handler paling umum adalah reverse proxy:

```nginx
location /api/ {
    proxy_pass http://java_backend;
}
```

### 8.9 Upstream Phase

Jika request diproxy ke upstream:

```text
Nginx worker
  -> memilih upstream peer
  -> membuka atau memakai ulang upstream connection
  -> mengirim request
  -> menunggu response upstream
  -> membaca response header/body
```

Contoh upstream:

```nginx
upstream java_backend {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
}

server {
    listen 80;

    location /api/ {
        proxy_pass http://java_backend;
    }
}
```

Di sini Nginx bukan hanya meneruskan bytes. Ia menjalankan keputusan:

- upstream mana dipilih,
- apakah koneksi keepalive dipakai,
- timeout mana berlaku,
- apakah request body di-buffer,
- apakah response di-buffer,
- apakah retry ke upstream lain boleh dilakukan,
- status mana dianggap gagal.

### 8.10 Response Phase

Setelah response diterima dari upstream atau file:

```text
response header
response body
```

Nginx dapat menerapkan:

- header modification,
- compression,
- buffering,
- caching,
- chunked transfer,
- range request,
- rate limiting output,
- log timing,
- connection keepalive.

### 8.11 Logging Phase

Access log biasanya ditulis setelah request selesai.

Contoh log standard:

```text
127.0.0.1 - - [19/Jun/2026:10:00:00 +0700] "GET /api/orders/123 HTTP/1.1" 200 512
```

Untuk production, log format perlu memasukkan timing upstream:

```nginx
log_format main_ext '$remote_addr - $request '
                    'status=$status body_bytes_sent=$body_bytes_sent '
                    'request_time=$request_time '
                    'upstream_addr=$upstream_addr '
                    'upstream_status=$upstream_status '
                    'upstream_connect_time=$upstream_connect_time '
                    'upstream_header_time=$upstream_header_time '
                    'upstream_response_time=$upstream_response_time';
```

Ini akan dibahas dalam Part 019.

### 8.12 Keepalive or Close

Setelah response selesai, koneksi client bisa:

- ditutup,
- dipertahankan untuk request berikutnya.

Keepalive mengurangi overhead koneksi baru, tetapi memakai file descriptor dan memory.

Mental model:

```text
keepalive saves CPU/network handshake cost
but consumes connection slots while idle
```

---

## 9. Worker Sizing: `worker_processes`

Directive penting:

```nginx
worker_processes auto;
```

Atau:

```nginx
worker_processes 4;
```

### 9.1 Apa Artinya

`worker_processes` menentukan jumlah worker process.

Jika `auto`, Nginx mencoba memilih berdasarkan jumlah CPU core yang tersedia.

Untuk banyak deployment modern, `auto` adalah baseline yang masuk akal.

### 9.2 Lebih Banyak Worker Tidak Selalu Lebih Baik

Menambah worker dapat membantu paralelisme CPU, tetapi juga bisa menambah:

- context switching,
- memory overhead,
- accept contention,
- cache locality problem,
- konfigurasi yang sulit diprediksi dalam container dengan CPU quota.

Di container/Kubernetes, hati-hati:

```text
host punya 32 core
container diberi CPU limit 2 core
worker_processes auto mungkin membaca konteks host/cgroup tergantung versi/build/platform
```

Praktiknya, validasi di environment nyata.

### 9.3 Rule of Thumb

Untuk Nginx sebagai reverse proxy biasa:

```nginx
worker_processes auto;
```

Lalu ukur:

- CPU usage per worker,
- connection distribution,
- p95/p99 latency,
- error rate,
- file descriptor usage,
- upstream saturation.

Jangan tuning hanya berdasarkan template.

---

## 10. Connection Capacity: `worker_connections`

Directive:

```nginx
events {
    worker_connections 1024;
}
```

### 10.1 Arti Dasar

`worker_connections` membatasi jumlah koneksi yang bisa dibuka oleh satu worker.

Total teoritis:

```text
max_connections ≈ worker_processes × worker_connections
```

Namun ini hanya pendekatan kasar.

### 10.2 Kenapa Kasar?

Karena satu request proxy bisa memakai lebih dari satu koneksi:

```text
client connection -> Nginx -> upstream connection
```

Satu request aktif yang diproxy minimal dapat melibatkan:

- 1 koneksi client,
- 1 koneksi upstream.

Maka kapasitas client aktif untuk reverse proxy bisa jauh lebih kecil dari angka teoritis.

Contoh:

```text
worker_processes = 4
worker_connections = 4096
teoritis = 16384 connections
```

Jika setiap request aktif butuh client+upstream connection:

```text
rough active proxied requests <= 8192
```

Belum termasuk:

- keepalive idle client,
- keepalive upstream,
- DNS resolver socket,
- cache/file operations,
- log file descriptors,
- listening sockets,
- OS limits.

### 10.3 File Descriptor Limit

`worker_connections` tidak cukup jika OS file descriptor limit rendah.

Perlu lihat:

```bash
ulimit -n
```

Dan systemd limit:

```ini
LimitNOFILE=65535
```

Nginx directive:

```nginx
worker_rlimit_nofile 65535;
```

Kita akan bahas detail di Part 011.

Untuk sekarang, pahami invariant:

> Connection capacity Nginx dibatasi oleh minimum dari konfigurasi Nginx, limit OS, resource kernel, memory, CPU, dan upstream capacity.

---

## 11. Accept Mutex, Multi Accept, and Connection Distribution

Directive terkait:

```nginx
events {
    accept_mutex off;
    multi_accept off;
}
```

### 11.1 `accept_mutex`

`accept_mutex` mengatur apakah worker menerima koneksi baru secara bergantian.

Dokumentasi core module menjelaskan: jika `accept_mutex` aktif, worker process akan menerima koneksi baru secara bergantian. Jika tidak, semua worker akan diberi notifikasi tentang koneksi baru, dan pada volume koneksi rendah sebagian worker bisa membuang resource karena wake-up yang tidak perlu.

Default modern Nginx: `accept_mutex off`.

Kenapa default bisa off? Karena pada banyak sistem modern, mekanisme kernel seperti EPOLLEXCLUSIVE atau reuseport dapat membuat accept contention lebih terkendali.

### 11.2 `multi_accept`

`multi_accept` mengatur apakah worker menerima satu koneksi baru per event atau sebanyak mungkin koneksi yang tersedia.

Secara intuitif:

```text
multi_accept off:
  worker menerima satu koneksi per notification

multi_accept on:
  worker menerima semua koneksi yang pending sebisa mungkin
```

### 11.3 Jangan Tuning Buta

Banyak artikel menyarankan:

```nginx
multi_accept on;
```

Tetapi ini tidak selalu benar.

Risiko:

- satu worker mengambil terlalu banyak koneksi,
- distribusi antar-worker tidak merata,
- worker_connections lebih cepat penuh,
- latency tail memburuk pada pola traffic tertentu.

Prinsip:

> Directive event-level harus diuji dengan traffic nyata atau benchmark yang representatif. Jangan copy-paste tuning global.

---

## 12. Graceful Reload: Kenapa Nginx Bisa Mengubah Config Tanpa Downtime Besar

Salah satu kekuatan Nginx adalah graceful reload.

Command umum:

```bash
nginx -t
nginx -s reload
```

Atau dengan systemd:

```bash
systemctl reload nginx
```

### 12.1 Apa yang Terjadi Saat Reload

Menurut dokumentasi kontrol proses Nginx, saat menerima `HUP`, master process:

1. Mengecek syntax validitas konfigurasi baru.
2. Mencoba menerapkan konfigurasi baru.
3. Mencoba membuka log file baru.
4. Mencoba membuka listen socket baru.
5. Jika gagal, rollback dan tetap berjalan dengan konfigurasi lama.
6. Jika sukses, membuat worker process baru.
7. Mengirim sinyal ke worker lama agar shutdown gracefully.

Secara mental:

```text
Before reload:
  master
    worker(old config)
    worker(old config)

During reload:
  master validates new config
  master spawns new workers
    worker(old config) draining old connections
    worker(old config) draining old connections
    worker(new config) accepting new connections
    worker(new config) accepting new connections

After drain:
  master
    worker(new config)
    worker(new config)
```

### 12.2 Kenapa Ini Bukan “Magic Zero Downtime” Absolut

Graceful reload bukan berarti tidak mungkin ada gangguan.

Gangguan masih bisa terjadi jika:

- konfigurasi baru valid secara syntax tapi salah secara logic,
- upstream salah alamat,
- certificate file salah permission,
- DNS target tidak resolvable,
- worker lama butuh sangat lama drain karena long-lived connections,
- memory meningkat sementara karena old+new workers hidup bersamaan,
- listen socket berubah drastis,
- deployment script melakukan restart, bukan reload,
- health check/load balancer eksternal salah membaca status.

Graceful reload adalah mekanisme aman, bukan pengganti validasi desain.

### 12.3 Long-Lived Connection Problem

Jika ada WebSocket, SSE, atau long polling, worker lama bisa tetap hidup lama karena masih memegang koneksi lama.

Ilustrasi:

```text
old worker holds WebSocket connections for 2 hours
new worker handles new requests
old worker remains visible in process list
```

Ini normal, tetapi perlu dipahami dalam deployment.

---

## 13. Request State Machine

Nginx memproses request sebagai rangkaian state.

Mental model:

```text
NEW_CONNECTION
  -> READ_REQUEST_HEADER
  -> READ_REQUEST_BODY? 
  -> SELECT_SERVER
  -> SELECT_LOCATION
  -> RUN_REWRITE_PHASE?
  -> RUN_ACCESS_PHASE?
  -> RUN_CONTENT_HANDLER
      -> STATIC_FILE
      -> PROXY_UPSTREAM
      -> RETURN
      -> INTERNAL_REDIRECT
  -> FILTER_RESPONSE
  -> WRITE_RESPONSE
  -> LOG_REQUEST
  -> KEEPALIVE_OR_CLOSE
```

Tidak semua request melewati semua state.

Contoh static asset:

```text
NEW_CONNECTION
  -> READ_REQUEST_HEADER
  -> SELECT_SERVER
  -> SELECT_LOCATION /assets/
  -> STATIC_FILE
  -> WRITE_RESPONSE
  -> LOG_REQUEST
```

Contoh API proxy:

```text
NEW_CONNECTION
  -> READ_REQUEST_HEADER
  -> SELECT_SERVER
  -> SELECT_LOCATION /api/
  -> PROXY_UPSTREAM
  -> READ_UPSTREAM_RESPONSE
  -> WRITE_RESPONSE
  -> LOG_REQUEST
```

Contoh blocked request:

```text
NEW_CONNECTION
  -> READ_REQUEST_HEADER
  -> SELECT_SERVER
  -> SELECT_LOCATION /admin/
  -> ACCESS_DENIED
  -> WRITE_403
  -> LOG_REQUEST
```

Ini penting karena directive Nginx bekerja pada phase berbeda. Salah memahami phase akan menyebabkan konfigurasi yang terlihat benar tapi perilakunya salah.

---

## 14. Nginx HTTP Processing Phases: Gambaran Awal

Nginx HTTP module memproses request melalui beberapa phase internal.

Kita tidak perlu menghafal semua detail internal di awal, tetapi perlu tahu bahwa `rewrite`, `access`, `content`, dan `log` bukan terjadi dalam satu titik yang sama.

Gambaran konseptual:

```text
post-read
server rewrite
find config / location
rewrite
preaccess
access
auth
try files
content
log
```

Contoh konsekuensi:

- `rewrite` dapat mengubah URI sebelum location final.
- `try_files` bisa menyebabkan internal redirect.
- `access` rule bisa menolak request sebelum proxy.
- `log` terjadi setelah request selesai.

Jadi konfigurasi Nginx bukan hanya “top to bottom text file”. Ia dievaluasi oleh runtime phase engine.

---

## 15. Blocking vs Non-Blocking: Kesalahan Mental Model yang Sering Terjadi

### 15.1 Salah Kaprah

Salah:

> Nginx cepat karena semua request diproses paralel tanpa batas.

Benar:

> Nginx efisien karena tidak memblokir worker untuk menunggu I/O yang belum siap, tetapi tetap memiliki limit resource dan bisa bottleneck.

### 15.2 Analogi Restoran

Thread-per-request:

```text
1 pelanggan = 1 pelayan berdiri menunggu sampai selesai makan
```

Event loop:

```text
1 pelayan menangani banyak meja; saat meja A menunggu makanan, pelayan melayani meja B
```

Tapi jika semua meja meminta hal yang berat bersamaan, atau dapur lambat, restoran tetap bottleneck.

Dalam Nginx:

```text
pelayan = worker event loop
dapur = upstream Java app/database
meja = connection/request
```

Jika upstream lambat, Nginx bisa tetap tidak blocking secara thread, tetapi connection slot dan buffer tetap terpakai.

---

## 16. Nginx sebagai Shock Absorber di Depan Java

Salah satu peran paling penting Nginx adalah menyerap pola traffic yang buruk sebelum mencapai Java.

### 16.1 Slow Client

Client lambat membaca response.

Tanpa Nginx:

```text
slow client holds Java response thread/socket longer
```

Dengan Nginx buffering:

```text
Java sends response to Nginx relatively quickly
Nginx buffers response
Nginx slowly writes to slow client
Java resource released earlier
```

Ini bisa melindungi aplikasi Java.

### 16.2 Slow Upload

Client lambat mengirim request body.

Dengan request buffering default, Nginx bisa membaca body lebih dulu sebelum meneruskan ke upstream.

Konsekuensi:

- Java tidak perlu memegang thread selama client upload lambat.
- Tetapi Nginx memakai disk/memory buffer.
- Untuk streaming upload, perilakunya perlu diubah hati-hati.

### 16.3 Upstream Slow

Jika Java lambat, Nginx bisa:

- menunggu sampai timeout,
- retry ke upstream lain,
- serve stale cache,
- return error,
- menjaga client connection.

Tetapi Nginx tidak bisa membuat upstream lambat menjadi cepat. Ia hanya bisa mengelola dampaknya.

---

## 17. Java Engineer View: Resource Chain

Request melewati chain resource:

```text
Client
  -> client TCP connection
  -> Nginx worker connection slot
  -> Nginx buffer memory/temp file
  -> upstream connection slot
  -> Java accept queue
  -> Java thread/event loop
  -> Java heap/object allocation
  -> DB connection pool
  -> DB locks/storage/network
```

Setiap layer punya batas.

Failure sering terjadi bukan karena satu layer “rusak”, tetapi karena batas antar-layer tidak konsisten.

Contoh:

```text
Nginx accepts 20,000 concurrent requests
Java thread pool only 200
DB pool only 50
```

Jika tidak ada backpressure/rate limiting/queue discipline, Nginx bisa membuat Java terlihat mati karena terlalu banyak request diteruskan.

Nginx adalah pelindung hanya jika dikonfigurasi sebagai pelindung.

---

## 18. Important Runtime Directives: Preview

Kita belum masuk detail tuning, tetapi perlu mengenali directive yang berkaitan langsung dengan arsitektur.

### 18.1 Main Context

```nginx
worker_processes auto;
worker_rlimit_nofile 65535;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log warn;
```

### 18.2 Events Context

```nginx
events {
    worker_connections 4096;
    multi_accept off;
}
```

### 18.3 HTTP Context

```nginx
http {
    sendfile on;
    keepalive_timeout 65;

    upstream app {
        server 127.0.0.1:8080;
        keepalive 32;
    }

    server {
        listen 80;

        location / {
            proxy_pass http://app;
        }
    }
}
```

### 18.4 Stream Context

```nginx
stream {
    upstream redis_backend {
        server 10.0.0.10:6379;
    }

    server {
        listen 6379;
        proxy_pass redis_backend;
    }
}
```

Di Part 001, fokusnya bukan menghafal directive, tetapi memahami bahwa directive tersebut memengaruhi runtime process/event/connection behavior.

---

## 19. Observasi Runtime: Melihat Proses Nginx

Di server Linux, kamu bisa melihat proses:

```bash
ps -ef | grep nginx
```

Contoh:

```text
root      1001     1  0 10:00 ? 00:00:00 nginx: master process /usr/sbin/nginx
nginx     1002  1001 0 10:00 ? 00:00:00 nginx: worker process
nginx     1003  1001 0 10:00 ? 00:00:00 nginx: worker process
nginx     1004  1001 0 10:00 ? 00:00:00 nginx: worker process
nginx     1005  1001 0 10:00 ? 00:00:00 nginx: worker process
```

Perhatikan:

- master sering berjalan sebagai root agar bisa bind port privileged dan manage worker,
- worker biasanya berjalan sebagai user non-root seperti `nginx` atau `www-data`,
- worker process jumlahnya sesuai konfigurasi,
- saat reload, sementara bisa terlihat worker lama dan worker baru.

Untuk melihat listening socket:

```bash
ss -lntp | grep nginx
```

Untuk melihat file descriptor:

```bash
ls /proc/<worker-pid>/fd | wc -l
```

Untuk melihat limit:

```bash
cat /proc/<worker-pid>/limits
```

---

## 20. Status Code dari Sudut Pandang Arsitektur

Beberapa status code umum dapat dipahami dari lifecycle.

### 20.1 400 Bad Request

Kemungkinan:

- request malformed,
- header terlalu besar,
- Host invalid,
- TLS/plain HTTP mismatch,
- request line tidak valid.

Terjadi sebelum mencapai upstream.

### 20.2 403 Forbidden

Kemungkinan:

- access rule menolak,
- file permission tidak cukup,
- directory listing disabled,
- auth gagal.

Bisa terjadi di access/static phase.

### 20.3 404 Not Found

Kemungkinan:

- file tidak ada,
- location salah,
- `try_files` fallback salah,
- request tidak diproxy karena location matching salah.

Bisa terjadi di static routing/location phase.

### 20.4 413 Payload Too Large

Kemungkinan:

- request body melebihi `client_max_body_size`.

Nginx bisa menolak sebelum Java membaca request.

### 20.5 499 Client Closed Request

Nginx-specific log status: client menutup koneksi sebelum Nginx selesai merespons.

Kemungkinan:

- client timeout,
- mobile network putus,
- user cancel,
- upstream terlalu lambat,
- Nginx masih menunggu Java tapi client sudah pergi.

Status 499 sangat penting untuk memahami mismatch timeout client/Nginx/upstream.

### 20.6 502 Bad Gateway

Kemungkinan:

- upstream connection refused,
- upstream crash,
- invalid response dari upstream,
- TLS upstream mismatch,
- upstream closed connection prematurely.

Terjadi di upstream phase.

### 20.7 503 Service Unavailable

Kemungkinan:

- no live upstream,
- limit/rate limiting tertentu,
- maintenance mode,
- upstream unavailable.

### 20.8 504 Gateway Timeout

Kemungkinan:

- Nginx berhasil connect ke upstream tetapi upstream tidak memberi response tepat waktu,
- `proxy_read_timeout` tercapai,
- network path lambat.

Terjadi saat Nginx menunggu upstream.

---

## 21. Failure Mode Berbasis Proses dan Event Loop

### 21.1 Worker Connection Exhaustion

Gejala:

- error log menyebut worker connections are not enough,
- koneksi baru gagal,
- latency meningkat,
- 502/503/504 bisa naik tergantung kondisi.

Penyebab:

- `worker_connections` terlalu rendah,
- file descriptor limit rendah,
- terlalu banyak keepalive idle,
- upstream lambat membuat koneksi tertahan,
- long-lived connection terlalu banyak,
- traffic spike.

Mental model:

```text
connection slot penuh = worker tidak bisa menerima pekerjaan baru meskipun CPU belum tentu penuh
```

### 21.2 CPU Saturation

Gejala:

- semua worker CPU tinggi,
- latency naik,
- TLS/compression workload tinggi,
- static/proxy throughput turun.

Penyebab:

- TLS handshake tinggi,
- gzip level terlalu mahal,
- logging terlalu berat,
- regex location/map berat,
- terlalu banyak request kecil,
- worker_processes kurang atau CPU limit rendah.

### 21.3 Disk I/O Bottleneck

Gejala:

- latency naik saat log/cache/temp file aktif,
- disk util tinggi,
- request body buffering lambat,
- cache write lambat.

Penyebab:

- access log sync pressure,
- cache/temp path di disk lambat,
- upload besar,
- disk hampir penuh,
- log rotation bermasalah.

### 21.4 Memory Pressure

Gejala:

- worker RSS naik,
- OOM kill,
- reload gagal atau lambat,
- buffering banyak.

Penyebab:

- buffer terlalu besar,
- concurrency tinggi,
- response besar,
- request body buffering,
- old+new workers saat reload,
- cache metadata.

### 21.5 Upstream Saturation

Gejala:

- `$upstream_response_time` naik,
- 504 naik,
- Java thread pool penuh,
- DB pool penuh,
- Nginx CPU normal tapi request lambat.

Penyebab:

- aplikasi Java lambat,
- dependency lambat,
- GC pause,
- lock contention,
- DB bottleneck,
- insufficient upstream instances.

Nginx sering menjadi tempat gejala terlihat, bukan akar masalah.

---

## 22. Production Invariants

Gunakan invariants ini saat membaca konfigurasi atau incident.

### Invariant 1 — Master Tidak Melayani Request Normal

Jika request gagal, biasanya yang relevan adalah worker, upstream, config, network, atau resource limit; bukan master process secara langsung.

### Invariant 2 — Worker Event Loop Harus Tetap Ringan

Jangan membuat worker melakukan pekerjaan mahal tanpa alasan:

- compression ekstrem,
- logging berlebihan,
- regex kompleks,
- buffering tidak terkendali,
- disk I/O berat.

### Invariant 3 — Satu Request Proxy Dapat Mengonsumsi Dua Koneksi

Client connection dan upstream connection harus dihitung bersama.

### Invariant 4 — Keepalive Menghemat Latency tetapi Memakai Slot

Keepalive bukan gratis.

### Invariant 5 — Timeout Harus Disejajarkan Antar-Layer

Client, Nginx, Java, DB, dan downstream service harus punya timeout budget yang masuk akal.

### Invariant 6 — Reload Aman Jika Config Benar dan Resource Tersedia

`nginx -t` perlu, tetapi tidak cukup. Validasi runtime tetap diperlukan.

### Invariant 7 — 502/504 Biasanya Butuh Korelasi Nginx + Java Log

Nginx log memberi perspektif boundary. Java log memberi perspektif aplikasi.

### Invariant 8 — Nginx Bisa Melindungi Java, tetapi Bisa Juga Membanjirinya

Tanpa rate limit, timeout, queue discipline, dan upstream sizing, Nginx hanya menjadi traffic amplifier.

---

## 23. Mini Lab: Melihat Arsitektur Nginx Secara Lokal

Jika kamu punya Docker, jalankan:

```bash
docker run --rm --name nginx-lab -p 8080:80 nginx:stable
```

Di terminal lain:

```bash
docker exec -it nginx-lab sh
```

Lihat proses:

```bash
ps aux | grep nginx
```

Lihat konfigurasi efektif:

```bash
nginx -T
```

Test request:

```bash
curl -v http://localhost:8080/
```

Reload:

```bash
nginx -t
nginx -s reload
```

Amati proses lagi:

```bash
ps aux | grep nginx
```

Hal yang perlu diamati:

1. Ada master process.
2. Ada worker process.
3. Config berada di `/etc/nginx/nginx.conf` dan include path tertentu.
4. Reload tidak sama dengan stop/start container.
5. Access log dan error log default bisa diarahkan ke stdout/stderr dalam image container.

---

## 24. Mini Lab: Nginx di Depan Java Mock Server

Jalankan mock Java-like backend sederhana.

Dengan Python untuk simulasi cepat:

```bash
python3 -m http.server 9000
```

Buat config Nginx:

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    log_format upstream_debug '$remote_addr "$request" '
                              'status=$status request_time=$request_time '
                              'upstream_addr=$upstream_addr '
                              'upstream_status=$upstream_status '
                              'upstream_response_time=$upstream_response_time';

    access_log /var/log/nginx/access.log upstream_debug;

    upstream app_backend {
        server 127.0.0.1:9000;
    }

    server {
        listen 8080;

        location / {
            proxy_pass http://app_backend;
        }
    }
}
```

Test:

```bash
curl -v http://localhost:8080/
```

Lihat log:

```bash
tail -f /var/log/nginx/access.log
```

Matikan backend, lalu request lagi:

```bash
curl -v http://localhost:8080/
```

Amati status seperti 502.

Pelajaran:

```text
Nginx tetap hidup
worker tetap menerima request
failure terjadi saat upstream phase
status berubah menjadi gateway error
```

---

## 25. Mapping ke Cara Berpikir Tech Lead

Sebagai tech lead, kamu tidak cukup tahu syntax. Kamu perlu bisa bertanya:

### 25.1 Saat Mendesain

- Berapa concurrency client yang perlu ditahan Nginx?
- Berapa concurrency upstream yang aman untuk Java?
- Apakah Nginx boleh buffering request body?
- Apakah Nginx harus buffering response?
- Apakah endpoint ini long-lived?
- Apakah timeout Nginx sejajar dengan timeout aplikasi?
- Apakah reload aman dengan koneksi aktif?
- Apakah worker process cukup untuk CPU quota container?
- Apakah file descriptor cukup?
- Apakah log format cukup untuk incident?

### 25.2 Saat Incident

- Apakah error muncul sebelum upstream atau setelah upstream?
- Apakah `$upstream_status` kosong?
- Apakah `$upstream_response_time` tinggi?
- Apakah 499 naik karena client timeout?
- Apakah worker connection exhausted?
- Apakah CPU worker tinggi?
- Apakah disk log/cache penuh?
- Apakah reload baru saja terjadi?
- Apakah old worker masih draining?

### 25.3 Saat Review Config

- Apakah `worker_processes` masuk akal?
- Apakah `worker_connections` sesuai kapasitas?
- Apakah upstream keepalive dikonfigurasi?
- Apakah timeout eksplisit?
- Apakah access log punya timing upstream?
- Apakah error handling jelas?
- Apakah config bisa di-reload safely?

---

## 26. Common Misconceptions

### Misconception 1 — “Nginx Itu Selalu Non-Blocking, Jadi Tidak Bisa Bottleneck”

Salah.

Nginx tetap bisa bottleneck di:

- CPU,
- disk,
- network,
- file descriptor,
- memory,
- worker connection,
- upstream wait,
- TLS,
- compression,
- logging.

### Misconception 2 — “worker_connections = Jumlah User Maksimum”

Tidak tepat.

Jumlah user maksimum tergantung:

- keepalive,
- request aktif vs idle,
- upstream connection,
- HTTP/2 multiplexing,
- file descriptor,
- memory,
- traffic pattern.

### Misconception 3 — “Reload Pasti Zero Downtime”

Tidak absolut.

Reload graceful, tetapi logic config baru tetap bisa salah.

### Misconception 4 — “502 Pasti Bug Nginx”

Biasanya bukan.

502 sering berarti Nginx gagal bicara dengan upstream atau upstream memberi response tidak valid.

### Misconception 5 — “Nginx dan Java Timeout Bisa Diset Besar Saja Biar Aman”

Timeout terlalu besar bisa memperpanjang resource retention dan memperparah cascading failure.

### Misconception 6 — “Nginx Bisa Menyelesaikan Semua Masalah Gateway”

Nginx bisa routing, limiting, proxying, caching, TLS, dan observability. Tetapi ia bukan pengganti:

- domain authorization,
- business validation,
- service orchestration penuh,
- distributed tracing lengkap,
- policy engine kompleks,
- service mesh untuk east-west traffic skala besar.

---

## 27. Checklist Pemahaman Part 001

Kamu dianggap memahami Part 001 jika bisa menjawab:

1. Apa peran master process?
2. Apa peran worker process?
3. Mengapa Nginx memakai event-driven architecture?
4. Apa beda event loop Nginx dengan thread-per-request Java server?
5. Apa yang terjadi saat reload?
6. Mengapa reload bisa graceful?
7. Mengapa reload tetap bisa berisiko?
8. Apa arti kasar `worker_processes × worker_connections`?
9. Mengapa satu proxied request bisa memakai dua koneksi?
10. Apa hubungan keepalive dengan connection slot?
11. Di phase mana 502 biasanya terjadi?
12. Mengapa 499 penting untuk timeout analysis?
13. Bagaimana Nginx bisa melindungi Java dari slow client?
14. Bagaimana Nginx bisa membanjiri Java jika tidak dibatasi?
15. Apa gejala worker connection exhaustion?

---

## 28. Ringkasan Mental Model

Nginx berjalan dengan model:

```text
master process = local control plane
worker process = event-driven data plane
configuration = traffic program
request = state machine execution
```

Request tidak “sekadar lewat”. Request masuk ke runtime yang:

1. menerima koneksi,
2. membaca bytes,
3. memilih server,
4. memilih location,
5. menjalankan phase,
6. mungkin meneruskan ke upstream,
7. mengelola timeout/buffer/cache,
8. mengirim response,
9. menulis log,
10. mempertahankan atau menutup koneksi.

Sebagai Java engineer, nilai terbesar dari memahami arsitektur ini adalah kamu bisa melihat sistem sebagai chain:

```text
client -> Nginx worker -> upstream Java runtime -> dependency
```

Bukan hanya:

```text
browser -> controller
```

Dengan model ini, status code, timeout, latency, connection exhaustion, reload behavior, dan incident production menjadi jauh lebih masuk akal.

---

## 29. Latihan Desain

Jawab secara tertulis sebelum lanjut ke Part 002.

### Latihan 1 — Kapasitas Proxy

Kamu punya:

```text
worker_processes = 4
worker_connections = 2048
```

Pertanyaan:

1. Berapa koneksi teoritis maksimum?
2. Jika semua request diproxy ke Java dan setiap request aktif memakai client+upstream connection, berapa estimasi kasar request aktif maksimum?
3. Apa saja alasan angka nyata bisa lebih rendah?

### Latihan 2 — Timeout Mismatch

Client mobile timeout setelah 10 detik. Nginx `proxy_read_timeout` 60 detik. Java tidak punya request timeout. DB query bisa berjalan 120 detik.

Pertanyaan:

1. Apa yang terjadi jika DB lambat?
2. Di log Nginx status apa yang mungkin muncul?
3. Resource mana yang tetap terpakai walaupun client sudah pergi?
4. Perubahan desain apa yang perlu dipertimbangkan?

### Latihan 3 — Reload dengan WebSocket

Nginx memiliki ribuan WebSocket aktif. Kamu melakukan reload config.

Pertanyaan:

1. Apa yang terjadi pada worker lama?
2. Apakah worker lama langsung hilang?
3. Apa risiko memory sementara?
4. Bagaimana strategi deployment yang lebih aman?

### Latihan 4 — 502 vs 504

Aplikasi Java kadang crash, kadang lambat.

Pertanyaan:

1. Kapan Nginx cenderung memberi 502?
2. Kapan Nginx cenderung memberi 504?
3. Log field apa yang perlu ditambahkan untuk membedakan keduanya?

---

## 30. Production Checklist Part 001

Gunakan checklist ini untuk sistem nyata:

- [ ] `nginx -T` bisa menampilkan effective config dengan jelas.
- [ ] `worker_processes` eksplisit atau `auto` dengan alasan yang dipahami.
- [ ] `worker_connections` dihitung bersama file descriptor limit.
- [ ] `ulimit -n` dan systemd `LimitNOFILE` cukup.
- [ ] Access log memiliki upstream timing.
- [ ] Error log level sesuai production.
- [ ] Reload path diuji: `nginx -t && nginx -s reload`.
- [ ] Long-lived connections dipertimbangkan saat reload.
- [ ] Timeout client/Nginx/Java/downstream disejajarkan.
- [ ] Upstream capacity Java diketahui.
- [ ] Keepalive client dan upstream dipahami.
- [ ] Ada dashboard untuk 499/502/503/504.
- [ ] Ada alert untuk worker connection exhaustion.
- [ ] Ada runbook untuk bind failure, reload failure, upstream unavailable, dan disk full.

---

## 31. Apa yang Akan Dibahas di Part 002

Part 002 akan membahas:

# Installation, Packaging, Runtime Layout, and Environment Discipline

Fokusnya:

- cara install Nginx dengan benar,
- package manager vs official repository vs container image,
- stable vs mainline,
- struktur direktori runtime,
- systemd integration,
- Docker/Kubernetes runtime concerns,
- permission model,
- environment parity,
- cara membuat setup Nginx yang bisa dipahami, diuji, dan dioperasikan.

Part 001 memberi mental model runtime. Part 002 akan membuat model itu konkret di filesystem, service manager, dan deployment environment.

---

## 32. Referensi

Referensi utama yang relevan untuk Part 001:

1. NGINX Admin Guide — Runtime Control / Master and Worker Processes  
   <https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/>

2. Nginx Official Documentation — Controlling nginx  
   <https://nginx.org/en/docs/control.html>

3. Nginx Official Documentation — Core functionality / core module directives  
   <https://nginx.org/en/docs/ngx_core_module.html>

4. NGINX Engineering Blog — Inside NGINX: How We Designed for Performance & Scale  
   <https://blog.nginx.org/blog/inside-nginx-how-we-designed-for-performance-scale>

5. Nginx Official Documentation Index  
   <https://nginx.org/en/docs/>

---

# Status Seri

Seri belum selesai.

Progress saat ini:

- [x] Part 000 — Orientation: Nginx as Traffic Runtime, Not Just Web Server
- [x] Part 001 — Nginx Architecture: Master, Worker, Event Loop, and Request Lifecycle
- [ ] Part 002 — Installation, Packaging, Runtime Layout, and Environment Discipline
- [ ] Part 003 — Configuration Grammar: Directives, Contexts, Inheritance, and Evaluation Order
- [ ] Part 004 — Server Selection: `listen`, `server_name`, SNI, Default Server
- [ ] Part 005 — Location Matching Deep Dive
- [ ] Part 006 — Static File Serving: Root, Alias, Index, Try Files, and SPA Hosting
- [ ] Part 007 — Reverse Proxy Fundamentals for Java Backends
- [ ] Part 008 — Proxy Header Contract: The Boundary Between Nginx and Application
- [ ] Part 009 — Upstream Blocks and Load Balancing
- [ ] Part 010 — Timeouts, Retries, Buffering, and Backpressure
- [ ] Part 011 — Connection Management and Performance Tuning
- [ ] Part 012 — TLS Termination: Certificates, SNI, Protocols, Ciphers, and Java Implications
- [ ] Part 013 — HTTP/2, HTTP/3/QUIC, and Protocol-Level Trade-Offs
- [ ] Part 014 — Compression, Decompression, and Content Transformation
- [ ] Part 015 — Caching with Nginx: Reverse Proxy Cache as Performance and Resilience Tool
- [ ] Part 016 — Rate Limiting, Connection Limiting, and Abuse Resistance
- [ ] Part 017 — Access Control, Basic Auth, IP Rules, and Internal Endpoints
- [ ] Part 018 — Security Hardening: Headers, Request Limits, Path Safety, and Config Integrity
- [ ] Part 019 — Observability: Access Logs, Error Logs, Correlation IDs, and Metrics
- [ ] Part 020 — Debugging Nginx Like a Production Engineer
- [ ] Part 021 — Nginx and Java Application Servers
- [ ] Part 022 — WebSocket, SSE, gRPC, and Long-Lived Connections
- [ ] Part 023 — Blue-Green, Canary, Shadow Traffic, and Progressive Delivery
- [ ] Part 024 — Nginx as Lightweight API Gateway
- [ ] Part 025 — Nginx in Containers and Kubernetes
- [ ] Part 026 — Stream Module: TCP/UDP Proxying for Non-HTTP Traffic
- [ ] Part 027 — Config Design Patterns for Large Systems
- [ ] Part 028 — Production Failure Modeling and Incident Playbooks
- [ ] Part 029 — Performance Lab: Benchmarking, Capacity Planning, and Tuning Experiments
- [ ] Part 030 — Capstone: Designing a Production-Grade Nginx Front Door for Java Microservices

