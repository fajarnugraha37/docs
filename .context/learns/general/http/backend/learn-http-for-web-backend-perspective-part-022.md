# learn-http-for-web-backend-perspective-part-022.md

# Part 022 — HTTP/1.1, HTTP/2, HTTP/3 for Backend Engineers

> Seri: `learn-http-for-web-backend-perspective`  
> Part: `022 / 032`  
> Topik: HTTP protocol versions dari perspektif backend production  
> Target pembaca: Java backend engineer yang ingin memahami implikasi HTTP/1.1, HTTP/2, dan HTTP/3 terhadap correctness, reliability, performance, observability, dan deployment architecture.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas body, framing, streaming, timeout, upload/download, SSE, long polling, dan async response. Sekarang kita masuk ke pertanyaan yang sering terlihat sederhana tetapi efek production-nya besar:

> “Service kita pakai HTTP/1.1, HTTP/2, atau HTTP/3?”

Jawaban yang matang bukan:

> “HTTP/2 lebih baru, HTTP/3 paling baru, jadi pakai yang paling baru.”

Jawaban backend yang benar harus mempertimbangkan:

1. **Semantics HTTP tetap sama** di HTTP/1.1, HTTP/2, dan HTTP/3.
2. Yang berubah terutama adalah **wire format, transport behavior, multiplexing, compression, connection lifecycle, flow control, dan operational failure mode**.
3. Backend application sering tidak langsung berhadapan dengan protocol version asli client karena ada CDN, reverse proxy, load balancer, API gateway, atau service mesh di depan.
4. Protocol version memengaruhi latency, throughput, connection count, timeout behavior, head-of-line blocking, proxy buffering, observability, dan attack surface.
5. Untuk Java backend, pilihan stack Servlet/Spring MVC/WebFlux/Reactor Netty/Tomcat/Jetty/Undertow/client library punya implikasi berbeda.

Part ini bertujuan membuat kamu bisa:

- membedakan HTTP semantics dan wire protocol;
- memahami HTTP/1.1 persistent connection dan batasannya;
- memahami HTTP/2 streams, multiplexing, HPACK, flow control;
- memahami HTTP/3 over QUIC, UDP, TLS 1.3, dan stream-level loss handling;
- membaca arsitektur edge-to-service secara benar;
- men-debug masalah `502`, `503`, `504`, reset stream, connection exhaustion, dan timeout mismatch;
- memilih deployment strategy yang realistis untuk Java backend production.

---

## 1. Mental Model Utama: Semantics vs Wire Protocol

HTTP punya dua level yang harus dipisahkan.

### 1.1 Semantics Layer

Semantics adalah makna yang sudah kita pelajari di part sebelumnya:

- method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, dan seterusnya;
- status code: `200`, `201`, `202`, `204`, `304`, `400`, `401`, `403`, `404`, `409`, `412`, `429`, `500`, `503`, `504`;
- headers: `Content-Type`, `Accept`, `Cache-Control`, `ETag`, `Authorization`, `Retry-After`, dan lain-lain;
- representation;
- caching;
- conditional request;
- authentication;
- negotiation;
- error contract.

Semantics menjawab:

> “Apa arti request dan response ini?”

Contoh:

```http
PUT /cases/C-2026-001 HTTP/1.1
Content-Type: application/json
If-Match: "case-v7"

{"status":"UNDER_REVIEW"}
```

Maknanya:

- client ingin mengganti representation resource case;
- request memiliki precondition `If-Match`;
- server harus menolak jika version mismatch;
- jika berhasil, operasi idempotent pada level method;
- jika gagal karena precondition, response bisa `412 Precondition Failed`.

Makna ini tidak berubah hanya karena wire protocol-nya HTTP/2 atau HTTP/3.

### 1.2 Wire Protocol Layer

Wire protocol menjawab:

> “Bagaimana bytes dikirim melalui network?”

Yang berubah antar-versi:

| Area | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport umum | TCP | TCP | QUIC over UDP |
| TLS | sering TLS di `https` | biasanya TLS di browser | TLS 1.3 terintegrasi QUIC |
| Message format | textual | binary frames | binary frames over QUIC |
| Parallelism | banyak koneksi atau pipelining terbatas | multiplexed streams per connection | multiplexed streams per QUIC connection |
| Header compression | tidak ada built-in modern | HPACK | QPACK |
| HOL blocking | per TCP connection | TCP-level HOL masih ada | dikurangi pada transport stream level |
| Flow control | TCP-level | stream + connection flow control | QUIC stream + connection flow control |
| Backend visibility | jelas di logs/proxy | perlu stream-level observability | sering terminated di edge |

### 1.3 Prinsip Penting

> HTTP version biasanya bukan keputusan controller. HTTP version adalah keputusan edge, server runtime, client library, TLS/ALPN, proxy, dan network path.

Controller Spring kamu biasanya tetap menulis:

```java
@GetMapping("/cases/{id}")
public CaseResponse getCase(@PathVariable String id) {
    return service.getCase(id);
}
```

Tetapi behavior production bisa berbeda jika:

- request datang lewat HTTP/2 multiplexing;
- gateway downgrade ke HTTP/1.1 ke service;
- upstream memakai connection pool HTTP/1.1;
- response streaming dibuffer proxy;
- HTTP/2 stream di-reset;
- HTTP/3 hanya sampai CDN, lalu origin tetap HTTP/1.1.

---

## 2. Evolusi Singkat dari Perspektif Backend

Kita tidak perlu menghafal sejarah, tetapi perlu memahami masalah yang diselesaikan tiap versi.

### 2.1 HTTP/1.0 dan Masalah Connection per Request

HTTP awal cenderung memakai koneksi pendek:

1. buka TCP connection;
2. kirim request;
3. terima response;
4. tutup connection.

Masalah:

- TCP handshake mahal;
- TLS handshake lebih mahal;
- banyak request kecil menjadi mahal;
- server harus menangani banyak connection churn;
- latency tinggi untuk halaman/API dengan banyak request.

### 2.2 HTTP/1.1: Persistent Connection

HTTP/1.1 memperbaiki banyak hal dengan persistent connection.

Satu TCP connection dapat dipakai untuk beberapa request-response secara berurutan.

Keuntungan:

- mengurangi biaya connection setup;
- TLS session reuse lebih efisien;
- connection pooling menjadi sangat penting;
- client dan server dapat reuse koneksi.

Masalah tetap:

- request-response pada satu connection umumnya berurutan;
- pipelining ada secara teori, tetapi jarang dipakai luas karena head-of-line blocking dan compatibility;
- untuk parallelism, client membuka banyak koneksi;
- banyak koneksi berarti lebih banyak file descriptor, memory, TLS state, dan scheduling overhead.

