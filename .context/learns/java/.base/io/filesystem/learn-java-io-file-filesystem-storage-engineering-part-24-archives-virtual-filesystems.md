# learn-java-io-file-filesystem-storage-engineering — Part 24
# Archives and Virtual Filesystems: ZIP FileSystem and JAR-Like Access

> Target Java: 8 sampai 25  
> Fokus: ZIP/JAR sebagai archive, ZIP sebagai virtual filesystem, `jdk.zipfs`, `java.util.zip`, path safety, lifecycle, update semantics, archive extraction, dan production-grade archive workflow.

---

## 1. Tujuan Bagian Ini

Setelah bagian sebelumnya, kita sudah memahami:

- path sebagai struktur, bukan sekadar string;
- traversal, symlink, security boundary;
- read/write/copy/move/delete semantics;
- integrity hashing;
- content detection;
- file workflow durability.

Bagian ini masuk ke satu area yang sering terlihat sederhana tetapi sering menyebabkan bug/security incident: **archive**.

Di Java, archive terutama ZIP/JAR dapat dikerjakan dengan dua model besar:

1. **stream/archive model** memakai `java.util.zip`:
   - `ZipInputStream`
   - `ZipOutputStream`
   - `ZipFile`
   - `ZipEntry`

2. **virtual filesystem model** memakai NIO.2 ZIP filesystem provider:
   - `FileSystems.newFileSystem(...)`
   - `Path` di dalam ZIP
   - `Files.copy`, `Files.walk`, `Files.readString`, dan operasi NIO lain terhadap isi ZIP

Mental model penting:

```text
ZIP/JAR file fisik di host filesystem
        |
        | dibuka oleh provider jdk.zipfs
        v
virtual FileSystem dengan root, directory, file entry, path, metadata terbatas
        |
        v
Path di dalam archive dapat dioperasikan dengan Files API
```

Jadi archive bukan hanya “file yang dikompresi”. Dari sudut Java NIO, archive bisa diproyeksikan sebagai **filesystem virtual**.

Namun jangan salah paham: ZIP filesystem **bukan filesystem penuh**. Ia adalah provider khusus yang memetakan central directory dan entries ZIP menjadi path-like objects. Banyak asumsi filesystem biasa bisa salah.

---

## 2. Kenapa Archive Engineering Penting

Archive muncul di banyak sistem backend:

- export laporan batch;
- import dokumen multi-file;
- package artefak deployment;
- upload attachment massal;
- integrasi antar instansi/vendor;
- plugin/module distribution;
- signed JAR verification;
- backup/restore kecil;
- document bundle;
- generated evidence bundle;
- case-management dossier;
- template pack;
- migration package.

Masalahnya, archive membawa beberapa risiko sekaligus:

| Risiko | Contoh |
|---|---|
| Path traversal | entry `../../app/config.yml` diekstrak keluar target directory |
| Archive bomb | file ZIP kecil decompress menjadi ratusan GB |
| Resource exhaustion | terlalu banyak entry, terlalu dalam directory, terlalu banyak file kecil |
| Type confusion | file dinamai `.pdf` tetapi isinya executable/script |
| Metadata confusion | timestamp/permission dari archive dipercaya mentah-mentah |
| Race condition | extract ke directory yang bisa dimodifikasi pihak lain |
| Partial extraction | beberapa file sudah dibuat lalu gagal di tengah |
| Update illusion | mengira update satu entry sama murah/atomic seperti rename file biasa |
| Encoding issue | nama entry berbeda interpretasi antar tool/platform |
| Symlink-like hazard | archive format lain bisa membawa symlink; ZIP juga dapat menyimpan atribut eksternal tertentu |

Top 1% engineer tidak hanya tahu cara membuat ZIP. Mereka tahu:

- kapan ZIP cocok;
- kapan ZIP filesystem provider nyaman;
- kapan streaming API lebih aman;
- bagaimana membatasi ekstraksi;
- bagaimana rollback partial extraction;
- bagaimana validasi setiap entry;
- bagaimana menjaga atomic publish;
- bagaimana mendesain archive sebagai contract.

---

## 3. Terminologi Dasar

### 3.1 Archive

Archive adalah file container yang menyimpan beberapa entry.

Contoh:

```text
bundle.zip
├── manifest.json
├── documents/
│   ├── invoice-001.pdf
│   └── invoice-002.pdf
└── metadata/
    └── checksum.sha256
```

Secara fisik, `bundle.zip` tetap satu file. Secara logical, ia berisi banyak entry.

### 3.2 Entry

Entry adalah satu item di dalam archive.

Entry dapat berupa:

- file entry;
- directory entry;
- metadata entry;
- kadang entry khusus seperti manifest/signature di JAR.

Dalam `java.util.zip`, entry direpresentasikan oleh `ZipEntry`.

### 3.3 ZIP

ZIP adalah archive format yang umum, mendukung:

- banyak entry;
- kompresi per entry;
- directory logical;
- metadata terbatas;
- central directory di akhir file;
- ZIP64 untuk ukuran besar.

### 3.4 JAR

JAR adalah ZIP dengan konvensi Java:

```text
META-INF/MANIFEST.MF
META-INF/*.SF
META-INF/*.RSA / *.DSA / *.EC
com/example/App.class
```

JAR adalah ZIP, tetapi punya makna tambahan untuk classpath/module path, manifest, signing, service provider, dan packaging Java.

### 3.5 Virtual Filesystem

Virtual filesystem adalah filesystem abstraction yang tidak selalu merepresentasikan directory fisik OS.

Contoh:

- ZIP filesystem;
- in-memory filesystem;
- custom provider;
- cloud/object-like provider;
- module image filesystem internal JDK;
- test filesystem.

Dalam Java NIO, virtual filesystem tetap expose object seperti:

- `FileSystem`
- `Path`
- `Files`
- `FileSystemProvider`

Tetapi capability-nya provider-specific.

---

## 4. Dua Model API di Java

## 4.1 `java.util.zip`: Stream dan Entry Model

API ini cocok saat kita ingin membaca/menulis ZIP sebagai sequence entry.

Contoh kelas utama:

```java
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import java.util.zip.ZipFile;
import java.util.zip.ZipEntry;
```

Modelnya:

```text
open archive stream/file
  -> iterate entry
  -> read/write bytes per entry
  -> close entry
close archive
```

### Kelebihan

- tersedia sejak Java lama;
- Java 8 compatible;
- bagus untuk streaming upload/download;
- tidak harus expose archive sebagai filesystem;
- lebih eksplisit untuk kontrol size limit dan extraction policy;
- bisa memproses entry satu per satu.

### Kekurangan

- kode lebih manual;
- harus mengelola path extraction sendiri;
- recursive tree logic harus dibuat sendiri;
- update existing archive tidak senyaman `Files.copy`;
- sulit memperlakukan isi ZIP seperti `Path` biasa.

---

## 4.2 NIO ZIP FileSystem: Filesystem Model

Java menyediakan ZIP filesystem provider melalui `jdk.zipfs`.

Modelnya:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath)) {
    Path root = zipfs.getPath("/");
    Path manifest = zipfs.getPath("/manifest.json");
    String text = Files.readString(manifest); // Java 11+
}
```

Untuk Java 8:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, null)) {
    Path manifest = zipfs.getPath("/manifest.json");
    byte[] bytes = Files.readAllBytes(manifest);
    String text = new String(bytes, StandardCharsets.UTF_8);
}
```

### Kelebihan

