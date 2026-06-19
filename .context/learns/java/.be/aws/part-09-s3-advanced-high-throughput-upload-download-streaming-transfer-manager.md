# Part 9 — S3 Advanced: High-Throughput Upload, Download, Streaming, and Transfer Manager

Seri: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
Target Java: 8 sampai 25  
Fokus utama: AWS SDK for Java 2.x, Amazon S3, multipart transfer, streaming, throughput, memory safety, integrity, dan failure recovery.

---

## 1. Posisi Part Ini dalam Seri

Pada Part 8, kita membahas S3 sebagai object storage: bucket, object key, metadata, consistency, encryption, retention, event, dan mental model bahwa S3 bukan filesystem.

Part 9 naik satu level lebih dekat ke engineering production: bagaimana Java application memindahkan data berukuran besar ke/dari S3 secara aman, cepat, stabil, terukur, dan bisa dipulihkan ketika gagal.

Fokusnya bukan sekadar:

```java
s3.putObject(...)
```

Fokusnya adalah pertanyaan yang muncul di sistem nyata:

- Bagaimana upload file 5 GB, 50 GB, 500 GB tanpa meledakkan heap?
- Bagaimana download object besar tanpa membaca semuanya ke memory?
- Bagaimana menentukan kapan cukup `putObject`, kapan perlu multipart, kapan perlu `S3TransferManager`?
- Bagaimana membuat transfer paralel tanpa membunuh CPU, network, connection pool, atau downstream disk?
- Bagaimana retry dilakukan tanpa menghasilkan object korup atau multipart upload menggantung?
- Bagaimana memvalidasi integrity object?
- Bagaimana mendesain key prefix agar throughput bisa scale?
- Bagaimana menangani cancel, timeout, shutdown, dan cleanup?
- Bagaimana membuat pipeline S3 yang tidak hanya cepat, tetapi operable?

Part ini adalah jembatan menuju Part 10, yang akan membahas S3 sebagai integration boundary dan event source.

---

## 2. Mental Model: S3 Transfer Bukan “Copy File ke Cloud”

Kesalahan umum engineer adalah menganggap upload/download S3 seperti operasi lokal:

```text
local file -> remote file
remote file -> local file
```

Mental model yang lebih akurat:

```text
Application
  -> AWS SDK request pipeline
  -> HTTP client / async runtime / connection pool
  -> network path
  -> S3 regional endpoint
  -> object storage control/data plane
  -> durability/indexing/metadata subsystem
```

Setiap lapisan punya constraint:

| Layer | Constraint |
|---|---|
| Java heap | object allocation, buffering, GC pressure |
| JVM runtime | thread scheduling, virtual thread/platform thread behavior, class loading |
| SDK | retry, timeout, signer, marshalling, body publisher/subscriber |
| HTTP client | connection pool, TLS, socket timeout, backpressure |
| Network | bandwidth, packet loss, NAT/VPC endpoint path, MTU, egress routing |
| S3 | request rate, multipart semantics, object limits, checksum, encryption, lifecycle |
| Application domain | idempotency, audit, state transition, quarantine, retry policy |

Top 1% engineer tidak hanya bertanya “API mana yang dipakai?”, tetapi:

> Transfer ini punya boundary apa, failure mode apa, memory model apa, recovery model apa, integrity guarantee apa, cost model apa, dan observability apa?

---

## 3. S3 Transfer Mode: Pilihan Utama

Ada beberapa mode transfer S3 dari Java.

### 3.1 Simple `putObject` / `getObject`

Cocok untuk:

- object kecil sampai menengah;
- payload sudah tersedia sebagai file atau stream kecil;
- transfer tidak butuh parallelization;
- failure bisa diulang dari awal;
- latency sederhana lebih penting daripada throughput maksimum.

Contoh upload file:

```java
S3Client s3 = S3Client.create();

PutObjectRequest request = PutObjectRequest.builder()
        .bucket(bucket)
        .key(key)
        .contentType("application/pdf")
        .build();

s3.putObject(request, RequestBody.fromFile(path));
```

Contoh download file:

```java
GetObjectRequest request = GetObjectRequest.builder()
        .bucket(bucket)
        .key(key)
        .build();

s3.getObject(request, ResponseTransformer.toFile(destinationPath));
```

Simple API ini mudah, tetapi tidak otomatis menyelesaikan semua problem file besar.

### 3.2 Manual Multipart Upload

Cocok untuk:

- object besar;
- source berupa stream yang ingin dikontrol chunking-nya;
- perlu custom retry per part;
- perlu custom checkpoint/resume;
- perlu custom observability;
- perlu integrasi domain state machine.

Multipart upload memecah object menjadi beberapa part. Part bisa di-upload secara independen, lalu S3 menggabungkannya saat `CompleteMultipartUpload`.

### 3.3 `S3TransferManager`

Cocok untuk:

- file/directory transfer yang ingin high-level API;
- upload/download besar dengan multipart otomatis;
- progress listener;
- parallel transfer;
- pemanfaatan AWS CRT-based S3 client atau Java-based async S3 multipart client.

AWS SDK for Java 2.x menyediakan `S3TransferManager` sebagai high-level file transfer utility untuk transfer file dan directory ke/dari S3. Transfer Manager dapat memanfaatkan multipart upload dan byte-range fetch ketika dibangun di atas CRT-based S3 client atau Java-based async S3 client dengan multipart enabled. Lihat dokumentasi resmi AWS SDK for Java 2.x tentang S3 Transfer Manager.

### 3.4 Async S3 Client + Custom Reactive/Streaming Layer

Cocok untuk:

- pipeline non-blocking;
- integrasi dengan Netty/Reactor/custom async runtime;
- throughput tinggi dengan control detail;
- ingin menyambungkan source/sink streaming internal.

Tetapi ini paling mudah salah. Async bukan otomatis lebih cepat. Async yang salah bisa:

- tetap blocking di event loop;
- membuat unbounded buffer;
- memperparah retry storm;
- sulit di-debug;
- sulit graceful shutdown.

---

## 4. Rule of Thumb: Kapan Pakai Apa?

| Skenario | Pilihan Awal |
|---|---|
| Object kecil, konfigurasi sederhana | `S3Client.putObject/getObject` |
| File besar dari disk ke S3 | `S3TransferManager` |
| File besar dari S3 ke disk | `S3TransferManager` atau `getObject(...toFile)` dengan range jika perlu |
| Stream besar unknown length | manual multipart upload |
| Perlu resume/checkpoint custom | manual multipart upload |
| Perlu progress + parallel transfer dengan kode ringkas | `S3TransferManager` |
| Pipeline async end-to-end | `S3AsyncClient` + careful backpressure |
| Lambda memory kecil, object besar | stream/range/multipart, jangan load full object |
| Compliance butuh checksum eksplisit | checksum-aware upload/download |

Keputusan utama bukan “mana API terbaru”, tetapi:

```text
source data berasal dari mana?
ukuran diketahui atau unknown?
perlu parallel atau tidak?
boleh restart dari awal atau perlu resume?
berapa memory budget?
berapa timeout budget?
apa yang terjadi kalau gagal di tengah?
```

---

## 5. Batasan S3 Multipart Upload yang Harus Dihafal

Multipart upload punya batasan fundamental:

| Item | Limit |
|---|---:|
| Maximum object size | 5 TiB |
| Maximum number of parts | 10,000 |
| Part number | 1 sampai 10,000 |
| Part size | 5 MiB sampai 5 GiB |
| Last part minimum | tidak ada minimum |

Konsekuensi desain:

- Jika object bisa mendekati 5 TiB, part size tidak boleh terlalu kecil.
- Dengan 10,000 part maksimum, part size minimum praktis untuk object besar harus dihitung.
- Untuk object 1 TiB, part 8 MiB menghasilkan terlalu banyak part; perlu part size lebih besar.
- Untuk object kecil, multipart bisa overhead berlebihan.

Rumus kasar:

```text
minimum_part_size = ceil(object_size / 10_000)
```

Lalu naikkan ke nilai operasional yang masuk akal, misalnya 16 MiB, 32 MiB, 64 MiB, 128 MiB, atau 256 MiB tergantung workload.

Contoh:

| Object Size | Part Size 8 MiB | Part Size 64 MiB | Part Size 128 MiB |
|---:|---:|---:|---:|
| 1 GiB | 128 parts | 16 parts | 8 parts |
| 10 GiB | 1,280 parts | 160 parts | 80 parts |
| 100 GiB | 12,800 parts, invalid | 1,600 parts | 800 parts |
| 1 TiB | 131,072 parts, invalid | 16,384 parts, invalid | 8,192 parts |

Practical lesson:

> Default part size yang nyaman untuk 100 MB belum tentu aman untuk 1 TB.

---

## 6. Multipart Upload Lifecycle

Multipart upload terdiri dari beberapa tahap:

```text
1. CreateMultipartUpload
2. UploadPart #1
3. UploadPart #2
4. UploadPart #N
5. CompleteMultipartUpload
```

Jika gagal:

```text
AbortMultipartUpload
```

Diagram:

```text
              ┌───────────────────────┐
              │ CreateMultipartUpload │
              └───────────┬───────────┘
                          │ uploadId
        ┌─────────────────┼─────────────────┐
        │                 │                 │
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼───────┐
│ UploadPart #1 │ │ UploadPart #2 │ │ UploadPart #N │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │ eTag/checksum    │ eTag/checksum    │ eTag/checksum
        └─────────────────┼─────────────────┘
                          │
              ┌───────────▼───────────┐
              │ CompleteMultipartUpload│
              └───────────────────────┘
```

State machine:

```text
NOT_STARTED
  -> INITIATED(uploadId)
  -> PARTIALLY_UPLOADED(uploadedParts)
  -> COMPLETING
  -> COMPLETED(objectVisible)

Any state after INITIATED before COMPLETED:
  -> ABORTING
  -> ABORTED
```

Important invariant:

> Setelah `CreateMultipartUpload` berhasil, sistem bertanggung jawab untuk menyelesaikan atau membatalkan multipart upload tersebut.

Incomplete multipart upload dapat meninggalkan storage yang tetap dikenakan biaya sampai di-abort atau dibersihkan lifecycle rule.

---

## 7. Manual Multipart Upload: Skeleton yang Benar

Contoh berikut bukan utility final, tetapi menunjukkan lifecycle minimum yang aman.

```java
public final class S3MultipartUploader {

    private static final int PART_SIZE = 64 * 1024 * 1024; // 64 MiB

    private final S3Client s3;

    public S3MultipartUploader(S3Client s3) {
        this.s3 = Objects.requireNonNull(s3);
    }

    public void upload(
            String bucket,
            String key,
            InputStream input,
            String contentType
    ) throws IOException {

        CreateMultipartUploadRequest createRequest = CreateMultipartUploadRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(contentType)
                .build();

        CreateMultipartUploadResponse createResponse = s3.createMultipartUpload(createRequest);
        String uploadId = createResponse.uploadId();

        List<CompletedPart> completedParts = new ArrayList<>();
        int partNumber = 1;

        try {
            byte[] buffer = new byte[PART_SIZE];
            int bytesRead;

            while ((bytesRead = readUpTo(input, buffer)) > 0) {
                UploadPartRequest uploadPartRequest = UploadPartRequest.builder()
                        .bucket(bucket)
                        .key(key)
                        .uploadId(uploadId)
                        .partNumber(partNumber)
                        .contentLength((long) bytesRead)
                        .build();

                UploadPartResponse uploadPartResponse = s3.uploadPart(
                        uploadPartRequest,
                        RequestBody.fromBytes(Arrays.copyOf(buffer, bytesRead))
                );

                completedParts.add(CompletedPart.builder()
                        .partNumber(partNumber)
                        .eTag(uploadPartResponse.eTag())
                        .build());

                partNumber++;
            }

            CompletedMultipartUpload completedMultipartUpload = CompletedMultipartUpload.builder()
                    .parts(completedParts)
                    .build();

            CompleteMultipartUploadRequest completeRequest = CompleteMultipartUploadRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .uploadId(uploadId)
                    .multipartUpload(completedMultipartUpload)
                    .build();

            s3.completeMultipartUpload(completeRequest);
        } catch (Exception failure) {
            abortQuietly(bucket, key, uploadId, failure);
            throw failure;
        }
    }

    private static int readUpTo(InputStream input, byte[] buffer) throws IOException {
        int offset = 0;
        while (offset < buffer.length) {
            int read = input.read(buffer, offset, buffer.length - offset);
            if (read == -1) {
                break;
            }
            offset += read;
        }
        return offset;
    }

    private void abortQuietly(String bucket, String key, String uploadId, Exception originalFailure) {
        try {
            s3.abortMultipartUpload(AbortMultipartUploadRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .uploadId(uploadId)
                    .build());
        } catch (Exception abortFailure) {
            originalFailure.addSuppressed(abortFailure);
        }
    }
}
```

Namun skeleton ini masih punya kelemahan:

- `Arrays.copyOf` membuat copy memory per part.
- Belum ada checksum eksplisit.
- Belum ada retry per part custom.
- Belum ada progress metric.
- Belum ada checkpoint/resume.
- Belum ada concurrency.
- Belum ada cancellation.
- Belum ada validation maksimum 10,000 part.

Untuk production, skeleton ini harus dikembangkan atau diganti dengan Transfer Manager bila cocok.

---

## 8. Memory Model: Kesalahan Paling Mahal di Java S3 Transfer

### 8.1 Anti-pattern: Load Full Object ke Byte Array

Contoh buruk:

```java
byte[] allBytes = Files.readAllBytes(path);
s3.putObject(request, RequestBody.fromBytes(allBytes));
```

Masalah:

- file 1 GB butuh minimal 1 GB heap;
- allocation besar bisa memicu GC pressure;
- di Lambda bisa langsung OOM;
- di container bisa kena memory limit;
- retry membuat pressure lebih buruk;
- object copy internal bisa membuat peak memory > ukuran file.

### 8.2 Lebih Baik: File-backed Body

```java
s3.putObject(request, RequestBody.fromFile(path));
```

Ini menghindari load seluruh file ke heap.

### 8.3 Stream dengan Known Content Length

```java
try (InputStream input = Files.newInputStream(path)) {
    s3.putObject(request, RequestBody.fromInputStream(input, Files.size(path)));
}
```

