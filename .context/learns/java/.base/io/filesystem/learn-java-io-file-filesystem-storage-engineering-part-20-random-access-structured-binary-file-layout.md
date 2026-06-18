# learn-java-io-file-filesystem-storage-engineering

## Part 20 — Random Access and Structured Binary File Layout

> Target Java: 8 sampai 25  
> Fokus utama: `SeekableByteChannel`, `FileChannel`, offset-based I/O, fixed/variable record layout, header/body/footer, magic number, versioning, checksum, appendable binary format, corruption detection, dan strategi evolusi format file.

---

## 1. Posisi Part Ini Dalam Seri

Sampai Part 19, kita sudah membangun fondasi besar:

1. path bukan string biasa;
2. file existence tidak boleh dipakai sebagai lock;
3. create/copy/move/delete punya semantics dan race condition;
4. read/write harus dilihat dari sisi memory, charset, flush, durability;
5. atomic update butuh temp file, force, atomic move;
6. traversal, symlink, permission, capacity, watch service, locking, dan mmap punya batasan nyata.

Part ini masuk ke level berikutnya: **file sebagai struktur data persistent**.

Di level pemula, file biasanya diperlakukan sebagai:

```text
text line 1
text line 2
text line 3
```

atau:

```text
JSON blob besar
CSV besar
XML besar
```

Di level advanced, file bisa menjadi:

```text
+----------------------+  offset 0
| header               |
+----------------------+  offset 128
| record region         |
| record region         |
| record region         |
+----------------------+  offset N
| index / footer        |
+----------------------+
```

Atau:

```text
+---------+---------+---------+---------+
| magic   | version | flags   | checksum|
+---------+---------+---------+---------+
| record 0                            ...|
| record 1                            ...|
| record 2                            ...|
+----------------------------------------+
```

Artinya, kita tidak hanya membaca file dari awal sampai akhir. Kita bisa:

- membaca byte pada offset tertentu;
- menulis record ke posisi tertentu;
- update header setelah body selesai ditulis;
- truncate file ke posisi terakhir yang valid;
- rebuild index dari log;
- mendeteksi format yang salah;
- mendeteksi partial write;
- mendukung format versioning;
- menjaga backward compatibility.

Inilah fondasi untuk memahami:

- database storage engine sederhana;
- write-ahead log;
- checkpoint file;
- binary index;
- file cache;
- embedded data store;
- custom archive;
- durable queue;
- append-only event file;
- corruption-tolerant import/export file.

---

## 2. Mental Model: File Sebagai Array Byte Beralamat

Secara konseptual, file bisa dipandang sebagai array byte yang panjangnya berubah:

```text
offset:  0   1   2   3   4   5   6   7 ...
byte:   [A] [B] [C] [D] [E] [F] [G] [H] ...
```

`offset` adalah posisi byte dari awal file. Offset pertama adalah `0`, bukan `1`.

Jika file punya ukuran 100 byte:

```text
valid byte offsets: 0 sampai 99
file size:          100
EOF position:       100
```

EOF bukan byte. EOF adalah posisi setelah byte terakhir.

Contoh:

```text
file size = 5

index:   0   1   2   3   4   5
byte:   [h] [e] [l] [l] [o] EOF
```

Membaca dari offset `0` menghasilkan `h`.  
Membaca dari offset `4` menghasilkan `o`.  
Membaca dari offset `5` berarti mulai dari EOF.

Dalam Java, model ini direpresentasikan oleh API seperti:

- `SeekableByteChannel.position()`
- `SeekableByteChannel.position(long newPosition)`
- `SeekableByteChannel.size()`
- `SeekableByteChannel.truncate(long size)`
- `FileChannel.read(ByteBuffer dst, long position)`
- `FileChannel.write(ByteBuffer src, long position)`

`FileChannel` adalah `SeekableByteChannel` yang terhubung ke file. Ia punya current position yang bisa dibaca dan diubah. File-nya sendiri adalah sequence byte variable-length; ukuran file bisa bertambah jika byte ditulis melewati ukuran saat ini, dan bisa mengecil jika di-truncate.

---

## 3. Sequential I/O vs Random Access I/O

### 3.1 Sequential I/O

Sequential I/O membaca atau menulis dari posisi saat ini lalu posisi channel bergerak maju.

```java
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer buf = ByteBuffer.allocate(4096);
    while (ch.read(buf) != -1) {
        buf.flip();
        // process bytes
        buf.clear();
    }
}
```

Mental model:

```text
position starts at 0
read 4096 bytes -> position becomes 4096
read 4096 bytes -> position becomes 8192
read 4096 bytes -> position becomes 12288
...
```

Ini cocok untuk:

- membaca file dari awal ke akhir;
- streaming parser;
- import file;
- copy file;
- checksum file;
- append-only processing.

### 3.2 Random Access I/O

Random access I/O membaca atau menulis di offset tertentu tanpa harus membaca semua byte sebelumnya.

```java
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer header = ByteBuffer.allocate(16);
    ch.read(header, 0); // baca 16 byte dari offset 0

    ByteBuffer record = ByteBuffer.allocate(128);
    ch.read(record, 1024); // baca record dari offset 1024
}
```

Mental model:

```text
read offset 0      -> header
read offset 1024   -> record tertentu
read offset 4096   -> block tertentu
```

Ini cocok untuk:

- fixed-length records;
- index file;
- page file;
- embedded storage;
- seek table;
- binary format dengan header/footer;
- patch/update record tertentu;
- lookup by offset.

### 3.3 Key Distinction

Ada dua bentuk operasi di `FileChannel`:

```java
int read(ByteBuffer dst)
int write(ByteBuffer src)
```

Operasi ini memakai dan mengubah **current position** channel.

Sedangkan:

```java
int read(ByteBuffer dst, long position)
int write(ByteBuffer src, long position)
```

Operasi ini memakai **explicit position**. Biasanya tidak mengubah current position channel.

Konsekuensinya sangat besar untuk concurrency.

Jika beberapa thread memakai satu channel dan semua memakai current position, posisi channel menjadi shared mutable state.

Jika beberapa thread memakai explicit offset, desainnya bisa jauh lebih deterministik, selama region byte yang ditulis tidak overlap.

---

## 4. API Utama: SeekableByteChannel

`SeekableByteChannel` adalah interface yang memperluas konsep byte channel dengan kemampuan seek.

Operasi penting:

```java
int read(ByteBuffer dst) throws IOException;
int write(ByteBuffer src) throws IOException;
long position() throws IOException;
SeekableByteChannel position(long newPosition) throws IOException;
long size() throws IOException;
SeekableByteChannel truncate(long size) throws IOException;
```

### 4.1 Membuka SeekableByteChannel dari Files

```java
Path path = Paths.get("data.bin");

try (SeekableByteChannel ch = Files.newByteChannel(
        path,
        EnumSet.of(StandardOpenOption.READ))) {

    ByteBuffer buf = ByteBuffer.allocate(128);
    ch.position(256);
    int n = ch.read(buf);
}
```

Untuk Java 11+ kita bisa memakai:

```java
Path path = Path.of("data.bin");
```

Namun untuk kompatibilitas Java 8, gunakan:

```java
Path path = Paths.get("data.bin");
```

### 4.2 Position Lebih Besar dari Size

Ini legal:

```java
ch.position(1_000_000L);
```

Jika file hanya 100 byte, mengatur posisi ke 1.000.000 tidak otomatis memperbesar file. File baru membesar jika dilakukan write pada posisi tersebut.

