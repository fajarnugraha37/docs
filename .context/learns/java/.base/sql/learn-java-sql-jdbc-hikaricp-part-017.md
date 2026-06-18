# learn-java-sql-jdbc-hikaricp-part-017

# Part 017 — Performance Model of JDBC Calls

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Status: Part 017 dari 029  
> Topik: JDBC performance model, connection cost, parse-bind-execute-fetch, network round-trip, fetch size, batching, queueing, lock wait, pool wait, and measurement-driven tuning

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu melihat performa JDBC bukan sebagai masalah tunggal bernama “query lambat”, tetapi sebagai gabungan beberapa lapisan biaya:

1. biaya mendapatkan koneksi;
2. biaya menunggu slot pool;
3. biaya network round-trip;
4. biaya parse SQL;
5. biaya bind parameter;
6. biaya optimasi/execution plan;
7. biaya eksekusi di database;
8. biaya lock wait;
9. biaya fetch row dari server ke client;
10. biaya mapping row ke object Java;
11. biaya transaction lifetime;
12. biaya commit/rollback;
13. biaya observability/logging;
14. biaya contention antar request, thread, pool, dan database worker.

Kunci bagian ini:

> JDBC performance bukan hanya soal “SQL cepat atau lambat”. JDBC performance adalah hasil dari interaksi antara Java runtime, JDBC driver, connection pool, network, database engine, transaction design, lock behavior, dan cara aplikasi mengonsumsi hasil query.

---

## 1. Mental Model Besar

Bayangkan satu request aplikasi menjalankan satu query sederhana:

```text
HTTP request
  -> service method
    -> borrow connection from pool
      -> prepare statement
        -> bind parameters
          -> send execute request over socket
            -> DB parses / finds plan / executes
              -> DB returns first batch of rows
                -> app iterates ResultSet
                  -> map rows to objects
                    -> close ResultSet/Statement
                      -> commit/rollback if needed
                        -> close logical connection / return to pool
```

Jika latency total request 800 ms, penyebabnya bisa berada di banyak titik:

```text
20 ms   waiting for a connection from pool
2 ms    preparing Java object
1 ms    binding parameter
3 ms    network send
80 ms   database parsing/planning/executing
500 ms  lock wait
120 ms  fetching rows in multiple round-trips
50 ms   mapping rows to object graph
10 ms   commit
14 ms   logging/tracing/serialization overhead
```

Dari luar semua terlihat sebagai:

```text
repository.findSomething() took 800 ms
```

Tetapi keputusan tuning-nya berbeda total.

Jika bottleneck-nya pool wait, menambah index tidak membantu. Jika bottleneck-nya lock wait, menaikkan `fetchSize` tidak membantu. Jika bottleneck-nya fetch round-trip, rewrite query mungkin tidak terlalu berdampak. Jika bottleneck-nya mapping object, execution plan DB mungkin sudah optimal.

---

## 2. JDBC Performance Harus Dipahami sebagai Pipeline

Jangan berpikir:

```text
JDBC call = query execution time
```

Pikirkan:

```text
JDBC call = queue + protocol + database work + result transfer + client processing + cleanup
```

Lebih eksplisit:

```text
T_total = T_pool_wait
        + T_connection_validation_if_any
        + T_statement_prepare
        + T_bind
        + T_network_request
        + T_db_parse_or_plan_lookup
        + T_db_execute
        + T_lock_wait
        + T_fetch_transfer
        + T_result_mapping
        + T_commit_or_rollback
        + T_close_reset_return
```

Tidak semua komponen muncul di setiap operasi. Misalnya `SELECT 1` mungkin tidak punya fetch besar. `INSERT batch` mungkin tidak punya `ResultSet`, tetapi punya batch serialization dan transaction commit cost. Stored procedure bisa punya multiple result sets dan OUT parameter marshaling.

Mental model ini penting karena performance tuning yang matang adalah proses memisahkan komponen-komponen tersebut, bukan menebak.

---

## 3. Biaya Mendapatkan Connection

### 3.1 Physical connection creation mahal

Membuat koneksi database fisik biasanya melibatkan:

1. DNS lookup atau endpoint resolution;
2. TCP handshake;
3. TLS handshake jika enabled;
4. database protocol startup;
5. authentication;
6. authorization/session initialization;
7. session parameter setup;
8. possible server process/thread allocation;
9. possible driver metadata setup.

Itulah alasan aplikasi production hampir selalu memakai connection pool. Pool mengubah biaya besar “create physical connection per request” menjadi biaya lebih kecil “borrow logical connection from pool”.

Tanpa pool:

```text
every operation:
  open physical DB connection
  execute SQL
  close physical DB connection
```

Dengan pool:

```text
startup / warmup:
  create several physical DB connections

runtime:
  borrow logical handle
  execute SQL
  close logical handle -> return to pool
```

### 3.2 Borrow connection juga tidak selalu gratis

Walaupun pool menghindari physical connection creation per request, `dataSource.getConnection()` tetap bisa mahal jika:

1. semua connection sedang dipakai;
2. pool melakukan validation;
3. pool harus membuat connection baru;
4. database lambat menerima connection baru;
5. credential bermasalah;
6. network sedang bermasalah;
7. pool lock/contention tinggi;
8. thread aplikasi terlalu banyak berebut pool kecil.

Jadi `getConnection()` perlu dimonitor sebagai operasi yang punya latency sendiri.

