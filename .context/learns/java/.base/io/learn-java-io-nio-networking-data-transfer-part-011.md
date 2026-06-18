# Part 011 — NIO.2 File API: `Path`, `Files`, `FileSystem`, dan Modern File Operations

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-011.md`  
> Level: Advanced  
> Prasyarat: Part 000–010, terutama mental model I/O, stream/channel/buffer, `FileChannel`, dan memory-mapped file.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas area low-level I/O:

- byte vs character,
- `InputStream` / `OutputStream`,
- `Reader` / `Writer`,
- buffering,
- binary framing,
- NIO buffer/channel,
- `ByteBuffer`,
- `FileChannel`,
- memory-mapped file.

Sekarang kita masuk ke API modern untuk operasi file dan filesystem: **NIO.2**, terutama package:

```java
java.nio.file
```

NIO.2 bukan pengganti total `java.io` dalam arti semua API lama hilang. NIO.2 adalah model yang lebih modern, lebih eksplisit, lebih composable, dan lebih cocok untuk aplikasi production yang harus berinteraksi dengan filesystem secara aman dan portable.

Dokumentasi resmi Java menjelaskan bahwa `java.nio.file` mendefinisikan class untuk mengakses file dan filesystem. API attribute berada di `java.nio.file.attribute`, sedangkan extension provider berada di `java.nio.file.spi`.

Referensi resmi:

- Java SE 25 `java.nio.file` package summary: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html
- Java SE 25 `Files`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html
- Java SE 25 `Path`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html
- Java SE 25 `FileSystem`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/FileSystem.html
- Java SE 25 `FileSystems`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/FileSystems.html
- Java SE 25 `FileSystemProvider`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/spi/FileSystemProvider.html

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Memahami kenapa `Path` lebih tepat daripada `String` atau `File` untuk merepresentasikan lokasi file.
2. Membedakan **path string**, **path object**, **filesystem object**, dan **actual file**.
3. Menggunakan `Files` untuk operasi file modern secara benar.
4. Memahami perbedaan `Path.of`, `Paths.get`, `File`, `FileSystem`, dan `FileSystemProvider`.
5. Membedakan operasi yang hanya manipulasi path secara lexical vs operasi yang menyentuh filesystem nyata.
6. Menghindari bug umum pada `Files.exists`, relative path, symbolic link, cross-platform path, dan race condition.
7. Mendesain operasi file yang production-grade: predictable, observable, portable, secure, dan failure-aware.
8. Menyiapkan fondasi untuk part berikutnya: file attributes, permission, traversal, atomic write, dan file watcher.

---

## 2. Mental Model: File API Bukan Sekadar “Path String”

Banyak bug file handling muncul karena developer mencampuradukkan empat hal ini:

```text
1. String path
2. Path object
3. FileSystem
4. Actual file/directory/device/link di storage
```

Contoh:

```java
String s = "data/report.csv";
Path p = Path.of(s);
boolean exists = Files.exists(p);
```

Kelihatannya sederhana, tetapi ada banyak lapisan:

```text
String            : representasi text yang manusia tulis
Path              : object Java yang memahami aturan filesystem tertentu
FileSystem        : sistem aturan path, separator, root, provider, lookup
Actual file       : entry nyata di filesystem, bisa ada/tidak ada/berubah
```

`Path.of("data/report.csv")` belum membaca disk. Itu hanya membentuk object path.

`Files.exists(p)` baru melakukan operasi yang menyentuh filesystem.

`p.normalize()` juga belum membaca disk. Ia hanya merapikan path secara lexical.

`p.toRealPath()` membaca filesystem nyata, menyelesaikan symbolic link, dan gagal kalau file tidak ada.

Inilah perbedaan besar:

```text
Lexical path operation  : manipulasi nama/path tanpa cek storage nyata
Filesystem operation    : query/ubah kondisi storage nyata
```

Contoh lexical:

```java
Path p = Path.of("/app/data/../logs/app.log");
Path normalized = p.normalize();
System.out.println(normalized); // /app/logs/app.log
```

Contoh filesystem operation:

```java
Path real = p.toRealPath();
```

`toRealPath()` bisa throw `IOException` karena ia butuh filesystem nyata.

---

## 3. Evolusi dari `java.io.File` ke NIO.2

Sebelum Java 7, operasi file banyak memakai:

```java
java.io.File
```

Contoh:

```java
File file = new File("data/input.txt");
boolean ok = file.exists();
```

Masalahnya, `File` punya beberapa keterbatasan desain:

1. Banyak method mengembalikan `boolean`, bukan exception detail.
2. Error reason sering hilang.
3. Kurang eksplisit terhadap symbolic link, attribute, provider, dan filesystem non-default.
4. Tidak cukup kuat untuk operasi modern seperti walk tree, watch service, atomic move, attribute view, custom provider.

NIO.2 memperkenalkan:

```java
Path
Files
FileSystem
FileSystems
FileStore
FileSystemProvider
WatchService
FileVisitor
```

Secara desain:

```text
java.io.File  = legacy object yang mencampur path + beberapa operasi file
Path          = representasi path modern
Files         = static utility untuk operasi file/directory/link
FileSystem    = model filesystem
Provider      = backend implementasi filesystem
```

Konversi:

```java
File file = new File("data/input.txt");
Path path = file.toPath();
File back = path.toFile();
```

Namun jangan berpikir `Path` hanya “File versi baru”. `Path` jauh lebih composable karena ia terikat pada `FileSystem`.

---

## 4. Core Abstraction NIO.2

### 4.1 `Path`

`Path` merepresentasikan lokasi dalam filesystem.

Contoh:

```java
Path path = Path.of("data", "reports", "daily.csv");
```

Path bisa menunjuk ke:

- file biasa,
- directory,
- symbolic link,
- device file,
- socket file,
- named pipe,
- entry yang belum ada,
- path invalid secara filesystem tertentu,
- path dalam ZIP filesystem,
- path dari custom provider.

Penting:

```text
Path tidak menjamin targetnya ada.
```

Path adalah **address**, bukan benda fisiknya.

Analogi:

```text
Path      = alamat
File      = rumah/toko/bangunan nyata di alamat itu
Files API = petugas yang mengecek/mengubah keadaan di alamat itu
```

### 4.2 `Files`

`Files` adalah class utility berisi static methods untuk operasi file.

Contoh:

```java
byte[] bytes = Files.readAllBytes(Path.of("data/input.bin"));
Files.writeString(Path.of("data/output.txt"), "hello");
Files.copy(source, target);
Files.move(source, target);
Files.delete(path);
```

`Files` bukan object stateful. Ia delegate operasi ke provider filesystem yang terkait dengan `Path`.

Mental model:

```text
Path p         -> tahu FileSystem-nya
Files.method(p)-> memanggil provider dari FileSystem tersebut
Provider       -> melakukan operasi aktual
```

### 4.3 `FileSystem`

`FileSystem` merepresentasikan satu filesystem.

Default filesystem:

```java
FileSystem fs = FileSystems.getDefault();
```

Dari filesystem kita bisa mendapatkan:

```java
Path p = fs.getPath("data", "input.txt");
```

`FileSystem` punya konsep:

- root directories,
- separator,
- file stores,
- supported attribute views,
- path matcher,
- watch service,
- provider.

### 4.4 `FileSystems`

`FileSystems` adalah factory/utility untuk mendapatkan filesystem.

Contoh default:

```java
FileSystem defaultFs = FileSystems.getDefault();
```

Contoh filesystem dari URI:

```java
URI uri = URI.create("jar:file:/tmp/archive.zip");
try (FileSystem zipFs = FileSystems.newFileSystem(uri, Map.of())) {
    Path insideZip = zipFs.getPath("/data/input.txt");
}
```

NIO.2 memungkinkan konsep filesystem tidak hanya disk lokal.

Contoh provider:

```text
file: default local filesystem
jar : ZIP/JAR filesystem
custom: bisa dibuat oleh library/provider lain
```

### 4.5 `FileStore`

`FileStore` merepresentasikan storage backing tertentu.

Contoh:

```java
Path path = Path.of("/app/data");
FileStore store = Files.getFileStore(path);
System.out.println(store.getTotalSpace());
System.out.println(store.getUsableSpace());
```

Gunanya:

- cek kapasitas disk,
- memahami mount point,
- cek attribute view support,
- observability storage.

### 4.6 `FileSystemProvider`

`FileSystemProvider` adalah extension point. Ia yang benar-benar mengeksekusi operasi.

Biasanya aplikasi business tidak langsung memanggil provider, tetapi penting memahami keberadaannya karena:

1. `Files` mendelegasikan operasi ke provider.
2. Behavior bisa berbeda antar provider.
3. ZIP filesystem, cloud filesystem, in-memory filesystem, atau custom virtual filesystem bisa punya semantics berbeda dari filesystem lokal.
4. Testing bisa menggunakan provider alternatif.

---

## 5. `Path.of` vs `Paths.get`

### 5.1 Modern style: `Path.of`

Sejak Java 11, style yang lebih modern adalah:

```java
Path path = Path.of("data", "input.txt");
```

`Path.of` adalah static factory pada interface `Path`.

### 5.2 Legacy/common style: `Paths.get`

Sebelumnya umum memakai:

```java
Path path = Paths.get("data", "input.txt");
```

Keduanya masih valid. Untuk code modern, `Path.of` lebih ringkas dan langsung.

Rekomendasi:

```text
Gunakan Path.of untuk code baru.
Gunakan Paths.get saat maintain code lama atau style codebase memang begitu.
```

### 5.3 Jangan hardcode separator

Buruk:

```java
Path p = Path.of("data/reports/daily.csv");
```

Masih sering bekerja, tetapi tidak ideal untuk path yang dibangun programmatically.

Lebih baik:

```java
Path p = Path.of("data", "reports", "daily.csv");
```

Kenapa?

Karena separator filesystem tidak selalu `/`.

```text
Unix-like : /
Windows   : \
```

Namun ingat: Java sering menerima `/` di Windows juga, tetapi jangan bergantung pada toleransi tersebut untuk semua konteks.

---

## 6. Path Anatomy: Root, Name Element, Parent, File Name

Contoh Unix-like:

```java
Path p = Path.of("/var/log/app/server.log");
```

Struktur:

```text
root      : /
name[0]   : var
name[1]   : log
name[2]   : app
name[3]   : server.log
parent    : /var/log/app
fileName  : server.log
```

Kode:

```java
Path p = Path.of("/var/log/app/server.log");

