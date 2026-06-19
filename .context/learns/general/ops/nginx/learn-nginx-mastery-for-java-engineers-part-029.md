# learn-nginx-mastery-for-java-engineers-part-029.md

# Part 029 — Performance Lab: Benchmarking, Capacity Planning, and Tuning Experiments

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **029 dari 030**  
> Fokus: **benchmarking, capacity planning, tuning experiment, latency distribution, bottleneck isolation, dan guardrail performa Nginx di depan aplikasi Java**

---

## 0. Tujuan Bagian Ini

Bagian ini bukan tentang menghafal angka “Nginx bisa handle sekian ribu request per second”. Angka seperti itu hampir selalu menyesatkan jika tidak disertai konteks:

- jenis workload,
- ukuran response,
- TLS atau tidak,
- HTTP/1.1 atau HTTP/2,
- keepalive atau connection baru per request,
- static file atau reverse proxy,
- upstream cepat atau lambat,
- log aktif atau tidak,
- disk logging sinkron atau buffered,
- kernel limit,
- file descriptor,
- jumlah CPU core,
- jaringan lokal atau internet,
- client generator cukup kuat atau tidak.

Tujuan bagian ini adalah membangun cara berpikir yang benar untuk menjawab pertanyaan seperti:

1. Berapa kapasitas Nginx layer kita?
2. Apakah bottleneck ada di Nginx, aplikasi Java, database, network, TLS, atau load generator?
3. Bagaimana membaca p95/p99 latency dengan benar?
4. Bagaimana melakukan tuning tanpa cargo cult?
5. Bagaimana membuat eksperimen yang reproducible?
6. Bagaimana menentukan safe production limit?
7. Bagaimana menghindari benchmark yang terlihat bagus tetapi tidak merepresentasikan sistem nyata?

Mental model utamanya:

> **Benchmark bukan usaha mencari angka terbesar. Benchmark adalah eksperimen terkontrol untuk menemukan batas, bottleneck, dan perilaku degradasi sistem.**

---

## 1. Mengapa Benchmark Nginx Sering Menipu

Banyak engineer menjalankan:

```bash
ab -n 10000 -c 100 http://localhost/
```

lalu menyimpulkan:

> “Nginx bisa handle 50k RPS.”

Kesimpulan itu hampir tidak berguna jika tidak tahu apa yang diuji.

### 1.1 Benchmark Static File Tidak Sama Dengan Reverse Proxy

Nginx serving static file dari memory page cache sangat berbeda dengan Nginx reverse proxy ke Java backend.

Static file path:

```text
client
  -> Nginx
  -> kernel page cache / filesystem
  -> Nginx
  -> client
```

Reverse proxy path:

```text
client
  -> Nginx
  -> upstream Java app
  -> application thread/event loop
  -> maybe DB/cache/external API
  -> Java app
  -> Nginx
  -> client
```

Pada static file, Nginx bisa sangat dominan dan cepat. Pada reverse proxy, Nginx sering hanya satu node dalam rantai latency.

### 1.2 Localhost Benchmark Sering Menghilangkan Real Network Cost

Benchmark `localhost` menghilangkan banyak faktor:

- network latency,
- packet loss,
- TLS handshake cost di jaringan nyata,
- bandwidth bottleneck,
- client diversity,
- NAT/proxy behavior,
- slow mobile clients,
- internet jitter.

Localhost benchmark berguna untuk micro-test, tetapi tidak boleh dianggap sebagai capacity production.

### 1.3 Load Generator Bisa Menjadi Bottleneck

Jika tool benchmark berjalan di mesin yang sama dengan Nginx, hasilnya bisa dibatasi oleh:

- CPU load generator,
- ephemeral port exhaustion,
- kernel network stack lokal,
- context switching,
- loopback behavior,
- memory pressure.

Jika client generator saturasi lebih dulu, kamu sedang mengukur load generator, bukan Nginx.

### 1.4 Average Latency Hampir Tidak Berguna Sendirian

Contoh:

```text
average latency = 50 ms
```

Bisa berarti:

```text
Semua request sekitar 50 ms
```

atau:

```text
95% request 10 ms
5% request 810 ms
```

Untuk production, tail latency lebih penting:

- p50: median user experience,
- p90: upper normal,
- p95: degraded experience boundary,
- p99: tail pain,
- p99.9: rare but often business-critical.

---

## 2. Apa Yang Sebenarnya Ingin Kita Ukur?

Sebelum menjalankan tool, tulis pertanyaan eksperimen.

Contoh pertanyaan buruk:

> “Nginx kuat sampai berapa RPS?”

Pertanyaan lebih baik:

> “Dengan konfigurasi TLS HTTP/2, gzip aktif untuk JSON response 20 KB, proxy ke 3 instance Spring Boot, access log JSON aktif, berapa RPS maksimum sebelum p95 melebihi 300 ms atau error rate melebihi 0.1%?”

Pertanyaan bagus punya elemen:

1. **workload jelas**,
2. **environment jelas**,
3. **success criteria jelas**,
4. **failure threshold jelas**,
5. **bottleneck yang ingin diuji jelas**.

---

## 3. Dimensi Benchmark Nginx

Ada beberapa jenis benchmark yang berbeda.

