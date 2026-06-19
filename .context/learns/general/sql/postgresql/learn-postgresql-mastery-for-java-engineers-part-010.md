# learn-postgresql-mastery-for-java-engineers-part-010.md

# Part 010 — EXPLAIN Mastery: Membaca Plan seperti Engineer Produksi

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `010 / 034`  
> Fokus: `EXPLAIN`, `EXPLAIN ANALYZE`, plan node, estimasi vs aktual, buffers, loops, join strategy, sort spill, parallelism, dan diagnosis query lambat secara sistematis.

---

## 0. Posisi Part Ini dalam Seri

Sampai titik ini kita sudah membangun fondasi:

1. PostgreSQL bukan sekadar SQL database, tetapi engine stateful dengan storage, WAL, MVCC, planner, executor, vacuum, dan background workers.
2. Connection dan pooling di aplikasi Java bukan detail infrastruktur kecil, tetapi bagian dari model kapasitas database.
3. Data PostgreSQL disimpan sebagai tuple version dalam heap pages, bukan sebagai object mutabel yang di-overwrite.
4. MVCC membuat read/write concurrency menjadi efisien, tetapi menghasilkan dead tuple dan konsekuensi vacuum.
5. Isolation level di PostgreSQL punya perilaku nyata yang harus dipahami saat mendesain transaksi Java.
6. WAL dan checkpoint menjelaskan durability, recovery, write amplification, dan commit uncertainty.
7. Memory PostgreSQL tersebar di shared buffers, OS cache, per-operation memory, dan per-connection memory.
8. Query masuk melalui pipeline parse, analyze, rewrite, plan, execute.
9. Planner mengambil keputusan berdasarkan statistik yang tidak sempurna.

Part ini masuk ke kemampuan inti yang membedakan engineer biasa dan engineer produksi: **membaca execution plan dan mengubahnya menjadi diagnosis yang benar**.

Banyak engineer bisa menjalankan:

```sql
EXPLAIN ANALYZE SELECT ...;
```

Tetapi tidak banyak yang bisa menjawab:

- Apakah query ini lambat karena CPU, I/O, memory spill, lock, atau estimasi planner yang salah?
- Apakah index benar-benar dipakai dengan efektif atau hanya muncul di plan tapi tetap mahal?
- Apakah nested loop ini bagus atau menjadi ledakan karena inner scan dieksekusi ribuan kali?
- Apakah sequential scan ini salah, atau justru pilihan optimal?
- Apakah masalahnya ada di query shape, statistik, index, parameter binding, data skew, atau ORM-generated SQL?
- Apakah hasil `EXPLAIN ANALYZE` aman di production?

Tujuan part ini adalah membuat kamu mampu membaca plan seperti membaca **postmortem mini** dari eksekusi query.

---

## 1. Mental Model: EXPLAIN adalah Observability untuk Query Plan

`EXPLAIN` bukan alat untuk “melihat apakah index dipakai”. Itu terlalu sempit.

`EXPLAIN` adalah alat untuk melihat:

1. **Plan shape** — strategi apa yang dipilih PostgreSQL.
2. **Access path** — data diambil melalui sequential scan, index scan, bitmap scan, function scan, CTE scan, dan sebagainya.
3. **Join order** — tabel mana yang dibaca lebih dulu.
4. **Join algorithm** — nested loop, hash join, merge join.
5. **Row estimation** — berapa baris yang diperkirakan planner.
6. **Actual rows** — berapa baris yang benar-benar terjadi saat `ANALYZE`.
7. **Execution time** — berapa waktu aktual yang dipakai tiap node.
8. **Loop count** — berapa kali node dieksekusi.
9. **Buffer usage** — seberapa banyak akses page dari cache/disk.
10. **Sort/hash memory** — apakah operasi muat di memory atau spill ke disk.
11. **Parallelism** — apakah planner memakai worker parallel.
12. **Planning vs execution cost** — apakah bottleneck di compile/plan atau runtime.

Plan adalah representasi dari keputusan planner terhadap query tertentu dalam kondisi tertentu.

Kondisi itu meliputi:

- SQL text.
- Parameter query.
- Statistik tabel/index.
- Konfigurasi planner.
- Estimasi cache.
- Ukuran tabel.
- Distribusi data.
- Available index.
- Constraint.
- Partition metadata.
- Prepared statement mode.
- PostgreSQL version.

Karena itu, query yang sama bisa punya plan berbeda ketika:

- data tumbuh,
- statistik berubah,
- parameter berubah,
- index ditambah/dihapus,
- `ANALYZE` belum berjalan,
- prepared statement beralih dari custom plan ke generic plan,
- versi PostgreSQL berubah,
- config planner berubah,
- table menjadi bloat,
- correlation berubah,
- partition bertambah.

---

## 2. EXPLAIN vs EXPLAIN ANALYZE

Ada dua mode besar.

### 2.1 `EXPLAIN`

```sql
EXPLAIN
SELECT *
FROM cases
WHERE status = 'OPEN';
```

`EXPLAIN` hanya menampilkan plan yang akan dipakai, tanpa menjalankan query.

Artinya:

- aman untuk `SELECT`, `UPDATE`, `DELETE`, `INSERT`, karena tidak benar-benar dieksekusi;
- tidak ada actual runtime;
- tidak ada actual rows;
- hanya estimasi planner;
- berguna untuk melihat rencana awal.

Contoh output konseptual:

```text
Seq Scan on cases  (cost=0.00..1840.00 rows=50000 width=128)
  Filter: (status = 'OPEN'::text)
```

Maknanya:

- PostgreSQL berencana membaca tabel `cases` secara sequential scan.
- Estimasi cost dari 0.00 sampai 1840.00.
- Estimasi output 50.000 baris.
- Estimasi rata-rata row width 128 byte.

### 2.2 `EXPLAIN ANALYZE`

```sql
EXPLAIN ANALYZE
SELECT *
FROM cases
WHERE status = 'OPEN';
```

`EXPLAIN ANALYZE` benar-benar menjalankan query dan mengukur hasil aktual.

Output konseptual:

```text
Seq Scan on cases  (cost=0.00..1840.00 rows=50000 width=128)
                   (actual time=0.021..34.500 rows=48231 loops=1)
  Filter: (status = 'OPEN'::text)
  Rows Removed by Filter: 51769
Planning Time: 0.330 ms
Execution Time: 36.200 ms
```

Sekarang kita dapat:

- actual time,
- actual rows,
- loops,
- rows removed by filter,
- planning time,
- execution time.

Hal penting: `EXPLAIN ANALYZE` mengeksekusi statement. Untuk `UPDATE`, `DELETE`, dan `INSERT`, perubahan benar-benar terjadi kecuali dibungkus transaksi lalu rollback.

Untuk menganalisis statement mutasi secara aman:

```sql
BEGIN;
EXPLAIN ANALYZE
UPDATE cases
SET status = 'CLOSED'
WHERE id = 123;
ROLLBACK;
```

Tetapi bahkan dengan rollback, efek samping tertentu tetap perlu dipahami:

- lock tetap terjadi selama transaksi berjalan,
- trigger bisa dieksekusi,
- sequence increment tidak rollback,
- function volatile bisa terpanggil,
- temporary work bisa memakai resource,
- query berat tetap membebani production.

Jadi `EXPLAIN ANALYZE` di production harus dipakai dengan disiplin.

---

## 3. Format EXPLAIN yang Direkomendasikan

Untuk analisis serius, gunakan:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT ...;
```

Untuk query yang mungkin menulis WAL, tambahkan:

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, SETTINGS)
INSERT ...;
```

