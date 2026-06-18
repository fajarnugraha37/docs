# Part 19 — Streaming HTTP: Server-Sent Events, Long Polling, Chunked Streaming, and Backpressure

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `019-streaming-http-server-sent-events-long-polling-chunked-streaming-backpressure.md`  
> Scope Java: Java 8 sampai Java 25  
> Status: Part 19 of 35

---

## 0. Posisi Materi Ini di Dalam Seri

Pada bagian sebelumnya kita sudah membahas HTTP sebagai protocol semantics, HTTP/1.1, HTTP/2, HTTP/3, Java HTTP client, timeout, retry, connection pooling, TLS, middlebox, dan REST contract design.

Bagian ini fokus ke satu bentuk komunikasi yang sering terlihat sederhana, tetapi di production bisa menjadi sumber incident besar:

> HTTP request yang tidak selesai cepat.

Contohnya:

- server mengirim event terus-menerus ke browser,
- client menunggu perubahan status job,
- service mengunduh file besar,
- service mengunggah dokumen besar,
- server mengirim response sedikit demi sedikit,
- gateway melakukan buffering tanpa disadari,
- koneksi dibiarkan hidup lama dan menghabiskan pool/thread/file descriptor,
- consumer lambat membuat producer menumpuk data di memory.

Ini semua masuk ke keluarga **HTTP streaming / long-lived HTTP communication**.

Materi ini **bukan pengulangan Servlet, WebFlux, atau WebSocket dasar**. Fokus kita adalah mental model production-grade:

- kapan HTTP streaming masuk akal,
- bagaimana lifecycle koneksi panjang bekerja,
- bagaimana backpressure diterjemahkan ke HTTP,
- bagaimana proxy/load balancer/service mesh mengubah behavior,
- bagaimana Java 8–25 memengaruhi implementasi,
- bagaimana membuat sistem yang aman dari slow consumer, timeout mismatch, memory leak, retry storm, dan invisible buffering.

---

## 1. Learning Outcomes

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Membedakan **short request**, **long polling**, **SSE**, **chunked streaming**, **streaming upload/download**, dan **WebSocket** secara arsitektural.
2. Menjelaskan mengapa HTTP streaming adalah masalah **resource ownership**, bukan hanya masalah API.
3. Mendesain endpoint streaming yang punya:
   - heartbeat,
   - timeout,
   - cancellation,
   - reconnection,
   - resume semantics,
   - bounded memory,
   - bounded connection count,
   - observability.
4. Memahami bagaimana HTTP/1.1 dan HTTP/2 memengaruhi streaming.
5. Mendeteksi failure karena proxy buffering, load balancer idle timeout, pool starvation, dan slow consumer.
6. Menggunakan Java HTTP client/server streaming secara aman.
7. Menentukan kapan sebaiknya memakai SSE, long polling, WebSocket, gRPC streaming, atau message broker.
8. Membangun checklist production readiness untuk endpoint streaming.

---

## 2. Mental Model Utama

HTTP biasa sering dibayangkan seperti ini:

```text
client request -> server process -> server response -> connection selesai/dikembalikan ke pool
```

Untuk streaming HTTP, modelnya berubah:

```text
client request
  -> server accepts stream
  -> server keeps connection open
  -> server sends data over time
  -> client consumes incrementally
  -> either side may cancel
  -> intermediaries may buffer, timeout, reset, or transform
  -> server must release resources deterministically
```

Perbedaan paling penting:

> Pada request biasa, resource bottleneck sering ada di CPU/DB latency.  
> Pada streaming HTTP, bottleneck sering ada di connection lifetime, memory buffering, network write speed, client consumption speed, dan intermediary behavior.

Streaming bukan hanya “response belum selesai”. Streaming adalah **kontrak waktu panjang** antara client, server, dan semua hop di tengah.

---

## 3. Taxonomy: Bentuk-Bentuk Long-Lived HTTP Communication

### 3.1 Short Request/Response

Ini model default:

```text
GET /case/123
-> response JSON
-> selesai
```

Cocok untuk:

- query cepat,
- command kecil,
- status lookup,
- CRUD biasa,
- synchronous API.

Karakteristik:

- connection bisa dipakai ulang,
- server resource pendek,
- timeout sederhana,
- retry lebih mudah,
- observability lebih straightforward.

---

### 3.2 Polling

Client bertanya secara berkala:

```text
GET /jobs/123/status
GET /jobs/123/status
GET /jobs/123/status
...
```

Cocok untuk:

- update jarang,
- sistem sederhana,
- dashboard internal ringan,
- environment dengan proxy agresif.

Kelemahan:

- banyak request kosong,
- latency update tergantung interval,
- bisa membebani server kalau client banyak,
- polling interval sering menjadi trade-off buruk:
  - terlalu pendek = expensive,
  - terlalu panjang = stale.

---

### 3.3 Long Polling

Client mengirim request, server menahan request sampai ada event atau timeout:

```text
GET /events?since=100

server waits...
if event exists -> return events
if no event by timeout -> return empty response
client immediately reconnects
```

Cocok untuk:

- environment yang tidak mendukung SSE/WebSocket dengan baik,
- event tidak terlalu sering,
- client harus kompatibel dengan HTTP biasa,
- server ingin kontrol batch event.

Kelebihan:

- lebih hemat dari polling biasa,
- masih memakai request/response biasa,
- lebih mudah melewati proxy tertentu dibanding WebSocket.

Kelemahan:

- tetap ada reconnect loop,
- server harus memegang pending request,
- timeout dan cancellation harus benar,
- bisa menyebabkan thundering herd ketika banyak client reconnect bersamaan.

---

### 3.4 Server-Sent Events (SSE)

SSE memakai HTTP response panjang dengan media type:

```http
Content-Type: text/event-stream
```

Server mengirim event teks secara incremental:

```text
event: case-status-changed
id: 101
data: {"caseId":"C-123","status":"APPROVED"}

```

