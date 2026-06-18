# Part 19 — Memory-Mapped Files in File Workflows

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Scope: Java 8 hingga Java 25  
> Fokus: memahami memory-mapped file sebagai mekanisme file access berbasis virtual memory, kapan berguna, kapan berbahaya, dan bagaimana menulis workflow file yang tetap benar, durable, dan operable.

---

## 0. Posisi Part Ini Dalam Seri

Sampai bagian sebelumnya, kita sudah membangun fondasi:

1. `Path` bukan string biasa.
2. `exists` bukan lock.
3. create harus atomic jika dipakai sebagai klaim.
4. open option menentukan lifecycle dan side effect.
5. read/write biasa harus dibedakan dari durability.
6. atomic update butuh temp file + force + atomic move.
7. copy/move/delete/traversal/link/security/permission/capacity/watch/lock semuanya memiliki semantics filesystem yang tidak bisa disederhanakan menjadi “Java menjalankan operasi file”.

Sekarang kita masuk ke fitur yang sering dianggap advanced dan cepat: **memory-mapped files**.

Memory-mapped file bukan “cara baca file yang selalu lebih cepat”. Ia adalah cara meminta OS memetakan region file ke virtual address space process. Dari sisi Java, hasilnya terlihat seperti `ByteBuffer`. Dari sisi OS, akses byte ke buffer dapat berubah menjadi page fault, page cache access, write-back, dan interaksi langsung dengan virtual memory subsystem.

Mental model yang harus dipakai:

```text
Normal file read/write:

Java code
  -> read/write syscall through channel/stream
  -> kernel copies data between page cache and user buffer
  -> application consumes byte[]/ByteBuffer

Memory-mapped file:

Java code
  -> map file region once
  -> OS maps file-backed pages into process address space
  -> application reads/writes memory addresses through MappedByteBuffer
  -> page faults/page cache/write-back handled by OS
```

Jadi mmap mengubah model dari:

```text
"call read to get bytes"
```

menjadi:

```text
"treat file region like memory; OS loads pages as needed"
```

Itu powerful, tetapi konsekuensinya juga lebih kompleks.

---

## 1. API Utama: `FileChannel.map` dan `MappedByteBuffer`

Di Java, memory-mapped file klasik dibuat dari `FileChannel.map(...)`.

Contoh minimal:

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class MmapReadExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data.bin"); // Java 11+. Untuk Java 8 gunakan Paths.get("data.bin")

        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long size = channel.size();

            if (size > Integer.MAX_VALUE) {
                throw new IllegalArgumentException("This simple example maps max 2 GiB");
            }

            MappedByteBuffer buffer = channel.map(
                    FileChannel.MapMode.READ_ONLY,
                    0,
                    size
            );

            while (buffer.hasRemaining()) {
                byte b = buffer.get();
                // process byte
            }
        }
    }
}
```

Untuk Java 8:

```java
Path path = Paths.get("data.bin");
```

`MappedByteBuffer` adalah subclass dari `ByteBuffer`. Artinya banyak operasi familiar dari `ByteBuffer` tetap berlaku:

- `position()`
- `limit()`
- `capacity()`
- `get()`
- `put()`
- `slice()`
- `duplicate()`
- `order(ByteOrder)`
- absolute access: `getInt(offset)`, `putLong(offset, value)`, dan seterusnya

Tetapi `MappedByteBuffer` punya tambahan operasi spesifik mapping:

- `force()`
- `force(index, length)` pada versi Java modern
- `load()`
- `isLoaded()`

Dokumentasi Java SE 25 mendefinisikan `MappedByteBuffer` sebagai direct byte buffer yang content-nya adalah memory-mapped region dari file, dan mapping tetap valid sampai buffer tersebut garbage-collected. Ini detail penting: menutup `FileChannel` tidak otomatis melepaskan mapping.

---

## 2. MapMode: READ_ONLY, READ_WRITE, PRIVATE

`FileChannel.MapMode` menyediakan tiga mode utama yang relevan lintas Java 8–25:

```java
FileChannel.MapMode.READ_ONLY
FileChannel.MapMode.READ_WRITE
FileChannel.MapMode.PRIVATE
```

### 2.1 `READ_ONLY`

Mode ini membuat mapping yang hanya bisa dibaca.

```java
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
    MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_ONLY, 0, ch.size());
    byte first = buf.get(0);
}
```

Jika kode mencoba menulis:

```java
buf.put(0, (byte) 1);
```

maka akan terjadi exception seperti `ReadOnlyBufferException`.

Gunakan untuk:

- index file read-only
- lookup table
- binary dictionary
- large immutable dataset
- random access read-heavy workload

Jangan gunakan jika file bisa dipotong/truncated oleh proses lain saat mapping masih aktif.

### 2.2 `READ_WRITE`

Mode ini membuat mapping yang bisa dibaca dan ditulis. Perubahan pada buffer dapat dipropagasikan ke file.

```java
try (FileChannel ch = FileChannel.open(
        path,
        StandardOpenOption.READ,
        StandardOpenOption.WRITE)) {

    MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_WRITE, 0, ch.size());
    buf.putInt(0, 42);
    buf.force();
}
```

Gunakan untuk:

- file-backed index
- structured binary store
- local cache dengan update kecil dan random
- append/segment file tertentu jika layout sudah fixed

Hati-hati:

- write ke mapped memory bukan transaksi
- partial update tetap mungkin
- crash bisa meninggalkan record setengah valid
- `force()` bukan pengganti record-level checksum/commit protocol

### 2.3 `PRIVATE`

Mode ini copy-on-write/private mapping. Perubahan pada buffer tidak harus ditulis ke file asal.

Gunakan sangat jarang di application file workflow biasa.

Mental model:

```text
READ_ONLY  -> lihat file
READ_WRITE -> ubah file-backed pages
PRIVATE    -> modifikasi privat, bukan update file utama
```

Untuk engineer aplikasi, `PRIVATE` lebih sering muncul pada use case low-level, eksperimen, atau VM-like behavior daripada CRUD file workflow.

---

## 3. Mapping Bukan Membaca Seluruh File Ke Heap

Kesalahpahaman umum:

```text
MappedByteBuffer = Java membaca seluruh file ke memory.
```

Tidak tepat.

Mapping membuat region file tersedia di virtual address space. Data biasanya diload page-by-page oleh OS saat diakses. Jika aplikasi membaca byte pada halaman yang belum resident, OS bisa memicu page fault lalu mengambil data dari page cache/disk.

Konsekuensi:

1. Mapping file besar tidak selalu langsung memakai RAM sebesar file.
2. Tetapi address space tetap dikonsumsi.
3. Page cache dan resident set bisa naik saat file disentuh.
4. Akses random bisa menghasilkan banyak page fault.
5. `load()` bisa mencoba memaksa halaman masuk physical memory, tetapi tetap best-effort.

Diagram:

```text
File on disk
+-------------------------------------------------------+
| page 0 | page 1 | page 2 | page 3 | ... | page N       |
+-------------------------------------------------------+
       |       |       |
       v       v       v