Untuk format yang mudah diproses tools:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT ...;
```

### 3.1 Opsi penting

| Opsi | Fungsi |
|---|---|
| `ANALYZE` | Menjalankan query dan menampilkan runtime aktual |
| `BUFFERS` | Menampilkan page/buffer hit/read/dirtied/written |
| `VERBOSE` | Menampilkan detail output column, schema, dan informasi tambahan |
| `SETTINGS` | Menampilkan planner-related settings yang berbeda dari default |
| `WAL` | Menampilkan informasi WAL untuk statement yang menghasilkan WAL |
| `FORMAT JSON` | Output terstruktur untuk tooling |
| `COSTS OFF` | Menyembunyikan cost agar output lebih ringkas |
| `TIMING OFF` | Mengurangi overhead timing per node pada query sangat cepat/berulang |
| `SUMMARY` | Menampilkan ringkasan planning/execution |

Catatan PostgreSQL 18: `EXPLAIN ANALYZE` otomatis menyertakan informasi `BUFFERS` secara default. Tetap baik untuk menulis `BUFFERS` eksplisit agar niat analisis jelas dan agar kebiasaan tetap kompatibel ketika membaca plan lintas versi.

---

## 4. Struktur Plan: Tree, Node, Parent, Child

Execution plan adalah tree.

Contoh:

```text
Hash Join
  Hash Cond: (c.customer_id = cu.id)
  -> Seq Scan on cases c
       Filter: (status = 'OPEN')
  -> Hash
       -> Seq Scan on customers cu
```

Baca dari bawah ke atas:

1. PostgreSQL scan `cases`.
2. PostgreSQL scan `customers`.
3. Hasil `customers` dimasukkan ke hash table.
4. Hash join mencocokkan `cases.customer_id` dengan `customers.id`.

Node parent mengonsumsi output dari node child.

Kesalahan umum: membaca plan dari atas ke bawah seperti urutan eksekusi linear. Itu bisa menyesatkan. Plan adalah pipeline tree; banyak node parent baru dapat bekerja setelah child menghasilkan tuple tertentu, tetapi secara konseptual kamu perlu memahami input/output tiap node.

---

## 5. Komponen Utama Setiap Node

Contoh node:

```text
Index Scan using idx_cases_status on cases
  (cost=0.43..1520.88 rows=1200 width=96)
  (actual time=0.055..8.220 rows=1134 loops=1)
  Index Cond: (status = 'OPEN'::text)
```

### 5.1 `cost=startup..total`

```text
cost=0.43..1520.88
```

Cost bukan millisecond.

Cost adalah unit relatif internal planner.

- Startup cost: biaya sebelum node menghasilkan row pertama.
- Total cost: biaya sampai node selesai menghasilkan semua row.

Contoh:

- Sort biasanya punya startup cost tinggi karena harus membaca input dan menyortir sebelum row pertama keluar.
- Index scan untuk point lookup biasanya startup cost rendah.
- Hash join punya startup cost dari membangun hash table.

Jangan membandingkan cost langsung dengan waktu aktual.

Yang penting:

- cost membantu planner memilih alternatif;
- actual time membantu kita mendiagnosis real execution;
- mismatch cost vs reality biasanya akibat estimasi row/statistik salah, cost parameter tidak sesuai hardware, atau query shape tidak cocok.

### 5.2 `rows`

```text
rows=1200
```

Ini estimasi jumlah row output dari node.

Ini salah satu angka paling penting.

Planner memilih join order, join algorithm, scan method, dan memory strategy berdasarkan estimasi row. Jika estimasi row salah 100x, plan bisa sangat buruk.

### 5.3 `width`

```text
width=96
```

Estimasi rata-rata ukuran row output dalam byte.

Width berpengaruh pada:

- cost I/O,
- sort memory,
- hash memory,
- network transfer,
- temp file spill,
- materialization.

Query `SELECT *` cenderung memperbesar width.

Untuk aplikasi Java, ini berarti DTO projection bisa memengaruhi plan dan memory, bukan hanya network payload.

### 5.4 `actual time=start..end`

```text
actual time=0.055..8.220
```

- Waktu sampai row pertama keluar.
- Waktu sampai node selesai.

Perhatikan bahwa actual time node biasanya termasuk waktu child node.

Jangan menjumlahkan semua actual time node begitu saja. Itu akan double count.

### 5.5 `actual rows`

```text
actual rows=1134
```

Jumlah row aktual yang dihasilkan per loop.

Kalau `loops=1`, total row = 1134.

Kalau `loops=1000`, total row kira-kira `actual rows * loops`.

### 5.6 `loops`

```text
loops=1
```

Berapa kali node dieksekusi.

`loops` sangat penting terutama untuk nested loop.

Contoh buruk:

```text
Nested Loop
  -> Seq Scan on cases c  (actual rows=50000 loops=1)
  -> Index Scan on comments cm (actual rows=20 loops=50000)
```

Inner index scan terlihat cepat per loop, tetapi dieksekusi 50.000 kali.

Total inner output kira-kira:

```text
20 * 50000 = 1.000.000 row
```

Jika setiap loop melakukan random I/O, query bisa lambat walaupun tiap node tampak kecil.

---

## 6. Cara Membaca EXPLAIN: Urutan Praktis

Saat menerima plan, jangan langsung bertanya “index dipakai atau tidak?”. Gunakan urutan ini.

### 6.1 Langkah 1 — Pahami query intent

Tanyakan:

- Query ini seharusnya mengambil berapa row?
- Query ini OLTP point lookup, list page, report, export, atau batch job?
- Latency budget-nya berapa?
- Query ini dipanggil berapa kali per detik?
- Query ini dari endpoint user-facing atau background worker?
- Query ini memakai parameter apa?
- Query ini generated by ORM atau handwritten SQL?

Query 300 ms bisa buruk untuk endpoint hot path, tetapi wajar untuk admin report jarang dipakai.

### 6.2 Langkah 2 — Lihat top-level execution time

Cari:

```text
Planning Time: ... ms
Execution Time: ... ms
```

Jika planning time besar:

- query terlalu kompleks,
- join terlalu banyak,
- partition terlalu banyak,
- prepared statement tidak membantu,
- dynamic SQL terlalu banyak variasi,
- GEQO mungkin aktif untuk join besar.

Jika execution time besar:

- fokus ke node runtime.

### 6.3 Langkah 3 — Cari node paling mahal secara aktual

Lihat node dengan:

- actual time besar,
- loops besar,
- rows besar,
- buffers read besar,
- temp read/write besar,
- rows removed by filter besar.

Tapi ingat: node parent mencakup child. Jadi cari node yang menjelaskan bottleneck, bukan hanya angka terbesar paling atas.

### 6.4 Langkah 4 — Bandingkan estimated rows vs actual rows

Ini kunci.

Contoh sehat:

```text
rows=1000 actual rows=1100
```

Contoh mencurigakan:

```text
rows=10 actual rows=500000
```

Jika estimasi jauh lebih kecil dari aktual:

- planner mungkin memilih nested loop yang buruk,
- memory hash/sort mungkin terlalu kecil,
- join order bisa salah,
- index scan bisa dipilih padahal sequential scan lebih baik.

Jika estimasi jauh lebih besar dari aktual:

- planner mungkin memilih sequential scan/hash join padahal index lookup lebih baik,
- join order bisa terlalu konservatif,
- sort/hash cost bisa dilebih-lebihkan.

### 6.5 Langkah 5 — Periksa access path

Apakah PostgreSQL menggunakan:

- Seq Scan,
- Index Scan,
- Index Only Scan,
- Bitmap Index Scan + Bitmap Heap Scan,
- Parallel Seq Scan,
- Function Scan,
- CTE Scan,
- Subquery Scan?

Access path harus cocok dengan access pattern.

Point lookup biasanya cocok dengan index.

Membaca 40% tabel sering lebih cocok dengan sequential scan.

Range scan pada data terurut bisa cocok dengan B-tree atau BRIN tergantung distribusi.

### 6.6 Langkah 6 — Periksa join strategy

Apakah join memakai:

- Nested Loop,
- Hash Join,
- Merge Join?

Nested loop bagus jika outer kecil dan inner lookup murah.

Hash join bagus untuk join besar dengan equality condition.

Merge join bagus jika input sudah sorted atau sorting lebih murah daripada hashing.

### 6.7 Langkah 7 — Periksa memory spill

Cari:

```text
Sort Method: external merge  Disk: ...
```

atau:

```text
Hash Batches: 8
```

Spill berarti operasi tidak muat di memory dan memakai temporary file.

Solusi bukan selalu menaikkan `work_mem` global. Bisa jadi:

- query perlu index agar tidak sort,
- projection terlalu lebar,
- filter terlalu terlambat,
- join order buruk,
- agregasi perlu pre-aggregation,
- workload perlu reporting replica,
- hanya session tertentu perlu `SET LOCAL work_mem`.

### 6.8 Langkah 8 — Periksa buffer usage

Dengan `BUFFERS`, cari:

- `shared hit`: page ditemukan di shared buffers.
- `shared read`: page dibaca dari storage/OS path ke PostgreSQL buffer.
- `shared dirtied`: page dimodifikasi.
- `shared written`: page ditulis keluar.
- `temp read/write`: temporary file I/O.
- `local hit/read`: temporary/local relation buffers.

`shared hit` tinggi tidak selalu buruk; itu bisa berarti data cache-resident. Tetapi jika hit tinggi di nested loop dengan loops besar, itu tetap bisa menunjukkan kerja CPU/buffer churn besar.

`shared read` tinggi sering menunjukkan I/O nyata atau cache miss.

`temp read/write` tinggi sering menunjukkan sort/hash spill.

### 6.9 Langkah 9 — Hubungkan ke aplikasi

Tanyakan:

- Query ini dieksekusi satu kali atau N+1 oleh ORM?
- Apakah parameter query representatif?
- Apakah query memakai prepared statement generic plan?
- Apakah fetch size membuat result besar ditarik sekaligus?
- Apakah transaction menahan snapshot lama?
- Apakah endpoint memanggil query ini dalam loop?
- Apakah connection pool membuat query lambat menumpuk?

EXPLAIN hanya melihat satu query. Incident produksi sering muncul karena query itu dipanggil ribuan kali.

---

## 7. Access Path Nodes

## 7.1 Sequential Scan

Contoh:

```text
Seq Scan on cases
  (cost=0.00..1840.00 rows=50000 width=128)
  (actual time=0.020..35.000 rows=48231 loops=1)
  Filter: (status = 'OPEN'::text)
  Rows Removed by Filter: 51769
