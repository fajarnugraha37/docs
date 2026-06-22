# learn-mysql-mastery-for-java-engineers-part-017.md

# Part 017 — Write Path Internals: Redo Log, Undo Log, Binlog, Doublewrite

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `017 / 034`  
> Fokus: memahami jalur tulis MySQL/InnoDB dari statement aplikasi sampai commit yang durable, replicated, recoverable, dan observable.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu harus bisa menjawab pertanyaan-pertanyaan berikut dengan mental model yang stabil:

1. Saat aplikasi Java menjalankan `INSERT`, `UPDATE`, atau `DELETE`, apa yang sebenarnya berubah di dalam MySQL?
2. Kenapa commit bisa cepat walaupun data page belum langsung ditulis ke lokasi final di tablespace?
3. Apa perbedaan fungsi **redo log**, **undo log**, **binary log**, dan **doublewrite buffer**?
4. Kenapa MySQL membutuhkan koordinasi antara InnoDB redo log dan binary log?
5. Apa konsekuensi konfigurasi `innodb_flush_log_at_trx_commit` dan `sync_binlog`?
6. Kenapa transaction size, batch write, dan connection pool behavior dari aplikasi Java bisa memengaruhi checkpoint, replication, crash recovery, dan latency?
7. Bagaimana membaca failure mode: crash setelah client menerima success, crash sebelum success, replication lag, uncertain commit, duplicate retry, dan partial side effect?

Bagian ini bukan tutorial SQL. Kita akan membangun **model write path**: dari perubahan logical di SQL sampai perubahan fisik di memory, log, disk, dan replication stream.

---

## 1. Big Picture: Commit Bukan Sekadar “Data Ditulis ke Disk”

Banyak engineer membayangkan commit seperti ini:

```text
Application sends INSERT
Database writes row to table file
Database replies success
```

Model ini terlalu sederhana dan berbahaya.

Dalam InnoDB, write path lebih dekat seperti ini:

```text
Application
  -> MySQL connection/session
  -> SQL layer parses and executes statement
  -> InnoDB modifies pages in buffer pool
  -> InnoDB records undo information
  -> InnoDB records redo information
  -> MySQL writes binary log event if binlog enabled
  -> InnoDB commits transaction
  -> Dirty pages are flushed later
  -> Crash recovery uses redo/undo/binlog consistency rules
```

Commit tidak berarti setiap modified data page sudah berada di lokasi final tablespace. Commit berarti database sudah membuat perubahan tersebut **recoverable** sesuai konfigurasi durabilitasnya.

InnoDB memakai prinsip penting:

> Jangan harus menulis seluruh data page ke disk pada setiap commit. Tulis log perubahan secara efisien, lalu flush data page belakangan.

Inilah inti dari write-ahead logging.

---

## 2. Empat Komponen Utama Write Path

Untuk memahami write path MySQL, pisahkan empat komponen ini:

| Komponen | Milik | Fungsi utama | Dipakai untuk |
|---|---|---|---|
| Undo log | InnoDB | Menyimpan versi lama/rollback info | rollback, MVCC consistent read, purge |
| Redo log | InnoDB | Merekam perubahan fisik/logical terhadap page agar bisa diulang setelah crash | crash recovery |
| Binary log/binlog | MySQL Server layer | Merekam event perubahan data/schema untuk replication dan PITR | replication, point-in-time recovery, CDC |
| Doublewrite buffer | InnoDB | Melindungi dari torn page saat flushing page | crash recovery page integrity |

Keempatnya sering tercampur dalam diskusi. Padahal fungsinya berbeda.

### Analogi singkat

Bayangkan sebuah sistem case-management regulatory:

- **Undo log** seperti riwayat versi internal untuk bisa membatalkan perubahan atau membaca snapshot lama.
- **Redo log** seperti jurnal pemulihan lokal agar setelah server crash sistem bisa mengulang perubahan committed yang belum sempat masuk ke file utama.
- **Binlog** seperti event stream resmi yang dikirim ke replika, backup incremental, atau CDC pipeline.
- **Doublewrite buffer** seperti area staging untuk memastikan page yang sedang dipindahkan ke arsip fisik tidak rusak setengah tulis.

---

## 3. Jalur Tulis Satu Transaksi Sederhana

Misalnya aplikasi Java menjalankan:

```sql
START TRANSACTION;

UPDATE enforcement_case
SET status = 'UNDER_REVIEW',
    updated_at = NOW(6),
    version = version + 1
WHERE id = 1001
  AND status = 'SUBMITTED';

INSERT INTO case_audit_log(case_id, actor_id, action, created_at)
VALUES (1001, 42, 'MARK_UNDER_REVIEW', NOW(6));

COMMIT;
```

Secara konseptual, alurnya:

```text
1. MySQL menerima statement dari connection.
2. Optimizer menentukan access path.
3. InnoDB membaca page yang diperlukan ke buffer pool jika belum ada.
4. InnoDB mengambil lock yang diperlukan.
5. InnoDB membuat undo record untuk perubahan lama.
6. InnoDB mengubah page di buffer pool.
7. InnoDB menulis redo record ke redo log buffer.
8. Saat COMMIT, MySQL menyiapkan binary log event.
9. InnoDB dan binlog dikoordinasikan agar commit konsisten.
10. Commit dianggap sukses jika durability policy terpenuhi.
11. Dirty page akan diflush nanti oleh background thread/checkpoint.
```

Poin penting:

- Row berubah dulu di memory page buffer pool.
- Redo log memastikan perubahan itu bisa dipulihkan bila crash.
- Binlog memastikan perubahan bisa direplikasi/direplay untuk PITR/CDC.
- Data page tidak harus langsung ditulis ke lokasi final saat commit.

---

## 4. Buffer Pool dan Dirty Page

InnoDB tidak bekerja langsung ke file tablespace untuk setiap row update. Ia bekerja pada page di memory, yaitu **buffer pool**.

Ketika row di-update:

```text
Data page di buffer pool berubah
      |
      v
Page ditandai dirty
      |
      v
Redo record dibuat
      |
      v
Commit bisa selesai sebelum dirty page diflush ke tablespace
```

### Dirty page

