# Part 28 — File, CSV, XML, JSON, and Large Payload Batch Processing

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `28-file-csv-xml-json-large-payload-batch-processing.md`  
**Focus:** Jakarta Batch file/payload processing, streaming readers/writers, restartability, idempotency, large payload safety, and production-grade ingestion/export design.  
**Baseline:** Java 8–25, Java EE/Jakarta EE Batch lineage, Jakarta Batch 2.1 as stable Jakarta EE 11 baseline.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Mendesain batch ingestion/export berbasis file secara **streaming**, bukan load-all-to-memory.
2. Memilih strategi yang tepat untuk CSV, fixed-width, XML, JSON, NDJSON, compressed files, dan large payload.
3. Membuat `ItemReader`, `ItemProcessor`, dan `ItemWriter` yang **restartable** lewat checkpoint.
4. Menangani file lifecycle secara aman:
   - arrival
   - validation
   - staging
   - processing
   - quarantine
   - archive
   - reprocessing
5. Memahami edge case file processing:
   - partial file
   - duplicate file
   - malformed record
   - encoding mismatch
   - delimiter ambiguity
   - huge line
   - broken XML/JSON
   - corrupt compression
   - interrupted processing
6. Mendesain idempotency untuk file import/export agar restart, retry, dan duplicate delivery tidak merusak data.
7. Membuat operational model yang defensible untuk regulated systems: manifest, checksum, audit evidence, record-level error report, and reprocessing governance.

---

## 2. Problem yang Diselesaikan

File batch terlihat sederhana:

```text
read file -> parse record -> insert/update database -> done
```

Namun di production, problem sebenarnya jauh lebih kompleks:

```text
file may arrive partially
file may be duplicated
file may be re-sent with same name but different content
file may contain malformed records
file may be huge
file may use wrong encoding
file may be compressed
file may contain nested payloads
file may fail after 70% processed
file may have already caused side effects before failure
file may be restarted after deployment
file may be processed by two nodes accidentally
file may need regulatory evidence years later
```

Untuk engineer biasa, batch file processing adalah parsing.  
Untuk engineer top-tier, batch file processing adalah **durable, restartable, auditable data ingestion pipeline**.

---

## 3. Mental Model Utama

### 3.1 File Is Not Just Input; File Is an External Contract

File bukan sekadar kumpulan bytes. File adalah kontrak antara sistem pengirim dan sistem penerima.

Kontrak file mencakup:

| Area | Pertanyaan |
|---|---|
| Format | CSV, XML, JSON, fixed-width, binary, compressed? |
| Schema | Field apa wajib? Nullable? Type? Length? |
| Encoding | UTF-8, ISO-8859-1, Windows-1252? BOM? |
| Delimiter | Comma, pipe, tab, semicolon? Escaping? Quote? |
| Naming | Nama file mengandung date, agency, sequence? |
| Completeness | Bagaimana tahu file sudah selesai dikirim? |
| Integrity | Checksum? Size? Record count? Trailer? Manifest? |
| Idempotency | Apa identitas file dan record? |
| Ordering | Apakah record harus diproses berurutan? |
| Error handling | Reject whole file atau skip bad record? |
| Reprocessing | Boleh re-run? Dengan aturan apa? |
| Audit | Bukti apa yang harus disimpan? |

Jika kontrak ini tidak eksplisit, batch akan rapuh.

---

### 3.2 File Processing Is a State Machine

Batch file ingestion harus dilihat sebagai state machine, bukan method tunggal.

```text
RECEIVED
  -> STAGED
  -> VALIDATED
  -> PROCESSING
  -> PARTIALLY_PROCESSED
  -> COMPLETED
  -> ARCHIVED
```

Failure path:

```text
RECEIVED
  -> STAGED
  -> VALIDATION_FAILED
  -> QUARANTINED
```

```text
PROCESSING
  -> FAILED_RETRYABLE
  -> RESTARTED
  -> COMPLETED
```

```text
PROCESSING
  -> FAILED_NON_RETRYABLE
  -> QUARANTINED
```

```text
COMPLETED
  -> REPROCESS_REQUESTED
  -> REPROCESS_APPROVED
  -> REPROCESSING
```

State machine membuat batch lebih mudah dioperasikan, diaudit, dan direstart.

---

### 3.3 Streaming First, Materialization Only When Necessary

Rule utama:

> Jangan load seluruh file ke memory kecuali ukuran file secara eksplisit kecil, dibatasi, dan tervalidasi.

Bad pattern:

```java
List<String> lines = Files.readAllLines(path);
for (String line : lines) {
    process(line);
}
```

Masalah:

- file besar membuat heap meledak
- GC pressure meningkat
- restartability buruk
- checkpoint sulit
- satu bad record bisa menggagalkan seluruh load
- observability record-level lemah

Better pattern:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Jakarta Batch chunk-oriented reader jauh lebih cocok:

```text
open(checkpoint)
readItem()
readItem()
...
checkpointInfo()
close()
```

---

## 4. Jakarta Batch Mapping untuk File Workloads

Jakarta Batch chunk step cocok untuk file karena file biasanya terdiri dari banyak item.

```text
File
 ├── header
 ├── record 1
 ├── record 2
 ├── record 3
 ├── ...
 └── trailer
```

Mapping ke Jakarta Batch:

| File Concept | Jakarta Batch Artifact |
|---|---|
| line/record/event/object | item |
| parser | `ItemReader` or `ItemProcessor` |
| validation | `ItemProcessor` |
| DB insert/update | `ItemWriter` |
| file position / line number / record offset | checkpoint |
| bad record report | skip listener / writer side output |
| file lifecycle metadata | job parameter + job repository + domain table |
| manifest/checksum | pre-validation batchlet or first step |
| archive/quarantine | final step or listener with care |