System.out.println(p.getRoot());      // /
System.out.println(p.getParent());    // /var/log/app
System.out.println(p.getFileName());  // server.log
System.out.println(p.getNameCount()); // 4

for (Path element : p) {
    System.out.println(element);
}
```

Contoh relative path:

```java
Path p = Path.of("data/reports/daily.csv");
```

Kemungkinan:

```text
root      : null
parent    : data/reports
fileName  : daily.csv
```

Path relative tidak punya root.

---

## 7. Absolute vs Relative Path

### 7.1 Relative path

```java
Path p = Path.of("data/input.txt");
```

Relative terhadap apa?

Biasanya terhadap current working directory process:

```java
System.getProperty("user.dir")
```

Contoh:

```java
System.out.println(System.getProperty("user.dir"));
```

Masalah production:

```text
Di IDE             : mungkin project root
Di unit test        : mungkin module root
Di packaged app     : mungkin directory tempat command dijalankan
Di Docker container : mungkin WORKDIR
Di service manager  : bisa berbeda
Di batch job        : bisa berbeda
```

Jangan mengandalkan relative path tanpa explicit base directory.

Buruk:

```java
Path input = Path.of("input/data.csv");
```

Lebih baik:

```java
Path baseDir = Path.of(System.getenv("APP_DATA_DIR"));
Path input = baseDir.resolve("input/data.csv");
```

Lebih baik lagi:

```java
Path baseDir = Path.of(System.getenv("APP_DATA_DIR")).toAbsolutePath().normalize();
Path input = baseDir.resolve("input").resolve("data.csv").normalize();
```

### 7.2 Absolute path

```java
Path p = Path.of("/app/data/input.csv");
```

Absolute path punya root.

Cek:

```java
if (p.isAbsolute()) {
    System.out.println("absolute");
}
```

### 7.3 `toAbsolutePath()`

```java
Path p = Path.of("data/input.csv");
Path abs = p.toAbsolutePath();
```

Penting:

```text
toAbsolutePath() tidak sama dengan toRealPath().
```

`toAbsolutePath()` biasanya hanya menggabungkan current working directory dengan path relative.

Ia belum tentu cek file ada.

### 7.4 `toRealPath()`

```java
Path real = p.toRealPath();
```

`toRealPath()`:

- menyentuh filesystem,
- membutuhkan file ada,
- menyelesaikan symbolic link secara default,
- bisa throw `IOException`,
- berguna untuk security validation.

Contoh:

```java
Path configured = Path.of("data/../data/input.csv");
Path real = configured.toRealPath();
```

---

## 8. Lexical Operation vs Filesystem Operation

Ini salah satu mental model paling penting di NIO.2.

### 8.1 Lexical operation

Operasi lexical hanya memanipulasi path sebagai struktur nama.

Contoh:

```java
Path p = Path.of("/app/data/../logs/app.log");

