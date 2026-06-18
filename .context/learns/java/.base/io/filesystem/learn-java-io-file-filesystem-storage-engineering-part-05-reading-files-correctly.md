# learn-java-io-file-filesystem-storage-engineering — Part 05
# Reading Files Correctly: Small File, Large File, Streaming, Lazy Lines

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `05`  
> Topik: Membaca file secara benar, aman, efisien, dan production-grade di Java 8–25  
> Target pembaca: engineer yang sudah paham Java dasar dan ingin naik ke level desain sistem file workflow yang robust

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membahas bagaimana file dibuat dan dibuka. Sekarang kita masuk ke operasi yang tampak paling sederhana tetapi sering menjadi sumber bug production: **membaca file**.

Membaca file sering dianggap hanya soal memilih API:

```java
Files.readString(path);
Files.readAllLines(path);
Files.lines(path);
Files.newBufferedReader(path);
Files.newInputStream(path);
```

Padahal keputusan membaca file melibatkan beberapa dimensi:

1. ukuran file,
2. tipe data: binary atau text,
3. charset,
4. lifecycle resource,
5. memory pressure,
6. perubahan file saat sedang dibaca,
7. partial read,
8. exception handling,
9. durability/consistency expectation,
10. apakah file berasal dari trust boundary yang aman atau tidak.

Target part ini bukan hanya hafal API, tetapi memahami **mental model** di baliknya.

Setelah bagian ini, kamu harus bisa menjawab:

- Kapan aman memakai `readAllBytes`?
- Kenapa `Files.lines(path)` harus ditutup?
- Apa bedanya `readAllLines` dan `lines`?
- Kenapa text file tidak boleh dibaca tanpa charset eksplisit?
- Apa yang terjadi kalau file berubah saat dibaca?
- Bagaimana membaca file besar tanpa meledakkan heap?
- Bagaimana membuat reader pipeline yang aman, observable, dan mudah diuji?

---

## 1. Mental Model: Membaca File Bukan “Mengambil String dari Disk”

Secara mental, membaca file di Java adalah pipeline:

```text
Path
  -> FileSystemProvider
  -> OS open/read syscall
  -> filesystem metadata + file content
  -> kernel page cache
  -> Java byte buffer / native buffer
  -> byte stream / channel
  -> optional decoder charset
  -> Java object: byte[], String, List<String>, Stream<String>, domain object
```

Yang penting: **file tidak otomatis menjadi String**.

File pada dasarnya adalah urutan byte. Text hanyalah interpretasi terhadap byte tersebut menggunakan charset tertentu.

```text
File content on storage:
  48 65 6C 6C 6F 0A

Interpretation with UTF-8:
  "Hello\n"

Interpretation with different charset:
  could be different for non-ASCII bytes
```

Top 1% engineer tidak berpikir:

```text
read file -> get text
```

Tetapi berpikir:

```text
open file handle
-> read byte sequence
-> decide bounded/unbounded strategy
-> decode using explicit charset if text
-> process incrementally when possible
-> close resource deterministically
-> handle concurrent mutation and failure mode
```

---

## 2. API Landscape untuk Membaca File di Java 8–25

### 2.1 API utama

| API | Ada sejak | Cocok untuk | Risiko utama |
|---|---:|---|---|
| `Files.readAllBytes(Path)` | Java 7 | binary kecil/menengah | seluruh file masuk heap |
| `Files.readAllLines(Path, Charset)` | Java 7 | text kecil/menengah, butuh semua line | seluruh line masuk heap |
| `Files.lines(Path, Charset)` | Java 8 | lazy line streaming | wajib close stream |
| `Files.newBufferedReader(Path, Charset)` | Java 7 | kontrol manual line processing | wajib close reader |
| `Files.newInputStream(Path, OpenOption...)` | Java 7 | raw binary streaming | unbuffered; perlu buffer sendiri jika perlu |
| `FileChannel.open(Path, ...)` | Java 7 | random access, channel-based read | lifecycle lebih kompleks |
| `Files.readString(Path)` | Java 11 | text kecil/menengah | tidak ada di Java 8; seluruh file jadi String |

### 2.2 Java 8 compatibility note

Kalau target kamu Java 8, hindari API berikut:

```java
Files.readString(path);   // Java 11+
Path.of("file.txt");      // Java 11+
```

Gunakan:

```java
Path path = Paths.get("file.txt");
String content = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
```

Untuk Java 11+:

```java
Path path = Path.of("file.txt");
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Namun secara desain, jangan jadikan `readString` default untuk semua file. Ia convenience API, bukan universal file ingestion pattern.

---

## 3. Decision Matrix: Pilih API Berdasarkan Bentuk Masalah

### 3.1 Pertanyaan pertama: binary atau text?

```text
Apakah isi file harus diproses sebagai byte mentah?
  Ya  -> binary path: InputStream/FileChannel/readAllBytes terbatas
  Tidak -> text path: Reader/lines/readString dengan charset eksplisit
```

Contoh binary:

- PDF,
- image,
- ZIP,
- encrypted payload,
- protobuf,
- custom binary format,
- file yang akan di-hash,
- file yang akan di-copy tanpa memahami isinya.

Contoh text:

- CSV,
- JSON,
- XML,
- log,
- config,
- SQL script,
- manifest.

### 3.2 Pertanyaan kedua: perlu seluruh content sekaligus?

```text
Perlu semua content di memory?
  Ya, file bounded dan kecil -> readAllBytes/readString/readAllLines
  Tidak -> streaming reader/input stream/channel
