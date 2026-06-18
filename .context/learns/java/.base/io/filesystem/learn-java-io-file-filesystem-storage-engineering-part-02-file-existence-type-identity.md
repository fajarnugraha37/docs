# learn-java-io-file-filesystem-storage-engineering-part-02-file-existence-type-identity

# Part 02 — File Existence, Type, and Identity: `exists` Is Not a Lock

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Level: Advanced / production engineering  
> Target Java: 8 sampai 25  
> Fokus: memahami keberadaan file, tipe file, identitas file, race condition, symbolic link, dan desain workflow yang benar ketika filesystem bisa berubah kapan saja.

---

## 0. Tujuan Part Ini

Di Part 01, kita membahas `Path` sebagai representasi sintaktik lokasi. Sekarang kita masuk ke pertanyaan yang terlihat sederhana tetapi sering menjadi sumber bug serius:

> “Apakah file ini ada?”

Pada level beginner, jawabannya biasanya:

```java
if (Files.exists(path)) {
    // use file
}
```

Pada level production, cara pikirnya berubah:

> `Files.exists(path)` hanya observasi sesaat terhadap filesystem. Ia bukan reservasi, bukan lock, bukan guarantee bahwa file masih ada saat digunakan, bukan guarantee bahwa path masih menunjuk ke objek yang sama, dan bukan guarantee bahwa objek tersebut aman digunakan.

Part ini akan membangun mental model bahwa filesystem adalah **shared mutable namespace**. Banyak aktor bisa mengubahnya:

- thread lain di JVM yang sama
- proses lain di mesin yang sama
- container lain yang mount volume yang sama
- node lain pada network filesystem
- user/operator
- antivirus/indexer/backup agent
- log rotation daemon
- cleanup job
- attacker melalui path traversal atau symlink manipulation
- filesystem provider sendiri

Maka pertanyaan “file exists?” sebenarnya harus dipecah menjadi beberapa pertanyaan yang lebih presisi:

1. Apakah path ini saat ini bisa di-resolve?
2. Kalau bisa, resolve-nya mengikuti symbolic link atau tidak?
3. Objek yang ditemukan itu regular file, directory, symlink, atau special file?
4. Apakah kita punya permission untuk mengetahuinya?
5. Apakah hasilnya pasti, atau statusnya unknown?
6. Apakah objek itu masih sama ketika nanti dibuka?
7. Apakah yang kita butuhkan adalah observasi, validasi, atau atomic operation?

---

## 1. Mental Model Utama: Path Bukan File

`Path` adalah objek yang merepresentasikan urutan nama di dalam suatu filesystem. `Path` bisa menunjuk ke file yang ada, file yang belum ada, directory yang ada, symlink, device, socket, pipe, atau tidak menunjuk ke apa pun.

Contoh:

```java
Path p = Paths.get("/var/app/input/order-001.json");
```

Objek `p` tidak berarti file `/var/app/input/order-001.json` benar-benar ada. Itu hanya representasi lokasi.

Ketika kita memanggil:

```java
Files.exists(p)
```

barulah Java meminta provider filesystem untuk mengecek apakah path tersebut dapat di-resolve menjadi suatu entry/objek filesystem.

Mental model:

```text
Path object
  ↓
Files.exists(path)
  ↓
FileSystemProvider
  ↓
Operating system / filesystem
  ↓
Directory lookup + permission + link resolution + metadata access
  ↓
boolean result, or exception internally swallowed into false/unknown behavior depending method
```

Hal penting:

> File existence adalah property runtime, bukan property dari `Path` object.

---

## 2. `Files.exists` dan `Files.notExists`: Tiga State, Bukan Dua

Banyak engineer mengira:

```java
!Files.exists(path) == Files.notExists(path)
```

Itu salah.

Dalam filesystem, hasil pengecekan keberadaan file secara konseptual punya tiga state:

| State | Makna |
|---|---|
| exists | File dapat dikonfirmasi ada |
| not exists | File dapat dikonfirmasi tidak ada |
| unknown | Java tidak bisa memastikan, misalnya karena permission error, I/O error, broken provider, network filesystem issue, atau error lain |

Karena itu:

```java
boolean a = Files.exists(path);
boolean b = Files.notExists(path);
```

Kemungkinan hasilnya:

| `Files.exists(path)` | `Files.notExists(path)` | Makna |
|---:|---:|---|
| true | false | Dikonfirmasi ada |
| false | true | Dikonfirmasi tidak ada |
| false | false | Unknown |

Tidak ada state `true/true` yang masuk akal.

Contoh handling yang lebih jujur:

```java
Path path = Paths.get("/secure/data/report.pdf");

if (Files.exists(path)) {
    System.out.println("Confirmed exists");
} else if (Files.notExists(path)) {
    System.out.println("Confirmed does not exist");
} else {
    System.out.println("Unknown: cannot determine existence safely");
}
```

### Kenapa Unknown Penting?

Misalnya service berjalan sebagai user `app`, lalu mengecek:

```text
/secure/customer-data/export.csv
```

Jika parent directory tidak bisa diakses, `Files.exists(path)` bisa mengembalikan `false`, bukan karena file pasti tidak ada, tetapi karena Java tidak bisa memastikan.

Jika kode kita menafsirkan `false` sebagai “tidak ada”, maka bug-nya bisa berbahaya:

```java
if (!Files.exists(path)) {
    createNewExport(path);
}
```

Padahal masalah sebenarnya permission, bukan file absence.

Prinsip:

> `false` dari `exists` bukan selalu “not exists”. Ia bisa berarti “not confirmed exists”.

---

## 3. `exists` Adalah Snapshot, Bukan Guarantee

Filesystem bisa berubah setelah pengecekan.

Kode ini kelihatan aman:

```java
if (Files.exists(path)) {
    byte[] bytes = Files.readAllBytes(path);
}
```

Tetapi ada race window:

```text
T1: Files.exists(path) returns true
T2: other process deletes path
T1: Files.readAllBytes(path) throws NoSuchFileException
```

Atau:

```text
T1: Files.exists(path) returns true
T2: attacker replaces regular file with symlink
T1: opens a different target
```

Atau:

```text
T1: Files.exists(path) returns true
T2: log rotation renames file and creates a new one
T1: reads a different file than expected
```

Inilah konsep **TOCTOU**:

> Time Of Check To Time Of Use.

Waktu pengecekan dan waktu penggunaan tidak atomic. Objek yang dicek bisa hilang, berubah tipe, berubah target, atau diganti objek lain sebelum digunakan.

### Rule Pertama

> Jangan gunakan `exists` sebagai syarat keselamatan sebelum melakukan operasi yang seharusnya atomic.

