# Part 16 — Batch Operations: Batch Executor, JDBC Batch, Bulk Insert, Bulk Update

> Seri: `learn-java-mybatis-sql-mapper-persistence-engineering`  
> File: `16-batch-operations-batch-executor-jdbc-batch-bulk-insert-update.md`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami batch operation bukan hanya sebagai optimasi performa, tetapi sebagai desain correctness, transaction, memory, retry, dan failure-handling untuk operasi data berskala besar.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan **loop single-row statement**, **JDBC batch**, **multi-row SQL**, dan **vendor bulk operation**.
2. Memahami cara kerja `ExecutorType.BATCH` di MyBatis.
3. Mendesain batch insert/update/delete yang aman terhadap:
   - timeout,
   - memory pressure,
   - partial failure,
   - duplicate data,
   - retry,
   - deadlock,
   - generated key behavior,
   - transaction rollback.
4. Memilih strategi batch berdasarkan ukuran data, vendor database, kebutuhan atomicity, dan observability.
5. Menulis mapper MyBatis yang jelas untuk:
   - batch insert,
   - bulk insert,
   - batch update,
   - bulk update dengan `CASE`,
   - upsert/merge,
   - chunked processing,
   - idempotent import.
6. Menghindari anti-pattern batch yang umum di enterprise system.

---

## 2. Mental Model: Batch Bukan Sekadar “Lebih Cepat”

Batch operation sering disalahpahami sebagai:

> “Daripada insert satu-satu, kita batch saja supaya cepat.”

Itu benar, tetapi terlalu dangkal.

Dalam sistem production, batch operation adalah persoalan **mengubah banyak state database dengan risiko besar**. Jika salah, efeknya bisa berupa:

- data terduplikasi,
- sebagian data tersimpan dan sebagian gagal,
- lock terlalu lama,
- transaction terlalu besar,
- undo/redo log membengkak,
- connection pool habis,
- aplikasi out-of-memory,
- retry menghasilkan double-write,
- proses import tidak bisa dilanjutkan,
- deadlock massal,
- database CPU spike,
- replication lag,
- audit trail tidak konsisten.

Jadi mental model yang lebih tepat:

```text
Batch operation = controlled mass mutation

controlled:
  ada chunk size
  ada transaction boundary
  ada idempotency key
  ada retry policy
  ada progress tracking
  ada observability
  ada failure recovery

mass mutation:
  banyak row berubah
  banyak lock dibuat
  banyak redo/undo/log tercipta
  banyak resource driver/database dipakai
```

Engineer yang kuat tidak hanya bertanya:

```text
Bagaimana membuat batch lebih cepat?
```

Tapi bertanya:

```text
Bagaimana membuat batch cepat, aman, bisa diulang, bisa dipantau, dan bisa dipulihkan?
```

---

## 3. Empat Bentuk Operasi Banyak Row

Dalam praktik MyBatis, ada minimal empat kategori operasi banyak row.

### 3.1 Single-row statement dalam loop biasa

Contoh:

```java
for (UserImportRow row : rows) {
    userMapper.insertUser(row);
}
```

Jika mapper memakai executor default, setiap pemanggilan mapper menghasilkan statement execution biasa.

Karakteristik:

| Aspek | Karakteristik |
|---|---|
| SQL | Satu statement per row |
| PreparedStatement reuse | Bergantung executor/driver, tetapi bukan batch mutation utama |
| Round trip | Banyak |
| Rows affected | Mudah dibaca per row |
| Error pinpoint | Mudah tahu row mana gagal |
| Performance | Biasanya buruk untuk data besar |
| Transaction | Bisa satu transaction besar atau per chunk |

Kapan masih layak?

- jumlah row kecil,
- correctness lebih penting daripada throughput,
- perlu error handling per row,
- proses administratif kecil,
- tidak ada SLA performa berat.

Anti-pattern:

```java
@Transactional
public void importLargeFile(List<Row> rows) {
    for (Row row : rows) {
        mapper.insert(row); // 500.000 kali
    }
}
```

Masalah:

- transaction sangat besar,
- lock/undo/log besar,
- kemungkinan timeout,
- memory local cache bisa naik,
- failure di akhir membuang semua kerja.

---

### 3.2 JDBC batch via MyBatis `ExecutorType.BATCH`

Konsep:

```text
Aplikasi memanggil mapper berkali-kali
  -> MyBatis/JDBC mengumpulkan statement batch
  -> batch dieksekusi saat flush/commit
```

Contoh kasar:

```java
try (SqlSession session = sqlSessionFactory.openSession(ExecutorType.BATCH)) {
    UserMapper mapper = session.getMapper(UserMapper.class);

    for (User row : rows) {
        mapper.insertUser(row);
    }

    List<BatchResult> results = session.flushStatements();
    session.commit();
}
```

Karakteristik:

| Aspek | Karakteristik |
|---|---|
| SQL | Biasanya satu-row SQL dipanggil berkali-kali |
| JDBC | Menggunakan batch execution |
| Round trip | Lebih sedikit |
| Rows affected | Tersedia setelah flush sebagai `BatchResult` |
| Error pinpoint | Lebih sulit daripada single-row loop |
| Memory | Bisa naik jika tidak flush berkala |
| Generated key | Vendor/driver dependent dan perlu hati-hati |

MyBatis menyediakan `flushStatements()` untuk mengeksekusi batch statement yang tersimpan ketika memakai `ExecutorType.BATCH`.

---

### 3.3 Multi-row SQL insert

Contoh:

```sql
INSERT INTO user_account (
    user_id,
    username,
    status
)
VALUES
    (?, ?, ?),
    (?, ?, ?),
    (?, ?, ?)
```

Dalam XML MyBatis:

```xml
<insert id="insertManyUsers">
  INSERT INTO user_account (
    user_id,
    username,
    status
  )
  VALUES
  <foreach collection="users" item="u" separator=",">
    (
      #{u.userId},
      #{u.username},
      #{u.status}
    )
  </foreach>
</insert>
```

Karakteristik:

| Aspek | Karakteristik |
|---|---|
| SQL | Satu statement besar |
| JDBC batch | Tidak selalu; ini satu SQL dengan banyak values |
| Round trip | Sangat sedikit |
| Parameter count | Bisa sangat besar |
| Error pinpoint | Sulit |
| Generated key | Bisa terbatas/rumit |
| Large bulk | Tidak selalu cocok |

Multi-row insert bagus untuk batch kecil-menengah, tetapi berbahaya untuk jumlah row besar karena:

- SQL text menjadi sangat panjang,
- jumlah parameter bisa melewati batas vendor/driver,
- parsing SQL mahal,
- error sulit dipetakan ke row tertentu.

