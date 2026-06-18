# Part 009 — FileChannel: Random Access, Transfer, Locking, Force, dan Zero-Copy

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-009.md`  
> Level: Advanced  
> Prasyarat: Part 000–008, terutama mental model stream/channel/buffer dan `ByteBuffer` state machine.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami `FileChannel` sebagai API file I/O berbasis **channel**, bukan sekadar versi lain dari `FileInputStream`.
2. Membedakan operasi file yang berbasis **current position** dan operasi **positional** yang eksplisit memakai offset.
3. Mendesain operasi file besar dengan pola:
   - sequential read/write,
   - random access,
   - file segment processing,
   - resumable transfer,
   - append-only storage,
   - atomic-ish publication,
   - controlled durability.
4. Memahami `transferTo` dan `transferFrom` sebagai optimasi transfer yang bisa mendekati **zero-copy**, tetapi tidak boleh dianggap magic.
5. Memahami `force()` sebagai boundary penting antara “data sudah ditulis ke channel” dan “data diminta dipaksa keluar ke storage device”.
6. Memahami file locking di Java sebagai mekanisme koordinasi yang punya batasan OS/filesystem dan tidak boleh disalahpahami sebagai distributed lock universal.
7. Menghindari bug umum seperti:
   - lupa menangani partial read/write,
   - salah memakai shared channel position,
   - menganggap `write()` pasti menulis semua byte,
   - menganggap `close()` selalu cukup untuk durability,
   - menganggap `transferTo()` selalu mentransfer seluruh file dalam satu call,
   - menggunakan file lock untuk problem yang seharusnya diselesaikan dengan database/coordination service.

---

## 2. Posisi `FileChannel` dalam Peta Java I/O

Di part sebelumnya kita sudah melihat bahwa `java.io` memodelkan data sebagai **stream**, sedangkan NIO memperkenalkan `Channel` dan `Buffer`.

`FileChannel` adalah channel khusus untuk file. Secara konseptual, ia menggabungkan beberapa kemampuan:

1. **Sequential I/O**  
   Membaca/menulis dari posisi channel saat ini.

2. **Random access I/O**  
   Membaca/menulis dari offset tertentu tanpa harus membaca seluruh file dari awal.

3. **Bulk transfer**  
   Mengirim byte dari/ke channel lain dengan `transferTo` dan `transferFrom`.

4. **Memory mapping**  
   Membuat `MappedByteBuffer` melalui `map()`.

5. **File metadata manipulation**  
   Mengecek `size()`, mengubah `position()`, melakukan `truncate()`.

6. **Durability request**  
   Meminta OS memaksa update ke storage lewat `force()`.

7. **File locking**  
   Mengambil shared/exclusive lock pada seluruh atau sebagian region file.

Dokumentasi Java mendeskripsikan `FileChannel` sebagai channel untuk membaca, menulis, memetakan, dan memanipulasi file. `FileChannel` juga merupakan `SeekableByteChannel`, sehingga ia punya konsep posisi dan ukuran file.

Referensi resmi:

- Java SE 25 `FileChannel`: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html>
- Java SE 21 `FileChannel`: <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html>

---

## 3. Mental Model: File Bukan Stream Murni, File Adalah Byte Array Persisten Berukuran Variabel

Untuk memahami `FileChannel`, bayangkan file sebagai:

```text
file = byte[0..N-1] yang tersimpan di filesystem
```

Lalu channel adalah handle aktif terhadap file itu:

```text
FileChannel
  ├── connected to one file
  ├── has current position
  ├── can read/write bytes
  ├── can query size
  ├── can truncate
  ├── can force updates
  └── can lock regions
```

Perbedaan penting dengan stream:

```text
InputStream / OutputStream
  fokus: aliran byte searah
  mental model: baca berikutnya / tulis berikutnya

FileChannel
  fokus: file sebagai sequence byte yang bisa di-seek
  mental model: baca/tulis di offset tertentu, atau pakai current position
```

Dengan `FileChannel`, kamu bisa melakukan hal-hal seperti:

```text
read 4 KB from offset 0
read 4 KB from offset 1_000_000
write header at offset 0
append body at end
truncate file to N bytes
transfer file segment to socket
lock region [1000, 2000)
force data to storage
```

Ini yang membuat `FileChannel` cocok untuk:

- file besar,
- binary format,
- index file,
- log segment,
- resumable download/upload,
- copy file besar,
- high-throughput file server,
- patching bagian tertentu dari file,
- preallocated file,
- checkpoint file,
- append-only storage,
- low-level persistence.

---

## 4. Cara Membuat `FileChannel`

Ada dua sumber umum:

1. Membuka langsung dari `FileChannel.open(...)`.
2. Mengambil channel dari `FileInputStream`, `FileOutputStream`, atau `RandomAccessFile`.

### 4.1 Membuka dengan `FileChannel.open`

```java
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class OpenFileChannelExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data.bin");

        try (FileChannel channel = FileChannel.open(
                path,
                StandardOpenOption.CREATE,
                StandardOpenOption.READ,
                StandardOpenOption.WRITE)) {

            System.out.println("size = " + channel.size());
        }
    }
}
```

Common options:

```text
READ        buka untuk membaca
WRITE       buka untuk menulis
CREATE      buat file jika belum ada
CREATE_NEW  buat file baru, gagal jika sudah ada
TRUNCATE_EXISTING potong file jadi kosong saat dibuka untuk write
APPEND      tulis selalu di akhir file
DELETE_ON_CLOSE hapus saat channel ditutup, best-effort
SYNC        setiap update content/metadata dilakukan synchronous ke storage
DSYNC       setiap update content dilakukan synchronous ke storage
```

### 4.2 Mengambil dari `FileInputStream`

```java
try (var in = new java.io.FileInputStream("data.bin");
     FileChannel channel = in.getChannel()) {
    // read only
}
```

### 4.3 Mengambil dari `FileOutputStream`

```java
try (var out = new java.io.FileOutputStream("data.bin");
     FileChannel channel = out.getChannel()) {
    // write only
}
```

### 4.4 Mengambil dari `RandomAccessFile`

```java
try (var raf = new java.io.RandomAccessFile("data.bin", "rw");
     FileChannel channel = raf.getChannel()) {
    // read + write + seek
}
```

`RandomAccessFile` sering muncul di codebase lama. Di code modern, `FileChannel.open(Path, options...)` biasanya lebih jelas karena open mode-nya eksplisit.

---

## 5. Open Option sebagai Kontrak, Bukan Detail Kecil

Kesalahan memilih open option bisa menghasilkan bug serius.

### 5.1 `CREATE` vs `CREATE_NEW`

```text
CREATE
  jika file belum ada -> buat
  jika file sudah ada -> buka file existing

CREATE_NEW
  jika file belum ada -> buat
  jika file sudah ada -> gagal
```

Untuk output job yang tidak boleh overwrite file existing, gunakan `CREATE_NEW`.

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    // safe from accidental overwrite
}
```

### 5.2 `TRUNCATE_EXISTING`