### 3.3 Pool wait adalah sinyal backpressure

Jika thread menunggu connection dari pool, itu bukan sekadar “pool kurang besar”. Itu bisa berarti:

1. query terlalu lama;
2. transaction terlalu panjang;
3. connection leak;
4. database lambat;
5. pool terlalu kecil untuk workload valid;
6. pool sengaja membatasi concurrency agar database tidak jatuh;
7. aplikasi memiliki terlalu banyak request/thread paralel;
8. ada background job mengambil semua slot pool.

Kesalahan umum:

```text
Problem: timeout waiting for connection
Naive fix: increase maximumPoolSize
```

Kadang benar. Sering salah. Jika database sudah saturated, menambah connection justru memperbesar queue di database, meningkatkan context switching, lock contention, memory usage, dan tail latency.

HikariCP sendiri memiliki dokumentasi khusus tentang pool sizing dan menunjukkan bahwa pool lebih kecil bisa menghasilkan response time jauh lebih baik jika sebelumnya database terlalu dibanjiri connection. Dokumentasi HikariCP menekankan bahwa connection pool size bukan angka “semakin besar semakin cepat”.

---

## 4. Parse, Bind, Execute, Fetch

Untuk memahami `PreparedStatement`, gunakan pipeline ini:

```text
SQL text
  -> parse
  -> semantic validation
  -> plan lookup / optimization
  -> bind parameter values
  -> execute
  -> fetch rows / update count
```

Dalam praktik, detailnya bergantung pada database dan driver. Tetapi model ini cukup kuat untuk reasoning.

---

## 5. Parse Cost

### 5.1 Apa itu parse?

Parse adalah proses database memahami SQL text:

```sql
SELECT id, status FROM case_file WHERE id = ?
```

Database perlu:

1. tokenize SQL;
2. memahami grammar;
3. mengecek object/table/column;
4. mengecek privilege;
5. membangun representasi internal;
6. mencari atau membuat execution plan.

### 5.2 Hard parse vs soft parse

Secara konseptual:

```text
Hard parse:
  SQL belum punya reusable plan / perlu optimasi penuh

Soft parse:
  SQL dikenali / plan bisa digunakan ulang atau validasi lebih ringan
```

Nama dan detail berbeda antar database, tetapi ide besarnya sama: query yang bentuk SQL-nya stabil lebih mudah di-cache/dipakai ulang.

### 5.3 PreparedStatement membantu stabilitas SQL shape

Dengan `PreparedStatement`:

```java
PreparedStatement ps = conn.prepareStatement(
    "SELECT id, status FROM case_file WHERE id = ?"
);
ps.setLong(1, caseId);
```

SQL shape stabil:

```text
SELECT id, status FROM case_file WHERE id = ?
```

Dengan string concatenation:

```java
Statement st = conn.createStatement();
ResultSet rs = st.executeQuery(
    "SELECT id, status FROM case_file WHERE id = " + caseId
);
```

SQL text berubah-ubah:

```text
SELECT id, status FROM case_file WHERE id = 1001
SELECT id, status FROM case_file WHERE id = 1002
SELECT id, status FROM case_file WHERE id = 1003
```

Efeknya:

1. lebih sulit reuse plan;
2. lebih berisiko SQL injection;
3. lebih banyak SQL text unik di database;
4. observability menjadi berisik;
5. cache pressure meningkat.

### 5.4 PreparedStatement tidak otomatis selalu server-side cached

Ini jebakan penting.

`PreparedStatement` di Java adalah API contract. Tetapi apakah statement itu benar-benar diprepare di server, kapan diprepare, apakah dicache, dan bagaimana reuse-nya, sangat bergantung pada driver dan konfigurasi.

Kemungkinan implementasi:

```text
Client-side prepared:
  driver menyimpan SQL template, lalu mengirim SQL/bind ke server

Server-side prepared:
  database membuat server-side prepared statement / cursor / handle

Threshold-based:
  driver baru memakai server-side prepare setelah query dieksekusi beberapa kali

Statement cache:
  physical connection menyimpan prepared statement handle agar close logical tidak selalu membuang server object
```

Maka klaim “pakai PreparedStatement pasti lebih cepat” terlalu sederhana.

Yang lebih akurat:

> PreparedStatement memberi parameterization, keamanan, SQL shape stability, dan peluang reuse. Dampak performanya bergantung pada driver, database, statement cache, server plan cache, dan pola penggunaan.

---

## 6. Bind Cost

Bind adalah proses mengisi parameter:

```java
ps.setLong(1, caseId);
ps.setString(2, status);
ps.setObject(3, approvedAt);
```

Biayanya biasanya kecil dibanding execution/fetch, tetapi bisa signifikan jika:

1. batch sangat besar;
2. parameter sangat banyak;
3. tipe data perlu conversion mahal;
4. LOB dikirim;
5. JSON/XML besar dikirim;
6. driver melakukan encoding/copying besar;
7. `setObject` ambigu dan memicu type inference yang tidak optimal;
8. binding temporal type melibatkan timezone conversion.

Contoh buruk:

```java
ps.setObject(1, someBigDecimalAsString);
```

Jika kolom numeric, lebih baik bind dengan tipe yang benar:

```java
ps.setBigDecimal(1, amount);
```

Bukan karena `setObject` selalu salah, tetapi karena tipe eksplisit mengurangi ambiguitas driver dan database.

---

