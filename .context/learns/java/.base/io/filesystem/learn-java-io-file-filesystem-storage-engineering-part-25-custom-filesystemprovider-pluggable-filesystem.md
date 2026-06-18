# learn-java-io-file-filesystem-storage-engineering — Part 25
# Custom `FileSystemProvider` and Pluggable Filesystem Mental Model

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: 25 dari 35  
> Target: Java 8 hingga Java 25  
> Level: Advanced / production engineering  
> Fokus: `FileSystemProvider`, pluggable filesystem, provider capability, URI scheme, ZIP/default/custom provider, in-memory filesystem, cloud/object-storage-like provider, dan cara menulis kode Java yang tidak diam-diam bergantung pada local filesystem.

---

## 1. Mengapa Bagian Ini Penting?

Sampai titik ini kita sudah banyak memakai API seperti:

```java
Files.readString(path);
Files.copy(source, target);
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
Files.walkFileTree(root, visitor);
Files.getFileStore(path);
Files.getAttribute(path, "basic:size");
```

Di permukaan, semua terlihat seperti operasi file biasa. Tetapi di balik hampir semua operasi `Files`, Java tidak melakukan semua pekerjaan sendiri. Java mendelegasikan operasi tersebut ke **filesystem provider** yang terkait dengan `Path` tersebut.

Mental model yang benar:

```text
Application code
    |
    v
Path / Files / FileSystem API
    |
    v
FileSystemProvider
    |
    v
Concrete filesystem implementation
    |
    v
OS filesystem / ZIP archive / in-memory FS / virtual FS / remote-like FS
```

Jadi ketika kita menulis:

```java
Files.copy(source, target);
```

pertanyaan production-grade bukan hanya:

> “Apakah Java bisa copy file?”

Tapi:

> “Provider apa yang menangani `source` dan `target`?”  
> “Apakah provider tersebut mendukung attribute yang sama?”  
> “Apakah path itu dari filesystem yang sama?”  
> “Apakah move bisa atomic?”  
> “Apakah permission enforcement nyata atau hanya metadata?”  
> “Apakah directory traversal semantic-nya sama dengan local disk?”  
> “Apakah operation failure-nya punya recovery guarantee yang sama?”

Ini adalah level berpikir yang membedakan engineer biasa dengan engineer yang benar-benar memahami storage boundary.

---

## 2. Core Mental Model: `Path` Tidak Berdiri Sendiri

`Path` bukan sekadar string. `Path` selalu terkait dengan sebuah `FileSystem`.

```java
Path p = Path.of("/var/app/data/report.csv");
FileSystem fs = p.getFileSystem();
```

`FileSystem` tersebut memiliki `FileSystemProvider`:

```java
FileSystemProvider provider = p.getFileSystem().provider();
```

Artinya, dua path yang kelihatan mirip secara string bisa saja berasal dari provider berbeda.

Contoh konseptual:

```text
/var/app/data/a.txt        -> default provider, local filesystem
/report.csv               -> ZIP filesystem provider, entry dalam archive
/config/settings.json      -> in-memory provider
s3://bucket/key            -> custom/cloud-like provider, jika ada library/provider
```

Akibatnya, operasi yang sama bisa memiliki semantic berbeda.

Contoh:

```java
Files.exists(path)
Files.isDirectory(path)
Files.move(path1, path2)
Files.getPosixFilePermissions(path)
Files.newDirectoryStream(path)
```

Semua itu **provider-mediated**.

Dalam dokumentasi Java SE 25, `Files` dijelaskan sebagai kumpulan static method untuk operasi file/directory, dan dalam kebanyakan kasus method-method tersebut mendelegasikan operasi ke associated filesystem provider.

---

## 3. `FileSystemProvider`: Apa Sebenarnya Ini?

`java.nio.file.spi.FileSystemProvider` adalah service-provider class untuk filesystem.

Provider adalah concrete implementation yang menyediakan operasi seperti:

- membuat `FileSystem`
- mengambil `FileSystem` existing
- membuat `Path` dari URI
- membuka file/channel
- membuat directory
- delete
- copy
- move
- check access
- membaca/menulis attribute
- membuat link
- membaca symbolic link
- membuat directory stream
- menentukan apakah dua path menunjuk file yang sama
- mengambil `FileStore`

Secara konseptual:

```text
FileSystemProvider = driver / adapter / backend implementation untuk java.nio.file
```

Kalau JDBC punya `Driver`, maka NIO.2 punya `FileSystemProvider`.

Analogi:

```text
JDBC
  DataSource / Connection / Driver
  SQL operation delegated to database driver

NIO.2 filesystem
  FileSystem / Path / FileSystemProvider
  File operation delegated to filesystem provider
```

Tetapi analogi ini tidak sempurna karena filesystem provider harus meniru semantic filesystem yang jauh lebih beragam daripada database driver.

---

## 4. Provider Diidentifikasi oleh URI Scheme

Setiap provider diidentifikasi oleh URI scheme.

Contoh:

```text
file:///              -> default filesystem provider
jar:file:/x/app.zip   -> ZIP filesystem provider
memory:///?name=x     -> contoh konseptual memory provider
```

Default provider memakai scheme:

```text
file
```

ZIP filesystem provider memakai scheme:

```text
jar
```

Inilah alasan mengapa ZIP/JAR bisa dibuka sebagai filesystem:

```java
URI uri = URI.create("jar:file:/tmp/archive.zip");
Map<String, String> env = Map.of("create", "true");

try (FileSystem zipFs = FileSystems.newFileSystem(uri, env)) {
    Path inside = zipFs.getPath("/reports/2026.csv");
    Files.writeString(inside, "id,name\n1,Alice\n");
}
```

Pada Java 8, karena `Map.of` belum ada:

```java
URI uri = URI.create("jar:file:/tmp/archive.zip");
Map<String, String> env = new HashMap<>();
env.put("create", "true");

try (FileSystem zipFs = FileSystems.newFileSystem(uri, env)) {
    Path inside = zipFs.getPath("/reports/2026.csv");
    Files.write(inside, Arrays.asList("id,name", "1,Alice"), StandardCharsets.UTF_8);
}
```

---

## 5. Default Filesystem Provider

Saat kita menulis:

```java
Path path = Path.of("/tmp/a.txt");
```

atau di Java 8:

```java
Path path = Paths.get("/tmp/a.txt");
```

kita biasanya memakai default filesystem.

```java
FileSystem defaultFs = FileSystems.getDefault();
FileSystemProvider provider = defaultFs.provider();
System.out.println(provider.getScheme()); // biasanya: file
```

Default provider menyediakan akses ke filesystem yang terlihat oleh JVM.

Namun “terlihat oleh JVM” bukan berarti:

- selalu local disk
- selalu POSIX
- selalu writable
- selalu case-sensitive
- selalu support symlink
- selalu support ACL
- selalu support atomic move
- selalu support reliable file watcher

Di dalam container, default filesystem bisa berupa overlay filesystem, mounted volume, ConfigMap, Secret, PVC, NFS/EFS-like mount, atau read-only root filesystem.

Jadi default provider bukan sinonim dari “disk lokal yang normal”.

---

## 6. Installed Providers

Java dapat menemukan provider yang terinstall:

```java
for (FileSystemProvider provider : FileSystemProvider.installedProviders()) {
    System.out.println(provider.getScheme() + " -> " + provider.getClass().getName());
}
```

Output bisa berbeda tergantung runtime dan classpath/module-path.

Contoh kemungkinan:

```text
file -> sun.nio.fs.LinuxFileSystemProvider
jar  -> jdk.nio.zipfs.ZipFileSystemProvider
```

Jangan hard-code class provider internal seperti `sun.nio.fs.*`. Itu implementation detail.

Gunakan kontrak public API:

```java
provider.getScheme()
path.getFileSystem()
fileSystem.provider()
```

---

## 7. `Files.*` Adalah Provider Dispatch

Ini salah satu mental model paling penting.

Saat kita menulis:

```java
Files.delete(path);
```

secara konseptual Java melakukan:

```text
path.getFileSystem().provider().delete(path)
```

Saat kita menulis:

```java
Files.copy(source, target, options...);
```

Java harus mempertimbangkan:

- provider source
- provider target
- apakah provider sama
- apakah operasi copy cross-provider didukung
- option apa yang didukung
- attribute apa yang bisa dipertahankan
- exception apa yang harus dilempar

Dari sinilah muncul banyak edge case:

```java
Files.move(pathInZip, localPath, StandardCopyOption.ATOMIC_MOVE);
```

Apakah atomic move dari entry ZIP ke local filesystem masuk akal? Umumnya tidak.

```java
Files.getPosixFilePermissions(pathInZip);
```

Apakah ZIP filesystem menyimpan dan menegakkan POSIX permission seperti Linux filesystem? Tidak selalu. Bahkan ketika ZIP provider menyimpan permission metadata, enforcement-nya tidak sama dengan OS filesystem.

---

## 8. `FileSystem` sebagai Factory

`FileSystem` bukan hanya representasi “disk”. Ia adalah factory untuk object terkait filesystem:

- `Path`
- `PathMatcher`
- `WatchService`
- `UserPrincipalLookupService`
- root directories
- file stores
- separator
- supported attribute views

Contoh:

```java
FileSystem fs = FileSystems.getDefault();

System.out.println(fs.getSeparator());
System.out.println(fs.isOpen());
System.out.println(fs.isReadOnly());
System.out.println(fs.supportedFileAttributeViews());

Path p = fs.getPath("var", "app", "data.txt");
PathMatcher matcher = fs.getPathMatcher("glob:**/*.txt");
WatchService watcher = fs.newWatchService();
```

Hal yang perlu dipahami:

```text
Path dibuat oleh FileSystem.
Path diinterpretasi oleh FileSystem.
Operasi Path dilakukan oleh provider FileSystem tersebut.
```

Karena itu, jangan mencampur path dari provider berbeda tanpa sadar.

---

## 9. Path dari Provider Berbeda Tidak Selalu Comparable

Misalnya:

```java
Path local = Path.of("/tmp/report.csv");
Path zipEntry = zipFs.getPath("/report.csv");
```

Keduanya bisa punya string representation mirip:

```text
/tmp/report.csv
/report.csv
```

Tapi mereka bukan berada di dunia yang sama.

Kesalahan umum:

```java
if (zipEntry.startsWith(Path.of("/"))) {
    // asumsi salah: root default filesystem dipakai untuk path ZIP
}
```

`startsWith(Path other)` umumnya mensyaratkan compatibility antar path dari filesystem yang sama. Jika tidak, hasil bisa false atau behavior provider-specific sesuai kontrak implementasi.

Pola yang lebih benar:

```java
Path root = zipFs.getPath("/");
if (zipEntry.normalize().startsWith(root)) {
    // root berasal dari filesystem yang sama
}
```

Ingat invariant:

```text
Containment check harus memakai root dan candidate dari FileSystem yang sama.
```

---

## 10. Provider Capability: Jangan Asumsikan Semua Fitur Ada

Tidak semua provider mendukung semua operasi.

Contoh capability yang bisa berbeda:

| Capability | Local Linux FS | Windows FS | ZIP FS | In-memory FS | Cloud-like custom FS |
|---|---:|---:|---:|---:|---:|
| Regular file read/write | Ya | Ya | Ya | Ya | Tergantung |
| POSIX permission | Ya | Tidak native | Optional/metadata | Tergantung | Biasanya tidak |
| ACL | Tergantung | Ya | Tidak umum | Tergantung | Tergantung |
| Symbolic link | Ya | Ya, dengan batasan | Tidak seperti OS | Tergantung | Biasanya tidak |
| Hard link | Ya | Tergantung | Tidak umum | Tergantung | Tidak |
| Atomic rename | Ya dalam filesystem sama | Ya dengan caveat | Provider-specific | Ya/Tergantung | Tidak selalu |
| WatchService | Ya, tapi caveat | Ya, tapi caveat | Biasanya tidak meaningful | Tergantung | Biasanya tidak |
| File lock | Ya, caveat | Ya, caveat | Tidak seperti OS | Tergantung | Biasanya tidak |
| FileStore capacity | Ya | Ya | Pseudo | Pseudo | Pseudo/remote |
| Memory mapping | FileChannel local | FileChannel local | Tidak selalu | Tidak selalu | Tidak umum |

Top 1% engineer tidak menulis:

```java
Files.getPosixFilePermissions(path);
```

dan menganggap itu selalu jalan.

Mereka menulis:

```java
FileStore store = Files.getFileStore(path);
if (store.supportsFileAttributeView(PosixFileAttributeView.class)) {
    Set<PosixFilePermission> perms = Files.getPosixFilePermissions(path);
    // use perms
} else {
    // fallback or reject operation explicitly
}
```

Tetapi bahkan capability check pun bukan absolute guarantee untuk semua kondisi runtime, terutama remote/non-local store. Treat it as operational signal, not mathematical truth.

---

## 11. Attribute Views Adalah Provider Contract

Java filesystem metadata dibagi ke dalam attribute view:

- `basic`
- `posix`
- `dos`
- `acl`
- `owner`
- `user`
- provider-specific views, misalnya `zip`

Contoh:

```java
Set<String> views = path.getFileSystem().supportedFileAttributeViews();
System.out.println(views);
```

Pada Linux default filesystem mungkin:

```text
[basic, owner, unix, posix, user]
```

Pada Windows mungkin:

```text
[basic, owner, dos, acl, user]
```

Pada ZIP filesystem bisa berbeda, misalnya mendukung view khusus ZIP dan optional POSIX attribute jika diaktifkan dengan property provider.

Konsekuensi:

```java
Files.getAttribute(path, "posix:permissions");
```

bisa berhasil di satu provider dan gagal di provider lain.

Pola desain yang baik:

```java
record FileCapability(
    boolean posix,
    boolean acl,
    boolean owner,
    boolean userDefined,
    boolean readOnly
) {}

static FileCapability inspectCapabilities(Path path) throws IOException {
    FileSystem fs = path.getFileSystem();
    FileStore store = Files.getFileStore(path);

    return new FileCapability(
        store.supportsFileAttributeView(PosixFileAttributeView.class),
        store.supportsFileAttributeView(AclFileAttributeView.class),
        store.supportsFileAttributeView(FileOwnerAttributeView.class),
        store.supportsFileAttributeView(UserDefinedFileAttributeView.class),
        store.isReadOnly()
    );
}
```

---

## 12. Provider-Specific Properties

Saat membuat filesystem baru, provider bisa menerima `env` map.

Contoh ZIP filesystem:

```java
Map<String, String> env = Map.of(
    "create", "true",
    "encoding", "UTF-8"
);

try (FileSystem zipFs = FileSystems.newFileSystem(zipPath, env)) {
    // use zip filesystem
}
```

Di Java 8:

```java
Map<String, String> env = new HashMap<>();
env.put("create", "true");
env.put("encoding", "UTF-8");

try (FileSystem zipFs = FileSystems.newFileSystem(zipPath, env)) {
    // use zip filesystem
}
```

Problemnya:

```text
Env map bukan cross-provider contract universal.
```

`create=true` meaningful untuk ZIP provider, tetapi provider lain bisa:

- mengabaikan
- menolak
- membutuhkan property berbeda
- memakai type value berbeda
- punya default berbeda

Karena itu, jika library menerima provider arbitrary, jangan expose `Map<String, ?> env` sembarangan tanpa dokumentasi.

---

## 13. ZIP Provider sebagai Contoh Nyata Pluggable Filesystem

ZIP provider adalah contoh terbaik untuk memahami provider abstraction karena ZIP/JAR bukan directory OS, tapi Java bisa memperlakukannya sebagai filesystem.

```java
Path zipPath = Path.of("/tmp/export.zip");
Map<String, String> env = Map.of("create", "true");

try (FileSystem zipFs = FileSystems.newFileSystem(zipPath, env)) {
    Path dir = zipFs.getPath("/reports");
    Files.createDirectories(dir);

    Path file = dir.resolve("summary.txt");
    Files.writeString(file, "hello");
}
```

Apa yang terlihat seperti directory:

```text
/reports/summary.txt
```

sebenarnya entry di dalam ZIP archive.

Important distinction:

```text
Path inside ZIP bukan Path local filesystem.
```

Contoh:

```java
Path zipEntry = zipFs.getPath("/reports/summary.txt");
System.out.println(zipEntry.getFileSystem().provider().getScheme()); // jar
```

Bukan:

```text
file
```

---

## 14. ZIP Filesystem Tidak Sama dengan Directory Biasa

Walaupun API-nya sama, semantic-nya tidak identik.

Perbedaan penting:

1. **Update mungkin direalisasikan berbeda.**  
   Menulis entry ZIP bukan selalu sama seperti write file di directory biasa.

2. **Permission bukan enforcement OS.**  
   ZIP bisa menyimpan permission metadata, tetapi bukan berarti OS menegakkan permission itu saat entry dibaca di dalam ZIP FS.

3. **Atomic move semantics berbeda.**  
   Rename entry dalam archive bukan operasi directory entry OS biasa.

4. **FileStore capacity pseudo.**  
   Kapasitas ZIP FS tidak sama dengan kapasitas filesystem tempat ZIP file berada.

5. **WatchService tidak meaningful.**  
   Mengawasi entry dalam ZIP seperti directory OS biasanya bukan model yang tepat.

6. **Close matters.**  
   Perubahan bisa baru benar-benar selesai saat filesystem ditutup.

Karena itu pola yang baik:

```java
try (FileSystem zipFs = FileSystems.newFileSystem(zipPath, env)) {
    // perform all operations
} // close filesystem deterministically
```

Jangan biarkan ZIP FS terbuka lama tanpa alasan.

---

## 15. In-Memory Filesystem untuk Testing

Java standard library tidak menyediakan general-purpose in-memory filesystem sebagai public built-in provider. Tetapi library seperti Jimfs sering digunakan di test untuk mensimulasikan filesystem.

Contoh konseptual dengan provider in-memory:

```java
FileSystem fs = createInMemoryFileSystemSomehow();
Path root = fs.getPath("/work");
Files.createDirectories(root);
Files.writeString(root.resolve("a.txt"), "hello");
```

Manfaat:

- test cepat
- tidak menyentuh disk nyata
- mudah setup/cleanup
- bisa simulate Windows-like atau Unix-like path behavior jika library mendukung
- bagus untuk unit test path algorithm

Tetapi jangan salah:

```text
In-memory filesystem bukan perfect model untuk production filesystem.
```

Biasanya tidak mewakili:

- disk full
- permission OS nyata
- file lock OS nyata
- symlink privilege Windows
- page cache behavior
- crash consistency
- fsync durability
- network filesystem latency
- Kubernetes volume semantics

Rekomendasi testing:

```text
Unit test path logic         -> in-memory FS boleh
Integration test filesystem  -> real temp directory
Platform test                -> CI Linux/Windows/macOS jika portability penting
Failure/recovery test        -> real FS + fault injection where possible
```

---

## 16. Cloud/Object-Storage-Like Provider: Dangerous Abstraction

Beberapa library mencoba menyajikan object storage sebagai filesystem provider.

Misalnya secara konseptual:

```text
s3://bucket/prefix/file.txt
```

lalu exposed sebagai `Path`.

Masalahnya:

```text
Object storage bukan filesystem tradisional.
```

Filesystem biasanya punya konsep:

- directory hierarchy nyata
- rename metadata operation
- append file
- file lock
- POSIX-like permissions
- atomic directory entry update
- file watcher
- inode/file identity
- partial update

Object storage biasanya punya konsep:

- bucket
- object key
- full-object put
- metadata object
- list prefix
- copy object
- delete object
- eventual/strong consistency tergantung platform dan operasi
- no true directory
- no true rename; rename biasanya copy + delete
- no append in POSIX sense

Jadi kalau ada provider yang membuat object storage terlihat seperti filesystem, jangan otomatis percaya bahwa operasi ini aman:

```java
Files.move(temp, finalPath, StandardCopyOption.ATOMIC_MOVE);
Files.newByteChannel(path, StandardOpenOption.APPEND);
Files.lock(...);
path.toFile();
Files.isSameFile(a, b);
```

Pola pikir yang benar:

```text
Provider abstraction can make APIs uniform.
It cannot make backend semantics identical.
```

---

## 17. Capability Mismatch: API Sama, Guarantee Berbeda

Contoh API:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

Di local filesystem yang sama:

```text
Mungkin atomic.
```

Di cross-filesystem:

```text
Bisa gagal dengan AtomicMoveNotSupportedException.
```

Di ZIP filesystem:

```text
Provider-specific.
```

Di object-storage-like provider:

```text
Mungkin mustahil secara native.
```

Contoh lain:

```java
Files.size(path);
```

Di local file:

```text
Biasanya murah metadata lookup.
```

Di remote provider:

```text
Bisa network call.
```

Contoh:

```java
Files.list(directory)
```

Di local directory:

```text
Directory iteration.
```

Di object store:

```text
List prefix, pagination, network, eventual constraints, cost.
```

Karena itu, performance model juga provider-dependent.

---

## 18. `Path.toFile()` Adalah Default-Filesystem Assumption

Salah satu bug desain paling umum:

```java
File file = path.toFile();
```

Ini hanya valid jika path berasal dari default provider yang bisa direpresentasikan sebagai `java.io.File`.

Untuk path dari ZIP filesystem atau custom provider, `toFile()` bisa melempar `UnsupportedOperationException`.

Anti-pattern:

```java
void process(Path path) throws IOException {
    FileInputStream in = new FileInputStream(path.toFile());
    // breaks for non-default providers
}
```

Pola benar:

```java
void process(Path path) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        // provider-neutral
    }
}
```

Anti-pattern lain:

```java
new File(path.toString())
```

Ini lebih buruk, karena mengubah path provider-specific menjadi string lalu menafsirkannya ulang sebagai path default filesystem.

```text
Path -> String -> File = kehilangan provider identity.
```

Invariant:

```text
Jika API menerima Path, tetap gunakan Path/Files/NIO selama mungkin.
Jangan turun ke File kecuali memang API legacy memaksa dan provider sudah dipastikan default/local.
```

---

## 19. `Path.toUri()` Juga Bukan Selalu Portable Storage Identifier

`Path.toUri()` berguna, tetapi jangan salah menganggap URI tersebut selalu bisa dipakai lintas mesin/runtime.

Contoh local path:

```java
Path path = Path.of("/tmp/a.txt");
URI uri = path.toUri();
System.out.println(uri); // file:///tmp/a.txt
```

URI itu berarti sesuatu pada mesin tempat path berada. Pada container lain, host lain, atau OS lain, URI tersebut mungkin tidak menunjuk resource yang sama.

Untuk custom provider, bentuk URI juga provider-specific.

Jangan gunakan `Path.toUri()` sebagai durable external reference kecuali kontraknya jelas.

Better design:

```text
Internal file path          -> Path
External object identity    -> domain ID / storage key / URI with explicit provider contract
Database reference          -> logical storage ID, not raw local path when possible
```

---

## 20. `FileSystems.newFileSystem`: Dua Model Pembukaan

Ada beberapa overload penting:

```java
FileSystems.newFileSystem(URI uri, Map<String, ?> env)
FileSystems.newFileSystem(Path path, Map<String, ?> env)
```

Model URI:

```java
URI uri = URI.create("jar:file:/tmp/archive.zip");
try (FileSystem fs = FileSystems.newFileSystem(uri, Map.of())) {
    // use fs
}
```

Model Path:

```java
Path zip = Path.of("/tmp/archive.zip");
try (FileSystem fs = FileSystems.newFileSystem(zip, Map.of())) {
    // use fs
}
```

Perbedaan penting:

- URI model mencari provider berdasarkan URI scheme.
- Path model menggunakan provider yang dapat membuat pseudo filesystem dari file tersebut, misalnya ZIP provider dari path archive.
- Behavior dan lookup detail bisa berbeda.

Untuk Java 8:

```java
try (FileSystem fs = FileSystems.newFileSystem(zip, null)) {
    // beberapa contoh lama memakai null env
}
```

Namun lebih bersih memakai map kosong jika memungkinkan:

```java
try (FileSystem fs = FileSystems.newFileSystem(zip, Collections.emptyMap())) {
    // use fs
}
```

---

## 21. Lifecycle: `FileSystem` Bisa Perlu Ditutup

Default filesystem biasanya tidak ditutup oleh aplikasi.

Tetapi filesystem yang dibuat via `newFileSystem` umumnya harus ditutup:

```java
try (FileSystem fs = FileSystems.newFileSystem(zipPath, env)) {
    // use fs
}
```

Kenapa?

- release resource
- flush/update archive metadata
- close internal channels
- avoid file handle leak
- allow underlying file to be moved/deleted on Windows
- avoid duplicate filesystem instance issue untuk URI yang sama

Anti-pattern:

```java
FileSystem zipFs = FileSystems.newFileSystem(zipPath, env);
Path p = zipFs.getPath("/a.txt");
Files.writeString(p, "hello");
// no close
```

Pola yang benar:

```java
try (FileSystem zipFs = FileSystems.newFileSystem(zipPath, env)) {
    Path p = zipFs.getPath("/a.txt");
    Files.writeString(p, "hello");
}
```

---

## 22. `FileSystemAlreadyExistsException` dan `FileSystemNotFoundException`

Saat memakai URI-based filesystem, provider bisa mengelola filesystem instance berdasarkan URI.

Contoh kasus:

```java
URI uri = URI.create("jar:file:/tmp/archive.zip");
FileSystem fs1 = FileSystems.newFileSystem(uri, Map.of());
FileSystem fs2 = FileSystems.newFileSystem(uri, Map.of()); // bisa gagal
```

Kemungkinan exception:

- `FileSystemAlreadyExistsException`
- `FileSystemNotFoundException`
- `ProviderNotFoundException`
- `IllegalArgumentException`
- `IOException`

Pola helper yang sering dipakai:

```java
static FileSystem openOrGetFileSystem(URI uri, Map<String, ?> env) throws IOException {
    try {
        return FileSystems.newFileSystem(uri, env);
    } catch (FileSystemAlreadyExistsException e) {
        return FileSystems.getFileSystem(uri);
    }
}
```

Tetapi hati-hati: jika helper mengembalikan filesystem existing, apakah caller boleh menutupnya?

Ini problem ownership.

Better design:

```text
If your method opens a FileSystem, your method owns closing it.
If your method receives a FileSystem, caller owns lifecycle.
Do not mix without explicit contract.
```

---

## 23. Ownership Pattern untuk FileSystem

Buruk:

```java
Path getZipEntry(Path zip, String entry) throws IOException {
    FileSystem fs = FileSystems.newFileSystem(zip, Map.of());
    return fs.getPath(entry);
}
```

Kenapa buruk?

- FileSystem tidak ditutup.
- Jika ditutup sebelum return, path menjadi tidak usable.
- Caller tidak tahu lifecycle resource.

Lebih baik:

```java
void withZipFileSystem(Path zip, Consumer<FileSystem> action) throws IOException {
    try (FileSystem fs = FileSystems.newFileSystem(zip, Map.of())) {
        action.accept(fs);
    }
}
```

Namun `Consumer` tidak bisa throw checked exception. Buat functional interface sendiri:

```java
@FunctionalInterface
interface IOConsumer<T> {
    void accept(T value) throws IOException;
}

static void withZipFileSystem(Path zip, Map<String, ?> env, IOConsumer<FileSystem> action) throws IOException {
    try (FileSystem fs = FileSystems.newFileSystem(zip, env)) {
        action.accept(fs);
    }
}
```

Penggunaan:

```java
withZipFileSystem(zipPath, Map.of("create", "true"), fs -> {
    Path entry = fs.getPath("/report.txt");
    Files.writeString(entry, "hello");
});
```