Jika write dilakukan jauh melewati EOF, area antara EOF lama dan data baru menjadi gap. Nilai byte di gap bergantung pada sistem/filesystem/provider. Pada banyak filesystem lokal, gap bisa menjadi sparse region yang dibaca sebagai nol, tetapi portable Java code tidak boleh membuat asumsi terlalu jauh tanpa memahami provider dan filesystem.

Mental model:

```text
initial file size: 100
set position:      1,000,000
file size:         tetap 100
write 10 bytes
file size:         1,000,010
region 100..999,999 = gap / unspecified by abstraction
```

### 4.3 Truncate

`truncate(size)` memotong file ke ukuran tertentu.

```java
try (SeekableByteChannel ch = Files.newByteChannel(
        path,
        EnumSet.of(StandardOpenOption.WRITE))) {
    ch.truncate(1024);
}
```

Jika ukuran baru lebih kecil dari ukuran file saat ini, byte setelah ukuran baru dibuang.

Jika ukuran baru lebih besar atau sama dengan ukuran file saat ini, file biasanya tidak berubah.

Jika posisi channel lebih besar dari ukuran baru, posisi channel disesuaikan menjadi ukuran baru.

Mental model:

```text
before:
size = 10_000
position = 8_000

truncate(4_000)

after:
size = 4_000
position = 4_000
```

---

## 5. API Utama: FileChannel

`FileChannel` adalah channel khusus file yang lebih kaya dari `SeekableByteChannel`.

Ia mendukung:

- seekable read/write;
- positional read/write;
- memory mapping;
- file locking;
- transfer to/from channel lain;
- force/sync to storage;
- truncate;
- size;
- current position.

### 5.1 Membuka FileChannel

```java
try (FileChannel ch = FileChannel.open(
        path,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {
    // use channel
}
```

Untuk membuat jika belum ada:

```java
try (FileChannel ch = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {
    // use channel
}
```

Untuk membuat baru dan gagal jika sudah ada:

```java
try (FileChannel ch = FileChannel.open(
        path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {
    // use channel
}
```

### 5.2 Current Position vs Explicit Position

```java
ByteBuffer buf = ByteBuffer.allocate(8);

ch.position(128);
ch.read(buf);        // uses current position, advances it

ch.read(buf, 1024);  // explicit offset, generally does not affect current position
```

Untuk file format, explicit offset sering lebih aman karena:

- lebih jelas;
- lebih mudah dites;
- tidak tergantung state channel sebelumnya;
- lebih aman dalam desain multi-thread reader;
- lebih mudah membuat invariant.

### 5.3 Partial Read dan Partial Write

Jangan berasumsi bahwa satu `read` mengisi buffer sepenuhnya atau satu `write` menulis seluruh buffer.

Kode buruk:

```java
ByteBuffer buf = ByteBuffer.allocate(128);
ch.read(buf, offset); // tidak dijamin membaca 128 byte
```

Kode lebih benar:

```java
static void readFully(FileChannel ch, ByteBuffer dst, long offset) throws IOException {
    long pos = offset;
    while (dst.hasRemaining()) {
        int n = ch.read(dst, pos);
        if (n == -1) {
            throw new EOFException("Unexpected EOF at offset " + pos);
        }
        pos += n;
    }
}
```

Untuk write:

```java
static void writeFully(FileChannel ch, ByteBuffer src, long offset) throws IOException {
    long pos = offset;
    while (src.hasRemaining()) {
        int n = ch.write(src, pos);
        if (n == 0) {
            // For FileChannel this usually should not spin forever, but keep guard if adapting.
            Thread.yield();
        }
        pos += n;
    }
}
```

Untuk production code, hindari infinite loop tanpa guard jika channel non-standard/provider custom.

---

## 6. ByteBuffer Refresher Khusus File Layout

Kita tidak akan mengulang seluruh seri buffer, tetapi untuk file layout, beberapa konsep wajib dipakai dengan benar.

### 6.1 Position, Limit, Capacity

`ByteBuffer` punya:

```text
capacity = ukuran maksimum buffer
position = posisi baca/tulis berikutnya
limit    = batas baca/tulis saat ini
```

Saat menulis data ke buffer:

```java
ByteBuffer b = ByteBuffer.allocate(16);
b.putInt(123);
b.putLong(456L);
```

Setelah `put`, position maju.

Sebelum buffer dibaca oleh channel, panggil:

```java
b.flip();
```

Karena channel membaca dari posisi buffer sampai limit.

### 6.2 Endianness

Binary format harus menentukan byte order.

```java
ByteBuffer buf = ByteBuffer.allocate(16)
        .order(ByteOrder.BIG_ENDIAN);
```

Atau:

```java
ByteBuffer buf = ByteBuffer.allocate(16)
        .order(ByteOrder.LITTLE_ENDIAN);
```

Jangan biarkan byte order menjadi asumsi implisit.

Rekomendasi:

- pilih satu byte order untuk format;
- tulis di spesifikasi file format;
- biasanya big-endian umum untuk network/protocol style;
- little-endian umum untuk beberapa format binary modern karena CPU mainstream;
- yang penting: konsisten dan eksplisit.

### 6.3 Absolute Get/Put

Untuk struktur fixed layout, absolute get/put sangat berguna:

```java
ByteBuffer header = ByteBuffer.allocate(64).order(ByteOrder.BIG_ENDIAN);
header.putInt(0, MAGIC);
header.putShort(4, VERSION);
header.putLong(8, recordCount);
```

Keunggulan:

- tidak tergantung urutan `put`;
- field offset jelas;
- mudah update field tertentu;
- cocok untuk header layout.

Kelemahan:

- offset harus disiplin;
- butuh konstanta field offset;
- jika layout berubah, migrasi harus hati-hati.

---

## 7. Designing a Binary File Format

Binary file format yang sehat tidak dimulai dari kode. Ia dimulai dari kontrak.

Pertanyaan desain:

1. Bagaimana reader mengenali bahwa ini file yang benar?
2. Versi format berapa yang dipakai?
3. Apakah endianness eksplisit?
4. Apakah ukuran header fixed atau variable?
5. Apakah record fixed-length atau variable-length?
6. Apakah ada checksum?
7. Apakah file bisa dibaca streaming?
8. Apakah file bisa random access?
9. Apakah file bisa diappend?
10. Bagaimana mendeteksi partial write?
11. Bagaimana migrasi dari versi lama ke versi baru?
12. Apa yang terjadi jika process crash saat menulis?
13. Apakah file bisa dimodifikasi in-place?
14. Apakah metadata disimpan di header, footer, manifest, atau index terpisah?

Top 1% engineer tidak mulai dari `putInt()`. Mereka mulai dari invariant.

---

## 8. Magic Number

Magic number adalah signature awal file untuk mengenali format.

Contoh:

```text
Offset  Size  Field
0       4     Magic = 0x4A465346  // "JFSF" = Java File Storage Format
```

Kode:

```java
static final int MAGIC = 0x4A465346; // 'J' 'F' 'S' 'F'
```

Saat membaca:

```java
int magic = header.getInt(0);
if (magic != MAGIC) {
    throw new IOException("Invalid file magic");
}
```

Kenapa penting?

Tanpa magic number, aplikasi bisa:

- membaca file salah sebagai file benar;
- salah interpretasi byte;
- memproses format lama sebagai format baru;
- menghasilkan error jauh di tengah parsing;
- lebih sulit troubleshooting.