## 7. Execute Cost

Execute adalah bagian database benar-benar melakukan kerja:

1. index seek/scan;
2. table scan;
3. join;
4. sort;
5. aggregation;
6. filter;
7. insert/update/delete;
8. constraint check;
9. trigger execution;
10. foreign key validation;
11. undo/redo/WAL generation;
12. lock acquisition;
13. waiting for other transaction;
14. materialization;
15. temporary segment/work memory usage.

Dari sisi Java, ini sering terlihat sebagai:

```java
boolean hasResultSet = ps.execute();
```

atau:

```java
ResultSet rs = ps.executeQuery();
```

Tetapi waktu yang terukur pada baris ini bisa mencakup sebagian atau seluruh kerja database, bergantung driver dan kapan rows mulai dikembalikan.

Untuk query besar, `executeQuery()` bisa cepat jika server segera mengembalikan cursor/first batch, lalu waktu besar muncul saat `rs.next()`. Untuk driver yang membuffer semua rows, `executeQuery()` bisa lama dan memory langsung naik.

---

## 8. Fetch Cost

### 8.1 ResultSet bukan list

`ResultSet` adalah abstraksi cursor. Data bisa sudah dibuffer di client, bisa juga diambil bertahap dari server.

Fetch cost melibatkan:

1. database menghasilkan row;
2. row dikirim lewat protocol;
3. bytes melewati network;
4. driver decode protocol;
5. driver convert ke Java type;
6. aplikasi memanggil getter;
7. aplikasi mapping row ke object.

### 8.2 Fetch size sebagai hint

JDBC `Statement.setFetchSize(int rows)` memberi hint kepada driver tentang jumlah row yang sebaiknya diambil ketika fetch dari database. Dokumentasi Java SE menyebut `setFetchSize` sebagai hint kepada driver untuk jumlah row yang perlu di-fetch dari database ketika lebih banyak row dibutuhkan.

Namun kata pentingnya adalah **hint**. Driver boleh menerjemahkan berbeda atau membatasi berdasarkan database.

Contoh:

```java
try (PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setFetchSize(500);
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            // process row
        }
    }
}
```

### 8.3 Trade-off fetch size

Fetch size terlalu kecil:

```text
lebih banyak round-trip
latency total naik
server/client bolak-balik terlalu sering
```

Fetch size terlalu besar:

```text
client memory naik
first-row latency bisa naik
row yang tidak dikonsumsi ikut ditransfer
GC pressure meningkat
```

Tidak ada angka universal.

Contoh starting point:

```text
small OLTP lookup: default cukup
medium list: 100 - 500
large streaming export: 500 - 5000, tergantung row width dan memory
LOB rows: kecilkan, karena setiap row bisa besar
```

### 8.4 Row width lebih penting dari row count saja

`fetchSize = 1000` untuk row kecil:

```text
id BIGINT
code VARCHAR(20)
status VARCHAR(20)
```

mungkin ringan.

`fetchSize = 1000` untuk row besar:

```text
id BIGINT
metadata CLOB
payload JSON
attachment BLOB
```

bisa menghancurkan heap.

Selalu pikirkan:

```text
batch memory ~= fetchSize × average row materialized size
```

Bahkan jika database row hanya 2 KB, object Java hasil mapping bisa jauh lebih besar karena overhead object, string, char/byte array, collection, dan domain object.

---

## 9. Network Round-Trip

JDBC biasanya berkomunikasi lewat socket. Satu operasi database bisa memerlukan beberapa round-trip:

```text
prepare request -> response
execute request -> response
fetch batch 1 -> response
fetch batch 2 -> response
commit request -> response
```

Round-trip cost menjadi dominan jika:

1. database jauh secara network;
2. latency antar AZ/region tinggi;
3. fetch size terlalu kecil;
4. aplikasi melakukan N+1 query;
5. batch tidak dipakai untuk bulk write;
6. commit terlalu sering;
7. query kecil dieksekusi ribuan kali;
8. stored procedure dipanggil chatty berkali-kali;
9. connection validation terlalu sering.

### 9.1 N+1 sebagai round-trip amplification

Contoh buruk:

```java
List<CaseFile> cases = caseRepository.findOpenCases();
for (CaseFile c : cases) {
    List<Document> docs = documentRepository.findByCaseId(c.id());
    c.setDocuments(docs);
}
```

Jika ada 500 case:

```text
1 query for cases
500 queries for documents
= 501 round-trips minimum
```

Solusi tergantung konteks:

1. join;
2. batch query dengan `WHERE case_id IN (...)`;
3. two-step loading;
4. temporary table;
5. server-side aggregation;
6. jOOQ/ORM fetch strategy;
7. precomputed read model.

Jangan langsung “join semua” tanpa berpikir row explosion.

---

## 10. Server CPU, IO, and Memory

Waktu JDBC bisa habis di database karena:

1. full scan besar;
2. index tidak ada;
3. index ada tapi tidak dipakai;
4. cardinality estimate salah;
5. join order buruk;
6. sort/hash aggregate spill ke disk;
7. temp space pressure;
8. redo/WAL pressure;
9. undo pressure;
10. buffer cache miss;
11. CPU saturation;
12. too many active sessions;
13. latch/mutex/internal contention;
14. checkpoint/flush pressure.

Dari aplikasi, semua bisa terlihat sebagai:

```text
executeQuery() slow
```