---

## 5. File Lifecycle Architecture

### 5.1 Recommended Directory Layout

Untuk file-based integration, gunakan direktori atau object storage prefix yang memisahkan lifecycle.

```text
/inbound
  /landing        # tempat file pertama kali datang
  /staging        # file yang sudah dianggap lengkap dan siap diproses
  /processing     # optional marker/state, bukan selalu copy fisik
  /archive        # file sukses
  /quarantine     # file gagal validasi/non-retryable
  /error-report   # record-level error reports
  /manifest       # manifest/checksum/count metadata
```

Untuk object storage seperti S3, prefix bisa menggantikan direktori:

```text
s3://bucket/inbound/landing/
s3://bucket/inbound/staging/
s3://bucket/inbound/archive/
s3://bucket/inbound/quarantine/
s3://bucket/inbound/error-report/
```

---

### 5.2 Why Landing and Staging Must Be Separate

Jangan langsung memproses file di lokasi landing.

Problem:

```text
sender masih upload file
batch scheduler melihat file sudah ada
batch mulai membaca
file belum lengkap
batch gagal atau memproses data parsial
```

Solusi umum:

1. Sender upload ke temporary name:

```text
CASE_20260617.csv.uploading
```

2. Setelah selesai, sender rename atomic ke final name:

```text
CASE_20260617.csv
```

3. Receiver hanya memproses final name.

Jika rename atomic tidak tersedia, gunakan manifest/done marker:

```text
CASE_20260617.csv
CASE_20260617.csv.done
```

Receiver hanya memproses jika `.done` ada dan metadata cocok.

---

### 5.3 Atomic Move Pattern

Dalam filesystem lokal atau shared filesystem yang mendukung atomic move:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

Namun jangan asumsikan semua storage mendukung atomic rename. Object storage biasanya bukan POSIX filesystem. Untuk S3-like storage, gunakan object key convention, manifest, ETag/checksum, dan state table.

---

## 6. File Identity and Idempotency

### 6.1 File Identity

Jangan hanya memakai file name sebagai identitas file.

File identity yang lebih kuat:

```text
file_identity = hash(sourceSystem + logicalFileType + businessDate + sequence + checksum)
```

Minimal simpan metadata:

| Field | Purpose |
|---|---|
| source_system | siapa pengirim |
| file_type | jenis file |
| file_name | nama asli |
| file_size | ukuran |
| checksum | integrity + duplicate detection |
| record_count | validation |
| business_date | semantic identity |
| received_at | audit |
| staged_at | operational state |
| job_execution_id | link ke Jakarta Batch |
| status | lifecycle state |

Example table:

```sql
CREATE TABLE inbound_file_registry (
    id                  VARCHAR(64) PRIMARY KEY,
    source_system       VARCHAR(64) NOT NULL,
    file_type           VARCHAR(64) NOT NULL,
    file_name           VARCHAR(255) NOT NULL,
    file_size_bytes     BIGINT NOT NULL,
    checksum_sha256     VARCHAR(64) NOT NULL,
    business_date       DATE,
    record_count        BIGINT,
    status              VARCHAR(32) NOT NULL,
    received_at         TIMESTAMP NOT NULL,
    staged_at           TIMESTAMP,
    processing_started_at TIMESTAMP,
    completed_at        TIMESTAMP,
    job_instance_id     BIGINT,
    job_execution_id    BIGINT,
    created_by          VARCHAR(128),
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    UNIQUE (source_system, file_type, file_name, checksum_sha256)
);
```

---

### 6.2 Record Identity

Untuk restart dan duplicate detection, setiap record harus punya identity.

Kemungkinan identity:

| Record Type | Natural Identity |
|---|---|
| Case update | case number + event date + source sequence |
| Payment record | payment reference + amount + date |
| Person profile | national ID + source system version |
| Correspondence | template ID + recipient ID + generation batch |
| Registry sync | external ID + version/timestamp |

Jika file tidak menyediakan natural key, buat synthetic deterministic key:

```text
record_key = sha256(file_checksum + line_number + normalized_record_content)
```

Namun hati-hati: jika line number berubah saat file dikirim ulang, key berubah.

Untuk regulated systems, lebih baik contract file menyediakan:

```text
source_record_id
source_sequence_no
source_version
```

---

## 7. CSV Processing Deep Dive

### 7.1 CSV Is Not Simple Split by Comma

Bad parser:

```java
String[] columns = line.split(",");
```

Ini rusak untuk:

```csv
id,name,remarks
1,"Tan, Alice","Has comma"
2,"Bob","Line with ""quote"" inside"
3,"Charlie","multi
line field"
```

CSV harus menangani:

- quoted fields
- escaped quote
- delimiter inside quote
- newline inside quote
- empty field vs missing field
- trailing delimiter
- BOM
- different delimiter
- inconsistent column count
- huge field

Gunakan CSV parser library yang benar. Untuk Java umum:

- Apache Commons CSV
- Univocity Parsers
- OpenCSV

Dalam Jakarta Batch, parser library dipakai di dalam `ItemReader`, tetapi lifecycle/checkpoint tetap dikelola batch artifact.

---

### 7.2 CSV Header Validation

Sebelum memproses record, validasi header.

Contoh expected header:

```text
case_no,status,effective_date,reason
```

Validation rules:

1. Semua required column ada.
2. Tidak ada duplicate column.
3. Column order sesuai jika format position-sensitive.
4. Unknown column ditolak atau diabaikan berdasarkan contract.
5. Header encoding benar.
6. BOM dibersihkan.

Pseudocode:

```java
Set<String> required = Set.of("case_no", "status", "effective_date", "reason");
Set<String> actual = parseHeader(file);

if (!actual.containsAll(required)) {
    throw new FileValidationException("Missing required columns: " + difference(required, actual));
}
```

