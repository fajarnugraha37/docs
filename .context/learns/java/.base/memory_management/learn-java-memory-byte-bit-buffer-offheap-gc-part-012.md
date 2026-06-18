# learn-java-memory-byte-bit-buffer-offheap-gc-part-012

# Direct Buffer and Native Memory: What Actually Happens

> Seri: `learn-java-memory-byte-bit-buffer-offheap-gc`  
> Part: `012`  
> Topik: `Direct Buffer and Native Memory`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami apa yang benar-benar terjadi ketika Java menggunakan memory di luar Java heap melalui `ByteBuffer.allocateDirect`, bagaimana direct memory dibatasi, bagaimana dilepas, bagaimana ia terlihat dari OS/container, dan bagaimana mendiagnosis masalah produksi seperti `OutOfMemoryError: Direct buffer memory` atau RSS yang naik sementara heap terlihat stabil.

---

## 0. Posisi Bagian Ini dalam Seri

Pada part sebelumnya kita membahas `ByteBuffer` sebagai abstraksi state machine:

```text
capacity
position
limit
mark
```

Kita juga membedakan:

```text
HeapByteBuffer   -> backing storage berada di Java heap
DirectByteBuffer -> backing storage berada di native/off-heap memory
```

Bagian ini masuk lebih dalam ke pertanyaan:

```text
Kalau direct buffer bukan berada di Java heap,
sebenarnya dia berada di mana?
Siapa yang mengalokasikan?
Siapa yang membebaskan?
Apa hubungannya dengan GC?
Kenapa heap dump tidak menunjukkan masalahnya?
Kenapa proses bisa OOMKilled padahal heap masih rendah?
```

Ini adalah salah satu area yang membedakan engineer biasa dan engineer yang benar-benar mengerti runtime production Java.

---

## 1. Core Mental Model

Direct buffer adalah object Java kecil yang menunjuk ke blok memory native.

Secara sangat sederhana:

```text
Java heap
┌──────────────────────────────┐
│ DirectByteBuffer object       │
│ - address --------------------┼──────┐
│ - capacity                    │      │
│ - position                    │      │
│ - limit                       │      │
│ - cleaner/deallocator         │      │
└──────────────────────────────┘      │
                                      │
Native memory / off-heap              │
┌─────────────────────────────────────▼─────────────┐
│ raw bytes allocated outside Java heap              │
│ [00 1F A0 ...]                                     │
└───────────────────────────────────────────────────┘
```

Jadi direct buffer memiliki dua sisi:

| Sisi | Lokasi | Dikelola oleh | Terlihat di heap dump? |
|---|---|---|---|
| wrapper object | Java heap | GC | Ya |
| actual byte storage | native memory | JVM/native allocator + cleaner lifecycle | Tidak sebagai byte array normal |

Kesalahan mental model yang sering terjadi:

> “Direct buffer itu tidak memakai memory aplikasi Java.”

Yang benar:

> Direct buffer tidak memakai Java heap untuk backing bytes, tetapi tetap memakai memory proses JVM. OS dan container tetap menghitungnya sebagai memory process/RSS/virtual mapping tergantung kondisi page touch dan allocator behavior.

---

## 2. Heap Memory vs Native Memory vs RSS

Sebelum membahas direct buffer, kita harus rapi membedakan beberapa istilah.

### 2.1 Java heap

Java heap adalah area untuk object managed Java:

```text
new User()
new byte[1024]
new ArrayList<>()
new HashMap<>()
```

Dibatasi oleh flag seperti:

```bash
-Xmx
-XX:MaxRAMPercentage
```

GC mengelola object di heap.

---

### 2.2 Native memory

Native memory adalah memory proses JVM di luar Java heap.

Contoh pemakai native memory:

```text
thread stack
metaspace
code cache
GC internal structures
JIT/compiler data
JNI/native libraries
NIO direct buffer
memory mapped regions
malloc allocations by native code
FFM MemorySegment native arena
```

Native memory tetap memory proses JVM.

---

### 2.3 RSS

RSS, atau Resident Set Size, adalah memory proses yang saat ini resident di physical memory menurut OS.

Secara production-oriented:

```text
RSS ~= memory yang membuat container/pod terlihat besar dari sisi OS/cgroup
```

RSS bisa lebih besar dari heap karena:

```text
RSS = heap committed/resident
    + native memory resident
    + thread stacks touched
    + direct buffer pages touched
    + metaspace/code cache
    + mmap pages resident
    + allocator fragmentation/arena overhead
    + JVM internal structures
```

Jadi ini bisa terjadi:

```text
-Xmx = 2 GB
heap used = 900 MB
pod RSS = 3.4 GB
container limit = 3.5 GB
=> pod hampir OOMKilled walaupun heap terlihat aman
```

---

## 3. Apa Itu Direct Buffer?

`ByteBuffer.allocateDirect(capacity)` membuat byte buffer yang backing storage-nya berada di native memory.

API `ByteBuffer` menyatakan bahwa direct buffer biasanya dipakai saat buffer tersebut memberi keuntungan performa nyata, terutama untuk buffer besar, long-lived, dan terkena operasi native I/O. Dokumentasi juga menekankan bahwa direct buffer bisa memiliki biaya alokasi/dealokasi lebih tinggi daripada non-direct buffer.

Mental model:

```java
ByteBuffer heap = ByteBuffer.allocate(1024);       // byte storage di Java heap
ByteBuffer direct = ByteBuffer.allocateDirect(1024); // byte storage di native memory
```

Perbedaan konseptual:

| Aspek | Heap ByteBuffer | Direct ByteBuffer |
|---|---|---|
| Backing bytes | `byte[]` di Java heap | native memory |
| GC melihat byte storage | Ya | Tidak sebagai object heap |
| Allocation cost | Murah relatif | Lebih mahal |
| Deallocation | Normal GC | Cleaner/deallocator setelah wrapper unreachable |
| Cocok untuk | small/short-lived data | large/long-lived I/O buffer |
| Risk | heap pressure | native/RSS/direct OOM |

---

