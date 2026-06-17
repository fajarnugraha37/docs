# Part 026 — Large File Processing: Memory Safety, Streaming Pipeline, Pagination, Split, Merge, dan External Sort

> Seri: `learn-java-io-nio-networking-data-transfer`  
> Level: Advanced / production engineering  
> Fokus: memproses file besar secara aman, hemat memori, restartable, observable, dan tahan gagal.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan operasi file kecil, file sedang, dan file besar dari sisi memory, latency, throughput, dan failure risk.
2. Mendesain pipeline pemrosesan file besar yang **bounded-memory**, bukan pipeline yang diam-diam menumpuk semua data di heap.
3. Memilih kapan memakai `BufferedReader`, `InputStream`, `FileChannel`, `Files.lines`, batching, temporary file, atau chunking.
4. Membuat proses import/export yang bisa **di-restart**, bisa **resume**, bisa **audit**, dan tidak menghasilkan output setengah benar.
5. Memahami split, merge, pagination, checkpoint, dead-letter file, external sort, dan spill-to-disk sebagai pola engineering.
6. Menghindari anti-pattern seperti `readAllBytes()` untuk file besar, `readAllLines()` untuk data tidak terkontrol, unbounded queue, parallelism membabi buta, dan retry tanpa idempotency.
7. Membangun failure model untuk file besar: OOM, disk full, corrupt input, poison record, duplicate processing, partial output, timeout, dan backpressure collapse.

---

## 2. Masalah Besar: File Processing Bukan Cuma “Loop per Line”

Untuk file kecil, ini terlihat cukup:

```java
List<String> lines = Files.readAllLines(path);
for (String line : lines) {
    process(line);
}
```

Tetapi untuk file besar, pendekatan itu bisa gagal karena:

- seluruh isi file masuk ke heap;
- setiap line menjadi object `String`;
- list menyimpan reference ke semua line;
- GC pressure meningkat;
- file 2 GB bisa menjadi jauh lebih besar dari 2 GB di memori setelah decoding, object overhead, dan struktur koleksi;
- tidak ada checkpoint alami;
- jika gagal di 99%, proses harus mulai ulang dari awal;
- output mungkin sudah sebagian terbentuk;
- error record bisa menghentikan seluruh batch;
- observability buruk: sulit tahu progress, throughput, dan posisi gagal.

Large file processing harus dipikirkan sebagai **data pipeline**, bukan sekadar file read loop.

Mental model paling penting:

```text
large file processing = controlled flow of records/chunks through bounded stages
```

Pipeline yang benar mengontrol:

```text
source -> decode -> parse -> validate -> transform -> sink -> checkpoint -> publish
```

Dan setiap stage harus punya batas:

```text
bounded memory
bounded queue
bounded retry
bounded record size
bounded batch size
bounded concurrency
bounded output transaction
bounded failure scope
```

---

## 3. Definisi “File Besar” Itu Kontekstual

File besar bukan hanya berdasarkan ukuran byte. File bisa “besar” jika salah satu kondisi ini benar:

| Dimensi | Contoh | Risiko |
|---|---:|---|
| Ukuran byte besar | 10 GB CSV | OOM, lama, disk I/O tinggi |
| Jumlah record besar | 100 juta baris | CPU parse, indexing, DB load |
| Record sangat panjang | 1 line JSON 200 MB | buffer bloat, parser collapse |
| Format kompleks | XML nested besar | memory DOM explosion |
| Output besar | report 30 GB | partial write, disk full |
| SLA ketat | 5 GB harus selesai 3 menit | throughput bottleneck |
| Input tidak tepercaya | upload user | zip bomb, poison record, resource abuse |
| Harus restartable | nightly batch | checkpoint dan idempotency wajib |

Jadi pertanyaan yang lebih tepat bukan “berapa MB file-nya?”, tetapi:

```text
Berapa batas maksimum bytes, records, record length, runtime, memory, parallelism, dan failure recovery yang diterima sistem?
```

---

## 4. API Java yang Relevan

### 4.1 API load-all: nyaman, tetapi berbahaya untuk file besar

Beberapa API sengaja membaca semua isi file:

```java
Files.readAllBytes(path);
Files.readString(path);
Files.readAllLines(path);
```

API semacam ini cocok untuk konfigurasi kecil, template kecil, sample test, atau file yang ukurannya benar-benar dibatasi. Untuk input eksternal, batch besar, log, export, import, dan data transfer, jadikan API ini default **tidak boleh** kecuali ada invariant ukuran.

Dokumentasi Java sendiri menempatkan `Files.readString` sebagai API yang membaca seluruh content menjadi `String`, sedangkan `BufferedReader` dirancang untuk membaca text dengan buffering agar reading character, array, dan line lebih efisien.

### 4.2 API streaming text

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Cocok untuk:

- CSV sederhana;
- TSV;
- log line-based;
- NDJSON;
- fixed record text;
- manifest file;
- data export berbasis line.

