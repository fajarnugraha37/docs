# learn-java-sql-jdbc-hikaricp-part-029

# Production Playbook: Diagnosis, Tuning, Review Checklist, and Case Studies

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `029` dari `029`  
> Status: **bagian terakhir seri**

---

## 0. Tujuan Part Ini

Part ini adalah penutup seri. Kita tidak lagi menambah API baru. Kita akan mengikat seluruh materi sebelumnya menjadi **production playbook**: bagaimana membaca gejala, membentuk hipotesis, mengumpulkan bukti, melakukan tuning, melakukan review desain, dan menangani failure nyata di aplikasi Java yang memakai JDBC + HikariCP.

Setelah menyelesaikan bagian ini, targetnya bukan hanya mampu menulis kode JDBC yang benar, tetapi mampu menjawab pertanyaan seperti:

- Kenapa pool habis padahal query terlihat sederhana?
- Apakah menaikkan `maximumPoolSize` akan membantu atau justru memperburuk keadaan?
- Apakah bottleneck ada di Java, pool, driver, network, lock database, query plan, atau database capacity?
- Apakah timeout sudah disusun sebagai budget yang konsisten atau hanya angka acak?
- Apakah transaction boundary sudah aman terhadap retry, duplicate side effect, dan partial failure?
- Apakah connection leak benar-benar leak, atau long-running transaction yang legitimate tetapi terlalu lama?
- Apakah failover database akan pulih sendiri atau membuat pool dipenuhi koneksi mati?
- Apakah observability cukup untuk menghubungkan request aplikasi dengan session database?

Part ini memakai mental model utama dari seluruh seri:

```text
Application Request
  -> Application Thread / Virtual Thread / Worker
  -> DataSource
  -> HikariCP Borrow Queue
  -> Logical Connection Proxy
  -> Physical JDBC Connection
  -> JDBC Driver
  -> Network Socket / TLS
  -> Database Session
  -> Transaction
  -> Statement / Cursor / Lock / Execution Plan
  -> Result Fetch
  -> Commit / Rollback
  -> Connection State Reset
  -> Return to Pool
```

JDBC production problem hampir tidak pernah murni masalah satu layer. Ia biasanya adalah **interaksi beberapa boundary**.

---

## 1. Prinsip Diagnosis Utama

Saat ada masalah JDBC, jangan langsung tuning. Mulai dari klasifikasi.

### 1.1 Jangan Bertanya “JDBC Lambat?”

Pertanyaan itu terlalu kasar. Pecah menjadi:

```text
Apakah lambat saat:
1. Menunggu connection dari pool?
2. Membuat physical connection baru?
3. Login/authentication ke DB?
4. Parse/prepare SQL?
5. Menunggu lock?
6. Mengeksekusi query?
7. Fetch result?
8. Mapping result ke object Java?
9. Commit/rollback?
10. Menunggu network read/write?
11. Menutup resource?
```

Masing-masing punya metrik, root cause, dan solusi berbeda.

Contoh:

```text
Symptom: HTTP request 30s.

Kemungkinan A:
- 28s menunggu connection dari pool.
- Query sebenarnya 100ms.
- Solusi bukan index, tetapi pool starvation / long transaction / leak.

Kemungkinan B:
- Borrow connection 2ms.
- Query 28s karena full table scan.
- Solusi bukan pool size, tetapi SQL plan/index/statistics.

Kemungkinan C:
- Execute 100ms.
- Fetch 25s karena result 2 juta row.
- Solusi bukan index saja, tetapi pagination/streaming/fetch size/data contract.

Kemungkinan D:
- Query cepat.
- Commit 20s karena redo/log fsync/replication lag.
- Solusi ada di transaction volume/DB storage/commit pattern.
```

### 1.2 Pahami Queueing Sebelum Tuning

JDBC + pool adalah sistem antrean.

```text
Incoming work > available DB concurrency
  -> pool pending threads naik
  -> request latency naik
  -> timeout naik
  -> retry naik
  -> load bertambah
  -> database makin lambat
  -> pool makin penuh
  -> cascade failure
```

Pool tidak menciptakan kapasitas database. Pool hanya mengatur berapa banyak pekerjaan yang boleh masuk ke database secara bersamaan.

Jika database hanya mampu memproses 20 query aktif dengan sehat, membuat pool 200 tidak membuat database menjadi 10x lebih kuat. Sering kali hasilnya justru:

- lebih banyak lock contention,
- lebih banyak context switching,
- lebih banyak memory per session,
- lebih banyak active transaction,
- lebih banyak query saling mengganggu,
- latency tail memburuk.

### 1.3 Diagnosis Harus Berbasis Timeline

Untuk setiap incident, buat timeline seperti ini:

```text
T-30m  Traffic mulai naik.
T-20m  DB CPU naik dari 40% ke 85%.
T-15m  Hikari active connection mencapai maksimum.
T-14m  Pending threads naik.
T-13m  HTTP p95 naik.
T-12m  Query timeout mulai muncul.
T-10m  Retry dari service upstream naik.
T-08m  DB lock wait naik.
T-05m  Error rate naik.
T+00m  Incident declared.
```

