# learn-http-for-web-frontend-perspective-part-019.md

# Part 019 — HTTP/1.1, HTTP/2, HTTP/3: What Frontend Engineers Actually Need

> Seri: `learn-http-for-web-frontend-perspective`  
> Audiens: Java software engineer yang ingin memahami HTTP dari perspektif browser/frontend  
> Fokus: semantic HTTP tetap sama, tetapi transport, koneksi, multiplexing, latency, prioritas resource, dan deployment topology mengubah cara browser mengalami HTTP.

---

## 0. Posisi Bagian Ini dalam Seri

Sampai Part 018, kita sudah membangun fondasi:

- URL, origin, site;
- request/response/header/body;
- method dan status code;
- `fetch()`, non-fetch request, CORS, cookies;
- caching, revalidation, redirect;
- content negotiation;
- resource loading, preload scanner, priority, dan waterfall.

Part ini menjawab pertanyaan yang sering muncul setelah melihat Network tab:

> “Kalau HTTP semantics sama, kenapa HTTP/1.1, HTTP/2, dan HTTP/3 tetap penting untuk frontend?”

Jawaban pendeknya:

**Karena frontend tidak hanya peduli apa arti request, tapi juga kapan request dikirim, lewat koneksi mana, diprioritaskan bagaimana, tertahan oleh apa, gagal karena apa, dan bagaimana browser/CDN/proxy mengatur banyak resource sekaligus.**

HTTP version tidak banyak mengubah arti `GET`, `POST`, `Cache-Control`, `ETag`, `Content-Type`, atau `Set-Cookie`. Tetapi HTTP version sangat memengaruhi:

- connection setup latency;
- request concurrency;
- head-of-line blocking;
- header compression;
- multiplexing;
- origin strategy;
- domain sharding;
- bundling/splitting strategy;
- waterfall interpretation;
- CDN/proxy behavior;
- mobile/high-latency user experience.

---

## 1. Core Mental Model: Semantics vs Transport

Modern HTTP harus dipahami sebagai dua lapisan besar:

```text
HTTP Semantics
  - method
  - status code
  - header meaning
  - cache rules
  - authentication metadata
  - representation metadata
  - redirect semantics
  - conditional requests

HTTP Mapping / Transport
  - HTTP/1.1 over TCP/TLS
  - HTTP/2 over TCP/TLS with binary framing and streams
  - HTTP/3 over QUIC/UDP with streams and integrated TLS 1.3
```

HTTP semantics menjawab:

```text
Apa arti request dan response ini?
```

Transport/mapping menjawab:

```text
Bagaimana request dan response ini dikirim melalui jaringan?
```

Contoh:

```http
GET /assets/app.8f3a1.js HTTP/2
Host: cdn.example.com
Accept: */*
```

Dari sisi semantics:

- `GET` berarti retrieval;
- resource target adalah `/assets/app.8f3a1.js`;
- response mungkin cacheable;
- `Cache-Control: max-age=31536000, immutable` berarti browser boleh reuse asset sangat lama.

Dari sisi transport:

- request itu mungkin menjadi stream HTTP/2 di satu koneksi TLS;
- bersamaan dengan CSS, image, font, dan API call;
- prioritasnya mungkin lebih rendah/tinggi tergantung browser;
- kalau satu packet TCP hilang, stream lain bisa ikut terdampak di HTTP/2 karena TCP-level head-of-line blocking;
- pada HTTP/3, loss pada satu QUIC stream tidak harus memblokir delivery stream lain pada level transport.

Mental model yang benar:

```text
HTTP semantics memberi meaning.
Transport memberi timing, concurrency, failure profile, dan performance envelope.
```

---

## 2. Evolution Ringkas: Kenapa Banyak Versi HTTP Ada?

### 2.1 HTTP/1.1

HTTP/1.1 tumbuh dari model sederhana:

```text
1 TCP connection
  -> request
  <- response
  -> request
  <- response
```

Dengan persistent connection, koneksi bisa dipakai ulang, tetapi satu koneksi secara praktis tetap punya keterbatasan besar: request/response sequencing dan head-of-line blocking.

Browser akhirnya membuka beberapa koneksi paralel ke origin yang sama untuk meningkatkan concurrency.

### 2.2 HTTP/2

HTTP/2 memperkenalkan binary framing dan multiplexing:

```text
1 TCP connection
  stream 1: HTML
  stream 3: CSS
  stream 5: JS
  stream 7: image
  stream 9: API
```

Banyak request/response bisa berjalan bersamaan di satu koneksi.

Ini mengurangi kebutuhan domain sharding dan mengurangi overhead koneksi, tetapi masih berjalan di atas TCP. Jika packet TCP hilang, byte stream TCP harus dipulihkan secara urut. Akibatnya, stream HTTP/2 lain bisa ikut menunggu di level transport.

### 2.3 HTTP/3

HTTP/3 memetakan HTTP semantics ke QUIC, bukan TCP.

QUIC berjalan di atas UDP dan menyediakan:

- stream multiplexing;
- per-stream flow control;
- reliable delivery;
- TLS 1.3 integration;
- connection migration;
- lower setup latency dalam beberapa skenario;
- pengurangan transport-level head-of-line blocking antar-stream.

Gambaran sangat sederhana:

```text
HTTP/1.1: many TCP connections, limited multiplexing
HTTP/2:   one/fewer TCP connections, many HTTP streams, TCP HoL still possible
HTTP/3:   QUIC connection, many QUIC streams, per-stream loss isolation better
```

---

## 3. HTTP/1.1 dari Perspektif Frontend

### 3.1 Karakter Utama

HTTP/1.1 biasanya memakai:

```text
HTTP semantics
  over textual message format
  over TCP
  optionally over TLS for HTTPS
```

Karakter penting:

- request/response message berbasis teks;
- persistent connection / keep-alive;
- satu koneksi tidak efektif untuk banyak parallel response;
- browser membuka beberapa koneksi ke origin yang sama;
- connection setup mahal karena DNS + TCP + TLS;
- pipelining secara historis bermasalah dan tidak menjadi fondasi praktik browser modern.

### 3.2 Persistent Connection

Tanpa reuse koneksi:

```text
Request A:
DNS -> TCP -> TLS -> request -> response -> close

Request B:
DNS -> TCP -> TLS -> request -> response -> close
```

Dengan persistent connection:

```text
DNS -> TCP -> TLS
  request A -> response A
  request B -> response B
  request C -> response C
```

Ini mengurangi biaya connection setup.

