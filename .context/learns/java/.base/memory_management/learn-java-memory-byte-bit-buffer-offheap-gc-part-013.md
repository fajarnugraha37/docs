# learn-java-memory-byte-bit-buffer-offheap-gc-part-013

# Memory-Mapped Files: `MappedByteBuffer`, Page Cache, and OS Semantics

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Part: `013`  
> Topik: `Memory-Mapped Files`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami `MappedByteBuffer` bukan hanya sebagai API Java, tetapi sebagai mekanisme kerja sama antara JVM, virtual memory OS, file system, storage device, page cache, dan garbage collector.

---

## 0. Posisi Bagian Ini dalam Seri

Pada part sebelumnya kita membahas `DirectByteBuffer`:

```text
Java object kecil di heap
        ↓
menunjuk ke native memory di luar heap
        ↓
dipakai untuk I/O agar lebih dekat dengan native/kernel boundary
```

`MappedByteBuffer` masih satu keluarga dengan direct buffer, tetapi modelnya berbeda:

```text
DirectByteBuffer biasa
    -> native memory dialokasikan untuk proses JVM

MappedByteBuffer
    -> region virtual memory proses dipetakan ke region file
```

Artinya, ketika kita memakai memory-mapped file, kita tidak sekadar “membaca file ke memory”. Kita membuat mapping antara:

```text
virtual address space proses JVM
        ↔
page cache / virtual memory subsystem OS
        ↔
file di storage
```

Mental model ini penting karena banyak bug `MappedByteBuffer` bukan bug Java API, melainkan salah paham terhadap OS semantics.

Contoh gejala produksi:

```text
Heap rendah, tapi RSS naik.
File sudah di-close, tapi tidak bisa dihapus di Windows.
Mapped buffer sudah tidak dipakai, tapi disk space/mapping masih terlihat aktif.
Latency tiba-tiba spike saat akses byte tertentu.
force() sudah dipanggil, tapi crash consistency masih salah.
File dipotong oleh proses lain, lalu pembaca mmap crash/error.
```

Bagian ini akan membangun model dari bawah:

```text
file
  ↓
page cache
  ↓
virtual memory mapping
  ↓
page fault
  ↓
MappedByteBuffer
  ↓
flush / force
  ↓
unmap / lifecycle
  ↓
production design
```

---

## 1. Apa Itu Memory-Mapped File?

Secara normal, ketika Java membaca file dengan `InputStream` atau `FileChannel.read`, data bergerak seperti ini:

```text
storage device
   ↓
kernel page cache
   ↓
copy ke user-space buffer
   ↓
Java heap byte[] atau direct buffer
   ↓
aplikasi membaca byte
```

Dengan memory-mapped file, pola pikirnya berubah:

```text
file region dipetakan ke virtual address range proses
aplikasi membaca/menulis seolah-olah membaca memory
OS yang menangani kapan page file dimuat dari disk
```

Secara konseptual:

```text
File:        [ byte 0 ................................ byte N ]
                     ↓ mapped region offset + length
Virtual VM: [ address A ........................ address A+length ]
                     ↓
Java:       MappedByteBuffer.get(index), put(index, value)
```

`MappedByteBuffer` adalah `ByteBuffer` khusus yang kontennya adalah memory-mapped region dari file. Di Java, buffer ini dibuat melalui `FileChannel.map(...)`. Dokumentasi Java SE menyebutnya sebagai direct byte buffer yang kontennya adalah region file yang dimap ke memory, dan mapping tersebut tetap valid sampai buffer-nya di-garbage-collect. Ini adalah poin lifecycle yang sangat penting. 

---

## 2. API Dasar: `FileChannel.map`

Contoh minimal:

```java
import java.io.IOException;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class MmapReadExample {
    public static void main(String[] args) throws IOException {
        Path path = Path.of("data.bin");

        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long size = channel.size();

            MappedByteBuffer buffer = channel.map(
                    FileChannel.MapMode.READ_ONLY,
                    0,
                    size
            );

            byte first = buffer.get(0);
            byte second = buffer.get(1);

            System.out.println(first);
            System.out.println(second);
        }
    }
}
```

Poin penting:

```text
channel.close() tidak otomatis unmap mapping
mapping tetap valid selama MappedByteBuffer masih reachable / belum dilepas oleh JVM
```

Ini sering mengejutkan developer.

`FileChannel` adalah handle untuk membuat mapping. Setelah mapping dibuat, `MappedByteBuffer` mewakili mapping tersebut. Menutup channel tidak berarti mapping hilang.

---

## 3. `MapMode`: Read Only, Read Write, Private

`FileChannel.map` menerima `MapMode`.

Umumnya ada tiga mode penting:

```text
READ_ONLY
READ_WRITE
PRIVATE
```

### 3.1 `READ_ONLY`

```java
MappedByteBuffer buffer = channel.map(
        FileChannel.MapMode.READ_ONLY,
        0,
        channel.size()
);
```

Makna:

```text
aplikasi bisa membaca region file
aplikasi tidak boleh menulis lewat mapping
put(...) akan gagal
```

Cocok untuk:

```text
index immutable
lookup table
snapshot file
read-heavy analytical file
binary dictionary
```

### 3.2 `READ_WRITE`

```java
MappedByteBuffer buffer = channel.map(
        FileChannel.MapMode.READ_WRITE,
        0,
        size
);
```

Makna:

```text
aplikasi bisa membaca dan menulis lewat mapping
perubahan dapat dipropagasikan ke file
```

Tapi “dapat dipropagasikan” tidak sama dengan:

```text
setiap put langsung durable di storage
```

Perubahan bisa tinggal dulu di memory/page cache. Untuk mendorong perubahan ke storage, gunakan `force()`.

### 3.3 `PRIVATE`

Mode private secara konseptual mirip copy-on-write:

```text
modifikasi tidak harus terlihat sebagai perubahan permanen pada file
```

Cocok untuk kasus khusus, misalnya eksperimen/modifikasi lokal terhadap view file tanpa ingin mengubah file asal. Dalam sistem enterprise biasa, mode ini lebih jarang dipakai dibanding read-only atau read-write.

---

## 4. Mental Model OS: Virtual Memory dan Page

Memory-mapped file bekerja karena OS modern memakai virtual memory.

Setiap proses melihat address space sendiri:

```text
Process JVM virtual address space

0x0000_0000_0000_0000
    ...
[ Java heap mapping      ]
[ thread stack mappings  ]
[ native library mapping ]
[ direct buffer mappings ]
[ mmap file region       ]
    ...
0xFFFF_FFFF_FFFF_FFFF
```

Address space ini tidak sama dengan physical RAM.

OS memetakan virtual page ke physical page:

```text
virtual page -> physical frame
virtual page -> file-backed page
virtual page -> not loaded yet
virtual page -> swapped / evicted
```

Umumnya page size adalah 4 KiB, walaupun sistem bisa punya huge pages atau page size berbeda.

Ketika file dimap:

```text
virtual address range dibuat
range itu punya backing file
isi page belum tentu langsung dimuat ke RAM
```

Jadi operasi `map(...)` sering relatif murah dibanding membaca seluruh file, karena belum tentu semua byte masuk RAM.

---

## 5. Page Cache: “Memory” yang Bukan Java Heap