### 3.1 Static File Benchmark

Mengukur kemampuan Nginx melayani file.

Cocok untuk:

- SPA assets,
- gambar,
- CSS/JS bundle,
- download kecil/sedang,
- page cache behavior,
- `sendfile`,
- compression static.

Tidak cocok untuk menyimpulkan kapasitas API backend.

### 3.2 Reverse Proxy Benchmark

Mengukur Nginx sebagai proxy ke upstream.

Cocok untuk:

- API routing,
- upstream keepalive,
- buffering,
- timeout,
- load balancing,
- header manipulation,
- Java backend protection.

### 3.3 TLS Benchmark

Mengukur overhead TLS:

- handshake,
- session resumption,
- certificate chain,
- cipher/protocol,
- HTTP/2 ALPN,
- CPU crypto cost.

TLS benchmark harus membedakan:

- koneksi baru per request,
- koneksi reused dengan keepalive,
- HTTP/2 multiplexed stream.

### 3.4 Compression Benchmark

Mengukur trade-off CPU vs bandwidth.

Pertanyaan penting:

- Apakah response cukup besar untuk layak dikompresi?
- Apakah payload sudah compressed?
- Apakah CPU menjadi bottleneck?
- Apakah bandwidth menjadi bottleneck?
- Apakah gzip level terlalu agresif?

### 3.5 Cache Benchmark

Mengukur:

- cache hit performance,
- cache miss performance,
- cache lock behavior,
- stale serving,
- thundering herd mitigation,
- disk I/O cache path.

Cache benchmark harus memisahkan:

```text
cold cache
warm cache
mixed hit/miss
revalidation
purge/repopulate
```

### 3.6 Long-Lived Connection Benchmark

Untuk:

- WebSocket,
- SSE,
- gRPC streaming,
- long polling.

Metric-nya berbeda dari request-response biasa:

- concurrent open connections,
- connection duration,
- messages per second,
- memory per connection,
- disconnect rate,
- idle timeout behavior.

---

## 4. Tool Benchmark Umum

Kita tidak perlu fanatik pada satu tool. Pilih berdasarkan kebutuhan.

### 4.1 `wrk`

`wrk` populer untuk HTTP load testing karena ringan dan cepat.

Contoh:

```bash
wrk -t4 -c200 -d60s http://localhost:8080/
```

Artinya:

- `-t4`: 4 thread client,
- `-c200`: 200 koneksi,
- `-d60s`: durasi 60 detik.

Kelebihan:

- performa tinggi,
- simple,
- bisa Lua scripting,
- bagus untuk baseline.

Kekurangan:

- default-nya lebih cocok closed-loop load,
- perlu hati-hati membaca latency,
- tidak selalu ideal untuk model arrival rate production.

### 4.2 `hey`

Lebih sederhana dan mudah dipakai.

```bash
hey -n 10000 -c 100 http://localhost:8080/api/health
```

Cocok untuk:

- quick smoke load test,
- simple endpoint benchmark,
- validasi kasar.

### 4.3 `vegeta`

Bagus untuk fixed request rate.

Contoh:

```bash
echo "GET http://localhost:8080/api/orders" | vegeta attack -rate=500 -duration=60s | vegeta report
```

Kelebihan besar vegeta:

- bisa model open-loop-ish rate,
- lebih cocok untuk menguji sistem pada arrival rate tertentu,
- mudah membandingkan hasil antar run.

### 4.4 ApacheBench `ab`

`ab` sederhana dan historis populer.

```bash
ab -n 10000 -c 100 http://localhost/
```

Namun untuk eksperimen serius, sering terlalu terbatas.

Gunakan untuk smoke test saja, bukan performance lab utama.

---

## 5. Closed-Loop vs Open-Loop Load

Ini konsep penting.

### 5.1 Closed-Loop

Closed-loop berarti client mengirim request baru setelah request sebelumnya selesai, dengan concurrency tertentu.

Model:

```text
client sends request
waits response
then sends next request
```

Jika server lambat, client otomatis melambat.

Akibatnya, benchmark bisa menyembunyikan overload.

### 5.2 Open-Loop

Open-loop berarti request datang berdasarkan rate tertentu, tidak peduli response sebelumnya sudah selesai atau belum.

Model:

```text
send 1000 requests/sec regardless of response completion
```

Ini lebih mirip traffic nyata.

Jika server lambat, queue menumpuk, latency naik, error muncul.

### 5.3 Kenapa Ini Penting?

Production traffic tidak bertanya:

> “Backend sudah selesai belum? Kalau belum, saya tunggu dulu sebelum user lain datang.”

Traffic datang karena user datang.

Jadi untuk capacity planning, gunakan rate-based experiment selain concurrency-based experiment.

---

## 6. Coordinated Omission

Coordinated omission adalah bias benchmark ketika load generator berhenti mengirim request saat sistem lambat, sehingga latency buruk tidak tercatat dengan benar.

Contoh:

```text
Target: 1000 RPS
Server freeze selama 5 detik
Closed-loop client ikut berhenti menunggu response
Hasil benchmark hanya melihat beberapa request lambat
Padahal dalam production, ribuan request seharusnya antre/gagal
```

Efeknya:

- p99 terlihat lebih baik dari realita,
- outage singkat terlihat kecil,
- queue collapse tidak terlihat,
- sistem dianggap aman padahal tidak.

Mitigasi:

- gunakan rate-based testing,
- ukur dari perspektif arrival time,
- lihat server-side metrics,
- injeksikan latency/freeze dan lihat hasil,
- jangan percaya average latency.

---

## 7. Metric Yang Harus Dikumpulkan

Benchmark tanpa observability adalah tebakan.

### 7.1 Client-Side Metrics

Dari load generator:

- request rate,
- success rate,
- error rate,
- timeout count,
- latency distribution,
- throughput bytes/sec,
- connection errors,
- TLS errors.

### 7.2 Nginx Metrics

Dari Nginx:

- active connections,
- accepted connections,
- handled connections,
- requests,
- reading/writing/waiting,
- access log status distribution,
- `$request_time`,
- `$upstream_connect_time`,
- `$upstream_header_time`,
- `$upstream_response_time`,
- 4xx/5xx distribution,
- 499 count,
- 502/503/504 count,
- cache hit/miss/stale,
- rate-limited count.

### 7.3 Host Metrics

Dari OS:

- CPU usage,
- CPU steal,
- memory,
- swap,
- disk I/O,
- network bandwidth,
- packet drops,
- TCP retransmits,
- file descriptor usage,
- socket states,
- load average,
- context switches.

### 7.4 Java Backend Metrics

Dari aplikasi:

- request latency,
- servlet thread pool usage,
- Netty event loop saturation,
- JVM CPU,
- heap usage,
- GC pause,
- DB connection pool usage,
- queue length,
- error rate,
- timeout count,
- downstream dependency latency.

### 7.5 Database/Dependency Metrics

Untuk API nyata, backend sering bukan bottleneck akhir.

Kumpulkan:

- DB query latency,
- connection pool saturation,
- lock wait,
- cache hit ratio,
- external API latency,
- broker lag,
- thread pool queue.

---

## 8. Access Log Format Untuk Performance Lab

Gunakan log format yang bisa menjawab pertanyaan latency.

Contoh:

```nginx
log_format perf escape=json
  '{'
    '"time":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"host":"$host",'
    '"method":"$request_method",'
    '"uri":"$uri",'
    '"status":$status,'
    '"bytes_sent":$bytes_sent,'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_connect_time":"$upstream_connect_time",'
    '"upstream_header_time":"$upstream_header_time",'
    '"upstream_response_time":"$upstream_response_time",'
    '"request_id":"$request_id"'
  '}';

access_log /var/log/nginx/access_perf.log perf;
```

Makna penting:

- `$request_time`: total waktu dari perspektif Nginx,
- `$upstream_connect_time`: waktu connect ke backend,
- `$upstream_header_time`: waktu sampai header response upstream diterima,
- `$upstream_response_time`: total waktu menerima response upstream.

Interpretasi:

```text
request_time tinggi, upstream_response_time rendah
=> kemungkinan client lambat, response besar, Nginx buffering/sending bottleneck

upstream_connect_time tinggi
=> backend connection issue, network, backlog, upstream saturation

upstream_header_time tinggi
=> backend lambat mulai merespons, app/DB/dependency bottleneck

upstream_response_time tinggi
=> backend streaming lambat atau response besar
```

---

## 9. Baseline Environment

Sebelum benchmark, dokumentasikan environment.

Template:

```text
Date:
Environment:
Nginx version:
OS/kernel:
CPU:
Memory:
Disk:
Network:
Nginx worker_processes:
worker_connections:
TLS enabled:
HTTP version:
Compression:
Access log:
Error log level:
Upstream type:
Backend version:
JVM flags:
Database/dependency:
Load generator host:
Load generator tool/version:
Test duration:
Warmup duration:
```

Tanpa ini, hasil benchmark tidak bisa dibandingkan.

---

## 10. Minimal Lab Topology

Untuk eksperimen yang lebih valid, pisahkan role:

```text
[load generator]
       |
       v
[Nginx host]
       |
       v
[Java backend host]
       |
       v
[DB/cache/mock dependency]
```

Jangan semua dijalankan di satu laptop lalu menyimpulkan production capacity.

Untuk local learning, satu mesin boleh. Untuk capacity estimate, pisahkan.

---

## 11. Workload Design

Benchmark harus mewakili traffic yang ingin diuji.

### 11.1 Endpoint Ringan

Contoh:

```text
GET /health
```

Berguna untuk:

- proxy overhead baseline,
- max cheap request throughput,
- connection behavior,
- TLS overhead.

Tidak mewakili business API.

### 11.2 Endpoint Normal

Contoh:

```text
GET /api/products?page=1
```

Karakteristik:

- query database/cache,
- response JSON sedang,
- auth mungkin aktif,
- typical user request.

### 11.3 Endpoint Berat

Contoh:

```text
POST /api/reports/generate
```

Karakteristik:

- CPU/database heavy,
- long response,
- higher timeout,
- limited concurrency.

Harus diuji terpisah karena endpoint berat bisa merusak kapasitas endpoint ringan jika tidak diisolasi.

### 11.4 Mixed Workload

Traffic nyata adalah campuran.

Contoh:

```text
70% GET /api/products
20% GET /api/orders/{id}
5% POST /api/orders
3% GET /static/app.js
2% POST /api/reports
```

Mixed workload lebih realistis daripada satu endpoint.

---

## 12. Step-by-Step Performance Lab

### Step 1 — Validate Config

```bash
nginx -t
nginx -T > effective-nginx.conf
```

Simpan effective config bersama hasil benchmark.

### Step 2 — Warm Up

Untuk Java backend, warmup penting:

- JVM JIT compilation,
- connection pool initialization,
- cache warming,
- class loading,
- DB plan cache,
- TLS session cache.

Contoh:

```bash
wrk -t2 -c50 -d60s http://nginx.local/api/products
```

Jangan ambil hasil warmup sebagai hasil final.

### Step 3 — Baseline Low Load

Jalankan load kecil.

```bash
wrk -t2 -c20 -d60s http://nginx.local/api/products
```

Tujuan:

- memastikan tidak ada error,
- melihat latency normal,
- memastikan log/metric aktif,
- memvalidasi response benar.

### Step 4 — Increase Load Gradually

Naikkan beban bertahap.

Contoh:

```text
100 RPS
200 RPS
400 RPS
800 RPS
1200 RPS
```

Atau concurrency:

```text
50
100
200
400
800
```

Jangan langsung lompat ke angka besar.

### Step 5 — Find Knee Point

Knee point adalah titik ketika sedikit kenaikan traffic menyebabkan latency naik tajam.

Contoh:

```text
RPS     p95 latency     error
100     40 ms           0%
200     50 ms           0%
400     80 ms           0%
600     140 ms          0%
800     450 ms          0.2%
1000    2.5 s           4%
```

Knee point sekitar 600-800 RPS.

Safe capacity bukan 1000 RPS.

Safe capacity mungkin 400-600 RPS tergantung SLO.

### Step 6 — Hold Test

Setelah tahu target, jalankan durasi lebih panjang.

```bash
vegeta attack -rate=500 -duration=30m < targets.txt | tee results.bin | vegeta report
```

Tujuan:

- melihat memory leak,
- log disk growth,
- GC behavior,
- connection pool stability,
- cache behavior,
- thermal throttling,
- periodic spikes.

### Step 7 — Stress Beyond Limit

Uji overload secara sengaja.

Tujuan bukan mencari angka heroik, tetapi melihat degradasi:

- apakah error graceful?
- apakah timeout benar?
- apakah Nginx tetap responsif?
- apakah backend mati total?
- apakah retry storm terjadi?
- apakah recovery otomatis?

### Step 8 — Recovery Observation

Setelah load turun:

- apakah latency kembali normal?
- apakah connection pool pulih?
- apakah JVM GC stabil?
- apakah Nginx worker tetap sehat?
- apakah cache/disk/log aman?

Sistem yang hanya kuat saat naik tetapi buruk saat recovery belum production-ready.

---

## 13. Capacity Planning Model

Capacity planning bukan cuma RPS.

Kapasitas dibatasi oleh beberapa constraint.

```text
capacity = min(
  CPU capacity,
  memory capacity,
  network capacity,
  file descriptor capacity,
  upstream connection capacity,
  Java thread/event-loop capacity,
  DB pool capacity,
  dependency capacity,
  acceptable latency SLO
)
```

### 13.1 CPU Constraint

CPU Nginx dipakai untuk:

- TLS,
- compression,
- header processing,
- logging,
- proxy buffering,
- cache metadata,
- event loop work.

Jika CPU mendekati saturasi:

- latency naik,
- accept melambat,
- TLS handshake lambat,
- logging tertunda,
- worker tidak responsif.

### 13.2 Memory Constraint

Memory dipakai untuk:

- connection structures,
- buffers,
- proxy buffers,
- request body buffers,
- SSL sessions,
- cache metadata zones,
- shared memory zones untuk rate limiting/cache.

Jumlah koneksi besar + buffer besar bisa menghabiskan memory.

### 13.3 File Descriptor Constraint

Setiap client connection butuh FD.

Reverse proxy juga butuh upstream connection.

Rough model:

```text
FD needed ≈ client connections + upstream connections + open files + logs + margin
```

Jika 20.000 client connection dan banyak upstream connection, limit `ulimit -n` default bisa terlalu rendah.

### 13.4 Network Constraint

Throughput response besar dapat membatasi.

```text
bandwidth needed = RPS × average response size
```

Contoh:

```text
5000 RPS × 100 KB = 500,000 KB/s ≈ 500 MB/s ≈ 4 Gbps
```

Jika network hanya 1 Gbps, mustahil tanpa compression/cache/scale-out.

### 13.5 Backend Constraint

Nginx bisa menerima banyak koneksi, tetapi backend Java mungkin tidak.

Contoh:

```text
Tomcat max threads = 200
DB pool = 50
Average DB query = 100 ms
```

DB pool bisa menjadi batas lebih awal daripada Nginx.

---

## 14. Little's Law Untuk Capacity Reasoning

Little's Law:

```text
L = λ × W
```

Artinya:

- `L`: jumlah request/concurrency dalam sistem,
- `λ`: throughput/request arrival rate,
- `W`: waktu rata-rata dalam sistem.

Contoh:

```text
RPS = 1000
average latency = 100 ms = 0.1 s
concurrency ≈ 1000 × 0.1 = 100
```

Jika latency naik menjadi 1 detik pada rate sama:

```text
concurrency ≈ 1000 × 1 = 1000
```

Artinya saat backend melambat, jumlah in-flight request naik drastis. Ini bisa menghabiskan:

- Nginx connections,
- upstream connections,
- Java threads,
- memory,
- DB pool,
- queue capacity.

Ini menjelaskan kenapa timeout dan backpressure penting.

---

## 15. Benchmark Static File

Contoh config:

```nginx
server {
    listen 8080;
    server_name localhost;

    root /var/www/app;

    location / {
        try_files $uri $uri/ =404;
    }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Benchmark:

```bash
wrk -t4 -c400 -d60s http://localhost:8080/assets/app.abc123.js
```

Observasi:

- CPU Nginx,
- disk read vs page cache,
- network throughput,
- response size,
- sendfile behavior,
- p99 latency.

Eksperimen:

1. file kecil 1 KB,
2. file sedang 100 KB,
3. file besar 5 MB,
4. gzip static on/off,
5. access log on/off.

Expected learning:

- small file benchmark sering CPU/syscall dominated,
- large file benchmark sering network dominated,
- warm page cache jauh lebih cepat dari cold disk,
- logging bisa berpengaruh pada high RPS.

---

## 16. Benchmark Reverse Proxy ke Java Backend

Contoh config:

```nginx
upstream java_api {
    server 127.0.0.1:9001;
    keepalive 64;
}

