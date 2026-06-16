# Part 028 — Database-Specific Integration: Oracle, PostgreSQL, MySQL, SQL Server

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> File: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-028.md`  
> Target: Java 8–25, JPA `javax.persistence`, Jakarta Persistence `jakarta.persistence`, Hibernate ORM 5/6/7, Spring Data JPA, Jakarta Data, Jakarta Transactions, database integration production-grade.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Berhenti menganggap semua relational database punya perilaku sama.
2. Memahami bagian mana dari JPA/Hibernate yang portable dan bagian mana yang sangat dipengaruhi dialect database.
3. Mendesain persistence layer yang aman terhadap perbedaan Oracle, PostgreSQL, MySQL/InnoDB, dan SQL Server.
4. Memilih strategi identifier, pagination, locking, isolation, timestamp, JSON, LOB, dan schema migration berdasarkan karakter database yang dipakai.
5. Menganalisis bug production yang hanya muncul di database tertentu walaupun code Java/JPA terlihat “benar”.
6. Menentukan kapan harus tetap memakai JPA portable dan kapan harus sengaja memakai native SQL/vendor-specific feature.
7. Membuat checklist review untuk sistem enterprise/case-management yang memakai database berbeda antar environment atau antar klien.

---

## 2. Mental Model: ORM Is Portable, Database Behavior Is Not

JPA/Jakarta Persistence memberi abstraction untuk object/relational mapping. Hibernate menambahkan provider capability di atasnya. Tetapi database tetap punya perilaku nyata sendiri.

Abstraction JPA biasanya cukup baik untuk:

- entity lifecycle,
- persistence context,
- dirty checking,
- basic relationship mapping,
- JPQL query sederhana,
- optimistic locking,
- transaction demarcation level aplikasi.

Namun abstraction mulai bocor ketika menyentuh:

- identifier generation,
- sequence vs identity,
- batching,
- pagination SQL,
- isolation semantics,
- lock syntax,
- lock timeout behavior,
- deadlock behavior,
- timestamp/timezone,
- LOB storage,
- JSON type,
- boolean type,
- enum mapping,
- generated column,
- index feature,
- full-text search,
- materialized view,
- partitioning,
- trigger/procedure,
- schema migration,
- query optimizer behavior.

Rule senior engineer:

> JPA hides syntax differences. It does not erase database semantics.

Maksudnya, `entityManager.find()` mungkin terlihat sama di Oracle, PostgreSQL, MySQL, dan SQL Server. Tetapi query yang dihasilkan, lock yang diambil, execution plan yang dipilih, isolation anomaly yang mungkin terjadi, dan performa di bawah concurrency bisa berbeda.

---

## 3. Layer Database-Specific Behavior

Agar tidak bingung, pisahkan perbedaan database menjadi beberapa layer.

```text
Application Use Case
    ↓
Repository / Query Object
    ↓
JPA / Jakarta Persistence API
    ↓
Provider: Hibernate / EclipseLink
    ↓
Dialect: OracleDialect / PostgreSQLDialect / MySQLDialect / SQLServerDialect
    ↓
JDBC Driver
    ↓
Database Engine
    ↓
Storage / Lock Manager / MVCC / Optimizer
```

### 3.1 JPA Layer

JPA mendefinisikan API dan contract umum:

- `@Entity`,
- `@Id`,
- `@GeneratedValue`,
- `@Version`,
- JPQL,
- Criteria API,
- lock modes,
- flush modes,
- entity lifecycle.

Tetapi JPA tidak menjamin semua database punya perilaku physical yang sama.

### 3.2 Provider Layer

Hibernate menerjemahkan mapping dan query ke SQL. Provider menentukan:

- SQL generation strategy,
- batching behavior,
- fetch strategy,
- schema tooling,
- type mapping,
- custom type support,
- cache support,
- dialect-specific feature support.

### 3.3 Dialect Layer

Dialect adalah komponen yang tahu variasi SQL/database tertentu:

- cara limit/offset,
- sequence syntax,
- identity column syntax,
- locking syntax,
- boolean type,
- timestamp type,
- JSON type,
- DDL generation,
- function mapping,
- reserved keywords,
- exception conversion.

Dialect bukan “detail kecil”. Dialect bisa menentukan apakah aplikasi batch insert bisa cepat atau lambat.

### 3.4 Database Engine Layer

Engine menentukan perilaku sesungguhnya:

- MVCC/read consistency,
- lock mode,
- deadlock detection,
- isolation semantics,
- optimizer,
- statistics,
- index access path,
- undo/redo/WAL/transaction log,
- LOB storage,
- partition pruning.

---

## 4. Portable vs Vendor-Specific: Cara Mengambil Keputusan

Tidak semua vendor-specific feature buruk. Yang buruk adalah vendor-specific feature yang dipakai tanpa sadar.

### 4.1 Pakai Portable JPA Jika

Gunakan mapping/query portable jika:

- use case sederhana,
- tidak high-volume,
- tidak high-contention,
- query tidak butuh fitur database khusus,
- portability antar database penting,
- performance sudah cukup,
- correctness tidak bergantung pada semantic spesifik vendor.

Contoh:

```java
@Entity
@Table(name = "case_file")
public class CaseFile {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq")
    @SequenceGenerator(name = "case_file_seq", sequenceName = "case_file_seq", allocationSize = 50)
    private Long id;

    @Version
    private long version;

    @Column(nullable = false, length = 30)
    private String status;
}
```

### 4.2 Pakai Vendor-Specific Jika

Gunakan native/vendor-specific jika:

- query butuh CTE/window function/JSON operator/full-text/partition hint,
- locking butuh `SKIP LOCKED`/`NOWAIT`,
- pagination butuh keyset optimal,
- bulk operation lebih baik set-based SQL,
- report/dashboard berat,
- optimizer butuh index hint atau computed column,
- data type tidak portable,
- fitur database memberi correctness guarantee yang JPA tidak sediakan.

Contoh PostgreSQL `SKIP LOCKED` untuk worker queue:

```sql
SELECT id
FROM outbox_event
WHERE status = 'NEW'
ORDER BY id
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