Namun, kalau response A lambat dan request B menunggu giliran, waterfall bisa menjadi panjang.

### 3.3 Browser Connection Limit

Di HTTP/1.1, browser biasanya membuka beberapa koneksi paralel per origin. Jumlah tepatnya tergantung browser, versi, platform, dan kondisi, jadi jangan desain sistem dengan angka absolut.

Mental model yang cukup:

```text
HTTP/1.1 concurrency per origin terbatas oleh jumlah koneksi paralel.
```

Konsekuensi frontend:

- terlalu banyak resource kecil bisa antre;
- waterfall tampak berlapis-lapis;
- domain sharding dulu dipakai untuk menambah parallelism;
- sprite image, concatenated CSS/JS, dan bundling besar dulu menjadi optimasi umum.

### 3.4 Head-of-Line Blocking di HTTP/1.1

Head-of-line blocking berarti item di depan antrean menghambat item di belakang.

Misalnya:

```text
Connection 1:
  request large-image.jpg -> response lambat
  request app.js          -> menunggu
```

Atau lebih umum:

```text
Request penting tidak bisa mulai karena connection slot sudah dipakai request kurang penting.
```

Bagi frontend, efeknya terlihat sebagai:

- resource penting `Queued` atau `Stalled`;
- CSS/JS critical terlambat;
- LCP resource terlambat;
- banyak request kecil membuat critical path panjang.

### 3.5 Domain Sharding: Optimasi Lama yang Bisa Menjadi Anti-Pattern

Domain sharding berarti membagi resource ke beberapa hostname:

```text
static1.example.com
static2.example.com
static3.example.com
```

Tujuan historis:

```text
lebih banyak hostname -> lebih banyak connection slot -> lebih banyak parallelism
```

Di HTTP/1.1, ini kadang membantu.

Di HTTP/2/3, ini sering merugikan karena:

- memecah connection reuse;
- menambah DNS lookup;
- menambah TLS handshake;
- mengurangi manfaat multiplexing;
- menambah kompleksitas cookie/CORS/cache/CDN;
- dapat mengganggu prioritization.

Invariant modern:

```text
Jangan melakukan domain sharding sebagai default. Validasi dengan measurement.
```

---

## 4. HTTP/2 dari Perspektif Frontend

### 4.1 Apa yang Berubah?

HTTP/2 tidak mengubah HTTP semantics utama. Ia mengubah cara message dikirim.

Alih-alih textual request/response langsung di koneksi, HTTP/2 memakai:

- binary framing;
- stream;
- multiplexing;
- flow control;
- HPACK header compression;
- priority model;
- satu koneksi bisa membawa banyak concurrent request/response.

Gambaran:

```text
TCP/TLS connection
  HTTP/2 frame stream 1
  HTTP/2 frame stream 3
  HTTP/2 frame stream 5
  HTTP/2 frame stream 7
```

Response tidak harus selesai satu per satu. Frame dari banyak stream bisa saling interleave.

### 4.2 Multiplexing

Multiplexing berarti banyak stream logis berjalan di satu koneksi fisik.

```text
Connection to https://example.com
  stream 1: GET /index.html
  stream 3: GET /app.css
  stream 5: GET /app.js
  stream 7: GET /logo.svg
  stream 9: GET /api/me
```

Konsekuensi frontend:

- banyak request kecil tidak selalu separah di HTTP/1.1;
- connection overhead lebih rendah;
- domain sharding menjadi kurang relevan;
- asset splitting lebih feasible;
- request waterfall harus dibaca berbeda.

Namun:

```text
Multiplexing bukan izin untuk membuat request tanpa batas.
```

Kenapa?

- server tetap punya CPU/memory limit;
- CDN/proxy punya concurrency/flow control limit;
- browser punya scheduling limit;
- bandwidth tetap terbatas;
- header dan TLS tetap punya overhead;
- JavaScript parsing/execution tetap mahal;
- API backend tetap bisa overload.

### 4.3 Binary Framing

Di HTTP/1.1, message terlihat seperti teks:

```http
GET /app.js HTTP/1.1
Host: example.com
Accept: */*
```

Di HTTP/2, browser dan server bertukar frame biner.

Sebagai frontend engineer, Anda jarang perlu membaca frame mentah. Yang penting adalah efeknya:

- request/response bisa dipecah menjadi frame;
- beberapa stream bisa berjalan bersamaan;
- header dikompresi;
- body dikirim sebagai data frame;
- flow control bisa membuat response tertahan.

DevTools tetap menampilkan request/response dalam bentuk yang familiar, tetapi transport di bawahnya berbeda.

### 4.4 HPACK Header Compression

HTTP request frontend sering membawa banyak header:

- `Cookie`;
- `Accept`;
- `Accept-Language`;
- `User-Agent`;
- `Sec-Fetch-*`;
- `Authorization`;
- custom headers;
- tracing headers.

HTTP/2 memakai HPACK untuk mengurangi overhead header berulang.

Ini membantu karena banyak request ke origin yang sama memiliki header mirip.

Tetapi jangan menyimpulkan:

```text
Header besar tidak masalah karena dikompresi.
```

Tetap ada masalah:

- header besar menambah memory pressure;
- cookie besar tetap dikirim secara logis pada banyak request;
- server/proxy punya header size limit;
- variasi header bisa mengurangi efisiensi compression;
- sensitive header punya konsekuensi security;
- header bloat menyulitkan observability.

Rule praktis:

```text
Header compression mengurangi biaya transport, bukan menghapus biaya desain buruk.
```

### 4.5 HTTP/2 Prioritization: Penting, tapi Tidak Selalu Bisa Diprediksi

HTTP/2 memiliki konsep prioritas stream. Browser bisa memberi tahu server mana resource yang lebih penting.

Namun dalam praktik:

- implementasi browser berbeda;
- implementasi server/CDN berbeda;
- beberapa intermediary mengabaikan atau mengubah priority;
- browser priority bisa berubah saat layout/parser menemukan informasi baru;
- `fetchpriority`, `preload`, dan resource type ikut memengaruhi scheduling.

Jangan menganggap HTTP/2 otomatis menyelesaikan resource priority.

Mental model:

```text
HTTP/2 memberi mekanisme multiplexing dan priority, tetapi hasil akhir adalah kombinasi browser scheduler, server/CDN implementation, resource hints, dan network condition.
```

### 4.6 HTTP/2 Server Push: Catatan Historis

HTTP/2 pernah memperkenalkan server push: server bisa mengirim resource sebelum browser memintanya.

