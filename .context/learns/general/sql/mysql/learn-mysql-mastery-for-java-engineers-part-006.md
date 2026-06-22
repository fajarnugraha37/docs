# learn-mysql-mastery-for-java-engineers-part-006.md

# Part 006 — InnoDB MVCC: Read Views, Undo Logs, and Consistent Reads

## Status Seri

- Seri: `learn-mysql-mastery-for-java-engineers`
- Part: `006 / 034`
- Topik: **InnoDB MVCC: Read Views, Undo Logs, and Consistent Reads**
- Status seri: **belum selesai**
- Bagian sebelumnya: `part-005` — Character Sets, Collations, and Text Comparison Bugs
- Bagian berikutnya: `part-007` — Isolation Levels in MySQL: Repeatable Read Is Not What Many Think

---

# 1. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas sesuatu yang terlihat sederhana, yaitu teks: character set, collation, comparison semantics, dan dampaknya ke correctness. Sekarang kita masuk ke salah satu fondasi terdalam InnoDB: **MVCC**.

MVCC adalah alasan kenapa MySQL/InnoDB bisa menjalankan banyak transaksi secara bersamaan tanpa setiap pembaca harus memblokir penulis dan tanpa setiap penulis harus memblokir pembaca.

Namun MVCC juga menjadi sumber banyak miskonsepsi:

- “Kalau SELECT tidak lock, berarti tidak ada efek ke database.”
- “Repeatable Read berarti semua query selalu melihat data terbaru dalam transaksi.”
- “Long-running read transaction aman karena cuma baca.”
- “Undo log hanya dipakai untuk rollback.”
- “Deadlock hanya terjadi karena dua UPDATE saling tabrakan.”
- “Kalau tidak ada explicit transaction di kode Java, berarti tidak ada transaction.”

Semua asumsi itu bisa salah dalam kondisi production.

Bagian ini bertujuan membangun mental model yang cukup kuat untuk menjawab pertanyaan berikut:

1. Saat transaksi membaca row, versi row mana yang dilihat?
2. Bagaimana InnoDB menjaga snapshot lama?
3. Apa itu read view?
4. Apa hubungan undo log dengan consistent read?
5. Kenapa transaksi read-only yang panjang bisa merusak performa sistem?
6. Apa bedanya consistent read dan current read?
7. Bagaimana pola `@Transactional` di Java bisa menyebabkan masalah MVCC?
8. Apa gejala production yang menunjukkan MVCC/undo/purge bermasalah?

---

# 2. Mental Model Singkat

Bayangkan sebuah row bukan sebagai satu nilai tunggal, tetapi sebagai **rantai versi waktu**.

Ketika row diubah:

- versi baru ditulis ke data page,
- versi lama tidak langsung hilang,
- informasi untuk merekonstruksi versi lama disimpan di undo log,
- transaksi pembaca memilih versi yang cocok dengan snapshot-nya.

Secara konseptual:

```text
Current row version
        |
        v
+-------------------+
| id = 10           |
| status = CLOSED   |
| trx_id = 200      |
| roll_ptr -> undo  |
+-------------------+
        |
        v
Undo version
+-------------------+
| status = REVIEW   |
| trx_id = 150      |
| roll_ptr -> undo  |
+-------------------+
        |
        v
Older undo version
+-------------------+
| status = OPEN     |
| trx_id = 90       |
+-------------------+
```

Pembaca tidak selalu membaca versi paling baru. Pembaca membaca versi yang **visible** menurut read view transaksi tersebut.

Inti MVCC:

> InnoDB tidak hanya menyimpan “data saat ini”, tetapi juga cukup informasi historis untuk membuat pembaca lama tetap bisa melihat snapshot yang konsisten.

---

# 3. Kenapa MVCC Dibutuhkan?

Tanpa MVCC, ada dua pendekatan ekstrem:

## 3.1 Semua pembaca lock row

Jika setiap `SELECT` mengambil shared lock, maka:

- pembaca bisa memblokir penulis,
- penulis bisa memblokir pembaca,
- throughput turun drastis,
- dashboard/reporting bisa mengganggu transaksi bisnis.

Untuk workload OLTP modern, ini buruk.

## 3.2 Semua pembaca membaca data terbaru tanpa snapshot

Jika setiap `SELECT` selalu membaca versi paling baru tanpa snapshot:

- satu transaksi bisa melihat data berubah-ubah di tengah eksekusi,
- agregasi bisa tidak konsisten,
- business rule bisa mengambil keputusan dari campuran state lama dan baru.

Contoh:

```text
T1: mulai membuat laporan jumlah case OPEN dan CLOSED
T2: memindahkan 100 case dari OPEN ke CLOSED
T1: membaca OPEN sebelum perubahan, membaca CLOSED setelah perubahan
```

Hasil laporan bisa double-count atau inconsistent.

MVCC memberi kompromi:

- pembaca biasa tidak memblokir penulis,
- penulis tidak memblokir pembaca biasa,
- pembaca tetap mendapat snapshot konsisten.

---

# 4. Komponen Utama MVCC InnoDB

Untuk memahami MVCC, ada beberapa komponen penting:

1. **Transaction ID**
2. **Hidden row fields**
3. **Undo log**
4. **Read view**
5. **Consistent read**
6. **Current read**
7. **Purge**

Kita bahas satu per satu.

---

# 5. Transaction ID

Setiap transaksi yang memodifikasi data memiliki identifier internal. Secara konseptual, kita bisa menyebutnya `trx_id`.

Ketika transaksi mengubah row, row tersebut diberi informasi transaksi terakhir yang mengubahnya.

Misalnya:

```text
Row case_id = 1001
status = 'UNDER_REVIEW'
last modified by trx_id = 5421
```

Saat transaksi lain membaca row ini, InnoDB menilai:

> Apakah perubahan oleh transaksi 5421 visible untuk pembaca ini?