```

Sequential scan membaca heap table secara berurutan.

Sequential scan bukan otomatis buruk.

Sequential scan wajar jika:

- tabel kecil,
- query membaca sebagian besar tabel,
- predicate tidak selektif,
- index tidak tersedia,
- index tersedia tetapi random access lebih mahal,
- table cache-resident dan scan lebih murah,
- query agregasi/report membaca banyak data.

Sequential scan mencurigakan jika:

- query seharusnya point lookup,
- result sangat kecil,
- tabel sangat besar,
- predicate selektif,
- filter menghapus hampir semua row,
- query hot path user-facing.

Contoh red flag:

```text
Seq Scan on cases
  (actual rows=1 loops=1)
  Rows Removed by Filter: 9999999
```

Ini biasanya berarti:

- index tidak ada,
- predicate tidak sesuai index,
- type mismatch membuat index tidak dipakai,
- expression tidak ter-index,
- collation/operator class tidak cocok,
- statistik salah,
- generic plan memilih scan aman.

## 7.2 Index Scan

```text
Index Scan using idx_cases_status on cases
  Index Cond: (status = 'OPEN'::text)
```

Index scan mencari entry di index lalu mengambil row dari heap.

Index scan bagus untuk:

- predicate selektif,
- range kecil,
- ordered access,
- pagination dengan keyset,
- foreign key lookup,
- unique lookup.

Tetapi index scan bisa buruk jika:

- menghasilkan banyak row,
- heap access random dan besar,
- table/index bloat,
- correlation buruk,
- query mengambil kolom lebar,
- predicate selektivitas rendah.

Jangan puas hanya karena “index dipakai”. Pertanyaan yang benar:

- Index dipakai untuk membatasi data atau hanya untuk order?
- Berapa row yang keluar dari index?
- Berapa heap page yang harus dibaca?
- Apakah banyak row difilter setelah index scan?
- Apakah index condition berbeda dari filter condition?

## 7.3 Index Only Scan

```text
Index Only Scan using idx_cases_status_created_id on cases
  Index Cond: (status = 'OPEN'::text)
  Heap Fetches: 0
```

Index only scan berarti data yang dibutuhkan tersedia di index.

Namun PostgreSQL tetap perlu memastikan visibility. Jika visibility map belum menandai page sebagai all-visible, PostgreSQL harus melakukan heap fetch.

Red flag:

```text
Index Only Scan ...
  Heap Fetches: 500000
```

Itu berarti secara nama “index only”, tetapi secara praktik masih banyak ke heap.

Penyebab:

- table sering di-update,
- vacuum belum menandai page all-visible,
- long-running transaction menahan visibility,
- workload write-heavy.

## 7.4 Bitmap Index Scan + Bitmap Heap Scan

```text
Bitmap Heap Scan on cases
  Recheck Cond: (status = 'OPEN'::text)
  -> Bitmap Index Scan on idx_cases_status
       Index Cond: (status = 'OPEN'::text)
```

Bitmap scan sering muncul saat result cukup banyak sehingga index scan biasa terlalu random, tetapi sequential scan penuh terlalu mahal.

Cara kerjanya:

1. Index dibaca untuk membangun bitmap lokasi heap page.
2. Heap page dibaca lebih teratur.
3. Kondisi dicek ulang jika perlu.

Bitmap scan cocok untuk:

- predicate sedang selektif,
- kombinasi beberapa index via bitmap AND/OR,
- membaca banyak row dari banyak page.

Perhatikan:

```text
Heap Blocks: exact=... lossy=...
```

Lossy bitmap berarti bitmap menjadi kasar karena memory terbatas, sehingga PostgreSQL harus recheck lebih banyak row.

## 7.5 Parallel Seq Scan

```text
Gather
  Workers Planned: 2
  Workers Launched: 2
  -> Parallel Seq Scan on audit_events
```

Parallel scan bisa membantu query yang membaca banyak data.

Tetapi parallelism bukan gratis:

- ada overhead worker startup,
- ada overhead gather,
- worker terbatas global,
- query pendek bisa lebih lambat,
- parallel query bisa menaikkan memory consumption,
- concurrent workload bisa saling berebut worker.

Parallel scan cocok untuk reporting, analytics ringan, agregasi besar, atau scan besar yang tidak latency-super-sensitive.

Untuk OLTP hot path, munculnya parallel query bisa menjadi tanda query terlalu berat untuk request path.

---

## 8. Join Nodes

## 8.1 Nested Loop

```text
Nested Loop
  -> Index Scan using idx_cases_status on cases c
  -> Index Scan using idx_comments_case_id on comments cm
       Index Cond: (case_id = c.id)
```

Nested loop menjalankan inner node untuk setiap row outer.

Pseudo-code:

```text
for each row in outer:
    find matching rows in inner
```

Bagus jika:

- outer kecil,
- inner lookup memakai index selektif,
- result kecil,
- query OLTP point/range kecil.

Buruk jika:

- outer besar,
- inner scan mahal,
- estimasi outer terlalu kecil,
- inner node loops ribuan/jutaan kali,
- random I/O besar.

Red flag:

```text
Nested Loop
  -> Seq Scan on cases c (actual rows=500000 loops=1)
  -> Index Scan on comments cm (actual rows=3 loops=500000)
```

Inner scan mungkin tampak cepat per loop, tetapi total operasi besar.

Diagnosis:

- Estimasi outer salah?
- Filter terlalu terlambat?
- Join order salah?
- Perlu hash join?
- Perlu index composite?
- Perlu pre-aggregate?
- Query ORM menghasilkan join yang tidak perlu?

## 8.2 Hash Join

```text
Hash Join
  Hash Cond: (c.customer_id = cu.id)
  -> Seq Scan on cases c
  -> Hash
       -> Seq Scan on customers cu
