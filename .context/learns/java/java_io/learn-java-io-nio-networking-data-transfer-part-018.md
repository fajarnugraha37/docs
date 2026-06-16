# Part 018 — Compression: ZIP, GZIP, Deflater, Inflater, Tar Concept, dan Streaming Compression

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-018.md`  
> Target: advanced Java engineer yang ingin memahami compression sebagai bagian dari I/O pipeline, data transfer, storage optimization, dan security boundary.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami compression sebagai **transformasi stream**, bukan sekadar fitur `zip file`.
2. Membedakan peran **ZIP**, **GZIP**, **ZLIB/DEFLATE**, dan **TAR**.
3. Memakai API Java `java.util.zip` secara benar untuk membaca/menulis data terkompresi.
4. Mendesain pipeline compression yang aman untuk file besar, network transfer, dan batch ingestion.
5. Menghindari bug umum:
   - lupa menutup `GZIPOutputStream` sehingga trailer tidak tertulis,
   - salah memahami ZIP sebagai folder biasa,
   - extraction rentan Zip Slip,
   - menerima archive tanpa limit sehingga terkena zip bomb,
   - membuat seluruh ZIP di memory,
   - mengompresi data yang sudah compressed,
   - retry transfer compressed stream tanpa framing/checkpoint.
6. Memahami trade-off compression:
   - CPU vs ukuran data,
   - latency vs throughput,
   - memory vs streaming,
   - compression ratio vs operational cost.
7. Memahami failure model compression:
   - corrupt compressed data,
   - premature EOF,
   - CRC mismatch,
   - truncated stream,
   - invalid entry metadata,
   - oversized decompressed output,
   - path traversal saat extract.

---

## 2. Mental Model: Compression adalah Transformasi, Bukan Storage

Compression tidak mengubah hakikat data. Compression hanya mengubah representasi byte agar lebih kecil atau lebih cocok untuk transfer/storage.

Secara mental:

```text
Original bytes
    |
    v
Compressor
    |
    v
Compressed bytes
    |
    v
Storage / Network / Queue / File
    |
    v
Decompressor
    |
    v
Original bytes again
```

Compression adalah **filter** di antara producer dan sink.

Contoh:

```text
CSV rows -> UTF-8 bytes -> GZIPOutputStream -> FileOutputStream
```

Atau:

```text
SocketInputStream -> GZIPInputStream -> JSON parser
```

Artinya, compression sebaiknya dipahami sebagai bagian dari I/O pipeline:

```text
source -> buffering -> transformation -> transport/storage -> verification -> sink
```

Bukan sebagai operasi sederhana:

```text
zip(file)
unzip(file)
```

Karena di production, yang menentukan correctness bukan hanya API compression, tetapi juga:

- urutan stream wrapper,
- kapan flush/close dilakukan,
- limit ukuran input/output,
- validasi nama entry,
- checksum,
- retry behavior,
- memory usage,
- backpressure,
- atomic write,
- observability.

---

## 3. Istilah Penting

### 3.1 Compression Algorithm

Algorithm adalah cara mengecilkan data.

Contoh:

- DEFLATE,
- LZ4,
- Zstandard,
- Brotli,
- Snappy.

Java standard library berfokus pada ZIP/GZIP/ZLIB/DEFLATE melalui `java.util.zip`. Untuk LZ4, Zstandard, Brotli, atau Snappy biasanya memakai library eksternal.

### 3.2 Compression Format

Format adalah packaging byte compressed beserta metadata tertentu.

Contoh:

- GZIP format,
- ZIP format,
- ZLIB format.

Algorithm dan format tidak sama.

DEFLATE adalah algorithm. GZIP dan ZIP dapat memakai DEFLATE sebagai metode compression.

### 3.3 Archive Format

Archive adalah format untuk menggabungkan banyak file/directory menjadi satu container.

Contoh:

- ZIP,
- TAR,
- 7z.

ZIP adalah archive + optional compression per entry. TAR secara historis adalah archive tanpa compression; biasanya dikombinasikan dengan gzip menjadi `.tar.gz`.

### 3.4 Stream Compression

Stream compression berarti data bisa diproses bertahap tanpa harus memiliki seluruh data di memory.

Contoh:

```text
read chunk -> compress chunk -> write chunk -> repeat
```

Ini penting untuk file besar, HTTP upload/download, batch export, dan log archival.

### 3.5 Dictionary/Window

Banyak compression algorithm bekerja dengan mencari pengulangan dalam window tertentu. Jika data punya banyak pola berulang, compression ratio bagus. Jika data random/encrypted/compressed, ratio buruk.

---

## 4. Peta API Java `java.util.zip`

Java standard library menyediakan package `java.util.zip` untuk membaca/menulis ZIP dan GZIP serta melakukan compression/decompression berbasis DEFLATE.

Class penting:

| Kategori | Class | Fungsi |
|---|---|---|
| GZIP stream | `GZIPInputStream` | Membaca stream GZIP |
| GZIP stream | `GZIPOutputStream` | Menulis stream GZIP |
| ZIP archive | `ZipInputStream` | Membaca ZIP entry secara streaming |
| ZIP archive | `ZipOutputStream` | Menulis ZIP entry secara streaming |
| ZIP random-ish access | `ZipFile` | Membaca ZIP sebagai file archive dengan entry lookup |
| ZIP metadata | `ZipEntry` | Metadata entry dalam ZIP |
| Raw compression | `Deflater` | Compress bytes menjadi ZLIB/DEFLATE |
| Raw decompression | `Inflater` | Decompress bytes dari ZLIB/DEFLATE |
| Stream wrapper | `DeflaterOutputStream` | Compress sambil menulis output stream |
| Stream wrapper | `InflaterInputStream` | Decompress sambil membaca input stream |
| Checksum | `CRC32` | CRC-32 checksum |
| Checksum | `CRC32C` | CRC-32C checksum |
| Checksum | `Adler32` | Adler-32 checksum |
| Exception | `ZipException` | Error format ZIP/GZIP/deflate |
| Exception | `DataFormatException` | Error data compressed invalid pada raw inflater |

Mental model hierarchy:

```text
InputStream
  FilterInputStream
    InflaterInputStream
      GZIPInputStream
      ZipInputStream