OS page cache / virtual memory
       |
       v
MappedByteBuffer view in JVM process
```

`MappedByteBuffer` bukan heap array. Ia adalah direct buffer, sehingga memory-nya berada di luar heap Java biasa, walaupun object wrapper-nya tetap berada di heap.

---

## 4. Kenapa Memory-Mapped File Bisa Cepat

Mmap dapat cepat karena beberapa alasan:

### 4.1 Mengurangi explicit read syscall loop

Dengan stream/channel biasa, aplikasi sering melakukan:

```text
read chunk
process chunk
read next chunk
process next chunk
```

Setiap read bisa melibatkan syscall, buffer management, dan copy dari kernel page cache ke user buffer.

Dengan mmap:

```text
map once
read memory-like region
OS handles page loading
```

Akses ke halaman yang sudah resident bisa terasa seperti akses memory.

### 4.2 Cocok untuk random access

Untuk file besar dengan akses acak, mmap sering lebih natural:

```java
int recordOffset = index * RECORD_SIZE;
int status = buffer.getInt(recordOffset + STATUS_OFFSET);
long id = buffer.getLong(recordOffset + ID_OFFSET);
```

Daripada:

```java
channel.position(recordOffset);
channel.read(smallBuffer);
```

berulang-ulang.

### 4.3 OS bisa melakukan paging dan caching

OS sudah punya mekanisme page cache, readahead, eviction, dirty page write-back, dan virtual memory. Mmap memanfaatkan mekanisme itu.

Tetapi “bisa cepat” bukan berarti “selalu cepat”.

---

## 5. Kenapa Memory-Mapped File Bisa Lambat atau Berbahaya

### 5.1 Page fault bisa mahal

Akses pertama ke halaman yang belum resident bisa memicu page fault.

Jika pola akses acak buruk, aplikasi bisa menghasilkan banyak page fault:

```text
read byte at offset 0
read byte at offset 4 GiB
read byte at offset 128 MiB
read byte at offset 16 GiB
...
```

Ini bisa lebih buruk daripada sequential buffered read.

### 5.2 Mapping lifecycle sulit dikontrol

Dokumentasi `MappedByteBuffer` menyatakan mapping valid sampai buffer garbage-collected. Tidak ada method publik standar Java 8–25 pada `MappedByteBuffer` klasik untuk `unmap()` langsung.

Akibatnya:

- file mungkin masih dianggap mapped setelah channel ditutup
- di Windows, delete/truncate file bisa gagal selama mapping aktif
- resource release bergantung pada GC/reachability
- menyimpan reference `MappedByteBuffer` di cache bisa membuat mapping hidup lama

### 5.3 File truncation saat masih mapped bisa fatal

Jika file dipotong lebih kecil sementara mapping masih mengakses region lama, behavior bisa sangat buruk. Pada level OS dapat terjadi signal/error. Di Java dapat muncul exception/error yang tidak semudah `IOException` biasa.

Mental model:

```text
Mapping dibuat untuk range [0, 1 GiB)
Proses lain truncate file menjadi 10 MiB
Kode mengakses offset 500 MiB
-> region tersebut tidak lagi valid secara backing file
```

Untuk production, jangan biarkan file yang dimap dimodifikasi ukuran oleh proses lain tanpa protokol koordinasi.

### 5.4 Durability tidak otomatis sama dengan transaksi

Write ke mapped buffer masuk ke memory/page cache. OS dapat menulis balik ke storage kemudian. `force()` meminta perubahan dipaksa ke storage, tetapi:

- record bisa tetap corrupt jika crash terjadi di tengah multi-field update
- metadata/directory durability berbeda dari content durability
- storage/controller/filesystem tetap punya semantics sendiri
- `force()` bukan commit protocol aplikasi

### 5.5 Mmap bisa menekan memory sistem, bukan hanya heap

Karena mmap memakai virtual memory/page cache/direct memory, aplikasi bisa terlihat heap-nya aman tetapi RSS/page cache/commit memory naik.

Ini penting di container:

```text
Java heap terlihat 512 MiB
Mapped file menyentuh 3 GiB pages
Container memory pressure naik
Pod bisa di-OOM/evicted
```

---

## 6. Kapan Menggunakan Memory-Mapped File

Gunakan mmap jika minimal satu dari kondisi ini kuat:

### 6.1 Large read-only random access

Contoh:

- dictionary lookup
- geospatial index lokal
- routing table lokal
- binary search index
- immutable snapshot file
- search index segment

Karakteristik:

```text
File besar
Data mostly immutable
Banyak random read
Access pattern tidak harus scan dari awal sampai akhir
```

### 6.2 Structured binary file dengan fixed offsets

Contoh:

```text
Header  : 4 KiB
Index   : fixed-width records
Payload : offset-addressed data
Footer  : checksum/manifest
```

Mmap cocok karena kode bisa membaca field by offset.

### 6.3 Local cache yang bisa direbuild

Jika file corrupt, sistem bisa rebuild dari source of truth lain.

Contoh:

- local projection cache
- derived search index
- precomputed lookup file
- analytics cache

Syarat penting:

```text
File bukan satu-satunya source of truth.
```

### 6.4 High-throughput read-mostly workload

Jika workload read-heavy dan file cukup stabil, mmap bisa mengurangi overhead copy/read loop.

---

## 7. Kapan Tidak Menggunakan Memory-Mapped File

Hindari mmap jika:

### 7.1 File sering berubah ukuran

Mmap tidak cocok untuk file yang sering truncate/extend oleh banyak pihak tanpa protokol ketat.

### 7.2 File berasal dari input untrusted dan langsung diparse kompleks

Mmap membuat parsing offset-based mudah, tetapi tidak otomatis aman. File corrupt bisa membuat parser lompat offset liar.

Butuh:

- magic number
- version check
- size check
- bounds check
- checksum
- defensive parsing

### 7.3 Workload sequential sederhana

Untuk membaca file baris demi baris atau sequential stream besar, `BufferedInputStream`, `BufferedReader`, atau `FileChannel` dengan buffer biasa sering lebih sederhana dan cukup cepat.

### 7.4 Perlu resource release deterministik

Jika workflow harus segera delete/truncate/replace file setelah selesai, mmap klasik bisa menyulitkan karena unmap tidak eksplisit.

### 7.5 Running di constrained container

Mmap dapat membuat memory pressure tidak terlihat dari heap metric saja.

### 7.6 Distributed/network filesystem

Mmap di network filesystem bisa membawa behavior caching/consistency/locking yang sulit diprediksi. Untuk coordination antar node, jangan mengandalkan mmap sebagai shared-memory distributed system.

---

## 8. Mapping Size dan Batas 2 GiB `ByteBuffer`

`ByteBuffer` memakai `int` untuk position, limit, dan capacity. Artinya satu `MappedByteBuffer` klasik tidak bisa merepresentasikan region lebih dari sekitar 2 GiB.

Jika file lebih besar dari `Integer.MAX_VALUE`, map file dalam segment/window.

Contoh segment mapping:

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class WindowedMmapReader {
    private static final long WINDOW_SIZE = 256L * 1024L * 1024L; // 256 MiB

    public static long sumBytes(Path path) throws IOException {
        long sum = 0;

        try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
            long size = ch.size();

            for (long offset = 0; offset < size; offset += WINDOW_SIZE) {
                long remaining = size - offset;
                long mapSize = Math.min(WINDOW_SIZE, remaining);

                MappedByteBuffer buf = ch.map(
                        FileChannel.MapMode.READ_ONLY,
                        offset,
                        mapSize
                );

                while (buf.hasRemaining()) {
                    sum += (buf.get() & 0xFF);
                }
            }
        }

        return sum;
    }
}
```