```

Hash join membangun hash table dari salah satu input, lalu probe dengan input lain.

Bagus jika:

- join condition equality,
- input cukup besar,
- hash table muat di memory,
- tidak butuh output sorted.

Buruk jika:

- hash table spill ke disk,
- estimasi row terlalu kecil,
- `work_mem` tidak cukup,
- input terlalu lebar,
- join condition tidak selektif.

Perhatikan:

```text
Buckets: ...  Batches: ...  Memory Usage: ...
```

Jika `Batches > 1`, hash join spill/batching terjadi.

Solusi bisa:

- kurangi width dengan projection,
- filter lebih awal,
- tambah statistik,
- tambah index agar join order berubah,
- `SET LOCAL work_mem` untuk job tertentu,
- ubah query shape,
- pre-aggregate.

## 8.3 Merge Join

```text
Merge Join
  Merge Cond: (c.customer_id = cu.id)
  -> Index Scan using idx_cases_customer_id on cases c
  -> Index Scan using customers_pkey on customers cu
```

Merge join butuh kedua input sorted berdasarkan join key.

Bagus jika:

- input sudah sorted dari index,
- join besar,
- output perlu sorted,
- equality/range-like ordering menguntungkan.

Buruk jika:

- perlu sort besar sebelum join,
- sort spill ke disk,
- input besar dan tidak ada index mendukung.

---

## 9. Sort, Aggregate, Grouping, dan Distinct

## 9.1 Sort

```text
Sort
  Sort Key: created_at DESC
  Sort Method: quicksort  Memory: 2048kB
```

Sort in-memory sehat jika data kecil/sedang.

Red flag:

```text
Sort Method: external merge  Disk: 102400kB
```

Artinya sort spill ke disk.

Penyebab:

- input terlalu besar,
- `work_mem` tidak cukup,
- row width terlalu besar,
- sort tidak bisa dihindari oleh index,
- `ORDER BY` tidak cocok dengan index,
- query memakai `SELECT *`,
- pagination offset besar.

Perbaikan:

- index sesuai `WHERE + ORDER BY`,
- keyset pagination,
- projection kolom lebih sempit,
- filter lebih awal,
- materialized read model,
- `SET LOCAL work_mem` untuk job tertentu.

## 9.2 Limit + Sort: Top-N

Query:

```sql
SELECT id, status, created_at
FROM cases
WHERE status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Plan buruk:

```text
Seq Scan on cases
  Filter: status = 'OPEN'
Sort
  Sort Key: created_at DESC
Limit
```

Ini membaca semua OPEN cases lalu sort semua, padahal hanya perlu 50.

Index lebih cocok:

```sql
CREATE INDEX idx_cases_status_created_desc
ON cases (status, created_at DESC, id);
```

Plan lebih baik:

```text
Limit
  -> Index Scan using idx_cases_status_created_desc on cases
       Index Cond: (status = 'OPEN')
```

Mental model:

> Untuk query list page, index yang benar bukan hanya mendukung filter. Index harus mendukung filter dan order secara bersamaan.

## 9.3 HashAggregate vs GroupAggregate

Hash aggregate:

```text
HashAggregate
  Group Key: tenant_id
```

Group aggregate:

```text
GroupAggregate
  Group Key: tenant_id
  -> Sort
```

HashAggregate membangun hash table group.

Bagus jika group muat memory.

GroupAggregate butuh input sorted.

Bagus jika input sudah sorted dari index atau sort murah.

Red flag:

```text
HashAggregate
  Batches: 16
  Disk Usage: ...
```

Atau:

```text
Sort Method: external merge Disk: ...
```

Solusi bisa berupa:

- index pada group key,
- pre-aggregation,
- materialized summary,
- partition-wise aggregate,
- batasi time window,
- reporting pipeline.

---

## 10. Filter, Index Cond, Recheck Cond, Join Filter

Di plan, kondisi bisa muncul sebagai beberapa jenis.

## 10.1 `Index Cond`

```text
Index Cond: (status = 'OPEN'::text)
```

Kondisi ini dipakai untuk membatasi pencarian di index.

Ini bagus.

## 10.2 `Filter`

```text
Filter: (lower(email) = 'a@example.com'::text)
```

Filter diterapkan setelah row didapat dari access path.

Filter tidak selalu buruk, tetapi bisa buruk jika banyak row dibaca lalu dibuang.

Red flag:

```text
Rows Removed by Filter: 999999
actual rows=1
```

Solusi mungkin expression index:

```sql
CREATE INDEX idx_users_lower_email
ON users (lower(email));
```

Atau gunakan tipe/kolom yang lebih tepat, misalnya `citext` atau normalized email column, tergantung kebijakan sistem.

## 10.3 `Recheck Cond`

```text
Recheck Cond: (status = 'OPEN'::text)
```

Biasanya muncul pada bitmap heap scan atau index tertentu seperti GIN/GiST. PostgreSQL perlu mengecek ulang kondisi pada heap row.

Tidak otomatis buruk.

## 10.4 `Join Filter`

```text
Join Filter: (c.created_at >= cu.active_since)
Rows Removed by Join Filter: 1000000
```

Join filter diterapkan setelah kombinasi join candidate terbentuk.

Jika banyak row removed by join filter, mungkin join condition utama kurang selektif atau query shape buruk.

---

## 11. Buffers: Membaca Jejak I/O

Contoh:

```text
Buffers: shared hit=10240 read=512 dirtied=3 written=0
```

### 11.1 `shared hit`

Page ditemukan di PostgreSQL shared buffers.

Tidak perlu read dari storage ke shared buffers.

Tetapi tetap ada CPU work untuk memproses page.

`shared hit` tinggi pada query hot bisa baik.

`shared hit` tinggi pada nested loop besar bisa menunjukkan buffer churn/CPU heavy.

### 11.2 `shared read`

Page dibaca ke shared buffers.

Ini lebih dekat ke indikasi I/O miss.

Namun PostgreSQL bisa membaca dari OS cache, jadi `shared read` tidak selalu berarti physical disk read langsung. Tetap, dari perspektif PostgreSQL, page belum ada di shared buffers.

### 11.3 `shared dirtied`

Page dimodifikasi di shared buffers.

Biasanya muncul pada write query.

### 11.4 `shared written`

Page ditulis oleh backend selama query.

Jika query user-facing banyak melakukan backend writes, bisa ada pressure checkpoint/bgwriter.

### 11.5 `temp read/write`

Temporary file I/O.

Sering muncul karena:

- sort spill,
- hash spill,
- materialize spill,
- large aggregate,
- large distinct,
- hash join batching.

Temp I/O sering menjadi red flag pada endpoint OLTP.

---

## 12. Planning Time vs Execution Time

Contoh:

```text
Planning Time: 18.500 ms
Execution Time: 2.100 ms
```

Planning lebih mahal daripada eksekusi.

Ini bisa terjadi jika:

- query sangat kompleks,
- join banyak,
- partition banyak,
- dynamic SQL banyak variasi,
- ORM menghasilkan query besar,
- planner mempertimbangkan banyak alternatif,
- statistics lookup kompleks.

Di Java, ini relevan untuk:

- prepared statement reuse,
- query cache di ORM,
- menghindari dynamic SQL shape yang tidak perlu,
- menghindari query builder menghasilkan variasi tidak terbatas.

Contoh lain:

```text
Planning Time: 0.600 ms
Execution Time: 850.000 ms
```

Fokusnya runtime.

---

## 13. Estimated Rows vs Actual Rows: Sumber Kebanyakan Plan Buruk

Misestimate adalah akar banyak masalah.

Contoh:

```text
Index Scan using idx_cases_status on cases
  (cost=0.43..8.45 rows=5 width=96)
  (actual time=0.050..500.000 rows=250000 loops=1)
```

Planner mengira 5 row, aktual 250.000 row.

Akibat:

- planner memilih index scan,
- heap access menjadi besar,
- nested loop bisa dipilih,
- memory allocation tidak sesuai,
- join order salah.

Penyebab umum:

1. Statistik stale.
2. Data skew.
3. Correlated predicates.
4. Parameter generic plan.
5. Expression predicate tanpa expression stats/index.
6. JSONB predicate sulit diestimasi.
7. Partial index predicate tidak cocok.
8. Multi-tenant hot tenant.
9. Partition statistics tidak representatif.

Contoh correlated predicates:

```sql
WHERE country = 'ID'
  AND province = 'DKI_JAKARTA'
```

Planner bisa menganggap predicate independent, padahal province sangat bergantung pada country.

Solusi: extended statistics.

```sql
CREATE STATISTICS st_cases_country_province (dependencies, mcv)
ON country, province
FROM cases;

ANALYZE cases;
```

---

## 14. Sequential Scan vs Index Scan: Jangan Dogmatis

Premis lemah yang sering muncul:

> “Query lambat karena tidak pakai index.”

Kadang benar, sering tidak lengkap.

Sequential scan bisa lebih cepat jika query membaca banyak data.

Index scan membutuhkan:

1. Baca index page.
2. Ambil TID heap.
3. Baca heap page.
4. Cek visibility.
5. Ambil row.

Jika hasilnya banyak dan heap access random, index scan bisa lebih mahal daripada sequential scan.

Contoh:

```sql
SELECT *
FROM cases
WHERE status IN ('OPEN', 'IN_PROGRESS');
```

Jika 80% row memiliki status itu, sequential scan wajar.

Pertanyaan yang benar:

- Seberapa selektif predicate?
- Berapa persen tabel dibaca?
- Apakah query butuh ordering?
- Apakah row width besar?
- Apakah table cache-resident?
- Apakah heap correlation mendukung index scan?
- Apakah index bisa menjadi covering index?

---

## 15. `Rows Removed by Filter`: Sinyal Penting

Contoh:

```text
Seq Scan on users
  Filter: (lower(email) = 'john@example.com'::text)
  Rows Removed by Filter: 999999
  actual rows=1
```

Ini berarti PostgreSQL membaca 1.000.000 row dan membuang hampir semuanya.

Kemungkinan solusi:

```sql
CREATE INDEX idx_users_lower_email
ON users (lower(email));
```

Atau simpan normalized value:

```sql
ALTER TABLE users ADD COLUMN email_normalized text;
CREATE UNIQUE INDEX ux_users_email_normalized ON users(email_normalized);
```

Untuk sistem yang butuh invariant kuat, normalized generated column + unique constraint bisa lebih defensible daripada hanya expression index, tergantung kebutuhan domain.

Contoh lain:

```text
Index Scan using idx_cases_tenant_id on cases
  Index Cond: (tenant_id = 42)
  Filter: (status = 'OPEN')
  Rows Removed by Filter: 500000
```

Index hanya membantu tenant, tapi status difilter setelahnya.

Mungkin perlu composite index:

```sql
CREATE INDEX idx_cases_tenant_status_created
ON cases (tenant_id, status, created_at DESC);
```

Tetapi desain index harus mengikuti query workload, bukan satu query saja.

---

## 16. Nested Loop Explosion

Salah satu pola terpenting.

Plan:

```text
Nested Loop
  (actual time=0.100..8500.000 rows=1000000 loops=1)
  -> Seq Scan on cases c
       (actual rows=500000 loops=1)
       Filter: (status = 'OPEN')
  -> Index Scan using idx_comments_case_id on comments cm
       (actual rows=2 loops=500000)
       Index Cond: (case_id = c.id)
```

Masalahnya bukan bahwa inner index scan ada.

Masalahnya inner index scan dieksekusi 500.000 kali.

Total lookup sangat besar.

Kemungkinan penyebab:

- planner mengira outer hanya 100 row,
- statistik `status` stale,
- status `OPEN` ternyata sangat banyak,
- query mengambil data terlalu luas,
- endpoint melakukan list besar,
- seharusnya pakai batch/reporting path,
- hash join mungkin lebih cocok.

Perbaikan potensial:

1. `ANALYZE cases;`
2. Index composite yang lebih selektif.
3. Tambahkan filter time window.
4. Pre-aggregate comments per case.
5. Batasi result dengan keyset pagination.
6. Hindari join untuk list page; lazy load detail di endpoint detail.
7. Gunakan materialized projection.
8. Cek apakah planner generic plan salah untuk parameter tertentu.

---

## 17. Sort Spill dan `work_mem`

Plan:

```text
Sort
  Sort Key: created_at DESC
  Sort Method: external merge  Disk: 204800kB
```

Respons umum yang salah:

> “Naikkan `work_mem` global.”

Itu berbahaya karena `work_mem` berlaku per operation, bukan per database.

Satu query bisa punya beberapa sort/hash node. Satu connection bisa menjalankan query berat. Banyak connection bisa aktif bersamaan. Parallel worker juga bisa mengalikan memory.

Perbaikan yang lebih disiplin:

1. Apakah sort bisa dihindari dengan index?
2. Apakah `ORDER BY` cocok dengan access pattern?
3. Apakah query memakai offset pagination besar?
4. Apakah projection terlalu lebar?
5. Apakah filter bisa dipush lebih awal?
6. Apakah query ini job/report sehingga bisa memakai `SET LOCAL work_mem`?
7. Apakah perlu materialized view?
8. Apakah result terlalu besar untuk request path?

Contoh session-level tuning aman untuk job tertentu:

```sql
BEGIN;
SET LOCAL work_mem = '256MB';
-- query reporting berat
COMMIT;
```

Tetap harus dihitung terhadap concurrency.

---

## 18. Limit, Offset, dan Pagination Plan

Offset pagination:

```sql
SELECT id, created_at
FROM cases
WHERE tenant_id = 42
ORDER BY created_at DESC
OFFSET 100000
LIMIT 50;
```

Masalah: PostgreSQL tetap harus menemukan dan melewati 100.000 row sebelum mengembalikan 50.

Plan mungkin terlihat memakai index:

```text
Limit
  -> Index Scan using idx_cases_tenant_created on cases
       Index Cond: (tenant_id = 42)
```

Tapi runtime tetap naik seiring offset.

Keyset pagination:

```sql
SELECT id, created_at
FROM cases
WHERE tenant_id = 42
  AND (created_at, id) < (:last_created_at, :last_id)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_tenant_created_id_desc
ON cases (tenant_id, created_at DESC, id DESC);
```

Ini membuat page berikutnya melanjutkan dari posisi index, bukan menghitung ulang dari awal.

---

## 19. Prepared Statement, Generic Plan, dan EXPLAIN

Di Java, query sering memakai prepared statement.

Masalah: PostgreSQL bisa memilih custom plan atau generic plan.

Custom plan mempertimbangkan nilai parameter aktual.

Generic plan memakai strategi umum yang diharapkan cukup baik untuk banyak parameter.

Contoh skew:

```sql
SELECT *
FROM cases
WHERE tenant_id = $1
  AND status = $2;
```

Tenant kecil menghasilkan 100 row.

Tenant besar menghasilkan 10.000.000 row.

Plan optimal bisa berbeda:

- tenant kecil: index scan,
- tenant besar: bitmap/seq scan/partition pruning/reporting path.

Jika generic plan dipakai, satu plan kompromi bisa buruk untuk tenant tertentu.

Untuk diagnosis:

```sql
EXPLAIN (ANALYZE, BUFFERS)
EXECUTE prepared_stmt(42, 'OPEN');
```