Content length harus benar. Jika salah, request bisa gagal, hang, atau menghasilkan perilaku yang tidak diharapkan.

### 8.4 Stream dengan Unknown Length

Unknown length lebih rumit. Jangan asal buffering seluruh stream untuk mengetahui length.

Pilihan:

- tulis dulu ke temp file, lalu upload dari file;
- manual multipart upload;
- async streaming dengan body publisher yang punya backpressure;
- domain-specific chunking.

Trade-off:

| Pilihan | Kelebihan | Kekurangan |
|---|---|---|
| Temp file | sederhana, retry mudah | butuh disk, cleanup |
| Manual multipart | memory bounded | kode lebih kompleks |
| Async streaming | throughput baik | backpressure sulit |
| Full buffer | mudah | berbahaya untuk file besar |

---

## 9. Designing a Bounded Memory Upload Pipeline

Target invariant:

```text
Peak memory tidak boleh proporsional terhadap ukuran object.
Peak memory harus proporsional terhadap part_size × concurrency.
```

Jika:

```text
part_size = 64 MiB
concurrency = 4
```

Maka buffer aktif kasar:

```text
64 MiB × 4 = 256 MiB
```

Tambahkan overhead SDK, TLS, direct buffer, heap object, metadata, dan app logic. Jadi memory limit container harus lebih besar dari angka mentah.

Formula kasar:

```text
required_memory_budget ≈ part_size × concurrency × safety_factor
```

Safety factor bisa 1.5 sampai 3 tergantung runtime, HTTP client, dan pipeline.

Contoh:

| Part Size | Concurrency | Raw Buffer | Dengan Safety Factor 2 |
|---:|---:|---:|---:|
| 16 MiB | 4 | 64 MiB | 128 MiB |
| 64 MiB | 4 | 256 MiB | 512 MiB |
| 128 MiB | 8 | 1 GiB | 2 GiB |

Kesimpulan:

> Menaikkan concurrency tanpa menghitung buffer berarti memindahkan bottleneck dari network ke memory.

---

## 10. Parallelism: Tidak Selalu Lebih Besar Lebih Baik

Parallel multipart upload meningkatkan throughput karena beberapa part bisa dikirim bersamaan. Tetapi parallelism dibatasi oleh:

- bandwidth jaringan;
- CPU untuk TLS/checksum/compression jika ada;
- jumlah connection;
- endpoint path;
- NAT gateway/VPC endpoint capacity;
- disk read throughput;
- JVM memory;
- S3 request throttling;
- downstream application state.

Model sederhana:

```text
throughput = min(
  disk_read_throughput,
  network_upload_throughput,
  sdk_http_capacity,
  s3_prefix_capacity,
  cpu_tls_checksum_capacity,
  application_backpressure_limit
)
```

Jika disk lokal hanya mampu membaca 200 MB/s, menaikkan S3 concurrency sampai target 2 GB/s tidak berguna.

Jika network egress container terbatas, concurrency tinggi hanya menambah context switching dan timeout.

Jika part terlalu kecil, request overhead tinggi.

Jika part terlalu besar, retry part mahal dan memory besar.

---

## 11. S3 Request Rate and Prefix Design for Throughput

Amazon S3 otomatis scale ke request rate tinggi. Dokumentasi AWS menyebut aplikasi dapat mencapai setidaknya 3,500 request per detik untuk PUT/COPY/POST/DELETE atau 5,500 request per detik untuk GET/HEAD per partitioned S3 prefix, dan tidak ada batas jumlah prefix dalam bucket.

Konsekuensi:

- high-throughput workload perlu key design yang tidak memusatkan semua request ke satu prefix panas;
- parallelization bisa dibantu dengan distribusi prefix;
- prefix bukan folder fisik, tetapi bagian awal object key yang digunakan S3 untuk partitioning/scaling;
- randomization lama di awal key tidak selalu wajib seperti era S3 lama, tetapi workload ekstrem tetap perlu desain prefix sadar throughput.

Contoh key buruk untuk write burst besar:

```text
uploads/current/file-000001
uploads/current/file-000002
uploads/current/file-000003
```

Contoh lebih scalable:

```text
uploads/2026/06/19/tenant-a/shard-00/file-000001
uploads/2026/06/19/tenant-a/shard-01/file-000002
uploads/2026/06/19/tenant-a/shard-02/file-000003
```

Atau:

```text
landing/tenant-a/2026/06/19/00/...
landing/tenant-a/2026/06/19/01/...
landing/tenant-a/2026/06/19/02/...
```

Namun jangan over-engineer. Untuk traffic kecil/menengah, key yang domain-readable sering lebih berharga daripada sharding rumit.

Prinsip:

```text
Key design harus melayani query/list/access pattern dan throughput pattern sekaligus.
```

---

## 12. Upload Integrity: ETag Bukan Selalu MD5 Object

Banyak engineer mengira ETag selalu MD5 object. Itu berbahaya.

Untuk single-part upload tanpa encryption tertentu, ETag sering terlihat seperti MD5. Tetapi untuk multipart upload, ETag biasanya merepresentasikan komposisi part dan bukan MD5 sederhana dari seluruh object.

Karena itu, untuk integrity modern:

- gunakan checksum algorithm yang didukung S3/SDK;
- simpan checksum di metadata/domain record jika perlu;
- validasi checksum saat upload/download;
- jangan jadikan ETag sebagai universal checksum domain.

AWS SDK for Java 2.x menyediakan dukungan checksum untuk S3. Mulai versi 2.30.0, SDK memberikan default integrity protection dengan menghitung CRC32 untuk upload jika developer tidak menyediakan checksum value atau algorithm tertentu.

Checksum yang perlu diketahui:

- CRC32;
- CRC32C;
- CRC64NVME;
- SHA1;
- SHA256.

Pemilihan checksum adalah trade-off:

| Algorithm | Karakter |
|---|---|
| CRC32/CRC32C | cepat, cocok untuk deteksi corruption transport/storage umum |
| SHA256 | lebih kuat secara cryptographic, lebih mahal |
| CRC64NVME | relevan untuk S3 checksum modern tertentu |

Untuk regulated atau audit-heavy system, jangan hanya bergantung pada “upload berhasil”. Simpan bukti integrity:

```text
object_key
version_id
size_bytes
checksum_algorithm
checksum_value
uploaded_by
upload_completed_at
request_id
content_type
classification
```

---

## 13. Using S3TransferManager

### 13.1 Dependency Concept

`S3TransferManager` ada di module transfer manager SDK v2. Biasanya digunakan bersama:

- `software.amazon.awssdk:s3-transfer-manager`
- optional AWS CRT dependency untuk CRT-based S3 client.

Gunakan BOM SDK agar versi module konsisten.

