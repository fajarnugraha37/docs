# Part 1 — Mental Model Network Stack: Application Code to Wire

Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `001-network-stack-mental-model-application-code-to-wire.md`  
Target: Java 8 sampai Java 25  
Status: Part 1 dari 35

---

## 1. Tujuan Bagian Ini

Di level pemula, network call sering dipahami seperti ini:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Atau:

```java
MyResponse response = grpcStub.getSomething(request);
```

Mental model ini terlalu sempit. Kode terlihat seperti method call lokal, padahal sebenarnya ia adalah **distributed attempt** yang melewati banyak lapisan:

```text
Java method call
  -> client abstraction
  -> serialization
  -> HTTP/gRPC protocol semantics
  -> connection pool
  -> TLS
  -> TCP socket
  -> JVM native boundary
  -> OS kernel
  -> DNS / route / proxy / load balancer
  -> remote network
  -> server kernel
  -> server runtime
  -> application handler
  -> database / dependency lain
  -> response path kembali
```

Part ini membangun mental model utama untuk seluruh seri:

> Network programming yang matang bukan hanya soal “cara memanggil endpoint”, tetapi soal memahami lintasan data, resource yang dipakai, kontrak di setiap layer, dan failure semantics ketika lintasan itu tidak ideal.

Setelah bagian ini, kamu diharapkan bisa:

1. Membaca satu network call sebagai perjalanan multi-layer.
2. Membedakan error application, protocol, transport, name resolution, TLS, kernel, proxy, dan remote dependency.
3. Melihat timeout, retry, circuit breaker, pool, DNS, TLS, observability, dan payload sebagai satu sistem.
4. Membangun vocabulary yang tepat untuk troubleshooting incident.
5. Memahami kenapa engineer top-tier tidak berhenti pada stack trace.

---

## 2. Apa yang Tidak Diulang di Part Ini

Karena seri sebelumnya sudah membahas Java I/O, NIO, networking, servlet, websocket, JSON/XML, concurrency, security, dan Jakarta stack, bagian ini tidak akan mengulang:

- definisi `InputStream` / `OutputStream`;
- basic `Socket` dan `ServerSocket`;
- basic `Selector`, `Channel`, `Buffer`;
- servlet request lifecycle dasar;
- REST controller pattern dasar;
- JSON serialization dasar;
- thread pool dasar;
- TLS definisi umum;
- “apa itu HTTP” level introductory.

Yang dibahas adalah **cara berpikir sistemik**: bagaimana semua hal itu terhubung dalam satu request nyata di production.

---

## 3. The First Principle: Remote Call Is Not a Local Call

Kesalahan mental model paling mahal adalah memperlakukan remote call seperti local function call.

Local call:

```text
caller -> callee
```

Remote call:

```text
caller
  -> local runtime
  -> local process resource
  -> local OS resource
  -> local network
  -> one or more middleboxes
  -> remote network
  -> remote OS resource
  -> remote runtime
  -> remote application
  -> remote dependencies
  -> response path
```

Perbedaan fundamental:

| Dimensi | Local call | Remote call |
|---|---|---|
| Latency | nanosecond/microsecond | millisecond/second |
| Failure | mostly deterministic exception | partial, ambiguous, delayed, intermittent |
| Ownership | same process/team often | many teams/layers/vendors |
| Retry safety | usually simple | depends on idempotency and side effects |
| Observability | stack trace enough sometimes | needs logs, metrics, traces, network evidence |
| Resource | CPU/memory mostly | CPU, memory, socket, port, DNS, TLS, pool, bandwidth |
| Contract | type-level possible | protocol/schema/version/semantic contract |

Remote call menghasilkan tiga masalah besar:

1. **Uncertainty** — kita sering tidak tahu apakah remote menerima request atau tidak.
2. **Latency variance** — p99 bisa jauh lebih buruk daripada p50.
3. **Partial failure** — sebagian dependency gagal, sebagian berhasil, sebagian lambat.

Contoh:

```text
Client timeout after 2 seconds.
```

Apakah server tidak menerima request?

Belum tentu.

Kemungkinan:

- DNS resolve lambat.
- TLS handshake lambat.
- Request belum terkirim penuh.
- Request sudah diterima server tetapi response lambat.
- Server sudah commit transaksi tetapi response hilang.
- Load balancer memutus connection.
- Client thread kelamaan menunggu connection dari pool.
- Proxy retry diam-diam ke upstream lain.

Engineer biasa melihat `SocketTimeoutException`. Engineer matang bertanya: **timeout di fase mana?**

---

## 4. The Network Call Lifecycle

Satu outbound request Java dapat dipetakan menjadi fase berikut:

```text
[0] Caller enters client API
[1] Request object is built
[2] Payload is serialized
[3] Target endpoint is resolved
[4] Connection is acquired or created
[5] TCP connection is established if needed
[6] TLS handshake happens if HTTPS/mTLS
[7] Protocol negotiation happens if needed, e.g. ALPN
[8] Request headers/metadata are written
[9] Request body is written/streamed
[10] Server receives and routes request
[11] Server application processes request
[12] Server writes response headers/metadata
[13] Server writes response body/trailers
[14] Client reads and decodes response
[15] Client maps result/error to application model
[16] Connection is reused, closed, or marked unhealthy
[17] Metrics/logs/traces are emitted
```

Bagian penting: banyak library menyembunyikan fase ini. Itu bagus untuk productivity, tetapi buruk kalau mental model hilang.

### 4.1 Fase 0 — Caller Enters Client API

Kode Java mungkin terlihat sederhana:

```java
HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

Atau async:

```java
CompletableFuture<HttpResponse<String>> future =
    client.sendAsync(request, BodyHandlers.ofString());
```

Atau gRPC:

```java
AccountResponse response = blockingStub.getAccount(request);
```

Pertanyaan engineering:

- Apakah call ini blocking atau async?
- Thread apa yang menjalankannya?
- Apakah call ini terjadi di servlet thread, event loop, virtual thread, scheduler, atau worker pool?
- Apakah caller memiliki deadline?
- Apakah request bisa dibatalkan?
- Apakah context trace/correlation ikut terbawa?
- Apakah retry berada di sini, di client wrapper, di gateway, atau di service mesh?

Network call selalu dimulai sebagai keputusan concurrency.

---

### 4.2 Fase 1 — Request Object Is Built

Request object bukan hanya URL dan body. Ia membawa kontrak:

- method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`;
- path;
- query parameter;
- headers;
- body;
- authentication;
- idempotency key;
- correlation id;
- timeout/deadline;
- retry policy;
- content type;
- expected response type.