Tetapi tuning di aplikasi tidak cukup. Kamu perlu database-side evidence:

```text
execution plan
actual rows vs estimated rows
wait events
active sessions
lock graph
top SQL
buffer reads / physical reads
CPU time / elapsed time
rows processed
temp usage
```

---

## 11. Lock Wait and Transaction Contention

### 11.1 Lock wait bukan query execution murni

Query bisa terlihat lambat bukan karena plan jelek, tetapi karena menunggu lock.

Contoh:

```sql
UPDATE case_file
SET status = 'APPROVED'
WHERE id = ?;
```

Plan-nya bisa sangat cepat: index seek by primary key.

Tetapi jika row sedang dikunci transaction lain:

```text
actual work: 2 ms
lock wait: 8 seconds
JDBC observed latency: 8002 ms
```

Jika hanya melihat SQL text, kita bisa salah menyalahkan index.

### 11.2 Transaction duration menentukan lock lifetime

Di banyak database, lock write bertahan sampai commit/rollback.

Kode buruk:

```java
conn.setAutoCommit(false);

updateCaseStatus(conn, caseId, APPROVED);
insertAudit(conn, caseId);
callExternalService(); // 2 seconds, can timeout
sendEmail();           // more IO

conn.commit();
```

Masalah:

1. lock database ditahan saat external service call;
2. pool connection ditahan lebih lama;
3. transaction lebih rentan deadlock;
4. failure recovery lebih kompleks;
5. throughput turun.

Lebih baik:

```text
transaction:
  validate current DB state
  update state
  insert outbox/audit
  commit

after commit:
  async worker sends email / external call
```

Untuk sistem regulatory/case management, ini sangat penting karena state transition harus konsisten tetapi side effect eksternal tidak boleh memperpanjang lock.

---

## 12. Commit Cost

`commit()` bukan operasi gratis.

Commit bisa melibatkan:

1. flush redo/WAL;
2. sync to durable storage;
3. release locks;
4. update transaction metadata;
5. notify replication;
6. group commit coordination;
7. trigger deferred constraints;
8. network round-trip.

Jika aplikasi commit per row:

```java
for (Record r : records) {
    conn.setAutoCommit(false);
    insert(r);
    conn.commit();
}
```

maka biaya commit dikalikan jumlah row.

Lebih baik:

```java
conn.setAutoCommit(false);
for (Record r : records) {
    insert(r);
}
conn.commit();
```

Tetapi jangan ekstrem: transaction terlalu besar juga meningkatkan lock duration, undo/WAL, rollback cost, dan failure blast radius.

Prinsip:

```text
Commit too often -> round-trip and durability overhead high
Commit too rarely -> lock, undo, rollback, and contention risk high
```

Cari batch/transaction size yang seimbang.

---

## 13. Batch Tuning as Performance Tool

Batch mengurangi round-trip dan memberi driver/database peluang optimasi.

Contoh:

```java
String sql = "INSERT INTO case_event(case_id, event_type, created_at) VALUES (?, ?, ?)";

try (PreparedStatement ps = conn.prepareStatement(sql)) {
    int count = 0;

    for (CaseEvent event : events) {
        ps.setLong(1, event.caseId());
        ps.setString(2, event.type());
        ps.setObject(3, event.createdAt());
        ps.addBatch();

        if (++count % 500 == 0) {
            ps.executeBatch();
        }
    }

    ps.executeBatch();
}
```

Batch membantu jika bottleneck-nya:

1. banyak statement kecil;
2. network round-trip;
3. parse overhead;
4. per-statement protocol overhead.

Batch tidak otomatis membantu jika bottleneck-nya:

1. constraint check berat;
2. index maintenance berat;
3. trigger berat;
4. lock contention;
5. disk/WAL saturated;
6. batch terlalu besar sampai memory/packet limit.

---

## 14. Statement Cache and Plan Cache

Ada beberapa lapisan cache yang sering tercampur:

```text
Application code cache:
  cache SQL string / repository method

JDBC driver statement cache:
  cache prepared/callable statement handle per physical connection

Database plan cache:
  cache parsed/optimized execution plan

Database buffer cache:
  cache data/index blocks
```

Jangan menyebut semuanya “cache query”. Mereka berbeda.

### 14.1 Statement cache biasanya per physical connection

Jika statement cache aktif di driver/pool, cache itu biasanya melekat ke physical connection.

Artinya:

```text
pool size 20
same SQL used across all connections
potentially 20 cached statement handles
```

Jika jumlah SQL unik besar dan pool besar, statement cache juga bisa menjadi memory/resource pressure di database.

### 14.2 Dynamic SQL merusak reuse

Buruk:

```java
String sql = "SELECT * FROM case_file WHERE status = '" + status + "'";
```

Lebih baik:

```java
String sql = "SELECT * FROM case_file WHERE status = ?";
```

Tetapi dynamic SQL tidak selalu salah. Yang berbahaya adalah dynamic SQL yang tidak terkendali.

Untuk optional filter:

```java
StringBuilder sql = new StringBuilder("SELECT id, status FROM case_file WHERE 1=1");
List<Bind> binds = new ArrayList<>();

if (status != null) {
    sql.append(" AND status = ?");
    binds.add(Bind.string(status));
}
if (createdFrom != null) {
    sql.append(" AND created_at >= ?");
    binds.add(Bind.object(createdFrom));
}
```

Ini masih parameterized dan shape-nya terbatas oleh kombinasi filter yang valid.

