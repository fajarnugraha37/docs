# Part 002 — Classic `java.io`: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-002.md`  
> Status seri: **belum selesai** — ini adalah Part 002 dari 030.

---

## 1. Tujuan Pembelajaran

Pada bagian sebelumnya kita membangun mental model tentang byte, character, charset, dan boundary representasi data. Sekarang kita masuk ke API klasik Java I/O: `java.io`.

Target bagian ini bukan sekadar hafal nama class seperti `FileInputStream`, `BufferedInputStream`, atau `ObjectInputStream`. Targetnya adalah memahami **arsitektur berpikir** di balik classic Java I/O:

1. apa itu stream;
2. kenapa stream berbasis byte berbeda dari stream berbasis character;
3. kenapa Java memakai composition/decorator, bukan satu class besar;
4. bagaimana data mengalir dari source ke sink melalui beberapa wrapper;
5. siapa yang memiliki tanggung jawab menutup resource;
6. kenapa `flush`, `close`, `EOF`, dan `available()` sering disalahpahami;
7. bagaimana membuat code I/O yang robust terhadap partial read, exception, leak, dan corruption;
8. bagaimana membaca API modern yang masih memakai `InputStream`/`OutputStream` sebagai kontrak interoperabilitas.

Setelah menyelesaikan part ini, kamu harus bisa melihat kode seperti ini:

```java
try (InputStream in = new BufferedInputStream(
        new GZIPInputStream(
            new FileInputStream("data.gz")))) {
    // read bytes
}
```

bukan sebagai tumpukan class acak, tetapi sebagai **pipeline transformasi data** dengan ownership, buffering, decoding/decompression, dan failure semantics yang jelas.

---

## 2. Posisi `java.io` dalam Ekosistem Java I/O

`java.io` adalah fondasi klasik Java untuk operasi input dan output. Di dalamnya terdapat abstraction untuk:

- membaca byte;
- menulis byte;
- membaca character;
- menulis character;
- buffering;
- filtering;
- primitive binary I/O;
- object serialization;
- file descriptor;
- console-like stream;
- in-memory stream;
- pipe antar thread;
- resource lifecycle.

Walaupun Java modern punya `java.nio`, `java.nio.file`, `java.net.http`, dan framework besar seperti Netty/Spring, `java.io` tetap penting karena:

1. **Banyak API masih menggunakan stream sebagai kontrak umum.**  
   Contoh: upload/download HTTP, servlet body, object storage client, ZIP/GZIP, XML parser, JSON parser, process I/O.

2. **Stream adalah abstraction paling sederhana untuk sequential data.**  
   Banyak data memang datang sebagai urutan byte: file, socket, compressed payload, encrypted payload, HTTP body.

3. **Decorator pattern di `java.io` menjadi model dasar banyak library.**  
   Misalnya stream bisa dibungkus untuk buffering, decompression, digest, counting, throttling, encryption, atau logging.

4. **Kamu tidak bisa mendesain data transfer yang benar tanpa paham stream semantics.**  
   Bug seperti file corrupt, truncated response, memory leak, stuck thread, dan broken retry sering berasal dari pemahaman stream yang salah.

Mental model utama:

```text
Source/Sink fisik
    ↓
Raw byte stream
    ↓
Buffered stream
    ↓
Transform stream
    ↓
Typed reader/writer/parser
    ↓
Application logic
```

Contoh pipeline:

```text
File .gz di disk
    ↓ FileInputStream
Raw compressed bytes
    ↓ GZIPInputStream
Raw decompressed bytes
    ↓ InputStreamReader(UTF-8)
Characters
    ↓ BufferedReader
Lines
    ↓ Application parser
Records
```

---

## 3. Stream: Abstraction untuk Aliran Data Sekuensial

### 3.1 Apa Itu Stream?

Dalam konteks `java.io`, stream adalah abstraction untuk membaca atau menulis data secara **sekuensial**.

Artinya:

- data dibaca dari awal ke akhir;
- biasanya tidak random access;
- pembaca tidak selalu tahu total panjang data;
- data bisa datang pelan-pelan;
- data bisa habis;
- operasi bisa blocking;
- operasi bisa gagal di tengah jalan.

Stream cocok untuk:

- file sequential;
- socket TCP;
- HTTP body;
- compressed payload;
- encrypted payload;
- process input/output;
- pipe antar thread;
- generated data.

Stream kurang cocok jika kamu butuh:

- random access intensif;
- memory-mapped access;
- scatter/gather I/O;
- non-blocking selector;
- explicit buffer state machine;
- high-performance networking event loop.

Untuk kebutuhan itu, part berikutnya akan masuk ke NIO.

---

## 4. Empat Abstraction Utama `java.io`

Classic Java I/O memiliki empat abstraction utama:

```text
Byte input      : InputStream
Byte output     : OutputStream
Character input : Reader
Character output: Writer
```

### 4.1 Byte Stream

Byte stream bekerja dengan unit `byte` atau array byte.

```java
InputStream  // membaca byte
OutputStream // menulis byte
```

Cocok untuk:

- binary file;
- image;
- PDF;
- ZIP/GZIP;
- encrypted payload;
- network payload;
- protobuf/avro/binary protocol;
- data yang belum diketahui encoding-nya.

### 4.2 Character Stream

Character stream bekerja dengan unit `char` atau array character.

```java
Reader // membaca character
Writer // menulis character
```

Cocok untuk:

- text file;
- JSON text;
- XML text;
- CSV;
- log;
- template;
- config text.

Tetapi character stream selalu membutuhkan **charset boundary** jika sumber aslinya byte.

Contoh:

```java
try (Reader reader = new InputStreamReader(
        new FileInputStream("data.txt"), StandardCharsets.UTF_8)) {
    // read chars
}
```

Di sini:

```text
FileInputStream       -> byte
InputStreamReader     -> byte decoded menjadi character
Reader                -> character abstraction
```

---

## 5. `InputStream`: Kontrak Membaca Byte

`InputStream` adalah superclass abstrak untuk membaca byte.

Method penting:

```java
int read() throws IOException
int read(byte[] b) throws IOException
int read(byte[] b, int off, int len) throws IOException
byte[] readAllBytes() throws IOException
int readNBytes(byte[] b, int off, int len) throws IOException
long transferTo(OutputStream out) throws IOException
long skip(long n) throws IOException
int available() throws IOException
void close() throws IOException
```

### 5.1 Semantics `read()`

```java
int value = in.read();
```

Return value:

```text
0..255  -> satu byte berhasil dibaca
-1      -> EOF, stream habis
```

Kenapa return type-nya `int`, bukan `byte`?

Karena harus ada nilai khusus `-1` untuk EOF. Kalau return type `byte`, semua 256 kemungkinan byte sudah terpakai.