Bug umum:

```text
URL benar, tetapi semantic contract salah.
```

Contoh:

- `POST /payments` di-retry tanpa idempotency key.
- `GET` dipakai untuk operasi yang punya side effect.
- client mengirim `Content-Type: application/json` tetapi body bukan JSON valid.
- client lupa `Accept` header sehingga server mengirim format default yang berubah.
- header authorization tidak ikut saat redirect.
- correlation id dibuat ulang di setiap hop, bukan diteruskan.

Request construction adalah boundary pertama antara domain model dan wire model.

---

### 4.3 Fase 2 — Payload Is Serialized

Object Java harus menjadi bytes.

```text
Java object -> JSON / Protobuf / XML / form / multipart / binary -> bytes
```

Pertanyaan penting:

- Apakah serialization eagerly membangun seluruh payload di memory?
- Apakah streaming atau buffering?
- Apakah field unknown dipertahankan atau dibuang?
- Apakah enum baru akan mematahkan consumer lama?
- Apakah timestamp punya timezone jelas?
- Apakah decimal money aman dari floating-point issue?
- Apakah payload terlalu besar untuk max inbound message size?
- Apakah compression menghemat bandwidth tetapi menambah CPU?

Untuk HTTP JSON kecil, masalah ini sering tidak terlihat. Untuk gRPC streaming, upload dokumen, report besar, batch sync, atau event ingestion, serialization menjadi sumber latency, memory pressure, dan compatibility issue.

---

### 4.4 Fase 3 — Target Endpoint Is Resolved

Sebelum connect, client harus tahu IP tujuan.

```text
service-name.internal -> DNS resolver -> IP address(es)
```

Di production modern, endpoint bisa berasal dari:

- static config;
- environment variable;
- DNS;
- Kubernetes service name;
- service discovery;
- gRPC name resolver;
- API gateway;
- proxy;
- load balancer;
- service mesh sidecar.

Failure umum:

- stale DNS cache;
- negative DNS cache terlalu lama;
- DNS resolver lambat;
- CoreDNS overload;
- split-horizon DNS salah;
- IP backend berubah tetapi JVM masih memakai cache lama;
- client cache endpoint lebih lama daripada TTL;
- service discovery mengembalikan endpoint unhealthy.

Mental model penting:

> URL bukan destination final. URL hanyalah input ke resolution chain.

---

### 4.5 Fase 4 — Connection Is Acquired or Created

Untuk HTTP/gRPC production, request biasanya tidak langsung membuat connection baru. Ia mencoba mengambil connection dari pool/channel.

```text
request -> pool/channel -> existing connection OR create new connection
```

Pertanyaan:

- Apakah pool global per client atau per route?
- Berapa max connection?
- Berapa pending acquisition queue?
- Apakah ada timeout saat menunggu connection dari pool?
- Apakah connection idle masih valid?
- Apakah remote/load balancer sudah menutup connection idle?
- Apakah HTTP/2 multiplexing dipakai?
- Apakah satu connection terlalu banyak stream sehingga flow control bottleneck?

Failure umum:

```text
Application reports timeout, but remote service is healthy.
```

Akar masalah bisa saja:

```text
Client menunggu connection dari pool terlalu lama.
```

Atau:

```text
Semua connection existing stuck karena slow response.
```

Connection pool adalah resource boundary. Ia bisa menjadi bulkhead, tetapi juga bisa menjadi bottleneck diam-diam.

---

### 4.6 Fase 5 — TCP Connection Is Established

Jika connection baru dibutuhkan:

```text
client socket -> SYN -> SYN/ACK -> ACK -> established
```

Masalah yang mungkin terjadi:

- connect timeout;
- routing failure;
- firewall block;
- security group issue;
- target port closed;
- SYN backlog penuh;
- ephemeral port exhaustion;
- NAT gateway exhaustion;
- packet loss;
- network partition;
- asymmetric routing.

Java biasanya hanya menampilkan error ringkas:

```text
java.net.ConnectException: Connection refused
java.net.SocketTimeoutException: connect timed out
java.net.NoRouteToHostException
```

Tetapi arti operasionalnya berbeda:

| Error | Makna awal | Investigasi |
|---|---|---|
| Connection refused | host reachable, port menolak | service down? port salah? listener belum start? |
| Connect timed out | tidak ada response handshake | firewall? route? packet drop? target overloaded? |
| No route to host | routing/local network issue | subnet? route table? network policy? |
| Unknown host | DNS/name resolution | resolver? hostname? TTL? CoreDNS? |

---

### 4.7 Fase 6 — TLS Handshake Happens

Untuk HTTPS/mTLS:

```text
TCP established -> TLS ClientHello -> ServerHello -> cert validation -> key exchange -> secure channel
```

Masalah umum:

- certificate expired;
- hostname mismatch;
- missing intermediate CA;
- wrong truststore;
- wrong keystore;
- mTLS client cert tidak dikirim;
- unsupported TLS version;
- cipher mismatch;
- SNI tidak sesuai;
- ALPN gagal sehingga HTTP/2 tidak negotiated;
- handshake timeout;
- certificate rotation tidak sinkron.

TLS bukan hanya security layer. Ia mempengaruhi:

- latency;
- CPU;
- connection reuse;
- HTTP/2 negotiation;
- observability;
- incident blast radius saat cert rotasi gagal.

---

### 4.8 Fase 7 — Protocol Negotiation

Beberapa protocol butuh negotiation.

Contoh HTTPS + HTTP/2:

```text
TLS ALPN: client offers h2, http/1.1
server selects h2 or http/1.1
```

Jika ALPN gagal, client bisa fallback ke HTTP/1.1 atau gagal, tergantung stack dan config.

Untuk Java modern, JDK `HttpClient` mendukung HTTP/1.1 dan HTTP/2 preference lewat builder. Client yang sudah dibangun bersifat immutable dan dapat dipakai untuk banyak request. Ini berarti konfigurasi seperti proxy, authenticator, redirect, dan preferred protocol adalah bagian dari client-level state, bukan sekadar per-request detail.

