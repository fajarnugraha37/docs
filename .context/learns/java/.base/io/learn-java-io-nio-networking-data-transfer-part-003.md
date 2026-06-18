# Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-003.md`  
> Status seri: **belum selesai**  
> Part sebelumnya: Part 002 — Classic `java.io`: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle  
> Part berikutnya: Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil

---

## 1. Tujuan Pembelajaran

Di part ini kita akan membedah **buffering** secara serius. Banyak developer tahu bahwa `BufferedInputStream`, `BufferedOutputStream`, `BufferedReader`, dan `BufferedWriter` bisa “membuat I/O lebih cepat”, tetapi tidak benar-benar memahami **kenapa**, **kapan**, **seberapa besar**, **di layer mana**, dan **kapan buffering justru merusak sistem**.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menjelaskan buffering sebagai teknik **batching data movement** antara aplikasi, JVM, OS kernel, storage, network, dan device.
2. Membedakan buffer di beberapa layer:
   - application buffer,
   - Java stream buffer,
   - Java NIO buffer,
   - kernel page cache,
   - socket send/receive buffer,
   - disk/controller/device buffer,
   - library/framework buffer.
3. Memilih ukuran buffer secara rasional berdasarkan workload, bukan berdasarkan mitos.
4. Mendeteksi anti-pattern seperti:
   - membaca byte per byte,
   - double buffering yang tidak perlu,
   - flush terlalu sering,
   - buffer terlalu besar per connection,
   - `readAllBytes()` untuk payload tidak bounded,
   - line-based reader untuk protocol yang tidak punya line boundary.
5. Mendesain pipeline I/O yang punya **bounded memory**, **throughput stabil**, **latency terkendali**, dan **backpressure masuk akal**.
6. Mengerti mengapa buffer bukan durability guarantee: `flush()` tidak sama dengan persisted-to-disk.
7. Memahami hubungan buffering dengan performance, GC, syscall, context switch, page cache, network congestion, dan failure mode.

---

## 2. Mental Model: Buffer Adalah Area Tunggu, Bukan Sihir Performance

Buffer adalah **ruang memori sementara** yang dipakai untuk mengumpulkan data sebelum data dipindahkan ke layer berikutnya.

Secara sederhana:

```text
Producer  ──write──>  Buffer  ──flush/drain──>  Consumer
Consumer  <──read──── Buffer  <──refill──────── Source
```

Buffer bukan membuat disk lebih cepat. Buffer bukan membuat network latency hilang. Buffer bukan memperbaiki protocol yang buruk. Buffer hanya mengubah **pola perpindahan data**.

Tanpa buffer, aplikasi mungkin memanggil operasi mahal terlalu sering:

```text
for each byte:
    syscall/read/write
```

Dengan buffer, aplikasi melakukan batching:

```text
for each chunk:
    syscall/read/write once for many bytes
```

Inti buffering:

```text
Mengurangi frekuensi operasi mahal dengan memperbesar satuan kerja.
```

Operasi mahal bisa berupa:

- syscall ke kernel,
- context switch,
- disk seek,
- network packet overhead,
- TLS record processing,
- compression block processing,
- charset decoding,
- object allocation,
- lock acquisition,
- remote service call,
- flush ke downstream.

Namun buffer juga punya biaya:

- memakai memory,
- menambah latency untuk data yang menunggu di buffer,
- bisa menyembunyikan backpressure,
- bisa membuat data hilang jika process crash sebelum flush,
- bisa menyebabkan burst besar ke downstream,
- bisa membuat failure terlambat terlihat.

Jadi buffer adalah trade-off:

```text
Throughput naik, tapi latency, memory, dan failure visibility harus dikendalikan.
```

---

## 3. Kenapa Membaca/Menulis Byte per Byte Sering Lambat

Misalkan kita copy file seperti ini:

```java
try (InputStream in = new FileInputStream(source.toFile());
     OutputStream out = new FileOutputStream(target.toFile())) {

    int b;
    while ((b = in.read()) != -1) {
        out.write(b);
    }
}
```

Kode ini benar secara fungsional, tetapi buruk secara performance untuk banyak kasus.

Kenapa?

Karena `read()` byte tunggal bisa menyebabkan interaksi sangat sering dengan underlying stream. Tergantung implementasi, setiap byte bisa berujung pada pemanggilan native/kernel atau setidaknya dispatch method berulang. Bahkan jika OS punya page cache, aplikasi tetap membuat overhead besar di sisi Java.

Lebih baik:

```java
try (InputStream in = new FileInputStream(source.toFile());
     OutputStream out = new FileOutputStream(target.toFile())) {

    byte[] buffer = new byte[64 * 1024];
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
    }
}
```

Di sini, setiap iterasi membaca banyak byte sekaligus. Jumlah call turun drastis.

Contoh kasar:

```text
File 1 GiB

Byte-by-byte:
  ±1,073,741,824 read calls
  ±1,073,741,824 write calls

Buffer 64 KiB:
  ±16,384 read calls
  ±16,384 write calls
```

Perbedaannya bukan kecil. Bukan karena byte array itu ajaib, tetapi karena satuan kerja berubah dari “per byte” menjadi “per chunk”.

---

## 4. Apa yang Sebenarnya Dilakukan `BufferedInputStream`

`BufferedInputStream` membungkus `InputStream` lain dan menyimpan data yang dibaca dari underlying stream ke internal byte array. Dokumentasi Java menjelaskan bahwa class ini menambahkan buffering dan mendukung `mark`/`reset`; ketika byte dibaca atau di-skip, internal buffer diisi ulang dari contained input stream, banyak byte sekaligus.

Mental model:

```text
Application
   |
   | read one byte / read small array
   v
BufferedInputStream internal byte[]
   |
   | refill many bytes when empty
   v
Underlying InputStream
   |
   v
File / Socket / Pipe / Other Source
```

Contoh:

```java
try (InputStream in = new BufferedInputStream(
        new FileInputStream("input.bin"),
        64 * 1024
)) {
    int b;
    while ((b = in.read()) != -1) {
        // Process one byte logically,
        // but underlying file is not necessarily read one byte at a time.
    }
}
```

Di level aplikasi kita membaca satu byte, tetapi `BufferedInputStream` mengurangi jumlah call ke underlying stream dengan mengisi buffer internal.

Namun jangan salah paham. Ini bukan izin untuk selalu menulis logic byte-by-byte. Untuk parser tertentu, membaca byte-by-byte dari `BufferedInputStream` masih bisa acceptable, tetapi jika bisa memproses chunk, chunk-based processing biasanya lebih baik.

---

## 5. Apa yang Sebenarnya Dilakukan `BufferedOutputStream`

`BufferedOutputStream` menyimpan byte yang ditulis aplikasi ke internal buffer. Ketika buffer penuh atau `flush()`/`close()` dipanggil, data diteruskan ke underlying output stream. Dokumentasi Java menyebutkan bahwa dengan buffered output stream, aplikasi dapat menulis byte ke underlying output stream tanpa harus menyebabkan call ke underlying system untuk setiap byte yang ditulis.

Mental model:

```text
Application
   |
   | write small pieces
   v
BufferedOutputStream internal byte[]
   |
   | flush when full / flush() / close()
   v
Underlying OutputStream
   |
   v
File / Socket / Pipe / Other Sink
```

Contoh:

```java
try (OutputStream out = new BufferedOutputStream(
        new FileOutputStream("output.bin"),
        64 * 1024
)) {
    for (int i = 0; i < 1_000_000; i++) {
        out.write(i & 0xFF);
    }
}
```

Walaupun aplikasi memanggil `write()` satu juta kali, underlying stream tidak harus menerima satu juta write kecil. Data dikumpulkan dulu di buffer.

