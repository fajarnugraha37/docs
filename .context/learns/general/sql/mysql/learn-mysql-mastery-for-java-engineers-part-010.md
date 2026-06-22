# learn-mysql-mastery-for-java-engineers-part-010.md

# Part 010 — Index Internals: B+Tree, Clustered Index, Secondary Index Cost

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `010 / 034`  
> Fokus: memahami index MySQL/InnoDB sebagai struktur data fisik, bukan sekadar “alat mempercepat query”.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah masuk ke transaksi, isolation level, locking, deadlock, dan lock wait timeout. Sekarang kita masuk ke salah satu fondasi paling besar dalam performa dan correctness MySQL: **index**.

Banyak engineer tahu kalimat seperti:

> “Tambahkan index supaya query lebih cepat.”

Itu benar, tetapi terlalu dangkal.

Index di MySQL, khususnya InnoDB, bukan hanya alat untuk mempercepat pencarian. Index adalah struktur data fisik yang memengaruhi:

- cara data disimpan;
- cara row ditemukan;
- jumlah page yang dibaca;
- jumlah lock yang diambil;
- biaya insert/update/delete;
- ukuran storage;
- replication throughput;
- buffer pool pressure;
- deadlock probability;
- performa migration;
- cara optimizer memilih execution plan.

Setelah mempelajari bagian ini, targetnya kamu mampu menjawab pertanyaan seperti:

1. Kenapa primary key di InnoDB sangat penting secara fisik?
2. Kenapa secondary index di InnoDB selalu membawa primary key?
3. Kenapa query yang memakai index belum tentu cepat?
4. Kenapa index bisa memperlambat write path?
5. Kenapa composite index harus didesain berdasarkan pola akses, bukan hanya kolom populer?
6. Kenapa `SELECT *` bisa menghancurkan manfaat index?
7. Kenapa index yang bagus untuk read-heavy system bisa buruk untuk write-heavy workflow?
8. Kenapa missing index bisa memperbesar lock footprint?
9. Bagaimana cara berpikir tentang covering index, prefix index, invisible index, functional index, descending index, dan multi-valued index?

Bagian ini bukan sekadar tutorial `CREATE INDEX`. Kita akan membangun mental model dari bawah.

---

## 1. Index Sebagai Struktur Data Fisik

Secara konseptual, index adalah struktur data yang membuat database tidak perlu membaca seluruh table untuk menemukan row tertentu.

Tanpa index, untuk mencari:

```sql
SELECT *
FROM enforcement_case
WHERE case_number = 'CASE-2026-000123';
```

MySQL mungkin harus membaca banyak row dari table, satu per satu, sampai menemukan row yang cocok. Ini disebut full table scan.

Dengan index pada `case_number`, database bisa melakukan lookup melalui struktur data terurut.

```sql
CREATE INDEX idx_enforcement_case_case_number
ON enforcement_case (case_number);
```

Tetapi di InnoDB, index tidak berdiri di ruang abstrak. Index disimpan dalam page, tersusun sebagai B+Tree, berada dalam tablespace, memakai buffer pool, dan berubah setiap kali ada write.

Jadi mental model yang benar bukan:

> index = shortcut query

Melainkan:

> index = struktur data fisik tambahan yang mempercepat sebagian pola baca dengan menambah biaya pada penyimpanan, perubahan data, memory, logging, dan maintenance.

Setiap index adalah kontrak biaya.

---

## 2. Bukan Semua Index Sama

Di MySQL/InnoDB, ada beberapa jenis dan bentuk index yang perlu dibedakan:

| Jenis | Makna |
|---|---|
| Primary key / clustered index | Struktur utama tempat row table disimpan secara fisik/logis oleh InnoDB |
| Secondary index | Index tambahan selain primary key |
| Unique index | Index yang juga menegakkan uniqueness constraint |
| Composite index | Index dengan lebih dari satu kolom |
| Covering index | Index yang cukup untuk menjawab query tanpa membaca clustered row |
| Prefix index | Index hanya pada prefix dari string/blob column |
| Functional index | Index berdasarkan ekspresi/fungsi |
| Descending index | Index dengan urutan descending secara fisik/logis untuk optimisasi order tertentu |
| Invisible index | Index yang ada tetapi disembunyikan dari optimizer untuk eksperimen |
| Full-text index | Index khusus pencarian teks |
| Spatial index | Index untuk data geospatial |
| Multi-valued index | Index untuk elemen array JSON tertentu |

Bagian ini fokus pada index B+Tree InnoDB karena itu yang paling fundamental untuk OLTP MySQL.

---

## 3. B+Tree Mental Model

InnoDB menggunakan struktur B+Tree untuk index utamanya.

B+Tree adalah tree terurut yang dirancang agar efisien untuk storage berbasis page/block.

Struktur sederhananya:

```text
                 [root page]
                     |
        +------------+------------+
        |                         |
  [internal page]           [internal page]
        |                         |
   +----+----+               +----+----+
   |         |               |         |
[leaf]    [leaf]          [leaf]    [leaf]
```

Ciri penting B+Tree:

1. Key disimpan dalam urutan terurut.
2. Root dan internal page mengarahkan pencarian.
3. Leaf page menyimpan entry index.
4. Semua leaf berada pada level yang sama.
5. Leaf page saling terhubung secara berurutan, sehingga range scan efisien.

Untuk lookup equality:

```sql
WHERE case_id = 12345
```

Database bergerak:

```text
root -> internal page -> leaf page -> entry
```

Untuk range scan:

```sql
WHERE created_at >= '2026-01-01'
  AND created_at <  '2026-02-01'
```

Database menemukan awal range, lalu berjalan berurutan di leaf page.

```text
find first matching leaf entry -> scan forward until range ends
```

Ini alasan index B+Tree sangat bagus untuk:

- equality lookup;
- range lookup;
- ordered scan;
- prefix matching pada composite key;
- `ORDER BY` tertentu;
- `MIN` / `MAX` tertentu;
- seek pagination.

Tetapi B+Tree tidak ajaib untuk semua hal.

B+Tree biasanya buruk untuk:

- pencarian substring tengah seperti `%abc%`;
- predicate dengan fungsi yang merusak sargability;
- filter sangat tidak selektif;
- dynamic OR yang tidak cocok dengan urutan index;
- sorting yang tidak sesuai urutan index;
- search relevance kompleks.

---

## 4. Page-Based Thinking

Di InnoDB, data dan index disimpan dalam page. Ukuran page default InnoDB adalah 16KB.

Ini berarti database tidak membaca satu row saja dari disk. Database membaca page.

Jika satu page berisi 100 index entry, membaca satu page bisa membawa 100 entry ke memory. Jika page sudah ada di buffer pool, lookup bisa jauh lebih cepat.

Mental model:

```text
Query tidak membayar per row saja.
Query membayar per page yang harus dikunjungi.
```

Index yang baik mengurangi jumlah page yang perlu dibaca.

Index yang buruk bisa membuat database:

- membaca banyak leaf page;
- melakukan banyak random lookup ke clustered index;
- membaca row yang akhirnya dibuang oleh filter;
- melakukan sort tambahan;
- membuat temporary table;
- melakukan locking lebih luas.

---

## 5. Clustered Index: Table Adalah Primary Key B+Tree

Ini konsep paling penting dalam InnoDB:

> Dalam InnoDB, table disimpan sebagai clustered index berdasarkan primary key.

Artinya, row table sebenarnya berada di leaf page dari primary key B+Tree.

Misalnya table:

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL,
    case_number VARCHAR(50) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    summary VARCHAR(500),
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_number (case_number),
    KEY idx_subject_status_created (subject_id, status, created_at)
) ENGINE = InnoDB;
```

Primary key `id` adalah clustered index.

Leaf node primary key menyimpan seluruh row:

```text
PRIMARY KEY B+Tree

leaf entry:
(id=1001) -> full row columns
(id=1002) -> full row columns
(id=1003) -> full row columns
```

Jadi ketika query memakai primary key:

```sql
SELECT *
FROM enforcement_case
WHERE id = 1002;
```

InnoDB mencari entry `id=1002` di clustered index dan langsung mendapatkan row lengkap.

Tidak ada lookup tambahan.

---

## 6. Secondary Index: Menyimpan Key + Primary Key

Secondary index di InnoDB tidak menyimpan pointer fisik langsung ke row. Secondary index menyimpan:

```text
secondary index key + primary key value
```

Contoh:

```sql
KEY idx_subject_status_created (subject_id, status, created_at)
```

Entry leaf secondary index kira-kira berisi:

```text
(subject_id, status, created_at, primary_key_id)
```

Bila query:

```sql
SELECT *
FROM enforcement_case
WHERE subject_id = 9001
  AND status = 'OPEN'