## 4. Kenapa Direct Buffer Ada?

Direct buffer ada karena banyak operasi I/O pada akhirnya berbicara dengan OS/kernel/native code.

Misalnya network/file I/O:

```text
Java object world
    ↓
JVM/native boundary
    ↓
OS syscall/kernel
    ↓
device/socket/file/page cache
```

Heap memory adalah managed memory yang bisa dipindahkan oleh GC, dikompaksi, dan memiliki object metadata. Native I/O sering membutuhkan alamat memory stabil untuk transfer data.

Dengan heap buffer, JVM/OS mungkin perlu melakukan copy ke intermediate native buffer sebelum syscall.

Dengan direct buffer, backing storage sudah berada di native memory, sehingga path I/O tertentu dapat mengurangi copy.

Simplified model:

```text
Heap buffer path:
Java heap byte[]
  -> copy/pin/intermediate native buffer
  -> kernel I/O

Direct buffer path:
native memory buffer
  -> kernel I/O
```

Catatan penting:

> Direct buffer tidak otomatis lebih cepat untuk semua kasus. Ia hanya masuk akal ketika reduced-copy/native I/O benefit lebih besar daripada biaya allocation, lifecycle, memory pressure, dan complexity.

---

## 5. Direct Buffer Bukan “Free Performance”

Direct buffer sering disalahgunakan karena terdengar seperti optimization.

Padahal:

```text
allocateDirect kecil dan sering
= mahal + native pressure + cleaner dependency + harder observability
```

Gunakan direct buffer terutama jika:

```text
buffer cukup besar
buffer relatif long-lived
buffer dipakai berulang
buffer dekat dengan socket/file/channel/native I/O
profiling membuktikan ada benefit
```

Hindari direct buffer jika:

```text
buffer kecil
buffer temporary
hanya untuk parsing sederhana
lifecycle tidak jelas
alokasi per request tanpa pooling
heap memory masih cukup dan copy cost bukan bottleneck
```

Rule of thumb:

```text
Heap byte[] / heap ByteBuffer first.
Direct buffer only when there is a measured reason.
```

---

## 6. Apa yang Terjadi Saat `allocateDirect`?

Secara konseptual, `ByteBuffer.allocateDirect(size)` melakukan beberapa hal:

```text
1. Validasi capacity.
2. Meminta native memory sebesar size, plus kemungkinan alignment/page overhead.
3. Membuat object DirectByteBuffer di heap.
4. Menyimpan native address di object wrapper.
5. Menyiapkan mekanisme deallocation, umumnya melalui cleaner/deallocator.
6. Mengembalikan object ByteBuffer ke application code.
```

Pseudo mental model:

```java
ByteBuffer direct = ByteBuffer.allocateDirect(64 * 1024);
```

Menjadi:

```text
heap allocation:
  DirectByteBuffer wrapper object

native allocation:
  64 KiB raw memory block

lifecycle link:
  wrapper unreachable -> cleaner eventually frees native block
```

Yang penting:

```text
Direct memory lifecycle bergantung pada reachability object wrapper.
```

Jika wrapper masih reachable, native memory tetap dianggap hidup.

Jika wrapper sudah unreachable, native memory belum tentu langsung bebas saat itu juga; pelepasan bergantung pada GC/reference processing/cleaner execution.

---

## 7. Kenapa Direct Buffer Tetap Berhubungan dengan GC?

Ini tampak paradoks:

```text
Direct buffer berada di luar heap,
tetapi pelepasannya bergantung pada GC.
```

Penjelasannya:

```text
Native memory block tidak punya reachability Java sendiri.
Yang punya reachability adalah DirectByteBuffer wrapper di heap.
```

Selama wrapper reachable:

```text
GC menganggap object DirectByteBuffer masih hidup.
Cleaner tidak boleh membebaskan native memory.
```

Saat wrapper unreachable:

```text
GC dapat menemukan bahwa wrapper mati.
Cleaner/deallocator dapat dijalankan.
Native memory dapat dibebaskan.
```

Jadi direct memory leak sering sebenarnya adalah:

```text
leak reference ke wrapper object
```

atau:

```text
wrapper sudah mati, tetapi cleanup terlambat dibanding laju allocateDirect
```

---

## 8. Direct Memory Limit: `MaxDirectMemorySize`

Direct buffer memory memiliki limit JVM tersendiri melalui:

```bash
-XX:MaxDirectMemorySize=<size>
```

Contoh:

```bash
java -Xmx2g -XX:MaxDirectMemorySize=512m -jar app.jar
```

Artinya:

```text
Java heap max         = 2 GB
JDK direct buffer max = 512 MB
```

Jika aplikasi mencoba mengalokasikan direct buffer melebihi limit tersebut, ia dapat gagal dengan:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Penting:

```text
MaxDirectMemorySize terutama membatasi direct ByteBuffer allocation path JDK.
Ia bukan batas universal untuk semua native memory proses JVM.
```

Native memory lain tetap bisa tumbuh:

```text
metaspace
thread stacks
code cache
GC native structures
JNI malloc
native libraries
some Unsafe/native allocations depending path
mmap/page cache interactions
FFM/native allocations depending API/runtime accounting
```

Jadi jangan berpikir:

```text
MaxDirectMemorySize = total off-heap limit
```

Yang lebih benar:

```text
MaxDirectMemorySize = direct ByteBuffer budget, bukan total native memory budget.
```

---

## 9. Default `MaxDirectMemorySize`: Jangan Mengandalkan Asumsi Buta

Di banyak runtime HotSpot, jika `MaxDirectMemorySize` tidak diset eksplisit, default efektifnya sering berkaitan dengan maximum heap size. Tetapi detailnya bisa bergantung versi, implementation, launcher ergonomics, container detection, dan flag lain.

Untuk production, pendekatan yang lebih aman:

```text
Jangan bergantung pada default.
Tetapkan explicit memory budget.
```

Contoh buruk:

```bash
java -Xmx3g -jar app.jar
```

Masalah:

```text
Berapa direct memory?
Berapa metaspace?
Berapa thread stack?
Berapa code cache?
Berapa GC overhead?
Berapa RSS total?
```

Contoh lebih eksplisit:

```bash
java \
  -Xms2g \
  -Xmx2g \
  -XX:MaxDirectMemorySize=512m \
  -XX:MaxMetaspaceSize=256m \
  -Xss512k \
  -jar app.jar
```

Tetap bukan berarti semua native memory terkunci sempurna, tetapi setidaknya major budget lebih jelas.

---

## 10. Direct Memory OOM vs Java Heap OOM

### 10.1 Java heap OOM

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
```

Biasanya berarti:

```text
heap object allocation gagal
```

Kemungkinan penyebab:

```text
heap terlalu kecil
allocation rate tinggi
retained object tinggi
memory leak heap
large array allocation
```

Heap dump biasanya relevan.

---

### 10.2 Direct buffer OOM

Contoh:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Biasanya berarti:

```text
JDK direct buffer budget habis
```

Kemungkinan penyebab:

```text
allocateDirect terlalu sering
pool direct buffer terlalu besar
buffer leak
slow cleaner/deallocation relative to allocation rate
MaxDirectMemorySize terlalu kecil
framework memakai direct buffer secara agresif
backpressure gagal sehingga banyak buffer tertahan
```

Heap dump bisa membantu menemukan wrapper `DirectByteBuffer`, tetapi byte storage-nya tidak muncul sebagai `byte[]` biasa.

---

### 10.3 Container OOMKilled

Contoh Kubernetes:

```text
Pod terminated: OOMKilled
Exit Code: 137
```

Ini bukan Java exception.

Artinya:

```text
OS/cgroup membunuh proses karena total memory process melewati limit.
```

Kemungkinan:

```text
heap + native + direct + metaspace + stack + code cache + allocator overhead > container limit
```

Aplikasi bisa mati tanpa sempat menulis heap dump atau Java OOM stack trace.

---

## 11. Kenapa Heap Terlihat Rendah tapi RSS Tinggi?

Ini sangat umum pada aplikasi NIO/network-heavy.

Misalnya metrik menunjukkan:

```text
heap used after GC: 700 MB
heap max: 2 GB
RSS: 3.2 GB
container limit: 3.5 GB
```

Kemungkinan penyebab:

```text
direct buffers
mmap pages
thread stacks
metaspace
code cache
GC structures
native TLS/SSL libraries
compression libraries
malloc fragmentation
JIT/compiler memory
```

Direct buffer adalah salah satu kandidat pertama jika aplikasi memakai:

```text
Netty
gRPC
Kafka client/server
RSocket
high-throughput NIO
file transfer
large upload/download
custom ByteBuffer pools
```

---

## 12. Allocation Cost: Heap Buffer vs Direct Buffer

Heap buffer allocation:

```java
ByteBuffer b = ByteBuffer.allocate(8192);
```

Biasanya:

```text
allocate Java object + byte[]
fast path melalui TLAB jika muat
murah untuk small temporary allocations
GC handles reclamation naturally
```

Direct buffer allocation:

```java
ByteBuffer b = ByteBuffer.allocateDirect(8192);
```

Biasanya lebih mahal karena:

```text
native allocation path
possible reservation accounting
possible zeroing/page interaction
DirectByteBuffer wrapper creation
cleaner/deallocator setup
potential synchronization/accounting
```

Jadi pola ini buruk:

```java
ByteBuffer handleRequest(byte[] input) {
    ByteBuffer b = ByteBuffer.allocateDirect(1024);
    b.put(input);
    b.flip();
    return b;
}
```

Jika dilakukan ribuan kali per detik, ini dapat menciptakan:

```text
native allocation churn
cleaner backlog
GC pressure pada wrapper
RSS volatility
direct memory OOM
```

Lebih baik:

```text
reuse/pool jika direct buffer memang perlu
atau gunakan heap buffer jika direct tidak terbukti bermanfaat
```

---

## 13. Deallocation: Kenapa Tidak Deterministic?

Heap object dibebaskan ketika GC menentukan object tidak reachable dan memory heap dapat direclaim.

Native memory direct buffer dibebaskan ketika:

```text
DirectByteBuffer wrapper menjadi unreachable
GC/reference processing menemukan itu
cleaner/deallocator dijalankan
native free dilakukan
```

Masalahnya:

```text
unreachable != immediately freed
```

Ini bisa menciptakan gap:

```text
application stops using direct buffer
    ↓
wrapper becomes unreachable
    ↓
GC belum berjalan / belum memproses cleaner
    ↓
native memory belum bebas
    ↓
application allocateDirect lagi
    ↓
direct budget habis
```

Jadi, direct buffer tidak cocok untuk:

```text
short-lived per-operation allocation tanpa pooling
```

Karena lifecycle cleanup tidak deterministic.

---

## 14. Cleaner Is a Safety Net, Not a Resource Management Strategy

Cleaner membantu membebaskan native memory ketika object wrapper mati.

Tetapi cleaner bukan pengganti lifecycle eksplisit.

Untuk resource seperti:

```text
socket
file descriptor
native segment
large direct buffer pool
mapped memory
```

lebih baik punya ownership model eksplisit:

```text
allocate/acquire
use
release/close
```

Pola umum:

```java
try (Resource r = acquire()) {
    r.use();
}
```

Untuk `ByteBuffer.allocateDirect`, Java standard API lama tidak menyediakan `close()` publik untuk direct buffer. Karena itu banyak framework membuat pool/lifecycle sendiri, atau menggunakan API modern seperti FFM `MemorySegment`/`Arena` saat cocok.

Mental model penting:

```text
Cleaner is final cleanup.
It should not be the main operational control loop.
```

---

## 15. Direct Buffer Pooling

Karena allocate/free direct buffer mahal dan cleanup delayed, banyak high-performance framework memakai buffer pooling.

Tujuan pooling:

```text
mengurangi native allocation churn
mengurangi cleaner pressure
menstabilkan RSS
mengurangi latency spike
mengontrol memory budget
```

Tetapi pooling juga membawa risiko.

---

### 15.1 Keuntungan pooling

```text
reuse direct memory block
allocation rate turun
latency lebih stabil
fragmentation lebih terkendali
backpressure bisa dikaitkan dengan pool capacity
```

---

### 15.2 Risiko pooling

```text
buffer leak jika release tidak dipanggil
use-after-release logical bug
stale data exposure jika buffer tidak dibersihkan
pool terlalu besar sehingga RSS selalu tinggi
cross-thread ownership kacau
slice/duplicate membuat lifecycle rumit
```

---

### 15.3 Pooling harus punya ownership discipline

Contoh konsep:

```text
acquire buffer
  -> owner tunggal
  -> pass ke layer bawah dengan aturan jelas
  -> release tepat sekali