### 5.2 Semantics `read(byte[])`

```java
byte[] buffer = new byte[8192];
int n = in.read(buffer);
```

Return value:

```text
n > 0   -> jumlah byte aktual yang dibaca
-1      -> EOF
```

Hal penting:

> `read(buffer)` tidak dijamin mengisi buffer penuh.

Ia boleh mengembalikan 1 byte, 100 byte, 8192 byte, atau EOF tergantung source.

Kesalahan umum:

```java
byte[] buffer = new byte[8192];
in.read(buffer);
out.write(buffer); // BUG: menulis seluruh buffer, termasuk sisa lama/zero
```

Yang benar:

```java
byte[] buffer = new byte[8192];
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

Invariant penting:

```text
Jumlah byte valid setelah read adalah return value n, bukan ukuran array.
```

### 5.3 EOF Bukan Error

EOF berarti sumber data sudah habis. EOF bukan exception.

```java
while ((n = in.read(buffer)) != -1) {
    process(buffer, 0, n);
}
```

Namun EOF bisa menjadi error secara domain jika kamu mengharapkan panjang tertentu.

Contoh file format length-prefixed:

```text
Header bilang body length = 10 MB
Tetapi stream EOF setelah 7 MB
```

Secara stream, itu EOF normal. Secara protocol, itu data corruption/truncation.

Maka domain parser harus membedakan:

```text
EOF expected      -> normal selesai
EOF unexpected    -> truncated data
IOException       -> transport/resource failure
FormatException   -> content tidak valid
```

---

## 6. `OutputStream`: Kontrak Menulis Byte

`OutputStream` adalah superclass abstrak untuk menulis byte.

Method penting:

```java
void write(int b) throws IOException
void write(byte[] b) throws IOException
void write(byte[] b, int off, int len) throws IOException
void flush() throws IOException
void close() throws IOException
```

### 6.1 `write` Tidak Selalu Berarti Data Sudah Durable

Ketika kamu memanggil:

```java
out.write(data);
```

artinya data dikirim ke stream abstraction. Tetapi belum tentu:

- sudah keluar ke network;
- sudah diterima remote peer;
- sudah tertulis ke disk fisik;
- sudah aman dari crash;
- sudah terlihat oleh reader lain.

Layer bisa banyak:

```text
Application byte[]
    ↓ OutputStream
BufferedOutputStream buffer
    ↓ FileOutputStream
OS page cache
    ↓ disk controller cache
Physical storage
```

`write` hanya menjamin kontrak di layer `OutputStream`, bukan durability end-to-end.

### 6.2 `flush()`

`flush()` memaksa buffered data di layer tersebut dikirim ke layer bawah.

Contoh:

```java
BufferedOutputStream buffered = new BufferedOutputStream(fileOut);
buffered.write(data);
buffered.flush();
```

Artinya data dari buffer Java dikirim ke `FileOutputStream`.

Tetapi `flush()` bukan `fsync`.

```text
flush()      -> dorong data dari buffer Java ke layer bawah
FileChannel.force() / FileDescriptor.sync() -> minta OS sync ke storage
```

Kesalahan umum:

```text
flush dianggap pasti membuat file aman dari power loss.
```

Itu salah.

Untuk crash-safe file persistence, kita perlu pattern khusus yang akan dibahas di Part 014.

### 6.3 `close()` Biasanya Melakukan Flush

Banyak `OutputStream` melakukan flush saat `close()`. Tetapi jangan menjadikan ini alasan untuk lifecycle yang kabur.

Rule praktis:

```text
Jika kamu selesai menulis dan masih butuh stream tetap terbuka -> flush.
Jika kamu selesai total dan punya ownership -> close.
```

---

## 7. `Reader`: Kontrak Membaca Character

`Reader` mirip `InputStream`, tetapi unit-nya character.

Method penting:

```java
int read() throws IOException
int read(char[] cbuf) throws IOException
int read(char[] cbuf, int off, int len) throws IOException
long skip(long n) throws IOException
boolean ready() throws IOException
void close() throws IOException
```

Return value `read()`:

```text
0..65535 -> char value
-1       -> EOF
```

Tetapi hati-hati: Java `char` adalah UTF-16 code unit, bukan selalu satu Unicode character konseptual.

Karena Part 001 sudah membahas charset dan Unicode boundary, di sini cukup pegang invariant:

```text
Reader sudah berada setelah byte-to-character decoding boundary.
```

Maka jika kamu butuh byte asli, checksum byte, file signature, compression, encryption, atau binary protocol, jangan mulai dari `Reader`.

---

## 8. `Writer`: Kontrak Menulis Character

`Writer` menulis character.

Method penting:

```java
void write(int c) throws IOException
void write(char[] cbuf) throws IOException
void write(char[] cbuf, int off, int len) throws IOException
void write(String str) throws IOException
void flush() throws IOException
void close() throws IOException
```

Jika writer terhubung ke byte sink, harus ada charset encoder.

Contoh:

```java
try (Writer writer = new OutputStreamWriter(
        new FileOutputStream("data.txt"), StandardCharsets.UTF_8)) {
    writer.write("hello");
}
```

Pipeline:

```text
String/char
    ↓ OutputStreamWriter(UTF-8 encoder)
byte
    ↓ FileOutputStream
file
```

Rule penting:

```text
Writer bukan tempat menulis binary data.
OutputStream bukan tempat menulis text tanpa charset decision.
```

---

## 9. Class Concrete Penting dalam `java.io`

### 9.1 File Stream

```java
FileInputStream
FileOutputStream
```

Dipakai untuk membaca/menulis byte dari/ke file.

Contoh:

```java
try (InputStream in = new FileInputStream("input.bin");
     OutputStream out = new FileOutputStream("output.bin")) {

    byte[] buffer = new byte[8192];
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
    }
}
```

Catatan:

- `FileInputStream`/`FileOutputStream` adalah low-level.
- Untuk file modern, sering lebih baik pakai `Files.newInputStream`, `Files.newOutputStream`, `Files.copy`, atau `FileChannel`.
- Namun banyak library masih memakai `InputStream`/`OutputStream` sebagai abstraction.

### 9.2 In-Memory Byte Stream

```java
ByteArrayInputStream
ByteArrayOutputStream
```

Dipakai saat data berada di memory.

Contoh:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
out.write("hello".getBytes(StandardCharsets.UTF_8));
byte[] bytes = out.toByteArray();
```

Kapan berguna:

- testing;
- membuat payload kecil;
- serialisasi ke memory;
- buffering response kecil;
- adaptasi API yang butuh stream.

Bahaya:

```text
ByteArrayOutputStream menyimpan semua data di heap.
```

