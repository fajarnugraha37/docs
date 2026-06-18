# Part 22 — gRPC Transport Internals: HTTP/2, Netty, Flow Control, Keepalive, Deadlines, and Metadata

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> Level: Advanced / production engineering  
> Target Java: 8–25  
> Fokus: memahami gRPC sebagai runtime transport di atas HTTP/2, bukan hanya generated stub.

---

## 0. Posisi Bagian Ini Dalam Seri

Di Part 21 kita membahas gRPC dari sisi model pemrograman:

- `.proto`
- service definition
- unary RPC
- streaming RPC
- stub
- channel
- server implementation
- metadata dasar
- status code
- deadline dasar

Part 22 turun satu lapisan lebih dalam.

Kita tidak lagi hanya bertanya:

> “Bagaimana cara memanggil method gRPC?”

Kita bertanya:

> “Apa yang sebenarnya terjadi pada transport ketika sebuah gRPC call berjalan?”

Ini penting karena banyak incident gRPC di production tidak bisa dipahami dari level stub saja.

Contoh error yang sering muncul:

```text
DEADLINE_EXCEEDED
UNAVAILABLE: io exception
UNAVAILABLE: upstream connect error
UNKNOWN: transport is closing
CANCELLED: cancelled before receiving half close
RESOURCE_EXHAUSTED: gRPC message exceeds maximum size
RST_STREAM
GOAWAY
connection closed after GOAWAY
keepalive failed
```

Engineer biasa sering melihat error ini sebagai “gRPC error”.

Engineer kuat akan memetakan error tersebut ke lapisan:

```text
application deadline
RPC cancellation
HTTP/2 stream reset
HTTP/2 connection draining
Netty event loop blocked
flow-control window exhausted
proxy/LB idle timeout
TLS/ALPN negotiation issue
connection stream limit reached
server overload
large message limit
metadata/header limit
```

Target bagian ini adalah membangun mental model tersebut.

---

## 1. Learning Outcomes

Setelah bagian ini, kamu harus bisa:

1. Menjelaskan bagaimana satu gRPC call dipetakan ke HTTP/2 stream.
2. Membedakan `ManagedChannel`, HTTP/2 connection, subchannel, stream, frame, dan RPC call.
3. Memahami bagaimana metadata, message, status, dan trailers berjalan di atas HTTP/2.
4. Menjelaskan perbedaan gRPC status dan HTTP status.
5. Memahami Netty transport sebagai event-loop based runtime.
6. Menjelaskan kenapa tidak boleh blocking di Netty event loop.
7. Memahami gRPC flow control, terutama untuk streaming RPC.
8. Membedakan deadline, timeout, cancellation, keepalive, dan health check.
9. Memahami risiko konfigurasi keepalive yang terlalu agresif.
10. Mendesain konfigurasi dasar gRPC client/server yang production-aware.
11. Membaca failure seperti `GOAWAY`, `RST_STREAM`, `UNAVAILABLE`, dan `DEADLINE_EXCEEDED` secara lebih akurat.
12. Membangun checklist observability untuk gRPC transport.

---

## 2. Mental Model Utama

gRPC bukan “protokol baru yang menggantikan HTTP”.

Dalam implementasi umum, gRPC berjalan di atas HTTP/2.

Secara mental:

```text
gRPC API model
  -> generated stub
  -> ClientCall / ServerCall
  -> gRPC message framing
  -> HTTP/2 stream
  -> HTTP/2 frames
  -> TLS / ALPN, biasanya
  -> TCP connection
  -> kernel socket
  -> network path
```

Satu unary call gRPC kira-kira seperti ini:

```text
Client application
  calls stub.someMethod(request)

Generated stub
  creates gRPC client call

gRPC runtime
  serializes Protobuf request
  wraps it as gRPC message frame
  attaches metadata

HTTP/2 transport
  opens a stream on an existing HTTP/2 connection
  sends HEADERS frame
  sends DATA frame(s)
  sends END_STREAM when request is complete

Server transport
  receives HEADERS + DATA
  reconstructs gRPC message
  invokes service implementation

Server application
  returns response or error

Server transport
  sends response DATA frame(s)
  sends trailers containing grpc-status

Client runtime
  receives response message and trailers
  completes call
```

Untuk streaming RPC, prosesnya sama, tetapi jumlah message bisa banyak dan lifecycle stream lebih panjang.

---

## 3. gRPC Call Bukan TCP Connection

Kesalahan mental model yang sangat umum:

> “Satu gRPC request = satu connection.”

Biasanya salah.

Pada gRPC over HTTP/2:

```text
One ManagedChannel
  -> one or more HTTP/2 connections, depending transport/load balancing/configuration
  -> each HTTP/2 connection can carry many concurrent streams
  -> each stream can carry one gRPC call
```

Lebih tepat:

```text
gRPC call ~= HTTP/2 stream
HTTP/2 stream != TCP connection
ManagedChannel != one request
```

Visual:

```text
ManagedChannel
  |
  +-- HTTP/2 connection A
        |
        +-- stream 1 -> RPC call A
        +-- stream 3 -> RPC call B
        +-- stream 5 -> RPC call C
        +-- stream 7 -> long-running streaming RPC
```

Akibatnya:

- satu connection bisa menjadi bottleneck jika stream limit tercapai;
- long-running stream bisa mempengaruhi capacity planning;
- connection-level flow control bisa mempengaruhi banyak RPC;
- satu `GOAWAY` bisa berdampak ke banyak call baru;
- LB yang membatasi HTTP/2 concurrent stream dapat menyebabkan client-side queueing;
- channel reuse penting untuk performance, tetapi channel tunggal tidak selalu cukup untuk extreme concurrency.

---

## 4. Layer Vocabulary

Sebelum masuk detail, kita perlu menyamakan istilah.

| Istilah | Arti Praktis |
|---|---|
| RPC call | Satu logical remote procedure call dari client ke server |
| Stub | API Java generated/manual wrapper yang dipakai application code |
| ManagedChannel | Abstraksi client-side koneksi/logical channel ke target |
| Name resolver | Komponen yang mengubah target name menjadi address/subchannel |
| Load balancer | Komponen client-side gRPC yang memilih subchannel/address |
| Subchannel | Abstraksi koneksi ke satu address/backend tertentu |
| HTTP/2 connection | Koneksi transport yang membawa banyak stream |
| HTTP/2 stream | Kanal multiplexed dalam connection; biasanya satu RPC |
| HTTP/2 frame | Unit terkecil HTTP/2: HEADERS, DATA, SETTINGS, PING, GOAWAY, RST_STREAM, WINDOW_UPDATE |
| Metadata | Key-value side channel, dipetakan ke HTTP/2 headers/trailers |
| Message | Payload Protobuf yang dibingkai sebagai gRPC message |
| Trailers | Metadata akhir yang membawa `grpc-status`, `grpc-message`, dan optional detail |
| Deadline | Batas waktu absolut/logical kapan client tidak mau menunggu lagi |
| Cancellation | Sinyal untuk menghentikan RPC yang tidak lagi dibutuhkan |
| Keepalive | HTTP/2 PING untuk mendeteksi koneksi mati atau menjaga koneksi tetap hidup |
| Flow control | Mekanisme agar sender tidak membanjiri receiver |

---

## 5. gRPC over HTTP/2: Shape Dasar

Sebuah gRPC call menggunakan HTTP/2.

Secara konseptual, request gRPC unary terlihat seperti:

```text
HTTP/2 HEADERS
  :method: POST
  :scheme: https
  :path: /package.Service/Method
  :authority: service.example.internal
  content-type: application/grpc
  te: trailers
  grpc-timeout: ...       optional
  custom-metadata: ...    optional

HTTP/2 DATA
  gRPC length-prefixed message

END_STREAM
```

Response sukses:

```text
HTTP/2 HEADERS
  :status: 200
  content-type: application/grpc

HTTP/2 DATA
  gRPC length-prefixed response message

HTTP/2 TRAILERS
  grpc-status: 0
  grpc-message: optional
```

Response error bisa saja tidak punya response message:

```text
HTTP/2 HEADERS
  :status: 200
  content-type: application/grpc

HTTP/2 TRAILERS
  grpc-status: 5
  grpc-message: not found
```

Hal penting:

> gRPC success/failure terutama ditentukan oleh `grpc-status`, bukan hanya HTTP status.

HTTP status `200` bisa membawa gRPC error di trailers.

---

## 6. HTTP Status vs gRPC Status

Di REST, HTTP status biasanya menjadi status utama:

```text
200 OK
404 Not Found
409 Conflict
500 Internal Server Error
503 Service Unavailable
```

Di gRPC, status utama adalah gRPC status:

```text
OK
CANCELLED
UNKNOWN
INVALID_ARGUMENT
DEADLINE_EXCEEDED
NOT_FOUND
ALREADY_EXISTS
PERMISSION_DENIED
RESOURCE_EXHAUSTED
FAILED_PRECONDITION
ABORTED
OUT_OF_RANGE
UNIMPLEMENTED
INTERNAL
UNAVAILABLE
DATA_LOSS
UNAUTHENTICATED
```

HTTP status tetap ada, tetapi biasanya berfungsi sebagai carrier/protocol status.

Contoh:

```text
HTTP/2 :status = 200
grpc-status = 7 PERMISSION_DENIED
```

Artinya transport HTTP/2 berhasil membawa response gRPC, tetapi aplikasi gRPC menolak operasi.

Sedangkan:

```text
HTTP/2 :status = 503
```

Bisa berarti request tidak mencapai gRPC server sebenarnya, misalnya gateway, LB, proxy, atau mesh menolak/mengalami overload.

### Implikasi Observability

Untuk gRPC, dashboard yang hanya melihat HTTP status akan misleading.

Minimal perlu:

```text
grpc.client.calls{grpc.status}
grpc.server.calls{grpc.status}
grpc.deadline_exceeded
grpc.cancelled
grpc.unavailable
grpc.resource_exhausted
transport.http2.goaway
transport.http2.rst_stream
channel.state
```

---

## 7. Metadata: Headers dan Trailers sebagai Side Channel

gRPC metadata adalah key-value side channel.

Biasanya dipakai untuk:

- authentication token;
- tenant id;
- correlation id;
- trace context;
- request id;
- locale;
- client version;
- feature flag;
- audit context;
- routing hint;
- idempotency key.

Metadata awal dikirim sebelum message.

```text
Client -> Server initial metadata
```

Metadata akhir dikirim sebagai trailers.

```text
Server -> Client trailing metadata
```

Trailers penting karena di sanalah `grpc-status` hidup.

### Metadata Bukan Tempat Payload Besar

Metadata dikompresi dengan mekanisme header compression HTTP/2, tetapi tetap bukan untuk payload besar.

Anti-pattern:

```text
metadata["user-profile-json"] = huge JSON
metadata["permissions"] = 500KB list
metadata["audit-context"] = large serialized object
```

Dampaknya:

- header size limit;
- HPACK/QPACK pressure;
- proxy rejection;
- `RESOURCE_EXHAUSTED`;
- memory overhead;
- security leakage;
- log leakage.

Rule of thumb:

> Metadata adalah control plane kecil. Payload adalah data plane.

---

## 8. gRPC Message Framing

Protobuf message tidak langsung ditaruh mentah begitu saja.

gRPC membingkai message dengan format konseptual:

```text
1 byte  compressed flag
4 bytes message length
N bytes serialized message
```

Jadi dalam HTTP/2 DATA frame, gRPC membawa satu atau lebih message frame.

Mental model:

```text
Protobuf object
  -> serialized bytes
  -> gRPC message frame
  -> HTTP/2 DATA frame(s)
  -> TCP byte stream
```

Hal ini penting untuk memahami:

- max message size;
- compression;
- streaming message boundaries;
- memory allocation;
- partial transport frame;
- large payload behavior.

HTTP/2 frame boundary tidak sama dengan Protobuf message boundary.

```text
One gRPC message may be split across multiple HTTP/2 DATA frames.
Multiple small gRPC messages may be carried across multiple frame arrangements.
```

Application tidak boleh bergantung pada transport frame boundary.

---

## 9. Unary RPC Lifecycle

Unary RPC terlihat sederhana:

```java
Response response = blockingStub.getCase(request);
```

Tetapi transport lifecycle-nya panjang.

```text
1. Application calls stub
2. Stub creates ClientCall
3. Deadline/context/interceptors attached
4. Metadata prepared
5. Channel picks subchannel/connection
6. HTTP/2 stream allocated
7. HEADERS sent
8. Request message serialized
9. DATA sent
10. Client half-closes request stream
11. Server receives headers/message
12. Server invokes application handler
13. Server serializes response
14. Response DATA sent
15. Trailers sent with grpc-status
16. Client receives DATA/trailers
17. Client completes future/blocking call
18. Stream is closed
19. HTTP/2 connection remains reusable
```

Failure bisa terjadi di setiap tahap.

Contoh:

| Tahap | Failure |
|---|---|
| channel picking | no healthy subchannel |
| stream allocation | max concurrent streams reached |
| HEADERS send | connection closed |
| DATA send | flow-control blocked |
| server invoke | application exception |
| response receive | deadline exceeded |
| trailers receive | malformed response |
| connection reuse | stale connection / GOAWAY |

---

## 10. Streaming RPC Lifecycle

gRPC punya 4 bentuk call:

```text
Unary              : 1 request  -> 1 response
Server streaming   : 1 request  -> N responses
Client streaming   : N requests -> 1 response
Bidi streaming     : N requests -> N responses
```

Streaming RPC bukan “loop biasa”.

Ia adalah long-lived HTTP/2 stream dengan flow control, cancellation, backpressure, dan lifecycle yang harus dirancang.

Contoh server streaming:

```text
Client sends request
Client half-closes request side
Server sends response message 1
Server sends response message 2
Server sends response message 3
...
Server sends trailers grpc-status=OK
```

Contoh bidi streaming:

```text
Client sends message A
Server sends message 1
Client sends message B
Server sends message 2
Client sends message C
...
Either side may half-close
Either side may cancel/reset
```

Masalah yang muncul:

- slow client;
- slow server;
- unbounded outbound queue;
- memory growth;
- no resume protocol;
- no application-level sequence id;
- stream held across deploy;
- stream held across LB draining;
- deadline terlalu panjang/tidak ada;
- cancellation tidak diteruskan ke worker thread.

---

## 11. Netty Transport di gRPC Java

Di Java, transport umum untuk gRPC server dan non-Android client adalah Netty.

Netty adalah asynchronous event-driven network framework.

Mental model Netty:

```text
EventLoopGroup
  -> EventLoop threads
      -> Channel
          -> ChannelPipeline
              -> Handler 1
              -> Handler 2
              -> HTTP/2 codec
              -> gRPC transport handler
```

### Event Loop

Event loop thread menangani I/O events.

```text
read event
write readiness
flush
connection close
TLS handshake progress
HTTP/2 frame decode
HTTP/2 frame encode
```