System.out.println(p.normalize());
System.out.println(p.getParent());
System.out.println(p.resolve("x"));
System.out.println(p.relativize(Path.of("/app/tmp/a.txt")));
```

Operasi seperti ini tidak membaca disk.

### 8.2 Filesystem operation

Operasi filesystem membaca/mengubah kondisi storage nyata.

Contoh:

```java
Files.exists(p);
Files.size(p);
Files.readString(p);
Files.createDirectories(p);
Files.delete(p);
Files.move(source, target);
Files.copy(source, target);
```

Operasi ini bisa gagal karena:

- file tidak ada,
- permission denied,
- disk error,
- path invalid,
- parent directory tidak ada,
- target sudah ada,
- symbolic link loop,
- file sedang dipakai,
- filesystem readonly,
- network filesystem timeout,
- storage penuh.

### 8.3 Kenapa ini penting?

Karena banyak developer berpikir:

```java
Path safe = userInput.normalize();
```

lalu menganggap aman.

Padahal `normalize()` tidak mengecek symlink. Path lexical yang terlihat aman masih bisa menunjuk keluar base directory melalui symbolic link.

Untuk security, lexical normalize sering hanya langkah awal, bukan bukti final.

---

## 9. `resolve`, `resolveSibling`, dan `relativize`

### 9.1 `resolve`

`resolve` menggabungkan base path dan child path.

```java
Path base = Path.of("/app/data");
Path file = base.resolve("input.csv");
System.out.println(file); // /app/data/input.csv
```

Jika child adalah absolute path, behavior penting:

```java
Path base = Path.of("/app/data");
Path child = Path.of("/tmp/evil.txt");
Path result = base.resolve(child);

System.out.println(result); // /tmp/evil.txt
```

Jadi jangan langsung `resolve(userInput)` tanpa validasi.

### 9.2 Defensive resolve untuk user input

Misalnya aplikasi menerima filename dari user.

Buruk:

```java
Path target = uploadDir.resolve(userProvidedName);
```

Jika user memberi:

```text
../../etc/passwd
```

atau absolute path:

```text
/tmp/evil
```

hasilnya bisa keluar dari upload directory.

Lebih aman:

```java
static Path resolveInsideBase(Path baseDir, String userPath) throws IOException {
    Path base = baseDir.toRealPath();
    Path candidate = base.resolve(userPath).normalize();

    if (!candidate.startsWith(base)) {
        throw new SecurityException("Path escapes base directory: " + userPath);
    }

    return candidate;
}
```

Namun untuk symlink-sensitive security, perlu lebih hati-hati. Jika path belum ada, `toRealPath()` pada candidate tidak bisa dipakai. Jika parent sudah ada, validasi parent real path dapat dilakukan.

Contoh untuk file baru:

```java
static Path resolveNewFileInsideBase(Path baseDir, String fileName) throws IOException {
    if (fileName.contains("/") || fileName.contains("\\")) {
        throw new IllegalArgumentException("Only simple file name is allowed");
    }

    Path base = baseDir.toRealPath();
    Path candidate = base.resolve(fileName).normalize();

    if (!candidate.getParent().toRealPath().equals(base)) {
        throw new SecurityException("Parent directory is not the expected base");
    }

    return candidate;
}
```

Untuk upload file, sering lebih aman tidak memakai nama user sebagai path langsung. Gunakan generated ID, lalu simpan original filename sebagai metadata.

### 9.3 `resolveSibling`

`resolveSibling` mengganti file name path dengan sibling lain.

```java
Path file = Path.of("/app/data/input.csv");
Path tmp = file.resolveSibling("input.csv.tmp");

System.out.println(tmp); // /app/data/input.csv.tmp
```

Useful untuk atomic write pattern:

```java
Path target = Path.of("/app/data/config.json");
Path temp = target.resolveSibling(target.getFileName() + ".tmp");
```

### 9.4 `relativize`

`relativize` membuat path relatif dari satu path ke path lain.

```java
Path base = Path.of("/app/data");
Path file = Path.of("/app/data/reports/daily.csv");

Path relative = base.relativize(file);
System.out.println(relative); // reports/daily.csv
```

Useful untuk:

- manifest file,
- displaying path relative to workspace,
- preserving directory structure saat copy tree,
- logging tanpa expose absolute path.

Caveat:

```text
Kedua path harus compatible: biasanya sama-sama absolute atau sama-sama relative.
```

---

## 10. `normalize` vs `toRealPath`

### 10.1 `normalize`

```java
Path p = Path.of("/app/data/../logs/app.log");
Path n = p.normalize();
```

Hasil:

```text
/app/logs/app.log
```

`normalize()` menghapus redundant `.` dan `..` secara lexical.

Tidak cek:

- file ada,
- symlink,
- permission,
- mount point,
- case sensitivity.

### 10.2 `toRealPath`

```java
Path real = p.toRealPath();
```

`toRealPath()` menyelesaikan path nyata.

Default behavior menyelesaikan symbolic links.

Dengan option:

```java
Path realNoFollow = p.toRealPath(LinkOption.NOFOLLOW_LINKS);
```

### 10.3 Contoh symlink trap

Misalnya:

```text
/app/uploads/link -> /etc
```

User input:

```text
link/passwd
```

Lexical candidate:

```text
/app/uploads/link/passwd
```

`normalize()` masih terlihat di dalam `/app/uploads`.

Tetapi real path-nya:

```text
/etc/passwd
```

Maka validasi security yang hanya memakai `normalize()` bisa gagal.

---

## 11. `Files.exists` dan Jebakan “Check Then Act”

### 11.1 Basic usage

```java
Path p = Path.of("data/input.csv");

if (Files.exists(p)) {
    System.out.println("exists");
}
```

Ada juga:

```java
Files.notExists(p)
```

Caveat penting:

```text
exists false tidak selalu berarti file tidak ada.
notExists false tidak selalu berarti file ada.
```

Kenapa?

Karena bisa ada kondisi unknown:

- permission denied,
- I/O error,
- broken symlink,
- network filesystem failure.

Maka:

```java
boolean exists = Files.exists(p);
boolean notExists = Files.notExists(p);
```

Kemungkinan:

```text
exists=true,  notExists=false : file diketahui ada
exists=false, notExists=true  : file diketahui tidak ada
exists=false, notExists=false : status tidak bisa ditentukan
```

### 11.2 Check-then-act race condition

Buruk:

```java
if (!Files.exists(target)) {
    Files.writeString(target, content);
}
```

Di antara `exists` dan `writeString`, process/thread lain bisa membuat file.

Lebih baik gunakan operasi atomic atau option:

```java
Files.writeString(
    target,
    content,
    StandardOpenOption.CREATE_NEW,
    StandardOpenOption.WRITE
);
```

`CREATE_NEW` gagal jika file sudah ada.

### 11.3 Saat `exists` tetap berguna

`exists` berguna untuk:

- user-friendly message,
- preflight check,
- diagnostics,
- branching non-critical,
- monitoring,
- best-effort cleanup.

Tetapi jangan gunakan `exists` sebagai satu-satunya mekanisme correctness/security untuk operasi yang harus atomic.

---

## 12. Basic Type Checks: Regular File, Directory, Link

```java
Path p = Path.of("data/input.csv");