Ketika file dibaca, OS biasanya menaruh data di page cache.

Memory-mapped file memakai page cache secara natural.

Modelnya:

```text
storage file
    ↓ on demand
OS page cache
    ↓ mapped into process virtual address
MappedByteBuffer access
```

Dampaknya:

```text
heap dump tidak menunjukkan isi file mapped sebagai Java object besar
GC tidak mengelola page cache
RSS proses bisa naik karena page file menjadi resident
OS bisa meng-evict clean page jika memory pressure
```

Ini penting untuk Kubernetes/container:

```text
-Xmx 512m
mapped file 2 GiB
heap terlihat aman
RSS/cgroup memory bisa tetap naik saat page disentuh
pod bisa OOMKilled
```

Memory-mapped file bukan free lunch. Ia memindahkan sebagian problem dari Java heap ke OS memory subsystem.

---

## 6. Lazy Loading: `map()` Tidak Sama dengan `read all bytes`

Saat memanggil:

```java
MappedByteBuffer buffer = channel.map(MapMode.READ_ONLY, 0, size);
```

OS biasanya tidak langsung membaca seluruh `size` byte ke RAM.

Yang terjadi lebih mirip:

```text
buat virtual mapping
catat bahwa range virtual address ini backed by file region
saat aplikasi menyentuh page pertama kali, terjadi page fault
OS memuat page dari storage/page cache
instruksi aplikasi dilanjutkan
```

Karena itu, operasi pertama pada offset tertentu bisa mahal.

Contoh:

```java
byte b = buffer.get(512 * 1024 * 1024);
```

Walaupun hanya mengambil 1 byte, jika page terkait belum resident:

```text
CPU access virtual address
  ↓
page table miss / page not present
  ↓
page fault trap ke kernel
  ↓
kernel cari page di page cache atau baca dari disk
  ↓
page table diperbarui
  ↓
thread aplikasi lanjut
```

Dari sudut pandang Java, `get()` terlihat seperti operasi memory biasa. Dari sudut pandang runtime, ia bisa memicu I/O.

---

## 7. Page Fault: Minor vs Major

Page fault bukan selalu error. Dalam memory-mapped file, page fault adalah mekanisme normal.

Secara konseptual:

```text
minor page fault:
    page sudah ada di RAM/page cache,
    tetapi belum dipetakan ke page table proses

major page fault:
    page belum ada di RAM,
    perlu baca dari storage
```

Dampak performa:

```text
minor fault -> relatif murah tapi tetap kernel transition
major fault -> bisa sangat mahal karena I/O
```

Ini menjelaskan latency spike pada akses mmap.

Misalnya sistem low-latency membaca index file:

```text
p99 normal: 1 ms
p999 tiba-tiba: 80 ms
```

Kemungkinan:

```text
akses menyentuh page yang belum resident
major page fault terjadi
thread request menunggu disk/page-in
```

`MappedByteBuffer.load()` dapat digunakan untuk best-effort memuat konten buffer ke physical memory, tetapi dokumentasi Java menyatakan ini best effort dan bisa menyebabkan page fault serta I/O. Jadi `load()` bukan jaminan absolut bebas fault selamanya.

---

## 8. `isLoaded()` dan `load()`

`MappedByteBuffer` punya method spesifik:

```java
boolean loaded = buffer.isLoaded();
buffer.load();
```

### 8.1 `isLoaded()`

Makna praktis:

```text
bertanya apakah konten buffer kemungkinan resident di physical memory
```

Tapi ini bukan kontrak real-time yang sempurna. OS dapat mengubah kondisi setelah call kembali.

Pola pikir yang benar:

```text
isLoaded() adalah hint/observasi, bukan invariant produksi
```

### 8.2 `load()`

Makna praktis:

```text
best effort untuk membuat konten resident
```

Namun:

```text
bisa menyebabkan page fault
bisa menyebabkan I/O
bisa mahal untuk mapping besar
bukan jaminan page tidak akan di-evict setelahnya
```

Gunakan dengan hati-hati.

Contoh penggunaan yang masuk akal:

```java
MappedByteBuffer index = channel.map(MapMode.READ_ONLY, 0, channel.size());
index.load(); // warm-up best effort
```

Cocok bila:

```text
file relatif kecil / bounded
service punya warm-up phase
latency request path lebih penting daripada startup time
memory capacity cukup
```

Tidak cocok bila:

```text
file sangat besar
container memory limit ketat
startup harus cepat
file jarang diakses secara penuh
```

---

## 9. `force()`: Flush Bukan Magic Durability

Untuk mapping read-write:

```java
buffer.putLong(0, 123L);
buffer.force();
```

`force()` meminta perubahan pada buffer ditulis ke storage device yang berisi mapped file.

Java modern juga menyediakan:

```java
buffer.force(index, length);
```

untuk memaksa region tertentu.

Namun mental model durability harus hati-hati:

```text
put(...) mengubah memory/page cache
force(...) meminta OS menulis dirty pages ke storage
file-system/storage/hardware tetap punya aturan sendiri
```

`force()` bukan pengganti desain crash-consistency.

Jika membuat log/segment/index durable, pertanyaan yang harus dijawab:

```text
Apakah data ditulis sebelum metadata?
Apakah length/header/checksum diupdate terakhir?
Apa yang terjadi jika crash di tengah update?
Apakah ada torn write?
Apakah reader bisa membedakan record complete vs partial?
Apakah rename/swap file atomic dipakai?
Apakah directory fsync dibutuhkan?
```

Jangan menganggap:

```text
buffer.force() dipanggil
=> semua struktur data pasti konsisten setelah crash
```

Yang lebih benar:

```text
force() membantu persistence dirty page,
tetapi consistency adalah tanggung jawab format file/protocol update.
```

---

## 10. `MappedByteBuffer` sebagai Direct Buffer

`MappedByteBuffer` mewarisi `ByteBuffer` dan secara spesifikasi merupakan direct byte buffer.

Artinya ia tetap punya state:

```text
capacity
position
limit
mark
byte order
```

Semua bug state machine dari `ByteBuffer` tetap berlaku:

```java
buffer.get();       // position maju
buffer.get(100);    // absolute access, position tidak berubah
buffer.slice();     // view berbagi content
buffer.duplicate(); // state terpisah, content sama
```

Tetapi ada tambahan:

```text
content-nya backed by file mapping
akses bisa page fault
write bisa dirty page
force bisa flush
mapping lifecycle bergantung pada buffer reachability/cleanup
```

Jadi `MappedByteBuffer` adalah gabungan dari dua state machine:

```text
ByteBuffer state machine
    +
OS virtual memory mapping state machine
```

---

## 11. Closing Channel Tidak Sama dengan Unmapping

Contoh:

```java
MappedByteBuffer buffer;

try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
    buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, channel.size());
}

// channel sudah closed
byte b = buffer.get(0); // tetap bisa valid
```

Ini bukan bug. Mapping tetap valid selama `MappedByteBuffer` valid.

Implikasi:

```text
resource lifecycle mapping tidak sama dengan lifecycle FileChannel
```

Ini sering menjadi sumber bug:

```text
Developer menutup channel lalu mengira file tidak lagi digunakan.
Di Windows, file delete/truncate bisa gagal karena mapping masih aktif.
Di Linux, unlink semantics berbeda, tapi mapping tetap memegang content/inode sampai dilepas.
```

