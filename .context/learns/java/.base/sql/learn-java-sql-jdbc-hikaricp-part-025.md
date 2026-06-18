# learn-java-sql-jdbc-hikaricp-part-025

# Failure Modes and Recovery Patterns

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `025 dari 029`  
> Topik: JDBC/HikariCP failure modes, database outage, stale connection, failover, timeout cascade, retry storm, dan recovery pattern  
> Level: Advanced / production engineering / architecture & reliability

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

1. JDBC sebagai boundary antara Java process dan database session.
2. `Connection` sebagai stateful session carrier.
3. Statement execution, ResultSet, type mapping, transaction, isolation, error handling.
4. Resource lifecycle dan DataSource.
5. Batch, LOB, metadata, stored procedure.
6. Performance model.
7. Connection pooling.
8. HikariCP architecture/configuration/pool sizing/timeout.
9. Observability JDBC dan korelasi aplikasi dengan database.

Part ini membahas pertanyaan yang lebih brutal:

> Apa yang terjadi ketika database, network, driver, pool, atau aplikasi mulai gagal sebagian?

Di production, JDBC jarang gagal secara bersih. Yang sering terjadi bukan sekadar:

```text
Database down -> aplikasi error.
```

Yang lebih sering terjadi:

```text
Database lambat -> pool penuh -> thread aplikasi menunggu -> request timeout -> retry dari client -> beban naik -> DB makin lambat -> pool makin penuh -> cascading failure.
```

Atau:

```text
Firewall/NAT membunuh idle TCP connection -> pool masih menyimpan connection yang tampak idle -> request berikutnya meminjam connection mati -> query gagal -> pool invalidasi -> spike error sementara.
```

Atau:

```text
Primary database failover -> DNS berubah -> koneksi lama masih mengarah ke primary lama -> beberapa koneksi stale -> beberapa query gagal -> retry tidak idempotent -> data inconsistency.
```

Part ini bertujuan membangun mental model failure dan recovery yang bisa dipakai untuk desain sistem production.

---

## 1. Prinsip Utama: JDBC Failure Bukan Satu Layer

Ketika operasi JDBC gagal, penyebabnya bisa berasal dari banyak layer:

```text
Application code
   ↓
Transaction manager / repository boundary
   ↓
Connection pool / HikariCP
   ↓
JDBC driver
   ↓
TCP socket / TLS / DNS
   ↓
Load balancer / proxy / firewall / NAT
   ↓
Database listener / protocol endpoint
   ↓
Database session
   ↓
Database transaction engine
   ↓
Storage / lock manager / redo / WAL / undo / temp / buffer cache
```

Karena itu, error yang terlihat di Java sering kali hanya gejala akhir.

Contoh:

```text
java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available, request timed out after 30000ms.
```

Error ini tidak otomatis berarti HikariCP bermasalah. Bisa jadi:

1. Query terlalu lambat.
2. Transaction terlalu lama.
3. Ada connection leak.
4. Database sedang lock storm.
5. DB worker exhausted.
6. Network lambat.
7. Pool terlalu kecil.
8. Pool terlalu besar dan membuat DB collapse.
9. Semua app replica menggandakan jumlah connection.
10. Request upstream retry storm.

Jadi failure analysis harus bertanya:

```text
Apakah pool habis karena connection tidak tersedia,
atau connection tidak tersedia karena database tidak menyelesaikan pekerjaan,
atau database tidak menyelesaikan pekerjaan karena aplikasi mengirim terlalu banyak pekerjaan?
```

---

## 2. Taxonomy Failure JDBC Production

Kita butuh klasifikasi agar recovery tidak asal retry.

### 2.1 Connection acquisition failure

Gagal mendapatkan connection dari pool.

Contoh gejala:

```text
HikariPool - Connection is not available, request timed out
SQLTransientConnectionException
pending threads naik
active connections = maximumPoolSize
idle connections = 0
```

Kemungkinan penyebab:

1. Pool exhaustion.
2. Query lambat.
3. Long transaction.
4. Connection leak.
5. DB tidak menerima koneksi baru.
6. Semua connection sedang stuck di socket read.
7. Thread aplikasi memegang connection terlalu lama.

### 2.2 Connection creation failure

Pool gagal membuat physical database connection baru.

Penyebab umum:

1. Database down.
2. Listener down.
3. Credential salah/expired.
4. Network unreachable.
5. DNS gagal.
6. TLS handshake gagal.
7. Database max connection tercapai.
8. Firewall/security group berubah.

### 2.3 Stale connection failure

Pool menyimpan connection yang sebelumnya valid, tetapi sekarang sudah tidak valid.

Penyebab:

1. DB restart.
2. Firewall idle timeout.
3. NAT idle timeout.
4. Load balancer idle timeout.
5. Database server menutup session idle.
6. Failover.
7. Network partition.

### 2.4 Statement execution failure

Connection berhasil dipinjam, statement gagal saat execute.

Penyebab:

1. SQL syntax error.
2. Constraint violation.
3. Lock timeout.
4. Deadlock.
5. Serialization failure.
6. Query timeout.
7. Socket read timeout.
8. DB killed session.
9. Permission revoked.

### 2.5 Commit/rollback failure

Statement terlihat berhasil, tetapi gagal saat commit atau rollback.

Ini sangat berbahaya karena outcome bisa ambigu.

Contoh:

```text
executeUpdate() succeeded
commit() threw SQLException because network connection dropped
```

Pertanyaan sulit:

```text
Apakah commit sudah diterima database tetapi response ke aplikasi hilang?
Atau commit belum sampai database?
```

Recovery tidak bisa sekadar retry transaction tanpa idempotency.

### 2.6 Data correctness failure

Tidak selalu muncul sebagai error teknis.

Contoh:

1. Duplicate insert karena retry.
2. Lost update.
3. Outbox event ter-publish sebelum commit.
4. Audit trail tidak sinkron dengan state change.
5. Partial side effect ke external system.
6. Retried stored procedure melakukan efek ganda.

### 2.7 Observability failure

Sistem gagal, tetapi kita tidak tahu kenapa.

Contoh:

1. Tidak ada metric active/idle/pending Hikari.
2. Tidak ada query latency distribution.
3. Tidak tahu SQLState/vendor code.
4. Log tidak punya correlation id.
5. Tidak bisa mapping request ke DB session.
6. Tidak tahu apakah error dari borrow timeout, query timeout, atau socket timeout.

Failure jenis ini memperpanjang MTTR.

---

## 3. Mental Model: Pool sebagai Shock Absorber, Bukan Tameng Mutlak

Connection pool bisa membantu menghadapi failure, tetapi bukan magic.

Pool membantu dengan:

1. Menghindari cost membuat koneksi untuk setiap request.
2. Membatasi concurrency ke database.
3. Menyediakan validation sebelum connection dipakai.
4. Menghapus connection yang sudah tua/rusak.
5. Memberi timeout saat borrow connection.
6. Menyediakan signal observability.

Pool tidak bisa:

1. Membuat database yang down menjadi up.
2. Menjamin transaction aman untuk di-retry.
3. Menghilangkan lock contention.
4. Menyelesaikan query lambat.
5. Mengoreksi pool sizing lintas banyak service.
6. Menebak semantic idempotency operasi bisnis.
7. Menjamin commit outcome ketika network putus di saat commit.

Jadi desain recovery harus berada di beberapa layer:

```text
Business idempotency
   ↓
Transaction boundary
   ↓
Retry classification
   ↓
Timeout budget
   ↓
Pool configuration
   ↓
Driver/network configuration
   ↓
Database HA/failover configuration
   ↓
Observability and runbook
```

---

## 4. Failure Mode 1: Database Restart

### 4.1 Apa yang terjadi

Saat database restart:

1. Existing physical connections biasanya terputus.
2. Database sessions hilang.
3. In-flight transactions rollback.
4. Connection idle di pool menjadi stale.
5. Pool mungkin baru sadar connection mati saat connection divalidasi atau dipakai.
6. New connection gagal sampai database listener siap.
7. Setelah DB up, pool mulai membuat koneksi baru.

### 4.2 Timeline tipikal

```text
T0  DB restart dimulai
T1  In-flight queries gagal
T2  Existing sockets putus atau menjadi half-open
T3  Hikari masih punya connection object lama
T4  Request meminjam connection
T5  Validation/execute gagal
T6  Hikari evict connection
T7  Pool mencoba create connection baru
T8  DB listener siap
T9  Pool pulih bertahap
```

### 4.3 Gejala di aplikasi

1. Spike `SQLException`.
2. `SQLRecoverableException` atau vendor-specific connection exception.
3. Hikari log gagal validate connection.
4. Active connection turun/naik tidak stabil.
5. Pending threads naik.
6. Error saat commit/rollback.

### 4.4 Prinsip recovery

Untuk database restart, recovery yang sehat adalah:

1. Invalidate connection rusak.
2. Allow pool create new connection.
3. Fail fast selama database belum siap.
4. Retry hanya untuk operasi yang aman.
5. Jangan infinite retry di request thread.
6. Jangan menganggap semua error bisa diulang.

### 4.5 HikariCP knobs relevan

1. `connectionTimeout`  
   Berapa lama thread aplikasi boleh menunggu connection dari pool.

2. `validationTimeout`  
   Berapa lama connection validation boleh berjalan.

3. `maxLifetime`  
   Umur maksimum connection di pool. Harus lebih pendek dari limit eksternal/infrastruktur.

4. `keepaliveTime`  
   Menjaga idle connection tetap tervalidasi sebelum digunakan, terutama jika ada infrastructure idle timeout.

5. `initializationFailTimeout`  
   Mengontrol apakah aplikasi fail-fast saat startup jika database tidak tersedia.

README HikariCP menjelaskan konfigurasi tersebut dan menekankan semua konfigurasi waktu memakai milidetik. HikariCP juga menyarankan `maxLifetime` dibuat beberapa detik lebih pendek dari batas connection lifetime yang dikenakan database/infrastruktur.

### 4.6 Anti-pattern

```java
while (true) {
    try {
        doDatabaseWork();
        break;
    } catch (SQLException e) {
        // dangerous infinite retry
    }
}
```

Masalah:

1. Tidak ada batas retry.
2. Tidak ada backoff.
3. Tidak ada klasifikasi error.
4. Bisa menggandakan write.
5. Bisa mempertahankan thread sampai habis.
6. Bisa memperparah recovery database.

---

## 5. Failure Mode 2: Primary Database Failover

### 5.1 Failover tidak sama dengan restart biasa

Pada failover:

1. Primary lama mungkin mati atau menjadi standby.
2. Primary baru dipromosikan.
3. Endpoint bisa berubah melalui DNS, proxy, cluster endpoint, atau listener.
4. Koneksi lama mungkin masih hidup secara TCP tetapi tidak valid untuk write.
5. Beberapa koneksi bisa mengarah ke node lama.
6. Replication lag bisa memengaruhi read-after-write.
7. Transaction in-flight biasanya hilang/rollback.

### 5.2 Failure yang bisa muncul

1. Connection reset.
2. Read-only transaction error saat menulis ke node lama/standby.
3. DNS masih resolve ke endpoint lama karena cache.
4. Socket connect timeout.
5. Authentication ulang gagal sementara.
6. Transaction outcome ambigu.
7. Duplicate operation karena retry.

### 5.3 Mengapa DNS penting

Banyak managed DB memakai endpoint DNS. Saat failover, DNS record bisa berubah.

Masalahnya:

1. JVM punya DNS cache.
2. OS punya DNS cache.
3. Driver/pool bisa menyimpan connection lama.
4. Network path/proxy bisa punya cache sendiri.
5. Existing TCP connection tidak otomatis pindah ke IP baru.

Konsekuensi:

```text
DB sudah failover secara infrastruktur,
tetapi aplikasi belum tentu langsung connect ke primary baru.
```

### 5.4 Recovery pattern

1. Pastikan stale connections tervalidasi dan di-evict.
2. Gunakan connection timeout yang bounded.
3. Gunakan socket/read timeout yang bounded.
4. Gunakan maxLifetime lebih pendek dari infrastructure rotation/idle kill.
5. Hindari retry write tanpa idempotency.
6. Gunakan idempotency key untuk command penting.
7. Untuk critical command, desain status reconciliation.
8. Observasi error SQLState/vendor code selama failover drill.

### 5.5 Failover drill checklist

Uji skenario berikut di non-production:

```text
[ ] Kill/restart primary database.
[ ] Force managed DB failover.
[ ] Jalankan traffic read/write sedang.
[ ] Catat jumlah error.
[ ] Catat durasi recovery.
[ ] Catat Hikari active/idle/pending/total.
[ ] Catat connection creation failure.
[ ] Catat query timeout vs socket timeout vs borrow timeout.
[ ] Verifikasi tidak ada duplicate business operation.
[ ] Verifikasi outbox/audit tetap konsisten.
[ ] Verifikasi aplikasi tidak perlu restart manual.
```

---

## 6. Failure Mode 3: DNS Change

### 6.1 Masalah inti

DNS change bisa terjadi karena:

1. DB failover.
2. Endpoint migration.
3. Private hosted zone update.
4. Service discovery change.
5. Disaster recovery switch.
6. Domain migration.

JDBC connection yang sudah dibuat tidak peduli DNS baru. Ia sudah punya socket ke alamat lama.

### 6.2 Gejala

