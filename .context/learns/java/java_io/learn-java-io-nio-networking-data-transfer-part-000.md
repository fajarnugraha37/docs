# Part 000 — Mental Model Besar Java I/O: Dari Byte, Stream, Channel, Buffer, sampai Data Transfer

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-000.md`  
> Level: Advanced / architecture-aware / production-oriented  
> Fokus: membangun peta mental sebelum masuk ke API detail.

---

## 0. Status Seri

Ini adalah **Part 000** dari seri besar Java I/O, NIO, NIO.2, Console I/O, Buffer, Byte & Character Stream, Serialization, File & FileSystem, Compression, Networking, dan Data Transfer.

Seri **belum selesai**. Ini adalah bagian fondasi awal. Setelah bagian ini, lanjutannya adalah:

```text
learn-java-io-nio-networking-data-transfer-part-001.md
```

Topik part berikutnya:

```text
Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
```

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, targetnya bukan sekadar tahu bahwa Java punya `InputStream`, `OutputStream`, `Reader`, `Writer`, `Path`, `Files`, `ByteBuffer`, `FileChannel`, `Socket`, dan `HttpClient`.

Target yang lebih penting adalah kamu mampu menjawab pertanyaan engineering seperti:

1. **Data ini sebenarnya byte, character, object, record, message, atau file?**
2. **Boundary mana yang sedang dilintasi?** Memory ke file? File ke network? Network ke object? Object ke byte?
3. **Apakah data harus diproses sekaligus atau streaming?**
4. **Siapa pemilik resource dan siapa yang wajib menutupnya?**
5. **Apa failure mode paling realistis?** EOF, partial read, timeout, corruption, duplicate, disk full, permission denied, connection reset?
6. **Apa invariant yang harus dijaga?** Atomicity, ordering, checksum, encoding, idempotency, durability?
7. **API Java mana yang sesuai?** `java.io`, `java.nio`, `java.nio.file`, `java.nio.channels`, `java.net`, atau `java.net.http`?
8. **Kapan memilih blocking I/O, virtual thread, non-blocking NIO, atau library higher-level seperti Netty?**
9. **Kapan performa bottleneck ada di Java, kapan di OS, kapan di network, kapan di disk, dan kapan di protocol design?**
10. **Kapan operasi I/O yang kelihatan sederhana sebenarnya membutuhkan state machine?**

Part ini adalah **peta navigasi**. Tanpa peta ini, belajar Java I/O sering berubah menjadi hafalan class. Dengan peta ini, setiap API akan terlihat sebagai alat untuk menyelesaikan masalah boundary, representation, resource, dan failure.

---

## 2. Kenapa Java I/O Tidak Boleh Dipahami Sebagai “Baca-Tulis File” Saja

Banyak engineer memulai I/O dari contoh seperti ini:

```java
String text = Files.readString(Path.of("data.txt"));
```

atau:

```java
try (InputStream in = new FileInputStream("data.bin")) {
    byte[] bytes = in.readAllBytes();
}
```

Contoh itu valid, tetapi mental model-nya terlalu kecil.

Di production system, I/O bisa berarti:

- membaca request body HTTP berukuran besar;
- menulis response streaming tanpa menghabiskan heap;
- membaca CSV 20 GB secara incremental;
- menerima file upload yang bisa putus di tengah;
- melakukan transfer file antar-service;
- membuat report besar ke temporary file lalu publish secara atomic;
- membaca data dari socket yang belum tentu datang penuh;
- menulis event log append-only;
- melakukan compression sambil streaming;
- melakukan checksum sebelum finalisasi;
- melakukan retry tanpa membuat duplicate;
- mendeteksi file yang baru muncul tetapi belum selesai ditulis;
- menghindari path traversal saat extract ZIP;
- menghindari deserialization attack;
- memilih buffer agar throughput naik tanpa membuat memory pressure;
- memahami kenapa `write()` sukses belum tentu data sudah durable di disk;
- memahami kenapa `read()` tidak selalu mengembalikan jumlah byte yang diminta;
- memahami kenapa TCP tidak mempertahankan message boundary.

Jadi, I/O bukan satu topik kecil. I/O adalah pertemuan antara:

```text
application model
  ↕
Java object / byte / character representation
  ↕
JVM heap / direct memory
  ↕
JDK abstraction
  ↕
operating system syscall
  ↕
kernel buffer / page cache / socket buffer
  ↕
