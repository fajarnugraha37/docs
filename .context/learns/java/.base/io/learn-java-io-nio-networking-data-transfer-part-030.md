# Part 030 — Production Design Patterns: File Ingestion, Export Job, Secure Transfer, Audit, Observability, dan Operational Runbook

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-030.md`  
> Status: **Part terakhir**  
> Fokus: menggabungkan seluruh konsep Java I/O, NIO, NIO.2, networking, compression, serialization, security, reliability, dan performance menjadi pola desain production-grade.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Mendesain pipeline **file ingestion** yang aman, restartable, observable, dan tahan partial failure.
2. Mendesain pipeline **export job** yang tidak menghasilkan file setengah jadi, tidak membebani memory, dan aman dikonsumsi downstream.
3. Mendesain **secure data transfer** dengan checksum, atomic publish, idempotency, retry, dan audit trail.
4. Memodelkan transfer data sebagai **state machine**, bukan sebagai rangkaian method call sederhana.
5. Menentukan boundary tanggung jawab antara filesystem, application process, database, queue, object storage, remote endpoint, dan operator.
6. Membuat **operational runbook** untuk failure scenario: disk full, permission denied, partial write, duplicate delivery, corrupt file, timeout, downstream unavailable, dan restart process.
7. Menyusun checklist production readiness untuk solusi berbasis Java I/O.

Part ini bukan memperkenalkan API baru secara banyak. Ini adalah bagian sintesis: bagaimana semua API dan mental model dari part 000–029 dipakai untuk membangun sistem nyata.

---

## 2. Mental Model Besar: Production I/O Adalah Sistem, Bukan Utility Function

Di level junior, I/O sering dilihat sebagai:

```java
Files.readString(path);
Files.writeString(path, content);
```

Di production, I/O adalah rangkaian keputusan:

```text
source
  -> discovery
  -> validation
  -> staging
  -> parsing/transform
  -> durability boundary
  -> publish/commit
  -> audit
  -> reconciliation
  -> retention/cleanup
```

Atau untuk network transfer:

```text
source file/object
  -> chunking
  -> checksum
  -> upload/download
  -> retry/resume
  -> verify
  -> atomic finalize
  -> record transfer state
  -> notify/emit event
```

Masalah utamanya bukan hanya “bisa baca file”. Masalah sebenarnya:

- Apakah file masih sedang ditulis oleh producer?
- Apakah nama file dapat dipercaya?
- Apakah path aman dari traversal/symlink attack?
- Apakah ukuran file sesuai limit?
- Apakah encoding benar?
- Apakah isi file korup?
- Apakah sudah pernah diproses sebelumnya?
- Jika process mati di tengah, dari mana melanjutkan?
- Jika downstream timeout setelah menerima data, apakah retry aman?
- Jika file berhasil ditulis tapi metadata/audit gagal, state dianggap apa?
- Jika file sudah dipublish tapi process crash sebelum update database, siapa yang merekonsiliasi?
- Jika ada duplikat, apakah consumer idempotent?

Mental model penting:

> **I/O production-grade selalu membutuhkan state, boundary, dan verifikasi.**

Tanpa state, kamu tidak tahu sudah sampai mana.  
Tanpa boundary, kamu tidak tahu kapan data dianggap committed.  
Tanpa verifikasi, kamu tidak tahu apakah data benar-benar sama dengan yang dimaksud.

---

## 3. Invariant Utama dalam Production I/O

Invariant adalah aturan yang harus tetap benar walaupun terjadi error, retry, restart, atau concurrency.

### 3.1 Invariant Data Integrity

Data yang diproses harus sama dengan data yang dimaksud.

Contoh invariant:

```text
A file may only be marked PROCESSED after:
1. full content is read,
2. checksum matches expected checksum if provided,
3. all records are validated or rejected according to policy,
4. downstream commit has succeeded,
5. audit record is written.
```

Jika checksum tersedia, checksum harus diverifikasi sebelum publish/commit. Jika checksum tidak tersedia, sistem perlu minimal melakukan size check, format validation, dan record count reconciliation.

### 3.2 Invariant Atomic Visibility

Consumer tidak boleh melihat output yang belum selesai.

Pattern:

```text
write to temporary/staging file
fsync/force if durability needed
validate size/checksum
atomic move to final path
publish metadata/event only after final path exists
```

Final location harus hanya berisi data yang lengkap dan valid.

### 3.3 Invariant Idempotency

Retry tidak boleh membuat efek bisnis ganda.

Contoh buruk:

```text
retry upload -> downstream membuat dua invoice
retry import -> record bisnis terduplikasi
retry notification -> consumer memproses dua kali
```

Contoh invariant:

```text
For the same transferId and chunkIndex, applying the chunk multiple times must result in one logical chunk.
```

Atau:

```text
For the same fileDigest, the ingestion result must be deduplicated unless business explicitly allows reprocessing.
```

### 3.4 Invariant Bounded Resource

Sistem tidak boleh mengonsumsi resource tanpa batas.

Harus ada limit untuk:

- ukuran file
- ukuran record
- jumlah file per batch
- jumlah concurrent transfer
- jumlah retry
- durasi processing
- jumlah temporary file
- total staging disk usage
- frame size untuk protocol
- decompressed size untuk ZIP/GZIP
- object graph saat deserialization

### 3.5 Invariant Observability

Setiap transfer penting harus bisa dijawab:

```text
Apa yang terjadi?
Kapan mulai?
Kapan selesai?
Berapa byte?
Berapa record?
Dari mana?
Ke mana?
Checksum apa?
Siapa/apa trigger-nya?
Gagal di step mana?
Retry ke berapa?
Operator harus melakukan apa?
```

Tanpa observability, operational support berubah menjadi forensic manual.

---

## 4. Production Pattern 1: File Ingestion Pipeline

File ingestion adalah proses menerima file dari folder, object storage, SFTP, HTTP upload, message queue, atau integration gateway, lalu memvalidasi dan memasukkannya ke sistem.

### 4.1 Bentuk Naif

```java
Path input = Path.of("/data/incoming/customers.csv");
try (Stream<String> lines = Files.lines(input)) {
    lines.forEach(line -> importCustomer(line));
}
Files.delete(input);
```

Masalah:

- file mungkin masih ditulis producer
- file mungkin corrupt
- encoding mungkin salah
- file besar bisa gagal di tengah
- tidak ada checkpoint
- tidak ada duplicate detection
- tidak ada quarantine
- delete setelah gagal bisa menghilangkan evidence
- tidak ada audit
- retry bisa membuat duplicate record

### 4.2 Bentuk Production-Grade

Gunakan folder/lifecycle yang eksplisit:

```text
/incoming     -> producer drop file di sini
/staging      -> aplikasi klaim file dan memproses
/processing   -> optional working area
/success      -> arsip file sukses
/rejected     -> file valid secara teknis tapi gagal aturan bisnis
/quarantine   -> file berbahaya/korup/tidak bisa dipercaya
/error        -> file gagal karena error sistem dan bisa dicoba ulang
/tmp          -> temporary output internal
```

Flow:

```text
DISCOVER
  -> CLAIM
  -> STABILITY_CHECK
  -> METADATA_READ
  -> SECURITY_VALIDATE
  -> FORMAT_VALIDATE
  -> CHECKSUM_VERIFY
  -> PROCESS_RECORDS
  -> COMMIT
  -> ARCHIVE
  -> AUDIT