ORDER BY created_at
LIMIT 20;
```

InnoDB dapat mencari di secondary index:

```text
(subject_id=9001, status='OPEN', created_at=..., id=...)
```

Tetapi jika query meminta kolom yang tidak ada di secondary index, InnoDB harus melakukan lookup lagi ke clustered index menggunakan primary key.

Ini disebut:

- clustered index lookup;
- primary key lookup;
- bookmark lookup;
- table lookup.

Alurnya:

```text
secondary index scan
    -> dapat primary key id
    -> lookup clustered index by id
    -> ambil full row
```

Jika hanya 20 row, ini mungkin murah.

Jika 500.000 row, ini bisa sangat mahal.

---

## 7. Secondary Index Amplification

Karena setiap secondary index menyimpan primary key, ukuran primary key memengaruhi ukuran semua secondary index.

Misalnya table punya 5 secondary index.

Jika primary key adalah `BIGINT` 8 byte, setiap secondary index membawa tambahan sekitar 8 byte plus overhead.

Jika primary key adalah `CHAR(36)` UUID string, setiap secondary index membawa tambahan 36 byte plus collation/encoding overhead.

Jika primary key composite besar:

```sql
PRIMARY KEY (tenant_id, regulatory_domain, case_number, version)
```

maka setiap secondary index membawa seluruh primary key composite tersebut.

Dampaknya:

- index lebih besar;
- buffer pool lebih cepat penuh;
- lebih banyak page read;
- lebih banyak redo log;
- lebih mahal insert/update/delete;
- backup lebih besar;
- replication lebih berat;
- DDL lebih mahal.

Inilah mengapa primary key design bukan hanya masalah “identifier style”.

Primary key adalah keputusan fisik sistem.

---

## 8. Clustered Lookup Cost

Misalnya ada index:

```sql
CREATE INDEX idx_status_created
ON enforcement_case (status, created_at);
```

Query:

```sql
SELECT id, case_number, subject_id, status, created_at, summary
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 1000;
```

Index dapat menemukan 1000 row pertama dengan status `OPEN` berdasarkan `created_at`.

Tetapi index hanya berisi:

```text
(status, created_at, id)
```

Kolom `case_number`, `subject_id`, dan `summary` tidak ada di index.

Maka untuk setiap entry index, InnoDB perlu lookup ke clustered index:

```text
1000 secondary index entries
+ 1000 clustered index lookups
```

Jika clustered pages tersebar random, biaya random I/O atau buffer pool miss bisa tinggi.

Ini alasan query yang “pakai index” masih bisa lambat.

`EXPLAIN` mungkin menunjukkan index digunakan, tetapi index usage tidak selalu berarti query optimal.

---

## 9. Covering Index

Covering index terjadi ketika semua kolom yang dibutuhkan query tersedia di index.

Contoh:

```sql
CREATE INDEX idx_status_created_cover
ON enforcement_case (status, created_at, id, case_number, subject_id);
```

Query:

```sql
SELECT id, case_number, subject_id, status, created_at
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 100;
```

Kolom yang dibutuhkan:

- `id`
- `case_number`
- `subject_id`
- `status`
- `created_at`

Semuanya ada di index.

Maka InnoDB tidak perlu membaca clustered row.

Ini disebut covering index.

Di `EXPLAIN`, biasanya terlihat `Using index` pada Extra.

Mental model:

```text
Non-covering index:
secondary index -> primary key lookup -> full row

Covering index:
secondary index -> answer query directly
```

Covering index sangat berguna untuk:

- dashboard ringan;
- list screen;
- lookup summary;
- pagination;
- queue polling;
- existence check;
- count/filter tertentu.

Tetapi covering index punya biaya:

- index lebih lebar;
- lebih banyak storage;
- lebih mahal write;
- lebih besar buffer pool footprint;
- lebih mahal rebuild;
- bisa redundant dengan index lain.

Jangan membuat semua index menjadi covering index. Gunakan untuk query yang benar-benar penting, sering, dan latency-sensitive.

---

## 10. `SELECT *` dan Hilangnya Covering Index

Salah satu kebiasaan buruk di aplikasi adalah `SELECT *`.

Misalnya ada query list page:

```sql
SELECT *
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 50;
```

Padahal UI hanya butuh:

- case number;
- subject name/id;
- status;
- created date;
- priority.

Jika `SELECT *`, maka MySQL harus mengambil semua kolom, termasuk kolom besar:

- `description TEXT`
- `payload JSON`
- `last_error_stack TEXT`
- `notes TEXT`

Akibatnya:

- covering index tidak bisa digunakan;
- clustered lookup meningkat;
- network payload membesar;
- object hydration Java membesar;
- GC pressure meningkat;
- serialization cost meningkat;
- response time naik.

Untuk Java engineer, ini penting:

> Repository method untuk list screen sebaiknya tidak otomatis mengambil full entity.

Gunakan projection/DTO query bila cocok.

Contoh:

```sql
SELECT id, case_number, subject_id, status, priority, created_at
FROM enforcement_case
WHERE status = ?
ORDER BY created_at, id
LIMIT ?;
```

Bukan:

```sql
SELECT *
FROM enforcement_case
WHERE status = ?
ORDER BY created_at
LIMIT ?;
```

---

## 11. Composite Index

Composite index adalah index dengan lebih dari satu kolom.

```sql
CREATE INDEX idx_tenant_status_created
ON enforcement_case (tenant_id, status, created_at);
```

Urutan kolom sangat penting.

Composite index B+Tree disusun berdasarkan tuple key:

```text
(tenant_id, status, created_at)
```

Data diurutkan seperti kamus:

```text
(1, 'CLOSED', 2026-01-01)
(1, 'CLOSED', 2026-01-02)
(1, 'OPEN',   2026-01-01)
(1, 'OPEN',   2026-01-02)
(2, 'CLOSED', 2026-01-01)
(2, 'OPEN',   2026-01-01)
```

Index ini bagus untuk query:

```sql
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at
```

Karena database bisa langsung menemukan range:

```text
tenant_id = X, status = Y, created_at ordered
```

Tetapi index ini tidak sama efektif untuk:

```sql
WHERE status = ?
ORDER BY created_at
```

Karena kolom pertama `tenant_id` dilewati.

---

## 12. Leftmost Prefix Rule

Composite index dapat digunakan dari kiri ke kanan.

Untuk index:

```sql
INDEX idx_a_b_c (a, b, c)
```

Biasanya berguna untuk:

```sql
WHERE a = ?
```

```sql
WHERE a = ? AND b = ?
```

```sql
WHERE a = ? AND b = ? AND c = ?
```

```sql
WHERE a = ? AND b BETWEEN ? AND ?
```

Tetapi tidak optimal untuk:

```sql
WHERE b = ?
```

```sql
WHERE c = ?
```

```sql
WHERE b = ? AND c = ?
```

Karena `a` sebagai prefix kiri tidak digunakan.

Namun MySQL optimizer memiliki beberapa kemampuan tambahan seperti index skip scan pada kondisi tertentu, tetapi jangan menjadikan itu desain utama. Desain utama tetap berdasarkan pola akses yang jelas.

Mental model:

```text
Composite index bukan kumpulan index individual.
Index (a, b, c) bukan sama dengan index(a), index(b), index(c).
```

---

## 13. Equality, Range, Order: Urutan Berpikir Composite Index

Untuk query OLTP, urutan berpikir praktis:

1. Kolom equality yang paling membatasi scope awal.
2. Kolom equality lain yang selalu muncul bersama.
3. Kolom range.
4. Kolom untuk ordering.
5. Kolom tambahan untuk covering, bila benar-benar penting.

Contoh query:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
  AND created_at >= ?
  AND created_at < ?
ORDER BY created_at, id
LIMIT 100;
```

Index kandidat:

```sql
CREATE INDEX idx_case_tenant_status_created_id
ON enforcement_case (tenant_id, status, created_at, id);
```

Kenapa?