Lebih baik lakukan operasi final dan tangani exception.

Buruk:

```java
if (Files.exists(path)) {
    return Files.readString(path);
}
return "";
```

Lebih baik:

```java
try {
    return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
} catch (NoSuchFileException e) {
    return "";
}
```

Untuk Java 11+:

```java
try {
    return Files.readString(path);
} catch (NoSuchFileException e) {
    return "";
}
```

### Kenapa Exception-Driven Lebih Benar?

Karena operasi yang benar-benar menentukan adalah operasi penggunaan, bukan observasi sebelum penggunaan.

```text
Wrong mental model:
check → assume → use

Better mental model:
attempt intended operation → handle exact failure
```

---

## 4. Kapan `Files.exists` Boleh Digunakan?

`exists` tetap berguna, tetapi bukan untuk menjamin keselamatan operasi berikutnya.

Gunakan `exists` untuk:

1. Observasi UI/debug/logging.
2. Preflight yang tidak menentukan correctness.
3. Menampilkan pesan validasi manusia.
4. Health check ringan.
5. Branching non-critical.
6. Diagnostik sebelum melakukan operasi final yang tetap harus menangani exception.

Contoh acceptable:

```java
if (!Files.exists(configPath)) {
    logger.warn("Config file not found yet: {}", configPath);
}

// tetap lakukan load dengan exception handling yang benar
Config config = loadConfig(configPath);
```

Contoh tidak acceptable:

```java
if (!Files.exists(target)) {
    Files.write(target, data);
}
```

Kenapa tidak acceptable? Karena dua proses bisa sama-sama melihat “tidak ada”, lalu sama-sama menulis.

Lebih benar:

```java
Files.write(
    target,
    data,
    StandardOpenOption.CREATE_NEW,
    StandardOpenOption.WRITE
);
```

`CREATE_NEW` membuat create menjadi atomic terhadap operasi filesystem lain yang memengaruhi directory tersebut.

---

## 5. `CREATE_NEW`: Jawaban untuk “Create If Absent”

Masalah umum:

> “Saya mau membuat file hanya kalau belum ada.”

Anti-pattern:

```java
if (!Files.exists(path)) {
    Files.write(path, data);
}
```

Race:

```text
Process A: exists false
Process B: exists false
Process A: write file
Process B: overwrite/truncate/modify file
```

Solusi:

```java
try {
    Files.write(
        path,
        data,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE
    );
} catch (FileAlreadyExistsException e) {
    // someone else created it first
}
```

Mental model:

```text
CREATE_NEW = check absence + create in one filesystem operation
```

Ini adalah contoh prinsip besar:

> Kalau filesystem menyediakan operasi atomic, gunakan operasi atomic. Jangan susun atomicity dari `exists` + operation.

---

## 6. `isRegularFile`, `isDirectory`, `isSymbolicLink`: Type Check Juga Snapshot

Java menyediakan beberapa helper:

```java
Files.isRegularFile(path);
Files.isDirectory(path);
Files.isSymbolicLink(path);
```

Tetapi type check juga snapshot.

Kode ini belum aman:

```java
if (Files.isRegularFile(path)) {
    processFile(path);
}
```

Karena setelah `isRegularFile` return true, path bisa berubah menjadi directory, symlink, atau file lain.

### Type Check Bermanfaat untuk Apa?

Bermanfaat untuk traversal, validasi awal, filtering, UI, diagnostics, dan precondition yang tetap harus diverifikasi saat operasi final.

Contoh:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(inputDir)) {
    for (Path candidate : stream) {
        if (!Files.isRegularFile(candidate)) {
            continue;
        }

        try {
            processRegularFile(candidate);
        } catch (NoSuchFileException e) {
            // file disappeared after listing/type check
            logger.debug("Skipped vanished file: {}", candidate);
        } catch (FileSystemException e) {
            logger.warn("Could not process candidate: {}", candidate, e);
        }
    }
}
```

---

## 7. File Type Bukan Hanya Regular File dan Directory

Di banyak aplikasi Java enterprise, engineer hanya peduli dua tipe:

- regular file
- directory

Tetapi filesystem punya lebih banyak entitas:

| Type | Contoh | Implikasi |
|---|---|---|
| Regular file | `.txt`, `.json`, `.pdf` | Byte sequence normal |
| Directory | folder | Namespace berisi entry lain |
| Symbolic link | link ke target lain | Bisa keluar dari sandbox |
| Hard link | entry lain ke file yang sama | Identity tidak sama dengan path string |
| Device file | `/dev/null`, `/dev/sda` | Dangerous kalau diperlakukan file biasa |
| FIFO/pipe | named pipe | Read/write bisa block |
| Socket file | Unix domain socket | Bukan file data biasa |
| Reparse point/junction | Windows | Mirip link dengan semantics berbeda |

Karena itu, untuk upload/import/processing file, jangan hanya mengecek “exists”. Biasanya invariant yang benar adalah:

> Input harus regular file, bukan directory, bukan symlink ke lokasi lain, bukan special file, dan ukurannya dalam limit.

Contoh:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

if (!attrs.isRegularFile()) {
    throw new IllegalArgumentException("Input must be a regular file: " + path);
}
```

Kenapa `NOFOLLOW_LINKS`?

Karena kita ingin mengetahui objek pada path itu sendiri, bukan target symlink-nya.

---

## 8. Symbolic Link: Target vs Link Itu Sendiri

Default banyak operasi Java mengikuti symbolic link.

Contoh:

```text
/data/app/input/a.txt -> /etc/passwd
```

Jika kita memanggil:

```java
Files.isRegularFile(Paths.get("/data/app/input/a.txt"))
```

Tanpa `NOFOLLOW_LINKS`, hasil bisa true karena target `/etc/passwd` adalah regular file.

Jika kita memanggil:

```java
Files.isRegularFile(
    Paths.get("/data/app/input/a.txt"),
    LinkOption.NOFOLLOW_LINKS
)
```

Maka yang dicek adalah symlink entry itu sendiri. Symlink bukan regular file, sehingga hasilnya false.

### Mental Model

```text
Without NOFOLLOW_LINKS:
path → follow symlink → target attributes

With NOFOLLOW_LINKS:
path → inspect link entry itself
```

### Contoh Validasi Aman untuk Upload Directory

Misalnya aplikasi hanya boleh memproses file di directory:

```text
/app/data/uploads
```

Jika attacker bisa membuat symlink:

```text
/app/data/uploads/invoice.pdf -> /etc/shadow
```

Maka validasi yang mengikuti link bisa bocor.

Lebih aman:

```java
static void requireRegularNonSymlinkFile(Path path) throws IOException {
    BasicFileAttributes attrs = Files.readAttributes(
        path,
        BasicFileAttributes.class,
        LinkOption.NOFOLLOW_LINKS
    );

    if (!attrs.isRegularFile()) {
        throw new IOException("Not a regular non-symlink file: " + path);
    }
}
```

Namun ini masih belum sepenuhnya menghilangkan race kalau attacker bisa mengganti path setelah validasi. Untuk benar-benar kuat, desain harus mengontrol directory permission, ownership, atomic claim, dan open operation.

---

## 9. `BasicFileAttributes`: Baca Metadata Sekaligus

Daripada memanggil banyak method:

```java
Files.isRegularFile(path);
Files.size(path);
Files.getLastModifiedTime(path);
```

Lebih baik untuk banyak kasus membaca attributes sekali:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

boolean regular = attrs.isRegularFile();
long size = attrs.size();
FileTime modified = attrs.lastModifiedTime();
Object fileKey = attrs.fileKey();
```

Keuntungan:

1. Lebih sedikit round-trip ke filesystem/provider.
2. Metadata lebih konsisten sebagai satu snapshot provider-level.
3. Bisa mendapatkan file key untuk identitas jika provider mendukung.
4. Lebih jelas apakah link diikuti atau tidak.

Catatan:

> `BasicFileAttributes` tetap snapshot. Ia bukan object hidup yang otomatis berubah ketika file berubah.

---

## 10. File Identity: Path String Bukan Identitas File

Dua path berbeda bisa menunjuk ke file yang sama.

Contoh symbolic link:

```text
/data/current/report.csv -> /data/releases/2026-06/report.csv
```

Contoh hard link:

```text
/data/a.log
/data/b.log
```

Keduanya bisa menunjuk inode/file record yang sama.

Contoh relative/absolute:

```text
./input/a.txt
/app/input/a.txt
```

Keduanya bisa menunjuk file yang sama tergantung current working directory.

Java menyediakan:

```java
Files.isSameFile(path1, path2)
```

Contoh:

```java
Path a = Paths.get("/data/app/current-config.yaml");
Path b = Paths.get("/data/app/releases/v42/config.yaml");

if (Files.isSameFile(a, b)) {
    System.out.println("Same underlying file");
}
```

### Apa yang Harus Dipahami dari `isSameFile`?

`isSameFile` bukan string comparison. Ia bisa perlu mengakses filesystem. Ia bisa throw `IOException`. Jika kedua path sama secara `equals`, implementasi dapat menganggap sama tanpa filesystem access, tetapi secara umum kita harus memperlakukannya sebagai operasi filesystem.

Buruk:

```java
if (path1.toString().equals(path2.toString())) {
    // same file? not necessarily meaningful
}
```

Lebih benar:

```java
try {
    if (Files.isSameFile(path1, path2)) {
        // same file identity according to provider
    }
} catch (IOException e) {
    // cannot determine identity
}
```

---

## 11. `fileKey`: Identitas Provider-Level

`BasicFileAttributes.fileKey()` bisa mengembalikan object yang merepresentasikan identitas file secara provider-specific.

Pada Unix-like filesystem, ini bisa berkaitan dengan device dan inode. Pada provider lain, bisa berbeda. Bisa juga `null`.

Contoh:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

Object key = attrs.fileKey();
```

Gunakan `fileKey` dengan hati-hati:

- Tidak portable secara format.
- Bisa null.
- Bisa berubah jika file diganti walaupun path sama.
- Berguna untuk cycle detection dan dedup detection dalam tree traversal.
- Jangan disimpan sebagai contract jangka panjang lintas provider kecuali sudah diuji.

Contoh use case:

```java
Set<Object> visited = new HashSet<>();

BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);
Object key = attrs.fileKey();

if (key != null && !visited.add(key)) {
    throw new IOException("Cycle or duplicate file identity detected: " + path);
}
```

---

## 12. Path Equality vs File Equality

Ada beberapa level equality:

| Equality | Contoh API | Makna |
|---|---|---|
| Object equality | `path1.equals(path2)` | Path object sama menurut provider/path syntax |
| String equality | `path1.toString().equals(...)` | Representasi string sama |
| Normalized syntax equality | `path.normalize().equals(...)` | Sama setelah menghapus `.` dan `..` secara sintaktik |
| Real path equality | `toRealPath` lalu compare | Setelah resolve filesystem dan symlink sesuai opsi |
| File identity equality | `Files.isSameFile` | Menurut provider menunjuk file yang sama |

Contoh:

```java
Path a = Paths.get("/data/app/../app/config.yml");
Path b = Paths.get("/data/app/config.yml");

System.out.println(a.equals(b));                 // likely false
System.out.println(a.normalize().equals(b));     // likely true
```

Tetapi:

```java
Path c = Paths.get("/data/current/config.yml");  // symlink path maybe
Path d = Paths.get("/data/releases/v1/config.yml");
```

`normalize` tidak membuktikan keduanya sama. Perlu filesystem-aware operation:

```java
Files.isSameFile(c, d)
```

---

## 13. Existence dan Permission: Tidak Bisa Dipisahkan

Untuk mengetahui file ada atau tidak, proses sering perlu permission untuk search/traverse parent directory dan membaca metadata.

Contoh Unix-like:

```text
/secure/reports/secret.csv
```

Jika user tidak punya execute/search permission pada `/secure` atau `/secure/reports`, maka Java tidak bisa menentukan keberadaan file. Hasil `exists` bisa false.

Ini penting untuk error handling.

Buruk:

```java
if (!Files.exists(path)) {
    throw new FileNotFoundException(path.toString());
}
```

Lebih baik pada operasi nyata:

```java
try {
    return Files.readAllBytes(path);
} catch (NoSuchFileException e) {
    throw new IllegalStateException("File is missing: " + path, e);
} catch (AccessDeniedException e) {
    throw new IllegalStateException("File exists may be inaccessible or permission denied: " + path, e);
} catch (IOException e) {
    throw new IllegalStateException("Cannot read file: " + path, e);
}
```

Dengan ini, observability lebih jelas:

- missing file
- permission issue
- generic I/O problem

---

## 14. Exception Lebih Kaya daripada Boolean

Boolean API menyembunyikan banyak informasi. Exception API memberi diagnosis lebih baik.

Contoh boolean:

```java
if (!Files.isRegularFile(path)) {
    throw new IllegalArgumentException("Invalid file");
}
```

Masalah: invalid karena apa?

- tidak ada?
- directory?
- symlink?
- permission denied?
- broken filesystem?
- network timeout?

