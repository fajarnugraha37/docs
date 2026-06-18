# learn-java-sql-jdbc-hikaricp-part-005

# ResultSet Deep Dive: Cursor, Fetching, Streaming, and Memory

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `005 / 029`  
> Status seri: **belum selesai**  
> Part berikutnya: `006 — JDBC Type System: SQL Types, Java Types, and Conversion Traps`

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas `Statement`, `PreparedStatement`, dan `CallableStatement` sebagai objek untuk mengirim command ke database.

Part ini fokus ke objek yang sering terlihat sederhana tetapi justru sangat sering menjadi sumber bug production:

```java
ResultSet rs = statement.executeQuery(sql);
while (rs.next()) {
    ...
}
```

Di permukaan, `ResultSet` tampak seperti “hasil query”. Banyak developer memperlakukannya seperti `List<Row>`. Ini mental model yang berbahaya.

`ResultSet` lebih tepat dipahami sebagai:

```text
ResultSet = cursor-oriented view over query result,
            backed by driver/database/network buffers,
            bound to Statement,
            bound to Connection/session,
            with lifecycle and transaction implications.
```

Tujuan part ini:

1. Memahami `ResultSet` sebagai cursor, bukan collection.
2. Memahami hubungan `ResultSet`, `Statement`, `Connection`, database cursor, dan network fetch.
3. Memahami kenapa large query bisa membuat Java heap meledak walaupun kita memakai `while (rs.next())`.
4. Memahami `fetchSize`, streaming, server-side cursor, dan driver-specific behavior.
5. Memahami null handling, type getter, column access, metadata, dan mapping pattern yang aman.
6. Memahami lifecycle `ResultSet` agar tidak membuat connection leak, cursor leak, pool starvation, atau open transaction yang terlalu lama.
7. Membangun mental model yang kuat untuk part berikutnya tentang JDBC type system.

---

## 1. ResultSet Bukan List

Kesalahan pertama:

```text
Query mengembalikan banyak row.
Maka ResultSet dianggap seperti List<Row>.
```

Padahal `ResultSet` tidak memiliki `size()`.

Ini bukan kebetulan. `ResultSet` memang tidak didesain sebagai container materialized collection.

Secara konsep:

```text
List<Row>
  - semua data sudah ada di memory aplikasi
  - bisa tahu size langsung
  - bisa random access
  - lifecycle hanya object Java

ResultSet
  - cursor berada pada posisi tertentu
  - data bisa datang bertahap dari database/driver
  - bisa bergantung pada connection aktif
  - bisa bergantung pada transaction aktif
  - bisa bergantung pada database cursor/server resource
  - size mungkin tidak diketahui tanpa membaca semua row
```

Jadi ini:

```java
try (PreparedStatement ps = connection.prepareStatement("select * from audit_trail")) {
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            process(rs);
        }
    }
}
```

bukan berarti semua row pasti tidak pernah masuk memory sekaligus.

Perilaku aktual tergantung:

1. Driver JDBC.
2. Database.
3. Mode auto-commit.
4. Tipe `ResultSet`.
5. `fetchSize`.
6. Query shape.
7. LOB/streaming column.
8. Driver property.
9. Statement configuration.
10. Transaction boundary.

`while (rs.next())` hanya berarti API kita membaca row satu per satu. Itu tidak otomatis berarti driver melakukan streaming row satu per satu dari server.

---

## 2. Mental Model: Dari Query ke Row

Saat menjalankan:

```java
try (PreparedStatement ps = connection.prepareStatement("select id, name from users where status = ?")) {
    ps.setString(1, "ACTIVE");

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            long id = rs.getLong("id");
            String name = rs.getString("name");
        }
    }
}
```

Secara konseptual terjadi beberapa tahap:

```text
Java code
  |
  | executeQuery()
  v
JDBC driver
  |
  | send SQL / bind / execute protocol message
  v
Database server
  |
  | parse / optimize / execute
  | create result stream/cursor/buffer
  v
Driver receives rows
  |
  | buffer/fetch/cache/convert
  v
ResultSet cursor exposed to Java
  |
  | rs.next()
  v
Application row processing
```

Yang penting: `executeQuery()` dan `rs.next()` bisa sama-sama melakukan network work.

Tergantung driver:

1. `executeQuery()` bisa langsung mengambil seluruh result ke client buffer.
2. `executeQuery()` bisa hanya membuka server cursor, lalu `rs.next()` mengambil batch row bertahap.
3. `rs.next()` bisa hanya membaca dari buffer lokal jika buffer belum habis.
4. `rs.next()` bisa memicu network round trip saat buffer habis.
5. `rs.next()` bisa melakukan type conversion lazy saat getter dipanggil.

Jadi cost model-nya bukan:

```text
executeQuery = mahal
rs.next = murah
```

Lebih akurat:

```text
executeQuery = submit/execute/possibly first fetch
rs.next      = cursor movement, possibly local, possibly network fetch, possibly conversion
getter       = retrieve/convert column value, possibly materialize large object
```

---

## 3. Cursor Position

Menurut kontrak JDBC, `ResultSet` memiliki cursor yang menunjuk ke current row. Awalnya cursor berada **before first row**. Pemanggilan `next()` memindahkan cursor ke row berikutnya dan mengembalikan `false` jika tidak ada row lagi.

Mental model:

```text
Initial:

        cursor
          |
          v
    [ before first ]
    row 1
    row 2
    row 3
    [ after last ]

After rs.next():

    [ before first ]
    row 1  <- cursor
    row 2
    row 3
    [ after last ]
```

Karena itu, kode ini salah:

```java
try (ResultSet rs = ps.executeQuery()) {
    long id = rs.getLong("id"); // salah: cursor belum berada di row valid
}
```

Harus:

```java
try (ResultSet rs = ps.executeQuery()) {
    if (rs.next()) {
        long id = rs.getLong("id");
    }
}
```

Untuk query yang seharusnya mengembalikan tepat satu row:

```java
static User requireSingleUser(Connection connection, long userId) throws SQLException {
    String sql = "select id, username, status from users where id = ?";

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setLong(1, userId);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                throw new NoSuchElementException("User not found: " + userId);
            }

            User user = mapUser(rs);

            if (rs.next()) {
                throw new IllegalStateException("Expected one user but found multiple rows for id: " + userId);
            }

            return user;
        }
    }
}
```

Kenapa cek row kedua penting?

Karena banyak bug data integrity tersembunyi ketika kode memakai:

```java
if (rs.next()) {
    return map(rs);
}
```

tanpa memastikan tidak ada duplikasi. Untuk query yang secara domain harus unik, validasi “max one” adalah invariant.

---

## 4. ResultSet Type: Forward-Only vs Scrollable

Saat membuat statement, kita bisa menentukan tipe result set:

```java
Statement statement = connection.createStatement(
        ResultSet.TYPE_FORWARD_ONLY,
        ResultSet.CONCUR_READ_ONLY
);
```

Tipe utama:

```java
ResultSet.TYPE_FORWARD_ONLY
ResultSet.TYPE_SCROLL_INSENSITIVE
ResultSet.TYPE_SCROLL_SENSITIVE
```

### 4.1 TYPE_FORWARD_ONLY

Ini tipe paling umum dan paling aman untuk query OLTP biasa.

```text
Cursor hanya bergerak maju.
Cocok untuk streaming / sequential processing.
Lebih ringan.
Lebih mudah didukung driver.
```

Contoh:

```java
try (PreparedStatement ps = connection.prepareStatement(
        "select id, amount from invoice order by id",
        ResultSet.TYPE_FORWARD_ONLY,
        ResultSet.CONCUR_READ_ONLY
)) {
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            processInvoice(rs.getLong("id"), rs.getBigDecimal("amount"));
        }
    }
}
```

### 4.2 TYPE_SCROLL_INSENSITIVE

Cursor bisa bergerak maju/mundur, tetapi umumnya tidak sensitif terhadap perubahan data setelah `ResultSet` dibuat.

Method yang mungkin dipakai:

```java
rs.previous();
rs.absolute(10);
rs.relative(-2);
rs.beforeFirst();
rs.afterLast();
```

Masalahnya: scrollable result set sering membutuhkan buffering/materialization lebih besar.

Kalau kita meminta random access, driver harus punya kemampuan untuk kembali ke row sebelumnya. Cara implementasinya bisa:

1. Menahan semua row di memory client.
2. Menggunakan database cursor scrollable.
3. Menggunakan temporary structure.
4. Emulasi driver.

Semua ini lebih mahal daripada forward-only.

### 4.3 TYPE_SCROLL_SENSITIVE

Cursor bisa bergerak dan mungkin sensitif terhadap perubahan database oleh transaksi lain.

Dalam praktik modern, dukungan dan behavior-nya sangat driver/database-specific. Untuk aplikasi enterprise OLTP, tipe ini jarang menjadi pilihan yang baik karena:

1. Semantik sulit diprediksi.
2. Portabilitas rendah.
3. Observability rendah.
4. Bisa mahal.
5. Bisa mencampur query result dengan concurrency visibility yang tidak intuitif.

### 4.4 Rule of Thumb

Gunakan default mental model ini:

```text
Untuk production OLTP:
  TYPE_FORWARD_ONLY + CONCUR_READ_ONLY

Untuk pagination:
  gunakan SQL pagination/keyset pagination,
  bukan scrollable ResultSet.

Untuk UI grid:
  jangan menahan database cursor selama user berpikir.

Untuk report/export besar:
  gunakan forward-only streaming/fetching dengan transaction dan timeout yang jelas.
```

---

## 5. ResultSet Concurrency: Read-Only vs Updatable

Concurrency mode:

```java
ResultSet.CONCUR_READ_ONLY
ResultSet.CONCUR_UPDATABLE
```

### 5.1 CONCUR_READ_ONLY

Ini default yang seharusnya dipilih untuk mayoritas aplikasi.

```java
PreparedStatement ps = connection.prepareStatement(
        "select id, name from users where status = ?",
        ResultSet.TYPE_FORWARD_ONLY,
        ResultSet.CONCUR_READ_ONLY
);
```

Aplikasi membaca row lalu melakukan update dengan SQL eksplisit jika perlu:

```java
update users set name = ? where id = ?
```

Keuntungannya:

1. Intent jelas.
2. SQL update terlihat eksplisit.
3. Mudah diaudit.
4. Mudah dioptimasi.
5. Mudah dipahami transaction boundary-nya.

### 5.2 CONCUR_UPDATABLE

JDBC mendukung updatable result set:

```java
rs.updateString("name", "New Name");
rs.updateRow();
```

Namun untuk aplikasi enterprise, ini jarang disarankan.

Masalah:

1. Query harus memenuhi syarat tertentu agar updatable.
2. Driver support tidak seragam.
3. SQL aktual yang dikirim bisa tersembunyi.
4. Audit dan observability lebih sulit.
5. Locking behavior bisa tidak jelas.
6. Tidak cocok untuk domain service yang butuh explicit command.

Untuk sistem regulatory/case management, perubahan state harus eksplisit:

```sql
update enforcement_case
set status = ?, version = version + 1
where id = ? and version = ?
```

bukan lewat `ResultSet.updateRow()`.

---

## 6. Holdability: ResultSet setelah Commit

JDBC memiliki konsep holdability:

```java
ResultSet.HOLD_CURSORS_OVER_COMMIT
ResultSet.CLOSE_CURSORS_AT_COMMIT
```

Artinya: apa yang terjadi pada cursor ketika transaction commit?

Contoh membuat statement dengan holdability:

```java
PreparedStatement ps = connection.prepareStatement(
        sql,
        ResultSet.TYPE_FORWARD_ONLY,
        ResultSet.CONCUR_READ_ONLY,
        ResultSet.CLOSE_CURSORS_AT_COMMIT
);
```

### 6.1 CLOSE_CURSORS_AT_COMMIT

Cursor ditutup saat commit.

Ini lebih mudah dipahami:

```text
Transaction selesai -> resource cursor selesai.
```

### 6.2 HOLD_CURSORS_OVER_COMMIT

Cursor tetap terbuka setelah commit.

Ini bisa berguna pada kasus tertentu, tetapi menambah kompleksitas:

1. Cursor lifespan melebihi transaction boundary.
2. Database resource bisa bertahan lebih lama.
3. Visibility data bisa membingungkan.
4. Driver support bisa berbeda.

Untuk aplikasi OLTP, hindari bergantung pada cursor yang hidup melewati commit kecuali benar-benar paham driver dan database behavior.

---

## 7. Fetch Size: Konsep dan Realita

`fetchSize` adalah hint kepada driver tentang jumlah row yang sebaiknya diambil dari database ketika driver membutuhkan lebih banyak row.

Contoh:

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setFetchSize(500);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            process(rs);
        }
    }
}
```

Mental model ideal:

```text
fetchSize = 500

Database result: 10,000 rows

Round trip 1 -> rows 1..500
Round trip 2 -> rows 501..1000
Round trip 3 -> rows 1001..1500
...
```

Tapi ini hanya mental model umum. Realita berbeda per driver.

### 7.1 Fetch Size Bukan Limit

Kesalahan umum:

```java
ps.setFetchSize(100);
```

dianggap sama dengan:

```sql
limit 100
```

Itu salah.

`fetchSize` tidak membatasi total row. Ia hanya memengaruhi strategi pengambilan row dari database ke driver.

Kalau query menghasilkan 1.000.000 row, `fetchSize = 100` tetap bisa membaca 1.000.000 row.

Untuk membatasi total row, gunakan SQL:

```sql
fetch first 100 rows only
limit 100
where rownum <= 100
```

bergantung database.

### 7.2 Fetch Size Terlalu Kecil

Jika terlalu kecil:

```text
fetchSize = 1 atau 10
```

maka network round trip bisa terlalu banyak.

Misalnya 100.000 row dengan fetch size 10:

```text
100,000 / 10 = 10,000 fetch round trips
```

Ini bisa membuat query lambat walaupun database execution cepat.

### 7.3 Fetch Size Terlalu Besar

Jika terlalu besar:

```text
fetchSize = 50,000
```

maka memory client bisa naik, response first-row bisa lebih lambat, dan network packet besar.

### 7.4 Fetch Size yang Masuk Akal

Tidak ada angka universal.

Untuk OLTP kecil:

```text
Tidak perlu ubah fetch size.
Pastikan query membatasi row.
```

Untuk report/export besar:

```text
Mulai dari 500 - 5000,
ukur latency, memory, DB round trip, dan throughput.
```

Untuk row besar berisi CLOB/BLOB:

```text
fetch size lebih kecil mungkin lebih aman.
```

Untuk row sempit dan network latency tinggi:

```text
fetch size lebih besar bisa membantu.
```

---

## 8. Driver-Specific Fetching Behavior

Bagian ini sangat penting untuk engineer level production.

JDBC API memberi kontrak umum, tetapi fetching behavior sangat dipengaruhi driver.

### 8.1 PostgreSQL JDBC

PostgreSQL JDBC mendokumentasikan bahwa cursor mode dapat digunakan dengan `setFetchSize(...)`, tetapi ada syarat penting: auto-commit harus dimatikan agar driver memakai cursor untuk mengambil data bertahap.

Pattern konseptual:

```java
connection.setAutoCommit(false);