Contoh Oracle:

```sql
SELECT id
FROM outbox_event
WHERE status = 'NEW'
ORDER BY id
FETCH FIRST 100 ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Catatan: detail syntax bisa berbeda antar versi database. Jangan copy lintas database tanpa test integrasi.

### 4.3 Decision Rule

Gunakan prinsip ini:

```text
Start portable.
Measure behavior.
Identify bottleneck/correctness gap.
Use vendor-specific feature intentionally.
Isolate it behind repository/query object.
Test it using the actual database.
Document the database contract.
```

---

## 5. Identifier Generation: Sequence, Identity, UUID, Hi/Lo

Identifier generation adalah area pertama di mana database-specific behavior terasa.

### 5.1 GenerationType.AUTO

`GenerationType.AUTO` berarti provider memilih strategi yang sesuai. Ini nyaman untuk demo, tetapi kurang ideal untuk sistem besar karena pilihan provider/dialect bisa berubah ketika database/provider berubah.

Lebih baik explicit:

```java
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "application_seq")
```

atau:

```java
@GeneratedValue(strategy = GenerationType.IDENTITY)
```

### 5.2 Sequence

Sequence cocok untuk:

- Oracle,
- PostgreSQL,
- beberapa database modern lain,
- batch insert dengan preallocation,
- high-throughput insert.

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq_gen")
@SequenceGenerator(
    name = "case_seq_gen",
    sequenceName = "case_seq",
    allocationSize = 50
)
private Long id;
```

Keunggulan sequence:

- ID bisa diperoleh sebelum insert.
- Hibernate bisa batch insert lebih efektif.
- Allocation/pooling mengurangi roundtrip ke database.

Trade-off:

- ID bisa lompat jika transaksi rollback atau JVM restart.
- Jangan gunakan ID sequence sebagai business running number yang harus gapless.

Important invariant:

> Primary key sequence boleh ada gap. Business document number yang harus accountable perlu mekanisme berbeda.

### 5.3 Identity Column

Identity column umum di:

- MySQL auto-increment,
- SQL Server identity,
- PostgreSQL identity/serial,
- Oracle modern identity.

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Kelemahan penting di ORM:

- ID baru diketahui setelah insert.
- Insert sering harus dieksekusi segera.
- JDBC batching bisa lebih sulit/terbatas dibanding sequence pooled.

Untuk high-volume insert, identity sering kalah fleksibel dibanding sequence pooled.

### 5.4 UUID

UUID cocok untuk:

- public id,
- distributed ID generation,
- data merge dari banyak source,
- menghindari enumerability.

Tetapi UUID sebagai primary key punya trade-off:

- index lebih besar,
- random UUID bisa menyebabkan page split,
- locality buruk,
- join lebih berat dibanding numeric key.

Strategi umum:

```text
Internal PK: numeric sequence/identity
Public ID: UUID/ULID/string reference
Business ID: stable business key with unique constraint
```

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_seq")
private Long id;

@Column(name = "public_id", nullable = false, unique = true, updatable = false)
private UUID publicId;

