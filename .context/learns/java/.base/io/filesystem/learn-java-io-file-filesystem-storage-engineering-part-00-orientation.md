# learn-java-io-file-filesystem-storage-engineering — Part 00 — Orientation

> **Tema:** Mental Model File, Path, Filesystem, dan Storage Boundary  
> **Target:** Java 8 hingga Java 25  
> **Level:** Advanced / production engineering / top 1% software engineer mindset  
> **Fokus:** memahami file bukan sebagai “string path + byte stream”, tetapi sebagai kontrak kompleks antara Java API, provider, OS, filesystem, storage, container/runtime, dan proses lain.

---

## 0. Tujuan Part Ini

Di seri sebelumnya, kita sudah membahas banyak fondasi Java: language, data type, collections, concurrency, reliability, NIO/networking/data transfer, security, JDBC, Jakarta stack, testing, JVM, memory, dan lain-lain.

Part ini membuka seri baru yang lebih spesifik:

```text
Java IO File / Filesystem / Storage Engineering
```

Yang ingin kita kuasai bukan hanya:

```java
Files.readString(path);
Files.writeString(path, data);
```

Tetapi pertanyaan engineering yang jauh lebih dalam:

- Apa sebenarnya arti “file exists”?
- Apakah `Path` berarti file benar-benar ada?
- Apakah `Files.write(...)` berarti data sudah aman di disk?
- Apakah rename selalu atomic?
- Apakah delete selalu langsung menghapus byte dari storage?
- Apakah symbolic link aman diikuti?
- Apakah file watcher bisa dianggap sumber kebenaran?
- Apakah locking file aman untuk distributed system?
- Apakah filesystem lokal, NFS, EFS, SMB, container volume, dan ZIP filesystem punya semantik yang sama?
- Bagaimana mendesain workflow file yang tahan crash, retry, race condition, disk full, permission issue, dan concurrent process?

Seorang engineer biasa melihat file sebagai “lokasi data”.

Engineer yang kuat melihat file sebagai **boundary stateful** antara:

```text
application logic
  ↕
Java API
  ↕
FileSystemProvider
  ↕
OS syscall / kernel VFS
  ↕
filesystem implementation
  ↕
storage device / network storage / virtual storage
  ↕
crash, concurrency, permissions, cache, metadata, and external mutation
```

Mental model inilah yang membedakan kode file sederhana dari kode file yang layak production.

---

## 1. Apa Yang Tidak Akan Diulang dari Seri Lama

Agar belajar efisien, seri ini tidak akan mengulang detail yang sudah masuk seri lain, kecuali saat benar-benar diperlukan untuk file/filesystem correctness.

Tidak akan diulang secara panjang:

- dasar `InputStream` / `OutputStream`
- dasar `Reader` / `Writer`
- socket, HTTP, gRPC
- serialization umum
- buffer/off-heap secara umum
- concurrency primitive umum
- cryptography teori umum
- JVM benchmarking umum
- Jakarta upload/download API secara luas

Yang akan dibahas ulang hanya dari sudut file engineering, misalnya:

- stream lifecycle untuk file besar
- `FileChannel` untuk locking, random access, durability
- checksum untuk integritas file
- concurrency untuk race condition file
- memory mapping untuk workload file tertentu
- security untuk path traversal, symlink attack, dan safe extraction
- observability untuk operasi file production

---

## 2. Referensi API Resmi yang Menjadi Basis Seri

Seri ini berbasis pada API resmi Java.

Beberapa fakta penting:

1. Package `java.nio.file` mendefinisikan class dan interface agar JVM dapat mengakses file dan filesystem. Package attribute-nya ada di `java.nio.file.attribute`, sedangkan provider extension ada di `java.nio.file.spi`.  
   Referensi: Oracle Java SE 25 `java.nio.file` package documentation:  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html>

2. `Files` adalah utility class berisi static methods untuk operasi file, directory, dan tipe file lain. Dokumentasi resmi menyatakan bahwa dalam kebanyakan kasus, method di `Files` akan mendelegasikan operasi ke file system provider terkait.  
   Referensi: Oracle Java SE 25 `Files`:  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html>

3. `Path` merepresentasikan path hirarkis yang tersusun dari root dan name elements. `Path` bukan jaminan bahwa file benar-benar ada.  
   Referensi Java 8 `Path`:  
   <https://docs.oracle.com/javase/8/docs/api/java/nio/file/Path.html>  
   Referensi Java 25 `Path`:  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html>

4. Pada Java 25, dokumentasi `Paths` memberi API note bahwa lebih direkomendasikan memperoleh `Path` melalui `Path.of(...)` daripada `Paths.get(...)`, dan `Paths` mungkin dideprekasi di rilis masa depan. Ini penting untuk kompatibilitas Java 8–25 karena Java 8 belum memiliki `Path.of(...)`.  
   Referensi: Oracle Java SE 25 `Paths`:  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Paths.html>

5. `java.io.File` adalah API lama. Dokumentasi Java 25 menyatakan bahwa `java.nio.file` dapat digunakan untuk mengatasi banyak keterbatasan `java.io.File`, dan `File#toPath()` dapat digunakan untuk memperoleh `Path`.  
   Referensi: Oracle Java SE 25 `File`:  
   <https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/File.html>

6. Custom filesystem provider adalah bagian dari desain NIO. Oracle Java 8 bahkan menyediakan panduan implementasi custom file system provider dan menyebut ZIP filesystem provider sebagai contoh.  
   Referensi: Oracle Java 8 custom filesystem provider guide:  
   <https://docs.oracle.com/javase/8/docs/technotes/guides/io/fsp/filesystemprovider.html>

---

## 3. Mental Model Paling Penting: File Bukan Satu Hal

Kata “file” sering dipakai seolah-olah berarti satu object sederhana. Padahal dalam sistem nyata, “file” dapat berarti banyak hal sekaligus.

### 3.1 File Sebagai Byte Sequence

Dalam model paling sederhana, file adalah deretan byte:

```text
file = byte[0..n-1]
```

Contoh:

```text
report.pdf  -> bytes PDF
config.json -> bytes JSON
image.png   -> bytes PNG
```

