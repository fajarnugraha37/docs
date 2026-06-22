# Part 30 — Large Payload and File Transfer: Upload, Download, Multipart, Range, Resume, Checksums, and Memory Safety

> Seri: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `030-large-payload-file-transfer-upload-download-multipart-range-resume-checksums-memory-safety.md`  
> Target: Java 8–25, advanced backend/network engineer  
> Prasyarat: Part 0–29, terutama HTTP/1.1, HTTP/2, streaming HTTP, timeout, retry, pooling, observability, performance, dan backpressure.

---

## 1. Tujuan Bagian Ini

Bagian ini membahas **large payload and file transfer** sebagai problem engineering yang berbeda dari request/response API biasa.

Pada API kecil, developer sering berpikir:

```text
request masuk -> parse JSON -> proses -> return JSON
```

Pada transfer payload besar, model tersebut runtuh. Payload mungkin puluhan MB, ratusan MB, beberapa GB, atau lebih. Jika payload dibaca penuh ke memory, efeknya bisa fatal:

```text
heap bloat
-> GC pressure
-> tail latency naik
-> thread tertahan
-> connection pool penuh
-> pod restart / OOMKilled
-> upload gagal di tengah
-> user retry
-> duplicate partial object
-> storage orphan
-> audit ambiguity
```

Mental model yang benar:

```text
large transfer adalah pipeline berumur panjang

source
-> bounded buffer
-> validation / checksum / scan / transform
-> bounded buffer
-> sink

Setiap stage punya:
- throughput
- backpressure
- timeout
- cancellation
- resource ownership
- failure semantics
- observability
```

Tujuan bagian ini:

1. Memahami kenapa large payload berbeda dari API biasa.
2. Membedakan buffering, streaming, spooling, chunking, multipart, range, dan resumable transfer.
3. Mendesain upload/download Java yang tidak membunuh heap.
4. Memahami HTTP headers penting: `Content-Length`, `Transfer-Encoding`, `Content-Type`, `Content-Disposition`, `Range`, `Content-Range`, `ETag`, checksum headers.
5. Mendesain resume, retry, checksum, integrity, dan idempotency.
6. Menghindari failure umum: slow client, proxy buffering, timeout mismatch, partial file, orphan object, request body leak, dan decompression bomb.
7. Menentukan kapan Java service harus menjadi data plane, kapan cukup control plane dengan object storage pre-signed URL.

---

## 2. Core Thesis: Large Payload Is Not “Just Bigger JSON”

Payload kecil biasanya bisa diperlakukan sebagai value:

```text
read body fully
parse
validate
process
return response
```

Payload besar harus diperlakukan sebagai stream:

```text
read small segment
validate/update checksum
write small segment
repeat
commit only after full success
```

Perbedaannya fundamental.

| Aspek | Small JSON API | Large Payload Transfer |
|---|---|---|
| Memory model | Whole body acceptable | Whole body dangerous |
| Latency | Short request | Long-lived operation |
| Retry | Often simple | Risk duplicate partial data |
| Timeout | Request timeout | Per-phase + total + idle timeout |
| Observability | One span enough | Progress, bytes, rate, phase needed |
| Failure | Mostly atomic | Partial success common |
| Security | Schema validation | Size limit, content sniffing, malware scan, decompression bomb |
| Storage | DB transaction often enough | Object storage/temp file/staging commit needed |
| Backpressure | Less visible | Central design concern |

Top-tier engineer tidak bertanya “bagaimana upload file di Java?”, tetapi:

```text
Apakah service ini seharusnya menerima byte besar langsung?
Berapa max size?
Di mana byte disimpan sementara?
Apa commit point-nya?
Bagaimana membedakan upload gagal, upload selesai tapi commit gagal, dan duplicate retry?
Bagaimana memastikan file yang diterima sama dengan file yang dikirim?
Bagaimana membatalkan transfer tanpa leak resource?
Bagaimana melindungi dependency lain dari slow client?
```

---

## 3. Taxonomy Transfer Data Besar

### 3.1 Upload ke Java Service

```text
client -> Java service -> storage/database/object store
```

Cocok jika service perlu:

- validasi access control sebelum byte diterima,
- parsing streaming,
- virus scan inline,
- metadata extraction,
- transform/encryption,
- audit full control,
- enforce domain workflow.

Risiko:

- Java service menjadi data plane,
- connection lama,
- memory/disk pressure,
- pod disruption bisa memutus upload,
- scaling lebih mahal.

### 3.2 Download dari Java Service

```text
storage/database/object store -> Java service -> client
```

Cocok jika service perlu:

- authorization per request,
- watermarking/transformation,
- generated report,
- response audit,
- field-level filtering,
- masking.

Risiko:

- slow client menahan resource server,
- proxy buffering,
- heap/direct memory pressure,
- timeout mismatch.

### 3.3 Direct-to-Object-Storage Upload

```text
client -> object storage
client -> Java service: commit metadata
```

Atau:

```text
Java service -> generate pre-signed URL / upload policy
client -> object storage
object storage event / client callback -> Java service commit
```

Cocok untuk payload besar, terutama jika service tidak perlu inspect byte inline.

Kelebihan:

- Java service tidak menjadi data plane,
- scale lebih murah,
- lebih mudah multipart/resume,
- object storage menangani durability.