Untuk file besar atau response besar, jangan kumpulkan semua ke memory.

### 9.3 In-Memory Character Stream

```java
StringReader
StringWriter
CharArrayReader
CharArrayWriter
```

Dipakai untuk character data di memory.

Contoh:

```java
try (Reader reader = new StringReader("line1\nline2")) {
    char[] buf = new char[16];
    int n = reader.read(buf);
}
```

Kapan berguna:

- testing parser;
- template generation kecil;
- adaptasi API berbasis `Reader`/`Writer`.

### 9.4 Piped Stream

```java
PipedInputStream
PipedOutputStream
PipedReader
PipedWriter
```

Dipakai untuk menghubungkan output satu thread ke input thread lain.

Contoh konseptual:

```text
Producer thread -> PipedOutputStream -> PipedInputStream -> Consumer thread
```

Hati-hati:

- bisa deadlock jika producer dan consumer tidak dijalankan benar;
- buffer pipe terbatas;
- error handling antar thread sulit;
- modern code sering lebih jelas memakai queue, reactive stream, atau structured pipeline.

Piped stream bukan solusi umum untuk semua producer-consumer. Gunakan hanya jika kamu benar-benar perlu API stream di kedua sisi.

---

## 10. Decorator Pattern dalam `java.io`

Salah satu desain paling penting di `java.io` adalah decorator pattern.

Daripada membuat class kombinasi seperti:

```text
BufferedGzipEncryptedFileInputStream
```

Java menyediakan stream kecil yang bisa dibungkus:

```java
InputStream in = new BufferedInputStream(
    new GZIPInputStream(
        new FileInputStream("data.gz")
    )
);
```

Setiap layer punya tanggung jawab sendiri:

```text
FileInputStream       -> ambil byte dari file
GZIPInputStream       -> decompress byte
BufferedInputStream   -> kurangi read call ke layer bawah
Application           -> consume byte hasil akhir
```

### 10.1 Jenis Decorator

#### Buffering

```java
BufferedInputStream
BufferedOutputStream
BufferedReader
BufferedWriter
```

Tugas:

- mengurangi panggilan kecil-kecil ke layer bawah;
- meningkatkan throughput;
- menyediakan operasi line-based untuk reader.

#### Filtering

```java
FilterInputStream
FilterOutputStream
FilterReader
FilterWriter
```

Base class untuk stream wrapper.

#### Primitive Data

```java
DataInputStream
DataOutputStream
```

Tugas:

- membaca/menulis primitive Java dalam format binary tertentu.

#### Object Serialization

```java
ObjectInputStream
ObjectOutputStream
```

Tugas:

- membaca/menulis object graph Java.

Akan dibahas khusus di Part 016 dan 017.

#### Compression

```java
GZIPInputStream
GZIPOutputStream
ZipInputStream
ZipOutputStream
```

Tugas:

- transformasi compression/decompression.

Akan dibahas khusus di Part 018.

#### Checksum/Digest

Dari package terkait:

```java
CheckedInputStream
CheckedOutputStream
DigestInputStream
DigestOutputStream
```

Tugas:

- menghitung checksum/hash sambil data lewat.

### 10.2 Urutan Wrapper Itu Penting

Misalnya membaca file GZIP text UTF-8:

```java
try (BufferedReader reader = new BufferedReader(
        new InputStreamReader(
            new GZIPInputStream(
                new FileInputStream("data.txt.gz")
            ),
            StandardCharsets.UTF_8
        ))) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Pipeline:

```text
compressed bytes from file
    ↓ FileInputStream
compressed bytes
    ↓ GZIPInputStream
plain bytes
    ↓ InputStreamReader(UTF-8)
characters
    ↓ BufferedReader
lines
```

Urutan yang salah:

```java
// Konseptual salah: mencoba decode compressed bytes sebagai UTF-8 text
new GZIPInputStream(
    new ReaderInputStream(...)
)
```

Aturan umum:

```text
Compression/encryption/checksum biasanya bekerja di byte layer.
Charset decoding bekerja di boundary byte -> character.
Line processing bekerja di character layer.
Domain parsing bekerja setelah representation jelas.
```

---

## 11. Resource Lifecycle dan Ownership

I/O resource bukan object biasa. Banyak stream membungkus resource OS:

- file descriptor;
- socket descriptor;
- pipe;
- native handle;
- buffer native;
- process stream.

Jika tidak ditutup, dampaknya bisa serius:

- file descriptor leak;
- socket leak;
- file lock tidak lepas;
- data belum flush;
- temporary file tidak cleanup;
- connection pool habis;
- process stuck;
- memory pressure.

### 11.1 Rule Ownership

Pertanyaan paling penting:

```text
Siapa yang membuka resource?
Siapa yang bertanggung jawab menutup resource?
```

Rule default:

```text
Code yang membuka resource biasanya bertanggung jawab menutupnya.
```

Contoh:

```java
public byte[] readFile(Path path) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        return in.readAllBytes();
    }
}
```

Method ini membuka stream sendiri, maka ia menutupnya.

Berbeda dengan:

```java
public long copy(InputStream in, OutputStream out) throws IOException {
    return in.transferTo(out);
}
```

Method ini menerima stream dari caller. Biasanya ia **tidak menutup** stream, kecuali kontraknya jelas mengatakan demikian.

Kenapa?

Caller mungkin masih butuh stream itu, atau stream itu bagian dari lifecycle yang lebih besar.

### 11.2 API Contract Harus Jelas

Buruk:

```java
public void process(InputStream in) throws IOException {
    try (in) { // mengejutkan caller
        // process
    }
}
```

Lebih baik:

```java
public void process(InputStream in) throws IOException {
    // tidak close, caller owns stream
}
```

Atau jika memang ingin mengambil ownership, namai/kontrakkan dengan jelas:

```java
/**
 * Consumes and closes the given input stream.
 */
public void consumeAndClose(InputStream in) throws IOException {
    try (in) {
        // process
    }
}
```

Design invariant:

```text
Resource ownership harus eksplisit di boundary API.
```

### 11.3 Closing Wrapper Menutup Underlying Stream

Jika kamu punya:

```java
InputStream raw = new FileInputStream("data.gz");
InputStream gzip = new GZIPInputStream(raw);
InputStream buffered = new BufferedInputStream(gzip);

buffered.close();
```

Umumnya `close()` pada outermost stream akan menutup layer bawah.

Maka pattern yang umum:

```java
try (InputStream in = new BufferedInputStream(
        new GZIPInputStream(
            new FileInputStream("data.gz")))) {
    // use in
}
```

Cukup close outermost stream.

Jangan begini tanpa alasan:

```java
FileInputStream file = new FileInputStream("data.gz");
GZIPInputStream gzip = new GZIPInputStream(file);
BufferedInputStream buffered = new BufferedInputStream(gzip);

