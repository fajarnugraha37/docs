# Part 5 — Protocol Design Fundamentals: Framing, Length Prefix, Delimiters, Streaming, and Compatibility

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `005-protocol-design-fundamentals-framing-length-prefix-delimiters-streaming-compatibility.md`  
Scope: Java 8–25, advanced network/protocol engineering  
Status: Part 5 of 35

---

## 0. Why This Part Exists

Pada part sebelumnya kita membahas TCP, DNS, socket, `SocketChannel`, selector, dan runtime behavior Java. Namun semua itu masih berada di level transport. TCP hanya memberi kita **ordered byte stream**. TCP tidak tahu apa itu request, response, command, event, JSON object, Protobuf message, header, correlation id, atau error code.

Karena itu, setiap sistem network yang berjalan di atas TCP harus menjawab pertanyaan fundamental:

> Dari stream byte yang tidak punya batas message, bagaimana receiver tahu satu message dimulai, berakhir, divalidasi, diproses, di-acknowledge, di-retry, dan dievolusi tanpa merusak client/server lama?

Itulah inti desain protokol.

HTTP, gRPC, PostgreSQL wire protocol, Redis RESP, Kafka protocol, AMQP, MQTT, SSH, TLS, dan banyak protocol lain pada akhirnya harus menyelesaikan problem yang sama:

1. **Framing** — bagaimana memotong byte stream menjadi message.
2. **Parsing** — bagaimana mengubah frame menjadi struktur semantik.
3. **Validation** — bagaimana membedakan message valid, invalid, malformed, unsupported, malicious, atau incomplete.
4. **Routing** — bagaimana menentukan handler/operation dari message.
5. **Correlation** — bagaimana response dikaitkan dengan request.
6. **Flow control** — bagaimana sender tidak menghancurkan receiver.
7. **Compatibility** — bagaimana protocol berubah tanpa breaking change.
8. **Observability** — bagaimana engineer memahami apa yang terjadi tanpa membocorkan data sensitif.
9. **Failure semantics** — bagaimana timeout, cancellation, EOF, reset, duplicate, partial write, dan partial read dimaknai.

Part ini bukan bertujuan membuat kamu selalu mendesain custom protocol. Justru sebaliknya: setelah memahami desain protocol, kamu akan lebih bijak memakai HTTP/gRPC/message broker, tahu batasnya, dan tahu kapan custom protocol adalah ide buruk.

---

## 1. Learning Outcomes

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan kenapa TCP membutuhkan framing di layer aplikasi.
2. Membedakan delimiter-based, fixed-length, length-prefixed, chunked, multiplexed, dan self-describing protocols.
3. Mendesain binary protocol sederhana yang aman terhadap partial read/write.
4. Mendesain text protocol sederhana yang mudah debug tetapi tetap bounded.
5. Menjelaskan kenapa `read()` tidak sama dengan “satu message diterima”.
6. Menjelaskan kenapa `write()` tidak sama dengan “message sudah diproses remote server”.
7. Mendesain header protocol yang memiliki version, message type, correlation id, flags, length, checksum, dan extension point.
8. Membedakan connection lifecycle, stream lifecycle, request lifecycle, dan application transaction lifecycle.
9. Mendesain protocol error model: malformed, unsupported version, auth failure, rate limited, timeout, busy, unavailable, conflict, duplicate, cancelled.
10. Menjelaskan schema evolution dan compatibility pada protocol JSON/Protobuf/binary custom.
11. Mengetahui anti-pattern seperti unbounded frame, ambiguous delimiter, Java serialization, no timeout, no max payload, no versioning, dan silent schema break.
12. Membaca HTTP/gRPC dengan mata protocol engineer, bukan hanya framework user.

---

## 2. Core Mental Model: TCP Gives Bytes, Protocol Gives Meaning

TCP tidak mengirim “message”. TCP mengirim **byte stream**.

Misalnya sender menulis:

```text
write("HELLO")
write("WORLD")
```

Receiver bisa membaca sebagai:

```text
read() -> "HELLOWORLD"
```

atau:

```text
read() -> "HE"
read() -> "LLOW"
read() -> "ORLD"
```

atau:

```text
read() -> "HELLO"
read() -> "WORLD"
```

Semua valid. TCP hanya menjamin byte sampai berurutan, bukan mempertahankan boundary write aplikasi.

Konsekuensinya:

```java
int n = inputStream.read(buffer);
```

Artinya hanya:

> Ada beberapa byte tersedia, atau EOF, atau error, atau timeout.

Bukan:

> Satu request lengkap sudah diterima.

Dan:

```java
outputStream.write(bytes);
```

Artinya hanya:

> Aplikasi menyerahkan byte ke OS/JVM/socket buffer.

Bukan:

> Remote server sudah membaca, mem-parse, memvalidasi, memproses, dan commit hasil.

Top 1% engineer tidak mencampuradukkan level-level ini.

---

## 3. Four Boundaries You Must Separate

Dalam network protocol, jangan mencampur empat boundary berikut.

### 3.1 Byte Boundary

Ini boundary fisik pada buffer:

```text
buffer[0..n]
```

Byte boundary ditentukan oleh hasil `read`, ukuran buffer, segmentasi TCP, TLS record, kernel buffer, dan scheduling.

Byte boundary tidak boleh dipakai sebagai message boundary.

### 3.2 Frame Boundary

Frame adalah unit transfer di level protocol.

Contoh:

```text
[length=128][128 bytes payload]
```

atau:

```text
{"type":"ping"}\n
```

Frame boundary menjawab:

> Berapa banyak byte harus dikumpulkan sebelum parser boleh memproses satu unit lengkap?

### 3.3 Message Boundary

Message adalah unit semantik.

Contoh:

```json
{
  "type": "CreateOrder",
  "orderId": "ORD-001",
  "amount": 120000
}
```

