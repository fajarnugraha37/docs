# Part 010 — Memory-Mapped File: `MappedByteBuffer`, Page Cache, Huge Files, dan Trade-off

> Seri: `learn-java-io-nio-networking-data-transfer`  
> Format file: `learn-java-io-nio-networking-data-transfer-part-010.md`  
> Status seri: belum selesai  
> Prasyarat: Part 007 tentang NIO core, Part 008 tentang `ByteBuffer`, dan Part 009 tentang `FileChannel`

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami **apa itu memory-mapped file** dan bedanya dengan stream/channel read biasa.
2. Memahami hubungan antara `FileChannel.map(...)`, `MappedByteBuffer`, virtual memory, page cache, dan filesystem.
3. Menentukan kapan memory-mapped file cocok dan kapan justru berbahaya.
4. Membaca file besar secara random access tanpa memuat seluruh isi file ke heap.
5. Mendesain parser, index reader, dan file segment reader berbasis mmap secara aman.
6. Memahami risiko besar:
   - unmapping sulit,
   - file berubah saat mapped,
   - crash consistency,
   - page fault latency,
   - Windows file locking/deletion behavior,
   - `OutOfMemoryError` karena native memory/address space,
   - ukuran mapping dibatasi oleh `ByteBuffer` indexing.
7. Memahami trade-off antara:
   - `InputStream`,
   - `FileChannel.read`,
   - `transferTo/transferFrom`,
   - `MappedByteBuffer`,
   - `MemorySegment` file mapping pada Java modern.

---

## 2. Posisi Materi Ini dalam Seri

Sebelumnya kita sudah membahas:

- `ByteBuffer` sebagai state machine: `position`, `limit`, `capacity`.
- heap buffer vs direct buffer.
- `FileChannel` sebagai API untuk random access, transfer, lock, dan durability.

Sekarang kita masuk ke teknik yang lebih dekat ke mekanisme OS: **memory-mapped file**.

Di permukaan, memory-mapped file terlihat seperti ini:

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    MappedByteBuffer buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
    byte first = buffer.get(0);
}
```

Namun secara mental model, ini bukan “membaca file ke memory Java”. Ini lebih mirip:

> “Minta OS memetakan region file ke virtual address space proses, lalu Java mengakses region itu seolah-olah buffer memory.”

Kalimat itu penting. Kalau salah memahaminya, kita bisa salah mengambil keputusan produksi.

---

## 3. Ringkasan API Resmi

`MappedByteBuffer` adalah subclass dari `ByteBuffer` yang merepresentasikan region file yang dipetakan ke memory. Ia dibuat melalui `FileChannel.map(...)`.

Secara resmi:

- `FileChannel` adalah channel untuk membaca, menulis, memetakan, dan memanipulasi file.
- `MappedByteBuffer` dibuat oleh `FileChannel.map`.
- Mapping tetap valid sampai buffer tersebut garbage-collected.
- `MappedByteBuffer.force()` meminta perubahan buffer ditulis ke storage device.
- `MappedByteBuffer.load()` mencoba memuat content buffer ke physical memory.
- `MappedByteBuffer.isLoaded()` memberi indikasi apakah content buffer kemungkinan sudah resident di physical memory.

Referensi penting:

- Java SE 21 `FileChannel`: <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html>
- Java SE 8 `MappedByteBuffer`: <https://docs.oracle.com/javase/8/docs/api/java/nio/MappedByteBuffer.html>
- Java SE 21 `ByteBuffer`: <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/ByteBuffer.html>
- Java SE 25 `MemorySegment`: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/MemorySegment.html>
- OpenJDK JEP 352 Non-Volatile Mapped Byte Buffers: <https://openjdk.org/jeps/352>

---

## 4. Mental Model Utama

### 4.1 Normal file read

Pada file read biasa:

```text
Application Java
    ↓ read(buffer)
JVM/native call
    ↓ syscall read
Kernel
    ↓ copy data from page cache/kernel buffer
User-space buffer
    ↓
Java code consumes bytes
```

Ada beberapa hal yang terjadi:

1. Program meminta data ke OS.
2. OS membaca dari page cache atau storage.
3. Data disalin ke buffer milik proses.
4. Java memproses isi buffer.

Dengan `FileInputStream` atau `FileChannel.read(ByteBuffer)`, kamu biasanya punya pola eksplisit:

```java
while (channel.read(buffer) != -1) {
    buffer.flip();
    process(buffer);
    buffer.clear();
}
```

Aplikasi mengontrol siklus read.

---

### 4.2 Memory-mapped file

Pada memory-mapped file:

```text
Application Java
    ↓ buffer.get(index)
Virtual memory access
    ↓ page fault jika page belum resident
Kernel page cache / storage
    ↓ OS maps page into process address space
Application sees bytes as memory
```

Yang berubah:

- Kamu tidak memanggil `read()` untuk setiap chunk.
- Kamu mengakses memory address.
- Saat page belum tersedia, OS melakukan page fault dan memuat page dari file.
- OS menangani caching dan paging.

Secara sederhana:

```text
read() model:
  aplikasi meminta data secara eksplisit