- isi ZIP dapat diperlakukan seperti `Path`;
- bisa memakai `Files.walk`, `Files.copy`, `Files.exists`, `Files.readAttributes`;
- cocok untuk read/query/update sederhana;
- konsepnya konsisten dengan NIO.2;
- bagus untuk tooling, packaging, inspection, transformation.

### Kekurangan

- provider-specific;
- update semantics tidak sama dengan filesystem fisik;
- harus close `FileSystem` agar perubahan terselesaikan;
- tidak cocok untuk archive untrusted tanpa policy ketat;
- ZIP filesystem bukan tempat ideal untuk transaksi kompleks;
- JDK module `jdk.zipfs` perlu tersedia di runtime modular.

---

## 5. Java 8 sampai 25: Kompatibilitas Penting

### 5.1 Java 8

Java 8 sudah memiliki NIO.2 dan ZIP filesystem provider.

Pola Java 8 umum:

```java
Map<String, String> env = new HashMap<>();
env.put("create", "true");

URI uri = URI.create("jar:" + zipPath.toUri());
try (FileSystem zipfs = FileSystems.newFileSystem(uri, env)) {
    Path path = zipfs.getPath("/hello.txt");
    Files.write(path, "hello".getBytes(StandardCharsets.UTF_8));
}
```

Atau memakai `Path` factory:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, null)) {
    // use zipfs
}
```

Tergantung overload dan versi, penggunaan `Map<String, ?>` lebih jelas.

### 5.2 Java 9+

Mulai Java 9, module system memperjelas bahwa ZIP filesystem provider berada pada module:

```text
jdk.zipfs
```

Jika aplikasi modular dan memakai ZIP filesystem provider, module descriptor dapat membutuhkan:

```java
module com.example.archiveapp {
    requires java.base;
    requires jdk.zipfs;
}
```

Untuk aplikasi classpath biasa, biasanya tidak terasa. Tetapi dalam custom runtime image `jlink`, module `jdk.zipfs` bisa tidak ada jika tidak disertakan.

### 5.3 Java 11+

Java 11 menambah convenience API seperti:

```java
Files.readString(path);
Files.writeString(path, content);
```

Untuk seri ini, ketika ada contoh Java 11+, akan diberi alternatif Java 8 jika penting.

### 5.4 Java 25

Java 25 tetap mempertahankan model NIO.2. Dokumentasi `jdk.zipfs` menyatakan provider ini memperlakukan isi ZIP/JAR sebagai filesystem dan dapat dibuka/dibuat via `FileSystems.newFileSystem`.

Yang penting untuk engineer senior:

```text
Jangan menulis kode yang bergantung pada implementation detail class internal jdk.nio.zipfs.*.
Gunakan API public: FileSystems, FileSystem, Path, Files, java.util.zip.
```

---

## 6. Membuka ZIP sebagai FileSystem

Ada beberapa cara.

## 6.1 Membuka Existing ZIP dari `Path`

```java
Path zip = Paths.get("bundle.zip");

try (FileSystem zipfs = FileSystems.newFileSystem(zip, (ClassLoader) null)) {
    Path manifest = zipfs.getPath("/manifest.json");
    byte[] bytes = Files.readAllBytes(manifest);
}
```

Catatan:

- `FileSystem` harus ditutup.
- Jangan menyimpan `Path` dari `zipfs` setelah `zipfs.close()`.
- `Path` di dalam ZIP milik filesystem virtual, bukan default filesystem.

Salah:

```java
Path leaked;
try (FileSystem zipfs = FileSystems.newFileSystem(zip, (ClassLoader) null)) {
    leaked = zipfs.getPath("/manifest.json");
}
Files.readAllBytes(leaked); // zipfs sudah closed
```

Benar:

```java
byte[] manifestBytes;
try (FileSystem zipfs = FileSystems.newFileSystem(zip, (ClassLoader) null)) {
    manifestBytes = Files.readAllBytes(zipfs.getPath("/manifest.json"));
}
```

---

## 6.2 Membuka Existing ZIP dari URI `jar:`

```java
Path zip = Paths.get("bundle.zip");
URI uri = URI.create("jar:" + zip.toUri());

try (FileSystem zipfs = FileSystems.newFileSystem(uri, Collections.emptyMap())) {
    Path root = zipfs.getPath("/");
    try (Stream<Path> entries = Files.walk(root)) {
        entries.forEach(System.out::println);
    }
}
```

URI scheme untuk ZIP filesystem adalah `jar`.

Contoh bentuk URI:

```text
jar:file:///tmp/bundle.zip
```

Jangan membuat URI dengan string path mentah seperti ini:

```java
URI uri = URI.create("jar:file:" + zip.toString()); // rentan error path escaping
```

Lebih aman:

```java
URI uri = URI.create("jar:" + zip.toUri().toString());
```

---

## 6.3 Membuat ZIP Baru

```java
Path zip = Paths.get("out.zip");
Map<String, String> env = new HashMap<>();
env.put("create", "true");

URI uri = URI.create("jar:" + zip.toUri());

try (FileSystem zipfs = FileSystems.newFileSystem(uri, env)) {
    Path file = zipfs.getPath("/hello.txt");
    Files.write(file, "hello".getBytes(StandardCharsets.UTF_8));
}
```

Penting:

- perubahan biasanya diselesaikan saat close;
- kalau proses crash sebelum close, archive bisa tidak lengkap/corrupt;
- untuk publish produksi, buat ZIP di temp file lalu atomic move ke final location.

---

## 7. Path di Dalam ZIP

Path dalam ZIP filesystem bukan path default filesystem.

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, (ClassLoader) null)) {
    Path inside = zipfs.getPath("/documents/report.pdf");
    Path outside = Paths.get("/documents/report.pdf");

    System.out.println(inside.getFileSystem() == outside.getFileSystem()); // false
}
```

Mental model:

```text
Default filesystem path:
  /tmp/bundle.zip

ZIP filesystem path:
  /documents/report.pdf
```

Keduanya sama-sama `Path`, tetapi provider-nya berbeda.

Konsekuensi:

- jangan bandingkan string path antar filesystem sebagai identitas;
- `Path.resolve` hanya valid dalam filesystem yang sama;
- `Files.copy` bisa copy dari default FS ke ZIP FS dan sebaliknya karena API menerima dua `Path` provider berbeda;
- beberapa operasi attribute/permission mungkin tidak didukung.

---

## 8. Membaca Isi ZIP dengan NIO ZIP FileSystem

Contoh list semua entry:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, (ClassLoader) null)) {
    Path root = zipfs.getPath("/");

    try (Stream<Path> stream = Files.walk(root)) {
        stream
            .filter(Files::isRegularFile)
            .forEach(System.out::println);
    }
}
```

Contoh membaca file tertentu:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, (ClassLoader) null)) {
    Path manifest = zipfs.getPath("/manifest.json");
    byte[] bytes = Files.readAllBytes(manifest);
    String json = new String(bytes, StandardCharsets.UTF_8);
}
```

Contoh copy dari ZIP ke default filesystem:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, (ClassLoader) null)) {
    Path source = zipfs.getPath("/documents/report.pdf");
    Path target = Paths.get("/tmp/report.pdf");

    Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
}
```

Contoh copy dari default filesystem ke ZIP:

```java
Map<String, String> env = Map.of("create", "true"); // Java 9+
URI uri = URI.create("jar:" + zipPath.toUri());