Magic number harus berada sangat awal agar validasi cepat.

---

## 9. Versioning

Binary format hampir pasti berubah.

Versi bisa disimpan sebagai:

```text
major version
minor version
```

Contoh:

```text
Offset  Size  Field
4       2     Major version
6       2     Minor version
```

Mental model:

- major berubah jika breaking change;
- minor berubah jika backward-compatible addition;
- reader harus eksplisit mendukung versi tertentu;
- jangan silently parse versi yang tidak dikenal.

Contoh:

```java
int major = Short.toUnsignedInt(header.getShort(4));
int minor = Short.toUnsignedInt(header.getShort(6));

if (major != 1) {
    throw new IOException("Unsupported major version: " + major);
}
```

Backward compatibility strategy:

```text
Reader v2 can read file v1 and v2.
Reader v1 cannot necessarily read file v2.
```

Jika ingin old reader menolak file baru dengan jelas, update major atau feature flags.

---

## 10. Header Layout

Header adalah metadata awal file.

Contoh fixed 64-byte header:

```text
Offset  Size  Field
0       4     magic
4       2     majorVersion
6       2     minorVersion
8       8     fileLength
16      8     recordCount
24      8     indexOffset
32      8     indexLength
40      4     headerCrc32
44      4     flags
48      16    reserved
```

Total: 64 byte.

### 10.1 Kenapa Header Fixed Size?

Keunggulan:

- gampang random access;
- gampang update field tertentu;
- reader bisa langsung tahu lokasi body;
- mudah menjaga compatibility dengan reserved field.

Kelemahan:

- perlu perencanaan;
- reserved space bisa terbuang;
- terlalu kecil bisa menyulitkan evolusi.

### 10.2 Reserved Bytes

Reserved bytes adalah investasi compatibility.

```text
Offset  Size  Field
48      16    reserved, must be zero
```

Rule:

- writer versi sekarang menulis zero;
- reader versi sekarang memastikan zero atau mengabaikan sesuai policy;
- versi masa depan bisa memakai sebagian reserved field.

---

## 11. Fixed-Length Records

Fixed-length record berarti setiap record punya ukuran sama.

Contoh record 32 byte:

```text
Offset within record  Size  Field
0                     8     id
8                     8     createdAtEpochMillis
16                    4     status
20                    4     payloadOffset
24                    4     payloadLength
28                    4     recordCrc32
```

Jika header 64 byte dan record size 32 byte:

```text
record 0 offset = 64 + (0 * 32) = 64
record 1 offset = 64 + (1 * 32) = 96
record 2 offset = 64 + (2 * 32) = 128
record N offset = 64 + (N * 32)
```

Kode:

```java
static final int HEADER_SIZE = 64;
static final int RECORD_SIZE = 32;

static long recordOffset(long index) {
    return HEADER_SIZE + Math.multiplyExact(index, RECORD_SIZE);
}
```

Gunakan `Math.multiplyExact` agar overflow terdeteksi.

### 11.1 Keunggulan Fixed-Length Records

- random access sangat mudah;
- update record tertentu mudah;
- index implisit cukup dari nomor record;
- binary search bisa dilakukan jika record sorted;
- cocok untuk status table, bitmap-like table, offset table.

### 11.2 Kelemahan Fixed-Length Records

- boros jika payload variable-length;
- sulit menyimpan string panjang;
- update field variable-length tidak mudah;
- schema evolution perlu reserved field atau external payload region.

---

## 12. Variable-Length Records

Variable-length record punya panjang berbeda-beda.

Format umum:

```text
+----------------+----------------+----------------+
| length (4)     | payload (N)    | checksum (4)   |
+----------------+----------------+----------------+
```

Atau:

```text
+--------+---------+---------+----------+----------+
| type   | flags   | length  | payload  | checksum |
+--------+---------+---------+----------+----------+
```

Keunggulan:

- efisien untuk payload bervariasi;
- cocok untuk event log;
- cocok untuk append-only file;
- mudah menambahkan record type baru.

Kelemahan:

- random access butuh index;
- corrupt length bisa membuat parser tersesat;
- perlu max record size;
- perlu checksum/framing kuat;
- update in-place sulit jika ukuran berubah.

---

## 13. Record Framing

Framing adalah cara reader tahu batas record.

Tanpa framing, byte stream sulit dipulihkan setelah error.

Contoh framing:

```text
Offset  Size  Field
0       4     recordMagic
4       2     recordType
6       2     flags
8       4     payloadLength
12      N     payload
12+N    4     crc32
```

Kenapa record magic berguna?

Jika file corrupt di tengah, scanner bisa mencari magic berikutnya. Ini tidak sempurna, karena byte payload bisa kebetulan sama dengan magic, tetapi membantu recovery.

Untuk format yang lebih kuat, gunakan:

- record magic;
- length;
- checksum;
- monotonic sequence number;
- optional footer marker.

---

## 14. Footer Layout

Footer berada di akhir file.

Cocok untuk format yang ditulis streaming lalu metadata akhirnya baru diketahui setelah selesai.

Contoh:

```text
+--------------------+
| header             |
+--------------------+
| records            |
+--------------------+
| index              |
+--------------------+
| footer             |
+--------------------+
```

Footer bisa menyimpan:

- index offset;
- index length;
- record count;
- file checksum;
- creation timestamp;
- writer version;
- completion marker.

### 14.1 Completion Marker

Completion marker membantu membedakan file lengkap vs file partial.

```text
footer magic = 0x454E4421 // "END!"
```

Saat reader membuka file:

1. baca header;
2. baca footer dari akhir file;
3. validasi footer magic;
4. validasi file length;
5. validasi checksum/index.

Jika footer tidak ada, file mungkin belum selesai ditulis atau crash saat write.

---

## 15. Header vs Footer vs Manifest

### 15.1 Header

Cocok untuk metadata yang perlu dibaca cepat di awal:

- magic;
- version;
- flags;
- minimal layout;
- pointer ke index jika sudah diketahui.

### 15.2 Footer

Cocok untuk metadata yang baru diketahui setelah body selesai:

- final record count;
- final checksum;
- index offset;
- compressed size;
- completion marker.

### 15.3 Manifest File Terpisah

Cocok untuk multi-file dataset:

```text
/export-2026-06-18/
  manifest.json
  data-00001.bin
  data-00002.bin
  index.bin
```

Manifest bisa menyimpan:

- list file;
- hash setiap file;
- schema version;
- generatedBy;
- createdAt;
- compatibility info.

Trade-off:

- lebih mudah dibaca manusia jika JSON/YAML;
- tetapi multi-file atomicity lebih sulit;
- perlu publish protocol agar consumer tidak membaca dataset setengah jadi.

---

## 16. Structured Binary Example: Fixed Record Store

Kita buat contoh sederhana: file menyimpan fixed-length user status records.

### 16.1 Format

Header 64 byte:

```text
Offset  Size  Field
0       4     magic = "UST1"
4       2     major = 1
6       2     minor = 0
8       8     recordCount
16      8     recordSize = 32
24      8     createdAtEpochMillis
32      4     flags
36      4     headerCrc32
40      24    reserved zero
```

Record 32 byte:

```text
Offset  Size  Field
0       8     userId
8       8     updatedAtEpochMillis
16      4     status
20      4     score
24      4     flags
28      4     recordCrc32
```

### 16.2 Constants

