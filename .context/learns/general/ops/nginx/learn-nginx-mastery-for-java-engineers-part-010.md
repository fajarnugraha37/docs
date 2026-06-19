# learn-nginx-mastery-for-java-engineers-part-010.md

# Part 010 — Timeouts, Retries, Buffering, and Backpressure

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Target pembaca: **Java software engineer / backend engineer / tech lead**  
> Fokus: memahami bagaimana Nginx mengendalikan waktu tunggu, retry, buffering, dan tekanan balik antara client, proxy, aplikasi Java, dan downstream dependency.

---

## 0. Posisi Part Ini dalam Seri

Di part sebelumnya kita sudah membangun fondasi:

- bagaimana Nginx memproses konfigurasi;
- bagaimana `server` dan `location` dipilih;
- bagaimana Nginx meneruskan request ke backend Java dengan `proxy_pass`;
- bagaimana proxy header menjadi kontrak antara Nginx dan aplikasi;
- bagaimana `upstream` dan load balancing bekerja.

Sekarang kita masuk ke area yang sering menentukan apakah sistem backend benar-benar production-grade:

> **Apa yang terjadi ketika sesuatu lambat, macet, overload, partial failure, atau client tidak kooperatif?**

Inilah domain:

- timeout;
- retry;
- buffering;
- backpressure.

Banyak engineer memperlakukan directive timeout sebagai angka konfigurasi acak:

```nginx
proxy_read_timeout 300s;
```

atau:

```nginx
proxy_connect_timeout 60s;
```

Lalu masalah dianggap selesai.

Padahal angka timeout adalah bagian dari **distributed system contract**. Ia menentukan:

- berapa lama worker Nginx boleh menunggu;
- berapa lama connection tetap hidup;
- berapa lama thread Java boleh tertahan;
- kapan client mendapat error;
- apakah retry aman dilakukan;
- apakah beban gagal cepat atau menumpuk;
- apakah sistem degrade secara terkendali atau runtuh berantai.

Part ini akan membangun mental model yang kuat supaya kamu tidak hanya tahu nama directive, tetapi mampu mendesain **timeout budget dan pressure boundary** untuk sistem Java production.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Menjelaskan perbedaan `proxy_connect_timeout`, `proxy_send_timeout`, `proxy_read_timeout`, `send_timeout`, dan `keepalive_timeout`.
2. Mendesain timeout budget dari client sampai aplikasi Java dan dependency downstream.
3. Memahami kapan retry oleh Nginx aman dan kapan berbahaya.
4. Menjelaskan perbedaan request buffering dan response buffering.
5. Menilai dampak buffering terhadap memory, disk, latency, streaming, upload besar, dan aplikasi Java.
6. Memahami backpressure chain dari client sampai database.
7. Mendesain konfigurasi yang mencegah cascading failure.
8. Mendiagnosis error seperti `499`, `502`, `504`, request menggantung, upload lambat, response streaming tidak keluar, dan retry storm.
9. Menyusun checklist production untuk timeout, retry, dan buffering.

---

## 2. Mental Model Utama: Nginx Bukan Hanya Penerus Request

Model naive:

```text
Client -> Nginx -> Java App -> Database
```

Model yang lebih benar:

```text
Client
  |
  | client connection
  | request body upload speed
  | client patience / timeout
  v
Nginx
  |
  | accept connection
  | parse request
  | maybe buffer request body
  | connect to upstream
  | send request to upstream
  | wait for response header/body
  | maybe buffer response
  | send response to client
  v
Java App
  |
  | accept connection from Nginx
  | allocate thread/event-loop work
  | parse request
  | maybe read body
  | call services/database/cache
  | generate response
  v
Database / External Service
```

Nginx berada di tengah beberapa clocks:

1. **Client clock**  
   Berapa lama client mau menunggu.

2. **Nginx client-side clock**  
   Berapa lama Nginx menunggu client mengirim atau menerima data.

3. **Nginx upstream-side clock**  
   Berapa lama Nginx menunggu koneksi, request send, dan response dari Java app.

4. **Java application clock**  
   Berapa lama servlet thread, Netty event loop, worker pool, transaction, atau coroutine boleh berjalan.

5. **Dependency clock**  
   Timeout database, Redis, Kafka, HTTP client, third-party API, object storage, dan sebagainya.

Jika clocks ini tidak diselaraskan, gejalanya sering membingungkan:

- client sudah timeout, tapi Java masih bekerja;
- Nginx mengembalikan `504`, tapi backend akhirnya sukses;
- Nginx retry ke node lain, tapi operasi ternyata tidak idempotent;
- thread pool Java penuh karena request lambat tidak pernah dibatalkan;
- database overload karena retry memperbanyak request;
- response streaming tidak sampai ke client karena buffering;
- upload besar mengisi disk temp Nginx;
- client lambat membuat worker connection tertahan.

---

## 3. Prinsip: Timeout Adalah Policy, Bukan Dekorasi

Timeout bukan sekadar “berapa lama menunggu”. Timeout adalah policy tentang:

- kapan sistem menganggap suatu operasi gagal;
- siapa yang boleh membatalkan operasi;
- siapa yang bertanggung jawab memberi error ke caller;
- apakah operasi boleh dicoba ulang;
- berapa banyak resource boleh ditahan selama operasi belum selesai;
- bagaimana sistem degrade ketika sebagian komponen lambat.

Dalam sistem production, tidak ada timeout yang “benar secara universal”. Yang ada adalah timeout yang konsisten dengan:

- SLA/SLO endpoint;
- karakteristik traffic;
- jenis operasi;
- idempotency;
- kapasitas backend;
- perilaku client;
- failure mode yang ingin dicegah.

Contoh:

Endpoint login:

```text
Expected: 100-500 ms
Bad if: hangs for 30 seconds
Retry: dangerous if password/auth provider involved
```

Endpoint export report:

```text
Expected: seconds to minutes
Bad if: tied to synchronous HTTP forever
Retry: dangerous if job creation is not idempotent
Better: async job + polling/download
```

Endpoint static asset:

```text
Expected: fast
Retry: usually safe
Cache: beneficial
```

Endpoint payment:

```text
Expected: bounded
Retry: only with idempotency key and strict semantics
Failure: must be explicit and auditable
```

Jadi timeout harus dirancang per kelas endpoint, bukan satu angka global untuk semua request.

---

## 4. Request Lifecycle dari Perspektif Timeout

Ketika client mengirim request ke Nginx lalu Nginx meneruskannya ke backend Java, ada beberapa fase:

```text
[1] Client connects to Nginx
[2] Client sends request headers
[3] Client sends request body
[4] Nginx selects server/location/upstream
[5] Nginx connects to upstream Java app
[6] Nginx sends request to upstream
[7] Java app processes request
[8] Nginx waits for upstream response
[9] Nginx receives response from upstream
[10] Nginx sends response to client
[11] Connection may stay alive or close
```

Timeout berbeda berlaku pada fase berbeda.

Salah satu kesalahan besar adalah mengira `proxy_read_timeout` berarti “total maximum request duration”. Tidak selalu. Ia lebih dekat ke batas waktu antara operasi read dari upstream, bukan stopwatch absolut dari awal sampai akhir request.

Demikian pula `send_timeout` bukan waktu total mengirim response; ia berkaitan dengan waktu tunggu antar operasi write ke client.

Mental model yang lebih aman:

> Banyak timeout Nginx adalah **idle timeout between I/O operations**, bukan total end-to-end deadline.

