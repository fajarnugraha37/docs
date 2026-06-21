# learn-linux-kernel-mastery-for-java-engineers-part-009.md

# Part 009 — Memory Model I: Virtual Memory and Address Space

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `009`  
> Status seri: **belum selesai**  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production debugging, resource modelling, dan desain runtime envelope.

---

## 0. Tujuan Part Ini

Di bagian sebelumnya kita sudah membangun fondasi tentang:

- process sebagai unit runtime nyata;
- thread/task sebagai execution context Linux;
- syscall sebagai kontrak antara aplikasi dan kernel;
- file descriptor sebagai handle universal;
- VFS dan filesystem semantics.

Sekarang kita masuk ke salah satu topik paling sering disalahpahami oleh Java engineer di production: **memory**.

Bagian ini tidak membahas Java Memory Model dalam arti concurrency seperti `happens-before`, `volatile`, `synchronized`, atau visibility antar-thread. Itu topik bahasa/runtime Java. Yang kita bahas di sini adalah **Linux process memory model**: bagaimana sebuah process Java terlihat oleh kernel sebagai virtual address space, bagaimana memory region dipetakan, kenapa heap JVM bukan seluruh memory process, kenapa `RSS` bukan `-Xmx`, kenapa `top` sering menyesatkan, dan kenapa process bisa dibunuh OOM oleh kernel/container walaupun Java heap tampak masih aman.

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Menjelaskan bedanya **physical memory**, **virtual memory**, **address space**, **mapping**, **page**, **page table**, **RSS**, **VSZ/VIRT**, **PSS**, dan **anonymous/file-backed memory**.
2. Membaca `/proc/<pid>/maps` dan `/proc/<pid>/smaps` untuk memahami memory layout process Java.
3. Menjelaskan komponen memory JVM di Linux:
   - Java heap;
   - metaspace;
   - code cache;
   - thread stacks;
   - direct buffers;
   - memory-mapped files;
   - native allocations;
   - shared libraries.
4. Membedakan `OutOfMemoryError` dari Java dengan OOM kill dari Linux/cgroup.
5. Membuat mental model awal untuk memory budgeting service Java di host/container.
6. Menghindari kesalahan umum seperti menganggap `-Xmx` adalah total memory process.

---

## 1. Core Mental Model

Kalimat paling penting di part ini:

> **Process Java tidak “memiliki RAM langsung”. Process memiliki virtual address space. Kernel dan hardware MMU menerjemahkan virtual address menjadi physical memory frame ketika benar-benar diperlukan.**

Dalam production, banyak kebingungan memory berasal dari mencampur empat hal berbeda:

| Istilah | Arti Ringkas | Kesalahan Umum |
|---|---|---|
| Virtual address space | Ruang alamat yang dilihat process | Disangka sama dengan RAM terpakai |
| Reserved memory | Area alamat yang disiapkan tapi belum tentu dipakai fisik | Disangka pasti sudah memakan RAM |
| Committed/touched memory | Memory yang sudah mulai butuh backing fisik/swap/file | Disangka sama dengan heap Java |
| Resident memory/RSS | Bagian mapping process yang sedang resident di RAM | Disangka total private memory process |

Untuk Java engineer, versi sederhananya:

```text
Java code
  ↓
JVM runtime
  ↓
virtual address space process
  ↓
Linux memory mappings
  ↓
page table + kernel memory manager
  ↓
physical RAM / swap / file-backed page cache
```

JVM tidak berjalan di ruang abstrak yang terpisah dari Linux. JVM adalah native process. Java heap hanyalah salah satu region dalam address space process itu.

---

## 2. Physical Memory vs Virtual Memory

### 2.1 Physical Memory

Physical memory adalah RAM nyata yang dipasang pada mesin atau dialokasikan ke VM. Kernel melihat physical memory sebagai kumpulan frame/page fisik.

Pada banyak arsitektur umum, page size default adalah 4 KiB, walaupun ada juga huge page seperti 2 MiB atau 1 GiB tergantung arsitektur dan konfigurasi.

Contoh sederhana:

```text
Physical RAM
+---------+---------+---------+---------+
| frame 0 | frame 1 | frame 2 | frame 3 |
+---------+---------+---------+---------+
   4 KiB    4 KiB    4 KiB    4 KiB
```

Physical memory adalah resource terbatas. Jika total working set seluruh process + kernel + page cache melebihi kemampuan RAM, kernel harus melakukan reclaim, swap, atau akhirnya OOM kill. Detail itu akan dibahas lebih dalam di Part 010.

### 2.2 Virtual Memory

Virtual memory adalah ilusi yang diberikan kernel/hardware kepada setiap process:

> “Kamu punya ruang alamat sendiri yang tampak kontigu, privat, dan besar.”

Process A dan process B dapat sama-sama memakai virtual address `0x7f...`, tetapi address itu bisa diterjemahkan ke physical frame berbeda.

```text
Process A virtual address space        Process B virtual address space
+------------------------------+       +------------------------------+
| 0x0000 ...                   |       | 0x0000 ...                   |
| heap                         |       | heap                         |
| shared libraries             |       | shared libraries             |
| stack                        |       | stack                        |
+------------------------------+       +------------------------------+
             ↓                                      ↓
         page table A                           page table B
             ↓                                      ↓
        physical frames                       physical frames
```

Keuntungan virtual memory:

1. **Isolation**: process tidak bisa sembarang membaca memory process lain.
2. **Simpler programming model**: aplikasi melihat address space sendiri.
3. **Lazy allocation**: memory bisa di-reserve tanpa langsung diberi physical RAM.
4. **Demand paging**: page baru dibawa ke RAM ketika diakses.
5. **File mapping**: file bisa dipetakan ke memory.
6. **Copy-on-write**: parent/child process bisa berbagi page sampai ada write.
7. **Protection**: page bisa read-only, executable, non-executable, private, shared.

Dokumentasi kernel Linux menjelaskan memory management sebagai subsystem yang mengimplementasikan virtual memory, demand paging, memory allocation untuk kernel dan user-space, serta mapping file ke address space process. Ini adalah fondasi semua pembahasan di part ini.

---

## 3. Address Space: “Peta Kota” Sebuah Process

Sebuah process Linux punya address space. Address space adalah rentang alamat virtual yang bisa berisi banyak memory mapping.

Untuk process Java, address space bisa berisi:

```text
+---------------------------------------------------+
| executable mapping: java binary                   |
| shared libraries: libc, libjvm, libpthread, etc.  |
| Java heap                                         |
| metaspace/native class metadata                   |
| code cache/JIT compiled code                      |
| thread stack: main thread                         |
| thread stack: GC thread                           |
| thread stack: compiler thread                     |
| thread stack: application worker thread           |
| direct byte buffers/native allocation             |
| memory-mapped jar/class/resource files            |
| memory-mapped application files                   |
| anonymous native regions                          |
+---------------------------------------------------+
```