```java
static final int MAGIC = 0x55535431; // 'U' 'S' 'T' '1'
static final short MAJOR = 1;
static final short MINOR = 0;
static final int HEADER_SIZE = 64;
static final int RECORD_SIZE = 32;

static final int H_MAGIC = 0;
static final int H_MAJOR = 4;
static final int H_MINOR = 6;
static final int H_RECORD_COUNT = 8;
static final int H_RECORD_SIZE = 16;
static final int H_CREATED_AT = 24;
static final int H_FLAGS = 32;
static final int H_CRC32 = 36;

static final int R_USER_ID = 0;
static final int R_UPDATED_AT = 8;
static final int R_STATUS = 16;
static final int R_SCORE = 20;
static final int R_FLAGS = 24;
static final int R_CRC32 = 28;
```

### 16.3 Header Writer

```java
static ByteBuffer buildHeader(long recordCount, long createdAtMillis) {
    ByteBuffer header = ByteBuffer.allocate(HEADER_SIZE).order(ByteOrder.BIG_ENDIAN);

    header.putInt(H_MAGIC, MAGIC);
    header.putShort(H_MAJOR, MAJOR);
    header.putShort(H_MINOR, MINOR);
    header.putLong(H_RECORD_COUNT, recordCount);
    header.putLong(H_RECORD_SIZE, RECORD_SIZE);
    header.putLong(H_CREATED_AT, createdAtMillis);
    header.putInt(H_FLAGS, 0);

    int crc = crc32(header, 0, H_CRC32); // checksum bytes before crc field
    header.putInt(H_CRC32, crc);

    header.position(0);
    header.limit(HEADER_SIZE);
    return header;
}
```

### 16.4 CRC Helper

```java
static int crc32(ByteBuffer source, int offset, int length) {
    CRC32 crc = new CRC32();
    ByteBuffer duplicate = source.duplicate();
    duplicate.position(offset);
    duplicate.limit(offset + length);

    byte[] chunk = new byte[Math.min(length, 4096)];
    while (duplicate.hasRemaining()) {
        int n = Math.min(duplicate.remaining(), chunk.length);
        duplicate.get(chunk, 0, n);
        crc.update(chunk, 0, n);
    }
    return (int) crc.getValue();
}
```

Catatan: `CRC32` bukan cryptographic hash. Ia cocok untuk mendeteksi accidental corruption, bukan malicious tampering.

### 16.5 Record Writer

```java
static ByteBuffer buildRecord(long userId, long updatedAtMillis, int status, int score, int flags) {
    ByteBuffer record = ByteBuffer.allocate(RECORD_SIZE).order(ByteOrder.BIG_ENDIAN);

    record.putLong(R_USER_ID, userId);
    record.putLong(R_UPDATED_AT, updatedAtMillis);
    record.putInt(R_STATUS, status);
    record.putInt(R_SCORE, score);
    record.putInt(R_FLAGS, flags);

    int crc = crc32(record, 0, R_CRC32);
    record.putInt(R_CRC32, crc);

    record.position(0);
    record.limit(RECORD_SIZE);
    return record;
}
```

### 16.6 Offset Calculation

```java
static long offsetOfRecord(long index) {
    if (index < 0) {
        throw new IllegalArgumentException("Negative record index: " + index);
    }
    return Math.addExact(HEADER_SIZE, Math.multiplyExact(index, RECORD_SIZE));
}
```

Pakai `Math.addExact` dan `Math.multiplyExact` agar overflow tidak silently berubah menjadi offset negatif/salah.

### 16.7 Writing Store

```java
static void createStore(Path path, List<UserStatus> records) throws IOException {
    try (FileChannel ch = FileChannel.open(
            path,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE,
            StandardOpenOption.READ)) {

        ByteBuffer header = buildHeader(records.size(), System.currentTimeMillis());
        writeFully(ch, header, 0);

        for (int i = 0; i < records.size(); i++) {
            UserStatus r = records.get(i);
            ByteBuffer record = buildRecord(
                    r.userId(),
                    r.updatedAtEpochMillis(),
                    r.status(),
                    r.score(),
                    r.flags());
            writeFully(ch, record, offsetOfRecord(i));
        }

        ch.force(true);
    }
}
```

Untuk Java 8, jika tidak memakai `record` class, gunakan class biasa.

---

## 17. Reading and Validating Header

```java
static Header readHeader(FileChannel ch) throws IOException {
    ByteBuffer header = ByteBuffer.allocate(HEADER_SIZE).order(ByteOrder.BIG_ENDIAN);
    readFully(ch, header, 0);
    header.flip();

    int magic = header.getInt(H_MAGIC);
    if (magic != MAGIC) {
        throw new IOException("Invalid magic: 0x" + Integer.toHexString(magic));
    }

    int major = Short.toUnsignedInt(header.getShort(H_MAJOR));
    int minor = Short.toUnsignedInt(header.getShort(H_MINOR));
    if (major != 1) {
        throw new IOException("Unsupported file format major version: " + major);
    }

    long recordCount = header.getLong(H_RECORD_COUNT);
    long recordSize = header.getLong(H_RECORD_SIZE);
    if (recordCount < 0) {
        throw new IOException("Negative record count: " + recordCount);
    }
    if (recordSize != RECORD_SIZE) {
        throw new IOException("Unsupported record size: " + recordSize);
    }

    int expectedCrc = header.getInt(H_CRC32);
    int actualCrc = crc32(header, 0, H_CRC32);
    if (expectedCrc != actualCrc) {
        throw new IOException("Header checksum mismatch");
    }

    long expectedFileSize = Math.addExact(
            HEADER_SIZE,
            Math.multiplyExact(recordCount, RECORD_SIZE));

    long actualFileSize = ch.size();
    if (actualFileSize < expectedFileSize) {
        throw new EOFException(
                "File is truncated. expected at least " + expectedFileSize +
                " bytes, actual " + actualFileSize);
    }

    return new Header(major, minor, recordCount, recordSize);
}
```

Important invariant:

```text
file size >= header size + record count * record size
```

Untuk format strict, bisa gunakan `==`, bukan `>=`.

Gunakan `>=` jika format mengizinkan extension/footer/extra region.

---

## 18. Reading a Fixed Record by Index

```java
static UserStatus readRecord(FileChannel ch, long index) throws IOException {
    Header header = readHeader(ch);
    if (index < 0 || index >= header.recordCount()) {
        throw new IndexOutOfBoundsException("Record index out of range: " + index);
    }

    ByteBuffer record = ByteBuffer.allocate(RECORD_SIZE).order(ByteOrder.BIG_ENDIAN);
    readFully(ch, record, offsetOfRecord(index));
    record.flip();

    int expectedCrc = record.getInt(R_CRC32);
    int actualCrc = crc32(record, 0, R_CRC32);
    if (expectedCrc != actualCrc) {
        throw new IOException("Record checksum mismatch at index " + index);
    }

    long userId = record.getLong(R_USER_ID);
    long updatedAt = record.getLong(R_UPDATED_AT);
    int status = record.getInt(R_STATUS);
    int score = record.getInt(R_SCORE);
    int flags = record.getInt(R_FLAGS);

    return new UserStatus(userId, updatedAt, status, score, flags);
}
```

Optimasi: jangan baca header ulang untuk setiap record. Baca sekali, lalu pass `Header` ke method baca record.

---

## 19. Updating a Fixed Record In-Place

Fixed-length record bisa diupdate di offset yang sama.

