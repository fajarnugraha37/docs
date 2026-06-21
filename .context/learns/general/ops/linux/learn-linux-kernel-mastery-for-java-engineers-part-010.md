# learn-linux-kernel-mastery-for-java-engineers-part-010.md

# Part 010 — Memory Model II: Page Cache, Reclaim, Swap, and OOM

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Part: `010`  
> Topik: Linux Memory Model II — Page Cache, Reclaim, Swap, Overcommit, OOM, cgroup Memory, PSI, dan JVM Memory Budgeting  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sebagai fondasi production runtime  
> Status seri: belum selesai

---

## 0. Tujuan Part Ini

Di Part 009 kita sudah membahas **virtual memory dan address space**:

- virtual address vs physical memory
- page table
- `mmap`
- anonymous memory
- file-backed memory
- `/proc/<pid>/maps`
- JVM heap, metaspace, direct buffer, thread stack, code cache

Part ini melanjutkan ke level yang lebih operasional:

> Apa yang terjadi ketika memory menjadi resource bersama yang diperebutkan oleh JVM, page cache, kernel, filesystem, container, dan proses lain?

Di production, banyak insiden memory tidak terlihat sebagai `java.lang.OutOfMemoryError`.

Contoh:

```text
Pod OOMKilled.
Heap dump tidak ada.
Log aplikasi berhenti mendadak.
-Xmx masih lebih kecil dari container limit.
GC log tidak menunjukkan Java heap penuh.
```

Atau:

```text
Latency naik.
CPU tidak tinggi.
Heap tidak penuh.
Disk tidak kelihatan penuh.
Tapi aplikasi terasa "berat".
```

Sering kali penyebabnya ada pada:

- page cache pressure
- memory reclaim
- swap activity
- dirty page writeback
- cgroup memory limit
- native memory
- direct buffer
- thread stack
- kernel memory
- memory-mapped file
- OOM killer
- container-level OOM
- pressure stall

Tujuan part ini adalah membangun mental model agar kamu bisa menjawab:

1. Apa itu page cache dan kenapa Linux terlihat “memakai hampir semua RAM”?
2. Apa bedanya free memory, available memory, cached memory, RSS, anonymous memory, dan file-backed memory?
3. Kenapa JVM bisa dibunuh kernel walaupun heap belum penuh?
4. Apa beda Java `OutOfMemoryError`, host OOM, dan cgroup OOM?
5. Kenapa swap bisa menyelamatkan throughput tetapi menghancurkan latency?
6. Bagaimana membaca `/proc/meminfo`, `/proc/vmstat`, `/sys/fs/cgroup`, dan PSI?
7. Bagaimana membuat memory budget realistis untuk Java service di container?

---

## 1. Core Mental Model

Linux memory bukan hanya “RAM kosong vs RAM terpakai”.

Model yang lebih benar:

```text
Physical RAM
├── anonymous memory
│   ├── JVM heap
│   ├── thread stacks
│   ├── native malloc
│   └── other process private memory
│
├── file-backed memory
│   ├── page cache
│   ├── mmap-ed files
│   ├── shared libraries
│   └── executable code pages
│
├── kernel memory
│   ├── slab
│   ├── socket buffers
│   ├── page tables
│   ├── kernel stacks
│   └── cgroup/accounting structures
│
├── reclaimable memory
│   ├── clean page cache
│   ├── some slab cache
│   └── inactive file pages
│
└── unreclaimable / expensive-to-reclaim memory
    ├── active anonymous pages
    ├── pinned pages
    ├── dirty pages before writeback
    ├── mlocked pages
    └── memory under heavy reference
```

Linux mencoba memakai RAM untuk sesuatu yang berguna.

RAM kosong terlalu banyak berarti:

```text
hardware mahal sedang menganggur
```

Karena itu, Linux akan agresif memakai RAM untuk cache filesystem. Ini bukan berarti sistem “kehabisan memory”.

Invariant pertama:

> `used memory` tinggi tidak otomatis buruk. Yang penting adalah apakah memory bisa direclaim tanpa stall besar.

---

## 2. Page Cache: RAM sebagai Cache Filesystem

### 2.1 Apa Itu Page Cache?

Page cache adalah cache kernel untuk data file.

Ketika aplikasi membaca file:

```text
Java FileInputStream / NIO
        ↓
read()/pread()/mmap page fault
        ↓
kernel VFS
        ↓
page cache lookup
        ↓
jika page ada: return dari RAM
jika tidak ada: baca dari storage ke page cache
```

Page cache menyimpan isi file dalam memory agar akses berikutnya tidak harus ke disk.

Contoh:

```bash
cat large-file.bin > /dev/null
cat large-file.bin > /dev/null
```

Pembacaan kedua biasanya jauh lebih cepat karena data sudah ada di page cache.

### 2.2 Page Cache Bukan Memory Leak

Output `free -h` sering membuat engineer panik:

```text
              total        used        free      shared  buff/cache   available
Mem:           16Gi        12Gi       600Mi       200Mi       3.4Gi       3.1Gi
```

Interpretasi salah:

```text
RAM tinggal 600Mi. Bahaya.
```

Interpretasi lebih benar:

```text
free kecil, tetapi available masih 3.1Gi.
Sebagian memory dipakai sebagai cache dan bisa direclaim.
```

Yang penting:

- `free`: memory benar-benar tidak dipakai
- `buff/cache`: memory untuk buffer/cache
- `available`: estimasi memory yang bisa dipakai aplikasi baru tanpa swap berat

Jadi untuk production triage, lihat `available`, bukan hanya `free`.

### 2.3 Page Cache dan Java

Java service memakai page cache walaupun kamu tidak merasa “menggunakan cache”.

Contoh:

1. Membaca config file.
2. Membaca JAR/class/resource.
3. Logging ke file.
4. Membaca sertifikat TLS.
5. Mengakses embedded index.
6. Menggunakan Lucene/Elasticsearch-like workload.
7. Menggunakan memory-mapped file.
8. Membaca file upload sementara.
9. Melakukan cold start container image layer.
10. Loading native library.

JVM tidak mengelola page cache. Kernel yang mengelola.

Namun perilaku JVM bisa sangat dipengaruhi page cache.

Misalnya:

```text
Service A restart.
Class/JAR/resources perlu dibaca.
Page cache cold.
Startup lebih lambat.
```

Atau:

```text
Service melakukan mmap index besar.
RSS naik.
Engineer mengira heap leak.
Padahal banyak memory berasal dari file-backed pages.
```

---

## 3. Anonymous Memory vs File-Backed Memory

Linux membedakan dua kategori besar memory page.

### 3.1 Anonymous Memory

Anonymous memory tidak punya file backing langsung.

Contoh:

- Java heap
- native malloc
- thread stack
- direct buffer
- runtime data structure
- sebagian JIT/compiler allocation

Anonymous memory jika perlu direclaim biasanya:

1. harus diswap, atau
2. prosesnya harus mengurangi/membebaskan memory, atau
3. prosesnya dibunuh jika tekanan terlalu tinggi.

### 3.2 File-Backed Memory

File-backed memory berasal dari file.

Contoh:

- page cache file
- mapped JAR
- mapped shared library
- mapped index
- executable pages

Jika file-backed page bersih, kernel bisa membuangnya dari RAM karena sumber aslinya masih ada di disk.

```text
clean file-backed page
        ↓
boleh drop
        ↓
jika dibutuhkan lagi, baca ulang dari disk
```

Jika dirty, harus ditulis dulu ke storage.

```text
dirty file-backed page
        ↓
writeback
        ↓
baru bisa direclaim
```

### 3.3 Implikasi

Anonymous memory lebih mahal untuk direclaim dibanding clean page cache.

Jika JVM heap besar sekali, kernel punya ruang lebih kecil untuk page cache.

Efeknya:

```text
heap terlalu besar
    ↓
page cache mengecil
    ↓
file I/O lebih sering ke disk
    ↓
latency naik
    ↓
GC mungkin tetap terlihat normal
```

Ini alasan kenapa `-Xmx` tidak boleh otomatis di-set mendekati 100% container memory.

---

## 4. Dirty Pages dan Writeback

### 4.1 Apa Itu Dirty Page?

Dirty page adalah page cache yang sudah dimodifikasi di memory tetapi belum ditulis ke storage.

Contoh:

```text
app write(log_fd, bytes)
        ↓
data masuk page cache
        ↓
write() bisa return sukses
        ↓
data belum tentu durable di disk
```

Ini sudah dibahas di Part 008 dari sisi correctness. Di part ini kita lihat dari sisi memory pressure.

Dirty pages menggunakan RAM.

Jika terlalu banyak dirty page, kernel harus melakukan writeback.

### 4.2 Writeback dan Latency

Ketika dirty pages meningkat:

```text
application writes
        ↓
page cache dirty pages naik
        ↓
background writeback mulai
        ↓
storage lambat / queue penuh
        ↓
dirty pages sulit turun
        ↓
kernel bisa throttle writer
        ↓
write latency naik
```

Aplikasi Java yang hanya melakukan logging pun bisa terkena.

Contoh:

```text
Service menulis log sangat cepat.
Disk lambat.
Dirty page menumpuk.
Kernel throttle write().
Request latency naik.
Thread terlihat blocked di syscall write/fsync.
```

### 4.3 Observability Dirty Pages

Lihat:

```bash
grep -E 'Dirty|Writeback|Cached|Buffers' /proc/meminfo
```

Contoh field:

```text
Dirty:              192832 kB
Writeback:            512 kB
Cached:           2839488 kB
Buffers:            90324 kB
```

Field penting:

- `Dirty`: memory yang sudah berubah tapi belum ditulis
- `Writeback`: memory yang sedang ditulis
- `Cached`: file cache
- `Buffers`: block device metadata/cache tertentu

Lihat juga:

```bash
cat /proc/vmstat | grep -E 'nr_dirty|nr_writeback|pgpgout|pgmajfault|pswp'
```

---

## 5. Memory Reclaim

### 5.1 Apa Itu Reclaim?

Reclaim adalah usaha kernel mendapatkan kembali memory dari page yang sudah ada.

Ketika memory pressure terjadi:

```text
free/available memory turun
        ↓
kernel mencari page yang bisa dikorbankan
        ↓
clean file cache bisa drop
        ↓
dirty page harus writeback
        ↓
anonymous page mungkin swap
        ↓
jika gagal cukup cepat, OOM bisa terjadi
```

### 5.2 Reclaim Murah vs Mahal

Tidak semua reclaim sama.

Murah:

```text
drop clean inactive file cache
```

Mahal:

```text
writeback dirty page
swap anonymous page
scan banyak page tapi sedikit hasil
reclaim dalam cgroup kecil yang sudah padat
```

Sangat mahal:

```text
semua task sering stall menunggu memory
direct reclaim berjalan pada thread aplikasi
```

### 5.3 Direct Reclaim

Direct reclaim terjadi ketika thread aplikasi sendiri harus ikut mencari memory.

Alur sederhana:

```text
Java thread butuh allocate native memory / page fault
        ↓
kernel tidak punya free page cukup
        ↓
thread masuk direct reclaim
        ↓
thread berhenti melakukan work aplikasi
        ↓
latency request naik
```

Ini berbahaya karena aplikasi terlihat “misterius lambat”, bukan selalu crash.

### 5.4 Reclaim dan Tail Latency

Memory pressure sering memukul p99/p999 lebih dulu.

Rata-rata latency mungkin normal.

```text
most requests:
    data already hot
    no reclaim
    fast

few unlucky requests:
    page fault
    direct reclaim
    writeback
    stall
    very slow
```

Karena itu memory pressure harus dibaca dengan percentile dan pressure metrics, bukan hanya average CPU.

---

## 6. LRU, Active/Inactive, dan Working Set

Linux menggunakan pendekatan berbasis list untuk memperkirakan page mana yang masih berguna.

Secara konseptual:

```text
active anon
inactive anon
active file
inactive file
```

Tidak perlu menghafal internal detail untuk menjadi backend engineer. Yang penting adalah model ini:

```text
page sering diakses
    → cenderung dianggap active

page jarang diakses
    → bisa turun ke inactive

inactive clean file page
    → kandidat reclaim murah

inactive anon page
    → kandidat swap jika swap tersedia
```

Working set adalah memory yang aktif dibutuhkan workload.

Jika working set lebih besar dari memory yang tersedia:

```text
working set > available RAM
        ↓
constant reclaim
        ↓
page fault
        ↓
swap/writeback
        ↓
thrashing
        ↓
latency collapse
```

Untuk Java service, working set tidak sama dengan heap.

Working set bisa mencakup:

- live heap yang sering disentuh
- direct buffer
- thread stacks aktif
- mapped files
- page cache untuk data panas
- socket buffers
- kernel structures
- JIT code
- TLS/native library memory

---

## 7. Swap

### 7.1 Apa Itu Swap?

Swap adalah area storage yang dapat dipakai untuk menyimpan anonymous memory ketika RAM tertekan.

```text
anonymous page jarang dipakai
        ↓
ditulis ke swap
        ↓
RAM bebas
        ↓
jika page disentuh lagi, dibaca dari swap
```

### 7.2 Kenapa Swap Ada?

Swap membantu:

1. Memindahkan anonymous page dingin keluar dari RAM.
2. Memberi kernel pilihan selain membunuh proses.
3. Menyediakan safety margin.
4. Membantu workload batch yang tidak latency-sensitive.
5. Membantu sistem tetap hidup saat temporary pressure.

### 7.3 Kenapa Service Latency-Sensitive Takut Swap?