---

## 15. Result Mapping Cost

Banyak engineer hanya mengukur database time, lalu lupa biaya mapping di Java.

Contoh:

```java
while (rs.next()) {
    CaseDetail detail = new CaseDetail(
        rs.getLong("id"),
        rs.getString("case_no"),
        rs.getString("status"),
        rs.getObject("created_at", OffsetDateTime.class),
        loadNestedObjects(rs) // hidden cost
    );
    result.add(detail);
}
```

Mapping bisa mahal karena:

1. banyak object allocation;
2. string decoding;
3. timestamp conversion;
4. BigDecimal creation;
5. JSON parsing;
6. enum conversion;
7. nested collection creation;
8. reflection-based mapper;
9. proxy/lazy object framework;
10. validation logic per row;
11. accidental extra query per row.

Untuk result set besar, mapping bisa menjadi bottleneck utama.

### 15.1 Column label lookup vs index

`rs.getString("status")` lebih readable. `rs.getString(3)` bisa lebih cepat pada beberapa driver, tetapi lebih fragile.

Praktik seimbang:

```java
private static final int COL_ID = 1;
private static final int COL_CASE_NO = 2;
private static final int COL_STATUS = 3;

while (rs.next()) {
    long id = rs.getLong(COL_ID);
    String caseNo = rs.getString(COL_CASE_NO);
    String status = rs.getString(COL_STATUS);
}
```

Namun jangan micro-optimize sebelum evidence. Untuk kebanyakan OLTP query kecil, readability lebih penting. Untuk hot path besar, column index bisa dipertimbangkan bersama benchmark.

---

## 16. Query Shape and Data Shape

Performance tidak hanya ditentukan oleh SQL text, tetapi juga bentuk data yang dihasilkan.

### 16.1 SELECT only what you need

Buruk:

```sql
SELECT * FROM audit_trail WHERE module_id = ? ORDER BY created_date_time DESC
```

Jika table punya CLOB besar, `SELECT *` bisa ikut membawa kolom berat.

Lebih baik untuk listing:

```sql
SELECT id, module_id, activity, description, created_date_time, created_by
FROM audit_trail
WHERE module_id = ?
ORDER BY created_date_time DESC
FETCH FIRST 100 ROWS ONLY
```

Detail CLOB diambil saat user membuka detail:

```sql
SELECT metadata, serialized_changes, full_text
FROM audit_trail
WHERE id = ?
```

### 16.2 Row explosion

Join yang tampak efisien bisa memperbesar row count:

```text
case_file 1 row
  join document 20 rows
  join comment 30 rows
  join assignment 5 rows
```

Naive join bisa menghasilkan:

```text
1 × 20 × 30 × 5 = 3000 rows for one case
```

Kadang lebih baik pakai beberapa query terkontrol daripada satu mega join.

Rule:

```text
Reduce round-trip, but do not create uncontrolled row multiplication.
```

---

## 17. Latency vs Throughput

Latency:

```text
berapa lama satu operasi selesai
```

Throughput:

```text
berapa banyak operasi selesai per satuan waktu
```

Optimasi latency satu query belum tentu meningkatkan throughput sistem.

Contoh:

```text
Query A optimized from 100 ms to 60 ms
but pool size increased from 20 to 100
DB becomes saturated
P99 request latency worsens
```

Atau:

```text
Batch size increased from 100 to 5000
throughput import improves
but OLTP users experience lock wait
```

Untuk production, target bukan hanya membuat satu query cepat, tetapi menjaga sistem stabil pada concurrency nyata.

---

## 18. Little's Law Intuition for JDBC

Little's Law secara sederhana:

```text
Concurrency ≈ Throughput × Latency
```

Dalam konteks JDBC:

```text
active DB connections needed ≈ DB operations per second × average DB time per operation
```

Contoh:

```text
Throughput: 200 DB operations/second
Average DB time: 50 ms = 0.05 second
Needed active DB concurrency: 200 × 0.05 = 10 active connections
```

Jika average naik menjadi 500 ms:

```text
200 × 0.5 = 100 active connections
```

Tetapi database belum tentu mampu menjalankan 100 operasi aktif dengan baik. Maka ketika query melambat, pool bisa cepat habis.

Ini menjelaskan cascade:

```text
DB latency naik
  -> connection held longer
    -> active pool count naik
      -> pending threads naik
        -> request latency naik
          -> retries naik
            -> DB load makin naik
              -> outage
```

---

## 19. Why More Connections Can Make Things Slower

Database punya resource terbatas:

1. CPU cores;
2. memory;
3. buffer cache;
4. worker processes/threads;
5. lock manager;
6. IO bandwidth;
7. log writer bandwidth;
8. temp space;
9. network bandwidth.

Jika terlalu banyak query aktif bersamaan:

```text
more connections
  -> more active sessions
    -> more context switching
      -> more memory pressure
        -> more lock contention
          -> worse cache locality
            -> higher latency
```

Akibatnya throughput bisa turun walaupun concurrency naik.

Pool bukan hanya cache koneksi. Pool juga governor concurrency ke database.

---

## 20. Measurement: Apa yang Harus Diukur

### 20.1 Di aplikasi

Minimal ukur:

```text
pool acquire time
connection usage time
query execution time
result mapping time
transaction duration
rows returned
batch size
SQL operation type
error SQLState/vendor code
retry count
```