---

### 3.4 Vendor bulk operation

Contoh:

- Oracle `MERGE`.
- PostgreSQL `COPY` atau `INSERT ... ON CONFLICT`.
- MySQL `LOAD DATA` atau `INSERT ... ON DUPLICATE KEY UPDATE`.
- SQL Server bulk copy atau `MERGE` dengan caveat.

Karakteristik:

| Aspek | Karakteristik |
|---|---|
| Performance | Bisa paling tinggi |
| Portability | Rendah |
| MyBatis role | Biasanya sebagai orchestrator atau SQL caller |
| Error handling | Vendor-specific |
| Generated key | Vendor-specific |
| Observability | Perlu desain khusus |

Dalam sistem serius, vendor bulk sering dipakai untuk import besar, ETL, data archival, reconciliation, atau backfill.

---

## 4. Decision Matrix: Pilih Strategi Mana?

| Kondisi | Strategi yang Umumnya Tepat |
|---|---|
| 1–100 row, admin action biasa | single-row loop atau multi-row insert kecil |
| 100–10.000 row | JDBC batch dengan chunk |
| 10.000–1.000.000 row | chunked JDBC batch atau staging table + bulk SQL |
| Import file besar | staging table + validation + merge |
| Per-row validation kompleks | chunk + per-row error capture |
| Harus idempotent | natural key / idempotency key + upsert/merge |
| Perlu tahu row gagal spesifik | smaller chunk, validation pre-pass, error table |
| Perlu throughput ekstrem | vendor bulk loader / staging / database-native feature |
| Perlu cross-vendor portability | JDBC batch atau MyBatis Dynamic SQL batch |
| Perlu generated key reliable | single insert atau carefully tested batch per vendor |

Rule of thumb:

```text
Small data:
  simplicity wins.

Medium data:
  JDBC batch with chunking wins.

Large data:
  staging + set-based SQL wins.

Huge data:
  database-native bulk loading wins.
```

---

## 5. MyBatis ExecutorType

MyBatis memiliki beberapa executor type yang memengaruhi cara statement dieksekusi.

Secara praktis:

| ExecutorType | Makna |
|---|---|
| `SIMPLE` | membuat statement untuk setiap execution |
| `REUSE` | mencoba reuse prepared statement |
| `BATCH` | membatch update statement dan mengeksekusinya saat flush/commit |

Untuk batch mutation, fokus kita adalah `ExecutorType.BATCH`.

---

## 6. Cara Kerja `ExecutorType.BATCH`

Secara konseptual:

```text
mapper.insert(row1)
  -> statement tidak langsung final dieksekusi ke DB sebagai individual mutation result
  -> ditambahkan ke batch

mapper.insert(row2)
  -> ditambahkan ke batch yang compatible

mapper.insert(row3)
  -> ditambahkan ke batch

flushStatements()
  -> JDBC executeBatch()
  -> MyBatis mengembalikan List<BatchResult>
```

Penting:

- Result update count tidak selalu meaningful sebelum flush.
- Error biasanya muncul saat flush/commit, bukan saat mapper method dipanggil.
- Statement berbeda bisa menghasilkan `BatchResult` berbeda.
- Memory bisa bertambah jika batch terlalu besar sebelum flush.

---

## 7. Basic Manual Batch dengan `SqlSessionFactory`

Contoh manual tanpa Spring:

```java
public final class UserBatchImporter {

    private final SqlSessionFactory sqlSessionFactory;

    public UserBatchImporter(SqlSessionFactory sqlSessionFactory) {
        this.sqlSessionFactory = sqlSessionFactory;
    }

    public void importUsers(List<UserImportRow> rows) {
        try (SqlSession session = sqlSessionFactory.openSession(ExecutorType.BATCH, false)) {
            UserMapper mapper = session.getMapper(UserMapper.class);

            int count = 0;
            for (UserImportRow row : rows) {
                mapper.insertImportedUser(row);
                count++;

                if (count % 500 == 0) {
                    session.flushStatements();
                    session.clearCache();
                }
            }

            session.flushStatements();
            session.commit();
        } catch (RuntimeException ex) {
            throw ex;
        }
    }
}
```

Catatan:

- `openSession(ExecutorType.BATCH, false)` berarti auto-commit false.
- `flushStatements()` mengeksekusi batch yang tertahan.
- `commit()` menyelesaikan transaction.
- `clearCache()` membantu menghindari local cache membesar, terutama jika ada select juga.

Namun contoh ini belum ideal untuk production karena:

- seluruh data masih dalam satu transaction,
- tidak ada chunk commit,
- tidak ada progress tracking,
- tidak ada idempotency,
- tidak ada partial failure handling.

---

## 8. Batch dengan Spring: Hati-hati `SqlSessionTemplate`

Dalam Spring, mapper biasa biasanya memakai `SqlSessionTemplate` default. Untuk batch, kamu sering butuh `SqlSessionTemplate` khusus dengan `ExecutorType.BATCH`.

Contoh konfigurasi:

```java
@Configuration
public class MyBatisBatchConfig {

    @Bean
    public SqlSessionTemplate batchSqlSessionTemplate(SqlSessionFactory sqlSessionFactory) {
        return new SqlSessionTemplate(sqlSessionFactory, ExecutorType.BATCH);
    }
}
```

Lalu gunakan mapper dari template tersebut:

```java
@Repository
public class UserBatchRepository {

    private final SqlSessionTemplate batchSqlSessionTemplate;

    public UserBatchRepository(SqlSessionTemplate batchSqlSessionTemplate) {
        this.batchSqlSessionTemplate = batchSqlSessionTemplate;
    }

    public void insertBatch(List<UserImportRow> rows) {
        UserMapper mapper = batchSqlSessionTemplate.getMapper(UserMapper.class);
        for (UserImportRow row : rows) {
            mapper.insertImportedUser(row);
        }
        batchSqlSessionTemplate.flushStatements();
    }
}
```

Peringatan penting:

```text
ExecutorType tidak boleh dicampur sembarangan dalam transaction yang sama.
```

Jika service method sudah membuka transaction dengan mapper default, lalu mencoba memakai batch template dalam transaction yang sama, kamu perlu memahami konsekuensi session binding Spring. Lebih aman desain boundary jelas:

```java
@Service
public class UserImportService {

    private final UserBatchRepository batchRepository;

    @Transactional
    public void importChunk(List<UserImportRow> chunk) {
        batchRepository.insertBatch(chunk);
    }
}
```

Untuk proses sangat besar, biasanya gunakan transaction per chunk:

```java
@Service
public class UserImportOrchestrator {

    private final UserImportChunkService chunkService;

    public void importAll(List<UserImportRow> rows) {
        for (List<UserImportRow> chunk : chunks(rows, 500)) {
            chunkService.importChunkInNewTransaction(chunk);
        }
    }
}

@Service
class UserImportChunkService {

    private final UserBatchRepository batchRepository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void importChunkInNewTransaction(List<UserImportRow> chunk) {
        batchRepository.insertBatch(chunk);
    }
}
```

Mengapa dipisah class? Karena Spring proxy tidak menerapkan `@Transactional` pada self-invocation.

---

## 9. Chunking: Fondasi Production Batch

Batch tanpa chunking adalah sumber banyak incident.

Chunking berarti:

```text
pecah data besar menjadi unit kecil:
  100 / 500 / 1000 / 5000 row per chunk

lalu setiap chunk punya:
  transaction sendiri
  retry sendiri
  progress sendiri
  error handling sendiri
```

Contoh:

```java
public final class BatchChunks {

    public static <T> List<List<T>> chunks(List<T> source, int size) {
        if (size <= 0) {
            throw new IllegalArgumentException("size must be positive");
        }

        List<List<T>> result = new ArrayList<>();
        for (int start = 0; start < source.size(); start += size) {
            int end = Math.min(start + size, source.size());
            result.add(source.subList(start, end));
        }
        return result;
    }
}
```

Untuk data sangat besar, jangan simpan semua chunk dalam memory. Gunakan iterator/streaming reader.

---

## 10. Menentukan Chunk Size

Tidak ada angka universal. Chunk size adalah kompromi.

| Chunk kecil | Chunk besar |
|---|---|
| error isolation lebih baik | throughput lebih tinggi |
| rollback lebih murah | round trip lebih sedikit |
| lock lebih pendek | lock lebih lama |
| overhead transaction lebih besar | memory/undo/log lebih besar |
| retry lebih mudah | partial failure lebih menyakitkan |

Baseline awal yang masuk akal:

```text
OLTP import biasa:
  100 - 500 rows/chunk

Batch processing internal:
  500 - 2.000 rows/chunk

Bulk load besar:
  5.000+ hanya jika sudah dites dengan vendor DB dan driver
```

Namun keputusan final harus berdasarkan:

- ukuran row,
- jumlah kolom,
- ada/tidak LOB,
- jumlah index,
- trigger database,
- foreign key,
- network latency,
- lock contention,
- redo/undo capacity,
- connection timeout,
- SLA proses.

---

## 11. Batch Insert Mapper

Mapper XML single-row insert yang bisa dipakai batch executor:

```xml
<insert id="insertImportedUser" parameterType="UserImportRow">
  INSERT INTO user_account (
      user_id,
      username,
      email,
      status,
      created_at,
      created_by
  ) VALUES (
      #{userId},
      #{username},
      #{email},
      #{status},
      #{createdAt},
      #{createdBy}
  )
</insert>
```

Dipanggil berkali-kali dengan `ExecutorType.BATCH`.

Keuntungan:

- SQL tetap pendek,
- parameter count per statement kecil,
- prepared statement bisa dibatch driver,
- lebih aman untuk row banyak daripada satu SQL raksasa.

Kelemahan:

- update count baru jelas setelah flush,
- error pinpoint lebih sulit,
- generated key perlu hati-hati.

---

## 12. Multi-row Insert dengan `<foreach>`

Contoh:

```xml
<insert id="insertManyImportedUsers">
  INSERT INTO user_account (
      user_id,
      username,
      email,
      status,
      created_at,
      created_by
  ) VALUES
  <foreach collection="users" item="u" separator=",">
    (
      #{u.userId},
      #{u.username},
      #{u.email},
      #{u.status},
      #{u.createdAt},
      #{u.createdBy}
    )
  </foreach>
</insert>
```

Parameter object:

```java
public class UserImportBatchCommand {
    private final List<UserImportRow> users;

    public UserImportBatchCommand(List<UserImportRow> users) {
        if (users == null || users.isEmpty()) {
            throw new IllegalArgumentException("users must not be empty");
        }
        this.users = users;
    }

    public List<UserImportRow> getUsers() {
        return users;
    }
}
```

Penting:

- Jangan panggil dengan list kosong.
- Batasi jumlah row.
- Hitung jumlah parameter:

```text
parameter_count = rows * columns
```

Jika 1 row punya 20 kolom, 1.000 row berarti 20.000 parameter. Banyak database/driver punya batas parameter atau performa buruk pada statement terlalu besar.

---

## 13. JDBC Batch vs Multi-row Insert

Ini sering tertukar.

```text
JDBC batch:
  SQL pendek yang sama dikirim berkali-kali sebagai batch execution.

Multi-row insert:
  satu SQL besar dengan banyak VALUES tuple.
```

Perbandingan:

| Aspek | JDBC Batch | Multi-row Insert |
|---|---|---|
| SQL text | pendek/stabil | panjang/berubah sesuai jumlah row |
| Parameter count per statement | kecil | besar |
| Driver optimization | tinggi jika driver bagus | tergantung DB parser |
| Generated key | driver-specific | sering punya limitasi |
| Error isolation | sedang | buruk untuk row tertentu |
| Large data | lebih cocok | kurang cocok |
| Small batch | baik | sangat praktis |

Praktik sehat:

```text
Untuk 10-100 row:
  multi-row insert boleh.

Untuk ratusan-ribuan row:
  JDBC batch lebih aman.

Untuk puluhan ribu ke atas:
  chunked JDBC batch atau staging table.
```

---

## 14. MyBatis Dynamic SQL: Batch Insert vs Multi-row Insert

MyBatis Dynamic SQL mendukung beberapa bentuk insert:

- single row insert,
- multiple row insert,
- batch insert,
- insert select.

Contoh conceptual batch insert dengan Dynamic SQL:

```java
List<InsertStatementProvider<UserRow>> insertStatements = users.stream()
    .map(user -> insert(user)
        .into(userTable)
        .map(userId).toProperty("userId")
        .map(username).toProperty("username")
        .map(status).toProperty("status")
        .build()
        .render(RenderingStrategies.MYBATIS3))
    .collect(Collectors.toList());

try (SqlSession session = sqlSessionFactory.openSession(ExecutorType.BATCH)) {
    UserDynamicSqlMapper mapper = session.getMapper(UserDynamicSqlMapper.class);

    for (InsertStatementProvider<UserRow> statement : insertStatements) {
        mapper.insert(statement);
    }

    session.flushStatements();
    session.commit();
}
```