Model ini berguna untuk:

- membaca isi file
- menulis isi file
- hashing/checksum
- upload/download
- compression
- encryption

Tetapi model ini tidak cukup.

Kenapa?

Karena file bukan hanya isi. File juga punya lokasi, nama, metadata, permission, owner, timestamp, link, lock, handle, dan identity.

---

### 3.2 File Sebagai Directory Entry

Di filesystem, nama file biasanya adalah entry dalam directory.

Contoh:

```text
/home/app/data/inbox/order-001.json
```

Secara konseptual:

```text
/home/app/data/inbox
  └── order-001.json -> points to some file object/inode/file record
```

Nama `order-001.json` bukan byte content-nya. Ia adalah entry yang menunjuk ke objek file tertentu.

Konsekuensi penting:

- rename sering kali berarti mengubah directory entry, bukan menyalin byte
- delete sering kali berarti menghapus directory entry, bukan langsung menghapus seluruh data fisik
- hard link berarti beberapa directory entry menunjuk ke file object yang sama
- symbolic link berarti directory entry yang isinya menunjuk ke path lain

---

### 3.3 File Sebagai Inode / File Record / File Object

Di Unix-like filesystem, konsep populer adalah **inode**. Di Windows, konsep internalnya berbeda, tetapi secara mental kita bisa anggap ada “file record/object” yang menyimpan metadata dan menunjuk ke data blocks.

Konseptual:

```text
Directory entry: /data/a.txt
        ↓
File object / inode / file record
        ↓
metadata: size, owner, permissions, timestamps
        ↓
data blocks: actual content bytes
```

Ini menjelaskan kenapa:

- file bisa punya beberapa nama lewat hard link
- file bisa tetap dibaca oleh process yang sudah membuka handle walaupun namanya sudah dihapus pada Unix-like OS
- metadata update dan content update adalah operasi berbeda
- rename tidak selalu mengubah data bytes

---

### 3.4 File Sebagai Metadata Container

File punya metadata:

- size
- last modified time
- creation time, jika filesystem/provider mendukung
- last access time, jika didukung dan aktif
- owner
- group
- permission
- ACL
- hidden flag
- readonly flag
- file key / identity, jika provider memberi
- link count, pada filesystem tertentu

Di Java NIO, metadata diakses melalui attribute API:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

long size = attrs.size();
FileTime modified = attrs.lastModifiedTime();
boolean regular = attrs.isRegularFile();
```

Mental model penting:

```text
content operation != metadata operation
```

Membaca isi file belum tentu membaca semua metadata.

Mengubah permission tidak berarti mengubah content.

Mengubah timestamp tidak berarti mengubah bytes.

---

### 3.5 File Sebagai OS Handle / File Descriptor

Saat Java membuka file, OS biasanya membuat handle/file descriptor.

Contoh:

```java
try (InputStream in = Files.newInputStream(path)) {
    // OS file handle is open here
}
```

File handle adalah resource OS.

Konsekuensi:

- kalau tidak ditutup, process bisa kehabisan file descriptor
- Windows sering mencegah delete/rename file yang sedang dibuka dengan mode tertentu
- Unix-like OS dapat mengizinkan unlink file yang masih terbuka; process yang sudah punya handle masih bisa membaca data
- file handle bisa mengacu ke object file lama walaupun path-nya sudah berubah

Ini sangat penting untuk debugging kasus:

```text
The file exists in application logic, but cannot be deleted.
```

atau:

```text
File already deleted by cleanup, but disk usage does not drop.
```

---

### 3.6 File Sebagai Java Object Reference? Tidak Tepat

Ini kesalahan umum.

`Path` bukan file.

`File` bukan file.

`Path` dan `File` adalah representasi lokasi/abstract pathname di Java.

Contoh:

```java
Path p = Paths.get("/tmp/data.txt");
```

Kode itu tidak membuat file.

Ia hanya membuat object Java yang merepresentasikan path.

File mungkin:

- belum ada
- sudah ada
- nanti dibuat
- sudah dihapus process lain
- menunjuk ke symbolic link
- berubah dari regular file menjadi directory karena race condition
- berada di filesystem yang berbeda dari yang kita asumsikan

Mental model:

```text
Path object exists in JVM memory.
The file may or may not exist in the filesystem.
```

---

## 4. Java File API Evolution: `java.io.File` ke `java.nio.file`

### 4.1 Legacy API: `java.io.File`

`java.io.File` sudah ada sejak Java lama dan masih banyak ditemukan di library.

Contoh:

```java
File file = new File("/tmp/report.txt");

if (file.exists()) {
    boolean deleted = file.delete();
}
```

Masalah umum `File`:

- banyak method mengembalikan `boolean` tanpa error detail yang kaya
- metadata support terbatas
- symbolic link handling terbatas
- traversal API kurang robust
- provider abstraction tidak sekuat NIO
- sulit membedakan berbagai failure mode

Contoh buruk:

```java
boolean ok = file.delete();

if (!ok) {
    throw new RuntimeException("Delete failed");
}
```

Kita tidak tahu gagal karena:

- file tidak ada
- permission denied
- directory tidak kosong
- file sedang dibuka
- path bukan file
- filesystem read-only
- I/O error

---

### 4.2 Modern API: `java.nio.file`

Sejak Java 7, API modern adalah `java.nio.file`.

Core types:

```text
Path
Files
FileSystem
FileSystems
FileStore
WatchService
DirectoryStream
FileVisitor
FileSystemProvider
```

Contoh:

```java
Path path = Paths.get("/tmp/report.txt");
Files.delete(path);
```

Jika gagal, biasanya exception lebih spesifik:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException e) {
    // file tidak ada
} catch (DirectoryNotEmptyException e) {
    // directory tidak kosong
} catch (AccessDeniedException e) {
    // permission / lock / policy issue
} catch (IOException e) {
    // generic I/O failure
}
```

Ini jauh lebih cocok untuk production engineering karena failure bisa diklasifikasi.

---

### 4.3 Java 8 hingga Java 25: `Paths.get` vs `Path.of`

Untuk Java 8:

```java
Path path = Paths.get("/tmp/report.txt");
```

Untuk Java 11+ dan modern Java:

```java
Path path = Path.of("/tmp/report.txt");
```

Dalam materi seri ini, kita akan memakai aturan:

```text
Jika ingin kompatibel Java 8: gunakan Paths.get(...)
Jika target Java 11/17/21/25: gunakan Path.of(...)
```

Tetapi mental model-nya sama: kita membuat `Path`, bukan membuat file.

---

## 5. Arsitektur Konseptual Java File Operation

Ketika kita menulis:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Yang terjadi secara konseptual bukan:

```text
Java magically copies file.
```

Lebih tepat:

```text
Your code
  ↓
java.nio.file.Files
  ↓
Path.getFileSystem()
  ↓
FileSystem.provider()
  ↓
FileSystemProvider.copy(...)
  ↓
OS / provider implementation
  ↓
filesystem semantics
  ↓
storage / remote service / virtual backing store
```

Artinya, behavior akhir dipengaruhi oleh:

- provider default OS
- filesystem type
- operating system
- mount option
- permission model
- file lock behavior
- symlink behavior
- container runtime
- network filesystem semantics
- disk/cache/writeback policy
- concurrent process
- crash timing

Ini kenapa API yang sama bisa punya behavior berbeda di:

```text
Linux ext4
Linux XFS
Windows NTFS
macOS APFS
Docker writable layer
Kubernetes ConfigMap volume
Kubernetes PVC
NFS
SMB
AWS EFS-like network filesystem
ZIP filesystem provider
in-memory filesystem provider
```

---

## 6. Core Types yang Harus Dikuasai

### 6.1 `Path`

`Path` adalah representasi path.

Ia bisa menunjuk ke:

- regular file
- directory
- symbolic link
- special file
- non-existing target
- provider-specific object

Contoh:

```java
Path p = Paths.get("/var/app/inbox/order-001.json");
```

Operasi `Path` sering bersifat string-ish / syntactic:

```java
p.getFileName();
p.getParent();
p.resolve("child.txt");
p.normalize();
```

Namun beberapa operasi dapat menyentuh filesystem:

```java
p.toRealPath();
```

Mental model:

```text
Path operation can be syntactic or filesystem-resolving.
Know the difference.
```

---

### 6.2 `Files`

`Files` adalah utility class untuk operasi:

- create
- delete
- copy
- move
- read
- write
- attribute
- directory traversal
- symbolic link
- temporary file
- stream/list/walk/find

Contoh:

```java
Files.createDirectories(Path.of("/var/app/data"));
Files.writeString(Path.of("/var/app/data/a.txt"), "hello");
String data = Files.readString(Path.of("/var/app/data/a.txt"));
```

Mental model:

```text
Files is facade.
The provider performs the actual operation.
```

---

### 6.3 `FileSystem`

`FileSystem` merepresentasikan filesystem.

Default filesystem:

```java
FileSystem fs = FileSystems.getDefault();
```

Dari filesystem, kita bisa mendapatkan:

```java
String separator = fs.getSeparator();
Iterable<Path> roots = fs.getRootDirectories();
Iterable<FileStore> stores = fs.getFileStores();
PathMatcher matcher = fs.getPathMatcher("glob:**/*.json");
WatchService watcher = fs.newWatchService();
```

Mental model:

```text
A Path belongs to a FileSystem.
Not all Paths are from the same filesystem/provider.
```

Ini penting karena operasi antara dua path dari provider berbeda bisa gagal atau berubah semantik.

---

### 6.4 `FileStore`

`FileStore` merepresentasikan storage/file store tempat file berada.

Contoh:

```java
FileStore store = Files.getFileStore(path);

long total = store.getTotalSpace();
long usable = store.getUsableSpace();
long unallocated = store.getUnallocatedSpace();
String type = store.type();
```

Dipakai untuk:

- disk capacity guardrail
- filesystem type insight
- operational diagnostics
- quota-ish investigation

Namun harus hati-hati:

```text
Preflight free-space check is not a guarantee.
```

Kenapa?

Karena setelah kita cek free space, process lain bisa menulis file besar.

---

### 6.5 `FileSystemProvider`

`FileSystemProvider` adalah abstraction layer yang benar-benar menjalankan operasi.

Contoh provider:

- default `file` provider
- ZIP filesystem provider
- custom provider
- in-memory provider untuk testing
- provider lain yang dibuat library

Mental model:

```text
Files.copy(a, b)
  delegates to provider associated with the Path/FileSystem.
```

Implikasi:

- tidak semua provider support semua operasi
- `ATOMIC_MOVE` bisa tidak didukung
- POSIX permissions bisa tidak ada
- file lock semantics bisa berbeda
- attribute view bisa berbeda
- watch service bisa berbeda

---

### 6.6 `java.io.File`

`File` masih penting untuk interop.

Contoh:

```java
File oldApi = new File("/tmp/a.txt");
Path path = oldApi.toPath();
File back = path.toFile();
```

Tetapi untuk desain baru, gunakan `Path` + `Files`.

Rule of thumb:

```text
New application code: Path/Files
Legacy interop only: File
```

---

## 7. Boundary Antara Java dan Realita OS

### 7.1 Java Tidak Mengontrol Semua Hal

Saat kita memanggil:

```java
Files.exists(path)
```

Java tidak punya oracle absolut. Ia bertanya ke provider/OS, dan hasilnya adalah snapshot saat itu.

Setelah method return:

- file bisa langsung dihapus process lain
- permission bisa berubah
- directory bisa diganti symlink
- disk bisa penuh
- file bisa berubah ukuran

Karena itu:

```text
File system state is externally mutable.
```

Ini salah satu invariants paling penting dalam file engineering.

---

### 7.2 Filesystem Adalah Shared Mutable State

Database biasanya punya transaction model.

Filesystem tidak selalu punya transaction model yang sama.

Banyak proses dapat melakukan:

```text
create
write
rename
delete
chmod
chown
truncate
link
unlink
mount/unmount
```

terhadap path yang sama atau directory yang sama.

Jika aplikasi kita menganggap dirinya satu-satunya actor, bug akan muncul.