```

Kata kunci penting: **bounded**.

File kecil hari ini bisa menjadi besar besok kalau sumbernya user upload, partner integration, log export, batch report, atau generated archive.

### 3.3 Pertanyaan ketiga: batas ukuran diketahui dan ditegakkan?

Bukan cukup bertanya “biasanya kecil”. Harus ada guardrail:

```text
max allowed size = 10 MB
reject if actual size > max
read fully only after size check
```

Tanpa batas ukuran, convenience API dapat menjadi denial-of-service vector.

### 3.4 Matrix ringkas

| Masalah | API pilihan | Catatan |
|---|---|---|
| Baca config UTF-8 kecil | `Files.readString` Java 11+ / `readAllBytes` Java 8 | enforce max size |
| Baca CSV besar | `Files.newBufferedReader` atau `Files.lines` | proses line-by-line |
| Baca binary upload untuk hash | `InputStream` + buffer + `MessageDigest` | jangan `readAllBytes` untuk file besar |
| Baca log besar filter tertentu | `BufferedReader` manual | streaming, short-circuit bisa dilakukan |
| Baca semua line untuk test golden file kecil | `readAllLines` | OK di test/fixture kecil |
| Baca format random-access | `FileChannel` | gunakan offset/position |
| Baca file dari filesystem provider non-default | `Files.*` | hindari asumsi local disk |

---

## 4. Membaca File Binary Kecil dengan `readAllBytes`

### 4.1 Contoh dasar

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class BinaryReadExample {
    public static byte[] readSmallBinaryFile(Path path) throws IOException {
        return Files.readAllBytes(path);
    }
}
```

Ini sederhana dan benar untuk file kecil.

Tetapi ada risiko:

```text
file size = 500 MB
heap = 512 MB
readAllBytes -> OutOfMemoryError risk
```

### 4.2 Jangan menganggap `readAllBytes` sebagai streaming

`readAllBytes` membaca seluruh file ke `byte[]`.

Artinya:

- semua byte harus muat di heap,
- ada alokasi array besar,
- jika nanti dikonversi ke String, bisa ada alokasi tambahan,
- jika diparse menjadi object, alokasi makin bertambah.

Contoh buruk:

```java
byte[] payload = Files.readAllBytes(uploadedFile);
String json = new String(payload, StandardCharsets.UTF_8);
MyDto dto = objectMapper.readValue(json, MyDto.class);
```

Untuk file besar, ini bisa membuat beberapa copy di memory:

```text
byte[] raw payload
+ char/string internal representation
+ parser buffer
+ object graph hasil parse
```

### 4.3 Gunakan size guard

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class SafeSmallFileReader {
    private static final long MAX_BYTES = 10L * 1024 * 1024; // 10 MiB

    public static byte[] readAtMost10MiB(Path path) throws IOException {
        long size = Files.size(path);

        if (size > MAX_BYTES) {
            throw new FileTooLargeException("File too large: " + size + " bytes");
        }

        return Files.readAllBytes(path);
    }

    public static final class FileTooLargeException extends IOException {
        public FileTooLargeException(String message) {
            super(message);
        }
    }
}
```

Namun size check juga bukan jaminan sempurna, karena file bisa berubah setelah dicek.

Untuk local trusted file, ini biasanya cukup. Untuk hostile input, kamu butuh streaming reader dengan enforced byte limit saat membaca.

---

## 5. Membaca Text: Charset Adalah Bagian dari Kontrak

### 5.1 File text = byte + charset

Text file bukan hanya “file berisi tulisan”. Text file adalah byte sequence yang harus didekode.

```text
bytes + UTF-8      -> String benar
bytes + ISO-8859-1 -> bisa beda
bytes + wrong charset -> mojibake / decode error / silent corruption
```

Contoh silent corruption:

```text
Nama asli: “Dian Pratiwi — Jakarta”
Dibaca dengan charset salah: “Dian Pratiwi â€” Jakarta”
```

### 5.2 Selalu pilih charset eksplisit

Baik:

```java
String content = Files.readString(path, StandardCharsets.UTF_8); // Java 11+
```

Java 8 compatible:

```java
String content = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
```

Untuk line processing:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Kurang baik untuk production portability:

```java
new FileReader(file); // historically depends on default charset in older patterns
```

### 5.3 Java version nuance: default charset changes

Di Java modern, default charset behavior sudah berubah di level platform Java melalui JEP 400 yang membuat UTF-8 sebagai default charset sejak Java 18. Tetapi untuk code yang harus berjalan Java 8–25, jangan bergantung pada default charset.

Desain yang benar tetap:

```java
StandardCharsets.UTF_8
```

atau charset eksplisit dari kontrak file.

---

## 6. `Files.readString`: Nyaman tetapi Bukan Default untuk Semua Kasus

### 6.1 Java 11+

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Cocok untuk:

- config kecil,
- template kecil,
- fixture test,
- SQL kecil,
- manifest kecil,
- metadata JSON kecil.

Tidak cocok untuk:

- upload besar,
- log besar,
- export CSV besar,
- archive,
- file dari user tanpa batas ukuran,
- file yang harus diproses streaming.

### 6.2 Java 8 equivalent

```java
String content = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
```

Ini setara secara pola memory: seluruh file masuk memory.

### 6.3 Pola aman

```java
public static String readSmallUtf8File(Path path, long maxBytes) throws IOException {
    long size = Files.size(path);
    if (size > maxBytes) {
        throw new IOException("File too large: " + size + " bytes");
    }
    return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
}
```

Untuk Java 11+:

```java
public static String readSmallUtf8File(Path path, long maxBytes) throws IOException {
    long size = Files.size(path);
    if (size > maxBytes) {
        throw new IOException("File too large: " + size + " bytes");
    }
    return Files.readString(path, StandardCharsets.UTF_8);
}
```

Tetapi ingat: file bisa bertambah setelah `Files.size`. Untuk hostile input, gunakan bounded stream.

---

## 7. `Files.readAllLines`: Mudah, Tetapi Mengumpulkan Semua Line

### 7.1 Contoh

```java
List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
```

Ini cocok untuk:

- file konfigurasi kecil,
- whitelist kecil,
- fixture test,
- file reference kecil,
- daftar rule kecil.

Tidak cocok untuk:

- log jutaan baris,
- CSV besar,
- file dari partner tanpa batas,
- file yang ingin diproses streaming.

### 7.2 Masalah memory

`readAllLines` membuat:

```text
List<String>
  -> String line 1
  -> String line 2
  -> ...