Trade-off:

- butuh desain commit state,
- authorization harus diikat ke policy/URL,
- object orphan cleanup,
- scan/validation mungkin async,
- audit harus eksplisit.

### 3.4 Service-to-Service File Transfer

```text
service A -> service B
```

Pertanyaan penting:

```text
Apakah perlu HTTP direct?
Apakah lebih baik via object storage handoff?
Apakah perlu event metadata saja?
Apakah transfer harus synchronous?
```

Untuk banyak sistem enterprise, pola lebih stabil adalah:

```text
producer writes object
producer emits event/metadata
consumer fetches object when ready
consumer commits processing result
```

---

## 4. Core Transfer Patterns

### 4.1 Full Buffering

```java
byte[] body = request.getInputStream().readAllBytes();
```

Ini mudah tetapi berbahaya untuk large payload.

Masalah:

- payload masuk heap,
- multipart parser bisa menyimpan banyak part,
- concurrent upload memperbesar memory linear,
- GC dan OOM risk,
- attacker bisa mengirim banyak request besar.

Formula sederhana:

```text
heap_needed ≈ concurrent_uploads × max_payload_size × overhead_factor
```

Jika 50 upload × 100 MB:

```text
minimum 5 GB hanya untuk body mentah
```

Belum termasuk object, parser, framework, thread stack, buffer lain, dan GC overhead.

### 4.2 Streaming

```text
read N KB -> process -> write N KB
```

Karakteristik:

- memory bounded,
- cocok untuk file besar,
- failure bisa terjadi setelah sebagian byte diproses,
- perlu cleanup/commit semantics.

Java idiom:

```java
try (InputStream in = requestInput;
     OutputStream out = storageOutput) {
    byte[] buffer = new byte[64 * 1024];
    int read;
    while ((read = in.read(buffer)) != -1) {
        out.write(buffer, 0, read);
    }
}
```

Namun production-grade streaming bukan hanya loop. Harus ada:

```text
max bytes
timeout/deadline
checksum
cancellation handling
temp object cleanup
observability
backpressure
commit only after success
```

### 4.3 Spooling to Disk

```text
client -> Java service -> temp file -> validation/scan -> final storage
```

Kelebihan:

- heap aman,
- bisa scan/parse ulang,
- upload network dan processing bisa dipisah,
- validasi bisa dilakukan sebelum commit.

Risiko:

- disk penuh,
- temp file orphan,
- local disk ephemeral di container,
- pod restart kehilangan temp,
- cleanup harus reliable.

Rule:

```text
spooling bukan gratis; ia memindahkan pressure dari heap ke disk
```

### 4.4 Chunked Upload Application-Level

```text
POST /uploads          -> create upload session
PUT /uploads/{id}/parts/1
PUT /uploads/{id}/parts/2
PUT /uploads/{id}/parts/3
POST /uploads/{id}/complete
```

Cocok jika:

- payload besar,
- jaringan tidak stabil,
- client perlu resume,
- transfer bisa berlangsung lama,
- audit/progress penting.

Butuh desain:

- upload session state,
- part number / offset,
- per-part checksum,
- final checksum,
- idempotency per part,
- complete/abort,
- TTL cleanup,
- authorization stability.

### 4.5 HTTP Range Download

```http
GET /files/{id}
Range: bytes=1000000-1999999
```

Server response:

```http
206 Partial Content
Content-Range: bytes 1000000-1999999/5000000
Accept-Ranges: bytes
```

Range download memungkinkan:

- resume download,
- parallel segmented download,
- partial read,
- video/PDF seeking,
- retry bagian gagal.

Namun harus hati-hati:

- range harus berdasarkan representation yang stabil,
- gunakan `ETag` / `If-Range`,
- jangan izinkan range explosion yang membebani server,
- pastikan authorization tetap benar.

RFC 9110 mendefinisikan range request, `Accept-Ranges`, `Content-Range`, dan status `206 Partial Content` untuk transfer sebagian representasi HTTP.

---

## 5. HTTP Headers yang Penting untuk Large Transfer

### 5.1 `Content-Length`

Menunjukkan ukuran body dalam byte.

Kegunaan:

- reject lebih awal jika terlalu besar,
- progress bar,
- allocation planning,
- integrity basic check,
- connection reuse correctness.

Masalah:

- bisa tidak ada pada streaming/chunked,
- bisa salah/malicious,
- proxy bisa mengubah framing,
- jangan percaya tanpa limit aktual saat membaca.

Rule:

```text
Content-Length boleh membantu keputusan awal,
tetapi server tetap wajib enforce max bytes saat membaca stream.
```

### 5.2 `Transfer-Encoding: chunked`

Pada HTTP/1.1, memungkinkan response/request dikirim tanpa `Content-Length` upfront.

Kegunaan:

- generated response,
- streaming response,
- unknown total size.

Risiko:

- server harus enforce total max bytes,
- proxy buffering bisa menghilangkan manfaat streaming,
- ambiguity dengan `Content-Length` harus ditolak untuk mencegah request smuggling.

### 5.3 `Content-Type`

Contoh:

```http
Content-Type: application/pdf
Content-Type: image/png
Content-Type: multipart/form-data; boundary=----abc
Content-Type: application/octet-stream
```

