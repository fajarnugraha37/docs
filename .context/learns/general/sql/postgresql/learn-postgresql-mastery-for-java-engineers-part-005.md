# learn-postgresql-mastery-for-java-engineers — Part 005

# Transaction Isolation PostgreSQL: Real Behavior, Anomaly, dan Java Service Boundary

## Tujuan Bagian Ini

Bagian ini menjelaskan isolation level PostgreSQL dari perilaku nyata, bukan definisi textbook. Targetnya: kamu bisa memilih strategi correctness untuk service Java yang melakukan update state, workflow transition, reservation, approval, escalation, atau idempotent command processing.

## 1. Isolation Level yang Relevan

PostgreSQL mendukung beberapa isolation level utama:

- Read Committed,
- Repeatable Read,
- Serializable.

Read Uncommitted di PostgreSQL berperilaku seperti Read Committed karena PostgreSQL tidak mengizinkan dirty read.

## 2. READ COMMITTED

Ini default. Setiap statement melihat snapshot baru dari data committed pada awal statement.

Konsekuensi:

```text
BEGIN;
SELECT status FROM case WHERE id = 1; -- OPEN
-- transaksi lain update status jadi CLOSED dan commit
SELECT status FROM case WHERE id = 1; -- CLOSED
COMMIT;
```

Dalam transaksi yang sama, SELECT kedua bisa melihat hasil berbeda. Ini normal untuk Read Committed.

Cocok untuk banyak OLTP biasa, tetapi hati-hati untuk read-check-write.

## 3. REPEATABLE READ

Satu transaksi melihat snapshot stabil. Jika transaksi lain commit di tengah, transaksi ini tidak otomatis melihat perubahan itu.

Cocok untuk laporan konsisten dalam satu transaksi atau proses yang butuh pandangan stabil. Namun write conflict tertentu dapat menghasilkan error yang perlu retry.

## 4. SERIALIZABLE

Serializable mencoba membuat hasil transaksi setara dengan eksekusi serial. PostgreSQL memakai SSI. Jika mendeteksi pola konflik berbahaya, salah satu transaksi gagal dengan serialization failure.

Artinya: SERIALIZABLE bukan magic yang selalu sukses. Aplikasi harus retry transaksi.

## 5. Dirty Read

Dirty read berarti membaca data uncommitted transaksi lain. PostgreSQL tidak mengizinkan ini.

## 6. Non-repeatable Read

Di Read Committed, dua SELECT dalam transaksi yang sama bisa melihat nilai berbeda karena snapshot per statement.

## 7. Phantom

Phantom terjadi ketika query range menghasilkan set row berbeda setelah transaksi lain insert/delete matching row. Di PostgreSQL, perilakunya bergantung isolation level.

## 8. Lost Update

Contoh buruk:

```text
T1 read balance = 100
T2 read balance = 100
T1 write balance = 70
T2 write balance = 80
```

Salah satu update hilang secara logika.

Pola aman:

```sql
update account
set balance = balance - :amount
where id = :id
  and balance >= :amount;
```

Aplikasi cek affected row. Jika 0, invariant gagal.

## 9. Write Skew

Write skew sering muncul pada invariant lintas row. Contoh: minimal satu officer harus on duty. Dua transaksi masing-masing melihat ada dua officer, lalu masing-masing off-duty untuk row berbeda. Akhirnya nol officer on duty.

Solusi:

- lock aggregate root,
- constraint yang memodelkan invariant,
- SERIALIZABLE + retry,
- redesign data agar invariant menjadi satu row update,
- advisory lock untuk boundary tertentu dengan disiplin ketat.

## 10. SELECT FOR UPDATE

`SELECT FOR UPDATE` mengunci row yang dipilih untuk update. Ini berguna untuk serialisasi perubahan pada entity/aggregate.

```sql
select *
from case_file
where id = :id
for update;
```