Catatan:

- Jangan map seluruh file besar tanpa alasan.
- Pilih window size yang masuk akal.
- Perhatikan jumlah mapping aktif.
- Jangan simpan semua `MappedByteBuffer` window dalam list jika tidak perlu.

---

## 9. Access Pattern: Sequential, Random, Strided

Mmap behavior sangat dipengaruhi access pattern.

### 9.1 Sequential scan

```text
offset 0
offset 1
offset 2
...
```

OS readahead dapat membantu. Tetapi buffered read juga bisa sangat kompetitif.

### 9.2 Random access locality bagus

```text
record 100
record 101
record 102
record 108
record 109
```

Mmap bagus karena locality membuat page reuse tinggi.

### 9.3 Random access locality buruk

```text
record 1
record 9000000
record 42
record 7000000
record 100
```

Bisa menghasilkan banyak page fault dan cache miss.

### 9.4 Strided access

```text
read first byte of each 4 KiB page
```

Ini bisa sangat buruk karena menyentuh banyak page untuk sedikit data.

Rule of thumb:

```text
Mmap cocok jika akses memiliki spatial locality atau offset-based random lookup yang cukup sering diulang.
Mmap kurang cocok jika hanya butuh sequential transform sederhana.
```

---

## 10. `load()` dan `isLoaded()`

`MappedByteBuffer.load()` meminta buffer content diload ke physical memory.

```java
MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_ONLY, 0, size);
buf.load();
```

Tetapi ini **best effort**. Tidak boleh dianggap sebagai guarantee bahwa semua halaman akan selalu resident selama aplikasi berjalan.

`isLoaded()` juga bukan truth sempurna untuk keputusan correctness. Anggap sebagai observability hint, bukan invariant bisnis.

Bad mental model:

```java
if (buf.isLoaded()) {
    // pasti cepat dan aman
}
```

Better mental model:

```text
load/isLoaded dapat membantu warm-up atau observasi kasar,
tetapi OS tetap bebas melakukan paging/eviction sesuai pressure.
```

Gunakan `load()` secara hati-hati:

- bisa memicu banyak I/O
- bisa menyebabkan startup latency besar
- bisa menekan memory sistem
- bisa mengganggu workload lain di host/container

---

## 11. `force()`: Flush Mapped Changes, Bukan Transaksi

Untuk writable mapping:

```java
buf.putInt(0, 42);
buf.force();
```

`force()` meminta perubahan pada buffer ditulis ke storage device.

Pada Java modern ada juga region force:

```java
buf.force(index, length);
```

Tetapi pahami batasannya.

### 11.1 `force()` menyelesaikan apa?

Ia membantu memastikan dirty mapped pages dikirim ke storage.

### 11.2 `force()` tidak menyelesaikan apa?

Ia tidak otomatis memberi:

- atomic multi-field update
- record boundary correctness
- checksum correctness
- rollback
- directory entry durability
- distributed visibility semantics
- protection dari writer lain

Jika menulis struktur seperti:

```text
record:
  length
  payload
  checksum
  committed flag
```

Lalu crash terjadi setelah `payload` ditulis tetapi sebelum `checksum`, file tetap bisa corrupt secara logical.

Solusinya bukan hanya `force()`, tetapi layout dan recovery protocol.

---

## 12. Designing Writable Mmap Layout Safely

Jika menggunakan `READ_WRITE`, desain file harus punya invariants.

Contoh layout sederhana:

```text
+----------------------+----------------------+----------------------+
| Header               | Fixed Records        | Footer / Checkpoint  |
+----------------------+----------------------+----------------------+

Header:
- magic number
- format version
- file size expected
- record size
- record count
- generation
- header checksum

Record:
- state
- id
- payload offset
- payload length
- payload checksum

Footer:
- committed generation
- whole-file hash/checksum optional
```

### 12.1 Jangan update field penting secara sembarang

Bad:

```java
buf.putLong(recordOffset + ID_OFFSET, id);
buf.putInt(recordOffset + STATUS_OFFSET, STATUS_DONE);
buf.force();
```

Jika crash terjadi di tengah, status bisa `DONE` tapi data belum valid.

Better:

```text
1. write payload/data fields
2. write checksum
3. force affected region
4. write commit marker/status last
5. force commit marker
```

Bahkan ini pun perlu disesuaikan dengan atomicity field write dan filesystem semantics.

### 12.2 Gunakan checksum untuk mendeteksi partial/corrupt record

Contoh conceptual:

```java
static final int STATE_EMPTY = 0;
static final int STATE_WRITING = 1;
static final int STATE_COMMITTED = 2;

static void writeRecord(MappedByteBuffer buf, int offset, byte[] payload) {
    buf.putInt(offset + 0, STATE_WRITING);
    buf.putInt(offset + 4, payload.length);

    int payloadOffset = offset + 16;
    for (int i = 0; i < payload.length; i++) {
        buf.put(payloadOffset + i, payload[i]);
    }

    int checksum = crc32(payload);
    buf.putInt(offset + 8, checksum);

    // Flush data/checksum before marking committed.
    buf.force(offset, 16 + payload.length);

    buf.putInt(offset + 0, STATE_COMMITTED);
    buf.force(offset, 4);
}
```

Saat recovery:

```text
if state != COMMITTED -> ignore/rebuild
if checksum mismatch -> ignore/rebuild/quarantine
if length invalid -> file corrupt
```

---

## 13. Mmap dan Append-Only Log

Append-only file bisa memakai mmap, tetapi hati-hati karena mmap region punya size tetap saat dibuat.

Jika file tumbuh, mapping lama tidak otomatis meluas.

Bad assumption:

```text
Saya map file 1 MiB.
Lalu file saya extend menjadi 2 MiB.
Buffer lama bisa akses sampai 2 MiB.
```

Tidak. Mapping lama tetap sebesar region awal.

Pattern yang lebih aman:

```text
Segment file fixed size:
segment-000001.log 128 MiB
segment-000002.log 128 MiB
segment-000003.log 128 MiB
```

Setiap segment bisa dimap dengan ukuran tetap.

Contoh segment lifecycle:

```text
1. create segment with fixed size
2. map segment
3. append framed records until near full
4. force committed region/checkpoint
5. close logical segment
6. move to next segment
```

Record framing:

```text
+--------+---------+----------+------------+
| length | type    | payload  | checksum   |
+--------+---------+----------+------------+
```

Recovery:

```text
scan from beginning
read length
validate length range
read payload
validate checksum
advance
stop at first invalid/incomplete record
truncate logical tail or mark tail ignored
```

---

## 14. Mmap dan Atomic Update Pattern

Untuk mengganti file secara utuh, mmap bukan pengganti atomic move.

Jika target adalah config/snapshot/manifest yang dibaca banyak proses:

Better pattern:

```text
writer:
1. write new content to temp file
2. force temp file
3. atomic move temp -> final

reader:
1. open final file
2. map final file read-only
3. validate magic/version/checksum
4. use snapshot
```

Keuntungan:

- reader melihat old snapshot atau new snapshot
- writer tidak mutate file yang sedang dimap reader
- mapping lama tetap menunjuk file lama
- mapping baru bisa dibuat setelah reload

Jangan melakukan in-place mutation untuk snapshot yang dibaca banyak pihak kecuali benar-benar punya protocol concurrency dan recovery.

---

## 15. Mmap dan File Delete/Replace Semantics

### 15.1 Unix-like system

Pada Unix-like system, file yang sudah di-unlink dapat tetap hidup selama masih ada open file descriptor/mapping. Directory entry hilang, tetapi data bisa tetap ada sampai reference terakhir dilepas.

Mental model:

```text
Directory entry removed
Mapped/open file still accessible by process that already has reference
Storage reclaimed after last reference closed/unmapped
```

### 15.2 Windows

Pada Windows, file yang masih mapped/open sering tidak bisa dihapus/truncate/replace seperti di Unix. Ini membuat mmap lebih sering menyebabkan operational issue:

```text
AccessDeniedException
FileSystemException: process cannot access file because it is being used by another process
```

Practical rule:

```text
Jika aplikasi harus portable ke Windows,
jangan map file lalu berharap bisa segera delete/truncate/replace file itu.
```

### 15.3 Java-specific issue

Menutup `FileChannel` setelah mapping tidak sama dengan unmap.

```java
MappedByteBuffer buf;
try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
    buf = ch.map(FileChannel.MapMode.READ_ONLY, 0, ch.size());
}
// Channel sudah closed, tetapi mapping masih valid selama buf reachable.
```

Jika `buf` masih direferensikan, mapping tetap hidup.

---

## 16. Unmapping: Kenapa Sulit di Java 8–25 Klasik

Pada API klasik `MappedByteBuffer`, tidak ada public `unmap()` method yang portable dan stabil.

Beberapa kode lama memakai internal API/reflection seperti cleaner access. Hindari untuk materi production umum karena:

- bergantung pada internal implementation
- dapat rusak antar versi Java
- terhalang module encapsulation Java 9+
- bisa menyebabkan crash jika buffer dipakai setelah forced-unmap

Practical strategies:

### 16.1 Keep mapping scope small

```java
void process(Path path) throws IOException {
    try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
        MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_ONLY, 0, ch.size());
        processBuffer(buf);
    }
    // Pastikan buf tidak disimpan ke field/static/cache.
}
```

Ini tidak menjamin immediate unmap, tapi mengurangi reachability.

### 16.2 Avoid immediate delete/truncate after mapping

Jika perlu delete, gunakan non-mmap read untuk workflow tersebut.