Jika desain membutuhkan file segera bisa dihapus/ditruncate, jangan mengandalkan GC yang tidak deterministic.

---

## 12. Unmap Problem: Kenapa Ini Sulit?

Secara historis, Java tidak menyediakan method publik sederhana seperti:

```java
buffer.unmap();
```

Masalahnya:

```text
Jika mapping dilepas saat masih ada reference/view/slice yang bisa mengakses address,
akses berikutnya bisa menjadi fatal memory error.
```

Dalam managed language, explicit unmap sulit karena safety.

Mapping bisa punya banyak view:

```java
MappedByteBuffer root = channel.map(MapMode.READ_ONLY, 0, size);
ByteBuffer slice = root.slice(100, 200);
ByteBuffer duplicate = root.duplicate();
```

Siapa yang boleh unmap?

```text
root?
slice?
duplicate?
owner object?
GC?
```

Kalau root di-unmap tetapi slice masih dipakai, apa yang terjadi?

Inilah alasan lifecycle mmap lebih rumit daripada `byte[]`.

OpenJDK issue lama tentang menambahkan unmap method menjelaskan problem praktisnya: setelah file dimap, operasi seperti delete atau truncate bisa gagal sampai mapping dilepas, tetapi programmer tidak bisa mengontrol waktu unmap secara akurat jika bergantung pada finalization/phantom-reference processing. Problem ini nyata secara operasional.

---

## 13. Java 8–25: Cara Berpikir Lifecycle Mapped Memory

Untuk seri ini, prinsip aman lintas Java 8–25:

```text
anggap mapping hidup selama MappedByteBuffer atau view-nya masih reachable
jangan desain correctness yang bergantung pada kapan GC membersihkan mapping
jangan truncate/delete file yang masih mungkin dimap
buat ownership lifecycle eksplisit di level aplikasi
batasi ukuran dan jumlah mapping
```

Dalam beberapa JDK/library, ada teknik internal/reflection/Unsafe untuk memaksa unmap. Tetapi ini:

```text
non-portable
tergantung internal JDK
terhalang module boundary di Java modern
bisa berbahaya jika masih ada akses setelah unmap
```

Untuk desain baru yang butuh explicit lifecycle memory mapping, pertimbangkan pendekatan yang lebih modern melalui Foreign Function & Memory API pada part berikutnya, atau library yang memang mengelola mapping lifecycle dengan kontrak ketat.

---

## 14. Mapped File vs `read(byte[])` vs Direct Buffer

Perbandingan konseptual:

| Mekanisme | Data berada di | Dikontrol oleh | Cocok untuk |
|---|---|---|---|
| `byte[]` | Java heap | GC | file kecil, parsing sederhana, data perlu dimanipulasi sebagai object |
| Heap `ByteBuffer` | Java heap | GC | API buffer dengan heap backing |
| Direct `ByteBuffer` | native memory | Cleaner/GC-triggered lifecycle | native I/O, buffer besar/long-lived, pooling |
| `MappedByteBuffer` | file-backed virtual memory/page cache | OS + JVM mapping lifecycle | random access file besar, index, segment log, read-mostly data |

Rule sederhana:

```text
Jika file kecil dan dipakai sebagai data biasa -> byte[] sering cukup.
Jika butuh I/O buffer besar/long-lived -> direct buffer.
Jika butuh random access ke file besar tanpa explicit read scheduling -> mmap.
Jika butuh explicit native memory lifecycle/safety -> MemorySegment/FFM.
```

---

## 15. Kapan `MappedByteBuffer` Sangat Berguna?

### 15.1 Random Access File Besar

Misalnya index file:

```text
key -> offset
record fixed-width
lookup langsung ke posisi tertentu
```

Dengan API read biasa:

```text
seek/read/copy/manage buffer
```

Dengan mmap:

```java
long offset = indexOffset(key);
long value = mapped.getLong(offset);
```

OS menangani page-in on demand.

### 15.2 Read-Mostly Immutable Data

Contoh:

```text
geolocation database
routing table
binary dictionary
precomputed lookup table
search index segment
```

Jika file immutable, desain lebih mudah:

```text
tidak ada dirty page
tidak perlu force
tidak ada partial write concern
reader bisa sharing mapping
```

### 15.3 Large Sequential Scan dengan OS Readahead

Sequential access dapat memanfaatkan readahead OS.

Namun untuk sequential read murni, mmap tidak selalu lebih cepat daripada `FileChannel`/streaming. Benchmark harus sesuai workload.

### 15.4 Embedded Storage / Log Segment

Banyak storage engine menggunakan memory-mapped segment untuk:

```text
append log
index page
metadata region
fixed-size page store
```

Tetapi di area ini crash-consistency menjadi sulit. Format file harus dirancang serius.

---

## 16. Kapan `MappedByteBuffer` Buruk atau Berbahaya?

### 16.1 File Sangat Besar dalam Container Memory Ketat

Mapping file besar tidak langsung memakai RAM penuh. Tetapi saat page disentuh, RSS/cgroup memory bisa naik.

Masalah:

```text
heap aman
GC normal
pod OOMKilled karena page cache/RSS
```

### 16.2 Latency-Sensitive Request Path Tanpa Warm-Up

Random access ke page dingin bisa major page fault.

Jika request user pertama yang menyentuh page dingin:

```text
request latency = application logic + disk/page-in latency
```

### 16.3 File Perlu Sering Delete/Truncate/Rotate

Mapping yang belum dilepas bisa mengganggu:

```text
delete
truncate
rename behavior tertentu
storage reclamation
Windows file lock behavior
```

### 16.4 Write-Heavy dengan Durability Ketat

Mmap write terlihat mudah:

```java
buffer.putLong(offset, value);
buffer.force();
```

Tetapi durable data structure jauh lebih sulit:

```text
ordering
partial update
torn write
checksum
versioning
recovery
metadata sync
```

### 16.5 Unbounded Mapping per Tenant/User/File

Anti-pattern:

```java
Map<String, MappedByteBuffer> buffers = new ConcurrentHashMap<>();
```

Tanpa eviction/lifecycle jelas, ini bisa menjadi native address-space/resource leak.

---

## 17. Mapping Size dan Integer Limit `ByteBuffer`

`ByteBuffer` memakai `int` untuk:

```text
capacity
position
limit
index
```

Artinya satu `MappedByteBuffer` tidak nyaman untuk region di atas sekitar 2 GiB karena batas `int`.

Untuk file besar, desain umumnya:

```text
file dibagi menjadi chunk/segment
setiap segment punya mapping sendiri
logical offset -> segment index + offset dalam segment
```

Contoh mapping segmented:

```java
final class MappedSegments {
    private final MappedByteBuffer[] segments;
    private final int segmentSize;

    MappedSegments(MappedByteBuffer[] segments, int segmentSize) {
        this.segments = segments;
        this.segmentSize = segmentSize;
    }

    byte get(long logicalOffset) {
        int segmentIndex = Math.toIntExact(logicalOffset / segmentSize);
        int indexInSegment = (int) (logicalOffset % segmentSize);
        return segments[segmentIndex].get(indexInSegment);
    }
}
```