Swap jauh lebih lambat dari RAM.

Jika page penting terswap:

```text
Java thread akses memory
        ↓
page fault
        ↓
swap-in dari disk
        ↓
thread stall
        ↓
tail latency naik tajam
```

Untuk backend service latency-sensitive, swap activity sering berarti:

```text
memory budget salah
atau
host overloaded
atau
heap/native/page cache fighting
```

### 7.4 Swap Bukan Selalu Jahat

Mengatakan “swap harus selalu dimatikan” terlalu sederhana.

Swap bisa berguna jika:

- ada anonymous memory dingin
- workload tidak strict latency
- host butuh safety margin
- ingin menghindari OOM terlalu cepat
- ada zswap/zram dengan konfigurasi tepat

Tapi untuk Java service dengan SLO ketat, swap harus dipahami sebagai risk.

### 7.5 Observability Swap

```bash
free -h
swapon --show
grep -E 'Swap|pswp' /proc/meminfo /proc/vmstat
vmstat 1
```

Di `vmstat`, perhatikan:

```text
si  so
```

- `si`: swap in
- `so`: swap out

Jika `si/so` aktif saat latency spike, investigasi memory pressure.

---

## 8. Overcommit

### 8.1 Apa Itu Overcommit?

Linux bisa mengizinkan proses melakukan reserve virtual memory lebih besar dari physical RAM yang tersedia.

Alasan:

```text
program sering reserve memory yang belum benar-benar dipakai
copy-on-write membuat fork murah
mmap besar tidak selalu berarti semua page resident
```

Contoh:

```text
JVM reserve address space besar
tapi tidak semua langsung committed/resident
```

### 8.2 Commit vs Resident

Reserve virtual address:

```text
address range tersedia
belum tentu pakai RAM
```

Commit/touch page:

```text
page benar-benar dibutuhkan
kernel harus menyediakan physical page atau swap
```

RSS:

```text
page yang sekarang resident di RAM
```

### 8.3 Overcommit Modes

Linux memiliki setting:

```bash
cat /proc/sys/vm/overcommit_memory
cat /proc/sys/vm/overcommit_ratio
```

Mode umum:

```text
0 = heuristic overcommit
1 = always overcommit
2 = strict overcommit
```

Untuk Java engineer, yang penting bukan menghafal semua rumus, tetapi memahami:

> Allocation success tidak selalu berarti physical memory sudah tersedia untuk semua page yang nanti akan disentuh.

### 8.4 Overcommit dan Fork

`fork()` secara tradisional memakai copy-on-write.

```text
parent address space besar
        ↓
fork child
        ↓
page table disalin secara logis
        ↓
physical page tidak langsung digandakan
        ↓
baru copy ketika ditulis
```

Namun proses dengan memory besar tetap bisa mengalami masalah jika overcommit strict atau page table cost tinggi.

Untuk Java service besar, hati-hati dengan pola native/process spawning.

---

## 9. OOM: Out of Memory di Linux

### 9.1 Tiga Jenis OOM yang Sering Tertukar

Untuk Java service, minimal bedakan:

```text
1. Java heap OOM
2. JVM/native allocation failure
3. Linux/cgroup OOM kill
```

#### Java Heap OOM

Contoh:

```text
java.lang.OutOfMemoryError: Java heap space
```

Biasanya JVM masih sempat melempar exception.

Bisa ada:

- stack trace
- heap dump jika dikonfigurasi
- GC log
- application log

#### JVM Native OOM

Contoh:

```text
java.lang.OutOfMemoryError: unable to create native thread
java.lang.OutOfMemoryError: Direct buffer memory
Native memory allocation (malloc) failed
```

Penyebab bisa:

- thread terlalu banyak
- direct buffer limit
- metaspace
- code cache
- native library leak
- glibc arena fragmentation
- cgroup limit
- virtual memory limit

#### Linux/cgroup OOM Kill

Contoh dari Kubernetes:

```text
Last State: Terminated
Reason: OOMKilled
Exit Code: 137
```

Sering tidak ada Java exception.

Kernel membunuh proses.

Log aplikasi mungkin berhenti mendadak.

### 9.2 OOM Killer

Jika kernel tidak bisa mendapatkan memory cukup, OOM killer memilih victim.

Secara praktis, victim dipengaruhi oleh:

- memory usage
- `oom_score`
- `oom_score_adj`
- cgroup context
- kernel policy
- apakah kill dilakukan di host atau dalam cgroup

Observability:

```bash
cat /proc/<pid>/oom_score
cat /proc/<pid>/oom_score_adj
dmesg -T | grep -i -E 'killed process|out of memory|oom'
journalctl -k | grep -i oom
```

### 9.3 cgroup OOM

Dalam container, memory limit biasanya diimplementasikan lewat cgroup.

Model:

```text
container memory.max = 1GiB
        ↓
JVM + native + page cache charged to cgroup
        ↓
usage mencapai limit
        ↓
kernel mencoba reclaim dalam cgroup
        ↓
jika gagal
        ↓
cgroup OOM
        ↓
salah satu proses di cgroup dibunuh
```

Penting:

> cgroup memory tidak hanya menghitung Java heap.

Yang dapat masuk budget:

- heap
- metaspace
- code cache
- thread stack
- direct buffer
- native malloc
- mmap
- page cache yang dicharge ke cgroup
- socket buffer
- sebagian kernel memory/accounting
- loaded libraries
- JIT/compiler allocation

### 9.4 Exit Code 137

Di container/Kubernetes, exit code 137 biasanya berarti proses mati karena `SIGKILL`.

```text
128 + 9 = 137
```

Sering terkait OOM kill, tetapi tetap validasi dengan:

```bash
kubectl describe pod
kubectl get pod -o yaml
kubectl logs --previous
node dmesg/journal
cgroup memory events
```

Jangan hanya menyimpulkan dari exit code.

---

## 10. cgroup v2 Memory Interface

Pada sistem modern, cgroup v2 makin umum.

File penting:

```bash
/sys/fs/cgroup/memory.current
/sys/fs/cgroup/memory.max
/sys/fs/cgroup/memory.high
/sys/fs/cgroup/memory.low
/sys/fs/cgroup/memory.min
/sys/fs/cgroup/memory.swap.max
/sys/fs/cgroup/memory.events
/sys/fs/cgroup/memory.stat
/sys/fs/cgroup/memory.pressure
```

Lokasi aktual bisa berbeda tergantung container runtime dan path cgroup process.

Cek cgroup process:

```bash
cat /proc/self/cgroup
```

### 10.1 `memory.current`

Current memory usage cgroup.

```bash
cat /sys/fs/cgroup/memory.current
```

Ini mendekati “berapa memory yang sedang dicharge ke cgroup”.

### 10.2 `memory.max`

Hard limit memory cgroup.

```bash
cat /sys/fs/cgroup/memory.max
```

Nilai bisa:

```text
max
```