Ini langsung mematahkan asumsi lemah yang sering muncul:

> “Container limit saya 1 GiB dan `-Xmx` saya 1 GiB, harusnya aman.”

Tidak aman.

Karena total memory process bukan hanya heap. Ada banyak komponen non-heap yang tetap perlu memory.

---

## 4. Page: Unit Dasar Virtual Memory

Kernel tidak mengelola memory byte per byte untuk virtual memory. Kernel mengelolanya dalam unit page.

Secara konseptual:

```text
Virtual address space
+------+------+------+------+------+
| page | page | page | page | page |
+------+------+------+------+------+

Physical RAM
+-------+-------+-------+-------+
| frame | frame | frame | frame |
+-------+-------+-------+-------+
```

Page table menyimpan mapping dari virtual page ke physical frame.

```text
virtual page 0x1000  → physical frame A
virtual page 0x2000  → physical frame B
virtual page 0x3000  → not present yet
virtual page 0x4000  → file-backed page from /lib/libc.so
```

Satu mapping belum tentu punya physical frame saat dibuat. Physical frame bisa baru diberikan saat page disentuh.

Contoh:

1. JVM reserve address range besar untuk heap.
2. Tidak semua range langsung menjadi RSS.
3. Saat aplikasi membuat object dan menyentuh page, kernel mulai menyediakan physical memory.
4. Saat GC membebaskan object, belum tentu RSS langsung turun karena region bisa tetap committed/reserved oleh JVM.

---

## 5. Page Table dan MMU

Setiap memory access CPU memakai virtual address. Hardware Memory Management Unit (MMU), dibantu page table yang dikelola kernel, menerjemahkan virtual address menjadi physical address.

```text
CPU load from virtual address 0x7fabc123
          ↓
MMU checks page table
          ↓
virtual page exists?
   ├─ yes → translate to physical frame → access RAM
   └─ no  → page fault → kernel handles it
```

Page fault bukan selalu error. Banyak page fault adalah mekanisme normal.

Jenis konseptual:

1. **Minor page fault**  
   Page belum dipetakan ke process, tetapi data sudah tersedia di memory, misalnya shared page atau page cache.

2. **Major page fault**  
   Kernel harus membaca data dari storage, misalnya file-backed page yang belum ada di RAM.

3. **Invalid page fault / segmentation fault**  
   Process mengakses alamat yang tidak valid atau permission-nya tidak sesuai.

Untuk Java service, page fault bisa muncul saat:

- startup membaca banyak class/JAR;
- JIT code cache bertambah;
- heap region baru disentuh;
- memory-mapped file diakses;
- shared library diload;
- cold page cache setelah restart node/container.

---

## 6. TLB: Cache untuk Address Translation

Page table lookup mahal. Karena itu CPU punya Translation Lookaside Buffer atau TLB, yaitu cache untuk hasil translasi virtual page → physical frame.

Mental model:

```text
Memory access
  ↓
TLB hit?
  ├─ yes → cepat
  └─ no  → page table walk → lebih mahal
```

Kenapa ini relevan untuk Java engineer?

1. Working set besar dapat meningkatkan TLB pressure.
2. Huge pages dapat mengurangi jumlah page translation untuk heap besar.
3. Random access pada memory besar bisa lebih mahal daripada sequential/local access.
4. Object layout, locality, cache, dan page behavior saling terkait.

Kita belum masuk ke NUMA/cache-line secara detail di part ini. Itu akan dibahas di Part 031. Tetapi penting memahami bahwa memory bukan resource homogen dengan biaya akses sama.

---

## 7. Memory Mapping: Region dalam Address Space

Memory mapping adalah region dalam address space process. Mapping bisa dibuat oleh kernel saat program dijalankan, oleh dynamic linker, oleh JVM, atau lewat syscall seperti `mmap`.

Mapping punya atribut:

- start address;
- end address;
- permission: read/write/execute;
- private/shared;
- file backing jika ada;
- offset file;
- device/inode;
- pathname jika file-backed.

Contoh bentuk `/proc/<pid>/maps`:

```text
address           perms offset  dev   inode      pathname
00400000-00452000 r-xp  00000000 08:02 131073    /usr/bin/java
00651000-00652000 r--p  00051000 08:02 131073    /usr/bin/java
7f2a00000000-7f2a40000000 rw-p  00000000 00:00 0
7f2a9c000000-7f2a9c021000 rw-p  00000000 00:00 0
7f2aa13f5000-7f2aa15f5000 rw-p  00000000 00:00 0  [stack]
```

Kolom permission:

```text
r = readable
w = writable
x = executable
s = shared
p = private / copy-on-write
```

Dokumentasi `proc_pid_maps(5)` menjelaskan `/proc/<pid>/maps` sebagai file yang berisi memory regions yang sedang dipetakan dan permission-nya. Untuk debugging Java, ini salah satu sumber paling langsung untuk memahami layout address space process.

---

## 8. Anonymous Memory vs File-Backed Memory

Mapping process dapat dibagi menjadi dua kategori besar.

### 8.1 Anonymous Memory

Anonymous memory tidak punya file backing langsung.

Contoh:

- Java heap;
- native heap allocator;
- thread stack;
- many direct/native allocations;
- anonymous `mmap`.

Anonymous memory biasanya private untuk process. Jika memory pressure tinggi, anonymous memory bisa dipertahankan di RAM, direclaim jika tidak terpakai, atau dipindahkan ke swap jika swap aktif dan kebijakan mengizinkan.

### 8.2 File-Backed Memory

File-backed memory dipetakan dari file.

Contoh:

- executable binary;
- shared libraries;
- memory-mapped JAR/class/resource;
- mapped application data file;
- mapped log/index/segment file;
- mapped database/search-engine files.

Keuntungan file-backed mapping:

- page bisa dibaca on demand;
- clean file-backed page bisa dibuang dari RAM dan dibaca ulang dari file nanti;
- beberapa process bisa sharing mapping yang sama;
- cocok untuk file besar yang tidak ingin dibaca sekaligus.

Kesalahan umum:

> “Mapped file besar berarti process memakai RAM sebesar file itu.”

Belum tentu. File bisa dipetakan besar di virtual address space, tapi hanya page yang disentuh dan resident yang berkontribusi ke RSS saat itu.

---

## 9. `mmap`: Kenapa File Bisa Menjadi Memory

`mmap` memungkinkan file atau anonymous region dipetakan ke address space process.

Secara konseptual:

```text
file on disk
+------+------+------+------+------+
| page | page | page | page | page |
+------+------+------+------+------+
      ↓ mmap
process virtual address space
+------+------+------+------+------+
| page | page | page | page | page |
+------+------+------+------+------+
```