try (file; gzip; buffered) { // redundant, dan bisa membingungkan
    // use buffered
}
```

### 11.4 `try-with-resources`

Pattern modern:

```java
try (InputStream in = Files.newInputStream(path)) {
    // use in
}
```

Kelebihan:

- resource pasti ditutup saat keluar block;
- tetap close saat exception;
- suppressed exception disimpan;
- lebih aman dari `finally` manual.

Manual old style:

```java
InputStream in = null;
try {
    in = Files.newInputStream(path);
    // use in
} finally {
    if (in != null) {
        in.close();
    }
}
```

Lebih rentan verbose dan error.

---

## 12. Exception Semantics dalam I/O

Sebagian besar operasi I/O melempar `IOException`.

`IOException` bisa berarti banyak:

- file tidak ada;
- permission denied;
- disk full;
- socket reset;
- timeout;
- broken pipe;
- invalid path;
- stream closed;
- read interrupted;
- device error.

Jangan perlakukan semua `IOException` sama jika domain-nya penting.

Contoh lebih baik:

```java
try (InputStream in = Files.newInputStream(path)) {
    return parse(in);
} catch (NoSuchFileException e) {
    throw new ConfigException("Config file does not exist: " + path, e);
} catch (AccessDeniedException e) {
    throw new ConfigException("Config file is not readable: " + path, e);
} catch (EOFException e) {
    throw new ConfigException("Config file is truncated: " + path, e);
} catch (IOException e) {
    throw new ConfigException("Failed to read config file: " + path, e);
}
```

Walaupun `NoSuchFileException` dan `AccessDeniedException` berasal dari NIO.2, point-nya sama: klasifikasikan failure.

Untuk classic stream, exception sering lebih generik, sehingga kamu perlu memperkaya context.

Bad practice:

```java
catch (IOException e) {
    throw new RuntimeException(e);
}
```

Better:

```java
catch (IOException e) {
    throw new DataTransferException(
        "Failed to copy payload from %s to %s after %,d bytes"
            .formatted(sourceName, targetName, bytesCopied),
        e
    );
}
```

---

## 13. `available()` Misconception

Salah satu method paling sering disalahgunakan:

```java
int available = in.available();
```

Banyak developer mengira:

```text
available() = total byte tersisa di stream
```

Itu salah.

Makna praktisnya lebih dekat ke:

```text
jumlah byte yang bisa dibaca tanpa blocking, estimasi menurut stream tersebut
```

Pada `ByteArrayInputStream`, mungkin memang terlihat seperti sisa byte. Tetapi pada socket, compressed stream, network stream, dan banyak source lain, itu bukan ukuran total.

Anti-pattern:

```java
byte[] data = new byte[in.available()];
in.read(data);
```

Masalah:

- bisa 0 walaupun data akan datang nanti;
- bisa lebih kecil dari total;
- bisa menyebabkan truncated read;
- tidak portable antar stream implementation.

Gunakan:

```java
byte[] data = in.readAllBytes(); // hanya jika yakin data kecil
```

atau streaming loop:

```java
byte[] buffer = new byte[8192];
int n;
while ((n = in.read(buffer)) != -1) {
    process(buffer, 0, n);
}
```

---

## 14. `readAllBytes()` dan Bahaya Load-All

Modern Java menyediakan:

```java
byte[] bytes = in.readAllBytes();
```

Ini nyaman, tetapi berbahaya jika ukuran input tidak dibatasi.

Cocok untuk:

- config kecil;
- test fixture;
- small payload dengan limit jelas;
- in-memory transformation kecil.

Tidak cocok untuk:

- upload user;
- file besar;
- response HTTP besar;
- compressed input tidak dipercaya;
- data stream tanpa Content-Length;
- pipeline production yang menerima input eksternal.

Anti-pattern:

```java
public byte[] download(URL url) throws IOException {
    try (InputStream in = url.openStream()) {
        return in.readAllBytes(); // unlimited memory risk
    }
}
```

Lebih aman:

```java
public static byte[] readAtMost(InputStream in, int maxBytes) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
    byte[] buffer = new byte[8192];
    int total = 0;
    int n;

    while ((n = in.read(buffer)) != -1) {
        if (total + n > maxBytes) {
            throw new IOException("Input exceeds max allowed size: " + maxBytes);
        }
        out.write(buffer, 0, n);
        total += n;
    }

    return out.toByteArray();
}
```

Design rule:

```text
Jika data berasal dari luar sistem, selalu punya size limit.
```

---

## 15. Copy Stream yang Benar

### 15.1 Basic Copy Loop

```java
public static long copy(InputStream in, OutputStream out) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;
    int n;

    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
        total += n;
    }

    return total;
}
```

Invariant:

```text
Only bytes in [0, n) are valid after each read.
```

### 15.2 Dengan Limit

```java
public static long copyAtMost(
        InputStream in,
        OutputStream out,
        long maxBytes
) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;
    int n;

    while ((n = in.read(buffer)) != -1) {
        if (total + n > maxBytes) {
            throw new IOException("Input exceeds limit: " + maxBytes);
        }
        out.write(buffer, 0, n);
        total += n;
    }

    return total;
}
```

### 15.3 Dengan Progress Callback

```java
@FunctionalInterface
public interface ProgressListener {
    void onBytesCopied(long totalBytesCopied);
}

public static long copyWithProgress(
        InputStream in,
        OutputStream out,
        ProgressListener listener
) throws IOException {
    byte[] buffer = new byte[64 * 1024];
    long total = 0;
    int n;

    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
        total += n;
        listener.onBytesCopied(total);
    }

    return total;
}
```

Caveat:

- progress callback jangan blocking lama;
- jangan log setiap chunk kecil di production;
- jangan memanggil remote service setiap progress update.

### 15.4 `transferTo`

`InputStream` modern punya:

```java
long copied = in.transferTo(out);
```

Ini nyaman untuk copy sederhana.

Tetapi custom loop tetap berguna jika butuh:

- size limit;
- checksum;
- rate limit;
- progress;
- cancellation;
- metrics per chunk;
- transformation;
- custom error context.

---

## 16. Flush Strategy

Flush strategy tergantung sink.

### 16.1 File Output

Untuk file:

```java
out.write(data);
out.flush();
```

Mendorong data dari Java buffer, tetapi belum tentu durable.

Jika benar-benar butuh durability, gunakan API file/channel yang mendukung sync, dibahas lanjut di Part 009 dan Part 014.

### 16.2 Network Output

Untuk network:

- flush terlalu jarang bisa membuat peer menunggu;
- flush terlalu sering bisa menurunkan throughput;
- protocol harus menentukan kapan frame selesai.

Contoh:

```java
writer.write("COMMAND arg\n");
writer.flush(); // peer menunggu newline command ini
```

Untuk protocol line-based interaktif, flush setelah command mungkin perlu.

Untuk bulk transfer, flush per record bisa mahal.

### 16.3 BufferedWriter dan `newLine`

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write("hello");
    writer.newLine();
}
```

