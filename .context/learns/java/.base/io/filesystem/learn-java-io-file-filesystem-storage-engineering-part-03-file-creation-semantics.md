# learn-java-io-file-filesystem-storage-engineering — Part 03
# File Creation Semantics: Atomic Create, Temp File, Directory Creation

> Target: Java 8–25  
> Fokus: `Files.createFile`, `Files.createDirectory`, `Files.createDirectories`, `Files.createTempFile`, `Files.createTempDirectory`, `FileAttribute`, race condition, secure temp files, dan desain workflow create yang benar di production.

---

## 0. Tujuan Pembelajaran

Setelah part ini, kamu harus bisa melihat operasi “membuat file/directory” bukan sebagai helper API sederhana, tetapi sebagai operasi state transition di filesystem yang punya konsekuensi correctness, security, concurrency, portability, dan operability.

Kamu akan mampu menjawab pertanyaan seperti:

1. Kenapa `if (!exists) create` adalah pola yang salah?
2. Apa bedanya `createFile` dan `Files.write(..., CREATE_NEW)`?
3. Kenapa `createDirectories` tidak boleh dianggap transaction?
4. Kenapa temp file harus dibuat oleh filesystem API, bukan dari random filename manual?
5. Bagaimana membuat directory dengan permission aman sejak awal?
6. Apa risiko `deleteOnExit` di long-running server?
7. Bagaimana mendesain staging area untuk file processing agar aman dari collision dan race?
8. Apa batas atomicity yang dijanjikan Java, dan apa yang tidak dijanjikan?

---

## 1. Mental Model: Create Adalah Operasi Klaim Nama

Saat kamu membuat file, yang sebenarnya terjadi bukan hanya “menulis byte kosong”. Pada filesystem, create adalah usaha untuk menambahkan sebuah nama baru pada sebuah directory.

Secara konseptual:

```text
Directory D
  before:
    a.txt -> object#101
    b.txt -> object#102

create D/c.txt

Directory D
  after:
    a.txt -> object#101
    b.txt -> object#102
    c.txt -> object#103
```

Yang diklaim adalah nama `c.txt` di dalam directory `D`.

Karena itu, pertanyaan utama dari create operation adalah:

```text
Apakah nama ini berhasil diklaim secara eksklusif?
```

Bukan:

```text
Apakah tadi saat dicek nama ini belum ada?
```

Itulah inti pembahasan part ini.

---

## 2. API yang Dibahas

API utama di `java.nio.file.Files`:

```java
Files.createFile(Path path, FileAttribute<?>... attrs)
Files.createDirectory(Path dir, FileAttribute<?>... attrs)
Files.createDirectories(Path dir, FileAttribute<?>... attrs)
Files.createTempFile(Path dir, String prefix, String suffix, FileAttribute<?>... attrs)
Files.createTempFile(String prefix, String suffix, FileAttribute<?>... attrs)
Files.createTempDirectory(Path dir, String prefix, FileAttribute<?>... attrs)
Files.createTempDirectory(String prefix, FileAttribute<?>... attrs)
```

API terkait:

```java
Files.newByteChannel(Path path, Set<? extends OpenOption> options, FileAttribute<?>... attrs)
Files.newOutputStream(Path path, OpenOption... options)
Files.write(Path path, byte[] bytes, OpenOption... options)
Files.writeString(Path path, CharSequence csq, OpenOption... options) // Java 11+
```

Open option terkait:

```java
StandardOpenOption.CREATE
StandardOpenOption.CREATE_NEW
StandardOpenOption.WRITE
StandardOpenOption.TRUNCATE_EXISTING
StandardOpenOption.APPEND
StandardOpenOption.DELETE_ON_CLOSE
```

---

## 3. Java Version Notes: Java 8 sampai Java 25

### 3.1 Stabilitas API

Sebagian besar API creation di `java.nio.file.Files` sudah tersedia sejak Java 7, sehingga tersedia di Java 8:

- `createFile`
- `createDirectory`
- `createDirectories`
- `createTempFile`
- `createTempDirectory`
- `FileAttribute`
- `StandardOpenOption.CREATE_NEW`

Jadi secara kompatibilitas, materi ini aman untuk Java 8–25.

### 3.2 Perbedaan gaya `Path`

Java 8:

```java
Path path = Paths.get("/var/app/data/file.txt");
```

Java 11+ / modern:

```java
Path path = Path.of("/var/app/data/file.txt");
```

Dalam contoh, kita akan sering memakai `Path.of` untuk gaya modern. Jika targetmu Java 8, ganti dengan `Paths.get`.

---

## 4. `Files.createFile`: Atomic Empty File Creation

### 4.1 Kontrak dasar

```java
Path file = Path.of("data/report.txt");
Files.createFile(file);
```

Makna:

```text
Buat file kosong baru di path tersebut.
Jika sudah ada file/directory/link dengan nama itu, gagal.
Jika parent directory tidak ada, gagal.
```

Hal paling penting: check existence dan create dilakukan sebagai satu operasi atomic relatif terhadap operasi filesystem lain yang memengaruhi directory tersebut.

Artinya, ini aman terhadap race seperti:

```text
Thread A: create data/report.txt
Thread B: create data/report.txt
```

Hanya satu yang menang.

Yang kalah akan mendapat exception, umumnya:

```java
FileAlreadyExistsException
```

### 4.2 Pola yang benar

```java
try {
    Files.createFile(path);
    // Kita berhasil mengklaim nama file ini.
} catch (FileAlreadyExistsException e) {
    // Nama sudah diklaim oleh proses/thread lain atau sudah ada sebelumnya.
}
```

### 4.3 Pola yang salah

```java
if (!Files.exists(path)) {
    Files.createFile(path);
}
```

Masalah:

```text
T1: exists(path) -> false
T2: exists(path) -> false
T1: createFile(path) -> success
T2: createFile(path) -> FileAlreadyExistsException
```

`exists` hanya observasi sesaat. Ia bukan reservation, bukan lock, bukan claim.

### 4.4 Mental model yang benar

Jangan berpikir:

```text
Cek dulu, lalu buat.
```

Berpikirlah:

```text
Coba klaim nama secara atomic, lalu handle hasilnya.
```

---

## 5. `createFile` vs `CREATE_NEW`

Ada dua cara umum membuat file baru secara eksklusif.

### 5.1 `Files.createFile`

```java
Files.createFile(path);
```

Membuat file kosong.

Cocok untuk:

- claim marker
- lock marker sederhana
- empty placeholder
- memastikan nama belum ada

### 5.2 `Files.newByteChannel` dengan `CREATE_NEW`

```java
try (SeekableByteChannel ch = Files.newByteChannel(
        path,
        EnumSet.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE))) {
    ch.write(ByteBuffer.wrap("hello".getBytes(StandardCharsets.UTF_8)));
}
```

Membuat dan langsung membuka file untuk write secara eksklusif.

Cocok untuk:

- create + write dalam satu ownership flow
- menghindari window antara create dan open
- menulis content awal setelah berhasil claim

### 5.3 `Files.write` dengan `CREATE_NEW`

```java
Files.write(
    path,
    "hello".getBytes(StandardCharsets.UTF_8),
    StandardOpenOption.CREATE_NEW,
    StandardOpenOption.WRITE
);
```

Cocok untuk small content.

### 5.4 Bedanya dengan `CREATE`

```java
StandardOpenOption.CREATE
```

Makna:

```text
Buat jika belum ada. Jika sudah ada, buka file existing.
```

Ini bukan exclusive claim.

```java
Files.write(path, bytes, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
```

Risiko:

- bisa menulis ke file yang sudah ada
- bisa mengubah file milik flow lain
- bisa overwrite/append tergantung option lain
- tidak cocok untuk klaim nama unik

### 5.5 Rule of thumb

| Tujuan | Gunakan |
|---|---|
| Membuat placeholder kosong dan gagal jika ada | `createFile` |
| Membuat file baru lalu langsung menulis | `CREATE_NEW + WRITE` |
| Membuat jika belum ada, pakai existing jika ada | `CREATE` |
| Membuat ulang file secara aman | temp file + atomic move, bukan overwrite langsung |

---

## 6. Parent Directory Tidak Dibuat Otomatis

```java
Path file = Path.of("data/import/2026/file.txt");
Files.createFile(file);
```

Jika `data/import/2026` belum ada, operasi gagal.

Biasanya exception:

```java
NoSuchFileException
```

Membuat file tidak sama dengan membuat parent directory.

Pola eksplisit:

```java
Path file = Path.of("data/import/2026/file.txt");
Files.createDirectories(file.getParent());
Files.createFile(file);
```

Namun jangan lupa: `createDirectories` punya semantics sendiri yang akan dibahas di bawah.

---

## 7. `Files.createDirectory`: Atomic Directory Creation Satu Level

```java
Path dir = Path.of("data/inbox");
Files.createDirectory(dir);
```

Makna:

```text
Buat directory `inbox`.
Parent `data` harus sudah ada.
Jika `inbox` sudah ada, gagal.
```

Seperti `createFile`, check existence + create directory adalah operasi atomic relatif terhadap aktivitas filesystem lain yang memengaruhi directory parent.

### 7.1 Cocok untuk klaim directory

Directory bisa dipakai sebagai claim object.

Contoh:

```java
Path claimDir = Path.of("work/claims/job-123");
try {
    Files.createDirectory(claimDir);
    // Worker ini menang claim job-123.
} catch (FileAlreadyExistsException e) {
    // Worker lain sudah claim.
}
```

Ini sering lebih kuat daripada membuat lock file biasa, karena directory creation umumnya atomic di filesystem lokal.

Tetapi untuk network filesystem, distributed filesystem, atau object-storage-like provider, jangan langsung percaya tanpa validasi provider/runtime.

---

## 8. `Files.createDirectories`: Idempotent Parent Creation, Bukan Transaction

```java
Path dir = Path.of("data/import/2026/06/18");
Files.createDirectories(dir);
```

Makna:

```text
Buat semua parent directory yang belum ada.
Jika target directory sudah ada, tidak error.
Jika sebagian parent sudah ada, lanjut buat yang belum ada.
```

### 8.1 Bukan atomic secara keseluruhan

Ini sangat penting.

`createDirectories` dapat gagal setelah sebagian directory berhasil dibuat.

Contoh target:

```text
a/b/c/d
```

Kemungkinan hasil:

```text
a created
b created
c gagal karena permission/disk/error
```

Filesystem sekarang berada di partial state:

```text
a/b ada, tapi a/b/c/d belum lengkap
```

Jadi `createDirectories` bukan transaction.

### 8.2 Cocok untuk idempotent setup

Cocok:

```java
Files.createDirectories(appHome.resolve("inbox"));
Files.createDirectories(appHome.resolve("processing"));
Files.createDirectories(appHome.resolve("done"));
Files.createDirectories(appHome.resolve("error"));
```

Tidak cocok jika kamu butuh “semua directory berhasil atau tidak ada perubahan sama sekali”. Filesystem biasa tidak memberi transaction seperti database.

### 8.3 Jika path sudah ada tapi bukan directory

```text
data/import
```

Jika `data/import` ternyata file biasa, bukan directory, `createDirectories(data/import/2026)` akan gagal.

Biasanya:

```java
FileAlreadyExistsException
```

Tapi exception detail bisa provider-specific.

### 8.4 Race condition tetap perlu dipahami

Walaupun `createDirectories` idempotent, filesystem bisa berubah di tengah operasi:

```text
T1: createDirectories(a/b/c)
T2: delete a/b
T3: create file a/b
```

Maka failure tetap mungkin.

Rule:

```text
createDirectories mengurangi kebutuhan pre-check, tetapi tidak menghilangkan failure handling.
```

---

## 9. FileAttribute: Permission dan Metadata Saat Create

Banyak engineer membuat file/directory lalu mengubah permission setelahnya:

```java
Files.createFile(path);
Files.setPosixFilePermissions(path, perms);
```

Masalahnya ada window kecil:

```text
file created with default permission
then permission changed
```

Jika default permission terlalu longgar, file bisa terlihat/dibuka pihak lain sebelum permission diketatkan.

Solusi lebih baik: set attribute saat create.

### 9.1 POSIX permission saat create

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rw-------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

Path file = Path.of("secure/token.txt");
Files.createFile(file, attr);
```

Untuk directory:

```java
Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rwx------");
FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

Files.createDirectory(Path.of("secure/private"), attr);
```

### 9.2 Tidak semua filesystem support POSIX

Kode di atas bisa gagal di Windows/default provider tertentu:

```java
UnsupportedOperationException
```

Karena itu production code perlu capability-aware.

Contoh:

```java
FileStore store = Files.getFileStore(parent);
boolean supportsPosix = store.supportsFileAttributeView(PosixFileAttributeView.class);
```

Namun capability check pun hanya preflight. Tetap handle exception saat operasi create.

### 9.3 Attribute duplicate

Jika attribute dengan nama sama dikirim lebih dari sekali, hanya yang terakhir yang berlaku.

Contoh buruk:

```java
Files.createFile(path, attr600, attr644);
```

Yang efektif bisa `attr644`, tergantung urutan. Jangan kirim duplicate attribute.

---

## 10. Umask dan Permission: Attribute Bukan Selalu Cerita Lengkap

Di POSIX system, permission akhir dapat dipengaruhi oleh umask proses.

Misalnya kamu berharap:

```text
rw-rw-rw-
```

Tapi karena umask:

```text
rw-r--r--
```

Java API memberikan cara set attribute saat create, tetapi final behavior tetap melewati provider + OS + filesystem.

Prinsip production:

```text
Untuk security-sensitive file, verify permission setelah create jika permission adalah invariant keamanan.
```

Contoh:

```java
Path p = Files.createFile(path, PosixFilePermissions.asFileAttribute(ownerOnly));
Set<PosixFilePermission> actual = Files.getPosixFilePermissions(p);
if (!actual.equals(ownerOnly)) {
    throw new IllegalStateException("Unexpected permission: " + actual);
}
```

Catatan: verification ini sendiri bisa race jika path dapat diganti pihak lain. Dalam security-critical flow, perlu containment, directory ownership, no symlink strategy, dan restricted parent directory. Ini akan dibahas lebih dalam di part security/symlink.

---

## 11. Temporary File: Jangan Generate Nama Sendiri

### 11.1 Anti-pattern

```java
Path tmp = dir.resolve("upload-" + System.currentTimeMillis() + ".tmp");
Files.createFile(tmp);
```

Masalah:

- timestamp collision
- predictable name
- attacker bisa pre-create
- race condition
- tidak robust di concurrency tinggi
- susah menjamin unique

Lebih buruk:

```java
Path tmp = dir.resolve(UUID.randomUUID() + ".tmp");
if (!Files.exists(tmp)) {
    Files.write(tmp, bytes);
}
```

UUID memang mengurangi collision, tapi `exists` tetap bukan atomic claim.

### 11.2 Gunakan `createTempFile`

```java
Path tmp = Files.createTempFile(dir, "upload-", ".tmp");
```

Makna:

```text
Buat file kosong baru di directory `dir` dengan nama unik yang dipilih provider.
Return path file yang benar-benar belum ada sebelum operasi.
```

### 11.3 Prefix dan suffix bukan kontrak nama penuh

```java
Files.createTempFile(dir, "upload-", ".tmp");
```

Jangan berasumsi nama pasti:

```text
upload-<angka>.tmp
```

Detail konstruksi nama adalah implementation dependent.

Yang boleh diasumsikan:

- prefix/suffix dipakai sebagai bagian candidate name jika memungkinkan
- file baru dibuat dan belum ada sebelumnya
- path berada di directory yang diberikan
- path berada di FileSystem yang sama dengan directory tersebut

### 11.4 Suffix null

```java
Files.createTempFile(dir, "upload-", null);
```

Jika suffix `null`, default suffix adalah:

```text
.tmp
```

### 11.5 Prefix null

Prefix boleh `null`.

```java
Files.createTempFile(dir, null, ".dat");
```

Namun untuk operability, gunakan prefix yang bermakna:

```text
upload-
export-
checkpoint-
manifest-
```

Agar saat incident, file temp bisa dikenali.

---

## 12. Default Temporary Directory

```java
Path tmp = Files.createTempFile("app-", ".tmp");
```

Ini membuat file di default temporary-file directory.

Default temp directory biasanya dikendalikan oleh system property:

```java
System.getProperty("java.io.tmpdir")
```

Namun untuk server production, jangan terlalu bergantung pada default temp directory.

### 12.1 Risiko default temp directory

Default temp directory bisa:

- shared dengan aplikasi lain
- dibersihkan OS/container runtime
- berada di filesystem kecil
- berada di storage lambat
- tidak survive restart
- punya permission berbeda
- berada di ephemeral layer container
- penuh karena proses lain

### 12.2 Lebih baik explicit working directory

```java
Path appTmp = appHome.resolve("tmp");
Files.createDirectories(appTmp);
Path tmp = Files.createTempFile(appTmp, "upload-", ".tmp");
```

Untuk production, temp file bukan “temp sembarang”. Ia bagian dari workflow.

---

## 13. Temporary Directory

```java
Path workDir = Files.createTempDirectory(parent, "job-");
```

Cocok untuk pekerjaan yang butuh banyak file sementara:

```text
work/job-123456789/
  payload.bin
  manifest.json
  extracted/
  result.tmp