Pilih segment size secara sadar:

```text
terlalu kecil -> banyak mapping/object/management overhead
terlalu besar -> lifecycle kasar, page pressure besar, sulit rotate
```

Ukuran umum bisa berupa:

```text
64 MiB
128 MiB
256 MiB
1 GiB
```

Tergantung workload dan OS.

---

## 18. Read Pattern: Sequential vs Random

`MappedByteBuffer` sering dipilih untuk random access, tetapi performanya sangat bergantung pada pattern.

### 18.1 Sequential Scan

```java
for (int i = 0; i < buffer.limit(); i++) {
    sum += buffer.get(i) & 0xFF;
}
```

Karakteristik:

```text
spatial locality bagus
OS readahead bisa membantu
page fault relatif predictable
```

Tetapi `get(i)` per byte bisa mahal karena method call/bounds check. Untuk parsing besar, baca per primitive atau batch jika memungkinkan.

### 18.2 Random Access

```java
for (long offset : offsets) {
    int value = buffer.getInt((int) offset);
}
```

Karakteristik:

```text
cache locality buruk
page fault tersebar
TLB pressure tinggi
storage random I/O jika page belum cached
```

Random access sangat kuat jika working set sudah resident. Sangat buruk jika working set jauh lebih besar daripada memory.

### 18.3 Strided Access

```text
akses setiap 4096 byte
akses setiap page boundary
```

Ini bisa menghasilkan page fault per akses jika file dingin. Dalam benchmark, pola strided dapat terlihat sangat buruk.

---

## 19. Write Pattern: Dirty Page dan Flush Cost

Saat menulis ke mapped region:

```java
buffer.putLong(offset, value);
```

OS menandai page sebagai dirty.

Kemudian dirty page dapat ditulis ke storage karena:

```text
OS background flush
memory pressure
explicit force()
file system policy
```

Masalahnya:

```text
force() pada region besar bisa mahal
flush burst bisa mengganggu latency
writeback bisa terjadi di waktu yang tidak selalu sesuai ekspektasi aplikasi
```

Pola buruk:

```java
for (Record r : records) {
    writeRecord(buffer, r);
    buffer.force(); // terlalu sering
}
```

Pola lebih baik:

```text
batch write
write checksum/commit marker
force per batch / per transaction boundary
recovery logic jelas
```

Contoh:

```java
for (Record r : batch) {
    writeRecord(buffer, r);
}

writeCommitMarker(buffer, batchEndOffset);
buffer.force(batchStartOffset, batchLength);
```

Tetap harus desain recovery untuk crash di tengah.

---

## 20. Crash Consistency: Format File Lebih Penting daripada API

Misalnya kita punya record:

```text
[length][payload][checksum]
```

Jika menulis `length` dulu, lalu crash sebelum payload selesai:

```text
reader melihat length valid
reader mencoba baca payload
payload partial/corrupt
```

Desain lebih aman:

```text
[payload][checksum][commit marker]
```

Atau:

```text
header punya version/status
record ditulis sebagai IN_PROGRESS
payload ditulis
checksum ditulis
status diubah menjadi COMMITTED terakhir
force dilakukan sesuai boundary
```

Contoh format sederhana:

```text
record_start:
  magic           4 bytes
  version         2 bytes
  status          1 byte   // 0 = empty, 1 = writing, 2 = committed
  length          4 bytes
  payload         N bytes
  checksum        4 bytes
```

Recovery:

```text
scan record
jika status != committed -> stop/ignore
jika checksum mismatch -> stop/ignore
jika length invalid -> stop/ignore
```

Mmap tidak menghapus kebutuhan WAL/checksum/commit protocol.

---

## 21. File Truncation dan Mapping: Bahaya Besar

Jika file dimap sepanjang 1 GiB, lalu proses lain truncate file menjadi 100 MiB, apa yang terjadi saat Java mengakses offset 500 MiB?

Jawaban praktis:

```text
perilaku bisa OS-dependent dan berbahaya
akses ke region yang backing file-nya tidak valid dapat menyebabkan error serius
```

Di Java, dokumentasi `MappedByteBuffer` sudah lama memberi peringatan bahwa behavior mapping bisa menjadi unspecified jika mapped file berubah ukuran atau kontennya berubah tergantung OS.

Prinsip desain:

```text
jangan truncate file yang masih dimap
jangan replace file in-place tanpa protocol
pakai immutable segment + atomic pointer/symlink/metadata swap
reader lama dibiarkan selesai dengan segment lama
baru setelah tidak ada reader, segment lama dilepas/dihapus
```

Pola production yang lebih aman:

```text
write new file: segment-0002.tmp
force file content
force metadata jika diperlukan
rename atomically: segment-0002.dat
publish manifest baru
reader baru pakai manifest baru
reader lama tetap pakai segment lama
reclaim segment lama setelah no active readers
```

---

## 22. File Delete/Rename Semantics: Linux vs Windows

Behavior file yang masih dimap berbeda antar OS.

Secara praktis:

```text
Linux/Unix:
    unlink dapat menghapus nama directory entry,
    tetapi inode/data tetap ada selama masih dibuka/dimap.

Windows:
    mapping aktif sering membuat delete/truncate gagal.
```

Jangan membuat sistem yang hanya kebetulan berjalan di Linux lalu gagal saat porting ke Windows, atau gagal dalam test tooling lokal developer Windows.

Rule lintas platform:

```text
anggap mapped file tidak boleh dimodifikasi/delete/truncate sampai mapping lifecycle selesai
```

---

## 23. Memory Visibility Antar Proses

Memory-mapped file bisa dipakai oleh beberapa proses.

Misalnya:

```text
Process A maps file read-write
Process B maps file read-only
```

Jika A menulis, apakah B langsung melihat?

Jawaban praktis:

```text
shared mapping memungkinkan perubahan terlihat melalui page cache,
tetapi ordering, visibility timing, cache coherence, dan synchronization tetap harus didesain.
```

Untuk komunikasi antar proses, butuh protocol:

```text
volatile-like flag tidak otomatis ada di file
memory ordering perlu dipikirkan
record boundary harus jelas
checksum/version penting
process crash harus ditangani
```

Java `MappedByteBuffer` sendiri tidak memberikan high-level IPC protocol.

Jika butuh IPC serius:

```text
definisikan memory layout
pakai atomic/ordered writes jika tersedia melalui API yang tepat
pakai file locks / OS primitives / protocol sequencing
pertimbangkan Aeron/Chronicle-like design/library jika workload advanced
```

---

## 24. File Locking Tidak Sama dengan Memory Safety

`FileChannel.lock()` mengunci region file untuk koordinasi antar proses.

Namun:

```text
file lock tidak otomatis membuat MappedByteBuffer access safe
file lock tidak otomatis flush dirty page
file lock tidak otomatis memberi object-level consistency
file lock tidak menggantikan protocol record/transaction
```

Contoh salah:

```java
try (FileLock lock = channel.lock()) {
    buffer.putLong(0, newValue);
}

// Mengira setelah lock dilepas data pasti durable dan reader pasti konsisten.
```

Yang benar:

```text
lock hanya coordination primitive
format update + flush + recovery tetap perlu
```

---

## 25. Heap Dump Tidak Cukup untuk Mmap Problem

