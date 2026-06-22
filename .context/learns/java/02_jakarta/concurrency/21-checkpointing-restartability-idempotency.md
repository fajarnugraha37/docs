# Part 21 — Checkpointing, Restartability, and Idempotency

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `21-checkpointing-restartability-idempotency.md`  
> Scope: Java 8–25, Java EE/Jakarta EE Batch, `javax.batch` → `jakarta.batch`, Jakarta Batch 2.1 baseline  
> Fokus: memahami checkpoint, restart, idempotency, dan desain batch yang aman ketika gagal di tengah jalan.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami **checkpoint** bukan sebagai detail teknis kecil, tetapi sebagai kontrak recovery batch.
2. Membedakan:
   - retry,
   - restart,
   - resume,
   - rerun,
   - reprocess,
   - compensation.
3. Mendesain `ItemReader`, `ItemProcessor`, dan `ItemWriter` yang aman terhadap failure.
4. Menentukan informasi apa yang harus masuk ke `checkpointInfo()`.
5. Menghindari duplicate side effect ketika job gagal setelah sebagian data sudah tertulis.
6. Mendesain writer idempotent untuk database, file, message queue, external API, dan document generation.
7. Membuat batch yang bisa dihentikan, direstart, diaudit, dan dibuktikan kebenarannya.
8. Membangun mental model top-tier: **batch correctness lebih penting daripada batch speed**.

---

## 2. Problem yang Diselesaikan

Batch job jarang gagal di titik yang nyaman.

Ia bisa gagal:

- setelah membaca item tetapi sebelum menulis,
- setelah memproses item tetapi sebelum commit,
- setelah menulis ke database tetapi sebelum checkpoint tersimpan,
- setelah memanggil external API tetapi sebelum status lokal diperbarui,
- setelah menghasilkan file tetapi sebelum metadata output dicatat,
- setelah mengirim email tetapi sebelum job repository mencatat step selesai,
- ketika pod/container dibunuh,
- ketika database failover,
- ketika job distop operator,
- ketika deploy terjadi di tengah batch,
- ketika record tertentu poison dan selalu membuat job gagal.

Pertanyaan utama bukan:

> Bagaimana batch ini berjalan ketika semua normal?

Pertanyaan yang lebih penting:

> Ketika batch gagal di titik mana pun, apakah restart menghasilkan state akhir yang benar, tidak duplicate, tidak corrupt, dan bisa diaudit?

Di sinilah checkpointing, restartability, dan idempotency menjadi inti.

---

## 3. Baseline Spesifikasi dan API

Jakarta Batch 2.1 adalah baseline stabil di Jakarta EE 11. Spesifikasi ini mendefinisikan model job, step, batchlet, chunk, checkpoint, restart, job repository, dan `JobOperator`. `JobOperator` menyediakan operasi untuk start, stop, restart, dan inspeksi riwayat job execution. API `ItemReader` mendefinisikan `open(Serializable checkpoint)` dan `checkpointInfo()`; checkpoint yang dikembalikan reader dipakai runtime untuk melanjutkan pembacaan ketika restart.  

Referensi resmi:

- Jakarta Batch 2.1 Specification: <https://jakarta.ee/specifications/batch/2.1/jakarta-batch-spec-2.1>
- Jakarta Batch 2.1 API: <https://jakarta.ee/specifications/batch/2.1/apidocs/>
- `ItemReader`: <https://jakarta.ee/specifications/batch/2.1/apidocs/jakarta.batch/jakarta/batch/api/chunk/itemreader>
- `JobOperator`: <https://jakarta.ee/specifications/batch/2.1/apidocs/jakarta.batch/jakarta/batch/operations/joboperator>

Untuk namespace lama:

- Java EE/Jakarta EE lama memakai `javax.batch.*`.
- Jakarta EE modern memakai `jakarta.batch.*`.

Secara konsep, banyak prinsip checkpoint/restart sama, tetapi package name dan versi runtime berubah.

---

## 4. Mental Model Utama

### 4.1 Batch adalah state machine, bukan loop

Developer sering melihat batch sebagai loop:

```java
for (Record record : records) {
    process(record);
    write(record);
}
```

Tetapi production batch yang benar lebih dekat ke state machine:

```text
STARTING
  -> READING
  -> PROCESSING
  -> WRITING
  -> CHECKPOINTING
  -> COMMITTING
  -> COMPLETED
  -> FAILED
  -> STOPPED
  -> RESTARTING
```

Setiap transisi punya risiko failure.

Checkpoint adalah cara runtime dan aplikasi bersepakat:

> “Sampai titik ini, progress dianggap aman untuk dilanjutkan jika job dimulai ulang.”

---

### 4.2 Checkpoint bukan sekadar posisi baca

Untuk job sederhana, checkpoint bisa berupa nomor baris file.

Tetapi untuk job enterprise, checkpoint bisa mencakup:

- last processed primary key,
- cursor page key,
- file offset,
- partition id,
- tenant id,
- batch window,
- last emitted sequence,
- output file part number,
- last external id yang aman,
- watermark waktu,
- hash input manifest,
- version schema checkpoint.

Checkpoint bukan “apa item terakhir yang saya lihat”.

Checkpoint adalah:

> Minimal durable state yang dibutuhkan untuk melanjutkan pekerjaan tanpa kehilangan item, menduplikasi side effect berbahaya, atau melanggar ordering/invariant bisnis.

---

### 4.3 Restart bukan retry

Ini sangat penting.

| Konsep | Arti | Scope | State Awal |
|---|---|---:|---|
| Retry | Coba ulang operasi yang sama | kecil: item/API call/chunk | state runtime saat ini |
| Restart | Jalankan ulang job execution dari persisted checkpoint | besar: job/step | job repository + checkpoint |
| Rerun | Jalankan job baru dari awal | besar | parameter baru/lama, tanpa resume state |
| Reprocess | Proses ulang data yang pernah diproses | bisnis | butuh idempotency/compensation |
| Compensation | Membalikkan/menetralkan side effect | bisnis | berdasarkan audit/ledger |

Retry menjawab:

> “Operasi ini gagal sementara, bisa saya coba lagi?”

Restart menjawab:

> “Job mati. Dari titik mana saya bisa lanjut secara benar?”

Idempotency menjawab:

> “Kalau operasi yang sama terjadi lebih dari sekali, apakah state akhir tetap benar?”

---

### 4.4 Checkpoint membatasi blast radius

Tanpa checkpoint, failure di item ke-900.000 dari 1.000.000 mungkin memaksa job mengulang dari awal.

Dengan checkpoint per 1.000 item, failure biasanya hanya mengulang maksimal sekitar satu chunk atau interval yang belum dianggap aman.