Secara teori:

```text
Browser minta HTML
Server juga push CSS/JS critical
```

Secara praktik, server push sulit:

- server tidak selalu tahu cache state browser;
- mudah mengirim resource yang tidak dibutuhkan;
- bisa membuang bandwidth;
- sulit diprioritaskan dengan benar;
- dukungan browser modern menurun/hilang.

Untuk frontend modern, lebih relevan memakai:

- `preload`;
- `preconnect`;
- `modulepreload`;
- 103 Early Hints;
- cache headers yang benar;
- asset fingerprinting.

---

## 5. HTTP/3 dari Perspektif Frontend

### 5.1 Apa yang Berubah?

HTTP/3 memetakan HTTP semantics ke QUIC.

QUIC:

- berjalan di atas UDP;
- mengintegrasikan TLS 1.3;
- menyediakan stream multiplexing;
- menyediakan per-stream flow control;
- mendukung connection migration;
- mengurangi transport-level head-of-line blocking antar-stream.

Gambaran:

```text
HTTP semantics
  -> HTTP/3 frames
  -> QUIC streams
  -> UDP packets
  -> IP
```

Berbeda dengan HTTP/2:

```text
HTTP semantics
  -> HTTP/2 frames
  -> TCP byte stream
  -> TLS
  -> IP
```

### 5.2 Kenapa QUIC Menggunakan UDP?

UDP sendiri tidak menyediakan reliability, ordering, congestion control, atau TLS.

QUIC membangun fitur-fitur itu di atas UDP.

Kenapa bukan TCP?

Karena TCP berada di kernel/OS/network middlebox ecosystem yang sulit diubah cepat. Dengan QUIC di user space, protokol bisa berevolusi lebih cepat dan mengintegrasikan TLS 1.3 serta stream multiplexing secara lebih fleksibel.

Frontend engineer tidak perlu mengimplementasikan QUIC, tetapi perlu memahami efeknya:

- koneksi bisa lebih cepat established dalam beberapa kondisi;
- packet loss tidak selalu memblokir semua stream;
- mobile network migration bisa lebih baik;
- UDP blocking oleh network tertentu bisa membuat fallback ke HTTP/2;
- debugging network kadang lebih sulit karena tooling TCP lama tidak cukup.

### 5.3 Transport-Level Head-of-Line Blocking

Di HTTP/2, banyak HTTP stream berjalan di atas satu TCP byte stream.

Jika satu packet TCP hilang:

```text
TCP harus menyusun ulang byte stream secara urut
HTTP/2 frames setelah missing bytes tidak bisa diserahkan ke layer atas
stream lain bisa ikut menunggu
```

Di HTTP/3/QUIC:

```text
loss pada packet yang membawa data stream A
  tidak harus memblokir delivery data stream B yang sudah lengkap
```

Ini tidak berarti HTTP/3 selalu lebih cepat.

Tetap ada:

- bandwidth bottleneck;
- congestion control;
- server processing latency;
- browser scheduling;
- TLS/certificate/DNS latency;
- JavaScript execution;
- cache miss;
- CDN routing;
- packet loss/retransmission.

Mental model yang benar:

```text
HTTP/3 memperbaiki beberapa failure/performance characteristics transport, bukan menghapus semua bottleneck web performance.
```

### 5.4 Connection Migration

Di mobile, user bisa berpindah dari Wi-Fi ke cellular.

Dengan TCP, koneksi terikat pada tuple seperti:

```text
source IP + source port + destination IP + destination port
```

Jika IP berubah, koneksi lama biasanya mati.

QUIC memakai connection ID sehingga koneksi dapat bertahan lebih baik saat path berubah.

Frontend implication:

- request panjang/streaming bisa lebih resilien di beberapa kondisi;
- mobile UX dapat membaik;
- tetapi aplikasi tetap harus punya retry/cancellation/reconnect logic;
- jangan mengandalkan transport untuk menyelesaikan semua state consistency.

### 5.5 QPACK Header Compression

HTTP/3 memakai QPACK, bukan HPACK.

Alasannya: HPACK dirancang untuk HTTP/2 di atas TCP ordered stream. QUIC memiliki banyak stream independen; header compression perlu menghindari blocking antar-stream yang berlebihan.

Bagi frontend engineer:

- header compression tetap ada;
- header bloat tetap buruk;
- cookie besar tetap buruk;
- dynamic header variation tetap bisa mengurangi efisiensi;
- jangan menaruh data domain besar di header.

---

## 6. TLS, ALPN, dan Negotiation Versi HTTP

### 6.1 Browser Tidak Biasanya “Memilih Manual” di JavaScript

Dalam aplikasi frontend biasa, Anda tidak menulis:

```js
fetch(url, { httpVersion: "3" })
```

Browser, TLS stack, dan server/CDN melakukan negotiation.

Frontend biasanya hanya melihat hasilnya di DevTools:

```text
Protocol: h2
Protocol: h3
Protocol: http/1.1
```

### 6.2 ALPN

ALPN adalah mekanisme TLS yang memungkinkan client dan server menyepakati application protocol.

Contoh hasil:

```text
h2       -> HTTP/2
http/1.1 -> HTTP/1.1
h3       -> HTTP/3 melalui QUIC path/advertisement terkait
```

Secara praktis:

- browser mencoba menggunakan protocol terbaik yang tersedia;
- CDN/server harus dikonfigurasi mendukungnya;
- certificate dan TLS config harus valid;
- middlebox/network bisa memengaruhi;
- fallback bisa terjadi.

### 6.3 Alt-Svc dan HTTP/3 Discovery

HTTP/3 tidak selalu ditemukan dengan cara yang sama seperti HTTP/2.

Salah satu mekanisme umum adalah server mengiklankan alternative service:

```http
Alt-Svc: h3=":443"; ma=86400
```

Browser dapat belajar bahwa origin tersedia melalui HTTP/3 dan kemudian mencoba koneksi QUIC.

Frontend implication:

- request pertama mungkin masih lewat HTTP/2;
- request berikutnya bisa lewat HTTP/3;
- hasil DevTools bisa berbeda antara cold visit dan repeat visit;
- testing harus memperhatikan cache/protocol state browser.

---

## 7. Membaca Network Waterfall Berdasarkan HTTP Version

### 7.1 Kolom Protocol

Di Chrome/Edge DevTools, Anda bisa mengaktifkan kolom `Protocol`.

Nilai yang mungkin terlihat:

```text
http/1.1
h2
h3
```

