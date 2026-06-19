# learn-postgresql-mastery-for-java-engineers — Part 001

# Arsitektur Proses PostgreSQL: Backend Process, Shared Memory, dan Background Workers

## Tujuan Bagian Ini

Bagian ini menjelaskan bagaimana PostgreSQL berjalan sebagai sistem proses di operating system. Untuk Java engineer, ini penting karena banyak masalah yang tampak seperti masalah aplikasi sebenarnya berasal dari interaksi antara connection pool, backend process PostgreSQL, shared memory, WAL writer, checkpointer, autovacuum, dan replication workers.

PostgreSQL bukan server monolitik single-threaded yang menerima semua request di satu thread besar. Model umumnya adalah satu proses utama yang mengelola banyak proses backend dan background worker. Setiap koneksi client biasanya dilayani oleh satu backend process. Karena itu, jumlah koneksi bukan sekadar angka konfigurasi; jumlah koneksi adalah jumlah proses, konsumsi memory, potensi context switching, dan pressure terhadap lock manager, snapshot, serta shared buffers.

## 1. Mental Model Global

Bayangkan PostgreSQL sebagai pabrik stateful:

```text
Client Java / JDBC / HikariCP
        |
        v
Postmaster / main server process
        |
        +-- backend process untuk connection A
        +-- backend process untuk connection B
        +-- backend process untuk connection C
        |
        +-- background writer
        +-- checkpointer
        +-- WAL writer
        +-- autovacuum launcher/workers
        +-- archiver
        +-- replication sender/receiver
        +-- logical replication launcher/workers
        +-- parallel query workers
```

Koneksi aplikasi tidak hanya “masuk ke database”. Koneksi itu biasanya mendapat proses server sendiri. Proses ini membaca query, membuat snapshot, memegang lock, menjalankan executor, membaca/menulis page, menghasilkan WAL, dan mengembalikan hasil ke client.

Implikasi pertama: connection pool Java adalah bagian dari desain database. Pool terlalu kecil membuat aplikasi antre di sisi Java. Pool terlalu besar membuat PostgreSQL kebanjiran backend process, memory per process naik, lock contention naik, context switching naik, dan throughput bisa turun.

## 2. Postmaster / Main Server Process

Proses utama PostgreSQL sering disebut postmaster atau server process utama. Tugasnya bukan mengeksekusi semua query user, melainkan mengelola lifecycle server:

- membuka socket dan menerima koneksi baru,
- melakukan fork/spawn backend process untuk koneksi,
- mengawasi child process,
- mengelola shutdown/restart behavior,
- memastikan crash satu backend tidak langsung berarti corruption seluruh cluster,
- mengelola background workers.

Jika satu backend process crash, PostgreSQL dapat menganggap shared memory berada dalam keadaan tidak aman dan melakukan restart proses-proses terkait untuk kembali ke state konsisten. Ini menjelaskan kenapa error native extension atau bug C-level bisa berdampak luas, sedangkan error SQL biasa tidak.

## 3. Backend Process per Connection

Setiap session client umumnya diwakili oleh satu backend process. Backend process menyimpan state session, seperti:

- transaction state,
- prepared statements,
- temporary tables,
- cursor,
- GUC/session parameters,
- advisory locks,
- current role/search path,
- snapshot yang sedang aktif,
- lock yang dipegang.

Ini alasan kenapa connection pooling mode session dan transaction berbeda secara drastis. Pada session pooling, satu client logical dapat memakai satu backend process untuk waktu lama sehingga session state bisa dipertahankan. Pada transaction pooling seperti PgBouncer transaction mode, backend process dapat berganti antar transaksi; session state tidak boleh diasumsikan stabil.

## 4. Shared Memory

Backend process tidak berjalan sepenuhnya terisolasi. Mereka berkoordinasi lewat shared memory. Komponen penting di shared memory antara lain:

- shared buffers,
- lock table,
- WAL buffers,
- process array,
- transaction state visibility data,
- statistics/coordination structures.

Shared memory adalah tempat PostgreSQL menjaga koordinasi global. Saat satu query membaca page, page mungkin sudah ada di shared buffers karena backend lain membacanya. Saat transaksi mengambil lock, lock itu tercatat agar backend lain tahu apakah harus menunggu atau gagal.

