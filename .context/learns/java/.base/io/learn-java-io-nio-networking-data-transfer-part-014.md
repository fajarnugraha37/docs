# Part 014 — Temporary File, Atomic File Write, File Replacement, dan Crash-Safe Persistence

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-014.md`  
> Level: Advanced  
> Fokus: menulis file secara aman, atomic, recoverable, dan operasional di production.

---

## 0. Tujuan Pembelajaran

Setelah mempelajari part ini, kamu diharapkan mampu:

1. Memahami kenapa `Files.writeString(path, data)` atau `new FileOutputStream(path)` sering **tidak cukup aman** untuk data penting.
2. Membedakan:
   - write ke page cache,
   - flush Java buffer,
   - force/fsync ke storage,
   - atomic rename/move,
   - durability metadata directory.
3. Mendesain pola **atomic file replacement**:
   - tulis ke temporary file,
   - validasi isi,
   - force data,
   - atomic move ke target,
   - cleanup jika gagal.
4. Memahami keterbatasan `ATOMIC_MOVE`:
   - harus didukung filesystem,
   - idealnya dalam file store/directory yang sama,
   - tidak otomatis berarti semua byte sudah durable setelah crash.
5. Menangani failure nyata:
   - disk full,
   - permission error,
   - process killed,
   - machine crash,
   - concurrent reader,
   - concurrent writer,
   - stale temp file,
   - network filesystem anomaly.
6. Membuat utility Java untuk atomic write yang layak dipakai di service production.
7. Menentukan kapan memakai:
   - direct overwrite,
   - append-only log,
   - temp-then-rename,
   - manifest pattern,
   - checkpoint pattern,
   - journal pattern.

---

## 1. Problem Utama: Menulis File Bukan Operasi Tunggal

Di level aplikasi, kita sering berpikir:

```java
Files.writeString(path, content);
```

Seolah-olah artinya:

> file lama diganti file baru secara utuh.

Padahal di realitas OS/filesystem, operasi tersebut bisa melewati beberapa tahap:

```text
Java object/string/byte[]
  -> Java buffer / encoder
  -> native/JVM boundary
  -> kernel page cache
  -> filesystem metadata update
  -> block device queue
  -> storage controller cache
  -> physical durable media
```

Pada setiap boundary, ada kemungkinan gagal.

Contoh failure:

```text
Process mati setelah truncate file, sebelum seluruh data baru ditulis.
Disk penuh di tengah write.
Permission berubah setelah file dibuka.
Host crash setelah write masuk page cache, sebelum storage persist.
Reader membaca file saat writer baru menulis setengah.
Writer kedua overwrite hasil writer pertama.
NFS/cache membuat visibility antar-node tidak konsisten.
```

Jadi pertanyaan engineering yang benar bukan:

> Bagaimana cara write file?

Tetapi:

> Apa contract file yang ingin diberikan kepada reader dan sistem setelah crash?

---

## 2. Mental Model: Visibility, Atomicity, Durability

Untuk desain file persistence, pisahkan tiga konsep ini.

### 2.1 Visibility

Visibility berarti perubahan bisa dilihat oleh process lain.

Contoh:

```java
Files.writeString(path, "new-value");
```

Reader lain mungkin melihat:

- file lama,
- file baru,
- file sedang berubah,
- file kosong sementara,
- file yang baru sebagian ditulis.

Tergantung cara writer menulis dan cara reader membuka file.

### 2.2 Atomicity

Atomicity berarti reader hanya melihat salah satu dari dua keadaan valid:

```text
old complete file
atau
new complete file
```

Bukan:

```text
half-written file
empty truncated file
mixed old/new bytes
```

Atomicity biasanya dicapai dengan pola:

```text
write temp file -> atomic move temp to target
```

### 2.3 Durability

Durability berarti setelah method return sukses, data tetap ada walaupun terjadi crash.

Ini jauh lebih sulit daripada sekadar `write`.

```text
write() sukses
  belum tentu durable

flush() sukses
  belum tentu durable ke storage

FileChannel.force(true) sukses
  lebih dekat ke durability, tapi tetap bergantung storage/filesystem
