# Part 24 — gRPC Streaming and Backpressure: Designing High-Volume Bidirectional Systems

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `024-grpc-streaming-and-backpressure-designing-high-volume-bidirectional-systems.md`  
Java target: Java 8–25  
Level: Advanced / production engineering

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita sudah membahas:

- gRPC sebagai RPC model.
- `.proto` sebagai contract.
- stub, channel, server, metadata, status, deadline.
- gRPC di atas HTTP/2.
- Netty transport, stream, flow control, keepalive, GOAWAY, RST_STREAM.
- retry, hedging, load balancing, name resolution, dan service config.

Part ini masuk ke area yang lebih tajam: **gRPC streaming**.

Streaming adalah salah satu alasan utama orang memilih gRPC. Tetapi streaming juga salah satu area paling sering disalahdesain karena engineer memperlakukannya seperti:

```text
for each item:
    observer.onNext(item)
```

Padahal secara production, stream adalah kombinasi dari:

```text
long-lived RPC
+ HTTP/2 stream
+ application protocol
+ producer/consumer coordination
+ memory pressure boundary
+ cancellation contract
+ deadline contract
+ flow control
+ ordering semantics
+ recovery/resume strategy
+ operational visibility
```

Sebuah stream bukan sekadar “banyak response dalam satu koneksi”. Stream adalah **distributed pipeline**.

Jika pipeline itu tidak punya bounded queue, cancellation propagation, manual flow control, dan failure semantics, maka stream yang awalnya dibuat untuk efisiensi justru bisa menjadi sumber:

- out-of-memory;
- event loop blockage;
- stuck stream;
- hidden queueing;
- tail latency ekstrem;
- duplicate processing;
- broken ordering;
- memory leak;
- server resource exhaustion;
- audit inconsistency;
- client reconnect storm.

---

## 1. Learning Objectives

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami perbedaan unary, server streaming, client streaming, dan bidirectional streaming dari sisi lifecycle dan resource.
2. Mendesain stream sebagai pipeline dengan boundary yang eksplisit.
3. Membedakan **transport flow control** dan **application backpressure**.
4. Menggunakan mental model `StreamObserver`, `ClientCallStreamObserver`, dan `ServerCallStreamObserver` secara aman.
5. Mendesain bounded buffering agar producer cepat tidak menghancurkan consumer lambat.
6. Menentukan kapan perlu manual inbound flow control.
7. Mendesain chunking untuk transfer besar.
8. Mendesain resumable stream dengan cursor/checkpoint.
9. Memahami cancellation, deadline, half-close, completion, dan error termination.
10. Membuat error model untuk stream panjang.
11. Mendesain stream yang observable: metrics, logs, traces, stream id, item count, lag, queue depth.
12. Menghindari anti-pattern umum seperti unbounded `onNext`, blocking event loop, dan stream tanpa heartbeat.
13. Menghubungkan stream gRPC dengan domain workflow seperti enforcement case update, progress reporting, notification, audit export, dan bulk ingestion.

---

## 2. Core Thesis

Mental model utama:

```text
A gRPC stream is not a loop.
A gRPC stream is a distributed stateful pipeline.
```

Loop berpikir seperti ini:

```java
for (Item item : items) {
    observer.onNext(toResponse(item));
}
observer.onCompleted();
```

Pipeline berpikir seperti ini:

```text
source
-> serialization
-> outbound application queue
-> gRPC observer
-> HTTP/2 stream window
-> TCP socket
-> network
-> peer HTTP/2 stream window
-> peer inbound queue
-> application handler
-> acknowledgement / checkpoint / side effect
```

Di loop, masalah utama adalah “bagaimana mengirim semua item”.

Di pipeline, masalah utama adalah:

```text
berapa cepat producer menghasilkan item?
berapa cepat consumer bisa memproses item?
di mana buffer berada?
berapa batas buffer?
apa yang terjadi jika buffer penuh?
apakah item boleh hilang?
apakah item boleh dikirim ulang?
apakah urutan penting?
bagaimana jika stream putus di item ke-70.321?
bagaimana cara resume?
bagaimana cancellation menghentikan upstream work?
```

Top 1% engineer tidak berhenti di “gRPC supports streaming”. Mereka bertanya: **apa kontrak stream-nya?**

---

## 3. Four gRPC RPC Shapes Revisited

gRPC punya empat bentuk method:

```proto
service ExampleService {
  rpc Unary(Request) returns (Response);
  rpc ServerStream(Request) returns (stream Response);
  rpc ClientStream(stream Request) returns (Response);
  rpc BidiStream(stream Request) returns (stream Response);
}
```

Kita revisi maknanya dari sisi production.

---

## 4. Unary RPC

Unary adalah:

```text
one request -> one response
```

Cocok untuk:

- command kecil;
- query kecil;
- validation;
- lookup;
- state transition;
- authorization check;
- metadata fetch.

Resource shape:

```text
request memory bounded by request size
response memory bounded by response size
time bounded by deadline
lifecycle simple
retry easier if idempotent
```

Jika payload menjadi sangat besar, banyak engineer tergoda menaikkan `maxInboundMessageSize`. Itu kadang benar, tetapi sering menjadi bau desain.

Jika data besar bisa dipecah secara natural, streaming bisa lebih aman.

---

## 5. Server Streaming

Server streaming adalah:

```text
one request -> many responses
```

Contoh:

```proto
rpc WatchCaseUpdates(WatchCaseRequest) returns (stream CaseUpdateEvent);
rpc ExportAuditTrail(ExportAuditTrailRequest) returns (stream AuditTrailChunk);
rpc ListLargeReport(ReportRequest) returns (stream ReportRow);
```

Cocok untuk:

- push update dari server ke client;
- export data besar;
- progress event;
- notification feed;
- query result besar;
- tailing log/event;
- live dashboard.

Risiko utama:

```text
client slow
server sends too fast
server accumulates memory
connection stays open too long
client disconnect not detected quickly
load balancer idle timeout
authorization changes while stream remains open
```

