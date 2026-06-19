# learn-postgresql-mastery-for-java-engineers — Part 003

# PostgreSQL Storage Model: Database, Tablespace, Relation, Fork, Page, Tuple

## Tujuan Bagian Ini

Bagian ini menjelaskan bagaimana data PostgreSQL disimpan secara fisik. Tujuannya bukan agar kamu menghafal struktur file, tetapi agar kamu paham kenapa `UPDATE` bisa membuat bloat, kenapa row width mempengaruhi performa, kenapa index-only scan bergantung visibility map, dan kenapa desain schema mempengaruhi I/O.

## 1. Cluster, Database, Schema

Istilah penting:

- cluster: satu instalasi PostgreSQL dengan data directory,
- database: namespace besar di dalam cluster,
- schema: namespace object di dalam database,
- relation: object storage seperti table, index, materialized view, toast table.

Dalam PostgreSQL, “cluster” bukan selalu cluster HA. Ia berarti satu data directory PostgreSQL yang dikelola oleh satu server instance.

## 2. Relation sebagai File Fisik

Table dan index disebut relation. Relation disimpan sebagai file fisik. PostgreSQL memetakan object logical ke file melalui metadata seperti OID dan relfilenode.

Implikasi:

- table besar adalah kumpulan page,
- index adalah relation terpisah,
- menambah index berarti menambah struktur fisik yang harus dirawat,
- rebuild/rewrite table dapat mengganti file fisik.

## 3. Tablespace

Tablespace memungkinkan object tertentu disimpan di lokasi filesystem berbeda. Ini bisa dipakai untuk memisahkan storage cepat/lambat, tetapi di cloud-managed PostgreSQL sering dibatasi.

Jangan memakai tablespace sebagai solusi pertama untuk desain data. Gunakan saat ada kebutuhan operasional nyata: I/O isolation, storage tiering, atau migration tertentu.

## 4. Relation Forks

Satu relation bisa punya beberapa fork:

- main fork: data utama,
- free space map/FSM: informasi ruang kosong,
- visibility map/VM: informasi page yang all-visible/all-frozen,
- init fork: untuk unlogged relation tertentu.

Visibility map penting untuk index-only scan. Jika page belum ditandai all-visible, PostgreSQL tetap harus cek heap untuk memastikan visibility tuple.

## 5. Page / Block 8KB

Unit dasar I/O PostgreSQL adalah page/block, default 8KB. Table bukan dibaca per row secara terisolasi; PostgreSQL membaca page yang berisi banyak tuple.

Konsekuensi:

- row yang lebar mengurangi jumlah tuple per page,
- lebih sedikit tuple per page berarti lebih banyak page harus dibaca,
- sequential scan membaca page demi page,
- index lookup akhirnya sering perlu membaca heap page,
- locality data penting untuk cache behavior.

## 6. Tuple dan Line Pointer

Heap page berisi line pointer yang menunjuk ke tuple. Tuple menyimpan metadata MVCC seperti `xmin` dan `xmax`, serta nilai kolom.

`ctid` merepresentasikan lokasi fisik tuple: block number dan offset di page. Namun `ctid` berubah ketika row di-update karena PostgreSQL membuat versi tuple baru. Jangan jadikan `ctid` sebagai identifier domain.

## 7. UPDATE bukan Overwrite

Dalam PostgreSQL, update biasanya membuat tuple versi baru. Tuple lama tidak langsung hilang karena transaksi lain mungkin masih perlu melihat versi lama berdasarkan snapshot MVCC.

```text
UPDATE row
  -> tuple lama diberi xmax
  -> tuple baru dibuat dengan xmin transaksi update
  -> index mungkin perlu entry baru
  -> tuple lama menjadi dead setelah tidak visible bagi transaksi aktif
  -> vacuum membersihkan nanti
```

Ini alasan update-heavy workload dapat menghasilkan bloat.

## 8. DELETE juga Menandai, bukan Langsung Menghapus

DELETE menandai tuple sebagai deleted melalui MVCC metadata. Space baru dapat digunakan ulang setelah vacuum memastikan tuple tidak diperlukan snapshot aktif.

Jadi, banyak DELETE tidak otomatis mengecilkan file table. Space biasanya reusable di dalam table, bukan dikembalikan langsung ke OS. `VACUUM FULL` dapat mengecilkan file tetapi membutuhkan lock berat dan rewrite table.

## 9. HOT Update