Cocok untuk:

- browser menerima update dari server,
- notification stream satu arah,
- status monitoring,
- progress update,
- audit/live activity feed,
- event yang tidak memerlukan client-to-server message pada koneksi yang sama.

Kelebihan:

- built-in browser `EventSource`,
- reconnect otomatis,
- mendukung `Last-Event-ID`,
- lebih sederhana dari WebSocket,
- berjalan di atas HTTP biasa.

Kelemahan:

- satu arah dari server ke client,
- text-based,
- harus hati-hati dengan proxy buffering,
- connection panjang bisa menghabiskan resource,
- authentication dan authorization perlu desain khusus karena koneksi hidup lama.

---

### 3.5 Chunked Streaming Response

Server mengirim response body sedikit demi sedikit tanpa menunggu seluruh payload selesai.

Pada HTTP/1.1, ini sering memakai `Transfer-Encoding: chunked`.

Contoh use case:

- export report besar,
- generate CSV streaming,
- AI/token-like streaming,
- log tailing,
- incremental search result,
- batch progress output.

Perbedaannya dengan SSE:

- SSE punya event format standar untuk browser.
- Chunked streaming bisa format apa saja: NDJSON, CSV, binary chunks, plain text, custom framing.

---

### 3.6 Streaming Upload

Client mengirim request body secara bertahap:

```text
POST /documents/upload
body: bytes streamed from file
```

Cocok untuk:

- file upload besar,
- multipart upload,
- direct-to-storage proxy,
- document ingestion,
- video/audio ingestion,
- large regulatory document submission.

Risiko:

- server membaca terlalu cepat ke memory,
- server membaca terlalu lambat sehingga client timeout,
- antivirus/scanner membuat pipeline macet,
- retry upload sulit karena body mungkin tidak replayable,
- partial upload harus punya cleanup/resume semantics.

---

### 3.7 Streaming Download

Server mengirim file/payload besar secara bertahap:

```text
GET /reports/annual/export.csv
```

Cocok untuk:

- report besar,
- attachment/document download,
- archive export,
- database dump terbatas,
- generated file.

Risiko:

- slow client menahan server resource lama,
- response body tidak ditutup oleh client,
- connection pool tidak kembali,
- proxy buffering mengubah memory profile,
- timeout idle tidak cocok untuk transfer panjang.

---

### 3.8 WebSocket

WebSocket adalah upgrade dari HTTP ke full-duplex protocol.

Cocok untuk:

- bidirectional real-time,
- chat,
- collaborative editing,
- trading UI,
- multiplayer/game protocol,
- interactive session.

Dalam seri ini WebSocket dibahas lagi di Part 20. Di sini cukup pahami perbedaannya:

```text
SSE       : server -> client, HTTP response stream
Long poll : repeated request/response
WebSocket : full-duplex persistent protocol after upgrade
HTTP chunk: generic streaming response body
```

---

### 3.9 gRPC Streaming

gRPC streaming berjalan di atas HTTP/2 dan Protobuf.

Cocok untuk:

- service-to-service streaming,
- typed contract,
- bidirectional stream,
- flow control lebih eksplisit,
- high-throughput internal RPC.

Akan dibahas lebih dalam di Part 21–24.

---

## 4. Decision Matrix: Pilih Apa?

| Need | Polling | Long Polling | SSE | Chunked HTTP | WebSocket | gRPC Streaming |
|---|---:|---:|---:|---:|---:|---:|
| Browser receives updates | Bisa | Bisa | Sangat cocok | Bisa | Cocok | Tidak native browser |
| Server -> client one-way | Bisa | Bisa | Sangat cocok | Cocok | Bisa | Cocok |
| Client -> server same connection | Tidak | Tidak | Tidak | Tidak | Sangat cocok | Cocok |
| Simple through proxies | Tinggi | Medium/Tinggi | Medium | Medium | Kadang sulit | Internal saja umumnya |
| Typed binary contract | Rendah | Rendah | Rendah | Tergantung | Tergantung | Tinggi |
| Reconnect built-in browser | Manual | Manual | Ada | Manual | Manual | Client library |
| Backpressure model kuat | Lemah | Medium | Lemah/Medium | Medium | Manual | Lebih kuat |
| Best for internal service stream | Rendah | Rendah | Rendah | Medium | Medium | Tinggi |
| Best for admin/status UI | Medium | Medium | Tinggi | Medium | Medium | Rendah |

Rule of thumb:

```text
If update is rare and simplicity matters       -> polling
If update is rare but latency matters          -> long polling
If browser needs server push one-way           -> SSE
If transferring/generating large response      -> chunked/download streaming
If browser needs full duplex                   -> WebSocket
If internal typed stream between services      -> gRPC streaming
If durable fan-out/replay is required          -> broker/log system, not raw HTTP stream alone
```

---

## 5. HTTP Streaming Is a Resource Ownership Problem

Satu koneksi streaming memegang banyak resource:

```text
client-side:
- connection pool slot
- socket/file descriptor
- receive buffer
- parser state
- application subscription/callback
- memory for unconsumed data

server-side:
- accepted socket
- thread or event-loop registration
- response object
- authentication context
- subscription to event source
- outbound queue
- timeout timer
- metrics/tracing context

middlebox-side:
- connection table entry
- buffer
- timeout state
- TLS state
- routing state
```

Karena itu, pertanyaan utama bukan:

```text
Can I stream over HTTP?
```

Pertanyaan yang benar:

```text
How many concurrent streams can I afford?
How long can each stream live?
What happens when the client is slow?
What happens when the client disappears?
What happens when the proxy buffers?
What happens during deploy/drain?
What happens when event source is faster than network write?
```

---

## 6. HTTP/1.1 vs HTTP/2 untuk Streaming

### 6.1 HTTP/1.1

Pada HTTP/1.1, satu connection hanya memproses response secara sequential.

Untuk SSE atau download panjang:

```text
one long stream == one occupied HTTP/1.1 connection
```

Implikasi:

- browser connection limit bisa menjadi bottleneck,
- connection pool client bisa habis,
- request lain ke host sama bisa antre,
- server thread-per-request model bisa collapse kalau connection banyak,
- proxy idle timeout harus sesuai.

### 6.2 HTTP/2

Pada HTTP/2, banyak stream bisa berjalan di atas satu TCP connection.

Implikasi positif:

- lebih efisien untuk banyak stream ke host yang sama,
- tidak butuh satu TCP connection per stream,
- cocok untuk gRPC streaming,
- header compression dan multiplexing membantu.

Tetapi:

- masih ada TCP-level head-of-line blocking,
- `MAX_CONCURRENT_STREAMS` bisa membatasi concurrency,
- flow control harus benar,
- satu connection bermasalah bisa memengaruhi banyak stream,
- long stream bisa berinteraksi buruk dengan short RPC jika tidak dipisahkan.

Rule production:

```text
Do not mix unlimited long-lived streams and latency-sensitive short requests in the same unbounded client/channel/pool without isolation.
```

---

## 7. Server-Sent Events Deep Dive

### 7.1 Format SSE

SSE menggunakan format text/event-stream.

Contoh:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 101
event: case-status-changed
data: {"caseId":"C-123","status":"UNDER_REVIEW"}

id: 102
event: case-status-changed
data: {"caseId":"C-123","status":"APPROVED"}

```

Setiap event dipisahkan oleh blank line.

Field umum:

| Field | Meaning |
|---|---|
| `data:` | payload event |
| `event:` | event type |
| `id:` | event id untuk resume/reconnect |
| `retry:` | hint reconnect delay |
| comment `: ping` | heartbeat/comment |

### 7.2 Browser Reconnect dan Last-Event-ID

Browser `EventSource` dapat reconnect otomatis.

Jika server mengirim:

```text
id: 102
```

pada reconnect berikutnya browser bisa mengirim:

```http
Last-Event-ID: 102
```

Ini membuka desain resume:

```text
client connects with Last-Event-ID = 102
server sends events after 102
```

Tetapi ini hanya aman kalau server punya event retention.

Kalau tidak ada retention:

```text
Last-Event-ID is meaningless.
```

Maka harus jelas:

- event disimpan berapa lama,
- jika gap terlalu besar apa response-nya,
- apakah client harus full refresh,
- apakah event id global, per-user, per-topic, atau per-resource.

### 7.3 Heartbeat

SSE butuh heartbeat agar:

- proxy tidak menganggap connection idle,
- client tahu koneksi masih hidup,
- server bisa mendeteksi write failure,
- network path tetap aktif.

Contoh heartbeat:

```text
: heartbeat

```

Atau event eksplisit:

```text
event: heartbeat
data: {}

```

Rekomendasi:

- heartbeat interval harus lebih kecil dari idle timeout terpendek di path,
- jangan terlalu sering sampai membebani sistem,
- heartbeat harus murah,
- heartbeat bukan pengganti authorization refresh.

### 7.4 SSE Authentication

Pilihan auth:

1. Cookie/session.
2. Bearer token via query parameter — biasanya buruk karena token masuk log/URL.
3. Bearer token via header — browser native `EventSource` tidak fleksibel untuk custom header.
4. Token pendek khusus stream.
5. SSE lewat same-origin authenticated session.
6. Fetch-based SSE polyfill jika butuh custom header.

Risiko:

- koneksi hidup lama setelah permission berubah,
- user logout tetapi stream tetap hidup,
- token expired saat stream masih terbuka,
- stream topic bocor antar user,
- reconnect otomatis mengulang akses.

Production rule:

```text
Authorization for stream must be checked at connect time and may need periodic revalidation or forced disconnect on permission/session change.
```

---

## 8. Long Polling Deep Dive

### 8.1 Basic Flow

```text
Client: GET /case-events?since=100&wait=25s
Server:
  if events after 100 exist:
      return immediately
  else:
      wait up to 25s
      if event arrives -> return
      if timeout -> return empty list
Client:
  process events
  reconnect immediately with latest cursor
