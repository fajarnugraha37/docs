# learn-nginx-mastery-for-java-engineers-part-011.md

# Part 011 — Connection Management and Performance Tuning

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **011 dari 030**  
> Topik: **Connection Management and Performance Tuning**  
> Target pembaca: **Java software engineer / tech lead yang ingin memahami Nginx sebagai traffic runtime production**

---

## 0. Tujuan Bagian Ini

Bagian ini membahas bagaimana Nginx menangani koneksi dan bagaimana kita men-tuning Nginx secara rasional, bukan dengan menyalin konfigurasi dari internet.

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami hubungan antara:
   - `worker_processes`,
   - `worker_connections`,
   - file descriptor,
   - client connection,
   - upstream connection,
   - keepalive,
   - kernel socket queue.

2. Menghitung kapasitas koneksi Nginx secara konservatif.

3. Membedakan tuning untuk:
   - static file server,
   - reverse proxy,
   - API gateway ringan,
   - WebSocket/SSE,
   - high-throughput internal proxy.

4. Menghindari kesalahan umum seperti:
   - mengira `worker_connections` berarti jumlah user,
   - mengira `worker_processes * worker_connections` adalah kapasitas request per second,
   - menaikkan angka tanpa menaikkan OS limit,
   - mengaktifkan keepalive tanpa memahami dampaknya ke upstream Java,
   - melakukan benchmark yang tidak merepresentasikan production.

5. Membaca performa Nginx sebagai interaksi antara:
   - Nginx,
   - kernel,
   - network,
   - client behavior,
   - upstream Java runtime,
   - database/service dependency di belakang aplikasi.

---

## 1. Posisi Part Ini dalam Seri

Sebelumnya kita sudah membahas:

- Part 000: Nginx sebagai traffic runtime.
- Part 001: master process, worker process, event loop, request lifecycle.
- Part 002: instalasi, packaging, layout runtime.
- Part 003: grammar konfigurasi.
- Part 004: server selection.
- Part 005: location matching.
- Part 006: static file serving.
- Part 007: reverse proxy fundamentals.
- Part 008: proxy header contract.
- Part 009: upstream dan load balancing.
- Part 010: timeout, retry, buffering, dan backpressure.

Part ini mengikat semuanya ke satu pertanyaan production:

> Dengan traffic tertentu, berapa banyak koneksi yang bisa ditangani Nginx dengan aman, dan bagaimana kita tahu bottleneck-nya ada di Nginx, OS, network, atau backend Java?

---

## 2. Mental Model Utama

### 2.1 Nginx Tidak “Memproses User”; Nginx Mengelola Connection dan Event

Kesalahan pertama saat belajar Nginx adalah berpikir:

> “Berapa banyak user yang bisa ditangani Nginx?”

Pertanyaan yang lebih benar:

> “Berapa banyak koneksi aktif, idle, proxied, streaming, dan upstream yang sedang dikelola worker Nginx, dan berapa banyak file descriptor/kernel resource yang dibutuhkan?”

Dalam Nginx, unit kapasitas awal bukan user, bukan request per second, melainkan:

```text
connection
```

Satu user bisa punya banyak connection. Satu request proxied bisa memakai minimal dua sisi connection:

```text
client <-> nginx <-> upstream
```

Untuk request reverse proxy biasa, Nginx dapat memegang:

1. client-side connection,
2. upstream-side connection,
3. file descriptor tambahan untuk log, cache file, static file, temporary file, socket, pipe, dan lain-lain.

Jadi, ketika kamu melihat:

```nginx
events {
    worker_connections 4096;
}
```

jangan langsung menyimpulkan:

```text
Nginx bisa melayani 4096 user per worker.
```

Lebih akurat:

```text
Setiap worker bisa membuka sampai 4096 koneksi/file-handle relevan menurut batas Nginx, tetapi kapasitas aktual tetap dibatasi oleh OS file descriptor limit, karakteristik traffic, upstream connection, memory, CPU, network, dan konfigurasi lain.
```

Dokumentasi resmi Nginx menyatakan bahwa `worker_connections` menetapkan jumlah maksimum simultaneous connections yang dapat dibuka oleh satu worker process, dan jumlah itu mencakup koneksi ke proxied servers, bukan hanya koneksi client. Kapasitas aktual juga tidak bisa melebihi limit open files OS, yang dapat dipengaruhi oleh `worker_rlimit_nofile`.

---

## 3. Komponen Kapasitas Nginx

Kapasitas koneksi Nginx dipengaruhi oleh beberapa lapisan:

```text
Application-level traffic pattern
        |
        v
Nginx config
        |
        v
Nginx worker/event loop
        |
        v
OS file descriptor limit
        |
        v
Kernel TCP stack
        |
        v
NIC / network bandwidth
        |
        v
Upstream application capacity
```

Tidak ada satu directive yang sendirian menentukan performa.

Kamu harus melihatnya sebagai sistem.

---

## 4. `worker_processes`

### 4.1 Apa Itu `worker_processes`?

`worker_processes` menentukan berapa banyak worker process Nginx yang menjalankan event loop dan memproses request.

Contoh:

```nginx
worker_processes auto;
```

atau:

```nginx
worker_processes 4;
```

Master process mengelola lifecycle. Worker process melakukan pemrosesan request aktual.

Dokumentasi NGINX menjelaskan bahwa worker process melakukan pemrosesan request dan NGINX menggunakan mekanisme OS-dependent untuk mendistribusikan request secara efisien ke worker process; jumlah worker ditentukan oleh `worker_processes` dan bisa fixed atau otomatis mengikuti jumlah CPU core.

### 4.2 Kenapa Biasanya `auto`?

Untuk banyak deployment modern, default rasional adalah:

```nginx
worker_processes auto;
```

Alasannya:

1. Nginx event loop sangat efisien.
2. Biasanya satu worker per CPU core cukup untuk memanfaatkan CPU.
3. Terlalu banyak worker bisa menambah context switching.
4. Di container/Kubernetes, CPU quota perlu dipahami supaya `auto` tidak misleading pada runtime tertentu.

### 4.3 Worker Process Bukan Thread Pool Java

Sebagai Java engineer, jangan samakan `worker_processes` dengan Tomcat thread pool.

Di Tomcat classic servlet model:

```text
request -> thread
```

Di Nginx:

```text
many connections -> event loop worker
```

Satu worker Nginx bisa menangani ribuan connection karena ia tidak membuat satu thread per connection.

Namun ini bukan berarti unlimited. Bottleneck tetap bisa muncul pada:

- CPU parsing/encryption/compression,
- memory buffer,
- file descriptor,
- kernel socket queue,
- upstream latency,
- disk I/O untuk logging/cache/static,
- network bandwidth.

### 4.4 Kapan Tidak Menggunakan `auto`?

`auto` biasanya baik, tetapi tidak selalu cukup.

Pertimbangkan fixed value jika:

1. Kamu menjalankan Nginx di container dengan CPU quota yang aneh.
2. Kamu ingin membatasi CPU consumption.
3. Nginx hanya sidecar kecil di samping service Java.
4. Ada workload TLS/compression berat dan kamu ingin eksperimen terkontrol.
5. Kamu melakukan benchmark terisolasi.

Contoh sidecar ringan:

```nginx
worker_processes 1;
```

Contoh edge proxy pada VM dedicated:

```nginx
worker_processes auto;
```

---

## 5. `worker_connections`

### 5.1 Apa Itu `worker_connections`?

`worker_connections` berada di context `events`:

```nginx
events {
    worker_connections 4096;
}
```

Directive ini menentukan batas maksimum connection yang bisa dibuka oleh satu worker.

Formula kasar yang sering disebut:

```text
max theoretical connections = worker_processes * worker_connections
```

Namun formula ini terlalu sederhana untuk reverse proxy.

### 5.2 Kenapa Formula Sederhana Bisa Menyesatkan?

Untuk static file serving, satu client connection mungkin cukup dekat dengan satu active connection di Nginx.

Namun untuk reverse proxy:

```text
client connection + upstream connection
```

Jika semua request aktif sedang diteruskan ke upstream, kebutuhan connection bisa mendekati:

```text
connections_needed ≈ client_connections + upstream_connections
```

Misalnya:

```text
10.000 active client connections
10.000 active upstream connections
--------------------------------
≈ 20.000 Nginx-managed connections
```

Belum termasuk:

- keepalive idle connection,
- WebSocket,
- SSE,
- cache file,
- log file,
- temporary files,
- DNS resolver sockets,
- monitoring connections.

Jadi konfigurasi:

```nginx
worker_processes 4;

events {
    worker_connections 4096;
}
```

memberikan kapasitas teoritis:

```text
4 * 4096 = 16384 connection
```

Tetapi untuk reverse proxy aktif, 16.384 connection ini bisa berarti jauh kurang dari 16.384 client aktif.

### 5.3 Rule of Thumb yang Lebih Aman

Untuk reverse proxy HTTP biasa:

```text
required_worker_capacity >= client_connections + active_upstream_connections + idle_upstream_keepalive + margin
```

Margin minimal:

```text
20% - 50%
```

Untuk WebSocket/SSE/gRPC streaming, margin harus lebih besar karena connection lifetime panjang.

---

## 6. File Descriptor: Limit yang Sering Dilupakan

### 6.1 Apa Itu File Descriptor?

Di Linux/Unix, socket, file, pipe, dan banyak resource I/O direpresentasikan sebagai file descriptor.

Nginx membutuhkan file descriptor untuk:

- client socket,
- upstream socket,
- listening socket,
- log file,
- static file,
- cache file,
- temporary file,
- resolver socket,
- control channel internal.

Jika file descriptor habis, Nginx bisa gagal menerima koneksi baru atau gagal membuka file.

Gejala umum:

```text
Too many open files
```

atau error pada accept/open/connect.

### 6.2 Limit Berlapis

Ada beberapa level limit:

1. Kernel-wide file maximum.
2. User-level limit.
3. Service-level systemd limit.
4. Process-level limit.
5. Nginx `worker_rlimit_nofile`.
6. `worker_connections`.

Menaikkan `worker_connections` tanpa menaikkan OS/systemd limit sering tidak berguna.

### 6.3 Mengecek Limit

Pada shell:

```bash
ulimit -n
```

Untuk proses Nginx:

```bash
ps aux | grep nginx
cat /proc/<worker-pid>/limits | grep "Max open files"
```

Untuk systemd service:

```bash
systemctl show nginx | grep LimitNOFILE
```

### 6.4 Mengatur Limit di Nginx

Contoh:

```nginx
worker_rlimit_nofile 65535;
```

Namun ini tidak otomatis mengalahkan semua limit OS/service. Untuk systemd, kamu biasanya perlu override:

```ini
# /etc/systemd/system/nginx.service.d/override.conf
[Service]
LimitNOFILE=65535
```

Lalu:

```bash
sudo systemctl daemon-reload
sudo systemctl restart nginx
```

### 6.5 Prinsip

Jangan hanya menaikkan angka karena terlihat “lebih production”.

Pastikan:

```text
worker_processes * worker_connections <= practical file descriptor budget
```

Tetapi ingat, file descriptor budget juga dipakai oleh resource lain selain connection.

---

## 7. Capacity Estimation Model

### 7.1 Model Sederhana

Misalkan:

```text
worker_processes = 4
worker_connections = 8192
```

Maka theoretical Nginx connection slots:

```text
4 * 8192 = 32768
```

Untuk reverse proxy:

```text
active client connections = 12000
active upstream connections = 8000
idle upstream keepalive = 1000
other FD/resource margin = 2000
```

Total estimated:

```text
12000 + 8000 + 1000 + 2000 = 23000
```

Dengan capacity 32768, konfigurasi ini mungkin cukup.

Namun jika traffic adalah WebSocket:

```text
client WebSocket connections = 20000
upstream WebSocket connections = 20000
margin = 5000
```

Total:

```text
45000
```

Maka kapasitas 32768 tidak cukup.

### 7.2 Formula Praktis

Gunakan ini sebagai awal:

```text
required_connection_slots =
  peak_client_connections
+ peak_active_upstream_connections
+ configured_idle_upstream_keepalive
+ expected_static_file_opening
+ logging/cache/temp overhead
+ safety_margin
```

Lalu:

```text
worker_processes * worker_connections >= required_connection_slots
```

Dan:

```text
process_open_file_limit >= worker_connections + overhead_per_worker
```

### 7.3 RPS Bukan Connection

Request per second dan connection count berbeda.

Contoh A:

```text
1000 RPS
response time 10 ms
keepalive pendek
```

Active concurrency bisa kecil.

Contoh B:

```text
100 RPS
response time 30 seconds
long polling
```

Active concurrency bisa besar.

Gunakan Little's Law:

```text
concurrency ≈ throughput * latency
```

Jika:

```text
throughput = 1000 req/s
average duration = 0.2 s
```

Maka:

```text
active requests ≈ 200
```

Jika:

```text
throughput = 1000 req/s
average duration = 5 s
```

Maka:

```text
active requests ≈ 5000
```

Karena itu, timeout dan upstream latency sangat memengaruhi connection pressure.

---

## 8. `worker_cpu_affinity`

### 8.1 Apa Itu CPU Affinity?

`worker_cpu_affinity` mengikat worker process ke CPU tertentu.

Contoh:

```nginx
worker_processes 4;
worker_cpu_affinity auto;
```

Atau manual bitmask:

```nginx
worker_processes 4;
worker_cpu_affinity 0001 0010 0100 1000;
```

### 8.2 Kapan Berguna?

Bisa berguna untuk:

- high-performance bare metal,
- predictable CPU cache locality,
- workload TLS/compression berat,
- environment dengan traffic sangat besar.