Rule:

```text
Content-Type adalah klaim client, bukan bukti.
```

Untuk domain sensitif:

- validate magic bytes,
- inspect file signature,
- scan malware,
- reject unsupported type,
- normalize extension,
- jangan derive trust hanya dari filename.

### 5.4 `Content-Disposition`

Untuk download:

```http
Content-Disposition: attachment; filename="report.pdf"
```

Risiko:

- filename injection,
- path traversal,
- CRLF injection,
- Unicode spoofing.

Rule:

```text
filename untuk user convenience, bukan storage path.
```

### 5.5 `Range`, `Accept-Ranges`, `Content-Range`, `If-Range`

Digunakan untuk partial/resumable download.

Pattern aman:

```http
GET /files/123
Range: bytes=1000-
If-Range: "etag-value"
```

Jika representation masih sama, server mengirim `206`. Jika berubah, server bisa mengirim full `200`.

### 5.6 `ETag`

Untuk transfer besar, `ETag` berguna sebagai representation identity.

Namun hati-hati:

```text
ETag belum tentu checksum file mentah.
```

Pada object storage multipart, ETag bisa merepresentasikan multipart digest format, bukan MD5 penuh. Jangan jadikan ETag sebagai universal checksum kecuali semantik storage diketahui.

### 5.7 Checksum Headers

Untuk integrity, desain header eksplisit:

```http
Digest: sha-256=...
X-Checksum-SHA256: ...
```

Atau storage-specific checksum metadata.

Checksum berguna untuk:

- detect corruption,
- verify upload completeness,
- deduplicate,
- audit evidence,
- compare object after transfer.

Tetapi checksum bukan authentication kecuali memakai keyed MAC/signature.

---

## 6. Multipart Form Upload

`multipart/form-data` digunakan untuk form yang membawa field biasa dan file dalam satu request. RFC 7578 mendefinisikan media type `multipart/form-data`.

Contoh:

```http
POST /cases/123/documents
Content-Type: multipart/form-data; boundary=abc

--abc
Content-Disposition: form-data; name="documentType"

EVIDENCE
--abc
Content-Disposition: form-data; name="file"; filename="evidence.pdf"
Content-Type: application/pdf

(binary bytes)
--abc--
```

Kelebihan:

- metadata + file dalam satu request,
- familiar untuk browser,
- mudah untuk form upload.

Risiko:

- parser bisa buffer ke memory/disk,
- banyak part kecil bisa jadi DoS,
- nested multipart/headers bisa kompleks,
- filename tidak aman,
- part size harus dibatasi,
- total request size harus dibatasi.

Checklist multipart aman:

```text
Set max total request size
Set max file size
Set max part count
Set max header size
Stream file part
Spool ke disk/object storage, bukan heap
Validate filename, content-type, magic bytes
Reject unknown parts
Commit metadata only after file success
Cleanup temp file on failure
Record checksum and byte count
```

---

## 7. Java Server-Side Upload: Safe Streaming Design

### 7.1 Bad Pattern: Read All Bytes

```java
@PostMapping("/upload")
public ResponseEntity<?> upload(HttpServletRequest request) throws IOException {
    byte[] data = request.getInputStream().readAllBytes();
    storage.save(data);
    return ResponseEntity.ok().build();
}
```

Masalah:

- heap proportional terhadap file size,
- concurrent upload berbahaya,
- tidak ada max byte guard,
- tidak ada checksum,
- tidak ada partial cleanup,
- response hanya sukses/gagal kasar.

### 7.2 Better Pattern: Streaming With Max Byte Guard

```java
public final class MaxBytesInputStream extends FilterInputStream {
    private final long maxBytes;
    private long count;

    public MaxBytesInputStream(InputStream in, long maxBytes) {
        super(in);
        this.maxBytes = maxBytes;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int read = super.read(b, off, len);
        if (read > 0) {
            count += read;
            if (count > maxBytes) {
                throw new PayloadTooLargeException("Payload exceeds " + maxBytes + " bytes");
            }
        }
        return read;
    }

    @Override
    public int read() throws IOException {
        int value = super.read();
        if (value != -1) {
            count++;
            if (count > maxBytes) {
                throw new PayloadTooLargeException("Payload exceeds " + maxBytes + " bytes");
            }
        }
        return value;
    }

    public long bytesRead() {
        return count;
    }
}
```

Example streaming pipeline:

```java
public UploadResult receiveUpload(InputStream requestBody,
                                  long maxBytes,
                                  Path stagingFile) throws IOException, NoSuchAlgorithmException {
    MessageDigest sha256 = MessageDigest.getInstance("SHA-256");

    try (InputStream limited = new BufferedInputStream(new MaxBytesInputStream(requestBody, maxBytes));
         DigestInputStream digestIn = new DigestInputStream(limited, sha256);
         OutputStream out = new BufferedOutputStream(Files.newOutputStream(
             stagingFile,
             StandardOpenOption.CREATE_NEW,
             StandardOpenOption.WRITE))) {

        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        int read;

        while ((read = digestIn.read(buffer)) != -1) {
            out.write(buffer, 0, read);
            total += read;
        }

        out.flush();

        return new UploadResult(total, HexFormat.of().formatHex(sha256.digest()));
    }
}
```