Implikasi engineering:

- Jangan membuat `HttpClient` baru untuk setiap request tanpa alasan.
- Pisahkan client berdasarkan policy yang memang berbeda.
- Jangan menganggap semua request HTTPS otomatis HTTP/2.
- Observasi protocol version yang benar-benar digunakan.

---

### 4.9 Fase 8 — Request Headers or Metadata Are Written

HTTP headers atau gRPC metadata membawa informasi penting:

- authorization;
- content type;
- accept;
- correlation id;
- trace context;
- idempotency key;
- tenant id;
- locale;
- user agent;
- deadline;
- compression;
- routing hint.

Failure umum:

- header hilang karena redirect;
- proxy menghapus header tertentu;
- header terlalu besar;
- uppercase/lowercase issue di sistem lama;
- duplicate header semantics tidak dipahami;
- sensitive header bocor ke log;
- trace context tidak dipropagate;
- gRPC metadata binary key salah format.

Header bukan dekorasi. Header adalah **control plane kecil** untuk request.

---

### 4.10 Fase 9 — Request Body Is Written or Streamed

Body bisa:

- kecil dan buffered;
- besar dan streaming;
- multipart;
- compressed;
- chunked;
- gRPC framed message;
- bidirectional stream.

Pertanyaan:

- Apakah body sudah sepenuhnya terkirim saat timeout terjadi?
- Apakah server bisa memproses partial body?
- Apakah client bisa membatalkan upload?
- Apakah slow remote membaca body menyebabkan client thread tertahan?
- Apakah upload besar menghabiskan heap?
- Apakah body publisher backpressure-aware?

Untuk operasi dengan side effect, fase ini penting. Jika client timeout saat write, status remote bisa ambigu:

```text
Client tidak tahu apakah server sudah menerima body lengkap.
```

Karena itu retry write failure untuk `POST` tidak boleh otomatis kecuali operasi idempotent atau punya idempotency key.

---

### 4.11 Fase 10 — Server Receives and Routes Request

Sisi server juga punya lintasan:

```text
NIC -> kernel socket buffer -> server runtime -> protocol parser -> router -> handler
```

Di sistem modern, sebelum application handler, request mungkin melewati:

- ingress controller;
- API gateway;
- WAF;
- service mesh sidecar;
- authentication filter;
- rate limiter;
- request body parser;
- validation layer;
- routing layer.

Jika client menerima 503, akar masalah bisa:

- application down;
- gateway tidak menemukan upstream;
- upstream pool kosong;
- circuit breaker gateway open;
- service mesh mTLS gagal;
- deployment rolling update;
- readiness probe salah;
- rate limit policy;
- queue overload.

Status code bukan root cause. Status code adalah gejala protocol-level.

---

### 4.12 Fase 11 — Server Application Processes Request

Server handler bisa memanggil dependency lain:

```text
client -> service A -> DB
                  -> service B
                  -> object storage
                  -> message broker
```

Dari perspektif client, semua ini terlihat sebagai satu remote call. Dari perspektif system, latency adalah komposisi banyak dependency.

Jika service A punya timeout 5 detik ke service B, tetapi client ke service A hanya punya timeout 2 detik, hasilnya buruk:

```text
Client sudah menyerah, service A masih bekerja, resource tetap terpakai.
```

Ini disebut deadline mismatch.

Prinsip:

> Downstream timeout harus lebih kecil daripada upstream deadline yang tersisa.

---

### 4.13 Fase 12–14 — Response Is Written, Read, and Decoded

Response bukan hanya status code.

Response terdiri dari:

- status;
- headers/metadata;
- body;
- trailers, terutama gRPC;
- protocol close signal;
- connection reuse signal.

Masalah umum:

- server sudah mengirim header 200 tetapi body gagal di tengah;
- client gagal decode JSON;
- gRPC status berada di trailers, bukan HTTP status biasa;
- response compressed tetapi client tidak mendukung;
- content length mismatch;
- connection closed before body complete;
- slow response menyebabkan read timeout;
- large response menyebabkan OOM karena body dibaca penuh ke memory.

Engineer matang membedakan:

```text
HTTP request berhasil secara transport
tetapi gagal secara application semantic.
```

Contoh:

```text
HTTP 200 + { "success": false }
```

Atau:

```text
HTTP 404 sebagai domain result, bukan infrastructure failure.
```

---

### 4.14 Fase 15 — Result Mapping

Client wrapper biasanya memetakan wire response ke model Java:

```text
HTTP/gRPC response -> DTO -> domain result / exception
```

Desain buruk:

```java
throw new RuntimeException("Call failed");
```

Desain lebih matang:

```text
RemoteCallResult
  - success
  - domain error
  - validation error
  - authentication error
  - authorization error
  - not found
  - conflict
  - rate limited
  - timeout
  - cancelled
  - unavailable
  - malformed response
  - protocol error
  - unknown failure
```

Kenapa penting?

Karena retry, alerting, user message, audit, dan compensation bergantung pada jenis failure.

---

### 4.15 Fase 16 — Connection Reuse, Close, or Quarantine

Setelah response:

- connection bisa dikembalikan ke pool;
- ditutup oleh client;
- ditutup oleh server;
- dianggap unhealthy;
- tetap terbuka untuk HTTP/2 stream lain;
- menerima GOAWAY;
- idle sampai timeout.

Masalah umum:

- client reuse connection yang sudah ditutup load balancer;
- server idle timeout lebih pendek daripada client idle timeout;
- HTTP/2 GOAWAY tidak ditangani halus;
- connection leak karena response body tidak ditutup/dikonsumsi;
- pool penuh oleh connection yang sebenarnya mati;
- terlalu sering close menyebabkan handshake overhead dan port exhaustion.

Connection lifecycle harus diamati sebagai state machine, bukan detail library.

---

### 4.16 Fase 17 — Telemetry Is Emitted

Call yang tidak observable adalah call yang tidak bisa dioperasikan.

Telemetry minimal:

- request count;
- latency histogram;
- error count by type;
- timeout count;
- retry count;
- in-flight request;
- connection pool usage;
- DNS failure;
- TLS failure;
- remote status code;
- dependency name;
- operation name;
- correlation id;
- trace id.

