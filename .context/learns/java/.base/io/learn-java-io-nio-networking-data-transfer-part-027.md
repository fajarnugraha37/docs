# Part 027 — Performance Engineering for I/O: Syscall, Page Cache, GC, Direct Memory, Benchmark, dan Profiling

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-027.md`  
> Status: Part 027 dari 030 — **belum bagian terakhir**

---

## Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Melihat performa I/O sebagai interaksi antara **aplikasi Java, JVM, OS kernel, page cache, filesystem, storage, network, dan remote peer**.
2. Tidak terjebak pada klaim sederhana seperti “NIO pasti lebih cepat”, “direct buffer pasti lebih cepat”, atau “mmap pasti paling optimal”.
3. Memahami bottleneck umum:
   - syscall terlalu banyak,
   - buffer terlalu kecil,
   - allocation pressure,
   - GC pressure,
   - direct memory pressure,
   - page cache miss,
   - random I/O,
   - slow storage,
   - slow network,
   - slow consumer,
   - lock contention,
   - bad benchmark.
4. Mendesain eksperimen performa yang bisa dipercaya.
5. Menggunakan profiling dan observability untuk membuktikan akar masalah, bukan menebak.
6. Membuat keputusan engineering antara:
   - stream biasa,
   - buffered stream,
   - `FileChannel`,
   - `transferTo`/`transferFrom`,
   - memory-mapped file,
   - direct buffer,
   - heap buffer,
   - blocking I/O,
   - NIO event loop,
   - virtual thread.

---

## 1. Mental Model Besar: I/O Performance Bukan Hanya Kecepatan API

Saat kode Java membaca file:

```java
byte[] bytes = Files.readAllBytes(path);
```

kamu mungkin merasa aplikasi “langsung membaca disk”. Sebenarnya yang terjadi lebih kompleks:

```text
Application Code
   ↓
Java API: Files / InputStream / Channel
   ↓
JVM runtime
   ↓
Native call / syscall boundary
   ↓
OS kernel
   ↓
Page cache / buffer cache
   ↓
Filesystem driver
   ↓
Block device / network filesystem / object-backed storage
   ↓
Physical or virtual storage
```

Untuk socket:

```text
Application Code
   ↓
Java Socket / SocketChannel / HttpClient
   ↓
JVM runtime
   ↓
OS syscall
   ↓
Kernel TCP stack
   ↓
NIC driver / virtual network
   ↓
Network path
   ↓
Remote kernel
   ↓
Remote application
```

Artinya, performa I/O tidak bisa dinilai hanya dari class Java yang dipakai. Bottleneck bisa berada di:

| Layer | Contoh Bottleneck |
|---|---|
| Application | parsing lambat, allocation berlebihan, lock contention |
| JVM | GC pause, JIT warmup, direct memory pressure |
| Java API usage | buffer terlalu kecil, read byte-per-byte, load-all ke memory |
| Kernel | syscall terlalu banyak, context switch tinggi |
| Page cache | cache miss, cache eviction, dirty page flush |
| Filesystem | metadata operation mahal, fsync mahal, fragmentation |
| Storage | IOPS rendah, throughput rendah, latency tinggi |
| Network | RTT tinggi, packet loss, congestion, slow receiver |
| Remote service | consumer lambat, backpressure tidak dihormati |

**Invariant penting:**

> Tidak ada API Java yang bisa mengalahkan bottleneck fisik dan protokol. API yang baik hanya mengurangi overhead dan membuat data path lebih efisien.

---

## 2. Ukuran Performa: Jangan Campur Latency, Throughput, dan Capacity

Banyak diskusi performa I/O kacau karena metriknya tidak jelas.

### 2.1 Latency

Latency adalah waktu untuk menyelesaikan satu operasi.

Contoh:

```text
Membaca 4 KB dari file: 2 ms
Download 1 file: 800 ms
fsync satu file: 12 ms
DNS lookup: 30 ms
```

Latency penting untuk:

- request-response API,
- interactive CLI,
- small file access,
- metadata operation,
- random read,
- database-like access,
- user-facing download.

### 2.2 Throughput

Throughput adalah volume data per satuan waktu.

Contoh:

```text
500 MB/s sequential read
80 MB/s gzip output
20,000 records/s parsing CSV
1 Gbps network transfer
```

Throughput penting untuk:

- file copy besar,
- batch import,
- export report,
- log processing,
- compression,
- streaming download/upload.

### 2.3 Capacity

Capacity adalah jumlah workload yang bisa ditangani bersamaan sebelum degradasi besar.

Contoh:

```text
10,000 concurrent idle socket
500 concurrent downloads
100 file ingestion job parallel
2 GB direct memory budget
```

Capacity penting untuk:

- server socket,
- HTTP client pool,
- file transfer service,
- batch worker,
- ingestion pipeline.

### 2.4 Tail Latency

Average sering menipu. Untuk sistem production, p95/p99 sering lebih penting.

```text
avg = 20 ms
p95 = 80 ms
p99 = 1,500 ms
```

Ini berarti mayoritas request cepat, tapi sebagian kecil sangat lambat. Pada file/network I/O, tail latency bisa muncul karena:

- page cache miss,
- disk flush,
- GC pause,
- network retransmission,
- DNS stall,
- TLS handshake,
- lock contention,
- slow remote peer,
- bursty workload,
- storage throttling.

**Rule:**

> Untuk I/O, selalu lihat throughput, latency, p95/p99, error rate, dan resource usage bersama-sama.

---

## 3. Syscall Cost: Kenapa Membaca Byte-per-Byte Itu Buruk

System call adalah transisi dari user space ke kernel space. Operasi ini tidak gratis.

Contoh buruk:

```java
try (InputStream in = Files.newInputStream(path)) {
    int b;
    while ((b = in.read()) != -1) {
        process((byte) b);
    }
}
```

Kode ini secara semantik benar, tapi bisa buruk jika setiap `read()` memicu operasi native kecil atau wrapper tidak melakukan buffering yang cukup.

Versi lebih baik:

```java
byte[] buffer = new byte[64 * 1024];