Option ini berbahaya jika dipakai tanpa sadar.

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING)) {
    // file langsung dikosongkan ketika dibuka
}
```

Anti-pattern:

```java
// Berbahaya: file dikosongkan sebelum semua validasi/lock/check selesai.
FileChannel.open(path, WRITE, TRUNCATE_EXISTING);
```

Lebih aman untuk file replacement:

```text
write temp file -> force -> atomic move
```

Kita bahas lebih dalam di part atomic file write, tetapi prinsipnya sudah relevan di sini.

### 5.3 `APPEND`

`APPEND` berarti setiap write dilakukan ke end-of-file. Ini bukan sekadar “set position ke size saat open”.

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.APPEND)) {
    // setiap write menuju akhir file
}
```

Namun jangan jadikan `APPEND` sebagai solusi semua concurrency. Atomicity append bergantung OS/filesystem dan ukuran write. Untuk append-only log yang benar-benar kritikal, desain record framing, checksum, recovery, dan single-writer discipline tetap penting.

### 5.4 `SYNC` dan `DSYNC`

`SYNC` dan `DSYNC` membuat update dilakukan synchronous ke storage. Ini bisa meningkatkan durability tetapi menurunkan throughput secara drastis.

```text
SYNC
  content + metadata diminta synchronous

DSYNC
  content diminta synchronous, metadata lebih terbatas
```

Gunakan dengan sadar untuk:

- journal,
- checkpoint,
- audit-critical write,
- financial/regulatory state,
- metadata penting.

Jangan aktifkan default untuk semua file hanya karena “lebih aman”. Itu bisa mengubah performa aplikasi secara ekstrem.

---

## 6. Current Position: State Tersembunyi yang Sering Menjadi Sumber Bug

`FileChannel` memiliki **current position**. Operasi `read(buffer)` dan `write(buffer)` tanpa offset memakai dan mengubah posisi ini.

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);

int n = channel.read(buffer); // reads from current position
// channel position advances by n if n > 0
```

Visual:

```text
file bytes:
+------+------+------+------+------+------+
|  0   |  1   |  2   |  3   |  4   | ...  |
+------+------+------+------+------+------+
                 ^
                 current position
```

Setelah read 3 byte:

```text
+------+------+------+------+------+------+
|  0   |  1   |  2   |  3   |  4   | ...  |
+------+------+------+------+------+------+
                                ^
                                current position
```

### 6.1 Query dan Set Position

```java
long current = channel.position();
channel.position(0);
```

### 6.2 Position adalah Mutable State

Masalah muncul ketika channel yang sama dipakai oleh banyak method/thread.

```java
void readHeader(FileChannel channel) throws IOException {
    channel.position(0);
    // read header
}

void readBody(FileChannel channel) throws IOException {
    channel.position(128);
    // read body
}
```

Jika dua method ini berjalan bersamaan pada channel yang sama, posisi bisa saling mengganggu.

Untuk concurrent/random access, lebih baik gunakan positional read/write.

---

## 7. Positional Read/Write: Offset Eksplisit, Lebih Aman untuk Random Access

`FileChannel` menyediakan operasi:

```java
int read(ByteBuffer dst, long position)
int write(ByteBuffer src, long position)
```

Operasi ini membaca/menulis pada offset tertentu **tanpa mengubah current position channel**.

Contoh membaca header di offset 0:

```java
static ByteBuffer readFullyAt(FileChannel channel, long offset, int size) throws IOException {
    ByteBuffer buffer = ByteBuffer.allocate(size);
    long position = offset;

    while (buffer.hasRemaining()) {
        int n = channel.read(buffer, position);
        if (n == -1) {
            throw new java.io.EOFException("Unexpected EOF at offset " + position);
        }
        position += n;
    }

    buffer.flip();
    return buffer;
}
```

Kenapa loop tetap perlu?

Karena `read(buffer, position)` tidak menjamin buffer penuh dalam satu call. Ia bisa membaca lebih sedikit dari yang diminta.

Contoh menulis block di offset tertentu:

```java
static void writeFullyAt(FileChannel channel, ByteBuffer src, long offset) throws IOException {
    long position = offset;

    while (src.hasRemaining()) {
        int n = channel.write(src, position);
        position += n;
    }
}
```

Positional write sangat berguna untuk:

- update header setelah body selesai ditulis,
- menulis index block,
- patching metadata,
- parallel write ke segment berbeda,
- resumable upload ke offset tertentu,
- file format dengan fixed-size page.

---

## 8. Partial Read dan Partial Write: Invariant yang Tidak Boleh Dilanggar

Salah satu bug I/O paling umum adalah menganggap satu call `read` atau `write` menyelesaikan seluruh buffer.

### 8.1 `read()` Bisa Membaca Sebagian

```java
int n = channel.read(buffer);
```

Kemungkinan:

```text
n > 0   sejumlah byte berhasil dibaca
n == 0  tidak ada byte terbaca sekarang
n == -1 end-of-file
```

Untuk file blocking biasa, `read()` biasanya tidak sering return 0 jika buffer masih punya ruang, tetapi code robust tetap tidak boleh bergantung pada “biasanya”.

### 8.2 `write()` Bisa Menulis Sebagian

```java
int n = channel.write(buffer);
```

`write()` bisa menulis hanya sebagian dari `buffer.remaining()`. Karena `ByteBuffer` position berubah sesuai byte yang berhasil ditulis, loop yang benar adalah:

```java
static void writeFully(FileChannel channel, ByteBuffer buffer) throws IOException {
    while (buffer.hasRemaining()) {
        channel.write(buffer);
    }
}
```

### 8.3 Helper: Read Exact Size

```java
static ByteBuffer readExact(FileChannel channel, int size) throws IOException {
    ByteBuffer buffer = ByteBuffer.allocate(size);

    while (buffer.hasRemaining()) {
        int n = channel.read(buffer);
        if (n == -1) {
            throw new java.io.EOFException(
                    "Expected " + size + " bytes, got " + buffer.position());
        }
    }

    buffer.flip();
    return buffer;
}
```

### 8.4 Helper: Copy Loop Manual

```java
static long copyWithBuffer(FileChannel source, FileChannel target, int bufferSize) throws IOException {
    ByteBuffer buffer = ByteBuffer.allocateDirect(bufferSize);
    long total = 0;

    while (true) {
        buffer.clear();
        int read = source.read(buffer);
        if (read == -1) {
            break;
        }
        if (read == 0) {
            continue;
        }

        buffer.flip();
        while (buffer.hasRemaining()) {
            total += target.write(buffer);
        }
    }

    return total;
}
```

---

## 9. `size()`, `truncate()`, dan File Growth

### 9.1 Query Size

```java
long size = channel.size();
```

`size()` mengembalikan ukuran file saat ini dalam byte.

### 9.2 Write Beyond Current End

Jika kamu menulis pada posisi setelah akhir file, file bisa membesar.

```java
ByteBuffer oneByte = ByteBuffer.wrap(new byte[] { 42 });
channel.write(oneByte, 1_000_000L);
```

Tergantung filesystem, area antara old EOF dan offset baru bisa menjadi hole/sparse region atau diisi nol secara logical. Jangan membangun asumsi storage fisik tanpa memahami filesystem.

### 9.3 Truncate

```java
channel.truncate(1024);
```

Jika file lebih besar dari 1024 byte, sisanya dipotong. Jika file lebih kecil, biasanya tidak diperbesar oleh truncate.

Use case:

- rollback partial write,
- recovery corrupted tail,
- limit file size,
- reset segment,
- implement compacted file.

### 9.4 Recovery Pattern: Truncate Corrupted Tail

Append-only file sering memakai record framing:

```text
[length][payload][checksum]
[length][payload][checksum]
[length][payload][checksum]
[partial corrupted record due to crash]
```

Saat startup:

1. Scan record dari awal atau checkpoint.
2. Validasi length dan checksum.
3. Jika menemukan tail rusak, truncate ke offset record terakhir yang valid.

```java
channel.truncate(lastKnownGoodOffset);
channel.force(true);
```

---

## 10. Scattering dan Gathering I/O

`FileChannel` mendukung:

```java
long read(ByteBuffer[] dsts)
long write(ByteBuffer[] srcs)
```

Ini disebut:

```text
Scattering read
  satu source -> banyak buffer