```java
static void updateRecord(FileChannel ch, long index, UserStatus newValue) throws IOException {
    Header header = readHeader(ch);
    if (index < 0 || index >= header.recordCount()) {
        throw new IndexOutOfBoundsException("Record index out of range: " + index);
    }

    ByteBuffer record = buildRecord(
            newValue.userId(),
            newValue.updatedAtEpochMillis(),
            newValue.status(),
            newValue.score(),
            newValue.flags());

    writeFully(ch, record, offsetOfRecord(index));
    ch.force(false);
}
```

Tetapi in-place update punya risiko crash consistency.

Jika process crash di tengah write 32 byte:

```text
record lama sebagian tertimpa
record baru sebagian tertulis
checksum mismatch
```

Checksum bisa mendeteksi corrupt record, tetapi tidak otomatis memperbaikinya.

Untuk update yang benar-benar safe, gunakan salah satu:

1. copy-on-write record;
2. append-only log;
3. page shadowing;
4. journal/WAL;
5. atomic whole-file replacement;
6. double-buffered slot.

---

## 20. Double-Buffered Slot Pattern

Jika record kecil dan perlu update in-place lebih aman, bisa gunakan dua slot.

```text
logical record N:
  slot A
  slot B
```

Setiap slot punya:

```text
sequence number
payload
checksum
commit marker
```

Saat update:

1. baca slot aktif dengan sequence terbesar yang valid;
2. tulis slot lain dengan sequence + 1;
3. force;
4. slot terbaru menjadi aktif.

Layout:

```text
Record N:
+-------------------+
| slot A            |
+-------------------+
| slot B            |
+-------------------+
```

Recovery:

```text
valid A, invalid B -> pakai A
invalid A, valid B -> pakai B
valid A, valid B   -> pakai sequence terbesar
invalid both       -> corrupt
```

Ini adalah mini copy-on-write.

---

## 21. Variable-Length Record Store

Untuk payload bervariasi, fixed records kurang efisien.

Format append-only:

```text
Header
Record 0
Record 1
Record 2
...
```

Record:

```text
Offset  Size  Field
0       4     magic
4       2     type
6       2     flags
8       8     sequence
16      4     payloadLength
20      N     payload
20+N    4     crc32
```

Reader berjalan sequential:

```text
pos = HEADER_SIZE
while pos < fileSize:
    read fixed record header
    validate magic
    read payloadLength
    validate payloadLength <= max
    read payload
    read checksum
    validate checksum
    pos += record size
```

### 21.1 Max Record Size

Wajib punya batas:

```java
static final int MAX_PAYLOAD_SIZE = 16 * 1024 * 1024;
```

Jika tidak, file corrupt bisa membuat aplikasi allocate buffer raksasa.

Kode validasi:

```java
if (payloadLength < 0 || payloadLength > MAX_PAYLOAD_SIZE) {
    throw new IOException("Invalid payload length: " + payloadLength);
}
```

### 21.2 Offset Index

Random access ke variable record butuh index.

```text
record id -> file offset
```

Index bisa disimpan:

- di memory saat startup dengan scan file;
- di footer;
- di file index terpisah;
- di embedded index region;
- di database kecil terpisah.

Trade-off:

```text
Scan on startup:
  + simple
  + index always rebuildable
  - startup lama untuk file besar

Footer index:
  + lookup cepat
  - crash saat write index perlu recovery

Separate index file:
  + bisa update terpisah
  - consistency antar file lebih sulit
```

---

## 22. Offset Table Pattern

Untuk file dengan payload variable-length tetapi ingin random access, gunakan offset table.

Layout:

```text
+----------------------+
| header               |
+----------------------+
| offset table         |
+----------------------+
| payload region       |
+----------------------+
```

Offset table:

```text
recordIndex -> payloadOffset, payloadLength
```

Contoh fixed offset table entry 16 byte:

```text
Offset  Size  Field
0       8     payloadOffset
8       4     payloadLength
12      4     crc32
```

Record N table offset:

```java
entryOffset = HEADER_SIZE + N * ENTRY_SIZE;
```

Payload dibaca dari `payloadOffset`.

Kelebihan:

- random access cepat;
- payload variable-length;
- offset table bisa divalidasi;
- payload region bisa immutable.

Kekurangan:

- update payload yang berubah ukuran sulit;
- perlu defragment/compaction;
- offset table corrupt bisa fatal;
- perlu checksum di entry dan payload.

---

## 23. Page-Oriented Layout

Storage engine sering memakai page.

```text
file = sequence of fixed-size pages
page size = 4096 / 8192 / 16384 bytes
```

Layout:

```text
Page 0: file header / metadata
Page 1: data page
Page 2: data page
Page 3: index page
...
```

Offset page N:

```java
pageOffset = pageNumber * PAGE_SIZE;
```

Keunggulan:

- cocok dengan disk/page cache mental model;
- update bisa page-level;
- checksum bisa page-level;
- free list bisa dikelola;
- cocok untuk B-tree atau heap file.

Kelemahan:

- desain lebih kompleks;
- perlu page allocator;
- perlu fragmentation management;
- perlu crash recovery.

Page header contoh:

```text
Offset  Size  Field
0       4     pageMagic
4       4     pageType
8       8     pageId
16      8     pageLsn
24      4     payloadLength
28      4     pageCrc32
32      ...   payload
```

---

## 24. Sparse Files and Holes

Jika kita menulis jauh melewati EOF, beberapa filesystem membuat sparse file.

Contoh:

```java
try (FileChannel ch = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {
    ByteBuffer oneByte = ByteBuffer.wrap(new byte[] { 1 });
    ch.write(oneByte, 1_000_000_000L);
}
```

Logical file size bisa menjadi sekitar 1GB, tetapi physical disk usage bisa jauh lebih kecil jika filesystem mendukung sparse file.

Namun:

- tidak semua filesystem/provider sama;
- copy tool bisa mengubah sparse menjadi real allocation;
- backup/restore bisa berubah semantics;
- disk full bisa terjadi saat hole benar-benar diisi;
- membaca hole biasanya terlihat seperti zero pada banyak sistem, tetapi jangan desain portability-critical code bergantung buta pada itu.

Untuk Java, `StandardOpenOption.SPARSE` ada sebagai hint saat membuat file sparse, tetapi efektivitasnya bergantung filesystem/provider.

---

## 25. Checksums and Corruption Detection

Binary layout harus punya strategi corruption detection.

Minimal:

- header checksum;
- record checksum;
- footer checksum;
- max length validation;
- magic validation;
- version validation;
- file size validation.

### 25.1 What Checksum Protects

Checksum membantu mendeteksi:

- partial write;
- bit rot;
- wrong offset read;
- truncation;
- corrupted length;
- accidental file modification.

Checksum tidak melindungi dari attacker yang bisa menghitung ulang checksum.

Untuk malicious tampering, gunakan cryptographic signature/MAC, tetapi itu masuk security layer.

### 25.2 Checksummed Record

Untuk variable-length record, checksum sebaiknya mencakup:

- type;
- flags;
- sequence;
- payload length;
- payload.

Jangan hanya checksum payload, karena metadata bisa corrupt.

---

## 26. Commit Marker and Partial Write Detection

Append record bisa crash di tengah.

Tanpa commit marker:

```text
[length][payload... partial]
```

Reader mungkin melihat length valid tetapi payload belum lengkap.

Dengan checksum dan EOF check, ini bisa dideteksi.

Dengan commit marker:

```text
[record header][payload][checksum][commit magic]
```

Reader hanya menganggap record valid jika:

1. header valid;
2. length valid;
3. payload lengkap;
4. checksum cocok;
5. commit magic ada.

Jika record terakhir invalid, reader bisa truncate ke offset sebelum record invalid.

---

## 27. Safe Append Protocol

Untuk append-only file:

1. dapatkan current end offset;
2. encode record ke buffer;
3. tulis record penuh;
4. force data jika durability dibutuhkan;
5. update in-memory index;
6. optionally update checkpoint/index file.

Pseudo-code:

```java
long offset = ch.size();
ByteBuffer record = encodeRecord(event);
writeFully(ch, record, offset);
ch.force(false);
inMemoryIndex.put(event.id(), offset);
```

Risk:

- jika crash sebelum force, record bisa hilang atau partial;
- jika crash setelah write tapi sebelum index update, record ada tapi index memory hilang;
- saat restart, scan log untuk rebuild index;
- jika record terakhir partial, truncate ke last valid offset.

---

## 28. Recovery Scan

Recovery scan adalah proses membaca file dari awal/last checkpoint sampai record terakhir yang valid.

Algorithm:

```text
pos = HEADER_SIZE
lastValid = pos

while pos < fileSize:
    try read record header
    if header incomplete: break
    if magic invalid: break
    if length invalid: break
    if full record not available: break
    if checksum mismatch: break
    apply record to in-memory state
    pos = next record offset
    lastValid = pos

if lastValid < fileSize:
    truncate file to lastValid
```

Ini adalah pola dasar log recovery.

Java sketch:

```java
static long recoverAppendLog(FileChannel ch) throws IOException {
    long fileSize = ch.size();
    long pos = HEADER_SIZE;
    long lastValid = pos;

    while (pos < fileSize) {
        Optional<Record> record = tryReadRecord(ch, pos, fileSize);
        if (!record.isPresent()) {
            break;
        }
        apply(record.get());
        pos = record.get().nextOffset();
        lastValid = pos;
    }

    if (lastValid < fileSize) {
        ch.truncate(lastValid);
        ch.force(true);
    }

    return lastValid;
}
```

---

## 29. File Size and Integer Overflow

File offsets memakai `long`, bukan `int`.

Kesalahan umum:

```java
int offset = headerSize + index * recordSize;
```

Jika file besar, overflow.

Gunakan:

```java
long offset = Math.addExact(
        HEADER_SIZE,
        Math.multiplyExact(index, RECORD_SIZE));
```

Validasi:

```java
if (offset < 0 || offset > ch.size()) {
    throw new IOException("Invalid offset: " + offset);
}
```

Saat membaca length dari file, jangan langsung allocate:

```java
int length = buf.getInt();
byte[] payload = new byte[length]; // dangerous if length corrupt
```

Lebih aman:

```java
if (length < 0 || length > MAX_PAYLOAD_SIZE) {
    throw new IOException("Invalid length: " + length);
}
byte[] payload = new byte[length];
```

---

## 30. File Format Invariants

Setiap format harus punya invariant tertulis.

Contoh fixed record store:

```text
1. Byte order is BIG_ENDIAN.
2. Header size is exactly 64 bytes.
3. Magic must be 0x55535431.
4. Major version must be 1.
5. Record size must be 32.
6. File size must be HEADER_SIZE + recordCount * RECORD_SIZE.
7. recordCount must be >= 0.
8. Every record checksum must match bytes 0..27 of the record.
9. Reserved header bytes must be zero.
10. Unknown major version must be rejected.
```

Contoh append log:

```text
1. Header magic must match.
2. Record sequence must be monotonic increasing.
3. Payload length must be <= MAX_PAYLOAD_SIZE.
4. Record checksum must cover record metadata and payload.
5. Only records with valid commit marker are visible.
6. Last partial record may be truncated during recovery.
7. Reader must never read past declared file size.
```

Invariant adalah pembeda antara “bisa jalan” dan “bisa dioperasikan”.

---

## 31. Backward and Forward Compatibility

### 31.1 Backward Compatible Addition

Jika menambah field baru di reserved area:

```text
v1:
40..63 reserved

v2:
40..47 lastCompactedAt
48..63 reserved
```

Reader v1 masih bisa membaca jika policy-nya mengabaikan reserved non-zero. Namun jika v1 mensyaratkan reserved zero, file v2 akan ditolak. Itu kadang justru diinginkan.

### 31.2 Feature Flags

Header bisa punya flags:

```text
flags bit 0 = compressed payload
flags bit 1 = encrypted payload
flags bit 2 = has footer index
```

Reader harus membedakan:

- known supported flags;
- known unsupported flags;
- unknown flags.

Policy:

```java
int unsupported = flags & ~SUPPORTED_FLAGS;
if (unsupported != 0) {
    throw new IOException("Unsupported flags: 0x" + Integer.toHexString(unsupported));
}
```

### 31.3 TLV Pattern

Untuk metadata yang fleksibel, gunakan TLV:

```text
Type-Length-Value
```

```text
type:   2 bytes
length: 4 bytes
value:  N bytes
```

Reader bisa skip unknown type jika length valid.

Keunggulan:

- extensible;
- backward/forward compatible;
- cocok untuk metadata.

Kelemahan:

- parsing lebih kompleks;
- random access lebih sulit;
- perlu length validation kuat.

---

## 32. Text Format vs Binary Format

Binary bukan selalu lebih baik.

### 32.1 Gunakan Text Jika

- manusia perlu inspect/edit;
- data kecil;
- compatibility lebih penting dari efisiensi;
- schema sering berubah;
- tooling umum penting;
- JSON/YAML/CSV cukup.

### 32.2 Gunakan Binary Jika

- ukuran data besar;
- butuh random access;
- butuh fixed layout;
- butuh high throughput;
- butuh checksum per record/page;
- ingin menghindari parsing text mahal;
- format dipakai internal dan terkontrol.

### 32.3 Hybrid

Banyak sistem bagus memakai hybrid:

```text
manifest.json     human-readable metadata
segments/*.bin    binary data segments
index.bin         binary index
```

Ini sering lebih maintainable daripada semua metadata disembunyikan dalam binary.

---

## 33. RandomAccessFile: Legacy but Still Relevant

Sebelum NIO, Java punya `RandomAccessFile`.

Contoh:

```java
try (RandomAccessFile raf = new RandomAccessFile("data.bin", "rw")) {
    raf.seek(128);
    int value = raf.readInt();
}
```

`RandomAccessFile` masih muncul di codebase lama dan sederhana untuk beberapa use case.

Namun untuk desain modern:

- `FileChannel` lebih fleksibel;
- bisa positional read/write;
- bisa lock;
- bisa map;
- bisa transfer;
- cocok dengan `Path` dan NIO ecosystem;
- error handling dan option model lebih explicit.

Interop:

```java
try (RandomAccessFile raf = new RandomAccessFile(file, "rw");
     FileChannel ch = raf.getChannel()) {
    // same underlying file
}
```

Hati-hati: file pointer `RandomAccessFile` dan channel position saling terkait karena underlying file sama.

---

## 34. Concurrency Model for Random Access Files

### 34.1 Concurrent Readers

Jika file immutable:

- banyak reader aman;
- explicit offset read ideal;
- tidak perlu lock internal jika tidak memakai shared mutable state;
- metadata/header bisa cache setelah validasi.

### 34.2 Single Writer, Multiple Readers

