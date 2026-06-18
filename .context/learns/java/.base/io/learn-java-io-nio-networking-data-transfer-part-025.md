# Part 025 — Data Transfer Reliability: Retry, Resume, Checksum, Idempotency, Chunking, dan Exactly-Once Myth

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-025.md`  
> Status seri: belum selesai  
> Part sebelumnya: Part 024 — TLS, Certificates, TrustStore, KeyStore, dan Secure Data Transfer  
> Part berikutnya: Part 026 — Large File Processing: Memory Safety, Streaming Pipeline, Pagination, Split, Merge, dan External Sort

---

## 1. Tujuan Pembelajaran

Di part ini kita tidak lagi hanya membahas "bagaimana membaca/menulis data". Kita naik ke level yang lebih engineering: bagaimana membuat proses transfer data tetap benar ketika dunia nyata gagal.

Setelah mempelajari part ini, kamu diharapkan mampu:

1. Membedakan kegagalan transfer yang bersifat transient, permanent, partial, corrupt, duplicate, dan ambiguous.
2. Mendesain retry yang tidak memperparah masalah.
3. Mendesain resume upload/download berbasis offset, chunk, manifest, dan checksum.
4. Memahami mengapa "exactly once transfer" biasanya klaim yang salah atau minimal tidak lengkap.
5. Mendesain idempotency key, deduplication key, dan transfer state machine.
6. Mengetahui kapan checksum cukup dengan CRC dan kapan perlu cryptographic digest seperti SHA-256.
7. Membuat pola atomic finalization agar consumer tidak membaca file setengah jadi.
8. Membangun transfer pipeline yang bisa dioperasikan: observable, auditable, recoverable, dan reconcilable.
9. Menghindari anti-pattern umum seperti blind retry, unbounded buffering, rename sebelum validasi, dan retry pada operasi non-idempotent.
10. Mampu menulis skeleton Java untuk reliable file transfer dan resumable HTTP download/upload.

---

## 2. Core Mental Model: Transfer Bukan Event Tunggal, Melainkan State Machine

Kesalahan besar dalam desain data transfer adalah menganggap transfer sebagai satu operasi:

```text
send(file)
```

Dalam dunia nyata, transfer adalah state machine:

```text
CREATED
  -> CLAIMED
  -> READING_SOURCE
  -> TRANSFERRING_CHUNK[n]
  -> VERIFYING_CHUNK[n]
  -> PERSISTING_CHECKPOINT
  -> VERIFYING_OBJECT
  -> FINALIZING
  -> PUBLISHED
  -> ACKNOWLEDGED
```

Setiap state bisa gagal.

Setiap failure bisa terjadi:

- sebelum data dikirim
- saat data sebagian terkirim
- setelah data terkirim tetapi sebelum ack diterima
- setelah ack dikirim tetapi sebelum checkpoint tersimpan
- setelah file ditulis tetapi sebelum metadata final tersimpan
- setelah metadata final tersimpan tetapi sebelum downstream membaca
- saat retry membuat duplicate
- saat cleanup menghapus data yang masih dibutuhkan untuk resume

Reliable transfer berarti kita mendesain supaya setiap state punya:

1. **identity** — transfer mana ini?
2. **progress** — sudah sampai mana?
3. **integrity evidence** — data yang sampai benar atau tidak?
4. **idempotency rule** — kalau request yang sama dikirim ulang, apa hasilnya?
5. **recovery rule** — kalau crash di state ini, apa langkah aman berikutnya?
6. **observability** — operator bisa tahu sedang di mana dan stuck kenapa?
7. **finalization boundary** — kapan data dianggap boleh dikonsumsi?

---

## 3. Kenapa Data Transfer Sulit?

Karena transfer selalu melintasi boundary.

```text
Producer memory
  -> JVM buffer
  -> OS kernel buffer
  -> network / disk / object store
  -> remote kernel buffer
  -> remote JVM buffer
  -> remote temp storage
  -> final storage
  -> metadata catalog
  -> consumer