```

### 4.3 State Machine Ingestion

```text
NEW
  -> DISCOVERED
  -> CLAIMED
  -> STABLE_CONFIRMED
  -> VALIDATING
  -> VALIDATED
  -> PROCESSING
  -> PARTIALLY_PROCESSED
  -> COMMITTING
  -> PROCESSED
  -> ARCHIVED

Failure states:
  -> REJECTED
  -> QUARANTINED
  -> RETRYABLE_FAILED
  -> PERMANENT_FAILED
  -> MANUAL_REVIEW_REQUIRED
```

State machine ini penting karena ingestion tidak selalu linear. Process bisa mati di tengah. Operator bisa retry. File bisa duplicate. Downstream bisa unavailable.

### 4.4 Claiming File

Jangan langsung memproses file dari `incoming`. Klaim file dulu.

Pattern:

```java
Path incoming = Path.of("/data/incoming/customers-2026-06-16.csv");
Path staging = Path.of("/data/staging/customers-2026-06-16.csv");

Files.move(incoming, staging, StandardCopyOption.ATOMIC_MOVE);
```

Jika `ATOMIC_MOVE` berhasil, process ini memiliki file tersebut. Jika gagal karena file sudah tidak ada, mungkin process lain sudah mengambilnya.

Namun ingat:

- atomic move biasanya hanya aman dalam filesystem yang sama
- di network filesystem, semantics bisa berbeda
- kalau producer masih menulis dan kamu rename file, behavior tergantung OS/protocol
- producer idealnya memakai pola `.tmp` lalu atomic rename ke final name

Producer contract yang lebih baik:

```text
Producer writes: file.csv.part
Producer fsyncs/closes
Producer writes checksum: file.csv.sha256
Producer renames file.csv.part -> file.csv
Producer optionally writes marker: file.csv.done
Consumer only processes file.csv when file.csv.done exists
```

### 4.5 Stability Check

Jika producer tidak bisa memberi marker `.done`, consumer perlu stability check.

Contoh:

```text
observe size + modifiedTime
wait N seconds
observe again
if unchanged -> assume stable
else -> delay
```

Tetapi ini heuristic, bukan guarantee. Contract marker jauh lebih kuat.

### 4.6 Metadata Table

Untuk ingestion serius, simpan metadata di database.

Contoh table:

```sql
CREATE TABLE file_ingestion_job (
    id                  VARCHAR(64) PRIMARY KEY,
    source_system       VARCHAR(128) NOT NULL,
    original_file_name  VARCHAR(512) NOT NULL,
    staging_path        VARCHAR(1024) NOT NULL,
    file_size_bytes     BIGINT NOT NULL,
    sha256_hex          VARCHAR(64),
    status              VARCHAR(64) NOT NULL,
    discovered_at       TIMESTAMP NOT NULL,
    claimed_at          TIMESTAMP,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    failed_at           TIMESTAMP,
    retry_count         INT NOT NULL DEFAULT 0,
    record_count        BIGINT,
    success_count       BIGINT,
    rejected_count      BIGINT,
    error_code          VARCHAR(128),
    error_message       VARCHAR(2000),
    created_by_node     VARCHAR(128),
    updated_at          TIMESTAMP NOT NULL
);
```

State di DB memungkinkan:

- restart recovery
- operator dashboard
- retry manual
- deduplication
- audit
- SLA tracking
- reconciliation

### 4.7 Idempotency Key untuk File

Kandidat idempotency key:

```text
sourceSystem + businessDate + fileType + sequenceNumber
```

Atau:

```text
sha256(file content)
```

Atau kombinasi:

```text
sourceSystem + originalFileName + fileSize + sha256
```

Pilihan tergantung domain.

Content hash bagus untuk dedup teknis, tetapi tidak selalu cukup untuk business semantics. Dua file berbeda nama bisa punya konten sama. Kadang reprocessing konten yang sama memang diizinkan jika batch berbeda.

### 4.8 Record-Level Processing

Untuk file besar, jangan transaksi semua record sekaligus.

Pattern:

```text
read batch of N records
validate batch
write to staging/import table
commit batch
update checkpoint
continue
```

Checkpoint table:

```sql
CREATE TABLE file_ingestion_checkpoint (
    job_id              VARCHAR(64) NOT NULL,
    checkpoint_type     VARCHAR(64) NOT NULL,
    line_number         BIGINT,
    byte_offset         BIGINT,
    record_sequence     BIGINT,
    updated_at          TIMESTAMP NOT NULL,
    PRIMARY KEY (job_id, checkpoint_type)
);
```

Untuk CSV text, line number lebih mudah tetapi tidak selalu cukup jika multiline record. Untuk binary/framed format, byte offset lebih kuat.

### 4.9 Poison Record

Jika satu record rusak, apakah seluruh file gagal?

Kebijakan harus eksplisit:

```text
STRICT_ALL_OR_NOTHING:
  satu record invalid -> seluruh file rejected

BEST_EFFORT_WITH_REJECTION:
  record valid diproses, invalid ditulis ke reject report

THRESHOLD_BASED:
  boleh reject maksimal X record atau Y persen
```

Jangan menyembunyikan record gagal. Buat reject report:

```text
jobId,lineNumber,field,errorCode,errorMessage,rawValue
```

### 4.10 Safe Ingestion Skeleton

```java
public final class FileIngestionService {
    private final Path incomingDir;
    private final Path stagingDir;
    private final Path successDir;
    private final Path rejectedDir;
    private final Path quarantineDir;
    private final IngestionRepository repository;