boolean regular = Files.isRegularFile(p);
boolean directory = Files.isDirectory(p);
boolean symbolicLink = Files.isSymbolicLink(p);
```

### 12.1 `isRegularFile`

Regular file berarti file biasa, bukan directory atau special file.

```java
if (!Files.isRegularFile(p)) {
    throw new IllegalArgumentException("Expected regular file: " + p);
}
```

### 12.2 `isDirectory`

```java
if (!Files.isDirectory(baseDir)) {
    throw new IllegalArgumentException("Expected directory: " + baseDir);
}
```

### 12.3 Link handling

Banyak method mengikuti symbolic link secara default.

Untuk tidak mengikuti link:

```java
Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS);
```

Penting untuk security.

---

## 13. Readability, Writability, Executability

```java
Files.isReadable(p);
Files.isWritable(p);
Files.isExecutable(p);
```

Caveat:

```text
Hasil check bisa berubah setelah dicek.
```

Contoh:

```java
if (Files.isWritable(p)) {
    Files.writeString(p, "data");
}
```

Masih bisa gagal karena permission berubah, file dihapus, mount jadi readonly, disk penuh, dan lain-lain.

Prinsip production:

```text
Use access checks for diagnostics.
Use actual operation exception for correctness.
```

Lebih baik:

```java
try {
    Files.writeString(p, "data", StandardOpenOption.CREATE_NEW);
} catch (AccessDeniedException e) {
    // permission problem
} catch (FileAlreadyExistsException e) {
    // target already exists
} catch (IOException e) {
    // other I/O problem
}
```

---

## 14. Reading Files with `Files`

### 14.1 Small binary file

```java
Path p = Path.of("data/input.bin");
byte[] bytes = Files.readAllBytes(p);
```

Cocok untuk file kecil.

Tidak cocok untuk file besar karena seluruh isi masuk heap.

### 14.2 Small text file

```java
String text = Files.readString(Path.of("data/config.json"), StandardCharsets.UTF_8);
```

Gunakan charset eksplisit.

### 14.3 Lines

```java
List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
```

Cocok untuk file kecil/menengah yang memang aman masuk memory.

Untuk file besar:

```java
try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
    lines.forEach(System.out::println);
}
```

Penting:

```text
Stream dari Files.lines harus ditutup.
```

Gunakan `try-with-resources`.

### 14.4 Buffered reader

```java
try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
    String line;
    while ((line = reader.readLine()) != null) {
        process(line);
    }
}
```

Ini pilihan stabil untuk file teks besar.

---

## 15. Writing Files with `Files`

### 15.1 Small text write

```java
Files.writeString(
    Path.of("data/output.txt"),
    "hello\n",
    StandardCharsets.UTF_8,
    StandardOpenOption.CREATE,
    StandardOpenOption.TRUNCATE_EXISTING,
    StandardOpenOption.WRITE
);
```

Option penting:

```text
CREATE             : buat jika belum ada
CREATE_NEW         : buat baru, gagal jika sudah ada
TRUNCATE_EXISTING  : kosongkan file lama
APPEND             : tambah di akhir
WRITE              : buka untuk tulis
SYNC / DSYNC       : sinkronisasi lebih kuat, mahal
```

### 15.2 Small binary write

```java
byte[] payload = loadPayload();
Files.write(Path.of("data/output.bin"), payload);
```

Default behavior tergantung overload. Untuk clarity production, lebih baik eksplisit option.

### 15.3 Buffered writer

```java
try (BufferedWriter writer = Files.newBufferedWriter(
        path,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE)) {

    writer.write("header\n");
    writer.write("value\n");
}
```

### 15.4 Output stream

```java
try (OutputStream out = Files.newOutputStream(
        path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    out.write(payload);
}
```

Gunakan stream ketika data datang sebagai stream pipeline, bukan sudah berada di byte array.

---

## 16. Creating Files and Directories

### 16.1 Create single file

```java
Path file = Path.of("data/output.txt");
Files.createFile(file);
```

Gagal jika file sudah ada.

### 16.2 Create one directory

```java
Path dir = Path.of("data/reports");
Files.createDirectory(dir);
```

Gagal jika parent tidak ada.

### 16.3 Create directories recursively

```java
Path dir = Path.of("data/reports/2026/06");
Files.createDirectories(dir);
```

`createDirectories` mirip `mkdir -p`.

Caveat:

- Jika path sudah ada sebagai directory, biasanya ok.
- Jika salah satu path segment adalah file biasa, gagal.
- Jika permission kurang, gagal.
- Dalam concurrent creation, method ini relatif convenient tetapi tetap harus handle `IOException`.

---

## 17. Copy, Move, Delete

### 17.1 Copy file

```java
Files.copy(source, target);
```

Jika target sudah ada, default gagal.

Dengan replace:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Dengan copy attribute:

```java
Files.copy(
    source,
    target,
    StandardCopyOption.REPLACE_EXISTING,
    StandardCopyOption.COPY_ATTRIBUTES
);
```

### 17.2 Copy stream to file

```java
try (InputStream in = getInputStream()) {
    Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
}
```

### 17.3 Copy file to stream

```java
try (OutputStream out = getOutputStream()) {
    Files.copy(source, out);
}
```

### 17.4 Move file

```java
Files.move(source, target);
```

Replace:

```java
Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Atomic move:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

Caveat:

```text
ATOMIC_MOVE bisa gagal jika tidak didukung atau beda filesystem.
```

Atomic move akan dibahas lebih dalam di Part 014.

### 17.5 Delete

```java
Files.delete(path);
```

Gagal jika file tidak ada.

Best-effort delete:

```java
Files.deleteIfExists(path);
```

Caveat:

- Delete directory hanya berhasil jika directory kosong.
- Delete bisa gagal di Windows jika file masih dibuka process lain.
- Delete symbolic link menghapus link, bukan target link.
- Permission dan filesystem semantics berbeda antar OS.

---

## 18. `StandardOpenOption` sebagai Contract

Saat membuka file untuk read/write, option adalah contract.

Contoh:

```java
try (SeekableByteChannel channel = Files.newByteChannel(
        path,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    channel.write(ByteBuffer.wrap(payload));
}
```

Option penting:

| Option | Makna |
|---|---|
| `READ` | buka untuk membaca |
| `WRITE` | buka untuk menulis |
| `APPEND` | tulis di akhir file |
| `TRUNCATE_EXISTING` | kosongkan file saat dibuka |
| `CREATE` | buat jika belum ada |
| `CREATE_NEW` | buat baru dan gagal jika sudah ada |
| `DELETE_ON_CLOSE` | hapus saat channel ditutup, best effort |
| `SPARSE` | hint sparse file |
| `SYNC` | setiap update content/metadata disinkronkan ke storage |
| `DSYNC` | setiap update content disinkronkan ke storage |

### 18.1 `CREATE` vs `CREATE_NEW`

```java
CREATE
```

Artinya:

```text
buat jika belum ada; jika sudah ada, buka file itu.
```

```java
CREATE_NEW
```

Artinya:

```text
buat file baru; jika sudah ada, gagal.
```

Untuk mencegah overwrite tidak sengaja, gunakan `CREATE_NEW`.

### 18.2 `APPEND` bukan pengganti format append-only yang benar

```java
Files.writeString(path, line, StandardOpenOption.APPEND);
```

Masalah:

- append dari banyak process/thread bisa interleaving tergantung OS dan ukuran write,
- tidak otomatis ada framing,
- tidak otomatis durable,
- tidak otomatis atomic untuk record besar,
- tidak otomatis recovery-friendly.

Untuk append-only log production, perlu desain record framing, checksum, flush strategy, dan recovery logic.

---

## 19. `OpenOption`, `CopyOption`, `LinkOption`

NIO.2 sering memakai option interface.

```java
OpenOption
CopyOption
LinkOption
```

Implementasi umum:

```java
StandardOpenOption
StandardCopyOption
LinkOption
```

Contoh:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS);
Files.newOutputStream(path, StandardOpenOption.CREATE_NEW);
```

Mental model:

```text
Option bukan dekorasi. Option mengubah contract operasi.
```

---

## 20. Symbolic Link: Follow atau No Follow?

Symbolic link adalah entry filesystem yang menunjuk ke path lain.

Contoh Unix:

```bash
ln -s /etc/passwd uploads/passwd-link
```

Dalam Java:

```java
boolean isLink = Files.isSymbolicLink(path);
```

Banyak operasi mengikuti symlink secara default.

Untuk operasi tertentu, gunakan:

```java
LinkOption.NOFOLLOW_LINKS
```

Contoh:

```java
Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS);
Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
```

Security rule:

```text
Jika path berasal dari user atau external system, symbolic link harus dianggap bagian dari threat model.
```

Contoh risiko:

- upload menimpa file di luar directory,
- cleanup job menghapus file di luar workspace,
- archive extraction keluar target directory,
- config loader membaca secret di luar allowed dir,
- batch job mengikuti symlink ke directory besar dan menyebabkan runaway traversal.

---

## 21. Cross-Platform Path Semantics

### 21.1 Separator

```java
FileSystems.getDefault().getSeparator()
```

Unix-like:

```text
/
```

Windows:

```text
\
```

Gunakan:

```java
Path.of("data", "reports", "daily.csv")
```

bukan string concatenation:

```java
"data" + "/" + "reports" + "/" + "daily.csv"
```

### 21.2 Root berbeda

Unix:

```text
/
```

Windows:

```text
C:\
\\server\share
```

Kode yang memotong string path secara manual hampir pasti rapuh.

Buruk:

```java
String fileName = pathString.substring(pathString.lastIndexOf('/') + 1);
```

Lebih baik:

```java
Path.of(pathString).getFileName().toString();
```

### 21.3 Case sensitivity

Linux biasanya case-sensitive:

```text
Report.csv != report.csv
```

Windows biasanya case-insensitive tetapi case-preserving:

```text
Report.csv dan report.csv bisa dianggap sama
```

macOS bisa tergantung filesystem configuration.

Jangan membuat logic business yang bergantung diam-diam pada case sensitivity OS.

### 21.4 Reserved names dan invalid characters

Windows punya reserved names seperti:

```text
CON, PRN, AUX, NUL, COM1, LPT1, ...
```

Karakter tertentu juga invalid.

Jika membuat aplikasi upload/download portable, jangan gunakan original filename langsung sebagai filename storage.

Lebih aman:

```text
storage filename : generated UUID / content hash / database id
original filename: metadata
```

### 21.5 Line separator bukan path separator

Jangan bingung:

```java
System.lineSeparator(); // newline untuk text
File.separator          // separator path legacy
FileSystems.getDefault().getSeparator() // separator path NIO
```

---

## 22. URI, URL, dan Path

### 22.1 Path to URI

```java
Path path = Path.of("/app/data/input.txt");
URI uri = path.toUri();
```

Hasil bisa seperti:

```text
file:///app/data/input.txt
```

### 22.2 URI to Path

```java
Path path = Path.of(uri);
```

atau legacy:

```java
Path path = Paths.get(uri);
```

### 22.3 Jangan samakan URL dan file path

`URL` bisa menunjuk resource network.

`URI` adalah identifier lebih umum.

`Path` adalah path dalam filesystem provider.

Buruk:

```java
Path p = Path.of(url.toString());
```

Lebih benar tergantung kasus:

```java
URI uri = url.toURI();
Path p = Path.of(uri); // hanya jika URI scheme cocok dengan filesystem provider
```

Untuk resource classpath, jangan asumsikan selalu file biasa. Saat packaged dalam JAR, resource bisa berada di dalam archive.

---

## 23. Working with Default FileSystem

```java
FileSystem fs = FileSystems.getDefault();

