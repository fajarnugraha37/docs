# Part 20 — Chunk-Oriented Processing: Reader, Processor, Writer

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `20-chunk-oriented-processing-reader-processor-writer.md`  
> Fokus: memahami chunk-oriented processing bukan sebagai pola `for-loop` yang dibungkus framework, tetapi sebagai model eksekusi batch yang menggabungkan item streaming, transformasi, transactional chunk, checkpoint, idempotent writing, restartability, dan production control.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan mental model **chunk-oriented processing** di Jakarta Batch.
2. Membedakan tanggung jawab `ItemReader`, `ItemProcessor`, dan `ItemWriter` secara tajam.
3. Mendesain chunk step yang:
   - hemat memory,
   - transaction-aware,
   - checkpoint-aware,
   - restartable,
   - idempotent,
   - observable,
   - mudah dioperasikan di production.
4. Menentukan kapan memakai chunk step dibanding batchlet.
5. Menentukan ukuran chunk/commit interval berdasarkan trade-off throughput, lock duration, retry cost, memory, dan failure recovery.
6. Menghindari anti-pattern seperti:
   - reader yang melakukan side effect,
   - processor yang menulis database,
   - writer yang tidak idempotent,
   - commit interval terlalu besar,
   - checkpoint state tidak serializable,
   - cursor reader yang tidak bisa restart aman,
   - chunk step yang diam-diam menjadi transaksi raksasa.
7. Membuat contoh implementasi `ItemReader`, `ItemProcessor`, dan `ItemWriter` untuk database-driven batch.
8. Membaca kegagalan chunk step dari sudut pandang runtime: item mana yang sudah dibaca, diproses, ditulis, dikomit, atau perlu diulang.

---

## 2. Problem yang Diselesaikan Chunk-Oriented Processing

Banyak workload batch enterprise memiliki bentuk seperti ini:

```text
ambil banyak data
    -> validasi / transformasi / enrich
    -> tulis hasil
    -> ulangi sampai selesai
```

Contoh:

- membaca 5 juta application records untuk recalculation status,
- membaca file CSV besar lalu insert/update ke staging table,
- generate correspondence untuk ribuan case,
- reconcile data internal dengan external registry,
- melakukan enrichment alamat dari postal code,
- mengirim batch notification,
- membersihkan data lama secara bertahap,
- memigrasi data antar schema,
- menghitung ulang SLA ageing,
- memproses record yang pending di outbox table.

Cara paling naif adalah:

```java
List<Record> records = repository.findAllPending();
for (Record record : records) {
    Result result = process(record);
    repository.save(result);
}
```

Masalahnya langsung muncul:

1. **Memory explosion**  
   Semua data bisa termuat di memory.

2. **Long transaction**  
   Jika dibungkus satu transaksi, lock/undo/redo/log akan membesar.

3. **No restart point**  
   Jika gagal di record ke-900.000, dari mana mulai ulang?

4. **Duplicate side effect**  
   Jika sebagian sudah terkirim ke external system, restart bisa mengulang efek yang sama.

5. **Poor observability**  
   Operator hanya melihat job “running” tanpa tahu progress.

6. **Poor operational control**  
   Stop/cancel/retry tidak punya semantics yang jelas.

7. **Failure cost too high**  
   Semakin besar satu unit kerja, semakin mahal jika harus rollback atau replay.

Chunk-oriented processing menyelesaikan problem ini dengan memecah workload menjadi unit yang lebih kecil:

```text
read item by item
process item by item
aggregate into chunk
write chunk
commit transaction
checkpoint progress
repeat
```

Jakarta Batch specification mendefinisikan chunk-oriented processing sebagai pola utama: item dibaca satu per satu dari `ItemReader`, diproses oleh `ItemProcessor`, dikumpulkan menjadi chunk, ditulis oleh `ItemWriter`, lalu chunk tersebut dikomit dalam transaction boundary ketika commit interval/checkpoint terpenuhi.

---

## 3. Mental Model Utama

### 3.1 Chunk adalah unit commit, bukan sekadar batch size

Banyak developer menyamakan chunk size dengan “jumlah item yang dikirim ke writer”. Itu benar, tetapi tidak lengkap.

Chunk adalah gabungan dari beberapa konsep:

```text
chunk = unit write + unit transaction + unit checkpoint + unit retry/rollback impact
```

Artinya, ketika kita memilih `item-count="100"`, kita tidak hanya mengatakan:

> “Writer menerima 100 item.”

Kita juga sedang mengatakan:

> “Satu checkpoint/commit normal terjadi setelah 100 item berhasil melewati read/process/write.”

Konsekuensi:

- jika chunk terlalu kecil, overhead transaksi/checkpoint tinggi;
- jika chunk terlalu besar, rollback mahal;
- jika chunk terlalu besar, memory chunk meningkat;
- jika chunk terlalu besar, lock duration meningkat;
- jika chunk terlalu besar, restart akan mengulang lebih banyak work;
- jika chunk terlalu besar, stop signal lebih lambat terasa.

### 3.2 Reader mengambil input, processor mengubah keputusan item, writer melakukan side effect

Tanggung jawab ideal:

```text
ItemReader     : mengambil item berikutnya + menyimpan posisi baca
ItemProcessor  : transformasi / validasi / filtering item
ItemWriter     : melakukan output side effect terhadap chunk
```

Tanggung jawab yang harus dihindari:

```text
ItemReader     : jangan melakukan write side effect bisnis
ItemProcessor  : jangan melakukan database commit / external send final
ItemWriter     : jangan membaca input besar baru secara liar
```

Alasan utamanya adalah restartability. Jika side effect terjadi terlalu awal, runtime sulit mengetahui apakah side effect itu sudah aman, perlu diulang, atau perlu dikompensasi.

### 3.3 Chunk processing adalah pipeline dengan boundary eksplisit

Mental model:

```text
+-------------+      +----------------+      +--------------+
| ItemReader  | ---> | ItemProcessor  | ---> | ItemWriter   |
| read 1 item |      | process 1 item |      | write chunk  |
+-------------+      +----------------+      +--------------+
       |                      |                       |
       |                      |                       v
       |                      |             transaction commit
       |                      |                       |
       v                      v                       v
read checkpoint        item decision           checkpoint state
```

Reader dan processor bekerja per item. Writer bekerja per chunk.

Ini bukan detail kecil. Ini menentukan:

- di mana state disimpan,
- di mana error diklasifikasikan,
- di mana retry terjadi,
- di mana skip terjadi,
- di mana idempotency harus dijamin,
- di mana audit record dibuat.

### 3.4 Runtime batch mengulang chunk, bukan seluruh job

Secara konseptual:

```text
while (reader has item) {
    begin transaction
    items = []

    while checkpoint not ready:
        input = reader.readItem()
        output = processor.processItem(input)
        if output != null:
            items.add(output)

    writer.writeItems(items)
    save checkpoint
    commit transaction
}
```

Pseudo-code ini disederhanakan. Detail skip, retry, rollback, listener, checkpoint algorithm, transaction management, dan implementation-specific behavior lebih kompleks. Namun mental model ini cukup kuat untuk memahami desain.

---

## 4. Chunk Step vs Batchlet Step