    public void scanOnce() throws IOException {
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(incomingDir, "*.csv")) {
            for (Path candidate : stream) {
                tryClaimAndProcess(candidate);
            }
        }
    }

    private void tryClaimAndProcess(Path candidate) {
        String fileName = candidate.getFileName().toString();
        Path claimed = stagingDir.resolve(fileName);

        try {
            Files.move(candidate, claimed, StandardCopyOption.ATOMIC_MOVE);
        } catch (NoSuchFileException alreadyClaimed) {
            return;
        } catch (AtomicMoveNotSupportedException unsupported) {
            // Production decision: either fail fast or use another claim mechanism.
            throw new IllegalStateException("Atomic move is required for safe claiming", unsupported);
        } catch (IOException e) {
            repository.recordClaimFailure(fileName, e);
            return;
        }

        processClaimedFile(claimed);
    }

    private void processClaimedFile(Path file) {
        String jobId = repository.createJob(file);

        try {
            validatePathInside(stagingDir, file);
            validateRegularReadableFile(file);
            validateSizeLimit(file, 500L * 1024L * 1024L);

            repository.markValidating(jobId);
            FileDigest digest = computeSha256AndSize(file);
            repository.saveDigest(jobId, digest);

            repository.markProcessing(jobId);
            ProcessResult result = processCsvStreaming(jobId, file);

            repository.markCommitting(jobId, result);
            commitImportedData(jobId);

            Path archive = successDir.resolve(file.getFileName());
            Files.move(file, archive, StandardCopyOption.ATOMIC_MOVE);
            repository.markArchived(jobId, archive);
        } catch (BusinessValidationException e) {
            moveBestEffort(file, rejectedDir.resolve(file.getFileName()));
            repository.markRejected(jobId, e);
        } catch (SecurityException | IOException e) {
            moveBestEffort(file, quarantineDir.resolve(file.getFileName()));
            repository.markQuarantined(jobId, e);
        } catch (RuntimeException e) {
            repository.markRetryableFailed(jobId, e);
            throw e;
        }
    }

    private static void validatePathInside(Path root, Path path) throws IOException {
        Path realRoot = root.toRealPath();
        Path realPath = path.toRealPath();
        if (!realPath.startsWith(realRoot)) {
            throw new SecurityException("Path escapes root: " + path);
        }
    }

    private static void validateRegularReadableFile(Path file) throws IOException {
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new SecurityException("Not a regular file: " + file);
        }
        if (!Files.isReadable(file)) {
            throw new IOException("File is not readable: " + file);
        }
    }

    private static void validateSizeLimit(Path file, long maxBytes) throws IOException {
        long size = Files.size(file);
        if (size > maxBytes) {
            throw new SecurityException("File too large: " + size);
        }
    }
}
```

Skeleton ini belum lengkap, tetapi menampilkan prinsip utama:

- claim dulu
- validasi path
- validasi file type/size
- streaming process
- state update
- archive/reject/quarantine
- jangan delete evidence sembarangan

---

## 5. Production Pattern 2: Export Job Pipeline

Export job adalah proses menghasilkan file dari database atau sistem internal untuk dikirim ke pihak lain.

Contoh:

- daily report CSV
- document bundle ZIP
- regulatory submission file
- audit export
- downstream integration file
- reconciliation extract

### 5.1 Bentuk Naif

```java
List<Row> rows = repository.findAll();
String csv = toCsv(rows);
Files.writeString(Path.of("report.csv"), csv);
```

Masalah:

- OOM jika data besar
- output bisa setengah jadi
- consumer bisa membaca file sebelum selesai
- tidak ada checksum
- tidak ada manifest
- tidak ada retry-safe publish
- tidak ada pagination stable

### 5.2 Export State Machine

```text
REQUESTED
  -> RESERVED
  -> QUERYING
  -> WRITING_TEMP
  -> VERIFYING
  -> PUBLISHING
  -> PUBLISHED
  -> DELIVERING
  -> DELIVERED

Failure:
  -> RETRYABLE_FAILED
  -> PERMANENT_FAILED
  -> CANCELLED
```

### 5.3 Stable Pagination

Jangan export data besar dengan offset pagination yang berubah saat data berubah.

Kurang aman:

```sql
SELECT * FROM application ORDER BY created_at OFFSET 100000 LIMIT 1000;
```

Lebih baik:

```sql
SELECT *
FROM application
WHERE id > :lastSeenId
ORDER BY id
FETCH FIRST :batchSize ROWS ONLY;
```

Atau gunakan snapshot boundary:

```text
export all records where updated_at <= exportCutoffTime
```

Invariant:

```text
Export must use a stable selection boundary.
```

Tanpa itu, export bisa duplicate/missing record saat data berubah di tengah proses.

### 5.4 Atomic Export Pattern

```text
1. create export job row
2. create temp file under same filesystem
3. stream rows from DB to temp file
4. flush writer
5. force file content if durability needed
6. compute checksum
7. write manifest
8. atomic move temp file to final name
9. mark job PUBLISHED
10. notify downstream
```

### 5.5 Streaming CSV Export Skeleton

```java
public final class CsvExportService {
    private final Path tempDir;
    private final Path publishDir;
    private final ExportRepository repository;
    private final ApplicationRepository applicationRepository;

    public ExportResult exportApplications(LocalDate businessDate) throws IOException {
        String jobId = repository.createExportJob("APPLICATIONS", businessDate);

        Path tempFile = Files.createTempFile(tempDir, "applications-" + businessDate + "-", ".csv.tmp");
        Path finalFile = publishDir.resolve("applications-" + businessDate + ".csv");

        long rows = 0;
        try (BufferedWriter writer = Files.newBufferedWriter(
                tempFile,
                StandardCharsets.UTF_8,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING)) {

            writer.write("id,status,createdAt,updatedAt");
            writer.newLine();

            long lastSeenId = 0L;
            while (true) {
                List<ApplicationRow> batch = applicationRepository.findNextBatch(businessDate, lastSeenId, 1_000);
                if (batch.isEmpty()) {
                    break;
                }

                for (ApplicationRow row : batch) {
                    writeCsvRow(writer, row);
                    rows++;
                    lastSeenId = row.id();
                }
            }
        }

        String sha256 = sha256Hex(tempFile);
        long size = Files.size(tempFile);

        // Optional stronger durability boundary.
        try (FileChannel channel = FileChannel.open(tempFile, StandardOpenOption.READ)) {
            channel.force(true);
        }

        Files.move(tempFile, finalFile, StandardCopyOption.ATOMIC_MOVE);
        repository.markPublished(jobId, finalFile, rows, size, sha256);

        return new ExportResult(jobId, finalFile, rows, size, sha256);
    }