Java 8:

```java
Map<String, String> env = new HashMap<>();
env.put("create", "true");

withZipFileSystem(zipPath, env, new IOConsumer<FileSystem>() {
    @Override
    public void accept(FileSystem fs) throws IOException {
        Path entry = fs.getPath("/report.txt");
        Files.write(entry, Arrays.asList("hello"), StandardCharsets.UTF_8);
    }
});
```

---

## 24. Designing Provider-Neutral APIs

Jika ingin library yang fleksibel, jangan terima `String` untuk path.

Kurang baik:

```java
void importFile(String path) throws IOException {
    File file = new File(path);
    // default filesystem assumption
}
```

Lebih baik:

```java
void importFile(Path path) throws IOException {
    try (InputStream in = Files.newInputStream(path)) {
        // provider-neutral read
    }
}
```

Lebih baik lagi untuk dependency injection:

```java
final class FileImportService {
    private final Path inboxRoot;

    FileImportService(Path inboxRoot) {
        this.inboxRoot = Objects.requireNonNull(inboxRoot);
    }

    void importRelative(String relativeName) throws IOException {
        Path candidate = inboxRoot.resolve(relativeName).normalize();
        if (!candidate.startsWith(inboxRoot.normalize())) {
            throw new SecurityException("Path escapes inbox root");
        }
        try (InputStream in = Files.newInputStream(candidate)) {
            // process
        }
    }
}
```

Tetapi untuk security-critical containment, gunakan real-path strategy yang sesuai provider dan threat model seperti dibahas di Part 13.

---

## 25. Provider-Neutral API Checklist

API yang relatif provider-neutral:

```java
Files.newInputStream(path)
Files.newOutputStream(path, options)
Files.newBufferedReader(path, charset)
Files.newBufferedWriter(path, charset, options)
Files.readAttributes(path, BasicFileAttributes.class)
Files.walkFileTree(path, visitor)
Path.resolve(...)
Path.normalize()
```

API yang sering mengandung assumption:

```java
path.toFile()
new File(path.toString())
FileInputStream(path.toFile())
RandomAccessFile(path.toFile(), "rw")
FileChannel.open(path, options) // okay generally, but provider support matters
Files.getPosixFilePermissions(path)
Files.createSymbolicLink(path, target)
Files.move(..., ATOMIC_MOVE)
FileSystems.getDefault().getPath(...)
```

Bukan berarti API kedua selalu salah. Tetapi harus sadar assumption-nya.

---

## 26. Capability-Oriented Design

Daripada menulis kode yang menganggap semua provider sama, buat layer capability.

Contoh:

```java
final class FileSystemCapabilities {
    final String providerScheme;
    final boolean readOnly;
    final boolean posixAttributes;
    final boolean aclAttributes;
    final boolean userDefinedAttributes;
    final boolean symbolicLinksLikelySupported;

    FileSystemCapabilities(
            String providerScheme,
            boolean readOnly,
            boolean posixAttributes,
            boolean aclAttributes,
            boolean userDefinedAttributes,
            boolean symbolicLinksLikelySupported) {
        this.providerScheme = providerScheme;
        this.readOnly = readOnly;
        this.posixAttributes = posixAttributes;
        this.aclAttributes = aclAttributes;
        this.userDefinedAttributes = userDefinedAttributes;
        this.symbolicLinksLikelySupported = symbolicLinksLikelySupported;
    }
}
```

Inspector:

```java
static FileSystemCapabilities inspect(Path path) throws IOException {
    FileSystem fs = path.getFileSystem();
    FileStore store = Files.getFileStore(path);

    boolean posix = store.supportsFileAttributeView(PosixFileAttributeView.class);
    boolean acl = store.supportsFileAttributeView(AclFileAttributeView.class);
    boolean user = store.supportsFileAttributeView(UserDefinedFileAttributeView.class);

    // There is no universal preflight for symlink support. This is heuristic.
    boolean symlinkLikely = !store.isReadOnly();

    return new FileSystemCapabilities(
        fs.provider().getScheme(),
        store.isReadOnly(),
        posix,
        acl,
        user,
        symlinkLikely
    );
}
```

Untuk fitur yang tidak punya capability query reliable, lakukan operation dan tangani exception.

Contoh:

```java
try {
    Files.createSymbolicLink(link, target);
} catch (UnsupportedOperationException e) {
    // provider does not support symbolic links
} catch (FileSystemException e) {
    // OS denied, privilege missing, target invalid, etc.
}
```

---

## 27. Operation-Oriented Design: Try, Fail, Classify

Capability check tidak cukup karena:

- filesystem bisa berubah
- mount bisa remount read-only
- permission bisa berubah
- network provider bisa unreachable
- quota bisa habis
- path bisa diganti symlink
- provider bisa support feature secara umum tapi gagal untuk path tertentu

Karena itu gunakan pola:

```text
1. Inspect capability if useful.
2. Attempt operation atomically if possible.
3. Catch specific exception.
4. Classify failure.
5. Apply fallback/reject/retry based on semantics.
```

Contoh atomic move fallback:

```java
static void publish(Path tmp, Path target) throws IOException {
    try {
        Files.move(tmp, target,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException e) {
        // Decide explicitly: fallback or fail?
        // For config publish, usually fail.
        // For best-effort export, maybe fallback with warning.
        throw new IOException("Atomic publish not supported by provider/filesystem", e);
    }
}
```

Jangan diam-diam fallback ke non-atomic move untuk operation yang membutuhkan atomicity.

---

## 28. Cross-Provider Copy/Move

Saat source dan target dari filesystem/provider berbeda:

```java
Path source = zipFs.getPath("/report.csv");
Path target = Path.of("/tmp/report.csv");

Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Ini bisa bekerja karena Java/provider dapat membaca dari source dan menulis ke target.

Namun:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
```

hampir pasti problematis karena atomicity lintas provider tidak masuk akal secara umum.

Pola aman untuk cross-provider transfer:

```java
static void copyAcrossProviders(Path source, Path target) throws IOException {
    Path parent = target.getParent();
    if (parent != null) {
        Files.createDirectories(parent);
    }

    Path tmp = parent == null
        ? target.resolveSibling(target.getFileName() + ".tmp")
        : parent.resolve(target.getFileName() + ".tmp");

    try {
        Files.copy(source, tmp, StandardCopyOption.REPLACE_EXISTING);
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException e) {
        Files.deleteIfExists(tmp);
        throw e;
    } catch (IOException e) {
        Files.deleteIfExists(tmp);
        throw e;
    }
}
```

Tetapi ini hanya atomic pada target provider jika temp dan final berada di same target filesystem/location dan provider mendukung atomic move.

---

## 29. Provider and Performance: Method Cost Is Not Universal

Pada local filesystem:

```java
Files.exists(path)
```

bisa relatif murah.

Pada remote/custom provider:

```java
Files.exists(path)
```

bisa network call.

Pada object-store-like provider:

```java
Files.list(path)
```

bisa pagination request.

Pada ZIP filesystem:

```java
Files.walk(zipRoot)
```

bisa bergantung pada central directory structure dan implementation.

Akibatnya, jangan menulis kode seperti ini untuk provider-neutral workload:

```java
for (Path p : files) {
    if (Files.exists(p)) {
        long size = Files.size(p);
        FileTime time = Files.getLastModifiedTime(p);
        boolean regular = Files.isRegularFile(p);
        // repeated metadata calls
    }
}
```

Lebih baik baca attributes sekali:

```java
BasicFileAttributes attrs = Files.readAttributes(p, BasicFileAttributes.class);
long size = attrs.size();
FileTime time = attrs.lastModifiedTime();
boolean regular = attrs.isRegularFile();
```

Provider-neutral code harus mengurangi round trip dan repeated metadata calls.

---

## 30. Provider-Specific Exception Behavior

Java menyediakan exception spesifik:

- `NoSuchFileException`
- `FileAlreadyExistsException`
- `AccessDeniedException`
- `DirectoryNotEmptyException`
- `NotDirectoryException`
- `FileSystemLoopException`
- `AtomicMoveNotSupportedException`
- `ProviderNotFoundException`
- `FileSystemAlreadyExistsException`
- `FileSystemNotFoundException`
- `UnsupportedOperationException`
- `IOException`

Tetapi provider bisa memiliki variasi.

Pola buruk:

```java
catch (IOException e) {
    throw new RuntimeException("failed");
}
```

Pola lebih baik:

```java
catch (NoSuchFileException e) {
    // missing input
} catch (AccessDeniedException e) {
    // permission/ownership/runtime identity issue
} catch (AtomicMoveNotSupportedException e) {
    // guarantee unavailable
} catch (UnsupportedOperationException e) {
    // provider capability missing
} catch (IOException e) {
    // unknown I/O failure
}
```

Untuk observability, log:

- provider scheme
- filesystem class name jika aman untuk internal log
- path category, bukan raw sensitive path jika mengandung PII
- operation
- options
- exception class
- file store type/name jika relevan

Contoh:

```java
static String providerInfo(Path path) {
    FileSystem fs = path.getFileSystem();
    return fs.provider().getScheme() + ":" + fs.getClass().getName();
}
```

---

## 31. Custom `FileSystemProvider`: Kapan Perlu?