Versi lebih diagnostik:

```java
static BasicFileAttributes requireReadableRegularFile(Path path) throws IOException {
    BasicFileAttributes attrs;
    try {
        attrs = Files.readAttributes(path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    } catch (NoSuchFileException e) {
        throw new NoSuchFileException(path.toString(), null, "Required input file is missing");
    } catch (AccessDeniedException e) {
        throw new AccessDeniedException(path.toString(), null, "Cannot access required input file metadata");
    }

    if (!attrs.isRegularFile()) {
        throw new IOException("Required input must be a regular file, path=" + path);
    }

    if (!Files.isReadable(path)) {
        throw new AccessDeniedException(path.toString(), null, "Required input file is not readable");
    }

    return attrs;
}
```

Catatan: `Files.isReadable` sendiri juga snapshot dan tidak menjamin read berikutnya berhasil, tapi bisa menjadi diagnostik tambahan.

---

## 15. `isReadable`, `isWritable`, `isExecutable`: Capability Check Juga Race

Java menyediakan:

```java
Files.isReadable(path);
Files.isWritable(path);
Files.isExecutable(path);
```

Gunakan untuk preflight/diagnostic, bukan guarantee.

Anti-pattern:

```java
if (Files.isWritable(path)) {
    Files.write(path, data);
}
```

Race:

```text
T1: isWritable true
T2: chmod removes write permission
T1: write fails AccessDeniedException
```

Lebih baik:

```java
try {
    Files.write(path, data, StandardOpenOption.WRITE);
} catch (AccessDeniedException e) {
    // handle actual failure
}
```

Prinsip:

> Capability check memberi sinyal, bukan kontrak.

---

## 16. Broken Symlink: Ada atau Tidak?

Misalnya:

```text
/tmp/link.txt -> /tmp/missing-target.txt
```

Jika link ada tetapi target tidak ada:

```java
Path link = Paths.get("/tmp/link.txt");
```

Tanpa `NOFOLLOW_LINKS`:

```java
Files.exists(link); // false, because target does not exist
```

Dengan `NOFOLLOW_LINKS`:

```java
Files.exists(link, LinkOption.NOFOLLOW_LINKS); // true, because link entry exists
```

Ini contoh penting bahwa “exists” bergantung pada apakah link diikuti atau tidak.

Untuk cleanup broken symlink:

```java
if (Files.isSymbolicLink(link) && !Files.exists(link)) {
    Files.delete(link);
}
```

Namun lebih eksplisit:

```java
if (Files.exists(link, LinkOption.NOFOLLOW_LINKS) && Files.isSymbolicLink(link)) {
    Path target = Files.readSymbolicLink(link);
    Path resolved = link.getParent().resolve(target).normalize();

    if (!Files.exists(resolved)) {
        Files.delete(link);
    }
}
```

---

## 17. Directory Entry Replacement: Path Sama, File Berbeda

Satu path bisa menunjuk file A pada waktu T1 dan file B pada waktu T2.

Contoh:

```text
T1: /app/config.yml -> inode 100
T2: writer writes /app/config.yml.tmp
T3: writer renames tmp to /app/config.yml
T4: /app/config.yml -> inode 200
```

Path string sama:

```text
/app/config.yml
```

Tapi file identity berbeda.

Ini normal pada atomic replacement pattern.

Implikasi:

- Jangan menyimpan asumsi bahwa path stabil berarti object stabil.
- Jika butuh memastikan object sama, gunakan file identity atau open handle semantics.
- Untuk config reload, perubahan identity bisa menjadi sinyal reload.
- Untuk long-running read, file handle yang sudah dibuka bisa tetap membaca object lama di Unix-like systems, walaupun path sudah diganti.

---

## 18. File Handle vs Path Lookup

Perbedaan besar:

```text
Path lookup = mencari entry berdasarkan nama sekarang
Open handle = referensi ke object yang sudah dibuka
```

Contoh:

```java
try (InputStream in = Files.newInputStream(path)) {
    // after this, we read from opened file handle
}
```

Setelah file berhasil dibuka, operasi baca biasanya menggunakan handle itu. Jika path di directory diganti setelah open, behavior tergantung OS/filesystem, tetapi mental modelnya:

- Path lookup sudah selesai saat open.
- Handle bisa tetap menunjuk object lama.
- Di Windows, file yang dibuka bisa mencegah delete/rename tergantung sharing mode.
- Di Unix-like, file bisa di-unlink sementara handle masih valid sampai ditutup.

Ini akan dibahas lebih dalam pada Part 04 dan Part 09, tetapi untuk part ini cukup pahami:

> Pengecekan path dan penggunaan file handle adalah dua level yang berbeda.

---

## 19. Designing with Invariants, Not Hope

Daripada berpikir:

> “Cek dulu ada atau tidak.”

Engineer production berpikir:

> “Invariant apa yang harus benar saat operasi dilakukan, dan operasi atomic apa yang bisa menjaga invariant itu?”

Contoh invariant untuk input file processor:

1. File harus berada di inbox directory.
2. File harus regular file.
3. File tidak boleh symlink.
4. File harus diklaim oleh satu worker saja.
5. File yang sudah diklaim tidak boleh diproses worker lain.
6. File yang gagal harus dipindahkan ke quarantine.
7. Restart service tidak boleh menyebabkan duplicate irreversible side effect.

Implementasi naïf:

```java
if (Files.exists(file) && Files.isRegularFile(file)) {
    process(file);
    Files.delete(file);
}
```

Implementasi lebih benar:

```text
inbox/file.json
  ↓ atomic move claim
processing/file.json.<worker-id>
  ↓ process idempotently
  ↓ atomic move result
processed/file.json or error/file.json
```

Di Java:

```java
Path claimed = processingDir.resolve(file.getFileName().toString() + "." + workerId);

try {
    Files.move(file, claimed, StandardCopyOption.ATOMIC_MOVE);
} catch (NoSuchFileException e) {
    // someone else took or deleted it
    return;
} catch (FileAlreadyExistsException e) {
    // claim target collision; generate better claim name
    return;
} catch (AtomicMoveNotSupportedException e) {
    // decide fallback based on filesystem/workflow correctness
    throw e;
}

processClaimedFile(claimed);
```

Kita tidak mengandalkan `exists` sebagai lock. Kita memakai rename/move sebagai claim operation.

---

## 20. Pattern: Observe, Then Re-Validate at Boundary

Ada workflow yang memang perlu observasi dulu, misalnya scan directory.

Pattern-nya:

```text
observe candidates
  ↓
for each candidate:
  attempt atomic claim/open
  ↓
  validate after claim/open
  ↓
  process
```