| Aspek | Chunk Step | Batchlet Step |
|---|---|---|
| Bentuk pekerjaan | Banyak item sejenis | Satu task utuh |
| Struktur | Read → process → write | `process()` menjalankan task |
| Commit | Per chunk | Ditentukan manual / oleh transaksi dalam task |
| Checkpoint | Built-in reader/writer checkpoint | Harus dirancang sendiri |
| Restart | Natural jika reader/writer state benar | Manual |
| Skip/retry item | Natural | Manual |
| Cocok untuk | File/data/table/outbox processing | File movement, report, stored procedure, maintenance |
| Risiko utama | Writer tidak idempotent, reader state salah | Loop manual tanpa checkpoint |

Rule of thumb:

```text
Jika workload dapat dimodelkan sebagai banyak item independen/semi-independen,
chunk step biasanya lebih benar daripada batchlet.
```

Namun jangan memaksa chunk untuk semua hal. Jika pekerjaan adalah “generate satu ZIP file final dari beberapa input” atau “invoke satu stored procedure atomic”, batchlet bisa lebih natural.

---

## 5. API Inti Jakarta Batch Chunk

Package utama:

```java
jakarta.batch.api.chunk.ItemReader
jakarta.batch.api.chunk.ItemProcessor
jakarta.batch.api.chunk.ItemWriter
jakarta.batch.api.chunk.AbstractItemReader
jakarta.batch.api.chunk.AbstractItemWriter
jakarta.batch.api.chunk.CheckpointAlgorithm
jakarta.batch.api.chunk.AbstractCheckpointAlgorithm
```

Pada Java EE lama namespace-nya:

```java
javax.batch.api.chunk.*
```

Pada Jakarta EE modern:

```java
jakarta.batch.api.chunk.*
```

Konsepnya sama, tetapi namespace berubah dari `javax` ke `jakarta` sejak transisi Jakarta EE.

---

## 6. JSL Dasar untuk Chunk Step

Contoh minimal:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<job id="caseStatusRecalculationJob"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.1">

    <step id="recalculateCaseStatusStep">
        <chunk item-count="100">
            <reader ref="caseStatusReader"/>
            <processor ref="caseStatusProcessor"/>
            <writer ref="caseStatusWriter"/>
        </chunk>
    </step>
</job>
```

Makna praktis:

- `reader` membaca satu item setiap kali dipanggil.
- `processor` menerima satu item dan menghasilkan output item.
- `writer` menerima list output item per chunk.
- `item-count="100"` berarti checkpoint/commit normal setelah sejumlah item sesuai aturan runtime/spec.

Contoh dengan properties:

```xml
<job id="caseStatusRecalculationJob"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.1">

    <properties>
        <property name="module" value="ENFORCEMENT"/>
    </properties>

    <step id="recalculateCaseStatusStep">
        <properties>
            <property name="pageSize" value="500"/>
            <property name="dryRun" value="false"/>
        </properties>

        <chunk item-count="100">
            <reader ref="caseStatusReader">
                <properties>
                    <property name="status" value="PENDING_RECALCULATION"/>
                </properties>
            </reader>
            <processor ref="caseStatusProcessor"/>
            <writer ref="caseStatusWriter"/>
        </chunk>
    </step>
</job>
```

---

## 7. ItemReader Deep Dive

### 7.1 Tanggung jawab `ItemReader`

`ItemReader` adalah abstraction untuk mengambil input item satu per satu.

Tanggung jawabnya:

1. membuka resource input,
2. membaca item berikutnya,
3. memberi sinyal ketika input habis,
4. menyimpan checkpoint state posisi baca,
5. memulihkan posisi baca saat restart,
6. menutup resource.

Secara mental:

```text
Reader = cursor/iterator yang restart-aware
```

Bukan:

```text
Reader = service bisnis yang boleh melakukan semua hal
```

### 7.2 Lifecycle umum reader

Secara umum reader memiliki lifecycle:

```text
open(checkpointInfo)
readItem()
readItem()
readItem()
...
checkpointInfo()
close()
```

Jika job restart, runtime dapat memanggil `open()` dengan checkpoint info terakhir.

### 7.3 Bentuk API konseptual

Bentuk umum:

```java
public interface ItemReader {
    void open(Serializable checkpoint) throws Exception;
    void close() throws Exception;
    Object readItem() throws Exception;
    Serializable checkpointInfo() throws Exception;
}
```

Dalam implementasi nyata, kamu bisa mengimplementasikan `ItemReader` langsung atau extend `AbstractItemReader` untuk default implementation metode tertentu.

### 7.4 `readItem()` dan sinyal selesai

Reader harus mengembalikan item berikutnya. Jika tidak ada item lagi, reader mengembalikan `null`.

Contoh mental:

```java
@Override
public Object readItem() throws Exception {
    if (!hasMore()) {
        return null;
    }
    return nextItem();
}
```

Penting:

```text
null dari reader = input habis
null dari processor = item difilter / tidak ditulis
```

Keduanya berbeda.

### 7.5 Reader state harus minimal dan serializable

Checkpoint info reader harus bisa disimpan oleh job repository. Maka state harus:

- kecil,
- serializable,
- stabil,
- cukup untuk resume,
- tidak bergantung pada object runtime seperti `Connection`, `ResultSet`, stream, atau entity managed.

Contoh state yang buruk:

```java
private ResultSet resultSet; // jangan disimpan sebagai checkpoint
private EntityManager em;    // bukan checkpoint state
private InputStream in;      // bukan checkpoint state
```

Contoh state yang lebih baik:

```java
public record ReaderCheckpoint(
        long lastProcessedId,
        int lineNumber,
        String inputFileChecksum
) implements Serializable {}
```

### 7.6 Reader database: cursor vs paging vs keyset

Ada beberapa pola umum.

#### A. Cursor reader

Reader membuka cursor dan membaca row satu per satu.

Kelebihan:

- streaming natural,
- memory rendah,
- cocok untuk scan besar.

Risiko:

- cursor bisa invalid saat restart,
- long-running cursor rentan timeout,
- koneksi tertahan lama,
- transaction boundary perlu hati-hati,
- database resource bisa mahal.

#### B. Offset paging reader

```sql
SELECT *
FROM CASE_TABLE
WHERE STATUS = 'PENDING'
ORDER BY ID
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
```

Kelebihan:

- mudah dipahami,
- stateless antar page.

Risiko:

- offset besar makin mahal,
- data berubah bisa menyebabkan skip/duplicate,
- tidak ideal untuk table besar yang aktif berubah.

#### C. Keyset reader

```sql
SELECT *
FROM CASE_TABLE
WHERE STATUS = 'PENDING'
  AND ID > :lastSeenId
ORDER BY ID
FETCH FIRST :limit ROWS ONLY
```

Kelebihan:

- cocok untuk restart,
- lebih stabil daripada offset,
- performa baik dengan index yang benar,
- checkpoint cukup `lastSeenId`.

Risiko:

- butuh ordering key yang stabil,
- perlu strategi jika record baru masuk saat job berjalan,
- perlu snapshot boundary jika ingin input set fixed.

Untuk enterprise batch, keyset reader sering lebih defensible daripada offset paging.

### 7.7 Reader harus menentukan input set semantics

Pertanyaan penting:

```text
Apakah job memproses semua record yang matching saat job dimulai,
atau juga record baru yang masuk selama job berjalan?
```

Dua model:

#### Model 1 — Open-ended scan

```text
Selama status masih PENDING dan ID > lastSeenId, process.
```

Cocok untuk queue/outbox-like workload.

Risiko:

- job bisa berjalan lebih lama jika input terus bertambah,
- hasil tiap run kurang deterministik.

#### Model 2 — Snapshot input set

Saat job start:

```sql
UPDATE CASE_TABLE
SET BATCH_RUN_ID = :jobExecutionId
WHERE STATUS = 'PENDING'
  AND BATCH_RUN_ID IS NULL;