System.out.println(fs.getSeparator());

for (Path root : fs.getRootDirectories()) {
    System.out.println(root);
}

for (FileStore store : fs.getFileStores()) {
    System.out.println(store.name() + " " + store.type());
}
```

Useful untuk diagnostics.

Namun hati-hati:

- file store enumeration bisa berbeda di container,
- permission bisa membatasi visibility,
- network mount bisa lambat,
- informasi usable space bisa approximate.

---

## 24. ZIP/JAR as FileSystem

Salah satu kekuatan NIO.2 adalah filesystem provider.

ZIP/JAR dapat diperlakukan sebagai filesystem.

Contoh:

```java
Path zipPath = Path.of("/tmp/data.zip");
URI uri = URI.create("jar:" + zipPath.toUri());

try (FileSystem zipFs = FileSystems.newFileSystem(uri, Map.of("create", "true"))) {
    Path fileInsideZip = zipFs.getPath("/hello.txt");
    Files.writeString(fileInsideZip, "hello", StandardCharsets.UTF_8);
}
```

Membaca:

```java
Path zipPath = Path.of("/tmp/data.zip");
URI uri = URI.create("jar:" + zipPath.toUri());

try (FileSystem zipFs = FileSystems.newFileSystem(uri, Map.of())) {
    Path fileInsideZip = zipFs.getPath("/hello.txt");
    String text = Files.readString(fileInsideZip, StandardCharsets.UTF_8);
    System.out.println(text);
}
```

Caveat:

```text
ZIP filesystem tidak selalu punya semantics sama dengan filesystem lokal.
```

Misalnya:

- performance berbeda,
- locking berbeda,
- attribute support berbeda,
- atomic operation berbeda,
- write behavior berbeda,
- path separator logic tetap provider-specific.

---

## 25. FileStore: Space, Type, Attribute Support

Contoh:

```java
Path path = Path.of("/app/data");
FileStore store = Files.getFileStore(path);