Dirty page adalah page di buffer pool yang isinya lebih baru daripada page yang ada di disk.

Contoh:

```text
Disk page P42: status = SUBMITTED
Buffer pool page P42: status = UNDER_REVIEW
```

Selama page tersebut belum diflush, disk tablespace masih berisi versi lama. Itu tidak masalah selama redo log cukup untuk memulihkan perubahan tersebut setelah crash.

### Kenapa ini penting?

Karena kalau setiap commit harus menulis random 16KB page ke lokasi final disk, write throughput akan buruk. Dengan redo log, banyak perubahan kecil bisa ditulis sebagai log sequential yang lebih efisien.

---

## 5. Undo Log: Untuk Rollback dan MVCC, Bukan Crash Redo

Undo log menyimpan informasi untuk membalikkan perubahan dan menyediakan versi lama bagi consistent read.

Misalnya row awal:

```text
case_id = 1001
status  = SUBMITTED
version = 3
```

Transaksi T1 mengubah menjadi:

```text
status  = UNDER_REVIEW
version = 4
```

InnoDB perlu menyimpan informasi bahwa versi sebelumnya adalah:

```text
status  = SUBMITTED
version = 3
```

Itulah peran undo.

### Fungsi undo log

Undo log digunakan untuk:

1. **Rollback** transaksi yang belum commit.
2. **Consistent read** untuk transaksi lain yang masih melihat snapshot lama.
3. **Crash recovery** bagian rollback transaksi yang belum committed.
4. **Purge** setelah versi lama tidak lagi dibutuhkan.

### Undo log dan MVCC

Pada Part 006 kita sudah membahas read view. Undo log memungkinkan transaksi lama tetap membaca versi row sebelum perubahan committed oleh transaksi baru.

Contoh:

```text
T1 starts at 10:00:00
T2 updates case status and commits at 10:00:05
T1 reads same case at 10:00:10 under REPEATABLE READ
```

T1 bisa tetap melihat versi lama karena InnoDB bisa menelusuri undo chain.

### Java anti-pattern yang membuat undo membengkak

```java
@Transactional
public void exportLargeReport() {
    Stream<CaseRecord> rows = repository.streamAllCases();
    rows.forEach(row -> writeCsv(row));
}
```

Masalah:

- transaksi bisa hidup lama;
- read view lama menahan purge;
- undo version lama tidak bisa dibersihkan;
- write workload lain tetap membuat undo;
- history list bisa tumbuh;
- storage dan recovery pressure naik.

Untuk laporan besar, sering lebih aman memakai:

- pagination read-only tanpa transaksi panjang;
- snapshot terpisah;
- replica/reporting DB;
- chunked export;
- dedicated analytical store bila workload besar.

---

## 6. Redo Log: Untuk Mengulang Perubahan Setelah Crash

Redo log adalah struktur log disk yang digunakan InnoDB saat crash recovery untuk memperbaiki data yang belum sempat tersinkron ke file data utama. Dokumentasi MySQL menjelaskan redo log sebagai struktur disk-based yang dipakai saat crash recovery untuk mengoreksi data yang ditulis oleh transaksi yang belum lengkap atau belum sepenuhnya tertulis ke data files.

Mental model:

```text
Data page update di memory:
  page_id = 42
  offset = ...
  change = ...

Redo record:
  "Jika crash, perubahan pada page 42 ini harus bisa diterapkan lagi"
```

### Write-ahead logging

Prinsipnya:

> Sebelum dirty page boleh dianggap aman untuk diflush sebagai perubahan committed, redo information yang diperlukan harus sudah ada lebih dulu.

Ini membuat crash recovery mungkin.

### Redo log buffer vs redo log file

Ada dua level:

```text
Redo log buffer: memory
Redo log file: disk
```

Saat transaksi mengubah data:

1. redo record masuk ke redo log buffer;
2. saat commit atau flush periodik, redo log buffer ditulis/flushed ke redo log file sesuai konfigurasi;
3. checkpoint menentukan seberapa jauh dirty page sudah aman diflush.

### Kenapa redo log membuat commit cepat?

Karena menulis redo log biasanya lebih sequential daripada menulis banyak page acak ke tablespace.

Contoh update 100 row tersebar di 100 page:

Tanpa redo model:

```text
Tulis 100 page acak ke disk saat commit
```

Dengan redo model:

```text
Tulis redo log sequential
Flush dirty page belakangan secara background
```

---

## 7. Checkpoint: Menjaga Redo Log Tidak Tumbuh Tanpa Batas

Dirty page tidak bisa dibiarkan selamanya. Pada akhirnya InnoDB harus menulis dirty page dari buffer pool ke tablespace.

Checkpoint adalah mekanisme yang menandai bahwa perubahan sampai titik tertentu sudah tercermin di data files sehingga redo log sebelum titik itu tidak lagi diperlukan untuk recovery.

```text
Redo log timeline:

[ old redo not needed ][ redo still needed for recovery ][ newest redo ]
             ^
             checkpoint age boundary
```

Jika dirty page terlalu banyak dan redo log pressure meningkat, InnoDB harus flush lebih agresif.

### Dampak checkpoint pressure

Gejala yang bisa terlihat:

- write latency spike;
- commit menjadi tidak stabil;
- background I/O meningkat;
- buffer pool churn;
- throughput turun;
- aplikasi Java mengalami timeout padahal CPU tidak penuh.

### Transaction size dan checkpoint

Transaksi besar menciptakan banyak redo dan undo sebelum commit.

Contoh buruk:

```java
@Transactional
public void recomputeAllCases() {
    List<CaseEntity> all = repository.findAll();
    for (CaseEntity c : all) {
        c.recomputeRiskScore();
    }
}
```

Masalah:

- undo besar;
- redo besar;
- locks lama;
- replication event besar;
- rollback mahal;
- crash recovery lebih berat;
- kemungkinan timeout tinggi.

Lebih baik chunked:

```java
public void recomputeAllCases() {
    while (true) {
        List<Long> ids = repository.findNextIdsNeedingRecompute(500);
        if (ids.isEmpty()) break;
        recomputeChunk(ids);
    }
}

@Transactional
public void recomputeChunk(List<Long> ids) {
    List<CaseEntity> rows = repository.findByIdInForUpdate(ids);
    for (CaseEntity c : rows) {
        c.recomputeRiskScore();
    }
}
```

