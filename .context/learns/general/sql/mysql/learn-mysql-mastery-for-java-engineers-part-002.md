# learn-mysql-mastery-for-java-engineers-part-002.md

# Part 002 — InnoDB Storage Model: Pages, Extents, Tablespaces, Rows

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `002 / 034`  
> Topik: InnoDB physical storage model  
> Target pembaca: Java software engineer yang ingin memahami MySQL sampai level production-grade reasoning

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas arsitektur besar MySQL: koneksi client, session, parser, resolver, optimizer, executor, dan storage engine. Sekarang kita masuk lebih dalam ke storage engine default yang paling penting di MySQL modern: **InnoDB**.

Bagian ini menjawab pertanyaan:

> “Ketika saya membuat tabel, memilih primary key, menambah index, menyimpan JSON, memakai UUID, atau membuat kolom `VARCHAR(500)`, apa yang sebenarnya terjadi di storage engine?”

Sebagai Java engineer, kamu tidak cukup hanya tahu bahwa MySQL menyimpan data di disk. Kamu perlu memahami bahwa InnoDB menyimpan data sebagai **B+Tree pages** di dalam **tablespace**, dengan aturan tertentu tentang row layout, clustered index, secondary index, page split, off-page storage, dan buffer pool.

Kenapa ini penting?

Karena banyak masalah production terlihat seperti masalah query, padahal akar masalahnya adalah desain fisik data:

- primary key terlalu random
- secondary index terlalu gemuk
- row terlalu lebar
- kolom `TEXT`/`JSON` dipakai sembarangan
- tabel sering page split
- buffer pool tidak cukup untuk working set
- index lookup selalu melakukan double read
- delete besar meninggalkan fragmentation
- migration memperbesar row dan membuat page density turun

Setelah bagian ini, kamu harus bisa melihat tabel MySQL bukan hanya sebagai struktur logis:

```sql
CREATE TABLE cases (...);
```

melainkan sebagai struktur fisik:

```text
tablespace
  └── segments
      └── extents
          └── pages, biasanya 16KB
              └── B+Tree records
                  ├── clustered index leaf page berisi row data
                  └── secondary index leaf page berisi secondary key + primary key
```

---

## 1. Referensi Resmi yang Menjadi Baseline

Materi ini menggunakan MySQL 8.4 LTS sebagai baseline utama. Manual resmi MySQL 8.4 mendokumentasikan MySQL 8.4 sampai 8.4.9, sehingga cocok dijadikan baseline production modern untuk seri ini.

Beberapa fakta penting dari dokumentasi resmi:

- InnoDB menyimpan index sebagai struktur B-tree, dan ukuran default index page adalah 16KB, ditentukan oleh `innodb_page_size` saat instance MySQL diinisialisasi.
- InnoDB table memiliki clustered index khusus yang menyimpan row data; biasanya clustered index ini identik dengan primary key.
- Secondary index di InnoDB menyimpan primary key value untuk setiap record, bukan pointer fisik langsung ke row.
- File-per-table tablespace adalah default untuk tabel InnoDB modern dan memungkinkan disk space dikembalikan ke operating system ketika tabel di-drop atau di-truncate.
- InnoDB mengalokasikan page dan extent di dalam tablespace; ketika segment bertumbuh, InnoDB dapat mengalokasikan page satu per satu lalu extent secara utuh.
- InnoDB mendukung row format seperti `REDUNDANT`, `COMPACT`, `DYNAMIC`, dan `COMPRESSED`, dengan `DYNAMIC` menjadi format yang umum pada MySQL modern.

Referensi:

- MySQL 8.4 Reference Manual — InnoDB Storage Engine: <https://dev.mysql.com/doc/refman/8.4/en/innodb-storage-engine.html>
- MySQL 8.4 Reference Manual — Clustered and Secondary Indexes: <https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html>
- MySQL 8.4 Reference Manual — Physical Structure of an InnoDB Index: <https://dev.mysql.com/doc/refman/8.4/en/innodb-physical-structure.html>
- MySQL 8.4 Reference Manual — File Space Management: <https://dev.mysql.com/doc/refman/8.4/en/innodb-file-space.html>
- MySQL 8.4 Reference Manual — System Tablespace and File-Per-Table Tablespaces: <https://dev.mysql.com/doc/refman/8.4/en/innodb-system-tablespace.html>
- MySQL Reference Manual — InnoDB Row Formats: <https://dev.mysql.com/doc/refman/8.4/en/innodb-row-format.html>

---

## 2. Mental Model Utama: InnoDB Adalah Page-Oriented B+Tree Storage Engine

Cara paling tepat memahami InnoDB:

> InnoDB adalah storage engine yang menyimpan data dan index sebagai page-page berukuran tetap, disusun dalam B+Tree, dikelola di dalam tablespace, dan dimediasi oleh buffer pool.

Bukan begini:

```text
row 1
row 2
row 3
row 4
```

Melainkan begini:

```text
B+Tree

root page
  ├── internal page
  │   ├── leaf page: records
  │   └── leaf page: records
  └── internal page
      ├── leaf page: records
      └── leaf page: records
```

Setiap leaf page berisi banyak record. Jika page sudah penuh dan ada insert/update yang butuh ruang, InnoDB mungkin melakukan page split atau memindahkan sebagian data.

### 2.1 Kenapa “page” adalah unit penting?

Karena database jarang membaca satu row secara fisik dari disk. Database membaca page.

Jika page size 16KB, maka walaupun kamu hanya butuh satu row kecil, InnoDB bekerja dengan page 16KB:

```text
Disk / SSD / storage
  ↓ read page
InnoDB buffer pool
  ↓ extract record
SQL executor
  ↓ return row
Java application
```

Artinya:

- row kecil memungkinkan lebih banyak row per page
- lebih banyak row per page berarti lebih sedikit page read
- lebih sedikit page read berarti lebih baik untuk cache locality
- row besar mengurangi page density
- primary key besar memperbesar semua secondary index
- random primary key menurunkan locality insert
- wide secondary index memperbesar storage dan buffer pool pressure

### 2.2 Analogi untuk Java engineer

Bayangkan InnoDB seperti struktur data persistent:

```java
class InnoDBTable {
    BPlusTree<PrimaryKey, FullRow> clusteredIndex;
    List<BPlusTree<SecondaryKey, PrimaryKey>> secondaryIndexes;
}
```

Lookup via primary key kira-kira:

```java
FullRow row = clusteredIndex.get(primaryKey);
```

Lookup via secondary index kira-kira:

```java
PrimaryKey pk = secondaryIndex.get(secondaryKey);
FullRow row = clusteredIndex.get(pk);
```

Itulah sebabnya secondary index lookup sering disebut membutuhkan dua langkah:

1. cari primary key di secondary index
2. cari full row di clustered index

Jika secondary index sudah covering, langkah kedua tidak perlu karena semua kolom yang dibutuhkan query sudah tersedia di secondary index.

---

## 3. Hierarki Penyimpanan InnoDB

InnoDB storage dapat dipahami sebagai beberapa level:

```text
MySQL instance
  └── InnoDB storage engine
      └── tablespace
          └── segment
              └── extent
                  └── page
                      └── record
```

Mari kita bongkar satu per satu.

---

## 4. Tablespace

### 4.1 Apa itu tablespace?

Tablespace adalah container logis/fisik tempat InnoDB menyimpan data. Di dalamnya ada page-page yang menyimpan index dan row.

Dalam MySQL modern, jenis tablespace yang sering kamu temui:

1. system tablespace
2. file-per-table tablespace
3. general tablespace
4. undo tablespace
5. temporary tablespace

Untuk aplikasi Java biasa, yang paling sering berdampak langsung adalah:

- system tablespace
- file-per-table tablespace
- temporary tablespace
- undo tablespace

### 4.2 System tablespace

System tablespace historisnya adalah tempat utama InnoDB menyimpan banyak struktur internal. File klasiknya sering dikenal sebagai `ibdata1`.

System tablespace dapat berisi:

- InnoDB data dictionary internal/historis
- doublewrite buffer
- change buffer
- undo logs pada konfigurasi lama
- metadata tertentu

Pada MySQL modern, banyak data tabel user biasanya memakai file-per-table tablespace secara default, tetapi system tablespace tetap penting.

### 4.3 File-per-table tablespace

Dengan file-per-table, setiap tabel InnoDB memiliki file `.ibd` sendiri.

Contoh konseptual:

```text
/var/lib/mysql/app/cases.ibd
/var/lib/mysql/app/case_events.ibd
/var/lib/mysql/app/enforcement_actions.ibd
```

Keuntungan file-per-table:

- tabel dapat dikelola lebih independen
- `DROP TABLE` dan `TRUNCATE TABLE` dapat mengembalikan space ke OS
- backup/restore/tablespace transport lebih fleksibel
- lebih mudah memahami footprint per tabel

Trade-off:

- banyak file jika jumlah tabel sangat besar
- filesystem metadata overhead
- fragmentation tetap mungkin terjadi di level file

### 4.4 General tablespace

General tablespace memungkinkan beberapa tabel berada dalam satu tablespace user-defined.

Ini lebih jarang diperlukan untuk aplikasi biasa. Biasanya muncul dalam kebutuhan khusus:

- pengaturan storage tertentu
- grouping beberapa tabel
- operational layout tertentu

Untuk kebanyakan tim aplikasi, file-per-table adalah default yang masuk akal.

### 4.5 Undo tablespace

Undo tablespace menyimpan undo log yang dibutuhkan untuk MVCC dan rollback.

Ini akan kita bahas lebih dalam di part tentang MVCC, tetapi untuk sekarang cukup pahami:

- update/delete tidak langsung “menghapus masa lalu”
- InnoDB perlu menyimpan versi sebelumnya
- versi lama dipakai oleh transaksi lain yang masih punya read view lama
- long-running transaction dapat membuat undo history menumpuk

### 4.6 Temporary tablespace

Temporary tablespace dipakai untuk temporary table internal atau user-created temporary table tertentu.

Ini relevan saat query melakukan:

- sort besar
- group by besar
- distinct besar
- derived table / materialized CTE besar
- join intermediate besar

Dalam incident production, temporary tablespace bisa tiba-tiba membesar karena satu query dashboard/reporting yang buruk.

---

## 5. Segment

Segment adalah struktur alokasi di dalam tablespace. Secara sederhana, segment adalah kumpulan extent/page untuk objek tertentu.

Dalam konteks index B+Tree, biasanya ada segment untuk:

- leaf pages
- non-leaf pages

Contoh mental model:

```text
clustered index of cases
  ├── internal/non-leaf segment
  └── leaf segment
```

Kamu tidak sering mengelola segment secara langsung sebagai developer, tetapi konsep ini penting untuk memahami bahwa InnoDB mengelola pertumbuhan struktur B+Tree secara bertahap.

---

## 6. Extent

Extent adalah kumpulan page yang dialokasikan bersama. Dalam InnoDB, extent umumnya berukuran 1MB ketika page size default 16KB.

```text
1 extent = 64 pages x 16KB = 1024KB = 1MB
```

Kenapa extent penting?

Karena InnoDB tidak hanya berpikir per row. Ia mengatur ruang dalam blok-blok yang lebih besar untuk menjaga locality dan efisiensi alokasi.

Jika tabel atau index bertumbuh, InnoDB akan menambah alokasi page/extent.

Efek praktis:

- data tidak selalu compact sempurna
- growth pattern memengaruhi layout
- insert random bisa menyebar ke banyak page
- delete besar tidak otomatis membuat file mengecil
- rebuild table/index kadang dibutuhkan untuk reclaim/defragment

---

## 7. Page

### 7.1 Page adalah unit kerja fisik utama

Page adalah unit dasar I/O, caching, dan penyimpanan InnoDB.

Default page size InnoDB adalah **16KB**.

```text
InnoDB page, default 16KB
+------------------------------------------------+
| page header                                    |
| infimum/supremum pseudo-records                |
| user records                                   |
| free space                                     |
| page directory                                 |
| page trailer/checksum                          |
+------------------------------------------------+
```

Page menyimpan beberapa record yang terurut berdasarkan key B+Tree.

### 7.2 Page types

InnoDB punya banyak tipe page, misalnya:

- index page
- undo log page
- inode page
- system page
- blob page
- insert buffer/change buffer related pages

Untuk developer aplikasi, yang paling penting adalah:

- index page
- blob/off-page storage page
- undo pages secara konseptual

### 7.3 Page dan buffer pool

Saat query membutuhkan data, InnoDB mencari page di buffer pool.

```text
query membutuhkan row
  ↓
cari page di buffer pool
  ├── found: memory access
  └── not found: read page dari disk/storage ke buffer pool
```

Jadi performa query sangat ditentukan oleh:

- berapa banyak page yang harus dibaca
- apakah page tersebut sudah ada di buffer pool
- seberapa sering page di-evict
- apakah working set muat di memory

### 7.4 Page density

Page density adalah seberapa penuh page dengan record berguna.

Jika row kecil:

```text
16KB page
  ├── row
  ├── row
  ├── row
  ├── row
  ├── ... banyak row
```

Jika row besar:

```text
16KB page
  ├── row besar
  ├── row besar
  └── sedikit free space
```

Implikasi:

- row besar = lebih banyak page untuk jumlah row yang sama
- lebih banyak page = buffer pool pressure naik
- scan menjadi lebih mahal
- secondary index lookup mungkin lebih mahal

---

## 8. Record: Row Tidak Sama dengan Object Java

Dalam Java, kamu mungkin punya object seperti ini:

```java
class CaseEntity {
    Long id;
    String caseNumber;
    String status;
    String priority;
    Instant createdAt;
    Instant updatedAt;
    String description;
    String metadataJson;
}
```

Di InnoDB, record bukan object seperti itu. Record adalah representasi byte di dalam page, dengan header internal dan encoding tertentu.

Ada beberapa hal yang membuat row fisik berbeda dari object Java:

- nullable column punya bitmap/metadata
- variable-length column punya length metadata
- `VARCHAR`, `TEXT`, `BLOB`, `JSON` punya storage behavior berbeda
- row memiliki hidden system columns tertentu
- clustered index record berisi full row
- secondary index record hanya berisi indexed columns + primary key

---

## 9. Hidden Columns dalam InnoDB

InnoDB membutuhkan metadata internal untuk MVCC dan transaction management.

Pada clustered index record, InnoDB menyimpan informasi seperti:

- transaction ID
- roll pointer ke undo log

Selain itu, jika tabel tidak punya primary key atau suitable unique key, InnoDB membuat hidden row ID internal.

Ini penting sekali:

> Jangan sengaja membiarkan tabel InnoDB tanpa primary key.

Kenapa?

Karena kamu kehilangan kontrol terhadap clustered index. InnoDB tetap butuh clustered index, jadi ia akan memilih/membuat struktur internal. Untuk sistem production, ini buruk untuk predictability, replication tooling, migration, debugging, dan application reasoning.

Rule praktis:

```text
Setiap tabel InnoDB production harus punya primary key eksplisit.
```

---

## 10. Clustered Index: Tabel Adalah Primary Key B+Tree

Ini adalah konsep paling penting dalam InnoDB.

Di InnoDB:

> Tabel disimpan sebagai clustered index.

Artinya, data row fisik berada di leaf page dari B+Tree primary key.

Contoh:

```sql
CREATE TABLE cases (
    id BIGINT PRIMARY KEY,
    case_number VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    summary VARCHAR(500) NOT NULL
) ENGINE=InnoDB;
```

Secara fisik:

```text
clustered index on id

root page
  ↓
internal pages
  ↓
leaf pages:
  [id=1, full row]
  [id=2, full row]
  [id=3, full row]
```

Bukan begini:

```text
heap table
  row location A
  row location B
  row location C

primary index points to row locations
```

InnoDB tidak seperti heap-table model tradisional. InnoDB table adalah B+Tree yang di-cluster berdasarkan primary key.

### 10.1 Primary key menentukan physical locality

Jika primary key naik berurutan:

```text
1, 2, 3, 4, 5, 6, 7
```

Insert cenderung masuk ke kanan B+Tree.

Jika primary key random:

```text
7f3a..., 1c9b..., e82d..., 44aa...
```

Insert bisa menyentuh banyak page acak.

Efeknya:

- lebih banyak random page modification
- lebih sering page split
- buffer pool churn
- write amplification
- storage fragmentation
- secondary index menjadi lebih besar jika primary key besar

### 10.2 Primary key bukan hanya logical identity

Banyak developer berpikir primary key hanya untuk identitas:

```text
id = identity
```

Di InnoDB, primary key juga:

```text
id = physical clustering key
```

Ini berarti pilihan primary key adalah keputusan arsitektur storage.

---

## 11. Secondary Index: Index yang Menyimpan Primary Key

Misalnya:

```sql
CREATE INDEX idx_cases_status_created
ON cases(status, created_at);
```

Secondary index tidak menyimpan pointer fisik ke row. Leaf record secondary index menyimpan:

```text
(status, created_at, primary_key)
```

Secara konseptual:

```text
secondary index idx_cases_status_created

key: (status='OPEN', created_at='2026-06-22 10:00:00')
value: primary key id=12345
```

Untuk mengambil full row:

```text
1. cari id di secondary index
2. cari full row di clustered index berdasarkan id
```

Ini disebut back-to-table lookup atau clustered index lookup.

### 11.1 Kenapa secondary index menyimpan primary key?

Karena row data disimpan berdasarkan clustered index. Primary key adalah alamat logis menuju row.

Jika primary key berubah, row secara fisik harus pindah posisi di clustered index. Itulah sebabnya update primary key adalah operasi mahal dan biasanya harus dihindari.

### 11.2 Primary key besar memperbesar semua secondary index

Misalnya tabel:

```sql
CREATE TABLE events (
    id CHAR(36) PRIMARY KEY,
    case_id CHAR(36) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    KEY idx_case_created (case_id, created_at),
    KEY idx_type_created (event_type, created_at),
    KEY idx_created (created_at)
) ENGINE=InnoDB;
```

Jika `id` adalah `CHAR(36)`, maka setiap secondary index menyimpan `CHAR(36)` sebagai bagian leaf record.

Jika ada 3 secondary index dan 100 juta row, dampaknya besar.

Bandingkan dengan:

```sql
id BIGINT PRIMARY KEY
```

`BIGINT` hanya 8 byte.

Rule penting:

> Di InnoDB, ukuran primary key mengalikan biaya semua secondary index.