OutputStream
  FilterOutputStream
    DeflaterOutputStream
      GZIPOutputStream
      ZipOutputStream
```

Artinya GZIP/ZIP API Java mengikuti model decorator/filter seperti `java.io` yang sudah dibahas di Part 002.

---

## 5. GZIP: Satu Stream, Satu Payload

GZIP cocok untuk mengompresi **satu stream data**.

Contoh ideal:

- satu file log besar,
- satu response HTTP,
- satu JSON besar,
- satu CSV export,
- satu stream event dump,
- satu backup text/binary.

GZIP bukan archive multi-file. Ia tidak menyimpan banyak file dengan path berbeda seperti ZIP.

### 5.1 Struktur Konseptual GZIP

Secara sederhana:

```text
GZIP header
compressed DEFLATE data
GZIP trailer: CRC + uncompressed size modulo 2^32
```

Implikasi penting:

- `GZIPOutputStream` harus ditutup atau `finish()` dipanggil agar trailer tertulis.
- Jika trailer tidak tertulis, decompressor bisa gagal membaca atau mendeteksi data truncated.
- `flush()` bukan pengganti `close()`/`finish()` untuk menyelesaikan format.

### 5.2 Menulis GZIP File

```java
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPOutputStream;

public final class GzipWriteExample {
    public static void main(String[] args) throws IOException {
        Path output = Path.of("report.csv.gz");

        try (OutputStream fileOut = Files.newOutputStream(output);
             BufferedOutputStream bufferedOut = new BufferedOutputStream(fileOut, 64 * 1024);
             GZIPOutputStream gzipOut = new GZIPOutputStream(bufferedOut)) {

            gzipOut.write("id,name\n".getBytes(StandardCharsets.UTF_8));
            gzipOut.write("1,Alice\n".getBytes(StandardCharsets.UTF_8));
            gzipOut.write("2,Bob\n".getBytes(StandardCharsets.UTF_8));
        }
    }
}
```

Hal penting:

```text
FileOutputStream <- BufferedOutputStream <- GZIPOutputStream <- aplikasi menulis original bytes
```

Aplikasi menulis **uncompressed/original bytes** ke `GZIPOutputStream`. Yang ditulis ke file adalah compressed bytes.

### 5.3 Membaca GZIP File

```java
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPInputStream;

public final class GzipReadExample {
    public static void main(String[] args) throws IOException {
        Path input = Path.of("report.csv.gz");
        byte[] buffer = new byte[64 * 1024];

        try (InputStream fileIn = Files.newInputStream(input);
             BufferedInputStream bufferedIn = new BufferedInputStream(fileIn, 64 * 1024);
             GZIPInputStream gzipIn = new GZIPInputStream(bufferedIn)) {

            long totalUncompressed = 0;
            int n;
            while ((n = gzipIn.read(buffer)) != -1) {
                totalUncompressed += n;
                // Process original uncompressed bytes here.
            }

            System.out.println("Uncompressed bytes = " + totalUncompressed);
        }
    }
}
```

Hal penting:

```text
FileInputStream -> BufferedInputStream -> GZIPInputStream -> aplikasi membaca original bytes
```

Aplikasi membaca **uncompressed/original bytes** dari `GZIPInputStream`.

---

## 6. ZIP: Archive Berisi Entry

ZIP adalah archive. Satu ZIP dapat berisi banyak entry.

Contoh:

```text
backup.zip
  customer.csv
  invoices/2025-01.csv
  invoices/2025-02.csv
  metadata.json