Golden rule:

> Jangan blocking event loop.

Yang termasuk blocking:

- JDBC query;
- remote HTTP call;
- file I/O besar;
- `Thread.sleep()`;
- synchronous queue wait;
- CPU-heavy crypto/compression tanpa offload;
- long JSON/XML parsing;
- lock contention berat.

Jika event loop blocked:

```text
satu thread lambat
  -> banyak channel terlambat diproses
  -> ping timeout
  -> read/write delay
  -> deadline exceeded
  -> transport closing
  -> p99/p999 latency naik
```

### Application Handler Thread

gRPC Java server biasanya tidak menjalankan service implementation langsung di Netty event loop. Ada executor untuk application logic.

Tetapi tetap ada risiko:

- executor tidak dibatasi;
- executor penuh;
- callback async kembali melakukan blocking;
- manual offloading salah;
- interceptor melakukan kerja berat di path sensitif;
- streaming observer dipanggil dari thread yang salah;
- shared lock menghambat banyak call.

---

## 12. Channel Reuse dan Stub Reuse

Best practice umum:

```text
reuse channel
reuse stub
```

Jangan membuat channel per request.

Anti-pattern:

```java
ManagedChannel channel = ManagedChannelBuilder
    .forAddress(host, port)
    .useTransportSecurity()
    .build();

MyServiceGrpc.MyServiceBlockingStub stub = MyServiceGrpc.newBlockingStub(channel);
return stub.getSomething(request);
channel.shutdown();
```

Masalah:

- DNS ulang;
- TCP connect ulang;
- TLS handshake ulang;
- HTTP/2 settings ulang;
- warm-up hilang;
- ephemeral port pressure;
- CPU overhead;
- latency tinggi;
- connection storm saat traffic spike.

Lebih benar:

```java
public final class CaseGrpcClient implements AutoCloseable {
    private final ManagedChannel channel;
    private final CaseServiceGrpc.CaseServiceBlockingStub blockingStub;
    private final CaseServiceGrpc.CaseServiceFutureStub futureStub;

    public CaseGrpcClient(String host, int port) {
        this.channel = ManagedChannelBuilder
            .forAddress(host, port)
            .useTransportSecurity()
            .build();

        this.blockingStub = CaseServiceGrpc.newBlockingStub(channel);
        this.futureStub = CaseServiceGrpc.newFutureStub(channel);
    }

    public CaseResponse getCase(CaseRequest request, Duration deadline) {
        return blockingStub
            .withDeadlineAfter(deadline.toMillis(), TimeUnit.MILLISECONDS)
            .getCase(request);
    }

    @Override
    public void close() {
        channel.shutdown();
    }
}
```

Catatan:

- stub biasanya immutable/lightweight;
- stub bisa dibuat dari channel yang sama;
- per-call option seperti deadline bisa diterapkan dengan `withDeadlineAfter`;
- channel lifecycle harus dikelola seperti dependency singleton/per-client-target.

---

## 13. HTTP/2 Multiplexing dan Stream Limit

HTTP/2 memungkinkan banyak stream dalam satu connection.

Tetapi bukan infinite.

Server dan intermediary dapat mengatur:

```text
SETTINGS_MAX_CONCURRENT_STREAMS
```

Jika active stream mencapai limit, call baru bisa:

- menunggu/queue di client;
- membuka connection lain, tergantung transport/config;
- gagal jika timeout/deadline tercapai sebelum dikirim.

Problem umum:

```text
One channel
One HTTP/2 connection
100 max concurrent streams
2000 concurrent long-lived streaming calls
```

Akibat:

```text
100 active
1900 queued
latency naik
deadline exceeded sebelum request benar-benar diproses server
```

### Rule

> HTTP/2 multiplexing mengurangi kebutuhan banyak connection, tetapi tidak menghapus capacity planning.

Untuk traffic besar:

- ukur active stream per connection;
- pahami max concurrent stream dari server/proxy/LB;
- pisahkan channel untuk long-running stream dan unary latency-sensitive call;
- gunakan client-side load balancing yang benar;
- pertimbangkan beberapa channel hanya jika memang perlu dan terukur;
- jangan membuat channel pool asal-asalan tanpa observability.

---

## 14. Flow Control

Flow control adalah mekanisme agar receiver tidak dibanjiri sender.

Di HTTP/2, flow control ada di dua level:

```text
connection-level flow control
stream-level flow control
```

Mental model:

```text
Receiver says:
  "You may send up to X bytes."

Sender sends data.

When receiver consumes data,
  receiver sends WINDOW_UPDATE.

Sender can send more.
```

### Kenapa Penting?

Tanpa flow control:

```text
fast sender
  -> slow receiver
  -> buffer grows
  -> memory pressure
  -> GC pressure
  -> OOM
  -> process killed
```

Dengan flow control:

```text
receiver not ready
  -> sender eventually blocked/backpressured
```

### Unary vs Streaming

Untuk unary small payload, flow control sering tidak terasa.

Untuk streaming, flow control sangat penting.

Contoh:

```text
server sends 10,000 events/sec
client processes 500 events/sec
```

Jika application layer tidak menghormati readiness/backpressure:

```text
outbound queue grows forever
```

### gRPC Java Manual Flow Control

Dalam gRPC Java async streaming, kamu bisa menggunakan pola manual flow control dengan `ClientCallStreamObserver` / `ServerCallStreamObserver`.

Konsepnya:

- cek `isReady()` sebelum mengirim terlalu agresif;
- gunakan `setOnReadyHandler()` untuk resume;
- jangan menaruh infinite message ke observer tanpa bound;
- gunakan queue terbatas;
- handle cancellation.

Pseudo-pattern:

```java
final class StreamingSender {
    private final Queue<Event> queue = new ArrayDeque<>();
    private ServerCallStreamObserver<EventResponse> responseObserver;

    void onReady() {
        while (responseObserver.isReady() && !queue.isEmpty()) {
            Event event = queue.poll();
            responseObserver.onNext(toResponse(event));
        }
    }
}
```

Tetapi production implementation perlu:

- bounded queue;
- cancellation flag;
- error handling;
- deadline awareness;
- slow consumer policy;
- metrics;
- avoid blocking inside `onReady`.

---

## 15. Backpressure vs Flow Control

Flow control adalah mekanisme transport.

Backpressure adalah desain end-to-end.

Flow control menjawab:

```text
Can the receiver accept more bytes?
```

Backpressure menjawab:

```text
Should this producer keep producing work?
```

Contoh:

```text
Database emits 10k rows/sec
Server gRPC stream can send 2k rows/sec
Client can process 500 rows/sec
```

HTTP/2 flow control mungkin memperlambat send.

Tetapi jika server tetap membaca database dan menumpuk hasil di memory, sistem tetap rusak.

Backpressure yang benar:

```text
client slow
  -> transport not ready
  -> server stops pulling from upstream / pulls in bounded chunks
  -> upstream resource freed or slowed
```

Jadi desain streaming harus menghubungkan:

```text
transport readiness
  -> application queue
  -> upstream fetch rate
  -> database cursor / message broker consumer / file reader
```

---

## 16. Deadline

Deadline adalah batas waktu yang diberikan client untuk RPC.

Mental model:

```text
Client says:
  "I am no longer interested after time T."
```

Deadline berbeda dari low-level socket timeout.

Deadline mencakup logical RPC:

```text
queue in client
connection/stream acquisition
request send
server processing
response send
response receive
```

Jika deadline habis:

```text
client cancels call
server should stop work if possible
status becomes DEADLINE_EXCEEDED on client side
```