```

Jika file memiliki 10 juta baris, bahkan jika tiap baris kecil, overhead object `String` dan list sangat besar.

### 7.3 Line terminator

Secara konseptual, line-based reader harus menangani variasi line ending:

```text
LF    \n
CRLF  \r\n
CR    \r
```

Jangan parsing baris dengan split manual atas seluruh string besar jika tidak perlu:

```java
String content = Files.readString(path);
String[] lines = content.split("\n"); // buruk untuk file besar dan kurang robust
```

Lebih baik:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

---

## 8. `Files.lines`: Lazy, Tapi Harus Ditutup

### 8.1 Contoh dasar

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    lines
        .filter(line -> line.contains("ERROR"))
        .forEach(System.out::println);
}
```

`Files.lines` mengembalikan `Stream<String>` yang lazy. Artinya baris dibaca saat stream dikonsumsi.

Ini bagus untuk file besar karena tidak semua baris dimasukkan ke memory.

Tetapi ada aturan penting:

```text
Stream dari Files.lines harus ditutup.
```

Karena stream tersebut memegang resource I/O di bawahnya.

### 8.2 Anti-pattern: lupa close

Buruk:

```java
Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8);
long count = lines.count();
```

Lebih buruk lagi:

```java
return Files.lines(path, StandardCharsets.UTF_8)
    .filter(this::isValid);
```

Kenapa buruk?

Karena caller sekarang memegang stream yang resource-nya belum tentu ditutup. Ownership resource tidak jelas.

### 8.3 Pattern yang lebih aman

Buat method yang mengonsumsi stream di dalam method:

```java
public long countErrorLines(Path path) throws IOException {
    try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
        return lines.filter(line -> line.contains("ERROR")).count();
    }
}
```

Atau terima callback:

```java
public <T> T withLines(Path path, Function<Stream<String>, T> function) throws IOException {
    try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
        return function.apply(lines);
    }
}
```

Namun callback pattern harus hati-hati: jangan biarkan stream escape dari callback.

### 8.4 Lazy stream bukan magic memory-free

Walau lazy, operasi tertentu tetap bisa mengumpulkan data besar:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    List<String> all = lines.collect(Collectors.toList()); // kembali boros memory
}
```

Streaming hanya berguna jika processing juga streaming.

Baik:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    long invalidCount = lines
        .filter(line -> !isValid(line))
        .limit(10_001)
        .count();
}
```

---

## 9. `BufferedReader`: Workhorse untuk Text File Besar

Untuk production file processing, `BufferedReader` sering lebih eksplisit dan mudah dikontrol dibanding `Files.lines`.

### 9.1 Contoh line-by-line

```java
public void processCsv(Path path) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        long lineNumber = 0;

        while ((line = reader.readLine()) != null) {
            lineNumber++;
            processLine(lineNumber, line);
        }
    }
}
```

Kelebihan:

- lifecycle jelas,
- line number mudah dilacak,
- error handling lebih eksplisit,
- bisa stop kapan saja,
- bisa maintain state parser,
- cocok untuk observability.

### 9.2 Pattern dengan error context

```java
public void processRecords(Path path) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        long lineNumber = 0;

        while ((line = reader.readLine()) != null) {
            lineNumber++;
            try {
                processRecord(line);
            } catch (RuntimeException ex) {
                throw new IOException("Failed to process " + path + " at line " + lineNumber, ex);
            }
        }
    }
}
```

Dalam sistem batch, error tanpa line number sangat mahal untuk ditroubleshoot.

### 9.3 Batas panjang line

`BufferedReader.readLine()` dapat membaca line sangat panjang. Jika input tidak trusted, satu line bisa berukuran ratusan MB.

Untuk file tidak trusted, enforce limit:

```java
public void processWithLineLimit(Path path, int maxLineChars) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        long lineNumber = 0;

        while ((line = reader.readLine()) != null) {
            lineNumber++;
            if (line.length() > maxLineChars) {
                throw new IOException("Line too long at line " + lineNumber);
            }
            processLine(lineNumber, line);
        }
    }
}
```

Ini masih membaca line penuh dulu sebelum check. Untuk proteksi ekstrem, butuh reader custom yang membatasi panjang sebelum membangun String besar.