Tetapi ada konsekuensi penting:

```text
write() ke BufferedOutputStream belum tentu berarti data sudah sampai ke file/socket.
```

Data bisa masih berada di memory buffer Java.

---

## 6. `flush()` Bukan `fsync()`

Ini salah satu boundary paling penting.

`flush()` berarti:

```text
Tolong dorong data yang tertahan di buffer object ini ke underlying stream.
```

Bukan berarti:

```text
Data pasti sudah permanen di disk.
```

Bukan juga berarti:

```text
Data pasti sudah diterima remote peer.
```

Contoh layer write ke file:

```text
Application
  -> BufferedOutputStream buffer
  -> FileOutputStream/native write
  -> OS page cache
  -> disk controller/cache
  -> physical storage
```

`flush()` pada `BufferedOutputStream` biasanya hanya memastikan buffer Java diteruskan ke `FileOutputStream`. Setelah itu, OS masih bisa menahan data di page cache. Untuk meminta sinkronisasi ke storage, kamu butuh API lain seperti `FileChannel.force(...)` atau mekanisme fsync-equivalent.

Contoh:

```java
try (FileOutputStream fos = new FileOutputStream("data.bin");
     BufferedOutputStream bos = new BufferedOutputStream(fos, 64 * 1024)) {

    bos.write(payload);
    bos.flush();              // flush Java buffer to FileOutputStream
    fos.getChannel().force(true); // ask OS to force file content and metadata
}
```

Tetap ada caveat: storage hardware, filesystem, mount option, network filesystem, dan OS policy bisa mempengaruhi durability nyata. Namun secara API Java, `flush()` dan `force()` adalah konsep berbeda.

Untuk socket, `flush()` juga tidak berarti remote application sudah memproses data. Bisa saja data baru sampai ke OS socket buffer lokal, network stack, intermediate proxy, TLS layer, atau buffer remote kernel.

Invariant penting:

```text
flush = push buffered data to next layer
force/fsync = request persistence to stable storage
ack/application response = remote application-level confirmation
```

Jangan mencampur tiga hal ini.

---

## 7. `BufferedReader` dan Character Buffering

`BufferedReader` membaca character dari `Reader` lain dan menyimpan character di internal char buffer. Dokumentasi Java mendeskripsikannya sebagai reader yang membaca text dari character-input stream, buffering characters agar pembacaan character, array, dan line menjadi efisien.

Contoh:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

`BufferedReader` berguna untuk:

- membaca text line-by-line,
- menghindari decoding kecil-kecil,
- memproses file besar tanpa load semua file ke memory,
- menyediakan `readLine()`.

Namun `readLine()` punya boundary penting:

1. Newline tidak disertakan di return value.
2. Line sangat panjang bisa membuat memory besar karena `String` untuk satu line harus terbentuk.
3. Format yang bukan line-oriented jangan dipaksa dibaca dengan line-oriented API.
4. `readLine()` bisa blocking jika dipakai pada socket sampai newline/EOF diterima.

Anti-pattern umum:

```java
String line = reader.readLine();
// diasumsikan pasti selesai cepat
```

Pada socket, ini bisa menggantung jika peer tidak pernah mengirim newline.

---

## 8. `BufferedWriter` dan Output Text

`BufferedWriter` menyimpan character sebelum diteruskan ke underlying writer.

Contoh:

```java
try (BufferedWriter writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    for (Record record : records) {
        writer.write(record.toCsvLine());
        writer.newLine();
    }
}
```

Keuntungan:

- mengurangi write kecil,
- mengurangi encoding/underlying write overhead,
- cocok untuk banyak record kecil,
- lebih baik daripada membuat satu `StringBuilder` raksasa untuk semua output.

Namun tetap ada boundary:

```text
writer.write(...) belum tentu data sudah ada di file.
writer.flush() belum tentu data persisted.
writer.close() biasanya flush dulu, tapi masih bukan fsync.
```

Jika output adalah file penting yang harus crash-safe, buffering saja tidak cukup. Polanya akan dibahas lebih dalam di part atomic file write, tetapi ringkasnya:

```text
write temp -> flush -> force file -> atomic move -> force directory
```

---

## 9. Buffer Ada di Banyak Layer

Kesalahan umum: mengira hanya ada satu buffer.

Padahal dalam operasi sederhana seperti download HTTP ke file, bisa ada banyak buffer:

```text
Remote application buffer
Remote TLS buffer
Remote kernel socket send buffer
Network device buffer
Intermediate proxy buffer
Local kernel socket receive buffer
Local TLS buffer
HTTP client body buffer
Application byte[] buffer
BufferedOutputStream buffer
OS page cache
Storage controller cache
Disk/SSD internal buffer
```

Setiap buffer punya tujuan, ukuran, failure behavior, dan flush semantics sendiri.

Konsekuensi:

1. Menambah buffer di aplikasi belum tentu meningkatkan throughput jika bottleneck ada di network.
2. Menghapus buffer aplikasi belum tentu buruk jika library sudah buffering dengan baik.
3. Double buffering bisa redundant.
4. Flush di satu layer tidak otomatis flush semua layer.
5. Backpressure bisa terlambat terlihat karena data tertahan di buffer antara producer dan consumer.

---

## 10. Application Buffer vs Wrapper Buffer

Ada dua pattern umum.

### 10.1 External Application Buffer