Keterbatasan:

- `readLine()` menghapus line terminator;
- satu line yang sangat panjang tetap bisa membuat memory spike;
- tidak cocok untuk binary;
- tidak cocok untuk multiline logical record kecuali ada parser khusus;
- tidak punya checkpoint byte offset yang presisi untuk variable-width encoding jika hanya menyimpan nomor baris.

### 4.3 API streaming byte

```java
byte[] buffer = new byte[64 * 1024];
try (InputStream in = Files.newInputStream(path)) {
    int n;
    while ((n = in.read(buffer)) != -1) {
        processBytes(buffer, 0, n);
    }
}
```

Cocok untuk:

- copy;
- checksum;
- compression;
- encryption;
- binary protocol;
- chunk upload/download;
- file split berdasarkan ukuran byte.

### 4.4 `FileChannel`

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
    while (channel.read(buffer) != -1) {
        buffer.flip();
        process(buffer);
        buffer.clear();
    }
}
```

Cocok untuk:

- random access;
- positional read;
- `transferTo` / `transferFrom`;
- large copy;
- resumable transfer by offset;
- chunked processing by byte range;
- integration dengan `ByteBuffer` pipeline.

### 4.5 `Files.lines`

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    lines.forEach(this::process);
}
```

Kelebihan:

- lazy;
- idiom stream;
- compact.

Risiko:

- stream harus ditutup;
- exception muncul saat terminal operation;
- parallel stream tidak otomatis membuat file processing lebih benar;
- debugging lifecycle lebih sulit daripada loop eksplisit;
- backpressure dan batching sering lebih jelas dengan loop manual.

Untuk production ingestion besar, loop eksplisit biasanya lebih mudah dikontrol.

---

## 5. Prinsip Utama: Bounded Memory

### 5.1 Invariant

Pipeline file besar harus punya invariant:

```text
Memory usage tidak boleh tumbuh linear terhadap ukuran file.
```

Yang boleh tumbuh:

- jumlah record processed;
- output bytes;
- checkpoint offset;
- metrics counter.

Yang tidak boleh tumbuh tanpa batas:

- `List<Record>` seluruh file;
- `Map<Id, Record>` seluruh file tanpa limit;
- queue producer-consumer unbounded;
- error list seluruh record gagal;
- string builder seluruh output;
- in-memory sort seluruh dataset.

### 5.2 Contoh salah

```java
List<Order> orders = new ArrayList<>();
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        orders.add(parseOrder(line));
    }
}
saveAll(orders);
```

Masalah:

- semua record ditahan di heap;
- gagal di akhir berarti semua pekerjaan hilang;
- DB write bisa menjadi huge transaction;
- tidak ada checkpoint;
- GC bisa menjadi bottleneck.

### 5.3 Contoh lebih benar: batch bounded

```java
static final int BATCH_SIZE = 1_000;

void importOrders(Path path) throws IOException {
    List<Order> batch = new ArrayList<>(BATCH_SIZE);
    long lineNo = 0;

    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        while ((line = reader.readLine()) != null) {
            lineNo++;

            Order order = parseOrder(lineNo, line);
            batch.add(order);

            if (batch.size() == BATCH_SIZE) {
                saveBatch(batch);
                batch.clear();
            }
        }
    }

    if (!batch.isEmpty()) {
        saveBatch(batch);
    }
}
```

Memory sekarang dibatasi sekitar:

```text
BATCH_SIZE * average record object size + reader buffer + parser temporary allocation
```

Bukan:

```text
jumlah seluruh record * average record object size
```

---

## 6. Batch Size Bukan Angka Ajaib

Batch terlalu kecil:

- overhead DB/network tinggi;
- banyak commit;
- throughput rendah;
- logging/metrics terlalu noisy.

Batch terlalu besar:

- memory naik;
- transaction lama;
- lock lebih lama;
- retry mahal;
- gagal satu record bisa menggagalkan batch besar;
- latency checkpoint membesar.

Rule awal yang masuk akal:

| Workload | Batch Awal |
|---|---:|
| DB insert sederhana | 500–5.000 records |
| HTTP per batch | 100–1.000 records |
| File transform ringan | 1.000–50.000 records |
| Record besar/JSON kompleks | 50–500 records |
| Validasi berat | tergantung CPU dan memory |

Tapi angka final harus dari measurement.

Metric yang perlu dilihat:

```text
records/sec
bytes/sec
avg batch latency
p95 batch latency
heap used
GC pause
DB commit latency
error rate
retry count
output lag
```

---

## 7. Pipeline Streaming: Stage, Boundary, dan Backpressure

### 7.1 Pipeline sederhana synchronous

```text
read -> parse -> validate -> transform -> write
```

Kelebihan:

- mudah dipahami;
- ordering alami;
- memory kecil;
- error handling jelas;
- debugging mudah.

Kekurangan:

- satu stage lambat menahan semua;
- CPU dan I/O mungkin tidak optimal;
- tidak memanfaatkan parallelism.