- `tenant_id` membatasi tenant;
- `status` membatasi status;
- `created_at` menjadi range sekaligus order;
- `id` membantu tie-breaker ordering stabil.

Bila query selalu multi-tenant? `tenant_id` harus di depan.

Bila query global admin lintas tenant? Mungkin perlu index berbeda.

Inilah alasan index harus didesain berdasarkan workload, bukan berdasarkan intuisi kolom mana yang “sering difilter”.

---

## 14. Range Condition Menghentikan Efektivitas Prefix Lanjutan

Untuk index:

```sql
INDEX idx_a_b_c (a, b, c)
```

Query:

```sql
WHERE a = ?
  AND b > ?
  AND c = ?
```

Kolom `a` digunakan equality.

Kolom `b` digunakan range.

Setelah range pada `b`, kolom `c` biasanya tidak bisa digunakan untuk mempersempit range B+Tree dengan cara yang sama seperti equality prefix. MySQL mungkin masih bisa melakukan filter menggunakan index condition pushdown, tetapi secara mental model, range sering menjadi batas utama pemanfaatan urutan index.

Jadi desain index perlu memperhatikan:

- kolom mana equality;
- kolom mana range;
- kolom mana ordering;
- apakah setelah range masih ada filter yang sangat selektif.

Contoh buruk:

```sql
INDEX idx_created_status (created_at, status)
```

Untuk query:

```sql
WHERE created_at >= ?
  AND created_at < ?
  AND status = 'OPEN'
```

Jika range tanggal luas, MySQL harus scan banyak entry lalu filter status.

Sering lebih baik:

```sql
INDEX idx_status_created (status, created_at)
```

Jika `status` adalah filter equality penting.

Tetapi jika status sangat low-cardinality dan query tanggal sangat sempit, pilihan bisa berbeda. Selalu validasi dengan data realistis.

---

## 15. Cardinality dan Selectivity

Cardinality adalah jumlah nilai berbeda dalam kolom/index.

Selectivity adalah seberapa besar filter mengurangi jumlah row.

Contoh:

- `id` sangat selektif;
- `case_number` sangat selektif;
- `tenant_id` mungkin cukup selektif tergantung distribusi;
- `status` biasanya rendah selektivitas;
- `is_deleted` sangat rendah selektivitas;
- `created_at` bisa selektif jika range kecil.

Index pada kolom low-cardinality tidak selalu buruk, tetapi harus digunakan dengan konteks.

Index pada `status` saja:

```sql
CREATE INDEX idx_status ON enforcement_case (status);
```

Jika 60% row berstatus `CLOSED`, query:

```sql
WHERE status = 'CLOSED'
```

mungkin tidak terbantu banyak. Database bisa membaca terlalu banyak row.

Tetapi index composite:

```sql
CREATE INDEX idx_status_created ON enforcement_case (status, created_at);
```

bisa sangat berguna untuk:

```sql
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 100;
```

Karena meskipun status low-cardinality, index membantu menemukan subset berurutan dan membatasi `LIMIT`.

Jadi jangan menilai kolom sendirian. Nilai index berdasarkan pola query.

---

## 16. Index Condition Pushdown

Index Condition Pushdown atau ICP adalah optimisasi di mana sebagian kondisi `WHERE` dievaluasi di storage engine menggunakan data di index sebelum mengambil full row.

Misalnya index:

```sql
INDEX idx_tenant_created_status (tenant_id, created_at, status)
```

Query:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND created_at >= ?
  AND created_at < ?
  AND status = 'OPEN';
```

Karena `status` berada setelah range `created_at`, mungkin tidak sepenuhnya mempersempit range B+Tree. Tetapi karena `status` ada di index, InnoDB bisa memfilter sebagian entry sebelum clustered lookup.

Ini mengurangi jumlah full row yang perlu dibaca.

Namun ICP bukan pengganti desain index yang baik.

Mental model:

```text
ICP bisa mengurangi row lookup.
Tapi kalau range awal terlalu besar, query tetap mahal.
```

---

## 17. Covering vs Filtering vs Ordering

Sebuah index bisa membantu query dalam beberapa cara berbeda:

1. Finding/filtering rows.
2. Avoiding sort.
3. Covering selected columns.
4. Reducing locking range.
5. Supporting uniqueness.

Kadang satu index tidak bisa optimal untuk semuanya.

Contoh:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE tenant_id = ?
  AND priority = ?
  AND status IN ('OPEN', 'ESCALATED')
ORDER BY created_at DESC
LIMIT 50;
```

Index kandidat A:

```sql
(tenant_id, priority, status, created_at)
```

Bagus untuk filtering, tetapi `status IN (...)` bisa memengaruhi ordering global.

Index kandidat B:

```sql
(tenant_id, priority, created_at)
```

Bagus untuk ordering, tetapi status difilter setelah scan.

Pilihan tergantung:

- distribusi status;
- distribusi priority;
- limit size;
- apakah created_at range kecil;
- apakah sorting mahal;
- query frequency;
- write cost.

Engineer top-tier tidak menghafal satu formula. Mereka membaca workload dan konsekuensinya.

---

## 18. Descending Index

MySQL mendukung descending index untuk mengoptimalkan urutan descending tertentu.

Contoh:

```sql
CREATE INDEX idx_tenant_created_desc
ON enforcement_case (tenant_id, created_at DESC, id DESC);
```

Query:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index ini cocok karena urutan index sejalan dengan `ORDER BY`.

Tanpa index yang sesuai, MySQL mungkin perlu melakukan filesort.

Namun perlu diingat:

- ascending index bisa dipindai mundur pada beberapa kasus;
- mixed direction dalam composite order bisa membuat descending index lebih relevan;
- validasi dengan `EXPLAIN` tetap wajib.

---

## 19. Unique Index

Unique index bukan hanya optimisasi query. Unique index adalah constraint.

Contoh:

```sql
CREATE UNIQUE INDEX uk_case_number
ON enforcement_case (case_number);
```

Ini menjamin tidak ada dua case dengan `case_number` sama.

Unique index berguna sebagai concurrency primitive.

Contoh idempotency:

```sql
CREATE TABLE idempotency_key (
    request_key VARCHAR(100) NOT NULL,
    operation_name VARCHAR(100) NOT NULL,
    response_hash VARBINARY(32),
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (request_key, operation_name)
) ENGINE = InnoDB;
```

Ketika dua request sama masuk bersamaan, database dapat menegakkan uniqueness.

Aplikasi tidak perlu hanya mengandalkan:

```text
check first -> insert later
```

Karena pola itu race-prone.

Lebih aman:

```text
insert unique key
if duplicate key -> treat as duplicate/idempotent path
```

Untuk Java service, unique constraint sering lebih kuat daripada lock application-level.

---

## 20. Unique Index dan NULL

Perlu hati-hati: di MySQL, unique index memperbolehkan beberapa `NULL` karena `NULL` dianggap unknown, bukan nilai yang sama.

Contoh:

```sql
CREATE TABLE person_identifier (
    id BIGINT PRIMARY KEY,
    national_id VARCHAR(50) NULL,
    UNIQUE KEY uk_national_id (national_id)
) ENGINE = InnoDB;
```

Table ini dapat memiliki banyak row dengan `national_id IS NULL`.

Jika requirement-mu:

> Setiap national_id yang ada harus unik, tetapi boleh kosong.

Maka ini cocok.

Jika requirement-mu:

> Hanya boleh satu row tanpa national_id.

Maka unique index biasa tidak cukup.

Inilah contoh perbedaan antara constraint teknis dan rule bisnis.

---

## 21. Prefix Index

Prefix index mengindeks sebagian awal string.

Contoh:

```sql
CREATE INDEX idx_subject_name_prefix
ON regulated_subject (legal_name(100));
```

Ini berarti hanya 100 karakter awal yang masuk index.

Prefix index berguna untuk kolom besar seperti `VARCHAR(1000)` atau `TEXT` bila full index terlalu mahal.

Trade-off:

- index lebih kecil;
- lookup prefix bisa lebih cepat;
- selectivity mungkin turun;
- tidak selalu bisa covering penuh;
- uniqueness pada prefix bisa berbahaya bila salah dipakai.

Contoh bahaya:

```sql
CREATE UNIQUE INDEX uk_legal_name_prefix
ON regulated_subject (legal_name(50));
```

Ini menjamin 50 karakter pertama unik, bukan legal name penuh unik. Dua nama berbeda tetapi prefix sama akan dianggap duplicate.