```

Setiap entry punya metadata:

- name/path,
- size,
- compressed size,
- CRC,
- modification time,
- method: stored/deflated,
- optional extra fields.

### 6.1 ZIP Bukan Directory Biasa

ZIP terlihat seperti folder, tetapi secara format ia archive dengan metadata dan central directory.

Konsekuensi:

- nama entry adalah string path-like, bukan `Path` filesystem sungguhan,
- path separator dalam ZIP umumnya `/`, bukan `\`,
- entry bisa malicious: `../../etc/passwd`, `/absolute/path`, `C:\Windows\...`, symlink-like entry, nama kosong, duplicate name,
- entry metadata bisa tidak lengkap atau tidak tepercaya,
- size bisa tidak diketahui sebelum entry selesai dibaca.

### 6.2 Menulis ZIP Secara Streaming

```java
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class ZipWriteExample {
    public static void main(String[] args) throws IOException {
        Path zipPath = Path.of("bundle.zip");
        List<Path> files = List.of(Path.of("report.csv"), Path.of("metadata.json"));

        try (OutputStream fileOut = Files.newOutputStream(zipPath);
             BufferedOutputStream bufferedOut = new BufferedOutputStream(fileOut, 64 * 1024);
             ZipOutputStream zipOut = new ZipOutputStream(bufferedOut)) {

            byte[] buffer = new byte[64 * 1024];

            for (Path file : files) {
                if (!Files.isRegularFile(file)) {
                    continue;
                }

                String entryName = file.getFileName().toString();
                ZipEntry entry = new ZipEntry(entryName);
                zipOut.putNextEntry(entry);

                try (var in = Files.newInputStream(file)) {
                    int n;
                    while ((n = in.read(buffer)) != -1) {
                        zipOut.write(buffer, 0, n);
                    }
                }

                zipOut.closeEntry();
            }
        }
    }
}
```

Poin penting:

- `putNextEntry()` membuka entry baru.
- `closeEntry()` menyelesaikan entry.
- `close()` pada `ZipOutputStream` menyelesaikan archive.
- Jangan lupa menutup entry/archive.
- Jangan membuat `byte[]` sebesar file.

### 6.3 Membaca ZIP Secara Streaming

```java
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class ZipReadStreamingExample {
    public static void main(String[] args) throws IOException {
        Path zipPath = Path.of("bundle.zip");
        byte[] buffer = new byte[64 * 1024];

        try (InputStream fileIn = Files.newInputStream(zipPath);
             BufferedInputStream bufferedIn = new BufferedInputStream(fileIn, 64 * 1024);
             ZipInputStream zipIn = new ZipInputStream(bufferedIn)) {

            ZipEntry entry;
            while ((entry = zipIn.getNextEntry()) != null) {
                System.out.println("Entry: " + entry.getName());

                if (!entry.isDirectory()) {
                    long bytes = 0;
                    int n;
                    while ((n = zipIn.read(buffer)) != -1) {
                        bytes += n;
                        // Process entry bytes here.
                    }
                    System.out.println("Read bytes: " + bytes);
                }

                zipIn.closeEntry();
            }
        }
    }
}
```

`ZipInputStream` bagus untuk sequential processing. Jika perlu lookup entry by name, `ZipFile` biasanya lebih cocok karena bisa membaca central directory.

---

## 7. `ZipInputStream` vs `ZipFile`

| Aspek | `ZipInputStream` | `ZipFile` |
|---|---|---|
| Sumber | `InputStream` | File ZIP di filesystem |
| Access pattern | Sequential | Entry lookup/enumeration |
| Cocok untuk | Upload stream, network stream | ZIP lokal yang ingin dibaca entry tertentu |
| Memory | Streaming | Metadata archive dibaca dari file |
| Bisa random access entry | Tidak praktis | Ya |
| Bisa dari HTTP body langsung | Ya | Tidak langsung, perlu file lokal |
| Validasi extraction | Tetap wajib | Tetap wajib |

Rule of thumb:

```text
Kalau input archive datang sebagai stream dan diproses sekali dari awal sampai akhir -> ZipInputStream.
Kalau archive sudah berupa file lokal dan perlu baca entry tertentu -> ZipFile.
```

Contoh `ZipFile`:

```java
import java.io.IOException;
import java.nio.file.Path;
import java.util.zip.ZipFile;

public final class ZipFileExample {
    public static void main(String[] args) throws IOException {
        Path zipPath = Path.of("bundle.zip");

        try (ZipFile zipFile = new ZipFile(zipPath.toFile())) {
            var entry = zipFile.getEntry("metadata.json");
            if (entry == null) {
                throw new IOException("metadata.json not found");
            }

            try (var in = zipFile.getInputStream(entry)) {
                byte[] bytes = in.readAllBytes(); // OK only if entry size is known/small/trusted.
                System.out.println(new String(bytes));
            }
        }
    }
}
```

Catatan: contoh memakai `readAllBytes()` hanya untuk entry kecil dan trusted. Untuk production, gunakan streaming dengan limit.

---

## 8. Deflater dan Inflater: Raw Compression Engine

`Deflater` dan `Inflater` adalah engine level lebih rendah.

Gunakan ketika:

- kamu membuat format binary custom,
- kamu perlu kontrol dictionary/level/strategy,
- kamu tidak ingin wrapper GZIP/ZIP,
- kamu bekerja dengan `ByteBuffer`,
- kamu mengintegrasikan compression ke frame protocol.

Namun untuk kebanyakan aplikasi, `GZIPOutputStream`, `GZIPInputStream`, `ZipOutputStream`, dan `ZipInputStream` lebih aman dan sederhana.

### 8.1 Deflater dengan Byte Array

```java
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