Gathering write
  banyak buffer -> satu sink
```

### 10.1 Gathering Write untuk Header + Body

Misalnya file format:

```text
[header][payload]
```

Daripada copy header dan payload ke satu buffer besar, kamu bisa:

```java
ByteBuffer header = ByteBuffer.allocate(16);
header.putInt(0xCAFE_BABE);
header.putInt(version);
header.putLong(payloadSize);
header.flip();

ByteBuffer payload = ByteBuffer.wrap(data);

while (header.hasRemaining() || payload.hasRemaining()) {
    channel.write(new ByteBuffer[] { header, payload });
}
```

Benefit:

- mengurangi copy,
- format lebih jelas,
- payload besar tidak perlu digabung ke buffer baru,
- cocok untuk network/file protocol.

### 10.2 Scattering Read untuk Header + Body Kecil

```java
ByteBuffer header = ByteBuffer.allocate(16);
ByteBuffer bodyPrefix = ByteBuffer.allocate(128);

long n = channel.read(new ByteBuffer[] { header, bodyPrefix });
```

Tetap perlu loop jika butuh exact size.

---

## 11. `transferTo` dan `transferFrom`: Bulk Transfer dan Zero-Copy Mental Model

`FileChannel` punya dua method penting:

```java
long transferTo(long position, long count, WritableByteChannel target)
long transferFrom(ReadableByteChannel src, long position, long count)
```

Dokumentasi Java menyebut bahwa method ini bisa jauh lebih efisien daripada loop read/write biasa; banyak OS bisa mentransfer bytes langsung dari source channel ke filesystem cache tanpa benar-benar menyalinnya ke user-space buffer. Dengan kata lain, method ini membuka peluang optimasi zero-copy atau reduced-copy.

Namun ada tiga hal penting:

1. `transferTo/transferFrom` tidak selalu benar-benar zero-copy di semua platform/skenario.
2. Satu call tidak dijamin mentransfer seluruh `count`.
3. Kamu tetap wajib loop sampai jumlah byte yang diinginkan selesai atau source EOF.

Referensi resmi Java SE 21 menyebut potensi efisiensi transfer langsung oleh OS: <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/FileChannel.html>

### 11.1 Copy File dengan `transferTo`

```java
static long copyFile(Path sourcePath, Path targetPath) throws IOException {
    try (FileChannel source = FileChannel.open(sourcePath, StandardOpenOption.READ);
         FileChannel target = FileChannel.open(
                 targetPath,
                 StandardOpenOption.CREATE,
                 StandardOpenOption.TRUNCATE_EXISTING,
                 StandardOpenOption.WRITE)) {

        long size = source.size();
        long position = 0;

        while (position < size) {
            long transferred = source.transferTo(position, size - position, target);
            if (transferred == 0) {
                // Defensive guard. Could happen due to platform/channel limitations.
                break;
            }
            position += transferred;
        }

        return position;
    }
}
```

Lebih defensif:

```java
static long copyFileRobust(Path sourcePath, Path targetPath) throws IOException {
    try (FileChannel source = FileChannel.open(sourcePath, StandardOpenOption.READ);
         FileChannel target = FileChannel.open(
                 targetPath,
                 StandardOpenOption.CREATE,
                 StandardOpenOption.TRUNCATE_EXISTING,
                 StandardOpenOption.WRITE)) {

        long size = source.size();
        long position = 0;

        while (position < size) {
            long transferred = source.transferTo(position, size - position, target);

            if (transferred > 0) {
                position += transferred;
                continue;
            }

            // Fallback if transferTo makes no progress.
            ByteBuffer fallback = ByteBuffer.allocateDirect(1024 * 1024);
            int read = source.read(fallback, position);
            if (read == -1) {
                break;
            }
            fallback.flip();
            while (fallback.hasRemaining()) {
                target.write(fallback);
            }
            position += read;
        }

        return position;
    }
}
```

### 11.2 Copy File dengan `transferFrom`

```java
static long copyFileTransferFrom(Path sourcePath, Path targetPath) throws IOException {
    try (FileChannel source = FileChannel.open(sourcePath, StandardOpenOption.READ);
         FileChannel target = FileChannel.open(
                 targetPath,
                 StandardOpenOption.CREATE,
                 StandardOpenOption.TRUNCATE_EXISTING,
                 StandardOpenOption.WRITE)) {

        long size = source.size();
        long position = 0;

        while (position < size) {
            long transferred = target.transferFrom(source, position, size - position);
            if (transferred == 0) {
                break;
            }
            position += transferred;
        }

        return position;
    }
}
```

### 11.3 `transferTo` untuk File Download ke Socket

Secara konseptual:

```java
try (FileChannel file = FileChannel.open(path, StandardOpenOption.READ);
     SocketChannel socket = SocketChannel.open(remoteAddress)) {

    long size = file.size();
    long position = 0;

    while (position < size) {
        long n = file.transferTo(position, size - position, socket);
        if (n == 0) {
            // For non-blocking socket, register OP_WRITE and retry later.
            // For blocking socket, handle carefully.
        }
        position += n;
    }
}
```

Dalam server non-blocking, `transferTo` harus diintegrasikan dengan event loop dan readiness `OP_WRITE`. Jangan membuat loop blocking panjang di event loop.

---

## 12. Zero-Copy: Apa yang Sebenarnya Dicoba Dihindari?

Manual copy biasanya seperti ini:

```text
Disk / page cache
   -> kernel buffer
   -> copy to JVM buffer
   -> copy from JVM buffer
   -> socket/kernel buffer
   -> NIC
```

Dengan zero-copy/reduced-copy, jalurnya bisa lebih dekat ke:

```text
page cache -> socket/kernel/NIC path
```

Tujuannya:

- mengurangi copy memory,
- mengurangi CPU usage,
- mengurangi cache pollution,
- meningkatkan throughput untuk file besar,
- menghindari alokasi buffer besar di JVM.

Namun “zero-copy” bukan janji absolut.

Faktor yang memengaruhi:

- OS,
- filesystem,
- source/target channel type,
- TLS/encryption,
- compression,
- kernel capability,
- JVM implementation,
- file size,
- socket blocking/non-blocking,
- platform limitation,
- apakah data perlu transformasi.

Jika kamu perlu melakukan transformasi data seperti:

```text
read -> decrypt -> decompress -> parse -> filter -> compress -> encrypt -> write
```

maka zero-copy file transfer tidak berlaku karena data memang harus masuk ke application layer.

---

## 13. `force()`: Durability Boundary yang Sering Disalahpahami

`write()` berarti data diberikan ke OS/JVM I/O layer. Itu tidak selalu berarti data sudah benar-benar persisted ke media storage.

`FileChannel.force(boolean metaData)` meminta update file dipaksa keluar ke underlying storage device.

```java
channel.force(true);
```

Parameter:

```text
force(false)
  force content update saja sejauh memungkinkan