```

Lalu reader membaca:

```sql
SELECT *
FROM CASE_TABLE
WHERE BATCH_RUN_ID = :jobExecutionId
ORDER BY ID
```

Kelebihan:

- input set jelas,
- audit lebih kuat,
- restart lebih mudah,
- tidak tercampur record baru.

Risiko:

- butuh marking phase,
- butuh cleanup jika job abandon.

Untuk regulatory/compliance workloads, snapshot input set sering lebih mudah dipertanggungjawabkan.

---

## 8. ItemProcessor Deep Dive

### 8.1 Tanggung jawab `ItemProcessor`

`ItemProcessor` melakukan business processing terhadap satu item input dan menghasilkan satu item output.

Tanggung jawab ideal:

- validasi item,
- transformasi DTO/input menjadi command/output,
- enrichment ringan,
- business decision,
- filtering,
- mapping ke write model.

Tanggung jawab yang sebaiknya dihindari:

- commit database,
- send email final,
- call external system yang menghasilkan side effect irreversible,
- update status final,
- menyimpan state global mutable tanpa kontrol.

Kenapa?

Karena processor dieksekusi sebelum writer dan sebelum chunk commit final. Jika processor melakukan side effect, lalu writer gagal, runtime bisa mengulang processor pada retry/restart dan side effect bisa duplicate.

### 8.2 Processor sebagai pure-ish function

Idealnya processor mendekati fungsi:

```text
Output process(Input input)
```

Lebih baik lagi:

```text
Output = deterministic decision from input + reference data snapshot
```

Contoh:

```java
@Named
public class CaseStatusProcessor implements ItemProcessor {

    @Override
    public Object processItem(Object item) throws Exception {
        CaseInput input = (CaseInput) item;

        if (input.closed()) {
            return null; // filtered: tidak perlu ditulis
        }

        CaseStatus newStatus = decideStatus(input);

        return new CaseStatusUpdate(
                input.caseId(),
                input.version(),
                newStatus,
                "RULE_AGEING_V3"
        );
    }
}
```

### 8.3 `null` dari processor berarti filter

Processor boleh mengembalikan `null`. Secara konseptual, ini berarti item tidak diteruskan ke writer.

Contoh:

```java
@Override
public Object processItem(Object item) throws Exception {
    CaseInput input = (CaseInput) item;

    if (!input.needsRecalculation()) {
        return null;
    }

    return transform(input);
}
```

Penting membedakan:

| Kondisi | Makna |
|---|---|
| Reader returns `null` | Input habis |
| Processor returns `null` | Item difilter, bukan error |
| Processor throws exception | Item gagal diproses |

Filtering bukan skipping.

- **Filtering**: item valid tetapi tidak perlu ditulis.
- **Skipping**: item/error diklasifikasikan sebagai boleh dilewati karena gagal.

### 8.4 Processor dan reference data

Processor sering butuh reference data:

- rule configuration,
- status mapping,
- holiday calendar,
- agency/module mapping,
- risk score threshold,
- external registry snapshot.

Strategi:

1. load reference data once per step,
2. cache immutable reference data,
3. version reference data,
4. audit rule version,
5. hindari query DB per item jika bisa.

Contoh buruk:

```java
public Object processItem(Object item) {
    // query DB untuk config yang sama ribuan kali
    RuleConfig config = configRepository.findActiveConfig();
    return decide(item, config);
}
```

Contoh lebih baik:

```java
@Named
public class CaseStatusProcessor implements ItemProcessor {

    private volatile RuleConfigSnapshot config;

    @Inject
    RuleConfigService configService;

    @Inject
    StepContext stepContext;

    @PostConstruct
    void init() {
        this.config = configService.loadSnapshot("CASE_STATUS_RULES");
        stepContext.setTransientUserData(config.version());
    }

    @Override
    public Object processItem(Object item) {
        return decide((CaseInput) item, config);
    }
}
```

Catatan: detail lifecycle CDI artifact bisa berbeda antar runtime; pastikan artifact creation dan injection sesuai server yang dipakai.

### 8.5 Processor dan external API

Processor yang memanggil external API perlu sangat hati-hati.

Jika API call hanya read-only/enrichment:

```text
boleh, tetapi tetap perlu timeout, rate limit, cache, retry policy, dan fallback.
```

Jika API call punya side effect:

```text
jangan dilakukan di processor; pindahkan ke writer atau outbox.
```

Alasan:

```text
processor bisa dieksekusi ulang sebelum chunk commit selesai.
```

Pola aman:

```text
processor membuat ExternalCommand
writer menyimpan ExternalCommand ke outbox dengan idempotency key
separate worker mengirim outbox secara governed
```

---

## 9. ItemWriter Deep Dive

### 9.1 Tanggung jawab `ItemWriter`

`ItemWriter` menerima list item output dan menulisnya sebagai satu chunk.

Tanggung jawabnya:

- melakukan write side effect utama,
- menjaga idempotency,
- memanfaatkan batch write API jika ada,
- menghindari partial write yang tidak bisa dipulihkan,
- menyimpan checkpoint writer jika diperlukan,
- memberi error yang dapat diklasifikasikan untuk retry/skip/rollback.

### 9.2 Writer bekerja dengan list item

Bentuk konseptual:

```java
public interface ItemWriter {
    void open(Serializable checkpoint) throws Exception;
    void close() throws Exception;
    void writeItems(List<Object> items) throws Exception;
    Serializable checkpointInfo() throws Exception;
}
```

Contoh:

```java
@Named
public class CaseStatusWriter extends AbstractItemWriter {

    @Inject
    CaseStatusRepository repository;

    @Override
    public void writeItems(List<Object> items) throws Exception {
        List<CaseStatusUpdate> updates = items.stream()
                .map(CaseStatusUpdate.class::cast)
                .toList();

        repository.bulkUpdateStatus(updates);
    }
}
```

### 9.3 Writer harus idempotent

Pertanyaan terpenting untuk writer:

```text
Jika writeItems(items) dipanggil lagi untuk chunk yang sama,
apakah hasil akhirnya tetap benar?
```

Jika jawabannya tidak, restart/retry berbahaya.

Contoh writer tidak idempotent:

```sql
INSERT INTO NOTIFICATION_OUTBOX (CASE_ID, TEMPLATE_ID, STATUS)
VALUES (?, ?, 'PENDING')
```

Jika chunk diulang, outbox duplicate.

Lebih aman:

```sql
INSERT INTO NOTIFICATION_OUTBOX
    (IDEMPOTENCY_KEY, CASE_ID, TEMPLATE_ID, STATUS)
VALUES
    (:idempotencyKey, :caseId, :templateId, 'PENDING')
ON CONFLICT / MERGE DO NOTHING
```

Untuk Oracle:

```sql
MERGE INTO NOTIFICATION_OUTBOX target
USING (
    SELECT :idempotency_key AS IDEMPOTENCY_KEY,
           :case_id AS CASE_ID,
           :template_id AS TEMPLATE_ID
    FROM dual
) source
ON (target.IDEMPOTENCY_KEY = source.IDEMPOTENCY_KEY)
WHEN NOT MATCHED THEN
    INSERT (IDEMPOTENCY_KEY, CASE_ID, TEMPLATE_ID, STATUS, CREATED_AT)
    VALUES (source.IDEMPOTENCY_KEY, source.CASE_ID, source.TEMPLATE_ID, 'PENDING', SYSTIMESTAMP)