---

### 7.3 CSV Reader Checkpoint Strategy

Untuk line-based CSV sederhana, checkpoint bisa berupa line number.

```java
public final class CsvCheckpoint implements Serializable {
    private final long nextLineNumber;

    public CsvCheckpoint(long nextLineNumber) {
        this.nextLineNumber = nextLineNumber;
    }

    public long nextLineNumber() {
        return nextLineNumber;
    }
}
```

Namun untuk CSV dengan multi-line quoted field, line number fisik tidak selalu sama dengan record number.

Lebih baik checkpoint:

```text
recordNumber
physicalLineNumber
byteOffset if available
parserState if needed
```

Dalam banyak parser, byte offset tidak mudah didapat karena decoding character stream. Maka pragmatic approach:

- gunakan record number sebagai checkpoint
- saat restart, reopen file
- skip parsed records sampai record checkpoint
- pastikan skip menggunakan parser yang sama, bukan raw line skip

Trade-off:

| Strategy | Pros | Cons |
|---|---|---|
| line number | simple | salah untuk multi-line record |
| record number | correct for parser-level record | restart perlu re-parse dari awal |
| byte offset | fast restart | sulit dengan encoding/parser buffering |
| domain key | semantically strong | perlu lookup/dedup |

---

### 7.4 Example CSV ItemReader

Contoh berikut sengaja sederhana untuk menunjukkan lifecycle dan checkpoint. Dalam production, parsing CSV sebaiknya memakai library parser yang robust.

```java
import jakarta.batch.api.chunk.ItemReader;
import jakarta.enterprise.context.Dependent;
import jakarta.inject.Named;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

@Named
@Dependent
public class CaseCsvItemReader implements ItemReader {

    private BufferedReader reader;
    private long nextLineNumber;
    private long currentLineNumber;
    private Path path;

    @Override
    public void open(Serializable checkpoint) throws Exception {
        this.path = Path.of(System.getProperty("batch.input.file"));
        this.reader = Files.newBufferedReader(path, StandardCharsets.UTF_8);

        long startLine = 1;
        if (checkpoint instanceof Long) {
            startLine = (Long) checkpoint;
        }

        this.nextLineNumber = startLine;
        this.currentLineNumber = 0;

        while (currentLineNumber < startLine - 1) {
            if (reader.readLine() == null) {
                break;
            }
            currentLineNumber++;
        }
    }

    @Override
    public Object readItem() throws Exception {
        String line = reader.readLine();
        if (line == null) {
            return null;
        }

        currentLineNumber++;
        nextLineNumber = currentLineNumber + 1;

        if (currentLineNumber == 1 && line.startsWith("case_no,")) {
            return readItem(); // Skip header for simple demo.
        }

        return parseLine(line, currentLineNumber);
    }

    private CaseCsvRecord parseLine(String line, long lineNumber) {
        String[] parts = line.split(",", -1);
        if (parts.length != 4) {
            throw new IllegalArgumentException("Invalid CSV column count at line " + lineNumber);
        }

        return new CaseCsvRecord(
            lineNumber,
            parts[0].trim(),
            parts[1].trim(),
            parts[2].trim(),
            parts[3].trim()
        );
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        return nextLineNumber;
    }

    @Override
    public void close() throws Exception {
        if (reader != null) {
            reader.close();
        }
    }
}
```

Kelemahan demo di atas:

- belum robust untuk quoted CSV
- memakai `System.getProperty`, bukan job parameter injection
- checkpoint line-based
- header skip recursive
- belum handle BOM

Tujuan kode ini adalah memahami lifecycle, bukan production parser final.

---

## 8. Fixed-Width File Processing

Fixed-width umum di legacy/government/banking systems.

Contoh:

```text
CASE000000001OPEN     20260617HIGH  Some reason text        
CASE000000002CLOSED   20260618LOW   Another reason          
```

Parsing berdasarkan posisi:

| Field | Start | End | Length |
|---|---:|---:|---:|
| caseNo | 0 | 12 | 12 |
| status | 12 | 21 | 9 |
| effectiveDate | 21 | 29 | 8 |
| priority | 29 | 35 | 6 |
| reason | 35 | 60 | 25 |

Example parser:

```java
public CaseFixedWidthRecord parse(String line, long lineNumber) {
    if (line.length() < 60) {
        throw new InvalidRecordException("Line too short at " + lineNumber);
    }

    String caseNo = line.substring(0, 12).trim();
    String status = line.substring(12, 21).trim();
    String date = line.substring(21, 29).trim();
    String priority = line.substring(29, 35).trim();
    String reason = line.substring(35, 60).trim();

    return new CaseFixedWidthRecord(caseNo, status, date, priority, reason);
}
```

Risiko fixed-width:

- multibyte encoding membuat byte length berbeda dari char length
- padding tidak konsisten
- trailing space hilang saat transfer tertentu
- line ending CRLF/LF berbeda
- field overflow silent truncation

Untuk kontrak berbasis byte position, parse dari bytes, bukan `String.substring()`.

---

## 9. XML Processing Deep Dive

### 9.1 DOM vs SAX vs StAX

Untuk XML batch besar, hindari DOM penuh.

| API | Model | Cocok Untuk | Risiko |
|---|---|---|---|
| DOM | load entire tree | small XML, random access | memory explosion |
| SAX | event callback | streaming read, low memory | callback complexity |
| StAX | pull parser | streaming read with control | manual state machine |
| JAXB | object binding | moderate XML, known schema | may materialize too much |

Untuk batch besar, StAX sering paling seimbang.

---

### 9.2 XML Security Baseline

XML punya risiko keamanan khusus:

- XXE
- external entity expansion
- billion laughs
- schema fetch dari network
- oversized nested structure