Chunking bukan hanya soal memory Java. Chunking adalah pengendalian:

- undo footprint;
- redo burst;
- lock duration;
- replication lag;
- rollback cost;
- operational blast radius.

---

## 8. Doublewrite Buffer: Perlindungan dari Torn Page

InnoDB page biasanya 16KB. Storage device atau OS bisa saja mengalami crash saat sebagian page sedang ditulis. Akibatnya page di tablespace bisa menjadi setengah lama, setengah baru. Ini disebut **torn page**.

Doublewrite buffer melindungi dari kondisi ini.

Konsep:

```text
Dirty page dari buffer pool
      |
      v
Tulis dulu ke doublewrite area
      |
      v
Jika aman, tulis ke lokasi final tablespace
```

Jika crash terjadi saat penulisan ke lokasi final:

```text
InnoDB saat recovery dapat memakai salinan page yang baik dari doublewrite buffer
```

### Redo log saja tidak cukup?

Redo log bisa mengulang perubahan, tetapi recovery butuh base page yang valid. Jika page fisik rusak setengah tulis, redo mungkin tidak bisa diterapkan dengan aman. Doublewrite buffer memberi salinan page utuh untuk memulihkan base page.

### Mental model

Redo log menjawab:

> Perubahan apa yang perlu diulang?

Doublewrite buffer menjawab:

> Apakah page fisik yang akan diberi redo masih utuh?

---

## 9. Binary Log: Event Stream untuk Replication dan PITR

Binary log atau binlog berada di MySQL server layer, bukan hanya InnoDB.

Fungsi utama:

1. replication;
2. point-in-time recovery;
3. change data capture;
4. auditing teknis tertentu;
5. replikasi antar topology.

Binary log mencatat event perubahan seperti:

- DDL;
- DML;
- transaction commit event;
- row changes jika row-based logging;
- statement changes jika statement-based logging.

Pada MySQL modern, row-based binary logging lebih sering menjadi pilihan production karena lebih deterministik untuk replication/CDC.

### Binlog bukan redo log

Perbedaan penting:

| Aspek | Redo log | Binlog |
|---|---|---|
| Layer | InnoDB | MySQL Server |
| Tujuan | crash recovery lokal | replication/PITR/CDC |
| Isi | perubahan page/internal storage | event logical/row perubahan |
| Dipakai replika? | tidak | ya |
| Dipakai rollback? | tidak | tidak |
| Storage-engine specific? | ya | lebih umum |

### Kenapa binlog penting untuk Java engineer?

Karena banyak arsitektur modern memakai binlog secara tidak langsung:

- read replica;
- Debezium CDC;
- outbox relay;
- audit projection;
- cache invalidation;
- search indexing;
- data warehouse ingestion;
- event-driven integration.

Saat aplikasi menganggap “data sudah commit”, sering ada pipeline lain yang baru akan melihat perubahan setelah binlog event diproses.

---

## 10. Koordinasi InnoDB Redo Log dan Binary Log

Jika binary log aktif, MySQL harus menjaga konsistensi antara:

- transaksi sudah committed di InnoDB;
- event transaksi ada di binlog.

Jika salah satu ada tanpa yang lain, sistem bisa rusak secara semantik.

### Skenario buruk 1: InnoDB commit tetapi binlog hilang

```text
Primary data: row sudah berubah
Binlog: event tidak ada
Replica: tidak pernah menerima perubahan
```

Dampak:

- primary dan replica diverge;
- PITR tidak lengkap;
- CDC kehilangan event;
- audit downstream tidak sinkron.

### Skenario buruk 2: Binlog ada tetapi InnoDB tidak commit

```text
Primary data: row tidak berubah
Binlog: event ada
Replica/CDC: menganggap row berubah
```

Dampak:

- downstream melihat perubahan palsu;
- inconsistency antara source dan consumers.

Karena itu commit MySQL dengan InnoDB dan binlog memerlukan koordinasi commit. Secara konseptual ada fase prepare dan commit supaya redo/binlog konsisten.

### Mental model two-phase coordination

Secara disederhanakan:

```text
1. InnoDB prepares transaction
2. MySQL writes transaction to binary log
3. Binary log is flushed/synced according to sync_binlog
4. InnoDB commits transaction
5. Commit result returned to client
```

Detail implementasi bisa berubah antar versi, tetapi invariannya penting:

> MySQL harus menjaga atomicity antara local storage commit dan binary log visibility.

---

## 11. Group Commit: Mengurangi Biaya fsync Per Transaksi

`fsync()` mahal. Jika setiap transaksi sendiri-sendiri melakukan flush sinkron ke disk, throughput akan buruk.

Group commit menggabungkan beberapa transaksi agar biaya flush/sync bisa dibagi.

```text
T1 commit arrives
T2 commit arrives
T3 commit arrives
      |
      v
Group flush/sync
      |
      v
T1, T2, T3 commit complete
```

### Dampak group commit

Group commit bisa meningkatkan throughput, terutama saat banyak transaksi kecil.

Namun latency individual bisa sedikit berubah karena transaksi menunggu batch. Di workload high throughput, ini biasanya trade-off yang bagus.

### Aplikasi Java dan group commit

Jika aplikasi membuka terlalu banyak connection dan melakukan banyak transaksi kecil:

```java
for (Command c : commands) {
    service.processOneCommand(c); // each call opens a separate transaction
}
```

Database mungkin melakukan banyak commit kecil. Group commit membantu, tetapi bukan alasan untuk mengabaikan desain batching.

Trade-off:

| Pola | Kelebihan | Risiko |
|---|---|---|
| Satu transaksi per row | sederhana, failure isolated | overhead commit tinggi |
| Satu transaksi sangat besar | commit overhead kecil | lock/undo/redo/replication/rollback besar |
| Chunked transaction | seimbang | butuh idempotency dan progress tracking |

---

## 12. `innodb_flush_log_at_trx_commit`: Durability Redo Log

Variabel `innodb_flush_log_at_trx_commit` mengontrol bagaimana redo log buffer ditulis dan diflush ke disk saat commit.