`newLine()` memakai line separator platform. Untuk protocol/network format, sering lebih baik eksplisit `\n` atau `\r\n` sesuai spesifikasi.

Rule:

```text
Untuk file lokal manusia: platform newline bisa diterima.
Untuk protocol/data format: newline harus eksplisit sesuai spec.
```

---

## 17. `PrintStream` dan `PrintWriter`: Nyaman tetapi Berbahaya

`System.out` dan `System.err` adalah `PrintStream`.

`PrintWriter` sering dipakai untuk text output.

Kelebihan:

- mudah menulis string;
- punya `print`, `println`, `printf`;
- nyaman untuk CLI/log sederhana.

Bahaya besar:

```text
PrintStream dan PrintWriter dapat menelan IOException dan hanya menyimpan error state.
```

Contoh:

```java
PrintWriter writer = new PrintWriter(outputStream);
writer.println("hello");
// IOException mungkin tidak dilempar langsung
if (writer.checkError()) {
    // baru tahu ada error
}
```

Untuk data transfer serius, jangan bergantung pada `PrintWriter` jika kamu perlu error propagation kuat.

Gunakan `BufferedWriter`/`OutputStreamWriter` dengan explicit exception handling.

Cocok:

- console output;
- simple report;
- template kecil.

Tidak ideal:

- financial file transfer;
- protocol implementation;
- audit export critical;
- data pipeline yang wajib fail-fast.

---

## 18. `Scanner`: Mudah tetapi Sering Tidak Cocok untuk High-Performance I/O

`Scanner` nyaman untuk parsing token:

```java
try (Scanner scanner = new Scanner(path, StandardCharsets.UTF_8)) {
    while (scanner.hasNext()) {
        String token = scanner.next();
    }
}
```

Kelebihan:

- mudah;
- mendukung delimiter;
- parsing primitive;
- cocok untuk input kecil/interaktif.

Kekurangan:

- relatif lambat;
- regex delimiter overhead;
- error handling parsing kadang kurang eksplisit;
- kurang cocok untuk file besar;
- tidak ideal untuk parser production.

Untuk file besar, gunakan:

```java
BufferedReader
```

atau parser khusus.

---

## 19. `DataInputStream` dan `DataOutputStream`

`DataInputStream`/`DataOutputStream` membaca/menulis primitive Java sebagai binary.

Contoh:

```java
try (DataOutputStream out = new DataOutputStream(
        new BufferedOutputStream(
            new FileOutputStream("record.bin")))) {
    out.writeInt(42);
    out.writeLong(123456789L);
    out.writeUTF("hello");
}
```

Membaca:

```java
try (DataInputStream in = new DataInputStream(
        new BufferedInputStream(
            new FileInputStream("record.bin")))) {
    int id = in.readInt();
    long value = in.readLong();
    String name = in.readUTF();
}
```

Kegunaan:

- format binary sederhana;
- internal file;
- testing;
- protocol kecil yang dikontrol sendiri.

Caveat:

- format harus didesain eksplisit;
- `writeUTF` memakai modified UTF-8, bukan sekadar UTF-8 biasa;
- endianness default Java big-endian;
- evolusi format harus dipikirkan;
- tidak cocok sebagai format publik tanpa spesifikasi.

Akan dibahas lebih dalam di Part 004.

---

## 20. `ObjectInputStream` dan `ObjectOutputStream`

Object stream memungkinkan Java object serialization.

Contoh:

```java
try (ObjectOutputStream out = new ObjectOutputStream(
        new FileOutputStream("object.bin"))) {
    out.writeObject(myObject);
}
```

Membaca:

```java
try (ObjectInputStream in = new ObjectInputStream(
        new FileInputStream("object.bin"))) {
    Object obj = in.readObject();
}
```

Namun ini **tidak boleh dianggap sebagai default data transfer format**.

Masalah:

- security risk saat deserialization untrusted data;
- tight coupling ke class Java;
- versioning kompleks;
- sulit interoperable;
- gadget chain vulnerability;
- object graph bisa besar;
- memory pressure;
- stream cache behavior.

Kita akan bahas secara khusus di Part 016 dan 017.

Untuk sekarang, pegang rule:

```text
Jangan deserialize data dari pihak tidak dipercaya menggunakan ObjectInputStream tanpa filter dan threat model.
```

---

## 21. `File` Lama vs NIO.2 `Path`

`java.io.File` adalah abstraction lama untuk path/file.

Contoh:

```java
File file = new File("data.txt");
boolean exists = file.exists();
```

Namun `File` memiliki keterbatasan:

- error sering hanya boolean, bukan exception detail;
- metadata kurang kaya;
- symlink handling terbatas;
- API copy/move/walk kurang modern;
- tidak sekuat `Path`/`Files`.

Modern code lebih disarankan memakai:

```java
Path path = Path.of("data.txt");
Files.exists(path);
Files.newInputStream(path);
Files.newBufferedReader(path, StandardCharsets.UTF_8);
```

Namun `File` masih muncul karena:

- library lama;
- API backward compatibility;
- `FileInputStream(File file)`;
- `FileOutputStream(File file)`;
- interop dengan legacy framework.

Rule praktis:

```text
Untuk kode baru, gunakan Path/Files.
Untuk interop legacy, convert seperlunya.
```

```java
File file = path.toFile();
Path path = file.toPath();
```

NIO.2 akan dibahas khusus mulai Part 011.

---

## 22. Blocking Behavior

Classic `java.io` pada umumnya blocking.

Artinya thread yang memanggil `read()` bisa menunggu sampai:

- data tersedia;
- EOF;
- timeout jika stream mendukung timeout;
- exception;
- stream ditutup dari thread lain;
- OS mengembalikan error.

Pada file lokal, blocking biasanya singkat. Pada network, bisa lama.

Contoh socket input:

```java
int n = socket.getInputStream().read(buffer);
```

Thread bisa menunggu jika peer belum mengirim data.

Implication:

- jangan blocking di event loop/UI thread;
- tetapkan timeout untuk network;
- pertimbangkan virtual thread untuk blocking I/O skala besar;
- jangan membuat thread pool kecil tertahan I/O tanpa kontrol.

Topik concurrency + I/O akan dibahas di Part 028.

---

## 23. Close Semantics dan Half-Closed Concept

Untuk file, `close()` berarti handle dilepas.