---

## 6. Client Streaming

Client streaming adalah:

```text
many requests -> one response
```

Contoh:

```proto
rpc UploadEvidence(stream EvidenceChunk) returns (UploadSummary);
rpc BulkSubmitApplications(stream ApplicationSubmission) returns (BulkSubmitResult);
rpc IngestAuditEvents(stream AuditEvent) returns (IngestResult);
```

Cocok untuk:

- upload besar;
- ingestion batch;
- client-side aggregation;
- telemetry upload;
- bulk command;
- file transfer chunked.

Risiko utama:

```text
server overwhelmed by fast client
unbounded request buffering
partial ingestion ambiguity
client does not half-close
server cannot produce final response until client completes
retry can duplicate data
```

---

## 7. Bidirectional Streaming

Bidirectional streaming adalah:

```text
many requests <-> many responses
```

Contoh:

```proto
rpc ProcessCases(stream CaseWorkItem) returns (stream CaseWorkResult);
rpc SyncCaseEvents(stream SyncRequest) returns (stream SyncResponse);
rpc RealtimeReviewSession(stream ReviewClientEvent) returns (stream ReviewServerEvent);
```

Cocok untuk:

- real-time collaboration;
- bidirectional sync;
- worker protocol;
- request/result pipeline;
- long-lived session;
- interactive command channel.

Risiko utama:

```text
protocol complexity explodes
ordering becomes subtle
both sides can overwhelm each other
error termination can be ambiguous
resumption is harder
state machine must be explicit
```

Jika unary adalah method call, bidi stream lebih mirip **custom protocol di atas gRPC**.

---

## 8. Streaming Is Not Always Better

Streaming sering dipilih karena terdengar advanced. Itu asumsi lemah.

Gunakan streaming jika:

```text
payload terlalu besar untuk satu message
atau data tersedia bertahap
atau flow bersifat long-lived
atau latency per item penting
atau perlu menghindari repeated RPC setup
atau perlu full-duplex coordination
```

Jangan gunakan streaming jika:

```text
operasi sebenarnya satu command kecil
client/server tidak butuh progressive result
failure recovery belum dirancang
consumer tidak mampu handle long-lived connection
observability belum siap
load balancer/gateway tidak support stream dengan benar
```

Rule of thumb:

```text
Streaming reduces call setup overhead,
but increases lifecycle complexity.
```

---

## 9. The Stream Lifecycle Model

Sebuah stream punya lifecycle:

```text
1. call created
2. metadata sent
3. messages exchanged
4. half-close may occur
5. completion / error / cancellation
6. resources released
```

Untuk server streaming:

```text
client sends request
client half closes request side automatically
server sends zero or more response messages
server completes or errors
client receives terminal status
```

Untuk client streaming:

```text
client sends zero or more request messages
client calls onCompleted() to half-close
server processes aggregate
server sends one response
server completes or errors
```

Untuk bidi:

```text
client and server can send independently
client may half-close request side
server may continue responding
server completes final status
```

Kesalahan umum:

- tidak memanggil `onCompleted()` pada client streaming;
- menganggap `onNext()` selalu langsung terkirim ke network;
- mengirim setelah `onError()` atau `onCompleted()`;
- tidak menghentikan upstream task setelah cancellation;
- menutup stream terlalu cepat sebelum worker selesai;
- tidak menyinkronkan multiple writer ke observer.

---

## 10. StreamObserver Mental Model

Di gRPC Java, aplikasi biasanya berinteraksi dengan `StreamObserver<T>`.

Metode utamanya:

```java
void onNext(T value);
void onError(Throwable t);
void onCompleted();
```

Kontrak mental:

```text
onNext      -> send or receive next message
onError     -> terminal failure
onCompleted -> terminal success / half-close depending side
```

Setelah terminal event:

```text
onError or onCompleted
-> no more onNext
-> no more terminal event
```

`StreamObserver` terlihat sederhana, tetapi jangan salah: ini bukan queue biasa.

Hal penting:

```text
StreamObserver implementation is generally not required to be thread-safe.
If multiple threads write to one observer, application must serialize access.
```

Konsekuensinya:

```text
multiple worker threads calling responseObserver.onNext()
= race condition / interleaving / broken order / undefined behavior risk
```

Pattern aman:

```text
one writer per observer
or synchronized wrapper
or single event loop / single dispatcher
or ordered queue drained by one sender
```

---

## 11. Thread Safety and Single Writer Discipline

Anti-pattern:

```java
items.parallelStream().forEach(item -> {
    responseObserver.onNext(toResponse(item));
});
responseObserver.onCompleted();
```

Masalah:

- `onNext()` concurrent;
- ordering tidak deterministic;
- `onCompleted()` bisa terjadi sebelum semua `onNext()` selesai;
- error dari salah satu worker sulit di-coordinate;
- backpressure diabaikan.

Pattern lebih sehat:

```text
parallel workers
-> bounded result queue
-> single sender loop
-> responseObserver.onNext() serially
-> onCompleted() after all workers done and queue drained
```

Pseudo-design:

```text
producer threads produce Response
bounded queue stores Response
sender thread drains queue if stream is ready
terminal coordinator decides completed/error
```

Tetapi bounded queue harus benar-benar bounded. Kalau tidak, masalah hanya pindah dari gRPC buffer ke application heap.

---

## 12. Flow Control vs Backpressure

Ini konsep paling penting.

### 12.1 Transport Flow Control

Transport flow control adalah mekanisme di level gRPC/HTTP/2 untuk mencegah receiver dibanjiri data di transport buffer.

gRPC documentation menjelaskan flow control sebagai mekanisme agar receiver tidak kewalahan oleh sender cepat; flow control berlaku pada streaming RPC, bukan unary RPC. Secara default gRPC menangani flow control, meski beberapa bahasa/implementation memungkinkan kontrol manual. gRPC streaming flow control dibangun di atas HTTP/2 flow-control semantics. Lihat referensi resmi: gRPC Flow Control dan HTTP/2 semantics.  
References: https://grpc.io/docs/guides/flow-control/ dan RFC 9113.

