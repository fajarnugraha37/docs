# learn-java-io-file-filesystem-storage-engineering — Part 26
# Legacy `java.io.File`: Interop, Migration, and Compatibility

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `26`  
> Topik: Legacy `java.io.File`, interop dengan `Path`, migration strategy, compatibility, dan anti-pattern  
> Target Java: 8 sampai 25  
> Prasyarat: Part 00–25, terutama `Path`, `Files`, `FileSystemProvider`, attributes, permissions, traversal, copy/move/delete, dan virtual filesystem

---

## 1. Tujuan Part Ini

Part ini membahas `java.io.File`, bukan sebagai API utama modern, tetapi sebagai **legacy compatibility boundary** yang masih sering muncul dalam sistem Java nyata.

Banyak engineer yang sudah memakai `Path` tetap akan bertemu `File` karena:

1. library lama masih meminta `File`;
2. framework lama memakai `File` untuk konfigurasi;
3. API Swing/AWT, beberapa API image, beberapa library parsing, dan test fixture lama masih berbasis `File`;
4. codebase enterprise Java 6/7/8 masih punya banyak utility berbasis `File`;
5. dokumentasi lama, StackOverflow lama, dan contoh lama sering memakai `File`;
6. migration dari Java 8 ke Java 17/21/25 tidak otomatis menghapus `File`;
7. beberapa API lama menerima `String` path atau `File`, bukan `Path`.

Tujuan bagian ini bukan membuat kamu kembali menggunakan `File` sebagai default, tetapi membuat kamu mampu:

- membaca code legacy berbasis `File` dengan benar;
- memahami batas semantic `File`;
- melakukan migration bertahap ke `Path`/`Files`;
- membuat adapter layer yang aman;
- menghindari bug karena mencampur `File`, `Path`, URI, symlink, provider, dan platform-specific behavior;
- tetap kompatibel dengan Java 8–25.

Core mental model:

```text
java.io.File bukan file descriptor.
java.io.File bukan file yang sedang terbuka.
java.io.File bukan metadata snapshot.
java.io.File adalah abstract pathname legacy.
```

`File` hanya merepresentasikan **abstract pathname**. Ia bisa menunjuk file yang ada, file yang belum ada, directory, symlink, path invalid untuk operasi tertentu, atau path yang nanti akan dibuat.

---

## 2. Kenapa `java.io.File` Masih Penting?

Walaupun NIO.2 (`java.nio.file`) sudah tersedia sejak Java 7, `java.io.File` belum hilang dan kemungkinan tetap lama hidup karena compatibility.

### 2.1 `File` adalah bagian dari sejarah Java

Sebelum Java 7, banyak operasi file umum dilakukan dengan:

```java
File file = new File("data/input.txt");

if (file.exists()) {
    if (file.isFile()) {
        // read using FileInputStream, FileReader, Scanner, etc.
    }
}
```

Untuk operasi sederhana, ini terlihat cukup. Namun untuk production-grade filesystem engineering, API ini punya keterbatasan besar:

- banyak method mengembalikan `boolean`, bukan exception detail;
- tidak punya rich copy options;
- tidak punya provider abstraction eksplisit;
- tidak mendukung attribute view modern secara langsung;
- traversal directory kurang kuat dibanding `FileVisitor`;
- symbolic link behavior lebih sulit dikontrol;
- tidak cocok untuk virtual/custom filesystem;
- tidak memberikan atomic create/move semantics sebaik NIO.2;
- error handling sering kehilangan alasan kegagalan.

### 2.2 Banyak library masih memakai `File`

Contoh API yang sering masih menerima `File`:

```java
new FileInputStream(File file)
new FileOutputStream(File file)
ImageIO.read(File input)
JFileChooser#getSelectedFile()
Properties#load(InputStream in) // sering dipasangkan dengan FileInputStream
```

Banyak framework juga masih punya konfigurasi seperti:

```java
setConfigLocation(File file)
setWorkingDirectory(File dir)
loadFrom(File file)
```

Karena itu, top engineer tidak hanya tahu `Path` modern, tetapi juga tahu bagaimana berinteraksi dengan `File` tanpa kehilangan correctness.

---

## 3. `File` vs `Path`: Perbedaan Fundamental

### 3.1 `File` adalah legacy abstract pathname

`File` berada di package:

```java
java.io.File
```

Ia merepresentasikan pathname dalam default filesystem JVM. Ia bukan abstraction untuk semua `FileSystemProvider`.

Contoh:

```java
File file = new File("/var/app/data/report.csv");
```

Object `file` ini tidak membuka file, tidak membaca metadata, dan tidak memastikan path ada. Ia hanya menyimpan pathname dalam bentuk legacy object.

### 3.2 `Path` adalah path modern yang terikat pada filesystem provider

`Path` berada di:

```java
java.nio.file.Path
```

`Path` adalah representasi path yang berasal dari suatu `FileSystem`.

```java
Path path = Path.of("/var/app/data/report.csv"); // Java 11+
// atau Java 8 compatible:
Path path = Paths.get("/var/app/data/report.csv");
```

Perbedaan besar:

```text
File -> default local filesystem legacy abstraction
Path -> provider-aware path abstraction
```

`Path` bisa berasal dari:

- default filesystem (`file:`);
- ZIP filesystem;
- custom/in-memory filesystem;
- provider lain.

`File` praktis hanya cocok untuk default filesystem.

### 3.3 Tabel perbandingan

| Aspek | `java.io.File` | `java.nio.file.Path` + `Files` |
|---|---|---|
| Diperkenalkan | Java awal | Java 7 / NIO.2 |
| Konsep utama | abstract pathname | provider-aware path |
| Operasi file | method instance di `File` | static method di `Files` + provider |
| Error detail | sering `boolean` | exception detail |
| Provider abstraction | tidak eksplisit | eksplisit via `FileSystemProvider` |
| Attribute view | terbatas | rich attribute views |
| Symlink control | terbatas | `LinkOption.NOFOLLOW_LINKS` |
| Atomic create/move option | terbatas | `CREATE_NEW`, `ATOMIC_MOVE`, etc. |
| Virtual filesystem | tidak cocok | cocok |
| Modern recommendation | compatibility | default choice |

---

## 4. Mental Model: `File` Tidak Sama Dengan File Handle