Untuk socket stream, close bisa memiliki semantics lebih kompleks karena ada dua arah:

```text
client output -> server input
server output -> client input
```

Menutup `Socket` biasanya menutup kedua arah.

Tetapi TCP mendukung half-close: satu sisi selesai menulis tetapi masih bisa membaca. Di Java socket ada method seperti `shutdownOutput()` dan `shutdownInput()`.

Kenapa ini relevan?

Beberapa protocol memakai pola:

```text
client sends request body
client shutdown output to signal end
server reads until EOF
server sends response
client still reads response
```

Namun banyak application protocol modern memakai framing/length/header, bukan mengandalkan half-close.

Rule:

```text
Jangan pakai EOF sebagai message boundary kecuali protocol memang mendesainnya begitu.
```

Untuk file, EOF natural. Untuk socket, EOF bisa berarti peer menutup koneksi, bukan sekadar satu message selesai.

---

## 24. Layering Example: Membaca GZIP JSON UTF-8

Misal kita punya file:

```text
events.json.gz
```

Isi sebenarnya:

```text
GZIP-compressed bytes of UTF-8 JSON text
```

Pipeline benar:

```java
try (InputStream file = new FileInputStream("events.json.gz");
     InputStream bufferedFile = new BufferedInputStream(file);
     InputStream gzip = new GZIPInputStream(bufferedFile);
     Reader decoder = new InputStreamReader(gzip, StandardCharsets.UTF_8);
     BufferedReader reader = new BufferedReader(decoder)) {

    String line;
    while ((line = reader.readLine()) != null) {
        processJsonLine(line);
    }
}
```

Bisa juga dibuat lebih ringkas:

```java
try (BufferedReader reader = new BufferedReader(
        new InputStreamReader(
            new GZIPInputStream(
                new BufferedInputStream(
                    new FileInputStream("events.json.gz"))),
            StandardCharsets.UTF_8))) {

    String line;
    while ((line = reader.readLine()) != null) {
        processJsonLine(line);
    }
}
```

Versi eksplisit lebih mudah diajarkan; versi nested lebih ringkas.

Layer:

```text
FileInputStream        : source raw compressed bytes
BufferedInputStream    : reduce file read overhead
GZIPInputStream        : compressed bytes -> plain bytes
InputStreamReader      : plain bytes -> characters via UTF-8
BufferedReader         : efficient char buffering + readLine
Application            : parse/process text records
```

Boundary jelas:

```text
Compression boundary terjadi sebelum charset decoding.
Charset boundary terjadi sebelum line processing.
Domain parsing terjadi setelah text valid.
```

---

## 25. Layering Example: Menulis CSV GZIP UTF-8

```java
try (OutputStream file = new FileOutputStream("report.csv.gz");
     OutputStream bufferedFile = new BufferedOutputStream(file);
     OutputStream gzip = new GZIPOutputStream(bufferedFile);
     Writer encoder = new OutputStreamWriter(gzip, StandardCharsets.UTF_8);
     BufferedWriter writer = new BufferedWriter(encoder)) {

    writer.write("id,name,status");
    writer.newLine();

    for (Record record : records) {
        writer.write(toCsvLine(record));
        writer.newLine();
    }
}
```

Pipeline:

```text
Application records
    ↓ CSV string
Characters
    ↓ OutputStreamWriter(UTF-8)
Plain bytes
    ↓ GZIPOutputStream
Compressed bytes
    ↓ BufferedOutputStream
FileOutputStream
File
```

Catatan penting:

- closing outermost `BufferedWriter` akan menutup encoder, gzip, buffered file, dan file output;
- `GZIPOutputStream` butuh `finish()`/`close()` agar trailer gzip ditulis;
- jika stream tidak ditutup, file gzip bisa corrupt/truncated;
- untuk file production critical, pattern atomic write lebih aman daripada langsung menulis target final.

---

## 26. Data Corruption Scenarios yang Sering Terjadi

### 26.1 Menulis Buffer Penuh, Bukan Byte Aktual

Bug:

```java
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer); // salah
}
```

Benar:

```java
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

### 26.2 Decode Terlalu Awal

Bug:

```java
Reader reader = new InputStreamReader(
    new FileInputStream("data.gz"),
    StandardCharsets.UTF_8
);
```

Jika file masih compressed, ini salah.

Benar:

```java
Reader reader = new InputStreamReader(
    new GZIPInputStream(new FileInputStream("data.gz")),
    StandardCharsets.UTF_8
);
```

### 26.3 Tidak Menutup Compression Stream

Bug:

```java
GZIPOutputStream gzip = new GZIPOutputStream(new FileOutputStream("x.gz"));
gzip.write(data);
// lupa close
```

Dampak:

- trailer tidak tertulis;
- compressed file bisa gagal dibaca;
- data terakhir tertahan buffer.

Benar:

```java
try (GZIPOutputStream gzip = new GZIPOutputStream(
        new FileOutputStream("x.gz"))) {
    gzip.write(data);
}
```

### 26.4 Menggunakan Default Charset

Bug:

```java
new FileReader("data.txt");
new FileWriter("out.txt");
```

Masalah:

- default charset bergantung environment;
- behavior bisa beda antara laptop, container, server;
- data transfer jadi tidak deterministic.

Lebih baik:

```java
Files.newBufferedReader(path, StandardCharsets.UTF_8);
Files.newBufferedWriter(path, StandardCharsets.UTF_8);
```

### 26.5 Menganggap `read()` Mengembalikan Satu Message

Pada socket:

```java
int n = in.read(buffer);
```

Itu hanya membaca byte yang tersedia, bukan satu message application.

Kalau protocol butuh message, kamu harus membuat framing.

Part 020 akan membahas ini detail.

---

## 27. Designing API dengan Stream

### 27.1 Jangan Paksa File Jika Sebenarnya Butuh Stream

Kurang fleksibel:

```java
public Report parse(File file) throws IOException
```

Lebih fleksibel:

```java
public Report parse(InputStream in) throws IOException
```

Atau untuk text:

```java
public Report parse(Reader reader) throws IOException
```

Keuntungan:

- bisa parse dari file;
- bisa parse dari HTTP body;
- bisa parse dari memory;
- bisa parse dari compressed stream;
- mudah dites.

Namun ownership harus jelas.

### 27.2 Pisahkan Resource Opening dari Processing

Bagus:

```java
public Report parse(Path path) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        return parse(in);
    }
}