### 12.2 Application Backpressure

Application backpressure adalah mekanisme di level aplikasi untuk mengontrol produksi data berdasarkan kapasitas consumer.

Contoh:

```text
DB cursor reads 10,000 rows/s
client can consume 500 rows/s
```

Transport flow control mungkin menghentikan penulisan ke socket, tetapi kalau aplikasi tetap membaca DB dan menaruh ke memory queue, heap tetap meledak.

Backpressure harus mencapai source:

```text
client slow
-> gRPC not ready
-> sender stop sending
-> application queue stops growing
-> DB cursor pauses / producer throttles
```

Jika backpressure berhenti di gRPC buffer, belum cukup.

---

## 13. The Dangerous Illusion of onNext

Banyak engineer mengira:

```java
responseObserver.onNext(message);
```

berarti:

```text
message has been delivered to the peer application
```

Itu salah.

Lebih akurat:

```text
application submitted message to gRPC layer
```

Message bisa masih berada di:

```text
application object
serialized buffer
gRPC outbound queue
HTTP/2 stream buffer
Netty outbound buffer
kernel socket buffer
network
peer receive buffer
peer inbound gRPC queue
peer application callback queue
```

Maka `onNext()` bukan acknowledgement dari peer.

Jika domain butuh acknowledgement, kamu harus mendesain application-level ack.

Contoh:

```proto
message WorkItem {
  string item_id = 1;
  int64 sequence = 2;
  bytes payload = 3;
}

message WorkAck {
  string item_id = 1;
  int64 sequence = 2;
  AckStatus status = 3;
}

service WorkerService {
  rpc Work(stream WorkItem) returns (stream WorkAck);
}
```

---

## 14. `CallStreamObserver`, `isReady`, and `onReadyHandler`

gRPC Java menyediakan observer yang lebih rendah levelnya untuk mengamati readiness.

Konsep penting:

```text
isReady() tells whether outbound buffer has capacity.
onReadyHandler runs when the stream becomes ready to send more.
```

`ClientCallStreamObserver` dan `ServerCallStreamObserver` adalah refinement dari `CallStreamObserver`. Dokumentasi gRPC Java menekankan bahwa seperti `StreamObserver`, implementation tidak wajib thread-safe; jika multiple threads menulis secara concurrent, aplikasi harus melakukan synchronization. Referensi: gRPC Java Javadoc `ClientCallStreamObserver`.  
Reference: https://grpc.github.io/grpc-java/javadoc/io/grpc/stub/ClientCallStreamObserver.html

Mental model:

```text
isReady() == true
  means: okay to submit more outbound messages now

isReady() == false
  means: stop producing/sending; wait for onReadyHandler
```

Tetapi hati-hati:

```text
isReady() is not a promise that all future sends are safe forever.
It is a moment-in-time signal.
```

Setelah satu `onNext()`, `isReady()` bisa berubah menjadi false.

---

## 15. Manual Outbound Flow Control Pattern

Untuk server streaming:

```java
@Override
public void export(ExportRequest request, StreamObserver<ExportChunk> responseObserver) {
    ServerCallStreamObserver<ExportChunk> serverObserver =
        (ServerCallStreamObserver<ExportChunk>) responseObserver;

    AtomicBoolean completed = new AtomicBoolean(false);
    Iterator<ExportChunk> iterator = openChunkIterator(request);

    serverObserver.setOnCancelHandler(() -> {
        completed.set(true);
        closeIteratorQuietly(iterator);
    });

    serverObserver.setOnReadyHandler(() -> {
        while (serverObserver.isReady() && !completed.get()) {
            if (!iterator.hasNext()) {
                completed.set(true);
                serverObserver.onCompleted();
                closeIteratorQuietly(iterator);
                return;
            }

            ExportChunk next = iterator.next();
            serverObserver.onNext(next);
        }
    });
}
```

Catatan:

- Ini ilustrasi, bukan copy-paste final.
- Harus hati-hati dengan thread yang memanggil handler.
- Jangan melakukan blocking DB read berat di event loop atau thread callback jika transport/runtime tidak aman untuk itu.
- Untuk source blocking, gunakan worker yang bounded dan dispatch yang terkendali.

Inti pattern:

```text
only produce or fetch when stream is ready
stop when cancelled
complete exactly once
release resource exactly once
```

---

## 16. Manual Inbound Flow Control Pattern

Pada streaming inbound, masalahnya adalah receiver dibanjiri message.

Contoh client streaming:

```proto
rpc IngestEvents(stream AuditEvent) returns (IngestSummary);
```

Jika server memproses event lambat, tetapi client mengirim cepat, server bisa menumpuk message.

Manual inbound flow control berarti receiver meminta message berikutnya hanya ketika siap.

Pattern konseptual:

```text
onNext(event)
-> process event async/bounded
-> after done, request(1) next message
```

Di gRPC Java, kontrol inbound lebih rendah levelnya tersedia melalui observer tertentu seperti `ServerCallStreamObserver.disableAutoInboundFlowControl()` dan `request(n)` tergantung API/side yang digunakan.

Pseudo-code:

```java
@Override
public StreamObserver<AuditEvent> ingest(StreamObserver<IngestSummary> responseObserver) {
    ServerCallStreamObserver<IngestSummary> serverObserver =
        (ServerCallStreamObserver<IngestSummary>) responseObserver;

    serverObserver.disableAutoInboundFlowControl();

    return new StreamObserver<>() {
        private int processed = 0;
        private boolean failed = false;

        @Override
        public void onNext(AuditEvent event) {
            processOne(event)
                .whenComplete((ignored, error) -> {
                    if (error != null) {
                        failed = true;
                        responseObserver.onError(toStatus(error).asRuntimeException());
                        return;
                    }

                    processed++;
                    if (!failed) {
                        serverObserver.request(1);
                    }
                });
        }

        @Override
        public void onError(Throwable t) {
            cleanup();
        }

        @Override
        public void onCompleted() {
            responseObserver.onNext(IngestSummary.newBuilder()
                .setProcessed(processed)
                .build());
            responseObserver.onCompleted();
        }
    };
}
```