System.out.println("name=" + store.name());
System.out.println("type=" + store.type());
System.out.println("total=" + store.getTotalSpace());
System.out.println("usable=" + store.getUsableSpace());
System.out.println("unallocated=" + store.getUnallocatedSpace());
System.out.println("posix=" + store.supportsFileAttributeView("posix"));
```

### 25.1 `usable` vs `unallocated`

`getUsableSpace()` biasanya space yang tersedia untuk process/user ini.

`getUnallocatedSpace()` space yang belum dialokasikan secara umum.

Keduanya bisa berbeda karena quota, permission, reserved blocks, container limits, mount behavior.

### 25.2 Untuk production

Gunakan informasi FileStore untuk:

- startup diagnostics,
- preflight batch job besar,
- alerting disk pressure,
- memastikan directory target berada di filesystem yang diharapkan,
- mendeteksi cross-filesystem atomic move risk.

Namun jangan percaya space check sebagai guarantee. Disk bisa penuh setelah check.

---

## 26. Exception Taxonomy dalam File Operation

NIO.2 memberi exception lebih spesifik daripada `java.io.File` boolean.

Contoh umum:

```java
try {
    Files.copy(source, target);
} catch (FileAlreadyExistsException e) {
    // target exists
} catch (NoSuchFileException e) {
    // source/parent missing
} catch (AccessDeniedException e) {
    // permission denied
} catch (DirectoryNotEmptyException e) {
    // delete/move directory problem
} catch (AtomicMoveNotSupportedException e) {
    // atomic move not supported
} catch (FileSystemLoopException e) {
    // symlink loop
} catch (IOException e) {
    // generic I/O
}
```

Important subclasses:

| Exception | Meaning |
|---|---|
| `NoSuchFileException` | file/path tidak ditemukan |
| `FileAlreadyExistsException` | target sudah ada saat operasi mengharuskan baru |
| `AccessDeniedException` | permission/security/lock issue |
| `DirectoryNotEmptyException` | directory tidak kosong |
| `NotDirectoryException` | path segment yang diharapkan directory ternyata bukan |
| `NotLinkException` | operasi link pada target bukan link |
| `FileSystemLoopException` | loop akibat symbolic link traversal |
| `AtomicMoveNotSupportedException` | provider tidak mendukung atomic move |

Production rule:

```text
Tangkap exception spesifik jika recovery/response-nya berbeda.
Tangkap IOException umum untuk fallback/logging akhir.
```

Buruk:

```java
catch (Exception e) {
    return false;
}
```

Lebih baik:

```java
catch (NoSuchFileException e) {
    throw new UserVisibleException("Input file does not exist", e);
} catch (AccessDeniedException e) {
    throw new UserVisibleException("No permission to access file", e);
} catch (IOException e) {
    throw new StorageException("File operation failed", e);
}
```

---

## 27. Designing a File Service Boundary

Dalam aplikasi production, jangan sebar operasi `Files.*` random di seluruh business logic.

Lebih baik buat boundary:

```java
public interface DocumentStorage {
    StoredDocument put(DocumentId id, InputStream content) throws IOException;
    InputStream open(DocumentId id) throws IOException;
    boolean delete(DocumentId id) throws IOException;
}
```

Implementasi filesystem:

```java
public final class FileSystemDocumentStorage implements DocumentStorage {
    private final Path baseDir;

    public FileSystemDocumentStorage(Path baseDir) throws IOException {
        this.baseDir = baseDir.toAbsolutePath().normalize();
        Files.createDirectories(this.baseDir);
    }

    @Override
    public StoredDocument put(DocumentId id, InputStream content) throws IOException {
        Path target = pathFor(id);
        Files.createDirectories(target.getParent());

        Path temp = target.resolveSibling(target.getFileName() + ".tmp");

        try (OutputStream out = Files.newOutputStream(
                temp,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE)) {
            content.transferTo(out);
        }

        Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
        return new StoredDocument(id, target);
    }

    @Override
    public InputStream open(DocumentId id) throws IOException {
        Path path = pathFor(id);
        return Files.newInputStream(path, StandardOpenOption.READ);
    }

    @Override
    public boolean delete(DocumentId id) throws IOException {
        return Files.deleteIfExists(pathFor(id));
    }

    private Path pathFor(DocumentId id) {
        String safeName = id.value() + ".bin";
        return baseDir.resolve(safeName).normalize();
    }
}

record DocumentId(String value) {}
record StoredDocument(DocumentId id, Path path) {}
```

Catatan:

- Ini masih simplified.
- Part 014 akan membahas atomic write lebih benar termasuk `force`/fsync.
- Untuk security, path generation sebaiknya tidak memakai input arbitrary.
- Untuk observability, tambahkan metric bytes written, duration, failure reason.

---

## 28. File Operation sebagai State Machine

Contoh upload ke filesystem tidak boleh dipikirkan sebagai satu statement:

```java
Files.copy(input, target);
```

Production mental model:

```text
RECEIVED
  -> VALIDATING_NAME
  -> RESOLVING_PATH
  -> CREATING_PARENT_DIR
  -> WRITING_TEMP
  -> VERIFYING_SIZE_OR_CHECKSUM
  -> PUBLISHING_ATOMICALLY
  -> FINALIZED
  -> CLEANING_TEMP_ON_FAILURE