Konsekuensi:

- response streaming yang mengirim data kecil setiap beberapa detik bisa hidup lama;
- request yang tidak benar-benar idle mungkin tidak timeout walaupun total durasinya panjang;
- aplikasi tetap perlu punya deadline sendiri;
- Nginx bukan pengganti application-level cancellation.

---

## 5. Directive Timeout Utama

Bagian ini membahas directive yang paling sering relevan untuk reverse proxy HTTP.

---

## 5.1 `proxy_connect_timeout`

Contoh:

```nginx
location /api/ {
    proxy_connect_timeout 2s;
    proxy_pass http://java_backend;
}
```

`proxy_connect_timeout` mengontrol waktu maksimum Nginx menunggu saat membuat koneksi ke upstream.

Fase:

```text
Nginx -> connect() -> Java upstream
```

Masalah yang biasanya terlihat:

- upstream process mati;
- port tidak listening;
- firewall drop;
- network path bermasalah;
- SYN queue penuh;
- node overload dan tidak menerima koneksi baru;
- DNS resolve ke alamat yang tidak sehat.

Jika connect timeout terlalu lama:

```text
Client request datang
Nginx mencoba connect ke upstream yang tidak reachable
Worker connection menunggu
Request menumpuk
Client ikut menunggu
```

Jika connect timeout terlalu pendek:

```text
Transient network jitter
Koneksi sebenarnya bisa berhasil sedikit lebih lambat
Nginx gagal terlalu cepat
False failure meningkat
```

Praktik umum untuk sistem internal modern:

```nginx
proxy_connect_timeout 1s;
```

atau:

```nginx
proxy_connect_timeout 2s;
```

Untuk upstream local network yang sehat, connect biasanya sangat cepat. Jika connect butuh puluhan detik, kemungkinan sudah ada problem serius.

Namun jangan gunakan angka ini membabi buta. Pertimbangkan:

- apakah upstream berada di same host, same AZ, cross-region, atau internet;
- apakah ada service discovery / DNS delay;
- apakah path melewati load balancer lain;
- apakah cold-start container sering terjadi.

---

## 5.2 `proxy_send_timeout`

Contoh:

```nginx
location /api/ {
    proxy_send_timeout 10s;
    proxy_pass http://java_backend;
}
```

`proxy_send_timeout` mengontrol waktu tunggu saat Nginx mengirim request ke upstream.

Fase:

```text
Nginx -> send request headers/body -> Java upstream
```

Ini relevan ketika:

- request body besar;
- upstream lambat membaca body;
- upstream receive buffer penuh;
- Java app stuck sebelum membaca request body;
- network upstream lambat;
- Nginx request buffering dimatikan.

Jika request buffering aktif, Nginx biasanya membaca body dari client lebih dulu ke memory/disk temp, lalu mengirim ke upstream. Jika buffering nonaktif, Nginx akan streaming body client ke upstream, sehingga `proxy_send_timeout` lebih terasa dalam aliran data real-time.

Risiko jika terlalu lama:

- Nginx menahan koneksi upstream ke backend yang tidak membaca;
- thread/container backend mungkin sudah stuck;
- request besar memenuhi pipeline.

Risiko jika terlalu pendek:

- upload legitimate gagal;
- request lambat tetapi valid diputus.

Untuk API JSON kecil, angka rendah masuk akal:

```nginx
proxy_send_timeout 5s;
```

Untuk upload besar, perlu desain khusus:

```nginx
location /uploads/ {
    client_max_body_size 100m;
    proxy_request_buffering on;
    proxy_send_timeout 60s;
    proxy_read_timeout 120s;
    proxy_pass http://upload_backend;
}
```

Namun untuk upload besar, sering lebih baik upload langsung ke object storage memakai pre-signed URL daripada melewati Java app dan Nginx secara sinkron.

---

## 5.3 `proxy_read_timeout`

Contoh:

```nginx
location /api/ {
    proxy_read_timeout 30s;
    proxy_pass http://java_backend;
}
```

`proxy_read_timeout` mengontrol waktu tunggu saat Nginx membaca response dari upstream.

Fase:

```text
Java upstream -> response headers/body -> Nginx
```

Ini salah satu directive yang paling sering disalahgunakan.

Banyak orang mengubah:

```nginx
proxy_read_timeout 60s;
```

menjadi:

```nginx
proxy_read_timeout 600s;
```

untuk “memperbaiki” 504.

Kadang benar, tapi sering hanya menyembunyikan desain buruk.

`proxy_read_timeout` yang besar berarti Nginx bersedia menunggu upstream lebih lama. Tetapi itu tidak menjawab:

- kenapa Java app lambat;
- apakah servlet thread tertahan;
- apakah database query tidak punya timeout;
- apakah client masih menunggu;
- apakah operasi boleh dibatalkan;
- apakah endpoint seharusnya async;
- apakah retry akan menggandakan pekerjaan.

Untuk API biasa, 30 detik sering sudah sangat tinggi. Banyak endpoint production sebaiknya punya deadline lebih ketat:

```nginx
location /api/ {
    proxy_connect_timeout 1s;
    proxy_send_timeout 5s;
    proxy_read_timeout 15s;
    proxy_pass http://java_backend;
}
```

Untuk endpoint streaming/SSE/WebSocket, `proxy_read_timeout` bisa lebih besar, tetapi harus disertai pemahaman bahwa koneksi memang long-lived:

```nginx
location /events/ {
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
    proxy_pass http://java_backend;
}
```

---

## 5.4 `send_timeout`

Contoh:

```nginx
http {
    send_timeout 30s;
}
```

`send_timeout` mengontrol timeout saat Nginx mengirim response ke client.

Fase:

```text
Nginx -> send response -> client
```

Ini relevan ketika client lambat membaca response.

Contoh client lambat:

- mobile network buruk;
- browser tab throttled;
- bot abusive;
- download besar;
- client sengaja membaca lambat untuk menahan koneksi;
- network congestion.

Jika `send_timeout` terlalu besar:

- koneksi ke client lambat tertahan lama;
- worker connections terpakai;
- file descriptor meningkat;
- slow client bisa mengganggu kapasitas.

Jika terlalu pendek:

- client dengan koneksi lambat gagal menerima response valid;
- download besar terputus.

Penting: Nginx event-driven lebih tahan terhadap slow clients dibanding server threaded, tetapi bukan berarti resource-nya gratis. Setiap koneksi tetap memakai file descriptor, memory, dan slot worker connection.

---

## 5.5 `keepalive_timeout`

Contoh:

```nginx
http {
    keepalive_timeout 65s;
}
```

`keepalive_timeout` mengontrol berapa lama koneksi client idle dipertahankan setelah request selesai agar bisa dipakai lagi.

Manfaat keepalive:

- mengurangi biaya TCP handshake;
- mengurangi TLS handshake;
- mempercepat request berikutnya;
- baik untuk browser dan client yang membuat banyak request.

Risiko keepalive terlalu panjang:

- banyak idle connection menahan file descriptor;
- worker connection capacity cepat habis;
- load balancer/client yang agresif bisa memegang koneksi terlalu lama.

Risiko keepalive terlalu pendek:

- handshake meningkat;
- latency naik;
- CPU TLS meningkat;
- client membuka koneksi baru terus.

Untuk traffic web umum, nilai puluhan detik lazim. Tetapi angka optimal bergantung pada:

- jumlah concurrent client;
- worker_connections;
- file descriptor limit;
- TLS cost;
- pola request browser/API client;
- keberadaan load balancer di depan Nginx.