```

Keuntungan temp directory dibanding banyak temp file langsung di satu folder:

- isolasi per job
- cleanup lebih mudah
- mengurangi collision logical
- observability lebih baik
- bisa menyimpan multi-file intermediate state

Namun `createTempDirectory` tidak otomatis menghapus isinya.

---

## 14. Cleanup Temporary File: Jangan Mengandalkan `deleteOnExit` di Server

### 14.1 `deleteOnExit`

Legacy API:

```java
file.toFile().deleteOnExit();
```

Masalah di long-running server:

- daftar file disimpan sampai JVM exit
- bisa memory leak jika banyak temp file
- JVM server mungkin berjalan berbulan-bulan
- crash/kill tidak menjamin cleanup normal
- tidak cocok untuk high-throughput workloads

### 14.2 `DELETE_ON_CLOSE`

```java
try (SeekableByteChannel ch = Files.newByteChannel(
        path,
        EnumSet.of(StandardOpenOption.CREATE_NEW,
                   StandardOpenOption.WRITE,
                   StandardOpenOption.DELETE_ON_CLOSE))) {
    // write temp data
}
```

Ini cocok untuk scratch file yang tidak perlu dipublish.

Tapi hati-hati:

- behavior dapat berbeda antar platform/provider
- jika path perlu diproses oleh komponen lain setelah close, jangan pakai `DELETE_ON_CLOSE`
- jika file harus dipublish via move, jangan delete-on-close

### 14.3 Explicit cleanup dengan finally

```java
Path tmp = Files.createTempFile(appTmp, "upload-", ".tmp");
boolean published = false;
try {
    // write, validate, process
    published = true;
} finally {
    if (!published) {
        try {
            Files.deleteIfExists(tmp);
        } catch (IOException cleanupError) {
            // log and continue; cleanup can be retried by janitor
        }
    }
}
```

### 14.4 Janitor process

Untuk production, cleanup sebaiknya juga didukung background janitor:

```text
Delete temp files older than N hours
Delete abandoned job directories older than N days
Quarantine suspicious partial files
Emit metric for cleanup failures
```

Janitor harus hati-hati agar tidak menghapus file yang masih aktif. Gunakan naming, timestamp, lock/claim, atau state marker.

---

## 15. Temp File untuk Atomic Publish

Salah satu pola terpenting:

```text
write to temp file
validate
move/rename to final name
```

Contoh awal:

```java
Path dir = Path.of("data/outbox");
Files.createDirectories(dir);

Path tmp = Files.createTempFile(dir, "report-", ".tmp");
Path target = dir.resolve("report.csv");

