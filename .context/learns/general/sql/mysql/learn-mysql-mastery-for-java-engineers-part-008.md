# learn-mysql-mastery-for-java-engineers-part-008.md

# Part 008 — InnoDB Locking: Record Locks, Gap Locks, Next-Key Locks

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `008 / 034`  
> Topik: InnoDB locking, record lock, gap lock, next-key lock, locking reads, index-driven lock footprint, dan implikasi ke Java/Spring application design.

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas isolation level: `READ COMMITTED`, `REPEATABLE READ`, consistent read, locking read, dan kenapa `REPEATABLE READ` di MySQL tidak bisa dipahami hanya dari definisi textbook.

Bagian ini masuk lebih dalam ke mekanisme yang membuat isolation tersebut bekerja: **lock**.

Target akhir bagian ini:

1. Anda memahami bahwa lock InnoDB bukan hanya “row lock”.
2. Anda bisa membedakan:
   - record lock,
   - gap lock,
   - next-key lock,
   - insert intention lock,
   - intention table lock,
   - auto-increment lock,
   - metadata lock secara singkat.
3. Anda tahu bahwa **index menentukan lock footprint**.
4. Anda bisa membaca kenapa query yang terlihat kecil bisa memblokir banyak transaksi.
5. Anda bisa mendesain query update/delete/select-for-update yang lebih aman.
6. Anda bisa menghubungkan error Java seperti:
   - `Lock wait timeout exceeded`,
   - `Deadlock found when trying to get lock`,
   - query stuck,
   - connection pool exhausted,
   ke pola locking di database.
7. Anda punya mental model yang cukup untuk menganalisis workflow state machine, queue, approval, escalation, SLA, dan case lifecycle di atas MySQL.

---

## 1. Kenapa Locking Perlu Dipahami Serius?

Banyak engineer memahami database concurrency dengan kalimat sederhana:

> “Kalau update row, database akan lock row itu.”

Kalimat ini tidak salah, tapi terlalu dangkal untuk MySQL/InnoDB.

Dalam InnoDB, lock bisa terjadi pada:

- record index,
- jarak antar record,
- kombinasi record dan gap,
- intention di level tabel,
- auto-increment counter,
- metadata object,
- foreign key relationship,
- unique constraint checking,
- secondary index path,
- range predicate,
- non-existing row.

Yang lebih penting:

> InnoDB mengunci **index records**, bukan abstraksi “object Java” atau “baris logis” seperti yang sering dibayangkan aplikasi.

Ketika aplikasi Java menjalankan:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE case_id = ?;
```

Anda mungkin berpikir: “hanya satu case yang dikunci.”

Itu benar jika:

- `case_id` indexed dengan baik,
- predicate memakai equality yang selektif,
- query plan memakai index tersebut,
- tidak ada foreign key side effect,
- tidak ada trigger side effect,
- tidak ada range scan tersembunyi,
- tidak ada gap lock yang relevan di isolation tertentu,
- tidak ada metadata lock yang menahan statement.

Jika salah satu asumsi itu runtuh, lock footprint bisa lebih luas daripada yang terlihat dari kode aplikasi.

---

## 2. Locking Bukan Lawan MVCC, Tapi Pasangannya

Di bagian MVCC, kita melihat bahwa consistent read memungkinkan transaksi membaca snapshot tanpa memblokir writer.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE case_id = 1001;
```

Pada default `REPEATABLE READ`, query biasa seperti di atas umumnya adalah **consistent non-locking read**. Ia membaca snapshot, bukan mengunci row.

Tetapi tidak semua operasi bisa diselesaikan dengan snapshot.

Operasi berikut butuh koordinasi terhadap perubahan aktual:

```sql
UPDATE enforcement_case
SET status = 'CLOSED'
WHERE case_id = 1001;
```

```sql
DELETE FROM enforcement_case
WHERE case_id = 1001;
```

```sql
SELECT *
FROM enforcement_case
WHERE case_id = 1001
FOR UPDATE;
```

```sql
SELECT *
FROM enforcement_case
WHERE status = 'PENDING_REVIEW'
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE;
```

Operasi-operasi ini tidak cukup dengan snapshot. Mereka harus memastikan bahwa data yang akan dimodifikasi atau diamankan tidak sedang dimodifikasi transaksi lain dengan cara yang konflik.

Jadi mental modelnya:

```text
MVCC      = memberi pembaca snapshot yang konsisten tanpa selalu memblokir writer
Locking   = mengatur konflik antara operasi yang ingin memodifikasi/mengamankan data aktual
Isolation = kombinasi snapshot + locking + aturan visibility + aturan conflict
```

---

## 3. Istilah Penting: Consistent Read vs Current Read

Sebelum masuk tipe lock, kita harus kokoh dulu pada dua istilah ini.

### 3.1 Consistent Read

Consistent read membaca versi data berdasarkan read view.

Contoh:

```sql
SELECT *
FROM account
WHERE id = 10;
```

Pada `REPEATABLE READ`, transaksi yang sama akan melihat snapshot yang sama untuk consistent read-nya.

Consistent read biasanya:

- tidak mengambil row lock,
- tidak menunggu row lock writer dalam banyak kasus,
- bisa membaca versi lama dari undo log,
- cocok untuk query baca biasa.

### 3.2 Current Read

Current read membaca versi terbaru yang committed atau yang sedang perlu dikunci untuk modifikasi.

Contoh current read:

```sql
UPDATE account
SET balance = balance - 100
WHERE id = 10;
```

```sql
DELETE FROM account
WHERE id = 10;
```

```sql
SELECT *
FROM account
WHERE id = 10
FOR UPDATE;
```

```sql
SELECT *
FROM account
WHERE id = 10
FOR SHARE;
```

Current read biasanya:

- harus memperhatikan lock aktif,
- bisa menunggu transaksi lain,
- bisa mengambil lock baru,
- melihat data aktual untuk tujuan update/locking.

Kesalahan umum Java engineer:

> Mengira `SELECT` biasa di dalam `@Transactional` otomatis “mengunci” data.

Tidak. `SELECT` biasa adalah consistent read, bukan locking read.

Jika service melakukan:

```java
@Transactional
public void approve(Long caseId) {
    Case c = repository.findById(caseId).orElseThrow();

    if (!c.getStatus().equals("PENDING_APPROVAL")) {
        throw new IllegalStateException();
    }

    c.setStatus("APPROVED");
}
```

Secara konseptual terlihat aman, tetapi detailnya tergantung ORM flush, update predicate, optimistic locking, isolation, dan apakah ada constraint/state guard di database.

Jika dua transaksi membaca status yang sama lalu update, race condition tetap mungkin bila tidak ada mekanisme concurrency control yang benar.

---

## 4. Taxonomy Lock InnoDB

Di level praktis, tipe lock yang perlu dikuasai:

1. **Shared lock** (`S`)
2. **Exclusive lock** (`X`)
3. **Intention shared lock** (`IS`)
4. **Intention exclusive lock** (`IX`)
5. **Record lock**
6. **Gap lock**
7. **Next-key lock**
8. **Insert intention lock**
9. **AUTO-INC lock**
10. **Predicate/spatial index lock** dalam konteks khusus
11. **Metadata lock** sebagai lock server-layer, bukan InnoDB row lock

Kita bahas bertahap.

---

## 5. Shared Lock dan Exclusive Lock

### 5.1 Shared Lock

Shared lock berarti transaksi ingin membaca dan mencegah perubahan oleh transaksi lain pada data yang dikunci.

Dalam SQL modern MySQL, ini biasanya muncul melalui:

```sql
SELECT *
FROM enforcement_case
WHERE case_id = 1001
FOR SHARE;
```

Shared lock kompatibel dengan shared lock lain, tetapi tidak kompatibel dengan exclusive lock.

Secara sederhana:

```text
S + S = compatible
S + X = conflict
X + X = conflict
```

### 5.2 Exclusive Lock