---

## 6. Timeout Lain yang Sering Terkait

---

## 6.1 `client_header_timeout`

Mengontrol waktu maksimum untuk membaca request header dari client.

Contoh:

```nginx
http {
    client_header_timeout 10s;
}
```

Berguna untuk melindungi dari client yang mengirim header sangat lambat.

---

## 6.2 `client_body_timeout`

Mengontrol waktu tunggu saat membaca request body dari client.

Contoh:

```nginx
http {
    client_body_timeout 30s;
}
```

Relevan untuk:

- upload;
- POST/PUT besar;
- slow client;
- unreliable mobile network.

Jika terlalu kecil, upload lambat legitimate gagal. Jika terlalu besar, slow upload bisa menahan resource.

---

## 6.3 `lingering_timeout` dan `lingering_close`

Ini lebih advanced. Nginx dapat melakukan lingering close untuk membaca sisa data dari client sebelum menutup koneksi, agar koneksi TCP tidak menghasilkan efek samping tertentu.

Biasanya tidak perlu disentuh di awal, tetapi penting diketahui ketika debugging koneksi yang terlihat tidak langsung close.

---

## 7. Timeout Budget: Cara Berpikir yang Benar

Daripada memulai dari directive, mulai dari user-visible deadline.

Contoh endpoint:

```text
GET /api/accounts/{id}/summary
```

SLO:

```text
p95 < 300 ms
p99 < 1 s
hard timeout < 3 s
```

Maka desain deadline bisa seperti:

```text
Client timeout:             4s
Nginx proxy_read_timeout:   3s
Java request deadline:      2.5s
Database query timeout:     1.5s
External HTTP timeout:      1s
```

Kenapa urutannya seperti itu?

Karena dependency terdalam harus gagal lebih cepat daripada layer luar.

Model:

```text
Client waits longest
Nginx waits slightly less
Java app deadline less than Nginx
Database/HTTP clients less than Java app
```

Tujuannya:

- Java app punya waktu menangani error dan mengembalikan response;
- Nginx tidak memutus request sebelum aplikasi sempat merespons error;
- database tidak tetap bekerja setelah request sudah tidak berguna;
- client tidak menunggu terlalu lama.

Anti-pattern:

```text
Client timeout:             5s
Nginx proxy_read_timeout:   60s
Java app no timeout
Database query no timeout
```

Dampak:

- client sudah pergi;
- Nginx atau app masih bekerja;
- database terus menjalankan query;
- kapasitas terbuang;
- saat traffic tinggi, thread pool penuh oleh request zombie.

Anti-pattern lain:

```text
Client timeout:             60s
Nginx proxy_read_timeout:   5s
Java app deadline:          30s
Database timeout:           30s
```

Dampak:

- Nginx mengembalikan 504 setelah 5s;
- Java app dan DB tetap bekerja sampai 30s;
- user menerima error walaupun pekerjaan backend masih berjalan;
- retry user dapat menggandakan beban.

---

## 8. Timeout Budget untuk Beberapa Kelas Endpoint

Tidak semua endpoint harus punya timeout sama.

---

## 8.1 API Read Cepat

Contoh:

```text
GET /api/users/me
GET /api/accounts/{id}
GET /api/products/search
```

Karakteristik:

- read-only;
- sering dipanggil;
- harus cepat;
- retry mungkin aman jika idempotent;
- latency sensitif.

Contoh Nginx:

```nginx
location /api/ {
    proxy_connect_timeout 1s;
    proxy_send_timeout 5s;
    proxy_read_timeout 10s;
    proxy_pass http://java_api;
}
```

Aplikasi Java:

```text
request deadline: 8s
DB query timeout: 2s-5s tergantung query
external HTTP timeout: 1s-3s
```

Namun untuk sistem bagus, p99 biasanya jauh di bawah 10s. Timeout 10s adalah safety net, bukan target.

---

## 8.2 API Write / Command

Contoh:

```text
POST /api/orders
POST /api/payments
PUT /api/profile
```

Karakteristik:

- state-changing;
- retry bisa berbahaya;
- butuh idempotency key jika retry dimungkinkan;
- audit dan consistency penting.

Contoh Nginx:

```nginx
location /api/commands/ {
    proxy_connect_timeout 1s;
    proxy_send_timeout 10s;
    proxy_read_timeout 20s;
    proxy_next_upstream error timeout;
    proxy_next_upstream_tries 1;
    proxy_pass http://java_command_api;
}
```

`proxy_next_upstream_tries 1` berarti tidak mencoba upstream lain setelah percobaan pertama. Untuk operasi non-idempotent, ini sering lebih aman.

Better design:

- gunakan idempotency key;
- command handler punya request id unik;
- database constraint mencegah duplicate mutation;
- retry dilakukan oleh client/app dengan semantics eksplisit, bukan proxy secara buta.

---

## 8.3 Upload File

Contoh:

```text
POST /api/uploads
```

Karakteristik:

- body besar;
- client bisa lambat;
- Nginx bisa buffer ke disk;
- Java app bisa boros memory jika tidak streaming dengan benar.

Contoh:

```nginx
location /api/uploads/ {
    client_max_body_size 100m;
    client_body_timeout 60s;

    proxy_request_buffering on;
    proxy_connect_timeout 2s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;

    proxy_pass http://java_upload_api;
}
```

Tetapi untuk skala tinggi:

```text
Client -> object storage pre-signed URL
Java app -> metadata + authorization only
```

Ini menghindari Nginx dan Java menjadi data pipe untuk file besar.

---

## 8.4 Streaming / SSE

Contoh:

```text
GET /api/events
```

Karakteristik:

- response long-lived;
- data dikirim bertahap;
- buffering harus dimatikan;
- timeout harus lebih panjang;
- heartbeat penting.

Contoh:

```nginx
location /api/events/ {
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;

    proxy_pass http://java_sse_api;
}
```

Aplikasi harus mengirim heartbeat periodik agar koneksi tidak idle terlalu lama.

---

## 8.5 WebSocket

Contoh:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    location /ws/ {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_read_timeout 1h;
        proxy_send_timeout 1h;

        proxy_pass http://java_ws_backend;
    }
}
```

WebSocket bukan request-response pendek. Ia adalah long-lived bidirectional connection. Timeout harus dipikirkan sebagai connection lifecycle, bukan API latency.

---

## 9. Retry dengan `proxy_next_upstream`

Nginx dapat mencoba upstream lain ketika terjadi failure tertentu.

Contoh:

```nginx
upstream java_api {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
}