Untuk banyak enterprise import/export, synchronous bounded pipeline sudah cukup dan lebih aman.

### 7.2 Pipeline producer-consumer bounded

```text
reader thread -> bounded queue -> worker pool -> bounded result queue -> writer thread
```

Gunakan hanya jika ada alasan:

- parsing CPU-heavy;
- validasi remote call butuh concurrency;
- transform mahal;
- I/O sink lambat tapi bisa batch;
- ordering tidak selalu wajib atau bisa direkonstruksi.

Bounded queue wajib.

```java
BlockingQueue<Record> queue = new ArrayBlockingQueue<>(10_000);
```

Hindari:

```java
BlockingQueue<Record> queue = new LinkedBlockingQueue<>(); // default capacity effectively unbounded
```

Unbounded queue sering menjadi OOM yang tertunda: reader cepat, worker lambat, queue tumbuh, heap habis.

### 7.3 Poison pill pattern

Untuk pipeline multi-thread, reader bisa memberi sinyal selesai:

```java
sealed interface Work permits DataWork, EndWork {}
record DataWork(long lineNo, String line) implements Work {}
record EndWork() implements Work {}
```

Tapi hati-hati:

- jumlah poison pill harus sesuai jumlah worker;
- exception worker harus dipropagasi;
- writer harus tahu kapan semua worker selesai;
- cancellation harus menghentikan reader juga.

Dalam banyak kasus, structured concurrency atau executor dengan explicit lifecycle lebih aman daripada ad-hoc thread.

---

## 8. Parsing Large Text File

### 8.1 Line-based processing

Line-based cocok jika logical record = physical line.

Contoh:

```text
order_id,customer_id,amount,currency
ORD-001,C-01,120000,IDR
ORD-002,C-02,450000,IDR
```

Loop:

```java
void processCsvLike(Path input) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(input, StandardCharsets.UTF_8)) {
        String header = reader.readLine();
        validateHeader(header);

        long lineNo = 1;
        String line;
        while ((line = reader.readLine()) != null) {
            lineNo++;
            processLine(lineNo, line);
        }
    }
}
```

### 8.2 CSV bukan selalu split koma

Anti-pattern:

```java
String[] columns = line.split(",");
```

Ini salah untuk CSV valid seperti:

```csv
id,name,note
1,"Doe, John","hello"
2,"Alice","line with ""quote"""
```

Untuk CSV production, gunakan parser CSV yang benar. Jika harus custom, minimal definisikan grammar:

```text
field = quoted-field | unquoted-field
quoted-field = " ... escaped quote ... "
record = fields separated by delimiter
```

Dan tentukan apakah multiline quoted field diizinkan. Jika iya, `readLine()` saja tidak cukup karena satu logical record bisa span beberapa physical line.

### 8.3 Record size limit

Setiap parser harus punya batas:

```text
max line length
max field length
max columns
max record bytes
max multiline span
```

Tanpa batas, satu record jahat bisa membuat memory meledak.

Contoh defensive line length:

```java
final int MAX_LINE_CHARS = 1_000_000;

void processLine(long lineNo, String line) {
    if (line.length() > MAX_LINE_CHARS) {
        throw new IllegalArgumentException("Line too large at " + lineNo);
    }
    // parse safely
}
```

Untuk batas byte yang lebih presisi, lakukan di level byte stream/parser.

---

## 9. Checkpoint dan Restartability

### 9.1 Kenapa checkpoint penting

Jika file 100 GB gagal setelah 7 jam, sistem yang baik tidak memulai dari nol kecuali memang tidak ada pilihan.

Checkpoint menjawab:

```text
Sampai mana input sudah aman diproses?
Apa output yang sudah committed?
Apakah batch terakhir aman diulang?
```

### 9.2 Jenis checkpoint

| Checkpoint | Cocok untuk | Catatan |
|---|---|---|
| Line number | Text line-based | Mudah, tetapi resume harus skip line dari awal |
| Byte offset | Binary/fixed/text tertentu | Lebih cepat resume, tapi hati-hati encoding/record boundary |
| Record key | Data punya ID unik | Bagus untuk idempotency |
| Batch number | Chunk/batch transfer | Cocok untuk manifest |
| Output marker | Sink transactional | Perlu sink mendukung dedup/upsert |

### 9.3 Checkpoint harus setelah commit

Salah:

```text
read batch -> update checkpoint -> write DB
```

Jika process mati setelah checkpoint tapi sebelum write DB, data hilang secara logical.

Benar:

```text
read batch -> write DB idempotently -> commit DB -> update checkpoint
```

Atau lebih kuat:

```text
read batch -> write DB + checkpoint dalam transaction yang sama
```

Jika sink dan checkpoint store berbeda, kamu butuh desain idempotent dan reconciliation.

### 9.4 Contoh checkpoint file sederhana