Namun lock hanya berlaku untuk row yang benar-benar dipilih. Jika invariant adalah “tidak boleh ada dua active assignment untuk case”, mengunci row assignment yang belum ada tidak cukup. Gunakan unique partial index atau lock parent case row.

## 11. NOWAIT dan SKIP LOCKED

`NOWAIT` gagal cepat jika lock tidak tersedia. Cocok untuk UI/action yang tidak boleh menunggu lama.

`SKIP LOCKED` melewati row yang terkunci. Cocok untuk queue worker, bukan untuk operasi yang harus melihat seluruh data.

## 12. Optimistic Locking

Pola umum:

```sql
update case_file
set status = :new_status, version = version + 1
where id = :id
  and version = :expected_version;
```

Jika affected row 0, ada concurrent modification. Cocok ketika konflik jarang dan retry/user feedback bisa diterima.

## 13. Pessimistic Locking

Pessimistic locking mengunci lebih awal. Cocok ketika konflik sering, operasi mahal, atau invariant harus dijaga lewat serialisasi eksplisit.

Risiko:

- lock wait,
- deadlock,
- latency naik,
- throughput turun.

## 14. Constraint sebagai Strategy Isolation

Sering kali solusi terbaik bukan isolation level lebih tinggi, melainkan constraint.

Contoh idempotency:

```sql
create unique index uq_idempotency_key
on command_request(tenant_id, idempotency_key);
```

Concurrent insert akan diserialisasi oleh unique enforcement.

## 15. Spring @Transactional Traps

Kesalahan umum:

- self-invocation membuat annotation tidak aktif,
- method private tidak diproxy,
- exception checked tidak rollback default tertentu,
- propagation tidak dipahami,
- isolation tidak diset padahal invariant butuh,
- transaksi mencakup HTTP call,
- retry dilakukan di dalam transaksi yang sudah rollback-only.

Retry harus mengulang seluruh transaksi dari awal.

## 16. SQLSTATE yang Harus Dikenali

Aplikasi Java harus mengenali error transient seperti:

- serialization failure,
- deadlock detected,
- lock not available,
- connection failure tertentu.

Retry harus bounded, dengan backoff, dan hanya untuk operasi idempotent atau transaksi yang aman diulang.

## 17. Workflow State Transition Pattern

Untuk state machine:

```sql
update case_file
set status = :target, version = version + 1
where id = :case_id
  and status = :expected_source
  and version = :expected_version;
```

Ini menggabungkan check dan write. Jangan lakukan:

```text
select status
if allowed then update
```

tanpa lock atau conditional update.

## 18. Prinsip Desain

1. Pilih invariant dulu, isolation kemudian.
2. Gabungkan predicate bisnis ke statement write jika mungkin.
3. Gunakan constraint untuk race yang harus mustahil.
4. Gunakan lock untuk aggregate boundary.
5. Gunakan SERIALIZABLE hanya dengan retry.
6. Jangan membuka transaksi lintas I/O eksternal.
7. Error transient harus punya policy retry eksplisit.
8. Cek affected row adalah bagian dari correctness.

---

## Checklist Pemahaman

Setelah menyelesaikan bagian ini, kamu seharusnya mampu menjelaskan topik ini bukan hanya sebagai definisi, tetapi sebagai model kerja yang bisa dipakai saat mendesain, mendiagnosis, dan mengoperasikan sistem PostgreSQL produksi dari aplikasi Java.

## Hubungan ke Part Berikutnya

Bagian ini menjadi fondasi untuk bagian berikutnya dalam seri. Jangan hanya menghafal istilah; gunakan mental modelnya untuk membaca gejala produksi: latency naik, lock menumpuk, koneksi habis, query berubah plan, atau recovery/replication tidak berjalan sesuai ekspektasi.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — MVCC Deep Dive: Visibility, xmin/xmax, Snapshot, dan Tuple Versioning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-006.md">Part 006 — WAL, Durability, Checkpoint, dan Crash Recovery ➡️</a>
</div>
