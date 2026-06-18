# learn-java-io-file-filesystem-storage-engineering — Part 30
# Performance Engineering: Syscalls, Page Cache, Buffering, Batching, and Directory Scale

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `30`  
> Target Java: 8 sampai 25  
> Level: Advanced / production engineering  
> Fokus: performance mental model untuk workload file dan filesystem di Java

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak hanya tahu API Java untuk membaca dan menulis file, tetapi mampu menjawab pertanyaan seperti:

1. Kenapa membaca 1 GB sekali bisa lebih cepat dari membaca 1 juta file kecil dengan total ukuran yang sama?
2. Kenapa benchmark file I/O sering terlihat sangat cepat pada run kedua?
3. Kenapa `BufferedInputStream` bisa mempercepat workload tertentu tetapi tidak menyelesaikan metadata bottleneck?
4. Kenapa `Files.walk()` pada directory besar bisa lambat walaupun file content tidak pernah dibaca?
5. Kenapa `FileChannel.transferTo()` kadang cepat sekali, kadang biasa saja?
6. Kenapa `flush()` bukan solusi performance maupun durability penuh?
7. Bagaimana membedakan bottleneck CPU, disk, page cache, syscall, directory lookup, network filesystem, dan application design?
8. Bagaimana mendesain file workflow yang throughput-friendly tanpa mengorbankan correctness?

Bagian ini adalah penghubung antara API-level knowledge dan production-level performance engineering.

---

## 1. Mental Model Utama: File I/O Performance Bukan Hanya Disk Speed

Kesalahan umum: mengira performa file hanya ditentukan oleh “kecepatan disk”.

Dalam praktik, file workload melewati banyak lapisan:

```text
Application code
  ↓
Java API / stream / channel / buffer
  ↓
JVM native boundary
  ↓
System call
  ↓
Kernel VFS
  ↓
Filesystem implementation
  ↓
Page cache / metadata cache / directory cache
  ↓
Block layer / network client / storage driver
  ↓
Actual storage: SSD / HDD / EBS / EFS / NFS / SMB / object gateway
```

Performance bottleneck bisa muncul di salah satu lapisan tersebut.

Contoh:

| Gejala | Kemungkinan bottleneck |
|---|---|
| Banyak file kecil sangat lambat | metadata lookup, syscall overhead, directory scale |
| Run pertama lambat, run kedua cepat | page cache |
| CPU tinggi saat baca file teks | decoding, parsing, allocation, regex, logging |
| Disk write terlihat cepat lalu tiba-tiba stall | dirty page writeback / throttling |
| Copy lokal cepat, copy ke NFS lambat | network latency, NFS consistency, server throughput |
| `Files.walk()` lambat walau tidak membaca isi file | directory traversal + metadata stat |
| `readAllBytes()` OOM | memory sizing, not storage speed |
| `fsync` membuat throughput jatuh | durability barrier / storage flush latency |

Top engineer tidak langsung bertanya “disk-nya cepat atau tidak”, tetapi bertanya:

```text
Apa workload pattern-nya?
Sequential atau random?
Large file atau small files?
Content-heavy atau metadata-heavy?
Read-only atau write-heavy?
Durability requirement seperti apa?
Local atau remote filesystem?
Single process atau multi process?
Single node atau multi node?
Warm cache atau cold cache?
```

---

## 2. Java API Surface untuk File Performance

Di Java 8–25, API utama yang sering muncul dalam performance discussion:

| API | Cocok untuk | Catatan performance |
|---|---|---|
| `Files.readAllBytes` | file kecil/sedang | seluruh isi masuk memory |
| `Files.readString` | text kecil/sedang, Java 11+ | convenience, bukan large file default |
| `Files.lines` | text stream line-by-line | lazy, harus close stream |
| `Files.newInputStream` | byte stream | unbuffered oleh API; biasanya bungkus buffer |
| `Files.newBufferedReader` | text buffered | baik untuk line-oriented text |
| `Files.newOutputStream` | byte output | option menentukan create/truncate/append |
| `Files.newBufferedWriter` | text buffered | mengurangi write kecil-kecil |
| `FileChannel` | random access, transfer, force, lock | explicit position/size/transfer/map |
| `SeekableByteChannel` | position-based read/write | abstraction untuk provider lain |
| `MappedByteBuffer` | random access besar | mmap trade-off besar |
| `DirectoryStream` | listing scalable | lebih eksplisit lifecycle-nya |
| `Files.walk/list/find` | traversal stream | lazy, weakly consistent, harus close |
| `walkFileTree` | robust recursive algorithm | lebih kuat untuk error/skip/cycle handling |

Dokumentasi `Files` Java 25 menegaskan banyak operasi file didelegasikan ke `FileSystemProvider`. Artinya, performance API yang sama bisa berbeda antara default local filesystem, ZIP filesystem, in-memory filesystem, network filesystem, dan provider custom.

---

## 3. Syscall Cost: Kenapa Banyak Operasi Kecil Mahal

### 3.1 Apa itu syscall?

System call adalah transisi dari user space ke kernel space.

Ketika Java melakukan operasi seperti:

```java
Files.exists(path);
Files.size(path);
Files.readAttributes(path, BasicFileAttributes.class);
Files.newInputStream(path);
Files.delete(path);
```

JVM pada akhirnya meminta OS melakukan operasi tertentu.

Transisi ini tidak gratis. Ia melibatkan:

- boundary crossing user/kernel,
- validasi argument,
- permission check,
- VFS lookup,
- filesystem-specific logic,
- potensi blocking I/O,
- potensi network roundtrip jika remote filesystem.

### 3.2 Banyak syscall kecil sering lebih buruk dari sedikit syscall besar

Contoh buruk:

```java
for (Path p : paths) {
    if (Files.exists(p)) {
        long size = Files.size(p);
        FileTime modified = Files.getLastModifiedTime(p);
        boolean regular = Files.isRegularFile(p);
        // process
    }
}
```

Masalah:

- `exists` bisa syscall.
- `size` bisa syscall.
- `getLastModifiedTime` bisa syscall.
- `isRegularFile` bisa syscall.
- Ada TOCTOU race.
- Pada network filesystem, setiap metadata call bisa mahal.

Lebih baik batch metadata:

```java
for (Path p : paths) {
    try {
        BasicFileAttributes attrs = Files.readAttributes(
                p,
                BasicFileAttributes.class,
                LinkOption.NOFOLLOW_LINKS
        );

        if (!attrs.isRegularFile()) {
            continue;
        }

        long size = attrs.size();
        FileTime modified = attrs.lastModifiedTime();
        // process
    } catch (NoSuchFileException e) {
        // disappeared concurrently; tolerate if workflow allows
    }
}
```

Mental model:

```text
Prefer one metadata read that gives multiple facts
rather than multiple separate helper calls.
```

### 3.3 Syscall amplification

Syscall amplification terjadi saat satu business operation menghasilkan terlalu banyak OS-level operations.

Contoh business operation:

> “Import all files in folder.”

Naive implementation:

```text
for each file:
  exists
  isRegularFile
  size
  getLastModifiedTime
  readAllBytes
  compute hash
  move
  set permissions
  delete temp
```

Jika ada 1 juta file, kamu bisa menghasilkan jutaan sampai puluhan juta syscall.

Solusi bukan selalu “pakai thread lebih banyak”. Kalau bottleneck-nya metadata, concurrency berlebihan bisa memperburuk pressure ke filesystem.

---

## 4. Page Cache: Kenapa Run Kedua Lebih Cepat

### 4.1 Apa itu page cache?

Pada OS seperti Linux, buffered file I/O biasanya melewati page cache. Page cache menyimpan halaman file di memory kernel agar read berikutnya tidak perlu ke storage fisik.

Simplified read path:

```text
Java read()
  ↓
syscall read
  ↓
page cache lookup
  ├─ cache hit  → copy data from memory to process
  └─ cache miss → load from storage into page cache, then copy
```

Write path simplified:

```text
Java write()
  ↓
syscall write
  ↓
data copied into kernel page cache
  ↓
marked dirty
  ↓
later flushed to storage by writeback
```

Konsekuensi penting:

- `write()` bisa return sebelum data benar-benar berada di disk.
- `read()` bisa cepat karena data sudah cached.
- Benchmark tanpa mengontrol cache bisa misleading.
- Memory pressure dari aplikasi lain bisa memengaruhi file performance.

Linux kernel documentation menyebut buffered I/O sebagai default path dan file contents dapat dicache di page cache; dirty cache akan ditulis kembali kemudian dan bisa dipaksa dengan `fsync`-like mechanisms.

### 4.2 Page cache bukan Java heap

Page cache bukan bagian dari Java heap.

Jika aplikasi Java memakai heap 2 GB di server 8 GB, sisa memory OS bisa digunakan untuk page cache. Jika heap dinaikkan terlalu besar, page cache bisa menyusut dan file workload bisa lebih lambat.

Mental model:

```text
Max heap terlalu besar bisa mencuri ruang dari page cache.
Untuk workload file-heavy, memory OS juga penting.
```

Contoh:

```text
Server memory: 16 GB
Java heap: 14 GB
Native/metaspace/thread: 1 GB
OS free/page cache: ~1 GB
```

Untuk workload baca file berulang, ini mungkin buruk karena page cache kecil.

### 4.3 Cold cache vs warm cache

Benchmark:

```text
Run 1: baca file 10 GB → 8 detik
Run 2: baca file yang sama → 1 detik
```

Run kedua belum tentu aplikasi lebih optimal. Bisa jadi data sudah berada di page cache.

Dalam test performance, bedakan:

| Mode | Makna |
|---|---|
| Cold cache | mengukur storage + OS + app path |
| Warm cache | mengukur memory/cache + app path |
| Mixed cache | lebih mirip production tertentu |

Top engineer tidak menyimpulkan dari satu angka throughput. Ia bertanya:

```text
Apakah cache state dikontrol?
Apakah workload merepresentasikan production?
Apakah data size lebih besar dari memory?
Apakah test membaca file yang sama berulang?
```

---

## 5. Buffering: Java Buffer, Kernel Buffer, dan Storage Cache

### 5.1 Buffering terjadi di beberapa layer

Ada banyak “buffer”:

```text
Application byte[] / char[]
BufferedInputStream / BufferedReader buffer
Direct ByteBuffer / heap ByteBuffer
Kernel page cache
Filesystem journal buffer
Storage controller cache
Disk/SSD internal cache
```

Karena itu, mengatakan “pakai buffer agar cepat” terlalu dangkal. Pertanyaannya:

```text
Buffer di layer mana?
Mengurangi cost apa?
Syscall? allocation? decoding? disk access? network roundtrip?
```

### 5.2 `Files.newInputStream` dan buffering

`Files.newInputStream(path)` membuka stream byte. API ini sendiri bukan high-level buffered reader. Untuk banyak read kecil, bungkus dengan `BufferedInputStream`.

```java
try (InputStream in = new BufferedInputStream(Files.newInputStream(path))) {
    byte[] buf = new byte[64 * 1024];
    int n;
    while ((n = in.read(buf)) != -1) {
        consume(buf, 0, n);
    }
}
```

Tanpa buffering, kode yang membaca 1 byte berkali-kali bisa sangat buruk:

```java
try (InputStream in = Files.newInputStream(path)) {
    int b;
    while ((b = in.read()) != -1) {
        consumeByte(b);
    }
}
```

Masalahnya bukan hanya disk. Masalahnya bisa jumlah method calls dan syscall/read kecil.

### 5.3 Ukuran buffer

Tidak ada satu ukuran buffer yang selalu terbaik.

Guideline praktis:

| Workload | Buffer awal masuk akal |
|---|---:|
| Text line processing | default `BufferedReader` sering cukup |
| Sequential binary read | 64 KiB sampai 1 MiB |
| Copy besar | 256 KiB sampai beberapa MiB, ukur |
| Network filesystem | buffer lebih besar bisa membantu, tetapi latency tetap faktor |
| Very small files | buffer besar tidak membantu banyak |