Dynamic SQL berguna jika:

- ingin metadata table/column type-safe,
- banyak varian query/update,
- ingin mengurangi string XML untuk operasi generated.

Namun untuk batch besar, tetap butuh:

- chunking,
- transaction boundary,
- flush strategy,
- error handling,
- idempotency.

DSL bukan pengganti operational design.

---

## 15. Batch Update Pattern

### 15.1 Same statement, different parameter

XML:

```xml
<update id="updateUserStatus">
  UPDATE user_account
  SET
      status = #{status},
      updated_at = #{updatedAt},
      updated_by = #{updatedBy}
  WHERE user_id = #{userId}
</update>
```

Dipanggil banyak kali dengan batch executor.

Keuntungan:

- aman,
- mudah dibaca,
- rows affected bisa dianalisis dari `BatchResult`,
- cocok untuk update berbeda per row.

Kelemahan:

- masih row-by-row secara logis,
- lock banyak row satu per satu,
- error bisa terjadi saat flush.

---

### 15.2 Bulk update dengan satu statement

Jika semua row mendapat value sama:

```xml
<update id="bulkCloseCases">
  UPDATE case_file
  SET
      status = 'CLOSED',
      closed_at = #{closedAt},
      updated_by = #{updatedBy}
  WHERE case_id IN
  <foreach collection="caseIds" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
    AND status = 'APPROVED'
</update>
```

Bagus untuk:

- update status massal,
- soft delete massal,
- marking processed,
- bulk assignment dengan value sama.

Risiko:

- `IN` terlalu besar,
- lock banyak row sekaligus,
- rows affected bisa kurang dari input karena predicate status,
- perlu chunking ID.

---

### 15.3 Bulk update berbeda value dengan `CASE`

Contoh:

```xml
<update id="bulkUpdateCasePriority">
  UPDATE case_file
  SET
      priority = CASE case_id
      <foreach collection="items" item="item">
        WHEN #{item.caseId} THEN #{item.priority}
      </foreach>
      END,
      updated_at = #{updatedAt},
      updated_by = #{updatedBy}
  WHERE case_id IN
  <foreach collection="items" item="item" open="(" separator="," close=")">
    #{item.caseId}
  </foreach>
</update>
```

Keuntungan:

- satu SQL untuk banyak update berbeda.

Kelemahan:

- SQL bisa sangat besar,
- sulit debug,
- parameter count besar,
- tidak semua vendor optimizer senang,
- error pinpoint buruk,
- maintainability menurun.

Gunakan hanya jika:

- batch kecil-menengah,
- performa row-by-row batch tidak cukup,
- sudah dites execution plan,
- ukuran chunk dibatasi ketat.

---

## 16. Upsert dan Merge

Upsert adalah operasi:

```text
insert jika belum ada,
update jika sudah ada
```

Tapi syntax vendor berbeda.

Contoh PostgreSQL:

```xml
<insert id="upsertExternalReference">
  INSERT INTO external_reference (
      source_system,
      external_id,
      internal_id,
      payload_hash,
      updated_at
  ) VALUES (
      #{sourceSystem},
      #{externalId},
      #{internalId},
      #{payloadHash},
      #{updatedAt}
  )
  ON CONFLICT (source_system, external_id)
  DO UPDATE SET
      internal_id = EXCLUDED.internal_id,
      payload_hash = EXCLUDED.payload_hash,
      updated_at = EXCLUDED.updated_at
</insert>
```

Contoh Oracle `MERGE`:

```xml
<insert id="mergeExternalReference">
  MERGE INTO external_reference target
  USING (
      SELECT
          #{sourceSystem} AS source_system,
          #{externalId} AS external_id,
          #{internalId} AS internal_id,
          #{payloadHash} AS payload_hash,
          #{updatedAt} AS updated_at
      FROM dual
  ) source
  ON (
      target.source_system = source.source_system
      AND target.external_id = source.external_id
  )
  WHEN MATCHED THEN UPDATE SET
      target.internal_id = source.internal_id,
      target.payload_hash = source.payload_hash,
      target.updated_at = source.updated_at
  WHEN NOT MATCHED THEN INSERT (
      source_system,
      external_id,
      internal_id,
      payload_hash,
      updated_at
  ) VALUES (
      source.source_system,
      source.external_id,
      source.internal_id,
      source.payload_hash,
      source.updated_at
  )
</insert>
```

Upsert sangat berguna untuk idempotency, tetapi harus didesain hati-hati:

- unique constraint harus benar,
- update harus tidak merusak data final,
- timestamp semantics harus jelas,
- audit event jangan dobel,
- race condition harus dites.

---

## 17. Generated Keys dalam Batch

Generated key di batch adalah area berbahaya.

Single insert:

```xml
<insert id="insertUser"
        useGeneratedKeys="true"
        keyProperty="id">
  INSERT INTO user_account (username)
  VALUES (#{username})
</insert>
```

Batch insert dengan generated keys bisa bermasalah karena:

- tidak semua driver mengembalikan key untuk semua row secara konsisten,
- order key harus cocok dengan order row,
- multi-row insert punya limitation tertentu,
- sequence behavior beda per vendor,
- MyBatis Dynamic SQL multi-row insert juga punya batasan generated values.

Strategi yang lebih aman:

### 17.1 Generate ID di aplikasi

Gunakan UUID/ULID/Snowflake/domain ID sebelum insert:

```java
User row = new User(
    UserId.newId(),
    username,
    status
);
```

Keuntungan:

- batch lebih predictable,
- tidak perlu ambil generated keys,
- bisa idempotent,
- cocok untuk distributed system.

Kelemahan:

- index locality perlu diperhatikan,
- ID lebih besar jika UUID string,
- sequence DB mungkin lebih familiar di legacy system.

### 17.2 Pre-allocate sequence

Untuk Oracle/PostgreSQL sequence, bisa ambil sejumlah ID lebih dulu, lalu assign ke object.

Conceptual:

```sql
SELECT user_account_seq.NEXTVAL FROM dual CONNECT BY LEVEL <= :count
```

Kemudian batch insert dengan ID eksplisit.

### 17.3 Hindari generated key untuk batch besar

Jika batch import besar tidak butuh key langsung di memory, gunakan natural key/import key untuk lookup setelah commit.

---

## 18. Rows Affected dan `BatchResult`

Ketika memakai batch executor, hasil `update`/`insert` dari mapper method bisa tidak sama seperti executor biasa. Hasil sebenarnya muncul setelah flush.

Contoh:

```java
List<BatchResult> batchResults = sqlSession.flushStatements();

for (BatchResult result : batchResults) {
    int[] updateCounts = result.getUpdateCounts();
    String statementId = result.getMappedStatement().getId();

    log.info("statement={}, batches={}", statementId, updateCounts.length);
}
```

Hal yang perlu dipahami:

- `BatchResult` dikelompokkan berdasarkan statement.
- `updateCounts` berasal dari JDBC driver.
- Driver bisa mengembalikan nilai khusus seperti `SUCCESS_NO_INFO`.
- Tidak selalu bisa tahu persis berapa row affected per item.

Implikasi correctness:

```text
Jangan desain business correctness berat hanya dari return int mapper method saat batch mode.
Gunakan flush result, unique constraint, idempotency, dan post-validation.
```

---

## 19. Partial Failure: Problem Paling Penting

Dalam batch, error sering terjadi saat flush:

```text
row 1 accepted into batch
row 2 accepted into batch
row 3 accepted into batch
...
flush
  -> database/driver mengeksekusi
  -> row tertentu gagal karena unique violation / FK / check constraint / deadlock
```

Pertanyaan sulit:

```text
Row mana yang gagal?
Row mana yang sudah dieksekusi?
Apakah transaction rollback semua?
Apakah bisa retry aman?
Apakah data eksternal sudah menerima side effect?
```

Jika transaction rollback seluruh chunk, lebih sederhana:

```text
chunk gagal -> rollback chunk -> retry chunk atau mark failed
```

Jika auto-commit atau transaction boundary buruk, bisa terjadi sebagian row commit. Itu jauh lebih berbahaya.

Rule:

```text
Batch mutation production harus selalu punya transaction boundary eksplisit.
```

---

## 20. Error Isolation Strategy

Untuk import besar, strategi umum:

### 20.1 Validate before write

Lakukan validasi format sebelum batch insert:

- required fields,
- enum code,
- date format,
- duplicate dalam file,
- max length,
- numeric range,
- referential lookup jika murah.

### 20.2 Write to staging table

Masukkan data mentah ke staging:

```text
import_batch
import_batch_row
```

Lalu validasi dan merge secara set-based.

Keuntungan:

- bisa simpan error per row,
- bisa retry,
- bisa audit,
- bisa resume,
- data mentah tidak hilang,
- merge final lebih terkontrol.

### 20.3 Chunk retry

Jika chunk gagal, bisa pecah chunk menjadi lebih kecil untuk menemukan row bermasalah.

Pseudo:

```java
void processChunk(List<Row> chunk) {
    try {
        insertChunk(chunk);
    } catch (DuplicateKeyException ex) {
        if (chunk.size() == 1) {
            markRowFailed(chunk.get(0), ex);
            return;
        }
        int mid = chunk.size() / 2;
        processChunk(chunk.subList(0, mid));
        processChunk(chunk.subList(mid, chunk.size()));
    }
}
```

Ini bukan selalu terbaik, tetapi berguna untuk failure isolation.

---

## 21. Idempotency untuk Batch

Batch yang tidak idempotent tidak aman di production.

Bayangkan proses import 10.000 row:

```text
chunk 1 commit
chunk 2 commit
chunk 3 timeout setelah DB mungkin commit tapi aplikasi tidak tahu
proses di-retry
```

Tanpa idempotency, retry bisa membuat duplikasi.

Idempotency strategy:

1. Gunakan unique key natural/import key.
2. Gunakan upsert/merge.
3. Simpan `import_batch_id` dan `row_number`.
4. Simpan hash payload.
5. Simpan processing status.
6. Pastikan retry menghasilkan final state yang sama.

Contoh table:

```sql
CREATE TABLE import_batch_row (
    import_batch_id VARCHAR(64) NOT NULL,
    row_no          INTEGER NOT NULL,
    external_id     VARCHAR(128) NOT NULL,
    payload_hash    VARCHAR(128) NOT NULL,
    status          VARCHAR(32) NOT NULL,
    error_code      VARCHAR(64),
    error_message   VARCHAR(1000),
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    PRIMARY KEY (import_batch_id, row_no)
);
```

Idempotent insert:

```text
same import_batch_id + row_no
  -> tidak insert dua kali
```

Idempotent final merge:

```text
same source_system + external_id
  -> final row sama walaupun proses diulang
```

---

## 22. Transaction Boundary: One Huge Transaction vs Per Chunk

### 22.1 One huge transaction

```text
insert 1 juta row dalam satu transaction
```

Kelebihan:

- all-or-nothing global.

Kekurangan:

- undo/redo besar,
- lock lama,
- rollback mahal,
- timeout tinggi,
- replication/log pressure,
- recovery sulit,
- resource pool lama tertahan.

Biasanya buruk untuk production OLTP.

### 22.2 Per chunk transaction

```text
500 row per transaction
```

Kelebihan:

- rollback murah,
- progress bisa disimpan,
- lock lebih pendek,
- retry lebih mudah,
- failure lebih terisolasi.

Kekurangan:

- tidak all-or-nothing global,
- perlu status/progress model,
- perlu idempotency.

Untuk enterprise batch, per chunk transaction biasanya lebih realistis.

---

## 23. Progress Tracking

Batch production perlu progress table.

Contoh:

```sql
CREATE TABLE import_job (
    job_id              VARCHAR(64) PRIMARY KEY,
    file_name           VARCHAR(255) NOT NULL,
    status              VARCHAR(32) NOT NULL,
    total_rows          INTEGER,
    processed_rows      INTEGER NOT NULL,
    success_rows        INTEGER NOT NULL,
    failed_rows         INTEGER NOT NULL,
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    last_error_message  VARCHAR(2000),
    created_by          VARCHAR(128) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL
);
```

Status:

```text
PENDING
VALIDATING
PROCESSING
PARTIAL_SUCCESS
SUCCESS
FAILED
CANCELLED
```

Progress update jangan dilakukan dalam transaction yang akan rollback bersama chunk utama jika tujuannya mencatat failure. Gunakan transaction terpisah atau status table yang diupdate setelah chunk transaction selesai.

---

## 24. Batch Delete dan Soft Delete

Hard delete massal berisiko besar.

Lebih aman:

```xml
<update id="softDeleteUsers">
  UPDATE user_account
  SET
      deleted = 1,
      deleted_at = #{deletedAt},
      deleted_by = #{deletedBy},
      updated_at = #{deletedAt},
      updated_by = #{deletedBy}
  WHERE user_id IN
  <foreach collection="userIds" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
    AND deleted = 0
</update>
```

Untuk hard delete:

- pastikan FK behavior jelas,
- pastikan audit/legal requirement,
- chunk ID,
- jangan delete tanpa predicate ketat,
- gunakan dry-run count,
- simpan backup/snapshot jika high-risk,
- observability wajib.