```java
record Checkpoint(long lineNo, long recordsCommitted) {}

void saveCheckpoint(Path checkpointPath, Checkpoint checkpoint) throws IOException {
    Path tmp = checkpointPath.resolveSibling(checkpointPath.getFileName() + ".tmp");
    String content = checkpoint.lineNo() + "," + checkpoint.recordsCommitted() + "\n";

    Files.writeString(tmp, content, StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE);

    Files.move(tmp, checkpointPath,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);
}
```

Untuk durability tinggi, tambahkan `FileChannel.force(true)` seperti dibahas di Part 014.

---

## 10. Idempotency untuk File Import

Checkpoint saja tidak cukup. Restart setelah crash bisa mengulang batch terakhir.

Karena itu sink harus idempotent.

Contoh strategi:

```text
input_file_id + record_number
input_file_id + business_key
transfer_id + chunk_index
job_id + output_partition
```

DB table bisa punya unique constraint:

```sql
unique(input_file_id, line_no)
```

atau:

```sql
unique(source_system, source_record_id)
```

Dengan begitu, retry tidak membuat duplicate.

Pseudo-flow:

```text
for each batch:
  parse records
  insert using unique key / upsert / ignore duplicate
  commit
  checkpoint latest committed line
```

Jangan mengandalkan “process tidak akan retry”. Pada file besar, retry bukan edge case; retry adalah bagian normal dari reliability.

---

## 11. Poison Record dan Dead-Letter File

### 11.1 Poison record

Poison record adalah record yang selalu gagal diproses walau retry:

- format rusak;
- required field kosong;
- value tidak valid;
- date invalid;
- reference tidak ditemukan;
- field terlalu panjang;
- encoding rusak;
- business rule violation.

Jika satu poison record menghentikan seluruh file, batch besar menjadi rapuh.

### 11.2 Strategi error

| Strategi | Cocok untuk | Risiko |
|---|---|---|
| fail-fast | data harus 100% valid | satu record menghentikan semua |
| skip invalid | import best-effort | perlu audit kuat |
| dead-letter file | batch operational | perlu reprocess path |
| quarantine file | input mencurigakan | operator manual |
| threshold failure | toleransi error terbatas | perlu rule jelas |

### 11.3 Dead-letter file format

Dead-letter jangan hanya menyimpan raw line. Simpan konteks:

```json
{
  "inputFileId": "orders-2026-06-16",
  "lineNo": 98231,
  "errorCode": "INVALID_AMOUNT",
  "message": "Amount must be positive",
  "rawRecord": "ORD-123,C-01,-50,IDR"
}
```

Untuk keamanan, raw record bisa mengandung PII. Maka perlu:

- masking;
- encryption;
- restricted access;
- retention policy;
- audit access.

### 11.4 Threshold

Contoh:

```text
max_error_records = 10_000
max_error_ratio = 1%
fail immediately for structural/header error
continue for row-level validation error
```

Dengan ini, pipeline tidak diam-diam menghasilkan data buruk dalam jumlah besar.

---

## 12. Split File

### 12.1 Kenapa split?

Split dipakai untuk:

- parallel processing;
- transfer resumable;
- upload chunked;
- reduce failure scope;
- distribute workload;
- fit batch window;
- avoid huge transaction.

### 12.2 Split by byte

Cocok untuk binary atau file yang record boundary tidak penting.

```text
part-0000: bytes 0..99MB
part-0001: bytes 100MB..199MB
```

Risiko untuk text:

- bisa memotong UTF-8 di tengah sequence;
- bisa memotong logical line;
- bisa memotong CSV quoted multiline record.

### 12.3 Split by record boundary

Lebih aman untuk text.

```text
part-0000: lines 1..1,000,000
part-0001: lines 1,000,001..2,000,000
```

Tapi jika header perlu ada di setiap part, tambahkan secara eksplisit.

### 12.4 Split manifest

Setiap split harus punya manifest:

```json
{
  "inputFile": "orders.csv",
  "inputSizeBytes": 9876543210,
  "parts": [
    {
      "index": 0,
      "path": "orders.part-0000.csv",
      "firstLine": 2,
      "lastLine": 1000001,
      "recordCount": 1000000,
      "sha256": "..."
    }
  ]
}
```

Manifest membantu:

- verification;
- resume;
- audit;
- parallel scheduling;
- reprocessing only failed part.

---

## 13. Merge File

Merge terlihat mudah:

```text
cat part-* > output
```

Tetapi production merge harus menjawab:

- Apakah order penting?
- Apakah header hanya sekali?
- Apakah newline antar part aman?
- Apakah part lengkap?
- Apakah checksum benar?
- Apakah duplicate part mungkin?
- Apakah merge atomic?
- Apakah output final dipublish setelah verified?

Pattern aman:

```text
1. validate all parts exist
2. validate part checksum
3. write to temporary output
4. stream-copy parts in manifest order
5. compute final checksum
6. fsync output if required
7. atomic move to final name
8. publish manifest/result
```