### 11.3 Covering index

Jika query hanya membutuhkan kolom yang ada di secondary index, InnoDB tidak perlu lookup ke clustered index.

Contoh:

```sql
SELECT case_id, created_at
FROM events
WHERE case_id = ?
ORDER BY created_at DESC
LIMIT 20;
```

Dengan index:

```sql
KEY idx_case_created (case_id, created_at)
```

Query bisa dilayani dari index saja.

Tetapi jika query:

```sql
SELECT *
FROM events
WHERE case_id = ?
ORDER BY created_at DESC
LIMIT 20;
```

Maka InnoDB perlu mengambil full row dari clustered index untuk setiap match.

Pelajaran:

```text
SELECT * bukan sekadar masalah bandwidth.
SELECT * dapat mengubah access pattern storage.
```

---

## 12. B+Tree Physical Structure

### 12.1 Kenapa B+Tree?

B+Tree cocok untuk database karena:

- data terurut
- range scan efisien
- lookup logaritmik
- leaf page dapat di-link untuk scanning
- fan-out besar karena page berisi banyak key

Struktur sederhana:

```text
             [root]
          /     |      \
   [internal] [internal] [internal]
      /   \        |       /   \
  [leaf] [leaf] [leaf] [leaf] [leaf]
```

Leaf page menyimpan record.

Untuk clustered index:

```text
leaf page = primary key + full row
```

Untuk secondary index:

```text
leaf page = secondary key + primary key
```

### 12.2 Tree height

Dengan page 16KB dan fan-out tinggi, B+Tree bisa menyimpan banyak row dengan height kecil.

Contoh kasar:

```text
height 1: root sekaligus leaf, tabel kecil
height 2: root -> leaf
height 3: root -> internal -> leaf
height 4: sangat besar
```

Setiap level menambah page access. Tetapi karena root/internal pages sering cached, biaya terbesar biasanya leaf page dan clustered lookup.

### 12.3 Range scan

Range scan bagus di B+Tree karena leaf page terurut.

Contoh:

```sql
SELECT *
FROM case_events
WHERE case_id = ?
  AND created_at >= ?
  AND created_at < ?
ORDER BY created_at;
```

Index:

```sql
KEY idx_case_created (case_id, created_at)
```

B+Tree memungkinkan:

```text
seek ke awal range
  ↓
scan leaf page berikutnya
  ↓
stop saat range selesai
```

Ini jauh lebih baik daripada full table scan.

---

## 13. Page Split

### 13.1 Apa itu page split?

Page split terjadi ketika InnoDB perlu memasukkan record ke page yang tidak punya cukup ruang.

Contoh page sederhana:

```text
page A:
[10, 20, 30, 40, 50] full
```

Insert key `35`:

```text
page A terlalu penuh
  ↓
split menjadi page A dan page B

page A: [10, 20, 30]
page B: [35, 40, 50]
```

Dalam real InnoDB, prosesnya lebih kompleks, tetapi mental model ini cukup.

### 13.2 Sequential insert vs random insert

Sequential insert:

```text
1, 2, 3, 4, 5, 6, 7, 8
```

Cenderung append ke sisi kanan index.

Random insert:

```text
103, 7, 982, 51, 600, 12
```

Cenderung menyisip ke berbagai page.

### 13.3 Kenapa page split mahal?

Page split dapat menyebabkan:

- modifikasi lebih dari satu page
- update parent page
- lebih banyak redo log
- lebih banyak dirty page
- fragmentation
- cache churn

Jika workload insert tinggi menggunakan UUID random sebagai primary key, page split dan random write bisa menjadi biaya signifikan.

### 13.4 Page split dan UUID

UUID string random sering menjadi masalah jika dipakai sebagai primary key InnoDB:

```sql
id CHAR(36) PRIMARY KEY
```

Masalah:

- besar: 36 karakter
- random: insert tersebar
- secondary index membesar
- comparison lebih mahal dari integer/binary

Alternatif:

- `BIGINT AUTO_INCREMENT`
- time-ordered UUID/ULID dengan hati-hati
- `BINARY(16)` untuk UUID
- generated distributed ID yang roughly monotonic

Kita akan membahas primary key design secara sangat detail di Part 003.

---

## 14. Row Format

InnoDB mendukung beberapa row format:

- `REDUNDANT`
- `COMPACT`
- `DYNAMIC`
- `COMPRESSED`

Untuk MySQL modern, yang paling umum adalah `DYNAMIC`.

### 14.1 Kenapa row format penting?

Row format menentukan bagaimana InnoDB menyimpan variable-length columns seperti:

- `VARCHAR`
- `VARBINARY`
- `TEXT`
- `BLOB`
- `JSON`

Terutama ketika data besar dan tidak muat nyaman di page.

### 14.2 COMPACT

`COMPACT` adalah format lama yang lebih efisien daripada `REDUNDANT`, tetapi untuk large variable-length columns, sebagian prefix data dapat disimpan inline di clustered index record.

Efeknya:

- clustered index page bisa lebih gemuk
- page density turun
- scan full row bisa lebih mahal

### 14.3 DYNAMIC

`DYNAMIC` cenderung menyimpan long variable-length columns secara off-page dengan pointer di row utama.

Contoh:

```text
clustered index record:
  id
  status
  created_at
  pointer to large JSON/TEXT data

external page:
  actual large JSON/TEXT payload
```

Ini membantu menjaga clustered index page tidak terlalu bengkak ketika ada large columns.

Tetapi jangan salah:

> Off-page storage bukan berarti gratis.

Jika query membutuhkan kolom besar itu, InnoDB harus membaca page tambahan.

### 14.4 COMPRESSED

`COMPRESSED` row format menyediakan kompresi page/data, tetapi membawa trade-off CPU dan operational complexity. Pada banyak deployment modern, kompresi di layer storage/cloud juga perlu dipertimbangkan sehingga keputusan tidak bisa dibuat hanya dari satu sisi.

Untuk aplikasi biasa, jangan langsung memakai compressed row format tanpa benchmark real workload.

### 14.5 REDUNDANT

`REDUNDANT` adalah row format lama untuk compatibility. Untuk sistem baru, biasanya tidak dipilih.

---

## 15. Off-Page Storage: TEXT, BLOB, JSON, dan Kolom Besar