Jangan hanya melihat status code. Lihat juga:

- protocol;
- connection ID/socket reuse;
- priority;
- timing;
- initiator;
- remote address;
- cache status;
- service worker involvement.

### 7.2 Timing Breakdown

DevTools biasanya menampilkan fase seperti:

```text
Queueing
Stalled
DNS Lookup
Initial connection
SSL
Request sent
Waiting for server response / TTFB
Content Download
```

Interpretasi berbeda per HTTP version.

#### HTTP/1.1

`Queueing/Stalled` bisa berarti:

- browser menunggu connection slot;
- koneksi baru sedang dibuat;
- request antre karena per-origin connection limit;
- proxy/CDN/server lambat menerima.

#### HTTP/2

`Queueing/Stalled` bisa berarti:

- browser scheduler menahan request karena priority;
- stream limit tercapai;
- flow control;
- connection coalescing decision;
- server/CDN processing;
- main thread/renderer scheduling.

#### HTTP/3

`Queueing/Stalled` bisa berarti:

- browser scheduler;
- QUIC connection establishment;
- UDP/path availability;
- fallback attempt;
- server/CDN limit;
- resource priority.

Rule penting:

```text
Waterfall label bukan root cause. Ia gejala yang harus dikaitkan dengan protocol, origin, priority, cache, dan initiator.
```

### 7.3 TTFB Tidak Sama dengan “Backend Lambat”

TTFB dapat mencakup:

- queueing browser;
- DNS;
- connect;
- TLS;
- CDN edge processing;
- origin routing;
- backend processing;
- cache miss;
- network latency;
- proxy buffering.

Untuk API call, TTFB sering lebih dekat ke backend latency, tetapi tetap tidak identik.

Untuk document/static resource, TTFB bisa sangat dipengaruhi CDN/cache/TLS/routing.

Mental model:

```text
TTFB adalah waktu sampai byte response pertama terlihat di browser, bukan murni waktu eksekusi controller backend.
```

---

## 8. Origin Strategy: Satu Origin atau Banyak Origin?

### 8.1 HTTP/1.1 Era

Dulu, banyak origin bisa membantu parallelism:

```text
www.example.com
static1.example.com
static2.example.com
api.example.com
```

Tetapi ini membawa cost:

- DNS tambahan;
- TCP/TLS tambahan;
- cookie/CORS complexity;
- cache partitioning;
- certificate/SAN management;
- operational complexity.

### 8.2 HTTP/2/3 Era

Dengan multiplexing, satu origin yang baik bisa lebih efisien:

```text
https://www.example.com
  /assets/...
  /api/...
```

Namun bukan berarti semua harus satu origin.

Alasan tetap memisahkan origin:

- security boundary;
- cookie isolation;
- CDN/static hosting berbeda;
- API gateway topology;
- compliance/logging boundary;
- blast radius;
- third-party assets;
- regional routing;
- independent scaling.

Keputusan harus berdasarkan trade-off.

### 8.3 Decision Matrix

| Keputusan | Potensi Benefit | Potensi Cost |
|---|---|---|
| Single origin untuk app + API | Hindari CORS, reuse connection, sederhana untuk cookies | Coupling routing/CDN/API, cache policy harus hati-hati |
| App origin + API subdomain | Boundary jelas, API gateway fleksibel | CORS, SameSite/cookie config, extra connection |
| CDN static domain terpisah | Cache/static isolation, cookie-free asset | DNS/TLS extra, connection terpisah |
| Banyak shard static domain | Parallelism HTTP/1.1 | Anti-pattern untuk HTTP/2/3 kecuali terbukti perlu |
| Third-party asset domains | Outsource functionality | Privacy, security, performance, blocking risk |

### 8.4 Cookie-Free Static Domain

Satu alasan valid memisahkan static asset domain:

```text
assets.examplecdn.com
```

Tujuannya:

- tidak mengirim cookie aplikasi untuk asset statis;
- cache policy lebih agresif;
- isolasi security dan bandwidth;
- menghindari header bloat.

Tetapi jika domain static berbeda, perhatikan:

- CORS untuk font;
- CORP/COEP jika cross-origin isolation;
- SRI untuk script/style jika perlu;
- CDN cache invalidation;
- preconnect/preload hints.

---

## 9. Bundling dan Code Splitting di HTTP/1.1 vs HTTP/2/3

### 9.1 Optimasi Lama: Sedikit File Besar

Di HTTP/1.1, banyak request kecil mahal karena:

- connection slot terbatas;
- request antre;
- handshake mahal;
- head-of-line blocking;
- header overhead.

Maka strategi lama:

```text
bundle besar
CSS digabung
JS digabung
sprite image
```

### 9.2 Optimasi Modern: Split dengan Disiplin

Di HTTP/2/3, request kecil lebih murah, tetapi tidak gratis.

Code splitting menjadi lebih masuk akal:

```text
initial route bundle
vendor chunk
feature chunk
lazy route chunk
```

Namun split berlebihan tetap buruk:

- banyak chunk menambah scheduling overhead;
- dependency graph bisa membuat waterfall JS;
- parsing/execution tetap mahal;
- cache invalidation bisa kompleks;
- runtime chunk loading bisa gagal;
- priority tidak selalu sesuai harapan.

Rule praktis:

```text
HTTP/2/3 mengurangi biaya request, tetapi tidak mengurangi biaya dependency graph yang buruk.
```

### 9.3 Chunk Waterfall

Masalah umum di SPA:

```text
HTML -> main.js -> route.js -> component.js -> chart-lib.js -> locale.js
```

Walaupun HTTP/2 multiplexing aktif, browser baru tahu chunk berikutnya setelah JS sebelumnya diunduh dan dieksekusi.

Ini bukan murni masalah HTTP version. Ini masalah discoverability.

Solusi:

- route-level preloading;
- `modulepreload`;
- manifest-aware preload;
- avoid deep dynamic import chains;
- split berdasarkan user journey;
- monitor real waterfall.

### 9.4 Vendor Chunk Trade-Off

Vendor chunk besar:

- cacheable lebih lama jika dependency jarang berubah;
- initial download besar;
- bisa menghambat first render.

Vendor chunk terlalu granular:

- banyak request;
- dependency coordination sulit;
- cache lebih efektif tetapi discovery lebih kompleks.

Decision rule:

```text
Optimalkan berdasarkan route criticality, cache stability, parse cost, dan real user distribution — bukan sekadar jumlah file.
```

---

## 10. API Calls di HTTP/2/3: Parallelism Bukan Gratis