```

### 8.2 Long Polling Server State

Server harus menyimpan pending waiters:

```text
caseId -> list of waiting requests
userId -> list of subscriptions
tenantId -> list of subscriptions
```

Risiko:

- memory leak jika request cancellation tidak dibersihkan,
- request waiters unbounded,
- banyak client menunggu topic yang sama,
- event dispatch fan-out blocking,
- deploy memutus semua waiter sekaligus.

### 8.3 Timeout Strategy

Long poll timeout sebaiknya:

- lebih kecil dari gateway idle timeout,
- cukup panjang untuk mengurangi polling churn,
- ditambah jitter agar reconnect tidak serempak,
- client deadline lebih besar sedikit dari server wait timeout.

Contoh:

```text
server wait timeout : 25s
client request timeout: 35s
gateway idle timeout : 60s
client reconnect jitter: 0-2s
```

Anti-pattern:

```text
server wait timeout : 120s
LB idle timeout     : 60s
client timeout      : 65s
```

Hasilnya:

```text
LB closes connection first -> client sees network error -> retry storm / noisy logs
```

---

## 9. Chunked Streaming and Incremental Responses

### 9.1 When to Use

Chunked streaming cocok ketika server tidak bisa atau tidak ingin menunggu seluruh response selesai.

Contoh:

- report CSV besar,
- export audit trail,
- generated archive,
- incremental search result,
- long-running analysis output,
- AI-style token stream,
- log tail.

### 9.2 NDJSON Pattern

NDJSON = newline-delimited JSON.

```text
{"type":"progress","percent":10}
{"type":"row","data":{"id":1}}
{"type":"row","data":{"id":2}}
{"type":"complete"}
```

Kelebihan:

- mudah diparse incremental,
- tiap baris self-contained,
- lebih mudah debug dibanding binary,
- cocok untuk logs/events/results.

Kelemahan:

- text overhead,
- harus escape newline di JSON string,
- client harus tahan partial line,
- schema evolution tetap perlu desain.

### 9.3 CSV Streaming

CSV streaming untuk report besar:

```text
case_id,status,created_at
C-001,OPEN,2026-01-01T10:00:00Z
C-002,CLOSED,2026-01-02T10:00:00Z
```

Risiko:

- client disconnect saat export berjalan,
- query DB terus jalan walau response gagal,
- row buffer membesar,
- escaping CSV salah,
- formula injection di spreadsheet,
- no resume.

Production design:

- stream dari DB cursor dengan fetch size,
- batasi max rows,
- cancel query jika client disconnect,
- flush berkala tapi jangan setiap row kalau mahal,
- audit export request,
- pertimbangkan async export ke object storage untuk file sangat besar.

---

## 10. Streaming Upload

### 10.1 Upload Is Not Just File Copy

Pipeline upload nyata:

```text
client file
-> HTTP request body
-> gateway/proxy
-> Java server input stream
-> validation
-> temporary storage
-> checksum
-> malware scan
-> metadata persistence
-> final object storage
-> domain transaction
```

Setiap tahap bisa gagal.

### 10.2 Memory Safety

Anti-pattern:

```java
byte[] all = request.getInputStream().readAllBytes();
```

Masalah:

- file besar langsung masuk heap,
- mudah OOM,
- GC pressure,
- attacker bisa kirim large body,
- upload lambat menahan thread/resource.

Pattern yang lebih aman:

```text
read bounded chunks
-> write to temp file/object storage
-> compute digest incrementally
-> enforce size limit
-> close stream deterministically
```

### 10.3 Upload Retry

Upload retry sulit karena:

- body mungkin sudah sebagian diterima,
- server mungkin sudah membuat temp file,
- client stream mungkin tidak replayable,
- jaringan putus setelah server menerima semua bytes tetapi sebelum response diterima,
- duplicate upload bisa membuat duplicate document.

Solusi:

- upload session id,
- idempotency key,
- checksum,
- multipart/resumable upload,
- final commit step,
- cleanup expired partial upload.

---

## 11. Streaming Download

### 11.1 The Response Body Must Be Consumed or Closed

Dalam Java HTTP client modern, streaming response body harus dibaca sampai habis, ditutup, atau dibatalkan agar resource bisa dilepas.

Jika tidak:

```text
connection remains occupied
pool slot not returned
file descriptor remains open
HTTP request not considered fully complete
```

Ini sering menyebabkan:

```text
pool exhausted -> pending acquisition -> timeout -> retry -> more pressure
```

### 11.2 Range and Resume

Untuk file besar, pertimbangkan:

```http
Range: bytes=1000000-
```

Dengan server support:

```http
206 Partial Content
Content-Range: bytes 1000000-1999999/5000000
```

Use case:

- download resume,
- parallel segment download,
- partial document access,
- large report retrieval.

Risiko:

- resource authorization tetap harus dicek,
- range abuse bisa menjadi DoS,
- checksum per-part/per-file perlu jelas,
- generated dynamic content sulit support Range.

---

## 12. Backpressure: Konsep yang Sering Salah Dipahami

### 12.1 Apa Itu Backpressure?

Backpressure adalah kemampuan consumer memberi sinyal ke producer:

```text
Do not send faster than I can consume.
```

Tanpa backpressure:

```text
producer fast -> queue grows -> memory grows -> GC pressure -> latency spikes -> OOM
```

### 12.2 Backpressure di HTTP

HTTP tidak selalu punya backpressure aplikasi yang eksplisit.

Yang ada sering berupa sinyal tidak langsung:

- TCP receive window mengecil,
- write call blocking,
- async write future belum selesai,
- event loop tidak siap flush,
- OS send buffer penuh,
- client disconnect,
- HTTP/2 flow control window habis.

Aplikasi harus menerjemahkan sinyal ini menjadi policy:

```text
pause producer
buffer bounded
drop event
coalesce event
disconnect slow consumer
send summary instead of all events
move to broker
```

### 12.3 Bounded Queue Rule

Untuk setiap stream, jangan punya unbounded queue:

```text
user stream -> BlockingQueue<Event>(unbounded)  // dangerous
```

Gunakan bounded queue:

```text
user stream -> bounded queue size 100
if full:
  drop/coalesce/disconnect/backpressure upstream
