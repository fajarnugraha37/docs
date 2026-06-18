# learn-java-sql-jdbc-hikaricp-part-012.md

# Part 012 — Batch Operations: Throughput, Atomicity, and Driver Rewriting

## Status Seri

- Seri: `learn-java-sql-jdbc-hikaricp`
- Part: `012` dari `029`
- Status: **belum selesai**
- Part sebelumnya: `Part 011 — DataSource over DriverManager: Modern Connection Acquisition`
- Part berikutnya: `Part 013 — Large Objects and Streaming: Blob, Clob, NClob, SQLXML`

---

## 0. Tujuan Part Ini

Batch operation adalah salah satu area JDBC yang tampak sederhana tetapi sangat mudah disalahpahami.

Di permukaan, API-nya hanya terlihat seperti ini:

```java
preparedStatement.addBatch();
preparedStatement.executeBatch();
```

Namun secara production, batch operation menyentuh banyak aspek sekaligus:

1. network round-trip;
2. parse/bind/execute cost;
3. transaction atomicity;
4. lock duration;
5. redo/write-ahead log pressure;
6. memory di JVM;
7. memory di driver;
8. memory di database session;
9. generated keys;
10. partial failure;
11. retry/idempotency;
12. connection pool occupancy;
13. database-specific optimization;
14. driver rewriting;
15. observability.

Tujuan bagian ini bukan hanya membuat kamu bisa menulis batch insert. Tujuannya adalah membuat kamu bisa menjawab pertanyaan seperti:

- Batch size harus berapa?
- Kenapa batch bisa lebih cepat?
- Kenapa batch kadang tidak lebih cepat?
- Apa bedanya JDBC batch dengan multi-row SQL?
- Apakah satu batch pasti atomic?
- Apa yang terjadi kalau row ke-700 gagal dari 1.000 item?
- Apakah `executeBatch()` berarti satu round-trip?
- Apakah driver mengirim semua row sekaligus?
- Apakah batch aman untuk generated keys?
- Apa yang harus dilakukan saat `BatchUpdateException`?
- Kapan batch justru memperparah lock contention?
- Bagaimana desain batch yang aman untuk production?

Part ini akan membangun mental model dari bawah.

---

## 1. Mental Model: Batch Bukan “Loop yang Lebih Rapi”

Banyak engineer melihat JDBC batch seperti ini:

```java
for (Item item : items) {
    ps.setString(1, item.name());
    ps.setBigDecimal(2, item.amount());
    ps.addBatch();
}
ps.executeBatch();
```

Lalu menyimpulkan:

> “Batch artinya semua query dikirim ke database sekaligus.”

Kesimpulan ini terlalu sederhana.

Lebih tepatnya:

> JDBC batch adalah kontrak API yang memungkinkan aplikasi mengumpulkan beberapa command sejenis atau beberapa command SQL, lalu meminta driver/database mengeksekusinya sebagai batch. Bagaimana batch itu dikirim, di-rewrite, di-buffer, dieksekusi, dan dilaporkan hasilnya sangat bergantung pada driver dan database.

Jadi batch adalah **intent** dari aplikasi ke driver:

```text
Application:
  “Saya punya banyak operasi. Tolong eksekusi sebagai batch.”

Driver:
  “Saya akan memilih strategi sesuai kemampuan saya dan database.”
```

Strategi driver bisa berupa:

1. mengirim satu command per row tetapi dengan round-trip lebih efisien;
2. mengirim array bind;
3. mengubah batch insert menjadi multi-values insert;
4. mengirim beberapa SQL dalam satu network message;
5. tetap mengeksekusi satu per satu karena fitur tertentu tidak bisa di-batch;
6. memecah batch besar menjadi beberapa sub-batch internal;
7. menolak batch untuk jenis statement tertentu;
8. kehilangan detail row-level error saat rewrite dilakukan.

Ini penting karena API yang sama bisa berperilaku berbeda antara Oracle, PostgreSQL, MySQL, SQL Server, H2, MariaDB, DB2, dan database lain.

---

## 2. Problem yang Diselesaikan Batch

Misalkan aplikasi perlu insert 10.000 row.

### 2.1 Cara buruk: satu execute per row dengan auto-commit true

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement("""
         insert into payment_event(id, payment_id, status, created_at)
         values (?, ?, ?, ?)
         """)) {

    for (PaymentEvent event : events) {
        ps.setLong(1, event.id());
        ps.setLong(2, event.paymentId());
        ps.setString(3, event.status());
        ps.setObject(4, event.createdAt());
        ps.executeUpdate();
    }
}
```

Jika `autoCommit=true`, setiap `executeUpdate()` biasanya menjadi transaction sendiri:

```text
Row 1:
  parse/bind/execute
  commit

Row 2:
  parse/bind/execute
  commit

Row 3:
  parse/bind/execute
  commit

...
```

Konsekuensinya:

1. terlalu banyak round-trip;
2. terlalu banyak commit;
3. database log flush lebih sering;
4. throughput rendah;
5. latency total tinggi;
6. connection dipakai lama;
7. pool lebih cepat penuh.

### 2.2 Cara lebih baik: transaction manual, tetapi tanpa batch

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement("""
         insert into payment_event(id, payment_id, status, created_at)
         values (?, ?, ?, ?)
         """)) {

    con.setAutoCommit(false);

    for (PaymentEvent event : events) {
        ps.setLong(1, event.id());
        ps.setLong(2, event.paymentId());
        ps.setString(3, event.status());
        ps.setObject(4, event.createdAt());
        ps.executeUpdate();
    }

    con.commit();
} catch (SQLException e) {
    // rollback omitted for brevity; do not omit in real code
    throw e;
}
```

Ini sudah mengurangi commit cost karena commit hanya sekali.

Tetapi masih ada banyak execute round-trip.

### 2.3 Cara umum untuk throughput: transaction + batch

```java
try (Connection con = dataSource.getConnection();
     PreparedStatement ps = con.prepareStatement("""
         insert into payment_event(id, payment_id, status, created_at)
         values (?, ?, ?, ?)
         """)) {

    con.setAutoCommit(false);

    for (PaymentEvent event : events) {
        ps.setLong(1, event.id());
        ps.setLong(2, event.paymentId());
        ps.setString(3, event.status());
        ps.setObject(4, event.createdAt());
        ps.addBatch();
    }

    int[] counts = ps.executeBatch();
    con.commit();
}
```

Batch mencoba mengurangi overhead:

```text
Before:
  bind row 1 -> execute
  bind row 2 -> execute
  bind row 3 -> execute
  ...

After:
  bind row 1 -> add batch
  bind row 2 -> add batch
  bind row 3 -> add batch
  execute batch
```

Namun batch yang baik bukan hanya menaruh `addBatch()`. Batch yang baik butuh:

1. transaction boundary yang benar;
2. batch size yang masuk akal;
3. error handling yang eksplisit;
4. retry policy;
5. idempotency;
6. observability;
7. driver/database-specific tuning.