Anti-pattern:

```xml
<delete id="deleteByStatus">
  DELETE FROM case_file
  WHERE status = #{status}
</delete>
```

Terlalu luas. Tambahkan scope:

```sql
WHERE status = #{status}
  AND agency_id = #{agencyId}
  AND created_at < #{before}
  AND deleted = 0
```

---

## 25. Bulk Claim Pattern untuk Worker

Batch sering dipakai dalam worker queue internal.

Pattern:

```text
claim N pending rows
mark PROCESSING
process outside lock if possible
mark SUCCESS/FAILED
```

Contoh PostgreSQL/Oracle modern style:

```sql
SELECT job_id
FROM background_job
WHERE status = 'PENDING'
ORDER BY created_at, job_id
FETCH FIRST #{limit} ROWS ONLY
FOR UPDATE SKIP LOCKED
```

Kemudian update:

```sql
UPDATE background_job
SET status = 'PROCESSING', claimed_by = #{workerId}, claimed_at = #{now}
WHERE job_id IN (...)
```

Dalam MyBatis, pisahkan:

- mapper untuk claim candidate,
- mapper untuk mark processing,
- mapper untuk mark success/failed.

Peringatan:

- jangan memegang lock selama proses eksternal lama,
- gunakan heartbeat/lease timeout,
- worker crash harus bisa direcover,
- idempotency tetap wajib.

---

## 26. Memory Pressure

Batch bisa memakan memory dari beberapa arah:

1. List input terlalu besar di aplikasi.
2. MyBatis batch executor menyimpan statement/parameter sampai flush.
3. Local cache menahan object.
4. JDBC driver menyimpan batch parameter.
5. Result object dari query besar termaterialisasi semua.
6. Logging SQL/parameter terlalu besar.

Mitigasi:

- streaming read input,
- chunk kecil,
- flush berkala,
- `clearCache()`,
- jangan log payload besar,
- jangan pakai `selectList` untuk jutaan row,
- gunakan cursor/fetch size untuk source data,
- hindari LOB dalam batch jika tidak perlu.

---

## 27. Timeout dan Lock

Batch lebih cepat per row, tetapi bisa memperpanjang lock jika transaction besar.

Timeout yang perlu dipikirkan:

| Timeout | Dampak |
|---|---|
| application request timeout | user/API melihat gagal |
| transaction timeout | rollback chunk |
| JDBC query timeout | statement dibatalkan |
| lock wait timeout | gagal menunggu lock |
| connection pool timeout | tidak dapat connection |
| load balancer timeout | response terputus |
| job scheduler timeout | job dianggap gagal |

Rule:

```text
Batch besar jangan dijalankan sebagai synchronous HTTP request biasa.
```

Gunakan:

- async job,
- background worker,
- progress endpoint,
- cancellation model,
- retry policy,
- notification setelah selesai.

---

## 28. Retry Strategy

Retry hanya aman jika operasi idempotent.

Retry cocok untuk:

- transient connection failure,
- deadlock victim,
- lock timeout tertentu,
- temporary unavailable,
- serialization failure.

Retry tidak cocok untuk:

- validation error,
- unique violation non-idempotent,
- FK missing karena data memang salah,
- check constraint violation,
- syntax/mapping bug.

Retry boundary:

```text
retry per chunk, bukan per seluruh import besar
```

Pseudo:

```java
for (List<Row> chunk : chunkReader) {
    retryTemplate.execute(() -> {
        chunkService.processChunk(chunk);
        return null;
    });
}
```

Retry harus punya:

- max attempt,
- exponential backoff,
- jitter,
- classification exception,
- idempotency key,
- logging correlation id.

---

## 29. Staging Table Pattern

Untuk import/batch kompleks, staging table sering lebih baik daripada langsung menulis final table.

Pipeline:

```text
1. upload file
2. create import_job
3. parse file
4. insert raw rows to staging table
5. validate staging rows
6. mark row errors
7. merge valid rows into final table
8. summarize result
9. expose report
```

Keuntungan:

- error per row jelas,
- retry aman,
- audit lengkap,
- final table tidak tercemar data invalid,
- validation bisa set-based,
- user bisa download error report,
- reconciliation lebih mudah.

Contoh staging table:

```sql
CREATE TABLE user_import_staging (
    import_job_id VARCHAR(64) NOT NULL,
    row_no        INTEGER NOT NULL,
    username      VARCHAR(128),
    email         VARCHAR(255),
    status_code   VARCHAR(32),
    payload_hash  VARCHAR(128) NOT NULL,
    validation_status VARCHAR(32) NOT NULL,
    error_code    VARCHAR(64),
    error_message VARCHAR(1000),
    created_at    TIMESTAMP NOT NULL,
    PRIMARY KEY (import_job_id, row_no)
);
```

Final merge bisa set-based:

```sql
MERGE INTO user_account target
USING (
    SELECT username, email, status_code
    FROM user_import_staging
    WHERE import_job_id = :jobId
      AND validation_status = 'VALID'
) source
ON (target.username = source.username)
WHEN MATCHED THEN UPDATE SET ...
WHEN NOT MATCHED THEN INSERT ...
```

MyBatis tetap berguna untuk menjalankan SQL tersebut, tetapi desain utama berpindah dari row-by-row application logic ke set-based database logic.

---

## 30. Batch dan Audit Trail

Pertanyaan audit:

```text
Jika 10.000 row berubah, apakah butuh 10.000 audit row?
Atau cukup 1 audit event batch?
Atau dua-duanya?
```

Jawaban tergantung domain.

Untuk regulatory/case management, biasanya butuh:

1. Batch-level audit:
   - siapa menjalankan,
   - file/source apa,
   - kapan,
   - jumlah row,
   - hasil akhir.
2. Row-level audit untuk perubahan penting:
   - entity id,
   - old value,
   - new value,
   - reason,
   - actor/system.

Jangan membuat audit trail sebagai side effect tak terkendali yang membuat batch 10x lebih lambat tanpa disadari.

Design option:

- insert audit row dalam batch juga,
- pakai database trigger dengan hati-hati,
- pakai outbox event setelah commit,
- simpan summary + detail error.

---

## 31. Batch dan Security Scope

Batch operation harus tetap menghormati authorization.

Contoh bahaya:

```xml
<update id="bulkApprove">
  UPDATE case_file
  SET status = 'APPROVED'
  WHERE case_id IN (...)
</update>
```

Jika caller hanya boleh mengakses agency tertentu, query harus memasukkan scope:

```xml
<update id="bulkApprove">
  UPDATE case_file
  SET
      status = 'APPROVED',
      approved_by = #{actorUserId},
      approved_at = #{approvedAt}
  WHERE case_id IN
  <foreach collection="caseIds" item="id" open="(" separator="," close=")">
    #{id}
  </foreach>
    AND agency_id = #{agencyId}
    AND status = 'PENDING_APPROVAL'
</update>
```

Setelah execute:

```java
int updated = mapper.bulkApprove(command);
if (updated != command.caseIds().size()) {
    throw new ConcurrentOrUnauthorizedBulkUpdateException();
}
```

Rows affected yang kurang bisa berarti:

- tidak authorized,
- row tidak ada,
- status berubah oleh user lain,
- soft-deleted,
- duplicate id input.

Jangan langsung asumsikan satu penyebab.

---

## 32. Batch dan Optimistic Locking

Batch update dengan version:

```xml
<update id="updateCaseStatusIfVersionMatches">
  UPDATE case_file
  SET
      status = #{newStatus},
      version = version + 1,
      updated_at = #{updatedAt},
      updated_by = #{updatedBy}
  WHERE case_id = #{caseId}
    AND version = #{expectedVersion}
</update>
```

Dipakai dengan `ExecutorType.BATCH` untuk banyak case.

Namun jika beberapa update gagal karena version mismatch, kamu baru tahu setelah flush dan update count analysis.

Alternatif:

- lakukan pre-validation,
- gunakan smaller chunk,
- simpan failed rows,
- post-verify version/result,
- jangan paksa all-or-nothing jika business memperbolehkan partial success.

---

## 33. Batch dan Second-Level Cache

Batch mutation harus memperhatikan cache.

Secara umum:

```text
DML harus flush cache yang relevan.
```

Untuk batch besar:

- hindari second-level cache untuk mapper yang sering bulk update,
- pastikan invalidation benar,
- jangan mengandalkan cache untuk data yang baru di-batch,
- lebih baik query ulang setelah commit.

Jika memakai application cache/Redis:

- invalidasi per key bisa mahal,
- invalidasi by pattern bisa berbahaya,
- gunakan versioned cache key atau event-based invalidation,
- pertimbangkan batch-level cache busting.

---

## 34. Observability Batch

Batch tanpa observability akan menyulitkan incident response.

Minimal log:

```text
job_id
chunk_no
chunk_size
statement_id
start_time
end_time
duration_ms
success_count
failure_count
retry_count
exception_class
correlation_id
```

Metrics:

```text
batch_job_started_total
batch_job_completed_total
batch_job_failed_total
batch_chunk_duration_seconds
batch_rows_processed_total
batch_rows_failed_total
batch_retry_total
batch_deadlock_total
batch_lock_timeout_total
batch_flush_duration_seconds
```

Tracing:

- jangan trace setiap row untuk batch besar,
- trace per chunk,
- sampling untuk detail row jika perlu,
- tag statement id, job id, chunk id.

Logging SQL:

- jangan log semua parameter untuk ribuan rows,
- mask PII,
- log summary,
- simpan error report aman.

---

## 35. Testing Batch

Batch test tidak cukup dengan “method tidak error”.

Test minimal:

1. Insert 0 row ditolak atau no-op jelas.
2. Insert 1 row berhasil.
3. Insert banyak row berhasil.
4. Duplicate key behavior jelas.
5. FK violation rollback chunk.
6. Partial chunk failure tidak commit sebagian jika harus atomic.
7. Retry idempotent tidak membuat duplicate.
8. Generated key behavior sesuai vendor.
9. Rows affected benar atau dipahami jika driver memberi `SUCCESS_NO_INFO`.
10. Transaction per chunk bekerja.
11. Large input tidak OOM.
12. Timeout/lock simulation jika memungkinkan.

Gunakan database asli via Testcontainers untuk behavior vendor. H2 sering tidak cukup untuk batch/vendor semantics.

---

## 36. Example: Production-Grade User Import

### 36.1 Flow

```text
User uploads file
  -> create import_job PENDING
  -> parse file stream
  -> insert staging rows in chunks
  -> validate staging rows
  -> mark invalid rows
  -> merge valid rows into final table in chunks/set-based SQL
  -> create audit summary
  -> mark job SUCCESS/PARTIAL_SUCCESS/FAILED
```

### 36.2 Mapper methods

```java
public interface UserImportMapper {

    int insertStagingRow(UserImportStagingRow row);

    int markDuplicateRows(String importJobId);

    int markInvalidStatusCode(String importJobId);

    int mergeValidRowsToUserAccount(String importJobId, Instant now, String actor);

    int countValidRows(String importJobId);

    int countInvalidRows(String importJobId);
}
```

### 36.3 Batch repository

```java
@Repository
public class UserImportBatchRepository {

    private final SqlSessionTemplate batchSqlSessionTemplate;

    public UserImportBatchRepository(SqlSessionTemplate batchSqlSessionTemplate) {
        this.batchSqlSessionTemplate = batchSqlSessionTemplate;
    }

    public void insertStagingRows(List<UserImportStagingRow> rows) {
        UserImportMapper mapper = batchSqlSessionTemplate.getMapper(UserImportMapper.class);

        for (UserImportStagingRow row : rows) {
            mapper.insertStagingRow(row);
        }

        batchSqlSessionTemplate.flushStatements();
    }
}
```

### 36.4 Chunk service

```java
@Service
public class UserImportChunkService {

    private final UserImportBatchRepository batchRepository;
    private final ImportJobMapper importJobMapper;

    public UserImportChunkService(
            UserImportBatchRepository batchRepository,
            ImportJobMapper importJobMapper
    ) {
        this.batchRepository = batchRepository;
        this.importJobMapper = importJobMapper;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void insertStagingChunk(String jobId, int chunkNo, List<UserImportStagingRow> rows) {
        batchRepository.insertStagingRows(rows);
        importJobMapper.incrementProcessedRows(jobId, rows.size());
    }
}
```

### 36.5 Orchestrator

```java
@Service
public class UserImportOrchestrator {

    private static final int CHUNK_SIZE = 500;

    private final UserImportChunkService chunkService;

    public UserImportOrchestrator(UserImportChunkService chunkService) {
        this.chunkService = chunkService;
    }

    public void importRows(String jobId, Iterator<UserImportStagingRow> rowIterator) {
        List<UserImportStagingRow> buffer = new ArrayList<>(CHUNK_SIZE);
        int chunkNo = 0;

        while (rowIterator.hasNext()) {
            buffer.add(rowIterator.next());

            if (buffer.size() == CHUNK_SIZE) {
                chunkService.insertStagingChunk(jobId, ++chunkNo, new ArrayList<>(buffer));
                buffer.clear();
            }
        }

        if (!buffer.isEmpty()) {
            chunkService.insertStagingChunk(jobId, ++chunkNo, buffer);
        }
    }
}
```

