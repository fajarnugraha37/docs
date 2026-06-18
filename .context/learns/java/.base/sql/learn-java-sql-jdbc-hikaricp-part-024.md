# learn-java-sql-jdbc-hikaricp-part-024

# Observability: Metrics, Logs, Traces, and Database Correlation

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `024 dari 029`  
> Status seri: **belum selesai**  
> Part berikutnya: `025 — Failure Modes and Recovery Patterns`

---

## 0. Tujuan Pembelajaran

Di part sebelumnya kita sudah membahas transaction dan pool interaction: bagaimana `Connection` menjadi carrier transaction, bagaimana pool mengembalikan logical connection, dan bagaimana bug transaction leak bisa membuat sistem macet.

Part ini menjawab pertanyaan berikut:

> “Saat sistem production lambat, pool penuh, query timeout, atau database terlihat berat, bagaimana kita tahu penyebabnya dengan bukti, bukan feeling?”

Setelah menyelesaikan part ini, kamu harus bisa:

1. Membedakan **JDBC observability**, **pool observability**, dan **database observability**.
2. Menentukan metrik wajib untuk HikariCP/JDBC layer.
3. Mendesain log yang berguna tanpa membocorkan PII/secret.
4. Menggunakan SQLState/vendor code sebagai dimensi diagnosis.
5. Menghubungkan request aplikasi, trace ID, JDBC call, connection pool, dan session database.
6. Membaca gejala pool exhaustion, slow query, lock wait, connection leak, dan database saturation.
7. Mendesain dashboard dan alert yang actionable.
8. Membuat checklist observability untuk aplikasi Java production.

---

## 1. Mental Model: JDBC Observability Bukan Hanya Slow Query Log

Banyak engineer menganggap observability JDBC berarti:

```text
log SQL lambat
```

Itu benar, tetapi sangat tidak cukup.

JDBC adalah boundary tempat beberapa sistem bertemu:

```text
HTTP request / job / message consumer
        |
        v
Application thread / virtual thread
        |
        v
Transaction boundary
        |
        v
HikariCP pool borrow
        |
        v
JDBC driver
        |
        v
Network socket
        |
        v
Database listener / protocol endpoint
        |
        v
Database session
        |
        v
Parser / optimizer / executor / lock manager / storage engine
```

Jika latency terjadi, penyebabnya bisa berada di banyak tempat:

```text
1. Request menunggu connection dari pool.
2. Connection creation lambat.
3. Query parse lambat.
4. Query execution lambat.
5. Query menunggu lock.
6. Query fetch terlalu besar.
7. Driver buffering result terlalu banyak.
8. Network lambat.
9. Database CPU/IO saturated.
10. Transaction terlalu lama.
11. Connection leak.
12. Pool terlalu kecil.
13. Pool terlalu besar dan membebani database.
14. Retry storm.
15. Database failover atau restart.
```

Observability yang baik harus bisa menjawab:

```text
Apakah lambatnya terjadi sebelum dapat connection,
ketika execute SQL,
ketika fetch result,
ketika commit/rollback,
atau karena database/lock/network?
```

Tanpa pemisahan ini, semua masalah akan terlihat sama:

```text
API slow
DB slow
connection timeout
```

Padahal treatment-nya berbeda total.

---

## 2. Tiga Layer Observability JDBC

Untuk sistem Java yang memakai JDBC + HikariCP, minimal ada tiga layer observability.

```text
Layer 1 — Pool Observability
- active connections
- idle connections
- pending threads
- total connections
- connection acquisition time
- connection usage time
- connection creation time
- timeout waiting for connection
- leak detection

Layer 2 — JDBC Operation Observability
- SQL operation latency
- statement execution time
- result fetch time
- rows returned/affected
- batch size
- commit/rollback latency
- SQLState/vendor error classification
- query timeout/cancel

Layer 3 — Database Correlation
- DB session id / backend pid
- application_name / module / client identifier
- database wait event
- lock wait
- active session
- query id / SQL id
- transaction age
- idle-in-transaction session
```

Jika hanya punya Layer 1, kamu tahu pool penuh, tetapi tidak tahu kenapa connection lama dipakai.

Jika hanya punya Layer 2, kamu tahu query lambat, tetapi tidak tahu apakah request sebelumnya menunggu pool.

Jika hanya punya Layer 3, DBA tahu session berat, tetapi application team sulit tahu request/user/job mana yang membuatnya.

Production-grade observability membutuhkan ketiganya.

---

## 3. Golden Signals untuk JDBC Stack

Untuk JDBC/HikariCP, “golden signals” dapat diturunkan menjadi:

```text
1. Traffic
   Berapa banyak request/job/query/transaction per satuan waktu?

2. Latency
   Berapa lama acquire connection, execute SQL, fetch result, commit, rollback?

3. Errors
   SQLState apa yang muncul? Timeout? Deadlock? Constraint? Connection failure?

4. Saturation
   Apakah pool penuh? Pending thread naik? DB active session mendekati limit?
```

Tetapi perlu diperjelas:

```text
Application latency != JDBC latency
JDBC latency != DB execution latency
DB execution latency != lock wait
Pool wait latency != query latency
```

Contoh:

```text
API latency: 10s
Connection acquisition: 9.5s
SQL execution: 80ms
```

Kesimpulan:

```text
Masalah utama bukan query lambat.
Masalah utama adalah menunggu connection dari pool.
```

Contoh lain:

```text
API latency: 10s
Connection acquisition: 2ms
SQL execution: 9.7s
Rows returned: 5
DB wait event: lock wait
```

Kesimpulan:

```text
Masalah utama bukan pool.
Masalah utama adalah lock contention.
```

---

## 4. HikariCP Metrics: Apa yang Wajib Dipantau

HikariCP menyediakan integrasi metrics dan JMX/MBeans. Dalam aplikasi Spring Boot, metrik Hikari biasanya terekspos melalui Micrometer/Actuator jika dependency dan konfigurasi metrics tersedia. Di luar Spring Boot, HikariCP dapat dihubungkan ke metric registry melalui konfigurasi seperti `metricRegistry` atau `metricsTrackerFactory`, tergantung setup library.

Metrik paling penting:

```text
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections
hikaricp.connections.max
hikaricp.connections.min
hikaricp.connections.acquire
hikaricp.connections.usage
hikaricp.connections.creation
hikaricp.connections.timeout
```

Nama persis bisa berbeda tergantung monitoring stack, Micrometer registry, versi framework, dan naming convention.

Yang penting adalah semantiknya.

---

## 5. Active Connections

`active connections` adalah jumlah connection yang sedang dipinjam oleh aplikasi.

```text
active = connection sedang digunakan oleh application code
```

Interpretasi:

```text
active rendah
  -> pool tidak sibuk, atau traffic rendah

active mendekati maximumPoolSize
  -> pool sedang saturated atau semua request sedang pakai DB

active tinggi lama
  -> query/transaction lama, leak, atau workload memang berat
```

Namun active tinggi tidak selalu buruk.

Jika sistem memang menerima beban tinggi dan database masih sehat, active tinggi bisa normal. Yang perlu dilihat adalah kombinasi:

```text
active tinggi + pending rendah + latency stabil
  -> mungkin normal

active tinggi + pending naik + acquire timeout
  -> pool starvation

active tinggi + DB CPU rendah + banyak lock wait
  -> transaction/lock contention

active tinggi + query latency tinggi + DB CPU/IO tinggi
  -> database saturated atau query berat
```