Tanpa timeline, orang biasanya salah menyimpulkan sebab-akibat.

Contoh salah:

```text
Pool full menyebabkan DB lambat.
```

Mungkin benar, tapi bisa juga terbalik:

```text
DB lambat menyebabkan connection tertahan lebih lama, lalu pool full.
```

Atau ada loop:

```text
DB lambat -> pool full -> request timeout -> retry storm -> DB makin lambat.
```

---

## 2. Production Metrics yang Wajib Ada

Minimal production-grade JDBC stack harus punya metrik pada empat layer:

```text
1. Application layer
2. Pool layer
3. JDBC/SQL layer
4. Database layer
```

### 2.1 Application Layer Metrics

Pantau:

```text
http.server.requests.count
http.server.requests.duration.p50/p95/p99
error.rate
request.timeout.count
retry.count
worker.queue.depth
thread.active/count
virtual.thread.pinned.count jika tersedia
```

Yang dicari:

- request mana yang lambat,
- endpoint mana yang memakai DB paling berat,
- apakah error terjadi sebelum atau sesudah DB call,
- apakah retry memperparah load.

### 2.2 Pool Layer Metrics

Untuk HikariCP, metrik penting:

```text
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.total
hikaricp.connections.max
hikaricp.connections.min
hikaricp.connections.acquire
hikaricp.connections.usage
hikaricp.connections.creation
hikaricp.connections.timeout
```

Interpretasi dasar:

| Gejala | Interpretasi Awal |
|---|---|
| `active == max`, `pending > 0` | Pool saturation |
| `active rendah`, request lambat | Bukan pool; cari di app/network/non-DB path |
| `acquire time tinggi` | Menunggu connection |
| `usage time tinggi` | Connection dipakai terlalu lama |
| `creation time tinggi` | Physical connection creation/login/network lambat |
| `idle tinggi`, pending tinggi | Curiga metric bug, pool partition, wrong pool, atau request memakai pool berbeda |
| `total sering turun-naik` | Koneksi sering mati/retire/validation gagal |

### 2.3 JDBC/SQL Layer Metrics

Minimal catat:

```text
sql.operation
sql.statement.name / normalized query id
sql.duration
sql.rows.returned
sql.rows.affected
sql.batch.size
sql.error.sql_state
sql.error.vendor_code
sql.timeout.type
transaction.duration
transaction.rollback.count
transaction.retry.count
```

Hindari menjadikan raw SQL dengan bind value sebagai label metric. Itu akan menyebabkan cardinality explosion dan potensi kebocoran data sensitif.

Gunakan nama operasi stabil:

```text
CaseRepository.findById
CaseRepository.transitionState
AuditTrailRepository.insert
ApplicationSearchRepository.searchByFilter
```

### 2.4 Database Layer Metrics

Untuk DB, minimal harus bisa melihat:

```text
active sessions
idle sessions
idle in transaction sessions
blocked sessions
blocking sessions
lock wait time
deadlock count
transaction count
commit/rollback rate
buffer/cache hit ratio
physical read/write
redo/log pressure
CPU
IO latency
connection count by application/user/client
slow query list
execution plan changes
```

Untuk Oracle, PostgreSQL, MySQL, SQL Server, nama view dan istilahnya berbeda, tetapi pertanyaannya sama:

```text
Siapa menunggu apa?
Siapa memblokir siapa?
Query mana yang menghabiskan waktu?
Session mana dari aplikasi mana?
Apakah masalah CPU, IO, lock, network, atau concurrency?
```

---

## 3. Golden Signals untuk JDBC + HikariCP

Gunakan empat golden signals:

```text
1. Latency
2. Traffic
3. Errors
4. Saturation
```

### 3.1 Latency

Pecah latency menjadi:

```text
request latency
pool acquisition latency
connection usage duration
SQL execution latency
fetch latency
transaction duration
commit duration
```

Jangan hanya punya satu angka `request duration`.

### 3.2 Traffic

Pantau:

```text
requests/sec
queries/sec
transactions/sec
batch rows/sec
connection borrows/sec
connection creations/sec
```

Traffic DB bisa naik walaupun traffic HTTP stabil, misalnya karena:

- N+1 query,
- retry,
- background job,
- polling,
- cache miss,
- feature baru yang menambah query per request.

### 3.3 Errors

Kelompokkan error:

```text
connection acquisition timeout
login failure
network timeout
query timeout
lock timeout
deadlock
serialization failure
constraint violation
syntax error
permission error
data conversion error
```

Setiap kelas error punya response berbeda.

Contoh:

| Error | Retry? | Catatan |
|---|---:|---|
| Deadlock | Mungkin | Retry transaction penuh jika idempotent |
| Serialization failure | Mungkin | Retry transaction penuh |
| Connection acquisition timeout | Hati-hati | Retry bisa memperparah pool pressure |
| Constraint violation | Biasanya tidak | Perbaiki input/invariant |
| Syntax error | Tidak | Bug deployment/query |
| Permission error | Tidak | Config/privilege issue |
| Query timeout | Mungkin | Tergantung apakah statement aman diulang |