Jika aplikasi memap file 10 GiB dan menyentuh 3 GiB page, heap dump mungkin hanya menunjukkan:

```text
beberapa object MappedByteBuffer kecil
array metadata kecil
manager object kecil
```

Tidak terlihat sebagai `byte[3GB]`.

Untuk investigasi, gunakan kombinasi:

```text
jcmd VM.native_memory
jcmd GC.heap_info
jcmd Thread.print
JFR
OS tools: pmap, smaps, vmstat, perf, top, ps
container metrics: RSS, working set, page cache, OOMKilled event
```

Di Linux, `/proc/<pid>/smaps` dapat menunjukkan mapping file:

```text
address-range perms offset device inode pathname
Size:
Rss:
Pss:
Shared_Clean:
Shared_Dirty:
Private_Clean:
Private_Dirty:
```

Untuk mapped file, `smaps` sering lebih informatif daripada heap dump.

---

## 26. RSS, VIRT, Page Cache, dan Container Memory

Metric OS sering membingungkan.

```text
VIRT:
    total virtual address space mapped.
    mmap file besar bisa menaikkan VIRT walau belum resident.

RSS:
    resident set size.
    page yang benar-benar resident dalam RAM dan attributed ke proses.

Page cache:
    kernel cache untuk file-backed pages.
    mapped file dapat muncul sebagai bagian RSS/working set.
```

Dalam container, yang penting sering bukan heap:

```text
cgroup memory usage = heap + native + stacks + code cache + metaspace + direct + mapped resident pages + other
```

Contoh sizing buruk:

```text
pod limit: 1 GiB
-Xmx: 900 MiB
mapped index touched: 300 MiB
thread/code/metaspace/direct: 150 MiB

hasil:
    heap belum penuh
    JVM tidak sempat throw Java OOM
    kernel OOM killer membunuh proses
```

Sizing harus menyisakan ruang untuk mmap resident pages.

---

## 27. Memory-Mapped File dan GC

GC tidak mengumpulkan page cache seperti object heap.

Tetapi GC tetap relevan karena:

```text
MappedByteBuffer object berada di heap
lifecycle mapping terikat reachability buffer/cleaner/internal reference
jika buffer masih strongly reachable, mapping tetap hidup
jika buffer tidak reachable, cleanup tergantung GC/reference processing
```

Masalah:

```text
GC tidak berjalan hanya karena OS ingin unmap file
heap kecil/stabil bisa membuat GC jarang berjalan
mapping bisa bertahan lebih lama dari ekspektasi aplikasi
```

Contoh:

```java
void process(Path path) throws IOException {
    try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
        MappedByteBuffer buffer = channel.map(MapMode.READ_ONLY, 0, channel.size());
        consume(buffer);
    }
    // buffer keluar scope, tapi belum tentu langsung unmapped
}
```

Keluar scope tidak sama dengan immediate cleanup.

---

## 28. Ownership Pattern untuk Mapped Buffer

Jangan menyebar `MappedByteBuffer` mentah ke seluruh sistem tanpa ownership jelas.

Buat wrapper:

```java
public final class MappedFileRegion {
    private final Path path;
    private final long offset;
    private final long length;
    private final MappedByteBuffer buffer;

    public MappedFileRegion(Path path, long offset, long length, MappedByteBuffer buffer) {
        this.path = path;
        this.offset = offset;
        this.length = length;
        this.buffer = buffer.asReadOnlyBuffer();
    }

    public byte get(long logicalOffset) {
        if (logicalOffset < 0 || logicalOffset >= length) {
            throw new IndexOutOfBoundsException("logicalOffset=" + logicalOffset + ", length=" + length);
        }
        return buffer.get(Math.toIntExact(logicalOffset));
    }

    public Path path() {
        return path;
    }

    public long offset() {
        return offset;
    }

    public long length() {
        return length;
    }
}
```

Untuk Java 8–25 portable, wrapper ini tidak menjanjikan explicit unmap. Ia menjanjikan:

```text
bounded access
read-only view jika perlu
centralized ownership metadata
lebih mudah tracking/debugging
```

Jika memakai library/internal API untuk explicit unmap, tetap sembunyikan di abstraction boundary.

---

## 29. Safe Read-Only Index Design

Misalnya kita punya index immutable:

```text
header
  magic
  version
  record_count
  checksum
records
  fixed-width entries
```

Desain aman:

```java
public final class ReadOnlyMappedIndex {
    private static final int HEADER_SIZE = 32;
    private static final int RECORD_SIZE = 16;

    private final MappedByteBuffer buffer;
    private final int recordCount;

    public ReadOnlyMappedIndex(Path path) throws IOException {
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long size = channel.size();
            if (size < HEADER_SIZE) {
                throw new IOException("Index file too small: " + size);
            }

            this.buffer = channel.map(FileChannel.MapMode.READ_ONLY, 0, size).asReadOnlyBuffer();
            this.recordCount = readAndValidateHeader(this.buffer, size);
        }
    }

    public long lookupLongByRecordId(int recordId) {
        if (recordId < 0 || recordId >= recordCount) {
            throw new IndexOutOfBoundsException("recordId=" + recordId);
        }

        int offset = HEADER_SIZE + recordId * RECORD_SIZE;
        return buffer.getLong(offset);
    }

    private static int readAndValidateHeader(MappedByteBuffer buffer, long size) throws IOException {
        int magic = buffer.getInt(0);
        if (magic != 0x4A4D_4944) { // example: "JMID"
            throw new IOException("Invalid index magic");
        }

        int version = buffer.getInt(4);
        if (version != 1) {
            throw new IOException("Unsupported index version: " + version);
        }

        int recordCount = buffer.getInt(8);
        long expectedSize = HEADER_SIZE + (long) recordCount * RECORD_SIZE;
        if (expectedSize > size) {
            throw new IOException("Truncated index: expected=" + expectedSize + ", actual=" + size);
        }

        return recordCount;
    }
}
```

Hal yang diperhatikan:

```text
file size divalidasi
magic/version divalidasi
record count divalidasi
read-only view dipakai
absolute access dipakai agar position tidak menjadi shared mutable state
```

---

## 30. Avoid Shared `position` Bug

Karena `MappedByteBuffer` adalah `ByteBuffer`, ia punya mutable `position`.

Bug:

```java
public int readNextInt() {
    return sharedMappedBuffer.getInt(); // position berubah
}
```

Jika dipakai multi-thread:

```text
thread A mengubah position
thread B mengubah position
read kacau
```

Lebih aman:

```java
public int readIntAt(int offset) {
    return sharedMappedBuffer.getInt(offset); // absolute read
}
```

Atau setiap consumer punya duplicate:

```java
ByteBuffer localView = sharedMappedBuffer.asReadOnlyBuffer();
localView.position(start);
localView.limit(end);
```

Prinsip:

```text
content boleh shared
cursor/state sebaiknya tidak shared
```

---

## 31. Bounds Discipline dan Logical Offset

Mmap sering dipakai untuk file format. Jangan mencampur:

```text
logical offset dalam domain file
physical offset dalam mapped region
ByteBuffer index int
record index
page index
```

Buat helper eksplisit:

```java
static int checkedRelativeOffset(long mappingBaseOffset, long logicalOffset, long mappingLength) {
    long relative = logicalOffset - mappingBaseOffset;
    if (relative < 0 || relative >= mappingLength) {
        throw new IndexOutOfBoundsException(
                "logicalOffset=" + logicalOffset
                        + ", mappingBaseOffset=" + mappingBaseOffset
                        + ", mappingLength=" + mappingLength
        );
    }
    return Math.toIntExact(relative);
}
```

Ini mencegah bug klasik:

```text
long logical offset dipaksa cast ke int
integer overflow
akses salah segment
silent data corruption
```

---

## 32. Endianness dalam File Format

`MappedByteBuffer` mewarisi byte order behavior dari `ByteBuffer`.

Default byte order `ByteBuffer` adalah big-endian kecuali diubah.

Untuk file format, jangan bergantung pada default tanpa eksplisit.

```java
MappedByteBuffer buffer = channel.map(MapMode.READ_ONLY, 0, size);
buffer.order(ByteOrder.LITTLE_ENDIAN);
```

Atau:

```java
buffer.order(ByteOrder.BIG_ENDIAN);
```

Pilih satu format dan dokumentasikan:

```text
Semua integer di file disimpan little-endian.
```

atau:

```text
Semua integer di file disimpan network byte order / big-endian.
```

Jangan mengikuti native endianness secara diam-diam jika file harus portable antar platform.

---

## 33. Alignment dan Atomicity

Membaca `long` dari offset yang tidak aligned bisa punya konsekuensi:

```text
CPU tertentu lebih lambat
CPU tertentu punya restriction
atomicity antar thread/proses tidak otomatis dijamin oleh ByteBuffer API
```

Untuk format file:

```text
align field besar ke boundary natural jika performa penting
hindari asumsi atomic update multi-byte tanpa protocol
pakai checksum/version/commit marker
```

Contoh layout yang lebih rapi:

```text
offset 0   magic int        4 bytes
offset 4   version int      4 bytes
offset 8   recordCount long 8 bytes
offset 16  dataStart long   8 bytes
offset 24  checksum long    8 bytes
```

Daripada field campur tanpa alignment.

---

## 34. Mmap dan Security

Memory-mapped file bisa memperbesar risiko jika file berasal dari input tidak terpercaya.

Risiko:

```text
malformed header menyebabkan offset salah
integer overflow pada offset calculation
file berubah di bawah kaki reader
resource exhaustion dengan file besar
membaca file sensitive ke address space proses
heap dump mungkin tidak memuat isi, tapi core dump bisa
```

Checklist:

```text
validasi file size
validasi magic/version
validasi semua offset dan length
pakai read-only mode untuk input tidak terpercaya
batasi max mapping size
jangan map file user arbitrarily tanpa quota
jangan expose mapped content ke log/error
```

---

## 35. Mmap dan Classloader / Resource Lifecycle Leak

Mapped buffer bisa bocor karena reference chain tidak sengaja:

```text
static cache
singleton registry
classloader retained
thread local
executor task queue
lambda capture
metrics tag/detail object
```

Contoh buruk:

```java
public final class IndexRegistry {
    private static final Map<String, MappedByteBuffer> INDEXES = new ConcurrentHashMap<>();
}
```

Jika index sering diganti:

```text
mapping lama tetap reachable
file lama sulit delete/truncate
RSS/native mapping bertambah
```

Lebih baik:

```text
cache bounded
reference counted reader lifecycle
generation/manifest model
metrics jumlah mapping dan total mapped length
```

---

## 36. Reference Counting Pattern untuk Segment Reader

Untuk immutable segment yang dipakai banyak request:

```java
public final class SegmentHandle {
    private final MappedByteBuffer buffer;
    private final AtomicInteger references = new AtomicInteger(1);
    private final AtomicBoolean retired = new AtomicBoolean(false);

    public SegmentHandle(MappedByteBuffer buffer) {
        this.buffer = buffer.asReadOnlyBuffer();
    }

    public SegmentHandle retain() {
        while (true) {
            int current = references.get();
            if (current <= 0 || retired.get()) {
                throw new IllegalStateException("Segment is retired");
            }
            if (references.compareAndSet(current, current + 1)) {
                return this;
            }
        }
    }

    public void release() {
        int remaining = references.decrementAndGet();
        if (remaining < 0) {
            throw new IllegalStateException("release without retain");
        }
    }

    public void retire() {
        retired.set(true);
        release();
    }

    public byte get(int index) {
        return buffer.get(index);
    }
}
```

Catatan:

```text
Ini tidak force unmap secara portable.
Tetapi ini mengatur application-level lifecycle agar tidak ada reader aktif ketika segment akan direclaim.
```

Di sistem nyata, reclaim bisa dilakukan setelah:

```text
reference count 0
buffer tidak dipublish lagi
GC/unmap atau library-specific cleanup terjadi
file deletion dijadwalkan aman
```

---

## 37. Mmap Warm-Up Strategy

Untuk latency-sensitive read-only file:

```java
public static void warmUp(MappedByteBuffer buffer, int pageSize) {
    long sum = 0;
    for (int i = 0; i < buffer.limit(); i += pageSize) {
        sum += buffer.get(i) & 0xFF;
    }
    if (sum == 42) {
        System.out.println("impossible");
    }
}
```

Tujuan:

```text
menyentuh setiap page agar page fault terjadi saat warm-up, bukan request path
```

Tapi hati-hati:

```text
warm-up file besar bisa membanjiri I/O
bisa menaikkan RSS besar
bisa mengusir page cache lain
bisa memperlambat startup
page tetap bisa di-evict setelah warm-up
```

Strategi lebih halus:

```text
warm-up hanya header/hot region
background prefetch bertahap
rate limit warm-up
ukur page faults dan RSS
```

---

## 38. Observability untuk Mmap

Metric yang perlu dipantau:

```text
jumlah mapped segment
logical mapped bytes
RSS process
container memory working set
major page faults
minor page faults
I/O read throughput
I/O writeback throughput
time spent in force()
file rotation/reclaim lag
failed delete/truncate
```

Java-level metric contoh:

```java
public record MmapMetrics(
        long mappedRegionCount,
        long mappedLogicalBytes,
        long activeSegmentCount,
        long retiredSegmentCount,
        long forceCount,
        long forceTotalNanos
) {}
```

OS-level:

```bash
ps -o pid,vsz,rss,comm -p <pid>
cat /proc/<pid>/status
cat /proc/<pid>/smaps
vmstat 1
pidstat -r -d -p <pid> 1
```

Native Memory Tracking mungkin menunjukkan kategori terkait NIO/internal, tetapi file-backed mapping dan RSS detail sering perlu OS tools.

---

## 39. Diagnosing: Heap Stabil tapi RSS Naik

Gejala:

```text
heap used after GC stabil di 300 MiB
-Xmx 1 GiB
RSS naik dari 800 MiB ke 3 GiB
pod OOMKilled
```

Kemungkinan:

```text
direct buffer growth
mapped file pages resident
native library allocation
thread stack growth
metaspace/code cache
malloc fragmentation
```

Langkah diagnosis:

```text
1. Ambil GC log / jcmd GC.heap_info untuk pastikan heap.
2. Ambil jcmd VM.native_memory summary/detail jika NMT aktif.
3. Cek jumlah direct buffer via JMX/BufferPoolMXBean.
4. Cek /proc/<pid>/smaps untuk file-backed mappings.
5. Cari mapping path file besar.
6. Bandingkan Rss/Private_Dirty/Shared_Clean per mapping.
7. Korelasikan dengan deployment event, file rotation, cache warm-up, request traffic.
```

Java snippet untuk BufferPoolMXBean:

```java
import java.lang.management.BufferPoolMXBean;
import java.lang.management.ManagementFactory;

public class BufferPools {
    public static void main(String[] args) {
        for (BufferPoolMXBean pool : ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)) {
            System.out.printf(
                    "%s: count=%d, memoryUsed=%d, totalCapacity=%d%n",
                    pool.getName(),
                    pool.getCount(),
                    pool.getMemoryUsed(),
                    pool.getTotalCapacity()
            );
        }
    }
}
```

Catatan:

```text
Mapped buffer accounting bisa berbeda antar JDK/OS.
Jangan bergantung pada satu metric saja.
```

---

## 40. Diagnosing: Latency Spike karena Page Fault

Gejala:

```text
CPU tidak penuh
GC pause rendah
heap normal
request tertentu tiba-tiba lambat
akses file/index menggunakan mmap
```

Kemungkinan:

```text
major page fault
storage latency
page cache eviction
random working set lebih besar dari RAM
```

Langkah:

```text
1. Cek major page fault per process.
2. Cek disk read latency/throughput.
3. Cek apakah spike terjadi setelah restart/deploy/cold cache.
4. Cek working set file vs memory tersedia.
5. Tambahkan warm-up/hot-region preload jika cocok.
6. Pertimbangkan read-ahead/manual caching untuk hot keys.
```

Design fix bisa berupa:

```text
make hot index smaller
split hot/cold data
load hot region ke heap/direct memory
use bounded application cache
increase memory headroom
change access pattern
avoid mmap for highly random cold access
```

---

## 41. Diagnosing: File Tidak Bisa Dihapus

Gejala:

```text
file rotation gagal
Windows test gagal delete
disk cleanup tidak berhasil
```

Kemungkinan:

```text
MappedByteBuffer masih reachable
slice/duplicate masih reachable
cache masih menyimpan old segment
classloader leak
GC belum cleanup mapping
```

Langkah:

```text
1. Cari semua reference ke mapped segment wrapper.
2. Pastikan registry/cache menghapus segment lama.
3. Pastikan tidak ada background task masih hold buffer.
4. Heap dump: cari MappedByteBuffer/DirectByteBuffer/reference chain.
5. Uji lifecycle dengan weak reference dalam test.
6. Hindari truncate/delete sampai reader lifecycle selesai.
```

---

## 42. Testing Mmap Code

Test yang harus ada:

```text
valid file
file too small
invalid magic
unsupported version
truncated record
offset overflow
read-only write attempt
concurrent read with duplicate views
file rotation behavior
segment boundary access
force/recovery simulation
```

Contoh test offset overflow:

```java
static int toIntIndex(long value) {
    return Math.toIntExact(value);
}
```

Jangan pakai:

```java
int index = (int) longOffset;
```

Karena bisa silent overflow.

---

## 43. Benchmarking Mmap dengan Benar

Mmap benchmark sering menipu karena cache state.

Pertanyaan wajib:

```text
Apakah file sudah ada di page cache?
Apakah benchmark cold-cache atau warm-cache?
Apakah file lebih besar dari RAM?
Apakah access sequential atau random?
Apakah mengukur page fault?
Apakah storage device sama dengan production?
Apakah container memory limit sama?
Apakah benchmark memanggil force()?
```

Cold-cache benchmark dan warm-cache benchmark bisa berbeda drastis.

```text
warm cache:
    terlihat seperti memory access

cold cache:
    terlihat seperti storage workload
```

Jangan menyimpulkan mmap “cepat” hanya dari warm-cache microbenchmark.

---

## 44. Design Pattern: Immutable Segment + Manifest

Pattern kuat untuk read-heavy systems:

```text
segments immutable
manifest menunjuk active segments
update membuat segment baru
publish manifest baru secara atomic
old readers memakai old manifest
new readers memakai new manifest
old segment direclaim setelah no readers
```

Diagram:

```text
manifest-v1.json -> segment-A.dat, segment-B.dat

writer creates:
    segment-C.tmp
    segment-C.dat
    manifest-v2.tmp
    manifest-v2.json

new readers:
    manifest-v2 -> segment-A.dat, segment-C.dat

old readers:
    manifest-v1 -> segment-A.dat, segment-B.dat
```

Keuntungan:

```text
no in-place mutation
no truncate while mapped
safe rollback
easy validation
better crash recovery
```

---

## 45. Design Pattern: Fixed-Size Page Store

Untuk storage internal:

```text
file dibagi page 4 KiB / 8 KiB / 16 KiB
setiap page punya header/checksum
page id -> offset
```

Layout:

```text
page header:
  pageId
  pageType
  version
  checksum
  LSN
payload
```

Keuntungan:

```text
alignment jelas
recovery lebih mudah
partial corruption bisa diisolasi
cache/page replacement lebih terstruktur
```

Mmap hanya menyediakan addressable bytes. Page-store design menyediakan meaning.

---

## 46. Design Pattern: Hot Heap Index + Cold Mmap Payload

Tidak semua harus mmap.

Pattern hybrid:

```text
hot metadata / key map -> Java heap
large immutable payload -> mapped file
```

Contoh:

```text
HashMap<String, Long> keyToOffset di heap
payload besar di MappedByteBuffer
```

Keuntungan:

```text
lookup hot cepat
payload tidak membanjiri heap
GC tidak menelusuri payload besar
```

Risiko:

```text
key map bisa besar
String/object overhead tinggi
payload random access bisa page fault
```

Optimasi lanjutan:

```text
use compact key representation
use primitive maps
use sorted index in mmap
cache hot payload subset
```

---

## 47. Mmap dan Off-Heap Seri Berikutnya

`MappedByteBuffer` adalah salah satu bentuk off-heap/file-backed memory, tetapi bukan satu-satunya.

Di part berikutnya kita akan masuk ke Foreign Function & Memory API:

```text
MemorySegment
Arena
MemoryLayout
ValueLayout
lifetime safety
temporal/spatial bounds safety
```

Perbedaan mental model:

```text
MappedByteBuffer:
    ByteBuffer API lama,
    lifecycle cleanup tidak explicit secara user-facing portable,
    file-backed mapping.

MemorySegment:
    API modern,
    explicit scope/lifetime melalui Arena,
    bisa native/off-heap/file-mapped tergantung penggunaan,
    lebih kuat untuk bounds dan lifecycle safety.
```

---

## 48. Practical Decision Matrix