server {
    location /api/ {
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 3s;
        proxy_pass http://java_api;
    }
}
```

Makna konsepnya:

- jika upstream pertama gagal dengan kondisi tertentu;
- Nginx boleh mencoba upstream lain;
- jumlah percobaan dibatasi;
- total waktu retry dapat dibatasi.

Retry bisa meningkatkan availability ketika failure bersifat:

- node tertentu mati;
- connection refused;
- transient timeout;
- upstream restart;
- load balancer memilih node buruk.

Tetapi retry bisa merusak sistem ketika:

- operasi tidak idempotent;
- request body besar;
- backend sebenarnya memproses request tapi response timeout;
- semua upstream overload;
- retry menggandakan traffic ke sistem yang sudah sakit.

---

## 10. Retry Safety: Pertanyaan Sebelum Mengaktifkan Retry

Sebelum mengaktifkan retry, jawab ini:

1. Apakah request idempotent?
2. Apakah upstream bisa saja sudah memproses request walaupun Nginx belum menerima response?
3. Apakah aplikasi punya idempotency key?
4. Apakah efek samping terlindungi unique constraint atau deduplication?
5. Apakah retry hanya untuk connect failure, atau juga timeout response?
6. Berapa maksimum percobaan?
7. Apakah retry timeout lebih kecil dari client timeout?
8. Apakah semua upstream mungkin mengalami overload serentak?
9. Apakah retry akan memperburuk overload?
10. Apakah log bisa menunjukkan request yang diretry?

Rule of thumb:

```text
GET/read idempotent: retry bisa dipertimbangkan.
POST command non-idempotent: retry otomatis oleh proxy biasanya berbahaya.
POST dengan idempotency key: retry bisa aman jika contract kuat.
Payment/order mutation: jangan retry buta.
```

---

## 11. Retry Storm

Retry storm terjadi ketika sistem yang sedang lambat justru menerima traffic tambahan akibat retry.

Skenario:

```text
Normal traffic: 1000 rps
Backend latency naik
Nginx timeout meningkat
Nginx retry ke upstream lain
Client juga retry
Queue app bertambah
DB makin lambat
Timeout makin banyak
Retry makin banyak
Sistem runtuh
```

Retry storm adalah amplifier.

Jika satu request bisa dicoba 3 kali di Nginx dan client juga retry 3 kali, satu user action bisa menjadi:

```text
3 x 3 = 9 backend attempts
```

Jika app juga retry database 3 kali:

```text
3 x 3 x 3 = 27 downstream attempts
```

Ini sering terjadi tanpa ada orang yang sengaja membuat “27x load”. Ia muncul dari kombinasi default retry di beberapa layer.

Prinsip:

> Retry harus punya budget global, bukan dipasang independen di setiap layer.

---

## 12. Request Buffering

Directive utama:

```nginx
proxy_request_buffering on;
```

Default umumnya aktif untuk proxy HTTP.

Dengan request buffering aktif:

```text
Client -> Nginx reads full request body -> stores in memory/temp file -> Nginx sends to upstream
```

Dengan request buffering nonaktif:

```text
Client -> Nginx streams request body -> upstream while client is still uploading
```

---

## 12.1 Request Buffering ON

Contoh:

```nginx
location /api/ {
    proxy_request_buffering on;
    proxy_pass http://java_backend;
}
```

Keuntungan:

1. Java backend tidak perlu menunggu client lambat upload body.
2. Nginx menyerap slow client.
3. Upstream connection digunakan lebih singkat.
4. Load balancer upstream lebih terlindungi.
5. Retry lebih memungkinkan karena body sudah tersedia di Nginx.

Kekurangan:

1. Nginx butuh memory/disk temp untuk body besar.
2. Latency ke upstream mulai setelah body diterima penuh.
3. Tidak cocok untuk true streaming upload.
4. Disk bisa penuh jika upload besar/masif.
5. Backpressure ke client terjadi di Nginx, bukan aplikasi.

Untuk kebanyakan API JSON, request buffering ON adalah pilihan aman.

---

## 12.2 Request Buffering OFF

Contoh:

```nginx
location /api/stream-upload/ {
    proxy_request_buffering off;
    proxy_pass http://java_upload_backend;
}
```

Keuntungan:

1. Upstream bisa mulai memproses sebelum body lengkap.
2. Cocok untuk streaming upload tertentu.
3. Mengurangi disk temp Nginx.
4. Latency awal ke backend lebih cepat.

Kekurangan:

1. Java backend terekspos ke slow client.
2. Upstream connection tertahan selama upload.
3. Retry lebih sulit/terbatas.
4. Thread atau request handler Java bisa tertahan lama.
5. Jika Java stack tidak streaming dengan benar, memory risk tetap ada.

Untuk Java servlet stack tradisional, hati-hati. Jika request body dibaca oleh thread request dan client lambat, thread bisa tertahan. Pada traffic besar, ini dapat menghabiskan thread pool.

---

## 13. Response Buffering

Directive utama:

```nginx
proxy_buffering on;
```

Dengan response buffering aktif:

```text
Java upstream -> Nginx buffers response -> Nginx sends to client
```

Dengan response buffering nonaktif:

```text
Java upstream -> Nginx streams response to client as received
```

---

## 13.1 Response Buffering ON

Contoh:

```nginx
location /api/ {
    proxy_buffering on;
    proxy_pass http://java_backend;
}
```

Keuntungan:

1. Java backend tidak terlalu terdampak client lambat.
2. Upstream connection bisa selesai lebih cepat.
3. Nginx menyerap slow download.
4. Bisa membantu throughput untuk response normal.
5. Diperlukan/berguna untuk proxy cache.

Kekurangan:

1. Streaming response bisa tertahan.
2. Client tidak menerima data sampai buffer flush.
3. Memory/disk temp bisa dipakai untuk response besar.
4. SSE bisa rusak secara fungsional.
5. Latency first byte ke client bisa meningkat untuk pola tertentu.

Untuk API JSON biasa, response buffering ON sering baik.

---

## 13.2 Response Buffering OFF

Contoh:

```nginx
location /api/events/ {
    proxy_buffering off;
    proxy_pass http://java_backend;
}
```

Wajib dipertimbangkan untuk:

- Server-Sent Events;
- streaming JSON;
- progressive download;
- log tailing;
- AI/token streaming;
- real-time event stream.

Risiko:

- upstream Java connection tertahan selama client lambat membaca;
- slow clients bisa mengonsumsi backend resource;
- Nginx tidak banyak menyerap perbedaan kecepatan upstream-client.

Untuk streaming, ini memang trade-off yang diinginkan. Tetapi kapasitas backend harus dihitung berdasarkan long-lived connection, bukan request pendek.

---

## 14. Buffer Size dan Temp File

Directive yang sering terkait:

```nginx
proxy_buffer_size 16k;
proxy_buffers 8 16k;
proxy_busy_buffers_size 32k;
proxy_max_temp_file_size 1024m;
```

Untuk request body dari client:

```nginx
client_body_buffer_size 128k;
client_body_temp_path /var/lib/nginx/body;
```

Untuk response proxy:

```nginx
proxy_temp_path /var/lib/nginx/proxy;
```

Ketika buffer memory tidak cukup, Nginx dapat menggunakan temp file di disk.

Implikasi production:

- disk harus cukup;
- disk latency bisa mempengaruhi response;
- container filesystem bisa penuh;
- ephemeral storage Kubernetes bisa habis;
- log dan temp file bisa berebut storage;
- monitoring disk usage wajib.

Anti-pattern:

```text
Upload besar diizinkan
proxy_request_buffering on
container ephemeral storage kecil
monitoring disk tidak ada
```

Akibat:

```text
Traffic upload naik
Nginx menulis body temp
Disk penuh
Request gagal
Nginx error meningkat
Pod bisa evicted
```

---

## 15. Backpressure: Apa Itu?

Backpressure adalah mekanisme ketika komponen downstream yang lambat memberi sinyal, langsung atau tidak langsung, agar upstream tidak terus mengirim lebih banyak pekerjaan.

Dalam sistem Nginx + Java:

```text
Client -> Nginx -> Java App -> DB/External Service
```

Setiap panah punya kapasitas:

```text
Client upload speed
Nginx worker connections
Nginx buffers/temp disk
Upstream connection pool
Java thread pool/event loop
Java DB connection pool
Database CPU/IO/locks
External API quota
```

Jika downstream lambat tetapi upstream terus menerima request tanpa batas, maka terbentuk queue.

Queue tidak selalu buruk. Tetapi queue tanpa deadline adalah awal cascading failure.

---

## 16. Backpressure Chain dalam Sistem Java

Contoh Spring Boot + Tomcat + JDBC:

```text
Nginx accepts 10,000 client connections
Nginx proxies to Java app
Tomcat max threads = 200
HikariCP max pool = 30
Database can handle 100 active queries
```

Jika database lambat:

```text
DB query slower
Hikari connections occupied
Tomcat threads wait for DB connection/query
Tomcat thread pool fills
Nginx upstream requests wait
Nginx proxy_read_timeout fires
Clients retry
More requests arrive
Tomcat remains saturated
```

Backpressure yang baik harus terjadi sebelum sistem runtuh:

- rate limit di Nginx;
- connection limit;
- short queue;
- bounded thread pool;
- DB timeout;
- circuit breaker;
- fail fast;
- shed load;
- return 429/503;
- stale cache;
- graceful degradation.

Nginx berperan sebagai salah satu pressure boundary, bukan satu-satunya mekanisme.

---

## 17. Buffering sebagai Backpressure Boundary

Request buffering ON:

```text
Slow client pressure ditahan di Nginx
Java app menerima request setelah body lengkap
```

Ini melindungi Java dari slow upload.

Response buffering ON:

```text
Slow client download pressure ditahan di Nginx
Java app bisa selesai lebih cepat
```

Ini melindungi Java dari slow readers.

Tetapi buffering memindahkan tekanan ke Nginx:

```text
Nginx memory
Nginx temp disk
Nginx worker connections
Nginx file descriptors
```

Tidak ada pressure yang hilang. Ia hanya dipindahkan.

Top 1% engineer harus selalu bertanya:

> Pressure ini sekarang ditahan di mana, oleh resource apa, dan apa batasnya?

---

## 18. Timeout sebagai Backpressure Boundary

Timeout membatasi durasi resource ditahan.

Contoh:

```nginx
proxy_connect_timeout 1s;
proxy_read_timeout 10s;
send_timeout 30s;
```

Artinya:

- jangan menunggu upstream yang tidak bisa dikoneksi terlalu lama;
- jangan menunggu Java response terlalu lama;
- jangan mempertahankan client yang tidak membaca terlalu lama.

Namun timeout harus dipadukan dengan:

- queue limit;
- connection limit;
- rate limit;
- app deadline;
- dependency timeout;
- retry budget.

Timeout tanpa limit bisa tetap membuat sistem overload. Limit tanpa timeout bisa membuat queue stuck.

---

## 19. 499, 502, 503, 504 dari Perspektif Timeout dan Backpressure

---

## 19.1 `499 Client Closed Request`

`499` adalah status khas Nginx untuk situasi ketika client menutup koneksi sebelum Nginx selesai memproses response.

Skenario:

```text
Client timeout 5s
Java app response 10s
Nginx masih menunggu upstream
Client disconnect
Nginx log 499
```

Penyebab umum:

- backend lambat;
- client timeout terlalu pendek;
- user membatalkan request;
- mobile network putus;
- load balancer di depan Nginx menutup koneksi;
- response besar dan client lambat.

Interpretasi penting:

- 499 bukan selalu masalah client;
- 499 sering gejala backend latency melebihi client patience;
- jika 499 naik bersamaan dengan upstream response time, backend mungkin akar masalah;
- jika 499 naik tanpa backend latency, mungkin client/network/LB behavior.

---

## 19.2 `502 Bad Gateway`

Skenario umum:

- upstream connection refused;
- upstream reset connection;
- upstream mengirim response invalid;
- upstream mati saat request berlangsung;
- protocol mismatch;
- DNS/upstream salah;
- Java process crash/restart.

Contoh log:

```text
connect() failed (111: Connection refused) while connecting to upstream
upstream prematurely closed connection while reading response header from upstream
```

`502` sering berarti Nginx berhasil bertindak sebagai gateway, tetapi upstream tidak memenuhi kontrak protocol/connection.

---

## 19.3 `503 Service Unavailable`

Bisa muncul karena:

- upstream tidak tersedia;
- limit/rate limiting tertentu;
- maintenance response;
- no live upstream;
- application sengaja mengembalikan 503.

Dalam desain backpressure, `503` bisa menjadi respon yang benar untuk load shedding.

Lebih baik mengembalikan `503` cepat daripada membiarkan semua request menunggu sampai timeout dan menghancurkan sistem.

---

## 19.4 `504 Gateway Timeout`

`504` berarti Nginx tidak menerima response upstream tepat waktu.

Skenario:

```text
Nginx connect ke Java berhasil
Nginx kirim request berhasil
Java tidak mengirim response sebelum proxy_read_timeout
Nginx return 504
```

Penyebab umum:

- Java endpoint lambat;
- database query lambat;
- thread pool penuh;
- deadlock;
- GC pause;
- external service timeout terlalu lama;
- no application deadline;
- response streaming tanpa heartbeat;
- upstream overload.

Jangan otomatis menaikkan `proxy_read_timeout`. Pertama tanya:

- endpoint ini memang boleh selama itu?
- client timeout berapa?
- Java masih bekerja setelah Nginx timeout?
- dependency timeout lebih kecil atau lebih besar?
- apakah ada retry yang memperburuk load?
- apakah desain seharusnya async?

---

## 20. Konfigurasi Baseline untuk API Java Normal

Contoh baseline untuk API request-response biasa:

```nginx
upstream java_api {
    server 10.0.1.10:8080 max_fails=3 fail_timeout=10s;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=10s;

    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;

        proxy_connect_timeout 1s;
        proxy_send_timeout 5s;
        proxy_read_timeout 15s;

        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 3s;

        proxy_request_buffering on;
        proxy_buffering on;

        proxy_pass http://java_api;
    }
}
```

Catatan:

- Ini bukan template universal.
- Untuk mutation endpoint, retry harus lebih ketat.
- Untuk streaming, buffering harus berbeda.
- Untuk upload, body size dan temp storage harus dihitung.
- Untuk low-latency API, timeout mungkin harus lebih kecil.

---

## 21. Memisahkan Policy Berdasarkan Endpoint

Jangan memaksa semua endpoint memakai policy sama.

Contoh:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    location /api/read/ {
        proxy_connect_timeout 1s;
        proxy_send_timeout 3s;
        proxy_read_timeout 8s;

        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;

        proxy_request_buffering on;
        proxy_buffering on;
        proxy_pass http://java_read_api;
    }

    location /api/commands/ {
        proxy_connect_timeout 1s;
        proxy_send_timeout 5s;
        proxy_read_timeout 20s;

        proxy_next_upstream error;
        proxy_next_upstream_tries 1;

        proxy_request_buffering on;
        proxy_buffering on;
        proxy_pass http://java_command_api;
    }

    location /api/events/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_connect_timeout 1s;
        proxy_send_timeout 1h;
        proxy_read_timeout 1h;

        proxy_request_buffering off;
        proxy_buffering off;
        proxy_cache off;

        proxy_pass http://java_event_api;
    }
}
```