    private static void writeCsvRow(BufferedWriter writer, ApplicationRow row) throws IOException {
        writer.write(csv(row.id()));
        writer.write(',');
        writer.write(csv(row.status()));
        writer.write(',');
        writer.write(csv(row.createdAt().toString()));
        writer.write(',');
        writer.write(csv(row.updatedAt().toString()));
        writer.newLine();
    }

    private static String csv(Object value) {
        if (value == null) return "";
        String s = value.toString();
        boolean quote = s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0;
        String escaped = s.replace("\"", "\"\"");
        return quote ? "\"" + escaped + "\"" : escaped;
    }
}
```

Catatan:

- Untuk file besar, gunakan streaming writer.
- Jangan materialize seluruh CSV sebagai `String`.
- Publish dengan atomic move.
- Simpan checksum dan row count.
- Gunakan stable query boundary.

### 5.6 Manifest File

Untuk export serius, jangan hanya kirim data file. Kirim manifest.

Contoh `applications-2026-06-16.manifest.json`:

```json
{
  "fileName": "applications-2026-06-16.csv",
  "fileSizeBytes": 128934234,
  "sha256": "...",
  "recordCount": 452391,
  "businessDate": "2026-06-16",
  "schemaVersion": 3,
  "generatedAt": "2026-06-16T01:30:00Z",
  "producer": "case-management-service",
  "exportJobId": "exp_20260616_000001"
}
```

Manifest membantu downstream melakukan:

- completeness check
- integrity check
- schema compatibility check
- deduplication
- reconciliation

---

## 6. Production Pattern 3: Secure Transfer Service

Secure transfer dapat berupa upload/download via HTTP, SFTP-like gateway, internal API, object storage signed URL, atau direct socket protocol.

### 6.1 Core Requirement

Transfer yang aman harus menjawab:

```text
Who sent it?
Who received it?
What exactly was sent?
Was it complete?
Was it modified?
Was it processed once or more than once?
Can it be retried safely?
Can it be resumed?
Can it be audited?
```

### 6.2 Recommended Transfer Contract

Gunakan transfer metadata:

```json
{
  "transferId": "trf_20260616_abc123",
  "sourceSystem": "agency-a",
  "targetSystem": "case-platform",
  "fileName": "submission-20260616.zip",
  "contentType": "application/zip",
  "fileSizeBytes": 99182711,
  "sha256": "...",
  "chunkSizeBytes": 8388608,
  "chunkCount": 12,
  "schemaVersion": 2,
  "createdAt": "2026-06-16T01:20:00Z"
}
```

### 6.3 Chunked Upload State Machine

```text
INITIATED
  -> RECEIVING_CHUNKS
  -> ALL_CHUNKS_RECEIVED
  -> ASSEMBLING
  -> VERIFYING
  -> FINALIZING
  -> COMPLETED

Failure:
  -> EXPIRED
  -> RETRYABLE_FAILED
  -> CORRUPT
  -> REJECTED
```

Chunk state:

```text
EXPECTED
  -> RECEIVED
  -> VERIFIED
```

Invariant:

```text
Same transferId + chunkIndex must be idempotent.
If identical checksum: accept as duplicate success.
If different checksum: reject as conflict/corruption.
```

### 6.4 Chunk Storage Layout

```text
/transfers/staging/{transferId}/
  metadata.json
  chunks/
    000000.part
    000001.part
    000002.part
  chunks.sha256
  assembled.tmp

/transfers/completed/{transferId}/
  payload.zip
  manifest.json
```

### 6.5 HTTP Upload with Java HttpClient — Client Side

```java
public final class TransferClient {
    private final HttpClient client;
    private final URI baseUri;

    public TransferClient(URI baseUri) {
        this.client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_2)
                .build();
        this.baseUri = baseUri;
    }

    public void uploadFile(Path file, String transferId) throws IOException, InterruptedException {
        long size = Files.size(file);
        String sha256 = sha256Hex(file);

        initiateTransfer(transferId, file.getFileName().toString(), size, sha256);

        int chunkSize = 8 * 1024 * 1024;
        int index = 0;
        long offset = 0;

        try (SeekableByteChannel channel = Files.newByteChannel(file, StandardOpenOption.READ)) {
            while (offset < size) {
                long length = Math.min(chunkSize, size - offset);
                Path chunk = createChunkTempFile(channel, offset, length);
                String chunkHash = sha256Hex(chunk);

                uploadChunkWithRetry(transferId, index, offset, length, chunkHash, chunk);

                Files.deleteIfExists(chunk);
                offset += length;
                index++;
            }
        }

        completeTransfer(transferId);
    }

    private void uploadChunkWithRetry(
            String transferId,
            int index,
            long offset,
            long length,
            String chunkHash,
            Path chunkFile) throws IOException, InterruptedException {

        int maxAttempts = 5;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            HttpRequest request = HttpRequest.newBuilder(baseUri.resolve("/transfers/" + transferId + "/chunks/" + index))
                    .timeout(Duration.ofMinutes(2))
                    .header("Content-Type", "application/octet-stream")
                    .header("Idempotency-Key", transferId + ":" + index)
                    .header("X-Chunk-Offset", Long.toString(offset))
                    .header("X-Chunk-Length", Long.toString(length))
                    .header("X-Chunk-SHA256", chunkHash)
                    .PUT(HttpRequest.BodyPublishers.ofFile(chunkFile))
                    .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));

            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                return;
            }

            if (!isRetryable(response.statusCode()) || attempt == maxAttempts) {
                throw new IOException("Chunk upload failed: status=" + response.statusCode() + ", body=" + response.body());
            }

            Thread.sleep(backoffMillis(attempt));
        }
    }

    private static boolean isRetryable(int status) {
        return status == 408 || status == 429 || status == 500 || status == 502 || status == 503 || status == 504;
    }

    private static long backoffMillis(int attempt) {
        long base = 250L * (1L << Math.min(attempt - 1, 5));
        long jitter = ThreadLocalRandom.current().nextLong(0, 150);
        return base + jitter;
    }
}
```

Hal penting:

- Ada timeout per request.
- Ada idempotency key.
- Retry hanya untuk status retryable.
- Chunk hash dikirim.
- Whole-file hash tetap diverifikasi saat complete.

### 6.6 Server Side Principle

Saat menerima chunk:

```text
1. validate transfer exists and not expired
2. validate chunk index, offset, length
3. enforce max chunk size
4. write body to temp chunk file
5. compute sha256 while streaming
6. compare with X-Chunk-SHA256
7. atomic move temp chunk to chunk path
8. mark chunk RECEIVED/VERIFIED
9. if duplicate same hash -> return success
10. if duplicate different hash -> conflict
```

Jangan menulis request body langsung ke final file tanpa validasi. Gunakan temporary chunk file.

---

## 7. Production Pattern 4: Document Bundle ZIP Export/Import

Banyak sistem enterprise/regulatory perlu membuat bundle:

```text
case-12345.zip
  manifest.json
  documents/
    doc-1.pdf
    doc-2.pdf
  metadata/
    parties.json
    timeline.json