Secure XMLInputFactory:

```java
XMLInputFactory factory = XMLInputFactory.newFactory();
factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
factory.setProperty("javax.xml.stream.isSupportingExternalEntities", false);
```

Catatan: dukungan property bisa berbeda per implementation. Pastikan diuji di runtime target.

---

### 9.3 StAX ItemReader Mental Model

Misal XML:

```xml
<cases>
  <case>
    <caseNo>EA-001</caseNo>
    <status>OPEN</status>
  </case>
  <case>
    <caseNo>EA-002</caseNo>
    <status>CLOSED</status>
  </case>
</cases>
```

`ItemReader` membaca satu `<case>` sebagai satu item.

```text
open(checkpoint)
  create XMLStreamReader
  skip to checkpoint record count
readItem()
  advance until <case>
  parse case element
  return CaseXmlRecord
checkpointInfo()
  return nextRecordNumber
close()
```

---

### 9.4 XML Checkpointing

Checkpoint by record number biasanya lebih portable daripada byte offset.

```java
public final class XmlCheckpoint implements Serializable {
    private final long nextCaseIndex;

    public XmlCheckpoint(long nextCaseIndex) {
        this.nextCaseIndex = nextCaseIndex;
    }

    public long nextCaseIndex() {
        return nextCaseIndex;
    }
}
```

Restart cost:

```text
restart -> parse from beginning -> skip N case elements -> continue
```

Untuk file sangat besar, ini bisa mahal. Alternatif:

- split file upstream
- create index file before processing
- partition by file segment only if XML structure supports it
- convert to line-delimited intermediate format
- use database staging

---

## 10. JSON Processing Deep Dive

### 10.1 JSON Shapes

Ada beberapa bentuk JSON file:

#### Array JSON

```json
[
  { "caseNo": "EA-001", "status": "OPEN" },
  { "caseNo": "EA-002", "status": "CLOSED" }
]
```

Pros:

- standard JSON
- mudah divalidasi sebagai satu dokumen

Cons:

- streaming perlu parser token-level
- file harus valid sampai closing `]`
- partial file sulit dideteksi tanpa parse penuh

#### NDJSON / JSON Lines

```json
{"caseNo":"EA-001","status":"OPEN"}
{"caseNo":"EA-002","status":"CLOSED"}
```

Pros:

- sangat cocok untuk batch streaming
- satu line = satu item
- mudah checkpoint by line/record number
- record-level error handling lebih mudah

Cons:

- bukan single JSON array
- multi-line pretty JSON tidak cocok

Untuk batch ingestion besar, NDJSON sering lebih operasional dibanding JSON array.

---

### 10.2 Jackson Streaming Reader

Untuk JSON besar, gunakan Jackson streaming API atau JSON-P streaming.

Jackson token model:

```java
JsonFactory factory = new JsonFactory();
try (JsonParser parser = factory.createParser(file.toFile())) {
    while (parser.nextToken() != null) {
        // token-level processing
    }
}
```

Untuk NDJSON, bisa baca line-by-line lalu parse object:

```java
String line = reader.readLine();
CaseRecord record = objectMapper.readValue(line, CaseRecord.class);
```

Trade-off:

| Strategy | Pros | Cons |
|---|---|---|
| line-by-line NDJSON | simple, checkpointable | requires NDJSON contract |
| full ObjectMapper list | easy | memory risk |
| streaming token parser | scalable | more complex |

---

## 11. Large Payload Handling

### 11.1 Large Payload Anti-Patterns

Anti-pattern:

```java
byte[] data = Files.readAllBytes(path);
String content = new String(data, UTF_8);
List<Record> records = objectMapper.readValue(content, new TypeReference<>() {});
```

Risiko:

- heap explosion
- long GC pause
- OutOfMemoryError
- poor restartability
- no backpressure
- no record-level progress

---

### 11.2 Streaming Rules

Untuk payload besar:

1. Parse incrementally.
2. Validate incrementally where possible.
3. Write per chunk.
4. Keep checkpoint small.
5. Keep item object bounded.
6. Avoid retaining references to previous items.
7. Avoid building huge error list in memory.
8. Write error report streaming too.

---

### 11.3 CLOB/BLOB Handling

Jika record mengandung large text/binary:

- jangan masukkan semua payload ke memory jika bisa stream
- simpan large payload ke object storage/blob table terpisah
- simpan metadata/reference di main table
- hash payload untuk dedup/integrity
- validasi ukuran maksimal
- batasi decompressed size

Example metadata:

```sql
CREATE TABLE imported_payload_ref (
    id                  VARCHAR(64) PRIMARY KEY,
    file_id             VARCHAR(64) NOT NULL,
    record_key          VARCHAR(128) NOT NULL,
    payload_sha256      VARCHAR(64) NOT NULL,
    payload_size_bytes  BIGINT NOT NULL,
    storage_uri         VARCHAR(1024) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    UNIQUE (file_id, record_key)
);
```

---

## 12. Compression Handling

Common compression formats:

- `.gz`
- `.zip`
- `.tar.gz`
- `.bz2`
- `.xz`

### 12.1 GZIP

GZIP is stream-friendly.

```java
try (InputStream in = Files.newInputStream(path);
     GZIPInputStream gzip = new GZIPInputStream(in);
     BufferedReader reader = new BufferedReader(new InputStreamReader(gzip, StandardCharsets.UTF_8))) {
    // stream records
}
```

Checkpoint issue:

- byte offset inside compressed stream is not easy to resume
- restart usually reopens from beginning and skips records
- for huge files, split upstream into multiple smaller gzip files

---

### 12.2 ZIP

ZIP can contain multiple entries.

Risks:

- zip slip path traversal
- zip bomb
- nested archive
- too many entries
- huge decompressed size