Namun untuk kebanyakan sistem aplikasi biasa, ini bukan tuning pertama.

### 8.3 Risiko Over-Tuning

CPU affinity yang salah bisa menyebabkan:

- worker terikat ke CPU yang sama,
- CPU imbalance,
- sulit di-debug,
- hasil benchmark bagus tapi production buruk.

Prinsip:

> Gunakan CPU affinity hanya setelah ada bukti CPU scheduling menjadi bottleneck.

---

## 9. `accept_mutex` dan `multi_accept`

### 9.1 Masalah yang Diselesaikan

Ketika banyak worker menunggu connection baru pada listening socket yang sama, OS harus mendistribusikan koneksi masuk ke worker.

Nginx memiliki directive seperti:

```nginx
events {
    accept_mutex off;
    multi_accept off;
}
```

Namun behavior default dan relevansinya bergantung versi, OS, dan mekanisme event.

### 9.2 `accept_mutex`

Secara historis, `accept_mutex` digunakan agar tidak semua worker berebut menerima koneksi baru pada saat bersamaan.

Di banyak Linux modern dengan mekanisme seperti `EPOLLEXCLUSIVE`, kebutuhan tuning manual ini berkurang.

Untuk kebanyakan deployment modern:

```text
jangan ubah accept_mutex kecuali punya alasan dan hasil pengukuran.
```

### 9.3 `multi_accept`

`multi_accept` mengontrol apakah worker menerima satu koneksi baru pada satu waktu atau menerima semua koneksi baru yang tersedia.

Contoh:

```nginx
events {
    multi_accept on;
}
```

Ini bisa meningkatkan agresivitas accept connection, tetapi bisa juga membuat satu worker mengambil terlalu banyak koneksi baru dan menyebabkan distribusi kurang merata.

### 9.4 Prinsip

Untuk production umum:

```nginx
events {
    worker_connections 4096;
    # Biarkan accept_mutex dan multi_accept default kecuali ada bukti.
}
```

Tuning event accept bukan langkah pertama. Langkah pertama adalah memahami:

- connection count,
- FD limit,
- timeout,
- upstream capacity,
- keepalive,
- CPU/network saturation.

---

## 10. Event Method: `epoll`, `kqueue`, dan Teman-Temannya

### 10.1 Apa Itu Event Method?

Nginx memakai mekanisme event OS untuk menunggu banyak socket secara efisien.

Contoh mekanisme:

- Linux: `epoll`,
- BSD/macOS: `kqueue`,
- Solaris: `/dev/poll`, `eventport`,
- fallback: `poll`, `select`.

Biasanya Nginx memilih metode terbaik secara otomatis.

### 10.2 Apakah Perlu Menulis `use epoll;`?

Di Linux modern, biasanya tidak perlu.

Kamu bisa saja menulis:

```nginx
events {
    use epoll;
    worker_connections 4096;
}
```

Tetapi untuk konfigurasi portable, sering lebih baik membiarkan Nginx memilih otomatis.

### 10.3 Kapan Relevan?

Relevan jika:

- membangun Nginx dari source,
- menjalankan OS khusus,
- debugging performance aneh,
- environment embedded/legacy,
- melakukan benchmark low-level.

Untuk sistem Java web biasa, ini bukan area tuning harian.

---

## 11. Keepalive: Client Side vs Upstream Side

### 11.1 Dua Jenis Keepalive yang Harus Dipisah

Nginx punya dua sisi koneksi:

```text
client <-> nginx <-> upstream
```

Jadi ada dua jenis keepalive yang berbeda:

1. Client keepalive:

```text
browser/client tetap membuka koneksi ke Nginx
```

2. Upstream keepalive:

```text
Nginx tetap membuka koneksi reusable ke backend Java
```

Jangan campur keduanya.

---

## 12. Client Keepalive

### 12.1 `keepalive_timeout`

Contoh:

```nginx
http {
    keepalive_timeout 65s;
}
```

Ini menentukan berapa lama Nginx mempertahankan idle client connection sebelum ditutup.

### 12.2 Trade-Off

Keepalive lebih tinggi:

Keuntungan:

- mengurangi TCP handshake,
- mengurangi TLS handshake,
- menurunkan latency untuk request berikutnya,
- bagus untuk browser dan mobile client dengan banyak request kecil.

Kerugian:

- idle connection menghabiskan connection slot,
- bisa meningkatkan file descriptor usage,
- bisa membuat worker_connections penuh oleh idle client,
- bisa memperbesar dampak slow client.

Keepalive terlalu rendah:

Keuntungan:

- mengurangi idle connection pressure.

Kerugian:

- handshake lebih sering,
- CPU TLS meningkat,
- latency naik,
- client experience buruk.

### 12.3 Rule of Thumb

Untuk public web/API biasa:

```nginx
keepalive_timeout 30s;
```

atau:

```nginx
keepalive_timeout 65s;
```

Keduanya bisa masuk akal tergantung traffic.

Untuk high-concurrency API dengan client yang membuka banyak idle connection, bisa lebih konservatif:

```nginx
keepalive_timeout 15s;
```

Namun jangan tuning hanya berdasarkan preferensi. Ukur:

- active connections,
- idle connections,
- TLS CPU,
- request latency,
- reconnect rate,
- client behavior.

---

## 13. Upstream Keepalive

### 13.1 Kenapa Upstream Keepalive Penting?

Tanpa upstream keepalive, Nginx dapat membuka koneksi baru ke backend untuk request proxied. Pada traffic tinggi, ini menyebabkan overhead:

- TCP handshake,
- TLS handshake jika upstream HTTPS,
- kernel socket churn,
- ephemeral port pressure,
- CPU overhead di Nginx dan Java backend,
- latency tambahan.

Dengan upstream keepalive, Nginx menyimpan pool koneksi idle ke backend untuk reuse.

### 13.2 Contoh Konfigurasi

```nginx
upstream java_api {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;

    keepalive 64;
}

server {
    listen 80;

    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_pass http://java_api;
    }
}
```

Catatan penting:

```nginx
proxy_http_version 1.1;
proxy_set_header Connection "";
```

Sering dibutuhkan agar upstream keepalive efektif untuk HTTP/1.1 proxying.

### 13.3 Apa Arti `keepalive 64`?

Di upstream block:

```nginx
keepalive 64;
```

Ini bukan maksimum total koneksi aktif ke upstream.

Ini adalah jumlah idle keepalive connections yang disimpan per worker untuk upstream tersebut.

Jika:

```text
worker_processes = 4
upstream keepalive = 64
```

Maka idle upstream connection pool maksimum secara kasar:

```text
4 * 64 = 256 idle upstream connections
```

Belum termasuk active connections.

### 13.4 Dampak ke Backend Java

Misalnya kamu punya:

```text
4 Nginx workers
3 upstream Java instances
keepalive 128
```

Potensi idle upstream sockets bisa cukup besar.

Jika banyak Nginx instance di depan banyak Java pod, total connection ke Java bisa meledak.