Untuk Java 8, `HexFormat` belum ada. Gunakan formatter sendiri atau library aman.

### 7.3 Commit Protocol

Jangan langsung simpan sebagai final file saat byte mulai masuk.

Gunakan state:

```text
INITIATED
RECEIVING
RECEIVED
VALIDATING
READY
FAILED
ABORTED
EXPIRED
```

Flow:

```text
1. Create upload record: INITIATED
2. Stream bytes to staging location
3. Compute checksum + byte count
4. Mark RECEIVED
5. Validate type / scan / metadata
6. Move/commit to final storage atomically where possible
7. Mark READY
8. Cleanup staging
```

Jika gagal di tengah:

```text
mark FAILED
cleanup staging
record reason
return safe error
```

### 7.4 Why Staging Matters

Tanpa staging, client bisa melihat file setengah jadi.

Staging memberi invariant:

```text
Only READY objects are visible to business operations.
```

Untuk regulatory/case-management systems, invariant ini penting:

```text
case evidence tidak boleh dianggap submitted jika byte transfer belum selesai dan integrity belum diverifikasi.
```

---

## 8. Java Client-Side Upload

### 8.1 JDK HttpClient Upload From File

Java `HttpClient` menyediakan `BodyPublisher` untuk mengirim request body sebagai flow of byte buffers. `BodyPublishers.ofFile(...)` memungkinkan upload dari file tanpa harus membaca seluruh file ke heap.

```java
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(3))
    .build();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/upload"))
    .timeout(Duration.ofMinutes(5))
    .header("Content-Type", "application/octet-stream")
    .POST(HttpRequest.BodyPublishers.ofFile(Path.of("large.pdf")))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
```

Java SE 25 `HttpClient` dapat dipakai untuk banyak request setelah dibuat dan builder-nya mengatur konfigurasi client-level seperti preferred protocol version, redirect, proxy, authenticator, dan connect timeout. `BodyHandlers` menyediakan handler untuk berbagai response body termasuk streaming ke file.

### 8.2 Upload From InputStream

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/upload"))
    .timeout(Duration.ofMinutes(5))
    .POST(HttpRequest.BodyPublishers.ofInputStream(() -> openInputStreamSafely()))
    .build();
```

Hati-hati:

- supplier bisa dipanggil saat request dikirim,
- retry otomatis berbahaya jika stream tidak replayable,
- stream harus bisa dibuka ulang jika retry manual,
- jangan capture `InputStream` yang sudah dibaca.

Bad:

```java
InputStream in = Files.newInputStream(path);
BodyPublisher publisher = BodyPublishers.ofInputStream(() -> in); // bad for retry/reuse
```

Better:

```java
BodyPublisher publisher = BodyPublishers.ofInputStream(() -> {
    try {
        return Files.newInputStream(path);
    } catch (IOException e) {
        throw new UncheckedIOException(e);
    }
});
```

### 8.3 Retry Upload: Only If Replayable and Idempotent

Retry upload aman hanya jika:

```text
request body replayable
operation idempotent
server can suppress duplicate
partial object cleaned or overwritten safely
checksum verified
```

Untuk upload besar, lebih aman desain:

```text
create upload session
upload part with part number + checksum
complete upload with final checksum
```

Daripada retry satu request besar dari awal tanpa state.

---

## 9. Java Download: Memory-Safe Response Handling

### 9.1 Bad Pattern

```java
HttpResponse<byte[]> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofByteArray()
);
```

Untuk file besar, ini memasukkan seluruh response ke heap.

### 9.2 Download to File

```java
HttpResponse<Path> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofFile(Path.of("download.tmp"))
);
```

Lalu validasi:

```text
status code
Content-Length if present
actual file size
checksum
content type
```

Setelah sukses:

```text
move tmp -> final
```

### 9.3 Download as InputStream

```java
HttpResponse<InputStream> response = client.send(
    request,
    HttpResponse.BodyHandlers.ofInputStream()
);

try (InputStream in = response.body()) {
    // stream and close
}
```

Penting:

```text
InputStream body harus dibaca, ditutup, atau dibatalkan.
```

Jika tidak, connection bisa tertahan dan pool bisa bocor.

### 9.4 Temporary File Discipline

Pattern aman:

```text
write to random temp path
fsync if needed
validate checksum
atomic move to final path
record metadata
```

Jangan langsung tulis ke nama final:

```text
report.pdf
```

Gunakan:

```text
report.pdf.part-<uuid>
```

Setelah valid:

```text
atomic rename if same filesystem
```

---

## 10. Resumable Download with Range

### 10.1 Basic Resume Flow

```text
1. Start download
2. Store bytes in file.part
3. Connection fails at byte N
4. Send Range: bytes=N-
5. Append response body
6. Verify final length + checksum
7. Rename to final
```

Request:

```http
GET /files/abc
Range: bytes=1048576-
If-Range: "etag-from-initial-response"
```

Response:

```http
206 Partial Content
Content-Range: bytes 1048576-9999999/10000000
```

### 10.2 Resume Safety Conditions

Resume aman jika:

```text
representation stable
server supports byte range
client validates Content-Range
ETag or version unchanged
append offset exactly matches local file length
final checksum matches expected digest
```

Jika representation berubah:

```text
discard partial file and restart
```

### 10.3 Range Abuse Protection

Server harus membatasi:

- terlalu banyak ranges,
- overlapping ranges,
- extremely fragmented ranges,
- range terhadap generated dynamic content mahal,
- range tanpa authorization.

Sering lebih sederhana:

```text
support only single byte range
reject multiple ranges with 416 or 400 depending policy
```

---

## 11. Resumable Upload Design

### 11.1 Upload Session Model

API:

```http
POST /uploads
Content-Type: application/json