try (InputStream in = Files.newInputStream(path)) {
    int n;
    while ((n = in.read(buffer)) != -1) {
        process(buffer, 0, n);
    }
}
```

Dengan buffer, aplikasi mengurangi jumlah interaksi kecil. Jika file 1 GB dibaca per 1 byte, secara konseptual kamu punya sekitar 1 miliar operasi read kecil. Jika dibaca per 64 KB, jumlah chunk sekitar:

```text
1 GB / 64 KB ≈ 16,384 read loop
```

Perbedaannya ekstrem.

### 3.1 Syscall Bukan Satu-satunya Biaya

Selain syscall, biaya bisa muncul dari:

- method dispatch,
- bounds checking,
- copying antar buffer,
- allocation,
- decoding charset,
- parsing,
- checksum,
- compression,
- locking,
- context switch,
- cache miss CPU.

Jadi, mengurangi syscall penting, tetapi bukan satu-satunya optimasi.

---

## 4. Page Cache: Banyak “Disk I/O” Sebenarnya Memory I/O

OS biasanya memakai page cache untuk menyimpan data file yang baru dibaca atau akan ditulis.

```text
Application reads file
   ↓
Kernel checks page cache
   ↓
If page exists: return from memory
If not: fetch from storage into page cache
```

Implikasinya:

1. Read pertama bisa lambat.
2. Read kedua bisa sangat cepat.
3. Benchmark file read bisa menipu jika page cache sudah hangat.
4. Menulis file bisa terlihat cepat karena data masuk dirty page, bukan langsung persist ke storage.
5. `flush()` Java bukan selalu durability guarantee.
6. `FileChannel.force()` lebih dekat ke durability, tapi mahal.

### 4.1 Warm Cache vs Cold Cache

Jika kamu benchmark:

```java
Files.readAllBytes(path);
Files.readAllBytes(path);
Files.readAllBytes(path);
```

read kedua/ketiga bisa jauh lebih cepat karena data sudah ada di page cache.

Itu bukan berarti storage kamu super cepat. Itu berarti OS melayani dari memory.

### 4.2 Dirty Page

Saat menulis:

```java
Files.write(path, bytes);
```

OS dapat menerima write, menandainya sebagai dirty page, lalu menulis ke storage nanti.

Untuk durability:

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.WRITE)) {
    channel.write(buffer);
    channel.force(true);
}
```

`force(true)` meminta update content dan metadata dipaksa ke storage. Ini penting untuk crash-safe persistence, tetapi mahal.

### 4.3 Page Cache Bisa Menjadi Musuh

Page cache membantu untuk data yang sering dibaca ulang. Tapi untuk sequential scan file sangat besar yang hanya dibaca sekali, page cache bisa mencemari cache dan mengusir data lain yang lebih penting.

Contoh workload:

- membaca log 500 GB sekali,
- backup besar,
- export besar,
- migration file,
- analytics scan.

Di level OS, ada teknik seperti readahead atau direct I/O, tetapi Java standard library tidak memberikan kontrol portable penuh atas semua hal ini. Maka desain Java harus realistis:

- streaming,
- bounded memory,
- chunking,
- parallelism terbatas,
- observability OS-level.

---

## 5. Buffer Size: Ukuran yang Salah Bisa Membunuh Throughput atau Memory

Buffer kecil meningkatkan overhead loop dan syscall. Buffer terlalu besar meningkatkan memory footprint dan bisa memperburuk cache locality.

### 5.1 Guideline Awal

| Workload | Starting Buffer Size |
|---|---:|
| small text file | 8 KB - 32 KB |
| general file copy | 64 KB - 1 MB |
| network stream | 8 KB - 64 KB |
| compression stream | 32 KB - 256 KB |
| high-throughput file transfer | 256 KB - 4 MB, benchmark wajib |
| ribuan koneksi aktif | kecil dan bounded, misalnya 8 KB - 32 KB per connection |

Tidak ada angka universal.

### 5.2 Per-Connection Buffer Explosion

Jika kamu punya 10,000 connection dan memberi masing-masing buffer 1 MB:

```text
10,000 × 1 MB = 10 GB
```

Itu baru satu arah. Jika ada read buffer dan write buffer:

```text
10,000 × 2 MB = 20 GB
```

Ini bisa menghancurkan heap atau direct memory.

### 5.3 Buffer yang Besar Tidak Selalu Lebih Cepat

Buffer besar bisa:

- mengurangi syscall,
- tetapi meningkatkan latency batch,
- menambah memory footprint,
- memperburuk CPU cache locality,
- meningkatkan copy cost,
- membuat backpressure terlambat terlihat.

**Rule:**

> Pilih buffer berdasarkan workload dan ukur dengan benchmark representatif.

---

## 6. Heap Buffer vs Direct Buffer

`ByteBuffer` punya dua keluarga besar:

```java
ByteBuffer heap = ByteBuffer.allocate(64 * 1024);
ByteBuffer direct = ByteBuffer.allocateDirect(64 * 1024);
```

### 6.1 Heap Buffer

Heap buffer berada di Java heap.

Kelebihan:

- allocation murah relatif,
- dikelola GC,
- mudah diakses sebagai array jika `hasArray()` true,
- cocok untuk parsing dan manipulasi Java-heavy.

Kekurangan:

- native I/O mungkin perlu copy dari heap ke native buffer internal,
- bisa menambah GC pressure jika sering dialokasikan.

### 6.2 Direct Buffer