### 16.3 Use snapshot rotation

Alih-alih mutate/delete file yang sedang dimap:

```text
index-v1.dat
index-v2.dat
current -> index-v2.dat
```

Reader lama tetap menggunakan v1 sampai selesai. Cleaner menghapus versi lama setelah aman.

### 16.4 Pertimbangkan Foreign Memory API untuk Java modern

Java modern memperkenalkan Foreign Function & Memory API, termasuk mapped memory segment via `FileChannel.map(..., Arena)` pada API baru. Ini membuka model lifecycle yang lebih eksplisit melalui arena, tetapi karena seri ini mencakup Java 8–25 dan banyak enterprise app masih memakai NIO klasik, bagian ini tetap fokus pada `MappedByteBuffer` sebagai baseline portable.

---

## 17. Mmap dan Concurrency Dalam Satu JVM

`MappedByteBuffer` tidak membuat operasi compound menjadi thread-safe.

Contoh tidak aman:

```java
int current = buf.getInt(COUNTER_OFFSET);
buf.putInt(COUNTER_OFFSET, current + 1);
```

Dua thread bisa lost update.

Mmap hanya menyediakan view memory/file. Ia tidak memberikan:

- Java object monitor
- atomic CAS pada arbitrary mapped offset
- record lock
- memory visibility protocol aplikasi
- transaction boundary

Jika banyak thread mengakses buffer sama:

- gunakan external synchronization
- partition offset per thread
- gunakan single writer
- gunakan queue writer
- gunakan file lock untuk cross-process, tetapi ingat file lock bukan thread lock dalam JVM

Contoh single-writer pattern:

```text
producer threads
  -> BlockingQueue<Record>
       -> one mmap writer thread
            -> write record
            -> update checkpoint
            -> force periodically
```

---

## 18. Mmap dan Cross-Process Coordination

Dua proses bisa map file sama. Tetapi ini tidak otomatis membuat database.

Problem:

- ordering write antar proses
- visibility timing
- partial writes
- cache coherence semantics platform
- locking semantics
- crash recovery
- version compatibility

Jika harus cross-process:

```text
Use file lock / external lock
Use fixed layout
Use generation number
Use checksum
Use commit marker
Use recovery protocol
Use one writer if possible
```

Better architecture untuk banyak writer:

```text
Many processes
  -> database / message queue / append log service
      -> one file materializer
```

Mmap cocok untuk banyak reader dan satu writer yang sangat disiplin. Banyak writer ke file mapped yang sama adalah red flag.

---

## 19. Mmap Dalam Container dan Kubernetes

Dalam container, mmap membawa beberapa risiko khusus.

### 19.1 Heap metric tidak cukup

Aplikasi bisa terlihat:

```text
heap used: 400 MiB / 1 GiB
```

Tetapi container RSS/page cache bisa tinggi karena mapped pages disentuh.

Observability harus mencakup:

- process RSS
- container memory usage
- page faults
- disk I/O
- page cache pressure
- direct buffer/mapped usage jika bisa
- file size mapped
- number of active mappings

### 19.2 Ephemeral storage pressure

Mapped file tetap file. Jika ditempatkan di ephemeral storage, file besar dapat memicu disk pressure/eviction.

### 19.3 ConfigMap/Secret volume

Jangan mmap ConfigMap/Secret lalu berasumsi update Kubernetes akan terlihat seperti update normal file. K8s projected volume punya mekanisme update sendiri, symlink-like layout, dan update periodic. Untuk config reload, lebih aman:

```text
watch/reconcile directory
open current file fresh
read/validate snapshot
replace in-memory config object
```

Bukan memegang mmap lama dan berharap content berubah sesuai update.

---

## 20. Mmap dan Network Filesystem

Mmap di network filesystem adalah area berisiko.

Contoh masalah:

- cache consistency antar client
- lock behavior berbeda
- flush semantics berbeda
- latency page fault jauh lebih mahal
- server-side failure
- stale file handle
- visibility delay

Rule of thumb:

```text
Mmap paling masuk akal untuk local disk/local filesystem.
Untuk NFS/SMB/EFS-like workload, validasi behavior secara eksplisit.
Jangan jadikan mmap sebagai distributed shared memory.
```

Jika file harus dibagi antar node, pertimbangkan:

- object storage + immutable objects
- database
- message queue
- distributed log
- dedicated storage engine
- local cache per node dengan invalidation/versioning

---

## 21. Error Handling Pada Memory-Mapped Access

Mmap mengubah sebagian I/O error menjadi failure saat memory access, bukan saat `read()`.

Normal read:

```java
int n = channel.read(buffer); // IOException can happen here
```

Mmap:

```java
byte b = mapped.get(offset); // underlying page fault can fail here
```

Karena akses terlihat seperti memory access, developer sering lupa bahwa operasi ini tetap bergantung pada file/storage.

Practical defensive rules:

1. Validasi file size sebelum map.
2. Validasi offset sebelum access.
3. Jangan percaya offset dari file tanpa bounds check.
4. Jangan map file yang bisa di-truncate oleh pihak lain.
5. Tangani runtime failure sebagai kemungkinan data/storage corruption.
6. Miliki rebuild/quarantine path.

Contoh defensive offset check:

```java
static int checkedInt(MappedByteBuffer buf, int offset) {
    if (offset < 0 || offset > buf.limit() - Integer.BYTES) {
        throw new IllegalArgumentException("Invalid int offset: " + offset);
    }
    return buf.getInt(offset);
}
```

---

## 22. Binary Format: Jangan Mmap File Tanpa Format Contract

Mmap menjadi sangat kuat jika file punya format contract yang jelas.

Minimal header:

```text
magic          4 bytes   e.g. 0x4A46494C
version        4 bytes
headerSize     4 bytes
flags          4 bytes
recordSize     4 bytes
recordCount    8 bytes
createdEpoch   8 bytes
checksum       4 bytes
reserved       ...
```

Contoh parser header:

```java
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

final class FileHeader {
    static final int MAGIC = 0x4A46494C; // "JFIL" conceptual
    static final int HEADER_SIZE = 64;

    final int version;
    final int recordSize;
    final long recordCount;

    FileHeader(int version, int recordSize, long recordCount) {
        this.version = version;
        this.recordSize = recordSize;
        this.recordCount = recordCount;
    }

    static FileHeader read(ByteBuffer buf) {
        if (buf.limit() < HEADER_SIZE) {
            throw new IllegalArgumentException("File too small for header");
        }

        buf = buf.duplicate().order(ByteOrder.BIG_ENDIAN);

        int magic = buf.getInt(0);
        if (magic != MAGIC) {
            throw new IllegalArgumentException("Invalid magic");
        }

        int version = buf.getInt(4);
        if (version != 1) {
            throw new IllegalArgumentException("Unsupported version: " + version);
        }

        int headerSize = buf.getInt(8);
        if (headerSize != HEADER_SIZE) {
            throw new IllegalArgumentException("Invalid header size: " + headerSize);
        }

        int recordSize = buf.getInt(16);
        if (recordSize <= 0 || recordSize > 1024 * 1024) {
            throw new IllegalArgumentException("Invalid record size: " + recordSize);
        }

        long recordCount = buf.getLong(20);
        if (recordCount < 0) {
            throw new IllegalArgumentException("Invalid record count: " + recordCount);
        }

        return new FileHeader(version, recordSize, recordCount);
    }
}
```

Core principle:

```text
Mmap mempercepat akses offset.
Format contract membuat offset tersebut bermakna dan aman.
```

---

## 23. Endianness dan Portability

`ByteBuffer` default byte order adalah big-endian. Jika format file harus portable, tetapkan byte order secara eksplisit.

```java
MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_ONLY, 0, size);
buf.order(ByteOrder.BIG_ENDIAN);
```

Atau jika memilih little-endian:

```java
buf.order(ByteOrder.LITTLE_ENDIAN);
```

Jangan membiarkan byte order implisit jika file akan dibaca lintas mesin/bahasa/versi.

Bad:

```java
int x = buf.getInt(offset); // byte order implicit
```

Better:

```java
ByteBuffer view = buf.duplicate().order(ByteOrder.BIG_ENDIAN);
int x = view.getInt(offset);
```

---

## 24. Slice dan Duplicate: View Bukan Copy

`slice()` dan `duplicate()` membuat view, bukan copy data.

```java
ByteBuffer header = buf.duplicate();
header.position(0).limit(64);
ByteBuffer headerSlice = header.slice();
```

Jika underlying mapping writable, perubahan melalui satu view terlihat melalui view lain.

Mental model:

```text
MappedByteBuffer original
  -> duplicate view A
  -> slice view B
  -> slice view C

Semua menunjuk backing mapped region yang sama.
```

Ini berguna untuk modular parser, tetapi jangan salah mengira setiap slice isolated.

---

## 25. Practical Pattern: Read-Only Mapped Snapshot

Use case: aplikasi membaca file index besar yang dihasilkan offline.

### 25.1 Writer offline

```text
build index to temp
validate index
force temp
atomic move temp -> index-v42.dat
update manifest/current pointer atomically
```

### 25.2 Reader service

```text
read manifest
open selected immutable index file
map READ_ONLY
validate header/checksum
serve queries
periodically check manifest generation
reload by opening new mapping
release old mapping when no requests use it
```

### 25.3 Java sketch

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.concurrent.atomic.AtomicReference;

public final class MappedIndexHolder {
    private final AtomicReference<MappedIndex> current = new AtomicReference<>();

    public void load(Path indexFile) throws IOException {
        try (FileChannel ch = FileChannel.open(indexFile, StandardOpenOption.READ)) {
            long size = ch.size();
            if (size <= 0 || size > Integer.MAX_VALUE) {
                throw new IllegalArgumentException("Unsupported index size: " + size);
            }

            MappedByteBuffer buf = ch.map(FileChannel.MapMode.READ_ONLY, 0, size);
            FileHeader header = FileHeader.read(buf);

            MappedIndex next = new MappedIndex(indexFile, buf, header);
            current.set(next);
        }
    }

    public byte lookupByte(int offset) {
        MappedIndex index = current.get();
        if (index == null) {
            throw new IllegalStateException("Index not loaded");
        }
        return index.getByte(offset);
    }

    static final class MappedIndex {
        final Path path;
        final MappedByteBuffer buffer;
        final FileHeader header;

        MappedIndex(Path path, MappedByteBuffer buffer, FileHeader header) {
            this.path = path;
            this.buffer = buffer.asReadOnlyBuffer();
            this.header = header;
        }

        byte getByte(int offset) {
            if (offset < 0 || offset >= buffer.limit()) {
                throw new IllegalArgumentException("Invalid offset");
            }
            return buffer.get(offset);
        }
    }
}
```

Catatan:

- `asReadOnlyBuffer()` membantu mencegah accidental write lewat reference tersebut.
- Reload mengganti reference secara atomic.
- Mapping lama baru eligible release setelah tidak direferensikan.
- Untuk Windows, jangan delete file lama terlalu cepat.

---

## 26. Practical Pattern: Windowed Random Lookup

Untuk file >2 GiB, gunakan window.

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class WindowedMappedFile implements AutoCloseable {
    private final FileChannel channel;
    private final long windowSize;
    private long mappedWindowIndex = -1;
    private MappedByteBuffer mappedWindow;

    public WindowedMappedFile(Path path, long windowSize) throws IOException {
        if (windowSize <= 0 || windowSize > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Invalid window size: " + windowSize);
        }
        this.channel = FileChannel.open(path, StandardOpenOption.READ);
        this.windowSize = windowSize;
    }

    public byte get(long absoluteOffset) throws IOException {
        if (absoluteOffset < 0 || absoluteOffset >= channel.size()) {
            throw new IllegalArgumentException("Invalid offset: " + absoluteOffset);
        }

        long windowIndex = absoluteOffset / windowSize;
        int offsetInWindow = (int) (absoluteOffset % windowSize);

        if (windowIndex != mappedWindowIndex) {
            mapWindow(windowIndex);
        }

        return mappedWindow.get(offsetInWindow);
    }

    private void mapWindow(long windowIndex) throws IOException {
        long fileSize = channel.size();
        long offset = windowIndex * windowSize;
        long size = Math.min(windowSize, fileSize - offset);

        this.mappedWindow = channel.map(FileChannel.MapMode.READ_ONLY, offset, size);
        this.mappedWindowIndex = windowIndex;
    }

    @Override
    public void close() throws IOException {
        channel.close();
        // mappedWindow release is GC/reachability based in classic MappedByteBuffer API.
    }
}
```