{
  "fileName": "evidence.pdf",
  "size": 734003200,
  "sha256": "...",
  "contentType": "application/pdf",
  "purpose": "CASE_EVIDENCE"
}
```

Response:

```json
{
  "uploadId": "upl_123",
  "partSize": 8388608,
  "expiresAt": "2026-06-18T12:00:00Z"
}
```

Upload part:

```http
PUT /uploads/upl_123/parts/7
Content-Range: bytes 50331648-58720255/734003200
X-Part-SHA256: ...
```

Complete:

```http
POST /uploads/upl_123/complete

{
  "sha256": "...",
  "parts": [
    { "partNumber": 1, "sha256": "..." },
    { "partNumber": 2, "sha256": "..." }
  ]
}
```

### 11.2 State Machine

```text
INITIATED
  -> PARTIAL
  -> COMPLETING
  -> READY
  -> ABORTED
  -> EXPIRED
  -> FAILED
```

Invariants:

```text
Only owner can upload parts.
Part byte range must match upload session.
Part number is idempotent.
Same part number with same checksum is OK.
Same part number with different checksum is conflict.
Complete requires all parts.
Final checksum must match declared checksum.
READY is immutable.
Expired upload cannot be completed.
```

### 11.3 Idempotency Per Part

Duplicate retry of part 7:

```text
same part number + same checksum -> return success
same part number + different checksum -> 409 Conflict
```

This makes retry safe.

### 11.4 Commit Point

Completion should be the only point where object becomes business-visible:

```text
parts uploaded != document submitted
complete success != immediately approved
scan success + metadata commit = document available
```

For regulated systems:

```text
submission timestamp should align with validated completion, not first byte received.
```

---

## 12. Object Storage Handoff Pattern

### 12.1 Direct Upload With Pre-Signed URL

Flow:

```text
1. Client asks Java service: create upload intent
2. Java service verifies authorization and returns pre-signed URL/policy
3. Client uploads directly to object storage
4. Client calls complete endpoint with object key/checksum
5. Java service verifies object metadata/checksum
6. Java service records domain document
```

Benefits:

- Java service avoids data-plane load,
- object storage handles transfer scale,
- easier multipart,
- fewer long-lived connections to app pods.

Risks:

- object key leakage,
- pre-signed URL TTL too long,
- object uploaded but not committed,
- commit spoofing unless service verifies object,
- malware scan async state needed.

### 12.2 Control Plane vs Data Plane

Top-tier architecture distinction:

```text
Java service should often be control plane:
- authorization
- metadata
- policy
- workflow state
- audit
- commit

Object storage/CDN should be data plane:
- large bytes
- range download
- multipart upload
- durability
- bandwidth
```

Do not route GB files through Java service unless there is a strong reason.

### 12.3 Orphan Cleanup

Any resumable/direct upload system creates orphan risk:

```text
upload intent created, file never uploaded
file uploaded, complete never called
complete called, scan failed
user abandoned session
```

Need scheduled cleanup:

```text
expire upload sessions
abort multipart uploads
delete staging objects
record cleanup audit event
emit metrics
```

---

## 13. Checksums, Hashes, Signatures, and Integrity

### 13.1 What Checksum Solves

Checksum detects accidental corruption or mismatch:

```text
client sent A
server stored B
checksum mismatch -> reject
```

Common algorithms:

- CRC32C: fast corruption detection,
- MD5: legacy, not collision-safe,
- SHA-256: stronger content identity,
- SHA-512: stronger but larger/costlier.

### 13.2 What Checksum Does Not Solve

Checksum alone does not prove authenticity.

If attacker can alter both file and checksum:

```text
checksum still matches malicious file
```

For authenticity/integrity against attacker:

```text
HMAC
signature
TLS
mTLS
signed metadata
server-side authorization
```

### 13.3 Streaming Checksum

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");
try (DigestInputStream in = new DigestInputStream(source, digest)) {
    in.transferTo(sink); // Java 9+
}
byte[] sha256 = digest.digest();
```

For Java 8:

```java
byte[] buffer = new byte[64 * 1024];
int read;
while ((read = in.read(buffer)) != -1) {
    digest.update(buffer, 0, read);
    out.write(buffer, 0, read);
}
```

### 13.4 Per-Part and Final Checksums

For multipart upload:

```text
part checksum verifies part integrity
final checksum verifies assembled object integrity
```

Do not assume final checksum is simple concatenation unless protocol defines it.

AWS S3 supports multipart upload and additional checksum workflows; object integrity checking should use the storage provider’s documented semantics, not assumptions about ETag.

---

## 14. Timeout and Deadline for Large Transfer

Large transfer cannot use only one generic timeout.

Needed dimensions:

```text
connect timeout
TLS handshake timeout
pool acquisition timeout
first byte timeout
idle read timeout
idle write timeout
total transfer deadline
per-part deadline
scan deadline
commit deadline
```

