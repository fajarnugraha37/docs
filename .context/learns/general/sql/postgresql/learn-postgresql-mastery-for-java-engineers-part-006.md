# learn-postgresql-mastery-for-java-engineers — Part 006

# WAL, Durability, Checkpoint, dan Crash Recovery

## Tujuan Bagian Ini

Bagian ini menjelaskan bagaimana PostgreSQL menjaga durability. Setelah bagian ini, kamu harus bisa menjelaskan apa yang terjadi saat transaksi commit, kenapa WAL harus ditulis sebelum data page, bagaimana checkpoint mempengaruhi latency dan recovery, serta apa arti crash recovery untuk aplikasi Java.

## 1. Durability Mental Model

Durability berarti setelah commit sukses dikonfirmasi, perubahan tidak hilang walau server crash, dengan asumsi storage dan konfigurasi durability bekerja benar. PostgreSQL mencapai ini dengan Write-Ahead Logging.

Prinsip utama:

```text
Sebelum data page kotor boleh dianggap aman, WAL record terkait harus ditulis dulu.
```

Jika crash terjadi sebelum dirty page ditulis, PostgreSQL bisa replay WAL. Jika dirty page sebagian tertulis, mekanisme recovery dan full-page write membantu menjaga konsistensi page.

## 2. WAL Record

Setiap perubahan penting menghasilkan WAL record. WAL record menjelaskan perubahan yang cukup untuk recovery. WAL bukan hanya untuk crash recovery; ia juga dipakai oleh replication, PITR, archiving, dan logical decoding.

## 3. WAL Segment dan LSN

WAL disimpan dalam segment file. LSN atau Log Sequence Number adalah posisi dalam stream WAL. LSN dipakai untuk tracking progress recovery, replication lag, backup consistency, dan debugging.

## 4. Commit Path

Secara konseptual commit write transaction:

```text
modify tuples/pages in memory
  -> generate WAL records
  -> mark commit in WAL
  -> flush WAL depending on synchronous_commit/fsync
  -> report success to client
  -> dirty data pages may be written later
```

Data page tidak harus langsung ditulis saat commit. Yang penting WAL commit record durable sesuai konfigurasi.

## 5. fsync

`fsync` memastikan PostgreSQL meminta OS/storage mem-flush data ke durable storage. Mematikan `fsync` dapat meningkatkan performa tetapi mengorbankan durability dan berisiko corruption setelah crash. Untuk production serius, jangan mematikan `fsync` kecuali kamu benar-benar menerima kehilangan/corruption data.

## 6. synchronous_commit

`synchronous_commit` mengontrol kapan commit dianggap selesai relatif terhadap WAL flush dan replication. Setting ini trade-off latency vs durability/replication guarantee.

Beberapa workload non-kritis bisa menerima risiko kecil kehilangan transaksi terakhir demi latency. Namun untuk regulatory, financial, audit, enforcement decision, default durable behavior biasanya lebih tepat.

## 7. Dirty Pages

Ketika data berubah, page di shared buffers menjadi dirty. Dirty page akan ditulis ke storage oleh background writer, checkpointer, atau backend process.

Jika terlalu banyak dirty page menumpuk, checkpoint bisa berat dan query user dapat terkena write I/O.

## 8. Checkpoint

Checkpoint adalah titik di mana PostgreSQL memastikan dirty page sampai LSN tertentu telah ditulis. Setelah checkpoint, crash recovery bisa mulai dari titik checkpoint, bukan dari WAL lama sekali.

Trade-off:

- checkpoint sering: recovery cepat tapi I/O sering,
- checkpoint jarang: recovery lebih lama tapi I/O lebih tersebar,
- checkpoint terlalu bursty: latency spike.

## 9. Full-page Writes

Full-page writes membantu melindungi dari torn page/partial page write. Saat page pertama kali dimodifikasi setelah checkpoint, PostgreSQL dapat menulis image page penuh ke WAL. Ini meningkatkan WAL volume tetapi memperkuat recovery safety.

## 10. Crash Recovery

Saat server restart setelah crash, PostgreSQL membaca checkpoint terakhir lalu replay WAL sampai consistent state. Transaksi committed dipulihkan, transaksi uncommitted dibatalkan secara logis.