Direct buffer berada di memory di luar heap. Dokumentasi `ByteBuffer` menjelaskan bahwa direct buffer biasanya memiliki allocation/deallocation cost lebih tinggi, tetapi dapat membuat native I/O lebih efisien karena JVM berusaha melakukan operasi langsung terhadapnya.

Kelebihan:

- bisa mengurangi copy pada native I/O,
- sering cocok untuk channel/socket/file I/O berulang,
- tidak menambah heap occupancy secara langsung.

Kekurangan:

- allocation lebih mahal,
- deallocation bergantung mekanisme cleaner/GC reachability,
- bisa menyebabkan `OutOfMemoryError: Direct buffer memory`,
- observability lebih sulit jika hanya melihat heap,
- buruk jika dialokasikan per operasi kecil.

### 6.3 Anti-Pattern Direct Buffer

```java
while (running) {
    ByteBuffer buffer = ByteBuffer.allocateDirect(8192);
    channel.read(buffer);
    process(buffer);
}
```

Masalah:

- direct buffer dialokasikan terus-menerus,
- deallocation tidak deterministik,
- native memory pressure meningkat,
- GC bisa dipicu hanya untuk membersihkan direct buffer.

Lebih baik:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(64 * 1024);

while (running) {
    buffer.clear();
    int n = channel.read(buffer);
    if (n == -1) break;
    buffer.flip();
    process(buffer);
}
```

Untuk server banyak koneksi, gunakan pool dengan ownership yang jelas.

---

## 7. Copy Cost: Banyak Pipeline Lambat Karena Data Disalin Berkali-kali

Perhatikan pipeline sederhana:

```text
kernel page cache
   ↓ copy
JVM byte[] buffer
   ↓ copy
ByteArrayOutputStream internal buffer
   ↓ copy
String decode char[]/byte[] internal
   ↓ copy
JSON parser object tree
   ↓ copy/allocation
Domain object
```

Setiap copy memiliki biaya:

- CPU time,
- memory bandwidth,
- cache pollution,
- allocation,
- GC.

### 7.1 Load-All Pattern

```java
byte[] bytes = Files.readAllBytes(path);
String text = new String(bytes, StandardCharsets.UTF_8);
List<Record> records = parseAll(text);
```

Untuk file kecil, ini nyaman. Untuk file besar, ini buruk karena:

- file penuh masuk memory,
- decoded text juga masuk memory,
- object hasil parse juga masuk memory,
- peak memory bisa beberapa kali ukuran file.

### 7.2 Streaming Pattern

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        Record record = parse(line);
        handle(record);
    }
}
```

Lebih baik untuk file besar, meski tetap perlu hati-hati karena `readLine()` membuat `String` per line.

### 7.3 Bounded Batch Pattern

```java
List<Record> batch = new ArrayList<>(1000);

try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        batch.add(parse(line));
        if (batch.size() == 1000) {
            persist(batch);
            batch.clear();
        }
    }
}

if (!batch.isEmpty()) {
    persist(batch);
}
```

Memory menjadi bounded oleh ukuran batch, bukan ukuran file.

---

## 8. `FileChannel.transferTo` dan `transferFrom`: Zero-Copy sebagai Optimasi, Bukan Kontrak Mutlak

`FileChannel` menyediakan:

```java
long transferTo(long position, long count, WritableByteChannel target)
long transferFrom(ReadableByteChannel src, long position, long count)
```

Dokumentasi `FileChannel` menjelaskan channel file bisa membaca, menulis, mapping, dan memanipulasi file; `transferTo/transferFrom` memungkinkan byte ditransfer antara channel.

Secara implementasi, pada kombinasi OS/JVM/channel tertentu, ini dapat menggunakan mekanisme yang lebih efisien seperti zero-copy, menghindari copy data ke heap aplikasi.

Namun, jangan jadikan “zero-copy” sebagai asumsi absolut.

### 8.1 Kenapa Bisa Cepat

File copy biasa:

```text
kernel/page cache → user buffer → kernel/socket buffer
```

Transfer optimized bisa lebih seperti:

```text
kernel/page cache → kernel/socket path
```

Aplikasi tidak perlu melihat seluruh byte.

### 8.2 Kenapa Tidak Selalu Cepat

`transferTo`/`transferFrom` bisa tidak memberi keuntungan besar jika:

- target bukan socket/file yang mendukung path optimized,
- OS/JVM punya batas ukuran per call,
- data harus di-transform di aplikasi,
- TLS membutuhkan encryption di user-space/JVM path,
- compression/checksum/parsing wajib dilakukan,
- bottleneck ada di storage/network, bukan copy CPU,
- benchmark berjalan di warm page cache dan file kecil.

### 8.3 Pattern File Copy dengan Loop

Jangan asumsikan satu call mentransfer semua byte.

```java
static void copyWithTransferTo(Path source, Path target) throws IOException {
    try (FileChannel in = FileChannel.open(source, StandardOpenOption.READ);
         FileChannel out = FileChannel.open(target,
                 StandardOpenOption.CREATE,
                 StandardOpenOption.TRUNCATE_EXISTING,
                 StandardOpenOption.WRITE)) {

        long size = in.size();
        long position = 0;

        while (position < size) {
            long transferred = in.transferTo(position, size - position, out);
            if (transferred <= 0) {
                throw new EOFException("transferTo made no progress at position " + position);
            }
            position += transferred;
        }

        out.force(true);
    }
}
```

**Invariant:**

> Semua API transfer yang mengembalikan jumlah byte harus diperlakukan sebagai potentially partial.

---

## 9. Memory-Mapped File Performance: Cepat untuk Beberapa Workload, Berbahaya untuk yang Lain

`MappedByteBuffer` adalah direct byte buffer yang content-nya merupakan region memory-mapped dari file. Mapping dibuat via `FileChannel.map`.