artinya tidak ada hard limit eksplisit.

### 10.3 `memory.high`

Soft throttle boundary.

Jika usage melewati `memory.high`, kernel bisa melakukan reclaim/throttling sebelum hard OOM.

Ini berguna untuk menghindari death spiral.

### 10.4 `memory.events`

Contoh:

```bash
cat /sys/fs/cgroup/memory.events
```

Output bisa:

```text
low 0
high 12
max 3
oom 1
oom_kill 1
oom_group_kill 0
```

Interpretasi:

- `high`: pernah melewati `memory.high`
- `max`: pernah menyentuh `memory.max`
- `oom`: OOM terjadi
- `oom_kill`: proses dibunuh karena OOM

Ini sangat penting untuk debugging container.

### 10.5 `memory.stat`

Berisi breakdown memory.

```bash
cat /sys/fs/cgroup/memory.stat
```

Field yang sering penting:

```text
anon
file
kernel
slab
sock
pagetables
file_dirty
file_writeback
swapcached
```

Interpretasi kasar:

- `anon`: heap/native anonymous
- `file`: page cache/file-backed
- `kernel`: kernel memory charged
- `sock`: socket buffer
- `pagetables`: page table
- `file_dirty`: dirty file pages
- `file_writeback`: sedang writeback

Untuk Java:

```text
memory.current tinggi
anon tinggi
    → curiga heap/native/direct/thread/metaspace

memory.current tinggi
file tinggi
    → curiga page cache/mmap/log/index/file workload

sock tinggi
    → curiga banyak socket / buffer besar / network backpressure

pagetables tinggi
    → curiga banyak mapping/thread/process atau address space besar
```

---

## 11. Pressure Stall Information atau PSI

### 11.1 Masalah yang Diselesaikan PSI

CPU utilization, memory usage, dan disk usage tidak selalu menunjukkan apakah workload “tertahan”.

PSI menjawab pertanyaan:

> Berapa lama task tidak bisa maju karena menunggu CPU, memory, atau I/O?

File umum:

```bash
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io
```

Dalam cgroup v2:

```bash
cat /sys/fs/cgroup/memory.pressure
cat /sys/fs/cgroup/cpu.pressure
cat /sys/fs/cgroup/io.pressure
```

### 11.2 `some` vs `full`

Contoh:

```text
some avg10=3.50 avg60=1.20 avg300=0.40 total=123456789
full avg10=0.80 avg60=0.20 avg300=0.05 total=1234567
```

Interpretasi:

- `some`: sebagian task stall
- `full`: semua non-idle task stall pada saat yang sama

Untuk service latency-sensitive:

```text
memory some naik
    → beberapa request/thread mungkin stall

memory full naik
    → seluruh workload sempat tidak bisa maju
```

### 11.3 Kenapa PSI Penting untuk Java

Misalnya:

```text
Heap usage stabil.
CPU rendah.
GC normal.
Latency naik.
```

Jika:

```bash
cat /proc/pressure/memory
```

menunjukkan memory pressure, maka thread aplikasi mungkin tertahan di:

- page fault
- direct reclaim
- writeback
- swap-in
- allocation path

Jadi akar masalah bukan “Java code lambat”, tetapi kernel memory pressure.

### 11.4 PSI di Kubernetes

Kubernetes modern dapat mengekspos PSI melalui kubelet/cAdvisor pada node/pod/container level jika kernel dan konfigurasi mendukung. Ini membuat PSI berguna bukan hanya untuk node debugging, tetapi juga untuk observability workload container.

Namun tetap pahami sumbernya:

```text
PSI bukan memory usage.
PSI adalah waktu stall akibat pressure.
```

---

## 12. Membaca `/proc/meminfo`

Gunakan:

```bash
cat /proc/meminfo
```

Field penting:

```text
MemTotal
MemFree
MemAvailable
Buffers
Cached
SwapCached
Active
Inactive
Active(anon)
Inactive(anon)
Active(file)
Inactive(file)
Dirty
Writeback
AnonPages
Mapped
Shmem
KReclaimable
Slab
SReclaimable
SUnreclaim
KernelStack
PageTables
Committed_AS
CommitLimit
SwapTotal
SwapFree
```

### 12.1 Field yang Sering Disalahpahami

#### `MemFree`

Memory yang benar-benar idle.

Tidak cukup untuk menilai kesehatan.

#### `MemAvailable`

Estimasi memory yang bisa dipakai tanpa swap besar.

Lebih berguna untuk triage.

#### `Cached`

Page cache.

Bisa besar dan normal.

#### `AnonPages`

Anonymous memory.

Untuk Java, ini lebih dekat ke heap/native/private memory, tapi tetap bukan angka JVM heap.

#### `Mapped`

Memory file yang dimap ke process.

Bisa tinggi pada workload `mmap`.

#### `Slab`

Kernel object cache.

Jika sangat tinggi, lihat apakah reclaimable atau unreclaimable.

#### `PageTables`

Memory untuk page tables.

Bisa naik jika banyak process, banyak mapping, banyak thread, atau address space kompleks.

#### `Committed_AS`

Total memory yang sudah committed secara virtual.

Bukan RSS.

#### `CommitLimit`

Batas commit berdasarkan RAM/swap/overcommit policy.

---

## 13. Membaca `/proc/vmstat`

Gunakan:

```bash
cat /proc/vmstat
```

Field yang berguna:

```text
pgfault
pgmajfault
pgscan_kswapd
pgscan_direct
pgsteal_kswapd
pgsteal_direct
pswpin
pswpout
nr_dirty
nr_writeback
oom_kill
```

### 13.1 Minor vs Major Fault

- minor fault: mapping/page tersedia tanpa disk I/O besar
- major fault: perlu I/O dari storage/swap

Cek:

```bash
grep -E 'pgfault|pgmajfault' /proc/vmstat
```

Major fault naik saat latency spike bisa mengarah ke:

- cold page cache
- mmap miss
- swap-in
- file-backed access ke storage lambat

### 13.2 Direct Reclaim Signal

Cek:

```bash
grep -E 'pgscan_direct|pgsteal_direct' /proc/vmstat
```

Jika direct reclaim meningkat saat request latency naik:

```text
thread aplikasi ikut kerja membersihkan memory
```

Itu indikator kuat memory pressure.

### 13.3 Swap Activity

```bash
grep -E 'pswpin|pswpout' /proc/vmstat
```

Jika naik terus:

```text
system sedang swap aktif
```

---

## 14. JVM Memory: Lebih Besar dari `-Xmx`

### 14.1 Komponen Memory JVM

Total memory process Java kira-kira:

```text
JVM process memory
├── Java heap (-Xmx)
├── metaspace
├── compressed class space
├── code cache
├── thread stacks (-Xss × thread count)
├── direct buffers
├── mapped byte buffers
├── GC internal structures
├── JIT/compiler memory
├── JNI/native libraries
├── malloc arenas
├── TLS/security/native crypto
├── libc allocations
├── page tables
├── socket buffers charged to cgroup
└── page cache charged to cgroup
```