Jawabannya bergantung pada read view.

---

# 6. Hidden Fields pada InnoDB Row

InnoDB menyimpan beberapa metadata tersembunyi pada row. Secara mental, row berisi:

```text
+----------------------+-------------------------+
| User columns         | Hidden InnoDB metadata  |
+----------------------+-------------------------+
| case_id              | transaction id          |
| status               | roll pointer            |
| assignee_id          | internal row id*        |
| created_at           |                         |
+----------------------+-------------------------+
```

Catatan:

- Jika table memiliki primary key, primary key menjadi clustered key.
- Jika tidak ada primary key, InnoDB perlu internal row identifier.
- `roll pointer` mengarah ke undo record yang bisa digunakan untuk menemukan versi lama row.

Untuk Java engineer, ini penting karena desain table tidak netral. Pilihan primary key, ukuran row, dan update pattern memengaruhi bagaimana InnoDB menyimpan dan merekonstruksi versi.

---

# 7. Undo Log

Undo log sering dijelaskan sebagai log untuk rollback. Itu benar, tetapi tidak lengkap.

Undo log dipakai untuk dua hal besar:

1. **Rollback**
   - jika transaksi gagal, perubahan bisa dibatalkan.
2. **Consistent read**
   - jika transaksi lama perlu melihat versi lama row, InnoDB bisa merekonstruksi row dari undo records.

Jadi undo log bukan sekadar “catatan pembatalan”. Ia adalah fondasi historical visibility untuk MVCC.

## 7.1 Contoh UPDATE

Data awal:

```sql
case_id = 1001, status = 'OPEN'
```

Transaksi T10 menjalankan:

```sql
UPDATE cases
SET status = 'UNDER_REVIEW'
WHERE case_id = 1001;
```

Secara konseptual:

```text
Current row:
case_id = 1001
status = 'UNDER_REVIEW'
trx_id = T10
roll_ptr -> undo record

Undo record:
previous status = 'OPEN'
previous trx_id = T5
```

Jika transaksi lama T8 punya snapshot sebelum T10 commit, T8 masih bisa melihat status `OPEN`.

---

# 8. Read View

Read view adalah struktur yang menentukan transaksi mana yang visible dan mana yang tidak visible untuk consistent read.

Secara konseptual, read view berisi informasi seperti:

- transaksi aktif saat snapshot dibuat,
- batas bawah transaction ID,
- batas atas transaction ID,
- identitas transaksi pembaca.

Kita tidak perlu menghafal detail internal field-nya untuk semua kasus. Yang penting adalah mental model berikut:

> Read view adalah “daftar aturan visibilitas” yang dipakai InnoDB untuk menentukan apakah suatu versi row boleh terlihat oleh transaksi pembaca.

## 8.1 Contoh Timeline

```text
T100 starts
T101 starts
T102 starts

T101 updates case 10 from OPEN to CLOSED
T103 starts
T101 commits
```

Jika T100 membuat snapshot sebelum T101 commit, maka T100 tidak otomatis melihat perubahan T101 pada consistent read.

Jika T103 mulai setelah T101 commit, maka T103 biasanya bisa melihat perubahan T101.

Namun detailnya bergantung isolation level dan kapan read view dibuat.

---

# 9. Consistent Read

Consistent read adalah pembacaan snapshot.

Query seperti ini biasanya consistent read:

```sql
SELECT * FROM cases WHERE case_id = 1001;
```

Pada consistent read:

- tidak mengambil row lock untuk row yang dibaca,
- tidak menunggu writer yang belum commit dalam banyak kasus,
- membaca versi row yang sesuai snapshot,
- bisa membaca versi lama melalui undo log.

## 9.1 Kenapa SELECT Bisa Tidak Melihat Data Terbaru?

Karena yang dicari bukan “data terbaru”, tetapi “data yang konsisten terhadap snapshot”.

Contoh:

```sql
-- T1
START TRANSACTION;
SELECT status FROM cases WHERE case_id = 1001;
-- hasil: OPEN

-- T2
UPDATE cases SET status = 'CLOSED' WHERE case_id = 1001;
COMMIT;

-- T1
SELECT status FROM cases WHERE case_id = 1001;
-- pada REPEATABLE READ, hasil tetap bisa: OPEN
```

Ini bukan bug. Ini perilaku snapshot.

---

# 10. Current Read

Tidak semua read adalah consistent read.

Beberapa query perlu membaca versi terbaru yang committed atau versi yang sedang dikunci untuk tujuan modifikasi. Ini disebut current read.

Contoh current read:

```sql
SELECT * FROM cases WHERE case_id = 1001 FOR UPDATE;
```

```sql
SELECT * FROM cases WHERE case_id = 1001 FOR SHARE;
```

```sql
UPDATE cases SET status = 'CLOSED' WHERE case_id = 1001;
```

```sql
DELETE FROM cases WHERE case_id = 1001;
```

Pada current read:

- InnoDB harus membaca versi terbaru yang relevan,
- bisa mengambil lock,
- bisa menunggu transaksi lain,
- bisa menyebabkan deadlock,
- visibility behavior berbeda dari consistent read.

## 10.1 Consistent Read vs Current Read

| Aspek | Consistent Read | Current Read |
|---|---:|---:|
| Contoh | plain `SELECT` | `SELECT ... FOR UPDATE`, `UPDATE`, `DELETE` |
| Membaca snapshot? | Ya | Tidak secara sama |
| Mengambil row lock? | Umumnya tidak | Ya |
| Bisa menunggu lock? | Umumnya tidak | Ya |
| Cocok untuk laporan? | Ya | Tidak selalu |
| Cocok untuk decision-before-write? | Tidak selalu | Ya, jika butuh guard konkuren |

---

# 11. Contoh Penting: Business Decision dari Snapshot Lama

Misalnya ada aturan:

> Case hanya boleh dieskalasi jika status saat ini masih `UNDER_REVIEW`.