### 3.4 Saturation

Saturation bukan hanya CPU.

```text
pool active == max
database active sessions tinggi
pending connection tinggi
lock wait tinggi
IO queue tinggi
thread pool queue tinggi
DB max connections hampir habis
open cursors tinggi
```

Saturation yang paling berbahaya adalah saturation tersembunyi: request belum error, tetapi queue sudah membesar.

---

## 4. Production Review Checklist: JDBC Code

Gunakan checklist ini saat review kode repository/DAO.

### 4.1 Resource Lifecycle

Pastikan:

```text
[ ] Connection selalu ditutup via try-with-resources atau dikelola transaction manager.
[ ] Statement/PreparedStatement ditutup.
[ ] ResultSet tidak keluar dari boundary repository secara mentah.
[ ] LOB stream ditutup.
[ ] Tidak ada field static Connection/Statement/ResultSet.
[ ] Tidak ada Connection disimpan di object long-lived.
[ ] Tidak ada Connection dipakai lintas thread tanpa desain eksplisit.
[ ] Tidak ada lazy iterator yang menahan ResultSet tanpa mekanisme close jelas.
```

Contoh benar untuk plain JDBC:

```java
public Optional<CaseRecord> findById(DataSource dataSource, long id) throws SQLException {
    String sql = """
        SELECT id, case_no, status, created_at
        FROM cases
        WHERE id = ?
        """;

    try (Connection connection = dataSource.getConnection();
         PreparedStatement statement = connection.prepareStatement(sql)) {

        statement.setLong(1, id);

        try (ResultSet rs = statement.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            return Optional.of(new CaseRecord(
                rs.getLong("id"),
                rs.getString("case_no"),
                rs.getString("status"),
                rs.getObject("created_at", OffsetDateTime.class)
            ));
        }
    }
}
```

### 4.2 PreparedStatement Usage

Pastikan:

```text
[ ] Value memakai bind parameter.
[ ] Dynamic identifier memakai allow-list, bukan concatenation bebas.
[ ] Sort direction divalidasi dari enum.
[ ] LIMIT/OFFSET/rownum diperlakukan sesuai driver/database.
[ ] Tidak ada bind value sensitif ditulis penuh ke log.
```

Contoh dynamic ORDER BY yang aman:

```java
enum CaseSortField {
    CREATED_AT("created_at"),
    CASE_NO("case_no"),
    STATUS("status");

    private final String column;

    CaseSortField(String column) {
        this.column = column;
    }

    public String column() {
        return column;
    }
}

enum SortDirection {
    ASC, DESC
}

String sql = """
    SELECT id, case_no, status
    FROM cases
    WHERE agency_id = ?
    ORDER BY %s %s
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    """.formatted(sortField.column(), direction.name());
```

Yang aman di sini bukan karena string formatting selalu aman, tetapi karena `sortField` dan `direction` berasal dari enum allow-list, bukan input bebas.

### 4.3 Transaction Boundary

Pastikan:

```text
[ ] Transaction dimulai dan diakhiri di service boundary yang jelas.
[ ] Semua write yang harus atomic memakai connection yang sama.
[ ] Commit hanya dilakukan setelah semua invariant terpenuhi.
[ ] Rollback dilakukan pada failure.
[ ] Tidak ada side effect eksternal irreversible sebelum commit.
[ ] Retry transaction dilakukan pada boundary yang benar, bukan retry statement acak.
[ ] Transaction tidak mencakup network call lambat kecuali benar-benar perlu.
[ ] Transaction tidak mencakup user think time.
```

Contoh pola plain JDBC:

```java
public void transitionCase(DataSource dataSource, long caseId, String expectedStatus, String nextStatus) throws SQLException {
    try (Connection connection = dataSource.getConnection()) {
        boolean originalAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);

        try {
            int updated = updateCaseState(connection, caseId, expectedStatus, nextStatus);
            if (updated != 1) {
                throw new OptimisticTransitionException("Case state changed concurrently");
            }

            insertAuditTrail(connection, caseId, expectedStatus, nextStatus);

            connection.commit();
        } catch (Exception e) {
            try {
                connection.rollback();
            } catch (SQLException rollbackError) {
                e.addSuppressed(rollbackError);
            }
            throw e;
        } finally {
            connection.setAutoCommit(originalAutoCommit);
        }
    }
}
```

Dalam aplikasi yang memakai Spring/Jakarta transaction manager, boundary ini biasanya dikelola framework. Namun mental model-nya tetap sama: satu transaction terikat pada connection/session.

### 4.4 ResultSet Handling

Pastikan:

```text
[ ] Query list punya limit/pagination.
[ ] Query export besar memakai streaming/fetch size sesuai driver.
[ ] Mapping memperhatikan NULL.
[ ] Tidak memakai primitive getter tanpa `wasNull()` untuk kolom nullable.
[ ] Tidak memuat semua data besar ke memory tanpa alasan.
[ ] Tidak melakukan query tambahan per row tanpa sadar.
```

---

## 5. Production Review Checklist: HikariCP Configuration

### 5.1 Baseline Configuration