Catatan penting:

- API exact bisa berbeda tergantung versi dan sisi observer.
- Pattern-nya yang penting: **do not accept unlimited inbound work**.
- Pastikan concurrency dan terminal event dikelola dengan benar.

---

## 17. Bounded Queue as a Safety Boundary

Jika kamu butuh decoupling antara producer dan sender, gunakan bounded queue.

```text
producer -> bounded queue -> single sender -> gRPC stream
```

Queue harus punya policy ketika penuh:

1. Block producer.
2. Drop oldest.
3. Drop latest.
4. Fail stream.
5. Slow source.
6. Spill to disk.
7. Return `RESOURCE_EXHAUSTED`.

Tidak ada policy universal.

Untuk data audit/compliance:

```text
drop is usually unacceptable
fail or persist/spill is safer
```

Untuk live notification:

```text
drop old update may be acceptable if client can refresh snapshot
```

Untuk progress update:

```text
coalesce may be better than queue every event
```

Contoh coalescing:

```text
Progress 1%, 2%, 3%, 4%, 5%
slow client
send only latest 5%
```

Contoh tidak boleh coalescing:

```text
Audit event A, B, C, D
all must be delivered/persisted
```

---

## 18. Stream Contract: Delivery Semantics

Untuk setiap stream, tentukan delivery semantics.

Pilihan umum:

```text
at-most-once
at-least-once
exactly-once illusion
effectively-once business effect
best-effort live update
snapshot + delta
ordered stream
unordered stream
partition-ordered stream
```

### 18.1 At-Most-Once

```text
message may be lost
message is not duplicated
```

Cocok untuk:

- live progress;
- telemetry non-critical;
- UI notification yang bisa refresh.

### 18.2 At-Least-Once

```text
message will be retried/resumed
message may be duplicated
consumer must deduplicate
```

Cocok untuk:

- event sync;
- audit export;
- ingestion;
- domain event propagation.

### 18.3 Effectively-Once

```text
transport may duplicate
business state changes once due to idempotency key / unique constraint / checkpoint
```

Untuk regulatory/case management, ini sering target realistis.

---

## 19. Ordering Semantics

Jangan menganggap “stream” otomatis berarti business ordering aman.

gRPC stream menjaga order message dalam satu stream dari satu sender. Tetapi sistem end-to-end bisa tetap merusak ordering jika:

- multiple streams per entity;
- reconnect creates new stream;
- server processing parallel;
- response generated by multiple workers;
- retry duplicates old message;
- client applies response out of order;
- partitioning tidak konsisten.

Design options:

```proto
message CaseEvent {
  string case_id = 1;
  int64 sequence = 2;
  string event_id = 3;
  google.protobuf.Timestamp occurred_at = 4;
  bytes payload = 5;
}
```

Consumer rule:

```text
apply event only if sequence == last_sequence + 1
if sequence <= last_sequence: duplicate, ignore
if sequence > last_sequence + 1: gap, pause and recover
```

Top-tier systems do not depend solely on transport ordering. They encode ordering into the application protocol.

---

## 20. Chunking Large Payloads

gRPC has max message size constraints and large single messages create memory pressure.

Instead of:

```proto
message HugeFile {
  bytes content = 1;
}
```

Prefer:

```proto
message FileChunk {
  string upload_id = 1;
  int64 offset = 2;
  bytes data = 3;
  string sha256 = 4;
  bool last = 5;
}

message UploadSummary {
  string upload_id = 1;
  int64 total_bytes = 2;
  string file_sha256 = 3;
}

service EvidenceService {
  rpc UploadEvidence(stream FileChunk) returns (UploadSummary);
}
```

Chunk design considerations:

```text
chunk size
max inbound message size
checksum per chunk
whole-file checksum
upload id
offset
ordering
duplicate chunk handling
resume from offset
temporary storage
commit marker
cleanup abandoned upload
virus/malware scanning pipeline
```

Good upload protocol:

```text
1. create upload session
2. stream chunks
3. server writes chunks to temp storage
4. server verifies per-chunk size/hash
5. client half-closes
6. server verifies final hash
7. server commits atomically
8. server returns summary
```

Avoid:

```text
store all chunks in memory then write final file
```

---

## 21. Resumable Streaming

Long streams fail. Design for it.

Failure can happen because:

- client network resets;
- deadline expires;
- server restarts;
- load balancer drains connection;
- deployment rolls pods;
- NAT timeout;
- proxy idle timeout;
- client app crashes;
- remote side cancels;
- mobile connection switches network.

If stream transports important data, you need resume.

### 21.1 Cursor-Based Server Streaming

Example:

```proto
message WatchCaseEventsRequest {
  string case_id = 1;
  int64 after_sequence = 2;
}

message CaseEvent {
  string case_id = 1;
  int64 sequence = 2;
  string event_id = 3;
  bytes payload = 4;
}

service CaseEventService {
  rpc WatchCaseEvents(WatchCaseEventsRequest) returns (stream CaseEvent);
}
```

Client stores:

```text
last_applied_sequence
```

Reconnect:

```text
WatchCaseEvents(after_sequence = last_applied_sequence)
```

Server rule:

```text
send events where sequence > after_sequence
```

### 21.2 Offset-Based Upload Resume

Client asks server:

```proto
rpc GetUploadStatus(GetUploadStatusRequest) returns (UploadStatus);
```

Server returns:

```text
last_committed_offset
```

Client resumes from that offset.

### 21.3 Ack-Based Bidi Resume

For worker protocol:

```text
server sends WorkItem(sequence=10)
client processes
client sends WorkAck(sequence=10)
server marks done
```

If stream breaks, server resends unacked work.

---

## 22. Cancellation Semantics

Cancellation is not optional in streaming.

gRPC cancellation guide states that when a client is no longer interested in the result, it may cancel the RPC; deadline expiration and I/O errors also trigger cancellation, and a server should stop ongoing computation and end its side of the stream.  
Reference: https://grpc.io/docs/guides/cancellation/

For streaming, cancellation should propagate to:

```text
DB cursor
file reader
object storage download
worker task
queue subscription
lock lease
temporary file
transaction/session
remote downstream RPC
```

Anti-pattern:

```java
public void export(... responseObserver) {
    executor.submit(() -> {
        for (Row row : hugeQuery()) {
            responseObserver.onNext(toChunk(row));
        }
        responseObserver.onCompleted();
    });
}
```

If client disconnects, task may keep querying DB and sending into a dead observer.

Better:

```text
onCancel -> set cancelled flag -> close DB cursor -> stop producer -> release resources
```

---

## 23. Deadline Semantics in Streams

Deadline is the maximum allowed time for RPC completion.

In streaming, this gets tricky.

Question:

```text
Is deadline for the whole stream?
Or for receiving first item?
Or for idle period between items?
Or for each message processing?
```

gRPC deadline is RPC-level. If a stream is intended to last hours, a simple fixed deadline may be inappropriate.

Design choices:

### 23.1 Finite Stream

Example:

```text
Export report
```

Deadline can mean:

```text
whole export must complete within 2 minutes
```

### 23.2 Long-Lived Watch Stream

Example:

```text
Watch case updates
```

Deadline could be:

```text
stream may run for 30 minutes then client reconnects
```

This is often healthier than infinite stream.

### 23.3 Per-Message Timeout

For bidi worker protocol:

```text
if work item not acked within 30 seconds, redeliver or mark timeout
```

This is application-level, not just gRPC deadline.

Good design separates:

```text
RPC stream lifetime deadline
idle timeout
heartbeat timeout
per-message processing timeout
ack timeout
resume window retention
```

---

## 24. Heartbeat, Ping, Keepalive, and Application Liveness

Do not confuse:

```text
HTTP/2 PING / gRPC keepalive
application heartbeat
business-level progress
```

gRPC keepalive uses HTTP/2 PING to keep connections alive when there is no data, but it must be configured carefully because too aggressive keepalive can create load or be rejected by servers/proxies.  
Reference: https://grpc.io/docs/guides/keepalive/

Application heartbeat is a message in your stream protocol.

Example:

```proto
message StreamEvent {
  oneof body {
    Heartbeat heartbeat = 1;
    CaseUpdate update = 2;
    StreamWarning warning = 3;
  }
}

message Heartbeat {
  int64 server_time_epoch_ms = 1;
  int64 last_sequence = 2;
}
```

Why application heartbeat matters:

```text
transport may be alive but business producer is stuck
heartbeat can carry cursor/checkpoint
client can detect stream health semantically
load balancer/proxy may need periodic data to avoid idle timeout
```

But heartbeat is not free.

For 100,000 clients, heartbeat every 5 seconds means 20,000 heartbeat messages per second.

Choose interval carefully.

---

## 25. Server Resource Protection

Streaming server must protect resources:

```text
max concurrent streams per server
max concurrent streams per client/principal
max stream duration
max idle duration
max messages per stream
max bytes per stream
max message size
max outbound queue depth
max inbound queue depth
max processing concurrency
max DB cursor duration
max temporary storage
```

Possible server responses:

```text
RESOURCE_EXHAUSTED
UNAVAILABLE
DEADLINE_EXCEEDED
FAILED_PRECONDITION
ABORTED
CANCELLED
```

For overload:

```text
RESOURCE_EXHAUSTED
with retry-after-like metadata if appropriate
```

For business precondition:

```text
FAILED_PRECONDITION
```

For concurrency conflict:

```text
ABORTED
```

---

## 26. Bidi Streaming as Custom Protocol

Bidirectional streaming deserves special discipline.

Bad bidi stream:

```proto
rpc Session(stream Message) returns (stream Message);

message Message {
  string type = 1;
  string json = 2;
}
```

This becomes an untyped tunnel.

Better:

```proto
message ReviewSessionClientMessage {
  string session_id = 1;
  int64 sequence = 2;

  oneof body {
    ClientHello hello = 10;
    OpenCase open_case = 11;
    SubmitComment submit_comment = 12;
    Ack ack = 13;
    ClientHeartbeat heartbeat = 14;
  }
}

message ReviewSessionServerMessage {
  string session_id = 1;
  int64 sequence = 2;

  oneof body {
    ServerHello hello = 10;
    CaseOpened case_opened = 11;
    CommentAccepted comment_accepted = 12;
    DomainError domain_error = 13;
    ServerHeartbeat heartbeat = 14;
  }
}

service ReviewSessionService {
  rpc OpenSession(stream ReviewSessionClientMessage)
      returns (stream ReviewSessionServerMessage);
}
```

Then define state machine:

```text
NEW
-> HELLO_SENT
-> AUTHORIZED
-> ACTIVE
-> DRAINING
-> CLOSED
-> FAILED
```

Rules:

```text
client must send ClientHello first
server must reply ServerHello or error
commands before hello are rejected
server may send heartbeat in ACTIVE
client must ack command result if required
both sides may close gracefully
```

Bidi stream without state machine is a future incident.

---

## 27. Error Model for Streams

Unary error model is easier:

```text
return response or status error
```

Streaming error model has two layers:

```text
stream-level terminal error
message-level domain error
```

Example:

```proto
message ImportResultEvent {
  oneof body {
    ImportAccepted accepted = 1;
    ImportRowSucceeded row_succeeded = 2;
    ImportRowFailed row_failed = 3;
    ImportCompleted completed = 4;
  }
}
```