Kode naif:

```java
@Transactional
public void escalate(long caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();

    if (!c.getStatus().equals(Status.UNDER_REVIEW)) {
        throw new IllegalStateException("Case cannot be escalated");
    }

    c.setStatus(Status.ESCALATED);
}
```

Pada kondisi konkuren, plain SELECT bisa membaca snapshot yang tidak cukup kuat untuk guard update, tergantung isolation dan timing.

Alternatif lebih aman:

```sql
SELECT *
FROM cases
WHERE case_id = ?
FOR UPDATE;
```

Atau lebih baik dalam banyak kasus:

```sql
UPDATE cases
SET status = 'ESCALATED', version = version + 1
WHERE case_id = ?
  AND status = 'UNDER_REVIEW';
```

Lalu aplikasi mengecek affected row:

```text
affected rows = 1 -> transition berhasil
affected rows = 0 -> state sudah berubah / tidak memenuhi guard
```

Mental model:

> Untuk keputusan bisnis yang harus benar terhadap state terbaru, plain snapshot read sering tidak cukup. Gunakan locking read, conditional update, optimistic versioning, atau unique constraint sebagai concurrency control.

---

# 12. REPEATABLE READ dan Read View

MySQL InnoDB default isolation level secara umum adalah `REPEATABLE READ`.

Pada `REPEATABLE READ`, consistent read dalam satu transaksi cenderung memakai snapshot yang sama setelah snapshot dibuat.

Contoh:

```sql
-- T1
START TRANSACTION;
SELECT status FROM cases WHERE case_id = 1;
-- OPEN

-- T2
UPDATE cases SET status = 'CLOSED' WHERE case_id = 1;
COMMIT;

-- T1
SELECT status FROM cases WHERE case_id = 1;
-- tetap OPEN untuk consistent read
```

Ini membuat laporan lebih stabil, tapi bisa mengejutkan developer yang mengharapkan query kedua melihat update terbaru.

Pada `READ COMMITTED`, setiap consistent read dapat membuat read view baru, sehingga query kedua bisa melihat commit yang terjadi setelah query pertama.

Kita akan bahas isolation level lebih dalam di part berikutnya.

---

# 13. MVCC dan Long-Running Transaction

Salah satu konsekuensi paling penting:

> Selama masih ada transaksi lama yang membutuhkan snapshot lama, InnoDB tidak bebas menghapus semua undo record lama.

Contoh:

```text
08:00 T1 starts transaction
08:01 T1 SELECT large report
08:02 T2..T999 update millions of rows
08:30 T1 masih belum commit/rollback
```

Selama T1 masih aktif dan read view-nya membutuhkan versi lama, purge tidak bisa membersihkan semua versi lama yang mungkin masih diperlukan T1.

Akibat:

- undo history tumbuh,
- purge tertahan,
- storage bertambah,
- query yang perlu mencari versi lama menjadi lebih mahal,
- buffer pool tertekan,
- write workload bisa melambat,
- recovery behavior bisa terdampak.

## 13.1 “Tapi Transaksinya Cuma Read-Only”

Itu tetap bisa menjadi masalah.

Read-only transaction panjang bisa menahan purge karena ia mempertahankan snapshot lama.

Masalah umum di Java:

```java
@Transactional(readOnly = true)
public Stream<Case> exportCases() {
    return caseRepository.streamAllCases();
}
```

Jika stream dikonsumsi lama, koneksi dan transaksi bisa tetap terbuka lama.

Lebih buruk lagi jika:

- result dikirim pelan ke client HTTP,
- export file besar dibuat dalam transaksi,
- ada network delay,
- ada processing eksternal di tengah transaksi.

---

# 14. Purge Process

Purge adalah proses internal yang membersihkan versi lama yang sudah tidak diperlukan lagi.

Secara sederhana:

```text
UPDATE/DELETE membuat undo records
        |
        v
Transaksi lama mungkin masih butuh undo records
        |
        v
Setelah tidak ada snapshot yang butuh
        |
        v
Purge bisa membersihkan versi lama
```

Jika purge tertinggal, history list bisa tumbuh.

Gejala yang mungkin muncul:

- undo tablespace membesar,
- disk usage meningkat,
- query makin lambat karena harus melewati banyak versi,
- checkpoint/flushing pressure meningkat,
- performa write turun,
- monitoring menunjukkan history list length tinggi.

---

# 15. History List Length

History list length adalah salah satu indikator penting untuk melihat apakah purge tertinggal.

Secara mental:

> History list length tinggi berarti ada banyak undo history yang belum bisa/sempat dipurge.

Penyebab umum:

1. Long-running transaction
2. Workload update/delete sangat berat
3. Purge tidak mampu mengejar write rate
4. Replica atau backup process tertentu menahan snapshot
5. Aplikasi membuka transaksi lalu idle
6. Report/export query berjalan terlalu lama dalam transaction

Checklist awal saat history list length naik:

- Apakah ada transaksi aktif lama?
- Apakah ada session idle in transaction?
- Apakah ada job batch/export yang membuka transaction terlalu luas?
- Apakah ada migration/backfill besar?
- Apakah purge thread tertinggal karena I/O pressure?
- Apakah ada delete besar tanpa batching?

---

# 16. Java Transaction Mistakes yang Merusak MVCC

## 16.1 Transaction Terlalu Luas

Contoh buruk:

```java
@Transactional
public void approveCase(long caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    riskService.callExternalRiskApi(c);       // network call
    documentService.generatePdf(c);           // CPU / IO work
    notificationService.sendEmail(c);         // external side effect
    c.approve();
}
```

Masalah:

- koneksi database ditahan terlalu lama,
- snapshot/lock bisa hidup terlalu lama,
- external API latency memperpanjang transaksi,
- error di akhir bisa rollback DB tetapi email mungkin sudah terkirim,
- throughput turun.