### Deadline Propagation

Misalnya:

```text
API Gateway receives request with 2s budget
Service A calls Service B
Service B calls Service C
```

Jika Service A memberi 2s penuh ke B, lalu B memberi 2s penuh ke C, total bisa melebihi budget caller.

Lebih benar:

```text
incoming remaining budget: 2000ms
Service A internal work: 200ms
A -> B deadline: 1500ms
B internal work: 300ms
B -> C deadline: 900ms
reserve margin: 100ms
```

### Common Mistake

Anti-pattern:

```java
blockingStub.getCase(request); // no deadline
```

Ini bisa menyebabkan:

- thread menunggu terlalu lama;
- server terus memproses request yang caller sudah tidak butuh;
- resource leak;
- overload amplification;
- shutdown lambat.

Lebih benar:

```java
blockingStub
    .withDeadlineAfter(800, TimeUnit.MILLISECONDS)
    .getCase(request);
```

Tetapi angka `800ms` harus berasal dari budget, bukan magic number.

---

## 17. Cancellation

Cancellation adalah sinyal bahwa RPC harus dihentikan.

Sumber cancellation:

- client explicit cancel;
- deadline exceeded;
- client disconnect;
- server shutdown;
- parent request cancelled;
- UI/browser/user cancelled;
- workflow step no longer relevant.

Di streaming, cancellation sangat penting.

Contoh:

```text
client closes stream
server continues reading DB and producing events
```

Itu bug.

Server handler harus menghormati cancellation.

Pseudo-pattern:

```java
public void streamCases(CaseQuery request, StreamObserver<CaseEvent> observer) {
    ServerCallStreamObserver<CaseEvent> serverObserver =
        (ServerCallStreamObserver<CaseEvent>) observer;

    AtomicBoolean cancelled = new AtomicBoolean(false);

    serverObserver.setOnCancelHandler(() -> {
        cancelled.set(true);
    });

    while (!cancelled.get()) {
        CaseEvent event = nextEventOrNull();
        if (event == null) {
            break;
        }
        observer.onNext(event);
    }

    if (!cancelled.get()) {
        observer.onCompleted();
    }
}
```

Production version harus avoid busy loop dan memperhatikan readiness/backpressure.

---

## 18. Keepalive

gRPC keepalive menggunakan HTTP/2 PING.

Tujuan:

- mendeteksi connection mati;
- menjaga connection tetap terbuka saat idle;
- menghindari latency initial RPC karena connection harus dibangun ulang;
- membantu melewati beberapa middlebox idle behavior, jika dikonfigurasi dengan benar.

Tetapi keepalive berbahaya jika terlalu agresif.

Mengapa?

```text
1000 clients
keepalive every 5 seconds
= 200 pings/sec even without traffic
```

Dengan 100k clients, ini bisa menjadi attack-like load.

### Keepalive Bukan Health Check

Keepalive menjawab:

```text
Is the HTTP/2 connection peer responsive enough to answer PING?
```

Health check menjawab:

```text
Is the service ready to handle business RPC?
```

Readiness menjawab:

```text
Should load balancer send new traffic here?
```

Application health menjawab:

```text
Can dependencies required for this operation work?
```

Jangan mencampur semuanya.

### Keepalive Bukan HTTP/1.1 Keep-Alive

Nama mirip, konsep berbeda.

```text
HTTP/1.1 keep-alive
  -> reuse TCP connection for multiple requests

gRPC/HTTP/2 keepalive
  -> PING frame to check/maintain connection liveness

TCP keepalive
  -> OS-level TCP probe, often long interval by default
```

---

## 19. GOAWAY

`GOAWAY` adalah HTTP/2 frame untuk memberi tahu bahwa connection tidak akan menerima stream baru lagi.

Bukan selalu error.

Skenario normal:

- server graceful shutdown;
- connection draining;
- deployment rolling update;
- load balancer draining;
- max connection age reached;
- server wants client to reconnect;
- protocol issue.

Mental model:

```text
Server sends GOAWAY(lastStreamId = N)

Meaning:
  streams with id <= N may have been processed
  streams with id > N were not processed on this connection
  do not create new streams here
  create/reuse another connection for new RPCs
```

### Production Interpretation

Jika melihat `GOAWAY` occasional saat deploy:

```text
normal, if client retries safe operations and drains correctly
```

Jika melihat `GOAWAY` storm:

```text
possible overload
max connection age too low
keepalive policy mismatch
LB/proxy resets
server crash/restart loop
protocol error
```

---

## 20. RST_STREAM

`RST_STREAM` menutup satu HTTP/2 stream tanpa harus menutup connection.

Skenario:

- client cancellation;
- deadline exceeded;
- server rejects stream;
- flow-control/protocol issue;
- downstream unavailable;
- application error mapped to stream reset by intermediary;
- proxy timeout.

Mental model:

```text
RST_STREAM affects one RPC stream.
GOAWAY affects connection acceptance of new streams.
TCP RST affects whole TCP connection.
```

Jangan mencampur:

```text
application cancelled RPC
  != server process down
  != TCP connection reset
```

---

## 21. Max Message Size

gRPC biasanya punya default max inbound message size.

Jika payload terlalu besar:

```text
RESOURCE_EXHAUSTED
message too large
```

Problem umum:

- mengirim report besar sebagai satu response unary;
- mengirim file sebagai satu Protobuf bytes field;
- mengirim 100k records dalam satu message;
- metadata besar;
- nested repeated fields tidak dibatasi;
- compression bomb.

Lebih baik:

```text
large payload
  -> chunked streaming RPC
  -> object storage + reference
  -> pagination
  -> server streaming
  -> resumable protocol
```

### Unary Large Payload Anti-pattern

```proto
message ExportReportResponse {
  bytes excel_file = 1;
}
```

Masalah:

- full file harus ada di memory;
- serialization allocation besar;
- GC pressure;
- max message size;
- retry mahal;
- deadline sulit;
- failure di akhir transfer membuang semua progress.

Alternatif:

```proto
message ExportReportResponse {
  string download_url = 1;
  string checksum_sha256 = 2;
  int64 size_bytes = 3;
}
```

Atau streaming chunk:

```proto
message FileChunk {
  string file_id = 1;
  int64 offset = 2;
  bytes data = 3;
  string checksum = 4;
}
```

---

## 22. Compression

gRPC mendukung compression.

Tetapi compression bukan free.

Keuntungan:

- payload lebih kecil;
- bandwidth lebih rendah;
- kadang latency lebih baik untuk WAN;
- storage/log replay lebih hemat jika payload disimpan.

Biaya:

- CPU;
- latency untuk small payload;
- memory buffer;
- complexity;
- security risk untuk beberapa konteks;
- observability payload makin sulit.

Rule:

```text
small unary payload -> biasanya tidak perlu compression
large repetitive payload -> bisa bermanfaat
streaming high-volume -> ukur CPU vs bandwidth
already compressed data -> jangan compress ulang
```

---

## 23. TLS, ALPN, dan gRPC

gRPC over HTTP/2 biasanya memakai TLS.

ALPN dipakai saat TLS handshake untuk menyepakati protocol:

```text
client offers: h2, http/1.1
server selects: h2
```

Jika ALPN gagal:

- client mungkin tidak bisa menggunakan HTTP/2;
- gRPC call gagal;
- proxy yang hanya bicara HTTP/1.1 tidak bisa meneruskan gRPC biasa;
- muncul error transport yang tidak langsung jelas.

Common issue:

```text
client -> ALB/Ingress -> backend
```

