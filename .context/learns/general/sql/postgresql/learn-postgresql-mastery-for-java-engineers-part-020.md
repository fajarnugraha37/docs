# learn-postgresql-mastery-for-java-engineers-part-020.md

# Part 020 — Write Path Performance: INSERT, UPDATE, DELETE, UPSERT, Batch, dan COPY

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / backend engineer / tech lead  
> Fokus: memahami performa jalur tulis PostgreSQL dari sisi engine, transaksi, WAL, index, constraint, JDBC, batching, ingestion, dan failure modelling produksi.

---

## 0. Posisi Part Ini dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

- storage model PostgreSQL: heap page, tuple, relation fork, TOAST;
- MVCC: tuple versioning, `xmin`, `xmax`, snapshot, dead tuple;
- WAL dan crash recovery;
- memory model;
- query lifecycle;
- planner statistics;
- `EXPLAIN`;
- index internals;
- locking;
- constraints;
- JSONB;
- partitioning;
- vacuum/autovacuum/bloat.

Sekarang kita masuk ke pertanyaan yang sangat praktis:

```text
Bagaimana data benar-benar ditulis ke PostgreSQL?

Kenapa INSERT bisa lambat?
Kenapa UPDATE lebih mahal dari yang terlihat?
Kenapa DELETE tidak langsung mengurangi ukuran tabel?
Kenapa UPSERT bisa deadlock?
Kenapa batch JDBC kadang cepat, kadang tidak?
Kapan harus memakai COPY?
Kapan staging table lebih aman daripada langsung tulis ke tabel utama?
Bagaimana mendesain ingestion yang idempotent?
```

Bagian ini bukan sekadar daftar tips performa. Kita akan membangun mental model bahwa **write performance adalah hasil interaksi antara heap, index, WAL, constraint, lock, vacuum, pool, batch size, dan transaction boundary**.

---

## 1. Mental Model Utama: Write Path Itu Bukan Satu Operasi

Saat aplikasi Java menjalankan:

```sql
INSERT INTO payment(id, amount, status) VALUES (?, ?, ?);
```

Secara konseptual terlihat seperti satu operasi. Tetapi PostgreSQL perlu melakukan banyak pekerjaan:

1. menerima query/protocol message dari client;
2. parse/analyze/plan atau memakai prepared plan;
3. memulai atau memakai transaksi aktif;
4. mengecek permission;
5. mengevaluasi default/generated column;
6. mengevaluasi check constraint;
7. mengecek foreign key;
8. mengecek unique constraint;
9. menulis tuple ke heap page;
10. menulis entry ke setiap index yang relevan;
11. menghasilkan WAL record;
12. mengelola lock;
13. mengelola visibility metadata;
14. menjalankan trigger jika ada;
15. mengirim hasil/ack ke client;
16. saat commit, memastikan durability sesuai konfigurasi;
17. setelah transaksi selesai, tuple lama/dead tuple kelak dibersihkan vacuum.

Jadi performa tulis tidak bisa dianalisis hanya dari “query insert-nya sederhana”. Pertanyaan yang benar adalah:

```text
Berapa banyak struktur fisik yang harus berubah untuk satu logical write?
```

Satu row logical bisa memicu:

- satu heap write;
- beberapa index writes;
- beberapa constraint checks;
- beberapa trigger executions;
- beberapa WAL records;
- lock acquisition;
- later vacuum work;
- replication work;
- CDC/logical decoding work;
- application-side retry work.

### Prinsip penting

```text
Write latency hari ini sering menjadi read/vacuum/replication cost besok.
```

Contoh:

- `UPDATE` yang sering membuat dead tuple.
- Index berlebihan mempercepat read tertentu tetapi memperlambat semua write.
- `DELETE` massal membuat vacuum debt.
- UPSERT dengan update no-op tetap bisa menghasilkan bloat bila tidak didesain hati-hati.
- Transaction terlalu besar bisa memperbesar WAL burst, replication lag, lock hold time, dan recovery time.

---

## 2. Taxonomy Write Operation PostgreSQL

Kita pisahkan write menjadi beberapa kategori karena masing-masing memiliki cost model berbeda.

| Operasi | Bentuk umum | Cost dominan |
|---|---|---|
| INSERT single row | request OLTP biasa | network round-trip, WAL, index insert, constraint |
| INSERT batch | banyak row dalam satu round-trip/transaction | WAL throughput, index maintenance, lock duration |
| COPY | bulk ingestion | disk/WAL throughput, constraint/index cost |
| UPDATE narrow | ubah sedikit kolom | heap tuple version, index update bila indexed column berubah |
| UPDATE wide | ubah row besar/TOAST | heap + TOAST + WAL besar |
| HOT UPDATE | update tanpa mengubah indexed columns dan muat di page | relatif murah |
| DELETE | mark tuple dead | heap marker, index remains, vacuum debt |
| UPSERT | insert atau update akibat conflict | unique index lookup, row lock, potential deadlock |
| MERGE | conditional insert/update/delete | plan + join + row-level effects |
| Staging load | load ke tabel sementara/staging lalu merge | lebih terkontrol untuk bulk/validation |

Engineer yang kuat tidak bertanya “mana yang paling cepat?” secara umum. Ia bertanya:

```text
Apa bentuk workload-nya?
Berapa row per detik?
Berapa index?
Berapa constraint?
Apakah idempotent?
Apakah perlu strict uniqueness?
Apakah butuh trigger?
Apakah data perlu langsung queryable?
Apakah boleh eventual?
Apakah ada replication?
Apakah ada audit/outbox?
```

---

## 3. INSERT Path: Apa yang Terjadi Saat Menambah Row

### 3.1 Heap insertion

Untuk `INSERT`, PostgreSQL mencari page heap yang punya cukup ruang, lalu menaruh tuple baru. Jika tidak ada ruang cukup, relation bertambah page baru.

Tuple baru berisi metadata MVCC, termasuk transaction id pembuat tuple (`xmin`). Tuple ini visible untuk transaksi lain setelah commit, sesuai snapshot visibility rules.

Secara mental:

```text
INSERT = append-ish heap tuple + index entries + WAL + constraint work
```

PostgreSQL heap table bukan LSM tree dan bukan clustered table by primary key. Insert tidak otomatis menaruh row berdekatan secara logical key kecuali kebetulan insertion order mengikuti key.

Implikasi:

- UUID random dapat membuat B-tree primary key lebih banyak page split daripada key yang lebih locality-friendly.
- Insert time-series dengan timestamp meningkat cenderung lebih locality-friendly untuk index timestamp.
- Heap locality bergantung urutan insert, bukan primary key clustering permanen.

### 3.2 Index insertion

Setiap index pada tabel perlu diperbarui saat row baru masuk.

Jika tabel punya 8 index, satu insert bukan satu write. Itu kira-kira:

```text
1 heap insert + 8 index inserts + WAL untuk perubahan tersebut
```

Maka index adalah trade-off:

```text
Index mempercepat read tertentu, tetapi memperlambat semua write yang harus mempertahankan index itu.
```

### 3.3 Constraint check

Constraint bukan gratis:

- `NOT NULL` murah;
- `CHECK` biasanya murah kecuali ekspresinya kompleks;
- `UNIQUE` membutuhkan unique index lookup;
- `FOREIGN KEY` membutuhkan lookup ke referenced table dan lock semantics;
- exclusion constraint dapat lebih mahal;
- trigger-based validation bisa sangat mahal.