disk / network / console / pipe / remote peer
```

Jika salah memahami satu boundary saja, bug-nya bisa sangat sulit dilacak.

Contoh sederhana:

```java
byte[] bytes = new byte[1024];
int n = inputStream.read(bytes);
process(bytes);
```

Bug-nya: `process(bytes)` memproses seluruh 1024 byte, padahal `read()` mungkin hanya mengisi `n` byte. Sisanya bisa berisi data lama/default. Di file kecil mungkin tidak terlihat. Di network, bug ini bisa menjadi data corruption.

Contoh lain:

```java
String body = new String(bytes);
```

Bug-nya: encoding memakai default charset, bukan charset eksplisit. Di satu environment benar, di environment lain rusak.

Contoh lain:

```java
Files.writeString(target, content);
```

Kode ini menulis file, tetapi jika process mati di tengah, pembaca lain bisa melihat file setengah jadi. Untuk config, manifest, export, atau document final, sering kali perlu pola atomic write.

---

## 3. Sumber Resmi dan Posisi API dalam Java

Sebelum masuk lebih jauh, penting memahami bahwa Java I/O tersebar di beberapa package/module utama:

| Area | Package / Module | Peran Utama |
|---|---|---|
| Classic I/O | `java.io` | Stream byte/character, file lama, serialization |
| NIO core | `java.nio` | Buffer, charset, memory-oriented I/O primitives |
| NIO channel | `java.nio.channels` | Channel file/socket, selector, non-blocking I/O |
| NIO.2 filesystem | `java.nio.file` | `Path`, `Files`, filesystem, file attributes, watch service |
| Networking classic | `java.net` | Socket, address, URI/URL, datagram |
| HTTP client | `java.net.http` | HTTP Client dan WebSocket API sejak Java 11 |
| Compression | `java.util.zip` | ZIP, GZIP, Deflater/Inflater |

Referensi resmi yang menjadi dasar seri ini:

- Package `java.io` menyediakan system input/output melalui data streams, serialization, dan file system. Lihat Oracle Java SE API: <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/package-summary.html>
- Java NIO mendefinisikan buffer sebagai container data, charset sebagai mapping bytes dan Unicode characters, channel sebagai koneksi ke entity I/O, dan selectable channel untuk multiplexed I/O. Lihat Oracle Java NIO guide: <https://docs.oracle.com/en/java/javase/21/core/java-nio.html>
- Package `java.nio.channels` mendefinisikan channel untuk entity yang mampu melakukan operasi I/O seperti files dan sockets, serta selector untuk multiplexed non-blocking I/O. Lihat Oracle Java SE API: <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/package-summary.html>
- Package `java.nio.file` mendefinisikan interface dan class agar JVM dapat mengakses file, file attributes, dan file systems. Lihat Oracle Java SE API: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html>
- Class `Files` berisi static methods untuk operasi files, directories, dan jenis file lain, biasanya mendelegasikan operasi ke file system provider terkait. Lihat Oracle Java SE API: <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html>
- Module `java.net.http` mendefinisikan HTTP Client dan WebSocket APIs sejak Java 11. Lihat Oracle Java SE API: <https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/module-summary.html>
- Java Object Serialization Specification menjelaskan bagaimana `ObjectOutputStream` dan `ObjectInputStream` menangani object graph dan evolusi class. Lihat Oracle Serialization Spec: <https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/serial-arch.html>

Kita tidak akan memperlakukan dokumentasi itu sebagai daftar class. Kita akan memetakannya ke mental model.

---

## 4. Mental Model Paling Penting: I/O adalah Boundary Crossing

Semua I/O adalah perpindahan data melewati boundary.

Boundary dapat berupa:

1. **Memory ↔ file**
2. **Memory ↔ socket**
3. **Memory ↔ console**
4. **Memory ↔ pipe**
5. **Object ↔ byte stream**
6. **Character ↔ byte encoding**
7. **Application message ↔ transport stream**
8. **Temporary state ↔ durable state**
9. **Trusted internal data ↔ untrusted external data**
10. **Fast producer ↔ slow consumer**

Setiap boundary punya pertanyaan dasar.

### 4.1 Boundary Memory ke File

Pertanyaan penting:

- Apakah data kecil atau besar?
- Apakah boleh load semua ke memory?
- Apakah file final harus atomic?
- Apakah perlu `fsync`/`force`?
- Apakah file dibaca oleh process lain saat sedang ditulis?
- Apakah write boleh overwrite file lama?
- Apa yang terjadi jika disk penuh?
- Apa yang terjadi jika permission berubah?
- Apa yang terjadi jika symbolic link diarahkan ke lokasi lain?

Contoh masalah nyata:

```text
Service menulis config.json langsung ke path final.
Process mati saat write.
Service lain membaca config.json dan gagal parse karena file setengah jadi.
```

Solusi mental model:

```text
write temp file → flush → force → atomic move → publish final path
```

Ini bukan sekadar API. Ini invariant:

```text
Pembaca hanya boleh melihat versi lama yang valid atau versi baru yang valid.
Tidak boleh melihat versi setengah jadi.
```

### 4.2 Boundary Memory ke Socket

Pertanyaan penting:

- Apakah protocol berbasis message atau stream?
- Bagaimana menentukan panjang message?
- Apakah peer bisa lambat?
- Apakah `read()` bisa return sebagian?
- Apakah `write()` bisa menulis sebagian?
- Apa timeout yang benar?
- Apa strategi close?
- Apa strategi retry?
- Apakah request idempotent?

Contoh masalah nyata:

```text
Client mengirim 1 message 10 KB melalui TCP.
Server memanggil read(buffer) satu kali dan menganggap message sudah lengkap.
```

Bug-nya: TCP adalah byte stream. Satu `write()` di client tidak menjamin satu `read()` di server. Data bisa datang dalam beberapa potongan.

Solusi mental model:

```text
application message harus punya framing
```

Misalnya:

```text
[4-byte length][payload bytes]
```

### 4.3 Boundary Object ke Byte

Pertanyaan penting:

- Apakah object perlu disimpan atau dikirim?
- Apakah format harus bisa dibaca versi aplikasi berikutnya?
- Apakah data berasal dari sumber trusted atau untrusted?
- Apakah object graph punya cycle?
- Apakah class berubah dari waktu ke waktu?
- Apakah format harus interoperable dengan bahasa lain?

Java Serialization bisa menyimpan object graph, tetapi untuk boundary eksternal, deserialization sering menjadi risiko besar. Jadi invariant-nya:

```text
Jangan deserialize data tidak terpercaya menggunakan native Java serialization tanpa filter/allowlist dan threat model yang jelas.
```

### 4.4 Boundary Character ke Byte

Pertanyaan penting:

- Charset apa yang dipakai?
- Apakah charset eksplisit?
- Apakah input bisa malformed?
- Apakah payload bisa dipotong di tengah multi-byte sequence?
- Apakah ukuran limit dihitung dalam byte atau character?

Contoh masalah nyata:

```java
if (text.length() <= 255) {
    output.write(text.getBytes(StandardCharsets.UTF_8));
}
```

Bug-nya: `text.length()` menghitung UTF-16 code units, bukan byte UTF-8. String dengan emoji atau karakter non-ASCII bisa melebihi 255 byte meskipun `length()` kecil.

---

## 5. Layer Model Java I/O

Supaya tidak tersesat, kita gunakan layer model berikut.

```text
┌────────────────────────────────────────────────────────────┐
│ Application Meaning                                         │
│ record, document, message, event, command, report, object   │
└────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Logical Representation                                     │
│ text, binary, JSON, CSV, ZIP, serialized object, protocol   │
└────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Java Abstraction                                            │
│ InputStream, Reader, Channel, Buffer, Path, Socket, Client  │
└────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│ JVM / Memory                                                │
│ heap byte[], char[], direct memory, mapped memory           │
└────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│ OS Boundary                                                 │
│ file descriptor, syscall, kernel buffer, page cache         │
└────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Physical / Remote Entity                                    │
│ disk, SSD, network, terminal, pipe, remote service          │
└────────────────────────────────────────────────────────────┘
```

Kesalahan umum adalah mencampur layer.

Contoh:

- Mengira `String` sama dengan bytes di file.
- Mengira `File` sama dengan file yang pasti ada.
- Mengira `Path` yang sudah dinormalisasi pasti aman.
- Mengira `OutputStream.write()` berarti data sudah persisted.
- Mengira `Socket.write()` berarti remote peer sudah memproses data.
- Mengira `readAllBytes()` aman karena API-nya sederhana.
- Mengira gzip adalah file format yang sama dengan zip.
- Mengira HTTP response body otomatis aman di-memory.

Engineer yang kuat di I/O selalu bertanya:

```text
Saya sedang berada di layer mana?
Saya sedang melakukan konversi apa?
Boundary mana yang saya lintasi?
Failure apa yang mungkin terjadi di boundary itu?
Invariant apa yang harus tetap benar setelah failure?
```

---

## 6. Data, Representation, Encoding, Transport, dan Storage

Untuk topik I/O, lima kata ini harus dipisahkan.

### 6.1 Data

Data adalah informasi konseptual.

Contoh:

```text
Customer name: "Fajar"
Amount: 150000
Status: APPROVED
```

Data belum tentu punya bentuk byte tertentu.

### 6.2 Representation

Representation adalah bentuk logis data.

Contoh:

```json
{"name":"Fajar","amount":150000,"status":"APPROVED"}
```

atau binary:

```text
[version=1][amount=8 bytes][status=1 byte][name length][name bytes]
```

### 6.3 Encoding

Encoding adalah aturan mengubah representation ke bytes.

Contoh:

```text
String → UTF-8 bytes
int → 4 bytes big-endian
object graph → Java serialization stream
```

### 6.4 Transport

Transport adalah jalur perpindahan.

Contoh:

```text
file copy
TCP socket
HTTP request body
message queue payload
stdin/stdout pipe
```

### 6.5 Storage

Storage adalah tempat data menetap.

Contoh:

```text
regular file
S3 object
database BLOB/CLOB
append-only log
temporary file
memory buffer
```

### 6.6 Kenapa Pemisahan Ini Penting

Misalnya kamu membangun fitur export data ke file ZIP dan mengirimnya via HTTP.

Layer-nya:

```text
application data: daftar record
representation: CSV
encoding: UTF-8
compression/container: ZIP
transport: HTTP response body
storage sementara: temp file atau streaming pipeline
```

Jika ada bug encoding, masalahnya bukan HTTP. Jika ada bug ZIP entry name, masalahnya bukan CSV. Jika response timeout, masalahnya mungkin transport, buffer, atau client speed. Jika file corrupt, masalahnya bisa partial write, missing close, atau CRC mismatch.

Tanpa pemisahan layer, debugging menjadi tebak-tebakan.

---

## 7. Byte vs Character: Boundary Paling Sering Diremehkan

Java punya dua keluarga besar I/O klasik:

```text
byte-oriented    : InputStream / OutputStream
character-oriented: Reader / Writer
```

### 7.1 Byte-Oriented I/O

Byte-oriented I/O dipakai ketika data adalah byte mentah atau format binary.

Contoh:

- image
- PDF
- ZIP
- GZIP
- protobuf
- encrypted payload
- TCP payload sebelum decode
- file binary custom
- serialized object

API utama:

```java
InputStream
OutputStream
```

### 7.2 Character-Oriented I/O

Character-oriented I/O dipakai ketika data adalah teks.

Contoh:

- `.txt`
- `.csv`
- `.json`
- `.xml`
- `.properties`
- log file
- SQL script

API utama:

```java
Reader
Writer
```

Tetapi file teks tetap disimpan sebagai bytes. Karena itu ada bridge:

```java
InputStreamReader   // bytes → chars
OutputStreamWriter  // chars → bytes
```

Bridge ini membutuhkan charset.

### 7.3 Rule of Thumb

Gunakan aturan ini:

```text
Jika formatnya binary, tetap di byte API.
Jika formatnya teks, decode explicit menggunakan Charset.
Jangan decode sebelum tahu charset.
Jangan encode tanpa menentukan charset.
```

Contoh baik:

```java
try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    // process text
}
```

Contoh yang perlu dihindari untuk boundary eksternal:

```java
String text = new String(bytes);           // charset default
byte[] out = text.getBytes();              // charset default
```

### 7.4 Bug Khas Byte/Character Boundary

| Bug | Penyebab | Dampak |
|---|---|---|
| Teks rusak di production | Default charset berbeda | Mojibake / data corruption |
| Limit size salah | Hitung char, bukan byte | Payload melewati batas protocol |
| Emoji terpotong | Memotong bytes di tengah UTF-8 sequence | Decode error |
| CSV corrupt | Asumsi newline/quote sederhana | Record parsing salah |
| Log unreadable | Campur encoding | Observability turun |

---

## 8. Stream vs Buffer vs Channel

Ini tiga konsep yang sering tercampur.

### 8.1 Stream

Stream adalah abstraction data mengalir secara sekuensial.

```text
source → read → read → read → EOF
```

atau:

```text
write → write → write → sink
```

Stream cocok untuk:

- data sekuensial;
- file kecil sampai besar;
- network stream;
- pipeline transform;
- compression;
- encryption;
- upload/download;
- memory-safe processing.

API klasik:

```java
InputStream
OutputStream
Reader
Writer
```

Karakter penting stream:

- biasanya forward-only;
- tidak selalu bisa seek;
- `read()` bisa blocking;
- `read()` bisa return sebagian data;
- EOF punya makna khusus;
- close sangat penting;
- wrapper/decorator umum dipakai.

### 8.2 Buffer

Buffer adalah tempat sementara untuk menampung data.

Buffer menyelesaikan masalah:

```text
producer dan consumer punya ukuran/kecepatan berbeda
syscall terlalu mahal jika setiap byte langsung dikirim
network/disk bekerja lebih efisien dengan batch
```

Contoh buffer:

```java
byte[] buffer = new byte[8192];
```

atau NIO:

```java
ByteBuffer buffer = ByteBuffer.allocate(8192);
```

Buffer bukan tujuan akhir. Buffer adalah staging area.

### 8.3 Channel

Channel adalah connection ke entity I/O yang dapat membaca/menulis buffer.

Package `java.nio.channels` mendefinisikan channel untuk entities seperti file dan socket, serta selector untuk multiplexed non-blocking I/O.

Contoh:

```java
FileChannel
SocketChannel
ServerSocketChannel
DatagramChannel
```

Channel cocok untuk:

- NIO buffer-oriented I/O;
- random access file;
- transfer file efisien;
- non-blocking socket;
- selector/event-loop;
- direct buffer;
- scatter/gather I/O;
- memory-mapped file.

### 8.4 Perbedaan Mental Model

| Aspek | Stream | Channel |
|---|---|---|
| Model | Data mengalir | Entity I/O + buffer |
| API utama | `read(byte[])`, `write(byte[])` | `read(ByteBuffer)`, `write(ByteBuffer)` |
| Posisi | Umumnya sekuensial | Bisa positional untuk file |
| Non-blocking | Tidak di classic stream | Ya untuk selectable channels |
| Buffer | `byte[]` atau wrapper buffered | `ByteBuffer` |
| Use case kuat | Sederhana, pipeline, compatibility | High-performance, selector, random access |

### 8.5 Jangan Salah Menganggap Channel Selalu Lebih Cepat

NIO bukan magic. `FileChannel` atau `ByteBuffer.allocateDirect()` tidak otomatis membuat semua I/O lebih cepat.

Kinerja bergantung pada:

- ukuran data;
- access pattern;
- buffer size;
- disk/network speed;
- page cache;
- syscall count;
- GC pressure;
- thread model;
- apakah bottleneck di CPU, disk, network, remote peer, atau protocol.

Untuk banyak aplikasi enterprise, blocking I/O yang benar, buffered, dan streaming sering cukup. NIO menjadi penting ketika kamu butuh kontrol lebih besar, misalnya non-blocking socket multiplexing, transfer besar, atau file random access.

---

## 9. Blocking, Non-Blocking, Async, dan Virtual Thread

I/O model harus dipilih berdasarkan concurrency dan complexity, bukan sekadar trend.

### 9.1 Blocking I/O

Blocking I/O berarti thread menunggu sampai operasi selesai atau gagal.

Contoh:

```java
int n = inputStream.read(buffer); // thread bisa menunggu
```

Kelebihan:

- kode sederhana;
- mudah dibaca;
- mudah dipadukan dengan try-with-resources;
- cocok untuk file I/O biasa;
- cocok dengan virtual threads untuk banyak operasi blocking.

Kekurangan:

- platform thread mahal jika jumlah connection sangat banyak;
- thread bisa habis jika timeout buruk;
- perlu bounded executor atau virtual thread;
- blocking di thread yang salah bisa fatal, misalnya event loop.

### 9.2 Non-Blocking I/O

Non-blocking I/O berarti operasi tidak menunggu data jika belum tersedia.

Contoh di `SocketChannel` non-blocking:

```java
int n = channel.read(buffer); // bisa return 0
```

Kelebihan:

- satu thread bisa handle banyak connection;
- cocok untuk event loop;
- cocok untuk high-concurrency socket server.

Kekurangan:

- kode lebih kompleks;
- perlu state machine per connection;
- partial read/write harus ditangani;
- fairness dan backpressure lebih sulit;
- bug bisa subtle.

### 9.3 Async I/O

Async I/O berarti request operasi dikirim, hasilnya datang nanti via callback/future/completion.

Java punya API seperti:

```java
AsynchronousFileChannel
AsynchronousSocketChannel
```

Namun async bukan berarti tanpa thread atau tanpa bottleneck. Di banyak OS/runtime, implementasi bisa tetap memakai thread pool internal atau mekanisme OS tertentu.

### 9.4 Virtual Thread

Virtual thread membuat blocking style jauh lebih scalable dibanding platform thread untuk banyak workload I/O-bound.

Mental model-nya:

```text
tetap blocking secara kode,
tetapi lebih murah secara scheduling jika operasi blocking didukung runtime.
```

Ini membuat banyak kasus yang dulu dipaksa memakai callback/non-blocking bisa kembali ditulis secara sekuensial.

Namun virtual thread bukan pengganti semua NIO:

- tidak menghapus kebutuhan timeout;
- tidak menghapus kebutuhan backpressure;
- tidak menghapus partial read/write semantics;
- tidak memperbaiki protocol design buruk;
- tidak membuat disk/network lebih cepat;
- tidak menggantikan event-loop framework yang sudah punya model sendiri.

### 9.5 Decision Matrix Awal

| Situasi | Model yang Umumnya Cocok |
|---|---|
| Baca/tulis file sederhana | Blocking + `Files`/stream |
| Processing file besar line-by-line | Blocking streaming + buffer |
| Banyak HTTP call eksternal | HTTP client + timeout + executor/virtual thread |
| Banyak socket custom concurrent | NIO selector atau framework seperti Netty |
| Kode server sederhana I/O-bound | Blocking + virtual thread dapat sangat menarik |
| Low-level protocol event-driven | NIO selector/event loop |
| Random access file besar | `FileChannel` / mmap tergantung pattern |
| Transfer file besar | `FileChannel.transferTo/transferFrom`, streaming, atau HTTP range |

---

## 10. Resource Lifecycle: Siapa Membuka, Siapa Menutup

I/O selalu menyentuh resource eksternal.

Resource bisa berupa:

- file descriptor;
- socket descriptor;
- native memory;
- file lock;
- directory stream;
- HTTP response body stream;
- mapped memory;
- compression stream;
- object stream;
- process pipe.

Garbage collector mengelola Java object memory, tetapi tidak boleh dijadikan strategi utama untuk menutup resource eksternal.

### 10.1 Rule Dasar Ownership

```text
Yang membuka resource biasanya bertanggung jawab menutupnya.
Yang menerima resource sebagai parameter harus jelas: apakah hanya memakai atau mengambil ownership?
```

Contoh ambigu:

```java
void upload(InputStream input) throws IOException {
    try (input) {
        // send input
    }
}
```

Method ini menutup stream yang diberikan caller. Itu bisa benar, bisa juga mengejutkan.

Lebih eksplisit:

```java
void uploadAndClose(InputStream input) throws IOException {
    try (input) {
        // send input
    }
}
```

atau:

```java
void upload(InputStream input) throws IOException {
    // caller owns input; do not close here
}
```

### 10.2 Wrapper Stream dan Close Propagation

Banyak stream Java memakai decorator pattern.

```java
try (InputStream in = new BufferedInputStream(new FileInputStream(path.toFile()))) {
    // use in
}
```

Menutup wrapper biasanya menutup underlying stream. Ini penting.

Contoh:

```java
OutputStream out = new FileOutputStream("out.gz");
GZIPOutputStream gzip = new GZIPOutputStream(out);
gzip.write(data);
out.close(); // salah urutan / berisiko
```

Untuk compression stream, `close()` wrapper sering perlu menulis trailer/final bytes. Menutup underlying stream dulu bisa membuat output corrupt.

Pola benar:

```java
try (GZIPOutputStream gzip = new GZIPOutputStream(new FileOutputStream("out.gz"))) {
    gzip.write(data);
}
```

### 10.3 Flush vs Close vs Force

Tiga konsep ini berbeda.

| Operasi | Makna |
|---|---|
| `flush()` | Mendorong buffered data dari wrapper/user-space ke bawahnya |
| `close()` | Menutup resource, biasanya flush final data juga |
| `FileChannel.force()` | Meminta data/metadata dipaksa ke storage device |

`flush()` tidak selalu berarti data durable di disk.

`write()` tidak selalu berarti data sudah sampai remote application.

`close()` tidak selalu berarti remote peer berhasil memproses data.

---

## 11. Partial Read dan Partial Write: Invariant Wajib I/O

Salah satu invariant paling penting:

```text
I/O operation tidak wajib menyelesaikan seluruh request dalam satu call.
```

### 11.1 Partial Read

`InputStream.read(byte[])` mengembalikan jumlah byte yang benar-benar dibaca, atau `-1` jika EOF.

Contoh salah:

```java
byte[] header = new byte[16];
in.read(header); // salah: belum tentu 16 byte terisi
parseHeader(header);
```

Contoh lebih benar:

```java
byte[] header = in.readNBytes(16);
if (header.length != 16) {
    throw new EOFException("Expected 16-byte header but got " + header.length);
}
parseHeader(header);
```

Atau loop manual:

```java
static void readFully(InputStream in, byte[] buffer) throws IOException {
    int offset = 0;
    while (offset < buffer.length) {
        int n = in.read(buffer, offset, buffer.length - offset);
        if (n == -1) {
            throw new EOFException("Unexpected EOF after " + offset + " bytes");
        }
        offset += n;
    }
}
```

### 11.2 Partial Write

Di classic blocking `OutputStream`, `write(byte[])` biasanya mencoba menulis semua atau throw exception. Tetapi di channel, terutama non-blocking channel, `write(ByteBuffer)` bisa menulis sebagian atau nol.

Contoh konsep:

```java
while (buffer.hasRemaining()) {
    channel.write(buffer);
}
```

Untuk non-blocking socket, loop seperti itu bisa menjadi busy spin jika `write()` return 0. Perlu register interest `OP_WRITE` dan lanjut saat channel ready.

### 11.3 EOF Bukan Error Selalu

EOF berarti sumber data selesai.

EOF normal:

```text
membaca file sampai akhir
```

EOF abnormal:

```text
sedang membaca frame length 1 MB, tetapi stream selesai setelah 200 KB
```

Jadi EOF hanya bisa diinterpretasi berdasarkan protocol/context.

---

## 12. Boundedness: Jangan Percaya Input Tidak Terbatas

I/O selalu berpotensi menerima data yang lebih besar dari ekspektasi.

Contoh API yang perlu hati-hati:

```java
readAllBytes()
readString()
readAllLines()
ByteArrayOutputStream tanpa limit
StringBuilder tanpa limit
ObjectInputStream dari sumber eksternal
ZipInputStream extract tanpa limit
```

Bukan berarti API itu buruk. API itu cocok jika ukuran data benar-benar bounded dan dipercaya.

### 12.1 Pertanyaan Wajib Sebelum Load-All

Sebelum memakai load-all, tanyakan:

1. Berapa ukuran maksimum input?
2. Siapa yang mengontrol input?
3. Apakah input bisa berasal dari user/external system?
4. Apa yang terjadi jika input 10x lebih besar?
5. Apakah ada limit di protocol?
6. Apakah ada timeout?
7. Apakah memory cukup jika request paralel?

Contoh:

```java
byte[] body = requestInputStream.readAllBytes();
```

Jika satu request 100 MB dan ada 200 concurrent request, potensi heap pressure sangat besar.

### 12.2 Bounded Streaming Pattern

Pola lebih aman:

```java
static long copyWithLimit(InputStream in, OutputStream out, long maxBytes) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;

    while (true) {
        int n = in.read(buffer);
        if (n == -1) {
            return total;
        }

        total += n;
        if (total > maxBytes) {
            throw new IOException("Input exceeds limit: " + maxBytes + " bytes");
        }

        out.write(buffer, 0, n);
    }
}
```

Invariant:

```text
Memory usage tetap bounded walaupun input besar.
```

---

## 13. Backpressure: Ketika Producer Lebih Cepat dari Consumer

Backpressure adalah kemampuan sistem untuk memperlambat producer ketika consumer tidak mampu mengikuti.

Dalam I/O, backpressure muncul di mana-mana:

```text
fast disk → slow network
fast network → slow parser
fast producer thread → slow file writer
fast decompressor → slow database insert
fast HTTP upload → slow virus scanner
```

Tanpa backpressure, sistem biasanya mengganti masalah latency menjadi masalah memory.

Contoh buruk:

```java
List<byte[]> chunks = new ArrayList<>();
while ((n = in.read(buffer)) != -1) {
    chunks.add(Arrays.copyOf(buffer, n));
}
```

Ini menyerap seluruh input ke memory.

Contoh lebih sehat:

```java
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