Jika edge menerima HTTP/2 tetapi upstream ke backend menggunakan HTTP/1.1, gRPC native bisa gagal kecuali gateway melakukan translation khusus.

Checklist:

- pastikan end-to-end HTTP/2 jika memakai gRPC native;
- pastikan TLS termination mendukung ALPN `h2`;
- pastikan proxy/gateway mendukung gRPC;
- bedakan gRPC native vs gRPC-Web;
- validasi dengan tool seperti `grpcurl`.

---

## 24. gRPC-Web Bukan gRPC Native

gRPC-Web ada untuk browser compatibility.

Browser tidak memberi aplikasi akses raw HTTP/2 framing seperti native gRPC.

Maka gRPC-Web biasanya membutuhkan proxy/translation layer.

Mental model:

```text
Browser client
  -> gRPC-Web over HTTP/1.1 or HTTP/2 compatible browser transport
  -> Envoy / gateway translation
  -> native gRPC over HTTP/2
  -> backend gRPC service
```

Implikasi:

- tidak semua streaming mode sama;
- metadata/trailer behavior bisa berbeda;
- error mapping bisa berubah;
- observability harus melihat gateway;
- deadline/cancellation perlu dipastikan.

---

## 25. Server-Side Execution Model

Simplified gRPC Java server model:

```text
Netty boss group
  accepts connection

Netty worker/event loop
  handles IO and HTTP/2 frames

gRPC server executor
  runs service implementation
```

Jika service implementation lambat:

- executor queue naik;
- deadline habis;
- client melihat `DEADLINE_EXCEEDED`;
- server mungkin tetap mengerjakan pekerjaan yang sudah tidak dibutuhkan;
- memory meningkat;
- p99 latency naik.

Jika event loop blocked:

- semua connection/channel yang dilayani event loop itu terdampak;
- PING terlambat;
- flow control update terlambat;
- stream event terlambat;
- banyak RPC terdampak sekaligus.

### Server Executor Harus Dianggap Resource Boundary

Anti-pattern:

```java
Server server = NettyServerBuilder
    .forPort(8443)
    .addService(new CaseService())
    .build();
```

Ini mungkin memakai default executor yang tidak sesuai dengan workload.

Production design perlu mempertimbangkan:

- jumlah concurrent RPC;
- CPU-bound vs IO-bound handler;
- blocking JDBC call;
- virtual threads;
- bounded queue;
- rejection strategy;
- per-service isolation;
- graceful shutdown;
- metrics.

---

## 26. Virtual Threads dan gRPC

Java 21+ virtual threads membuat blocking code jauh lebih scalable dari sisi thread.

Tetapi:

> Virtual threads tidak menghapus limit transport, connection, stream, CPU, memory, downstream pool, database pool, rate limit, atau deadline.

Untuk gRPC server, virtual threads bisa berguna untuk service implementation yang blocking, misalnya:

```text
gRPC handler
  -> call JDBC
  -> call another service
  -> wait for IO
```

Tetapi tetap harus ada:

- deadline;
- cancellation;
- bounded concurrency;
- database pool limit;
- downstream bulkhead;
- observability;
- overload policy.

Virtual thread tanpa limit bisa membuat sistem lebih mudah menerima terlalu banyak work sekaligus.

```text
cheap thread
  != cheap database connection
  != cheap RPC
  != cheap memory
```

---

## 27. Interceptors

gRPC interceptor mirip filter/middleware.

Dipakai untuk:

- auth;
- logging;
- tracing;
- metrics;
- deadline enforcement;
- metadata propagation;
- tenant context;
- idempotency key;
- validation;
- rate limiting.

### Risiko Interceptor

Interceptor berada di hot path.

Jangan:

- melakukan blocking remote call;
- parse payload besar;
- log full request/response sensitif;
- mengubah status sembarangan;
- swallow cancellation;
- membuat metadata tidak kompatibel;
- melakukan retry di interceptor tanpa policy jelas.

### Metadata Propagation Example

```java
public final class CorrelationClientInterceptor implements ClientInterceptor {
    private static final Metadata.Key<String> CORRELATION_ID =
        Metadata.Key.of("x-correlation-id", Metadata.ASCII_STRING_MARSHALLER);

    @Override
    public <ReqT, RespT> ClientCall<ReqT, RespT> interceptCall(
        MethodDescriptor<ReqT, RespT> method,
        CallOptions callOptions,
        Channel next
    ) {
        return new ForwardingClientCall.SimpleForwardingClientCall<>(
            next.newCall(method, callOptions)
        ) {
            @Override
            public void start(Listener<RespT> responseListener, Metadata headers) {
                headers.put(CORRELATION_ID, Correlation.currentId());
                super.start(responseListener, headers);
            }
        };
    }
}
```

Production concern:

- validate metadata size;
- avoid overwriting trusted upstream values blindly;
- know trust boundary;
- propagate trace context consistently.

---

## 28. Load Balancing and Name Resolution

gRPC client can do more than simple TCP connect.

Conceptually:

```text
target name
  -> name resolver
  -> addresses
  -> load balancer policy
  -> subchannel selection
  -> transport connection
```

Options depend on environment.

Common approaches:

1. DNS name to load balancer.
2. DNS name to multiple backend IPs.
3. xDS/service mesh control plane.
4. Kubernetes service DNS.
5. Headless service + client-side load balancing.
6. External discovery registry.

Problem:

```text
HTTP/2 long-lived connections reduce natural load redistribution.
```

If every client opens one long-lived connection to one backend via L4 behavior, load can become uneven.

Mitigations:

- client-side load balancing;
- max connection age / graceful draining;
- server-side LB with HTTP/2/gRPC awareness;
- multiple connections/channels if justified;
- xDS/service mesh;
- health-aware endpoint selection.

---

## 29. gRPC Through Load Balancers and Gateways

Not every load balancer handles gRPC equally.

Need to verify:

- HTTP/2 support from client to LB;
- HTTP/2 support from LB to target;
- gRPC health check support;
- max concurrent streams;
- idle timeout;
- request timeout;
- connection draining;
- TLS/ALPN behavior;
- header size limit;
- trailer preservation;
- error mapping;
- retry policy.

### Common Failure

```text
Client uses gRPC
LB accepts HTTP/2 at front
LB speaks HTTP/1.1 to backend
Backend expects native gRPC
Call fails
```

Another:

```text
Long streaming RPC
LB idle timeout = 60s
No message/heartbeat for 60s
LB closes connection
Client sees UNAVAILABLE / stream reset
```

Solution:

- configure appropriate idle timeout;
- send application heartbeat if stream can be idle;
- use gRPC keepalive carefully;
- configure server permit policy;
- test through the real gateway path, not only localhost.

---

## 30. Keepalive Configuration Principles

Bad config:

```text
client keepalive time = 5s
keepalive without calls = true
server minimum permitted = 5min
```

Possible outcome:

```text
server sends GOAWAY / closes transport
client sees transport is closing
random RPC failures
```

Principles:

1. Start conservative.
2. Align client and server policy.
3. Consider LB/proxy idle timeout.
4. Avoid keepalive without active calls unless justified.
5. Do not use keepalive as business health check.
6. Roll out server permit policy before aggressive client config.
7. Monitor ping counts and disconnect reason.
8. For high client count, calculate aggregate ping load.

Example conceptual config:

```java
ManagedChannel channel = NettyChannelBuilder
    .forAddress(host, port)
    .useTransportSecurity()
    .keepAliveTime(60, TimeUnit.SECONDS)
    .keepAliveTimeout(20, TimeUnit.SECONDS)
    .keepAliveWithoutCalls(false)
    .build();
```