OpenTelemetry menyediakan model observability lintas traces, metrics, dan logs, termasuk context propagation agar sinyal dari berbagai komponen bisa dikorelasikan. Java agent OpenTelemetry juga mendukung zero-code instrumentation untuk aplikasi Java 8+ dengan bytecode injection pada banyak library/framework populer.

Mental model:

```text
No propagation -> fragmented evidence.
No metrics -> no trend.
No trace -> no path.
No structured log -> no forensic detail.
```

---

## 5. One Request, Many State Machines

Network call adalah komposisi state machine.

```text
Application operation state
  depends on HTTP/gRPC request state
    depends on connection pool state
      depends on TCP connection state
        depends on TLS session state
          depends on DNS resolution state
            depends on OS/network state
```

Contoh state machine sederhana untuk outbound call:

```text
NEW
  -> BUILD_REQUEST
  -> SERIALIZE
  -> RESOLVE_ENDPOINT
  -> ACQUIRE_CONNECTION
  -> CONNECTING
  -> TLS_HANDSHAKE
  -> SEND_HEADERS
  -> SEND_BODY
  -> WAIT_RESPONSE
  -> READ_RESPONSE
  -> DECODE
  -> SUCCESS
```

Failure bisa terjadi di setiap state:

```text
RESOLVE_ENDPOINT -> UNKNOWN_HOST
ACQUIRE_CONNECTION -> POOL_TIMEOUT
CONNECTING -> CONNECT_TIMEOUT
TLS_HANDSHAKE -> CERTIFICATE_ERROR
SEND_BODY -> WRITE_TIMEOUT
WAIT_RESPONSE -> READ_TIMEOUT
DECODE -> MALFORMED_RESPONSE
```

Top-tier debugging sering dimulai dengan pertanyaan:

> State mana yang gagal?

Bukan:

> Exception-nya apa?

Exception tetap penting, tetapi exception adalah representasi library. State adalah representasi sistem.

---

## 6. Layered Failure Taxonomy

Gunakan taxonomy ini saat membaca incident.

### 6.1 Client-Side Construction Failure

Contoh:

- URL invalid;
- request body tidak bisa diserialize;
- required header kosong;
- credential tidak tersedia;
- invalid URI encoding;
- payload melebihi limit sebelum dikirim.

Ciri:

- request belum keluar dari process;
- remote tidak menerima apa pun;
- retry biasanya tidak berguna tanpa memperbaiki input/config.

---

### 6.2 Name Resolution Failure

Contoh:

- `UnknownHostException`;
- DNS timeout;
- stale DNS;
- wrong service name;
- resolver misconfigured.

Ciri:

- belum ada TCP connection ke target final;
- remote service mungkin sehat;
- impact bisa luas jika DNS shared.

---

### 6.3 Connection Establishment Failure

Contoh:

- connect timeout;
- connection refused;
- no route to host;
- ephemeral port exhausted;
- NAT failure.

Ciri:

- endpoint sudah resolved;
- TCP belum established;
- remote app belum tentu melihat request.

---

### 6.4 TLS / Security Handshake Failure

Contoh:

- certificate expired;
- unknown CA;
- hostname mismatch;
- mTLS client cert salah;
- unsupported protocol;
- ALPN mismatch.

Ciri:

- TCP bisa established;
- HTTP/gRPC belum mulai secara normal;
- sering muncul saat cert rotation, environment mismatch, atau proxy termination berubah.

---

### 6.5 Pool / Concurrency Failure

Contoh:

- connection pool exhausted;
- event loop blocked;
- servlet thread pool penuh;
- virtual thread banyak tetapi downstream pool kecil;
- bounded queue penuh;
- semaphore bulkhead reject.

Ciri:

- remote service bisa sehat;
- failure berasal dari local resource management;
- menambah timeout sering memperburuk keadaan.

---

### 6.6 Protocol Failure

Contoh:

- HTTP/2 stream reset;
- invalid frame;
- header too large;
- malformed response;
- content length mismatch;
- gRPC status/trailer invalid;
- request smuggling protection reject.

Ciri:

- transport ada;
- protocol parser/semantic gagal;
- sering terkait incompatibility, proxy, atau bug implementasi.

---

### 6.7 Application Semantic Failure

Contoh:

- 400 validation error;
- 401 authentication;
- 403 authorization;
- 404 not found;
- 409 conflict;
- 422 domain validation;
- gRPC `INVALID_ARGUMENT`, `NOT_FOUND`, `FAILED_PRECONDITION`.

Ciri:

- request sampai ke application layer;
- retry biasanya tidak menyelesaikan kecuali state berubah;
- harus dibedakan dari infrastructure failure.

---

### 6.8 Remote Overload / Unavailability

Contoh:

- 503;
- 429;
- gRPC `UNAVAILABLE`;
- read timeout karena queue server panjang;
- connection accepted tetapi response lambat.

Ciri:

- remote atau middlebox overload;
- retry tanpa budget dapat memperparah;
- butuh backoff, circuit breaker, rate limiting, dan load shedding.

---

### 6.9 Ambiguous Failure

Contoh:

- timeout setelah request body terkirim;
- connection reset saat menunggu response;
- client cancelled tetapi server tetap memproses;
- proxy retry tapi client tidak tahu;
- response hilang setelah server commit.

Ciri:

- tidak jelas apakah side effect terjadi;
- butuh idempotency key, operation id, reconciliation, atau read-after-write check;
- tidak boleh ditangani dengan blind retry untuk operasi mutasi.

---

## 7. The Hidden Resource Model

Setiap network call memakai resource.

### 7.1 Resource di Client Process

- thread atau virtual thread;
- heap untuk request/response;
- direct buffer;
- connection pool slot;
- pending queue slot;
- CPU untuk serialization/deserialization;
- CPU untuk TLS;
- timer/scheduler;
- metrics/log allocation;
- retry budget.

### 7.2 Resource di OS

- file descriptor;
- socket buffer;
- ephemeral port;
- TCP state table;
- DNS resolver cache;
- kernel memory;
- network interface queue.

### 7.3 Resource di Network Path

- NAT entry;
- load balancer connection slot;
- proxy buffer;
- gateway worker;
- service mesh sidecar CPU/memory;
- firewall/session table.