Contoh baseline generik:

```properties
spring.datasource.hikari.pool-name=case-service-main-pool
spring.datasource.hikari.maximum-pool-size=20
spring.datasource.hikari.minimum-idle=20
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.validation-timeout=1000
spring.datasource.hikari.idle-timeout=600000
spring.datasource.hikari.max-lifetime=1800000
spring.datasource.hikari.keepalive-time=0
spring.datasource.hikari.leak-detection-threshold=0
spring.datasource.hikari.auto-commit=true
```

Ini bukan angka universal. Ini baseline diskusi.

### 5.2 Checklist Konfigurasi

```text
[ ] `poolName` unik per service/pool.
[ ] `maximumPoolSize` dihitung dari total semua replica, bukan per pod saja.
[ ] `minimumIdle` dipahami: fixed-size pool sering disarankan untuk predictable latency.
[ ] `connectionTimeout` lebih kecil dari request timeout.
[ ] `validationTimeout` pendek dan masuk akal.
[ ] `maxLifetime` lebih pendek dari network/firewall/database idle/lifetime killer.
[ ] `keepaliveTime` hanya dipakai jika perlu menjaga koneksi idle tetap valid.
[ ] `leakDetectionThreshold` tidak dinyalakan permanen dengan angka terlalu rendah.
[ ] Driver socket/connect timeout dikonfigurasi, bukan hanya Hikari timeout.
[ ] DB max sessions memperhitungkan semua service, tools, migration, DBA, report, dan background job.
[ ] Tidak ada konfigurasi transaction isolation global tanpa alasan.
[ ] Tidak ada `connectionTestQuery` jika JDBC4 `isValid()` cukup dan driver mendukung baik.
```

### 5.3 Red Flags

```text
maximumPoolSize=200 per pod
connectionTimeout=30000 sementara HTTP timeout=10000
leakDetectionThreshold=2000 di production permanen
maxLifetime lebih panjang dari firewall idle timeout
socketTimeout tidak diset pada driver yang membutuhkannya
pool berbeda-beda tanpa naming jelas
satu pool dipakai untuk OLTP dan report berat
minimumIdle kecil pada traffic latency-sensitive tanpa warm-up strategy
```

---

## 6. Pool Sizing Playbook

### 6.1 Mulai dari Budget Koneksi Global

Jangan mulai dari service.

Mulai dari database:

```text
DB max usable sessions for application = total DB limit - reserved admin - reserved migration - reserved monitoring - safety margin
```

Contoh:

```text
DB max connections            = 500
Reserved DBA/admin            = 30
Reserved migration/batch      = 50
Reserved monitoring/tools     = 20
Safety margin                 = 50
Usable app connections        = 350
```

Lalu bagi ke service:

```text
case-service      80
application-svc   60
audit-service     40
report-service    40
profile-service   30
background jobs   50
margin            50
```

Kemudian bagi per replica:

```text
case-service budget = 80
replicas            = 4
max pool per pod    = 20
```

Jika autoscaling ke 8 replica, pool per pod 20 berarti total 160. Itu mungkin melanggar budget. Jadi HPA dan pool sizing harus dibahas bersama.

### 6.2 Gunakan Observasi, Bukan Formula Buta

Formula bisa memberi starting point, tetapi final harus diuji.

Uji beberapa ukuran pool:

```text
pool=8
pool=12
pool=16
pool=20
pool=30
pool=50
```

Bandingkan:

```text
throughput
p50/p95/p99 latency
DB CPU
DB IO
lock wait
context switching
pool pending
error rate
```

Ukuran pool terbaik bukan yang throughput paling tinggi saat happy path saja, tetapi yang:

- menjaga latency tail stabil,
- tidak membuat DB overload,
- memberi backpressure lebih awal,
- pulih baik saat DB melambat,
- tidak membuat retry storm.

### 6.3 Pisahkan Workload yang Berbeda

Jangan pakai satu pool untuk semua jika workload berbeda ekstrem.

Contoh:

```text
Pool A: OLTP short request
- maxPoolSize=20
- connectionTimeout=2s
- query timeout pendek

Pool B: reporting/export
- maxPoolSize=4
- connectionTimeout=5s
- query timeout lebih panjang
- fetch size/streaming

Pool C: background reconciliation
- maxPoolSize=3
- batch controlled
```

Dengan ini, report lambat tidak menghabiskan koneksi OLTP.

---

## 7. Timeout Budget Playbook

Timeout harus membentuk urutan, bukan angka acak.

Contoh request API synchronous:

```text
Client timeout                  15s
API gateway timeout             12s
Application request timeout     10s
DB transaction budget            7s
JDBC query timeout               5s
Lock timeout                     2s
Pool connectionTimeout           1s - 2s
Driver connect timeout           1s - 3s
Driver socket/read timeout       sedikit > query timeout atau sesuai model driver
```

Prinsip:

```text
Pool wait timeout harus pendek agar sistem memberi backpressure.
Query timeout harus lebih pendek dari request timeout.
Lock timeout harus lebih pendek dari query timeout untuk OLTP.
Request timeout harus lebih pendek dari gateway/client timeout.
Retry harus memperhitungkan total budget, bukan mengulang penuh tanpa batas.
```