```

Pilihan policy:

| Policy | Cocok untuk | Risiko |
|---|---|---|
| Block producer | event source bisa diperlambat | bisa menyebarkan latency |
| Drop newest | update non-critical | kehilangan event terbaru |
| Drop oldest | latest-state feed | kehilangan history |
| Coalesce | status/progress | butuh logic merge |
| Disconnect slow client | melindungi server | UX reconnect |
| Persist to broker/log | reliable event | lebih kompleks |

### 12.4 Backpressure vs Buffering

Buffering bukan backpressure.

```text
Buffering: "I keep accepting data and store it somewhere."
Backpressure: "I slow down or stop producer before storage explodes."
```

Jika buffer tidak bounded, kamu hanya menunda incident.

---

## 13. Java Server Implementation Models

### 13.1 Servlet Blocking Streaming

Model:

```text
one request -> one servlet thread writes response over time
```

Sederhana, tetapi berbahaya untuk banyak long-lived streams.

Cocok untuk:

- sedikit stream,
- internal admin,
- export file,
- bounded download.

Risiko:

- thread pool habis,
- response write blocking,
- slow client menahan thread,
- deploy/drain sulit.

### 13.2 Servlet Async

Servlet async memungkinkan request dilepas dari container thread awal.

Model:

```text
request accepted
start async context
worker/event source writes later
complete on finish/error/timeout
```

Tetap harus mengelola:

- timeout,
- listener cancellation,
- bounded queue,
- executor sizing,
- cleanup subscription.

### 13.3 Spring MVC `SseEmitter` / `ResponseBodyEmitter`

Cocok untuk SSE sederhana.

Risiko yang sering muncul:

- emitter tidak dibersihkan saat disconnect,
- map user -> emitter memory leak,
- `send()` blocking atau gagal saat client hilang,
- tidak ada bounded queue per client,
- executor default tidak disizing.

Pattern:

```text
onCompletion -> remove emitter
onTimeout    -> remove emitter
onError      -> remove emitter
heartbeat scheduler
bounded per-subscriber queue
```

### 13.4 WebFlux / Reactive Stack

Model reactive lebih cocok untuk stream karena mendukung non-blocking dan backpressure model.

Tetapi:

- backpressure hanya berguna jika seluruh chain menghormatinya,
- blocking call di event loop tetap fatal,
- database driver/blocking SDK bisa merusak model,
- operator seperti `buffer` bisa membuat memory growth,
- scheduler harus dipahami.

### 13.5 Netty Native

Netty memberi kontrol paling detail:

- channel writability,
- high/low water mark,
- flush strategy,
- ByteBuf lifecycle,
- event loop ownership,
- custom protocol.

Tetapi kompleksitas naik drastis.

Gunakan langsung bila:

- butuh protocol custom,
- high-throughput streaming,
- low-level backpressure,
- resource control ekstrem.

---

## 14. Java Client Streaming Models

### 14.1 JDK `HttpClient`

JDK `HttpClient` mendukung streaming body melalui `BodyHandler` / `BodySubscriber`.

Contoh mental model:

```text
HttpResponse<InputStream>
-> headers available
-> body stream must be consumed/closed
```

Kelebihan:

- bawaan JDK 11+,
- HTTP/1.1 dan HTTP/2,
- sync/async,
- BodySubscriber berbasis reactive streams.

Risiko:

- jika body stream tidak ditutup, resource leak,
- connection pool behavior tidak sefleksibel Apache/OkHttp,
- cancellation harus jelas,
- timeout body panjang harus didesain.

### 14.2 Apache HttpClient

Cocok untuk kontrol lebih detail:

- pooling manager,
- socket timeout,
- response streaming,
- entity consumption,
- connection eviction,
- proxy/TLS rich configuration.

Rule:

```text
Always consume or close response entity.
```

### 14.3 OkHttp

Cocok untuk client ergonomis:

- streaming response body,
- SSE via extension/library patterns,
- connection pool,
- dispatcher concurrency.

Rule:

```text
ResponseBody must be closed.
```

### 14.4 WebClient / Reactor Netty

Cocok untuk:

- streaming response as `Flux<DataBuffer>` / `Flux<Event>`
- non-blocking service client,
- reactive pipeline,
- backpressure-aware flow.

Risiko:

- DataBuffer leak,
- blocking in reactive pipeline,
- unbounded buffering,
- incorrect scheduler usage.

---

## 15. Proxy, Gateway, and Load Balancer Behavior

### 15.1 Proxy Buffering

Banyak proxy/gateway dapat melakukan buffering:

```text
server sends chunks slowly
proxy buffers chunks
client receives nothing until buffer flush/full/response complete
```

Efek:

- SSE tampak tidak jalan,
- heartbeat tidak sampai,
- latency event tinggi,
- memory pindah dari server ke proxy,
- client timeout walau server sudah menulis.

Mitigasi tergantung proxy:

- disable buffering untuk route streaming,
- set correct headers,
- flush secara eksplisit,
- test end-to-end lewat path production, bukan hanya local.

### 15.2 Idle Timeout

Streaming harus memperhatikan timeout di semua hop:

```text
client timeout
corporate proxy timeout
ALB/NLB timeout
ingress timeout
service mesh timeout
server async timeout
application heartbeat interval
```

Rule:

```text
heartbeat interval < shortest idle timeout in path
stream max lifetime < operationally acceptable connection lifetime
```

### 15.3 Connection Draining

Saat deploy:

```text
old pod receives SIGTERM
existing streams still open
load balancer stops new traffic
old streams may continue
termination grace period expires
connections killed
clients reconnect
```

Design:

- expose readiness false before shutdown,
- stop accepting new streams,
- send shutdown event if possible,
- close stream gracefully,
- clients reconnect with cursor,
- keep drain period bounded.

---

## 16. Timeout Strategy for Streaming

Streaming butuh timeout yang berbeda dari short request.

### 16.1 Timeout Types

| Timeout | Meaning |
|---|---|
| Connect timeout | waktu membangun TCP connection |
| TLS handshake timeout | waktu negosiasi TLS |
| First byte timeout | waktu sampai response awal |
| Idle read timeout | max jeda antar bytes/events |
| Max stream duration | umur maksimum stream |
| Write timeout | waktu menulis ke client |
| Server async timeout | umur request async di server |
| Client cancellation timeout | kapan client menyerah |

### 16.2 Jangan Pakai Timeout Short API untuk Stream

Anti-pattern:

```text
standard API timeout = 3s
SSE endpoint uses same client = disconnect every 3s
```

Harus dipisah:

```text
short API client profile:
  request timeout 2-5s

streaming profile:
  connect timeout 1-3s
  idle timeout based on heartbeat
  max stream lifetime 5-30m or policy-based