### 10.1 Masalah “Chatty Frontend”

HTTP/2 multiplexing sering membuat tim berpikir:

```text
Banyak API call tidak masalah karena multiplexed.
```

Ini salah.

Banyak API call tetap menambah:

- backend load;
- authorization checks;
- DB queries;
- serialization;
- network overhead;
- error surface;
- consistency complexity;
- UI orchestration complexity;
- tracing/log volume.

### 10.2 Sequential Dependency Tetap Buruk

Contoh buruk:

```text
GET /me
  -> GET /accounts?userId=...
    -> GET /accounts/{id}/permissions
      -> GET /dashboard/widgets?permissions=...
```

HTTP/2/3 tidak menyelesaikan sequential dependency karena request berikutnya memang belum bisa dibuat.

Solusi arsitektural:

- endpoint agregasi;
- BFF;
- server-side composition;
- parallel independent fetch;
- response shape yang cocok untuk screen;
- preload data saat route transition;
- cache client/server.

### 10.3 Parallel API Calls Bisa Menyakiti Backend

Contoh:

```text
on dashboard load:
  GET /profile
  GET /notifications
  GET /tasks
  GET /permissions
  GET /settings
  GET /teams
  GET /metrics
  GET /feature-flags
```

Dari browser tampak parallel.

Dari backend bisa berarti:

```text
8 auth checks
8 gateway routes
8 service calls
30 DB queries
8 log entries
8 trace trees
```

Frontend harus memikirkan backend pressure.

Decision heuristic:

```text
Jika beberapa data selalu dibutuhkan bersama untuk satu screen, pertimbangkan composition endpoint atau BFF.
Jika data independen, cacheable, dan tidak selalu dibutuhkan, split bisa masuk akal.
```

---

## 11. Connection Coalescing

### 11.1 Apa Itu Connection Coalescing?

Di HTTP/2 dan HTTP/3, browser kadang bisa memakai satu koneksi untuk beberapa origin berbeda jika syarat tertentu terpenuhi.

Contoh konseptual:

```text
https://a.example.com
https://b.example.com
```

Jika certificate, DNS/IP, dan aturan keamanan memenuhi syarat, browser mungkin reuse koneksi.

### 11.2 Kenapa Penting?

Karena origin strategy tidak selalu sama dengan connection strategy.

Anda mungkin melihat:

```text
app.example.com
api.example.com
assets.example.com
```

Tetapi browser/CDN mungkin mengoptimalkan beberapa koneksi di bawahnya.

Namun jangan bergantung pada coalescing sebagai requirement correctness.

Coalescing bisa gagal karena:

- certificate tidak mencakup semua hostname;
- DNS/IP berbeda;
- server/CDN config berbeda;
- protocol berbeda;
- privacy/network partitioning;
- browser policy;
- corporate proxy.

Rule:

```text
Connection coalescing adalah optimasi oportunistik, bukan kontrak aplikasi.
```

---

## 12. Prioritas Resource: Browser Scheduler Lebih Penting dari Dugaan

HTTP version memberi kemampuan transport, tetapi browser scheduler menentukan banyak hal:

- HTML document biasanya paling penting;
- CSS render-blocking tinggi;
- parser-blocking script tinggi;
- below-the-fold images rendah;
- async scripts berbeda;
- font bisa critical atau delayed;
- fetch API priority bisa tidak setinggi resource render-critical;
- `preload` bisa menaikkan prioritas;
- `fetchpriority` memberi sinyal eksplisit.

### 12.1 Anti-Pattern: Preload Semua

```html
<link rel="preload" href="/app.js" as="script">
<link rel="preload" href="/chart.js" as="script">
<link rel="preload" href="/admin.js" as="script">
<link rel="preload" href="/below-fold.jpg" as="image">
```

Masalah:

- semua terlihat penting;
- browser kehilangan kemampuan scheduling;
- resource critical bisa berebut bandwidth;
- unused preload menghasilkan warning;
- mobile user makin rugi.

Rule:

```text
Preload hanya resource yang benar-benar critical dan pasti digunakan segera.
```

### 12.2 Anti-Pattern: Mengandalkan HTTP/2 untuk Menebak Prioritas

HTTP/2 multiplexing tidak berarti server/CDN tahu resource mana yang paling penting untuk UX.

Frontend harus membantu browser dengan:

- struktur HTML yang baik;
- CSS critical yang tidak terlalu besar;
- script `defer`/module yang tepat;
- `preload` untuk critical hidden resource;
- `fetchpriority="high"` untuk LCP image jika sesuai;
- `preconnect` untuk origin critical;
- mengurangi third-party blocking.

---

## 13. CDN, Proxy, dan Gateway Reality

HTTP version yang terlihat di browser belum tentu sama sampai origin backend.

Contoh:

```text
Browser -> CDN: HTTP/3
CDN -> Origin: HTTP/2
Origin gateway -> service: HTTP/1.1
Service -> internal service: gRPC/HTTP/2
```

Atau:

```text
Browser -> Load Balancer: HTTP/2
Load Balancer -> Spring Boot app: HTTP/1.1
```

Konsekuensi:

- browser mendapat manfaat HTTP/2/3 di edge;
- origin mungkin tetap HTTP/1.1;
- header bisa dimodifikasi;
- compression bisa dilakukan di CDN;
- cache hit bisa menghindari origin total;
- TTFB bisa dominan di edge/origin tergantung cache;
- logs backend tidak selalu mencerminkan client protocol.

Sebagai Java engineer, ini penting:

```text
Jangan menyimpulkan backend app menerima HTTP/3 hanya karena browser melihat h3. Biasanya HTTP/3 berhenti di CDN/edge/load balancer.
```

### 13.1 Header yang Berguna

Beberapa deployment menambahkan header observability:

```http
Server-Timing: cdn-cache;desc=HIT, edge;dur=12, origin;dur=0
Via: 1.1 proxy
X-Cache: HIT
CF-Cache-Status: HIT
```

Tidak semua header standar, dan tiap CDN berbeda.

Untuk debugging, cari:

- cache status;
- edge location;
- request ID;
- trace ID;
- server timing;
- protocol column;
- response headers yang ditambahkan proxy.

---

## 14. Failure Model per HTTP Version

### 14.1 HTTP/1.1 Failure Profile

Masalah umum:

- connection slot exhaustion;
- stale/reused connection closed by server;
- slow connection blocks resource;
- many small resources causing queueing;
- domain sharding complexity;
- repeated handshakes across origins.