Nilai umum:

| Nilai | Makna konseptual | Trade-off |
|---|---|---|
| `1` | tulis dan flush redo log saat setiap commit | durabilitas kuat, biaya lebih tinggi |
| `2` | tulis redo log saat commit, flush periodik | lebih cepat, bisa kehilangan transaksi pada OS crash/power loss |
| `0` | tulis dan flush periodik, bukan setiap commit | throughput lebih tinggi, durability lebih lemah |

### Kapan `1` penting?

Gunakan `1` untuk sistem yang tidak boleh kehilangan committed transaction, misalnya:

- ledger;
- regulatory case transition;
- enforcement decision;
- audit log;
- payment state;
- legal notification status;
- idempotency record.

### Kapan orang memilih `2` atau `0`?

Kadang untuk workload yang dapat menerima kehilangan transaksi terakhir jika crash:

- cache-like data;
- analytics staging;
- non-critical batch load;
- ephemeral import yang bisa diulang.

Namun keputusan ini harus eksplisit. Jangan mengubahnya hanya karena ingin benchmark terlihat lebih cepat.

---

## 13. `sync_binlog`: Durability Binary Log

`sync_binlog` mengontrol seberapa sering binary log disinkronkan ke disk.

Nilai penting:

| Nilai | Makna konseptual |
|---|---|
| `1` | sync binlog pada setiap transaction commit/group commit boundary |
| `0` | biarkan OS menangani flush |
| `N > 1` | sync setiap N binary log commit groups/events |

### Kenapa ini penting?

Jika binlog tidak durable tetapi InnoDB commit durable, crash bisa membuat transaksi ada di primary data tetapi hilang dari binlog. Ini berbahaya untuk:

- replication;
- PITR;
- CDC;
- downstream audit;
- failover consistency.

### Durable production pairing

Untuk durability kuat biasanya pasangan yang dipikirkan adalah:

```text
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1
```

Konsekuensinya:

- lebih aman terhadap crash;
- lebih mahal untuk write latency;
- group commit menjadi penting;
- storage latency menjadi faktor besar.

---

## 14. Commit Success, Crash, dan Ambiguitas dari Sisi Client

Dari perspektif aplikasi Java, commit tidak selalu jelas.

Ada beberapa skenario:

### Skenario A — Commit sukses dan response diterima client

```text
DB durable commit
DB sends OK
Client receives OK
```

Aplikasi boleh menganggap transaksi committed.

### Skenario B — Commit gagal sebelum durable

```text
DB fails before commit
Client receives error
```

Aplikasi boleh retry jika operasi idempotent.

### Skenario C — DB commit sukses, network putus sebelum client menerima OK

```text
DB durable commit
DB sends OK
Network fails
Client sees timeout/error
```

Ini disebut **uncertain commit** dari perspektif client.

Aplikasi tidak tahu apakah transaksi committed atau tidak.

### Skenario D — Client timeout, server masih mengeksekusi

```text
Client socket timeout
Application gives up
DB transaction may still be running
DB later commits or rolls back
```

Ini sangat penting untuk desain retry.

---

## 15. Retrying Writes: Wajib Idempotent

Jika aplikasi Java melakukan retry setelah timeout/error tanpa idempotency, kamu bisa membuat duplicate effect.

Contoh buruk:

```java
public void submitComplaint(ComplaintRequest request) {
    jdbc.update("""
        INSERT INTO complaint(subject_id, description, status)
        VALUES (?, ?, 'SUBMITTED')
    """, request.subjectId(), request.description());
}
```

Jika client timeout setelah DB commit, retry bisa membuat complaint ganda.

### Desain lebih aman dengan idempotency key

```sql
CREATE TABLE request_idempotency (
    idempotency_key VARCHAR(128) NOT NULL,
    operation_type VARCHAR(64) NOT NULL,
    resource_id BIGINT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (idempotency_key, operation_type)
) ENGINE=InnoDB;
```

```sql
CREATE TABLE complaint (
    id BIGINT NOT NULL AUTO_INCREMENT,
    subject_id BIGINT NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_complaint_idempotency (idempotency_key)
) ENGINE=InnoDB;
```

Service pattern:

```java
@Transactional
public ComplaintResult submitComplaint(ComplaintRequest request) {
    Optional<Complaint> existing = complaintRepository.findByIdempotencyKey(request.idempotencyKey());
    if (existing.isPresent()) {
        return ComplaintResult.from(existing.get());
    }

    Complaint complaint = new Complaint(
        request.subjectId(),
        request.description(),
        "SUBMITTED",
        request.idempotencyKey()
    );

    complaintRepository.save(complaint);
    auditLogRepository.insert(complaint.id(), "SUBMIT_COMPLAINT");

    return ComplaintResult.from(complaint);
}
```

Idempotency bukan fitur tambahan. Dalam write path nyata, idempotency adalah jawaban aplikasi terhadap uncertain commit.

---

## 16. Generated Keys dan Commit Ambiguity

Masalah umum Java/MySQL:

```java
KeyHolder keyHolder = new GeneratedKeyHolder();
jdbc.update(connection -> {
    PreparedStatement ps = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
    // bind params
    return ps;
}, keyHolder);
```

Jika insert commit berhasil tetapi response hilang, client mungkin tidak tahu generated ID.

Solusi:

1. gunakan business id/idempotency key unik dari client;
2. gunakan generated key sebagai internal surrogate, bukan satu-satunya cara deduplicate;
3. query ulang berdasarkan unique business key setelah timeout;
4. jangan retry blind insert tanpa unique guard.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    external_request_id VARCHAR(128) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_external_request (external_request_id)
) ENGINE=InnoDB;
```

Dengan ini, retry bisa melakukan:

```sql
SELECT id, status
FROM enforcement_case
WHERE external_request_id = ?;
```

---

## 17. Batch Writes: Throughput vs Blast Radius

Batching sering meningkatkan throughput, tetapi batch terlalu besar menciptakan risiko.

### JDBC batch

```java
jdbcTemplate.batchUpdate("""
    INSERT INTO case_audit_log(case_id, actor_id, action, created_at)
    VALUES (?, ?, ?, ?)
""", auditEvents, 500, (ps, event) -> {
    ps.setLong(1, event.caseId());
    ps.setLong(2, event.actorId());
    ps.setString(3, event.action());
    ps.setObject(4, event.createdAt());
});
```

Batch membantu mengurangi round trip dan statement overhead.

Namun batch dalam transaksi besar tetap menghasilkan:

- redo besar;
- undo besar;
- binlog besar;
- lock lebih lama;
- replication lag;
- rollback mahal;
- timeout recovery sulit.

### Chunk sizing heuristic

Tidak ada angka universal. Mulai dari prinsip:

| Faktor | Batch kecil | Batch besar |
|---|---|---|
| Latency per item | lebih tinggi | lebih rendah |
| Lock duration | lebih pendek | lebih panjang |
| Rollback cost | kecil | besar |
| Replication event | kecil | besar |
| Failure isolation | baik | buruk |
| Throughput | bisa rendah | bisa tinggi |

Untuk banyak aplikasi OLTP, chunk 100–1000 row sering menjadi titik awal eksperimen. Tetapi keputusan akhir harus berdasarkan:

- ukuran row;
- index count;
- FK;
- trigger jika ada;
- binlog format;
- replica lag;
- disk latency;
- SLO aplikasi.

---

## 18. Transaction Size: Batas Praktis, Bukan Cuma Batas Teknis

Transaksi besar bukan hanya masalah “apakah MySQL mampu”. Pertanyaan yang benar:

> Jika transaksi ini gagal, crash, timeout, deadlock, atau harus rollback, apakah sistem tetap bisa dipulihkan dengan aman?

### Red flags transaksi terlalu besar

- berjalan menit/jam;
- mengubah ratusan ribu/jutaan row;
- memegang lock range luas;
- menyebabkan replica lag;
- sulit di-retry;
- tidak punya progress marker;
- tidak idempotent;
- rollback-nya lebih mahal daripada forward fix;
- menyatukan DB write dan external side effect.

### Pattern lebih aman: resumable chunked job

```sql
CREATE TABLE job_progress (
    job_name VARCHAR(128) NOT NULL PRIMARY KEY,
    last_processed_id BIGINT NOT NULL,
    updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
```

```java
public void processJob() {
    while (true) {
        JobWindow window = jobRepository.nextWindow("risk-score-backfill", 500);
        if (window.isEmpty()) break;

        processWindowInTransaction(window);
    }
}

@Transactional
public void processWindowInTransaction(JobWindow window) {
    List<CaseEntity> cases = caseRepository.findWindowForUpdate(window.startId(), window.endId());
    for (CaseEntity c : cases) {
        c.recomputeRiskScore();
    }
    jobRepository.markProgress("risk-score-backfill", window.endId());
}
```

Invariants:

- setiap chunk committed secara independen;
- progress disimpan dalam transaksi yang sama;
- job bisa dilanjutkan setelah crash;
- retry aman jika operasi idempotent;
- lock footprint terkendali.

---

## 19. Binlog Format dan Dampaknya

Binary logging bisa berbasis statement, row, atau mixed.

### Statement-based logging

Binlog mencatat statement SQL.

Contoh:

```sql
UPDATE case_queue
SET assigned_to = 42
WHERE status = 'OPEN'
ORDER BY priority DESC
LIMIT 10;
```

Risiko:

- jika statement nondeterministic, replika bisa menghasilkan hasil berbeda;
- bergantung pada data/order/index di replica;
- fungsi waktu/random/user-defined behavior bisa bermasalah.

### Row-based logging

Binlog mencatat perubahan row yang terjadi.

Kelebihan:

- lebih deterministik;
- cocok untuk replication/CDC;
- downstream tahu row mana berubah.

Kekurangan:

- bisa menghasilkan binlog besar untuk update massal;
- membutuhkan perhatian pada replica lag dan binlog storage.

### Mixed

Server memilih statement atau row tergantung konteks.

Untuk banyak sistem produksi modern, row-based lebih mudah dipahami dari sisi correctness walaupun bisa lebih mahal secara ukuran.

---

## 20. Write Amplification

Satu update kecil bisa menyebabkan banyak kerja.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'CLOSED', closed_at = NOW(6)
WHERE id = 1001;
```

Yang mungkin berubah:

- clustered index page;
- secondary index jika indexed column berubah;
- undo log;
- redo log;
- binlog;
- dirty page;
- change buffer untuk secondary index tertentu;
- audit insert jika aplikasi menulis audit;
- CDC downstream;
- replica apply;
- backup/PITR volume.

### Secondary index amplification

Jika `status` ada dalam beberapa secondary index:

```sql
KEY idx_status_created (status, created_at)
KEY idx_tenant_status_updated (tenant_id, status, updated_at)
KEY idx_assignee_status_due (assignee_id, status, due_at)
```

Maka update `status` bukan hanya update row utama. InnoDB juga perlu memperbarui entry index terkait.

Inilah alasan over-indexing membuat write path mahal.

---

## 21. Auto-Increment, Insert Hotspot, dan Commit Throughput

Banyak tabel OLTP memakai:

```sql
id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY
```

Kelebihan:

- clustered insert append-like;
- locality bagus;
- secondary index lebih kecil dibanding UUID string;
- mudah untuk seek pagination.

Trade-off:

- insert hotspot di page kanan B+Tree;
- contention auto-increment pada workload tertentu;
- ID mudah ditebak jika exposed;
- kurang cocok untuk multi-primary generation tanpa strategi tambahan.

Untuk single-primary MySQL OLTP, auto-increment sering masih sangat baik. Untuk distributed ID, pertimbangkan ordered ID seperti time-ordered UUID/ULID/Snowflake-style, tetapi pahami konsekuensi secondary index dan row size seperti Part 003.

---

## 22. Outbox Pattern dan Write Path

Masalah klasik:

```java
@Transactional
public void approveCase(long caseId) {
    caseRepository.markApproved(caseId);
    emailClient.sendApprovalEmail(caseId); // external side effect inside transaction
    auditRepository.insert(caseId, "APPROVED");
}
```

Jika email terkirim tapi transaksi rollback, sistem external melihat efek yang tidak ada di DB.

Jika transaksi commit tapi email gagal, DB state berubah tapi notifikasi tidak terkirim.

### Outbox pattern

Tulis event ke tabel outbox dalam transaksi yang sama dengan state change.

```sql
CREATE TABLE outbox_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    published_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_outbox_status_id (status, id)
) ENGINE=InnoDB;
```

```java
@Transactional
public void approveCase(long caseId, long actorId) {
    CaseEntity c = caseRepository.findByIdForUpdate(caseId);
    c.approve(actorId);

    auditRepository.insert(caseId, actorId, "APPROVED");

    outboxRepository.insert(
        "EnforcementCase",
        caseId,
        "CaseApproved",
        payloadFor(caseId, actorId)
    );
}
```

Kemudian publisher terpisah membaca outbox dan mengirim event.

Keuntungan:

- DB state dan event intent atomic;
- external side effect tidak terjadi di dalam transaksi utama;
- retry publishing bisa idempotent;
- bisa diintegrasikan dengan CDC/binlog;
- auditability lebih baik.

---

## 23. CDC via Binlog vs Polling Outbox

Ada dua pendekatan populer:

### Polling outbox

Aplikasi worker menjalankan query:

```sql
SELECT id, payload
FROM outbox_event
WHERE status = 'PENDING'
ORDER BY id
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Lalu publish dan update status.

Kelebihan:

- mudah dipahami;
- tidak butuh platform CDC;
- kontrol retry eksplisit.

Kekurangan:

- polling load;
- butuh locking hati-hati;
- status update menambah write;
- event delivery latency tergantung polling interval.

### CDC binlog outbox

Debezium atau pipeline CDC membaca binlog dan menangkap insert ke outbox table.

Kelebihan:

- lebih dekat ke commit stream;
- mengurangi polling;
- ordering bisa lebih kuat berdasarkan binlog;
- bagus untuk event-driven architecture.

Kekurangan:

- operasional lebih kompleks;
- perlu memahami binlog retention;
- schema evolution event payload;
- consumer idempotency tetap wajib;
- failover/GTID/topology harus matang.

---

## 24. Locking dan Write Path Tidak Terpisah

Walaupun bagian ini fokus write path, jangan lupa bahwa setiap write juga punya lock footprint.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE tenant_id = 10
  AND due_at < NOW(6)
  AND status = 'OPEN';
```

Jika index buruk, MySQL mungkin scan banyak row dan InnoDB mengambil lock lebih luas.

Dampaknya ke write path:

- transaksi lebih lama;
- undo/redo lebih lama tertahan;
- deadlock risk naik;
- binlog event besar;
- replica lag naik;
- application timeout naik.

Index bukan hanya read optimization. Index juga mengendalikan lock footprint dan write stability.

---

## 25. Foreign Key, Cascades, dan Write Cost

Foreign key membantu integritas, tetapi write path menjadi lebih kompleks.

Saat insert child:

```sql
INSERT INTO case_note(case_id, note)
VALUES (1001, '...');
```

InnoDB harus memastikan parent `case_id = 1001` ada.

Saat delete parent:

```sql
DELETE FROM enforcement_case
WHERE id = 1001;
```

Jika ada child, tergantung constraint:

- reject;
- cascade delete;
- set null;
- restrict/no action.

### Risiko cascade besar

```sql
DELETE FROM enforcement_case WHERE id = ?;
```

Bisa diam-diam menyebabkan delete ribuan child rows.

Konsekuensi:

- undo/redo besar;
- binlog besar;
- lock banyak tabel;
- replication lag;
- rollback mahal;
- audit sulit jika tidak eksplisit.

Untuk sistem regulatory/case-management, hard delete cascade biasanya harus sangat dibatasi. Soft delete atau explicit archival workflow sering lebih defensible.

---

## 26. Observability Write Path

Untuk memahami write pressure, perhatikan beberapa dimensi:

### 26.1 Transaction metrics

Yang ingin dilihat:

- transaction duration;
- commit latency;
- rollback count;
- deadlock count;
- lock wait;
- rows changed per transaction;
- transaction retry rate.

### 26.2 Redo/log metrics

Yang ingin dilihat:

- redo generated per second;
- checkpoint age;
- log waits;
- fsync latency;
- dirty page percentage.

### 26.3 Binlog/replication metrics

Yang ingin dilihat:

- binlog size growth;
- replica lag;
- relay log apply rate;
- transaction apply latency;
- CDC lag.

### 26.4 App-side metrics

Dari Java:

- JDBC execute time;
- commit time;
- connection acquisition time;
- pool active/idle/pending;
- socket timeout;
- SQLState/vendor error codes;
- retry count;
- idempotency conflict count;
- outbox pending age.

Yang sering dilupakan: commit time harus diukur. Banyak tracing hanya mengukur query execution, padahal latency bisa muncul saat commit flush/sync.

---

## 27. Failure Mode: Disk Latency Naik

Gejala:

- commit latency naik;
- write QPS turun;
- Hikari connection active penuh;
- request timeout;
- CPU DB tidak selalu tinggi;
- replication lag bisa naik;
- slow query log mungkin tidak menunjukkan SELECT berat.

Kemungkinan penyebab:

- storage fsync latency meningkat;
- redo flush lambat;
- binlog sync lambat;
- checkpoint pressure;
- dirty page flushing tertinggal;
- cloud volume throttling;
- noisy neighbor;
- backup bersaing I/O.

Tindakan diagnosis:

1. ukur commit latency dari app;
2. cek DB I/O metrics;
3. cek redo/binlog fsync-related waits;
4. cek dirty page dan checkpoint pressure;
5. cek binlog size dan replica lag;
6. cek apakah ada batch job besar;
7. cek storage burst credit/throttle jika cloud.

---

## 28. Failure Mode: Replica Lag Setelah Batch Update

Skenario:

```sql
UPDATE enforcement_case
SET risk_band = 'HIGH'
WHERE risk_score >= 80;
```

Jika menyentuh 2 juta row, primary mungkin selesai, tetapi replica perlu apply perubahan besar.

Dampak:

- read replica stale;
- UI yang membaca replica melihat status lama;
- CDC downstream tertunda;
- reporting salah sementara;
- failover ke replica lagging berbahaya.

Mitigasi:

- chunk update berdasarkan primary key;
- pantau replica lag antar chunk;
- throttling;
- batasi read/write split untuk data kritis;
- jadwalkan migration/backfill;
- simulasikan di staging dengan data volume realistis.

Contoh chunk:

```sql
UPDATE enforcement_case
SET risk_band = 'HIGH'
WHERE id > ?
  AND id <= ?
  AND risk_score >= 80;
```

---

## 29. Failure Mode: Disk Full karena Binlog atau Undo Growth

### Binlog growth

Jika replication/CDC down, binlog bisa tertahan karena masih dibutuhkan consumer/replica.

Gejala:

- disk usage naik;
- binlog files menumpuk;
- replica disconnected;
- backup/PITR retention bertambah;
- MySQL bisa berhenti menerima writes jika disk penuh.

### Undo growth

Jika long-running transaction menahan purge, undo bisa tumbuh.

Gejala:

- history list length naik;
- tablespace/undo tablespace membesar;
- performance turun;
- purge lag.

Mitigasi:

- deteksi transaksi lama;
- batasi transaction timeout;
- jangan streaming report dalam transaksi panjang;
- monitor binlog retention;
- pastikan CDC/replica health;
- disk alert sebelum penuh;
- chunking untuk job besar.

---

## 30. Configuration Trade-off Matrix

| Goal | Setting/Design | Trade-off |
|---|---|---|
| Durability kuat | `innodb_flush_log_at_trx_commit=1` | commit lebih mahal |
| Binlog durable | `sync_binlog=1` | binlog fsync lebih sering |
| Throughput tinggi | group commit, batching | latency/complexity bisa berubah |
| Write latency stabil | storage rendah latency, checkpoint terkendali | biaya infra |
| Crash recovery cepat | redo/dirty page terkendali | perlu tuning dan workload discipline |
| Replica lag rendah | transaksi kecil/chunked | batch job lebih lama |
| Retry aman | idempotency key/unique constraint | desain API lebih eksplisit |
| External consistency | outbox | perlu publisher/CDC |

---

## 31. Java Checklist untuk Write Path

Gunakan checklist ini saat mendesain command/write use case.

### 31.1 Transaction boundary

Tanyakan:

- Apakah transaksi hanya mencakup DB work?
- Apakah ada call HTTP/message broker/file I/O di dalam transaksi?
- Apakah transaksi bisa berjalan lama?
- Apakah jumlah row yang disentuh bounded?
- Apakah ada retry?
- Apakah retry idempotent?

### 31.2 SQL shape

Tanyakan:

- Apakah `UPDATE/DELETE` memakai predicate indexed?
- Apakah ada range luas?
- Apakah query deterministic?
- Apakah ada `ORDER BY/LIMIT` untuk queue semantics?
- Apakah locking sudah eksplisit bila perlu?

### 31.3 Schema/index

Tanyakan:

- Berapa secondary index yang ikut berubah?
- Apakah update menyentuh indexed column?
- Apakah FK cascade bisa memperbesar write?
- Apakah row terlalu besar?
- Apakah JSON/BLOB ikut sering di-update?

### 31.4 Failure recovery

Tanyakan:

- Kalau commit uncertain, bagaimana client reconcile?
- Apakah ada unique business key?
- Apakah generated ID bisa ditemukan ulang?
- Apakah side effect external tertunda via outbox?
- Apakah job batch bisa resume?

### 31.5 Observability

Tanyakan:

- Apakah commit latency diukur?
- Apakah retry count diukur?
- Apakah idempotency duplicate diukur?
- Apakah outbox lag diukur?
- Apakah replica lag memengaruhi read path?

---

## 32. Case Study: Approve Enforcement Action

### Requirement

Saat officer menyetujui enforcement action:

1. case status berubah dari `UNDER_REVIEW` ke `APPROVED`;
2. action record dibuat;
3. audit log dibuat;
4. notification event harus dikirim;
5. request retry tidak boleh membuat approval ganda;
6. read-your-writes harus benar untuk layar konfirmasi.

### Schema simplified

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL AUTO_INCREMENT,
    status VARCHAR(32) NOT NULL,
    version BIGINT NOT NULL,
    approved_at DATETIME(6) NULL,
    approved_by BIGINT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_status_updated (status, updated_at)
) ENGINE=InnoDB;