try (PreparedStatement ps = connection.prepareStatement(
        "select id, payload from large_table order by id",
        ResultSet.TYPE_FORWARD_ONLY,
        ResultSet.CONCUR_READ_ONLY
)) {
    ps.setFetchSize(1000);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            process(rs.getLong("id"), rs.getString("payload"));
        }
    }

    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
}
```

Implication:

```text
Streaming large PostgreSQL result set biasanya berarti connection berada dalam transaction selama iterasi.
```

Ini bukan masalah kecil. Jika processing lambat, transaction menjadi panjang.

Transaction panjang dapat menyebabkan:

1. Vacuum cleanup tertahan.
2. Snapshot lama tertahan.
3. Connection pool slot tertahan.
4. Lock/resource lebih lama.
5. Query cancellation lebih kompleks.

Jadi streaming bukan free lunch.

### 8.2 MySQL Connector/J

MySQL Connector/J memiliki behavior khusus. Dokumentasinya menjelaskan mode streaming klasik dengan kombinasi:

```java
Statement stmt = connection.createStatement(
        ResultSet.TYPE_FORWARD_ONLY,
        ResultSet.CONCUR_READ_ONLY
);
stmt.setFetchSize(Integer.MIN_VALUE);
```

Ini menjadi sinyal ke driver untuk melakukan streaming row-by-row.

Ada juga opsi modern driver seperti cursor-based fetching dengan property tertentu, tetapi intinya tetap sama: jangan mengasumsikan `setFetchSize(1000)` selalu berarti server cursor biasa seperti database lain.

Implication:

```text
Untuk MySQL, pahami versi driver dan property Connector/J.
Jangan copy tuning PostgreSQL/Oracle ke MySQL secara buta.
```

### 8.3 Oracle JDBC

Oracle JDBC memiliki konsep row prefetch/default row fetch size. Fetch size menentukan jumlah row yang diambil per round trip dari cursor database.

Implikasi penting:

```text
Oracle sering sangat sensitif terhadap fetch size untuk query yang mengembalikan banyak row.
Default yang terlalu kecil dapat memperbanyak round trip.
```

Namun untuk row besar atau LOB, fetch size besar juga dapat menaikkan memory.

Untuk aplikasi yang sering membaca listing besar, misalnya audit trail listing:

```text
fetch size kecil -> banyak round trip
fetch size besar -> memory/network packet lebih besar
```

Harus diukur dengan data production-like.

### 8.4 Kesimpulan Driver Behavior

Jangan pernah menulis guideline internal seperti:

```text
Set semua query fetchSize = 1000.
```

tanpa konteks.

Guideline yang lebih matang:

```text
Default:
  - query OLTP harus selektif dan bounded
  - fetchSize tidak perlu disentuh untuk query kecil

Large result/report/export:
  - gunakan explicit fetchSize
  - gunakan forward-only read-only
  - pahami driver-specific streaming requirement
  - ukur heap, round trip, duration, pool usage, DB impact

LOB-heavy query:
  - hati-hati dengan fetchSize besar
  - hindari select LOB kalau hanya butuh listing metadata
```

---

## 9. Client Buffering vs Server Cursor

Ada dua model besar.

### 9.1 Client Buffering

```text
Database returns many/all rows
Driver buffers rows in client memory
Application iterates ResultSet from local buffer
```

Diagram:

```text
Database
  |
  | many rows sent early
  v
JDBC Driver Buffer in JVM
  |
  | rs.next()
  v
Application
```

Kelebihan:

1. Setelah data buffered, iterasi cepat.
2. Connection/server cursor mungkin bisa dilepas lebih cepat.
3. Simpler transaction behavior.

Kekurangan:

1. Heap bisa meledak.
2. Time-to-first-row bisa buruk.
3. Query besar bisa membuat GC pressure.
4. Bisa OOM sebelum aplikasi memproses row pertama.

### 9.2 Server Cursor / Incremental Fetch

```text
Database keeps cursor
Driver fetches rows in chunks
Application processes progressively
```

Diagram:

```text
Database cursor
  |
  | fetch next N rows
  v
Driver small buffer
  |
  | rs.next()
  v
Application
```

Kelebihan:

1. Memory client lebih stabil.
2. Bisa memproses data besar.
3. Time-to-first-row bisa lebih baik.

Kekurangan:

1. Connection tertahan selama iterasi.
2. Server cursor/resource bisa tertahan.
3. Transaction bisa panjang.
4. Jika processing lambat, database session idle tetapi transaction/cursor aktif.
5. Pool throughput bisa turun karena connection dipinjam lama.

### 9.3 Tidak Ada Model yang Selalu Benar

Untuk query kecil OLTP:

```text
Client buffering kecil tidak masalah.
Lebih penting query bounded dan cepat.
```

Untuk export jutaan row:

```text
Server cursor/incremental fetch lebih aman untuk memory.
Tapi harus dipisah dari pool OLTP atau diberi budget khusus.
```

Untuk background batch:

```text
Gunakan chunking by key lebih sering lebih aman daripada cursor super panjang.
```

Contoh keyset chunking:

```java
long lastId = 0;
int batchSize = 1000;

while (true) {
    List<EventRow> rows = fetchNextBatch(connection, lastId, batchSize);
    if (rows.isEmpty()) {
        break;
    }

    for (EventRow row : rows) {
        process(row);
        lastId = row.id();
    }
}
```

SQL:

```sql
select id, payload
from event_log
where id > ?
order by id
fetch first ? rows only
```

Kelebihan keyset chunking:

1. Tiap query bounded.
2. Tiap transaction bisa pendek.
3. Connection tidak ditahan terlalu lama.
4. Retry lebih mudah.
5. Progress checkpoint lebih jelas.

Kekurangan:

1. Butuh stable ordering key.
2. Butuh desain idempotency.
3. Bisa melihat data baru tergantung boundary.
4. Tidak sama dengan snapshot tunggal dari awal sampai akhir.

---

## 10. Memory Blow-Up Patterns

### 10.1 Pattern 1: `while(rs.next())` tetapi Driver Buffer Semua Row

Kode terlihat streaming:

```java
try (ResultSet rs = ps.executeQuery()) {
    while (rs.next()) {
        process(rs);
    }
}
```

Tetapi driver bisa saja sudah mengambil semua row ke memory.

Gejala:

1. `executeQuery()` lama sebelum row pertama diproses.
2. Heap naik sebelum loop berjalan jauh.
3. GC pressure tinggi.
4. OOM pada query besar.

### 10.2 Pattern 2: Mengubah ResultSet ke List Besar

```java
List<AuditRecord> records = new ArrayList<>();

while (rs.next()) {
    records.add(mapAudit(rs));
}