Use stream terminal error for:

```text
authentication failure
permission denied
protocol violation
server internal failure
resource exhausted
unrecoverable transport/session failure
```

Use message-level error for:

```text
row validation failed
one case rejected
one item conflict
non-terminal business failure
```

Anti-pattern:

```text
terminate entire stream because one row failed validation
```

Unless that is explicitly the business rule.

---

## 28. Authentication and Authorization Drift

Long-lived stream creates security issue:

```text
user was authorized at stream start
but role/permission changes during stream
```

Possible approaches:

1. Authorization snapshot at stream start.
2. Revalidate every message.
3. Revalidate periodically.
4. Revalidate on sensitive operation.
5. Use short max stream lifetime.
6. Server-initiated cancellation when permission changes.

For regulatory/case systems:

```text
read/watch stream may use snapshot + short lifetime
command stream should revalidate per command
high-risk operation should always re-check current authority
```

Also think about token expiry.

If stream lasts longer than access token lifetime, what is the contract?

Options:

```text
terminate and reconnect with new token
or use session credential established by mTLS/service identity
or send re-auth message in protocol
```

Avoid silently continuing forever if identity context is no longer valid for the action.

---

## 29. Observability for Streaming

Per-request logging is not enough.

For streams, observe:

```text
streams_started_total
streams_active
streams_completed_total
streams_cancelled_total
streams_failed_total
stream_duration_histogram
messages_sent_total
messages_received_total
bytes_sent_total
bytes_received_total
outbound_queue_depth
inbound_queue_depth
is_ready_false_duration
flow_control_blocked_duration
heartbeat_sent_total
heartbeat_missed_total
last_sequence_sent
last_sequence_acked
resume_count
duplicate_message_count
per-message processing latency
per-message ack latency
```

Logs should include:

```text
stream_id
rpc method
principal/service identity
peer
deadline
stream mode
sequence range
item count
bytes
termination reason
last error status
cancel reason
```

Trace strategy:

```text
one span for whole stream may be too long
create stream span + sampled item spans
or create periodic checkpoint events
```

Do not log full payload blindly.

For compliance systems:

```text
log identifiers and hashes, not full sensitive payload
```

---

## 30. Performance Model

Streaming performance depends on:

```text
message size
message rate
serialization cost
compression cost
HTTP/2 window
TCP RTT
bandwidth-delay product
receiver processing speed
queue depth
GC allocation
Netty event loop health
max concurrent streams
channel reuse
server executor sizing
```

High QPS small messages:

```text
per-message allocation and callback overhead dominate
batching may help
```

Large messages:

```text
flow control window and memory dominate
chunking helps
```

High latency network:

```text
HTTP/2 flow control windows and outstanding data affect throughput
```

Slow consumer:

```text
bounded queue and backpressure dominate survival
```

---

## 31. Batching Within Streaming

Sometimes streaming one tiny message at a time is inefficient.

Instead of:

```proto
message Row {
  string id = 1;
  string value = 2;
}

rpc Export(ExportRequest) returns (stream Row);
```

Use:

```proto
message RowBatch {
  int64 first_sequence = 1;
  repeated Row rows = 2;
}

rpc Export(ExportRequest) returns (stream RowBatch);
```

Trade-off:

```text
larger batch -> better throughput, worse per-item latency, higher memory
smaller batch -> lower latency, more overhead
```

Batching strategy:

```text
flush when count >= N
or bytes >= B
or time >= T
or stream ending
```

Example:

```text
max 100 rows
max 128 KiB
max 100 ms delay
```

---

## 32. Compression

Compression can help when payload is large and repetitive.

But compression costs CPU and can increase latency.

Use compression carefully for:

```text
large text payload
repetitive JSON-like data
low bandwidth link
```

Avoid or test carefully for:

```text
already compressed binary
small messages
CPU-bound service
low-latency requirement
```

Security caution:

```text
compression + secret + attacker-controlled input can create side-channel risk in some contexts
```

---

## 33. Testing Streaming Systems

Test cases should include:

### 33.1 Normal Flow

```text
client sends N messages
server responds N messages
stream completes
all resources released
```

### 33.2 Slow Client

```text
server produces fast
client reads slowly
queue must not grow unbounded
```

### 33.3 Slow Server

```text
client sends fast
server processes slowly
inbound flow control or bounded queue protects server
```

### 33.4 Cancellation

```text
client cancels after 10 messages
server stops DB cursor/file read/worker
```

### 33.5 Deadline Expiry

```text
deadline expires mid-stream
server sees cancellation
client sees DEADLINE_EXCEEDED or CANCELLED depending side/timing
```

### 33.6 Network Reset

```text
stream breaks mid-transfer
client reconnects with cursor/offset
no duplicate business effect
```

### 33.7 Backpressure

```text
isReady false occurs
producer pauses
resume on ready
```

### 33.8 Duplicate Replay

```text
same sequence resent
consumer deduplicates
```

### 33.9 Out-of-Order

```text
sequence gap detected
consumer pauses/recover
```

### 33.10 Server Shutdown

```text
server enters draining
new streams rejected
existing streams complete or terminate gracefully
client reconnects
```

---

## 34. Production Failure Catalogue

### Failure 1: Server Streaming Export OOM

Symptom:

```text
export stream causes heap growth and OOM
```

Likely cause:

```text
server reads all rows into memory before sending
or sends faster than client consumes
or application queue unbounded
```

Fix:

```text
cursor pagination
bounded queue
manual flow control
chunked response
cancel-aware DB cursor
```

---

### Failure 2: Client Streaming Upload Hangs Forever

Symptom:

```text
client sent all chunks but never receives summary
```

Likely cause:

```text
client forgot onCompleted()
server waits for half-close
```

Fix:

```text
call requestObserver.onCompleted()
add client-side deadline
server idle timeout
```

---

### Failure 3: Bidi Stream Duplicate Work

Symptom:

```text
worker processes same work item twice after reconnect
```