1. Aplikasi masih connect ke IP lama.
2. Beberapa pod/instance pulih, beberapa tidak.
3. Restart aplikasi memperbaiki issue.
4. Error intermittent per replica.
5. Connection pool tetap berisi koneksi lama.

### 6.3 Recovery pattern

1. Pastikan TTL DNS masuk akal.
2. Pahami JVM DNS cache setting.
3. Gunakan `maxLifetime` agar koneksi lama akhirnya diganti.
4. Saat migration terencana, lakukan rolling restart bila perlu.
5. Untuk cutover kritis, drain connection pool/pod secara terkontrol.
6. Jangan mengandalkan DNS change untuk memindahkan existing connection.

### 6.4 Mental model

```text
DNS memengaruhi koneksi baru.
DNS tidak memindahkan koneksi lama.
Pool memperpanjang umur koneksi lama.
```

Karena itu, pool lifetime harus dipikirkan dalam desain cutover.

---

## 7. Failure Mode 4: Firewall/NAT/Load Balancer Idle Timeout

### 7.1 Apa yang terjadi

Infrastruktur jaringan sering menutup koneksi idle setelah periode tertentu:

1. Firewall idle timeout.
2. NAT gateway idle timeout.
3. Load balancer idle timeout.
4. Database server idle session timeout.
5. Proxy idle timeout.

Dari sisi aplikasi, connection object masih ada di pool. Tetapi socket di bawahnya bisa sudah mati.

### 7.2 Gejala klasik

Aplikasi lancar saat traffic tinggi, tetapi error setelah idle lama.

Contoh:

```text
Pagi hari request pertama gagal.
Setelah itu request berikutnya berhasil.
```

Atau:

```text
Setelah weekend idle, beberapa koneksi pertama gagal.
```

### 7.3 Konfigurasi relevan

1. HikariCP `maxLifetime`  
   Harus lebih pendek dari batas lifetime eksternal.

2. HikariCP `keepaliveTime`  
   Bisa menjaga idle connection tetap hidup/tervalidasi.

3. Driver socket timeout  
   Agar read tidak menggantung terlalu lama.

4. TCP keepalive  
   Berguna tetapi interval OS default sering terlalu lama untuk aplikasi.

5. Database-side idle timeout  
   Harus diketahui dan diselaraskan.

Dokumentasi pgJDBC memiliki parameter seperti `tcpKeepAlive`, `connectTimeout`, dan `socketTimeout`. MySQL Connector/J menyediakan `connectTimeout` dan `socketTimeout` dalam milidetik untuk connect dan operasi socket. Oracle JDBC juga memiliki properti connect/read timeout vendor-specific.

### 7.4 Rule of thumb

```text
Hikari maxLifetime < infrastructure connection lifetime
Hikari keepaliveTime < infrastructure idle timeout
Driver socketTimeout < application request timeout
Pool connectionTimeout < application request timeout
```

Bukan angka absolut yang penting, tetapi urutan dan hubungan antar timeout.

---

## 8. Failure Mode 5: Credential Rotation dan Password Expired

### 8.1 Apa yang terjadi

Credential rotation bisa memunculkan failure yang tidak langsung terlihat.

Skenario umum:

```text
T0  Pool punya 20 physical connections dengan credential lama.
T1  Password database dirotasi.
T2  Existing connections tetap hidup.
T3  Hikari perlu membuat connection baru.
T4  Jika app belum memakai password baru, create connection gagal.
T5  Lama-lama connection lama mati/retire.
T6  Pool tidak bisa refill.
T7  Aplikasi collapse bertahap.
```

### 8.2 Gejala

1. Existing traffic tetap jalan sementara.
2. Error muncul bertahap saat pool refill.
3. Connection creation failure.
4. Authentication failed.
5. Pool total connection menurun.
6. Pending threads naik.

### 8.3 Recovery pattern

1. Gunakan mekanisme secret rotation yang sinkron dengan aplikasi.
2. Rolling restart aplikasi setelah secret berubah, kecuali DataSource mendukung refresh credential aman.
3. Monitor connection creation error.
4. Hindari rotasi mendadak tanpa overlap period.
5. Untuk sistem penting, gunakan dual credential/overlap jika platform mendukung.
6. Uji credential rotation di non-prod.

### 8.4 Anti-pattern

```text
Mengganti password DB langsung,
tanpa restart/refresh aplikasi,
tanpa memonitor connection creation failure.
```

Ini sering terlihat aman karena existing connections masih hidup, tetapi pool perlahan kehilangan kemampuan pulih.

---

## 9. Failure Mode 6: Database Max Connection Reached

### 9.1 Penyebab

1. Terlalu banyak aplikasi/pod.
2. Setiap pod punya pool terlalu besar.
3. Job/background worker memakai pool terpisah tanpa budget.
4. Leak connection.
5. Admin tools/reporting membuka banyak session.
6. Database process/session limit terlalu kecil.
7. Failover membuat connection reconnect storm.

### 9.2 Rumus dasar

```text
Total possible app connections = replicas × maximumPoolSize per replica
```

Jika ada banyak service:

```text
Total DB pressure = Σ(service replicas × service pool max)
                  + batch jobs
                  + admin sessions
                  + migration tools
                  + monitoring sessions
                  + safety margin
```

### 9.3 Gejala

1. New connection refused.
2. Authentication succeeds but session creation fails.
3. Pool cannot fill.
4. Hikari connection creation error.
5. DB shows max sessions/processes reached.

### 9.4 Recovery pattern

1. Turunkan pool size per replica.
2. Kurangi replica sementara jika perlu.
3. Pisahkan OLTP dan batch/reporting pool.
4. Batasi concurrency job.
5. Tambah DB connection limit hanya jika DB resource cukup.
6. Implement global connection budgeting lintas service.
7. Saat autoscaling, perhitungkan connection multiplication.

### 9.5 Kesalahan umum

```text
Pool timeout terjadi -> maximumPoolSize dinaikkan.
```

Kadang benar, tetapi sering salah. Jika database sudah saturated, menaikkan pool memperbesar concurrency dan memperparah.

---

## 10. Failure Mode 7: Lock Storm

### 10.1 Apa itu lock storm

Lock storm terjadi ketika banyak transaction saling menunggu lock pada row/table/index/resource yang sama.

Contoh:

1. Semua request update row counter yang sama.
2. Workflow state transition berebut case yang sama.
3. Batch job update banyak row dengan urutan berbeda dari OLTP.
4. Long transaction memegang lock terlalu lama.
5. Missing index membuat update/delete scan dan lock lebih luas.

### 10.2 Gejala dari sisi JDBC

1. Query terlihat lambat.
2. Pool active penuh.
3. Database CPU mungkin tidak tinggi.
4. Banyak session wait lock.
5. Lock timeout/deadlock error.
6. Request timeout.
7. Retry memperparah lock contention.