### 7.4 Resource di Server

- accept queue;
- worker/event loop;
- request body buffer;
- application thread;
- DB connection;
- downstream connection;
- transaction lock;
- response buffer.

Mental model:

> Timeout bukan hanya batas waktu. Timeout adalah batas berapa lama sebuah request boleh memegang resource.

Jika timeout terlalu panjang:

- resource tertahan lama;
- queue membesar;
- p99 naik;
- retry menumpuk;
- recovery lambat.

Jika timeout terlalu pendek:

- false timeout meningkat;
- request sukses di server tetapi gagal di client;
- retry tidak perlu meningkat;
- duplicate side effect lebih mungkin.

---

## 8. The Time Budget Model

Jangan berpikir:

```text
HTTP timeout = 30 seconds
```

Berpikir seperti ini:

```text
End-to-end deadline: 2 seconds
  - local validation: 20 ms
  - DNS: 30 ms budget
  - pool acquisition: 50 ms budget
  - connect/TLS if needed: 200 ms budget
  - remote processing: 1200 ms budget
  - response read/decode: 300 ms budget
  - margin: 200 ms
```

Untuk call chain:

```text
User request deadline: 3000 ms
  Service A internal processing: 300 ms
  A -> B budget: 1000 ms
    B internal processing: 200 ms
    B -> C budget: 500 ms
  A response assembly: 300 ms
  margin: 700 ms
```

Prinsip:

1. Deadline mengalir dari caller ke callee.
2. Timeout downstream harus menghormati sisa deadline upstream.
3. Retry harus memakai budget, bukan menambah waktu tanpa batas.
4. Queue waiting time harus dihitung sebagai latency.
5. Cancellation harus dipropagate jika caller sudah menyerah.

Structured concurrency di Java modern mendukung cara berpikir ini karena subtasks terkait dikelola dalam scope yang lifetimenya terikat pada operasi induk; dokumentasi Java 25 menyatakan subtasks harus selesai sebelum task berlanjut, dan default fork menjalankan subtask pada virtual thread dalam scope. Ini selaras dengan prinsip deadline, cancellation, dan failure aggregation untuk operasi network paralel.

---

## 9. The Data Shape Model

Network performance bukan hanya latency remote. Data shape sangat menentukan.

Dimensi data shape:

- payload size;
- number of fields;
- nesting depth;
- encoding type;
- compression;
- cardinality array/list;
- streaming vs full-buffer;
- schema evolution;
- optional/nullable fields;
- binary vs text;
- repeated metadata.

Contoh buruk:

```text
GET /cases returns 10,000 cases with full details, documents, comments, audit history.
```

Masalah:

- DB berat;
- serialization berat;
- response besar;
- memory client tinggi;
- parsing lambat;
- GC meningkat;
- timeout meningkat;
- retry makin mahal;
- user mungkin hanya butuh listing ringkas.

Desain lebih baik:

```text
GET /cases?page=... -> listing projection
GET /cases/{id} -> detail
GET /cases/{id}/documents -> separate collection
GET /cases/{id}/audit-events -> paginated timeline
```

Untuk gRPC:

```text
Unary response besar
```

bisa diubah menjadi:

```text
Server streaming response dengan flow control dan pagination-like chunks
```

Tetapi streaming bukan selalu solusi. Streaming menambah kompleksitas cancellation, ordering, partial result, retry, dan observability.

---

## 10. The Contract Model

Network boundary adalah contract boundary.

Contract mencakup:

- endpoint/method;
- request schema;
- response schema;
- error schema;
- status code/status mapping;
- auth requirement;
- timeout expectation;
- idempotency;
- pagination;
- ordering;
- consistency;
- versioning;
- rate limit;
- compatibility guarantee;
- deprecation policy.

Engineer top-tier tidak hanya bertanya:

```text
Endpoint-nya apa?
```

Tetapi:

```text
Apa invariant kontraknya?
Apa yang boleh berubah tanpa mematahkan consumer?
Apa yang terjadi jika consumer retry?
Apa yang terjadi jika response partial?
Apa error model-nya stabil?
Apa deadline expectation-nya eksplisit?
Apa observability field wajibnya?
```

---

## 11. HTTP vs gRPC dalam Mental Model Layer

HTTP dan gRPC bukan sekadar style API. Mereka memberi trade-off berbeda.

### 11.1 HTTP/JSON Typical Strength

Cocok untuk:

- public API;
- browser/client compatibility;
- human-debuggable payload;
- REST-ish resource API;
- gradual integration;
- broad tooling;
- cache/proxy semantics;
- simpler operational onboarding.

Risiko:

- schema lemah jika tidak disiplin;
- status/error model sering inconsistent;
- payload besar;
- runtime parse cost;
- versioning sering informal;
- streaming tidak selalu ergonomis.

### 11.2 gRPC Typical Strength

Cocok untuk:

- internal service-to-service;
- strong schema via Protobuf;
- high-throughput low-latency RPC;
- streaming;
- generated clients;
- polyglot microservices;
- deadline/cancellation/status model lebih eksplisit.

Risiko:

- debugging manual lebih sulit;
- HTTP/2/proxy compatibility perlu perhatian;
- browser support perlu gRPC-Web/proxy;
- schema governance tetap wajib;
- streaming mudah disalahgunakan;
- load balancing/name resolution lebih kompleks.

gRPC Java menggunakan transport Netty sebagai implementasi utama untuk client dan server. Ini penting karena banyak behavior gRPC Java di production berhubungan dengan Netty event loop, HTTP/2 stream, flow control, keepalive, dan channel lifecycle.

---

## 12. Java 8 to Java 25: Evolution of Network Thinking

### 12.1 Java 8 Era

Dominan:

- `HttpURLConnection` masih ada tetapi terbatas untuk production modern;
- Apache HttpClient banyak dipakai;
- OkHttp populer;
- Netty untuk high-performance/network framework;
- CompletableFuture mulai tersedia;
- reactive ecosystem tumbuh di luar JDK;
- thread-per-request masih umum.

Mental model Java 8:

```text
Blocking I/O mahal secara thread.
Async/event-loop dipakai untuk concurrency besar.
Connection pool dan timeout harus dikonfigurasi manual dengan disiplin.
```

### 12.2 Java 11+ Era