### 14.1 Why Total Timeout Alone Is Bad

A 2 GB upload over slow network may legitimately take minutes.

But if client sends 1 byte every 30 seconds, should server keep connection forever?

Need both:

```text
total deadline: max whole operation duration
idle timeout: max no-progress period
minimum data rate: optional protection
```

### 14.2 Slow Client Protection

Slow client risk:

```text
connection held
thread/virtual thread held
request slot held
proxy slot held
temp file held
upload session held
```

Protection:

```text
max concurrent uploads
max upload duration
min throughput threshold
idle timeout
bounded staging disk
per-user quota
per-tenant quota
load shedding
```

### 14.3 Retry and Timeout

Retrying large transfer from zero is expensive.

Better:

```text
retry per part
resume by range/offset
use idempotent upload session
```

---

## 15. Backpressure and Flow Control

Large transfer is a pipeline:

```text
network read -> memory buffer -> disk/object write -> validation/scan -> commit
```

If sink is slower than source, data accumulates.

Bad implementation:

```text
read from network as fast as possible into unbounded queue
```

Good implementation:

```text
bounded buffer; if sink slows, read slows
```

For blocking I/O:

```text
blocking write naturally slows read loop if same thread copies source to sink
```

For async/reactive/event-loop:

```text
must explicitly respect demand/writability/backpressure
```

For Netty:

```text
check channel writability
avoid unbounded outbound writes
use high/low water marks
```

For WebFlux/Reactor:

```text
preserve reactive backpressure
avoid collectList()/aggregate for file content
```

For servlet blocking streaming:

```text
use bounded thread pool / virtual threads but still limit concurrent transfers
```

---

## 16. Proxy, Gateway, and Load Balancer Interactions

Large payload behavior is often changed by middleboxes.

### 16.1 Proxy Buffering

Some proxies buffer request/response before forwarding.

Effect:

```text
client thinks streaming
Java service receives only after full upload buffered by proxy
or Java service streams but client receives after proxy buffers full response
```

Impacts:

- progress misleading,
- timeout shifts to proxy,
- proxy disk pressure,
- Java observability incomplete,
- backpressure not end-to-end.

### 16.2 Body Size Limits

Limits can exist at many layers:

```text
browser
corporate proxy
CDN
API gateway
ingress controller
service mesh
application server
framework multipart config
application validation
object storage
```

All must align.

If app says 100 MB but gateway says 10 MB:

```text
client gets 413 before app sees request
```

This may be correct, but must be documented and observable.

### 16.3 Idle Timeout Mismatch

Example:

```text
Java app upload timeout: 10 min
ALB idle timeout: 60 sec
client pauses for 70 sec
-> ALB closes connection
-> app sees broken pipe / EOF / reset
```

Need timeout matrix.

---

## 17. Security Threat Model

### 17.1 Payload Too Large / Storage Exhaustion

Attack:

```text
send huge body
send many huge multipart parts
send unknown Content-Length with endless body
```

Defense:

```text
max content length
max actual bytes read
max concurrent uploads
quota per user/tenant
staging disk quota
object lifecycle cleanup
413 Payload Too Large
```

### 17.2 Decompression Bomb

Compressed file can expand massively.

Defense:

```text
limit compressed size
limit decompressed size
limit entry count
limit nesting depth
limit compression ratio
stream scan with abort
```

### 17.3 Zip Slip / Path Traversal

Archive entry:

```text
../../../../etc/passwd
```

Defense:

```text
normalize path
ensure target path remains under extraction root
reject absolute path
reject parent traversal
```

### 17.4 Malware and Unsafe Content

Pattern:

```text
upload -> staging -> scan -> quarantine/ready
```

Do not make file available before scan completes unless domain explicitly allows “pending scan” state.

### 17.5 Content-Type Spoofing

Defense:

```text
content-type allowlist
magic byte detection
extension normalization
server-generated storage key
safe download headers
```

### 17.6 SSRF via File Fetch URL

If API accepts URL to import file:

```http
POST /imports
{ "url": "http://169.254.169.254/latest/meta-data/..." }
```

Defense:

```text
block private/link-local ranges
resolve DNS safely
protect against DNS rebinding
use egress proxy allowlist
limit redirects
fetch with low timeout and size limit
```

---

## 18. Observability for Large Transfers

Basic HTTP metrics are not enough.

Need metrics:

```text
upload_started_total
upload_completed_total
upload_failed_total
upload_aborted_total
upload_bytes_total
download_bytes_total
active_uploads
active_downloads
staging_disk_used_bytes
upload_duration_seconds
upload_throughput_bytes_per_second
checksum_mismatch_total
scan_failed_total
orphan_cleanup_total
range_request_total
partial_download_resumed_total
```

Logs should include:

```text
uploadId
user/tenant/case id if safe
file size
content type
checksum
phase
bytes transferred
failure reason
remote peer class
request id / trace id
```

Trace spans:

```text
create upload intent
receive bytes
write staging
checksum verify
virus scan
commit metadata
publish event
```

For streaming, avoid logging every chunk. Use progress events at coarse intervals:

```text
every 10 MB or every 10 seconds
```

---

## 19. Large Transfer Failure Catalogue