```

---

## 17. Cancellation and Disconnect Handling

### 17.1 Client Disappears

Client bisa hilang karena:

- tab/browser ditutup,
- mobile network switch,
- corporate proxy reset,
- LB idle timeout,
- client process crash,
- user logout,
- deploy/restart.

Server harus:

```text
notice write failure or cancellation
remove subscriber
cancel upstream work
release queue
release auth/session context
update metrics
```

### 17.2 Cancellation Must Propagate Upstream

Jika streaming report dari DB:

```text
client disconnects
-> server must stop writing
-> cancel DB query/cursor
-> close file/temp resource
-> stop producer
```

Tanpa ini:

```text
server keeps generating data nobody receives
```

---

## 18. Event Delivery Semantics

HTTP stream tidak otomatis memberi durability.

Tentukan semantics:

| Semantic | Meaning |
|---|---|
| At-most-once | event bisa hilang, tidak duplicate |
| At-least-once | event tidak hilang jika retention ada, bisa duplicate |
| Effectively-once | duplicate mungkin, tetapi client/server dedup by id |
| Latest-state only | yang penting state terbaru, bukan semua event |
| Full event history | semua event harus bisa replay |

Untuk SSE dashboard:

```text
latest-state only often enough
```

Untuk audit/regulatory event:

```text
HTTP stream must not be the source of truth.
Use durable event store / database / broker.
```

---

## 19. Cursor, Resume, and Replay

### 19.1 Cursor Design

Cursor bisa berupa:

- numeric sequence,
- timestamp + tie-breaker,
- event id,
- Kafka offset,
- database changelog id,
- opaque token.

Opaque token sering lebih aman:

```text
cursor = base64({topic, lastEventId, issuedAt, signature})
```

Tetapi jangan simpan secret di cursor.

### 19.2 Gap Handling

Jika client reconnect dengan cursor lama:

```text
Last-Event-ID: 100
server retention starts at 150
```

Pilihan:

- return `409 Conflict` with instruction to refresh,
- send snapshot then continue,
- close stream with special event,
- fallback to full sync endpoint.

Pattern bagus:

```text
GET /case-stream?cursor=old
-> event: resync-required
-> data: {"reason":"CURSOR_EXPIRED","snapshotUrl":"/cases/snapshot"}
```

---

## 20. Security Considerations

### 20.1 Authorization Drift

Problem:

```text
user opens stream while authorized
admin revokes access
stream continues sending events
```

Mitigation:

- short max stream lifetime,
- periodic auth revalidation,
- event-level authorization filter,
- force disconnect on permission change,
- topic isolation by tenant/user/role.

### 20.2 Data Leakage via Shared Topic

Anti-pattern:

```text
all users subscribe to /events/cases
server filters only at UI
```

Correct:

```text
server filters before event leaves backend
```

### 20.3 DoS by Connection Hoarding

Attack:

```text
open many SSE/long-poll connections
consume slowly
never close
```

Defense:

- max connections per user/IP/token,
- global stream limit,
- idle heartbeat/write timeout,
- slow consumer disconnect,
- authentication before stream allocation,
- bounded queues,
- rate limit reconnect.

### 20.4 Log Safety

Streaming payload can contain sensitive information.

Never log:

- full event payload by default,
- bearer token in URL,
- document bytes,
- PII-heavy stream data,
- raw query strings containing secrets.

Log:

- stream id,
- user/tenant hash or safe id,
- event type,
- event count,
- bytes sent,
- duration,
- close reason,
- last cursor.

---

## 21. Observability for HTTP Streaming

### 21.1 Metrics

Minimum metrics:

```text
active_streams{endpoint, tenant?}
streams_opened_total{endpoint}
streams_closed_total{endpoint, reason}
stream_duration_seconds
stream_bytes_sent_total
stream_events_sent_total
stream_send_failures_total
stream_heartbeat_total
stream_reconnect_total
stream_queue_depth
stream_queue_dropped_total
slow_consumer_disconnect_total
long_poll_wait_duration_seconds
long_poll_timeout_total
stream_auth_failure_total
```

### 21.2 Close Reason Taxonomy

Gunakan reason yang eksplisit:

```text
CLIENT_DISCONNECT
SERVER_TIMEOUT
MAX_DURATION_REACHED
AUTH_REVOKED
SLOW_CONSUMER
DEPLOY_DRAIN
UPSTREAM_ERROR
CURSOR_EXPIRED
PROTOCOL_ERROR
UNKNOWN_IO_ERROR
```

### 21.3 Logs

Open log:

```json
{
  "event":"stream.open",
  "streamId":"s-abc",
  "endpoint":"/case-events",
  "userId":"u-123",
  "tenantId":"t-1",
  "cursor":"102",
  "clientIp":"...",
  "protocol":"HTTP/2"
}
```

Close log:

```json
{
  "event":"stream.close",
  "streamId":"s-abc",
  "reason":"SLOW_CONSUMER",
  "durationMs":900000,
  "eventsSent":120,
  "bytesSent":34567,
  "lastEventId":"222",
  "queueMaxDepth":100
}
```

### 21.4 Tracing

Tracing streaming sulit karena span panjang bisa:

- terlalu lama hidup,
- terlalu banyak event,
- mahal,
- tidak cocok dengan sampling biasa.

Pattern:

- span untuk stream open/close,
- events as structured logs/metrics,
- sample only unusual streams,
- separate trace for upstream fetch/event production,
- propagate correlation id in event metadata when safe.

---

## 22. Case Study 1: Case Management Live Status Feed

### Problem

Regulatory case officers ingin melihat status update live:

```text
case assigned
case escalated
document uploaded
appeal submitted
approval completed
```

### Bad Design

```text
Browser polls /cases every 2s for all cases.
```

Problems:

- high DB load,
- stale data up to 2s,
- wasteful when no changes,
- hard to distinguish event from state.

### Better Design

```text
GET /case-events?cursor=...
Content-Type: text/event-stream
```

Events:

```text
event: case-status-changed
id: 1001
data: {"caseId":"C-123","status":"ESCALATED","version":12}