Contoh merge byte stream:

```java
void mergeParts(List<Path> parts, Path output) throws IOException {
    Path tmp = output.resolveSibling(output.getFileName() + ".tmp");

    try (OutputStream out = new BufferedOutputStream(Files.newOutputStream(tmp,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE))) {
        byte[] buffer = new byte[1024 * 1024];

        for (Path part : parts) {
            try (InputStream in = new BufferedInputStream(Files.newInputStream(part))) {
                int n;
                while ((n = in.read(buffer)) != -1) {
                    out.write(buffer, 0, n);
                }
            }
        }
    }

    Files.move(tmp, output,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);
}
```

---

## 14. External Sort

### 14.1 Kenapa external sort?

Sorting seluruh file besar di memori tidak scalable.

Anti-pattern:

```java
List<Record> records = readAllRecords(path);
records.sort(comparator);
write(records);
```

External sort memecah sort menjadi dua fase:

```text
Phase 1: read bounded chunk -> sort in memory -> write sorted run
Phase 2: k-way merge sorted runs -> final sorted output
```

### 14.2 External sort flow

```text
input.csv
  -> chunk 1 -> sort -> run-0001.tmp
  -> chunk 2 -> sort -> run-0002.tmp
  -> chunk 3 -> sort -> run-0003.tmp

run-0001.tmp + run-0002.tmp + run-0003.tmp
  -> priority queue merge
  -> output.sorted.csv.tmp
  -> atomic move
  -> output.sorted.csv
```

### 14.3 Chunk size

Chunk size harus berdasarkan memory budget.

Misal:

```text
heap budget for sort = 512 MB
avg record object = 512 bytes
safe chunk records = 512MB / 512B * safetyFactor(0.5)
                   ≈ 500,000 records
```

Tapi object overhead Java sering besar. Jangan percaya estimasi kasar tanpa measurement.

### 14.4 K-way merge

Setiap run dibaca sedikit demi sedikit. Priority queue hanya menyimpan satu current record per run.

Memory roughly:

```text
number_of_runs * current_record_size + reader_buffers + output_buffer
```

Bukan seluruh dataset.

### 14.5 File descriptor limit

Jika run ada 10.000, jangan buka semua reader sekaligus.

Solusi:

- merge bertingkat;
- fan-in 32/64/128 run per merge;
- cleanup intermediate run;
- monitor open file descriptor.

---

## 15. Pagination: File Processing vs Data Source Processing

Kadang large file bukan input utama, tetapi output dari DB/API.

Contoh export:

```text
DB rows -> CSV file
```

Jangan lakukan:

```java
List<Row> rows = repository.findAll();
writeCsv(rows);
```

Gunakan pagination atau cursor.

### 15.1 Offset pagination

```sql
select * from orders order by id limit 1000 offset 1000000
```

Masalah:

- offset besar makin mahal;
- data berubah bisa menyebabkan skip/duplicate;
- ordering harus stabil.

### 15.2 Keyset pagination

```sql
select * from orders
where id > :lastId
order by id
limit :batchSize
```

Lebih baik untuk large export jika ada key monotonik/stabil.

### 15.3 Snapshot consistency

Pertanyaan penting:

```text
Apakah export harus merepresentasikan snapshot pada satu waktu?
```

Jika iya, perlu:

- transaction isolation;
- export watermark;
- `created_at <= cutoff`;
- consistent snapshot;
- version column;
- materialized staging.

Jika tidak, export bisa mengandung data campuran dari beberapa waktu.

---

## 16. Output Besar: Jangan Bangun String Besar

Anti-pattern:

```java
StringBuilder sb = new StringBuilder();
for (Record r : records) {
    sb.append(toCsv(r)).append('\n');
}
Files.writeString(output, sb.toString());
```

Untuk output besar, tulis streaming:

```java
try (BufferedWriter writer = Files.newBufferedWriter(output, StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE)) {
    for (Record record : records) {
        writeCsvRecord(writer, record);
        writer.newLine();
    }
}
```

Untuk export dari DB:

```java
try (BufferedWriter writer = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
    writer.write("id,amount,currency");
    writer.newLine();

    long lastId = 0;
    while (true) {
        List<Order> batch = fetchNextBatch(lastId, 5_000);
        if (batch.isEmpty()) break;

        for (Order order : batch) {
            writeOrderCsv(writer, order);
            writer.newLine();
            lastId = order.id();
        }
    }
}
```

---

## 17. Temporary Workspace dan Cleanup

Large file processing biasanya butuh temporary workspace:

```text
/work/jobs/{jobId}/
  input/
  parts/
  runs/
  output.tmp
  output.manifest.tmp
  checkpoint.json
  dead-letter.ndjson
  logs/
```

Prinsip:

- setiap job punya directory sendiri;
- nama file deterministic;
- temporary output tidak langsung terlihat sebagai final;
- cleanup harus aman dan idempotent;
- jangan hapus bukti audit terlalu cepat;
- gunakan retention policy;
- bedakan `FAILED`, `COMPLETED`, `CANCELLED`, `EXPIRED`.

