# Part 27 — Large Object and Large Result Handling: CLOB, BLOB, Streaming, Cursor

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `27-large-object-large-result-clob-blob-streaming-cursor.md`  
> Target: Java 8 sampai Java 25  
> Fokus: bagaimana memakai MyBatis untuk data besar tanpa merusak heap, transaksi, koneksi database, network, observability, dan correctness.

---

## 0. Posisi Materi Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- mapper design,
- statement mapping,
- parameter binding,
- result mapping,
- dynamic SQL,
- transaction,
- performance,
- observability,
- security,
- multi-tenancy.

Bagian ini masuk ke area yang sering menjadi sumber incident production:

```text
query benar
+ mapping benar
+ transaction benar
+ security benar

namun aplikasi tetap jatuh karena:

- result terlalu besar,
- CLOB/BLOB dimuat ke memory,
- export menahan koneksi terlalu lama,
- cursor tidak ditutup,
- fetch size tidak efektif,
- driver mem-buffer semua row,
- response HTTP timeout,
- GC pressure meningkat,
- batch/reporting mengganggu OLTP workload.
```

MyBatis memberi beberapa mekanisme untuk large result handling, seperti `Cursor<T>`, `ResultHandler`, `fetchSize`, statement timeout, dan TypeHandler untuk CLOB/BLOB. Namun MyBatis tidak otomatis mengubah query besar menjadi aman. Engineer tetap harus mendesain:

- bentuk query,
- ukuran result,
- lifecycle resource,
- transaction boundary,
- fetch strategy,
- memory strategy,
- export strategy,
- failure recovery.

Dokumentasi MyBatis menyebut `fetchSize` sebagai driver hint agar driver mengembalikan jumlah row tertentu dalam satu batch, `timeout` sebagai batas tunggu statement, dan `Cursor` sebagai mekanisme lazy fetching yang cocok untuk query jutaan item yang tidak muat di memory. MyBatis juga memiliki API `ResultHandler` untuk memproses row satu per satu tanpa harus membangun list penuh di memory.

---

## 1. Mental Model: Large Data Bukan Sekadar Query Besar

Large data problem tidak selalu berarti tabelnya besar. Yang berbahaya adalah kombinasi:

```text
large table
+ unbounded predicate
+ wide projection
+ eager materialization
+ long transaction
+ slow consumer
+ no cancellation handling
+ poor observability
```

Contoh query yang tampak sederhana:

```xml
<select id="findAllAuditTrail" resultMap="AuditTrailResultMap">
  SELECT
    id,
    module_code,
    activity,
    metadata,
    serialized_changes,
    full_text,
    created_at
  FROM audit_trail
  ORDER BY created_at DESC
</select>
```

Masalahnya bukan hanya `SELECT`-nya. Masalahnya adalah:

1. tidak ada filter waktu,
2. tidak ada limit,
3. mengambil CLOB besar,
4. melakukan ordering global,
5. memuat semua row ke `List`,
6. result object mungkin besar,
7. local cache mungkin menyimpan referensi,
8. koneksi database ditahan lama,
9. response HTTP mungkin timeout,
10. GC harus menangani banyak object besar.

Top-tier engineer tidak bertanya: “query ini bisa jalan?”  
Ia bertanya: “query ini aman pada 10 juta row, 30 concurrent user, dan data CLOB 5 MB per row?”

---

## 2. Taxonomy Data Besar

Tidak semua large data sama. Cara desainnya berbeda.

### 2.1 Banyak Row, Kolom Kecil

Contoh:

```text
1 juta row
masing-masing 10 kolom kecil
```

Risiko utama:

- heap pressure dari object Java,
- network transfer besar,
- result set lama,
- cursor lifecycle,
- transaction terlalu panjang.

Solusi umum:

- cursor/streaming,
- pagination/keyset,
- export async,
- projection kecil,
- chunk processing.

### 2.2 Sedikit Row, Kolom Sangat Besar

Contoh:

```text
100 row
masing-masing memiliki CLOB/BLOB 50 MB
```

Risiko utama:

- satu row bisa membuat heap penuh,
- JSON serialization lambat,
- base64 BLOB membesar sekitar 33%,
- logging tidak sengaja mencetak payload,
- response timeout.

Solusi umum:

- jangan ambil LOB pada listing,
- endpoint khusus download/detail,
- streaming I/O,
- metadata-first design,
- lazy LOB retrieval.

### 2.3 Banyak Row + Kolom Besar

Ini paling berbahaya.

Contoh:

```text
export audit trail 2 tahun
setiap row punya serialized_changes CLOB
```

Solusi biasanya bukan `selectList` dan bukan response synchronous biasa. Perlu:

- async job,
- chunk/cursor,
- file output,
- checkpoint,
- cancellation,
- progress tracking,
- storage target seperti S3/object storage,
- throttling,
- query windowing.

### 2.4 Query Result Besar karena Join

Kadang tabel root kecil, tapi join membuat result meledak.

Contoh:

```text
100 case
x 50 documents
x 20 audit events
= 100,000 joined rows
```

Risiko:

- cartesian explosion,
- duplicate root object,
- nested result map memory pressure,
- pagination salah,
- CPU mapping tinggi.

Solusi:

- root-first pagination,
- child batch fetch,
- manual graph assembly,
- projection datar untuk reporting.

---

## 3. Anti-Pattern Utama: `selectList` untuk Unbounded Query

Mapper seperti ini terlihat normal:

```java
List<AuditTrailRow> findAuditTrail(AuditTrailSearchCriteria criteria);
```

XML:

```xml
<select id="findAuditTrail" resultMap="AuditTrailRowMap">
  SELECT
    id,
    module_code,
    activity,
    metadata,
    serialized_changes,
    created_at
  FROM audit_trail
  WHERE tenant_id = #{scope.tenantId}
  ORDER BY created_at DESC
</select>
```