Aplikasi Java melihat gejala seperti:

- connection reset,
- transaction gagal,
- commit result ambigu jika koneksi putus saat commit,
- pool harus reconnect,
- retry harus idempotent.

## 11. Ambiguous Commit

Kasus penting:

```text
Aplikasi mengirim COMMIT
Database commit sukses
Koneksi putus sebelum response diterima aplikasi
```

Aplikasi tidak tahu apakah transaksi commit atau rollback. Solusi bukan retry buta. Gunakan idempotency key, unique constraint, command table, atau outbox untuk memastikan retry aman.

## 12. WAL Archiving dan PITR

Jika WAL archive aktif, WAL segment disimpan ke lokasi arsip. Bersama base backup, WAL archive memungkinkan point-in-time recovery.

Tanpa WAL yang lengkap, PITR gagal. Backup strategy harus diuji dengan restore drill, bukan hanya mengecek file backup ada.

## 13. Replication dan WAL

Streaming replication mengirim WAL ke standby. Jika standby lag, WAL harus tetap tersedia. Replication slot dapat menahan WAL agar tidak dihapus sebelum replica/consumer membacanya.

Risiko replication slot:

```text
consumer mati
  -> slot tidak advance
  -> WAL tertahan
  -> pg_wal tumbuh
  -> disk penuh
```

## 14. WAL Amplification

Write workload menghasilkan WAL. Banyak index, update kolom besar, full-page writes, bulk load, dan JSONB besar dapat meningkatkan WAL volume.

Dari sisi Java:

- batch job besar bisa membuat WAL spike,
- outbox/event log menambah write,
- update semua kolom oleh ORM memperbesar WAL,
- no-op update tetap mahal.

## 15. Monitoring WAL dan Checkpoint

Pantau:

- WAL generation rate,
- `pg_wal` disk usage,
- checkpoint frequency,
- checkpoint duration,
- archive failure,
- replication slot lag,
- replica replay lag,
- disk write latency.

## 16. Failure Scenarios

### Disk penuh karena WAL

Penyebab: archiver gagal, replication slot tertahan, batch write besar.

Mitigasi: alert disk, monitor slot, fix archiving, throttle writer, provision storage, drop slot hanya jika konsekuensi dipahami.

### Latency spike saat checkpoint

Penyebab: checkpoint terlalu bursty atau storage lambat.

Mitigasi: tuning checkpoint, storage I/O, workload smoothing, batching lebih terkendali.

### Data hilang setelah crash

Penyebab potensial: konfigurasi durability dilemahkan, storage lying about fsync, transaksi belum commit, asynchronous commit.

### Commit ambiguity

Mitigasi: idempotency dan command result lookup.

## 17. Prinsip untuk Sistem Java

1. Treat commit response loss as ambiguous.
2. Gunakan idempotency untuk command penting.
3. Jangan retry write tanpa deduplication.
4. Outbox harus satu transaksi dengan state change.
5. Batch write harus rate-limited.
6. Jangan mematikan durability setting untuk workload penting.
7. Uji recovery, bukan hanya backup.
8. Pantau WAL sebagai indikator tekanan write.

---

## Checklist Pemahaman

Setelah menyelesaikan bagian ini, kamu seharusnya mampu menjelaskan topik ini bukan hanya sebagai definisi, tetapi sebagai model kerja yang bisa dipakai saat mendesain, mendiagnosis, dan mengoperasikan sistem PostgreSQL produksi dari aplikasi Java.

## Hubungan ke Part Berikutnya

Bagian ini menjadi fondasi untuk bagian berikutnya dalam seri. Jangan hanya menghafal istilah; gunakan mental modelnya untuk membaca gejala produksi: latency naik, lock menumpuk, koneksi habis, query berubah plan, atau recovery/replication tidak berjalan sesuai ekspektasi.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-005.md">⬅️ Part 005 — Transaction Isolation PostgreSQL: Real Behavior, Anomaly, dan Java Service Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-007.md">Part 007 — Buffer Manager dan Memory: Shared Buffers, OS Cache, Work Mem, Maintenance Mem ➡️</a>
</div>