return records;
```

Ini boleh untuk query bounded kecil. Ini buruk untuk export/report besar.

Masalah:

```text
ResultSet mungkin sudah buffered oleh driver,
lalu aplikasi menyalin lagi ke List,
lalu serializer/exporter menyalin lagi.
```

Akhirnya data yang sama muncul beberapa kali di memory.

### 10.3 Pattern 3: Select Kolom Terlalu Lebar

```sql
select * from audit_trail
where created_at >= ?
```

Jika tabel punya CLOB/BLOB besar, query listing ikut mengambil kolom berat padahal UI hanya perlu:

```text
id, module, activity, created_by, created_at
```

Lebih baik:

```sql
select id, module, activity, created_by, created_at
from audit_trail
where created_at >= ?
order by created_at desc
fetch first 100 rows only
```

Detail CLOB diambil hanya saat user membuka detail:

```sql
select metadata, serialized_changes, full_text
from audit_trail
where id = ?
```

### 10.4 Pattern 4: Mapper Membuat Object Graph Terlalu Besar

```java
CaseDto dto = new CaseDto();
dto.setApplicant(mapApplicant(rs));
dto.setDocuments(fetchDocuments(connection, dto.id()));
dto.setAuditLogs(fetchAuditLogs(connection, dto.id()));
```

Jika ini dilakukan dalam loop 1000 row, kita menciptakan N+1 query dan object graph besar.

### 10.5 Pattern 5: `getString()` pada CLOB Besar

```java
String fullText = rs.getString("full_text");
```

Untuk CLOB besar, ini bisa materialize seluruh isi ke heap.

Lebih aman untuk data besar:

```java
try (Reader reader = rs.getCharacterStream("full_text")) {
    copy(reader, writer);
}
```

Tetapi streaming LOB juga punya lifecycle: reader umumnya bergantung pada `ResultSet`, `Statement`, dan `Connection` yang masih terbuka.

---

## 11. Mapping ResultSet dengan Benar

### 11.1 RowMapper Pattern

Pattern sederhana:

```java
@FunctionalInterface
interface RowMapper<T> {
    T map(ResultSet rs) throws SQLException;
}
```

Contoh:

```java
static User mapUser(ResultSet rs) throws SQLException {
    return new User(
            rs.getLong("id"),
            rs.getString("username"),
            rs.getString("status")
    );
}
```

Repository:

```java
static List<User> findUsersByStatus(Connection connection, String status) throws SQLException {
    String sql = """
            select id, username, status
            from users
            where status = ?
            order by username
            fetch first 100 rows only
            """;

    List<User> result = new ArrayList<>();

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setString(1, status);

        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                result.add(mapUser(rs));
            }
        }
    }

    return result;
}
```

Ini baik jika result bounded.

### 11.2 Streaming Consumer Pattern

Untuk result besar:

```java
static void scanUsers(
        Connection connection,
        String status,
        Consumer<User> consumer
) throws SQLException {
    String sql = """
            select id, username, status
            from users
            where status = ?
            order by id
            """;

    try (PreparedStatement ps = connection.prepareStatement(
            sql,
            ResultSet.TYPE_FORWARD_ONLY,
            ResultSet.CONCUR_READ_ONLY
    )) {
        ps.setFetchSize(1000);
        ps.setString(1, status);

        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                consumer.accept(mapUser(rs));
            }
        }
    }
}
```

Namun hati-hati: `consumer.accept(...)` berjalan saat connection masih dipinjam.

Jangan lakukan hal lambat di dalam consumer:

```java
consumer = user -> {
    callExternalApi(user);     // buruk
    sendEmail(user);           // buruk
    waitForHumanApproval(user); // sangat buruk
};
```

Lebih baik:

1. Query chunk kecil.
2. Simpan task ke queue.
3. Commit/release connection.
4. Process di luar database transaction.

### 11.3 Jangan Return ResultSet dari Repository

Anti-pattern:

```java
public ResultSet findUsers(Connection connection) throws SQLException {
    PreparedStatement ps = connection.prepareStatement("select * from users");
    return ps.executeQuery();
}
```

Masalah:

1. Siapa menutup `ResultSet`?
2. Siapa menutup `PreparedStatement`?
3. Siapa menutup/mengembalikan `Connection`?
4. Apa transaction masih terbuka?
5. Apa caller tahu column contract?
6. Apa caller bisa membaca setelah connection close?

Repository harus mengembalikan domain object, DTO bounded, atau menjalankan callback dengan lifecycle eksplisit.

Lebih aman:

```java
public void scanUsers(Connection connection, UserHandler handler) throws SQLException {
    try (PreparedStatement ps = connection.prepareStatement("select id, username from users")) {
        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                handler.handle(new User(rs.getLong("id"), rs.getString("username")));
            }
        }
    }
}
```

Tetap hati-hati dengan handler yang lambat.

---

## 12. Column Access: Index vs Label

JDBC mendukung akses dengan index dan label.

```java
long id = rs.getLong(1);
String username = rs.getString(2);
```

atau:

```java
long id = rs.getLong("id");
String username = rs.getString("username");
```

### 12.1 Column Index

Kelebihan:

1. Sedikit lebih cepat dalam beberapa driver.
2. Tidak tergantung label string lookup.
3. Cocok untuk mapping highly optimized.

Kekurangan:

1. Rentan jika urutan select berubah.
2. Kurang readable.
3. Bug silent jika column order berubah tetapi type compatible.

Contoh bug:

```sql
select id, status from users
```

Mapper:

```java
long id = rs.getLong(1);
String status = rs.getString(2);
```

Lalu SQL berubah:

```sql
select status, id from users
```

Mapper rusak.

### 12.2 Column Label

Kelebihan:

1. Lebih readable.
2. Lebih tahan perubahan urutan.
3. Cocok untuk aplikasi enterprise.

Kekurangan:

1. Jika alias tidak konsisten, bisa bug.
2. Duplicate column label bisa ambigu.
3. Sedikit overhead lookup, biasanya tidak signifikan dibanding database/network.

Best practice:

```sql
select
    u.id       as user_id,
    u.username as username,
    r.name     as role_name
from users u
join roles r on r.id = u.role_id
```

Mapper:

```java
long userId = rs.getLong("user_id");
String username = rs.getString("username");
String roleName = rs.getString("role_name");
```

### 12.3 Hindari `select *`

`select *` buruk untuk mapper karena:

1. Column order tidak explicit.
2. Column baru bisa ikut terbawa.
3. Data lebih besar dari kebutuhan.
4. Duplicate column name pada join.
5. Bisa mengambil LOB tanpa sengaja.
6. Query plan/index-only scan bisa terganggu.

Gunakan explicit projection.

---

## 13. Null Handling

JDBC punya jebakan klasik: primitive getter tidak bisa membedakan nilai 0/false dengan SQL NULL tanpa `wasNull()`.

Contoh:

```java
long parentId = rs.getLong("parent_id");
```

Jika `parent_id` SQL NULL, `getLong()` mengembalikan `0`.

Untuk membedakan:

```java
long parentIdValue = rs.getLong("parent_id");
Long parentId = rs.wasNull() ? null : parentIdValue;
```

Pattern helper:

```java
static Long getNullableLong(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
}

static Integer getNullableInt(ResultSet rs, String column) throws SQLException {
    int value = rs.getInt(column);
    return rs.wasNull() ? null : value;
}

static Boolean getNullableBoolean(ResultSet rs, String column) throws SQLException {
    boolean value = rs.getBoolean(column);
    return rs.wasNull() ? null : value;
}
```

Untuk object getter seperti `getString()`, SQL NULL menjadi Java `null`:

```java
String middleName = rs.getString("middle_name");
```

Untuk JDBC modern, `getObject(column, Type.class)` sering lebih jelas:

```java
Long parentId = rs.getObject("parent_id", Long.class);
Integer retryCount = rs.getObject("retry_count", Integer.class);
LocalDate submittedDate = rs.getObject("submitted_date", LocalDate.class);
```

Namun dukungan dan conversion tetap driver-specific untuk beberapa type. Ini akan kita bahas dalam Part 006.

---

## 14. Getter Semantics dan Type Conversion

JDBC menyediakan banyak getter:

```java
getString
getInt
getLong
getBigDecimal
getBoolean
getDate
getTime
getTimestamp
getObject
getBytes
getBinaryStream
getCharacterStream
getBlob
getClob
```

Getter bukan sekadar mengambil field dari object row. Getter bisa melakukan conversion.

Contoh:

```java
String amountText = rs.getString("amount");
BigDecimal amount = rs.getBigDecimal("amount");
```

Keduanya bisa berhasil, tetapi semantiknya berbeda.

Best practice:

```text
Ambil column dengan Java type yang paling dekat dengan SQL/domain type.
```

Contoh:

```text
SQL NUMBER/DECIMAL money -> BigDecimal
SQL BIGINT id            -> long/Long
SQL VARCHAR status       -> String atau enum mapper eksplisit
SQL DATE                 -> LocalDate jika driver mendukung
SQL TIMESTAMP            -> LocalDateTime/OffsetDateTime sesuai semantik
SQL CLOB                 -> Reader/Clob untuk besar, String untuk kecil dan bounded
```

Jangan menjadikan `getString()` sebagai universal getter untuk semua hal.

Masalah:

1. Locale/format ambiguity.
2. Precision loss jika parse sendiri.
3. Timezone ambiguity.
4. Driver-specific string representation.
5. Error terlambat terdeteksi.

---

## 15. Single Row Query Patterns

### 15.1 Optional Row

```java
static Optional<User> findUserById(Connection connection, long id) throws SQLException {
    String sql = "select id, username, status from users where id = ?";

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return Optional.empty();
            }

            User user = mapUser(rs);

            if (rs.next()) {
                throw new IllegalStateException("Duplicate user id: " + id);
            }

            return Optional.of(user);
        }
    }
}
```

### 15.2 Required Row

```java
static User getUserById(Connection connection, long id) throws SQLException {
    return findUserById(connection, id)
            .orElseThrow(() -> new NoSuchElementException("User not found: " + id));
}
```

### 15.3 Scalar Query

```java
static long countActiveUsers(Connection connection) throws SQLException {
    String sql = "select count(*) from users where status = 'ACTIVE'";

    try (PreparedStatement ps = connection.prepareStatement(sql);
         ResultSet rs = ps.executeQuery()) {

        if (!rs.next()) {
            throw new IllegalStateException("COUNT query returned no row");
        }

        return rs.getLong(1);
    }
}
```

COUNT selalu mengembalikan satu row, tetapi kode tetap memvalidasi.

---

## 16. Multi-Row Query Patterns

### 16.1 Bounded List

Untuk UI listing:

```java
static List<CaseSummary> searchCases(
        Connection connection,
        String status,
        int limit
) throws SQLException {
    if (limit < 1 || limit > 500) {
        throw new IllegalArgumentException("limit must be between 1 and 500");
    }

    String sql = """
            select case_id, case_no, status, updated_at
            from enforcement_case
            where status = ?
            order by updated_at desc, case_id desc
            fetch first ? rows only
            """;

    List<CaseSummary> result = new ArrayList<>(Math.min(limit, 500));

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setString(1, status);
        ps.setInt(2, limit);

        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                result.add(mapCaseSummary(rs));
            }
        }
    }

    return result;
}
```

Catatan:

1. Limit divalidasi.
2. Projection explicit.
3. Ordering deterministic.
4. Tidak return `ResultSet`.
5. Tidak fetch CLOB/detail besar.

### 16.2 Keyset Pagination

Offset pagination:

```sql
select id, title
from case_table
order by updated_at desc
limit 50 offset 100000
```

bisa mahal karena database harus melewati banyak row.

Keyset pagination:

```sql
select id, title, updated_at
from case_table
where (updated_at, id) < (?, ?)
order by updated_at desc, id desc
fetch first 50 rows only
```

Pattern:

```java
record PageCursor(Instant updatedAt, long id) {}