mmap model:
  aplikasi menyentuh address; OS memuat page saat dibutuhkan
```

---

## 5. Analogi yang Akurat

Bayangkan file sebagai buku besar.

### Stream/channel read

Kamu minta petugas fotokopi:

> “Tolong fotokopi halaman 1 sampai 100 ke meja saya.”

Kamu bekerja dari salinan di meja.

### Memory-mapped file

Petugas membuka akses langsung ke rak buku dan membuat tiap halaman seolah-olah muncul di meja saat kamu menyentuhnya.

Kamu tidak memegang seluruh buku. Kamu punya alamat halaman. Saat kamu membuka halaman tertentu, sistem mengambilnya bila belum tersedia.

---

## 6. API Dasar `FileChannel.map`

Signature umum:

```java
MappedByteBuffer map(FileChannel.MapMode mode, long position, long size)
```

Parameter:

| Parameter | Makna |
|---|---|
| `mode` | mode mapping: read-only, read-write, private |
| `position` | offset awal file yang dipetakan |
| `size` | jumlah byte yang dipetakan |

Contoh read-only:

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class MmapReadExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data.bin");

        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long size = channel.size();
            if (size > Integer.MAX_VALUE) {
                throw new IllegalArgumentException("Example only supports <= 2GB mapping");
            }

            MappedByteBuffer buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, size);

            for (int i = 0; i < buffer.limit(); i++) {
                byte b = buffer.get(i); // absolute get; tidak mengubah position
                // process byte
            }
        }
    }
}
```

Catatan penting:

- `MappedByteBuffer` masih `ByteBuffer`, sehingga limit/capacity menggunakan `int`.
- Untuk file lebih besar dari ±2GB, kamu perlu membagi mapping menjadi beberapa segment/window.
- `channel.close()` tidak langsung membuat mapped buffer invalid. Mapping punya lifecycle sendiri.

---

## 7. `MapMode`: READ_ONLY, READ_WRITE, PRIVATE

### 7.1 `READ_ONLY`

```java
MappedByteBuffer buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
```

Makna:

- Data bisa dibaca.
- Write ke buffer akan menyebabkan `ReadOnlyBufferException`.
- Cocok untuk:
  - index reader,
  - file parser,
  - lookup table,
  - read-only dataset,
  - immutable file snapshot.

Ingat: read-only di Java tidak berarti file tidak bisa diubah oleh process lain. Itu hanya berarti mapping ini tidak boleh menulis.

---

### 7.2 `READ_WRITE`

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE,
        StandardOpenOption.CREATE)) {

    MappedByteBuffer buffer = channel.map(FileChannel.MapMode.READ_WRITE, 0, 1024);
    buffer.putInt(0, 42);
    buffer.force();
}
```

Makna:

- Perubahan pada buffer dapat tercermin ke file.
- `force()` meminta OS menulis perubahan ke storage.
- Cocok untuk:
  - fixed-size binary store,
  - append-like segment dengan kontrol sendiri,
  - memory-mapped index,
  - IPC tertentu,
  - embedded storage structure.

Risiko:

- Crash saat update bisa meninggalkan file dalam state setengah berubah.
- Kamu harus mendesain format dengan commit marker, checksum, version, atau journal.
- `force()` bukan pengganti desain crash consistency.

---

### 7.3 `PRIVATE`

```java
MappedByteBuffer buffer = channel.map(FileChannel.MapMode.PRIVATE, 0, channel.size());
```

Makna:

- Copy-on-write private mapping.
- Perubahan pada buffer tidak harus ditulis ke file asli.
- Cocok untuk eksperimen transformasi memory lokal tanpa mengubah file.

Namun dalam aplikasi Java enterprise sehari-hari, `PRIVATE` jauh lebih jarang dipakai dibanding `READ_ONLY` dan `READ_WRITE`.

---

## 8. State Machine `MappedByteBuffer`

Karena `MappedByteBuffer` adalah `ByteBuffer`, ia tetap punya:

- `position`
- `limit`
- `capacity`
- relative get/put
- absolute get/put
- `slice`
- `duplicate`
- `asReadOnlyBuffer`
- byte order

Contoh relative access:

```java
while (buffer.hasRemaining()) {
    byte b = buffer.get(); // position maju
}
```

Contoh absolute access:

```java
byte b0 = buffer.get(0);
byte b100 = buffer.get(100);
```

Untuk parser binary, absolute access sering lebih aman jika format punya offset eksplisit.

---

## 9. Page Cache dan Page Fault

### 9.1 Apa itu page cache?

OS tidak selalu membaca langsung dari disk setiap kali aplikasi minta data. OS menyimpan page file yang sering diakses di memory. Ini disebut page cache.

Untuk file read biasa:

```text
Disk → Page Cache → copy to user buffer → Java consumes
```

Untuk mmap:

```text
Disk → Page Cache → mapped into process virtual memory → Java consumes
```

Mmap bisa mengurangi copy tertentu, tetapi bukan berarti selalu “zero cost”. Page masih harus dimuat dari storage bila belum ada di cache.

---

### 9.2 Apa itu page fault?

Saat Java melakukan:

```java
byte b = buffer.get(index);
```

Jika page yang berisi `index` belum resident di memory, CPU/OS akan memicu page fault. OS lalu memuat page dari file ke memory.

Dari sudut pandang Java, baris `buffer.get(index)` bisa tiba-tiba lambat.

Ini penting untuk latency-sensitive system.

```text
buffer.get(index)
  fast if page resident
  slow if page fault + disk/network storage