```

### 9.4 Writer harus tahu apakah partial write mungkin terjadi

Ada dua model writer:

#### A. Atomic writer

Semua item dalam chunk berhasil atau gagal dalam satu transaction.

```text
write 100 updates
commit
```

Jika gagal sebelum commit, rollback semua.

Ini ideal.

#### B. Partially effective writer

Sebagian item bisa sudah efektif walaupun writer melempar exception.

Contoh:

- external API call per item,
- file append tanpa atomic temp file,
- email send,
- remote system tanpa idempotency,
- database autocommit tidak sengaja aktif.

Model ini berbahaya karena runtime batch mungkin menganggap chunk gagal dan mencoba lagi.

Solusi:

- hindari side effect irreversible di writer langsung,
- gunakan outbox,
- gunakan idempotency key,
- gunakan staging + finalize,
- gunakan temp file + atomic rename,
- gunakan database transaction yang benar,
- gunakan external API idempotency jika tersedia.

### 9.5 Writer database: batch update

Contoh JDBC-style repository:

```java
@ApplicationScoped
public class CaseStatusRepository {

    @Resource(lookup = "java:comp/DefaultDataSource")
    DataSource dataSource;

    public void bulkUpdateStatus(List<CaseStatusUpdate> updates) throws SQLException {
        String sql = """
            UPDATE CASE_TABLE
               SET STATUS = ?,
                   STATUS_RULE_VERSION = ?,
                   UPDATED_AT = SYSTIMESTAMP
             WHERE CASE_ID = ?
               AND VERSION = ?
            """;

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {

            for (CaseStatusUpdate update : updates) {
                ps.setString(1, update.newStatus().name());
                ps.setString(2, update.ruleVersion());
                ps.setLong(3, update.caseId());
                ps.setLong(4, update.expectedVersion());
                ps.addBatch();
            }

            int[] counts = ps.executeBatch();
            verifyUpdateCounts(updates, counts);
        }
    }

    private void verifyUpdateCounts(List<CaseStatusUpdate> updates, int[] counts) {
        for (int i = 0; i < counts.length; i++) {
            if (counts[i] == 0) {
                throw new OptimisticBatchConflictException(
                        "Case was modified concurrently: " + updates.get(i).caseId());
            }
        }
    }
}
```

Catatan:

- Dalam container/JTA, connection transaction biasanya dikelola container.
- Jangan memanggil `connection.commit()` manual jika transaction dikelola container.
- Pastikan autocommit tidak merusak boundary transaksi.

---

## 10. Transaction Boundary dalam Chunk

### 10.1 Apa yang biasanya berada dalam transaksi?

Secara konseptual, satu chunk dibungkus transaction boundary:

```text
begin tx
  read/process item 1
  read/process item 2
  ...
  write chunk
  checkpoint
commit tx
```

Namun detail persis bisa bergantung pada runtime dan resource. Yang penting untuk desain:

```text
anggap write chunk + checkpoint adalah satu unit konsistensi yang harus aman terhadap rollback/retry.
```

### 10.2 Commit interval adalah pilihan arsitektural

Misalnya:

```xml
<chunk item-count="100">
```

Trade-off:

| Commit Interval | Kelebihan | Kekurangan |
|---:|---|---|
| 1 | Failure impact kecil, checkpoint detail | Overhead transaksi tinggi, lambat |
| 10–100 | Balance umum | Butuh tuning berdasarkan workload |
| 1000+ | Throughput tinggi jika write efisien | Rollback mahal, memory/lock tinggi |
| Sangat besar | Sedikit commit | Hampir menjadi long transaction anti-pattern |

### 10.3 Commit interval dan lock duration

Jika writer melakukan update banyak row, chunk size besar dapat membuat lock ditahan lebih lama.

Dampaknya:

- request online bisa menunggu,
- batch lain bisa block,
- deadlock probability naik,
- undo/redo pressure naik,
- replication lag bisa naik,
- timeout bisa meningkat.

Untuk sistem case management yang digunakan user aktif, chunk size harus mempertimbangkan dampak terhadap online workload.

### 10.4 Commit interval dan restart cost

Jika chunk size 1000 dan job gagal setelah memproses 999 item tapi sebelum commit, restart dapat mengulang 999 item.

Jika processing ringan, ini mungkin tidak masalah.

Jika processing mahal atau external read API mahal, ini signifikan.

---

## 11. Checkpoint dalam Chunk Step

Checkpoint adalah state yang memungkinkan runtime melanjutkan dari titik tertentu setelah commit.

Untuk reader, checkpoint biasanya adalah posisi input.

Contoh:

```java
public record CaseReaderCheckpoint(long lastSeenCaseId) implements Serializable {}
```

### 11.1 Checkpoint reader keyset

```java
@Named
public class CaseStatusReader extends AbstractItemReader {

    @Inject
    CaseQueryRepository repository;

    private long lastSeenId;
    private Iterator<CaseInput> buffer = List.<CaseInput>of().iterator();

    @Override
    public void open(Serializable checkpoint) throws Exception {
        if (checkpoint instanceof CaseReaderCheckpoint cp) {
            this.lastSeenId = cp.lastSeenCaseId();
        } else {
            this.lastSeenId = 0L;
        }
    }