```

Invariants:

```text
Setiap acquire harus punya tepat satu release.
Buffer tidak boleh dipakai setelah release.
Buffer tidak boleh direlease dua kali.
Slice/duplicate tidak boleh membuat owner lifecycle ambigu.
```

Jika invariants ini tidak bisa dijaga, pooling bisa lebih berbahaya daripada allocation biasa.

---

## 16. Direct Buffer dan Framework Seperti Netty

Framework network seperti Netty sering memakai direct buffer karena dekat dengan socket I/O dan butuh throughput tinggi.

Namun framework semacam ini biasanya tidak sekadar memanggil `ByteBuffer.allocateDirect` secara naif. Mereka punya:

```text
allocator
pool
arena
chunk
page/subpage allocation
reference counting
leak detection
capacity normalization
thread-local cache
```

Pelajaran penting:

> Kalau sebuah framework besar memakai direct memory, itu bukan berarti application code sebaiknya sembarang memakai `allocateDirect`.

Framework tersebut biasanya punya mekanisme ownership dan observability yang jauh lebih matang.

Jika application code memakai Netty/gRPC/Kafka, direct memory bisa muncul dari library, bukan dari kode aplikasi langsung.

Diagnosis harus memperhitungkan dependency.

---

## 17. Copy Path: Heap, Direct, Kernel

Untuk memahami benefit direct buffer, perhatikan path data.

### 17.1 Writing dari heap byte array

```text
Application object
byte[] in Java heap
    ↓
JVM may copy to native/intermediate buffer
    ↓
syscall/write
    ↓
kernel/socket/file
```

### 17.2 Writing dari direct buffer

```text
Direct native memory
    ↓
syscall/write
    ↓
kernel/socket/file
```

Direct buffer dapat mengurangi copy di boundary tertentu.

Namun, jika data awalnya sudah berada di heap dan hanya dipakai sekali, flow bisa menjadi:

```text
heap object
  -> copy to direct buffer
  -> syscall
```

Maka direct buffer tidak selalu menang.

Pertanyaan desain:

```text
Apakah data hidup cukup lama di direct memory?
Apakah data dipakai untuk banyak I/O operation?
Apakah kita menghindari copy, atau hanya memindahkan copy ke tempat lain?
```

---

## 18. Page, Alignment, and Touching Memory

Native allocation tidak selalu langsung berarti semua memory menjadi resident secara fisik.

OS modern memakai virtual memory.

Konsep penting:

```text
reserve address space
commit memory
page touched
page resident
page reclaimed/swapped/evicted depending OS
```

Direct buffer allocation bisa menyebabkan:

```text
native reservation/accounting oleh JVM
malloc/mmap allocation oleh runtime allocator
zeroing saat page pertama kali disentuh
RSS naik saat page benar-benar dipakai
```

Karena itu metrik bisa terlihat membingungkan:

```text
reserved direct memory tinggi
RSS naik bertahap saat buffer dipakai
RSS tidak langsung turun setelah buffer dilepas karena allocator/OS behavior
```

---

## 19. Fragmentation

Fragmentation bisa muncul di native memory juga.

Misalnya aplikasi allocate/free direct buffer dengan ukuran bervariasi:

```text
4 KiB
8 KiB
128 KiB
1 MiB
64 KiB
2 MiB
```

Jika pola hidup tidak teratur, native allocator bisa mengalami fragmentation.

Akibatnya:

```text
total free native memory ada,
tetapi sulit menemukan contiguous block sesuai kebutuhan
atau RSS tetap tinggi karena allocator menahan arena/cache
```

Buffer pooling dapat membantu jika ukuran distandarkan.

Contoh strategi:

```text
normalize buffer size ke kelas tertentu:
4 KiB, 8 KiB, 16 KiB, 64 KiB, 1 MiB
```

Bukan:

```text
allocate direct buffer persis sesuai payload random
```

---

## 20. Direct Buffer dan GC Pressure

Direct buffer mengurangi heap byte storage, tetapi bukan berarti menghilangkan GC pressure.

Masih ada wrapper object:

```text
DirectByteBuffer object
Cleaner object/internal reference
slice/duplicate/view objects
framework wrapper objects
```

Jika membuat banyak direct buffer kecil:

```text
heap wrapper allocation rate tinggi
reference processing meningkat
cleaner queue meningkat
native allocation churn meningkat
```

Jadi direct buffer bisa menciptakan dua tekanan sekaligus:

```text
heap pressure pada wrapper
native pressure pada backing memory
```

---

## 21. Slice/Duplicate dan Retention Trap

`slice()` dan `duplicate()` tidak menyalin backing memory. Mereka membuat view baru.

Untuk direct buffer:

```text
original DirectByteBuffer -> native block 100 MB
slice view 1 KB          -> native block yang sama
```

Masalah:

```java
ByteBuffer big = ByteBuffer.allocateDirect(100 * 1024 * 1024);
ByteBuffer small = big.slice(0, 1024);
cache.put(key, small);
big = null;
```

Jika `small` masih reachable, native block besar bisa tetap hidup karena small view mempertahankan attachment/reference ke backing memory.

Mental model:

```text
small view does not mean small retained native memory
```

Ini analog dengan historical substring retention problem, tetapi di direct buffer world.

Design rule:

```text
Jangan simpan slice kecil dari direct buffer besar untuk long-term cache.
Copy ke buffer kecil jika lifetime-nya berbeda jauh.
```

---

## 22. Direct Buffer dan Security/Data Leakage

Buffer reuse bisa membocorkan data jika tidak disiplin.

Misalnya buffer dipakai untuk:

```text
token
password
PII payload
session data
private key material
sensitive document
```

Jika buffer dikembalikan ke pool tanpa clearing, consumer berikutnya mungkin membaca sisa data.

Invariants untuk sensitive data:

```text
clear content before release
limit exposure duration
avoid pooling highly sensitive data unless lifecycle is strict
avoid logging raw buffer content
avoid accidental slice retention
```

Untuk direct buffer, clearing juga harus mempertimbangkan bahwa data berada di native memory dan tidak terlihat sebagai object field normal di heap dump.

---

## 23. Observability: Apa yang Harus Dilihat?

Untuk direct/native memory issue, jangan hanya lihat heap.

Minimal dashboard:

```text
JVM heap used/committed/max
old gen after GC
GC pause and frequency
process RSS
container memory usage
container memory limit
metaspace used/committed
thread count
direct buffer count/capacity if available
mapped buffer count/capacity if available
NMT summary/detail if enabled
allocation rate if available
network/file throughput
backpressure queue size
```

Jika hanya melihat:

```text
heap used
```

maka native memory problem akan terlewat.

---

## 24. Tools: `jcmd`, NMT, JMX, OS, Container

### 24.1 Native Memory Tracking

Native Memory Tracking adalah fitur HotSpot untuk melihat kategori memory internal JVM. Umumnya diaktifkan saat startup:

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

Lalu query:

```bash
jcmd <pid> VM.native_memory summary
```

atau baseline/diff:

```bash
jcmd <pid> VM.native_memory baseline
jcmd <pid> VM.native_memory summary.diff
```

Catatan penting:

```text
NMT membantu melihat memory internal JVM,
tetapi tidak selalu melacak semua allocation oleh non-JVM native code.
```

Jika JNI/library native melakukan malloc sendiri, NMT bisa tidak cukup.

---

### 24.2 JMX BufferPoolMXBean

Java menyediakan buffer pool MXBean untuk melihat buffer pool seperti direct dan mapped.

Contoh kode:

```java
import java.lang.management.BufferPoolMXBean;
import java.lang.management.ManagementFactory;