State job:

```text
RECEIVED
VALIDATING
SPLITTING
PROCESSING
MERGING
VERIFYING
PUBLISHING
COMPLETED
FAILED
CANCELLED
```

State machine lebih aman daripada boolean `processed=true/false`.

---

## 18. Disk Full dan Space Budget

Large file pipeline bisa gagal bukan karena Java code salah, tetapi karena disk penuh.

Sebelum mulai, estimasi space:

```text
input size
+ temporary split parts
+ sorted runs
+ output tmp
+ output final
+ dead-letter
+ checkpoint/log overhead
```

Worst case external sort bisa butuh beberapa kali ukuran input, tergantung desain cleanup.

Gunakan `FileStore` untuk membaca kapasitas filesystem:

```java
FileStore store = Files.getFileStore(workspace);
long usable = store.getUsableSpace();
```

Tetapi kapasitas bisa berubah oleh process lain. Jadi ini hanya pre-check, bukan guarantee.

Handling disk full:

- fail dengan error jelas;
- jangan publish output partial;
- simpan checkpoint terakhir;
- cleanup temporary yang aman;
- expose metric dan alert;
- jangan retry agresif tanpa menunggu space tersedia.

---

## 19. Observability untuk File Besar

Tanpa observability, operator hanya tahu “job masih jalan” atau “job gagal”. Itu tidak cukup.

Metric minimal:

```text
input_bytes_total
input_bytes_processed
records_total_estimated
records_processed
records_failed
records_skipped
batches_committed
bytes_per_second
records_per_second
current_line_no
current_byte_offset
last_checkpoint_age_seconds
dead_letter_count
retry_count
processing_lag_seconds
heap_used
queue_depth
worker_active_count
output_bytes_written
```

Log event penting:

```text
job_started
input_validated
checkpoint_loaded
batch_committed
checkpoint_saved
poison_record_detected
threshold_exceeded
split_created
merge_started
checksum_verified
output_published
job_completed
job_failed
```

Setiap log harus punya correlation fields:

```text
jobId
inputFileId
partIndex
batchNo
lineNo / offset
attempt
```

---

## 20. Testing Large File Processing

Testing tidak cukup dengan file 10 baris.

Test matrix:

| Test | Tujuan |
|---|---|
| empty file | header/empty behavior |
| only header | no data behavior |
| huge valid file | memory stability |
| very long line | max record defense |
| invalid encoding | charset handling |
| malformed CSV | parser robustness |
| poison record | DLQ behavior |
| many invalid records | threshold behavior |
| crash mid-batch | checkpoint correctness |
| duplicate retry | idempotency |
| disk full simulation | partial output safety |
| permission denied | operational error clarity |
| concurrent job same input | locking/idempotency |
| output already exists | replacement policy |
| slow sink | backpressure |
| worker failure | cancellation/propagation |

Use generated data, not committed huge files.

Example generator:

```java
void generateCsv(Path path, int rows) throws IOException {
    try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
        writer.write("id,amount,currency");
        writer.newLine();
        for (int i = 1; i <= rows; i++) {
            writer.write("ORD-" + i + "," + (i * 10) + ",IDR");
            writer.newLine();
        }
    }
}
```

---

## 21. Production Pattern: Restartable CSV Import

### 21.1 Requirements

```text
Input: CSV file up to 50 GB
Record count: up to 200 million
Must skip row-level validation errors into dead-letter
Must fail if invalid ratio > 1%
Must resume after crash
Must avoid duplicate DB insert
Must expose progress
Must not load entire file into memory
```

### 21.2 Design

```text
1. Receive file into staging directory
2. Assign inputFileId
3. Validate file-level metadata/header
4. Load checkpoint if exists
5. Stream line-by-line
6. Skip lines <= checkpoint.lineNo
7. Parse and validate per record
8. Accumulate valid records into bounded batch
9. Write invalid records to dead-letter
10. Insert valid batch idempotently
11. Commit batch
12. Save checkpoint after commit
13. At EOF, verify thresholds
14. Publish completion manifest
15. Atomic mark job COMPLETED
```

### 21.3 Pseudo-code