Lebih baik:

```text
1. Baca data minimal
2. Commit/close transaction
3. Panggil external service jika tidak perlu lock DB
4. Buka transaction pendek untuk state transition
5. Tulis outbox event untuk side effect
6. Worker mengirim email/notifikasi setelah commit
```

## 16.2 Idle Transaction karena Exception Handling Buruk

Contoh:

```java
Connection conn = dataSource.getConnection();
conn.setAutoCommit(false);

try {
    // query
    // some code
} catch (Exception e) {
    log.error("failed", e);
    // lupa rollback
}
// lupa close
```

Pada framework modern ini lebih jarang, tetapi masih bisa terjadi di kode manual JDBC, migration script, batch job, atau test utility.

Dampak:

- connection leak,
- transaction tetap aktif,
- snapshot lama tertahan,
- lock bisa tertahan,
- pool habis.

## 16.3 Streaming Result Terlalu Lama

Contoh:

```java
@Transactional(readOnly = true)
public void exportAllCases(OutputStream out) {
    try (Stream<Case> stream = repository.streamAll()) {
        stream.forEach(case -> writeCsv(out, case));
    }
}
```

Jika `writeCsv` lambat atau client lambat membaca response, transaksi bisa terbuka sepanjang export.

Alternatif:

- pagination berbasis keyset,
- chunked transaction,
- snapshot table/reporting replica,
- asynchronous export job,
- materialized export result,
- batasi ukuran export,
- gunakan dedicated reporting path.

## 16.4 Transaction Membungkus Loop Besar

Contoh buruk:

```java
@Transactional
public void closeExpiredCases() {
    List<Case> cases = repository.findExpiredCases();
    for (Case c : cases) {
        c.close();
        auditRepository.save(Audit.closed(c));
    }
}
```

Masalah:

- transaksi besar,
- undo besar,
- lock lama,
- rollback mahal,
- replication lag bisa meningkat,
- deadlock impact lebih besar.

Alternatif:

```text
Process in bounded chunks:
- ambil N row
- update dengan conditional predicate
- commit
- repeat
```

---

# 17. Auto-Commit dan Transaksi Implisit

Di MySQL, jika autocommit aktif, setiap statement biasanya menjadi transaksi sendiri.

Contoh:

```sql
UPDATE cases SET status = 'CLOSED' WHERE case_id = 1;
```

Dengan autocommit aktif:

```text
START implicit transaction
execute update
COMMIT
```

Namun ketika aplikasi/framework membuka transaksi:

```java
@Transactional
public void serviceMethod() {
    repository.updateA();
    repository.updateB();
    repository.updateC();
}
```

Maka beberapa statement berada dalam satu transaksi.

Yang perlu dipahami:

- tidak menulis `START TRANSACTION` bukan berarti tidak ada transaction,
- framework bisa mengatur autocommit,
- connection pool mengembalikan connection ke pool dan harus mereset state,
- session state yang bocor bisa menyebabkan bug sulit.

---

# 18. Consistent Read Tidak Sama dengan Lock-Free Secara Total

Plain SELECT consistent read umumnya tidak mengambil row lock. Tetapi bukan berarti query itu “gratis”.

Query read besar tetap bisa:

- mengonsumsi CPU,
- membaca banyak page,
- menekan buffer pool,
- memakai temporary table,
- membuat read view,
- mempertahankan snapshot jika dalam transaksi,
- menahan purge jika transaction lama.

Jadi istilah “read-only” tidak boleh diterjemahkan sebagai “tidak berdampak”.

Dalam production OLTP:

> Read workload yang buruk bisa merusak write workload melalui I/O, memory, CPU, dan MVCC history pressure.

---

# 19. Consistent Read dan DELETE

Misalnya row dihapus oleh transaksi baru, tetapi transaksi lama masih melihat snapshot sebelum delete.

Timeline:

```text
T1 starts and reads case 1001
T2 deletes case 1001 and commits
T1 reads case 1001 again
```

Pada repeatable snapshot, T1 masih bisa melihat row itu karena InnoDB dapat merekonstruksi versi lama dari undo.

Secara fisik, row yang di-delete tidak selalu langsung hilang. Ia bisa ditandai delete-marked dan dibersihkan kemudian oleh purge setelah tidak dibutuhkan snapshot lama.

Dampaknya:

- DELETE besar tidak langsung mengembalikan semua space,
- purge perlu bekerja,
- long-running transaction bisa membuat deleted rows tetap “hidup secara historis”,
- table bloat/fragmentation bisa muncul sebagai efek operasional.

---

# 20. MVCC dan UPDATE Berulang pada Row yang Sama

Jika row yang sama diupdate berkali-kali, undo chain bisa panjang.

Contoh:

```text
status = OPEN
  -> UNDER_REVIEW
  -> WAITING_DOCUMENT
  -> UNDER_REVIEW
  -> ESCALATED
  -> CLOSED
```

Jika ada transaksi lama yang masih membutuhkan versi awal, InnoDB mungkin perlu mempertahankan beberapa versi historis.

Dalam sistem workflow/case management, row status yang sering berubah bisa menciptakan update churn.

Pertanyaan desain:

- Apakah status utama harus diupdate di satu row?
- Apakah semua perubahan status perlu event table append-only?
- Apakah current state dan history dipisah?
- Apakah audit trail tidak boleh bergantung pada undo log?

Penting:

> Undo log bukan audit log bisnis. Undo log adalah mekanisme internal storage engine. Untuk regulatory defensibility, gunakan audit/event table eksplisit.

---

# 21. MVCC Bukan Audit Trail

Ini harus ditekankan.

MVCC membuat versi lama untuk kebutuhan transaksi dan konsistensi internal. Tetapi:

- undo record bisa dipurge,
- tidak dirancang sebagai histori bisnis,
- tidak mudah/queryable sebagai audit trail,
- tidak memiliki semantic actor/reason/context,
- tidak cukup untuk legal/regulatory traceability.