`-Xmx` hanya heap maksimum.

Jadi:

```text
container limit = 1024Mi
-Xmx = 900Mi
```

bukan berarti aman.

Karena masih butuh:

```text
metaspace
threads
direct memory
code cache
native memory
page cache
kernel/cgroup accounted memory
```

### 14.2 Budget Sederhana

Misalnya container memory limit 2GiB.

Budget awal:

```text
container memory limit        = 2048 MiB

Java heap (-Xmx)              = 1024 MiB
metaspace + class space       = 128  MiB
code cache                    = 64   MiB
thread stacks                 = 256  MiB
direct buffers/native         = 256  MiB
page cache / mmap / kernel    = 256  MiB
safety margin                 = 64   MiB
```

Ini bukan rumus universal. Ini starting model.

Untuk service tertentu:

- Netty heavy direct buffer → direct memory lebih besar
- banyak thread → stack budget lebih besar
- Lucene/mmap heavy → file-backed/page cache lebih besar
- small service → heap lebih kecil, margin lebih besar
- high TLS/native crypto → native memory lebih besar
- high connection count → socket buffer lebih besar

### 14.3 Rule of Thumb yang Lebih Aman

Daripada:

```text
-Xmx = 90% dari container limit
```

lebih aman mulai dengan:

```text
-Xmx = 50% sampai 70% dari container limit
```

lalu validasi dengan:

- GC log
- Native Memory Tracking
- RSS/PSS
- cgroup memory.stat
- workload test
- peak traffic
- startup/cold path
- failure mode
- direct buffer usage
- thread count

Untuk aplikasi modern dengan direct buffer, high connection count, atau mmap, `-Xmx` terlalu tinggi justru bisa membuat sistem lebih lambat.

---

## 15. Native Memory Tracking

JVM memiliki Native Memory Tracking atau NMT.

Aktifkan:

```bash
-XX:NativeMemoryTracking=summary
```

atau lebih detail:

```bash
-XX:NativeMemoryTracking=detail
```

Lihat:

```bash
jcmd <pid> VM.native_memory summary
```

Contoh kategori:

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

NMT membantu membedakan:

```text
heap tinggi
vs
thread stack tinggi
vs
metaspace tinggi
vs
code cache
vs
GC/native overhead
```

Namun NMT tidak selalu mencakup semua memory eksternal secara sempurna, misalnya beberapa native library allocation atau memory yang dicharge di cgroup seperti page cache/socket buffer.

Karena itu kombinasikan:

```text
NMT
+ /proc/<pid>/smaps_rollup
+ /proc/<pid>/status
+ cgroup memory.stat
+ JVM metrics
```

---

## 16. Direct Buffer dan Off-Heap Memory

### 16.1 Apa Itu Direct Buffer?

Direct buffer adalah memory off-heap yang sering dipakai untuk I/O.

Contoh:

- Java NIO
- Netty
- TLS/native I/O
- high-throughput networking
- zero-copy-like path

Direct buffer tidak masuk Java heap.

Jadi heap bisa normal, tetapi process RSS/cgroup usage tinggi.

### 16.2 Failure

Contoh:

```text
java.lang.OutOfMemoryError: Direct buffer memory
```

Atau lebih buruk:

```text
process OOMKilled tanpa Java exception
```

Jika direct memory tidak dibatasi/diamati dengan baik.

### 16.3 Observability

Cek:

```bash
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.flags
cat /proc/<pid>/smaps_rollup
cat /sys/fs/cgroup/memory.stat
```

Untuk Netty, cek metrics allocator jika diekspos.

### 16.4 Budgeting

Jika service pakai Netty/gRPC/reactive HTTP client:

```text
heap budget saja tidak cukup
direct memory harus masuk desain
connection count mempengaruhi buffer pressure
backpressure menentukan apakah buffer menumpuk
```

---

## 17. Thread Stack Memory

Setiap platform thread punya native stack.

Jika:

```text
-Xss1m
thread count = 1000
```

Stack reservation bisa sangat besar.

Tidak semua langsung resident, tetapi tetap dapat berkontribusi pada virtual memory dan saat disentuh menjadi real memory.

Failure umum:

```text
java.lang.OutOfMemoryError: unable to create native thread
```

Penyebab bisa:

- thread terlalu banyak
- memory limit cgroup
- process/user thread limit
- stack size terlalu besar
- PID/task limit
- native memory fragmented

Observability:

```bash
ps -L -p <pid> | wc -l
cat /proc/<pid>/status | grep Threads
cat /proc/<pid>/limits
jcmd <pid> Thread.print
jcmd <pid> VM.native_memory summary
```

---

## 18. Page Cache di Container

Ini bagian yang sering mengejutkan.

Dalam banyak konfigurasi cgroup, page cache yang digunakan oleh workload container bisa dicharge ke cgroup tersebut.

Artinya:

```text
container membaca/menulis banyak file
        ↓
page cache naik
        ↓
memory.current naik
        ↓
limit tersentuh
        ↓
cgroup reclaim
        ↓
jika gagal
        ↓
OOMKilled
```

Jadi container memory bukan hanya:

```text
heap + native
```

tetapi juga dapat mencakup file cache yang terkait workload.

Contoh kasus:

```text
Java service melakukan batch export file besar ke /tmp.
Memory.current naik.
Heap stabil.
Pod OOMKilled.
```

Kenapa?

```text
write ke file
    → dirty page cache
    → charged ke cgroup
    → storage lambat, writeback tertahan
    → memory limit tercapai
```

Solusi bisa:

- kurangi `-Xmx`
- stream lebih kecil
- gunakan volume dengan behavior lebih sesuai
- batasi buffer
- pindahkan workload file-heavy
- perbaiki writeback/storage
- tingkatkan memory limit
- observasi `memory.stat file/file_dirty/file_writeback`

---

## 19. `/tmp`, tmpfs, dan Memory

Di banyak container, `/tmp` bisa berada di filesystem biasa atau `tmpfs`.

Jika `tmpfs`:

```text
file di /tmp memakai memory
```

Contoh:

```text
upload file 800MiB ke /tmp
container limit 1GiB
heap 512MiB
        ↓
OOM risk tinggi
```

Cek:

```bash
df -hT /tmp
mount | grep /tmp
```

Jika `tmpfs`, file temporary harus dianggap bagian dari memory budget.

Java framework sering membuat temp file untuk:

- multipart upload
- report generation
- zip extraction
- PDF/image processing
- intermediate batch output

Jangan treat `/tmp` sebagai storage gratis.

---

## 20. Socket Buffer dan Memory

Network connection juga memakan memory.

Per connection dapat ada:

- receive buffer
- send buffer
- TCP metadata
- socket structures
- TLS buffers di user space
- application buffer