Contoh:

```text
10 Nginx pods
4 workers per pod
keepalive 64
--------------------------------
10 * 4 * 64 = 2560 idle upstream connections
```

Jika hanya ada 4 Java pods:

```text
≈ 640 idle connections per Java pod
```

Itu belum active request.

Untuk Java backend, ini bisa memengaruhi:

- accept queue,
- socket memory,
- Tomcat/Jetty/Netty connection handling,
- metrics active/idle connection,
- max connections,
- graceful shutdown,
- rolling deployment drain.

### 13.5 Keepalive Bukan Thread Pool

Idle connection ke Java bukan berarti thread aktif di Tomcat. Namun tetap resource.

Pada servlet container, thread biasanya dipakai saat request aktif. Tetapi socket tetap dikelola connector/runtime.

Untuk Netty/reactive backend, idle connection tetap bagian dari event loop dan socket resource.

---

## 14. HTTP/1.1, HTTP/2, dan Connection Multiplexing

### 14.1 HTTP/1.1

HTTP/1.1 keepalive membuat beberapa request sequential dapat memakai koneksi yang sama.

Namun satu koneksi HTTP/1.1 biasanya tidak memproses banyak request response secara paralel secara bebas seperti HTTP/2 multiplexing.

### 14.2 HTTP/2 Client Side

Jika client berbicara HTTP/2 ke Nginx:

```text
client --HTTP/2--> nginx
```

Banyak stream bisa berjalan di satu connection.

Tetapi Nginx ke upstream belum tentu HTTP/2:

```text
nginx --HTTP/1.1--> Java upstream
```

Jadi client connection count bisa kecil, tetapi upstream connection/request pressure tetap besar.

### 14.3 Konsekuensi Capacity

Dengan HTTP/2:

```text
client_connections rendah
active_requests tinggi
upstream_connections tetap bisa tinggi
```

Maka jangan hanya melihat jumlah client connections. Lihat juga:

- active requests,
- upstream response time,
- upstream connection count,
- worker CPU,
- memory buffer.

---

## 15. `sendfile`

### 15.1 Apa Itu `sendfile`?

`sendfile` memungkinkan kernel mengirim file dari disk/page cache ke socket lebih efisien, sering tanpa copy berlebih ke userspace.

Contoh:

```nginx
http {
    sendfile on;
}
```

Ini sangat relevan untuk static file serving.

### 15.2 Kapan Mengaktifkan?

Untuk static assets production:

```nginx
sendfile on;
```

Biasanya masuk akal.

Untuk reverse proxy murni, dampaknya lebih kecil karena response berasal dari upstream, bukan file lokal.

### 15.3 Risiko di Development

Di environment tertentu seperti shared filesystem, VM mount, Docker bind mount, atau network filesystem, `sendfile` pernah menyebabkan file lama/aneh tersaji karena interaksi filesystem/cache.

Untuk local development dengan bind mount, kadang orang mematikan:

```nginx
sendfile off;
```

Namun untuk production static serving di filesystem normal, `sendfile on` biasanya tepat.

---

## 16. `tcp_nopush` dan `tcp_nodelay`

### 16.1 `tcp_nopush`

Contoh:

```nginx
http {
    sendfile on;
    tcp_nopush on;
}
```

`tcp_nopush` berkaitan dengan pengiriman packet secara efisien, terutama ketika `sendfile` aktif.

Tujuannya adalah mengirim header dan awal file secara lebih optimal, mengurangi packet kecil yang tidak perlu.

### 16.2 `tcp_nodelay`

Contoh:

```nginx
http {
    tcp_nodelay on;
}
```

`tcp_nodelay` menonaktifkan Nagle algorithm pada koneksi keepalive agar response kecil tidak tertunda.

### 16.3 Jangan Menghafal, Pahami Trade-Off

Secara umum:

```nginx
sendfile on;
tcp_nopush on;
tcp_nodelay on;
```

sering terlihat di konfigurasi production.

Namun efeknya bergantung workload:

- static large files,
- small API responses,
- TLS,
- buffering,
- kernel version,
- network latency,
- client behavior.

Jangan mengira tiga directive ini otomatis membuat sistem cepat. Mereka hanya mengoptimalkan mekanisme pengiriman, bukan memperbaiki backend lambat atau timeout buruk.

---

## 17. Listen Backlog dan Kernel Queue

### 17.1 Apa Itu Backlog?

Ketika client membuka koneksi TCP, kernel menyimpan koneksi yang menunggu diterima aplikasi di queue.

Di Nginx, `listen` bisa diberi backlog:

```nginx
server {
    listen 80 backlog=4096;
}
```

Namun nilai efektif juga bergantung kernel setting seperti:

```bash
sysctl net.core.somaxconn
```

### 17.2 Kapan Backlog Penting?

Backlog penting saat:

- traffic burst tinggi,
- worker lambat accept connection,
- CPU saturation,
- TLS handshake berat,
- SYN flood/abuse,
- deployment reload dengan traffic besar.

### 17.3 Gejala Queue Bermasalah

Gejala dapat berupa:

- connection timeout,
- connection refused,
- SYN retransmission,
- spike latency sebelum Nginx log muncul,
- load balancer melihat target unhealthy.

Jika request tidak sampai ke access log Nginx, kemungkinan masalah terjadi sebelum request diproses Nginx:

```text
client -> network -> LB -> kernel TCP queue -> nginx accept -> access log
```

---

## 18. OS Kernel Tuning: Jangan Mulai dari Sini

Kernel tuning bisa penting, tetapi jangan dimulai dari sana.

Urutan yang lebih sehat:

1. Pahami traffic pattern.
2. Pastikan Nginx config benar.
3. Pastikan timeout/retry/buffering masuk akal.
4. Pastikan upstream Java tidak bottleneck.
5. Pastikan file descriptor cukup.
6. Ukur CPU/memory/network.
7. Baru tuning kernel jika evidence mengarah ke sana.

Kernel tuning yang umum muncul:

```bash
net.core.somaxconn
net.ipv4.tcp_max_syn_backlog
net.ipv4.ip_local_port_range
net.ipv4.tcp_tw_reuse
net.core.netdev_max_backlog
fs.file-max
```

Namun setiap setting punya konsekuensi. Jangan copy-paste sysctl tuning dari blog tanpa memahami workload.

---

## 19. Ephemeral Port Exhaustion

### 19.1 Apa Itu Ephemeral Port?

Saat Nginx membuat koneksi outbound ke upstream, OS memakai ephemeral port lokal.

Contoh:

```text
nginx_ip:ephemeral_port -> upstream_ip:8080
```

Jika Nginx sering membuka dan menutup koneksi ke upstream tanpa keepalive, ephemeral port bisa habis atau banyak tertahan di `TIME_WAIT`.

### 19.2 Gejala

Gejala dapat berupa:

- gagal connect ke upstream,
- intermittent 502,
- connect timeout,
- banyak socket `TIME_WAIT`,
- error `cannot assign requested address`.

