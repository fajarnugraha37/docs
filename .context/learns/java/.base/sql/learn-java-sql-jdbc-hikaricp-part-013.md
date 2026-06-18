# learn-java-sql-jdbc-hikaricp-part-013

# Part 013 — Large Objects and Streaming: `Blob`, `Clob`, `NClob`, `SQLXML`

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Status: Part 013 dari 029  
> Fokus: memahami Large Object/LOB di JDBC sebagai **resource, stream, locator, transaction-bound object, dan operational risk**, bukan hanya sebagai “kolom besar”.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan konseptual antara data biasa dan **large object** di JDBC.
2. Membedakan `Blob`, `Clob`, `NClob`, dan `SQLXML`.
3. Memahami kapan LOB dimaterialisasi di memory dan kapan dapat diproses sebagai stream.
4. Menggunakan `InputStream`, `Reader`, `OutputStream`, dan `Writer` dengan benar pada JDBC.
5. Menghindari memory blow-up saat membaca/menulis data besar.
6. Memahami LOB sebagai **locator** pada beberapa database, bukan selalu byte/string penuh.
7. Memahami hubungan LOB dengan transaction, cursor, resource ownership, dan pool.
8. Merancang strategi penyimpanan file/dokumen/audit payload secara defensible.
9. Menganalisis dampak LOB terhadap performance query, storage, indexing, backup, replication, dan housekeeping.
10. Membuat keputusan apakah data besar sebaiknya disimpan di database, object storage, filesystem, atau hybrid model.

---

## 1. Kenapa LOB Penting?

Di banyak aplikasi enterprise, terutama sistem case management, regulatory workflow, document management, audit trail, dan integration platform, kita sering menjumpai data besar seperti:

- file lampiran,
- PDF,
- image,
- generated report,
- serialized payload,
- XML message,
- JSON snapshot,
- audit change set,
- email body,
- correspondence body,
- request/response integration log,
- full-text searchable content,
- document template,
- digital evidence,
- large remarks/history field.

Secara database, data seperti ini sering jatuh ke keluarga:

```text
BLOB   = Binary Large Object
CLOB   = Character Large Object
NCLOB  = National Character Large Object
XML    = XML/document-specific large object
TEXT   = vendor-specific character large value
BYTEA  = PostgreSQL binary field
LONG*  = legacy large data type di beberapa DB
```

Di JDBC, abstraction standarnya adalah:

```java
java.sql.Blob
java.sql.Clob
java.sql.NClob
java.sql.SQLXML
```

Masalahnya: banyak engineer memperlakukan LOB seperti `String` atau `byte[]` biasa.

Itu bisa berbahaya.

```java
byte[] content = resultSet.getBytes("file_content");
String audit = resultSet.getString("serialized_changes");
```

Untuk data kecil, kode ini terlihat normal. Untuk data besar, kode ini bisa:

- menaikkan heap secara drastis,
- memperpanjang GC pause,
- memperlambat response time,
- membuat connection tertahan lama,
- menghabiskan pool,
- memperbesar network transfer,
- membuat query listing menjadi berat,
- memperbesar backup/replication cost,
- memperumit purge/archival,
- membuat database storage tidak turun walau row sudah dihapus,
- menimbulkan open cursor/temporary LOB leak.

Mental model awal:

```text
LOB is not “just a bigger VARCHAR”.
LOB is a resource boundary.
```

---

## 2. Definisi JDBC LOB

### 2.1 `Blob`

`Blob` adalah representasi Java untuk SQL `BLOB`.

Digunakan untuk data binary:

- PDF,
- ZIP,
- image,
- file office document,
- encrypted binary payload,
- serialized binary format,
- compressed object.

Operasi penting:

```java
Blob blob = resultSet.getBlob("content");
long length = blob.length();
InputStream in = blob.getBinaryStream();
byte[] bytes = blob.getBytes(1, (int) length);
blob.free();
```

Yang perlu diingat:

```text
getBytes() materializes data into memory.
getBinaryStream() allows streaming.
```

Untuk data besar, stream lebih aman daripada `byte[]`.

---

### 2.2 `Clob`

`Clob` adalah representasi Java untuk SQL `CLOB`.

Digunakan untuk data karakter besar:

- long text,
- audit serialized text,
- large JSON jika database tidak memakai native JSON,
- generated HTML,
- email body,
- remarks panjang,
- XML jika tidak memakai `SQLXML`.

Operasi penting:

```java
Clob clob = resultSet.getClob("body");
long length = clob.length();
Reader reader = clob.getCharacterStream();
String text = clob.getSubString(1, (int) length);
clob.free();
```

Yang perlu diingat:

```text
getSubString() materializes character data into memory.
getCharacterStream() allows streaming.
```

---

### 2.3 `NClob`

`NClob` adalah CLOB untuk national character set.

Secara historis, ini relevan untuk database yang membedakan:

```text
CLOB   -> database character set
NCLOB  -> national character set
```

Penggunaan modern bergantung pada database dan encoding strategy.

Biasanya digunakan untuk data Unicode besar ketika database membedakan storage karakter biasa dan national character storage.

Contoh:

```java
NClob nclob = resultSet.getNClob("localized_content");
try (Reader r = nclob.getCharacterStream()) {
    // stream characters
} finally {
    nclob.free();
}
```

---

### 2.4 `SQLXML`

`SQLXML` adalah representasi JDBC untuk SQL XML value.

Contoh operasi:

```java
SQLXML xml = connection.createSQLXML();
xml.setString("<root><caseId>123</caseId></root>");
preparedStatement.setSQLXML(1, xml);
xml.free();
```

Atau membaca:

```java
SQLXML xml = resultSet.getSQLXML("payload_xml");
String value = xml.getString();
xml.free();
```

`SQLXML` bisa mendukung akses berbasis stream/source/result tergantung driver.

Namun, support aktual sangat driver-specific.

---

## 3. LOB Bukan Selalu Disimpan Inline di Row

Untuk memahami performance LOB, kamu harus membedakan:

```text
logical row
physical storage
LOB locator
LOB segment / TOAST / out-of-line storage
network transfer
client materialization
```

Di beberapa database, kolom LOB tidak selalu disimpan penuh di row utama. Row bisa menyimpan pointer/locator/reference ke area storage lain.

Model sederhana:

```text
TABLE ROW
+----+---------+------------------+
| ID | STATUS  | DOCUMENT_LOB_REF |
+----+---------+------------------+
                         |
                         v
                 LOB STORAGE SEGMENT
                 +----------------+
                 | chunk 1        |
                 | chunk 2        |
                 | chunk 3        |
                 +----------------+
```

Implikasinya:

1. Query listing yang hanya mengambil `id`, `status`, `created_at` mungkin ringan.
2. Query listing yang ikut mengambil `document_lob` bisa menjadi sangat berat.
3. `SELECT *` pada tabel dengan LOB adalah red flag.
4. Index pada kolom metadata tidak otomatis menyelamatkan biaya baca LOB.
5. Menghapus row tidak selalu langsung membuat storage OS/database turun.
6. LOB dapat punya segment/chunk/page tersendiri.
7. Backup, replication, vacuum, undo, redo, archive log, dan storage reclaim bisa terdampak besar.

Mental model:

```text
A LOB column can make a table operationally heavy even if business row count looks moderate.
```

---

## 4. Locator vs Materialized Value

Salah satu konsep terpenting: `Blob`/`Clob` dapat berperilaku sebagai **locator**.

Artinya object Java `Blob`/`Clob` bukan selalu isi penuh datanya. Ia bisa menjadi handle yang mengacu ke resource database.

```text
Java Blob object
   |
   |  may represent
   v
Database-side LOB locator/resource
   |
   v
Actual LOB bytes/chars
```

Konsekuensi:

1. LOB bisa valid hanya dalam transaction tertentu.
2. Closing `ResultSet` tidak selalu otomatis membebaskan LOB object.
3. `free()` penting untuk memberi sinyal resource tidak dipakai lagi.
4. Membaca LOB setelah transaction selesai bisa gagal pada beberapa driver/database.
5. Membaca LOB setelah connection dikembalikan ke pool adalah desain yang buruk.

Contoh buruk:

```java
public Clob findBodyClob(long id) throws SQLException {
    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement("select body from message where id = ?")) {
        ps.setLong(1, id);
        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return null;
            }
            return rs.getClob(1); // BAD: returning connection-bound resource
        }
    }
}
```