Aplikasi kemudian bisa membaca memory address seolah-olah membaca memory biasa. Kernel menangani page fault untuk membawa page dari file ke RAM saat dibutuhkan.

Java dapat berinteraksi dengan mekanisme ini lewat:

- `FileChannel.map()`;
- memory-mapped buffer;
- class/JAR loading behavior tertentu;
- native library;
- framework atau storage engine yang memakai mmap.

Manfaat:

1. Tidak perlu copy manual dari kernel buffer ke user buffer untuk beberapa pola akses.
2. Bisa lazy-load file besar.
3. Bisa share file mapping antar-process.
4. Cocok untuk read-heavy random access tertentu.

Risiko:

1. Page fault bisa muncul di jalur request.
2. File truncation saat masih mapped bisa menyebabkan `SIGBUS`.
3. Unmapping dan lifecycle sulit jika abstraksi Java menyembunyikan native mapping.
4. RSS bisa naik mengikuti working set mapped file.
5. Container memory accounting tetap dapat menghitung page yang resident.

---

## 10. Copy-on-Write

Copy-on-write atau COW adalah teknik di mana dua mapping bisa berbagi physical page sampai salah satu melakukan write.

Contoh klasik: `fork()`.

```text
Parent process before fork
virtual page A → physical frame X

After fork
Parent virtual page A → physical frame X, read-only COW
Child  virtual page A → physical frame X, read-only COW

Child writes page A
Kernel allocates physical frame Y
Child virtual page A → physical frame Y
Parent remains       → physical frame X
```

Kenapa ini penting?

1. `fork()` process besar tidak langsung menggandakan semua memory.
2. Tetapi setelah write, memory bisa benar-benar bertambah.
3. Pre-fork server dan process manager memanfaatkan COW.
4. Java process besar yang sering fork bisa punya implikasi memory dan latency yang berat.

Untuk Java server modern, fork besar biasanya dihindari di hot path. Tetapi COW tetap penting dipahami karena konsep private mapping di `/proc/<pid>/maps` sering berarti “copy-on-write private”, bukan selalu “sudah fully private physical memory”.

---

## 11. `brk` vs `mmap`: Dua Cara Umum Mendapatkan Memory User-Space

Secara historis, user-space heap allocator dapat memperluas heap lewat `brk/sbrk`. Modern allocator juga memakai `mmap`, terutama untuk allocation besar atau region khusus.

JVM sendiri bukan sekadar program C biasa yang hanya memakai `malloc` untuk semua hal. HotSpot mengelola banyak region memory sendiri dan dapat memakai OS primitives seperti reserved virtual memory, committed memory, memory protection, dan mapping.

Konsekuensi:

- melihat `heap` di `/proc/<pid>/maps` tidak sama dengan Java heap;
- Java heap mungkin muncul sebagai anonymous mapping besar;
- native heap allocator punya arena sendiri;
- direct buffer/metaspace/code cache/thread stack berada di luar Java heap.

---

## 12. Membaca `/proc/<pid>/maps`

Ambil PID process Java:

```bash
jps -l
# atau
pgrep -fa java
```

Lihat mapping:

```bash
cat /proc/<pid>/maps | less
```

Contoh pattern yang mungkin terlihat:

```text
00400000-00452000 r-xp ... /usr/bin/java
...
7f1234000000-7f1238000000 rw-p 00000000 00:00 0
7f1239000000-7f1239200000 rw-p 00000000 00:00 0
7f1240000000-7f1240100000 r--p ... /usr/lib/x86_64-linux-gnu/libc.so.6
7f1240100000-7f1240280000 r-xp ... /usr/lib/x86_64-linux-gnu/libc.so.6
...
7ffd12345000-7ffd12366000 rw-p 00000000 00:00 0 [stack]
```

Cara membaca:

1. **Address range**  
   Ukuran mapping = end - start.

2. **Permission**  
   `r-xp` biasanya executable code private mapping.  
   `rw-p` writable private mapping.  
   `r--p` read-only private mapping.

3. **Pathname**  
   Jika ada path, mapping file-backed.  
   Jika kosong atau `00:00 0`, biasanya anonymous.

4. **Special names**  
   `[stack]`, `[heap]`, `[vdso]`, `[vvar]`, dll.

5. **Tidak semua mapping besar berarti RSS besar**  
   Mapping menunjukkan address space, bukan resident physical memory.

Useful one-liner:

```bash
awk '{print $1, $2, $6}' /proc/<pid>/maps | head -50
```

Hitung ukuran mapping secara kasar butuh parsing hex. Lebih praktis gunakan `pmap`:

```bash
pmap -x <pid> | less
```

Tetapi jangan lupa: `pmap` juga interpretasi tool. Untuk detail, `/proc/<pid>/smaps` lebih kaya.

---

## 13. Membaca `/proc/<pid>/smaps`

`maps` menunjukkan mapping. `smaps` menambahkan statistik per mapping.

Contoh field penting:

```text
Size:               65536 kB
Rss:                12340 kB
Pss:                 6170 kB
Shared_Clean:        4096 kB
Shared_Dirty:           0 kB
Private_Clean:       1024 kB
Private_Dirty:       7220 kB
Referenced:         10000 kB
Anonymous:           7220 kB
AnonHugePages:          0 kB
Swap:                   0 kB
VmFlags: rd wr mr mw me ac sd
```

Makna penting:

| Field | Arti |
|---|---|
| `Size` | Ukuran virtual mapping |
| `Rss` | Resident Set Size untuk mapping itu |
| `Pss` | Proportional Set Size; shared page dibagi proporsional antar process |
| `Shared_Clean` | Shared page bersih, biasanya file-backed code/lib |
| `Shared_Dirty` | Shared page yang modified |
| `Private_Clean` | Private page bersih |
| `Private_Dirty` | Private page yang process ini ubah; sering lebih mendekati private memory pressure |
| `Anonymous` | Memory anonymous resident |
| `Swap` | Bagian mapping yang sedang swapped out |

`smaps` bisa berat untuk process besar karena kernel harus menghitung detail banyak mapping. Untuk production, gunakan hati-hati.

Alternatif ringan:

```bash
cat /proc/<pid>/smaps_rollup
```

Jika tersedia di kernel kamu, `smaps_rollup` memberi agregat tanpa membaca semua region satu per satu.

---

## 14. VSZ/VIRT, RSS, PSS: Jangan Salah Membaca Angka

### 14.1 VIRT / VSZ

VIRT atau VSZ adalah total virtual address space yang dipetakan process.

Ini bisa sangat besar dan tidak berarti RAM sebesar itu sedang dipakai.

Contoh penyebab VIRT besar:

- JVM reserve heap besar;
- compressed class space reserved;
- large mmap file;
- thread stack reserved;
- memory allocator arena;
- address space layout;
- shared libraries.

VIRT besar bukan otomatis masalah.

### 14.2 RSS

RSS adalah jumlah page milik process yang saat ini resident di physical RAM.

Tetapi RSS punya jebakan:

1. Shared library page bisa dihitung di RSS banyak process.
2. File-backed page resident bisa muncul sebagai RSS tetapi bisa direclaim jika clean.
3. RSS tidak menunjukkan mana yang private, mana yang shared.
4. RSS tidak sama dengan Java heap used.

### 14.3 PSS

PSS membagi shared page secara proporsional antar process. Untuk memahami kontribusi memory process ke sistem secara lebih fair, PSS sering lebih berguna daripada RSS.

Tetapi tidak semua monitoring stack mengekspos PSS secara default.

### 14.4 USS

USS atau Unique Set Size adalah memory private process. Ini berguna untuk menjawab: “Jika process ini mati, berapa memory yang kira-kira benar-benar dibebaskan?”

Tidak selalu langsung tersedia dari tool standar, tetapi bisa diestimasi dari `smaps` private fields.

---

## 15. Java Process Memory Anatomy di Linux

Sekarang kita hubungkan Linux memory mapping ke JVM.

Process Java modern kira-kira punya komponen:

```text
Total process memory
├── Java heap (-Xmx bounded, but committed/used can vary)
├── Metaspace
├── Compressed class space
├── Code cache / JIT compiled code
├── Thread stacks
├── GC native structures
├── JIT compiler structures
├── DirectByteBuffer memory
├── Memory-mapped files
├── JNI/native library allocations
├── libc malloc arenas
├── Shared libraries
├── JVM internal structures
└── Kernel-accounted resources around mappings/pages
```

`-Xmx` hanya membatasi maksimum Java heap. Ia tidak membatasi:

- thread stack total;
- metaspace secara default jika tidak diberi limit;
- direct buffer jika tidak dikontrol;
- code cache;
- native allocations;
- mapped file working set;
- JVM internal overhead;
- libc allocator overhead.

### 15.1 Java Heap

Java heap adalah tempat object Java biasa dialokasikan.

Parameter umum:

```bash
-Xms<size>
-Xmx<size>
```

Makna:

- `-Xms`: initial heap size;
- `-Xmx`: maximum heap size.

Tetapi:

- heap reserved bisa lebih besar dari committed;
- committed heap bisa lebih besar dari used heap;
- freed object setelah GC tidak otomatis membuat RSS turun;
- GC ergonomics bisa berubah dalam container;
- region-based GC seperti G1/ZGC/Shenandoah punya mekanisme sendiri.

Mental model:

```text
-Xmx = maksimum wilayah heap yang boleh digunakan JVM
RSS  = berapa page heap + non-heap yang resident di RAM saat ini
used heap = object live/allocated menurut JVM
```

Tiga angka ini berbeda.

### 15.2 Metaspace

Metaspace menyimpan metadata class, bukan object instance biasa.

Naik karena:

- banyak class loaded;
- dynamic proxy;
- bytecode generation;
- classloader leak;
- framework runtime generation;
- redeploy di app server tanpa unloading benar.

Bisa dikontrol dengan:

```bash
-XX:MaxMetaspaceSize=<size>
```

Tetapi membatasi metaspace terlalu agresif bisa menyebabkan:

```text
java.lang.OutOfMemoryError: Metaspace
```

### 15.3 Code Cache

JIT compiler menghasilkan native machine code. Code itu disimpan di code cache.

Jika code cache penuh, JVM bisa mengurangi/menonaktifkan compilation tertentu, menyebabkan performa turun.

Parameter terkait:

```bash
-XX:ReservedCodeCacheSize=<size>
```

### 15.4 Thread Stacks

Setiap native thread punya stack. Java platform thread umumnya dipetakan ke OS thread.

Parameter terkait:

```bash
-Xss<size>
```

Jika kamu punya banyak thread, stack memory bisa signifikan.

Contoh kasar:

```text
500 threads × 1 MiB stack = 500 MiB virtual stack reservation
```

Tidak semua stack reservation langsung RSS penuh, tetapi tetap mempengaruhi virtual address space, commit behavior, dan dapat menjadi masalah di limit ketat.

Failure yang sering muncul:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Penyebab mungkin:

- memory limit habis;
- `ulimit -u`/process limit;
- PID/thread limit;
- cgroup pids limit;
- stack size terlalu besar;
- thread leak;
- terlalu banyak pool.

### 15.5 Direct Buffers

`ByteBuffer.allocateDirect()` mengalokasikan memory di luar heap Java.

Dipakai oleh:

- NIO;
- Netty;
- file/network I/O;
- serialization buffer;
- off-heap cache;
- native interop.

Parameter terkait:

```bash
-XX:MaxDirectMemorySize=<size>
```

Jika tidak dipahami, aplikasi bisa tampak heap-nya sehat tetapi RSS naik karena direct/native memory.

### 15.6 Memory-Mapped Files

Java bisa memakai mapped file lewat:

```java
FileChannel.map(...)
```

Mapped file masuk address space dan page yang disentuh bisa menjadi RSS. Untuk workload indexing, search, analytics, cache, atau segment file, ini sangat penting.

Meskipun seri ini tidak mengulang detail database/search engine yang sudah dipelajari, konsep mmap penting karena banyak engine yang kamu pakai di Java production memanfaatkan file-backed memory atau page cache.

### 15.7 Native Libraries dan JNI

JNI/native library bisa mengalokasikan memory yang tidak dilacak lengkap oleh JVM heap metrics.

Contoh:

- compression library;
- crypto library;
- image processing;
- machine learning runtime;
- database driver native component;
- monitoring/profiling agent;
- custom JNI.

Oracle documentation tentang Native Memory Tracking menyatakan NMT melacak internal memory usage HotSpot VM, tetapi tidak selalu mencakup semua allocation dari native code pihak ketiga. Jadi NMT bagus, tetapi bukan satu-satunya sumber kebenaran.

---

## 16. Native Memory Tracking: JVM View, Bukan Kernel View

Aktifkan NMT:

```bash
java -XX:NativeMemoryTracking=summary -XX:+UnlockDiagnosticVMOptions ...
```

Lihat summary:

```bash
jcmd <pid> VM.native_memory summary
```

Lihat detail:

```bash
jcmd <pid> VM.native_memory detail
```