Atau uji dengan literal untuk melihat potensi custom plan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM cases WHERE tenant_id = 42 AND status = 'OPEN';
```

Pertanyaan yang harus diajukan:

- Apakah parameter representatif?
- Apakah ada tenant/data skew?
- Apakah generic plan dipakai?
- Apakah prepared statement dari JDBC/Hibernate mengubah plan behavior?
- Apakah perlu query shape berbeda untuk hot tenant?

---

## 20. ORM-generated SQL dan EXPLAIN

Hibernate/JPA sering membuat query yang benar secara fungsi tetapi buruk secara plan.

Pola umum:

### 20.1 N+1 tidak terlihat dari satu EXPLAIN

Satu query mungkin cepat:

```text
Execution Time: 1.2 ms
```

Tetapi endpoint menjalankannya 500 kali.

EXPLAIN per query tidak cukup. Butuh tracing/logging query count.

### 20.2 Fetch join menghasilkan row explosion

```sql
SELECT c.*, cm.*, a.*
FROM cases c
LEFT JOIN comments cm ON cm.case_id = c.id
LEFT JOIN attachments a ON a.case_id = c.id
WHERE c.id = ?;
```

Jika case punya 100 comments dan 20 attachments, result bisa menjadi 2.000 kombinasi.

Plan mungkin terlihat wajar, tetapi output row meledak.

### 20.3 `SELECT *` memperbesar width

ORM sering mengambil kolom lebih banyak daripada perlu.

Dampak:

- heap read lebih besar,
- index-only scan sulit,
- sort/hash memory lebih besar,
- network payload lebih besar,
- GC pressure di Java lebih besar.

### 20.4 Implicit cast/type mismatch

Jika parameter Java dikirim dengan tipe yang tidak cocok, index bisa tidak dipakai optimal.

Contoh risiko:

- UUID diperlakukan sebagai text,
- timestamp/timezone mismatch,
- numeric vs bigint,
- enum/string mapping tidak konsisten,
- function wrapping column.

---

## 21. Parallel Query dalam EXPLAIN

Contoh:

```text
Gather
  Workers Planned: 4
  Workers Launched: 4
  -> Parallel Hash Join
       -> Parallel Seq Scan on audit_events
```

Perhatikan:

- `Workers Planned` vs `Workers Launched`.
- Jika planned 4 tetapi launched 0/1, worker mungkin tidak tersedia.
- Parallel query mempercepat query berat tapi mengambil resource global.
- Actual rows pada worker perlu dibaca hati-hati karena dibagi antar worker.

Parallel query baik untuk:

- scan besar,
- aggregate besar,
- reporting,
- data processing.

Kurang cocok untuk:

- transaksi OLTP kecil,
- query sangat sering,
- sistem dengan concurrency tinggi dan worker terbatas.

---

## 22. JIT dalam EXPLAIN

PostgreSQL dapat memakai JIT compilation untuk query tertentu.

Plan bisa memuat:

```text
JIT:
  Functions: 12
  Options: Inlining true, Optimization true, Expressions true, Deforming true
  Timing: Generation 2.100 ms, Inlining 5.200 ms, Optimization 18.000 ms, Emission 4.000 ms, Total 29.300 ms
```

JIT bisa membantu query CPU-heavy besar.

Tetapi untuk query pendek, overhead JIT bisa lebih besar dari manfaat.

Jika query OLTP mengalami latency aneh karena JIT, evaluasi:

- apakah query terlalu kompleks,
- apakah `jit_above_cost` terlalu rendah,
- apakah JIT cocok untuk workload,
- apakah reporting query sebaiknya dipisah.

---

## 23. CTE, Subquery, Materialize

CTE modern PostgreSQL tidak selalu menjadi optimization fence seperti versi lama, tetapi masih perlu dibaca di plan.

Node yang sering muncul:

```text
CTE Scan
Subquery Scan
Materialize
```

`Materialize` berarti PostgreSQL menyimpan hasil intermediate agar bisa dibaca ulang.

Bagus jika:

- input kecil,
- menghindari recomputation,
- nested loop perlu membaca inner berkali-kali.

Buruk jika:

- materialized result besar,
- spill ke disk,
- query shape menyebabkan intermediate besar.

---

## 24. Partitioned Table dalam EXPLAIN

Pada partitioned table, cari apakah pruning terjadi.

Plan baik:

```text
Index Scan on cases_2026_06
```

Plan mencurigakan:

```text
Append
  -> Seq Scan on cases_2024_01
  -> Seq Scan on cases_2024_02
  -> Seq Scan on cases_2024_03
  ...
  -> Seq Scan on cases_2026_06
```

Jika query seharusnya hanya membaca satu bulan tetapi semua partition discan:

- predicate tidak sesuai partition key,
- function wrapping partition key,
- parameter tidak diketahui saat planning,
- type mismatch,
- constraint exclusion/pruning tidak efektif,
- partition design tidak cocok dengan workload.

---

## 25. Case Study 1: Index Ada tapi Query Tetap Lambat

Query:

```sql
SELECT id, title, status, created_at
FROM cases
WHERE tenant_id = 42
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50;
```

Index yang ada:

```sql
CREATE INDEX idx_cases_tenant_id ON cases (tenant_id);
CREATE INDEX idx_cases_status ON cases (status);
CREATE INDEX idx_cases_created_at ON cases (created_at);
```

Plan:

```text
Limit
  -> Sort
       Sort Key: created_at DESC
       Sort Method: top-N heapsort  Memory: 40kB
       -> Bitmap Heap Scan on cases
            Recheck Cond: (tenant_id = 42)
            Filter: (status = 'OPEN')
            Rows Removed by Filter: 300000
            -> Bitmap Index Scan on idx_cases_tenant_id
                 Index Cond: (tenant_id = 42)
```

Diagnosis:

- Index ada, tapi tidak sesuai query shape.
- PostgreSQL memakai tenant index, lalu memfilter status, lalu sort created_at.
- Banyak row tenant dibaca lalu dibuang.
- Untuk list page, index sebaiknya mengikuti equality filter lalu order.

Index lebih tepat:

```sql
CREATE INDEX CONCURRENTLY idx_cases_tenant_status_created_id
ON cases (tenant_id, status, created_at DESC, id DESC)
INCLUDE (title);
```

Tetapi sebelum membuat index:

- pastikan query hot path,
- cek write overhead,
- cek existing index overlap,
- cek cardinality status,
- cek apakah `title` terlalu besar untuk INCLUDE,
- cek pagination strategy,
- cek semua query list cases.

---

## 26. Case Study 2: Planner Salah karena Data Skew Multi-tenant

Query:

```sql
SELECT *
FROM case_events
WHERE tenant_id = $1
  AND event_type = 'STATUS_CHANGED'
  AND created_at >= now() - interval '7 days';
```

Tenant A punya 10.000 event.

Tenant B punya 500 juta event.

Generic plan memilih index scan yang baik untuk tenant kecil tetapi buruk untuk tenant besar.

Symptoms:

- Query cepat untuk sebagian tenant.
- Query timeout untuk tenant besar.
- EXPLAIN dengan literal tenant kecil tampak bagus.
- Production incident hanya terjadi pada tenant tertentu.

Diagnosis:

- Skew tenant.
- Generic plan/parameter sensitivity.
- Statistik global tidak cukup merepresentasikan tenant besar.
- Index mungkin tidak cocok untuk hot tenant.

Solusi potensial:

1. Composite index:

```sql
CREATE INDEX CONCURRENTLY idx_case_events_tenant_type_created
ON case_events (tenant_id, event_type, created_at DESC);
```

2. Partitioning by time atau tenant class jika memang skala menuntut.
3. Query path khusus untuk hot tenant.
4. Avoid generic plan untuk query tertentu.
5. Reporting replica/materialized projection.
6. Extended statistics jika predicate correlated.

---

## 27. Case Study 3: Query Lambat karena Sort Spill

Query:

```sql
SELECT tenant_id, status, count(*)
FROM cases
WHERE created_at >= now() - interval '1 year'
GROUP BY tenant_id, status
ORDER BY tenant_id, status;
```

Plan:

```text
GroupAggregate
  Group Key: tenant_id, status
  -> Sort
       Sort Key: tenant_id, status
       Sort Method: external merge  Disk: 2048000kB
       -> Seq Scan on cases
            Filter: (created_at >= ...)