Satu message bisa muat dalam satu frame, beberapa frame, atau satu frame bisa membawa beberapa message tergantung protocol.

### 3.4 Transaction Boundary

Transaction adalah unit bisnis/side-effect.

Contoh:

```text
CreateOrder request received
-> validate
-> reserve inventory
-> charge payment
-> persist order
-> publish event
-> send response
```

Kesalahan umum: menganggap “message delivered” sama dengan “transaction committed”. Tidak sama.

---

## 4. The Protocol Stack Inside One Connection

Satu koneksi TCP biasanya memuat beberapa layer:

```text
Application semantics
  Operation: CreatePayment / GetCase / UploadDocument
  Error model: invalid, duplicate, conflict, unavailable
  Idempotency: key, sequence, version

Message schema
  JSON / Protobuf / Avro / custom binary
  Required/optional fields
  Compatibility rules

Framing
  Length-prefix / delimiter / chunk / HTTP frame / gRPC message
  Max frame size
  Partial read/write handling

Security layer
  TLS/mTLS
  Authentication token
  Signature/checksum

Transport
  TCP connection
  Socket buffer
  Kernel state
  Remote peer
```

Protocol design yang baik tidak hanya mendefinisikan payload. Ia mendefinisikan lifecycle, limits, error semantics, versioning, and observability.

---

## 5. Framing Strategy 1: Fixed-Length Records

Fixed-length protocol berarti setiap frame memiliki ukuran tetap.

Contoh:

```text
[64 bytes record][64 bytes record][64 bytes record]
```

### 5.1 Kelebihan

1. Parsing sederhana.
2. Tidak perlu membaca length field.
3. Mudah untuk hardware/legacy/mainframe/protocol lama.
4. Offset field bisa statis.

### 5.2 Kekurangan

1. Boros jika payload bervariasi.
2. Sulit mendukung field opsional.
3. Evolusi schema sulit.
4. Ukuran maksimum harus dipilih di awal.
5. String harus dipad/truncate.

### 5.3 Cocok Untuk

1. Sistem legacy fixed-format.
2. Market data tertentu.
3. Telemetry kecil dengan format stabil.
4. Embedded/low-level systems dengan constraint ketat.

### 5.4 Tidak Cocok Untuk

1. API bisnis yang berubah sering.
2. Payload kompleks.
3. Upload/download.
4. Protocol publik.

---

## 6. Framing Strategy 2: Delimiter-Based Protocol

Delimiter protocol memakai karakter atau byte khusus untuk menandai akhir message.

Contoh line-based:

```text
PING\n
SET key value\n
GET key\n
```

Contoh JSON Lines:

```jsonl
{"type":"ping"}
{"type":"create","id":"A001"}
```

### 6.1 Kelebihan

1. Mudah dibaca manusia.
2. Mudah debug dengan telnet/netcat/log.
3. Parsing awal sederhana.
4. Cocok untuk command kecil.

### 6.2 Kekurangan

Delimiter harus di-escape jika muncul dalam payload.

Contoh buruk:

```text
SEND message=hello\nworld\n
```

Receiver bisa salah mengira message selesai di tengah payload.

### 6.3 Rule Wajib

Delimiter protocol harus punya:

1. Maksimum panjang line/message.
2. Escape rule atau encoding rule.
3. Charset eksplisit, biasanya UTF-8.
4. Strategi jika delimiter tidak pernah datang.
5. Timeout untuk incomplete frame.
6. Error response untuk malformed frame.
7. Cara menangani CRLF vs LF.

### 6.4 Anti-Pattern

```java
String line = reader.readLine();
```

Lalu tanpa limit.

Problem:

1. Peer bisa mengirim 5GB tanpa newline.
2. Memory bisa habis.
3. Thread bisa tergantung lama.
4. Slowloris-style attack mudah.

Top-tier rule:

> Every delimiter protocol must be bounded.

---

## 7. Framing Strategy 3: Length-Prefixed Protocol

Length-prefix adalah desain paling umum untuk binary protocol.

Format sederhana:

```text
[4 bytes length][N bytes payload]
```

Contoh:

```text
00 00 00 05 48 45 4C 4C 4F
```

Artinya length = 5, payload = `HELLO`.

### 7.1 Kelebihan

1. Payload boleh mengandung byte apa pun.
2. Receiver tahu kapan frame lengkap.
3. Cocok untuk binary payload.
4. Cocok untuk Protobuf/custom binary.
5. Mudah menetapkan maksimum frame size.

### 7.2 Kekurangan

1. Perlu byte-order agreement.
2. Perlu validasi length.
3. Jika length corrupt, stream bisa desync.
4. Tidak self-describing kecuali header diperluas.
5. Harus hati-hati integer overflow.

### 7.3 Minimum Safe Rule

Receiver harus validasi:

```text
length >= 0
length <= maxFrameSize
length does not overflow buffer allocation
length is consistent with remaining bytes
```

Jangan pernah:

```java
byte[] payload = new byte[length];
```

sebelum memastikan `length` aman.

### 7.4 Java Blocking Reader Example

Contoh sederhana, bukan production final:

```java
import java.io.*;
import java.nio.ByteBuffer;

public final class LengthPrefixedReader {
    private final InputStream in;
    private final int maxFrameSize;

    public LengthPrefixedReader(InputStream in, int maxFrameSize) {
        this.in = in;
        this.maxFrameSize = maxFrameSize;
    }

    public byte[] readFrame() throws IOException {
        byte[] header = readExactly(4);
        int length = ByteBuffer.wrap(header).getInt();

        if (length < 0) {
            throw new ProtocolException("Negative frame length: " + length);
        }
        if (length > maxFrameSize) {
            throw new ProtocolException("Frame too large: " + length);
        }

        return readExactly(length);
    }

    private byte[] readExactly(int size) throws IOException {
        byte[] data = new byte[size];
        int offset = 0;

        while (offset < size) {
            int n = in.read(data, offset, size - offset);
            if (n == -1) {
                throw new EOFException("Connection closed while reading frame");
            }
            offset += n;
        }

        return data;
    }
}
```