Masalah:

```text
method return List
= mapper mengizinkan semua result dimaterialisasi
= caller bisa tidak sadar membuat query jutaan row
= contract tidak menyatakan batas maksimal
```

Untuk large result, API mapper harus eksplisit:

```java
List<AuditTrailListRow> searchPage(AuditTrailSearchCriteria criteria);

Cursor<AuditTrailExportRow> streamForExport(AuditTrailExportCriteria criteria);

void scanForExport(
    @Param("criteria") AuditTrailExportCriteria criteria,
    ResultHandler<AuditTrailExportRow> handler
);
```

Nama method harus menyampaikan niat:

- `searchPage` untuk page terbatas,
- `streamForExport` untuk cursor,
- `scanForExport` untuk row-by-row processing,
- `findAll` hampir selalu berbahaya di production mapper.

---

## 4. Projection Discipline: Jangan Ambil LOB pada Listing

Listing screen jarang butuh CLOB/BLOB penuh.

Buruk:

```sql
SELECT
  id,
  activity,
  metadata,
  serialized_changes,
  full_text,
  created_at
FROM audit_trail
WHERE tenant_id = ?
ORDER BY created_at DESC
```

Lebih baik:

```sql
SELECT
  id,
  activity,
  created_at,
  created_by,
  module_code,
  has_metadata,
  metadata_size_bytes
FROM audit_trail
WHERE tenant_id = ?
ORDER BY created_at DESC
FETCH FIRST ? ROWS ONLY
```

Detail endpoint terpisah:

```sql
SELECT
  id,
  metadata,
  serialized_changes,
  full_text
FROM audit_trail
WHERE tenant_id = ?
  AND id = ?
```

Mental model:

```text
listing = discovery
summary = bounded, small, sortable

detail = focused retrieval
large payload boleh diambil karena user memilih satu item

export = batch/file workflow
bukan interactive list
```

---

## 5. CLOB/BLOB: Apa yang Harus Dipahami

CLOB/BLOB bukan sekadar `String` atau `byte[]` besar.

### 5.1 CLOB

CLOB biasanya dipakai untuk:

- JSON besar,
- XML besar,
- audit serialized changes,
- generated document text,
- full-text snapshot,
- email body panjang.

MyBatis menyediakan `ClobTypeHandler` dan `ClobReaderTypeHandler`. `ClobTypeHandler` memetakan CLOB ke `String`, sedangkan `ClobReaderTypeHandler` memakai `Reader` untuk CLOB/Reader via JDBC 4.0.

Konsekuensi mapping ke `String`:

```text
CLOB database
-> driver reads data
-> Java String allocated
-> object retained until result object GC
-> possible duplication during JSON serialization/logging
```

Untuk ukuran kecil sampai sedang, `String` bisa diterima. Untuk payload sangat besar atau export, `Reader`/streaming pattern lebih aman.

### 5.2 BLOB

BLOB biasanya dipakai untuk:

- attachment,
- PDF,
- image,
- binary document,
- zipped export,
- signed payload.

MyBatis menyediakan `BlobTypeHandler` yang memetakan BLOB ke `byte[]`.

Konsekuensi mapping ke `byte[]`:

```text
BLOB database
-> full byte array allocated
-> memory sebesar payload
-> bila dikirim JSON base64, ukuran membesar
-> logging/debugging berbahaya
```

Untuk file besar, sering lebih baik:

- jangan simpan file besar di relational DB kecuali memang diperlukan,
- simpan metadata di DB,
- simpan binary di object storage,
- gunakan DB hanya sebagai transactional pointer/metadata,
- gunakan streaming download.

Namun dalam enterprise/regulatory system, BLOB di DB kadang tetap dipakai karena auditability, transactional consistency, dan backup policy. Jika demikian, desain akses harus sangat disiplin.

---

## 6. Jangan Campur Metadata dan Payload Besar dalam Satu DTO Listing

Buruk:

```java
public class DocumentRow {
    private Long id;
    private String filename;
    private String contentType;
    private byte[] content;
    private LocalDateTime uploadedAt;
}
```

Untuk listing:

```java
public class DocumentListRow {
    private Long id;
    private String filename;
    private String contentType;
    private long sizeBytes;
    private LocalDateTime uploadedAt;
}
```

Untuk download/detail:

```java
public class DocumentPayloadRow {
    private Long id;
    private String filename;
    private String contentType;
    private byte[] content;
}
```

Atau streaming-oriented:

```java
public class DocumentMetadata {
    private Long id;
    private String filename;
    private String contentType;
    private long sizeBytes;
}
```

Lalu content dibaca melalui API khusus.

Prinsip:

```text
DTO kecil untuk discovery
DTO payload untuk operasi eksplisit
jangan accidental payload loading
```

---

## 7. `fetchSize`: Hint, Bukan Garansi

MyBatis mapped statement punya attribute `fetchSize`:

```xml
<select id="streamAuditTrailForExport"
        resultMap="AuditTrailExportRowMap"
        fetchSize="500">
  SELECT
    id,
    activity,
    created_at,
    created_by
  FROM audit_trail
  WHERE tenant_id = #{tenantId}
  ORDER BY id
</select>
```

Mental model:

```text
fetchSize = hint ke JDBC driver
bukan jaminan MyBatis hanya menyimpan N row di memory
```

Agar efektif, harus selaras dengan:

- JDBC driver behavior,
- transaction/autocommit mode,
- result set type,
- database vendor,
- mapper return type,
- consumer behavior.

Jika mapper tetap return `List<T>`, maka akhirnya seluruh result tetap masuk memory:

```java
List<AuditTrailExportRow> rows = mapper.findHugeExport(criteria);
```

Walaupun driver fetch bertahap, MyBatis akan membangun list penuh sebelum method return.

Jadi `fetchSize` berguna jika dikombinasikan dengan:

- `Cursor<T>`,
- `ResultHandler`,
- database cursor/streaming driver behavior,
- bounded processing.

---

## 8. `Cursor<T>`: Lazy Fetching dengan Lifecycle Resource

MyBatis `Cursor<T>` adalah iterator lazy untuk mengambil item secara bertahap. Cocok untuk result besar yang tidak muat di memory.

Mapper:

```java
public interface AuditTrailExportMapper {
    Cursor<AuditTrailExportRow> streamForExport(AuditTrailExportCriteria criteria);
}
```

XML:

```xml
<select id="streamForExport"
        parameterType="AuditTrailExportCriteria"
        resultMap="AuditTrailExportRowMap"
        fetchSize="500">
  SELECT
    id,
    module_code,
    activity,
    created_at,
    created_by
  FROM audit_trail
  WHERE tenant_id = #{tenantId}
    AND created_at &gt;= #{fromInclusive}
    AND created_at &lt; #{toExclusive}
  ORDER BY id
</select>
```

Usage:

```java
@Transactional(readOnly = true)
public void exportAuditTrail(AuditTrailExportCriteria criteria, Writer writer) {
    try (Cursor<AuditTrailExportRow> cursor = mapper.streamForExport(criteria)) {
        for (AuditTrailExportRow row : cursor) {
            writeCsvRow(writer, row);
        }
    } catch (IOException e) {
        throw new ExportFailedException("Failed to export audit trail", e);
    }
}
```

Important:

```text
Cursor harus ditutup.
Cursor memakai koneksi/session aktif selama iterasi.
Cursor tidak boleh dikembalikan keluar dari transaction/resource boundary secara sembarangan.
```

Buruk:

```java
public Cursor<AuditTrailExportRow> getCursor(AuditTrailExportCriteria criteria) {
    return mapper.streamForExport(criteria);
}
```

Jika caller mengiterasi setelah session/transaction selesai, cursor bisa gagal.

Lebih baik:

```java
@Transactional(readOnly = true)
public void withAuditTrailCursor(
    AuditTrailExportCriteria criteria,
    Consumer<AuditTrailExportRow> consumer
) {
    try (Cursor<AuditTrailExportRow> cursor = mapper.streamForExport(criteria)) {
        for (AuditTrailExportRow row : cursor) {
            consumer.accept(row);
        }
    }
}
```

Namun hati-hati: consumer tidak boleh melakukan operasi lambat tidak terkendali di dalam transaction.

---

## 9. `ResultHandler`: Row-by-Row Processing

MyBatis `ResultHandler` memungkinkan pemrosesan setiap row tanpa membangun list penuh.

Mapper style dengan `SqlSession`:

```java
sqlSession.select(
    "com.example.audit.AuditTrailMapper.scanForExport",
    criteria,
    resultContext -> {
        AuditTrailExportRow row = (AuditTrailExportRow) resultContext.getResultObject();
        writer.write(row);
    }
);
```

Dalam mapper interface, pattern ini lebih sering dibungkus di repository/service khusus karena signature mapper interface dengan `ResultHandler` bisa kurang nyaman.

Kelebihan:

- tidak membangun `List` penuh,
- cocok untuk aggregation/export,
- bisa discard row setelah diproses.

Risiko:

- exception handling harus benar,
- resource masih aktif selama handler berjalan,
- handler lambat menahan koneksi,
- handler side effect harus idempotent atau transactional-aware,
- nested mapping kompleks bisa tetap mahal.

Gunakan `ResultHandler` ketika:

```text
kita ingin memproses row satu per satu
hasil akhir bukan List object di memory
contoh: CSV export, aggregation, streaming transform, validation scan
```

---

## 10. Cursor vs Pagination vs ResultHandler

| Kebutuhan | Pilihan Umum | Catatan |
|---|---|---|
| UI listing | pagination/keyset | Jangan cursor untuk UI biasa |
| Export besar sekali | async job + cursor/chunk | Output ke file/storage |
| Process row satu per satu | `ResultHandler` atau cursor | Pastikan resource lifecycle |
| REST response kecil | page/slice | Bounded result |
| REST download besar | streaming response + cursor | Hati-hati timeout/koneksi |
| Worker processing | chunk/keyset pagination | Lebih mudah retry/checkpoint |
| Need resume after failure | chunk/keyset dengan checkpoint | Cursor murni sulit resume |
| Need exactly once-ish side effect | idempotent chunk | Jangan side effect rapuh dalam cursor panjang |

Decision rule:

```text
Butuh user melihat halaman?
  -> page/keyset

Butuh menghasilkan file besar?
  -> async export + cursor/chunk

Butuh proses internal bisa resume?
  -> chunk + checkpoint

Butuh scan cepat tanpa menyimpan result?
  -> ResultHandler/cursor
```

---

## 11. Cursor Bukan Pengganti Pagination

Cursor database/MyBatis dan cursor pagination API adalah dua hal berbeda.

### 11.1 MyBatis Cursor

```text
server/application membuka result set
row diambil lazy
resource ditahan selama iterasi
cocok untuk single continuous scan
```

### 11.2 API Cursor Pagination

```text
client menyimpan cursor token/keyset
request berikutnya mengambil page berikutnya
resource database tidak ditahan antar request
cocok untuk UI/API
```

Jangan membuat HTTP API yang mengembalikan database cursor untuk dilanjutkan request berikutnya. Itu akan menahan resource dan rawan timeout/leak.

Untuk API pagination gunakan keyset:

```sql
WHERE tenant_id = ?
  AND (
    created_at < ?
    OR (created_at = ? AND id < ?)
  )
ORDER BY created_at DESC, id DESC
FETCH FIRST ? ROWS ONLY
```

Untuk export internal, cursor boleh digunakan dalam satu job execution.

---

## 12. Transaction Boundary untuk Streaming

Streaming/cursor membutuhkan koneksi aktif selama iterasi. Jika memakai Spring:

```java
@Transactional(readOnly = true)
public void export(...) {
    try (Cursor<Row> cursor = mapper.stream(...)) {
        for (Row row : cursor) {
            ...
        }
    }
}
```

Pertanyaannya: apakah transaksi boleh hidup selama export 20 menit?

Risiko long transaction:

- lock/snapshot retention,
- undo/rollback segment pressure,
- MVCC bloat di PostgreSQL,
- read consistency cost di Oracle,
- connection pool slot tertahan,
- timeout,
- cancellation sulit,
- deploy shutdown terganggu.

Alternatif:

### 12.1 Chunk by Keyset

```java
public void exportByChunks(Criteria criteria, Writer writer) {
    Long lastId = null;

    while (true) {
        List<Row> rows = mapper.findNextChunk(criteria, lastId, 1000);
        if (rows.isEmpty()) {
            break;
        }

        for (Row row : rows) {
            writeRow(writer, row);
            lastId = row.getId();
        }
    }
}
```

XML:

```xml
<select id="findNextChunk" resultMap="ExportRowMap">
  SELECT
    id,
    activity,
    created_at
  FROM audit_trail
  WHERE tenant_id = #{criteria.tenantId}
    <if test="lastId != null">
      AND id &gt; #{lastId}
    </if>
  ORDER BY id
  FETCH FIRST #{limit} ROWS ONLY
</select>
```

Kelebihan:

- transaction pendek,
- bisa checkpoint,
- bisa retry,
- resource tidak ditahan lama.

Kekurangan:

- perlu stable ordering,
- data berubah selama export bisa membuat snapshot tidak konsisten,
- perlu definisi export consistency.

### 12.2 Snapshot Time Boundary

Tambahkan batas waktu:

```sql
WHERE created_at < #{exportStartedAt}
```

Maka export tidak terus mengejar data baru.

---

## 13. Export Strategy: Synchronous vs Asynchronous

### 13.1 Synchronous Export

Cocok jika:

- data kecil/menengah,
- selesai cepat,
- user bisa menunggu,
- resource aman,
- timeout gateway cukup.

Risiko:

- HTTP timeout,
- user cancel tidak ditangani,
- koneksi DB tertahan,
- response streaming failure di tengah.

### 13.2 Asynchronous Export

Cocok jika:

- data besar,
- butuh file,
- butuh progress,
- butuh retry,
- butuh audit,
- butuh cancellation,
- butuh resumability.

Flow:

```text
User request export
  -> create export_job row
  -> worker picks job
  -> query by chunk/cursor
  -> write file to storage
  -> update progress
  -> mark completed/failed
  -> user downloads file
```

Tabel job:

```sql
CREATE TABLE export_job (
  id              BIGINT PRIMARY KEY,
  tenant_id       BIGINT NOT NULL,
  requested_by    BIGINT NOT NULL,
  status          VARCHAR(30) NOT NULL,
  criteria_json   CLOB NOT NULL,
  progress_rows   BIGINT DEFAULT 0 NOT NULL,
  file_uri        VARCHAR(1000),
  error_message   VARCHAR(2000),
  created_at      TIMESTAMP NOT NULL,
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  version         BIGINT NOT NULL
);
```

Job claim:

```sql
UPDATE export_job
SET status = 'RUNNING',
    started_at = CURRENT_TIMESTAMP,
    version = version + 1
WHERE id = #{jobId}
  AND tenant_id = #{tenantId}
  AND status = 'PENDING'
```

Rows affected `1` berarti berhasil claim.

---

## 14. Streaming HTTP Response: Hati-Hati

Spring MVC contoh:

```java
@GetMapping("/audit/export.csv")
@Transactional(readOnly = true)
public void export(HttpServletResponse response, AuditTrailExportRequest request) throws IOException {
    response.setContentType("text/csv");
    response.setHeader("Content-Disposition", "attachment; filename=audit.csv");

    try (Writer writer = response.getWriter();
         Cursor<AuditTrailExportRow> cursor = mapper.streamForExport(toCriteria(request))) {

        for (AuditTrailExportRow row : cursor) {
            writeCsvRow(writer, row);
        }
    }
}
```

Masalah:

- transaction sepanjang response,
- koneksi DB sepanjang client download,
- client lambat membuat DB connection tertahan,
- browser cancel bisa memicu exception,
- retry sulit,
- audit status sulit.

Lebih baik untuk data besar:

```text
request export -> async job -> downloadable file
```

Synchronous streaming masih bisa diterima untuk bounded export kecil dengan timeout dan limit jelas.

---

## 15. Local Cache dan Large Result

MyBatis local cache default `SESSION`. Dalam query besar, object yang sudah diproses bisa tetap tertahan lebih lama dari yang diharapkan tergantung session/cache behavior dan nested query.

Untuk scanning besar, pertimbangkan:

```xml
<select id="streamForExport"
        resultMap="ExportRowMap"
        fetchSize="500"
        useCache="false"
        flushCache="false">
  ...
</select>
```

Dan pada level konfigurasi tertentu:

```xml
<settings>
  <setting name="localCacheScope" value="STATEMENT"/>
</settings>
```

Namun jangan ubah global setting sembarangan. `localCacheScope=STATEMENT` dapat memengaruhi nested select/lazy loading behavior. Untuk export mapper khusus, desain lebih baik:

- resultMap sederhana,
- tidak memakai nested select,
- tidak memakai second-level cache,
- tidak mengambil object graph.

---

## 16. Second-Level Cache Hampir Selalu Salah untuk Large Result

Jangan cache result besar:

```xml
<select id="findHugeReport" useCache="true">
  ...
</select>
```

Risiko:

- memory penuh,
- stale report,
- tenant leakage jika key/scope salah,
- serialization cost,
- cache invalidation tidak jelas.

Untuk export/reporting besar:

```xml
<select id="streamReport" useCache="false" fetchSize="1000">
  ...
</select>
```

Cache yang lebih masuk akal:

- cache metadata kecil,
- cache lookup/reference table kecil,
- cache generated export file URI/status,
- bukan cache jutaan row.

---

## 17. Nested Result Map dan Cursor

MyBatis Cursor documentation mencatat bahwa jika resultMap memakai collection, cursor SQL harus di-order dengan kolom id resultMap dan `resultOrdered="true"` agar nested result dapat diproses dengan benar.

Contoh:

```xml
<select id="streamCaseWithDocuments"
        resultMap="CaseWithDocumentsMap"
        resultOrdered="true"
        fetchSize="500">
  SELECT
    c.id AS case_id,
    c.case_no AS case_no,
    d.id AS document_id,
    d.filename AS document_filename
  FROM case c
  LEFT JOIN document d ON d.case_id = c.id
  WHERE c.tenant_id = #{tenantId}
  ORDER BY c.id, d.id
</select>
```

Namun untuk large export, nested object graph sering bukan pilihan terbaik.

Lebih baik projection datar:

```java
public class CaseDocumentExportRow {
    private Long caseId;
    private String caseNo;
    private Long documentId;
    private String documentFilename;
}
```

Kenapa?

```text
flat row lebih murah
lebih mudah ditulis ke CSV
lebih mudah diproses streaming
lebih mudah menghindari object graph memory pressure
```

---

## 18. Large Result dan JSON Serialization

Jangan return large list sebagai JSON:

```java
@GetMapping("/audit")
public List<AuditTrailRow> findAll(...) {
    return mapper.findAll(...);
}
```

Masalah:

- MyBatis membangun list,
- Jackson membangun response JSON,
- response buffer bisa besar,
- client juga harus parse semua,
- timeout,
- memory ganda/triplikat.

Gunakan:

- pagination,
- export file,
- newline-delimited JSON untuk special case,
- async report.

Untuk regulatory/internal admin UI:

```text
UI listing harus page/slice.
Export harus job/file.
Detail harus explicit payload retrieval.
```

---

## 19. Large Object Logging Policy

Jangan pernah log field besar:

- CLOB JSON payload,
- BLOB byte array,
- document body,
- full request/response snapshot,
- serialized changes lengkap,
- email body lengkap,
- attachment.

Buruk:

```java
log.info("audit row={}", row);
```

Jika `toString()` mencetak payload, log akan meledak.

Lebih baik:

```java
log.info(
    "audit export row id={}, module={}, payloadSize={}",
    row.getId(),
    row.getModuleCode(),
    row.getPayloadSizeBytes()
);
```

DTO besar sebaiknya tidak memakai Lombok `@Data` tanpa kontrol `toString()`.

Gunakan:

```java
@Getter
@Setter
@ToString(exclude = {"metadata", "serializedChanges", "content"})
public class AuditTrailPayloadRow {
    private Long id;
    private String metadata;
    private String serializedChanges;
    private byte[] content;
}
```

---

## 20. Large Data dan Timeout

Mapped statement punya `timeout`:

```xml
<select id="streamForExport"
        resultMap="ExportRowMap"
        fetchSize="1000"
        timeout="300">
  ...
</select>
```

Namun timeout harus dipahami berlapis:

```text
DB statement timeout
JDBC driver socket timeout
connection pool timeout
Spring transaction timeout
HTTP server timeout
API gateway/load balancer timeout
browser/client timeout
job scheduler timeout
```

Jika export besar butuh lebih lama dari HTTP timeout, solusinya bukan selalu menaikkan timeout. Sering solusinya adalah async job.

---

## 21. Fetch Size Tuning

Tidak ada angka universal. Contoh awal:

```text
small row, fast network       -> 500 sampai 5000
wide row                     -> 100 sampai 500
LOB row                      -> sangat hati-hati, mungkin 10 sampai 100
remote DB/network latency    -> lebih besar bisa membantu
memory terbatas              -> lebih kecil
```

Tuning harus memakai observability:

- row/sec,
- bytes/sec,
- DB time,
- network time,
- heap usage,
- GC pause,
- connection hold time,
- export duration,
- failure/cancel rate.

Jangan tuning berdasarkan feeling.

---

## 22. Large `IN` Clause dan Result Besar

Pattern umum:

```xml
<foreach collection="ids" item="id" open="(" separator="," close=")">
  #{id}
</foreach>
```

Masalah:

- jumlah bind parameter bisa melebihi limit vendor/driver,
- SQL text besar,
- plan buruk,
- network overhead,
- parsing overhead,
- result besar.

Alternatif:

- chunk IDs,
- temporary table,
- staging table,
- join ke table parameter/staging,
- bulk load IDs lalu join,
- use-case specific batch query.

Untuk large export, staging table sering lebih robust:

```text
insert selected ids into export_job_item
then process by job_id and item_id chunks
```

---

## 23. LOB Retrieval Pattern

### 23.1 Metadata First

```xml
<select id="findDocumentMetadata" resultMap="DocumentMetadataMap">
  SELECT
    id,
    filename,
    content_type,
    size_bytes,
    checksum,
    uploaded_at
  FROM document
  WHERE tenant_id = #{tenantId}
    AND case_id = #{caseId}
  ORDER BY uploaded_at DESC
</select>
```

### 23.2 Payload by ID

```xml
<select id="findDocumentPayload" resultMap="DocumentPayloadMap">
  SELECT
    id,
    filename,
    content_type,
    content_blob
  FROM document
  WHERE tenant_id = #{tenantId}
    AND id = #{documentId}
</select>
```

### 23.3 Authorization at Payload Query

Jangan hanya authorize metadata listing. Payload query juga harus scoped:

```sql
WHERE tenant_id = ?
  AND id = ?
  AND case_id IN (
      SELECT case_id
      FROM case_access
      WHERE user_id = ?
  )
```