```

Diagnosis:

- Query reporting membaca data besar.
- Sort spill 2GB.
- Endpoint mungkin tidak cocok untuk request path.

Solusi:

- Tambah time-window lebih kecil.
- Index `(created_at, tenant_id, status)` mungkin membantu filter tetapi tidak selalu menghindari sort.
- Materialized aggregate per day.
- Incremental summary table.
- Jalankan di reporting replica.
- `SET LOCAL work_mem` untuk batch/reporting job.
- Gunakan partition by time agar pruning mengurangi input.

---

## 28. Case Study 4: Index Only Scan Tidak Benar-benar Only

Plan:

```text
Index Only Scan using idx_cases_status_created on cases
  Index Cond: (status = 'OPEN')
  Heap Fetches: 800000
```

Diagnosis:

- Index memuat kolom yang dibutuhkan.
- Tetapi visibility map belum cukup all-visible.
- PostgreSQL masih perlu cek heap.

Penyebab:

- table sering berubah,
- autovacuum tertinggal,
- long-running transaction,
- high update churn,
- fillfactor/HOT behavior buruk.

Solusi:

- cek autovacuum,
- cek long transaction,
- cek bloat,
- cek update pattern,
- jangan mengandalkan index-only scan untuk table write-heavy tanpa validasi.

---

## 29. Red Flags dalam EXPLAIN

Gunakan daftar ini sebagai checklist cepat.

### 29.1 Estimasi buruk

```text
rows=10 actual rows=1000000
```

Kemungkinan:

- stale stats,
- skew,
- correlation,
- generic plan,
- expression/JSONB predicate.

### 29.2 Nested loop dengan inner loops besar

```text
Index Scan ... loops=500000
```

Kemungkinan:

- join order buruk,
- outer terlalu besar,
- missing composite index,
- query shape buruk.

### 29.3 Rows removed by filter sangat besar

```text
Rows Removed by Filter: 9999999
```

Kemungkinan:

- predicate tidak ter-index,
- index tidak cocok,
- function wrapping column,
- composite index order salah.

### 29.4 Sort spill

```text
Sort Method: external merge Disk: ...
```

Kemungkinan:

- ORDER BY tidak didukung index,
- result besar,
- work_mem kecil untuk query itu,
- query reporting di path OLTP.

### 29.5 Hash spill

```text
Batches: 16
```

Kemungkinan:

- hash table tidak muat memory,
- estimasi row salah,
- input terlalu lebar,
- join besar.

### 29.6 Sequential scan dengan output kecil

```text
Seq Scan ... actual rows=1 Rows Removed by Filter=10000000
```

Kemungkinan:

- missing index,
- wrong type/operator,
- expression predicate,
- partial index mismatch.

### 29.7 Planning time tinggi

```text
Planning Time: 300 ms
Execution Time: 20 ms
```

Kemungkinan:

- query kompleks,
- join banyak,
- partition banyak,
- dynamic SQL terlalu banyak,
- ORM query terlalu besar.

### 29.8 Temp read/write tinggi

```text
Buffers: temp read=100000 written=100000
```

Kemungkinan:

- sort/hash/materialize spill,
- work_mem issue,
- intermediate result besar.

---

## 30. Cara Mendiagnosis Query Lambat Secara Sistematis

Jangan mulai dari membuat index.

Gunakan alur ini.

### 30.1 Ambil query aktual

Dapatkan:

- SQL aktual,
- parameter aktual,
- endpoint/job asal,
- frekuensi eksekusi,
- latency p50/p95/p99,
- row count expected,
- result size,
- user/tenant affected.

### 30.2 Ambil plan aktual

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT ...;
```

Jika mutating statement:

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, WAL, VERBOSE, SETTINGS)
UPDATE ...;
ROLLBACK;
```

Hati-hati di production.

### 30.3 Bandingkan estimasi vs aktual

Cari node mismatch besar.

Jika mismatch besar, diagnosis statistik dulu.

### 30.4 Identifikasi bottleneck resource

- CPU-heavy: banyak rows/hit, sedikit read/temp.
- I/O-heavy: shared read tinggi.
- Memory spill: temp read/write, external merge, hash batches.
- Lock-bound: EXPLAIN tidak cukup; cek `pg_stat_activity`, wait events, `pg_locks`.
- Network/object hydration: DB execution cepat tapi endpoint lambat.

### 30.5 Evaluasi query shape

- Apakah filter cukup selektif?
- Apakah order sesuai index?
- Apakah join perlu?
- Apakah projection terlalu lebar?
- Apakah pagination buruk?
- Apakah aggregation cocok di request path?
- Apakah ORM menghasilkan row explosion?

### 30.6 Evaluasi index

- Existing index apa saja?
- Ada overlap index?
- Index cocok dengan predicate/order/join?
- Perlu partial index?
- Perlu expression index?
- Perlu INCLUDE?
- Write overhead dapat diterima?
- Create concurrently diperlukan?

### 30.7 Evaluasi statistik

- Kapan terakhir analyze?
- Apakah stats target cukup?
- Apakah extended stats diperlukan?
- Apakah data skew tenant?
- Apakah partition stats valid?

### 30.8 Verifikasi dengan plan baru

Jangan berhenti di teori.

- Jalankan plan pada dataset representatif.
- Bandingkan buffer/time/rows.
- Uji parameter berbeda.
- Uji tenant kecil dan besar.
- Uji cold-ish dan warm cache jika relevan.
- Uji concurrency jika query hot.

### 30.9 Buat keputusan produksi

- Apakah perubahan query cukup?
- Apakah butuh index baru?
- Apakah butuh migration?
- Apakah butuh read model?
- Apakah perlu cache?
- Apakah workload harus dipindah dari endpoint sinkron ke async job?
- Apakah perlu partitioning?

---

## 31. EXPLAIN dan Lock: Apa yang Tidak Terlihat

EXPLAIN bagus untuk plan dan runtime execution.

Tetapi query lambat tidak selalu karena plan buruk.

Bisa karena:

- menunggu lock,
- menunggu connection pool,
- menunggu network,
- menunggu disk karena sistem lain,
- menunggu replication sync commit,
- menunggu client consume result,
- blocked by long transaction,
- CPU starvation global.

Jika aplikasi melihat query 30 detik tetapi `EXPLAIN ANALYZE` hanya 50 ms, kemungkinan:

1. Query menunggu sebelum execution.
2. Lock wait.
3. Pool wait di Java.
4. Network/result hydration.
5. Different parameter/query.
6. Production data/cache berbeda.
7. Query dalam transaksi lain yang menahan lock.

Gunakan:

```sql
SELECT pid, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE state <> 'idle';
```

Dan cek locks:

```sql
SELECT *
FROM pg_locks
WHERE NOT granted;
```

Part locking sudah dibahas lebih dalam di Part 014 nanti.

---

## 32. EXPLAIN dan Java Latency: Database Time Bukan Endpoint Time

Endpoint latency:

```text
HTTP request latency
  = pool wait
  + transaction begin
  + query planning
  + query execution
  + result transfer
  + object mapping
  + business logic
  + serialization
  + network response
```

EXPLAIN hanya membantu sebagian:

```text
query planning + query execution
```

Jika `Execution Time` kecil tetapi endpoint lambat:

- result set mungkin besar,
- fetch size buruk,
- ORM hydration mahal,
- JSON serialization mahal,
- N+1 query,
- pool wait,
- lock wait,
- GC pause,
- downstream call.

Jadi EXPLAIN harus dikorelasikan dengan:

- application tracing,
- query logs,
- `pg_stat_statements`,
- connection pool metrics,
- JVM metrics,
- endpoint p95/p99.

---

## 33. Practical SQL Snippets untuk Diagnosis

### 33.1 Basic plan

```sql
EXPLAIN
SELECT ...;
```

### 33.2 Runtime plan

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...;
```