Likely cause:

```text
server did not persist ack boundary
client did not deduplicate by work id
```

Fix:

```text
work_id
ack protocol
server redelivers only unacked
consumer idempotency
```

---

### Failure 4: Stream Appears Alive But No Business Progress

Symptom:

```text
connection remains open, but no events arrive
```

Likely cause:

```text
transport alive
producer stuck
DB query blocked
worker deadlock
```

Fix:

```text
application heartbeat includes last produced sequence
progress metrics
producer watchdog
per-message timeout
```

---

### Failure 5: Load Balancer Kills Long Stream

Symptom:

```text
stream resets every N minutes
```

Likely cause:

```text
LB idle timeout or max connection duration
```

Fix:

```text
application heartbeat
align idle timeout
short stream lifetime + resume
client reconnect with cursor
```

---

### Failure 6: Event Loop Blocked

Symptom:

```text
many gRPC calls become slow
Netty event loop warnings
stream stalls
```

Likely cause:

```text
blocking work inside gRPC callback / Netty event loop context
```

Fix:

```text
offload blocking work to bounded executor
keep callbacks lightweight
measure event loop delay
```

---

### Failure 7: Client Gets RESOURCE_EXHAUSTED Mid-Stream

Symptom:

```text
large upload fails after some chunks
```

Likely cause:

```text
message too large
rate exceeded
server memory pressure
per-stream byte limit
```

Fix:

```text
smaller chunk
backoff
server pushback metadata
resume offset
resource quota visibility
```

---

## 35. Design Pattern: Safe Server Streaming Export

Use case:

```text
Regulator exports audit trail for a case.
Result can contain millions of rows.
```

Bad design:

```proto
rpc ExportAuditTrail(ExportRequest) returns (ExportResponse);

message ExportResponse {
  repeated AuditRow rows = 1;
}
```

Problems:

```text
huge memory
huge response size
timeout
no progress
hard retry
```

Better:

```proto
rpc ExportAuditTrail(ExportRequest) returns (stream AuditTrailBatch);

message ExportRequest {
  string case_id = 1;
  int64 after_sequence = 2;
  int32 batch_size = 3;
}

message AuditTrailBatch {
  int64 first_sequence = 1;
  int64 last_sequence = 2;
  repeated AuditTrailRow rows = 3;
  string batch_hash = 4;
}
```

Server rules:

```text
authorize case access at start
use DB cursor/keyset pagination
emit batch max N rows or B bytes
include sequence range
include batch hash
respect isReady
stop on cancellation
log export summary
limit max stream duration
support resume after last_sequence
```

Client rules:

```text
write batches to file/storage incrementally
verify sequence continuity
verify batch hash
persist last_sequence
resume on failure
close output safely
```

---

## 36. Design Pattern: Safe Client Streaming Upload

Use case:

```text
Agency uploads evidence document.
File can be 2 GB.
```

Protocol:

```proto
service EvidenceUploadService {
  rpc StartUpload(StartUploadRequest) returns (StartUploadResponse);
  rpc UploadEvidence(stream EvidenceChunk) returns (UploadEvidenceResult);
  rpc GetUploadStatus(GetUploadStatusRequest) returns (UploadStatus);
}

message EvidenceChunk {
  string upload_id = 1;
  int64 offset = 2;
  bytes data = 3;
  string chunk_sha256 = 4;
  bool last = 5;
}
```

Server rules:

```text
validate upload_id
validate offset
validate chunk size
write to temp object/file
verify chunk hash
track committed offset
on completed verify full file hash
commit metadata atomically
cleanup stale uploads
```

Client rules:

```text
read file chunk by chunk
respect outbound readiness
retry/resume from committed offset
send onCompleted after last chunk
use deadline appropriate to file size
```

---

## 37. Design Pattern: Bidi Worker Stream

Use case:

```text
Central service dispatches case screening jobs to worker service.
Worker returns result asynchronously over same stream.
```

Protocol:

```proto
service ScreeningWorkerService {
  rpc Work(stream WorkerMessage) returns (stream CoordinatorMessage);
}

message CoordinatorMessage {
  oneof body {
    CoordinatorHello hello = 1;
    WorkItem work_item = 2;
    CoordinatorHeartbeat heartbeat = 3;
    DrainRequest drain = 4;
  }
}

message WorkerMessage {
  oneof body {
    WorkerHello hello = 1;
    WorkAck ack = 2;
    WorkResult result = 3;
    WorkerHeartbeat heartbeat = 4;
  }
}
```

Rules:

```text
worker says capacity in WorkerHello
coordinator sends no more than capacity unacked items
worker acks item received
worker sends result when done
coordinator marks complete idempotently
if stream breaks, uncompleted items are redelivered
work item has idempotency key
```

This is backpressure at application level:

```text
worker advertised capacity controls coordinator send rate
```

---

## 38. Java 8–25 Considerations

### Java 8

Common environment:

```text
gRPC Java with Netty
CompletableFuture less integrated with structured lifecycle
executor discipline is critical
```

### Java 11+

Better runtime baseline:

```text
improved TLS defaults
better container awareness than early Java 8
JDK HttpClient exists but gRPC still uses its own transport stack
```

### Java 17/21 LTS

Important improvements:

```text
modern GC options
better container support
virtual threads in Java 21
```

Virtual threads help when application work is blocking, but do not remove:

```text
HTTP/2 stream limits
connection limits
server capacity limits
queue limits
remote processing speed
bandwidth limits
flow control
```

### Java 25

Structured concurrency and scoped values influence how we design stream-related background tasks.

For example, a streaming export may involve:

```text
DB reader task
serialization task
sender task
cancellation watcher
```

Structured concurrency encourages treating related tasks as one unit of work with coordinated cancellation/error handling.

But gRPC Java callback APIs still require careful adaptation.

---

## 39. Practical Checklist for gRPC Streaming Design

Before approving a streaming design, ask:

### Contract