---

## 3. JDBC Batch API: Statement vs PreparedStatement

JDBC batch tersedia pada `Statement` dan `PreparedStatement`.

### 3.1 `Statement` batch

```java
try (Statement st = con.createStatement()) {
    st.addBatch("insert into audit_log(id, action) values (1, 'CREATE')");
    st.addBatch("insert into audit_log(id, action) values (2, 'APPROVE')");
    st.addBatch("insert into audit_log(id, action) values (3, 'REJECT')");

    int[] counts = st.executeBatch();
}
```

Ini legal, tetapi jarang ideal untuk application data karena:

1. raw SQL string mudah membuka risiko SQL injection jika value berasal dari input;
2. driver tidak selalu bisa melakukan bind-level optimization;
3. SQL text berbeda-beda bisa membuat parse/plan cache tidak efektif;
4. escaping manual rawan error;
5. generated keys dan type handling lebih sulit.

`Statement` batch lebih cocok untuk:

1. schema/setup script internal;
2. test fixture sederhana;
3. maintenance command yang statis;
4. DDL terbatas, dengan catatan DDL punya semantics transaction berbeda antar database.

### 3.2 `PreparedStatement` batch

```java
try (PreparedStatement ps = con.prepareStatement("""
    update case_assignment
       set assignee_id = ?, updated_at = ?
     where case_id = ?
    """)) {

    for (AssignmentChange change : changes) {
        ps.setLong(1, change.assigneeId());
        ps.setObject(2, change.updatedAt());
        ps.setLong(3, change.caseId());
        ps.addBatch();
    }

    int[] counts = ps.executeBatch();
}
```

Ini lebih umum dan lebih aman karena:

1. SQL shape stabil;
2. value dikirim sebagai bind parameter;
3. driver dapat mengoptimalkan repeated execution;
4. type mapping lebih jelas;
5. query plan reuse lebih mungkin;
6. lebih aman terhadap injection pada value.

Rule praktis:

> Untuk data application normal, gunakan `PreparedStatement` batch, bukan `Statement` batch.

---

## 4. Apa yang Disimpan Saat `addBatch()`?

Saat menggunakan `PreparedStatement`, flow-nya biasanya:

```java
ps.setLong(1, id);
ps.setString(2, name);
ps.addBatch();
```

Pertanyaan penting:

> Setelah `addBatch()`, di mana parameter itu disimpan?

Jawabannya: tergantung driver, tetapi secara konsep driver menyimpan snapshot parameter untuk satu batch entry.

```text
PreparedStatement SQL:
  insert into user_account(id, name) values (?, ?)

Batch buffer:
  Entry 1: [1, "Ayu"]
  Entry 2: [2, "Budi"]
  Entry 3: [3, "Citra"]
```

Implikasi:

1. batch besar menggunakan memory di sisi JVM/driver;
2. parameter besar seperti `byte[]`, `String` besar, `InputStream`, `Reader`, CLOB/BLOB bisa berat;
3. jangan membangun batch jutaan row sekaligus;
4. flush secara periodik dengan batch size tertentu;
5. setelah `executeBatch()`, panggil `clearBatch()` bila perlu untuk memperjelas lifecycle.

Contoh flushing periodik:

```java
static final int BATCH_SIZE = 500;

int pending = 0;

for (PaymentEvent event : events) {
    bindPaymentEvent(ps, event);
    ps.addBatch();
    pending++;

    if (pending == BATCH_SIZE) {
        ps.executeBatch();
        ps.clearBatch();
        pending = 0;
    }
}

if (pending > 0) {
    ps.executeBatch();
    ps.clearBatch();
}
```

---

## 5. `executeBatch()` Return Value

`executeBatch()` mengembalikan `int[]`.

```java
int[] counts = ps.executeBatch();
```

Setiap elemen adalah update count untuk command terkait.

Secara umum isi array dapat berupa:

```text
>= 0                      jumlah row yang affected
Statement.SUCCESS_NO_INFO  command sukses, tapi jumlah row tidak diketahui
Statement.EXECUTE_FAILED   command gagal; hanya muncul jika driver melanjutkan setelah failure
```

Contoh:

```java
for (int i = 0; i < counts.length; i++) {
    int count = counts[i];

    if (count >= 0) {
        System.out.printf("Batch item %d affected %d row(s)%n", i, count);
    } else if (count == Statement.SUCCESS_NO_INFO) {
        System.out.printf("Batch item %d succeeded, row count unknown%n", i);
    } else if (count == Statement.EXECUTE_FAILED) {
        System.out.printf("Batch item %d failed%n", i);
    }
}
```

Important nuance:

> Jangan selalu mengasumsikan `counts.length == input.size()` dalam semua mode/driver/rewriting/failure case.

Untuk successful normal batch, sering iya. Tetapi saat failure, rewrite, generated keys, atau driver-specific optimization, informasi detail bisa berubah.

---

## 6. `executeLargeBatch()`

JDBC juga menyediakan `executeLargeBatch()` yang mengembalikan `long[]`.

```java
long[] counts = ps.executeLargeBatch();
```

Gunanya untuk update count yang bisa melebihi kapasitas `int`, khususnya operasi besar.

Secara praktis:

- `executeBatch()` cukup untuk sebagian besar OLTP batch biasa;
- `executeLargeBatch()` lebih aman untuk bulk processing besar;
- driver support tetap harus diperhatikan;
- jangan menjadikan `long[]` sebagai alasan membuat transaction raksasa.

Rule:

> Kalau batch kamu cukup besar sampai khawatir `int` overflow, kemungkinan kamu juga perlu mengevaluasi ulang transaction chunking, lock duration, redo log pressure, dan recovery strategy.

---

## 7. Atomicity: Apakah Satu Batch Pasti All-or-Nothing?

Jawaban pendek:

> Tidak otomatis. Atomicity ditentukan oleh transaction boundary, bukan oleh `executeBatch()` saja.

### 7.1 Auto-commit true

Jika `autoCommit=true`, behavior bisa berbeda antar driver/database, tetapi jangan mengandalkan batch sebagai atomic unit.

```java
con.setAutoCommit(true);
ps.addBatch();
ps.addBatch();
ps.executeBatch();
```

Kemungkinan behavior:

1. setiap command committed sendiri;
2. seluruh batch diperlakukan sebagai unit internal;
3. sebagian sukses sebelum failure;
4. update count hanya sebagian;
5. rollback tidak bisa dilakukan oleh aplikasi karena sudah committed.

Untuk production correctness, ini berbahaya.

### 7.2 Auto-commit false

Gunakan explicit transaction:

```java
con.setAutoCommit(false);

try {
    // add batch
    ps.executeBatch();
    con.commit();
} catch (SQLException e) {
    con.rollback();
    throw e;
}
```

Dengan ini, aplikasi punya kontrol:

```text
executeBatch sukses -> commit
executeBatch gagal  -> rollback
```

Namun tetap ada nuance:

1. beberapa database punya statement/DDL yang implicit commit;
2. beberapa error bisa membuat transaction berada pada state aborted dan wajib rollback;
3. connection bisa putus setelah database melakukan commit tetapi sebelum client menerima response;
4. retry setelah unknown commit outcome butuh idempotency.

Rule penting:

> Batch yang membutuhkan atomicity harus dijalankan dalam transaction eksplisit dengan `autoCommit=false`.

---

## 8. Partial Failure dan `BatchUpdateException`

Ketika batch gagal, JDBC melempar `BatchUpdateException`, subclass dari `SQLException`.

```java
try {
    ps.executeBatch();
    con.commit();
} catch (BatchUpdateException e) {
    int[] updateCounts = e.getUpdateCounts();
    con.rollback();
    throw e;
}
```

`BatchUpdateException` penting karena dapat membawa update counts dari command yang berhasil sebelum failure.

Tetapi jangan overinterpret update counts.

### 8.1 Driver bisa stop saat first failure

Contoh:

```text
Input batch: 1000 rows
Failure at row: 300

updateCounts length: 299
```

Makna:

- command 0..298 dilaporkan berhasil;
- row 299 gagal;
- sisanya belum dieksekusi atau tidak dilaporkan.

### 8.2 Driver bisa continue after failure

Contoh:

```text
Input batch: 1000 rows
Failure at rows: 300, 700

updateCounts length: 1000
counts[299] = EXECUTE_FAILED
counts[699] = EXECUTE_FAILED
```

Makna:

- beberapa gagal;
- beberapa lain tetap dijalankan;
- transaction boundary menentukan apakah hasil itu committed atau di-rollback.

### 8.3 Driver rewrite bisa mengurangi detail

Jika batch insert di-rewrite menjadi multi-values insert:

```sql
insert into user_account(id, name)
values
  (?, ?),
  (?, ?),
  (?, ?)
```

Maka database mungkin melihat satu statement besar, bukan 3 statement individual.

Jika salah satu row melanggar constraint, detail row mana yang gagal bisa lebih sulit diketahui dari update count.

Rule:

> Kalau kamu membutuhkan error detail per row, jangan hanya mengandalkan batch update counts. Desain validasi, staging table, idempotency key, atau error isolation strategy.

---

## 9. Correct Batch Transaction Template

Template minimal yang benar:

```java
public void insertPaymentEvents(DataSource dataSource, List<PaymentEvent> events) throws SQLException {
    String sql = """
        insert into payment_event(id, payment_id, status, created_at)
        values (?, ?, ?, ?)
        """;

    try (Connection con = dataSource.getConnection()) {
        boolean previousAutoCommit = con.getAutoCommit();
        con.setAutoCommit(false);

        try (PreparedStatement ps = con.prepareStatement(sql)) {
            for (PaymentEvent event : events) {
                ps.setLong(1, event.id());
                ps.setLong(2, event.paymentId());
                ps.setString(3, event.status());
                ps.setObject(4, event.createdAt());
                ps.addBatch();
            }

            ps.executeBatch();
            con.commit();
        } catch (SQLException e) {
            try {
                con.rollback();
            } catch (SQLException rollbackFailure) {
                e.addSuppressed(rollbackFailure);
            }
            throw e;
        } finally {
            try {
                con.setAutoCommit(previousAutoCommit);
            } catch (SQLException restoreFailure) {
                // In pooled environments, prefer not to hide this.
                // HikariCP also resets known connection state, but application code should still be disciplined.
                throw restoreFailure;
            }
        }
    }
}
```

Catatan:

1. jika memakai transaction manager seperti Spring, jangan manual `commit/rollback` di repository;
2. jika memakai raw JDBC, transaction ownership harus jelas;
3. restore state penting karena pooled connection dapat dipakai ulang;
4. jangan swallow rollback failure;
5. jangan return connection ke pool dalam transaction state ambigu.

---

## 10. Chunked Batch Template untuk Production

Batch sangat besar sebaiknya diproses dalam chunk.

```java
public void insertInChunks(DataSource dataSource, List<PaymentEvent> events) throws SQLException {
    final int batchSize = 500;

    String sql = """
        insert into payment_event(id, payment_id, status, created_at)
        values (?, ?, ?, ?)
        """;

    try (Connection con = dataSource.getConnection()) {
        boolean previousAutoCommit = con.getAutoCommit();
        con.setAutoCommit(false);

        try (PreparedStatement ps = con.prepareStatement(sql)) {
            int pending = 0;

            for (PaymentEvent event : events) {
                bindPaymentEvent(ps, event);
                ps.addBatch();
                pending++;

                if (pending == batchSize) {
                    ps.executeBatch();
                    ps.clearBatch();
                    con.commit();
                    pending = 0;
                }
            }

            if (pending > 0) {
                ps.executeBatch();
                ps.clearBatch();
                con.commit();
            }
        } catch (SQLException e) {
            try {
                con.rollback();
            } catch (SQLException rollbackFailure) {
                e.addSuppressed(rollbackFailure);
            }
            throw e;
        } finally {
            con.setAutoCommit(previousAutoCommit);
        }
    }
}

private void bindPaymentEvent(PreparedStatement ps, PaymentEvent event) throws SQLException {
    ps.setLong(1, event.id());
    ps.setLong(2, event.paymentId());
    ps.setString(3, event.status());
    ps.setObject(4, event.createdAt());
}
```

Kelebihan chunking:

1. memory driver lebih terkendali;
2. transaction tidak terlalu panjang;
3. lock tidak ditahan terlalu lama;
4. redo/WAL pressure lebih stabil;
5. recovery lebih mudah;
6. observability lebih granular;
7. retry lebih kecil cakupannya.

Kekurangan:

1. atomicity tidak lagi seluruh input list;
2. sebagian chunk bisa committed sebelum chunk berikutnya gagal;
3. butuh idempotency/restartability;
4. ordering dan dependency antar row harus diperhatikan.

Rule:

> Untuk batch job besar, pilih restartability dan chunk-level commit. Untuk command bisnis kecil yang harus atomic, pilih one transaction.

---

## 11. Batch Size: Tidak Ada Angka Sakral

Pertanyaan umum:

> Batch size sebaiknya 100, 500, 1000, atau 5000?

Jawaban jujur:

> Tidak ada angka universal. Batch size adalah hasil kompromi antara network efficiency, driver memory, DB memory, lock duration, log pressure, error isolation, dan latency budget.

### 11.1 Batch terlalu kecil

Contoh batch size 1 atau 5.

Masalah:

1. round-trip masih banyak;
2. throughput improvement kecil;
3. commit overhead masih tinggi jika commit per batch;
4. pool occupancy lebih lama.

### 11.2 Batch terlalu besar

Contoh batch size 50.000.

Masalah:

1. memory JVM/driver besar;
2. packet/message besar;
3. DB session memory besar;
4. transaction panjang;
5. lock lama;
6. rollback mahal;
7. replication lag bisa naik;
8. failure recovery sulit;
9. query lain terdampak;
10. generated keys handling berat.

### 11.3 Starting point praktis

Untuk OLTP-ish insert/update biasa:

```text
Start: 100 - 500 rows per batch
Try:   500 - 1000 if row kecil dan DB kuat
Avoid: >5000 tanpa measurement dan alasan jelas
```

Untuk row besar, CLOB/BLOB, JSON besar:

```text
Start: 20 - 100 rows per batch
```

Untuk data migration/bulk load:

```text
Jangan langsung pakai JDBC batch biasa sebagai default.
Evaluasi bulk loader native, COPY, SQL*Loader, external table, staging table, atau database-specific load path.
```

### 11.4 Cara memilih batch size

Ukur:

1. elapsed time total;
2. average/p95 batch execution time;
3. rows per second;
4. DB CPU;
5. DB wait event;
6. lock wait;
7. WAL/redo generation;
8. connection pool active time;
9. GC/memory;
10. error recovery cost.

Jangan hanya melihat “lebih cepat di laptop”.

---

## 12. Driver Rewriting: Batch API Tidak Sama dengan SQL yang Dikirim

Salah satu alasan batch bisa cepat adalah driver dapat mengubah representasi command.

### 12.1 PostgreSQL `reWriteBatchedInserts`

pgJDBC memiliki property `reWriteBatchedInserts` yang dapat mengubah batch insert menjadi multi-values insert.

Secara konseptual:

```sql
insert into t(a, b) values (?, ?);
insert into t(a, b) values (?, ?);
insert into t(a, b) values (?, ?);
```

Dapat diubah menjadi:

```sql
insert into t(a, b)
values
  (?, ?),
  (?, ?),
  (?, ?);
```

Efek:

1. round-trip lebih sedikit;
2. parse/execute lebih efisien;
3. throughput insert bisa naik besar;
4. detail update count/error bisa berubah;
5. SQL statement menjadi lebih besar;
6. limit parameter/packet bisa tercapai;
7. generated keys behavior harus diuji.

Contoh konfigurasi URL:

```text
jdbc:postgresql://localhost:5432/app?reWriteBatchedInserts=true
```

### 12.2 MySQL `rewriteBatchedStatements`

MySQL Connector/J memiliki property `rewriteBatchedStatements`.

Secara konseptual, driver bisa melakukan rewrite terhadap batch insert/update tertentu agar lebih efisien.

Contoh URL:

```text
jdbc:mysql://localhost:3306/app?rewriteBatchedStatements=true
```

Catatan:

1. behavior bergantung pada SQL shape;
2. server-side prepared statement setting dapat memengaruhi;
3. generated keys harus diuji;
4. packet size dapat menjadi batas;
5. error detail per row bisa tidak sesederhana batch tanpa rewrite.

### 12.3 Oracle JDBC batching / array binding

Oracle JDBC secara historis kuat di area array binding/update batching. Konsepnya bukan selalu rewrite menjadi multi-values SQL, melainkan mengirim array bind untuk satu statement.

Mental model:

```text
SQL:
  insert into t(a, b) values (:1, :2)

Bind arrays:
  :1 = [1, 2, 3, 4]
  :2 = [A, B, C, D]
```

Efek:

1. SQL shape tetap satu;
2. bind values dikirim dalam array;
3. parse reuse baik;
4. network lebih efisien;
5. cocok untuk prepared statement repeated execution;
6. error reporting perlu dipahami dari dokumentasi driver.

### 12.4 Kesimpulan rewriting

Rule:

> JDBC batch adalah API portable, tetapi optimization-nya tidak portable.

Maka untuk production:

1. baca dokumentasi driver;
2. aktifkan property yang relevan secara eksplisit;
3. benchmark dengan data representatif;
4. uji error case;
5. uji generated keys;
6. uji observability/logging;
7. dokumentasikan asumsi di konfigurasi aplikasi.

---

## 13. Batch Insert vs Multi-Row Insert Manual

Ada dua pendekatan:

### 13.1 JDBC batch

```java
PreparedStatement ps = con.prepareStatement("""
    insert into user_account(id, email) values (?, ?)
    """);

for (User user : users) {
    ps.setLong(1, user.id());
    ps.setString(2, user.email());
    ps.addBatch();
}

ps.executeBatch();
```

### 13.2 Multi-row insert manual

```sql
insert into user_account(id, email)
values
  (?, ?),
  (?, ?),
  (?, ?)
```

Lalu aplikasi membangun SQL dengan jumlah placeholder dinamis.

### 13.3 Trade-off

JDBC batch:

- kode lebih sederhana;
- SQL shape stabil;
- bisa memanfaatkan driver optimization;
- lebih portable;
- batch size mudah dikontrol;
- generated keys tergantung driver.

Manual multi-row:

- bisa sangat cepat;
- satu statement eksplisit;
- lebih sulit membangun SQL aman;
- jumlah placeholder berubah;
- dapat menghantam parameter limit;
- generated keys/error mapping lebih rumit;
- plan cache bisa kurang efektif jika SQL shape berubah terus.

Rule:

> Mulai dari JDBC batch. Gunakan manual multi-row hanya jika ada alasan terukur dan kamu siap mengelola kompleksitasnya.

---

## 14. Generated Keys dalam Batch

JDBC mendukung generated keys:

```java
try (PreparedStatement ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
    for (NewUser user : users) {
        ps.setString(1, user.email());
        ps.addBatch();
    }

    ps.executeBatch();

    try (ResultSet keys = ps.getGeneratedKeys()) {
        while (keys.next()) {
            long id = keys.getLong(1);
            // map generated id
        }
    }
}
```

Namun batch + generated keys punya banyak caveat:

1. tidak semua driver memberi mapping yang nyaman;
2. urutan keys umumnya diharapkan sama dengan input, tetapi tetap harus diuji;
3. rewrite batch dapat memengaruhi behavior;
4. trigger/sequence/default value dapat memengaruhi;
5. multi-row insert bisa mengembalikan keys berbeda antar database;
6. batch failure bisa membuat mapping ambigu;
7. generated key retrieval dapat menambah overhead.

### 14.1 Strategi yang lebih deterministik

Untuk sistem enterprise, sering lebih baik memakai ID dari aplikasi:

```java
long id = idGenerator.nextId();
```

Atau UUID/ULID:

```java
UUID id = UUID.randomUUID();
```

Keuntungan:

1. mapping input-output jelas;
2. retry lebih mudah;
3. idempotency lebih mudah;
4. event/outbox lebih mudah;
5. tidak perlu round-trip generated keys;
6. batch failure lebih mudah dianalisis.

Kelemahan:

1. perlu desain ID generator;
2. UUID random dapat memengaruhi index locality;
3. sequence database mungkin lebih sederhana untuk single database system.