---

## 10. Raw Binary Streaming dengan `InputStream`

### 10.1 Contoh copy/hash sederhana

```java
public long countBytes(Path path) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;

    try (InputStream in = Files.newInputStream(path)) {
        int n;
        while ((n = in.read(buffer)) != -1) {
            total += n;
        }
    }

    return total;
}
```

### 10.2 Jangan asumsikan satu `read` mengisi buffer penuh

`InputStream.read(byte[])` boleh mengembalikan jumlah byte lebih kecil dari ukuran buffer.

Benar:

```java
int n;
while ((n = in.read(buffer)) != -1) {
    use(buffer, 0, n);
}
```

Salah:

```java
in.read(buffer);
use(buffer); // salah: belum tentu penuh
```

### 10.3 Buffer size

Ukuran buffer umum:

```text
8 KiB, 16 KiB, 64 KiB, 256 KiB
```

Tidak ada angka sakti. Pilih berdasarkan workload dan ukur.

Untuk banyak file kecil, overhead open/close dan metadata bisa lebih dominan daripada buffer size.

Untuk file besar sequential, buffer terlalu kecil bisa meningkatkan syscall overhead; buffer terlalu besar bisa meningkatkan memory footprint tanpa benefit besar.

### 10.4 `newInputStream` unbuffered

Secara tutorial Oracle, `Files.newInputStream` membuka file untuk membaca byte dan mengembalikan unbuffered input stream. Jadi bila kamu membaca kecil-kecil, bungkus dengan `BufferedInputStream` atau gunakan buffer manual.

```java
try (InputStream in = new BufferedInputStream(Files.newInputStream(path))) {
    // read
}
```

Namun jika kamu sudah membaca memakai `byte[] buffer` besar dalam loop, tambahan `BufferedInputStream` sering tidak wajib.

---

## 11. Bounded InputStream: Proteksi dari File Terlalu Besar

Size pre-check punya race condition. File bisa berubah setelah size dicek. Untuk input tidak trusted, enforce limit saat membaca.

### 11.1 Implementasi sederhana

```java
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

public final class BoundedInputStream extends FilterInputStream {
    private final long maxBytes;
    private long bytesRead;

    public BoundedInputStream(InputStream in, long maxBytes) {
        super(in);
        if (maxBytes < 0) {
            throw new IllegalArgumentException("maxBytes must be >= 0");
        }
        this.maxBytes = maxBytes;
    }

    @Override
    public int read() throws IOException {
        ensureCanRead(1);
        int result = super.read();
        if (result != -1) {
            bytesRead++;
        }
        return result;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (len == 0) {
            return 0;
        }
        ensureCanRead(1);

        long remaining = maxBytes - bytesRead;
        int allowed = (int) Math.min(len, remaining);

        int n = super.read(b, off, allowed);
        if (n != -1) {
            bytesRead += n;
        }
        return n;
    }

    private void ensureCanRead(int requested) throws IOException {
        if (bytesRead + requested > maxBytes) {
            throw new IOException("Input exceeds maximum allowed size: " + maxBytes + " bytes");
        }
    }
}
```

### 11.2 Penggunaan

```java
public byte[] readBounded(Path path, long maxBytes) throws IOException {
    try (InputStream raw = Files.newInputStream(path);
         InputStream bounded = new BoundedInputStream(raw, maxBytes);
         ByteArrayOutputStream out = new ByteArrayOutputStream()) {

        byte[] buffer = new byte[8192];
        int n;
        while ((n = bounded.read(buffer)) != -1) {
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }
}
```

Catatan: implementasi di atas masih sederhana dan tidak override semua metode seperti `skip`. Untuk library production, gunakan implementasi matang atau lengkapi behavior-nya.

---

## 12. Membaca dan Menghitung Hash Tanpa Memuat File ke Memory

Contoh production pattern:

```java
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class FileHashing {
    public static byte[] sha256(Path path) throws IOException {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }

        byte[] buffer = new byte[64 * 1024];

        try (InputStream in = Files.newInputStream(path);
             DigestInputStream digestIn = new DigestInputStream(in, digest)) {

            while (digestIn.read(buffer) != -1) {
                // reading updates digest
            }
        }

        return digest.digest();
    }
}
```

Mental model:

```text
file bytes -> InputStream -> DigestInputStream -> MessageDigest
```

Tidak perlu:

```java
byte[] all = Files.readAllBytes(path);
byte[] hash = digest.digest(all);
```

Untuk file besar, streaming digest jauh lebih aman.

---

## 13. Membaca File yang Bisa Berubah Saat Dibaca

Ini sering diabaikan.

File system tidak otomatis memberi snapshot konsisten untuk semua operasi baca.

Skenario:

```text
Reader membuka file laporan.csv
Writer lain menambahkan data
Reader membaca sebagian versi lama dan sebagian versi baru
```

Atau:

```text
Reader cek size = 10 MB
Writer truncate file menjadi 1 MB
Reader mulai baca
Hasil tidak sesuai ekspektasi
```

Atau:

```text
Reader buka path /data/current.json
Writer replace file dengan rename atomic
Reader yang sudah membuka handle mungkin tetap membaca file lama
Reader baru membaca file baru
```

### 13.1 Prinsip penting

```text
Path menunjuk nama.
Open handle menunjuk object file yang dibuka saat itu.
```

Setelah file dibuka, relasi antara path dan handle bisa berubah karena rename/delete/replace oleh proses lain.