```

### 2.4 Tiga Contract yang Berbeda

| Contract | Maksud | Teknik Umum |
|---|---|---|
| Visible | data bisa dibaca process lain | close/flush cukup untuk banyak use case |
| Atomic | reader tidak melihat file setengah jadi | temp file + atomic move |
| Durable | tahan crash setelah success | force/fsync file dan, bila perlu, directory |

Untuk config/cache biasa, atomic mungkin cukup. Untuk ledger, checkpoint penting, audit file, atau manifest transfer, durability perlu dipikirkan lebih serius.

---

## 3. Kenapa Direct Overwrite Berbahaya

Direct overwrite biasanya terlihat seperti ini:

```java
Files.writeString(Path.of("config.json"), json);
```

Atau:

```java
try (OutputStream out = Files.newOutputStream(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE)) {
    out.write(bytes);
}
```

Masalahnya: `TRUNCATE_EXISTING` bisa membuat file menjadi 0 byte sebelum data baru selesai ditulis.

Failure timeline:

```text
T0: config.json berisi versi valid lama
T1: writer membuka file dengan TRUNCATE_EXISTING
T2: file menjadi kosong
T3: writer mulai menulis data baru
T4: process crash / disk full / IOException
T5: config.json sekarang kosong atau setengah valid
```

Untuk file yang dibaca ulang saat startup, ini sangat berbahaya:

```text
Aplikasi crash karena config corrupt.
Restart gagal karena config corrupt.
Rollback gagal karena file lama hilang.
```

Direct overwrite boleh untuk:

- scratch file,
- file temporary yang tidak dibaca process lain,
- file yang bisa diregenerate,
- use case yang tidak butuh atomicity.

Untuk data yang harus selalu valid, gunakan atomic replacement.

---

## 4. Temporary File: Work Area yang Aman

Java NIO.2 menyediakan:

```java
Files.createTempFile(...)
Files.createTempDirectory(...)
```

Hal penting: temp file untuk atomic replacement sebaiknya dibuat **di directory yang sama dengan target**.

Kenapa?

1. Atomic move biasanya hanya reliable dalam filesystem/file store yang sama.
2. Permission, ownership, mount behavior lebih konsisten.
3. Rename dalam directory yang sama biasanya operasi metadata yang murah.
4. Cleanup stale temp file lebih mudah.

Contoh:

```java
Path target = Path.of("/data/config.json");
Path dir = target.toAbsolutePath().getParent();
Path temp = Files.createTempFile(dir, ".config.json.", ".tmp");
```

Jangan default ke `/tmp` untuk atomic replacement target `/data/config.json`.

Buruk:

```java
Path temp = Files.createTempFile("config", ".tmp"); // default temp directory
Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
```

Masalah:

```text
/tmp dan /data mungkin beda filesystem.
Atomic move bisa gagal.
Fallback ke non-atomic copy+delete sangat berbahaya untuk replacement.
```

---

## 5. Atomic Move: Commit Point

Dalam pola atomic write, `Files.move(temp, target, ATOMIC_MOVE, REPLACE_EXISTING)` adalah **commit point**.

Sebelum move:

```text
target lama masih tersedia
temp sedang dipersiapkan
reader tetap aman membaca target lama
```

Setelah move sukses:

```text
target menunjuk ke file baru
reader baru akan melihat versi baru
```

Pola besar:

```text
1. Create temp file in same target directory
2. Write full content to temp
3. Flush Java-level buffers
4. Force temp file content to storage when durability matters
5. Optionally validate temp file
6. Atomically move temp -> target
7. Optionally force parent directory metadata
8. Cleanup temp on failure
```

`ATOMIC_MOVE` penting karena jika filesystem tidak support atomic move, Java harus melempar exception, bukan diam-diam melakukan move non-atomic.

---

## 6. `flush()` vs `force()` vs Close

### 6.1 `flush()`

`flush()` mendorong data dari buffer Java/wrapper ke underlying stream/channel.

Contoh:

```java
try (BufferedWriter writer = Files.newBufferedWriter(temp, UTF_8)) {
    writer.write(content);
    writer.flush();
}
```

Tapi `flush()` tidak menjamin data sudah durable di disk.

### 6.2 `close()`

`close()` biasanya melakukan flush dan melepas file descriptor.

Tapi close sukses juga belum selalu berarti data sudah aman dari host crash.

### 6.3 `FileChannel.force(boolean)`

`FileChannel.force(metaData)` meminta update pada channel file dipaksa ke storage device.

Parameter:

```text
force(false) -> paksa content file
force(true)  -> paksa content + metadata file
```

Gunakan `force(true)` saat metadata file relevan, misalnya ukuran file, timestamp, atau file baru.

Contoh:

```java
try (FileChannel channel = FileChannel.open(temp,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING)) {
    channel.write(ByteBuffer.wrap(bytes));
    channel.force(true);
}
```

### 6.4 `SYNC` dan `DSYNC`

`StandardOpenOption.SYNC` meminta setiap update content atau metadata ditulis synchronous ke storage.

`StandardOpenOption.DSYNC` meminta setiap update content ditulis synchronous ke storage.

Trade-off:

```text
SYNC/DSYNC lebih sederhana secara durability contract,
tetapi bisa sangat mahal untuk throughput karena setiap write jadi sinkron.
```

Untuk banyak use case, lebih baik batch write lalu `force()` sekali.

---

## 7. Directory fsync: Bagian yang Sering Dilupakan

Atomic rename/move mengubah metadata directory.

Di beberapa filesystem/OS, agar replacement benar-benar durable setelah crash, bukan hanya file content yang perlu di-force, tetapi juga parent directory metadata.

Mental model:

```text
file data durable       -> isi temp file aman
directory entry durable -> nama target menunjuk ke file baru secara durable
```

Java tidak menyediakan API high-level khusus bernama `fsyncDirectory`, tetapi di beberapa platform kamu bisa mencoba membuka directory sebagai `FileChannel` dan memanggil `force(true)`.

Contoh best-effort:

```java
static void forceDirectory(Path directory) throws IOException {
    try (FileChannel channel = FileChannel.open(directory, StandardOpenOption.READ)) {
        channel.force(true);
    }
}
```

Namun ini tidak portable sempurna. Di Windows atau filesystem tertentu, membuka directory sebagai channel bisa gagal.

Maka desain utility production perlu membedakan:

```text
strict durability mode:
  gagal jika directory force gagal