Zip slip prevention:

```java
Path targetDir = Path.of("/safe/staging").toRealPath();
Path resolved = targetDir.resolve(entry.getName()).normalize();

if (!resolved.startsWith(targetDir)) {
    throw new SecurityException("Invalid ZIP entry path: " + entry.getName());
}
```

Always enforce:

- max entries
- max compressed size
- max decompressed size
- allowed extensions
- no absolute paths
- no `../`

---

## 13. Manifest and Checksum

### 13.1 Manifest File Pattern

Manifest example:

```json
{
  "sourceSystem": "REGISTRY_A",
  "fileName": "case_updates_20260617.ndjson.gz",
  "businessDate": "2026-06-17",
  "recordCount": 1000000,
  "sha256": "...",
  "encoding": "UTF-8",
  "format": "NDJSON",
  "schemaVersion": "2026-01"
}
```

Batch validation:

1. Manifest exists.
2. File exists.
3. File size matches if provided.
4. Checksum matches.
5. Record count matches after scan or trailer validation.
6. Schema version supported.
7. Business date acceptable.
8. File not already completed with same checksum.

---

### 13.2 Checksum Calculation

```java
public static String sha256(Path path) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");

    try (InputStream in = Files.newInputStream(path)) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            digest.update(buffer, 0, read);
        }
    }

    byte[] hash = digest.digest();
    StringBuilder hex = new StringBuilder();
    for (byte b : hash) {
        hex.append(String.format("%02x", b));
    }
    return hex.toString();
}
```

For very large files, checksum scan is extra I/O. That is usually acceptable for integrity-critical ingestion, but capacity planning must account for it.

---

## 14. Record-Level Validation Architecture

Validation should happen in layers.

### 14.1 File-Level Validation

Before chunk processing:

- file name pattern
- source system allowed
- checksum
- schema version
- duplicate file
- encoding
- header/trailer
- max size

### 14.2 Record-Level Structural Validation

During reader/processor:

- column count
- JSON/XML parse validity
- required fields present
- field length
- date/number format
- enum values

### 14.3 Business Validation

During processor/writer:

- case exists
- transition allowed
- duplicate event
- user/agency allowed
- date within allowed window
- reference data valid

### 14.4 Persistence Validation

During writer:

- unique constraint
- FK constraint
- optimistic lock
- idempotency constraint

---

## 15. Error Handling Models

### 15.1 Reject Whole File

Use when:

- file-level contract invalid
- header missing
- checksum mismatch
- schema unsupported
- record count mismatch
- mandatory trailer invalid
- file is semantically atomic

Pros:

- simple audit
- no partial data

Cons:

- one bad record blocks all data

---

### 15.2 Skip Bad Records

Use when:

- records are independent
- business accepts partial success
- error report is required
- retry/reprocess can target failed records

Need:

- skip limit
- error report
- audit reason
- stable record identity
- clear final status such as `COMPLETED_WITH_ERRORS`

---

### 15.3 Quarantine Records

Pattern:

```text
valid records -> processed
invalid records -> quarantine table/file
batch result -> completed with rejected_count > 0
```

Example table:

```sql
CREATE TABLE inbound_record_error (
    id              VARCHAR(64) PRIMARY KEY,
    file_id         VARCHAR(64) NOT NULL,
    record_key      VARCHAR(128),
    line_number     BIGINT,
    raw_record      CLOB,
    error_code      VARCHAR(64) NOT NULL,
    error_message   VARCHAR(2000) NOT NULL,
    error_stage     VARCHAR(32) NOT NULL,
    created_at      TIMESTAMP NOT NULL
);
```

For PII-sensitive systems, do not store raw record blindly. Mask or encrypt.

---

## 16. ItemWriter Idempotency for File Import

### 16.1 Upsert with Idempotency Key

Writer should be safe if the same chunk is retried.

```sql
CREATE TABLE processed_inbound_record (
    file_id       VARCHAR(64) NOT NULL,
    record_key    VARCHAR(128) NOT NULL,
    processed_at  TIMESTAMP NOT NULL,
    status        VARCHAR(32) NOT NULL,
    PRIMARY KEY (file_id, record_key)
);
```

Writer flow:

```text
for each item:
  if processed_inbound_record exists:
      skip as duplicate/idempotent success
  else:
      apply business mutation
      insert processed_inbound_record
commit chunk
```

If business mutation and processed marker are in same transaction, restart is safe.

---

### 16.2 Avoid Non-Transactional External Side Effects in Writer

Dangerous writer:

```text
insert DB row
send external API
commit DB
```

If API succeeds but DB commit fails, restart calls API again.

Better:

```text
writer inserts DB mutation + outbox event in same transaction
separate outbox dispatcher sends API with idempotency key
```

---

## 17. Export File Processing

File batch is not only import. Export also needs rigor.

### 17.1 Export State Machine

```text
REQUESTED
  -> GENERATING
  -> GENERATED_TEMP
  -> CHECKSUM_CREATED
  -> MANIFEST_CREATED
  -> PUBLISHED
  -> ARCHIVED
```

Failure:

```text
GENERATING
  -> FAILED
  -> RETRY_GENERATION
```

---

### 17.2 Write to Temp Then Atomic Publish

Never publish partially written file.

```text
case_export_20260617.csv.tmp
case_export_20260617.csv
case_export_20260617.csv.manifest
```

Flow:

1. Write temp file.
2. Flush and close.
3. Calculate checksum.
4. Validate row count.
5. Move temp to final.
6. Write manifest/done marker.

---

### 17.3 Export Writer Pattern

In Jakarta Batch, `ItemWriter` receives a list of items per chunk.

For file writer:

- open file in `open`
- write header once
- write each chunk
- flush periodically
- checkpoint current count
- close file
- final publish in later step or job listener only after success