This is not universal. It must match server/LB behavior.

Server conceptual config:

```java
Server server = NettyServerBuilder
    .forPort(8443)
    .permitKeepAliveTime(60, TimeUnit.SECONDS)
    .permitKeepAliveWithoutCalls(false)
    .build();
```

Again: choose numbers based on environment.

---

## 31. Deadline Configuration Principles

Bad:

```text
no deadline anywhere
```

Also bad:

```text
every call deadline = 30s
regardless of operation
```

Better:

| Operation | Deadline Style |
|---|---|
| get small entity | 100–500ms internal LAN, depending SLO |
| search/list | 500ms–2s depending index/pagination |
| create command | based on business SLA and side effects |
| approval workflow step | explicit workflow budget |
| streaming watch | long deadline + heartbeat + cancellation |
| batch export trigger | short command to create job, not long unary wait |

### Deadline Must Be Visible

Metrics should show:

```text
calls without deadline
calls by deadline bucket
deadline exceeded count
server observed cancellation count
work continued after cancellation
```

A mature system treats missing deadline as a bug or exception case.

---

## 32. Error Mapping at Transport Boundary

gRPC status should be intentional.

Examples:

| Situation | Better Status |
|---|---|
| invalid request field | `INVALID_ARGUMENT` |
| unauthenticated | `UNAUTHENTICATED` |
| authenticated but not allowed | `PERMISSION_DENIED` |
| case id not found | `NOT_FOUND` |
| duplicate create with unique key | `ALREADY_EXISTS` or idempotent success |
| version conflict | `ABORTED` or `FAILED_PRECONDITION` depending semantics |
| dependency temporarily unavailable | `UNAVAILABLE` |
| rate/concurrency limit | `RESOURCE_EXHAUSTED` |
| server invariant broken | `INTERNAL` |
| caller deadline expired | client sees `DEADLINE_EXCEEDED` |
| caller cancelled | `CANCELLED` |

Do not map everything to `UNKNOWN` or `INTERNAL`.

Anti-pattern:

```java
catch (Exception e) {
    responseObserver.onError(Status.UNKNOWN.asRuntimeException());
}
```

Better:

```java
catch (ValidationException e) {
    responseObserver.onError(
        Status.INVALID_ARGUMENT
            .withDescription(e.getMessage())
            .asRuntimeException()
    );
} catch (PermissionException e) {
    responseObserver.onError(
        Status.PERMISSION_DENIED
            .withDescription("not allowed")
            .asRuntimeException()
    );
} catch (DependencyUnavailableException e) {
    responseObserver.onError(
        Status.UNAVAILABLE
            .withDescription("dependency unavailable")
            .asRuntimeException()
    );
} catch (Exception e) {
    responseObserver.onError(
        Status.INTERNAL
            .withDescription("internal server error")
            .asRuntimeException()
    );
}
```

Be careful with descriptions: do not leak secrets, SQL, stack traces, internal hostnames, tokens, or PII.

---

## 33. Rich Error Details

gRPC can carry richer error details using `google.rpc.Status` and details such as:

- `BadRequest`;
- `ErrorInfo`;
- `RetryInfo`;
- `ResourceInfo`;
- `PreconditionFailure`;
- `QuotaFailure`;
- `DebugInfo` carefully, usually not exposed externally.

For regulatory/case-management systems, structured error details are useful for:

- field validation;
- workflow precondition failure;
- duplicate submission;
- conflict resolution;
- audit-friendly reason code;
- client UX mapping;
- retry-after semantics.

Example conceptual error model:

```text
status: FAILED_PRECONDITION
reason: CASE_NOT_IN_EDITABLE_STATE
domain: aceas.case
metadata:
  caseId: C-123
  currentState: SUBMITTED
  requiredState: DRAFT
```

This is better than:

```text
INTERNAL: cannot update case
```

---

## 34. Observability: What to Measure

Minimum client-side metrics:

```text
grpc_client_calls_total{service,method,status}
grpc_client_duration_seconds{service,method,status}
grpc_client_deadline_exceeded_total{service,method}
grpc_client_cancelled_total{service,method}
grpc_client_unavailable_total{service,method}
grpc_client_resource_exhausted_total{service,method}
grpc_client_inflight{service,method}
grpc_client_retry_attempts{service,method,status}
grpc_client_message_sent_bytes{service,method}
grpc_client_message_received_bytes{service,method}
```

Minimum server-side metrics:

```text
grpc_server_calls_total{service,method,status}
grpc_server_duration_seconds{service,method,status}
grpc_server_inflight{service,method}
grpc_server_cancelled_total{service,method}
grpc_server_deadline_exceeded_total{service,method}
grpc_server_message_received_bytes{service,method}
grpc_server_message_sent_bytes{service,method}
grpc_server_executor_queue_depth
grpc_server_executor_active_threads
```

Transport metrics if available:

```text
channel_state
active_streams
max_concurrent_streams
pending_streams
connection_count
goaway_count
rst_stream_count
keepalive_ping_sent
keepalive_ping_timeout
flow_control_stall_time
netty_event_loop_pending_tasks
netty_event_loop_blocked_time
```

Logs should include:

```text
trace_id
span_id
correlation_id
service
method
grpc_status
deadline_ms
elapsed_ms
peer
authority
target
attempt
cancellation_reason
```

Do not log full Protobuf payload by default.

---

## 35. Tracing

A gRPC call should produce spans like:

```text
client span: CaseService/GetCase
  attributes:
    rpc.system=grpc
    rpc.service=CaseService
    rpc.method=GetCase
    server.address=...
    server.port=...
    rpc.grpc.status_code=OK

server span: CaseService/GetCase
  attributes:
    rpc.system=grpc
    rpc.service=CaseService
    rpc.method=GetCase
    rpc.grpc.status_code=OK
```

Trace context usually propagates via metadata.

Important:

- client interceptor injects context;
- server interceptor extracts context;
- async execution must preserve context;
- virtual threads need deliberate context handling;
- do not create new root traces accidentally;
- do not trust external trace headers across security boundary without policy.

---

## 36. Debugging Tools

Useful tools:

```text
grpcurl
openssl s_client
curl --http2
nghttp2 tools
Wireshark
ss / netstat
lsof
jcmd / jstack
JFR
OpenTelemetry traces
proxy/LB access logs
Envoy admin endpoints
Kubernetes events/logs
```

Examples:

```bash
grpcurl -plaintext localhost:8080 list
```

```bash
grpcurl \
  -H 'authorization: Bearer TOKEN' \
  -d '{"caseId":"C-123"}' \
  service.example.internal:443 \
  aceas.case.CaseService/GetCase
```

Check TLS/ALPN:

```bash
openssl s_client \
  -connect service.example.internal:443 \
  -alpn h2 \
  -servername service.example.internal
```

Check HTTP/2 from curl where applicable:

```bash
curl -v --http2 https://service.example.internal/health
```

Remember: regular curl cannot call native gRPC easily because of gRPC framing and trailers; use `grpcurl` for actual gRPC.

---

## 37. Production Failure Catalogue

### 37.1 `DEADLINE_EXCEEDED` Everywhere

Possible causes:

- downstream slow;
- deadline too low;
- client queueing before stream sent;
- max concurrent streams reached;
- server executor saturated;
- Netty event loop blocked;
- flow-control stall;
- proxy buffering/timeout;
- network packet loss;
- retry storm.

Diagnostic questions:

```text
Did server receive the call?
Did server finish after client deadline?
Was request queued client-side?
Was active stream limit reached?
Was server executor saturated?
Was deadline propagated from parent?
Are there retries multiplying load?
```

### 37.2 `UNAVAILABLE: io exception`

Possible causes:

- server down;
- DNS wrong;
- TCP connection failed;
- TLS failed;
- ALPN failed;
- LB closed connection;
- proxy reset;
- GOAWAY/draining;
- keepalive policy mismatch;
- connection idle timeout;
- network partition.

Diagnostic questions:

```text
Is it per backend or global?
Did it align with deployment?
Any GOAWAY spike?
Any TLS handshake failures?
Any LB target health change?
Any DNS change?
Any keepalive config recently changed?
```

### 37.3 `RESOURCE_EXHAUSTED`

Possible causes:

- max message size exceeded;
- metadata too large;
- quota/rate limit;
- server concurrency limit;
- flow-control/memory protection;
- proxy buffer/header limit.

Diagnostic questions:

```text
Is payload size larger than normal?
Did a client version start sending large metadata?
Is this domain quota or transport quota?
Is the status produced by server, proxy, or client runtime?
```

### 37.4 `UNKNOWN: transport is closing`

Possible causes:

- connection closed unexpectedly;
- keepalive violation;
- server shutdown without graceful draining;
- proxy/LB reset;
- protocol error;
- Netty exception;
- TLS close_notify behavior;
- client tried to use closing transport.

Diagnostic questions:

```text
Was there a preceding GOAWAY?
Was server rolling?
Any keepalive mismatch?
Any connection age policy?
Any event loop exception?
```

### 37.5 Streaming Memory Leak

Symptoms:

```text
heap grows
GC pressure
server OOM
few clients with slow network
long-lived streams
```

Likely causes:

- unbounded outbound queue;
- ignoring `isReady()`;
- reading upstream faster than transport can send;
- no cancellation handler;
- no per-client limit;
- no heartbeat/timeout;
- no stream max duration.

---

## 38. gRPC Production Configuration Checklist

Client:

```text
[ ] Channel reused
[ ] Stub reused or cheaply derived from channel
[ ] Deadline configured per operation
[ ] Retry policy explicit and safe
[ ] Idempotency strategy for mutating calls
[ ] Keepalive conservative and aligned with server/LB
[ ] Metadata size controlled
[ ] Auth token refresh controlled
[ ] Max inbound message size intentional
[ ] Compression intentional
[ ] TLS/ALPN verified
[ ] Observability interceptors installed
[ ] Graceful channel shutdown implemented
[ ] Separate channels for very different workload classes if needed
```

Server:

```text
[ ] Executor model explicit
[ ] Blocking work off event loop
[ ] Deadlines/cancellations observed
[ ] Streaming flow control respected
[ ] Bounded queues
[ ] Max inbound message size intentional
[ ] Metadata/header limits understood
[ ] Keepalive permit policy aligned
[ ] Graceful shutdown and GOAWAY draining tested
[ ] Health service implemented
[ ] Reflection controlled by environment/security policy
[ ] Status code mapping intentional
[ ] Sensitive errors sanitized
[ ] Metrics/tracing/logging installed
```

Gateway/LB:

```text
[ ] End-to-end HTTP/2 support verified
[ ] ALPN h2 verified
[ ] gRPC trailers preserved
[ ] Idle timeout compatible with streams
[ ] Request timeout compatible with deadlines
[ ] Max concurrent streams known
[ ] Header size limit known
[ ] Health check protocol configured
[ ] Connection draining tested
[ ] Retry policy not multiplying client retry
[ ] Error mapping understood
```

---

## 39. Design Pattern: gRPC Client Wrapper

A production gRPC client wrapper should centralize:

- channel lifecycle;
- deadline policy;
- metadata injection;
- tracing;
- metrics;
- safe retry/idempotency;
- error mapping;
- graceful shutdown.

Example conceptual wrapper:

```java
public final class CaseGrpcGateway implements AutoCloseable {
    private final ManagedChannel channel;
    private final CaseServiceGrpc.CaseServiceBlockingStub blocking;

    public CaseGrpcGateway(String host, int port) {
        this.channel = NettyChannelBuilder
            .forAddress(host, port)
            .useTransportSecurity()
            .keepAliveTime(60, TimeUnit.SECONDS)
            .keepAliveTimeout(20, TimeUnit.SECONDS)
            .keepAliveWithoutCalls(false)
            .intercept(new CorrelationClientInterceptor())
            .build();

        this.blocking = CaseServiceGrpc.newBlockingStub(channel);
    }

    public CaseView getCase(String caseId, RequestContext ctx) {
        CaseRequest request = CaseRequest.newBuilder()
            .setCaseId(caseId)
            .build();

        try {
            CaseResponse response = blocking
                .withDeadlineAfter(ctx.remainingBudgetMillis(), TimeUnit.MILLISECONDS)
                .getCase(request);

            return map(response);
        } catch (StatusRuntimeException e) {
            throw mapGrpcError(e);
        }
    }

    @Override
    public void close() throws InterruptedException {
        channel.shutdown();
        if (!channel.awaitTermination(10, TimeUnit.SECONDS)) {
            channel.shutdownNow();
        }
    }
}
```

Notes:

- `ctx.remainingBudgetMillis()` should be derived from parent deadline.
- `mapGrpcError` should preserve semantic status.
- Keepalive numbers are examples, not universal defaults.
- Long-running streaming should likely use a different wrapper/config.

---

## 40. Design Pattern: Server Cancellation-Aware Handler

Bad:

```java
@Override
public void exportCases(ExportRequest request, StreamObserver<ExportChunk> observer) {
    List<CaseRow> rows = repository.findAll(request); // huge

    for (CaseRow row : rows) {
        observer.onNext(toChunk(row));
    }

    observer.onCompleted();
}
```

Problems:

- loads all rows;
- ignores cancellation;
- ignores backpressure;
- may continue after client disconnect;
- memory heavy;
- no chunk boundary strategy.

Better conceptual approach:

```java
@Override
public void exportCases(ExportRequest request, StreamObserver<ExportChunk> observer) {
    ServerCallStreamObserver<ExportChunk> out =
        (ServerCallStreamObserver<ExportChunk>) observer;

    AtomicBoolean cancelled = new AtomicBoolean(false);
    out.setOnCancelHandler(() -> cancelled.set(true));

    ExportCursor cursor = repository.openCursor(request);

    out.setOnReadyHandler(() -> {
        try {
            while (out.isReady() && !cancelled.get()) {
                Optional<CaseRow> next = cursor.next();
                if (next.isEmpty()) {
                    cursor.close();
                    out.onCompleted();
                    return;
                }

                out.onNext(toChunk(next.get()));
            }
        } catch (Exception e) {
            cursor.close();
            out.onError(Status.INTERNAL
                .withDescription("export failed")
                .asRuntimeException());
        }
    });
}
```

Production implementation still needs:

- thread-safety;
- executor strategy;
- cursor timeout;
- audit status;
- resumability;
- max duration;
- metrics;
- cancellation cleanup.

---

## 41. Regulatory / Case Management Lens

Dalam sistem enforcement/case management, gRPC transport internals penting karena operasi sering punya karakteristik:

```text
stateful workflow
case lifecycle
approval chain
auditability
identity propagation
authorization-sensitive metadata
long-running export
document processing
external agency integration
strict timeout/retry semantics
must avoid duplicate side effects
```

Contoh operasi:

```text
SubmitCase
ApproveCase
AssignOfficer
GenerateNotice
SyncExternalAgencyStatus
StreamCaseEvents
ExportInvestigationBundle
```