```text
What is the stream type: server, client, or bidi?
What is the business purpose?
What is the delivery semantic?
Is ordering required?
Is resume required?
What is the terminal success condition?
What errors are stream-level vs message-level?
```

### Capacity

```text
Max stream duration?
Max messages per stream?
Max bytes per stream?
Max concurrent streams?
Max outbound queue?
Max inbound queue?
Max processing concurrency?
```

### Backpressure

```text
What happens if receiver is slow?
Does backpressure reach the source?
Is queue bounded?
What is full-queue policy?
Is manual flow control needed?
```

### Failure

```text
What happens on cancellation?
What happens on deadline expiry?
What happens on network reset?
What happens during deployment drain?
Can client resume?
Can server deduplicate?
```

### Security

```text
How is stream authenticated?
How is authorization revalidated?
What happens when token expires?
Can one stream access multiple entities?
Are payloads sensitive?
```

### Observability

```text
Can we see active streams?
Can we see queue depth?
Can we see last sequence?
Can we see cancellation reason?
Can we see flow-control blocked time?
Can we debug one stream by stream_id?
```

---

## 40. Anti-Patterns

### Anti-Pattern 1: Unbounded Producer

```java
for (Row row : queryEverything()) {
    responseObserver.onNext(toRow(row));
}
```

Fix:

```text
bounded source read
manual readiness
chunk/batch
cancel-aware cursor
```

---

### Anti-Pattern 2: Treating onNext as Delivery Ack

```text
onNext succeeded -> peer processed message
```

Wrong.

Fix:

```text
application-level ack if delivery/processing matters
```

---

### Anti-Pattern 3: One Giant Stream Forever

```text
watch stream with no max duration and no resume cursor
```

Fix:

```text
bounded stream lifetime
heartbeat
cursor resume
client reconnect strategy
```

---

### Anti-Pattern 4: Bidi Stream Without State Machine

```text
any message can arrive anytime
```

Fix:

```text
define protocol states and valid transitions
```

---

### Anti-Pattern 5: Payload Tunnel

```proto
message GenericMessage {
  string type = 1;
  string json = 2;
}
```

Fix:

```text
use typed oneof messages
schema evolution via protobuf
```

---

### Anti-Pattern 6: Ignoring Cancellation

```text
client disconnects but server keeps working
```

Fix:

```text
onCancel handler
cancel tokens
close resources
propagate downstream cancellation
```

---

## 41. Exercises

### Exercise 1 — Export Stream

Design a server streaming API for exporting 10 million audit rows.

Define:

```text
.proto schema
batch size strategy
resume cursor
hash/checksum model
cancellation behavior
metrics
```

### Exercise 2 — Upload Stream

Design a client streaming API for evidence upload.

Define:

```text
chunk schema
resume offset
temporary storage behavior
final commit
failure cleanup
```

### Exercise 3 — Bidi Worker Protocol

Design a bidi stream for distributed case screening workers.

Define:

```text
hello message
capacity advertisement
work item
ack
result
drain
heartbeat
redelivery
idempotency
```

### Exercise 4 — Backpressure Failure Analysis

Given:

```text
server produces 20,000 messages/s
client consumes 2,000 messages/s
outbound queue is unbounded
stream lasts 10 minutes
average message is 4 KiB
```

Analyze memory risk.

Rough calculation:

```text
excess = 18,000 messages/s
10 minutes = 600s
queued messages = 10,800,000
payload only = 10,800,000 * 4 KiB ≈ 43.2 GiB
```

Heap will die long before accounting object overhead.

### Exercise 5 — Authorization Drift

A user opens a watch stream for case updates. After 5 minutes, their permission to that case is revoked.

Design options:

```text
snapshot authorization
periodic revalidation
server cancellation
short stream lifetime
reconnect with fresh token
```

Choose a policy and justify it.

---

## 42. Summary

gRPC streaming is powerful because it lets Java systems communicate as continuous pipelines instead of isolated request/response calls.

But streaming increases responsibility.

A mature streaming design must specify:

```text
stream shape
message contract
delivery semantics
ordering
acknowledgement
resume strategy
backpressure
bounded queues
flow control
cancellation
deadline
heartbeat
security
observability
resource limits
```

The most important mental model:

```text
Streaming is not just many messages.
Streaming is a distributed state machine over a long-lived transport.
```

And the most important operational rule:

```text
Every buffer must be bounded,
every stream must be cancellable,
every long-lived stream must be observable,
and every important message must have a recovery story.
```

---

## 43. References

- gRPC Flow Control: https://grpc.io/docs/guides/flow-control/
- gRPC Cancellation: https://grpc.io/docs/guides/cancellation/
- gRPC Deadlines: https://grpc.io/docs/guides/deadlines/
- gRPC Keepalive: https://grpc.io/docs/guides/keepalive/
- gRPC Performance Best Practices: https://grpc.io/docs/guides/performance/
- gRPC Core Concepts: https://grpc.io/docs/what-is-grpc/core-concepts/
- gRPC Java Javadoc — `ClientCallStreamObserver`: https://grpc.github.io/grpc-java/javadoc/io/grpc/stub/ClientCallStreamObserver.html
- gRPC Java Javadoc — `ServerCallStreamObserver`: https://grpc.github.io/grpc-java/javadoc/io/grpc/stub/ServerCallStreamObserver.html
- RFC 9113 — HTTP/2: https://www.rfc-editor.org/rfc/rfc9113.html
- Protocol Buffers Language Guide: https://protobuf.dev/programming-guides/proto3/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 23 — gRPC Error Handling, Retry, Load Balancing, Name Resolution, and Service Config](./023-grpc-error-handling-retry-load-balancing-name-resolution-service-config.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 25 — Netty for Java Network Engineers: Event Loop, Channel Pipeline, ByteBuf, and Zero-Copy](./025-netty-for-java-network-engineers-event-loop-channel-pipeline-bytebuf-zero-copy.md)

</div>