### 13.2 Strategy berdasarkan kebutuhan

| Kebutuhan | Strategy |
|---|---|
| Baca best-effort log yang terus bertambah | tolerate append, track offset |
| Baca config konsisten | writer gunakan atomic replace; reader baca file hasil publish |
| Baca upload immutable | file harus ditulis ke staging lalu dipublish final setelah complete |
| Baca data batch besar | gunakan manifest/checksum/size yang diverifikasi |
| Baca file yang tidak boleh berubah | lock atau rename-claim, tergantung environment |

### 13.3 Jangan membaca file yang masih ditulis

Anti-pattern:

```text
producer menulis langsung ke /inbox/order.csv
consumer watch /inbox dan langsung membaca saat ENTRY_CREATE muncul
```

Masalah:

```text
consumer bisa membaca file sebelum producer selesai menulis
```

Pattern lebih baik:

```text
producer writes: /inbox/.order.csv.tmp
producer fsync/close
producer atomic rename to: /inbox/order.csv
consumer only processes *.csv, ignores *.tmp
```

Atau:

```text
producer writes payload + manifest
consumer processes only when manifest exists and checksum matches
```

---

## 14. Reading Consistency: Apa yang Bisa dan Tidak Bisa Dijamin

### 14.1 Yang umumnya bisa kamu kontrol

- kapan file dibuka,
- apakah reader menutup handle,
- apakah reader streaming atau load all,
- charset,
- max byte/line/record,
- checksum setelah read,
- metadata sebelum/sesudah read,
- apakah reader menerima perubahan selama proses.

### 14.2 Yang tidak boleh diasumsikan universal

- file tidak berubah selama dibaca,
- `Files.size` tetap valid selama read,
- directory listing adalah snapshot sempurna,
- network filesystem memberi semantics sama dengan local filesystem,
- watcher event berarti file sudah lengkap,
- timestamp cukup untuk mendeteksi perubahan,
- read success berarti data sesuai format bisnis.

### 14.3 Pattern verifikasi size sebelum dan sesudah

Untuk file yang seharusnya immutable:

```java
public void readWithSizeStabilityCheck(Path path) throws IOException {
    long before = Files.size(path);

    long processed = 0;
    byte[] buffer = new byte[64 * 1024];

    try (InputStream in = Files.newInputStream(path)) {
        int n;
        while ((n = in.read(buffer)) != -1) {
            processed += n;
            processBytes(buffer, 0, n);
        }
    }

    long after = Files.size(path);

    if (before != after || processed != after) {
        throw new IOException("File changed while reading: before=" + before
            + ", processed=" + processed + ", after=" + after);
    }
}
```

Ini bukan security guarantee sempurna, tapi useful sebagai operational guardrail.

Untuk high-integrity workflow, gunakan checksum/manifest/atomic publish.

---

## 15. Text Parsing: Line-by-Line Bukan Selalu Record-by-Record

Banyak format text tidak bisa diproses hanya dengan `readLine` naif.

Contoh CSV:

```csv
id,name,comment
1,Ayu,"hello
world"
```

Satu record CSV bisa melewati beberapa physical line.

Contoh JSON:

```json
{
  "items": [
    { "id": 1 },
    { "id": 2 }
  ]
}
```

Line bukan unit semantik JSON.

Contoh XML:

```xml
<root>
  <item id="1">...</item>
</root>
```

Line juga bukan unit semantik XML.

Prinsip:

```text
Line reading adalah transport-level convenience,
bukan selalu domain record boundary.
```

Gunakan parser streaming sesuai format:

- CSV parser yang benar,
- Jackson streaming API untuk JSON besar,
- StAX untuk XML besar,
- custom parser untuk fixed-width/line-delimited format.

---

## 16. BOM: Byte Order Mark dan Awal File yang Mengejutkan

Beberapa text file UTF-8 memiliki BOM:

```text
EF BB BF
```

Jika dibaca sebagai UTF-8 biasa, BOM bisa muncul sebagai karakter `\uFEFF` di awal string/line.

Contoh masalah:

```text
header pertama terbaca: "\uFEFFid"
bukan: "id"
```

Pattern defensif untuk file dari sumber eksternal:

```java
private static String removeUtf8BomIfPresent(String s) {
    if (!s.isEmpty() && s.charAt(0) == '\uFEFF') {
        return s.substring(1);
    }
    return s;
}
```

Saat memproses baris pertama:

```java
String line = reader.readLine();
if (line != null) {
    line = removeUtf8BomIfPresent(line);
}
```

Namun jangan asal strip karakter dari semua field. BOM hanya relevan di awal stream.

---

## 17. Exception Handling Saat Membaca File

### 17.1 Exception umum

| Exception | Arti umum |
|---|---|
| `NoSuchFileException` | path tidak ada saat operasi dilakukan |
| `AccessDeniedException` | permission ditolak / file locked / directory access issue |
| `FileSystemLoopException` | cycle saat traversal link |
| `MalformedInputException` | byte tidak valid untuk charset tertentu |
| `UnmappableCharacterException` | karakter tidak bisa dipetakan |
| `ClosedByInterruptException` | channel ditutup karena interrupt |
| `AsynchronousCloseException` | channel ditutup thread lain saat operasi berlangsung |
| `IOException` | kategori umum I/O failure |

### 17.2 Jangan swallow exception tanpa context

Buruk:

```java
catch (IOException e) {
    throw new RuntimeException(e);
}
```