Contoh:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(inboxDir)) {
    for (Path candidate : stream) {
        if (!Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)) {
            continue;
        }

        Path claimed = processingDir.resolve(candidate.getFileName().toString() + ".claim");

        try {
            Files.move(candidate, claimed, StandardCopyOption.ATOMIC_MOVE);
        } catch (NoSuchFileException | FileAlreadyExistsException e) {
            continue;
        }

        BasicFileAttributes attrs = Files.readAttributes(
            claimed,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        if (!attrs.isRegularFile()) {
            Files.move(claimed, errorDir.resolve(claimed.getFileName()), StandardCopyOption.ATOMIC_MOVE);
            continue;
        }

        process(claimed);
    }
}
```

Kenapa re-validasi setelah claim?

Karena kandidat bisa berubah antara listing dan claim. Setelah claim, path berada di area yang lebih terkontrol.

---

## 21. Pattern: Do Not Precheck Before Delete

Anti-pattern:

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Race:

```text
T1: exists true
T2: deletes file
T1: delete throws NoSuchFileException
```

Lebih benar:

```java
Files.deleteIfExists(path);
```

Atau jika missing harus dianggap error:

```java
Files.delete(path);
```

Dengan exact exception handling:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException e) {
    logger.info("Already gone: {}", path);
} catch (DirectoryNotEmptyException e) {
    logger.warn("Cannot delete non-empty directory: {}", path);
} catch (AccessDeniedException e) {
    logger.error("Permission denied deleting: {}", path, e);
}
```

---

## 22. Pattern: Do Not Precheck Before Read Unless UX Needs It

Anti-pattern:

```java
if (!Files.exists(path)) {
    return Optional.empty();
}
return Optional.of(Files.readAllBytes(path));
```

Lebih benar:

```java
static Optional<byte[]> readIfPresent(Path path) throws IOException {
    try {
        return Optional.of(Files.readAllBytes(path));
    } catch (NoSuchFileException e) {
        return Optional.empty();
    }
}
```

Jika ingin membedakan directory:

```java
static Optional<byte[]> readRegularFileIfPresent(Path path) throws IOException {
    try {
        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        if (!attrs.isRegularFile()) {
            throw new IOException("Not a regular file: " + path);
        }

        return Optional.of(Files.readAllBytes(path));
    } catch (NoSuchFileException e) {
        return Optional.empty();
    }
}
```

Masih ada race antara attributes dan read. Jika attacker bisa mengganti file pada path, desain harus lebih kuat. Tetapi untuk trusted directory, ini biasanya cukup.

---

## 23. Pattern: Do Not Precheck Before Write Replacement

Anti-pattern:

```java
if (Files.exists(path)) {
    Files.write(path, data, StandardOpenOption.TRUNCATE_EXISTING);
} else {
    Files.write(path, data, StandardOpenOption.CREATE);
}
```

Lebih jelas:

Untuk create or replace:

```java
Files.write(
    path,
    data,
    StandardOpenOption.CREATE,
    StandardOpenOption.TRUNCATE_EXISTING,
    StandardOpenOption.WRITE
);
```

Untuk create only if absent:

```java
Files.write(
    path,
    data,
    StandardOpenOption.CREATE_NEW,
    StandardOpenOption.WRITE
);
```

Untuk must already exist:

```java
Files.write(
    path,
    data,
    StandardOpenOption.WRITE,
    StandardOpenOption.TRUNCATE_EXISTING
);
```

Tetapi untuk production-grade replace yang crash-safe, jangan langsung truncate file existing. Gunakan temp file + atomic move. Itu akan dibahas detail di Part 07.

---

## 24. `exists` dalam Security-Sensitive Code

Security-sensitive code tidak boleh bergantung pada:

```java
if (Files.exists(userPath)) {
    serveFile(userPath);
}
```

Masalah:

1. User bisa memberi path traversal.
2. Path bisa symlink ke luar root.
3. Path bisa diganti setelah check.
4. Case-insensitive filesystem bisa bypass policy.
5. Unicode normalization bisa membuat path terlihat berbeda.
6. File type bisa berubah.

Lebih aman secara konseptual:

```java
Path root = Paths.get("/app/data/public").toRealPath();
Path requested = root.resolve(userInput).normalize();

Path realRequested = requested.toRealPath(LinkOption.NOFOLLOW_LINKS);

if (!realRequested.startsWith(root)) {
    throw new SecurityException("Path escapes root");
}

BasicFileAttributes attrs = Files.readAttributes(
    realRequested,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

if (!attrs.isRegularFile()) {
    throw new IOException("Not a regular file");
}

// then open and stream with exception handling
```

Catatan penting: secure path containment adalah topik besar dan akan dibahas khusus di Part 13. Contoh di atas adalah fondasi, bukan solusi final untuk semua threat model.

---

## 25. Current Working Directory Bisa Membuat `exists` Membingungkan

Relative path bergantung pada current working directory JVM.

```java
Path path = Paths.get("config/app.yml");
System.out.println(Files.exists(path));
```

Hasilnya tergantung JVM dijalankan dari mana:

```text
/home/fajar/project
/opt/app
/app
```

Untuk production, lebih baik resolve dari base directory eksplisit:

```java
Path appHome = Paths.get(System.getProperty("app.home")).toAbsolutePath().normalize();
Path config = appHome.resolve("config/app.yml").normalize();
```

Atau injeksikan base path via config:

```java
public final class FileStoragePaths {
    private final Path baseDir;

    public FileStoragePaths(Path baseDir) {
        this.baseDir = baseDir.toAbsolutePath().normalize();
    }

    public Path configFile(String name) {
        return baseDir.resolve("config").resolve(name).normalize();
    }
}
```

Rule:

> Jangan biarkan correctness file workflow bergantung pada current working directory kecuali memang explicit design.

---

## 26. Case Sensitivity: `A.txt` dan `a.txt` Bisa Sama atau Berbeda

Di Linux umumnya case-sensitive:

```text
A.txt != a.txt
```

Di Windows umumnya case-insensitive tetapi case-preserving:

```text
A.txt == a.txt untuk lookup
```

Di macOS bisa tergantung filesystem configuration.

Implikasi:

```java
Path a = Paths.get("A.txt");
Path b = Paths.get("a.txt");
```

`a.equals(b)` biasanya false karena path syntax string berbeda. Tetapi pada filesystem case-insensitive, keduanya bisa resolve ke file yang sama.

Jangan membuat security policy hanya berdasarkan string case-sensitive kalau aplikasi bisa berjalan di Windows/macOS.

Contoh masalah:

```text
Policy blocks: secret.txt
User requests: SECRET.TXT
```

Di filesystem case-insensitive, itu bisa file yang sama.

Gunakan real path, identity check, dan policy yang sesuai platform.

---

## 27. Timestamp, Size, and Metadata Are Also Snapshot

Attributes seperti:

```java
attrs.size();
attrs.lastModifiedTime();
attrs.creationTime();
```

bisa berubah setelah dibaca.

Anti-pattern:

```java
long size = Files.size(path);
byte[] bytes = Files.readAllBytes(path);
assert bytes.length == size;
```

File bisa berubah antara `size` dan read.

Lebih benar:

```java
byte[] bytes = Files.readAllBytes(path);
int actualSize = bytes.length;
```

Untuk large file streaming, gunakan checksum/length verification setelah read, atau format file yang memiliki framing sendiri.

---

## 28. Production Error Taxonomy untuk File Existence/Type

Saat file operation gagal, klasifikasikan error secara jelas.

| Exception | Makna umum | Biasanya tindakan |
|---|---|---|
| `NoSuchFileException` | Path tidak ditemukan pada saat operasi | skip, retry, report missing, reconcile |
| `FileAlreadyExistsException` | Create/move target sudah ada | idempotency check, collision handling |
| `AccessDeniedException` | Permission/share/lock issue | alert, permission fix, retry terbatas |
| `DirectoryNotEmptyException` | Delete directory gagal karena berisi entry | recursive delete atau abort |
| `FileSystemLoopException` | Loop saat traversal link | abort subtree, report symlink cycle |
| `NotDirectoryException` | Salah satu segment seharusnya directory tapi bukan | invalid path/state corruption |
| `AtomicMoveNotSupportedException` | Atomic move tidak didukung | fallback hanya jika invariant tetap aman |
| `IOException` umum | I/O failure lain | classify, retry policy, alert |

Jangan tangkap semua sebagai:

```java
catch (Exception e) {
    return false;
}
```

Itu membuang informasi yang sangat penting untuk troubleshooting.

---

## 29. Practical Utility: Classify Path State

Kadang kita memang butuh laporan state path, misalnya untuk diagnostics endpoint.

Contoh utility:

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;

public final class PathInspector {

    public enum PathKind {
        REGULAR_FILE,
        DIRECTORY,
        SYMBOLIC_LINK,
        OTHER,
        NOT_FOUND,
        UNKNOWN
    }

    public static PathKind inspectNoFollow(Path path) {
        try {
            BasicFileAttributes attrs = Files.readAttributes(
                path,
                BasicFileAttributes.class,
                LinkOption.NOFOLLOW_LINKS
            );

            if (attrs.isRegularFile()) return PathKind.REGULAR_FILE;
            if (attrs.isDirectory()) return PathKind.DIRECTORY;
            if (attrs.isSymbolicLink()) return PathKind.SYMBOLIC_LINK;
            return PathKind.OTHER;
        } catch (NoSuchFileException e) {
            return PathKind.NOT_FOUND;
        } catch (IOException | SecurityException e) {
            return PathKind.UNKNOWN;
        }
    }

    private PathInspector() {
    }
}
```

Penggunaan:

```java
PathKind kind = PathInspector.inspectNoFollow(path);

switch (kind) {
    case REGULAR_FILE:
        System.out.println("Regular file");
        break;
    case DIRECTORY:
        System.out.println("Directory");
        break;
    case SYMBOLIC_LINK:
        System.out.println("Symbolic link");
        break;
    case OTHER:
        System.out.println("Special file or provider-specific file");
        break;
    case NOT_FOUND:
        System.out.println("Not found");
        break;
    case UNKNOWN:
        System.out.println("Cannot determine");
        break;
}
```

Catatan: utility ini bagus untuk observasi, bukan untuk guarantee operasi berikutnya.

---

## 30. Practical Utility: Require Existing Regular File

Untuk banyak aplikasi, kita butuh fungsi guard yang jelas.

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;

public final class FilePreconditions {

    public static BasicFileAttributes requireExistingRegularFileNoFollow(Path path) throws IOException {
        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        if (!attrs.isRegularFile()) {
            throw new IOException("Expected regular file but found different file type: " + path);
        }

        return attrs;
    }

    public static void requireExistingDirectoryNoFollow(Path path) throws IOException {
        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        if (!attrs.isDirectory()) {
            throw new NotDirectoryException(path.toString());
        }
    }

    private FilePreconditions() {
    }
}
```

Tetapi selalu ingat:

> Guard ini bukan lock. Ia hanya menolak state yang salah pada saat metadata dibaca.

---

## 31. Practical Utility: Create If Absent Atomically

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

public final class AtomicCreateExample {

    public static boolean createUtf8FileIfAbsent(Path path, String content) throws IOException {
        try {
            Files.write(
                path,
                content.getBytes(StandardCharsets.UTF_8),
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE
            );
            return true;
        } catch (FileAlreadyExistsException e) {
            return false;
        }
    }
}
```

Return semantics:

| Return | Makna |
|---:|---|
| true | File berhasil dibuat oleh caller ini |
| false | File sudah ada sebelum/ketika operasi create |
| exception | Ada error lain: permission, parent missing, disk issue, etc. |

Ini jauh lebih baik daripada `exists` + `write`.

---

## 32. Practical Utility: Read If Present Without Precheck

```java
import java.io.IOException;
import java.nio.file.*;
import java.util.Optional;

public final class OptionalFileRead {

    public static Optional<byte[]> readIfPresent(Path path) throws IOException {
        try {
            return Optional.of(Files.readAllBytes(path));
        } catch (NoSuchFileException e) {
            return Optional.empty();
        }
    }

    private OptionalFileRead() {
    }
}
```

Ini bukan hanya lebih pendek, tetapi lebih race-aware.

---

## 33. Practical Utility: Safe Delete If Present

```java
import java.io.IOException;
import java.nio.file.*;

public final class DeleteUtils {

    public static boolean deleteFileIfPresent(Path path) throws IOException {
        try {
            return Files.deleteIfExists(path);
        } catch (DirectoryNotEmptyException e) {
            throw new IOException("Refusing to delete non-empty directory: " + path, e);
        }
    }