best-effort durability mode:
  log warning jika directory force gagal
```

Untuk file konfigurasi biasa, best-effort sering cukup. Untuk embedded database/journal/checkpoint kritis, kamu perlu contract yang jauh lebih ketat dan test per platform.

---

## 8. Atomic Write Utility: Versi Production-Oriented

Berikut utility atomic write yang cukup aman sebagai baseline.

```java
package com.example.io;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Objects;

public final class AtomicFileWriter {

    private AtomicFileWriter() {
    }

    public enum DirectoryForceMode {
        NONE,
        BEST_EFFORT,
        STRICT
    }

    public static void writeBytesAtomically(
            Path target,
            byte[] content,
            boolean forceFile,
            DirectoryForceMode directoryForceMode
    ) throws IOException {
        Objects.requireNonNull(target, "target");
        Objects.requireNonNull(content, "content");
        Objects.requireNonNull(directoryForceMode, "directoryForceMode");

        Path absoluteTarget = target.toAbsolutePath().normalize();
        Path directory = absoluteTarget.getParent();
        if (directory == null) {
            throw new IOException("Target must have a parent directory: " + target);
        }

        Files.createDirectories(directory);

        String fileName = absoluteTarget.getFileName().toString();
        Path temp = Files.createTempFile(directory, "." + fileName + ".", ".tmp");

        boolean moved = false;
        try {
            writeFully(temp, content, forceFile);

            try {
                Files.move(
                        temp,
                        absoluteTarget,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING
                );
            } catch (AtomicMoveNotSupportedException e) {
                throw new IOException(
                        "Atomic move is not supported for target: " + absoluteTarget
                                + ". Refusing non-atomic replacement.",
                        e
                );
            }

            moved = true;
            forceDirectoryIfRequested(directory, directoryForceMode);
        } finally {
            if (!moved) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException cleanupFailure) {
                    // In a real system, log this with target/temp path and correlation id.
                    // Do not mask the original failure from the main operation.
                }
            }
        }
    }

    private static void writeFully(Path temp, byte[] content, boolean forceFile) throws IOException {
        try (FileChannel channel = FileChannel.open(
                temp,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING
        )) {
            ByteBuffer buffer = ByteBuffer.wrap(content);
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }

            if (forceFile) {
                channel.force(true);
            }
        }
    }

    private static void forceDirectoryIfRequested(
            Path directory,
            DirectoryForceMode mode
    ) throws IOException {
        switch (mode) {
            case NONE -> {
                return;
            }
            case BEST_EFFORT -> {
                try {
                    forceDirectory(directory);
                } catch (IOException ignored) {
                    // Real system: log warning.
                }
            }
            case STRICT -> forceDirectory(directory);
        }
    }

    private static void forceDirectory(Path directory) throws IOException {
        try (FileChannel channel = FileChannel.open(directory, StandardOpenOption.READ)) {
            channel.force(true);
        }
    }
}
```

Usage:

```java
AtomicFileWriter.writeBytesAtomically(
        Path.of("/data/app/config.json"),
        jsonBytes,
        true,
        AtomicFileWriter.DirectoryForceMode.BEST_EFFORT
);
```

Important design choice:

```text
If ATOMIC_MOVE is unsupported, this utility refuses to fallback silently.
```

Kenapa?

Karena fallback dari atomic move ke copy+delete mengubah correctness contract.

Jika user benar-benar mau fallback, harus eksplisit:

```text
atomic preferred, non-atomic accepted
```

Bukan default.

---

## 9. Atomic Text Write dengan Charset Eksplisit

Untuk text file, jangan bergantung pada default charset.

```java
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