Gunakan prefix unique hanya jika benar-benar paham konsekuensinya.

---

## 22. Functional Index

Functional index memungkinkan index pada ekspresi.

Contoh kebutuhan:

```sql
WHERE LOWER(email) = LOWER(?)
```

Jika query memakai fungsi pada kolom:

```sql
LOWER(email)
```

index biasa pada `email` mungkin tidak efektif karena nilai yang diindeks adalah nilai asli, bukan hasil fungsi.

Functional index dapat membantu:

```sql
CREATE INDEX idx_user_email_lower
ON app_user ((LOWER(email)));
```

Namun ada beberapa catatan:

1. Functional index harus sesuai ekspresi query.
2. Expression determinism penting.
3. Bisa menambah biaya write.
4. Kadang solusi lebih baik adalah normalisasi data di kolom terpisah.

Untuk email, bisa jadi lebih baik:

```sql
email_normalized VARCHAR(320) NOT NULL,
UNIQUE KEY uk_email_normalized (email_normalized)
```

Aplikasi memastikan isi `email_normalized` lowercase/canonical.

Kenapa?

Karena rule bisnis lebih eksplisit, lebih mudah dipahami, dan lebih portable.

---

## 23. Invisible Index

Invisible index adalah index yang tetap ada dan tetap dipelihara saat write, tetapi tidak digunakan optimizer secara default.

Ini berguna untuk eksperimen:

- apakah index masih dibutuhkan;
- apakah menghapus index akan merusak plan;
- apakah optimizer memilih plan lebih baik tanpa index tertentu.

Contoh:

```sql
ALTER TABLE enforcement_case
ALTER INDEX idx_old_status INVISIBLE;
```

Jika setelah observasi tidak ada masalah, index bisa di-drop.

```sql
DROP INDEX idx_old_status ON enforcement_case;
```

Invisible index bukan cara mengurangi write overhead karena index tetap dipelihara.

Mental model:

```text
Invisible index mengurangi pengaruh optimizer, bukan biaya maintenance.
```

---

## 24. Multi-Valued Index untuk JSON Array

MySQL mendukung multi-valued index untuk mengindeks elemen dalam array JSON tertentu.

Contoh konseptual:

```sql
CREATE TABLE case_document (
    id BIGINT PRIMARY KEY,
    attributes JSON NOT NULL,
    INDEX idx_tags ((CAST(attributes->'$.tags' AS CHAR(50) ARRAY)))
) ENGINE = InnoDB;
```

Lalu query dapat mencari elemen array tertentu.

Namun gunakan ini dengan hati-hati.

JSON indexing berguna bila:

- atribut semi-structured memang terbatas;
- query pattern jelas;
- tidak semua atribut layak menjadi kolom relational;
- schema dynamic diperlukan.

Tetapi JSON index bisa menjadi schema debt bila dipakai untuk menyembunyikan model domain yang sebenarnya stabil.

Untuk sistem enforcement/case management, pertimbangkan:

- atribut pencarian utama sebaiknya kolom relational;
- atribut audit/payload tambahan bisa JSON;
- atribut report-heavy sebaiknya tidak hanya tersembunyi di JSON;
- field dengan constraint kuat jangan hanya disimpan sebagai JSON.

---

## 25. Full-Text Index: Bukan Pengganti Search Engine

MySQL memiliki full-text index.

Ini berguna untuk pencarian teks sederhana.

Tetapi untuk kebutuhan seperti:

- relevance ranking kompleks;
- typo tolerance;
- stemming bahasa kompleks;
- synonym;
- faceted search;
- highlight;
- fuzzy search;
- analytics search;
- multi-field scoring kompleks;

Elasticsearch/OpenSearch/Solr sering lebih tepat.

Mental model:

```text
MySQL full-text search cukup untuk search sederhana yang dekat dengan transactional data.
Search engine cocok untuk discovery/search experience kompleks.
```

Jangan langsung memakai Elasticsearch untuk semua pencarian. Tetapi jangan juga memaksa MySQL menjadi search engine penuh bila requirement sudah melampaui kemampuannya.

---

## 26. Sargability: Apakah Predicate Bisa Memakai Index?

Sargable berarti predicate dapat menggunakan index secara efektif.

Contoh sargable:

```sql
WHERE created_at >= '2026-01-01'
  AND created_at <  '2026-02-01'
```

Contoh tidak sargable:

```sql
WHERE DATE(created_at) = '2026-01-01'
```

Kenapa?

Karena fungsi `DATE(created_at)` diterapkan ke kolom. Database tidak bisa langsung mencari range berdasarkan nilai indexed `created_at` mentah.

Ubah menjadi:

```sql
WHERE created_at >= '2026-01-01 00:00:00'
  AND created_at <  '2026-01-02 00:00:00'
```

Contoh lain yang sering terjadi:

```sql
WHERE LOWER(username) = 'alice'
```

Alternatif:

- gunakan collation case-insensitive bila sesuai;
- simpan normalized column;
- gunakan functional index.

Sargability adalah salah satu skill penting untuk query performance.

---

## 27. LIKE dan Index

Predicate `LIKE` bisa memakai B+Tree index bila pattern memiliki prefix tetap.

Bisa terbantu:

```sql
WHERE case_number LIKE 'CASE-2026-%'
```

Sulit terbantu:

```sql
WHERE case_number LIKE '%000123'
```

Karena B+Tree diurutkan dari kiri ke kanan. Jika prefix tidak diketahui, database tidak tahu harus mulai dari mana.

Untuk substring search:

- full-text index;
- n-gram strategy;
- external search engine;
- generated column khusus;
- reverse column untuk suffix search;

bisa dipertimbangkan.

Contoh suffix search dengan reverse value:

```sql
case_number_reversed VARCHAR(50) NOT NULL,
INDEX idx_case_number_reversed (case_number_reversed)
```

Aplikasi menyimpan reverse dari `case_number` untuk mendukung suffix search tertentu.

Tetapi strategi seperti ini harus dibenarkan oleh requirement nyata.

---

## 28. Index dan ORDER BY

Index dapat membantu `ORDER BY` jika urutan index cocok dengan urutan query.

Contoh:

```sql
INDEX idx_status_created_id (status, created_at, id)
```

Query:

```sql
SELECT id, case_number
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at, id
LIMIT 50;
```

Index cocok.

Karena semua row dengan `status='OPEN'` sudah tersusun berdasarkan `created_at, id`.

Tetapi query:

```sql
WHERE status = 'OPEN'
ORDER BY priority, created_at
```

Index tadi tidak cocok untuk ordering karena setelah `status`, urutan index adalah `created_at`, bukan `priority`.

Jika MySQL tidak bisa memakai index order, ia perlu sort tambahan.

Sort tambahan tidak selalu buruk, tetapi untuk result/intermediate besar bisa mahal.

---

## 29. Index dan LIMIT

`LIMIT` sangat kuat bila dikombinasikan dengan index order yang cocok.

Contoh baik:

```sql
SELECT id, case_number
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 20;
```

dengan:

```sql
INDEX idx_status_created (status, created_at)
```

Database bisa berhenti setelah menemukan 20 entry pertama.

Contoh buruk:

```sql
SELECT id, case_number
FROM enforcement_case
WHERE status = 'OPEN'
ORDER BY last_updated_by
LIMIT 20;
```

Jika tidak ada index cocok, database mungkin harus menemukan banyak row `OPEN`, sort berdasarkan `last_updated_by`, lalu ambil 20.

`LIMIT 20` tidak otomatis murah. Murah hanya jika database bisa menemukan 20 row pertama secara terarah.

---

## 30. Offset Pagination dan Index Cost

Query seperti ini umum:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = ?
ORDER BY created_at, id
LIMIT 50 OFFSET 100000;
```

Dengan index yang cocok, database tetap harus melewati 100.000 entry sebelum mengambil 50.

Cost-nya kira-kira:

```text
scan 100000 + return 50
```

Ini buruk untuk halaman dalam.

Seek pagination lebih baik:

```sql
SELECT id, case_number, created_at
FROM enforcement_case
WHERE tenant_id = ?
  AND (created_at, id) > (?, ?)