Atau service melakukan authorization sebelum payload retrieval, tetapi mapper tetap harus memiliki tenant/security predicate minimal.

---

## 24. Streaming BLOB dari Database: MyBatis Limitation Awareness

Jika mapper memetakan BLOB ke `byte[]`, maka payload penuh masuk heap.

Untuk file sangat besar, plain JDBC streaming kadang lebih tepat daripada MyBatis mapper object mapping:

```java
try (Connection connection = dataSource.getConnection();
     PreparedStatement ps = connection.prepareStatement(
         "SELECT content_blob FROM document WHERE tenant_id = ? AND id = ?")) {

    ps.setLong(1, tenantId);
    ps.setLong(2, documentId);

    try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next()) {
            throw new NotFoundException();
        }

        try (InputStream in = rs.getBinaryStream(1)) {
            in.transferTo(outputStream); // Java 9+
        }
    }
}
```

Untuk Java 8:

```java
byte[] buffer = new byte[8192];
int read;
while ((read = in.read(buffer)) != -1) {
    outputStream.write(buffer, 0, read);
}
```

Prinsip:

```text
MyBatis cocok untuk object/row mapping.
Untuk raw binary streaming sangat besar, plain JDBC bisa lebih jelas dan aman.
```

Top-tier engineer tidak memaksakan satu framework untuk semua bentuk I/O.

---

## 25. Large CLOB JSON: Parse atau Tidak?

Misal kolom `metadata` berisi JSON besar.

Pilihan:

### 25.1 Map ke `String`

```java
private String metadataJson;
```

Cocok jika:

- hanya ditampilkan/download,
- tidak perlu parse di server,
- ukuran terkendali.

### 25.2 Map ke Object via TypeHandler

```java
private AuditMetadata metadata;
```

Risiko:

- parse cost tinggi,
- memory object graph lebih besar dari string,
- schema JSON berubah,
- failure parse bisa menggagalkan query.

### 25.3 Extract Field di SQL

Vendor-specific:

```sql
JSON_VALUE(metadata, '$.caseStatus') AS case_status
```

Cocok untuk listing/search jika DB mendukung JSON function dan index.

Decision:

```text
listing butuh field kecil dari JSON?
  -> extract/index field atau denormalize column

detail butuh raw JSON?
  -> String CLOB

business logic butuh object?
  -> parse explicitly di service, bukan selalu auto TypeHandler
```

---

## 26. Read Model untuk Data Besar

Kadang solusi terbaik bukan mengoptimalkan query MyBatis langsung, tetapi membuat read model.

Contoh audit listing:

Tabel utama:

```text
audit_trail
- id
- tenant_id
- module_code
- activity
- metadata CLOB
- serialized_changes CLOB
- full_text CLOB
- created_at
```

Read model:

```text
audit_trail_listing
- id
- tenant_id
- module_code
- activity
- summary
- created_at
- created_by
- payload_size_bytes
```

Listing mapper query read model. Detail mapper query tabel utama.

Kelebihan:

- listing cepat,
- projection kecil,
- index lebih efisien,
- CLOB tidak disentuh,
- security review lebih mudah.

---

## 27. Archival dan Large Result

Untuk tabel besar, export/reporting sering harus mempertimbangkan archival.

Pattern:

```text
hot table     -> data aktif 3-12 bulan
archive table -> data lama
object store  -> file/report historical
search index  -> keyword lookup
```

Mapper bisa dipisah:

```java
AuditTrailHotMapper
AuditTrailArchiveMapper
AuditTrailExportMapper
```

Jangan membuat satu mapper method yang diam-diam union semua data bertahun-tahun tanpa guardrail.

Jika perlu query lintas hot/archive:

```sql
SELECT ... FROM audit_trail_hot WHERE ...
UNION ALL
SELECT ... FROM audit_trail_archive WHERE ...
```

Tetap wajib:

- time range mandatory,
- tenant scope mandatory,
- limit/export job boundary,
- query plan review.

---

## 28. Backpressure dan Consumer Speed

Streaming bukan berarti aman jika consumer lambat.

```text
DB produces rows fast
application writes CSV slowly
client downloads slowly
DB connection remains open
```

Mitigasi:

- async export to local/object storage,
- buffered writer,
- compression dengan hati-hati,
- chunk checkpoint,
- separate DB read from slow client response,
- limit synchronous export size,
- job cancellation.

Untuk HTTP streaming besar, client speed menjadi bagian dari database resource usage. Ini sering tidak disadari.

---

## 29. Cancellation Handling

Export bisa dibatalkan:

- user menutup browser,
- job manually cancelled,
- deployment shutdown,
- timeout,
- DB statement killed,
- node evicted.

Async job table perlu status:

```text
PENDING
RUNNING
COMPLETED
FAILED
CANCEL_REQUESTED
CANCELLED
```

Worker loop:

```java
while (true) {
    if (exportJobMapper.isCancelRequested(jobId)) {
        exportJobMapper.markCancelled(jobId);
        return;
    }

    List<Row> rows = mapper.findNextChunk(...);
    if (rows.isEmpty()) break;

    writeRows(rows);
    exportJobMapper.updateProgress(jobId, lastId, totalRows);
}
```

Cursor panjang lebih sulit dibatalkan secara halus daripada chunk loop yang memeriksa status per chunk.

---

## 30. Checkpointing untuk Export/Scan

Checkpoint minimal:

```text
job_id
last_processed_id
processed_rows
output_file_uri
status
version
updated_at
```

Mapper:

```xml
<update id="updateProgress">
  UPDATE export_job
  SET last_processed_id = #{lastProcessedId},
      processed_rows = #{processedRows},
      updated_at = CURRENT_TIMESTAMP,
      version = version + 1
  WHERE id = #{jobId}
    AND tenant_id = #{tenantId}
    AND status = 'RUNNING'
    AND version = #{version}
</update>
```