Exclusive lock berarti transaksi ingin memodifikasi atau menguasai record.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE case_id = 1001
FOR UPDATE;
```

```sql
UPDATE enforcement_case
SET status = 'IN_REVIEW'
WHERE case_id = 1001;
```

```sql
DELETE FROM enforcement_case
WHERE case_id = 1001;
```

Exclusive lock mencegah transaksi lain mengambil lock konflik pada record yang sama.

---

## 6. Intention Locks: Kenapa Ada Lock di Level Tabel?

InnoDB mendukung locking di beberapa level. Agar lock table-level dan row-level bisa koeksis, InnoDB memakai **intention locks**.

Ada dua yang umum:

- `IS` = intention shared
- `IX` = intention exclusive

Intuition:

> Sebelum transaksi mengambil shared/exclusive lock pada row, ia menandai di level tabel bahwa ia berniat mengambil lock tertentu di bawah tabel tersebut.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE case_id = 1001
FOR SHARE;
```

Transaksi akan memiliki intention shared lock di table, lalu shared lock pada record terkait.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'CLOSED'
WHERE case_id = 1001;
```

Transaksi akan memiliki intention exclusive lock di table, lalu exclusive lock pada record terkait.

### 6.1 Kenapa Ini Penting?

Untuk kebanyakan aplikasi, intention locks jarang menjadi sumber masalah langsung.

Tapi penting untuk mental model:

- lock tidak hanya row-level,
- table-level lock masih ada,
- beberapa operasi DDL/table lock harus memperhatikan intention locks,
- output diagnostic bisa memperlihatkan lock jenis ini.

---

## 7. Record Lock: Lock Pada Index Record

Record lock adalah lock pada record index.

Kunci kalimatnya:

> InnoDB record lock mengunci **index record**.

Bukan “row object” dalam arti abstrak.

Misalnya tabel:

```sql
CREATE TABLE enforcement_case (
    id BIGINT PRIMARY KEY,
    case_number VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME NOT NULL,
    assigned_officer_id BIGINT NULL,
    INDEX idx_status_created (status, created_at)
) ENGINE = InnoDB;
```

Query:

```sql
UPDATE enforcement_case
SET assigned_officer_id = 42
WHERE id = 1001;
```

Jika optimizer memakai primary key, InnoDB akan mengunci record pada clustered index untuk `id = 1001`.

Query:

```sql
SELECT *
FROM enforcement_case
WHERE case_number = 'CASE-2026-000123'
FOR UPDATE;
```

Jika memakai unique secondary index `case_number`, InnoDB perlu mencari lewat index tersebut, lalu mengakses clustered index. Lock bisa melibatkan secondary index record dan clustered index record yang berkaitan.

### 7.1 Record Lock Untuk Existing Row

Jika row ada:

```sql
SELECT *
FROM enforcement_case
WHERE id = 1001
FOR UPDATE;
```

Transaksi mengunci record `id = 1001`.

Transaksi lain yang mencoba:

```sql
UPDATE enforcement_case
SET status = 'CLOSED'
WHERE id = 1001;
```

akan menunggu sampai transaksi pertama commit/rollback.

---

## 8. Gap Lock: Lock Pada Jarak Antar Index Record

Gap lock adalah lock pada “celah” antar index record.

Misalnya ada primary key:

```text
10, 20, 30
```

Maka ada gap:

```text
(-∞, 10)
(10, 20)
(20, 30)
(30, +∞)
```

Gap lock bisa mengunci celah, misalnya `(10, 20)`, sehingga transaksi lain tidak bisa insert key baru di dalam gap tersebut.

### 8.1 Kenapa Gap Lock Ada?

Tujuannya terutama untuk mencegah phantom dalam range locking di isolation tertentu.

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE id BETWEEN 10 AND 20
FOR UPDATE;
```

Jika transaksi ingin memastikan range tersebut stabil untuk operasi tertentu, InnoDB tidak cukup mengunci row yang sudah ada. Ia juga perlu mencegah transaksi lain menyisipkan row baru di range itu.

Kalau hanya row existing yang dikunci, transaksi lain bisa insert `id = 15`, lalu range query berikutnya melihat phantom.

Gap lock membantu mencegah itu.

### 8.2 Gap Lock Bisa Terjadi Pada Row Yang Tidak Ada

Ini sering mengejutkan.

Misalnya tabel memiliki id:

```text
10, 20, 30
```

Transaksi A:

```sql
START TRANSACTION;

SELECT *
FROM enforcement_case
WHERE id = 15
FOR UPDATE;
```

`id = 15` tidak ada.

Namun pada isolation dan kondisi tertentu, InnoDB bisa mengunci gap tempat `15` seharusnya berada, yaitu `(10, 20)`.

Transaksi B:

```sql
INSERT INTO enforcement_case (id, case_number, status, created_at)
VALUES (15, 'CASE-2026-000015', 'OPEN', NOW());
```

bisa tertahan.

Dari perspektif aplikasi, ini terasa aneh:

> “Saya select row yang tidak ada, kenapa insert row baru bisa menunggu?”

Jawabannya: karena yang dikunci bukan row existing, melainkan **gap**.

---

## 9. Next-Key Lock: Record Lock + Gap Lock

Next-key lock adalah kombinasi:

```text
next-key lock = record lock + gap before record
```

Jika index berisi:

```text
10, 20, 30
```

Next-key intervals kira-kira:

```text
(-∞, 10]
(10, 20]
(20, 30]
(30, +∞)
```

Perhatikan tanda `]`: record di ujung kanan ikut terkunci.

### 9.1 Kenapa Namanya Next-Key?

Karena lock mencakup gap sebelum record dan record berikutnya.

Misalnya next-key lock pada `20` mencakup:

```text
(10, 20]
```

Artinya:

- record `20` dikunci,
- gap antara `10` dan `20` juga dikunci.

### 9.2 Next-Key Lock Dalam Range Query

Contoh:

```sql
SELECT *
FROM enforcement_case
WHERE id > 10 AND id <= 20
FOR UPDATE;
```

InnoDB mungkin memakai next-key lock untuk mencegah perubahan yang memunculkan phantom pada range tersebut.

### 9.3 Dampak Besar Untuk Query Range

Query seperti ini:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE created_at < '2026-01-01 00:00:00'
  AND status = 'OPEN';
```

jika memakai index range, dapat mengunci rentang index cukup luas.

Jika tidak ada index yang tepat, efeknya bisa lebih parah: engine melakukan scan lebih luas, dan lock footprint bisa meluas ke banyak record yang diperiksa.

---

## 10. Insert Intention Lock

Insert intention lock adalah lock khusus yang menunjukkan bahwa transaksi ingin memasukkan record ke dalam gap tertentu.

Ia memungkinkan beberapa transaksi insert ke gap yang sama selama posisi insert-nya tidak konflik.

Misalnya index berisi:

```text
10, 20
```

Transaksi A ingin insert `12`.  
Transaksi B ingin insert `15`.

Keduanya berada dalam gap `(10, 20)`, tetapi tidak mengisi posisi key yang sama.

InnoDB dapat mengizinkan keduanya berjalan bersamaan jika tidak ada gap lock lain yang konflik.

### 10.1 Insert Bisa Tertahan Oleh Gap Lock

Jika transaksi lain telah mengunci gap `(10, 20)` melalui range locking read, insert intention lock bisa tertahan.

Contoh:

Transaksi A:

```sql
START TRANSACTION;

SELECT *
FROM enforcement_case
WHERE id BETWEEN 10 AND 20
FOR UPDATE;
```

Transaksi B:

```sql
INSERT INTO enforcement_case (id, case_number, status, created_at)
VALUES (15, 'CASE-2026-000015', 'OPEN', NOW());
```

Transaksi B bisa menunggu karena gap `(10, 20)` sedang dikunci.

---

## 11. AUTO_INCREMENT Lock

`AUTO_INCREMENT` tampak sederhana, tetapi di sistem high-write ia punya implikasi concurrency.

Contoh:

```sql
CREATE TABLE audit_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id)
) ENGINE = InnoDB;
```

Saat insert tanpa id:

```sql
INSERT INTO audit_event (case_id, event_type, created_at)
VALUES (1001, 'CASE_APPROVED', NOW());
```

InnoDB harus menghasilkan nilai auto-increment.

MySQL memiliki konfigurasi dan mode internal untuk mengatur perilaku auto-increment lock. Dalam banyak workload modern, auto-increment cukup efisien. Tetapi tetap ada prinsip penting:

1. Auto-increment membuat insert cenderung append ke ujung clustered index.
2. Ini baik untuk locality.
3. Tetapi pada concurrency tinggi, counter allocation dan right-most page hot spot tetap bisa menjadi concern.
4. Bulk insert dan statement-based replication historically punya constraint tambahan.

Untuk banyak aplikasi Java, auto-increment masih pilihan aman dan sederhana, terutama dalam single-primary MySQL.

Namun dalam distributed ID generation, multi-writer, atau sharding, auto-increment perlu dipertimbangkan ulang.

---

## 12. Metadata Lock: Bukan InnoDB Row Lock, Tapi Sering Membunuh Production

Metadata lock atau MDL adalah lock di level server untuk melindungi metadata object seperti table definition.

Contoh:

Transaksi A:

```sql
START TRANSACTION;