### 10.3 Recovery pattern

1. Identifikasi blocker session.
2. Kurangi transaction duration.
3. Pastikan index mendukung predicate update/delete.
4. Gunakan consistent locking order.
5. Gunakan optimistic locking/version column untuk workflow tertentu.
6. Gunakan `SELECT ... FOR UPDATE SKIP LOCKED` untuk worker queue jika database mendukung.
7. Pisahkan batch dan OLTP window.
8. Retry deadlock dengan backoff dan jitter.
9. Jangan retry lock timeout secara agresif tanpa mengurangi contention.

### 10.4 Regulatory workflow example

Misalnya command:

```text
Approve Case
```

Operasi:

```text
1. Load case by id.
2. Validate current state = PENDING_REVIEW.
3. Update state to APPROVED.
4. Insert audit trail.
5. Insert outbox event.
6. Commit.
```

Failure jika dua officer approve/reject case yang sama:

```text
Officer A: PENDING_REVIEW -> APPROVED
Officer B: PENDING_REVIEW -> REJECTED
```

Desain aman:

```sql
UPDATE case_file
SET state = ?, version = version + 1
WHERE id = ?
  AND state = ?
  AND version = ?
```

Jika update count = 0:

```text
Bukan database failure.
Itu domain conflict / stale command.
Jangan retry buta.
Return conflict ke caller.
```

---

## 11. Failure Mode 8: Deadlock Storm

### 11.1 Deadlock

Deadlock terjadi ketika transaction A menunggu resource yang dipegang B, sementara B menunggu resource yang dipegang A.

Contoh:

```text
Tx A: lock row 1 -> lock row 2
Tx B: lock row 2 -> lock row 1
```

Database biasanya mendeteksi dan membatalkan salah satu transaction.

### 11.2 JDBC behavior

Dari sisi aplikasi:

1. Statement atau commit bisa throw `SQLException`.
2. SQLState/vendor code tergantung database.
3. Transaction harus dianggap gagal.
4. Connection harus rollback sebelum digunakan lagi.

### 11.3 Recovery

Deadlock sering termasuk retriable, tetapi hanya jika operasi idempotent atau transaction dapat diulang dari awal dengan aman.

Pattern:

```java
for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        return runWholeTransaction();
    } catch (SQLException e) {
        if (!isDeadlock(e) || attempt == maxAttempts) {
            throw e;
        }
        sleep(backoffWithJitter(attempt));
    }
}
```

Syarat penting:

1. Retry seluruh transaction, bukan statement terakhir saja.
2. Pastikan transaction sebelumnya rollback.
3. Pastikan side effect eksternal belum dilakukan sebelum commit.
4. Gunakan backoff + jitter.
5. Batasi attempt.

### 11.4 Pencegahan

1. Lock rows dalam urutan konsisten.
2. Perpendek transaction.
3. Hindari user interaction di dalam transaction.
4. Hindari memproses batch besar dalam satu transaction jika mengunci banyak row.
5. Pastikan index mencegah scan luas.

---

## 12. Failure Mode 9: Slow Query Cascade

### 12.1 Cascade chain

```text
Query latency naik
   ↓
Connection held lebih lama
   ↓
Active connections naik
   ↓
Pool idle turun
   ↓
Pending threads naik
   ↓
Request latency naik
   ↓
Client timeout
   ↓
Client retry
   ↓
Traffic naik
   ↓
DB makin lambat
```

### 12.2 Mengapa berbahaya

Slow query tidak hanya membuat request yang bersangkutan lambat. Ia memegang connection lebih lama, sehingga request lain tidak bisa meminjam connection.

Ini membuat pool menjadi amplifier dari database latency.

### 12.3 Recovery pattern

1. Pasang query timeout/database statement timeout.
2. Pasang request timeout.
3. Gunakan circuit breaker untuk mencegah retry storm.
4. Pisahkan pool untuk reporting/long query.
5. Optimasi query/index.
6. Batasi result set.
7. Gunakan pagination/keyset pagination.
8. Gunakan read replica untuk query read-heavy bila sesuai.
9. Reject request lebih awal saat pool pending tinggi.

### 12.4 Observability wajib

Minimal pantau:

```text
Hikari active connections
Hikari idle connections
Hikari pending threads
Connection acquisition time
Connection usage time
Query latency p95/p99
DB active sessions
DB wait events
Slow SQL fingerprint
```

---

## 13. Failure Mode 10: Connection Leak Cascade

### 13.1 Apa itu leak

Connection leak terjadi ketika aplikasi meminjam connection tetapi tidak mengembalikannya ke pool.

Penyebab:

1. Tidak memakai try-with-resources.
2. Exception path tidak close.
3. ResultSet/Statement dikembalikan keluar boundary.
4. Manual transaction path lupa close.
5. Async callback memegang connection.
6. Deadlock/thread stuck sambil memegang connection.

### 13.2 Gejala

1. Active connection naik sampai max.
2. Idle connection turun ke 0.
3. Pending threads naik.
4. DB mungkin tidak terlalu sibuk.
5. Restart aplikasi memperbaiki sementara.
6. Hikari leak detection log muncul jika dikonfigurasi.

### 13.3 Recovery

Immediate:

1. Restart instance/pod yang leak jika sudah parah.
2. Turunkan traffic.
3. Kill long idle-in-transaction session jika aman.

Permanent:

1. Try-with-resources di semua path.
2. Static analysis/code review.
3. Hikari `leakDetectionThreshold` di non-prod/staging atau production dengan hati-hati.
4. Track connection usage time.
5. Hindari API yang mengembalikan lazy stream berbasis ResultSet tanpa ownership jelas.

---

## 14. Failure Mode 11: Retry Storm

### 14.1 Retry storm

Retry storm terjadi ketika banyak client/service mengulang request saat dependency sedang lambat/down, sehingga beban meningkat justru saat sistem paling lemah.

```text
DB degraded
   ↓
App request timeout
   ↓
Client retry
   ↓
More app requests
   ↓
More DB pressure
   ↓
DB further degraded
```

### 14.2 Penyebab

1. Retry tanpa backoff.
2. Retry terlalu banyak layer.
3. Retry write tanpa idempotency.
4. Timeout terlalu panjang sehingga retry overlap.
5. Tidak ada circuit breaker.
6. Tidak ada rate limiting.
7. Queue tidak bounded.

### 14.3 Recovery pattern

1. Retry hanya untuk classified transient failure.
2. Gunakan exponential backoff + jitter.
3. Batasi max attempts.
4. Gunakan circuit breaker.
5. Gunakan idempotency key untuk command write.
6. Hindari retry di semua layer sekaligus.
7. Gunakan admission control.
8. Return failure cepat saat DB unhealthy.