Contoh kategori yang bisa terlihat:

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
Module
Safepoint
Synchronization
```

Cara membaca:

- `reserved`: address space yang dicadangkan;
- `committed`: memory yang sudah dikomit JVM;
- ini bukan selalu sama dengan RSS;
- NMT adalah perspektif JVM, bukan perspektif kernel.

Kombinasi yang kuat:

```bash
jcmd <pid> VM.native_memory summary
cat /proc/<pid>/smaps_rollup
pmap -x <pid>
```

Interpretasi:

- Jika NMT naik di kategori Thread → cek jumlah thread dan `-Xss`.
- Jika NMT Class/Metaspace naik → cek classloader leak/class generation.
- Jika RSS naik tetapi NMT tidak menjelaskan → curigai third-party native allocation, mmap, allocator, atau page cache accounting.
- Jika heap used rendah tetapi RSS tinggi → cek non-heap, direct buffer, mapped file, fragmentation, committed heap belum dikembalikan.

---

## 17. Kenapa `RSS != Heap`

Ini adalah invariant utama.

```text
RSS = resident physical pages dari semua mapping process
Heap used = object Java yang sedang dipakai di heap menurut JVM
```

RSS mencakup:

- bagian heap yang resident;
- metaspace;
- code cache;
- thread stacks yang resident;
- direct/native memory;
- mapped file pages;
- shared libraries;
- JVM internal memory;
- allocator arena yang resident.

Heap used hanya satu komponen.

Contoh:

```text
Container limit:      1024 MiB
-Xmx:                  700 MiB
Heap used:             420 MiB
Committed heap:        700 MiB
Metaspace:              90 MiB
Thread stacks:         160 MiB reserved, 40 MiB resident
Direct buffers:        180 MiB
Code cache:             64 MiB
Mapped file RSS:       120 MiB
Shared libraries:       30 MiB
--------------------------------
RSS/process pressure: bisa mendekati/melewati limit
```

Aplikasi bisa OOMKilled walaupun heap used masih 420 MiB.

---

## 18. Container Memory: Kenapa `-Xmx` Aman di Host Bisa Bahaya di Pod

Di host tanpa container limit, process Java bersaing dengan seluruh sistem. Di container, cgroup memberi limit memory yang jauh lebih sempit.

Misalnya:

```text
Kubernetes memory limit: 1Gi
JVM -Xmx:               1Gi
```

Ini hampir pasti berisiko karena tidak ada ruang untuk non-heap.

Lebih aman berpikir seperti ini:

```text
container memory limit
  = Java heap
  + metaspace
  + code cache
  + thread stacks
  + direct/off-heap memory
  + native/JNI/agent memory
  + mapped file resident pages
  + libc allocator overhead
  + safety margin
```

Contoh budget lebih realistis untuk 1Gi container:

```text
Limit:                  1024 MiB
Heap max:                512 MiB
Metaspace budget:        128 MiB
Direct memory budget:    128 MiB
Thread/native/code:      128 MiB
Safety margin:           128 MiB
```

Angka ini bukan template universal. Workload menentukan budget. Service Netty-heavy mungkin butuh direct memory lebih besar. Service classloader-heavy mungkin butuh metaspace lebih besar. Service dengan banyak thread butuh stack budget lebih besar.

---

## 19. Java OOM vs Linux OOM Kill

Ada dua kelas besar memory failure.

### 19.1 Java `OutOfMemoryError`

Ini exception/error dari JVM.

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
java.lang.OutOfMemoryError: Metaspace
java.lang.OutOfMemoryError: Direct buffer memory
java.lang.OutOfMemoryError: unable to create native thread
```

JVM masih hidup cukup lama untuk melempar error, dump heap, atau menjalankan handler tertentu, tergantung kondisi.

### 19.2 Linux/cgroup OOM Kill

Ini tindakan kernel/cgroup membunuh process karena memory limit atau system memory pressure.

Gejala:

```text
Process exit code 137
Kubernetes status: OOMKilled
No Java stacktrace
No Java heap dump, kecuali sempat dibuat sebelumnya
Kernel/cgroup log menunjukkan kill
```

Perbedaan penting:

| Gejala | Kemungkinan |
|---|---|
| Ada `java.lang.OutOfMemoryError` | JVM mendeteksi limit internal tertentu |
| Exit 137 / OOMKilled | Kernel/cgroup membunuh process |
| Heap dump muncul | Biasanya Java OOME, bukan kill mendadak |
| Heap used rendah tapi OOMKilled | Non-heap/native/mmap/thread/page cache/cgroup pressure |

---

## 20. Observability: Command Praktis

### 20.1 Lihat PID dan command

```bash
pgrep -fa java
```

### 20.2 Lihat process memory summary

```bash
ps -o pid,ppid,stat,vsz,rss,comm,args -p <pid>
```

Ingat:

- `VSZ` = virtual size;
- `RSS` = resident set size;
- bukan heap used.

### 20.3 Lihat mapping

```bash
cat /proc/<pid>/maps | less
```

### 20.4 Lihat aggregate smaps

```bash
cat /proc/<pid>/smaps_rollup
```

Jika tidak tersedia:

```bash
cat /proc/<pid>/smaps | less
```

### 20.5 Lihat status process

```bash
cat /proc/<pid>/status
```

Field penting:

```text
VmPeak
VmSize
VmLck
VmPin
VmHWM
VmRSS
RssAnon
RssFile
RssShmem
VmData
VmStk
VmExe
VmLib
VmPTE
Threads
```

### 20.6 Lihat memory via pmap

```bash
pmap -x <pid> | sort -k3 -n | tail -30
```

### 20.7 Lihat JVM native memory

```bash
jcmd <pid> VM.native_memory summary
```

Jika NMT belum aktif dari startup, command ini tidak akan memberi data lengkap.

### 20.8 Lihat heap summary

```bash
jcmd <pid> GC.heap_info
jcmd <pid> GC.class_histogram
```

Gunakan hati-hati di production. Class histogram dapat men-trigger safepoint/overhead tergantung opsi dan JVM.

### 20.9 Lihat thread count

```bash
ps -o nlwp,pid,comm,args -p <pid>
ls /proc/<pid>/task | wc -l
```

### 20.10 Lihat page faults

```bash
ps -o pid,min_flt,maj_flt,rss,vsz,comm -p <pid>
```

Atau:

```bash
cat /proc/<pid>/stat
```

Parsing `/proc/<pid>/stat` manual tidak nyaman, tetapi field minor/major fault ada di sana. Untuk observability praktis, tool seperti `pidstat` lebih enak.

---

## 21. Lab 1 — Melihat Address Space Process Java

Buat file:

```java
public class MemoryShape {
    public static void main(String[] args) throws Exception {
        System.out.println("PID=" + ProcessHandle.current().pid());
        byte[][] chunks = new byte[10][];
        for (int i = 0; i < chunks.length; i++) {
            chunks[i] = new byte[32 * 1024 * 1024]; // 32 MiB
            System.out.println("Allocated " + ((i + 1) * 32) + " MiB");
            Thread.sleep(2000);
        }
        Thread.sleep(600_000);
    }
}
```