Ini lebih dekat ke production thinking:

```text
Different traffic class, different failure policy.
```

---

## 22. Integrasi dengan Java Timeout

Nginx timeout tidak cukup jika aplikasi Java tidak punya timeout internal.

Contoh buruk:

```text
Nginx proxy_read_timeout = 10s
Spring Boot endpoint calls external service with no timeout
External service hangs 60s
```

Hasil:

```text
Nginx returns 504 at 10s
Spring thread remains blocked until 60s
Thread pool pressure accumulates
```

Contoh lebih baik:

```text
Nginx proxy_read_timeout = 10s
Spring request deadline = 8s
External HTTP timeout = 2s
DB query timeout = 3s
```

Aplikasi punya kesempatan:

- membatalkan pekerjaan;
- mengembalikan fallback/error sebelum Nginx timeout;
- mencatat domain error;
- release resource lebih cepat.

---

## 23. Spring Boot / Java Considerations

Hal-hal yang perlu disejajarkan:

### 23.1 Server connection timeout

Spring Boot embedded server punya konfigurasi untuk connection/request behavior tergantung container:

- Tomcat;
- Jetty;
- Undertow;
- Netty/Reactor Netty.

Pastikan tidak ada timeout yang jauh lebih besar/kecil tanpa alasan.

### 23.2 Servlet thread pool