@Column(name = "case_reference", nullable = false, unique = true, length = 40)
private String caseReference;
```

### 5.5 Oracle

Oracle historically sangat kuat dengan sequence. Untuk sistem Java enterprise, `SEQUENCE + allocationSize` biasanya pilihan natural.

Catatan:

- Sequence gap normal.
- Jangan menganggap sequence number = urutan commit.
- Sequence caching dapat membuat gap lebih besar.
- Untuk audit/business reference, gunakan generator khusus dengan locking/serialization jika benar-benar harus accountable.

### 5.6 PostgreSQL

PostgreSQL mendukung sequence dan identity. `BIGSERIAL` historically populer, identity lebih standard SQL modern.

Untuk Hibernate batch insert, explicit sequence dengan allocation size tetap sering lebih mudah dikontrol.

### 5.7 MySQL/InnoDB

MySQL umum memakai auto-increment. `IDENTITY` natural tetapi batching ORM bisa terbatas.

Untuk high-volume insert:

- pertimbangkan JDBC batch manual,
- multi-row insert native,
- staging table,
- bulk load,
- atau custom ID generation di aplikasi jika benar-benar perlu.

### 5.8 SQL Server

SQL Server umum memakai identity dan sequence juga tersedia. Pilihan bergantung pada style schema dan batching need.

### 5.9 Checklist Identifier

- Jangan pakai `AUTO` untuk production system besar tanpa tahu hasilnya.
- Gunakan `Long`/`BIGINT` untuk internal PK jika growth besar.
- Pisahkan internal ID, public ID, dan business reference.
- Jangan menuntut primary key gapless.
- Untuk batch insert besar, evaluasi sequence pooled vs identity.
- Test generated SQL pada database asli.

---

## 6. Pagination: Offset, Fetch First, Top, Limit, Keyset

Pagination terlihat sederhana, tapi SQL-nya vendor-specific.

### 6.1 JPA API

JPA menyediakan:

```java
query.setFirstResult(offset);
query.setMaxResults(limit);
```

Provider menerjemahkan ini ke dialect-specific SQL.

### 6.2 SQL Variasi

PostgreSQL/MySQL:

```sql
SELECT *
FROM case_file
ORDER BY created_at DESC, id DESC
LIMIT 50 OFFSET 1000;
```

Oracle modern:

```sql
SELECT *
FROM case_file
ORDER BY created_at DESC, id DESC
OFFSET 1000 ROWS FETCH NEXT 50 ROWS ONLY;
```

SQL Server:

```sql
SELECT *
FROM case_file
ORDER BY created_at DESC, id DESC
OFFSET 1000 ROWS FETCH NEXT 50 ROWS ONLY;
```

SQL Server older style often involved `TOP` or row-number patterns.

### 6.3 Offset Pagination Problem

Offset pagination buruk untuk page dalam:

```text
OFFSET 100000 LIMIT 50
```

Database tetap perlu melewati banyak row sebelum mengambil 50 row.

Problem:

- makin lambat semakin jauh page,
- hasil bisa bergeser jika data berubah,
- count query bisa mahal,
- index harus cocok dengan sort/filter.

### 6.4 Keyset Pagination

Keyset pagination lebih cocok untuk infinite scroll, queue, timeline, audit log.

```sql
SELECT id, created_at, status
FROM case_file
WHERE (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
FETCH FIRST 50 ROWS ONLY;
```

Tidak semua database punya row value comparison behavior sama. Portable alternative:

```sql
WHERE created_at < :lastCreatedAt
   OR (created_at = :lastCreatedAt AND id < :lastId)
```

### 6.5 Pagination Checklist

- Selalu pakai deterministic `ORDER BY`.
- Tambahkan tie-breaker unik, biasanya `id`.
- Jangan paginate collection fetch join sembarangan.
- Untuk deep page, pilih keyset.
- Untuk report/export, jangan gunakan pagination UI sebagai batch strategy.
- Pastikan index mengikuti `WHERE + ORDER BY`.
- Count query harus diukur terpisah.

---

## 7. Locking: Same JPA LockMode, Different Database Reality

JPA menyediakan `LockModeType`, misalnya:

- `OPTIMISTIC`,
- `OPTIMISTIC_FORCE_INCREMENT`,
- `PESSIMISTIC_READ`,
- `PESSIMISTIC_WRITE`,
- `PESSIMISTIC_FORCE_INCREMENT`.

Tetapi database menerjemahkan lock secara berbeda.

### 7.1 Pessimistic Write

JPA:

```java
CaseFile caseFile = entityManager.find(
    CaseFile.class,
    id,
    LockModeType.PESSIMISTIC_WRITE
);
```

Hibernate biasanya menerjemahkan ke variasi `SELECT ... FOR UPDATE` atau syntax setara.

### 7.2 NOWAIT dan SKIP LOCKED

Untuk queue worker:

- `NOWAIT`: gagal segera jika row locked.
- `SKIP LOCKED`: lewati row yang locked dan ambil row lain.

Ini sangat berguna untuk outbox/inbox/job queue.

Namun:

- fairness tidak selalu terjamin,
- starvation mungkin terjadi,
- ordering bisa tidak strict,
- perlu retry dan monitoring.

### 7.3 Oracle

Oracle mendukung read consistency dan row-level locking. `SELECT FOR UPDATE` lazim untuk pessimistic coordination.

Karakter penting:

- Reader tidak memblok writer seperti lock-based read tradisional karena read consistency.
- Writer bisa saling blok pada row yang sama.
- Long transaction dapat menyebabkan undo pressure.
- `FOR UPDATE NOWAIT` dan `SKIP LOCKED` sering dipakai untuk queue-like workload.

### 7.4 PostgreSQL

PostgreSQL memakai MVCC. Row-level lock didapat melalui `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, dll.

Karakter penting:

- `READ COMMITTED` adalah default umum.
- `SERIALIZABLE` memakai Serializable Snapshot Isolation, bukan sekadar lock semua row.
- `SKIP LOCKED` berguna untuk worker queue.
- Advisory lock tersedia, tetapi harus dipakai disiplin karena bukan constraint data otomatis.

### 7.5 MySQL/InnoDB

InnoDB punya MVCC tetapi locking behavior sangat dipengaruhi index dan isolation.

Karakter penting:

- Default isolation sering `REPEATABLE READ`.
- Gap lock/next-key lock dapat muncul dalam range query.
- Query tanpa index yang baik dapat mengunci lebih banyak dari yang diduga.
- Deadlock umum pada workload update concurrent.

### 7.6 SQL Server

SQL Server punya lock manager kuat dan isolation mode beragam.

Karakter penting:

- Lock escalation bisa terjadi.
- `READ_COMMITTED_SNAPSHOT` mengubah behavior read committed menjadi row-versioning.
- Hint seperti `UPDLOCK`, `READPAST`, `ROWLOCK` sering dipakai pada pattern tertentu, tetapi harus hati-hati.

### 7.7 Locking Checklist

- Jangan mengandalkan nama `LockModeType` saja; lihat SQL generated.
- Selalu set lock timeout untuk request path.
- Gunakan deterministic lock order.
- Pastikan predicate lock menggunakan index yang benar.
- Jangan tahan lock sambil call external API.
- Untuk queue, pertimbangkan `SKIP LOCKED` dengan retry dan dead-letter.
- Bedakan contention problem vs data model problem.

---

## 8. Isolation Semantics: Names Are Similar, Behavior Differs

Isolation level standard:

- `READ_UNCOMMITTED`,
- `READ_COMMITTED`,
- `REPEATABLE_READ`,
- `SERIALIZABLE`.

Masalahnya: nama sama tidak selalu berarti implementasi sama.

### 8.1 Oracle

Oracle memakai multi-version read consistency. `READ COMMITTED` memberi statement-level consistency. `SERIALIZABLE` memberi transaction-level consistency dengan kemungkinan serialization errors.

Practical consequence:

- Query pertama dan query kedua dalam transaksi `READ COMMITTED` bisa melihat committed data berbeda.
- Reader biasanya tidak memblok writer.
- Long-running query bergantung pada undo untuk consistent read.

### 8.2 PostgreSQL

PostgreSQL menyediakan MVCC. `READ COMMITTED` melihat snapshot per statement. `REPEATABLE READ` memberi snapshot transaction-level dan mencegah banyak anomaly, tetapi `SERIALIZABLE` adalah level yang menargetkan serializable behavior dengan SSI.

Practical consequence:

- Write skew harus dipahami.
- Serializable transaction bisa gagal dan perlu retry.
- Retry harus dari boundary use case, bukan setengah transaksi.

### 8.3 MySQL/InnoDB

InnoDB default `REPEATABLE READ` sering mengejutkan developer yang terbiasa `READ COMMITTED`.

Practical consequence:

- Consistent read dan locking read berbeda.
- Range update/select-for-update bisa mengambil next-key/gap locks.
- Index design sangat memengaruhi lock footprint.

### 8.4 SQL Server

SQL Server default traditionally `READ COMMITTED` lock-based, tetapi banyak deployment mengaktifkan row-versioned `READ_COMMITTED_SNAPSHOT`.

Practical consequence:

- Behavior read/write blocking bisa sangat berbeda antar environment.
- Snapshot isolation harus diaktifkan/configured.
- Lock escalation dapat membuat impact lebih besar dari row-level operation.

### 8.5 Isolation Checklist

- Dokumentasikan isolation level environment.
- Jangan assume default database.
- Buat concurrency test terhadap database asli.
- Untuk invariant penting, gunakan constraint/locking/conditional update/versioning.
- Treat serialization/deadlock/lock timeout as normal retriable class jika use case aman di-retry.

---

## 9. Boolean, Enum, and Small Type Differences

### 9.1 Boolean

Database berbeda dalam representasi boolean:

- PostgreSQL punya `boolean` native.
- MySQL sering memakai `tinyint(1)`.
- Oracle historically tidak punya boolean column SQL tradisional sebelum versi modern tertentu; sering memakai `NUMBER(1)` atau `CHAR(1)`.
- SQL Server punya `bit`.

JPA/Hibernate dialect biasanya menangani mapping, tetapi schema dan migration harus konsisten.

Recommendation:

```java
@Column(name = "active", nullable = false)
private boolean active;
```

Untuk cross-db, pastikan DDL migration eksplisit.

### 9.2 Enum

Portable safest:

```java
@Enumerated(EnumType.STRING)
@Column(name = "status", nullable = false, length = 30)
private CaseStatus status;
```

Namun untuk long-lived enterprise system, lebih baik pertimbangkan stable code:

```java
public enum CaseStatus {
    DRAFT("DRAFT"),
    SUBMITTED("SUBMITTED"),
    UNDER_REVIEW("UNDER_REVIEW"),
    APPROVED("APPROVED"),
    REJECTED("REJECTED");

    private final String code;
}
```

Lalu mapping via converter.

Vendor-specific enum type, misalnya PostgreSQL enum, bisa bagus untuk constraint tetapi migration-nya lebih kompleks.

### 9.3 Numeric Precision

Jangan mapping money ke `double`.

```java
@Column(name = "amount", nullable = false, precision = 19, scale = 4)
private BigDecimal amount;
```

Pastikan precision/scale sesuai DB dan business rule.

---

## 10. Timestamp and Timezone

Timestamp adalah sumber bug lintas database.

### 10.1 Java Type Choice

Rekomendasi umum:

- `Instant` untuk audit timestamp dan event time global.
- `LocalDate` untuk tanggal kalender tanpa jam.
- `LocalDateTime` hanya jika business meaning memang local wall-clock tanpa timezone.
- `OffsetDateTime` jika offset perlu dipertahankan.

### 10.2 Database Differences

PostgreSQL:

- `timestamp without time zone`,
- `timestamp with time zone` (`timestamptz`) menyimpan instant normalized, display sesuai timezone session.

Oracle:

- `DATE`,
- `TIMESTAMP`,
- `TIMESTAMP WITH TIME ZONE`,
- `TIMESTAMP WITH LOCAL TIME ZONE`.

MySQL:

- `DATETIME`,
- `TIMESTAMP` dengan behavior timezone/session tertentu.

SQL Server:

- `datetime`,
- `datetime2`,
- `datetimeoffset`.

### 10.3 Production Rule

Untuk audit/event:

```text
Store instant in UTC.
Use database/JDBC/Hibernate timezone setting consistently.
Convert to user timezone only at presentation boundary.
```

Example:

```java
@Column(name = "created_at", nullable = false, updatable = false)
private Instant createdAt;
```

### 10.4 Timestamp Checklist

- Jangan campur `LocalDateTime` untuk audit global tanpa alasan.
- Pastikan DB session timezone.
- Pastikan JVM timezone.
- Pastikan serialization timezone.
- Test daylight saving jika sistem multi-country.
- Untuk regulatory timestamp, simpan source timestamp dan system received timestamp jika perlu.

---

## 11. JSON Mapping

JSON support sangat vendor-specific.

### 11.1 PostgreSQL

PostgreSQL punya `json` dan `jsonb`. `jsonb` sering dipilih untuk indexing/operator/query.

Use case:

- semi-structured metadata,
- external payload snapshot,
- audit context,
- search/filter tambahan dengan index tertentu.

### 11.2 MySQL

MySQL punya `JSON` type dengan function dan generated column untuk indexing pattern tertentu.

### 11.3 Oracle

Oracle mendukung JSON di atas type tertentu dan versi modern menyediakan capability JSON yang makin kuat. Detail feature sangat versi-dependent.

### 11.4 SQL Server

SQL Server sering menyimpan JSON sebagai text (`nvarchar`) dengan JSON functions, bukan type JSON native seperti PostgreSQL `jsonb`.

### 11.5 Hibernate JSON Mapping

Hibernate modern mendukung mapping JSON dengan annotation provider-specific, misalnya:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(name = "metadata")
private Map<String, Object> metadata;
```

Atau value object:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(name = "review_context")
private ReviewContext reviewContext;
```

### 11.6 JSON Design Rule

JSON baik untuk:

- snapshot payload,
- flexible metadata,
- append-only audit detail,
- low-frequency fields,
- integration envelope.

JSON buruk untuk:

- core relational invariant,
- frequently joined field,
- heavily filtered column tanpa index strategy,
- state machine field utama,
- foreign key relationship.

### 11.7 Hybrid Pattern

```text
Relational columns: fields used for invariant, search, join, authorization, lifecycle.
JSON column: supplementary context/snapshot that may evolve over time.
```

Example:

```sql
case_file(
    id,
    status,
    applicant_id,
    assigned_officer_id,
    submitted_at,
    metadata_json
)
```

`status`, `applicant_id`, `assigned_officer_id` jangan disembunyikan hanya di JSON.

---

## 12. LOB/CLOB/BLOB Differences

LOB behavior berbeda tajam antar database dan driver.

### 12.1 Common Risk

LOB risk:

- memory spike,
- slow fetch,
- serialization overhead,
- unexpected eager load,
- DB storage bloat,
- backup/replication cost,
- table/index bloat,
- audit table explosion.

### 12.2 Mapping

```java
@Lob
@Column(name = "full_text")
private String fullText;
```

```java
@Lob
@Column(name = "file_content")
private byte[] fileContent;
```

`byte[]` untuk file besar di entity sering berbahaya.

### 12.3 External Object Storage Pattern

Untuk file besar:

```text
Database stores metadata:
- document id
- storage key
- checksum
- content type
- size
- encryption metadata
- retention policy
- owner/tenant

Object storage stores bytes.
```

Entity:

```java
@Entity
@Table(name = "document")
public class DocumentEntity {
    @Id
    private Long id;

    @Column(nullable = false, length = 512)
    private String storageKey;

    @Column(nullable = false, length = 64)
    private String sha256;

    @Column(nullable = false)
    private long sizeBytes;
}
```

### 12.4 Audit Trail CLOB

Audit trail sering memakai CLOB untuk before/after JSON atau serialized changes.

Rule:

- Jangan load CLOB untuk listing.
- Buat listing projection tanpa LOB.
- Pisahkan detail endpoint untuk full payload.
- Pertimbangkan compression/encryption.
- Monitor segment/tablespace growth.

---

## 13. Index Features and Query Plan Differences

JPA tidak mendesain index secara otomatis berdasarkan query production.

### 13.1 Common Index Types

Common:

- B-tree,
- unique index,
- composite index,
- function/expression index,
- partial/filtered index,
- full-text index,
- JSON index,
- bitmap index,
- columnstore.

Support berbeda antar database.

### 13.2 Composite Index Order

Query:

```sql
WHERE tenant_id = ?
  AND status = ?
  AND submitted_at >= ?
ORDER BY submitted_at DESC, id DESC
```

Possible index:

```sql
(tenant_id, status, submitted_at DESC, id DESC)
```

Tetapi selectivity, cardinality, DB optimizer, dan workload menentukan pilihan terbaik.

### 13.3 Function-Based / Expression Index

Untuk case-insensitive search:

```sql
WHERE lower(email) = lower(?)
```

Butuh expression/function-based index agar tidak full scan.

Vendor examples:

- PostgreSQL expression index.
- Oracle function-based index.
- SQL Server computed column + index.
- MySQL generated column + index.

### 13.4 Partial/Filtered Index

Untuk soft delete:

```sql
WHERE deleted = false
```

PostgreSQL partial index:

```sql
CREATE INDEX idx_case_active
ON case_file(status, submitted_at)
WHERE deleted = false;
```

SQL Server filtered index punya konsep mirip. MySQL membutuhkan strategi berbeda, misalnya composite index dengan deleted flag atau generated column.

### 13.5 Index Checklist

- Index harus berasal dari query production, bukan field entity.
- Composite index harus mempertimbangkan equality, range, order by.
- Soft delete dan tenant harus masuk index design.
- Projection query perlu covering index jika hot path.
- Jangan buat index terlalu banyak di table write-heavy.
- Validasi dengan execution plan database asli.

---

## 14. Full-Text Search and Case-Insensitive Search

ORM tidak cocok menjadi search engine penuh.

### 14.1 Case-Insensitive Search

Naive:

```jpql
where lower(c.name) like lower(concat('%', :q, '%'))
```

Problem:

- leading wildcard sulit memakai B-tree,
- function pada column bisa mematikan index biasa,
- collation berbeda antar DB,
- result ordering relevance lemah.

### 14.2 Vendor Options

PostgreSQL:

- `ILIKE`,
- trigram extension,
- full-text search.

Oracle:

- Oracle Text.

MySQL:

- FULLTEXT index.

SQL Server:

- Full-Text Search.

### 14.3 External Search

Untuk search kompleks:

- Elasticsearch/OpenSearch/Solr,
- database remains source of truth,
- outbox/CDC updates search index,
- handle eventual consistency.

---

## 15. Oracle Integration Notes

Oracle umum di enterprise/regulatory system. Beberapa karakter penting:

### 15.1 Strengths

- Mature transaction engine.
- Strong read consistency.
- Sequence support sangat baik.
- Partitioning/materialized view/advanced indexing.
- Robust locking and concurrency model.
- Enterprise operational tooling.

### 15.2 JPA/Hibernate Considerations

Recommended often:

```java
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "seq_gen")
@SequenceGenerator(name = "seq_gen", sequenceName = "my_seq", allocationSize = 50)
```

Careful with:

- CLOB/BLOB loading,
- tablespace growth,
- sequence allocation,
- `NUMBER` precision mapping,
- `DATE` vs `TIMESTAMP`,
- `VARCHAR2` length semantics,
- reserved words,
- pagination syntax depending version,
- `FOR UPDATE` behavior,
- long transactions and undo.

### 15.3 Oracle Failure Modes

- `ORA-00001`: unique constraint violation.
- `ORA-00060`: deadlock detected.
- `ORA-00054`: resource busy/nowait timeout pattern.
- Snapshot/undo issues for long-running query.
- LOB segment grows even after delete until maintenance/shrink depending storage.

### 15.4 Oracle Design Advice

- Use sequence pooled for high insert volume.
- Do not store giant files directly in OLTP table unless explicitly justified.
- Monitor tablespace, LOB segment, undo, temp, wait events.
- Use DB-native views/materialized views for heavy reports when necessary.
- Keep JPA query simple; use native SQL for serious reporting.

---

## 16. PostgreSQL Integration Notes

PostgreSQL sangat powerful untuk modern application, dengan JSONB, MVCC, extensions, partial indexes, expression indexes.

### 16.1 Strengths

- Strong MVCC model.
- Rich data types.
- JSONB.
- Partial/expression indexes.
- CTE/window function.
- Advisory locks.
- `SKIP LOCKED`.
- Good developer ergonomics.

### 16.2 JPA/Hibernate Considerations

Identifier:

```java
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "seq_gen")
```

or identity, depending schema.

JSON mapping with Hibernate:

```java
@JdbcTypeCode(SqlTypes.JSON)
@Column(columnDefinition = "jsonb")
private CaseMetadata metadata;
```

Careful with:

- `timestamp with time zone` semantics,
- transaction isolation and serialization failure retry,
- vacuum/autovacuum impact,
- bloat from heavy update/delete,
- long transactions holding old row versions,
- enum type migration,
- advisory lock misuse.

### 16.3 PostgreSQL Failure Modes

- Serialization failure under `SERIALIZABLE`.
- Deadlock detected.
- Unique violation.
- Lock wait timeout if configured.
- Query plan regression after statistics changes.
- Table/index bloat from update-heavy workloads.

### 16.4 PostgreSQL Design Advice

- Use partial index for soft delete/active data.
- Use expression index for normalized search.
- Use JSONB for flexible metadata, not core relational invariant.
- Use `SKIP LOCKED` for worker queue with careful monitoring.
- Keep transactions short to avoid bloat and vacuum issues.

---

## 17. MySQL/InnoDB Integration Notes

MySQL/InnoDB umum di web application dan SaaS. Banyak behavior-nya dipengaruhi isolation, index, dan storage engine detail.

### 17.1 Strengths

- Simple operational adoption.
- Good OLTP performance for common workloads.
- Native JSON type.
- InnoDB MVCC and row-level locking.
- Strong ecosystem.

### 17.2 JPA/Hibernate Considerations

Common identifier:

```java
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

Careful with:

- identity generation and batching,
- default `REPEATABLE READ`,
- gap locks/next-key locks,
- collation/case sensitivity,
- `DATETIME` vs `TIMESTAMP`,
- `tinyint(1)` boolean,
- JSON indexing through generated columns,
- `text`/`longtext` LOB-like behavior,
- online DDL behavior by version/engine.

### 17.3 MySQL Failure Modes

- Deadlock on concurrent updates.
- Lock wait timeout.
- Unexpected gap locks on range query.
- Duplicate key violation.
- Silent truncation risk if SQL mode not strict.
- Charset/collation surprise.

### 17.4 MySQL Design Advice

- Ensure strict SQL mode.
- Index every locking predicate carefully.
- Understand default isolation.
- Avoid long range locks in request path.
- For batch insert, evaluate native multi-row insert or JDBC batch.
- Be explicit with charset/collation.

---

## 18. SQL Server Integration Notes

SQL Server banyak dipakai di enterprise Microsoft ecosystem. Integrasi Java/JPA perlu memahami identity, locking, isolation, schema, dan driver behavior.

### 18.1 Strengths

- Mature enterprise DB.
- Strong tooling.
- Good indexing capabilities.
- Filtered index.
- Computed columns.
- Snapshot isolation options.
- Columnstore for analytics.

### 18.2 JPA/Hibernate Considerations

Common identifier:

```java
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

or sequence if schema chooses.

Careful with:

- `datetime` vs `datetime2` vs `datetimeoffset`,
- `bit` boolean,
- `nvarchar` vs `varchar`,
- lock escalation,
- read committed snapshot setting,
- `TOP`/`OFFSET FETCH` behavior,
- identity insert limitations,
- bracketed reserved identifiers.

### 18.3 SQL Server Failure Modes

- Deadlock victim.
- Lock timeout.
- Unique constraint violation.
- Lock escalation causing larger blocking.
- Parameter sniffing causing query plan instability.

### 18.4 SQL Server Design Advice

- Prefer `datetime2` for precision if suitable.
- Know whether `READ_COMMITTED_SNAPSHOT` is enabled.
- Use filtered index for active/soft-delete datasets.
- Be careful with transaction duration.
- Monitor blocking sessions and deadlock graphs.

---

## 19. Dialect and Migration Between Databases

Changing database is not a find-and-replace.

### 19.1 What May Break

- DDL type mapping.
- Identifier generation.
- Reserved keywords.
- Pagination SQL.
- Lock timeout syntax.
- Isolation behavior.
- Case sensitivity/collation.
- Timestamp storage.
- Boolean mapping.
- Enum mapping.
- JSON operator.
- LOB behavior.
- Index definitions.
- Constraint names/error codes.
- Native queries.
- Stored procedures/functions.
- Trigger behavior.

### 19.2 Migration Strategy

```text
1. Inventory all mappings and native queries.
2. Identify provider-specific annotations.
3. Identify DB-specific DDL/migration scripts.
4. Build compatibility test suite.
5. Run schema migration on target DB.
6. Run repository integration tests on target DB.
7. Run concurrency tests on target DB.
8. Run performance tests with representative data.
9. Compare query plans.
10. Fix dialect-specific problems intentionally.
```

### 19.3 Do Not Trust H2 as Replacement

H2 is useful for simple unit-ish integration tests, but it does not replicate Oracle/PostgreSQL/MySQL/SQL Server behavior for:

- locking,
- isolation,
- optimizer,
- SQL dialect,
- JSON,
- LOB,
- timestamp,
- generated values,
- constraints,
- error codes.

Use Testcontainers or real managed database for persistence correctness tests.

---

## 20. Native SQL Isolation Pattern

Vendor-specific SQL should not leak everywhere.

Bad:

```java
@Service
public class CaseService {
    // native SQL string scattered here
}
```

Better:

```java
public interface OutboxClaimRepository {
    List<ClaimedOutboxEvent> claimNextBatch(int batchSize, String workerId);
}
```

Implementation per database:

```java
@Repository
@Profile("postgres")
public class PostgresOutboxClaimRepository implements OutboxClaimRepository {
    // PostgreSQL-specific SQL here
}
```

```java
@Repository
@Profile("oracle")
public class OracleOutboxClaimRepository implements OutboxClaimRepository {
    // Oracle-specific SQL here
}
```

Benefits:

- vendor-specific logic isolated,
- contract test reusable,
- migration easier,
- production behavior documented.

---

## 21. Exception Classification by Database

Persistence errors often expose vendor codes.

Application should classify into:

```text
Business/User Error:
- duplicate business key
- FK violation because referenced item absent
- check constraint violation
- invalid state transition detected by conditional update

Concurrency/Retryable:
- deadlock
- serialization failure
- lock timeout
- transient connection problem

System/Developer Error:
- SQL grammar
- missing table/column
- data truncation due to mapping bug
- wrong dialect

Operational Error:
- DB unavailable
- connection pool exhausted
- tablespace full
- transaction log full
- too many connections
```

Spring exception translation helps, but for robust classification you often need:

- SQLState,
- vendor error code,
- constraint name,
- operation context.

Example domain mapping:

```java
try {
    repository.save(entity);
    entityManager.flush();
} catch (DataIntegrityViolationException ex) {
    if (isUniqueConstraint(ex, "uk_case_reference")) {
        throw new DuplicateCaseReferenceException(reference, ex);
    }
    throw ex;
}
```

Flush intentionally can surface constraint violation at controlled boundary.

---

## 22. Observability: What to Capture Per Database

Application metrics:

- query count per request,
- slow query fingerprint,
- transaction duration,
- connection acquisition time,
- pool active/idle/pending,
- lock wait count,
- deadlock count,
- optimistic lock failure count,
- batch size actual,
- flush count,
- entity load count,
- cache hit/miss.

Database metrics:

- CPU,
- I/O,
- buffer cache hit,
- active sessions,
- wait events,
- lock waits,
- deadlocks,
- long transactions,
- temp usage,
- undo/WAL/transaction log,
- table/index bloat,
- tablespace/datafile usage,
- slow query log,
- query plan changes.

Log context:

```text
correlation_id
request_id
tenant_id
user_id/use-case actor
use_case
transaction_boundary
repository_method
sql_fingerprint
entity_name
lock_mode
pagination_mode
batch_id
```

---

## 23. Database-Specific Decision Matrix

| Concern | Oracle | PostgreSQL | MySQL/InnoDB | SQL Server |
|---|---|---|---|---|
| Common ID strategy | Sequence | Sequence/Identity | Identity/Auto-increment | Identity/Sequence |
| ORM batch insert friendliness | High with sequence pooling | High with sequence pooling | More limited with identity | Depends identity/sequence |
| MVCC/read consistency | Strong read consistency | MVCC, SSI serializable | MVCC with InnoDB specifics | Locking or row-versioning depending config |
| Queue claiming | `FOR UPDATE SKIP LOCKED` | `FOR UPDATE SKIP LOCKED` | `SKIP LOCKED` in modern versions, test carefully | Often hints/readpast patterns |
| JSON | Version-dependent strong support | JSONB strong | JSON type | JSON functions over text |
| Soft-delete index | Function/normal index strategies | Partial index excellent | Composite/generated strategies | Filtered index |
| Timestamp nuance | Many timestamp types | `timestamp`/`timestamptz` nuance | `datetime`/`timestamp` nuance | `datetime2`/`datetimeoffset` |
| Lock surprise | undo/long transaction | serialization retry/bloat | gap/next-key locks | lock escalation/parameter sniffing |
| Enterprise reporting | Materialized views/partitioning strong | Materialized view/CTE/window strong | Depends version/workload | Columnstore/indexing strong |

---

## 24. Case Management Example: Cross-Database-Aware Design

Scenario:

- application submission,
- case review,
- officer assignment,
- appeal,
- audit trail,
- outbox event,
- document metadata,
- dashboard listing.

### 24.1 Entity Core

```java
@Entity
@Table(
    name = "case_file",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_case_file_reference", columnNames = "case_reference")
    }
)
public class CaseFileEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_file_seq_gen")
    @SequenceGenerator(
        name = "case_file_seq_gen",
        sequenceName = "case_file_seq",
        allocationSize = 50
    )
    private Long id;

    @Column(name = "public_id", nullable = false, unique = true, updatable = false)
    private UUID publicId;

    @Column(name = "case_reference", nullable = false, length = 40, updatable = false)
    private String caseReference;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "status", nullable = false, length = 30)
    private String status;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "assigned_officer_id")
    private Long assignedOfficerId;
}
```

This is mostly portable, except sequence usage must be validated for DB support. For MySQL identity-based schema, this entity would need generation strategy adjustment.

### 24.2 Assignment Queue Query

Portable JPQL may not be enough for efficient concurrent claim. Use database-specific adapter.

Contract:

```java
public interface AssignmentClaimRepository {
    List<Long> claimNextCases(String officerId, int limit);
}
```

PostgreSQL/Oracle style:

```sql
SELECT id
FROM case_file
WHERE status = 'SUBMITTED'
ORDER BY submitted_at ASC, id ASC
FOR UPDATE SKIP LOCKED
FETCH FIRST ? ROWS ONLY;
```

MySQL/SQL Server syntax may differ. Keep it isolated.

### 24.3 Audit Listing

Do not load CLOB/JSON full audit payload for listing.

Projection:

```java
public record AuditTrailListItem(
    Long id,
    String module,
    String action,
    String actor,
    Instant createdAt
) {}
```

Detail endpoint loads full payload only by ID.

### 24.4 Dashboard Query

Dashboard/report query should likely be native SQL/view/materialized view depending DB.

Do not force complex dashboard into entity graph.

---

## 25. Anti-Patterns

### 25.1 “We Use JPA, So Database Does Not Matter”

False. Database matters in every non-trivial system.

### 25.2 Using `GenerationType.AUTO` Everywhere

Can silently change behavior across providers/databases.

### 25.3 Testing Oracle/PostgreSQL Behavior on H2 Only

H2 cannot represent locking/isolation/optimizer/vendor types accurately.

### 25.4 Native SQL Everywhere Without Boundary

Native SQL is fine. Scattered native SQL is not.

### 25.5 JSON as Dumping Ground

JSON should not hide relational invariants.

### 25.6 CLOB in Listing Query

LOB should not be part of hot listing/read path unless intentionally required.

### 25.7 Assuming `READ_COMMITTED` Means Same Everywhere

Isolation names are not enough. Know engine behavior.

### 25.8 Ignoring Collation/Case Sensitivity

Search and uniqueness can behave differently across DBs.

### 25.9 Assuming Offset Pagination Scales

Deep offset is usually performance debt.

### 25.10 Treating Deadlock as Rare Impossible Bug

Deadlock is normal under concurrency. Classify, observe, retry safely when appropriate.

---

## 26. Production Failure Modes

### 26.1 Works in Dev, Fails in UAT

Possible causes:

- Dev uses H2, UAT uses Oracle/PostgreSQL.
- Different dialect.
- Different isolation level.
- Different collation.
- Different timezone.
- Different schema migration.
- Different index.

### 26.2 Batch Insert Slow Only on MySQL

Possible causes:

- identity generation prevents efficient ORM batching,
- auto-increment contention,
- missing JDBC rewrite batch setting,
- transaction chunk too large,
- index overhead.

### 26.3 Queue Workers Duplicate Work

Possible causes:

- no row lock,
- lock not inside transaction,
- wrong isolation assumption,
- `SKIP LOCKED` query not atomic with status update,
- idempotency missing.

### 26.4 Soft Deleted Row Blocks Re-Creation

Possible causes:

- unique constraint includes deleted row,
- DB lacks partial unique index strategy,
- application assumes soft delete means gone.

### 26.5 Audit Listing Slow

Possible causes:

- CLOB/JSON loaded for every row,
- no projection,
- missing index on timestamp/module/actor,
- count query expensive,
- sort spills to temp.

### 26.6 Time Display Wrong

Possible causes:

- `LocalDateTime` used for global instant,
- DB session timezone differs,
- JVM timezone differs,
- column type semantics misunderstood,
- serialization converts unexpectedly.

---

## 27. Review Checklist

### 27.1 General

- [ ] Target database and version are documented.
- [ ] Hibernate dialect is explicit/verified.
- [ ] Native SQL is isolated behind repository/query adapter.
- [ ] Integration tests run against actual database.
- [ ] H2 is not treated as production-equivalent.

### 27.2 Identifier

- [ ] ID strategy is explicit, not accidental `AUTO`.
- [ ] Sequence allocation size matches database sequence increment/caching strategy.
- [ ] Business reference is separate from primary key.
- [ ] UUID/public ID strategy is documented.

### 27.3 Transaction/Locking

- [ ] Isolation level is known.
- [ ] Locking SQL generated by Hibernate is inspected.
- [ ] Lock timeout is configured for request path.
- [ ] Deadlock/serialization failure retry policy exists.
- [ ] External API calls are outside long DB locks.

### 27.4 Query/Pagination

- [ ] Hot queries have execution plan review.
- [ ] Pagination has deterministic order.
- [ ] Deep pagination uses keyset where appropriate.
- [ ] Count query cost is measured.
- [ ] Index follows filter/order pattern.

### 27.5 Types

- [ ] Timestamp type and timezone policy are explicit.
- [ ] Boolean/enum mapping is stable.
- [ ] Money uses `BigDecimal` with precision/scale.
- [ ] JSON fields do not hide core invariants.
- [ ] LOB fields are not loaded in listing paths.

### 27.6 Operations

- [ ] Slow query monitoring is enabled.
- [ ] Lock/deadlock metrics are monitored.
- [ ] Connection pool metrics are monitored.
- [ ] DB storage/log/tablespace growth is monitored.
- [ ] Migration scripts are database-specific and reviewed.

---

## 28. Exercises

### Exercise 1 — Identifier Strategy Review

Given an entity using:

```java
@GeneratedValue(strategy = GenerationType.AUTO)
private Long id;
```

Analyze behavior if deployed to:

- Oracle,
- PostgreSQL,
- MySQL,
- SQL Server.

Decide whether to replace with `SEQUENCE`, `IDENTITY`, UUID, or separate public ID.

### Exercise 2 — Queue Claiming

Design `claimNextOutboxEvents(limit)` for Oracle and PostgreSQL using row locking.

Requirements:

- multiple workers,
- no duplicate claim,
- avoid blocking forever,
- preserve approximate FIFO,
- safe retry,
- observable lock failures.

### Exercise 3 — Soft Delete Unique Constraint

A user can create a license with unique `(tenant_id, license_no)`. Deleted license should not block re-creation.

Design for:

- PostgreSQL,
- SQL Server,
- MySQL,
- Oracle.

Compare partial/filtered index vs composite key with delete marker.

### Exercise 4 — Audit Trail LOB Query

An audit table has:

- id,
- module,
- action,
- actor,
- created_at,
- metadata CLOB,
- serialized_changes CLOB.

Design:

- listing query,
- detail query,
- indexes,
- retention strategy,
- archive strategy.

### Exercise 5 — Timezone Bug

A submitted application shows different submission time in API response and DB query.

Investigate:

- Java type,
- DB column type,
- JDBC timezone,
- JVM timezone,
- DB session timezone,
- serialization format,
- frontend timezone rendering.

---

## 29. Summary

Database-specific behavior is not an implementation detail that senior engineers can ignore. JPA and Hibernate are powerful precisely because they cover common persistence patterns, but the most important production decisions still depend on the database engine.

Key conclusions:

1. JPA standardizes ORM API, not every database semantic.
2. Hibernate dialect translates SQL, but database engine still controls locking, isolation, optimizer, storage, and type behavior.
3. Identifier generation affects batching and throughput.
4. Pagination syntax is abstracted, but pagination performance is not.
5. Locking and isolation must be tested on the actual database.
6. JSON, LOB, timestamp, enum, boolean, and index features differ significantly.
7. Native SQL is acceptable when isolated, tested, and documented.
8. H2 is not enough for production persistence correctness.
9. Database-specific design is not a failure of abstraction; it is part of responsible engineering.

The deeper principle:

> Portable code is good. Portable assumptions are dangerous.

---

## 30. What Comes Next

Next part:

```text
Part 029 — Error Handling, Exception Translation, and Failure Classification
```

We will go deeper into how persistence failures are classified and handled:

- JPA exceptions,
- Hibernate exceptions,
- Spring `DataAccessException`,
- SQLState,
- vendor error codes,
- constraint name parsing,
- retryable vs non-retryable errors,
- rollback-only state,
- commit/flush timing,
- API error mapping,
- production observability.