public class BufferPools {
    public static void main(String[] args) {
        for (BufferPoolMXBean pool : ManagementFactory.getPlatformMXBeans(BufferPoolMXBean.class)) {
            System.out.printf(
                "name=%s count=%d used=%d capacity=%d%n",
                pool.getName(),
                pool.getCount(),
                pool.getMemoryUsed(),
                pool.getTotalCapacity()
            );
        }
    }
}
```

Output konseptual:

```text
name=mapped count=0 used=0 capacity=0
name=direct count=42 used=536870912 capacity=536870912
```

Ini sangat berguna untuk membedakan:

```text
RSS tinggi karena direct/mapped buffer?
atau karena native area lain?
```

---

### 24.3 OS tools

Linux examples:

```bash
ps -o pid,rss,vsz,cmd -p <pid>
cat /proc/<pid>/status
cat /proc/<pid>/smaps_rollup
pmap -x <pid>
```

Container/Kubernetes:

```bash
kubectl top pod <pod>
kubectl describe pod <pod>
cat /sys/fs/cgroup/... memory stats
```

Untuk production, sering perlu menggabungkan:

```text
JVM view + OS view + container view
```

Karena masing-masing menjawab pertanyaan berbeda.

---

## 25. Diagnostic Pattern: `OutOfMemoryError: Direct buffer memory`

Jika muncul:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Gunakan langkah berpikir berikut.

### Step 1: Konfirmasi limit

Cari JVM args:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
```

Periksa:

```text
-XX:MaxDirectMemorySize
-Xmx
container limit
```

Jika `MaxDirectMemorySize` tidak eksplisit, catat sebagai risk.

---

### Step 2: Lihat direct buffer pool

Via JMX atau kode:

```text
BufferPoolMXBean direct count
BufferPoolMXBean direct memoryUsed
BufferPoolMXBean direct totalCapacity
```

Jika direct pool mendekati limit, masalah memang direct buffer.

---

### Step 3: Cek allocation pattern

Cari kode atau dependency yang melakukan:

```java
ByteBuffer.allocateDirect(...)
```

Juga cek library:

```text
Netty
Kafka
gRPC
Aeron
Lucene
RocksDB JNI
compression/native SSL libs
custom NIO layer
```

---

### Step 4: Bedakan leak vs churn

Leak:

```text
direct memory naik terus dan tidak turun
buffer count/capacity naik terus
heap dump menunjukkan DirectByteBuffer retained
```

Churn/cleanup delay:

```text
direct allocation rate tinggi
memory naik turun
OOM terjadi saat burst
GC/cleaner tidak mengejar allocation rate
```

---

### Step 5: Ambil heap dump jika aman

Heap dump dapat membantu mencari wrapper `DirectByteBuffer`.

Cari:

```text
java.nio.DirectByteBuffer
java.nio.MappedByteBuffer
framework buffer wrappers
Netty ByteBuf
```

Perhatikan retained graph:

```text
cache
queue
thread local
channel pipeline
future/callback chain
subscriber/listener
static holder
```

---

### Step 6: Mitigasi

Pilihan tergantung penyebab:

```text
increase MaxDirectMemorySize if budget memang kurang
reduce direct allocation rate
pool/reuse buffer
fix leak/release lifecycle
add backpressure
reduce concurrency
reduce per-request buffer size
copy slices that have longer lifetime
upgrade/fix library if known leak
```

Jangan langsung menaikkan limit tanpa tahu penyebab.

---

## 26. Diagnostic Pattern: RSS Tinggi, Heap Normal

Gejala:

```text
heap used after GC rendah/stabil
GC normal
RSS naik terus
container hampir OOMKilled
```