public final class DeflaterInflaterExample {
    public static void main(String[] args) throws Exception {
        byte[] input = "hello hello hello hello".getBytes(StandardCharsets.UTF_8);

        Deflater deflater = new Deflater(Deflater.BEST_COMPRESSION);
        try {
            deflater.setInput(input);
            deflater.finish();

            byte[] compressed = new byte[1024];
            int compressedLength = deflater.deflate(compressed);
            compressed = Arrays.copyOf(compressed, compressedLength);

            Inflater inflater = new Inflater();
            try {
                inflater.setInput(compressed);
                byte[] restored = new byte[1024];
                int restoredLength = inflater.inflate(restored);

                String text = new String(restored, 0, restoredLength, StandardCharsets.UTF_8);
                System.out.println(text);
            } finally {
                inflater.end();
            }
        } finally {
            deflater.end();
        }
    }
}
```

Poin penting:

- `Deflater`/`Inflater` memakai resource native/internal, sehingga perlu `end()`/`close()`.
- Output buffer bisa terlalu kecil; contoh di atas hanya untuk demo kecil.
- Untuk production, gunakan loop dan bounded output.
- Raw deflate harus diberi framing sendiri jika dipakai di network protocol.

### 8.2 Raw Compression Tidak Punya Metadata File

`Deflater` tidak menyimpan:

- nama file,
- timestamp,
- entry boundary,
- MIME type,
- original size secara format archive,
- checksum tingkat aplikasi,
- version format aplikasi.

Kalau kamu pakai raw compression untuk protocol custom, kamu harus mendesain envelope sendiri:

```text
magic bytes
version
compression algorithm id
uncompressed length
compressed length
checksum
payload
```

Tanpa envelope, receiver tidak tahu cara membedakan stream valid, truncated, atau corrupted.

---

## 9. TAR Concept: Archive Dulu, Compress Kemudian

Java standard library tidak menyediakan TAR API di `java.util.zip`. Namun konsep TAR penting karena sering muncul di file `.tar`, `.tar.gz`, `.tgz`.

TAR adalah archive format: menggabungkan banyak file menjadi satu stream.

GZIP adalah compression format: mengompresi satu stream.

Maka `.tar.gz` berarti:

```text
files/directories -> TAR archive stream -> GZIP compressed stream -> .tar.gz file
```

Bukan:

```text
setiap file di-gzip satu per satu lalu digabung
```

Implikasi:

- Untuk membaca `.tar.gz`, urutannya:

```text
FileInputStream -> GZIPInputStream -> TarArchiveInputStream -> entries
```

- Untuk menulis `.tar.gz`, urutannya:

```text
TarArchiveOutputStream -> GZIPOutputStream -> FileOutputStream
```

Karena Java SE tidak punya TAR built-in, biasanya memakai Apache Commons Compress.

Namun prinsip safety tetap sama:

- validasi path entry,
- limit ukuran decompressed output,
- hindari symlink escape,
- jangan percaya metadata archive,
- jangan extract langsung ke target final tanpa staging.

---

## 10. Compression Level: CPU vs Size

`Deflater` menyediakan level compression:

```java
Deflater.NO_COMPRESSION
Deflater.BEST_SPEED
Deflater.BEST_COMPRESSION
Deflater.DEFAULT_COMPRESSION
```

Level tinggi tidak selalu lebih baik.

| Situasi | Rekomendasi Awal |
|---|---|
| Network mahal, CPU murah | Level lebih tinggi bisa masuk akal |
| CPU bottleneck, disk/network cepat | `BEST_SPEED` atau default |
| Data sudah compressed/encrypted | Jangan compress atau pakai detection |
| Low-latency request | Hindari compression mahal |
| Batch archival | Compression lebih tinggi bisa diterima |
| Massive export | Benchmark dengan data nyata |

Compression ratio sangat tergantung data:

| Data | Biasanya compressible? |
|---|---|
| CSV | Ya, sering sangat baik |
| JSON | Ya |
| XML | Ya |
| Log text | Ya |
| Repeated binary | Bisa |
| JPEG/PNG/MP4/PDF compressed | Umumnya tidak banyak |
| ZIP/GZIP existing | Tidak |
| Encrypted bytes | Tidak |
| Random bytes | Tidak |

Anti-pattern:

```text
Semua output harus di-gzip karena pasti lebih kecil.
```

Lebih benar:

```text
Compression adalah optimization yang harus dikaitkan dengan data profile, CPU budget, latency target, dan transfer/storage cost.
```

---

## 11. Streaming Compression Pipeline

Compression yang benar untuk data besar hampir selalu streaming.

### 11.1 Salah: Seluruh Data di Memory

```java
byte[] original = Files.readAllBytes(Path.of("big.csv"));
byte[] compressed = compress(original);
Files.write(Path.of("big.csv.gz"), compressed);
```

Masalah:

- OOM untuk file besar,
- memory spike,
- GC pressure,
- tidak ada progress granular,
- gagal total jika process mati di tengah,
- tidak cocok untuk network stream.

### 11.2 Benar: Copy Streaming

```java
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPOutputStream;