### 15.1 Masalah kolom besar

Misalnya:

```sql
CREATE TABLE cases (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    full_description TEXT NOT NULL,
    metadata JSON NOT NULL
) ENGINE=InnoDB;
```

Secara logis ini sederhana.

Secara fisik:

- `status` kecil
- `summary` sedang
- `full_description` bisa besar
- `metadata` bisa sangat besar

Jika query paling umum adalah:

```sql
SELECT id, status, summary
FROM cases
WHERE status = 'OPEN'
ORDER BY id
LIMIT 50;
```

Kolom `full_description` dan `metadata` tidak dibutuhkan. Tetapi keberadaannya tetap memengaruhi desain row dan page, terutama jika sebagian data inline atau pointer/off-page memengaruhi layout.

### 15.2 Pola vertical split

Untuk kolom besar yang jarang dibaca, pertimbangkan memisahkan tabel:

```sql
CREATE TABLE cases (
    id BIGINT PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE case_details (
    case_id BIGINT PRIMARY KEY,
    full_description TEXT NOT NULL,
    metadata JSON NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB;
```

Keuntungan:

- tabel utama lebih ramping
- page density lebih tinggi
- dashboard/list query lebih cepat
- buffer pool tidak diisi payload besar yang jarang dipakai
- detail hanya dibaca saat user membuka halaman detail

Trade-off:

- perlu join untuk detail
- konsistensi insert/update harus dijaga
- foreign key/transaction design lebih kompleks

### 15.3 Rule praktis

Untuk sistem case management:

```text
Hot path fields:
  simpan di tabel utama

Cold/detail fields:
  pertimbangkan tabel detail

Large audit payload:
  pertimbangkan event/audit table terpisah

Blob/document binary:
  sering lebih baik di object storage, DB hanya metadata + reference
```

---

## 16. Clustered Index Record vs Secondary Index Record

Ini perlu dikuasai sampai refleks.

Misalnya:

```sql
CREATE TABLE enforcement_cases (
    id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    KEY idx_tenant_status_created (tenant_id, status, created_at),
    KEY idx_subject_created (subject_id, created_at),
    UNIQUE KEY uk_tenant_case_number (tenant_id, case_number)
) ENGINE=InnoDB;
```

Clustered index leaf:

```text
id -> full row:
  id
  tenant_id
  case_number
  subject_id
  status
  priority
  created_at
  updated_at
  summary
  hidden trx fields
```

Secondary index `idx_tenant_status_created` leaf:

```text
(tenant_id, status, created_at, id)
```

Secondary index `idx_subject_created` leaf:

```text
(subject_id, created_at, id)
```

Unique secondary index `uk_tenant_case_number` leaf:

```text
(tenant_id, case_number, id)
```

Catatan: secondary index tetap membawa primary key agar dapat menemukan row di clustered index.

### 16.1 Consequence: index bukan “free metadata”

Setiap index adalah struktur B+Tree fisik sendiri.

Jika kamu punya 6 secondary index, setiap insert/update/delete mungkin perlu memodifikasi beberapa B+Tree.

```text
INSERT row
  ↓
modify clustered index
  ↓
modify secondary index 1
  ↓
modify secondary index 2
  ↓
modify secondary index 3
  ↓
...
```

Itulah kenapa over-indexing menurunkan write throughput.

### 16.2 Update column yang indexed vs non-indexed

Update kolom non-indexed:

```sql
UPDATE cases
SET summary = ?
WHERE id = ?;
```

Biasanya hanya clustered index record yang berubah.

Update kolom indexed:

```sql
UPDATE cases
SET status = 'CLOSED'
WHERE id = ?;
```

Jika `status` ada di index, InnoDB perlu memperbarui secondary index terkait:

```text
remove old secondary index entry
insert new secondary index entry
update clustered row
```

Untuk sistem workflow yang sering mengubah `status`, index status perlu didesain hati-hati.

---

## 17. Physical Impact dari Primary Key Choice

Part berikutnya akan khusus membahas primary key design, tetapi di sini kita perlu fondasinya.

### 17.1 AUTO_INCREMENT BIGINT

```sql
id BIGINT PRIMARY KEY AUTO_INCREMENT
```

Kelebihan:

- kecil, 8 byte
- sequential
- bagus untuk clustered insert locality
- secondary index lebih kecil
- mudah untuk join
- mudah untuk pagination internal

Kekurangan:

- predictable ID
- koordinasi sulit untuk multi-writer distributed system jika tidak memakai auto-increment offset/sequence strategy
- bisa menjadi hotspot pada insert sangat tinggi, meski biasanya acceptable untuk banyak workload
- exposing ID publik bisa menimbulkan enumeration risk

### 17.2 UUID CHAR(36)

```sql
id CHAR(36) PRIMARY KEY
```

Kelebihan:

- globally unique
- bisa dibuat di app
- tidak butuh roundtrip sequence
- bagus untuk external/public ID

Kekurangan:

- besar
- random
- memperbesar secondary index
- insert locality buruk
- string comparison lebih mahal

### 17.3 UUID BINARY(16)

```sql
id BINARY(16) PRIMARY KEY
```

Lebih baik dari `CHAR(36)` secara ukuran, tetapi jika random tetap punya masalah locality.

### 17.4 Dual identifier pattern

Untuk banyak sistem enterprise/regulatory, pola ini sering lebih baik:

```sql
CREATE TABLE cases (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id BINARY(16) NOT NULL UNIQUE,
    case_number VARCHAR(64) NOT NULL UNIQUE,
    ...
) ENGINE=InnoDB;
```

Gunakan:

- `id` untuk internal PK, join, FK, clustered index
- `public_id` untuk API/public reference
- `case_number` untuk business/legal identifier

Ini memisahkan:

```text
physical identity != public identity != business identity
```

Pemisahan ini sering membuat desain lebih fleksibel.

---

## 18. Row Width dan Page Density

### 18.1 Row kecil vs row besar

Misalnya page 16KB.

Jika rata-rata row efektif 200 byte:

```text
~80 row per page, sebelum overhead
```

Jika rata-rata row efektif 2KB:

```text
~8 row per page, sebelum overhead
```

Efek pada scan 1 juta row:

```text
row 200 byte: sekitar 12.500 page
row 2KB: sekitar 125.000 page
```

Angka ini sangat kasar, tetapi mental modelnya kuat:

> Row width adalah multiplier biaya I/O dan memory.

### 18.2 Java entity anti-pattern

Banyak aplikasi Java membuat satu entity besar:

```java
@Entity
class CaseEntity {
    Long id;
    String status;
    String priority;
    String summary;
    String fullDescription;
    String metadataJson;
    String internalNotes;
    String rawPayload;
    String computedSnapshot;
}
```

Lalu repository sering melakukan:

```java
List<CaseEntity> findByStatus(String status);
```

ORM mungkin menghasilkan:

```sql
SELECT *
FROM cases
WHERE status = ?;
```

Masalah:

- membaca kolom besar yang tidak dibutuhkan
- membuat network payload besar
- membuat object allocation besar di JVM
- memperbesar GC pressure
- memperburuk DB page access

Solusi:

- gunakan projection/DTO query
- vertical split cold fields
- jangan default `SELECT *` untuk list screen
- desain hot read model terpisah jika perlu

---

## 19. Tablespace Growth, Delete, dan Fragmentation

### 19.1 Insert membuat file tumbuh

Saat tabel bertumbuh, `.ibd` file tumbuh.

```text
cases.ibd
  100MB
  500MB
  2GB
  20GB
```

### 19.2 Delete tidak selalu mengecilkan file

Jika kamu menghapus banyak row:

```sql
DELETE FROM case_events
WHERE created_at < '2020-01-01';
```

Space di dalam tablespace bisa tersedia untuk reuse oleh InnoDB, tetapi file `.ibd` tidak otomatis mengecil seperti yang banyak developer harapkan.

Untuk benar-benar mengembalikan space ke OS, sering diperlukan operasi seperti:

- `OPTIMIZE TABLE`
- rebuild table
- partition drop/truncate
- logical dump/restore

Tetapi operasi ini punya risiko lock, I/O besar, replication impact, dan downtime/latency impact.

### 19.3 Retention design lebih baik daripada delete besar

Untuk tabel event/audit/log yang sangat besar, strategi lebih baik sering berupa partitioning time-based:

```text
partition by month
  p202501
  p202502
  p202503
```

Lalu retention dilakukan dengan drop partition, bukan delete row satu per satu.

Ini akan dibahas detail di Part 030.

---

## 20. Case Study: Regulatory Enforcement Lifecycle Platform

Anggap kamu membangun sistem regulatory enforcement dengan entitas:

- case
- subject
- allegation
- evidence
- enforcement action
- case event
- SLA timer
- escalation
- audit trail

### 20.1 Desain naif

```sql
CREATE TABLE cases (
    id CHAR(36) PRIMARY KEY,
    tenant_id CHAR(36) NOT NULL,
    case_number VARCHAR(100) NOT NULL,
    subject_payload JSON NOT NULL,
    evidence_payload JSON NOT NULL,
    status VARCHAR(50) NOT NULL,
    priority VARCHAR(20) NOT NULL,
    full_description TEXT NOT NULL,
    audit_snapshot JSON NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    KEY idx_status (status),
    KEY idx_tenant_status (tenant_id, status),
    KEY idx_created (created_at)
) ENGINE=InnoDB;
```

Masalah fisik:

- `CHAR(36)` primary key besar dan random
- `tenant_id CHAR(36)` memperbesar indexes
- JSON besar di tabel hot path
- audit snapshot membuat row gemuk
- `idx_status` low-cardinality dan mungkin kurang berguna
- secondary index membawa PK besar
- list screen akan mahal jika memakai `SELECT *`

### 20.2 Desain lebih sadar InnoDB

```sql
CREATE TABLE cases (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id BINARY(16) NOT NULL,
    tenant_id BIGINT NOT NULL,
    case_number VARCHAR(64) NOT NULL,
    subject_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority VARCHAR(16) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    summary VARCHAR(500) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_cases_public_id (public_id),
    UNIQUE KEY uk_tenant_case_number (tenant_id, case_number),
    KEY idx_tenant_status_updated (tenant_id, status, updated_at, id),
    KEY idx_tenant_priority_created (tenant_id, priority, created_at, id),
    KEY idx_subject_created (subject_id, created_at, id)
) ENGINE=InnoDB;

CREATE TABLE case_details (
    case_id BIGINT PRIMARY KEY,
    full_description TEXT NOT NULL,
    dynamic_attributes JSON NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB;

CREATE TABLE case_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    case_id BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    actor_id BIGINT NULL,
    occurred_at DATETIME(6) NOT NULL,
    payload JSON NULL,
    KEY idx_case_occurred (case_id, occurred_at, id),
    KEY idx_occurred (occurred_at, id),
    FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB;
```

Keuntungan:

- clustered PK kecil dan sequential
- public ID dipisahkan dari physical ID
- hot table lebih ramping
- detail payload dipisah
- event/audit punya tabel append-oriented sendiri
- secondary index lebih kecil
- pagination bisa memakai `(tenant_id, status, updated_at, id)`
- optimistic locking didukung `version`

Trade-off:

- lebih banyak tabel
- perlu join untuk detail
- butuh discipline di repository/API layer
- perlu mapping yang lebih eksplisit

### 20.3 Lesson

Desain bagus bukan hanya “normalisasi”.

Desain bagus untuk MySQL adalah gabungan:

```text
logical correctness
+ access pattern awareness
+ physical storage awareness
+ concurrency awareness
+ operational maintainability
```

---

## 21. Impact ke Java, JPA, Hibernate, JDBC

### 21.1 Entity design harus sadar storage

Jangan membuat satu entity sebagai refleksi semua kebutuhan layar.

Gunakan model berbeda:

- write entity
- read projection
- list DTO
- detail DTO
- audit/event entity

Contoh:

```java
public record CaseListItem(
    long id,
    UUID publicId,
    String caseNumber,
    String status,
    String priority,
    Instant updatedAt,
    String summary
) {}
```

Query list:

```sql
SELECT id, public_id, case_number, status, priority, updated_at, summary
FROM cases
WHERE tenant_id = ?
  AND status = ?
ORDER BY updated_at DESC, id DESC
LIMIT ?;
```

Jangan default mengambil:

```sql
SELECT *
```

### 21.2 Lazy loading bukan solusi universal

ORM lazy loading bisa menyembunyikan masalah:

- N+1 query
- transaksi terlalu panjang
- connection tertahan
- query detail muncul di loop

Lebih baik eksplisit:

- list endpoint memakai projection
- detail endpoint memakai query detail
- event timeline endpoint query tabel event

### 21.3 Generated key strategy

Jika memakai `AUTO_INCREMENT`, Java layer perlu memperhatikan:

- batch insert behavior
- generated keys retrieval
- ORM identity strategy
- transaction boundary

Jika memakai UUID generated di app:

- gunakan binary representation jika disimpan di MySQL
- pertimbangkan ordered UUID/ULID
- jangan otomatis memakai `CHAR(36)` sebagai clustered PK tanpa alasan kuat

### 21.4 Batch insert dan index cost

Batch insert bukan hanya soal JDBC batch. Setiap row tetap memperbarui:

- clustered index
- semua secondary index
- redo log
- undo log
- binlog jika enabled

Jika bulk load besar:

- kurangi index yang tidak perlu
- batch dengan ukuran masuk akal
- jangan satu transaksi terlalu besar tanpa alasan
- monitor redo/binlog/replication lag

---

## 22. Common Misconceptions

### Misconception 1: “Index hanya pointer ke row”

Di InnoDB, secondary index menyimpan primary key, bukan pointer fisik sederhana.

### Misconception 2: “Primary key hanya identitas logical”

Di InnoDB, primary key adalah clustered storage order.

### Misconception 3: “UUID selalu bagus karena scalable”

UUID bagus untuk uniqueness, tetapi random UUID sebagai clustered primary key dapat buruk untuk locality, index size, dan write amplification.

### Misconception 4: “TEXT/JSON off-page berarti tidak ada efek”

Tetap ada pointer, metadata, page tambahan, buffer pool impact, dan access cost saat dibaca.

### Misconception 5: “Delete besar langsung mengurangi ukuran file”

InnoDB dapat reuse internal free space, tetapi file-per-table tablespace tidak selalu otomatis shrink setelah delete.

### Misconception 6: “Tambah index pasti mempercepat aplikasi”

Index mempercepat sebagian read pattern, tetapi memperlambat writes dan memperbesar storage/memory footprint.

### Misconception 7: “Kalau query pakai index, pasti optimal”

Bisa saja query memakai index tetapi tetap mahal karena:

- selectivity buruk
- banyak clustered lookup
- index tidak covering
- range terlalu besar
- order by tidak cocok
- row terlalu lebar

---

## 23. Design Heuristics

### 23.1 Primary key

Gunakan primary key yang:

- kecil
- stabil
- immutable
- preferably sequential atau roughly ordered
- cocok untuk FK dan join

Default kuat untuk banyak aplikasi:

```sql
id BIGINT PRIMARY KEY AUTO_INCREMENT
```

Lalu tambahkan public/business identifiers sesuai kebutuhan.

### 23.2 Row width

Pisahkan hot dan cold fields.

```text
Hot fields:
  sering difilter, disort, ditampilkan di list

Cold fields:
  dibaca hanya di detail, audit, export, atau investigation view
```

### 23.3 Index

Ingat:

```text
setiap secondary index = B+Tree fisik + primary key payload
```

Jangan menambah index tanpa memahami:

- query mana yang dilayani
- write cost tambahan
- storage cost
- apakah index covering
- apakah primary key terlalu besar

### 23.4 JSON

Gunakan JSON jika:

- atribut benar-benar semi-structured
- tidak sering menjadi predicate utama
- schema bervariasi secara wajar
- query path terbatas dan jelas

Hindari JSON jika:

- field sering difilter/sort/join
- field adalah domain utama
- perlu constraint kuat
- perlu audit/validation detail

### 23.5 Large table

Untuk tabel besar:

- desain retention sejak awal
- hindari delete massal tanpa batching/partition strategy
- pikirkan archive path
- ukur growth rate
- pahami index footprint

---

## 24. Diagnostic Queries untuk Melihat Storage Footprint

### 24.1 Ukuran tabel dan index

```sql
SELECT
    table_schema,
    table_name,
    engine,
    table_rows,
    ROUND(data_length / 1024 / 1024, 2) AS data_mb,
    ROUND(index_length / 1024 / 1024, 2) AS index_mb,
    ROUND((data_length + index_length) / 1024 / 1024, 2) AS total_mb
FROM information_schema.tables
WHERE table_schema = 'app'
ORDER BY total_mb DESC;
```

Interpretasi:

- `data_length`: kira-kira ukuran clustered data
- `index_length`: ukuran secondary indexes
- `table_rows`: estimasi, bukan selalu exact

### 24.2 Rasio index terhadap data

```sql
SELECT
    table_name,
    ROUND(data_length / 1024 / 1024, 2) AS data_mb,
    ROUND(index_length / 1024 / 1024, 2) AS index_mb,
    ROUND(index_length / NULLIF(data_length, 0), 2) AS index_to_data_ratio
FROM information_schema.tables
WHERE table_schema = 'app'
  AND engine = 'InnoDB'
ORDER BY index_to_data_ratio DESC;
```

Jika index size sangat besar dibanding data:

- terlalu banyak index
- primary key terlalu besar
- composite index terlalu gemuk
- redundant indexes
- low-value indexes

### 24.3 Melihat index definitions

```sql
SHOW INDEX FROM cases;
```

Atau:

```sql
SELECT
    table_name,
    index_name,
    seq_in_index,
    column_name,
    cardinality,
    non_unique
FROM information_schema.statistics
WHERE table_schema = 'app'
  AND table_name = 'cases'
ORDER BY index_name, seq_in_index;
```

### 24.4 Cek row format

```sql
SELECT
    table_schema,
    table_name,
    row_format
FROM information_schema.tables
WHERE table_schema = 'app'
  AND table_name = 'cases';
```

### 24.5 Cek tablespace-related metadata

```sql
SELECT *
FROM information_schema.innodb_tables
WHERE name LIKE 'app/%';
```

Catatan: nama view/kolom dapat berbeda antar versi, jadi selalu cek dokumentasi versi MySQL yang digunakan.

---

## 25. Practical Exercise