## 5. Shared Buffers

Shared buffers adalah cache page database di dalam PostgreSQL. Ini bukan satu-satunya cache karena operating system juga punya page cache. Top-tier engineer tidak menyamakan shared buffers dengan seluruh memory database. PostgreSQL bekerja bersama OS cache.

Jika query membutuhkan page:

1. backend cek apakah page ada di shared buffers,
2. jika tidak ada, backend minta OS membaca file,
3. OS mungkin mengambil dari page cache,
4. jika tidak ada di OS cache, disk/storage dibaca,
5. page masuk ke shared buffers,
6. executor memakai tuple di page tersebut.

Karena shared buffers dipakai bersama, pola query satu service bisa mengusir page penting service lain. Workload reporting besar dapat mengganggu OLTP jika tidak dipisah secara arsitektural.

## 6. WAL Buffers dan WAL Writer

Saat transaksi mengubah data, PostgreSQL tidak hanya mengubah page heap/index. Ia menghasilkan WAL record. WAL buffer menampung WAL record sebelum ditulis ke storage. WAL writer membantu menulis WAL secara periodik, sedangkan commit tertentu dapat memaksa flush WAL tergantung durability setting.

Mental model penting:

```text
Data page boleh ditulis nanti.
WAL harus aman dulu sebelum commit dianggap durable.
```

Ini inti write-ahead logging. Jika crash terjadi, PostgreSQL memakai WAL untuk recovery.

## 7. Background Writer

Background writer bertugas menulis dirty buffers ke disk secara bertahap agar backend user tidak terlalu sering harus menulis page kotor sendiri. Namun background writer bukan checkpoint. Ia membantu smoothing write I/O.

Jika background writer tidak mampu mengejar dirty page generation, backend process dapat ikut menulis page. Dari sisi aplikasi, ini muncul sebagai latency spike pada query yang tampak sederhana.

## 8. Checkpointer

Checkpointer melakukan checkpoint: memastikan semua dirty page sampai titik tertentu sudah ditulis ke storage sehingga crash recovery tidak perlu replay WAL terlalu jauh. Checkpoint terlalu sering bisa menyebabkan I/O burst. Checkpoint terlalu jarang bisa memperpanjang crash recovery dan meningkatkan WAL accumulation.

Parameter checkpoint adalah trade-off antara:

- latency stabil,
- recovery time,
- I/O pressure,
- WAL volume,
- durability expectation.

## 9. Autovacuum Launcher dan Workers

Autovacuum adalah background subsystem yang membersihkan dead tuples, melakukan analyze, dan mencegah transaction ID wraparound. Autovacuum launcher memutuskan kapan worker dijalankan. Worker melakukan vacuum/analyze pada table tertentu.

Autovacuum bukan housekeeping opsional. Untuk PostgreSQL, autovacuum adalah bagian dari correctness dan performance lifecycle MVCC. Jika autovacuum tertahan oleh long-running transaction atau terlalu lemah untuk workload update-heavy, bloat naik, query melambat, index membesar, dan storage bisa habis.

## 10. Archiver Process

Jika WAL archiving aktif, archiver menyalin WAL segment ke lokasi arsip. Ini penting untuk PITR dan disaster recovery. Jika archiver gagal, WAL segment bisa menumpuk di primary dan disk penuh.

Production failure klasik:

```text
archive_command gagal
  -> pg_wal tumbuh
  -> disk penuh
  -> database berhenti menerima write
  -> aplikasi Java mulai timeout/error
```

## 11. Replication Processes

Streaming replication melibatkan WAL sender di primary dan WAL receiver di standby. Logical replication punya launcher dan worker tersendiri. Replication bukan hanya fitur HA; ia adalah pipeline state yang bisa lag, tertahan, atau konflik.

Jika aplikasi membaca dari replica, maka consistency semantics berubah. Read-after-write tidak otomatis terjamin jika replica asynchronous.

## 12. Parallel Query Workers

PostgreSQL dapat menggunakan parallel workers untuk query tertentu. Ini meningkatkan throughput query besar, tetapi juga memakai worker slot, CPU, dan memory tambahan. Query parallel yang tampak menguntungkan dapat mengganggu workload OLTP jika tidak dikendalikan.