JDK membawa `java.net.http.HttpClient` sebagai API modern. Client ini dapat mengirim request dan menerima response, dibuat melalui builder, dapat dikonfigurasi dengan preferred protocol HTTP/1.1 atau HTTP/2, redirect, proxy, authenticator, dan setelah dibangun bersifat immutable serta reusable untuk banyak request.

Mental model:

```text
JDK now has a serious HTTP client, but operational policy is still your responsibility.
```

### 12.3 Java 21+ / 25 Era

Dengan virtual threads dan structured concurrency, blocking style menjadi lebih viable untuk banyak workload I/O-bound.

Tetapi jangan salah paham:

```text
Virtual threads reduce thread scalability pain.
They do not remove network, remote, pool, database, rate limit, or bandwidth limits.
```

Kesalahan umum era virtual thread:

```text
Karena thread murah, kita boleh call downstream tanpa limit.
```

Yang benar:

```text
Thread murah hanya mengurangi cost waiting di JVM.
Downstream capacity tetap finite.
```

Maka concurrency control tetap perlu:

- connection pool limit;
- semaphore bulkhead;
- rate limiter;
- deadline;
- cancellation;
- backpressure;
- retry budget;
- adaptive concurrency.

---

## 13. End-to-End Example: One Java HTTP Call

Misalnya ada kode:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofMillis(300))
        .version(HttpClient.Version.HTTP_2)
        .build();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://case-api.internal/v1/cases/123"))
        .timeout(Duration.ofSeconds(2))
        .header("Accept", "application/json")
        .header("X-Correlation-Id", correlationId)
        .GET()
        .build();

HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString()
);
```

Superficial reading:

```text
Call case API dengan timeout 2 detik.
```

Systems reading:

```text
- Client object reusable atau dibuat per request?
- HTTP/2 hanya preference; apakah benar negotiated?
- DNS cache behavior bagaimana?
- connect timeout hanya TCP connect, bukan total request.
- request timeout mencakup seluruh exchange dari perspektif HttpClient.
- TLS handshake masuk budget mana?
- BodyHandlers.ofString membaca seluruh response ke memory.
- Correlation id ada, tetapi trace context apakah ada?
- Apa retry policy jika 503/timeout?
- Apakah GET aman di-retry?
- Bagaimana jika response 200 tetapi JSON malformed?
- Apa metrics untuk latency by dependency?
- Apa pool behavior default dan apakah cukup untuk load?
```

---

## 14. End-to-End Example: One gRPC Call

Kode:

```java
ManagedChannel channel = ManagedChannelBuilder
        .forAddress("account-service.internal", 443)
        .useTransportSecurity()
        .build();

AccountServiceGrpc.AccountServiceBlockingStub stub =
        AccountServiceGrpc.newBlockingStub(channel)
                .withDeadlineAfter(2, TimeUnit.SECONDS);

AccountResponse response = stub.getAccount(
        AccountRequest.newBuilder()
                .setAccountId("A-123")
                .build()
);
```

Superficial reading:

```text
Call account service via gRPC dengan deadline 2 detik.
```

Systems reading:

```text
- Channel dibuat sekali atau per request?
- Name resolution bagaimana?
- Load balancing policy apa?
- Transport Netty atau lainnya?
- HTTP/2 connection sudah established atau perlu connect?
- TLS/mTLS config benar?
- Deadline dipropagate ke server?
- Jika deadline exceeded, server handler ikut cancelled atau tetap jalan?
- Max inbound message size cukup?
- Status code apa yang retryable?
- Apakah interceptor menambahkan auth, trace, tenant id?
- Apakah blocking stub dipanggil dari thread yang tepat?
- Apakah channel shutdown saat aplikasi stop?
```

---

## 15. Diagnostic Thinking: From Symptom to Layer

### 15.1 Symptom: `SocketTimeoutException`

Pertanyaan:

1. Timeout mana?
   - connect?
   - read?
   - request total?
   - pool acquisition?
2. Apakah request sampai server?
3. Apakah server log punya correlation id?
4. Apakah latency naik di p50 atau hanya p99?
5. Apakah error terjadi ke semua endpoint atau satu dependency?
6. Apakah ada retry yang memperparah?
7. Apakah pool penuh?
8. Apakah DNS/TLS latency naik?
9. Apakah downstream server overload?
10. Apakah load balancer idle timeout berubah?

### 15.2 Symptom: HTTP 503

Pertanyaan:

1. 503 berasal dari application, gateway, ingress, service mesh, atau load balancer?
2. Response header mengindikasikan issuer?
3. Apakah upstream endpoint kosong?
4. Apakah readiness probe gagal?
5. Apakah circuit breaker open?
6. Apakah rate limit/global overload?
7. Apakah deploy/rolling restart sedang terjadi?
8. Apakah hanya HTTP/2 atau juga HTTP/1.1?

### 15.3 Symptom: gRPC `DEADLINE_EXCEEDED`

Pertanyaan:

1. Deadline ditetapkan di client atau inherited?
2. Apakah server menerima deadline?
3. Apakah server cancellation-aware?
4. Apakah deadline habis saat queue, processing, atau response streaming?
5. Apakah retry menghabiskan deadline?
6. Apakah dependency server lambat?
7. Apakah client event loop/thread blocked?

### 15.4 Symptom: `SSLHandshakeException`

Pertanyaan:

1. Certificate chain valid?
2. Hostname cocok dengan SAN?
3. Truststore benar?
4. Keystore client untuk mTLS benar?
5. TLS protocol/cipher compatible?
6. SNI dikirim?
7. ALPN untuk HTTP/2 berhasil?
8. Apakah cert baru dirotasi?
9. Apakah proxy melakukan TLS termination?

---

## 16. Mental Model Diagram

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Java Application                            │
│                                                                     │
│  Domain Service                                                     │
│      │                                                              │
│      ▼                                                              │
│  Client Wrapper / SDK                                               │
│      │  timeout, retry, auth, tracing, error mapping                 │
│      ▼                                                              │
│  HTTP Client / gRPC Stub                                            │
│      │  request model, metadata, body publisher                      │
│      ▼                                                              │
│  Serialization Layer                                                │
│      │  JSON, Protobuf, XML, multipart, binary                       │
│      ▼                                                              │
│  Protocol Layer                                                     │
│      │  HTTP/1.1, HTTP/2, gRPC, WebSocket                            │
│      ▼                                                              │
│  Connection / Channel / Pool                                        │
│      │  reuse, multiplexing, max connection, idle timeout            │
│      ▼                                                              │
│  TLS / mTLS                                                         │
│      │  cert, trust, SNI, ALPN, session                              │
│      ▼                                                              │
│  TCP Socket                                                         │
│      │  connect, buffers, FIN/RST, keepalive                         │
│      ▼                                                              │
│  JVM Native Boundary / OS Kernel                                    │
│      │  fd, ephemeral port, route, socket buffer                     │
│      ▼                                                              │
│  DNS / Proxy / Gateway / Load Balancer / Service Mesh               │
│      │                                                              │
│      ▼                                                              │
│  Remote Server Runtime                                              │
│      │                                                              │
│      ▼                                                              │
│  Remote Application and Dependencies                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 17. Design Heuristics for Top-Tier Engineers

### 17.1 Make the Remote Boundary Explicit

Jangan biarkan remote call tersembunyi seperti local method biasa.

Buruk:

```java
caseService.approve(caseId);
```

Jika `caseService` ternyata remote client, caller tidak sadar ada latency/failure.

Lebih eksplisit:

```java
RemoteCallResult<ApproveCaseResponse> result =
        caseCommandClient.approveCase(command, deadline, idempotencyKey);