Ini salah satu miskonsepsi paling umum.

```java
File f = new File("data.txt");
```

Kode di atas:

- tidak membuka file;
- tidak membuat file;
- tidak memegang lock;
- tidak mencegah file dihapus;
- tidak membaca ukuran file;
- tidak memvalidasi permission;
- tidak memastikan path valid;
- tidak memastikan parent directory ada.

File baru benar-benar disentuh saat method tertentu dipanggil:

```java
f.exists();        // query filesystem
f.length();        // query metadata
f.createNewFile(); // attempt create
f.delete();        // attempt delete
new FileInputStream(f); // open file handle for reading
```

Jadi object `File` lebih mirip:

```text
A reusable pathname token for default filesystem operations.
```

Bukan:

```text
An opened file.
A locked file.
A guaranteed existing file.
A metadata snapshot.
```

---

## 5. Masalah Besar `File`: Boolean Error Reporting

Banyak method `File` mengembalikan `boolean`:

```java
file.delete();
file.mkdir();
file.mkdirs();
file.renameTo(target);
file.setReadable(true);
file.setWritable(false);
```

Problemnya: `false` tidak menjelaskan kenapa gagal.

Contoh:

```java
boolean deleted = file.delete();
if (!deleted) {
    throw new IllegalStateException("Cannot delete file: " + file);
}
```

Apa penyebabnya?

- file tidak ada?
- permission ditolak?
- path adalah directory non-empty?
- file sedang terbuka?
- read-only attribute?
- parent path tidak ada?
- filesystem read-only?
- network filesystem error?
- path invalid?
- security restriction?

Dengan `File`, banyak penyebab collapse menjadi `false`.

Dengan `Files.delete`:

```java
Files.delete(path);
```

Kamu bisa mendapat exception lebih spesifik:

```text
NoSuchFileException
DirectoryNotEmptyException
AccessDeniedException
FileSystemException
IOException
SecurityException
```

Ini sangat penting untuk production troubleshooting.

### 5.1 Rule of thumb

```text
Jika operasi file bisa gagal dan kamu perlu tahu kenapa, gunakan Files API.
```

`File` boleh dipakai sebagai boundary compatibility, tetapi segera convert ke `Path` untuk operasi serius.

---

## 6. Interop: `File.toPath()`

`File` punya method:

```java
Path path = file.toPath();
```

Ini cara utama mengubah `File` ke `Path`.

Contoh:

```java
public static long sizeOf(File file) throws IOException {
    return Files.size(file.toPath());
}
```

### 6.1 Kenapa `toPath()` penting?

Karena begitu masuk ke `Path`, kamu bisa memakai API modern:

```java
Path path = file.toPath();

if (Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
    long size = Files.size(path);
    BasicFileAttributes attrs = Files.readAttributes(
        path,
        BasicFileAttributes.class,
        LinkOption.NOFOLLOW_LINKS
    );
}
```

### 6.2 `toPath()` tidak membuka file

Sama seperti `new File(...)`, `toPath()` hanya mengubah representasi path.

```java
File file = new File("missing.txt");
Path path = file.toPath();
```

Kode itu valid walaupun `missing.txt` belum ada.

---

## 7. Interop: `Path.toFile()`

`Path` punya method:

```java
File file = path.toFile();
```

Tetapi ada batas penting:

```text
Path.toFile() hanya bekerja untuk Path yang associated dengan default provider.
```

Jika `Path` berasal dari ZIP filesystem, in-memory filesystem, atau provider custom, `toFile()` dapat melempar:

```java
UnsupportedOperationException
```

Contoh konseptual:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, Map.of())) {
    Path insideZip = zipfs.getPath("/data/config.json");
    File file = insideZip.toFile(); // UnsupportedOperationException
}
```

Kenapa?

Karena `File` tidak bisa merepresentasikan path internal ZIP filesystem sebagai file biasa di OS.

### 7.1 Rule penting

```text
Jangan sembarangan panggil path.toFile() di library modern.
```

Lebih aman:

```java
if (path.getFileSystem().equals(FileSystems.getDefault())) {
    File file = path.toFile();
    legacyApi(file);
} else {
    // fallback: copy to temp file, stream content, or reject unsupported provider
}
```

Namun `equals` pada filesystem bukan selalu design terbaik. Biasanya lebih jelas membuat kontrak eksplisit:

```java
public void loadFromDefaultFilesystem(Path path) {
    requireDefaultFilesystem(path);
    legacyApi(path.toFile());
}
```

---

## 8. Adapter Boundary Pattern

Saat code modern harus memanggil library lama yang menerima `File`, jangan biarkan `File` bocor ke seluruh domain logic.

### 8.1 Anti-pattern

```java
public class ReportService {
    public void generate(File outputDir) {
        File tmp = new File(outputDir, "report.tmp");
        File finalFile = new File(outputDir, "report.csv");
        // many legacy operations here...
    }
}
```

Problem:

- service domain menjadi tergantung `File`;
- error detail rendah;
- susah test dengan provider lain;
- susah mengontrol symlink;
- migration nanti mahal.

### 8.2 Pattern yang lebih baik

```java
public class ReportService {
    public void generate(Path outputDir) throws IOException {
        Files.createDirectories(outputDir);

        Path temp = Files.createTempFile(outputDir, "report-", ".tmp");
        Path target = outputDir.resolve("report.csv");

        writeReport(temp);
        Files.move(temp, target,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);
    }