try (FileSystem zipfs = FileSystems.newFileSystem(uri, env)) {
    Path source = Paths.get("report.pdf");
    Path target = zipfs.getPath("/documents/report.pdf");

    Files.createDirectories(target.getParent());
    Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
}
```

Java 8 version:

```java
Map<String, String> env = new HashMap<>();
env.put("create", "true");
URI uri = URI.create("jar:" + zipPath.toUri());

try (FileSystem zipfs = FileSystems.newFileSystem(uri, env)) {
    Path source = Paths.get("report.pdf");
    Path target = zipfs.getPath("/documents/report.pdf");

    Files.createDirectories(target.getParent());
    Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
}
```

---

## 9. Reading Archive: `ZipFile` vs `ZipInputStream` vs ZIP FileSystem

## 9.1 `ZipInputStream`

`ZipInputStream` membaca archive sebagai stream linear.

```java
try (InputStream in = Files.newInputStream(zipPath);
     ZipInputStream zis = new ZipInputStream(new BufferedInputStream(in))) {

    ZipEntry entry;
    while ((entry = zis.getNextEntry()) != null) {
        if (!entry.isDirectory()) {
            // read bytes for current entry from zis
        }
        zis.closeEntry();
    }
}
```

Cocok untuk:

- upload stream;
- archive dari network;
- memproses entry satu per satu;
- membatasi extraction policy manual;
- tidak butuh random access.

Kurang cocok untuk:

- cari satu entry di archive besar tanpa membaca sequence;
- banyak random lookup;
- operasi seperti filesystem.

---

## 9.2 `ZipFile`

`ZipFile` membaca archive dari file dan mendukung lookup entry.

```java
try (ZipFile zipFile = new ZipFile(zipPath.toFile())) {
    ZipEntry entry = zipFile.getEntry("manifest.json");
    if (entry != null) {
        try (InputStream in = zipFile.getInputStream(entry)) {
            byte[] bytes = in.readAllBytes(); // Java 9+
        }
    }
}
```

Java 8:

```java
static byte[] readAll(InputStream in) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int n;
    while ((n = in.read(buffer)) != -1) {
        out.write(buffer, 0, n);
    }
    return out.toByteArray();
}
```

Cocok untuk:

- archive sudah ada di disk;
- lookup entry by name;
- membaca metadata entry;
- inspection tool.

Kurang cocok untuk:

- membuat ZIP;
- operasi tree dengan NIO abstraction;
- update isi archive.

---

## 9.3 ZIP FileSystem

Cocok untuk:

- memakai NIO `Path` abstraction;
- copy file masuk/keluar ZIP;
- transform isi ZIP sederhana;
- list/walk tree archive;
- memproses JAR-like content.

Kurang cocok untuk:

- streaming upload langsung tanpa staging;
- untrusted archive extraction tanpa guardrail;
- archive sangat besar dengan banyak update;
- workflow yang butuh atomic multi-entry transaction.

---

## 10. Membuat ZIP dengan `ZipOutputStream`

Untuk export pipeline, `ZipOutputStream` sering lebih predictable.

```java
Path output = Paths.get("export.zip");

try (OutputStream fout = Files.newOutputStream(output,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE);
     BufferedOutputStream bout = new BufferedOutputStream(fout);
     ZipOutputStream zout = new ZipOutputStream(bout, StandardCharsets.UTF_8)) {

    ZipEntry manifest = new ZipEntry("manifest.json");
    zout.putNextEntry(manifest);
    zout.write("{\"version\":1}".getBytes(StandardCharsets.UTF_8));
    zout.closeEntry();

    ZipEntry report = new ZipEntry("documents/report.txt");
    zout.putNextEntry(report);
    zout.write("hello".getBytes(StandardCharsets.UTF_8));
    zout.closeEntry();
}
```

### 10.1 Entry Name Harus Menggunakan `/`

ZIP entry path convention memakai `/`, bukan separator OS.

Salah:

```java
String entryName = "documents" + File.separator + "report.txt";
```

Benar:

```java
String entryName = "documents/report.txt";
```

Alasannya: ZIP adalah format lintas platform. Entry name bukan path native OS.

---

## 11. Safe ZIP Entry Naming untuk Export

Saat membuat ZIP dari file lokal, jangan langsung memakai absolute path.

Salah:

```java
ZipEntry entry = new ZipEntry(file.toString());
```

Bisa menghasilkan:

```text
/home/app/data/report.pdf
C:\Users\app\data\report.pdf
```

Benar: pakai relative path dari root export.

```java
Path exportRoot = Paths.get("/data/export-root").toRealPath();
Path file = Paths.get("/data/export-root/docs/report.pdf").toRealPath();

Path relative = exportRoot.relativize(file);
String entryName = toZipEntryName(relative);

static String toZipEntryName(Path relative) {
    StringBuilder sb = new StringBuilder();
    for (Path part : relative) {
        if (sb.length() > 0) sb.append('/');
        sb.append(part.toString());
    }
    return sb.toString();
}
```

Validasi entry name export:

```java
static String safeZipEntryName(Path root, Path file) throws IOException {
    Path realRoot = root.toRealPath();
    Path realFile = file.toRealPath();

    if (!realFile.startsWith(realRoot)) {
        throw new SecurityException("file outside export root: " + file);
    }

    Path relative = realRoot.relativize(realFile);

    for (Path part : relative) {
        String s = part.toString();
        if (s.isBlank() || s.equals(".") || s.equals("..")) {
            throw new SecurityException("unsafe path element: " + s);
        }
    }

    return toZipEntryName(relative);
}
```

---

## 12. Archive Extraction: The Dangerous Part

Extraction is where archive bugs become filesystem bugs.

Naive extraction:

```java
Path target = Paths.get("/safe/output");
Path out = target.resolve(entry.getName());
Files.copy(zis, out);
```

Jika entry name:

```text
../../app/config.yml
```

Maka target bisa keluar dari `/safe/output`.

Inilah Zip Slip/path traversal.

### 12.1 Rule Pertama

```text
Jangan pernah extract entry berdasarkan nama archive tanpa containment validation.
```

---

## 13. Secure Extraction dengan `ZipInputStream`

Pola aman minimal:

```java
public static void extractZipSafely(Path zipFile, Path destination) throws IOException {
    Path destRoot = destination.toAbsolutePath().normalize();
    Files.createDirectories(destRoot);

    try (InputStream fin = Files.newInputStream(zipFile);
         BufferedInputStream bin = new BufferedInputStream(fin);
         ZipInputStream zin = new ZipInputStream(bin, StandardCharsets.UTF_8)) {

        ZipEntry entry;
        while ((entry = zin.getNextEntry()) != null) {
            String name = entry.getName();
            Path output = resolveZipEntrySafely(destRoot, name);

            if (entry.isDirectory()) {
                Files.createDirectories(output);
            } else {
                Path parent = output.getParent();
                if (parent == null) {
                    throw new SecurityException("entry has no parent: " + name);
                }
                Files.createDirectories(parent);
                Files.copy(zin, output, StandardCopyOption.REPLACE_EXISTING);
            }

            zin.closeEntry();
        }
    }
}

static Path resolveZipEntrySafely(Path destRoot, String entryName) {
    if (entryName == null || entryName.isBlank()) {
        throw new SecurityException("blank entry name");
    }

    // ZIP convention uses forward slash. Reject obvious absolute/native forms too.
    if (entryName.startsWith("/") || entryName.startsWith("\\")) {
        throw new SecurityException("absolute entry name: " + entryName);
    }

    // Windows drive letter or UNC-like path embedded in ZIP.
    if (entryName.matches("^[A-Za-z]:.*") || entryName.startsWith("//")) {
        throw new SecurityException("platform absolute entry name: " + entryName);
    }

    Path normalized = destRoot.resolve(entryName).normalize();

    if (!normalized.startsWith(destRoot)) {
        throw new SecurityException("entry escapes destination: " + entryName);
    }

    return normalized;
}
```

Namun ini belum cukup untuk high-security environment, karena ada symlink/race concerns.

---

## 14. Better Extraction: Staging Directory + Atomic Publish

Production-grade extraction tidak sebaiknya langsung ke final directory.

Gunakan pola:

```text
incoming/archive.zip
       |
       v