Tetapi ini pun hanya sehat jika `out.write` memberi tekanan balik natural. Jika producer dan consumer dipisah queue, queue harus bounded.

### 13.1 Queue Tidak Bounded = Memory Leak Terstruktur

```java
BlockingQueue<byte[]> queue = new LinkedBlockingQueue<>(); // unbounded
```

Jika reader lebih cepat daripada writer, queue akan tumbuh sampai memory habis.

Lebih aman:

```java
BlockingQueue<byte[]> queue = new ArrayBlockingQueue<>(100);
```

Invariant:

```text
Jumlah data in-flight harus punya batas.
```

---

## 14. Durability vs Visibility vs Acknowledgement

Tiga hal ini sering disamakan padahal berbeda.

### 14.1 Visibility

Data terlihat oleh pembaca.

Contoh:

```text
file path sudah ada
bytes bisa dibaca dari page cache
HTTP response sudah mulai dikirim
```

### 14.2 Durability

Data tetap ada setelah crash/power loss.

Contoh:

```text
file data sudah dipaksa ke storage device
metadata directory juga aman
```

### 14.3 Acknowledgement

Pihak lain mengonfirmasi menerima/memproses data.

Contoh:

```text
server mengirim HTTP 200
receiver mengirim ACK application-level
manifest final diterima
```