Langkah:

### Step 1: Bandingkan heap committed dengan RSS

```text
RSS - heap committed = native suspicion range
```

Tidak presisi, tapi membantu.

---

### Step 2: Cek direct/mapped buffer pool

JMX:

```text
direct memoryUsed
mapped memoryUsed
```

Jika besar, investigasi buffer.

---

### Step 3: Cek NMT

```bash
jcmd <pid> VM.native_memory summary scale=MB
```

Perhatikan kategori:

```text
Java Heap
Class
Thread
Code
GC
Compiler
Internal
Symbol
Native Memory Tracking
Arena Chunk
```

NIO direct buffer bisa muncul dalam kategori tertentu tergantung JVM/version/reporting.

---

### Step 4: Cek thread count

Thread stack bisa besar.

```text
thread count 3000
-Xss1m
=> potential stack reservation/resident pressure
```

---

### Step 5: Cek mmap/file/page cache related

Jika aplikasi memakai mapped files, Lucene, database embedded, large file I/O, cek mapping.

```bash
pmap -x <pid>
cat /proc/<pid>/maps
cat /proc/<pid>/smaps_rollup
```

---

### Step 6: Cek native library

Jika memakai:

```text
OpenSSL/tcnative
RocksDB
compression native libs
image processing native libs
machine learning/native inference
JNI custom code
```

NMT mungkin tidak lengkap. OS-level tooling bisa diperlukan.

---

## 27. Production Sizing: Jangan Hanya Set `-Xmx`

Dalam container, memory budget harus menghitung semua komponen.

Formula praktis:

```text
container limit
  >= Java heap max
   + direct memory budget
   + metaspace budget
   + thread stack budget
   + code cache
   + GC/JIT/native internal overhead
   + OS/allocator safety margin
```

Contoh:

```text
container limit        = 4096 MB
heap max               = 2048 MB
direct memory          = 512 MB
metaspace              = 256 MB
thread stack budget    = 256 MB
code cache             = 128 MB
GC/JVM native overhead  = 256 MB
safety margin          = 640 MB
-------------------------------
total                  = 4096 MB
```

Jika Anda set:

```bash
-Xmx3500m
```

pada container 4 GB, kemungkinan terlalu agresif untuk aplikasi dengan direct buffer/network I/O.

---

## 28. Backpressure: Memory Control Lebih Penting daripada Cleanup

Direct buffer issue sering bukan karena `MaxDirectMemorySize` terlalu kecil, tetapi karena tidak ada backpressure.

Contoh buruk:

```text
incoming requests naik
setiap request allocate 1 MB direct buffer
processing downstream lambat
queue menahan 2000 request
=> 2 GB direct/native buffer tertahan
```

Solusi bukan hanya:

```text
naikkan MaxDirectMemorySize
```

Tetapi:

```text
batasi concurrency
batasi queue size
batasi body size
gunakan streaming
release buffer setelah stage selesai
apply backpressure dari downstream
reject cepat saat memory budget habis
```

Memory adalah resource terbatas seperti connection pool.

Direct buffer pool sebaiknya diperlakukan seperti semaphore:

```text
acquire buffer slot
if no slot -> wait/reject/backpressure
release after done
```

---

## 29. Direct Buffer Lifecycle Design

### 29.1 Bad lifecycle

```java
public ByteBuffer encode(Message message) {
    ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024);
    writeMessage(buffer, message);
    buffer.flip();
    return buffer;
}
```

Masalah:

```text
caller tidak tahu ownership
caller tidak tahu harus release atau tidak
allocation per call mahal
ukuran fixed besar
cleanup bergantung GC
```

---

### 29.2 Better lifecycle with pool concept

```java
interface BufferLease extends AutoCloseable {
    ByteBuffer buffer();

    @Override
    void close();
}
```

Usage:

```java
try (BufferLease lease = pool.acquire()) {
    ByteBuffer buffer = lease.buffer();
    writeMessage(buffer, message);
    buffer.flip();
    channel.write(buffer);
}
```

Invariants:

```text
lease close returns buffer to pool
buffer is not used after close
pool clears/reset state before reuse
pool has bounded capacity
acquire may block/fail if memory budget exhausted
```

---

## 30. Sizing Direct Buffer Pool

Pool sizing harus berbasis workload.

Pertanyaan:

```text
Berapa maximum concurrent operations?
Berapa buffer per operation?
Berapa average dan max buffer size?
Apakah buffer full-size atau chunked?
Berapa latency downstream?
Apakah ada burst?
Apa behavior saat pool habis?
```

Formula sederhana:

```text
direct_pool_budget = max_concurrency * buffer_per_operation * buffer_size
```

Contoh:

```text
max_concurrency = 200
buffer_per_operation = 2
buffer_size = 64 KiB

budget = 200 * 2 * 64 KiB
       = 25,600 KiB
       = 25 MB
```

Tambahkan overhead dan safety margin.

Jika hasilnya terlalu besar, jangan langsung allocate budget lebih besar. Pertimbangkan:

```text
streaming chunk lebih kecil
reduce concurrency
share buffer by pipeline stage carefully
avoid buffering full payload
backpressure earlier
```

---

## 31. Direct Buffer vs `byte[]`: Decision Matrix

| Kondisi | Pilihan Awal |
|---|---|
| Data kecil, temporary | `byte[]` / heap buffer |
| Parsing application-level payload | `byte[]` / heap `ByteBuffer` |
| I/O besar dan long-lived | direct buffer |
| High-throughput socket/file I/O | direct buffer/pool melalui framework |
| Need deterministic native memory lifetime | FFM `MemorySegment`/`Arena` atau custom resource abstraction |
| Need random file access huge file | `MappedByteBuffer`/FileChannel/FFM depending case |
| Sensitive data short-lived | hati-hati dengan pooling; explicit clearing |
| Unknown bottleneck | heap first, profile, baru direct |

---

## 32. Relationship with FFM API

Java modern menyediakan Foreign Function & Memory API, finalized di Java 22, untuk akses foreign/native memory dengan model yang lebih eksplisit.