Rule:

> Untuk batch insert besar dan sistem yang butuh retry/restartability, application-assigned ID sering lebih operasional daripada bergantung pada generated keys.

---

## 15. Batch Update dan Optimistic Concurrency

Batch bukan hanya insert. Update batch juga umum.

Contoh update status case:

```java
String sql = """
    update enforcement_case
       set status = ?, version = version + 1, updated_at = ?
     where case_id = ?
       and version = ?
    """;

try (PreparedStatement ps = con.prepareStatement(sql)) {
    for (CaseTransition transition : transitions) {
        ps.setString(1, transition.newStatus());
        ps.setObject(2, transition.updatedAt());
        ps.setLong(3, transition.caseId());
        ps.setLong(4, transition.expectedVersion());
        ps.addBatch();
    }

    int[] counts = ps.executeBatch();

    for (int i = 0; i < counts.length; i++) {
        if (counts[i] == 0) {
            throw new OptimisticLockFailureException("Case transition conflict at index " + i);
        }
    }
}
```

Di sini update count sangat penting.

Jika update count `0`, artinya:

1. row tidak ditemukan; atau
2. version mismatch; atau
3. status sudah berubah; atau
4. WHERE condition tidak match.

Untuk workflow/state machine, jangan menganggap batch update sukses hanya karena tidak ada exception.

Rule:

> Untuk batch update dengan business invariant, validasi update count per item.

---

## 16. Batch Delete: Bahaya yang Sering Diremehkan

Batch delete tampak sederhana:

```java
try (PreparedStatement ps = con.prepareStatement("delete from temp_upload where id = ?")) {
    for (long id : ids) {
        ps.setLong(1, id);
        ps.addBatch();
    }
    ps.executeBatch();
}
```

Risikonya:

1. delete memegang lock;
2. delete menghasilkan undo/redo/WAL;
3. delete bisa memicu foreign key check;
4. delete bisa memicu trigger;
5. delete bisa membuat table/index bloat;
6. delete besar dapat mengganggu replication;
7. delete tanpa chunking bisa membuat rollback mahal;
8. cascading delete bisa jauh lebih besar dari input.

Untuk delete besar, sering lebih baik:

1. chunk berdasarkan primary key range;
2. soft delete lalu async purge;
3. delete via staging table join;
4. partition drop/truncate jika cocok;
5. archive dulu lalu purge;
6. batasi durasi per transaction.

Rule:

> Batch delete harus diperlakukan sebagai data maintenance operation, bukan sekadar loop DML.

---

## 17. Batch dan Lock Amplification

Batch meningkatkan throughput, tetapi juga dapat memperbesar lock footprint.

Misal update 10.000 row dalam satu transaction:

```text
Transaction T1:
  update row 1
  update row 2
  update row 3
  ...
  update row 10000
  commit
```

Selama belum commit, lock dapat tertahan.

Dampak:

1. transaksi lain menunggu;
2. lock wait meningkat;
3. deadlock probability naik;
4. pool connection aktif lebih lama;
5. request latency naik;
6. retry storm bisa terjadi;
7. database active session penuh.

### 17.1 Deadlock karena urutan update berbeda

Worker A:

```text
update case_id 1
update case_id 2
```

Worker B:

```text
update case_id 2
update case_id 1
```

Risiko:

```text
A locks 1
B locks 2
A waits for 2
B waits for 1
Deadlock
```

Mitigasi:

1. urutkan input berdasarkan primary key;
2. gunakan chunk kecil;
3. pisahkan workload yang berkonflik;
4. gunakan optimistic locking;
5. retry deadlock dengan backoff;
6. hindari user-facing transaction panjang.

Rule:

> Untuk batch update/delete, sorting by stable key adalah teknik sederhana yang sering mengurangi deadlock.

---

## 18. Retry Batch: Jangan Naif

Batch failure sering menggoda untuk langsung retry seluruh batch.

```java
try {
    ps.executeBatch();
} catch (SQLException e) {
    ps.executeBatch(); // buruk
}
```

Ini berbahaya.

### 18.1 Kenapa?

Karena outcome bisa ambigu:

1. sebagian row sudah committed jika auto-commit true;
2. commit mungkin sukses tetapi client tidak menerima response;
3. constraint violation tidak akan sembuh dengan retry;
4. duplicate key bisa muncul pada retry;
5. deadlock mungkin retryable;
6. network failure saat commit butuh reconciliation;
7. generated keys bisa berubah;
8. side effect trigger bisa sudah terjadi.

### 18.2 Klasifikasi error

Retryable biasanya:

1. deadlock;
2. serialization failure;
3. transient connection failure sebelum transaction outcome;
4. lock timeout tertentu, bergantung use case;
5. database failover setelah rollback jelas.

Non-retryable biasanya:

1. syntax error;
2. missing column/table;
3. constraint violation karena data invalid;
4. data too long;
5. invalid type conversion;
6. permission denied;
7. duplicate key jika operasi bukan idempotent.

### 18.3 Idempotent batch design

Gunakan idempotency key atau natural unique key.

Contoh:

```sql
insert into outbound_event(event_id, aggregate_id, event_type, payload, created_at)
values (?, ?, ?, ?, ?)
```

`event_id` dibuat oleh aplikasi. Retry insert dengan `event_id` yang sama dapat dideteksi.

Untuk PostgreSQL:

```sql
insert into outbound_event(event_id, aggregate_id, event_type, payload, created_at)
values (?, ?, ?, ?, ?)
on conflict (event_id) do nothing
```

Untuk Oracle/MySQL, strategi bisa berbeda:

1. merge/upsert;
2. catch duplicate key as already processed;
3. staging table dengan unique key;
4. job checkpoint.

Rule:

> Batch retry yang aman membutuhkan idempotency. Tanpa idempotency, retry bisa menggandakan data atau side effect.

---

## 19. Staging Table Pattern

Untuk bulk import yang perlu error isolation, staging table sering lebih baik daripada langsung insert ke final table.

### 19.1 Flow

```text
1. Insert raw rows ke staging table dengan batch.
2. Validasi data di database.
3. Tandai row valid/invalid.
4. Insert row valid ke final table dengan SQL set-based.
5. Simpan error row untuk review.
6. Commit per chunk/job phase.
```

### 19.2 Contoh staging table

```sql
create table case_import_staging (
    import_id       varchar(64) not null,
    row_no          integer not null,
    external_ref    varchar(100),
    case_type       varchar(50),
    applicant_id    varchar(100),
    raw_payload     clob,
    validation_status varchar(20),
    validation_error  varchar(4000),
    created_at      timestamp not null,
    primary key (import_id, row_no)
);
```

### 19.3 Keuntungan

1. row-level error bisa disimpan;
2. retry job lebih mudah;
3. validation dapat set-based;
4. final insert lebih terkendali;
5. auditability lebih baik;
6. cocok untuk regulatory/data import scenario;
7. bisa reconcile jumlah input-valid-invalid.