Untuk Tomcat:

```text
server.tomcat.threads.max
server.tomcat.accept-count
```

Jika Nginx bisa mengirim banyak request bersamaan tetapi Tomcat hanya punya thread terbatas, queue akan terjadi.

Queue harus bounded dan observable.

### 23.3 HTTP client timeout

Untuk Java outbound call:

- connect timeout;
- read/response timeout;
- connection acquisition timeout;
- total deadline;
- retry policy.

Jangan hanya set connect timeout. Banyak bug terjadi karena read timeout tidak diset.

### 23.4 JDBC timeout

Pastikan ada:

- query timeout;
- transaction timeout;
- connection pool acquisition timeout;
- max lifetime/idle timeout yang benar;
- slow query monitoring.

### 23.5 Cancellation propagation

Jika client disconnect atau Nginx timeout, aplikasi Java tidak selalu otomatis membatalkan pekerjaan downstream.

Untuk request mahal:

- gunakan deadline eksplisit;
- cek cancellation jika framework mendukung;
- jangan jalankan operasi panjang sinkron di request thread;
- gunakan job async untuk pekerjaan panjang.

---

## 24. Upload Besar: Design Review

Misalnya requirement:

```text
User upload file sampai 500 MB.
Backend Java memvalidasi metadata dan menyimpan ke object storage.
```

Desain naive:

```text
Browser -> Nginx -> Spring Boot -> S3
```

Masalah:

- Nginx menerima body besar;
- disk temp Nginx bisa penuh;
- Spring Boot thread mungkin tertahan;
- upload lambat memakan connection lama;
- retry bisa menggandakan upload;
- user timeout tidak jelas;
- failure halfway sulit ditangani.

Desain lebih baik:

```text
1. Browser meminta upload session ke Java app.
2. Java app validasi authorization dan metadata.
3. Java app membuat pre-signed URL object storage.
4. Browser upload langsung ke object storage.
5. Browser/worker callback finalize metadata.
```

Nginx tetap penting untuk API metadata, tetapi bukan jalur data utama file besar.

Pelajaran:

> Kadang konfigurasi Nginx terbaik adalah tidak menjadikan Nginx sebagai pipe untuk traffic yang tidak perlu melewatinya.

---

## 25. Long-Running Job: Jangan Diselesaikan dengan Timeout 1 Jam

Requirement:

```text
User klik Generate Report.
Report bisa memakan waktu 2-10 menit.
```

Solusi buruk:

```nginx
proxy_read_timeout 10m;
```

Lalu request HTTP sinkron menunggu sampai report selesai.

Masalah:

- client/browser bisa timeout;
- LB di depan Nginx mungkin punya idle timeout lebih pendek;
- Java thread tertahan;
- retry user bisa membuat job ganda;
- progress tidak jelas;
- deploy/restart bisa memutus request;
- observability buruk.

Desain lebih baik:

```text
POST /reports -> 202 Accepted + job_id
GET /reports/{job_id}/status -> status/progress
GET /reports/{job_id}/download -> download result
```

Nginx timeout tetap normal untuk request pendek. Job berjalan async di worker/background system.

---

## 26. Observability untuk Timeout dan Buffering

Gunakan `log_format` yang memuat timing upstream.

Contoh:

```nginx
log_format api_json escape=json
'{'
  '"time":"$time_iso8601",'
  '"request_id":"$request_id",'
  '"remote_addr":"$remote_addr",'
  '"host":"$host",'
  '"method":"$request_method",'
  '"uri":"$request_uri",'
  '"status":$status,'
  '"request_time":$request_time,'
  '"upstream_addr":"$upstream_addr",'
  '"upstream_status":"$upstream_status",'
  '"upstream_connect_time":"$upstream_connect_time",'
  '"upstream_header_time":"$upstream_header_time",'
  '"upstream_response_time":"$upstream_response_time",'
  '"body_bytes_sent":$body_bytes_sent,'
  '"request_length":$request_length'
'}';

access_log /var/log/nginx/api_access.log api_json;
```

Field penting:

- `$request_time`: total waktu request dari perspektif Nginx;
- `$upstream_connect_time`: waktu connect ke upstream;
- `$upstream_header_time`: waktu sampai header response upstream diterima;
- `$upstream_response_time`: waktu response upstream;
- `$upstream_status`: status dari upstream;
- `$upstream_addr`: upstream yang dipilih.

Interpretasi:

```text
request_time tinggi, upstream_response_time rendah
=> client lambat menerima response atau Nginx buffering/send issue
```

```text
upstream_connect_time tinggi
=> koneksi ke backend/network bermasalah
```

```text
upstream_header_time tinggi
=> backend lambat menghasilkan response awal
```

```text
upstream_response_time tinggi tapi header_time rendah
=> response body besar/streaming/lambat
```

```text
status 499 dan upstream_response_time mendekati client timeout
=> client pergi karena backend lambat
```

```text
status 504 dan upstream_response_time sekitar proxy_read_timeout
=> Nginx menunggu upstream sampai timeout
```

---

## 27. Debugging Playbook: 504 Meningkat

Gejala:

```text
504 Gateway Timeout meningkat di Nginx
```

Langkah berpikir:

### 1. Lihat distribusi endpoint

Apakah semua endpoint atau hanya endpoint tertentu?

```text
/api/search
/api/report
/api/payment
```

Jika spesifik endpoint, fokus pada backend logic/dependency endpoint itu.

### 2. Lihat timing log

Bandingkan:

```text
$request_time
$upstream_connect_time
$upstream_header_time
$upstream_response_time
```

Jika `upstream_connect_time` tinggi, masalah koneksi/upstream accept.

Jika `upstream_header_time` tinggi, backend lambat menghasilkan response.

Jika `upstream_response_time` tepat di angka `proxy_read_timeout`, timeout policy bekerja.

### 3. Cek error log

Cari:

```text
upstream timed out while reading response header from upstream
connect() failed
upstream prematurely closed connection
```

### 4. Cek Java app metrics

- thread pool utilization;
- request latency;
- GC pause;
- DB pool saturation;
- external HTTP latency;
- error rate;
- queue length.

### 5. Cek dependency

- database slow query;
- lock contention;
- Redis latency;
- third-party API latency;
- Kafka lag jika request menunggu event.

### 6. Jangan langsung menaikkan timeout

Menaikkan timeout hanya benar jika:

- endpoint memang legitimate long-running;
- client dan LB juga mendukung;
- Java/dependency deadline disesuaikan;
- kapasitas untuk request lama dihitung;
- tidak ada alternatif async lebih baik.