### 9.1 Kapan Mmap Bagus

Mmap cocok untuk:

- random access besar,
- index file,
- lookup table,
- read-mostly data,
- database-like storage engine,
- file yang diakses berulang,
- menghindari explicit read syscall per access.

### 9.2 Kapan Mmap Tidak Bagus

Mmap bisa buruk untuk:

- sequential one-pass scan sederhana,
- file sangat besar dengan access pattern buruk,
- workload yang butuh deterministic close/unmap,
- Windows deletion/replace scenario,
- file di network filesystem yang behavior-nya tidak stabil,
- transfer yang perlu compression/encryption/parsing per byte,
- container dengan memory accounting ketat.

### 9.3 Page Fault sebagai Hidden Latency

Saat membaca mapped buffer:

```java
byte b = mapped.get(offset);
```

kode terlihat seperti memory access. Tetapi jika page belum resident, OS bisa memicu page fault dan mengambil data dari storage. Latency muncul di titik akses, bukan di `map()`.

### 9.4 Mmap dan GC

Mapped buffer tetap valid sampai buffer garbage-collected. Artinya lifecycle unmap tidak sejelas `close()` stream/channel. Ini penting untuk long-running server.

---

## 10. GC Pressure pada I/O Pipeline

I/O sering terlihat bottleneck eksternal, tapi Java-side allocation bisa menjadi penyebab utama.

### 10.1 Allocation dari Parsing

Contoh CSV parser sederhana:

```java
String[] columns = line.split(",");
```

Masalah:

- regex overhead,
- array allocation per line,
- String allocation per field,
- buruk untuk jutaan record.

Lebih baik gunakan parser yang streaming dan menghindari regex jika workload besar.

### 10.2 Allocation dari ByteArrayOutputStream

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
in.transferTo(out);
byte[] all = out.toByteArray();
```

Masalah:

- data penuh disimpan di memory,
- buffer internal bisa resize berkali-kali,
- `toByteArray()` membuat copy baru.

Jika ukuran diketahui:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream(expectedSize);
```

Tetapi untuk data besar, lebih baik streaming ke file/channel/sink.

### 10.3 Per-Record Object Explosion

Untuk 10 juta record, jika setiap record menghasilkan banyak object sementara, GC akan menjadi bottleneck.

Pattern yang lebih baik:

- batch bounded,
- reuse buffer,
- avoid regex in hot path,
- avoid intermediate `String` jika bisa,
- parse primitive langsung,
- use streaming parser,
- measure allocation rate.

### 10.4 Metrics GC yang Harus Dilihat

- allocation rate MB/s,
- young GC frequency,
- pause time p95/p99,
- old gen occupancy,
- humongous allocation jika G1,
- native/direct memory usage,
- safepoint time.

---

## 11. Direct Memory Pressure

Direct buffer tidak masuk heap occupancy, tetapi tetap memory nyata.

Jika container limit 2 GB dan heap 1.5 GB, lalu direct buffer tumbuh 800 MB, process bisa dibunuh oleh OS/container walaupun heap terlihat aman.

### 11.1 Gejala

- `OutOfMemoryError: Direct buffer memory`,
- RSS jauh lebih besar dari heap used,
- GC terjadi sering walaupun heap tidak penuh,
- container OOMKilled,
- throughput turun setelah beberapa menit,
- latency spike saat direct buffer cleanup.

### 11.2 Praktik Baik

- Jangan allocate direct buffer per request kecil.
- Gunakan pool jika buffer besar dan sering dipakai.
- Batasi total direct memory.
- Monitor RSS, bukan hanya heap.
- Pastikan ownership buffer jelas.
- Jangan menyimpan reference buffer besar lebih lama dari perlu.

---

## 12. Blocking I/O, NIO, dan Virtual Thread: Pilih Berdasarkan Bottleneck

### 12.1 Blocking I/O Biasa

Blocking I/O sederhana dan sering cukup.

Cocok untuk:

- batch job,
- CLI,
- worker terbatas,
- file processing,
- service dengan concurrency moderat,
- kode yang lebih penting correctness daripada peak concurrency.

### 12.2 Virtual Thread

Virtual thread membuat blocking style lebih scalable untuk banyak operasi blocking yang sebagian besar menunggu.

Cocok untuk:

- banyak HTTP call keluar,
- banyak socket blocking,
- request-per-task style,
- codebase yang ingin tetap imperative.

Tetap tidak menghilangkan:

- bandwidth limit,
- remote latency,
- file descriptor limit,
- database pool limit,
- storage throughput limit,
- backpressure requirement.

### 12.3 NIO Event Loop

NIO selector cocok untuk banyak koneksi dengan sedikit thread.

Cocok untuk:

- networking framework,
- protocol server,
- high concurrency socket,
- banyak idle connection,
- custom multiplexing.

Tidak cocok jika:

- tim tidak siap mengelola state machine,
- workload blocking/parsing berat dilakukan di event loop,
- jumlah connection kecil,
- kompleksitas tidak sebanding.

### 12.4 Decision Matrix

| Kebutuhan | Model Awal yang Masuk Akal |
|---|---|
| Copy file sederhana | `Files.copy` |
| Copy file besar | `FileChannel.transferTo` benchmarked |
| Parse file besar | `BufferedReader`/streaming parser |
| Banyak HTTP outbound | `HttpClient` + bounded concurrency / virtual thread |
| Custom TCP server high concurrency | NIO selector / framework seperti Netty |
| Banyak blocking socket sederhana | virtual thread |
| Random access file besar | `FileChannel` positional read atau mmap |
| Crash-safe write | temp file + force + atomic move |
| Transform data saat transfer | streaming buffer, bukan zero-copy |

---

## 13. Storage Workload: Sequential vs Random I/O