Frontend symptoms:

- `Stalled` tinggi;
- resource waterfall berlapis;
- critical CSS/JS telat;
- many pending requests;
- worse mobile performance.

### 14.2 HTTP/2 Failure Profile

Masalah umum:

- TCP packet loss affects multiplexed streams;
- server/CDN stream limits;
- flow control stalls;
- priority implementation mismatch;
- one busy connection becomes bottleneck;
- long-lived large download competes with critical resources if priority buruk.

Frontend symptoms:

- many requests start together but finish unpredictably;
- content download times odd;
- critical resource delayed despite multiplexing;
- performance differs by CDN/browser.

### 14.3 HTTP/3 Failure Profile

Masalah umum:

- UDP blocked/degraded by some networks;
- fallback to HTTP/2;
- QUIC handshake/path issues;
- higher CPU overhead in some environments;
- debugging harder;
- server/CDN support not uniform;
- some enterprise networks interfere.

Frontend symptoms:

- protocol differs per user/network;
- h3 for some requests, h2 for others;
- cold vs warm behavior different;
- mobile improves for some users but not all;
- fallback behavior visible in timing.

Rule reliability:

```text
A frontend app must be correct under HTTP/1.1, HTTP/2, and HTTP/3. Protocol version may improve performance, not provide business correctness.
```

---

## 15. Practical Frontend Optimization by Protocol

### 15.1 If Users Are Mostly on HTTP/1.1

Prioritize:

- reduce request count;
- bundle critical assets;
- avoid many small chunks;
- use long-lived cache for static assets;
- minimize origins;
- defer non-critical resources;
- compress responses;
- use CDN close to users;
- avoid cookie bloat.

### 15.2 If Users Are Mostly on HTTP/2

Prioritize:

- stop domain sharding unless measured;
- split code by route/user journey;
- avoid deep chunk waterfalls;
- use preload/modulepreload selectively;
- tune cache strategy;
- reduce backend chatty API patterns;
- optimize priority of LCP resources;
- monitor CDN/server HTTP/2 behavior.

### 15.3 If Users Are Mostly on HTTP/3

Prioritize:

- keep HTTP/2 fallback healthy;
- measure real user performance by protocol;
- optimize mobile/high-latency journeys;
- avoid assuming all networks support UDP well;
- use CDN with good QUIC implementation;
- keep asset/cache fundamentals correct;
- observe protocol distribution in RUM if possible.

---

## 16. Measurement: Jangan Berdebat Tanpa Data

### 16.1 Metrics yang Perlu Dipisahkan per Protocol

Jika tooling mendukung, bandingkan:

- protocol: `http/1.1`, `h2`, `h3`;
- TTFB;
- LCP;
- resource load duration;
- connection setup time;
- cache hit/miss;
- effective connection type;
- country/region;
- device class;
- route/page type;
- CDN POP;
- error rate;
- retry rate.

Tanpa segmentasi, kesimpulan bisa salah.

Contoh:

```text
HTTP/3 rata-rata lebih lambat
```

Mungkin karena:

- HTTP/3 hanya aktif di region tertentu;
- user HTTP/3 lebih banyak mobile;
- CDN POP tertentu bermasalah;
- fallback noise;
- cache state berbeda;
- sample size kecil.

### 16.2 Lab vs Field

Lab test:

- reproducible;
- bagus untuk regression;
- bisa mengatur throttling;
- tidak merepresentasikan semua network nyata.

Field/RUM:

- real user condition;
- noisy;
- perlu segmentasi;
- bagus untuk prioritas bisnis.

Gunakan keduanya.

### 16.3 DevTools Experiment Checklist

Saat membandingkan HTTP version:

- clear cache;
- test warm cache;
- disable/enable cache dengan sengaja;
- periksa protocol column;
- periksa service worker;
- periksa CDN cache headers;
- gunakan throttling;
- ulangi beberapa kali;
- bedakan document, static asset, API;
- lihat initiator dan priority;
- export HAR jika perlu.

---

## 17. Java Backend Perspective: Apa yang Perlu Anda Tahu

Sebagai Java engineer, Anda mungkin memakai:

- Spring Boot/Tomcat/Jetty/Netty/Undertow;
- API Gateway;
- Kubernetes Ingress;
- NGINX/Envoy/HAProxy;
- CDN;
- service mesh;
- gRPC internal;
- load balancer cloud.

Frontend HTTP version biasanya dinegosiasikan di edge, bukan langsung di aplikasi Java.

### 17.1 Common Topologies

#### Topology A: CDN Terminates HTTP/3

```text
Browser --h3--> CDN --h2/http1.1--> Origin LB --http1.1--> Java app
```

Java app tidak tahu client memakai HTTP/3 kecuali CDN meneruskan metadata header/log.

#### Topology B: Load Balancer Terminates HTTP/2

```text
Browser --h2--> LB --http1.1--> Spring Boot
```

Java app melihat request biasa HTTP/1.1.

#### Topology C: End-to-End HTTP/2 Internal

```text
Browser --h2--> Gateway --h2/gRPC--> Service
```

Ini lebih umum untuk internal service communication daripada browser-to-app full path.

### 17.2 Backend Settings yang Mempengaruhi Frontend

- TLS config;
- HTTP/2 enablement;
- max concurrent streams;
- header size limit;
- compression;
- keep-alive timeout;
- idle timeout;
- request timeout;
- response buffering;
- streaming support;
- CDN cache config;
- gateway CORS config;
- cookie attributes;
- redirect handling;
- origin shield.

Frontend bug kadang berasal dari config ini.

### 17.3 Contoh Bug

#### Bug: Chunk JS sering gagal di mobile

Kemungkinan:

- CDN cache invalidation buruk;
- old HTML references deleted chunk;
- HTTP/3 fallback issue;
- service worker stale;
- network timeout;
- chunk splitting terlalu granular;
- preload tidak tepat.

#### Bug: API dashboard lambat meski semua request h2

Kemungkinan:

- terlalu banyak API call;
- backend fan-out;
- auth service bottleneck;
- DB N+1;
- gateway rate limiting;
- request sequencing di frontend;
- cache miss;
- large JSON parse cost.

#### Bug: h3 aktif tapi LCP tidak membaik

Kemungkinan:

- LCP image discovered late;
- CSS blocks rendering;
- JS main thread blocking;
- image too large;
- CDN cache miss;
- font layout shift;
- priority salah;
- server TTFB dominan.

---

## 18. Decision Framework: Apa yang Frontend Bisa Kontrol?