```java
byte[] buffer = new byte[64 * 1024];
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

Di sini buffer dimiliki oleh aplikasi. Cocok ketika:

- kamu memproses chunk,
- kamu ingin kontrol ukuran buffer,
- kamu ingin reuse buffer,
- kamu ingin menghitung checksum per chunk,
- kamu ingin progress tracking,
- kamu ingin rate limiting.

### 10.2 Wrapper Internal Buffer

```java
try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
    int b;
    while ((b = in.read()) != -1) {
        processByte(b);
    }
}
```

Di sini buffer dimiliki wrapper. Cocok ketika:

- caller membaca kecil-kecil,
- parser butuh lookahead kecil,
- kamu ingin `mark/reset`,
- kamu ingin line reading via `BufferedReader`,
- kamu tidak ingin expose buffer ke caller.

### 10.3 Kombinasi

Kadang external buffer + buffered wrapper masih masuk akal, tapi sering redundant.

Contoh redundant:

```java
try (InputStream in = new BufferedInputStream(new FileInputStream(source.toFile()));
     OutputStream out = new BufferedOutputStream(new FileOutputStream(target.toFile()))) {

    byte[] buffer = new byte[1024 * 1024];
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
    }
}
```

Apakah salah? Tidak selalu. Tetapi internal buffer 8 KiB/64 KiB mungkin tidak banyak berguna karena aplikasi sudah membaca 1 MiB per call. Wrapper buffer menjadi layer tambahan.

Versi yang sering cukup:

```java
try (InputStream in = new FileInputStream(source.toFile());
     OutputStream out = new FileOutputStream(target.toFile())) {

    byte[] buffer = new byte[64 * 1024];
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
    }
}
```

Atau gunakan API yang sudah mengoptimalkan:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Decision rule:

```text
Jika caller melakukan read/write kecil-kecil, wrapper buffer membantu.
Jika caller sudah melakukan chunk besar, wrapper buffer sering tidak perlu.
```

---

## 11. Ukuran Buffer: Tidak Ada Angka Sakral

Banyak tutorial menyebut 8 KiB. Banyak codebase memakai 4 KiB. Ada yang memakai 64 KiB, 256 KiB, 1 MiB. Mana yang benar?

Jawaban engineering-nya:

```text
Tergantung workload, layer, jumlah concurrent stream, latency target, memory budget, dan bottleneck.
```

### 11.1 Ukuran Kecil

Contoh: 1 KiB, 4 KiB, 8 KiB.

Kelebihan:

- memory per stream kecil,
- latency lebih rendah untuk sebagian workload,
- cocok untuk banyak concurrent connection,
- cukup untuk banyak text file kecil.

Kekurangan:

- lebih banyak loop/read/write call,
- overhead lebih tinggi untuk file besar,
- throughput bisa lebih rendah.

### 11.2 Ukuran Menengah

Contoh: 32 KiB, 64 KiB, 128 KiB.

Kelebihan:

- sering menjadi sweet spot untuk file/network streaming,
- mengurangi call overhead signifikan,
- memory masih terkendali.

Kekurangan:

- jika ribuan stream aktif, memory bisa besar,
- belum tentu meningkatkan throughput jika bottleneck bukan call overhead.

### 11.3 Ukuran Besar

Contoh: 512 KiB, 1 MiB, 4 MiB.

Kelebihan:

- bisa membantu sequential file throughput tertentu,
- cocok untuk chunking besar, checksum per chunk, multipart upload,
- overhead loop rendah.

Kekurangan:

- memory per stream besar,
- meningkatkan GC pressure jika sering alokasi,
- latency first-byte/flush bisa memburuk,
- burst besar ke downstream,
- dapat membuat cache locality buruk,
- tidak selalu lebih cepat.

### 11.4 Rule of Thumb Awal

Untuk banyak aplikasi enterprise:

```text
Text line processing:        8 KiB - 64 KiB
Binary file copy:            64 KiB - 1 MiB
HTTP streaming body:         16 KiB - 128 KiB
Many concurrent sockets:     4 KiB - 32 KiB per direction, tergantung load
Compression stream:          32 KiB - 256 KiB, tergantung block/workload
Checksum chunking:           64 KiB - 4 MiB, tergantung manifest/resume design
```

Tapi angka ini bukan hukum. Benchmark di environment target tetap penting.

---

## 12. Memory Budget: Buffer Size × Concurrency

Kesalahan sizing buffer yang sering terjadi adalah hanya melihat satu stream.

Misal:

```text
Buffer 1 MiB kelihatannya kecil.
```

Tapi jika ada 2.000 concurrent uploads dan setiap connection punya:

- 1 MiB read buffer,
- 1 MiB write buffer,
- 512 KiB parser buffer,
- 512 KiB compression buffer,

maka memory bisa:

```text
2.000 × 3 MiB = 6.000 MiB
```

Belum termasuk object lain, heap overhead, TLS buffer, HTTP client/server buffer, request object, response object, business data, dan thread stack/virtual thread continuation.

Formula kasar:

```text
Total buffer memory ≈ concurrent active flows × buffer per flow × number of buffering layers
```

Karena itu, sistem high-concurrency lebih perlu:

- bounded buffer,
- buffer pooling jika benar-benar perlu,
- flow control,
- max request size,
- max frame size,
- max concurrent transfer,
- streaming, bukan load-all,
- observability memory.

---

## 13. Throughput vs Latency

Buffer besar cenderung baik untuk throughput, tetapi bisa buruk untuk latency.

### 13.1 Throughput-Oriented

Contoh:

- copy file besar,
- backup,
- ETL batch,
- report export,
- object storage upload,
- log archival.

Tujuan:

```text
bytes/sec tinggi
```

Buffer lebih besar bisa membantu sampai titik tertentu.

### 13.2 Latency-Oriented

Contoh:

- interactive CLI,
- chat protocol,
- server-sent events,
- low-latency response,
- command protocol,
- progress update.

Tujuan:

```text
data kecil cepat terlihat oleh consumer
```

Buffer terlalu besar atau flush terlalu jarang bisa membuat user/perangkat downstream menunggu.

Contoh buruk:

```java
BufferedWriter writer = new BufferedWriter(socketWriter);
writer.write("OK\n");
// lupa flush, remote client menunggu response
```

Perlu:

```java
writer.write("OK\n");
writer.flush();
```

Namun jangan flush setelah setiap byte/field jika tidak perlu.

Decision rule:

```text
Batch untuk throughput.
Flush pada semantic boundary untuk latency/protocol correctness.
```

Semantic boundary bisa berupa:

- satu response lengkap,
- satu frame lengkap,
- satu line command response,
- satu chunk transfer,
- satu transaction log record,
- satu progress event.

---

## 14. Flush Strategy: Terlalu Jarang vs Terlalu Sering

### 14.1 Terlalu Jarang Flush

Masalah:

- peer menunggu,
- file tidak terlihat lengkap bagi reader,
- progress tidak muncul,
- buffer memory tertahan,
- error downstream terlambat terdeteksi.

Contoh:

```java
writer.write("READY\n");
// no flush -> client blocked waiting for READY
```

### 14.2 Terlalu Sering Flush

Masalah:

- batching hilang,
- syscall meningkat,
- TLS record kecil-kecil,
- network packet overhead meningkat,
- disk write amplification,
- throughput turun.

Contoh buruk:

```java
for (Record record : records) {
    writer.write(record.toLine());
    writer.newLine();
    writer.flush(); // buruk untuk batch besar
}
```

Lebih baik:

```java
int count = 0;
for (Record record : records) {
    writer.write(record.toLine());
    writer.newLine();

    if (++count % 10_000 == 0) {
        writer.flush(); // optional progress boundary
    }
}
```

Atau cukup flush/close di akhir jika batch output tidak perlu intermediate visibility.

### 14.3 Flush Berdasarkan Boundary

Gunakan flush ketika ada alasan semantic:

```text
- response protocol selesai
- chunk besar selesai
- transaksi selesai
- checkpoint selesai
- user-visible prompt perlu tampil
- before waiting for peer response
- before handoff ke process lain
```

Jangan flush hanya karena “takut data belum tertulis” tanpa memahami layer.

---

## 15. `close()` Biasanya Flush, Tapi Jangan Mengandalkan untuk Semua Semantik

Banyak output stream/writer melakukan flush saat close. Namun ada beberapa hal penting:

1. `close()` bisa throw `IOException`.
2. Jika exception terjadi sebelum close, `try-with-resources` tetap memanggil close, tetapi exception close bisa menjadi suppressed exception.
3. Close wrapper biasanya menutup underlying stream.
4. Close bukan fsync.
5. Close bukan remote acknowledgment.
6. Close socket berarti connection lifecycle berubah, bukan hanya flush buffer.

Contoh:

```java
try (BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(file))) {
    out.write(payload);
}
```

Ini cukup untuk banyak file biasa. Tetapi untuk file yang harus crash-safe, pattern ini belum cukup.

---

## 16. Double Buffering: Kapan Redundant, Kapan Masih Masuk Akal

Double buffering adalah ketika data melewati dua buffer yang punya fungsi mirip.

Contoh:

```java
InputStream in = new BufferedInputStream(
    new BufferedInputStream(new FileInputStream(file))
);
```

Ini hampir selalu tidak berguna.

Contoh lebih halus:

```java
BufferedInputStream bis = new BufferedInputStream(fileInputStream, 8 * 1024);
byte[] appBuffer = new byte[1024 * 1024];
while ((n = bis.read(appBuffer)) != -1) {
    ...
}
```

Internal 8 KiB buffer mungkin dilewati atau minim manfaat tergantung implementasi dan ukuran read. Aplikasi sudah menyediakan buffer besar.

Namun double buffering bisa masuk akal jika layer punya fungsi berbeda:

```text
BufferedInputStream       -> mengurangi read kecil
GZIPInputStream           -> decompression state
InputStreamReader         -> byte-to-char decoding
BufferedReader            -> char buffering + readLine
```

Di sini tidak semua buffer identik. Ada transformasi berbeda:

- compression buffer,
- decoder buffer,
- line buffer,
- byte buffer.

Rule:

```text
Double buffering buruk jika dua layer melakukan batching yang sama tanpa fungsi tambahan.
Layered buffering masuk akal jika setiap layer punya semantic transformation berbeda.
```

---

## 17. Buffering dan Backpressure

Buffer bisa menyerap perbedaan kecepatan antara producer dan consumer.

```text
Fast Producer -> Buffer -> Slow Consumer
```

Awalnya terlihat bagus karena producer tidak langsung terblokir. Tetapi jika consumer terus lebih lambat, buffer akan penuh.

Ada tiga kemungkinan:

1. Producer diblokir.
2. Data dibuang.
3. Memory tumbuh tanpa batas.

Yang paling berbahaya adalah nomor 3.

Contoh buruk:

```java
ByteArrayOutputStream buffer = new ByteArrayOutputStream();
copy(untrustedInput, buffer); // payload bisa unlimited
byte[] all = buffer.toByteArray();
```

Ini bukan backpressure; ini memory bomb.

Design yang lebih baik:

```java
byte[] buffer = new byte[64 * 1024];
long total = 0;
int n;
while ((n = in.read(buffer)) != -1) {
    total += n;
    if (total > maxAllowedBytes) {
        throw new PayloadTooLargeException();
    }
    out.write(buffer, 0, n);
}
```

Backpressure dalam I/O berarti:

```text
Jika downstream lambat, upstream harus melambat, dibatasi, atau gagal secara eksplisit.
```

Bukan:

```text
Tampung semuanya di memory sampai OOM.
```

---

## 18. Buffering dan Garbage Collection

Buffer adalah object. Jika kamu terus membuat buffer baru di hot path, kamu menambah allocation rate dan GC pressure.

Buruk:

```java
while ((n = in.read(new byte[8192])) != -1) {
    // salah: buffer baru setiap loop, dan data hilang
}
```

Buruk tapi lebih realistis:

```java
for (File file : files) {
    byte[] buffer = new byte[10 * 1024 * 1024];
    process(file, buffer);
}
```

Jika files banyak dan concurrent, allocation besar bisa mengganggu GC.

Lebih baik:

```java
byte[] buffer = new byte[64 * 1024];
for (File file : files) {
    process(file, buffer);
}
```

Untuk server concurrent, buffer reuse perlu hati-hati:

- Jangan share mutable buffer antar thread tanpa ownership jelas.
- Jangan return buffer ke pool sebelum operasi async selesai.
- Jangan menyimpan reference ke buffer yang akan dipakai ulang.
- Jangan pooling buffer kecil tanpa bukti profiling; pool bisa menambah kompleksitas.

Rule:

```text
Reuse buffer dalam satu flow itu bagus.
Pool buffer antar flow hanya jika profiling membuktikan allocation menjadi bottleneck.
```

---

## 19. Buffer Ownership

Buffer ownership adalah aturan siapa yang boleh membaca, menulis, menyimpan, dan memakai ulang buffer.

Contoh bug:

```java
byte[] buffer = new byte[8192];
int n;
while ((n = in.read(buffer)) != -1) {
    executor.submit(() -> process(buffer, n));
}
```

Ini salah karena lambda menyimpan reference ke buffer yang akan dipakai ulang oleh loop berikutnya. Hasilnya race/corruption.

Perbaikan 1: copy data per task.

```java
byte[] buffer = new byte[8192];
int n;
while ((n = in.read(buffer)) != -1) {
    byte[] chunk = Arrays.copyOf(buffer, n);
    executor.submit(() -> process(chunk, chunk.length));
}
```

Perbaikan 2: gunakan buffer pool dengan ownership eksplisit.

```text
borrow buffer -> fill -> handoff -> process -> return buffer
```

Tapi pattern pool perlu disiplin tinggi.

Invariant:

```text
Mutable buffer tidak boleh dimiliki dua actor yang bisa memodifikasi/menafsirkan content secara bersamaan tanpa koordinasi.
```

---

## 20. Buffering untuk Text: Byte Buffer dan Char Buffer Tidak Sama

Untuk text, ada dua proses:

```text
bytes -> decoder -> chars
```

Buffer byte dan buffer char punya boundary berbeda.

Contoh pipeline:

```java
InputStream fileBytes = new FileInputStream(file);
InputStream bufferedBytes = new BufferedInputStream(fileBytes, 64 * 1024);
Reader decoder = new InputStreamReader(bufferedBytes, StandardCharsets.UTF_8);
BufferedReader lines = new BufferedReader(decoder, 64 * 1024);
```

Layer:

```text
FileInputStream        -> byte source
BufferedInputStream    -> byte buffer
InputStreamReader      -> byte-to-char decoder
BufferedReader         -> char buffer + readLine
```

Apakah byte buffering dan char buffering keduanya selalu perlu? Tidak selalu. Banyak factory modern seperti `Files.newBufferedReader` sudah membuat reader yang sesuai untuk common use. Tetapi memahami layer penting agar tidak salah menempatkan buffer.

Bug yang sering terjadi:

```java
byte[] bytes = Files.readAllBytes(path);
String text = new String(bytes); // default charset, memory besar
```

Lebih baik untuk file besar:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Namun jika format bukan line-oriented, gunakan parser streaming yang sesuai.

---

## 21. Buffering dan `readAllBytes()`, `readNBytes()`, `transferTo()`

Modern Java menyediakan beberapa helper method yang nyaman.

### 21.1 `readAllBytes()`

Cocok untuk input kecil dan bounded.

Tidak cocok untuk:

- file besar,
- untrusted network input,
- request body tanpa limit,
- stream yang panjangnya tidak diketahui,
- server high-concurrency.

Anti-pattern:

```java
byte[] body = requestInputStream.readAllBytes();
```

Jika body bisa besar, ini berbahaya.

### 21.2 `readNBytes()`

Lebih bounded daripada `readAllBytes()`, tetapi tetap mengalokasikan array sesuai limit jika digunakan varian tertentu.

Cocok untuk:

- header kecil,
- magic number,
- fixed-size frame,
- bounded protocol field.

Contoh:

```java
byte[] header = in.readNBytes(16);
if (header.length < 16) {
    throw new EOFException("Incomplete header");
}
```

### 21.3 `transferTo()`

`InputStream.transferTo(OutputStream)` memudahkan copy stream ke output. Cocok untuk simple transfer, tetapi kamu kehilangan sebagian kontrol:

- custom chunk size,
- progress tracking detail,
- checksum per chunk,
- rate limiting,
- max byte enforcement,
- cancellation checkpoint,
- custom retry.

Untuk simple case:

```java
try (InputStream in = Files.newInputStream(source);
     OutputStream out = Files.newOutputStream(target)) {
    in.transferTo(out);
}
```

Untuk controlled transfer:

```java
byte[] buffer = new byte[64 * 1024];
long total = 0;
int n;
while ((n = in.read(buffer)) != -1) {
    total += n;
    if (total > maxBytes) {
        throw new IOException("Transfer exceeds limit");
    }
    checksum.update(buffer, 0, n);
    out.write(buffer, 0, n);
    progress.accept(total);
}
```

---

## 22. Buffering dan Network I/O

Network buffering punya karakter berbeda dari file.

File sequential read/write sering throughput-oriented. Network lebih dipengaruhi:

- latency,
- congestion,
- send/receive window,
- socket buffer,
- TLS record,
- peer behavior,
- proxy,
- timeout,
- packet loss,
- Nagle algorithm,
- application protocol boundary.

Contoh protocol bug:

```java
BufferedWriter writer = new BufferedWriter(
    new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8)
);
BufferedReader reader = new BufferedReader(
    new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8)
);