### 13.1 Sequential I/O

Contoh:

- membaca file dari awal sampai akhir,
- menulis export report,
- copy file,
- compress file.

Sequential I/O biasanya lebih throughput-friendly.

Optimasi:

- buffer cukup besar,
- minim transform mahal,
- sequential access,
- hindari small write,
- batching.

### 13.2 Random I/O

Contoh:

- lookup offset di file index,
- baca banyak record kecil tersebar,
- update posisi tertentu,
- database-like workload.

Random I/O lebih sensitif ke latency dan IOPS.

Optimasi:

- indexing,
- locality,
- batching request berdasarkan offset,
- mmap jika cocok,
- caching,
- mengurangi seek/random access.

### 13.3 Network Filesystem

Jika file berada di NFS/EFS/SMB/object-backed FUSE, asumsi local filesystem bisa salah.

Masalah umum:

- latency metadata tinggi,
- lock semantics berbeda,
- atomic move mungkin berbeda,
- fsync mahal,
- throughput burst/throttle,
- consistency delay,
- permission mapping aneh.

Jangan benchmark di laptop lalu menganggap hasilnya berlaku di production network filesystem.

---

## 14. Network I/O Performance

### 14.1 Bandwidth vs RTT

Transfer besar sensitif ke bandwidth.

Request kecil berulang sensitif ke RTT.

Contoh buruk:

```text
Download 10,000 small files one-by-one over high RTT network
```

Lebih baik:

- batch,
- parallel bounded,
- archive/manifest,
- HTTP/2 multiplexing jika cocok,
- connection reuse.

### 14.2 Socket Buffer

OS memiliki send buffer dan receive buffer. Java socket punya opsi seperti receive/send buffer size, tetapi OS dapat menyesuaikan.

Buffer terlalu kecil:

- throughput rendah.

Buffer terlalu besar:

- memory besar,
- latency meningkat karena buffer bloat,
- backpressure terlambat.

### 14.3 Slow Consumer

Jika remote membaca lambat, write bisa block atau partial.

Dalam blocking I/O:

```java
out.write(buffer);
```

bisa menggantung lama.

Dalam NIO:

```java
int n = channel.write(buffer);
```

bisa return 0 atau partial.

Desain perlu:

- write timeout,
- bounded pending queue,
- cancellation,
- backpressure,
- max response size,
- max upload size,
- per-client rate limit.

---

## 15. Compression Performance: CPU vs I/O Trade-off

Compression bisa mempercepat atau memperlambat transfer.

### 15.1 Compression Membantu Jika

- network lambat,
- storage write mahal,
- data sangat compressible,
- CPU tersedia,
- latency tambahan diterima.

### 15.2 Compression Merugikan Jika

- data sudah compressed/encrypted,
- CPU bottleneck,
- file kecil banyak,
- low-latency response,
- compression level terlalu tinggi,
- backpressure dari compressor tidak dikelola.

### 15.3 Compression Level

Level tinggi tidak selalu worth it.

```text
level rendah  : cepat, ratio sedang
level tinggi  : lambat, ratio lebih baik
```

Untuk production transfer, ukur:

- input MB/s,
- output MB/s,
- CPU usage,
- compression ratio,
- p95 latency,
- memory usage.

---

## 16. Benchmark I/O yang Benar

Benchmark I/O sulit karena banyak variabel eksternal.

### 16.1 Kesalahan Umum

1. Mengukur file kecil dari page cache lalu menyimpulkan disk cepat.
2. Tidak membedakan cold cache dan warm cache.
3. Tidak melakukan warmup JVM.
4. Mengabaikan JIT compilation.
5. Mengabaikan GC.
6. Menggunakan data terlalu kecil.
7. Menulis ke `/tmp` tmpfs tanpa sadar.
8. Membenchmark di laptop lalu menerapkan ke container production.
9. Tidak mengukur p95/p99.
10. Tidak mengukur CPU, memory, disk, network secara bersamaan.
11. Tidak memastikan hasil data benar.
12. Tidak mengulang benchmark cukup banyak.
13. Menggunakan microbenchmark untuk workload yang sebenarnya macro I/O.

### 16.2 Microbenchmark vs Macrobenchmark

JMH adalah harness resmi OpenJDK untuk membuat, menjalankan, dan menganalisis benchmark JVM skala nano/micro/milli/macro.

Cocok untuk:

- parser kecil,
- buffer copy,
- charset decoding routine,
- checksum implementation,
- framing encode/decode,
- allocation comparison.

Kurang cukup untuk:

- real disk throughput,
- network transfer end-to-end,
- remote service latency,
- object storage behavior,
- production filesystem.

Untuk I/O, sering perlu macrobenchmark.

### 16.3 Contoh JMH untuk Parser Kecil

```java
@State(Scope.Thread)
public class LineParserBenchmark {
    private String line;

    @Setup
    public void setup() {
        line = "12345,ACTIVE,2026-06-16,Some Name";
    }

    @Benchmark
    public ParsedRecord splitParser() {
        String[] parts = line.split(",");
        return new ParsedRecord(parts[0], parts[1], parts[2], parts[3]);
    }

    @Benchmark
    public ParsedRecord manualParser() {
        int p1 = line.indexOf(',');
        int p2 = line.indexOf(',', p1 + 1);
        int p3 = line.indexOf(',', p2 + 1);
        return new ParsedRecord(
                line.substring(0, p1),
                line.substring(p1 + 1, p2),
                line.substring(p2 + 1, p3),
                line.substring(p3 + 1)
        );
    }
}
```

Catatan:

- Ini hanya mengukur parser kecil, bukan end-to-end file ingestion.
- Hasilnya belum tentu mewakili production jika data shape berbeda.

### 16.4 Macrobenchmark File Processing