| Pertanyaan | Jika jawabannya ya | Rekomendasi awal |
|---|---|---|
| File kecil dan perlu parsing penuh? | Ya | `Files.readAllBytes` / stream / heap buffer |
| File besar, random read-mostly, immutable? | Ya | `MappedByteBuffer` cocok |
| File besar, sequential scan saja? | Ya | Bandingkan mmap vs `FileChannel` streaming |
| Butuh explicit memory lifetime kuat? | Ya | Pertimbangkan FFM `MemorySegment` |
| File sering truncate/delete/rotate? | Ya | Hindari long-lived mmap atau pakai immutable segment pattern |
| Latency p999 sangat ketat? | Ya | Hati-hati page fault; warm-up/hot cache/sizing |
| Container memory limit ketat? | Ya | Hitung RSS/page cache headroom |
| Write-heavy dengan durability ketat? | Ya | Desain WAL/checksum/commit; jangan mengandalkan `force()` saja |
| Multi-process communication? | Ya | Butuh synchronization protocol, bukan mmap saja |

---

## 49. Production Checklist

Sebelum memakai `MappedByteBuffer` di production, jawab:

```text
1. Apakah access pattern sequential, random, atau mixed?
2. Apakah file immutable atau mutable?
3. Berapa ukuran file maksimum?
4. Apakah satu mapping cukup atau perlu segmented mapping?
5. Bagaimana mapping lifecycle dikelola?
6. Siapa owner buffer?
7. Apakah buffer mentah boleh tersebar ke layer lain?
8. Apakah file boleh dihapus/truncate saat masih mapped?
9. Bagaimana crash recovery jika write mmap dipakai?
10. Apakah force() dipakai di boundary yang benar?
11. Bagaimana major page fault dipantau?
12. Bagaimana RSS/container memory dipantau?
13. Apakah warm-up perlu?
14. Apakah ada fallback jika file corrupt/truncated?
15. Apakah test mencakup invalid format dan boundary?
16. Apakah deployment Windows/Linux behavior relevan?
17. Apakah security sensitive content bisa masuk core dump?
18. Apakah ada metric jumlah mapping dan mapped bytes?
```

Jika sebagian besar belum bisa dijawab, mmap belum siap dipakai sebagai fondasi sistem kritikal.

---

## 50. Ringkasan Mental Model

`MappedByteBuffer` bukan sekadar “file sebagai ByteBuffer”. Ia adalah:

```text
ByteBuffer state machine
    +
file-backed virtual memory mapping
    +
OS page cache
    +
lazy page fault loading
    +
non-deterministic mapping cleanup
    +
file-system durability semantics
```

Gunakan mental model berikut:

```text
map() membuat address range, bukan membaca seluruh file.
get()/put() bisa terlihat seperti memory access, tetapi bisa memicu page fault/I/O.
force() membantu flush dirty page, tetapi tidak otomatis membuat data structure crash-consistent.
close(channel) tidak unmap buffer.
GC tidak sama dengan deterministic resource lifecycle.
Heap dump tidak cukup untuk mmap/native memory problem.
RSS/container memory tetap harus dihitung.
```

Mmap sangat kuat untuk:

```text
large immutable read-mostly data
random access index
segmented storage
zero-copy-ish file access pattern
```

Tetapi berbahaya untuk:

```text
unbounded mapping
file mutation tanpa protocol
latency-sensitive cold random access
container memory limit tanpa headroom
cleanup yang bergantung pada GC timing
```

Top engineer tidak memakai mmap karena “lebih cepat”. Top engineer memakai mmap ketika model data, lifecycle, durability, dan observability-nya memang cocok.

---

## 51. Latihan Praktis

### Latihan 1 — Read-Only Binary Index

Buat file format:

```text
magic: 4 bytes
version: 4 bytes
recordCount: 4 bytes
reserved: 4 bytes
records: repeated long value
```

Implementasikan reader dengan `MappedByteBuffer`.

Syarat:

```text
validasi file size
validasi magic/version
gunakan absolute getLong
jangan share mutable position
pakai explicit byte order
```

### Latihan 2 — Segment Mapping

Buat wrapper yang dapat membaca byte dari file >2 GiB secara logical offset dengan segment size 128 MiB.

Syarat:

```text
logical offset long
segment index dihitung aman
offset dalam segment int dengan bounds check
jangan cast long ke int tanpa validasi
```

### Latihan 3 — Page Fault Experiment

Buat program yang:

```text
membuat file besar
map file
akses sequential
akses random
ukur waktu akses pertama dan kedua
```

Amati perbedaan cold-ish vs warm-ish access.

### Latihan 4 — Force and Recovery

Buat format append-only sederhana:

```text
record header
payload
checksum
commit marker
```

Simulasikan crash dengan menghentikan program di tengah write. Buat recovery scanner yang bisa berhenti di record terakhir yang valid.

### Latihan 5 — RSS Observation

Jalankan program yang memap file besar lalu menyentuh page bertahap.

Amati:

```text
heap usage
RSS
major/minor page faults
/proc/<pid>/smaps
```

Tujuannya melihat langsung bahwa heap dan RSS adalah dua cerita berbeda.

---

## 52. Kesalahan Umum yang Harus Dihindari

```text
1. Mengira map() membaca seluruh file.
2. Mengira close(channel) melepas mapping.
3. Mengira force() menyelesaikan semua masalah durability.
4. Menggunakan shared relative get/put multi-thread.
5. Meng-cast long offset ke int sembarangan.
6. Mapping file besar di container tanpa RSS headroom.
7. Menghapus/truncate file saat masih ada reader mapped.
8. Menggunakan mmap untuk random cold access dengan latency SLO ketat.
9. Tidak punya metric jumlah mapping dan mapped bytes.
10. Tidak menguji file corrupt/truncated.
11. Bergantung pada GC untuk resource cleanup deterministik.
12. Menyebar MappedByteBuffer mentah tanpa ownership.
13. Tidak eksplisit soal byte order.
14. Menganggap mmap selalu lebih cepat daripada FileChannel.
15. Mengabaikan OS-specific semantics.
```

---

## 53. Penutup Bagian 013

Bagian ini menutup kelompok awal `ByteBuffer` dan direct/native file-backed memory:

```text
part 011 -> ByteBuffer as state machine
part 012 -> DirectBuffer and native memory
part 013 -> MappedByteBuffer and OS page cache
```

Setelah ini, kita naik ke API modern untuk off-heap/native memory:

```text
part 014 -> Foreign Function & Memory API: Modern Off-Heap Memory
```

Di part berikutnya, fokusnya bukan lagi file mapping via `ByteBuffer`, tetapi model memory modern Java:

```text
MemorySegment
Arena
MemoryLayout
ValueLayout
spatial safety
temporal safety
native interop
migration dari Unsafe/direct buffer
```

---

## Referensi

- Java SE 25 API: `MappedByteBuffer`, `ByteBuffer`, `Buffer`, dan operasi khusus mapped buffer seperti `load`, `isLoaded`, dan `force`.
- Java SE 25 API: `FileChannel.map` dan `FileChannel.MapMode`.
- OpenJDK issue JDK-4724038 tentang problem explicit unmap pada `MappedByteBuffer`.
- Java SE 11 API `MappedByteBuffer` untuk memastikan konsep mapping lifecycle konsisten dari era Java 11 ke Java 25.
- Dokumentasi dan perilaku umum OS virtual memory/page cache untuk memahami page fault, file-backed mappings, RSS, dan durability semantics.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-memory-byte-bit-buffer-offheap-gc-part-012](./learn-java-memory-byte-bit-buffer-offheap-gc-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-memory-byte-bit-buffer-offheap-gc-part-014](./learn-java-memory-byte-bit-buffer-offheap-gc-part-014.md)