Untuk sistem enforcement/case management, audit harus eksplisit:

```sql
CREATE TABLE case_status_events (
    event_id BIGINT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,
    actor_id BIGINT NOT NULL,
    reason_code VARCHAR(100),
    comment TEXT,
    occurred_at TIMESTAMP NOT NULL,
    command_id VARCHAR(100) NOT NULL,
    UNIQUE KEY uk_case_command (case_id, command_id)
);
```

Current state table:

```sql
CREATE TABLE cases (
    case_id BIGINT PRIMARY KEY,
    status VARCHAR(50) NOT NULL,
    version BIGINT NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

State transition dilakukan eksplisit, bukan berharap MVCC menyimpan histori bisnis.

---

# 22. Snapshot dan Reporting

MVCC sangat berguna untuk reporting karena query bisa melihat snapshot konsisten tanpa memblokir writer biasa.

Namun ada trade-off:

- report besar bisa berjalan lama,
- transaksi panjang bisa menahan purge,
- OLTP primary bisa terganggu,
- report bisa membaca snapshot lama,
- memory/temp table bisa besar.

Untuk report berat:

- gunakan replica/reporting database,
- gunakan ETL/ELT ke OLAP store,
- gunakan materialized summary,
- gunakan bounded time window,
- gunakan chunking,
- hindari transaksi report yang terlalu panjang di primary.

Rule of thumb:

> MVCC membuat reporting lebih aman daripada full locking model, tetapi tidak membuat OLTP primary otomatis cocok untuk semua analytical query.

---

# 23. Practical Timeline: Consistent Read

Data awal:

```sql
INSERT INTO cases(case_id, status, version)
VALUES (1, 'OPEN', 1);
```

Timeline:

```text
T1: START TRANSACTION;
T1: SELECT status, version FROM cases WHERE case_id = 1;
    -> OPEN, 1

T2: START TRANSACTION;
T2: UPDATE cases SET status = 'CLOSED', version = 2 WHERE case_id = 1;
T2: COMMIT;

T1: SELECT status, version FROM cases WHERE case_id = 1;
    -> OPEN, 1 under REPEATABLE READ consistent read

T1: COMMIT;

T3: SELECT status, version FROM cases WHERE case_id = 1;
    -> CLOSED, 2
```

Interpretasi:

- T1 tidak “salah baca”.
- T1 membaca snapshot konsisten.
- T2 tetap bisa commit.
- T1 tidak memblokir T2 dengan plain SELECT.

---

# 24. Practical Timeline: Current Read

Data awal:

```sql
case_id = 1, status = 'OPEN'
```

Timeline:

```text
T1: START TRANSACTION;
T1: SELECT * FROM cases WHERE case_id = 1 FOR UPDATE;
    -> locks row

T2: UPDATE cases SET status = 'CLOSED' WHERE case_id = 1;
    -> waits

T1: COMMIT;

T2: continues, updates row, commits
```

Interpretasi:

- `FOR UPDATE` membaca current version untuk tujuan update.
- Ia mengambil lock.
- Transaksi lain yang ingin update row sama harus menunggu.

Gunakan ini untuk critical section DB-level, tetapi jangan membungkus operasi lambat di dalamnya.

---

# 25. Practical Timeline: Conditional Update

Daripada read lalu update, sering lebih baik melakukan update dengan guard.

```sql
UPDATE cases
SET status = 'ESCALATED', version = version + 1
WHERE case_id = 1
  AND status = 'UNDER_REVIEW';
```

Jika dua transaksi mencoba eskalasi bersamaan:

```text
T1 executes conditional update -> affected rows 1
T2 executes conditional update -> affected rows 0
```

Aplikasi bisa menyimpulkan:

```text
T1 berhasil
T2 gagal karena state sudah berubah
```

Keunggulan:

- atomic,
- sederhana,
- tidak perlu read-before-write terpisah,
- cocok untuk state machine transition,
- mudah dibuat idempotent dengan command/event table.

---

# 26. MVCC dan Optimistic Locking

Dalam Java/JPA, optimistic locking biasanya memakai kolom version.

Contoh:

```sql
UPDATE cases
SET status = ?, version = version + 1
WHERE case_id = ?
  AND version = ?;
```

Jika affected rows 0, berarti row sudah berubah sejak dibaca.

Mental model:

- MVCC memberi snapshot read.
- Optimistic locking memberi conflict detection di write time.
- Keduanya saling melengkapi, bukan saling menggantikan.

Tanpa optimistic check, transaksi bisa membuat lost update pada pola tertentu.

---

# 27. Lost Update dan MVCC

MVCC tidak otomatis menyelesaikan semua anomaly bisnis.

Contoh aplikasi:

```text
T1 reads balance = 100
T2 reads balance = 100
T1 sets balance = 90
T2 sets balance = 80
```

Jika update dilakukan sebagai overwrite nilai hasil kalkulasi lama, salah satu perubahan bisa hilang.

Lebih aman:

```sql
UPDATE account
SET balance = balance - 10
WHERE account_id = ?;
```

Atau:

```sql
UPDATE account
SET balance = ?, version = version + 1
WHERE account_id = ?
  AND version = ?;
```

Untuk workflow:

```sql
UPDATE cases
SET status = 'APPROVED', version = version + 1
WHERE case_id = ?
  AND status = 'PENDING_APPROVAL'
  AND version = ?;
```

---

# 28. Long Transaction Detection

Query operasional yang sering berguna:

```sql
SELECT
    trx_id,
    trx_state,
    trx_started,
    trx_mysql_thread_id,
    trx_query