```

State machine membantu menjawab:

- Kalau gagal setelah temp file dibuat, siapa cleanup?
- Kalau proses mati sebelum move, bagaimana recovery?
- Kalau checksum mismatch, file final tidak boleh publish.
- Kalau target sudah ada, overwrite atau reject?
- Kalau retry terjadi, operation idempotent atau duplicate?
- Kalau disk penuh, response apa?
- Kalau permission denied, alert apa?

---

## 29. Common Recipes

### 29.1 Read config file safely

```java
public static String readConfig(Path configPath) throws IOException {
    Path path = configPath.toAbsolutePath().normalize();

    if (!Files.isRegularFile(path)) {
        throw new NoSuchFileException(path.toString());
    }

    return Files.readString(path, StandardCharsets.UTF_8);
}
```

Caveat:

`isRegularFile` adalah precheck. `readString` tetap harus siap gagal.

### 29.2 Ensure application directory

```java
public static Path ensureAppDir(String envName) throws IOException {
    String value = System.getenv(envName);
    if (value == null || value.isBlank()) {
        throw new IllegalStateException("Missing env: " + envName);
    }

    Path dir = Path.of(value).toAbsolutePath().normalize();
    Files.createDirectories(dir);

    if (!Files.isDirectory(dir)) {
        throw new NotDirectoryException(dir.toString());
    }

    return dir;
}
```

### 29.3 Create file only if absent

```java
public static void createOnce(Path path, String content) throws IOException {
    Files.writeString(
        path,
        content,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE
    );
}
```

### 29.4 Replace file

```java
public static void replace(Path path, String content) throws IOException {
    Files.writeString(
        path,
        content,
        StandardCharsets.UTF_8,
        StandardOpenOption.CREATE,
        StandardOpenOption.TRUNCATE_EXISTING,
        StandardOpenOption.WRITE
    );
}
```

Caveat:

Ini bukan crash-safe atomic replacement. Untuk config/state file penting, gunakan atomic write pattern Part 014.

### 29.5 Copy stream with explicit failure behavior

```java
public static long copyToNewFile(InputStream in, Path target) throws IOException {
    Files.createDirectories(target.getParent());
    return Files.copy(in, target); // fails if target exists
}
```

Lebih eksplisit:

```java
public static long copyToNewFile(InputStream in, Path target) throws IOException {
    Files.createDirectories(target.getParent());
    try (OutputStream out = Files.newOutputStream(
            target,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE)) {
        return in.transferTo(out);
    }
}
```

---

## 30. Anti-Patterns

### 30.1 Menggunakan `String` sebagai path utama

Buruk:

```java
String path = base + "/" + name;
```

Masalah:

- separator hardcoded,
- traversal risk,
- double separator,
- absolute child override tidak disadari,
- tidak jelas filesystem provider,
- mudah salah normalize.

Lebih baik:

```java
Path path = base.resolve(name);
```

### 30.2 Mengandalkan current working directory diam-diam

Buruk:

```java
Files.readString(Path.of("config/app.json"));
```

Lebih baik:

```java
Path configDir = Path.of(System.getenv("APP_CONFIG_DIR"));
Path config = configDir.resolve("app.json");
```

### 30.3 `Files.exists` sebagai guard correctness

Buruk:

```java
if (!Files.exists(p)) {
    Files.createFile(p);
}
```

Lebih baik:

```java
Files.createFile(p);
```

Tangkap `FileAlreadyExistsException` jika perlu.

### 30.4 Membaca file besar dengan `readAllBytes`

Buruk:

```java
byte[] all = Files.readAllBytes(hugeFile);
```

Lebih baik:

```java
try (InputStream in = Files.newInputStream(hugeFile)) {
    // streaming processing
}
```

### 30.5 Menyimpan upload memakai original filename langsung

Buruk:

```java
Path target = uploadDir.resolve(originalFilename);
```

Risiko:

- path traversal,
- overwrite,
- reserved names,
- unicode confusion,
- duplicate filename,
- path length,
- invalid chars,
- leaking user data.

Lebih baik:

```java
Path target = uploadDir.resolve(generatedId + ".bin");
```

Original filename simpan sebagai metadata.

### 30.6 Menangkap `IOException` lalu return false tanpa konteks

Buruk:

```java
try {
    Files.copy(a, b);
    return true;
} catch (IOException e) {
    return false;
}
```

Lebih baik:

```java
try {
    Files.copy(a, b);
} catch (FileAlreadyExistsException e) {
    throw new ConflictException("Target exists", e);
} catch (NoSuchFileException e) {
    throw new MissingInputException("Input missing", e);
} catch (IOException e) {
    throw new StorageOperationException("Copy failed", e);
}
```

---

## 31. Failure Model NIO.2 File Operation

Saat mendesain operasi file, pikirkan failure berikut.

### 31.1 Path resolution failure

- path invalid,
- unsupported path format,
- absolute path tidak diizinkan,
- traversal keluar base dir,
- symlink keluar base dir.

### 31.2 Precondition failure

- source tidak ada,
- target sudah ada,
- parent directory tidak ada,
- target bukan regular file,
- expected directory ternyata file biasa.

### 31.3 Permission failure

- read denied,
- write denied,
- execute/search directory denied,
- readonly mount,
- SELinux/AppArmor/container restriction,
- Windows file lock.

### 31.4 Capacity failure

- disk full,
- quota exceeded,
- inode exhausted,
- temporary directory full,
- network storage unavailable.

### 31.5 Concurrency failure

- file dibuat process lain,
- file dihapus setelah precheck,
- file diganti symbolic link,
- concurrent writer interleaving,
- cleanup job menghapus temp file,
- reader membaca file setengah jadi.

### 31.6 Durability failure

- write berhasil di buffer tetapi belum persisted,
- process crash sebelum close,
- OS crash sebelum flush ke disk,
- rename belum durable tanpa fsync directory,
- network filesystem acknowledge semantics berbeda.

### 31.7 Semantic failure

- encoding salah,
- file partial,
- checksum mismatch,
- wrong file version,
- wrong format,
- path case mismatch,
- unexpected symlink.

---

## 32. Performance Notes

### 32.1 `Files.readString/readAllBytes` bukan untuk file besar

Mereka nyaman, tetapi data masuk memory sekaligus.

Rule of thumb:

```text
Jika ukuran file tidak dikontrol atau bisa besar, gunakan streaming.
```

### 32.2 `Files.lines` lazy tapi resourceful

```java
try (Stream<String> lines = Files.lines(path)) {
    lines.forEach(...);
}
```

Jangan return stream ini keluar method tanpa lifecycle yang jelas.

Buruk:

```java
public Stream<String> lines(Path path) throws IOException {
    return Files.lines(path);
}
```

Pemanggil bisa lupa close.

Lebih baik desain callback:

```java
public void withLines(Path path, Consumer<Stream<String>> consumer) throws IOException {
    try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
        consumer.accept(lines);
    }
}
```

atau gunakan iterator/reader dengan ownership jelas.

### 32.3 Directory listing besar

`Files.list` lazy tetapi harus ditutup.

```java
try (Stream<Path> entries = Files.list(dir)) {
    entries.forEach(System.out::println);
}
```

Untuk directory sangat besar, hindari collect all jika tidak perlu.

### 32.4 Network filesystem tidak seperti local disk

Filesystem bisa berada di:

- local SSD,
- EBS/network block storage,
- NFS,
- SMB,
- container overlay filesystem,
- mounted object storage adapter,
- ZIP provider.

Semantics, latency, locking, atomic move, dan durability bisa berbeda.

---

## 33. Security Notes

### 33.1 Treat external path as untrusted

Input path dari user/API/message/file config external harus dianggap untrusted.

Validasi:

- absolute path tidak boleh kecuali memang diizinkan,
- `..` segment tidak boleh untuk simple filename,
- path harus tetap di bawah base directory,
- symlink policy harus jelas,
- original filename jangan dipakai sebagai storage name langsung.

### 33.2 Base directory confinement

Contoh minimal:

```java
public static Path confine(Path baseDir, String userInput) throws IOException {
    Path base = baseDir.toRealPath();
    Path candidate = base.resolve(userInput).normalize();

    if (!candidate.startsWith(base)) {
        throw new SecurityException("Path escapes base directory");
    }

    return candidate;
}
```

Untuk kasus high-security, tambahkan:

- reject absolute input,
- reject path separator jika hanya filename,
- validate parent real path,
- avoid following symlink,
- create file dengan `CREATE_NEW`,
- set permission eksplisit,
- use generated filename.

### 33.3 Logging path

Path bisa mengandung data sensitif:

- username,
- tenant id,
- document id,
- original filename,
- case reference,
- folder rahasia,
- local workstation path.

Log path dengan hati-hati.

Contoh lebih aman:

```text
operation=store_document documentId=abc123 status=failed reason=AccessDeniedException
```

Bukan:

```text
failed /home/user/private/client-x/legal-case-1234-medical.pdf
```

---

## 34. Testing Strategy

### 34.1 Gunakan temp directory

JUnit 5 menyediakan `@TempDir`.

```java
class StorageTest {
    @TempDir
    Path tempDir;