### 33.3 Full diagnostic plan

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT ...;
```

### 33.4 JSON plan

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT ...;
```

### 33.5 Mutating statement safely

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, WAL)
DELETE FROM case_events
WHERE created_at < now() - interval '2 years';
ROLLBACK;
```

### 33.6 Check table statistics freshness approximation

```sql
SELECT
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'cases';
```

### 33.7 Check index usage

```sql
SELECT
    schemaname,
    relname,
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE relname = 'cases'
ORDER BY idx_scan DESC;
```

### 33.8 Find slow normalized queries

```sql
SELECT
    queryid,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

`pg_stat_statements` perlu extension dan konfigurasi yang tepat.

---

## 34. How to Think: From Plan to Action

Plan reading harus menghasilkan action yang jelas.

Contoh mapping:

| Temuan | Kemungkinan Action |
|---|---|
| Estimated rows jauh dari actual | `ANALYZE`, naikkan stats target, extended statistics, cek skew |
| Seq scan buang banyak row | index baru, expression index, partial index, rewrite predicate |
| Sort spill | index order, keyset pagination, projection, `SET LOCAL work_mem`, materialized view |
| Hash batches banyak | filter lebih awal, projection, stats, local work_mem, query rewrite |
| Nested loop inner loops besar | join order, composite index, hash join possibility, reduce outer rows |
| Index only scan heap fetch banyak | vacuum, visibility map, reduce churn, jangan rely pada IOS |
| Planning time tinggi | simplify query, prepared statement, reduce partitions, inspect ORM SQL |
| Execution DB cepat tapi endpoint lambat | cek ORM hydration, result size, pool wait, network, serialization |
| Plan beda antar tenant | skew handling, parameter-sensitive plan, partitioning, hot tenant strategy |

---

## 35. Anti-pattern Saat Menggunakan EXPLAIN

### 35.1 Hanya melihat apakah index dipakai

Index used bukan berarti query optimal.

### 35.2 Menganggap sequential scan selalu buruk

Sequential scan bisa optimal untuk large fraction scan.

### 35.3 Mengabaikan `loops`

Node cepat per loop bisa mahal jika loops besar.

### 35.4 Menjumlahkan actual time semua node

Actual time parent mencakup child. Menjumlahkan bisa double count.

### 35.5 Menganalisis dengan parameter tidak representatif

Plan untuk tenant kecil tidak menjelaskan tenant besar.

### 35.6 Membuat index untuk setiap slow query

Index mempercepat read tertentu tetapi memperlambat write, menambah WAL, storage, vacuum/index maintenance, dan migration complexity.

### 35.7 Menaikkan `work_mem` global karena satu sort spill

Ini bisa menyebabkan memory explosion saat concurrency tinggi.

### 35.8 Mengabaikan aplikasi

Query plan bagus tidak mencegah N+1, pool exhaustion, bad transaction scope, dan object hydration berlebihan.

---

## 36. Latihan Mandiri

### Latihan 1 — Membaca estimasi

Ambil query list utama di aplikasimu.

Jalankan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
...
```

Cari tiga node dengan mismatch terbesar antara `rows` dan `actual rows`.

Tulis:

```text
Node:
Estimated rows:
Actual rows:
Ratio:
Possible cause:
Possible fix:
```

### Latihan 2 — Membaca loops

Cari plan dengan nested loop.

Untuk inner node, hitung:

```text
actual rows * loops
```

Tanyakan apakah total operasi itu masuk akal untuk endpoint tersebut.

### Latihan 3 — Membaca sort

Cari query dengan `ORDER BY`.

Periksa apakah ada node `Sort`.

Jika ada:

- apakah sort in-memory?
- apakah external merge?
- apakah index bisa menghindari sort?
- apakah pagination memakai offset?

### Latihan 4 — Membaca buffers

Bandingkan dua query:

1. Query point lookup.
2. Query report/list besar.

Catat:

- shared hit,
- shared read,
- temp read/write,
- execution time.

Bedakan CPU/cache-heavy vs I/O-heavy.

### Latihan 5 — Java correlation

Ambil satu endpoint lambat.

Kumpulkan:

- jumlah query SQL yang dieksekusi,
- total DB execution time,
- endpoint latency,
- rows returned,
- object count hydrated,
- pool wait time.

Tentukan apakah masalahnya di database plan atau application data access pattern.

---

## 37. Ringkasan Mental Model

`EXPLAIN` adalah alat untuk melihat keputusan planner.

`EXPLAIN ANALYZE` adalah alat untuk membandingkan keputusan planner dengan realitas runtime.

Angka paling penting:

1. Estimated rows.
2. Actual rows.
3. Loops.
4. Buffers.
5. Temp read/write.
6. Sort/hash method.
7. Planning time.
8. Execution time.

Diagnosis yang baik tidak berhenti di “tambahkan index”.

Diagnosis yang baik menjawab:

- Planner mengira apa?
- Realitasnya apa?
- Di mana mismatch terjadi?
- Resource apa yang habis?
- Apakah query shape sesuai access pattern?
- Apakah index sesuai predicate/order/join?
- Apakah statistik merepresentasikan data?
- Apakah aplikasi menjalankan query ini dengan cara sehat?
- Apakah solusi memperbaiki satu query tetapi merusak write path?

Top-tier PostgreSQL engineer membaca plan sebagai cerita:

```text
SQL intent
  -> planner assumption
  -> chosen plan
  -> actual execution
  -> resource footprint
  -> mismatch
  -> root cause
  -> safe production change
```

---

## 38. Checklist Produksi untuk Query Plan Review

Sebelum menyetujui query/index/migration penting, cek:

```text
[ ] Query intent jelas.
[ ] Parameter representatif sudah diuji.
[ ] EXPLAIN ANALYZE BUFFERS tersedia.
[ ] Estimated rows vs actual rows masuk akal.
[ ] Tidak ada nested loop explosion.
[ ] Tidak ada sort/hash spill tidak wajar.
[ ] Access path sesuai workload.
[ ] Index mendukung WHERE + JOIN + ORDER BY, bukan hanya salah satunya.
[ ] Row width tidak berlebihan.
[ ] Pagination tidak memakai offset besar untuk hot path.
[ ] Query tidak menghasilkan row explosion dari join 1:N ganda.
[ ] Statistik fresh.
[ ] Data skew/tenant skew dipertimbangkan.
[ ] Prepared/generic plan behavior dipertimbangkan.
[ ] Efek write overhead index baru dipertimbangkan.
[ ] Migration index memakai CONCURRENTLY bila perlu.
[ ] Aplikasi tidak menjalankan query ini dalam N+1 loop.
[ ] Pool, timeout, dan transaction boundary sesuai.
[ ] Perubahan sudah diverifikasi dengan dataset representatif.
```

---

## 39. Penutup Part 010

Part ini adalah fondasi praktis untuk performance engineering PostgreSQL.

Setelah memahami `EXPLAIN`, bagian berikutnya akan masuk ke indexing secara lebih internal.

Kita tidak lagi melihat index sebagai “alat agar query cepat”, tetapi sebagai struktur data fisik yang punya:

- layout,
- operator class,
- scan behavior,
- visibility dependency,
- write amplification,
- bloat,
- maintenance cost,
- dan hubungan erat dengan planner.

Part berikutnya:

```text
Part 011 — Index Internals I: B-Tree PostgreSQL secara Mendalam
```

Seri belum selesai. Saat ini selesai sampai Part 010 dari 034.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Planner Statistics: Cardinality, Histograms, MCV, Correlation, Extended Statistics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-011.md">Part 011 — Index Internals I: B-Tree PostgreSQL secara Mendalam ➡️</a>
</div>