Gunakan latihan ini untuk membangun intuisi fisik.

### Exercise 1 — Bandingkan primary key

Buat tiga tabel:

```sql
CREATE TABLE t_bigint_pk (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    external_id BINARY(16) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    payload VARCHAR(200) NOT NULL,
    KEY idx_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE t_uuid_char_pk (
    id CHAR(36) PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    payload VARCHAR(200) NOT NULL,
    KEY idx_status_created (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE t_uuid_bin_pk (
    id BINARY(16) PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    payload VARCHAR(200) NOT NULL,
    KEY idx_status_created (status, created_at)
) ENGINE=InnoDB;
```

Insert 1 juta row ke masing-masing.

Bandingkan:

```sql
SELECT
    table_name,
    data_length,
    index_length,
    data_length + index_length AS total_length
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('t_bigint_pk', 't_uuid_char_pk', 't_uuid_bin_pk');
```

Pertanyaan:

- tabel mana yang index size-nya paling besar?
- bagaimana efek `CHAR(36)` terhadap secondary index?
- apakah `BINARY(16)` cukup memperbaiki size?
- apakah random insert masih berdampak walau binary lebih kecil?

### Exercise 2 — Covering index

Buat query:

```sql
EXPLAIN ANALYZE
SELECT status, created_at
FROM t_bigint_pk
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 100;
```

Lalu bandingkan dengan:

```sql
EXPLAIN ANALYZE
SELECT *
FROM t_bigint_pk
WHERE status = 'OPEN'
ORDER BY created_at
LIMIT 100;
```

Pertanyaan:

- apakah query pertama bisa covering?
- apakah query kedua perlu clustered lookup?
- bagaimana perbedaan runtime?

### Exercise 3 — Row width

Tambahkan kolom besar:

```sql
ALTER TABLE t_bigint_pk
ADD COLUMN large_text TEXT NULL;
```

Isi sebagian row dengan text besar.

Bandingkan:

- ukuran tabel
- performa `SELECT *`
- performa projection kecil
- buffer pool hit behavior jika bisa diamati

---

## 26. Checklist Review Desain Tabel InnoDB

Gunakan checklist ini sebelum membuat tabel production.

### 26.1 Primary key

- Apakah tabel punya primary key eksplisit?
- Apakah primary key immutable?
- Apakah primary key kecil?
- Apakah primary key berurutan atau minimal tidak terlalu random?
- Apakah primary key aman untuk semua secondary index?
- Apakah public/business ID dipisahkan dari physical PK bila perlu?

### 26.2 Row layout

- Apakah row terlalu lebar?
- Apakah kolom besar sering dibaca?
- Apakah kolom detail bisa dipisah?
- Apakah JSON dipakai untuk data yang benar-benar semi-structured?
- Apakah hot query memakai projection, bukan `SELECT *`?

### 26.3 Index

- Apakah setiap index melayani query penting?
- Apakah ada redundant index?
- Apakah composite index urutannya sesuai access pattern?
- Apakah secondary index menjadi terlalu besar karena PK besar?
- Apakah ada covering index untuk hot path?
- Apakah write cost masih acceptable?

### 26.4 Growth

- Berapa growth rate harian/bulanan?
- Apakah delete/retention strategy sudah ada?
- Apakah tabel event/audit perlu partitioning?
- Apakah backup/restore time masih acceptable?
- Apakah index build/migration masih feasible saat data besar?

### 26.5 Java integration

- Apakah entity tidak memaksa `SELECT *` di hot path?
- Apakah list endpoint memakai DTO/projection?
- Apakah ID mapping cocok dengan PK strategy?
- Apakah batch insert/update memperhitungkan index cost?
- Apakah transaction boundary tidak membawa payload besar tanpa perlu?

---

## 27. Ringkasan Mental Model

InnoDB menyimpan data bukan sebagai kumpulan object, melainkan sebagai B+Tree pages.

Konsep kunci:

```text
Tabel InnoDB = clustered index
Clustered index leaf = full row
Secondary index leaf = secondary key + primary key
Page = unit dasar I/O dan cache
Default page size = 16KB
Tablespace = container page
Extent = kumpulan page
Primary key = physical clustering decision
Row width = page density decision
Index = struktur B+Tree fisik, bukan metadata gratis
```

Jika kamu menguasai ini, kamu akan jauh lebih tajam saat mendesain schema, membaca execution plan, mendiagnosis slow query, atau menjelaskan kenapa “UUID sebagai PK” bukan sekadar preferensi gaya.

---

## 28. Kesalahan yang Harus Dihindari

Hindari:

- tabel tanpa primary key eksplisit
- `CHAR(36)` UUID random sebagai primary key default tanpa analisis
- menaruh semua payload JSON/TEXT di tabel hot path
- memakai `SELECT *` untuk list screen
- menambah index untuk setiap kolom filter tanpa memahami workload
- mengabaikan ukuran primary key saat membuat banyak secondary index
- delete massal tanpa retention strategy
- menganggap file `.ibd` pasti mengecil setelah delete
- menganggap ORM entity sama dengan desain storage yang baik
- mengabaikan physical locality saat desain ID

---

## 29. Hubungan dengan Part Berikutnya

Bagian ini membangun fondasi fisik. Bagian berikutnya akan fokus pada salah satu keputusan paling penting dalam InnoDB:

> **Primary Key Design in MySQL: The Hidden Architecture Decision**

Di Part 003 kita akan membahas lebih dalam:

- `AUTO_INCREMENT`
- UUID v4
- ordered UUID
- ULID
- Snowflake-style ID
- composite primary key
- natural key vs surrogate key
- multi-tenant primary key
- primary key untuk event table
- primary key untuk regulatory workflow
- Java/JPA implications

---

## 30. Status Seri

Seri belum selesai.

Progress saat ini:

- Part 000 — Orientation: selesai
- Part 001 — MySQL Architecture: selesai
- Part 002 — InnoDB Storage Model: selesai
- Part 003 — Primary Key Design in MySQL: berikutnya

Total rencana seri: 35 bagian, `part-000` sampai `part-034`.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — MySQL Architecture: From Client Connection to Storage Engine</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-003.md">Part 003 — Primary Key Design in MySQL: The Hidden Architecture Decision ➡️</a>
</div>