```

---

## 10. `load()`, `isLoaded()`, dan `force()`

### 10.1 `load()`

```java
buffer.load();
```

`load()` mencoba membuat content buffer resident di physical memory.

Namun:

- Ini bukan guarantee absolut untuk semua OS/kondisi.
- Bisa mahal untuk mapping besar.
- Bisa mengganggu cache/memory pressure process lain.

Gunakan dengan hati-hati.

---

### 10.2 `isLoaded()`

```java
boolean loaded = buffer.isLoaded();
```

`isLoaded()` memberi indikasi apakah content buffer kemungkinan resident di physical memory.

Jangan menjadikannya correctness condition.

Yang buruk:

```java
if (!buffer.isLoaded()) {
    throw new IllegalStateException("File not in memory");
}
```

Yang lebih masuk akal:

```java
if (!buffer.isLoaded()) {
    // optional warm-up hint, not correctness requirement
    buffer.load();
}
```

---

### 10.3 `force()`

```java
buffer.putInt(0, 123);
buffer.force();
```

`force()` meminta perubahan pada mapped buffer ditulis ke storage.

Namun pahami batasnya:

- `force()` bukan transaksi.
- `force()` tidak otomatis membuat multi-field update atomic.
- Jika format butuh durability, kamu tetap perlu desain commit protocol.

Contoh crash-safe-ish record update:

```text
record layout:
  magic
  version
  payloadLength
  payload
  checksum
  committedFlag
```

Urutan update:

1. Tulis payload.
2. Tulis checksum.
3. `force()`.
4. Tulis committed flag.
5. `force()`.

Saat recovery:

- Jika committed flag tidak valid → ignore.
- Jika checksum mismatch → ignore/corrupt.
- Jika version tidak dikenal → reject/migrate.

---

## 11. Membaca File Besar dengan Windowed Mapping

Karena `ByteBuffer` menggunakan indexing `int`, mapping tunggal praktis dibatasi sekitar 2GB.

Untuk file besar, gunakan window mapping.

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class WindowedMmapScanner {
    private static final long WINDOW_SIZE = 256L * 1024L * 1024L; // 256 MB

    public static void scan(Path path) throws IOException {
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long fileSize = channel.size();
            long offset = 0;

            while (offset < fileSize) {
                long remaining = fileSize - offset;
                long mapSize = Math.min(WINDOW_SIZE, remaining);

                MappedByteBuffer buffer = channel.map(
                        FileChannel.MapMode.READ_ONLY,
                        offset,
                        mapSize
                );

                processWindow(buffer, offset);
                offset += mapSize;
            }
        }
    }

    private static void processWindow(MappedByteBuffer buffer, long baseOffset) {
        for (int i = 0; i < buffer.limit(); i++) {
            byte b = buffer.get(i);
            long absoluteOffset = baseOffset + i;
            // process byte at absoluteOffset
        }
    }
}
```

### 11.1 Masalah boundary antar-window

Jika kamu membaca format record, record bisa terpotong di batas window.

Contoh:

```text
window 1 ends here
             ↓
[record header][payload payload payload ...]
```

Jika header ada di window 1 dan payload lanjut di window 2, parser naïf akan rusak.

Solusi:

1. Pilih window overlap.
2. Gunakan carry-over buffer kecil.
3. Desain parser berbasis absolute offset dan remap saat butuh byte di luar window.
4. Untuk format fixed-size record, align window ke record boundary.

---

## 12. Contoh: Membaca Fixed-Size Record dengan Mmap

Misal format record:

```text
record size = 16 bytes
offset + 0  : long id
offset + 8  : int status
offset + 12 : int amount
```

Kode:

```java
import java.io.IOException;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class FixedRecordReader {
    private static final int RECORD_SIZE = 16;

    public static void read(Path path) throws IOException {
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long fileSize = channel.size();

            if (fileSize % RECORD_SIZE != 0) {
                throw new IOException("Corrupt file: size is not aligned to record size");
            }

            if (fileSize > Integer.MAX_VALUE) {
                throw new IOException("Example only supports <= 2GB");
            }

            MappedByteBuffer buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, fileSize);
            buffer.order(ByteOrder.BIG_ENDIAN);

            int recordCount = (int) (fileSize / RECORD_SIZE);

            for (int recordIndex = 0; recordIndex < recordCount; recordIndex++) {
                int offset = recordIndex * RECORD_SIZE;

                long id = buffer.getLong(offset);
                int status = buffer.getInt(offset + 8);
                int amount = buffer.getInt(offset + 12);

                process(id, status, amount);
            }
        }
    }

    private static void process(long id, int status, int amount) {
        // business logic
    }
}
```