writer.write("PING\n");
String response = reader.readLine(); // deadlock possible if writer not flushed
```

Perbaikan:

```java
writer.write("PING\n");
writer.flush();
String response = reader.readLine();
```

Untuk socket, flush sering menjadi bagian dari protocol correctness. Tetapi flush terlalu sering tetap dapat merusak throughput.

Rule:

```text
Flush saat message/frame lengkap dan peer perlu segera membaca.
Jangan flush per field/per byte.
```

---

## 23. Buffering dan Compression

Compression juga punya buffer internal.

Contoh:

```java
try (OutputStream fileOut = Files.newOutputStream(path);
     BufferedOutputStream bufferedOut = new BufferedOutputStream(fileOut, 64 * 1024);
     GZIPOutputStream gzipOut = new GZIPOutputStream(bufferedOut)) {

    gzipOut.write(data);
}
```

Layer:

```text
Application data
  -> GZIPOutputStream compression buffer/state
  -> BufferedOutputStream byte buffer
  -> FileOutputStream
  -> OS page cache
```

Urutan wrapper penting. Biasanya kamu ingin buffering di bawah compression agar compressed bytes ditulis efisien ke sink.

Namun kadang kamu juga butuh buffering sebelum compression jika producer menulis potongan sangat kecil. Tetapi jangan asal menambah buffer tanpa mengerti efeknya.

Hal penting pada compression:

- `flush()` pada compression stream bisa punya semantic khusus dan dapat menurunkan compression ratio jika terlalu sering.
- `close()`/`finish()` penting agar trailer/checksum compression ditulis.
- Consumer bisa gagal membaca compressed file jika stream tidak ditutup/finished.

---

## 24. Buffering dan TLS/HTTP

HTTP client/server dan TLS layer juga buffering.

Implikasi:

1. `OutputStream.flush()` pada response HTTP mungkin hanya mendorong data ke framework/container buffer.
2. Framework bisa punya response buffer sendiri.
3. TLS membungkus data ke record.
4. HTTP/2 punya flow control sendiri.
5. Reverse proxy bisa buffering response.
6. Client mungkin baru menerima data setelah threshold tertentu.

Karena itu, untuk streaming HTTP response, kamu perlu memahami stack yang digunakan:

```text
Application -> Framework buffer -> Servlet/container buffer -> TLS -> socket -> proxy -> client
```

Flush di aplikasi tidak selalu berarti browser langsung melihat bytes.

Untuk large download:

- gunakan streaming body,
- hindari load seluruh file ke memory,
- set content length jika diketahui,
- gunakan checksum jika perlu,
- handle client disconnect,
- jangan flush terlalu sering,
- gunakan chunk boundary yang masuk akal.

---

## 25. Line Buffering dan Interactive Output

Di banyak environment, console output punya buffering berbeda tergantung apakah output diarahkan ke terminal atau pipe/file.

Java `System.out` adalah `PrintStream`, dan behavior seperti auto-flush tergantung constructor/configuration. Jangan mengandalkan asumsi dari bahasa lain seperti C line buffering.

Contoh prompt CLI:

```java
System.out.print("Enter name: ");
System.out.flush();
String name = reader.readLine();
```

Tanpa flush, prompt bisa tidak tampil sebelum program menunggu input, terutama jika output diarahkan atau dibungkus.

Rule:

```text
Untuk interactive prompt, flush sebelum blocking read.
```

---

## 26. Mark/Reset dan Buffer

`BufferedInputStream` mendukung `mark` dan `reset`. Ini berguna untuk parser yang perlu lookahead.

Contoh:

```java
try (BufferedInputStream in = new BufferedInputStream(Files.newInputStream(path))) {
    if (!in.markSupported()) {
        throw new IllegalStateException("mark/reset not supported");
    }

    in.mark(16);
    byte[] magic = in.readNBytes(4);

    if (!isKnownMagic(magic)) {
        in.reset();
        parseAsFallback(in);
    } else {
        parseKnownFormat(in);
    }
}
```

Boundary penting:

- `readlimit` menentukan berapa banyak byte yang boleh dibaca sebelum mark menjadi invalid.
- Buffer mungkin perlu tumbuh atau mempertahankan data sesuai readlimit.
- Jangan gunakan `mark/reset` untuk lookahead besar tanpa memahami memory impact.

Untuk format besar, lebih baik desain parser dengan explicit state daripada mark/reset raksasa.

---

## 27. Buffering dan File Copy: Pilihan API

Ada beberapa cara copy file.

### 27.1 Manual Buffer

```java
try (InputStream in = Files.newInputStream(source);
     OutputStream out = Files.newOutputStream(target)) {
    byte[] buffer = new byte[64 * 1024];
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
    }
}
```

Kelebihan:

- kontrol penuh,
- progress,
- checksum,
- limit,
- cancellation.

### 27.2 `Files.copy`

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Kelebihan:

- sederhana,
- standard,
- cocok untuk common case.

### 27.3 `InputStream.transferTo`

```java
try (InputStream in = Files.newInputStream(source);
     OutputStream out = Files.newOutputStream(target)) {
    in.transferTo(out);
}
```

Kelebihan:

- sederhana untuk stream-to-stream.

### 27.4 `FileChannel.transferTo/transferFrom`

Akan dibahas detail di Part 009. Cocok untuk transfer besar dan potensi zero-copy.

Decision matrix:

| Use Case | API Awal yang Masuk Akal |
|---|---|
| Copy file biasa | `Files.copy` |
| Copy sambil progress/checksum | Manual buffer |
| Stream-to-stream sederhana | `transferTo` |
| Large file high-throughput | `FileChannel` / benchmark |
| Atomic replace | temp file + move |
| Controlled upload/download | manual buffer + limits + checksum |

---

## 28. Buffering dan Error Visibility

Buffer bisa membuat error terlambat muncul.

Contoh:

```java
out.write(data); // sukses karena hanya masuk buffer
// error disk full baru muncul saat flush/close
```

Karena itu, untuk output penting, jangan abaikan exception saat close.

`try-with-resources` membantu, tetapi kamu tetap perlu memperhatikan exception.

Contoh:

```java
try (BufferedOutputStream out = new BufferedOutputStream(Files.newOutputStream(path))) {
    out.write(payload);
} catch (IOException e) {
    // write, flush, atau close bisa gagal
    throw new UncheckedIOException("Failed to write output", e);
}
```

Dalam pipeline transfer, error bisa muncul saat:

- read source,
- transform,
- write buffer,
- flush downstream,
- close stream,
- finalize file,
- checksum verification,
- rename/move.

Jangan menganggap sukses hanya karena loop write selesai.

---

## 29. Bounded vs Unbounded Buffer

Bounded buffer punya batas jelas. Unbounded buffer tumbuh terus.

### 29.1 Bounded

```java
byte[] buffer = new byte[64 * 1024];
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