### 2.3 HTTP/2: Multiplexing di Atas Satu TCP Connection

HTTP/2 mengubah format menjadi binary framing dan memungkinkan beberapa stream berjalan bersamaan di satu TCP connection.

Keuntungan:

- banyak request parallel di satu connection;
- header compression dengan HPACK;
- prioritas stream secara desain, walau implementasi/praktik bervariasi;
- lebih efisien untuk banyak request kecil;
- cocok untuk browser dan gRPC.

Masalah:

- tetap berada di atas TCP;
- packet loss pada TCP connection dapat memblokir semua stream pada connection tersebut di level transport;
- flow control lebih kompleks;
- satu connection yang membawa banyak stream dapat menjadi single hot connection;
- debugging lebih rumit;
- proxy/gateway behavior menjadi sangat penting.

### 2.4 HTTP/3: HTTP Semantics di Atas QUIC

HTTP/3 memetakan HTTP semantics ke QUIC.

QUIC berjalan di atas UDP, memakai TLS 1.3 secara integral, dan menyediakan stream multiplexing di transport layer.

Keuntungan:

- connection establishment lebih cepat dalam banyak skenario;
- mengurangi transport-level head-of-line blocking antar-stream;
- connection migration lebih baik, misalnya jaringan mobile berpindah IP;
- TLS 1.3 built-in;
- stream independent loss handling.

Masalah:

- operasi UDP bisa dipengaruhi firewall/NAT/middlebox;
- observability jaringan berbeda dari TCP;
- load balancer dan proxy support tidak selalu sama;
- backend origin sering tetap HTTP/1.1 atau HTTP/2;
- Java server support untuk HTTP/3 masih lebih jarang dibanding HTTP/1.1/2;
- debugging membutuhkan tooling yang lebih matang.

---

## 3. HTTP/1.1 Deep Dive untuk Backend Engineer

HTTP/1.1 sering dianggap “legacy”, padahal mayoritas backend-to-backend traffic masih banyak yang memakai pola HTTP/1.1, terutama di internal services, load balancer to origin, health check, dan Java clients.

### 3.1 Textual Message Format

HTTP/1.1 request secara kasar:

```http
GET /cases/C-2026-001 HTTP/1.1
Host: api.example.com
Accept: application/json
Authorization: Bearer <token>

```

Response:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 42

{"id":"C-2026-001","status":"OPEN"}
```

Ini relatif mudah dibaca manusia, mudah dites dengan `telnet`, `nc`, `curl -v`, dan proxy logs.

Tetapi textual format punya konsekuensi:

- parser harus menangani whitespace, line endings, header folding legacy behavior, invalid bytes;
- request smuggling bisa muncul dari perbedaan parser antar-proxy dan origin;
- `Content-Length` vs `Transfer-Encoding` ambiguity harus ditangani tegas;
- header size limit penting.

### 3.2 Persistent Connection

HTTP/1.1 default-nya persistent kecuali `Connection: close`.

Client bisa:

1. membuka TCP/TLS connection;
2. kirim request A;
3. baca response A;
4. kirim request B di connection yang sama;
5. ulangi sampai idle timeout atau close.

Backend implication:

- server perlu `keep-alive timeout`;
- terlalu pendek: connection churn tinggi;
- terlalu panjang: file descriptor dan memory tertahan;
- client pool harus selaras dengan server idle timeout;
- stale pooled connection bisa menyebabkan intermittent reset.

### 3.3 Connection Pooling

HTTP/1.1 parallelism biasanya butuh banyak connection.

Backend-to-backend Java client harus mengatur:

- max total connections;
- max per route/host;
- connection acquisition timeout;
- connect timeout;
- read/response timeout;
- idle eviction;
- TLS handshake timeout;
- DNS refresh behavior.

Anti-pattern:

```java
// Anti-pattern: membuat client baru per request
HttpClient client = HttpClient.newHttpClient();
```

Lebih baik:

```java
// Sederhana, reusable, thread-safe Java HttpClient
static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2))
        .version(HttpClient.Version.HTTP_1_1)
        .build();
```

Pada production, biasanya perlu client wrapper yang mengatur timeout, tracing, retry, auth, metrics, dan error mapping.

### 3.4 Head-of-Line Blocking di HTTP/1.1

Dalam satu connection HTTP/1.1, response untuk request berikutnya tidak bisa efektif melompati response request sebelumnya.

Contoh:

- request A lambat;
- request B cepat;
- jika B berada di belakang A pada connection yang sama, B ikut tertahan.

Karena itu client membuka beberapa connection.

Trade-off:

- lebih banyak connection meningkatkan parallelism;
- tetapi menambah overhead server, TLS, file descriptor, dan load balancer state.

### 3.5 Pipelining: Ada, Tetapi Jarang Menjadi Solusi

HTTP/1.1 pipelining memungkinkan client mengirim beberapa request tanpa menunggu response sebelumnya.

Namun response tetap harus kembali berurutan. Jika response pertama lambat, response berikutnya tertahan. Banyak proxy/server/client juga historically tidak robust terhadap pipelining.

Dalam praktik modern, HTTP/2 multiplexing jauh lebih relevan daripada HTTP/1.1 pipelining.

### 3.6 Chunked Transfer Encoding

HTTP/1.1 mendukung:

```http
Transfer-Encoding: chunked
```

Ini memungkinkan response atau request body dikirim bertahap tanpa mengetahui `Content-Length` di awal.

Backend implications:

- cocok untuk streaming response;
- proxy bisa buffering dan merusak streaming behavior;
- request smuggling risk jika `Transfer-Encoding` dan `Content-Length` diproses tidak konsisten;
- body size limit tetap harus diterapkan meskipun chunked;
- logging full body streaming bisa berbahaya.

### 3.7 HTTP/1.1 Production Failure Modes

| Failure | Penyebab umum | Gejala | Mitigasi |
|---|---|---|---|
| Connection exhaustion | pool terlalu kecil/besar, idle leak | latency naik, timeout acquisition | pool sizing, idle eviction |
| Stale connection | server close idle connection, client reuse | intermittent reset | validate/evict idle connection |
| Slowloris | client kirim header/body lambat | thread/connection tertahan | header/body timeout, size limit |
| Request smuggling | parser mismatch proxy-origin | request salah route/user | strict parsing, reject ambiguity |
| Queue collapse | terlalu banyak request menunggu thread | p99 meledak | load shedding, concurrency limit |
| HOL blocking | request lambat di connection | tail latency | pool tuning, HTTP/2 untuk parallelism |

---

## 4. HTTP/2 Deep Dive untuk Backend Engineer

HTTP/2 mempertahankan semantics HTTP tetapi mengubah wire format menjadi binary frames dan multiplexed streams.

### 4.1 Binary Framing

HTTP/2 tidak mengirim message sebagai teks seperti HTTP/1.1. Ia memecah komunikasi menjadi frames.

Konsep penting:

- **connection**: satu TCP connection antara client dan server;
- **stream**: bidirectional flow untuk satu request-response;
- **frame**: unit data di dalam stream;
- **headers frame**: membawa headers;
- **data frame**: membawa body;
- **settings frame**: konfigurasi connection;
- **window update frame**: flow control;
- **reset stream**: membatalkan stream.

### 4.2 Multiplexing

HTTP/2 memungkinkan banyak stream aktif bersamaan dalam satu TCP connection.

Contoh:

```text
TCP connection #1
  stream 1: GET /cases/C-1
  stream 3: GET /cases/C-2
  stream 5: POST /exports
  stream 7: GET /users/me