static List<CaseSummary> nextPage(
        Connection connection,
        PageCursor cursor,
        int limit
) throws SQLException {
    String sql = """
            select case_id, case_no, status, updated_at
            from enforcement_case
            where (updated_at < ?)
               or (updated_at = ? and case_id < ?)
            order by updated_at desc, case_id desc
            fetch first ? rows only
            """;

    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        Timestamp ts = Timestamp.from(cursor.updatedAt());
        ps.setTimestamp(1, ts);
        ps.setTimestamp(2, ts);
        ps.setLong(3, cursor.id());
        ps.setInt(4, limit);

        List<CaseSummary> rows = new ArrayList<>(limit);
        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                rows.add(mapCaseSummary(rs));
            }
        }
        return rows;
    }
}
```

Keyset pagination lebih cocok untuk large operational dataset.

---

## 17. Nested Query Per Row: N+1 di JDBC

Contoh buruk:

```java
List<CaseDto> cases = new ArrayList<>();

try (ResultSet rs = ps.executeQuery()) {
    while (rs.next()) {
        long caseId = rs.getLong("case_id");
        List<Document> documents = findDocumentsByCaseId(connection, caseId);
        cases.add(mapCase(rs, documents));
    }
}
```

Jika result 500 case, kita menjalankan:

```text
1 query case + 500 query document = 501 query
```

Masalah:

1. Latency besar karena round trip berulang.
2. Connection ditahan lama.
3. Transaction lebih panjang.
4. Lock/snapshot lebih lama.
5. Error di tengah mapping lebih sulit.

Alternatif:

1. Join jika cardinality aman.
2. Fetch children dengan `where case_id in (...)` per batch.
3. Gunakan two-phase mapping.
4. Gunakan SQL aggregation jika cocok.

Contoh batch child loading:

```java
List<CaseSummary> cases = findCases(connection, status, 500);
List<Long> caseIds = cases.stream().map(CaseSummary::caseId).toList();
Map<Long, List<Document>> documents = findDocumentsByCaseIds(connection, caseIds);
```

Untuk `IN` list besar, gunakan chunking atau temporary table sesuai database.

---

## 18. ResultSet Lifecycle

Resource hierarchy:

```text
Connection
  └── Statement / PreparedStatement / CallableStatement
        └── ResultSet
```

Secara umum:

```text
Close ResultSet -> selesai membaca rows/cursor
Close Statement -> biasanya menutup ResultSet yang dibuatnya
Close Connection -> biasanya menutup statement/resultset terkait, atau mengembalikan logical connection ke pool
```

Tetapi best practice tetap eksplisit:

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            process(rs);
        }
    }
}
```

Atau:

```java
try (PreparedStatement ps = connection.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    while (rs.next()) {
        process(rs);
    }
}
```

### 18.1 Closing Order

Try-with-resources menutup resource dalam urutan terbalik deklarasi.

```java
try (PreparedStatement ps = connection.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    ...
}
```

Urutan close:

```text
rs.close()
ps.close()
```

Ini benar.

### 18.2 Jangan Gunakan ResultSet setelah Statement Close

Buruk:

```java
ResultSet rs;
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    rs = ps.executeQuery();
}

while (rs.next()) { // statement sudah close
    ...
}
```

`ResultSet` terikat pada statement. Jangan keluarkan dari scope statement.

### 18.3 Jangan Gunakan ResultSet setelah Connection Close

Buruk:

```java
ResultSet rs;
try (Connection c = dataSource.getConnection()) {
    PreparedStatement ps = c.prepareStatement(sql);
    rs = ps.executeQuery();
}

rs.next(); // connection sudah ditutup/dikembalikan ke pool
```

Di pool, `connection.close()` berarti logical connection dikembalikan ke pool. ResultSet yang masih dipakai setelah itu adalah bug serius.

---

## 19. Open Cursor dan Database Resource

Database biasanya punya resource untuk query result:

1. Cursor.
2. Work area.
3. Temporary segment.
4. Memory server-side.
5. Snapshot/transaction metadata.
6. Locks tertentu tergantung query/isolation.

Jika aplikasi tidak menutup `ResultSet`/`Statement`, database bisa mengalami:

```text
open cursor exceeded
session memory growth
idle in transaction
temporary space pressure
pool exhaustion
```

Contoh leak:

```java
PreparedStatement ps = connection.prepareStatement(sql);
ResultSet rs = ps.executeQuery();

if (something) {
    return; // rs dan ps tidak ditutup
}
```

Gunakan try-with-resources.

---

## 20. ResultSet dan Transaction Duration

Streaming result besar sering berarti connection dan transaction aktif selama loop.

Contoh:

```java
connection.setAutoCommit(false);

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setFetchSize(1000);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            exportRow(rs);
        }
    }

    connection.commit();
}
```

Jika `exportRow(rs)` menulis ke network lambat selama 20 menit, transaction juga bisa 20 menit.

Risiko:

1. Connection pool slot tertahan 20 menit.
2. Database session tertahan 20 menit.
3. Snapshot lama tertahan.
4. Cursor tertahan.
5. Query cancellation sulit.
6. Deployment shutdown bisa terganggu.

Alternatif:

```text
Chunk query -> materialize small batch -> close DB resource -> write output -> repeat.
```

Tapi jika butuh snapshot konsisten untuk seluruh export, chunking biasa mungkin tidak cukup. Maka pilihan desain:

1. Accept long read transaction, tetapi pakai pool khusus export.
2. Buat snapshot/report table terlebih dahulu.
3. Gunakan database-native export.
4. Gunakan replica/reporting DB.
5. Gunakan async job dengan timeout dan cancellation.

Top 1% engineer tidak hanya bertanya “bisa streaming atau tidak”, tetapi:

```text
Streaming ini menahan resource apa, berapa lama, dan siapa yang terdampak saat lambat?
```

---