---

## 6. Idle Connections

`idle connections` adalah connection fisik/logical pool entry yang siap dipinjam.

```text
idle = connection tersedia di pool
```

Interpretasi:

```text
idle selalu tinggi
  -> pool mungkin terlalu besar untuk workload saat ini

idle sering nol
  -> pool sering habis, perlu lihat pending dan acquire latency

idle nol sebentar saat spike
  -> belum tentu masalah

idle nol lama + pending tinggi
  -> bottleneck jelas di pool/DB usage
```

Jangan langsung menyimpulkan “idle nol berarti harus tambah pool”. Bisa jadi connection dipakai terlalu lama karena:

```text
- query lambat
- transaction terlalu panjang
- result streaming lambat
- remote call dilakukan di dalam transaction
- connection leak
- batch besar terlalu lama
- lock wait
```

---

## 7. Pending Threads

`pending threads` adalah jumlah thread yang sedang menunggu connection dari pool.

Ini metrik paling cepat menunjukkan pool pressure.

```text
pending = thread/request menunggu getConnection()
```

Interpretasi:

```text
pending = 0
  -> tidak ada antrean pool

pending spike pendek
  -> traffic burst, mungkin normal jika tidak timeout

pending naik terus
  -> pool tidak mampu melayani demand

pending tinggi + timeout tinggi
  -> request gagal karena tidak mendapat connection
```

Dalam sistem production, pending yang terus menerus naik adalah sinyal kuat bahwa aplikasi sedang kehilangan backpressure sehat.

---

## 8. Connection Acquisition Time

Connection acquisition time adalah durasi dari:

```java
Connection c = dataSource.getConnection();
```

sampai connection berhasil diperoleh.

Mental model:

```text
acquisition time rendah
  -> pool punya idle connection atau bisa cepat menyediakan connection

acquisition time tinggi
  -> thread menunggu connection tersedia atau pool membuat connection baru

acquisition timeout
  -> connection tidak tersedia sampai connectionTimeout
```

Ini harus dipantau sebagai histogram/percentile, bukan hanya average.

```text
avg acquire = 3ms
p95 acquire = 10ms
p99 acquire = 2s
max acquire = 30s
```

Average terlihat sehat, tetapi p99 menunjukkan request tertentu tersiksa.

---

## 9. Connection Usage Time

Connection usage time adalah durasi connection dipinjam sampai dikembalikan ke pool.

```text
usage time = close() - getConnection()
```

Di aplikasi yang benar, usage time kira-kira mencakup:

```text
- begin transaction / set state
- execute one or more SQL
- process result set
- commit/rollback
- close resources
```

Usage time tinggi berarti connection tertahan lama.

Kemungkinan penyebab:

```text
1. Query lambat.
2. Fetch result besar.
3. Batch besar.
4. Lock wait.
5. Transaction terlalu panjang.
6. Application melakukan remote HTTP call dalam transaction.
7. Application melakukan CPU-heavy processing sambil connection masih terbuka.
8. Streaming response ke client sambil ResultSet masih terbuka.
9. Connection leak.
```

Rule penting:

```text
Pool starvation biasanya disebabkan bukan oleh pool,
tetapi oleh connection usage time yang terlalu lama.
```

---

## 10. Connection Creation Time

Connection creation time adalah waktu membuat physical connection baru ke database.

```text
creation time = TCP/TLS/auth/session setup sampai connection siap
```

Creation time tinggi bisa berarti:

```text
- database listener lambat
- network latency
- DNS issue
- TLS handshake lambat
- authentication lambat
- database sedang overloaded
- connection limit hampir tercapai
- cloud database failover/restart
```

Dalam pool yang stabil, connection creation seharusnya relatif jarang terjadi setelah warm-up.

Jika creation time sering muncul saat traffic tinggi, bisa jadi:

```text
- minimumIdle terlalu rendah untuk burst profile
- maxLifetime terlalu sinkron sehingga banyak connection retire bersamaan
- DB/firewall sering memutus idle connection
- keepalive/maxLifetime tidak sesuai infra
- database sering membunuh session
```

---

## 11. Connection Timeout Count

Connection timeout count meningkat ketika thread gagal mendapatkan connection sebelum `connectionTimeout`.

Ini adalah failure yang sangat user-visible.

```text
request -> getConnection() -> menunggu -> timeout -> SQLException
```

Interpretasi:

```text
timeout naik + active = max + pending tinggi
  -> pool exhausted

timeout naik + active rendah
  -> kemungkinan pool broken, DB unavailable, atau connection creation gagal

timeout naik setelah deploy
  -> regression workload, leak, query lambat, pool config berubah, replica count bertambah
```

Jangan hanya menaikkan `connectionTimeout`.

Menaikkan `connectionTimeout` biasanya hanya membuat request menunggu lebih lama sebelum gagal.

Yang perlu ditemukan:

```text
Kenapa connection tidak kembali cukup cepat?
```

---

## 12. Leak Detection Log

HikariCP punya `leakDetectionThreshold` untuk membantu mendeteksi connection yang dipinjam terlalu lama. Jika connection tidak dikembalikan melewati threshold, HikariCP akan mencatat warning beserta stack trace tempat connection dipinjam.

Mental model penting:

```text
leak detection bukan bukti mutlak memory/resource leak.
```

Ia berarti:

```text
connection dipinjam lebih lama dari threshold
```

Penyebabnya bisa:

```text
1. Benar-benar lupa close.
2. Query sangat lambat.
3. Transaction panjang.
4. Batch besar.
5. Thread blocked di remote call.
6. ResultSet streaming lama.
7. GC pause besar.
8. Debugger breakpoint.
```

Gunakan leak detection sebagai diagnosis, bukan sebagai monitoring permanen yang terlalu agresif.

Threshold terlalu rendah akan menghasilkan noise.

Contoh:

```properties
# Hanya contoh. Sesuaikan dengan SLA dan workload.
spring.datasource.hikari.leak-detection-threshold=30000
```

Jika normal transaction p99 adalah 20s, threshold 5s akan noisy.

Jika normal transaction p99 adalah 200ms, threshold 30s cukup berguna untuk anomali.

---

## 13. JDBC Operation Metrics: Yang Tidak Selalu Disediakan Pool

HikariCP tahu tentang connection lifecycle, bukan detail setiap query.

HikariCP bisa menjawab:

```text
berapa lama connection dipinjam?
berapa banyak pending?
berapa active/idle?
```

Tetapi HikariCP tidak otomatis tahu:

```text
SQL mana yang lambat?
berapa rows returned?
berapa rows updated?
berapa batch size?
commit lambat atau execute lambat?
SQLState apa paling sering?
```

Untuk itu kita perlu instrumentation di layer repository/JDBC wrapper/framework.

Jika memakai Spring JDBC, jOOQ, MyBatis, atau Hibernate, sebagian observability dapat diambil dari framework/logging/instrumentation. Jika memakai plain JDBC, kamu perlu membuat wrapper atau helper yang konsisten.

---

## 14. Metrik Query Latency

Minimal catat latency untuk operasi berikut:

```text
executeQuery
executeUpdate
executeBatch
executeLargeBatch
execute
commit
rollback
getConnection/acquire
```

Dimensi yang berguna:

```text
operation_type: SELECT / INSERT / UPDATE / DELETE / MERGE / CALL / BATCH / COMMIT / ROLLBACK
statement_name: nama logical query, bukan full SQL raw
repository: class/module repository
pool: nama pool
success: true/false
sql_state_class: 23 / 40 / 08 / HY / etc
exception_type: SQLTimeoutException / SQLIntegrityConstraintViolationException / etc
```

Hindari label metric dengan raw SQL lengkap atau bind value.

Buruk:

```text
sql="select * from users where email='alice@example.com'"
```

Masalah:

```text
- cardinality tinggi
- PII bocor
- metric backend mahal
- dashboard sulit dibaca
```

Lebih baik:

```text
statement_name="CaseRepository.findOpenCasesByOfficer"
operation_type="SELECT"
module="case-management"
```

---

## 15. Rows Returned dan Rows Affected

Latency tanpa row count sering menyesatkan.

Contoh:

```text
Query A: 500ms, rows=1
Query B: 500ms, rows=200000
```

Keduanya sama-sama 500ms, tetapi diagnosisnya berbeda.

Untuk SELECT:

```text
rows_returned
```

Untuk DML:

```text
rows_affected
```

Untuk batch:

```text
batch_size
batch_success_count
batch_failed_count
```

Interpretasi:

```text
latency tinggi + rows rendah
  -> index, lock, bad plan, network, parse, DB CPU

latency tinggi + rows sangat tinggi
  -> result terlalu besar, pagination buruk, fetch/buffer cost

rows_affected jauh di atas ekspektasi
  -> missing predicate, bug filter, dangerous bulk operation

rows_returned nol tetapi latency tinggi
  -> missing index, bad predicate, lock, full scan
```

---

## 16. Separating Execute Time and Fetch Time

`executeQuery()` tidak selalu berarti semua rows sudah diambil ke aplikasi. Tergantung driver, result set type, fetch size, cursor mode, dan database.

Secara konseptual:

```text
execute time = database mulai/mengeksekusi statement sampai ResultSet siap
fetch time   = waktu membaca rows dari ResultSet sampai selesai
```

Contoh bug observability:

```java
long start = System.nanoTime();
ResultSet rs = ps.executeQuery();
long sqlMs = elapsed(start);

while (rs.next()) {
    mapRow(rs);
}
```

Log `sqlMs` hanya mencakup `executeQuery()`, bukan seluruh fetch.

Untuk query besar, waktu sebenarnya bisa ada di loop `rs.next()`.

Instrumentation lebih baik:

```java
long executeStart = System.nanoTime();
try (ResultSet rs = ps.executeQuery()) {
    long executeMs = elapsedMillis(executeStart);

    long fetchStart = System.nanoTime();
    int rows = 0;
    while (rs.next()) {
        rows++;
        mapRow(rs);
    }
    long fetchMs = elapsedMillis(fetchStart);

    metrics.record("query.execute", executeMs);
    metrics.record("query.fetch", fetchMs);
    metrics.record("query.rows", rows);
}
```

Ini membantu membedakan:

```text
DB lambat mengeksekusi
vs
aplikasi lambat mengambil/memproses rows
```

---

## 17. Commit dan Rollback Juga Perlu Diobservasi

Engineer sering hanya mengukur query, padahal `commit()` bisa mahal.

Commit dapat mencakup:

```text
- flush WAL/redo log
- fsync / durability step
- constraint/deferred check
- lock release
- replication-related wait
- network round-trip
```

Rollback juga bisa mahal jika transaction sudah melakukan banyak perubahan.

Metrik penting:

```text
transaction.duration
transaction.commit.duration
transaction.rollback.duration
transaction.statements.count
transaction.rows_affected.total
transaction.outcome = committed / rolled_back / failed
```

Jika `executeUpdate()` cepat tetapi `commit()` lambat, jangan salah tuning query.

---

## 18. SQLState sebagai Dimensi Observability

`SQLException` membawa `SQLState`, vendor error code, message, dan chain exception. SQLState sangat berguna untuk klasifikasi error lintas database, walau tidak sempurna.

Contoh kelas SQLState umum:

```text
08xxx -> connection exception
22xxx -> data exception
23xxx -> integrity constraint violation
25xxx -> invalid transaction state
28xxx -> invalid authorization
40xxx -> transaction rollback, serialization/deadlock class
42xxx -> syntax/access rule violation
HYxxx -> general/driver-defined condition, sering ODBC-style/vendor-specific
```

Metric/log sebaiknya menyimpan:

```text
sql_state
sql_state_class
vendor_code
exception_class
statement_name
operation_type
pool_name
```

Contoh log terstruktur:

```json
{
  "event": "jdbc.operation.failed",
  "trace_id": "4f9a...",
  "span_id": "b72c...",
  "module": "case-management",
  "repository": "CaseRepository",
  "statement_name": "transitionCaseState",
  "operation_type": "UPDATE",
  "pool": "oltp-main",
  "duration_ms": 1842,
  "sql_state": "40001",
  "sql_state_class": "40",
  "vendor_code": 1213,
  "exception_class": "SQLTransactionRollbackException",
  "retryable": true
}
```

Dengan ini kamu bisa menjawab:

```text
Apakah error terbanyak constraint violation?
Deadlock?
Connection reset?
Authorization?
Syntax regression setelah deploy?
```

---

## 19. Logging SQL: Berguna, Tapi Berbahaya

SQL logging membantu diagnosis, tetapi raw SQL sering mengandung risiko:

```text
- PII
- credential/token
- national ID
- email/phone/address
- financial data
- case detail sensitif
- cardinality tinggi pada log/metrics
```

Prinsip:

```text
Log nama logical statement, bukan selalu full SQL.
Log bind metadata, bukan nilai bind sensitif.
Untuk debug environment, full SQL boleh dengan kontrol ketat.
Untuk production, default harus redacted.
```

Contoh aman:

```json
{
  "event": "jdbc.slow_query",
  "statement_name": "ApplicantRepository.findByIdentifier",
  "operation_type": "SELECT",
  "duration_ms": 1320,
  "rows_returned": 1,
  "bind_count": 1,
  "bind_types": ["VARCHAR"],
  "sql_hash": "sha256:9c1b...",
  "sql_template": "select ... from applicant where identifier = ?"
}
```

Contoh tidak aman:

```json
{
  "sql": "select * from applicant where nric='S1234567A'"
}
```

---

## 20. SQL Template, SQL Hash, dan Statement Name

Untuk observability yang scalable, gunakan tiga level identitas SQL:

```text
1. statement_name
   Nama eksplisit dari kode aplikasi.

2. sql_template
   SQL dengan placeholder, tanpa bind value.

3. sql_hash
   Hash dari normalized SQL template.
```

Contoh:

```text
statement_name = CaseRepository.findCasesForOfficerDashboard
sql_template   = select c.id, c.status, c.created_at from case c where c.officer_id = ? and c.status in (?, ?) order by c.created_at desc fetch first ? rows only
sql_hash       = sha256:ab12...
```

Kenapa perlu statement name?

Karena SQL bisa berubah minor tetapi use case tetap sama.

Kenapa perlu SQL hash?

Karena DB-side monitoring sering mengidentifikasi SQL by SQL ID/hash. Dengan SQL hash aplikasi, kita bisa membuat mapping lebih mudah.

---

## 21. Trace: Menghubungkan Request ke Query

Distributed tracing menjawab:

```text
Request mana menjalankan query apa?
Query itu terjadi di span mana?
Berapa lama dibanding total request?
Apakah query terjadi sebelum/selama/di luar transaction?
```