Avoid publishing in `close()` if `close()` can happen after failure. Use explicit finalization step that runs only after successful generation.

---

## 18. Large Error Reports

Do not accumulate all errors in memory.

Bad:

```java
List<RecordError> errors = new ArrayList<>();
```

Better:

- stream errors to DB table
- stream errors to file writer
- use chunk writer for error side output
- aggregate only counts in memory

Error report fields:

```text
file_id
record_key
line_number
column_name
raw_value_masked
error_code
error_message
severity
stage
```

Example CSV error report:

```csv
file_id,line_number,record_key,error_code,error_message
F001,92,abc123,INVALID_DATE,"effective_date must be yyyy-MM-dd"
F001,103,def456,UNKNOWN_CASE,"case_no not found"
```

---

## 19. Partitioning File Processing

### 19.1 When Partitioning Is Easy

Partitioning works well when input is naturally split:

```text
file_001.csv
file_002.csv
file_003.csv
```

or by business range:

```text
agency=A
agency=B
agency=C
```

### 19.2 When Partitioning Is Hard

One giant CSV/XML/JSON file is hard to partition safely because:

- record boundary may not align with byte offset
- quoted CSV may contain newline
- XML nested structure is not splittable trivially
- JSON array needs valid token boundaries
- checkpoint becomes complex

Strategies:

1. Require upstream to split files.
2. Pre-split into validated chunks as first batch step.
3. Load into staging table then partition DB processing.
4. Use NDJSON rather than JSON array.
5. Use fixed record length format if byte partition is required.

---

## 20. Database Staging Pattern

For complex file ingestion, two-phase design is often safer.

### 20.1 Phase 1: Raw/Staging Load

```text
file -> parse structurally -> staging table
```

Staging table:

```sql
CREATE TABLE case_update_staging (
    file_id        VARCHAR(64) NOT NULL,
    record_key     VARCHAR(128) NOT NULL,
    line_number    BIGINT NOT NULL,
    case_no        VARCHAR(64),
    status         VARCHAR(32),
    effective_date DATE,
    reason         VARCHAR(1000),
    validation_status VARCHAR(32) NOT NULL,
    error_code     VARCHAR(64),
    created_at     TIMESTAMP NOT NULL,
    PRIMARY KEY (file_id, record_key)
);
```

### 20.2 Phase 2: Business Apply

```text
staging table -> validate business rules -> apply domain mutation
```

Benefits:

- better restartability
- easier error reporting
- easier partitioning
- raw evidence retained
- can inspect before apply
- can support approval gate

Costs:

- extra storage
- extra I/O
- more schema objects
- data retention governance needed

---

## 21. Schema Evolution

File formats evolve.

Avoid hardcoding one eternal schema.

```text
case_updates_v1.csv
case_updates_v2.csv
```

or manifest:

```json
{
  "schemaVersion": "2026-01"
}
```

Reader/processor can route:

```java
switch (schemaVersion) {
    case "2025-01": return parseV202501(record);
    case "2026-01": return parseV202601(record);
    default: throw new UnsupportedSchemaVersionException(schemaVersion);
}
```

Migration policy:

| Strategy | Description |
|---|---|
| strict | reject unknown schema |
| tolerant read | accept additional fields |
| versioned parser | parser per version |
| canonical model | map versions to internal canonical DTO |

For regulated systems, prefer explicit schema version and strict compatibility rules.

---

## 22. Character Encoding and BOM

Encoding bugs are common.

### 22.1 Always Specify Charset

Bad:

```java
Files.newBufferedReader(path); // uses default charset depending on API/platform
```

Better:

```java
Files.newBufferedReader(path, StandardCharsets.UTF_8);
```

### 22.2 BOM Handling

UTF-8 BOM may appear at start:

```text
\uFEFFcase_no,status,date
```

If not removed, first column becomes:

```text
"\uFEFFcase_no"
```

Handle BOM in reader/header parser.

---

## 23. Date, Number, and Locale Issues

Never parse dates/numbers with implicit locale.

Bad:

```java
new SimpleDateFormat("dd/MM/yyyy").parse(value);
```

Better with Java Time:

```java
DateTimeFormatter formatter = DateTimeFormatter.ISO_LOCAL_DATE;
LocalDate date = LocalDate.parse(value, formatter);
```

For amount:

```java
BigDecimal amount = new BigDecimal(value);
```

Avoid `double` for money or exact amounts.

---

## 24. Complete Example: NDJSON Import Job

### 24.1 JSL

```xml
<job id="case-ndjson-import" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <properties>
        <property name="fileId" value="#{jobParameters['fileId']}"/>
        <property name="inputPath" value="#{jobParameters['inputPath']}"/>
    </properties>

    <step id="validate-file" next="import-records">
        <batchlet ref="fileValidationBatchlet"/>
    </step>

    <step id="import-records" next="finalize-file">
        <chunk item-count="500">
            <reader ref="caseNdjsonItemReader"/>
            <processor ref="caseImportProcessor"/>
            <writer ref="caseImportWriter"/>
            <skippable-exception-classes>
                <include class="com.example.batch.InvalidRecordException"/>
            </skippable-exception-classes>
            <skip-limit>1000</skip-limit>
        </chunk>
    </step>

    <step id="finalize-file">
        <batchlet ref="fileFinalizeBatchlet"/>
    </step>
</job>
```

---

### 24.2 Reader