Untuk file ingestion, ukur end-to-end:

```text
input file size
record count
valid/invalid record count
records/sec
MB/sec
CPU usage
heap usage
allocation rate
GC pause
read throughput
write throughput
DB/API sink latency
error rate
```

Benchmark harus menjawab:

1. Apakah hasil benar?
2. Apakah memory bounded?
3. Apakah throughput stabil?
4. Apakah tail latency dapat diterima?
5. Apa bottleneck utama?
6. Apa yang terjadi saat sink lambat?
7. Apa yang terjadi saat file corrupt?
8. Apa yang terjadi saat job di-restart?

---

## 17. Profiling: Jangan Optimasi Tanpa Bukti

### 17.1 Java Flight Recorder

JDK Flight Recorder adalah framework profiling dan event collection yang built-in di JDK. Dengan JDK Mission Control, data JFR bisa dianalisis untuk melihat perilaku runtime JVM dan aplikasi.

JFR berguna untuk:

- CPU hotspot,
- allocation profile,
- GC event,
- file read/write event,
- socket read/write event,
- monitor blocking,
- thread park,
- exception rate,
- latency spike,
- safepoint.

Contoh menjalankan JFR:

```bash
jcmd <pid> JFR.start name=io-profile settings=profile duration=120s filename=io-profile.jfr
```

Atau saat start aplikasi:

```bash
java \
  -XX:StartFlightRecording=filename=app.jfr,duration=120s,settings=profile \
  -jar app.jar
```

### 17.2 Apa yang Dicari di JFR untuk I/O

Cari:

- banyak small file read,
- banyak socket read/write kecil,
- allocation tinggi di parser,
- blocking monitor,
- thread pool saturation,
- GC pause,
- direct buffer allocation,
- exception storm,
- DNS/connection stall,
- TLS handshake spike.

### 17.3 async-profiler

`async-profiler` berguna untuk CPU profiling, allocation profiling, wall-clock profiling, lock profiling, dan flame graph.

Gunakan untuk menjawab:

- CPU habis di parser atau compression?
- Banyak allocation dari mana?
- Thread banyak block di mana?
- Compression level terlalu mahal?
- Charset decoding mahal?
- Logging terlalu mahal?

### 17.4 OS-Level Tools

Java profiler tidak cukup jika bottleneck ada di OS/storage/network.

Gunakan juga:

```text
Linux:
- top / htop
- pidstat
- iostat
- vmstat
- sar
- ss
- netstat
- lsof
- strace secara hati-hati
- perf jika perlu

Container/Kubernetes:
- container CPU/memory usage
- RSS vs heap
- OOMKilled event
- filesystem throughput
- network throughput
- throttling metrics

Cloud:
- disk IOPS
- disk throughput
- burst balance
- network throughput
- load balancer metrics
- object storage latency
```

---

## 18. Observability untuk I/O Production

Aplikasi I/O tanpa metrics akan sulit dioperasikan.

### 18.1 Metrics Minimal File Processing

```text
file_ingestion_started_total
file_ingestion_completed_total
file_ingestion_failed_total
file_ingestion_bytes_total
file_ingestion_records_total
file_ingestion_invalid_records_total
file_ingestion_duration_seconds
file_ingestion_current_offset
file_ingestion_lag_seconds
file_ingestion_retry_total
file_ingestion_deadletter_total
```

### 18.2 Metrics Transfer

```text
transfer_started_total
transfer_completed_total
transfer_failed_total
transfer_bytes_total
transfer_duration_seconds
transfer_retried_total
transfer_resume_total
transfer_checksum_failed_total
transfer_active
transfer_pending_chunks
```

### 18.3 Metrics Resource

```text
jvm_memory_used_bytes
jvm_buffer_memory_used_bytes
jvm_gc_pause_seconds
process_resident_memory_bytes
process_open_fds
system_disk_read_bytes
system_disk_write_bytes
system_network_receive_bytes
system_network_transmit_bytes
```

### 18.4 Structured Logging

Log minimal:

```text
transferId
fileId
source
target
offset
chunkIndex
chunkSize
checksum
attempt
durationMs
result
errorCode
```

Jangan log:

- isi file sensitif,
- token,
- certificate private key,
- full payload,
- password,
- PII tanpa masking.

---

## 19. Step-by-Step Diagnosis I/O Lambat

Saat ada laporan “file processing lambat”, jangan langsung ubah API. Ikuti alur.

### Step 1 — Definisikan Lambatnya Apa

Tanyakan:

```text
Latency naik?
Throughput turun?
CPU tinggi?
Memory naik?
GC tinggi?
Disk penuh?
Network timeout?
Remote service lambat?
Hanya file tertentu?
Hanya jam tertentu?
```

### Step 2 — Ambil Baseline

Kumpulkan:

```text
file size
record count
duration
MB/sec
records/sec
CPU
heap
RSS
GC
disk read/write
network read/write
error rate
retry count
```

### Step 3 — Cek Resource Saturation

Jika CPU 100%:

- parser,
- compression,
- encryption,
- checksum,
- logging,
- serialization.

Jika disk busy:

- storage bottleneck,
- random I/O,
- fsync terlalu sering,
- small writes.

Jika memory naik:

- load-all,
- unbounded queue,
- buffer leak,
- direct memory leak,
- object accumulation.

Jika network lambat:

- remote peer,
- RTT,
- packet loss,
- TLS handshake,
- connection reuse,
- proxy.

### Step 4 — Profiling

Gunakan JFR/async-profiler untuk membuktikan:

- method hotspot,
- allocation source,
- blocking location,
- file/socket event.

### Step 5 — Buat Hipotesis Kecil

Contoh hipotesis:

```text
Throughput rendah karena buffer 1 KB menyebabkan terlalu banyak read loop.
GC tinggi karena line.split menghasilkan banyak object per record.
Tail latency tinggi karena force(true) dipanggil setiap record.
Memory naik karena chunk queue tidak bounded saat remote sink lambat.
```

### Step 6 — Uji Satu Perubahan

Jangan ubah 10 hal sekaligus.

Ubah satu:

- buffer size,
- batch size,
- compression level,
- parser,
- concurrency limit,
- retry policy,
- fsync frequency,
- direct buffer pooling.

### Step 7 — Validasi Correctness

Optimasi I/O yang merusak data adalah kegagalan.

Validasi:

- record count,
- checksum,
- ordering jika perlu,
- duplicate,
- missing data,
- restart behavior,
- partial failure.

---

## 20. Case Study 1: File Copy Besar Lambat

### Gejala

```text
Copy file 20 GB butuh 15 menit.
CPU rendah.
Heap rendah.
Disk read/write tidak maksimal.
```

### Dugaan Awal

- buffer terlalu kecil,
- copy path tidak optimal,
- storage target lambat,
- network filesystem,
- antivirus/scanner,
- fsync terlalu sering.

### Versi Naif

```java
try (InputStream in = Files.newInputStream(src);
     OutputStream out = Files.newOutputStream(dst)) {
    int b;
    while ((b = in.read()) != -1) {
        out.write(b);
    }
}
```

### Versi Buffered

```java
byte[] buffer = new byte[1024 * 1024];

try (InputStream in = Files.newInputStream(src);
     OutputStream out = Files.newOutputStream(dst)) {
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
    }
}
```

### Versi FileChannel

```java
try (FileChannel in = FileChannel.open(src, StandardOpenOption.READ);
     FileChannel out = FileChannel.open(dst,
             StandardOpenOption.CREATE,
             StandardOpenOption.TRUNCATE_EXISTING,
             StandardOpenOption.WRITE)) {

    long size = in.size();
    long pos = 0;
    while (pos < size) {
        long n = in.transferTo(pos, size - pos, out);
        if (n <= 0) {
            throw new EOFException("No progress at " + pos);
        }
        pos += n;
    }
}
```

### Evaluasi

Jangan hanya lihat durasi. Lihat:

- disk throughput,
- CPU,
- page cache state,
- target filesystem,
- checksum hasil,
- apakah file destination durable perlu `force`.

---

## 21. Case Study 2: CSV Import OOM

### Gejala

```text
Import CSV 5 GB gagal OOM.
```

### Versi Buruk

```java
List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
List<Record> records = lines.stream()
        .map(Parser::parse)
        .toList();
repository.saveAll(records);
```

Masalah:

- semua line masuk memory,
- semua record masuk memory,
- transaction mungkin terlalu besar,
- GC pressure tinggi,
- failure restart dari awal.

### Versi Lebih Aman

```java
static void importCsv(Path path, RecordSink sink) throws IOException {
    int batchSize = 1000;
    List<Record> batch = new ArrayList<>(batchSize);
    long lineNumber = 0;

    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        while ((line = reader.readLine()) != null) {
            lineNumber++;
            try {
                batch.add(Parser.parse(line));
            } catch (RuntimeException ex) {
                sink.deadLetter(lineNumber, line, ex);
                continue;
            }

            if (batch.size() == batchSize) {
                sink.persist(batch);
                batch.clear();
            }
        }
    }

    if (!batch.isEmpty()) {
        sink.persist(batch);
    }
}
```

### Optimasi Lanjutan

- checkpoint line/offset,
- streaming CSV parser yang benar,
- batch DB insert,
- bounded queue,
- separate read/parse/write stages,
- metrics records/sec,
- dead-letter file,
- checksum input.

---

## 22. Case Study 3: HTTP Download Besar Lambat dan Kadang Gagal

### Gejala

```text
Download file 2 GB kadang timeout.
Retry mengulang dari awal.
Kadang file hasil corrupt.
```

### Masalah Desain

- tidak ada resume,
- tidak ada checksum,
- timeout tidak dibedakan,
- file final ditulis langsung,
- partial file dianggap valid,
- retry non-idempotent.

### Pattern Lebih Baik

```text
1. download ke file .part
2. gunakan Range request jika resume didukung
3. track offset
4. verify checksum
5. force if durability required
6. atomic move ke final name
7. record manifest/status
```

### Metrics

```text
bytesDownloaded
downloadDuration
retryCount
resumeCount
checksumFailed
remoteStatusCode
currentOffset
```

---

## 23. Performance Anti-Pattern

### 23.1 Read All untuk Data Besar

```java
byte[] data = Files.readAllBytes(path);
```

Aman hanya jika ukuran bounded dan masuk akal.

### 23.2 Small Write Loop

```java
for (byte b : data) {
    out.write(b);
}
```

Gunakan buffer.

### 23.3 `flush()` Terlalu Sering

```java
for (Record record : records) {
    writer.write(record.toLine());
    writer.flush();
}
```

Flush per record bisa menghancurkan throughput.

### 23.4 `force(true)` Terlalu Sering

```java
for (Record record : records) {
    channel.write(encode(record));
    channel.force(true);
}
```

`force` mahal. Biasanya gunakan batching atau checkpoint.

### 23.5 Unbounded Queue antara Reader dan Writer

```java
BlockingQueue<Record> queue = new LinkedBlockingQueue<>();
```

Default `LinkedBlockingQueue` tanpa capacity bisa tumbuh sampai memory habis.

Gunakan:

```java
BlockingQueue<Record> queue = new ArrayBlockingQueue<>(10_000);
```

### 23.6 Logging di Hot Path

```java
log.info("Processed record {}", record);
```

per record untuk jutaan record dapat menjadi bottleneck dan membocorkan data.

### 23.7 Allocation Direct Buffer per Request