Tetapi jangan salah menyimpulkan “constraint harus dikurangi”. Constraint sering merupakan mekanisme correctness paling murah dibanding memperbaiki data rusak di produksi.

Prinsipnya:

```text
Hilangkan constraint hanya bila invariant memang tidak diperlukan, bukan karena ingin write cepat.
```

### 3.4 WAL generation

Setiap perubahan durable menghasilkan WAL. WAL adalah alasan PostgreSQL bisa recover setelah crash.

Untuk write-heavy workload, bottleneck sering bukan CPU query, tetapi:

- WAL generation rate;
- WAL flush latency;
- disk bandwidth;
- checkpoint behavior;
- replication apply lag;
- archiving backlog.

---

## 4. INSERT Single Row dari Java: Kenapa Bisa Mahal

Contoh sederhana:

```java
try (PreparedStatement ps = connection.prepareStatement("""
    INSERT INTO case_note(case_id, author_id, body, created_at)
    VALUES (?, ?, ?, now())
""")) {
    ps.setObject(1, caseId);
    ps.setObject(2, authorId);
    ps.setString(3, body);
    ps.executeUpdate();
}
```

Ini normal untuk OLTP. Tetapi jika dilakukan ribuan kali dalam loop dengan autocommit aktif, masalah muncul.

### 4.1 Autocommit loop problem

Kode buruk:

```java
for (CaseNote note : notes) {
    jdbcTemplate.update("""
        INSERT INTO case_note(case_id, author_id, body, created_at)
        VALUES (?, ?, ?, now())
    """, note.caseId(), note.authorId(), note.body());
}
```

Jika setiap statement autocommit:

```text
N rows = N network round-trips + N transactions + N commits + N WAL flush decisions
```

Untuk 10.000 row, ini bisa berarti 10.000 transaksi kecil.

Lebih baik:

```text
N rows = 1 transaction + batched execution
```

### 4.2 Network round-trip cost

Dalam aplikasi Java, latency sering bukan hanya PostgreSQL execution time. Ada:

- client-to-server network latency;
- JDBC driver protocol overhead;
- connection pool wait;
- server scheduling;
- commit response;
- application serialization.

Maka batch bukan hanya mengurangi database work, tetapi juga mengurangi round-trip.

---

## 5. JDBC Batch Insert

### 5.1 Basic JDBC batch

```java
String sql = """
    INSERT INTO case_event(case_id, event_type, payload, occurred_at)
    VALUES (?, ?, ?::jsonb, ?)
""";

try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement(sql)) {

    con.setAutoCommit(false);

    int count = 0;
    for (CaseEvent event : events) {
        ps.setObject(1, event.caseId());
        ps.setString(2, event.type());
        ps.setString(3, event.payloadJson());
        ps.setObject(4, event.occurredAt());
        ps.addBatch();

        count++;
        if (count % 1000 == 0) {
            ps.executeBatch();
        }
    }

    ps.executeBatch();
    con.commit();
}
```

Mental model:

```text
Batch mengurangi round-trip dan transaction overhead.
Batch tidak menghapus heap/index/WAL cost.
```

### 5.2 Batch size bukan semakin besar semakin baik

Batch terlalu kecil:

- overhead round-trip masih tinggi;
- commit terlalu sering;
- throughput rendah.

Batch terlalu besar:

- transaksi terlalu lama;
- lock ditahan lebih lama;
- rollback mahal;
- memory client/server meningkat;
- WAL burst besar;
- replication lag meningkat;
- error handling lebih sulit;
- autovacuum dan checkpoint bisa terdampak.

Praktik awal yang masuk akal:

```text
Mulai dari 500–5000 row per batch untuk OLTP ingestion,
lalu ukur berdasarkan row size, index count, latency, WAL rate, dan failure recovery.
```

Tidak ada angka sakral. Untuk row kecil tanpa banyak index, batch 10.000 mungkin aman. Untuk row besar JSONB dengan beberapa index GIN, batch 1.000 bisa terlalu besar.

### 5.3 `reWriteBatchedInserts` pada pgJDBC

Driver PostgreSQL JDBC punya parameter populer:

```text
reWriteBatchedInserts=true
```

Tujuannya membuat batch insert tertentu dikirim lebih efisien, misalnya diubah menjadi multi-values insert.

Contoh URL:

```text
jdbc:postgresql://db.example.com:5432/app?reWriteBatchedInserts=true
```

Tetapi jangan menganggap ini magic universal:

- berlaku untuk bentuk statement tertentu;
- behavior bisa berbeda jika ada `RETURNING`;
- tetap perlu mengukur;
- tidak mengurangi index/WAL/constraint cost;
- bisa mengubah bentuk SQL yang terlihat di monitoring.

Prinsip:

```text
Driver optimization mengurangi protocol overhead, bukan menghapus database write cost.
```

---

## 6. Multi-row INSERT

Selain JDBC batch, kita bisa memakai multi-row insert:

```sql
INSERT INTO case_tag(case_id, tag)
VALUES
  ($1, $2),
  ($3, $4),
  ($5, $6);
```

Keunggulan:

- satu statement;
- satu plan;
- satu round-trip;
- cocok untuk batch kecil-menengah.

Kelemahan:

- SQL menjadi panjang;
- parameter count bisa besar;
- error satu row bisa menggagalkan statement;
- tidak ideal untuk ingestion sangat besar;
- sulit jika row shape kompleks.

Untuk Java, biasanya lebih nyaman memakai `PreparedStatement.addBatch()` atau library batch helper daripada membangun SQL string besar manual.

---

## 7. COPY: Jalur Bulk Ingestion yang Berbeda

`COPY` adalah mekanisme PostgreSQL untuk memindahkan data antara table dan file/stdin/stdout. Untuk bulk ingestion, `COPY FROM` sering jauh lebih efisien daripada banyak `INSERT` karena protocol dan parsing overhead lebih rendah.

Contoh SQL:

```sql
COPY staging_case_event(case_id, event_type, payload, occurred_at)
FROM STDIN WITH (FORMAT csv, HEADER true);
```

Dari Java, pgJDBC menyediakan `CopyManager`.

Contoh konseptual:

```java
PGConnection pgConnection = connection.unwrap(PGConnection.class);
CopyManager copyManager = pgConnection.getCopyAPI();

try (Reader reader = Files.newBufferedReader(path)) {
    long rows = copyManager.copyIn("""
        COPY staging_case_event(case_id, event_type, payload, occurred_at)
        FROM STDIN WITH (FORMAT csv, HEADER true)
    """, reader);
}
```

### 7.1 Kapan COPY cocok

Gunakan `COPY` ketika:

- data banyak;
- ingestion throughput penting;
- format input bisa dibuat stabil;
- error handling bisa dilakukan per file/batch;
- proses validasi bisa dipisahkan;
- data boleh masuk staging terlebih dahulu;
- workload bukan request-response OLTP kecil.

### 7.2 Kapan COPY tidak ideal

Hati-hati bila:

- setiap row butuh business validation kompleks di aplikasi;
- setiap row perlu response individual langsung;
- ada banyak trigger berat;
- butuh upsert kompleks langsung ke tabel utama;
- error per row harus dikembalikan secara real-time;
- ingestion kecil dan sporadis.

### 7.3 COPY langsung ke main table vs staging table

Untuk sistem produksi serius, sering lebih aman:

```text
COPY -> staging table -> validate -> merge/upsert into main table
```

Daripada:

```text
COPY -> main table
```

Karena staging memungkinkan:

- validasi format;
- deduplikasi;
- enrichment;
- error isolation;
- batch audit;
- retry idempotent;
- partial rejection;
- controlled merge;
- minimisasi lock pada tabel utama.

---

## 8. Staging Table Pattern

Misalnya kita menerima file event regulasi dari sistem eksternal.

### 8.1 Tabel staging

```sql
CREATE TABLE staging_case_event_import (
    import_id uuid NOT NULL,
    source_line_no bigint NOT NULL,
    external_event_id text,
    case_external_id text,
    event_type text,
    payload jsonb,
    occurred_at timestamptz,
    raw_record jsonb,
    validation_error text,
    loaded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (import_id, source_line_no)
);
```

### 8.2 Load via COPY

```sql
COPY staging_case_event_import(
    import_id,
    source_line_no,
    external_event_id,
    case_external_id,
    event_type,
    payload,
    occurred_at,
    raw_record
)
FROM STDIN WITH (FORMAT csv, HEADER true);
```

### 8.3 Validasi dalam batch

```sql
UPDATE staging_case_event_import s
SET validation_error = 'missing case_external_id'
WHERE import_id = $1
  AND case_external_id IS NULL;
```

```sql
UPDATE staging_case_event_import s
SET validation_error = 'case not found'
WHERE import_id = $1
  AND validation_error IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM regulatory_case c
      WHERE c.external_id = s.case_external_id
  );
```

### 8.4 Merge ke tabel utama

```sql
INSERT INTO case_event(
    external_event_id,
    case_id,
    event_type,
    payload,
    occurred_at
)
SELECT
    s.external_event_id,
    c.id,
    s.event_type,
    s.payload,
    s.occurred_at
FROM staging_case_event_import s
JOIN regulatory_case c
  ON c.external_id = s.case_external_id
WHERE s.import_id = $1
  AND s.validation_error IS NULL
ON CONFLICT (external_event_id) DO NOTHING;
```

Ini memberi idempotency: file yang sama bisa diproses ulang tanpa menggandakan event.

---

## 9. UPDATE Path: Kenapa UPDATE Mahal di PostgreSQL

Di banyak database, orang membayangkan update sebagai overwrite in-place. Di PostgreSQL, karena MVCC:

```text
UPDATE = membuat tuple version baru + menandai tuple lama tidak lagi current
```

Secara konseptual:

```text
old tuple -> dead/obsolete after transaction visibility
new tuple -> inserted as new version
```

Akibatnya:

- table dapat membesar;
- index mungkin harus diperbarui;
- old tuple perlu dibersihkan vacuum;
- index bloat bisa muncul;
- update-heavy workload perlu desain khusus.

### 9.1 Update indexed column vs non-indexed column

Jika update mengubah kolom yang masuk index, PostgreSQL perlu membuat index entry baru.

Contoh:

```sql
UPDATE regulatory_case
SET status = 'ESCALATED'
WHERE id = $1;
```

Jika `status` ada di beberapa index, update lebih mahal.

Jika update hanya mengubah kolom non-indexed dan tuple baru bisa ditaruh di page yang sama, PostgreSQL mungkin bisa melakukan HOT update.

### 9.2 HOT update

HOT = Heap-Only Tuple.

Sederhananya, PostgreSQL dapat menghindari update index jika:

- kolom yang berubah tidak digunakan oleh index mana pun;
- page heap masih punya ruang untuk tuple version baru.

Maka update lebih murah karena index tidak perlu disentuh.

Implikasi desain:

```text
Jangan index kolom yang sering berubah kecuali benar-benar dibutuhkan.
```

Contoh kolom yang sering berubah:

- `updated_at`;
- `last_seen_at`;
- `retry_count`;
- `processing_attempts`;
- `heartbeat_at`;
- `status` pada queue yang sangat aktif;
- `lock_owner`;
- `last_accessed_at`.

Jika kolom seperti itu diindex sembarangan, HOT update bisa hilang dan write amplification naik.

### 9.3 Fillfactor untuk update-heavy table

Default fillfactor membuat page cukup penuh. Untuk update-heavy table, menyisakan ruang di page bisa membantu HOT update.

Contoh:

```sql
ALTER TABLE task_queue SET (fillfactor = 80);
```

Tetapi ini bukan magic:

- membuat table lebih besar;
- hanya membantu update yang memenuhi syarat HOT;
- perlu recreate/rewrite atau future inserts untuk efek penuh;
- harus diukur.

### 9.4 No-op update tetap berbahaya

Kode seperti ini tampak aman:

```sql
UPDATE account
SET name = $2,
    updated_at = now()
WHERE id = $1;
```

Jika `name` sama dengan nilai lama, tetap update. Apalagi `updated_at` selalu berubah.

Untuk workload besar, no-op update bisa menciptakan bloat.

Lebih baik untuk beberapa kasus:

```sql
UPDATE account
SET name = $2,
    updated_at = now()
WHERE id = $1
  AND name IS DISTINCT FROM $2;
```

`IS DISTINCT FROM` aman terhadap `NULL`.

Namun hati-hati: jika aplikasi memang butuh `updated_at` berubah untuk setiap touch, maka ini bukan no-op secara domain. Yang penting adalah sadar cost-nya.

---

## 10. DELETE Path: DELETE Tidak Sama dengan Menghapus File

Dalam MVCC PostgreSQL:

```text
DELETE = menandai tuple sebagai deleted untuk transaksi tertentu
```

Data fisik tidak langsung hilang dari file table. Tuple menjadi dead setelah tidak visible oleh transaksi mana pun, lalu vacuum bisa membersihkannya.

### 10.1 Dampak delete massal

```sql
DELETE FROM case_event
WHERE occurred_at < now() - interval '3 years';
```

Jika tabel besar, ini bisa:

- menghasilkan banyak WAL;
- membuat banyak dead tuple;
- memicu vacuum berat;
- membuat replication lag;
- menahan row/table locks lama;
- mengganggu query lain;
- tidak langsung mengurangi ukuran file table.

### 10.2 Delete in chunks

Lebih aman:

```sql
WITH victim AS (
    SELECT id
    FROM case_event
    WHERE occurred_at < now() - interval '3 years'
    ORDER BY id
    LIMIT 5000
)
DELETE FROM case_event e
USING victim v
WHERE e.id = v.id;
```

Ulangi batch sampai habis.

Keuntungan:

- transaksi lebih pendek;
- WAL burst lebih terkendali;
- lock duration lebih pendek;
- replication lag lebih terkendali;
- rollback lebih murah.

### 10.3 Partition detach/drop untuk retention

Untuk event/audit/time-series besar, partitioning sering lebih baik.

```sql
ALTER TABLE case_event DETACH PARTITION case_event_2023_01;
DROP TABLE case_event_2023_01;
```

Dropping/detaching partition jauh lebih murah daripada delete jutaan row, selama desain partition sudah benar.

Prinsip:

```text
Untuk retention berbasis waktu dalam volume besar,
partition lifecycle sering lebih baik daripada DELETE massal.
```

---

## 11. UPSERT: `INSERT ... ON CONFLICT`

UPSERT adalah pola penting untuk idempotency dan ingestion.

Contoh:

```sql
INSERT INTO external_case_mapping(source_system, external_id, case_id)
VALUES ($1, $2, $3)
ON CONFLICT (source_system, external_id)
DO UPDATE SET
    case_id = EXCLUDED.case_id,
    updated_at = now();
```

### 11.1 Mental model UPSERT

```text
UPSERT = coba insert -> jika unique conflict -> lock conflicting row -> update atau do nothing
```