Struktur trace ideal:

```text
HTTP POST /cases/{id}/transition
  ├─ auth/authorization
  ├─ service: transitionCase
  │   ├─ jdbc.acquire_connection
  │   ├─ tx.begin
  │   ├─ jdbc.update CaseRepository.lockCaseForUpdate
  │   ├─ jdbc.select RuleRepository.findApplicableRules
  │   ├─ jdbc.insert AuditTrailRepository.insertEntry
  │   ├─ tx.commit
  │   └─ event.outbox.enqueue
  └─ response
```

Span JDBC sebaiknya punya atribut:

```text
statement_name
operation_type
pool_name
db.system
db.name
db.user (hati-hati, boleh service user saja)
db.operation
rows_returned/rows_affected
sql_state on error
```

OpenTelemetry menyediakan instrumentation Java yang dapat menangkap telemetry melalui Java agent dan instrumentation untuk banyak library/framework, termasuk area JDBC dalam beberapa mode instrumentation. Namun tetap perlu berhati-hati dengan sanitasi statement dan cardinality.

---

## 22. Jangan Trace Raw Bind Value

Trace backend sering diakses banyak engineer. Jangan masukkan bind value sensitif.

Buruk:

```text
db.statement = select * from applicant where nric = 'S1234567A'
```

Lebih aman:

```text
db.statement = select * from applicant where nric = ?
app.statement_name = ApplicantRepository.findByIdentifier
app.bind_count = 1
```

Untuk troubleshooting ekstrem, siapkan mekanisme controlled debug:

```text
- hanya environment non-prod
- atau prod dengan explicit temporary flag
- sampling sangat rendah
- redaction wajib
- approval/audit jika data sensitif
```

---

## 23. Database Correlation: Masalah Terbesar Observability JDBC

Aplikasi melihat:

```text
trace_id=abc123
statement_name=CaseRepository.transition
thread=http-nio-42
pool=oltp-main
```

Database melihat:

```text
session_id=783
backend_pid=91823
user=app_user
client_addr=10.2.3.4
query=update case set status = ...
wait_event=transactionid
```

Tanpa correlation, app team dan DBA sulit bicara dengan bahasa yang sama.

Targetnya:

```text
trace_id/request_id dari aplikasi bisa ditemukan di database session atau minimal di database query/session metadata.
```

Cara umum:

```text
1. Set application name/module/action/client identifier per connection/session.
2. Tambahkan SQL comment dengan trace id atau statement name.
3. Gunakan DB-specific session context.
4. Gunakan logging proxy/instrumentation yang menghubungkan SQL dengan trace.
```

Masing-masing punya trade-off.

---

## 24. Application Name / Module / Client Identifier

Beberapa database/driver mendukung session metadata.

Contoh konsep:

```text
PostgreSQL:
  application_name

Oracle:
  MODULE, ACTION, CLIENT_IDENTIFIER melalui DBMS_APPLICATION_INFO / client info tertentu

SQL Server:
  application name connection property

MySQL:
  connection attributes / performance schema visibility tergantung versi/driver/config
```

Tujuan:

```text
DBA dapat melihat session berasal dari service/module apa.
```

Contoh level connection URL PostgreSQL:

```properties
jdbc:postgresql://db:5432/app?ApplicationName=case-service
```

Tetapi application name statis hanya memberi service-level visibility, bukan request-level visibility.

Untuk request-level, perlu mekanisme yang bisa berubah per request/transaction.

---

## 25. Request-Level DB Session Tagging

Request-level tagging berarti aplikasi menyetel metadata session saat connection dipinjam.

Contoh konsep:

```text
on borrow connection:
  set session trace id / module / action
execute SQL
on return connection:
  reset/clear metadata
```

Tantangan:

```text
1. Setting session metadata sendiri adalah SQL/round-trip tambahan.
2. Harus di-reset agar tidak bocor ke request berikutnya.
3. Tidak semua database punya mekanisme yang sama.
4. Tidak boleh dilakukan terlalu sering jika overhead tinggi.
5. Harus aman saat exception.
```

Pseudo-code:

```java
try (Connection connection = dataSource.getConnection()) {
    SessionTag previous = tagSession(connection, traceId, module, action);
    try {
        executeBusinessSql(connection);
    } finally {
        clearSessionTag(connection, previous);
    }
}
```

Jika tidak di-clear, pool akan mengembalikan connection dengan metadata lama.

Akibat:

```text
DBA melihat session request B tetapi client_identifier masih milik request A.
```

Itu observability corruption.

---

## 26. SQL Comments untuk Correlation

Alternatif lain adalah menambahkan comment ke SQL template.

Contoh:

```sql
/* service=case-service statement=CaseRepository.transition trace=abc123 */
update case_record
set status = ?
where id = ?
```

Kelebihan:

```text
- Mudah terlihat di DB active query view.
- Tidak perlu session mutation terpisah.
- Bisa membawa statement name.
```

Kekurangan:

```text
- Bisa mengganggu statement/plan cache jika comment berisi trace id unik.
- Menambah cardinality SQL text.
- Bisa terekspos di logs.
- Perlu sanitasi ketat.
```

Praktik lebih aman:

```text
Masukkan statement_name/service/module yang low-cardinality.
Hindari trace id unik dalam SQL text jika database plan cache sensitif terhadap text.
Gunakan trace id di logs/traces, bukan selalu di SQL comment.
```

Contoh lebih aman:

```sql
/* service=case-service statement=CaseRepository.transition */
update case_record set status = ? where id = ?
```

---

## 27. Pool Name sebagai Observability Dimension

Dalam aplikasi serius, sering ada lebih dari satu pool:

```text
oltp-main
reporting-readonly
batch-writer
audit-writer
migration-tool
```

Semua metric/log harus punya `pool_name`.

Kenapa?

Karena jika hanya ada:

```text
hikaricp.connections.active = 50
```

kamu tidak tahu apakah yang penuh adalah:

```text
- OLTP pool
- reporting pool
- background worker pool
- audit pool
```

Dengan pool name:

```text
hikaricp.connections.active{pool="oltp-main"}=8
hikaricp.connections.active{pool="reporting"}=30
hikaricp.connections.active{pool="audit"}=2
```

Diagnosis menjadi jelas.

---

## 28. Observing Transaction Duration

Transaction duration adalah salah satu metrik paling penting namun sering tidak ada.

Transaction terlalu lama menyebabkan:

```text
- connection tertahan
- lock tertahan
- MVCC bloat/version retention
- idle-in-transaction
- deadlock probability naik
- pool starvation
```

Catat:

```text
transaction.start_time
transaction.duration_ms
transaction.statement_count
transaction.outcome
transaction.rollback_reason
transaction.isolation_level
transaction.read_only
```

Jika memakai framework transaction manager, instrument di boundary transaction.

Jika plain JDBC, boundary-nya eksplisit:

```java
connection.setAutoCommit(false);
long txStart = System.nanoTime();
try {
    // SQL operations
    connection.commit();
    recordTx("committed", elapsedMillis(txStart));
} catch (Exception e) {
    connection.rollback();
    recordTx("rolled_back", elapsedMillis(txStart));
    throw e;
}
```

---

## 29. Idle-in-Transaction: Silent Killer

`idle in transaction` berarti aplikasi membuka transaction, menjalankan sesuatu, lalu diam tanpa commit/rollback.