### 14.4 Rule penting

```text
Retry is load.
```

Retry bukan gratis. Setiap retry adalah traffic tambahan ke sistem yang mungkin sedang tidak sehat.

---

## 15. Failure Mode 12: Ambiguous Commit Outcome

### 15.1 Ini salah satu failure paling sulit

Skenario:

```java
connection.setAutoCommit(false);

insertOrder(connection, command);
insertAudit(connection, command);

connection.commit(); // throws SQLException due to network error
```

Pertanyaan:

```text
Apakah database sudah commit tetapi response hilang?
Atau commit belum diterima database?
```

Aplikasi tidak selalu bisa tahu.

### 15.2 Kenapa retry berbahaya

Jika aplikasi retry seluruh command:

```text
Kemungkinan 1: commit pertama gagal total -> retry benar.
Kemungkinan 2: commit pertama sukses tapi response hilang -> retry membuat duplicate.
```

### 15.3 Recovery pattern

Untuk operasi penting:

1. Gunakan business idempotency key.
2. Simpan command id unik di database.
3. Gunakan unique constraint pada idempotency key.
4. Setelah ambiguous failure, lakukan reconciliation/read-back.
5. Jangan langsung mengirim external side effect sebelum commit.
6. Gunakan outbox pattern untuk event setelah commit.

Contoh tabel idempotency:

```sql
CREATE TABLE command_deduplication (
    command_id      VARCHAR(100) PRIMARY KEY,
    aggregate_id    VARCHAR(100) NOT NULL,
    command_type    VARCHAR(100) NOT NULL,
    result_status   VARCHAR(50)  NOT NULL,
    created_at      TIMESTAMP    NOT NULL
);
```

Saat retry dengan `command_id` sama:

```text
Jika command_id sudah ada, jangan jalankan side effect lagi.
Return status/result sebelumnya atau lakukan reconciliation.
```

---

## 16. Failure Mode 13: Pool Filled with Dead Connections

### 16.1 Apa yang terjadi

Pool terlihat punya banyak idle connection, tetapi banyak di antaranya sudah mati.

```text
Hikari total = 20
Hikari idle = 20
Tetapi database sudah restart / firewall kill idle socket
```

Saat traffic datang:

```text
Borrow connection -> validation/execute gagal -> evict -> create new connection
```

### 16.2 Dampak

1. Request pertama setelah outage/idle gagal.
2. Latency spike saat pool refill.
3. Connection creation storm.
4. Error intermittent.

### 16.3 Mitigasi

1. `keepaliveTime` untuk idle connection.
2. `maxLifetime` lebih pendek dari external kill.
3. Driver socket/connect timeout bounded.
4. Validation timeout pendek.
5. Warmup setelah planned restart jika perlu.
6. Avoid huge `minimumIdle` jika DB sulit menerima reconnect storm.

---

## 17. Failure Mode 14: Long GC Pause / JVM Stall

### 17.1 Kenapa ini relevan ke JDBC

Jika JVM pause lama:

1. Request thread berhenti.
2. Connection yang sedang dipakai tetap held.
3. Transaction tetap open di DB.
4. DB lock bisa tertahan.
5. Socket heartbeat/keepalive aplikasi tertunda.
6. Hikari housekeeper bisa mendeteksi thread starvation/clock leap.

### 17.2 Gejala

1. Hikari housekeeper warning.
2. Connection usage time spike.
3. Transaction duration spike.
4. Lock wait di DB.
5. Request timeout serentak.
6. Setelah pause, banyak request mencoba lanjut bersamaan.

### 17.3 Recovery/mitigasi

1. Monitor GC pause.
2. Monitor connection usage time.
3. Gunakan request timeout.
4. Hindari transaction panjang.
5. Pastikan DB lock timeout masuk akal.
6. Jangan sizing pool berdasarkan asumsi JVM selalu responsive.

---

## 18. Recovery Pattern 1: Error Classification

Jangan treat semua `SQLException` sama.

Klasifikasi minimal:

```text
Syntax/configuration error      -> non-retryable
Constraint/business conflict    -> non-retryable or domain handling
Deadlock                        -> retryable transaction-level with backoff
Serialization failure           -> retryable transaction-level with backoff
Lock timeout                    -> maybe retryable, depends on command
Connection failure              -> maybe retryable if idempotent
Query timeout                   -> maybe retryable, but investigate load
Pool acquisition timeout        -> usually backpressure, not blind retry
Authentication failure          -> non-retryable until config fixed
Permission failure              -> non-retryable until privilege fixed
Ambiguous commit                -> reconciliation/idempotency, not blind retry
```

Java menyediakan subclass `SQLException` seperti `SQLTransientException`, `SQLNonTransientException`, dan `SQLRecoverableException`, tetapi driver behavior tidak boleh dipercaya buta. Tetap gunakan SQLState/vendor code per database.

---

## 19. Recovery Pattern 2: Transaction-Level Retry

Retry yang benar untuk deadlock/serialization failure adalah mengulang seluruh transaction.

### 19.1 Salah

```java
try {
    statement.executeUpdate(updateA);
    statement.executeUpdate(updateB); // deadlock here
    connection.commit();
} catch (SQLException e) {
    statement.executeUpdate(updateB); // wrong: transaction state already failed
    connection.commit();
}
```

### 19.2 Benar secara struktur

```java
public <T> T executeRetriableTransaction(SqlWork<T> work) throws SQLException {
    int maxAttempts = 3;

    for (int attempt = 1; attempt <= maxAttempts; attempt++) {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);

            try {
                T result = work.execute(connection);
                connection.commit();
                return result;
            } catch (SQLException | RuntimeException e) {
                safeRollback(connection);
                throw e;
            }
        } catch (SQLException e) {
            if (!isRetriableTransactionFailure(e) || attempt == maxAttempts) {
                throw e;
            }
            sleepWithJitter(attempt);
        }
    }

    throw new IllegalStateException("unreachable");
}
```

### 19.3 Syarat

1. Work harus idempotent atau dilindungi idempotency key.
2. Tidak boleh ada external side effect sebelum commit.
3. Retry harus bounded.
4. Retry harus pakai backoff.
5. Observability harus mencatat attempt.

---

## 20. Recovery Pattern 3: Idempotency Key

Untuk command write penting, idempotency key adalah fondasi.

Contoh command:

```json
{
  "commandId": "APPROVE-CASE-2026-000001",
  "caseId": "CASE-123",
  "action": "APPROVE",
  "actor": "officer-a"
}
```

Database constraint:

```sql
ALTER TABLE case_command_log
ADD CONSTRAINT uk_case_command_id UNIQUE (command_id);
```

Flow:

```text
1. Begin transaction.
2. Insert command_id ke command log.
3. Jika duplicate, baca result sebelumnya.
4. Apply state transition.
5. Insert audit.
6. Insert outbox event.
7. Commit.
```

Idempotency key membantu menghadapi:

1. Client retry.
2. Network failure.
3. Ambiguous commit outcome.
4. Duplicate message delivery.
5. Operator resubmit.

---

## 21. Recovery Pattern 4: Circuit Breaker dan Admission Control

### 21.1 Kenapa perlu

Jika database sedang down/lambat, membiarkan semua request masuk hanya memperparah.

Circuit breaker membantu:

1. Fail fast.
2. Mengurangi pressure ke DB.
3. Memberi waktu recovery.
4. Mengurangi thread/pool exhaustion.

Admission control membantu:

1. Membatasi request yang boleh masuk ke DB path.
2. Menolak lebih awal saat sistem penuh.
3. Menjaga latency tail.

### 21.2 Signal yang bisa dipakai

1. Hikari pending threads tinggi.
2. Connection acquisition timeout rate naik.
3. DB connection creation failure rate naik.
4. Query timeout rate naik.
5. Error SQLState connection class naik.
6. DB health check gagal.

### 21.3 Anti-pattern

```text
Health endpoint selalu UP selama JVM hidup,
walaupun pool pending penuh dan semua DB calls timeout.
```

Health harus membedakan:

1. Liveness: process masih hidup.
2. Readiness: instance siap menerima traffic.
3. Dependency health: database path sehat atau degraded.

---

## 22. Recovery Pattern 5: Bulkhead by Pool

Satu pool untuk semua workload bisa membuat query berat menghancurkan OLTP.

### 22.1 Masalah

```text
Reporting query lambat memakai 20 connection.
OLTP request tidak dapat connection.
Seluruh aplikasi dianggap down.
```

### 22.2 Solusi

Pisahkan pool:

```text
oltpDataSource       maximumPoolSize = 10
reportingDataSource  maximumPoolSize = 3
batchDataSource      maximumPoolSize = 2
```

Atau pisahkan service.

### 22.3 Trade-off

Kelebihan:

1. Isolasi failure.
2. OLTP lebih terlindungi.
3. Budget connection lebih jelas.
4. Query lambat tidak menghabiskan semua pool.

Kekurangan:

1. Konfigurasi lebih kompleks.
2. Total connection budget harus dihitung.
3. Transaction lintas pool harus dihindari atau didesain khusus.

---

## 23. Recovery Pattern 6: Graceful Degradation

Tidak semua fitur harus mati saat database bermasalah.

Contoh:

1. Read-only cache bisa tetap melayani data lama.
2. Non-critical audit enrichment bisa ditunda.
3. Report generation bisa masuk queue.
4. Search index update bisa retry async.
5. Dashboard bisa tampil degraded mode.

Tetapi hati-hati:

```text
Core transactional write tidak boleh pura-pura sukses jika DB gagal.
```

Graceful degradation harus eksplisit, bukan menyembunyikan failure.

---

## 24. Recovery Pattern 7: Outbox untuk Side Effect Setelah Commit

### 24.1 Masalah klasik

```text
1. Update DB state.
2. Send message to external system.
3. Commit DB.
```

Jika message berhasil tetapi commit gagal, external system percaya state berubah padahal DB tidak.

Atau:

```text
1. Update DB state.
2. Commit DB.
3. Send message.
```

Jika commit berhasil tetapi message gagal, DB berubah tetapi event hilang.

### 24.2 Outbox pattern

Di dalam transaction yang sama:

```text
1. Update domain table.
2. Insert audit table.
3. Insert outbox_event table.
4. Commit.
```

Worker terpisah:

```text
1. Poll outbox_event.
2. Publish event.
3. Mark published.
```

Keuntungan:

1. State change dan event intent atomic di DB.
2. Retry publish tidak mengulang domain transaction.
3. Recovery lebih mudah.
4. Audit lebih defensible.

---

## 25. Startup Failure Policy

### 25.1 Pertanyaan desain

Jika aplikasi startup saat database down, apakah aplikasi harus:

1. Gagal start?
2. Start tetapi tidak ready?
3. Start penuh dan gagal saat request?

Jawabannya tergantung sistem.

### 25.2 Untuk service OLTP DB-dependent

Biasanya lebih aman:

```text
Process boleh start,
tetapi readiness harus DOWN sampai DB reachable dan migration/validation selesai.
```

### 25.3 HikariCP initialization

`initializationFailTimeout` memengaruhi apakah pool mencoba fail fast saat startup. Untuk sistem yang harus memastikan DB reachable sebelum ready, fail-fast atau readiness gating perlu dipikirkan.

### 25.4 Anti-pattern Kubernetes

```text
Pod dianggap ready sebelum DataSource benar-benar bisa connect.
Traffic masuk.
Semua request gagal.
Autoscaler menambah pod.
Semua pod gagal connect.
DB kena reconnect storm.
```

---

## 26. Connection Validation Strategy

### 26.1 JDBC `isValid()`

JDBC menyediakan `Connection.isValid(timeout)` untuk validasi connection jika driver mendukung dengan baik.

HikariCP umumnya merekomendasikan tidak memakai `connectionTestQuery` jika driver mendukung JDBC4 `isValid()`.

### 26.2 `connectionTestQuery`

Dipakai jika driver lama/tidak mendukung `isValid()` dengan benar.

Contoh:

```sql
SELECT 1
```

Namun query validasi:

1. Menambah round-trip.
2. Bisa membebani DB jika terlalu sering.
3. Harus valid untuk database target.
4. Tidak menjamin transaksi bisnis berikutnya akan berhasil.

### 26.3 Validation bukan silver bullet

Connection bisa valid saat dicek, lalu mati beberapa milidetik kemudian.

Jadi validation mengurangi risiko, bukan menghapus failure.

---

## 27. Timeout Budget untuk Recovery

Timeout yang tidak selaras membuat recovery buruk.

Contoh buruk:

```text
HTTP request timeout       = 5s
Hikari connectionTimeout   = 30s
Driver socketTimeout       = 0 / infinite
DB statement timeout       = none
```

Dampak:

1. Client sudah menyerah setelah 5s.
2. Server thread masih menunggu connection/query.
3. Connection bisa tetap dipakai untuk pekerjaan yang hasilnya tidak lagi dibutuhkan.
4. Pool penuh oleh pekerjaan zombie.

Contoh lebih sehat:

```text
HTTP request timeout       = 10s
Admission control budget   = immediate/bounded
Hikari connectionTimeout   = 200ms - 1000ms for OLTP under pressure
DB lock timeout            = 1s - 3s depending command
Statement/query timeout    = 3s - 8s depending endpoint
Driver socketTimeout       = slightly below/around request budget depending semantics
Transaction timeout        = below request timeout
```