Artinya UPSERT bukan operasi tanpa lock. Konflik pada unique index bisa menyebabkan contention.

### 11.2 `DO NOTHING` untuk idempotency

Untuk event immutable:

```sql
INSERT INTO case_event(external_event_id, case_id, event_type, payload, occurred_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (external_event_id) DO NOTHING;
```

Ini cocok jika event dengan external id yang sama harus diabaikan saat replay.

### 11.3 `DO UPDATE` untuk sinkronisasi state

```sql
INSERT INTO external_party(source_system, external_party_id, name, risk_level)
VALUES ($1, $2, $3, $4)
ON CONFLICT (source_system, external_party_id)
DO UPDATE SET
    name = EXCLUDED.name,
    risk_level = EXCLUDED.risk_level,
    updated_at = now();
```

Tetapi ini bisa melakukan update walau data sama. Untuk mengurangi no-op update:

```sql
INSERT INTO external_party(source_system, external_party_id, name, risk_level)
VALUES ($1, $2, $3, $4)
ON CONFLICT (source_system, external_party_id)
DO UPDATE SET
    name = EXCLUDED.name,
    risk_level = EXCLUDED.risk_level,
    updated_at = now()
WHERE external_party.name IS DISTINCT FROM EXCLUDED.name
   OR external_party.risk_level IS DISTINCT FROM EXCLUDED.risk_level;
```

### 11.4 UPSERT dan deadlock

UPSERT bisa deadlock jika dua transaksi memproses key yang sama/berbeda dalam urutan berbeda.

Contoh:

```text
T1 upsert key A, lalu key B
T2 upsert key B, lalu key A
```

Masing-masing bisa memegang lock yang dibutuhkan pihak lain.

Mitigasi:

- urutkan input by conflict key sebelum batch;
- batch lebih kecil;
- retry pada deadlock/serialization failure;
- hindari transaksi terlalu besar;
- pisahkan hot keys;
- gunakan queue partitioning/sharding by key.

### 11.5 UPSERT bukan pengganti domain modelling

Jangan memakai UPSERT sebagai “pokoknya aman” tanpa invariant jelas.

Pertanyaan yang harus dijawab:

```text
Jika row sudah ada, apakah kita benar-benar ingin update?
Jika payload berbeda untuk external id yang sama, apakah itu koreksi, duplikasi, atau data corruption?
Apakah update boleh menurunkan versi data?
Apakah event immutable?
Apakah perlu audit sebelum/after?
```

Untuk sistem regulasi/enforcement, konflik external id dengan payload berbeda sering harus masuk exception workflow, bukan diam-diam overwrite.

---

## 12. MERGE

PostgreSQL mendukung `MERGE` untuk conditional insert/update/delete berdasarkan join antara source dan target.

Contoh konseptual:

```sql
MERGE INTO party_risk target
USING staging_party_risk source
ON target.party_id = source.party_id
WHEN MATCHED AND target.risk_level IS DISTINCT FROM source.risk_level THEN
    UPDATE SET
        risk_level = source.risk_level,
        updated_at = now()
WHEN NOT MATCHED THEN
    INSERT (party_id, risk_level, updated_at)
    VALUES (source.party_id, source.risk_level, now());
```

`MERGE` berguna untuk ETL/sync yang lebih kompleks. Tetapi untuk banyak OLTP idempotency case, `INSERT ... ON CONFLICT` lebih sederhana dan lebih umum.

Perhatikan:

- concurrency semantics harus dipahami;
- trigger bisa berjalan sesuai action;
- statement besar bisa menahan lock lama;
- source data harus didedup agar tidak ambigu;
- observability harus jelas.

---

## 13. Index Write Amplification

Misalnya tabel:

```sql
CREATE TABLE case_event (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_id uuid,
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL
);

CREATE INDEX idx_case_event_case_time
    ON case_event(case_id, occurred_at DESC);

CREATE INDEX idx_case_event_type_time
    ON case_event(event_type, occurred_at DESC);

CREATE INDEX idx_case_event_actor_time
    ON case_event(actor_id, occurred_at DESC);

CREATE INDEX idx_case_event_payload_gin
    ON case_event USING gin(payload);
```

Setiap insert perlu mempertahankan:

- primary key index;
- case/time index;
- type/time index;
- actor/time index;
- GIN payload index.

Jika ingestion besar, GIN index khususnya bisa mahal.

### 13.1 Pertanyaan desain index untuk write-heavy table

Untuk setiap index, tanya:

```text
Query apa yang menggunakan index ini?
Seberapa sering query itu berjalan?
Berapa latency budget-nya?
Apakah query bisa dilayani read model lain?
Apakah index ini memperlambat ingestion utama?
Apakah index ini masih digunakan menurut pg_stat_user_indexes?
Apakah index ini redundant?
```

### 13.2 Index untuk write-heavy event table

Biasanya event table butuh index minimal seperti:

```sql
CREATE INDEX idx_case_event_case_time
ON case_event(case_id, occurred_at DESC);
```

Index tambahan harus dibuktikan oleh access pattern.

Untuk pencarian payload JSONB yang jarang, mungkin lebih baik:

- expression index spesifik;
- partial index;
- asynchronous projection;
- search engine terpisah;
- materialized/read model.

---

## 14. WAL Amplification

Write operation menghasilkan WAL agar perubahan bisa direplay saat recovery dan dikirim ke replica.

WAL amplification naik karena:

- row besar;
- banyak index;
- full-page writes setelah checkpoint;
- frequent updates;
- bulk loads;
- GIN/GiST updates;
- TOAST data;
- large transactions;
- `UPDATE` yang mengubah banyak row;
- `DELETE` massal.

### 14.1 WAL sebagai bottleneck

Gejala:

- write latency naik;
- disk write throughput tinggi;
- replication lag naik;
- archive command backlog;
- checkpoint warning;
- IO wait tinggi;
- commit latency naik.

Observasi:

```sql
SELECT * FROM pg_stat_wal;
```

```sql
SELECT * FROM pg_stat_bgwriter;
```

```sql
SELECT * FROM pg_stat_checkpointer;
```

Ketersediaan detail view bisa bergantung versi PostgreSQL, tetapi prinsip observasinya sama: lihat WAL volume, checkpoint, write time, sync time, dan replication lag.

---

## 15. Transaction Size dan Commit Strategy

### 15.1 Banyak transaksi kecil

Kelebihan:

- lock pendek;
- rollback murah;
- error isolation baik;
- replication apply lebih smooth.

Kekurangan:

- commit overhead besar;
- round-trip banyak;
- throughput rendah;
- WAL flush lebih sering.

### 15.2 Satu transaksi raksasa

Kelebihan:

- commit overhead lebih sedikit;
- atomicity besar;
- throughput bisa tinggi dalam kondisi tertentu.

Kekurangan:

- lock lama;
- rollback mahal;
- WAL burst besar;
- replication lag;
- vacuum tertahan;
- memory/temp usage tinggi;
- failure recovery aplikasi lebih sulit;
- konflik lebih besar.

### 15.3 Chunked transaction

Untuk banyak sistem, sweet spot adalah chunking:

```text
Proses 1000–5000 row per transaction,
commit,
catat progress,
lanjut.
```

Dengan progress table:

```sql
CREATE TABLE import_job_progress (
    import_id uuid PRIMARY KEY,
    last_processed_line bigint NOT NULL,
    status text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

Ini memungkinkan retry setelah crash tanpa mengulang semua dari nol.

---

## 16. Idempotent Ingestion

Write-heavy system harus didesain untuk retry. Retry tanpa idempotency akan menggandakan data.

### 16.1 Idempotency key

Contoh:

```sql
CREATE TABLE idempotency_key (
    scope text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response_ref uuid,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);
```

Pola:

1. coba insert idempotency key;
2. jika berhasil, proses request;
3. jika conflict, cek apakah hash sama;
4. jika sama, return hasil sebelumnya atau status in-progress;
5. jika beda, reject sebagai conflict.

### 16.2 Idempotent event ingestion

```sql
CREATE TABLE external_event_ingest (
    source_system text NOT NULL,
    external_event_id text NOT NULL,
    payload_hash text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    case_event_id uuid,
    PRIMARY KEY (source_system, external_event_id)
);
```

Insert:

```sql
INSERT INTO external_event_ingest(source_system, external_event_id, payload_hash)
VALUES ($1, $2, $3)
ON CONFLICT (source_system, external_event_id) DO NOTHING;
```

Jika conflict, cek hash:

```sql
SELECT payload_hash, case_event_id
FROM external_event_ingest
WHERE source_system = $1
  AND external_event_id = $2;
```

Jika hash berbeda, itu bukan retry biasa. Itu data integrity event.

### 16.3 Idempotency dan transaction boundary

Idempotency key dan efek bisnis sebaiknya berada dalam transaksi yang sama jika ingin atomic.

Contoh:

```text
BEGIN
  insert idempotency key
  insert business event
  update idempotency response_ref
COMMIT
```

Jika memakai external side effect, perlu outbox pattern.

---

## 17. Outbox Pattern dalam Write Path

Dalam sistem Java, sering ada kebutuhan:

```text
Update database lalu publish message ke Kafka/RabbitMQ/SNS/etc.
```

Masalah klasik:

```text
DB commit berhasil, publish gagal.
Publish berhasil, DB commit gagal.
```

Outbox pattern:

```sql
CREATE TABLE outbox_message (
    id uuid PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);
```

Dalam transaksi bisnis:

```sql
UPDATE regulatory_case
SET status = 'ESCALATED', updated_at = now()
WHERE id = $1;

INSERT INTO outbox_message(id, aggregate_type, aggregate_id, event_type, payload)
VALUES ($2, 'REGULATORY_CASE', $1, 'CASE_ESCALATED', $3);
```

Worker membaca:

```sql
SELECT id, payload
FROM outbox_message
WHERE status = 'PENDING'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

Lalu publish dan mark published.

Write path impact:

- setiap business write juga insert outbox row;
- outbox perlu index yang tepat;
- outbox perlu retention;
- worker update/delete bisa membuat bloat;
- `SKIP LOCKED` perlu lock-aware design.

---

## 18. Queue Table Write Pattern

PostgreSQL bisa dipakai sebagai queue untuk skala tertentu, tetapi harus hati-hati.

Contoh:

```sql
CREATE TABLE job_queue (
    id uuid PRIMARY KEY,
    queue_name text NOT NULL,
    status text NOT NULL,
    payload jsonb NOT NULL,
    available_at timestamptz NOT NULL DEFAULT now(),
    attempts int NOT NULL DEFAULT 0,
    locked_by text,
    locked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_queue_ready
ON job_queue(queue_name, available_at, id)
WHERE status = 'READY';
```

Worker claim:

```sql
WITH candidate AS (
    SELECT id
    FROM job_queue
    WHERE queue_name = $1
      AND status = 'READY'
      AND available_at <= now()
    ORDER BY available_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
)
UPDATE job_queue j
SET status = 'PROCESSING',
    locked_by = $2,
    locked_at = now(),
    attempts = attempts + 1
FROM candidate c
WHERE j.id = c.id
RETURNING j.*;
```

Masalah potensial:

- high update churn;
- bloat;
- hot partial index;
- autovacuum pressure;
- status indexed berubah terus;
- long transaction worker;
- retry storm.

Untuk queue besar/high-throughput, dedicated broker sering lebih tepat. PostgreSQL queue cocok jika:

- volume moderat;
- transactional coupling dengan data utama penting;
- operational simplicity lebih penting daripada throughput ekstrem;
- retention dan vacuum ditangani serius.

---

## 19. Write Path dan Foreign Key

Foreign key menjaga referential integrity, tetapi write path harus melakukan check.

Insert child:

```sql
INSERT INTO case_note(case_id, body)
VALUES ($1, $2);
```

PostgreSQL perlu memastikan `case_id` ada di parent table.

Delete/update parent juga dapat memerlukan cek child rows.

### 19.1 Index child foreign key

Jika parent row sering di-delete/update, child FK column biasanya harus diindex.

```sql
CREATE INDEX idx_case_note_case_id
ON case_note(case_id);
```

Tanpa index, delete/update parent bisa scan child table untuk memastikan tidak ada referensi, yang bisa menyebabkan blocking dan latency besar.

### 19.2 Bulk load dengan FK

Bulk load child rows dengan FK aktif dapat mahal. Opsi desain:

- load parent dulu;
- staging table tanpa FK lalu validate/merge;
- gunakan `NOT VALID` untuk constraint baru;
- batch dengan urutan referential yang benar;
- jangan sembarang disable constraint di sistem produksi kecuali prosedur sangat jelas.

---

## 20. Trigger dalam Write Path

Trigger bisa sangat berguna:

- audit trail;
- denormalized projection;
- validation tambahan;
- maintaining summary;
- outbox otomatis.

Tetapi trigger membuat write path lebih tersembunyi.

Contoh:

```sql
CREATE TRIGGER trg_case_audit
AFTER UPDATE ON regulatory_case
FOR EACH ROW
EXECUTE FUNCTION write_case_audit_log();
```

Satu update aplikasi sekarang juga melakukan insert audit.

Risiko:

- developer Java tidak sadar cost tambahan;
- trigger query buruk;
- recursive effects;
- lock tambahan;
- error trigger menggagalkan transaksi utama;
- observability kurang jelas;
- deployment coupling.

Prinsip:

```text
Trigger boleh dipakai untuk invariant/audit yang harus dekat dengan data,
tetapi harus diperlakukan sebagai bagian eksplisit dari write path.
```

---

## 21. RETURNING untuk Mengurangi Round-trip

PostgreSQL mendukung `RETURNING` untuk mendapatkan row hasil insert/update/delete.

```sql
INSERT INTO regulatory_case(title, status)
VALUES ($1, 'OPEN')
RETURNING id, created_at;
```

Ini menghindari query tambahan:

```text
INSERT lalu SELECT balik id/created_at
```

Untuk Java:

```java
UUID id = jdbcTemplate.queryForObject("""
    INSERT INTO regulatory_case(title, status)
    VALUES (?, 'OPEN')
    RETURNING id
""", UUID.class, title);
```

Kelebihan:

- mengurangi round-trip;
- mendapatkan value final setelah default/generated/trigger;
- cocok untuk id generated di DB.

Hati-hati:

- `RETURNING *` pada row besar bisa mahal;
- batch + returning lebih kompleks;
- ORM bisa menghasilkan returning otomatis;
- jangan return payload besar jika tidak perlu.

Prinsip:

```text
RETURNING kolom yang diperlukan saja.
```

---

## 22. Generated ID: UUID, Sequence, Identity, dan Locality

### 22.1 Sequence/identity

```sql
CREATE TABLE invoice (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    amount numeric(19,2) NOT NULL
);
```

Keunggulan:

- simple;
- locality baik untuk B-tree;
- compact;
- performant.

Kelemahan:

- predictable;
- sequence gap normal;
- dapat menjadi concern untuk external exposure;
- distributed generation tidak langsung.

Sequence gap bukan bug. Gap bisa terjadi karena rollback, cache, crash.

### 22.2 UUID random

Keunggulan:

- bisa dibuat client-side;
- tidak mudah ditebak;
- cocok untuk distributed systems;
- baik untuk public id.

Kelemahan:

- 16 byte vs 8 byte bigint;
- random insertion ke B-tree primary key bisa lebih mahal;
- index lebih besar;
- cache locality lebih buruk.

### 22.3 UUIDv7 / time-ordered id

PostgreSQL versi modern mulai mendukung fungsi UUID yang lebih kaya. Time-ordered UUID seperti UUIDv7 menarik karena menggabungkan sifat global-ish ID dengan locality yang lebih baik dibanding UUID random.

Tetapi keputusan ID harus mempertimbangkan:

- database version;
- library Java;
- migration compatibility;
- security/privacy;
- ordering semantics;
- cross-service generation.

Prinsip:

```text
Primary key adalah write-path decision, bukan hanya modelling decision.
```

---

## 23. Write Path untuk JSONB dan TOAST

Row dengan `jsonb` besar bisa masuk TOAST. Update JSONB besar dapat mahal karena data perlu ditulis ulang pada level value, bukan patch kecil seperti document database tertentu.

Contoh buruk:

```sql
UPDATE case_file
SET metadata = jsonb_set(metadata, '{lastViewedAt}', to_jsonb(now()))
WHERE id = $1;
```

Jika `metadata` besar dan sering diupdate, ini bisa menghasilkan WAL/bloat besar.

Lebih baik pisahkan field yang sering berubah:

```sql
ALTER TABLE case_file
ADD COLUMN last_viewed_at timestamptz;
```

Prinsip:

```text
JSONB cocok untuk data fleksibel,
tetapi field high-churn sebaiknya menjadi kolom biasa.
```

---

## 24. Batch Update Patterns

### 24.1 Update banyak row dengan CASE

Untuk batch kecil:

```sql
UPDATE account
SET risk_level = CASE id
    WHEN $1 THEN $2
    WHEN $3 THEN $4
    WHEN $5 THEN $6
END
WHERE id IN ($1, $3, $5);
```

Tetapi ini tidak nyaman untuk batch besar.

### 24.2 Update via VALUES

```sql
UPDATE account a
SET risk_level = v.risk_level,
    updated_at = now()
FROM (
    VALUES
        ($1::uuid, $2::text),
        ($3::uuid, $4::text),
        ($5::uuid, $6::text)
) AS v(id, risk_level)
WHERE a.id = v.id
  AND a.risk_level IS DISTINCT FROM v.risk_level;
```

### 24.3 Update via staging table

Untuk batch besar:

```text
COPY -> staging -> UPDATE main FROM staging
```

```sql
UPDATE account a
SET risk_level = s.risk_level,
    updated_at = now()
FROM staging_account_risk s
WHERE a.external_id = s.external_id
  AND s.import_id = $1
  AND a.risk_level IS DISTINCT FROM s.risk_level;
```

Ini lebih scalable dan observability lebih baik.

---

## 25. Batch Delete Patterns

### 25.1 Delete by key list

```sql
DELETE FROM case_tag
WHERE case_id = $1
  AND tag = ANY($2);
```

### 25.2 Replace collection safely

Di ORM, mengganti collection sering menghasilkan delete all + insert all.

Misalnya tags case:

```text
old: A, B, C
new: A, B, D
```

Naive approach:

```text
delete A,B,C
insert A,B,D
```

Lebih baik diff:

```text
delete C
insert D
```

Database impact jauh lebih kecil.

### 25.3 `DELETE` + `INSERT` vs `UPSERT`

Untuk refresh projection, jangan langsung delete all insert all jika volume besar dan table diquery aktif.

Alternatif:

- upsert changed rows;
- delete only missing rows;
- versioned projection;
- build new partition/table then swap;
- materialized view refresh strategy.

---

## 26. Error Handling pada Batch

Batch write menimbulkan pertanyaan:

```text
Jika satu row gagal, apa yang terjadi dengan row lain?
```

Dalam satu statement multi-row, satu violation biasanya menggagalkan seluruh statement.

Dalam satu transaction berisi banyak batch, error membuat transaction masuk aborted state sampai rollback.

Dari Java, jangan lanjut memakai connection setelah SQL exception dalam transaksi tanpa rollback.

Pola:

```java
try {
    con.setAutoCommit(false);
    // batch operations
    con.commit();
} catch (SQLException e) {
    con.rollback();
    throw e;
}
```

Untuk ingestion besar, strategi lebih baik:

- validate di staging;
- pisahkan bad rows;
- commit per chunk;
- simpan import status;
- jangan membuat satu row buruk menggagalkan satu juta row jika domain mengizinkan partial accept.

---

## 27. Retry Semantics

Write path harus siap menghadapi:

- deadlock detected;
- serialization failure;
- lock timeout;
- statement timeout;
- connection loss;
- failover;
- ambiguous commit;
- unique violation;
- foreign key violation.

Tidak semua error boleh diretry sama.

| Error | Retry? | Catatan |
|---|---:|---|
| Deadlock | Ya, biasanya | retry seluruh transaksi |
| Serialization failure | Ya | required untuk serializable design |
| Lock timeout | Mungkin | tergantung business intent |
| Statement timeout | Mungkin | cek apakah transaction aborted |
| Connection lost before commit response | Sulit | commit outcome bisa ambiguous |
| Unique violation | Biasanya tidak | kecuali idempotency conflict expected |
| FK violation | Tidak | biasanya data/order issue |
| Check violation | Tidak | input/domain issue |

### 27.1 Ambiguous commit

Kasus sulit:

```text
Client mengirim COMMIT.
Database commit berhasil.
Network putus sebelum client menerima response.
```

Aplikasi tidak tahu apakah commit terjadi.

Solusi bukan “retry biasa”, karena retry bisa menggandakan efek. Solusi:

- idempotency key;
- natural unique key;
- external event id;
- outbox;
- reconciliation query.

---

## 28. Locking dalam Write Path

Write operations memegang lock.

- `INSERT` memegang row/table-level locks tertentu.
- `UPDATE` memegang row lock pada row yang diupdate.
- `DELETE` memegang row lock pada row yang dihapus.
- `UPSERT DO UPDATE` dapat lock row existing.
- FK dapat menyebabkan lock pada parent/child.
- DDL/index creation dapat berinteraksi dengan write locks.

### 28.1 Update order

Deadlock sering terjadi karena urutan update tidak konsisten.

Buruk:

```text
Service A update account 1 lalu account 2
Service B update account 2 lalu account 1
```

Baik:

```text
Semua service update account berdasarkan id ascending
```

Untuk batch:

```java
items.stream()
     .sorted(Comparator.comparing(Item::id))
     .forEach(...);
```

### 28.2 Lock timeout

Gunakan timeout agar request tidak menggantung terlalu lama.

```sql
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
```

Di Java/Spring, bisa diatur per transaksi/request tertentu.

Prinsip:

```text
Timeout adalah bagian dari correctness dan operability, bukan sekadar performance setting.
```

---

## 29. Observability Write Path

### 29.1 Query-level

Gunakan:

```sql
SELECT *
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Cari:

- total time tinggi;
- mean time tinggi;
- calls tinggi;
- rows per call;
- shared/local/temp blocks;
- WAL metrics jika tersedia di versi/extension.

### 29.2 Table-level

```sql
SELECT
    relname,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_tup_hot_upd,
    n_dead_tup,
    vacuum_count,
    autovacuum_count,
    analyze_count,
    autoanalyze_count
FROM pg_stat_user_tables
ORDER BY n_tup_upd + n_tup_del DESC
LIMIT 20;
```

Pertanyaan:

```text
Table mana yang update-heavy?
HOT update ratio bagaimana?
Dead tuple tinggi?
Autovacuum jalan?
Analyze jalan?
```

### 29.3 Index-level

```sql
SELECT
    relname AS table_name,
    indexrelname AS index_name,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

Index dengan `idx_scan` rendah tetapi write table tinggi perlu dicurigai.

### 29.4 Lock/blocking

```sql
SELECT
    pid,
    state,
    wait_event_type,
    wait_event,
    query
FROM pg_stat_activity
WHERE wait_event_type IS NOT NULL;
```

### 29.5 WAL/checkpoint

```sql
SELECT * FROM pg_stat_wal;
SELECT * FROM pg_stat_bgwriter;
SELECT * FROM pg_stat_checkpointer;
```

Gunakan untuk melihat apakah bottleneck ada di WAL/checkpoint path.

---

## 30. Write Performance Diagnosis Workflow

Saat ada laporan:

```text
Insert/update lambat sejak kemarin.
```

Jangan langsung menambah hardware atau mengubah parameter.

Ikuti alur:

### Step 1 — Identifikasi bentuk write

```text
INSERT? UPDATE? DELETE? UPSERT? COPY? MERGE?
Single row? batch? transaction besar?
```

### Step 2 — Lihat scope

```text
Satu query?
Satu table?
Semua write?
Hanya tenant tertentu?
Hanya jam tertentu?
Setelah deployment/migration?
```

### Step 3 — Cek aplikasi

```text
Connection pool wait?
Autocommit loop?
Batch size berubah?
ORM flush berubah?
N+1 write?
Retry storm?
Thread pool meningkat?
```

### Step 4 — Cek database session

```sql
SELECT state, wait_event_type, wait_event, count(*)
FROM pg_stat_activity
GROUP BY state, wait_event_type, wait_event
ORDER BY count(*) DESC;
```

### Step 5 — Cek locks

Cari blocking chain.

### Step 6 — Cek table stats

```text
Dead tuple tinggi?
HOT ratio turun?
Autovacuum tertahan?
```

### Step 7 — Cek index changes

```text
Index baru ditambahkan?
GIN index baru?
Unique constraint baru?
FK baru?
Trigger baru?
```

### Step 8 — Cek WAL/checkpoint

```text
WAL rate naik?
Checkpoint terlalu sering?
Disk full?
Archiving lambat?
Replication lag?
```

### Step 9 — Cek query plan jika write pakai SELECT/UPDATE FROM

Update/delete sering punya predicate. Bad plan bisa membuat write lambat sebelum menulis.

```sql
EXPLAIN (ANALYZE, BUFFERS)
UPDATE ...
```

Gunakan transaction rollback untuk test aman bila perlu:

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
UPDATE ...;
ROLLBACK;
```

Tetap hati-hati karena `EXPLAIN ANALYZE` benar-benar menjalankan statement.

---

## 31. Common Anti-patterns

### 31.1 Autocommit per row untuk bulk insert

```text
10.000 rows = 10.000 commits
```

Solusi:

- batch;
- explicit transaction;
- COPY;
- staging.

### 31.2 Terlalu banyak index pada write-heavy table

Solusi:

- audit index usage;
- remove redundant indexes;
- partial/expression index lebih spesifik;
- separate read model.

### 31.3 Update semua kolom setiap save ORM

ORM bisa mengupdate banyak kolom meski hanya satu field berubah.

Solusi:

- dirty checking benar;
- dynamic update jika sesuai;
- command-specific SQL;
- hindari entity besar untuk high-churn update.

### 31.4 No-op UPSERT

`ON CONFLICT DO UPDATE SET updated_at = now()` untuk setiap duplicate dapat membuat bloat.

Solusi:

- `WHERE target.col IS DISTINCT FROM excluded.col`;
- `DO NOTHING` untuk immutable event;
- compare payload hash.

### 31.5 DELETE massal untuk retention

Solusi:

- partitioning;
- chunked delete;
- archival strategy.

### 31.6 Queue table tanpa vacuum strategy

Solusi:

- partial index;
- partition by time/status jika sesuai;
- delete/archive completed jobs;
- tune autovacuum;
- consider external broker.

### 31.7 One giant transaction import

Solusi:

- chunk;
- staging;
- progress tracking;
- idempotency.

### 31.8 Blind retry tanpa idempotency

Solusi:

- unique natural key;
- idempotency key;
- outbox;
- retry only safe errors.

---

## 32. Java/Spring/Hibernate Specific Pitfalls

### 32.1 Hibernate flush timing

Hibernate dapat menunda SQL sampai flush/commit. Akibatnya:

- error constraint muncul di akhir method;
- batch tidak terjadi sesuai ekspektasi;
- lock diambil lebih lambat;
- banyak SQL dikirim saat flush besar;
- memory persistence context membesar.

Untuk batch besar, gunakan:

```java
for (int i = 0; i < entities.size(); i++) {
    entityManager.persist(entities.get(i));

    if (i % 1000 == 0) {
        entityManager.flush();
        entityManager.clear();
    }
}
```

Tetapi untuk ingestion ekstrem, JDBC/COPY sering lebih cocok daripada ORM.

### 32.2 `saveAll` bukan jaminan bulk efficient

Spring Data `saveAll` bisa tetap menghasilkan banyak statement tergantung konfigurasi ORM, ID strategy, batch settings, dan flush behavior.

Cek SQL nyata, bukan asumsi API.

### 32.3 Entity graph besar

Mengubah aggregate besar bisa memicu update/delete/insert child collection besar.

Untuk high-write command, sering lebih baik menggunakan SQL eksplisit:

```java
jdbcTemplate.update("""
    UPDATE regulatory_case
    SET status = ?, updated_at = now()
    WHERE id = ? AND status = ?
""", newStatus, caseId, expectedStatus);
```

Daripada load entity besar lalu mutate.

### 32.4 Optimistic locking

```sql
UPDATE regulatory_case
SET status = $1,
    version = version + 1,
    updated_at = now()
WHERE id = $2
  AND version = $3;
```

Jika affected row = 0, terjadi conflict.

Ini efisien dan jelas untuk banyak workflow transition.

---

## 33. Write Path untuk State Machine / Enforcement Lifecycle

Misalnya tabel:

```sql
CREATE TABLE enforcement_case (
    id uuid PRIMARY KEY,
    status text NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    assigned_unit_id uuid,
    escalated_at timestamptz,
    closed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED'))
);
```

Transition aman:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED',
    escalated_at = now(),
    version = version + 1,
    updated_at = now()
WHERE id = $1
  AND status = 'UNDER_REVIEW'
  AND version = $2
RETURNING id, status, version;
```

Jika return kosong:

```text
case tidak ada, status bukan expected, atau version conflict
```

Keunggulan:

- atomic;
- tidak perlu lock eksplisit untuk banyak kasus;
- menghindari lost update;
- cocok untuk REST command;
- mudah dipetakan ke domain error.