Banyak koneksi idle tidak selalu gratis.

Banyak koneksi lambat bisa menyebabkan buffer menumpuk.

Contoh:

```text
client lambat membaca response
        ↓
send buffer penuh
        ↓
application buffer menumpuk
        ↓
memory naik
        ↓
GC pressure atau cgroup OOM
```

Observability:

```bash
ss -m
ss -tanp
cat /proc/net/sockstat
cat /sys/fs/cgroup/memory.stat | grep sock
```

Di cgroup v2, `memory.stat` dapat menunjukkan `sock`.

---

## 21. Major Faults dan mmap-heavy Workloads

Memory-mapped file membuat file terlihat seperti memory.

Contoh:

```text
MappedByteBuffer
Lucene index
large read-only data file
```

Saat page belum resident:

```text
access mapped address
        ↓
page fault
        ↓
kernel load page from storage
        ↓
thread stall
```

Jika page cache tidak cukup untuk working set:

```text
constant major fault
        ↓
storage I/O
        ↓
tail latency naik
```

Cek:

```bash
perf stat -e page-faults,major-faults -p <pid>
cat /proc/<pid>/stat
cat /proc/vmstat | grep pgmajfault
```

Untuk Java, mapped file bisa membuat RSS tampak besar, tetapi tidak semua sama dengan heap leak.

---

## 22. Practical Triage: Java Service OOMKilled

### 22.1 Symptom

```text
Kubernetes pod restart.
Reason: OOMKilled.
Exit code: 137.
No Java heap dump.
No Java OutOfMemoryError.
```

### 22.2 Wrong First Assumption

```text
Heap leak.
Naikkan -Xmx.
```

Ini bisa memperburuk.

### 22.3 Better Triage Flow

#### Step 1 — Confirm OOM context

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
```

Look for:

```text
Reason: OOMKilled
Exit Code: 137
```

#### Step 2 — Check limits

```bash
kubectl get pod <pod> -o yaml | grep -A20 resources
```

Catat:

```text
memory request
memory limit
cpu limit
```

#### Step 3 — Check JVM container awareness

```bash
java -XshowSettings:system -version
```

Atau dalam pod:

```bash
jcmd <pid> VM.info
jcmd <pid> VM.flags
```

Pastikan JVM membaca cgroup limit dengan benar.

#### Step 4 — Check memory composition

Di container:

```bash
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.stat
cat /sys/fs/cgroup/memory.events
```

Cari:

```text
anon
file
kernel
sock
pagetables
file_dirty
file_writeback
oom
oom_kill
```

#### Step 5 — Check JVM memory

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print | head
```

#### Step 6 — Compare

Jika:

```text
heap low
memory.current high
file high
```

curiga page cache/mmap/tmp/log/file workload.

Jika:

```text
heap low
anon high
NMT native high
```

curiga direct buffer/native/metaspace/thread.

Jika:

```text
sock high
many connections
```

curiga network buffer/backpressure.

Jika:

```text
thread count high
Thread NMT high
```

curiga thread explosion.

---

## 23. Practical Triage: Latency Spike Without OOM

### 23.1 Symptom

```text
p99 latency naik.
CPU tidak penuh.
Heap normal.
Tidak ada exception.
```

### 23.2 Check Memory Pressure

```bash
cat /proc/pressure/memory
cat /sys/fs/cgroup/memory.pressure
```

Jika `some avg10` naik saat incident:

```text
sebagian task stall karena memory pressure
```

Jika `full avg10` naik:

```text
seluruh workload sempat tidak maju
```

### 23.3 Check Reclaim

```bash
grep -E 'pgscan_direct|pgsteal_direct|pgmajfault|pswpin|pswpout' /proc/vmstat
```

Ambil dua snapshot 10 detik terpisah.

```bash
cat /proc/vmstat > /tmp/vmstat.1
sleep 10
cat /proc/vmstat > /tmp/vmstat.2
```

Bandingkan delta.

### 23.4 Check Dirty/Writeback

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
cat /proc/vmstat | grep -E 'nr_dirty|nr_writeback'
```

Jika dirty/writeback tinggi:

```text
writeback/storage mungkin menahan writer
```

### 23.5 Check Major Fault

```bash
grep pgmajfault /proc/vmstat
```

Jika major fault naik:

```text
page cache miss / swap-in / mmap miss
```

---

## 24. Memory Budgeting untuk Java Container

### 24.1 Jangan Mulai dari Heap

Mulai dari container limit dan workload profile.

Pertanyaan:

1. Apakah service high-throughput network?
2. Apakah pakai Netty/direct buffer?
3. Apakah banyak thread/platform thread?
4. Apakah pakai virtual threads tapi tetap punya banyak blocking I/O?
5. Apakah pakai mmap?
6. Apakah banyak logging?
7. Apakah ada temp file besar?
8. Apakah connection count tinggi?
9. Apakah request payload besar?
10. Apakah classpath/framework berat?
11. Apakah ada native library?
12. Apakah ada TLS handshake tinggi?
13. Apakah pod punya sidecar?
14. Apakah page cache penting untuk performance?

### 24.2 Template Budget

```text
memory.limit = L