Memory stabil.

### 29.2 Unbounded

```java
ByteArrayOutputStream baos = new ByteArrayOutputStream();
in.transferTo(baos);
byte[] all = baos.toByteArray();
```

Memory mengikuti ukuran input. Ini acceptable hanya jika input bounded dan kecil.

Rule:

```text
Untrusted/unbounded input harus diproses streaming dengan limit eksplisit.
```

---

## 30. Designing a Robust Copy Utility

Mari buat utility copy yang lebih production-aware.

Requirement:

- tidak load semua ke memory,
- buffer bounded,
- max byte limit optional,
- checksum optional,
- progress callback,
- menangani partial read/write,
- tidak menutup stream yang bukan miliknya jika didesain demikian.

Contoh:

```java
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Objects;
import java.util.function.LongConsumer;

public final class StreamCopy {
    private StreamCopy() {}

    public static Result copy(
            InputStream in,
            OutputStream out,
            int bufferSize,
            long maxBytes,
            MessageDigest digest,
            LongConsumer progress
    ) throws IOException {
        Objects.requireNonNull(in, "in");
        Objects.requireNonNull(out, "out");

        if (bufferSize <= 0) {
            throw new IllegalArgumentException("bufferSize must be positive");
        }
        if (maxBytes < -1) {
            throw new IllegalArgumentException("maxBytes must be -1 or non-negative");
        }

        byte[] buffer = new byte[bufferSize];
        long total = 0;

        while (true) {
            int n = in.read(buffer);
            if (n == -1) {
                break;
            }
            if (n == 0) {
                // InputStream should generally not return 0 for non-empty buffer unless len == 0,
                // but some custom streams can behave oddly. Avoid infinite loop semantics.
                continue;
            }

            total += n;
            if (maxBytes >= 0 && total > maxBytes) {
                throw new IOException("Input exceeds maxBytes: " + maxBytes);
            }

            if (digest != null) {
                digest.update(buffer, 0, n);
            }

            out.write(buffer, 0, n);

            if (progress != null) {
                progress.accept(total);
            }
        }

        out.flush();

        String hexDigest = digest == null
                ? null
                : HexFormat.of().formatHex(digest.digest());

        return new Result(total, hexDigest);
    }

    public record Result(long bytesCopied, String digestHex) {}
}
```