Anti-pattern:

```text
HTTP timeout = 10s
Hikari connectionTimeout = 30s
Query timeout = tidak ada
Socket timeout = tidak ada
DB lock timeout = tidak ada
```

Akibat:

- HTTP sudah timeout,
- thread masih menunggu DB,
- query masih jalan,
- connection masih ditahan,
- pool penuh,
- user retry,
- sistem makin rusak.

---

## 8. Transaction Playbook

### 8.1 Transaction Harus Pendek dan Bermakna

Transaction ideal:

```text
read current state
validate invariant
write state transition
write audit/outbox
commit
```

Transaction buruk:

```text
begin
read data
call external HTTP
generate PDF
send email
wait for remote service
update DB
commit
```

Selama transaction terbuka, database mungkin menahan:

- lock,
- MVCC snapshot,
- undo/rollback segment,
- session resource,
- pool connection.

### 8.2 Jangan Kirim Event Sebelum Commit

Untuk state-changing workflow:

```text
Wrong:
1. update case state
2. publish Kafka/RabbitMQ event
3. commit

If commit fails, event already says state changed.
```

Lebih aman:

```text
1. update case state
2. insert outbox event in same transaction
3. commit
4. async publisher reads outbox and publishes
5. mark outbox sent
```

Ini bukan bagian JDBC API langsung, tetapi sangat relevan karena JDBC transaction adalah boundary integritas.

### 8.3 Retry Transaction Penuh, Bukan Potongan Acak

Jika deadlock/serialization failure:

```text
Retry:
- acquire fresh connection or fresh transaction
- re-read necessary state
- re-validate invariant
- re-apply write
- commit
```

Jangan hanya retry `executeUpdate()` terakhir tanpa memahami state sebelumnya.

---

## 9. SQL and Query Review Checklist

```text
[ ] Query punya predicate selektif.
[ ] Query sesuai index yang tersedia.
[ ] Query tidak memakai function pada indexed column tanpa function-based index.
[ ] Query list punya pagination.
[ ] Query export dipisah dari OLTP.
[ ] Query tidak melakukan SELECT * untuk hot path.
[ ] Query tidak mengambil CLOB/BLOB kecuali perlu.
[ ] Query tidak join besar tanpa limit/filter.
[ ] Query search punya strategi index/search engine yang sesuai.
[ ] Query update/delete batch punya batas ukuran.
[ ] Query lock memakai urutan akses konsisten.
[ ] Query state transition memakai optimistic condition (`WHERE id=? AND status=?`).
[ ] Query report berat diuji dengan data volume production-like.
```

Contoh update state yang defensible:

```sql
UPDATE cases
SET status = ?,
    updated_at = ?,
    updated_by = ?
WHERE id = ?
  AND status = ?
```

Jika affected rows = 0, jangan otomatis anggap DB error. Bisa jadi:

- case tidak ada,
- status sudah berubah,
- user tidak berhak,
- concurrent transition terjadi.

Itu harus diterjemahkan menjadi domain outcome yang benar.

---

## 10. Common Incident: Pool Exhaustion

### 10.1 Gejala

```text
HikariPool - Connection is not available, request timed out after ...
active == maximumPoolSize
pending > 0
HTTP latency naik
error rate naik
DB mungkin tinggi, mungkin tidak
```

### 10.2 Kemungkinan Root Cause

```text
1. Connection leak benar-benar tidak di-close.
2. Query lambat menahan connection lama.
3. Transaction terlalu panjang.
4. Lock wait membuat query menggantung.
5. DB slowdown membuat usage time naik.
6. Pool terlalu kecil untuk workload valid.
7. Request spike melebihi kapasitas.
8. Background job memakai pool yang sama.
9. Downstream timeout/retry storm.
10. Dead connection tidak cepat dibuang.
```

### 10.3 Diagnostic Steps

```text
1. Cek active/idle/pending/timeout.
2. Cek connection usage duration.
3. Cek leak detection log jika tersedia.
4. Cek database active sessions by application.
5. Cek query yang sedang berjalan.
6. Cek lock wait/blocker.
7. Cek idle in transaction.
8. Cek recent deployment/traffic spike/job schedule.
9. Cek retry rate upstream.
10. Cek apakah satu endpoint mendominasi usage.
```

### 10.4 Remediation

Jangan langsung menaikkan pool.

Urutan aman:

```text
1. Stop retry storm jika ada.
2. Disable/throttle background job jika mengganggu OLTP.
3. Kill/resolve blocker jika ada lock chain.
4. Rollback deployment jika query baru menjadi penyebab.
5. Turunkan concurrency workload berat.
6. Tambahkan timeout/limit jika query menggantung.
7. Perbaiki leak/resource handling.
8. Baru pertimbangkan tuning pool setelah root cause jelas.
```

Menaikkan pool hanya valid jika:

- database masih punya capacity,
- tidak ada lock contention signifikan,
- usage time wajar,
- pending tinggi karena traffic legitimate,
- load test membuktikan pool lebih besar memperbaiki throughput/latency.