public final class AtomicTextWriter {

    private AtomicTextWriter() {
    }

    public static void writeUtf8Atomically(Path target, String content) throws IOException {
        AtomicFileWriter.writeBytesAtomically(
                target,
                content.getBytes(StandardCharsets.UTF_8),
                true,
                AtomicFileWriter.DirectoryForceMode.BEST_EFFORT
        );
    }

    public static void writeTextAtomically(Path target, String content, Charset charset) throws IOException {
        AtomicFileWriter.writeBytesAtomically(
                target,
                content.getBytes(charset),
                true,
                AtomicFileWriter.DirectoryForceMode.BEST_EFFORT
        );
    }
}
```

Kenapa encode ke byte dulu?

Karena atomic writer bekerja di boundary binary file. Teks adalah representasi di atas byte. Dengan encode eksplisit, kita menghindari bug default charset.

Untuk file sangat besar, jangan encode seluruh string ke `byte[]`; gunakan streaming variant.

---

## 10. Streaming Atomic Write untuk File Besar

Jika content besar, jangan simpan seluruh data di memory.

Gunakan writer callback:

```java
package com.example.io;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Objects;

public final class StreamingAtomicFileWriter {

    private StreamingAtomicFileWriter() {
    }

    @FunctionalInterface
    public interface ChannelWriter {
        void writeTo(FileChannel channel) throws IOException;
    }

    public static void writeAtomically(
            Path target,
            ChannelWriter writer,
            boolean forceFile
    ) throws IOException {
        Objects.requireNonNull(target, "target");
        Objects.requireNonNull(writer, "writer");

        Path absoluteTarget = target.toAbsolutePath().normalize();
        Path directory = absoluteTarget.getParent();
        if (directory == null) {
            throw new IOException("Target must have a parent directory: " + target);
        }

        Files.createDirectories(directory);

        String fileName = absoluteTarget.getFileName().toString();
        Path temp = Files.createTempFile(directory, "." + fileName + ".", ".tmp");

        boolean moved = false;
        try {
            try (FileChannel channel = FileChannel.open(
                    temp,
                    StandardOpenOption.WRITE,
                    StandardOpenOption.TRUNCATE_EXISTING
            )) {
                writer.writeTo(channel);
                if (forceFile) {
                    channel.force(true);
                }
            }

            try {
                Files.move(
                        temp,
                        absoluteTarget,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING
                );
            } catch (AtomicMoveNotSupportedException e) {
                throw new IOException("Atomic move not supported: " + absoluteTarget, e);
            }

            moved = true;
        } finally {
            if (!moved) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException ignored) {
                    // log in production
                }
            }
        }
    }
}
```

Example generate large report:

```java
Path report = Path.of("/data/report/users.csv");