    @Override
    public Object readItem() throws Exception {
        if (!buffer.hasNext()) {
            List<CaseInput> page = repository.findNextPendingCases(lastSeenId, 500);
            if (page.isEmpty()) {
                return null;
            }
            buffer = page.iterator();
        }

        CaseInput next = buffer.next();
        lastSeenId = next.caseId();
        return next;
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        return new CaseReaderCheckpoint(lastSeenId);
    }
}
```

### 11.2 Hidden risk: updating checkpoint too early

Pada contoh di atas, `lastSeenId` berubah saat item dibaca, sebelum chunk commit.

Apakah ini aman?

Secara umum, checkpoint info disimpan saat checkpoint/commit. Jika chunk gagal sebelum checkpoint commit, runtime akan memakai checkpoint lama. Maka item yang sudah dibaca tapi belum committed akan dibaca ulang. Itu normal.

Namun hati-hati jika reader sendiri mengubah database sebagai tanda “sudah dibaca”. Itu bisa membuat item hilang dari restart.

Contoh berbahaya:

```java
public Object readItem() {
    CaseInput item = findNextPending();
    markAsRead(item.caseId()); // side effect terlalu awal
    return item;
}
```

Jika processor/writer gagal, record sudah ditandai read padahal belum diproses final.

Solusi:

- reader jangan mutate status final,
- gunakan writer untuk mark processed,
- gunakan claim pattern yang transaction-aware,
- gunakan input snapshot table,
- gunakan `PROCESSING` lease dengan expiry jika perlu.

---

## 12. Designing Reader/Processor/Writer as Contracts

### 12.1 Contract reader

Reader harus menjawab:

1. Apa input universe-nya?
2. Bagaimana ordering-nya?
3. Bagaimana mendeteksi akhir input?
4. Apa checkpoint state-nya?
5. Apakah restart membaca ulang item terakhir?
6. Apakah input bisa berubah saat job berjalan?
7. Apakah reader memegang resource lama?
8. Apakah reader aman jika step dihentikan?

### 12.2 Contract processor

Processor harus menjawab:

1. Apakah pure/deterministic?
2. Apa input invalid vs filtered?
3. Exception apa yang retryable?
4. Exception apa yang skippable?
5. Apakah processor memanggil external dependency?
6. Apakah reference data version diaudit?
7. Apakah processor punya mutable state?
8. Apakah output cukup untuk writer idempotent?

### 12.3 Contract writer

Writer harus menjawab:

1. Apakah write atomic per chunk?
2. Apakah write idempotent?
3. Apa idempotency key-nya?
4. Apa yang terjadi jika sebagian item gagal?
5. Bagaimana conflict ditangani?
6. Apakah writer boleh retry?
7. Apakah writer menghasilkan audit record?
8. Apakah writer membuat side effect external langsung?
9. Apakah writer bisa membedakan duplicate safe vs corruption?

---

## 13. Example Domain: Regulatory Case Status Recalculation

Kita gunakan domain case management regulatory:

```text
Tujuan:
Recalculate status enforcement case berdasarkan SLA ageing, open action, appeal state,
dan compliance response.
```

Input:

```text
CASE_TABLE
- CASE_ID
- STATUS
- VERSION
- SLA_DUE_DATE
- LAST_ACTIVITY_DATE
- HAS_OPEN_ACTION
- HAS_PENDING_APPEAL
- MODULE
```

Output:

```text
CASE_STATUS_UPDATE
- CASE_ID
- OLD_STATUS
- NEW_STATUS
- RULE_VERSION
- REASON_CODE
```

Writer update:

```text
CASE_TABLE.STATUS
CASE_TABLE.STATUS_RULE_VERSION
CASE_AUDIT_TRAIL
```

### 13.1 JSL

```xml
<job id="caseStatusRecalculationJob"
     xmlns="https://jakarta.ee/xml/ns/jakartaee"
     version="2.1">

    <properties>
        <property name="ruleVersion" value="CASE_STATUS_RULES_V3"/>
    </properties>

    <step id="recalculateCaseStatus">
        <chunk item-count="100">
            <reader ref="caseStatusReader">
                <properties>
                    <property name="module" value="ENFORCEMENT"/>
                    <property name="pageSize" value="500"/>
                </properties>
            </reader>
            <processor ref="caseStatusProcessor"/>
            <writer ref="caseStatusWriter"/>
        </chunk>
    </step>
</job>
```

### 13.2 Model classes

```java
public record CaseInput(
        long caseId,
        long version,
        String module,
        CaseStatus currentStatus,
        Instant slaDueDate,
        Instant lastActivityDate,
        boolean hasOpenAction,
        boolean hasPendingAppeal
) implements Serializable {}

public record CaseStatusUpdate(
        long caseId,
        long expectedVersion,
        CaseStatus oldStatus,
        CaseStatus newStatus,
        String ruleVersion,
        String reasonCode,
        String idempotencyKey
) implements Serializable {}

enum CaseStatus {
    OPEN,
    PENDING_ACTION,
    OVERDUE,
    UNDER_APPEAL,
    CLOSED
}
```

### 13.3 Reader

```java
@Named("caseStatusReader")
public class CaseStatusReader extends AbstractItemReader {

    @Inject
    CaseQueryRepository repository;

    @Inject
    @BatchProperty(name = "module")
    String module;

    @Inject
    @BatchProperty(name = "pageSize")
    String pageSizeProperty;

    private int pageSize;
    private long lastSeenCaseId;
    private Iterator<CaseInput> currentPage = Collections.emptyIterator();

    @Override
    public void open(Serializable checkpoint) throws Exception {
        this.pageSize = Integer.parseInt(pageSizeProperty);

        if (checkpoint instanceof CaseReaderCheckpoint cp) {
            this.lastSeenCaseId = cp.lastSeenCaseId();
        } else {
            this.lastSeenCaseId = 0L;
        }
    }

    @Override
    public Object readItem() throws Exception {
        if (!currentPage.hasNext()) {
            List<CaseInput> nextPage = repository.findNextCasesForRecalculation(
                    module,
                    lastSeenCaseId,
                    pageSize
            );

            if (nextPage.isEmpty()) {
                return null;
            }

            currentPage = nextPage.iterator();
        }

        CaseInput item = currentPage.next();
        lastSeenCaseId = item.caseId();
        return item;
    }

    @Override
    public Serializable checkpointInfo() throws Exception {
        return new CaseReaderCheckpoint(lastSeenCaseId);
    }

    public record CaseReaderCheckpoint(long lastSeenCaseId) implements Serializable {}
}
```

### 13.4 Processor

```java
@Named("caseStatusProcessor")
public class CaseStatusProcessor implements ItemProcessor {

    @Inject
    RuleVersionProvider ruleVersionProvider;

    @Override
    public Object processItem(Object item) throws Exception {
        CaseInput input = (CaseInput) item;

        if (input.currentStatus() == CaseStatus.CLOSED) {
            return null;
        }

        CaseStatus newStatus = decideStatus(input);

        if (newStatus == input.currentStatus()) {
            return null;
        }

        String ruleVersion = ruleVersionProvider.currentCaseStatusRuleVersion();
        String reasonCode = reasonCode(input, newStatus);
        String idempotencyKey = "CASE_STATUS_RECALC:" + ruleVersion + ":" + input.caseId();

        return new CaseStatusUpdate(
                input.caseId(),
                input.version(),
                input.currentStatus(),
                newStatus,
                ruleVersion,
                reasonCode,
                idempotencyKey
        );
    }

    private CaseStatus decideStatus(CaseInput input) {
        if (input.hasPendingAppeal()) {
            return CaseStatus.UNDER_APPEAL;
        }
        if (input.hasOpenAction()) {
            return CaseStatus.PENDING_ACTION;
        }
        if (Instant.now().isAfter(input.slaDueDate())) {
            return CaseStatus.OVERDUE;
        }
        return CaseStatus.OPEN;
    }

    private String reasonCode(CaseInput input, CaseStatus newStatus) {
        return switch (newStatus) {
            case UNDER_APPEAL -> "PENDING_APPEAL";
            case PENDING_ACTION -> "OPEN_ACTION";
            case OVERDUE -> "SLA_EXCEEDED";
            case OPEN -> "NORMAL";
            case CLOSED -> "CLOSED";
        };
    }
}
```

Critical note:

```java
Instant.now()
```

Untuk audit defensibility, lebih baik job punya `asOfTime` parameter yang stabil, bukan `now()` berbeda per item.

Lebih baik:

```java
Instant asOf = Instant.parse(jobParameters.get("asOfTime"));
```

### 13.5 Writer

```java
@Named("caseStatusWriter")
public class CaseStatusWriter extends AbstractItemWriter {

    @Inject
    CaseStatusRepository repository;

    @Inject
    BatchAuditRepository auditRepository;