Contoh configurable buffer:

```java
static void copyStreaming(Path source, Path target, int bufferSize) throws IOException {
    try (InputStream in = new BufferedInputStream(Files.newInputStream(source), bufferSize);
         OutputStream out = new BufferedOutputStream(Files.newOutputStream(
                 target,
                 StandardOpenOption.CREATE_NEW,
                 StandardOpenOption.WRITE
         ), bufferSize)) {

        byte[] buffer = new byte[bufferSize];
        int n;
        while ((n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
        }
    }
}
```

Catatan:

- Terlalu kecil: banyak syscall/method overhead.
- Terlalu besar: boros memory, cache pollution, tidak selalu lebih cepat.
- Banyak concurrent worker × buffer besar = memory spike.

Jika 500 worker masing-masing punya buffer 4 MiB:

```text
500 × 4 MiB = 2 GiB hanya untuk buffer
```

Belum termasuk heap object lain.

### 5.4 Buffered text read dan decoding

Untuk text file:

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Bottleneck bisa bukan I/O, tetapi:

- UTF-8 decoding,
- line allocation,
- string processing,
- regex,
- JSON parsing,
- logging per line,
- database write per line.

Jadi optimasi file read tanpa mengukur downstream processing sering salah sasaran.

---

## 6. Sequential vs Random Access

### 6.1 Sequential access

Sequential access:

```text
read offset 0 → 64K → 128K → 192K → ...
```

Biasanya lebih cepat karena:

- OS bisa read-ahead.
- Storage bisa melayani linear access lebih efisien.
- Page cache behavior lebih predictable.
- CPU branch/data flow lebih stabil.

Java style:

```java
try (InputStream in = new BufferedInputStream(Files.newInputStream(path))) {
    byte[] buffer = new byte[256 * 1024];
    int n;
    while ((n = in.read(buffer)) != -1) {
        process(buffer, n);
    }
}
```

### 6.2 Random access

Random access:

```text
read offset 1048576
read offset 4096
read offset 999424
read offset 8192
```

Bisa mahal karena:

- read-ahead tidak efektif,
- cache locality buruk,
- storage random I/O lebih mahal,
- banyak small positioned read.

Java style:

```java
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
    ByteBuffer buf = ByteBuffer.allocate(4096);
    for (long offset : offsets) {
        buf.clear();
        ch.read(buf, offset);
        buf.flip();
        process(buf);
    }
}
```

Jika offsets banyak dan random, pertimbangkan:

- sorting offsets jika semantics memungkinkan,
- grouping adjacent reads,
- building index,
- using mmap jika access pattern cocok,
- using database/storage engine jika query pattern kompleks.

---

## 7. Small File Problem

### 7.1 Kenapa banyak file kecil lambat?

Misal:

```text
1 file × 1 GB
vs
1,000,000 files × 1 KB
```

Total data mirip, tetapi performanya sangat berbeda.

Banyak file kecil mahal karena setiap file butuh:

- directory lookup,
- permission check,
- metadata read,
- open handle,
- close handle,
- allocation object Java,
- error handling path,
- mungkin checksum/validation per file,
- maybe one transaction per file.

Data bytes-nya kecil, metadata overhead-nya besar.

### 7.2 Tanda workload small-file bottleneck

Gejala:

- CPU system time tinggi.
- Disk throughput MB/s rendah, tetapi operasi per detik tinggi.
- Banyak `openat`, `stat`, `close` jika dilihat via OS tools.
- Directory listing lambat.
- Network filesystem latency sangat terasa.
- Thread banyak tapi throughput tidak naik.

### 7.3 Strategi mengatasi small file problem

Beberapa pendekatan:

| Strategi | Kapan cocok | Trade-off |
|---|---|---|
| Bundle file kecil ke archive/segment | ingest/export batch | perlu index/extraction |
| Manifest + payload besar | banyak metadata kecil | desain format lebih kompleks |
| Object storage prefix design | distributed storage | consistency/listing semantics berbeda |
| Database BLOB/reference | butuh transaction/query | DB storage cost/backup impact |
| Append-only segment file | high-throughput event/file records | perlu recovery/compaction |
| Directory sharding | terlalu banyak entry per folder | path layout lebih kompleks |
| Batch metadata read | traversal/listing besar | tidak menghilangkan semua overhead |
| Reduce per-file logging | high volume processor | observability perlu aggregate metric |

### 7.4 Directory sharding

Buruk:

```text
/storage/files/000000001.dat
/storage/files/000000002.dat
...
/storage/files/999999999.dat
```

Lebih baik:

```text
/storage/files/00/00/00/000000001.dat
/storage/files/00/00/01/000001234.dat
/storage/files/ab/cd/ef/abcdef123456.dat
```

Hash-based layout:

```java
static Path shardBySha256(Path root, String hexHash) {
    return root
            .resolve(hexHash.substring(0, 2))
            .resolve(hexHash.substring(2, 4))
            .resolve(hexHash.substring(4, 6))
            .resolve(hexHash);
}
```

Benefit:

- directory entry count lebih terkendali,
- listing per directory lebih cepat,
- cleanup lebih bisa dipartisi,
- parallel processing lebih mudah.

Trade-off:

- path lebih panjang,
- operational browsing lebih sulit,
- perlu helper function konsisten.

---

## 8. Directory Scale dan Metadata-Heavy Workloads

### 8.1 Listing tidak sama dengan processing content

`Files.list(dir)` hanya listing immediate entries, tetapi tetap harus berinteraksi dengan directory structure.

`Files.walk(root)` traversal recursive dan bisa memicu banyak metadata access.

`Files.find(root, depth, matcher)` dapat membaca attributes untuk predicate.

Pada directory besar, bottleneck bisa:

- membaca directory entries,
- sorting jika kamu melakukan sort,
- reading metadata,
- object allocation `Path`,
- permission error handling,
- symlink handling,
- network roundtrip.

### 8.2 Jangan sort kecuali perlu

Buruk untuk jutaan file:

```java
List<Path> all = Files.walk(root)
        .sorted()
        .collect(Collectors.toList());
```

Masalah:

- materialize semua path di memory,
- sorting O(n log n),
- traversal tidak bisa streaming penuh,
- memory pressure tinggi.

Lebih baik streaming pipeline dengan limit/backpressure:

```java
try (Stream<Path> stream = Files.walk(root)) {
    Iterator<Path> it = stream.iterator();
    while (it.hasNext()) {
        Path p = it.next();
        process(p);
    }
}
```

Atau gunakan `walkFileTree` untuk kontrol error dan state lebih baik.

### 8.3 `DirectoryStream` untuk directory besar

`DirectoryStream` sering lebih eksplisit untuk listing satu directory besar:

```java
try (DirectoryStream<Path> entries = Files.newDirectoryStream(dir)) {
    for (Path entry : entries) {
        process(entry);
    }
}
```

Kelebihan:

- lifecycle jelas,
- tidak perlu collect semua,
- cocok untuk satu-level listing besar,
- bisa pakai glob/filter.

Contoh filter:

```java
try (DirectoryStream<Path> entries = Files.newDirectoryStream(dir, "*.json")) {
    for (Path entry : entries) {
        process(entry);
    }
}
```

Catatan: filter glob tetap provider/filesystem dependent dalam detail tertentu. Jangan jadikan security boundary.

### 8.4 Hindari repeated full scan

Anti-pattern:

```text
Every 5 seconds:
  Files.walk(/huge-root)
  scan all files
  process new files
```

Jika ada jutaan file, ini membakar metadata I/O.

Alternatif:

- `WatchService` + periodic reconciliation scan,
- marker/checkpoint,
- partitioned scan,
- manifest-based handoff,
- event queue from producer,
- inbox directory dengan atomic rename,
- database index of discovered files.

---

## 9. Batching: Throughput Datang dari Mengurangi Per-Operation Cost

### 9.1 Batching read/write

Daripada menulis per record:

```java
for (Record r : records) {
    Files.writeString(path, r.toLine() + "\n", StandardOpenOption.APPEND);
}
```

Masalah:

- open/close file per record,
- possible metadata update per record,
- syscall overhead besar,
- durability tidak jelas,
- append atomicity system-dependent.

Lebih baik:

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND
)) {
    for (Record r : records) {
        writer.write(r.toLine());
        writer.newLine();
    }
}
```

Lebih baik lagi untuk high-throughput structured log:

- group record ke segment,
- write binary framed records,
- periodic force berdasarkan policy,
- recover partial record saat startup.

### 9.2 Batch metadata update

Hindari:

```java
for (Path p : files) {
    Files.setLastModifiedTime(p, time);
    Files.setPosixFilePermissions(p, perms);
    Files.setOwner(p, owner);
}
```

Ini mungkin tidak bisa sepenuhnya dibatch via Java portable API, tetapi bisa dioptimalkan secara desain:

- set attributes saat create jika memungkinkan,
- hindari chmod-after-create race,
- jangan update metadata yang tidak dibutuhkan,
- group operation per directory/filesystem,
- jangan lakukan metadata write di hot path.

### 9.3 Batch downstream effects

Sering kali file read cepat, tetapi downstream lambat:

```text
read line
  → parse JSON
  → insert DB row
  → log success
  → commit
```

Jika commit per line, bottleneck ada di DB transaction, bukan file I/O.

Desain lebih baik:

```text
read N records
  → validate batch
  → bulk insert
  → commit
  → write checkpoint