Kelebihan mmap untuk format seperti ini:

- Random access murah dari sisi API.
- Tidak perlu loop `read` manual.
- Offset calculation jelas.
- Cocok untuk index/table-like binary file.

Tetapi jangan lupa:

- Masih bisa page fault.
- Masih butuh validasi ukuran.
- Masih butuh version/checksum untuk data produksi.

---

## 13. Contoh: Membangun Read-Only Lookup Index

Misal kita punya file index sorted:

```text
Header:
  magic: 4 bytes
  version: 4 bytes
  recordCount: 8 bytes

Record:
  key: long
  offset: long
```

Total header 16 byte, record 16 byte.

Kita bisa binary search langsung di mapped buffer.

```java
import java.io.Closeable;
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class MappedLongIndex implements Closeable {
    private static final int HEADER_SIZE = 16;
    private static final int RECORD_SIZE = 16;
    private static final int MAGIC = 0x49445831; // "IDX1"

    private final FileChannel channel;
    private final MappedByteBuffer buffer;
    private final long recordCount;

    public MappedLongIndex(Path path) throws IOException {
        this.channel = FileChannel.open(path, StandardOpenOption.READ);
        long size = channel.size();

        if (size < HEADER_SIZE) {
            throw new IOException("Invalid index: too small");
        }
        if (size > Integer.MAX_VALUE) {
            throw new IOException("This implementation supports max 2GB index file");
        }

        this.buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, size);

        int magic = buffer.getInt(0);
        int version = buffer.getInt(4);
        long count = buffer.getLong(8);

        if (magic != MAGIC) {
            throw new IOException("Invalid index magic");
        }
        if (version != 1) {
            throw new IOException("Unsupported index version: " + version);
        }

        long expectedSize = HEADER_SIZE + count * RECORD_SIZE;
        if (expectedSize != size) {
            throw new IOException("Invalid index size. expected=" + expectedSize + ", actual=" + size);
        }

        this.recordCount = count;
    }

    public long findOffset(long key) {
        long low = 0;
        long high = recordCount - 1;

        while (low <= high) {
            long mid = (low + high) >>> 1;
            int pos = Math.toIntExact(HEADER_SIZE + mid * RECORD_SIZE);

            long midKey = buffer.getLong(pos);
            long midOffset = buffer.getLong(pos + 8);

            if (midKey < key) {
                low = mid + 1;
            } else if (midKey > key) {
                high = mid - 1;
            } else {
                return midOffset;
            }
        }

        return -1;
    }

    @Override
    public void close() throws IOException {
        // Closing the channel does not necessarily unmap the buffer immediately.
        channel.close();
    }
}
```

Perhatikan desainnya:

- Ada magic number.
- Ada version.
- Ada count.
- Ada size validation.
- Ada binary search tanpa load semua record ke heap.

Ini jauh lebih production-minded daripada sekadar “mmap lalu baca”.

---

## 14. Mmap Bukan Pengganti Semua File Read

Memory-mapped file sering terlihat keren, tetapi bukan default terbaik.

### 14.1 Kapan stream/channel biasa lebih baik?

Gunakan stream/channel biasa jika:

- Akses file sequential.
- File kecil/sedang.
- Logic processing linear.
- Data hanya dibaca sekali.
- Kamu butuh lifecycle eksplisit sederhana.
- Kamu ingin mudah membatasi memory usage.
- Kamu ingin error handling yang lebih predictable.

Contoh bagus untuk stream:

- membaca CSV satu kali,
- upload file ke remote server,
- scan log line-by-line,
- generate report output,
- transform file sequential.

---

### 14.2 Kapan mmap masuk akal?

Gunakan mmap jika:

- File besar tetapi aksesnya random.
- Ada index atau lookup table binary.
- Data dibaca berulang-ulang.
- Kamu ingin menghindari copy eksplisit ke heap.
- Struktur file fixed-size atau offset-based.
- Kamu butuh akses banyak offset kecil secara cepat.
- Kamu membangun embedded storage/index/search-like component.

Contoh cocok:

- read-only dictionary file,
- search index segment,
- time-series segment,
- binary lookup table,
- memory-mapped cache warm file,
- database-like page file,
- large immutable data snapshot.

---

## 15. Performance Model

### 15.1 Mmap bisa cepat karena...

Mmap bisa cepat karena:

1. Mengurangi copy eksplisit dari kernel ke user buffer dalam pola tertentu.
2. Mengizinkan OS menangani paging secara efisien.
3. Random access lebih natural.
4. Data bisa dishare antar-process melalui page cache.
5. Tidak perlu membuat array besar di heap.

---

### 15.2 Mmap bisa lambat karena...

Mmap juga bisa lambat karena:

1. Page fault bisa terjadi di titik akses yang sulit diprediksi.
2. Random access buruk bisa menyebabkan banyak page miss.
3. Network filesystem bisa membuat page fault sangat mahal.
4. Mapping besar bisa menekan virtual address space/native memory accounting.
5. `load()` besar bisa membanjiri memory.
6. Unmapping tidak deterministik pada `MappedByteBuffer` klasik.