Contoh race:

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Di antara `exists` dan `delete`, file bisa dihapus process lain.

Versi lebih baik:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException ignored) {
    // already absent is acceptable
}
```

Prinsip:

```text
Prefer doing the operation and handling the outcome,
not checking then assuming the condition remains true.
```

---

### 7.3 Filesystem Tidak Sama Dengan Database

Filesystem punya atomic operations tertentu, tetapi bukan full ACID database.

Contoh yang sering atomic pada filesystem lokal:

- create file dengan `CREATE_NEW`
- rename dalam filesystem yang sama
- replace via atomic move jika didukung

Tetapi tidak otomatis atomic:

- write multi-file transaction
- copy large file
- update content in-place
- recursive directory operation
- cross-filesystem move
- network filesystem operation

Mental model:

```text
Filesystem gives primitive operations.
Application must build workflow correctness.
```

---

## 8. Boundary Antara Filesystem dan Storage

### 8.1 Write Visibility vs Durability

Saat kita menulis file:

```java
Files.writeString(path, "hello");
```

Setelah method selesai, data biasanya terlihat oleh aplikasi. Tetapi apakah sudah benar-benar durable jika mesin crash mendadak?

Belum tentu.

Ada beberapa lapis:

```text
application buffer
  ↓ flush
JVM/native buffer
  ↓ write syscall
OS page cache
  ↓ writeback
filesystem journal / metadata
  ↓
storage device cache
  ↓