StreamingAtomicFileWriter.writeAtomically(report, channel -> {
    for (int i = 0; i < 1_000_000; i++) {
        byte[] line = (i + ",user-" + i + "\n").getBytes(StandardCharsets.UTF_8);
        ByteBuffer buffer = ByteBuffer.wrap(line);
        while (buffer.hasRemaining()) {
            channel.write(buffer);
        }
    }
}, true);
```

Reader tidak melihat file `users.csv` sampai report selesai penuh dan move berhasil.

---

## 11. Concurrent Reader: Kenapa Atomic Replacement Bagus

Dengan direct write, reader bisa membaca file saat sedang diubah.

Dengan temp-then-rename:

```text
reader A membuka target lama
writer menulis temp
writer atomic move temp -> target
reader A tetap membaca file lama yang sudah dibuka
reader B membuka target setelah move, membaca file baru
```

Ini contract yang bagus:

```text
Setiap reader melihat satu versi lengkap.
Tidak ada reader yang melihat versi setengah jadi.
```

Cocok untuk:

- config file,
- feature flag snapshot,
- generated report,
- manifest transfer,
- local cache index,
- checkpoint metadata.

Namun atomic replacement tidak menyelesaikan semua problem concurrent writer.

---

## 12. Concurrent Writer: Last Writer Wins Bukan Selalu Benar

Jika dua writer melakukan atomic replacement bersamaan:

```text
Writer A menulis temp-A
Writer B menulis temp-B
Writer A move ke target
Writer B move ke target
```

Hasil akhir:

```text
target = hasil B
```

Secara file integrity aman, tetapi secara business correctness mungkin salah.

Solusi tergantung contract:

### 12.1 Single Writer Rule

Hanya satu process/thread yang boleh menulis target tertentu.

Implementasi:

- actor/queue,
- scheduler tunggal,
- leadership election,
- process lock.

### 12.2 File Lock

Gunakan `FileChannel.lock()` pada lock file.

```java
Path lockPath = Path.of("/data/config.json.lock");
try (FileChannel lockChannel = FileChannel.open(
        lockPath,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE);
     FileLock lock = lockChannel.lock()) {

    // perform atomic write here
}
```

Caveat:

```text
File lock behavior bisa berbeda antar OS/filesystem.
Pada network filesystem, locking bisa tricky.
Lock biasanya advisory, bukan mandatory.
```

### 12.3 Compare-And-Set Metadata

Sebelum write, baca version/hash file lama. Setelah siap commit, pastikan version belum berubah.

Sulit dilakukan secara atomic dengan plain filesystem tanpa lock.

### 12.4 Append-Only Event Log

Jika banyak writer, kadang model append lebih baik daripada replace.

---

## 13. Append-Only vs Replace

Tidak semua persistence cocok dengan replacement.

### 13.1 Replace Pattern

Cocok untuk state snapshot:

```text
config.json
checkpoint.json
current-manifest.json
latest-report.csv
```

Contract:

```text
hanya versi terbaru yang penting
reader harus melihat file lengkap
```

### 13.2 Append-Only Pattern

Cocok untuk event/history:

```text
audit.log
events.dat
transaction-journal.log
```

Contract:

```text
jangan kehilangan record lama
record baru ditambah di akhir
partial tail bisa dipotong saat recovery
```

Append-only membutuhkan strategi berbeda:

- framing record,
- checksum per record,
- fsync policy,
- recovery scan,
- truncate corrupt tail,
- rotation,
- compaction.

Jangan pakai atomic replacement untuk high-frequency append event, karena akan rewrite file besar terus-menerus.

---

## 14. Checkpoint Pattern

Checkpoint adalah snapshot progress agar job bisa resume.

Contoh checkpoint:

```json
{
  "jobId": "import-2026-06-16",
  "source": "customers-2026-06.csv",
  "lastCommittedLine": 1842000,
  "lastCommittedByteOffset": 982340123,
  "sourceSha256": "...",
  "updatedAt": "2026-06-16T12:30:00Z"
}
```

Write checkpoint harus atomic karena corrupt checkpoint bisa membuat job:

- mengulang terlalu banyak,
- skip data,
- duplicate processing,
- gagal restart.

Pola:

```text
process batch
commit business data
write checkpoint atomically
```

Important invariant:

```text
Checkpoint tidak boleh menunjuk progress yang belum benar-benar committed.
```

Jika urutan salah:

```text
write checkpoint dulu
lalu commit data gagal
```

Restart akan mengira data sudah diproses padahal belum.

---

## 15. Manifest Pattern

Manifest pattern berguna untuk data transfer multi-file/chunk.

Struktur:

```text
transfer-123/
  chunks/
    part-00001.bin
    part-00002.bin
    part-00003.bin
  manifest.tmp
  manifest.json
```

Manifest berisi:

```json
{
  "transferId": "transfer-123",
  "fileName": "report.zip",
  "totalBytes": 987654321,
  "chunks": [
    { "index": 1, "name": "part-00001.bin", "bytes": 10485760, "sha256": "..." },
    { "index": 2, "name": "part-00002.bin", "bytes": 10485760, "sha256": "..." }
  ],
  "wholeSha256": "...",
  "status": "COMPLETE"
}
```

Reader hanya memproses transfer jika `manifest.json` muncul.

Commit point:

```text
atomic move manifest.tmp -> manifest.json
```

Invariant:

```text
Jika manifest.json ada, semua chunk yang direferensikan harus lengkap dan valid.
```

Ini jauh lebih aman daripada reader menebak dari keberadaan file chunk.

---

## 16. Journal Pattern

Journal pattern menulis niat/perubahan sebelum menerapkan state final.

Contoh:

```text
journal.log:
  BEGIN update-config tx-123
  WRITE temp .config.tmp.abc
  COMMIT config.json tx-123