CREATE TABLE enforcement_action (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_action_idempotency (idempotency_key),
    KEY idx_action_case (case_id),
    CONSTRAINT fk_action_case FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE=InnoDB;

CREATE TABLE case_audit_log (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    actor_id BIGINT NOT NULL,
    action VARCHAR(128) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_audit_case_id (case_id, id)
) ENGINE=InnoDB;

CREATE TABLE outbox_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_outbox_status_id (status, id)
) ENGINE=InnoDB;
```

### Java service

```java
@Transactional
public ApproveResult approve(ApproveCommand command) {
    Optional<EnforcementAction> existing =
        actionRepository.findByIdempotencyKey(command.idempotencyKey());

    if (existing.isPresent()) {
        return actionRepository.toApproveResult(existing.get());
    }

    EnforcementCase c = caseRepository.findByIdForUpdate(command.caseId())
        .orElseThrow(() -> new NotFoundException("case not found"));

    c.approve(command.actorId());

    EnforcementAction action = actionRepository.insert(
        command.caseId(),
        "APPROVE",
        command.idempotencyKey()
    );

    auditRepository.insert(
        command.caseId(),
        command.actorId(),
        "CASE_APPROVED"
    );

    outboxRepository.insert(
        "EnforcementCase",
        command.caseId(),
        "CaseApproved",
        Map.of(
            "caseId", command.caseId(),
            "actorId", command.actorId(),
            "actionId", action.id()
        )
    );

    return new ApproveResult(command.caseId(), action.id(), "APPROVED");
}
```

### Write path behavior

This single transaction creates:

- undo records for case status update;
- redo for modified clustered/secondary index pages;
- redo for new action/audit/outbox rows;
- binlog transaction event;
- dirty pages in buffer pool;
- lock on case row;
- FK parent check;
- unique check on idempotency key.

### Why this is robust

- Retry guarded by `idempotency_key`.
- External notification not sent inside transaction.
- Outbox event committed atomically with case state.
- `FOR UPDATE` prevents concurrent double transition.
- Audit log is part of same atomic DB state.
- Generated action ID can be rediscovered by idempotency key.

---

## 33. Common Misconceptions

### Misconception 1: “Commit means row page is already in table file.”

Not necessarily. Commit means changes are recoverable under the configured durability policy. Dirty pages can flush later.

### Misconception 2: “Redo log and binlog are the same.”

No. Redo is for InnoDB crash recovery. Binlog is for replication/PITR/CDC.

### Misconception 3: “If query succeeded but client timed out, transaction failed.”

Not guaranteed. It may have committed and the response was lost.

### Misconception 4: “Batch larger is always faster.”

Batch larger can improve throughput until it creates lock, redo, undo, binlog, replication, or rollback pressure.

### Misconception 5: “Durability settings are just DBA concerns.”

Wrong. Durability settings determine whether application-level promises are true after crash.

### Misconception 6: “Outbox is only for microservices.”

Outbox is also useful in monoliths whenever DB state and external side effect must be coordinated.

---

## 34. Practical Lab

### Lab 1 — Observe commit latency

Create a table:

```sql
CREATE TABLE write_test (
    id BIGINT NOT NULL AUTO_INCREMENT,
    payload VARCHAR(500) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB;
```

Run small transactions:

```sql
START TRANSACTION;
INSERT INTO write_test(payload, created_at) VALUES (REPEAT('x', 200), NOW(6));
COMMIT;
```

Measure from application:

- execute time;
- commit time;
- total transaction time.

### Lab 2 — Compare one huge transaction vs chunked transaction

Huge:

```sql
START TRANSACTION;
UPDATE write_test SET payload = REPEAT('y', 200);
COMMIT;
```

Chunked:

```sql
UPDATE write_test
SET payload = REPEAT('z', 200)
WHERE id BETWEEN ? AND ?;
```

Observe:

- lock duration;
- binlog growth;
- replica lag if replica exists;
- rollback behavior if killed;
- application timeout.

### Lab 3 — Simulate uncertain commit

From application:

1. set low socket timeout;
2. execute transaction with artificial delay;
3. cause client timeout;
4. query by idempotency key;
5. verify whether commit happened.

Learning:

> The application must reconcile state, not assume timeout means rollback.

### Lab 4 — Observe effect of secondary indexes

Create table with one index, then with five indexes. Run same update workload.

Measure:

- rows/sec;
- redo generated;
- CPU;
- IO;
- binlog size;
- commit latency.

Learning:

> Every index is a write-path tax.

---

## 35. Production Review Template

Gunakan template ini saat review fitur write-heavy.

```text
Feature:
Owner:
Tables affected:
Expected write QPS:
Peak write QPS:
Rows changed per transaction:
Transaction duration target:
Retry behavior:
Idempotency key:
External side effects:
Outbox needed:
Binlog/CDC consumers:
Replica read impact:
Backfill/migration needed:
Rollback strategy:
Monitoring added:
Alerts added:
Runbook updated:
```

Decision questions:

```text
1. What happens if client times out after DB commit?
2. What happens if DB crashes during commit?
3. What happens if replica lags 10 minutes?
4. What happens if outbox publisher is down?
5. What happens if batch job is killed halfway?
6. What happens if duplicate request arrives?
7. What happens if rollback takes longer than forward fix?
8. What happens if binlog disk grows unexpectedly?
```

---

## 36. Key Takeaways

1. MySQL write path is log-centric, not direct-page-write-per-commit.
2. Undo log supports rollback and MVCC.
3. Redo log supports crash recovery.
4. Binary log supports replication, PITR, and CDC.
5. Doublewrite buffer protects against torn page during page flushing.
6. Commit latency is heavily influenced by redo/binlog flush policy and storage latency.
7. `innodb_flush_log_at_trx_commit=1` and `sync_binlog=1` are common durability-oriented settings, but they have throughput cost.
8. Dirty pages can flush after commit; durability comes from logs.
9. Large transactions are operationally dangerous even if technically valid.
10. Java retry logic must handle uncertain commit.
11. Idempotency key and unique constraints are core write-path design tools.
12. Outbox pattern connects DB atomicity with external side effects safely.
13. Every secondary index increases write amplification.
14. Replication lag is often created by write shape, not only infrastructure.
15. Top-tier MySQL engineering means designing writes for correctness, recovery, replication, and operations—not just “successful INSERT”.

---

## 37. References

- MySQL 8.4 Reference Manual — InnoDB Redo Log: `https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html`
- MySQL 8.4 Reference Manual — InnoDB and the ACID Model: `https://dev.mysql.com/doc/refman/8.4/en/mysql-acid.html`
- MySQL 8.4 Reference Manual — Binary Logging Options and Variables: `https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html`
- MySQL 8.4 Reference Manual — InnoDB Recovery: `https://dev.mysql.com/doc/refman/8.4/en/innodb-recovery.html`
- MySQL Reference Manual — Doublewrite Buffer: `https://dev.mysql.com/doc/refman/9.3/en/innodb-doublewrite-buffer.html`

---

## 38. Penutup Part 017

Part ini membangun mental model write path: bagaimana InnoDB membuat perubahan durable tanpa harus langsung menulis seluruh data page ke lokasi final, bagaimana binlog membuat perubahan bisa direplikasi, dan bagaimana aplikasi Java harus mendesain retry, batch, idempotency, dan outbox dengan sadar terhadap failure mode.

Bagian berikutnya:

```text
learn-mysql-mastery-for-java-engineers-part-018.md
```

Topik:

```text
Buffer Pool, Memory, and I/O Behavior
```

Kita akan masuk lebih dalam ke memory/I/O: buffer pool, dirty page flushing, read-ahead, adaptive hash index, change buffer, temporary memory, per-connection buffers, working set, dan hubungan langsung dengan sizing connection pool Java.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — JDBC, Connector/J, HikariCP, and MySQL Protocol Details</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-018.md">Part 018 — Buffer Pool, Memory, and I/O Behavior ➡️</a>
</div>