Maven konseptual:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>software.amazon.awssdk</groupId>
            <artifactId>bom</artifactId>
            <version>${aws.sdk.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<dependencies>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>s3</artifactId>
    </dependency>
    <dependency>
        <groupId>software.amazon.awssdk</groupId>
        <artifactId>s3-transfer-manager</artifactId>
    </dependency>
</dependencies>
```

### 13.2 Basic Upload File

```java
S3TransferManager transferManager = S3TransferManager.create();

UploadFileRequest uploadFileRequest = UploadFileRequest.builder()
        .putObjectRequest(b -> b
                .bucket(bucket)
                .key(key)
                .contentType("application/octet-stream"))
        .source(path)
        .build();

FileUpload upload = transferManager.uploadFile(uploadFileRequest);
CompletedFileUpload completed = upload.completionFuture().join();

System.out.println("ETag: " + completed.response().eTag());
```

### 13.3 Basic Download File

```java
S3TransferManager transferManager = S3TransferManager.create();

DownloadFileRequest downloadFileRequest = DownloadFileRequest.builder()
        .getObjectRequest(b -> b
                .bucket(bucket)
                .key(key))
        .destination(destinationPath)
        .build();

FileDownload download = transferManager.downloadFile(downloadFileRequest);
CompletedFileDownload completed = download.completionFuture().join();

System.out.println("Downloaded: " + completed.response().contentLength());
```

### 13.4 Lifecycle

Transfer manager dan underlying async client harus diperlakukan sebagai resource aplikasi, bukan dibuat per transfer.

Buruk:

```java
public void upload(Path file) {
    S3TransferManager manager = S3TransferManager.create();
    manager.uploadFile(...).completionFuture().join();
}
```

Lebih baik:

```java
public final class S3TransferService implements AutoCloseable {

    private final S3TransferManager transferManager;

    public S3TransferService(S3TransferManager transferManager) {
        this.transferManager = transferManager;
    }

    public CompletedFileUpload upload(String bucket, String key, Path source) {
        UploadFileRequest request = UploadFileRequest.builder()
                .putObjectRequest(b -> b.bucket(bucket).key(key))
                .source(source)
                .build();

        return transferManager.uploadFile(request)
                .completionFuture()
                .join();
    }

    @Override
    public void close() {
        transferManager.close();
    }
}
```

In Spring Boot, jadikan bean singleton dan close saat shutdown.

---

## 14. CRT-Based S3 Client vs Java-Based Multipart Client

`S3TransferManager` dapat memakai:

- AWS CRT-based S3 async client;
- Java-based S3 async client dengan multipart enabled.

AWS CRT-based S3 client dirancang untuk performa transfer S3 yang lebih tinggi dan dapat otomatis memanfaatkan multipart transfer. Namun ia membawa native dependency dan karakter operasional yang perlu diuji di environment target.

Java-based client lebih “murni Java”, tetapi performa/behavior bisa berbeda.

Decision table:

| Faktor | CRT-based S3 client | Java-based async multipart client |
|---|---|---|
| Performance target | tinggi | baik, tergantung setup |
| Native dependency | ya | tidak/lebih minimal |
| Deployment simplicity | perlu validasi platform | lebih sederhana |
| Lambda/container compatibility | perlu diuji | biasanya lebih familiar |
| Debugging | bisa lebih kompleks | lebih Java-native |
| Use case | transfer intensif | general async/multipart |

Prinsip:

> Jangan pilih CRT hanya karena “lebih cepat”. Pilih setelah benchmark di runtime, region, network path, object size, dan concurrency yang mirip production.

---

## 15. Download Besar: Jangan `readAllBytes()`

Anti-pattern:

```java
ResponseBytes<GetObjectResponse> bytes = s3.getObjectAsBytes(request);
byte[] data = bytes.asByteArray();
```

Ini hanya aman untuk object kecil.

Untuk object besar, gunakan file sink:

```java
s3.getObject(request, ResponseTransformer.toFile(destinationPath));
```

Atau stream:

```java
try (ResponseInputStream<GetObjectResponse> input = s3.getObject(request)) {
    process(input);
}
```

Tetapi hati-hati: `process(input)` harus streaming, bukan diam-diam mengumpulkan semua data ke memory.

Buruk:

```java
byte[] all = input.readAllBytes();
```

Lebih baik:

```java
byte[] buffer = new byte[1024 * 1024];
int read;
while ((read = input.read(buffer)) != -1) {
    processChunk(buffer, 0, read);
}
```

---

## 16. Range GET and Parallel Download

S3 mendukung range request. Ini memungkinkan membaca sebagian object:

```java
GetObjectRequest request = GetObjectRequest.builder()
        .bucket(bucket)
        .key(key)
        .range("bytes=0-1048575")
        .build();
```

Use case:

- resume download;
- membaca header object besar;
- parallel download;
- partial processing;
- mengambil segment tertentu dari file format yang mendukung random access.

Namun range GET bukan magic. Anda harus memastikan:

- file format bisa diproses secara segmental;
- segment boundary valid;
- output assembly benar;
- checksum/integrity tetap divalidasi;
- concurrency tidak melampaui disk/network limit.

Parallel download model:

```text
HEAD object -> content length
split into ranges
GET range 1 -> write offset 1
GET range 2 -> write offset 2
GET range N -> write offset N
validate size/checksum
```

Risiko:

- corrupted local assembly jika write offset salah;
- sparse file issue;
- partial file tertinggal saat gagal;
- retry range bisa konflik dengan writer;
- object berubah jika tidak pin ke versionId.

Untuk bucket versioned, gunakan `versionId` agar range download konsisten terhadap object version yang sama.

---

## 17. Streaming Processing Pattern

Untuk object besar, sering kali tujuan download bukan menyimpan file, tetapi memproses isi.

Contoh:

- CSV besar;
- NDJSON;
- XML besar;
- ZIP archive;
- PDF batch;
- log file;
- domain export.

Pattern:

```text
S3 getObject stream
  -> bounded parser
  -> record validator
  -> batch writer / queue publisher
  -> checkpoint
```

Invariants:

- parser tidak boleh load full file;
- batch size bounded;
- checkpoint cukup untuk resume atau reprocess;
- record-level error masuk quarantine/report;
- object-level error masuk retry/DLQ;
- processing idempotent.

Contoh sederhana:

```java
try (ResponseInputStream<GetObjectResponse> input = s3.getObject(request);
     BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {

    List<MyRecord> batch = new ArrayList<>(500);
    String line;

    while ((line = reader.readLine()) != null) {
        MyRecord record = parse(line);
        batch.add(record);

        if (batch.size() == 500) {
            writeBatch(batch);
            batch.clear();
        }
    }

    if (!batch.isEmpty()) {
        writeBatch(batch);
    }
}
```

Catatan penting:

- `BufferedReader.readLine()` cocok untuk line-based text, bukan binary arbitrary.
- Untuk CSV kompleks, gunakan parser yang benar.
- Untuk XML besar, gunakan StAX/SAX, bukan DOM.
- Untuk ZIP, hati-hati zip bomb dan entry size validation.

---

## 18. Upload from HTTP Request to S3

Skenario umum:

```text
browser/client -> Java API -> S3
```

Ada dua desain besar.

### 18.1 Proxy Upload Through Backend

```text
client -> Java backend -> S3
```

Kelebihan:

- backend bisa inspeksi payload;
- validasi domain bisa ketat;
- tidak expose direct upload ke client;
- mudah audit.

Kekurangan:

- backend menanggung bandwidth;
- backend memory/thread harus hati-hati;
- timeout lebih panjang;
- cost lebih tinggi;
- bottleneck di application layer.

### 18.2 Presigned URL Direct Upload

```text
client -> S3 directly
backend -> issue presigned URL + validate metadata
```

Kelebihan:

- backend tidak proxy data besar;
- scale lebih baik;
- lebih murah untuk application compute;
- cocok untuk file besar.

Kekurangan:

- validasi content lebih sulit sebelum upload;
- perlu post-upload verification;
- perlu lifecycle cleanup untuk orphan object;
- perlu key policy ketat;
- perlu scanning/quarantine jika content untrusted.

Decision:

| Requirement | Better Pattern |
|---|---|
| File kecil dan harus langsung divalidasi backend | proxy |
| File besar dari user browser/mobile | presigned URL |
| Data sangat sensitif, harus inline inspect | proxy atau controlled upload gateway |
| Banyak concurrent upload | presigned URL |
| Perlu malware scanning | presigned URL ke quarantine prefix + scanner |

---

## 19. Presigned URL Advanced Considerations

Presigned URL bukan “public access”; ia adalah temporary signed request.

Namun tetap perlu guardrail:

- expiration pendek;
- key ditentukan backend, bukan user bebas;
- content type/size expectation disimpan di domain record;
- upload ke quarantine/landing prefix;
- setelah upload, backend melakukan `HeadObject` validation;
- jangan percaya metadata dari client tanpa validasi;
- gunakan bucket policy jika perlu membatasi condition;
- gunakan object tag/status untuk lifecycle.

Flow:

```text
1. User request upload session
2. Backend validate business permission
3. Backend create upload record: PENDING_UPLOAD
4. Backend generate presigned PUT for specific bucket/key
5. Client uploads directly to S3
6. Backend receives callback/poll/event
7. Backend HEAD object and validate size/checksum/content-type
8. Backend marks UPLOADED or QUARANTINED
9. Async scanner/processor continues
```

State machine:

```text
REQUESTED
  -> PRESIGNED_URL_ISSUED
  -> OBJECT_UPLOADED
  -> VALIDATED
  -> ACCEPTED

Failure paths:
  -> EXPIRED
  -> SIZE_MISMATCH
  -> CHECKSUM_MISMATCH
  -> CONTENT_REJECTED
  -> ORPHAN_CLEANED
```

---

## 20. Retry Semantics in Multipart Upload

Multipart upload punya retry behavior yang lebih baik daripada single huge upload karena part bisa diulang.

Namun retry harus dipahami:

- retry `UploadPart` aman jika part number dan uploadId sama, dan body part sama;
- retry `CompleteMultipartUpload` perlu hati-hati jika client timeout tetapi server mungkin sudah complete;
- retry `AbortMultipartUpload` umumnya safe sebagai cleanup, tapi tetap handle failure;
- retry semua part secara agresif bisa memperparah network congestion.

Failure example:

```text
UploadPart #7 succeeded in S3
client timed out waiting for response
client retries UploadPart #7
```

Jika body sama, ini biasanya acceptable. Tetapi observability harus mencatat retry.

More subtle:

```text
CompleteMultipartUpload sent
client timeout
unknown whether object completed
```

Recovery:

- lakukan `HeadObject` terhadap bucket/key;
- jika versioning aktif, validasi version/object metadata;
- jika object ada dan metadata/checksum/size match, treat as completed;
- jika tidak ada, list multipart state atau abort sesuai policy;
- jangan langsung upload ulang tanpa idempotency strategy.

---

## 21. Idempotency for S3 Upload Workflows

S3 `PutObject` ke key yang sama dapat overwrite object jika versioning tidak aktif. Dalam domain system, ini bisa menjadi bug serius.

Gunakan idempotency di level domain:

```text
upload_request_id -> bucket/key/version/expected_checksum/status
```

Key design bisa memasukkan immutable ID:

```text
cases/{caseId}/documents/{documentId}/original/{uploadRequestId}.pdf
```

Bukan:

```text
cases/{caseId}/document.pdf
```

Karena overwrite risk tinggi.

Pattern:

```text
1 upload request menghasilkan 1 immutable object key
update status via DB transaction/domain state
jangan reuse key untuk payload berbeda
```

Jika perlu “current document”, gunakan pointer metadata di DB:

```text
current_document_version -> object_key/version_id
```

Bukan overwrite object utama.

---

## 22. Cleanup Strategy for Failed Multipart Uploads

Tidak cukup mengandalkan kode `catch` untuk abort. Process bisa mati, container bisa di-kill, Lambda bisa timeout, node bisa crash.

Layer cleanup:

1. Try-catch abort saat failure normal.
2. Graceful shutdown handler untuk transfer berjalan.
3. Lifecycle rule untuk abort incomplete multipart uploads setelah N hari.
4. Scheduled auditor untuk upload session stuck.
5. Metric/alert untuk incomplete multipart growth.

State table:

| State | Cleanup Action |
|---|---|
| `INITIATED` terlalu lama | abort multipart |
| `PARTIALLY_UPLOADED` stuck | abort atau resume |
| `COMPLETING` unknown | `HeadObject` validate |
| `COMPLETED` but domain not updated | reconcile |
| `DOMAIN_COMPLETED` but object missing | incident |

Top-tier invariant:

> Setiap upload session harus berakhir di completed, aborted, expired, atau quarantined. Tidak boleh ada state “mungkin masih jalan” tanpa owner.

---

## 23. S3 Transfer Observability

Minimal log fields untuk transfer besar:

```text
operation
bucket
key
version_id
upload_id
object_size_bytes
part_size_bytes
part_count
concurrency
checksum_algorithm
checksum_value
aws_request_id
attempt
duration_ms
throughput_mbps
status
failure_category
```

Jangan log:

- presigned URL penuh;
- secret query parameter;
- sensitive object key jika key mengandung PII;
- raw object content;
- customer metadata yang sensitive.

Metric penting:

| Metric | Tujuan |
|---|---|
| upload_success_count | baseline success |
| upload_failure_count | failure trend |
| upload_duration_ms | latency distribution |
| upload_bytes | volume |
| upload_throughput_mbps | performance |
| multipart_abort_count | cleanup health |
| multipart_incomplete_count | leak detection |
| retry_count | dependency pressure |
| checksum_failure_count | data integrity alarm |
| s3_4xx_count | permission/input bug |
| s3_5xx_count | service/transient issue |
| s3_throttle_count | capacity/backpressure issue |

Log example:

```json
{
  "event": "s3_upload_completed",
  "bucket": "app-prod-documents",
  "key": "cases/CASE-123/documents/DOC-456/original/REQ-789.pdf",
  "sizeBytes": 734003200,
  "partSizeBytes": 67108864,
  "partCount": 11,
  "durationMs": 18500,
  "throughputMbps": 317.5,
  "checksumAlgorithm": "CRC32C",
  "awsRequestId": "...",
  "correlationId": "..."
}
```

---

## 24. Timeout Design for S3 Transfer

Timeout untuk transfer besar tidak bisa disamakan dengan API kecil.

Jenis timeout:

- connect timeout;
- TLS handshake timeout;
- socket/read timeout;
- API call attempt timeout;
- total API call timeout;
- business transfer timeout;
- workflow timeout.

Untuk upload 50 GB, total transfer bisa lama. Jangan set total API call timeout 30 detik tanpa memahami ukuran data.

Model:

```text
expected_duration = object_size / expected_min_throughput
business_timeout = expected_duration × safety_factor
```

Contoh:

```text
object_size = 10 GiB
minimum_expected_throughput = 100 MiB/s
expected_duration ≈ 102 seconds
business_timeout = 5 minutes
```

Namun timeout per attempt/part bisa lebih pendek.

Prinsip:

```text
Timeout kecil untuk connect/acquire.
Timeout sedang untuk part attempt.
Timeout besar untuk whole transfer workflow.
```

---

## 25. Backpressure Design

Backpressure berarti upstream tidak boleh mengirim lebih cepat daripada downstream bisa memproses.

Dalam S3 upload pipeline:

```text
source -> buffer -> upload workers -> S3
```

Jika source membaca disk 2 GB/s tetapi upload hanya 200 MB/s, buffer akan tumbuh jika tidak dibatasi.

Bounded design:

```text
bounded queue capacity = concurrency × small multiplier
```

Contoh:

```text
reader thread reads part
puts into BlockingQueue(max=8)
upload worker consumes
if queue full, reader blocks
```

Namun hati-hati: setiap queued part berarti memory.

Jika `part_size = 64 MiB` dan queue capacity 8:

```text
queued memory = 512 MiB
```

Belum termasuk active upload workers.

Backpressure lebih penting daripada theoretical throughput.

---

## 26. Disk-to-S3 Pipeline Design

Untuk file lokal besar:

```text
FileChannel / InputStream
  -> fixed-size part reader
  -> bounded executor
  -> uploadPart
  -> collect CompletedPart
  -> completeMultipartUpload
```

Design choice:

| Choice | Consequence |
|---|---|
| Single reader, multiple uploaders | simple, bounded |
| Multiple range readers | faster disk if random-read capable |
| Memory mapped file | can help, but operationally tricky |
| Direct buffer | lower copy in some path, more complex |
| Transfer Manager | recommended starting point |

Untuk sebagian besar aplikasi enterprise, `S3TransferManager` lebih baik daripada custom executor kecuali ada kebutuhan khusus.

---

## 27. S3-to-Disk Pipeline Design

Untuk download besar:

```text
HEAD object
  -> allocate temp file path
  -> download to temp file
  -> validate size/checksum
  -> atomic move to final path
```

Jangan download langsung ke final path. Jika gagal di tengah, consumer lain bisa membaca file parsial.

Pattern:

```text
file.pdf.part
  -> validate
  -> atomic rename
  -> file.pdf
```

Jika filesystem mendukung atomic move:

```java
Files.move(tempPath, finalPath, StandardCopyOption.ATOMIC_MOVE);
```

Jika tidak, gunakan state marker:

```text
file.pdf.downloading
file.pdf.ready
```

---

## 28. Lambda-Specific Considerations

Lambda punya karakter khusus:

- memory menentukan CPU allocation secara proporsional;
- `/tmp` storage terbatas tetapi bisa dikonfigurasi;
- execution timeout maksimum terbatas;
- cold start mempengaruhi SDK/client init;
- function bisa dihentikan saat timeout;
- concurrent invocation bisa menciptakan burst ke S3.

Implication:

- jangan download object besar ke heap;
- gunakan streaming atau `/tmp`;
- untuk object sangat besar, pertimbangkan ECS/Fargate/Batch daripada Lambda;
- gunakan reserved concurrency untuk membatasi burst;
- pastikan multipart abort atau lifecycle cleanup;
- jangan membuat S3 client per record dalam batch;
- simpan client statis/singleton di execution environment.

Decision table:

| Workload | Lambda cocok? |
|---|---|
| Thumbnail small image | cocok |
| Validate metadata object kecil | cocok |
| Parse CSV 20 MB | bisa cocok |
| Transform file 5 GB | hati-hati, mungkin ECS/Batch lebih tepat |
| Long-running archive processing | biasanya bukan Lambda |
| Burst event processor ringan | cocok dengan concurrency limit |

---

## 29. Java 8 sampai 25: Runtime Differences That Matter

### Java 8

- masih sering ada di legacy enterprise;
- kompatibel dengan AWS SDK v2;
- GC dan TLS performance tidak sebaik runtime modern;
- tidak ada virtual thread;
- careful dengan heap pressure.

### Java 11/17

- baseline modern banyak enterprise;
- TLS/JIT/GC lebih baik;
- dependency ecosystem matang;
- cocok untuk Spring Boot 2/3 transisi.

### Java 21

- LTS modern;
- virtual thread tersedia;
- ZGC/G1 improvements;
- cocok untuk high-concurrency blocking style, tetapi SDK async tetap punya runtime sendiri.

### Java 25

- target modern terbaru dalam seri ini;
- perlu validasi support runtime deployment masing-masing platform;
- prinsip desain S3 tetap sama: bounded memory, timeout, retry, checksum, lifecycle.

Virtual thread note:

Virtual thread bisa membantu jika menggunakan blocking `S3Client` dalam banyak task concurrent. Namun ia tidak menghapus limit:

- HTTP connection pool;
- S3 request rate;
- memory buffer;
- network bandwidth;
- disk throughput.

Dengan virtual thread, bottleneck pindah dari “jumlah thread mahal” ke “resource eksternal”. Jadi tetap perlu semaphore/backpressure.

Contoh limiter:

```java
Semaphore permits = new Semaphore(16);

try {
    permits.acquire();
    s3.putObject(request, RequestBody.fromFile(path));
} finally {
    permits.release();
}
```

---

## 30. Content Encoding and Compression

S3 menyimpan object bytes. Jika Anda compress sebelum upload:

```text
original data -> gzip/zstd/zip -> S3 object
```

Pertanyaan desain:

- apakah consumer tahu object compressed?
- apakah content-encoding diset?
- apakah checksum untuk compressed bytes atau original bytes?
- apakah range GET masih berguna?
- apakah object bisa diproses streaming?
- apakah compression cost lebih murah daripada storage/network?

Untuk HTTP-style object:

```java
PutObjectRequest request = PutObjectRequest.builder()
        .bucket(bucket)
        .key(key)
        .contentType("application/json")
        .contentEncoding("gzip")
        .build();
```

Namun untuk archive/domain file, kadang lebih baik key/metadata eksplisit:

```text
reports/2026/06/report-123.json.gz
metadata: original-content-type=application/json
```

---

## 31. Server-Side Encryption and Multipart Upload

Encryption mode mempengaruhi permission dan operation:

- SSE-S3: managed by S3;
- SSE-KMS: uses KMS key;
- SSE-C: customer-provided key, jarang direkomendasikan untuk app umum.

Untuk SSE-KMS, role aplikasi perlu permission KMS yang sesuai.

Contoh:

```java
CreateMultipartUploadRequest request = CreateMultipartUploadRequest.builder()
        .bucket(bucket)
        .key(key)
        .serverSideEncryption(ServerSideEncryption.AWS_KMS)
        .ssekmsKeyId(kmsKeyId)
        .build();
```

Operational consequence:

- KMS throttling bisa mempengaruhi transfer;
- KMS key policy harus benar;
- cross-account access lebih kompleks;
- CloudTrail audit lebih kaya;
- cost KMS request perlu diperhitungkan.

---

## 32. Versioning and Race Conditions

Jika bucket versioning aktif, upload ke key yang sama membuat version baru. Jika tidak aktif, upload overwrite object.

Untuk workflow aman:

- gunakan immutable key;
- simpan versionId jika versioning aktif;
- gunakan conditional operation jika relevan;
- validasi object setelah upload;
- hindari key shared mutable untuk concurrent writer.

Race example:

```text
Worker A upload cases/123/document.pdf
Worker B upload cases/123/document.pdf
```

Tanpa guardrail, last writer wins.

Lebih baik:

```text
cases/123/documents/doc-abc/versions/upload-001.pdf
cases/123/documents/doc-abc/versions/upload-002.pdf
```

DB menentukan versi aktif.

---

## 33. Transfer Manager vs Manual Multipart: Deeper Comparison

| Dimension | Transfer Manager | Manual Multipart |
|---|---|---|
| Code complexity | rendah | tinggi |
| Progress tracking | built-in support | custom |
| Parallelization | built-in | custom |
| Resume/cancel | partial support depending usage | bisa custom penuh |
| Domain state integration | perlu wrapping | sangat fleksibel |
| Unknown stream length | tergantung API/source | bisa dikontrol |
| Fine-grained retry | SDK-managed | custom possible |
| Learning value | cepat produktif | memahami failure detail |
| Production default | sering recommended | untuk special case |

Practical guidance:

```text
Mulai dari Transfer Manager untuk file/directory transfer.
Turun ke manual multipart jika butuh domain-specific control yang Transfer Manager tidak berikan.
```

---

## 34. Designing a Production S3 Transfer Service Abstraction

Jangan sebarkan `S3Client` raw ke seluruh codebase tanpa boundary. Buat abstraction yang menyembunyikan policy dan menjaga invariant.

Contoh interface:

```java
public interface ObjectTransferService {

    UploadResult uploadFile(UploadCommand command);

    DownloadResult downloadToFile(DownloadCommand command);

    StreamResult streamObject(StreamCommand command);

    HeadResult headObject(ObjectRef ref);

    void deleteObject(ObjectRef ref);
}
```

Command:

```java
public final class UploadCommand {
    private final String domainObjectType;
    private final String ownerId;
    private final Path sourcePath;
    private final String bucket;
    private final String key;
    private final String contentType;
    private final Long expectedSize;
    private final String expectedChecksum;
    private final Map<String, String> metadata;
    private final boolean requireEncryption;
    private final Duration timeout;
}
```

Result:

```java
public final class UploadResult {
    private final String bucket;
    private final String key;
    private final String versionId;
    private final long sizeBytes;
    private final String eTag;
    private final String checksumAlgorithm;
    private final String checksumValue;
    private final Duration duration;
    private final String awsRequestId;
}
```

Why abstraction matters:

- central timeout policy;
- central retry policy;
- central metadata conventions;
- central encryption policy;
- central observability;
- central redaction;
- easier testing;
- easier migration SDK/client.

---

## 35. Case Study: Large Document Upload for Case Management

Scenario:

```text
Officer uploads 700 MB evidence package.
System stores it in S3.
Processor validates checksum and extracts metadata.
Audit trail must prove what was uploaded, when, by whom, and whether processing succeeded.
```

Naive design:

```text
Browser -> backend multipart/form-data -> backend reads all bytes -> S3 putObject -> DB update
```

Problems:

- backend heap risk;
- request timeout;
- retry from browser repeats whole payload;
- no quarantine;
- overwrite risk;
- weak audit;
- no post-upload validation.

Better design:

```text
1. Backend creates upload session
2. Backend returns presigned URL or multipart upload orchestration token
3. Client uploads to S3 landing prefix
4. Backend/S3 event validates HEAD/checksum/size
5. Object moves or is copied/tagged to accepted/quarantine
6. DB stores immutable object reference
7. Processor consumes SQS event
8. Audit trail records every state transition
```

Object key:

```text
landing/cases/{caseId}/documents/{documentId}/uploads/{uploadRequestId}/original.bin
```

State:

```text
PENDING_UPLOAD
  -> UPLOADED
  -> VALIDATING
  -> ACCEPTED
  -> PROCESSING
  -> PROCESSED

Failure:
  -> EXPIRED
  -> REJECTED_SIZE
  -> REJECTED_CHECKSUM
  -> QUARANTINED
  -> PROCESSING_FAILED
```

Invariants:

- no object accepted without size validation;
- no object accepted without checksum/integrity validation if required;
- no overwrite of accepted object;
- every processing attempt has correlation ID;
- every failure has retry/reject/quarantine decision;
- orphan upload cleaned by lifecycle/reconciler.

---

## 36. Case Study: High-Throughput Export to S3

Scenario:

```text
Java service exports 100 million records to S3 as compressed NDJSON files.
```

Bad design:

```text
List<Record> all = queryEverything();
String json = serializeAll(all);
byte[] gzip = compress(json);
s3.putObject(... fromBytes(gzip));
```

Better design:

```text
DB cursor/page
  -> streaming serializer
  -> compression stream
  -> multipart uploader / temp file
  -> S3 object
  -> manifest file
```

Output layout:

```text
exports/export-20260619-abc/
  manifest.json
  parts/part-00000.ndjson.gz
  parts/part-00001.ndjson.gz
  parts/part-00002.ndjson.gz
```

Manifest:

```json
{
  "exportId": "export-20260619-abc",
  "createdAt": "2026-06-19T10:00:00Z",
  "recordCount": 100000000,
  "objects": [
    {
      "key": "exports/export-20260619-abc/parts/part-00000.ndjson.gz",
      "sizeBytes": 536870912,
      "checksumAlgorithm": "SHA256",
      "checksum": "..."
    }
  ]
}
```

Why manifest matters:

- consumer knows export completeness;
- partial export is distinguishable;
- retry can skip completed parts;
- audit can prove data set boundary;
- downstream can parallelize processing.

---

## 37. Benchmarking S3 Transfer Properly

Benchmark wrong:

```text
Upload one file once from laptop Wi-Fi and conclude S3 is slow.
```

Benchmark better:

Measure:

- object size distribution;
- part size;
- concurrency;
- client type;
- runtime Java version;
- instance/container type;
- network path;
- region;
- encryption mode;
- checksum mode;
- retry count;
- p50/p95/p99 latency;
- throughput MB/s;
- CPU;
- heap/direct memory;
- GC;
- connection pool metrics;
- S3 503 SlowDown/throttle indicators;
- cost per GB transferred/processed.

Benchmark matrix example:

| Object Size | Part Size | Concurrency | Client | Java | Result |
|---:|---:|---:|---|---|---|
| 100 MiB | 8 MiB | 4 | Java async | 17 | ... |
| 1 GiB | 64 MiB | 4 | CRT | 21 | ... |
| 10 GiB | 128 MiB | 8 | CRT | 21 | ... |

Do not benchmark only average. Use distribution.

```text
p50 tells normal behavior.
p95 tells user pain.
p99 tells incident boundary.
max tells timeout/capacity risk.
```

---

## 38. Security and Compliance Checklist for Large Transfers

Checklist:

- Is bucket public access blocked?
- Is object key free from unnecessary PII?
- Is SSE-S3/SSE-KMS policy defined?
- Is KMS key policy least privilege?
- Are presigned URLs short-lived?
- Are object metadata/tags non-sensitive?
- Is checksum required for critical objects?
- Is object versioning required?
- Is Object Lock/retention required?
- Is lifecycle cleanup configured?
- Is incomplete multipart cleanup configured?
- Are CloudTrail data events required for bucket?
- Are transfer logs correlated to user/action/case?
- Are failures auditable?
- Are quarantine paths isolated?
- Are malware/content scanners integrated if accepting untrusted file?

---

## 39. Production Readiness Checklist

Before using S3 transfer in production:

### API and Client

- S3 client/transfer manager singleton.
- Region explicit or controlled by environment policy.
- Credentials provider uses role, not static key.
- HTTP client configured with sane timeout.
- Retry policy understood.
- User-agent/app identifier configured if needed.

### Memory

- No full object load for large files.
- Part size × concurrency calculated.
- Container/Lambda memory budget validated.
- Direct memory considered if using async/CRT/Netty.

### Multipart

- Part size valid for expected max object size.
- Abort on failure.
- Lifecycle rule aborts incomplete multipart uploads.
- Unknown complete state reconciled by `HeadObject`.

### Integrity

- Checksum policy defined.
- ETag not treated as universal MD5.
- Size validation performed.
- Version ID stored if bucket versioning enabled.

### Observability

- Duration, bytes, throughput logged.
- AWS request ID captured where available.
- Retry/throttle metrics visible.
- Failure taxonomy emitted.
- Dashboard and alert exist.

### Domain

- Object key immutable for important records.
- Upload session state machine exists.
- Orphan cleanup exists.
- Quarantine strategy exists.
- Replay/retry process documented.

---

## 40. Common Anti-Patterns

### Anti-pattern 1: `readAllBytes()` Everywhere

Works in dev. Fails with real files.

### Anti-pattern 2: Create S3 Client per Request

Wastes connection pool, TLS setup, CPU, and latency.

### Anti-pattern 3: Multipart Upload Without Abort

Leaks incomplete uploads and cost.

### Anti-pattern 4: Treat ETag as MD5

Invalid for multipart and some encryption/checksum cases.

### Anti-pattern 5: Infinite Parallelism

Creates memory pressure, throttling, timeout, and noisy neighbor behavior.

### Anti-pattern 6: Presigned URL Without Domain State

Produces orphan objects and unclear ownership.

### Anti-pattern 7: Direct Upload to Final Trusted Prefix

Untrusted object should land in quarantine/landing zone first.

### Anti-pattern 8: No Version/Immutable Key

Overwrite risk destroys auditability.

### Anti-pattern 9: No Prefix Throughput Awareness

Hot prefix can become bottleneck under extreme request rate.

### Anti-pattern 10: No Transfer Metrics

When production slows down, nobody knows whether bottleneck is S3, network, disk, JVM, or KMS.

---

## 41. A Practical Decision Framework

When designing S3 transfer, answer these in order:

### 1. Object Shape

```text
How large?
Known size or unknown stream?
Binary or text?
Compressed or raw?
Single object or directory/batch?
```

### 2. Source and Sink

```text
Disk?
HTTP request?
Database export?
Generated stream?
Lambda /tmp?
Another S3 bucket?
```

### 3. Transfer Mechanism

```text
Simple put/get?
Transfer Manager?
Manual multipart?
Presigned URL?
Range GET?
```

### 4. Resource Budget

```text
Memory?
CPU?
Disk?
Network?
Timeout?
Concurrency?
```

### 5. Correctness

```text
Checksum?
Idempotency?
Versioning?
Overwrite prevention?
Partial failure recovery?
```

### 6. Operations

```text
Metrics?
Logs?
Retry visibility?
Cleanup?
DLQ/reconciliation?
Runbook?
```

### 7. Governance

```text
Encryption?
Retention?
Audit?
Access policy?
Data classification?
```

If one of these is unanswered, transfer design is not production-ready.

---

## 42. Minimal Production Blueprint

```text
S3TransferService
  ├── S3TransferManager singleton
  ├── S3Client for HEAD/tag/delete/admin operations
  ├── TransferPolicy
  │     ├── maxObjectSize
  │     ├── partSize
  │     ├── concurrency
  │     ├── timeout
  │     ├── checksumAlgorithm
  │     └── encryptionPolicy
  ├── ObjectKeyStrategy
  ├── MetadataStrategy
  ├── UploadSessionRepository
  ├── AuditPublisher
  ├── MetricsRecorder
  └── Reconciler/CleanupJob
```

Core invariant:

```text
S3 object state and domain state must be reconciled.
```

Never let S3 become an untracked dumping ground.

---

## 43. Summary

Part 9 membahas S3 transfer dari perspektif production engineering.

Hal paling penting:

1. S3 transfer adalah distributed data movement, bukan local file copy.
2. Untuk object besar, hindari full buffering di heap.
3. Multipart upload adalah foundation untuk large object resilience dan throughput.
4. Part size dan concurrency harus dihitung dari object size, memory, network, dan retry cost.
5. `S3TransferManager` adalah default yang baik untuk file/directory transfer high-level.
6. Manual multipart tetap penting untuk stream unknown length, custom checkpoint, atau workflow domain khusus.
7. ETag bukan universal checksum.
8. Cleanup incomplete multipart upload wajib.
9. Presigned URL perlu domain state machine dan post-upload validation.
10. Observability transfer harus mencakup bytes, duration, throughput, retry, failure category, checksum, dan request ID.
11. High-throughput S3 membutuhkan prefix/access pattern awareness.
12. Production-ready S3 transfer selalu menggabungkan correctness, security, cost, observability, dan recovery.

---

## 44. Referensi Resmi

- AWS SDK for Java 2.x — S3 Transfer Manager: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/transfer-manager.html
- AWS SDK for Java 2.x API — `S3TransferManager`: https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/transfer/s3/S3TransferManager.html
- AWS SDK for Java 2.x — S3 checksum support: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/s3-checksums.html
- Amazon S3 — Multipart upload limits: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
- Amazon S3 — Multipart upload overview: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
- Amazon S3 — Uploading object using multipart upload: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-upload-object.html
- Amazon S3 — Performance design patterns: https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html
- Amazon S3 — Performance guidelines: https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance-guidelines.html
- AWS SDK for Java 2.x — CRT-based S3 client: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/crt-based-s3-client.html
- AWS SDK for Java 2.x — S3 code examples: https://docs.aws.amazon.com/code-library/latest/ug/java_2_s3_code_examples.html

---

## 45. Koneksi ke Part Berikutnya

Part 10 akan membahas:

# S3 as Integration Boundary, Archive, and Event Source

Kita akan naik dari “bagaimana transfer object besar dengan benar” ke “bagaimana menjadikan S3 sebagai bagian dari workflow enterprise”: landing/staging/processed/quarantine zone, S3 event notification, duplicate/out-of-order event, lifecycle, retention, legal hold, malware scanning, data lake ingestion, cross-account sharing, dan auditability.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-08-s3-fundamentals-for-java-engineers.md">⬅️ Part 8 — S3 Fundamentals for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-10-s3-as-integration-boundary-archive-and-event-source.md">Part 10 — S3 as Integration Boundary, Archive, and Event Source ➡️</a>
</div>