Catatan desain:

1. Method ini tidak menutup `in`/`out`; ownership ada di caller.
2. `flush()` dilakukan karena caller mungkin butuh data didorong ke downstream, tetapi ini bukan durability guarantee.
3. `maxBytes` mencegah unbounded memory/time/resource consumption.
4. Digest dihitung streaming.
5. Progress berdasarkan bytes copied, bukan records.
6. Buffer dialokasikan sekali per call.

Pemakaian:

```java
try (InputStream in = Files.newInputStream(source);
     OutputStream out = Files.newOutputStream(target)) {

    MessageDigest sha256 = MessageDigest.getInstance("SHA-256");

    StreamCopy.Result result = StreamCopy.copy(
            in,
            out,
            64 * 1024,
            10L * 1024 * 1024 * 1024, // 10 GiB max
            sha256,
            bytes -> System.out.println("copied=" + bytes)
    );

    System.out.println(result);
}
```

Untuk progress besar, jangan print setiap chunk di production karena logging/console bisa menjadi bottleneck. Throttle progress update.

---

## 31. Designing a Throttled Progress Callback

Buruk:

```java
bytes -> log.info("copied={}", bytes)
```

Jika chunk 8 KiB dan file 10 GiB, log bisa lebih dari satu juta baris.

Lebih baik:

```java
public final class ThrottledProgress implements LongConsumer {
    private final long byteInterval;
    private long next;

    public ThrottledProgress(long byteInterval) {
        if (byteInterval <= 0) {
            throw new IllegalArgumentException("byteInterval must be positive");
        }
        this.byteInterval = byteInterval;
        this.next = byteInterval;
    }

    @Override
    public void accept(long value) {
        if (value >= next) {
            System.out.println("copied=" + value);
            while (next <= value) {
                next += byteInterval;
            }
        }
    }
}
```

Atau throttle berdasarkan waktu:

```java
public final class TimeThrottledProgress implements LongConsumer {
    private final long intervalNanos;
    private long lastNanos;

    public TimeThrottledProgress(long intervalMillis) {
        this.intervalNanos = intervalMillis * 1_000_000L;
    }

    @Override
    public void accept(long value) {
        long now = System.nanoTime();
        if (now - lastNanos >= intervalNanos) {
            lastNanos = now;
            System.out.println("copied=" + value);
        }
    }
}
```

Lesson:

```text
Observability juga butuh buffering/throttling.
```

---

## 32. Buffering dan Parser

Parser sering membutuhkan buffer, tetapi jenis buffer tergantung format.

### 32.1 Line-Oriented Format

Contoh:

- log line,
- simple CSV,
- NDJSON,
- config line-based.

API:

```java
BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8);
```

Caveat:

- line bisa sangat panjang,
- quoted CSV bisa punya newline di dalam field,
- NDJSON satu object per line harus tetap punya max line length,
- `readLine()` membentuk `String` penuh per line.

### 32.2 Length-Prefix Binary Format

Gunakan byte buffer dan frame size limit.

```java
byte[] header = in.readNBytes(4);
int length = ByteBuffer.wrap(header).getInt();
if (length < 0 || length > MAX_FRAME_SIZE) {
    throw new IOException("Invalid frame length: " + length);
}
byte[] frame = in.readNBytes(length);
if (frame.length < length) {
    throw new EOFException("Incomplete frame");
}
```

Untuk frame besar, jangan selalu allocate full frame; streaming body bisa lebih aman.

### 32.3 Delimited Binary/Text Protocol

Perlu hati-hati dengan delimiter yang bisa muncul dalam payload. Buffer harus bisa menangani delimiter split across reads.

---

## 33. Buffer Boundary dan Partial Read

`read(byte[])` tidak menjamin buffer terisi penuh. Ia mengembalikan jumlah byte yang benar-benar dibaca.

Benar:

```java
int n = in.read(buffer);
if (n != -1) {
    out.write(buffer, 0, n);
}
```

Salah:

```java
int n = in.read(buffer);
out.write(buffer); // salah: menulis seluruh buffer, termasuk stale bytes
```

Bug ini bisa menyebabkan data corruption karena byte sisa dari iterasi sebelumnya ikut tertulis.

Untuk membaca persis N byte:

```java
byte[] payload = in.readNBytes(expectedLength);
if (payload.length != expectedLength) {
    throw new EOFException("Expected " + expectedLength + " bytes, got " + payload.length);
}
```

Atau manual loop jika ingin reuse buffer.

---

## 34. Buffer Boundary dan Partial Write

Pada classic `OutputStream.write(byte[], off, len)`, contract-nya menulis `len` byte atau throw exception untuk banyak implementasi blocking stream. Tetapi pada NIO `WritableByteChannel.write(ByteBuffer)`, write bisa partial. Ini akan dibahas lebih dalam di NIO part.

Mental model yang perlu ditanam sejak sekarang:

```text
Read can be partial.
Write can be partial in some APIs.
Never assume one call equals one complete logical message unless API contract says so.
```

---

## 35. Buffering dan `PrintWriter`/`PrintStream`

`PrintWriter` dan `PrintStream` sering dipakai untuk text output, tetapi ada behavior penting:

- beberapa method tidak throw `IOException` langsung seperti stream biasa,
- error perlu dicek dengan `checkError()` pada `PrintWriter`/`PrintStream`,
- auto-flush behavior bergantung constructor dan method tertentu,
- cocok untuk human-readable output, tetapi kurang ideal untuk protocol yang butuh error handling ketat.

Untuk file/protocol penting, lebih aman memakai `BufferedWriter` dan menangani `IOException` secara eksplisit.

---

## 36. Common Anti-Patterns

### Anti-Pattern 1 — Byte-by-byte Copy Tanpa Buffer

```java
int b;
while ((b = in.read()) != -1) {
    out.write(b);
}
```

Perbaikan:

```java
byte[] buffer = new byte[64 * 1024];
int n;
while ((n = in.read(buffer)) != -1) {
    out.write(buffer, 0, n);
}
```

### Anti-Pattern 2 — Menulis Seluruh Buffer Padahal Hanya Sebagian Terisi