Angka harus diuji, bukan disalin. Yang penting: setiap layer punya batas.

---

## 28. Incident Diagnosis Playbook

Saat ada JDBC outage, jangan langsung ubah pool size.

### 28.1 Pertanyaan pertama

```text
Apakah failure terjadi saat:
1. Borrow connection dari pool?
2. Create physical connection?
3. Validate existing connection?
4. Execute statement?
5. Fetch result?
6. Commit/rollback?
```

### 28.2 Data yang perlu dikumpulkan

Application side:

```text
[ ] Hikari active/idle/total/pending.
[ ] Connection acquisition latency.
[ ] Connection usage duration.
[ ] Error rate by exception class.
[ ] SQLState/vendor code.
[ ] Query latency by SQL fingerprint.
[ ] Request latency and timeout.
[ ] Retry count.
[ ] Thread dump if stuck.
[ ] GC pause.
```

Database side:

```text
[ ] Active sessions.
[ ] Wait events.
[ ] Locks/blockers.
[ ] Deadlocks.
[ ] Slow SQL.
[ ] CPU/IO utilization.
[ ] Connection/session count.
[ ] Transaction age.
[ ] Idle in transaction.
[ ] Temp/undo/WAL/redo pressure.
```

Infrastructure side:

```text
[ ] DNS changes.
[ ] Firewall/security group changes.
[ ] NAT/load balancer idle timeout.
[ ] DB failover event.
[ ] Network packet loss/latency.
[ ] Credential/secret rotation.
[ ] Pod/node restart.
```

### 28.3 Decision tree ringkas

```text
Pool pending high?
  ├─ active == max and DB busy/waiting?
  │    ├─ Query slow/lock wait -> fix query/lock/reduce concurrency
  │    └─ Connection held long -> check transaction/leak
  ├─ active == max and DB not busy?
  │    └─ suspect leak/thread stuck
  └─ total < max?
       └─ connection creation failure / DB max sessions / auth / network
```

---

## 29. Case Study 1: Request Pertama Pagi Hari Gagal

### 29.1 Gejala

```text
Setiap pagi, beberapa request pertama gagal.
Setelah itu aplikasi normal.
```

### 29.2 Kemungkinan penyebab

1. Idle DB connection ditutup firewall/NAT.
2. Pool menyimpan stale idle connection.
3. Validasi tidak terjadi sebelum use.
4. `maxLifetime` lebih panjang dari infra idle timeout.
5. `keepaliveTime` tidak aktif.

### 29.3 Perbaikan

1. Ketahui infra idle timeout.
2. Set `maxLifetime` lebih pendek dari lifetime eksternal.
3. Aktifkan `keepaliveTime` jika perlu.
4. Pastikan validation timeout bounded.
5. Monitor failed validation.

---

## 30. Case Study 2: Scale Up Kubernetes Membuat DB Down

### 30.1 Gejala

```text
Aplikasi scale dari 5 pod ke 30 pod.
Setiap pod maximumPoolSize=20.
DB max sessions=400.
Tiba-tiba banyak connection refused.
```

### 30.2 Analisis

```text
5 × 20  = 100 possible app connections
30 × 20 = 600 possible app connections
```

Belum termasuk service lain, admin, migration, monitoring.

### 30.3 Perbaikan

1. Hitung global DB connection budget.
2. Turunkan pool per pod.
3. Gunakan autoscaling dengan DB connection awareness.
4. Pisahkan job/batch.
5. Tambah DB capacity hanya jika bottleneck memang connection worker, bukan query/lock.

---

## 31. Case Study 3: Deadlock Saat Batch dan OLTP Bersamaan

### 31.1 Gejala

```text
Batch housekeeping berjalan siang hari.
OLTP update case mulai banyak deadlock.
```

### 31.2 Penyebab

1. Batch update banyak row.
2. OLTP update row sama.
3. Urutan lock berbeda.
4. Transaction batch terlalu besar.
5. Index kurang mendukung predicate.

### 31.3 Perbaikan

1. Jalankan batch di window rendah traffic.
2. Pecah batch menjadi chunk kecil.
3. Gunakan ordering konsisten.
4. Tambah index yang tepat.
5. Batasi pool/concurrency batch.
6. Retry deadlock dengan backoff.

---

## 32. Case Study 4: Credential Rotation Membuat Error Bertahap

### 32.1 Gejala

```text
Setelah password DB diganti, aplikasi tetap normal 20 menit.
Lalu error connection creation muncul.
Akhirnya pool habis.
```

### 32.2 Analisis

Existing connections masih hidup. Saat Hikari retire/create new connection, credential lama gagal.

### 32.3 Perbaikan

1. Rotasi secret dengan overlap.
2. Rolling restart app setelah secret update.
3. Monitor connection creation failure.
4. Uji rotasi di staging.

---

## 33. Case Study 5: Commit Error dan Duplicate Command

### 33.1 Gejala

```text
User submit approval.
App timeout saat commit.
User retry.
Case punya dua audit entry dan dua notification.
```

### 33.2 Analisis

Commit pertama kemungkinan berhasil tetapi response hilang. Retry menjalankan command kedua kali.

### 33.3 Perbaikan

1. Idempotency key per command.
2. Unique constraint command id.
3. Outbox event.
4. Reconciliation read after ambiguous failure.
5. UI/client retry memakai command id sama.

---

## 34. Pattern Summary

| Failure | Retry? | Primary Pattern |
|---|---:|---|
| Syntax error | No | Fix code/config |
| Constraint violation | Usually no | Domain handling |
| Deadlock | Yes, bounded | Retry whole transaction with backoff |
| Serialization failure | Yes, bounded | Retry whole transaction with backoff |
| Lock timeout | Maybe | Reduce contention, maybe retry |
| Pool acquisition timeout | Usually no blind retry | Backpressure/admission control |
| Connection creation failure | Maybe | Fail fast, retry with backoff, circuit breaker |
| Stale connection | Usually pool handles after failure | Validate/evict/keepalive/maxLifetime |
| DB restart | Maybe for idempotent operations | Bounded retry + recovery wait |
| Failover | Maybe | Idempotency + stale connection eviction |
| Ambiguous commit | No blind retry | Reconciliation + idempotency |
| Auth failure | No | Fix credential/rotation |
| Max DB connections | No | Connection budget/pool sizing |
| Slow query cascade | No blind retry | Timeout, optimize, isolate, shed load |

---

## 35. Practical Configuration Heuristics

### 35.1 HikariCP

```properties
# Example only. Must be tuned per system.
hikari.maximumPoolSize=10
hikari.minimumIdle=10
hikari.connectionTimeout=1000
hikari.validationTimeout=1000
hikari.idleTimeout=600000
hikari.maxLifetime=1740000
hikari.keepaliveTime=300000
hikari.leakDetectionThreshold=0
```