public Report parse(InputStream in) throws IOException {
    // parse but do not close
}
```

Pattern ini memberi dua level API:

```text
Convenience API -> membuka dan menutup resource
Core API        -> memproses stream, tidak mengambil ownership
```

### 27.3 Jangan Return Stream yang Sudah Ditutup

Bug:

```java
public InputStream open() throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        return in; // sudah ditutup saat keluar method
    }
}
```

Benar:

```java
public InputStream open() throws IOException {
    return Files.newInputStream(path); // caller owns and must close
}
```

Atau lebih aman:

```java
public <T> T withInputStream(IOFunction<InputStream, T> action) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        return action.apply(in);
    }
}
```

---

## 28. Testing Code Berbasis Stream

Salah satu kelebihan abstraction stream adalah mudah dites tanpa file/network.

### 28.1 Test Parser dengan `ByteArrayInputStream`

```java
@Test
void parsesPayload() throws Exception {
    byte[] bytes = "id,name\n1,Alice\n".getBytes(StandardCharsets.UTF_8);

    Report report = parser.parse(new ByteArrayInputStream(bytes));

    assertEquals(1, report.records().size());
}
```

### 28.2 Test Writer dengan `ByteArrayOutputStream`

```java
@Test
void writesPayload() throws Exception {
    ByteArrayOutputStream out = new ByteArrayOutputStream();

    exporter.write(report, out);

    String text = out.toString(StandardCharsets.UTF_8);
    assertTrue(text.contains("Alice"));
}
```

### 28.3 Test Partial Read

`ByteArrayInputStream` terlalu ideal karena sering memenuhi read dengan mudah. Untuk menguji robustness, buat stream yang membatasi chunk.

```java
final class SlowInputStream extends FilterInputStream {
    private final int maxChunkSize;

    SlowInputStream(InputStream delegate, int maxChunkSize) {
        super(delegate);
        this.maxChunkSize = maxChunkSize;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        return super.read(b, off, Math.min(len, maxChunkSize));
    }
}
```

Test:

```java
InputStream slow = new SlowInputStream(
    new ByteArrayInputStream(payload),
    3
);

parser.parse(slow);
```

Ini membantu mendeteksi parser yang salah mengasumsikan satu `read()` mengembalikan semua data.

### 28.4 Test IOException di Tengah Stream

```java
final class FailingInputStream extends InputStream {
    private final int failAfter;
    private int count;

    FailingInputStream(int failAfter) {
        this.failAfter = failAfter;
    }

    @Override
    public int read() throws IOException {
        if (count++ >= failAfter) {
            throw new IOException("Injected failure");
        }
        return 'x';
    }
}
```

Gunakan untuk menguji cleanup dan error propagation.

---

## 29. Performance Notes

### 29.1 Jangan Baca Byte-by-Byte Tanpa Buffer

Buruk:

```java
int b;
while ((b = in.read()) != -1) {
    out.write(b);
}
```

Untuk stream yang tidak buffered, ini bisa sangat lambat.

Lebih baik:

```java
byte[] buffer = new byte[8192];
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

Atau bungkus:

```java
InputStream in = new BufferedInputStream(rawIn);
OutputStream out = new BufferedOutputStream(rawOut);
```

### 29.2 Buffer Size Bukan Magic

Default 8 KB sering cukup untuk banyak kasus, tetapi workload besar bisa mendapat manfaat dari 64 KB atau lebih.

Namun terlalu besar juga bisa buruk jika:

- banyak concurrent stream;
- memory terbatas;
- latency lebih penting dari throughput;
- data kecil-kecil.

Rule awal:

```text
Mulai dari 8 KB sampai 64 KB, ukur dengan workload nyata.
```

### 29.3 Avoid Excessive Layering

Layering bagus untuk clarity, tetapi redundant buffering bisa membingungkan.

Contoh:

```java
new BufferedInputStream(
    new BufferedInputStream(raw)
)
```

Biasanya tidak perlu.

Namun layering transform berbeda tetap wajar:

```java
new BufferedReader(
    new InputStreamReader(
        new GZIPInputStream(
            new BufferedInputStream(raw)),
        UTF_8))
```

### 29.4 `ByteArrayOutputStream` Growth

`ByteArrayOutputStream` menyimpan buffer yang membesar. Jika kamu tahu estimasi ukuran, bisa set initial capacity:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream(expectedSize);
```

Tapi jangan gunakan untuk data tidak terbatas.

---

## 30. Security Notes

### 30.1 Jangan Percaya Input Size

Stream eksternal bisa sangat besar atau tidak pernah selesai.

Mitigasi:

- max byte limit;
- timeout;
- rate limit;
- cancellation;
- decompression ratio limit;
- frame size limit.

### 30.2 Jangan Deserialize Untrusted Stream

`ObjectInputStream` terhadap input eksternal adalah red flag.

Mitigasi:

- hindari Java native serialization;
- gunakan allowlist filter;
- gunakan format data eksplisit;
- validasi schema;
- batasi ukuran object graph.

### 30.3 Jangan Log Raw Payload Sembarangan

Stream bisa berisi:

- token;
- password;
- PII;
- dokumen sensitif;
- binary data besar.

Logging harus:

- redacted;
- sampled;
- size-limited;
- metadata-oriented.

### 30.4 Jangan Menulis File Target Langsung untuk Data Tidak Terpercaya

Saat menerima upload:

- tulis ke temporary location;
- limit size;
- validate content;
- checksum;
- scan jika perlu;
- atomic move ke final location;
- permission aman.

---

## 31. Production Pattern: Stream Processing dengan Context dan Limit

Contoh utility yang lebih production-aware:

```java
public final class StreamTransfer {
    private static final int DEFAULT_BUFFER_SIZE = 64 * 1024;

    private StreamTransfer() {
    }

    public static TransferResult copyWithLimit(
            InputStream in,
            OutputStream out,
            long maxBytes
    ) throws IOException {
        if (maxBytes < 0) {
            throw new IllegalArgumentException("maxBytes must be >= 0");
        }

        byte[] buffer = new byte[DEFAULT_BUFFER_SIZE];
        long total = 0;
        int chunks = 0;

        int n;
        while ((n = in.read(buffer)) != -1) {
            if (total + n > maxBytes) {
                throw new IOException(
                    "Transfer exceeded maxBytes=" + maxBytes + ", copied=" + total
                );
            }

            out.write(buffer, 0, n);
            total += n;
            chunks++;
        }

        return new TransferResult(total, chunks);
    }

    public record TransferResult(long bytesCopied, int chunks) {
    }
}
```

Usage:

```java
Path source = Path.of("input.bin");
Path target = Path.of("output.bin");