try {
    Files.write(tmp, csvBytes, StandardOpenOption.WRITE);
    Files.move(tmp, target,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
} catch (IOException e) {
    Files.deleteIfExists(tmp);
    throw e;
}
```

Kenapa temp file harus di same directory?

Karena atomic move/rename biasanya hanya mungkin dalam filesystem yang sama. Jika temp berada di `/tmp` dan target berada di mounted volume lain, move bisa gagal atau berubah menjadi copy+delete tergantung option/provider.

Part atomic update akan dibahas lebih dalam nanti.

Di part ini, cukup pegang invariant:

```text
Temp file untuk publish sebaiknya dibuat di directory yang sama dengan target final.
```

---

## 16. Directory Creation untuk Application Layout

Misalnya aplikasi file intake butuh layout:

```text
/app/data/intake/
  inbox/
  staging/
  processing/
  done/
  error/
  quarantine/
  tmp/
```

Kode setup:

```java
public final class FileLayout {
    private final Path root;

    public FileLayout(Path root) {
        this.root = root;
    }

    public void initialize() throws IOException {
        Files.createDirectories(root.resolve("inbox"));
        Files.createDirectories(root.resolve("staging"));
        Files.createDirectories(root.resolve("processing"));
        Files.createDirectories(root.resolve("done"));
        Files.createDirectories(root.resolve("error"));
        Files.createDirectories(root.resolve("quarantine"));
        Files.createDirectories(root.resolve("tmp"));
    }
}
```

Tapi top 1% engineer tidak berhenti di situ. Ia akan bertanya:

1. Apakah root path trusted?
2. Apakah root dimiliki user/service account yang benar?
3. Apakah permission directory aman?
4. Apakah root berada di filesystem yang diharapkan?
5. Apakah available space cukup?
6. Apakah directory bisa ditulis?
7. Apakah ada symlink tak diinginkan?
8. Apakah failure setup harus fail-fast atau degraded mode?

Itulah perbedaan “bisa pakai API” vs “menguasai production file engineering”.

---

## 17. Secure Directory Initialization

Untuk POSIX environment:

```java
public static void createPrivateDirectory(Path dir) throws IOException {
    Set<PosixFilePermission> perms = PosixFilePermissions.fromString("rwx------");
    FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(perms);

    try {
        Files.createDirectory(dir, attr);
    } catch (FileAlreadyExistsException e) {
        if (!Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS)) {
            throw e;
        }
    }
}
```

Masalah: jika directory sudah ada, permission mungkin tidak sesuai.

Tambahkan verification:

```java
public static void ensurePrivateDirectory(Path dir) throws IOException {
    Set<PosixFilePermission> expected = PosixFilePermissions.fromString("rwx------");
    FileAttribute<Set<PosixFilePermission>> attr = PosixFilePermissions.asFileAttribute(expected);

    try {
        Files.createDirectory(dir, attr);
    } catch (FileAlreadyExistsException e) {
        if (!Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS)) {
            throw e;
        }
    }

    FileStore store = Files.getFileStore(dir);
    if (store.supportsFileAttributeView(PosixFileAttributeView.class)) {
        Set<PosixFilePermission> actual = Files.getPosixFilePermissions(dir, LinkOption.NOFOLLOW_LINKS);
        if (!actual.equals(expected)) {
            throw new IOException("Unsafe permissions for " + dir + ": " + PosixFilePermissions.toString(actual));
        }
    }
}
```

Catatan: ini masih belum sempurna untuk hostile directory karena ada race dan symlink concerns. Tapi sebagai foundation production layout di trusted parent, ini jauh lebih baik daripada blind `createDirectories`.

---

## 18. Create as Claim Pattern

Creation bisa dipakai untuk coordination.

### 18.1 File claim

```java
Path claim = claimsDir.resolve(jobId + ".claim");
try {
    Files.createFile(claim);
    return true;
} catch (FileAlreadyExistsException e) {
    return false;
}
```

Makna:

```text
Jika berhasil membuat claim file, worker ini menang.
Jika sudah ada, worker lain menang.
```

### 18.2 Directory claim

```java
Path claimDir = claimsDir.resolve(jobId);
try {
    Files.createDirectory(claimDir);
    return true;
} catch (FileAlreadyExistsException e) {
    return false;
}
```

Directory claim sering berguna jika worker perlu menaruh metadata:

```text
claims/job-123/
  owner.txt
  heartbeat.txt
  started-at.txt
```

### 18.3 Batas claim pattern

Claim file/directory bukan distributed lock sempurna.

Masalah:

- worker crash meninggalkan stale claim
- clock skew jika memakai timestamp
- network filesystem semantics bisa berbeda
- delete stale claim bisa race dengan worker lambat
- tidak ada automatic lease

Untuk local single-host processing, create-as-claim bisa sangat berguna. Untuk multi-node critical coordination, pertimbangkan database row lock, Redis lease dengan fencing token, ZooKeeper/etcd, atau message queue visibility timeout.

---

## 19. Marker File Pattern

Marker file adalah file kecil yang menyatakan state.

Contoh:

```text
payload.dat
payload.dat.ready
payload.dat.done
payload.dat.error
```

Creation semantics penting:

```java
Files.createFile(path.resolveSibling(path.getFileName() + ".ready"));
```

Dengan `createFile`, marker hanya dibuat jika belum ada.

Tapi marker file punya kelemahan:

- state bisa tidak konsisten dengan payload
- marker bisa dibuat sebelum payload fully durable
- deletion/order bisa race
- multiple marker conflicting

Lebih baik untuk workflow serius:

```text
staging/file.tmp
ready/file.dat       <- atomic move sebagai publish
processing/file.dat  <- claim via atomic move
done/file.dat
error/file.dat
```

Marker masih berguna, tapi jangan jadikan satu-satunya sumber kebenaran untuk workflow kompleks.

---

## 20. Exception Taxonomy untuk Create Operation

Create operation bisa gagal karena banyak alasan.

### 20.1 `FileAlreadyExistsException`

Nama sudah ada.

```java
catch (FileAlreadyExistsException e) {
    // conflict / already initialized / another worker won
}
```

Jangan selalu treat sebagai error fatal. Kadang ini expected outcome.

### 20.2 `NoSuchFileException`

Parent tidak ada, atau path component hilang saat operasi.

```java
catch (NoSuchFileException e) {
    // parent missing / concurrent delete / wrong layout
}
```

### 20.3 `AccessDeniedException`

Permission denied, readonly filesystem, locked by OS, policy restriction.

```java
catch (AccessDeniedException e) {
    // permission/runtime configuration issue
}
```

### 20.4 `UnsupportedOperationException`

Provider tidak mendukung attribute atomic tertentu.

```java
catch (UnsupportedOperationException e) {
    // fallback or fail-fast depending on security requirement
}
```

### 20.5 Generic `IOException`

Bisa mencakup:

- disk full
- IO error
- stale network filesystem handle
- path too long
- invalid filesystem state
- provider-specific failure

Top 1% habit:

```text
Jangan log hanya “failed to create file”. Log path role, operation, expected invariant, exception class, and sanitized path.
```

Contoh:

```java
log.warn("Failed to create staging temp file; dir={}, operation=createTempFile, reason={}",
         stagingDir, e.toString());