Ini simple one-window cache. Untuk workload nyata, bisa dibuat LRU window cache, tetapi hati-hati jumlah mapping aktif.

---

## 27. Practical Pattern: Mmap Writer Dengan Checkpoint

Contoh conceptual untuk fixed-size file.

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public final class FixedCounterStore implements AutoCloseable {
    private static final int FILE_SIZE = 4096;
    private static final int MAGIC_OFFSET = 0;
    private static final int COUNTER_OFFSET = 8;
    private static final int CHECKSUM_OFFSET = 16;
    private static final int MAGIC = 0x434E5452; // CNTR

    private final FileChannel channel;
    private final MappedByteBuffer buffer;

    public FixedCounterStore(Path path) throws IOException {
        this.channel = FileChannel.open(
                path,
                StandardOpenOption.READ,
                StandardOpenOption.WRITE,
                StandardOpenOption.CREATE
        );

        if (channel.size() < FILE_SIZE) {
            channel.truncate(FILE_SIZE);
            channel.position(FILE_SIZE - 1);
            channel.write(java.nio.ByteBuffer.wrap(new byte[]{0}));
        }

        this.buffer = channel.map(FileChannel.MapMode.READ_WRITE, 0, FILE_SIZE);

        if (buffer.getInt(MAGIC_OFFSET) == 0) {
            initialize();
        } else if (buffer.getInt(MAGIC_OFFSET) != MAGIC) {
            throw new IllegalStateException("Invalid store magic");
        }
    }

    private void initialize() {
        buffer.putInt(MAGIC_OFFSET, MAGIC);
        buffer.putLong(COUNTER_OFFSET, 0L);
        buffer.putInt(CHECKSUM_OFFSET, checksum(0L));
        buffer.force();
    }

    public synchronized long incrementAndGet() {
        long current = buffer.getLong(COUNTER_OFFSET);
        long next = current + 1;

        buffer.putLong(COUNTER_OFFSET, next);
        buffer.putInt(CHECKSUM_OFFSET, checksum(next));
        buffer.force(COUNTER_OFFSET, Long.BYTES + Integer.BYTES);

        return next;
    }

    public synchronized long read() {
        long value = buffer.getLong(COUNTER_OFFSET);
        int expected = buffer.getInt(CHECKSUM_OFFSET);
        if (expected != checksum(value)) {
            throw new IllegalStateException("Counter checksum mismatch");
        }
        return value;
    }

    private static int checksum(long value) {
        return (int) (value ^ (value >>> 32) ^ 0x5A5A5A5A);
    }

    @Override
    public void close() throws IOException {
        buffer.force();
        channel.close();
    }
}
```

Catatan:

- Ini contoh educational, bukan distributed counter.
- `synchronized` mengamankan thread dalam satu JVM.
- Tidak aman untuk multi-process writer tanpa lock/protocol tambahan.
- Checksum sederhana hanya demonstrasi, bukan cryptographic integrity.

---

## 28. Observability Untuk Mmap Workload

Mmap bug sering tidak terlihat dari metric file I/O biasa.

Tambahkan observability:

### 28.1 Application metrics

- active mapped files count
- total mapped bytes logical
- mapping creation latency
- mapping failure count
- force latency
- force failure count
- reload generation
- old generation retained count
- mapped lookup latency
- checksum validation failure
- corrupt file quarantine count

### 28.2 Process/container metrics

- RSS
- virtual memory size
- major page faults
- minor page faults
- disk read/write throughput
- disk await/latency
- container memory usage
- eviction/OOM events

### 28.3 Logs

Log saat mapping dibuat:

```text
mapped_file path=/data/index-v42.dat size=734003200 mode=READ_ONLY generation=42 checksum=abc123
```

Log saat reload:

```text
mapped_index_reload old_generation=41 new_generation=42 old_retained=true
```

Log saat validation gagal:

```text
mapped_file_validation_failed path=/data/index-v43.dat reason=checksum_mismatch action=keep_previous_generation
```

Jangan log full path jika mengandung data sensitif tenant/user tanpa masking.

---

## 29. Failure Matrix

| Scenario | Risiko | Mitigasi |
|---|---|---|
| File truncated while mapped | Access failure/corruption | Immutable snapshot, lock, no truncate contract |
| Crash during mapped write | Partial logical record | checksum, commit marker, recovery scan |
| `force()` not called | Dirty pages mungkin belum durable | explicit force sesuai durability requirement |
| `force()` called but layout buruk | Durable corruption | desain record protocol |
| Channel closed | Mapping masih hidup | pahami lifecycle; jangan delete/truncate terlalu cepat |
| Windows delete mapped file | delete/replace gagal | snapshot rotation, delayed cleanup |
| Mapping huge file in container | memory pressure/OOM | windowed mapping, metrics, limits |
| Access random no locality | page fault storm | benchmark, prefetch carefully, buffered read alternative |
| Multi-thread writes | race/lost update | synchronization/single writer |
| Multi-process writes | corruption/order issue | external lock/single writer/database |
| Network filesystem | consistency/latency issue | avoid or validate explicitly |

---

## 30. Decision Framework: Stream, Channel, or Mmap?

Gunakan pertanyaan ini.

### 30.1 Apakah file kecil?

Jika file kecil dan muat memory:

```text
Files.readAllBytes / readString / buffered read cukup.
```

### 30.2 Apakah sequential processing?

Jika iya:

```text
BufferedInputStream / BufferedReader / FileChannel read loop.
```

### 30.3 Apakah random read banyak ke file besar immutable?

Jika iya:

```text
Mmap READ_ONLY mungkin cocok.
```

### 30.4 Apakah file harus sering dihapus/diganti segera?

Jika iya:

```text
Hindari mmap klasik, terutama untuk Windows portability.
```

### 30.5 Apakah butuh write durable transactional?

Jika iya:

```text
Mmap hanya storage primitive; tetap perlu WAL/commit/checksum/atomic move.
```

### 30.6 Apakah berjalan di container memory ketat?

Jika iya:

```text
Mmap harus dipantau RSS/page fault, bukan heap saja.
```

---

## 31. Top 1% Mental Models

### 31.1 Mmap adalah virtual memory feature, bukan Java collection

Jangan berpikir:

```text
Saya punya byte array besar.
```

Pikirkan:

```text
Saya punya view ke file-backed virtual memory pages.
```

### 31.2 FileChannel close bukan unmap

```text
close channel != release mapping
```

Mapping hidup selama buffer reachable/GC-managed.

### 31.3 `force()` bukan transaction

```text
force helps durability of dirty pages,
not logical consistency of your file format.
```

### 31.4 Mmap cocok untuk immutable snapshot

Pattern paling aman:

```text
build immutable file
atomic publish
map read-only
reload by generation
cleanup old generation later
```

### 31.5 Writable mmap butuh file format engineering

Jika menulis via mmap, pikirkan seperti storage engine:

- magic number
- version
- bounds
- checksum
- commit marker
- recovery
- compatibility

### 31.6 Observability harus melihat OS/container memory

Heap metric tidak cukup.

### 31.7 Mmap bukan distributed coordination mechanism

Mmap shared file antar proses/node bukan pengganti DB/queue/log.

---

## 32. Java 8–25 Compatibility Notes

| Topic | Java 8 | Java 9–25 |
|---|---:|---:|
| `MappedByteBuffer` classic API | Ada | Ada |
| `FileChannel.map(MapMode,long,long)` | Ada | Ada |
| `Path.of` | Tidak ada | Ada sejak Java 11 |
| `Paths.get` | Ada | Ada, tetapi `Path.of` direkomendasikan di Java modern |
| `MappedByteBuffer.force()` | Ada | Ada |
| `MappedByteBuffer.force(index,length)` | Tidak ada di Java 8 | Ada di Java modern |
| Explicit classic `unmap()` | Tidak ada public API | Tidak ada public API pada `MappedByteBuffer` klasik |
| Foreign Memory mapped segment | Tidak ada | Ada di Java modern, tetapi bukan baseline Java 8 |

Untuk materi seri ini:

- gunakan `Paths.get(...)` jika target Java 8
- gunakan `Path.of(...)` jika target Java 11+
- jangan bergantung pada internal cleaner/unmap hack
- jangan gunakan API modern jika library harus Java 8-compatible tanpa abstraction layer

---

## 33. Checklist Produksi Sebelum Memakai Mmap

Sebelum memilih mmap, jawab ini:

```text
[ ] Apakah workload benar-benar random-access/read-heavy?
[ ] Apakah file immutable selama mapping aktif?
[ ] Jika writable, apakah ada format contract?
[ ] Apakah ada checksum/commit/recovery?
[ ] Apakah ukuran mapping < 2 GiB per buffer atau sudah windowed?
[ ] Apakah file tidak akan di-truncate oleh proses lain?
[ ] Apakah aplikasi portable ke Windows?
[ ] Apakah cleanup file lama bisa delayed?
[ ] Apakah container RSS/page fault dimonitor?
[ ] Apakah force policy jelas?
[ ] Apakah fallback/rebuild tersedia jika file corrupt?
[ ] Apakah benchmark membandingkan mmap vs buffered/channel?
[ ] Apakah network filesystem behavior sudah divalidasi?
[ ] Apakah multi-thread/multi-process access punya synchronization protocol?
```

Jika banyak jawaban belum jelas, mmap belum layak dipakai.

---

## 34. Ringkasan

Memory-mapped file adalah tool powerful untuk workload tertentu, terutama file besar yang immutable dan dibaca secara random. Ia memungkinkan aplikasi memperlakukan region file seperti memory melalui `MappedByteBuffer`, sementara OS menangani paging dan page cache.

Namun mmap membawa complexity yang sering tersembunyi:

- lifecycle mapping tidak deterministik pada API klasik
- channel close bukan unmap
- delete/truncate behavior berbeda antar OS
- write via mmap bukan transaksi
- `force()` bukan recovery protocol
- access dapat gagal saat page fault, bukan hanya saat open/read
- memory pressure bisa muncul di luar heap
- network filesystem dan container membuat behavior lebih sensitif

Untuk top-tier engineering, mmap harus diperlakukan sebagai primitive storage-level, bukan convenience API. Jika file immutable, versioned, validated, dan read-heavy, mmap bisa sangat elegan. Jika file mutable, multi-writer, networked, atau butuh cleanup deterministik, mmap bisa menjadi sumber bug yang mahal.

---

## 35. Koneksi Ke Part Berikutnya

Part ini membahas file sebagai memory-backed region. Part berikutnya akan membahas **random access dan structured binary file layout** secara lebih umum:

```text
Part 20 — Random Access and Structured Binary File Layout
```

Di Part 20 kita akan membahas bagaimana mendesain file binary yang bisa diakses via offset, baik memakai mmap maupun `FileChannel` biasa:

- header/body/footer
- magic number
- versioning
- offset table
- fixed vs variable records
- endian
- compatibility
- corruption detection
- layout evolution
- read/write algorithms

---

## References

- Oracle Java SE 25 API — `MappedByteBuffer`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/MappedByteBuffer.html
- Oracle Java SE 8 API — `MappedByteBuffer`: https://docs.oracle.com/javase/8/docs/api/java/nio/MappedByteBuffer.html
- Oracle Java SE 25 API — `FileChannel` and `FileChannel.map`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html
- Oracle Java SE 25 API — `FileChannel.MapMode`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.MapMode.html
- OpenJDK issue JDK-4724038 — discussion around explicit unmap need: https://bugs.openjdk.org/browse/JDK-4724038