```java
void runImport(Job job) throws IOException {
    Checkpoint checkpoint = checkpointStore.load(job.id()).orElse(Checkpoint.initial());
    ImportStats stats = new ImportStats();
    List<OrderRecord> batch = new ArrayList<>(job.batchSize());

    try (BufferedReader reader = Files.newBufferedReader(job.inputPath(), StandardCharsets.UTF_8);
         BufferedWriter dlq = Files.newBufferedWriter(job.deadLetterPath(), StandardCharsets.UTF_8,
                 StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {

        String header = reader.readLine();
        validateHeader(header);

        long lineNo = 1;
        String line;
        while ((line = reader.readLine()) != null) {
            lineNo++;

            if (lineNo <= checkpoint.lineNo()) {
                continue;
            }

            try {
                OrderRecord record = parseAndValidate(job.inputFileId(), lineNo, line);
                batch.add(record);
            } catch (ValidationException e) {
                writeDeadLetter(dlq, job, lineNo, line, e);
                stats.failed++;
                if (stats.failed > job.maxErrorRecords()) {
                    throw new TooManyInvalidRecordsException(stats.failed);
                }
            }

            if (batch.size() == job.batchSize()) {
                repository.insertIdempotently(batch);
                checkpointStore.save(job.id(), new Checkpoint(lineNo, stats.processed + batch.size()));
                stats.processed += batch.size();
                batch.clear();
                metrics.report(job, lineNo, stats);
            }
        }

        if (!batch.isEmpty()) {
            repository.insertIdempotently(batch);
            checkpointStore.save(job.id(), new Checkpoint(lineNo, stats.processed + batch.size()));
            stats.processed += batch.size();
            batch.clear();
        }
    }

    verifyErrorRatio(stats, job);
    publishCompletionManifest(job, stats);
}
```

Catatan penting:

- `insertIdempotently` wajib benar; checkpoint bisa menyebabkan batch terakhir diulang.
- Dead-letter write juga sebaiknya idempotent atau mengikuti checkpoint semantics.
- Jika dead-letter harus transactional bersama DB, simpan error record di DB dulu lalu export belakangan.
- Jika `lineNo <= checkpoint.lineNo()` skip dari awal terlalu lambat untuk file sangat besar, gunakan split/checkpoint per part atau byte offset.

---

## 22. Production Pattern: Large Export to File

### 22.1 Requirements

```text
Export 100 juta order ke CSV
Tidak boleh OOM
Harus consistent berdasarkan cutoff time
Output tidak boleh terlihat sebelum lengkap
Harus bisa retry job
Harus punya checksum dan manifest
```

### 22.2 Design

```text
1. Determine cutoffTime
2. Create jobId and output temp path
3. Open BufferedWriter to output.tmp
4. Write header
5. Fetch records by keyset pagination where updated_at <= cutoffTime
6. Write each page to file
7. Periodically checkpoint lastId and count
8. Close writer
9. Compute checksum
10. Write manifest.tmp
11. Atomic move output.tmp -> output.csv
12. Atomic move manifest.tmp -> manifest.json
13. Mark job completed
```

### 22.3 Key invariant

```text
A consumer must never see partial final output.
```

Karena itu gunakan:

```text
output.csv.tmp -> output.csv
manifest.json.tmp -> manifest.json
```

Dan publish final manifest setelah file final tersedia.

---

## 23. Performance Model

Large file processing bottleneck bisa berada di:

```text
disk read
charset decoding
parser CPU
validation CPU
remote lookup
DB write
compression
checksum
network upload
logging
GC allocation
lock contention
```

Jangan menebak. Ukur per stage.

Sederhana tapi efektif:

```java
long start = System.nanoTime();
long records = 0;
long bytes = 0;

// periodically
long elapsedNanos = System.nanoTime() - start;
double seconds = elapsedNanos / 1_000_000_000.0;
System.out.printf("records/sec=%.2f bytes/sec=%.2f%n", records / seconds, bytes / seconds);
```

Untuk production, kirim ke metrics system, bukan `printf`.

---

## 24. Anti-Pattern

### 24.1 Load-all untuk input tidak terbatas

```java
byte[] bytes = Files.readAllBytes(uploadedFile);
```

Masalah: OOM dan resource exhaustion.

### 24.2 `readAllLines` untuk batch besar

```java
List<String> lines = Files.readAllLines(path);
```

Masalah: semua line jadi object dan disimpan.

### 24.3 Unbounded queue

```java
new LinkedBlockingQueue<>();
```

Masalah: backpressure hilang, heap menjadi buffer tak terbatas.

### 24.4 StringBuilder untuk output besar

```java
StringBuilder all = new StringBuilder();
```

Masalah: output tumbuh di heap.

### 24.5 Parallel stream tanpa model failure

```java
Files.lines(path).parallel().forEach(this::process);
```

Masalah:

- lifecycle stream;
- ordering;
- exception propagation;
- sink thread-safety;
- checkpoint sulit;
- backpressure tidak eksplisit.

### 24.6 Retry tanpa idempotency

```text
batch failed -> retry insert -> duplicate rows
```

Retry tanpa idempotency bisa memperburuk data corruption.

### 24.7 Final file ditulis langsung

```java
Files.newBufferedWriter(finalPath)
```

Jika process mati, consumer bisa membaca file setengah jadi.

Gunakan temp + atomic move.

---

## 25. Decision Matrix