    @Override
    public void writeItems(List<Object> items) throws Exception {
        List<CaseStatusUpdate> updates = items.stream()
                .map(CaseStatusUpdate.class::cast)
                .toList();

        if (updates.isEmpty()) {
            return;
        }

        repository.applyStatusUpdates(updates);
        auditRepository.insertCaseStatusAudit(updates);
    }
}
```

Repository write harus berada dalam transaction yang sama jika ingin atomic:

```text
status update + audit insert + checkpoint commit
```

Jika audit insert sukses tetapi status update gagal, atau sebaliknya, hasil menjadi tidak konsisten. Gunakan satu transaction boundary.

---

## 14. Chunk Step untuk File Processing

Untuk file CSV besar:

```text
reader    : stream line by line
processor : parse, validate, normalize
writer    : batch insert into staging table
```

### 14.1 Reader checkpoint untuk file

Checkpoint bisa berupa:

```java
public record FileReaderCheckpoint(
        String fileName,
        String checksum,
        long lineNumber
) implements Serializable {}
```

Mengapa checksum penting?

Jika file berubah antara run dan restart, line number yang sama tidak lagi berarti item yang sama.

### 14.2 File reader pitfalls

Anti-pattern:

```java
Files.readAllLines(path)
```

Untuk file besar, ini memory explosion.

Lebih baik streaming:

```java
BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8);
```

Namun restart ke line ke-900.000 dengan `BufferedReader` berarti harus skip 899.999 line, kecuali ada index. Untuk file sangat besar, pertimbangkan:

- split file upstream,
- staging table first,
- byte offset checkpoint dengan hati-hati terhadap encoding,
- manifest + chunked file ingestion,
- partitioning per file segment jika aman.

### 14.3 Writer untuk file output

Untuk output file, jangan append langsung ke final file jika restart bisa mengulang.

Lebih aman:

```text
write to temp file per jobExecution/stepExecution
on successful step/job -> atomic rename to final path
```

Atau:

```text
write item output to DB staging table
finalize file in later step
```

---

## 15. Chunk Step untuk Outbox Processing

Outbox table adalah workload chunk yang sangat natural.

```text
reader    : read pending outbox messages
processor : build request payload
writer    : send or mark for sending
```

Namun ada dua desain.

### 15.1 Direct send writer

```text
writer sends HTTP/email/message directly
```

Risiko:

- external side effect bisa sukses lalu transaction gagal,
- retry bisa duplicate,
- sulit guarantee exactly-once.

Bisa diterima jika external system punya idempotency key dan writer mencatat result dengan benar.

### 15.2 Dispatch command writer

```text
writer marks records as READY_TO_SEND / CLAIMED
separate managed worker sends with idempotency
```

Atau batch step sendiri bisa menjadi sender, tetapi harus:

- claim item dengan lease,
- send dengan idempotency key,
- update sent status,
- handle unknown outcome,
- avoid double send.

Untuk critical correspondence/regulatory notification, outbox state machine biasanya lebih defensible.

---

## 16. Error Handling Overview

Part 22 nanti akan membahas skip/retry/rollback mendalam. Di Part 20, kita cukup punya mental model dasar.

### 16.1 Error di reader

Kemungkinan:

- input source unavailable,
- malformed file line,
- DB timeout,
- cursor invalid,
- permission error,
- checkpoint corrupt.

Reader error sering berarti:

```text
belum ada output item untuk current read
```

Tetapi jika reader melakukan side effect, error menjadi ambiguous. Itu alasan reader sebaiknya read-only.

### 16.2 Error di processor

Kemungkinan:

- validation failure,
- reference data missing,
- business rule conflict,
- external enrichment timeout,
- unexpected null/data corruption.

Processor error bisa diklasifikasikan:

- retryable: temporary dependency failure,
- skippable: bad item yang boleh dilewati,
- fatal: rule/config corrupt.

### 16.3 Error di writer

Writer error paling berbahaya karena side effect mungkin sudah sebagian terjadi.

Kemungkinan:

- unique constraint violation,
- optimistic lock conflict,
- DB timeout,
- network failure,
- external API 429/500,
- partial file write,
- serialization failure.

Untuk writer, desain idempotency lebih penting daripada berharap retry sempurna.

---

## 17. Memory Behavior

Chunk processing hemat memory jika reader streaming dan writer segera flush per chunk.

Namun memory bisa membesar karena:

1. reader prefetch terlalu besar,
2. processor output terlalu berat,
3. writer menahan item setelah write,
4. persistence context tidak dibersihkan,
5. reference cache terlalu besar,
6. chunk item-count terlalu besar,
7. item berisi BLOB/CLOB besar.

### 17.1 JPA persistence context issue

Jika writer memakai JPA dan memproses banyak entity:

```java
for (Entity e : entities) {
    entityManager.merge(e);
}
```

Persistence context bisa membesar.

Biasanya perlu:

```java
entityManager.flush();
entityManager.clear();
```

Namun hati-hati: di transaction-managed context, flush/clear harus sesuai lifecycle dan tidak merusak object yang masih diperlukan.

Untuk batch update besar, JDBC batch sering lebih predictable daripada JPA entity graph.

### 17.2 Large payload strategy

Jangan membawa payload besar melewati processor jika tidak perlu.

Buruk:

```java
record CaseInput(long caseId, String hugeClobFullText, byte[] attachment) {}
```

Lebih baik:

```java
record CaseInput(long caseId, String metadata, BlobReference blobRef) {}
```

Writer atau dedicated step mengambil payload besar hanya saat perlu.

---

## 18. Throughput Model

Throughput chunk step dipengaruhi oleh:

```text
reader latency
processor latency per item
writer latency per chunk
transaction commit overhead
checkpoint overhead
DB/API capacity
thread/concurrency model
partition count
```

Approximation:

```text
chunk_duration ~= sum(read_i + process_i for N items)
                 + write_chunk_duration
                 + commit_duration
                 + checkpoint_duration
```

Throughput:

```text
items_per_second ~= item_count / chunk_duration
```

Jika processor CPU-heavy, chunk size besar tidak selalu mempercepat.

Jika writer fixed overhead tinggi, chunk size lebih besar bisa membantu.

Jika DB lock contention tinggi, chunk size lebih besar bisa merusak latency sistem lain.

### 18.1 Tuning approach

Jangan mulai dari “chunk size 1000 karena terlihat cepat”.

Mulai dari baseline:

```text
item-count 50 atau 100
ukur duration, DB load, lock wait, rollback cost
naik/turun berdasarkan evidence
```

Metrics yang harus dilihat:

- chunk duration p50/p95/p99,
- item processing rate,
- writer batch duration,
- commit duration,
- DB CPU,
- DB wait event,
- connection pool usage,
- lock wait,
- retry count,
- skip count,
- rollback count,
- GC allocation rate,
- memory after each chunk.

---

## 19. Reader Ordering and Determinism

Reader harus punya ordering stabil.

Buruk:

```sql
SELECT * FROM CASE_TABLE WHERE STATUS = 'PENDING'
```

Tanpa `ORDER BY`, database bebas mengembalikan urutan berbeda.

Lebih baik:

```sql
SELECT *
FROM CASE_TABLE
WHERE STATUS = 'PENDING'
  AND CASE_ID > :lastSeenId
ORDER BY CASE_ID
FETCH FIRST :limit ROWS ONLY
```

Ordering stabil penting untuk:

- checkpoint,
- restart,
- reproducibility,
- audit,
- debugging,
- deterministic test.

Jika ordering key bukan unique, gunakan composite key:

```sql
ORDER BY CREATED_AT, CASE_ID
```

Checkpoint:

```java
record Checkpoint(Instant lastCreatedAt, long lastCaseId) implements Serializable {}
```

Query:

```sql
WHERE (CREATED_AT > :lastCreatedAt)
   OR (CREATED_AT = :lastCreatedAt AND CASE_ID > :lastCaseId)