ORDER BY created_at, id
LIMIT 50;
```

Dengan index:

```sql
INDEX idx_tenant_created_id (tenant_id, created_at, id)
```

Database bisa mulai dari posisi cursor terakhir.

Mental model:

```text
Offset pagination menghitung dari awal.
Seek pagination melanjutkan dari posisi terakhir.
```

Untuk list besar, queue, audit log, event timeline, dan case history, seek pagination biasanya jauh lebih stabil.

---

## 31. Index dan Lock Footprint

Index tidak hanya memengaruhi performa baca. Index juga memengaruhi lock.

Contoh:

```sql
UPDATE enforcement_case
SET status = 'ESCALATED'
WHERE tenant_id = ?
  AND due_at < NOW()
  AND status = 'OPEN';
```

Jika tidak ada index yang cocok, InnoDB mungkin perlu scan banyak row. Selama update, ia bisa mengambil lock pada banyak record yang diperiksa/diubah.

Index yang cocok:

```sql
INDEX idx_tenant_status_due (tenant_id, status, due_at)
```

membantu database langsung menemukan range row yang relevan.

Dampaknya:

- lebih sedikit row diperiksa;
- lebih sedikit lock;
- transaksi lebih singkat;
- lebih kecil kemungkinan deadlock;
- lebih rendah lock wait.

Jadi index adalah alat concurrency control tidak langsung.

Missing index bisa menjadi penyebab lock incident.

---

## 32. Index dan Write Amplification

Setiap insert harus menulis:

- clustered index;
- semua secondary index;
- redo log;
- undo log;
- binlog;
- change buffer untuk sebagian secondary index non-unique;
- mungkin page split bila page penuh.

Jika table punya 12 index, insert satu row bukan satu write logis saja. Ia harus memelihara banyak struktur data.

Contoh:

```sql
CREATE TABLE case_event (
    id BIGINT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    actor_user_id BIGINT NOT NULL,
    created_at DATETIME(6) NOT NULL,
    payload JSON NOT NULL,
    KEY idx_case_created (case_id, created_at),
    KEY idx_actor_created (actor_user_id, created_at),
    KEY idx_type_created (event_type, created_at),
    KEY idx_created (created_at)
) ENGINE = InnoDB;
```

Setiap event insert memperbarui 1 clustered index + 4 secondary index.

Jika event volume tinggi, index tambahan bisa menjadi bottleneck write.

Index bukan gratis.

---

## 33. Update Cost pada Indexed Column

Update kolom yang tidak di-index relatif lebih murah dibanding update kolom yang ada di banyak index.

Misalnya:

```sql
UPDATE enforcement_case
SET summary = ?
WHERE id = ?;
```

Jika `summary` tidak di-index, InnoDB hanya perlu update clustered row dan log terkait.

Tetapi:

```sql
UPDATE enforcement_case
SET status = ?
WHERE id = ?;
```

Jika `status` ada di beberapa index:

```sql
idx_status_created(status, created_at)
idx_tenant_status_due(tenant_id, status, due_at)
idx_status_priority(status, priority)
```

maka update status perlu memodifikasi beberapa secondary index.

Untuk workflow system di mana status sering berubah, terlalu banyak index dengan `status` dapat meningkatkan write cost dan deadlock probability.

Desain index harus mempertimbangkan lifecycle mutability.

---

## 34. Hot Index Page dan Insert Pattern

Primary key monotonik seperti AUTO_INCREMENT membuat insert cenderung masuk ke sisi kanan B+Tree.

Keuntungannya:

- locality baik;
- page split lebih terkendali;
- secondary index PK payload kecil bila BIGINT;
- lookup sederhana.

Risikonya:

- rightmost page hotspot pada write sangat tinggi;
- auto-increment contention pada skenario tertentu;
- predictable ID bila diekspos keluar.

UUID random sebagai primary key:

- menghindari predictable sequence;
- bisa dibuat client-side;
- mendukung distributed generation;
- tetapi insert tersebar random ke banyak page;
- page split meningkat;
- fragmentation meningkat;
- secondary index membesar bila disimpan sebagai string.

Alternatif:

- binary UUID `BINARY(16)`;
- time-ordered UUID/ULID;
- Snowflake-style ID;
- surrogate internal BIGINT + public external ID.

Untuk banyak sistem Java enterprise, pola yang sering baik:

```text
internal primary key: BIGINT/Snowflake-style sortable ID
external public identifier: unique opaque string/UUID
```

Tetapi keputusan final tergantung kebutuhan distribusi, keamanan, audit, dan integrasi.

---

## 35. Redundant Index

Index redundant adalah index yang manfaatnya tertutup oleh index lain.

Contoh:

```sql
INDEX idx_tenant (tenant_id)
INDEX idx_tenant_status (tenant_id, status)
```

Index `(tenant_id, status)` dapat melayani query `WHERE tenant_id = ?`, sehingga `idx_tenant` mungkin redundant.

Namun tidak selalu otomatis dihapus.

Pertimbangkan:

- apakah index pendek jauh lebih kecil dan sering dipakai;
- apakah index panjang terlalu besar;
- apakah query count/existence cukup dengan index pendek;
- apakah optimizer lebih suka index pendek;
- apakah index pendek dipakai FK constraint;
- apakah ada kebutuhan khusus.

Contoh lain:

```sql
INDEX idx_a_b (a, b)
INDEX idx_a_b_c (a, b, c)
```

`idx_a_b` mungkin redundant terhadap `idx_a_b_c`, tapi belum tentu. Index yang lebih kecil bisa lebih murah untuk query tertentu.

Gunakan observability, bukan asumsi.

---

## 36. Duplicate Index

Duplicate index adalah index dengan definisi yang sama atau setara.

Contoh:

```sql
INDEX idx_case_number (case_number)
UNIQUE INDEX uk_case_number (case_number)
```

Jika `case_number` memang unique, index non-unique tambahan kemungkinan tidak perlu.

Duplicate index menambah:

- storage;
- write overhead;
- migration cost;
- optimizer confusion;
- backup size.

Audit index secara berkala.

---

## 37. Foreign Key dan Index

Foreign key membutuhkan index pada kolom terkait.

Contoh:

```sql
CREATE TABLE enforcement_action (
    id BIGINT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    CONSTRAINT fk_action_case
      FOREIGN KEY (case_id) REFERENCES enforcement_case(id)
) ENGINE = InnoDB;
```

InnoDB membutuhkan index pada child column `case_id`. Jika tidak ada, MySQL dapat membuat/menuntut index tergantung definisi.

Foreign key juga memengaruhi locking.

Saat insert child row, InnoDB perlu memverifikasi parent ada.

Saat update/delete parent, InnoDB perlu memeriksa child row.

Index child yang buruk dapat membuat parent update/delete mahal atau menahan lock lebih lama.

FK bukan hanya constraint konseptual; ia memengaruhi execution dan locking.

---

## 38. Index Statistics

Optimizer tidak “tahu” data secara sempurna. Ia mengandalkan statistik.

Statistik membantu memperkirakan:

- berapa banyak row cocok;
- index mana lebih selektif;
- join order mana lebih murah;
- apakah table scan lebih murah daripada index lookup.

Jika statistik tidak akurat, optimizer bisa memilih plan buruk.

InnoDB memiliki persistent statistics dan MySQL juga mendukung histogram untuk kolom tertentu.

Namun bagian optimizer detail akan dibahas lebih dalam di part 012.

Untuk sekarang cukup pegang prinsip:

```text
Index yang ada tidak menjamin dipakai.
Optimizer memilih berdasarkan estimasi biaya.
Estimasi biaya bergantung pada statistik.
```

---

## 39. Why MySQL Sometimes Ignores Your Index

MySQL bisa mengabaikan index karena:

1. Predicate tidak sargable.
2. Selectivity rendah.
3. Query memilih banyak kolom sehingga clustered lookup mahal.
4. Table kecil sehingga full scan lebih murah.
5. Statistik tidak akurat.
6. Index order tidak cocok dengan query.
7. Collation/type mismatch.
8. Function/cast implisit merusak index usage.
9. Composite index tidak cocok dengan leftmost prefix.
10. Optimizer memperkirakan plan lain lebih murah.

Contoh type mismatch:

```sql
WHERE varchar_column = 123
```

Jika kolom string dibandingkan dengan number, MySQL bisa melakukan konversi implisit yang merusak penggunaan index atau menghasilkan behavior mengejutkan.

Di Java, ini sering muncul dari binding parameter yang salah tipe.

Pastikan parameter JDBC sesuai tipe kolom.

---

## 40. Index Merge

MySQL kadang bisa memakai lebih dari satu index untuk table yang sama melalui index merge.

Contoh:

```sql
WHERE status = 'OPEN'
   OR priority = 'HIGH'