Cek:

```bash
ss -tan state time-wait | wc -l
ss -tan sport :8080
cat /proc/sys/net/ipv4/ip_local_port_range
```

### 19.3 Mitigasi

Mitigasi umum:

1. Aktifkan upstream keepalive.
2. Hindari upstream DNS/IP tunggal jika bisa.
3. Pastikan timeout tidak menyebabkan churn tinggi.
4. Perluas ephemeral port range jika evidence kuat.
5. Gunakan multiple source IP jika skala sangat besar.
6. Kurangi connect/disconnect storm.

---

## 20. Memory Model untuk Nginx

Nginx ringan, tetapi bukan tanpa memory.

Memory dipakai untuk:

- connection structure,
- request buffer,
- response buffer,
- header buffer,
- proxy buffer,
- cache metadata,
- SSL session data,
- compression buffers,
- resolver data,
- module-specific state.

### 20.1 Connection Count Naik, Memory Naik

Banyak idle connection tetap membutuhkan memory.

Banyak active request dengan body besar membutuhkan memory/temp file lebih besar.

Banyak response buffering bisa meningkatkan memory dan disk temp usage.

### 20.2 Proxy Buffering

Walaupun dibahas di Part 010, hubungannya dengan capacity sangat penting.

Jika `proxy_buffering on`, Nginx dapat membaca response dari upstream dan menyimpannya di buffer/temp file sebelum client selesai membaca.

Keuntungan:

- upstream Java cepat bebas,
- slow client tidak menahan backend terlalu lama.

Kerugian:

- Nginx memory/disk usage naik,
- disk I/O bisa jadi bottleneck,
- streaming tidak cocok.

Jika `proxy_buffering off`, upstream Java lebih langsung terikat ke kecepatan client.

Keuntungan:

- cocok untuk streaming/SSE.

Kerugian:

- slow client bisa menahan upstream connection/thread/resource.

---

## 21. CPU Bottleneck

Nginx CPU bisa naik karena:

- TLS handshake,
- TLS bulk encryption,
- gzip/Brotli compression,
- regex location/map kompleks,
- access logging sangat berat,
- JSON log string building,
- high RPS small requests,
- upstream retry storm,
- cache key calculation,
- WAF/security module,
- Lua/njs/custom module logic.

### 21.1 Cara Membaca CPU

Cek:

```bash
top -H -p <nginx-worker-pid>
pidstat -p <pid> 1
mpstat -P ALL 1
```

Jika satu core penuh dan worker sedikit, pertimbangkan `worker_processes`.

Jika semua core penuh, bukan sekadar tambah worker. Kamu perlu lihat:

- TLS offload,
- compression level,
- logging volume,
- upstream latency/retry,
- kernel/network saturation,
- benchmark realism.

---

## 22. Disk I/O Bottleneck

Nginx bisa memakai disk untuk:

- access log,
- error log,
- static file read,
- proxy temp file,
- client body temp file,
- cache storage.

### 22.1 Access Log Bisa Mahal

Pada traffic tinggi, access log bisa menjadi bottleneck.

Gejala:

- disk utilization tinggi,
- iowait naik,
- latency naik,
- log filesystem penuh,
- Nginx worker blocked pada I/O tertentu.

Mitigasi:

- log format efisien,
- log sampling untuk endpoint high-volume jika acceptable,
- async log pipeline via stdout collector di container,
- disk cepat,
- logrotate benar,
- pisahkan cache/temp/log disk,
- jangan log body atau sensitive headers.

### 22.2 Static File dan Page Cache

Static serving cepat biasanya bergantung pada OS page cache.

Benchmark pertama setelah restart bisa berbeda dari benchmark setelah cache warm.

Jangan menyimpulkan performa static file tanpa membedakan:

```text
cold cache vs warm cache
```

---

## 23. Network Bottleneck

Nginx sering sangat efisien sampai bottleneck pindah ke network.

Cek:

```bash
sar -n DEV 1
iftop
nload
ethtool -S <iface>
```

Indikator:

- bandwidth mendekati limit NIC,
- packet drops,
- retransmission tinggi,
- uneven traffic antar interface,
- MTU issue,
- load balancer network cap.

Untuk cloud environment, network limit sering tergantung instance type, bukan hanya CPU.

---

## 24. Java Backend Interaction

### 24.1 Nginx Bisa Lebih Cepat dari Backend

Nginx sering mampu menerima traffic jauh lebih cepat daripada aplikasi Java memprosesnya.

Jika tidak hati-hati, Nginx dapat menjadi “pressure amplifier”:

```text
client burst -> nginx accepts -> upstream queue/thread pool/db overloaded
```

Karena itu tuning Nginx harus diselaraskan dengan:

- Tomcat max threads,
- Tomcat accept count,
- max connections,
- HikariCP pool size,
- database connection limit,
- request timeout aplikasi,
- circuit breaker,
- bulkhead,
- rate limit,
- readiness/liveness behavior.

### 24.2 Example: Tomcat Thread Pool

Misalnya Spring Boot Tomcat:

```properties
server.tomcat.threads.max=200
server.tomcat.accept-count=100
server.tomcat.max-connections=8192
```

Jika Nginx mengirim ribuan concurrent upstream requests ke satu instance, tetapi Tomcat hanya punya 200 worker threads, maka sisanya akan queue atau timeout.

Nginx mungkin terlihat sehat, tetapi backend latency naik.

### 24.3 Connection Capacity ≠ Processing Capacity

Backend bisa menerima banyak TCP connection tetapi hanya memproses sedikit request paralel.

Untuk servlet blocking:

```text
processing concurrency ≈ thread pool capacity
```

Untuk reactive Netty:

```text
processing concurrency ≈ event loop + downstream async dependency capacity
```

Jika downstream database blocking, reactive tidak otomatis menyelamatkan.

---

## 25. Recommended Baseline Configurations

### 25.1 General Reverse Proxy Baseline

```nginx
user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;

pid /run/nginx.pid;

error_log /var/log/nginx/error.log warn;

events {
    worker_connections 8192;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;

    keepalive_timeout 30s;
    keepalive_requests 1000;

    server_tokens off;

    log_format main '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    'rt=$request_time '
                    'uct=$upstream_connect_time '
                    'uht=$upstream_header_time '
                    'urt=$upstream_response_time';

    access_log /var/log/nginx/access.log main;

    upstream java_api {
        server 10.0.1.10:8080;
        server 10.0.1.11:8080;
        keepalive 64;
    }

    server {
        listen 80;
        server_name example.com;

        location /api/ {
            proxy_http_version 1.1;
            proxy_set_header Connection "";

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout 2s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;

            proxy_pass http://java_api;
        }
    }
}
```

### 25.2 Static Asset Heavy Baseline