Sudah dibahas: mahal dan bisa direct memory OOM.

### 23.8 Benchmark Tanpa Correctness Check

Optimasi yang cepat tetapi corrupt bukan optimasi.

---

## 24. Checklist Performance Design untuk I/O

### 24.1 Sebelum Implementasi

- [ ] Apakah ukuran data bounded?
- [ ] Apakah data harus streaming?
- [ ] Apakah perlu checksum?
- [ ] Apakah perlu compression?
- [ ] Apakah perlu encryption/TLS?
- [ ] Apakah perlu resume?
- [ ] Apakah perlu atomic publish?
- [ ] Apakah perlu durability setelah write?
- [ ] Apakah sink bisa lambat?
- [ ] Apakah pipeline punya backpressure?
- [ ] Apakah concurrency dibatasi?
- [ ] Apakah memory per connection/job dihitung?

### 24.2 Saat Implementasi

- [ ] Hindari read-all untuk file besar.
- [ ] Gunakan buffer yang masuk akal.
- [ ] Perlakukan read/write sebagai partial.
- [ ] Jangan flush/force terlalu sering.
- [ ] Gunakan bounded queue.
- [ ] Hindari allocation per byte/record jika hot path.
- [ ] Tutup resource dengan jelas.
- [ ] Jangan abaikan return value transfer.
- [ ] Jangan log payload sensitif.

### 24.3 Saat Benchmark

- [ ] Bedakan cold cache dan warm cache.
- [ ] Ukur throughput dan latency.
- [ ] Ukur p95/p99.
- [ ] Ukur CPU, heap, RSS, GC.
- [ ] Ukur disk/network.
- [ ] Gunakan data representatif.
- [ ] Ulangi beberapa kali.
- [ ] Validasi correctness.
- [ ] Jangan menggeneralisasi microbenchmark.

### 24.4 Saat Production

- [ ] Ada metrics bytes/sec.
- [ ] Ada metrics records/sec.
- [ ] Ada error/retry/checksum metrics.
- [ ] Ada open file descriptor monitoring.
- [ ] Ada memory heap dan RSS monitoring.
- [ ] Ada GC monitoring.
- [ ] Ada dashboard per transfer/job.
- [ ] Ada runbook untuk stuck/slow transfer.

---

## 25. Ringkasan Mental Model

Performance I/O Java harus dipikirkan sebagai data path end-to-end:

```text
source → buffer → transform → sink
```

Dengan constraint:

```text
latency
throughput
memory
CPU
GC
direct memory
filesystem semantics
network behavior
remote peer speed
correctness
reliability
security
```

Kesimpulan penting:

1. **I/O cepat bukan hanya API cepat.** Bottleneck bisa ada di OS, storage, network, parsing, GC, atau remote peer.
2. **Buffer adalah alat batching.** Buffer terlalu kecil buruk; buffer terlalu besar juga bisa buruk.
3. **Page cache membuat benchmark mudah menipu.** Warm cache bukan performa disk sebenarnya.
4. **Direct buffer bukan silver bullet.** Ia berguna untuk native I/O tertentu, tetapi allocation dan lifecycle lebih mahal.
5. **`transferTo`/`transferFrom` bisa optimal, tetapi partial dan tidak selalu zero-copy.** Tetap loop dan ukur.
6. **Mmap cocok untuk random access/read-mostly workload tertentu, bukan semua file besar.**
7. **GC pressure sering berasal dari parsing dan intermediate object, bukan dari read operation itu sendiri.**
8. **Benchmark harus representatif dan memvalidasi correctness.**
9. **Profiling harus mengarahkan optimasi.** Jangan mengoptimasi berdasarkan feeling.
10. **Production I/O perlu observability.** Tanpa metrics, slow transfer hanya menjadi tebakan.

---

## 26. Latihan

### Latihan 1 — Benchmark Buffer Size

Buat program copy file 1 GB dengan buffer:

```text
4 KB
8 KB
64 KB
256 KB
1 MB
4 MB
```

Ukur:

- durasi,
- MB/sec,
- CPU usage,
- heap usage,
- RSS,
- GC.

Bandingkan cold cache dan warm cache.

### Latihan 2 — Bandingkan Stream vs FileChannel

Implementasikan copy dengan:

1. `InputStream` + `OutputStream` buffered,
2. `FileChannel.read/write`,
3. `FileChannel.transferTo`.

Validasi checksum file hasil.

### Latihan 3 — Profil CSV Parser

Buat parser CSV sederhana dengan:

1. `String.split`,
2. manual index parsing,
3. library CSV streaming.

Gunakan JFR atau JMH untuk melihat allocation dan throughput.

### Latihan 4 — Simulasi Slow Sink

Buat pipeline:

```text
reader → parser → bounded queue → slow writer
```

Bandingkan bounded queue dan unbounded queue.

Amati memory usage.

### Latihan 5 — Observability Mini

Tambahkan metrics sederhana:

```text
bytes processed
records processed
records/sec
MB/sec
error count
current offset
```

Cetak setiap 5 detik.

---

## Referensi Utama

- Oracle Java API Documentation — `FileChannel`, `ByteBuffer`, `MappedByteBuffer`, `Files`, `InputStream`, `OutputStream`.
- Oracle Java Mission Control / JDK Flight Recorder documentation.
- OpenJDK JMH — Java Microbenchmark Harness.
- Java platform documentation for NIO channels, buffers, and file APIs.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 026 — Large File Processing: Memory Safety, Streaming Pipeline, Pagination, Split, Merge, dan External Sort](./learn-java-io-nio-networking-data-transfer-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 028 — Concurrency and I/O: Thread-per-Connection, Virtual Thread, Async I/O, Locking, dan Backpressure](./learn-java-io-nio-networking-data-transfer-part-028.md)