```

Hindari logging full sensitive path jika mengandung tenant/user data.

---

## 21. Create Operation dan Symlink

Misalnya:

```java
Files.createFile(Path.of("data/current"));
```

Jika `data/current` sudah berupa symlink, operasi gagal karena nama sudah ada.

Tapi parent path bisa mengandung symlink:

```text
data -> /mnt/shared/data
```

Maka create terjadi di target symlink parent.

Ini penting untuk security:

```text
trustedRoot/uploads/userA/file.txt
```

Jika `uploads` atau `userA` bisa diganti menjadi symlink oleh attacker, create bisa diarahkan ke lokasi lain.

Mitigasi umum:

- parent directory harus trusted dan tidak writable oleh attacker
- gunakan `NOFOLLOW_LINKS` saat validasi metadata
- gunakan containment check dengan `toRealPath`
- hindari create di directory yang dapat dimodifikasi pihak tidak dipercaya
- untuk upload, gunakan randomized server-side storage path, bukan user path langsung

Detailnya akan dibahas di part symbolic links dan path traversal security.

---

## 22. Hidden Race: Create Parent Then Create Child

Kode umum:

```java
Files.createDirectories(file.getParent());
Files.createFile(file);
```

Kelihatannya aman, tapi ada race:

```text
T1: createDirectories(parent) success
T2: delete parent
T1: createFile(parent/file) fails
```

Atau:

```text
T1: createDirectories(parent) success
T2: replace parent with symlink
T1: createFile(parent/file) creates elsewhere
```

Dalam trusted app directory, risiko kecil. Dalam hostile writable directory, risiko besar.

Rule:

```text
Parent directory creation adalah setup. Jangan anggap ia mengamankan semua operasi child setelahnya.
```

---

## 23. Directory Layout Invariants

Untuk aplikasi production, definisikan invariant eksplisit.

Contoh:

```text
Root invariant:
- root exists
- root is directory
- root is not symlink
- root owner is app user
- root permission is 700 or stricter
- root filesystem has enough usable space

Subdirectory invariant:
- inbox/staging/processing/done/error/tmp exist
- each is directory
- each is not symlink
- each is writable by app
- none is world-writable
```

Kode bootstrap harus memvalidasi, bukan hanya membuat.

```java
public void verifyLayout(Path root) throws IOException {
    requireDirectory(root.resolve("inbox"));
    requireDirectory(root.resolve("staging"));
    requireDirectory(root.resolve("processing"));
    requireDirectory(root.resolve("done"));
    requireDirectory(root.resolve("error"));
    requireDirectory(root.resolve("tmp"));
}

private void requireDirectory(Path path) throws IOException {
    if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
        throw new IOException("Required directory missing or not a directory: " + path);
    }
}
```

---

## 24. Idempotent Initialization Pattern

Production service startup sering harus idempotent.

```java
public final class StorageInitializer {
    private final Path root;

    public StorageInitializer(Path root) {
        this.root = root;
    }

    public void initialize() throws IOException {
        Files.createDirectories(root);
        ensureSubdir("inbox");
        ensureSubdir("staging");
        ensureSubdir("processing");
        ensureSubdir("done");
        ensureSubdir("error");
        ensureSubdir("tmp");
    }

    private void ensureSubdir(String name) throws IOException {
        Path dir = root.resolve(name);
        Files.createDirectories(dir);
        if (!Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Path exists but is not directory: " + dir);
        }
    }
}
```

Ini cukup untuk trusted internal deployment.

Untuk higher security, tambahkan:

- owner check
- permission check
- symlink check setiap segment
- filesystem check
- fail-fast jika mismatch

---

## 25. Designing Create Workflows: Decision Matrix

| Scenario | Recommended Create Strategy |
|---|---|
| Buat file kosong dan harus gagal jika sudah ada | `Files.createFile` |
| Buat file dengan content dan harus gagal jika sudah ada | `CREATE_NEW + WRITE` |
| Buat directory satu level dan parent harus sudah ada | `Files.createDirectory` |
| Buat nested app directory idempotently | `Files.createDirectories` |
| Buat working file unik | `Files.createTempFile(explicitDir, prefix, suffix)` |
| Buat working directory unik per job | `Files.createTempDirectory(explicitDir, prefix)` |
| Claim job local | `createFile` atau `createDirectory` sebagai claim |
| Publish file final | temp file same directory + atomic move |
| Security-sensitive file | create with restrictive `FileAttribute` |
| Cross-node coordination | jangan hanya mengandalkan file create tanpa validasi filesystem semantics |

---

## 26. Case Study: Secure Upload Staging

### 26.1 Requirement

Kita menerima upload file dari user. Kita ingin:

- tidak memakai original filename sebagai storage filename
- tidak overwrite file existing
- staging file unik
- permission private
- cleanup jika gagal
- final publish setelah validasi

### 26.2 Design

```text
storage/
  staging/
    upload-839483.tmp
  accepted/
    2026/06/18/<server-generated-id>.bin
  rejected/