```

Minimal, di architecture boundary harus jelas mana local service dan mana remote adapter.

---

### 17.2 Every Remote Call Needs a Policy

Policy minimal:

- timeout/deadline;
- retry or no retry;
- idempotency handling;
- circuit breaker/bulkhead if critical;
- auth;
- observability;
- error mapping;
- fallback/degradation if applicable;
- payload limit.

Jika tidak ada policy, default library akan menjadi policy. Itu berbahaya.

---

### 17.3 Separate Domain Error from Transport Error

Jangan campur:

```text
User not found
```

dengan:

```text
Cannot reach user service
```

Keduanya menghasilkan behavior berbeda.

---

### 17.4 Prefer Deadlines Over Isolated Timeouts

Timeout per operation bagus, tetapi deadline end-to-end lebih kuat.

```text
Request started at T0 with deadline T0 + 2s.
Every downstream call receives remaining time.
```

Ini mencegah downstream tetap bekerja setelah caller sudah menyerah.

---

### 17.5 Retry Only When You Understand Side Effects

Retry aman jika:

- operation idempotent;
- idempotency key dipakai;
- failure terjadi sebelum request mungkin diterima;
- server mendukung duplicate suppression;
- retry budget tersedia;
- backoff + jitter ada.

Retry berbahaya jika:

- mutasi state tanpa idempotency;
- timeout terjadi setelah request terkirim;
- downstream overload;
- retry layer ganda tidak terkoordinasi.

---

### 17.6 Observe the Dependency, Not Just the Endpoint

Metric harus menjawab:

```text
Dependency mana yang lambat?
Operation mana?
Status/failure type apa?
Pool penuh atau remote lambat?
Retry berapa banyak?
Deadline exceeded di mana?
```

Bukan hanya:

```text
HTTP client error count naik.
```

---

### 17.7 Treat Connection Pool as Production Component

Pool punya config, metrics, failure, dan lifecycle. Jangan dianggap detail library.

Perhatikan:

- max total;
- max per route;
- idle eviction;
- connection TTL;
- stale connection;
- pending acquisition timeout;
- shutdown;
- load balancer idle timeout alignment.

---

### 17.8 Make Payload Boundaries Explicit

Tetapkan:

- max request body;
- max response body;
- max gRPC message size;
- streaming threshold;
- compression policy;
- pagination limit;
- field projection;
- attachment transfer strategy.

Tanpa limit, payload adalah DoS vector.

---

## 18. Practical Checklist: Before Adding a New Network Call

Gunakan checklist ini sebelum menambah dependency baru.

### 18.1 Contract

- Apa operation name?
- Apa request/response schema?
- Apa error model?
- Apa status mapping?
- Apakah backward-compatible?
- Apakah idempotent?
- Apakah ada idempotency key?

### 18.2 Time

- Berapa end-to-end deadline?
- Berapa connect timeout?
- Berapa read/request timeout?
- Berapa pool acquisition timeout?
- Apakah retry memakai budget?
- Apakah cancellation dipropagate?

### 18.3 Resource

- Berapa max concurrency?
- Berapa connection pool limit?
- Berapa max in-flight request?
- Berapa payload limit?
- Apakah streaming perlu?
- Apakah response dibaca penuh ke memory?

### 18.4 Reliability

- Error mana yang retryable?
- Backoff dan jitter seperti apa?
- Circuit breaker perlu?
- Bulkhead perlu?
- Rate limiter perlu?
- Fallback/degradation apa?

### 18.5 Security

- Auth mechanism apa?
- TLS/mTLS config?
- Truststore/keystore source?
- Secret rotation bagaimana?
- SSRF risk?
- Header/body logging aman?
- Redirect policy aman?

### 18.6 Observability

- Metric dependency latency ada?
- Error by type ada?
- Retry count ada?
- Pool metrics ada?
- Trace propagation ada?
- Correlation id ada?
- Payload logging policy aman?

### 18.7 Operations

- Dashboard ada?
- Alert threshold apa?
- Runbook ada?
- Owner dependency siapa?
- SLA/SLO expectation apa?
- Degradation mode apa?
- Test failure scenario apa?

---

## 19. Anti-Patterns

### 19.1 Client Baru per Request

```java
HttpClient client = HttpClient.newHttpClient();
```

di dalam hot path setiap request bisa menyebabkan resource behavior buruk. Umumnya client/channel dibuat reusable, dipisahkan berdasarkan konfigurasi/policy.

---

### 19.2 Timeout Besar sebagai Solusi Universal

```text
Timeout naik dari 5s ke 60s.
```

Ini sering hanya menyembunyikan bottleneck dan membuat resource tertahan lebih lama.

---

### 19.3 Blind Retry

```text
Jika gagal, retry 3x.
```

Tanpa idempotency, backoff, jitter, dan retry budget, retry bisa membuat incident lebih parah.

---

### 19.4 Semua Error Jadi 500

Jika semua failure dipetakan menjadi 500, sistem kehilangan decision-making.

Perlu dibedakan:

- invalid request;
- auth failure;
- not found;
- conflict;
- rate limit;
- timeout;
- unavailable;
- malformed dependency response;
- dependency semantic error.

---

### 19.5 Tidak Ada Correlation ID

Tanpa correlation id atau trace context, debugging antar-service berubah menjadi tebak-tebakan.

---

### 19.6 Membaca Response Besar ke Memory

```java
BodyHandlers.ofString()
```

praktis untuk response kecil, tetapi berbahaya untuk response besar/tidak terbatas.

---

### 19.7 Blocking di Event Loop

Di Netty/gRPC/reactive stack, blocking operation di event loop bisa merusak banyak connection sekaligus.

---

### 19.8 Mengandalkan Default Library Tanpa Mengetahuinya

Default bukan berarti cocok untuk production.

Default yang perlu dipahami:

- timeout;
- redirect;
- connection pooling;
- HTTP version;
- TLS trust;
- proxy;
- retry;
- max response/message size;
- compression;
- executor/threading.

---

## 20. Mini Case Study: “API Lambat”

Laporan:

```text
Case API lambat sejak jam 10:00. Banyak timeout dari service A ke service B.
```

Engineer superficial:

```text
Service B lambat. Naikkan timeout.
```

Engineer sistemik:

```text
1. Apakah latency naik di client atau server?
2. Apakah timeout terjadi sebelum request sampai B?
3. Pool A penuh?
4. DNS resolve lambat?
5. TLS handshake naik?
6. HTTP status apa dari B?
7. Apakah retry count naik?
8. Apakah B menerima request duplicate?
9. Apakah LB/gateway mengeluarkan 503?
10. Apakah hanya endpoint tertentu?
11. Apakah payload size berubah?
12. Apakah deploy terjadi jam 10:00?
13. Apakah DB B lambat?
14. Apakah p50 atau hanya p99?
15. Apakah cancellation dipropagate?
```

Kemungkinan hasil investigasi:

```text
Service B sebenarnya p50 normal.
Service A connection pool ke B penuh karena 5% request endpoint /report butuh 20 detik.
Retry dari A membuat in-flight request naik 3x.
Timeout dinaikkan justru membuat pool makin lama tertahan.
Solusi: pisahkan pool/bulkhead untuk /report, turunkan timeout, tambah pagination/streaming, retry hanya untuk idempotent lightweight read, dan tambahkan circuit breaker.
```

Pelajaran:

> “API lambat” jarang berarti satu hal. Ia adalah gejala dari interaksi latency, pool, payload, retry, dan dependency behavior.

---

## 21. Exercises

### Exercise 1 — Map a Real Call

Ambil satu outbound call di sistemmu. Buat tabel:

| Phase | Detail |
|---|---|
| Caller | class/method pemanggil |
| Client library | JDK HttpClient/Apache/OkHttp/Feign/WebClient/gRPC |
| Endpoint | host/path/method/service |
| Serialization | JSON/Protobuf/XML/etc |
| Timeout | connect/request/read/deadline |
| Retry | yes/no/policy |
| Pool | max/idle/acquire timeout |
| TLS | truststore/mTLS/SNI |
| Proxy/LB | gateway/ingress/service mesh |
| Observability | metric/log/trace/correlation |
| Error mapping | domain vs transport |

### Exercise 2 — Classify Failures

Untuk setiap error berikut, tentukan layer awal yang paling mungkin:

```text
UnknownHostException
ConnectException: Connection refused
SocketTimeoutException: Read timed out
SSLHandshakeException: PKIX path building failed
HTTP 401
HTTP 409
HTTP 429
HTTP 503
Connection reset by peer
gRPC DEADLINE_EXCEEDED
gRPC UNAVAILABLE
JsonMappingException
```

### Exercise 3 — Deadline Budget

Desain deadline budget untuk request user 3 detik yang memanggil:

```text
Service A -> Service B -> Service C
          -> Service D