    private void writeReport(Path path) throws IOException {
        // modern implementation
    }
}
```

Jika ada legacy API:

```java
private void callLegacyLibrary(Path path) throws IOException {
    if (!path.getFileSystem().equals(FileSystems.getDefault())) {
        throw new UnsupportedOperationException(
            "Legacy library requires default filesystem path: " + path);
    }

    legacyLibrary.load(path.toFile());
}
```

Atau jika ingin mendukung provider non-default:

```java
private void callLegacyLibraryThroughTempFile(Path input) throws IOException {
    Path temp = Files.createTempFile("legacy-input-", ".bin");
    try {
        Files.copy(input, temp, StandardCopyOption.REPLACE_EXISTING);
        legacyLibrary.load(temp.toFile());
    } finally {
        Files.deleteIfExists(temp);
    }
}
```

Trade-off:

- mendukung provider non-default;
- tetapi ada biaya copy;
- metadata mungkin hilang;
- file besar bisa mahal;
- lifecycle temp file harus aman;
- security scanning tetap perlu.

---

## 9. `File` Constructors dan Path Construction Pitfalls

`File` punya beberapa constructor umum:

```java
new File(String pathname)
new File(String parent, String child)
new File(File parent, String child)
new File(URI uri)
```

### 9.1 `new File(String)`

```java
File file = new File("data/report.csv");
```

Ini relative path terhadap current working directory JVM.

Problem:

```text
Current working directory bisa berbeda antara local dev, test runner, IDE, service manager, Docker, Kubernetes, cron, dan app server.
```

Jangan gunakan relative `File` tanpa base directory eksplisit untuk production workflow.

Lebih baik:

```java
Path baseDir = config.getDataDirectory();
Path report = baseDir.resolve("report.csv");
```

### 9.2 `new File(parent, child)`

```java
File file = new File(parentDir, childName);
```

Ini lebih baik daripada string concatenation:

```java
// buruk
File file = new File(parentDir.getPath() + "/" + childName);
```

Tetapi tetap tidak menyelesaikan:

- path traversal;
- symlink race;
- provider non-default;
- error detail rendah.

Dengan `Path`:

```java
Path file = parent.resolve(childName);
```

Lalu validasi sesuai konteks.

### 9.3 `new File(URI)`

`File(URI)` hanya cocok untuk URI `file:` yang memenuhi constraint tertentu.

Jangan menganggap semua URI bisa jadi `File`:

```java
URI uri = URI.create("s3://bucket/key");
new File(uri); // invalid concept
```

`File` bukan abstraction untuk HTTP/S3/ZIP/custom provider.

---

## 10. Absolute vs Canonical dalam `File`

`File` punya:

```java
file.getPath();
file.getAbsolutePath();
file.getCanonicalPath();
file.getAbsoluteFile();
file.getCanonicalFile();
```

Ini sering membingungkan.

### 10.1 `getPath()`

Mengembalikan path string sebagaimana disimpan object, kurang lebih.

```java
File file = new File("data/../config/app.yml");
System.out.println(file.getPath());
```

Bisa tetap berisi `..`.

### 10.2 `getAbsolutePath()`

Mengubah relative path menjadi absolute berdasarkan current working directory.

```java
File file = new File("data/app.yml");
String abs = file.getAbsolutePath();
```

Tapi ini belum tentu menyelesaikan symlink, `.`/`..`, case normalization, atau canonical filesystem mapping.

### 10.3 `getCanonicalPath()`

Canonical path mencoba menghasilkan pathname yang absolute dan unik menurut aturan system-dependent.

Biasanya mencakup:

- menjadikan absolute;
- menyelesaikan `.` dan `..`;
- menyelesaikan symlink pada beberapa platform/kondisi;
- melakukan normalisasi system-dependent.

Namun:

```text
canonical path membutuhkan akses filesystem dan bisa throw IOException.
```

Contoh:

```java
File file = new File("data/../config/app.yml");
String canonical = file.getCanonicalPath();
```

### 10.4 Jangan jadikan canonical path sebagai silver bullet security

Banyak code lama melakukan:

```java
File base = new File("/app/uploads").getCanonicalFile();
File target = new File(base, userInput).getCanonicalFile();

if (!target.getPath().startsWith(base.getPath())) {
    throw new SecurityException("Path traversal");
}
```

Ini lebih baik daripada string check mentah, tapi belum cukup untuk semua kasus:

- symlink bisa berubah setelah check;
- race condition tetap ada;
- case-insensitive filesystem perlu perhatian;
- Unicode normalization issue;
- base path prefix string bisa misleading jika tidak pakai separator boundary;
- Windows path nuance;
- operasi setelah check tetap bisa diarahkan ulang jika directory diganti.

Dengan NIO modern, pendekatan lebih eksplisit:

```java
Path base = uploadRoot.toRealPath(LinkOption.NOFOLLOW_LINKS);
Path candidate = base.resolve(userInput).normalize();

// Untuk file yang harus sudah ada:
Path real = candidate.toRealPath(LinkOption.NOFOLLOW_LINKS);
if (!real.startsWith(base)) {
    throw new SecurityException("Outside upload root");
}
```

Untuk file baru, pendekatannya beda karena `toRealPath` butuh file ada. Biasanya gunakan randomized server-side filename dan jangan pakai user input sebagai path segment storage.

---

## 11. `File.exists()` dan Problem Unknown State

`File.exists()` mengembalikan boolean:

```java
if (file.exists()) {
    // use file
}
```

Masalah:

1. `false` bisa berarti tidak ada;
2. `false` bisa berarti tidak bisa dicek karena permission/security;
3. file bisa berubah setelah check;
4. check bukan lock;
5. check bukan reservation.

NIO punya `Files.exists` dan `Files.notExists`, tapi bahkan di NIO pun ada unknown state. Karena itu, prinsip production tetap:

```text
Jangan check lalu assume.
Langsung lakukan operasi yang kamu butuhkan, lalu handle exception.
```

### 11.1 Anti-pattern legacy

```java
if (!file.exists()) {
    file.createNewFile();
}
```

Ada race:

```text
Thread/process lain bisa membuat file antara exists() dan createNewFile().
```

Lebih baik:

```java
Files.createFile(file.toPath());
```

atau:

```java
try {
    Files.createFile(path);
} catch (FileAlreadyExistsException e) {
    // handle existing
}
```

### 11.2 `File.createNewFile()`

`File.createNewFile()` lebih baik daripada `exists` + create karena melakukan check-and-create secara atomic relatif terhadap operasi filesystem lain.

```java
boolean created = file.createNewFile();
```

Tapi tetap punya kekurangan:

- return `false` jika sudah ada;
- exception untuk beberapa error;
- tidak punya options sekaya NIO;
- tidak terintegrasi dengan provider non-default;
- permission-at-create-time lebih terbatas dibanding `Files.createFile(path, attrs)`.

Untuk code modern:

```java
Files.createFile(path, attrs);
```

---

## 12. `File.isFile()`, `isDirectory()`, `isHidden()`

Legacy checks:

```java
file.isFile();
file.isDirectory();
file.isHidden();
```

Keterbatasan:

- boolean collapse;
- symlink behavior kurang eksplisit;
- race condition;
- provider default only.

Modern equivalent:

```java
Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS);
Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS);
Files.isHidden(path);
```

Tetapi ingat:

```text
Type check tetap bukan lock.
```

Jika kamu check directory lalu membuat file di dalamnya, directory bisa diganti symlink setelah check jika environment hostile.

---

## 13. `File.length()` dan Metadata Staleness

```java
long size = file.length();
```

Keterbatasan:

- return `0L` jika file tidak ada atau error tertentu;
- tidak membedakan empty file vs failure;
- size bisa berubah setelah dibaca;
- untuk directory behavior system-dependent;
- symlink behavior tidak sejelas NIO.

Modern:

```java
long size = Files.size(path);
```

Jika gagal, kamu dapat `IOException`.

Untuk banyak metadata sekaligus:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

long size = attrs.size();
FileTime modified = attrs.lastModifiedTime();
```