```

Setiap boundary punya semantics berbeda:

| Boundary | Risiko |
|---|---|
| JVM memory → kernel buffer | `write()` return bukan berarti remote menerima |
| Kernel buffer → network | packet loss, timeout, congestion |
| Network → remote kernel | connection reset, half-open |
| Remote JVM → file | partial write, disk full |
| Temp file → final file | non-atomic move, cross-filesystem issue |
| File → metadata DB | file ada tapi DB belum commit |
| Metadata DB → consumer | consumer melihat metadata sebelum file lengkap |
| Retry boundary | duplicate request |
| Ack boundary | ack hilang, client tidak tahu server sudah commit atau belum |

Karena itu reliable transfer tidak cukup hanya `try-catch-retry`.

Reliable transfer membutuhkan kontrak.

---

## 4. Taxonomy Failure dalam Data Transfer

### 4.1 Transient Failure

Transient failure adalah kegagalan yang mungkin hilang jika dicoba ulang.

Contoh:

- network timeout
- connection reset sementara
- DNS gagal sementara
- HTTP 502/503/504
- rate limit sementara
- object store throttling
- remote service restart
- temporary file lock
- database connection pool exhausted

Tindakan umum:

- retry dengan exponential backoff
- retry budget
- jitter
- circuit breaker jika dependency rusak lama
- idempotency protection

### 4.2 Permanent Failure

Permanent failure tidak akan sembuh dengan retry biasa.

Contoh:

- file tidak ditemukan
- permission denied
- invalid credential
- unsupported file type
- checksum mismatch akibat source corrupt
- payload terlalu besar melebihi contract
- invalid schema
- HTTP 400/401/403/404 tertentu
- disk quota tidak cukup dan tidak akan segera naik

Tindakan umum:

- fail fast
- mark rejected
- send to dead-letter / quarantine
- alert / human intervention
- jangan retry tanpa perubahan input atau konfigurasi

### 4.3 Partial Failure

Partial failure terjadi ketika sebagian data sudah berpindah, tapi operasi belum lengkap.

Contoh:

- file 10 GB baru terkirim 3 GB lalu koneksi putus
- server sudah menyimpan chunk tapi client tidak menerima response
- temp file sudah dibuat tapi belum di-rename
- metadata sudah insert tapi file belum final
- consumer sudah membaca beberapa record lalu crash

Tindakan umum:

- checkpoint
- resume
- chunk manifest
- idempotent chunk write
- atomic finalization
- reconciliation

### 4.4 Ambiguous Failure

Ambiguous failure adalah failure paling berbahaya: client tidak tahu apakah operasi remote berhasil atau gagal.

Contoh:

```text
client sends chunk 10
server stores chunk 10
server returns 200 OK
network breaks before client receives response
client sees timeout
```

Dari sisi client, request gagal. Dari sisi server, request berhasil.

Jika client retry tanpa idempotency, duplicate bisa terjadi.

Tindakan umum:

- idempotency key
- chunk identity
- server-side deduplication
- status query endpoint
- compare checksum
- exactly-once claim harus diganti menjadi recoverable-at-least-once with idempotent effects

### 4.5 Corruption Failure

Data sampai tetapi isinya salah.

Penyebab:

- bug encoding
- binary/text boundary salah
- truncated file
- partial write dianggap sukses
- wrong decompression
- wrong charset
- concurrent writer overwrite
- storage/hardware issue
- malicious tampering

Tindakan umum:

- checksum
- cryptographic digest
- size validation
- manifest validation
- schema validation
- atomic publish only after verification

### 4.6 Duplicate Failure

Data diproses lebih dari sekali.

Penyebab:

- retry
- scheduler menjalankan ulang
- message broker redelivery
- ack hilang
- consumer crash setelah side effect tetapi sebelum ack
- manual replay
- reconciliation job

Tindakan umum:

- idempotency key
- unique constraint
- dedupe table
- transfer id
- chunk id
- business key
- content hash
- processed ledger

---

## 5. Exactly-Once Myth

"Exactly once" terdengar ideal:

```text
data dikirim sekali, diterima sekali, diproses sekali
```

Dalam distributed system, yang biasanya bisa dijamin bukan exactly once end-to-end, melainkan kombinasi:

1. at-least-once delivery + idempotent processing
2. at-most-once delivery + accept data loss
3. exactly-once effect dalam boundary terbatas dengan transaction/unique constraint
4. deduplication after the fact
5. reconciliation untuk memperbaiki divergence

Transfer lewat network tidak bisa menghilangkan ambiguous failure.

Misalnya:

```text
client -> server: commit file
server commits file
server -> client: OK
response lost
client retries commit
```

Tanpa idempotency key, server bisa membuat dua object final.

Dengan idempotency key, server bisa menjawab:

```text
commit already completed for transferId=T-123
```

Jadi yang sebenarnya kita bangun adalah:

```text
at-least-once request delivery
+ idempotent server operation
+ durable progress tracking
+ deterministic finalization
+ reconciliation
= effectively-once observable outcome
```

Istilah yang lebih jujur:

- exactly-once effect
- idempotent final state
- deduplicated at-least-once transfer
- recoverable transfer
- convergent transfer

---

## 6. Retry: Obat yang Bisa Menjadi Racun

Retry membantu jika failure transient. Tetapi retry berbahaya jika:

- operasi tidak idempotent
- request besar diulang dari awal
- dependency sedang overload
- retry dilakukan serentak oleh banyak client
- tidak ada timeout
- tidak ada retry budget
- tidak ada dedupe
- tidak membedakan error type

### 6.1 Anti-Pattern: Blind Retry

Buruk:

```java
while (true) {
    try {
        upload(file);
        break;
    } catch (IOException e) {
        // try again forever
    }
}
```

Masalah:

- infinite loop
- menekan dependency yang sudah rusak
- tidak ada observability
- bisa duplicate
- tidak tahu progress
- tidak ada batas waktu
- tidak ada backoff
- tidak ada cancellation

### 6.2 Retry yang Layak

Retry yang sehat punya:

| Elemen | Fungsi |
|---|---|
| timeout per attempt | mencegah hang |
| max attempts | membatasi retry |
| total deadline | membatasi waktu keseluruhan |
| exponential backoff | mengurangi tekanan |
| jitter | menghindari thundering herd |
| retryable classification | hanya retry error yang tepat |
| idempotency key | aman jika request sebenarnya sudah commit |
| progress checkpoint | tidak mengulang dari awal |
| logging/metrics | bisa dioperasikan |

### 6.3 Exponential Backoff dengan Jitter

Contoh sederhana:

```java
import java.time.Duration;
import java.util.concurrent.ThreadLocalRandom;

public final class Backoff {
    private final Duration initial;
    private final Duration max;

    public Backoff(Duration initial, Duration max) {
        this.initial = initial;
        this.max = max;
    }