staging/extract-<uuid>/
       |
       | validate all entries, size, count, hash, manifest
       v
ready/<archive-id>/       <- atomic rename/publish jika filesystem sama
```

Alasan:

- jika gagal di tengah, final location tidak tercemar partial files;
- mudah cleanup staging;
- bisa validasi keseluruhan bundle sebelum publish;
- bisa hash/checksum setelah extraction;
- bisa quarantine archive yang gagal;
- bisa menjaga state machine jelas.

Contoh layout:

```text
/var/app/archive-intake/
├── incoming/
│   └── 2026-06-18-abc.zip
├── staging/
│   └── 20260618T120000Z-uuid/
├── ready/
│   └── case-12345/
├── rejected/
│   └── 2026-06-18-abc.zip
└── logs/
```

State machine:

```text
RECEIVED
  -> STAGED
  -> EXTRACTING
  -> VALIDATING
  -> READY
  -> PROCESSING
  -> DONE

Any failure:
  -> REJECTED or QUARANTINED
```

---

## 15. Extraction Limits: Prevent Archive Bomb

Secure extraction harus punya limit.

Minimal guardrail:

| Limit | Tujuan |
|---|---|
| max compressed file size | mencegah upload terlalu besar |
| max total uncompressed bytes | mencegah zip bomb |
| max entry count | mencegah jutaan file kecil |
| max directory depth | mencegah path sangat dalam |
| max filename length | mencegah path/pathname limit problem |
| max per-entry size | mencegah satu file meledak |
| allowed extensions/content types | membatasi tipe data |
| reject duplicate entry names | mencegah overwrite ambiguity |
| reject absolute/parent traversal | mencegah escape |
| reject dangerous names | Windows reserved names, control chars, NUL |

Contoh extraction dengan limit total bytes:

```java
public final class ZipExtractionPolicy {
    final long maxTotalUncompressedBytes;
    final long maxEntryBytes;
    final int maxEntries;
    final int maxDepth;

    public ZipExtractionPolicy(long maxTotalUncompressedBytes,
                               long maxEntryBytes,
                               int maxEntries,
                               int maxDepth) {
        this.maxTotalUncompressedBytes = maxTotalUncompressedBytes;
        this.maxEntryBytes = maxEntryBytes;
        this.maxEntries = maxEntries;
        this.maxDepth = maxDepth;
    }
}
```

```java
static void copyEntryWithLimits(InputStream in, Path output,
                                long maxEntryBytes,
                                LongAdder total,
                                long maxTotalBytes) throws IOException {
    byte[] buffer = new byte[8192];
    long entryBytes = 0;

    try (OutputStream out = Files.newOutputStream(output,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE)) {

        int n;
        while ((n = in.read(buffer)) != -1) {
            entryBytes += n;
            if (entryBytes > maxEntryBytes) {
                throw new SecurityException("entry too large: " + entryBytes);
            }

            long newTotal = total.addAndGet(n);
            if (newTotal > maxTotalBytes) {
                throw new SecurityException("archive expands too large: " + newTotal);
            }

            out.write(buffer, 0, n);
        }
    }
}
```

Catatan:

- Jangan hanya percaya `ZipEntry.getSize()` karena bisa `-1` atau tidak dapat dipercaya pada archive untrusted.
- Hitung byte aktual saat decompress.
- Limit harus diterapkan selama read, bukan setelah selesai.

---

## 16. Duplicate Entry Name Problem

Archive bisa mengandung entry duplicate atau entry yang normalize ke path sama.

Contoh:

```text
report.pdf
./report.pdf
docs/../report.pdf
REPORT.pdf     // bentrok pada case-insensitive filesystem
```

Policy yang aman:

```text
Setelah normalize ke logical canonical name, tidak boleh ada duplicate.
```

Contoh tracking:

```java
Set<String> seen = new HashSet<>();

String logical = normalizeZipLogicalName(entry.getName());
String key = logical.toLowerCase(Locale.ROOT); // jika target FS case-insensitive atau ingin portable strict

if (!seen.add(key)) {
    throw new SecurityException("duplicate entry after normalization: " + entry.getName());
}
```

Function:

```java
static String normalizeZipLogicalName(String name) {
    if (name == null || name.isBlank()) {
        throw new SecurityException("blank entry name");
    }

    String n = name.replace('\\', '/');

    if (n.startsWith("/") || n.contains("\0")) {
        throw new SecurityException("unsafe entry name: " + name);
    }

    Deque<String> parts = new ArrayDeque<>();
    for (String part : n.split("/")) {
        if (part.isEmpty() || part.equals(".")) {
            continue;
        }
        if (part.equals("..")) {
            throw new SecurityException("parent traversal: " + name);
        }
        parts.addLast(part);
    }

    if (parts.isEmpty()) {
        throw new SecurityException("empty normalized entry name: " + name);
    }

    return String.join("/", parts);
}
```

---

## 17. ZIP FileSystem and Security

Java ZIP filesystem provider in modern JDKs has some guardrails, such as not supporting opening existing ZIP files with entries containing `.` or `..` name elements in documented contexts. But this does not eliminate the need for your own validation.

Why?

- aplikasi mungkin memakai `ZipInputStream`, bukan zipfs;
- archive format lain tidak punya guardrail yang sama;
- absolute path, drive-letter, duplicate, encoding, depth, count, size tetap perlu policy;
- business constraint tetap spesifik aplikasi;
- extraction ke filesystem fisik tetap perlu containment;
- archive bomb bukan sekadar path traversal.

Rule:

```text
Provider guardrails are not application security policy.
```

---

## 18. Membuat Archive dengan ZIP FileSystem

Contoh membuat export bundle:

```java
public static void createBundle(Path zipPath) throws IOException {
    Map<String, String> env = new HashMap<>();
    env.put("create", "true");

    URI uri = URI.create("jar:" + zipPath.toUri());

    try (FileSystem zipfs = FileSystems.newFileSystem(uri, env)) {
        Path manifest = zipfs.getPath("/manifest.json");
        Files.write(manifest,
                Collections.singletonList("{\"format\":\"case-bundle\",\"version\":1}"),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW);

        Path docs = zipfs.getPath("/documents");
        Files.createDirectories(docs);

        Path doc = docs.resolve("readme.txt");
        Files.write(doc,
                Collections.singletonList("hello"),
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW);
    }
}
```

Production version harus membuat ke temp:

```java
Path finalZip = Paths.get("/exports/case-123.zip");
Path tempZip = finalZip.resolveSibling(finalZip.getFileName() + ".tmp-" + UUID.randomUUID());