```

Saat startup recovery:

```text
Jika BEGIN tanpa COMMIT -> cleanup temp
Jika COMMIT ada tapi target belum sesuai -> verify/repair jika mungkin
```

Journal berguna saat satu operasi melibatkan banyak file:

```text
update index file
update data file
update manifest
```

Atomic rename hanya atomic untuk satu path replacement, bukan transaksi multi-file.

Untuk transaksi multi-file, kamu butuh:

- journal,
- manifest,
- versioned directory,
- embedded database,
- atau storage system yang menyediakan transaction.

---

## 17. Versioned Directory Pattern

Untuk publish kumpulan file secara atomic-ish, gunakan directory versioning.

```text
/data/releases/
  v0001/
    a.json
    b.json
  v0002.tmp/
    a.json
    b.json
  current -> v0001
```

Publish flow:

```text
1. create v0002.tmp
2. write all files inside v0002.tmp
3. validate
4. rename v0002.tmp -> v0002
5. atomically update current pointer/symlink/manifest
```

Reader membaca:

```text
current/manifest.json
```

Caveat:

- symlink update behavior perlu dipahami per OS,
- Windows semantics berbeda,
- directory move atomic tergantung filesystem,
- reader harus membuka version secara konsisten.

Alternatif portable:

```text
current-version.txt
```

ditulis atomically, berisi nama directory aktif:

```text
v0002
```

---

## 18. Disk Full dan Partial Failure

Disk full bisa terjadi di banyak titik:

```text
create temp gagal
write temp gagal
force gagal
move gagal
force directory gagal
cleanup gagal
```

Atomic replacement melindungi target lama selama temp belum berhasil dipindah.

Namun disk full juga bisa membuat temp file tertinggal.

Maka gunakan naming convention:

```text
.<target-name>.<random>.tmp
```

Dan cleanup policy:

```text
hapus temp file yang:
  prefix sesuai
  suffix .tmp
  lastModified lebih tua dari threshold
  tidak sedang dibuka/locked
```

Jangan cleanup terlalu agresif saat ada writer aktif.

---

## 19. Stale Temp File Cleanup

Contoh cleanup sederhana:

```java
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

public static void cleanupStaleTempFiles(Path directory, String targetFileName, Duration maxAge)
        throws IOException {
    String glob = "." + targetFileName + ".*.tmp";
    Instant cutoff = Instant.now().minus(maxAge);

    try (DirectoryStream<Path> stream = Files.newDirectoryStream(directory, glob)) {
        for (Path temp : stream) {
            try {
                Instant lastModified = Files.getLastModifiedTime(temp).toInstant();
                if (lastModified.isBefore(cutoff)) {
                    Files.deleteIfExists(temp);
                }
            } catch (IOException ignored) {
                // production: log debug/warn, continue cleanup best effort
            }
        }
    }
}
```

Production improvement:

- jangan cleanup file yang masih di-lock,
- gunakan owner pid/correlation id di filename atau sidecar metadata,
- metric jumlah stale temp,
- alert jika stale temp banyak.

---

## 20. Permission dan Secure Temp File

`Files.createTempFile` mendukung `FileAttribute<?>... attrs`, sehingga permission dapat diset saat file dibuat.

Di POSIX:

```java
import java.nio.file.attribute.PosixFilePermissions;

var attrs = PosixFilePermissions.asFileAttribute(
        PosixFilePermissions.fromString("rw-------")
);