physical/non-volatile media
```

Perbedaan penting:

```text
visible to read != durable after crash
```

Dalam part berikutnya, kita akan membahas `SYNC`, `DSYNC`, `FileChannel.force`, temp file + atomic move, dan directory fsync concept.

---

### 8.2 Disk Full Bisa Terjadi Setelah Pre-check

Contoh:

```java
FileStore store = Files.getFileStore(path);
if (store.getUsableSpace() > requiredBytes) {
    Files.write(path, data);
}
```

Ini tidak menjamin write sukses.

Kenapa?

- process lain bisa memakai disk setelah check
- quota bisa berbeda
- metadata block juga butuh space
- compression/sparse behavior bisa berbeda
- network storage bisa berubah state

Prinsip:

```text
Capacity check is guardrail, not correctness guarantee.
Always handle ENOSPC / IOException.
```

---

### 8.3 Storage Bisa Lokal, Remote, Virtual, atau Ephemeral

Path yang sama-sama terlihat seperti file bisa backed by hal berbeda:

```text
/tmp/a.txt                 -> local ephemeral disk
/app/config/app.yaml       -> container image layer or mounted config
/data/upload.bin           -> persistent volume
/mnt/shared/report.csv     -> network filesystem
zipfs:/archive.zip!/a.txt  -> virtual ZIP filesystem
```

Semantik tiap backing store berbeda.

Contoh:

- local ext4 rename mungkin atomic dalam satu filesystem
- cross-device move bisa menjadi copy-delete
- network filesystem bisa punya latency tinggi dan cache inconsistency
- ConfigMap volume bisa read-only atau update via symlink-like mechanism
- object storage bukan filesystem walaupun ada library yang membuatnya tampak seperti filesystem

---

## 9. 10 Invariants File Engineering

Ini daftar invariants awal yang harus terus diingat sepanjang seri.

### Invariant 1 — `Path` Bukan File

```java
Path p = Path.of("/data/a.txt");
```

Tidak membuat file.

Tidak menjamin file ada.

Tidak menjamin target adalah regular file.

---

### Invariant 2 — Filesystem State Bisa Berubah Di Luar Aplikasi

Setelah check, state bisa berubah.

```java
if (Files.exists(path)) {
    // state may already be stale here
}
```

---

### Invariant 3 — Existence Check Bukan Lock

`Files.exists(path)` tidak mengunci file.

Process lain tetap bisa:

- delete
- rename
- modify
- chmod
- replace

---

### Invariant 4 — Write Success Bukan Selalu Durability Guarantee

Write completion biasanya berarti operation berhasil menurut API, tetapi crash durability perlu desain khusus.

---

### Invariant 5 — Rename/Move Semantics Bergantung Filesystem dan Option

`Files.move` bisa:

- rename cepat
- replace
- fail
- copy-delete-like jika beda filesystem
- menolak atomic move

---

### Invariant 6 — Delete Tidak Selalu Langsung Membebaskan Space

Pada Unix-like OS, file yang sudah di-unlink tetapi masih dibuka process bisa tetap memakai storage sampai handle ditutup.

---

### Invariant 7 — Directory Operation Jarang Atomic Secara Rekursif

Recursive copy/delete bukan satu operasi atomic.

Jika gagal di tengah, state partial harus ditangani.

---

### Invariant 8 — Symbolic Link Mengubah Threat Model

Jika path dapat dikontrol user atau process lain, symlink dapat dipakai untuk path traversal dan confused deputy attack.

---

### Invariant 9 — Provider Capability Tidak Seragam

Tidak semua filesystem mendukung:

- POSIX permission
- ACL
- atomic move
- symlink
- hard link
- file locking
- watch service
- creation time

---

### Invariant 10 — File Workflow Harus Idempotent dan Recoverable

Production file workflow harus tahan:

- retry
- crash
- duplicate processing
- partial write
- partial move
- partial delete
- poison file
- disk full
- permission issue
- concurrent worker

---

## 10. Anatomy of a File Operation: Dari Kode ke Disk

Ambil contoh:

```java
Path path = Path.of("/var/app/outbox/event-123.json");
Files.writeString(path, payload, StandardOpenOption.CREATE_NEW);
```

Secara mental:

```text
1. Application builds a Path
2. Files.writeString chooses provider operation
3. Provider resolves path according to filesystem rules
4. OS checks directory traversal permissions
5. OS checks create permission in parent directory
6. Filesystem creates directory entry and file object
7. Data is copied from JVM/application memory to OS/kernel path
8. OS may cache data in page cache
9. Metadata and data may be written to storage later
10. Method returns or throws exception
```

Failure bisa terjadi di banyak titik:

```text
Path invalid
Parent not found
Parent not directory
Permission denied
File already exists
Disk full
Quota exceeded
Read-only filesystem
Interrupted I/O
Provider unsupported operation
Encoding failure
Concurrent create by another process
```

Kode production harus mendesain berdasarkan failure taxonomy, bukan hanya `catch Exception`.

---

## 11. File Correctness Dimensions

Saat mendesain kode file, jangan hanya tanya “bisa jalan atau tidak”. Tanyakan dimensi correctness berikut.

### 11.1 Syntactic Correctness

Apakah path valid secara bentuk?

Contoh:

```text
/data/inbox/a.txt
C:\data\inbox\a.txt
../outside.txt
```

Pertanyaan:

- absolute atau relative?
- ada root?
- ada invalid character?
- ada `..`?
- separator portable?

---

### 11.2 Resolution Correctness

Setelah path di-resolve, target real-nya apa?

Pertanyaan:

- symbolic link diikuti atau tidak?
- path tetap di dalam base directory?
- `toRealPath` sukses?
- target berubah antara validasi dan operasi?

---

### 11.3 Type Correctness

Target harus apa?

- regular file?
- directory?
- symlink?
- tidak boleh special file?
- boleh hard link?

Contoh:

```java
if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
    throw new IllegalArgumentException("Expected regular file");
}
```

Tapi check ini tetap snapshot.

---

### 11.4 Permission Correctness

Apakah proses punya hak?

- read
- write
- execute/traverse directory
- create in parent
- delete from parent
- change owner/permission

Di Unix-like system, menghapus file butuh permission pada parent directory, bukan sekadar permission pada file.

---

### 11.5 Atomicity Correctness

Apakah operasi terlihat all-or-nothing?

Contoh:

- create new file atomic
- move within same filesystem bisa atomic jika provider mendukung
- recursive copy tidak atomic
- writing directly to final file tidak atomic dari sudut pembaca

---

### 11.6 Durability Correctness

Jika process/machine crash, apakah data tetap ada dalam kondisi valid?

Pertanyaan:

- sudah flush?
- sudah force/fsync?
- metadata directory sudah durable?
- temp file dan final rename sudah aman?

---

### 11.7 Concurrency Correctness

Bagaimana jika ada process/thread lain?

- dua writer menulis file sama
- reader membaca saat writer menulis
- cleanup menghapus saat processor membaca
- watcher event datang terlambat
- worker ganda memproses file sama

---

### 11.8 Recovery Correctness

Jika crash di tengah, bagaimana restart?

- file temp ditinggal?
- file partial dikenali?
- status bisa direkonstruksi?
- operation bisa diulang aman?
- duplikasi bisa dicegah atau dibuat idempotent?

---

### 11.9 Security Correctness

Apakah input user bisa membuat aplikasi menyentuh file di luar area yang sah?

Risiko:

- path traversal
- symlink attack
- archive extraction attack
- permission escalation
- overwriting sensitive file
- leaking original filename
- race between validation and use

---

### 11.10 Operational Correctness

Apakah workload bisa dioperasikan di production?

- metric ada?
- log cukup?
- failure classified?
- cleanup ada?
- disk full alert?
- retry policy jelas?
- quarantine folder ada?
- runbook ada?

---

## 12. Common Wrong Mental Models

### Wrong Model 1 — “Kalau `exists()` true, aman dipakai”

Salah.

`exists()` adalah snapshot.

Lebih baik:

```java
try {
    byte[] data = Files.readAllBytes(path);
} catch (NoSuchFileException e) {
    // handle absent at use time
}
```

---

### Wrong Model 2 — “Path normalize sudah aman dari traversal”

Salah.

```java
Path unsafe = base.resolve(userInput).normalize();
```

Ini hanya syntactic normalization. Symlink masih bisa membuat target keluar dari base directory.

Validasi aman membutuhkan pemahaman `toRealPath`, `NOFOLLOW_LINKS`, base directory, dan race condition.

---

### Wrong Model 3 — “Write file langsung ke final path itu cukup”

Sering salah.

Jika reader membaca saat writer belum selesai, reader bisa melihat partial content.

Lebih baik untuk banyak kasus:

```text
write temp file
validate/flush
atomic move to final location
```

---

### Wrong Model 4 — “File watcher reliable seperti queue”

Salah.

Filesystem watcher memberi event/hint, bukan durable message queue.

Harus ada reconciliation scan.

---

### Wrong Model 5 — “File lock aman untuk distributed system”

Belum tentu.

File lock behavior bergantung OS dan filesystem. Pada network filesystem, hasilnya bisa berbeda dan harus diuji.

---

### Wrong Model 6 — “Object storage bisa diperlakukan seperti filesystem”

Berbahaya.

Object storage tidak punya semantik directory/rename/lock yang sama dengan filesystem lokal.

---

## 13. API Map untuk Seri Ini

Berikut peta API yang akan sering muncul.

### 13.1 Path Construction

Java 8:

```java
Path p = Paths.get("/data/inbox/a.txt");
```

Java 11+:

```java
Path p = Path.of("/data/inbox/a.txt");
```

---

### 13.2 File Operation

```java
Files.exists(path);
Files.notExists(path);
Files.isRegularFile(path);
Files.isDirectory(path);
Files.createFile(path);
Files.createDirectories(path);
Files.delete(path);
Files.deleteIfExists(path);
Files.copy(source, target);
Files.move(source, target);
```

---

### 13.3 Read / Write

```java
Files.readAllBytes(path);
Files.readAllLines(path, StandardCharsets.UTF_8);
Files.lines(path, StandardCharsets.UTF_8);
Files.write(path, bytes);
Files.writeString(path, text); // Java 11+
```

Java 8 compatible:

```java
Files.write(path, text.getBytes(StandardCharsets.UTF_8));
String text = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
```

---

### 13.4 Attributes

```java
BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);
PosixFileAttributes posix = Files.readAttributes(path, PosixFileAttributes.class);
```

---

### 13.5 Traversal

```java
Files.list(directory);
Files.walk(directory);
Files.find(directory, maxDepth, predicate);
Files.walkFileTree(directory, visitor);
```

---

### 13.6 Channels and Locks

```java
try (FileChannel channel = FileChannel.open(path, StandardOpenOption.WRITE)) {
    FileLock lock = channel.lock();
}
```

---

### 13.7 Watch Service

```java
WatchService watcher = FileSystems.getDefault().newWatchService();
path.register(watcher, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE);
```

---

## 14. Java 8–25 Compatibility Strategy

Karena target seri ini Java 8 hingga 25, kita akan memakai pola kompatibilitas berikut.

### 14.1 Path Creation

Java 8 compatible:

```java
Path p = Paths.get("data", "inbox", "a.txt");
```

Modern Java:

```java
Path p = Path.of("data", "inbox", "a.txt");
```

Materi akan sering menyebut keduanya.

---

### 14.2 String Read/Write

Java 11+:

```java
String s = Files.readString(path, StandardCharsets.UTF_8);
Files.writeString(path, s, StandardCharsets.UTF_8);
```

Java 8:

```java
String s = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
Files.write(path, s.getBytes(StandardCharsets.UTF_8));
```

Tetapi untuk file besar, keduanya bisa salah secara memory. Kita akan bahas di part reading/writing.

---

### 14.3 API yang Stabil Sejak Java 7/8

Sebagian besar API NIO file sudah ada sejak Java 7:

- `Path`
- `Paths`
- `Files`
- `FileSystem`
- `FileSystems`
- `FileStore`
- `WatchService`
- `FileVisitor`
- `DirectoryStream`
- `FileSystemProvider`

Jadi banyak konsep berlaku dari Java 8 sampai Java 25.

---

## 15. File Workflow sebagai State Machine

Untuk engineer yang biasa berpikir arsitektur, cara paling kuat memahami file workflow adalah sebagai state machine.

Contoh sederhana file intake:

```text
RECEIVED
  ↓ validate name/path