Tetapi checkpoint terlalu sering juga mahal:

- lebih banyak commit,
- lebih banyak write ke job repository,
- lebih banyak overhead transaction,
- lebih rendah throughput.

Checkpoint terlalu jarang juga berisiko:

- banyak pekerjaan ulang,
- recovery lama,
- duplicate side effect lebih besar,
- operator sulit memperkirakan progress.

Top-tier engineer melihat checkpoint sebagai trade-off antara:

```text
throughput
recovery cost
side effect risk
job repository overhead
transaction cost
business tolerance terhadap duplicate/reprocess
```

---

## 5. Chunk Processing dan Checkpoint Boundary

Dalam chunk-oriented step, runtime melakukan siklus konseptual seperti ini:

```text
open reader with last checkpoint
open writer with last checkpoint

while not end:
    begin transaction-ish boundary

    repeat until commit interval / checkpoint policy:
        item = reader.readItem()
        processed = processor.processItem(item)
        collect processed item

    writer.writeItems(items)
    checkpoint = reader.checkpointInfo()
    persist checkpoint / step state
    commit boundary

close reader/writer
```

Implementasi detail bisa bervariasi antar runtime, tetapi mental modelnya stabil:

1. Reader dibuka dengan checkpoint terakhir.
2. Reader membaca item.
3. Processor mengubah/validasi/filter item.
4. Writer menulis kumpulan item.
5. Runtime mengambil checkpoint info.
6. Runtime menyimpan state agar restart bisa melanjutkan.

Checkpoint biasanya terkait commit interval.

Contoh JSL sederhana:

```xml
<job id="case-ageing-recalculation" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="recalculate-ageing">
        <chunk item-count="500">
            <reader ref="caseAgeingReader"/>
            <processor ref="caseAgeingProcessor"/>
            <writer ref="caseAgeingWriter"/>
        </chunk>
    </step>
</job>
```

`item-count="500"` berarti checkpoint/commit boundary secara konseptual terjadi setiap 500 item, kecuali ada end-of-data atau kondisi khusus.

---

## 6. Anatomy `ItemReader` yang Restartable

### 6.1 Kontrak dasar `ItemReader`

API `ItemReader` memiliki metode utama:

```java
public interface ItemReader {
    void open(Serializable checkpoint) throws Exception;
    void close() throws Exception;
    Object readItem() throws Exception;
    Serializable checkpointInfo() throws Exception;
}
```

Makna penting:

- `open(checkpoint)` dipanggil saat step mulai atau restart.
- `checkpoint == null` berarti initial start.
- `checkpointInfo()` mengembalikan state terkini yang dibutuhkan untuk resume.
- State checkpoint harus `Serializable`.

---

### 6.2 Reader checkpoint berbasis primary key

Untuk database workload, offset paging sering berbahaya karena data bisa berubah.

Contoh buruk:

```sql
SELECT *
FROM CASES
WHERE STATUS = 'OPEN'
ORDER BY ID
OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
```

Masalah:

- insert/delete selama job bisa menggeser offset,
- item bisa terlewat,
- item bisa diproses dua kali,
- performa offset menurun pada data besar.

Lebih aman menggunakan keyset/watermark:

```sql
SELECT *
FROM CASES
WHERE STATUS = 'OPEN'
  AND ID > :lastSeenId
ORDER BY ID
FETCH FIRST :pageSize ROWS ONLY
```

Checkpoint:

```java
public record CaseReaderCheckpoint(
        long lastSeenCaseId,
        String batchWindowId,
        int schemaVersion
) implements Serializable {}
```

Reader:

```java
import jakarta.batch.api.chunk.ItemReader;
import jakarta.inject.Named;

import java.io.Serializable;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Queue;

@Named
public class CaseAgeingReader implements ItemReader {

    private long lastSeenCaseId;
    private String batchWindowId;
    private final Queue<CaseRecord> buffer = new ArrayDeque<>();

    @Override
    public void open(Serializable checkpoint) {
        if (checkpoint == null) {
            this.lastSeenCaseId = 0L;
            this.batchWindowId = createOrLoadBatchWindow();
            return;
        }

        CaseReaderCheckpoint cp = (CaseReaderCheckpoint) checkpoint;
        this.lastSeenCaseId = cp.lastSeenCaseId();
        this.batchWindowId = cp.batchWindowId();
    }

    @Override
    public Object readItem() {
        if (buffer.isEmpty()) {
            List<CaseRecord> nextPage = loadNextPage(lastSeenCaseId, batchWindowId, 500);
            buffer.addAll(nextPage);
        }

        CaseRecord item = buffer.poll();
        if (item == null) {
            return null;
        }

        // Important: lastSeenCaseId moves when item is read.
        // Writer/idempotency must still protect correctness if failure occurs later.
        lastSeenCaseId = item.caseId();
        return item;
    }

    @Override
    public Serializable checkpointInfo() {
        return new CaseReaderCheckpoint(lastSeenCaseId, batchWindowId, 1);
    }

    @Override
    public void close() {
        buffer.clear();
    }

    private String createOrLoadBatchWindow() {
        // In real systems, avoid selecting an unstable moving target.
        // You may create a snapshot table, freeze cutoff timestamp, or persist input manifest.
        return "WINDOW-2026-06-17";
    }

    private List<CaseRecord> loadNextPage(long lastSeenId, String windowId, int limit) {
        throw new UnsupportedOperationException("DB query omitted");
    }
}
```

Key insight:

> Reader checkpoint tells where reading should resume. It does not by itself prove that all side effects before that position are safe.

That proof comes from transaction boundary plus writer idempotency.

---

### 6.3 Reader checkpoint berbasis file line number

Untuk file kecil/sederhana:

```java
public record FileCheckpoint(
        long nextLineNumber,
        String fileName,
        String sha256,
        int schemaVersion
) implements Serializable {}
```

`nextLineNumber` lebih jelas daripada `lastLineNumber`.

Kenapa?

- `lastLineNumber = 1000` bisa ambigu: apakah line 1000 sudah aman ditulis?
- `nextLineNumber = 1001` berarti restart mulai dari line 1001.

Tetapi line number punya kelemahan:

- skip ke line ke-900.000 mahal kalau file sangat besar,
- file harus immutable,
- encoding dan newline harus konsisten,
- file harus diverifikasi dengan checksum.

Untuk file besar, checkpoint bisa berupa byte offset, tetapi byte offset harus hati-hati terhadap:

- multibyte encoding,
- compressed file,
- variable-length record,
- partial line,
- parser state.

---

### 6.4 Reader checkpoint berbasis manifest