FROM information_schema.innodb_trx
ORDER BY trx_started;
```

Tujuannya:

- melihat transaksi aktif lama,
- mengidentifikasi session/thread,
- melihat query terkait jika tersedia,
- menentukan apakah transaksi harus diinvestigasi atau dihentikan.

Untuk lock wait:

```sql
SELECT *
FROM performance_schema.data_lock_waits;
```

Untuk process list:

```sql
SHOW PROCESSLIST;
```

Atau:

```sql
SELECT *
FROM performance_schema.threads;
```

Catatan:

- Jangan langsung kill session tanpa memahami dampaknya.
- Kill transaksi besar bisa memicu rollback besar.
- Rollback juga butuh waktu dan resource.

---

# 29. Incident Pattern: History List Length Naik

Gejala:

```text
- disk usage meningkat
- write latency naik
- query makin lambat
- undo tablespace membesar
- monitoring menunjukkan history list length tinggi
```

Kemungkinan penyebab:

```text
1. Ada transaksi lama yang belum commit/rollback
2. Ada report/export panjang
3. Ada batch job update/delete besar
4. Purge tertinggal karena write rate tinggi
5. Ada session idle in transaction
```

Langkah awal:

```text
1. Cek transaksi aktif lama
2. Cek processlist
3. Cek query/report/job yang berjalan
4. Cek apakah ada deployment baru
5. Cek workload delete/update massal
6. Cek disk dan I/O
7. Tentukan apakah perlu membatalkan transaksi tertentu
```

Mitigasi jangka panjang:

- batasi durasi transaksi,
- chunking batch update/delete,
- pindahkan report berat ke replica/OLAP,
- observability untuk transaction age,
- timeout yang realistis,
- desain export asynchronous,
- review semua `@Transactional` besar.

---

# 30. Transaction Scope sebagai Boundary Arsitektur

Banyak developer memperlakukan transaction sebagai anotasi teknis.

```java
@Transactional
```

Padahal transaction adalah boundary arsitektur:

- berapa lama database state harus dilindungi,
- lock apa yang mungkin ditahan,
- snapshot apa yang dipertahankan,
- apa yang terjadi jika rollback,
- external side effect apa yang tidak bisa rollback,
- berapa lama connection pool resource ditahan,
- seberapa besar undo/redo/binlog yang dibuat.

Pertanyaan desain sebelum menaruh `@Transactional`:

1. Data apa yang harus konsisten bersama?
2. Apakah semua operasi di method ini harus berada dalam satu commit?
3. Apakah ada network call di dalamnya?
4. Apakah ada loop besar?
5. Apakah ada streaming response?
6. Apakah ada locking read?
7. Apakah rollback-nya masih murah?
8. Apakah retry aman?
9. Apakah side effect eksternal harus dipindah ke outbox?

---

# 31. Read-Only Transaction di Spring

`@Transactional(readOnly = true)` sering disalahpahami.

Ia bukan jaminan absolut bahwa database tidak terkena dampak. Ia bisa memberi hint ke framework/driver/database, tetapi:

- connection tetap bisa dipinjam,
- transaksi/snapshot bisa tetap ada,
- query besar tetap berat,
- snapshot lama tetap bisa menahan purge,
- tergantung konfigurasi dan behavior framework.

Gunakan read-only transaction untuk:

- konsistensi beberapa read yang harus satu snapshot,
- optimasi/hint tertentu,
- dokumentasi intent.

Jangan gunakan untuk membungkus:

- export sangat panjang,
- streaming HTTP besar,
- report berat di primary,
- operasi yang sebenarnya tidak butuh snapshot transaksi.

---

# 32. MVCC dan Connection Pool

Connection pool seperti HikariCP membuat connection dipakai ulang.

Risiko jika state tidak bersih:

- autocommit salah,
- isolation level berubah,
- transaction belum selesai,
- session variables tertinggal,
- temporary table tertinggal,
- user variables tertinggal.

Framework/pool biasanya melakukan reset, tetapi aplikasi tetap harus disiplin.

Best practice:

- selalu commit/rollback,
- jangan memegang connection melewati boundary yang jelas,
- jangan return stream yang masih bergantung pada connection kecuali benar-benar dikelola,
- set timeout,
- aktifkan leak detection secara hati-hati di environment yang tepat,
- monitor active/idle/pending pool.

---

# 33. MVCC dan Replication

MVCC ada di source dan replica. Tetapi replication memperkenalkan dimensi lain:

- transaksi di source commit,
- binlog dikirim ke replica,
- replica apply perubahan,
- replica bisa lag.

Plain consistent read di replica memberi snapshot konsisten terhadap state replica, bukan state source terbaru.

Maka:

```text
User writes on primary
Immediately reads from replica
Replica lagging
User sees old data
```

Ini bukan bug MVCC. Ini boundary consistency replication.

Kita akan bahas replication lag dan read/write splitting di part 020-021.

---

# 34. MVCC dan Backup

Backup konsisten sering bergantung pada snapshot/transactional consistency.

Jika backup mengambil snapshot, transaksi panjang atau backup panjang dapat berinteraksi dengan undo/purge behavior.

Prinsip:

- backup harus konsisten,
- backup harus restorable,
- backup tidak boleh membunuh primary,
- backup panjang perlu dipahami dampaknya,
- PITR butuh binary log.

Ini akan dibahas lebih rinci di part backup/restore.

---

# 35. MVCC dan Regulatory Defensibility

Untuk sistem regulatory/case management, MVCC membantu technical consistency, tetapi defensibility butuh layer lain.

MVCC menjawab:

```text
Apakah transaksi membaca snapshot yang konsisten?
Apakah concurrent writer bisa berjalan tanpa memblokir reader biasa?
Apakah rollback bisa dilakukan?
```

MVCC tidak menjawab:

```text
Siapa mengubah status case?
Kenapa status diubah?
Apakah perubahan disetujui?
Apa rule yang dipakai saat keputusan dibuat?
Apa evidence saat keputusan terjadi?
Apakah audit trail immutable?
Apakah event bisa direkonstruksi secara legal?
```

Karena itu desain defensible membutuhkan:

- explicit audit event,
- command id/idempotency key,
- actor identity,
- reason code,
- before/after state,
- evidence reference,
- timestamp yang jelas,
- version/sequence,
- immutable append-only log atau kontrol perubahan yang kuat.

MVCC adalah fondasi storage consistency, bukan fondasi legal audit.

---

# 36. Design Pattern: Safe State Transition

Contoh state transition untuk enforcement case:

```sql
START TRANSACTION;