force(true)
  force content + metadata update
```

Metadata bisa termasuk informasi seperti size, timestamps, directory entry, dan atribut lain tergantung OS/filesystem.

### 13.1 Kapan `force(false)` Cukup?

Jika file sudah ada dan kamu hanya mengubah content tanpa bergantung pada metadata baru:

```java
channel.write(buffer, offset);
channel.force(false);
```

Contoh:

- update page dalam fixed-size data file,
- update checkpoint content dengan file existing.

### 13.2 Kapan `force(true)` Lebih Aman?

Jika operasi mengubah metadata penting:

- file baru dibuat,
- ukuran file berubah,
- truncate,
- append yang memperbesar file,
- rename/move pattern perlu directory metadata sync.

```java
channel.write(buffer);
channel.force(true);
```

### 13.3 `force()` Bukan Magic Guarantee Absolut

Bahkan `force()` tetap berada di atas realitas hardware/OS:

- storage controller bisa punya cache,
- virtualized/cloud disk punya lapisan tambahan,
- network filesystem punya semantics sendiri,
- OS/filesystem bisa punya limitasi.

Tetapi secara engineering, `force()` adalah API Java standar untuk meminta durability lebih kuat dibanding write biasa.

### 13.4 Cost of Force

`force()` bisa mahal karena memaksa flush. Jika dipanggil setiap record kecil:

```text
write 100 bytes
force
write 100 bytes
force
write 100 bytes
force
```

throughput bisa hancur.

Pola lebih realistis:

```text
write many records
force per batch / per transaction / per checkpoint
```

Trade-off:

```text
force setiap record
  durability tinggi
  latency tinggi
  throughput rendah

force per batch
  durability window lebih besar
  throughput lebih baik

force periodik
  cocok untuk log/analytics tertentu
  risiko kehilangan data sejak force terakhir
```

---

## 14. Crash-Safe-ish Write Pattern dengan FileChannel

Untuk menulis file output final, jangan langsung overwrite file target.

Pola yang lebih aman:

```text
1. write ke temp file di directory yang sama
2. force temp file
3. close temp file
4. atomic move temp -> final
5. optionally fsync directory
```

Contoh dasar:

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.EnumSet;

public final class AtomicFilePublisher {
    public static void writeAtomically(Path target, byte[] data) throws IOException {
        Path dir = target.toAbsolutePath().getParent();
        Path temp = Files.createTempFile(dir, target.getFileName().toString(), ".tmp");

        boolean moved = false;
        try {
            try (FileChannel channel = FileChannel.open(
                    temp,
                    StandardOpenOption.WRITE,
                    StandardOpenOption.TRUNCATE_EXISTING)) {

                ByteBuffer buffer = ByteBuffer.wrap(data);
                while (buffer.hasRemaining()) {
                    channel.write(buffer);
                }
                channel.force(true);
            }

            Files.move(
                    temp,
                    target,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
            moved = true;
        } finally {
            if (!moved) {
                Files.deleteIfExists(temp);
            }
        }
    }
}
```

Catatan:

- `ATOMIC_MOVE` biasanya mensyaratkan source dan target berada pada filesystem yang sama.
- Untuk durability metadata directory setelah rename, Java tidak menyediakan API portable sempurna untuk semua platform; di Unix-like system kadang directory dibuka dan di-force melalui channel, tetapi portabilitasnya terbatas.
- Part atomic write akan membahas ini lebih dalam.

---

## 15. File Locking: Koordinasi, Bukan Jaminan Universal

`FileChannel` menyediakan:

```java
FileLock lock()
FileLock tryLock()
FileLock lock(long position, long size, boolean shared)
FileLock tryLock(long position, long size, boolean shared)
```

Ada dua tipe umum:

```text
exclusive lock
  hanya satu writer/owner

shared lock
  banyak reader bisa share, writer dicegah
```

Namun semantics lock sangat dipengaruhi OS dan filesystem.

### 15.1 Exclusive Lock Seluruh File

```java
try (FileChannel channel = FileChannel.open(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE);
     FileLock lock = channel.lock()) {

    // exclusive access according to platform lock semantics
}
```

### 15.2 Try Lock

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.WRITE)) {
    FileLock lock = channel.tryLock();
    if (lock == null) {
        System.out.println("File is already locked by another process");
        return;
    }

    try (lock) {
        // do work
    }
}
```

### 15.3 Region Lock

```java
long offset = 1024;
long length = 4096;
boolean shared = false;

try (FileLock lock = channel.lock(offset, length, shared)) {
    // lock region [1024, 5120)
}
```

Use case:

- multiple process update region berbeda,
- file-based coordination sederhana,
- prevent simultaneous import/export job pada file yang sama,
- local desktop app data file,
- test tool sederhana.

### 15.4 File Lock Caveats

Jangan menganggap file lock sebagai:

- distributed lock yang aman untuk microservices,
- pengganti database transaction,
- pengganti object storage conditional write,
- pengganti leader election,
- portable guarantee lintas semua filesystem.

Problem nyata:

```text
local filesystem       biasanya cukup predictable
network filesystem     semantics bisa berbeda
container volume       tergantung driver
Windows vs Unix        behavior bisa berbeda
same JVM overlapping   bisa throw OverlappingFileLockException
crash                  lock biasanya dilepas oleh OS, tapi recovery state tetap perlu
```

Untuk distributed system, gunakan mekanisme yang memang didesain untuk itu:

- database row lock/advisory lock,
- PostgreSQL advisory lock,
- Redis dengan hati-hati dan fencing token,
- ZooKeeper/etcd/Consul,
- object storage conditional write / ETag,
- message queue single consumer semantics,
- lease dengan fencing.

---

## 16. Append-Only Log dengan FileChannel

Append-only file adalah pattern penting untuk:

- local event log,
- audit trail lokal,
- write-ahead log sederhana,
- ingestion checkpoint,
- failure recovery,
- debugging trace.

Format minimal record:

```text
[length:int][payload:bytes][crc:int]
```

Contoh writer sederhana:

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.CRC32;

public final class AppendOnlyRecordLog implements AutoCloseable {
    private final FileChannel channel;

    public AppendOnlyRecordLog(Path path) throws IOException {
        this.channel = FileChannel.open(
                path,
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE,
                StandardOpenOption.READ);
        this.channel.position(this.channel.size());
    }

    public synchronized long append(byte[] payload, boolean force) throws IOException {
        if (payload.length > 16 * 1024 * 1024) {
            throw new IllegalArgumentException("payload too large: " + payload.length);
        }

        CRC32 crc32 = new CRC32();
        crc32.update(payload);
        int crc = (int) crc32.getValue();

        ByteBuffer header = ByteBuffer.allocate(Integer.BYTES);
        header.putInt(payload.length);
        header.flip();

        ByteBuffer body = ByteBuffer.wrap(payload);

        ByteBuffer trailer = ByteBuffer.allocate(Integer.BYTES);
        trailer.putInt(crc);
        trailer.flip();

        long offset = channel.position();

        while (header.hasRemaining() || body.hasRemaining() || trailer.hasRemaining()) {
            channel.write(new ByteBuffer[] { header, body, trailer });
        }

        if (force) {
            channel.force(false);
        }

        return offset;
    }

    @Override
    public void close() throws IOException {
        channel.close();
    }
}
```