### 19.1 Client Disconnects Mid-Upload

Symptoms:

```text
EOFException
ClientAbortException
Broken pipe
Connection reset
partial temp file
```

Correct response:

```text
mark upload failed/aborted
cleanup staging
release resource
record bytes received
```

Do not treat as server bug automatically.

### 19.2 Server Receives Full File but Commit Fails

This is dangerous.

State:

```text
bytes stored in staging
metadata not committed
```

Need recovery:

```text
idempotent complete endpoint
background reconciler
orphan cleanup after TTL
operator dashboard
```

### 19.3 Checksum Mismatch

Causes:

- client sent wrong checksum,
- file changed during upload,
- transfer corruption,
- bug in part assembly,
- text/binary conversion mistake,
- wrong encoding/base64 handling.

Action:

```text
reject final commit
keep diagnostic metadata
cleanup or quarantine bytes
return 422/409 depending contract
```

### 19.4 Proxy Rejects Before App

Symptoms:

```text
413 from gateway
no app logs
```

Need:

```text
gateway logs
documented limit
consistent error response if possible
```

### 19.5 Slow Download Client

Symptoms:

```text
server response thread held long
write blocks
connection open for minutes
active download count high
```

Mitigation:

```text
use CDN/object storage for static large files
limit concurrent downloads
set idle/write timeout
support range
avoid holding DB transaction while streaming
```

### 19.6 Streaming Report Holds DB Cursor Too Long

Bad:

```text
open DB transaction
stream CSV for 30 minutes to slow client
```

Risks:

- locks held,
- cursor resource held,
- DB memory pressure,
- inconsistent timeout.

Better:

```text
generate report asynchronously to object storage
notify user when ready
serve file via download endpoint/CDN
```

---

## 20. Design Pattern: Async Report Generation

Bad synchronous pattern:

```text
GET /reports/large.csv
-> query DB
-> stream directly for 20 minutes
```

Better:

```text
POST /reports
-> 202 Accepted
-> job id

worker generates report
-> writes object storage
-> computes checksum
-> marks READY

GET /reports/{id}
-> metadata/status

GET /reports/{id}/download
-> redirect/pre-signed URL or stream
```

Benefits:

- avoids long DB transaction tied to client,
- retries job internally,
- user can resume download,
- observability clearer,
- easier authorization/audit.

HTTP response:

```http
202 Accepted
Location: /reports/rpt_123
```

---

## 21. Case-Management / Regulatory Example: Evidence Document Upload

Scenario:

```text
Regulated case platform accepts evidence documents.
Documents can be up to 500 MB.
Users may have unstable network.
System must preserve auditability.
File must be scanned before case officer can view it.
```

Recommended design:

```text
POST /cases/{caseId}/document-uploads
-> create upload intent, validate case permission, return uploadId

PUT /document-uploads/{uploadId}/parts/{partNo}
-> upload part, checksum, idempotent

POST /document-uploads/{uploadId}/complete
-> verify all parts, final checksum, mark RECEIVED

async scan
-> CLEAN -> READY
-> INFECTED -> QUARANTINED
-> FAILED -> SCAN_FAILED

POST /cases/{caseId}/documents/{documentId}/submit
-> only allowed when READY
```

Important invariants:

```text
Upload intent belongs to one case and one user/tenant.
Uploaded bytes are not evidence until complete + validated.
Officer cannot view document before scan CLEAN.
Audit trail records intent, part upload, completion, scan result, submit event.
Duplicate part upload is idempotent if checksum matches.
Complete is idempotent if final object already committed with same checksum.
```

Error examples:

```text
413 Payload Too Large: declared or actual size exceeds limit
409 Conflict: same part number but different checksum
410 Gone: upload session expired
422 Unprocessable Content: checksum mismatch / unsupported file type
423 Locked: scan pending if user tries to submit too early
```

---

## 22. Decision Matrix

| Situation | Recommended Approach |
|---|---|
| Small JSON under few MB | Normal API body |
| Browser file upload under modest size | Multipart with strict limits + streaming/spooling |
| Large user file upload | Resumable upload or direct-to-object-storage |
| Very large generated report | Async generation + object storage + range download |
| Service-to-service large binary | Object storage handoff + metadata event |
| Need inline transform | Java streaming pipeline with bounded buffers |
| Need malware scan | Staging + async scan + quarantine state |
| Need unstable-network resume | Chunked upload / range download |
| Need high global download scale | CDN/object storage, not app server streaming |
| Need audit/legal evidence | explicit upload state machine + checksum + immutable final object |

---

## 23. Production Checklist

### 23.1 Upload Checklist

```text
[ ] Max total size configured at gateway and app
[ ] Max actual bytes enforced while reading
[ ] Max concurrent uploads enforced
[ ] Multipart part count and part size limited
[ ] Filename sanitized and not used as storage path
[ ] Content-Type validated but not trusted
[ ] Magic bytes/file signature checked where relevant
[ ] Checksum computed streaming
[ ] Staging location used before final commit
[ ] Temp files/objects cleaned on failure
[ ] Upload state machine persisted
[ ] Duplicate retry behavior defined
[ ] Timeout/idle/min-rate policy defined
[ ] Virus/malware scan state represented
[ ] Audit events recorded
[ ] Metrics and logs include bytes/phase/failure
```