```

### 26.3 Implementation sketch

```java
public final class UploadStager {
    private final Path stagingDir;
    private final Path acceptedDir;

    public UploadStager(Path root) {
        this.stagingDir = root.resolve("staging");
        this.acceptedDir = root.resolve("accepted");
    }

    public Path stage(byte[] content) throws IOException {
        Files.createDirectories(stagingDir);

        Path tmp = Files.createTempFile(stagingDir, "upload-", ".tmp");
        boolean success = false;
        try {
            Files.write(tmp, content, StandardOpenOption.WRITE);
            validate(tmp);

            Path dateDir = acceptedDir.resolve(LocalDate.now().toString());
            Files.createDirectories(dateDir);

            Path finalPath = dateDir.resolve(UUID.randomUUID() + ".bin");
            Files.move(tmp, finalPath, StandardCopyOption.ATOMIC_MOVE);
            success = true;
            return finalPath;
        } finally {
            if (!success) {
                Files.deleteIfExists(tmp);
            }
        }
    }

    private void validate(Path tmp) throws IOException {
        if (Files.size(tmp) == 0L) {
            throw new IOException("Empty upload rejected");
        }
    }
}
```

### 26.4 Important caveat

`StandardCopyOption.ATOMIC_MOVE` can fail if unsupported or if source and target are not on the same filesystem. In serious production code, catch `AtomicMoveNotSupportedException` and decide whether fallback is acceptable.

For upload publish, fallback to non-atomic move may expose partial states, so often fail-fast is safer.

---

## 27. Case Study: File-Based Job Claim

### 27.1 Requirement

Multiple workers scan `inbox`. Only one worker may process each file.

### 27.2 Weak design

```java
if (!Files.exists(processingMarker)) {
    Files.createFile(processingMarker);
    process(file);
}
```

Race-prone.

### 27.3 Better design: atomic marker claim

```java
public boolean tryClaim(Path claimsDir, String jobId) throws IOException {
    Path claim = claimsDir.resolve(jobId + ".claim");
    try {
        Files.createFile(claim);
        return true;
    } catch (FileAlreadyExistsException e) {
        return false;
    }
}
```

### 27.4 Better still: atomic move claim

```text
inbox/job-123.dat
processing/job-123.dat
```

Worker tries:

```java
Files.move(inboxFile, processingFile, StandardCopyOption.ATOMIC_MOVE);
```

If move succeeds, worker owns the file. If file no longer exists, another worker probably claimed it.

This will be covered more deeply in copy/move and workflow architecture parts.

---

## 28. Case Study: Application Bootstrap in Kubernetes

### 28.1 Problem

Java app writes to:

```text
/app/data/tmp
```

In Kubernetes:

- root filesystem may be read-only
- `/tmp` may be ephemeral
- mounted volume may have unexpected UID/GID
- ConfigMap volume may be read-only
- PVC may be shared across replicas

### 28.2 Bad assumption

```java
Path tmp = Files.createTempFile("app-", ".tmp");
```

This may use default temp directory, not the mounted durable workspace.

### 28.3 Better setup

```java
Path workspace = Path.of(System.getenv("APP_WORKSPACE"));
Path tmp = workspace.resolve("tmp");
Path staging = workspace.resolve("staging");