Tambahkan audit/outbox dalam transaksi yang sama:

```sql
INSERT INTO case_audit_log(...);
INSERT INTO outbox_message(...);
```

Write path cost meningkat, tetapi correctness lebih kuat.

---

## 34. Configuration yang Sering Berpengaruh pada Write Path

Bagian ini bukan tuning recipe, hanya peta.

### 34.1 `synchronous_commit`

Mengontrol kapan commit menunggu WAL flush/replication level tertentu. Menurunkan durability latency bisa meningkatkan throughput, tetapi mengubah durability semantics.

Jangan ubah global tanpa memahami risiko.

### 34.2 `wal_compression`

Dapat mengurangi WAL volume untuk workload tertentu, dengan trade-off CPU.

### 34.3 `checkpoint_timeout`, `max_wal_size`

Checkpoint terlalu sering dapat membuat write latency buruk. Tetapi terlalu jarang juga punya trade-off recovery time dan disk WAL.

### 34.4 `maintenance_work_mem`

Berpengaruh pada index creation, vacuum, maintenance operation.

### 34.5 Autovacuum settings

Write-heavy table sering perlu per-table autovacuum tuning.

### 34.6 Pool size

Pool terlalu besar bisa membuat write concurrency berlebihan:

```text
lebih banyak concurrent writers -> lebih banyak lock contention, WAL pressure, IO pressure
```

Kadang menurunkan pool size membuat throughput lebih stabil.

---

## 35. Production Design Checklist

Sebelum membuat write-heavy flow, jawab:

### Workload

- Berapa row/sec target?
- Row kecil atau besar?
- Insert-only, update-heavy, delete-heavy, atau upsert-heavy?
- Ada hot key/hot tenant?
- Ada burst?

### Correctness

- Apa invariant utama?
- Constraint apa yang harus di database?
- Apakah operation idempotent?
- Apa natural key/conflict key?
- Bagaimana retry aman?

### Schema

- Berapa index per write?
- Apakah indexed column sering berubah?
- Apakah JSONB besar sering diupdate?
- Apakah perlu partitioning?
- Apakah FK punya supporting index?

### Transaction

- Autocommit atau explicit transaction?
- Batch size berapa?
- Lock ditahan berapa lama?
- Apa timeout?
- Apa rollback cost?

### Ingestion

- INSERT batch atau COPY?
- Langsung main table atau staging?
- Bagaimana validasi bad row?
- Bagaimana progress tracking?

### Operations

- Bagaimana melihat WAL rate?
- Bagaimana melihat dead tuple?
- Bagaimana melihat lock wait?
- Bagaimana melihat replication lag?
- Bagaimana restore/reprocess jika import gagal?

---

## 36. Latihan Praktis

### Latihan 1 — Bandingkan single insert vs batch

Buat tabel:

```sql
CREATE TABLE ingest_test (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
```

Uji:

1. insert 10.000 row autocommit;
2. insert 10.000 row dalam satu transaction;
3. insert 10.000 row JDBC batch;
4. insert 10.000 row COPY.

Catat:

- total time;
- WAL growth;
- CPU;
- IO;
- table size;
- index size.

### Latihan 2 — HOT update

```sql
CREATE TABLE hot_test (
    id bigserial PRIMARY KEY,
    status text NOT NULL,
    counter int NOT NULL DEFAULT 0,
    payload text
) WITH (fillfactor = 80);

CREATE INDEX idx_hot_test_status ON hot_test(status);
```

Update `counter`, lalu lihat `n_tup_hot_upd`.

Kemudian buat index pada `counter` dan ulangi. Bandingkan HOT update ratio.

### Latihan 3 — No-op upsert

Buat table dengan unique key, lalu jalankan UPSERT yang selalu update walau value sama. Amati dead tuple. Kemudian tambahkan `WHERE ... IS DISTINCT FROM ...` dan bandingkan.

### Latihan 4 — Delete massal vs chunked delete

Buat 1 juta row, lalu bandingkan:

- satu `DELETE` besar;
- chunked delete;
- partition drop.

Catat WAL, lock duration, dead tuple, vacuum behavior.

---

## 37. Ringkasan Mental Model

Write performance PostgreSQL harus dipahami sebagai sistem:

```text
Application command
  -> JDBC / pool / transaction boundary
  -> SQL statement
  -> lock acquisition
  -> heap tuple change
  -> index maintenance
  -> constraint/trigger work
  -> WAL generation
  -> commit durability
  -> replication/archive impact
  -> vacuum debt
  -> future read performance
```

Kesalahan umum engineer adalah melihat write sebagai operasi lokal:

```text
INSERT satu row ya satu row.
UPDATE satu field ya satu field.
DELETE berarti data hilang.
UPSERT berarti aman.
Batch besar berarti cepat.
```

PostgreSQL memaksa kita berpikir lebih sistemik:

```text
Setiap write adalah perubahan terhadap storage, concurrency, durability,
index, vacuum, replication, dan operational envelope.
```

Engineer yang kuat mampu merancang write path dengan pertanyaan:

- Apa invariant yang dijaga?
- Apa yang terjadi jika retry?
- Apa yang terjadi jika crash setelah commit tapi sebelum response?
- Apa yang terjadi jika ada duplicate event?
- Apa yang terjadi jika batch gagal di tengah?
- Apa yang terjadi pada replica?
- Apa yang terjadi pada vacuum?
- Apa index cost dari write ini?
- Apa lock yang ditahan?
- Apa observability-nya?

---

## 38. Referensi Resmi dan Lanjutan

Dokumentasi utama PostgreSQL:

- PostgreSQL Documentation — `INSERT`
- PostgreSQL Documentation — `UPDATE`
- PostgreSQL Documentation — `DELETE`
- PostgreSQL Documentation — `COPY`
- PostgreSQL Documentation — Transaction Isolation
- PostgreSQL Documentation — WAL
- PostgreSQL Documentation — Routine Vacuuming
- PostgreSQL Documentation — Indexes
- PostgreSQL Documentation — Monitoring Statistics
- PostgreSQL Documentation — Explicit Locking

Topik terkait yang sudah dibahas dalam seri ini:

- Part 003 — Storage Model
- Part 004 — MVCC
- Part 006 — WAL
- Part 011–013 — Index Internals dan Index Design
- Part 014 — Locking
- Part 015 — Constraints
- Part 019 — Vacuum, Autovacuum, Freeze, dan Bloat

---

## 39. Koneksi ke Part Berikutnya

Part berikutnya adalah:

```text
Part 021 — Read Path Performance: Access Pattern, Pagination, Caching, dan Query Shape
```

Setelah memahami write path, kita akan melihat sisi baca:

- point lookup;
- range lookup;
- top-N query;
- offset pagination problem;
- keyset pagination;
- index-friendly query shape;
- read model;
- cache boundary;
- read replica;
- ORM accidental query;
- latency budget.

Write path dan read path tidak bisa dipisahkan. Index yang dibuat untuk read akan dibayar oleh write. Denormalisasi yang dibuat untuk read akan dibayar oleh write. Audit/outbox yang dibuat untuk correctness akan dibayar oleh write. Maka desain PostgreSQL produksi selalu trade-off sadar, bukan kumpulan trik.

---

**Status seri:** belum selesai.  
**Progress:** selesai sampai Part 020 dari 034.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Vacuum, Autovacuum, Freeze, dan Bloat</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-021.md">Part 021 — Read Path Performance: Access Pattern, Pagination, Caching, dan Query Shape ➡️</a>
</div>