Lebih baik:

```java
catch (IOException e) {
    throw new IOException("Failed to read input file: " + path, e);
}
```

Untuk record processing:

```java
throw new IOException("Failed to parse file " + path + " at line " + lineNumber, e);
```

### 17.3 Bedakan I/O error dan format error

Dalam file intake system, ini penting:

```text
I/O error       -> retry mungkin masuk akal
format error    -> retry biasanya tidak berguna tanpa input baru
permission error -> operational/config issue
file too large  -> validation rejection
charset error   -> contract mismatch
```

Contoh desain exception:

```java
class FileIntakeException extends Exception {
    enum Category {
        IO_TRANSIENT,
        IO_PERMANENT,
        VALIDATION,
        FORMAT,
        SECURITY
    }
}
```

Top 1% engineer tidak hanya menangkap exception; mereka mengklasifikasikan failure agar workflow bisa mengambil keputusan yang benar.

---

## 18. Charset Decoder Strict vs Lenient

Convenience API sering menggunakan decoding default behavior yang bisa mengganti karakter invalid, tergantung decoder path.

Untuk file contract yang strict, kamu mungkin ingin gagal saat input invalid.

Contoh explicit decoder:

```java
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CharsetDecoder;
import java.nio.file.Files;
import java.nio.file.Path;

public void readStrictUtf8(Path path) throws IOException {
    CharsetDecoder decoder = StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);

    try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(Files.newInputStream(path), decoder))) {

        String line;
        while ((line = reader.readLine()) != null) {
            process(line);
        }
    }
}
```

Gunakan strict decoding untuk:

- regulatory import,
- financial file,
- audit file,
- partner integration dengan kontrak formal,
- data migration.

Gunakan lenient decoding hanya jika memang requirement-nya menerima data rusak sebagian.

---

## 19. Membaca Resource dari Classpath Bukan Sama dengan Membaca File

Sering ada kebingungan:

```java
Path path = Paths.get("src/main/resources/config.json");
```

Ini mungkin jalan di IDE, tapi gagal saat aplikasi sudah packaged menjadi JAR.

Classpath resource bukan selalu file system path biasa.

Untuk resource:

```java
try (InputStream in = MyClass.class.getResourceAsStream("/config.json")) {
    if (in == null) {
        throw new FileNotFoundException("Resource not found: /config.json");
    }
    // read stream
}
```

Mental model:

```text
filesystem file: Path -> Files API
classpath resource: ClassLoader -> URL/InputStream
```

Jangan mencampur keduanya kecuali kamu benar-benar tahu resource berada di default filesystem.

---

## 20. Membaca File dengan `FileChannel`

Untuk basic sequential reading, `InputStream`/`BufferedReader` cukup.

`FileChannel` berguna untuk:

- random access,
- membaca dari offset tertentu,
- structured binary file,
- lock integration,
- memory-mapped file,
- transfer optimization,
- explicit position control.

Contoh membaca dari offset:

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer buffer = ByteBuffer.allocate(4096);
    long position = 1024;

    int n = channel.read(buffer, position);
    if (n > 0) {
        buffer.flip();
        while (buffer.hasRemaining()) {
            byte b = buffer.get();
            processByte(b);
        }
    }
}
```

Mental model `ByteBuffer`:

```text
write into buffer: position advances
flip: switch from writing mode to reading mode
read from buffer: position advances until limit
clear/compact: prepare for next read
```

Kita tidak mendalami buffer di sini karena sudah ada seri memory/buffer, tetapi untuk file random access, `FileChannel` akan muncul lagi di part berikutnya.

---

## 21. `Scanner`: Nyaman tetapi Sering Bukan Pilihan Production

`Scanner` mudah untuk demo:

```java
try (Scanner scanner = new Scanner(path, StandardCharsets.UTF_8.name())) {
    while (scanner.hasNextLine()) {
        String line = scanner.nextLine();
    }
}
```

Tetapi untuk production file processing, `Scanner` sering kurang ideal karena:

- parsing regex/token bisa lebih mahal,
- error handling tidak sejelas `BufferedReader`,
- line number manual tetap dibutuhkan,
- performance untuk file besar biasanya bukan yang terbaik,
- default delimiter/token behavior bisa mengejutkan.

Gunakan `Scanner` untuk simple CLI/tooling kecil, bukan ingestion engine besar.

---

## 22. Parallel Stream untuk File Lines: Hati-Hati

Jangan otomatis melakukan:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    lines.parallel().forEach(this::process);
}
```

Masalah:

- ordering bisa hilang,
- parser stateful bisa rusak,
- error handling makin sulit,
- I/O sequential belum tentu jadi lebih cepat,
- downstream database/API bisa overload,
- satu file besar belum tentu split optimal.

Kalau butuh parallelism, desain eksplisit:

```text
reader thread -> bounded queue -> worker pool -> result aggregator
```

Atau split file berdasarkan segment yang valid secara record boundary.

Untuk file line-delimited besar, parallelism aman hanya jika:

- record independent,
- ordering tidak penting atau bisa direkonstruksi,
- backpressure ada,
- error model jelas,
- output idempotent.

---

## 23. Membaca Banyak File: Jangan Lupa Total Memory dan Handle

Masalah bukan hanya satu file besar. Banyak file kecil juga bisa membunuh sistem.

Anti-pattern:

```java
List<byte[]> allFiles = files.stream()
    .map(path -> Files.readAllBytes(path))
    .collect(toList());
```