---

## 28. Debugging Playbook: 499 Meningkat

Gejala:

```text
499 Client Closed Request meningkat
```

Langkah:

### 1. Apakah request_time mendekati timeout client?

Jika banyak `499` pada sekitar 5s, 10s, 30s, bisa jadi client/LB punya timeout di angka itu.

### 2. Apakah upstream masih memproses?

Cek aplikasi Java apakah request tetap selesai setelah client pergi.

### 3. Apakah endpoint lambat?

Jika 499 naik bersama p95/p99 backend latency, akar masalah mungkin backend.

### 4. Apakah response besar?

Client bisa disconnect saat download besar.

### 5. Apakah mobile/browser behavior?

User pindah halaman, browser cancel fetch, app mobile background, network putus.

### 6. Apakah ada load balancer di depan Nginx?

LB bisa menutup idle connection lebih cepat dari Nginx.

---

## 29. Debugging Playbook: Upload Gagal

Gejala:

- `413 Request Entity Too Large`;
- request putus saat upload;
- `client intended to send too large body`;
- disk Nginx penuh;
- Java tidak menerima request sampai lama.

Cek:

```nginx
client_max_body_size
client_body_timeout
client_body_buffer_size
client_body_temp_path
proxy_request_buffering
proxy_send_timeout
```

Pertanyaan desain:

- Apakah body size legitimate?
- Apakah Nginx seharusnya menerima file sebesar itu?
- Apakah upload harus direct-to-object-storage?
- Apakah temp disk cukup?
- Apakah Kubernetes ephemeral storage limit cukup?
- Apakah Java endpoint streaming atau membaca semua ke memory?

---

## 30. Debugging Playbook: SSE Tidak Real-Time

Gejala:

```text
Backend mengirim event setiap detik, tapi browser menerima sekaligus setelah lama.
```

Kemungkinan:

```nginx
proxy_buffering on;
```

Solusi:

```nginx
location /api/events/ {
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_pass http://java_backend;
}
```

Di aplikasi Java:

- flush output setelah event;
- kirim heartbeat;
- pastikan response content type benar;
- jangan ada buffering framework yang menahan output.

---

## 31. Common Anti-Patterns

### Anti-pattern 1: Satu Timeout Global untuk Semua Endpoint

```nginx
proxy_read_timeout 300s;
```

Masalah:

- endpoint cepat terlalu longgar;
- endpoint lambat tetap sinkron;
- failure lambat dideteksi;
- resource tertahan lama.

Lebih baik:

```text
Pisahkan read API, command API, upload, streaming, report/job.
```

---

### Anti-pattern 2: Menaikkan Timeout untuk Menyembunyikan Backend Lambat

Gejala:

```text
504 terjadi
proxy_read_timeout dinaikkan dari 60s ke 600s
```

Jika akar masalah DB query lambat, ini hanya memindahkan gejala.

---

### Anti-pattern 3: Retry Semua Request

```nginx
proxy_next_upstream error timeout http_500 http_502 http_503 http_504;
proxy_next_upstream_tries 3;
```

Untuk POST non-idempotent, ini berbahaya.

---

### Anti-pattern 4: Request Buffering OFF untuk Semua Upload

Tujuannya menghindari disk temp Nginx, tetapi akibatnya Java backend terekspos slow clients.

---

### Anti-pattern 5: Response Buffering OFF untuk Semua API

Ini bisa membuat Java backend tertahan oleh client lambat.

---

### Anti-pattern 6: Tidak Memonitor Temp Disk

Buffering memakai disk saat body/response besar. Tanpa monitoring, failure muncul sebagai kejutan.

---

### Anti-pattern 7: Timeout Nginx Lebih Pendek dari App Error Handling

Jika aplikasi butuh 8s untuk timeout dependency dan mengembalikan fallback, tetapi Nginx timeout 5s, fallback tidak pernah sampai ke client.

---

## 32. Design Pattern: Traffic Class Policy

Pisahkan traffic berdasarkan karakteristik.

```text
Class A: static assets
Class B: normal read API
Class C: command/write API
Class D: upload
Class E: streaming/WebSocket/SSE
Class F: report/export async
Class G: internal/admin/actuator
```

Untuk setiap class, tentukan:

- max body size;
- request buffering;
- response buffering;
- connect timeout;
- send timeout;
- read timeout;
- retry policy;
- rate limit;
- access control;
- logging detail;
- upstream pool;
- Java deadline;
- dependency deadline.

Ini jauh lebih kuat daripada satu config generik.

---

## 33. Production Checklist

Gunakan checklist ini saat review Nginx di depan Java service.

### Timeout

- [ ] `proxy_connect_timeout` eksplisit.
- [ ] `proxy_send_timeout` eksplisit.
- [ ] `proxy_read_timeout` eksplisit.
- [ ] `send_timeout` dievaluasi.
- [ ] `client_header_timeout` dievaluasi.
- [ ] `client_body_timeout` dievaluasi.
- [ ] Timeout berbeda untuk API normal, upload, streaming, dan command.
- [ ] Timeout Nginx sejajar dengan app deadline.
- [ ] Dependency timeout lebih pendek dari app deadline.
- [ ] Client/LB timeout diketahui.

### Retry

- [ ] `proxy_next_upstream` tidak terlalu permisif.
- [ ] Retry tidak diterapkan buta untuk mutation endpoint.
- [ ] `proxy_next_upstream_tries` dibatasi.
- [ ] `proxy_next_upstream_timeout` dipertimbangkan.
- [ ] Idempotency key tersedia untuk command yang boleh retry.
- [ ] Retry di client, Nginx, app, dan dependency dihitung sebagai satu budget.

### Buffering

- [ ] `proxy_request_buffering` sesuai jenis endpoint.
- [ ] `proxy_buffering` sesuai jenis response.
- [ ] SSE/streaming mematikan buffering.
- [ ] Upload besar punya body size limit.
- [ ] Temp path dan disk capacity dimonitor.
- [ ] Container ephemeral storage cukup.

### Backpressure

- [ ] Rate limit/connection limit dipertimbangkan.
- [ ] Java thread pool bounded.
- [ ] DB pool bounded.
- [ ] Queue length observable.
- [ ] Load shedding strategy ada.
- [ ] 429/503 policy jelas.
- [ ] Stale cache/fallback dipertimbangkan untuk read-heavy endpoint.

### Observability

- [ ] Access log memuat request time.
- [ ] Access log memuat upstream timing.
- [ ] Access log memuat upstream addr/status.
- [ ] Correlation/request ID diteruskan ke Java.
- [ ] Dashboard memisahkan 499/502/503/504.
- [ ] Alert tidak hanya berdasarkan error rate, tetapi juga latency dan saturation.

---

## 34. Latihan Mental Model

### Latihan 1: Kenapa 504 Naik?

Konfigurasi:

```nginx
proxy_connect_timeout 5s;
proxy_read_timeout 30s;
```

Log:

```text
status=504 request_time=30.001 upstream_connect_time=0.002 upstream_header_time=30.000 upstream_response_time=30.000
```

Interpretasi:

- connect ke upstream cepat;
- backend menerima request;
- backend tidak mengirim header response sebelum 30s;
- timeout terjadi saat menunggu response dari Java;
- fokus debugging: Java endpoint, thread pool, DB/external dependency, deadlock, GC pause.

---

### Latihan 2: Kenapa 499 Naik?

Log:

```text
status=499 request_time=5.001 upstream_response_time=5.000
```

Kemungkinan:

- client atau LB punya timeout 5s;
- backend belum menjawab sebelum client pergi;
- aplikasi mungkin tetap memproses request setelah client disconnect;
- perlu cek client timeout, LB timeout, backend p95/p99, cancellation.

---

### Latihan 3: Kenapa SSE Diterima Batch?

Konfigurasi:

```nginx
location /events/ {
    proxy_pass http://java_backend;
}
```

Gejala:

```text
Backend emit event tiap detik, browser menerima setelah 60 detik sekaligus.
```

Kemungkinan:

- `proxy_buffering on` default;
- framework Java tidak flush;
- intermediate proxy buffering;
- response compression buffering.

Perbaikan Nginx:

```nginx
location /events/ {
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_pass http://java_backend;
}
```

---

### Latihan 4: Apakah Retry Aman?

Endpoint:

```text
POST /api/orders
```

Nginx:

```nginx
proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 3;
```

Pertanyaan:

- Apakah order creation idempotent?
- Apakah ada idempotency key?
- Apakah database punya unique constraint untuk request id?
- Apakah timeout bisa terjadi setelah order dibuat tapi response belum sampai?

Jika tidak ada idempotency, retry otomatis ini berisiko membuat order ganda.

---

## 35. Reference Configuration: Multi-Class API

Contoh berikut bukan template copy-paste final, tetapi ilustrasi cara memisahkan policy.

```nginx
upstream java_read_api {
    server 10.0.1.10:8080 max_fails=3 fail_timeout=10s;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;
}

upstream java_command_api {
    server 10.0.2.10:8080 max_fails=2 fail_timeout=10s;
    server 10.0.2.11:8080 max_fails=2 fail_timeout=10s;
    keepalive 32;
}

upstream java_stream_api {
    server 10.0.3.10:8080 max_fails=2 fail_timeout=10s;
    server 10.0.3.11:8080 max_fails=2 fail_timeout=10s;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;

    location /api/read/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_connect_timeout 1s;
        proxy_send_timeout 3s;
        proxy_read_timeout 8s;

        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 2;
        proxy_next_upstream_timeout 2s;

        proxy_request_buffering on;
        proxy_buffering on;

        proxy_pass http://java_read_api;
    }

    location /api/commands/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_connect_timeout 1s;
        proxy_send_timeout 5s;
        proxy_read_timeout 20s;

        # Conservative: no automatic retry to another upstream for commands.
        proxy_next_upstream error;
        proxy_next_upstream_tries 1;

        proxy_request_buffering on;
        proxy_buffering on;

        proxy_pass http://java_command_api;
    }

    location /api/uploads/ {
        client_max_body_size 100m;
        client_body_timeout 60s;

        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_connect_timeout 2s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;

        proxy_request_buffering on;
        proxy_buffering on;

        proxy_next_upstream error;
        proxy_next_upstream_tries 1;

        proxy_pass http://java_command_api;
    }

    location /api/events/ {
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_connect_timeout 1s;
        proxy_send_timeout 1h;
        proxy_read_timeout 1h;

        proxy_request_buffering off;
        proxy_buffering off;
        proxy_cache off;

        proxy_next_upstream off;

        proxy_pass http://java_stream_api;
    }
}
```

Review config ini dengan pertanyaan:

- Apakah command endpoint benar-benar tidak boleh retry?
- Apakah upload sebaiknya direct-to-object-storage?
- Apakah streaming upstream perlu sticky session?
- Apakah `proxy_read_timeout 1h` cocok dengan heartbeat aplikasi?
- Apakah Nginx di belakang cloud LB yang punya idle timeout lebih pendek?
- Apakah Java app punya deadline lebih pendek daripada Nginx?

---

## 36. Invariant yang Harus Kamu Pegang

Beberapa invariant production-grade:

1. **Layer terdalam harus timeout lebih cepat daripada layer luar.**
2. **Retry tanpa idempotency adalah risiko correctness.**
3. **Retry tanpa budget adalah risiko availability.**
4. **Buffering tidak menghilangkan pressure; hanya memindahkannya.**
5. **Timeout besar tidak memperbaiki sistem lambat; sering hanya memperpanjang penderitaan.**
6. **Streaming endpoint harus diperlakukan berbeda dari API biasa.**
7. **Upload besar adalah arsitektur data path, bukan sekadar `client_max_body_size`.**
8. **499 sering gejala mismatch antara backend latency dan client patience.**
9. **504 adalah sinyal bahwa upstream deadline contract gagal.**
10. **Nginx, Java app, DB, client, dan LB harus punya timeout model yang konsisten.**

---

## 37. Kesimpulan

Timeout, retry, buffering, dan backpressure adalah inti dari kemampuan Nginx sebagai production traffic runtime.

Engineer pemula melihat Nginx sebagai:

```text
request router
```

Engineer production melihat Nginx sebagai:

```text
pressure boundary + failure policy executor + traffic contract enforcer
```

Perbedaan keduanya tampak saat sistem tidak ideal:

- upstream lambat;
- client lambat;
- DB overload;
- deployment restart;
- koneksi putus;
- upload besar;
- response streaming;
- retry muncul di beberapa layer;
- traffic spike.

Untuk menjadi sangat kuat di Nginx, kamu harus mampu menjawab:

```text
Request ini boleh hidup berapa lama?
Siapa yang boleh retry?
Apakah retry aman?
Body disimpan di mana?
Response ditahan di mana?
Jika client lambat, siapa yang menanggung?
Jika backend lambat, siapa yang gagal duluan?
Jika DB stuck, bagaimana tekanan berhenti?
```

Jika kamu bisa menjawab itu secara eksplisit, konfigurasi Nginx kamu tidak lagi copy-paste. Ia menjadi bagian dari desain sistem.

---

## 38. Checklist Ringkas untuk Review Cepat

Saat melihat konfigurasi Nginx reverse proxy, cek cepat:

```text
[ ] Ada proxy_connect_timeout?
[ ] Ada proxy_send_timeout?
[ ] Ada proxy_read_timeout?
[ ] Timeout berbeda per traffic class?
[ ] Retry dibatasi?
[ ] Mutation endpoint tidak diretry buta?
[ ] Request buffering sesuai?
[ ] Response buffering sesuai?
[ ] Streaming mematikan buffering?
[ ] Upload punya size dan disk model?
[ ] Java app punya timeout lebih pendek?
[ ] DB/external call punya timeout?
[ ] Access log punya upstream timing?
[ ] 499/502/503/504 dimonitor terpisah?
```

---

## 39. Penutup Part 010

Kita sudah membahas:

- timeout utama Nginx;
- timeout budget;
- retry safety;
- retry storm;
- request buffering;
- response buffering;
- backpressure chain;
- debugging 499/502/503/504;
- integrasi dengan Java application timeout;
- design pattern per traffic class.

Part berikutnya akan masuk ke:

> **Part 011 — Connection Management and Performance Tuning**

Di sana kita akan membahas:

- `worker_processes`;
- `worker_connections`;
- file descriptor limit;
- keepalive capacity;
- TCP backlog;
- `sendfile`;
- `tcp_nopush`;
- `tcp_nodelay`;
- sizing model;
- capacity planning untuk Nginx di depan aplikasi Java.

Status seri: **belum selesai**.  
Progress: **Part 010 dari 030**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Upstream Blocks and Load Balancing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-011.md">Part 011 — Connection Management and Performance Tuning ➡️</a>
</div>