Di sisi aplikasi, gejalanya bisa tidak jelas.

Di sisi database, efeknya parah:

```text
- lock bisa tertahan
- row version lama tidak bisa dibersihkan
- vacuum/cleanup terganggu pada MVCC database tertentu
- blocking chain muncul
- connection tetap active/borrowed
```

Penyebab umum:

```text
1. Exception tertelan tanpa rollback.
2. Remote API call dilakukan setelah query tetapi sebelum commit.
3. User interaction/streaming dilakukan di dalam transaction.
4. Lazy loading di luar boundary yang jelas.
5. Transaction manager misuse.
```

Alert database-side untuk idle-in-transaction sangat penting.

App-side, transaction duration p99 dan connection usage p99 biasanya menjadi sinyal awal.

---

## 30. Slow Query Log di Application Layer

Database slow query log penting, tetapi application slow query log tetap perlu.

Kenapa?

Karena application log bisa membawa:

```text
- trace id
- user/request context yang sudah disanitasi
- module/use case
- statement name
- transaction id logical
- pool name
- rows returned
- retry attempt
- feature flag/version
```

Template slow query log:

```json
{
  "event": "jdbc.slow_operation",
  "severity": "WARN",
  "trace_id": "...",
  "service": "case-service",
  "module": "case-management",
  "pool": "oltp-main",
  "repository": "CaseRepository",
  "statement_name": "findCasesForDashboard",
  "operation_type": "SELECT",
  "duration_ms": 1260,
  "execute_ms": 240,
  "fetch_ms": 1020,
  "rows_returned": 5000,
  "threshold_ms": 500,
  "sql_hash": "sha256:..."
}
```

Perhatikan pemisahan execute/fetch.

---

## 31. Threshold Slow Query Jangan Satu Angka untuk Semua

Threshold `slow query > 1s` terlalu kasar.

Sebaiknya threshold berbeda per kategori:

```text
OLTP lookup by ID:
  warning > 100ms
  critical > 500ms

Dashboard query:
  warning > 500ms
  critical > 2s

Reporting query:
  warning > 5s
  critical > 30s

Batch chunk:
  warning > 10s
  critical > 60s
```

Lebih baik lagi, gunakan statement-specific threshold:

```text
CaseRepository.findById                warn=100ms
CaseRepository.findDashboard           warn=700ms
AuditTrailRepository.search            warn=2s
ReportRepository.generateMonthlyExport warn=30s
```

Ini mengurangi noise dan meningkatkan signal.

---

## 32. Query Fingerprinting dan Cardinality Control

Metrics backend tidak suka cardinality tinggi.

Buruk:

```text
metric label:
  sql="select * from case where id = 100001"
  sql="select * from case where id = 100002"
  sql="select * from case where id = 100003"
```

Ini membuat seri metric meledak.

Gunakan fingerprint:

```text
statement_name="CaseRepository.findById"
sql_hash="sha256:..."
operation_type="SELECT"
```

Jika perlu dynamic SQL, normalize:

```sql
select * from case where id = ?
```

Bukan:

```sql
select * from case where id = 123
```

---

## 33. Observability untuk Batch

Batch workload punya dimensi khusus.

Catat:

```text
batch_name
chunk_number
batch_size
execute_batch_duration_ms
rows_attempted
rows_succeeded
rows_failed
partial_failure
transaction_duration_ms
retry_attempt
```

Contoh:

```json
{
  "event": "jdbc.batch.completed",
  "batch_name": "AuditArchiveJob.copyChunk",
  "pool": "batch-writer",
  "chunk_number": 42,
  "batch_size": 1000,
  "duration_ms": 1870,
  "rows_succeeded": 1000,
  "rows_failed": 0,
  "transaction_duration_ms": 1920
}
```

Jika batch gagal:

```json
{
  "event": "jdbc.batch.failed",
  "batch_name": "AuditArchiveJob.copyChunk",
  "chunk_number": 43,
  "batch_size": 1000,
  "duration_ms": 2300,
  "sql_state": "23505",
  "vendor_code": 1,
  "partial_failure": true,
  "rows_succeeded_before_failure": 384
}
```

---

## 34. Observability untuk LOB/Streaming

LOB dan streaming result bisa menahan connection lama.

Catat:

```text
lob_type: BLOB/CLOB/NCLOB/SQLXML
bytes_read/bytes_written
characters_read/characters_written
stream_duration_ms
connection_usage_ms
```

Untuk audit trail CLOB/search/export, gejala umum:

```text
- query execute terlihat cepat
- fetch/stream sangat lama
- connection usage tinggi
- memory pressure naik jika CLOB dimaterialize
- network egress naik
```

Slow operation log harus bisa memperlihatkan ini:

```json
{
  "event": "jdbc.lob.stream.completed",
  "statement_name": "AuditTrailRepository.exportFullText",
  "lob_type": "CLOB",
  "rows_returned": 1000,
  "characters_read": 75000000,
  "duration_ms": 45000,
  "connection_usage_ms": 45200
}
```

---

## 35. Observability untuk Locks dan Deadlocks

Lock wait sering terlihat sebagai query lambat, padahal plan bisa saja bagus.

Aplikasi perlu menandai error seperti:

```text
deadlock
lock timeout
serialization failure
```

Database-side perlu dashboard:

```text
blocking sessions
blocked sessions
lock wait duration
wait event
transaction age
query text/fingerprint
application name/module
```

Application-side log pada error:

```json
{
  "event": "jdbc.lock_related_failure",
  "statement_name": "CaseRepository.transitionState",
  "operation_type": "UPDATE",
  "duration_ms": 5000,
  "sql_state": "40001",
  "exception_class": "SQLTransactionRollbackException",
  "classification": "serialization_or_deadlock",
  "retryable": true,
  "attempt": 1
}
```

Retry harus diobservasi juga.

Jika retry berhasil, tetap catat:

```text
first attempt failed due to serialization/deadlock
second attempt succeeded
```

Tanpa itu, sistem terlihat sehat padahal ada lock contention tersembunyi.

---

## 36. Retry Observability

Retry yang tidak terlihat adalah bahaya.

Metrik/log:

```text
retry.count
retry.attempt
retry.reason
retry.success_after_attempts
retry.exhausted
retry.backoff_ms
```

Contoh:

```json
{
  "event": "jdbc.retry",
  "statement_name": "CaseRepository.claimNextCase",
  "reason": "deadlock",
  "sql_state": "40001",
  "attempt": 2,
  "max_attempts": 3,
  "backoff_ms": 150
}
```

Jika retry rate naik, meskipun success rate masih tinggi, itu sinyal contention.

---

## 37. Dashboard Minimum untuk HikariCP/JDBC

Dashboard minimum sebaiknya punya panel berikut:

```text
1. Pool active/idle/total/max by pool.
2. Pending threads by pool.
3. Connection acquisition latency p50/p95/p99.
4. Connection usage latency p50/p95/p99.
5. Connection timeout count/rate.
6. Connection creation latency/rate.
7. JDBC operation latency by statement group.
8. Slow operation count by statement group.
9. SQL error rate by SQLState class.
10. Transaction duration p50/p95/p99.
11. Commit/rollback duration.
12. Rows returned/affected distribution for top statements.
13. Retry rate by reason.
14. Leak detection count.
15. DB active sessions / wait events / lock waits.
```

Dashboard harus menjawab diagnosis cepat:

```text
Apakah bottleneck di pool, query, lock, database, network, atau application-held connection?
```

---

## 38. Alert Design: Jangan Alert Semua Noise

Alert yang buruk:

```text
active connections > 80% selama 1 menit
```

Kenapa buruk?

Karena active tinggi belum tentu masalah.

Alert lebih baik:

```text
pending connections > 0 selama 5 menit
AND acquisition p95 > 500ms
```

atau:

```text
connection timeout count > 0 dalam 5 menit
```

atau:

```text
active == maximumPoolSize
AND pending > 0
AND usage p95 meningkat 3x baseline
```

Alert harus actionable.

Contoh alert penting:

```text
1. Connection acquisition timeout terjadi.
2. Pending threads sustained > threshold.
3. Usage p99 melewati SLA selama N menit.
4. Leak detection muncul.
5. SQLState class 08 meningkat.
6. SQLState class 40 meningkat.
7. Constraint violation meningkat setelah deploy.
8. Transaction duration p99 naik drastis.
9. DB lock wait meningkat.
10. Idle-in-transaction session melewati threshold.
```

---

## 39. Interpreting Common Patterns

### Pattern 1 — Pool Exhaustion karena Query Lambat

```text
active = max
idle = 0
pending naik
acquire p99 naik
usage p99 naik
query latency p99 naik
DB CPU/IO tinggi
```

Kemungkinan:

```text
- query lambat menahan connection
- database saturated
- index/plan regression
```

Tindakan:

```text
- lihat top slow statements
- lihat DB execution plan/wait event
- jangan langsung tambah pool
```

---

### Pattern 2 — Pool Exhaustion karena Connection Leak

```text
active naik sampai max
idle turun ke 0
pending naik
usage time sangat panjang/tidak selesai
leak detection warning muncul
DB query activity tidak sebanding dengan active connection
```

Kemungkinan:

```text
- connection tidak di-close
- ResultSet/stream ditahan
- thread stuck setelah borrow
```

Tindakan:

```text
- gunakan leak stack trace
- cari path tanpa try-with-resources
- cari async/lazy stream yang membawa connection keluar scope
```

---

### Pattern 3 — Pool Penuh tapi DB Idle

```text
active = max
pending tinggi
DB CPU rendah
DB active query rendah
connection usage tinggi
thread dump menunjukkan blocked di HTTP call / filesystem / lock app
```

Kemungkinan:

```text
application menahan connection saat melakukan pekerjaan non-DB
```

Tindakan:

```text
- kecilkan transaction scope
- jangan panggil remote service dalam transaction
- jangan proses file besar sambil connection terbuka
```

---

### Pattern 4 — Banyak Connection Creation

```text
creation rate tinggi
creation latency naik
total connections fluktuatif
SQLState 08 muncul
DB/network log menunjukkan disconnect
```

Kemungkinan:

```text
- DB restart/failover
- firewall/NAT idle timeout
- maxLifetime/keepalive tidak sesuai
- database membunuh idle session
```

Tindakan:

```text
- cek maxLifetime < infra/server idle kill threshold
- cek keepaliveTime
- cek DB logs
- cek network idle timeout
```

---

### Pattern 5 — Constraint Violation Spike Setelah Deploy

```text
SQLState class 23 naik
error rate naik setelah deploy
pool metric normal
query latency normal
```

Kemungkinan:

```text
- regression validation
- duplicate insert
- idempotency bug
- unique key assumption salah
```

Tindakan:

```text
- lihat statement_name error tertinggi
- lihat release diff
- cek idempotency/transaction boundary
```

---

### Pattern 6 — Deadlock/Serialization Failure Spike

```text
SQLState class 40 naik
retry rate naik
some requests succeed after retry
latency p95/p99 naik
DB lock wait/deadlock log naik
```

Kemungkinan:

```text
- order update tidak konsisten
- workload concurrent meningkat
- transaction terlalu panjang
- isolation lebih ketat
- index hilang menyebabkan lock lebih luas
```

Tindakan:

```text
- standardize lock acquisition order
- pendekkan transaction
- pastikan predicate indexed
- retry hanya untuk safe transaction boundary
```

---

## 40. Thread Dump sebagai Observability Pendukung

Saat pool penuh, thread dump sangat berguna.

Cari thread yang:

```text
- menunggu Hikari pool getConnection
- sedang execute JDBC driver call
- sedang ResultSet.next
- sedang commit/rollback
- sedang blocked di remote call tapi sudah memegang connection
- stuck di synchronized lock aplikasi
```

Thread dump bisa membedakan:

```text
pool wait
vs
DB execute wait
vs
application code holding connection
```

Contoh diagnosis:

```text
100 thread pending di Hikari getConnection
20 thread active memegang connection
Dari 20 active, 15 blocked di HTTP client call
```

Kesimpulan:

```text
Masalah bukan database; transaction scope salah.
```

---

## 41. Database-Side Views yang Perlu Dihubungkan

Tiap database punya views/tools berbeda, tetapi konsepnya sama.

Yang perlu dilihat:

```text
1. Active sessions.
2. Idle-in-transaction sessions.
3. Blocking/blocked sessions.
4. Long-running queries.
5. Wait events.
6. Transaction age.
7. Open cursors.
8. Temporary space usage.
9. SQL text / SQL id / query id.
10. Client address/application name/module.
```

Contoh mapping konseptual:

```text
Application trace_id
  -> statement_name/sql_hash
  -> pool_name
  -> DB application_name/module
  -> DB session/backend pid
  -> DB wait event/query id
```

Ini yang memungkinkan app engineer dan DBA menyelesaikan masalah bersama.

---

## 42. Observability untuk Multi-Replica Kubernetes

Dalam Kubernetes, satu service bisa punya banyak pod.

Total connection capacity:

```text
total_max_connections = replicas * maximumPoolSize per pod
```

Dashboard harus bisa melihat:

```text
per pod
per service
per pool
cluster total
```

Contoh:

```text
case-service replicas = 10
maximumPoolSize = 20
potential DB connections = 200
```

Jika scale-out ke 30 pods:

```text
potential DB connections = 600
```

Tanpa dashboard cluster-level, kamu bisa salah melihat tiap pod sehat padahal database kelebihan session total.

Panel penting:

```text
sum(hikaricp.connections.max) by service/pool
total active connections by service/pool
DB sessions by application_name/client_addr
```

---

## 43. Observability untuk Read/Write Split dan Multi-Pool

Jika ada pool berbeda:

```text
writePool -> primary DB
readPool  -> replica DB
reportPool -> reporting replica
```

Maka metric harus menunjukkan:

```text
pool_name
db_role = primary/replica/reporting
datasource_name
```

Masalah umum:

```text
read replica lag tinggi
read pool penuh
write pool sehat
user melihat stale data
```

Jika semua metric digabung, diagnosis kabur.

---

## 44. Observability untuk Background Jobs

Background job sering menjadi penyebab gangguan OLTP.

Job harus mencatat:

```text
job_name
run_id
chunk_id
pool_name
rows_processed
rows_per_second
db_time_ms
transaction_duration_ms
retry_count
failure_classification
```

Gunakan pool terpisah jika job bisa berat.

Jika job menggunakan pool OLTP yang sama, dashboard harus bisa menunjukkan statement/job mana yang menahan connection.

---

## 45. PII dan Regulatory Safety di Observability

Untuk sistem regulasi/case management, observability sendiri bisa menjadi data leakage vector.