```java
@Named
@Dependent
public class CaseNdjsonItemReader implements ItemReader {

    @Inject
    @BatchProperty(name = "inputPath")
    private String inputPath;

    private BufferedReader reader;
    private long currentLine;
    private long nextLine;
    private ObjectMapper mapper;

    @Override
    public void open(Serializable checkpoint) throws Exception {
        this.mapper = new ObjectMapper();
        this.reader = Files.newBufferedReader(Path.of(inputPath), StandardCharsets.UTF_8);

        long start = checkpoint instanceof Long ? (Long) checkpoint : 1L;
        this.currentLine = 0;
        this.nextLine = start;

        while (currentLine < start - 1) {
            if (reader.readLine() == null) {
                break;
            }
            currentLine++;
        }
    }

    @Override
    public Object readItem() throws Exception {
        String line = reader.readLine();
        if (line == null) {
            return null;
        }

        currentLine++;
        nextLine = currentLine + 1;

        try {
            CaseImportJson json = mapper.readValue(line, CaseImportJson.class);
            return new CaseImportRecord(currentLine, json);
        } catch (JsonProcessingException e) {
            throw new InvalidRecordException("Invalid JSON at line " + currentLine, e)
                .withLineNumber(currentLine)
                .withRawRecord(mask(line));
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return nextLine;
    }

    @Override
    public void close() throws Exception {
        if (reader != null) {
            reader.close();
        }
    }

    private String mask(String raw) {
        return raw.length() > 500 ? raw.substring(0, 500) + "..." : raw;
    }
}
```

---

### 24.3 Processor

```java
@Named
@Dependent
public class CaseImportProcessor implements ItemProcessor {

    @Override
    public Object processItem(Object item) throws Exception {
        CaseImportRecord record = (CaseImportRecord) item;
        CaseImportJson json = record.payload();

        if (json.caseNo() == null || json.caseNo().isBlank()) {
            throw new InvalidRecordException("caseNo is required")
                .withLineNumber(record.lineNumber());
        }

        if (!Set.of("OPEN", "CLOSED", "SUSPENDED").contains(json.status())) {
            throw new InvalidRecordException("Unsupported status: " + json.status())
                .withLineNumber(record.lineNumber());
        }

        String recordKey = sha256(json.caseNo() + "|" + json.status() + "|" + json.effectiveDate());

        return new ValidatedCaseImportCommand(
            record.lineNumber(),
            recordKey,
            json.caseNo(),
            json.status(),
            LocalDate.parse(json.effectiveDate())
        );
    }
}
```

---

### 24.4 Writer

```java
@Named
@Dependent
public class CaseImportWriter implements ItemWriter {

    @Inject
    private CaseImportRepository repository;

    @Inject
    @BatchProperty(name = "fileId")
    private String fileId;

    @Override
    public void open(Serializable checkpoint) {
        // no-op
    }

    @Override
    public void writeItems(List<Object> items) throws Exception {
        for (Object item : items) {
            ValidatedCaseImportCommand command = (ValidatedCaseImportCommand) item;

            if (repository.isAlreadyProcessed(fileId, command.recordKey())) {
                continue;
            }

            repository.applyCaseStatusChange(command);
            repository.markProcessed(fileId, command.recordKey(), command.lineNumber());
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return null;
    }

    @Override
    public void close() {
        // no-op
    }
}
```

Critical invariant:

```text
applyCaseStatusChange and markProcessed must commit in the same chunk transaction.
```

---

## 25. Testing Strategy

### 25.1 Parser Tests

Test cases:

- normal record
- empty field
- missing field
- extra field
- quote escaping
- delimiter inside quote
- multi-line CSV field
- invalid date
- huge field
- BOM
- wrong encoding

### 25.2 Restart Tests

Simulate:

```text
process 1000 records
fail after writer commits chunk 5
restart job
verify records 1..2500 are not duplicated
verify job resumes from checkpoint
```

### 25.3 Idempotency Tests

Run same file twice.

Expected:

- second run rejected as duplicate, or
- second run completes as idempotent no-op based on governance rule

### 25.4 Partial File Tests

Create file without trailer/done marker.

Expected:

- job does not start, or
- validation step fails before business mutation

### 25.5 Corrupt Compression Tests

Expected:

- validation fails
- file quarantined
- no partial domain mutation

---

## 26. Observability

Metrics:

| Metric | Meaning |
|---|---|
| files_received_total | files detected |
| files_validated_total | files passing validation |
| files_failed_total | failed files |
| records_read_total | records read |
| records_processed_total | valid records processed |
| records_skipped_total | skipped invalid records |
| record_parse_failures_total | structural parse failures |
| file_processing_duration_seconds | end-to-end duration |
| chunk_duration_seconds | chunk latency |
| file_bytes_processed_total | throughput |
| current_file_lag_seconds | age of unprocessed file |

Logs must include:

```text
fileId
jobExecutionId
stepExecutionId
recordKey
lineNumber
sourceSystem
schemaVersion
correlationId
```

Audit must include:

- who/what initiated processing
- file metadata
- checksum
- manifest
- validation result
- processing window
- success/failure counts
- skipped records
- quarantine reason
- archive location

---

## 27. Production Failure Modes

| Failure | Symptom | Root Cause | Mitigation |
|---|---|---|---|
| Partial file processed | parse error near EOF or missing records | no done marker/manifest | landing/staging protocol |
| Duplicate file | duplicate rows or repeated side effects | identity only by file name | checksum + registry + idempotency |
| OOM | JVM crash/GC storm | load entire file | streaming reader |
| Restart duplicates rows | duplicate domain mutations | writer not idempotent | processed record table/unique key |
| Bad record kills whole file | job fails on one malformed row | no skip/quarantine model | exception classification |
| Error report huge memory | OOM during error handling | collect all errors in list | stream error report |
| XML XXE | unexpected file/network access | insecure XML parser | disable DTD/external entities |
| Zip slip | file overwrite outside staging | unsafe ZIP extraction | normalize path and validate prefix |
| Slow restart | re-skip millions of records | checkpoint by record count | split files/staging/indexing |
| Wrong characters | mojibake/corrupted names | encoding mismatch | explicit charset + contract |
| Multi-node duplicate processing | same file processed twice | no lock/registry | DB state transition with optimistic lock |