STAGED
  ↓ write temp file
WRITTEN
  ↓ fsync/force if required
DURABLE
  ↓ atomic move
PUBLISHED
  ↓ worker claim
PROCESSING
  ↓ success/failure
DONE / QUARANTINED
```

Setiap transisi harus menjawab:

- operation apa yang dilakukan?
- apakah atomic?
- apa failure-nya?
- jika retry, aman atau tidak?
- jika crash setelah transisi, recovery bagaimana?
- apakah ada observer lain yang bisa melihat state partial?

Contoh anti-pattern:

```text
User uploads file directly to /inbox/final-name.csv
Worker scans /inbox and processes all .csv
```

Masalah:

- worker bisa membaca file saat upload belum selesai
- file partial terlihat sebagai valid
- retry upload bisa overwrite
- cleanup bisa menghapus file yang masih ditulis
- tidak ada manifest/checksum

Versi lebih baik:

```text
/inbox/.staging/upload-id.tmp
/inbox/ready/upload-id.data
/inbox/ready/upload-id.meta
/inbox/processing/upload-id.data
/inbox/done/upload-id.data
/inbox/error/upload-id.data
```

Publishing dilakukan dengan rename/atomic move jika tersedia.

---

## 16. Production Example: Config File Update

Masalah:

Aplikasi perlu menulis config file:

```text
/app/config/runtime.json
```

Naive code:

```java
Files.writeString(Path.of("/app/config/runtime.json"), json);
```

Risiko:

- crash di tengah write menghasilkan file corrupt
- reader membaca partial JSON
- disk full menghasilkan file terpotong
- permission issue tidak diklasifikasi
- tidak ada backup
- tidak ada atomic replace

Lebih baik secara konseptual:

```text
1. Write /app/config/.runtime.json.tmp-<random>
2. Flush/force data if durability matters
3. Validate JSON from temp file
4. Move temp -> runtime.json atomically if supported
5. Optionally keep backup or version
6. Cleanup stale temp files on startup
```

Ini bukan sekadar pattern. Ini state machine dengan failure handling.

---

## 17. Production Example: File-Based Integration Inbox

Banyak enterprise system masih memakai file exchange:

```text
partner drops files to shared directory
application scans and processes files
```

Naive design:

```text
/ftp/inbox/*.csv
```

Worker:

```java
try (Stream<Path> files = Files.list(inbox)) {
    files.forEach(this::process);
}
```

Masalah:

- file belum selesai ditulis partner
- nama file bisa bentrok
- duplicate delivery
- partial file
- no checksum
- no manifest
- scanner race
- worker ganda proses file sama
- delete after process gagal
- poison file diproses berulang

Better model:

```text
Partner writes to temp name
Partner publishes by rename to final name
App claims by atomic move to processing directory
App validates hash/size/manifest
App processes idempotently
App moves to done/error/quarantine
App records state externally or in durable metadata
```

Core invariant:

```text
A file becomes visible to processor only after producer publishes it.
```

---

## 18. Production Example: Export File Generation

Misalnya aplikasi membuat export:

```text
/reports/monthly/customer-report-2026-06.csv
```

Naive:

```java
Files.write(reportPath, csvBytes);
```

Masalah:

- user bisa download saat file belum selesai
- retry export bisa overwrite file lama
- concurrent export bisa bentrok
- disk full menghasilkan partial report
- no checksum
- no versioning

Better:

```text
/reports/.work/job-123/report.tmp
/reports/.work/job-123/manifest.json
/reports/published/customer-report-2026-06.csv
/reports/published/customer-report-2026-06.csv.sha256
```

Publish final hanya setelah generation sukses.

---

## 19. File Exceptions sebagai Domain Signal

Salah satu keunggulan `java.nio.file` adalah exception yang lebih informatif.

Contoh:

```java
try {
    Files.createFile(path);
} catch (FileAlreadyExistsException e) {
    // duplicate create attempt
} catch (NoSuchFileException e) {
    // parent missing or component missing depending operation
} catch (AccessDeniedException e) {
    // permission/lock/policy
} catch (IOException e) {
    // generic I/O failure
}
```

Dalam sistem matang, exception file dipetakan ke domain/operational classification:

```text
NoSuchFileException          -> missing dependency / stale path / already consumed
FileAlreadyExistsException   -> duplicate / idempotency / race
AccessDeniedException        -> permission / lock / readonly / policy
DirectoryNotEmptyException   -> cleanup conflict / concurrent writer
AtomicMoveNotSupportedException -> provider capability mismatch
FileSystemLoopException      -> symlink cycle / unsafe traversal
```

Jangan hilangkan detail error terlalu cepat.

Buruk:

```java
catch (IOException e) {
    throw new RuntimeException("File failed");
}
```

Lebih baik:

```java
catch (FileAlreadyExistsException e) {
    throw new DuplicateArtifactException(path, e);
} catch (AccessDeniedException e) {
    throw new StoragePermissionException(path, e);
} catch (IOException e) {
    throw new StorageUnavailableException(path, e);
}
```

---

## 20. Designing File Code: Pertanyaan Wajib Sebelum Coding

Sebelum menulis kode file production, jawab pertanyaan ini.

### 20.1 Path and Location

- Path dari mana asalnya?
- Apakah berasal dari user input?
- Apakah relative atau absolute?
- Base directory siapa yang menentukan?
- Apakah path harus tetap di dalam sandbox?
- Apakah symlink boleh?

### 20.2 File Type

- Target harus regular file?
- Directory boleh?
- Symlink boleh?
- Special file harus ditolak?

### 20.3 Ownership and Permissions

- User OS mana yang menjalankan proses?
- Directory parent writable?
- File permission default aman?
- Di container, UID/GID cocok dengan volume?

### 20.4 Concurrency

- Ada lebih dari satu writer?
- Ada reader saat write berlangsung?
- Ada cleanup process?
- Ada watcher?
- Ada worker multi-instance?

### 20.5 Atomicity

- Apakah pembaca boleh melihat partial file?
- Apakah publish perlu atomic?
- Apakah move dalam filesystem yang sama?
- Apa fallback jika `ATOMIC_MOVE` tidak didukung?

### 20.6 Durability

- Jika process crash, apakah file harus selamat?
- Jika machine crash, apakah file harus selamat?
- Perlu fsync/force?
- Perlu directory sync?

### 20.7 Recovery

- Apa yang terjadi dengan `.tmp` file?
- Bagaimana restart membedakan partial dan valid?
- Apakah operation idempotent?
- Apakah ada manifest/checksum?

### 20.8 Observability

- Apakah operation latency diukur?
- Apakah bytes read/write diukur?
- Apakah error diklasifikasi?
- Apakah path dilog aman tanpa leak data sensitif?
- Apakah disk free dimonitor?

---

## 21. Minimal Correctness Example: Safe-ish Write for Small Text File

Ini belum final production-grade durable write, tetapi lebih baik dari direct overwrite.

Java 11+:

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

public final class SmallTextFileWriter {

    public static void replaceText(Path target, String content) throws IOException {
        Path parent = target.toAbsolutePath().getParent();
        if (parent == null) {
            throw new IllegalArgumentException("Target must have a parent directory: " + target);
        }

        Files.createDirectories(parent);

        Path temp = parent.resolve("." + target.getFileName() + "." + UUID.randomUUID() + ".tmp");

        try {
            Files.writeString(temp, content, StandardCharsets.UTF_8);

            Files.move(
                temp,
                target,
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE
            );
        } catch (IOException | RuntimeException e) {
            try {
                Files.deleteIfExists(temp);
            } catch (IOException cleanupFailure) {
                e.addSuppressed(cleanupFailure);
            }
            throw e;
        }
    }
}
```

Java 8 compatible write line:

```java
Files.write(temp, content.getBytes(StandardCharsets.UTF_8));
```

Catatan:

- Ini memakai temp file di parent directory yang sama agar atomic move lebih mungkin didukung.
- Ini cleanup temp file jika gagal.
- Ini belum melakukan `FileChannel.force` untuk durability kuat.
- Ini belum directory fsync.
- Ini belum permission-at-create-time.
- Ini belum fallback jika `ATOMIC_MOVE` tidak didukung.

Justru ini contoh bagus: bahkan “safe write sederhana” punya banyak layer.

---

## 22. Mini Failure Matrix untuk Contoh Safe Write

| Tahap | Failure | State yang Mungkin Tersisa | Recovery |
|---|---|---|---|
| create parent | permission denied | parent tidak dibuat | report configuration/deployment error |
| write temp | disk full | temp partial | delete temp / retry after capacity fixed |
| write temp | process crash | temp partial | startup cleanup `.tmp` lama |
| move atomic | target locked | temp lengkap | retry or cleanup depending policy |
| move atomic | unsupported atomic move | temp lengkap | fallback non-atomic or fail loudly |
| after move | crash | target mungkin sudah final | verify target on startup |

Top engineer tidak hanya bertanya “kode ini bisa compile?” tetapi “state apa yang tersisa jika gagal di setiap titik?”

---

## 23. Filesystem Semantics by Environment

### 23.1 Local Development

Biasanya:

- filesystem lokal
- permission sederhana
- satu user
- sedikit concurrent process
- disk cukup
- path pendek

Ini sering membuat bug tidak terlihat.

---

### 23.2 CI/CD Environment

Kemungkinan:

- workspace ephemeral
- permission berbeda
- path panjang
- parallel test
- cleanup agresif
- filesystem case sensitivity berbeda antara runner OS

---

### 23.3 Container

Kemungkinan:

- read-only root filesystem
- writable layer ephemeral
- mounted volume beda permission
- UID/GID mismatch
- ConfigMap/Secret volume read-only
- storage quota
- restart menghapus ephemeral data

---

### 23.4 Kubernetes

Tambahan:

- multiple pod instances
- PVC shared atau non-shared
- `emptyDir` lifecycle tergantung pod
- rolling update bisa membuat versi aplikasi berbeda mengakses layout sama
- liveness restart bisa meninggalkan temp file

---

### 23.5 Network Filesystem

Kemungkinan:

- latency tinggi
- metadata cache
- lock semantics berbeda
- event watcher kurang reliable
- throughput burst/credit model
- rename/visibility caveat

---

### 23.6 Virtual Filesystem

Contoh:

- ZIP filesystem
- JRT filesystem
- in-memory filesystem
- custom provider

Kemungkinan:

- operation subset
- attribute subset
- watch tidak didukung
- path semantics berbeda

---

## 24. File vs Database vs Queue vs Object Storage

Salah satu kemampuan top engineer adalah tidak memaksakan file untuk semua masalah.

### 24.1 File Cocok Untuk

- local config
- import/export batch
- large immutable artifact
- append-only log sederhana
- interoperability dengan legacy system
- cache lokal
- report generation
- temporary staging
- human-readable operational artifact

### 24.2 Database Cocok Untuk

- queryable state
- transaction multi-entity
- consistency constraint
- concurrent update dengan isolation
- audit lifecycle
- relational relationship
- idempotency record

### 24.3 Queue/Event Stream Cocok Untuk

- durable event handoff
- consumer group
- retry/dead-letter
- ordered event processing
- asynchronous integration
- backpressure

### 24.4 Object Storage Cocok Untuk

- large blob
- distributed access
- high durability storage
- versioning/lifecycle policy
- static asset
- backup/archive

### 24.5 Anti-pattern

```text
Using filesystem as a database without transaction, index, locking, compaction, recovery, or observability.
```

Boleh membangun storage engine di atas file, tetapi harus sadar bahwa kita sedang membangun mini-database semantics.

---

## 25. Top 1% Mental Model: Files Are Protocols with Failure Semantics

Cara paling kuat melihat filesystem:

```text
Filesystem is not just storage.
It is a protocol between processes over names, bytes, metadata, ordering, visibility, and failure.
```

Setiap operasi file adalah message ke sistem yang lebih bawah:

```text
create this name if absent
open this object for reading
write these bytes at this offset
rename this entry
remove this directory entry
list children now
return metadata snapshot
notify me if something changes
```

Dan setiap message punya:

- precondition
- effect
- atomicity level
- visibility semantics
- durability semantics
- permission requirement
- provider support requirement
- failure mode
- race window

Top engineer berpikir dalam bentuk kontrak ini.

---

## 26. Peta Pembelajaran Setelah Part 0

Setelah memahami orientasi ini, seri akan masuk semakin detail:

```text
Part 01  Path Semantics
Part 02  File Existence, Type, Identity
Part 03  File Creation
Part 04  Open Options and File Handles
Part 05  Reading Files Correctly
Part 06  Writing Files Correctly
Part 07  Atomic Update Pattern
...
Part 35  Final Review
```

Part 0 adalah fondasi berpikir. Part berikutnya mulai membedah `Path` secara presisi.

---

## 27. Checklist Pemahaman Part 0

Pastikan bisa menjawab ini sebelum lanjut:

1. Apa bedanya `Path` object dan file aktual?
2. Kenapa `Files.exists` tidak boleh dipakai sebagai jaminan sebelum operasi?
3. Apa peran `FileSystemProvider` dalam operasi `Files`?
4. Kenapa `Files.write` belum tentu berarti data durable setelah crash?
5. Kenapa recursive delete/copy tidak atomic?
6. Kenapa symlink mengubah threat model?
7. Kenapa behavior file operation bisa berbeda antara Linux, Windows, container, network filesystem, dan ZIP filesystem?
8. Kapan memilih file, database, queue, atau object storage?
9. Apa saja dimensi correctness dalam file workflow?
10. Kenapa file workflow production sebaiknya dipikirkan sebagai state machine?

---

## 28. Latihan Mental Model

### Latihan 1 — Path Tidak Sama Dengan File

Apa output konseptual kode ini?

```java
Path p = Paths.get("/tmp/not-yet-created.txt");
System.out.println(p.getFileName());
```

Jawaban:

Kode bisa mencetak `not-yet-created.txt` walaupun file tidak ada, karena `getFileName()` adalah operasi pada representasi path.

---

### Latihan 2 — Race Condition

Apa masalah kode ini?

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Jawaban:

File bisa dihapus process lain setelah `exists` tetapi sebelum `delete`, sehingga `delete` tetap bisa melempar `NoSuchFileException`. Lebih baik lakukan operasi dan tangani hasilnya.

---

### Latihan 3 — Partial Read

Sebuah producer menulis langsung ke:

```text
/inbox/order-001.json
```

Consumer scan `/inbox/*.json` setiap 1 detik.

Apa bug yang mungkin terjadi?

Jawaban:

Consumer bisa membaca file saat producer belum selesai menulis. Solusi umum: producer tulis ke temp/staging path lalu publish final via rename/atomic move.

---

### Latihan 4 — Provider Capability

Kenapa kode ini bisa gagal di filesystem tertentu?

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

Jawaban:

Provider/filesystem bisa tidak mendukung atomic move, terutama jika source dan target berada di filesystem berbeda atau provider tidak punya capability tersebut. Kode harus siap menerima `AtomicMoveNotSupportedException`.

---

### Latihan 5 — Durability

Kenapa ini belum tentu cukup untuk data penting?

```java
Files.write(path, bytes);
```

Jawaban:

Data bisa sudah visible tetapi masih berada di OS page cache atau belum sepenuhnya committed ke storage durable. Untuk crash consistency yang kuat, perlu desain tambahan seperti force/fsync, temp file, atomic move, dan metadata sync sesuai kebutuhan.

---

## 29. Ringkasan

Part 0 membangun fondasi:

```text
File is not just bytes.
Path is not file.
Files is facade.
Provider executes.
OS/filesystem decide semantics.
Storage decides durability behavior.
External processes can mutate state.
Production file workflow must handle race, partial state, permission, durability, security, and recovery.
```

Jika hanya menghafal API, kita akan bisa membuat kode yang jalan di laptop.

Jika memahami mental model ini, kita bisa mendesain file workflow yang bertahan di production.

---

## 30. Status Seri

Seri **belum selesai**.

Kita baru menyelesaikan:

```text
Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
```

Berikutnya:

```text
Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-reliability-part-030.md](../../error_handling/learn-java-reliability-part-030.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering-part-01-path-semantics](./learn-java-io-file-filesystem-storage-engineering-part-01-path-semantics.md)