```

Response stream bisa interleaved.

Keuntungan:

- mengurangi kebutuhan banyak connection;
- parallelism lebih efisien;
- mengurangi handshake overhead;
- cocok untuk banyak request kecil;
- penting untuk gRPC.

### 4.3 HTTP/2 Pseudo-Headers

HTTP/2 mengganti request line HTTP/1.1 dengan pseudo-headers:

```text
:method = GET
:scheme = https
:authority = api.example.com
:path = /cases/C-2026-001
accept = application/json
authorization = Bearer <token>
```

Backend biasanya melihatnya sudah diterjemahkan oleh server/framework menjadi request abstraction biasa.

Tetapi gateway/proxy harus menjaga mapping:

- `:authority` kira-kira setara dengan `Host`;
- `:scheme` penting untuk absolute URL generation;
- `:path` harus dinormalisasi secara aman;
- header rules lebih ketat daripada HTTP/1.1.

### 4.4 HPACK Header Compression

HTTP/2 memakai HPACK untuk mengompresi headers.

Kenapa penting?

Banyak request API membawa headers berulang:

- `Authorization`;
- `Cookie`;
- `Accept`;
- tracing headers;
- custom tenant headers;
- user-agent.

Header compression mengurangi overhead, tetapi membawa konsekuensi:

- dynamic table state per connection;
- memory usage;
- potential compression-related attack considerations;
- header bloat tetap tidak gratis;
- jangan menjadikan header sebagai tempat payload besar.

### 4.5 Flow Control

HTTP/2 punya flow control pada level:

- connection;
- stream.

Tujuannya agar penerima tidak dibanjiri data lebih cepat dari kemampuan memproses.

Backend implications:

- slow consumer dapat menahan flow;
- streaming response harus menghormati backpressure;
- satu stream besar bisa memengaruhi connection window;
- konfigurasi window size bisa memengaruhi throughput;
- observability harus bisa melihat stream reset dan flow-control stalls.

### 4.6 Stream Reset dan Cancellation

HTTP/2 memungkinkan stream di-reset.

Penyebab:

- client cancel request;
- browser navigasi pindah halaman;
- deadline habis;
- server menolak request;
- proxy timeout;
- flow-control/stream error;
- max concurrent streams tercapai.

Backend harus memahami bahwa:

> Reset stream bukan selalu error aplikasi. Kadang itu cancellation normal.

Namun jika server tidak menghentikan work saat stream cancelled, resource tetap terbuang.

Pada WebFlux, cancellation bisa dipropagasi melalui reactive stream. Pada blocking MVC, cancellation sering lebih sulit menghentikan operasi yang sudah berjalan, terutama query DB/blocking HTTP downstream.

### 4.7 Max Concurrent Streams

HTTP/2 server dapat membatasi jumlah stream paralel per connection.

Jika terlalu rendah:

- client perlu lebih banyak connection;
- latency bisa naik.

Jika terlalu tinggi:

- satu connection bisa membanjiri server;
- fairness antar-client buruk;
- memory pressure meningkat;
- downstream pool bisa jebol.

Backend harus mengaitkan:

- max concurrent streams;
- app concurrency limit;
- thread pool;
- DB pool;
- outbound HTTP pool;
- rate limiting;
- tenant fairness.

### 4.8 HTTP/2 and gRPC

gRPC umumnya berjalan di atas HTTP/2.

Implikasi:

- stream adalah konsep first-class;
- satu connection bisa membawa banyak RPC;
- deadline propagation penting;
- status gRPC tidak sama persis dengan HTTP status;
- load balancing per connection bisa bermasalah jika connection terlalu sticky;
- service mesh sering ikut mengelola HTTP/2/gRPC.

Untuk backend Java, gRPC sering memakai Netty. Spring MVC biasa tidak menjadi gRPC server native, walau bisa hidup berdampingan dalam arsitektur.

### 4.9 HTTP/2 Production Failure Modes

| Failure | Penyebab umum | Gejala | Mitigasi |
|---|---|---|---|
| Single hot connection | banyak stream dari satu client/proxy | uneven load | connection balancing, stream limit |
| TCP HOL blocking | packet loss pada TCP | semua stream terdampak | HTTP/3 di edge, multiple connections |
| Flow-control stall | receiver lambat/window kecil | streaming macet | tune window, backpressure |
| Stream reset storm | client timeout/gateway reset | banyak cancelled spans | align timeout, cancellation handling |
| Header compression pressure | header besar/berulang | memory/CPU tinggi | header limits, avoid bloat |
| gRPC LB issue | long-lived connection | traffic tidak merata | xDS/service mesh/client LB |

---

## 5. HTTP/3 Deep Dive untuk Backend Engineer

HTTP/3 adalah HTTP semantics di atas QUIC, bukan sekadar “HTTP/2 lebih cepat”.

### 5.1 QUIC Mental Model

QUIC menyediakan:

- transport di atas UDP;
- reliability;
- congestion control;
- multiplexed streams;
- TLS 1.3 integrated;
- connection IDs;
- connection migration;
- stream-level loss handling.

HTTP/3 menggunakan QUIC streams untuk membawa request/response.

### 5.2 Kenapa UDP?

Bukan karena HTTP/3 ingin “unreliable”. QUIC membangun reliability sendiri di atas UDP.

Alasannya:

- bisa menghindari keterbatasan evolusi TCP di middlebox;
- TLS 1.3 bisa diintegrasikan ke handshake;
- stream multiplexing bisa ditangani di transport layer;
- connection migration lebih mudah;
- loss pada satu stream tidak harus memblokir semua stream lain seperti TCP-level HOL.

### 5.3 HTTP/3 Mengurangi Transport Head-of-Line Blocking

Di HTTP/2, semua stream berada di satu TCP connection. Jika ada packet loss, TCP harus recover urutan bytes. Seluruh connection dapat tertahan.

Di HTTP/3, QUIC tahu stream mana yang kehilangan data. Stream lain dapat terus berjalan.

Tetapi hati-hati:

> HTTP/3 tidak menghapus semua bentuk head-of-line blocking.

Masih ada blocking di:

- application queue;
- thread pool;
- DB pool;
- per-tenant rate limit;
- proxy buffer;
- response serialization;
- client rendering;
- shared downstream dependency;
- compression dependency dalam kondisi tertentu.

### 5.4 QPACK Header Compression

HTTP/3 memakai QPACK, bukan HPACK.

QPACK didesain untuk header compression yang cocok dengan QUIC multiplexing, mengurangi risiko blocking akibat dynamic table dependency.

Backend takeaway:

- header compression tetap ada;
- header bloat tetap buruk;
- custom headers harus dikontrol;
- observability/security headers jangan membesar tanpa batas;
- dynamic table memory tetap menjadi operational concern di proxy/server.

### 5.5 Connection Migration

QUIC connection dapat bertahan saat network path berubah, misalnya:

- mobile user pindah dari Wi-Fi ke cellular;
- NAT rebinding;
- IP berubah.

Ini lebih relevan untuk browser/mobile client ke edge/CDN daripada internal backend-to-backend.

Backend origin sering tidak melihat HTTP/3 langsung karena:

```text
Browser/mobile --HTTP/3--> CDN/edge --HTTP/2 or HTTP/1.1--> origin backend
```

### 5.6 HTTP/3 Deployment Reality

Dalam banyak organisasi:

- HTTP/3 aktif di CDN atau edge load balancer;
- edge ke gateway memakai HTTP/2 atau HTTP/1.1;
- gateway ke service memakai HTTP/1.1 atau HTTP/2;
- service-to-service memakai HTTP/1.1, HTTP/2, or gRPC;
- Java application jarang langsung expose HTTP/3 ke internet.

Jadi pertanyaan production bukan hanya:

> “Apakah app support HTTP/3?”

Tetapi:

> “Di hop mana HTTP/3 terminated, dan apa konsekuensi downgrade/translation-nya?”

### 5.7 HTTP/3 Production Failure Modes

| Failure | Penyebab umum | Gejala | Mitigasi |
|---|---|---|---|
| UDP blocked/degraded | firewall/NAT/middlebox | fallback ke HTTP/2 | graceful fallback, monitor version |
| Edge-origin mismatch | H3 only at edge | origin tetap bottleneck | observe per-hop protocol |
| Debugging gap | tooling TCP-centric | sulit trace packet | edge logs, QUIC-aware tooling |
| Load balancer support gap | infra belum matang | inconsistent behavior | staged rollout |
| Amplification/DoS concern | UDP-based protocol | edge pressure | rate limit, anti-amplification controls |
| Misleading performance expectation | app bottleneck bukan transport | tidak ada improvement | profile bottleneck end-to-end |

---

## 6. ALPN, TLS, and Protocol Negotiation

### 6.1 ALPN Mental Model

ALPN atau Application-Layer Protocol Negotiation memungkinkan client dan server menyepakati protocol saat TLS handshake.

Contoh hasil negotiation:

- `http/1.1`;
- `h2`;
- `h3` pada konteks QUIC/TLS 1.3.

Backend implication:

- protocol version tidak selalu dipilih oleh aplikasi;
- TLS termination point menentukan protocol yang terlihat oleh backend;
- kalau TLS terminate di load balancer, app mungkin hanya melihat HTTP/1.1 upstream;
- observability harus mencatat protocol di edge dan origin.

### 6.2 TLS Termination Patterns

#### Pattern A — TLS terminate di application

```text
Client --TLS/HTTP/2--> Java app
```

Keuntungan:

- app melihat protocol asli;
- end-to-end encryption langsung ke app;
- fewer translation surprises.

Kerugian:

- app harus mengelola cert/TLS config;
- scaling dan rotation lebih kompleks;
- security boundary tersebar.

#### Pattern B — TLS terminate di load balancer/gateway

```text
Client --TLS/HTTP/2--> LB/Gateway --HTTP/1.1--> Java app
```

Keuntungan:

- TLS centralized;
- cert rotation lebih mudah;
- WAF/rate limit/auth di edge;
- app lebih sederhana.

Kerugian:

- app tidak melihat protocol asli;
- perlu trusted forwarding headers;
- scheme/host/client IP bisa salah jika tidak dikonfigurasi;
- streaming/cancellation behavior bisa berubah.

#### Pattern C — TLS terminate di edge, re-encrypt ke service

```text
Client --TLS/H3--> CDN --TLS/H2--> Gateway --mTLS/H2--> Service
```

Keuntungan:

- strong internal security;
- service identity;
- modern per-hop protocol;
- cocok untuk zero-trust/service mesh.

Kerugian:

- operational complexity tinggi;
- debugging multi-hop lebih sulit;
- timeout/flow-control per hop harus selaras.

---

## 7. Per-Hop Protocol Translation

Satu request bisa melewati banyak versi HTTP.

Contoh:

```text
Browser
  -- HTTP/3 over QUIC -->