```java
int n = in.read(buffer);
out.write(buffer); // corrupt
```

Perbaikan:

```java
out.write(buffer, 0, n);
```

### Anti-Pattern 3 — `readAllBytes()` untuk Input Tidak Terbatas

```java
byte[] body = socket.getInputStream().readAllBytes();
```

Perbaikan:

```java
copyWithLimit(socket.getInputStream(), out, maxBytes);
```

### Anti-Pattern 4 — Flush di Setiap Record Batch Besar

```java
for (Record record : records) {
    writer.write(record.toLine());
    writer.flush();
}
```

Perbaikan:

```java
for (Record record : records) {
    writer.write(record.toLine());
    writer.newLine();
}
writer.flush();
```

### Anti-Pattern 5 — Tidak Flush Saat Protocol Membutuhkan Response Segera

```java
writer.write("OK\n");
String next = reader.readLine(); // peer mungkin menunggu OK
```

Perbaikan:

```java
writer.write("OK\n");
writer.flush();
String next = reader.readLine();
```

### Anti-Pattern 6 — Sharing Buffer Mutable ke Async Task

```java
while ((n = in.read(buffer)) != -1) {
    executor.submit(() -> process(buffer, n));
}
```

Perbaikan:

```java
byte[] chunk = Arrays.copyOf(buffer, n);
executor.submit(() -> process(chunk, chunk.length));
```

### Anti-Pattern 7 — Buffer Besar per Connection Tanpa Memory Budget

```java
byte[] buffer = new byte[4 * 1024 * 1024]; // per request
```

Perbaikan:

- hitung concurrency,
- gunakan buffer lebih kecil,
- gunakan pooling jika terbukti perlu,
- batasi concurrent transfer,
- stream dengan backpressure.

### Anti-Pattern 8 — Mengira Flush Sama Dengan Durable

```java
writer.flush();
// assume safe after crash
```

Perbaikan untuk file penting:

```java
writer.flush();
channel.force(true);
```

Dan untuk atomic replace, gunakan temp + force + atomic move.

---

## 37. Decision Matrix Buffering

| Situation | Recommended Approach | Reason |
|---|---|---|
| Membaca file kecil config | `Files.readString` atau `Files.readAllLines` jika bounded | Simplicity lebih penting |
| Membaca file besar line-by-line | `Files.newBufferedReader` | Streaming, memory bounded |
| Copy file biasa | `Files.copy` | Standard, sederhana |
| Copy sambil checksum/progress | Manual byte[] buffer | Butuh kontrol per chunk |
| Banyak write kecil ke file | `BufferedOutputStream`/`BufferedWriter` | Mengurangi write call |
| Protocol socket request-response | Buffered writer + flush per message | Correctness boundary |
| Batch export jutaan row | Buffered writer, flush periodik atau akhir | Throughput |
| Upload/download besar | Streaming buffer bounded | Avoid OOM |
| Input untrusted | Streaming + max size + timeout | Defense |
| High concurrency | Buffer kecil-menengah + limit concurrency | Memory budget |
| Low latency event | Flush di event boundary | Timely delivery |
| Durable file write | Buffer + force + atomic move | Crash safety |
| Compression output | Compression stream + thoughtful buffering | Ratio/throughput trade-off |

---

## 38. Performance Reasoning Checklist

Saat buffering terasa lambat, jangan langsung ubah angka buffer. Tanyakan:

1. Bottleneck-nya apa?
   - CPU?
   - disk?
   - network?
   - TLS?
   - compression?
   - charset decoding?
   - logging?
   - downstream service?
2. Berapa ukuran payload?
3. Berapa concurrency?
4. Berapa buffer per flow?
5. Apakah ada double buffering?
6. Apakah flush terlalu sering?
7. Apakah ada `readAllBytes()`?
8. Apakah ada allocation buffer di loop?
9. Apakah line terlalu panjang?
10. Apakah output sink lambat?
11. Apakah progress/logging terlalu noisy?
12. Apakah benchmark menggunakan realistic storage/network?
13. Apakah OS page cache membuat hasil benchmark menipu?
14. Apakah Java Flight Recorder menunjukkan allocation/IO wait?
15. Apakah metric bytes/sec dan latency dipisahkan?

---

## 39. Failure Model Buffering

Buffering memperkenalkan failure mode berikut:

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Data belum terkirim | Lupa flush | Flush pada semantic boundary |
| Data belum durable | Mengira flush = fsync | Gunakan `FileChannel.force` untuk durability |
| OOM | Buffer unbounded / terlalu besar per connection | Max size, streaming, bounded buffer |
| Data corruption | Menulis seluruh buffer bukan `0..n` | Selalu gunakan count hasil read |
| Stale data | Buffer reuse dengan async handoff | Copy atau ownership protocol |
| Latency tinggi | Buffer terlalu besar / flush terlambat | Flush per message/event boundary |
| Throughput rendah | Flush terlalu sering / buffer kecil | Batch lebih besar, benchmark |
| Error terlambat terlihat | Error baru muncul saat flush/close | Tangani IOException dari close/flush |
| Deadlock protocol | Dua pihak saling menunggu karena data masih buffered | Flush sebelum menunggu response |
| Backpressure hilang | Buffer menyerap terlalu banyak | Bounded queue/buffer, rate limit |

---

## 40. Production Pattern: Streaming File Ingestion dengan Bounded Buffer

Misal kamu membangun service ingestion file:

```text
Client uploads file -> service writes staging file -> checksum -> validate -> atomic publish -> process async
```

Buffering pattern:

```text
HTTP request body stream
  -> bounded read buffer
  -> checksum update
  -> staging file buffered output
  -> flush
  -> force
  -> atomic move
```

Pseudo-code:

```java
Path staging = stagingDir.resolve(uploadId + ".part");
Path finalPath = finalDir.resolve(uploadId + ".bin");

MessageDigest sha256 = MessageDigest.getInstance("SHA-256");

try (InputStream in = requestBody;
     OutputStream rawOut = Files.newOutputStream(staging,
             StandardOpenOption.CREATE_NEW,
             StandardOpenOption.WRITE);
     BufferedOutputStream out = new BufferedOutputStream(rawOut, 64 * 1024)) {

    StreamCopy.Result result = StreamCopy.copy(
            in,
            out,
            64 * 1024,
            maxUploadBytes,
            sha256,
            null
    );

    // out.flush() already called by utility, close will also happen.
}

try (FileChannel channel = FileChannel.open(staging, StandardOpenOption.WRITE)) {
    channel.force(true);
}

Files.move(staging, finalPath, StandardCopyOption.ATOMIC_MOVE);
```

Catatan:

- Real implementation harus hati-hati karena membuka `FileChannel` setelah output stream close harus benar secara mode dan filesystem.
- Directory fsync untuk atomic publish akan dibahas di part atomic file write.
- Jangan publish file final sebelum semua byte, checksum, dan validation selesai.
- Jika gagal, hapus staging file atau tandai orphan untuk cleanup job.

---

## 41. Production Pattern: Response Streaming dengan Flush Terkendali

Untuk response HTTP besar:

```java
byte[] buffer = new byte[64 * 1024];
long total = 0;
int n;
while ((n = fileInput.read(buffer)) != -1) {
    responseOutput.write(buffer, 0, n);
    total += n;

    if (shouldFlush(total)) {
        responseOutput.flush();
    }
}
responseOutput.flush();
```

`shouldFlush` jangan terlalu agresif. Misalnya per beberapa MiB atau per interval waktu jika benar-benar butuh progress streaming.

Untuk download biasa, sering tidak perlu flush manual tiap chunk karena framework/container akan mengelola buffer.

---