## 21. ResultSet dan Pool Starvation

Misalnya HikariCP `maximumPoolSize = 10`.

Ada endpoint export:

```java
@GetMapping("/export")
void export(...) {
    jdbc.scanLargeResult(rs -> {
        writeCsvRowToClient(rs); // client download lambat
    });
}
```

Jika 10 user menjalankan export besar bersamaan:

```text
10 connections borrowed untuk export
0 connection tersisa untuk OLTP request biasa
semua request login/search/update menunggu pool
akhirnya timeout
```

Ini bukan hanya masalah query lambat. Ini masalah resource isolation.

Solusi desain:

1. Pisahkan pool OLTP dan pool reporting/export.
2. Batasi concurrency export.
3. Jadikan export async job.
4. Simpan hasil export ke object storage.
5. Gunakan read replica.
6. Gunakan query timeout dan job cancellation.
7. Jangan stream DB cursor langsung ke HTTP client untuk data besar tanpa boundary.

---

## 22. Multiple ResultSets

Beberapa SQL/procedure bisa menghasilkan lebih dari satu result set.

API terkait:

```java
boolean hasResultSet = statement.execute(sql);
ResultSet rs = statement.getResultSet();
boolean more = statement.getMoreResults();
int updateCount = statement.getUpdateCount();
```

Pattern konseptual:

```java
boolean hasResult = statement.execute(sql);

while (true) {
    if (hasResult) {
        try (ResultSet rs = statement.getResultSet()) {
            while (rs.next()) {
                processRow(rs);
            }
        }
    } else {
        int updateCount = statement.getUpdateCount();
        if (updateCount == -1) {
            break;
        }
        processUpdateCount(updateCount);
    }

    hasResult = statement.getMoreResults();
}
```

Ini lebih sering muncul pada:

1. Stored procedure.
2. Batch SQL script tertentu.
3. Driver/database yang mengembalikan update count plus result.

Untuk aplikasi biasa, hindari multi-result jika tidak perlu. Ia membuat lifecycle dan mapping lebih kompleks.

---

## 23. Generated Keys ResultSet

Saat insert, kita bisa meminta generated keys:

```java
String sql = "insert into users(username, status) values (?, ?)";

try (PreparedStatement ps = connection.prepareStatement(
        sql,
        Statement.RETURN_GENERATED_KEYS
)) {
    ps.setString(1, "alice");
    ps.setString(2, "ACTIVE");

    int affected = ps.executeUpdate();
    if (affected != 1) {
        throw new IllegalStateException("Expected 1 row inserted, got " + affected);
    }

    try (ResultSet keys = ps.getGeneratedKeys()) {
        if (!keys.next()) {
            throw new IllegalStateException("No generated key returned");
        }
        long id = keys.getLong(1);
        return id;
    }
}
```

Generated keys juga `ResultSet`, jadi lifecycle-nya sama.

Caveat:

1. Behavior berbeda per database/driver.
2. Batch generated keys bisa berbeda.
3. Composite/generated columns butuh column name explicit di beberapa driver.
4. Sequence-based DB mungkin lebih jelas dengan `select sequence.nextval` atau `returning` tergantung database.

---

## 24. ResultSetMetaData

`ResultSetMetaData` memberi informasi column dari result set:

```java
try (ResultSet rs = ps.executeQuery()) {
    ResultSetMetaData md = rs.getMetaData();
    int columnCount = md.getColumnCount();

    for (int i = 1; i <= columnCount; i++) {
        String label = md.getColumnLabel(i);
        String typeName = md.getColumnTypeName(i);
        int jdbcType = md.getColumnType(i);
        System.out.printf("%s %s %d%n", label, typeName, jdbcType);
    }
}
```

Kegunaan:

1. Dynamic export.
2. Generic SQL console/admin tool.
3. Diagnostics.
4. Schema introspection light.
5. Data migration utility.

Namun untuk domain application mapping, metadata-driven mapper punya risiko:

1. Runtime failure lebih banyak.
2. Refactoring kurang aman.
3. Type conversion sering ambigu.
4. Domain invariant tidak terlihat.
5. Performance overhead kecil tetapi ada.

Untuk core business flow, explicit mapper lebih baik.

---

## 25. Lazy Iterator Anti-Pattern

Kadang developer ingin membuat API enak:

```java
Iterable<User> users = repository.findAllUsersLazy();
for (User user : users) {
    ...
}
```

Di baliknya, `Iterator` membaca dari `ResultSet`.

Masalah:

1. Siapa menutup connection jika loop berhenti di tengah?
2. Bagaimana jika exception terjadi?
3. Bagaimana jika iterator disimpan dan dipakai nanti?
4. Apakah transaction masih aktif?
5. Apakah connection pool slot tertahan selama iteration?

Jika tetap ingin stream-like API, gunakan resource-owning abstraction yang harus ditutup:

```java
final class JdbcRowStream<T> implements AutoCloseable {
    private final Connection connection;
    private final PreparedStatement statement;
    private final ResultSet resultSet;
    private final RowMapper<T> mapper;

    // next/map/close methods

    @Override
    public void close() throws SQLException {
        try {
            resultSet.close();
        } finally {
            try {
                statement.close();
            } finally {
                connection.close();
            }
        }
    }
}
```

Pemakaian:

```java
try (JdbcRowStream<User> stream = repository.openUserStream()) {
    while (stream.next()) {
        User user = stream.current();
        process(user);
    }
}
```

Tetapi API seperti ini harus dipakai sangat hati-hati. Untuk banyak aplikasi, chunking lebih aman.

---

## 26. Mapping ke Java Stream: Hati-Hati

Membungkus ResultSet menjadi `java.util.stream.Stream<T>` bisa terlihat elegan:

```java
try (Stream<User> users = repository.streamUsers()) {
    users.forEach(this::process);
}
```

Namun Java Stream punya banyak jebakan:

1. Lazy evaluation bisa memperpanjang resource lifecycle.
2. `parallel()` sangat berbahaya dengan single ResultSet.
3. Exception checked `SQLException` harus dibungkus.
4. Closing stream harus menutup JDBC resource.
5. Short-circuit operation harus tetap close resource.

Jika membuat Stream, wajib pasang `onClose`:

```java
Stream<T> stream = StreamSupport.stream(spliterator, false)
        .onClose(() -> closeQuietly(resultSet, statement, connection));
```

Dan dokumentasikan:

```text
Caller wajib menutup Stream dengan try-with-resources.
Stream tidak boleh diparallelkan.
Processing harus cepat.
```

Untuk codebase enterprise, explicit callback/chunk sering lebih mudah diaudit daripada lazy stream JDBC.

---

## 27. ResultSet dengan LOB Column

LOB column seperti `CLOB`, `BLOB`, `NCLOB` punya karakter khusus.

Contoh buruk untuk listing:

```sql
select id, created_at, metadata_clob, full_text_clob
from audit_trail
order by created_at desc
fetch first 100 rows only
```

Walaupun 100 row, jika tiap CLOB besar, query berat.

Lebih baik pisah:

Listing:

```sql
select id, created_at, module, activity, created_by
from audit_trail
order by created_at desc
fetch first 100 rows only
```

Detail:

```sql
select metadata_clob, full_text_clob
from audit_trail
where id = ?
```

Untuk membaca CLOB:

```java
try (Reader reader = rs.getCharacterStream("metadata_clob")) {
    if (reader != null) {
        reader.transferTo(writer);
    }
}
```

Untuk BLOB:

```java
try (InputStream in = rs.getBinaryStream("document_blob")) {
    if (in != null) {
        in.transferTo(outputStream);
    }
}
```

Catatan:

1. Stream harus dibaca sebelum `ResultSet` ditutup.
2. Jangan simpan stream untuk dipakai setelah method return.
3. Jangan gabungkan streaming DB LOB langsung ke HTTP response tanpa timeout/cancellation/backpressure jelas.
4. Untuk file besar, object storage sering lebih tepat daripada BLOB database, tergantung requirement audit/transactionality/security.