```nginx
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 8192;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;

    keepalive_timeout 65s;

    server {
        listen 80;
        server_name static.example.com;

        root /var/www/static;

        location /assets/ {
            try_files $uri =404;
            expires 1y;
            add_header Cache-Control "public, max-age=31536000, immutable" always;
        }
    }
}
```

### 25.3 WebSocket/SSE-Aware Baseline

```nginx
worker_processes auto;
worker_rlimit_nofile 131072;

events {
    worker_connections 16384;
}

http {
    keepalive_timeout 30s;

    upstream realtime_backend {
        server 10.0.2.10:8080;
        server 10.0.2.11:8080;
        keepalive 128;
    }

    server {
        listen 80;
        server_name realtime.example.com;

        location /ws/ {
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";

            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_read_timeout 1h;
            proxy_send_timeout 1h;

            proxy_pass http://realtime_backend;
        }

        location /events/ {
            proxy_http_version 1.1;
            proxy_set_header Connection "";

            proxy_buffering off;
            proxy_read_timeout 1h;

            proxy_pass http://realtime_backend;
        }
    }
}
```

Catatan: untuk long-lived connection, `worker_connections` dan FD limit perlu dihitung jauh lebih serius.

---

## 26. Tuning Anti-Patterns

### 26.1 Anti-Pattern: Copy-Paste “Ultimate Nginx Config”

Contoh buruk:

```nginx
worker_processes 16;
worker_rlimit_nofile 999999;

events {
    worker_connections 999999;
    multi_accept on;
}
```

Masalah:

- tidak sesuai CPU,
- tidak sesuai memory,
- tidak sesuai OS limit,
- tidak sesuai upstream capacity,
- tidak sesuai traffic,
- sulit di-debug,
- memberikan rasa aman palsu.

### 26.2 Anti-Pattern: Mengira RPS Sama dengan Connection

Salah:

```text
worker_connections 4096 berarti 4096 request per second.
```

Benar:

```text
worker_connections membatasi simultaneous connections per worker, bukan RPS.
```

### 26.3 Anti-Pattern: Menaikkan Keepalive Tanpa Melihat Idle Connection

Keepalive tinggi bisa bagus, tetapi jika traffic memiliki banyak client idle, connection slots akan terisi.

### 26.4 Anti-Pattern: Tuning Nginx untuk Menutupi Backend Lambat

Jika backend Java lambat karena DB query, GC pause, lock contention, atau thread pool penuh, menaikkan worker_connections hanya membuat antrean lebih besar.

Itu bukan scaling. Itu menunda failure.

### 26.5 Anti-Pattern: Benchmark dari Laptop ke Server

Benchmark dari satu laptop sering mengukur laptop/network path, bukan Nginx.

Gunakan load generator yang cukup kuat dan dekat secara network.

---

## 27. Observability untuk Connection Management

### 27.1 Metrics yang Perlu Dilihat

Minimal:

- active connections,
- reading/writing/waiting connections,
- requests per second,
- status code distribution,
- upstream response time,
- upstream connect time,
- Nginx worker CPU,
- memory RSS,
- open file descriptors,
- socket states,
- network throughput,
- retransmission,
- disk I/O,
- error log rate.

### 27.2 Stub Status

Jika module tersedia:

```nginx
location /nginx_status {
    stub_status;
    allow 127.0.0.1;
    deny all;
}
```

Output tipikal:

```text
Active connections: 291
server accepts handled requests
 16630948 16630948 31070465
Reading: 6 Writing: 179 Waiting: 106
```

Interpretasi:

- `Active`: semua active client connections.
- `Reading`: Nginx sedang membaca request header.
- `Writing`: Nginx sedang menulis response ke client.
- `Waiting`: idle keepalive connections.

Jika `Waiting` sangat tinggi, client keepalive mungkin dominan.

Jika `Writing` tinggi dan upstream lambat/clients lambat, analisis lebih lanjut dibutuhkan.

### 27.3 Open FD Count

```bash
ls /proc/<nginx-worker-pid>/fd | wc -l
```

Atau:

```bash
lsof -p <pid> | wc -l
```

### 27.4 Socket State

```bash
ss -s
ss -tan | awk '{print $1}' | sort | uniq -c
```

Lihat state seperti:

- ESTAB,
- TIME-WAIT,
- SYN-SENT,
- SYN-RECV,
- CLOSE-WAIT.

Banyak `CLOSE-WAIT` bisa menandakan aplikasi tidak menutup socket dengan benar.

Banyak `TIME-WAIT` bisa normal pada high churn, tetapi juga bisa menandakan lack of keepalive atau connect/disconnect storm.

---

## 28. Diagnosing Common Performance Symptoms

### 28.1 Error: `worker_connections are not enough`

Kemungkinan:

- `worker_connections` terlalu rendah,
- idle keepalive terlalu banyak,
- WebSocket/SSE connection tinggi,
- upstream connection juga dihitung,
- FD limit terlalu rendah,
- traffic burst tidak ditangani.

Langkah:

```bash
nginx -T | grep worker_connections
cat /proc/<pid>/limits | grep "Max open files"
ls /proc/<pid>/fd | wc -l
ss -s
```

Perbaikan:

- naikkan `worker_connections`,
- naikkan `worker_rlimit_nofile`,
- set systemd `LimitNOFILE`,
- evaluasi keepalive timeout,
- evaluasi long-lived traffic,
- scale out Nginx jika perlu.

### 28.2 Banyak 502

Kemungkinan:

- upstream refused connection,
- upstream down,
- ephemeral port exhaustion,
- upstream keepalive stale,
- backend max connection penuh,
- DNS/resolution issue,
- timeout terlalu pendek,
- deploy/restart backend tidak graceful.

Debug:

```bash
grep 'connect() failed' /var/log/nginx/error.log
ss -tan state syn-sent
ss -tan state time-wait | wc -l
curl -v http://upstream:8080/health
```

### 28.3 Banyak 504

Kemungkinan:

- upstream lambat,
- `proxy_read_timeout` tercapai,
- backend thread pool penuh,
- DB lambat,
- retry memperparah beban,
- Nginx menunggu response header terlalu lama.

Debug:

- lihat `$upstream_response_time`,
- lihat backend logs,
- lihat DB metrics,
- lihat thread dump Java,
- lihat GC pause,
- lihat queue depth.

### 28.4 Banyak 499

499 berarti client menutup connection sebelum Nginx selesai merespons.

Kemungkinan:

- client timeout lebih pendek dari backend latency,
- mobile network buruk,
- load balancer timeout,
- frontend abort request,
- user navigasi away,
- backend terlalu lambat.

Jangan langsung menyalahkan Nginx.

### 28.5 Latency Tinggi tapi CPU Rendah

Kemungkinan:

- upstream lambat,
- network latency,
- queue di backend,
- disk I/O untuk temp/cache/log,
- DNS lookup,
- connection pool exhaustion,
- client slow read.

CPU rendah bukan berarti sistem sehat.

---

## 29. Benchmarking dengan Benar

### 29.1 Apa yang Harus Dibedakan

Benchmark berbeda untuk:

1. Static file serving.
2. Reverse proxy ke mock upstream cepat.
3. Reverse proxy ke Java app nyata.
4. TLS termination.
5. Compression.
6. Cache hit.
7. Cache miss.
8. WebSocket/SSE long-lived connections.
9. Burst traffic.
10. Slow client behavior.

Jangan campur semuanya lalu menyimpulkan satu angka.

### 29.2 Tools

Umum digunakan:

- `wrk`,
- `hey`,
- `vegeta`,
- `ab` untuk sederhana,
- k6,
- Gatling,
- JMeter.

Untuk Java engineer, Gatling/k6 sering lebih cocok untuk scenario-level testing, sedangkan `wrk` bagus untuk HTTP load baseline.

### 29.3 Contoh Benchmark Sederhana

```bash
wrk -t4 -c400 -d60s http://nginx.example.com/api/health
```

Artinya:

- `-t4`: 4 thread load generator,
- `-c400`: 400 concurrent connections,
- `-d60s`: durasi 60 detik.

Tapi hati-hati:

```text
400 concurrent connections dari wrk bukan sama dengan 400 real users.
```

### 29.4 Jangan Abaikan Load Generator

Pastikan load generator tidak bottleneck:

- CPU cukup,
- network cukup,
- ephemeral port cukup,
- tidak satu mesin kecil melawan server besar,
- test dari beberapa generator jika perlu.

### 29.5 Ukur p95/p99, Bukan Hanya Average

Average bisa menipu.

Production experience lebih ditentukan oleh tail latency:

- p95,
- p99,
- p99.9,
- timeout rate,
- error rate.

### 29.6 Coordinated Omission

Beberapa benchmark tool bisa menyembunyikan latency buruk karena tidak mengirim request baru saat menunggu response lama.

Untuk sistem production, gunakan pendekatan yang menjaga arrival rate realistis jika ingin melihat queueing behavior.

---

## 30. Tuning Workflow yang Rasional

Gunakan urutan ini.

### Step 1 — Definisikan Workload

Tulis:

```text
Traffic type: API / static / WebSocket / SSE / mixed
Peak RPS:
Peak concurrent clients:
Average response time:
p95 response time:
Max request body:
Max response body:
TLS: yes/no
Compression: yes/no
Cache: yes/no
Upstream count:
Backend capacity:
```

### Step 2 — Hitung Connection Budget

```text
client_connections
+ upstream_connections
+ idle keepalive
+ long-lived streams
+ margin
```

### Step 3 — Cocokkan dengan Nginx Config

```text
worker_processes * worker_connections
```

### Step 4 — Cocokkan dengan OS Limit

```text
ulimit / systemd LimitNOFILE / worker_rlimit_nofile
```

### Step 5 — Cocokkan dengan Backend Java

Pastikan Nginx tidak mengirim concurrency yang backend tidak bisa proses.

### Step 6 — Jalankan Load Test Bertahap

Mulai dari kecil:

```text
10% -> 25% -> 50% -> 75% -> 100% -> 125%
```

### Step 7 — Amati Bottleneck

Jangan tuning sebelum tahu bottleneck:

- CPU?
- memory?
- FD?
- network?
- upstream?
- disk?
- kernel queue?
- load generator?

### Step 8 — Ubah Satu Variabel

Jangan ubah 10 directive sekaligus.

### Step 9 — Dokumentasikan

Setiap tuning production harus punya alasan:

```text
Directive changed:
Old value:
New value:
Reason:
Metric before:
Metric after:
Rollback plan:
```

---

## 31. Worked Example: Spring Boot API Behind Nginx

### 31.1 Scenario

```text
Nginx VM: 4 vCPU, 8GB RAM
Java backend: 4 Spring Boot instances
Traffic peak: 2000 RPS
p95 backend response time: 300 ms
client keepalive: enabled
TLS at Nginx: yes
Payload: mostly JSON < 100KB
No WebSocket
```

Estimate active requests:

```text
concurrency ≈ throughput * latency
            ≈ 2000 * 0.3
            ≈ 600 active requests
```

But client connections may be higher because keepalive idle:

```text
active client connections: 600
idle client keepalive: 4000
active upstream connections: 600
idle upstream keepalive: 4 workers * 64 = 256
margin: 2000
```

Total:

```text
600 + 4000 + 600 + 256 + 2000 = 7456
```

Config candidate:

```nginx
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
}
```

With 4 workers:

```text
4 * 4096 = 16384
```

This seems enough for the estimated connection budget.

But backend capacity must also be checked.

If each Spring Boot instance has:

```text
max threads = 200
```

Total thread capacity:

```text
4 * 200 = 800 active request threads
```

Estimated active upstream requests:

```text
600
```

This is close but plausible, assuming DB capacity supports it.

If p95 increases to 1 second:

```text
2000 * 1 = 2000 active requests
```

Then backend thread capacity collapses before Nginx connection capacity.

Lesson:

> Nginx tuning cannot be separated from backend latency.

---

## 32. Worked Example: WebSocket Gateway

### 32.1 Scenario

```text
Nginx pods: 6
worker_processes per pod: 2
WebSocket clients: 60,000
Average distribution: 10,000 clients per pod
Each WebSocket maps to one upstream WebSocket connection
```

Per pod connection requirement:

```text
client WebSocket: 10,000
upstream WebSocket: 10,000
margin: 5,000
------------------------
25,000 connection slots per pod
```

With:

```nginx
worker_processes 2;

events {
    worker_connections 8192;
}
```

Capacity:

```text
2 * 8192 = 16384
```

Not enough.

Candidate:

```nginx
worker_processes 2;
worker_rlimit_nofile 65535;

events {
    worker_connections 32768;
}
```

Capacity:

```text
2 * 32768 = 65536
```

But now OS limit, memory, upstream Java connection handling, pod resource limit, node conntrack, and load balancer timeout must be verified.

Lesson:

> Long-lived connections change the capacity problem from RPS to connection residency.

---

## 33. Production Checklist

### 33.1 Nginx Config

- [ ] `worker_processes` chosen intentionally.
- [ ] `worker_connections` sized from connection budget.
- [ ] `worker_rlimit_nofile` set if needed.
- [ ] systemd/container file descriptor limit aligned.
- [ ] client `keepalive_timeout` intentional.
- [ ] upstream keepalive intentional.
- [ ] `proxy_http_version 1.1` and `Connection ""` set for upstream keepalive.
- [ ] timeout values align with backend SLA.
- [ ] buffering strategy aligns with workload.
- [ ] static serving uses `sendfile` where appropriate.
- [ ] logs include upstream timing fields.

### 33.2 OS/Runtime

- [ ] `ulimit -n` checked.
- [ ] `/proc/<pid>/limits` checked.
- [ ] `systemctl show nginx | grep LimitNOFILE` checked if systemd.
- [ ] `sysctl net.core.somaxconn` understood if backlog tuning needed.
- [ ] disk capacity for logs/temp/cache monitored.
- [ ] network throughput monitored.