### 23.2 Download Checklist

```text
[ ] Authorization checked before streaming
[ ] No DB transaction held while slow client downloads
[ ] Range support considered
[ ] ETag/version stable for resume
[ ] Content-Disposition safe
[ ] Content-Type safe
[ ] Large response not loaded into heap
[ ] Slow client timeout configured
[ ] CDN/object storage offload considered
[ ] Download metrics include bytes/duration/rate
[ ] Cancellation releases resources
```

### 23.3 Architecture Checklist

```text
[ ] Decide control plane vs data plane
[ ] Align limits across browser/proxy/gateway/app/storage
[ ] Document timeout matrix
[ ] Define final commit point
[ ] Define orphan cleanup process
[ ] Define checksum semantics
[ ] Define scan/quarantine state
[ ] Define retry/resume semantics
[ ] Define operational dashboard
```

---

## 24. Anti-Patterns

### Anti-Pattern 1: `byte[]` Everywhere

```text
Works in DEV, kills PROD.
```

### Anti-Pattern 2: Holding DB Transaction While Streaming

```text
Network speed becomes DB lock duration.
```

### Anti-Pattern 3: Trusting `Content-Length`

```text
Declared size is not enforcement.
```

### Anti-Pattern 4: Making Upload Completion Equal Business Submission

```text
Bytes received does not mean document valid, clean, authorized, and committed.
```

### Anti-Pattern 5: Retrying Huge Non-Idempotent Upload

```text
Creates duplicate partial objects and ambiguous state.
```

### Anti-Pattern 6: No Orphan Cleanup

```text
Every failed upload becomes permanent storage leak.
```

### Anti-Pattern 7: App Server as CDN

```text
Java service wastes compute serving static large bytes.
```

### Anti-Pattern 8: Missing Progress/Phase Observability

```text
All failures become “upload failed” with no clue where.
```

---

## 25. Exercises

### Exercise 1 — Upload State Machine

Design upload state machine for case evidence:

```text
INITIATED, PARTIAL, RECEIVED, SCANNING, READY, QUARANTINED, FAILED, EXPIRED
```

Define:

- allowed transitions,
- retry behavior,
- idempotency rules,
- audit events,
- cleanup rules.

### Exercise 2 — Timeout Matrix

Create timeout matrix for:

```text
browser
CDN/gateway
ingress
Java app
object storage
virus scanner
```

Define:

- max upload size,
- idle timeout,
- total timeout,
- min throughput,
- error returned to user.

### Exercise 3 — Resumable Download

Design client algorithm:

```text
start download
store ETag
fail at offset N
resume with Range + If-Range
validate Content-Range
append
verify checksum
commit file
```

List all failure cases.

### Exercise 4 — Direct-to-Storage Security

Design pre-signed upload flow with:

- short TTL,
- object key namespace,
- max size,
- content type policy,
- checksum verification,
- commit endpoint,
- orphan cleanup.

### Exercise 5 — Memory Budget Calculation

Given:

```text
max upload size: 200 MB
concurrent uploads: 40
heap: 2 GB
buffer per upload: 128 KB
multipart parser threshold: 1 MB
```

Compare:

- full buffering,
- streaming,
- disk spooling.

Explain which survives and why.

---

## 26. Summary Mental Model

Large payload transfer is not a controller method. It is a distributed, long-lived, resource-consuming pipeline.

The core invariants:

```text
Never require full large payload in heap.
Always enforce actual byte limits while reading.
Use staging before final visibility.
Separate bytes received from business committed.
Make retry/resume idempotent.
Verify integrity with checksum.
Represent partial states explicitly.
Clean orphan data.
Align limits and timeouts across all hops.
Instrument bytes, phase, rate, and failure reason.
Offload data plane to object storage/CDN when possible.
```

A top-tier Java engineer treats file transfer as:

```text
protocol design
+ resource management
+ security boundary
+ failure-state machine
+ observability problem
+ operational cost decision
```

Not merely:

```text
MultipartFile file
file.getBytes()
```

---

## 27. References

- Java SE 25 `HttpClient`, `HttpRequest`, `BodyPublishers`, and `BodyHandlers` documentation.
- RFC 9110 — HTTP Semantics, including range requests, `Accept-Ranges`, `Content-Range`, and `206 Partial Content`.
- RFC 7578 — `multipart/form-data`.
- AWS S3 object integrity and multipart upload checksum documentation.
- Earlier parts of this series: HTTP/1.1, HTTP/2, streaming HTTP, timeout engineering, retry/idempotency, connection pooling, observability, and performance engineering.

---

## 28. Status Seri

```text
Part 30 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 31 — Security Beyond TLS: SSRF, Request Smuggling, Deserialization, Header Injection, DoS, and Data Leakage
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./029-performance-engineering-latency-throughput-tail-latency-allocation-gc-kernel-effects.md">⬅️ Part 29 — Performance Engineering: Latency, Throughput, Tail Latency, Allocation, GC, and Kernel Effects</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./031-security-beyond-tls-ssrf-request-smuggling-deserialization-header-injection-dos-data-leakage.md">Part 31 — Security Beyond TLS: SSRF, Request Smuggling, Deserialization, Header Injection, DoS, and Data Leakage ➡️</a>
</div>