Untuk workload regulasi atau finansial, sering lebih defensible membuat input manifest.

Contoh:

```text
BATCH_INPUT_MANIFEST
- manifest_id
- job_name
- created_at
- created_by
- input_query_hash
- input_cutoff_time
- total_records
- checksum

BATCH_INPUT_MANIFEST_ITEM
- manifest_id
- sequence_no
- business_key
- source_id
- payload_hash
- status
```

Reader kemudian membaca manifest item, bukan langsung query live data.

Keuntungan:

- input batch stabil,
- restart deterministik,
- audit mudah,
- reprocess bisa dikontrol,
- record-level progress bisa terlihat,
- duplicate detection lebih mudah.

Trade-off:

- ada storage tambahan,
- job lebih kompleks,
- perlu housekeeping manifest.

Untuk sistem case management/regulatory, manifest biasanya lebih kuat secara defensibility dibanding query live setiap restart.

---

## 7. Anatomy `ItemWriter` yang Idempotent

### 7.1 Writer adalah sumber risiko terbesar

Reader membaca.
Processor menghitung.
Writer mengubah dunia.

Writer bisa:

- update database,
- insert record,
- generate file,
- kirim email,
- publish message,
- panggil API eksternal,
- membuat dokumen,
- create case/task/escalation.

Karena writer menghasilkan side effect, writer harus didesain dengan asumsi:

> Item atau chunk yang sama mungkin terlihat lagi setelah failure/restart.

---

### 7.2 Idempotency: definisi praktis

Operasi idempotent berarti menjalankan operasi yang sama lebih dari sekali menghasilkan state akhir yang sama seperti menjalankannya sekali.

Contoh idempotent:

```sql
UPDATE CASES
SET AGEING_DAYS = :computedAgeingDays,
    AGEING_AS_OF = :asOfDate
WHERE CASE_ID = :caseId
```

Jika nilai yang sama ditulis lagi, state akhir sama.

Contoh non-idempotent:

```sql
UPDATE CASES
SET REMINDER_COUNT = REMINDER_COUNT + 1
WHERE CASE_ID = :caseId
```

Jika chunk diulang, counter naik dua kali.

Contoh idempotent insert dengan natural key:

```sql
INSERT INTO CASE_ESCALATION_RESULT (
    BATCH_ID,
    CASE_ID,
    RULE_ID,
    RESULT_STATUS,
    CREATED_AT
) VALUES (
    :batchId,
    :caseId,
    :ruleId,
    :resultStatus,
    CURRENT_TIMESTAMP
)
```

Dengan unique constraint:

```sql
ALTER TABLE CASE_ESCALATION_RESULT
ADD CONSTRAINT UK_ESCALATION_RESULT
UNIQUE (BATCH_ID, CASE_ID, RULE_ID);
```

Jika insert yang sama terjadi lagi, writer bisa treat duplicate as success.

---

### 7.3 Idempotent writer pattern: upsert by business key

```java
import jakarta.batch.api.chunk.ItemWriter;
import jakarta.inject.Named;

import java.io.Serializable;
import java.util.List;

@Named
public class CaseAgeingWriter implements ItemWriter {

    @Override
    public void open(Serializable checkpoint) {
        // initialize DB resources if needed
    }

    @Override
    public void writeItems(List<Object> items) {
        for (Object raw : items) {
            CaseAgeingResult result = (CaseAgeingResult) raw;
            upsertAgeingResult(result);
        }
    }

    @Override
    public Serializable checkpointInfo() {
        // Writer checkpoint only needed if writer itself has resumable state.
        return null;
    }

    @Override
    public void close() {
        // cleanup
    }

    private void upsertAgeingResult(CaseAgeingResult result) {
        // Use MERGE / UPSERT semantics with stable natural key.
        // Key: batchId + caseId + calculationType.
        throw new UnsupportedOperationException("DB merge omitted");
    }
}
```

Pseudo SQL Oracle-style:

```sql
MERGE INTO CASE_AGEING_RESULT target
USING (
    SELECT
        :batch_id AS batch_id,
        :case_id AS case_id,
        :ageing_days AS ageing_days,
        :as_of_date AS as_of_date
    FROM dual
) source
ON (
    target.batch_id = source.batch_id
    AND target.case_id = source.case_id
)
WHEN MATCHED THEN UPDATE SET
    target.ageing_days = source.ageing_days,
    target.as_of_date = source.as_of_date,
    target.updated_at = CURRENT_TIMESTAMP
WHEN NOT MATCHED THEN INSERT (
    batch_id,
    case_id,
    ageing_days,
    as_of_date,
    created_at
) VALUES (
    source.batch_id,
    source.case_id,
    source.ageing_days,
    source.as_of_date,
    CURRENT_TIMESTAMP
)
```

This is restart-friendly because duplicate chunk execution converges to same state.

---

## 8. The Dangerous Gap: Side Effect Succeeds, Checkpoint Fails

Skenario paling penting:

```text
1. Reader reads item 1001-1500
2. Processor transforms items
3. Writer writes items to external system
4. External system succeeds
5. Local transaction/checkpoint fails
6. Job execution FAILED
7. Operator restarts job
8. Reader resumes from previous checkpoint, e.g. item 1001
9. Writer calls external system again
```

Jika external call tidak idempotent, duplicate terjadi.

Ini adalah gap klasik antara:

- local state,
- job repository checkpoint,
- external side effect.

Tidak ada checkpoint magic yang bisa menyelesaikan atomicity lintas semua sistem eksternal.

Solusi desain:

1. Buat side effect idempotent.
2. Gunakan durable outbox.
3. Gunakan idempotency key saat memanggil external API.
4. Pisahkan calculation batch dari dispatch batch.
5. Catat external interaction ledger.
6. Treat duplicate external success as success.
7. Jangan bergantung pada “job tidak akan retry”.

---

## 9. Outbox sebagai Boundary Aman

Alih-alih writer langsung memanggil external API:

```text
Batch Writer -> External API
```

Gunakan:

```text
Batch Writer -> OUTBOX table -> Dispatcher -> External API
```

Batch writer hanya menulis durable intent dalam transaksi lokal:

```sql
CREATE TABLE OUTBOX_EVENT (
    EVENT_ID           VARCHAR2(64) PRIMARY KEY,
    EVENT_TYPE         VARCHAR2(100) NOT NULL,
    BUSINESS_KEY       VARCHAR2(200) NOT NULL,
    IDEMPOTENCY_KEY    VARCHAR2(200) NOT NULL,
    PAYLOAD_JSON       CLOB NOT NULL,
    STATUS             VARCHAR2(30) NOT NULL,
    ATTEMPT_COUNT      NUMBER DEFAULT 0,
    CREATED_AT         TIMESTAMP NOT NULL,
    NEXT_ATTEMPT_AT    TIMESTAMP,
    LAST_ERROR         CLOB,
    CONSTRAINT UK_OUTBOX_IDEMPOTENCY UNIQUE (IDEMPOTENCY_KEY)
)
```