Hindari log:

```text
- full name
- email
- phone
- NRIC/NIK/passport
- address
- case narrative
- document content
- full CLOB audit metadata
- access token/session token
```

Gunakan:

```text
- internal technical id jika aman
- hashed identifier dengan salt yang dikontrol
- statement_name
- trace_id
- case category, bukan detail sensitif
- counts/status enum yang low sensitivity
```

Prinsip:

```text
Observability harus menjawab problem teknis tanpa membuka data bisnis yang tidak perlu.
```

---

## 46. Implementasi Plain JDBC Instrumentation

Contoh wrapper sederhana untuk operation metric.

```java
public final class JdbcObserver {
    private final Metrics metrics;
    private final Logger log;

    public <T> T observeQuery(
            String poolName,
            String repository,
            String statementName,
            String operationType,
            SqlOperation<T> operation
    ) throws SQLException {
        long start = System.nanoTime();
        boolean success = false;
        try {
            T result = operation.execute();
            success = true;
            return result;
        } catch (SQLException e) {
            long durationMs = elapsedMillis(start);
            String sqlState = e.getSQLState();
            String sqlStateClass = sqlState != null && sqlState.length() >= 2
                    ? sqlState.substring(0, 2)
                    : "unknown";

            metrics.increment("jdbc.operation.error", tags(
                    "pool", poolName,
                    "repository", repository,
                    "statement", statementName,
                    "operation", operationType,
                    "sql_state_class", sqlStateClass,
                    "exception", e.getClass().getSimpleName()
            ));

            log.warn("jdbc operation failed pool={} repository={} statement={} operation={} durationMs={} sqlState={} vendorCode={} exception={}",
                    poolName,
                    repository,
                    statementName,
                    operationType,
                    durationMs,
                    sqlState,
                    e.getErrorCode(),
                    e.getClass().getName());
            throw e;
        } finally {
            long durationMs = elapsedMillis(start);
            metrics.timer("jdbc.operation.duration", tags(
                    "pool", poolName,
                    "repository", repository,
                    "statement", statementName,
                    "operation", operationType,
                    "success", Boolean.toString(success)
            )).record(durationMs);
        }
    }

    private static long elapsedMillis(long startNanos) {
        return java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
    }

    @FunctionalInterface
    public interface SqlOperation<T> {
        T execute() throws SQLException;
    }
}
```

Catatan:

```text
- Ini pseudo-production style, bukan library final.
- Metrics/tags disederhanakan.
- Jangan jadikan raw SQL sebagai tag.
- statementName harus low-cardinality.
```

---

## 47. Contoh Repository dengan Observability

```java
public final class CaseRepository {
    private final DataSource dataSource;
    private final JdbcObserver observer;

    public CaseRecord findById(long caseId) throws SQLException {
        return observer.observeQuery(
                "oltp-main",
                "CaseRepository",
                "findById",
                "SELECT",
                () -> doFindById(caseId)
        );
    }

    private CaseRecord doFindById(long caseId) throws SQLException {
        String sql = """
                select id, status, assigned_officer_id, updated_at
                from case_record
                where id = ?
                """;

        try (Connection connection = dataSource.getConnection();
             PreparedStatement ps = connection.prepareStatement(sql)) {

            ps.setLong(1, caseId);

            long executeStart = System.nanoTime();
            try (ResultSet rs = ps.executeQuery()) {
                long executeMs = elapsedMillis(executeStart);

                long fetchStart = System.nanoTime();
                if (!rs.next()) {
                    recordFetch(0, elapsedMillis(fetchStart));
                    return null;
                }

                CaseRecord record = mapCase(rs);
                recordFetch(1, elapsedMillis(fetchStart));
                recordExecute(executeMs);
                return record;
            }
        }
    }
}
```

Hal penting:

```text
- Connection scope kecil.
- Statement punya logical statement name.
- Execute/fetch dapat dipisah jika perlu.
- Tidak ada bind sensitive value di log.
```

---

## 48. HikariCP JMX/MBeans

HikariCP dapat mengekspos MBeans jika `registerMbeans` diaktifkan.

Konsepnya:

```properties
spring.datasource.hikari.register-mbeans=true
```

Dengan JMX, operator dapat melihat/manipulasi beberapa aspek pool, tergantung versi dan konfigurasi.

Kegunaan:

```text
- inspeksi pool runtime
- melihat active/idle/pending
- debugging operasional
```

Namun untuk production monitoring modern, biasanya metrik dikirim ke Prometheus/OTLP/Datadog/New Relic/etc melalui Micrometer/OpenTelemetry/agent.

JMX bagus sebagai tambahan, bukan satu-satunya observability.

---

## 49. Spring Boot/Micrometer Context

Dalam Spring Boot modern, HikariCP sering menjadi default pool ketika ada di classpath dan DataSource auto-config aktif. Spring Boot Actuator menggunakan Micrometer sebagai facade metrics dan dapat mengekspos metrik ke banyak backend monitoring.

Contoh property konseptual:

```properties
management.endpoints.web.exposure.include=health,metrics,prometheus
management.endpoint.health.show-details=when_authorized
management.metrics.tags.application=case-service
```

Untuk Hikari-specific property:

```properties
spring.datasource.hikari.pool-name=oltp-main
spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=10
spring.datasource.hikari.connection-timeout=3000
spring.datasource.hikari.leak-detection-threshold=30000
```

Catatan:

```text
Nama metric dan exposure endpoint tergantung versi Spring Boot, registry, dan konfigurasi.
Validasi di environment aktual, jangan hanya percaya asumsi nama metric.
```

---

## 50. Health Check Bukan Observability yang Cukup

Health check DataSource biasanya menjawab:

```text
apakah aplikasi bisa melakukan query validasi sederhana?
```

Itu berguna, tetapi tidak menjawab:

```text
- apakah pool hampir penuh?
- apakah p99 acquire latency buruk?
- apakah transaction lama?
- apakah banyak deadlock?
- apakah query dashboard lambat?
- apakah database lock wait tinggi?
```

Health check boleh hijau sementara user tetap mengalami timeout.

Jangan jadikan `/health` sebagai satu-satunya indikator DB sehat.

---

## 51. Sampling Strategy

Tidak semua query harus dilog detail setiap saat.

Strategi:

```text
1. Metrics untuk semua operasi.
2. Structured log untuk slow/error operations.
3. Trace sampling untuk sebagian request.
4. Full debug SQL hanya gated dan sementara.
```

Contoh:

```text
- semua query record duration histogram
- query > threshold log WARN
- SQLState error log WARN/ERROR
- trace sample 1-10% normal traffic
- trace 100% untuk error/slow jika backend mendukung tail sampling
```

Tujuannya:

```text
cukup data untuk diagnosis tanpa membanjiri log/trace backend.
```

---

## 52. Observability Anti-Patterns

### Anti-pattern 1 — Hanya log “DB error”

Buruk:

```text
DB error occurred
```

Tidak ada:

```text
- statement name
- SQLState
- vendor code
- duration
- pool
- trace id
```

---

### Anti-pattern 2 — Log raw SQL + bind values di production

Bahaya:

```text
PII leakage, secret leakage, compliance issue
```

---

### Anti-pattern 3 — Metric label raw SQL

Akibat:

```text
cardinality explosion
monitoring cost naik
query dashboard rusak
```

---

### Anti-pattern 4 — Hanya average latency