### 14.4 Contoh Perbedaan

```java
Files.writeString(path, content);
```

Setelah method return:

- file kemungkinan terlihat;
- data kemungkinan ada di OS page cache;
- belum tentu sudah durable terhadap crash;
- belum tentu pembaca lain melihat versi konsisten jika write langsung ke final path.

Untuk data penting:

```text
write temp → force file → atomic move → force directory jika perlu → publish
```

---

## 15. Java API Map: Kapan Pakai Apa

### 15.1 `java.io`

Gunakan ketika:

- bekerja dengan API/library lama;
- membutuhkan stream decorator;
- melakukan compression/encryption streaming;
- membaca/menulis data sekuensial;
- berinteraksi dengan socket classic;
- memakai serialization;
- butuh adapter ke banyak framework.

Contoh abstraction:

```java
InputStream
OutputStream
Reader
Writer
BufferedInputStream
BufferedReader
DataInputStream
ObjectInputStream
```

Kekuatan:

- sederhana;
- composable;
- kompatibilitas luas;
- cocok untuk pipeline.

Kelemahan:

- tidak ideal untuk random access;
- tidak punya non-blocking selector model;
- raw `File` API lama punya banyak caveat;
- default charset overload historis bisa menyesatkan.

### 15.2 `java.nio`

Gunakan ketika:

- perlu buffer model eksplisit;
- perlu direct buffer;
- perlu encoding/decoding eksplisit;
- perlu byte order;
- perlu view buffer.

Contoh:

```java
ByteBuffer
CharBuffer
Charset
CharsetEncoder
CharsetDecoder
```

Kekuatan:

- kontrol lebih rendah;
- cocok untuk binary protocol;
- cocok dengan channel;
- penting untuk high-performance I/O.

Kelemahan:

- stateful buffer rawan bug;
- `flip/clear/compact` harus dipahami;
- readability bisa turun jika dipakai berlebihan.

### 15.3 `java.nio.channels`

Gunakan ketika:

- perlu file channel;
- perlu socket channel;
- perlu non-blocking I/O;
- perlu selector;
- perlu transfer file efisien;
- perlu random access;
- perlu file lock;
- perlu memory-mapped file.

Contoh:

```java
FileChannel
SocketChannel
ServerSocketChannel
Selector
SelectionKey
```

Kekuatan:

- advanced I/O control;
- mendukung multiplexing;
- bagus untuk low-level network server;
- bagus untuk file besar/random access.

Kelemahan:

- complexity tinggi;
- partial read/write harus explicit;
- non-blocking design butuh state machine.

### 15.4 `java.nio.file`

Gunakan untuk operasi filesystem modern.

Contoh:

```java
Path
Files
FileSystem
FileSystems
FileStore
WatchService
```

Kekuatan:

- API modern;
- mendukung filesystem provider;
- operasi copy/move/delete/list/walk;
- attribute/permission lebih baik;
- path abstraction lebih jelas daripada `File` lama.

Kelemahan:

- tetap perlu paham cross-platform semantics;
- `Files.exists` bisa false karena permission/error;
- symlink dan TOCTOU tetap harus dikelola.

### 15.5 `java.net`

Gunakan untuk networking low-level.

Contoh:

```java
Socket
ServerSocket
DatagramSocket
InetAddress
URI
URL
```

Kekuatan:

- kontrol socket;
- TCP/UDP low-level;
- addressing/network interface.

Kelemahan:

- protocol harus kamu desain sendiri;
- raw socket mudah salah framing;
- timeout/close/retry harus kamu desain.

### 15.6 `java.net.http`

Gunakan untuk HTTP client modern.

Contoh:

```java
HttpClient
HttpRequest
HttpResponse
```

Kekuatan:

- standard sejak Java 11;
- HTTP/1.1 dan HTTP/2;
- synchronous/asynchronous style;
- body publisher/handler;
- TLS/proxy/redirect support.

Kelemahan:

- bukan server framework;
- tetap perlu mengatur timeout, body size, retry semantics;
- streaming body perlu lifecycle benar.

---

## 16. Classic I/O Decorator Model

Classic Java I/O banyak memakai decorator pattern.

Contoh:

```java
InputStream raw = new FileInputStream("data.gz");
InputStream buffered = new BufferedInputStream(raw);
InputStream gzip = new GZIPInputStream(buffered);
```

Setiap layer menambah behavior:

```text
FileInputStream       : baca byte dari file
BufferedInputStream   : buffering agar syscall tidak terlalu sering
GZIPInputStream       : decompress gzip stream
```

Versi try-with-resources:

```java
try (InputStream in = new GZIPInputStream(
        new BufferedInputStream(
            new FileInputStream("data.gz")))) {
    // read decompressed bytes
}
```

Urutan wrapper penting.

Misalnya:

```text
file → buffer → gzip → application
```

Berbeda dengan:

```text
file → gzip → buffer → application
```

Keduanya bisa valid tergantung tujuan, tetapi efek buffering dan transform bisa berbeda.

### 16.1 Pipeline Thinking

Stream decorator bisa dipahami sebagai pipeline:

```text
Source bytes
  → buffering
  → decompression
  → decoding UTF-8
  → line reading
  → application records
```

Dalam Java:

```java
try (BufferedReader reader = new BufferedReader(
        new InputStreamReader(
            new GZIPInputStream(
                new BufferedInputStream(
                    new FileInputStream("records.csv.gz"))),
            StandardCharsets.UTF_8))) {

    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Layer-nya:

```text
FileInputStream        : file bytes
BufferedInputStream    : efficient byte reads
GZIPInputStream        : decompressed bytes
InputStreamReader      : bytes → chars
BufferedReader         : efficient text/line reads
Application            : line records
```

Ini adalah contoh penting: satu operasi “baca file” sebenarnya melewati beberapa representation boundary.

---

## 17. Buffer sebagai State Machine

Buffer bukan hanya array. Buffer punya state.

Untuk `byte[]`, state biasanya manual:

```java
byte[] buffer = new byte[8192];
int n = in.read(buffer);
out.write(buffer, 0, n);
```

State ada di variabel `n`.

Untuk `ByteBuffer`, state ada di object:

```text
capacity : total ukuran buffer
position : indeks operasi berikutnya
limit    : batas operasi saat ini
```

NIO buffer workflow umum:

```text
clear()       → siap ditulis dari channel ke buffer
channel.read  → position bergerak maju
flip()        → siap dibaca dari buffer
consume       → position bergerak maju
compact()     → simpan sisa unread, siap baca lagi
```

Bug umum:

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);
channel.read(buffer);
channel.write(buffer); // salah: lupa flip
```

Setelah `read`, position ada di akhir data. Untuk membaca dari buffer, perlu `flip()`.

Konsep ini akan dibahas mendalam di part NIO, tetapi sejak awal harus diingat:

```text
ByteBuffer adalah state machine kecil.
Jika state transition salah, data bisa hilang, kosong, terduplikasi, atau infinite loop.
```

---

## 18. File Bukan Sekadar Path String

Di Java modern, path direpresentasikan dengan `Path`, bukan sekadar `String`.

```java
Path path = Path.of("data", "input.csv");
```

Tetapi `Path` juga bukan file itu sendiri. `Path` adalah representasi lokasi.

Perbedaan:

| Konsep | Makna |
|---|---|
| `String` | teks path, belum tentu valid |
| `Path` | representasi path dalam filesystem tertentu |
| File | entity di filesystem, bisa ada/tidak ada |
| File descriptor/channel | handle terbuka ke file/entity |
| File attributes | metadata file |
| FileStore | storage tempat file berada |
| FileSystem | namespace filesystem |

### 18.1 Path Bisa Menipu

Contoh:

```java
Path p = Path.of("/safe/base/../secret.txt");
```

Normalize:

```java
Path normalized = p.normalize();
```

Tetapi normalize hanya operasi lexical. Ia tidak selalu resolve symlink. Untuk security, sering perlu `toRealPath`, base directory check, dan `NOFOLLOW_LINKS` tergantung kasus.

### 18.2 File Check Race

Contoh buruk:

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Antara check dan delete, file bisa berubah. Ini disebut TOCTOU: time-of-check to time-of-use.