Compile dan run:

```bash
javac MemoryShape.java
java -Xms64m -Xmx512m MemoryShape
```

Di terminal lain:

```bash
PID=<pid>
watch -n 1 "ps -o pid,vsz,rss,stat,nlwp,comm -p $PID"
```

Lalu:

```bash
cat /proc/$PID/status | egrep 'Vm|Rss|Threads'
cat /proc/$PID/smaps_rollup
```

Pertanyaan:

1. Apakah `VSZ` langsung besar?
2. Apakah `RSS` naik mengikuti allocation?
3. Apakah `RSS` turun setelah GC? Coba modifikasi program agar reference dihapus dan `System.gc()` dipanggil.
4. Apakah `-Xmx512m` berarti RSS maksimum 512 MiB?

Ekspektasi:

- `VSZ` bisa besar karena address space reservation dan shared libs.
- `RSS` naik saat page disentuh.
- RSS tidak selalu turun sesuai ekspektasi setelah object tidak dipakai.
- Total RSS bisa melampaui heap used karena non-heap.

---

## 22. Lab 2 — Thread Stack dan Native Thread Pressure

Buat file:

```java
public class ThreadShape {
    public static void main(String[] args) throws Exception {
        System.out.println("PID=" + ProcessHandle.current().pid());
        int i = 0;
        while (true) {
            Thread t = new Thread(() -> {
                try {
                    Thread.sleep(600_000);
                } catch (InterruptedException ignored) {}
            }, "worker-" + i);
            t.start();
            i++;
            if (i % 100 == 0) {
                System.out.println("threads=" + i);
            }
            Thread.sleep(20);
        }
    }
}
```

Run:

```bash
javac ThreadShape.java
java -Xmx256m -Xss1m ThreadShape
```

Observasi:

```bash
PID=<pid>
watch -n 1 "ps -o pid,vsz,rss,nlwp,comm -p $PID"
cat /proc/$PID/status | egrep 'Vm|Rss|Threads'
```

Ulangi dengan:

```bash
java -Xmx256m -Xss256k ThreadShape
```

Pertanyaan:

1. Apa yang terjadi pada `NLWP`/`Threads`?
2. Apa pengaruh `-Xss` terhadap virtual memory?
3. Apakah semua reserved stack langsung menjadi RSS?
4. Kapan muncul `unable to create native thread`?

Catatan keamanan:

Jangan jalankan lab ini di mesin produksi. Ini memang dirancang untuk mendekati limit thread/memory.

---

## 23. Lab 3 — Direct Buffer di Luar Heap

Buat file:

```java
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

public class DirectBufferShape {
    public static void main(String[] args) throws Exception {
        System.out.println("PID=" + ProcessHandle.current().pid());
        List<ByteBuffer> buffers = new ArrayList<>();
        for (int i = 1; ; i++) {
            ByteBuffer b = ByteBuffer.allocateDirect(32 * 1024 * 1024);
            buffers.add(b);
            System.out.println("direct allocated=" + (i * 32) + " MiB");
            Thread.sleep(1000);
        }
    }
}
```

Run:

```bash
javac DirectBufferShape.java
java -Xmx128m -XX:MaxDirectMemorySize=512m DirectBufferShape
```

Observasi:

```bash
PID=<pid>
watch -n 1 "ps -o pid,vsz,rss,nlwp,comm -p $PID"
jcmd $PID VM.native_memory summary
```

Pertanyaan:

1. Kenapa heap kecil tetapi RSS bisa naik besar?
2. Apa error saat direct memory limit tercapai?
3. Apakah `-Xmx` melindungi dari direct memory pressure?

---

## 24. Lab 4 — Memory-Mapped File

Buat file besar:

```bash
dd if=/dev/zero of=/tmp/mmap-test.bin bs=1M count=512
```

Java:

```java
import java.io.RandomAccessFile;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;

public class MMapShape {
    public static void main(String[] args) throws Exception {
        System.out.println("PID=" + ProcessHandle.current().pid());
        try (RandomAccessFile raf = new RandomAccessFile("/tmp/mmap-test.bin", "r")) {
            MappedByteBuffer mb = raf.getChannel().map(FileChannel.MapMode.READ_ONLY, 0, raf.length());
            System.out.println("mapped");
            Thread.sleep(10_000);

            long sum = 0;
            for (int i = 0; i < mb.capacity(); i += 4096) {
                sum += mb.get(i);
            }
            System.out.println("touched pages, sum=" + sum);
            Thread.sleep(600_000);
        }
    }
}
```

Run:

```bash
javac MMapShape.java
java -Xmx128m MMapShape
```

Observasi sebelum dan sesudah pages disentuh:

```bash
PID=<pid>
ps -o pid,vsz,rss,comm -p $PID
grep mmap-test /proc/$PID/maps
cat /proc/$PID/smaps_rollup
```

Pertanyaan:

1. Apakah mapping file 512 MiB langsung membuat RSS naik 512 MiB?
2. Kapan RSS naik?
3. Apakah mapped file termasuk heap?
4. Bagaimana ini bisa mempengaruhi container memory limit?

---

## 25. Production Debugging Scenario 1 — “Heap Aman, Pod OOMKilled”

### Gejala

```text
Kubernetes pod restart.
Last state: OOMKilled.
Exit code: 137.
Heap metrics sebelum mati: 450 MiB dari Xmx 700 MiB.
Container limit: 1 GiB.
```

### Hipotesis lemah

> “Ini pasti bug Kubernetes, heap kan belum penuh.”

### Cara berpikir yang benar

Heap bukan total memory process.

Investigasi:

```bash
# sebelum kejadian, dari process yang masih hidup/repro
jcmd <pid> VM.native_memory summary
cat /proc/<pid>/smaps_rollup
cat /proc/<pid>/status | egrep 'Vm|Rss|Threads'
ls /proc/<pid>/task | wc -l
```

Cek juga:

- direct buffer pool metric;
- thread count;
- classloader/metaspace growth;
- mmap usage;
- native agent;
- container memory working set;
- cgroup memory events.

### Kemungkinan root cause

1. Direct buffer leak.
2. Terlalu banyak thread dan stack reservation/residency.
3. Metaspace leak karena classloader tidak unload.
4. Native library allocation tidak terlihat di heap metric.
5. Mapped file working set naik.
6. Heap max terlalu agresif terhadap container limit.

### Durable fix

- Turunkan `-Xmx` atau gunakan percentage-based sizing yang benar.
- Set `MaxDirectMemorySize` jika relevan.
- Batasi thread pool dan audit thread leak.
- Tambahkan metaspace monitoring dan limit jika sesuai.
- Tambahkan memory budget eksplisit per kategori.
- Alert pada RSS/cgroup memory, bukan heap saja.