    private DeleteUtils() {
    }
}
```

Jika hanya file regular yang boleh dihapus:

```java
public static boolean deleteRegularFileIfPresent(Path path) throws IOException {
    try {
        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        if (!attrs.isRegularFile()) {
            throw new IOException("Refusing to delete non-regular file: " + path);
        }

        Files.delete(path);
        return true;
    } catch (NoSuchFileException e) {
        return false;
    }
}
```

Masih ada race antara attribute read dan delete. Untuk directory yang tidak trusted, perlu desain security yang lebih ketat.

---

## 34. `exists` pada Network Filesystem dan Cloud Volume

Pada local filesystem, existence check biasanya cepat dan cukup stabil. Pada network filesystem, asumsi ini melemah.

Potensi masalah:

- metadata caching
- latency tinggi
- stale view antar node
- permission mapping berbeda
- lock semantics berbeda
- rename visibility delay
- intermittent I/O error
- path terlihat ada di satu node, belum terlihat di node lain

Karena itu, untuk distributed workflow:

- jangan pakai file existence sebagai distributed lock
- jangan pakai directory scan sebagai satu-satunya source of truth tanpa reconciliation
- jangan asumsikan watcher event reliable
- gunakan database/message queue untuk coordination jika butuh strong workflow state
- gunakan atomic rename hanya jika filesystem dan mount semantics sudah diverifikasi

Part 29 akan membahas network filesystem lebih detail.

---

## 35. `exists` pada Container dan Kubernetes

Di container/Kubernetes, file bisa berasal dari:

- image layer
- writable container layer
- ConfigMap volume
- Secret volume
- `emptyDir`
- persistent volume
- projected volume
- CSI volume
- network filesystem

Masalah yang sering terjadi:

1. File ada di local dev, tidak ada di container image.
2. Relative path berubah karena working directory berbeda.
3. Volume mounted menutupi directory yang sudah ada di image.
4. ConfigMap update dilakukan via symlink/atomic directory switch.
5. File permission berbeda karena container berjalan sebagai non-root.
6. Read-only root filesystem membuat write gagal walaupun path ada.

Maka preflight:

```java
Files.exists(path)
```

tidak cukup. Production startup check harus membedakan:

- path missing
- not directory
- not readable
- not writable
- permission denied
- filesystem read-only
- expected mount not present

Contoh startup validation:

```java
static void validateWritableDirectory(Path dir) throws IOException {
    BasicFileAttributes attrs = Files.readAttributes(
        dir,
        BasicFileAttributes.class,
        LinkOption.NOFOLLOW_LINKS
    );

    if (!attrs.isDirectory()) {
        throw new NotDirectoryException(dir.toString());
    }

    Path probe = Files.createTempFile(dir, ".write-probe-", ".tmp");
    try {
        Files.write(probe, new byte[] {1}, StandardOpenOption.WRITE);
    } finally {
        Files.deleteIfExists(probe);
    }
}
```

Kenapa create temp probe lebih kuat daripada `isWritable`?

Karena ia mencoba operasi nyata yang dibutuhkan: create + write + delete.

---

## 36. Decision Table: Check atau Langsung Operasi?

| Tujuan | Jangan lakukan | Lebih baik |
|---|---|---|
| Baca file jika ada | `exists` lalu read | read, catch `NoSuchFileException` |
| Buat file jika belum ada | `!exists` lalu write | `CREATE_NEW` |
| Hapus jika ada | `exists` lalu delete | `deleteIfExists` |
| Pastikan input regular file | hanya `exists` | `readAttributes(..., NOFOLLOW_LINKS)` + handle race |
| Klaim file untuk worker | `exists` + lock variable | atomic move/rename claim |
| Validasi writable directory | `isWritable` saja | actual temp create/write/delete probe |
| Security path containment | string prefix check | real path + root containment + symlink policy |
| Distributed coordination | lock file naïf | DB/queue/lease/verified FS lock semantics |

---

## 37. Checklist Mental Model

Sebelum menulis kode file existence/type, tanyakan:

1. Apakah saya butuh observasi atau guarantee?
2. Kalau guarantee, apakah ada operasi atomic yang sesuai?
3. Apakah path berasal dari user input?
4. Apakah symlink boleh diikuti?
5. Apakah directory tempat file berada trusted?
6. Apakah file bisa berubah oleh proses lain?
7. Apakah saya membedakan not found, permission denied, dan unknown?
8. Apakah workflow saya aman jika file hilang setelah dicek?
9. Apakah workflow saya aman jika file diganti setelah dicek?
10. Apakah workflow saya berjalan di Windows/Linux/container/network filesystem?
11. Apakah saya memakai exception untuk diagnosis, bukan menyembunyikan semua menjadi false?
12. Apakah saya membutuhkan file identity, bukan path equality?

---

## 38. Anti-Patterns Ringkas

### Anti-pattern 1: `exists` sebagai lock

```java
if (!Files.exists(lockFile)) {
    Files.write(lockFile, pidBytes);
}
```

Gunakan `CREATE_NEW`, atau mekanisme lock/lease yang benar.

### Anti-pattern 2: `exists` sebelum delete

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Gunakan:

```java
Files.deleteIfExists(path);
```

### Anti-pattern 3: `exists` sebagai permission diagnosis

```java
if (!Files.exists(path)) {
    throw new RuntimeException("Missing");
}
```

Bisa jadi permission denied/unknown.

### Anti-pattern 4: string equality sebagai file identity

```java
if (path1.toString().equals(path2.toString())) {
    // same file
}
```

Gunakan `Files.isSameFile` jika memang butuh identity.

### Anti-pattern 5: mengikuti symlink tanpa sadar

```java
if (Files.isRegularFile(userPath)) {
    serve(userPath);
}
```

Untuk security boundary, pertimbangkan `NOFOLLOW_LINKS` dan containment strategy.

---

## 39. Java 8 sampai 25 Compatibility Notes

Konsep utama part ini stabil dari Java 8 sampai Java 25:

- `Files.exists`
- `Files.notExists`
- `Files.isRegularFile`
- `Files.isDirectory`
- `Files.isSymbolicLink`
- `Files.isSameFile`
- `Files.readAttributes`
- `BasicFileAttributes`
- `LinkOption.NOFOLLOW_LINKS`
- `StandardOpenOption.CREATE_NEW`
- `Files.deleteIfExists`

Perbedaan style:

Java 8:

```java
Path path = Paths.get("/data/input.txt");
```

Java 11+ / modern Java:

```java
Path path = Path.of("/data/input.txt");
```

Untuk seri ini, contoh sering memakai `Paths.get` jika ingin Java 8 compatible. Jika memakai `Path.of`, akan diberi catatan.

---

## 40. Mini Case Study: Import File Processor yang Salah

Requirement:

- Ada directory `/app/inbox`.
- Service membaca `.json` files.
- Setelah berhasil, file dihapus.
- Jika gagal, file dipindahkan ke `/app/error`.
- Bisa ada dua instance service.

Implementasi awal:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(inbox, "*.json")) {
    for (Path file : stream) {
        if (Files.exists(file) && Files.isRegularFile(file)) {
            try {
                process(file);
                Files.delete(file);
            } catch (Exception e) {
                Files.move(file, error.resolve(file.getFileName()));
            }
        }
    }
}
```