    public Duration delayForAttempt(int attempt) {
        long baseMillis = initial.toMillis();
        long maxMillis = max.toMillis();

        long exponential = baseMillis * (1L << Math.min(attempt, 20));
        long capped = Math.min(exponential, maxMillis);

        long jittered = ThreadLocalRandom.current().nextLong(capped / 2, capped + 1);
        return Duration.ofMillis(jittered);
    }
}
```

Catatan:

- Jangan pakai shift tanpa limit besar karena overflow.
- Jitter penting supaya ribuan client tidak retry pada detik yang sama.
- Retry harus bisa dihentikan jika caller cancel.

### 6.4 Retry Classification

Contoh klasifikasi HTTP:

| Status | Umumnya Retry? | Catatan |
|---:|---|---|
| 400 | Tidak | request invalid |
| 401 | Tidak langsung | refresh credential mungkin |
| 403 | Tidak | permission |
| 404 | Biasanya tidak | kecuali eventual consistency/search index |
| 408 | Ya | request timeout |
| 409 | Tergantung | bisa conflict idempotency |
| 413 | Tidak | payload terlalu besar |
| 429 | Ya dengan `Retry-After` | rate limit |
| 500 | Ya terbatas | server error |
| 502 | Ya | gateway |
| 503 | Ya | unavailable |
| 504 | Ya | gateway timeout |

Untuk socket/file I/O:

| Error | Retry? | Catatan |
|---|---|---|
| connect timeout | Ya terbatas | dependency mungkin sementara |
| read timeout | Tergantung | operasi mungkin sudah commit |
| permission denied | Tidak | konfigurasi/security |
| disk full | Biasanya tidak langsung | perlu cleanup/quota |
| connection reset | Ya dengan idempotency | partial/ambiguous |
| checksum mismatch | Tidak blind retry | perlu compare source, quarantine |
| file locked | Ya terbatas | jika lock sementara |
| invalid checksum source | Tidak | input corrupt |

---

## 7. Idempotency: Kunci Aman untuk Retry

Idempotent artinya operasi yang sama bisa diulang dan hasil akhirnya tetap sama.

```text
f(f(x)) = f(x)
```

Dalam data transfer:

```text
uploadChunk(transferId=T, chunkIndex=5, checksum=C)
```

Jika dipanggil 10 kali dengan payload yang sama, hasilnya tetap:

```text
chunk 5 untuk transfer T tersimpan satu kali secara valid
```

### 7.1 Idempotency Key

Idempotency key adalah identity stabil untuk satu logical operation.

Contoh:

```text
Idempotency-Key: transfer:T-2026-0001:chunk:000005:sha256:abc123...
```

Atau untuk finalization:

```text
Idempotency-Key: transfer:T-2026-0001:finalize
```

Rules:

1. Key harus unik untuk logical operation.
2. Retry harus memakai key yang sama.
3. Payload untuk key yang sama harus sama.
4. Jika key sama tapi payload berbeda, server harus menolak sebagai conflict.
5. Server harus menyimpan hasil operasi untuk key tersebut.
6. Key harus punya retention window yang cukup panjang.

### 7.2 Server-Side Idempotency Table

Contoh schema konseptual:

```sql
CREATE TABLE transfer_operation_idempotency (
    idempotency_key VARCHAR(200) PRIMARY KEY,
    transfer_id VARCHAR(100) NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    payload_sha256 VARCHAR(64) NOT NULL,
    status VARCHAR(30) NOT NULL,
    response_code INT,
    response_body TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

Jika request masuk:

1. Compute payload hash.
2. Insert idempotency row.
3. Jika insert sukses, proses operasi.
4. Jika duplicate key:
   - jika payload hash sama dan status complete, return response lama.
   - jika payload hash sama dan status in progress, return 409/202.
   - jika payload hash beda, return conflict.
5. Update result atomically.

### 7.3 Idempotency Bukan Dedupe Global

Idempotency key menjawab:

```text
apakah operation yang sama sudah pernah dilakukan?
```

Dedupe menjawab:

```text
apakah content/business object ini sudah pernah diproses?
```

Keduanya berbeda.

Contoh:

- idempotency key: `upload-chunk-5-of-transfer-T`
- dedupe key: `invoiceNumber=INV-123`
- content hash: SHA-256 file

Idempotency biasanya operation-scoped. Dedupe biasanya business/content-scoped.

---

## 8. Chunking: Memecah Transfer Menjadi Unit Recovery

Transfer file besar sebagai satu request punya masalah:

- timeout tinggi
- retry mahal
- memory pressure
- tidak ada progress granular
- corruption sulit dilokalisasi
- resume sulit
- dependency lebih mudah overload

Chunking memecah file menjadi unit:

```text
file
  -> chunk 0
  -> chunk 1
  -> chunk 2
  -> ...
```

Setiap chunk punya identity dan integrity metadata.

### 8.1 Chunk Metadata

Minimal:

```json
{
  "transferId": "T-2026-0001",
  "chunkIndex": 0,
  "offset": 0,
  "length": 8388608,
  "sha256": "....",
  "crc32": "...."
}
```

Untuk manifest:

```json
{
  "transferId": "T-2026-0001",
  "fileName": "report-2026-06.csv",
  "totalSize": 9876543210,
  "chunkSize": 8388608,
  "chunkCount": 1178,
  "wholeSha256": "...",
  "chunks": [
    {
      "index": 0,
      "offset": 0,
      "length": 8388608,
      "sha256": "..."
    }
  ]
}
```

### 8.2 Chunk Size Trade-Off

| Chunk Size | Kelebihan | Kekurangan |
|---:|---|---|
| 64 KB | retry kecil, latency rendah | overhead metadata/request tinggi |
| 1 MB | cukup seimbang | masih banyak request untuk file besar |
| 8 MB | umum untuk large object | retry chunk cukup mahal |
| 64 MB | overhead rendah | retry mahal, memory lebih besar |
| 256 MB | cocok batch besar tertentu | timeout dan memory risk tinggi |

Tidak ada angka universal.

Pertimbangkan:

- network stability
- expected file size
- max request body
- server memory
- latency
- checksum cost
- parallelism
- storage API limit
- timeout
- retry cost
- operational visibility

### 8.3 Sequential vs Parallel Chunk Upload

Sequential:

```text
chunk 0 -> chunk 1 -> chunk 2 -> finalize
```

Kelebihan:

- sederhana
- ordering mudah
- resource rendah
- debug mudah

Kekurangan:

- throughput rendah jika latency tinggi

Parallel:

```text
chunk 0,1,2,3 uploaded concurrently
```

Kelebihan:

- throughput tinggi
- latency hiding

Kekurangan:

- server harus handle out-of-order
- lebih banyak memory/socket
- retry lebih kompleks
- finalization harus validasi manifest lengkap
- throttling lebih penting

Rule praktis:

```text
Mulai dari sequential atau bounded parallelism kecil.
Naikkan concurrency berdasarkan metric, bukan tebakan.
```

---

## 9. Checksum, Digest, dan Integrity Verification

Checksum/digest menjawab:

```text
apakah byte yang diterima sama dengan byte yang dikirim?
```

Tapi tidak semua checksum punya tujuan yang sama.

### 9.1 CRC vs Cryptographic Hash

| Mekanisme | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|
| CRC32 | deteksi error tidak disengaja, format ZIP/GZIP, cepat | keamanan/tamper resistance |
| CRC32C | mirip CRC32, sering hardware-accelerated | keamanan |
| Adler32 | cepat, integritas ringan | keamanan, collision resistance kuat |
| SHA-256 | integritas kuat, content identity, tamper detection | sangat ringan/low CPU workload |
| HMAC-SHA256 | integritas + autentikasi shared secret | dedupe publik tanpa secret |

Java menyediakan `java.util.zip.Checksum` untuk checksum seperti CRC32/Adler32 dan `java.security.MessageDigest` untuk digest seperti SHA-256.

### 9.2 CRC32 Streaming Example

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.CRC32;
import java.util.zip.CheckedInputStream;

public final class Crc32Example {
    public static long crc32(Path path) throws Exception {
        CRC32 crc32 = new CRC32();

        try (InputStream raw = Files.newInputStream(path);
             CheckedInputStream checked = new CheckedInputStream(raw, crc32)) {

            byte[] buffer = new byte[64 * 1024];
            while (checked.read(buffer) != -1) {
                // CheckedInputStream updates checksum as bytes are read.
            }
        }

        return crc32.getValue();
    }
}
```

### 9.3 SHA-256 Streaming Example

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class Sha256Example {
    public static String sha256(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");

        try (InputStream in = Files.newInputStream(path)) {
            byte[] buffer = new byte[128 * 1024];

            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }

        return HexFormat.of().formatHex(digest.digest());
    }
}
```

### 9.4 Per-Chunk vs Whole-File Digest

Per-chunk checksum:

- mendeteksi chunk mana rusak
- memungkinkan retry hanya chunk rusak
- bagus untuk resume
- bagus untuk parallel upload

Whole-file digest:

- membuktikan hasil gabungan benar
- mendeteksi chunk order salah
- mendeteksi manifest mismatch
- wajib sebelum publish final

Praktik kuat:

```text
verify each chunk
+ verify whole object
+ publish only after both pass
```

### 9.5 Size Validation

Checksum tidak menggantikan size validation.

Selalu simpan:

- expected total size
- expected chunk count
- expected chunk length
- actual bytes written
- actual bytes read
- final object size

Karena truncated file kadang bisa lolos dari proses yang tidak memeriksa EOF dengan benar.

---

## 10. Resume Transfer

Resume berarti transfer bisa dilanjutkan dari progress terakhir yang valid.

Ada dua strategi utama:

1. offset-based resume
2. chunk-based resume

### 10.1 Offset-Based Resume

Cocok untuk stream/file linear.

Server menyimpan:

```text
transferId=T
bytesReceived=123456789
```

Client melanjutkan dari offset tersebut.

Risiko:

- jika byte sebelumnya corrupt, offset saja tidak cukup
- jika source berubah, resume menghasilkan gabungan data salah
- jika server salah melaporkan offset, data bisa overlap/gap

Butuh:

- content identity
- source file size
- source last modified / etag / digest
- checkpoint durability
- validation per range

### 10.2 Chunk-Based Resume

Server menyimpan status tiap chunk:

```text
chunk 0: COMPLETE sha256=a
chunk 1: COMPLETE sha256=b
chunk 2: MISSING
chunk 3: COMPLETE sha256=d
```

Client query missing chunks:

```text
GET /transfers/T/chunks/missing
```

Server return:

```json
[2, 7, 11]
```

Client upload hanya chunk yang hilang/rusak.

Kelebihan:

- lebih robust
- cocok parallelism
- corruption localized
- progress lebih jelas

Kekurangan:

- metadata lebih banyak
- finalization lebih kompleks
- chunk retention/cleanup perlu didesain

### 10.3 Resume Download dengan HTTP Range

Untuk download, pattern umum:

1. Cek existing temp file size.
2. Request range mulai dari offset tersebut.
3. Append ke temp file.
4. Verify final size/digest.
5. Atomic move ke final path.

Skeleton:

```java
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;

public final class ResumableDownloader {
    private final HttpClient client;

    public ResumableDownloader(HttpClient client) {
        this.client = client;
    }

    public void download(URI uri, Path temp, Path finalPath, long expectedSize) throws Exception {
        long existing = Files.exists(temp) ? Files.size(temp) : 0L;

        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofMinutes(5))
                .header("Range", "bytes=" + existing + "-")
                .GET()
                .build();

        HttpResponse<InputStream> response =
                client.send(request, HttpResponse.BodyHandlers.ofInputStream());

        int status = response.statusCode();

        if (existing > 0 && status != 206) {
            throw new IllegalStateException("Server did not honor range request. status=" + status);
        }

        if (existing == 0 && status != 200 && status != 206) {
            throw new IllegalStateException("Unexpected status=" + status);
        }

        try (InputStream in = response.body();
             OutputStream out = Files.newOutputStream(
                     temp,
                     StandardOpenOption.CREATE,
                     StandardOpenOption.APPEND)) {

            in.transferTo(out);
        }

        long actual = Files.size(temp);
        if (actual != expectedSize) {
            throw new IllegalStateException(
                    "Incomplete download. expected=" + expectedSize + ", actual=" + actual);
        }

        Files.move(
                temp,
                finalPath,
                java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                java.nio.file.StandardCopyOption.ATOMIC_MOVE
        );
    }
}
```

Catatan:

- Ini skeleton, belum cukup untuk production.
- Production perlu ETag/If-Range agar source tidak berubah.
- Production perlu checksum.
- Production perlu `FileChannel.force` sebelum atomic move jika crash consistency penting.
- Production perlu handle server yang tidak mendukung Range.

---

## 11. Atomic Finalization

Reliable transfer harus memisahkan:

```text
data being written
```

dari:

```text
data ready for consumption
```

Jangan biarkan consumer membaca file yang masih ditulis.

Pattern:

```text
incoming/
  file-123.part
  file-123.manifest.part

ready/
  file-123.dat
  file-123.manifest
```

Langkah:

1. Write ke temp/staging path.
2. Verify size.
3. Verify per-chunk checksum.
4. Verify whole-file digest.
5. Force data jika durability penting.
6. Atomic move ke final path.
7. Publish metadata setelah file final visible.
8. Consumer hanya membaca dari final/ready path.

### 11.1 Bad Pattern

```text
producer writes directly to /ready/file.csv
consumer watches /ready
consumer reads file while producer still writing
```

Akibat:

- consumer baca truncated file
- parser gagal random
- downstream menyimpan partial data
- retry menghasilkan duplicate
- debugging sulit

### 11.2 Better Pattern

```text
producer writes /staging/file.csv.part
producer verifies
producer atomic moves /staging/file.csv.part -> /ready/file.csv
consumer only watches /ready/*.csv
```

### 11.3 Manifest-First vs Data-First

Biasanya lebih aman:

```text
data first
manifest after data verified
```

Karena manifest bisa menjadi signal readiness.

Jika manifest muncul dulu, consumer bisa mencari data yang belum lengkap.

Pattern kuat:

```text
write data.part
verify data.part
atomic move data.part -> data
write manifest.part
force manifest.part
atomic move manifest.part -> manifest
consumer triggers on manifest
```

---

## 12. Transfer Manifest

Manifest adalah kontrak tertulis antara producer dan consumer.

Contoh:

```json
{
  "version": 1,
  "transferId": "T-2026-0001",
  "objectName": "daily-report-2026-06-16.csv",
  "createdAt": "2026-06-16T10:30:00Z",
  "producer": "report-service",
  "contentType": "text/csv",
  "charset": "UTF-8",
  "recordCount": 1250000,
  "totalSize": 987654321,
  "sha256": "6f2c...",
  "chunkSize": 8388608,
  "chunkCount": 118,
  "compression": {
    "type": "gzip",
    "uncompressedSize": 4567890123,
    "uncompressedSha256": "a71b..."
  },
  "schema": {
    "name": "daily-report",
    "version": 3
  }
}
```

Manifest membantu:

- validation
- audit
- troubleshooting
- replay
- dedupe
- compatibility
- schema evolution
- consumer readiness
- data lineage

Manifest bukan pengganti data. Manifest adalah bukti dan kontrak.

---

## 13. Transfer State Machine

Contoh state machine:

```text
NEW
  -> INITIATED
  -> UPLOADING
  -> VERIFYING
  -> FINALIZING
  -> COMPLETED

UPLOADING
  -> PAUSED
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT

VERIFYING
  -> FAILED_CORRUPT

FINALIZING
  -> COMPLETED
  -> FAILED_AMBIGUOUS
```

### 13.1 State Table

| State | Meaning | Safe Recovery |
|---|---|---|
| NEW | transfer record created | start upload |
| INITIATED | manifest known | upload missing chunks |
| UPLOADING | chunks being received | query chunk status |
| VERIFYING | all chunks present, integrity checking | rerun verification |
| FINALIZING | writing final object/metadata | check final object and idempotency key |
| COMPLETED | final object published | return success |
| FAILED_RETRYABLE | temporary failure | retry with backoff |
| FAILED_PERMANENT | invalid request/input | do not retry |
| FAILED_CORRUPT | checksum mismatch | quarantine |
| CANCELLED | intentionally stopped | cleanup by policy |

### 13.2 Recovery After Crash

Saat service restart:

```text
Find transfers in non-terminal states.
For each transfer:
  - if no update for grace period:
      inspect staging data
      inspect chunk table
      inspect final object
      decide:
        resume upload
        rerun verification
        finalize
        mark corrupt
        mark expired
```

Jangan hanya mengandalkan memory.

Progress harus durable.

---

## 14. Durable Checkpoint

Checkpoint adalah catatan progress yang bisa dipakai setelah crash.

Minimal checkpoint:

```json
{
  "transferId": "T-2026-0001",
  "sourceId": "source-A",
  "targetId": "target-B",
  "status": "UPLOADING",
  "bytesReceived": 104857600,
  "chunksCompleted": [0, 1, 2, 3, 4],
  "updatedAt": "2026-06-16T10:30:10Z"
}
```

Checkpoint bisa disimpan di:

- database
- durable local file
- object storage metadata
- message broker state store
- distributed KV store

Yang penting:

1. update atomic
2. consistent dengan data yang sudah disimpan
3. punya timestamp
4. bisa dipakai untuk recovery
5. tidak terlalu sering sampai bottleneck
6. tidak terlalu jarang sampai retry mahal

### 14.1 Checkpoint Frequency

| Strategy | Kelebihan | Kekurangan |
|---|---|---|
| setiap byte | tidak realistis | overhead ekstrem |
| setiap chunk | umum dan seimbang | chunk besar bisa ulang banyak |
| setiap N MB | sederhana | mapping ke chunk perlu jelas |
| setiap interval waktu | stabil untuk stream | bisa kehilangan progress terakhir |
| final only | sederhana | tidak resumable |

Untuk file besar, checkpoint per chunk biasanya kuat.

---

## 15. Idempotent Chunk Store

Pseudocode server:

```java
public ChunkResult acceptChunk(ChunkUploadCommand command) {
    Transfer transfer = transferRepository.get(command.transferId());

    if (transfer.isTerminal()) {
        return ChunkResult.rejected("Transfer already terminal");
    }

    Chunk existing = chunkRepository.find(command.transferId(), command.chunkIndex());

    if (existing != null) {
        if (existing.sha256().equals(command.sha256())
                && existing.length() == command.length()) {
            return ChunkResult.alreadyAccepted(existing);
        }

        return ChunkResult.conflict(
                "Same chunk index already exists with different checksum/length");
    }

    Path tempChunk = stagingPath(command.transferId(), command.chunkIndex());

    long actualBytes = writeBodyToTempFile(command.body(), tempChunk);
    if (actualBytes != command.length()) {
        deleteQuietly(tempChunk);
        return ChunkResult.rejected("Length mismatch");
    }

    String actualSha256 = sha256(tempChunk);
    if (!actualSha256.equals(command.sha256())) {
        quarantine(tempChunk);
        return ChunkResult.rejected("Checksum mismatch");
    }

    chunkRepository.insertComplete(command.transferId(), command.chunkIndex(),
            command.offset(), command.length(), command.sha256(), tempChunk);

    return ChunkResult.accepted();
}
```

Invariant:

```text
Untuk satu (transferId, chunkIndex), hanya boleh ada satu payload valid.
```

Jika duplicate dengan payload sama, return success.

Jika duplicate dengan payload berbeda, return conflict.

---

## 16. Finalization: Dari Chunk Menjadi Object

Finalization adalah boundary terpenting.

Langkah:

1. Lock transfer.
2. Pastikan semua chunk ada.
3. Pastikan chunk count sesuai manifest.
4. Pastikan offset tidak gap/overlap.
5. Gabungkan chunk ke temp final file.
6. Compute whole-file digest.
7. Compare dengan manifest.
8. Force file jika perlu.
9. Atomic move ke final location.
10. Update DB status `COMPLETED`.
11. Emit event setelah commit.
12. Cleanup staging asynchronously.

### 16.1 Gap/Overlap Validation

Chunk metadata:

```text
index=0 offset=0 length=100
index=1 offset=100 length=100
index=2 offset=200 length=50
```

Valid.

Invalid gap:

```text
index=0 offset=0 length=100
index=1 offset=120 length=100
```

Bytes 100-119 hilang.

Invalid overlap:

```text
index=0 offset=0 length=100
index=1 offset=80 length=100
```

Bytes 80-99 overlap.

Invalid order:

```text
index=0 offset=100 length=100
index=1 offset=0 length=100
```

Index tidak sesuai offset jika protocol mengharuskan fixed order.

---

## 17. Java Skeleton: Chunk Manifest Model

```java
import java.util.List;

public record TransferManifest(
        int version,
        String transferId,
        String objectName,
        long totalSize,
        int chunkSize,
        int chunkCount,
        String sha256,
        List<ChunkDescriptor> chunks
) {
    public TransferManifest {
        if (version <= 0) throw new IllegalArgumentException("version must be positive");
        if (transferId == null || transferId.isBlank()) throw new IllegalArgumentException("transferId required");
        if (totalSize < 0) throw new IllegalArgumentException("totalSize must be >= 0");
        if (chunkSize <= 0) throw new IllegalArgumentException("chunkSize must be positive");
        if (chunkCount < 0) throw new IllegalArgumentException("chunkCount must be >= 0");
        if (chunks == null) throw new IllegalArgumentException("chunks required");
    }
}

public record ChunkDescriptor(
        int index,
        long offset,
        int length,
        String sha256
) {
    public ChunkDescriptor {
        if (index < 0) throw new IllegalArgumentException("index must be >= 0");
        if (offset < 0) throw new IllegalArgumentException("offset must be >= 0");
        if (length < 0) throw new IllegalArgumentException("length must be >= 0");
        if (sha256 == null || sha256.isBlank()) throw new IllegalArgumentException("sha256 required");
    }
}
```

### 17.1 Manifest Validation

```java
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class ManifestValidator {
    public static void validate(TransferManifest manifest) {
        List<ChunkDescriptor> chunks = manifest.chunks().stream()
                .sorted(Comparator.comparingInt(ChunkDescriptor::index))
                .toList();

        if (chunks.size() != manifest.chunkCount()) {
            throw new IllegalArgumentException("chunk count mismatch");
        }

        Set<Integer> indexes = new HashSet<>();
        long expectedOffset = 0L;

        for (int i = 0; i < chunks.size(); i++) {
            ChunkDescriptor chunk = chunks.get(i);

            if (!indexes.add(chunk.index())) {
                throw new IllegalArgumentException("duplicate chunk index: " + chunk.index());
            }

            if (chunk.index() != i) {
                throw new IllegalArgumentException("missing or unordered chunk index at " + i);
            }

            if (chunk.offset() != expectedOffset) {
                throw new IllegalArgumentException(
                        "offset mismatch at chunk " + chunk.index()
                                + ": expected=" + expectedOffset
                                + ", actual=" + chunk.offset());
            }

            expectedOffset += chunk.length();
        }

        if (expectedOffset != manifest.totalSize()) {
            throw new IllegalArgumentException(
                    "total size mismatch: expected=" + manifest.totalSize()
                            + ", computed=" + expectedOffset);
        }
    }
}
```

---

## 18. Java Skeleton: Atomic Publish Utility

```java
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

public final class AtomicPublish {
    private AtomicPublish() {
    }

    public static void publish(Path temp, Path target) throws IOException {
        forceFile(temp);

        Path parent = target.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        Files.move(
                temp,
                target,
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE
        );

        if (parent != null) {
            forceDirectoryBestEffort(parent);
        }
    }

    private static void forceFile(Path path) throws IOException {
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.WRITE)) {
            channel.force(true);
        }
    }

    private static void forceDirectoryBestEffort(Path directory) {
        try (FileChannel channel = FileChannel.open(directory, StandardOpenOption.READ)) {
            channel.force(true);
        } catch (Exception ignored) {
            // Some platforms/filesystems do not support opening directories as FileChannel.
            // Log this in production if crash-consistency is a hard requirement.
        }
    }
}
```

Catatan:

- `ATOMIC_MOVE` hanya atomic jika filesystem mendukung dan source/target berada pada filesystem yang kompatibel.
- Jika tidak didukung, Java melempar exception.
- Jangan silently fallback ke non-atomic move untuk data yang butuh correctness tinggi.
- Untuk object storage, "rename" biasanya bukan rename atomic seperti filesystem; sering berupa copy + delete.

---

## 19. Reconciliation: Safety Net Wajib

Retry dan checkpoint tetap tidak cukup.

Reconciliation adalah job periodik yang membandingkan expected state dengan actual state.

Contoh:

```text
DB says transfer T is COMPLETED
but final object missing
=> mark inconsistent, alert, recover from staging if possible

DB says transfer T is UPLOADING for 3 days
but all chunks exist
=> rerun verification/finalization

DB says transfer T is FINALIZING
but final object exists and digest matches
=> mark COMPLETED idempotently

staging has orphan chunks older than retention
=> cleanup if no active transfer references them
```

### 19.1 Reconciliation Sources

| Source | Apa yang Dicek |
|---|---|
| transfer table | status, timestamps |
| chunk table | completeness |
| staging filesystem | temp/chunk files |
| final filesystem/object store | final data |
| manifest | expected size/hash |
| audit log | operation history |
| downstream acknowledgment | consumed or not |

### 19.2 Reconciliation Jangan Merusak

Reconciliation harus konservatif:

- jangan hapus staging jika transfer masih active
- jangan publish data tanpa checksum
- jangan overwrite final object tanpa idempotency rule
- jangan mark completed hanya karena file ada
- jangan retry infinite tanpa state transition
- log semua correction

---

## 20. Observability untuk Data Transfer

Tanpa observability, reliable transfer menjadi invisible failure.

### 20.1 Metrics

Minimal metrics:

```text
transfer_started_total
transfer_completed_total
transfer_failed_total{reason}
transfer_retry_total{reason}
transfer_bytes_total
transfer_chunk_completed_total
transfer_chunk_failed_total{reason}
transfer_duration_seconds
transfer_active_count
transfer_stuck_count
checksum_mismatch_total
idempotency_conflict_total
resume_count_total
reconciliation_correction_total
```

### 20.2 Logs

Log harus punya correlation:

```text
transferId
chunkIndex
idempotencyKey
source
target
offset
length
attempt
state
errorClass
checksumExpected
checksumActual
durationMs
```

Jangan log:

- secret
- token
- password
- private key
- PII payload
- full file content

### 20.3 Tracing

Span yang berguna:

```text
initiate_transfer
upload_chunk
verify_chunk
persist_checkpoint
finalize_transfer
publish_manifest
notify_downstream
```

### 20.4 Audit Trail

Audit event:

```json
{
  "event": "TRANSFER_COMPLETED",
  "transferId": "T-2026-0001",
  "objectName": "daily-report.csv",
  "size": 987654321,
  "sha256": "6f2c...",
  "actor": "report-service",
  "timestamp": "2026-06-16T10:35:00Z"
}
```

Audit menjawab:

- siapa mengirim?
- kapan?
- data apa?
- ukuran berapa?
- hash apa?
- diterima oleh siapa?
- diverifikasi atau tidak?
- gagal di mana?

---

## 21. Security dan Reliability Bertemu

Reliable transfer tidak bisa dipisah dari security.

Contoh:

- checksum tanpa authentication tidak mencegah attacker mengganti file dan checksum bersama-sama
- idempotency key yang predictable bisa disalahgunakan
- retry bisa memperbesar brute force
- chunk upload tanpa quota bisa jadi storage exhaustion
- decompression sebelum size check bisa menyebabkan zip bomb
- resume endpoint bisa bocorkan file offset atau existence
- manifest dari user tidak boleh dipercaya tanpa validasi

### 21.1 Defensive Limits

Tetapkan:

```text
max file size
max chunk size
max chunk count
max active transfer per user
max retry per transfer
max transfer age
max staging disk usage
max manifest size
max header size
max filename length
allowed content type
allowed extension
allowed compression
```

### 21.2 Tamper Resistance

Untuk boundary tidak tepercaya:

- gunakan TLS
- gunakan authentication
- gunakan authorization
- gunakan SHA-256/HMAC
- validate manifest signature jika perlu
- jangan percaya client-provided checksum saja
- compute checksum server-side

---

## 22. Pattern: Reliable Outbound File Export

Scenario:

```text
service generate report -> publish file -> external partner downloads
```

Design:

1. Generate ke temp file.
2. Compute SHA-256.
3. Count records.
4. Write manifest temp.
5. Force file.
6. Atomic move data to `ready/`.
7. Atomic move manifest to `ready/`.
8. Insert export record with status `READY`.
9. Notify partner.
10. Partner downloads with resume.
11. Partner sends acknowledgment with manifest hash.
12. Reconciliation checks pending ack.

State:

```text
GENERATING -> VERIFYING -> READY -> NOTIFIED -> DOWNLOADED -> ACKED
```

Failure handling:

| Failure | Handling |
|---|---|
| generation crash | temp cleanup / regenerate |
| checksum mismatch | fail export |
| notify fails | retry notification |
| partner download timeout | resume |
| ack missing | remind/reconcile |
| duplicate notify | idempotency by exportId |

---

## 23. Pattern: Reliable Inbound File Ingestion

Scenario:

```text
external partner uploads file -> system validates -> system processes records
```

Design:

1. Partner initiates transfer with manifest.
2. Server returns transferId.
3. Partner uploads chunks with idempotency key.
4. Server validates each chunk.
5. Partner calls finalize.
6. Server verifies whole file.
7. Server publishes to ready zone.
8. Ingestion job reads only ready manifest.
9. Records processed idempotently.
10. Bad records go to dead-letter file.
11. Transfer status becomes `PROCESSED`.

State:

```text
INITIATED -> UPLOADING -> FINALIZED -> READY_FOR_PROCESSING -> PROCESSING -> PROCESSED
```

Failure handling:

| Failure | Handling |
|---|---|
| chunk duplicate same hash | return accepted |
| chunk duplicate different hash | reject conflict |
| chunk missing | report missing chunks |
| whole checksum mismatch | quarantine |
| processing crash | resume from record checkpoint |
| duplicate business record | dedupe by business key |

---

## 24. Pattern: Reliable Service-to-Service Data Transfer

Scenario:

```text
service A sends payload to service B
```

Design:

- Use request id / idempotency key.
- Use timeout per request.
- Use retry only for safe status/errors.
- Use outbox pattern for source event.
- Use inbox/dedupe table for receiver.
- Persist response or final state.
- Reconcile source outbox vs receiver inbox.

Flow:

```text
A writes outbox event in same transaction as business state
A dispatcher sends event to B with idempotency key
B inserts inbox key
B applies business effect
B marks inbox processed
A marks outbox delivered
reconciliation retries undelivered outbox
```

This gives effectively-once business effect, not magical exactly-once network delivery.

---

## 25. Testing Reliable Transfer

### 25.1 Unit Tests

Test:

- manifest validation
- chunk gap/overlap detection
- checksum mismatch
- duplicate chunk same payload
- duplicate chunk different payload
- retry classification
- backoff calculation
- state transition rules

### 25.2 Integration Tests

Test:

- upload complete file
- upload out-of-order chunks
- resume missing chunk
- finalize twice
- retry chunk after timeout
- server restart during upload
- disk full simulation
- permission denied
- atomic move unsupported
- range download resume

### 25.3 Fault Injection

Inject:

- connection reset after partial upload
- response lost after server commit
- corrupt one chunk
- truncate temp file
- duplicate request
- slow reader
- slow writer
- timeout
- rate limit
- process kill during finalization
- DB commit fail after file write
- file write fail after DB status update

### 25.4 Property-Like Invariants

Invariants:

```text
No completed transfer without valid whole-file checksum.
No final file visible before verification.
No two different payloads for same transferId + chunkIndex.
No consumer reads staging file.
Retrying same idempotency key does not create duplicate final object.
Every non-terminal transfer can be resumed, failed, or expired.
Every completed transfer has audit evidence.
```

---

## 26. Anti-Patterns

### 26.1 Retry Without Idempotency

```text
POST /upload
timeout
POST /upload again
```

Result:

- duplicate file
- duplicate DB row
- duplicate downstream processing

### 26.2 Publish Before Verify

```text
write final file
then compute checksum
```

Consumer can read corrupt or partial file.

### 26.3 Trust Client Checksum Only

Client says:

```text
sha256=abc
```

Server stores without recomputing.

This is not verification. It is trust.

### 26.4 Read Whole Large File for Retry

```java
byte[] all = Files.readAllBytes(path);
```

Danger:

- OOM
- GC pressure
- retry amplifies memory spike

### 26.5 Cleanup Too Aggressive

```text
delete all .part files older than 1 hour
```

But a valid long transfer may still be active.

Cleanup must reference transfer state and heartbeat.

### 26.6 Non-Atomic Ready Signal

```text
create manifest first
write data later
```

Consumer may trigger early.

### 26.7 Infinite Retention

Never deleting staging chunks causes disk exhaustion.

Use retention policy:

- completed transfer staging cleanup after grace period
- failed transfer quarantine retention
- expired transfer cleanup
- audit retained separately

---

## 27. Decision Matrix

| Problem | Recommended Pattern |
|---|---|
| small internal config file | temp write + atomic move + checksum optional |
| large file download | temp file + HTTP Range + checksum + atomic move |
| large file upload | chunk manifest + per-chunk checksum + final checksum |
| flaky network | retry with backoff/jitter + resume |
| ambiguous timeout | idempotency key + status query |
| duplicate message risk | inbox/dedupe table |
| consumer must not see partial file | staging directory + atomic publish |
| corruption unacceptable | SHA-256/HMAC + whole-file verification |
| high throughput | bounded parallel chunks + backpressure |
| external partner transfer | manifest + audit + acknowledgment + reconciliation |
| object storage transfer | multipart upload semantics + final commit + manifest |

---

## 28. Production Checklist

### Identity

- [ ] Every transfer has transferId.
- [ ] Every operation has idempotency key.
- [ ] Every chunk has stable chunk index and offset.
- [ ] Every final object has content identity.

### Integrity

- [ ] Validate size.
- [ ] Validate per-chunk checksum.
- [ ] Validate whole-file checksum.
- [ ] Validate manifest schema.
- [ ] Validate compression metadata if used.

### Reliability

- [ ] Retry only classified transient errors.
- [ ] Use exponential backoff and jitter.
- [ ] Use retry budget.
- [ ] Support resume.
- [ ] Persist checkpoint.
- [ ] Reconcile stuck/inconsistent transfer.
- [ ] Implement safe cleanup.

### Finalization

- [ ] Write to staging.
- [ ] Verify before publish.
- [ ] Atomic move where filesystem supports it.
- [ ] Do not expose partial data.
- [ ] Publish manifest/readiness signal last.

### Security

- [ ] Authenticate transfer.
- [ ] Authorize transfer ownership.
- [ ] Enforce max file/chunk size.
- [ ] Do not trust client checksum without recomputation.
- [ ] Avoid logging sensitive payload.
- [ ] Use HMAC/signature if tamper resistance needed.

### Observability

- [ ] Log transferId.
- [ ] Log chunk index and attempt.
- [ ] Emit metrics for retry/failure/throughput.
- [ ] Trace major transfer phases.
- [ ] Keep audit trail.

---

## 29. Mental Model Ringkas

Reliable data transfer bukan tentang menghilangkan failure.

Reliable transfer adalah desain yang membuat failure:

1. terdeteksi
2. dibatasi
3. tidak merusak data
4. bisa diulang dengan aman
5. bisa dilanjutkan
6. bisa diverifikasi
7. bisa direkonsiliasi
8. bisa diaudit

Kalimat kunci:

```text
You do not make the network reliable.
You make your protocol recoverable.
```

---

## 30. Hubungan dengan Part Berikutnya

Part ini memberi desain reliability transfer.

Part berikutnya, Part 026, akan masuk ke problem yang sangat sering muncul dalam sistem enterprise:

```text
Large File Processing:
Memory Safety, Streaming Pipeline, Pagination, Split, Merge, dan External Sort
```

Di sana fokusnya bukan lagi hanya transfer antar node, tetapi bagaimana memproses file besar tanpa OOM, tanpa kehilangan progress, dan tanpa membuat pipeline batch menjadi tidak bisa dipulihkan.

---

## 31. Ringkasan

Data transfer yang benar bukan sekadar:

```java
input.transferTo(output);
```

Itu hanya primitive.

Untuk production-grade reliability, kita perlu:

- transfer identity
- operation idempotency
- chunking
- checkpoint
- checksum
- whole-file digest
- atomic finalization
- retry budget
- resume protocol
- reconciliation
- observability
- audit
- defensive limits

"Exactly once" bukan pondasi yang aman untuk desain. Pondasi yang lebih kuat adalah:

```text
at-least-once attempt
+ idempotent operation
+ durable state
+ verified final artifact
+ reconciliation
= reliable outcome
```

Jika kamu menguasai pola ini, kamu tidak hanya bisa mengirim file. Kamu bisa mendesain data transfer subsystem yang tetap benar ketika network buruk, service restart, chunk duplicate, file corrupt, ack hilang, disk penuh, dan operator perlu membuktikan apa yang terjadi.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 024 — TLS, Certificates, TrustStore, KeyStore, dan Secure Data Transfer](./learn-java-io-nio-networking-data-transfer-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 026 — Large File Processing: Memory Safety, Streaming Pipeline, Pagination, Split, Merge, dan External Sort](./learn-java-io-nio-networking-data-transfer-part-026.md)

</div>