UPDATE cases
SET status = 'ESCALATED',
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE case_id = ?
  AND status = 'UNDER_REVIEW'
  AND version = ?;

-- application checks affected rows = 1

INSERT INTO case_status_events (
    event_id,
    case_id,
    from_status,
    to_status,
    actor_id,
    reason_code,
    occurred_at,
    command_id
) VALUES (?, ?, 'UNDER_REVIEW', 'ESCALATED', ?, ?, CURRENT_TIMESTAMP, ?);

COMMIT;
```

Tambahkan idempotency:

```sql
ALTER TABLE case_status_events
ADD UNIQUE KEY uk_case_command (case_id, command_id);
```

Jika retry terjadi:

- command yang sama tidak menggandakan event,
- affected row bisa 0 karena state sudah berubah,
- aplikasi bisa mengecek event berdasarkan command_id,
- hasil retry bisa dibuat deterministic.

Ini lebih baik daripada:

```text
SELECT status
if status valid
UPDATE status
INSERT audit
```

Tanpa guard yang kuat.

---

# 37. Design Pattern: Bounded Batch Update

Masalah:

> Menutup semua case expired dalam satu transaksi besar.

Pendekatan buruk:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE status = 'OPEN'
  AND due_at < NOW();
```

Jika jutaan row:

- transaksi besar,
- undo besar,
- redo besar,
- binlog besar,
- lock lama,
- replication lag,
- rollback mahal.

Pendekatan lebih aman:

```text
repeat:
  select next 500/1000 ids by indexed predicate
  update those ids with status guard
  insert audit events
  commit
  sleep/jitter if needed
until no rows
```

Contoh:

```sql
SELECT case_id
FROM cases
WHERE status = 'OPEN'
  AND due_at < NOW()
ORDER BY due_at, case_id
LIMIT 500;
```

Lalu:

```sql
UPDATE cases
SET status = 'CLOSED', version = version + 1
WHERE case_id IN (...)
  AND status = 'OPEN';
```

Keuntungan:

- transaksi pendek,
- undo bounded,
- lock bounded,
- retry lebih mudah,
- replication lebih stabil,
- progress bisa dimonitor.

---

# 38. Design Pattern: Avoid Long Export Transaction

Masalah:

```java
@Transactional(readOnly = true)
public void export(OutputStream out) {
    repository.streamAll().forEach(row -> write(out, row));
}
```

Alternatif 1: Keyset chunking tanpa satu transaksi panjang

```text
last_id = 0
while true:
  rows = SELECT ... WHERE id > last_id ORDER BY id LIMIT 1000
  if empty break
  write rows
  last_id = max(id)
```

Alternatif 2: Asynchronous export snapshot

```text
1. User requests export
2. Create export job
3. Worker reads in chunks
4. Store generated file
5. Notify user
```

Alternatif 3: Reporting replica/warehouse

```text
OLTP primary -> replica/CDC -> reporting store -> export
```

Trade-off:

- chunking bisa melihat perubahan antar chunk jika tidak memakai snapshot global,
- snapshot global lebih konsisten tetapi bisa menahan undo,
- reporting replica bisa lag,
- export job butuh lifecycle dan storage.

Tidak ada jawaban universal. Pilihan bergantung kebutuhan consistency export.

---

# 39. Debugging Checklist MVCC

Jika ada indikasi masalah MVCC/undo/purge:

## 39.1 Pertanyaan awal

1. Apakah ada transaksi aktif lama?
2. Apakah ada session idle in transaction?
3. Apakah ada report/export besar?
4. Apakah ada batch update/delete besar?
5. Apakah ada deployment baru yang mengubah transaction boundary?
6. Apakah connection pool penuh?
7. Apakah ada lock wait yang menumpuk?
8. Apakah history list length naik?
9. Apakah disk/undo tablespace bertambah?
10. Apakah replication lag ikut naik?

## 39.2 Data yang perlu dikumpulkan

- active transaction list,
- processlist,
- lock waits,
- slow query log,
- application trace,
- deployment timeline,
- batch job timeline,
- connection pool metrics,
- disk usage,
- InnoDB status.

## 39.3 Tindakan hati-hati

- Jangan langsung restart database.
- Jangan langsung kill semua query.
- Jangan menjalankan ALTER saat banyak transaksi lama.
- Jangan delete massal untuk “membersihkan” tanpa rencana.
- Jangan menaikkan connection pool sembarangan.

Restart bisa menghilangkan gejala sementara tetapi tidak memperbaiki desain transaksi.

---

# 40. Anti-Pattern Utama

## 40.1 “Satu Service Method, Satu Transaction Besar”

Tidak semua orchestration harus dalam satu transaksi.

Buruk:

```text
validate -> call API -> calculate -> generate file -> update DB -> send email
```

Semuanya dalam satu `@Transactional`.

Lebih baik:

```text
transaction kecil untuk read/write DB
outbox untuk side effect
external call di luar DB transaction bila memungkinkan
```

## 40.2 “SELECT Dulu, UPDATE Nanti Tanpa Guard”

Buruk:

```text
read status
if valid
update status
```

Lebih baik:

```sql
UPDATE ... WHERE id = ? AND status = ? AND version = ?;
```

## 40.3 “Export Besar di Primary dengan Read Transaction Panjang”

Buruk untuk OLTP primary.

Lebih baik:

- chunking,
- async export,
- replica,
- reporting store.