Rows affected `0` berarti job status berubah, version mismatch, atau authorization/scope salah.

---

## 31. Large Result Testing

Testing large result bukan berarti selalu insert 10 juta row di CI. Gunakan beberapa level.

### 31.1 Contract Test

Pastikan mapper punya limit/fetch strategy.

```java
assertThat(boundSql.getSql()).contains("FETCH FIRST");
```

### 31.2 Branch Test

Test criteria:

- empty filter rejected,
- date range mandatory,
- tenant mandatory,
- export limit enforced,
- order stable.

### 31.3 Integration Test dengan Dataset Sedang

Misal 10k row untuk memvalidasi:

- memory tidak naik ekstrem,
- cursor bisa iterate,
- writer menerima semua row,
- cursor tertutup.

### 31.4 Performance/Load Test Terpisah

Di environment khusus:

- 1 juta row,
- CLOB realistis,
- concurrent export,
- cancellation,
- DB monitoring.

---

## 32. Observability untuk Large Data

Metric penting:

```text
export.rows.processed
export.bytes.written
export.duration
export.rows.per.second
export.db.fetch.duration
export.write.duration
export.connection.hold.time
export.failures
export.cancelled
export.memory.used
export.gc.pause
```

Log progress:

```java
log.info(
    "export progress jobId={}, tenantId={}, rows={}, lastId={}, elapsedMs={}",
    jobId, tenantId, processedRows, lastId, elapsedMs
);
```

Jangan log row payload.

Slow query log harus mencatat:

- statement id,
- tenant id/hash,
- criteria summary,
- date range,
- row count,
- fetch size,
- duration,
- correlation id.

---

## 33. Failure Model

### 33.1 OutOfMemoryError

Penyebab umum:

- `selectList` unbounded,
- CLOB/BLOB mapped to object list,
- JSON serialization huge list,
- second-level cache large result,
- nested object graph explosion.

Mitigasi:

- bounded result,
- cursor/chunk,
- projection kecil,
- no large cache,
- async export.

### 33.2 Connection Pool Exhaustion

Penyebab:

- export menahan connection lama,
- cursor tidak ditutup,
- client lambat,
- concurrent export terlalu banyak.

Mitigasi:

- max concurrent export,
- async worker pool limit,
- try-with-resources,
- timeout,
- chunking.

### 33.3 Timeout

Penyebab:

- query lambat,
- network besar,
- HTTP timeout,
- transaction timeout,
- statement timeout.

Mitigasi:

- query tuning,
- async job,
- smaller chunks,
- progress/resume.

### 33.4 Stale/Inconsistent Export

Penyebab:

- data berubah selama chunk export,
- no snapshot boundary,
- ordering tidak stabil.

Mitigasi:

- snapshot timestamp,
- export job criteria immutable,
- stable keyset order,
- consistency level documented.

### 33.5 Duplicate/Missing Row in Chunk Export

Penyebab:

- offset pagination under concurrent writes,
- non-unique ordering,
- last key tidak lengkap.

Mitigasi:

- keyset by unique stable key,
- composite cursor `(created_at, id)`,
- snapshot boundary.

### 33.6 LOB Slowdown

Penyebab:

- listing mengambil LOB,
- LOB stored out-of-line,
- network payload besar,
- TypeHandler membaca semua.

Mitigasi:

- metadata-first,
- detail-only payload,
- object storage,
- streaming JDBC for raw binary.

---

## 34. Production Checklist

Sebelum merge mapper large data, cek:

```text
[ ] Apakah query bounded untuk UI?
[ ] Apakah export besar memakai async job?
[ ] Apakah listing tidak mengambil CLOB/BLOB?
[ ] Apakah DTO listing dan payload dipisah?
[ ] Apakah tenant/security scope wajib?
[ ] Apakah sorting stabil?
[ ] Apakah pagination memakai keyset untuk data besar?
[ ] Apakah cursor ditutup dengan try-with-resources?
[ ] Apakah transaction tidak terlalu panjang?
[ ] Apakah fetchSize disetel dan diuji sesuai vendor?
[ ] Apakah useCache=false untuk result besar?
[ ] Apakah local cache behavior dipahami?
[ ] Apakah LOB tidak masuk log/toString?
[ ] Apakah timeout berlapis dipahami?
[ ] Apakah export punya progress/cancel/retry?
[ ] Apakah failure partial ditangani?
[ ] Apakah memory profile sudah diuji?
[ ] Apakah row count dan bytes written dimonitor?
[ ] Apakah query plan sudah direview?
```

---

## 35. Mini Case Study: Audit Trail Export

### 35.1 Requirement

User ingin export audit trail untuk tenant tertentu dalam rentang waktu.

Data:

- audit trail 100 juta row,
- metadata CLOB,
- serialized changes CLOB,
- listing biasa hanya butuh summary,
- export bisa mencapai jutaan row,
- user perlu progress dan download file.

### 35.2 Wrong Design

```java
@GetMapping("/audit/export")
public List<AuditTrailRow> export(AuditSearchCriteria criteria) {
    return auditTrailMapper.findAll(criteria);
}
```

Masalah:

- synchronous,
- JSON response,
- unbounded list,
- mengambil CLOB,
- no progress,
- no retry,
- likely OOM/timeout.

### 35.3 Better Design

Flow:

```text
POST /audit/export-jobs
  -> create export job
  -> return job id

worker
  -> claim job
  -> export by keyset chunks
  -> write CSV/parquet/xlsx depending requirement
  -> update progress
  -> upload file
  -> mark completed

GET /audit/export-jobs/{id}
  -> status/progress

GET /audit/export-jobs/{id}/download
  -> download completed file
```

Mapper listing:

```xml
<select id="searchAuditTrailPage" resultMap="AuditTrailListRowMap">
  SELECT
    id,
    module_code,
    activity,
    created_at,
    created_by,
    payload_size_bytes
  FROM audit_trail_listing
  WHERE tenant_id = #{scope.tenantId}
    AND created_at &gt;= #{criteria.fromInclusive}
    AND created_at &lt; #{criteria.toExclusive}
  ORDER BY created_at DESC, id DESC
  FETCH FIRST #{limit} ROWS ONLY
</select>
```

Export chunk mapper:

```xml
<select id="findNextExportChunk" resultMap="AuditTrailExportRowMap" fetchSize="1000" useCache="false">
  SELECT
    id,
    module_code,
    activity,
    created_at,
    created_by,
    summary
  FROM audit_trail_listing
  WHERE tenant_id = #{tenantId}
    AND created_at &gt;= #{fromInclusive}
    AND created_at &lt; #{toExclusive}
    <if test="lastId != null">
      AND id &gt; #{lastId}
    </if>
  ORDER BY id
  FETCH FIRST #{limit} ROWS ONLY
</select>
```

Payload export if needed:

```text
Option A: export summary only
Option B: include payload link/reference
Option C: include CLOB only for selected subset
Option D: separate detailed export job with stricter limit
```

### 35.4 Design Decision

For regulatory audit trail, do not make “include full payload” the default. Full payload export should require:

- explicit flag,
- stricter date range,
- authorization,
- audit record,
- async job,
- file encryption if needed,
- retention policy.

---

## 36. Java 8 sampai Java 25 Considerations

### Java 8

- Tidak ada `InputStream.transferTo`.
- Gunakan manual buffer copy.
- DTO biasa.
- Try-with-resources sudah tersedia.
- Hindari Stream API untuk database resource jika lifecycle tidak jelas.

### Java 11

- `InputStream.transferTo` tersedia sejak Java 9.
- HTTP client modern tersedia, tapi tidak langsung relevan untuk MyBatis.

### Java 17

- Baseline umum Spring Boot 3.
- Record bisa dipakai untuk projection immutable.
- Sealed type bisa membantu export job status model.

### Java 21

- Virtual thread bisa membantu blocking I/O concurrency, tetapi tidak menghilangkan:
  - connection pool limit,
  - DB load,
  - result memory,
  - cursor lifecycle,
  - transaction timeout.

Virtual thread bukan alasan untuk menjalankan 1000 export besar paralel.

### Java 25

- Tetap gunakan prinsip yang sama:
  - bounded data,
  - explicit resource lifecycle,
  - memory-aware mapping,
  - async job untuk heavy export,
  - framework tidak menggantikan database/resource discipline.

---

## 37. Ringkasan Mental Model

Large object dan large result handling di MyBatis harus dipahami sebagai resource engineering:

```text
SQL result size
  -> JDBC driver fetch behavior
  -> MyBatis mapping behavior
  -> Java object allocation
  -> transaction/session lifetime
  -> connection pool occupancy
  -> network transfer
  -> consumer speed
  -> observability/failure recovery
```

Aturan praktis:

```text
UI listing harus bounded.
Export besar harus async.
CLOB/BLOB jangan masuk listing.
Cursor harus ditutup.
fetchSize bukan garansi.
selectList untuk unbounded query adalah incident waiting to happen.
Plain JDBC boleh lebih tepat untuk raw binary streaming besar.
Chunk/keyset lebih mudah retry daripada cursor panjang.
Large result tidak boleh masuk second-level cache.
Logging payload besar adalah production hazard.
```

---

## 38. Apa yang Harus Dikuasai Setelah Part Ini

Setelah memahami bagian ini, kamu harus mampu:

1. membedakan large row count vs large payload problem,
2. mendesain mapper listing yang tidak mengambil CLOB/BLOB,
3. memilih antara pagination, cursor, result handler, dan chunk processing,
4. memahami lifecycle `Cursor<T>`,
5. menghindari `selectList` untuk unbounded query,
6. mendesain async export job yang resumable,
7. menentukan kapan MyBatis cukup dan kapan plain JDBC streaming lebih tepat,
8. mengatur `fetchSize`, `timeout`, `useCache`, dan projection secara sadar,
9. membuat failure model untuk OOM, timeout, stale export, duplicate/missing chunk,
10. melakukan review mapper large data sebelum masuk production.

---

## 39. Referensi

- MyBatis 3 Mapper XML Files — `fetchSize`, `timeout`, statement attributes, result mapping, mapped statement model: https://mybatis.org/mybatis-3/sqlmap-xml.html
- MyBatis 3 Java API — `ResultHandler`, select APIs, session behavior: https://mybatis.org/mybatis-3/java-api.html
- MyBatis 3 Configuration — settings such as `localCacheScope`, executor behavior, type handler configuration: https://mybatis.org/mybatis-3/configuration.html
- MyBatis Cursor API — lazy fetching contract for large result sets: https://mybatis.org/mybatis-3/apidocs/org/apache/ibatis/cursor/Cursor.html
- MyBatis `ClobTypeHandler`: https://mybatis.org/mybatis-3/apidocs/org/apache/ibatis/type/ClobTypeHandler.html
- MyBatis `ClobReaderTypeHandler`: https://mybatis.org/mybatis-3/apidocs/org/apache/ibatis/type/ClobReaderTypeHandler.html
- MyBatis `BlobTypeHandler`: https://mybatis.org/mybatis-3/apidocs/org/apache/ibatis/type/BlobTypeHandler.html

---

## 40. Status Seri

Progress seri:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - selesai
```

Seri belum selesai. Berikutnya:

```text
Part 28 — Modularization and Codebase Governance for Large Mapper Systems
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 26 — Multi-Tenancy, Data Partitioning, and Agency/Module Isolation](./26-multitenancy-data-partitioning-agency-module-isolation.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 28 — Modularization and Codebase Governance for Large Mapper Systems](./28-modularization-codebase-governance-large-mapper-systems.md)

</div>