Risiko:

- memory akumulatif besar,
- open handle terlalu banyak jika stream tidak ditutup,
- disk seek/random I/O meningkat,
- GC pressure,
- throughput turun.

Pattern lebih baik:

```java
for (Path file : files) {
    processOneFile(file);
}
```

Jika parallel:

```text
bounded concurrency
not unbounded parallel stream
```

Contoh:

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
```

Bukan:

```java
files.parallelStream().forEach(this::processOneFile);
```

Karena common fork-join pool bukan kontrol eksplisit untuk I/O workload production.

---

## 24. Observability Saat Membaca File

Untuk file workflow serius, log dan metrics minimal:

```text
file path/id
file size
read start time
read duration
bytes read
records read
charset
reader type
failure category
line number / record number when failed
checksum if relevant
```

Contoh log event:

```json
{
  "event": "file_read_completed",
  "fileId": "2026-06-18-order-001",
  "path": "/data/inbox/order-001.csv",
  "bytesRead": 1048576,
  "recordsRead": 5000,
  "durationMs": 231,
  "charset": "UTF-8"
}
```

Jangan log full content file jika mengandung PII/secret.

Log path juga harus hati-hati jika path mengandung tenant/user-controlled filename.

---

## 25. Production Pattern: Read, Validate, Process, Commit

Untuk file ingestion, jangan gabungkan semua dalam satu method tanpa state.

Mental model:

```text
1. locate file
2. open file
3. read stream
4. validate structural contract
5. process records
6. verify footer/checksum/count if any
7. commit result
8. mark file done/error
```

Contoh skeleton:

```java
public final class FileIngestionService {
    public IngestionResult ingest(Path path) throws IOException {
        long startedAt = System.nanoTime();
        long bytes = 0;
        long records = 0;

        try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            String header = reader.readLine();
            validateHeader(header);

            String line;
            long lineNumber = 1;
            while ((line = reader.readLine()) != null) {
                lineNumber++;
                records++;
                bytes += line.length(); // approximate char count, not byte count
                processRecord(lineNumber, line);
            }

            return IngestionResult.success(records, elapsedMillis(startedAt));
        } catch (IOException e) {
            throw new IOException("Failed ingesting file " + path, e);
        } catch (RuntimeException e) {
            throw new IOException("Invalid file content in " + path, e);
        }
    }
}
```

Catatan:

```text
line.length() bukan jumlah byte aktual.
```

Jika byte count penting, hitung dari raw stream layer.

---

## 26. Common Anti-Patterns

### 26.1 Membaca upload besar dengan `readAllBytes`

```java
byte[] bytes = Files.readAllBytes(uploadPath);
```

Aman hanya jika ada ukuran maksimum yang ditegakkan.

### 26.2 Menggunakan default charset

```java
new String(bytes);
```

Buruk untuk Java 8–17 compatibility dan kontrak data.

Gunakan:

```java
new String(bytes, StandardCharsets.UTF_8);
```

### 26.3 Return `Stream<String>` dari method tanpa ownership jelas

```java
public Stream<String> readLines(Path path) throws IOException {
    return Files.lines(path);
}
```

Lebih baik konsumsi di dalam method atau dokumentasikan ownership dengan sangat jelas.

### 26.4 Menganggap watcher event berarti file lengkap

```text
ENTRY_CREATE -> langsung read
```

Bisa membaca file yang masih ditulis.

### 26.5 Split string besar untuk line processing

```java
String[] lines = Files.readString(path).split("\n");
```

Boros memory dan kurang robust.

### 26.6 Mengabaikan line number

```java
process(line);
```

Saat gagal, tidak tahu posisi.

Lebih baik:

```java
process(lineNumber, line);
```

---

## 27. File Reading Checklist

Sebelum memilih API, jawab pertanyaan berikut:

```text
[ ] Apakah file binary atau text?
[ ] Jika text, charset apa?
[ ] Apakah file bisa lebih besar dari memory aman?
[ ] Apakah ukuran maksimum ditegakkan?
[ ] Apakah file bisa berubah saat dibaca?
[ ] Apakah reader harus membaca snapshot konsisten?
[ ] Apakah file berasal dari user/partner tidak trusted?
[ ] Apakah perlu checksum/hash?
[ ] Apakah line adalah record boundary yang valid?
[ ] Apakah resource ditutup deterministik?
[ ] Apakah exception diberi context path/line/record?
[ ] Apakah ada observability bytes/records/duration?
[ ] Apakah code kompatibel Java 8 jika dibutuhkan?
```

---

## 28. Java 8–25 Compatibility Summary

| Concern | Java 8 | Java 11+ | Java 25 note |
|---|---|---|---|
| Build path | `Paths.get(...)` | `Path.of(...)` available | `Path.of` preferred in docs |
| Read all text | `new String(Files.readAllBytes(...), charset)` | `Files.readString(...)` | still convenience API |
| Lazy lines | `Files.lines(...)` | available | still must close |
| Buffered text | `Files.newBufferedReader(...)` | available | stable API |
| Binary streaming | `Files.newInputStream(...)` | available | stable API |
| Default charset | environment-dependent historically | UTF-8 from Java 18 by spec | still prefer explicit charset |

---

## 29. Mini Case Study: Config File Reader

Requirement:

```text
- Read JSON config file
- Must be UTF-8
- Max size 1 MiB
- Must fail if malformed UTF-8
- Must include path in error
- Java 8 compatible
```

Implementation:

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ConfigFileReader {
    private static final long MAX_CONFIG_BYTES = 1024 * 1024;

    public String readConfig(Path path) throws IOException {
        try {
            long size = Files.size(path);
            if (size > MAX_CONFIG_BYTES) {
                throw new IOException("Config file too large: " + size + " bytes");
            }
            byte[] bytes = Files.readAllBytes(path);
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IOException("Failed to read config file: " + path, e);
        }
    }
}
```