Untuk HikariCP:

```text
active connections
idle connections
total connections
pending threads
connection acquisition time
connection usage time
connection creation time
connection timeout count
```

### 20.2 Di database

Ukur:

```text
top SQL by elapsed time
top SQL by CPU time
top SQL by executions
top SQL by logical reads
top SQL by physical reads
wait events
lock waits
deadlocks
temp usage
active sessions
blocked sessions
parse count
commit rate
rollback rate
connection/session count
```

### 20.3 Di network/runtime

Ukur:

```text
network latency to DB
packet loss / retransmission if available
GC pause
heap allocation rate
thread pool saturation
CPU steal/throttle in container
pod replica count × pool size
timeout/retry metrics
```

---

## 21. Timing Decomposition Pattern in Plain JDBC

Contoh sederhana untuk memisahkan acquire, execute, map:

```java
public List<CaseSummary> findOpenCases(DataSource dataSource) throws SQLException {
    long t0 = System.nanoTime();

    try (Connection conn = dataSource.getConnection()) {
        long t1 = System.nanoTime();

        String sql = """
            SELECT id, case_no, status, created_at
            FROM case_file
            WHERE status = ?
            ORDER BY created_at DESC
            FETCH FIRST 100 ROWS ONLY
            """;

        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, "OPEN");

            long t2 = System.nanoTime();

            try (ResultSet rs = ps.executeQuery()) {
                long t3 = System.nanoTime();

                List<CaseSummary> result = new ArrayList<>();
                while (rs.next()) {
                    result.add(new CaseSummary(
                        rs.getLong(1),
                        rs.getString(2),
                        rs.getString(3),
                        rs.getObject(4, OffsetDateTime.class)
                    ));
                }

                long t4 = System.nanoTime();

                log.debug(
                    "findOpenCases timing acquire={}ms prepareBind={}ms execute={}ms map={}ms total={}ms rows={}",
                    millis(t1 - t0),
                    millis(t2 - t1),
                    millis(t3 - t2),
                    millis(t4 - t3),
                    millis(t4 - t0),
                    result.size()
                );

                return result;
            }
        }
    }
}

private static double millis(long nanos) {
    return nanos / 1_000_000.0;
}
```

Catatan:

1. Jangan logging detail ini untuk semua query high volume tanpa sampling.
2. Jangan log bind value sensitif.
3. Untuk production, lebih baik pakai metrics/tracing terstruktur.
4. Timing `executeQuery()` belum tentu seluruh DB time; fetch/mapping bisa terjadi saat `rs.next()`.

---

## 22. Anti-Pattern: Measuring Only Repository Method Time

Buruk:

```java
long start = System.nanoTime();
List<CaseSummary> cases = repository.findOpenCases();
log.info("findOpenCases took {} ms", millis(System.nanoTime() - start));
```

Ini hanya memberi total. Total tetap berguna, tapi tidak cukup untuk diagnosis.

Lebih baik punya decomposition:

```text
pool acquire: 200 ms
execute first response: 30 ms
result iteration/mapping: 700 ms
rows: 100000
```

Dari sini terlihat problem bukan acquire atau SQL execution awal, tetapi result size/mapping/fetch.

---

## 23. Query Timeout Is Not Performance Tuning

`Statement.setQueryTimeout(seconds)` berguna untuk membatasi durasi query, tetapi bukan solusi performa.

Query timeout menjawab:

```text
berapa lama kita bersedia menunggu sebelum membatalkan?
```

Bukan:

```text
bagaimana query dibuat lebih cepat?
```

Timeout harus dipakai sebagai guardrail.

Contoh:

```java
ps.setQueryTimeout(5);
```

Tetapi tetap perlu:

1. index yang benar;
2. query shape yang benar;
3. transaction yang pendek;
4. fetch size yang sesuai;
5. pool size yang sesuai;
6. retry policy yang tidak memperparah load.

---

## 24. Performance Tuning Workflow

Gunakan workflow ini sebelum mengubah konfigurasi:

```text
1. Define symptom
   - slow average?
   - high P95/P99?
   - pool timeout?
   - CPU high?
   - DB lock wait?
   - memory/GC?

2. Measure from app
   - acquire time
   - execute time
   - mapping time
   - rows
   - transaction duration

3. Correlate with DB
   - top SQL
   - execution plan
   - waits
   - locks
   - active sessions

4. Identify bottleneck class
   - pool queue
   - network round-trip
   - DB CPU/IO
   - lock wait
   - fetch/mapping
   - transaction design

5. Apply targeted change
   - query/index rewrite
   - fetch size
   - batch size
   - transaction boundary
   - pool size
   - timeout
   - split workload pool

6. Validate under representative load
   - not only single-user test
   - include concurrency
   - include data volume
   - include P95/P99

7. Roll out with observability
   - compare before/after
   - watch regressions
```

---

## 25. Decision Matrix: Symptom to Likely Cause