Lebih baik sering kali langsung lakukan operasi dan handle exception:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException ignored) {
    // already absent
}
```

### 18.3 `Files.exists` Tidak Sederhana

`Files.exists(path)` bisa false jika file tidak ada, tetapi juga bisa false jika existence tidak dapat ditentukan karena permission/error tertentu. Karena itu untuk security atau correctness tinggi, jangan menjadikan `exists` sebagai satu-satunya sumber kebenaran.

---

## 19. Network Bukan File yang Jauh

Socket sering terlihat seperti stream biasa karena Java memberi `InputStream` dan `OutputStream` dari `Socket`.

```java
Socket socket = new Socket(host, port);
InputStream in = socket.getInputStream();
OutputStream out = socket.getOutputStream();
```

Tapi socket bukan file.

Perbedaan penting:

| Aspek | File | Socket |
|---|---|---|
| Akhir data | EOF saat file habis | EOF saat peer close output |
| Latency | relatif lokal | network-dependent |
| Partial read | ya | sangat umum |
| Timeout | biasanya tidak sama | wajib dipikirkan |
| Retry | baca file bisa diulang jika seekable | network retry bisa duplicate |
| Ordering | file offset jelas | TCP ordered stream, tetapi bukan message |
| Failure | disk/permission/full | reset, timeout, half-open, DNS, TLS, peer slow |

### 19.1 TCP adalah Byte Stream

TCP tidak tahu message aplikasi.

Jika client melakukan:

```text
write("HELLO")
write("WORLD")
```

Server bisa membaca:

```text
"HELLOWORLD"
```

atau:

```text
"HE"
"LLOW"
"ORLD"
```

Semua valid.

Karena itu protocol butuh framing:

```text
length-prefix
newline-delimited
fixed-size frame
header/body
chunked transfer
```

### 19.2 Timeout adalah Bagian dari Protocol

Tanpa timeout, thread bisa menunggu selamanya.

Tetapi timeout terlalu kecil juga bisa memutus request valid.

Timeout harus dipahami sebagai:

```text
policy keputusan bisnis/operasional, bukan angka random
```

Pertanyaan:

- Berapa SLA remote service?
- Apakah operasi idempotent?
- Apakah retry aman?
- Apakah partial response bisa dipakai?
- Apa yang terjadi pada server jika client timeout?

---

## 20. Serialization adalah Format, Bukan Magic

Java Serialization sering terlihat seperti magic:

```java
objectOutputStream.writeObject(user);
User user = (User) objectInputStream.readObject();
```

Tetapi sebenarnya itu format binary dengan aturan khusus:

- menyimpan object graph;
- menjaga object identity dalam stream;
- menangani reference sharing;
- punya class descriptor;
- memakai `serialVersionUID`;
- bisa memanggil callback seperti `readObject`, `writeObject`, `readResolve`, `writeReplace`;
- punya risiko security besar jika input tidak trusted.

### 20.1 Serialization Boundary

Serialization berarti:

```text
object graph → bytes
bytes → object graph
```

Boundary ini berbahaya karena saat deserialize, program bukan hanya membaca data; ia bisa mengaktifkan mekanisme class loading, constructor-like behavior, callback serialization, validation, dan object graph reconstruction.

Rule awal:

```text
Native Java serialization jangan dipakai untuk boundary eksternal tanpa alasan kuat, filter ketat, dan threat model.
```

Untuk boundary antar-service modern, pertimbangkan:

- JSON untuk readability;
- Protobuf untuk schema/binary compact;
- Avro untuk schema evolution;
- CBOR/MessagePack untuk binary structured data;
- custom binary jika benar-benar butuh kontrol penuh.

---

## 21. Compression adalah Transform Stream

Compression bukan sekadar “mengecilkan file”. Compression adalah transformasi stream.

```text
original bytes → compressor → compressed bytes
compressed bytes → decompressor → original bytes
```

Java menyediakan `java.util.zip` untuk ZIP, GZIP, Deflater, dan Inflater.

### 21.1 GZIP vs ZIP

GZIP:

```text
satu compressed data stream
cocok untuk compress satu stream/file
```

ZIP:

```text
container berisi banyak entry
punya metadata per entry
punya central directory
```

### 21.2 Compression Failure Mode

- output corrupt jika stream tidak ditutup dengan benar;
- zip slip saat extract path berbahaya;
- zip bomb menyebabkan resource exhaustion;
- decompressed size jauh lebih besar dari compressed size;
- CRC mismatch;
- partial download compressed file tidak bisa langsung dibaca penuh;
- compression meningkatkan CPU usage;
- compression bisa memperburuk latency untuk payload kecil.

### 21.3 Compression dan Security

Jangan extract ZIP tanpa validasi entry path.

Bahaya:

```text
../../../../etc/passwd
```

atau:

```text
safe-dir/../../evil.sh
```

Invariant safe extraction:

```text
Setelah resolve dan normalize, target final harus tetap berada di base extraction directory.
```

---

## 22. Data Transfer adalah State Machine

Transfer data production-grade jarang cukup dengan:

```java
in.transferTo(out);
```

Untuk file kecil trusted, itu cukup. Untuk data penting, transfer adalah state machine.

Contoh state machine transfer file:

```text
NEW
  → PREPARING
  → TRANSFERRING
  → VERIFYING
  → COMMITTING
  → COMPLETED
  → FAILED
  → RETRY_SCHEDULED
  → CANCELLED
```

### 22.1 Kenapa Transfer Butuh State

Karena failure bisa terjadi di banyak titik:

- source tidak tersedia;
- permission denied;
- DNS failure;
- connection timeout;
- read timeout;
- write timeout;
- partial upload;
- remote server menerima data tapi response hilang;
- checksum mismatch;
- disk full;
- process crash sebelum final rename;
- duplicate retry;
- manifest sudah publish tetapi file belum lengkap;
- consumer membaca sebelum producer selesai.

### 22.2 Invariant Transfer

Beberapa invariant penting:

```text
File final tidak boleh terlihat sebelum lengkap.
Checksum final harus cocok.
Retry tidak boleh menghasilkan duplicate final object.
State COMPLETED hanya boleh dicapai setelah verify sukses.
Consumer hanya membaca object committed.
Partial data harus bisa dibersihkan atau dilanjutkan.
```

### 22.3 Exactly-Once Myth

Dalam distributed data transfer, “exactly once” sering misleading.

Yang bisa kita desain biasanya:

```text
at-least-once transfer + idempotent commit + deduplication
```

atau:

```text
at-most-once attempt + reconciliation
```

Dengan kata lain, correctness bukan muncul dari tidak pernah retry. Correctness muncul dari idempotency, identity, checksum, manifest, dan finalization protocol.

---

## 23. Failure Model Besar Java I/O

Berikut taxonomy failure yang harus selalu ada di kepala saat mendesain I/O.

### 23.1 File Failure

| Failure | Contoh | Mitigasi |
|---|---|---|
| File not found | source hilang | explicit handling, retry/reconciliation |
| Permission denied | user/process tidak punya akses | permission design, fail-fast |
| Disk full | write gagal di tengah | temp file, cleanup, alert |
| Partial write | process mati | atomic write pattern |
| File locked | OS/process lain lock | retry/backoff, lock strategy |
| Symlink attack | path diarahkan keluar base | real path validation |
| Metadata mismatch | modified time/size berubah | re-stat, checksum |
| Network filesystem inconsistency | NFS/SMB behavior | conservative assumptions |

### 23.2 Stream Failure

| Failure | Contoh | Mitigasi |
|---|---|---|
| EOF normal | file selesai | loop benar |
| Unexpected EOF | frame belum lengkap | readFully + protocol validation |
| Short read | read sebagian | respect return value |
| Short write | channel write sebagian | loop/state machine |
| Blocking forever | peer diam | timeout |
| Resource leak | stream tidak close | try-with-resources |
| Buffer misuse | proses stale bytes | use count/limit correctly |

### 23.3 Network Failure

| Failure | Contoh | Mitigasi |
|---|---|---|
| DNS failure | hostname tidak resolve | retry policy, fallback |
| Connect timeout | remote unreachable | timeout, circuit breaker |
| Read timeout | peer lambat | deadline, abort |
| Connection reset | peer close paksa | retry if safe |
| Half-open | koneksi mati tanpa terdeteksi | heartbeat/timeout |
| Partial request | upload putus | resumable/chunked protocol |
| Duplicate request | retry setelah response hilang | idempotency key |
| TLS failure | cert expired/hostname mismatch | truststore management |

### 23.4 Data Failure

| Failure | Contoh | Mitigasi |
|---|---|---|
| Charset mismatch | teks rusak | explicit charset |
| Corruption | bytes berubah | checksum/hash |
| Truncation | file tidak lengkap | length + checksum |
| Schema mismatch | versi data berubah | versioned format |
| Invalid frame | length salah | max size + validation |
| Malicious payload | zip bomb/deserialization | limits + filters + allowlist |

---

## 24. Decision Tree Awal

Gunakan decision tree ini sebelum memilih API.

### 24.1 Apakah Data Teks atau Binary?

```text
Jika binary:
  gunakan InputStream/OutputStream atau Channel/ByteBuffer.
  jangan konversi ke String.

Jika teks:
  tentukan Charset eksplisit.
  gunakan Reader/Writer atau Files dengan charset.
```

### 24.2 Apakah Ukuran Data Bounded dan Kecil?

```text
Jika kecil dan trusted:
  readAllBytes/readString bisa diterima.

Jika besar/tidak trusted:
  streaming + limit + timeout + checksum bila perlu.
```

### 24.3 Apakah Butuh Random Access?

```text
Jika sequential:
  stream cukup.

Jika random access:
  FileChannel atau SeekableByteChannel.
```

### 24.4 Apakah Banyak Connection Concurrent?

```text
Jika jumlah kecil/menengah:
  blocking I/O + thread/virtual thread.