```

Dengan index terpisah pada `status` dan `priority`, optimizer mungkin melakukan index merge.

Namun jangan terlalu mengandalkan index merge untuk workload utama.

Sering kali composite index yang cocok dengan query pattern lebih stabil.

Index merge bisa membantu query ad-hoc, tetapi untuk path kritis, desain index eksplisit lebih baik.

---

## 41. Case Study: SLA Queue

Misalnya sistem regulatory enforcement memiliki queue untuk case yang harus dieskalasi.

Table:

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    case_number VARCHAR(50) NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    due_at DATETIME(6) NULL,
    assigned_team_id BIGINT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_number (case_number)
) ENGINE = InnoDB;
```

Queue query:

```sql
SELECT id, case_number, priority, due_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND due_at <= NOW(6)
ORDER BY due_at, id
LIMIT 100;
```

Index yang cocok:

```sql
CREATE INDEX idx_case_sla_queue
ON enforcement_case (tenant_id, status, due_at, id, case_number, priority);
```

Analisis:

- `tenant_id`: membatasi tenant;
- `status`: equality;
- `due_at`: range sekaligus ordering;
- `id`: tie-breaker stable order;
- `case_number`, `priority`: covering untuk selected columns.

Tetapi apakah covering perlu?

Jika query sangat sering dan latency-sensitive, mungkin ya.

Jika write volume tinggi dan queue tidak sering, mungkin index lebih ramping lebih baik:

```sql
CREATE INDEX idx_case_sla_queue
ON enforcement_case (tenant_id, status, due_at, id);
```

Lalu clustered lookup untuk 100 row masih murah.

Keputusan tergantung workload.

---

## 42. Case Study: Case Search Screen

Search screen biasanya punya optional filters:

- tenant;
- status;
- priority;
- assigned team;
- subject;
- created date;
- updated date;
- due date;
- keyword;
- sort option.

Naive query builder:

```sql
SELECT *
FROM enforcement_case
WHERE tenant_id = ?
  AND (? IS NULL OR status = ?)
  AND (? IS NULL OR priority = ?)
  AND (? IS NULL OR assigned_team_id = ?)
  AND (? IS NULL OR created_at >= ?)
  AND (? IS NULL OR created_at < ?)
ORDER BY updated_at DESC
LIMIT 50 OFFSET ?;
```

Masalah:

- OR optional pattern bisa mengurangi sargability;
- satu query bentuk generik sulit dioptimalkan;
- `SELECT *` merusak covering;
- offset pagination memburuk;
- sort by dynamic field butuh index berbeda;
- filter kombinasi terlalu banyak untuk satu index.

Pendekatan lebih baik:

1. Identifikasi 3-5 search pattern paling sering.
2. Buat query shape berbeda untuk pattern penting.
3. Gunakan index berdasarkan pattern nyata.
4. Gunakan seek pagination untuk result besar.
5. Batasi sort option.
6. Jangan semua kombinasi optional dianggap first-class.
7. Untuk search bebas kompleks, pertimbangkan search index eksternal.

Index design adalah product/API decision, bukan hanya database decision.

---

## 43. Case Study: Audit Event Timeline

Table audit/event:

```sql
CREATE TABLE case_event (
    id BIGINT NOT NULL,
    case_id BIGINT NOT NULL,
    event_sequence BIGINT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    actor_user_id BIGINT NULL,
    occurred_at DATETIME(6) NOT NULL,
    payload JSON NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_event_sequence (case_id, event_sequence),
    KEY idx_case_occurred (case_id, occurred_at, id),
    KEY idx_actor_occurred (actor_user_id, occurred_at, id)
) ENGINE = InnoDB;
```

Timeline query:

```sql
SELECT id, event_type, actor_user_id, occurred_at, payload
FROM case_event
WHERE case_id = ?
ORDER BY event_sequence
LIMIT 100;
```

Index:

```sql
UNIQUE KEY uk_case_event_sequence (case_id, event_sequence)
```

Bagus untuk timeline sequence.

Tetapi karena query mengambil `payload JSON`, index tidak covering. Untuk 100 row, mungkin masih wajar. Jangan memasukkan payload besar ke index.

Audit payload biasanya tidak cocok dijadikan bagian covering index.

Untuk summary list, buat query terpisah:

```sql
SELECT id, event_type, actor_user_id, occurred_at
FROM case_event
WHERE case_id = ?
ORDER BY event_sequence
LIMIT 100;
```

Kalau perlu, index bisa covering tanpa payload.

---

## 44. Case Study: Work Queue dengan SKIP LOCKED

Misalnya worker mengambil job:

```sql
SELECT id
FROM case_job
WHERE status = 'READY'
  AND available_at <= NOW(6)
ORDER BY available_at, id
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

Index:

```sql
CREATE INDEX idx_job_ready_queue
ON case_job (status, available_at, id);
```

Kenapa penting?

Tanpa index, worker bisa scan banyak row dan mengunci/mengecek terlalu luas.

Dengan index cocok, worker langsung masuk ke queue region yang relevan.

Untuk queue table, index bukan hanya performa. Index menentukan concurrency worker.

Namun MySQL table sebagai queue tetap punya batas. Untuk throughput tinggi atau semantic messaging kompleks, message broker sering lebih tepat.

---

## 45. Anti-Pattern: Index Every Foreign Key + Every Filter + Every Sort

Banyak schema tumbuh seperti ini:

```sql
KEY idx_tenant_id (tenant_id),
KEY idx_status (status),
KEY idx_priority (priority),
KEY idx_created_at (created_at),
KEY idx_updated_at (updated_at),
KEY idx_assigned_team_id (assigned_team_id),
KEY idx_tenant_status (tenant_id, status),
KEY idx_tenant_priority (tenant_id, priority),
KEY idx_tenant_created (tenant_id, created_at),
KEY idx_tenant_updated (tenant_id, updated_at),
KEY idx_status_created (status, created_at)
```

Masalah:

- banyak index redundant;
- write cost tinggi;
- optimizer punya terlalu banyak pilihan;
- DDL lambat;
- buffer pool terfragmentasi;
- tidak jelas index mana melayani workload mana.

Index harus punya alasan.

Untuk setiap index, harus bisa menjawab:

1. Query apa yang dilayani?
2. Seberapa sering query itu?
3. Seberapa kritis latency-nya?
4. Berapa selectivity-nya?
5. Apakah index membantu filtering, ordering, covering, atau constraint?
6. Apa write cost-nya?
7. Apakah redundant?
8. Bagaimana cara memvalidasi bahwa index dipakai?
9. Bagaimana cara menghapusnya bila tidak lagi diperlukan?

---

## 46. Anti-Pattern: Index for Today, Regret Forever

Index sering ditambahkan saat incident:

> “Dashboard lambat. Tambahkan index sekarang.”

Lalu index tidak pernah dihapus.

Setelah 2 tahun:

- schema punya puluhan index;
- write throughput turun;
- migration lambat;
- disk membengkak;
- query plan tidak stabil;
- tidak ada yang tahu index mana masih dipakai.

Solusi:

- setiap index punya owner/reason;
- review index berkala;
- gunakan performance schema/sys schema untuk melihat usage;
- gunakan invisible index sebelum drop pada sistem kritis;
- ukur write impact;
- dokumentasikan query pattern.

Index lifecycle harus dikelola seperti code.

---

## 47. Index Naming Convention

Nama index yang jelas membantu operasi.

Contoh buruk:

```sql
KEY idx1 (status, created_at)
KEY idx2 (tenant_id, status)
```

Contoh lebih baik:

```sql
KEY idx_case_status_created (status, created_at)
KEY idx_case_tenant_status_due (tenant_id, status, due_at)
KEY uk_case_number (case_number)
```

Convention yang praktis:

- `pk_<table>` biasanya implicit primary key;
- `uk_<table>_<columns>` untuk unique key;
- `idx_<table>_<columns/purpose>` untuk non-unique index;
- `fk_<child>_<parent>` untuk foreign key;
- gunakan purpose bila kolom terlalu panjang, misalnya `idx_case_sla_queue`.

Nama index muncul di:

- error duplicate key;
- execution plan;
- monitoring;
- migration logs;
- deadlock logs;
- operational discussion.

Nama yang jelas mengurangi cognitive load saat incident.

---

## 48. Reading EXPLAIN for Index Usage: Preview

Detail `EXPLAIN` akan dibahas di part 012. Tetapi untuk index internals, beberapa field penting:

```sql
EXPLAIN
SELECT id, case_number
FROM enforcement_case
WHERE tenant_id = 10
  AND status = 'OPEN'