---

### 15.3 Sequential scan: jangan otomatis pilih mmap

Untuk sequential scan besar, `FileChannel.read` dengan buffer besar bisa sama baik atau lebih mudah dikontrol.

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
while (channel.read(buffer) != -1) {
    buffer.flip();
    process(buffer);
    buffer.clear();
}
```

Kelebihannya:

- lifecycle jelas,
- memory bounded,
- retry/error handling lebih eksplisit,
- mudah instrumentasi bytes/sec,
- mudah implement backpressure.

---

## 16. Failure Model Memory-Mapped File

### 16.1 File berubah saat mapped

Jika file diubah oleh process lain saat masih mapped, behavior bisa sulit dipikirkan.

Kemungkinan:

- reader melihat data lama,
- reader melihat data baru,
- reader melihat campuran tergantung page/cache/timing,
- mapping tetap pada ukuran awal,
- akses ke area tertentu gagal tergantung OS dan perubahan file.

Rule produksi:

> Jangan treat mutable mapped file sebagai format bebas. Gunakan version, lock, atomic publish, atau immutable segment.

Pattern aman:

```text
writer writes new file: data.tmp
writer fsync data.tmp
writer atomically moves data.tmp -> data.v2
reader opens data.v2 as immutable snapshot
old data.v1 deleted after readers gone
```

---

### 16.2 Truncate saat mapped

Jika file dipotong oleh process lain saat masih ada mapping, akses ke region yang tidak lagi valid bisa menyebabkan error serius. Di beberapa platform, efeknya tidak senyaman `IOException` biasa.

Rule:

- Jangan truncate file yang sedang dibaca mmap oleh process lain.
- Gunakan file immutable + atomic replace.
- Gunakan reference counting atau generation-based cleanup.

---

### 16.3 Disk penuh saat write mapping

Dengan `READ_WRITE`, kamu bisa menulis ke memory mapping, tetapi persist ke storage bisa gagal kemudian.

Kesalahan umum:

```java
buffer.put(data);
// assume persisted
```

Lebih baik:

```java
buffer.put(data);
buffer.force();
// then validate/commit marker
```

Tapi bahkan ini bukan transaksi penuh.

---

### 16.4 Process crash saat update

Jika process crash saat update mapped file, file bisa berisi partial update.

Solusi format:

- append-only record,
- commit marker,
- checksum,
- monotonically increasing sequence,
- double-write buffer,
- journal,
- copy-on-write page,
- manifest swap.

---

### 16.5 Unmapping tidak deterministik

Pada `MappedByteBuffer` klasik, mapping tetap valid sampai buffer garbage-collected. Itu berarti kamu tidak punya `close()` langsung pada buffer.

Implikasi:

- File bisa tetap terkunci di Windows.
- File deletion/replace bisa gagal sampai mapping dilepas.
- Native memory/address space bisa bertahan lebih lama dari yang kamu harapkan.

Ini salah satu alasan kenapa mmap klasik harus digunakan dengan disiplin.

---

## 17. Windows File Locking / Deletion Behavior

Di Unix-like OS, menghapus file yang masih dibuka biasanya menghapus directory entry, tetapi data file tetap ada sampai handle terakhir ditutup.

Di Windows, file yang masih mapped/open dapat membuat delete/rename gagal.

Konsekuensi:

- Test di Linux container bisa lolos.
- Production/desktop Windows bisa gagal delete.
- Build tool atau local dev bisa stuck karena mapped file belum di-unmap.

Rule:

- Jangan mengandalkan immediate delete untuk mapped file.
- Gunakan generation directory:

```text
index/
  gen-000001/
    data.idx
  gen-000002/
    data.idx
  CURRENT
```

Reader membuka generation tertentu. Cleanup generation lama dilakukan setelah tidak ada reader.

---

## 18. Crash Consistency Pattern untuk Mapped Write

Mmap write bukan transaksi. Maka desain format sangat penting.

### 18.1 Bad design

```text
offset 0: balance account A

write new balance directly
```

Jika crash terjadi saat write, nilai bisa corrupt.

---

### 18.2 Better: append-only log

```text
record:
  magic
  version
  sequence
  key
  valueLength
  value
  checksum
  commitMarker
```

Recovery:

1. Scan dari awal.
2. Stop pada record invalid.
3. Ambil sequence terakhir valid.
4. Rebuild index.

---

### 18.3 Better: double-buffered snapshot

```text
slot A:
  header(version, checksum, committed)
  payload

slot B:
  header(version, checksum, committed)
  payload