Ini lebih baik daripada beberapa syscall terpisah:

```java
file.exists();
file.isFile();
file.length();
file.lastModified();
```

---

## 14. `File.delete()` vs `Files.delete()`

### 14.1 Legacy delete

```java
boolean ok = file.delete();
```

Jika `false`, kamu tidak tahu penyebab detail.

### 14.2 Modern delete

```java
Files.delete(path);
```

Dapat exception yang lebih berguna.

```java
try {
    Files.delete(path);
} catch (NoSuchFileException e) {
    // missing
} catch (DirectoryNotEmptyException e) {
    // dir not empty
} catch (AccessDeniedException e) {
    // permission/open handle/read-only/etc.
}
```

### 14.3 Java 25 Windows note

Di JDK 25, ada perubahan behavior terkait `File.delete()` di Windows: regular file dengan DOS read-only attribute sekarang gagal dan mengembalikan `false`, alih-alih menghapus read-only attribute terlebih dahulu seperti sebelumnya. Perubahan ini mengurangi risiko operasi non-atomic yang dapat meninggalkan file dengan attribute berubah jika delete gagal.

Pelajaran penting:

```text
Legacy API behavior bisa punya detail platform/JDK-version-specific.
Untuk code baru, gunakan Files.delete agar reason lebih jelas.
```

---

## 15. `File.renameTo()` adalah API yang Harus Diperlakukan Berbahaya

Legacy rename:

```java
boolean ok = source.renameTo(target);
```

Problem:

- return `false` tanpa alasan detail;
- behavior sangat platform-dependent;
- tidak jelas replace existing atau tidak;
- tidak jelas atomic atau tidak;
- cross-filesystem behavior tidak reliable;
- tidak ada explicit `ATOMIC_MOVE`;
- tidak ada explicit `REPLACE_EXISTING`.

Modern:

```java
Files.move(sourcePath, targetPath,
    StandardCopyOption.ATOMIC_MOVE,
    StandardCopyOption.REPLACE_EXISTING);
```

Atau jika atomic tidak wajib:

```java
Files.move(sourcePath, targetPath,
    StandardCopyOption.REPLACE_EXISTING);
```

Jika atomic tidak didukung:

```java
try {
    Files.move(source, target,
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException e) {
    // decide fallback or fail
}
```

### 15.1 Rule production

```text
Jangan gunakan File.renameTo untuk workflow correctness-critical.
```

Gunakan `Files.move`.

---

## 16. Directory Creation: `mkdir` dan `mkdirs`

Legacy:

```java
file.mkdir();
file.mkdirs();
```

Problem:

- boolean error reporting;
- `mkdirs` bisa membuat sebagian parent lalu gagal;
- tidak mudah set attributes at creation;
- tidak memberi detail failure.

Modern:

```java
Files.createDirectory(path);
Files.createDirectories(path);
```

`createDirectories` tetap bisa partial create lalu gagal, tapi exception detail lebih baik.

Untuk permission-at-create-time:

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rwx------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

Files.createDirectory(path, attr);
```

Ingat: POSIX attribute hanya jika provider/filesystem support.

---

## 17. Directory Listing: `list`, `listFiles`, dan Null Problem

Legacy:

```java
String[] names = dir.list();
File[] files = dir.listFiles();
```

Keduanya bisa mengembalikan `null` jika:

- path bukan directory;
- I/O error terjadi;
- permission denied;
- security restriction.

Banyak bug legacy terjadi karena:

```java
for (File child : dir.listFiles()) { // NPE risk
    ...
}
```

Lebih defensif:

```java
File[] children = dir.listFiles();
if (children == null) {
    throw new IOException("Cannot list directory: " + dir);
}
for (File child : children) {
    ...
}
```

Namun modern lebih baik:

```java
try (Stream<Path> children = Files.list(dir.toPath())) {
    children.forEach(System.out::println);
}
```

Atau untuk directory besar:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
    for (Path child : stream) {
        // process one by one
    }
}
```

### 17.1 Memory behavior

`File.listFiles()` biasanya membangun array semua children.

Untuk directory besar:

```text
listFiles() can be memory-hostile.
DirectoryStream is usually better for large directories.
```

---

## 18. Recursive Traversal Legacy vs `walkFileTree`

Legacy recursive traversal sering seperti ini:

```java
void deleteRecursively(File file) {
    if (file.isDirectory()) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
    }
    file.delete();
}
```

Masalah:

- `listFiles()` null ignored;
- delete failure ignored;
- symlink handling tidak eksplisit;
- stack overflow untuk tree dalam;
- race condition tidak dipikirkan;
- error handling buruk;
- tidak ada skip subtree strategy;
- tidak ada cycle detection eksplisit.

Modern:

```java
Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
            throws IOException {
        Files.delete(file);
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult postVisitDirectory(Path dir, IOException exc)
            throws IOException {
        if (exc != null) throw exc;
        Files.delete(dir);
        return FileVisitResult.CONTINUE;
    }
});
```

Ini tidak otomatis membuat semua aman, tapi memberi struktur operasi tree yang jauh lebih benar.

---

## 19. File Filters: `FileFilter` dan `FilenameFilter`

Legacy API:

```java
File[] csvFiles = dir.listFiles(new FilenameFilter() {
    @Override
    public boolean accept(File dir, String name) {
        return name.endsWith(".csv");
    }
});
```