Writer:

```java
private void writeOutbox(CorrespondenceCommand command) {
    String idempotencyKey = command.batchId() + ":" + command.caseId() + ":" + command.templateCode();

    // Insert with unique idempotency key.
    // If duplicate key, treat as already written.
}
```

Keuntungan:

- batch checkpoint dan outbox insert berada di database boundary yang sama,
- external side effect dipindahkan ke dispatcher yang retry-aware,
- duplicate intent bisa dicegah dengan unique key,
- operational visibility lebih baik,
- audit lebih kuat.

Trade-off:

- end-to-end completion menjadi asynchronous,
- butuh dispatcher,
- butuh retry policy dan dead-letter state.

Untuk sistem enterprise/regulatory, trade-off ini sering layak.

---

## 10. Checkpoint Data Design

### 10.1 Syarat checkpoint yang baik

Checkpoint yang baik harus:

1. **Serializable**.
2. **Minimal** — jangan simpan payload besar.
3. **Stable** — tidak bergantung pada state volatile.
4. **Versioned** — agar compatible saat deploy/migrasi.
5. **Deterministic** — restart dari checkpoint yang sama harus membaca range yang sama.
6. **Auditable** — cukup jelas untuk debugging.
7. **Bounded size** — jangan membebani job repository.
8. **Safe across redeploy** — hati-hati class evolution.

---

### 10.2 Checkpoint harus versioned

Jangan membuat checkpoint seperti ini untuk long-lived batch:

```java
public class MyCheckpoint implements Serializable {
    public long lastId;
}
```

Lebih baik:

```java
public record CaseBatchCheckpoint(
        int schemaVersion,
        String jobDefinitionVersion,
        String inputManifestId,
        long nextSequenceNo,
        long lastCommittedBusinessId
) implements Serializable {
    public static final int CURRENT_SCHEMA_VERSION = 1;
}
```

Kenapa perlu `schemaVersion`?

Karena job bisa gagal hari ini, lalu direstart setelah deployment besok.

Jika class checkpoint berubah tanpa strategi compatibility, restart bisa gagal karena:

- serialization mismatch,
- field hilang,
- semantic berubah,
- package rename,
- classloader berubah.

Untuk batch mission-critical, pertimbangkan checkpoint format yang lebih eksplisit seperti JSON string kecil:

```java
public record JsonCheckpoint(String json, int schemaVersion) implements Serializable {}
```

Tetapi tetap hati-hati: Jakarta Batch API menerima `Serializable`, bukan otomatis JSON. JSON checkpoint berarti aplikasi sendiri yang encode/decode.

---

### 10.3 Jangan simpan ini di checkpoint

Hindari menyimpan:

- entity JPA managed,
- JDBC connection,
- stream/file handle,
- CDI bean reference,
- security principal object kompleks,
- request/session object,
- object dari class yang sering berubah,
- payload besar,
- access token/secrets,
- data PII tanpa alasan kuat,
- non-deterministic object.

Checkpoint adalah persisted recovery metadata, bukan memory dump.

---

## 11. Reader State vs Writer State

Jakarta Batch menyediakan checkpoint pada reader dan writer.

Banyak orang hanya memikirkan reader.

Tetapi writer juga bisa punya state:

- output file part number,
- temporary file name,
- current archive sequence,
- last flushed document id,
- writer-side aggregate count,
- checksum accumulator,
- generated manifest id.

Contoh writer checkpoint untuk file output:

```java
public record ReportWriterCheckpoint(
        int schemaVersion,
        String outputManifestId,
        int currentPartNo,
        long recordsWritten,
        String tempFileName
) implements Serializable {}
```

Namun writer checkpoint saja tidak cukup jika output file sudah terlanjur dibuat. Perlu desain atomic output:

```text
write to temp file
fsync/close
record output metadata
rename temp -> final atomically if possible
mark part complete
```

Untuk object storage seperti S3, rename tidak atomic seperti filesystem lokal. Biasanya perlu pola:

```text
write object with run-specific temp key
write manifest only after all parts complete
consumer reads only manifest-approved final keys
```

---

## 12. Restartability for Different Workload Types

### 12.1 Database-to-database batch

Risiko:

- duplicate insert,
- lost update,
- lock contention,
- inconsistent input set.

Pattern:

- keyset reader,
- stable input manifest or cutoff timestamp,
- writer with `MERGE`/upsert,
- unique constraint by business key,
- commit interval tuned to DB capacity,
- record-level status for audit.

Good key:

```text
(batch_id, source_record_id, rule_code)
```

Bad key:

```text
generated_sequence_only
```

---

### 12.2 File ingestion batch

Risiko:

- partial file,
- file replaced during processing,
- duplicate ingestion,
- malformed lines,
- encoding issues.

Pattern:

- only process files from landing/ready directory,
- require manifest/checksum,
- move file atomically to processing,
- record file hash,
- line-level idempotency key,
- quarantine bad records,
- checkpoint by sequence/offset,
- final status per file.

Idempotency key:

```text
file_hash + line_number
```

or better:

```text
source_system + business_record_id + effective_date
```

---

### 12.3 External API enrichment batch

Risiko:

- rate limit,
- token expiry,
- partial success,
- duplicate remote side effect,
- remote timeout with unknown result.

Pattern:

- separate fetch/enrich from commit,
- use idempotency key if API supports it,
- cache stable lookup results,
- classify timeout as unknown, not necessarily failed,
- keep external interaction ledger,
- retry with bounded backoff,
- checkpoint local progress only after durable local result.

---

### 12.4 Correspondence/email generation batch

Risiko:

- duplicate email/letter,
- document generated twice,
- file name collision,
- audit evidence missing.

Pattern:

- generate correspondence command first,
- unique key by `caseId + templateCode + batchId + recipientId`,
- outbox dispatch,
- document manifest,
- duplicate command treated as already requested,
- actual sending separated and audited.

---

### 12.5 Escalation/evaluation batch

Risiko:

- escalation created twice,
- case status changes during batch,
- stale decision,
- regulatory audit challenge.

Pattern:

- evaluate against explicit `asOf` time,
- store rule version,
- store input facts hash,
- unique escalation recommendation key,
- require approval workflow for irreversible action,
- avoid immediate destructive side effect inside calculation step.

---

## 13. Commit Interval and Restart Cost