Perhatikan `synchronized`. Itu bukan untuk performa tertinggi, tetapi untuk menjaga invariant:

```text
satu writer logical -> posisi append tidak saling interleave
```

Tanpa single-writer discipline, record bisa bercampur.

---

## 17. Membaca Append-Only Log dan Recovery Tail

Reader perlu validasi:

1. Apakah length masuk akal?
2. Apakah payload lengkap?
3. Apakah checksum cocok?
4. Jika tail partial, truncate atau abaikan?

Contoh scanner:

```java
import java.io.EOFException;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.Arrays;
import java.util.zip.CRC32;

public final class RecordLogScanner {
    public interface RecordHandler {
        void onRecord(long offset, byte[] payload) throws IOException;
    }

    public static long scan(FileChannel channel, int maxPayloadSize, RecordHandler handler) throws IOException {
        long offset = 0;
        long size = channel.size();
        long lastGoodOffset = 0;

        while (offset < size) {
            long recordStart = offset;

            ByteBuffer lengthBuffer = ByteBuffer.allocate(Integer.BYTES);
            int lengthRead = readUpTo(channel, lengthBuffer, offset);
            if (lengthRead < Integer.BYTES) {
                break;
            }
            lengthBuffer.flip();
            int length = lengthBuffer.getInt();
            offset += Integer.BYTES;

            if (length < 0 || length > maxPayloadSize) {
                break;
            }

            if (offset + length + Integer.BYTES > size) {
                break;
            }

            ByteBuffer payloadBuffer = ByteBuffer.allocate(length);
            readFullyAt(channel, payloadBuffer, offset);
            payloadBuffer.flip();
            byte[] payload = new byte[length];
            payloadBuffer.get(payload);
            offset += length;

            ByteBuffer crcBuffer = ByteBuffer.allocate(Integer.BYTES);
            readFullyAt(channel, crcBuffer, offset);
            crcBuffer.flip();
            int expectedCrc = crcBuffer.getInt();
            offset += Integer.BYTES;

            CRC32 crc32 = new CRC32();
            crc32.update(payload);
            int actualCrc = (int) crc32.getValue();

            if (expectedCrc != actualCrc) {
                break;
            }

            handler.onRecord(recordStart, payload);
            lastGoodOffset = offset;
        }

        return lastGoodOffset;
    }

    private static int readUpTo(FileChannel channel, ByteBuffer buffer, long offset) throws IOException {
        int total = 0;
        long position = offset;
        while (buffer.hasRemaining()) {
            int n = channel.read(buffer, position);
            if (n == -1) {
                return total;
            }
            if (n == 0) {
                return total;
            }
            total += n;
            position += n;
        }
        return total;
    }

    private static void readFullyAt(FileChannel channel, ByteBuffer buffer, long offset) throws IOException {
        long position = offset;
        while (buffer.hasRemaining()) {
            int n = channel.read(buffer, position);
            if (n == -1) {
                throw new EOFException("Unexpected EOF at " + position);
            }
            position += n;
        }
    }
}
```

Recovery:

```java
long lastGood = RecordLogScanner.scan(channel, 16 * 1024 * 1024, (offset, payload) -> {
    // rebuild state
});

if (lastGood < channel.size()) {
    channel.truncate(lastGood);
    channel.force(true);
}
```

Ini contoh bagaimana `FileChannel` memungkinkan recovery berbasis offset.

---

## 18. Resumable File Transfer dengan Offset

File transfer robust biasanya butuh state:

```text
source file
  size
  checksum
  chunks
  chunk offset
  chunk length
  transferred bytes
  finalization status
```

Dengan `FileChannel`, kita bisa transfer per chunk.

### 18.1 Membaca Chunk dari Offset

```java
static byte[] readChunk(Path path, long offset, int length) throws IOException {
    try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
        ByteBuffer buffer = ByteBuffer.allocate(length);
        long position = offset;

        while (buffer.hasRemaining()) {
            int n = channel.read(buffer, position);
            if (n == -1) {
                break;
            }
            position += n;
        }

        buffer.flip();
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);
        return bytes;
    }
}
```

### 18.2 Menulis Chunk ke Offset

```java
static void writeChunk(Path path, long offset, byte[] bytes) throws IOException {
    try (FileChannel channel = FileChannel.open(
            path,
            StandardOpenOption.CREATE,
            StandardOpenOption.WRITE)) {

        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        long position = offset;

        while (buffer.hasRemaining()) {
            int n = channel.write(buffer, position);
            position += n;
        }
    }
}
```

### 18.3 Manifest

```json
{
  "fileName": "report-2026-06.bin",
  "size": 734003200,
  "chunkSize": 4194304,
  "chunks": [
    { "index": 0, "offset": 0, "length": 4194304, "sha256": "..." },
    { "index": 1, "offset": 4194304, "length": 4194304, "sha256": "..." }
  ]
}
```

`FileChannel` cocok karena offset adalah primitive utama.

---

## 19. Sparse File dan Preallocation: Jangan Terlalu Banyak Berasumsi

Jika kamu menulis byte di offset jauh dari EOF:

```java
channel.write(ByteBuffer.wrap(new byte[] {1}), 10L * 1024 * 1024 * 1024);
```

File logical size bisa menjadi besar. Namun storage fisik belum tentu dialokasikan penuh jika filesystem mendukung sparse file.

Bahaya:

- ukuran file terlihat besar,
- copy ke filesystem lain bisa mengembang besar,
- checksum seluruh file membaca logical zero area,
- tool berbeda bisa melaporkan size berbeda (`size` vs allocated blocks),
- object storage tidak punya semantics yang sama.

Java standard `FileChannel` tidak menyediakan portable preallocation API seperti `fallocate`. Jika kamu butuh preallocation kuat, perlu strategi platform-specific atau menulis data aktual.

---

## 20. `FileChannel` dan Thread-Safety

`FileChannel` object aman digunakan oleh banyak thread dalam arti method-nya didesain untuk menangani concurrent access tertentu, tetapi bukan berarti semua operasi logical aman.

Problem utama:

```text
current position adalah shared mutable state
```

### 20.1 Bahaya Shared Position

```java
// Thread A
channel.position(0);
channel.read(bufferA);

// Thread B
channel.position(1000);
channel.read(bufferB);
```

Interleaving bisa merusak asumsi.

### 20.2 Gunakan Positional I/O untuk Concurrent Read

```java
channel.read(bufferA, 0);
channel.read(bufferB, 1000);
```

Ini lebih aman karena tidak mengubah shared current position.

### 20.3 Concurrent Write Tetap Butuh Desain

Walaupun positional write memungkinkan thread berbeda menulis offset berbeda, kamu tetap perlu invariant:

```text
Tidak boleh ada dua writer menulis region yang overlap.
Metadata update harus dikoordinasikan.
Finalization harus atomic.
Checksum/manifest harus konsisten.
```

Gunakan partitioning:

```text
thread-0 writes chunk 0..99
thread-1 writes chunk 100..199
thread-2 writes chunk 200..299
```

Lalu manifest/final state ditulis oleh satu coordinator.

---