### 19.4 Kapan staging table cocok?

1. file import;
2. bulk migration;
3. data correction;
4. external system feed;
5. batch integration;
6. perlu laporan error detail;
7. perlu approval sebelum final apply.

Rule:

> Jika batch input berasal dari luar sistem dan bisa mengandung bad rows, staging table hampir selalu lebih defensible daripada direct insert ke final table.

---

## 20. Batch dengan Connection Pool

Batch operation sering memegang connection lebih lama daripada request biasa.

Dampak ke HikariCP/pool:

```text
Long batch transaction:
  borrowed connection remains active longer
  active count increases
  pending threads increase
  connectionTimeout may happen
  user-facing request can fail
```

### 20.1 Anti-pattern: background batch memakai pool OLTP yang sama

```text
API requests     -> same Hikari pool -> database
Background batch -> same Hikari pool -> database
```

Jika batch besar berjalan:

1. API request bisa menunggu connection;
2. latency naik;
3. timeout naik;
4. retry dari API memperparah load;
5. database makin berat.

### 20.2 Better: workload isolation

```text
API OLTP pool:
  maximumPoolSize = 20
  short timeout
  short transaction

Batch worker pool:
  maximumPoolSize = 2-5
  controlled throughput
  longer timeout if needed
```

Keuntungan:

1. batch tidak memakan semua connection;
2. API tetap punya capacity;
3. database load lebih predictable;
4. backpressure bisa diterapkan per workload;
5. observability lebih jelas.

Rule:

> Batch job besar sebaiknya tidak berbagi pool tanpa batas dengan request path utama.

---

## 21. Batch and Backpressure

Batch sering dipakai di worker/consumer:

```text
Kafka/RabbitMQ/Scheduler -> Java Worker -> JDBC Batch -> Database
```

Jika database melambat, worker bisa tetap mengambil message dan menumpuk memory.

Backpressure yang sehat:

1. batasi jumlah worker thread;
2. batasi pool size khusus batch;
3. batasi batch size;
4. batasi queue internal;
5. pause consumer saat DB error;
6. gunakan retry dengan backoff;
7. expose lag/queue metrics;
8. jangan spawn unlimited task;
9. jangan parallelize batch blindly.

Mental model:

```text
Throughput worker <= throughput database yang aman
```

Bukan:

```text
Semakin banyak thread, semakin cepat
```

Rule:

> Pool size batch adalah governor. Gunakan untuk membatasi damage saat database lambat.

---

## 22. Observability untuk Batch

Batch tanpa observability sulit didiagnosis.

Log minimal per chunk:

```text
job_id
chunk_id
batch_size
operation
elapsed_ms
success_count
failure_count
sql_state
vendor_code
retry_attempt
connection_pool
```

Metric minimal:

1. batch execution duration;
2. rows per second;
3. committed rows;
4. failed rows;
5. retry count;
6. deadlock count;
7. lock timeout count;
8. duplicate key count;
9. pool active connections;
10. pool pending threads;
11. DB wait event if available;
12. transaction duration;
13. chunk commit duration.

Contoh structured log concept:

```json
{
  "event": "jdbc_batch_chunk_completed",
  "jobId": "import-2026-06-16-001",
  "chunkId": 42,
  "operation": "insert_case_import_staging",
  "batchSize": 500,
  "elapsedMs": 183,
  "rowsPerSecond": 2732,
  "poolName": "batch-writer-pool"
}
```

Untuk error:

```json
{
  "event": "jdbc_batch_chunk_failed",
  "jobId": "import-2026-06-16-001",
  "chunkId": 43,
  "operation": "insert_case_import_staging",
  "batchSize": 500,
  "elapsedMs": 97,
  "sqlState": "23505",
  "vendorCode": 1,
  "classification": "duplicate_key",
  "retryable": false
}
```

Rule:

> Untuk batch, observability harus row/chunk/job-aware, bukan hanya exception stack trace.

---

## 23. Batch and Validation Strategy

Ada dua pendekatan validasi:

### 23.1 Validate before batch

Aplikasi memvalidasi semua row sebelum insert.

Keuntungan:

1. error lebih dekat ke input;
2. pesan error bisa lebih ramah;
3. mengurangi constraint violation;
4. menghindari rollback mahal.

Kekurangan:

1. aplikasi bisa tidak tahu semua constraint database;
2. race condition tetap mungkin;
3. validasi duplicate membutuhkan DB check;
4. validasi kompleks bisa lambat.

### 23.2 Let database enforce constraint

Aplikasi insert, database menolak row invalid.

Keuntungan:

1. invariant final tetap di database;
2. tidak ada duplicate logic berlebihan;
3. concurrency lebih aman.

Kekurangan:

1. error batch bisa kurang detail;
2. rollback chunk;
3. mapping row gagal sulit;
4. user feedback bisa buruk.

### 23.3 Hybrid pattern

Untuk sistem serius:

1. pre-validate syntactic/business basic;
2. insert ke staging;
3. database validate set-based;
4. mark invalid rows;
5. final apply only valid rows;
6. database constraints tetap menjadi last line of defense.

Rule:

> Validasi aplikasi meningkatkan UX. Constraint database menjaga kebenaran final. Jangan pilih salah satu secara ekstrem.

---

## 24. Case Study: Batch Insert Audit Trail

Bayangkan sistem regulatory menyimpan audit event.

```text
case_id
activity
actor_id
metadata CLOB
created_at
```

Naive batch:

```java
for (AuditEvent event : events) {
    ps.setLong(1, event.caseId());
    ps.setString(2, event.activity());
    ps.setString(3, event.actorId());
    ps.setString(4, event.metadataJson());
    ps.setObject(5, event.createdAt());
    ps.addBatch();
}
ps.executeBatch();
```

Risiko:

1. metadata JSON besar menumpuk di driver memory;
2. batch size 1000 bisa terlalu besar;
3. insert ke hot audit table bisa membuat index pressure;
4. transaction panjang menunda visibility;
5. CLOB storage dapat membuat IO berat;
6. logging bind value dapat membocorkan data;
7. generated keys tidak diperlukan jika audit_id bisa dibuat aplikasi.

Better design:

1. generate audit_id di aplikasi;
2. batch size kecil-menengah, misalnya 100;
3. jangan log metadata full;
4. gunakan dedicated audit writer pool jika async;
5. ukur row size;
6. monitor insert latency dan segment growth;
7. pertimbangkan partitioning/archive untuk audit table;
8. pertimbangkan outbox jika audit harus mengikuti transaction domain.

---

## 25. Case Study: Workflow State Transition Batch

Misal ada batch job auto-close cases yang overdue.

Naive:

```sql
update enforcement_case
set status = 'CLOSED'
where due_date < ?
and status = 'OPEN'
```

Ini set-based, bukan JDBC batch. Bisa sangat cepat, tapi mungkin terlalu besar dan opaque.