## 13. Implikasi untuk Java Engineer

### Connection Pool bukan sekadar optimisasi

HikariCP menentukan seberapa banyak backend process PostgreSQL aktif untuk aplikasi. Jumlah instance aplikasi dikalikan pool size adalah potensi jumlah koneksi database.

```text
10 pod aplikasi x maximumPoolSize 30 = 300 koneksi potensial
```

Jika `max_connections` 300, tidak berarti konfigurasi itu sehat. Memory per connection, lock contention, query concurrency, dan CPU core harus dihitung.

### Idle in transaction adalah bug sistem

Session `idle in transaction` tetap memegang snapshot dan mungkin lock. Ia bisa menahan vacuum, membuat dead tuple tidak bisa dibersihkan, dan menyebabkan bloat. Dalam Java, ini sering terjadi karena:

- transaksi dibuka terlalu luas,
- panggilan eksternal dilakukan di dalam transaksi,
- streaming response belum selesai,
- exception tidak menutup transaksi,
- ORM session terlalu lama hidup.

### Backend process state harus observable

Gunakan `application_name` agar `pg_stat_activity` dapat dikaitkan dengan service, instance, endpoint, atau job. Tanpa ini, diagnosis production menjadi tebakan.

## 14. Failure Modelling

### Backend process overload

Gejala:

- banyak active session,
- CPU tinggi,
- context switching tinggi,
- query latency naik,
- pool wait time naik.

Akar masalah bisa pool terlalu besar, query lambat, lock wait, atau downstream timeout.

### Connection storm

Terjadi saat banyak instance aplikasi restart dan membuka koneksi bersamaan. PostgreSQL harus membuat banyak backend process dalam waktu singkat.

Mitigasi:

- pool warm-up bertahap,
- connection timeout realistis,
- PgBouncer,
- deployment rolling,
- limit max pool per pod,
- readiness probe yang tidak menciptakan storm.

### Background process starvation

Jika autovacuum, checkpointer, atau WAL writer tidak bisa mengejar workload, gejala muncul sebagai query lambat, WAL growth, disk pressure, atau bloat.

## 15. Diagnostic Queries Awal

```sql
select pid, application_name, state, wait_event_type, wait_event, query
from pg_stat_activity
where datname = current_database()
order by state, pid;
```

```sql
select state, wait_event_type, wait_event, count(*)
from pg_stat_activity
group by state, wait_event_type, wait_event
order by count(*) desc;
```

```sql
select datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit
from pg_stat_database
where datname = current_database();
```

## 16. Prinsip Desain

1. Koneksi database adalah resource mahal.
2. Pool size adalah batas concurrency database, bukan angka dekoratif.
3. Transaction boundary harus pendek dan jelas.
4. Jangan lakukan network call eksternal di dalam transaksi database kecuali benar-benar didesain.
5. Selalu beri `application_name`.
6. Observability PostgreSQL harus dikorelasikan dengan metric aplikasi.
7. Background workers adalah bagian dari kapasitas sistem, bukan noise.
8. Database yang sehat bukan hanya CPU rendah; vacuum, WAL, checkpoint, lock, dan connection state harus sehat.

---

## Checklist Pemahaman

Setelah menyelesaikan bagian ini, kamu seharusnya mampu menjelaskan topik ini bukan hanya sebagai definisi, tetapi sebagai model kerja yang bisa dipakai saat mendesain, mendiagnosis, dan mengoperasikan sistem PostgreSQL produksi dari aplikasi Java.

## Hubungan ke Part Berikutnya

Bagian ini menjadi fondasi untuk bagian berikutnya dalam seri. Jangan hanya menghafal istilah; gunakan mental modelnya untuk membaca gejala produksi: latency naik, lock menumpuk, koneksi habis, query berubah plan, atau recovery/replication tidak berjalan sesuai ekspektasi.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-000.md">⬅️ Part 000 — PostgreSQL sebagai Database Engine, bukan Sekadar SQL Database</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-002.md">Part 002 — Connection Lifecycle, Session State, dan Pooling untuk Java Applications ➡️</a>
</div>