Membuat custom provider adalah pekerjaan berat. Jangan dilakukan hanya karena ingin “abstraction bagus”.

Layak dipertimbangkan jika:

- butuh expose virtual filesystem internal via standard `Path` API
- butuh test filesystem khusus
- butuh mount archive/custom package format
- butuh plugin system yang membaca resource dari backend berbeda
- butuh compatibility dengan library yang hanya menerima `Path`
- punya semantic filesystem yang cukup dekat dengan NIO contract

Tidak layak jika:

- backend bukan filesystem dan tidak bisa memenuhi semantic penting
- object storage butuh rename atomic padahal tidak ada
- distributed locking dianggap bisa ditiru dengan file lock
- hanya ingin wrapper sederhana untuk read/write object
- ingin menyembunyikan network latency di balik API yang terlihat local

Sering kali lebih jujur memakai abstraction domain sendiri:

```java
interface BlobStore {
    InputStream read(String key) throws IOException;
    void write(String key, InputStream data, BlobMetadata metadata) throws IOException;
    void delete(String key) throws IOException;
    List<BlobObject> list(String prefix) throws IOException;
}
```

Daripada memaksakan:

```java
Path path = s3fs.getPath("/bucket/key");
Files.move(path1, path2, ATOMIC_MOVE); // semantic palsu
```

---

## 32. Minimal Shape of a Custom Provider

Secara public API, custom provider harus extend:

```java
public class MyFileSystemProvider extends FileSystemProvider {
    @Override
    public String getScheme() { ... }

    @Override
    public FileSystem newFileSystem(URI uri, Map<String, ?> env) throws IOException { ... }

    @Override
    public FileSystem getFileSystem(URI uri) { ... }

    @Override
    public Path getPath(URI uri) { ... }

    @Override
    public SeekableByteChannel newByteChannel(
        Path path,
        Set<? extends OpenOption> options,
        FileAttribute<?>... attrs
    ) throws IOException { ... }

    @Override
    public DirectoryStream<Path> newDirectoryStream(
        Path dir,
        DirectoryStream.Filter<? super Path> filter
    ) throws IOException { ... }

    @Override
    public void createDirectory(Path dir, FileAttribute<?>... attrs) throws IOException { ... }

    @Override
    public void delete(Path path) throws IOException { ... }

    @Override
    public void copy(Path source, Path target, CopyOption... options) throws IOException { ... }

    @Override
    public void move(Path source, Path target, CopyOption... options) throws IOException { ... }

    @Override
    public boolean isSameFile(Path path, Path path2) throws IOException { ... }

    @Override
    public boolean isHidden(Path path) throws IOException { ... }

    @Override
    public FileStore getFileStore(Path path) throws IOException { ... }

    @Override
    public void checkAccess(Path path, AccessMode... modes) throws IOException { ... }

    @Override
    public <V extends FileAttributeView> V getFileAttributeView(
        Path path,
        Class<V> type,
        LinkOption... options
    ) { ... }

    @Override
    public <A extends BasicFileAttributes> A readAttributes(
        Path path,
        Class<A> type,
        LinkOption... options
    ) throws IOException { ... }

    @Override
    public Map<String, Object> readAttributes(
        Path path,
        String attributes,
        LinkOption... options
    ) throws IOException { ... }

    @Override
    public void setAttribute(
        Path path,
        String attribute,
        Object value,
        LinkOption... options
    ) throws IOException { ... }
}
```

Itu baru provider. Biasanya juga harus implement:

- custom `FileSystem`
- custom `Path`
- custom `FileStore`
- custom `SeekableByteChannel`
- custom `DirectoryStream`
- custom attributes
- lifecycle and registry
- URI parser
- path parser
- concurrency model
- error mapping
- tests across API surface

Membuat provider benar itu lebih dekat ke membuat mini filesystem driver daripada membuat utility class.

---

## 33. Service Loader Registration

Provider non-default biasanya ditemukan melalui Java service provider mechanism.

Dalam classpath-era Java 8, biasanya dengan file:

```text
META-INF/services/java.nio.file.spi.FileSystemProvider
```

Isi file:

```text
com.example.fs.MyFileSystemProvider
```

Dalam module-era Java 9+, module dapat mendeklarasikan provider:

```java
module com.example.myfs {
    requires java.base;
    provides java.nio.file.spi.FileSystemProvider
        with com.example.fs.MyFileSystemProvider;
}
```

Client module cukup memakai API `FileSystems`/`Path`/`Files`, tetapi provider harus berada di module path/classpath yang bisa ditemukan.

---

## 34. Default Provider Override: Powerful but Dangerous

Java memungkinkan default filesystem provider dioverride melalui system property:

```text
java.nio.file.spi.DefaultFileSystemProvider
```

Ini fitur advanced. Provider default custom harus membungkus existing default provider dengan constructor yang menerima `FileSystemProvider`.

Use case:

- instrumentation
- policy enforcement
- sandboxing eksperimen
- filesystem virtualization

Risiko:

- mempengaruhi seluruh JVM
- library third-party ikut terdampak
- early initialization ordering sulit
- debugging rumit
- behavior global berubah

Untuk aplikasi biasa, jangan override default provider.

Lebih aman inject `Path` root atau `FileSystem` secara eksplisit.

---

## 35. URI Parsing and Path Parsing in Custom Provider

Custom provider harus sangat hati-hati dengan URI.

Pertanyaan yang harus dijawab:

- Scheme apa?
- Authority dipakai atau tidak?
- Path absolute atau relative?
- Apakah query punya arti?
- Apakah fragment dilarang?
- Bagaimana encoding karakter?
- Apakah path separator selalu `/`?
- Apakah path case-sensitive?
- Apakah empty path valid?
- Bagaimana root direpresentasikan?
- Bagaimana normalize bekerja?
- Bagaimana `.` dan `..` diperlakukan?
- Apakah symlink ada?

Contoh URI policy:

```text
myfs://tenant-a/root/path/to/file.txt
\___/  \______/ \________________/
 scheme authority path
```

Kalau provider salah mendesain URI, security dan compatibility akan sulit dibetulkan.

---

## 36. Path Implementation: Bagian Tersulit

`Path` terlihat sederhana, tetapi kontraknya luas.

Custom `Path` harus menangani:

- `getFileSystem`
- `isAbsolute`
- `getRoot`
- `getFileName`
- `getParent`
- `getNameCount`
- `getName(int)`
- `subpath`
- `startsWith`
- `endsWith`
- `normalize`
- `resolve`
- `resolveSibling`
- `relativize`
- `toUri`
- `toAbsolutePath`
- `toRealPath`
- `toFile`
- `register` untuk watch service
- `iterator`
- `compareTo`
- `equals`
- `hashCode`

Kesalahan implementasi `equals/hashCode/normalize/relativize` bisa membuat bug sangat subtle.

Misalnya:

```java
Map<Path, Metadata> cache = new HashMap<>();
```

Jika `Path.equals` tidak konsisten dengan filesystem semantics, cache bisa rusak.

---

## 37. `toRealPath` dalam Custom Provider

`toRealPath` harus mengembalikan path absolut yang merepresentasikan real path, biasanya setelah:

- resolving symbolic links jika applicable
- memastikan file exists
- menghapus redundant name elements
- mengembalikan canonical provider-specific path

Untuk provider yang tidak punya symlink, tetap perlu mendefinisikan:

```text
Apa arti real path?
```

Jika backend case-insensitive, apakah `toRealPath` mengembalikan casing canonical?

Jika backend remote/object-like, apakah `toRealPath` butuh network call?

Jika file tidak ada, apakah throw `NoSuchFileException`?

Custom provider harus membuat keputusan ini eksplisit.

---

## 38. Directory Semantics in Custom Provider

Filesystem tradisional punya directory. Object storage sering hanya punya prefix.

Jika provider mengklaim punya directory, harus menjawab:

- Apakah directory object nyata?
- Apakah directory bisa kosong?
- Apakah delete directory kosong saja?
- Apakah `Files.isDirectory(prefix)` true jika ada object dengan prefix?
- Apa isi `newDirectoryStream`?
- Apakah listing consistent?
- Apakah recursive traversal bisa loop?
- Apakah directory entry ordering deterministic?

Jika tidak bisa menjawab dengan semantic jelas, jangan expose sebagai filesystem. Buat abstraction domain sendiri.

---

## 39. Atomicity Contract in Custom Provider

Custom provider harus jujur soal atomicity.

Untuk `move(source, target, ATOMIC_MOVE)`:

Jika tidak bisa menjamin atomic, lempar:

```java
throw new AtomicMoveNotSupportedException(
    source.toString(),
    target.toString(),
    "Atomic move is not supported by this provider"
);
```

Jangan pura-pura atomic dengan copy-delete.

Salah:

```java
if (atomicMoveRequested) {
    copy(source, target);
    delete(source);
}
```

Itu bukan atomic move.

Benar:

```text
If guarantee cannot be met, fail explicitly.
```

---

## 40. Consistency Contract in Custom Provider

Provider harus mendokumentasikan consistency:

- Setelah write return, apakah read langsung melihat data?
- Setelah delete return, apakah list masih bisa melihat entry lama?
- Setelah move return, apakah source hilang dan target muncul secara atomic?
- Apakah metadata update atomic dengan content update?
- Apakah list snapshot atau weakly consistent?
- Apakah concurrent writer didukung?
- Apakah file lock meaningful?