CDN
  -- HTTP/2 over TLS -->
API Gateway
  -- HTTP/1.1 -->
Spring Boot Service
  -- HTTP/1.1 -->
Downstream Service
```

Dari sisi user, request “pakai HTTP/3”. Dari sisi Spring Boot service, request “pakai HTTP/1.1”.

### 7.1 Apa yang Bisa Berubah di Translation?

- header normalization;
- `Host` / `:authority`;
- scheme detection;
- client IP;
- connection lifecycle;
- streaming vs buffering;
- timeout;
- retry behavior;
- compression;
- trailer support;
- request body size handling;
- error status generated by proxy;
- cancellation signal;
- trace propagation.

### 7.2 Backend Rule

> Jangan mendesain correctness berdasarkan asumsi protocol version client kalau service kamu hanya melihat hop terakhir.

Contoh:

- Jangan menganggap client disconnect selalu sampai ke controller.
- Jangan menganggap streaming response benar-benar streaming sampai browser.
- Jangan menganggap HTTP/2 multiplexing di client berarti service tidak butuh concurrency limit.
- Jangan menganggap HTTP/3 menghilangkan timeout problem di origin.

---

## 8. Load Balancing Implications

### 8.1 HTTP/1.1 Load Balancing

Dengan banyak connection, load balancer biasanya bisa menyebar connection ke banyak backend.

Namun jika client pool reuse connection terlalu kuat, traffic bisa sticky ke beberapa instance.

Faktor:

- connection lifetime;
- keep-alive timeout;
- DNS load balancing;
- LB algorithm;
- max connection per host;
- client-side pooling.

### 8.2 HTTP/2 Load Balancing

HTTP/2 membawa banyak stream di satu connection.

Masalah:

```text
Client/Gateway membuka 1 HTTP/2 connection ke Service A
Semua stream lewat Service A
Service B/C/D idle
```

Ini bisa terjadi pada service-to-service atau gRPC jika load balancing tidak aware stream/request.

Mitigasi:

- client-side load balancing;
- multiple HTTP/2 connections;
- connection draining;
- max connection age;
- service mesh;
- LB yang memahami HTTP/2;
- tune max concurrent streams.

### 8.3 HTTP/3 Load Balancing

QUIC memakai UDP dan connection ID. Load balancer harus bisa menjaga packet untuk connection yang sama ke backend/edge worker yang tepat.

Di banyak deployment, HTTP/3 berhenti di edge/CDN, sehingga app origin tidak perlu langsung memikul QUIC LB.

---

## 9. Timeout Implications by Version

### 9.1 HTTP/1.1 Timeout

Timeout umum:

- connection timeout;
- TLS handshake timeout;
- request header timeout;
- request body timeout;
- idle connection timeout;
- response timeout;
- keep-alive timeout.

HTTP/1.1 sering gagal karena stale keep-alive connection atau pool acquisition.

### 9.2 HTTP/2 Timeout

Tambahan concern:

- stream timeout;
- connection idle timeout;
- max stream duration;
- flow-control stall timeout;
- ping/keepalive;
- reset stream propagation.

Jika satu connection membawa banyak stream, timeout connection dapat berdampak besar.

### 9.3 HTTP/3 Timeout

Tambahan concern:

- QUIC idle timeout;
- path validation timeout;
- handshake timeout;
- connection migration behavior;
- UDP/NAT timeout.

Prinsip tetap sama:

> Deadline aplikasi harus lebih pendek dan lebih eksplisit daripada timeout infrastruktur yang tidak kamu kontrol.

---

## 10. Streaming Implications by Version

### 10.1 HTTP/1.1 Streaming

Streaming biasanya memakai chunked transfer.

Risiko:

- proxy buffering;
- client lambat menahan worker/thread;
- missing heartbeat;
- response commit terlalu awal;
- timeout idle di proxy.

### 10.2 HTTP/2 Streaming

Streaming berjalan sebagai DATA frames pada stream.

Keuntungan:

- multiplexing dengan stream lain;
- flow control per stream;
- cocok untuk gRPC streaming.

Risiko:

- flow-control stall;
- stream reset;
- satu TCP loss memengaruhi connection;
- proxy HTTP/2 support berbeda-beda.

### 10.3 HTTP/3 Streaming

Streaming berjalan di QUIC streams.

Keuntungan:

- stream-level loss handling lebih baik;
- mobile/network migration lebih baik.

Risiko:

- edge-only support;
- QUIC/UDP operational complexity;
- fallback behavior harus dipantau.

---

## 11. Observability: Jangan Hanya Catat Method dan Status

Untuk production HTTP version analysis, catat minimal:

- negotiated protocol at edge;
- protocol from gateway to app;
- protocol from app to downstream;
- connection reuse;
- stream reset count;
- request duration;
- response body bytes;
- request body bytes;
- status code;
- error source: app vs gateway vs upstream;
- timeout source;
- retry count;
- client abort/cancel count;
- TLS handshake failures;
- HTTP/2 max concurrent stream pressure;
- HTTP/3 fallback rate.

### 11.1 Log Field Example

```json
{
  "timestamp": "2026-06-19T10:15:00Z",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "http_request_method": "GET",
  "url_path": "/cases/C-2026-001",
  "http_response_status_code": 200,
  "network_protocol_name": "http",
  "network_protocol_version": "2",
  "edge_protocol_version": "3",
  "upstream_protocol_version": "1.1",
  "duration_ms": 37,
  "response_body_bytes": 8421,
  "client_aborted": false,
  "gateway_generated_response": false
}
```

### 11.2 Common Observability Blind Spots

| Blind spot | Akibat |
|---|---|
| Hanya app logs, tidak ada edge logs | tidak tahu HTTP/3 terminated di mana |
| Tidak membedakan app 504 vs gateway 504 | salah diagnosis |
| Tidak catat client abort | dianggap server error |
| Tidak catat stream reset | HTTP/2/gRPC issue tersembunyi |
| Tidak catat protocol per hop | optimasi salah sasaran |
| Tidak catat connection pool metrics | HTTP/1.1 bottleneck tidak terlihat |

---

## 12. Security Implications

### 12.1 HTTP/1.1 Security Concerns

- request smuggling;
- ambiguous `Content-Length` / `Transfer-Encoding`;
- header injection;
- slowloris;
- large headers;
- proxy-origin parser mismatch;
- host header attack.

Mitigasi:

- strict parsing;
- reject ambiguous framing;
- align proxy and origin behavior;
- header/body size limits;
- request timeout;
- trusted forwarded headers only.

### 12.2 HTTP/2 Security Concerns

- rapid stream creation abuse;
- flow-control abuse;
- header compression/memory pressure;
- oversized header lists;
- stream reset storms;
- implementation-specific vulnerabilities.

Mitigasi:

- max concurrent streams;
- max header list size;
- connection rate limit;
- stream reset thresholds;
- patch server/proxy;
- edge protection.

### 12.3 HTTP/3 Security Concerns

- UDP amplification controls;
- QUIC implementation maturity;
- middlebox fallback confusion;
- observability gaps;
- edge resource exhaustion;
- operational complexity.

Mitigasi:

- deploy at mature edge/CDN first;
- fallback monitoring;
- rate limiting;
- anti-amplification support;
- staged rollout;
- keep HTTP/2 fallback.

---

## 13. Java Backend Perspective

### 13.1 Spring MVC / Servlet Stack

Spring MVC runs on Servlet containers such as:

- Tomcat;
- Jetty;
- Undertow.

Typical model:

```text
HTTP connection -> container connector -> servlet filter chain -> DispatcherServlet -> controller -> response
```

HTTP/2 support depends on:

- embedded server;
- TLS/ALPN setup;
- Java version;
- container configuration;
- reverse proxy setup.

Most Spring MVC application code does not change for HTTP/2.

But operations change:

- connection/stream behavior;
- TLS config;
- proxy protocol;
- forwarded headers;
- server tuning.

### 13.2 Spring WebFlux / Reactor Netty

WebFlux is non-blocking and supports Reactive Streams backpressure.

Typical model:

```text
event loop -> HttpServerRequest -> WebHandler -> reactive chain -> HttpServerResponse
```

HTTP/2 can be useful for:

- many concurrent streams;
- streaming response;
- high concurrency with non-blocking downstream;
- gRPC-adjacent architectures, though gRPC itself is separate.

But reactive does not magically fix:

- blocking database drivers;
- CPU-heavy serialization;
- bad timeout policy;
- unbounded concurrency;
- slow downstream;
- missing cancellation handling.

### 13.3 Java `HttpClient`

Java built-in `HttpClient` supports selecting version:

```java
HttpClient client = HttpClient.newBuilder()
        .version(HttpClient.Version.HTTP_2)
        .connectTimeout(Duration.ofSeconds(2))
        .build();