Important:

```text
readExactly(4) reads header
validate length
readExactly(length) reads payload
```

This is the difference between stream thinking and message thinking.

---

## 8. Framing Strategy 4: Header + Payload Protocol

A more realistic protocol has a header.

Example:

```text
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Magic         | Version       | Type          | Flags         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Correlation ID                                                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Payload Length                                                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Header Checksum / Reserved                                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Payload ...                                                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

A practical custom binary header might contain:

| Field | Purpose |
|---|---|
| Magic | Detect wrong protocol / desync |
| Version | Protocol compatibility |
| Type | Request, response, event, ping, pong, error |
| Flags | Compression, encryption marker, streaming marker |
| Correlation ID | Match response to request |
| Payload length | Frame boundary |
| Checksum | Detect corruption / accidental mismatch |
| Reserved | Future extension |

### 8.1 Magic Number

Magic number helps detect:

1. Client connected to wrong port.
2. TLS vs plaintext mismatch.
3. HTTP client accidentally calling binary protocol.
4. Stream desynchronization.

Example:

```text
0xCAFE_BABE
```

Do not rely on magic for security. It is only early validation.

### 8.2 Version

Versioning must answer:

1. Can v1 client talk to v2 server?
2. Can v2 client talk to v1 server?
3. Can feature be negotiated?
4. What happens if version unsupported?
5. Is version per connection, per frame, or per message?

### 8.3 Message Type

At minimum:

```text
REQUEST
RESPONSE
ERROR
PING
PONG
GOAWAY / DRAIN
```

If streaming:

```text
STREAM_START
STREAM_DATA
STREAM_END
STREAM_RESET
WINDOW_UPDATE
```

### 8.4 Correlation ID

Without correlation id, multiplexing is hard.

A correlation id allows:

```text
Request A -> id=100
Request B -> id=101
Response B -> id=101
Response A -> id=100
```

This enables concurrent in-flight requests over one connection.

But it introduces complexity:

1. Response ordering may differ from request ordering.
2. Need in-flight request map.
3. Need timeout cleanup.
4. Need duplicate id detection.
5. Need cancellation semantics.

### 8.5 Flags

Flags are dangerous if underspecified.

Example:

```text
bit 0 = compressed
bit 1 = response required
bit 2 = end stream
bit 3 = error
```

Rules:

1. Unknown critical flags should reject.
2. Unknown non-critical flags may ignore.
3. Reserved bits must be zero unless negotiated.
4. Flags must be documented in compatibility matrix.

---

## 9. Framing Strategy 5: Chunked Transfer

Chunking is useful when total payload length is unknown or too large.

Concept:

```text
[chunk length][chunk data]
[chunk length][chunk data]
[zero length / end marker]
```

HTTP/1.1 chunked transfer coding follows this concept: content is transferred as chunks, each with a size indicator, followed by final chunk and optional trailers.

### 9.1 Use Cases

1. Streaming generated response.
2. Upload large file without buffering whole body.
3. Response where total length is not known in advance.
4. Long-running export.
5. Progressive processing.

### 9.2 Risks

1. Receiver still needs max total size.
2. Receiver needs max chunk size.
3. Slow sender can hold resources.
4. Proxy may buffer chunks.
5. Error after partial data creates ambiguous semantics.

### 9.3 Chunk Protocol State Machine

```text
START
  -> READ_CHUNK_HEADER
  -> VALIDATE_CHUNK_LENGTH
  -> READ_CHUNK_PAYLOAD
  -> DELIVER_CHUNK
  -> READ_NEXT_CHUNK
  -> END