Jika sangat besar/custom protocol/event-driven:
  NIO Selector atau framework event loop.
```

### 24.5 Apakah File Final Harus Konsisten?

```text
Jika boleh overwrite sederhana:
  Files.write bisa cukup.

Jika pembaca tidak boleh melihat partial file:
  temp file + force + atomic move.
```

### 24.6 Apakah Transfer Bisa Di-retry?

```text
Jika operasi idempotent:
  retry dengan backoff bisa aman.

Jika tidak idempotent:
  butuh idempotency key, transaction id, manifest, atau deduplication.
```

---

## 25. Production Design Principles

### 25.1 Make Boundaries Explicit

Jangan sembunyikan encoding, compression, serialization, dan protocol boundary.

Buruk:

```java
byte[] bytes = text.getBytes();
```

Lebih baik:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
```

Buruk:

```java
Object obj = new ObjectInputStream(in).readObject();
```

Lebih baik:

```text
Gunakan format schema-based atau ObjectInputFilter jika memang harus Java serialization.
```

### 25.2 Preserve Counts and Limits

Setiap operasi read harus menghormati jumlah byte/char aktual.

```java
int n = in.read(buffer);
if (n > 0) {
    out.write(buffer, 0, n);
}
```

Setiap operasi terhadap input eksternal harus punya batas:

```text
max bytes
max records
max line length
max frame size
max decompressed size
max entries
max nesting/depth jika format mendukung nesting
```

### 25.3 Separate Staging and Committed State

Untuk file atau transfer penting:

```text
staging area ≠ committed area
partial object ≠ final object
```

Contoh:

```text
uploads/tmp/{transferId}.part
uploads/final/{documentId}.pdf
```

Final path hanya muncul setelah verify/commit.

### 25.4 Design for Cancellation and Cleanup

I/O panjang harus bisa gagal bersih.

Pertanyaan:

- Jika transfer dibatalkan, file `.part` dihapus atau disimpan untuk resume?
- Jika process crash, siapa yang membersihkan staging lama?
- Jika checksum mismatch, apakah data disimpan untuk forensic atau dihapus?
- Jika retry berjalan paralel, siapa yang menang?

### 25.5 Observability Is Part of I/O Design

Untuk data transfer, minimal metric:

```text
bytes read
bytes written
records processed
duration
throughput bytes/sec
error count by type
retry count
timeout count
checksum mismatch count
partial cleanup count
queue depth
in-flight transfers
```

Log penting:

```text
transferId
source
target
size
checksum
state transition
attempt number
failure reason
duration
```

Tracing penting jika I/O melewati service boundary.

---

## 26. Code Walkthrough: Copy dengan Mental Model yang Benar

### 26.1 Versi Sederhana

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Ini bagus untuk banyak kasus sederhana.

Tetapi pertanyaan production:

- apakah target boleh terlihat saat copy berlangsung?
- apakah target lama boleh hilang jika copy gagal?
- apakah source dan target di filesystem sama?
- apakah perlu preserve attributes?
- apakah perlu verify checksum?
- apakah perlu cleanup jika gagal?

### 26.2 Versi Streaming Manual dengan Limit dan Checksum

```java
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class SafeCopyExample {

    private static final int BUFFER_SIZE = 64 * 1024;

    public static CopyResult copyWithLimitAndSha256(
            Path source,
            Path target,
            long maxBytes
    ) throws IOException, NoSuchAlgorithmException {

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;

        try (InputStream rawIn = Files.newInputStream(source);
             DigestInputStream in = new DigestInputStream(rawIn, digest);
             OutputStream out = Files.newOutputStream(target)) {

            byte[] buffer = new byte[BUFFER_SIZE];

            while (true) {
                int n = in.read(buffer);
                if (n == -1) {
                    break;
                }

                total += n;
                if (total > maxBytes) {
                    throw new IOException("Copy exceeds limit: " + maxBytes + " bytes");
                }

                out.write(buffer, 0, n);
            }
        }

        String sha256 = HexFormat.of().formatHex(digest.digest());
        return new CopyResult(total, sha256);
    }

    public record CopyResult(long bytesCopied, String sha256) {}
}
```

Apa yang sudah benar:

- streaming, tidak load seluruh file;
- buffer bounded;
- menghormati jumlah byte aktual `n`;
- limit ukuran;
- checksum;
- resource ditutup dengan try-with-resources.

Apa yang belum cukup untuk beberapa kasus:

- target ditulis langsung, bukan atomic publish;
- belum `force` ke disk;
- belum cleanup target jika gagal;
- belum handle symlink/path security;
- belum preserve attribute;
- belum retry;
- belum state machine transfer.

### 26.3 Versi Atomic Publish Konseptual

```java
Path target = Path.of("export/final/report.csv");
Path directory = target.getParent();
Path temp = Files.createTempFile(directory, ".report-", ".tmp");

try {
    writeContent(temp);

    // For stronger durability, open FileChannel and force data.
    // Then atomically move temp to final if same filesystem supports it.
    Files.move(
            temp,
            target,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE
    );
} catch (Exception e) {
    try {
        Files.deleteIfExists(temp);
    } catch (IOException cleanupError) {
        e.addSuppressed(cleanupError);
    }
    throw e;
}
```

Invariant:

```text
target final tidak terlihat sebagai file setengah jadi.
```

Catatan: `ATOMIC_MOVE` bergantung dukungan filesystem dan biasanya mensyaratkan source-target berada dalam filesystem yang sama.

---

## 27. Code Walkthrough: Framing TCP Sederhana

Misalnya kita ingin mengirim message binary melalui stream.

Protocol:

```text
[4 bytes big-endian length][payload bytes]
```

### 27.1 Writer

```java
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.OutputStream;

public final class FrameWriter {

    private final DataOutputStream out;
    private final int maxFrameSize;

    public FrameWriter(OutputStream outputStream, int maxFrameSize) {
        this.out = new DataOutputStream(outputStream);
        this.maxFrameSize = maxFrameSize;
    }

    public void writeFrame(byte[] payload) throws IOException {
        if (payload.length > maxFrameSize) {
            throw new IOException("Frame too large: " + payload.length);
        }

        out.writeInt(payload.length);
        out.write(payload);
        out.flush();
    }
}
```

### 27.2 Reader

```java
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;

public final class FrameReader {

    private final DataInputStream in;
    private final int maxFrameSize;

    public FrameReader(InputStream inputStream, int maxFrameSize) {
        this.in = new DataInputStream(inputStream);
        this.maxFrameSize = maxFrameSize;
    }

    public byte[] readFrame() throws IOException {
        int length;
        try {
            length = in.readInt();
        } catch (EOFException eof) {
            return null; // clean EOF before a new frame starts
        }

        if (length < 0 || length > maxFrameSize) {
            throw new IOException("Invalid frame length: " + length);
        }

        byte[] payload = new byte[length];
        in.readFully(payload);
        return payload;
    }
}
```

Apa yang diajarkan contoh ini:

- TCP butuh framing;
- length harus divalidasi;
- payload harus dibaca penuh;
- EOF sebelum frame dimulai bisa normal;
- EOF di tengah frame adalah error;
- max frame size wajib untuk mencegah memory abuse.

---

## 28. Anti-Pattern yang Akan Sering Kita Lawan di Seri Ini

### 28.1 Membaca Semua Data Tanpa Limit

```java
byte[] bytes = input.readAllBytes();
```

Boleh jika input kecil dan trusted. Berbahaya jika input eksternal.

### 28.2 Mengabaikan Return Value `read`

```java
in.read(buffer);
out.write(buffer);
```

Harusnya:

```java
int n = in.read(buffer);
if (n != -1) {
    out.write(buffer, 0, n);
}
```

### 28.3 Charset Default

```java
new String(bytes);
text.getBytes();
new FileReader(file);
new FileWriter(file);
```

Untuk boundary serius, pakai charset eksplisit.

### 28.4 File Final Ditulis Langsung

```java
Files.writeString(finalPath, content);
```

Untuk file yang harus konsisten, gunakan temp + atomic move.

### 28.5 Menganggap `flush` Sama Dengan Durable

```java
writer.flush();
```

Flush bukan fsync.

### 28.6 Menganggap TCP Punya Message Boundary

```java
in.read(buffer); // dianggap satu message
```