Atau lambda:

```java
File[] csvFiles = dir.listFiles((d, name) -> name.endsWith(".csv"));
```

Modern dengan `DirectoryStream` glob:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.csv")) {
    for (Path path : stream) {
        ...
    }
}
```

Modern dengan stream:

```java
try (Stream<Path> stream = Files.list(dir)) {
    List<Path> csv = stream
        .filter(p -> p.getFileName().toString().endsWith(".csv"))
        .toList(); // Java 16+
}
```

Java 8 compatible:

```java
try (Stream<Path> stream = Files.list(dir)) {
    List<Path> csv = stream
        .filter(p -> p.getFileName().toString().endsWith(".csv"))
        .collect(Collectors.toList());
}
```

### 19.1 Extension check warning

`endsWith(".csv")` is not security validation. It is a naming filter.

Untuk upload/security, lihat Part 23.

---

## 20. `File` Permission Methods: Limited and Misleading

Legacy:

```java
file.canRead();
file.canWrite();
file.canExecute();
file.setReadable(true);
file.setWritable(false);
file.setExecutable(true);
```

Problem:

- boolean result;
- permission model terlalu sederhana;
- POSIX vs ACL mismatch;
- effective access bisa berubah;
- check bukan guarantee operasi berikutnya sukses;
- tidak cukup untuk container/Kubernetes volume edge cases.

Modern:

```java
Files.isReadable(path);
Files.isWritable(path);
Files.isExecutable(path);
```

Tetap check ini bukan guarantee. Untuk permission detail:

```java
Set<PosixFilePermission> perms = Files.getPosixFilePermissions(path);
```

Untuk owner:

```java
UserPrincipal owner = Files.getOwner(path);
```

Untuk ACL:

```java
AclFileAttributeView aclView = Files.getFileAttributeView(
    path,
    AclFileAttributeView.class
);
```

Gunakan capability detection:

```java
FileStore store = Files.getFileStore(path);
boolean supportsPosix = store.supportsFileAttributeView(PosixFileAttributeView.class);
```

---

## 21. `File` dan Security Manager: Historical Context

Banyak dokumentasi lama `File` menyebut `SecurityException` jika Security Manager menolak akses.

Namun pada Java modern, Security Manager sudah berubah status besar-besaran dan akhirnya dinonaktifkan permanen mulai Java 24 melalui JEP 486. Artinya, jangan mendesain sandbox file access baru mengandalkan Security Manager.

Untuk sistem modern, boundary security harus berada di:

- OS user permission;
- container isolation;
- Kubernetes security context;
- mounted volume permission;
- application-level path containment;
- allowlist directory;
- ACL/POSIX permission;
- object storage IAM jika bukan filesystem lokal;
- process isolation;
- seccomp/AppArmor/SELinux bila relevan.

`File` bukan security boundary.

---

## 22. URI, URL, dan `File`: Jangan Campur Sembarangan

Legacy code sering melakukan:

```java
File file = new File(resourceUrl.getFile());
```

Ini rawan bug karena:

- URL encoding `%20`;
- path dengan special characters;
- resource mungkin berada di JAR;
- resource mungkin bukan local file;
- Windows path nuance;
- URI authority issue.

### 22.1 Resource di classpath bukan selalu `File`

Saat running dari exploded classes di IDE:

```text
src/main/resources/config.yml -> mungkin tampak sebagai file biasa
```

Saat running dari JAR:

```text
config.yml berada di dalam JAR, bukan File biasa di filesystem
```

Anti-pattern:

```java
URL url = getClass().getResource("/config.yml");
File file = new File(url.getFile()); // bisa gagal saat dalam JAR
```

Lebih baik baca sebagai stream:

```java
try (InputStream in = getClass().getResourceAsStream("/config.yml")) {
    if (in == null) {
        throw new FileNotFoundException("Classpath resource not found");
    }
    // read from stream
}
```

Jika benar-benar butuh `Path`, kamu harus pahami resource location dan provider.

### 22.2 `Path` dari URI

```java
Path path = Paths.get(uri); // Java 8 compatible
```

atau provider-specific:

```java
FileSystems.newFileSystem(uri, env);
```

Tetapi tidak semua URI adalah file path.

---

## 23. `File.separator`, `pathSeparator`, dan String Path Anti-Pattern

Legacy constants:

```java
File.separator
File.separatorChar
File.pathSeparator
File.pathSeparatorChar
```

Bedanya:

```text
separator     -> pemisah path segment dalam satu path. Contoh: / atau \
pathSeparator -> pemisah beberapa path dalam list. Contoh: : atau ;
```

Contoh:

```text
Unix path separator: /
Windows path separator: \
Unix path list separator: :
Windows path list separator: ;
```

Anti-pattern:

```java
String path = base + File.separator + child;
```

Masalah:

- double separator;
- child absolute bisa override mental model;
- path traversal tetap ada;
- provider non-default hilang;
- readability buruk.

Modern:

```java
Path path = base.resolve(child);
```

Untuk banyak segment:

```java
Path path = base.resolve("reports").resolve("2026").resolve("summary.csv");
```

Java 11+:

```java
Path path = Path.of(baseString, "reports", "2026", "summary.csv");
```

Java 8:

```java
Path path = Paths.get(baseString, "reports", "2026", "summary.csv");
```

---

## 24. Legacy `File` dan Current Working Directory

Relative `File` bergantung pada `user.dir`.

```java
System.out.println(System.getProperty("user.dir"));
File f = new File("data/app.yml");
System.out.println(f.getAbsolutePath());
```

Di local IDE mungkin:

```text
/home/fajar/project/data/app.yml
```

Di service mungkin:

```text
/opt/app/data/app.yml
```

Di Docker:

```text
/app/data/app.yml
```

Di Kubernetes dengan workingDir lain:

```text
/data/app.yml
```

Production rule:

```text
Jangan desain storage workflow bergantung diam-diam pada current working directory.
```

Gunakan config eksplisit:

```java
Path dataDir = Path.of(System.getenv("APP_DATA_DIR"));
```

Java 8:

```java
Path dataDir = Paths.get(System.getenv("APP_DATA_DIR"));
```

Lalu validate saat startup:

```java
Path realDataDir = dataDir.toRealPath(LinkOption.NOFOLLOW_LINKS);
if (!Files.isDirectory(realDataDir)) {
    throw new IllegalStateException("APP_DATA_DIR is not a directory: " + realDataDir);
}
```

---

## 25. Mixing `File` and `Path`: Common Bugs

### 25.1 Bug: assuming `file.toPath().toFile().equals(file)`

Dokumentasi `Path.toFile()` memberi catatan bahwa jika path dibuat dari `File.toPath()`, tidak ada guarantee `File` yang dikembalikan oleh `toFile()` equal dengan original `File`.

Jangan pakai equality object untuk security/correctness.

### 25.2 Bug: losing provider

```java
void process(Path path) {
    File file = path.toFile();
    process(file);
}
```

Ini gagal untuk non-default provider.

Lebih baik:

```java
void process(Path path) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        process(in);
    }
}
```

Design API berdasarkan capability:

```text
Butuh bytes? Terima InputStream atau Path.
Butuh default filesystem file? Terima File atau documented Path default-only.
Butuh tree traversal? Terima Path.
Butuh classpath resource? Terima InputStream/URL, bukan File.
```

### 25.3 Bug: normalisasi string berbeda dari filesystem

```java
String normalized = file.getPath().replace("\\", "/");
```

Ini bukan path normalization yang benar.

Gunakan:

```java
Path normalized = path.normalize();
```

atau untuk existing path:

```java
Path real = path.toRealPath(LinkOption.NOFOLLOW_LINKS);
```

### 25.4 Bug: deleting via legacy and ignoring failure

```java
file.delete(); // ignored
```

Lebih baik:

```java
Files.delete(file.toPath());
```

Atau minimal:

```java
if (!file.delete()) {
    throw new IOException("Failed to delete " + file);
}
```

Tapi tetap kalah informatif dari `Files.delete`.

---

## 26. Migration Strategy: Dari `File` ke `Path`

Migration yang baik tidak harus big-bang. Untuk codebase besar, gunakan strategi bertahap.

### 26.1 Step 1 — Ubah internal domain API ke `Path`

Sebelum:

```java
public void importFile(File file) {
    ...
}
```

Sesudah:

```java
public void importFile(Path path) throws IOException {
    ...
}
```

Jika external caller masih memakai `File`:

```java
public void importFile(File file) throws IOException {
    importFile(file.toPath());
}
```

Tandai overload legacy:

```java
/**
 * @deprecated Use {@link #importFile(Path)}.
 */