Average menyembunyikan p95/p99.

Gunakan histogram/percentile.

---

### Anti-pattern 5 — Tidak membedakan acquire vs execute

Akibat:

```text
pool starvation dikira query lambat
query lambat dikira pool kecil
```

---

### Anti-pattern 6 — Tidak punya pool name

Akibat:

```text
multi-pool diagnosis mustahil
```

---

### Anti-pattern 7 — Alert active connection tinggi saja

Active tinggi bisa normal.

Gabungkan dengan pending/acquire timeout/usage latency.

---

### Anti-pattern 8 — Observability tanpa database correlation

App team dan DBA saling menyalahkan karena tidak ada common key.

---

## 53. Case Study: API Lambat Karena Pool Wait

Gejala:

```text
User melapor transition case lambat sampai 8-10 detik.
Database CPU hanya 30%.
Slow query log DB tidak menunjukkan query > 500ms.
```

Metrik:

```text
http.server.duration p99 = 9s
hikaricp.acquire p99 = 8.5s
hikaricp.usage p95 = 12s
hikaricp.active = max
hikaricp.pending > 50
jdbc.query.duration p95 = 120ms
```

Diagnosis:

```text
Request lambat bukan karena query lambat.
Request menunggu connection.
Connection dipakai terlalu lama oleh flow lain.
```

Lanjut investigasi:

```text
Top connection usage statement menunjukkan ReportRepository.exportLargeAuditTrail.
Report export memakai pool OLTP yang sama.
```

Fix:

```text
1. Pisahkan reporting pool.
2. Batasi concurrency export.
3. Stream dengan chunk dan timeout jelas.
4. Pastikan OLTP pool tidak dipakai untuk report berat.
```

---

## 54. Case Study: Deadlock Tersembunyi oleh Retry

Gejala:

```text
Success rate masih 99.9%, tetapi latency p99 naik.
Tidak banyak error terlihat user.
```

Metrik:

```text
retry.count{reason="deadlock"} naik 10x
SQLState class 40 naik
transaction duration p99 naik
DB deadlock log meningkat
```

Diagnosis:

```text
Retry membuat user tidak sering melihat error,
tetapi contention meningkat dan latency memburuk.
```

Root cause:

```text
Dua flow update entity dengan urutan berbeda:
Flow A: case -> audit -> assignment
Flow B: assignment -> case -> audit
```

Fix:

```text
1. Standardize lock/update order.
2. Perpendek transaction.
3. Pastikan predicate update indexed.
4. Keep retry sebagai safety net, bukan solusi utama.
```

---

## 55. Case Study: Leak Detection Warning Setelah Deploy

Gejala:

```text
Hikari leak detection warning muncul setelah release.
Pool timeout terjadi sporadis.
```

Leak stack trace:

```text
Connection acquired at AuditTrailController.download
```

Trace:

```text
HTTP download streaming 300MB
Connection usage 120s
ResultSet masih terbuka selama response streaming
```

Diagnosis:

```text
Bukan lupa close sederhana.
Connection sengaja tertahan karena response streaming langsung dari ResultSet.
```

Fix options:

```text
1. Export async ke file/object storage, lalu download dari storage.
2. Chunk read DB cepat ke bounded buffer/file sementara, close connection, lalu stream file.
3. Gunakan reporting pool dan concurrency limit jika streaming langsung tetap diperlukan.
```

---

## 56. Production Checklist Observability JDBC

Gunakan checklist ini saat review aplikasi.

### Pool Metrics

```text
[ ] active connections by pool
[ ] idle connections by pool
[ ] pending threads by pool
[ ] total/max/min connections by pool
[ ] acquisition latency histogram
[ ] usage latency histogram
[ ] creation latency histogram
[ ] connection timeout count
[ ] leak detection warning capture
```

### JDBC Operation Metrics

```text
[ ] query/update/batch latency by statement name
[ ] execute vs fetch split for heavy SELECT
[ ] rows returned/affected
[ ] batch size and partial failure
[ ] commit/rollback duration
[ ] SQLState class/error classification
[ ] retry count and reason
```

### Logs

```text
[ ] structured slow operation logs
[ ] structured error logs with SQLState/vendor code
[ ] trace id/span id included
[ ] pool name included
[ ] statement name included
[ ] raw bind values redacted
[ ] PII not logged
```

### Tracing

```text
[ ] JDBC spans visible under request/job trace
[ ] connection acquisition visible or inferable
[ ] statement name attached
[ ] SQL sanitized
[ ] error attributes include SQLState
[ ] slow traces retained/sampled
```

### Database Correlation

```text
[ ] service/application name visible in DB sessions
[ ] module/action/client identifier strategy decided
[ ] SQL hash/statement name can map app to DB
[ ] DBA can identify top app module/session
[ ] idle-in-transaction visible
[ ] blocking sessions visible
```

### Alerting

```text
[ ] connection timeout alert
[ ] pending sustained alert
[ ] acquire latency p95/p99 alert
[ ] usage latency p99 anomaly alert
[ ] SQLState 08 spike alert
[ ] SQLState 40 spike alert
[ ] transaction duration alert
[ ] idle-in-transaction alert
[ ] lock wait/deadlock alert
```

---

## 57. Summary Mental Model

JDBC observability yang matang bukan sekadar melihat “query lambat”.

Model yang harus dipegang:

```text
Request latency
  = app time
  + pool acquisition time
  + transaction time
  + SQL execute time
  + fetch/map time
  + commit/rollback time
  + downstream/non-DB time
```

Pool metric menjawab:

```text
Apakah aplikasi sedang kehabisan connection?
```

JDBC operation metric menjawab:

```text
SQL/transaction mana yang mahal atau error?
```

Database correlation menjawab:

```text
Session/query/wait event database mana yang terkait dengan request aplikasi?
```

Engineer yang matang tidak menebak:

```text
“pool kurang besar”
“database lambat”
“query lambat”
```

Ia membuktikan:

```text
- acquire time tinggi atau tidak
- usage time tinggi atau tidak
- execute/fetch/commit mana yang mahal
- SQLState/error class apa yang dominan
- DB wait event apa yang terjadi
- request/statement/pool mana yang bertanggung jawab
```

Itulah perbedaan antara sekadar bisa memakai JDBC dan bisa mengoperasikan JDBC stack di production.

---

## 58. Referensi

Referensi utama untuk part ini:

1. Java SE API Documentation — `java.sql.Statement`, `SQLException`, `SQLWarning`, `SQLTimeoutException`.
2. HikariCP README resmi — configuration, metrics-related options, MBeans, leak detection, pool properties.
3. HikariCP Javadoc — package `com.zaxxer.hikari.metrics` dan integrasi metrics.
4. Spring Boot Actuator Metrics Documentation — Micrometer-based metrics exposure.
5. OpenTelemetry Java Instrumentation Documentation — Java agent dan instrumentation untuk aplikasi Java, termasuk observability database/JDBC pada setup tertentu.
6. Dokumentasi vendor database terkait session/application name/wait events sesuai database yang digunakan.

---

## 59. Status Seri

```text
Part 024 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 025 — Failure Modes and Recovery Patterns
File berikutnya: learn-java-sql-jdbc-hikaricp-part-025.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Transaction and Pool Interaction](./learn-java-sql-jdbc-hikaricp-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Failure Modes and Recovery Patterns](./learn-java-sql-jdbc-hikaricp-part-025.md)