## 21. `FileChannel` vs `Files` Utility

Kapan cukup pakai `Files`?

```java
Files.copy(source, target);
Files.readAllBytes(path);
Files.write(path, bytes);
Files.newInputStream(path);
Files.newOutputStream(path);
```

Gunakan `Files` jika:

- file kecil/sedang,
- operasi sederhana,
- tidak perlu offset,
- tidak perlu explicit force,
- tidak perlu lock,
- tidak perlu transfer segment,
- readability lebih penting.

Gunakan `FileChannel` jika:

- file besar,
- butuh random access,
- butuh positional write,
- butuh transferTo/transferFrom,
- butuh memory mapping,
- butuh force,
- butuh lock,
- butuh truncate,
- butuh recovery berdasarkan offset,
- butuh format binary/page/segment.

Decision table:

| Kebutuhan | API yang Cocok |
|---|---|
| Baca file config kecil | `Files.readString` |
| Tulis output text kecil | `Files.writeString` |
| Copy file biasa | `Files.copy` |
| Copy file besar dengan progress/resume | `FileChannel` |
| Update header binary di offset 0 | `FileChannel.write(buffer, 0)` |
| Append record ke log | `FileChannel` |
| Force durability checkpoint | `FileChannel.force` |
| Watch directory | `WatchService` |
| Traverse directory | `Files.walkFileTree` |
| Memory mapped index | `FileChannel.map` |

---

## 22. `FileChannel` vs `RandomAccessFile`

`RandomAccessFile` menyediakan operasi seek/read/write lama:

```java
RandomAccessFile raf = new RandomAccessFile("data.bin", "rw");
raf.seek(100);
raf.writeInt(42);
```

`FileChannel` lebih modern dan lebih composable:

```java
FileChannel channel = raf.getChannel();
```

Gunakan `RandomAccessFile` jika kamu bekerja dengan legacy API atau butuh method seperti `readInt()` secara langsung.

Gunakan `FileChannel` jika:

- butuh buffer/channel model,
- transferTo/transferFrom,
- map,
- lock region,
- positional operations,
- integration dengan NIO.

---

## 23. `FileChannel` dan Memory-Mapped File

`FileChannel.map()` menghasilkan `MappedByteBuffer`.

```java
MappedByteBuffer mapped = channel.map(
        FileChannel.MapMode.READ_ONLY,
        0,
        channel.size());
```

Ini akan dibahas khusus di Part 010. Untuk saat ini cukup pahami:

```text
FileChannel
  menyediakan pintu menuju mmap

MappedByteBuffer
  bukan sekadar buffer biasa
  ia merepresentasikan region file yang dipetakan ke virtual memory
```

Gunakan mmap dengan hati-hati untuk:

- random access file besar,
- index file,
- read-heavy workload,
- memory-like access pattern.

Jangan otomatis memakai mmap untuk semua file besar.

---

## 24. Error Handling dan Exception yang Perlu Dipahami

Beberapa exception umum:

```text
IOException
  base I/O failure

EOFException
  biasanya kita throw sendiri saat expected exact bytes tapi EOF terjadi

ClosedChannelException
  channel sudah ditutup

NonReadableChannelException
  read pada channel yang tidak dibuka READ

NonWritableChannelException
  write pada channel yang tidak dibuka WRITE

FileLockInterruptionException
  thread interrupted saat menunggu lock

OverlappingFileLockException
  lock overlap di JVM yang sama

AccessDeniedException
  permission issue dari java.nio.file

NoSuchFileException
  file tidak ada

FileAlreadyExistsException
  CREATE_NEW pada file existing
```

Design rule:

```text
Jangan treat semua IOException sama.
```

Contoh klasifikasi:

| Failure | Retry? | Catatan |
|---|---:|---|
| Permission denied | Tidak | Butuh config/permission fix |
| No such file | Tergantung | Bisa transient jika producer belum publish |
| Disk full | Tidak langsung | Butuh cleanup/capacity action |
| File locked | Bisa | Retry dengan timeout/backoff |
| Partial write | Bukan exception | Harus loop |
| EOF saat exact read | Tidak | Data corrupt/truncated |
| Interrupted saat lock | Tergantung | Respect cancellation |

---

## 25. Production Pattern: Large File Copy dengan Progress, Force, dan Verification

Contoh copy file dengan:

- progress callback,
- `transferTo`,
- fallback guard,
- optional force,
- size verification.

```java
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class LargeFileCopier {
    public interface ProgressListener {
        void onProgress(long copiedBytes, long totalBytes);
    }

    public static void copy(
            Path sourcePath,
            Path targetPath,
            boolean forceTarget,
            ProgressListener progress) throws IOException {

        try (FileChannel source = FileChannel.open(sourcePath, StandardOpenOption.READ);
             FileChannel target = FileChannel.open(
                     targetPath,
                     StandardOpenOption.CREATE,
                     StandardOpenOption.TRUNCATE_EXISTING,
                     StandardOpenOption.WRITE)) {

            long total = source.size();
            long copied = 0;

            while (copied < total) {
                long transferred = source.transferTo(copied, total - copied, target);

                if (transferred == 0) {
                    transferred = fallbackCopyOneChunk(source, target, copied, total - copied);
                    if (transferred == 0) {
                        throw new IOException("No progress while copying at offset " + copied);
                    }
                }

                copied += transferred;
                if (progress != null) {
                    progress.onProgress(copied, total);
                }
            }

            if (forceTarget) {
                target.force(true);
            }

            long targetSize = target.size();
            if (targetSize != total) {
                throw new IOException("Copy size mismatch: source=" + total + ", target=" + targetSize);
            }
        }
    }

    private static long fallbackCopyOneChunk(
            FileChannel source,
            FileChannel target,
            long offset,
            long remaining) throws IOException {

        int chunkSize = (int) Math.min(1024L * 1024L, remaining);
        ByteBuffer buffer = ByteBuffer.allocateDirect(chunkSize);

        int read = source.read(buffer, offset);
        if (read <= 0) {
            return 0;
        }

        buffer.flip();
        long written = 0;
        long targetOffset = offset;

        while (buffer.hasRemaining()) {
            int n = target.write(buffer, targetOffset);
            written += n;
            targetOffset += n;
        }

        return written;
    }
}
```

Catatan:

- Size verification bukan checksum. Ia hanya mengecek panjang.
- Untuk transfer kritikal, tambahkan checksum SHA-256 atau CRC per chunk.
- Untuk atomic publication, copy ke temp lalu move.

---

## 26. Production Pattern: Resumable Local Download Writer

Misalnya kamu download file via HTTP range request. Setiap response chunk ditulis ke offset tertentu.

```java
public final class ResumableFileWriter implements AutoCloseable {
    private final FileChannel channel;

    public ResumableFileWriter(Path path) throws IOException {
        this.channel = FileChannel.open(
                path,
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE,
                StandardOpenOption.READ);
    }

    public void writeAt(long offset, ByteBuffer data) throws IOException {
        long position = offset;
        while (data.hasRemaining()) {
            int n = channel.write(data, position);
            position += n;
        }
    }

    public void flushToDisk(boolean metadata) throws IOException {
        channel.force(metadata);
    }

    public long size() throws IOException {
        return channel.size();
    }

    @Override
    public void close() throws IOException {
        channel.close();
    }
}
```

State eksternal yang dibutuhkan:

```text
file-id
expected-size
chunk-size
completed-chunks bitmap/list
per-chunk checksum
whole-file checksum
status: DOWNLOADING / VERIFYING / COMPLETE / FAILED
```

Tanpa manifest, resume rentan salah karena file lokal bisa partial/corrupt.

---

## 27. Production Pattern: Fixed-Size Page File

Banyak storage engine sederhana memakai page tetap:

```text
page size = 4096 bytes
page id   = 0, 1, 2, ...
offset    = pageId * pageSize
```

Read page:

```java
static ByteBuffer readPage(FileChannel channel, long pageId, int pageSize) throws IOException {
    long offset = Math.multiplyExact(pageId, pageSize);
    ByteBuffer page = ByteBuffer.allocate(pageSize);

    while (page.hasRemaining()) {
        int n = channel.read(page, offset + page.position());
        if (n == -1) {
            throw new java.io.EOFException("Page not found: " + pageId);
        }
    }

    page.flip();
    return page;
}
```

Write page:

```java
static void writePage(FileChannel channel, long pageId, ByteBuffer page, int pageSize) throws IOException {
    if (page.remaining() != pageSize) {
        throw new IllegalArgumentException("Page must be exactly " + pageSize + " bytes");
    }

    long baseOffset = Math.multiplyExact(pageId, pageSize);
    long offset = baseOffset;

    while (page.hasRemaining()) {
        int n = channel.write(page, offset);
        offset += n;
    }
}
```

Invariant penting:

```text
page write tidak boleh interleave
page checksum/version membantu recovery
metadata root pointer harus durable
```

Ini mengarah ke konsep storage engine, B-tree, WAL, dan crash recovery. Kita tidak akan masuk terlalu jauh di seri ini, tetapi mental model-nya penting.

---

## 28. Security Notes

### 28.1 Jangan Terima Path Mentah dari User

`FileChannel.open(path, ...)` hanya aman jika `path` sudah divalidasi.

Risiko:

```text
../../etc/passwd
..\..\secret.txt
symlink to sensitive file
absolute path injection
unicode normalization trick
```

Validasi path lebih dalam dibahas pada part security dan filesystem.

### 28.2 Lock File Bukan Access Control

File lock tidak menggantikan permission OS. Tetap atur:

- directory permission,
- file owner,
- file mode,
- container volume security,
- least privilege.

### 28.3 `force()` Tidak Mengenkripsi Data

Durability bukan confidentiality. Jika file mengandung data sensitif:

- encrypt at rest,
- protect temp file,
- avoid writing secrets to world-readable directory,
- avoid logging path/content sensitif,
- set permission eksplisit jika perlu.

### 28.4 Resource Exhaustion

FileChannel bisa dipakai untuk membuat file sangat besar jika offset tidak divalidasi.

```java
channel.write(buffer, Long.MAX_VALUE - 10);
```

Selalu validasi:

- max offset,
- max file size,
- max chunk size,
- max concurrent open file,
- available disk/capacity.

---

## 29. Performance Notes

### 29.1 `FileChannel` Tidak Otomatis Lebih Cepat

`FileChannel` memberi kontrol lebih, tetapi performa tetap bergantung pada:

- access pattern,
- buffer size,
- heap vs direct buffer,
- OS page cache,
- storage type,
- filesystem,
- concurrency,
- flush/force frequency,
- transfer size,
- CPU cache behavior,
- GC pressure.

Untuk file kecil, `Files.readAllBytes` bisa cukup dan lebih sederhana.

### 29.2 Direct Buffer Bisa Membantu, Bisa Juga Mahal

Untuk I/O besar, direct buffer sering membantu mengurangi copy antara heap dan native I/O layer. Tetapi alokasi direct buffer lebih mahal dan memory-nya di luar heap.

Rule praktis:

```text
small one-off operation
  heap buffer cukup

large repeated I/O
  direct buffer layak dicoba

high-throughput server
  reuse/pool direct buffer, jangan allocate per request sembarangan
```

### 29.3 `transferTo` untuk Large Static File

Cocok untuk:

- static file server,
- large download,
- backup copy,
- local file copy,
- sending file to socket without transformation.

Kurang cocok jika:

- perlu compress/encrypt per byte di aplikasi,
- perlu inspect/transform content,
- memakai TLS layer yang mencegah zero-copy murni,
- target bukan channel yang mendukung path optimal.

### 29.4 `force()` adalah Latency Amplifier

Panggilan `force()` bisa menjadi bottleneck terbesar. Ukur:

- p50/p95/p99 force latency,
- throughput record/sec,
- batch size,
- disk queue depth,
- cloud volume burst balance,
- filesystem mount option.

### 29.5 Benchmark dengan Realistic Workload

Jangan benchmark hanya:

```text
copy 1 file 1 kali di laptop panas dengan cache penuh
```

Uji:

- cold cache vs warm cache,
- file kecil banyak vs file besar sedikit,
- sequential vs random,
- local SSD vs network disk,
- force on/off,
- heap vs direct,
- single thread vs multiple thread,
- checksum on/off,
- target filesystem yang sama dengan production.

---

## 30. Observability untuk FileChannel-based System

Untuk production, log dan metric minimal:

```text
file_path atau logical file id
operation: read/write/copy/transfer/force/lock/truncate
bytes_requested
bytes_completed
offset
latency_ms
throughput_bytes_per_sec
retry_count
force_latency_ms
lock_wait_ms
exception_type
error_category
checksum_result
```

Hindari logging data sensitif atau path absolut jika path mengandung tenant/user info.

Metric penting:

| Metric | Makna |
|---|---|
| `file_io_bytes_read_total` | total bytes dibaca |
| `file_io_bytes_written_total` | total bytes ditulis |
| `file_io_operation_latency` | latency operasi |
| `file_io_force_latency` | latency force/fsync-like operation |
| `file_io_lock_wait_latency` | waktu menunggu lock |
| `file_io_partial_transfer_count` | transferTo/write/read partial count |
| `file_io_error_count` | jumlah error by type |
| `file_io_active_channels` | channel aktif |
| `file_io_open_failures` | gagal membuka file |
| `file_io_disk_full_errors` | indikasi capacity issue |

---

## 31. Anti-Pattern yang Harus Dihindari

### Anti-Pattern 1 — Menganggap `write()` Menulis Semua Byte

```java
channel.write(buffer); // salah jika dianggap pasti selesai
```

Benar:

```java
while (buffer.hasRemaining()) {
    channel.write(buffer);
}
```

### Anti-Pattern 2 — Shared Current Position di Multi-thread

```java
channel.position(offset);
channel.read(buffer);
```

Benar untuk concurrent random access:

```java
channel.read(buffer, offset);
```

### Anti-Pattern 3 — Overwrite File Target Langsung

```java
FileChannel.open(target, WRITE, TRUNCATE_EXISTING);
```

Lebih aman:

```text
write temp -> force -> move atomically
```

### Anti-Pattern 4 — `force()` Setiap Baris Log Tanpa Alasan

```text
write record -> force
write record -> force
write record -> force
```

Gunakan batch/group commit jika domain mengizinkan.

### Anti-Pattern 5 — Menganggap `transferTo()` Selalu Satu Call Selesai

```java
source.transferTo(0, source.size(), target); // belum tentu semua byte
```

Benar:

```java
long pos = 0;
long size = source.size();
while (pos < size) {
    long n = source.transferTo(pos, size - pos, target);
    if (n == 0) throw new IOException("No progress");
    pos += n;
}
```

### Anti-Pattern 6 — File Lock untuk Distributed Coordination

File lock bukan solusi umum untuk multi-node microservice.

### Anti-Pattern 7 — Tidak Menutup Channel

Gunakan `try-with-resources`.

```java
try (FileChannel channel = FileChannel.open(path, READ)) {
    // work
}
```

### Anti-Pattern 8 — Menggunakan Offset Tanpa Validasi

```java
channel.write(buffer, userProvidedOffset);
```

Validasi:

```text
offset >= 0
offset <= max allowed
length <= max chunk
(offset + length) tidak overflow
```

Gunakan `Math.addExact` atau check manual untuk mencegah overflow.

---

## 32. Decision Matrix

| Problem | Recommended Approach |
|---|---|
| Copy file kecil | `Files.copy` |
| Copy file besar dengan progress | `FileChannel.transferTo` loop |
| Copy file besar dengan transformasi | Manual buffer loop |
| Download file besar resume | `FileChannel.write(buffer, offset)` + manifest |
| Update binary header | positional `write(buffer, 0)` |
| Append audit record lokal | single-writer `FileChannel` append + checksum |
| Need durability per checkpoint | `force(false/true)` sesuai metadata |
| Need exclusive local process access | `FileLock`, dengan caveat |
| Need distributed lock | database/etcd/ZooKeeper/Redis fencing, bukan FileLock biasa |
| Random read index besar | `FileChannel` positional read atau mmap |
| Serve static file to socket | `transferTo`, perhatikan TLS/non-blocking |
| File format page-based | fixed offset + positional read/write |
| Crash-safe publication | temp file + force + atomic move |

---

## 33. Checklist Engineering saat Memakai `FileChannel`

Sebelum memakai `FileChannel`, jawab pertanyaan berikut:

### Access Pattern

- Apakah sequential atau random?
- Apakah read-only, write-only, atau read-write?
- Apakah butuh append?
- Apakah perlu update offset tertentu?
- Apakah file bisa sangat besar?

### Correctness

- Apakah partial read/write sudah ditangani?
- Apakah EOF unexpected dibedakan dari EOF normal?
- Apakah offset dan length divalidasi?
- Apakah current position shared aman?
- Apakah concurrent write bisa overlap?
- Apakah truncate aman?

### Durability

- Apakah data harus survive crash?
- Kapan memanggil `force()`?
- Apakah metadata perlu di-force?
- Apakah file replacement atomic?
- Apakah temp file dibersihkan saat gagal?

### Performance

- Berapa buffer size?
- Heap atau direct buffer?
- Apakah buffer direuse?
- Apakah `transferTo` cocok?
- Apakah `force()` terlalu sering?
- Apakah workload sequential/random?

### Security

- Apakah path dari user sudah divalidasi?
- Apakah symlink traversal dicegah?
- Apakah permission benar?
- Apakah file sensitif ditulis ke temp directory aman?
- Apakah max file size/chunk size dibatasi?

### Operations

- Apakah ada progress metric?
- Apakah failure bisa di-resume?
- Apakah checksum tersedia?
- Apakah log cukup untuk investigasi?
- Apakah cleanup job tersedia?

---

## 34. Latihan

### Latihan 1 — Copy File Robust

Buat method:

```java
void copy(Path source, Path target)
```

Syarat:

- memakai `FileChannel`,
- memakai `transferTo`,
- loop sampai selesai,
- fallback manual jika transfer tidak progress,
- verifikasi ukuran target,
- tulis ke temp lalu move ke target.

### Latihan 2 — Random Access Header Update

Buat file format:

```text
magic:int
version:int
recordCount:long
payload...
```

Syarat:

- tulis header awal dengan `recordCount = 0`,
- append beberapa record,
- setelah selesai update `recordCount` di offset header,
- panggil `force(true)`.

### Latihan 3 — Append-Only Record Log

Implementasikan:

```java
append(byte[] payload)
scan(RecordHandler handler)
recover()
```

Format:

```text
length:int
payload:bytes
crc:int
```

Syarat:

- max payload size,
- checksum validation,
- truncate corrupted tail.

### Latihan 4 — Local Lock

Buat program CLI sederhana:

```text
java ImportJob input.csv
```

Syarat:

- ambil lock file sebelum proses,
- jika lock tidak tersedia, exit code non-zero,
- lock dilepas otomatis dengan try-with-resources.

### Latihan 5 — Resumable Chunk Writer

Buat class:

```java
class ChunkedFileAssembler {
    void writeChunk(int index, byte[] data);
    boolean isComplete();
    void verifyAndPublish();
}
```

Syarat:

- chunk ditulis di offset `index * chunkSize`,
- manifest menyimpan completed chunks,
- checksum per chunk,
- final file dipublish atomically.

---

## 35. Ringkasan

`FileChannel` adalah salah satu API paling penting untuk Java I/O tingkat lanjut karena ia memberi kontrol langsung terhadap file sebagai sequence byte yang bisa dibaca, ditulis, diposisikan, dipotong, dikunci, dipaksa durable, dipetakan ke memory, dan ditransfer secara efisien.

Mental model kuncinya:

```text
FileChannel = handle ke file + current position + operasi offset-aware + bulk transfer + durability/locking primitive
```

Hal yang paling penting untuk diingat:

1. `FileChannel` bukan sekadar stream versi baru; ia adalah API random-access dan bulk-transfer.
2. `read()` dan `write()` bisa partial; selalu loop jika butuh exact completion.
3. Current position adalah mutable state; hati-hati jika channel dipakai multi-thread.
4. Positional read/write lebih aman untuk random access dan concurrent segment processing.
5. `transferTo/transferFrom` bisa sangat efisien, tetapi tetap harus diloop dan tidak selalu benar-benar zero-copy.
6. `force()` adalah durability boundary, tetapi mahal dan bukan magic guarantee absolut.
7. File lock berguna untuk koordinasi lokal, tetapi bukan distributed lock universal.
8. Untuk output production, hindari overwrite langsung; gunakan temp file, force, dan atomic move.
9. Untuk data transfer robust, butuh offset, checksum, manifest, retry, resume, dan finalization protocol.
10. `FileChannel` powerful karena dekat dengan OS; justru karena itu ia membutuhkan disiplin invariant, error handling, dan operational thinking.

---

## 36. Koneksi ke Part Berikutnya

Part berikutnya membahas:

```text
Part 010 — Memory-Mapped File: MappedByteBuffer, Page Cache, Huge Files, dan Trade-off
```

Kita akan masuk lebih dalam ke `FileChannel.map()` dan memahami mengapa memory-mapped file bukan sekadar “cara membaca file lebih cepat”, melainkan teknik yang mengubah cara aplikasi berinteraksi dengan page cache, virtual memory, file besar, random access, dan crash consistency.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 008 — ByteBuffer Deep Dive: Heap, Direct, Mapped, Slice, Duplicate, View Buffer](./learn-java-io-nio-networking-data-transfer-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 010 — Memory-Mapped File: `MappedByteBuffer`, Page Cache, Huge Files, dan Trade-off](./learn-java-io-nio-networking-data-transfer-part-010.md)