ORDER BY CREATED_AT, CASE_ID
```

---

## 20. Optimistic Concurrency in Writer

Batch sering berjalan bersamaan dengan user online.

Skenario:

1. reader membaca case version 5,
2. user update case menjadi version 6,
3. writer mencoba update berdasarkan version 5.

Jika writer melakukan:

```sql
UPDATE CASE_TABLE
SET STATUS = :newStatus
WHERE CASE_ID = :caseId
```

Maka update user bisa tertimpa.

Lebih aman:

```sql
UPDATE CASE_TABLE
SET STATUS = :newStatus,
    VERSION = VERSION + 1
WHERE CASE_ID = :caseId
  AND VERSION = :expectedVersion
```

Jika affected row = 0, terjadi optimistic conflict.

Policy:

- retry read/process item,
- skip with conflict report,
- fail step,
- enqueue for later review,
- apply business-specific merge.

Untuk regulatory system, silent overwrite biasanya tidak defensible.

---

## 21. Idempotency Key Design

Idempotency key harus stabil untuk logical side effect.

Format contoh:

```text
<jobLogicalName>:<ruleVersion>:<businessEntityId>:<effectType>
```

Contoh:

```text
CASE_STATUS_RECALC:V3:CASE-100240:STATUS_UPDATE
CORRESPONDENCE_GEN:TEMPLATE-A:CASE-100240:NOTICE-OVERDUE
```

Jangan gunakan random UUID sebagai idempotency key untuk effect yang perlu dedup across retry.

Buruk:

```java
String idempotencyKey = UUID.randomUUID().toString();
```

Karena setiap retry menghasilkan key baru.

Lebih baik:

```java
String idempotencyKey = "CASE_STATUS_RECALC:%s:%d".formatted(ruleVersion, caseId);
```

---

## 22. Filtering, Skipping, and Business Semantics

### 22.1 Filtering

Filtering berarti item valid tetapi tidak perlu ditulis.

Contoh:

```text
Case sudah CLOSED, tidak perlu recalculation.
```

Processor return `null`.

### 22.2 Skipping

Skipping berarti ada error/invalid item tetapi job boleh lanjut.

Contoh:

```text
Satu row CSV invalid format, tapi policy memperbolehkan maksimal 100 invalid rows.
```

Skip harus diaudit.

### 22.3 Retrying

Retry berarti error dianggap transient.

Contoh:

```text
DB deadlock, HTTP 503, temporary lock wait timeout.
```

Retry tanpa idempotency = duplicate risk.

### 22.4 Fatal failure

Fatal berarti job harus berhenti.

Contoh:

```text
Rule config missing, schema mismatch, input file checksum mismatch.
```

Fatal failure harus jelas agar operator tidak restart membabi buta.

---

## 23. Observability untuk Chunk Step

Minimal metrics:

```text
job_execution_id
step_execution_id
items_read
items_processed
items_filtered
items_written
chunks_committed
chunks_rolled_back
read_errors
process_errors
write_errors
skip_count
retry_count
chunk_duration
reader_latency
processor_latency
writer_latency
commit_latency
```

Log per chunk:

```json
{
  "event": "batch.chunk.committed",
  "job": "caseStatusRecalculationJob",
  "step": "recalculateCaseStatus",
  "jobExecutionId": 12345,
  "stepExecutionId": 67890,
  "chunkNo": 42,
  "readCount": 100,
  "writeCount": 83,
  "filterCount": 17,
  "durationMs": 482,
  "lastCheckpoint": "caseId=908881"
}
```

Do not log full sensitive payload.

For audit, store business-level result:

```text
caseId, oldStatus, newStatus, ruleVersion, reasonCode, jobExecutionId, changedAt
```

---

## 24. Testing Strategy

### 24.1 Unit test reader

Test:

- reads first item,
- returns null at end,
- checkpoint after N items,
- restart from checkpoint,
- ordering stable,
- empty input,
- changed input behavior.

### 24.2 Unit test processor

Test:

- valid transformation,
- filtered item returns null,
- invalid item exception,
- reference data version,
- deterministic output,
- no side effect.

### 24.3 Unit test writer

Test:

- writes chunk successfully,
- duplicate write same chunk safe,
- optimistic conflict detected,
- partial failure behavior,
- audit inserted with status update,
- empty item list safe.

### 24.4 Integration test chunk restart

Scenario:

1. Run job with 250 items and chunk size 100.
2. Force failure after second chunk partially processed.
3. Restart job.
4. Verify:
   - no duplicate output,
   - final count correct,
   - checkpoint resumed correctly,
   - audit not duplicated,
   - skipped/failed records reported.

### 24.5 Kill test

For production confidence:

1. Start job.
2. Kill pod/server during writer or before commit.
3. Restart job.
4. Verify consistency.

This is often where beautiful batch code fails in reality.

---

## 25. Design Patterns

### 25.1 Keyset Checkpoint Reader

Use stable monotonic key:

```text
lastSeenId
```

Best for:

- large DB table,
- restartable scan,
- no offset cost.

### 25.2 Snapshot Input Set

Mark input records with run id before processing.

Best for:

- compliance workload,
- audit reproducibility,
- deterministic job.

### 25.3 Transform-Only Processor

Processor has no final side effect.

Best for:

- retry/restart safety,
- testability,
- clear boundary.

### 25.4 Idempotent Writer

Writer uses deterministic key or merge/upsert.

Best for:

- restart safety,
- duplicate prevention.

### 25.5 Staging + Finalize

Chunk writes to staging table; later step finalizes.

Best for:

- file import,
- data migration,
- validation-heavy flows.

### 25.6 Outbox Writer

Writer writes external command to outbox.

Best for:

- email/API/message side effects,
- exactly-once illusion avoidance,
- retry governance.

### 25.7 Audit-Sidecar Writer

Writer writes domain update and audit record in one transaction.

Best for:

- regulatory defensibility,
- post-incident reconstruction.

---

## 26. Anti-Patterns

### 26.1 Reader loads everything

```java
List<Item> all = repository.findAll();
```

This defeats chunk processing.

### 26.2 Processor writes final state

```java
public Object processItem(Object item) {
    repository.updateStatus(item); // dangerous
    return item;
}
```

If writer fails, processor side effect may already happened.

### 26.3 Writer not idempotent

```java
insertAuditWithoutUniqueKey(update);
```

Restart duplicates audit.

### 26.4 Commit interval based on guess

```xml
<chunk item-count="10000">
```

Without measuring DB lock, memory, rollback, and retry impact.

### 26.5 No stable ordering

```sql
SELECT * FROM TABLE WHERE STATUS = 'PENDING'
```

Checkpoint becomes unreliable.

### 26.6 Checkpoint stores runtime object

```java
return resultSet;
```

Checkpoint must be serializable logical state, not runtime resource.

### 26.7 External side effect in processor

```java
emailClient.send(...);
```

Retry/restart can duplicate.

### 26.8 Ignoring filtered count

If processor returns many nulls, writer count lower than read count. This should be visible. Otherwise operator may think records disappeared.

### 26.9 Treating chunk as parallelism

Chunk size controls commit/checkpoint grouping, not necessarily parallelism. For parallelism, use partitioning/split/concurrency controls carefully.

---

## 27. Practical Decision Framework

Use chunk step when:

- workload is item-oriented,
- input can be streamed/paged,
- output can be committed in chunks,
- restartability matters,
- item-level skip/retry matters,
- progress count matters.

Avoid chunk step when:

- work is one indivisible task,
- no meaningful item boundary exists,
- side effect cannot be made idempotent,
- orchestration is actually a business workflow,
- output requires all-or-nothing global transaction over huge dataset.

Ask these questions:

```text
1. What is one item?
2. What is one chunk?
3. What is the stable order?
4. What is the checkpoint?
5. What side effect does writer perform?
6. Is writer idempotent?
7. What happens if the server dies after write but before checkpoint?
8. What happens if job restarts?
9. What is allowed to be skipped?
10. What must fail the whole job?
```

If you cannot answer these, you do not yet have a production batch design.

---

## 28. Worked Failure Scenario

Assume:

```text
chunk size = 100
last committed checkpoint = caseId 1000
current chunk reads 1001..1100
writer updates 1001..1100
server dies before commit completes
```

Possible outcomes:

### Outcome A — DB transaction rolled back

On restart:

```text
checkpoint = 1000
records 1001..1100 read again
writer applies updates
correct if writer deterministic
```

### Outcome B — DB commit succeeded but checkpoint update failed

Depending on runtime transaction coupling, this should ideally not happen if checkpoint and business writes share the same transactional consistency. But if business side effect is external/non-transactional, equivalent ambiguity can happen.

On restart:

```text
checkpoint = 1000
records 1001..1100 processed again
```

If writer is idempotent, safe.

If writer is not idempotent, duplicate.

### Outcome C — External API succeeded for 60 items, then failure

On restart:

```text
same 100 items retried
first 60 may duplicate
```

Solution:

- idempotency key per external request,
- outbox with status,
- reconciliation for unknown outcome,
- avoid direct irreversible send in chunk writer.

---

## 29. Enterprise Checklist

Before approving a chunk step design, check:

### Reader

- [ ] Input set semantics defined.
- [ ] Stable ordering exists.
- [ ] Checkpoint state is serializable.
- [ ] Restart behavior tested.
- [ ] Reader does not perform final side effect.
- [ ] Reader does not load entire input into memory.
- [ ] Reader handles empty input.
- [ ] Reader handles resource cleanup.

### Processor

- [ ] Processor has no irreversible side effect.
- [ ] Filtering vs skipping semantics clear.
- [ ] Reference data version controlled.
- [ ] Exceptions classified.
- [ ] Output contains enough data for idempotent writer.
- [ ] Processor deterministic enough for audit.

### Writer

- [ ] Writer atomic per chunk or explicitly handles partial effect.
- [ ] Writer idempotent.
- [ ] Duplicate write tested.
- [ ] Optimistic conflicts handled.
- [ ] External side effects use outbox/idempotency.
- [ ] Audit written consistently.
- [ ] Empty chunk safe.

### Chunk configuration

- [ ] `item-count` justified with measurement.
- [ ] Transaction timeout appropriate.
- [ ] DB connection pool impact measured.
- [ ] Lock duration acceptable.
- [ ] Retry/skip policy defined.
- [ ] Metrics/logging in place.

### Operations

- [ ] Restart tested.
- [ ] Stop tested.
- [ ] Kill/redeploy tested.
- [ ] Duplicate job launch prevented.
- [ ] Dashboard shows progress.
- [ ] Error report usable by operator/business.

---

## 30. Relation to Previous and Next Parts

Previous part, **Part 19**, explained `Batchlet` as task-oriented batch work.

This part explained `Chunk` as item-oriented batch work.

The core distinction:

```text
Batchlet = you own the loop and state discipline.
Chunk    = runtime owns the read/process/write/checkpoint rhythm,
           but you must design reader/processor/writer contracts correctly.