```

Client behavior:

```text
on event -> update visible row if present
on reconnect -> send Last-Event-ID
on cursor expired -> full refresh snapshot
```

Server behavior:

```text
per-user authorization
bounded queue per stream
heartbeat every 20s
max stream duration 30m
resume retention 10m
slow consumer disconnect
```

Important invariant:

```text
SSE is not the audit log.
Database/audit/event store remains source of truth.
```

---

## 23. Case Study 2: Large Audit Trail Export

### Problem

User exports millions of audit records to CSV.

### Bad Design

```java
List<Row> rows = repository.findAll();
String csv = renderAll(rows);
return csv;
```

Problems:

- huge heap usage,
- long DB transaction,
- timeout,
- no cancellation,
- no progress,
- no resume.

### Better Design A: Streaming Response

```text
GET /audit/export.csv?from=...&to=...
-> stream CSV rows
```

Rules:

- DB cursor/fetch size,
- row limit or async export threshold,
- close cursor on disconnect,
- flush periodically,
- count bytes/rows,
- audit the export request,
- detect slow client.

### Better Design B: Async Export

For very large export:

```text
POST /audit-exports
-> 202 Accepted
-> Location: /audit-exports/{id}

worker generates file to object storage
client polls/SSE progress
client downloads file when ready
```

This is usually better for large regulatory exports.

---

## 24. Case Study 3: Slow Consumer Incident

### Symptom

```text
Memory grows slowly over hours.
GC increases.
SSE endpoint active streams normal.
Eventually OOM.
```

### Root Cause

Each stream had:

```java
ConcurrentLinkedQueue<Event> queue = new ConcurrentLinkedQueue<>();
```

Slow clients accumulated events indefinitely.

### Fix

```text
bounded queue size 500
coalesce status events by caseId
drop obsolete progress events
disconnect clients that remain full > 30s
add queue depth metric
add dropped event metric
```

Lesson:

```text
Streaming systems fail by unbounded accumulation before they fail by CPU.
```

---

## 25. Case Study 4: Proxy Buffering Breaks SSE

### Symptom

Local SSE works.
In production, client receives events only after several minutes or on connection close.

### Root Cause

Ingress/proxy buffers response chunks.

```text
server flushes event
proxy stores event
client sees nothing
```

### Fix

- disable buffering for SSE route,
- ensure `Content-Type: text/event-stream`,
- send heartbeat,
- test via production ingress path,
- add synthetic canary that verifies event latency end-to-end.

Lesson:

```text
Streaming must be tested through the same middleboxes as production traffic.
```

---

## 26. Design Patterns

### 26.1 Snapshot + Stream

Problem:

```text
client opens stream but needs current state first
```

Pattern:

```text
GET /cases/snapshot
GET /case-events?since=snapshotVersion
```

Invariant:

```text
snapshot version and stream cursor must be compatible
```

### 26.2 Stream + Periodic Resync

Because events can be lost or client bugs happen:

```text
SSE updates UI incrementally
periodic full refresh every N minutes or on visibility change
```

### 26.3 Command + Progress Stream

For long-running job:

```text
POST /imports
-> 202 Accepted Location: /imports/{id}
GET /imports/{id}/events
```

Events:

```text
VALIDATING
PROCESSING
FAILED_ROW
COMPLETED
```

### 26.4 Durable Event Store + SSE Gateway

For reliable event delivery:

```text
DB/Kafka/event store -> SSE gateway -> browser
```

SSE gateway is not source of truth.

### 26.5 Bounded Fan-Out

Instead of every producer writing directly to every client:

```text
event source
-> topic dispatcher
-> per-subscriber bounded queue
-> stream writer
```

Each boundary has metrics and policy.

---

## 27. Anti-Patterns

### Anti-Pattern 1: Unbounded Stream Lifetime

```text
SSE connections can live forever.
```

Problem:

- stale auth,
- deploy drain hard,
- resource leak hidden,
- old clients stay forever.

Better:

```text
max stream lifetime + reconnect with cursor
```

### Anti-Pattern 2: Unbounded Queue Per Client

Already discussed. Always dangerous.

### Anti-Pattern 3: No Heartbeat

Without heartbeat:

- proxies close idle connection,
- client cannot distinguish silent server from no events,
- disconnect detection delayed.

### Anti-Pattern 4: Streaming Through Unknown Proxy Defaults

Never assume:

```text
if local works, production works
```

### Anti-Pattern 5: Logging Every Event Payload

Destroys performance and leaks data.

### Anti-Pattern 6: Using SSE for Durable Audit Delivery

SSE is a transport/view mechanism, not source of truth.

### Anti-Pattern 7: Mixing Long Streams and Short Requests in Same Limited Pool

Can starve normal traffic.

### Anti-Pattern 8: No Reconnect Jitter

Many clients reconnect together after deploy/outage.

### Anti-Pattern 9: Ignoring Client Cancellation

Server keeps doing work after receiver disappeared.

### Anti-Pattern 10: Assuming Reactive Means Safe

Reactive with unbounded buffers is still unsafe.

---

## 28. Practical Java Pseudocode Patterns

### 28.1 Safe SSE Registry Concept

```java
final class StreamRegistry {
    private final ConcurrentMap<String, ClientStream> streams = new ConcurrentHashMap<>();

    void register(ClientStream stream) {
        streams.put(stream.id(), stream);
    }

    void unregister(String streamId, CloseReason reason) {
        ClientStream stream = streams.remove(streamId);
        if (stream != null) {
            stream.close(reason);
        }
    }

    void publish(Event event) {
        for (ClientStream stream : streams.values()) {
            if (stream.isAuthorizedFor(event)) {
                stream.offer(event);
            }
        }
    }
}
```

Important:

```text
ClientStream.offer() must be bounded.
ClientStream.close() must release queue/subscription/resources.
```

### 28.2 Bounded Client Stream

```java
final class ClientStream {
    private final ArrayBlockingQueue<Event> queue = new ArrayBlockingQueue<>(500);
    private final AtomicBoolean closed = new AtomicBoolean(false);

    boolean offer(Event event) {
        if (closed.get()) return false;

        boolean accepted = queue.offer(event);
        if (!accepted) {
            // policy: coalesce, drop, or close
            close(CloseReason.SLOW_CONSUMER);
        }
        return accepted;
    }