SELECT *
FROM enforcement_case
WHERE id = 1001;

-- transaksi dibiarkan terbuka lama
```

Transaksi B:

```sql
ALTER TABLE enforcement_case
ADD COLUMN risk_score INT NULL;
```

DDL ini bisa menunggu metadata lock.

Yang berbahaya: ketika DDL menunggu, statement baru yang butuh metadata lock kompatibel tertentu juga bisa ikut antre. Akibatnya aplikasi bisa terlihat “stuck” padahal penyebab awalnya transaksi lama.

Metadata lock akan dibahas lebih dalam di part khusus migration/MDL, tetapi harus dikenali sejak sekarang karena sering disangka row lock.

---

## 13. Lock Compatibility Sederhana

Secara mental, gunakan tabel sederhana ini:

| Existing Lock | Requested Lock | Compatible? |
|---|---:|---:|
| Shared | Shared | Yes |
| Shared | Exclusive | No |
| Exclusive | Shared | No |
| Exclusive | Exclusive | No |

Namun untuk gap lock, behavior-nya lebih subtle. Gap locks bisa tampak “tidak saling konflik” dalam beberapa kondisi, karena tujuan utamanya mencegah insert ke gap, bukan selalu mencegah gap lock lain.

Sebagai engineer aplikasi, aturan praktisnya:

> Jangan mengandalkan detail kompatibilitas gap lock untuk desain aplikasi. Desainlah supaya lock footprint kecil, query indexed, transaksi singkat, dan retry aman.

---

## 14. Locking Reads: `FOR UPDATE` dan `FOR SHARE`

### 14.1 `SELECT ... FOR UPDATE`

`FOR UPDATE` mengambil exclusive lock pada row/index record yang dibaca.

Contoh:

```sql
START TRANSACTION;

SELECT *
FROM enforcement_case
WHERE id = 1001
FOR UPDATE;

UPDATE enforcement_case
SET status = 'APPROVED'
WHERE id = 1001;

COMMIT;
```

Tujuannya:

- membaca data terbaru yang relevan,
- mencegah transaksi lain mengubahnya sampai transaksi selesai,
- menjaga invariant selama decision-making.

### 14.2 `SELECT ... FOR SHARE`

`FOR SHARE` mengambil shared lock.

Contoh:

```sql
START TRANSACTION;

SELECT *
FROM account
WHERE id = 10
FOR SHARE;

-- membaca dan memastikan row tidak berubah oleh writer lain selama transaksi

COMMIT;
```

Biasanya lebih jarang dipakai aplikasi CRUD biasa dibanding `FOR UPDATE`.

### 14.3 Anti-Pattern: Lock Terlalu Awal

Contoh buruk:

```java
@Transactional
public void approveCase(Long caseId) {
    Case c = repository.findByIdForUpdate(caseId);

    externalRiskService.validate(c); // call HTTP 2 detik

    c.approve();
}
```

Masalah:

- row lock ditahan selama external HTTP call,
- transaksi lain yang ingin memproses case sama menunggu,
- connection juga tertahan,
- jika external call lambat, lock duration membesar,
- jika banyak request seperti ini, DB menjadi bottleneck.

Pola lebih baik:

1. Baca data tanpa lock jika memungkinkan.
2. Panggil external service di luar transaksi.
3. Masuk transaksi pendek.
4. Ambil lock.
5. Validasi ulang invariant.
6. Update.
7. Commit cepat.

Pseudo-code:

```java
public void approveCase(Long caseId) {
    CaseSnapshot snapshot = caseReader.getSnapshot(caseId);
    RiskResult risk = externalRiskService.validate(snapshot);

    transactionTemplate.executeWithoutResult(tx -> {
        Case c = caseRepository.findByIdForUpdate(caseId);
        c.ensureStillApprovable();
        c.applyRiskResult(risk);
        c.approve();
    });
}
```

---

## 15. Index Menentukan Apa Yang Dikunci

Ini prinsip paling penting di bagian ini.

> Query locking di InnoDB mengunci index records yang discan/ditemukan. Maka index access path sangat menentukan lock footprint.

Tabel:

```sql
CREATE TABLE task_queue (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority INT NOT NULL,
    created_at DATETIME NOT NULL,
    payload JSON NOT NULL,
    INDEX idx_status_created (status, created_at)
) ENGINE = InnoDB;
```

Query worker:

```sql
SELECT *
FROM task_queue
WHERE tenant_id = 10
  AND status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE;
```

Index yang tersedia hanya:

```sql
INDEX idx_status_created (status, created_at)
```

Masalah:

- query filter `tenant_id`, `status`, order by `priority`, `created_at`,
- index tidak mendukung seluruh pola,
- engine mungkin scan banyak row `status = READY`, lalu filter tenant,
- locking read dapat mengunci lebih banyak record daripada satu task yang akhirnya dipilih,
- worker antar tenant bisa saling mengganggu.

Index lebih cocok mungkin:

```sql
CREATE INDEX idx_queue_claim
ON task_queue (tenant_id, status, priority DESC, created_at, id);
```

Lalu query:

```sql
SELECT *
FROM task_queue
WHERE tenant_id = 10
  AND status = 'READY'
ORDER BY priority DESC, created_at ASC, id ASC
LIMIT 1
FOR UPDATE;
```

Lock footprint lebih sempit karena index path sesuai workload.

### 15.1 Kesimpulan

Index bukan hanya alat performance. Untuk locking query, index adalah alat **concurrency control footprint**.

Index buruk dapat menyebabkan:

- lock lebih luas,
- deadlock lebih sering,
- lock wait timeout,
- throughput rendah,
- worker saling blokir,
- transaction duration meningkat,
- connection pool habis.

---

## 16. Equality Unique Lookup vs Range Lookup

### 16.1 Unique Equality Lookup

Query:

```sql
SELECT *
FROM enforcement_case
WHERE case_number = 'CASE-2026-000123'
FOR UPDATE;
```

Jika `case_number` adalah unique index dan predicate lengkap memakai equality, InnoDB dapat mengunci record yang cocok dengan lebih sempit.

```sql
CREATE UNIQUE INDEX uq_case_number
ON enforcement_case (case_number);
```

Ini lock pattern yang relatif aman.

### 16.2 Non-Unique Equality Lookup

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
FOR UPDATE;
```

`status` tidak unique. Banyak row cocok. Query ini bisa mengunci banyak record dan gap terkait.

Jika tabel besar, ini berbahaya.

### 16.3 Range Lookup

```sql
SELECT *
FROM enforcement_case
WHERE created_at < '2026-01-01 00:00:00'
FOR UPDATE;
```

Range lookup bisa menghasilkan next-key locks pada range index.

Ini wajar jika memang tujuannya mengamankan range. Tapi untuk aplikasi OLTP biasa, query seperti ini dalam transaksi panjang sangat berisiko.

---

## 17. Non-Indexed Predicate: Salah Satu Sumber Lock Meluas

Tabel:

```sql
CREATE TABLE case_assignment (
    id BIGINT PRIMARY KEY,
    officer_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    assigned_at DATETIME NOT NULL
) ENGINE = InnoDB;
```

Tidak ada index pada `officer_id`.

Query:

```sql
UPDATE case_assignment
SET status = 'REBALANCED'
WHERE officer_id = 42
  AND status = 'ACTIVE';
```

Tanpa index, engine mungkin scan banyak record.

Dalam locking operation, scan bukan sekadar mahal. Ia juga bisa mengambil lock pada banyak record yang diperiksa atau cocok sesuai execution behavior.

Akibat:

- update satu officer bisa mengganggu officer lain,
- lock wait meningkat,
- deadlock lebih mudah terjadi,
- transaction log membesar,
- replica lag bisa meningkat.

Index yang lebih baik:

```sql
CREATE INDEX idx_assignment_officer_status
ON case_assignment (officer_id, status);
```

Tetapi jangan berhenti di “tambahkan index”. Evaluasi juga:

- cardinality `officer_id`,
- jumlah active assignment,
- update frequency,
- apakah query perlu `assigned_at`,
- apakah ada order/limit,
- apakah index memperlambat write path secara signifikan.

---

## 18. Locking Pada Secondary Index

InnoDB secondary index tidak menyimpan seluruh row sebagai heap pointer seperti beberapa engine lain. Secondary index menyimpan primary key value untuk menunjuk clustered record.

Misalnya:

```sql
CREATE TABLE person_case (
    id BIGINT PRIMARY KEY,
    national_id VARBINARY(32) NOT NULL,
    case_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    UNIQUE KEY uq_national_case (national_id, case_id),
    INDEX idx_status (status)
) ENGINE = InnoDB;
```

Query:

```sql
SELECT *
FROM person_case
WHERE national_id = ?
  AND case_id = ?
FOR UPDATE;
```

Jika memakai unique secondary index `uq_national_case`, InnoDB menemukan secondary index record lalu mengakses clustered record via primary key.

Untuk update, lock bisa melibatkan:

- secondary index entry yang dipakai mencari,
- clustered index record,
- secondary index entries lain jika kolom indexed berubah.

Contoh:

```sql
UPDATE person_case
SET status = 'CLOSED'
WHERE national_id = ?
  AND case_id = ?;
```

Jika `status` di-index, update status berarti:

- remove old secondary index entry dari `idx_status`,
- insert new secondary index entry,
- lock terkait index maintenance.

Jadi update kolom indexed lebih mahal dan bisa memunculkan lock tambahan.

---

## 19. Foreign Key Locking