Interpretation:

1. `maximumPoolSize`: DB concurrency budget per instance.
2. `connectionTimeout`: fail fast when pool exhausted.
3. `validationTimeout`: avoid validation hang.
4. `maxLifetime`: retire before infrastructure kills connection.
5. `keepaliveTime`: keep idle connection from going stale.
6. `leakDetectionThreshold`: use carefully; better for debugging/staging unless production overhead/log volume understood.

### 35.2 Driver

PostgreSQL example:

```text
connectTimeout=3
socketTimeout=10
tcpKeepAlive=true
```

MySQL example:

```text
connectTimeout=3000
socketTimeout=10000
```

Oracle example conceptually:

```text
oracle.net.CONNECT_TIMEOUT / connect_timeout
oracle.jdbc.ReadTimeout / read timeout property
```

Names and units differ per driver. Always verify official driver documentation.

---

## 36. Production Readiness Checklist

### 36.1 Pool and connection

```text
[ ] maximumPoolSize calculated per replica and globally.
[ ] minimumIdle intentionally configured or left default intentionally.
[ ] connectionTimeout shorter than request timeout.
[ ] validationTimeout bounded.
[ ] maxLifetime shorter than infrastructure/database connection lifetime.
[ ] keepaliveTime considered for idle network kill.
[ ] connection creation failures monitored.
[ ] pending threads monitored.
```

### 36.2 Transaction

```text
[ ] Every manual transaction commits or rollbacks explicitly.
[ ] Rollback is attempted on exception.
[ ] Transaction duration measured.
[ ] No user/external network wait inside DB transaction.
[ ] No connection crosses thread boundary casually.
[ ] Retriable transaction failures retry whole transaction.
```

### 36.3 Retry and idempotency

```text
[ ] Retry classification exists.
[ ] Retry has max attempts.
[ ] Retry has backoff and jitter.
[ ] Writes have idempotency key where needed.
[ ] Ambiguous commit has reconciliation path.
[ ] External side effects use outbox or equivalent.
```

### 36.4 Timeout

```text
[ ] Pool borrow timeout defined.
[ ] Query/statement timeout defined where appropriate.
[ ] Driver connect timeout defined.
[ ] Driver socket/read timeout defined.
[ ] DB lock timeout considered.
[ ] Request timeout aligned with DB timeout budget.
```

### 36.5 Observability

```text
[ ] Hikari metrics exported.
[ ] Slow query fingerprints available.
[ ] SQLState/vendor code logged safely.
[ ] Correlation ID propagated.
[ ] DB session/application name available where supported.
[ ] DB wait/lock monitoring available.
[ ] Dashboards distinguish pool exhaustion vs DB execution slowness.
```

### 36.6 Failure drills

```text
[ ] DB restart tested.
[ ] DB failover tested.
[ ] DNS change tested.
[ ] Credential rotation tested.
[ ] Stale idle connection tested.
[ ] Lock/deadlock scenario tested.
[ ] Pool exhaustion tested.
[ ] Slow query cascade tested.
```

---

## 37. Mental Model Final

JDBC recovery yang matang tidak dimulai dari pertanyaan:

```text
Berapa kali kita retry SQLException?
```

Pertanyaan yang benar:

```text
Failure terjadi di layer mana?
Apakah transaction outcome diketahui?
Apakah operasi aman diulang?
Apakah retry akan membantu atau memperparah?
Apakah pool sedang melindungi database atau justru menutupi bottleneck?
Apakah timeout antar layer selaras?
Apakah kita punya observability untuk membuktikan penyebabnya?
```

Top 1% engineer tidak hanya tahu cara memakai JDBC API. Ia tahu bahwa JDBC adalah titik temu antara:

1. Java thread/request lifecycle.
2. Pool concurrency control.
3. Driver protocol behavior.
4. Network timeout.
5. Database session state.
6. Transaction correctness.
7. Business idempotency.
8. Production recovery.

Failure handling yang benar bukan sekadar `catch SQLException`. Ia adalah desain sistem.

---

## 38. Referensi

Referensi yang relevan untuk part ini:

1. Java SE API Documentation — `java.sql.Connection`, `SQLException`, `Statement`, `DataSource`.
2. HikariCP README — configuration, timeout properties, metrics, leak detection, `maxLifetime`, `keepaliveTime`, `connectionTimeout`, `validationTimeout`.
3. HikariCP Wiki — About Pool Sizing.
4. PostgreSQL JDBC Documentation — connection parameters such as `connectTimeout`, `socketTimeout`, `tcpKeepAlive`, cancellation behavior.
5. PostgreSQL Documentation — transaction isolation, deadlocks, serialization failures, SQLSTATE.
6. MySQL Connector/J Developer Guide — networking properties such as `connectTimeout` and `socketTimeout`.
7. Oracle JDBC Documentation — Oracle JDBC connection properties, connect timeout/read timeout, Application Continuity concepts.
8. Database vendor documentation for lock wait, deadlock, failover, session timeout, and HA behavior.

---

## 39. Ringkasan Part 025

Kita telah membahas:

1. Failure taxonomy JDBC production.
2. Database restart.
3. Primary failover.
4. DNS change.
5. Firewall/NAT/load balancer idle timeout.
6. Credential rotation.
7. Database max connection reached.
8. Lock storm.
9. Deadlock storm.
10. Slow query cascade.
11. Connection leak cascade.
12. Retry storm.
13. Ambiguous commit outcome.
14. Pool filled with dead connections.
15. JVM stall/long GC pause impact.
16. Error classification.
17. Transaction-level retry.
18. Idempotency key.
19. Circuit breaker/admission control.
20. Bulkhead by pool.
21. Graceful degradation.
22. Outbox pattern.
23. Startup failure policy.
24. Connection validation.
25. Timeout budget.
26. Incident diagnosis playbook.
27. Production readiness checklist.

Part berikutnya akan membahas:

```text
Part 026 — Security and Integrity at JDBC Boundary
```

Fokus berikutnya:

1. SQL injection boundary.
2. PreparedStatement limitations.
3. Safe dynamic SQL.
4. Least privilege database user.
5. TLS to database.
6. Credential handling.
7. Logging sensitive SQL/bind safely.
8. Auditability.
9. Multi-tenant isolation.
10. Integrity patterns at JDBC boundary.

---

## Status Seri

```text
Part 025 dari 029 selesai.
Seri belum selesai.
Masih tersisa Part 026, 027, 028, dan 029.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Metrics, Logs, Traces, and Database Correlation](./learn-java-sql-jdbc-hikaricp-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 026 — Security and Integrity at JDBC Boundary](./learn-java-sql-jdbc-hikaricp-part-026.md)