    void close(CloseReason reason) {
        if (closed.compareAndSet(false, true)) {
            queue.clear();
            // remove callbacks, cancel timers, record metric
        }
    }
}
```

This is simplified, not framework-specific.

### 28.3 Stream Close Reasons

```java
enum CloseReason {
    CLIENT_DISCONNECT,
    SERVER_TIMEOUT,
    MAX_DURATION_REACHED,
    AUTH_REVOKED,
    SLOW_CONSUMER,
    DEPLOY_DRAIN,
    UPSTREAM_ERROR,
    CURSOR_EXPIRED,
    UNKNOWN_IO_ERROR
}
```

---

## 29. Production Checklist

### 29.1 Endpoint Contract

- [ ] Is the stream one-way or bidirectional?
- [ ] Is event format documented?
- [ ] Is event id/cursor documented?
- [ ] Is reconnect behavior documented?
- [ ] Is heartbeat behavior documented?
- [ ] Is max stream lifetime documented?
- [ ] Is delivery semantics documented?
- [ ] Is cursor expiry documented?

### 29.2 Resource Control

- [ ] Max streams globally.
- [ ] Max streams per user/token/IP.
- [ ] Bounded queue per stream.
- [ ] Slow consumer policy.
- [ ] Max stream duration.
- [ ] Cancellation propagation.
- [ ] Cleanup on disconnect/error/timeout.
- [ ] Separate pool/channel for long streams if needed.

### 29.3 Timeout and Middlebox

- [ ] Known idle timeout for all hops.
- [ ] Heartbeat interval below shortest idle timeout.
- [ ] Proxy buffering disabled/tested.
- [ ] LB drain behavior tested.
- [ ] HTTP/2 stream limits known.
- [ ] Reconnect jitter implemented.

### 29.4 Security

- [ ] Auth checked before stream allocation.
- [ ] Event-level authorization enforced.
- [ ] Permission revocation considered.
- [ ] Token expiry handled.
- [ ] Sensitive payload not logged.
- [ ] Per-user/IP connection limits.

### 29.5 Observability

- [ ] Active stream metric.
- [ ] Open/close count by reason.
- [ ] Duration histogram.
- [ ] Bytes/events sent.
- [ ] Queue depth/dropped events.
- [ ] Slow consumer metric.
- [ ] Reconnect metric.
- [ ] End-to-end streaming canary.

### 29.6 Testing

- [ ] Slow client test.
- [ ] Client disconnect test.
- [ ] Proxy path test.
- [ ] LB idle timeout test.
- [ ] Reconnect/resume test.
- [ ] Cursor expired test.
- [ ] Deploy drain test.
- [ ] Many concurrent streams test.
- [ ] Memory stability soak test.

---

## 30. Exercises

### Exercise 1 — Choose the Transport

For each scenario, choose polling, long polling, SSE, chunked response, WebSocket, or gRPC streaming:

1. Browser admin dashboard showing case assignment updates.
2. Internal service sending high-volume typed telemetry to another service.
3. User exporting 2 GB CSV report.
4. Chat app requiring both sides to send messages instantly.
5. Job status update every few minutes.
6. Document upload with possible network interruption.

Explain the trade-off.

### Exercise 2 — Design an SSE Contract

Design SSE endpoint:

```text
GET /cases/{caseId}/events
```

Define:

- event types,
- event id,
- reconnect behavior,
- heartbeat,
- cursor expiry,
- authorization,
- close reasons,
- metrics.

### Exercise 3 — Diagnose Incident

Symptom:

```text
SSE works locally. In production, browser receives all events at once after 60 seconds.
```

List likely causes and diagnostic steps.

### Exercise 4 — Slow Consumer Policy

You have 10,000 connected clients. Some consume events very slowly.

Design:

- queue size,
- overflow policy,
- disconnect rule,
- metrics,
- client UX behavior.

### Exercise 5 — Export Strategy

A report may contain 10,000 rows or 20 million rows.

Design threshold between:

- synchronous streaming CSV,
- async export job,
- object storage download.

Explain timeout, audit, cancellation, and memory policy.

---

## 31. Key Takeaways

1. HTTP streaming is not merely “response body that takes longer.” It is a long-lived resource contract.
2. SSE is excellent for browser server-push one-way events, but it is not a durable event system.
3. Long polling remains useful when compatibility and proxy simplicity matter.
4. Chunked streaming is useful for incremental response and large generated payloads.
5. Streaming upload/download must be memory-safe and cancellation-aware.
6. Backpressure means controlling producer speed or bounding accumulation, not just buffering more.
7. Proxy buffering and idle timeout are common reasons streaming works locally but fails in production.
8. Every stream must have a lifecycle: open, heartbeat, event, timeout, cancellation, close reason, cleanup.
9. Long-lived streams need separate capacity planning from short HTTP APIs.
10. Production-grade streaming requires metrics, close reason taxonomy, bounded queues, reconnect semantics, and failure testing.

---

## 32. References

- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9112 — HTTP/1.1: https://www.rfc-editor.org/rfc/rfc9112.html
- RFC 9113 — HTTP/2: https://www.rfc-editor.org/rfc/rfc9113.html
- WHATWG HTML Living Standard — Server-Sent Events: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Java SE 25 `HttpClient`: https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html
- OpenJDK HTTP Client Recipes: https://openjdk.org/groups/net/httpclient/recipes.html
- Reactive Streams: https://www.reactive-streams.org/
- Spring WebFlux Reference: https://docs.spring.io/spring-framework/reference/web/webflux.html
- NGINX Proxy Module Documentation: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- Envoy HTTP Connection Manager: https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/http_conn_man

---

## 33. Status Seri

```text
Part 19 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 20 — WebSocket Revisited as a Network Protocol
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 18 — REST Over HTTP: Contract Design, Evolution, Compatibility, and Error Model](./018-rest-over-http-contract-design-evolution-compatibility-error-model.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 20 — WebSocket Revisited as a Network Protocol](./020-websocket-revisited-as-a-network-protocol.md)

</div>