Mapping transport-aware:

| Operation | gRPC Shape | Critical Transport Concern |
|---|---|---|
| `GetCase` | Unary | low deadline, auth metadata, small payload |
| `SubmitCase` | Unary command | idempotency key, deadline, duplicate suppression |
| `StreamCaseEvents` | Server streaming | heartbeat, resume token, slow consumer |
| `UploadEvidence` | Client streaming | chunk size, checksum, cancellation |
| `ReviewLiveSession` | Bidi streaming | ordering, flow control, reconnect |
| `ExportBundle` | Async job or server streaming | avoid huge unary response |

Transport design affects legal defensibility.

Example:

```text
Client deadline exceeded after SubmitCase.
Server may still have committed the submission.
```

If client blindly retries without idempotency key:

```text
duplicate submission
conflicting audit records
incorrect workflow state
```

So Part 22 connects directly to domain correctness.

---

## 42. Anti-Patterns

### 42.1 Channel per Request

Bad for latency and resource usage.

### 42.2 No Deadline

Allows indefinite resource consumption.

### 42.3 Retry All `UNAVAILABLE` Without Idempotency

Can duplicate mutating operations.

### 42.4 Treat HTTP 200 as Success

gRPC success is `grpc-status=OK`.

### 42.5 Ignore Trailers

Loses actual gRPC status and error details.

### 42.6 Huge Unary Payload

Causes memory, GC, max message, and retry problems.

### 42.7 Aggressive Keepalive Everywhere

Can create unnecessary traffic and random transport closure if server policy disagrees.

### 42.8 Blocking Netty Event Loop

Causes systemic latency spikes.

### 42.9 Unbounded Streaming Queue

Slow clients become memory leaks.

### 42.10 Missing Cancellation Handling

Server keeps doing useless work after client has gone away.

---

## 43. Review Questions

1. Apa bedanya gRPC call, HTTP/2 stream, dan TCP connection?
2. Kenapa HTTP status `200` belum tentu berarti gRPC call sukses?
3. Di mana `grpc-status` biasanya dikirim?
4. Apa fungsi trailers dalam gRPC?
5. Kenapa channel harus direuse?
6. Apa risiko channel per request?
7. Apa itu HTTP/2 `GOAWAY`?
8. Apa bedanya `GOAWAY`, `RST_STREAM`, dan TCP RST?
9. Kenapa HTTP/2 multiplexing tidak berarti infinite concurrency?
10. Apa perbedaan flow control dan backpressure?
11. Kenapa streaming gRPC perlu bounded queue?
12. Apa perbedaan deadline dan keepalive?
13. Kenapa keepalive terlalu agresif berbahaya?
14. Kenapa cancellation harus diteruskan ke application handler?
15. Apa saja metric minimal untuk gRPC production?

---

## 44. Practical Exercises

### Exercise 1 — Draw Your gRPC Call Path

Ambil satu gRPC call nyata atau hipotetis:

```text
CaseService/GetCase
```

Gambar path:

```text
Application
-> Stub
-> Channel
-> Name resolver
-> Load balancer
-> HTTP/2 stream
-> TLS
-> LB/Gateway
-> Server transport
-> Server executor
-> Handler
-> DB/downstream
```

Untuk setiap layer, tulis:

- failure yang mungkin;
- timeout/deadline yang relevan;
- metric yang harus ada.

### Exercise 2 — Classify Errors

Untuk setiap error berikut, klasifikasikan kemungkinan layer:

```text
DEADLINE_EXCEEDED
UNAVAILABLE: io exception
RESOURCE_EXHAUSTED: message too large
UNKNOWN: transport is closing
CANCELLED
INTERNAL
RST_STREAM
GOAWAY
```

### Exercise 3 — Streaming Backpressure Design

Desain server-streaming API:

```proto
rpc StreamCaseEvents(StreamCaseEventsRequest) returns (stream CaseEvent);
```

Tentukan:

- heartbeat interval;
- resume token;
- max stream duration;
- slow consumer policy;
- authorization refresh policy;
- cancellation handling;
- event ordering semantics;
- metrics.

### Exercise 4 — Deadline Budget

Parent request punya 2 detik budget.

Service A perlu:

- validate request;
- call Service B;
- call Service C;
- persist audit;
- return response.

Buat pembagian deadline yang masuk akal.

### Exercise 5 — Production Readiness Review

Review konfigurasi gRPC service:

```text
no deadline
channel per request
keepalive 5s without calls
unary response up to 100MB
no cancellation handling
all exceptions mapped to UNKNOWN
no grpc-status metric
```

Tulis risiko dan perbaikannya.

---

## 45. Summary Mental Model

gRPC production engineering bukan hanya tentang `.proto` dan generated stub.

gRPC adalah runtime berlapis:

```text
RPC semantics
  -> Protobuf message
  -> gRPC framing
  -> metadata/trailers/status
  -> HTTP/2 stream
  -> HTTP/2 connection
  -> Netty event loop
  -> TLS/ALPN
  -> TCP
  -> proxy/LB/mesh
  -> server executor
  -> application handler
```

Top 1% engineer memahami bahwa:

1. gRPC call adalah distributed attempt dengan lifecycle transport.
2. Channel reuse adalah default yang benar.
3. HTTP/2 multiplexing membantu, tetapi tidak menghapus limit stream/connection.
4. Deadline adalah resource control utama.
5. Cancellation harus menghentikan work yang tidak dibutuhkan.
6. Flow control bukan pengganti application backpressure.
7. Keepalive harus selaras dengan server/LB policy.
8. Metadata harus kecil, aman, dan intentional.
9. Status code harus semantic, bukan semua `UNKNOWN`.
10. Observability harus melihat gRPC status, transport state, stream behavior, dan executor saturation.

Jika kamu bisa membaca error gRPC dan langsung memetakannya ke lapisan transport, resource, protocol, atau domain semantics, kamu sudah naik jauh dari sekadar “user of gRPC” menjadi “network systems engineer”.

---

## 46. Referensi

- gRPC Core Concepts — https://grpc.io/docs/what-is-grpc/core-concepts/
- gRPC over HTTP/2 Protocol — https://grpc.github.io/grpc/core/md_doc__p_r_o_t_o_c_o_l-_h_t_t_p2.html
- gRPC Metadata Guide — https://grpc.io/docs/guides/metadata/
- gRPC Deadlines Guide — https://grpc.io/docs/guides/deadlines/
- gRPC Flow Control Guide — https://grpc.io/docs/guides/flow-control/
- gRPC Keepalive Guide — https://grpc.io/docs/guides/keepalive/
- gRPC Status Codes — https://grpc.io/docs/guides/status-codes/
- gRPC Performance Best Practices — https://grpc.io/docs/guides/performance/
- gRPC Java Javadocs — https://grpc.github.io/grpc-java/javadoc/
- RFC 9113 — HTTP/2 — https://www.rfc-editor.org/rfc/rfc9113.html
- Netty Documentation — https://netty.io/wiki/

---

## 47. Status Seri

```text
Part 22 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 23 — gRPC Error Handling, Retry, Load Balancing, Name Resolution, and Service Config
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 21 — gRPC Fundamentals: RPC Model, Protobuf Contract, Stub, Channel, Server, and Service Definition](./021-grpc-fundamentals-rpc-model-protobuf-contract-stub-channel-server-service-definition.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 23 — gRPC Error Handling, Retry, Load Balancing, Name Resolution, and Service Config](./023-grpc-error-handling-retry-load-balancing-name-resolution-service-config.md)

</div>