Local filesystem pun punya caveat, apalagi custom/remote provider.

Production-grade provider documentation harus punya bagian:

```text
Consistency and atomicity guarantees
Unsupported operations
Performance model
Failure model
Thread-safety model
Security model
```

---

## 41. Read-Only Provider

Provider bisa read-only.

Contoh:

- classpath-like resource filesystem
- mounted archive
- read-only ZIP FS
- immutable package
- snapshot filesystem
- ConfigMap-like volume

Jika read-only:

```java
fs.isReadOnly() == true
```

Operasi write harus gagal jelas:

```java
Files.writeString(path, "x"); // IOException / ReadOnlyFileSystemException depending operation
```

Jangan membuat write terlihat berhasil tapi tidak persisted.

---

## 42. Security Model Provider

Provider custom harus jelas apakah ia menegakkan security sendiri atau mengandalkan OS.

Pertanyaan:

- Apakah path traversal dicegah?
- Apakah tenant isolation ada?
- Apakah URI authority adalah tenant ID?
- Apakah user identity JVM dipakai?
- Apakah ACL backend dipakai?
- Apakah symlink didukung?
- Apakah `toRealPath` bisa escape sandbox?
- Apakah `Files.isSameFile` bisa leak existence antar tenant?

Contoh tenant-aware provider:

```text
myfs://tenant-a/documents/1.pdf
myfs://tenant-b/documents/1.pdf
```

Jangan sampai:

```java
Path a = provider.getPath(URI.create("myfs://tenant-a/../tenant-b/secret"));
```

bisa escape tenant boundary.

---

## 43. `FileTypeDetector`: Saudara Provider yang Sering Terlupakan

Package `java.nio.file.spi` juga berisi `FileTypeDetector`.

Ini dipakai oleh `Files.probeContentType(path)` untuk mencoba mendeteksi content type.

Custom provider bisa saja punya content type metadata lebih baik daripada extension.

Tetapi prinsip dari Part 23 tetap berlaku:

```text
Content type detection is not security proof.
```

Jangan menjadikan MIME detector sebagai satu-satunya guard.

---

## 44. Anti-Pattern: Path String Everywhere

Buruk:

```java
class ExportService {
    void export(String outputDir) throws IOException {
        String path = outputDir + "/report.csv";
        Files.writeString(Path.of(path), "...");
    }
}
```

Masalah:

- default filesystem assumption
- separator manual
- provider identity hilang
- testing dengan non-default FS sulit
- Windows/Unix issue
- ZIP/custom provider impossible

Lebih baik:

```java
class ExportService {
    private final Path outputDir;

    ExportService(Path outputDir) {
        this.outputDir = Objects.requireNonNull(outputDir);
    }

    void export() throws IOException {
        Path report = outputDir.resolve("report.csv");
        Files.writeString(report, "...");
    }
}
```

Dengan ini `outputDir` bisa berasal dari:

- local temp directory
- mounted volume
- ZIP filesystem
- in-memory filesystem
- custom provider

Selama operation yang dibutuhkan didukung.

---

## 45. Anti-Pattern: Assuming Local FileStore

Buruk:

```java
long free = new File("/data").getFreeSpace();
```

Lebih baik:

```java
FileStore store = Files.getFileStore(path);
long usable = store.getUsableSpace();
```

Tetapi tetap ingat:

```text
Usable space is hint, not reservation.
```

Untuk provider custom/remote, `FileStore` bisa pseudo dan capacity meaningful-nya berbeda.

---

## 46. Anti-Pattern: Silent Feature Downgrade

Buruk:

```java
try {
    Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException e) {
    Files.move(tmp, target, REPLACE_EXISTING); // silent downgrade
}
```

Jika operation membutuhkan atomic publish, ini bug.

Lebih baik:

```java
try {
    Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException e) {
    throw new IOException("Atomic publish required but not supported", e);
}
```

Atau jika business boleh best-effort:

```java
try {
    Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException e) {
    log.warn("Atomic move unsupported; falling back to non-atomic move for non-critical export");
    Files.move(tmp, target, REPLACE_EXISTING);
}
```

Perbedaannya adalah explicit decision.

---

## 47. Anti-Pattern: Treating Provider Abstraction as Distributed Lock

Buruk:

```java
try (FileChannel ch = FileChannel.open(path, WRITE, CREATE)) {
    try (FileLock lock = ch.lock()) {
        // assume distributed-safe across all providers
    }
}
```

File lock semantic sangat provider/OS/network dependent.

Untuk multi-node coordination, sering lebih benar memakai:

- database row lock
- Redis lease dengan fencing token
- ZooKeeper/etcd/Consul
- message queue partition ownership
- cloud-native lock primitive

File lock cocok untuk:

- local cross-process coordination
- carefully tested shared filesystem scenario
- simple single-host tools

Bukan default pilihan untuk distributed system.

---

## 48. Pattern: Accept `Path`, Not `File`, in Modern Java APIs

Modern API sebaiknya:

```java
void process(Path input, Path output) throws IOException
```

bukan:

```java
void process(File input, File output) throws IOException
```

Alasan:

- `Path` membawa provider identity
- `Path` mendukung non-default filesystem
- `Files` punya exception lebih spesifik
- interop ke `File` tetap bisa jika perlu
- testing lebih fleksibel

Legacy bridge:

```java
File legacy = path.toFile(); // only after ensuring default provider compatibility
```

Guard:

```java
static File requireDefaultFile(Path path) {
    if (!"file".equalsIgnoreCase(path.getFileSystem().provider().getScheme())) {
        throw new IllegalArgumentException("Path is not on default file provider: " + path);
    }
    return path.toFile();
}
```

Tetapi scheme `file` saja belum selalu menjamin semua OS behavior; ini hanya guard minimal untuk legacy `File` conversion.

---

## 49. Pattern: Root Injection

Daripada membuat path dari global default filesystem di dalam method:

```java
Path root = Path.of(System.getProperty("app.data.dir"));
```

lebih baik inject di boundary:

```java
final class StoragePaths {
    private final Path root;

    StoragePaths(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    Path inbox() {
        return root.resolve("inbox");
    }

    Path processing() {
        return root.resolve("processing");
    }

    Path done() {
        return root.resolve("done");
    }
}
```

Untuk test:

```java
@TempDir
Path tempDir;

@Test
void testStorage() {
    StoragePaths paths = new StoragePaths(tempDir);
}
```

Untuk custom provider:

```java
StoragePaths paths = new StoragePaths(customFs.getPath("/app"));
```

---

## 50. Pattern: Provider-Aware Diagnostics

Saat production incident, informasi provider sangat membantu.

Helper:

```java
static Map<String, Object> diagnostics(Path path) {
    Map<String, Object> out = new LinkedHashMap<>();
    FileSystem fs = path.getFileSystem();

    out.put("path", path.toString());
    out.put("absolute", safe(() -> path.toAbsolutePath().toString()));
    out.put("providerScheme", fs.provider().getScheme());
    out.put("fileSystemClass", fs.getClass().getName());
    out.put("separator", fs.getSeparator());
    out.put("isOpen", fs.isOpen());
    out.put("isReadOnly", fs.isReadOnly());
    out.put("attributeViews", fs.supportedFileAttributeViews());

    try {
        FileStore store = Files.getFileStore(path);
        out.put("fileStoreName", store.name());
        out.put("fileStoreType", store.type());
        out.put("fileStoreReadOnly", store.isReadOnly());
        out.put("usableSpace", store.getUsableSpace());
    } catch (IOException | UnsupportedOperationException e) {
        out.put("fileStoreError", e.getClass().getName() + ": " + e.getMessage());
    }

    return out;
}

interface SupplierWithException<T> {
    T get() throws Exception;
}

static Object safe(SupplierWithException<?> s) {
    try {
        return s.get();
    } catch (Exception e) {
        return e.getClass().getSimpleName() + ": " + e.getMessage();
    }
}
```

Gunakan hati-hati jika path mengandung data sensitif.

---

## 51. Pattern: Explicit Storage Backend Contract

Jika aplikasi Anda mendukung banyak backend, jangan hanya bilang:

```text
We support Path.
```

Lebih baik definisikan contract:

```text
Storage backend requirements:
1. Must support regular file read/write.
2. Must support directory creation and listing.
3. Must support atomic move within the same directory.
4. Must support replacing existing file atomically.
5. Must support basic attributes: size, modified time, regular file/directory type.
6. Does not require POSIX permissions.
7. Does not require symbolic links.
8. Does not require WatchService.
9. FileStore usable space is used as advisory only.
10. Backend must be tested with application conformance tests.
```

Lalu buat conformance test suite.

---

## 52. Provider Conformance Test Suite

Jika Anda ingin menerima arbitrary `Path` root, buat test suite yang bisa dijalankan terhadap root tersebut.

Contoh:

```java
interface StorageConformanceTest {
    Path root() throws IOException;
}
```

Test cases:

1. create directory
2. create file
3. read file
4. overwrite file
5. append file jika dibutuhkan
6. list directory
7. read basic attributes
8. delete file
9. delete directory
10. atomic move temp → final jika dibutuhkan
11. reject path traversal
12. concurrent create same file
13. large file if needed
14. non-ASCII filename if supported
15. failure cleanup

Contoh atomic move test:

```java
static void assertAtomicMoveSupported(Path root) throws IOException {
    Files.createDirectories(root);
    Path tmp = root.resolve("atomic-test.tmp");
    Path target = root.resolve("atomic-test.txt");

    Files.writeString(tmp, "hello");
    try {
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException e) {
        throw new AssertionError("Storage backend must support atomic move", e);
    } finally {
        Files.deleteIfExists(tmp);
        Files.deleteIfExists(target);
    }
}
```

---

## 53. Case Study: Export Service yang Mendukung Local Directory dan ZIP

Requirement:

```text
Service harus bisa export beberapa report ke target filesystem.
Target bisa local directory atau ZIP filesystem.
```

Desain buruk:

```java
void export(String outputDir) throws IOException {
    Files.writeString(Path.of(outputDir + "/summary.csv"), "...");
    Files.writeString(Path.of(outputDir + "/detail.csv"), "...");
}
```

Desain provider-neutral:

```java
final class ReportExporter {
    void export(Path outputRoot) throws IOException {
        Files.createDirectories(outputRoot);
        write(outputRoot.resolve("summary.csv"), "id,total\n1,100\n");
        write(outputRoot.resolve("detail.csv"), "id,line\n1,A\n");
    }

    private void write(Path path, String content) throws IOException {
        Path parent = path.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(path, content, StandardCharsets.UTF_8,
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE);
    }
}
```

Local usage:

```java
new ReportExporter().export(Path.of("/tmp/export"));
```

ZIP usage:

```java
Path zip = Path.of("/tmp/export.zip");
try (FileSystem fs = FileSystems.newFileSystem(zip, Map.of("create", "true"))) {
    new ReportExporter().export(fs.getPath("/"));
}
```

Hal yang bagus:

- exporter tidak tahu backend
- tidak memakai `File`
- tidak string concat path
- memakai `Path.resolve`
- operasi minimal dan jelas

Hal yang tetap harus diuji:

- ZIP write lifecycle
- overwrite behavior
- directory creation behavior
- encoding filename
- close filesystem

---

## 54. Case Study: File Intake yang Tidak Boleh Menerima ZIP FS

Kadang provider-neutral bukan tujuan. Untuk file intake production, Anda mungkin sengaja ingin hanya local/mounted filesystem.

Misalnya karena butuh:

- atomic rename
- file lock
- FileStore capacity
- OS permission
- external scanner integration
- Kubernetes mounted volume

Maka validasi provider di startup:

```java
static void requireSupportedStorage(Path root) throws IOException {
    FileSystem fs = root.getFileSystem();
    String scheme = fs.provider().getScheme();

    if (!"file".equalsIgnoreCase(scheme)) {
        throw new IllegalArgumentException("Only default file provider is supported, got: " + scheme);
    }

    Files.createDirectories(root);

    FileStore store = Files.getFileStore(root);
    if (store.isReadOnly()) {
        throw new IOException("Storage root is read-only: " + root);
    }

    Path tmp = Files.createTempFile(root, ".capability-", ".tmp");
    Path target = root.resolve(tmp.getFileName() + ".moved");
    try {
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
    } catch (AtomicMoveNotSupportedException e) {
        throw new IOException("Storage root must support atomic move", e);
    } finally {
        Files.deleteIfExists(tmp);
        Files.deleteIfExists(target);
    }
}
```

Ini bukan “kurang fleksibel”. Ini engineering yang jujur terhadap requirement.

---

## 55. Case Study: Plugin Scanner dari Multiple Providers

Requirement:

```text
Aplikasi dapat scan plugin dari:
- local directory
- ZIP/JAR file
- test in-memory filesystem
```

API:

```java
interface PluginSource {
    void scan(PluginVisitor visitor) throws IOException;
}

interface PluginVisitor {
    void visit(Path pluginDescriptor) throws IOException;
}
```

Local source:

```java
final class DirectoryPluginSource implements PluginSource {
    private final Path root;

    DirectoryPluginSource(Path root) {
        this.root = root;
    }

    @Override
    public void scan(PluginVisitor visitor) throws IOException {
        try (Stream<Path> stream = Files.find(root, 10,
                (p, attrs) -> attrs.isRegularFile() && p.getFileName().toString().equals("plugin.json"))) {
            Iterator<Path> it = stream.iterator();
            while (it.hasNext()) {
                visitor.visit(it.next());
            }
        }
    }
}
```

ZIP source:

```java
final class ZipPluginSource implements PluginSource {
    private final Path zipPath;

    ZipPluginSource(Path zipPath) {
        this.zipPath = zipPath;
    }

    @Override
    public void scan(PluginVisitor visitor) throws IOException {
        try (FileSystem fs = FileSystems.newFileSystem(zipPath, Map.of())) {
            Path root = fs.getPath("/");
            new DirectoryPluginSource(root).scan(visitor);
        }
    }
}
```

Dengan desain ini, scanner reuse path logic dan lifecycle ZIP FS tetap jelas.

---

## 56. Common Bug: Returning Path from Closed FileSystem

Bug:

```java
Path findEntry(Path zipPath, String name) throws IOException {
    try (FileSystem fs = FileSystems.newFileSystem(zipPath, Map.of())) {
        Path entry = fs.getPath(name);
        if (Files.exists(entry)) {
            return entry;
        }
        return null;
    }
}
```

Setelah method return, `fs` sudah closed. `Path` yang dikembalikan tidak reliable untuk operasi lanjutan.

Solusi:

1. Baca content di dalam lifecycle:

```java
byte[] readEntry(Path zipPath, String name) throws IOException {
    try (FileSystem fs = FileSystems.newFileSystem(zipPath, Map.of())) {
        Path entry = fs.getPath(name);
        return Files.readAllBytes(entry);
    }
}
```

2. Atau expose callback:

```java
void withEntry(Path zipPath, String name, IOConsumer<Path> action) throws IOException {
    try (FileSystem fs = FileSystems.newFileSystem(zipPath, Map.of())) {
        action.accept(fs.getPath(name));
    }
}
```

3. Atau caller owns `FileSystem`:

```java
Path findEntry(FileSystem fs, String name) throws IOException {
    Path entry = fs.getPath(name);
    return Files.exists(entry) ? entry : null;
}
```

---

## 57. Common Bug: Creating Paths with Wrong FileSystem

Bug:

```java
void copyFromZip(FileSystem zipFs, String entryName, Path targetRoot) throws IOException {
    Path entry = Path.of(entryName); // WRONG: default filesystem
    Path target = targetRoot.resolve(entry.getFileName().toString());
    Files.copy(entry, target);
}
```

Correct:

```java
void copyFromZip(FileSystem zipFs, String entryName, Path targetRoot) throws IOException {
    Path entry = zipFs.getPath(entryName); // correct provider
    Path target = targetRoot.resolve(entry.getFileName().toString());
    Files.copy(entry, target, StandardCopyOption.REPLACE_EXISTING);
}
```

Invariant:

```text
Use fs.getPath(...) when constructing path intended for a specific FileSystem.
```

---

## 58. Common Bug: Comparing Path Strings Across Providers

Bug:

```java
if (path.toString().startsWith(root.toString())) {
    // assume contained
}
```

Problems:

- separator differences
- normalization differences
- provider-specific path syntax
- case sensitivity differences
- symlink/real path issue
- `/safe/root2` starts with `/safe/root`

Better:

```java
Path normalizedRoot = root.normalize();
Path normalizedPath = path.normalize();

if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new SecurityException("Path escapes root");
}
```

For security-critical local filesystem, use stronger real-path containment design as discussed earlier.

---

## 59. Common Bug: Assuming `FileSystem.close()` Is Harmless

If filesystem is shared, closing it can break other users.

Bug:

```java
void write(FileSystem fs) throws IOException {
    try (fs) { // Java 9+ effectively final resource
        Files.writeString(fs.getPath("/a.txt"), "hello");
    }
}
```

This method closes a resource it does not own.

Better:

```java
void write(FileSystem fs) throws IOException {
    Files.writeString(fs.getPath("/a.txt"), "hello");
}
```

Ownership rule:

```text
The code that opens a FileSystem usually closes it.
The code that receives a FileSystem usually must not close it.
```

---

## 60. Java 8 hingga Java 25 Compatibility Notes

### Java 8

Use:

```java
Paths.get("/tmp/a.txt")
Files.write(path, lines, charset)
Collections.emptyMap()
HashMap
```

No:

```java
Path.of(...)
Files.readString(...)
Files.writeString(...)
Map.of(...)
var
```

### Java 9+

Available:

```java
Path.of(...)
Map.of(...)
try (resource) with effectively final variable
```

### Java 11+

Convenience methods:

```java
Files.readString(path)
Files.writeString(path, content)
```

### Java 25

Core NIO.2 provider model remains the same, but always check latest docs for provider-specific modules like `jdk.zipfs` because provider properties and documented behavior can evolve.

Compatibility style for examples:

```java
// Java 8 compatible
Path path = Paths.get("/tmp/a.txt");
Files.write(path, Arrays.asList("hello"), StandardCharsets.UTF_8);

// Java 11+ style
Path path = Path.of("/tmp/a.txt");
Files.writeString(path, "hello", StandardCharsets.UTF_8);
```

---

## 61. Decision Framework: Should My Code Be Provider-Neutral?

Ask:

### 1. Is this library-level code?

If yes, prefer `Path` and provider-neutral `Files` APIs.