```

Every state needs timeout, cancellation, and error behavior.

---

## 10. Streaming Is Not Just “Many Messages”

Streaming requires a stronger model than repeated request-response.

A stream has:

1. Stream id.
2. Direction: client-streaming, server-streaming, bidirectional.
3. Start event.
4. Data events.
5. End event.
6. Reset/cancel event.
7. Flow-control window.
8. Ordering guarantee.
9. Backpressure behavior.
10. Error and final status.

Example bidirectional stream:

```text
CLIENT -> STREAM_START stream=7
CLIENT -> STREAM_DATA  stream=7 seq=1
SERVER -> STREAM_DATA  stream=7 seq=1
CLIENT -> STREAM_DATA  stream=7 seq=2
SERVER -> STREAM_ERROR stream=7 code=INVALID_ARGUMENT
CLIENT -> STREAM_RESET stream=7
```

Questions you must answer:

1. Can both sides send at the same time?
2. Can server send before client finishes?
3. What if one side cancels?
4. Are messages ordered?
5. Can messages be retried?
6. Can stream resume after disconnect?
7. What is max stream duration?
8. What is max in-flight message count?
9. What happens to partial side effects?

---

## 11. Request-Response, Pipeline, Multiplex, and Stream

### 11.1 Sequential Request-Response

```text
send request A
wait response A
send request B
wait response B
```

Simple but poor utilization.

### 11.2 Pipelining

```text
send request A
send request B
receive response A
receive response B
```

Responses must usually be ordered. HTTP/1.1 pipelining had practical issues due to head-of-line blocking and intermediary behavior.

### 11.3 Multiplexing

```text
send request A id=1
send request B id=2
receive response B id=2
receive response A id=1
```

Better utilization but needs correlation, flow control, stream state, and cancellation.

HTTP/2 and gRPC use multiplexing over a connection.

### 11.4 Streaming

```text
stream 1 data frame
stream 2 data frame
stream 1 data frame
stream 2 reset
```

Streaming is multiplexing plus lifecycle and flow control.

---

## 12. Compatibility: Protocols Must Evolve

A protocol that cannot evolve is a future incident.

### 12.1 Compatibility Dimensions

| Dimension | Question |
|---|---|
| Backward compatibility | Can new server accept old client? |
| Forward compatibility | Can old server/client tolerate new fields? |
| Wire compatibility | Can bytes still be parsed? |
| Semantic compatibility | Does same field still mean same thing? |
| Operational compatibility | Can old/new versions coexist during rolling deploy? |

### 12.2 Compatibility Rules for JSON

For JSON APIs:

1. Adding optional field is usually safe.
2. Removing field is breaking if consumers depend on it.
3. Renaming field is breaking.
4. Changing type is breaking.
5. Changing enum semantics is dangerous.
6. Changing default behavior is semantic breaking.
7. Changing numeric precision can be breaking.
8. Changing timestamp format is breaking.
9. Adding required field to request is breaking for old clients.
10. Returning extra fields should be tolerated by robust clients.

### 12.3 Compatibility Rules for Protobuf

For Protobuf-like schema:

1. Never reuse field numbers.
2. Reserve deleted field numbers/names.
3. Add fields with new numbers.
4. Avoid required fields for evolvability.
5. Be careful changing numeric types.
6. Be careful changing packed/unpacked repeated fields.
7. Unknown fields matter for forward compatibility.
8. Enum zero/default value must be meaningful.
9. `oneof` evolution needs special care.
10. Field presence differs by syntax/version/language.

### 12.4 Compatibility Rules for Custom Binary

For custom binary protocol:

1. Include version.
2. Include header length if header can evolve.
3. Include flags with known/unknown behavior.
4. Include extension fields or TLV section.
5. Include max length.
6. Include reserved bytes.
7. Include negotiation handshake for major feature changes.
8. Never change field meaning silently.
9. Keep a compatibility test corpus.
10. Keep golden byte fixtures.

---

## 13. TLV: Type-Length-Value as Extension Mechanism

TLV format:

```text
[type][length][value]
[type][length][value]
[type][length][value]
```

Example:

```text
01 00 04 00 00 00 7B
02 00 05 68 65 6C 6C 6F
```

Type 1 = integer, length 4, value 123.  
Type 2 = string, length 5, value `hello`.

### 13.1 Why TLV Works

Receiver can skip unknown fields if it knows length.

```text
unknown type=99 length=128 -> skip 128 bytes
```

That is a huge compatibility advantage.

### 13.2 TLV Risks

1. Duplicate fields.
2. Unknown critical fields.
3. Nested TLV depth attack.
4. Huge length values.
5. Ambiguous ordering.
6. Multiple encodings for same semantic object.

---

## 14. Protocol Error Model

Every protocol needs explicit error taxonomy.

### 14.1 Transport Errors

```text
connection refused
connection timeout
connection reset
EOF
TLS handshake failure
DNS failure
```

These usually mean the request may or may not have reached server.

### 14.2 Framing Errors

```text
invalid magic
unsupported version
negative length
frame too large
incomplete frame
invalid checksum
unknown critical flag
```

These usually mean protocol violation.

### 14.3 Parsing Errors

```text
invalid JSON
invalid Protobuf
invalid charset
unknown message type
missing required semantic field
invalid enum value
```

### 14.4 Authentication/Authorization Errors

```text
missing token
expired token
invalid signature
forbidden operation
insufficient scope
```

### 14.5 Application Errors

```text
validation failed
conflict
duplicate
not found
state transition not allowed
quota exceeded
```

### 14.6 Availability Errors

```text
server busy
dependency unavailable
rate limited
deadline exceeded
circuit open
maintenance mode
```

### 14.7 Why Error Class Matters

Retry decision depends on error class.

| Error | Retry? | Reason |
|---|---:|---|
| Malformed frame | No | Client/protocol bug |
| Unsupported version | No/upgrade | Compatibility issue |
| Auth failed | Usually no | Token/config issue |
| Rate limited | Later | Need backoff / quota |
| Server busy | Maybe | Retry with budget |
| Connection reset before write | Maybe | Request likely not sent |
| Connection reset after write | Dangerous | Request may have been processed |
| Deadline exceeded | Maybe, if idempotent | Original may still complete |
| Duplicate | Treat as success/conflict | Depends idempotency model |

---

## 15. Idempotency and Duplicate Suppression

Network protocols must assume ambiguous failure.

Scenario:

```text
client sends CreatePayment
server processes payment
server sends response
connection resets before client reads response
client retries CreatePayment
```

Without idempotency, duplicate payment can happen.

### 15.1 Protocol-Level Idempotency Key

Request:

```text
operation = CreatePayment
idempotencyKey = client-generated-uuid
amount = 100000
```

Server stores:

```text
(idempotencyKey, requestHash, result, status, expiry)
```

Retry with same key returns same result.

### 15.2 Important Rules

1. Idempotency key must be generated by client.
2. Server must bind key to request hash.
3. Same key with different payload should be rejected.
4. Store result for a bounded time.
5. Expiry must match retry horizon.
6. Idempotency does not mean operation has no side effect; it means repeated attempts do not create repeated side effects.

---

## 16. Heartbeat, Ping, Keepalive, and Health Check Are Different

Do not mix these concepts.

| Mechanism | Layer | Purpose |
|---|---|---|
| TCP keepalive | Transport | Detect dead peer eventually |
| Protocol ping/pong | Application/protocol | Detect connection liveness faster |
| HTTP health check | Application endpoint | Detect service readiness/liveness |
| gRPC keepalive | HTTP/2/gRPC transport | Keep connection active / detect broken transport |
| Business heartbeat | Domain | Signal actor/process still active |

### 16.1 Bad Heartbeat Design

```text
client sends heartbeat every 1s forever
server updates DB every heartbeat
```

Problem:

1. DB write amplification.
2. Heartbeat storm.
3. No jitter.
4. False positive on GC pause/network jitter.
5. Bad behavior during partial outage.

### 16.2 Better Design

1. Jitter heartbeat interval.
2. Use missed heartbeat threshold.
3. Separate connection heartbeat from business presence.
4. Avoid DB write for every heartbeat.
5. Use monotonic timestamps internally.
6. Include server-side backoff instruction if needed.

---

## 17. Compression in Protocol Design

Compression can reduce bandwidth but adds CPU, latency, memory, and security risk.

### 17.1 When Compression Helps

1. Large text payload.
2. Repeated field names/values.
3. Slow network.
4. Cross-region transfer.
5. Log/export/report payload.

### 17.2 When Compression Hurts

1. Small payload.
2. Already compressed file/image/pdf/zip.
3. CPU-bound service.
4. Latency-sensitive tiny RPC.
5. Risk of decompression bomb.

### 17.3 Required Limits

1. Max compressed size.
2. Max decompressed size.
3. Compression algorithm whitelist.
4. Ratio limit.
5. Streaming decompression with bound.
6. Metrics for compression ratio and CPU cost.

---

## 18. Checksum, Hash, Signature, and MAC

These are not interchangeable.

| Mechanism | Protects Against | Security? |
|---|---|---|
| Checksum | Accidental corruption | No |
| Hash | Integrity fingerprint | Not by itself |
| HMAC/MAC | Tampering with shared secret | Yes, if key safe |
| Digital signature | Authenticity/non-repudiation | Yes, if key model correct |
| TLS | Transport confidentiality/integrity | Yes, for channel |

In most application protocols over TLS, you do not need per-message checksum for security. But you may still need content hash for:

1. Large file integrity.
2. Deduplication.
3. Object storage validation.
4. Audit trail.
5. Replay detection.

---

## 19. Text vs Binary Protocol

### 19.1 Text Protocol

Examples: HTTP/1.1 headers, Redis RESP-ish readability, SMTP.

Pros:

1. Human-readable.
2. Easier manual debugging.
3. Logs are easier.
4. Works well with line-based tools.

Cons:

1. Larger payload.
2. Parsing ambiguity.
3. Charset issues.
4. Escaping issues.
5. Slower parse for large scale.

### 19.2 Binary Protocol

Examples: HTTP/2 frames, gRPC/Protobuf, Kafka protocol, custom length-prefixed protocol.

Pros:

1. Compact.
2. Faster parse if designed well.
3. Precise numeric encoding.
4. Good for high-throughput systems.
5. Strong schema possible.

Cons:

1. Harder manual debug.
2. Needs tooling.
3. Compatibility mistakes can be severe.
4. More likely to have unsafe parser bugs if custom.

### 19.3 Practical Rule

For business APIs:

```text
Use HTTP/JSON when human/debuggability/ecosystem matters.
Use gRPC/Protobuf when typed contract, streaming, and efficient internal RPC matter.
Avoid custom protocol unless you have a strong reason.
```

---

## 20. Java Implementation Model: Parser as State Machine

A robust protocol parser is a state machine, not one big `read()`.

Example states:

```text
READ_HEADER
VALIDATE_HEADER
READ_PAYLOAD
DECODE_PAYLOAD
DISPATCH_MESSAGE
WRITE_RESPONSE
CLOSE_OR_CONTINUE
```

For non-blocking I/O:

```text
READ_HEADER may receive only 2 of 16 bytes
READ_PAYLOAD may receive only 20 of 4096 bytes
WRITE_RESPONSE may write only 512 of 8192 bytes
```

Therefore parser state must survive between readiness events.

### 20.1 Blocking Implementation

Blocking implementation can hide state machine inside loops:

```java
while (running) {
    Frame frame = readFrame(inputStream);
    Message message = decode(frame);
    Response response = handle(message);
    writeFrame(outputStream, encode(response));
}
```

This is easier, especially with virtual threads. But limits still exist:

1. One connection consumes memory.
2. One blocked operation may hold resources.
3. Socket read timeout still required.
4. Max frame size still required.
5. Backpressure still required.

### 20.2 Non-Blocking Implementation

Non-blocking parser must be explicit:

```java
switch (state) {
    case READ_HEADER -> tryReadHeader(channel);
    case READ_PAYLOAD -> tryReadPayload(channel);
    case DISPATCH -> dispatchIfComplete();
    case WRITE_RESPONSE -> tryWrite(channel);
}
```

This is why frameworks like Netty exist.

---

## 21. Netty Lens: Decoders Solve Framing

Netty separates inbound bytes from decoded messages using handlers/decoders. For example, a length-field-based decoder splits incoming `ByteBuf`s based on a length field in the message. This embodies the same concept we are discussing: first solve frame boundaries, then decode messages.

Typical pipeline idea:

```text
Socket bytes
  -> frame decoder
  -> decompressor
  -> message decoder
  -> business handler
  -> message encoder
  -> frame encoder
  -> socket bytes