| Symptom | Likely Cause | First Evidence to Check | Common Wrong Fix |
|---|---|---|---|
| Timeout waiting for connection | Pool exhausted, long transaction, slow DB, leak | Hikari active/pending/usage time | Increase pool blindly |
| `executeQuery()` slow | DB execution, lock wait, network, driver buffering | DB top SQL/waits/plan | Tune fetch size only |
| `rs.next()` slow | Fetch round-trip, server cursor, row generation | fetch timing, network, DB wait | Add index blindly |
| High heap during query | Large result buffering/mapping/LOB | heap allocation, row count, selected columns | Increase heap only |
| P99 high, average okay | lock contention, pool queue, GC, outlier SQL | trace percentiles, lock wait | Optimize average query |
| DB CPU high | bad plan, too many active queries, parsing | DB CPU top SQL, parse count | Increase app threads |
| DB sessions high | replicas × pool size too high | DB session count, pod count | Increase max connections |
| Deadlocks | inconsistent lock order, long transaction | deadlock graph | Retry forever |
| Batch partial failure | constraint/data issue mid-batch | BatchUpdateException | Ignore update counts |
| Commit slow | WAL/redo/disk/replication pressure | DB commit wait events | Increase query timeout |

---

## 26. Case Study: Pool Exhaustion That Was Not Pool Size Problem

### Situation

A service has HikariCP `maximumPoolSize = 20`. During peak hours:

```text
Connection is not available, request timed out after 30000ms
```

Naive proposal:

```text
Increase maximumPoolSize to 100
```

### Investigation

Metrics:

```text
active connections: 20/20
pending threads: 80
connection acquisition P95: 30s
connection usage P95: 18s
```

Database:

```text
top wait: row lock wait
one update query waits frequently
```

Code:

```java
conn.setAutoCommit(false);
updateCaseState(conn, caseId, nextState);
insertAudit(conn, caseId);
externalDocumentService.sync(caseId); // slow external call inside transaction
conn.commit();
```

### Real cause

Connection pool exhausted because transaction holds connection and row lock while waiting external service.

### Correct fix

Change boundary:

```text
transaction:
  update case state
  insert audit
  insert outbox event
  commit

after commit:
  worker syncs external document service
```

Possible additional fixes:

1. shorter transaction timeout;
2. lock wait timeout;
3. outbox worker pool separate from OLTP pool;
4. idempotent external sync;
5. dashboard for transaction duration.

Increasing pool size would have increased database contention and possibly made the incident worse.

---

## 27. Case Study: Slow Listing Caused by Fetch/Mapping, Not SQL Plan

### Situation

Audit listing page takes 12 seconds.

SQL:

```sql
SELECT *
FROM audit_trail
WHERE module_id = ?
ORDER BY created_date_time DESC
```

Database plan shows index range scan and returns quickly for first rows.

### Investigation

Application timing:

```text
pool acquire: 2 ms
executeQuery: 80 ms
iterate/map ResultSet: 11.5 s
rows: 50,000
heap spike: high
```

Table contains:

```text
metadata CLOB
serialized_changes CLOB
full_text CLOB
```

### Real cause

Listing query pulls huge CLOB columns and maps too many rows.

### Correct fix

1. Do not `SELECT *`.
2. Split listing and detail query.
3. Add pagination/keyset pagination.
4. Select only listing columns.
5. Use proper fetch size if streaming export is needed.
6. Avoid loading CLOB except on detail view.

Listing query:

```sql
SELECT id, activity, description, created_date_time, created_by
FROM audit_trail
WHERE module_id = ?
ORDER BY created_date_time DESC
FETCH FIRST 100 ROWS ONLY
```

Detail query:

```sql
SELECT metadata, serialized_changes, full_text
FROM audit_trail
WHERE id = ?
```

---

## 28. Case Study: Kubernetes Replica Multiplication

### Situation

Each pod:

```text
maximumPoolSize = 30
```

Deployment scaled:

```text
2 pods -> 12 pods
```

Total possible DB connections:

```text
2 × 30 = 60
12 × 30 = 360
```

Database max sessions is 300, shared with other services.

### Result

1. new pods fail to establish connections;
2. old pods compete with new pods;
3. database CPU rises;
4. connection acquisition fails;
5. readiness flaps;
6. autoscaler may add more pods and worsen it.

### Correct model

Pool size must be calculated at system level:

```text
total connections = service replicas × maxPoolSize per replica
```

If database budget for this service is 120 connections and desired max replica is 12:

```text
maxPoolSize per pod <= 120 / 12 = 10
```

This is why pool configuration is infrastructure capacity design, not only application config.

---

## 29. Practical Heuristics

### 29.1 For OLTP queries

Prefer:

```text
small result sets
short transactions
parameterized SQL
bounded pagination
explicit selected columns
reasonable query timeout
fast connection return
```

Avoid:

```text
SELECT *
large unbounded lists
external calls inside transaction
large object graph mapping
one query per row
commit per row
```

### 29.2 For reporting/export

Prefer:

```text
separate pool or worker
streaming/fetch size tuned
read-only transaction where useful
bounded memory processing
separate timeout budget
possibly read replica
```

Avoid:

```text
using same OLTP pool for huge exports
loading all rows into List
fetching CLOB/BLOB unnecessarily
running during peak without throttle
```

### 29.3 For bulk writes

Prefer:

```text
batch operations
moderate batch size
explicit transaction boundary
idempotent design
partial failure handling
staging table for very large imports
```

Avoid:

```text
single-row auto-commit loop
unbounded transaction size
retrying entire huge batch blindly
mixing OLTP writes and bulk import in same pool without isolation
```

---

## 30. Performance Smells in JDBC Code Review

Watch for:

```java
SELECT *
```

```java
for (...) {
    repository.findById(...);
}
```

```java
conn.setAutoCommit(false);
externalService.call();
conn.commit();
```