public final class StreamingGzipCompressor {
    public static void compress(Path source, Path target) throws IOException {
        byte[] buffer = new byte[128 * 1024];

        try (var in = new BufferedInputStream(Files.newInputStream(source), buffer.length);
             var out = new GZIPOutputStream(
                     new BufferedOutputStream(Files.newOutputStream(target), buffer.length))) {

            int n;
            while ((n = in.read(buffer)) != -1) {
                out.write(buffer, 0, n);
            }
        }
    }
}
```

`InputStream.transferTo(out)` juga bisa dipakai, tetapi explicit loop sering lebih baik saat butuh:

- metrics per chunk,
- checksum,
- rate limit,
- cancellation,
- progress callback,
- max byte limit,
- timeout/cooperative stop,
- fault injection.

---

## 12. Checksum: CRC Bukan Authentication

ZIP/GZIP memakai CRC untuk mendeteksi corruption accidental.

CRC berguna untuk:

- mendeteksi data rusak,
- mendeteksi truncated output,
- validasi entry sederhana,
- transfer integrity non-adversarial.

CRC tidak cukup untuk security/adversarial integrity.

CRC bukan:

- tanda tangan digital,
- MAC,
- bukti origin,
- proteksi dari attacker yang bisa mengubah data dan CRC.

Untuk security boundary, gunakan:

- HMAC,
- digital signature,
- TLS untuk transport,
- checksum cryptographic seperti SHA-256 untuk integrity manifest,
- signature manifest untuk non-repudiation.

### 12.1 Menghitung SHA-256 Saat Streaming

```java
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class StreamingDigestExample {
    public static String sha256(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[128 * 1024];

        try (InputStream in = new DigestInputStream(Files.newInputStream(path), digest)) {
            while (in.read(buffer) != -1) {
                // DigestInputStream updates digest automatically.
            }
        }

        return HexFormat.of().formatHex(digest.digest());
    }
}
```

Untuk data transfer penting, checksum sebaiknya ada di luar compressed stream sebagai manifest:

```text
fileName: report.csv.gz
compressedBytes: 1234567
uncompressedBytes: 9876543
compressedSha256: ...
uncompressedSha256: ...
algorithm: gzip
createdAt: ...
```

Kenapa dua checksum?

- compressed checksum memvalidasi object yang disimpan/ditransfer,
- uncompressed checksum memvalidasi payload logical setelah decompression.

---

## 13. Safe ZIP Extraction

Extraction adalah security boundary.

Tidak boleh percaya:

- nama entry,
- ukuran entry,
- jumlah entry,
- tipe entry,
- timestamp,
- permission,
- path separator,
- symbolic link behavior,
- compressed size,
- uncompressed size.

### 13.1 Zip Slip

Zip Slip terjadi ketika entry archive berisi path traversal sehingga file diekstrak keluar dari target directory.

Contoh malicious entry:

```text
../../../../etc/passwd
../app/config/application.yml
/var/app/secrets.env
C:\Users\victim\.ssh\authorized_keys
```

Jika extraction naïve:

```java
Path output = targetDir.resolve(entry.getName());
Files.copy(zipIn, output);
```

Maka attacker bisa menulis file di luar `targetDir`.

### 13.2 Safe Resolve Pattern

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class SafeZipExtractor {
    private static final long MAX_TOTAL_UNCOMPRESSED_BYTES = 500L * 1024 * 1024;
    private static final long MAX_ENTRY_UNCOMPRESSED_BYTES = 100L * 1024 * 1024;
    private static final int MAX_ENTRIES = 10_000;

    public static void extract(ZipInputStream zipIn, Path targetDir) throws IOException {
        Path normalizedTarget = targetDir.toAbsolutePath().normalize();
        Files.createDirectories(normalizedTarget);

        byte[] buffer = new byte[128 * 1024];
        long totalBytes = 0;
        int entryCount = 0;

        ZipEntry entry;
        while ((entry = zipIn.getNextEntry()) != null) {
            entryCount++;
            if (entryCount > MAX_ENTRIES) {
                throw new IOException("Too many ZIP entries");
            }

            String name = entry.getName();
            if (name == null || name.isBlank()) {
                throw new IOException("Invalid ZIP entry name");
            }

            Path output = normalizedTarget.resolve(name).normalize();
            if (!output.startsWith(normalizedTarget)) {
                throw new IOException("ZIP entry escapes target directory: " + name);
            }

            if (entry.isDirectory()) {
                Files.createDirectories(output);
                zipIn.closeEntry();
                continue;
            }

            Path parent = output.getParent();
            if (parent == null || !parent.startsWith(normalizedTarget)) {
                throw new IOException("Invalid ZIP entry parent: " + name);
            }
            Files.createDirectories(parent);

            long entryBytes = 0;
            try (var out = Files.newOutputStream(output)) {
                int n;
                while ((n = zipIn.read(buffer)) != -1) {
                    entryBytes += n;
                    totalBytes += n;

                    if (entryBytes > MAX_ENTRY_UNCOMPRESSED_BYTES) {
                        throw new IOException("ZIP entry too large: " + name);
                    }
                    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                        throw new IOException("ZIP archive uncompressed size too large");
                    }

                    out.write(buffer, 0, n);
                }
            }

            zipIn.closeEntry();
        }
    }
}
```

Prinsip penting:

```text
resolve -> normalize -> startsWith(targetDir)
```

Namun ini belum menyelesaikan semua risiko symlink. Untuk threat model tinggi, extraction perlu staging directory yang baru, permission ketat, validasi tidak mengikuti symlink, dan mungkin menolak symlink/hardlink entry jika format/library mendukung metadata tersebut.

---

## 14. Zip Bomb dan Decompression Bomb

Zip bomb adalah archive kecil yang menghasilkan output sangat besar saat diekstrak.

Contoh konseptual:

```text
compressed size: 10 MB
uncompressed size: 100 GB
```

Risiko:

- disk penuh,
- memory penuh,
- CPU habis,
- worker thread stuck,
- service down,
- cascading failure.

### 14.1 Defense

Selalu terapkan limit:

- max compressed bytes,
- max uncompressed total bytes,
- max uncompressed bytes per entry,
- max entry count,
- max nesting depth jika archive bisa nested,
- max filename length,
- max extraction duration,
- max compression ratio,
- allowed file extension/type,
- staging filesystem quota jika tersedia.

Compression ratio heuristic:

```text
uncompressed_bytes / compressed_bytes
```

Jika ratio terlalu tinggi, reject atau quarantine.

Namun jangan hanya bergantung pada metadata `ZipEntry.getSize()` dan `getCompressedSize()` karena bisa tidak tersedia atau tidak tepercaya. Hitung byte aktual saat membaca.

---

## 15. Compression di Network Transfer

Compression sering dipakai untuk network transfer, tetapi desainnya harus sadar boundary.

### 15.1 HTTP GZIP

Untuk HTTP, compression bisa terjadi di beberapa tempat:

```text
application produces JSON
HTTP client/server applies Content-Encoding: gzip
network transfers compressed bytes
receiver decompresses body
application consumes JSON
```

Perbedaan penting:

| Header | Makna |
|---|---|
| `Content-Type` | Tipe media logical, misalnya `application/json` |
| `Content-Encoding` | Encoding representasi body, misalnya `gzip` |
| `Accept-Encoding` | Client menerima response encoding apa |

Contoh:

```text
Content-Type: application/json
Content-Encoding: gzip
```

Maknanya: payload logical adalah JSON, tetapi body dikirim dalam bentuk GZIP.

### 15.2 Compression dan Retry

Jika transfer gagal di tengah compressed stream, receiver tidak bisa selalu melanjutkan begitu saja dari offset uncompressed. Offset compressed dan offset uncompressed tidak identik.

Untuk resumable transfer, biasanya lebih aman:

```text
split original file into chunks
compress each chunk independently
store manifest: chunk number, compressed size, uncompressed size, checksum
transfer chunk-by-chunk
verify each chunk
assemble logical output
```