```

Important principle:

> Business handlers should not parse arbitrary byte streams. They should receive validated messages.

---

## 22. Protocol Handshake

Many protocols begin with handshake.

Handshake can establish:

1. Protocol version.
2. Authentication.
3. Compression support.
4. Maximum frame size.
5. Heartbeat interval.
6. Feature flags.
7. Tenant/session identity.
8. Resume token.

Example:

```text
CLIENT_HELLO
  version=2
  supportedCompression=[none,gzip,zstd]
  maxFrameSize=1048576
  authToken=...

SERVER_HELLO
  version=2
  compression=none
  maxFrameSize=524288
  heartbeatInterval=30s
```

### 22.1 Handshake Risks

1. Negotiation downgrade attack.
2. Client/server disagree silently.
3. Missing timeout.
4. Unbounded auth payload.
5. Feature flag ambiguity.
6. Version explosion.

---

## 23. Graceful Shutdown and Draining

Protocol should define shutdown.

Bad:

```text
server closes connection suddenly
```

Better:

```text
SERVER -> GOAWAY noNewRequests=true lastAcceptedId=1205
CLIENT -> stop sending new requests
SERVER -> finish in-flight <= 1205
SERVER -> close after timeout
```

HTTP/2 has a GOAWAY concept. Custom multiplexed protocols should have similar draining semantics.

### 23.1 Why It Matters

Without graceful shutdown:

1. Deploy causes request failures.
2. Client retries ambiguous operations.
3. Connection pool keeps stale connections.
4. Load balancer deregistration races with in-flight work.
5. Tail latency spikes during rolling restart.

---

## 24. Observability Fields in Protocol Design

Protocol should carry observability safely.

Common metadata:

```text
correlation-id
traceparent
request-id
idempotency-key
client-version
operation-name
tenant-id (careful)
deadline/timeout budget
```

### 24.1 Rules

1. Correlation id is not authentication.
2. Do not trust client-supplied tenant/user without auth binding.
3. Do not log sensitive payload by default.
4. Propagate trace context across service boundary.
5. Include operation name in metrics.
6. Separate protocol error from business error.

---

## 25. Deadline Propagation

Protocol should support deadlines, not just local timeout.

Local timeout:

```text
Client waits max 2s.
```

Deadline propagation:

```text
Client tells server: this request expires at T or has 1800ms remaining.
```

Why it matters:

1. Server can stop useless work.
2. Downstream calls can budget time.
3. Retry can respect remaining time.
4. Queueing can reject early.
5. Observability can explain deadline exhaustion.

In gRPC, deadlines are first-class: a client can specify how long it is willing to wait before the RPC terminates with `DEADLINE_EXCEEDED`, and server-side code can observe timeout/cancellation behavior.

---

## 26. Cancellation Semantics

Cancellation means:

> The caller is no longer interested in the result.

It does not automatically mean:

> The server rolled back all side effects.

Protocol must define:

1. Can client cancel in-flight request?
2. Is cancellation best-effort?
3. Does server acknowledge cancellation?
4. What if side effect already committed?
5. What final status is reported?
6. Does cancellation propagate downstream?

For business operations, cancellation must be modeled carefully. Cancelling a report generation is different from cancelling a payment.

---

## 27. Flow Control and Backpressure

Without flow control, fast sender can kill slow receiver.

### 27.1 Basic Flow Control Mechanisms

1. Max frame size.
2. Max in-flight requests.
3. Max stream count.
4. Max unacknowledged bytes.
5. Window update.
6. Server busy response.
7. Rate limit.
8. Queue bound.

### 27.2 Application Backpressure

Example:

```text
client uploads 10GB
server parses and writes to DB slowly
socket receive buffer fills
TCP window shrinks
client write blocks/slows
```

This is transport backpressure.

But application also needs:

```text
max upload size
max parsing memory
max DB queue
max concurrent uploads
```

### 27.3 Multiplexing Backpressure

In multiplexed protocol, one connection has many streams.

Need both:

```text
connection-level flow control
stream-level flow control
```

Otherwise one large stream can starve small requests.

---

## 28. Security Considerations in Protocol Design

### 28.1 Must-Have Limits

Every protocol parser needs:

```text
max header size
max frame size
max payload size
max metadata count
max metadata key/value size
max nesting depth
max string length
max stream duration
max concurrent streams
max in-flight requests
read timeout
write timeout / deadline
idle timeout
```

### 28.2 Common Attacks

1. Oversized frame.
2. Infinite stream.
3. Slowloris.
4. Compression bomb.
5. Parser ambiguity.
6. Header injection.
7. Deserialization exploit.
8. Replay attack.
9. Downgrade attack.
10. Resource exhaustion via many idle connections.

### 28.3 Principle

> A parser is part of your attack surface.

Do not treat protocol parsing as harmless plumbing.

---

## 29. Mini Design: A Safe Simple RPC Protocol

Assume we need a toy binary RPC protocol over TCP.

### 29.1 Requirements

1. Multiple request types.
2. Request-response.
3. Concurrent in-flight requests.
4. Max payload 1MB.
5. Protocol versioning.
6. Deadline metadata.
7. Error response.
8. Graceful shutdown.

### 29.2 Frame Header

```text
magic          4 bytes  0x4A525043  // "JRPC"
version        1 byte
messageType    1 byte   // request/response/error/ping/pong/goaway
flags          2 bytes
correlationId  8 bytes
headerLength   4 bytes
payloadLength  4 bytes
```

Total fixed header: 24 bytes.

Then:

```text
[extension headers][payload]
```

### 29.3 Message Types

```text
1 REQUEST
2 RESPONSE
3 ERROR
4 PING
5 PONG
6 CANCEL
7 GOAWAY
```

### 29.4 Extension Headers

Could be TLV:

```text
1 operation-name string
2 deadline-ms int64
3 content-type string
4 compression string
5 traceparent string
6 idempotency-key string
```

### 29.5 Payload

Payload can be JSON or Protobuf.

For JSON:

```json
{
  "caseId": "C-001",
  "action": "APPROVE"
}
```

For Protobuf, payload is binary encoded message.

### 29.6 Error Payload

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Invalid transition",
  "retryable": false,
  "details": {
    "from": "DRAFT",
    "to": "APPROVED"
  }
}
```