---

## 11. Common Incident: Database Slowdown Cascade

### 11.1 Pattern

```text
DB latency naik
  -> connection usage duration naik
  -> active pool penuh
  -> pending thread naik
  -> request timeout
  -> client/upstream retry
  -> traffic DB bertambah
  -> DB makin lambat
```

### 11.2 Control Points

```text
[ ] connectionTimeout pendek
[ ] query timeout jelas
[ ] lock timeout jelas
[ ] retry bounded + jitter
[ ] circuit breaker untuk operasi non-critical
[ ] separate pool untuk workload berat
[ ] load shedding saat pending tinggi
[ ] observability untuk query top offenders
```

### 11.3 Tindakan Saat Incident

```text
1. Kurangi load masuk.
2. Pause batch/report/export.
3. Identifikasi query/lock penyebab.
4. Pastikan retry tidak memperparah.
5. Jika DB failover/restart, pastikan pool membuang koneksi invalid.
6. Setelah stabil, review query plan/index/config.
```

---

## 12. Common Incident: Stale Connections After Network/DB Event

### 12.1 Gejala

```text
Connection reset
Broken pipe
Socket timeout
No operations allowed after connection closed
SQLRecoverableException
Communications link failure
```

Muncul setelah:

- DB restart,
- failover,
- firewall/NAT idle timeout,
- DNS change,
- credential rotation,
- network partition.

### 12.2 Diagnosis

```text
[ ] Apakah error terjadi hanya pada idle connection lama?
[ ] Apakah maxLifetime lebih panjang dari infrastructure timeout?
[ ] Apakah keepaliveTime diperlukan?
[ ] Apakah driver socket timeout diset?
[ ] Apakah DNS cache JVM/OS terlalu lama?
[ ] Apakah pool berhasil membuat connection baru?
[ ] Apakah validationTimeout terlalu panjang?
```

### 12.3 Remediation

```text
[ ] Set maxLifetime lebih pendek dari batas infra.
[ ] Gunakan keepalive jika idle connection sering diputus infra.
[ ] Set driver connect/socket/read timeout.
[ ] Pastikan validation cepat.
[ ] Pastikan failover host/URL driver benar.
[ ] Pertimbangkan restart rolling aplikasi jika pool stuck dan recovery manual diperlukan.
```

---

## 13. Common Incident: Idle in Transaction

### 13.1 Gejala

```text
DB menunjukkan session idle in transaction.
Lock tertahan.
Vacuum/cleanup/MVCC terganggu pada DB tertentu.
Pool active mungkin tetap penuh.
User request terlihat selesai/lambat tidak jelas.
```

### 13.2 Penyebab Umum

```text
[ ] AutoCommit=false lalu lupa commit/rollback.
[ ] Exception path tidak rollback.
[ ] Connection dikembalikan ke pool dalam state transaction bermasalah.
[ ] Transaction manager boundary salah.
[ ] Streaming ResultSet dibiarkan terbuka.
[ ] Debugger/manual pause di tengah transaction.
[ ] External call dilakukan di tengah transaction.
```

### 13.3 Prevention

```text
[ ] Gunakan transaction template/framework dengan boundary jelas.
[ ] Selalu rollback pada catch.
[ ] Jangan swallow exception rollback.
[ ] Monitor transaction duration.
[ ] Alert untuk idle in transaction > threshold.
[ ] Hindari external call dalam transaction.
[ ] Gunakan statement/transaction timeout.
```

---

## 14. Common Incident: Reporting Query Starves OLTP

### 14.1 Pattern

```text
Report/export mengambil banyak koneksi.
Setiap koneksi menjalankan query besar.
OLTP request tidak dapat connection.
Pool penuh.
User-facing API timeout.
```

### 14.2 Fix Architecture

```text
[ ] Pisahkan pool report dari pool OLTP.
[ ] Batasi concurrency report.
[ ] Gunakan read replica jika cocok.
[ ] Gunakan pagination/streaming.
[ ] Hindari SELECT CLOB/BLOB besar kecuali perlu.
[ ] Precompute/materialized view untuk report berat.
[ ] Jadwalkan batch di luar peak hour.
[ ] Terapkan per-user export quota.
```

---

## 15. Common Incident: Audit CLOB Causes Memory/IO Pressure

### 15.1 Pattern

Audit table sering punya kolom besar:

```text
metadata CLOB
serialized_changes CLOB
full_text CLOB
request_payload CLOB
response_payload CLOB
```

Bug umum:

```sql
SELECT *
FROM audit_trail
WHERE module_id = ?
ORDER BY created_date_time DESC
```

Padahal listing screen hanya butuh:

```text
id
module
activity
action_by
created_date_time
summary
```

### 15.2 Dampak

```text
[ ] IO besar.
[ ] Network transfer besar.
[ ] Driver buffer besar.
[ ] Heap pressure.
[ ] GC pressure.
[ ] Fetch lambat.
[ ] Pool connection tertahan lama.
```

### 15.3 Fix