Files.createDirectories(tmp);
Files.createDirectories(staging);
```

Then test startup invariant:

```java
Path probe = Files.createTempFile(tmp, "startup-probe-", ".tmp");
Files.deleteIfExists(probe);
```

This detects permission/config errors early.

---

## 29. Anti-Patterns

### 29.1 `exists` then create

```java
if (!Files.exists(path)) {
    Files.createFile(path);
}
```

Use create and catch conflict.

### 29.2 Manual temp filename

```java
Path tmp = dir.resolve("tmp-" + System.nanoTime());
```

Use `createTempFile`.

### 29.3 Default temp directory for business workflow

```java
Files.createTempFile("report-", ".csv");
```

Use explicit directory near final target.

### 29.4 Create then chmod for secrets

```java
Files.createFile(secret);
Files.setPosixFilePermissions(secret, ownerOnly);
```

Use atomic attributes at create time where supported.

### 29.5 Treat `createDirectories` as transaction

```java
Files.createDirectories(path); // assume all-or-nothing
```

It may partially create parents before failing.

### 29.6 Swallow all `IOException`

```java
catch (IOException ignored) {}
```

Creation failure is state transition failure. It must be classified.

### 29.7 `deleteOnExit` in high-throughput server

It can accumulate unbounded internal state until JVM exit.

---

## 30. Failure Matrix

| Operation | Failure | Meaning | Response |
|---|---|---|---|
| `createFile` | `FileAlreadyExistsException` | name already claimed | expected conflict or error |
| `createFile` | `NoSuchFileException` | parent missing | initialize parent or fail config |
| `createFile` | `AccessDeniedException` | permission/readonly/lock | fail-fast operational issue |
| `createDirectory` | `FileAlreadyExistsException` | name exists | verify if directory if idempotent |
| `createDirectories` | partial creation | some parents created | cleanup or tolerate depending workflow |
| `createTempFile` | `IOException` | temp dir missing/full/inaccessible | fail request or fallback explicit policy |
| `createTempFile` | `UnsupportedOperationException` | attr unsupported | fallback only if security allows |
| `CREATE_NEW + WRITE` | `FileAlreadyExistsException` | target exists | do not overwrite unless explicit |

---

## 31. Production Checklist

Before creating a file/directory, ask:

```text
1. Am I claiming a name, writing content, or initializing layout?
2. Should existing path be success, conflict, or fatal error?
3. Must operation be atomic?
4. Are parent directories trusted?
5. Can parent path contain symlinks?
6. Do I need permission set at create time?
7. Is this local filesystem, network filesystem, container mount, or custom provider?
8. What happens if creation partially succeeds?
9. What happens if process crashes after creation?
10. Who cleans up abandoned temp files/directories?
11. Is default temp directory acceptable?
12. Are error logs sufficient for production diagnosis?
```

---

## 32. Mini Reference: Method Semantics

### `createFile`

```text
Creates empty file.
Fails if name exists.
Parent must exist.
Existence check + create is atomic for directory-affecting operations.
```

### `createDirectory`

```text
Creates one directory.
Fails if name exists.
Parent must exist.
Existence check + create is atomic for directory-affecting operations.
```

### `createDirectories`

```text
Creates all nonexistent parent directories.
Does not fail if target directory already exists.
May partially create parents before failure.
```

### `createTempFile`

```text
Creates new empty uniquely named temp file.
Name construction is implementation dependent.
Returns a file that did not exist before invocation.
Use explicit directory for production workflows.
```

### `createTempDirectory`

```text
Creates new uniquely named temp directory.
Useful for per-job workspace.
Cleanup is caller responsibility.
```

---

## 33. Exercises

### Exercise 1: Replace `exists` then create

Refactor this:

```java
if (!Files.exists(path)) {
    Files.createFile(path);
    return true;
}
return false;
```

Expected answer:

```java
try {
    Files.createFile(path);
    return true;
} catch (FileAlreadyExistsException e) {
    return false;
}
```

### Exercise 2: Secure temp file

Write a method:

```java
Path createPrivateTempFile(Path dir) throws IOException
```

Requirements:

- create parent directory if needed
- create temp file in that directory
- on POSIX, permission `rw-------`
- no manual filename generation

### Exercise 3: Directory bootstrap failure

Given:

```text
root/a exists
root/a/b cannot be created due to permission
```

What can `createDirectories(root/a/b/c)` leave behind?

Answer: it may leave some parent directories created before failure. It is not all-or-nothing.

### Exercise 4: Claim file stale state

Design a stale-claim cleanup policy. Include:

- how to detect stale
- how to avoid deleting active claim
- what metric to emit
- what happens after crash

### Exercise 5: Kubernetes temp directory

Explain why `Files.createTempFile("x", ".tmp")` may be wrong in a pod with read-only root filesystem and PVC mounted at `/data`.

---

## 34. Key Takeaways

1. Create operation is a name-claim operation.
2. `exists` before create is not a correctness mechanism.
3. Use atomic create APIs and handle conflict as part of normal control flow.
4. `createFile` and `createDirectory` are atomic for existence check + creation.
5. `createDirectories` is idempotent but not transactional.
6. Temp files should be created by filesystem APIs, not manual random naming.
7. Default temp directory is convenient but often wrong for production workflows.
8. Set security-sensitive attributes at create time when possible.
9. Parent directories and symlinks are part of the security boundary.
10. Cleanup is a lifecycle design problem, not an afterthought.

---

## 35. References

- Oracle Java SE 25 API — `java.nio.file.Files`
  - `createFile`
  - `createDirectory`
  - `createDirectories`
  - `createTempFile`
  - `createTempDirectory`
- Oracle Java SE 8 API — `java.nio.file.Files`
- Oracle Java SE API — `StandardOpenOption`
- Oracle Java SE API — `FileAttribute`
- Oracle Java SE API — `PosixFilePermissions`

---

## 36. Next Part

Berikutnya:

```text
Part 04 — Open Options and File Handles: How Java Opens Files
```

Kita akan masuk ke cara Java membuka file: `READ`, `WRITE`, `APPEND`, `CREATE`, `CREATE_NEW`, `TRUNCATE_EXISTING`, `DELETE_ON_CLOSE`, `SYNC`, `DSYNC`, serta relasi antara Java stream/channel dengan OS file descriptor/handle.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering-part-02-file-existence-type-identity](./learn-java-io-file-filesystem-storage-engineering-part-02-file-existence-type-identity.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 04  ](./learn-java-io-file-filesystem-storage-engineering-part-04-open-options-file-handles.md)

</div>