@Deprecated
public void importFile(File file) throws IOException {
    importFile(file.toPath());
}
```

### 26.2 Step 2 — Convert operasi ke `Files`

Sebelum:

```java
if (!dir.exists()) {
    dir.mkdirs();
}
```

Sesudah:

```java
Files.createDirectories(dir);
```

Sebelum:

```java
if (file.exists() && file.isFile()) {
    long size = file.length();
}
```

Sesudah:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

if (attrs.isRegularFile()) {
    long size = attrs.size();
}
```

### 26.3 Step 3 — Replace `renameTo`

Sebelum:

```java
if (!tmp.renameTo(target)) {
    throw new IOException("Rename failed");
}
```

Sesudah:

```java
Files.move(tmp, target,
    StandardCopyOption.REPLACE_EXISTING,
    StandardCopyOption.ATOMIC_MOVE);
```

Jika fallback diperlukan:

```java
try {
    Files.move(tmp, target,
        StandardCopyOption.REPLACE_EXISTING,
        StandardCopyOption.ATOMIC_MOVE);
} catch (AtomicMoveNotSupportedException e) {
    Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
}
```

Tapi fallback harus diputuskan sadar. Untuk config/checkpoint critical, lebih baik fail daripada fallback non-atomic diam-diam.

### 26.4 Step 4 — Replace recursive traversal

Sebelum:

```java
void scan(File dir) {
    File[] files = dir.listFiles();
    if (files == null) return;
    for (File file : files) {
        if (file.isDirectory()) scan(file);
        else process(file);
    }
}
```

Sesudah:

```java
Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
            throws IOException {
        process(file, attrs);
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFileFailed(Path file, IOException exc)
            throws IOException {
        // choose fail-fast or collect error
        throw exc;
    }
});
```

### 26.5 Step 5 — Isolate unavoidable legacy APIs

Buat adapter:

```java
final class LegacyFileAdapter {
    static File requireDefaultFile(Path path) {
        if (!path.getFileSystem().equals(FileSystems.getDefault())) {
            throw new UnsupportedOperationException(
                "Path is not on default filesystem: " + path);
        }
        return path.toFile();
    }
}
```

Lalu semua `toFile()` hanya boleh berada di adapter boundary.

---

## 27. Designing New APIs: Terima `Path`, `InputStream`, atau `File`?

Tidak semua API harus menerima `Path`.

Pilih berdasarkan kebutuhan.

### 27.1 Jika butuh akses filesystem operation

Gunakan `Path`:

```java
void importFrom(Path file) throws IOException;
void exportTo(Path directory) throws IOException;
void scanTree(Path root) throws IOException;
```

Karena kamu butuh:

- attributes;
- move/copy/delete;
- traversal;
- open options;
- provider semantics.

### 27.2 Jika hanya butuh membaca bytes

Gunakan `InputStream`:

```java
Document parse(InputStream input) throws IOException;
```

Ini membuat API bisa menerima:

- file;
- classpath resource;
- HTTP response;
- ZIP entry;
- memory buffer;
- object storage stream.

Jika perlu nama untuk error message:

```java
Document parse(String sourceName, InputStream input) throws IOException;
```

### 27.3 Jika butuh menulis bytes ke target generic

Gunakan `OutputStream`:

```java
void writeReport(OutputStream output) throws IOException;
```

### 27.4 Jika benar-benar butuh local default filesystem legacy compatibility

Gunakan `File`, tapi dokumentasikan:

```java
void loadLegacyPlugin(File pluginJar);
```

Artinya:

```text
This API requires a default local filesystem file.
```

Jangan pura-pura mendukung provider lain.

---

## 28. Java 8–25 Compatibility Notes

### 28.1 Java 8

Java 8 sudah punya:

- `Path`;
- `Paths`;
- `Files`;
- `FileSystem`;
- `FileSystemProvider`;
- `FileVisitor`;
- `FileChannel`;
- `StandardOpenOption`;
- `StandardCopyOption`;
- `LinkOption`;
- attribute views;
- `File.toPath()`;
- `Path.toFile()`.

Jadi migration dari `File` ke NIO.2 bisa dilakukan bahkan di Java 8.

### 28.2 Java 11+

`Path.of(...)` tersedia dan lebih modern daripada `Paths.get(...)`.

Namun untuk materi Java 8-compatible, gunakan:

```java
Paths.get("data", "file.txt")
```

Untuk code Java 11+:

```java
Path.of("data", "file.txt")
```

### 28.3 Java 16+

`Stream.toList()` tersedia.

Java 8 compatible:

```java
.collect(Collectors.toList())
```

### 28.4 Java 24/25

Security Manager tidak bisa dijadikan basis sandbox baru.

JDK 25 juga membawa perubahan behavior `File.delete()` pada Windows terkait DOS read-only attribute. Jadi code legacy yang diam-diam bergantung pada behavior lama bisa terdampak.

---

## 29. Practical Refactoring Examples

### 29.1 Refactor: read all text

Legacy:

```java
String readText(File file) throws IOException {
    StringBuilder sb = new StringBuilder();
    try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line).append(System.lineSeparator());
        }
    }
    return sb.toString();
}
```

Problems:

- default charset if `FileReader` used without charset in old style;
- unnecessary boilerplate;
- hard to reason about large file if blindly accumulated.

Modern small-file version Java 11+:

```java
String readText(Path path) throws IOException {
    return Files.readString(path, StandardCharsets.UTF_8);
}
```

Java 8 compatible:

```java
String readText(Path path) throws IOException {
    byte[] bytes = Files.readAllBytes(path);
    return new String(bytes, StandardCharsets.UTF_8);
}
```

Streaming version:

```java
void processLines(Path path, Consumer<String> consumer) throws IOException {
    try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
        String line;
        while ((line = reader.readLine()) != null) {
            consumer.accept(line);
        }
    }
}
```

### 29.2 Refactor: write config safely

Legacy:

```java
void writeConfig(File file, String content) throws IOException {
    try (FileWriter writer = new FileWriter(file)) {
        writer.write(content);
    }
}
```

Problems:

- default charset in old style;
- truncate target directly;
- crash can leave partial file;
- no atomic replace.

Modern:

```java
void writeConfig(Path target, String content) throws IOException {
    Path dir = target.toAbsolutePath().getParent();
    Files.createDirectories(dir);

    Path temp = Files.createTempFile(dir, target.getFileName().toString(), ".tmp");
    try {
        try (FileChannel channel = FileChannel.open(temp,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING)) {
            ByteBuffer buffer = StandardCharsets.UTF_8.encode(content);
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }
            channel.force(true);
        }

        Files.move(temp, target,
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE);
    } catch (IOException | RuntimeException e) {
        try {
            Files.deleteIfExists(temp);
        } catch (IOException suppressed) {
            e.addSuppressed(suppressed);
        }
        throw e;
    }
}
```

### 29.3 Refactor: delete recursively

Legacy:

```java
void delete(File file) {
    if (file.isDirectory()) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                delete(child);
            }
        }
    }
    file.delete();
}
```

Modern:

```java
void deleteTree(Path root) throws IOException {
    Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
                throws IOException {
            Files.delete(file);
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult postVisitDirectory(Path dir, IOException exc)
                throws IOException {
            if (exc != null) throw exc;
            Files.delete(dir);
            return FileVisitResult.CONTINUE;
        }
    });
}
```

### 29.4 Refactor: safe legacy adapter

Suppose old library:

```java
class OldLibrary {
    void load(File file) { ... }
}
```

Modern service:

```java
class ModernService {
    private final OldLibrary oldLibrary;

    ModernService(OldLibrary oldLibrary) {
        this.oldLibrary = oldLibrary;
    }

    void load(Path path) throws IOException {
        Path real = path.toRealPath(LinkOption.NOFOLLOW_LINKS);

        if (!real.getFileSystem().equals(FileSystems.getDefault())) {
            throw new UnsupportedOperationException(
                "OldLibrary only supports default filesystem paths: " + real);
        }

        oldLibrary.load(real.toFile());
    }
}
```

Jika input bisa dari non-default provider:

```java
void load(Path path) throws IOException {
    Path temp = Files.createTempFile("old-library-", ".input");
    try {
        Files.copy(path, temp, StandardCopyOption.REPLACE_EXISTING);
        oldLibrary.load(temp.toFile());
    } finally {
        Files.deleteIfExists(temp);
    }
}
```

---

## 30. Error Handling Upgrade: Dari Boolean ke Exception Taxonomy

Sebelum migration:

```java
if (!file.delete()) {
    log.warn("Delete failed: {}", file);
}
```