---

## 26. Production Debugging Scenario 2 — “VIRT 40 GiB, Apakah Ini Leak?”

### Gejala

```text
top menunjukkan VIRT 40g untuk process Java.
RSS hanya 2.5g.
```

### Hipotesis lemah

> “Process memakai 40 GiB RAM.”

### Cara berpikir yang benar

VIRT adalah address space, bukan resident RAM.

Investigasi:

```bash
pmap -x <pid> | tail -20
cat /proc/<pid>/smaps_rollup
cat /proc/<pid>/maps | less
```

Cari:

- heap reservation;
- compressed class space reservation;
- large mmap;
- thread stack reservation;
- allocator arenas;
- huge sparse mappings.

### Kesimpulan umum

VIRT besar sendiri bukan bukti leak. Yang lebih penting:

- RSS trend;
- PSS/private dirty trend;
- cgroup memory usage;
- swap;
- major page fault;
- NMT committed categories;
- application memory metrics.

---

## 27. Production Debugging Scenario 3 — “Major Page Fault Spike Saat Traffic Naik”

### Gejala

- Latency p99 naik drastis setelah deploy/restart.
- CPU tidak penuh.
- GC tidak jelas bermasalah.
- Disk read naik.
- Major page fault meningkat.

### Kemungkinan

1. Cold page cache.
2. Memory-mapped files disentuh di request path.
3. Shared libraries/classes/resources belum warmed up.
4. Container/node memory pressure menyebabkan reclaim agresif.
5. Working set lebih besar dari memory tersedia.

### Investigasi

```bash
pidstat -r -p <pid> 1
ps -o pid,min_flt,maj_flt,rss,vsz,comm -p <pid>
cat /proc/vmstat | egrep 'pgfault|pgmajfault|pgscan|pgsteal'
```

### Durable fix

- Warmup path penting sebelum menerima traffic penuh.
- Hindari mmap cold random access di hot path tanpa budget.
- Pastikan memory request/limit cukup untuk working set.
- Pisahkan node/workload yang page-cache-heavy.
- Observasi major fault sebagai latency signal.

---

## 28. Invariant Penting

Simpan invariant ini. Ini akan terus dipakai sampai akhir seri.

1. **Process tidak mengakses physical memory langsung; process mengakses virtual address.**
2. **Address space besar bukan berarti RAM besar.**
3. **Mapping besar bukan berarti resident besar.**
4. **RSS bukan Java heap.**
5. **`-Xmx` bukan total memory limit process.**
6. **Heap used rendah tidak menjamin process aman dari OOM kill.**
7. **NMT adalah JVM view; `/proc` adalah kernel view. Keduanya perlu dibandingkan.**
8. **Thread punya stack; banyak thread berarti memory pressure, bukan hanya scheduling overhead.**
9. **Direct buffer dan mmap adalah off-heap dari perspektif Java heap, tetapi tetap memory dari perspektif kernel/container.**
10. **File-backed clean pages lebih mudah direclaim daripada anonymous dirty pages.**
11. **Major page fault adalah latency smell untuk service latency-sensitive.**
12. **Container memory limit harus memuat heap + non-heap + native + mapped working set + margin.**

---

## 29. Kesalahan Umum Java Engineer

### Kesalahan 1 — Menggunakan heap metric sebagai satu-satunya memory metric

Heap metric penting, tetapi tidak cukup.

Tambahkan:

- RSS;
- cgroup memory usage;
- direct memory;
- metaspace;
- thread count;
- NMT summary;
- major page fault;
- OOM kill event.

### Kesalahan 2 — Set `-Xmx` sama dengan container limit

Ini berbahaya karena tidak menyisakan ruang untuk non-heap.

### Kesalahan 3 — Panik melihat VIRT besar

VIRT besar perlu dijelaskan, bukan otomatis dianggap leak.

### Kesalahan 4 — Mengira GC membebaskan RAM ke OS secara langsung

GC membebaskan object untuk reuse oleh heap/JVM. Apakah memory dikembalikan ke OS tergantung GC, JVM policy, heap layout, dan kondisi runtime.

### Kesalahan 5 — Melupakan thread stack

Thread bukan hanya CPU scheduling entity; thread membawa stack dan kernel/task overhead.

### Kesalahan 6 — Mengabaikan mapped file

Mapped file dapat terlihat seperti “bukan heap”, tetapi resident page-nya tetap dapat menghitung terhadap RSS/cgroup.

### Kesalahan 7 — Menganggap NMT pasti menjelaskan semua native memory

NMT sangat berguna untuk internal JVM, tetapi third-party native allocation bisa tidak sepenuhnya terlihat.

---

## 30. Senior-Level Reasoning Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

### Q1

Sebuah Java service punya:

```text
Container limit: 2 GiB
-Xmx: 1536 MiB
Heap used: 900 MiB
RSS: 1950 MiB
Thread count: 900
Direct memory: unknown
Metaspace: 180 MiB
```

Apakah service aman?

Jawaban yang baik:

Tidak bisa dibilang aman. RSS sudah sangat dekat limit. Dengan 900 thread, stack dan native overhead signifikan. `-Xmx` 1536 MiB terlalu agresif jika limit 2 GiB dan metaspace/direct/thread/native butuh ruang. Perlu NMT, `/proc/<pid>/smaps_rollup`, thread audit, direct buffer metric, dan cgroup memory event.

### Q2

Kenapa `top` menunjukkan VIRT 20 GiB padahal mesin cuma punya RAM 8 GiB?

Jawaban yang baik:

Karena VIRT adalah virtual address space, bukan physical resident memory. Process bisa reserve/mmap address range besar tanpa semua page resident di RAM.

### Q3

Kenapa memory-mapped file 10 GiB tidak otomatis membuat RSS 10 GiB?

Jawaban yang baik:

Karena `mmap` membuat mapping virtual. Page baru resident saat disentuh/dibawa ke RAM. Clean file-backed page juga bisa direclaim dan dibaca ulang.

### Q4

Kenapa pod OOMKilled tanpa `OutOfMemoryError`?

Jawaban yang baik:

Karena kernel/cgroup membunuh process dari luar saat memory limit dilanggar. JVM tidak selalu sempat melempar Java exception atau membuat heap dump.

### Q5

Apa kombinasi tool minimal untuk membedakan heap leak vs native memory leak?

Jawaban yang baik:

Minimal: JVM heap metrics/`jcmd GC.heap_info`, NMT summary jika aktif, `/proc/<pid>/smaps_rollup`, `/proc/<pid>/status`, thread count, direct buffer metrics jika tersedia, dan cgroup memory usage. Heap leak akan tampak di heap used/class histogram; native/off-heap leak tampak sebagai RSS/cgroup naik tanpa kenaikan sepadan di heap.