```

---

## 10. Copy Performance: Stream, Channel, Transfer

### 10.1 `Files.copy`

Untuk copy sederhana:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Ini delegasi ke provider. Bisa optimal, bisa biasa saja, tergantung provider/OS/filesystem.

Gunakan ketika:

- semantics cocok,
- tidak perlu progress granular,
- tidak perlu custom throttling,
- tidak perlu checksum inline,
- tidak perlu resumable copy.

### 10.2 Manual buffered copy

```java
static long copyWithBuffer(Path source, Path target, int bufferSize) throws IOException {
    long total = 0;
    byte[] buffer = new byte[bufferSize];

    try (InputStream in = new BufferedInputStream(Files.newInputStream(source), bufferSize);
         OutputStream out = new BufferedOutputStream(Files.newOutputStream(
                 target,
                 StandardOpenOption.CREATE_NEW,
                 StandardOpenOption.WRITE
         ), bufferSize)) {

        int n;
        while ((n = in.read(buffer)) != -1) {
            out.write(buffer, 0, n);
            total += n;
        }
    }
    return total;
}
```

Cocok jika:

- butuh progress,
- butuh transform,
- butuh checksum sambil copy,
- butuh throttling,
- butuh cancellation.

### 10.3 `FileChannel.transferTo` / `transferFrom`

`FileChannel` menyediakan method transfer antar channel.

```java
static void copyWithTransferTo(Path source, Path target) throws IOException {
    try (FileChannel in = FileChannel.open(source, StandardOpenOption.READ);
         FileChannel out = FileChannel.open(target,
                 StandardOpenOption.CREATE_NEW,
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
    }
}
```

Kenapa loop diperlukan?

Karena transfer tidak dijamin memindahkan seluruh requested bytes dalam satu call.

Kapan cocok:

- large file copy,
- channel-to-channel transfer,
- mungkin memanfaatkan OS optimization.

Kapan tidak otomatis menang:

- source/target provider tidak mendukung optimal path,
- network filesystem bottleneck,
- encrypted/compressed transformation diperlukan,
- checksum inline diperlukan,
- OS/JDK behavior berbeda.

---

## 11. Direct Buffer vs Heap Buffer

### 11.1 Heap buffer

```java
ByteBuffer heap = ByteBuffer.allocate(64 * 1024);
```

Data berada di Java heap.

Kelebihan:

- allocation murah relatif,
- GC-visible,
- mudah digunakan,
- baik untuk banyak workload biasa.

Kekurangan:

- native I/O mungkin perlu copy ke native buffer internal,
- GC pressure jika banyak buffer temporary.

### 11.2 Direct buffer

```java
ByteBuffer direct = ByteBuffer.allocateDirect(64 * 1024);
```

Data berada di off-heap/native memory.

Kelebihan:

- bisa lebih cocok untuk channel I/O,
- mengurangi copy tertentu,
- berguna untuk long-lived reusable buffer.

Kekurangan:

- allocation/deallocation lebih mahal,
- memory tidak terlihat langsung sebagai heap,
- bisa memicu native memory pressure,
- perlu reuse, bukan allocate per operation.

Anti-pattern:

```java
while (...) {
    ByteBuffer buf = ByteBuffer.allocateDirect(1024 * 1024);
    ch.read(buf);
}
```

Lebih baik:

```java
ByteBuffer buf = ByteBuffer.allocateDirect(1024 * 1024);
while (...) {
    buf.clear();
    int n = ch.read(buf);
    if (n == -1) break;
    buf.flip();
    process(buf);
}
```

### 11.3 Jangan optimasi direct buffer sebelum profiling

Direct buffer bukan magic. Untuk banyak file workload, bottleneck bukan copy heap-native, tetapi:

- disk latency,
- metadata,
- parsing,
- allocation string,
- network filesystem,
- synchronization,
- logging,
- database.

---

## 12. Write Performance, Dirty Pages, dan `fsync`

### 12.1 Write terlihat cepat karena masuk page cache

```java
Files.write(path, data);
```

Operasi write bisa selesai setelah data diterima kernel, bukan setelah NAND/disk fisik menyimpan data secara durable.

Jika durability penting, perlu membahas:

- `FileChannel.force(boolean metaData)`,
- `StandardOpenOption.SYNC`,
- `StandardOpenOption.DSYNC`,
- atomic update pattern,
- directory fsync concept,
- filesystem/journal semantics.

### 12.2 `force` mahal karena durability barrier

```java
try (FileChannel ch = FileChannel.open(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE)) {
    ch.write(buffer);
    ch.force(true);
}
```

`force(true)` bisa sangat mahal karena meminta content dan metadata dipaksa ke storage device.

Jika dilakukan per record:

```text
write record 1 → force
write record 2 → force
write record 3 → force
```

Throughput bisa jatuh drastis.

Lebih baik desain policy:

| Policy | Cocok untuk | Risiko |
|---|---|---|
| force per record | transaksi sangat kritikal | throughput rendah |
| force per batch | durability batch | record terakhir bisa hilang |
| force per interval | log/event | loss window berbasis waktu |
| no explicit force | cache/temp/intermediate | crash loss acceptable |

### 12.3 Throughput vs durability adalah trade-off, bukan bug

Tidak ada desain yang sekaligus:

```text
ultra-fast
zero data loss on crash
portable across all filesystem/provider
simple
cheap
```

Kamu harus memilih invariant.

Contoh:

```text
Invariant A:
  Setelah API return success, file harus survive process crash.

Invariant B:
  Setelah API return success, file harus survive OS crash/power loss.

Invariant C:
  File boleh hilang kalau crash, karena bisa regenerate.
```

Setiap invariant butuh strategi berbeda.

---

## 13. Concurrency: More Threads Tidak Selalu Faster

### 13.1 Parallelism bisa membantu atau merusak

Parallel file processing membantu jika:

- workload CPU-heavy setelah read,
- banyak file independent,
- storage bisa melayani parallel I/O,
- network latency bisa disembunyikan,
- directory partitioning baik.

Parallelism merusak jika:

- semua thread berebut satu disk lambat,
- random I/O meningkat,
- page cache thrashing,
- terlalu banyak open file handles,
- metadata server overload,
- GC pressure karena buffer besar,
- logging contention.

### 13.2 Bounded concurrency

Jangan pakai unbounded parallel stream untuk file tree besar:

```java
Files.walk(root).parallel().forEach(this::process);
```

Masalah:

- sulit kontrol open handles,
- error handling rumit,
- ordering tidak jelas,
- pressure ke filesystem tidak terkendali.

Lebih baik bounded executor:

```java
ExecutorService pool = Executors.newFixedThreadPool(workerCount);
Semaphore inFlight = new Semaphore(maxInFlight);

try (Stream<Path> stream = Files.walk(root)) {
    Iterator<Path> it = stream.iterator();
    while (it.hasNext()) {
        Path path = it.next();
        inFlight.acquireUninterruptibly();
        pool.submit(() -> {
            try {
                processFile(path);
            } catch (Exception e) {
                recordFailure(path, e);
            } finally {
                inFlight.release();
            }
        });
    }
} finally {
    pool.shutdown();
}
```

Dalam production, pakai structured lifecycle yang lebih rapi dan pastikan semua task selesai/ditunggu.

### 13.3 Per-worker buffer budget

Jika setiap worker:

- input buffer 1 MiB,
- output buffer 1 MiB,
- parse buffer 2 MiB,

Maka 100 worker:

```text
100 × 4 MiB = 400 MiB buffer
```

Belum termasuk object lain.

Concurrency harus dihitung dengan memory budget.

---

## 14. File Descriptor / Handle Pressure

Setiap file terbuka memakai OS resource.

Masalah umum:

```java
Stream<Path> s = Files.list(dir);
// lupa close
```

Atau:

```java
List<BufferedReader> readers = paths.stream()
        .map(p -> Files.newBufferedReader(p))
        .collect(toList());
```

Bisa menyebabkan:

- `Too many open files` di Unix-like system,
- delete/move gagal di Windows,
- resource leak long-running process,
- unexplained production degradation.

Guideline:

```text
Open late.
Close early.
Never keep file handles across slow downstream operation unless necessary.
Bound concurrently open files.
Always close stream from Files.list/walk/find/lines.
```

Contoh benar:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    lines.forEach(this::processLine);
}
```

---

## 15. Allocation dan GC dalam File Workload

File I/O performance sering kalah oleh allocation.

Contoh buruk:

```java
try (BufferedReader r = Files.newBufferedReader(path)) {
    String line;
    while ((line = r.readLine()) != null) {
        Map<String, Object> parsed = parseJsonToMap(line);
        log.info("parsed {}", parsed);
        process(parsed);
    }
}
```

Kemungkinan bottleneck:

- satu `String` per line,
- banyak object dari JSON parse,
- boxing/unboxing,
- map allocation,
- log formatting,
- GC pause/CPU.

Optimasi file buffer tidak banyak membantu jika parser membanjiri heap.

Approach:

- ukur allocation rate,
- reuse buffer untuk binary workflow,
- hindari logging per record,
- batch parse/insert,
- gunakan streaming parser untuk format besar,
- pertimbangkan binary structured format jika text parsing bottleneck.

---

## 16. Measuring File I/O Correctly

### 16.1 Jangan benchmark tanpa pertanyaan

Benchmark harus menjawab pertanyaan spesifik:

```text
Apakah bottleneck read throughput sequential?
Apakah bottleneck metadata traversal?
Apakah buffer size optimal?
Apakah concurrent worker terlalu banyak?
Apakah fsync policy terlalu mahal?
Apakah network filesystem latency dominan?
```

### 16.2 Minimum metrics aplikasi

Instrumentasi minimal:

| Metric | Kenapa penting |
|---|---|
| files processed/sec | throughput logical |
| bytes read/sec | throughput data |
| bytes written/sec | write throughput |
| read latency histogram | tail latency |
| write latency histogram | tail latency |
| open latency | metadata/path issue |
| force/fsync latency | durability bottleneck |
| directory scan duration | traversal bottleneck |
| queue depth | backpressure |
| active workers | concurrency actual |
| open file failures | handle/permission issue |
| retry count | instability |
| disk usable space | capacity guardrail |
| error by exception type | failure classification |

### 16.3 Bedakan wall-clock, CPU time, dan blocked time

Jika wall-clock tinggi tapi CPU rendah, kemungkinan:

- blocked I/O,
- network filesystem latency,
- lock contention,
- waiting downstream.

Jika CPU tinggi, kemungkinan:

- parsing,
- checksum/hash,
- compression,
- encryption,
- allocation/GC,
- logging,
- path manipulation overhead.

### 16.4 Benchmark traps

| Trap | Kenapa menipu |
|---|---|
| Membaca file sama berulang | page cache warm |
| Dataset lebih kecil dari RAM | tidak represent storage pressure |
| Tidak menutup stream | resource leak tidak terlihat di short test |
| Tidak mengukur tail latency | rata-rata terlihat bagus |
| Tidak mengukur error/retry | production failure hidden |
| Benchmark di laptop dev | beda filesystem/storage/runtime |
| Mengabaikan downstream | bottleneck pindah ke DB/parser |
| Tidak mengontrol concurrency | hasil tidak reproducible |
| Tidak mencatat Java version | API/runtime behavior bisa beda |
| Tidak mencatat filesystem | ext4/xfs/apfs/ntfs/nfs beda |

---

## 17. Practical Diagnostic Decision Tree

### 17.1 Jika file read lambat

Tanya:

```text
Apakah file besar atau banyak file kecil?
Apakah read sequential atau random?
Apakah run kedua lebih cepat?
Apakah CPU tinggi?
Apakah filesystem local atau remote?
Apakah decoding/parsing berat?
Apakah ada antivirus/scanner?
Apakah banyak concurrent reader?
```

Langkah:

1. Ukur bytes/sec.
2. Ukur files/sec.
3. Ukur CPU user/system.
4. Ukur GC/allocation.
5. Ukur latency open/read/close.
6. Uji cold vs warm cache.
7. Uji buffer size.
8. Uji worker count.

### 17.2 Jika file write lambat

Tanya:

```text
Apakah force/fsync dipakai?
Apakah write kecil-kecil?
Apakah append concurrent?
Apakah target filesystem local/remote?
Apakah disk hampir penuh?
Apakah dirty page throttling terjadi?
Apakah metadata update banyak?
```

Langkah:

1. Ukur write latency tanpa `force`.
2. Ukur `force` latency terpisah.
3. Uji batch size.
4. Uji buffer size.
5. Uji segment file.
6. Uji disk usable space.
7. Uji concurrency lebih rendah.

### 17.3 Jika traversal lambat

Tanya:

```text
Berapa jumlah directory?
Berapa jumlah file per directory?
Apakah melakukan stat berkali-kali?
Apakah sorting/collecting semua path?
Apakah mengikuti symlink?
Apakah permission error banyak?
Apakah network filesystem?
```

Langkah:

1. Ukur entries/sec.
2. Pisahkan listing dari processing.
3. Hindari sort.
4. Batch attributes.
5. Shard directory.
6. Pakai checkpoint/manifest.
7. Hindari repeated full scan.

---

## 18. Production Pattern: High-Throughput File Intake

### 18.1 Naive intake

```text
Watcher sees file
  → read immediately
  → process
  → move to done
```

Masalah:

- file mungkin belum selesai ditulis producer,
- watcher event bisa hilang/coalesce,
- no backpressure,
- no recovery state,
- no idempotency,
- no capacity guardrail.

### 18.2 Better intake layout

```text
/inbox
  /staging
  /ready
  /processing
  /done
  /error
  /quarantine
```

Producer:

```text
write to staging/tmp-name
fsync if needed
atomic rename to ready/final-name
```

Consumer:

```text
scan ready
claim by atomic move ready → processing
process
move processing → done or error
```

Performance benefits:

- atomic handoff avoids reading partial files,
- claim by rename avoids lock file overhead,
- scan can focus on `ready`,
- error handling separated,
- retry can be bounded,
- metrics per state directory.

### 18.3 Bounded worker design

```java
final class FileIntakeEngine {
    private final Path readyDir;
    private final Path processingDir;
    private final Path doneDir;
    private final Path errorDir;
    private final ExecutorService workers;
    private final Semaphore permits;

    FileIntakeEngine(Path readyDir,
                     Path processingDir,
                     Path doneDir,
                     Path errorDir,
                     int workerCount,
                     int maxInFlight) {
        this.readyDir = readyDir;
        this.processingDir = processingDir;
        this.doneDir = doneDir;
        this.errorDir = errorDir;
        this.workers = Executors.newFixedThreadPool(workerCount);
        this.permits = new Semaphore(maxInFlight);
    }

    void scanOnce() throws IOException {
        try (DirectoryStream<Path> entries = Files.newDirectoryStream(readyDir)) {
            for (Path ready : entries) {
                if (!Files.isRegularFile(ready, LinkOption.NOFOLLOW_LINKS)) {
                    continue;
                }

                permits.acquireUninterruptibly();
                workers.submit(() -> {
                    try {
                        processOne(ready);
                    } catch (Exception e) {
                        recordFailure(ready, e);
                    } finally {
                        permits.release();
                    }
                });
            }
        }
    }

    private void processOne(Path ready) throws IOException {
        Path processing = processingDir.resolve(ready.getFileName().toString());

        try {
            Files.move(ready, processing, StandardCopyOption.ATOMIC_MOVE);
        } catch (NoSuchFileException e) {
            return; // another worker/process claimed it or producer removed it
        } catch (AtomicMoveNotSupportedException e) {
            // depending on deployment, fail fast or use provider-specific safe claim strategy
            throw e;
        }

        try {
            processContent(processing);
            Files.move(processing,
                    doneDir.resolve(processing.getFileName().toString()),
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception e) {
            Files.move(processing,
                    errorDir.resolve(processing.getFileName().toString()),
                    StandardCopyOption.REPLACE_EXISTING);
            throw e;
        }
    }

    private void processContent(Path file) throws IOException {
        try (InputStream in = new BufferedInputStream(Files.newInputStream(file), 256 * 1024)) {
            byte[] buffer = new byte[256 * 1024];
            while (in.read(buffer) != -1) {
                // parse/process
            }
        }
    }

    private void recordFailure(Path file, Exception e) {
        // aggregate metrics/logging, not noisy per-byte/per-line logs
    }
}
```

Catatan:

- Ini skeleton, bukan final production code.
- Perlu shutdown handling.
- Perlu duplicate filename policy.
- Perlu retry/quarantine.
- Perlu checksum/manifest jika correctness butuh.
- Perlu capacity guardrail.
- Perlu recovery scan untuk `processing` saat startup.

---

## 19. Performance Checklist untuk File Workload

### 19.1 Workload shape

- [ ] Berapa jumlah file?
- [ ] Berapa ukuran rata-rata dan percentile file?
- [ ] Banyak file kecil atau sedikit file besar?
- [ ] Sequential atau random access?
- [ ] Read-heavy, write-heavy, atau metadata-heavy?
- [ ] Local atau remote filesystem?
- [ ] Single process, multi process, atau multi node?
- [ ] Cold cache atau warm cache?

### 19.2 API usage

- [ ] Convenience API hanya untuk file kecil/sedang?
- [ ] Stream dari `Files.lines/list/walk/find` selalu ditutup?
- [ ] Metadata dibaca batch dengan `readAttributes` bila perlu?
- [ ] Tidak melakukan `exists` lalu use sebagai correctness guard?
- [ ] Tidak membuka/menutup file per record?
- [ ] Buffer size masuk akal dan tidak menyebabkan memory spike?
- [ ] Direct buffer direuse jika dipakai?

### 19.3 Directory design

- [ ] Directory tidak berisi jutaan file tanpa sharding?
- [ ] Full scan tidak dilakukan terlalu sering?
- [ ] Traversal tidak sort/collect semua path tanpa alasan?
- [ ] Symlink policy jelas?
- [ ] Error handling traversal jelas?

### 19.4 Write path

- [ ] Durability requirement eksplisit?
- [ ] `force`/`SYNC`/`DSYNC` dipakai sesuai kebutuhan, bukan asal?
- [ ] Batch write diterapkan?
- [ ] Atomic update pattern dipakai untuk replace critical file?
- [ ] Disk-full behavior diuji?
- [ ] Temporary file cleanup ada?

### 19.5 Concurrency

- [ ] Worker count bounded?
- [ ] In-flight file count bounded?
- [ ] Open file handle bounded?
- [ ] Buffer memory budget dihitung?
- [ ] Throughput diuji terhadap worker count berbeda?
- [ ] Network filesystem tidak dioverload?

### 19.6 Observability

- [ ] bytes/sec dicatat?
- [ ] files/sec dicatat?
- [ ] open/read/write/move/delete latency dicatat?
- [ ] fsync/force latency dicatat jika dipakai?
- [ ] error by exception type dicatat?
- [ ] queue depth/in-flight dicatat?
- [ ] disk usable space dicatat?
- [ ] scan duration dicatat?

---

## 20. Java 8–25 Compatibility Notes

| Topik | Java 8 | Java 11+ / 25 |
|---|---|---|
| `Files.readString/writeString` | tidak ada | tersedia sejak Java 11 |
| `Path.of` | tidak ada | tersedia sejak Java 11; lebih disarankan daripada `Paths.get` di API note modern |
| `Files.newBufferedReader` default UTF-8 overload | tersedia | tetap tersedia |
| `Files.lines` | tersedia | tetap tersedia |
| `FileChannel.transferTo/transferFrom` | tersedia | tetap tersedia |
| `MappedByteBuffer` | tersedia | tetap tersedia dengan tambahan API di versi baru tertentu |
| `DirectoryStream` | tersedia | tetap tersedia |
| `walkFileTree` | tersedia | tetap tersedia |
| `CRC32C` | tidak ada di Java 8 | tersedia sejak Java 9 |

Untuk materi performance di bagian ini, prinsip besarnya stabil dari Java 8 sampai 25. Yang berubah biasanya convenience API, implementasi internal, provider behavior, dan platform runtime.

---

## 21. Anti-Patterns yang Harus Dihindari

### Anti-pattern 1 — `readAllBytes` untuk file tidak terkontrol

```java
byte[] data = Files.readAllBytes(userProvidedPath);
```

Masalah:

- OOM risk,
- no backpressure,
- hostile input bisa menyerang memory,
- tidak cocok untuk large file.

### Anti-pattern 2 — open/close per record

```java
for (String line : lines) {
    Files.writeString(path, line, StandardOpenOption.APPEND);
}
```

Masalah:

- per-record open/close,
- syscall amplification,
- append semantics provider-dependent,
- poor throughput.

### Anti-pattern 3 — full scan sebagai polling utama

```java
while (true) {
    Files.walk(root).forEach(this::processIfNew);
    Thread.sleep(1000);
}
```

Masalah:

- metadata storm,
- duplicate work,
- poor scaling,
- network filesystem overload.

### Anti-pattern 4 — parallel stream file traversal

```java
Files.walk(root).parallel().forEach(this::process);
```

Masalah:

- boundedness lemah,
- resource pressure,
- error handling buruk,
- unpredictable throughput.

### Anti-pattern 5 — benchmark dengan file yang sama berulang tanpa sadar page cache

```text
Run 1: slow
Run 2: fast
Conclusion: code optimized itself
```

Kesimpulan salah. Bisa jadi cache warm.

### Anti-pattern 6 — “pakai thread lebih banyak” sebagai default fix

Bisa memperburuk:

- random I/O,
- cache thrashing,
- open file pressure,
- metadata server load,
- GC pressure.

---

## 22. Mental Model Ringkas

File performance harus dipikirkan sebagai kombinasi:

```text
Data volume
× number of files
× metadata operations
× syscall count
× buffering strategy
× page cache behavior
× storage semantics
× concurrency pressure
× durability policy
× downstream processing
```

Jika hanya mengukur MB/s, kamu bisa salah melihat bottleneck.

Jika hanya melihat CPU, kamu bisa melewatkan I/O wait.

Jika hanya melihat disk throughput, kamu bisa melewatkan metadata storm.

Jika hanya melihat average latency, kamu bisa melewatkan tail latency.

Jika hanya benchmark warm cache, kamu bisa salah sizing production.

---

## 23. Latihan Praktis

### Latihan 1 — Bandingkan small files vs large file

Buat:

- 1 file berukuran 1 GB,
- 1 juta file berukuran 1 KB.

Ukur:

- total read time,
- files/sec,
- bytes/sec,
- CPU usage,
- memory usage.

Analisis:

- mana yang lebih metadata-heavy?
- mana yang lebih data-heavy?
- apakah buffer size banyak membantu small files?

### Latihan 2 — Warm cache effect

Baca file besar dua kali.

Ukur:

- run pertama,
- run kedua,
- run setelah memory pressure.

Analisis:

- seberapa besar page cache effect?
- apakah throughput merepresentasikan disk atau memory?

### Latihan 3 — Buffer size experiment

Coba buffer:

```text
4 KiB
16 KiB
64 KiB
256 KiB
1 MiB
4 MiB
```

Ukur throughput dan memory.

Analisis:

- kapan improvement berhenti?
- kapan memory cost tidak sebanding?

### Latihan 4 — Traversal metadata cost

Buat tree directory besar.

Bandingkan:

- `Files.walk` tanpa metadata tambahan,
- `Files.walk` + `Files.size` + `Files.getLastModifiedTime`,
- `walkFileTree` menggunakan attributes dari visitor,
- `DirectoryStream` satu-level.

Analisis:

- berapa syscall amplification?
- berapa memory allocation?
- mana yang paling controllable?

### Latihan 5 — Force policy

Tulis append log dengan:

- no force,
- force per record,
- force per 100 records,
- force per second.

Ukur:

- records/sec,
- p95 latency,
- p99 latency.

Analisis:

- berapa harga durability?
- policy mana cocok untuk workload apa?

---

## 24. Ringkasan Akhir

Performance engineering file di Java bukan soal hafal API tercepat. Ini soal memahami shape workload dan lapisan yang terlibat.

Prinsip utama:

1. Banyak file kecil sering kalah oleh metadata dan syscall, bukan bandwidth disk.
2. Page cache membuat benchmark mudah menipu.
3. Buffering mengurangi overhead tertentu, tetapi bukan obat semua bottleneck.
4. `FileChannel.transferTo` bisa optimal, tetapi tidak dijamin selalu lebih cepat dalam semua provider/OS/workload.
5. `force`, `SYNC`, dan `DSYNC` adalah durability tools yang bisa sangat mahal.
6. Directory traversal harus streaming, bounded, dan sadar error.
7. Concurrency harus dibatasi berdasarkan storage, memory, open handles, dan downstream capacity.
8. Observability harus memisahkan files/sec, bytes/sec, metadata latency, read/write latency, force latency, dan error type.
9. Performance tanpa correctness hanya membuat bug lebih cepat menyebar.
10. Performance tanpa measurement hanya dugaan.

Top 1% engineer tidak bertanya “API mana yang paling cepat?” secara abstrak.

Ia bertanya:

```text
Untuk workload ini,
dengan invariant correctness ini,
di filesystem dan runtime ini,
dengan limit memory dan concurrency ini,
operasi mana yang benar-benar mahal,
dan bagaimana kita mengurangi cost tanpa mengubah semantics?
```

---

## 25. Referensi

- Oracle Java SE 25 API — `java.nio.file.Files`
- Oracle Java SE 25 API — `java.nio.channels.FileChannel`
- Oracle Java SE 8 API — `java.nio.channels.FileChannel`
- Oracle Java SE 25 API — `java.nio.file.DirectoryStream`
- Oracle Java SE 25 API — `java.nio.file.FileStore`
- Linux kernel documentation — filesystem buffered I/O and page cache
- LWN — Buffered I/O, direct I/O, and page cache discussions
- Oracle Java Tutorials — File I/O, directory walking, NIO.2 concepts

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-file-filesystem-storage-engineering-part-29-network-filesystems-distributed-files.md">⬅️ Part 29 — Network Filesystems and Distributed Files: NFS, SMB, EFS, Object Storage Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-io-file-filesystem-storage-engineering-part-31-observability-troubleshooting-file-workloads.md">Part 31 — Observability and Troubleshooting File Workloads ➡️</a>
</div>