Dengan FFM, mental model lifecycle bisa lebih jelas:

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment segment = arena.allocate(1024);
    // use segment
} // native memory released when arena closes
```

Dibanding direct buffer lama:

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(1024);
// no public close() on ByteBuffer
// cleanup depends on reachability/cleaner
```

Namun FFM bukan pengganti universal `ByteBuffer` untuk semua I/O API lama. Banyak API Java dan library masih berbasis `ByteBuffer`.

Decision:

```text
ByteBuffer direct -> cocok untuk Java NIO ecosystem
MemorySegment     -> cocok untuk explicit native memory, interop, structured off-heap access
```

FFM akan dibahas lebih dalam di part 014.

---

## 33. Common Production Bugs

### 33.1 Allocate direct per request

```java
ByteBuffer buffer = ByteBuffer.allocateDirect(requestSize);
```

Dampak:

```text
native allocation churn
direct memory OOM during burst
latency spike
cleaner backlog
```

---

### 33.2 Cache stores slices from large direct buffer

```java
cache.put(id, largeBuffer.slice(offset, length));
```

Dampak:

```text
small slice retains large backing memory
```

---

### 33.3 Missing release in reference-counted buffer framework

```java
ByteBuf buf = allocator.directBuffer();
// exception path lupa release
```

Dampak:

```text
pool leak
RSS grows
direct memory OOM
```

---

### 33.4 Queue holds buffers during downstream slowness

```text
network reads faster than database writes
buffers accumulate in queue
```

Dampak:

```text
memory exhaustion despite no classical leak
```

---

### 33.5 Using heap metrics only

```text
heap dashboard green
pod killed anyway
```

Dampak:

```text
wrong diagnosis
team keeps tuning GC while problem is native/RSS
```

---

## 34. Anti-Patterns

### Anti-pattern 1: “Use direct buffer everywhere for performance”

Salah karena:

```text
direct allocation is expensive
lifecycle is harder
benefit depends on I/O path
```

---

### Anti-pattern 2: “Heap is low, so memory is fine”

Salah karena:

```text
RSS includes native memory
container sees total process memory
```

---

### Anti-pattern 3: “Increase Xmx to fix memory issue”

Jika masalahnya direct/RSS, menaikkan `-Xmx` bisa memperburuk container pressure.

---

### Anti-pattern 4: “Cleaner will handle it”

Cleaner tidak deterministic. Untuk high-throughput systems, lifecycle harus eksplisit atau pool harus bounded.

---

### Anti-pattern 5: “Heap dump proves no memory leak”

Heap dump bisa tidak menunjukkan native bytes. Ia hanya menunjukkan wrapper/reference graph. Native leak atau native allocator fragmentation bisa tetap ada.

---

## 35. Practical Design Checklist

Sebelum memakai direct buffer, jawab:

```text
1. Apa bottleneck yang ingin dihilangkan?
2. Apakah profiling membuktikan copy heap/native mahal?
3. Berapa direct memory budget?
4. Apakah MaxDirectMemorySize eksplisit?
5. Apakah buffer short-lived atau long-lived?
6. Apakah allocation per request atau pooled?
7. Siapa owner buffer?
8. Kapan buffer boleh direuse/release?
9. Apa behavior jika pool habis?
10. Apakah ada backpressure?
11. Apakah slice/duplicate bisa memperpanjang lifetime backing memory?
12. Apakah data sensitive perlu clearing?
13. Bagaimana observability direct memory?
14. Bagaimana membedakan leak vs churn?
15. Bagaimana container memory budget dihitung?
```

---

## 36. Example: Direct Buffer Budget in a REST Upload Service

Scenario:

```text
REST service menerima upload dokumen.
Max request body = 20 MB.
Max concurrent upload = 100.
Service membaca full body ke direct buffer.
```

Worst-case direct memory:

```text
100 * 20 MB = 2000 MB
```

Jika container limit 4 GB dan heap 2 GB:

```text
heap 2 GB + direct 2 GB + metaspace/thread/code/native overhead
> 4 GB
```

Ini desain buruk.

Solusi lebih baik:

```text
streaming upload in chunks
chunk size 64 KiB or 256 KiB
limit concurrent upload
write to file/object storage progressively
apply backpressure
avoid full-body direct buffering
```

Revised:

```text
100 concurrent * 2 buffers * 256 KiB
= 50 MB direct buffer budget
```

Perbedaan:

```text
2 GB vs 50 MB
```

Ini bukan tuning GC. Ini memory-aware design.

---

## 37. Example: Direct Memory OOM from Burst Allocation

Code smell:

```java
public void send(byte[] payload, SocketChannel channel) throws IOException {
    ByteBuffer direct = ByteBuffer.allocateDirect(payload.length);
    direct.put(payload);
    direct.flip();
    while (direct.hasRemaining()) {
        channel.write(direct);
    }
}
```

Jika payload 1 MB dan ada 1000 concurrent sends:

```text
potential direct allocation burst = 1 GB
```

Jika `MaxDirectMemorySize=512m`:

```text
OOM: Direct buffer memory
```

Better:

```text
use bounded pool
stream chunks
avoid copying full payload if already in heap and small
let framework manage buffer lifecycle
reduce concurrency/backpressure
```

---

## 38. Example: Heap Dump Interpretation

Anda melihat di MAT:

```text
java.nio.DirectByteBuffer retained by:
  ConcurrentLinkedQueue
    -> PendingWrite
      -> ChannelContext
```

Interpretasi:

```text
Direct memory bukan bocor karena GC gagal.
Buffer masih reachable karena pending write queue menahannya.
```

Pertanyaan lanjut:

```text
Kenapa pending write queue membesar?
Apakah downstream/socket lambat?
Apakah backpressure tidak diterapkan?
Apakah timeout tidak membersihkan queue?
Apakah retry menyimpan payload terlalu lama?
```

Fix mungkin bukan di memory code, tapi di flow-control.

---

## 39. Example: RSS Does Not Drop After Direct Buffers Freed

Gejala:

```text
direct buffer workload selesai
BufferPoolMXBean memoryUsed turun
RSS tetap tinggi
```

Kemungkinan:

```text
native allocator retains arenas/cache
OS belum reclaim physical pages
memory fragmentation
other native memory still high
mmap/page cache effects
```

Ini tidak selalu leak.

Validasi:

```text
Apakah RSS terus naik tanpa batas?
Apakah naik plateau?
Apakah NMT diff stabil?
Apakah buffer pool turun?
Apakah pod melewati limit?
```

Production conclusion harus berbasis trend, bukan satu snapshot.

---

## 40. Java 8 sampai Java 25: Apa yang Perlu Diingat?

Untuk direct buffer sendiri, konsep besar relatif stabil:

```text
DirectByteBuffer wrapper di heap
native backing memory
MaxDirectMemorySize
deallocation tied to reachability/cleaner-like mechanism
```

Tetapi ecosystem berubah:

```text
Java 8:
  banyak library memakai Unsafe/internal APIs
  CMS masih umum di legacy systems
  observability memakai GC log lama/NMT/jcmd tergantung setup

Java 9+:
  module system membuat akses internal API makin dibatasi
  unified logging membantu observability
  G1 default collector

Java 17/21:
  banyak production service modern berjalan di LTS ini
  container ergonomics lebih matang dibanding Java 8 era awal
  virtual threads di Java 21 mengubah pressure model thread, tetapi native memory tetap perlu dihitung

Java 22+:
  FFM API finalized, memberi jalan lebih standar untuk foreign/native memory

Java 25:
  semakin kuat arah menjauh dari Unsafe memory-access methods
  modern GC dan runtime observability makin matang
```

Pelajaran:

```text
Direct buffer tetap relevan,
tetapi untuk explicit native memory baru,
FFM mulai menjadi pilihan yang lebih aman dan terstruktur.
```

---

## 41. Summary Mental Model

Ingat model ini:

```text
DirectByteBuffer is a Java object that owns or views native memory.
```

Konsekuensinya:

```text
1. Wrapper-nya hidup di heap.
2. Bytes-nya hidup di native memory.
3. Heap dump melihat wrapper, bukan byte storage sebagai byte[].
4. GC memengaruhi kapan native memory bisa dibebaskan.
5. Cleaner tidak deterministic.
6. MaxDirectMemorySize bukan total native memory limit.
7. RSS/container melihat total memory proses, bukan hanya heap.
8. Direct buffer cocok untuk large/long-lived/native I/O workloads.
9. Direct buffer buruk untuk tiny/short-lived/per-request allocation.
10. Pooling membantu hanya jika ownership dan release discipline kuat.
```

Jika harus diringkas menjadi satu kalimat:

> Direct buffer adalah optimization yang memindahkan sebagian masalah dari heap/GC ke native memory/lifecycle/observability; gunakan hanya jika manfaat I/O dan locality-nya lebih besar daripada kompleksitas operasionalnya.

---

## 42. Checklist Investigasi Produksi

Saat ada masalah memory, tanyakan:

```text
Apakah ini Java heap OOM, direct memory OOM, metaspace OOM, native leak, atau container OOMKilled?
```

Jika direct/native dicurigai:

```text
1. Ambil JVM flags.
2. Cek Xmx dan MaxDirectMemorySize.
3. Cek container memory limit.
4. Cek RSS trend.
5. Cek BufferPoolMXBean direct/mapped.
6. Cek NMT summary/diff jika enabled.
7. Cek thread count dan Xss.
8. Cek heap dump untuk DirectByteBuffer/wrapper retention.
9. Cek framework allocator metrics.
10. Cek queue/backpressure/downstream slowness.
11. Bedakan leak vs burst vs allocator retention.
12. Fix lifecycle/design sebelum sekadar menaikkan limit.
```

---

## 43. Relationship to Next Parts

Part ini menyiapkan fondasi untuk:

```text
part 013: Memory-Mapped Files
part 014: Foreign Function & Memory API
part 015: Unsafe, VarHandle, and migration strategy
part 025: GC/NMT/JFR observability
part 027: Native memory leak investigation
part 028: Memory tuning in containers/Kubernetes
```

Khususnya, part ini harus membuat Anda nyaman dengan gagasan bahwa:

```text
Java memory management != only heap and GC
```

Direct buffer adalah bukti paling praktis bahwa Java production memory harus dibaca sebagai:

```text
heap + native + OS + container + application lifecycle
```

---

## 44. Referensi

Referensi yang relevan untuk bagian ini:

1. Java SE 25 API Documentation — `java.nio.ByteBuffer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html

2. Java SE 25 API Documentation — `java.nio.Buffer`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/Buffer.html

3. Oracle Java SE 8 Troubleshooting Guide — Native Memory Tracking  
   https://docs.oracle.com/javase/8/docs/technotes/guides/troubleshoot/tooldescr007.html

4. Oracle Java SE 8 VM Guide — Native Memory Tracking  
   https://docs.oracle.com/javase/8/docs/technotes/guides/vm/nmt-8.html

5. OpenJDK JDK Bug System — DirectByteBuffer garbage creation can outpace reclamation  
   https://bugs.openjdk.org/browse/JDK-6857566

6. OpenJDK JEP 454 — Foreign Function & Memory API  
   https://openjdk.org/jeps/454

---

## 45. Status Seri

```text
Part 012 selesai.
Seri belum selesai.
Masih lanjut ke part 013 sampai part 030.
```

Part berikutnya:

```text
learn-java-memory-byte-bit-buffer-offheap-gc-part-013.md
```

Topik berikutnya:

```text
Memory-Mapped Files: MappedByteBuffer, Page Cache, and OS Semantics
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-011.md">⬅️ Part 011 — `ByteBuffer` Deep Dive: Heap Buffer, Direct Buffer, Slice, Duplicate, View</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-memory-byte-bit-buffer-offheap-gc-part-013.md">Mapped Files: `MappedByteBuffer`, Page Cache, and OS Semantics ➡️</a>
</div>