Harus ada framing.

### 28.7 Unbounded Queue antara Reader dan Writer

```java
new LinkedBlockingQueue<>()
```

Tanpa capacity, queue bisa menjadi memory sink.

### 28.8 Deserialization dari Input Tidak Trusted

```java
new ObjectInputStream(socket.getInputStream()).readObject();
```

Ini high-risk.

### 28.9 Extract ZIP Tanpa Validasi Path

```java
Path output = targetDir.resolve(entry.getName());
Files.copy(zip, output);
```

Raw entry name bisa mengandung traversal.

### 28.10 Logging Sensitive Payload

```java
log.info("Request body: {}", body);
```

I/O sering membawa PII, token, credential, document, atau regulated data.

---

## 29. Checklist Mental Sebelum Menulis Kode I/O

Gunakan checklist ini sebelum implementasi.

### 29.1 Data and Format

- [ ] Apakah data binary atau text?
- [ ] Jika text, charset apa?
- [ ] Apakah format punya version?
- [ ] Apakah format punya schema?
- [ ] Apakah ada max size?
- [ ] Apakah ada checksum?
- [ ] Apakah ada framing?

### 29.2 Resource

- [ ] Siapa membuka resource?
- [ ] Siapa menutup resource?
- [ ] Apakah wrapper menutup underlying stream?
- [ ] Apakah close harus menulis final trailer?
- [ ] Apakah ada native/direct resource?
- [ ] Apakah ada file lock?

### 29.3 Failure

- [ ] Apa yang terjadi jika EOF di awal?
- [ ] Apa yang terjadi jika EOF di tengah?
- [ ] Apa yang terjadi jika timeout?
- [ ] Apa yang terjadi jika disk full?
- [ ] Apa yang terjadi jika permission denied?
- [ ] Apa yang terjadi jika connection reset?
- [ ] Apa yang terjadi jika data corrupt?
- [ ] Apa yang terjadi jika retry duplicate?

### 29.4 Performance

- [ ] Apakah data diproses streaming?
- [ ] Apakah buffer size masuk akal?
- [ ] Apakah memory bounded?
- [ ] Apakah syscall terlalu sering?
- [ ] Apakah ada unnecessary copy?
- [ ] Apakah direct buffer perlu?
- [ ] Apakah bottleneck sebenarnya di disk/network/remote peer?

### 29.5 Security

- [ ] Apakah path berasal dari user?
- [ ] Apakah perlu mencegah path traversal?
- [ ] Apakah input compressed bisa zip bomb?
- [ ] Apakah input serialized trusted?
- [ ] Apakah payload mengandung PII/token?
- [ ] Apakah log aman?
- [ ] Apakah ada max payload size?
- [ ] Apakah TLS/certificate validation benar?

### 29.6 Operational

- [ ] Apakah ada metric bytes/sec?
- [ ] Apakah ada transfer id/correlation id?
- [ ] Apakah ada retry count?
- [ ] Apakah ada cleanup staging?
- [ ] Apakah ada reconciliation?
- [ ] Apakah ada runbook failure?

---

## 30. Latihan Mental Model

### Latihan 1 — Upload File Besar

Kamu membangun endpoint upload dokumen 500 MB.

Pertanyaan:

1. Apakah boleh membaca seluruh body ke memory?
2. Di mana staging file disimpan?
3. Bagaimana mencegah file final terlihat sebelum lengkap?
4. Bagaimana menghitung checksum?
5. Apa max upload size?
6. Apa timeout-nya?
7. Apa yang terjadi jika client disconnect di tengah?
8. Bagaimana cleanup file `.part`?
9. Bagaimana mencegah path traversal dari filename?
10. Apa log/metric minimal?

Jawaban arah:

```text
Gunakan streaming upload ke staging file, limit ukuran, checksum sambil stream, finalisasi atomic setelah complete, cleanup partial, jangan percaya filename user sebagai path final, dan catat transfer state.
```

### Latihan 2 — Export Report CSV

Kamu menghasilkan CSV 5 GB untuk di-download.

Pertanyaan:

1. Apakah generate langsung ke `StringBuilder`?
2. Apakah response HTTP langsung atau temp file dulu?
3. Bagaimana jika client lambat?
4. Bagaimana jika query DB lebih cepat dari network?
5. Apakah perlu compression?
6. Apakah CSV encoding eksplisit?
7. Apakah record mengandung newline/quote?
8. Apakah report final bisa di-resume?

Jawaban arah:

```text
Gunakan streaming writer dengan UTF-8 eksplisit, bounded fetch dari DB, backpressure dari output stream, CSV escaping benar, mungkin staging file jika perlu resume/cache/checksum, dan jangan menampung seluruh report di heap.
```

### Latihan 3 — Custom TCP Protocol

Kamu membuat TCP service internal.

Pertanyaan:

1. Bagaimana message boundary ditentukan?
2. Apakah length-prefix punya max size?
3. Apa timeout idle/read/write?
4. Apa yang terjadi jika peer mengirim length 2 GB?
5. Apakah operasi idempotent jika client retry?
6. Bagaimana close connection?
7. Apakah butuh heartbeat?
8. Apakah butuh TLS?

Jawaban arah:

```text
TCP harus diberi framing, validasi frame length, timeout, state machine, max in-flight data, dan idempotency untuk retry. Jangan menganggap satu read sama dengan satu message.
```

### Latihan 4 — Extract ZIP dari User

Pertanyaan:

1. Apakah entry name aman?
2. Apakah ada max total extracted size?
3. Apakah ada max number of entries?
4. Apakah symlink boleh?
5. Apakah overwrite file existing boleh?
6. Bagaimana jika ZIP corrupt di tengah?
7. Bagaimana cleanup partial extraction?

Jawaban arah:

```text
Validasi resolved path tetap di base dir, batasi total size dan entry count, jangan overwrite sembarang, handle corrupt archive, cleanup partial output, dan waspadai zip bomb.
```

---

## 31. Ringkasan Part 000

Java I/O harus dipahami sebagai sistem boundary crossing, bukan kumpulan class.

Mental model utama:

1. **I/O adalah perpindahan data melewati boundary.**
2. **Byte dan character berbeda.** Charset harus eksplisit di boundary serius.
3. **Stream adalah aliran data. Buffer adalah staging area. Channel adalah koneksi I/O buffer-oriented.**
4. **Read/write bisa partial.** Selalu hormati return value.
5. **EOF harus diinterpretasikan berdasarkan protocol.**
6. **Resource lifecycle harus eksplisit.** Jangan mengandalkan GC untuk file/socket/native resource.
7. **Load-all hanya aman untuk data kecil dan bounded.**
8. **Backpressure wajib jika producer bisa lebih cepat dari consumer.**
9. **Visibility, durability, dan acknowledgement berbeda.**
10. **File final yang penting harus dipublish secara atomic.**
11. **TCP adalah byte stream, bukan message stream.** Protocol butuh framing.
12. **Serialization adalah format binary dengan risiko security, bukan magic.**
13. **Compression adalah stream transform dan punya failure/security model sendiri.**
14. **Data transfer production-grade biasanya state machine.**
15. **Correctness datang dari invariant: limit, checksum, idempotency, atomicity, cleanup, observability.**

Part berikutnya akan memperdalam boundary paling fundamental:

```text
Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
```

---

## 32. Referensi Resmi

1. Oracle Java SE 21 API — `java.io` package:  
   <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/package-summary.html>

2. Oracle Java SE 21 Guide — Java NIO:  
   <https://docs.oracle.com/en/java/javase/21/core/java-nio.html>

3. Oracle Java SE 21 API — `java.nio.ByteBuffer`:  
   <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/ByteBuffer.html>

4. Oracle Java SE 21 API — `java.nio.channels` package:  
   <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/channels/package-summary.html>

5. Oracle Java SE 25 API — `java.nio.file` package:  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html>

6. Oracle Java SE 25 API — `Files`:  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html>

7. Oracle Java SE 21 API — `java.net` package:  
   <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/package-summary.html>

8. Oracle Java SE 21 API — `java.net.http` module:  
   <https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/module-summary.html>

9. Oracle Java Object Serialization Specification:  
   <https://docs.oracle.com/en/java/javase/25/docs/specs/serialization/serial-arch.html>

10. Oracle Java SE 21 API — `StandardCharsets`:  
    <https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/StandardCharsets.html>