Commit interval menentukan berapa banyak item diproses sebelum checkpoint/commit.

Misalnya:

```xml
<chunk item-count="1000">
    <reader ref="reader"/>
    <processor ref="processor"/>
    <writer ref="writer"/>
</chunk>
```

Jika job gagal setelah memproses 999 item dalam chunk tetapi sebelum checkpoint, restart bisa mengulang chunk tersebut.

### 13.1 Smaller commit interval

Keuntungan:

- recovery lebih cepat,
- duplicate exposure lebih kecil,
- lock duration lebih pendek,
- progress lebih granular.

Kerugian:

- overhead transaction lebih besar,
- job repository lebih sering ditulis,
- throughput bisa lebih rendah,
- writer batch efficiency menurun.

### 13.2 Larger commit interval

Keuntungan:

- throughput bisa lebih tinggi,
- fewer commits,
- better JDBC batch efficiency,
- lower checkpoint overhead.

Kerugian:

- recovery lebih mahal,
- lebih banyak item diulang,
- memory buffer lebih besar,
- lock/transaction bisa lebih berat,
- duplicate side effect blast radius lebih besar.

### 13.3 Rule of thumb

Tidak ada angka universal.

Mulai dari pertanyaan:

1. Berapa lama satu item diproses?
2. Berapa besar payload item?
3. Apakah writer idempotent?
4. Apakah output eksternal atau lokal?
5. Berapa banyak work yang acceptable untuk diulang?
6. Berapa besar transaction log/undo pressure?
7. Berapa connection pool capacity?
8. Berapa SLA recovery setelah failure?

Untuk job database lokal, commit interval 100–1000 sering menjadi starting point eksperimen.
Untuk external side effect, commit interval besar bisa berbahaya kecuali side effect benar-benar idempotent atau memakai outbox.

---

## 14. Failure Matrix: Di Mana Job Bisa Mati?

Bayangkan chunk berisi item 1001–1500.

| Failure Point | Apa yang mungkin terjadi | Restart risk | Mitigasi |
|---|---|---|---|
| Sebelum read | Belum ada item diproses | rendah | restart dari checkpoint lama |
| Setelah read sebelum process | item mungkin dibaca ulang | rendah | processor pure |
| Setelah process sebelum write | hasil memory hilang | rendah | deterministic processor |
| Di tengah write DB transactional | rollback mungkin terjadi | sedang | transaction + idempotent write |
| Setelah write DB sebelum checkpoint | write mungkin commit/rollback tergantung boundary | tinggi | align transaction/checkpoint, idempotency |
| Setelah external API success sebelum local state | remote side effect duplicate | sangat tinggi | outbox/idempotency key/ledger |
| Setelah checkpoint sebelum close | progress aman, resource cleanup mungkin belum | sedang | close idempotent |
| Saat stop requested | partial chunk behavior bergantung runtime/titik aman | sedang | cooperative stop, small chunks |
| Saat deploy/pod kill | abrupt termination | tinggi | graceful shutdown + restartable design |

Top-tier engineer tidak hanya bertanya “apakah job restartable?” tetapi:

> Restartable dari failure point yang mana, dengan side effect apa, dan bukti apa?

---

## 15. Idempotency Patterns

### 15.1 Natural key uniqueness

Gunakan unique constraint untuk memastikan duplicate tidak bisa masuk.

```sql
ALTER TABLE GENERATED_NOTICE
ADD CONSTRAINT UK_NOTICE_ONCE
UNIQUE (CASE_ID, NOTICE_TYPE, BATCH_ID, RECIPIENT_ID);
```

Jika insert duplicate:

- treat as success jika payload sama,
- flag conflict jika payload berbeda.

---

### 15.2 Idempotency key table

```sql
CREATE TABLE IDEMPOTENCY_RECORD (
    IDEMPOTENCY_KEY VARCHAR2(200) PRIMARY KEY,
    OPERATION_TYPE  VARCHAR2(100) NOT NULL,
    REQUEST_HASH    VARCHAR2(128) NOT NULL,
    RESULT_STATUS   VARCHAR2(30) NOT NULL,
    RESULT_REF      VARCHAR2(200),
    CREATED_AT      TIMESTAMP NOT NULL,
    UPDATED_AT      TIMESTAMP NOT NULL
)
```

Algorithm:

```text
1. Compute idempotency key
2. Try insert key as IN_PROGRESS
3. If insert succeeds, execute operation
4. Store result
5. If duplicate key exists:
   - if same request hash and SUCCESS: return existing result
   - if IN_PROGRESS too old: recover/inspect
   - if different request hash: conflict
```

---

### 15.3 Ledger pattern

Instead of overwriting state, append facts.

```text
CASE_ESCALATION_LEDGER
- ledger_id
- case_id
- batch_id
- rule_id
- action_type
- idempotency_key
- payload_hash
- created_at
```

Then derive current state from ledger or materialize it.

Benefit:

- audit-friendly,
- replayable,
- duplicate detection possible,
- regulatory evidence strong.

Cost:

- more storage,
- query complexity,
- compaction/materialization needed.

---

### 15.4 Compare-and-set update

For state transitions:

```sql
UPDATE CASES
SET STATUS = 'ESCALATED',
    ESCALATED_AT = CURRENT_TIMESTAMP
WHERE CASE_ID = :caseId
  AND STATUS = 'OPEN'
```

If affected rows = 0:

- already escalated?
- closed by another process?
- invalid state?

This avoids blindly overwriting concurrent changes.

---

### 15.5 Output manifest pattern

For generated files/documents:

```text
OUTPUT_MANIFEST
- manifest_id
- batch_id
- status
- total_parts
- checksum

OUTPUT_MANIFEST_ITEM
- manifest_id
- part_no
- object_key
- record_count
- checksum
- status
```

Consumers should only read outputs from manifest with `status = COMPLETE`.

This prevents partial output consumption.

---

## 16. Designing Processor for Restartability

Processor should ideally be pure:

```text
same input + same reference data version -> same output
```

Avoid processor that:

- writes database,
- calls external API with side effect,
- increments counter,
- reads current time repeatedly without stable `asOf`,
- depends on mutable global state,
- mutates input entity managed by JPA accidentally,
- stores progress in memory only.

Better:

```java
public CaseAgeingResult processItem(Object item) {
    CaseRecord record = (CaseRecord) item;
    return new CaseAgeingResult(
            record.caseId(),
            batchContext.getBatchId(),
            batchContext.getAsOfDate(),
            calculateAgeing(record, batchContext.getAsOfDate()),
            ruleVersion
    );
}
```

Notice:

- `asOfDate` stable,
- `ruleVersion` explicit,
- no side effect,
- output contains enough audit metadata.