Masalah:

```text
Clob returned outside the lifetime of ResultSet/Statement/Connection.
```

Lebih baik:

```java
public void streamBody(long id, Writer target) throws SQLException, IOException {
    String sql = "select body from message where id = ?";

    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement(sql)) {
        ps.setLong(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                return;
            }

            Clob clob = rs.getClob(1);
            try (Reader reader = clob.getCharacterStream()) {
                reader.transferTo(target);
            } finally {
                clob.free();
            }
        }
    }
}
```

Ownership rule:

```text
The method that opens a JDBC LOB resource should consume/free it before returning,
unless it explicitly transfers ownership inside a well-defined streaming abstraction.
```

---

## 5. Materialization Trap

LOB API memberi dua gaya akses:

```text
materialize all data
stream data progressively
```

### 5.1 Materialize

Contoh:

```java
byte[] allBytes = resultSet.getBytes("content");
String allText = resultSet.getString("body");
String clobText = clob.getSubString(1, (int) clob.length());
byte[] blobBytes = blob.getBytes(1, (int) blob.length());
```

Kelebihan:

- sederhana,
- cocok untuk data kecil,
- mudah dipakai di mapper,
- mudah dikirim ke JSON response untuk field kecil.

Risiko:

- heap naik sebesar payload,
- bisa ada copy berlapis,
- encoding conversion menambah memory,
- GC pressure,
- request latency naik,
- pool connection tertahan selama transfer,
- OOM jika banyak request paralel.

### 5.2 Stream

Contoh binary:

```java
Blob blob = rs.getBlob("content");
try (InputStream in = blob.getBinaryStream()) {
    in.transferTo(outputStream);
} finally {
    blob.free();
}
```

Contoh character:

```java
Clob clob = rs.getClob("body");
try (Reader reader = clob.getCharacterStream()) {
    reader.transferTo(writer);
} finally {
    clob.free();
}
```

Kelebihan:

- memory lebih stabil,
- cocok untuk file besar,
- cocok untuk export,
- bisa dipipe ke HTTP response atau object storage.

Risiko:

- connection tertahan selama stream berlangsung,
- transaction bisa terbuka lama,
- client lambat dapat menahan DB resource,
- error handling lebih kompleks,
- retry partial stream sulit,
- resource leak lebih mudah terjadi.

Top 1% mental model:

```text
Streaming saves heap, but it does not make the operation free.
It shifts the pressure from heap to connection lifetime, DB cursor/LOB resource,
network duration, and transaction lifetime.
```

---

## 6. `Blob` API Deep Dive

Interface `Blob` menyediakan operasi utama:

```java
long length() throws SQLException;
byte[] getBytes(long pos, int length) throws SQLException;
InputStream getBinaryStream() throws SQLException;
long position(byte[] pattern, long start) throws SQLException;
long position(Blob pattern, long start) throws SQLException;
int setBytes(long pos, byte[] bytes) throws SQLException;
OutputStream setBinaryStream(long pos) throws SQLException;
void truncate(long len) throws SQLException;
void free() throws SQLException;
InputStream getBinaryStream(long pos, long length) throws SQLException;
```

### 6.1 Position Is 1-Based

JDBC LOB position menggunakan 1-based index.

```java
byte[] first10 = blob.getBytes(1, 10);
```

Bukan:

```java
blob.getBytes(0, 10); // wrong
```

Ini berbeda dari array Java yang 0-based.

---

### 6.2 Jangan Cast `long length` ke `int` Sembarangan

`Blob.length()` mengembalikan `long`.

Contoh buruk:

```java
byte[] data = blob.getBytes(1, (int) blob.length());
```

Kenapa buruk?

1. Jika LOB > 2GB, overflow/invalid.
2. Bahkan 500MB pun mungkin tidak layak dimaterialisasi.
3. `byte[]` harus contiguous memory.
4. Bisa ada copy internal tambahan.

Lebih aman:

```java
try (InputStream in = blob.getBinaryStream()) {
    in.transferTo(out);
}
```

---

### 6.3 Writing BLOB via Stream

Contoh insert binary besar:

```java
String sql = "insert into document_store (id, file_name, content) values (?, ?, ?)";

try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(sql);
     InputStream in = Files.newInputStream(path)) {

    ps.setLong(1, documentId);
    ps.setString(2, fileName);
    ps.setBinaryStream(3, in, Files.size(path));
    ps.executeUpdate();
}
```

Catatan:

```text
Passing length can help some drivers optimize streaming.
But behavior remains driver-specific.
```

Untuk JDBC modern ada overload tanpa length:

```java
ps.setBinaryStream(3, in);
```

Namun beberapa driver lebih predictable jika length diketahui.

---

## 7. `Clob` API Deep Dive

Interface `Clob` menyediakan operasi utama:

```java
long length() throws SQLException;
String getSubString(long pos, int length) throws SQLException;
Reader getCharacterStream() throws SQLException;
InputStream getAsciiStream() throws SQLException;
long position(String searchstr, long start) throws SQLException;
long position(Clob searchstr, long start) throws SQLException;
int setString(long pos, String str) throws SQLException;
OutputStream setAsciiStream(long pos) throws SQLException;
Writer setCharacterStream(long pos) throws SQLException;
void truncate(long len) throws SQLException;
void free() throws SQLException;
Reader getCharacterStream(long pos, long length) throws SQLException;
```

### 7.1 CLOB Is Character Data, Not Byte Data

CLOB berkaitan dengan karakter.

Maka operasi utamanya memakai:

```java
Reader
Writer
String
```

Bukan:

```java
InputStream
OutputStream
```

Walaupun ada `getAsciiStream()`, itu hanya relevan untuk ASCII dan tidak cocok untuk Unicode modern secara umum.

---

### 7.2 Writing CLOB via Reader

Contoh:

```java
String sql = "insert into audit_payload (id, payload_text) values (?, ?)";

try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(sql);
     Reader reader = Files.newBufferedReader(payloadPath, StandardCharsets.UTF_8)) {

    ps.setLong(1, id);
    ps.setCharacterStream(2, reader, Files.size(payloadPath));
    ps.executeUpdate();
}
```

Tetapi hati-hati: `Files.size(path)` adalah byte count, bukan character count.

Untuk `setCharacterStream(int, Reader, long length)`, length adalah jumlah karakter, bukan byte.

Jika tidak tahu character length:

```java
ps.setCharacterStream(2, reader);
```

Atau jika payload sudah berupa `String` kecil/menengah:

```java
ps.setString(2, payload);
```

Rule praktis:

```text
For small text: setString is fine.
For large text: setCharacterStream is safer.
```

---

## 8. `NClob` Deep Dive

`NClob` mirip `Clob`, tetapi ditujukan untuk national character set.

API penting pada `PreparedStatement`:

```java
ps.setNString(index, value);
ps.setNCharacterStream(index, reader);
ps.setNClob(index, nclob);
```

Pada `ResultSet`:

```java
String value = rs.getNString(index);
Reader reader = rs.getNCharacterStream(index);
NClob nclob = rs.getNClob(index);
```

Kapan dipakai?

1. Database membedakan `CLOB` dan `NCLOB`.
2. Schema memang memakai `NCLOB`.
3. Data multilingual besar dan DB convention mengharuskan national character type.

Namun pada banyak sistem modern dengan UTF-8 end-to-end, penggunaan `NCLOB` perlu diputuskan berdasarkan database, schema standard, collation, dan vendor behavior.

---

## 9. `SQLXML` Deep Dive

`SQLXML` dipakai untuk XML value.

Contoh insert:

```java
SQLXML xml = connection.createSQLXML();
try {
    xml.setString("<message><id>123</id></message>");

    try (PreparedStatement ps = connection.prepareStatement(
            "insert into integration_message (id, payload_xml) values (?, ?)")) {
        ps.setLong(1, 123L);
        ps.setSQLXML(2, xml);
        ps.executeUpdate();
    }
} finally {
    xml.free();
}
```

Contoh read:

```java
SQLXML xml = rs.getSQLXML("payload_xml");
try {
    try (Reader reader = xml.getCharacterStream()) {
        reader.transferTo(writer);
    }
} finally {
    xml.free();
}
```

`SQLXML` juga dapat bekerja dengan:

```java
Source source = xml.getSource(DOMSource.class);
Result result = xml.setResult(SAXResult.class);
```

Namun support driver bisa berbeda. Jangan asumsikan semua driver mendukung semua mode XML processing.

---

## 10. Resource Ownership: LOB Harus Di-`free()`

JDBC LOB memiliki method:

```java
blob.free();
clob.free();
nclob.free();
sqlxml.free();
```

Tujuannya adalah melepas resource yang terkait LOB.

Pattern aman:

```java
Blob blob = rs.getBlob("content");
try {
    try (InputStream in = blob.getBinaryStream()) {
        in.transferTo(out);
    }
} finally {
    blob.free();
}
```

Untuk CLOB:

```java
Clob clob = rs.getClob("body");
try {
    try (Reader reader = clob.getCharacterStream()) {
        reader.transferTo(writer);
    }
} finally {
    clob.free();
}
```

Kenapa tidak cukup mengandalkan `ResultSet.close()`?

Karena LOB object bisa punya lifecycle sendiri. Dalam dokumentasi JDBC, LOB object yang dibuat dari `ResultSet` dapat tetap valid setidaknya selama transaction tempat ia dibuat, kecuali `free()` dipanggil. Jadi jangan bergantung pada close cascading yang tidak eksplisit.

Rule:

```text
If you obtain a Blob/Clob/NClob/SQLXML object, you own the obligation to free it.
```

---

## 11. Transaction Interaction

LOB sering berinteraksi dengan transaction.

Kemungkinan behavior:

1. LOB locator valid selama transaction.
2. LOB streaming membutuhkan connection tetap hidup.
3. Commit/rollback dapat membuat locator invalid.
4. Temporary LOB dapat dilepas saat transaction/session selesai.
5. Beberapa DB membutuhkan transaction aktif untuk large object API tertentu.

Contoh buruk:

```java
Blob blob;
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);
    blob = loadBlob(c, id);
    c.commit();
}

try (InputStream in = blob.getBinaryStream()) { // may fail
    in.transferTo(out);
}
```

Lebih benar:

```java
try (Connection c = dataSource.getConnection()) {
    c.setAutoCommit(false);

    Blob blob = loadBlob(c, id);
    try {
        try (InputStream in = blob.getBinaryStream()) {
            in.transferTo(out);
        }
        c.commit();
    } catch (Exception e) {
        c.rollback();
        throw e;
    } finally {
        blob.free();
    }
}
```

Namun untuk streaming ke HTTP response, menahan transaction sampai client selesai download bisa buruk.

Maka perlu desain lebih matang.

---

## 12. Streaming ke HTTP Response: Hidden Coupling yang Berbahaya

Pattern umum:

```java
@GetMapping("/documents/{id}/content")
public void download(@PathVariable long id, HttpServletResponse response) {
    documentRepository.streamContent(id, response.getOutputStream());
}
```

Masalah potensial:

```text
Slow client holds HTTP thread + JDBC connection + DB cursor/LOB resource.
```

Jika 100 user download file besar secara lambat:

```text
100 slow downloads
= 100 connections borrowed for long duration
= pool exhaustion
= OLTP request gagal mendapatkan connection
```

Ini bukan memory problem lagi, tapi **connection occupancy problem**.

Alternatif desain:

### 12.1 Object Storage for Large Files

Simpan file besar di object storage, database menyimpan metadata dan reference.

```text
DB:
- document_id
- object_key
- checksum
- size
- content_type
- retention_policy
- created_by
- created_at

Object storage:
- actual file bytes
```

Kelebihan:

- download tidak menahan DB connection,
- object storage lebih cocok untuk large binary,
- presigned URL bisa dipakai,
- lifecycle policy lebih mudah,
- storage cost sering lebih efisien.

Kekurangan:

- atomicity DB + object storage lebih kompleks,
- perlu cleanup orphan object,
- consistency model harus dirancang,
- authorization harus ketat,
- audit dan retention harus jelas.

### 12.2 Stage to Temporary File/Object

Jika data harus berasal dari DB, aplikasi bisa membaca cepat dari DB ke temporary file/object, lalu melepas DB connection, kemudian stream ke client dari storage sementara.

Trade-off:

- menambah IO,
- menambah latency awal,
- tetapi mengurangi durasi pegang DB connection.

### 12.3 Dedicated Pool for LOB Download

Pisahkan pool untuk operasi LOB/reporting.

```text
oltpPool: max 20
lobPool:  max 5
```

Tujuannya bukan membuat LOB lebih cepat, melainkan mencegah operasi LOB menghabiskan semua koneksi OLTP.

---

## 13. LOB dan Connection Pool

Saat memakai HikariCP atau pool lain, LOB streaming punya implikasi langsung.

Selama stream dari `Blob`/`Clob` masih berjalan:

```text
Connection cannot be safely returned to pool.
Statement/ResultSet may still be open.
Database resource may still be active.
```

Kesalahan umum:

```java
InputStream stream;
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    rs.next();
    stream = rs.getBinaryStream(1);
}
return stream; // BAD: stream backed by closed JDBC resources
```

Pattern ini sering muncul saat ingin membuat API seperti:

```java
InputStream downloadContent(long id)
```

Masalahnya method tersebut menyembunyikan resource ownership.

Lebih baik gunakan callback:

```java
public void streamContent(long id, OutputStream out) throws SQLException, IOException {
    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement("select content from document where id = ?")) {
        ps.setLong(1, id);
        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                throw new NoSuchElementException("document not found: " + id);
            }
            try (InputStream in = rs.getBinaryStream(1)) {
                in.transferTo(out);
            }
        }
    }
}
```

Atau expose abstraction yang jelas:

```java
@FunctionalInterface
public interface BlobConsumer {
    void accept(InputStream inputStream) throws IOException;
}

public void withContentStream(long id, BlobConsumer consumer) throws SQLException, IOException {
    try (Connection c = dataSource.getConnection();
         PreparedStatement ps = c.prepareStatement("select content from document where id = ?")) {
        ps.setLong(1, id);
        try (ResultSet rs = ps.executeQuery()) {
            if (!rs.next()) {
                throw new NoSuchElementException("document not found: " + id);
            }
            try (InputStream in = rs.getBinaryStream(1)) {
                consumer.accept(in);
            }
        }
    }
}
```

Dengan pattern callback, resource scope tetap berada dalam method repository.

---

## 14. Membaca LOB: API Pilihan

### 14.1 Binary Data Kecil

```java
byte[] content = rs.getBytes("content");
```

Cocok jika:

- data kecil,
- bounded size jelas,
- tidak banyak request paralel,
- ingin simplicity.

Tetapkan limit di application/domain.

```text
Example: avatar <= 256 KB may be acceptable as byte[].
```

---

### 14.2 Binary Data Besar

```java
try (InputStream in = rs.getBinaryStream("content")) {
    in.transferTo(out);
}
```

Cocok untuk:

- PDF,
- ZIP,
- generated report,
- file attachment,
- large export.

---

### 14.3 Character Data Kecil/Menengah

```java
String body = rs.getString("body");
```

Cocok jika:

- field bounded,
- misalnya remarks beberapa KB,
- email template kecil,
- short JSON config.

---

### 14.4 Character Data Besar

```java
try (Reader reader = rs.getCharacterStream("body")) {
    reader.transferTo(writer);
}
```

Cocok untuk:

- audit payload besar,
- large XML,
- long generated HTML,
- export text.

---

## 15. Menulis LOB: API Pilihan

### 15.1 Binary dari `byte[]`

```java
ps.setBytes(1, bytes);
```

Cocok untuk data kecil.

---

### 15.2 Binary dari `InputStream`

```java
ps.setBinaryStream(1, inputStream, size);
```

Cocok untuk data besar.

---

### 15.3 Text dari `String`

```java
ps.setString(1, text);
```

Cocok untuk data kecil/menengah.

---

### 15.4 Text dari `Reader`

```java
ps.setCharacterStream(1, reader);
```

Cocok untuk text besar.

---

### 15.5 Menggunakan `createBlob()` / `createClob()`

JDBC menyediakan:

```java
Blob blob = connection.createBlob();
Clob clob = connection.createClob();
NClob nclob = connection.createNClob();
SQLXML xml = connection.createSQLXML();
```

Contoh:

```java
Blob blob = connection.createBlob();
try {
    try (OutputStream out = blob.setBinaryStream(1);
         InputStream in = Files.newInputStream(path)) {
        in.transferTo(out);
    }

    try (PreparedStatement ps = connection.prepareStatement(
            "insert into document_store (id, content) values (?, ?)")) {
        ps.setLong(1, id);
        ps.setBlob(2, blob);
        ps.executeUpdate();
    }
} finally {
    blob.free();
}
```

Namun banyak kasus lebih sederhana memakai:

```java
ps.setBinaryStream(index, inputStream, length);
```

Karena `createBlob()` dapat membuat temporary LOB di sisi driver/database, tergantung implementasi.

---

## 16. Temporary LOB

Beberapa database, terutama Oracle, punya konsep temporary LOB.

Temporary LOB dapat muncul ketika:

- aplikasi membuat LOB baru,
- driver membuat intermediate LOB,
- procedure mengembalikan LOB sementara,
- operasi transformasi menghasilkan LOB.

Risiko:

1. Temporary LOB mengonsumsi resource database.
2. Jika tidak dibebaskan, resource bisa bertahan selama session/transaction.
3. Pada pooled connection, session dapat hidup lama.
4. Leak kecil bisa menjadi besar karena pool mempertahankan session.

Pattern defensif:

```java
Clob clob = connection.createClob();
try {
    clob.setString(1, text);
    ps.setClob(1, clob);
    ps.executeUpdate();
} finally {
    clob.free();
}
```

Rule:

```text
Any LOB explicitly created by application code must be explicitly freed.
```

---

## 17. LOB dan `SELECT *`

Pada tabel dengan LOB, `SELECT *` lebih berbahaya daripada biasanya.

Contoh tabel:

```sql
CREATE TABLE audit_trail (
    id                BIGINT PRIMARY KEY,
    module_code       VARCHAR(100),
    activity          VARCHAR(100),
    created_at        TIMESTAMP,
    actor_user_id     VARCHAR(100),
    metadata          CLOB,
    serialized_change CLOB,
    full_text         CLOB
);
```

Query listing buruk:

```sql
SELECT *
FROM audit_trail
WHERE module_code = ?
ORDER BY created_at DESC
FETCH FIRST 50 ROWS ONLY
```

Masalah:

- tiga CLOB ikut terbaca,
- network transfer besar,
- mapping lambat,
- UI listing mungkin hanya butuh metadata kecil,
- DB harus mengakses LOB storage,
- aplikasi mungkin mematerialisasi CLOB ke String.

Query lebih baik:

```sql
SELECT id, module_code, activity, created_at, actor_user_id
FROM audit_trail
WHERE module_code = ?
ORDER BY created_at DESC
FETCH FIRST 50 ROWS ONLY
```

Detail payload dibaca hanya saat dibutuhkan:

```sql
SELECT metadata, serialized_change, full_text
FROM audit_trail
WHERE id = ?
```

Design rule:

```text
Separate list/read-model query from detail/payload query.
```

---

## 18. LOB in Hot Table: Audit Trail Scenario

Bayangkan `AUDIT_TRAIL` dengan kolom:

```text
ID
MODULE_ID
ACTIVITY
CREATED_DATE_TIME
CREATED_BY
META_DATA              CLOB
SERIALIZED_CHANGES     CLOB
FULL_TEXT              CLOB
```

Tabel ini sering dipakai untuk:

- listing audit,
- search by module,
- filter by date,
- view detail,
- compliance evidence,
- reporting,
- export.

Masalah umum:

### 18.1 Row Count Terlihat Normal, Storage Besar

Misalnya hanya beberapa juta row, tetapi CLOB bisa membuat storage ratusan GB.

### 18.2 Delete Tidak Langsung Mengurangi Storage

Setelah delete banyak row, storage database/OS belum tentu turun karena:

- high water mark,
- LOB segment free space reuse,
- undo/redo retention,
- recycle bin,
- segment fragmentation,
- tablespace allocation,
- vacuum/shrink requirement tergantung DB.

### 18.3 Listing Lambat Karena Payload Ikut

Jika view listing join ke table dan memilih CLOB, query menjadi berat.

### 18.4 Index Tidak Menutup Biaya LOB

Index bisa mempercepat pencarian row, tetapi jika setiap row memuat CLOB besar, fetch tetap mahal.

### 18.5 Full Text Search Tidak Sama dengan `LIKE` pada CLOB

Mencari:

```sql
WHERE full_text LIKE '%keyword%'
```

pada CLOB besar bisa sangat mahal.

Lebih baik gunakan:

- database full-text index,
- search engine,
- generated searchable projection,
- normalized search terms,
- dedicated audit search store.

---

## 19. Schema Design: Inline Metadata, Out-of-Line Payload

Untuk tabel yang punya LOB, pikirkan dua jenis data:

```text
metadata = sering difilter, disort, dilisting
payload  = besar, jarang dibaca, hanya untuk detail/evidence
```

Desain yang sering lebih baik:

```sql
CREATE TABLE audit_trail (
    id              BIGINT PRIMARY KEY,
    module_code     VARCHAR(100) NOT NULL,
    activity        VARCHAR(100) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    actor_user_id   VARCHAR(100) NOT NULL
);

CREATE TABLE audit_trail_payload (
    audit_trail_id      BIGINT PRIMARY KEY,
    metadata            CLOB,
    serialized_changes  CLOB,
    full_text           CLOB,
    FOREIGN KEY (audit_trail_id) REFERENCES audit_trail(id)
);
```

Kelebihan:

- listing lebih ringan,
- index hot table lebih kecil,
- cache efficiency lebih baik,
- payload bisa di-archive terpisah,
- backup/partition strategy lebih fleksibel.

Kekurangan:

- join untuk detail,
- referential integrity perlu dijaga,
- insert dua table,
- query detail sedikit lebih kompleks.

Model ini sering cocok untuk enterprise audit/case systems.

---

## 20. LOB dan Indexing

LOB biasanya tidak di-index seperti field kecil biasa.

Pilihan umum:

### 20.1 Metadata Index

Index field kecil:

```sql
CREATE INDEX idx_audit_module_created
ON audit_trail(module_code, created_at);
```

Gunakan untuk listing/filter.

### 20.2 Full-Text Index

Untuk konten besar:

- Oracle Text,
- PostgreSQL full-text search,
- MySQL FULLTEXT,
- SQL Server Full-Text Search,
- Elasticsearch/OpenSearch.

### 20.3 Hash/Checksum Column

Untuk dedup/integrity:

```sql
content_sha256 VARCHAR(64)
```

Index checksum:

```sql
CREATE INDEX idx_document_sha256 ON document_store(content_sha256);
```

### 20.4 Extracted Search Projection

Daripada search langsung di CLOB, extract field penting ke kolom normal.

```text
CLOB JSON payload:
{
  "caseNo": "EA-2026-00001",
  "licenseNo": "L12345",
  "status": "APPROVED"
}

Projection columns:
case_no
license_no
status
```

Rule:

```text
Do not use LOB as your primary query surface.
Use LOB as payload/evidence/detail storage.
```

---

## 21. LOB dan JSON

Banyak sistem menyimpan JSON besar sebagai CLOB.

Ini bisa masuk akal jika:

- database belum punya native JSON type,
- payload hanya untuk audit/evidence,
- query tidak sering mencari isi JSON,
- format ingin dipertahankan apa adanya.

Namun menjadi masalah jika:

- aplikasi sering query field di dalam JSON,
- JSON dipakai sebagai model utama,
- indexing sulit,
- payload terus membesar,
- migration schema tidak terkontrol.

Alternatif:

1. Native JSON type database.
2. Extracted columns untuk field penting.
3. Separate event/audit store.
4. Object storage untuk payload besar.
5. Search index untuk query teks.

Top 1% rule:

```text
CLOB JSON is acceptable as immutable evidence.
CLOB JSON is dangerous as an operational query model.
```

---

## 22. LOB dan XML

XML masih umum di sistem government, integration, compliance, dan legacy enterprise.

Pilihan storage:

```text
CLOB
SQLXML
native XML type vendor
object storage
```

Pertimbangan:

1. Apakah XML perlu divalidasi dengan schema?
2. Apakah XML perlu di-query dengan XPath/XQuery?
3. Apakah XML hanya evidence raw message?
4. Apakah ukuran XML besar?
5. Apakah XML perlu digitally signed?
6. Apakah whitespace/canonical form penting?

