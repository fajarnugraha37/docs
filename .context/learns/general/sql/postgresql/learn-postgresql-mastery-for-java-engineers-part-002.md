# learn-postgresql-mastery-for-java-engineers — Part 002

# Connection Lifecycle, Session State, dan Pooling untuk Java Applications

## Tujuan Bagian Ini

Bagian ini menjelaskan koneksi PostgreSQL sebagai lifecycle stateful. Dalam aplikasi Java, connection pool sering dianggap detail konfigurasi. Itu keliru. Pool adalah boundary antara request concurrency aplikasi dan concurrency database. Salah konfigurasi pool dapat menyebabkan latency spike, deadlock-like symptom, connection exhaustion, transaction leak, dan overload database.

## 1. Lifecycle Koneksi

Satu koneksi PostgreSQL biasanya melewati tahap:

```text
TCP connect
  -> optional TLS negotiation
  -> authentication
  -> startup parameters
  -> backend process/session created
  -> query/transaction execution
  -> idle/active state cycles
  -> disconnect
```

Koneksi bukan objek ringan seperti method call. Membuka koneksi baru melibatkan network, authentication, alokasi backend process, setup session, dan memory. Karena itu aplikasi Java hampir selalu memakai connection pool.

## 2. Session State

Session PostgreSQL menyimpan banyak state. Beberapa contoh:

- current transaction state,
- isolation level,
- read-only flag,
- search path,
- role,
- prepared statements,
- cursors,
- temp tables,
- advisory locks,
- session variables/GUC,
- LISTEN/NOTIFY state,
- timezone,
- statement timeout.

Jika koneksi dikembalikan ke pool tanpa reset state yang benar, request berikutnya bisa mewarisi state request sebelumnya. Ini dapat menjadi bug correctness, security, atau performance.

## 3. HikariCP Mental Model

HikariCP bukan hanya cache koneksi. Ia adalah concurrency governor. Parameter penting:

- `maximumPoolSize`,
- `minimumIdle`,
- `connectionTimeout`,
- `idleTimeout`,
- `maxLifetime`,
- `leakDetectionThreshold`,
- validation query/connection test,
- initialization SQL.

Kesalahan umum adalah menaikkan `maximumPoolSize` ketika aplikasi lambat. Jika database sudah saturasi, menaikkan pool justru menambah antrean di database, bukan menyelesaikan bottleneck.

## 4. Pool Sizing

Pool size harus dihitung dari workload, jumlah instance, CPU database, query latency, dan target throughput. Formula kasar:

```text
total potential connections = jumlah instance aplikasi x max pool per instance
```

Kemudian bandingkan dengan:

- `max_connections`,
- CPU core database,
- memory database,
- active query concurrency yang sehat,
- kebutuhan admin/maintenance connection,
- background worker,
- replica/failover behavior.

Top-tier engineer tidak bertanya “pool size berapa yang umum?”, tetapi “berapa concurrency database yang workload ini bisa serap tanpa latency collapse?”

## 5. Pool Exhaustion

Pool exhaustion terjadi ketika semua connection sedang dipakai dan thread aplikasi menunggu. Penyebabnya bisa:

- query lambat,
- lock wait,
- network call di dalam transaction,
- connection leak,
- pool terlalu kecil,
- pool terlalu besar tapi database saturasi,
- transaksi panjang,
- batch job memakai pool OLTP,
- connection validation lambat.

Gejala aplikasi:

- request timeout,
- Hikari timeout acquiring connection,
- latency p95/p99 naik,
- thread pool penuh,
- retry storm.

Diagnosis harus melihat dua sisi:

```text
Aplikasi: Hikari active/idle/pending, request latency, thread state
Database: pg_stat_activity, wait events, locks, slow query
```

## 6. Idle in Transaction

`idle in transaction` berarti transaksi terbuka tetapi tidak sedang menjalankan query. Ini berbahaya karena session masih dapat memegang snapshot dan lock.

Penyebab Java umum:

```java
@Transactional
public void handle() {
    repository.updateSomething();
    externalHttpClient.call(); // buruk jika lama
    repository.updateSomethingElse();
}
```

Selama HTTP call, transaksi tetap terbuka. Jika call lambat, database melihat session idle in transaction.

Prinsip:

- hitung data sebelum transaksi jika memungkinkan,
- buka transaksi sedekat mungkin dengan write,
- jangan menunggu user/network di dalam transaksi,
- gunakan timeout,
- pisahkan orchestration dari atomic persistence.

## 7. PgBouncer

PgBouncer adalah connection pooler eksternal. Mode utama:

### Session pooling