Heap-Only Tuple update dapat terjadi jika update tidak mengubah kolom yang terindeks dan masih ada ruang cukup di page yang sama. HOT update mengurangi index write amplification.

Desain yang membantu HOT:

- jangan index kolom yang sering berubah tanpa alasan kuat,
- gunakan fillfactor untuk table update-heavy,
- pisahkan kolom mutable besar dari row utama bila perlu,
- hindari no-op update dari ORM.

## 10. TOAST

TOAST adalah mekanisme PostgreSQL untuk menyimpan nilai besar seperti `text`, `bytea`, atau `jsonb` besar di luar row utama.

Konsekuensi:

- row tampak kecil tetapi membaca kolom besar bisa memicu akses TOAST,
- `SELECT *` dapat mahal jika memuat kolom besar,
- update kolom besar dapat menghasilkan write amplification,
- JSONB besar dapat memperberat vacuum dan WAL.

Prinsip Java backend: jangan ambil kolom besar jika tidak perlu. DTO/list endpoint harus memilih kolom eksplisit.

## 11. Index sebagai Relation Terpisah

Index bukan metadata ringan. Index punya page, bloat, WAL, vacuum interaction, dan write cost. Setiap INSERT/UPDATE/DELETE harus menjaga index relevan.

Index mempercepat read tertentu dengan menambah biaya write dan storage. Karena itu index design harus berbasis access pattern, bukan “kolom ini sering difilter mungkin perlu index”.

## 12. Row Width dan Data Locality

Row lebar mengurangi kepadatan page. Jika endpoint list hanya membutuhkan 8 kolom kecil tetapi table punya 60 kolom termasuk JSONB besar, desain read path bisa boros.

Strategi:

- projection query eksplisit,
- table split untuk data jarang dibaca,
- generated/search projection untuk read model,
- materialized view untuk reporting tertentu,
- hindari `SELECT *` di path latency-sensitive.

## 13. Storage Model dan Java ORM

ORM dapat menyembunyikan biaya storage. Contoh:

- dirty checking menghasilkan UPDATE semua kolom,
- optimistic locking update version column pada setiap perubahan,
- eager fetch mengambil kolom besar,
- entity graph mengambil relasi terlalu banyak,
- no-op update tetap menghasilkan tuple baru.

Top-tier engineer membaca SQL yang dihasilkan ORM dan memahami efek fisiknya.

## 14. Failure Mode

### Bloat naik perlahan

Penyebab: update/delete tinggi, vacuum tertahan, index terlalu banyak, long transaction.

### Disk penuh

Penyebab: WAL, bloat, temp file, failed archiving, replication slot tertahan.

### Query list lambat

Penyebab: row terlalu lebar, TOAST access, missing covering index, bad pagination.

### UPDATE mahal

Penyebab: banyak index, kolom indexed berubah, trigger, FK, WAL amplification.

## 15. Diagnostic SQL

```sql
select relname, relpages, reltuples
from pg_class
where relkind in ('r','i')
order by relpages desc
limit 20;
```

```sql
select schemaname, relname, n_tup_ins, n_tup_upd, n_tup_del, n_dead_tup
from pg_stat_user_tables
order by n_dead_tup desc
limit 20;
```

```sql
select schemaname, relname, n_tup_hot_upd, n_tup_upd
from pg_stat_user_tables
where n_tup_upd > 0
order by n_tup_hot_upd::numeric / nullif(n_tup_upd,0) asc
limit 20;
```

---

## Checklist Pemahaman

Setelah menyelesaikan bagian ini, kamu seharusnya mampu menjelaskan topik ini bukan hanya sebagai definisi, tetapi sebagai model kerja yang bisa dipakai saat mendesain, mendiagnosis, dan mengoperasikan sistem PostgreSQL produksi dari aplikasi Java.

## Hubungan ke Part Berikutnya

Bagian ini menjadi fondasi untuk bagian berikutnya dalam seri. Jangan hanya menghafal istilah; gunakan mental modelnya untuk membaca gejala produksi: latency naik, lock menumpuk, koneksi habis, query berubah plan, atau recovery/replication tidak berjalan sesuai ekspektasi.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-002.md">⬅️ Part 002 — Connection Lifecycle, Session State, dan Pooling untuk Java Applications</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-004.md">Part 004 — MVCC Deep Dive: Visibility, xmin/xmax, Snapshot, dan Tuple Versioning ➡️</a>
</div>