    @Test
    void storesFile() throws Exception {
        Path file = tempDir.resolve("a.txt");
        Files.writeString(file, "hello", StandardCharsets.UTF_8);
        assertEquals("hello", Files.readString(file, StandardCharsets.UTF_8));
    }
}
```

### 34.2 Test failure, bukan happy path saja

Test:

- file tidak ada,
- target sudah ada,
- parent missing,
- directory instead of file,
- file instead of directory,
- invalid filename,
- path traversal,
- duplicate create,
- delete missing,
- large file streaming,
- symlink jika OS mendukung,
- permission denied jika environment memungkinkan.

### 34.3 Jangan test dengan absolute path developer machine

Buruk:

```java
Path p = Path.of("C:/Users/Fajar/Desktop/test.txt");
```

Lebih baik:

```java
@TempDir Path tempDir;
```

### 34.4 Test cross-platform assumptions

Jika library akan berjalan di Linux container tetapi developer memakai Windows, test minimal di CI Linux.

Path bug sering lolos di satu OS dan muncul di OS lain.

---

## 35. Production Design Checklist

Sebelum membuat file operation production, jawab ini:

### Path dan base directory

- [ ] Apakah base directory eksplisit?
- [ ] Apakah relative path bergantung pada `user.dir`?
- [ ] Apakah path external divalidasi?
- [ ] Apakah absolute path external ditolak?
- [ ] Apakah path traversal dicegah?
- [ ] Apakah symbolic link policy jelas?

### Operation contract

- [ ] Apakah operasi create boleh overwrite?
- [ ] Jika tidak boleh overwrite, apakah memakai `CREATE_NEW`?
- [ ] Jika replace, apakah harus atomic?
- [ ] Jika append, apakah record boundary aman?
- [ ] Jika delete, apakah best-effort atau wajib berhasil?
- [ ] Jika move, apakah perlu `ATOMIC_MOVE`?

### Resource lifecycle

- [ ] Apakah stream/channel ditutup?
- [ ] Apakah lazy `Stream<Path>`/`Stream<String>` ditutup?
- [ ] Apakah ownership resource jelas?

### Large data

- [ ] Apakah ukuran file bounded?
- [ ] Apakah `readAllBytes/readString/readAllLines` aman?
- [ ] Apakah perlu streaming?
- [ ] Apakah ada max size?

### Failure handling

- [ ] Apakah exception spesifik ditangani?
- [ ] Apakah partial output dibersihkan?
- [ ] Apakah retry aman/idempotent?
- [ ] Apakah disk full dipertimbangkan?
- [ ] Apakah permission denied dipisah dari missing file?

### Observability

- [ ] Apakah operasi file penting punya logging structured?
- [ ] Apakah duration dicatat?
- [ ] Apakah bytes read/written dicatat?
- [ ] Apakah failure reason dicatat tanpa leak sensitive path?

---

## 36. Latihan

### Latihan 1 — Safe path resolver

Buat method:

```java
Path resolveUserFile(Path baseDir, String userInput) throws IOException
```

Requirement:

- base directory harus real path,
- input absolute ditolak,
- candidate harus tetap di bawah base,
- return normalized path,
- handle traversal.

Diskusikan limitation terhadap symlink.

### Latihan 2 — Create new file only once

Buat method:

```java
void createReport(Path reportsDir, String reportName, String content)
```

Requirement:

- create directory jika belum ada,
- file gagal dibuat jika sudah ada,
- charset UTF-8 eksplisit,
- exception spesifik untuk conflict.

### Latihan 3 — Streaming line processor

Buat method:

```java
long countMatchingLines(Path file, Predicate<String> predicate) throws IOException
```

Requirement:

- tidak load semua file,
- close resource dengan benar,
- charset eksplisit.

### Latihan 4 — Directory diagnostics

Buat method:

```java
DirectoryDiagnostics inspect(Path dir) throws IOException
```

Isi diagnostics:

- absolute normalized path,
- real path jika ada,
- apakah directory,
- readable/writable,
- file store name/type,
- usable space.

### Latihan 5 — ZIP filesystem

Buat program kecil yang:

- membuat ZIP file,
- menulis `/hello.txt` di dalam ZIP,
- membaca kembali isinya,
- menutup filesystem dengan benar.

---

## 37. Ringkasan

NIO.2 membawa model file modern ke Java:

```text
Path       = representasi path dalam filesystem
Files      = operasi static untuk file/directory/link
FileSystem = model filesystem
Provider   = backend implementasi filesystem
FileStore  = storage/mount backing
```

Prinsip terpenting:

1. `Path` bukan file nyata; ia hanya alamat.
2. Banyak operasi path bersifat lexical dan tidak menyentuh filesystem.
3. `Files.*` melakukan operasi nyata dan bisa gagal karena banyak sebab.
4. `normalize()` bukan security guarantee.
5. `toRealPath()` menyentuh filesystem dan menyelesaikan real target.
6. `Files.exists()` tidak boleh menjadi dasar correctness atomic.
7. Gunakan `CREATE_NEW`, `ATOMIC_MOVE`, dan exception spesifik untuk contract yang jelas.
8. Jangan mengandalkan current working directory tanpa sadar.
9. Jangan menyimpan path external/original filename langsung sebagai storage path.
10. Treat filesystem sebagai boundary yang mutable, concurrent, platform-specific, dan failure-prone.

Jika Part 009–010 memberi kita kekuatan low-level dengan `FileChannel` dan mmap, Part 011 memberi kita API operasional modern untuk membangun aplikasi yang berinteraksi dengan file secara aman dan portable.

---

## 38. Koneksi ke Part Berikutnya

Part berikutnya:

```text
Part 012 — File Attributes, Permissions, Ownership, Metadata, dan Cross-Platform Semantics
```

Kita akan masuk lebih dalam ke metadata filesystem:

- `BasicFileAttributes`,
- POSIX attributes,
- DOS attributes,
- ACL,
- owner/group,
- permission,
- timestamps,
- file key,
- `NOFOLLOW_LINKS`,
- TOCTOU,
- permission race,
- secure temp file,
- cross-platform behavior.

Part 011 memberi dasar `Path`, `Files`, dan `FileSystem`; Part 012 akan menjawab: **apa sebenarnya properties dari file/directory/link yang kita akses, dan seberapa portable/security-sensitive metadata tersebut?**

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 010 — Memory-Mapped File: `MappedByteBuffer`, Page Cache, Huge Files, dan Trade-off](./learn-java-io-nio-networking-data-transfer-part-010.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 012 — File Attributes, Permissions, Ownership, Metadata, dan Cross-Platform Semantics](./learn-java-io-nio-networking-data-transfer-part-012.md)

</div>