server {
    listen 8080;

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
```

Benchmark:

```bash
wrk -t4 -c200 -d120s http://localhost:8080/api/products
```

Yang harus dibandingkan:

```bash
# Direct to backend
wrk -t4 -c200 -d120s http://localhost:9001/api/products

# Through Nginx
wrk -t4 -c200 -d120s http://localhost:8080/api/products
```

Tujuan:

- mengetahui proxy overhead,
- melihat apakah Nginx mengubah latency,
- melihat apakah upstream keepalive efektif,
- membedakan bottleneck backend vs proxy.

Jika direct backend p95 80 ms dan through Nginx p95 85 ms, overhead kecil.

Jika direct backend p95 80 ms dan through Nginx p95 300 ms, investigasi:

- upstream keepalive disabled?
- buffering?
- TLS?
- logging?
- DNS?
- worker saturation?
- file descriptor?
- proxy timeout/retry?

---

## 17. Upstream Keepalive Experiment

Tanpa upstream keepalive, Nginx bisa membuat koneksi baru ke backend lebih sering.

Config buruk:

```nginx
upstream java_api {
    server 127.0.0.1:9001;
}

location /api/ {
    proxy_pass http://java_api;
}
```

Config lebih baik:

```nginx
upstream java_api {
    server 127.0.0.1:9001;
    keepalive 128;
}

location /api/ {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_pass http://java_api;
}
```

Eksperimen:

1. benchmark tanpa upstream keepalive,
2. benchmark dengan keepalive 32,
3. benchmark dengan keepalive 128,
4. amati backend connection count,
5. amati latency dan CPU.

Expected learning:

- keepalive mengurangi connection churn,
- backend accept overhead turun,
- latency bisa lebih stabil,
- tetapi keepalive terlalu besar juga memakan resource.

---

## 18. TLS Benchmark

### 18.1 New Connection Cost

Benchmark dengan koneksi baru lebih mahal.

```bash
wrk -t4 -c400 -d60s https://nginx.local/api/products
```

Tetapi `wrk` tetap reuse connection dalam banyak kasus. Untuk menekan handshake, perlu tool/config yang membuka koneksi baru lebih sering atau menonaktifkan reuse jika tool mendukung.

### 18.2 Keepalive TLS

Traffic nyata biasanya menggunakan keepalive.

Yang perlu diuji:

- TLS 1.2 vs TLS 1.3,
- session resumption,
- certificate chain size,
- HTTP/1.1 vs HTTP/2,
- CPU usage.

### 18.3 TLS Bottleneck Symptoms

Kemungkinan TLS bottleneck jika:

- CPU Nginx tinggi,
- handshake latency tinggi,
- latency tinggi hanya pada HTTPS, bukan HTTP,
- connection rate tinggi,
- new connection per request tinggi,
- p99 memburuk saat traffic burst.

Mitigasi:

- keepalive,
- TLS session cache,
- HTTP/2 untuk browser workloads,
- scale out edge,
- hardware/instance dengan CPU crypto baik,
- hindari connection churn.

---

## 19. Compression Benchmark

Config contoh:

```nginx
gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types
    text/plain
    text/css
    application/json
    application/javascript
    application/xml;
```

Eksperimen:

```text
Run A: gzip off
Run B: gzip level 1
Run C: gzip level 5
Run D: gzip level 9
```

Ukur:

- response size,
- CPU,
- latency,
- throughput,
- bandwidth.

Interpretasi:

```text
gzip level 9 menghemat 3% bandwidth tambahan tetapi CPU naik 40%
=> kemungkinan tidak layak
```

Rule praktis:

- gunakan compression untuk text/JSON besar,
- jangan compress file yang sudah compressed,
- jangan compress response terlalu kecil,
- jangan biarkan backend dan Nginx double-compress.

---

## 20. Cache Benchmark

Config sederhana:

```nginx
proxy_cache_path /var/cache/nginx/api
    levels=1:2
    keys_zone=api_cache:100m
    max_size=5g
    inactive=10m
    use_temp_path=off;

server {
    listen 8080;

    location /api/catalog/ {
        proxy_cache api_cache;
        proxy_cache_key "$scheme$request_method$host$request_uri";
        proxy_cache_valid 200 1m;
        proxy_cache_lock on;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header X-Cache-Status $upstream_cache_status always;

        proxy_pass http://java_api;
    }
}
```

Eksperimen:

1. cold cache,
2. warm cache,
3. mixed keys,
4. many concurrent requests for same key,
5. backend slow/failing,
6. cache stale serving.

Metric:

- hit ratio,
- MISS latency,
- HIT latency,
- STALE count,
- backend request reduction,
- disk I/O,
- cache zone memory.

Critical risk:

> Jangan benchmark cache hanya dengan satu URL lalu menyimpulkan cache layer aman. Itu hanya menguji best-case cache hit.

---

## 21. Logging Overhead Experiment

Access log bisa signifikan pada very high RPS.

Eksperimen:

```nginx
# Run A
access_log off;

# Run B
access_log /var/log/nginx/access.log main;

# Run C
access_log /var/log/nginx/access_json.log json buffer=256k flush=1s;
```

Ukur:

- RPS,
- latency,
- disk I/O,
- CPU,
- log volume,
- dropped logs jika pipeline eksternal.

Prinsip:

- jangan matikan log production tanpa alternatif observability,
- gunakan buffering jika sesuai,
- sampling bisa dipertimbangkan untuk extremely high-volume endpoint,
- log format harus berguna, bukan hanya banyak.

---

## 22. Worker and Connection Tuning Experiment

Config baseline:

```nginx
worker_processes auto;

events {
    worker_connections 4096;
}
```

Check file descriptor:

```bash
ulimit -n
systemctl show nginx | grep LimitNOFILE
```

Estimasi theoretical max client connection:

```text
worker_processes × worker_connections
```

Tetapi untuk reverse proxy, setiap request bisa memakai upstream connection juga.

Jadi jangan pakai angka theoretical sebagai production safe capacity.

Eksperimen:

1. naikkan `worker_connections`,
2. naikkan OS file descriptor limit,
3. amati active connections,
4. amati 502/connection errors,
5. amati memory.

Failure symptoms:

- `worker_connections are not enough`,
- `too many open files`,
- connection refused,
- accept errors,
- p99 spike.

---

## 23. Buffering Experiment

Request/response buffering memengaruhi memory, latency, dan backend protection.

### 23.1 Response Buffering

Default proxy buffering biasanya membantu Nginx membaca response dari backend lalu mengirim ke client sesuai kecepatan client.

Untuk streaming, bisa buruk.

Eksperimen:

```nginx
proxy_buffering on;
```

vs

```nginx
proxy_buffering off;
```

Test:

- JSON API biasa,
- large response,
- SSE endpoint,
- slow client simulation.

Expected:

- buffering on baik untuk normal API,
- buffering off penting untuk streaming,
- buffering off bisa membuat backend lebih terpapar slow client.

### 23.2 Request Buffering

```nginx
proxy_request_buffering on;
```

vs

```nginx
proxy_request_buffering off;
```

Untuk upload besar:

- buffering on melindungi backend dari slow upload,
- tetapi Nginx butuh disk/temp storage,
- buffering off streaming langsung ke backend, tapi backend terpapar slow client.

---

## 24. Timeout and Failure Benchmark

Benchmark sehat saja tidak cukup. Uji failure.

### 24.1 Backend Slow

Buat endpoint yang sleep:

```text
GET /api/test/sleep?ms=5000
```

Test dengan:

```nginx
proxy_read_timeout 2s;
```

Expected:

- Nginx return 504 setelah timeout,
- backend mungkin masih memproses jika tidak cancel-aware,
- Java thread bisa tetap terpakai.

### 24.2 Backend Down

Matikan backend.

Expected:

- 502 atau 503 tergantung kondisi,
- error log jelas,
- retry behavior sesuai config,
- Nginx tetap melayani endpoint lain.

### 24.3 Partial Upstream Failure

Dalam upstream 3 node, matikan 1 node.

Amati:

- error spike,
- retry behavior,
- latency impact,
- apakah node buruk cepat dihindari,
- apakah retry memperbesar load ke node sehat.

---

## 25. Reading Status Codes During Load

### 25.1 499

499 berarti client menutup koneksi sebelum Nginx selesai merespons.

Bisa disebabkan:

- client timeout terlalu pendek,
- user cancel,
- load generator timeout,
- backend lambat,
- network issue.

Jika 499 naik saat load tinggi, kemungkinan latency sudah melebihi toleransi client.

### 25.2 502

502 biasanya upstream error:

- connection refused,
- upstream closed prematurely,
- invalid response,
- backend crash,
- protocol mismatch.

### 25.3 503

503 bisa muncul karena:

- no live upstream,
- rate limiting/concurrency limiting,
- service unavailable policy.

### 25.4 504

504 berarti upstream timeout.

Biasanya:

- backend lambat,
- DB/dependency lambat,
- timeout terlalu pendek untuk workload,
- saturation.

### 25.5 413

Payload terlalu besar.

Bisa disengaja sebagai protection.

---

## 26. Bottleneck Isolation Framework

Saat performa buruk, jangan langsung tuning directive.

Gunakan pertanyaan berurutan.

### 26.1 Apakah Load Generator Saturasi?

Cek di client:

- CPU,
- network,
- error,
- connection limit,
- ephemeral port.

Jika client CPU 100%, hasil tidak valid.

### 26.2 Apakah Nginx Saturasi?

Cek:

- Nginx CPU,
- worker distribution,
- active connections,
- file descriptors,
- error log,
- network throughput,
- disk I/O untuk log/cache/temp.

### 26.3 Apakah Backend Saturasi?

Cek:

- JVM CPU,
- GC,
- thread pool,
- event loop,
- DB pool,
- request queue,
- response latency direct-to-backend.

### 26.4 Apakah Dependency Saturasi?

Cek:

- database,
- Redis,
- Kafka,
- external API,
- DNS,
- object storage.

### 26.5 Apakah Network Saturasi?

Cek:

- bandwidth,
- retransmit,
- packet drop,
- MTU issue,
- load balancer in front.

---

## 27. Tuning Principles

### 27.1 Tune Based On Measurement

Jangan ubah 10 directive sekaligus.

Buruk:

```text
Naikkan worker_connections, buffers, timeouts, gzip, keepalive semua sekaligus.
```

Baik:

```text
Ubah satu variabel, jalankan ulang benchmark, bandingkan.
```

### 27.2 Define Hypothesis

Contoh:

```text
Hypothesis:
Upstream connection churn menyebabkan latency tinggi.

Change:
Enable upstream keepalive 128.

Expected:
Backend connection rate turun, p95 turun, CPU backend turun.
```

### 27.3 Keep Rollback Simple

Setiap tuning harus bisa dikembalikan.

Simpan:

- config before,
- config after,
- benchmark result before,
- benchmark result after,
- reason.

### 27.4 Optimize For SLO, Not Max RPS

Production target biasanya:

```text
p95 < 300 ms
p99 < 1 s
error rate < 0.1%
CPU < 70% sustained
headroom >= 30%
```

Bukan:

```text
max RPS setinggi mungkin sampai semuanya terbakar
```

---

## 28. Common Cargo-Cult Tuning Mistakes

### 28.1 Timeout Terlalu Panjang

```nginx
proxy_read_timeout 600s;
```

Bisa membuat request stuck menumpuk dan menghabiskan resource.

Timeout panjang bukan resilience. Timeout harus disesuaikan dengan endpoint dan budget.

### 28.2 Timeout Terlalu Pendek

```nginx
proxy_read_timeout 1s;
```

Bisa memutus request valid yang memang butuh waktu.

### 28.3 Buffer Terlalu Besar

Buffer besar untuk semua endpoint bisa menghabiskan memory ketika concurrency tinggi.

### 28.4 Gzip Level Terlalu Tinggi

Level tinggi sering menambah CPU besar dengan penghematan bandwidth kecil.

### 28.5 Worker Connections Dinaikkan Tanpa FD Limit

`worker_connections` besar tidak berguna jika OS file descriptor limit rendah.

### 28.6 Benchmark Hanya `/health`

Endpoint `/health` tidak merepresentasikan workload bisnis.

### 28.7 Mengabaikan p99

Sistem bisa terlihat cepat di average tetapi buruk di tail.

---

## 29. Example Experiment Log

Gunakan format seperti ini.

```markdown
# Experiment: Upstream Keepalive

Date: 2026-06-19
Environment: staging-perf
Nginx version: x.y.z
Backend: Spring Boot API, 3 instances
Tool: vegeta

## Hypothesis

Enabling upstream keepalive will reduce backend connection churn and improve p95 latency under 800 RPS.

## Baseline Config

upstream java_api {
    server app1:8080;
    server app2:8080;
    server app3:8080;
}

## Changed Config

upstream java_api {
    server app1:8080;
    server app2:8080;
    server app3:8080;
    keepalive 128;
}

location /api/ {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_pass http://java_api;
}

## Result

Baseline:
- RPS: 800
- p50: 45 ms
- p95: 230 ms
- p99: 700 ms
- errors: 0.2%
- backend new connections/sec: high

After:
- RPS: 800
- p50: 40 ms
- p95: 140 ms
- p99: 360 ms
- errors: 0.0%
- backend new connections/sec: lower

## Conclusion

Keepalive improves stability. Keep config, monitor FD and upstream connection count.
```

---

## 30. Example Capacity Summary

```text
Workload:
- 80% GET API read
- 15% POST API write
- 5% static assets
- TLS enabled
- gzip enabled for JSON > 1 KB
- access log JSON buffered
- 3 backend Java instances

Observed knee point:
- around 900 RPS

Safe operating capacity:
- 600 RPS sustained
- 800 RPS short burst <= 5 minutes

SLO boundary:
- p95 < 300 ms
- p99 < 1 s
- error rate < 0.1%

Primary bottleneck:
- backend DB pool saturation, not Nginx

Nginx bottleneck observed:
- none before backend saturation

Recommended action:
- add backend pool isolation for heavy endpoint
- cache catalog endpoint
- rate limit report endpoint
- keep Nginx current config
- add alert on 499, 502, 504, upstream_response_time p95
```

---

## 31. Alerting Signals After Benchmark

Benchmark harus menghasilkan alert candidate.

Nginx-level alerts:

- 5xx rate above threshold,
- 499 spike,
- p95 `$request_time` high,
- p95 `$upstream_response_time` high,
- upstream connect time high,
- active connections near limit,
- file descriptor usage high,
- disk usage log/cache/temp high,
- cache hit ratio drop,
- rate limit rejection spike.

Backend-level alerts:

- thread pool saturation,
- DB pool saturation,
- JVM CPU high,
- GC pause high,
- dependency latency high,
- queue length high.

System-level alerts:

- CPU high,
- memory pressure,
- swap,
- disk I/O wait,
- network saturation,
- packet drops,
- TCP retransmits.

---

## 32. Production Readiness Checklist

Sebelum percaya hasil benchmark:

- [ ] Effective Nginx config disimpan.
- [ ] Environment terdokumentasi.
- [ ] Load generator tidak saturasi.
- [ ] Test memakai warmup.
- [ ] Test durasi cukup.
- [ ] Workload realistis.
- [ ] p50/p95/p99 dikumpulkan.
- [ ] Error rate dikumpulkan.
- [ ] Nginx access/error log dianalisis.
- [ ] Host metrics dikumpulkan.
- [ ] Backend Java metrics dikumpulkan.
- [ ] DB/dependency metrics dikumpulkan.
- [ ] Failure/overload diuji.
- [ ] Recovery diuji.
- [ ] Bottleneck diidentifikasi.
- [ ] Safe capacity ditentukan.
- [ ] Headroom ditentukan.
- [ ] Alert dirancang dari hasil benchmark.
- [ ] Tuning change punya rollback.

---

## 33. Latihan Praktis

### Latihan 1 — Static vs Proxy Baseline

Buat dua endpoint:

1. static file 10 KB dari Nginx,
2. API 10 KB dari Java backend.

Bandingkan:

- RPS,
- p95,
- p99,
- CPU,
- network.

Jelaskan kenapa hasilnya berbeda.

### Latihan 2 — Upstream Keepalive

Benchmark API dengan upstream keepalive off/on.

Catat:

- backend connection count,
- p95 latency,
- CPU backend,
- error rate.

### Latihan 3 — Slow Backend

Buat endpoint sleep 3 detik.

Set:

```nginx
proxy_read_timeout 1s;
```

Lihat status code, log, dan efek ke backend thread.

### Latihan 4 — Cache Hit/Miss

Aktifkan proxy cache untuk endpoint read-only.

Uji:

- cold cache,
- warm cache,
- backend down + stale cache.

### Latihan 5 — Compression Trade-Off

Uji JSON response 1 KB, 20 KB, 200 KB dengan gzip off/level 1/level 5/level 9.

Tentukan konfigurasi yang masuk akal.

---

## 34. Mental Model Akhir

Setelah bagian ini, cara berpikir yang diharapkan:

1. **Benchmark adalah eksperimen, bukan lomba angka RPS.**
2. **Latency distribution lebih penting daripada average.**
3. **p99 adalah tempat failure kecil menjadi pengalaman user nyata.**
4. **Nginx sering bukan bottleneck, tetapi Nginx adalah tempat terbaik untuk melihat bottleneck.**
5. **Timeout, buffering, keepalive, TLS, compression, logging, dan cache harus diuji sebagai trade-off.**
6. **Capacity adalah minimum dari banyak constraint, bukan satu angka dari tool benchmark.**
7. **Hasil benchmark harus menghasilkan keputusan operasional: limit, alert, tuning, rollback, dan scaling plan.**

---

## 35. Ringkasan

Pada bagian ini kita membahas:

- kenapa benchmark Nginx sering menipu,
- perbedaan static, proxy, TLS, compression, cache, dan long-lived benchmark,
- tool seperti `wrk`, `hey`, `vegeta`, dan `ab`,
- closed-loop vs open-loop load,
- coordinated omission,
- metric client, Nginx, host, Java backend, dan dependency,
- access log format untuk performance lab,
- step-by-step eksperimen benchmark,
- capacity planning dengan constraint model,
- Little's Law,
- eksperimen upstream keepalive, TLS, gzip, cache, logging, worker connection, buffering, dan timeout,
- bottleneck isolation,
- tuning principles,
- cargo-cult tuning mistakes,
- production readiness checklist.

Bagian berikutnya adalah capstone: menyatukan semua konsep seri ini ke dalam desain **production-grade Nginx front door untuk Java microservices**.

---

# Status Seri

- Selesai: **Part 029 dari 030**
- Belum selesai: **Part 030**
- Bagian berikutnya: **Part 030 — Capstone: Designing a Production-Grade Nginx Front Door for Java Microservices**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Production Failure Modeling and Incident Playbooks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-030.md">Part 030 — Capstone: Designing a Production-Grade Nginx Front Door for Java Microservices ➡️</a>
</div>