Foreign key adalah constraint penting, tetapi punya konsekuensi locking.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE enforcement_action (
    id BIGINT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    CONSTRAINT fk_action_case
        FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE = InnoDB;
```

Saat insert child:

```sql
INSERT INTO enforcement_action (id, case_id, action_type)
VALUES (5001, 1001, 'WARNING_LETTER');
```

InnoDB harus memastikan parent `enforcement_case.id = 1001` ada.

Ini bisa melibatkan shared lock pada parent record untuk menjaga referential integrity selama statement/transaction.

Saat delete parent:

```sql
DELETE FROM enforcement_case
WHERE id = 1001;
```

InnoDB harus memastikan tidak ada child yang melanggar FK, atau menjalankan cascade jika didefinisikan.

Jika child index tidak tepat, pengecekan bisa mahal dan locking bisa membesar.

### 19.1 Rule Praktis FK

1. Pastikan kolom child FK indexed dengan baik.
2. Hati-hati cascade pada tabel besar.
3. Jangan delete parent besar-besaran dalam transaksi besar.
4. Pahami bahwa insert child bisa menunggu update/delete parent.
5. Pahami bahwa delete/update parent bisa menunggu aktivitas child.

---

## 20. Unique Constraint Checking dan Lock

Unique constraint bukan hanya validasi. Ia juga mekanisme concurrency control.

Contoh:

```sql
CREATE TABLE idempotency_key (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    business_key VARCHAR(128) NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uq_business_key (business_key)
) ENGINE = InnoDB;
```

Dua request Java bersamaan:

```sql
INSERT INTO idempotency_key (business_key, created_at)
VALUES ('approve-case:1001:req-abc', NOW());
```

Salah satu menang, yang lain duplicate key atau menunggu lalu duplicate.

Ini bisa digunakan sebagai concurrency primitive yang kuat.

### 20.1 Pattern: Unique Constraint As Guard

Daripada:

```java
if (!repository.existsByBusinessKey(key)) {
    repository.save(new IdempotencyKey(key));
}
```

lebih aman:

```java
try {
    repository.insertIdempotencyKey(key);
} catch (DuplicateKeyException e) {
    // request sudah pernah diproses atau sedang diproses
}
```

Karena check-then-insert rentan race condition.

Unique index + insert adalah atomic guard.

---

## 21. Range Update dan Delete: Operasi Paling Perlu Hati-Hati

Query seperti ini tampak biasa:

```sql
DELETE FROM audit_event
WHERE created_at < '2025-01-01 00:00:00';
```

Pada tabel besar, ini berbahaya.

Masalah:

- scan range besar,
- lock banyak record,
- undo log besar,
- redo log besar,
- binlog besar,
- purge berat,
- replica lag,
- long rollback jika gagal,
- blocking terhadap insert/update lain.

Pola lebih aman:

```sql
DELETE FROM audit_event
WHERE created_at < '2025-01-01 00:00:00'
ORDER BY id
LIMIT 1000;
```

Jalankan dalam batch kecil dengan jeda/monitoring.

Namun lebih baik lagi jika retention memang besar: desain partitioning/archiving sejak awal.

### 21.1 Batch Delete Java Pattern

Pseudo-code:

```java
while (true) {
    int deleted = transactionTemplate.execute(status ->
        auditRepository.deleteOldEventsBatch(cutoff, 1000)
    );

    if (deleted == 0) {
        break;
    }

    sleepBrieflyOrYield();
}
```

Dengan SQL:

```sql
DELETE FROM audit_event
WHERE created_at < ?
ORDER BY id
LIMIT ?;
```

Syarat:

- index mendukung predicate/order,
- batch size dikontrol,
- observability aktif,
- job bisa dihentikan dan dilanjutkan,
- tidak dijalankan saat traffic puncak.

---

## 22. Queue Pattern Dengan `FOR UPDATE SKIP LOCKED`

MySQL mendukung pola locking yang berguna untuk worker queue.

Contoh:

```sql
START TRANSACTION;

SELECT id
FROM task_queue
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC, id ASC
LIMIT 10
FOR UPDATE SKIP LOCKED;

-- update selected rows to IN_PROGRESS

COMMIT;
```

`SKIP LOCKED` membuat transaksi melewati row yang sedang dikunci transaksi lain.

Ini berguna untuk worker parallel.

Namun ada trade-off:

1. Tidak cocok untuk semua fairness requirement.
2. Row yang sering terkunci bisa terlewati berkali-kali.
3. Ordering global bisa tidak sempurna.
4. Query tetap butuh index yang sangat tepat.
5. Harus ada timeout/recovery untuk task `IN_PROGRESS` yang ditinggal worker mati.

Index queue yang baik:

```sql
CREATE INDEX idx_task_claim
ON task_queue (status, priority DESC, created_at, id);
```

Untuk multi-tenant:

```sql
CREATE INDEX idx_task_claim_tenant
ON task_queue (tenant_id, status, priority DESC, created_at, id);
```

### 22.1 Claim Pattern Yang Lebih Aman

Langkah:

1. Start transaction.
2. Select candidate rows `FOR UPDATE SKIP LOCKED`.
3. Update rows menjadi `IN_PROGRESS`, set `locked_by`, `locked_at`, increment attempt.
4. Commit.
5. Process outside transaction.
6. Mark success/failure in transaction pendek.

Jangan proses task berat sambil menahan row lock.

Buruk:

```text
BEGIN
SELECT task FOR UPDATE
process HTTP / file / ML / report selama 30 detik
UPDATE done
COMMIT
```

Lebih baik:

```text
BEGIN
claim task
COMMIT
process outside transaction
BEGIN
mark result
COMMIT
```

---

## 23. State Machine dan Locking

Untuk sistem enforcement/case management, banyak operasi berbentuk state transition.

Contoh status:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ENFORCED -> CLOSED
```

Masalah concurrency:

- dua officer approve bersamaan,
- satu proses escalate sementara proses lain close,
- SLA job mengubah priority saat user melakukan manual action,
- integration callback datang terlambat,
- appeal/reopen terjadi saat close job berjalan.

### 23.1 Pattern: Lock Then Validate Current State

```sql
START TRANSACTION;

SELECT id, status, version
FROM enforcement_case
WHERE id = ?
FOR UPDATE;

-- validate allowed transition in application

UPDATE enforcement_case
SET status = 'APPROVED',
    version = version + 1,
    updated_at = NOW()
WHERE id = ?;

INSERT INTO case_status_history (...);

COMMIT;
```

Rule:

> Lock bukan pengganti validasi state. Lock hanya membuat validasi dan update terjadi di critical section yang konsisten.

### 23.2 Pattern: Conditional Update Without Explicit Select Lock

Kadang bisa lebih efisien:

```sql
UPDATE enforcement_case
SET status = 'APPROVED',
    version = version + 1,
    updated_at = NOW()
WHERE id = ?
  AND status = 'UNDER_REVIEW';
```

Lalu aplikasi cek affected rows.

Jika `affected_rows = 1`, transition berhasil.  
Jika `affected_rows = 0`, state sudah berubah atau row tidak ada.

Ini sering bagus untuk simple state transition.

Namun jika perlu membaca banyak data/invariant sebelum update, explicit `FOR UPDATE` bisa diperlukan.

### 23.3 Pattern: Version Column

```sql
UPDATE enforcement_case
SET status = 'APPROVED',
    version = version + 1
WHERE id = ?
  AND version = ?;
```

Ini optimistic locking. Cocok ketika conflict jarang dan retry/feedback bisa diterima.

Untuk high-contention row, pessimistic locking atau desain aggregate perlu dievaluasi.

---

## 24. Lock Duration: Yang Membunuh Bukan Hanya Lock, Tapi Waktu Menahannya

Lock pendek biasanya normal. Lock panjang adalah masalah.

Lock duration dipengaruhi oleh:

- durasi transaksi,
- query lambat,
- aplikasi melakukan CPU work dalam transaksi,
- aplikasi melakukan network call dalam transaksi,
- user interaction dalam transaksi,
- batch terlalu besar,
- result set streaming terlalu lama,
- connection pool tidak mengembalikan connection,
- deadlock/retry salah desain,
- autocommit dimatikan tanpa sadar.

### 24.1 Rule Praktis

Transaksi OLTP sebaiknya:

- pendek,
- deterministik,
- tidak menunggu input manusia,
- tidak melakukan HTTP call eksternal,
- tidak membaca result set raksasa,
- tidak memproses file,
- tidak melakukan sleep,
- tidak mencampur banyak aggregate tanpa kebutuhan kuat.

---

## 25. Java/Spring Pitfalls Yang Memperpanjang Lock

### 25.1 `@Transactional` Terlalu Luas

Buruk:

```java
@Transactional
public void submitCase(SubmitCaseCommand cmd) {
    Case c = caseRepository.findByIdForUpdate(cmd.caseId());
    documentService.generatePdf(c);        // expensive
    notificationClient.sendEmail(c);       // network
    c.submit();
}
```

Lebih baik:

```java
public void submitCase(SubmitCaseCommand cmd) {
    CaseSnapshot snapshot = caseReader.read(cmd.caseId());
    GeneratedDocument doc = documentService.generatePdf(snapshot);

    transactionTemplate.executeWithoutResult(tx -> {
        Case c = caseRepository.findByIdForUpdate(cmd.caseId());
        c.ensureSubmittable();
        c.attachDocument(doc.reference());
        c.submit();
        outboxRepository.insertEmailEvent(c.id());
    });
}
```

Email dikirim oleh outbox consumer setelah commit.

### 25.2 Lazy Loading Dalam Transaksi

ORM lazy loading bisa mengeksekusi query tambahan di dalam transaksi yang Anda kira sederhana.

Contoh:

```java
@Transactional
public void closeCase(Long id) {
    Case c = repository.findByIdForUpdate(id);
    for (Action action : c.getActions()) {
        // lazy load actions
    }
    c.close();
}
```

Jika collection besar, transaksi memanjang dan lock tertahan lebih lama.

### 25.3 Streaming Result Dalam Transaksi

```java
@Transactional(readOnly = true)
public void exportLargeReport() {
    repository.streamAllOpenCases().forEach(row -> writeCsv(row));
}
```

Meski read-only, transaksi panjang bisa mempertahankan read view dan menghambat purge. Jika ada locking read, lebih buruk lagi.

---

## 26. Autocommit dan Lock Release

Di MySQL, jika autocommit aktif, setiap statement adalah transaksi sendiri kecuali Anda eksplisit `START TRANSACTION`.

Contoh:

```sql
UPDATE account
SET balance = balance - 100
WHERE id = 10;
```

Dengan autocommit, lock dilepas setelah statement commit.

Dengan transaksi eksplisit:

```sql
START TRANSACTION;

UPDATE account
SET balance = balance - 100
WHERE id = 10;

-- lock masih ditahan

COMMIT;
```

Lock dilepas saat commit/rollback.

### 26.1 Connection Pool Hazard

Jika kode Java gagal commit/rollback lalu connection dikembalikan ke pool dalam state buruk, efeknya bisa serius. Pool modern biasanya melakukan cleanup, tetapi jangan bergantung pada keajaiban.

Prinsip:

- selalu gunakan transaction manager yang benar,
- jangan manual `setAutoCommit(false)` sembarangan,
- pastikan exception path rollback,
- gunakan timeout,
- monitor active transaction.

---

## 27. Lock Wait Timeout

Error umum:

```text
Lock wait timeout exceeded; try restarting transaction
```

Ini berarti transaksi menunggu lock terlalu lama sampai melewati `innodb_lock_wait_timeout`.

Jangan langsung menaikkan timeout sebagai solusi utama.

Pertanyaan diagnosis:

1. Siapa blocking transaction?
2. Query apa yang ditahan?
3. Query apa yang menahan lock?
4. Berapa lama transaksi blocker berjalan?
5. Apakah ada index yang hilang?
6. Apakah ada external call dalam transaksi?
7. Apakah batch terlalu besar?
8. Apakah isolation level memicu gap/next-key lock yang tidak diantisipasi?
9. Apakah DDL/metadata lock terlibat?

### 27.1 Java Handling

Lock wait timeout tidak selalu aman untuk retry buta.

Harus jelas:

- apakah transaction sudah rollback,
- apakah operasi idempotent,
- apakah side effect eksternal sudah terjadi,
- apakah retry bisa menggandakan event,
- apakah command punya idempotency key.

Pattern:

```java
try {
    transactionTemplate.execute(status -> performBusinessUpdate(command));
} catch (CannotAcquireLockException | PessimisticLockingFailureException e) {
    // retry hanya jika command idempotent dan side effect eksternal belum terjadi
}
```

---

## 28. Deadlock vs Lock Wait Timeout

Deadlock:

```text
A menunggu B, B menunggu A
```

Lock wait timeout:

```text
A menunggu B terlalu lama, tetapi belum tentu ada siklus
```

Deadlock biasanya dideteksi cepat oleh InnoDB. Salah satu transaksi dipilih sebagai korban dan di-rollback.

Lock wait timeout menunggu sampai timeout.

Deadlock akan dibahas lebih detail di part berikutnya, tetapi di sini penting memahami bahwa deadlock sangat berhubungan dengan lock footprint dan urutan akses.

---

## 29. Cara Melihat Lock Yang Sedang Terjadi

Tools penting:

```sql
SHOW ENGINE INNODB STATUS\G
```

Information schema/performance schema views tergantung versi dan konfigurasi, misalnya:

```sql
SELECT *
FROM performance_schema.data_locks;
```

```sql
SELECT *
FROM performance_schema.data_lock_waits;
```

Untuk session/process:

```sql
SHOW PROCESSLIST;
```

Atau:

```sql
SELECT *
FROM information_schema.PROCESSLIST;
```

Untuk transaksi InnoDB:

```sql
SELECT *
FROM information_schema.INNODB_TRX;
```

Di lingkungan modern, biasanya Anda menggabungkan:

- processlist,
- InnoDB transaction view,
- performance schema locks,
- statement digest,
- app trace id,
- slow query log,
- connection pool metrics.

### 29.1 Diagnostic Question

Saat incident, jangan mulai dari “query mana yang lambat?” saja.

Mulai dari:

> “Siapa menunggu siapa, resource apa yang dikunci, dan kenapa transaksi blocker belum selesai?”

---

## 30. Timeline Example: Two Approvers Race

Tabel:

```sql
CREATE TABLE enforcement_case (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    approved_by BIGINT NULL,
    updated_at DATETIME NOT NULL
) ENGINE = InnoDB;
```

### 30.1 Tanpa Lock Yang Benar

Transaksi A:

```sql
START TRANSACTION;
SELECT status FROM enforcement_case WHERE id = 1001;
-- sees UNDER_REVIEW
```

Transaksi B:

```sql
START TRANSACTION;
SELECT status FROM enforcement_case WHERE id = 1001;
-- sees UNDER_REVIEW
```

A:

```sql
UPDATE enforcement_case
SET status = 'APPROVED', approved_by = 10
WHERE id = 1001;
COMMIT;
```

B:

```sql
UPDATE enforcement_case
SET status = 'APPROVED', approved_by = 11
WHERE id = 1001;
COMMIT;
```

Hasil akhir `approved_by = 11`. Approval A tertimpa secara logis.

### 30.2 Conditional Update

A:

```sql
UPDATE enforcement_case
SET status = 'APPROVED', approved_by = 10
WHERE id = 1001
  AND status = 'UNDER_REVIEW';
```

B:

```sql
UPDATE enforcement_case
SET status = 'APPROVED', approved_by = 11
WHERE id = 1001
  AND status = 'UNDER_REVIEW';
```

Salah satu akan affected rows `1`, yang lain `0`.

Ini lebih aman.

### 30.3 Explicit `FOR UPDATE`

A:

```sql
START TRANSACTION;
SELECT status FROM enforcement_case WHERE id = 1001 FOR UPDATE;
-- validate
UPDATE enforcement_case SET status = 'APPROVED', approved_by = 10 WHERE id = 1001;
COMMIT;
```

B akan menunggu pada `SELECT ... FOR UPDATE`, lalu setelah A commit, B membaca status terbaru dan validasi gagal.

Dua pola bisa benar. Pilih berdasarkan kompleksitas invariant.

---

## 31. Timeline Example: Missing Index Membuat Worker Saling Blokir

Tabel:

```sql
CREATE TABLE review_task (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority INT NOT NULL,
    created_at DATETIME NOT NULL,
    reviewer_id BIGINT NULL,
    INDEX idx_status (status)
) ENGINE = InnoDB;
```

Worker tenant 1:

```sql
START TRANSACTION;

SELECT id
FROM review_task
WHERE tenant_id = 1
  AND status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE;
```

Worker tenant 2:

```sql
START TRANSACTION;

SELECT id
FROM review_task
WHERE tenant_id = 2
  AND status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE;
```

Karena index hanya `status`, kedua worker bisa scan area `READY` yang sama, meskipun tenant berbeda.

Efek:

- tenant saling mengganggu,
- lock wait muncul antar tenant,
- fairness buruk,
- throughput worker turun.

Index lebih baik:

```sql
CREATE INDEX idx_review_task_claim
ON review_task (tenant_id, status, priority DESC, created_at, id);
```

Query sekarang bisa mengunci area index per tenant/status/order dengan jauh lebih sempit.

---

## 32. Timeline Example: Gap Lock Pada Non-Existing Business Key

Tabel:

```sql
CREATE TABLE case_number_registry (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    case_number VARCHAR(64) NOT NULL,
    UNIQUE KEY uq_case_number (case_number)
) ENGINE = InnoDB;
```

Transaksi A:

```sql
START TRANSACTION;

SELECT *
FROM case_number_registry
WHERE case_number = 'CASE-2026-000999'
FOR UPDATE;

-- no row found
```

Transaksi B:

```sql
INSERT INTO case_number_registry (case_number)
VALUES ('CASE-2026-000999');
```

Tergantung isolation dan access path, B bisa menunggu karena A mengunci gap tempat value itu akan masuk.

Pertanyaan desain:

> Apakah aplikasi benar-benar perlu lock non-existing row, atau cukup melakukan insert dan handle duplicate key?

Sering kali pattern insert-first lebih sederhana:

```sql
INSERT INTO case_number_registry (case_number)
VALUES (?);
```

Jika duplicate, berarti sudah ada.

---

## 33. `NOWAIT` dan `SKIP LOCKED`

MySQL mendukung modifier yang berguna untuk beberapa pola.

### 33.1 `NOWAIT`

```sql
SELECT *
FROM enforcement_case
WHERE id = 1001
FOR UPDATE NOWAIT;
```

Jika row sedang dikunci, query gagal segera daripada menunggu.

Cocok jika:

- user bisa diberi pesan “sedang diproses user lain”,
- service ingin fail fast,
- retry/queue lebih baik daripada menahan thread.

### 33.2 `SKIP LOCKED`

```sql
SELECT *
FROM task_queue
WHERE status = 'READY'
ORDER BY priority DESC, created_at, id
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

Cocok untuk work queue parallel.

Namun jangan pakai untuk logic yang membutuhkan strict ordering global atau strong fairness.

---

## 34. Locking dan Isolation Level

### 34.1 `REPEATABLE READ`

Default MySQL sering memakai `REPEATABLE READ`.

Pada level ini, range locking reads bisa memakai next-key locks untuk mencegah phantom.

### 34.2 `READ COMMITTED`

Pada `READ COMMITTED`, gap locking lebih terbatas dalam banyak kasus, tetapi tidak hilang total. Gap lock masih dapat digunakan untuk foreign key checking dan duplicate-key checking.

Beberapa tim memilih `READ COMMITTED` untuk mengurangi locking surprise. Namun itu bukan free lunch:

- repeatable read semantics berubah,
- statement yang sama bisa melihat data berbeda dalam transaksi,
- aplikasi harus siap dengan anomaly tertentu,
- invariant perlu dijaga dengan lock/constraint/update predicate yang benar.

### 34.3 Kesimpulan

Jangan memilih isolation level hanya karena “lebih cepat” atau “lebih familiar”. Pilih berdasarkan:

- invariant bisnis,
- contention pattern,
- query shape,
- retry design,
- replication/binlog considerations,
- pengalaman operasional tim.

---

## 35. Locking Dalam Sistem Regulatory / Case Management

Sistem enforcement/case management biasanya memiliki karakteristik:

- entity lifecycle panjang,
- banyak aktor manusia,
- SLA dan escalation job,
- audit trail wajib,
- approval multi-step,
- external integration,
- status transition sensitif,
- reporting dan search berat,
- legal defensibility.

Locking harus mendukung invariant seperti:

1. Case tidak boleh ditutup jika masih ada action mandatory yang belum selesai.
2. Dua officer tidak boleh mengambil task yang sama.
3. Escalation tidak boleh menimpa manual override.
4. Appeal tidak boleh dibuat dua kali untuk decision yang sama.
5. Audit event harus merekam state transition yang benar.
6. SLA job tidak boleh mengubah case yang sudah closed.
7. Retention purge tidak boleh menghapus case dalam legal hold.

### 35.1 Contoh State Guard Dengan Conditional Update

```sql
UPDATE enforcement_case
SET status = 'ESCALATED',
    escalated_at = NOW(),
    version = version + 1
WHERE id = ?
  AND status = 'UNDER_REVIEW'
  AND legal_hold = 0;
```

Aplikasi cek affected rows.

Jika `0`, cari penyebab:

- status sudah berubah,
- legal hold aktif,
- case tidak ada.

### 35.2 Contoh Multi-Row Invariant Dengan Lock

Misalnya case hanya bisa close jika semua mandatory actions selesai.

```sql
START TRANSACTION;

SELECT id, status
FROM enforcement_case
WHERE id = ?
FOR UPDATE;

SELECT id
FROM enforcement_action
WHERE case_id = ?
  AND mandatory = 1
  AND status <> 'DONE'
FOR UPDATE;

-- jika tidak ada action pending, close case

UPDATE enforcement_case
SET status = 'CLOSED', closed_at = NOW()
WHERE id = ?;

INSERT INTO case_status_history (...);

COMMIT;
```

Ini bisa benar, tapi perhatikan:

- index `enforcement_action(case_id, mandatory, status, id)`,
- urutan lock konsisten di semua code path,
- transaksi pendek,
- jangan kirim notifikasi sebelum commit,
- history insert ikut transaksi.

---

## 36. Common Anti-Patterns

### 36.1 `SELECT` Lalu Update Tanpa Guard

Buruk:

```sql
SELECT status FROM case WHERE id = ?;
-- application checks status
UPDATE case SET status = ? WHERE id = ?;
```

Lebih baik:

```sql
UPDATE case
SET status = ?
WHERE id = ?
  AND status = ?;
```

atau gunakan `FOR UPDATE` jika invariant kompleks.

### 36.2 Long Transaction Dengan External Side Effect

Buruk:

```text
BEGIN
lock case
send email
call external API
update case
COMMIT
```

Lebih baik:

```text
BEGIN
update case
insert outbox event
COMMIT
send email asynchronously from outbox
```

### 36.3 Range Update Besar Saat Traffic Tinggi

Buruk:

```sql
UPDATE case
SET archived = 1
WHERE created_at < '2024-01-01';
```

Lebih baik:

- batch,
- partition,
- archive table,
- low-traffic window,
- monitoring,
- resumable job.

### 36.4 Locking Query Tanpa Index Yang Sesuai

Buruk:

```sql
SELECT *
FROM task
WHERE tenant_id = ?
  AND status = 'READY'
ORDER BY priority DESC
LIMIT 1
FOR UPDATE;
```

tanpa index `(tenant_id, status, priority, id)` atau varian yang sesuai.

### 36.5 Menyelesaikan Lock Wait Dengan Menaikkan Timeout

Menaikkan timeout hanya memperpanjang penderitaan jika root cause-nya:

- transaction terlalu panjang,
- index hilang,
- batch terlalu besar,
- deadlock pattern,
- external call dalam transaksi,
- DDL blocked.

---

## 37. Design Heuristics Untuk Locking Query

Gunakan checklist ini saat mendesain operasi yang memakai update/delete/select-for-update.

### 37.1 Predicate

Tanyakan:

- Apakah predicate memakai primary key?
- Apakah predicate memakai unique key?
- Apakah predicate range?
- Apakah predicate bisa match banyak row?
- Apakah ada optional filter yang membuat index tidak efektif?
- Apakah predicate mencakup tenant boundary?

### 37.2 Index

Tanyakan:

- Index mana yang akan dipakai?
- Apakah index mendukung filter dan order?
- Apakah query akan scan row yang tidak perlu?
- Apakah lock footprint terisolasi per tenant/workflow/status?
- Apakah update mengubah kolom indexed?

### 37.3 Transaction

Tanyakan:

- Berapa lama transaksi berjalan?
- Apakah ada network call?
- Apakah ada file processing?
- Apakah ada lazy loading?
- Apakah ada batch besar?
- Apakah retry aman?

### 37.4 Business Invariant

Tanyakan:

- Apakah cukup conditional update?
- Apakah perlu `FOR UPDATE`?
- Apakah perlu unique constraint?
- Apakah perlu version column?
- Apakah perlu outbox?
- Apakah operation idempotent?

---

## 38. Locking Strategy Patterns

### 38.1 Pattern A: Conditional Single-Row Transition

Cocok untuk state transition sederhana.

```sql
UPDATE enforcement_case
SET status = 'APPROVED',
    version = version + 1
WHERE id = ?
  AND status = 'UNDER_REVIEW';
```

Pros:

- pendek,
- atomic,
- tidak perlu select dulu,
- lock duration minimal.

Cons:

- kurang cocok jika validasi kompleks,
- aplikasi perlu menangani affected rows.

### 38.2 Pattern B: Pessimistic Lock Aggregate Root

```sql
START TRANSACTION;

SELECT *
FROM enforcement_case
WHERE id = ?
FOR UPDATE;

-- validate multiple fields
-- update children/history

COMMIT;
```

Pros:

- jelas untuk aggregate-level invariant,
- mudah dipahami.

Cons:

- bisa bottleneck jika aggregate hot,
- transaksi harus pendek,
- perlu urutan lock konsisten.

### 38.3 Pattern C: Unique Insert As Concurrency Guard

```sql
INSERT INTO approval_attempt (case_id, decision_id, actor_id, created_at)
VALUES (?, ?, ?, NOW());
```

dengan:

```sql
UNIQUE KEY uq_approval_once (case_id, decision_id)
```

Pros:

- atomic,
- sangat kuat untuk idempotency/dedup,
- sederhana.

Cons:

- perlu desain error handling,
- perlu cleanup/retention.

### 38.4 Pattern D: Queue Claim With `SKIP LOCKED`

```sql
START TRANSACTION;

SELECT id
FROM task_queue
WHERE status = 'READY'
ORDER BY priority DESC, created_at, id
LIMIT 10
FOR UPDATE SKIP LOCKED;

UPDATE task_queue
SET status = 'IN_PROGRESS', locked_by = ?, locked_at = NOW()
WHERE id IN (...);

COMMIT;
```

Pros:

- parallel worker friendly,
- menghindari menunggu row locked.

Cons:

- fairness tidak sempurna,
- perlu lease recovery,
- index harus tepat.

---

## 39. Operational Runbook: Ketika Aplikasi Stuck Karena Lock

Saat aplikasi mulai timeout dan MySQL terlihat stuck:

### 39.1 Jangan Langsung Restart Aplikasi

Restart aplikasi bisa:

- memperbanyak retry storm,
- membuat connection spike,
- memperparah load,
- menyembunyikan root cause.

### 39.2 Pertanyaan Pertama

1. Apakah ini row lock, metadata lock, atau resource saturation?
2. Query mana yang menunggu?
3. Query mana yang blocking?
4. Transaksi blocker sudah berjalan berapa lama?
5. User/service mana pemilik blocker?
6. Apakah blocker aman di-kill?
7. Apakah ada migration/DDL berjalan?
8. Apakah ada job batch/purge/report?

### 39.3 Query Investigasi

Contoh umum:

```sql
SHOW PROCESSLIST;
```

```sql
SHOW ENGINE INNODB STATUS\G
```

```sql
SELECT *
FROM information_schema.INNODB_TRX
ORDER BY trx_started;
```

Jika Performance Schema tersedia:

```sql
SELECT *
FROM performance_schema.data_lock_waits;
```

```sql
SELECT *
FROM performance_schema.data_locks;
```

### 39.4 Decision

- Jika query blocker adalah SELECT biasa dalam transaksi idle lama, kemungkinan bisa kill session setelah validasi.
- Jika blocker adalah business transaction penting, pertimbangkan dampak rollback.
- Jika blocker adalah DDL, pahami antrean MDL sebelum membatalkan.
- Jika banyak waiter, hentikan traffic/job penyebab sebelum retry storm.

---

## 40. Hubungan Locking Dengan Connection Pool

Lock wait tidak hanya memakan waktu database. Ia juga menahan thread aplikasi dan connection pool.

Misalnya:

- Hikari pool size = 30
- 30 request masuk
- semua menunggu lock row yang sama
- pool habis
- request lain tidak bisa mendapatkan connection
- service terlihat down

Root cause satu row hot, gejala menjadi full service outage.

### 40.1 Mitigasi

- transaction timeout,
- query timeout,
- circuit breaker di level service,
- fail-fast `NOWAIT` untuk use case tertentu,
- retry dengan backoff,
- idempotency,
- reduce hot row,
- shard logical queue,
- redesign aggregate contention.

---

## 41. Hot Row dan Contention

Hot row adalah row yang sering diupdate banyak transaksi.

Contoh:

```sql
UPDATE tenant_counter
SET next_number = next_number + 1
WHERE tenant_id = ?;
```

Jika satu tenant sangat aktif, row counter menjadi bottleneck.

Alternatif:

- allocate number range per worker,
- use auto-increment separate table,
- use external ID generator,
- use optimistic retry if acceptable,
- redesign numbering requirement,
- decouple display number from transaction critical path.

Dalam regulatory system, hati-hati dengan requirement “nomor harus berurutan tanpa gap”. Ini sering mahal secara concurrency dan recovery. Secara audit/legal, biasanya yang dibutuhkan adalah traceability, bukan selalu gapless sequence. Tetapi domain harus memastikan.

---

## 42. Locking dan Audit Trail

Audit trail sering diinsert dalam transaksi yang sama dengan state change.

Contoh:

```sql
START TRANSACTION;

UPDATE enforcement_case
SET status = 'APPROVED'
WHERE id = ?
  AND status = 'UNDER_REVIEW';

INSERT INTO case_audit_event (
    case_id,
    event_type,
    actor_id,
    occurred_at,
    payload
) VALUES (?, 'CASE_APPROVED', ?, NOW(), ?);

COMMIT;
```

Ini baik karena audit event atomic dengan state change.

Namun audit table bisa menjadi write-heavy. Perhatikan:

- primary key append-friendly,
- index jangan berlebihan,
- partition/archival strategy,
- jangan update audit row,
- payload besar bisa menambah I/O,
- jangan query audit besar dalam transaksi state change.

---

## 43. Practical SQL Lab

Anda bisa membuat lab sederhana.

Session 1:

```sql
CREATE TABLE lock_lab (
    id INT PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_status_created (status, created_at)
) ENGINE = InnoDB;

INSERT INTO lock_lab VALUES
(10, 'OPEN', NOW()),
(20, 'OPEN', NOW()),
(30, 'CLOSED', NOW());
```

Session 1:

```sql
START TRANSACTION;

SELECT *
FROM lock_lab
WHERE id BETWEEN 10 AND 20
FOR UPDATE;
```

Session 2:

```sql
INSERT INTO lock_lab VALUES (15, 'OPEN', NOW());
```

Amati apakah insert menunggu.

Session 3:

```sql
SHOW PROCESSLIST;
SHOW ENGINE INNODB STATUS\G
```

Lalu commit Session 1:

```sql
COMMIT;
```

Session 2 akan lanjut.

### 43.1 Eksperimen Lanjutan

Coba ubah:

- isolation level ke `READ COMMITTED`,
- predicate equality unique,
- predicate non-indexed,
- index composite,
- `FOR UPDATE NOWAIT`,
- `FOR UPDATE SKIP LOCKED`.

Tujuannya bukan menghafal semua output, tetapi melihat hubungan:

```text
query shape + index + isolation + transaction duration = locking behavior
```

---

## 44. Mental Model Utama

Simpan model ini:

```text
Aplikasi Java tidak mengunci object.
SQL statement tidak selalu mengunci row yang Anda bayangkan.
InnoDB mengunci index records, gaps, atau ranges berdasarkan access path.
Access path ditentukan oleh optimizer dan index.
Lock ditahan sampai transaction boundary.
Semakin lama transaksi, semakin lama konflik hidup.
Semakin buruk index, semakin besar lock footprint.
Semakin besar lock footprint, semakin besar peluang deadlock/timeout.
```

Atau lebih pendek:

```text
Concurrency in MySQL is not only about transactions.
It is about transaction boundary + query shape + index design + lock duration + retry semantics.
```

---

## 45. Checklist Untuk Code Review Java + MySQL

Saat review PR yang menyentuh data mutation, tanyakan:

1. Apakah operasi ini single-row atau range?
2. Apakah query update/delete punya index yang tepat?
3. Apakah ada state transition guard di `WHERE`?
4. Apakah perlu `FOR UPDATE`, atau cukup conditional update?
5. Apakah transaksi terlalu luas?
6. Apakah ada external API call dalam transaksi?
7. Apakah ada lazy loading dalam transaksi?
8. Apakah operation idempotent?
9. Apakah retry aman?
10. Apakah unique constraint bisa menggantikan check-then-insert?
11. Apakah batch size dibatasi?
12. Apakah lock order konsisten dengan code path lain?
13. Apakah ada foreign key/cascade side effect?
14. Apakah migration/DDL bisa terpengaruh transaksi ini?
15. Apakah observability cukup untuk debug jika stuck?

---

## 46. Kesalahan Cara Berpikir Yang Harus Dihindari

### 46.1 “Row Lock Berarti Hanya Row Itu”

Tidak selalu. Bisa ada gap, next-key, secondary index, FK, dan scan luas.

### 46.2 “SELECT Dalam Transaction Berarti Aman”

Tidak. SELECT biasa tidak mengunci. Gunakan conditional update, versioning, unique constraint, atau locking read sesuai kebutuhan.

### 46.3 “Deadlock Berarti Database Rusak”

Tidak. Deadlock normal di sistem konkuren. Yang penting adalah mengurangi frekuensi dan membuat retry aman.

### 46.4 “Menaikkan Timeout Menyelesaikan Masalah”

Sering salah. Timeout lebih tinggi bisa memperlama outage.

### 46.5 “Index Hanya Untuk Speed”

Salah untuk locking query. Index juga menentukan area yang dikunci.

---

## 47. Ringkasan

Di bagian ini kita membangun fondasi locking InnoDB.

Poin paling penting:

1. InnoDB locking sangat terkait dengan index.
2. Record lock mengunci index record.
3. Gap lock mengunci celah antar index record.
4. Next-key lock mengunci record plus gap sebelumnya.
5. Locking read berbeda dari consistent read.
6. `SELECT` biasa tidak otomatis mengunci row.
7. `FOR UPDATE` kuat, tetapi bisa berbahaya jika transaksi panjang atau index buruk.
8. Unique constraint bisa menjadi concurrency primitive.
9. Conditional update sering lebih baik daripada select-then-update.
10. Range update/delete harus hati-hati.
11. Queue worker bisa memakai `SKIP LOCKED`, tetapi butuh index dan recovery design.
12. Lock wait bisa menghabiskan connection pool dan membuat outage aplikasi.
13. Solusi locking bukan hanya SQL tuning, tetapi juga transaction boundary, Java code structure, retry, idempotency, dan workflow design.

---

## 48. Latihan Pemahaman

Jawab pertanyaan ini sebelum lanjut:

1. Apa perbedaan consistent read dan current read?
2. Kenapa `SELECT ... FOR UPDATE` terhadap row yang tidak ada bisa memblokir insert?
3. Kenapa index buruk bisa memperluas lock footprint?
4. Kapan conditional update lebih baik daripada `SELECT ... FOR UPDATE`?
5. Kenapa external HTTP call dalam transaksi berbahaya?
6. Apa bedanya lock wait timeout dan deadlock?
7. Bagaimana unique constraint bisa dipakai sebagai concurrency control?
8. Kenapa queue worker membutuhkan index yang sesuai dengan claim query?
9. Apa risiko `SKIP LOCKED`?
10. Dalam case lifecycle system, invariant apa yang harus dijaga dengan locking atau conditional update?

---

## 49. Koneksi Ke Part Berikutnya

Bagian ini menjelaskan jenis lock dan bagaimana lock footprint terbentuk.

Part berikutnya akan fokus pada salah satu konsekuensi paling penting dari locking:

> **Deadlocks and Lock Wait Timeouts: Diagnosis and Design**

Kita akan membahas:

- kenapa deadlock terjadi,
- pola deadlock umum di aplikasi Java,
- cara membaca deadlock report,
- cara mendesain urutan update,
- retry transaction yang benar,
- idempotency boundary,
- runbook production ketika deadlock/timeout meningkat.

---

## Status Seri

- Seri: `learn-mysql-mastery-for-java-engineers`
- Part selesai: `008 / 034`
- Status: **Belum selesai**
- Berikutnya: `learn-mysql-mastery-for-java-engineers-part-009.md`


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Isolation Levels in MySQL: Repeatable Read Is Not What Many Think</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-009.md">Part 009 — Deadlocks and Lock Wait Timeouts: Diagnosis and Design ➡️</a>
</div>