Sesudah:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException e) {
    log.info("File already absent: {}", path);
} catch (DirectoryNotEmptyException e) {
    log.warn("Directory is not empty: {}", path);
} catch (AccessDeniedException e) {
    log.error("Access denied deleting {}: {}", path, e.getMessage(), e);
} catch (IOException e) {
    log.error("I/O error deleting {}: {}", path, e.getMessage(), e);
}
```

Top engineer bukan hanya “mengganti API”, tetapi meningkatkan observability dan failure classification.

---

## 31. When Keeping `File` Is Acceptable

`File` masih acceptable jika:

1. kamu memanggil legacy API yang memang butuh `File`;
2. kamu sedang mengelola boundary UI lama seperti `JFileChooser`;
3. kamu maintain code lama dan perubahan besar tidak feasible;
4. operasi sangat sederhana dan bukan correctness-critical;
5. path memang harus default local filesystem;
6. kamu segera convert ke `Path` untuk operasi serius.

Contoh acceptable:

```java
File selected = fileChooser.getSelectedFile();
Path selectedPath = selected.toPath();
importService.importFile(selectedPath);
```

Tidak acceptable untuk sistem modern:

```java
// entire storage engine built on File with boolean error handling
```

---

## 32. When `File` Should Be Avoided Completely

Hindari `File` untuk:

- secure upload storage;
- path traversal sensitive workflow;
- archive extraction;
- atomic update;
- recursive delete/copy;
- metadata-heavy operation;
- cross-platform permission handling;
- file watcher integration;
- custom/ZIP/in-memory filesystem;
- cloud-like provider;
- correctness-critical rename/move;
- production cleanup job yang butuh diagnostics;
- distributed file workflow.

Gunakan `Path`, `Files`, `FileChannel`, dan `FileVisitor`.

---

## 33. Legacy Code Review Checklist

Saat review code berbasis `File`, cari red flag berikut.

### 33.1 Error handling

Red flags:

```java
file.delete();
file.mkdir();
file.mkdirs();
file.renameTo(target);
```

tanpa check result.

Better:

```java
Files.delete(path);
Files.createDirectories(path);
Files.move(source, target, options...);
```

### 33.2 Race condition

Red flags:

```java
if (!file.exists()) {
    file.createNewFile();
}
```

Better:

```java
Files.createFile(path);
```

### 33.3 Directory traversal

Red flags:

```java
new File(uploadDir, userInput)
```

without containment validation.

Better:

```java
// use server-generated name
// validate real path where applicable
// avoid user input as storage path
```

### 33.4 Recursive delete

Red flags:

```java
void delete(File f) { ... f.delete(); }
```

Better:

```java
Files.walkFileTree(...)
```

### 33.5 Classpath resource as file

Red flags:

```java
new File(getClass().getResource("/x").getFile())
```

Better:

```java
getResourceAsStream
```

### 33.6 Default charset

Red flags:

```java
new FileReader(file)
new FileWriter(file)
```

Better:

```java
Files.newBufferedReader(path, StandardCharsets.UTF_8)
Files.newBufferedWriter(path, StandardCharsets.UTF_8, options...)
```

### 33.7 String path concatenation

Red flags:

```java
base + "/" + child
base + File.separator + child
```

Better:

```java
base.resolve(child)
```

---

## 34. Top 1% Mental Model

A strong engineer sees `java.io.File` like this:

```text
File is a legacy default-filesystem pathname object.
It is useful at compatibility boundaries.
It is not the modern filesystem programming model.
```

A weak migration simply changes syntax:

```text
File -> Path
```

A strong migration changes semantics:

```text
boolean failure -> exception taxonomy
string path -> provider-aware path
direct target write -> temp + atomic move
recursive ad-hoc traversal -> FileVisitor
extension trust -> content validation
relative cwd dependency -> explicit base directory
uncontrolled symlink following -> explicit LinkOption
legacy rename -> Files.move with options
unchecked deletion -> classified failure handling
```

The real upgrade is not API fashion. It is correctness.

---

## 35. Practical Decision Matrix

| Situation | Recommended Type/API |
|---|---|
| Modern filesystem operation | `Path` + `Files` |
| Need read-only generic input | `InputStream` |
| Need generic output | `OutputStream` |
| Need random access | `FileChannel` / `SeekableByteChannel` |
| Need recursive traversal | `walkFileTree` + `FileVisitor` |
| Need legacy library interop | `Path` internally, `toFile()` at boundary |
| Need classpath resource | `InputStream`, not `File` |
| Need ZIP/JAR internal path | ZIP `FileSystem`, not `File` |
| Need secure upload storage | `Path` + validation + server-generated names |
| Need atomic replacement | `Files.move(..., ATOMIC_MOVE)` |
| Need reasoned delete failure | `Files.delete` |

---

## 36. Summary

`java.io.File` is not useless. It is legacy, but it remains part of real Java engineering because compatibility lasts decades.

But for advanced file/filesystem engineering, the default should be:

```text
Path for location.
Files for operations.
FileChannel for channel-level control.
FileVisitor for tree algorithms.
FileSystemProvider awareness for portability.
InputStream/OutputStream for generic byte API.
File only at legacy boundary.
```

The most important lessons:

1. `File` is an abstract pathname, not an opened file.
2. `File` mostly assumes the default filesystem.
3. `File` often hides failure reasons behind `boolean`.
4. `File.renameTo`, `delete`, `mkdirs`, and `listFiles` are common bug sources.
5. `File.toPath()` is the main migration bridge.
6. `Path.toFile()` only works for default-provider paths.
7. Classpath resources are not necessarily files.
8. String path manipulation is fragile.
9. Migration should improve correctness, not only syntax.
10. Keep `File` at compatibility boundaries, not in core filesystem logic.

---

## 37. Java 8–25 Compatibility Cheatsheet

```java
// Java 8 compatible
Path path = Paths.get("data", "input.txt");

// Java 11+
Path path2 = Path.of("data", "input.txt");

// File -> Path
File file = new File("data/input.txt");
Path fromFile = file.toPath();

// Path -> File only for default filesystem
File back = fromFile.toFile();

// Better delete
Files.delete(fromFile);

// Better create directories
Files.createDirectories(fromFile.getParent());

// Better move
Files.move(fromFile, target,
    StandardCopyOption.REPLACE_EXISTING,
    StandardCopyOption.ATOMIC_MOVE);

// Better metadata
BasicFileAttributes attrs = Files.readAttributes(
    fromFile,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);
```

---

## 38. References

- Java SE 25 `java.io.File` API documentation.
- Java SE 8 `java.io.File` API documentation.
- Java SE 25 `java.nio.file.Path` API documentation.
- Java SE 8 `java.nio.file.Path` API documentation.
- Java SE 25 `java.nio.file.Files` API documentation.
- Java SE 8 `java.nio.file.Files` API documentation.
- Java SE 25 `FileSystemProvider` API documentation.
- Java SE 25 `StandardCopyOption`, `LinkOption`, `FileVisitor`, `SimpleFileVisitor`, and file attribute APIs.
- Inside Java quality heads-up on JDK 25 Windows file operation behavior.

---

## 39. Bridge to Next Part

Part ini membahas `File` sebagai compatibility boundary.

Part berikutnya akan naik ke isu yang lebih luas:

```text
Part 27 — Cross-Platform Filesystem Behavior: Linux, Windows, macOS
```

Di sana kita akan membahas kenapa filesystem behavior berbeda antar OS: case sensitivity, reserved names, path length, invalid characters, newline, hidden file model, symlink privilege, delete/rename behavior, dan Unicode normalization.