```

But requested version is not always guaranteed. Negotiation, server support, TLS/ALPN, and fallback matter.

Backend client wrapper should expose:

- configured preferred protocol;
- actual protocol observed;
- timeout;
- retry;
- pool metrics;
- trace propagation;
- response status mapping;
- body size limits.

### 13.4 Apache HttpClient / OkHttp / WebClient

Different clients have different protocol, pooling, TLS, proxy, and HTTP/2 support characteristics.

Selection criteria:

- synchronous vs reactive;
- HTTP/2 need;
- connection pool visibility;
- proxy support;
- TLS/mTLS support;
- observability integration;
- timeout granularity;
- streaming support;
- ecosystem maturity.

Do not choose client only because API syntax looks nice.

---

## 14. Backend Decision Framework: Which Version Where?

### 14.1 Public Edge

For public browser/mobile APIs:

- HTTP/3 at CDN/edge can improve network performance for some users;
- HTTP/2 fallback is necessary;
- origin can remain HTTP/1.1 or HTTP/2 depending on infra;
- measure real improvement.

Recommended pattern:

```text
Client -> CDN/Edge: HTTP/3 + HTTP/2 fallback
CDN/Edge -> API Gateway: HTTP/2 or HTTP/1.1
Gateway -> Services: HTTP/1.1 or HTTP/2 based on operational maturity
```

### 14.2 Internal REST APIs

HTTP/1.1 is often sufficient if:

- request volume moderate;
- connection pools tuned;
- no need for multiplexing;
- simple observability preferred;
- infrastructure standardizes on HTTP/1.1.

HTTP/2 may be better if:

- many concurrent small requests;
- high connection overhead;
- service mesh/gateway supports it well;
- gRPC is used;
- streaming is important.

### 14.3 gRPC APIs

Use HTTP/2.

But design for:

- deadline propagation;
- stream cancellation;
- load balancing;
- message size limits;
- flow control;
- observability of RPC status and HTTP status.

### 14.4 Large File Transfer

Protocol version alone is not the main decision.

Better question:

- direct app upload or object storage upload?
- range requests needed?
- resumable upload needed?
- proxy buffering disabled?
- body limit enforced?
- malware scanning async?

HTTP/2/3 can help transport, but architecture matters more.

### 14.5 SSE / Streaming

HTTP/1.1 can work with chunked response.

HTTP/2 can multiplex stream with other requests.

HTTP/3 can improve mobile/network behavior at edge.

But success depends on:

- proxy buffering;
- heartbeat;
- idle timeout;
- cancellation;
- backpressure;
- observability.

---

## 15. Example: Same API, Different Protocol Paths

### 15.1 API

```http
GET /cases/C-2026-001/events
Accept: text/event-stream
Authorization: Bearer <token>
```

This is an SSE endpoint for case events.

### 15.2 Path A — HTTP/1.1 to Origin

```text
Browser --H2--> CDN --H1.1--> Spring MVC
```

Risks:

- CDN buffers response unless configured;
- origin thread may be held for long time;
- idle timeout kills stream;
- client disconnect may not cancel domain subscription promptly.

### 15.3 Path B — HTTP/2 to Origin

```text
Browser --H2--> Gateway --H2--> WebFlux service
```

Risks:

- flow-control stall if client slow;
- stream reset must cancel publisher;
- gateway max stream duration;
- one hot connection carries many tenant streams.

### 15.4 Path C — HTTP/3 at Edge Only

```text
Mobile Browser --H3--> Edge --H2--> Gateway --H1.1--> App
```

Benefits:

- better edge connectivity for mobile;
- HTTP/3 connection migration helps client-edge path.

Still not solved:

- origin timeout;
- gateway buffering;
- app thread pressure;
- event source backpressure;
- authorization refresh.

Conclusion:

> Protocol version can improve one hop, but backend correctness requires end-to-end lifecycle design.

---

## 16. Tuning Checklist

### 16.1 HTTP/1.1 Checklist

- [ ] keep-alive timeout set intentionally;
- [ ] max connections configured;
- [ ] request header timeout configured;
- [ ] request body timeout configured;
- [ ] max header size configured;
- [ ] max body size configured;
- [ ] connection pool max total/per-route configured;
- [ ] idle connection eviction enabled;
- [ ] stale connection handling understood;
- [ ] `Content-Length`/`Transfer-Encoding` ambiguity rejected;
- [ ] proxy and origin parsing behavior aligned.

### 16.2 HTTP/2 Checklist

- [ ] ALPN/TLS configured correctly;
- [ ] max concurrent streams set intentionally;
- [ ] max header list size configured;
- [ ] flow-control window understood;
- [ ] stream reset metrics available;
- [ ] connection-level error metrics available;
- [ ] gRPC/load balancing strategy defined;
- [ ] proxy supports HTTP/2 end-to-end if required;
- [ ] cancellation behavior tested;
- [ ] long-lived streams tested through gateway.

### 16.3 HTTP/3 Checklist

- [ ] deployed first at edge/CDN unless strong reason otherwise;
- [ ] HTTP/2 fallback available;
- [ ] UDP/firewall behavior monitored;
- [ ] edge protocol metrics available;
- [ ] origin protocol metrics available;
- [ ] fallback rate monitored;
- [ ] QUIC idle timeout understood;
- [ ] load balancer support validated;
- [ ] staged rollout plan exists;
- [ ] performance measured, not assumed.

---

## 17. Diagnostics Playbook

### 17.1 Symptom: HTTP/2 p99 Latency Spike

Check:

1. Is packet loss increasing on TCP path?
2. Are many streams sharing one connection?
3. Is flow control stalling?
4. Are there stream resets?
5. Is gateway max concurrent stream saturated?
6. Is downstream DB/HTTP pool saturated?
7. Are retries amplifying load?
8. Are large streaming responses sharing connection with small requests?

### 17.2 Symptom: HTTP/3 Enabled but No Improvement

Check:

1. Is HTTP/3 only browser-to-edge?
2. Is origin still HTTP/1.1 bottleneck?
3. Is app bottleneck CPU/DB, not network?
4. Is CDN cache hit ratio low?
5. Is fallback rate high?
6. Are users mostly on stable low-latency networks?
7. Are response payloads dominated by server processing time?

### 17.3 Symptom: Intermittent 502/504

Check:

1. Which hop generated the error?
2. Did app produce response or did gateway timeout?
3. Is upstream connection stale?
4. Is stream reset from client/gateway?
5. Are idle timeouts misaligned?
6. Is request body upload slower than gateway timeout?
7. Is app thread/event loop blocked?
8. Is downstream timeout longer than gateway timeout?

### 17.4 Symptom: Streaming Endpoint Stops Randomly

Check:

1. Gateway idle timeout;
2. heartbeat interval;
3. proxy buffering;
4. HTTP/2 stream reset;
5. client network change;
6. server max stream duration;
7. load balancer connection draining;
8. authentication token expiry;
9. app cancellation handling;
10. event source backpressure.

---

## 18. Design Patterns

### 18.1 Edge Modernization Pattern

Use modern protocol at edge without forcing origin complexity.

```text
Client --H3/H2--> CDN/Edge --H2/H1.1--> Origin
```

Good when:

- public internet clients;
- CDN already supports H3;
- origin stability matters;
- app team does not need direct QUIC complexity.

Risk:

- people overestimate origin benefit;
- must observe both edge and origin.

### 18.2 Internal HTTP/2 Pattern

Use HTTP/2 for service-to-service when traffic profile benefits.

```text
Service A --H2--> Service B
```

Good when:

- many concurrent small requests;
- gRPC;
- streaming;
- service mesh supports it;
- observability mature.

Risk:

- load imbalance due to long-lived connections;
- flow-control complexity;
- stream reset storms.

### 18.3 Conservative Origin Pattern

Keep origin HTTP/1.1 but tune it well.

```text
Gateway --H1.1 pooled connections--> Spring MVC services
```

Good when:

- REST JSON APIs;
- blocking stack;
- predictable traffic;
- simple ops;
- strong proxy/gateway layer.

Risk:

- connection pool bottlenecks;
- HOL blocking;
- higher connection count.

### 18.4 Mixed Protocol Pattern

Choose protocol by traffic type.

```text
REST CRUD APIs     -> HTTP/1.1 or HTTP/2
SSE/Event streams  -> HTTP/2 preferred if supported
File transfer      -> object storage direct upload/download
Internal RPC       -> gRPC over HTTP/2
Public edge        -> HTTP/3 + HTTP/2 fallback
```

This is often more realistic than “everything must be HTTP/3”.

---

## 19. Anti-Patterns

### 19.1 “HTTP/3 Will Fix Our Slow API”

If API is slow because of:

- database query;
- N+1 calls;
- serialization;
- lock contention;
- thread pool saturation;
- downstream latency;
- bad cache policy;
- missing pagination;

then HTTP/3 will not fix the real bottleneck.

### 19.2 “HTTP/2 Means We Don’t Need Connection Pooling Thinking”

HTTP/2 reduces number of connections but adds stream concurrency. You still need to think about:

- max concurrent streams;
- connection lifecycle;
- fairness;
- downstream pool;
- retry/cancellation;
- flow control.

### 19.3 “Our Service Supports HTTP/2, So End-to-End Is HTTP/2”

Not necessarily. A proxy may downgrade or terminate.

Always verify each hop.

### 19.4 “Textual HTTP/1.1 Is Simpler, So It Is Safer”

HTTP/1.1 is easier to inspect manually, but parser ambiguity and request smuggling risks are serious.

### 19.5 “One Protocol for Everything”

Different traffic shapes need different choices.

- browser edge;
- REST JSON;
- gRPC;
- SSE;
- bulk upload;
- internal admin API;
- webhook receiver.

Use the protocol that matches operational constraints.

---

## 20. Case Study: Regulatory Enforcement Platform

Imagine platform with these APIs:

1. Case search and detail retrieval.
2. Evidence upload/download.
3. Case event stream.
4. Internal service-to-service rule evaluation.
5. External agency webhook receiver.
6. Public respondent portal.

### 20.1 Public Respondent Portal

Recommended:

```text
Browser --HTTP/3/2--> CDN/WAF --HTTP/2 or HTTP/1.1--> Gateway --HTTP/1.1--> Spring MVC
```

Rationale:

- benefit from edge HTTP/3 for public users;
- keep origin simpler;
- WAF/rate limit at edge;
- strict forwarded header handling;
- careful cookie/session/CSRF.

### 20.2 Evidence Upload

Recommended:

```text
Browser --HTTPS--> App creates upload session
Browser --HTTPS PUT/POST--> Object storage signed URL
Scanner async validates file
App exposes evidence status resource
```

Protocol version less important than:

- upload session state;
- object storage offload;
- malware scanning;
- audit;
- size limits;
- resumability.

### 20.3 Case Event Stream

Recommended:

```text
Browser --H2/H3 to edge--> Gateway supports streaming --> WebFlux/SSE or event gateway
```

Important:

- heartbeat below idle timeout;
- proxy buffering disabled;
- authorization revalidation strategy;
- cancellation handling;
- tenant isolation;
- event replay ID.

### 20.4 Internal Rule Evaluation

If synchronous low-latency RPC:

```text
Case service --gRPC/H2--> Rule service
```

Important:

- deadlines;
- max message size;
- cancellation;
- load balancing;
- trace propagation;
- fallback for rule service degradation.

If auditability and asynchronous processing matter more:

```text
Case service -> event/command -> Rule evaluation worker -> result resource
```

Protocol version becomes less central than workflow reliability.

### 20.5 External Webhook Receiver

Recommended:

- support HTTP/1.1 robustly;
- strict body size limit;
- signature verification;
- idempotency;
- no reliance on client HTTP/2/3;
- fast `2xx` after durable receipt;
- async processing.

External agencies may have conservative HTTP clients. Robust HTTP/1.1 support matters.

---

## 21. Practical Java/Spring Configuration Notes

Exact configuration depends on Spring Boot version, server, TLS, deployment, and infrastructure. Treat this as mental model, not copy-paste universal config.

### 21.1 Spring Boot HTTP/2 High-Level

Common preconditions:

- server supports HTTP/2;
- TLS/ALPN configured if serving browser traffic;
- Java runtime supports required TLS/ALPN capabilities;
- reverse proxy not downgrading unexpectedly;
- load balancer supports HTTP/2 if needed end-to-end.

Application code usually stays same.

### 21.2 Forwarded Headers

When protocol terminates at proxy, app may need forwarded headers to reconstruct original scheme/host.

Relevant headers:

- `Forwarded`;
- `X-Forwarded-Proto`;
- `X-Forwarded-Host`;
- `X-Forwarded-For`.

Security rule:

> Only trust forwarded headers from trusted proxies. Never trust arbitrary client-supplied forwarding headers.

### 21.3 WebFlux Streaming

For streaming endpoints:

```java
@GetMapping(value = "/cases/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public Flux<ServerSentEvent<CaseEventDto>> events(@PathVariable String id) {
    return caseEventService.streamEvents(id)
            .map(event -> ServerSentEvent.builder(toDto(event))
                    .id(event.id())
                    .event(event.type())
                    .build());
}
```

But production readiness requires:

- authorization before subscription;
- cancellation on disconnect;
- heartbeat;
- rate/concurrency limit;
- no blocking calls on event loop;
- proxy buffering configuration;
- timeout alignment.

### 21.4 MVC Streaming

```java
@GetMapping(value = "/exports/{id}/download")
public ResponseEntity<StreamingResponseBody> download(@PathVariable String id) {
    StreamingResponseBody body = outputStream -> {
        exportService.writeExport(id, outputStream);
    };

    return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=export.csv")
            .contentType(MediaType.TEXT_PLAIN)
            .body(body);
}
```

Risks:

- blocking thread usage;
- response already committed if error occurs mid-stream;
- client disconnect handling;
- proxy buffering;
- timeout chain.

---

## 22. Testing Strategy

### 22.1 Functional Tests Are Not Enough

Unit tests and controller tests usually do not cover:

- ALPN negotiation;
- HTTP/2 multiplexing;
- stream reset;
- flow control;
- proxy downgrade;
- idle timeout;
- slow client;
- chunked body;
- HTTP/3 fallback.

### 22.2 Required Test Categories

#### Local Protocol Test

Use tools that can force protocol:

```bash
curl --http1.1 -v https://api.example.com/cases/C-1
curl --http2 -v https://api.example.com/cases/C-1
curl --http3 -v https://api.example.com/cases/C-1
```

Availability depends on curl build and environment.

#### Proxy Path Test

Test actual deployed path:

```text
client -> CDN -> WAF -> gateway -> service
```

Not only direct service port.

#### Streaming Test

Validate:

- first byte latency;
- heartbeat;
- no buffering;
- idle timeout;
- disconnect cancellation;
- memory usage over long duration.

#### Load Test

For HTTP/2:

- many streams per connection;
- many connections;
- large and small streams mixed;
- reset/cancel under load.

For HTTP/1.1:

- connection pool saturation;
- stale connection;
- keep-alive timeout;
- many short-lived connections.

For HTTP/3:

- fallback rate;
- UDP blocked scenario;
- mobile-like network changes;
- high latency path.

---

## 23. Summary Mental Models

### 23.1 One Sentence

> HTTP/1.1, HTTP/2, and HTTP/3 share HTTP semantics, but differ radically in connection, framing, multiplexing, flow control, and operational failure modes.

### 23.2 Backend Engineer Rules

1. Design API semantics independent of wire version.
2. Observe protocol per hop, not only at client.
3. Tune timeout and concurrency per protocol behavior.
4. Do not assume HTTP/2/3 fixes application bottlenecks.
5. Treat streaming as end-to-end path design, not controller return type.
6. Align proxy, gateway, app server, and client behavior.
7. Measure actual negotiated protocol and fallback.
8. Keep HTTP/1.1 robust because many integrations still rely on it.
9. Use HTTP/2 intentionally for multiplexing/gRPC/streaming, with load-balancing awareness.
10. Deploy HTTP/3 first at edge unless you have a strong operational reason for origin H3.

---

## 24. Exercises

### Exercise 1 — Protocol Path Mapping

Draw the real protocol path for one of your systems:

```text
Client -> CDN -> WAF -> LB -> Gateway -> Service -> Downstream
```

For each hop, fill:

- protocol version;
- TLS termination;
- timeout;
- body limit;
- header limit;
- buffering behavior;
- retry behavior;
- observability source.

### Exercise 2 — HTTP/2 Load Balancing Failure

Scenario:

A gateway opens one long-lived HTTP/2 connection to a backend instance. That instance receives most requests while others idle.

Answer:

1. Why can this happen?
2. What metrics reveal it?
3. What mitigations exist?
4. How would it differ under HTTP/1.1?

### Exercise 3 — Streaming Endpoint Diagnosis

An SSE endpoint works locally but stops every 60 seconds in production.

Investigate:

1. CDN idle timeout;
2. gateway idle timeout;
3. proxy buffering;
4. heartbeat frequency;
5. app server timeout;
6. client reconnect behavior;
7. authentication expiry;
8. cancellation logs.

### Exercise 4 — HTTP/3 Rollout Plan

Create rollout plan:

1. enable HTTP/3 at CDN for 5% traffic;
2. monitor negotiated protocol;
3. monitor fallback to HTTP/2;
4. compare p50/p95/p99 latency;
5. compare error rate;
6. compare region/network types;
7. rollback criteria;
8. origin impact measurement.

### Exercise 5 — Java Client Protocol Choice

For a backend-to-backend call from Case Service to Document Service:

- 100 RPS;
- p95 80 ms;
- JSON payload 20 KB;
- occasional 10 MB downloads;
- Spring MVC blocking service;
- behind internal gateway.

Decide:

1. HTTP/1.1 or HTTP/2?
2. What connection pool settings matter?
3. Should downloads use same client/pool?
4. What timeout and retry policy?
5. What metrics must be captured?

---

## 25. References

- RFC 9110 — HTTP Semantics.
- RFC 9112 — HTTP/1.1.
- RFC 9113 — HTTP/2.
- RFC 9114 — HTTP/3.
- MDN — Evolution of HTTP.
- Spring Framework Reference — Spring WebFlux.
- Spring Boot / embedded server documentation for HTTP/2 support.
- OpenTelemetry semantic conventions for HTTP telemetry.

---

## 26. Closing

HTTP protocol version is not just a compatibility flag. It is an operational architecture decision.

For backend engineers, the mature view is:

- semantics belongs to API design;
- wire protocol belongs to runtime and infrastructure;
- correctness requires stable semantics;
- reliability requires timeout/concurrency/backpressure alignment;
- performance requires measuring the actual bottleneck;
- security requires strict parsing, limits, and trust boundaries;
- observability requires per-hop protocol visibility.

At top-tier level, you should be able to answer:

> “What protocol does this request use at each hop, and what can fail differently because of that?”

That question is often more valuable than simply asking whether the application “supports HTTP/2” or “supports HTTP/3”.

---

**Status seri:** Part 022 dari 032.  
**Seri belum selesai.**  
**Part berikutnya:** `learn-http-for-web-backend-perspective-part-023.md` — Reverse Proxies, Gateways, Load Balancers, and Trust Boundaries.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-http-for-web-backend-perspective-part-021.md">⬅️ Part 021 — Streaming HTTP, SSE, Long Polling, and Async Responses</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-http-for-web-backend-perspective-part-023.md">Part 023 — Reverse Proxies, Gateways, Load Balancers, and Trust Boundaries ➡️</a>
</div>