```

### 7.1 Bundle Manifest

Manifest harus menjadi source of truth.

```json
{
  "bundleVersion": 1,
  "caseId": "CASE-12345",
  "generatedAt": "2026-06-16T01:00:00Z",
  "entries": [
    {
      "path": "documents/doc-1.pdf",
      "type": "application/pdf",
      "sizeBytes": 120391,
      "sha256": "..."
    },
    {
      "path": "metadata/timeline.json",
      "type": "application/json",
      "sizeBytes": 8123,
      "sha256": "..."
    }
  ]
}
```

### 7.2 Safe ZIP Creation

Saat membuat ZIP:

- jangan pakai absolute path sebagai entry name
- normalisasi separator ke `/`
- jangan memasukkan secret/temp file
- hitung checksum entry
- batasi compression level jika CPU concern
- tulis manifest terakhir atau pertama sesuai consumer contract

### 7.3 Safe ZIP Extraction

Invariant:

```text
No ZIP entry may escape extraction root.
No ZIP entry may exceed max size.
Total decompressed size must be bounded.
Entry count must be bounded.
```

Safe extraction skeleton:

```java
public final class SafeZipExtractor {
    private final long maxEntryBytes;
    private final long maxTotalBytes;
    private final int maxEntries;

    public SafeZipExtractor(long maxEntryBytes, long maxTotalBytes, int maxEntries) {
        this.maxEntryBytes = maxEntryBytes;
        this.maxTotalBytes = maxTotalBytes;
        this.maxEntries = maxEntries;
    }

    public void extract(Path zipFile, Path targetDir) throws IOException {
        Path normalizedTarget = targetDir.toRealPath();
        long totalBytes = 0;
        int entries = 0;

        try (InputStream in = Files.newInputStream(zipFile);
             ZipInputStream zip = new ZipInputStream(new BufferedInputStream(in))) {

            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries++;
                if (entries > maxEntries) {
                    throw new SecurityException("Too many ZIP entries");
                }

                if (entry.isDirectory()) {
                    continue;
                }

                Path output = normalizedTarget.resolve(entry.getName()).normalize();
                if (!output.startsWith(normalizedTarget)) {
                    throw new SecurityException("ZIP entry escapes target: " + entry.getName());
                }

                Files.createDirectories(output.getParent());

                Path temp = Files.createTempFile(output.getParent(), output.getFileName().toString(), ".tmp");
                long written = copyBounded(zip, temp, maxEntryBytes);
                totalBytes += written;

                if (totalBytes > maxTotalBytes) {
                    Files.deleteIfExists(temp);
                    throw new SecurityException("ZIP decompressed size exceeds limit");
                }

                Files.move(temp, output, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                zip.closeEntry();
            }
        }
    }

    private static long copyBounded(InputStream in, Path output, long maxBytes) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long total = 0;

        try (OutputStream out = Files.newOutputStream(output, StandardOpenOption.WRITE)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new SecurityException("ZIP entry too large");
                }
                out.write(buffer, 0, read);
            }
        }
        return total;
    }
}
```

---

## 8. Audit Trail Design untuk I/O dan Transfer

Audit bukan log biasa. Audit harus menjawab fakta bisnis/operasional yang penting dan relatif tahan manipulasi.

### 8.1 Event yang Perlu Diaudit

Untuk ingestion:

```text
FILE_DISCOVERED
FILE_CLAIMED
FILE_VALIDATED
FILE_REJECTED
FILE_QUARANTINED
FILE_PROCESSING_STARTED
FILE_PROCESSING_COMPLETED
FILE_ARCHIVED
FILE_RETRY_REQUESTED
FILE_MANUAL_OVERRIDE
```

Untuk transfer:

```text
TRANSFER_INITIATED
CHUNK_RECEIVED
CHUNK_VERIFIED
TRANSFER_ASSEMBLED
TRANSFER_VERIFIED
TRANSFER_COMPLETED
TRANSFER_FAILED
TRANSFER_EXPIRED
TRANSFER_CANCELLED
```

Untuk export:

```text
EXPORT_REQUESTED
EXPORT_STARTED
EXPORT_FILE_WRITTEN
EXPORT_VERIFIED
EXPORT_PUBLISHED
EXPORT_DELIVERED
EXPORT_FAILED
```

### 8.2 Audit Fields

Minimal:

```text
eventId
correlationId
transferId/jobId
sourceSystem
targetSystem
actor/serviceAccount
operation
statusBefore
statusAfter
fileName
fileSizeBytes
sha256
recordCount
remoteAddress if applicable
userAgent/clientId if applicable
timestamp
nodeId/podName
errorCode
errorMessage sanitized
```

Jangan audit raw payload besar. Jangan simpan secret/token/password. Jangan log PII tanpa kebijakan retention dan masking.

### 8.3 Log vs Audit vs Metrics vs Trace

```text
Log:
  narasi teknis untuk debugging

Audit:
  catatan kejadian penting yang perlu dipertanggungjawabkan

Metrics:
  angka agregat/time-series untuk monitoring dan alert

Trace:
  hubungan antar operasi lintas service