Sulit jika reader bisa melihat partial update.

Pilihan desain:

1. immutable file + atomic replace;
2. append-only file + recovery semantics;
3. lock reader/writer;
4. versioned segments;
5. snapshot file.

### 34.3 Multiple Writers

Multiple writer ke file yang sama sangat rawan.

Aman hanya jika:

- setiap writer punya region disjoint;
- offset allocation dikoordinasikan;
- write order tidak penting atau diproteksi;
- ada checksum/commit marker;
- ada recovery protocol;
- locking/lease jelas.

Untuk kebanyakan aplikasi bisnis: hindari multiple writer ke satu file. Gunakan queue/database/object store dengan coordination layer.

---

## 35. Atomicity at Byte Region Level

Jangan berasumsi write beberapa byte ke file adalah atomic secara portable.

Contoh:

```java
writeFully(ch, recordBuffer, recordOffset);
```

Walau method kita loop sampai semua byte tertulis, crash bisa terjadi di tengah.

Kemungkinan:

```text
old record
new record partial
mixed old/new bytes
checksum mismatch
```

Atomicity yang relatif bisa didapat dari:

- atomic rename untuk whole-file replacement;
- append protocol dengan commit marker;
- page-level checksum + WAL;
- double slot;
- filesystem/database transaction layer.

---

## 36. Durability and `force`

Untuk file format structured, `force` penting tetapi bukan sihir.

```java
ch.force(false); // content changes
ch.force(true);  // content + metadata changes
```

Gunakan `force(true)` jika metadata penting, misalnya:

- file size berubah;
- file baru dibuat;
- directory entry perlu durable;
- header metadata berubah.

Gunakan `force(false)` jika hanya content existing region yang perlu didorong.

Namun durability masih dipengaruhi:

- OS;
- filesystem;
- storage device;
- disk cache;
- mount option;
- network filesystem;
- virtualized/cloud storage.

Untuk critical system, uji crash recovery secara nyata, bukan hanya unit test.

---

## 37. Structured File Write Strategies

### 37.1 Whole File Build Then Atomic Publish

Cocok untuk export/index snapshot.

Flow:

```text
write temp file
validate temp file
force temp file
atomic move temp -> final
```

Keunggulan:

- final file selalu complete;
- reader sederhana;
- tidak perlu recovery rumit.

Kelemahan:

- butuh ruang disk extra;
- mahal untuk file sangat besar;
- tidak cocok untuk continuous append.

### 37.2 Append-Only with Recovery

Cocok untuk log/event.

Flow:

```text
append record
force optionally
on startup scan and truncate invalid tail
```

Keunggulan:

- efisien untuk write terus-menerus;
- recovery natural;
- history tersedia.

Kelemahan:

- file tumbuh terus;
- butuh compaction;
- random lookup butuh index.

### 37.3 In-Place Update with WAL

Cocok untuk page store.

Flow:

```text
write intent to WAL
force WAL
apply page update
force data optionally
checkpoint
truncate WAL when safe
```

Keunggulan:

- bisa update besar tanpa rewrite seluruh file;
- recovery kuat.

Kelemahan:

- kompleks;
- harus memahami ordering dan idempotency;
- sudah mendekati database engine.

---

## 38. Designing for Truncation

File bisa truncation karena:

- crash saat write;
- operator mistake;
- disk issue;
- interrupted copy;
- partial upload;
- log rotation bug;
- cleanup bug.

Reader harus bisa membedakan:

```text
empty file
file too small for header
header invalid
header valid but body incomplete
body valid but footer missing
footer present but checksum mismatch
```

Jangan semua dilempar sebagai `IOException: invalid file`.

Buat error yang operasional:

```text
ERR_FILE_TOO_SMALL
ERR_INVALID_MAGIC
ERR_UNSUPPORTED_VERSION
ERR_HEADER_CHECKSUM_MISMATCH
ERR_TRUNCATED_RECORD
ERR_RECORD_CHECKSUM_MISMATCH
ERR_INVALID_FOOTER
```

Ini membantu incident response.

---

## 39. Example: Safe Reader Classification

```java
enum FileValidationStatus {
    OK,
    FILE_TOO_SMALL,
    INVALID_MAGIC,
    UNSUPPORTED_VERSION,
    HEADER_CHECKSUM_MISMATCH,
    FILE_SIZE_MISMATCH,
    RECORD_CHECKSUM_MISMATCH,
    TRUNCATED_RECORD
}
```

Validation result:

```java
final class ValidationResult {
    final FileValidationStatus status;
    final long offset;
    final String message;

    ValidationResult(FileValidationStatus status, long offset, String message) {
        this.status = status;
        this.offset = offset;
        this.message = message;
    }
}
```

Top 1% habit: file format readers should produce diagnostic error, not vague exception.

---

## 40. Observability for Structured Files

Log minimal:

```text
file path
file size
format version
record count
last valid offset
validation status
checksum mismatch offset
writer version
operation id / correlation id
```

Metrics:

```text
structured_file_read_total
structured_file_validation_failed_total{reason}
structured_file_recovery_truncate_total
structured_file_bytes_written_total
structured_file_force_latency_ms
structured_file_record_checksum_failed_total
structured_file_unsupported_version_total
```

Avoid logging sensitive payload.

Log metadata, not raw content.

---

## 41. Testing Structured Binary Files

### 41.1 Golden File Test

Simpan sample binary file versi lama.

Test:

- reader versi baru bisa membaca;
- field hasil sesuai;
- checksum valid;
- unsupported version ditolak.

### 41.2 Corruption Tests

Generate file valid lalu rusak byte tertentu:

- magic rusak;
- version rusak;
- length terlalu besar;
- checksum salah;
- record terpotong;
- footer hilang;
- extra bytes;
- negative count;
- offset overflow.

### 41.3 Property Tests

Untuk banyak record random:

```text
write records -> read records -> equal
```

Dengan variasi:

- record count 0;
- record count 1;
- banyak record;
- max payload;
- unicode payload jika ada string encoding;
- random truncation point.

### 41.4 Crash Simulation

Simulasi dengan memotong file di setiap offset:

```java
for (long size = 0; size <= originalSize; size++) {
    copy(original, candidate);
    truncate(candidate, size);
    ValidationResult result = validate(candidate);
    assertNoInfiniteLoop(result);
    assertNoOutOfMemory(result);
}
```

Ini sangat powerful untuk format append-only.

---

## 42. Common Anti-Patterns

### 42.1 No Magic Number

File salah diparse sebagai format benar.

### 42.2 No Version

Tidak ada cara aman untuk evolusi format.

### 42.3 Trusting Length Field

Corrupt length menyebabkan OOM atau baca melewati EOF.

### 42.4 One Read Means Full Read

`read` tidak dijamin mengisi buffer penuh.

### 42.5 Updating Header Before Body Is Durable

Header mengatakan record count sudah 1000, body baru tertulis 700.

### 42.6 No Checksum

Partial write terlihat valid sampai data dipakai.

### 42.7 No Max Size

File corrupt bisa membuat alokasi memory raksasa.

### 42.8 Implicit Endianness

Format tidak portable antar implementasi/tool.

### 42.9 In-Place Update Without Recovery

Crash di tengah write membuat record campuran.

### 42.10 No Compatibility Contract

Setiap perubahan format menjadi breaking change tidak terkontrol.

---

## 43. Java 8 sampai Java 25 Compatibility Notes

### 43.1 Path Creation