try (InputStream in = new BufferedInputStream(Files.newInputStream(source));
     OutputStream out = new BufferedOutputStream(Files.newOutputStream(target))) {

    StreamTransfer.TransferResult result =
        StreamTransfer.copyWithLimit(in, out, 100 * 1024 * 1024);

    out.flush();
    System.out.println("Copied " + result.bytesCopied() + " bytes");
}
```

Kelebihan:

- tidak load all;
- punya limit;
- memakai buffer reusable per transfer;
- byte count eksplisit;
- ownership tetap di caller;
- mudah diberi metrics/checksum nanti.

---

## 32. Anti-Pattern Checklist

Hindari:

```text
[ ] Menggunakan available() sebagai ukuran total stream.
[ ] Mengabaikan return value read(byte[]).
[ ] Menulis seluruh buffer walaupun hanya sebagian valid.
[ ] Membaca file besar dengan readAllBytes tanpa limit.
[ ] Menggunakan default charset untuk data transfer.
[ ] Decode text sebelum decompression/decryption selesai.
[ ] Lupa close GZIPOutputStream/ObjectOutputStream.
[ ] Menutup stream milik caller tanpa kontrak jelas.
[ ] Return stream dari try-with-resources.
[ ] Swallow IOException.
[ ] Menggunakan PrintWriter untuk transfer critical tanpa checkError.
[ ] Menggunakan ObjectInputStream untuk data tidak dipercaya.
[ ] Flush dianggap sama dengan fsync.
[ ] Menganggap satu read dari socket sama dengan satu message.
[ ] Buffer terlalu kecil untuk bulk transfer.
[ ] Buffer terlalu besar untuk ribuan concurrent stream.
[ ] Logging raw payload sensitif.
```

---

## 33. Decision Matrix

### 33.1 Byte atau Character?

| Kebutuhan | Gunakan |
|---|---|
| Binary data | `InputStream` / `OutputStream` |
| Text dengan charset jelas | `Reader` / `Writer` |
| Text dari file modern | `Files.newBufferedReader/Writer(path, charset)` |
| Compression | byte stream dulu |
| Encryption | byte stream dulu |
| Checksum byte-exact | byte stream |
| Line-based text | `BufferedReader` |

### 33.2 Stream atau Load-All?

| Kondisi | Pilihan |
|---|---|
| Data kecil dan trusted | `readAllBytes` boleh |
| Data eksternal | streaming + limit |
| File besar | streaming/channel |
| Butuh progress | custom copy loop |
| Butuh checksum | streaming + digest/checksum |
| Butuh retry/resume | chunked transfer design |

### 33.3 Siapa Menutup Stream?

| Situasi | Ownership |
|---|---|
| Method membuka stream sendiri | method menutup |
| Method menerima stream dari caller | caller biasanya menutup |
| Method bernama `consumeAndClose` | method boleh menutup |
| Factory `openStream()` return stream | caller menutup |
| Wrapper stream dibuat lokal | close outermost wrapper |

---

## 34. Mental Model Final

Classic Java I/O adalah kombinasi dari empat ide besar:

### 34.1 Stream sebagai Sequential Data Flow

```text
Data datang sebagai urutan byte/character.
Kita membaca/menulis bertahap.
Tidak selalu tahu total ukuran.
Operasi bisa blocking dan gagal di tengah.
```

### 34.2 Layer sebagai Decorator

```text
Satu layer = satu tanggung jawab.
File layer membaca raw bytes.
Buffer layer mengurangi overhead.
Compression layer transform bytes.
Charset layer decode/encode text.
Parser layer memahami domain.
```

### 34.3 Boundary Harus Eksplisit

```text
byte -> character butuh charset
compressed -> plain butuh decompressor
encrypted -> plain butuh decryptor
stream -> message butuh framing
raw payload -> domain object butuh parser/validator
```

### 34.4 Lifecycle Harus Dimiliki

```text
Resource harus ditutup.
Ownership harus jelas.
flush bukan durability.
close outermost wrapper biasanya cukup.
Exception harus diberi context.
```

Kalau empat prinsip ini kuat, kamu tidak akan melihat `java.io` sebagai API lama yang membosankan. Kamu akan melihatnya sebagai fondasi transfer data yang masih relevan sampai hari ini.

---

## 35. Latihan

### Latihan 1 — Copy dengan Limit dan Checksum

Buat method:

```java
TransferResult copy(InputStream in, OutputStream out, long maxBytes)
```

Dengan fitur:

- streaming;
- max byte limit;
- SHA-256 checksum;
- total bytes;
- tidak menutup stream milik caller.

Pertanyaan:

- siapa yang harus flush?
- siapa yang harus close?
- apa yang terjadi jika input melebihi limit?
- apakah partial output harus dihapus?

### Latihan 2 — GZIP Text Reader

Buat method:

```java
Stream<String> readGzipLines(Path path, Charset charset)
```

Pikirkan:

- bagaimana lifecycle stream line ditutup?
- apakah return `Stream<String>` aman?
- siapa menutup file?
- apa alternatif API yang lebih aman?

### Latihan 3 — Parser yang Tahan Partial Read

Buat parser binary sederhana:

```text
4 byte length
N byte payload UTF-8
```

Lalu test dengan `SlowInputStream` yang hanya mengembalikan maksimal 2 byte per read.

Pastikan parser tidak mengasumsikan satu read langsung mendapatkan semua byte.

### Latihan 4 — API Ownership

Desain dua API:

```java
Report parse(Path path)
Report parse(InputStream in)
```

Tentukan:

- API mana yang membuka resource;
- API mana yang menutup resource;
- bagaimana dokumentasinya;
- bagaimana test-nya.

---

## 36. Ringkasan

Di Part 002 ini kita membahas fondasi classic `java.io`:

- `InputStream` dan `OutputStream` adalah abstraction byte stream.
- `Reader` dan `Writer` adalah abstraction character stream.
- Byte stream dan character stream tidak boleh dicampur tanpa charset boundary yang jelas.
- `java.io` sangat bergantung pada decorator pattern.
- Wrapper order penting: compression/encryption/checksum biasanya di byte layer; charset decoding di boundary byte-character; line processing di character layer.
- `read(byte[])` tidak menjamin buffer penuh.
- EOF bukan error, tetapi bisa menjadi error domain jika data terpotong.
- `flush()` bukan durability guarantee.
- `close()` outermost wrapper biasanya menutup layer bawah.
- Ownership resource harus eksplisit.
- `available()` bukan total ukuran stream.
- `readAllBytes()` hanya aman untuk data kecil dan bounded.
- `PrintWriter`/`PrintStream` nyaman tetapi bisa menelan error.
- Stream abstraction membuat code mudah dites dengan in-memory stream.
- Production I/O harus memikirkan limit, exception context, cleanup, security, dan failure mode.

Part berikutnya akan masuk ke buffering secara lebih dalam:

```text
Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-nio-networking-data-transfer-part-001.md">⬅️ Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-io-nio-networking-data-transfer-part-003.md">Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance ➡️</a>
</div>