Kelemahan:

```text
size check bisa race jika file berubah
```

Untuk config lokal trusted yang dipublish atomic, acceptable.

Untuk hostile input, gunakan bounded stream dan strict decoder.

---

## 30. Mini Case Study: Large CSV Intake Reader

Requirement:

```text
- CSV besar
- UTF-8
- Tidak boleh load semua file
- Track line number
- Stop jika invalid lebih dari 100
- Quarantine file jika gagal
```

Skeleton:

```java
public final class CsvIntakeReader {
    private static final int MAX_ERRORS = 100;

    public CsvReadResult read(Path path) throws IOException {
        long records = 0;
        int errors = 0;

        try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            String line;
            long lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;

                try {
                    CsvRecord record = parseCsvRecord(lineNumber, line);
                    handle(record);
                    records++;
                } catch (InvalidRecordException e) {
                    errors++;
                    recordValidationError(path, lineNumber, e);

                    if (errors > MAX_ERRORS) {
                        throw new IOException("Too many invalid records in " + path);
                    }
                }
            }
        }

        return new CsvReadResult(records, errors);
    }
}
```

Catatan: parser CSV nyata tidak boleh hanya `split(",")` jika mendukung quoting, escape, dan multiline field.

---

## 31. Mental Model Akhir

Membaca file yang benar bukan soal API mana yang paling pendek.

Bentuk mental model yang harus melekat:

```text
File is bytes.
Text is bytes interpreted by charset.
Path is name, not content.
Open handle may outlive path state.
Small-file convenience APIs allocate whole content.
Lazy streams still own resources.
Line is not always record.
Read success is not business validity.
Size check is not a lock.
Filesystem behavior can change across OS/provider/runtime.
```

Top engineer membaca file dengan mempertimbangkan:

- correctness,
- memory,
- lifecycle,
- trust boundary,
- consistency,
- failure classification,
- observability,
- portability.

---

## 32. Ringkasan Praktis

Gunakan ini sebagai default rule:

```text
Small trusted text file:
  readString/readAllBytes + explicit UTF-8 + size guard

Large text file:
  BufferedReader/Files.lines + try-with-resources + line/record tracking

Binary file:
  InputStream/FileChannel + buffer + streaming processing

Untrusted file:
  bounded read + explicit validation + strict parser + no readAll unbounded

File expected immutable:
  atomic publish from writer + checksum/manifest + optional size stability check

Production workflow:
  log bytes/records/duration/failure category, never just "failed to read"
```

---

## 33. Latihan

### Latihan 1

Buat method Java 8-compatible:

```java
String readUtf8File(Path path, long maxBytes)
```

yang:

- menolak file lebih besar dari `maxBytes`,
- membaca sebagai UTF-8,
- memberi error message dengan path dan size.

### Latihan 2

Buat processor line-by-line yang:

- membaca file UTF-8,
- menghitung jumlah line,
- menghitung jumlah blank line,
- menghitung line terpanjang,
- tidak menyimpan seluruh file.

### Latihan 3

Buat binary hash reader yang:

- menghitung SHA-256,
- menggunakan buffer 64 KiB,
- tidak menggunakan `readAllBytes`.

### Latihan 4

Buat desain file intake:

```text
/inbox
/staging
/processing
/done
/error
```

Jelaskan kapan file boleh dibaca dan bagaimana menghindari membaca file yang masih ditulis.

---

## 34. Kesimpulan Part 05

Kita sudah membahas membaca file dari level API sampai workflow production.

Inti paling penting:

1. convenience API hanya aman untuk file kecil dan bounded,
2. text membutuhkan charset eksplisit,
3. lazy stream harus ditutup,
4. file bisa berubah saat dibaca,
5. line bukan selalu record,
6. production reader harus punya limit, context error, dan observability,
7. Java 8–25 compatibility harus dipertimbangkan sejak desain API.

Pada part berikutnya kita akan masuk ke operasi kebalikannya: **menulis file dengan benar**. Ini lebih rumit karena write success belum tentu durable, append belum tentu aman untuk semua skenario, dan replace file perlu atomic update pattern.

---

# Status Seri

Selesai:

- Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
- Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
- Part 02 — File Existence, Type, and Identity: `exists` Is Not a Lock
- Part 03 — File Creation Semantics: Atomic Create, Temp File, Directory Creation
- Part 04 — Open Options and File Handles: How Java Opens Files
- Part 05 — Reading Files Correctly: Small File, Large File, Streaming, Lazy Lines

Belum selesai. Berikutnya:

- Part 06 — Writing Files Correctly: Replace, Append, Flush, Durability

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 04 — Open Options and File Handles: How Java Opens Files](./learn-java-io-file-filesystem-storage-engineering-part-04-open-options-file-handles.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 06 — Writing Files Correctly: Replace, Append, Flush, Durability](./learn-java-io-file-filesystem-storage-engineering-part-06-writing-files-correctly.md)