---

## 17. Stop vs Fail vs Restart

### 17.1 Failed execution

A job execution fails because of exception or unrecoverable error.

Restart should continue from last checkpoint if job is restartable.

### 17.2 Stopped execution

A stop is operator/runtime-requested termination.

A well-designed batch should stop at a safe boundary.

Important:

- stop may not be immediate,
- stop should not corrupt chunk,
- stop should preserve restart state,
- long item processing can delay stop.

### 17.3 Abandoned execution

Abandon usually means operator marks old execution as not restartable/irrelevant. Use with caution.

Abandon is not a data correction strategy.

---

## 18. Restart Parameter Semantics

A common mistake:

> Restart job with different business parameters.

That can violate determinism.

Example:

Original:

```text
asOfDate = 2026-06-17
region = ALL
ruleVersion = R1
```

Restart with:

```text
asOfDate = 2026-06-18
region = ALL
ruleVersion = R2
```

This is not a restart.
It is a different business run.

Good practice:

- immutable job parameters per job instance,
- validate restart parameters,
- persist effective parameters in job request table,
- use `batchRunId` or `jobRequestId`,
- explicit rerun operation if parameters differ.

---

## 19. Job Request Table Pattern

Do not rely only on raw `JobOperator.start()` calls from random places.

Create a business-level job request table:

```sql
CREATE TABLE BATCH_JOB_REQUEST (
    REQUEST_ID        VARCHAR2(64) PRIMARY KEY,
    JOB_NAME          VARCHAR2(200) NOT NULL,
    BUSINESS_KEY      VARCHAR2(200) NOT NULL,
    PARAMETERS_JSON   CLOB NOT NULL,
    PARAMETERS_HASH   VARCHAR2(128) NOT NULL,
    REQUEST_STATUS    VARCHAR2(30) NOT NULL,
    JOB_EXECUTION_ID  NUMBER,
    REQUESTED_BY      VARCHAR2(100) NOT NULL,
    REQUESTED_AT      TIMESTAMP NOT NULL,
    APPROVED_BY       VARCHAR2(100),
    APPROVED_AT       TIMESTAMP,
    CREATED_AT        TIMESTAMP NOT NULL,
    UPDATED_AT        TIMESTAMP NOT NULL,
    CONSTRAINT UK_JOB_REQUEST_BUSINESS UNIQUE (JOB_NAME, BUSINESS_KEY, PARAMETERS_HASH)
)
```

Benefits:

- prevents duplicate launch,
- creates audit trail,
- separates business request from runtime execution,
- allows approval flow,
- records parameter hash,
- maps business operation to job execution.

---

## 20. Record-Level Status Pattern

For high-value batch, job-level status is not enough.

You need record-level state:

```sql
CREATE TABLE BATCH_RECORD_STATUS (
    BATCH_ID          VARCHAR2(64) NOT NULL,
    RECORD_KEY        VARCHAR2(200) NOT NULL,
    STATUS            VARCHAR2(30) NOT NULL,
    ATTEMPT_COUNT     NUMBER DEFAULT 0,
    LAST_ERROR_CODE   VARCHAR2(100),
    LAST_ERROR_MSG    VARCHAR2(1000),
    PAYLOAD_HASH      VARCHAR2(128),
    UPDATED_AT        TIMESTAMP NOT NULL,
    CONSTRAINT PK_BATCH_RECORD_STATUS PRIMARY KEY (BATCH_ID, RECORD_KEY)
)
```

Status example:

```text
PENDING
PROCESSING
PROCESSED
SKIPPED
FAILED_RETRYABLE
FAILED_PERMANENT
DISPATCHED
CONFIRMED
```

This enables:

- partial success report,
- targeted reprocess,
- poison record isolation,
- audit evidence,
- dashboard progress.

But avoid turning every batch into a complex workflow engine unless the domain needs it.

---

## 21. Restartability Test Matrix

A batch is not restartable just because it compiles with `checkpointInfo()`.

You need tests that kill it at bad times.

### 21.1 Unit tests

Test checkpoint serialization:

```java
@Test
void checkpointShouldBeSerializable() throws Exception {
    CaseReaderCheckpoint cp = new CaseReaderCheckpoint(100L, "WINDOW-1", 1);

    byte[] bytes = serialize(cp);
    CaseReaderCheckpoint restored = deserialize(bytes);

    assertEquals(cp, restored);
}
```

Test reader resumes correctly:

```java
@Test
void readerShouldResumeAfterLastSeenId() throws Exception {
    CaseAgeingReader reader = new CaseAgeingReader(fakeRepository);
    reader.open(new CaseReaderCheckpoint(500L, "WINDOW-1", 1));

    CaseRecord first = (CaseRecord) reader.readItem();

    assertTrue(first.caseId() > 500L);
}
```

### 21.2 Integration tests

Failure injection points:

1. fail after N reads,
2. fail after N processes,
3. fail before writer,
4. fail after writer partially writes,
5. fail after writer completes but before checkpoint,
6. fail due to DB timeout,
7. fail due to external API timeout,
8. stop request during chunk,
9. restart after deployment simulation,
10. duplicate restart attempt.

Assertions:

- no missing records,
- no duplicate side effects,
- final counts correct,
- record-level errors preserved,
- checkpoint resumes at expected point,
- audit trail complete,
- restart does not use changed parameters.

---

## 22. Example: Full Restartable Case Ageing Batch

### 22.1 Business requirement

Nightly job recalculates ageing days for open enforcement cases.

Rules:

- input set is all open cases as of `asOfDate`,
- ageing result must be stored per case per batch,
- restart must not duplicate result,
- rule version must be auditable,
- if job fails, restart continues safely,
- case status changes after batch start must not alter the input set.

### 22.2 Design

Use manifest:

```text
1. Create input manifest for open cases as of asOfDate
2. Chunk reader reads manifest items by sequence_no
3. Processor calculates ageing using fixed asOfDate and ruleVersion
4. Writer upserts result by batchId + caseId
5. Checkpoint stores nextSequenceNo
6. Restart resumes from nextSequenceNo
```

### 22.3 JSL

```xml
<job id="case-ageing-job" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <properties>
        <property name="jobDefinitionVersion" value="1.0.0"/>
    </properties>

    <step id="build-input-manifest" next="calculate-ageing">
        <batchlet ref="caseAgeingManifestBatchlet"/>
    </step>

    <step id="calculate-ageing">
        <chunk item-count="500">
            <reader ref="caseAgeingManifestReader"/>
            <processor ref="caseAgeingProcessor"/>
            <writer ref="caseAgeingResultWriter"/>
        </chunk>
    </step>
</job>
```