Catatan:

- Iterator mencegah seluruh file dimuat sekaligus.
- Chunk punya transaction terpisah.
- Progress disimpan.
- Retry bisa ditambahkan di level chunk.

---

## 37. Anti-Pattern Batch yang Harus Dihindari

### 37.1 Satu transaction untuk semua data besar

```java
@Transactional
public void importAll(List<Row> rows) {
    for (Row row : rows) {
        mapper.insert(row);
    }
}
```

Masalah:

- rollback mahal,
- lock lama,
- failure recovery buruk.

---

### 37.2 Multi-row insert tanpa batas ukuran

```xml
<foreach collection="rows" item="r" separator=",">
  (...)
</foreach>
```

Jika rows berisi 50.000 item, SQL bisa meledak.

---

### 37.3 Batch tanpa idempotency

```text
retry setelah timeout -> duplicate data
```

---

### 37.4 Mengandalkan return int mapper di batch mode

Dalam batch executor, hasil meaningful ada setelah flush.

---

### 37.5 Mengirim batch besar lewat HTTP synchronous

Upload/import besar harus jadi background job dengan progress.

---

### 37.6 Tidak ada error report per row

User/admin tidak bisa memperbaiki data.

---

### 37.7 Logging parameter ribuan row

Bisa menyebabkan:

- log bengkak,
- PII leak,
- performance drop.

---

### 37.8 Batch update tanpa authorization predicate

Bulk operation yang melewati scope user adalah security incident.

---

## 38. Java 8 sampai Java 25 Considerations

### Java 8

Gunakan:

- POJO command object,
- `Iterator` untuk streaming input,
- `try-with-resources`,
- `CompletableFuture` jika perlu async sederhana,
- hindari record/sealed class.

### Java 11

Tambahan kecil:

- HTTP client untuk external import orchestration,
- better runtime baseline,
- masih gunakan POJO jika kompatibilitas penting.

### Java 17

Mulai bisa gunakan:

- record untuk immutable command/projection,
- sealed interface untuk batch result status,
- switch expression.

Contoh:

```java
public record BatchChunkResult(
    String jobId,
    int chunkNo,
    int attemptedRows,
    int successRows,
    int failedRows
) {}
```

### Java 21+

Virtual threads bisa membantu jika batch melakukan banyak blocking I/O, tetapi jangan salah paham:

```text
Virtual thread tidak membuat database mampu menerima infinite concurrent batch.
```

Tetap batasi:

- connection pool,
- worker concurrency,
- chunk concurrency,
- database lock contention.

### Java 25

Desain tetap sama. Fitur bahasa boleh modern, tetapi batch correctness tetap bergantung pada:

- transaction,
- idempotency,
- SQL design,
- DB constraint,
- observability,
- failure recovery.

---

## 39. Production Checklist

Sebelum batch MyBatis masuk production, jawab pertanyaan berikut.

### Scope

- [ ] Berapa maksimal row?
- [ ] Berapa ukuran rata-rata row?
- [ ] Ada LOB/JSON besar?
- [ ] Ada FK/trigger/index berat?

### Strategy

- [ ] Pakai single-row loop, JDBC batch, multi-row insert, atau staging?
- [ ] Kenapa strategi itu dipilih?
- [ ] Apakah sudah dites dengan database vendor asli?

### Transaction

- [ ] Satu transaction atau per chunk?
- [ ] Jika per chunk, bagaimana global status?
- [ ] Apa yang terjadi jika chunk ke-10 gagal?

### Idempotency

- [ ] Apakah retry aman?
- [ ] Apa unique key idempotency?
- [ ] Apakah timeout bisa menyebabkan double-write?

### Error Handling

- [ ] Bisa tahu row mana gagal?
- [ ] Ada error report?
- [ ] Validation error dibedakan dari transient error?

### Performance

- [ ] Chunk size sudah diuji?
- [ ] Fetch size/flush size sudah diatur?
- [ ] Query plan bulk update sudah dicek?
- [ ] Lock duration dipahami?

### Security

- [ ] Tenant/agency/user scope masuk predicate?
- [ ] Tidak ada `${}` unsafe?
- [ ] PII tidak bocor di log?

### Observability

- [ ] Ada job id?
- [ ] Ada chunk metrics?
- [ ] Ada retry metrics?
- [ ] Ada slow chunk logging?

### Recovery

- [ ] Bisa resume?
- [ ] Bisa cancel?
- [ ] Bisa retry partial?
- [ ] Bisa reconcile final count?

---

## 40. Ringkasan Mental Model

Batch operation di MyBatis harus dipahami sebagai desain mass mutation.

```text
Loop biasa:
  sederhana, lambat, error isolation bagus.

ExecutorType.BATCH:
  cocok untuk banyak statement sejenis, perlu flush/chunk/transaction jelas.

Multi-row insert:
  praktis untuk batch kecil-menengah, rawan parameter explosion.

Bulk set-based SQL:
  kuat untuk update/merge besar, tetapi vendor-specific dan perlu plan review.

Staging table:
  pilihan paling robust untuk import besar, validasi kompleks, audit, dan recovery.
```

Prinsip utama:

```text
Do not optimize batch before defining correctness.
```

Urutan desain yang benar:

```text
1. Tentukan business atomicity.
2. Tentukan idempotency key.
3. Tentukan chunk/transaction boundary.
4. Tentukan SQL strategy.
5. Tentukan error handling.
6. Tentukan observability.
7. Baru optimasi throughput.
```

Top-tier engineer tidak hanya membuat batch cepat. Ia membuat batch yang tetap benar saat timeout, retry, partial failure, concurrent update, duplicate input, dan database pressure.

---

## 41. Koneksi ke Part Berikutnya

Part ini membahas operasi batch dan bulk mutation.

Bagian berikutnya akan masuk ke:

```text
Part 17 — Caching: First-Level Cache, Second-Level Cache, Invalidation
```

Kenapa caching dibahas setelah batch?

Karena batch mutation sering menjadi penyebab cache stale. Jika banyak row berubah, pertanyaan berikutnya adalah:

```text
Data mana yang masih valid di cache?
Cache mana yang harus dibersihkan?
Apakah local cache MyBatis bisa menipu pembacaan dalam transaction?
Apakah second-level cache aman untuk mapper yang sering bulk update?
```