```

Kesalahan umum: mengira log sudah cukup sebagai audit. Log biasanya terlalu noisy, retention berbeda, dan tidak selalu punya struktur/integrity yang cukup.

---

## 9. Observability untuk I/O Production

### 9.1 Metrics Wajib

Untuk ingestion:

```text
ingestion.files.discovered.count
ingestion.files.processed.count
ingestion.files.failed.count
ingestion.files.rejected.count
ingestion.bytes.processed
ingestion.records.processed
ingestion.records.rejected
ingestion.processing.duration
ingestion.queue.age
ingestion.retry.count
```

Untuk export:

```text
export.jobs.started.count
export.jobs.completed.count
export.jobs.failed.count
export.bytes.written
export.records.written
export.duration
export.publish.duration
```

Untuk transfer:

```text
transfer.started.count
transfer.completed.count
transfer.failed.count
transfer.bytes.sent
transfer.bytes.received
transfer.chunk.retry.count
transfer.checksum.failure.count
transfer.duration
transfer.active.count
```

Untuk resource:

```text
io.open.file.descriptors
io.staging.disk.used.bytes
io.staging.disk.free.bytes
io.threadpool.queue.size
io.buffer.pool.used.bytes
io.http.connection.active
io.timeout.count
```

### 9.2 Log Field Standard

Gunakan structured logging:

```json
{
  "timestamp": "2026-06-16T01:20:30.123Z",
  "level": "INFO",
  "message": "Transfer chunk verified",
  "correlationId": "corr-abc",
  "transferId": "trf-123",
  "chunkIndex": 7,
  "chunkSizeBytes": 8388608,
  "sha256": "...",
  "durationMs": 342,
  "service": "transfer-service",
  "node": "pod-xyz"
}
```

### 9.3 Trace Spans

Untuk transfer pipeline:

```text
transfer.upload
  -> transfer.initiate
  -> transfer.chunk.receive
  -> transfer.chunk.verify
  -> transfer.assemble
  -> transfer.final.verify
  -> transfer.publish
  -> transfer.notify
```

Trace membantu melihat bottleneck:

- chunk upload lambat
- checksum CPU tinggi
- filesystem write lambat
- downstream notify timeout
- DB update lambat

### 9.4 Alert yang Berguna

Alert bukan sekadar error count.

Lebih berguna:

```text
- No successful ingestion for source X within expected window
- Staging disk usage > 80%
- Oldest file in incoming > 30 minutes
- Transfer checksum failure > 0 in 10 minutes
- Retryable failures increasing for target Y
- Export job duration p95 > SLA
- Open file descriptors > threshold
- Quarantine file count > 0
- Reconciliation mismatch detected
```

---

## 10. Reconciliation Pattern

Event-driven/file-watcher/HTTP callback bisa gagal. Karena itu production system perlu reconciliation.

### 10.1 Kenapa Reconciliation Wajib

Contoh failure:

```text
file already moved to final directory
process crashed before DB status updated
```

Atau:

```text
all chunks uploaded
complete request timed out
server completed transfer but client retries complete
```

Atau:

```text
export file published
notification to downstream failed
```

Tanpa reconciliation, sistem macet di state antara.

### 10.2 Reconciliation Job

Periodik:

```text
find jobs in transitional state older than threshold
inspect filesystem/object storage/DB facts
repair state or mark manual review
```

Contoh:

```java
public void reconcileTransfers() {
    List<TransferJob> stale = repository.findStaleJobs(Duration.ofMinutes(15));

    for (TransferJob job : stale) {
        switch (job.status()) {
            case RECEIVING_CHUNKS -> reconcileReceiving(job);
            case VERIFYING -> reconcileVerifying(job);
            case FINALIZING -> reconcileFinalizing(job);
            case DELIVERING -> reconcileDelivering(job);
            default -> { }
        }
    }
}
```

### 10.3 Reconciliation Rule Example

```text
If DB says FINALIZING
and final file exists
and final checksum matches metadata
then mark COMPLETED if audit exists, else write missing audit then mark COMPLETED.
```

Atau:

```text
If DB says RECEIVING_CHUNKS
and job age > expiry
and not all chunks received
then mark EXPIRED and cleanup staging chunks after retention period.
```

---

## 11. Error Taxonomy dan Handling Strategy

Jangan semua error diperlakukan sama.

### 11.1 Error Taxonomy

| Error Type | Contoh | Strategy |
|---|---|---|
| Transient infrastructure | timeout, temporary network failure, 503 | retry with backoff |
| Permanent input | invalid format, wrong schema, checksum mismatch | reject/quarantine |
| Security violation | path traversal, zip slip, deserialization block | quarantine + alert |
| Capacity | disk full, too many open files, memory pressure | stop intake, alert, cleanup |
| Concurrency conflict | file already claimed, duplicate chunk | idempotent success or conflict |
| Downstream unavailable | target system down | retry budget + DLQ/manual |
| Unknown bug | unexpected exception | fail safe, preserve evidence |

### 11.2 Retry Decision Matrix

| Operation | Safe to Retry? | Condition |
|---|---:|---|
| Read local file | Usually yes | file immutable/stable |
| Write temp file | Yes | overwrite temp for same job only |
| Atomic move to final | Usually yes | handle already-exists idempotently |
| Send HTTP POST | Maybe | needs idempotency key |
| Send HTTP PUT chunk | Yes | chunk index + checksum idempotency |
| Insert DB record | Maybe | unique key/idempotency key |
| Publish event | Maybe | event id deduplication |
| Delete source file | Dangerous | only after committed/archive |

---

## 12. Operational Runbook

Runbook adalah instruksi operasional ketika sistem gagal. Tanpa runbook, operator akan membuat keputusan improvisasi yang mungkin merusak data.

### 12.1 Scenario: Disk Full di Staging

Symptoms:

```text
No space left on device
exports failing
incoming files stuck
staging disk > 90%
```

Immediate actions:

```text
1. Stop intake/scanner temporarily.
2. Do not delete random files.
3. Identify directories: tmp, staging, quarantine, success archive.
4. Check jobs referencing each file.
5. Remove only expired temp files according to retention policy.
6. Move old success archive to cold storage if allowed.
7. Resume scanner after free space exceeds safe threshold.
```

Preventive controls:

```text
- staging quota
- retention cleanup job
- alert at 70/80/90%
- max concurrent exports
- max accepted upload size
```

### 12.2 Scenario: File Stuck in PROCESSING

Actions:

```text
1. Check job updated_at.
2. Check whether processing node is alive.
3. Check checkpoint.
4. Check whether downstream commit partially succeeded.
5. If checkpoint exists and processor supports resume, mark RETRYABLE_FAILED then retry.
6. If partial side effect cannot be proven idempotent, mark MANUAL_REVIEW_REQUIRED.
```

### 12.3 Scenario: Checksum Mismatch

Actions:

```text
1. Do not process file.
2. Move to quarantine.
3. Record expected checksum, actual checksum, source, timestamp.
4. Notify source system.
5. If transfer is chunked, identify corrupt chunk.
6. Allow re-upload with same transferId only if protocol defines replacement safely.
```

### 12.4 Scenario: Duplicate File

Actions:

```text
1. Compute idempotency key/content hash.
2. Compare with previous job.
3. If exact duplicate and previous succeeded, mark DUPLICATE_IGNORED.
4. If same business key but different content, mark CONFLICT_MANUAL_REVIEW.
5. Never silently overwrite previous output.
```

### 12.5 Scenario: Downstream Timeout After Upload

Actions:

```text
1. Query downstream status by idempotency key or transferId.
2. If downstream completed, mark delivered.
3. If downstream not found, retry within retry budget.
4. If status unknown, do not blindly resubmit non-idempotent request.
5. Escalate if ambiguity remains.
```

### 12.6 Scenario: WatchService Missed Event

Actions:

```text
1. Run directory reconciliation scan.
2. Compare incoming files with job table.
3. Claim untracked stable files.
4. Investigate OVERFLOW events.
5. Increase scan frequency or reduce event burst.
6. Treat watcher as trigger, not source of truth.
```

---

## 13. Testing Strategy untuk Production I/O

### 13.1 Unit Test

Test pure logic:

- CSV escaping
- path validation
- checksum calculation
- state transition rules
- retry decision
- manifest validation
- idempotency key generation

### 13.2 Integration Test

Test filesystem nyata:

- atomic move
- temp file cleanup
- permission denied
- symlink traversal
- ZIP extraction
- large file streaming
- concurrent claim

Gunakan temporary directory per test:

```java
@TempDir
Path tempDir;
```

### 13.3 Fault Injection Test

Simulasikan:

- exception setelah temp write sebelum move
- exception setelah move sebelum DB update
- timeout saat upload chunk
- checksum mismatch
- process restart
- disk full jika environment memungkinkan
- duplicate retry
- partial file

### 13.4 Large File Test

Pastikan memory bounded.

Test:

```text
input: 5 GB synthetic file
expected: heap usage stable
expected: throughput within baseline
expected: no readAllBytes/readAllLines usage
```

### 13.5 Security Test

Test payload berbahaya:

```text
../../../etc/passwd
absolute path entry in ZIP
symlink in extraction root
zip bomb-like high compression ratio
oversized frame
oversized record
invalid UTF-8
untrusted serialized object
```

### 13.6 Concurrency Test

Test:

- dua scanner claim file yang sama
- dua upload chunk yang sama
- duplicate complete request
- export job cancellation
- cleanup job vs active job

---

## 14. Decision Matrix: Memilih Pola I/O

| Problem | Recommended Pattern |
|---|---|
| Small config file | `Files.readString` with explicit charset, size limit |
| Large text import | `BufferedReader` streaming + checkpoint |
| Large binary copy | `FileChannel.transferTo/transferFrom` or bounded stream copy |
| Random access file | `FileChannel` positional read/write |
| Huge read-mostly index | consider memory-mapped file |
| Safe output publish | temp file + force if needed + atomic move |
| Directory-based ingestion | claim by atomic move + state table + reconciliation |
| File watcher | WatchService + periodic scan, never watcher-only |
| Secure upload | chunked transfer + checksum + idempotency key |
| HTTP client transfer | reusable `HttpClient`, streaming body, timeout, retry rules |
| Untrusted ZIP | safe extraction with path and size limits |
| Untrusted serialized object | avoid; if unavoidable use strict `ObjectInputFilter` |
| Many blocking I/O tasks | virtual threads + bounded admission |
| High fan-out evented socket server | NIO selector or framework like Netty |

---

## 15. Capstone Architecture: Reliable Document Transfer and Ingestion Platform

### 15.1 Requirement

Bangun platform Java untuk menerima document bundle dari external agency:

```text
- File dapat berukuran hingga 2 GB.
- Transfer via HTTPS.
- Upload harus resumable.
- Bundle berupa ZIP.
- Harus ada manifest.
- Harus ada checksum whole-file dan per-entry.
- Harus mencegah zip slip/zip bomb.
- Harus menulis audit trail.
- Harus mendukung retry tanpa duplicate case update.
- Harus punya dashboard operational.
```

### 15.2 Component

```text
Upload API
  menerima metadata dan chunk