### 18.1 Bisa Dikontrol Langsung oleh Frontend

- jumlah resource;
- dependency graph;
- preload/preconnect/modulepreload;
- script loading mode;
- image loading/fetch priority;
- route-level data fetching;
- request parallelism;
- cancellation;
- cache mode untuk fetch dalam batas tertentu;
- service worker strategy;
- bundle splitting;
- avoiding unnecessary custom headers;
- reducing API chatter;
- client-side retry behavior.

### 18.2 Bisa Dipengaruhi melalui Kontrak dengan Backend/Infra

- CDN cache headers;
- HTTP/2/3 enablement;
- compression;
- header size limits;
- API aggregation;
- BFF;
- CORS/cookie config;
- TLS settings;
- `Server-Timing`;
- tracing headers;
- static asset hosting;
- Early Hints;
- gateway timeouts;
- streaming support.

### 18.3 Tidak Bisa Diasumsikan oleh Frontend

- semua user memakai HTTP/3;
- semua network mendukung UDP baik;
- proxy tidak mengubah header;
- priority selalu dihormati;
- CDN cache selalu hit;
- browser scheduling sama antar browser;
- connection coalescing selalu terjadi;
- TTFB murni backend time.

---

## 19. Anti-Patterns dan Koreksinya

### 19.1 “Kita Sudah HTTP/2, Jadi Banyak Request Tidak Masalah”

Salah karena:

- backend tetap terbebani;
- browser tetap menjadwalkan;
- bandwidth tetap terbatas;
- dependency graph bisa waterfall;
- CPU parsing tetap mahal.

Koreksi:

```text
Gunakan HTTP/2/3 untuk mengurangi overhead transport, tetapi tetap desain request graph dan API contract secara sadar.
```

### 19.2 “HTTP/3 Pasti Lebih Cepat”

Salah karena hasil bergantung pada:

- network condition;
- CDN implementation;
- cache hit ratio;
- region;
- device;
- packet loss;
- UDP availability;
- page architecture.

Koreksi:

```text
Treat HTTP/3 as performance opportunity. Validate with RUM and fallback analysis.
```

### 19.3 “Domain Sharding Selalu Meningkatkan Performance”

Salah untuk HTTP/2/3 modern.

Koreksi:

```text
Minimize origins unless ada alasan security/cache/ops yang kuat atau measurement membuktikan benefit.
```

### 19.4 “Bundling Besar Selalu Lebih Baik”

Salah karena:

- user mengunduh kode yang tidak dibutuhkan;
- parse/compile JS mahal;
- cache invalidation lebih buruk;
- route initial load membengkak.

Koreksi:

```text
Split berdasarkan critical path, route, cache stability, dan usage probability.
```

### 19.5 “Split Sekecil Mungkin Selalu Lebih Baik”

Salah karena:

- waterfall discovery;
- overhead request/scheduling;
- runtime complexity;
- chunk failure surface;
- preload complexity.

Koreksi:

```text
Split cukup granular untuk menghindari waste, tapi tidak sampai menciptakan dependency waterfall.
```

---

## 20. Debugging Playbook

### 20.1 Kasus: Banyak Request `Stalled`

Checklist:

1. Protocol apa? `http/1.1`, `h2`, atau `h3`?
2. Apakah banyak origin?
3. Apakah request static asset atau API?
4. Apakah service worker terlibat?
5. Apakah cache disabled?
6. Apakah connection setup muncul berulang?
7. Apakah priority rendah?
8. Apakah request discoverable late?
9. Apakah ada preflight CORS?
10. Apakah CDN/proxy membatasi stream/koneksi?

Kemungkinan per protocol:

```text
HTTP/1.1 -> connection slot / origin sharding / too many resources
HTTP/2   -> scheduler/priority/stream limit/flow control
HTTP/3   -> QUIC setup/fallback/path/scheduler
```

### 20.2 Kasus: HTTP/3 Aktif tapi Masih Lambat

Checklist:

1. Apakah bottleneck di TTFB atau download?
2. Apakah resource critical ditemukan awal?
3. Apakah LCP image preload/fetchpriority benar?
4. Apakah CSS blocking terlalu besar?
5. Apakah JS main thread blocking?
6. Apakah CDN cache HIT?
7. Apakah API sequential?
8. Apakah payload JSON besar?
9. Apakah compression aktif?
10. Apakah user segment mobile/high latency?

### 20.3 Kasus: HTTP/2 tapi Waterfall Tetap Sequential

Mungkin penyebab:

- resource ditemukan terlambat;
- JS dynamic import chain;
- API call dependency chain;
- CSS imports chained;
- third-party script injects resource late;
- browser priority menunda low-priority resource;
- server sends late due to backend.

HTTP/2 tidak bisa mengirim request yang belum ditemukan browser.

### 20.4 Kasus: Prod Berbeda dari Local

Local mungkin:

- HTTP/1.1;
- no CDN;
- no TLS or self-signed TLS;
- no compression;
- no real latency;
- no cache layer;
- no gateway;
- no HTTP/2/3;
- different CORS/cookie domain.

Prod mungkin:

- HTTP/2/3 at edge;
- CDN cache;
- TLS termination;
- reverse proxy buffering;
- stricter header limits;
- different cookie domain;
- WAF/security rules;
- compression at edge.

Rule:

```text
Local success is not proof that browser-edge-origin behavior is correct.
```

---

## 21. Hands-On Lab

### Lab 1 — Lihat Protocol di DevTools

1. Buka DevTools → Network.
2. Klik kanan header table.
3. Aktifkan kolom `Protocol`.
4. Reload halaman.
5. Catat resource mana yang `h2`, `h3`, atau `http/1.1`.
6. Bandingkan document, JS, CSS, image, font, API.

Pertanyaan:

- Apakah semua resource memakai protocol yang sama?
- Apakah third-party resource berbeda?
- Apakah API domain berbeda dari static asset domain?
- Apakah request pertama berbeda dari reload kedua?

### Lab 2 — Bandingkan Cold dan Warm Load

1. Clear cache.
2. Reload dan simpan screenshot waterfall.
3. Reload lagi tanpa clear cache.
4. Bandingkan:
   - protocol;
   - connection setup;
   - cache hit;
   - TTFB;
   - content download;
   - resource order.

Insight yang dicari:

```text
Performance bukan hanya protocol. Cache sering lebih menentukan daripada HTTP version.
```

### Lab 3 — Simulasikan Chunk Waterfall

Buat app kecil dengan dynamic import bertingkat:

```js
import("./route.js").then(() => {
  import("./chart.js").then(() => {
    import("./locale.js");
  });
});
```

Amati waterfall.

Lalu ubah agar dependency yang pasti dibutuhkan dapat ditemukan lebih awal.

Pelajaran:

```text
HTTP/2/3 tidak menghapus waterfall yang diciptakan oleh dependency discovery terlambat.
```

### Lab 4 — Banyak API Calls vs Aggregated API

Buat dua mode dashboard:

```text
Mode A:
GET /profile
GET /permissions
GET /notifications
GET /widgets
GET /settings

Mode B:
GET /dashboard-bootstrap
```

Bandingkan:

- total request count;
- TTFB;
- total time to usable UI;
- backend trace fan-out;
- error handling complexity;
- cacheability;
- partial loading UX.

Kesimpulan tidak selalu Mode B menang. Tetapi Anda akan melihat trade-off nyata.

---

## 22. Review Checklist untuk Design/PR

Gunakan checklist ini saat review frontend performance atau API integration.

### Protocol & Origin

- [ ] Apakah resource utama memakai HTTP/2/3 di production?
- [ ] Apakah ada origin terlalu banyak?
- [ ] Apakah domain sharding masih digunakan tanpa alasan modern?
- [ ] Apakah static asset domain bebas cookie?
- [ ] Apakah API subdomain menambah CORS/cookie complexity yang perlu?

### Resource Graph

- [ ] Apakah critical resource ditemukan awal?
- [ ] Apakah ada chunk waterfall?
- [ ] Apakah `preload` digunakan hanya untuk resource critical?
- [ ] Apakah LCP resource diberi prioritas tepat?
- [ ] Apakah third-party script mengganggu critical path?

### API Graph

- [ ] Apakah API calls parallel atau sequential?
- [ ] Apakah ada data yang selalu dibutuhkan bersama?
- [ ] Apakah BFF/composition endpoint lebih tepat?
- [ ] Apakah request count membebani backend?
- [ ] Apakah payload terlalu besar?

### Cache & CDN

- [ ] Apakah static asset fingerprinted dan immutable?
- [ ] Apakah HTML tidak di-cache terlalu agresif?
- [ ] Apakah CDN cache hit terlihat?
- [ ] Apakah `Vary` tidak menyebabkan variant explosion?
- [ ] Apakah cookie/header bloat mengurangi efisiensi?

### Reliability

- [ ] Apakah app benar jika protocol fallback ke HTTP/1.1?
- [ ] Apakah retry aman?
- [ ] Apakah long request bisa di-cancel?
- [ ] Apakah mobile network switching dipertimbangkan?
- [ ] Apakah RUM memisahkan data berdasarkan protocol/network?

---

## 23. Mental Model Final

Simpan model ini:

```text
HTTP semantics = meaning
HTTP version   = delivery mechanics
Browser        = scheduler + policy engine + cache + security boundary
CDN/proxy      = protocol terminator + cache + transformer + router
Frontend perf  = resource graph + cache + priority + latency + backend contract
```

HTTP/1.1, HTTP/2, HTTP/3 bukan sekadar label teknis. Mereka mengubah bagaimana browser mengatur banyak request dalam realitas jaringan.

Tetapi versi HTTP bukan silver bullet.

Masalah terbesar frontend sering berasal dari:

- resource ditemukan terlambat;
- terlalu banyak origin;
- caching salah;
- API terlalu chatty;
- dependency graph buruk;
- payload terlalu besar;
- priority salah;
- backend fan-out;
- third-party blocking;
- observability kurang.

HTTP/2/3 membuat platform lebih kuat, tetapi desain aplikasi tetap menentukan hasil.

---

## 24. Ringkasan Eksekutif

- HTTP semantics modern relatif stabil lintas HTTP/1.1, HTTP/2, dan HTTP/3.
- HTTP/1.1 terbatas oleh connection concurrency dan head-of-line blocking pada pola request/response.
- HTTP/2 menambahkan multiplexing di atas TCP, binary framing, dan HPACK; ini mengurangi overhead banyak request, tetapi TCP-level HoL masih ada.
- HTTP/3 memakai QUIC di atas UDP, mengintegrasikan TLS 1.3, dan mengurangi transport-level HoL antar-stream.
- HTTP/3 tidak otomatis membuat semua halaman cepat.
- Domain sharding adalah optimasi lama yang sering menjadi anti-pattern di HTTP/2/3.
- Code splitting harus didesain berdasarkan critical path dan dependency discovery, bukan dogma “sedikit file” atau “banyak file”.
- Banyak API call tetap mahal walaupun multiplexed.
- Browser DevTools harus dibaca bersama kolom Protocol, Timing, Priority, Initiator, Cache, dan Service Worker.
- CDN/proxy sering terminate protocol; backend Java belum tentu melihat protocol yang sama dengan browser.
- Correctness aplikasi tidak boleh bergantung pada HTTP/3; performance boleh mengambil manfaat jika tersedia.

---

## 25. Referensi Utama

- RFC 9110 — HTTP Semantics.
- RFC 9112 — HTTP/1.1.
- RFC 9113 — HTTP/2.
- RFC 9114 — HTTP/3.
- RFC 9000 — QUIC: A UDP-Based Multiplexed and Secure Transport.
- RFC 9204 — QPACK: Field Compression for HTTP/3.
- MDN — HTTP/3 glossary and HTTP guides.
- MDN — Resource Timing API.
- web.dev — Resource hints and Fetch Priority.
- Chrome DevTools documentation — Network panel and timing analysis.

---

## 26. Apa yang Dilanjutkan di Part 020

Part berikutnya:

```text
learn-http-for-web-frontend-perspective-part-020.md
```

Topik:

```text
TLS, HTTPS, Certificates, Mixed Content, and Secure Contexts
```

Kita akan masuk lebih dalam ke HTTPS dari sudut browser:

- TLS handshake;
- certificate chain;
- CA trust;
- SNI;
- ALPN;
- HSTS;
- mixed content;
- secure contexts;
- local development HTTPS;
- self-signed certificate;
- corporate MITM proxy;
- cookie `Secure`;
- debugging TLS error.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-frontend-perspective-part-018.md">⬅️ Part 018 — Resource Loading: HTML Parser, Preload Scanner, Priority, and Waterfall</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-frontend-perspective-part-020.md">Part 020 — TLS, HTTPS, Certificates, Mixed Content, and Secure Contexts ➡️</a>
</div>