## 42. Production Pattern: Bounded Queue Antara Producer dan Consumer

Kadang pipeline punya producer dan consumer berbeda thread.

```text
Reader Thread -> BlockingQueue<Chunk> -> Writer/Processor Thread
```

Queue adalah buffer juga. Harus bounded.

Buruk:

```java
Queue<byte[]> queue = new ConcurrentLinkedQueue<>(); // unbounded
```

Lebih baik:

```java
BlockingQueue<byte[]> queue = new ArrayBlockingQueue<>(32);
```

Jika consumer lambat, producer akan block saat queue penuh. Itulah backpressure.

Namun hati-hati dengan buffer ownership. Jika chunk memakai byte array dari pool, pastikan lifecycle jelas.

---

## 43. Benchmark Mini yang Masuk Akal

Untuk membandingkan buffer size, jangan hanya benchmark sekali.

Minimal ukur:

- file size kecil, sedang, besar,
- cold cache vs warm cache,
- SSD/network filesystem,
- concurrency 1 vs banyak,
- heap usage,
- GC count/time,
- CPU usage,
- bytes/sec,
- p50/p95/p99 latency jika request-based.

Contoh sederhana untuk lokal bukan benchmark final:

```java
static long copy(Path source, Path target, int bufferSize) throws IOException {
    long start = System.nanoTime();
    try (InputStream in = Files.newInputStream(source);
         OutputStream out = Files.newOutputStream(target,
                 StandardOpenOption.CREATE,
                 StandardOpenOption.TRUNCATE_EXISTING,
                 StandardOpenOption.WRITE)) {

        byte[] buffer = new byte[bufferSize];
        int n;
        while ((n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
        }
    }
    return System.nanoTime() - start;
}
```

Caveat:

- Hasil bisa sangat dipengaruhi OS page cache.
- Menulis target yang sama berulang bisa menipu.
- JIT warmup mempengaruhi hasil.
- Untuk microbenchmark Java, gunakan JMH.
- Untuk I/O nyata, macrobenchmark lebih relevan.

---

## 44. Checklist Desain Buffer

Gunakan checklist ini saat membuat I/O pipeline:

```text
[ ] Apakah input size bounded?
[ ] Apakah ada max byte/frame/line limit?
[ ] Apakah menggunakan streaming, bukan load-all?
[ ] Apakah buffer dialokasikan sekali per flow, bukan per loop?
[ ] Apakah ukuran buffer dikalikan concurrency masih aman?
[ ] Apakah flush dilakukan pada semantic boundary?
[ ] Apakah flush tidak terlalu sering?
[ ] Apakah durability membutuhkan force/fsync?
[ ] Apakah output penting menangani exception dari close?
[ ] Apakah read count digunakan dengan benar?
[ ] Apakah buffer mutable tidak dishare ke async task secara unsafe?
[ ] Apakah double buffering memang punya fungsi berbeda?
[ ] Apakah parser sesuai boundary format?
[ ] Apakah progress/logging tidak menjadi bottleneck?
[ ] Apakah benchmark dilakukan di environment realistis?
[ ] Apakah backpressure eksplisit dan bounded?
```

---

## 45. Latihan

### Latihan 1 — Perbaiki Copy Function

Diberikan kode:

```java
void copy(InputStream in, OutputStream out) throws IOException {
    int b;
    while ((b = in.read()) != -1) {
        out.write(b);
    }
}
```

Tugas:

1. Ubah menjadi chunk-based.
2. Tambahkan max byte limit.
3. Tambahkan SHA-256.
4. Tambahkan progress callback yang tidak terlalu sering.
5. Jelaskan siapa pemilik stream dan siapa yang menutup.

### Latihan 2 — Debug Protocol Deadlock

Diberikan:

```java
writer.write("AUTH user pass\n");
String response = reader.readLine();
```

Kadang client/server hang.

Tugas:

1. Jelaskan kemungkinan penyebab.
2. Tambahkan flush yang benar.
3. Jelaskan mengapa flush per field bukan solusi bagus.
4. Jelaskan timeout apa yang perlu ada.

### Latihan 3 — Buffer Size Budget

Sebuah service menerima 1.500 upload concurrent. Setiap upload memakai:

- 256 KiB read buffer,
- 256 KiB write buffer,
- 128 KiB checksum/parser buffer.

Tugas:

1. Hitung memory kasar untuk buffer.
2. Usulkan ukuran alternatif.
3. Usulkan concurrency limit.
4. Jelaskan metric yang perlu dimonitor.

### Latihan 4 — `readAllBytes()` Risk Review

Cari codebase yang memakai:

```java
inputStream.readAllBytes()
```

Untuk setiap penggunaan, klasifikasikan:

- aman karena input kecil dan bounded,
- perlu max size,
- harus diganti streaming,
- perlu timeout,
- perlu checksum/progress.

---

## 46. Ringkasan

Buffering adalah salah satu konsep paling penting dalam Java I/O karena ia berada di boundary antara aplikasi dan dunia luar.

Poin utama:

1. Buffer adalah batching mechanism.
2. Buffer mengurangi overhead operasi kecil yang berulang.
3. Buffer tidak menghilangkan bottleneck fisik seperti disk/network.
4. Buffer terlalu kecil bisa menurunkan throughput.
5. Buffer terlalu besar bisa memboroskan memory dan menaikkan latency.
6. `flush()` hanya mendorong data ke layer berikutnya, bukan guarantee durable.
7. Untuk file durable, perlu mekanisme seperti `FileChannel.force` dan atomic write pattern.
8. Untuk socket/protocol, flush harus dilakukan pada message boundary.
9. Untuk batch, flush terlalu sering merusak throughput.
10. Input unbounded harus diproses streaming dengan limit.
11. Mutable buffer punya ownership rule.
12. Double buffering tidak selalu salah, tetapi harus punya alasan semantic.
13. Backpressure harus bounded dan eksplisit.
14. Performance tuning buffer harus berdasarkan measurement, bukan angka sakral.

Mental model akhir:

```text
Buffer adalah alat kontrol aliran data.
Ia memperbaiki performance jika digunakan pada boundary yang benar,
tetapi bisa menciptakan latency, memory pressure, hidden failure,
dan data loss misconception jika digunakan tanpa model yang jelas.
```

---

## 47. Referensi

- Oracle Java SE 25 API — `BufferedOutputStream`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/BufferedOutputStream.html
- Oracle Java SE 24 API — `BufferedInputStream`: https://docs.oracle.com/en/java/javase/24/docs/api/java.base/java/io/BufferedInputStream.html
- Oracle Java SE 25 API — `BufferedReader`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/BufferedReader.html
- Oracle Java SE 25 API — `OutputStream`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/OutputStream.html
- Oracle Java SE 25 API — `Flushable`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Flushable.html
- Oracle Java SE 21 API — `InputStream`: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/InputStream.html

---

## 48. Status Seri

Seri **belum selesai**.

Part yang sudah dibuat:

```text
Part 000 — Mental Model Besar Java I/O
Part 001 — Byte, Character, Encoding, Charset, dan Boundary yang Sering Menjadi Sumber Bug
Part 002 — Classic java.io: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle
Part 003 — Buffering Deep Dive: Kenapa Buffer Ada, Bagaimana Memilih Ukuran, dan Apa Efeknya ke Performance
```

Part berikutnya:

```text
Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 002 — Classic `java.io`: Stream Hierarchy, Decorator Pattern, dan Resource Lifecycle](./learn-java-io-nio-networking-data-transfer-part-002.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 004 — Binary I/O: Primitive Data, Endianness, Framing, dan Format Stabil](./learn-java-io-nio-networking-data-transfer-part-004.md)

</div>