Masalah:

1. Dua instance bisa memproses file yang sama.
2. `exists` tidak mencegah file hilang setelah check.
3. `isRegularFile` bisa mengikuti symlink.
4. Jika `process(file)` berhasil tetapi delete gagal, restart bisa duplicate process.
5. Error move bisa overwrite file error lain.
6. File bisa berubah saat diproses.
7. Tidak ada claim state.
8. Tidak ada idempotency.

Versi lebih baik secara arsitektural:

```text
/app/inbox/order-001.json
  ↓ atomic move claim
/app/processing/order-001.json.<instance-id>.<uuid>
  ↓ validate regular non-symlink after claim
  ↓ process idempotently using content hash/message id
  ↓ move to done or error
/app/done/order-001.json
/app/error/order-001.json.<reason>
```

Contoh skeleton:

```java
static void processInbox(Path inbox, Path processing, Path done, Path error, String workerId) throws IOException {
    try (DirectoryStream<Path> stream = Files.newDirectoryStream(inbox, "*.json")) {
        for (Path candidate : stream) {
            Path claimed = processing.resolve(
                candidate.getFileName().toString() + "." + workerId + "." + UUID.randomUUID()
            );

            try {
                Files.move(candidate, claimed, StandardCopyOption.ATOMIC_MOVE);
            } catch (NoSuchFileException | FileAlreadyExistsException e) {
                continue;
            }

            try {
                BasicFileAttributes attrs = Files.readAttributes(
                    claimed,
                    BasicFileAttributes.class,
                    LinkOption.NOFOLLOW_LINKS
                );

                if (!attrs.isRegularFile()) {
                    throw new IOException("Claimed path is not a regular file: " + claimed);
                }

                process(claimed);

                Files.move(
                    claimed,
                    done.resolve(stripClaimSuffix(claimed.getFileName().toString())),
                    StandardCopyOption.ATOMIC_MOVE
                );
            } catch (Exception processingFailure) {
                Path errorTarget = error.resolve(claimed.getFileName().toString() + ".error");
                try {
                    Files.move(claimed, errorTarget, StandardCopyOption.ATOMIC_MOVE);
                } catch (IOException moveFailure) {
                    processingFailure.addSuppressed(moveFailure);
                }
                // log/report processingFailure
            }
        }
    }
}
```

Ini belum final production-grade, tapi sudah menunjukkan perubahan mental model:

```text
Naive: check existence → process
Better: observe → atomic claim → validate → process → transition state
```

---

## 41. Ringkasan Part 02

Hal paling penting dari part ini:

1. `Path` bukan file; existence adalah runtime lookup.
2. `Files.exists` dan `Files.notExists` membentuk tiga state: exists, not exists, unknown.
3. `!Files.exists(path)` tidak sama dengan `Files.notExists(path)`.
4. `exists`, `isRegularFile`, `isDirectory`, `isReadable`, `isWritable` adalah snapshot, bukan guarantee.
5. Jangan pakai `exists` sebagai lock atau correctness gate.
6. Untuk create-if-absent, gunakan `CREATE_NEW`.
7. Untuk delete-if-present, gunakan `deleteIfExists`.
8. Untuk read-if-present, lakukan read dan catch `NoSuchFileException`.
9. Symlink bisa mengubah makna existence/type check.
10. Gunakan `NOFOLLOW_LINKS` ketika ingin memeriksa link entry itu sendiri.
11. Path string bukan identitas file.
12. Gunakan `Files.isSameFile` atau `fileKey` jika butuh identity, dengan catatan provider-specific.
13. Permission error bisa membuat existence unknown.
14. Exception memberi diagnosis lebih kaya daripada boolean.
15. Production workflow harus didesain dengan invariant dan atomic operation, bukan hope.

---

## 42. Latihan

### Latihan 1 — Existence Tiga State

Buat utility:

```java
enum ExistenceState {
    EXISTS,
    NOT_EXISTS,
    UNKNOWN
}
```

Lalu implementasikan:

```java
static ExistenceState existenceOf(Path path)
```

dengan `Files.exists` dan `Files.notExists`.

Pertanyaan:

- Kapan hasilnya `UNKNOWN`?
- Bagaimana logging yang baik untuk state tersebut?

### Latihan 2 — Atomic Create

Implementasikan fungsi:

```java
static boolean createMarker(Path marker, String content) throws IOException
```

Requirement:

- return true jika caller berhasil membuat marker
- return false jika marker sudah ada
- jangan overwrite marker existing
- jangan pakai `exists`

### Latihan 3 — Non-Symlink Regular File Validator

Implementasikan:

```java
static BasicFileAttributes requireRegularFileNoFollow(Path path) throws IOException
```

Requirement:

- symlink harus ditolak
- directory harus ditolak
- missing file harus menghasilkan `NoSuchFileException`
- permission issue jangan disembunyikan menjadi false

### Latihan 4 — Claim File Processor

Buat mini workflow:

```text
inbox → processing → done/error
```

Requirement:

- claim memakai `Files.move(..., ATOMIC_MOVE)`
- tidak memakai `exists` untuk claim
- missing candidate dianggap sudah diambil proses lain
- setelah claim, validasi lagi bahwa file regular non-symlink

### Latihan 5 — Identity Check

Buat eksperimen:

- Buat file `a.txt`.
- Buat hard link `b.txt` jika OS mendukung.
- Cek `a.equals(b)`.
- Cek `Files.isSameFile(a, b)`.
- Baca `fileKey` keduanya.

Analisis hasilnya.

---

## 43. Referensi Resmi

- Oracle Java SE 25 API — `java.nio.file.Files`.
- Oracle Java SE 8 API — `java.nio.file.Files`.
- Oracle Java Tutorials — Checking a File or Directory.
- Oracle Java SE API — `BasicFileAttributes`.
- Oracle Java SE API — `LinkOption`.

---

## 44. Status Seri

Selesai:

```text
Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
Part 02 — File Existence, Type, and Identity: exists Is Not a Lock
```

Belum selesai. Part berikutnya:

```text
Part 03 — File Creation Semantics: Atomic Create, Temp File, Directory Creation
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering-part-01-path-semantics](./learn-java-io-file-filesystem-storage-engineering-part-01-path-semantics.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 03](./learn-java-io-file-filesystem-storage-engineering-part-03-file-creation-semantics.md)

</div>