### 29.7 Lifecycle

```text
connect
client hello
server hello
request frames
response/error frames
optional ping/pong
server goaway during drain
close
```

### 29.8 Critical Invariants

1. Magic must match.
2. Version must be supported.
3. Header length <= maxHeaderSize.
4. Payload length <= maxPayloadSize.
5. Unknown critical flags rejected.
6. Correlation id must be unique for active request.
7. Deadline must be enforced.
8. Cancel must be best-effort and observable.
9. GOAWAY stops new request on connection.
10. All parser failures close connection unless recoverable by frame boundary.

---

## 30. How This Maps to HTTP and gRPC

### 30.1 HTTP

HTTP already provides:

1. Request/response model.
2. Method, path, headers, body.
3. Status code.
4. Content negotiation.
5. Chunking in HTTP/1.1.
6. Multiplexed streams in HTTP/2.
7. Caching semantics.
8. Intermediary compatibility.

But you still design:

1. Resource model.
2. Idempotency.
3. Error body.
4. Pagination.
5. Versioning.
6. Retry behavior.
7. Observability headers.
8. Timeout/deadline behavior.

### 30.2 gRPC

gRPC already provides:

1. Protobuf schema.
2. RPC method model.
3. Unary and streaming calls.
4. Metadata.
5. Deadline.
6. Cancellation.
7. Status codes.
8. HTTP/2 transport.
9. Flow-control foundation.