Alternatif JDBC batch:

```java
String sql = """
    update enforcement_case
       set status = 'CLOSED', version = version + 1, updated_at = ?
     where case_id = ?
       and status = 'OPEN'
       and version = ?
    """;
```

Trade-off:

Set-based SQL:

1. cepat;
2. satu statement;
3. locking bisa besar;
4. row-level business event/audit lebih sulit;
5. update count total saja.

JDBC batch per case:

1. bisa validasi per case;
2. bisa emit audit/outbox per case;
3. lebih lambat;
4. lebih banyak bind;
5. update count per item;
6. retry lebih granular.

Top 1% engineer tidak otomatis memilih batch. Ia bertanya:

1. apakah perlu per-row invariant?
2. apakah perlu per-row audit/event?
3. apakah update bisa set-based?
4. apakah lock footprint aman?
5. apakah job restartable?
6. apakah partial success acceptable?

Rule:

> JDBC batch bukan pengganti set-based SQL. Pilih berdasarkan invariant dan operability.

---

## 26. Batch vs Bulk Loader

Untuk jutaan row, JDBC batch mungkin bukan pilihan terbaik.

Alternatif:

1. PostgreSQL `COPY`;
2. MySQL `LOAD DATA`;
3. Oracle SQL\*Loader;
4. Oracle external table;
5. database-specific bulk API;
6. cloud-native load from object storage;
7. staging file + database load;
8. ETL/ELT tools.

JDBC batch cocok untuk:

1. ribuan sampai ratusan ribu row dengan logic aplikasi;
2. OLTP-adjacent bulk operation;
3. batch yang butuh prepared statement dan transaction control;
4. moderate import;
5. background worker writes;
6. outbox/event persistence.

Bulk loader cocok untuk:

1. jutaan sampai miliaran row;
2. migration;
3. data warehouse load;
4. file ingestion;
5. minimal row-by-row business logic;
6. throughput maksimum.

Rule:

> Jika targetnya pure ingestion skala besar, evaluasi native bulk load sebelum memaksakan JDBC batch.

---

## 27. Common Anti-Patterns

### 27.1 Batch tanpa transaction eksplisit

```java
// autoCommit true
ps.executeBatch();
```

Masalah:

- atomicity tidak jelas;
- partial commit bisa terjadi;
- retry sulit.

### 27.2 Batch terlalu besar

```java
for (Item item : oneMillionItems) {
    ps.addBatch();
}
ps.executeBatch();
```

Masalah:

- memory blow-up;
- transaction panjang;
- rollback mahal;
- lock lama.

### 27.3 Tidak mengecek update count

```java
ps.executeBatch();
// assume all business updates succeeded
```

Masalah:

- optimistic lock failure tidak terdeteksi;
- row missing tidak terdeteksi;
- state transition silently skipped.

### 27.4 Retry tanpa idempotency

```java
catch (SQLException e) {
    retryWholeBatch();
}
```

Masalah:

- duplicate insert;
- double side effect;
- inconsistent audit.

### 27.5 Background batch memakai semua pool connection

Masalah:

- API request timeout;
- pool exhaustion;
- database overload.

### 27.6 Menganggap semua driver sama

Masalah:

- property rewrite tidak aktif;
- generated keys tidak sesuai;
- error counts berbeda;
- performance tidak sesuai ekspektasi.

### 27.7 Logging semua bind value

Masalah:

- PII leak;
- log besar;
- security incident;
- compliance risk.

---

## 28. Production Checklist

Sebelum menggunakan JDBC batch di production, cek ini.

### 28.1 Correctness

- [ ] Apakah transaction boundary jelas?
- [ ] Apakah `autoCommit=false` dipakai jika butuh atomicity?
- [ ] Apakah rollback dilakukan pada failure?
- [ ] Apakah update count dicek untuk update/delete penting?
- [ ] Apakah partial success acceptable?
- [ ] Apakah retry idempotent?
- [ ] Apakah duplicate key behavior jelas?
- [ ] Apakah generated keys behavior sudah diuji?

### 28.2 Performance

- [ ] Apakah batch size diukur, bukan ditebak?
- [ ] Apakah row size diperhitungkan?
- [ ] Apakah batch besar di-chunk?
- [ ] Apakah driver rewrite/array binding dikonfigurasi bila perlu?
- [ ] Apakah packet/parameter limit diperhatikan?
- [ ] Apakah DB CPU/wait/log pressure dimonitor?

### 28.3 Pooling

- [ ] Apakah batch memakai pool yang tepat?
- [ ] Apakah batch tidak menghabiskan connection OLTP?
- [ ] Apakah pool size sesuai DB capacity?
- [ ] Apakah pending connection metric dimonitor?

### 28.4 Failure Handling

- [ ] Apakah `BatchUpdateException` ditangani eksplisit?
- [ ] Apakah SQLState/vendor code dicatat?
- [ ] Apakah error diklasifikasi retryable/non-retryable?
- [ ] Apakah rollback failure tidak disembunyikan?
- [ ] Apakah unknown commit outcome punya reconciliation?

### 28.5 Observability

- [ ] Apakah batch duration dicatat?
- [ ] Apakah rows/sec dihitung?
- [ ] Apakah chunk id/job id dicatat?
- [ ] Apakah failure count dicatat?
- [ ] Apakah log tidak membocorkan bind sensitive?

---

## 29. Design Heuristics

Gunakan heuristik berikut:

```text
Jika operasi harus atomic kecil:
  one transaction + moderate batch

Jika operasi besar dan restartable:
  chunked transaction + checkpoint

Jika input eksternal raw:
  staging table + validation + final apply

Jika butuh error per row:
  staging table atau smaller batch isolation

Jika hanya bulk load data besar:
  native bulk loader mungkin lebih baik

Jika API path user-facing:
  hindari batch besar di request thread

Jika background job:
  dedicated pool + controlled worker count

Jika update/delete banyak row:
  perhatikan lock, ordering, chunking

Jika retry dibutuhkan:
  idempotency dulu, retry kemudian
```

---

## 30. Mini Reference Implementation: Restartable Chunked Batch Writer

Contoh berikut bukan framework final, tetapi skeleton mental model.