```

Write baru ke slot inactive, validate, force, mark committed, force. Reader memilih slot valid dengan version terbesar.

---

## 19. Mmap untuk File Ingestion: Hati-Hati

Misal kamu membuat ingestion service yang menerima file CSV lalu memprosesnya.

Mmap tampak menarik untuk file besar. Tetapi CSV adalah text format variable-length, line-based, dan encoding-sensitive.

Masalah:

- UTF-8 character bisa terpotong antar-window.
- newline bisa berada di boundary window.
- quoted CSV bisa multi-line.
- parser text butuh charset decoder stateful.
- error handling lebih sulit.

Untuk CSV besar, sering lebih aman:

```text
InputStream → InputStreamReader(charset) → BufferedReader/parser streaming
```

Mmap cocok jika kamu punya binary format offset-based, bukan sembarang text file.

---

## 20. Mmap dan Charset: Jangan Campur Sembarangan

Mapped buffer berisi byte. Jika file berisi text, kamu masih harus decode byte ke character.

Yang buruk:

```java
for (int i = 0; i < buffer.limit(); i++) {
    char c = (char) buffer.get(i); // wrong for UTF-8
}
```

Kenapa salah?

- UTF-8 character bisa terdiri dari 1–4 byte.
- Casting byte ke char hanya benar untuk subset ASCII tertentu.
- Byte signed di Java.

Lebih benar untuk file kecil/sedang:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder();
CharBuffer chars = decoder.decode(buffer);
```

Tetapi untuk file besar dan windowed mmap, decoder state harus dijaga antar-window. Ini tidak trivial.

Rule:

> Untuk text variable-length, streaming decoder biasanya lebih sederhana dan lebih aman daripada mmap.

---

## 21. Mmap dan Locking

`FileLock` bisa digunakan dengan `FileChannel`, tetapi jangan menganggap lock selalu menyelesaikan semua masalah.

Masalah:

- Lock bersifat platform-dependent.
- Banyak lock bersifat advisory.
- Process lain yang tidak mematuhi lock tetap bisa menulis.
- Lock tidak membuat update multi-byte menjadi transaksi.

Jika kamu membangun format mutable:

- gunakan lock untuk koordinasi,
- gunakan format-level consistency untuk recovery,
- gunakan checksum/commit marker untuk deteksi partial update.

---

## 22. Mmap vs `transferTo/transferFrom`

Keduanya sering disebut “zero-copy-ish”, tapi use case berbeda.

| Teknik | Cocok Untuk | Mental Model |
|---|---|---|
| `transferTo` / `transferFrom` | copy/transfer file ke channel lain | pindahkan bytes antar-channel seefisien mungkin |
| `MappedByteBuffer` | random access/process content | akses file sebagai memory region |

Jika kamu hanya ingin mengirim file ke socket:

```java
channel.transferTo(0, channel.size(), socketChannel);
```

Mmap tidak perlu.

Jika kamu ingin binary search index dalam file:

```java
buffer.getLong(offset)
```

Mmap masuk akal.

---

## 23. Mmap vs Direct ByteBuffer

| Aspek | Direct ByteBuffer | MappedByteBuffer |
|---|---|---|
| Backing | native memory | file-backed virtual memory |
| Dibuat dari | `ByteBuffer.allocateDirect` | `FileChannel.map` |
| Data source | memory kosong/diisi program | region file |
| Persistence | tidak otomatis persistent | bisa file-backed |
| Lifecycle | GC/Cleaner managed | GC/Cleaner managed, plus file mapping |
| Use case | network/file I/O buffer | random access file-backed data |

Direct buffer adalah memory off-heap. Mapped buffer adalah memory region yang didukung oleh file.

---

## 24. MemorySegment dan Java Modern

Pada Java modern, Foreign Function & Memory API memperkenalkan `MemorySegment` sebagai abstraction untuk region memory dengan bounds dan lifecycle lebih eksplisit.

`MemorySegment` dapat merepresentasikan:

- heap memory,
- native memory,
- mapped file memory.

Mengapa ini penting?

Karena salah satu kelemahan klasik `MappedByteBuffer` adalah lifecycle yang tidak eksplisit. Dengan API memory modern, Java bergerak ke arah abstraction memory yang lebih aman dan eksplisit.

Namun untuk seri ini, fokus utama tetap `MappedByteBuffer`, karena:

- ia adalah API historis yang banyak ditemukan,
- ia ada di Java SE sejak lama,
- banyak library/storage engine menggunakannya,
- mental model mmap tetap sama.

Saat masuk proyek modern yang heavily off-heap atau native interop, barulah `MemorySegment` perlu dipelajari lebih dalam.

---

## 25. Non-Volatile Mapped Byte Buffers

OpenJDK JEP 352 menambahkan dukungan untuk non-volatile mapped byte buffers, terutama untuk file di NVM-backed filesystem.

Ini bukan fitur yang kebanyakan aplikasi enterprise pakai setiap hari, tetapi penting secara konseptual:

- mapped byte buffer tidak hanya soal disk file biasa,
- storage/memory boundary makin kabur di hardware modern,
- durability dan flush semantics menjadi semakin penting.

Untuk aplikasi umum:

- jangan menggunakan fitur NVM-specific tanpa kebutuhan jelas,
- pahami storage environment dulu,
- validasi filesystem dan JDK support,
- tetap desain consistency protocol.

---

## 26. Observability untuk Mmap