```

Next part, **Part 21**, will go deeper into:

```text
Checkpointing, Restartability, and Idempotency
```

Part 21 will build directly on this part because chunk processing only becomes production-grade when checkpoint and idempotency are treated as first-class design constraints.

---

## 31. Ringkasan

Chunk-oriented processing adalah model utama Jakarta Batch untuk workload item-oriented.

Mental model terpenting:

```text
Read one item → process one item → aggregate output → write chunk → commit → checkpoint
```

Namun pemahaman top-tier tidak berhenti di API. Yang penting adalah boundary:

- reader menentukan input dan checkpoint,
- processor menentukan transformation/filtering,
- writer melakukan side effect,
- chunk menentukan commit/checkpoint/failure unit,
- idempotency menentukan apakah restart aman,
- observability menentukan apakah operator bisa memahami progress,
- transaction boundary menentukan apakah state konsisten.

Chunk step yang baik bukan hanya cepat. Ia harus:

- restartable,
- idempotent,
- memory-safe,
- transaction-safe,
- deterministic enough,
- observable,
- auditable,
- tunable,
- operationally controllable.

Jika kamu memahami chunk sebagai **failure-bounded, checkpointed, item-processing transaction loop**, kamu akan jauh lebih siap mendesain batch workload enterprise dibanding developer yang hanya tahu template `Reader-Processor-Writer`.

---

## 32. Latihan / Thought Experiment

### Latihan 1 — Tentukan item dan chunk

Untuk workload berikut:

```text
Generate overdue notice untuk semua case yang SLA-nya lewat lebih dari 7 hari.
```

Jawab:

1. Apa item-nya?
2. Apa output processor-nya?
3. Apa writer side effect-nya?
4. Apa idempotency key-nya?
5. Apakah email dikirim langsung di writer atau lewat outbox?
6. Apa checkpoint reader-nya?
7. Apa yang terjadi jika job mati setelah 80 dari 100 notice dibuat?

### Latihan 2 — Reader snapshot atau open-ended?

Untuk workload:

```text
Process all pending address validation requests.
```

Tentukan apakah lebih cocok:

1. open-ended keyset scan, atau
2. snapshot input set per job execution.

Pertimbangkan:

- record baru masuk saat job berjalan,
- audit report,
- retry/restart,
- external API rate limit,
- operator expectation.

### Latihan 3 — Commit interval tuning

Diberikan:

```text
processor latency rata-rata = 5 ms/item
writer fixed overhead = 100 ms/chunk
writer per item overhead = 2 ms/item
commit overhead = 50 ms/chunk
```

Bandingkan approximate throughput untuk chunk size:

- 10,
- 100,
- 1000.

Lalu jelaskan kenapa hasil matematis belum cukup tanpa melihat DB lock, memory, retry cost, dan downstream pressure.

### Latihan 4 — Identify anti-pattern

Kode:

```java
public Object processItem(Object item) {
    CaseInput input = (CaseInput) item;
    if (input.overdue()) {
        emailClient.sendOverdueNotice(input.caseId());
    }
    return input;
}
```

Pertanyaan:

1. Apa masalahnya?
2. Failure scenario apa yang menyebabkan duplicate email?
3. Bagaimana redesign dengan outbox?

---

## 33. Referensi

- Jakarta Batch 2.1 Specification — Chunk-oriented processing, `ItemReader`, `ItemProcessor`, `ItemWriter`, checkpoint policy.
- Jakarta Batch 2.1 API — `jakarta.batch.api.chunk` package.
- Jakarta EE 11 Release — platform baseline untuk Jakarta Batch 2.1.
- Java/Jakarta EE historical namespace — `javax.batch.*` ke `jakarta.batch.*`.
- Open Liberty Jakarta Batch 2.1 documentation — contoh implementasi runtime dan feature activation.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 19 — Batchlet Model: Task-Oriented Batch Work](./19-batchlet-model-task-oriented-batch-work.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 21 — Checkpointing, Restartability, and Idempotency](./21-checkpointing-restartability-idempotency.md)

</div>