### 22.4 Manifest reader checkpoint

```java
public record ManifestCheckpoint(
        int schemaVersion,
        String manifestId,
        long nextSequenceNo
) implements Serializable {}
```

Reader:

```java
@Named
public class CaseAgeingManifestReader implements ItemReader {

    private String manifestId;
    private long nextSequenceNo;
    private final Queue<ManifestItem> buffer = new ArrayDeque<>();

    @Override
    public void open(Serializable checkpoint) {
        if (checkpoint == null) {
            this.manifestId = loadManifestIdFromJobParameters();
            this.nextSequenceNo = 1L;
        } else {
            ManifestCheckpoint cp = (ManifestCheckpoint) checkpoint;
            this.manifestId = cp.manifestId();
            this.nextSequenceNo = cp.nextSequenceNo();
        }
    }

    @Override
    public Object readItem() {
        if (buffer.isEmpty()) {
            buffer.addAll(loadManifestItems(manifestId, nextSequenceNo, 500));
        }

        ManifestItem item = buffer.poll();
        if (item == null) {
            return null;
        }

        nextSequenceNo = item.sequenceNo() + 1;
        return item;
    }

    @Override
    public Serializable checkpointInfo() {
        return new ManifestCheckpoint(1, manifestId, nextSequenceNo);
    }

    @Override
    public void close() {
        buffer.clear();
    }

    private String loadManifestIdFromJobParameters() {
        throw new UnsupportedOperationException("Omitted");
    }

    private List<ManifestItem> loadManifestItems(String manifestId, long fromSequenceNo, int limit) {
        throw new UnsupportedOperationException("Omitted");
    }
}
```

### 22.5 Idempotent writer

```java
@Named
public class CaseAgeingResultWriter implements ItemWriter {

    @Override
    public void open(Serializable checkpoint) {
    }

    @Override
    public void writeItems(List<Object> items) {
        for (Object raw : items) {
            CaseAgeingResult result = (CaseAgeingResult) raw;
            mergeResult(result);
            markManifestItemProcessed(result.manifestId(), result.sequenceNo(), result.payloadHash());
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return null;
    }

    @Override
    public void close() {
    }

    private void mergeResult(CaseAgeingResult result) {
        // MERGE by (batch_id, case_id, rule_version)
    }

    private void markManifestItemProcessed(String manifestId, long sequenceNo, String payloadHash) {
        // UPDATE manifest item with status PROCESSED.
        // This is optional but useful for audit and targeted reprocess.
    }
}
```

Invariant:

```text
For every manifest item, final result is uniquely identified by:
batchId + caseId + ruleVersion
```

Restarting the same chunk converges to the same final state.

---

## 23. Advanced Issue: Checkpoint and Mutable Input

Suppose reader uses:

```sql
SELECT *
FROM CASES
WHERE STATUS = 'OPEN'
AND ID > :lastSeenId
ORDER BY ID
```

During job:

- case 1200 becomes CLOSED,
- case 1300 becomes OPEN,
- case 900 is reopened,
- new case 2000 is created.

Should the batch include them?

There is no universal answer. It depends on business semantics.

You need choose one:

### Option A — Moving input

Job processes whatever is open when read.

Good for low-stakes sync.
Bad for audit and deterministic restart.

### Option B — Cutoff timestamp

Job processes cases open as of `asOfDate`.

Need data model that can answer historical state or stable filter.

### Option C — Manifest snapshot

Job creates explicit list of case IDs at start.

Most deterministic and defensible.

For regulatory systems, Option C is often best.

---

## 24. Advanced Issue: Checkpoint after Processor Filtering

In Jakarta Batch, processor may return `null` to filter item.

Example:

```java
public Object processItem(Object item) {
    CaseRecord record = (CaseRecord) item;
    if (!shouldRecalculate(record)) {
        return null;
    }
    return calculate(record);
}
```

If many items are filtered, checkpoint still must advance based on reader position, not writer output count.

Common bug:

- checkpoint based on written item count,
- filtered items cause restart to reread already-filtered data,
- job loops or duplicates.

Correct mental model:

```text
Reader progress and writer output are related but not identical.
```

---

## 25. Advanced Issue: Partitioned Restartability

Partitioning adds complexity.

Each partition needs its own checkpoint.

Example partition plan:

```text
Partition 0: case_id 1      - 100000
Partition 1: case_id 100001 - 200000
Partition 2: case_id 200001 - 300000
```

Each partition checkpoint:

```java
public record PartitionCheckpoint(
        int schemaVersion,
        int partitionId,
        long rangeStartInclusive,
        long rangeEndInclusive,
        long nextCaseId
) implements Serializable {}
```

Pitfalls:

- shared mutable checkpoint across partitions,
- writer unique key missing partition-independent business key,
- partition skew,
- partition restart duplicate,
- one partition completes while another fails,
- reducer assumes all partition outputs are present.

Partitioned batch must be designed so each partition can safely restart independently.

---

## 26. Advanced Issue: Deployment Between Failure and Restart

Job fails on version 1.0.
Application is deployed to version 1.1.
Operator restarts old job execution.

Possible issues:

- checkpoint class changed,
- JSL changed,
- reader semantics changed,
- processor rule changed,
- writer key changed,
- database schema migrated,
- old job parameters no longer valid.

Mitigations:

1. Version checkpoint schema.
2. Version job definition.
3. Store rule version in parameters.
4. Keep backward-compatible checkpoint deserialization.
5. Do not change meaning of existing job id silently.
6. Consider new job id for incompatible changes.
7. Provide migration/abandon policy for old failed executions.

Example naming:

```text
case-ageing-job-v1
case-ageing-job-v2
```

or use property:

```xml
<property name="jobDefinitionVersion" value="2.0.0"/>
```

But property alone does not enforce compatibility. Your code must.

---

## 27. Anti-Patterns

### Anti-pattern 1 — Checkpoint only by offset on mutable data

```text
offset = 10000
```

On changing dataset, this can skip or duplicate records.

Use keyset, cutoff, or manifest.

---

### Anti-pattern 2 — Writer increments counters

```sql
SET count = count + 1
```

Restart can duplicate increment.

Use derived value, ledger, or idempotency key.

---

### Anti-pattern 3 — External API call inside writer without idempotency

```text
writer -> payment/send/email/create remote resource
```

If checkpoint fails after remote success, restart duplicates side effect.

Use outbox or external idempotency key.

---

### Anti-pattern 4 — Checkpoint stores huge payload

Checkpoint should not be a data warehouse.

Store pointer/position, not all data.

---

### Anti-pattern 5 — Restart with different parameters

This is usually rerun, not restart.