Java 8:

```java
Path path = Paths.get("data.bin");
```

Java 11+:

```java
Path path = Path.of("data.bin");
```

Untuk materi lintas Java 8–25, contoh utama bisa memakai `Paths.get` agar kompatibel.

### 43.2 Records Java Language Feature

Java 16+ punya `record` class:

```java
record UserStatus(long userId, long updatedAtEpochMillis, int status, int score, int flags) {}
```

Untuk Java 8, gunakan class biasa:

```java
final class UserStatus {
    private final long userId;
    private final long updatedAtEpochMillis;
    private final int status;
    private final int score;
    private final int flags;

    // constructor + getters
}
```

### 43.3 API Stability

Core API yang dibahas di part ini sudah tersedia sejak Java 7/8 era:

- `Path`
- `Files.newByteChannel`
- `SeekableByteChannel`
- `FileChannel`
- `ByteBuffer`
- `StandardOpenOption`
- `CRC32`

Jadi desainnya applicable untuk Java 8 sampai 25.

---

## 44. Production Design Checklist

Sebelum membuat structured binary file, jawab ini:

```text
[ ] Apakah file punya magic number?
[ ] Apakah file punya explicit version?
[ ] Apakah byte order didefinisikan?
[ ] Apakah header size jelas?
[ ] Apakah semua offset memakai long?
[ ] Apakah arithmetic memakai overflow check?
[ ] Apakah semua length divalidasi?
[ ] Apakah ada max record size?
[ ] Apakah ada checksum untuk header/record/page?
[ ] Apakah partial read/write ditangani?
[ ] Apakah crash saat write sudah dipikirkan?
[ ] Apakah reader bisa membedakan corrupt vs truncated?
[ ] Apakah ada recovery scan?
[ ] Apakah ada truncate-to-last-valid-offset policy?
[ ] Apakah file bisa berevolusi ke versi baru?
[ ] Apakah unknown version/flags ditolak dengan jelas?
[ ] Apakah update in-place punya journal/double slot/COW?
[ ] Apakah write perlu force?
[ ] Apakah force latency dimonitor?
[ ] Apakah format punya golden file tests?
[ ] Apakah corruption tests mencakup length, checksum, EOF, magic?
```

---

## 45. Decision Matrix

| Kebutuhan | Layout yang Cocok | Catatan |
|---|---|---|
| Baca semua data dari awal ke akhir | sequential variable record | sederhana, streaming-friendly |
| Lookup record by index | fixed-length record | offset mudah dihitung |
| Payload bervariasi dan random lookup | offset table + payload region | butuh index validation |
| Event durable append | append-only log | butuh recovery scan |
| Update record kecil | double-buffered slot | mini copy-on-write |
| Update page besar | page layout + WAL | kompleks, mirip database |
| Snapshot immutable | build temp + atomic move | paling sederhana untuk reader |
| Metadata fleksibel | TLV / manifest | extensible |
| Human inspectability | text/manifest hybrid | jangan binary semuanya jika tidak perlu |

---

## 46. Mini Capstone: Format Spec Sebelum Implementasi

Sebelum menulis kode, buat dokumen format seperti ini:

```text
Format Name: UserStatusStore
File Extension: .ust
Byte Order: Big Endian
Current Version: 1.0

Header:
  size: 64 bytes
  fields:
    0..3    magic "UST1"
    4..5    major version
    6..7    minor version
    8..15   record count
    16..23  record size
    24..31  createdAt epoch millis
    32..35  flags
    36..39  header crc32
    40..63  reserved zero

Record:
  size: 32 bytes
  fields:
    0..7    user id
    8..15   updatedAt epoch millis
    16..19  status
    20..23  score
    24..27  flags
    28..31  record crc32

Invariants:
  - magic must match
  - major version must be 1
  - record size must be 32
  - file size must equal 64 + recordCount * 32
  - all checksums must match
  - reserved bytes must be zero

Recovery:
  - fixed store is strict; any mismatch rejects file
  - no in-place update without external protocol
```

Baru setelah itu implementasi.

---

## 47. Key Takeaways

1. File bisa diperlakukan sebagai **array byte beralamat**, bukan hanya stream.
2. Random access memungkinkan lookup/update berdasarkan offset.
3. `FileChannel` menyediakan current-position dan explicit-position API; pilih dengan sadar.
4. Satu `read`/`write` tidak boleh diasumsikan selalu complete.
5. Binary format harus punya magic, version, byte order, length validation, dan checksum.
6. Fixed-length records mudah untuk random access, tetapi tidak fleksibel untuk payload variable.
7. Variable-length records fleksibel, tetapi butuh framing, checksum, max size, dan sering butuh index.
8. In-place update tidak otomatis crash-safe.
9. Append-only format harus punya recovery scan dan kemampuan truncate invalid tail.
10. File format yang baik harus punya invariant tertulis dan corruption tests.

---

## 48. Latihan

### Latihan 1 — Fixed Record Store

Buat file format fixed record untuk menyimpan:

```text
orderId: long
createdAt: long
status: int
amountCents: long
checksum: int
```

Tentukan:

- header layout;
- record size;
- offset calculation;
- checksum coverage;
- validation rule.

### Latihan 2 — Corruption Test

Buat test yang:

1. menulis 100 record valid;
2. membuka file sebagai byte array;
3. merusak 1 byte pada record ke-50;
4. memastikan reader mendeteksi checksum mismatch pada record ke-50.

### Latihan 3 — Append Log Recovery

Buat append log sederhana:

```text
recordMagic:int
sequence:long
payloadLength:int
payload:byte[]
crc32:int
commitMagic:int
```

Lalu test:

- file lengkap;
- file terpotong di tengah payload;
- file terpotong sebelum commit marker;
- checksum salah;
- length terlalu besar.

### Latihan 4 — Version Compatibility

Buat reader v2 yang bisa membaca file v1 dan v2.

Rule:

- v1 record tidak punya flags;
- v2 record punya flags;
- reader v2 harus mengisi default flags = 0 saat membaca v1.

---

## 49. Preview Part Berikutnya

Part berikutnya akan masuk lebih dalam ke **append-only files, WAL, journaling, dan recovery design**.

Di Part 20 kita sudah membahas structured layout dan dasar recovery. Part 21 akan fokus pada pertanyaan yang lebih sulit:

```text
Bagaimana membuat file yang tetap recoverable jika process mati kapan saja saat menulis?
```

Kita akan membahas:

- append-only log;
- write-ahead log;
- record framing;
- length-prefix + checksum;
- commit marker;
- segment file;
- snapshot + replay;
- compaction;
- exactly-once illusion;
- failure matrix.

---

## 50. Referensi

- Java SE 25 Documentation — `FileChannel`
- Java SE 25 Documentation — `SeekableByteChannel`
- Java SE 25 Documentation — `StandardOpenOption`
- Java SE 25 Documentation — `ByteBuffer`
- Java SE 8 Documentation — `FileChannel`
- Java SE 8 Documentation — `SeekableByteChannel`
- Java SE 8 Documentation — `Files.newByteChannel`
- Java SE Documentation — `CRC32`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 19 — Memory-Mapped Files in File Workflows](./learn-java-io-file-filesystem-storage-engineering-part-19-memory-mapped-files.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 21 — Append-Only Files, WAL, Journaling, and Recovery Design](./learn-java-io-file-filesystem-storage-engineering-part-21-append-only-wal-journaling-recovery-design.md)