ORDER BY created_at
LIMIT 50;
```

Perhatikan:

| Field | Makna kasar |
|---|---|
| `type` | jenis access method, misalnya `const`, `ref`, `range`, `ALL` |
| `possible_keys` | index yang mungkin dipakai |
| `key` | index yang dipilih |
| `key_len` | panjang bagian index yang dipakai |
| `rows` | estimasi row diperiksa |
| `filtered` | estimasi persentase row lolos filter |
| `Extra` | informasi tambahan seperti `Using index`, `Using where`, `Using filesort` |

`Using index` biasanya berarti covering index.

`Using filesort` berarti MySQL melakukan sorting tambahan, bukan berarti selalu memakai file disk.

`Using where` berarti ada filter tambahan.

Jangan membaca satu field secara terisolasi.

---

## 49. Index Design Workflow

Workflow praktis untuk mendesain index:

### Step 1 — Identifikasi query shape

Bukan hanya satu query string, tetapi pola:

```text
List OPEN cases by tenant ordered by due_at
Get case by case_number
Fetch event timeline by case_id ordered by sequence
Find active assignment by user/team/status
Poll READY jobs by available_at
```

### Step 2 — Tentukan cardinality dan distribusi

Tanyakan:

- berapa tenant?
- berapa row per tenant?
- status distribusinya bagaimana?
- priority distribusinya bagaimana?
- apakah data skewed?
- apakah satu tenant jauh lebih besar?

### Step 3 — Tentukan access path ideal

Contoh:

```text
tenant_id equality -> status equality -> due_at range/order -> id tie-breaker
```

### Step 4 — Buat index kandidat

```sql
INDEX idx_case_sla_queue (tenant_id, status, due_at, id)
```

### Step 5 — Validasi dengan data realistis

Gunakan:

- `EXPLAIN`
- `EXPLAIN ANALYZE`
- slow query log
- performance schema
- benchmark realistis

### Step 6 — Hitung write cost

Apakah kolom sering berubah?

Apakah table write-heavy?

Apakah index bisa mengganggu insert/update?

### Step 7 — Dokumentasikan alasan

Contoh:

```sql
-- Supports SLA queue polling:
-- WHERE tenant_id=? AND status='OPEN' AND due_at<=?
-- ORDER BY due_at,id LIMIT N
CREATE INDEX idx_case_sla_queue
ON enforcement_case (tenant_id, status, due_at, id);
```

---

## 50. Index Design Checklist

Gunakan checklist ini sebelum menambah index:

1. Query apa yang ingin dibantu?
2. Apakah query itu hot path?
3. Apakah query itu latency-sensitive?
4. Apakah query itu read-heavy atau write-heavy table?
5. Apakah predicate sargable?
6. Apakah composite order sesuai equality/range/order?
7. Apakah index membantu ORDER BY?
8. Apakah index membantu LIMIT?
9. Apakah index perlu covering?
10. Apakah selected columns terlalu besar untuk covering?
11. Apakah ada index existing yang bisa melayani?
12. Apakah index baru redundant?
13. Apakah kolom index sering di-update?
14. Apakah primary key terlalu besar sehingga secondary index membengkak?
15. Apakah data distribution skewed?
16. Apakah query multi-tenant harus selalu mulai dari tenant_id?
17. Apakah index memengaruhi lock footprint?
18. Apakah perlu unique constraint, bukan sekadar index biasa?
19. Apakah migration penambahan index aman untuk table besar?
20. Bagaimana cara mengukur hasilnya setelah deploy?

---

## 51. Decision Matrix: Read Benefit vs Write Cost

| Kondisi | Keputusan umum |
|---|---|
| Query sangat sering, latency-critical, filtering/order jelas | Index kuat dibenarkan |
| Query jarang, ad-hoc, table write-heavy | Hati-hati, mungkin tidak perlu index khusus |
| Query list kecil dengan `LIMIT` dan order stabil | Composite index sesuai order sangat berguna |
| Query mengambil banyak kolom besar | Covering index biasanya tidak cocok |
| Kolom sering berubah | Jangan sembarang menaruh kolom itu di banyak index |
| Constraint bisnis uniqueness | Gunakan unique index/constraint |
| Search fleksibel banyak kombinasi | Jangan buat index untuk semua kombinasi; desain search strategy |
| Table kecil | Full scan mungkin cukup |
| Multi-tenant besar | `tenant_id` sering menjadi prefix penting |
| Queue/concurrency workflow | Index menentukan lock footprint dan worker throughput |

---

## 52. Java Engineer Perspective

Dari sisi Java, index design sering rusak karena abstraction layer.

### 52.1 ORM menghasilkan query yang tidak disadari

Contoh JPA method:

```java
List<EnforcementCase> findByStatusOrderByCreatedAt(String status);
```

Terlihat sederhana, tetapi bisa menghasilkan:

```sql
SELECT *
FROM enforcement_case
WHERE status = ?
ORDER BY created_at;
```

Tanpa `LIMIT`, tanpa tenant, mengambil full entity.

Bahaya:

- scan besar;
- sort besar;
- memory besar;
- lock/read pressure;
- network payload besar.

### 52.2 Entity fetch vs projection

Untuk list screen, hindari mengambil entity penuh jika hanya butuh ringkasan.

Gunakan projection:

```java
public record CaseListItem(
    long id,
    String caseNumber,
    String status,
    Instant createdAt
) {}
```

SQL:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at, id
LIMIT ?;
```

### 52.3 Dynamic filter builder

Dynamic query builder harus aware index.

Bukan semua kombinasi optional filter harus dianggap sama penting.

Desain API search harus membatasi kombinasi atau menyediakan backend strategy berbeda.

### 52.4 Batch write dan index overhead

Batch insert ke table dengan banyak index bisa lambat.

Jangan langsung menyalahkan JDBC batch size. Lihat juga:

- jumlah index;
- ukuran index;
- primary key pattern;
- foreign key;
- unique constraint;
- redo/binlog flush;
- replication.

### 52.5 Retry transaction dan unique constraint

Untuk idempotency, lebih aman gunakan unique key lalu handle duplicate key.

Contoh pseudo-code:

```java
try {
    insertIdempotencyKey(requestKey, operationName);
    processBusinessOperation();
    markSuccess(requestKey, operationName);
} catch (DuplicateKeyException e) {
    return loadPreviousResult(requestKey, operationName);
}
```

Database constraint menjadi guard concurrency.

---

## 53. Regulatory / Case Management Lens

Dalam sistem regulatory enforcement, index bukan sekadar performa. Index mendukung model operasional:

- case lookup by case number;
- subject history;
- enforcement action timeline;
- SLA queue;
- escalation candidate selection;
- assignment queue;
- audit event retrieval;
- report extraction;
- retention cleanup;
- legal hold lookup;
- workflow transition guard;
- idempotency and duplicate prevention.

Beberapa index biasanya muncul dari invariant domain.

Contoh invariant:

```text
Dalam satu regulatory domain, case_number harus unik.
```

Index:

```sql
UNIQUE KEY uk_domain_case_number (regulatory_domain_id, case_number)
```

Contoh access pattern:

```text
Reviewer melihat semua OPEN cases untuk tenant dan assigned team, oldest due first.
```

Index:

```sql
KEY idx_case_team_queue
(tenant_id, assigned_team_id, status, due_at, id)
```

Contoh audit timeline:

```text
Semua event untuk case harus ditampilkan dalam urutan sequence yang deterministic.
```

Index/constraint:

```sql
UNIQUE KEY uk_case_event_sequence (case_id, event_sequence)
```

Index yang baik sering muncul dari bahasa domain yang jelas.

Jika kamu tidak bisa menjelaskan index dalam bahasa workflow, mungkin index itu belum dipahami.

---

## 54. Common MySQL Index Mistakes

### Mistake 1 — Membuat index satu kolom terlalu banyak

```sql
INDEX(status)
INDEX(priority)
INDEX(created_at)
```

Padahal query selalu:

```sql
WHERE tenant_id=? AND status=? ORDER BY created_at
```

Lebih baik composite index sesuai query.

### Mistake 2 — Salah urutan composite index

```sql
INDEX(created_at, tenant_id, status)
```

Untuk query:

```sql
WHERE tenant_id=? AND status=? AND created_at BETWEEN ? AND ?
```

sering lebih baik:

```sql
INDEX(tenant_id, status, created_at)
```

### Mistake 3 — Mengabaikan ORDER BY

Index hanya untuk filter, tetapi query lambat karena sort besar.

### Mistake 4 — Mengambil full entity

Index bisa covering, tetapi `SELECT *` memaksa clustered lookup.

### Mistake 5 — Tidak memakai tie-breaker order

```sql
ORDER BY created_at
```

Jika banyak row punya timestamp sama, pagination bisa tidak stabil.

Gunakan:

```sql
ORDER BY created_at, id
```

### Mistake 6 — Function pada kolom indexed

```sql
WHERE DATE(created_at) = ?
```

Ubah ke range.

### Mistake 7 — Menganggap index low-cardinality selalu buruk

`status` sendiri mungkin buruk, tetapi `(status, due_at)` untuk queue bisa bagus.

### Mistake 8 — Menganggap index dipakai berarti query cepat

Index scan luas + clustered lookup banyak tetap bisa lambat.

### Mistake 9 — Membuat covering index terlalu lebar

Index terlalu besar bisa merusak write dan memory.

### Mistake 10 — Tidak menghapus index lama

Index accumulation menjadi technical debt.

---

## 55. Practical Lab

Gunakan table berikut sebagai latihan.

```sql
CREATE TABLE enforcement_case (
    id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    case_number VARCHAR(50) NOT NULL,
    subject_id BIGINT NOT NULL,
    assigned_team_id BIGINT NULL,
    status VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    due_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    summary VARCHAR(500) NULL,
    payload JSON NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_case_number (case_number)
) ENGINE = InnoDB;
```

### Exercise 1

Query:

```sql
SELECT id, case_number, priority, due_at
FROM enforcement_case
WHERE tenant_id = ?
  AND status = 'OPEN'
  AND due_at <= ?
ORDER BY due_at, id
LIMIT 100;
```

Design index.

Jawaban kandidat:

```sql
CREATE INDEX idx_case_sla_queue
ON enforcement_case (tenant_id, status, due_at, id, case_number, priority);
```

Diskusikan apakah covering perlu atau tidak.

### Exercise 2

Query:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE tenant_id = ?
  AND subject_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index kandidat:

```sql
CREATE INDEX idx_case_subject_timeline
ON enforcement_case (tenant_id, subject_id, created_at DESC, id DESC);
```

### Exercise 3

Query:

```sql
SELECT COUNT(*)
FROM enforcement_case
WHERE tenant_id = ?
  AND status = ?;
```

Jika sudah ada:

```sql
INDEX idx_case_sla_queue (tenant_id, status, due_at, id)
```

Apakah perlu index tambahan `(tenant_id, status)`?

Jawaban: tergantung. Index pendek mungkin lebih kecil dan lebih efisien untuk count, tetapi menambah write cost. Ukur frekuensi query dan cost.

### Exercise 4

Query:

```sql
SELECT *
FROM enforcement_case
WHERE DATE(created_at) = ?;
```

Perbaiki:

```sql
SELECT id, case_number, status, created_at
FROM enforcement_case
WHERE created_at >= ?
  AND created_at < ?;
```

Index:

```sql
CREATE INDEX idx_case_created
ON enforcement_case (created_at, id);
```

Namun jika multi-tenant:

```sql
CREATE INDEX idx_case_tenant_created
ON enforcement_case (tenant_id, created_at, id);
```

### Exercise 5

Search by suffix case number:

```sql
WHERE case_number LIKE '%000123'
```

B+Tree index pada `case_number` tidak efektif.

Alternatif:

- redesign search input;
- search by exact case number;
- reverse generated column;
- full-text/search engine jika requirement lebih luas.

---

## 56. Minimal Commands to Explore

Beberapa command yang akan sering dipakai:

```sql
SHOW INDEX FROM enforcement_case;
```

```sql
EXPLAIN
SELECT id, case_number
FROM enforcement_case
WHERE tenant_id = 1
  AND status = 'OPEN'
ORDER BY created_at
LIMIT 50;
```

```sql
EXPLAIN ANALYZE
SELECT id, case_number
FROM enforcement_case
WHERE tenant_id = 1
  AND status = 'OPEN'
ORDER BY created_at
LIMIT 50;
```

```sql
ALTER TABLE enforcement_case
ALTER INDEX idx_case_sla_queue INVISIBLE;
```

```sql
ALTER TABLE enforcement_case
ALTER INDEX idx_case_sla_queue VISIBLE;
```

```sql
DROP INDEX idx_unused ON enforcement_case;
```

Hati-hati menjalankan DDL di production. Penambahan/penghapusan index pada table besar bisa berdampak besar dan akan dibahas di part schema migration.

---

## 57. Mental Model Ringkas

Ingat kalimat-kalimat ini:

1. Di InnoDB, table adalah primary key B+Tree.
2. Secondary index menyimpan primary key, bukan pointer fisik sederhana.
3. Primary key yang besar membesarkan semua secondary index.
4. Query yang “pakai index” belum tentu cepat.
5. Covering index menghindari clustered lookup, tetapi menambah write/storage cost.
6. Composite index mengikuti urutan kiri ke kanan.
7. Equality, range, order, dan limit harus dipikirkan bersama.
8. `SELECT *` sering menghancurkan index efficiency.
9. Missing index bisa memperbesar lock footprint.
10. Terlalu banyak index memperlambat write path.
11. Index harus dikelola sebagai lifecycle, bukan ditambahkan lalu dilupakan.
12. Index design adalah keputusan workload, bukan dekorasi schema.

---

## 58. Hubungan dengan Bagian Berikutnya

Bagian ini membahas bagaimana index bekerja secara internal.

Bagian berikutnya akan membahas:

```text
Part 011 — Designing Indexes for Real Workloads, Not Individual Queries
```

Di sana kita akan naik satu level:

- dari struktur data ke workload;
- dari query individual ke query portfolio;
- dari index lokal ke strategi indexing satu bounded context;
- dari “index apa untuk query ini?” ke “index mana yang layak dipertahankan untuk sistem ini?”

Kita akan membahas:

- query pattern inventory;
- equality/range/order/limit heuristics;
- index untuk dashboard;
- index untuk state machine workflow;
- index untuk multi-tenancy;
- soft delete;
- pagination;
- status queue;
- indexing review checklist;
- cara mencegah index debt.

---

## 59. Referensi Resmi untuk Pendalaman

Gunakan dokumentasi resmi MySQL sebagai rujukan utama ketika memvalidasi detail teknis:

- MySQL Reference Manual — Optimization and Indexes
- MySQL Reference Manual — InnoDB Indexes
- MySQL Reference Manual — InnoDB Physical Structure
- MySQL Reference Manual — EXPLAIN Output Format
- MySQL Reference Manual — Invisible Indexes
- MySQL Reference Manual — Functional Key Parts
- MySQL Reference Manual — Descending Indexes
- MySQL Reference Manual — Multi-Valued Indexes

---

# Penutup Part 010

Index adalah salah satu area yang membedakan engineer yang hanya bisa “membuat query jalan” dari engineer yang mampu merancang sistem database production.

Index yang baik bukan hanya mempercepat query. Ia mengarahkan access path, mengurangi page read, mengurangi sort, membatasi lock footprint, mendukung constraint bisnis, dan membuat workload lebih stabil.

Index yang buruk atau berlebihan menjadi beban permanen: memperbesar storage, memperlambat write, memperumit optimizer, memperlambat migration, dan memperbesar risiko incident.

Sebagai Java engineer, jangan menyerahkan semua keputusan index ke ORM, auto-generated schema, atau tebakan cepat saat incident. Pahami query shape, pahami data distribution, pahami biaya write, lalu desain index sebagai bagian dari kontrak arsitektur sistem.

**Status seri:** belum selesai. Ini adalah `Part 010 / 034`.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Deadlocks and Lock Wait Timeouts: Diagnosis and Design</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-011.md">Part 011 — Designing Indexes for Real Workloads, Not Individual Queries ➡️</a>
</div>