Client mendapat server connection selama session. Aman untuk session state, tetapi mengurangi multiplexing.

### Transaction pooling

Server connection dipinjam hanya selama transaksi. Lebih efisien untuk banyak koneksi aplikasi, tetapi session state tidak stabil.

Tidak aman diasumsikan untuk:

- session-level prepared statement,
- temp table lintas transaksi,
- session advisory lock,
- SET tanpa LOCAL,
- cursor lintas transaksi.

### Statement pooling

Lebih agresif dan jarang cocok untuk aplikasi kompleks.

## 8. Prepared Statement dan Pooling

JDBC prepared statement dapat berarti client-side object, server-side prepared statement, atau statement cache driver. PostgreSQL dapat memakai custom plan atau generic plan.

Dalam transaction pooling, server-side prepared statement dapat bermasalah karena statement dibuat pada satu backend tetapi transaksi berikutnya dapat memakai backend lain.

Konsekuensi desain:

- pahami pgJDBC prepare threshold,
- pahami statement cache,
- hindari asumsi session jika memakai PgBouncer transaction mode,
- monitor generic plan regression untuk query parameter-sensitive.

## 9. Timeout Layering

Timeout harus dibuat berlapis:

```text
client/request timeout
  > transaction timeout expectation
  > statement_timeout
  > lock_timeout untuk operasi sensitif
  > connection acquisition timeout
```

Kesalahan umum: aplikasi timeout duluan, tetapi query di database masih jalan. Ini menciptakan ghost workload.

## 10. Connection Leak

Connection leak terjadi ketika connection tidak dikembalikan ke pool. Dalam framework modern ini jarang karena try-with-resources atau transaction manager, tetapi masih mungkin akibat:

- manual JDBC salah,
- streaming result set tidak ditutup,
- transaction boundary custom,
- exception path tidak menutup resource,
- async code memakai connection lintas thread.

Gunakan leak detection sebagai alarm, bukan solusi utama.

## 11. Read-only dan Read Replica

Jika aplikasi memakai read replica, routing connection menjadi bagian correctness. Problem utama:

- read-after-write stale,
- replica lag,
- transaction read-only salah route,
- failover membuat endpoint berubah,
- prepared statement/cache invalid setelah reconnect.

Jangan route semua GET ke replica secara buta. Banyak GET membutuhkan read-your-write.

## 12. Batch Job Pool Separation

Batch job dan OLTP sebaiknya tidak selalu memakai pool yang sama. Batch dapat menghabiskan connection dan mengganggu request interaktif.

Strategi:

- pool terpisah,
- rate limit batch,
- chunking,
- `statement_timeout` berbeda,
- schedule di low-traffic window,
- observability label lewat `application_name`.

## 13. Checklist Konfigurasi Java

- Set `application_name`.
- Batasi `maximumPoolSize` berdasarkan total instance.
- Aktifkan metric Hikari.
- Gunakan timeout realistis.
- Jangan buka transaksi terlalu luas.
- Pisahkan pool OLTP dan batch jika perlu.
- Pahami PgBouncer mode sebelum mengaktifkan server-side prepared statements.
- Monitor `idle in transaction`.
- Sediakan reserved connection untuk admin.
- Uji behavior saat database restart/failover.

## 14. Diagnostic SQL

```sql
select application_name, state, count(*)
from pg_stat_activity
where datname = current_database()
group by application_name, state
order by count(*) desc;
```

```sql
select pid, application_name, state, now() - xact_start as xact_age, query
from pg_stat_activity
where state = 'idle in transaction'
order by xact_age desc;
```

```sql
select pid, wait_event_type, wait_event, state, query
from pg_stat_activity
where wait_event is not null
order by pid;
```

---

## Checklist Pemahaman

Setelah menyelesaikan bagian ini, kamu seharusnya mampu menjelaskan topik ini bukan hanya sebagai definisi, tetapi sebagai model kerja yang bisa dipakai saat mendesain, mendiagnosis, dan mengoperasikan sistem PostgreSQL produksi dari aplikasi Java.

## Hubungan ke Part Berikutnya

Bagian ini menjadi fondasi untuk bagian berikutnya dalam seri. Jangan hanya menghafal istilah; gunakan mental modelnya untuk membaca gejala produksi: latency naik, lock menumpuk, koneksi habis, query berubah plan, atau recovery/replication tidak berjalan sesuai ekspektasi.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Arsitektur Proses PostgreSQL: Backend Process, Shared Memory, dan Background Workers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-003.md">Part 003 — PostgreSQL Storage Model: Database, Tablespace, Relation, Fork, Page, Tuple ➡️</a>
</div>