Jika XML adalah evidence signed document, jangan sembarang parse-render-save karena bisa mengubah canonical representation.

Untuk evidence:

```text
Store original bytes/text + checksum + metadata.
```

Untuk query:

```text
Extract searchable fields into normalized/projection columns.
```

---

## 23. Integrity: Checksum, Size, Content Type

LOB storage sebaiknya tidak hanya menyimpan content.

Tambahkan metadata:

```sql
CREATE TABLE document_store (
    id              BIGINT PRIMARY KEY,
    file_name       VARCHAR(255) NOT NULL,
    content_type    VARCHAR(100) NOT NULL,
    content_length  BIGINT NOT NULL,
    sha256_hex      CHAR(64) NOT NULL,
    content         BLOB NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    created_by      VARCHAR(100) NOT NULL
);
```

Manfaat:

- validate upload/download,
- detect corruption,
- support deduplication,
- support audit evidence,
- avoid reading LOB hanya untuk mengetahui size,
- content type enforcement,
- security scanning.

Saat upload:

```text
stream file -> compute sha256 -> store metadata + stream content
```

Challenge:

- jika stream hanya bisa dibaca sekali, perlu tee stream atau temporary staging.
- checksum membutuhkan membaca seluruh content.
- DB transaction dan file/object storage transaction perlu dirancang.

---

## 24. Security Considerations for LOB

LOB sering membawa data sensitif.

Risiko:

1. PII dalam attachment.
2. Secrets dalam integration payload.
3. Malware dalam uploaded file.
4. XML external entity attack jika parsing tidak aman.
5. ZIP bomb.
6. Oversized payload DoS.
7. Content-type spoofing.
8. Logging payload tanpa redaction.
9. Unauthorized direct access.
10. Retention violation.

Kontrol minimal:

```text
- enforce max size
- enforce allowed MIME/content types
- compute checksum
- malware scan where required
- store creator and access audit
- avoid logging full payload
- encrypt at rest according to DB/storage policy
- restrict DB grants
- separate payload access permission from metadata access
- apply retention and purge policy
```

Untuk XML:

```java
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setXIncludeAware(false);
factory.setExpandEntityReferences(false);
```

Walau XML parsing bukan fokus JDBC, LOB sering menjadi pintu masuk payload XML. Boundary harus aman.

---

## 25. Performance Model LOB

Saat membaca LOB, biaya tidak hanya SQL execution.

```text
Total time = locate row
           + access LOB storage
           + transfer DB -> driver
           + driver buffering/conversion
           + application processing
           + downstream output
```

Untuk CLOB:

```text
DB chars -> driver encoding conversion -> Java char/String/Reader -> output encoding
```

Untuk BLOB:

```text
DB bytes -> driver buffer -> InputStream -> output bytes
```

Faktor yang memengaruhi:

- LOB size,
- chunk size,
- network bandwidth,
- DB IO,
- driver buffering,
- fetch size,
- row prefetch,
- transaction duration,
- client speed,
- compression,
- TLS overhead,
- app thread model,
- pool size.

Kesalahan tuning umum:

```text
Pool diperbesar untuk mempercepat download LOB.
```

Padahal jika bottleneck adalah DB IO/network/client speed, pool lebih besar hanya menambah concurrency dan pressure.

Lebih baik:

- batasi concurrency LOB,
- pisahkan pool,
- gunakan object storage,
- cache hasil jika valid,
- compress jika cocok,
- gunakan pagination/partial read bila memungkinkan,
- hindari mengambil LOB di query listing.

---

## 26. LOB dan Fetch Size

`fetchSize` mengatur hint jumlah row yang diambil per round trip untuk `ResultSet`.

Namun LOB punya behavior khusus.

Jika query mengambil banyak row yang masing-masing punya LOB besar:

```sql
SELECT id, content
FROM document_store
WHERE case_id = ?
```

Menaikkan fetch size bisa memperbesar prefetch/buffering tergantung driver.

Lebih aman:

```sql
SELECT id, file_name, content_length, content_type
FROM document_store
WHERE case_id = ?
```

Lalu baca content per dokumen saat dibutuhkan:

```sql
SELECT content
FROM document_store
WHERE id = ?
```

Rule:

```text
For LOB-heavy tables, optimize query shape before tuning fetch size.
```

---

## 27. LOB dan Pagination

Pagination pada tabel LOB harus hati-hati.

Buruk:

```sql
SELECT id, title, content
FROM article
ORDER BY created_at DESC
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
```

Lebih baik:

```sql
SELECT id, title, summary, created_at
FROM article
ORDER BY created_at DESC
OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
```

Detail:

```sql
SELECT content
FROM article
WHERE id = ?
```

Untuk deep pagination, gunakan keyset pagination jika cocok:

```sql
SELECT id, title, summary, created_at
FROM article
WHERE created_at < ?
ORDER BY created_at DESC
FETCH FIRST 50 ROWS ONLY
```

LOB tidak mengubah prinsip pagination, tetapi membuat kesalahan pagination jauh lebih mahal.

---

## 28. LOB dan Batch

Batch insert LOB perlu lebih hati-hati daripada batch row kecil.

Contoh buruk:

```java
for (Document doc : documents) {
    ps.setLong(1, doc.id());
    ps.setBytes(2, doc.content()); // all documents already in heap
    ps.addBatch();
}
ps.executeBatch();
```

Jika 100 dokumen masing-masing 10MB:

```text
100 * 10MB = 1GB raw content in heap, possibly more due to copies.
```

Lebih aman:

```java
for (Path path : paths) {
    try (InputStream in = Files.newInputStream(path)) {
        ps.setLong(1, nextId());
        ps.setBinaryStream(2, in, Files.size(path));
        ps.executeUpdate();
    }
}
```

Apakah tidak batch?

Untuk LOB besar, batch bukan selalu lebih baik. Throughput bisa lebih stabil dengan:

- satu file per statement,
- transaction per bounded group,
- concurrency terbatas,
- streaming,
- backpressure.

Rule:

```text
Batch many small rows.
Stream large payloads with bounded concurrency.
```

---

## 29. LOB dan Generated Keys

Jika insert dokumen dan butuh generated key:

```java
String sql = "insert into document_store (file_name, content) values (?, ?)";

try (PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
     InputStream in = Files.newInputStream(path)) {

    ps.setString(1, fileName);
    ps.setBinaryStream(2, in, Files.size(path));
    ps.executeUpdate();

    try (ResultSet keys = ps.getGeneratedKeys()) {
        if (!keys.next()) {
            throw new SQLException("No generated key returned");
        }
        long id = keys.getLong(1);
    }
}
```

Pada beberapa database/driver, generated keys dengan LOB dan batch bisa punya limitation. Test dengan driver target, bukan asumsi.

---

## 30. LOB dan Update

Update LOB besar bisa mahal.

```sql
UPDATE document_store
SET content = ?
WHERE id = ?
```

Dampaknya:

- redo/WAL besar,
- undo besar,
- replication lag,
- backup delta besar,
- lock duration,
- storage fragmentation,
- old version retention.

Untuk dokumen immutable, lebih baik versioning:

```sql
CREATE TABLE document_version (
    document_id     BIGINT NOT NULL,
    version_no      INT NOT NULL,
    content         BLOB NOT NULL,
    sha256_hex      CHAR(64) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    PRIMARY KEY (document_id, version_no)
);
```

Keuntungan:

- auditability,
- rollback lebih jelas,
- immutable evidence,
- avoid in-place rewrite semantics.

Kekurangan:

- storage growth,
- retention cleanup lebih penting.

---

## 31. LOB dan Delete/Purge

Menghapus LOB bukan hanya:

```sql
DELETE FROM document_store WHERE id = ?
```

Pertimbangan:

1. Apakah row delete harus hard delete atau soft delete?
2. Apakah retention period sudah lewat?
3. Apakah legal hold berlaku?
4. Apakah object perlu secure delete?
5. Apakah DB storage perlu reclaim?
6. Apakah index/statistics perlu maintenance?
7. Apakah archive harus dibuat dulu?
8. Apakah audit harus mencatat delete?

Untuk purge besar, hindari satu transaksi raksasa.

Buruk:

```sql
DELETE FROM audit_trail WHERE created_at < DATE '2020-01-01';
```

Lebih aman:

```text
repeat:
  delete next 1000/5000 rows
  commit
  sleep/backoff
  monitor undo/redo/replication/storage
```

Untuk partitioned table:

```text
Drop/truncate old partition can be much cheaper than row-by-row delete.
```

Tetapi harus disesuaikan dengan DB dan retention model.

---

## 32. LOB dan Backup/Replication

LOB memperbesar biaya operasional:

- backup size,
- restore time,
- replication lag,
- archive log/WAL volume,
- snapshot time,
- storage IO,
- migration time,
- test data refresh time.

Pertanyaan desain:

```text
Apakah data LOB harus ikut database backup utama?
Apakah retention-nya sama dengan metadata?
Apakah restore RTO/RPO membutuhkan seluruh LOB langsung tersedia?
Apakah bisa dipisah ke object storage dengan lifecycle/replication sendiri?
```

Dalam banyak sistem, memisahkan metadata OLTP dan payload besar dapat mengurangi blast radius.

---

## 33. Database-Specific Notes

### 33.1 Oracle

Oracle punya tipe seperti:

```text
BLOB
CLOB
NCLOB
BFILE
```

Konsep penting:

- LOB locator,
- temporary LOB,
- LOB segment,
- SecureFiles vs BasicFiles pada versi modern,
- chunking,
- inline/out-of-line behavior,
- DBMS_LOB operations,
- LOB retention/freeing,
- tablespace impact.

JDBC code yang memakai `java.sql.Blob/Clob` lebih portable, tetapi Oracle extension kadang digunakan untuk fitur khusus.

Untuk production Oracle, monitor:

- LOB segment size,
- LOB index size,
- tablespace usage,
- undo/redo volume,
- temporary LOB usage,
- query yang mengambil CLOB di listing,
- storage reclaim setelah purge.

---

### 33.2 PostgreSQL

PostgreSQL punya beberapa pilihan binary/large data:

```text
bytea
text
json/jsonb
large object API using oid
TOAST storage for large values
```

`bytea` sering cukup untuk binary data yang tidak terlalu besar dan ingin tetap berada dalam row semantics.

Large Object API PostgreSQL berbeda dan punya lifecycle sendiri melalui OID.

Pertimbangan:

- `bytea` lebih sederhana,
- Large Object API cocok untuk object sangat besar atau streaming tertentu,
- `text` dan `jsonb` bisa memakai TOAST,
- vacuum/storage behavior penting,
- jangan lupa cleanup large object orphan jika memakai OID-based large object.

---

### 33.3 MySQL

MySQL punya tipe:

```text
TINYBLOB
BLOB
MEDIUMBLOB
LONGBLOB
TINYTEXT
TEXT
MEDIUMTEXT
LONGTEXT
JSON
```

Pertimbangan:

- ukuran maksimum berbeda per tipe,
- packet size dapat menjadi bottleneck,
- driver streaming behavior bergantung konfigurasi dan mode,
- large update dapat berdampak ke redo/binlog/replication,
- `LONGTEXT` untuk JSON raw tidak sama dengan native `JSON`.

---

### 33.4 SQL Server

SQL Server umum memakai:

```text
varbinary(max)
varchar(max)
nvarchar(max)
xml
FILESTREAM / FileTable options
```

Pertimbangan:

- `nvarchar(max)` untuk Unicode text,
- `varbinary(max)` untuk binary,
- FILESTREAM bisa menjadi opsi hybrid database/filesystem untuk large binary,
- transaction log impact tetap penting.

---

## 34. Decision Matrix: DB LOB vs Object Storage vs Filesystem

### 34.1 Simpan di Database LOB Jika

Cocok jika:

- ukuran relatif kecil/menengah,
- butuh transaction atomic dengan metadata,
- jumlah file tidak ekstrem,
- query payload jarang tapi harus strongly consistent,
- backup/restore bersama DB memang diinginkan,
- security/permission lebih mudah lewat DB,
- operational team siap mengelola storage DB.

Contoh:

- audit payload immutable ukuran kecil/menengah,
- signed XML message yang harus transactionally stored,
- generated document kecil,
- template content,
- remarks besar tetapi bounded.

---

### 34.2 Simpan di Object Storage Jika

Cocok jika:

- file besar,
- download/upload tinggi,
- payload jarang di-query oleh database,
- butuh lifecycle management,
- butuh cheap scalable storage,
- ingin menghindari DB connection tertahan saat download,
- ingin presigned URL/CDN,
- backup DB tidak boleh membesar karena file.

Contoh:

- PDF attachment besar,
- image/video,
- generated report besar,
- import/export file,
- scanned evidence document.

---

### 34.3 Simpan di Filesystem Jika

Cocok jika:

- deployment sederhana/on-prem,
- volume tidak besar,
- shared filesystem reliable,
- backup strategy jelas,
- tidak butuh cloud object storage.

Risiko:

- path consistency,
- permission,
- backup coordination,
- multi-node access,
- orphan file,
- disaster recovery.

---

### 34.4 Hybrid Pattern

Database menyimpan metadata, object storage menyimpan content.

```sql
CREATE TABLE document_metadata (
    id              BIGINT PRIMARY KEY,
    object_key      VARCHAR(500) NOT NULL,
    file_name       VARCHAR(255) NOT NULL,
    content_type    VARCHAR(100) NOT NULL,
    content_length  BIGINT NOT NULL,
    sha256_hex      CHAR(64) NOT NULL,
    status          VARCHAR(30) NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    created_by      VARCHAR(100) NOT NULL
);
```

Status bisa:

```text
UPLOADING
AVAILABLE
FAILED
DELETED
QUARANTINED
```

Ini membantu menangani non-atomicity DB + object storage.

---

## 35. Atomicity Problem: DB + Object Storage

Jika content disimpan di object storage dan metadata di DB, tidak ada transaksi ACID tunggal antara keduanya.

Failure scenario:

```text
1. Upload object sukses.
2. Insert metadata gagal.
=> orphan object.
```

Atau:

```text
1. Insert metadata sukses.
2. Upload object gagal.
=> metadata menunjuk object yang tidak ada.
```

Pattern umum:

### 35.1 Upload First, Then Metadata

```text
upload object
compute checksum
insert metadata AVAILABLE
if insert fails, schedule object cleanup
```

### 35.2 Metadata First with PENDING State

```text
insert metadata UPLOADING
upload object
verify checksum
update metadata AVAILABLE
if upload fails, mark FAILED
```

### 35.3 Outbox/Cleanup Job

Gunakan scheduled cleanup:

```text
- delete orphan objects older than X
- mark stale UPLOADING as FAILED
- verify object existence for AVAILABLE records
```

Rule:

```text
When leaving DB LOB storage, you must replace ACID simplicity with explicit lifecycle state.
```

---

## 36. Example: Safe BLOB Download Repository

```java
public final class DocumentRepository {
    private final DataSource dataSource;

    public DocumentRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    public DocumentMetadata findMetadata(long documentId) throws SQLException {
        String sql = """
                select id, file_name, content_type, content_length, sha256_hex
                from document_store
                where id = ?
                """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, documentId);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    throw new NoSuchElementException("Document not found: " + documentId);
                }

                return new DocumentMetadata(
                        rs.getLong("id"),
                        rs.getString("file_name"),
                        rs.getString("content_type"),
                        rs.getLong("content_length"),
                        rs.getString("sha256_hex")
                );
            }
        }
    }

    public void streamContent(long documentId, OutputStream output) throws SQLException, IOException {
        String sql = """
                select content
                from document_store
                where id = ?
                """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, documentId);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    throw new NoSuchElementException("Document not found: " + documentId);
                }

                Blob blob = rs.getBlob(1);
                try {
                    try (InputStream input = blob.getBinaryStream()) {
                        input.transferTo(output);
                    }
                } finally {
                    blob.free();
                }
            }
        }
    }
}
```

Catatan desain:

1. Metadata dan content dipisah.
2. Content tidak dikembalikan sebagai `byte[]`.
3. Stream tidak keluar dari scope connection.
4. `Blob.free()` dipanggil eksplisit.
5. Caller tidak mendapat JDBC resource mentah.

---

## 37. Example: Safe CLOB Reader for Audit Detail