Daripada:

```text
compress satu file besar menjadi satu .gz
transfer partially
resume dari offset arbitrary tanpa format support
```

### 15.3 Compression dan Backpressure

Compression bisa membuat producer-consumer rate berubah.

Contoh:

```text
producer menghasilkan 200 MB/s original data
compressor hanya mampu 80 MB/s
network mampu 300 MB/s
```

Bottleneck ada di CPU compression, bukan network.

Atau:

```text
producer 200 MB/s
compressor 200 MB/s
network 20 MB/s
```

Jika output buffer tidak bounded, memory bisa membengkak.

Prinsip:

```text
compression pipeline harus tetap bounded dan backpressure-aware
```

---

## 16. Compression Before Encryption atau After Encryption?

Umumnya:

```text
compress -> encrypt
```

Bukan:

```text
encrypt -> compress
```

Alasannya: encrypted data terlihat random sehingga sulit dikompresi.

Namun ada security caveat: compression sebelum encryption pada interactive/adversarial protocol bisa membuka side-channel tertentu jika attacker bisa mengontrol sebagian plaintext dan mengamati ukuran ciphertext. Ini pernah relevan pada kelas serangan seperti CRIME/BREACH di web context.

Rule praktis:

- Untuk file batch internal: compress lalu encrypt biasanya wajar.
- Untuk HTTP response yang mengandung secret dan attacker bisa memengaruhi input: hati-hati dengan compression.
- Jangan mengaktifkan compression otomatis tanpa threat model.
- Jangan compress token/secret-bearing response sembarangan.

---

## 17. Atomic Compression Output

Saat membuat file `.gz` atau `.zip`, jangan langsung menulis ke final path jika consumer bisa melihat file tersebut.

Salah:

```text
write report.csv.gz directly
consumer picks it while still incomplete
consumer sees corrupted/truncated gzip
```

Benar:

```text
write report.csv.gz.tmp
finish stream
fsync/force if needed
atomic move to report.csv.gz
write/rename manifest or done marker
```

Contoh:

```java
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.zip.GZIPOutputStream;

public final class AtomicGzipWriter {
    public static void compressAtomically(Path source, Path finalTarget) throws IOException {
        Path dir = finalTarget.toAbsolutePath().getParent();
        if (dir == null) {
            dir = Path.of(".").toAbsolutePath();
        }
        Files.createDirectories(dir);

        Path temp = Files.createTempFile(dir, finalTarget.getFileName().toString(), ".tmp");
        boolean success = false;

        try {
            byte[] buffer = new byte[128 * 1024];

            try (var in = Files.newInputStream(source);
                 var out = new GZIPOutputStream(new BufferedOutputStream(Files.newOutputStream(temp)))) {
                int n;
                while ((n = in.read(buffer)) != -1) {
                    out.write(buffer, 0, n);
                }
            }

            // Optional durability step for stronger persistence requirements.
            try (FileChannel channel = FileChannel.open(temp, StandardOpenOption.READ)) {
                channel.force(true);
            }

            Files.move(temp, finalTarget,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);

            success = true;
        } finally {
            if (!success) {
                Files.deleteIfExists(temp);
            }
        }
    }
}
```

Catatan:

- Atomic move hanya dijamin jika filesystem mendukung dan source/target berada pada filesystem yang sama.
- Untuk durability yang sangat ketat, directory fsync juga perlu dipertimbangkan, tetapi Java SE tidak menyediakan API portabel yang nyaman untuk semua OS.

---

## 18. Failure Model Compression

| Failure | Gejala | Penyebab | Defense |
|---|---|---|---|
| Truncated GZIP | `EOFException`, `ZipException`, invalid trailer | proses mati sebelum close/finish | temp file + atomic move + manifest |
| Corrupt compressed data | `ZipException`, `DataFormatException` | transfer rusak, disk corruption | checksum + retry + quarantine |
| Zip Slip | file keluar target dir | entry path malicious | normalize + startsWith + staging |
| Zip bomb | disk/CPU habis | decompressed output sangat besar | max bytes, max entries, quota |
| Duplicate entry | overwrite/conflict | archive ambigu/malicious | reject duplicate names |
| Entry metadata salah | size -1/invalid | streaming ZIP/data descriptor | hitung byte aktual |
| Password/encrypted ZIP | tidak bisa dibaca standard API tertentu | ZIP encryption unsupported/varian | gunakan library tepat atau reject |
| Too many small entries | overhead tinggi | archive abuse | max entry count |
| Compression CPU bottleneck | latency naik | level terlalu tinggi/data besar | benchmark, tune level, async batch |
| Ineffective compression | output hampir sama/besar | data sudah compressed/encrypted | skip compression berdasarkan MIME/profile |
| Wrong stream order | output invalid | wrapper salah | pahami pipeline decorator |
| Premature close underlying stream | upload/download gagal | ownership salah | lifecycle contract jelas |

---

## 19. Anti-Pattern Umum

### Anti-Pattern 1 — `readAllBytes()` untuk Archive Besar

```java
byte[] data = Files.readAllBytes(zipPath);
```

Masalah:

- OOM,
- GC pressure,
- tidak ada limit decompressed,
- buruk untuk upload besar.

Gunakan streaming.

### Anti-Pattern 2 — Extract Tanpa Validasi Path

```java
Files.copy(zipIn, targetDir.resolve(entry.getName()));
```

Masalah: Zip Slip.

### Anti-Pattern 3 — Percaya `ZipEntry.getSize()`

```java
if (entry.getSize() < MAX) { ... }
```

Masalah:

- size bisa `-1`,
- metadata bisa tidak tersedia,
- attacker bisa memalsukan metadata,
- tetap perlu limit saat membaca.

### Anti-Pattern 4 — Menganggap `flush()` Menyelesaikan GZIP

```java
gzipOut.write(data);
gzipOut.flush();
// file dianggap valid
```

Masalah: trailer mungkin belum selesai. Gunakan `finish()` atau `close()`.

### Anti-Pattern 5 — Compress Data yang Sudah Compressed

```text
jpg -> gzip -> upload
zip -> gzip -> upload
pdf -> gzip -> upload
```

Kadang output lebih besar dan CPU terbuang.

### Anti-Pattern 6 — Satu GZIP Besar untuk Resumable Transfer Kompleks

Masalah: resume arbitrary offset sulit.

Gunakan chunk independent + manifest jika resumability penting.

### Anti-Pattern 7 — Tidak Ada Observability

Compression job tanpa metrics membuat bottleneck sulit dianalisis.

Minimal metrics:

- input bytes,
- output bytes,
- compression ratio,
- duration,
- throughput,
- entry count,
- failure reason,
- rejected archives,
- decompression limit hits.

---

## 20. Production Pattern: Safe Archive Ingestion

### 20.1 Problem

Sistem menerima ZIP dari user/vendor/agency, lalu mengekstrak dan memproses file di dalamnya.

### 20.2 Risiko

- archive terlalu besar,
- decompressed output terlalu besar,
- path traversal,
- duplicate file,
- file type tidak sesuai,
- file corrupt,
- ZIP metadata tidak valid,
- processing partial jika gagal di tengah,
- retry menghasilkan duplicate,
- consumer membaca file sebelum lengkap.

### 20.3 Pattern

```text
1. Receive archive into staging object/file
2. Verify compressed size limit
3. Compute compressed checksum
4. Open archive streaming
5. For each entry:
   - validate name
   - normalize path
   - reject escape
   - reject disallowed extension
   - reject duplicate canonical entry name
   - stream to staging extraction path
   - count bytes
   - enforce per-entry and total limit
   - compute per-entry checksum
6. Write extraction manifest
7. Atomic publish staging directory or mark READY
8. Process entries idempotently
9. Record audit trail
10. Cleanup staging on failure according to retention policy
```

### 20.4 State Machine

```text
RECEIVED
  -> VALIDATING_ARCHIVE
  -> EXTRACTING
  -> EXTRACTED
  -> PROCESSING
  -> COMPLETED

Failure states:
  -> REJECTED_INVALID_FORMAT
  -> REJECTED_POLICY_VIOLATION
  -> FAILED_IO
  -> FAILED_PROCESSING
  -> QUARANTINED
```

### 20.5 Invariants

- File final tidak terlihat sebelum lengkap.
- Semua path hasil extraction berada di bawah staging root.
- Total uncompressed bytes tidak melewati limit.
- Jumlah entry tidak melewati limit.
- Duplicate canonical entry name ditolak.
- Manifest ditulis hanya setelah extraction selesai.
- Processing downstream membaca dari manifest, bukan scanning liar.
- Retry menggunakan archive id/checksum yang sama untuk idempotency.

---

## 21. Production Pattern: Compressed Export Job

### 21.1 Problem

Sistem menghasilkan export besar, misalnya CSV report, lalu menyimpannya sebagai `.csv.gz`.

### 21.2 Pattern

```text
1. Create export job id
2. Open temp output file
3. Open GZIPOutputStream
4. Stream rows directly to writer/encoder/gzip
5. Track original bytes/records
6. Finish GZIP stream
7. Compute compressed checksum
8. Atomic move to final location
9. Write manifest
10. Mark job COMPLETED
```

### 21.3 Jangan Lakukan Ini

```text
build all rows in List
join into String
convert to byte[]
gzip byte[]
write file
```

Masalah:

- memory besar,
- tidak scalable,
- tidak ada backpressure,
- gagal untuk report besar.

### 21.4 Output Manifest

```json
{
  "jobId": "EXP-2026-0001",
  "fileName": "report.csv.gz",
  "contentType": "text/csv",
  "contentEncoding": "gzip",
  "recordCount": 1234567,
  "uncompressedBytes": 987654321,
  "compressedBytes": 123456789,
  "compressedSha256": "...",
  "createdAt": "2026-06-16T10:15:30Z"
}
```

---

## 22. Testing Strategy

### 22.1 Unit Test

Test:

- GZIP round-trip,
- ZIP multi-entry round-trip,
- empty file,
- empty ZIP,
- directory entry,
- nested entry,
- large-ish stream,
- corrupt input,
- truncated input,
- duplicate entry,
- dangerous path.

### 22.2 Security Test Cases

Entry names:

```text
../evil.txt
../../evil.txt
/absolute/evil.txt
C:\\evil.txt
folder/../../evil.txt
folder//file.txt
folder/./file.txt
folder/sub/../file.txt
```

Expected: reject or normalize safely according to policy.

### 22.3 Zip Bomb Simulation

Jangan memakai zip bomb asli di test environment umum. Buat controlled test:

- small compressed, large repeated output,
- limit total uncompressed bytes rendah,
- pastikan extractor reject saat limit tercapai.

### 22.4 Fault Injection

Simulasikan:

- stream throws IOException mid-read,
- disk full saat write,
- process interrupted,
- permission denied,
- invalid CRC,
- incomplete GZIP trailer,
- timeout jika sumber network.

---

## 23. Performance Notes

### 23.1 Buffer Size

Buffer umum:

```text
64 KiB sampai 256 KiB
```

Namun angka terbaik tergantung workload.

Terlalu kecil:

- banyak call,
- overhead tinggi.

Terlalu besar:

- memory footprint tinggi,
- buruk jika banyak concurrent transfer,
- tidak selalu meningkatkan throughput.

### 23.2 Compression Level Benchmark

Benchmark dengan data nyata:

```text
level 1: fast, ratio sedang
level 6/default: balance
level 9: lambat, ratio terbaik belum tentu jauh lebih baik
```

Yang harus diukur:

- input bytes/sec,
- output bytes/sec,
- CPU usage,
- compression ratio,
- p95/p99 latency untuk request path,
- memory footprint,
- GC allocation rate.

### 23.3 Parallelism

ZIP/GZIP standard stream pada dasarnya sequential. Untuk parallelism:

- split data ke chunk independent,
- compress masing-masing chunk paralel,
- simpan manifest urutan,
- atau gunakan format/library yang mendukung parallel compression.

Jangan asal multi-thread menulis ke satu `ZipOutputStream`; stream output harus punya ordering dan lifecycle entry yang jelas.

---

## 24. Security Checklist

Untuk menerima archive dari luar:

- [ ] Batasi compressed input size.
- [ ] Batasi total uncompressed size.
- [ ] Batasi uncompressed size per entry.
- [ ] Batasi jumlah entry.
- [ ] Batasi panjang nama entry.
- [ ] Normalize dan validasi output path.
- [ ] Pastikan output path tetap di bawah target directory.
- [ ] Tolak absolute path.
- [ ] Tolak path traversal.
- [ ] Tolak duplicate canonical entry name.
- [ ] Jangan percaya `ZipEntry.getSize()` saja.
- [ ] Hitung byte aktual saat read.
- [ ] Gunakan staging directory.
- [ ] Publish hasil secara atomic/manifest-based.
- [ ] Jangan overwrite file penting tanpa policy eksplisit.
- [ ] Jangan extract sebagai privileged user jika tidak perlu.
- [ ] Log metadata, bukan isi file sensitif.
- [ ] Quarantine file invalid jika perlu audit.

---

## 25. Decision Matrix

| Kebutuhan | Pilihan Awal |
|---|---|
| Compress satu file/stream besar | GZIP |
| Archive banyak file dan compress | ZIP |
| Archive banyak file lalu compress sebagai satu stream | TAR + GZIP, library eksternal |
| Butuh random lookup entry dalam file ZIP lokal | `ZipFile` |
| Butuh baca ZIP dari HTTP upload stream | `ZipInputStream` |
| Butuh format binary custom | `Deflater`/`Inflater` + envelope sendiri |
| Butuh speed sangat tinggi | Pertimbangkan LZ4/Snappy/Zstd eksternal |
| Butuh ratio tinggi untuk archival | GZIP level tinggi atau Zstd eksternal |
| Butuh resumable transfer | Chunk independent + manifest |
| Butuh security dari tampering | HMAC/signature, bukan CRC saja |

---

## 26. Latihan

### Latihan 1 — GZIP Round Trip

Buat program yang:

1. membaca file text besar,
2. membuat `.gz`,
3. membaca kembali `.gz`,
4. menghitung SHA-256 original dan hasil decompression,
5. memastikan sama.

### Latihan 2 — Safe ZIP Extractor

Implementasikan extractor yang:

- menolak path traversal,
- membatasi total output 100 MB,
- membatasi entry count 1000,
- menolak duplicate entry normalized,
- menghasilkan manifest JSON.

### Latihan 3 — Compression Benchmark

Benchmark data:

- CSV,
- JSON,
- PNG/JPEG,
- random bytes.

Ukur:

- compressed size,
- duration,
- ratio,
- throughput.

Bandingkan `BEST_SPEED`, `DEFAULT_COMPRESSION`, dan `BEST_COMPRESSION`.

### Latihan 4 — Atomic Compressed Export

Buat export `.csv.gz` yang:

- menulis ke temp file,
- close/finish GZIP,
- menghitung checksum,
- atomic move ke final,
- menulis manifest.

### Latihan 5 — Fault Injection

Buat `InputStream` custom yang melempar `IOException` setelah N byte, lalu pastikan:

- temp file dibersihkan,
- final file tidak muncul,
- status job menjadi failed,
- error tercatat.

---

## 27. Ringkasan

Compression di Java bukan hanya `new GZIPOutputStream(...)` atau `new ZipInputStream(...)`.

Compression adalah bagian dari I/O pipeline yang menyentuh:

- format data,
- stream lifecycle,
- buffering,
- CPU usage,
- network transfer,
- storage cost,
- checksum,
- security,
- atomicity,
- resumability,
- observability.

Mental model utama:

```text
GZIP = compress satu stream.
ZIP = archive banyak entry, tiap entry bisa compressed.
DEFLATE = algorithm/engine.
TAR = archive stream, biasanya dikombinasikan dengan GZIP.
CRC = corruption detection, bukan security proof.
Safe extraction = security boundary.
Compression production-grade = streaming + limit + checksum + atomic publish + observability.
```

Jika kamu sudah memahami bagian ini, kamu tidak hanya tahu cara zip/unzip file. Kamu mulai bisa mendesain sistem data transfer yang aman, hemat resource, tahan gagal, dan bisa dioperasikan di production.

---

## 28. Referensi

- Oracle Java API Documentation — `java.util.zip` package.
- Oracle Java API Documentation — `GZIPInputStream`, `GZIPOutputStream`.
- Oracle Java API Documentation — `ZipInputStream`, `ZipOutputStream`, `ZipFile`, `ZipEntry`.
- Oracle Java API Documentation — `Deflater`, `Inflater`, `DeflaterOutputStream`, `InflaterInputStream`.
- Oracle Java Security Developer guidance dan secure coding guidance terkait path canonicalization/resource handling.