---

## 31. Production Checklist: Memory Investigation

Saat service Java dicurigai punya masalah memory, jalankan checklist ini.

### 31.1 Identifikasi failure type

```text
Apakah ada Java OutOfMemoryError?
Apakah process exit 137/OOMKilled?
Apakah restart dilakukan orchestrator?
Apakah ada kernel/cgroup OOM log?
```

### 31.2 Ambil process-level data

```bash
PID=<pid>
ps -o pid,ppid,stat,vsz,rss,nlwp,comm,args -p $PID
cat /proc/$PID/status | egrep 'Vm|Rss|Threads'
cat /proc/$PID/smaps_rollup
```

### 31.3 Ambil JVM-level data

```bash
jcmd $PID GC.heap_info
jcmd $PID VM.native_memory summary
jcmd $PID Thread.print | head -100
```

### 31.4 Bandingkan view

```text
Kernel RSS high + heap high       → heap pressure/leak possible
Kernel RSS high + heap normal     → native/direct/mmap/thread/metaspace possible
NMT high Thread                   → too many threads or stack size
NMT high Class                    → metaspace/classloader issue
NMT high Code                     → code cache/JIT related
RSS high but NMT not high enough  → third-party native/mmap/allocator/file-backed pages
```

### 31.5 Cek container/cgroup

Lokasi cgroup bergantung versi dan runtime, tetapi konsepnya:

```bash
cat /sys/fs/cgroup/memory.current 2>/dev/null
cat /sys/fs/cgroup/memory.max 2>/dev/null
cat /sys/fs/cgroup/memory.events 2>/dev/null
```

Untuk cgroup v1 path berbeda. Di Kubernetes, gunakan juga:

```bash
kubectl describe pod <pod>
kubectl top pod <pod>
```

Tetapi ingat: `kubectl top` adalah ringkasan, bukan forensic detail.

---

## 32. Desain Memory Budget untuk Java Service

Jangan mulai dari `-Xmx`. Mulai dari total envelope.

Contoh model:

```text
Given:
  container_limit = 2048 MiB

Budget:
  heap_max              = 1024 MiB
  metaspace_max         = 192 MiB
  direct_memory_max     = 256 MiB
  code_cache            = 128 MiB
  thread_stack_budget   = 256 MiB
  native/agent/misc     = 128 MiB
  safety_margin         = 64 MiB
```

Kemudian validasi dengan observability:

```text
observed RSS p95 under peak traffic < 75-85% limit
no sustained major page fault spike
no cgroup OOM events
heap pressure explainable
native memory explainable
thread count bounded
```

### 32.1 Rumus kasar stack budget

```text
thread_stack_budget ≈ max_threads × Xss
```

Ini konservatif karena stack tidak selalu fully resident, tetapi berguna untuk desain limit.

### 32.2 Rumus kasar direct memory budget

Untuk Netty/NIO-heavy service:

```text
direct_memory_budget = expected concurrent buffers + allocator overhead + margin
```

Jangan biarkan direct memory “misterius”. Buat eksplisit.

### 32.3 Safety margin

Safety margin bukan pemborosan. Ia menyerap:

- JVM internal overhead;
- allocator fragmentation;
- temporary spikes;
- observability agent;
- class loading burst;
- TLS/crypto buffers;
- kernel/accounting variance;
- page cache interactions.

---

## 33. Hubungan ke Part Berikutnya

Part ini membahas bentuk address space process. Tetapi production memory problem tidak berhenti di process.

Pertanyaan berikutnya:

1. Saat RAM penuh, apa yang dilakukan kernel?
2. Apa itu page cache?
3. Bagaimana reclaim bekerja?
4. Apa bedanya anonymous memory dan file cache saat pressure?
5. Kapan swap terjadi?
6. Bagaimana OOM killer memilih korban?
7. Apa bedanya host OOM dan cgroup OOM?
8. Bagaimana membaca `/proc/meminfo`, `/proc/vmstat`, dan PSI?

Itu akan dibahas di Part 010.

---

## 34. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

1. Linux Kernel Documentation — Memory Management  
   `https://docs.kernel.org/admin-guide/mm/index.html`

2. Linux Kernel Documentation — Memory Management Concepts  
   `https://docs.kernel.org/admin-guide/mm/concepts.html`

3. Linux man-pages — `mmap(2)`  
   `https://man7.org/linux/man-pages/man2/mmap.2.html`

4. Linux man-pages — `/proc/<pid>/maps`  
   `https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html`

5. Linux man-pages — `proc(5)`  
   `https://man7.org/linux/man-pages/man5/proc.5.html`

6. Oracle/OpenJDK documentation — Native Memory Tracking  
   `https://docs.oracle.com/en/java/javase/11/vm/native-memory-tracking.html`

7. OpenJDK JEP 195 — Scalable Native Memory Tracking  
   `https://openjdk.org/jeps/195`

---

## 35. Ringkasan Akhir

Mental model akhir part ini:

```text
Java service adalah Linux process.
Linux process punya virtual address space.
Address space terdiri dari mappings.
Mappings bisa anonymous atau file-backed.
Mappings bisa reserved tanpa resident.
Resident pages membentuk RSS.
Java heap hanya salah satu mapping/region.
Non-heap tetap memory nyata untuk kernel/container.
Container OOM melihat total cgroup memory, bukan heap Java saja.
```

Jika kamu hanya membawa satu pelajaran dari part ini, bawa ini:

> **Untuk Java production di Linux/container, memory safety bukan sekadar memilih `-Xmx`. Memory safety adalah mendesain total runtime envelope: heap + non-heap + native + thread + direct + mmap + margin, lalu memverifikasinya dari dua sisi: JVM view dan kernel view.**

---

# Status Seri

Seri **belum selesai**.

Part yang sudah dibuat:

- Part 000 — Orientation: Why Linux Kernel Matters for Java Engineers
- Part 001 — Linux Architecture from First Principles
- Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle
- Part 003 — Processes: The Real Runtime Unit
- Part 004 — Threads, Tasks, and the JVM Execution Model
- Part 005 — System Calls: The Contract Between Java and Linux
- Part 006 — File Descriptors: The Universal Handle
- Part 007 — Virtual Filesystems: VFS, inode, dentry, mount
- Part 008 — Filesystem Semantics for Correct Applications
- Part 009 — Memory Model I: Virtual Memory and Address Space

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-010.md
Part 010 — Memory Model II: Page Cache, Reclaim, Swap, and OOM
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-008.md">⬅️ Learn Linux & Kernel Mastery for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-010.md">Part 010 — Memory Model II: Page Cache, Reclaim, Swap, and OOM ➡️</a>
</div>