Mmap sering membuat observability lebih sulit karena bottleneck bisa muncul sebagai page fault, bukan sebagai waktu `read()` eksplisit.

Yang perlu diamati:

### 26.1 Application metrics

- file size mapped,
- number of mappings,
- mapping duration,
- lookup latency,
- scan latency,
- page warmup duration,
- parse error count,
- checksum failure count,
- remap count,
- generation currently loaded.

### 26.2 JVM metrics

- direct memory usage,
- native memory tracking,
- GC behavior,
- safepoint pause,
- process RSS,
- virtual memory size.

### 26.3 OS metrics

- major page faults,
- minor page faults,
- disk read throughput,
- page cache pressure,
- swap activity,
- I/O wait,
- filesystem latency.

Jika service tiba-tiba latency spike saat `buffer.getLong(offset)`, penyebabnya bisa page fault, bukan Java method itu sendiri.

---

## 27. Testing Strategy

### 27.1 Test file format validation

- invalid magic,
- unsupported version,
- truncated header,
- truncated record,
- wrong checksum,
- invalid count,
- file size mismatch.

### 27.2 Test boundary

- empty file,
- one record,
- exact window size,
- window size + 1,
- record split across window,
- file > 2GB jika relevant.

### 27.3 Test mutation

- reader sees immutable snapshot,
- writer publishes new generation atomically,
- old generation cleanup delayed.

### 27.4 Test platform behavior

- Linux,
- Windows,
- container filesystem,
- network filesystem bila dipakai.

### 27.5 Test resource pressure

- many mapped files,
- low memory,
- large file,
- random access pattern,
- sequential access pattern,
- cold cache vs warm cache.

---

## 28. Anti-Pattern

### Anti-pattern 1 — Mmap semua file karena “lebih cepat”

Tidak benar. Mmap adalah trade-off, bukan universal optimization.

---

### Anti-pattern 2 — Mmap file text besar lalu cast byte ke char

Salah untuk UTF-8 dan hampir semua encoding modern.

---

### Anti-pattern 3 — Mapping file >2GB dalam satu `MappedByteBuffer`

`ByteBuffer` menggunakan `int` indexing. Gunakan windowed mapping.

---

### Anti-pattern 4 — Menganggap `force()` sebagai transaksi

`force()` hanya meminta flush dirty pages. Format consistency tetap tanggung jawab aplikasi.

---

### Anti-pattern 5 — Menghapus file mapped dan berharap selalu berhasil

Terutama bermasalah di Windows.

---

### Anti-pattern 6 — Mutable mmap tanpa version/checksum/commit marker

Jika crash terjadi, recovery akan sulit atau mustahil.

---

### Anti-pattern 7 — Menggunakan mmap untuk upload/download sequential sederhana

Biasanya `FileChannel.transferTo`, `Files.copy`, atau streaming biasa lebih tepat.

---

## 29. Decision Matrix

| Kebutuhan | Rekomendasi |
|---|---|
| Baca file kecil sebagai byte | `Files.readAllBytes`, jika ukuran terkendali |
| Baca text file line-by-line | `BufferedReader` / streaming parser |
| Copy file lokal | `Files.copy` atau `FileChannel.transferTo` |
| Kirim file ke socket | `FileChannel.transferTo` jika cocok |
| Random access binary file | `FileChannel` atau `MappedByteBuffer` |
| Lookup table besar read-only | `MappedByteBuffer` masuk akal |
| File >2GB random access | windowed mmap atau positional `FileChannel.read` |
| Mutable storage file | mmap bisa, tapi butuh journal/commit/checksum |
| CSV/JSON besar | streaming parser lebih aman |
| Butuh lifecycle memory eksplisit modern | evaluasi `MemorySegment` |
| Butuh portability sederhana | hindari mmap kecuali benar-benar perlu |

---

## 30. Production Pattern: Immutable Mapped Segment

Pattern paling aman untuk mmap di production adalah immutable segment.

### 30.1 Struktur directory

```text
data-index/
  generations/
    000001/
      index.bin
      manifest.json
    000002/
      index.bin
      manifest.json
  CURRENT
```

`CURRENT` menunjuk generation aktif.

---

### 30.2 Writer flow

```text
1. Build index di staging directory.
2. Validate size, checksum, count.
3. fsync files.
4. fsync directory.
5. Atomically publish generation.
6. Update CURRENT atomically.
```

---

### 30.3 Reader flow

```text
1. Read CURRENT.
2. Open generation directory.
3. Map index.bin READ_ONLY.
4. Validate header.
5. Serve lookup.
6. On refresh, open new generation first, then swap reference.
7. Cleanup old generation only after no readers.
```

---

### 30.4 Kenapa pattern ini kuat?

Karena:

- reader tidak melihat file setengah jadi,
- writer tidak mutate file aktif,
- rollback mudah,
- checksum bisa divalidasi,
- cleanup bisa ditunda,
- Windows behavior lebih mudah dikelola,
- observability per generation jelas.

---

## 31. Production Checklist

Sebelum memakai mmap, jawab pertanyaan berikut:

### Correctness

- Apakah file immutable selama dibaca?
- Apakah format punya magic number?
- Apakah format punya version?
- Apakah ukuran file divalidasi?
- Apakah ada checksum?
- Apakah ada recovery rule jika corrupt?
- Apakah record bisa split antar-window?

### Lifecycle

- Siapa owner mapped buffer?
- Kapan mapping dianggap tidak dipakai?
- Bagaimana cleanup file lama?
- Apakah Windows behavior sudah diuji?
- Apakah `channel.close()` tidak disalahpahami sebagai unmap?

### Performance

- Apakah access pattern random atau sequential?
- Apakah cold-cache latency acceptable?
- Apakah major page fault dimonitor?
- Apakah mapping size wajar?
- Apakah window size diuji?

### Security

- Apakah path divalidasi?
- Apakah file berasal dari trusted source?
- Apakah size limit diterapkan?
- Apakah corruption ditangani?
- Apakah file permission benar?

### Operations

- Apakah ada metrics untuk generation aktif?
- Apakah ada runbook untuk corrupt index?
- Apakah bisa rollback ke generation lama?
- Apakah cleanup aman?
- Apakah test dilakukan di OS target?

---

## 32. Latihan

### Latihan 1 — Read-only fixed record file

Buat file binary dengan layout:

```text
magic: int
version: int
recordCount: long
records:
  id: long
  amount: long
```

Tulis reader berbasis mmap yang:

- validasi magic,
- validasi version,
- validasi size,
- membaca semua record,
- menolak file corrupt.

---

### Latihan 2 — Windowed scanner

Buat scanner untuk file >2GB secara konsep dengan window 128MB.

Tangani:

- window offset,
- absolute offset,
- record boundary,
- file size mismatch.

Tidak perlu benar-benar membuat file 2GB jika environment terbatas; cukup test dengan window kecil seperti 64 byte.

---

### Latihan 3 — Immutable generation index

Implementasi sederhana:

```text
index/
  generations/
    000001/index.bin
  CURRENT
```

Buat:

- writer generation baru,
- reader generation aktif,
- atomic switch current,
- delayed cleanup simulation.

---

### Latihan 4 — Benchmark

Bandingkan:

1. `BufferedInputStream`
2. `FileChannel.read(ByteBuffer)`
3. `MappedByteBuffer`

Untuk:

- sequential scan,
- random lookup,
- cold cache jika bisa,
- warm cache.

Catat:

- throughput,
- latency p95/p99,
- memory/RSS,
- CPU usage,
- page fault jika tersedia.

---

## 33. Ringkasan

Memory-mapped file adalah teknik kuat, tetapi tidak boleh dipakai hanya karena terdengar high-performance.

Inti mental model:

```text
FileChannel.read:
  aplikasi eksplisit meminta bytes ke buffer

MappedByteBuffer:
  file region dipetakan ke virtual memory;
  akses byte bisa memicu page fault;
  OS mengelola loading/caching page
```

Gunakan mmap terutama untuk:

- random access,
- binary format offset-based,
- read-only index besar,
- immutable data segment,
- repeated lookup.

Hindari mmap untuk:

- text parsing biasa,
- sequential one-pass processing sederhana,
- file upload/download sederhana,
- mutable format tanpa crash consistency,
- environment yang butuh lifecycle file sangat deterministik.

Prinsip production paling penting:

> Memory-mapped file lebih aman jika file dianggap immutable snapshot, bukan mutable shared object sembarangan.

---

## 34. Koneksi ke Part Berikutnya

Part berikutnya akan masuk ke NIO.2 File API:

```text
Part 011 — NIO.2 File API: Path, Files, FileSystem, dan Modern File Operations
```

Di sana kita akan membahas:

- `Path`,
- `Files`,
- `FileSystem`,
- `FileStore`,
- symbolic link,
- real path,
- cross-platform path behavior,
- file existence check,
- file operation modern berbasis NIO.2.

Ini penting karena sebelum melakukan mmap, copy, move, atomic replace, watch, atau file ingestion, kita harus memahami dulu abstraction file modern Java secara benar.

---

## 35. Status Seri

Seri belum selesai.

Bagian yang sudah dibuat sampai titik ini:

```text
Part 000 — Mental Model Besar Java I/O
Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
Part 002 — Classic java.io: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance
Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil
Part 005 — Character I/O: Reader, Writer, Line Processing, Large Text File, dan Text Pipeline
Part 006 — Console I/O: System.in/out/err, Console, Password Input, dan CLI Interaction
Part 007 — NIO Core: Buffer, Channel, Selector, dan Perubahan Mental Model dari Stream
Part 008 — ByteBuffer Deep Dive: Heap, Direct, Mapped, Slice, Duplicate, View Buffer
Part 009 — FileChannel: Random Access, Transfer, Locking, Force, dan Zero-Copy
Part 010 — Memory-Mapped File: MappedByteBuffer, Page Cache, Huge Files, dan Trade-off
```

Bagian berikutnya:

```text
learn-java-io-nio-networking-data-transfer-part-011.md
```