Path temp = Files.createTempFile(directory, ".secret.", ".tmp", attrs);
```

Kenapa permission harus saat create?

Karena jika create dulu lalu chmod kemudian, ada window kecil saat permission belum sesuai.

Untuk secret/config sensitif:

```text
create dengan permission restrictive dari awal
write content
force
atomic move
pastikan target final permission benar
```

Caveat:

- POSIX attribute tidak tersedia di semua filesystem,
- Windows ACL model berbeda,
- container volume bisa punya permission mapping berbeda,
- Kubernetes Secret/ConfigMap punya update semantics sendiri.

---

## 21. Kubernetes dan Container Filesystem Caveat

Dalam container, file writing punya beberapa caveat:

```text
root filesystem bisa read-only
volume bisa ephemeral
ConfigMap/Secret volume tidak boleh dianggap writable normal
atomic writer Kubernetes memakai symlink/directory switch internal
permission bisa dipengaruhi fsGroup/runAsUser
```

Untuk aplikasi Java:

- tulis state ke mounted writable volume, bukan image filesystem,
- jangan overwrite file ConfigMap mounted secara langsung,
- gunakan application data directory eksplisit,
- pastikan liveness/readiness tidak membaca file setengah jadi,
- cleanup temp file saat startup.

---

## 22. Network Filesystem Caveat

NFS/SMB/EFS dan network filesystem bisa punya perilaku berbeda dari local filesystem:

- metadata visibility delay,
- cache incoherence,
- locking behavior berbeda,
- atomic rename mungkin bergantung server/protocol,
- fsync latency tinggi,
- failure mode partial/network partition.

Untuk data penting antar-node, pertimbangkan:

- object storage dengan ETag/checksum,
- database,
- distributed lock,
- queue/event log,
- explicit manifest + reconciliation,
- avoid relying solely on local-file semantics.

Atomic file pattern tetap berguna, tetapi contract-nya harus diuji pada filesystem target.

---

## 23. Testing Atomic Write

Unit test happy path tidak cukup.

### 23.1 Test Reader Tidak Melihat Partial File

Simulasikan writer lambat menulis temp, sementara reader terus membaca target.

Invariant:

```text
reader hanya melihat old atau new, tidak melihat partial
```

### 23.2 Test Atomic Move Unsupported

Tidak mudah disimulasikan di semua platform. Bisa abstraction `MoveStrategy` untuk test.

### 23.3 Test Cleanup Saat Write Gagal

Writer callback throw exception di tengah.

Expected:

```text
target lama tetap ada
temp dihapus atau setidaknya tidak dipublish sebagai target
exception tidak ditelan
```

### 23.4 Test Disk Full

Bisa dilakukan dengan:

- test container dengan limited volume,
- tmpfs kecil,
- fake channel yang throw IOException,
- integration test manual.

### 23.5 Test Permission Denied

Buat directory read-only pada OS yang mendukung.

### 23.6 Test Crash

Crash testing sulit tapi penting untuk library storage:

```text
spawn child process
child write sampai titik tertentu
kill -9 child
verify target state
repeat many times
```

---

## 24. Observability untuk File Persistence

Atomic write operation sebaiknya punya logs dan metrics.

Metrics:

```text
atomic_write_attempt_total
atomic_write_success_total
atomic_write_failure_total
atomic_write_bytes_total
atomic_write_duration_seconds
atomic_write_force_duration_seconds
atomic_write_move_duration_seconds
atomic_write_cleanup_failure_total
atomic_write_atomic_move_not_supported_total
atomic_write_stale_temp_files
```

Structured log fields:

```text
operation=atomic_write
target=/data/config.json
temp=/data/.config.json.123.tmp
bytes=12345
forceFile=true
directoryForceMode=BEST_EFFORT
result=success|failure
exceptionType=...
correlationId=...
```

Jangan log isi file jika file berisi secret atau PII.

---

## 25. Decision Matrix

| Use Case | Pattern | Force File? | Directory Force? | Notes |
|---|---|---:|---:|---|
| Generated report | temp + atomic move | optional | optional | reader tidak lihat partial |
| Config snapshot | temp + atomic move | yes | best effort | penting saat startup |
| Secret file | temp + atomic move + restrictive permission | yes | best effort/strict | jangan log content |
| Checkpoint job | temp + atomic move | yes | best effort/strict | urutan commit sangat penting |
| Transfer manifest | temp + atomic move | yes | best effort | manifest sebagai commit marker |
| Audit log | append-only + record checksum | policy-based | no | bukan replacement |
| Cache yang bisa diregenerate | temp + move atau direct | no/optional | no | pilih sederhana |
| Embedded storage | specialized DB/journal | yes | strict | jangan reinvent database sembarangan |

---

## 26. Anti-Pattern

### 26.1 Menggunakan `/tmp` untuk Replacement Target Lain

```java
Path temp = Files.createTempFile("data", ".tmp");
Files.move(temp, target, ATOMIC_MOVE, REPLACE_EXISTING);
```

Masalah: beda filesystem.

### 26.2 Fallback Diam-Diam dari Atomic ke Non-Atomic

```java
try {
    Files.move(temp, target, ATOMIC_MOVE, REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException e) {
    Files.move(temp, target, REPLACE_EXISTING); // dangerous silent downgrade
}
```

Jika correctness butuh atomic, fallback ini melanggar contract.

### 26.3 Direct Truncate untuk File Penting

```java
Files.newOutputStream(target, TRUNCATE_EXISTING);
```

Jika gagal, file lama hilang.

### 26.4 Menganggap `flush()` Sama dengan Durable

`flush()` hanya boundary Java/stream, bukan jaminan storage persistence.

### 26.5 Menganggap Atomic Move Sama dengan Transaction Multi-File

Atomic move hanya untuk path operation tertentu. Multi-file update butuh design lain.

### 26.6 Tidak Membersihkan Temp File

Temp file stale bisa memenuhi disk dan menyebabkan outage.

### 26.7 Tidak Menguji Filesystem Target

Local ext4, APFS, NTFS, NFS, SMB, EFS, container overlay, dan Kubernetes volume bisa berbeda.

---

## 27. Production Checklist

Sebelum menulis file penting, jawab pertanyaan ini:

```text
[ ] Apakah reader boleh melihat partial file?
[ ] Apakah file lama harus tetap valid jika write gagal?
[ ] Apakah hasil write harus tahan process crash?
[ ] Apakah hasil write harus tahan host crash/power loss?
[ ] Apakah target berada di local filesystem atau network filesystem?
[ ] Apakah temp file dibuat di directory yang sama dengan target?
[ ] Apakah ATOMIC_MOVE wajib atau optional?
[ ] Apakah permission file sensitif sudah diatur saat create?
[ ] Apakah ada lebih dari satu writer?
[ ] Apakah perlu file lock/single writer?
[ ] Apakah perlu checksum/validation sebelum publish?
[ ] Apakah cleanup stale temp tersedia?
[ ] Apakah operasi punya metrics/logging?
[ ] Apakah failure disk full/permission denied diuji?
[ ] Apakah restart recovery behavior jelas?
```

---

## 28. Ringkasan Mental Model

File write yang aman bukan sekadar menulis bytes.

Untuk file penting, gunakan pola:

```text
prepare privately -> validate -> force if needed -> atomic publish -> cleanup/recover
```

Core invariant:

```text
Target public path hanya boleh menunjuk ke versi yang lengkap dan valid.
```

Boundary penting:

```text
write != durable
flush != fsync
close != transaction
atomic move != multi-file transaction
same directory temp file matters
filesystem behavior matters
```

Dengan memahami ini, kamu bisa mendesain file persistence yang tahan terhadap failure nyata, bukan hanya lolos happy-path demo.

---

## 29. Latihan

### Latihan 1 — Atomic Config Writer

Buat utility untuk menulis `application-state.json` secara atomic dengan UTF-8, force file, dan cleanup temp.

Validasi:

```text
Jika writer gagal di tengah, file lama tetap bisa dibaca.
```

### Latihan 2 — Checkpoint Writer

Buat `CheckpointStore`:

```java
record Checkpoint(String jobId, long line, long byteOffset, String sourceSha256) {}
```

Requirement:

```text
save checkpoint secara atomic
load checkpoint saat startup
jika checkpoint corrupt, fail fast dengan pesan jelas
```

### Latihan 3 — Manifest Commit

Simulasikan transfer chunk:

```text
chunks/part-0001
chunks/part-0002
manifest.json
```

Reader hanya boleh mulai proses jika manifest final ada dan checksum semua chunk valid.

### Latihan 4 — Crash Simulation

Buat child Java process yang melakukan atomic write dalam loop, lalu parent process kill child secara random. Setelah setiap kill, verifikasi target hanya berisi old valid atau new valid.

---

## 30. Referensi Utama

- Java SE `Files` API: `createTempFile`, `createTempDirectory`, `move`, `deleteIfExists`, file operations.
- Oracle Java Tutorial: moving file/directory, `REPLACE_EXISTING`, `ATOMIC_MOVE`.
- Java SE `FileChannel` API: `force`, file channel semantics, file consistency caveats.
- Java SE `StandardOpenOption`: `SYNC`, `DSYNC`, `DELETE_ON_CLOSE`, `CREATE_NEW`, `TRUNCATE_EXISTING`.

---

## 31. Status Seri

Seri belum selesai.

Part yang sudah dibuat sampai titik ini:

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
Part 011 — NIO.2 File API: Path, Files, FileSystem, dan Modern File Operations
Part 012 — File Attributes, Permissions, Ownership, Metadata, dan Cross-Platform Semantics
Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete
Part 014 — Temporary File, Atomic File Write, File Replacement, dan Crash-Safe Persistence
```

Part berikutnya:

```text
Part 015 — WatchService: File Change Detection, Event Coalescing, dan Reliability Limit
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete](./learn-java-io-nio-networking-data-transfer-part-013.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 015 — WatchService: File Change Detection, Event Coalescing, dan Reliability Limit](./learn-java-io-nio-networking-data-transfer-part-015.md)

</div>