```

Tentukan:

- budget A internal;
- budget B;
- budget C;
- budget D;
- retry budget;
- margin;
- cancellation behavior.

### Exercise 4 — Payload Redesign

Skenario:

```text
Endpoint listing mengembalikan 5 MB JSON dan sering timeout.
```

Rancang ulang:

- projection;
- pagination;
- compression;
- cache;
- streaming jika perlu;
- max page size;
- observability metric.

---

## 22. Key Takeaways

1. Remote call bukan local call; ia adalah distributed attempt.
2. Satu request melewati banyak layer: request construction, serialization, DNS, pool, TCP, TLS, protocol, server, response, telemetry.
3. Error message bukan root cause; root cause harus dipetakan ke lifecycle phase.
4. Timeout adalah resource policy, bukan sekadar angka.
5. Retry harus tunduk pada idempotency, budget, backoff, jitter, dan overload condition.
6. Connection pool/channel adalah stateful production component.
7. Payload shape mempengaruhi latency, memory, CPU, GC, dan failure rate.
8. Observability harus dibangun di boundary network, bukan ditambahkan setelah incident.
9. Java 8–25 memberi banyak pilihan concurrency dan client stack, tetapi limit sistem tetap nyata.
10. Skill utama engineer top-tier adalah melihat call sebagai sistem berlapis yang punya state, resource, dan failure semantics.

---

## 23. Preview Part Berikutnya

Part berikutnya:

```text
Part 2 — TCP for Java Engineers: Connections, Streams, Buffers, and Failure Semantics
```

Kita akan masuk lebih rendah ke TCP sebagai fondasi transport:

- TCP stream vs message;
- connect lifecycle;
- FIN/RST;
- half-open connection;
- TIME_WAIT;
- keepalive;
- socket buffer;
- Nagle/delayed ACK;
- ephemeral port exhaustion;
- TCP failure yang muncul sebagai Java exception;
- implikasi ke HTTP/gRPC connection pooling.

---

## 24. Referensi

- Oracle Java 25 Documentation — `java.net.http` module and `HttpClient` API.
- Oracle Java 25 Documentation — `StructuredTaskScope` and structured concurrency.
- gRPC Java Documentation — Netty transport package.
- OpenTelemetry Documentation — context propagation and Java zero-code instrumentation.