try {
    createBundle(tempZip);
    Files.move(tempZip, finalZip,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
} catch (IOException | RuntimeException e) {
    Files.deleteIfExists(tempZip);
    throw e;
}
```

Kenapa?

- ZIP central directory biasanya selesai saat close;
- crash sebelum close bisa menghasilkan ZIP invalid/partial;
- consumer tidak boleh melihat partial archive;
- atomic move memisahkan proses build dan publish.

---

## 19. Updating Existing ZIP

Dengan ZIP FileSystem:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, (ClassLoader) null)) {
    Path target = zipfs.getPath("/manifest.json");
    Files.write(target,
            "{\"version\":2}".getBytes(StandardCharsets.UTF_8),
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE);
}
```

Tetapi jangan menganggap ini sama seperti overwrite file biasa.

ZIP adalah container dengan central directory. Update entry dapat memerlukan rewriting internal structure. Provider bisa mengelola detailnya, tetapi dari sisi desain:

```text
Existing ZIP update is not a transactional multi-entry database update.
```

Untuk production, lebih aman:

```text
read old zip
  -> write new zip temp
  -> validate new zip
  -> atomic move replace old zip
```

Khusus untuk signed JAR:

```text
Mengubah entry apa pun dapat merusak signature atau membuat signature tidak valid.
```

Jangan patch signed JAR sembarangan.

---

## 20. JAR-Like Access

Karena JAR adalah ZIP, kita bisa membuka JAR dengan ZIP FS:

```java
Path jar = Paths.get("app.jar");

try (FileSystem jarfs = FileSystems.newFileSystem(jar, (ClassLoader) null)) {
    Path manifest = jarfs.getPath("/META-INF/MANIFEST.MF");
    List<String> lines = Files.readAllLines(manifest, StandardCharsets.UTF_8);
    lines.forEach(System.out::println);
}
```

Contoh scanning class:

```java
try (FileSystem jarfs = FileSystems.newFileSystem(jar, (ClassLoader) null);
     Stream<Path> stream = Files.walk(jarfs.getPath("/"))) {

    stream
        .filter(Files::isRegularFile)
        .filter(p -> p.toString().endsWith(".class"))
        .forEach(System.out::println);
}
```

### 20.1 Jangan Samakan JAR FS dengan ClassLoader

Membaca file dari JAR FS berbeda dengan loading resource/class.

```text
JAR FS:
  inspect archive as filesystem

ClassLoader:
  load class/resource according to classpath/module path rules
```

Untuk runtime resource normal, biasanya gunakan:

```java
try (InputStream in = getClass().getResourceAsStream("/template/report.html")) {
    // read resource
}
```

Untuk tooling/inspection/transformation, ZIP/JAR FS lebih cocok.

---

## 21. Nested Archive Limitation

Contoh:

```text
outer.zip
└── lib/inner.zip
    └── config.json
```

`inner.zip` adalah entry bytes di dalam `outer.zip`, bukan otomatis filesystem nested.

Untuk membuka inner:

1. baca/copy `inner.zip` ke temp file;
2. buka temp file sebagai ZIP filesystem;
3. cleanup temp.

Contoh:

```java
Path tempInner = Files.createTempFile("inner-", ".zip");

try (FileSystem outer = FileSystems.newFileSystem(outerZip, (ClassLoader) null)) {
    Files.copy(outer.getPath("/lib/inner.zip"), tempInner, StandardCopyOption.REPLACE_EXISTING);
}

try (FileSystem inner = FileSystems.newFileSystem(tempInner, (ClassLoader) null)) {
    Path config = inner.getPath("/config.json");
    // read config
} finally {
    Files.deleteIfExists(tempInner);
}
```

Design warning:

```text
Nested archive multiplies resource and security risk.
```

Jika menerima nested archive dari user, limit harus mencakup nested depth dan cumulative expansion.

---

## 22. Metadata dalam ZIP

ZIP entry metadata terbatas dan tidak sama dengan metadata filesystem fisik.

`ZipEntry` dapat membawa:

- name;
- comment;
- compressed size;
- uncompressed size;
- CRC;
- method;
- modified time;
- creation/access time pada API modern;
- extra fields.

Namun:

- owner/group tidak portable;
- POSIX permission tidak selalu portable;
- symlink semantics tidak standard di Java ZIP API biasa;
- timestamp resolution/timezone behavior bisa membingungkan;
- metadata dari archive untrusted tidak boleh dipercaya untuk security decision.

Policy yang baik:

```text
Saat extract, tentukan metadata target sendiri.
Jangan blindly restore permission dari archive untrusted.
```

Misalnya:

```java
Files.setLastModifiedTime(output, FileTime.from(Instant.now()));
```

Atau biarkan default filesystem mengatur metadata.

---

## 23. Encoding Nama Entry

ZIP entry name historically punya encoding issue.

Di Java:

- `ZipInputStream`/`ZipOutputStream` punya constructor dengan `Charset` pada Java modern;
- default handling umumnya UTF-8 pada banyak API modern;
- ZIP FS punya env property `encoding`.

Contoh:

```java
Map<String, String> env = new HashMap<>();
env.put("encoding", "UTF-8");

try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, env)) {
    // names decoded with configured encoding
}
```

Rule:

```text
Untuk archive contract internal, tetapkan UTF-8 secara eksplisit.
Untuk archive external, perlakukan nama entry sebagai untrusted data.
```

---

## 24. Archive as Contract: Manifest First Design

Untuk integrasi enterprise, archive sebaiknya punya manifest.

Contoh:

```text
case-bundle.zip
├── manifest.json
├── files/
│   ├── 001.pdf
│   ├── 002.pdf
│   └── 003.xml
└── checksums.sha256
```

Manifest:

```json
{
  "format": "case-bundle",
  "version": 1,
  "generatedAt": "2026-06-18T10:00:00Z",
  "caseId": "CASE-123",
  "files": [
    {
      "path": "files/001.pdf",
      "mediaType": "application/pdf",
      "sha256": "...",
      "size": 102400
    }
  ]
}
```

Keuntungan:

- isi archive eksplisit;
- validasi bisa dilakukan sebelum process;
- checksum per file tersedia;
- versioning format jelas;
- migration lebih mudah;
- consumer tidak perlu menebak struktur;
- rejection reason bisa spesifik.

Rule:

```text
Archive tanpa manifest cocok untuk ad-hoc transfer.
Archive dengan manifest cocok untuk enterprise contract.
```

---

## 25. Validation Pipeline untuk Archive Import

Pipeline yang baik:

```text
1. receive archive into immutable incoming storage
2. validate archive file size and extension/content type
3. open archive safely
4. scan entries without extracting final
5. enforce entry count/depth/name/size policy
6. reject traversal/absolute/duplicate names
7. extract into staging directory
8. verify manifest and per-file checksums
9. validate content signatures/magic numbers as needed
10. publish staging atomically
11. mark archive READY
12. process idempotently
13. cleanup/quarantine according to result
```

Pseudocode:

```java
ArchiveValidationResult validate(Path zip) {
    // 1. size precheck
    // 2. open ZipInputStream
    // 3. iterate entries
    // 4. normalize logical names
    // 5. enforce limits
    // 6. collect manifest candidate
    // 7. compute metadata
    // 8. return structured result
}
```

Jangan melakukan:

```text
extract dulu semua, baru validasi belakangan
```

Itu terlambat untuk path traversal, disk exhaustion, dan overwrite.

---

## 26. Safe Extraction Full Example

Berikut contoh yang lebih lengkap untuk Java 8 compatible style.

```java
public final class SafeZipExtractor {
    private final long maxTotalBytes;
    private final long maxEntryBytes;
    private final int maxEntries;
    private final int maxDepth;

    public SafeZipExtractor(long maxTotalBytes,
                            long maxEntryBytes,
                            int maxEntries,
                            int maxDepth) {
        this.maxTotalBytes = maxTotalBytes;
        this.maxEntryBytes = maxEntryBytes;
        this.maxEntries = maxEntries;
        this.maxDepth = maxDepth;
    }

    public void extract(Path zipFile, Path destination) throws IOException {
        Path destRoot = destination.toAbsolutePath().normalize();
        Files.createDirectories(destRoot);

        Set<String> seen = new HashSet<String>();
        long totalBytes = 0L;
        int entries = 0;

        try (InputStream fin = Files.newInputStream(zipFile);
             BufferedInputStream bin = new BufferedInputStream(fin);
             ZipInputStream zin = new ZipInputStream(bin, StandardCharsets.UTF_8)) {

            ZipEntry entry;
            byte[] buffer = new byte[8192];

            while ((entry = zin.getNextEntry()) != null) {
                entries++;
                if (entries > maxEntries) {
                    throw new SecurityException("too many entries: " + entries);
                }

                String logicalName = normalizeEntryName(entry.getName());
                enforceDepth(logicalName);

                String portableKey = logicalName.toLowerCase(Locale.ROOT);
                if (!seen.add(portableKey)) {
                    throw new SecurityException("duplicate entry: " + entry.getName());
                }

                Path output = destRoot.resolve(logicalName).normalize();
                if (!output.startsWith(destRoot)) {
                    throw new SecurityException("entry escapes destination: " + entry.getName());
                }

                if (entry.isDirectory()) {
                    Files.createDirectories(output);
                } else {
                    Path parent = output.getParent();
                    if (parent == null) {
                        throw new SecurityException("entry has no parent: " + entry.getName());
                    }
                    Files.createDirectories(parent);

                    long entryBytes = 0L;
                    try (OutputStream out = Files.newOutputStream(output,
                            StandardOpenOption.CREATE_NEW,
                            StandardOpenOption.WRITE)) {

                        int n;
                        while ((n = zin.read(buffer)) != -1) {
                            entryBytes += n;
                            totalBytes += n;

                            if (entryBytes > maxEntryBytes) {
                                throw new SecurityException("entry too large: " + logicalName);
                            }
                            if (totalBytes > maxTotalBytes) {
                                throw new SecurityException("archive expands too large");
                            }

                            out.write(buffer, 0, n);
                        }
                    }
                }

                zin.closeEntry();
            }
        }
    }

    private String normalizeEntryName(String rawName) {
        if (rawName == null || rawName.trim().isEmpty()) {
            throw new SecurityException("blank entry name");
        }
        if (rawName.indexOf('\0') >= 0) {
            throw new SecurityException("NUL in entry name");
        }

        String name = rawName.replace('\\', '/');

        if (name.startsWith("/") || name.startsWith("//")) {
            throw new SecurityException("absolute entry name: " + rawName);
        }
        if (name.matches("^[A-Za-z]:.*")) {
            throw new SecurityException("drive-letter entry name: " + rawName);
        }

        Deque<String> parts = new ArrayDeque<String>();
        String[] split = name.split("/");
        for (String part : split) {
            if (part.isEmpty() || part.equals(".")) {
                continue;
            }
            if (part.equals("..")) {
                throw new SecurityException("parent traversal: " + rawName);
            }
            if (part.length() > 255) {
                throw new SecurityException("path segment too long: " + part);
            }
            parts.addLast(part);
        }

        if (parts.isEmpty()) {
            throw new SecurityException("empty normalized entry name: " + rawName);
        }

        StringBuilder sb = new StringBuilder();
        Iterator<String> it = parts.iterator();
        while (it.hasNext()) {
            if (sb.length() > 0) sb.append('/');
            sb.append(it.next());
        }
        return sb.toString();
    }

    private void enforceDepth(String logicalName) {
        int depth = 1;
        for (int i = 0; i < logicalName.length(); i++) {
            if (logicalName.charAt(i) == '/') depth++;
        }
        if (depth > maxDepth) {
            throw new SecurityException("entry too deep: " + logicalName);
        }
    }
}
```

Important limitations:

- Ini belum menangani symlink extraction dari archive format yang mendukung symlink.
- Ini tidak restore permission.
- Ini memakai `CREATE_NEW` agar duplicate/overwrite fisik tidak terjadi.
- Untuk high-security extraction, destination/staging directory harus private, tidak writable oleh pihak lain.

---

## 27. Archive Bomb: Kenapa `getSize()` Tidak Cukup

`ZipEntry.getSize()` dapat:

- tidak diketahui;
- salah;
- dimanipulasi;
- tidak cukup mewakili nested archive;
- tidak melindungi dari banyak file kecil;
- tidak melindungi dari path explosion.

Zip bomb pattern:

```text
small.zip: 50 KB compressed
uncompressed: 10 GB
```

Atau:

```text
100 nested ZIPs, masing-masing expand 100x
```

Atau:

```text
1 juta empty files
```

Maka guardrail harus runtime-based:

```text
count actual bytes while decompressing
count actual entries
count actual directories
count actual depth
count total files
count nested extraction depth if supported
```

---

## 28. Archive Extraction dan Symlink

ZIP format umum tidak sejelas tar dalam membawa symlink, tetapi beberapa tool menyimpan symlink metadata melalui external attributes.

Java standard `ZipInputStream` tidak otomatis membuat symlink saat `Files.copy(zin, output)`; ia menulis bytes sebagai file biasa. Tetapi risiko tetap ada di workflow lain:

- archive format lain seperti tar;
- library third-party yang restore symlink;
- extraction ke directory yang sudah berisi symlink;
- attacker bisa mengganti path di staging jika staging writable bersama;
- follow-up process mengikuti symlink yang sudah ada.

Rule production:

```text
Extract into newly created private staging directory.
Do not extract into shared writable directory.
Do not follow symlinks during post-extraction traversal unless explicitly intended.
```

Setelah extraction:

```java
Files.walkFileTree(staging, EnumSet.noneOf(FileVisitOption.class), Integer.MAX_VALUE,
    new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
            if (Files.isSymbolicLink(file)) {
                throw new SecurityException("symlink not allowed: " + file);
            }
            return FileVisitResult.CONTINUE;
        }
    });
```

---

## 29. ZIP FileSystem sebagai Abstraction Boundary

Karena ZIP FS menghasilkan `Path`, mudah tergoda menulis generic function:

```java
void process(Path root) throws IOException {
    try (Stream<Path> s = Files.walk(root)) {
        ...
    }
}
```

Ini bagus, tapi harus sadar provider capability.

Contoh asumsi yang mungkin salah:

```java
Files.getFileStore(path).getUsableSpace();
Files.setPosixFilePermissions(path, perms);
path.toFile();
Files.move(path, target, ATOMIC_MOVE);
```

`Path.toFile()` hanya valid untuk default provider. Path dari ZIP FS biasanya tidak dapat dikonversi ke `File`.

Salah:

```java
File f = zipfs.getPath("/manifest.json").toFile();
```

Benar:

```java
Path p = zipfs.getPath("/manifest.json");
try (InputStream in = Files.newInputStream(p)) {
    // read
}
```

Rule:

```text
Jika ingin mendukung virtual filesystem, jangan pakai java.io.File.
Tetap di Path/Files/InputStream/OutputStream abstraction.
```

---

## 30. Error Handling Saat Membuka ZIP

Failure umum:

| Failure | Penyebab |
|---|---|
| `NoSuchFileException` | ZIP tidak ada |
| `FileSystemAlreadyExistsException` | URI ZIP FS sudah dibuka dalam JVM |
| `ProviderNotFoundException` | provider `jar`/`jdk.zipfs` tidak tersedia |
| `ZipException` | file bukan ZIP valid/corrupt |
| `AccessDeniedException` | permission file fisik |
| `FileSystemNotFoundException` | mencoba get filesystem yang belum dibuka |
| `ClosedFileSystemException` | Path digunakan setelah FS ditutup |

Pola robust:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, (ClassLoader) null)) {
    // work
} catch (ProviderNotFoundException e) {
    throw new IllegalStateException("ZIP filesystem provider not available. Is jdk.zipfs included?", e);
} catch (ZipException e) {
    throw new IllegalArgumentException("Invalid ZIP archive: " + zipPath, e);
}
```

Catatan: exception tepat bisa bervariasi tergantung API yang dipakai.

---

## 31. `FileSystemAlreadyExistsException` dengan URI

Jika memakai URI `jar:file:///...`, provider bisa menganggap satu ZIP URI sebagai satu filesystem instance aktif.