---

### Anti-pattern 6 — Processor has side effects

Processor should transform. Writer should write. Side effects in processor are hard to checkpoint.

---

### Anti-pattern 7 — No duplicate detection because “batch only runs once”

Production disproves this assumption.

Jobs are restarted, redeployed, retried, triggered twice, or manually rerun.

---

### Anti-pattern 8 — Treating `COMPLETED` as proof of business correctness

`COMPLETED` means runtime completed execution. It does not automatically mean:

- all records business-valid,
- no skipped records,
- no duplicate remote effects,
- output consumed correctly,
- downstream confirmed.

You need domain-level completion evidence.

---

## 28. Design Checklist

Before marking a Jakarta Batch job production-ready, answer these:

### Input stability

- [ ] Is input set stable across restart?
- [ ] Is there a cutoff timestamp or manifest?
- [ ] Can records be inserted/updated/deleted during job?
- [ ] What is the expected behavior if they are?

### Reader checkpoint

- [ ] What exactly does checkpoint represent?
- [ ] Is it serializable?
- [ ] Is it versioned?
- [ ] Is it minimal?
- [ ] Can it survive redeploy?
- [ ] Does it avoid offset on mutable dataset?

### Processor

- [ ] Is processor deterministic?
- [ ] Does it avoid side effects?
- [ ] Does it use stable `asOf` time/rule version?
- [ ] Are filtered records accounted for?

### Writer

- [ ] Is writer idempotent?
- [ ] Is there a unique business key?
- [ ] Are duplicates treated safely?
- [ ] Are external side effects protected by outbox/idempotency key?
- [ ] Are partial outputs hidden from consumers?

### Restart

- [ ] Can job restart after failure at each major point?
- [ ] Are restart parameters immutable?
- [ ] Is job definition versioned?
- [ ] Is old checkpoint compatible after deployment?

### Observability

- [ ] Can operator see last checkpoint/progress?
- [ ] Are record-level failures visible?
- [ ] Are skips/retries counted?
- [ ] Is audit trail defensible?
- [ ] Can duplicate launch be detected?

### Testing

- [ ] Have you killed job mid-chunk?
- [ ] Have you failed writer after partial success?
- [ ] Have you simulated external timeout with unknown result?
- [ ] Have you restarted after deployment?
- [ ] Have you tested duplicate job request?

---

## 29. Practical Heuristics

1. If side effect is irreversible, do not put it directly inside chunk writer unless it is idempotent.
2. If input must be defensible, create manifest.
3. If dataset is mutable, avoid offset checkpoint.
4. If restart can re-execute a chunk, writer must tolerate duplicate items.
5. If job parameter changes, it is not a restart; it is a new business run.
6. If external API timeout occurs, result is often unknown, not failed.
7. If output file can be consumed partially, you need manifest/finalization protocol.
8. If checkpoint class can evolve, version it.
9. If record-level correctness matters, job-level `COMPLETED` is insufficient.
10. If you cannot explain failure behavior at every boundary, design is not production-ready.

---

## 30. Mental Model Summary

A robust Jakarta Batch job is built from these invariants:

```text
Input invariant:
    The job knows exactly what data it is supposed to process.

Checkpoint invariant:
    The job can resume from persisted progress without ambiguity.

Processor invariant:
    Reprocessing the same input produces the same intended output.

Writer invariant:
    Writing the same intended output more than once converges safely.

Side-effect invariant:
    External effects are idempotent, ledgered, or dispatched through durable outbox.

Parameter invariant:
    Restart uses the same business parameters as the original execution.

Audit invariant:
    The system can explain what was processed, skipped, retried, failed, and completed.
```

Without these invariants, checkpointing is cosmetic.

With these invariants, restartability becomes a real production capability.

---

## 31. Latihan / Thought Experiments

### Exercise 1 — Mutable input

A batch processes all cases with `STATUS = 'OPEN'` using `ID > lastSeenId` checkpoint.

During the run, a case with lower ID changes from `CLOSED` to `OPEN`.

Questions:

1. Should it be included?
2. Would your reader include it?
3. Is that correct for the business?
4. Would a manifest solve it?

---

### Exercise 2 — Duplicate email

A chunk writer sends 500 emails and then the server crashes before checkpoint persists.

Questions:

1. What happens on restart?
2. How do you prevent duplicate emails?
3. Would unique key alone help?
4. Would outbox help?
5. What audit evidence do you need?

---

### Exercise 3 — Counter update

Writer updates:

```sql
UPDATE USERS SET NOTIFICATION_COUNT = NOTIFICATION_COUNT + 1
```

Questions:

1. Is this idempotent?
2. What happens if chunk repeats?
3. How would you redesign it?

---

### Exercise 4 — Version upgrade

Job failed yesterday with checkpoint class version 1.
Today deployment introduces checkpoint class version 2.

Questions:

1. Can old execution restart?
2. What migration path exists?
3. Should job id change?
4. Should old executions be abandoned?

---

### Exercise 5 — Regulatory escalation

A batch creates escalation recommendations for enforcement cases.

Questions:

1. What should be the idempotency key?
2. What facts must be stored for audit?
3. Should the batch directly change case status?
4. What should happen if case is closed after manifest creation but before writer?

---

## 32. Ringkasan

Checkpointing, restartability, dan idempotency adalah tiga sisi dari reliability batch.

- **Checkpointing** menyimpan progress durable.
- **Restartability** memakai progress itu untuk melanjutkan eksekusi setelah failure.
- **Idempotency** memastikan pengulangan item/chunk/side effect tidak merusak state.

Jakarta Batch menyediakan mekanisme runtime seperti `ItemReader.open(checkpoint)`, `checkpointInfo()`, job repository, dan `JobOperator.restart()`. Tetapi correctness tetap tanggung jawab desain aplikasi.

Engineer yang kuat tidak hanya bertanya:

> “Bagaimana menjalankan batch?”

Tetapi:

> “Jika batch mati di titik terburuk, bagaimana sistem membuktikan bahwa restart aman?”

Itulah perbedaan antara batch script dan enterprise batch system.

---

## 33. Status Seri

Bagian ini adalah **Part 21** dari maksimal 35 part.

Seri **belum selesai**.

Part berikutnya:

```text
Part 22 — Skip, Retry, Rollback, and Exception Classification
File: 22-skip-retry-rollback-exception-classification.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./20-chunk-oriented-processing-reader-processor-writer.md">⬅️ Part 20 — Chunk-Oriented Processing: Reader, Processor, Writer</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./22-skip-retry-rollback-exception-classification.md">Part 22 — Skip, Retry, Rollback, and Exception Classification ➡️</a>
</div>