```java
List<Row> allRows = new ArrayList<>();
while (rs.next()) {
    allRows.add(map(rs));
}
```

```java
ps.setObject(1, value); // ambiguous for important typed column
```

```java
catch (SQLException e) {
    retry(); // no SQLState classification
}
```

```java
maximumPoolSize=100 // per pod, with 20 pods
```

```java
ps.setQueryTimeout(300); // as substitute for query design
```

```java
ORDER BY created_at DESC // no pagination
```

```java
log.info("SQL={} params={}", sql, params); // leaks sensitive bind values
```

---

## 31. What to Benchmark

Benchmark harus menjawab pertanyaan spesifik.

### 31.1 Query benchmark

Measure:

```text
execution plan
elapsed time
CPU time
logical reads
physical reads
rows returned
row width
fetch time
mapping time
```

### 31.2 Pool benchmark

Measure:

```text
active/idle/pending
acquire latency
usage duration
timeout count
throughput
P95/P99 request latency
DB active session count
```

### 31.3 Batch benchmark

Measure:

```text
batch size
rows/sec
commit latency
WAL/redo pressure
lock wait
failure recovery time
memory usage
```

### 31.4 Fetch size benchmark

Measure:

```text
time to first row
time to all rows
round-trip count if observable
heap usage
GC pause
DB cursor/session duration
```

---

## 32. Do Not Tune Everything at Once

Jika kamu mengubah sekaligus:

```text
pool size
fetch size
batch size
index
query rewrite
timeout
transaction boundary
```

lalu performa membaik atau memburuk, kamu tidak tahu perubahan mana yang menyebabkan hasil.

Gunakan perubahan bertahap:

```text
baseline
change one variable
measure
compare
keep or revert
```

Untuk incident emergency, kadang perlu mitigasi cepat. Tetapi setelah stabil, tetap lakukan post-incident analysis dengan evidence.

---

## 33. Checklist JDBC Performance Review

Gunakan checklist ini saat review repository/data access layer:

```text
[ ] Apakah query parameterized?
[ ] Apakah SELECT hanya mengambil kolom yang diperlukan?
[ ] Apakah result set bounded/paginated?
[ ] Apakah fetch size sesuai untuk large read/export?
[ ] Apakah batch dipakai untuk repeated writes?
[ ] Apakah transaction boundary pendek?
[ ] Apakah external IO terjadi di luar transaction?
[ ] Apakah connection selalu ditutup/returned?
[ ] Apakah query timeout dan lock timeout masuk akal?
[ ] Apakah SQLState/vendor code diklasifikasikan?
[ ] Apakah pool acquire time dimonitor?
[ ] Apakah connection usage time dimonitor?
[ ] Apakah rows returned dimonitor untuk query besar?
[ ] Apakah total pool capacity dihitung per replica?
[ ] Apakah OLTP dan reporting/background workload dipisahkan bila perlu?
[ ] Apakah sensitive bind value tidak bocor ke log?
```

---

## 34. Ringkasan Mental Model

JDBC performance bukan satu angka. Ia adalah pipeline.

Model yang harus diingat:

```text
borrow connection
  -> prepare / bind
    -> network round-trip
      -> database parse/plan/execute
        -> lock wait if any
          -> fetch rows
            -> decode and map
              -> commit/rollback
                -> return connection
```

Bottleneck bisa muncul di setiap tahap.

Tuning yang matang selalu dimulai dari pertanyaan:

```text
Where is the time spent?
Where is the queue forming?
What resource is saturated?
What failure mode appears at P95/P99, not only average?
```

Jika kamu bisa menjawab itu dengan evidence, kamu sudah jauh di atas engineer yang hanya mencoba:

```text
increase pool size
add index
increase timeout
increase heap
```

---

## 35. Referensi

1. Java SE 25 `Statement` API — `setFetchSize`, `setQueryTimeout`, execution methods, and statement behavior.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/Statement.html

2. Java SE 25 `ResultSet` API — result set cursor abstraction and row processing model.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/ResultSet.html

3. Java SE 25 `java.sql` package summary — JDBC API overview for tabular data access.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/package-summary.html

4. PostgreSQL JDBC documentation — issuing queries, processing results, cursor/fetch-size behavior.  
   https://jdbc.postgresql.org/documentation/query/

5. Oracle JDBC Developer's Guide — performance extensions including row prefetch and JDBC performance-related behavior.  
   https://docs.oracle.com/en/database/oracle/oracle-database/23/jjdbc/performance-extensions.html

6. HikariCP Wiki — pool sizing guidance and performance-oriented connection pool sizing discussion.  
   https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing

---

## 36. Penutup Part 017

Part ini membangun cost model performa JDBC dari end-to-end pipeline. Kita belum masuk ke connection pooling secara khusus, tetapi kita sudah menyiapkan fondasinya: pool bukan hanya cache koneksi, melainkan bagian dari performance control dan backpressure.

Part berikutnya akan masuk ke:

```text
Part 018 — Connection Pooling Fundamentals
```

Di sana kita akan membahas pool sebagai concurrency governor: active, idle, pending, max size, min idle, validation, eviction, idle timeout, max lifetime, leak detection, database session budget, dan kenapa connection pool bisa menyelamatkan atau justru menghancurkan sistem production.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-016](./learn-java-sql-jdbc-hikaricp-part-016.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-018](./learn-java-sql-jdbc-hikaricp-part-018.md)