### 2. Does the logic require local OS semantics?

If yes, explicitly validate provider/capability.

### 3. Does correctness require atomic rename?

If yes, test `ATOMIC_MOVE` and fail if unsupported.

### 4. Does correctness require POSIX permission?

If yes, require `PosixFileAttributeView` and reject otherwise.

### 5. Does correctness require file locking?

If yes, test on target OS/filesystem. Do not assume provider-neutral lock semantics.

### 6. Does performance matter for remote/custom provider?

If yes, minimize metadata calls and directory round trips.

### 7. Does storage backend look like object storage?

If yes, consider domain-specific `BlobStore` abstraction instead of `Path`.

---

## 62. Design Matrix

| Scenario | Recommended Abstraction | Why |
|---|---|---|
| General file utility library | `Path` + `Files` | Provider-neutral, testable |
| Local-only intake engine | `Path`, validated default/local provider | Needs OS semantics |
| ZIP export/import | `FileSystem` lifecycle + `Path` inside ZIP | Archive as FS |
| Unit testing path logic | In-memory FS or `@TempDir` | Fast/isolated |
| Crash consistency | Real filesystem | In-memory cannot model durability |
| Object storage | `BlobStore` abstraction | Filesystem semantics mismatch |
| Distributed coordination | DB/Redis/etcd/etc. | File lock not portable enough |
| Plugin resources | `Path` or `URI` depending lifecycle | Need clear ownership |
| Legacy library interop | `File`, guarded conversion | Legacy boundary only |

---

## 63. Production Checklist

Sebelum mengklaim kode filesystem Anda robust, jawab checklist ini.

### Provider Identity

- [ ] Apakah path berasal dari provider yang diharapkan?
- [ ] Apakah kode menghindari `new File(path.toString())`?
- [ ] Apakah `path.toFile()` hanya dipakai di legacy boundary?
- [ ] Apakah root dan candidate path berasal dari filesystem yang sama?

### Capability

- [ ] Apakah code mengecek attribute view sebelum POSIX/ACL/user-defined attribute?
- [ ] Apakah code tidak mengasumsikan symlink tersedia?
- [ ] Apakah code tidak mengasumsikan `WatchService` reliable?
- [ ] Apakah code tidak mengasumsikan `FileStore` capacity sebagai reservation?

### Atomicity

- [ ] Apakah `ATOMIC_MOVE` dipakai saat benar-benar dibutuhkan?
- [ ] Apakah fallback non-atomic dilakukan hanya jika business membolehkan?
- [ ] Apakah cross-provider move tidak dianggap atomic?

### Lifecycle

- [ ] Apakah `FileSystem` yang dibuat ditutup?
- [ ] Apakah path dari closed filesystem tidak dikembalikan?
- [ ] Apakah ownership `FileSystem` jelas?

### Security

- [ ] Apakah path traversal tidak divalidasi via string prefix?
- [ ] Apakah provider boundary tidak merusak sandbox?
- [ ] Apakah URI/path parser custom punya aturan jelas?
- [ ] Apakah tenant isolation diuji?

### Performance

- [ ] Apakah repeated metadata calls dikurangi?
- [ ] Apakah directory listing dianggap potentially expensive?
- [ ] Apakah remote/custom provider tidak diperlakukan seperti local disk?

### Testing

- [ ] Apakah ada test dengan real temp directory?
- [ ] Apakah ada conformance test untuk provider yang didukung?
- [ ] Apakah ada test failure untuk unsupported features?
- [ ] Apakah Java 8 compatibility dijaga jika target masih Java 8?

---

## 64. Mental Model Ringkas

Simpan model ini:

```text
Path is not a string.
Path belongs to a FileSystem.
FileSystem belongs to a FileSystemProvider.
Files.* dispatches to the provider.
Provider determines semantics.
Same API does not imply same guarantee.
```

Atau lebih tajam:

```text
NIO.2 gives you a common language for file operations.
It does not erase the physics and semantics of the underlying storage.
```

---

## 65. What Top 1% Engineers Do Differently

Engineer biasa:

```java
Files.move(tmp, target, ATOMIC_MOVE, REPLACE_EXISTING);
```

lalu menganggap selesai.

Engineer kuat:

- memastikan temp dan target berada di provider/filesystem yang sama
- tahu `ATOMIC_MOVE` bisa gagal
- memutuskan fallback secara eksplisit
- tahu provider mungkin bukan local filesystem
- tahu durability masih membutuhkan flush/force untuk skenario tertentu
- tahu directory fsync mungkin relevan di local filesystem
- tahu object storage tidak punya rename atomic asli
- tahu test harus dijalankan di backend storage target

Engineer biasa:

```java
File f = path.toFile();
```

Engineer kuat:

- menjaga provider identity dengan `Path`
- turun ke `File` hanya di boundary legacy
- fail fast jika provider tidak kompatibel

Engineer biasa:

```java
Files.getPosixFilePermissions(path);
```

Engineer kuat:

- mengecek attribute view
- punya fallback Windows/ACL/container strategy
- tidak membuat security bergantung pada metadata yang tidak enforced

Engineer biasa:

```java
Files.list(dir).forEach(...);
```

Engineer kuat:

- menutup stream
- tahu listing bisa expensive
- tahu provider remote bisa network/pagination
- tahu listing weakly consistent
- punya error handling

---

## 66. Latihan Praktis

### Exercise 1 — Provider Diagnostics

Buat method:

```java
Map<String, Object> inspect(Path path)
```

Yang mengembalikan:

- provider scheme
- filesystem class
- separator
- supported attribute views
- filestore name/type
- read-only status
- usable space
- whether POSIX/ACL/user-defined attributes are supported

Jalankan terhadap:

- local temp directory
- ZIP filesystem root
- path biasa di project

Bandingkan output.

### Exercise 2 — Provider-Neutral Exporter

Buat `ReportExporter` yang menerima `Path outputRoot`.

Requirement:

- create directory jika perlu
- tulis `summary.csv`
- tulis `detail.csv`
- tidak memakai `File`
- tidak memakai string concat path
- bisa dijalankan ke local directory dan ZIP filesystem

### Exercise 3 — Atomic Capability Test

Buat startup check untuk storage root:

- create temp file
- move temp ke final dengan `ATOMIC_MOVE`
- cleanup
- fail jika tidak supported

### Exercise 4 — Legacy Boundary Guard

Buat method:

```java
File toLegacyFile(Path path)
```

Yang:

- menolak provider non-`file`
- mengembalikan `path.toFile()` hanya jika aman
- punya error message jelas

### Exercise 5 — Closed FileSystem Bug

Buat test yang menunjukkan path dari ZIP filesystem tidak boleh dipakai setelah filesystem ditutup.

---

## 67. Ringkasan

`FileSystemProvider` adalah lapisan yang membuat NIO.2 powerful sekaligus berbahaya jika disalahpahami.

Dengan provider model, Java dapat memakai API yang sama untuk:

- local filesystem
- ZIP/JAR archive
- custom filesystem
- in-memory filesystem
- virtual filesystem
- remote-like provider

Tetapi API yang sama tidak berarti guarantee yang sama.

Kesimpulan utama:

1. `Path` membawa identitas `FileSystem`.
2. `Files.*` mendelegasikan operasi ke provider path tersebut.
3. Provider diidentifikasi oleh URI scheme.
4. Default provider biasanya scheme `file`, tetapi bukan berarti selalu local disk sederhana.
5. ZIP provider adalah contoh nyata archive sebagai filesystem.
6. Custom provider harus jujur soal capability, atomicity, consistency, lifecycle, security, dan performance.
7. Object storage tidak otomatis menjadi filesystem hanya karena ada provider yang membungkusnya.
8. Provider-neutral code harus menghindari `File`, string path concat, dan silent fallback.
9. Local-only code harus fail fast dengan capability validation.
10. Top-level design harus memilih abstraction sesuai semantic backend, bukan sekadar API yang nyaman.

---

## 68. Referensi Utama

- Java SE 25 `java.nio.file.spi.FileSystemProvider`
- Java SE 25 `java.nio.file.spi` package summary
- Java SE 25 `java.nio.file.Files`
- Java SE 25 `java.nio.file.FileSystem`
- Java SE 25 `java.nio.file.FileSystems`
- Java SE 25 `java.nio.file.FileStore`
- Java SE 25 `jdk.zipfs` module summary
- Java SE 8 `java.nio.file.spi` package summary
- Java SE 8 NIO.2 APIs for compatibility considerations

---

## 69. Posisi Dalam Seri

Bagian ini menyelesaikan fondasi provider/pluggable filesystem.

Sampai sini kita sudah memahami bahwa filesystem operation di Java bukan hanya API call, tetapi kontrak antara:

```text
Path
FileSystem
FileSystemProvider
FileStore
AttributeView
OS/backend semantics
Runtime environment
```

Berikutnya kita akan masuk ke legacy interop:

```text
Part 26 — Legacy java.io.File: Interop, Migration, and Compatibility
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 24 — Archives and Virtual Filesystems: ZIP FileSystem and JAR-Like Access](./learn-java-io-file-filesystem-storage-engineering-part-24-archives-virtual-filesystems.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 26 — Legacy `java.io.File`: Interop, Migration, and Compatibility](./learn-java-io-file-filesystem-storage-engineering-part-26-legacy-java-io-file-interop-migration-compatibility.md)