But you still design:

1. Service boundaries.
2. Message evolution.
3. Idempotency.
4. Error details.
5. Retry policy.
6. Streaming lifecycle.
7. Backpressure behavior.
8. Operational ownership.

---

## 31. Java 8–25 Perspective

### 31.1 Java 8

Common stack:

1. `Socket`, `ServerSocket`.
2. NIO `SocketChannel`, `Selector`.
3. Netty.
4. Apache HttpClient.
5. OkHttp.
6. Servlet containers.

For custom protocol, Netty is often preferable to hand-written selector code.

### 31.2 Java 11+

JDK includes `java.net.http.HttpClient`, making modern HTTP client capability available in standard library.

This changes baseline choice for HTTP but does not eliminate need to understand protocol behavior.

### 31.3 Java 21–25

Virtual threads make blocking-style network code more scalable from a thread perspective.

But they do not remove:

1. Socket limits.
2. File descriptor limits.
3. Connection pool limits.
4. Remote server capacity.
5. Bandwidth limits.
6. Timeout requirements.
7. Backpressure requirements.
8. Payload limits.

Structured concurrency helps model related concurrent operations as one unit with cancellation/error propagation, which is highly relevant to request fan-out and deadline-aware network calls.

---

## 32. Common Anti-Patterns

### 32.1 Assuming One Read Equals One Message

Bad:

```java
int n = in.read(buffer);
handle(buffer, n);
```

Why bad:

1. Could be partial message.
2. Could contain multiple messages.
3. Could split header/payload.

### 32.2 Unbounded Payload

Bad:

```java
int length = readLength();
byte[] payload = new byte[length];
```

Without max length, remote peer controls your memory.

### 32.3 No Version Field

Without versioning, every protocol change becomes risky.

### 32.4 No Error Taxonomy

If every failure is `ERROR`, clients cannot decide retry/cancel/escalate.

### 32.5 No Correlation ID

Without correlation id, async/multiplexed design becomes fragile.

### 32.6 Using Java Native Serialization Over Network

Danger:

1. Tight Java class coupling.
2. Security risk.
3. Poor cross-language interoperability.
4. Fragile versioning.
5. Hard to inspect.

### 32.7 Logging Raw Payload

Danger:

1. PII leakage.
2. Token leakage.
3. Compliance issue.
4. Huge log volume.
5. Incident amplification.

### 32.8 Retrying Ambiguous Writes Without Idempotency

This can duplicate side effects.

---

## 33. Production Diagnostic Questions

When debugging protocol-level issue, ask:

1. Did DNS resolve to expected endpoint?
2. Did TCP connect succeed?
3. Did TLS handshake succeed?
4. Did protocol handshake succeed?
5. Did client send full frame?
6. Did server receive full frame?
7. Did framing parser accept it?
8. Did schema parser accept it?
9. Did operation router understand it?
10. Did auth accept it?
11. Did deadline expire before processing?
12. Was response written fully?
13. Did connection close gracefully or reset?
14. Did client read response before timeout?
15. Was retry safe?
16. Was duplicate suppressed?
17. Are logs linked by correlation id?
18. Are metrics split by operation/error class?

---

## 34. Case Study: “Random EOF” in Custom Protocol

Symptom:

```text
java.io.EOFException: Connection closed while reading frame
```

Possible causes:

1. Server closed idle connection.
2. Client reused stale pooled connection.
3. Peer rejected malformed previous frame and closed.
4. Payload length larger than allowed; server closed.
5. TLS/proxy/load balancer closed connection.
6. Server crashed/restarted.
7. Protocol version mismatch.
8. Client read expected payload but server sent error frame with different format.

Bad analysis:

```text
Network issue.
```

Better analysis:

```text
EOF occurred in READ_PAYLOAD after header length=65536, already read=8192.
Connection age=29m59s, ALB idle timeout=30m.
No GOAWAY/drain frame.
Client retry attempted non-idempotent operation.
```

This points to idle timeout mismatch plus unsafe retry design.

---

## 35. Case Study: “Protocol Upgrade Broke Old Clients”

Change:

```text
Server now requires field tenantId in request payload.
```

Old clients do not send it.

Failure:

```text
Old clients receive VALIDATION_FAILED.
```

Root cause:

```text
Added required request field without compatibility path.
```

Better rollout:

1. Add optional field.
2. Server infers tenant from auth/session for old clients.
3. Emit warning metric for missing field.
4. Roll clients gradually.
5. After adoption, enforce per client version or major API version.
6. Keep compatibility contract documented.

---

## 36. Design Checklist

Before designing or approving a protocol, answer:

### 36.1 Framing

- [ ] How does receiver know frame boundary?
- [ ] Is max frame size defined?
- [ ] Is max header size defined?
- [ ] Can payload contain delimiter safely?
- [ ] What happens on partial frame?
- [ ] What happens on invalid length?

### 36.2 Lifecycle

- [ ] Is there handshake?
- [ ] Is version negotiated?
- [ ] Is graceful shutdown defined?
- [ ] Are ping/pong semantics defined?
- [ ] Are idle timeout semantics defined?

### 36.3 Request Semantics

- [ ] Is operation name/type explicit?
- [ ] Is correlation id present?
- [ ] Is deadline propagated?
- [ ] Is cancellation supported?
- [ ] Is idempotency modeled?

### 36.4 Error Semantics

- [ ] Are protocol errors distinct from business errors?
- [ ] Are retryable errors explicit?
- [ ] Are malformed requests rejected safely?
- [ ] Are unsupported versions clear?
- [ ] Are errors observable without leaking secrets?

### 36.5 Compatibility

- [ ] Can old client talk to new server?
- [ ] Can new client talk to old server?
- [ ] Are unknown fields handled?
- [ ] Are deleted fields reserved?
- [ ] Is semantic compatibility documented?

### 36.6 Security

- [ ] Are parser limits enforced?
- [ ] Is authentication bound to identity/tenant?
- [ ] Are compression limits enforced?
- [ ] Are replay risks addressed?
- [ ] Are logs sanitized?

### 36.7 Operations

- [ ] Are metrics per operation available?
- [ ] Are frame/protocol errors counted?
- [ ] Are pool/connection metrics available?
- [ ] Is trace context propagated?
- [ ] Is there a failure playbook?

---

## 37. Exercises

### Exercise 1 — Design a Length-Prefixed Protocol

Design a frame format for a Java service that receives commands from internal clients.

Requirements:

1. Max payload 512KB.
2. JSON payload.
3. Operation name in header.
4. Correlation id.
5. Deadline.
6. Error response.
7. Graceful shutdown.

Deliver:

1. Header fields.
2. State machine.
3. Error taxonomy.
4. Compatibility rules.

### Exercise 2 — Diagnose Partial Read Bug

Given code:

```java
byte[] header = new byte[4];
in.read(header);
int length = ByteBuffer.wrap(header).getInt();
byte[] payload = new byte[length];
in.read(payload);
```

Find all bugs.

Expected findings:

1. `read(header)` may read fewer than 4 bytes.
2. EOF not checked.
3. Negative length not checked.
4. Max length not checked.
5. Integer/memory risk.
6. `read(payload)` may read fewer than `length` bytes.
7. Timeout behavior unspecified.
8. No protocol error handling.

### Exercise 3 — Compatibility Review

A team proposes:

```text
v1 field: status = "OPEN" | "CLOSED"
v2 field: status = "OPEN" | "CLOSED" | "ARCHIVED"
```

Questions:

1. Will old clients break?
2. Should unknown enum be mapped to `UNKNOWN`?
3. Should client fail closed or tolerate?
4. Is this wire-compatible but semantically risky?

### Exercise 4 — Retry Safety

Operation:

```text
POST /payments
```

Client sends request, gets connection reset after write, then retries.

Design idempotency model to avoid double charge.

---

## 38. Key Takeaways

1. TCP is a byte stream; protocol gives meaning.
2. Framing is mandatory for message-oriented communication over TCP.
3. `read()` is not message receive; `write()` is not remote commit.
4. Length-prefix is common and robust if bounded and validated.
5. Delimiter protocols must be bounded and escaped.
6. Streaming requires lifecycle, ordering, cancellation, and flow control.
7. Multiplexing requires correlation id and in-flight state management.
8. Compatibility is a protocol feature, not a documentation afterthought.
9. Error taxonomy determines retry safety.
10. Idempotency is mandatory for ambiguous network failure with side effects.
11. Parser limits are security controls.
12. HTTP and gRPC solve many protocol problems, but not your domain semantics.
13. Custom protocol should be rare, deliberate, tested, observable, and bounded.

---

## 39. References

- RFC 9112 — HTTP/1.1, especially message body length and chunked transfer coding: https://datatracker.ietf.org/doc/html/rfc9112
- Protocol Buffers proto3 language guide: https://protobuf.dev/programming-guides/proto3/
- Protocol Buffers editions language guide: https://protobuf.dev/programming-guides/editions/
- gRPC Core Concepts: https://grpc.io/docs/what-is-grpc/core-concepts/
- gRPC Deadlines: https://grpc.io/docs/guides/deadlines/
- gRPC Cancellation: https://grpc.io/docs/guides/cancellation/
- gRPC Status Codes: https://grpc.io/docs/guides/status-codes/
- Netty `LengthFieldBasedFrameDecoder`: https://netty.io/4.2/api/io/netty/handler/codec/LengthFieldBasedFrameDecoder.html
- Netty `ByteToMessageDecoder`: https://netty.io/4.0/api/io/netty/handler/codec/ByteToMessageDecoder.html

---

## 40. Part Completion

Part 5 selesai.

Seri belum selesai.

Part berikutnya:

```text
Part 6 — Serialization on the Wire: JSON, XML, Protobuf, Avro, CBOR, and Java Object Serialization Risks
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./004-java-socket-internals-blocking-socket-serversocket-socketchannel-selector-revisited.md">⬅️ Part 4 — Java Socket Internals: Blocking Socket, ServerSocket, SocketChannel, and Selector Revisited</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./006-serialization-on-the-wire-json-xml-protobuf-avro-cbor-java-object-serialization-risks.md">Part 6 — Serialization on the Wire: JSON, XML, Protobuf, Avro, CBOR, and Java Object Serialization Risks ➡️</a>
</div>
