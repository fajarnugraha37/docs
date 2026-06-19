# learn-postgresql-mastery-for-java-engineers — Part 004

# MVCC Deep Dive: Visibility, xmin/xmax, Snapshot, dan Tuple Versioning

## Tujuan Bagian Ini

Bagian ini menjelaskan MVCC PostgreSQL sebagai mekanisme concurrency dan visibility. MVCC adalah alasan read tidak selalu memblok write, tetapi juga alasan dead tuple, vacuum, bloat, snapshot retention, dan beberapa anomaly transaction terjadi.

## 1. MVCC Mental Model

MVCC berarti Multi-Version Concurrency Control. PostgreSQL menjaga beberapa versi tuple sehingga transaksi yang berbeda dapat melihat versi data yang berbeda sesuai snapshot-nya.

```text
Database tidak hanya bertanya: row ini ada atau tidak?
Database bertanya: versi row mana yang visible untuk snapshot transaksi ini?
```

Ini perbedaan besar. Data fisik di heap bisa berisi tuple lama dan baru sekaligus. Yang menentukan hasil query adalah visibility rule.

## 2. Transaction ID

Setiap transaksi yang mengubah data mendapat transaction ID. Tuple menyimpan metadata seperti:

- `xmin`: transaksi yang membuat tuple,
- `xmax`: transaksi yang menghapus/mengganti tuple, jika ada.

Secara konseptual:

```text
Tuple visible jika creator transaction sudah committed dan deleter/updater belum committed menurut snapshot aktif.
```

Detail aslinya lebih kompleks, tetapi mental model ini cukup untuk memahami mayoritas masalah produksi.

## 3. Tuple Versioning

Saat UPDATE:

```text
old tuple: xmax = transaction updater
new tuple: xmin = transaction updater
```

Transaksi lama mungkin masih melihat old tuple. Transaksi baru mungkin melihat new tuple setelah commit. Vacuum baru boleh membersihkan old tuple ketika tidak ada snapshot aktif yang masih membutuhkannya.

## 4. Snapshot

Snapshot menentukan transaksi mana yang dianggap visible. Snapshot berisi informasi tentang transaksi yang sudah commit, sedang aktif, atau belum terlihat pada waktu snapshot dibuat.

Dalam `READ COMMITTED`, setiap statement mendapat snapshot baru. Dalam `REPEATABLE READ`, satu transaksi memakai snapshot yang stabil.

## 5. Statement Snapshot vs Transaction Snapshot

### READ COMMITTED

Setiap statement melihat data committed terbaru pada awal statement. Dua SELECT dalam transaksi yang sama bisa melihat hasil berbeda jika transaksi lain commit di antaranya.

### REPEATABLE READ

Snapshot tetap sepanjang transaksi. Dua SELECT melihat dunia yang sama, walau transaksi lain commit.

### SERIALIZABLE

PostgreSQL memakai Serializable Snapshot Isolation untuk mendeteksi konflik yang bisa melanggar serializability. Aplikasi harus siap retry saat serialization failure.

## 6. Dead Tuple

Dead tuple adalah versi tuple yang tidak lagi visible untuk transaksi mana pun dan dapat dibersihkan. Dead tuple tidak selalu langsung hilang. Vacuum membersihkan kemudian.

Dead tuple meningkat karena:

- update tinggi,
- delete tinggi,
- vacuum tertahan,
- long-running transaction,
- idle in transaction,
- replication slot/logical decoding tertahan.

## 7. Long-running Transaction

Transaksi panjang mempertahankan snapshot lama. Snapshot lama dapat membuat PostgreSQL tidak bisa membersihkan tuple yang secara bisnis sudah tidak relevan.

Contoh buruk:

```java
@Transactional
public void exportLargeReport() {
    // membaca jutaan row selama 30 menit
}
```

Jika transaksi ini berjalan lama, vacuum bisa tertahan untuk table terkait.

## 8. Idle in Transaction

Session idle in transaction sama berbahayanya dengan transaksi panjang aktif. Ia mungkin tidak memakai CPU, tetapi snapshot-nya tetap hidup.

Production symptom:

```text
CPU rendah, tetapi table bloat naik.
Autovacuum berjalan, tetapi dead tuples tidak turun.
Ternyata ada idle in transaction berumur beberapa jam.
```

## 9. MVCC dan Index

Index entry dapat menunjuk ke tuple yang ternyata tidak visible untuk snapshot tertentu. Karena itu index scan sering perlu cek heap. Index-only scan bisa menghindari heap fetch hanya jika visibility map menunjukkan page all-visible.

Ini menjelaskan kenapa index-only scan tidak selalu benar-benar hanya membaca index.

## 10. MVCC dan Lost Update

MVCC tidak otomatis menyelamatkan semua race condition. Jika dua transaksi membaca nilai yang sama lalu menulis hasil berdasarkan nilai lama, lost update bisa terjadi jika tidak memakai pola benar.

Pola aman:

```sql
update account
set balance = balance - 100
where id = ? and balance >= 100;
```

Lalu cek affected row. Ini menjadikan invariant bagian dari write statement.

## 11. MVCC dan Write Skew

Write skew terjadi ketika dua transaksi membaca kondisi global yang sama lalu masing-masing menulis row berbeda sehingga invariant global rusak. Isolation rendah sering tidak cukup. Solusi bisa berupa:

- SERIALIZABLE + retry,
- explicit locking pada aggregate/root row,
- constraint/exclusion constraint,
- materialized invariant row,
- redesign aggregate boundary.

## 12. MVCC dan Java Transaction Boundary

`@Transactional` bukan jaminan correctness. Ia hanya membuka transaksi. Correctness tetap bergantung pada:

- isolation level,
- query shape,
- locking,
- constraint,
- retry,
- idempotency,
- boundary aggregate.

Kesalahan umum:

- read-check-write tanpa lock/constraint,
- transaksi terlalu luas,
- external call di dalam transaksi,
- tidak retry serialization failure/deadlock,
- tidak cek affected rows,
- optimistic locking dipakai tapi error mapping buruk.

## 13. MVCC dan Audit/Outbox

Outbox row sebaiknya ditulis dalam transaksi yang sama dengan perubahan domain. Dengan begitu, event hanya ada jika state change commit. MVCC memastikan consumer tidak melihat outbox row uncommitted.

Namun setelah commit, publish ke Kafka tetap asynchronous. Karena itu perlu relay, idempotency, dan handling retry.

## 14. Diagnostic SQL

```sql
select pid, application_name, state, now() - xact_start as xact_age, query
from pg_stat_activity
where xact_start is not null
order by xact_age desc;
```

```sql
select schemaname, relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
from pg_stat_user_tables
order by n_dead_tup desc
limit 20;
```

## 15. Prinsip Desain

1. Jangan pisahkan check invariant dari write jika bisa digabung.
2. Gunakan constraint untuk invariant yang harus absolut.
3. Gunakan lock untuk serialisasi aggregate yang jelas.
4. Gunakan SERIALIZABLE hanya jika siap retry.
5. Jaga transaksi tetap pendek.
6. Monitor transaksi panjang.
7. Pahami bahwa update/delete menghasilkan pekerjaan vacuum di masa depan.

---

## Checklist Pemahaman

Setelah menyelesaikan bagian ini, kamu seharusnya mampu menjelaskan topik ini bukan hanya sebagai definisi, tetapi sebagai model kerja yang bisa dipakai saat mendesain, mendiagnosis, dan mengoperasikan sistem PostgreSQL produksi dari aplikasi Java.

## Hubungan ke Part Berikutnya

Bagian ini menjadi fondasi untuk bagian berikutnya dalam seri. Jangan hanya menghafal istilah; gunakan mental modelnya untuk membaca gejala produksi: latency naik, lock menumpuk, koneksi habis, query berubah plan, atau recovery/replication tidak berjalan sesuai ekspektasi.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-003.md">⬅️ Part 003 — PostgreSQL Storage Model: Database, Tablespace, Relation, Fork, Page, Tuple</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-005.md">Part 005 — Transaction Isolation PostgreSQL: Real Behavior, Anomaly, dan Java Service Boundary ➡️</a>
</div>