## 40.4 “Undo Log Dianggap Audit Trail”

Salah secara konsep dan salah untuk defensibility.

Buat audit/event table eksplisit.

---

# 41. Latihan Mental Model

## Latihan 1

T1 menjalankan:

```sql
START TRANSACTION;
SELECT status FROM cases WHERE case_id = 1;
```

T2 menjalankan:

```sql
UPDATE cases SET status = 'CLOSED' WHERE case_id = 1;
COMMIT;
```

T1 menjalankan lagi:

```sql
SELECT status FROM cases WHERE case_id = 1;
```

Pertanyaan:

1. Pada REPEATABLE READ, status apa yang mungkin dilihat T1?
2. Apakah T1 memblokir T2?
3. Apakah T2 menghapus versi lama secara langsung?

Jawaban mental:

1. T1 bisa tetap melihat status lama.
2. Plain consistent read umumnya tidak memblokir update T2.
3. Versi lama bisa tetap tersedia melalui undo sampai tidak diperlukan.

## Latihan 2

Apa masalah kode ini?

```java
@Transactional(readOnly = true)
public void exportCases(HttpServletResponse response) {
    repository.streamAllCases()
        .forEach(c -> writeCsv(response, c));
}
```

Jawaban mental:

- transaksi bisa hidup selama response streaming,
- connection pool resource tertahan,
- snapshot lama bisa menahan purge,
- client lambat memperpanjang transaksi,
- primary OLTP bisa terdampak.

## Latihan 3

Mana yang lebih aman untuk state transition?

```sql
SELECT status FROM cases WHERE case_id = ?;
UPDATE cases SET status = 'ESCALATED' WHERE case_id = ?;
```

atau:

```sql
UPDATE cases
SET status = 'ESCALATED', version = version + 1
WHERE case_id = ?
  AND status = 'UNDER_REVIEW'
  AND version = ?;
```

Yang kedua lebih aman karena transition guard ada di write statement yang atomic.

---

# 42. Ringkasan Inti

MVCC InnoDB adalah mekanisme yang memungkinkan pembaca melihat snapshot konsisten tanpa selalu memblokir penulis.

Komponen utamanya:

- transaction ID,
- hidden row metadata,
- undo log,
- read view,
- consistent read,
- current read,
- purge.

Hal terpenting untuk Java engineer:

1. Plain `SELECT` biasanya membaca snapshot, bukan selalu data terbaru.
2. `SELECT ... FOR UPDATE`, `UPDATE`, dan `DELETE` adalah current read dan bisa lock/wait.
3. Undo log dipakai untuk rollback dan consistent read.
4. Long-running transaction—even read-only—bisa menahan purge.
5. `@Transactional` adalah boundary arsitektur, bukan sekadar anotasi.
6. Jangan melakukan external call, streaming besar, atau loop batch besar dalam transaksi tanpa alasan kuat.
7. Untuk state transition, gunakan conditional update, optimistic locking, atau locking read sesuai kebutuhan.
8. MVCC bukan audit trail bisnis.
9. Observability terhadap transaction age, lock wait, pool usage, dan history list sangat penting.

---

# 43. Checklist Praktis

Sebelum merge kode yang memakai transaksi MySQL, tanyakan:

- Apakah transaction boundary sekecil mungkin?
- Apakah ada external API call di dalam transaksi?
- Apakah ada loop besar di dalam transaksi?
- Apakah ada stream/result set yang hidup lama?
- Apakah read-before-write punya concurrency guard?
- Apakah state transition memakai conditional update/version?
- Apakah audit trail eksplisit?
- Apakah retry aman dan idempotent?
- Apakah timeout jelas?
- Apakah connection pool bisa habis jika operasi lambat?
- Apakah query report/export layak jalan di primary?
- Apakah long transaction termonitor?

---

# 44. Kesalahan Pemahaman yang Harus Dihindari

| Miskonsepsi | Koreksi |
|---|---|
| Plain SELECT selalu melihat data terbaru | Plain SELECT bisa melihat snapshot lama |
| Read-only transaction tidak berdampak | Bisa menahan snapshot/purge dan connection |
| Undo log hanya untuk rollback | Juga dipakai untuk consistent read |
| MVCC mencegah semua concurrency bug | Tidak; business conflict tetap perlu guard |
| `@Transactional` selalu aman | Bisa memperluas lock/snapshot/resource lifetime |
| Audit bisa mengandalkan history DB internal | Tidak; audit harus eksplisit |
| Deadlock berarti database rusak | Deadlock adalah konsekuensi normal concurrency |
| Long query hanya masalah query itu sendiri | Bisa memengaruhi purge, I/O, buffer pool, pool |

---

# 45. Penutup

Bagian ini memberi fondasi untuk memahami isolation level, locking, deadlock, dan query behavior di bagian-bagian berikutnya.

Poin paling penting:

> MVCC membuat concurrency MySQL terlihat sederhana dari luar, tetapi di dalamnya ada versi row, undo chain, read view, dan purge. Developer Java yang kuat harus memahami bahwa transaction boundary di aplikasi memengaruhi semua mekanisme internal ini.

Di part berikutnya kita akan masuk ke isolation level MySQL, terutama kenapa `REPEATABLE READ` di InnoDB sering disalahpahami dan bagaimana memilih isolation level yang tepat untuk workload nyata.

---

# Status Akhir Part

- Part ini selesai: **Part 006 — InnoDB MVCC: Read Views, Undo Logs, and Consistent Reads**
- Status seri: **belum selesai**
- Lanjut ke: `learn-mysql-mastery-for-java-engineers-part-007.md`
- Judul berikutnya: **Isolation Levels in MySQL: Repeatable Read Is Not What Many Think**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Character Sets, Collations, and Text Comparison Bugs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-007.md">Part 007 — Isolation Levels in MySQL: Repeatable Read Is Not What Many Think ➡️</a>
</div>