heap                 = 0.50L - 0.70L typical start
metaspace            = measured
code cache           = measured
thread stacks        = Xss × peak platform threads
direct buffer        = workload dependent
mapped files         = workload dependent
socket buffers       = connection dependent
tmpfs/temp files     = workload dependent
page cache margin    = workload dependent
native/JNI           = measured
safety margin        = at least 10-20% for unknowns
```

### 24.3 Example: REST CRUD Service

```text
limit                = 1024MiB
heap                 = 512MiB
metaspace/code       = 128MiB
threads             = 128MiB
direct/native        = 96MiB
page cache/kernel    = 96MiB
safety               = 64MiB
```

### 24.4 Example: Netty/gRPC High-Concurrency Service

```text
limit                = 2048MiB
heap                 = 1024MiB
direct buffers       = 384MiB
metaspace/code       = 160MiB
threads             = 128MiB
socket/kernel        = 128MiB
page cache           = 96MiB
safety               = 128MiB
```

### 24.5 Example: mmap/Lucene-like Service

```text
limit                = 4096MiB
heap                 = 1536MiB
mapped/page cache    = 1536MiB
metaspace/code       = 192MiB
threads/native       = 256MiB
kernel/socket        = 128MiB
safety               = 448MiB
```

Untuk mmap-heavy workload, heap terlalu besar bisa merusak performa karena menekan page cache.

---

## 25. Common Misdiagnoses

### 25.1 “RAM used tinggi berarti leak”

Belum tentu.

Mungkin page cache.

Validasi:

```bash
free -h
cat /proc/meminfo
cat /sys/fs/cgroup/memory.stat
```

### 25.2 “Heap normal berarti memory aman”

Salah.

Process/cgroup memory bisa tinggi karena:

- direct buffer
- thread stack
- metaspace
- code cache
- page cache
- mmap
- socket buffer
- native allocation

### 25.3 “OOMKilled berarti Java heap leak”

Belum tentu.

OOMKilled berarti kernel/cgroup membunuh proses karena memory limit/pressure.

### 25.4 “Naikkan Xmx untuk mengatasi OOMKilled”

Sering salah.

Jika OOM berasal dari total cgroup memory, menaikkan `-Xmx` justru mengurangi ruang native/page cache.

### 25.5 “Disable swap selalu benar”

Tidak universal.

Untuk latency-sensitive services mungkin benar dalam banyak deployment, tetapi swap juga bisa menjadi safety valve. Yang penting adalah memahami trade-off.

### 25.6 “Page cache gratis”

Tidak di cgroup-constrained environment.

Page cache bisa masuk memory usage cgroup.

### 25.7 “RSS sama dengan memory leak”

RSS perlu dipecah:

```text
anonymous?
file-backed?
shared?
private?
dirty?
clean?
```

Gunakan:

```bash
cat /proc/<pid>/smaps_rollup
```

---

## 26. Command Cheat Sheet

### 26.1 Host Memory

```bash
free -h
cat /proc/meminfo
vmstat 1
cat /proc/vmstat
cat /proc/pressure/memory
dmesg -T | grep -i -E 'oom|killed process|out of memory'
journalctl -k | grep -i oom
```

### 26.2 Process Memory

```bash
cat /proc/<pid>/status
cat /proc/<pid>/smaps_rollup
cat /proc/<pid>/maps
cat /proc/<pid>/oom_score
cat /proc/<pid>/oom_score_adj
pmap -x <pid>
```

### 26.3 JVM Memory

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
jcmd <pid> VM.flags
jcmd <pid> VM.info
jcmd <pid> Thread.print
java -XshowSettings:system -version
```

### 26.4 cgroup v2 Memory

```bash
cat /proc/self/cgroup
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.high
cat /sys/fs/cgroup/memory.events
cat /sys/fs/cgroup/memory.stat
cat /sys/fs/cgroup/memory.pressure
cat /sys/fs/cgroup/memory.swap.current
cat /sys/fs/cgroup/memory.swap.max
```

### 26.5 Socket Memory

```bash
ss -m
cat /proc/net/sockstat
cat /sys/fs/cgroup/memory.stat | grep sock
```

### 26.6 Dirty/Writeback

```bash
grep -E 'Dirty|Writeback' /proc/meminfo
cat /proc/vmstat | grep -E 'nr_dirty|nr_writeback'
```

---

## 27. Lab 1 — Melihat Page Cache

### 27.1 Buat File Besar

```bash
dd if=/dev/zero of=/tmp/bigfile.bin bs=64M count=16
sync
```

### 27.2 Lihat Memory

```bash
free -h
grep -E 'Cached|MemAvailable|Dirty|Writeback' /proc/meminfo
```

### 27.3 Baca File

```bash
time cat /tmp/bigfile.bin > /dev/null
time cat /tmp/bigfile.bin > /dev/null
```

Ekspektasi:

- pembacaan kedua bisa lebih cepat
- `Cached` bisa naik
- `MemFree` bisa turun
- `MemAvailable` belum tentu turun sebanyak itu

### 27.4 Lesson

Page cache membuat filesystem cepat tetapi memakai RAM.

---

## 28. Lab 2 — Dirty Page dan Writeback

Jalankan di environment aman.

```bash
dd if=/dev/zero of=/tmp/write-test.bin bs=16M count=64 oflag=direct
```

Lalu bandingkan dengan buffered write:

```bash
dd if=/dev/zero of=/tmp/write-test-buffered.bin bs=16M count=64
```

Amati:

```bash
watch -n 1 "grep -E 'Dirty|Writeback' /proc/meminfo"
```

Lesson:

```text
write() selesai tidak selalu berarti data durable.
dirty page dapat menumpuk sebelum writeback.
```

---

## 29. Lab 3 — Membaca JVM Memory dari Banyak Sudut

Jalankan aplikasi Java sederhana.

```bash
java -XX:NativeMemoryTracking=summary -Xms256m -Xmx256m -version
```

Untuk aplikasi long-running:

```bash
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
cat /proc/<pid>/status | grep -E 'VmRSS|VmSize|Threads'
cat /proc/<pid>/smaps_rollup
```

Bandingkan:

```text
heap dari JVM
RSS dari kernel
native memory dari NMT
```

Lesson:

```text
Tidak ada satu angka memory yang menjelaskan semua hal.
```

---

## 30. Lab 4 — cgroup Memory di Container

Jalankan container dengan limit kecil.

```bash
docker run --rm -it --memory=512m eclipse-temurin:21 bash
```

Di dalam container:

```bash
cat /proc/self/cgroup
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/memory.current
cat /sys/fs/cgroup/memory.stat
java -XshowSettings:system -version
```

Lesson:

```text
JVM modern harus membaca cgroup limit.
cgroup memory usage lebih luas dari heap.
```

---

## 31. Production Runbook: Memory Incident

### 31.1 Jika Pod OOMKilled

Kumpulkan:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl top pod <pod>
kubectl get pod <pod> -o yaml
```

Jika punya node access:

```bash
journalctl -k | grep -i oom
dmesg -T | grep -i oom
```

Dalam container sebelum mati, idealnya observability sudah mengekspor:

- heap usage
- non-heap usage
- direct buffer usage
- thread count
- process RSS
- cgroup memory.current
- memory.stat anon/file/sock/kernel
- memory.events
- PSI memory

### 31.2 Jika Latency Spike

Cek:

```bash
cat /proc/pressure/memory
cat /sys/fs/cgroup/memory.pressure
vmstat 1
grep -E 'Dirty|Writeback|MemAvailable' /proc/meminfo
cat /proc/vmstat | grep -E 'pgmajfault|pgscan_direct|pswpin|pswpout'
```

Interpretasi:

```text
memory PSI naik
    → tasks stalled

pgscan_direct naik
    → direct reclaim

pgmajfault naik
    → disk/swap-backed page fault

pswpin/pswpout naik
    → swap active

Dirty/Writeback tinggi
    → writeback pressure
