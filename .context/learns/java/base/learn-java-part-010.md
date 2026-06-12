# Learn Java — Part 010

# I/O, NIO, Networking, dan Data Transfer di Java 25

> Target pembaca: software engineer yang ingin memahami Java bukan hanya sebagai bahasa, tetapi sebagai runtime untuk membangun sistem yang membaca, menulis, mentransfer, dan memproses data secara benar, efisien, aman, dan observable.

---

## Metadata

- **Nama file:** `learn-java-part-010.md`
- **Bagian:** 10
- **Topik:** I/O, NIO, Networking, dan Data Transfer
- **Target versi:** Java 25
- **Prasyarat:**
  - Bagian 0 — Mental Model Java
  - Bagian 1 — Toolchain dan Build
  - Bagian 2 — Fondasi Bahasa
  - Bagian 3 — Object Model
  - Bagian 4 — Type System dan Generics
  - Bagian 6 — Functional Programming
  - Bagian 8 — Error Handling
  - Bagian 9 — Concurrency dan Java Memory Model

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model Besar: Apa Itu I/O?](#2-mental-model-besar-apa-itu-io)
3. [Layer I/O di Java](#3-layer-io-di-java)
4. [Classic I/O: `InputStream`, `OutputStream`, `Reader`, `Writer`](#4-classic-io-inputstream-outputstream-reader-writer)
5. [Buffering dan Resource Management](#5-buffering-dan-resource-management)
6. [Byte vs Character: Charset, Decoder, dan Encoder](#6-byte-vs-character-charsets-decoder-dan-encoder)
7. [NIO.2 File API: `Path`, `Files`, FileSystem](#7-nio2-file-api-path-files-filesystem)
8. [ByteBuffer Mental Model](#8-bytebuffer-mental-model)
9. [Channels](#9-channels)
10. [Selectors dan Non-blocking I/O](#10-selectors-dan-non-blocking-io)
11. [Memory-Mapped File](#11-memory-mapped-file)
12. [Large File Processing](#12-large-file-processing)
13. [Networking Classic: Socket, ServerSocket, TLS, DNS, Timeout](#13-networking-classic-socket-serversocket-tls-dns-timeout)
14. [HTTP Client Modern: `java.net.http`](#14-http-client-modern-javanethttp)
15. [Streaming HTTP Body, Backpressure, dan Flow](#15-streaming-http-body-backpressure-dan-flow)
16. [Serialization dan Data Format](#16-serialization-dan-data-format)
17. [Java Object Serialization: Kenapa Perlu Hati-hati](#17-java-object-serialization-kenapa-perlu-hati-hati)
18. [Schema Evolution: JSON, Protobuf, Avro, CBOR](#18-schema-evolution-json-protobuf-avro-cbor)
19. [Foreign Function & Memory API](#19-foreign-function--memory-api)
20. [I/O di Container, Cloud, dan Kubernetes](#20-io-di-container-cloud-dan-kubernetes)
21. [Observability untuk I/O dan Data Transfer](#21-observability-untuk-io-dan-data-transfer)
22. [Security dan Safety Checklist](#22-security-dan-safety-checklist)
23. [Design Decision Framework](#23-design-decision-framework)
24. [Production Failure Modes](#24-production-failure-modes)
25. [Mini Project: Large Evidence Transfer Engine](#25-mini-project-large-evidence-transfer-engine)
26. [Latihan Bertahap](#26-latihan-bertahap)
27. [Checklist Pemahaman](#27-checklist-pemahaman)
28. [Referensi Resmi](#28-referensi-resmi)

---

# 1. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan inti:

> Ketika Java membaca atau menulis data, apa sebenarnya yang terjadi dari level API sampai OS, dan bagaimana kita mendesain aliran data yang benar, efisien, aman, serta tahan failure?

Setelah menyelesaikan bagian ini, kamu seharusnya mampu:

1. membedakan byte stream, character stream, file API, channel, buffer, selector, dan HTTP body stream;
2. memilih API I/O yang tepat untuk file kecil, file besar, socket, HTTP, dan native memory;
3. memahami blocking, non-blocking, synchronous, asynchronous, buffered, unbuffered, heap buffer, direct buffer, dan mapped buffer;
4. memproses file besar tanpa membaca seluruh isi ke memory;
5. menghindari bug encoding, partial read, partial write, resource leak, timeout leak, connection leak, dan deserialization vulnerability;
6. mendesain data transfer dengan timeout, cancellation, retry, backpressure, idempotency, dan observability;
7. memahami kapan Java Object Serialization harus dihindari;
8. memahami dasar Foreign Function & Memory API di Java modern.

---

# 2. Mental Model Besar: Apa Itu I/O?

I/O adalah proses memindahkan data antara program dan dunia luar.

Dunia luar bisa berupa:

- file system;
- network socket;
- terminal;
- process lain;
- memory di luar heap;
- database driver;
- HTTP endpoint;
- object storage;
- message broker;
- native library;
- device.

Dalam Java, data transfer biasanya melewati beberapa layer:

```text
Application Logic
    ↓
Java API abstraction
    ↓
Buffer / Stream / Channel
    ↓
JVM runtime
    ↓
Native call / OS syscall
    ↓
Kernel buffer / device / network stack
    ↓
External resource
```

Kesalahan umum engineer pemula adalah mengira:

> `read()` berarti semua data langsung terbaca.

Padahal realitanya:

- `read()` bisa membaca sebagian data;
- `write()` bisa menulis sebagian data pada channel tertentu;
- operasi bisa blocking;
- operasi bisa timeout;
- operasi bisa gagal di tengah;
- data bisa sudah terkirim sebagian sebelum error;
- encoding bisa pecah di boundary chunk;
- file bisa berubah saat dibaca;
- network bisa disconnect setelah request terkirim tetapi sebelum response diterima;
- retry bisa menggandakan efek jika operasi tidak idempotent.

## 2.1 Mental model I/O yang benar

I/O bukan “ambil data”. I/O adalah **protokol pertukaran data dengan resource eksternal**.

Setiap I/O perlu dipikirkan dengan dimensi berikut:

| Dimensi | Pertanyaan |
|---|---|
| Boundary | Data datang dari mana dan pergi ke mana? |
| Format | Byte mentah, text, record, object, event, frame? |
| Size | Kecil, sedang, besar, tidak terbatas? |
| Blocking | Thread boleh menunggu atau tidak? |
| Timeout | Berapa lama operasi boleh menunggu? |
| Partiality | Apa yang terjadi jika hanya sebagian data terbaca/tertulis? |
| Encoding | Byte diterjemahkan jadi karakter dengan charset apa? |
| Memory | Apakah data harus ditampung semua atau bisa streaming? |
| Backpressure | Apa yang terjadi jika consumer lebih lambat dari producer? |
| Failure | Apa yang terjadi jika file/network/process mati di tengah? |
| Security | Apakah input bisa dipercaya? |
| Observability | Bagaimana mengukur byte count, latency, retry, error? |

## 2.2 I/O selalu berhubungan dengan failure

CPU computation biasanya deterministic jika input sama. I/O tidak.

Contoh:

```java
int result = a + b;
```

Operasi ini hampir selalu berhasil jika tidak overflow secara semantic.

Tetapi:

```java
byte[] data = Files.readAllBytes(path);
```

Bisa gagal karena:

- file tidak ada;
- permission denied;
- path adalah directory;
- file terlalu besar;
- disk penuh;
- filesystem error;
- symbolic link loop;
- encoding salah;
- file berubah saat dibaca;
- process lain mengunci file;
- OS limit tercapai;
- container volume belum mounted;
- network file system lambat;
- operasi terlalu lama.

Top-tier Java engineer tidak melihat I/O sebagai utility. Ia melihat I/O sebagai **unreliable boundary**.

---

# 3. Layer I/O di Java

Java memiliki beberapa keluarga API I/O.

## 3.1 Classic I/O — `java.io`

Keluarga ini berpusat pada:

- `InputStream`
- `OutputStream`
- `Reader`
- `Writer`
- `File`
- `RandomAccessFile`
- `ObjectInputStream`
- `ObjectOutputStream`

Mental model:

```text
Stream = aliran data sekuensial
```

Cocok untuk:

- baca/tulis sederhana;
- wrapper buffering;
- text processing sederhana;
- object serialization legacy;
- API lama yang masih expose stream.

## 3.2 NIO — `java.nio`

Keluarga ini berpusat pada:

- `Buffer`
- `ByteBuffer`
- `CharBuffer`
- `Channel`
- `FileChannel`
- `SocketChannel`
- `Selector`
- `CharsetDecoder`
- `CharsetEncoder`

Mental model:

```text
Channel = koneksi ke sumber/tujuan I/O
Buffer  = area transit data
Selector = multiplexing banyak channel non-blocking
```

Cocok untuk:

- file besar;
- direct buffer;
- memory-mapped file;
- non-blocking networking;
- high-throughput transfer;
- protocol engine;
- library/framework networking.

## 3.3 NIO.2 — `java.nio.file`

Keluarga ini berpusat pada:

- `Path`
- `Files`
- `FileSystem`
- `FileStore`
- `WatchService`
- file attributes
- symbolic link handling

Mental model:

```text
Path = representasi lokasi di file system
Files = operasi terhadap file/directory/path
FileSystem = provider filesystem
```

Cocok untuk:

- file management modern;
- path-safe file handling;
- recursive directory walking;
- metadata;
- atomic file operation;
- symbolic link control;
- filesystem abstraction.

## 3.4 HTTP Client — `java.net.http`

Keluarga ini berpusat pada:

- `HttpClient`
- `HttpRequest`
- `HttpResponse`
- `BodyPublisher`
- `BodyHandler`
- `BodySubscriber`
- `WebSocket`

Mental model:

```text
HttpClient  = reusable client + connection resources
HttpRequest = immutable request
HttpResponse = status + headers + body
BodyPublisher/Subscriber = streaming body bridge
```

Cocok untuk:

- HTTP/1.1 dan HTTP/2 client;
- synchronous request;
- asynchronous request dengan `CompletableFuture`;
- streaming upload/download;
- WebSocket.

## 3.5 Foreign Function & Memory API — `java.lang.foreign`

Keluarga ini berpusat pada:

- `MemorySegment`
- `Arena`
- `MemoryLayout`
- `ValueLayout`
- `Linker`
- `SymbolLookup`
- `FunctionDescriptor`

Mental model:

```text
MemorySegment = region memory dengan spatial dan temporal safety
Arena         = lifetime owner untuk memory segment
Linker        = bridge dari Java ke native function
```

Cocok untuk:

- native interop;
- off-heap memory;
- high-performance library;
- structured native data;
- menggantikan sebagian kebutuhan JNI/Unsafe.

---

# 4. Classic I/O: `InputStream`, `OutputStream`, `Reader`, `Writer`

Classic I/O masih sangat penting karena banyak API Java dan third-party library masih memakai stream.

## 4.1 Byte stream

Byte stream bekerja pada data mentah berupa byte.

Abstraksi utama:

```java
InputStream in;
OutputStream out;
```

`InputStream` digunakan untuk membaca byte.

`OutputStream` digunakan untuk menulis byte.

Contoh copy stream yang benar:

```java
static long copy(InputStream in, OutputStream out) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;

    while (true) {
        int n = in.read(buffer);
        if (n == -1) {
            break;
        }
        out.write(buffer, 0, n);
        total += n;
    }

    return total;
}
```

Hal penting:

- `read(buffer)` mengembalikan jumlah byte yang benar-benar terbaca;
- nilai `-1` berarti end-of-stream;
- return value bisa lebih kecil dari ukuran buffer;
- jangan abaikan nilai `n`;
- jangan menulis seluruh buffer jika hanya sebagian yang valid.

Bug klasik:

```java
// Salah
while (in.read(buffer) != -1) {
    out.write(buffer); // bisa menulis byte lama yang tersisa di buffer
}
```

Yang benar:

```java
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

## 4.2 `InputStream.read()` bisa blocking

Operasi read dari stream bisa menunggu sampai:

- data tersedia;
- end-of-stream terdeteksi;
- exception terjadi.

Artinya, `read()` bukan operasi murah dan bukan operasi deterministic.

Implikasi desain:

- jangan panggil blocking I/O di event loop;
- gunakan timeout untuk network;
- gunakan thread atau virtual thread untuk blocking workload;
- desain cancellation;
- jangan menahan lock saat blocking I/O.

Contoh buruk:

```java
synchronized void handle(Socket socket) throws IOException {
    byte[] data = socket.getInputStream().readAllBytes();
    // Lock ditahan selama operasi network blocking.
}
```

Masalah:

- thread lain yang butuh lock ikut tertahan;
- network lambat menyebabkan contention;
- deadlock operasional lebih mungkin.

## 4.3 `readAllBytes()` bukan default untuk production

`InputStream.readAllBytes()` nyaman, tetapi berbahaya untuk input besar atau tidak dipercaya.

Contoh:

```java
byte[] data = input.readAllBytes();
```

Pertanyaan yang harus dijawab:

- Apakah ukuran input dibatasi?
- Apakah input dari user?
- Apakah bisa ratusan MB atau GB?
- Apakah bisa stream tak berujung?
- Apakah memory cukup?

Untuk production, lebih aman:

```java
static long copyWithLimit(InputStream in, OutputStream out, long maxBytes) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;

    int n;
    while ((n = in.read(buffer)) != -1) {
        total += n;
        if (total > maxBytes) {
            throw new IOException("Input exceeds maximum allowed size: " + maxBytes);
        }
        out.write(buffer, 0, n);
    }

    return total;
}
```

## 4.4 Character stream

Character stream bekerja pada `char`, bukan byte.

Abstraksi utama:

```java
Reader reader;
Writer writer;
```

`Reader` membaca character.

`Writer` menulis character.

Karena file/network sebenarnya byte, character stream selalu melibatkan encoding/decoding.

Contoh:

```java
try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    char[] buffer = new char[4096];
    int n;
    while ((n = reader.read(buffer)) != -1) {
        // process chars [0, n)
    }
}
```

## 4.5 `InputStreamReader` dan `OutputStreamWriter`

`InputStreamReader` adalah bridge dari byte stream ke character stream.

```java
try (InputStream in = Files.newInputStream(path);
     Reader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
    // read characters
}
```

`OutputStreamWriter` adalah bridge dari character stream ke byte stream.

```java
try (OutputStream out = Files.newOutputStream(path);
     Writer writer = new OutputStreamWriter(out, StandardCharsets.UTF_8)) {
    writer.write("hello\n");
}
```

Rule penting:

> Jangan pernah decode bytes menjadi text tanpa charset eksplisit pada sistem yang butuh reproducibility.

Buruk:

```java
new FileReader(file); // bergantung default charset
```

Lebih baik:

```java
Files.newBufferedReader(path, StandardCharsets.UTF_8);
```

## 4.6 Reader bukan Unicode grapheme reader

`Reader` membaca `char`, yaitu UTF-16 code unit.

Ini bukan berarti setiap `char` adalah satu karakter manusia.

Contoh:

```java
String s = "😀";
System.out.println(s.length());      // 2
System.out.println(s.codePointCount(0, s.length())); // 1
```

Implikasi:

- jangan hitung panjang teks manusia dengan `String.length()`;
- jangan potong text arbitrarily di index char jika bisa ada surrogate pair;
- untuk Unicode-aware processing, gunakan code point atau library grapheme cluster bila perlu.

---

# 5. Buffering dan Resource Management

## 5.1 Kenapa buffering penting

Tanpa buffering, program bisa melakukan syscall kecil berkali-kali.

Contoh buruk:

```java
int b;
while ((b = in.read()) != -1) {
    out.write(b);
}
```

Ini membaca satu byte per operasi.

Lebih baik:

```java
byte[] buffer = new byte[8192];
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

Buffering mengurangi overhead:

- call method;
- boundary Java/native;
- syscall;
- disk/network interaction;
- context switching.

## 5.2 Buffered streams

Java menyediakan wrapper:

```java
BufferedInputStream
BufferedOutputStream
BufferedReader
BufferedWriter
```

Contoh:

```java
try (InputStream in = new BufferedInputStream(Files.newInputStream(source));
     OutputStream out = new BufferedOutputStream(Files.newOutputStream(target))) {
    in.transferTo(out);
}
```

`transferTo` nyaman, tetapi tetap pikirkan:

- apakah input bounded?
- apakah output bisa lambat?
- apakah perlu progress metrics?
- apakah perlu cancellation?
- apakah perlu checksum?
- apakah perlu limit?

## 5.3 Flush vs close

`flush()` memaksa buffered data dikirim ke tujuan stream.

`close()` biasanya melakukan flush lalu release resource.

Contoh:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    writer.write("hello");
} // close otomatis flush
```

Jangan mengandalkan flush untuk durability disk secara penuh. Flush Java buffer bukan sama dengan fsync storage.

Untuk durability yang lebih kuat, gunakan API yang sesuai, misalnya `FileChannel.force(...)`.

## 5.4 Try-with-resources

Semua resource I/O harus punya owner lifetime jelas.

Buruk:

```java
InputStream in = Files.newInputStream(path);
process(in);
// Lupa close.
```

Benar:

```java
try (InputStream in = Files.newInputStream(path)) {
    process(in);
}
```

Rule:

> Siapa yang membuka resource, dia yang bertanggung jawab menutupnya, kecuali kontrak API menyatakan ownership dipindahkan.

Contoh API ownership jelas:

```java
// Method ini tidak menutup stream karena caller pemilik stream.
static long countBytes(InputStream in) throws IOException {
    long count = 0;
    byte[] buffer = new byte[8192];
    int n;
    while ((n = in.read(buffer)) != -1) {
        count += n;
    }
    return count;
}
```

Contoh API yang membuka sendiri:

```java
// Method ini membuka dan menutup resource sendiri.
static long countFileBytes(Path path) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        return countBytes(in);
    }
}
```

---

# 6. Byte vs Character: Charset, Decoder, dan Encoder

## 6.1 Byte bukan text

File text sebenarnya byte yang ditafsirkan dengan charset.

```text
bytes + charset = characters
characters + charset = bytes
```

Contoh charset:

- UTF-8
- UTF-16
- ISO-8859-1
- Windows-1252
- US-ASCII

Jika charset salah, hasil bisa:

- mojibake;
- replacement character `�`;
- exception;
- silent data corruption;
- signature/checksum mismatch;
- bug sorting/searching.

## 6.2 Gunakan charset eksplisit

Buruk:

```java
String content = Files.readString(path); // default charset tergantung versi/API/konteks
```

Lebih baik:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Buruk:

```java
byte[] bytes = text.getBytes();
```

Lebih baik:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
```

## 6.3 Decoder stateful

UTF-8 bisa memiliki karakter multi-byte. Jika file dibaca per chunk, satu karakter bisa terpotong di boundary buffer.

Contoh mental model:

```text
chunk 1: E2 82
chunk 2: AC
```

Byte tersebut bersama-sama bisa membentuk karakter `€`.

Jika setiap chunk langsung diubah menjadi `String` terpisah tanpa decoder stateful, data bisa rusak.

Buruk:

```java
byte[] buffer = new byte[3];
int n;
while ((n = in.read(buffer)) != -1) {
    String s = new String(buffer, 0, n, StandardCharsets.UTF_8);
    process(s);
}
```

Ini bisa rusak jika UTF-8 sequence terpotong.

Untuk text besar, gunakan `Reader`, `BufferedReader`, atau `CharsetDecoder` secara benar.

## 6.4 `CharsetDecoder`

`CharsetDecoder` memberi kontrol terhadap malformed input dan unmappable character.

Contoh:

```java
CharsetDecoder decoder = StandardCharsets.UTF_8
        .newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT);
```

Pilihan error action:

- `REPORT` — lempar error;
- `REPLACE` — ganti dengan replacement;
- `IGNORE` — abaikan.

Untuk regulatory/audit/evidence file, biasanya `REPORT` lebih defensible karena silent replacement bisa merusak evidence.

## 6.5 Line-based reading

`BufferedReader.readLine()` nyaman, tetapi:

- menghilangkan line terminator;
- line sangat panjang bisa membuat memory besar;
- tidak cocok untuk untrusted data tanpa line length limit;
- tidak cocok untuk binary protocol.

Contoh aman dengan limit kasar:

```java
static void readLinesWithLimit(Path path, Charset charset, int maxLineLength) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, charset)) {
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.length() > maxLineLength) {
                throw new IOException("Line too long");
            }
            processLine(line);
        }
    }
}
```

Namun ini masih membuat satu `String` per line. Jika line bisa sangat besar, gunakan tokenizer streaming.

---

# 7. NIO.2 File API: `Path`, `Files`, FileSystem

## 7.1 `Path` bukan `String`

`Path` adalah representasi lokasi file/directory dalam file system.

Buruk:

```java
String file = baseDir + "/" + userInput;
```

Lebih baik:

```java
Path file = baseDir.resolve(userInput).normalize();
```

Tetapi `normalize()` saja tidak cukup untuk security path traversal.

Contoh aman konseptual:

```java
static Path safeResolve(Path baseDir, String userInput) throws IOException {
    Path base = baseDir.toRealPath();
    Path resolved = base.resolve(userInput).normalize();

    if (!resolved.startsWith(base)) {
        throw new SecurityException("Path traversal attempt");
    }

    return resolved;
}
```

Catatan:

- `toRealPath()` mengakses filesystem;
- symbolic link bisa mengubah makna path;
- security path handling perlu mempertimbangkan symlink race;
- untuk upload/download production, gunakan storage abstraction yang jelas.

## 7.2 `Files`

`Files` menyediakan static methods untuk operasi file/directory.

Contoh umum:

```java
Files.exists(path);
Files.isRegularFile(path);
Files.size(path);
Files.newInputStream(path);
Files.newOutputStream(path);
Files.newBufferedReader(path, StandardCharsets.UTF_8);
Files.readString(path, StandardCharsets.UTF_8);
Files.writeString(path, text, StandardCharsets.UTF_8);
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
Files.delete(path);
Files.createDirectories(dir);
```

## 7.3 `Files.exists` race condition

Buruk:

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Antara check dan delete, file bisa berubah.

Lebih baik:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException ignored) {
    // already absent
}
```

Prinsip:

> Jangan mendesain file operation seolah-olah filesystem static. File system adalah shared mutable state.

## 7.4 Atomic move

Pola umum untuk menulis file secara aman:

1. tulis ke temporary file di directory yang sama;
2. flush/force jika durability penting;
3. rename/move secara atomic ke nama final.

Contoh:

```java
static void writeAtomically(Path target, byte[] data) throws IOException {
    Path dir = target.toAbsolutePath().getParent();
    Path temp = Files.createTempFile(dir, target.getFileName().toString(), ".tmp");

    try {
        Files.write(temp, data);
        Files.move(temp, target,
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE);
    } catch (IOException | RuntimeException e) {
        try {
            Files.deleteIfExists(temp);
        } catch (IOException cleanupFailure) {
            e.addSuppressed(cleanupFailure);
        }
        throw e;
    }
}
```

Kenapa same directory?

- atomic rename biasanya hanya dijamin dalam filesystem yang sama;
- move lintas filesystem bisa menjadi copy+delete;
- permission dan ownership lebih predictable.

## 7.5 Directory walking

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(Files::isRegularFile)
         .forEach(System.out::println);
}
```

Penting:

- `Files.walk` menghasilkan stream yang harus ditutup;
- traversal bisa mahal;
- symbolic link perlu policy;
- permission error perlu dipikirkan;
- traversal besar perlu backpressure/parallelism hati-hati.

## 7.6 `DirectoryStream`

Untuk directory besar, `DirectoryStream` bisa lebih eksplisit dan streaming.

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
    for (Path entry : stream) {
        process(entry);
    }
}
```

## 7.7 WatchService

`WatchService` bisa memonitor perubahan directory.

Cocok untuk:

- local file ingestion;
- config reload;
- development tools.

Tetapi hati-hati:

- event bisa coalesced;
- event bisa hilang jika overflow;
- network filesystem behavior berbeda;
- jangan jadikan satu-satunya sumber kebenaran untuk critical processing;
- biasanya tetap butuh periodic reconciliation scan.

---

# 8. ByteBuffer Mental Model

`ByteBuffer` adalah inti NIO.

## 8.1 State utama ByteBuffer

`ByteBuffer` punya:

- `capacity`
- `position`
- `limit`
- `mark`

Mental model:

```text
capacity = ukuran maksimum buffer
position = index operasi berikutnya
limit    = batas operasi saat ini
```

## 8.2 Write mode vs read mode

Saat buffer baru dibuat:

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);
```

State konseptual:

```text
position = 0
limit    = capacity
```

Ini cocok untuk menulis data ke buffer.

Setelah channel membaca data ke buffer:

```java
channel.read(buffer);
```

Buffer berisi data dari index `0` sampai `position`.

Agar bisa dibaca dari buffer, panggil:

```java
buffer.flip();
```

`flip()` mengubah:

```text
limit = position lama
position = 0
```

Setelah data dikonsumsi, panggil:

```java
buffer.clear();
```

`clear()` bukan menghapus isi memory. Ia mengubah state agar buffer siap ditulis lagi:

```text
position = 0
limit = capacity
```

## 8.3 Pola read channel yang benar

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer buffer = ByteBuffer.allocate(8192);

    while (channel.read(buffer) != -1) {
        buffer.flip();

        while (buffer.hasRemaining()) {
            byte b = buffer.get();
            processByte(b);
        }

        buffer.clear();
    }
}
```

## 8.4 `compact()`

`compact()` digunakan jika masih ada data belum dibaca, tetapi kita ingin membaca tambahan data ke buffer yang sama.

Pola ini penting untuk protocol parsing.

```java
buffer.flip();
parseAvailableFrames(buffer);
buffer.compact(); // sisa data dipindahkan ke depan, siap menerima data baru
```

Contoh scenario:

```text
Buffer berisi:
[full frame][half frame]

Parser memproses full frame.
Half frame harus disimpan sampai read berikutnya.
```

Jika pakai `clear()`, half frame hilang.

## 8.5 Heap buffer vs direct buffer

Heap buffer:

```java
ByteBuffer.allocate(size);
```

Direct buffer:

```java
ByteBuffer.allocateDirect(size);
```

Heap buffer:

- backed by Java heap array;
- mudah diakses oleh Java;
- dikelola GC;
- bagus untuk logic biasa.

Direct buffer:

- off-heap;
- lebih dekat ke native I/O;
- bisa mengurangi copy pada operasi tertentu;
- alokasi/dealokasi lebih mahal;
- perlu perhatian terhadap native memory;
- cocok untuk long-lived reusable buffers pada I/O berat.

Rule praktis:

> Jangan memakai direct buffer hanya karena terdengar cepat. Ukur. Gunakan jika workload I/O dan profiling menunjukkan manfaat.

## 8.6 Byte order

Default `ByteBuffer` adalah big-endian.

```java
buffer.order(ByteOrder.LITTLE_ENDIAN);
```

Penting untuk:

- binary protocol;
- file format;
- interop native;
- network protocol;
- memory-mapped binary data.

---

# 9. Channels

Channel adalah koneksi ke entitas yang bisa melakukan I/O.

Contoh:

- `FileChannel`
- `SocketChannel`
- `ServerSocketChannel`
- `DatagramChannel`
- `AsynchronousFileChannel`
- `AsynchronousSocketChannel`

## 9.1 Stream vs Channel

| Aspek | Stream | Channel |
|---|---|---|
| Orientasi | byte sequence | buffer-oriented |
| API | `read(byte[])` | `read(ByteBuffer)` |
| Direction | biasanya input/output terpisah | bisa bidirectional tergantung channel |
| Non-blocking | tidak umum | didukung oleh selectable channel |
| File position | terbatas | `FileChannel` mendukung position |
| Transfer | manual copy | `transferTo`, `transferFrom` |

## 9.2 FileChannel

Membaca file:

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer buffer = ByteBuffer.allocate(8192);
    while (channel.read(buffer) != -1) {
        buffer.flip();
        process(buffer);
        buffer.clear();
    }
}
```

Menulis file:

```java
try (FileChannel channel = FileChannel.open(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.TRUNCATE_EXISTING)) {

    ByteBuffer buffer = StandardCharsets.UTF_8.encode("hello\n");
    while (buffer.hasRemaining()) {
        channel.write(buffer);
    }
}
```

Penting:

- `write(buffer)` tidak selalu menulis semua bytes;
- loop sampai `buffer.hasRemaining()` false;
- untuk file blocking biasanya sering selesai, tetapi kontrak tetap partial.

## 9.3 Positional read/write

```java
channel.read(buffer, position);
channel.write(buffer, position);
```

Berguna untuk:

- random access file;
- parallel file processing;
- index file;
- binary storage;
- resumable download.

Hati-hati:

- parallel write perlu segment ownership jelas;
- jangan overlap range tanpa coordination;
- filesystem tetap bottleneck.

## 9.4 `transferTo` dan `transferFrom`

```java
try (FileChannel source = FileChannel.open(src, StandardOpenOption.READ);
     FileChannel target = FileChannel.open(dst,
             StandardOpenOption.CREATE,
             StandardOpenOption.WRITE,
             StandardOpenOption.TRUNCATE_EXISTING)) {

    long size = source.size();
    long position = 0;

    while (position < size) {
        long transferred = source.transferTo(position, size - position, target);
        if (transferred <= 0) {
            throw new IOException("Unable to transfer file");
        }
        position += transferred;
    }
}
```

`transferTo` bisa memungkinkan optimisasi OS-level pada platform tertentu, tetapi:

- tetap bisa partial transfer;
- behavior bisa berbeda antar OS/filesystem;
- jangan anggap satu call selalu selesai;
- tetap ukur.

## 9.5 `force()`

```java
channel.force(true);
```

Meminta perubahan dipaksa ke storage device.

Trade-off:

- meningkatkan durability;
- bisa mahal;
- bisa menurunkan throughput drastis;
- penting untuk file log, ledger, metadata critical.

---

# 10. Selectors dan Non-blocking I/O

Selector memungkinkan satu thread memonitor banyak channel non-blocking.

Mental model:

```text
1 thread
  ↓ select()
N socket channels
  ↓ readiness events
read/write/connect/accept
```

## 10.1 Blocking vs non-blocking

Blocking socket:

```text
thread menunggu sampai data tersedia
```

Non-blocking socket:

```text
read bisa langsung return 0 jika belum ada data
selector memberi tahu kapan channel siap
```

## 10.2 Kenapa selector ada

Sebelum virtual threads, pattern scalable networking Java sering memakai:

- few event loop threads;
- non-blocking socket channel;
- selector;
- state machine per connection;
- buffer per connection;
- protocol parser.

Ini menghindari one-platform-thread-per-connection.

Dengan virtual threads, banyak use case blocking I/O menjadi lebih sederhana lagi. Tetapi selector tetap penting untuk framework dan low-level networking.

## 10.3 Basic selector skeleton

```java
try (Selector selector = Selector.open();
     ServerSocketChannel server = ServerSocketChannel.open()) {

    server.bind(new InetSocketAddress(8080));
    server.configureBlocking(false);
    server.register(selector, SelectionKey.OP_ACCEPT);

    while (true) {
        selector.select();

        Iterator<SelectionKey> iterator = selector.selectedKeys().iterator();
        while (iterator.hasNext()) {
            SelectionKey key = iterator.next();
            iterator.remove();

            if (!key.isValid()) {
                continue;
            }

            if (key.isAcceptable()) {
                handleAccept(selector, server);
            } else if (key.isReadable()) {
                handleRead(key);
            } else if (key.isWritable()) {
                handleWrite(key);
            }
        }
    }
}
```

## 10.4 Selector failure modes

- lupa `iterator.remove()` sehingga event diproses ulang;
- blocking operation di event loop;
- buffer per connection terlalu besar;
- write interest tidak dimatikan sehingga busy loop;
- protocol parser tidak menangani partial frame;
- exception satu connection menjatuhkan event loop;
- memory leak di attachment;
- backpressure write queue tidak dibatasi.

## 10.5 Selector vs virtual threads

Decision framework:

| Use case | Pilihan umum |
|---|---|
| HTTP server aplikasi biasa | framework + virtual thread/blocking model bisa cukup |
| High-performance networking framework | selector/event loop |
| Protocol custom ribuan connection | selector atau framework Netty/Vert.x |
| Simplicity-first service | blocking API + virtual threads |
| Low-level gateway/proxy | non-blocking I/O |

---

# 11. Memory-Mapped File

Memory-mapped file memetakan region file ke memory.

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    MappedByteBuffer mapped = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());

    while (mapped.hasRemaining()) {
        byte b = mapped.get();
        processByte(b);
    }
}
```

## 11.1 Mental model

```text
File bytes
   ↓ mmap
Virtual memory address range
   ↓ page fault on demand
OS loads file pages lazily
```

Keuntungan:

- bisa efisien untuk random access;
- OS page cache dimanfaatkan;
- menghindari explicit read loop;
- cocok untuk index/binary file tertentu.

Risiko:

- unmapping historically tidak eksplisit via old API;
- file besar mempengaruhi virtual memory;
- page fault latency bisa muncul;
- error I/O bisa muncul saat akses, bukan saat map;
- tidak cocok untuk semua workload;
- memory pressure bisa sulit dipahami.

## 11.2 Jangan anggap mmap = selalu lebih cepat

Memory-mapped file bisa lebih cepat untuk sebagian pattern, tetapi bisa lebih buruk jika:

- akses sequential sederhana lebih cocok buffered read;
- file sangat besar dan access pattern buruk;
- page fault menyebabkan latency spike;
- mapped region terlalu banyak;
- container memory limit ketat;
- observability native memory/page cache kurang.

## 11.3 MemorySegment mapping

Di Java modern, FFM API menyediakan kemampuan mapping file ke `MemorySegment` melalui API yang relevan di package foreign/file integration. Ini memberi model lifetime yang lebih eksplisit dibanding pendekatan lama pada beberapa skenario.

Namun untuk aplikasi biasa, `FileChannel`, `Files`, dan stream/channels tetap pilihan utama.

---

# 12. Large File Processing

Large file processing adalah area yang membedakan engineer biasa dan engineer kuat.

Kesalahan umum:

```java
String content = Files.readString(path);
```

Untuk file 5 GB, ini bisa:

- OutOfMemoryError;
- GC pressure;
- long pause;
- latency spike;
- container kill;
- node pressure;
- throughput collapse.

## 12.1 Prinsip utama

Untuk file besar:

1. proses streaming;
2. gunakan buffer bounded;
3. jangan simpan semua data;
4. pisahkan parsing dari aggregation;
5. batasi memory per stage;
6. ukur bytes/sec dan records/sec;
7. desain cancellation;
8. desain partial output cleanup;
9. validasi encoding;
10. jangan lupa checksum jika integrity penting.

## 12.2 Chunking byte aman

Untuk binary file:

```java
static long processBinary(Path path) throws IOException {
    long total = 0;
    byte[] buffer = new byte[1024 * 64];

    try (InputStream in = new BufferedInputStream(Files.newInputStream(path))) {
        int n;
        while ((n = in.read(buffer)) != -1) {
            processBytes(buffer, 0, n);
            total += n;
        }
    }

    return total;
}
```

## 12.3 Chunking text harus hati-hati

Untuk text, jangan sembarang `new String(chunk)`.

Pilihan lebih aman:

- `BufferedReader` jika line bounded;
- `Scanner` tidak disarankan untuk high performance large file;
- `CharsetDecoder` untuk tokenizer streaming;
- custom parser jika perlu performa tinggi.

## 12.4 Streaming tokenizer mental model

Contoh kebutuhan:

> Hitung word dalam file sangat besar, file mungkin tidak punya newline, encoding UTF-8, memory maksimum 50 MB.

Pipeline:

```text
InputStream/FileChannel
    ↓ bytes chunk
CharsetDecoder
    ↓ chars chunk
Tokenizer state machine
    ↓ token events
Metric aggregator
    ↓ bounded result/spill
Output writer
```

State yang harus dibawa antar chunk:

- partial UTF-8 sequence;
- partial word;
- current line/offset;
- quote/string state jika parsing structured format;
- checksum state;
- error context.

## 12.5 Backpressure

Jika pipeline multi-stage:

```text
Reader → Parser → Transformer → Writer
```

Masalah muncul jika reader lebih cepat dari writer.

Tanpa backpressure:

```text
queue tumbuh → heap naik → GC pressure → OOM
```

Gunakan bounded queue:

```java
BlockingQueue<Chunk> queue = new ArrayBlockingQueue<>(128);
```

Producer akan block ketika queue penuh.

Namun ini harus dikombinasikan dengan:

- cancellation;
- poison pill atau close signal;
- error propagation;
- thread interruption;
- metrics queue depth.

## 12.6 Spill to disk

Jika aggregation tidak bounded, gunakan spill.

Contoh:

- sort eksternal;
- deduplicate besar;
- group-by cardinality tinggi;
- intermediate normalized file;
- temporary segment files.

Trade-off:

- menurunkan heap;
- menambah disk I/O;
- perlu cleanup;
- perlu atomicity;
- perlu naming/idempotency;
- perlu disk quota.

## 12.7 Checksum

Untuk transfer evidence/data penting:

```java
MessageDigest digest = MessageDigest.getInstance("SHA-256");

try (InputStream in = Files.newInputStream(path);
     DigestInputStream din = new DigestInputStream(in, digest)) {
    din.transferTo(OutputStream.nullOutputStream());
}

byte[] sha256 = digest.digest();
```

Checksum berguna untuk:

- integrity verification;
- deduplication;
- audit;
- resumable transfer;
- corruption detection.

## 12.8 Progress reporting

Untuk file besar, ukur:

- bytes read;
- bytes written;
- elapsed time;
- throughput MB/s;
- records/sec;
- queue depth;
- error count;
- retry count.

Contoh wrapper sederhana:

```java
final class CountingInputStream extends FilterInputStream {
    private long count;

    CountingInputStream(InputStream in) {
        super(in);
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int n = super.read(b, off, len);
        if (n > 0) {
            count += n;
        }
        return n;
    }

    long count() {
        return count;
    }
}
```

---

# 13. Networking Classic: Socket, ServerSocket, TLS, DNS, Timeout

## 13.1 Socket mental model

Socket adalah endpoint komunikasi network.

TCP socket memberi stream byte reliable-ordered, bukan message boundary.

Penting:

> TCP adalah byte stream. Jika kamu mengirim 3 message, penerima tidak otomatis menerima 3 read.

Contoh:

```text
Sender writes: [HELLO][WORLD]
Receiver may read:
- [HELLOWORLD]
- [HE][LLOW][ORLD]
- [HELLO][WORLD]
```

Karena itu protocol di atas TCP butuh framing.

## 13.2 Framing

Contoh length-prefixed protocol:

```text
[length: 4 bytes][payload bytes]
[length: 4 bytes][payload bytes]
```

Read harus memastikan byte cukup.

```java
static byte[] readFrame(DataInputStream in, int maxFrameSize) throws IOException {
    int length = in.readInt();
    if (length < 0 || length > maxFrameSize) {
        throw new IOException("Invalid frame length: " + length);
    }

    byte[] payload = new byte[length];
    in.readFully(payload);
    return payload;
}
```

`readFully` penting karena satu `read` belum tentu mengisi semua byte.

## 13.3 Timeout

Network tanpa timeout adalah bug production.

Classic socket:

```java
Socket socket = new Socket();
socket.connect(new InetSocketAddress(host, port), 3_000); // connect timeout
socket.setSoTimeout(5_000); // read timeout
```

Timeout penting untuk:

- menghindari thread menggantung;
- menjaga SLA;
- melepas resource;
- trigger retry/circuit breaker;
- observability latency.

Jenis timeout:

| Timeout | Arti |
|---|---|
| DNS timeout | resolve hostname terlalu lama |
| connect timeout | membangun koneksi terlalu lama |
| TLS handshake timeout | negosiasi TLS terlalu lama |
| read timeout | menunggu response data terlalu lama |
| write timeout | mengirim data terlalu lama |
| request timeout | total operasi terlalu lama |
| idle timeout | connection idle terlalu lama |

## 13.4 DNS failure

DNS sering dianggap trivial padahal bisa jadi sumber incident.

Failure mode:

- stale DNS cache;
- TTL terlalu panjang;
- split-horizon DNS;
- resolver lambat;
- service discovery berubah;
- container DNS issue;
- CoreDNS overload;
- negative caching.

Design implication:

- jangan cache IP selamanya;
- pahami JVM DNS cache policy;
- expose host dan resolved address di debug log bila perlu;
- retry DNS berbeda dengan retry request;
- connection pool bisa menyimpan connection lama ke endpoint lama.

## 13.5 TLS

TLS menambah layer:

```text
TCP connect
    ↓
TLS handshake
    ↓
certificate validation
    ↓
application data
```

Failure mode:

- certificate expired;
- hostname mismatch;
- truststore missing;
- protocol/cipher mismatch;
- mutual TLS client cert salah;
- clock skew;
- SNI issue;
- proxy interception.

Rule:

> Jangan disable certificate validation hanya untuk “fix cepat”. Itu mengubah security model.

## 13.6 Connection pooling

Connection pooling mengurangi overhead:

- TCP handshake;
- TLS handshake;
- slow start;
- authentication setup.

Tetapi pooling juga membawa risiko:

- stale connection;
- pool exhaustion;
- idle timeout mismatch;
- DNS change tidak terlihat sampai connection baru dibuat;
- connection leak;
- head-of-line blocking pada konfigurasi buruk.

---

# 14. HTTP Client Modern: `java.net.http`

Java modern punya HTTP Client standar di module `java.net.http`.

## 14.1 Basic GET

```java
HttpClient client = HttpClient.newHttpClient();

HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://example.com"))
        .GET()
        .build();

HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);

System.out.println(response.statusCode());
System.out.println(response.body());
```

## 14.2 Reuse HttpClient

Buruk:

```java
HttpResponse<String> call(URI uri) throws IOException, InterruptedException {
    HttpClient client = HttpClient.newHttpClient();
    return client.send(HttpRequest.newBuilder(uri).GET().build(), BodyHandlers.ofString());
}
```

Lebih baik:

```java
final class ExternalApiClient {
    private final HttpClient client;

    ExternalApiClient(HttpClient client) {
        this.client = client;
    }

    HttpResponse<String> get(URI uri) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();

        return client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }
}
```

Kenapa?

- `HttpClient` immutable setelah dibangun;
- client dapat mengelola resource dan connection reuse;
- membuat client baru per request biasanya mencegah reuse connection efektif;
- konfigurasi timeout/proxy/authenticator/executor lebih konsisten.

## 14.3 Client builder

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(3))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .version(HttpClient.Version.HTTP_2)
        .build();
```

Konfigurasi penting:

- preferred protocol version;
- redirect policy;
- proxy;
- authenticator;
- connect timeout;
- executor.

## 14.4 Request timeout

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(10))
        .GET()
        .build();
```

Bedakan:

- client connect timeout;
- request timeout;
- application-level timeout;
- retry budget.

## 14.5 POST JSON

```java
String json = """
        {"caseId":"CASE-001","action":"SUBMIT"}
        """;

HttpRequest request = HttpRequest.newBuilder(uri)
        .header("Content-Type", "application/json")
        .timeout(Duration.ofSeconds(10))
        .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
        .build();

HttpResponse<String> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);
```

## 14.6 Async request

```java
CompletableFuture<HttpResponse<String>> future = client.sendAsync(
        request,
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
);

future.thenApply(HttpResponse::body)
      .thenAccept(System.out::println)
      .exceptionally(ex -> {
          ex.printStackTrace();
          return null;
      });
```

Hati-hati:

- exception dibungkus dalam `CompletionException`;
- cancellation perlu dipropagasi;
- callback bisa berjalan di executor tertentu;
- jangan membuat chain async tanpa timeout;
- jangan biarkan future tidak diobservasi.

## 14.7 Status code handling

Buruk:

```java
return response.body();
```

Benar:

```java
int status = response.statusCode();
if (status >= 200 && status < 300) {
    return response.body();
}
if (status == 404) {
    throw new NotFoundException("Resource not found");
}
if (status == 409) {
    throw new ConflictException("Conflict");
}
if (status == 429 || status >= 500) {
    throw new RetryableRemoteException("Remote failure: " + status);
}
throw new NonRetryableRemoteException("Remote rejected request: " + status);
```

HTTP status adalah bagian dari domain failure model.

## 14.8 Redirect handling

Redirect bisa berbahaya jika tidak dikontrol.

Risiko:

- credential leakage ke host lain;
- SSRF amplification;
- method berubah;
- redirect loop;
- unexpected scheme downgrade.

Gunakan policy sadar:

```java
HttpClient client = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
```

atau `NORMAL` jika memang diinginkan.

## 14.9 Proxy

```java
HttpClient client = HttpClient.newBuilder()
        .proxy(ProxySelector.of(new InetSocketAddress("proxy.local", 8080)))
        .build();
```

Production concern:

- proxy auth;
- TLS inspection;
- NO_PROXY equivalent;
- audit logging;
- latency;
- failure isolation.

## 14.10 HTTP/2

HTTP/2 memberi multiplexing di satu connection. Namun efeknya bergantung server, proxy, load balancer, dan konfigurasi.

Perhatikan:

- stream concurrency limit;
- head-of-line pada layer TCP tetap bisa terjadi;
- server push tidak selalu relevan;
- observability per stream vs per connection;
- fallback ke HTTP/1.1.

---

# 15. Streaming HTTP Body, Backpressure, dan Flow

HTTP body bisa kecil atau sangat besar.

## 15.1 BodyHandlers

Contoh body sebagai string:

```java
BodyHandlers.ofString(StandardCharsets.UTF_8)
```

Contoh body sebagai file:

```java
HttpResponse<Path> response = client.send(
        request,
        HttpResponse.BodyHandlers.ofFile(downloadPath)
);
```

Contoh discard body:

```java
HttpResponse<Void> response = client.send(
        request,
        HttpResponse.BodyHandlers.discarding()
);
```

## 15.2 Jangan download besar ke memory

Buruk:

```java
HttpResponse<byte[]> response = client.send(request, BodyHandlers.ofByteArray());
```

Untuk response besar, lebih baik:

```java
HttpResponse<Path> response = client.send(request, BodyHandlers.ofFile(targetPath));
```

Atau custom streaming subscriber jika perlu processing online.

## 15.3 Upload file

```java
HttpRequest request = HttpRequest.newBuilder(uri)
        .header("Content-Type", "application/octet-stream")
        .POST(HttpRequest.BodyPublishers.ofFile(path))
        .build();
```

Pertanyaan production:

- apakah perlu checksum header?
- apakah perlu resumable upload?
- apakah server support idempotency key?
- apakah retry aman?
- apakah timeout cukup untuk file besar?
- apakah progress metric tersedia?

## 15.4 Backpressure via Flow

`BodyPublisher` dan `BodySubscriber` berhubungan dengan `java.util.concurrent.Flow`.

Mental model:

```text
Subscriber requests N items
Publisher sends up to N items
Demand mengalir dari consumer ke producer
```

Ini penting agar producer tidak membanjiri consumer.

## 15.5 Custom body handling

Gunakan custom body handler jika perlu:

- menghitung checksum sambil download;
- parse streaming JSON lines;
- enforce size limit;
- decompress custom;
- write ke multiple sinks;
- progress reporting;
- virus scanning pipeline;
- evidence capture.

Namun custom subscriber lebih kompleks. Pastikan paham:

- `onSubscribe`;
- demand management;
- `onNext` bisa menerima list `ByteBuffer`;
- `ByteBuffer` ownership;
- error propagation;
- completion;
- cancellation.

---

# 16. Serialization dan Data Format

Serialization adalah proses mengubah struktur data menjadi format yang bisa disimpan atau dikirim.

Deserialization adalah proses kebalikannya.

```text
Object/record/domain data
    ↓ serialize
bytes/text
    ↓ transfer/store
bytes/text
    ↓ deserialize
Object/record/domain data
```

## 16.1 Format choices

| Format | Strength | Weakness |
|---|---|---|
| JSON | human-readable, ubiquitous | verbose, schema informal |
| XML | mature, namespaces | verbose, complex, XXE risk |
| YAML | readable config | ambiguous, unsafe parser modes |
| CSV | simple tabular | escaping/schema/type ambiguity |
| CBOR | binary JSON-like | less human-readable |
| Protobuf | compact, schema-first | less human-readable, schema tooling |
| Avro | schema evolution strong | ecosystem-specific complexity |
| Java Serialization | object graph support | security/versioning/interoperability risks |

## 16.2 Serialization is API design

Data format bukan detail teknis kecil. Ia adalah public contract.

Pertanyaan:

- Apakah format internal atau eksternal?
- Apakah butuh backward compatibility?
- Apakah butuh forward compatibility?
- Apakah konsumen multi-language?
- Apakah schema versioning jelas?
- Apakah field optional/default?
- Apakah unknown fields dipertahankan?
- Apakah enum bisa bertambah?
- Apakah precision angka penting?
- Apakah timezone/locale jelas?
- Apakah canonical form dibutuhkan untuk signature?

## 16.3 DTO vs domain object

Jangan langsung serialize domain object internal sebagai public API.

Buruk:

```java
class CaseEntity {
    Long id;
    String internalStatus;
    String reviewerNote;
    boolean deleted;
    Instant createdAt;
    Instant updatedAt;
}
```

Jika langsung dijadikan JSON API, kamu membocorkan:

- internal field;
- database shape;
- lifecycle internal;
- backward compatibility hazard;
- security-sensitive data.

Lebih baik:

```java
public record CaseResponse(
        String caseNumber,
        String status,
        Instant submittedAt
) {}
```

## 16.4 Versioning

Strategi umum:

- additive fields aman jika consumer ignore unknown;
- remove field berisiko;
- rename field = remove + add;
- type change berisiko;
- enum addition bisa merusak exhaustive switch;
- required field baru merusak old producer;
- default value perlu terdokumentasi.

## 16.5 Canonical serialization

Untuk signature/hash, serialization harus deterministic.

Masalah JSON biasa:

- field order bisa berubah;
- whitespace bisa berubah;
- number formatting bisa berubah;
- timezone format bisa berubah;
- unicode escaping bisa berubah.

Jika perlu signature:

- gunakan canonical JSON spec;
- atau format binary canonical;
- atau sign normalized bytes;
- jangan sign object setelah parsing.

---

# 17. Java Object Serialization: Kenapa Perlu Hati-hati

Java Object Serialization memungkinkan object graph ditulis ke stream dan dibaca kembali.

API utama:

```java
ObjectOutputStream
ObjectInputStream
Serializable
Externalizable
serialVersionUID
```

## 17.1 Contoh sederhana

```java
record Person(String name, int age) implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;
}

try (ObjectOutputStream out = new ObjectOutputStream(Files.newOutputStream(path))) {
    out.writeObject(new Person("Fajar", 30));
}

try (ObjectInputStream in = new ObjectInputStream(Files.newInputStream(path))) {
    Person person = (Person) in.readObject();
}
```

## 17.2 Masalah utama

Java serialization bermasalah untuk banyak sistem modern karena:

- format Java-specific;
- sulit untuk interoperability;
- object graph bisa kompleks;
- constructor normal bisa dilewati saat deserialization;
- invariant bisa rusak;
- deserialization bisa menjalankan callback khusus;
- versioning fragile;
- security risk besar jika input tidak dipercaya;
- gadget chain vulnerability;
- data stream bisa memicu alokasi besar;
- sulit diaudit.

## 17.3 Jangan deserialize untrusted data

Rule keras:

> Jangan gunakan Java Object Serialization untuk menerima data dari sumber tidak terpercaya.

Jika terpaksa karena legacy:

- gunakan `ObjectInputFilter`;
- allowlist class;
- batasi depth;
- batasi references;
- batasi array length;
- batasi bytes;
- isolasi process;
- audit dependencies;
- rencanakan migrasi.

## 17.4 `serialVersionUID`

`serialVersionUID` mengidentifikasi versi serializable class.

Jika tidak eksplisit, runtime menghitung berdasarkan class details. Itu bisa berubah karena perubahan kecil.

Lebih baik eksplisit:

```java
@Serial
private static final long serialVersionUID = 1L;
```

## 17.5 `transient`

Field `transient` tidak diserialisasi.

```java
class Session implements Serializable {
    private String userId;
    private transient String accessToken;
}
```

Namun jangan menganggap `transient` otomatis menyelesaikan semua security concern.

## 17.6 `readObject` invariant validation

Jika class serializable punya invariant, validasi saat deserialization.

```java
final class Money implements Serializable {
    @Serial
    private static final long serialVersionUID = 1L;

    private final BigDecimal amount;
    private final String currency;

    Money(BigDecimal amount, String currency) {
        this.amount = requireValidAmount(amount);
        this.currency = requireValidCurrency(currency);
    }

    @Serial
    private void readObject(ObjectInputStream in) throws IOException, ClassNotFoundException {
        in.defaultReadObject();
        if (amount == null || currency == null || currency.length() != 3) {
            throw new InvalidObjectException("Invalid Money");
        }
    }
}
```

## 17.7 Prefer alternatives

Untuk API/service modern:

- JSON untuk human/debuggability;
- Protobuf untuk compact multi-language contract;
- Avro untuk event/log schema evolution;
- CBOR untuk binary JSON-like;
- custom binary format hanya jika benar-benar perlu dan terdokumentasi.

---

# 18. Schema Evolution: JSON, Protobuf, Avro, CBOR

## 18.1 JSON

Kelebihan:

- mudah dibaca;
- tooling luas;
- cocok REST;
- cocok config dan logs;
- bahasa agnostic.

Kelemahan:

- tidak ada schema built-in;
- number ambiguity;
- date/time string convention;
- enum string bisa berubah;
- field missing vs null harus jelas;
- payload besar.

Guideline:

```java
public record CaseCreatedEventV1(
        String eventId,
        String caseId,
        String caseNumber,
        Instant occurredAt,
        String actorId
) {}
```

Aturan:

- jangan reuse field dengan makna baru;
- field baru optional;
- dokumentasikan nullability;
- gunakan ISO-8601 untuk timestamp;
- gunakan string untuk ID besar;
- hindari float untuk uang;
- gunakan `BigDecimal` atau integer minor unit.

## 18.2 Protobuf

Kelebihan:

- schema-first;
- compact;
- multi-language;
- unknown fields support;
- cocok internal RPC/event.

Guideline:

- jangan reuse field number;
- reserve field number/name saat dihapus;
- enum punya unknown/default;
- field baru optional/default;
- hati-hati dengan `required` pada proto2;
- document semantic version.

## 18.3 Avro

Kelebihan:

- kuat untuk schema evolution;
- sering dipakai dengan Kafka/schema registry;
- writer schema + reader schema resolution;
- cocok data pipeline.

Guideline:

- default value penting;
- union null harus dirancang;
- evolution rules harus di-test;
- schema registry compatibility mode harus jelas.

## 18.4 CBOR

CBOR cocok saat:

- ingin binary compact;
- data model mirip JSON;
- IoT atau payload constrained;
- tetap ingin struktur self-describing.

Tetapi adopsi/tooling perlu diperhatikan.

## 18.5 Event format production rules

Untuk event-driven system:

```json
{
  "eventId": "01J...",
  "eventType": "CaseSubmitted",
  "eventVersion": 1,
  "aggregateType": "Case",
  "aggregateId": "CASE-001",
  "occurredAt": "2026-06-11T14:30:00Z",
  "correlationId": "...",
  "causationId": "...",
  "payload": {}
}
```

Rules:

- event immutable;
- event type stable;
- version explicit;
- timestamp UTC;
- idempotency key jelas;
- correlation/causation id wajib untuk traceability;
- unknown fields tolerated;
- schema evolution tested.

---

# 19. Foreign Function & Memory API

Java 25 memiliki `java.lang.foreign`, API modern untuk akses memory/function di luar Java runtime.

FFM API final sejak JDK 22 dan tersedia di Java 25.

## 19.1 Kenapa FFM ada

Sebelumnya, Java biasanya memakai:

- JNI;
- `sun.misc.Unsafe`;
- direct `ByteBuffer`;
- third-party native binding seperti JNA/JNR.

Masalah:

- JNI verbose dan brittle;
- native crash bisa menjatuhkan JVM;
- Unsafe berbahaya;
- lifetime memory sulit;
- build/deploy native glue kompleks.

FFM bertujuan memberi API yang lebih Java-native untuk:

- mengalokasikan off-heap memory;
- mengakses structured memory;
- memanggil native function;
- mengontrol lifetime;
- memberi spatial/temporal safety.

## 19.2 MemorySegment

`MemorySegment` merepresentasikan region memory contiguous.

Memory bisa:

- heap memory;
- off-heap/native memory;
- mapped memory.

Contoh alokasi native memory:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(10 * Integer.BYTES);

    for (int i = 0; i < 10; i++) {
        segment.setAtIndex(ValueLayout.JAVA_INT, i, i);
    }

    for (int i = 0; i < 10; i++) {
        int value = segment.getAtIndex(ValueLayout.JAVA_INT, i);
        System.out.println(value);
    }
}
```

Setelah arena ditutup, memory tidak boleh diakses lagi.

## 19.3 Arena

`Arena` mengontrol lifetime memory segment.

Jenis umum:

- confined arena;
- shared arena;
- automatic arena;
- global arena.

Rule:

> Jangan treat off-heap memory seperti object biasa. Lifetime harus eksplisit.

## 19.4 Spatial dan temporal safety

Spatial safety:

```text
akses tidak boleh di luar batas segment
```

Temporal safety:

```text
akses tidak boleh setelah memory dibebaskan/arena ditutup
```

Ini perbedaan besar dibanding raw pointer C.

## 19.5 MemoryLayout

`MemoryLayout` mendeskripsikan struktur memory:

- size;
- alignment;
- field offset;
- sequence;
- struct;
- union.

Contoh konseptual struct:

```java
MemoryLayout pointLayout = MemoryLayout.structLayout(
        ValueLayout.JAVA_INT.withName("x"),
        ValueLayout.JAVA_INT.withName("y")
);
```

Dengan layout, akses bisa lebih aman dan terdokumentasi.

## 19.6 Linker dan native function

FFM bisa memanggil function native.

Contoh konseptual memanggil `strlen`:

```java
Linker linker = Linker.nativeLinker();
SymbolLookup stdlib = linker.defaultLookup();

MethodHandle strlen = linker.downcallHandle(
        stdlib.findOrThrow("strlen"),
        FunctionDescriptor.of(ValueLayout.JAVA_LONG, ValueLayout.ADDRESS)
);

try (Arena arena = Arena.ofConfined()) {
    MemorySegment cString = arena.allocateFrom("Hello");
    long len = (long) strlen.invokeExact(cString);
    System.out.println(len);
}
```

Catatan:

- foreign call bisa restricted;
- native access perlu enablement sesuai kebijakan runtime;
- ABI platform matters;
- error native bukan exception Java biasa;
- crash native bisa fatal.

## 19.7 FFM bukan untuk semua orang

Gunakan FFM jika:

- butuh native library;
- butuh off-heap structured memory;
- membuat high-performance library;
- menggantikan JNI/Unsafe secara sadar;
- ada alasan kuat dan profiling.

Jangan gunakan FFM hanya karena terlihat advanced.

Untuk business service biasa, `Files`, `HttpClient`, JDBC, Kafka client, dan library managed Java lebih tepat.

---

# 20. I/O di Container, Cloud, dan Kubernetes

## 20.1 File system dalam container

Container filesystem sering ephemeral.

Pertanyaan:

- apakah data boleh hilang saat pod restart?
- apakah path writable?
- apakah volume mounted?
- apakah permission sesuai UID container?
- apakah disk quota ada?
- apakah temp directory cukup?
- apakah file besar menyebabkan node disk pressure?

## 20.2 Temp file

```java
Path temp = Files.createTempFile("case-upload-", ".tmp");
```

Production concern:

- lokasi temp;
- cleanup;
- quota;
- permission;
- naming;
- sensitive data;
- encryption at rest;
- pod restart.

Lebih eksplisit:

```java
Path tempDir = Path.of(System.getenv().getOrDefault("APP_TEMP_DIR", "/tmp/app"));
Files.createDirectories(tempDir);
Path temp = Files.createTempFile(tempDir, "upload-", ".tmp");
```

## 20.3 Object storage

Cloud-native system sering tidak menyimpan file di local disk final.

Pattern:

```text
HTTP upload
    ↓
temp file / streaming validation
    ↓
checksum
    ↓
object storage
    ↓
metadata DB
    ↓
event
```

Pertanyaan:

- upload langsung stream atau staging dulu?
- checksum dihitung kapan?
- metadata commit atomic dengan object upload bagaimana?
- bagaimana cleanup orphan object?
- bagaimana retry idempotent?
- bagaimana virus scanning?
- bagaimana access control?

## 20.4 Graceful shutdown

I/O panjang perlu shutdown model.

Saat SIGTERM di Kubernetes:

- hentikan menerima request baru;
- biarkan in-flight selesai dalam grace period;
- cancel operasi yang tidak bisa selesai;
- cleanup temp file;
- commit status partial/failure;
- emit metrics/log.

## 20.5 CPU throttling dan I/O

I/O-heavy app tetap bisa terdampak CPU throttling karena:

- TLS encryption;
- compression;
- checksum;
- JSON parsing;
- serialization;
- copy buffer;
- GC;
- logging.

Jangan hanya melihat disk/network throughput. Lihat juga CPU dan GC.

---

# 21. Observability untuk I/O dan Data Transfer

## 21.1 Metrics minimum

Untuk file transfer:

- bytes read;
- bytes written;
- records processed;
- duration;
- throughput;
- failure count;
- retry count;
- temp file count;
- cleanup failure;
- checksum mismatch;
- queue depth.

Untuk HTTP:

- request count;
- status code distribution;
- latency histogram;
- timeout count;
- connection error;
- DNS error;
- TLS error;
- retry count;
- response size;
- in-flight requests.

## 21.2 Logging

Log yang baik:

```text
event=download_failed
caseId=CASE-001
urlHost=api.example.com
status=504
attempt=2
elapsedMs=5300
bytesReceived=1048576
correlationId=...
errorClass=HttpTimeoutException
```

Jangan log:

- full access token;
- secret header;
- raw PII tanpa masking;
- full file content;
- binary payload besar.

## 21.3 Tracing

Trace I/O boundary:

- outgoing HTTP call;
- file staging;
- object storage upload;
- virus scan;
- DB metadata commit;
- event publish.

Trace harus membawa:

- correlation id;
- causation id;
- operation name;
- status;
- size;
- duration;
- failure type.

## 21.4 Profiling

I/O performance harus dipisahkan:

- time waiting I/O;
- CPU parse time;
- allocation rate;
- GC time;
- lock contention;
- queue wait;
- downstream latency.

Tanpa breakdown, mudah salah diagnosis.

Contoh salah:

> “Disk lambat.”

Padahal bottleneck bisa:

- UTF-8 decoding;
- regex parsing;
- JSON object allocation;
- synchronized writer;
- logging berlebihan;
- small buffer;
- compression CPU;
- retry storm.

---

# 22. Security dan Safety Checklist

## 22.1 File input

Checklist:

- validasi path;
- batasi ukuran file;
- batasi jumlah file;
- batasi line length jika text;
- validasi content type berdasarkan isi, bukan hanya extension;
- scan malware jika domain membutuhkan;
- simpan di lokasi aman;
- jangan execute uploaded file;
- jangan expose local path ke user;
- cleanup temp;
- permission least privilege.

## 22.2 Path traversal

Input berbahaya:

```text
../../etc/passwd
..\..\windows\system32
%2e%2e%2f
symlink-to-secret
```

Mitigation:

- resolve against base;
- normalize;
- check startsWith real base;
- handle symlink policy;
- avoid using user filename as storage filename;
- generate server-side object key.

## 22.3 Zip slip

Saat extract archive:

```java
Path target = outputDir.resolve(entry.getName()).normalize();
if (!target.startsWith(outputDir)) {
    throw new SecurityException("Zip entry escapes target dir");
}
```

Jangan percaya entry name.

## 22.4 Decompression bomb

Compressed file kecil bisa expand sangat besar.

Mitigation:

- max compressed size;
- max uncompressed size;
- max file count;
- max nesting;
- max ratio;
- timeout;
- streaming extraction;
- sandbox.

## 22.5 SSRF pada HTTP Client

Jika URL berasal dari user:

- allowlist host;
- block private IP range;
- block localhost;
- block link-local metadata IP;
- resolve DNS carefully;
- handle DNS rebinding;
- disable redirect atau validate redirect target;
- set timeout;
- limit response size;
- restrict methods;
- avoid forwarding credentials.

## 22.6 Deserialization

- jangan deserialize untrusted Java serialization;
- pakai allowlist filter jika legacy;
- hindari polymorphic JSON deserialization tanpa restriction;
- batasi depth/size;
- validate DTO setelah parse;
- treat parser as attack surface.

---

# 23. Design Decision Framework

## 23.1 File kecil

Jika file kecil, trusted, dan ukuran dibatasi:

```java
String content = Files.readString(path, StandardCharsets.UTF_8);
```

Aman jika:

- ukuran diketahui;
- memory cukup;
- bukan untrusted huge input;
- error handling jelas.

## 23.2 File besar text

Gunakan:

- `BufferedReader` jika line bounded;
- streaming parser/tokenizer jika line bisa panjang;
- `CharsetDecoder` jika perlu kontrol encoding boundary;
- metrics dan cancellation.

## 23.3 File besar binary

Gunakan:

- `InputStream` dengan buffer;
- `FileChannel`;
- `transferTo/transferFrom` untuk copy;
- checksum streaming;
- bounded memory.

## 23.4 Random access

Gunakan:

- `FileChannel` positional read/write;
- `RandomAccessFile` legacy;
- memory-mapped file jika access pattern cocok.

## 23.5 Network HTTP sederhana

Gunakan:

- reusable `HttpClient`;
- connect timeout;
- request timeout;
- status handling;
- bounded response body.

## 23.6 HTTP besar

Gunakan:

- `BodyPublishers.ofFile` untuk upload;
- `BodyHandlers.ofFile` untuk download;
- custom streaming subscriber jika perlu checksum/progress;
- retry hanya jika idempotent/resumable.

## 23.7 Native interop

Gunakan FFM jika:

- library native penting;
- performance/interop justified;
- ownership memory jelas;
- native access policy diterima;
- ada test multi-platform;
- fallback/observability jelas.

---

# 24. Production Failure Modes

## 24.1 Partial read/write

Symptom:

- file output corrupt;
- protocol frame rusak;
- missing bytes;
- duplicate bytes.

Prevention:

- loop sampai EOF atau buffer drained;
- handle return value;
- checksum;
- test dengan stream yang sengaja partial.

## 24.2 Resource leak

Symptom:

- too many open files;
- connection pool exhausted;
- disk lock;
- temp file menumpuk;
- native memory naik.

Prevention:

- try-with-resources;
- ownership contract;
- leak detection;
- metrics open resources;
- cleanup job.

## 24.3 Encoding corruption

Symptom:

- karakter aneh;
- search gagal;
- signature mismatch;
- parse error sporadic.

Prevention:

- charset eksplisit;
- decoder REPORT untuk critical data;
- test multilingual;
- avoid per-chunk string decoding sembarangan.

## 24.4 Unbounded memory

Symptom:

- OOM;
- GC storm;
- pod killed;
- latency spike.

Prevention:

- streaming;
- size limit;
- bounded queue;
- spill to disk;
- body handler to file;
- no `readAllBytes` for untrusted input.

## 24.5 Timeout missing

Symptom:

- thread stuck;
- request never returns;
- pool exhaustion;
- cascading failure.

Prevention:

- connect timeout;
- read/request timeout;
- deadline propagation;
- cancellation;
- circuit breaker.

## 24.6 Retry unsafe

Symptom:

- duplicate payment/order/case action;
- double upload;
- inconsistent downstream state.

Prevention:

- idempotency key;
- retry only safe methods/operations;
- server-side dedupe;
- operation status query;
- resumable protocol.

## 24.7 Deserialization exploit

Symptom:

- remote code execution;
- memory exhaustion;
- unexpected class loading;
- callback invocation.

Prevention:

- avoid Java serialization for untrusted input;
- filter;
- allowlist;
- migration;
- dependency hygiene.

---

# 25. Mini Project: Large Evidence Transfer Engine

## 25.1 Problem statement

Bangun Java CLI/service kecil:

```text
large-evidence-transfer
```

Fungsi:

1. menerima source file besar;
2. validasi path dan ukuran;
3. hitung SHA-256 streaming;
4. copy ke staging path secara atomic;
5. optional upload via HTTP PUT/POST;
6. simpan metadata JSON;
7. support progress logging;
8. support cancellation;
9. enforce memory bounded;
10. produce audit report.

## 25.2 Requirements

CLI:

```bash
java -jar large-evidence-transfer.jar \
  --source ./input/evidence.bin \
  --target ./staging/evidence.bin \
  --metadata ./staging/evidence.json \
  --max-size-mb 10240 \
  --buffer-kb 64
```

Output metadata:

```json
{
  "source": "...",
  "target": "...",
  "sizeBytes": 123456,
  "sha256": "...",
  "startedAt": "...",
  "completedAt": "...",
  "durationMs": 1234,
  "throughputBytesPerSecond": 987654,
  "status": "COMPLETED"
}
```

## 25.3 Architecture

```text
Command Parser
    ↓
Path Validator
    ↓
Transfer Service
    ↓
Streaming Copy + Digest
    ↓
Atomic Move
    ↓
Metadata Writer
    ↓
Audit Logger
```

## 25.4 Core transfer implementation

```java
record TransferResult(
        Path source,
        Path target,
        long sizeBytes,
        String sha256Hex,
        Duration duration
) {}
```

```java
final class EvidenceTransferService {
    TransferResult transfer(Path source, Path target, long maxBytes, int bufferSize)
            throws IOException, NoSuchAlgorithmException {

        Instant started = Instant.now();

        Path realSource = source.toRealPath();
        long sourceSize = Files.size(realSource);
        if (sourceSize > maxBytes) {
            throw new IOException("Source exceeds max size: " + maxBytes);
        }

        Path targetDir = target.toAbsolutePath().getParent();
        Files.createDirectories(targetDir);
        Path temp = Files.createTempFile(targetDir, target.getFileName().toString(), ".tmp");

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;

        try (InputStream rawIn = Files.newInputStream(realSource);
             DigestInputStream in = new DigestInputStream(new BufferedInputStream(rawIn, bufferSize), digest);
             OutputStream out = new BufferedOutputStream(Files.newOutputStream(temp), bufferSize)) {

            byte[] buffer = new byte[bufferSize];
            int n;
            while ((n = in.read(buffer)) != -1) {
                total += n;
                if (total > maxBytes) {
                    throw new IOException("Transfer exceeds max size: " + maxBytes);
                }
                out.write(buffer, 0, n);
            }
        } catch (IOException | RuntimeException e) {
            try {
                Files.deleteIfExists(temp);
            } catch (IOException cleanup) {
                e.addSuppressed(cleanup);
            }
            throw e;
        }

        Files.move(temp, target,
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE);

        Instant completed = Instant.now();
        return new TransferResult(
                realSource,
                target,
                total,
                HexFormat.of().formatHex(digest.digest()),
                Duration.between(started, completed)
        );
    }
}
```

## 25.5 Improvement tasks

Tambahkan:

- progress callback;
- cancellation token;
- JFR event;
- metric emission;
- HTTP upload;
- retry dengan idempotency key;
- metadata atomic write;
- file lock;
- permission check;
- integration test dengan temp directory;
- chaos test: disk full, permission denied, interrupted transfer.

---

# 26. Latihan Bertahap

## Latihan 1 — Copy file manual

Implementasikan copy file dengan `InputStream` dan `OutputStream`.

Syarat:

- buffer configurable;
- return total bytes;
- close resource;
- unit test partial stream.

## Latihan 2 — Copy file dengan `FileChannel`

Implementasikan copy menggunakan `transferTo`.

Syarat:

- handle partial transfer;
- progress callback;
- compare checksum.

## Latihan 3 — Text reader dengan charset strict

Baca file UTF-8 dan fail jika malformed input.

Syarat:

- gunakan `CharsetDecoder`;
- test dengan invalid UTF-8;
- laporkan offset kasar error.

## Latihan 4 — HTTP downloader

Download file besar via `HttpClient`.

Syarat:

- timeout;
- status handling;
- body to file;
- max size jika memungkinkan;
- checksum;
- temp file + atomic move.

## Latihan 5 — SSRF-safe URL fetcher

Buat fetcher yang hanya boleh akses host allowlist.

Syarat:

- validate scheme `https`;
- validate host;
- reject localhost/private IP;
- reject redirect ke host lain;
- timeout;
- max body size.

## Latihan 6 — Binary protocol parser

Buat parser length-prefixed frame.

Syarat:

- support partial read;
- max frame size;
- test fragmented input;
- test malicious length.

## Latihan 7 — FFM basic memory

Alokasikan native memory untuk array int.

Syarat:

- gunakan `Arena`;
- write/read values;
- coba akses setelah close dan observasi error;
- jelaskan spatial/temporal safety.

---

# 27. Checklist Pemahaman

Kamu dianggap memahami bagian ini jika bisa menjawab:

1. Apa bedanya `InputStream` dan `Reader`?
2. Kenapa `read(buffer)` tidak boleh diasumsikan mengisi buffer penuh?
3. Kenapa `readAllBytes()` berbahaya untuk untrusted input?
4. Apa perbedaan `flush()` dan `close()`?
5. Kenapa charset eksplisit penting?
6. Kenapa decoding UTF-8 per chunk bisa rusak?
7. Apa perbedaan `Path` dan `String` path?
8. Kenapa `Files.exists` lalu `Files.delete` bisa race?
9. Apa fungsi atomic move?
10. Apa arti `position`, `limit`, dan `capacity` di `ByteBuffer`?
11. Kapan pakai `flip`, `clear`, dan `compact`?
12. Apa beda heap buffer dan direct buffer?
13. Apa itu `FileChannel.transferTo` dan kenapa tetap harus loop?
14. Apa itu selector?
15. Kenapa TCP butuh framing?
16. Timeout apa saja yang relevan dalam networking?
17. Kenapa `HttpClient` sebaiknya direuse?
18. Apa bedanya connect timeout dan request timeout?
19. Kenapa response besar sebaiknya tidak memakai `BodyHandlers.ofByteArray()`?
20. Apa risiko Java Object Serialization?
21. Apa itu `ObjectInputFilter`?
22. Apa bedanya JSON, Protobuf, Avro, dan Java Serialization dari sisi contract?
23. Apa itu `MemorySegment` dan `Arena`?
24. Apa itu spatial dan temporal safety?
25. Bagaimana mendesain transfer file besar yang bounded memory, observable, dan recoverable?

---

# 28. Referensi Resmi

Referensi utama yang relevan untuk bagian ini:

1. Oracle Java SE 25 API Documentation — `java.io` package  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/package-summary.html>

2. Oracle Java SE 25 API Documentation — `InputStream`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/InputStream.html>

3. Oracle Java SE 25 API Documentation — `Reader`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Reader.html>

4. Oracle Java SE 25 API Documentation — `Path`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html>

5. Oracle Java SE 25 API Documentation — `Files`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html>

6. Oracle Java SE 25 API Documentation — `java.nio.channels`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/package-summary.html>

7. Oracle Java SE 25 API Documentation — `Selector`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/Selector.html>

8. Oracle Java SE 25 API Documentation — `java.net.http` package  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/package-summary.html>

9. Oracle Java SE 25 API Documentation — `HttpClient`  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html>

10. OpenJDK JEP 321 — HTTP Client API  
    <https://openjdk.org/jeps/321>

11. Java Object Serialization Specification  
    <https://docs.oracle.com/en/java/javase/11/docs/specs/serialization/index.html>

12. Oracle Java Serialization Filtering  
    <https://docs.oracle.com/en/java/javase/17/core/serialization-filtering1.html>

13. OpenJDK JEP 290 — Filter Incoming Serialization Data  
    <https://openjdk.org/jeps/290>

14. Oracle Java SE 25 API Documentation — `java.lang.foreign` package  
    <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/package-summary.html>

15. OpenJDK JEP 454 — Foreign Function & Memory API  
    <https://openjdk.org/jeps/454>

---

# Penutup

Bagian ini penting karena hampir semua sistem production adalah sistem I/O:

- service membaca request;
- service menulis response;
- service memanggil API lain;
- service membaca/menulis file;
- service mentransfer payload;
- service menyimpan object;
- service memproses event;
- service berinteraksi dengan native/library eksternal.

Engineer Java yang kuat tidak hanya bertanya:

> API apa yang bisa membaca file ini?

Ia bertanya:

> Apa boundary-nya, berapa ukurannya, apakah blocking, apakah bounded, bagaimana timeout-nya, bagaimana cancellation-nya, bagaimana encoding-nya, bagaimana failure mode-nya, bagaimana retry-nya, bagaimana integrity-nya, dan bagaimana kita tahu ketika rusak di production?

Itulah perbedaan antara “bisa memakai I/O API” dan “bisa mendesain data transfer system”.