---

## 28. Query Shape untuk ResultSet yang Sehat

`ResultSet` yang sehat dimulai dari SQL yang sehat.

Checklist query:

```text
[ ] Projection explicit, tidak select *.
[ ] Ada WHERE yang selektif.
[ ] Ada ORDER BY deterministic jika result dipaginate atau diproses incremental.
[ ] Ada LIMIT/FETCH FIRST untuk UI/API list.
[ ] Tidak mengambil LOB kecuali perlu.
[ ] Join cardinality dipahami.
[ ] Tidak menghasilkan duplikasi tak sengaja.
[ ] Index mendukung filter/order.
[ ] Query timeout diset untuk query berisiko.
[ ] Fetch size diset untuk result besar.
```

Contoh buruk:

```sql
select *
from case c
left join document d on d.case_id = c.id
left join audit_trail a on a.case_id = c.id
where c.status = ?
```

Jika satu case punya 10 document dan 50 audit, result bisa menjadi 500 row per case karena join multiplication.

Lebih baik pisahkan berdasarkan use case:

1. Case summary query.
2. Document query.
3. Audit query.
4. Detail query.

---

## 29. ResultSet dan Backpressure

JDBC blocking API tidak punya backpressure modern seperti reactive stream.

Tetapi kita tetap bisa menerapkan backpressure secara desain:

1. Batasi jumlah row SQL.
2. Batasi fetch size.
3. Batasi export concurrency.
4. Gunakan queue bounded.
5. Gunakan pool terpisah.
6. Gunakan timeout.
7. Gunakan cancellation.
8. Gunakan chunk/checkpoint.

Anti-pattern:

```java
while (rs.next()) {
    queue.put(map(rs)); // jika queue penuh, blocking lama sambil connection ditahan
}
```

Jika queue bounded penuh, thread berhenti di `put()`, tetapi ResultSet/Connection tetap terbuka.

Lebih aman:

```text
DB chunk kecil -> close DB resource -> enqueue/process -> lanjut chunk berikutnya
```

---

## 30. Cancellation dan Timeout

`Statement.setQueryTimeout(seconds)` dapat digunakan untuk memberi batas waktu eksekusi statement.

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setQueryTimeout(30);
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            process(rs);
        }
    }
}
```

Namun timeout behavior bisa driver/database-specific.

Pertanyaan penting:

1. Timeout berlaku untuk execute saja atau fetch juga?
2. Jika timeout terjadi, apakah query di server benar-benar dibatalkan?
3. Apakah connection masih aman dipakai?
4. Apakah transaction harus rollback?
5. Apakah pool akan menganggap connection broken?

Untuk production, jangan hanya set timeout. Uji behavior aktual driver/database.

Pattern defensif:

```java
try {
    runQuery(connection);
} catch (SQLTimeoutException e) {
    safeRollback(connection);
    throw e;
} catch (SQLException e) {
    safeRollback(connection);
    throw e;
}
```

Timeout akan dibahas lebih dalam di Part 022.

---

## 31. ResultSet di Virtual Threads

JDBC adalah blocking API. Dengan virtual threads, blocking JDBC call tidak selalu menjadi masalah dari sisi thread scalability, tetapi database connection tetap resource terbatas.

Virtual thread dapat membuat lebih banyak concurrent tasks mudah dibuat:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Job job : jobs) {
        executor.submit(() -> runJdbcQuery(job));
    }
}
```

Masalahnya bukan thread lagi, tetapi:

```text
Berapa connection pool size?
Berapa DB max session?
Berapa query concurrent yang DB sanggup?
Berapa ResultSet besar yang sedang dibaca?
```

Virtual threads tidak menghilangkan kebutuhan connection pool. Ia justru membuat pool sebagai concurrency governor semakin penting.

Untuk ResultSet besar:

```text
Virtual thread yang membaca ResultSet tetap memegang connection.
```

Jangan menyamakan:

```text
murah membuat virtual thread
```

dengan:

```text
murah membuat query/database session/result cursor
```

---

## 32. Production Symptoms dan Diagnosis

### 32.1 Symptom: Pool Exhaustion

Log:

```text
Connection is not available, request timed out after 30000ms
```

Kemungkinan terkait ResultSet:

1. Query besar sedang streaming lama.
2. ResultSet leak.
3. Statement tidak ditutup.
4. Consumer lambat saat connection masih dipinjam.
5. Export endpoint memakai pool OLTP.
6. N+1 query memperpanjang connection usage.

Yang dicek:

```text
Hikari active connections
Hikari pending threads
Connection usage time
Slow query logs
Thread dump
DB sessions active/idle in transaction
Open cursors
Endpoint latency
```

### 32.2 Symptom: Java OOM saat Export

Kemungkinan:

1. Driver buffer all rows.
2. Fetch size tidak bekerja.
3. Auto-commit mode salah untuk streaming driver tertentu.
4. Code mengumpulkan semua row ke List.
5. CLOB/BLOB dibaca ke String/byte[].
6. CSV/Excel writer buffering semua content.

Yang dicek:

```text
Heap dump
Allocation profile
Driver docs
Fetch size behavior
Query projection
LOB columns
Export implementation
```

### 32.3 Symptom: Database Open Cursor Exceeded

Kemungkinan:

1. Statement/ResultSet leak.
2. Exception path tidak close resource.
3. Cached statement salah pakai.
4. Long-running cursor tidak ditutup.
5. Stored procedure mengembalikan cursor tidak dikonsumsi/ditutup.

Yang dicek:

```text
DB open cursor view
Session id/client identifier
Application logs correlation id
Leak detection
Code path with early return
```

### 32.4 Symptom: Query Cepat di DB, Lambat di App

Kemungkinan:

1. Fetch size terlalu kecil, banyak network round trip.
2. Row terlalu besar.
3. Mapper lambat.
4. N+1 tambahan di loop.
5. Client serialization lambat.
6. Network app-DB lambat.
7. GC pressure.

Jangan hanya lihat database execution plan. End-to-end JDBC latency meliputi:

```text
DB execute + fetch + network + driver conversion + mapper + app processing
```

---

## 33. Case Study: Audit Trail Listing dengan CLOB

Misalnya tabel:

```sql
AUDIT_TRAIL(
    ID,
    MODULE_ID,
    ACTIVITY,
    CREATED_BY,
    CREATED_DATE_TIME,
    META_DATA CLOB,
    SERIALIZED_CHANGES CLOB,
    FULL_TEXT CLOB
)
```

UI listing hanya butuh:

```text
ID
MODULE
ACTIVITY
CREATED_BY
CREATED_DATE_TIME
```

Query buruk:

```sql
select *
from audit_trail
where module_id = ?
order by created_date_time desc
fetch first 100 rows only
```

Kenapa buruk?

1. Mengambil CLOB padahal tidak dipakai.
2. Row menjadi besar.
3. Driver memory naik.
4. Network payload besar.
5. Fetch size menjadi kurang efektif.
6. DB harus membaca segment LOB atau locator tergantung DB/driver.
7. UI latency naik.

Query lebih sehat:

```sql
select
    id,
    module_id,
    activity,
    created_by,
    created_date_time
from audit_trail
where module_id = ?
order by created_date_time desc, id desc
fetch first ? rows only
```

Detail CLOB:

```sql
select
    metadata,
    serialized_changes,
    full_text
from audit_trail
where id = ?
```

Repository design:

```java
record AuditTrailSummary(
        long id,
        long moduleId,
        String activity,
        String createdBy,
        Instant createdAt
) {}

record AuditTrailDetail(
        String metadata,
        String serializedChanges,
        String fullText
) {}
```

Summary mapper tidak menyentuh CLOB.

---

## 34. Case Study: Regulatory Case State Transition Query

Untuk workflow enforcement, kita sering membaca current state sebelum transisi:

```sql
select id, status, assigned_officer_id, version
from enforcement_case
where id = ?
```

Pattern yang lebih benar biasanya bukan hanya read lalu update tanpa guard.