```java
public final class AuditTrailRepository {
    private final DataSource dataSource;

    public AuditTrailRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource);
    }

    public void writeSerializedChanges(long auditId, Writer writer) throws SQLException, IOException {
        String sql = """
                select serialized_changes
                from audit_trail_payload
                where audit_trail_id = ?
                """;

        try (Connection c = dataSource.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, auditId);

            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    throw new NoSuchElementException("Audit payload not found: " + auditId);
                }

                Clob clob = rs.getClob(1);
                try {
                    try (Reader reader = clob.getCharacterStream()) {
                        reader.transferTo(writer);
                    }
                } finally {
                    clob.free();
                }
            }
        }
    }
}
```

---

## 38. Example: Insert CLOB Audit Payload Safely

```java
public void insertAuditPayload(
        Connection c,
        long auditId,
        Reader metadata,
        Reader serializedChanges,
        Reader fullText
) throws SQLException {
    String sql = """
            insert into audit_trail_payload
                (audit_trail_id, metadata, serialized_changes, full_text)
            values
                (?, ?, ?, ?)
            """;

    try (PreparedStatement ps = c.prepareStatement(sql)) {
        ps.setLong(1, auditId);
        ps.setCharacterStream(2, metadata);
        ps.setCharacterStream(3, serializedChanges);
        ps.setCharacterStream(4, fullText);
        ps.executeUpdate();
    }
}
```

Catatan:

- `Connection` diterima dari caller karena insert audit header dan payload mungkin harus satu transaction.
- Reader ownership harus jelas: caller membuka dan menutup Reader, atau method ini yang membuka Reader.
- Jangan commit di method kecil ini jika transaction boundary ada di service.

---

## 39. Example: Transactional Insert Metadata + Payload

```java
public long createAuditEntry(AuditEntry entry, AuditPayload payload) throws SQLException, IOException {
    try (Connection c = dataSource.getConnection()) {
        boolean oldAutoCommit = c.getAutoCommit();
        c.setAutoCommit(false);

        try {
            long auditId = insertAuditHeader(c, entry);

            try (Reader metadata = new StringReader(payload.metadataJson());
                 Reader changes = new StringReader(payload.serializedChangesJson());
                 Reader fullText = new StringReader(payload.fullText())) {
                insertAuditPayload(c, auditId, metadata, changes, fullText);
            }

            c.commit();
            return auditId;
        } catch (Exception e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(oldAutoCommit);
        }
    }
}
```

Catatan:

- Ini contoh untuk payload yang sudah berupa String.
- Untuk payload besar dari file/stream, hindari membangun String penuh.
- Reset state connection penting, walau pool seperti HikariCP juga punya mekanisme reset. Code eksplisit tetap membuat ownership lebih jelas.

---

## 40. Anti-Pattern Catalog

### 40.1 Returning Raw LOB

```java
public Blob findContent(long id) { ... }
```

Masalah:

```text
Caller tidak tahu connection/session/transaction dependency.
```

---

### 40.2 Returning JDBC-backed Stream

```java
public InputStream openContent(long id) { ... }
```

Jika stream berasal dari `ResultSet`, ini rawan karena connection mungkin sudah close atau harus ditahan tidak jelas.

---

### 40.3 `SELECT *` on LOB Table

```sql
SELECT * FROM audit_trail
```

Masalah:

```text
Payload besar ikut terbaca tanpa sadar.
```

---

### 40.4 Materialize Large Content

```java
String fullText = rs.getString("full_text");
byte[] content = rs.getBytes("content");
```

Masalah:

```text
Heap blow-up.
```

---

### 40.5 One Shared Pool for Everything

```text
OLTP query + report export + file download + batch import all use same pool.
```

Masalah:

```text
Slow LOB operation can starve normal request.
```

---

### 40.6 Logging LOB Content

```java
log.info("payload={}", payload);
```

Masalah:

- PII leakage,
- log explosion,
- compliance issue,
- cost.

---

### 40.7 Storing Queryable Domain State Only in CLOB JSON

Masalah:

```text
Application cannot query efficiently, validate relationally, or index properly.
```

---

### 40.8 Updating Large LOB Frequently

Masalah:

- write amplification,
- replication lag,
- undo/redo/WAL growth,
- storage fragmentation.

---

## 41. Review Checklist untuk LOB Design

Gunakan checklist ini saat review desain.

### 41.1 Data Characteristic

```text
[ ] Berapa ukuran rata-rata payload?
[ ] Berapa ukuran P95/P99 payload?
[ ] Apakah ada maximum size enforced?
[ ] Binary atau character?
[ ] Immutable atau sering di-update?
[ ] Sering dibaca atau hanya evidence?
[ ] Perlu di-query berdasarkan isi payload?
[ ] Retention berapa lama?
```

### 41.2 Storage Decision

```text
[ ] Harus di database atau bisa object storage?
[ ] Apakah perlu atomic dengan metadata?
[ ] Apakah backup DB boleh membesar karena payload?
[ ] Apakah restore time masih acceptable?
[ ] Apakah lifecycle payload sama dengan metadata?
```

### 41.3 JDBC Access

```text
[ ] Apakah query listing menghindari LOB column?
[ ] Apakah large payload dibaca via stream?
[ ] Apakah `Blob/Clob/SQLXML.free()` dipanggil?
[ ] Apakah stream tidak keluar dari connection scope?
[ ] Apakah connection tidak ditahan oleh slow client?
[ ] Apakah pool untuk LOB perlu dipisah?
```

### 41.4 Performance

```text
[ ] Ada index untuk metadata query?
[ ] Ada full-text/search projection jika perlu search isi payload?
[ ] Ada concurrency limit untuk upload/download/export?
[ ] Ada monitoring query latency dan pool usage?
[ ] Ada purge/archival strategy?
```

### 41.5 Security & Compliance

```text
[ ] Payload tidak dilog mentah?
[ ] PII/secrets direduksi atau dilindungi?
[ ] Ada checksum/integrity metadata?
[ ] Ada content type validation?
[ ] Ada malware scan jika file upload?
[ ] Ada authorization untuk payload access?
[ ] Ada retention/legal hold policy?
```

---

## 42. Operational Metrics untuk LOB

Monitor minimal:

```text
- average/P95/P99 LOB read duration
- average/P95/P99 LOB write duration
- LOB payload size distribution
- active DB connections during downloads
- pool pending threads
- pool usage time
- DB IO
- redo/WAL/binlog volume
- replication lag
- LOB segment/table size
- temporary LOB usage where available
- failed downloads/uploads
- client abort count
- purge duration
```

Metric yang sering dilupakan:

```text
connection occupancy duration during streaming
```

Bukan hanya query execution time.

Untuk streaming response, query mungkin cepat menghasilkan row, tetapi connection tetap tertahan selama content ditransfer.

---

## 43. Failure Modes

### 43.1 Client Abort During Download

Client menutup koneksi HTTP.

Efek:

- output stream error,
- JDBC stream harus ditutup,
- connection harus dikembalikan,
- partial download tidak otomatis retry-safe.

Pattern:

```java
try {
    repository.streamContent(id, response.getOutputStream());
} catch (IOException clientAbort) {
    // classify carefully, often not server bug
}
```

Pastikan try-with-resources/finally tetap membersihkan JDBC resource.

---

### 43.2 DB Connection Lost Mid-Stream

Efek:

- partial response,
- corrupted/incomplete file,
- retry harus dari awal kecuali mendukung range/resume,
- connection mungkin marked broken by pool.

Untuk file besar, pertimbangkan:

- checksum,
- content length,
- HTTP range support,
- object storage.

---

### 43.3 OOM from Materialization

Gejala:

- heap spike,
- GC overhead,
- OOM,
- pod restart,
- pool connections dropped,
- partial transaction.

Mitigasi:

- stream,
- enforce size limit,
- avoid `getBytes/getString` for unbounded LOB,
- heap dump analysis,
- endpoint concurrency limit.

---

### 43.4 Pool Exhaustion from Slow LOB

Gejala:

- Hikari timeout acquiring connection,
- active connections high,
- pending threads high,
- DB CPU maybe low,
- slow clients/downloads active.

Mitigasi:

- separate pool,
- limit concurrent downloads,
- object storage,
- stream staging,
- shorter request timeout,
- protect OLTP pool.

---

### 43.5 Storage Not Reclaimed After Delete

Gejala:

- rows deleted,
- DB free storage unchanged,
- LOB segment still large.

Possible explanation:

- allocated space reusable but not returned to filesystem/cloud volume,
- high water mark,
- LOB segment fragmentation,
- undo retention,
- recycle bin,
- vacuum/shrink/reorg needed,
- tablespace datafile not resized.

Mitigation depends on DB.

---

## 44. Top 1% Mental Models

### 44.1 LOB Is a Resource, Not a Value

```text
String/byte[] = value in Java heap.
Blob/Clob     = JDBC resource that may reference database-side state.
```

---

### 44.2 Streaming Saves Heap but Consumes Time-Bound Resources

```text
Streaming reduces memory pressure,
but connection/session/cursor/transaction stays occupied.
```

---

### 44.3 Query Shape Beats Driver Tuning

Before tuning fetch size/chunk size, fix:

```text
SELECT list
query boundary
list vs detail separation
metadata projection
payload access pattern
```

---

### 44.4 Database LOB Simplifies Atomicity but Expands DB Blast Radius

Storing payload in DB gives:

```text
ACID simplicity
```

But costs:

```text
DB storage, backup, replication, IO, purge, restore, pool occupancy
```

---

### 44.5 Object Storage Reduces DB Pressure but Requires Lifecycle State

Moving payload out of DB gives:

```text
scalable large object handling
```

But requires:

```text
orphan cleanup, status machine, checksum, authorization, consistency handling
```

---

## 45. Practical Engineering Rules

1. Never use `SELECT *` on LOB-heavy tables.
2. Separate metadata query from payload query.
3. Use `getBinaryStream()` / `getCharacterStream()` for unbounded large data.
4. Do not return `Blob`, `Clob`, `ResultSet`, or JDBC-backed streams outside repository scope.
5. Call `free()` on `Blob`, `Clob`, `NClob`, and `SQLXML` when obtained explicitly.
6. Do not let slow client downloads monopolize OLTP pool.
7. Consider object storage for large binary attachments.
8. Store checksum, size, content type, and creation metadata.
9. Enforce payload size limit at boundary.
10. Avoid logging raw LOB content.
11. Design retention and purge from day one.
12. Test with realistic payload sizes, not 1KB samples.
13. Monitor connection occupancy during LOB streaming.
14. Treat LOB schema as an operational decision, not just a column type.

---

## 46. Mini Case Study: Audit CLOB Causing Slow Listing

### Situation

A regulatory system has audit table:

```text
AUDIT_TRAIL
- ID
- MODULE_ID
- ACTIVITY
- CREATED_DATE_TIME
- USER_ID
- META_DATA CLOB
- SERIALIZED_CHANGES CLOB
- FULL_TEXT CLOB
```

UI listing shows:

```text
module, activity, date, user
```

But backend query uses:

```sql
SELECT *
FROM audit_trail
WHERE module_id = ?
ORDER BY created_date_time DESC
FETCH FIRST 50 ROWS ONLY
```

### Symptoms

- listing slow,
- DB IO high,
- app memory spikes,
- network transfer large,
- GC increases,
- users complain audit screen times out.

### Root Cause

The list query fetches CLOB fields that the UI does not need.

### Fix

Use projection:

```sql
SELECT id, module_id, activity, created_date_time, user_id
FROM audit_trail
WHERE module_id = ?
ORDER BY created_date_time DESC
FETCH FIRST 50 ROWS ONLY
```

Then detail endpoint:

```sql
SELECT metadata, serialized_changes, full_text
FROM audit_trail
WHERE id = ?
```

### Deeper Fix

Split table:

```text
AUDIT_TRAIL_HEADER
AUDIT_TRAIL_PAYLOAD
```

Optional:

- partition by date,
- archive old payload,
- create search projection,
- use full-text index/search engine for `full_text`.

### Lesson

```text
LOB performance bugs often start as query-shape bugs.
```

---

## 47. Mini Case Study: Pool Exhausted by File Download

### Situation

Application stores PDFs as BLOB in database.

Endpoint:

```text
GET /documents/{id}/download
```

Streams BLOB directly from DB to HTTP response.

Hikari pool:

```text
maximumPoolSize = 20
```

During office hours, 20 users download large files over slow connection.

### Symptoms

- normal API requests fail with connection timeout,
- Hikari active = 20,
- Hikari pending > 0,
- DB CPU moderate,
- application threads blocked.

### Root Cause

Slow downloads hold all DB connections.

### Fix Options

1. Move document binary to object storage.
2. Use dedicated LOB pool with small max size.
3. Limit concurrent downloads.
4. Stage file before download.
5. Add backpressure and clear user-facing error.

### Lesson

```text
Streaming can protect heap while still destroying pool availability.
```

---

## 48. Exercise

### Exercise 1

Given table:

```sql
CREATE TABLE case_document (
    id BIGINT PRIMARY KEY,
    case_id BIGINT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    content BLOB NOT NULL,
    created_at TIMESTAMP NOT NULL
);
```

Design two repository methods:

1. `listDocuments(caseId)` returning metadata only.
2. `streamDocumentContent(documentId, outputStream)` streaming BLOB safely.

Checklist:

```text
[ ] No SELECT *
[ ] No byte[] for content
[ ] Stream closed
[ ] JDBC resources closed
[ ] Not returning InputStream from method
```

---

### Exercise 2

You have audit CLOB payload averaging 100KB, P99 5MB. Listing endpoint returns 100 rows.

Question:

```text
Apa risiko jika listing query mengambil CLOB?
```

Expected reasoning:

- 100 * up to MB payload can be transferred,
- app may materialize CLOB,
- UI does not need payload,
- pool connection held longer,
- DB IO and network rise,
- pagination becomes expensive,
- use metadata projection and detail endpoint.

---

### Exercise 3

A team wants to move BLOB from DB to object storage.

Design lifecycle states.

Possible answer:

```text
UPLOADING
AVAILABLE
FAILED
DELETING
DELETED
QUARANTINED
```

Also define cleanup job:

```text
- remove orphan object without metadata
- mark stale UPLOADING as FAILED
- delete object for DELETED metadata after retention
- verify checksum periodically if required
```

---

## 49. Summary

LOB di JDBC adalah salah satu area di mana API terlihat sederhana tetapi konsekuensi production-nya besar.

Hal terpenting:

```text
Blob/Clob/NClob/SQLXML are not just larger values.
They may be database-backed resources with transaction/session lifecycle.
```

Untuk engineer level tinggi, pertanyaan utamanya bukan hanya:

```text
Bagaimana cara membaca BLOB/CLOB?
```

Tetapi:

```text
Apakah payload ini seharusnya dibaca di query ini?
Apakah harus berada di database?
Apakah harus di-stream?
Berapa lama connection tertahan?
Bagaimana retention/purge/backup/replication terdampak?
Bagaimana failure saat client lambat atau koneksi putus?
Bagaimana mencegah LOB mengganggu OLTP path?
```

Jika kamu bisa menjawab pertanyaan-pertanyaan itu, kamu tidak hanya “bisa memakai JDBC LOB API”; kamu mulai berpikir sebagai engineer yang memahami application/database boundary secara production-grade.

---

## 50. Referensi

- Java SE JDBC API: `java.sql.Blob`, `java.sql.Clob`, `java.sql.NClob`, `java.sql.SQLXML`, `ResultSet`, `PreparedStatement`.
- Oracle JDBC Developer's Guide: Java streams in JDBC and LOB handling.
- PostgreSQL JDBC documentation: binary data and large object API.
- MySQL Connector/J Developer Guide: JDBC driver behavior and BLOB/CLOB handling.
- Database vendor documentation for LOB storage, temporary LOB, full-text indexing, and storage maintenance.

---

## 51. Koneksi ke Part Berikutnya

Part ini membahas LOB sebagai data besar dan resource yang harus dikelola hati-hati.

Part berikutnya akan membahas:

```text
Part 014 — Metadata APIs: DatabaseMetaData, ResultSetMetaData, ParameterMetaData
```

Di sana kita akan belajar bagaimana JDBC dapat membaca informasi tentang database, table, column, capability, result shape, dan parameter metadata. Ini penting untuk dynamic SQL tooling, migration validation, code generation, diagnostics, dan compatibility checks.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 012 — Batch Operations: Throughput, Atomicity, and Driver Rewriting](./learn-java-sql-jdbc-hikaricp-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 014 — Metadata APIs: `DatabaseMetaData`, `ResultSetMetaData`, `ParameterMetaData`](./learn-java-sql-jdbc-hikaricp-part-014.md)