```

### 31.3 Jika RSS Tinggi tapi Heap Normal

Cek:

```bash
cat /proc/<pid>/smaps_rollup
jcmd <pid> VM.native_memory summary
cat /sys/fs/cgroup/memory.stat
```

Kemungkinan:

- direct buffer
- metaspace
- thread stack
- mmap
- page cache
- native library
- socket buffer

---

## 32. Design Guidelines

### 32.1 Heap Sizing

Jangan gunakan prinsip:

```text
heap sebesar mungkin
```

Gunakan prinsip:

```text
heap cukup untuk live set + allocation rate + GC target,
tetapi masih menyisakan ruang untuk native memory, page cache, kernel, dan safety margin.
```

### 32.2 Memory Limit

Container memory limit harus mencakup:

```text
heap
+ non-heap
+ direct
+ thread
+ native
+ page cache
+ kernel/socket
+ temp/tmpfs
+ sidecar if same pod separately handled
+ safety margin
```

### 32.3 Backpressure

Memory pressure sering berasal dari queue/buffer tidak terkendali.

Batasi:

- request body size
- response buffering
- executor queue
- connection pool queue
- Netty pending writes
- upload temp files
- batch size
- in-memory cache
- retry buffer
- async event queue

### 32.4 Prefer Streaming

Untuk payload besar:

```text
streaming > load all into memory
```

Tapi streaming pun tetap butuh:

- buffer
- file descriptor
- socket memory
- backpressure

### 32.5 Observability Harus Multi-Layer

Expose:

- JVM heap
- JVM non-heap
- direct buffer
- thread count
- GC pause
- process RSS
- cgroup memory
- cgroup OOM events
- memory PSI
- page faults
- socket count
- temp file usage

---

## 33. Senior-Level Reasoning Questions

### Question 1

Pod Java dengan limit 1GiB, `-Xmx512m`, heap usage 300MiB, tetapi OOMKilled. Apa hipotesis?

Jawaban yang baik mencakup:

- direct buffer
- metaspace/code cache
- thread stacks
- native allocation
- page cache charged to cgroup
- tmpfs file
- mmap
- socket buffer
- side effect of cgroup memory accounting
- need `memory.stat`, NMT, smaps, memory.events

### Question 2

`free -h` menunjukkan free memory rendah, tetapi `MemAvailable` tinggi. Apakah bahaya?

Jawaban:

- belum tentu
- page cache mungkin besar
- lihat pressure, swap, reclaim, available, workload latency
- free rendah normal di Linux

### Question 3

Kenapa menaikkan `-Xmx` bisa memperburuk OOMKilled?

Jawaban:

- `-Xmx` hanya heap
- container limit fixed
- heap lebih besar mengurangi ruang native/page cache/kernel
- cgroup OOM berdasarkan total charged memory
- native/page cache pressure meningkat

### Question 4

Latency spike, CPU rendah, GC normal. Memory-related signal apa yang dicek?

Jawaban:

- memory PSI
- direct reclaim counters
- major faults
- swap in/out
- dirty/writeback
- cgroup memory.high/max events
- `smaps_rollup`
- `memory.stat`

### Question 5

Apa bedanya Java `OutOfMemoryError` dan OOMKilled?

Jawaban:

- OOME dilempar oleh JVM saat allocation tertentu gagal atau policy JVM mendeteksi limit
- OOMKilled adalah kernel/cgroup membunuh process
- OOMKilled sering tidak menghasilkan Java stack trace/heap dump
- debugging layer berbeda

---

## 34. Invariant Penting

1. Linux memakai RAM kosong untuk cache; `free` rendah tidak otomatis buruk.
2. `MemAvailable` lebih berguna daripada `MemFree` untuk triage umum.
3. Page cache bisa menjadi bagian dari memory pressure, terutama dalam cgroup.
4. Anonymous memory lebih sulit direclaim daripada clean file cache.
5. Dirty page harus ditulis dulu sebelum bisa direclaim.
6. Swap bisa mencegah kill tetapi dapat merusak latency.
7. `-Xmx` bukan total memory JVM.
8. RSS bukan heap.
9. Container memory limit mencakup lebih banyak daripada Java heap.
10. OOMKilled bukan sinonim heap leak.
11. Direct reclaim dapat menaikkan p99 tanpa menaikkan CPU.
12. PSI mengukur stall, bukan usage.
13. Untuk Java production, memory budget harus mencakup heap, non-heap, native, direct, thread, page cache, socket, kernel, dan safety margin.
14. Memory incident harus dianalisis dari JVM dan kernel/cgroup sekaligus.

---

## 35. Referensi

Referensi berikut berguna untuk pendalaman:

1. Linux Kernel Documentation — Memory Management  
   <https://docs.kernel.org/admin-guide/mm/index.html>

2. Linux Kernel Documentation — cgroup v2  
   <https://docs.kernel.org/admin-guide/cgroup-v2.html>

3. Linux man-pages — `proc(5)`  
   <https://man7.org/linux/man-pages/man5/proc.5.html>

4. Linux man-pages — `proc_meminfo(5)`  
   <https://man7.org/linux/man-pages/man5/proc_meminfo.5.html>

5. Linux man-pages — `cgroups(7)`  
   <https://man7.org/linux/man-pages/man7/cgroups.7.html>

6. Linux Kernel Documentation — Pressure Stall Information  
   <https://docs.kernel.org/accounting/psi.html>

7. Kubernetes Documentation — Understand Pressure Stall Information Metrics  
   <https://kubernetes.io/docs/reference/instrumentation/understand-psi-metrics/>

8. Red Hat Developer — OpenJDK Container Awareness  
   <https://developers.redhat.com/articles/2022/04/19/java-17-whats-new-openjdks-container-awareness>

9. OpenJDK / HotSpot Native Memory Tracking documentation  
   <https://docs.oracle.com/javase/8/docs/technotes/guides/vm/nmt-8.html>

10. Linux Kernel Documentation — Memory Resource Controller  
    <https://docs.kernel.org/admin-guide/cgroup-v1/memory.html>

---

## 36. Ringkasan Akhir

Part ini membangun mental model bahwa memory Linux adalah sistem dinamis, bukan angka tunggal.

Untuk Java engineer, insight paling penting adalah:

```text
JVM hidup di dalam process Linux.
Process Linux hidup di dalam cgroup/container.
cgroup hidup di atas kernel memory manager.
Kernel memory manager mengelola RAM bersama page cache, anonymous memory, swap, reclaim, socket buffer, kernel object, dan filesystem writeback.
```

Maka, debugging memory tidak cukup dengan:

```text
lihat heap usage
```

Harus melihat:

```text
heap
native
direct buffer
thread stack
RSS
smaps
page cache
dirty/writeback
swap
cgroup memory.stat
cgroup memory.events
PSI
OOM logs
```

Jika kamu memahami ini, kamu bisa membedakan:

```text
heap leak
native leak
direct buffer pressure
thread explosion
page cache pressure
tmpfs usage
mmap working set issue
socket buffer buildup
writeback pressure
cgroup OOM
host OOM
```

Itulah perbedaan antara engineer yang hanya menaikkan memory limit dan engineer yang benar-benar memahami runtime Linux.

---

# Status Seri

Belum selesai.

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-011.md
Part 011 — CPU Scheduling I: How Linux Decides What Runs
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — Memory Model I: Virtual Memory and Address Space</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-011.md">Part 011 — CPU Scheduling I: How Linux Decides What Runs ➡️</a>
</div>