Buruk:

```java
CaseRow row = findCase(connection, caseId);
if (!row.status().equals("DRAFT")) {
    throw new IllegalStateException("Invalid state");
}

updateStatus(connection, caseId, "SUBMITTED");
```

Race condition:

```text
Tx A read DRAFT
Tx B read DRAFT
Tx A update SUBMITTED
Tx B update SUBMITTED / APPROVED / inconsistent side effect
```

JDBC ResultSet mapping harus dikombinasikan dengan update guard:

```sql
update enforcement_case
set status = ?, version = version + 1
where id = ?
  and status = ?
  and version = ?
```

Lalu cek affected row:

```java
int updated = ps.executeUpdate();
if (updated != 1) {
    throw new ConcurrentModificationException("Case state changed concurrently: " + caseId);
}
```

Pelajaran:

```text
ResultSet membaca state.
Tetapi correctness transisi tidak boleh hanya bergantung pada state yang sudah dibaca.
Update harus menjaga invariant di database boundary.
```

---

## 35. Best Practices Ringkas

### 35.1 Default Query

```java
try (PreparedStatement ps = connection.prepareStatement(sql)) {
    bind(ps);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            rows.add(map(rs));
        }
    }
}
```

Cocok jika:

1. Query bounded.
2. Row count kecil/menengah.
3. Projection explicit.
4. Tidak ada LOB besar.

### 35.2 Large Read

```java
try (PreparedStatement ps = connection.prepareStatement(
        sql,
        ResultSet.TYPE_FORWARD_ONLY,
        ResultSet.CONCUR_READ_ONLY
)) {
    ps.setFetchSize(1000);

    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            process(rs);
        }
    }
}
```

Tambahkan:

1. Driver-specific requirement.
2. Timeout.
3. Pool isolation.
4. Transaction awareness.
5. Cancellation.
6. Monitoring.

### 35.3 Bounded API List

```text
Selalu punya limit.
Selalu punya deterministic order.
Jangan select LOB.
Jangan select *.
```

### 35.4 Mapping

```text
Gunakan label/alias jelas.
Gunakan getter sesuai type.
Handle nullable primitive dengan wasNull atau getObject.
Validasi single-row invariant.
```

### 35.5 Lifecycle

```text
Jangan return ResultSet.
Jangan simpan ResultSet.
Jangan pakai ResultSet setelah Statement/Connection close.
Gunakan try-with-resources.
Pastikan path exception menutup resource.
```

---

## 36. Checklist Review Kode ResultSet

Gunakan checklist ini saat review PR.

```text
Query Shape
[ ] Tidak menggunakan select *.
[ ] Projection hanya kolom yang diperlukan.
[ ] Query list punya limit/fetch first.
[ ] Query list punya order by deterministic.
[ ] Tidak mengambil LOB untuk listing.
[ ] Join tidak menyebabkan multiplication tak disengaja.

ResultSet Lifecycle
[ ] ResultSet ditutup dengan try-with-resources.
[ ] Statement ditutup dengan try-with-resources.
[ ] ResultSet tidak keluar dari scope repository.
[ ] Tidak ada lazy iterator/stream tanpa close contract.
[ ] Tidak ada return sebelum close resource.

Mapping
[ ] Column label/alias eksplisit.
[ ] Getter sesuai tipe domain.
[ ] Nullable primitive ditangani.
[ ] Single-row query memvalidasi 0/1/multiple row sesuai invariant.
[ ] Tidak ada getString universal untuk semua tipe.

Performance
[ ] Result besar tidak dikumpulkan ke List tanpa batas.
[ ] Fetch size dipertimbangkan untuk large read.
[ ] Driver-specific streaming behavior dipahami.
[ ] Tidak ada N+1 query di dalam loop.
[ ] Tidak ada external call lambat saat connection masih dipinjam.

Transaction/Pool
[ ] Streaming tidak menahan transaction terlalu lama tanpa sadar.
[ ] Export/report tidak memakai pool OLTP secara liar.
[ ] Query timeout/cancellation dipertimbangkan.
[ ] Long-running read punya concurrency limit.

Production Diagnostics
[ ] Query bisa dikorelasikan dengan request/job id.
[ ] Slow query dan pool metrics bisa menunjukkan masalah.
[ ] Error handling menutup resource dan rollback jika perlu.
```

---

## 37. Anti-Pattern dan Versi Lebih Baik

### Anti-Pattern 1: Return ResultSet

Buruk:

```java
ResultSet findAllUsers() throws SQLException;
```

Lebih baik:

```java
List<User> findUsers(...);
void scanUsers(..., Consumer<User> consumer);
Page<User> findUsersPage(...);
```

### Anti-Pattern 2: Select Star

Buruk:

```sql
select * from audit_trail
```

Lebih baik:

```sql
select id, module_id, activity, created_by, created_date_time
from audit_trail
```

### Anti-Pattern 3: No Limit for API List

Buruk:

```sql
select id, name from users where status = ?
```

Lebih baik:

```sql
select id, name
from users
where status = ?
order by id
fetch first ? rows only
```

### Anti-Pattern 4: Collect Huge Export in Memory

Buruk:

```java
List<Row> rows = jdbc.findAllRows();
excelWriter.write(rows);
```

Lebih baik:

```text
chunk rows -> write incrementally -> release DB resource between chunks if possible
```

### Anti-Pattern 5: External Call Inside ResultSet Loop

Buruk:

```java
while (rs.next()) {
    externalClient.send(map(rs));
}
```

Lebih baik:

```text
read bounded batch -> close DB resource -> send/process outside DB connection scope
```

---

## 38. Mental Model Final

Simpan model ini:

```text
ResultSet is not data.
ResultSet is access to data.

It is a cursor-like object whose behavior depends on:
  - Statement
  - Connection
  - transaction
  - driver
  - database cursor/buffer
  - fetch size
  - result set type
  - row width
  - LOB columns
  - application processing speed
```

Jika kamu ingin menjadi sangat kuat di JDBC, setiap kali melihat:

```java
while (rs.next())
```

jangan hanya bertanya:

```text
Apa yang dilakukan per row?
```

Tanyakan juga:

```text
Apakah semua row sudah ada di memory?
Apakah driver fetch bertahap?
Apakah connection sedang ditahan?
Apakah transaction masih aktif?
Apakah cursor server masih terbuka?
Apakah processing di loop lambat?
Apakah pool OLTP bisa starvation?
Apakah query bounded?
Apakah LOB ikut terbaca?
Apakah mapper menciptakan N+1?
Apakah timeout dan cancellation jelas?
```

Itulah perbedaan antara developer yang “bisa JDBC” dan engineer yang benar-benar memahami production database boundary.

---

## 39. Referensi Resmi dan Lanjutan

Referensi utama:

1. Java SE API Documentation — `java.sql.ResultSet`.
2. Java SE API Documentation — `java.sql.Statement`.
3. Java SE API Documentation — `java.sql.PreparedStatement`.
4. PostgreSQL JDBC Documentation — Issuing a Query and Processing the Result.
5. MySQL Connector/J Developer Guide — JDBC API Implementation Notes / streaming result set behavior.
6. Oracle JDBC Developer’s Guide — Result Set and row fetch size.

Catatan:

```text
Untuk production tuning, selalu validasi behavior dengan versi driver dan database yang benar-benar dipakai.
JDBC API memberi kontrak umum, tetapi memory/fetching/cursor behavior sangat bergantung implementasi driver.
```

---

# Status Akhir Part 005

```text
Part 005 selesai.
Seri belum selesai.

Part berikutnya:
Part 006 — JDBC Type System: SQL Types, Java Types, and Conversion Traps

File berikutnya:
learn-java-sql-jdbc-hikaricp-part-006.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 004 — Statement, PreparedStatement, CallableStatement: Execution Model](./learn-java-sql-jdbc-hikaricp-part-004.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: JDBC Type System: SQL Types, Java Types, and Conversion Traps](./learn-java-sql-jdbc-hikaricp-part-006.md)