```java
public final class ChunkedBatchWriter<T> {
    private final DataSource dataSource;
    private final String sql;
    private final int batchSize;
    private final Binder<T> binder;

    public ChunkedBatchWriter(
            DataSource dataSource,
            String sql,
            int batchSize,
            Binder<T> binder
    ) {
        if (batchSize <= 0) {
            throw new IllegalArgumentException("batchSize must be positive");
        }
        this.dataSource = dataSource;
        this.sql = sql;
        this.batchSize = batchSize;
        this.binder = binder;
    }

    public WriteResult write(List<T> items) throws SQLException {
        int committed = 0;
        int chunkNo = 0;

        try (Connection con = dataSource.getConnection()) {
            boolean previousAutoCommit = con.getAutoCommit();
            con.setAutoCommit(false);

            try (PreparedStatement ps = con.prepareStatement(sql)) {
                int pending = 0;

                for (int i = 0; i < items.size(); i++) {
                    binder.bind(ps, items.get(i));
                    ps.addBatch();
                    pending++;

                    if (pending == batchSize) {
                        executeChunk(con, ps, chunkNo, pending);
                        committed += pending;
                        chunkNo++;
                        pending = 0;
                    }
                }

                if (pending > 0) {
                    executeChunk(con, ps, chunkNo, pending);
                    committed += pending;
                }

                return new WriteResult(committed);
            } catch (SQLException e) {
                rollbackQuietlyButNotSilently(con, e);
                throw e;
            } finally {
                con.setAutoCommit(previousAutoCommit);
            }
        }
    }

    private void executeChunk(Connection con, PreparedStatement ps, int chunkNo, int pending)
            throws SQLException {
        long started = System.nanoTime();

        try {
            int[] counts = ps.executeBatch();
            validateCounts(counts, pending);
            con.commit();
            ps.clearBatch();

            long elapsedMs = (System.nanoTime() - started) / 1_000_000;
            // log chunkNo, pending, elapsedMs
        } catch (SQLException e) {
            rollbackQuietlyButNotSilently(con, e);
            throw e;
        }
    }

    private void validateCounts(int[] counts, int expected) throws SQLException {
        if (counts.length != expected) {
            // Depending on driver/rewrite this may need different treatment.
            // For strict business update, fail fast.
            throw new SQLException("Unexpected batch update count length: " + counts.length);
        }

        for (int i = 0; i < counts.length; i++) {
            if (counts[i] == Statement.EXECUTE_FAILED) {
                throw new SQLException("Batch item failed at index " + i);
            }
        }
    }

    private void rollbackQuietlyButNotSilently(Connection con, SQLException original) {
        try {
            con.rollback();
        } catch (SQLException rollbackFailure) {
            original.addSuppressed(rollbackFailure);
        }
    }

    @FunctionalInterface
    public interface Binder<T> {
        void bind(PreparedStatement ps, T item) throws SQLException;
    }

    public record WriteResult(int committedRows) {
    }
}
```

Caveat:

1. `validateCounts` perlu disesuaikan dengan use case;
2. untuk insert dengan `SUCCESS_NO_INFO`, strict count check mungkin terlalu keras;
3. untuk update optimistic locking, count `0` harus dianggap conflict;
4. untuk driver rewrite, counts length bisa perlu interpretasi khusus;
5. skeleton ini belum punya retry/checkpoint/idempotency;
6. jangan pakai mentah tanpa menyesuaikan transaction ownership framework.

---

## 31. Relationship dengan HikariCP

HikariCP sendiri tidak membuat batch lebih cepat secara langsung. HikariCP mengatur connection lifecycle.

Yang dipengaruhi batch terhadap HikariCP:

1. batch lama membuat connection aktif lebih lama;
2. active connection naik;
3. pending borrower naik;
4. leak detection bisa trigger jika batch lebih lama dari threshold;
5. connection timeout bisa terjadi pada request lain;
6. maxLifetime bisa berinteraksi dengan long-running operation;
7. metrics Hikari membantu melihat pool pressure.

Rule:

> Batch performance bukan hanya urusan SQL. Ia juga urusan pool occupancy dan concurrency budget.

---

## 32. Kesimpulan

Batch operation adalah alat throughput, tetapi bukan alat ajaib.

Mental model utama:

```text
JDBC batch = aplikasi mengumpulkan banyak command + driver/database mengeksekusi dengan strategi tertentu.
```

Hal yang harus selalu diingat:

1. atomicity datang dari transaction, bukan dari `executeBatch()`;
2. batch size harus diukur;
3. batch besar memperbesar lock dan rollback cost;
4. partial failure harus didesain;
5. retry butuh idempotency;
6. generated keys dalam batch harus diuji;
7. driver rewriting bisa sangat membantu tetapi mengubah behavior detail;
8. batch job besar perlu backpressure;
9. batch sebaiknya punya observability chunk-level;
10. batch tidak selalu lebih baik daripada set-based SQL atau native bulk loader.

Engineer yang kuat dalam JDBC batch bukan hanya tahu `addBatch()`. Ia bisa menyeimbangkan:

```text
throughput
atomicity
lock footprint
memory
pool occupancy
recovery
observability
vendor behavior
```

---

## 33. Latihan

### Latihan 1 — Batch Insert Basic

Buat method raw JDBC untuk insert 1.000 `UserAccount` menggunakan `PreparedStatement` batch.

Syarat:

1. `autoCommit=false`;
2. rollback saat error;
3. batch size 200;
4. structured log per chunk;
5. tidak log email lengkap.

### Latihan 2 — Optimistic Batch Update

Buat batch update untuk transition case status.

Syarat:

1. WHERE memakai `case_id` dan `version`;
2. update count `0` dianggap conflict;
3. semua conflict dikumpulkan;
4. transaction rollback jika ada conflict.

### Latihan 3 — Batch Failure Design

Desain flow import CSV 100.000 row dengan requirement:

1. bad rows tidak boleh menggagalkan seluruh import;
2. user bisa download error report;
3. valid rows bisa diproses;
4. job bisa dilanjutkan setelah crash.

Jawaban ideal kemungkinan memakai staging table.

### Latihan 4 — Pool Isolation

Desain dua Hikari pool:

1. pool API OLTP;
2. pool background batch.

Jelaskan:

1. kenapa dipisah;
2. ukuran awal masing-masing;
3. metric yang dipantau;
4. failure mode jika tidak dipisah.

---

## 34. Referensi

Referensi utama untuk part ini:

1. Java SE API Documentation — `java.sql.Statement`, `PreparedStatement`, `BatchUpdateException`, `Connection`.
2. Oracle JDBC Documentation — JDBC batch/update batching and performance extensions.
3. PostgreSQL JDBC Documentation — connection properties including `reWriteBatchedInserts`.
4. MySQL Connector/J Documentation — configuration properties including `rewriteBatchedStatements`.
5. HikariCP README — connection pool configuration and runtime behavior.

---

## 35. Ringkasan Satu Kalimat

> JDBC batch adalah teknik mengurangi overhead eksekusi banyak statement, tetapi correctness-nya tetap ditentukan oleh transaction boundary, failure handling, idempotency, driver behavior, dan kapasitas database.

---

## 36. Status Akhir Part

- Part 012 selesai.
- Seri belum selesai.
- Lanjut ke Part 013: `Large Objects and Streaming: Blob, Clob, NClob, SQLXML`.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-sql-jdbc-hikaricp-part-011](./learn-java-sql-jdbc-hikaricp-part-011.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-sql-jdbc-hikaricp-part-013](./learn-java-sql-jdbc-hikaricp-part-013.md)

</div>