```text
[ ] Jangan SELECT CLOB untuk listing.
[ ] Pisahkan query listing dan detail.
[ ] Buat covering index untuk listing predicate/order.
[ ] Archive/partition audit lama.
[ ] Compress atau externalize payload jika perlu.
[ ] Batasi full-text search dengan engine/index yang sesuai.
[ ] Monitor rows returned dan bytes transferred.
```

---

## 16. Common Incident: Kubernetes Replica Scale-Up Exhausts DB

### 16.1 Pattern

```text
Service replicas: 4 -> 12
maxPoolSize per pod: 30
Total possible DB connections: 120 -> 360
DB max usable app sessions: 250
```

Akibat:

- DB max connection reached,
- beberapa pod gagal connect,
- readiness flapping,
- thundering herd saat restart,
- latency memburuk.

### 16.2 Prevention

```text
[ ] Hitung total pool = replicas * maxPoolSize.
[ ] Set HPA max replicas sesuai DB budget.
[ ] Gunakan startup ramp-up.
[ ] Gunakan readiness yang tidak membuat semua pod menyerang DB bersamaan.
[ ] Pisahkan pool per workload.
[ ] Dokumentasikan DB connection budget per service.
```

---

## 17. Common Incident: Credential Rotation

### 17.1 Failure Mode

Credential berubah di secrets manager, tetapi:

```text
existing physical connections tetap memakai credential lama
new connections gagal jika app belum reload secret
pool tidak otomatis tahu secret berubah
rolling restart tidak sinkron
```

### 17.2 Safe Rotation Pattern

```text
1. DB mendukung overlap credential lama+baru sementara.
2. Update secret baru.
3. Rolling restart aplikasi atau refresh DataSource secara terkontrol.
4. Monitor connection creation failure.
5. Tunggu semua old connection retire.
6. Cabut credential lama.
```

Untuk sistem yang sangat kritis, desain explicit pool recycle endpoint atau controlled deployment strategy.

---

## 18. Decision Matrix: JDBC Stack Choice

| Kebutuhan | Pilihan Cocok | Catatan |
|---|---|---|
| Query sederhana, kontrol penuh | Plain JDBC / Spring JDBC | Minim magic, verbose |
| SQL kompleks, type-safe DSL | jOOQ | Bagus untuk SQL-first system |
| Domain object graph, persistence context | JPA/Hibernate | Waspadai N+1, flush, lazy loading |
| Bulk write/read | JDBC batch / database-native bulk | Kontrol transaction dan batch size |
| Legacy stored procedure | CallableStatement / framework wrapper | Jaga versioning dan contract |
| High concurrency blocking app | JDBC + pool + virtual threads mungkin cukup | DB tetap bottleneck; pool tetap wajib |
| End-to-end reactive non-blocking | R2DBC | Ekosistem dan semantics berbeda dari JDBC |
| Reporting berat | Separate pool/read replica/materialized view | Jangan ganggu OLTP |

Tidak ada pilihan yang selalu superior. Yang penting adalah memahami boundary dan failure mode-nya.

---

## 19. Final Review Checklist untuk Production Readiness

### 19.1 Code Correctness

```text
[ ] Resource selalu ditutup.
[ ] Transaction boundary jelas.
[ ] Rollback path aman.
[ ] PreparedStatement dipakai untuk value.
[ ] Dynamic SQL memakai allow-list.
[ ] Null/type/timezone handling jelas.
[ ] Batch partial failure ditangani.
[ ] Result besar tidak dimuat sembarangan.
[ ] LOB tidak ikut listing hot path.
```

### 19.2 Pool and Timeout

```text
[ ] Pool size sesuai DB budget global.
[ ] HPA/replica count memperhitungkan total connection.
[ ] connectionTimeout pendek dan masuk akal.
[ ] Query/lock/transaction/request timeout tersusun sebagai budget.
[ ] Driver connect/socket timeout diset.
[ ] maxLifetime/keepalive sesuai infra.
[ ] Separate pool untuk workload berbeda.
```

### 19.3 Observability

```text
[ ] Hikari metrics aktif.
[ ] Query latency per operation terlihat.
[ ] Transaction duration terlihat.
[ ] SQLState/vendor code dicatat.
[ ] Pool pending/timeout di-alert.
[ ] Slow query dapat dikorelasikan ke endpoint/use case.
[ ] DB session dapat dikorelasikan ke service/pod/request jika memungkinkan.
[ ] Dashboard memisahkan pool, query, DB, dan HTTP latency.
```

### 19.4 Failure Readiness

```text
[ ] DB restart/failover pernah diuji.
[ ] Network timeout pernah diuji.
[ ] Pool exhaustion pernah diuji.
[ ] Lock wait/deadlock pernah diuji.
[ ] Credential rotation pernah diuji.
[ ] Retry bounded dan idempotency jelas.
[ ] Circuit breaker/load shedding untuk non-critical path tersedia.
[ ] Runbook incident tersedia.
```

### 19.5 Security and Integrity

```text
[ ] DB user least privilege.
[ ] App user bukan schema owner/admin.
[ ] TLS ke DB sesuai requirement.
[ ] Secret tidak hardcoded.
[ ] Secret rotation procedure jelas.
[ ] SQL log tidak membocorkan PII/secret.
[ ] Audit write atomic dengan business change.
[ ] Multi-tenant predicate tidak bisa dilewati.
```