Salah satu pattern:

```java
URI uri = URI.create("jar:" + zip.toUri());
FileSystem fs = FileSystems.newFileSystem(uri, env);
FileSystem fs2 = FileSystems.newFileSystem(uri, env); // bisa gagal jika fs pertama belum ditutup
```

Pola utility:

```java
static FileSystem openZipFileSystem(URI uri, Map<String, ?> env) throws IOException {
    try {
        return FileSystems.newFileSystem(uri, env);
    } catch (FileSystemAlreadyExistsException e) {
        return FileSystems.getFileSystem(uri);
    }
}
```

Namun hati-hati:

- jika kita return existing FS, kita bukan pemilik lifecycle-nya;
- jangan close filesystem yang dipakai pihak lain;
- untuk aplikasi sederhana, lebih baik open/close terlokalisasi dan hindari sharing URI FS global.

---

## 32. Jangan Menjadikan ZIP sebagai Database

ZIP cocok untuk:

- bundle immutable;
- export artifact;
- package transfer;
- deployment artefact;
- inspection;
- archival small/medium.

ZIP buruk untuk:

- high-frequency random update;
- concurrent writers;
- transactional multi-record store;
- append log dengan recovery kuat;
- shared mutable state antar node;
- long-lived operational database.

Jika requirement berbunyi:

```text
banyak user update file di dalam archive yang sama secara concurrent
```

Maka biasanya jawabannya bukan ZIP. Gunakan:

- database;
- object storage per object;
- content-addressable storage;
- directory tree + manifest;
- tar/zip generated on demand;
- message/event pipeline.

---

## 33. Archive Export Pattern untuk Backend

Workflow export yang baik:

```text
REQUESTED
  -> COLLECTING_DATA
  -> WRITING_TEMP_ZIP
  -> VALIDATING_ZIP
  -> PUBLISHING
  -> READY
  -> DOWNLOADED/EXPIRED
```

Implementation sketch:

```java
Path exportDir = Paths.get("/var/app/exports");
Path finalZip = exportDir.resolve("case-123.zip");
Path tempZip = exportDir.resolve("case-123.zip.tmp-" + UUID.randomUUID());

try {
    writeZip(tempZip, data);
    validateZipCanOpen(tempZip);
    Files.move(tempZip, finalZip,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
} catch (Exception e) {
    Files.deleteIfExists(tempZip);
    throw e;
}
```

Validation:

```java
static void validateZipCanOpen(Path zip) throws IOException {
    try (ZipFile zf = new ZipFile(zip.toFile())) {
        Enumeration<? extends ZipEntry> entries = zf.entries();
        while (entries.hasMoreElements()) {
            ZipEntry e = entries.nextElement();
            if (e.getName().equals("manifest.json")) {
                return;
            }
        }
        throw new IOException("manifest.json missing");
    }
}
```

---

## 34. Archive Import Pattern untuk Backend

Workflow import:

```text
UPLOADED
  -> STORED_IMMUTABLY
  -> SCANNED
  -> VALIDATED
  -> EXTRACTED_TO_STAGING
  -> CHECKSUM_VERIFIED
  -> PUBLISHED
  -> PROCESSED
```

Important invariants:

```text
Uploaded archive is immutable after receive.
Extraction never writes directly to final business directory.
Every extracted path is contained under private staging root.
Every byte count is bounded.
Every entry name is normalized and validated.
Every duplicate is rejected.
Manifest is verified before processing.
Partial staging is cleaned/quarantined.
Final publish is atomic when possible.
```

---

## 35. Archive Download Pattern

For HTTP download:

- avoid loading whole ZIP into memory;
- stream from file if already generated;
- generate to temp file for large exports;
- set content length if available;
- set safe filename;
- expire old archives;
- do not generate archive repeatedly for same request if expensive.

For Spring-like backend, conceptually:

```text
controller
  -> authorize request
  -> locate generated zip
  -> return streaming response
  -> audit download
```

Do not:

```text
ByteArrayOutputStream entire 4GB ZIP into heap
```

Unless file is known small and bounded.

---

## 36. Testing Archive Code

Test cases penting:

### 36.1 Valid Archive

```text
manifest.json
files/a.txt
files/b.txt
```

Expected:

- extraction success;
- manifest found;
- hash verified.

### 36.2 Path Traversal

```text
../../evil.txt
files/../../../evil.txt
```

Expected: rejected.

### 36.3 Absolute Path

```text
/etc/passwd
C:\Windows\win.ini
```

Expected: rejected.

### 36.4 Duplicate Logical Names

```text
report.pdf
./report.pdf
docs/../report.pdf
```

Expected: rejected.

### 36.5 Too Many Entries

Expected: rejected once `maxEntries` exceeded.

### 36.6 Too Large After Decompression

Expected: rejected during read, before disk exhaustion.

### 36.7 Corrupt ZIP

Expected: classified as invalid archive, not server error mystery.

### 36.8 Missing Manifest

Expected: rejected with clear business reason.

### 36.9 Closed FileSystem Misuse

Test utility does not leak `Path` after closing zipfs.

### 36.10 Java 8 Compatibility

Ensure no accidental use of:

```java
Path.of(...)
Files.readString(...)
InputStream.readAllBytes()
Map.of(...)
```

if target source compatibility is Java 8.

---

## 37. Performance Considerations

### 37.1 Compression Cost

ZIP compression consumes CPU.

Trade-off:

| Compression Level | CPU | Output Size |
|---|---:|---:|
| low/no compression | low | larger |
| high compression | high | smaller |

For already-compressed files like PDF/JPEG/PNG, high compression often gives little benefit.

### 37.2 Many Small Files

Archive with many tiny files can be expensive due to:

- metadata overhead;
- per-entry processing;
- central directory growth;
- extraction syscall overhead;
- filesystem directory pressure after extraction.

### 37.3 Streaming vs Temp File

Streaming ZIP directly to HTTP response:

- good for small/medium one-off export;
- no final artifact;
- failure halfway means client gets broken response;
- hard to retry/resume;
- cannot easily pre-compute content length.

Generate ZIP temp file first:

- better for large/important exports;
- can validate before publish;
- retryable download;
- content length known;
- consumes disk.

### 37.4 ZIP FileSystem Update

Frequent updates inside ZIP can be expensive. Prefer regenerate archive if update is coarse-grained.

---

## 38. Observability

Archive workflow metrics:

```text
archive.import.count
archive.import.rejected.count
archive.import.duration
archive.extract.duration
archive.entry.count
archive.compressed.bytes
archive.uncompressed.bytes
archive.expansion.ratio
archive.max.depth
archive.validation.failure.reason
archive.export.duration
archive.export.bytes
archive.export.failure.reason
archive.temp.cleanup.count
```