Transfer Store
  menyimpan chunk/temp/final payload

Transfer DB
  menyimpan state machine, chunk status, checksum, audit pointer

Assembler
  menggabungkan chunk menjadi payload final

Verifier
  memverifikasi whole-file checksum dan manifest

Safe Extractor
  mengekstrak ZIP dengan limit

Ingestion Processor
  memproses manifest dan dokumen ke domain system

Audit Writer
  menulis audit event

Reconciliation Job
  memperbaiki state stuck/partial

Cleanup Job
  membersihkan expired temp sesuai retention

Dashboard/Alert
  metrics dan operational visibility
```

### 15.3 Text Diagram

```text
Client
  |
  | initiate transfer(metadata)
  v
Upload API -----> Transfer DB: INITIATED
  |
  | PUT chunk(index, checksum, idempotency-key)
  v
Chunk Staging ----> Transfer DB: CHUNK_VERIFIED
  |
  | complete transfer
  v
Assembler -----> assembled.tmp
  |
  v
Verifier -----> sha256 check
  |
  v
Atomic Publish -----> completed/payload.zip
  |
  v
Safe Extractor -----> extracted staging
  |
  v
Manifest Validator
  |
  v
Domain Ingestion -----> Case/Documents
  |
  v
Audit + Metrics + Trace
```

### 15.4 End-to-End State

```text
TRANSFER_INITIATED
TRANSFER_RECEIVING
TRANSFER_RECEIVED
TRANSFER_ASSEMBLING
TRANSFER_ASSEMBLED
TRANSFER_VERIFYING
TRANSFER_VERIFIED
TRANSFER_EXTRACTING
TRANSFER_EXTRACTED
DOMAIN_PROCESSING
DOMAIN_PROCESSED
COMPLETED
```

Failure states:

```text
REJECTED_INVALID_METADATA
REJECTED_SIZE_LIMIT
REJECTED_CHECKSUM_MISMATCH
QUARANTINED_SECURITY_VIOLATION
FAILED_RETRYABLE
FAILED_PERMANENT
MANUAL_REVIEW_REQUIRED
EXPIRED
```

### 15.5 Critical Invariant

```text
Domain state must not change until:
1. all chunks are received,
2. all chunk checksums are valid,
3. assembled file checksum is valid,
4. ZIP is safely extracted,
5. manifest is valid,
6. all entry checksums are valid,
7. idempotency key is checked.
```

### 15.6 Exactly-Once Reality

Jangan klaim exactly-once secara absolut. Yang bisa kamu desain:

```text
at-least-once delivery
+ idempotent processing
+ deduplication
+ reconciliation
= effectively-once business outcome
```

Itu lebih jujur dan lebih operasional.

---

## 16. Production Readiness Checklist

### 16.1 Correctness

- [ ] Ada state machine eksplisit.
- [ ] Ada idempotency key.
- [ ] Ada checksum/verifikasi integrity.
- [ ] Ada atomic publish.
- [ ] Ada checkpoint untuk proses panjang.
- [ ] Ada reconciliation job.
- [ ] Ada handling duplicate.
- [ ] Ada handling partial failure.

### 16.2 Resource Safety

- [ ] Ada max file size.
- [ ] Ada max record size.
- [ ] Ada max decompressed size.
- [ ] Ada max concurrent jobs.
- [ ] Ada timeout.
- [ ] Ada retry budget.
- [ ] Ada cleanup temp.
- [ ] Tidak ada read-all untuk file besar.

### 16.3 Security

- [ ] Path divalidasi dalam root.
- [ ] Symlink behavior eksplisit.
- [ ] ZIP extraction aman dari traversal.
- [ ] Compression bomb dibatasi.
- [ ] Deserialization untrusted dihindari.
- [ ] Token/secret tidak dilog.
- [ ] Permission file/directory minimal.
- [ ] TLS/identity boundary jelas.

### 16.4 Observability

- [ ] Structured log dengan correlationId.
- [ ] Metrics bytes/records/duration/error.
- [ ] Audit event untuk lifecycle penting.
- [ ] Trace untuk transfer panjang.
- [ ] Dashboard operational.
- [ ] Alert untuk stuck job dan disk usage.

### 16.5 Operability

- [ ] Ada runbook.
- [ ] Ada manual retry yang aman.
- [ ] Ada quarantine review process.
- [ ] Ada retention policy.
- [ ] Ada cleanup job.
- [ ] Ada reconciliation report.
- [ ] Ada SLA/SLO untuk transfer.

### 16.6 Performance

- [ ] Streaming pipeline.
- [ ] Buffer size dipilih sadar.
- [ ] Bounded executor/virtual thread admission.
- [ ] Large file benchmark.
- [ ] JFR/profiling baseline.
- [ ] Disk/network bottleneck diketahui.
- [ ] GC pressure dipantau.

---

## 17. Anti-Pattern Besar yang Harus Dihindari

### 17.1 Treating File as Transaction

Filesystem operation dan DB transaction tidak otomatis atomic bersama.

Buruk:

```text
write file
insert DB row
assume both committed together
```

Lebih benar:

```text
write temp
verify
move final
record state
reconcile if crash between steps
```

### 17.2 Watcher-Only Design

`WatchService` event bisa overflow/coalesced/platform-specific. Gunakan watcher sebagai trigger, bukan source of truth.

### 17.3 Retry Without Idempotency

Retry non-idempotent operation bisa lebih berbahaya daripada gagal.

### 17.4 Delete Evidence Too Early

Jangan delete input file segera setelah error. Quarantine/arsipkan sesuai retention.

### 17.5 Using File Name as Trust Boundary

Nama file bisa bohong. Validasi path, extension, content type, magic bytes, schema, size, checksum.

### 17.6 Loading Large Payload into Memory

Hindari:

```java
byte[] all = Files.readAllBytes(path);
String content = Files.readString(path);
List<String> lines = Files.readAllLines(path);
```

Untuk payload besar, gunakan streaming.

### 17.7 Log as Audit

Log bukan pengganti audit trail.

### 17.8 Compression Without Limits

ZIP/GZIP dari pihak luar harus dianggap berbahaya sampai dibatasi.

### 17.9 Native Serialization at External Boundary

Java native serialization jangan dipakai untuk boundary eksternal/untrusted. Jika legacy tidak bisa dihindari, gunakan filter sangat ketat dan allowlist.

---

## 18. Ringkasan Part 030

Production I/O bukan tentang memilih API tercepat. Production I/O adalah desain sistem yang menjaga invariant di tengah failure.

Inti part ini:

1. File ingestion harus punya claim, staging, validation, processing, archive/quarantine, audit, dan reconciliation.
2. Export job harus streaming, memakai stable selection boundary, menulis ke temp file, memverifikasi output, lalu atomic publish.
3. Secure transfer harus memakai metadata, checksum, chunking, idempotency, retry budget, timeout, dan final verification.
4. ZIP/document bundle harus punya manifest dan safe extraction.
5. Audit, metrics, logs, dan traces memiliki fungsi berbeda.
6. Reconciliation adalah mekanisme wajib untuk memperbaiki state ambigu akibat crash/timeout/partial commit.
7. Runbook adalah bagian dari desain, bukan dokumentasi ops belakangan.
8. Klaim “exactly once” biasanya menyesatkan; target yang realistis adalah **effectively-once business outcome** melalui idempotency dan reconciliation.

---

## 19. Penutup Seri

Seri `learn-java-io-nio-networking-data-transfer` telah membangun perjalanan dari:

```text
byte/character
  -> stream
  -> buffer
  -> channel
  -> filesystem
  -> serialization
  -> compression
  -> networking
  -> HTTP/TLS
  -> reliability
  -> performance
  -> concurrency
  -> security
  -> production design
```

Kemampuan yang ingin dibentuk bukan sekadar tahu API, tetapi mampu membuat keputusan seperti engineer senior:

- memahami boundary
- menjaga invariant
- memprediksi failure mode
- mendesain retry yang aman
- membatasi resource
- menghindari data corruption
- membuat sistem observable
- menyiapkan operasi dan recovery

Dengan ini, seri mencapai bagian terakhir.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 029 — Security, Robustness, dan Defensive I/O: Path Traversal, Zip Slip, Deserialization, Resource Exhaustion](./learn-java-io-nio-networking-data-transfer-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 0 — Orientation: From Java I/O Developer to Network Systems Engineer](./network/000-orientation-from-java-io-developer-to-network-systems-engineer.md)

</div>