### 33.3 Backend Java

- [ ] Tomcat/Jetty/Undertow/Netty connection limit understood.
- [ ] thread pool capacity understood.
- [ ] DB pool capacity understood.
- [ ] backend timeout shorter/consistent with proxy timeout.
- [ ] graceful shutdown works with keepalive.
- [ ] health/readiness endpoints reliable.

### 33.4 Observability

- [ ] Nginx active connections monitored.
- [ ] open FD monitored.
- [ ] 499/502/503/504 rates monitored.
- [ ] upstream connect/header/response time logged.
- [ ] worker CPU monitored.
- [ ] socket states monitored during incidents.
- [ ] load balancer target health correlated.

---

## 34. Debugging Playbook

### 34.1 When Users Report Slow API

1. Check Nginx status code distribution.
2. Check `$request_time` vs `$upstream_response_time`.
3. If upstream time high, inspect Java/backend.
4. If request time high but upstream time low, suspect slow client, buffering, network, logging, or response transfer.
5. Check CPU/network/disk.
6. Check connection count and FD usage.

### 34.2 When Nginx Rejects or Drops Connections

1. Check error log.
2. Search for:

```bash
grep -E 'worker_connections|too many open files|accept\(\)|connect\(\)' /var/log/nginx/error.log
```

3. Check FD limit.
4. Check active connection count.
5. Check socket states.
6. Check LB/backend health.
7. Check recent deployment/config reload.

### 34.3 When Backend Gets Overwhelmed

1. Check Nginx upstream concurrency.
2. Check retry behavior.
3. Check rate limiting.
4. Check Java thread pool.
5. Check DB pool.
6. Check request latency distribution.
7. Consider lowering concurrency or adding protection, not just increasing Nginx capacity.

---

## 35. Design Heuristics

### 35.1 Capacity is a Budget, Not a Single Number

Do not say:

```text
Nginx can handle 100k users.
```

Say:

```text
With this traffic pattern, this timeout profile, this keepalive strategy, this backend capacity, and this OS limit, this Nginx tier has this estimated safe connection budget.
```

### 35.2 Idle Connections Are Still Connections

Idle does not mean free.

### 35.3 Long-Lived Traffic Is a Different Class

WebSocket, SSE, long polling, and gRPC streaming need different sizing than short API calls.

### 35.4 Backend Latency Creates Nginx Pressure

When upstream latency increases, active upstream connections increase.

### 35.5 Do Not Tune Without Observability

Tuning without metrics is superstition.

### 35.6 Prefer Simple Config Until Evidence Requires Complexity

Most production systems benefit more from:

- correct timeout,
- correct FD limit,
- sane keepalive,
- good logs,
- backend capacity alignment,

than from exotic event tuning.

---

## 36. Exercises

### Exercise 1 — Calculate Connection Budget

Given:

```text
worker_processes = 4
worker_connections = 4096
peak client connections = 7000
active upstream connections = 5000
idle upstream keepalive = 512
margin = 3000
```

Answer:

1. What is theoretical capacity?
2. What is required connection budget?
3. Is it enough?

Expected reasoning:

```text
theoretical = 4 * 4096 = 16384
required = 7000 + 5000 + 512 + 3000 = 15512
```

It is barely enough. Margin is thin. If traffic grows or long-lived connections increase, risk appears.

### Exercise 2 — Identify the Bottleneck

Scenario:

```text
Nginx CPU: 20%
Nginx memory: stable
Open FD: 30% of limit
502 rate: rising
Nginx error log: connect() failed (111: Connection refused)
Java CPU: 95%
Tomcat active threads: maxed
DB pool: saturated
```

Question:

Should you increase `worker_connections`?

Answer:

No. The bottleneck is backend Java/DB capacity. Increasing Nginx connection capacity may worsen queueing and failure.

### Exercise 3 — WebSocket Sizing

Given:

```text
3 Nginx instances
2 workers each
90,000 WebSocket users total
Each WebSocket maps to one upstream connection
```

Per Nginx instance:

```text
90,000 / 3 = 30,000 client connections
30,000 upstream connections
```

Minimum before margin:

```text
60,000 connection slots per instance
```

With 2 workers:

```text
worker_connections must be > 30,000 per worker before margin
```

A config like:

```nginx
worker_connections 8192;
```

is obviously insufficient.

---

## 37. Ringkasan

Nginx performance tuning bukan seni menyalin angka besar.

Mental model yang benar:

```text
Nginx capacity = connection slots + file descriptors + memory + CPU + kernel queues + network + backend capacity
```

Directive penting:

- `worker_processes` menentukan jumlah worker.
- `worker_connections` menentukan connection slots per worker.
- `worker_rlimit_nofile` membantu menaikkan open file limit untuk worker.
- `keepalive_timeout` memengaruhi idle client connection pressure.
- upstream `keepalive` memengaruhi reusable connection ke backend.
- `sendfile`, `tcp_nopush`, dan `tcp_nodelay` mengoptimalkan I/O tertentu, tetapi bukan obat semua performa.

Untuk Java backend, pelajaran paling penting:

> Jangan men-tuning Nginx dalam isolasi. Selalu cocokkan dengan thread pool, connection pool, timeout, database capacity, dan deployment behavior aplikasi Java.

---

## 38. Referensi

- NGINX official core module documentation: `worker_processes`, `worker_connections`, `worker_rlimit_nofile`, `worker_cpu_affinity`, dan directive core lain.  
  https://nginx.org/en/docs/ngx_core_module.html

- NGINX official HTTP core module documentation: directive HTTP seperti `sendfile`, `tcp_nopush`, `tcp_nodelay`, keepalive, listen, dan buffer-related behavior.  
  https://nginx.org/en/docs/http/ngx_http_core_module.html

- NGINX Admin Guide — Runtime Control: menjelaskan master/worker process dan runtime process control.  
  https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/

- NGINX official load balancing documentation.  
  https://nginx.org/en/docs/http/load_balancing.html

- NGINX official proxy module documentation.  
  https://nginx.org/en/docs/http/ngx_http_proxy_module.html

---

## 39. Penutup Part 011

Kamu sekarang punya fondasi untuk membaca Nginx bukan sebagai file konfigurasi, melainkan sebagai sistem pengelola connection, socket, buffer, worker, dan upstream pressure.

Part berikutnya akan membahas:

```text
Part 012 — TLS Termination: Certificates, SNI, Protocols, Ciphers, and Java Implications
```

Di sana kita akan masuk ke area yang sering menjadi sumber incident production: certificate chain, SNI, TLS version, cipher, OCSP, HSTS, HTTP to HTTPS redirect, TLS termination di depan Java, dan bagaimana aplikasi Java memahami original scheme saat berada di balik Nginx.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Timeouts, Retries, Buffering, and Backpressure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-012.md">Learn Nginx Mastery for Java Engineers — Part 012 ➡️</a>
</div>