---

## 28. Design Checklist

Before production, answer these:

### File Contract

- [ ] Is the format specified?
- [ ] Is schema version specified?
- [ ] Is encoding specified?
- [ ] Is file naming specified?
- [ ] Is record count available?
- [ ] Is checksum available?
- [ ] Is partial file detection specified?

### Reader

- [ ] Does reader stream?
- [ ] Does reader checkpoint?
- [ ] Does restart resume correctly?
- [ ] Does reader close resources?
- [ ] Does reader handle BOM/encoding?
- [ ] Does reader avoid unbounded memory?

### Processor

- [ ] Are structural and business validations separated?
- [ ] Are exceptions classified?
- [ ] Are invalid records reportable?
- [ ] Is schema evolution handled?

### Writer

- [ ] Is writer idempotent?
- [ ] Are side effects transactional or outboxed?
- [ ] Are duplicate records safe?
- [ ] Are writes chunk-bounded?
- [ ] Are large payloads handled by reference/streaming?

### Operations

- [ ] Is there a file registry?
- [ ] Is there archive/quarantine?
- [ ] Is there error report?
- [ ] Are metrics available?
- [ ] Are audit records complete?
- [ ] Is reprocessing governed?
- [ ] Is duplicate launch prevented?

---

## 29. Practical Decision Matrix

| Input Type | Recommended Strategy |
|---|---|
| small trusted config file | simple parser acceptable |
| large CSV | streaming CSV parser + chunk reader |
| CSV with multiline quoted fields | real CSV parser, checkpoint by record number |
| fixed-width legacy file | byte/charset-aware parser |
| large XML | StAX/SAX streaming, avoid DOM |
| large JSON array | streaming JSON parser |
| huge event list | prefer NDJSON |
| compressed gzip | stream gzip, restart by re-skip or split upstream |
| zip with many files | validate entries, limits, zip slip prevention |
| binary payload | store by reference, hash, metadata table |
| high-value regulated import | manifest + checksum + registry + staging + audit |

---

## 30. Ringkasan

File batch processing bukan masalah parsing sederhana. Ia adalah kombinasi dari:

- external data contract
- file lifecycle state machine
- streaming parser
- checkpointed reader
- bounded chunk transaction
- idempotent writer
- error quarantine
- audit evidence
- operational control plane

Untuk CSV, XML, JSON, dan large payload, prinsip utamanya sama:

```text
never assume complete input
never load unbounded payload
never mutate without idempotency
never restart without checkpoint
never skip without evidence
never publish partial output
never treat file name as sufficient identity
```

Dalam Jakarta Batch, `ItemReader`, `ItemProcessor`, `ItemWriter`, checkpoint, skip/retry, listener, dan job repository memberi fondasi teknis. Namun kualitas production tetap bergantung pada desain kontrak file, idempotency, staging, observability, dan governance.

---

## 31. Latihan / Thought Experiment

### Latihan 1 — CSV Import Design

Kamu menerima file CSV 5 juta record dari external agency setiap malam. Requirement:

- file bisa mengandung 1% invalid records
- valid records harus tetap diproses
- invalid records harus dilaporkan
- job harus restartable
- duplicate file tidak boleh membuat duplicate mutation

Desain:

1. directory lifecycle
2. file registry table
3. checkpoint strategy
4. record identity
5. writer idempotency
6. error report
7. metrics

---

### Latihan 2 — XML Large File

External system mengirim satu XML 20 GB berisi `<case>` elements. Job sering gagal di tengah karena pod restart.

Pertanyaan:

1. Apa risiko DOM?
2. Bagaimana StAX reader bekerja?
3. Apa checkpoint yang digunakan?
4. Kenapa restart bisa lambat?
5. Apa alternatif arsitektur yang lebih baik?

---

### Latihan 3 — Export File Atomicity

Sistem harus menghasilkan file enforcement escalation harian untuk downstream. Downstream akan mengambil file begitu terlihat di folder.

Desain agar downstream tidak pernah membaca file setengah jadi.

Minimal jawab:

- temp file naming
- atomic publish
- manifest/done marker
- checksum
- retry behavior
- archive

---

## 32. Kapan Tidak Memakai File Batch

File batch bukan selalu pilihan terbaik.

Pertimbangkan alternatif jika:

| Kondisi | Alternatif |
|---|---|
| near-real-time required | messaging/event streaming |
| record-by-record acknowledgment needed | API/message queue |
| complex human approval workflow | workflow engine/BPMN |
| huge analytical data | data lake/table format |
| high-frequency small updates | event-driven integration |
| strong exactly-once cross-system need | transactional outbox/inbox + idempotent consumer |

Namun dalam enterprise/government/regulatory systems, file batch tetap umum karena:

- simple operational contract
- easy audit evidence
- disconnected systems
- legacy compatibility
- scheduled reconciliation
- bulk transfer efficiency

Maka tugas engineer bukan menghindari file batch sepenuhnya, tetapi membuatnya **safe, restartable, auditable, and boring in production**.

---

## 33. Penutup

Part ini menutup pembahasan file/payload batch dari sudut pandang production engineering. Kita sudah membahas CSV, fixed-width, XML, JSON, compressed files, large payload, checksum, manifest, staging, quarantine, archive, checkpoint, idempotency, error reporting, export atomicity, dan observability.

Part berikutnya akan membahas external API batch: ketika item batch bukan hanya dibaca dari file/database, tetapi juga harus memanggil sistem eksternal dengan rate limit, token, retry, idempotency key, outbox, circuit breaker, dan SLA-aware processing.