Structured log fields:

```json
{
  "event": "archive_import_rejected",
  "archiveId": "20260618-abc",
  "reason": "PATH_TRAVERSAL",
  "entry": "../../evil.txt",
  "entryCount": 17,
  "compressedBytes": 20480,
  "correlationId": "..."
}
```

Never log sensitive file contents.

Be careful logging raw entry names if they may contain control characters. Sanitize before log display.

---

## 39. Common Mistakes

### Mistake 1: Extracting directly into final directory

Bad:

```text
upload.zip -> /var/app/business-data/
```

Better:

```text
upload.zip -> private staging -> validate -> atomic publish
```

### Mistake 2: Trusting entry name

Bad:

```java
target.resolve(entry.getName())
```

Better:

```java
normalize, reject absolute, reject .., containment check
```

### Mistake 3: Loading all decompressed bytes into memory

Bad:

```java
byte[] all = zis.readAllBytes();
```

for untrusted/large entry.

Better:

```java
copy bounded chunks and enforce byte limits
```

### Mistake 4: Believing ZIP FS is full OS filesystem

Bad:

```java
zipPath.toFile()
set POSIX permission blindly
atomic move inside archive as if physical disk
```

Better:

```java
program to provider capability
```

### Mistake 5: Modifying signed JAR

Bad:

```text
open app.jar, replace class/resource, redeploy
```

Better:

```text
rebuild artifact through build pipeline and signing process
```

### Mistake 6: Forgetting to close ZIP FileSystem

Bad:

```java
FileSystem fs = FileSystems.newFileSystem(zipPath, null);
// no close
```

Better:

```java
try (FileSystem fs = FileSystems.newFileSystem(zipPath, null)) {
    ...
}
```

### Mistake 7: Building ZIP entry names with OS separator

Bad:

```java
"dir" + File.separator + "file.txt"
```

Better:

```java
"dir/file.txt"
```

---

## 40. Decision Matrix

| Use Case | Recommended API |
|---|---|
| Stream uploaded ZIP and validate/extract | `ZipInputStream` with strict policy |
| Read one known entry from disk ZIP | `ZipFile` or ZIP FS |
| Inspect tree-like content in JAR/ZIP | ZIP FileSystem |
| Create export ZIP sequentially | `ZipOutputStream` |
| Create archive with NIO copy convenience | ZIP FileSystem |
| Update existing ZIP once/simple | ZIP FileSystem, but validate and backup |
| Production-safe replace archive | create temp ZIP + validate + atomic move |
| High-frequency mutable archive | do not use ZIP as store |
| Untrusted archive extraction | streaming API + strict limits + staging |
| Classpath resource loading | `ClassLoader`/`getResourceAsStream`, not ZIP FS |

---

## 41. Mental Model Summary

Archive engineering has three layers:

```text
1. Physical layer
   A ZIP/JAR is a normal file in host filesystem.

2. Archive layer
   The file contains entries, central directory, compression, metadata.

3. Virtual filesystem layer
   Java can expose archive entries as Path via jdk.zipfs.
```

The hard parts are not syntax. The hard parts are:

```text
entry name trust
extraction boundary
resource limits
partial failure
provider lifecycle
metadata portability
update atomicity
archive-as-contract design
```

A strong engineer treats archive as a hostile mini-filesystem until validated.

---

## 42. Production Checklist

### For Archive Import

- [ ] Store original upload immutably.
- [ ] Enforce compressed upload size limit.
- [ ] Open archive safely.
- [ ] Reject blank names.
- [ ] Reject absolute paths.
- [ ] Reject drive-letter paths.
- [ ] Reject `..` traversal.
- [ ] Normalize logical names.
- [ ] Reject duplicate logical names.
- [ ] Enforce max entries.
- [ ] Enforce max depth.
- [ ] Enforce max per-entry uncompressed size.
- [ ] Enforce max total uncompressed size.
- [ ] Extract only to private staging directory.
- [ ] Use `CREATE_NEW` for extracted files.
- [ ] Validate manifest.
- [ ] Verify checksums if contract requires.
- [ ] Validate content type/magic number if relevant.
- [ ] Publish only after validation.
- [ ] Cleanup/quarantine failures.
- [ ] Emit metrics and structured logs.

### For Archive Export

- [ ] Build entry names from safe relative paths.
- [ ] Use `/` separator.
- [ ] Do not include absolute host paths.
- [ ] Include manifest for enterprise contract.
- [ ] Include checksums when integrity matters.
- [ ] Generate to temp file.
- [ ] Validate generated archive can be opened.
- [ ] Atomic move to final location.
- [ ] Apply retention/expiry cleanup.
- [ ] Avoid unbounded in-memory ZIP.

### For ZIP FileSystem

- [ ] Ensure `jdk.zipfs` exists in runtime image if modular/custom runtime.
- [ ] Always close `FileSystem`.
- [ ] Do not leak `Path` after closing FS.
- [ ] Avoid `Path.toFile()` on ZIP paths.
- [ ] Do not assume POSIX attributes.
- [ ] Do not use as high-frequency mutable database.

---

## 43. Latihan

### Latihan 1 — ZIP Inspector

Buat utility yang menerima path ZIP dan menampilkan:

- entry count;
- total compressed size jika tersedia;
- total uncompressed size jika tersedia;
- maximum depth;
- daftar entry yang unsafe;
- apakah manifest ada.

### Latihan 2 — Safe Extractor

Implementasikan extractor dengan policy:

```text
maxEntries = 1000
maxDepth = 10
maxEntryBytes = 50 MB
maxTotalBytes = 500 MB
reject duplicate logical names
reject traversal
extract to staging only
```

### Latihan 3 — Export Bundle

Buat export bundle:

```text
manifest.json
files/<sha256-prefix>-<safe-name>
checksums.sha256
```

Generate ke temp ZIP lalu atomic move.

### Latihan 4 — ZIP FS Reader

Buka JAR sebagai filesystem dan list:

- `META-INF/MANIFEST.MF`
- semua `.class`
- semua service provider file di `META-INF/services/`

### Latihan 5 — Failure Matrix

Buat tabel failure:

| Failure | State | Recovery |
|---|---|---|
| corrupt ZIP | before extraction | reject |
| path traversal | scan | reject/quarantine |
| disk full mid extraction | staging partial | cleanup staging |
| crash before publish | staging remains | cleanup/retry |
| crash after publish | ready exists | idempotent process |

---

## 44. Penutup

ZIP/JAR adalah format sederhana di permukaan, tetapi ketika masuk production backend, ia menjadi mini-filesystem yang membawa semua masalah file engineering: path, metadata, capacity, security, failure, atomicity, dan lifecycle.

Kunci mental model:

```text
Archive is not trusted data.
Archive entry name is user input.
Extraction is filesystem write.
ZIP FileSystem is provider abstraction, not magic.
Production archive workflow needs staging, validation, limits, and atomic publish.
```

Bagian berikutnya akan masuk ke **Custom FileSystemProvider and Pluggable Filesystem Mental Model**, yaitu bagaimana NIO.2 memungkinkan filesystem tidak selalu berarti local disk, dan bagaimana menulis kode yang benar terhadap provider abstraction.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 23](./learn-java-io-file-filesystem-storage-engineering-part-23-file-naming-extension-mime-charset-content-detection.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 25](./learn-java-io-file-filesystem-storage-engineering-part-25-custom-filesystemprovider-pluggable-filesystem.md)

</div>