| Kebutuhan | Pilihan Awal |
|---|---|
| Baca text line-by-line | `BufferedReader` |
| Baca file kecil config | `Files.readString` dengan size invariant |
| Baca binary besar | `InputStream` + byte buffer atau `FileChannel` |
| Copy file besar | `Files.copy` atau `FileChannel.transferTo/From` |
| Resume by byte offset | `FileChannel` positional read |
| Import CSV besar | streaming reader + batch + checkpoint |
| Export DB besar | keyset pagination + streaming writer |
| Sort file besar | external sort |
| Parallel processing | split by record boundary + per-part checkpoint |
| Need exact once effect | idempotency + dedup + reconciliation, not blind retry |
| Consumer must not see partial output | temp file + atomic move + manifest |
| Error row should not stop all | dead-letter + threshold |

---

## 26. Checklist Engineering

Sebelum implement large file processing, jawab:

### Input

- Berapa max file size?
- Berapa max record count?
- Berapa max line/record length?
- Charset apa?
- Format grammar jelas?
- Header wajib?
- Duplicate record boleh?
- Input trusted atau untrusted?

### Processing

- Memory bounded?
- Batch size berapa?
- Queue bounded?
- Concurrency berapa?
- Ordering penting?
- Parser bisa handle malformed input?
- Ada poison record strategy?

### Reliability

- Checkpoint berdasarkan apa?
- Checkpoint disimpan kapan?
- Sink idempotent?
- Retry aman?
- Crash mid-batch bagaimana?
- Output partial dicegah?
- Cleanup idempotent?

### Output

- Output temp dulu?
- Atomic publish?
- Checksum ada?
- Manifest ada?
- Consumer tahu kapan lengkap?
- Compression perlu?
- Encryption perlu?

### Operations

- Progress metric ada?
- DLQ accessible dan aman?
- Alert jika stuck?
- Disk space cukup?
- Runbook ada?
- Bisa reprocess part tertentu?
- Bisa audit source-to-output?

---

## 27. Latihan

### Latihan 1 — Streaming Import

Buat importer CSV yang:

- membaca line-by-line;
- batch insert setiap 1.000 record;
- menulis invalid row ke dead-letter NDJSON;
- menyimpan checkpoint line number;
- bisa resume setelah crash;
- menolak file jika error ratio > 1%.

### Latihan 2 — Large Export

Buat exporter yang:

- membaca data dari repository dengan keyset pagination;
- menulis CSV ke file temporary;
- menghitung SHA-256;
- menulis manifest;
- atomic move output final;
- tidak menggunakan `StringBuilder` untuk seluruh output.

### Latihan 3 — External Sort

Buat external sort sederhana:

- input: file CSV besar dengan kolom `customer_id`;
- chunk: 100.000 record;
- sort tiap chunk;
- tulis sorted run;
- k-way merge;
- output final sorted;
- cleanup run sementara.

### Latihan 4 — Failure Injection

Simulasikan:

- exception setelah batch commit sebelum checkpoint;
- exception setelah checkpoint sebelum next read;
- disk full saat output;
- poison record di tengah file;
- duplicate retry.

Jelaskan invariant yang membuat hasil tetap benar.

---

## 28. Ringkasan

Large file processing yang matang bukan tentang memilih API paling canggih. Intinya adalah mengontrol flow data agar memory, failure, output, dan operasi tetap bounded.

Prinsip utama:

1. Jangan load seluruh file kecuali ukuran benar-benar kecil dan dibatasi.
2. Gunakan streaming read/write.
3. Gunakan batching, bukan all-in-memory.
4. Pastikan batch commit dan checkpoint punya urutan yang benar.
5. Sink harus idempotent karena retry dan crash adalah kondisi normal.
6. Pisahkan file final dan temporary output.
7. Gunakan checksum dan manifest untuk transfer/export penting.
8. Poison record perlu strategi: fail-fast, dead-letter, threshold, atau quarantine.
9. Split/merge dan external sort harus menjaga boundary, order, checksum, dan cleanup.
10. Observability adalah bagian dari desain, bukan tambahan belakangan.

Mental model akhir:

```text
Large file processing is not file reading.
It is bounded, restartable, observable, failure-aware dataflow.
```

---

## 29. Referensi Utama

- Java SE 25 API — `java.nio.file.Files`
- Java SE 25 API — `java.io.BufferedReader`
- Java SE 24/25 API — `java.nio.channels.FileChannel`
- Java SE API — `java.nio.file.Path`, `FileStore`, `StandardOpenOption`, `StandardCopyOption`
- Java SE API — `InputStream`, `OutputStream`, `Reader`, `Writer`
- Materi seri sebelumnya:
  - Part 003 — Buffering
  - Part 005 — Character I/O
  - Part 009 — FileChannel
  - Part 014 — Atomic File Write
  - Part 025 — Data Transfer Reliability

---

## Status Seri

Seri **belum selesai**.

Part yang sedang diselesaikan: **Part 026**.  
Part berikutnya: **Part 027 — Performance Engineering for I/O: Syscall, Page Cache, GC, Direct Memory, Benchmark, dan Profiling**.