---

## 20. Incident Runbook Template

Gunakan template ini saat incident JDBC/DB terjadi.

```markdown
# JDBC/DB Incident Runbook

## 1. Summary
- Start time:
- Detected by:
- Affected service:
- Affected endpoint/job:
- User impact:

## 2. Current Symptoms
- HTTP error rate:
- HTTP p95/p99:
- Hikari active/idle/pending:
- Hikari acquisition time:
- Hikari usage time:
- DB active sessions:
- DB CPU/IO:
- Lock wait/deadlock:
- Top SQL:

## 3. Immediate Containment
- Pause batch/report:
- Reduce retry:
- Scale decision:
- Kill blocker decision:
- Rollback deployment decision:

## 4. Hypotheses
1. Pool exhaustion due to leak/long transaction
2. DB slowdown due to query plan/index/IO
3. Lock storm/blocker
4. Retry storm
5. Network/failover/stale connection
6. Capacity exceeded after scale-up

## 5. Evidence
- Logs:
- Metrics:
- DB session queries:
- Recent deployments:
- Traffic change:

## 6. Root Cause
- Technical cause:
- Trigger:
- Why not detected earlier:

## 7. Permanent Fix
- Code:
- Config:
- DB/index:
- Observability:
- Process:

## 8. Follow-up Actions
- Owner:
- Due date:
- Verification plan:
```

---

## 21. What “Top 1% JDBC Engineer” Means

Bukan berarti hafal semua method di `java.sql`.

Engineer yang sangat kuat di JDBC mampu melihat sistem seperti ini:

```text
JDBC code is not just code.
It is a contract between:
- application concurrency,
- connection pool capacity,
- database session state,
- transaction semantics,
- SQL execution plan,
- network behavior,
- operational timeout,
- data integrity,
- observability,
- and recovery strategy.
```

Ciri-cirinya:

1. Tidak langsung menaikkan pool saat pool penuh.
2. Bisa membedakan pool wait, query execution, fetch, lock wait, dan commit latency.
3. Mengerti bahwa transaction adalah state pada connection/session.
4. Tahu kapan retry aman dan kapan retry memperparah incident.
5. Mendesain timeout sebagai budget berlapis.
6. Memisahkan OLTP, reporting, dan background workload.
7. Tidak membocorkan `ResultSet`, `Connection`, atau transaction boundary.
8. Memahami vendor-specific behavior tanpa kehilangan portable mental model.
9. Mampu menghubungkan request ID aplikasi ke DB session/query.
10. Mendesain JDBC layer sebagai bagian dari reliability architecture, bukan sekadar persistence code.

---

## 22. Ringkasan Seluruh Seri

Seri ini sudah bergerak dari foundation ke production mastery:

```text
Part 000 - 006:
Mental model, java.sql/javax.sql, driver, connection, statement, result set, type system.

Part 007 - 010:
Transaction, isolation, SQLException, resource lifecycle.

Part 011 - 016:
DataSource, batch, LOB, metadata, advanced JDBC features, stored procedure.

Part 017 - 023:
Performance model, pooling, HikariCP architecture/config/sizing/timeout, transaction-pool interaction.

Part 024 - 029:
Observability, failure recovery, security, testing, modern application integration, production playbook.
```

Jika harus dirangkum menjadi satu invariant:

```text
A JDBC connection is a scarce, stateful, failure-prone carrier of database session and transaction semantics.
Treat it with explicit ownership, bounded lifetime, measurable behavior, and production-aware failure handling.
```

---

## 23. Referensi Utama

Referensi yang relevan untuk seluruh seri:

1. Java SE `java.sql` package documentation  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/package-summary.html

2. Java SE `Connection` documentation  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Connection.html

3. Java SE `Statement` documentation  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Statement.html

4. Java SE `SQLException` documentation  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/SQLException.html

5. HikariCP official repository and README  
   https://github.com/brettwooldridge/HikariCP

6. HikariCP Wiki — About Pool Sizing  
   https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing

7. OpenTelemetry Java documentation  
   https://opentelemetry.io/docs/languages/java/

8. OpenTelemetry Java JDBC instrumentation  
   https://github.com/open-telemetry/opentelemetry-java-instrumentation/tree/main/instrumentation/jdbc

9. OWASP SQL Injection Prevention Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html

10. PostgreSQL JDBC documentation  
    https://jdbc.postgresql.org/documentation/

11. MySQL Connector/J documentation  
    https://dev.mysql.com/doc/connector-j/en/

12. Oracle JDBC Developer's Guide  
    https://docs.oracle.com/en/database/oracle/oracle-database/

---

# Status Akhir Seri

```text
Part 029 dari 029 selesai.
Seri learn-java-sql-jdbc-hikaricp selesai.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java SQL, JDBC, and HikariCP — Part 028](./learn-java-sql-jdbc-hikaricp-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-000](../testing/learn-java-testing-benchmarking-performance-jvm-part-000.md)

</div>