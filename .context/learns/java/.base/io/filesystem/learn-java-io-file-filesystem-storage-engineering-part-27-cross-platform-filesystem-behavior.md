# Part 27 — Cross-Platform Filesystem Behavior: Linux, Windows, macOS

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Scope: Java 8 hingga Java 25  
> Level: Advanced / production engineering  
> Fokus: memahami perbedaan perilaku filesystem antar platform agar kode Java file workflow tidak diam-diam hanya benar di satu OS.

---

## 0. Tujuan Bagian Ini

Setelah bagian sebelumnya, kita sudah membahas `Path`, `Files`, creation, open options, read/write, atomic update, copy/move/delete, traversal, link, security, attributes, permission, capacity, watcher, lock, memory-mapped file, structured file, WAL, checksum, naming, archive, `FileSystemProvider`, dan legacy `java.io.File`.

Bagian ini menyatukan semuanya ke satu realitas penting:

> **Java membuat API file terlihat portable, tetapi filesystem behavior tidak sepenuhnya portable.**

Artinya, kode Java yang terlihat benar secara sintaks bisa tetap salah secara produksi ketika dipindah dari:

- Linux developer machine ke Windows laptop QA.
- Windows local test ke Linux container.
- Linux ext4 ke mounted SMB share.
- macOS APFS ke Linux CI.
- Case-insensitive filesystem ke case-sensitive filesystem.
- Local disk ke network filesystem.
- Default provider ke ZIP/custom provider.

Bagian ini bukan sekadar daftar perbedaan OS. Tujuannya adalah membangun **mental model portability**:

```text
portable API
    != portable semantics
    != portable performance
    != portable failure modes
    != portable security behavior
```

Di level top engineer, pertanyaan yang harus muncul bukan hanya:

```java
Files.move(src, dst);
```

Tetapi:

```text
Move ini rename metadata atau copy-delete?
Atomic atau tidak?
Case-sensitive atau tidak?
Target existing behavior bagaimana?
Ada symlink/junction?
Ada file handle terbuka?
Path valid di OS ini?
Permission model kompatibel?
Unicode nama file stabil?
Watcher akan mengirim event yang sama?
```

---

## 1. Core Mental Model: Java API vs Provider vs OS vs Filesystem

Sebagian besar operasi `Files` tidak dieksekusi langsung oleh class `Files` sendiri. Dokumentasi Java menjelaskan bahwa metode dalam `Files` pada umumnya akan mendelegasikan operasi ke **associated file system provider**.

Layer-nya kira-kira seperti ini:

```text
Your code
  |
  v
java.nio.file.Path / Files / FileChannel
  |
  v
FileSystemProvider
  |
  v
JVM native layer / platform adapter
  |
  v
Operating system API
  |
  v
Filesystem implementation
  |
  v
Storage device / network / virtual layer
```

Implikasinya:

1. `Path` adalah object Java, tetapi semantics-nya berasal dari `FileSystem`.
2. `Files` adalah facade, tetapi hasilnya tergantung provider.
3. Provider default berbeda antara Linux, Windows, dan macOS.
4. Filesystem di dalam OS yang sama pun bisa berbeda:
   - Linux: ext4, XFS, Btrfs, tmpfs, NFS mount.
   - Windows: NTFS, ReFS, FAT/exFAT, SMB share.
   - macOS: APFS, HFS+, mounted network volume.
5. Environment runtime juga mempengaruhi:
   - container layer
   - read-only filesystem
   - Kubernetes volume
   - CI ephemeral workspace
   - restricted user permission

Mental model yang benar:

```text
Java gives a common vocabulary.
The filesystem gives the actual contract.
The OS gives the edge cases.
The deployment environment gives the surprises.
```

---

## 2. Jangan Samakan `Path.equals`, String Equality, dan File Identity

Salah satu sumber bug cross-platform adalah menganggap dua path string yang sama berarti file yang sama, atau dua path string berbeda berarti file berbeda.

Contoh:

```java
Path a = Path.of("data/report.txt");
Path b = Path.of("data/./report.txt");

System.out.println(a.equals(b));       // false, lexical comparison
System.out.println(a.normalize().equals(b.normalize())); // true secara lexical setelah normalize
```

Tetapi lexical equality tetap bukan file identity.

Contoh lain:

```text
/tmp/current.log
/tmp/link-to-current.log
```

Keduanya bisa menunjuk ke file fisik yang sama jika salah satunya symlink.

Gunakan:

```java
boolean same = Files.isSameFile(path1, path2);
```

Namun `isSameFile` bisa melakukan filesystem access dan bisa gagal dengan `IOException`.

Mental model:

```text
Path.equals       = lexical/provider-level object equality
normalize         = lexical cleanup
real path         = filesystem-resolved path
isSameFile        = provider/OS-backed identity check
```

Portable code tidak boleh memakai path string sebagai identity final untuk security-sensitive atau correctness-sensitive workflow.

---

## 3. Separator dan Path Syntax: `/`, `\`, Drive, UNC, Root

### 3.1 Unix-like path

Linux/macOS umumnya memakai `/` sebagai separator:

```text
/var/app/data/report.txt
/home/app/input
./relative/path
../parent/path
```

Root:

```text
/
```

Tidak ada drive letter.

### 3.2 Windows path

Windows punya beberapa bentuk:

```text
C:\data\report.txt
C:/data/report.txt
\server\share\folder\file.txt
\\server\share\folder\file.txt
\?\C:\very\long\path
```

Secara praktis, Java sering menerima forward slash pada Windows untuk banyak operasi:

```java
Path p = Path.of("C:/data/report.txt");
```

Tetapi jangan bangun path dengan string concatenation manual:

```java
// buruk
String path = base + "/" + filename;

// lebih benar
Path path = base.resolve(filename);
```

### 3.3 Windows drive-relative ambiguity

Di Windows, path seperti ini berbahaya secara mental model:

```text
C:foo\bar.txt
```

Itu tidak selalu sama dengan:

```text
C:\foo\bar.txt
```

`C:foo` dapat dipahami sebagai path relatif terhadap current directory pada drive `C:`.

Prinsip:

```text
Jangan validasi absolute path Windows hanya dengan regex sederhana.
Gunakan Path API dan uji di OS target.
```

### 3.4 UNC path

UNC path menunjuk network share:

```text
\\server\share\folder\file.txt
```

Sifatnya tidak sama dengan local disk:

- latency lebih tinggi
- availability lebih rendah
- lock behavior bisa berbeda
- atomic rename bisa berbeda tergantung server/protocol
- watcher bisa unreliable

Jangan perlakukan UNC path seperti local ext4.

---

## 4. Case Sensitivity: Salah Satu Perbedaan Paling Berbahaya

### 4.1 Linux umumnya case-sensitive

Di Linux ext4 default:

```text
Report.txt
report.txt
REPORT.TXT
```

bisa menjadi tiga file berbeda.

### 4.2 Windows umumnya case-insensitive, case-preserving

Di Windows NTFS default, nama disimpan dengan case asli, tetapi lookup biasanya case-insensitive:

```text
Report.txt
report.txt
```

biasanya menunjuk file yang sama.

### 4.3 macOS umumnya case-insensitive, tetapi bisa case-sensitive

APFS bisa diformat case-sensitive atau case-insensitive. Banyak instalasi macOS user default case-insensitive, tetapi jangan jadikan itu asumsi universal.

### 4.4 Bug nyata akibat case sensitivity

Contoh bug:

```text
src/main/resources/config.json
src/main/resources/Config.json
```

Di Linux CI, dua file bisa coexist. Di Windows/macOS case-insensitive, conflict bisa terjadi.

Contoh import resource:

```java
getResourceAsStream("/Templates/email.html")
```

Berhasil di local macOS karena filesystem case-insensitive, gagal di Linux container karena file sebenarnya:

```text
templates/email.html
```

### 4.5 Rule production

Untuk artifact portable:

```text
Treat filenames as case-sensitive even if your development machine is not.
```

Praktik:

- Standarkan lowercase untuk storage-generated filename.
- Jangan punya dua logical file yang hanya beda case.
- Di CI, jalankan test path/resource di Linux.
- Untuk user upload, simpan object dengan generated ID, bukan original filename.
- Jangan gunakan case-insensitive comparison sebagai pengganti `isSameFile`.

---

## 5. Reserved Names dan Invalid Characters di Windows

Windows punya aturan nama file yang lebih ketat dari Unix-like system.

Menurut dokumentasi Microsoft, Windows melarang karakter tertentu dalam nama file, termasuk karakter seperti:

```text
< > : " / \ | ? *
```

Windows juga punya nama device reserved seperti:

```text
CON
PRN
AUX
NUL
COM1 ... COM9
LPT1 ... LPT9
```

Masalahnya, variasinya bisa muncul dengan extension:

```text
CON.txt
NUL.json
AUX.csv
COM1.log
```

Di Unix/Linux, nama seperti itu umumnya legal. Jadi file yang valid di Linux belum tentu valid di Windows.

### 5.1 Contoh bug export ZIP

Aplikasi Linux membuat ZIP berisi:

```text
reports/NUL.txt
reports/a:b.txt
reports/customer?.csv
```

Di Linux, archive bisa dibuat. Saat user Windows mengekstrak, file gagal dibuat atau perilakunya aneh.

### 5.2 Defensive filename policy

Untuk file yang mungkin keluar dari sistem dan dikonsumsi lintas OS:

```text
Allowed characters: [a-zA-Z0-9._-]
No trailing dot/space
No reserved Windows device names
Reasonable max length
Normalize Unicode
Generate internal filename separately dari display filename
```

Contoh sanitizer sederhana:

```java
public final class PortableFileNames {
    private static final Set<String> WINDOWS_RESERVED = Set.of(
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    );

    public static String toPortableName(String input) {
        String name = input == null ? "" : input.trim();
        name = java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFC);
        name = name.replaceAll("[<>:\\"/\\\\|?*\\p{Cntrl}]", "_");
        name = name.replaceAll("[ .]+$", "");
        if (name.isBlank()) {
            name = "file";
        }

        String base = name;
        int dot = name.indexOf('.');
        if (dot >= 0) {
            base = name.substring(0, dot);
        }

        if (WINDOWS_RESERVED.contains(base.toUpperCase(java.util.Locale.ROOT))) {
            name = "_" + name;
        }

        if (name.length() > 120) {
            name = name.substring(0, 120);
        }
        return name;
    }
}
```

Catatan: sanitizer ini bukan validasi security lengkap. Untuk upload, tetap gunakan generated storage name.

---

## 6. Path Length: Masih Bisa Menjadi Masalah

### 6.1 Windows `MAX_PATH`

Dokumentasi Microsoft masih menjelaskan konsep `MAX_PATH` 260 karakter pada banyak Windows API, meskipun Windows modern punya mekanisme opt-in untuk long paths.

Implikasinya:

- Java modern bisa lebih baik, tetapi aplikasi lain yang mengonsumsi file mungkin tidak.
- Tooling seperti zip extractor, antivirus, legacy app, shell script, dan build tool bisa gagal.
- File yang valid dalam service bisa gagal saat diekspor ke user.

### 6.2 Linux/macOS component limit

Unix-like system biasanya punya batas:

- panjang satu komponen nama file
- panjang total path

Tetapi nilainya tergantung filesystem.

### 6.3 Rule

Jangan hanya membatasi total path. Batasi juga:

```text
single filename length
relative path depth
total generated path length
```

Contoh:

```java
public static void validateReasonablePortablePath(Path relative) {
    if (relative.isAbsolute()) {
        throw new IllegalArgumentException("Path must be relative");
    }
    if (relative.getNameCount() > 20) {
        throw new IllegalArgumentException("Path depth too large");
    }
    for (Path part : relative) {
        String s = part.toString();
        if (s.length() > 120) {
            throw new IllegalArgumentException("Path component too long: " + s.length());
        }
    }
    if (relative.toString().length() > 700) {
        throw new IllegalArgumentException("Relative path too long");
    }
}
```

Untuk internal storage, lebih baik gunakan layout terkontrol:

```text
/storage/ab/cd/<uuid-or-hash>.bin
```

daripada menyimpan path user mentah.

---

## 7. Hidden File: Unix Dotfile vs DOS Hidden Attribute

Di Unix-like system, file tersembunyi umumnya hanya convention:

```text
.env
.gitignore
.ssh
```

Nama dimulai dengan titik.

Di Windows, hidden adalah attribute:

```text
DOS hidden attribute
```

Java menyediakan:

```java
boolean hidden = Files.isHidden(path);
```

Tetapi behavior-nya platform/provider-specific.

Implikasi:

```text
Do not implement security by relying on hidden file semantics.
```

Hidden file hanya UI/visibility convention, bukan access control.

---

## 8. Permission Model: POSIX Mode vs Windows ACL

Linux/macOS Unix-like model biasanya punya:

```text
owner / group / others
read / write / execute
```

Java expose melalui:

```java
PosixFileAttributes
PosixFilePermission
Files.getPosixFilePermissions(path)
Files.setPosixFilePermissions(path, perms)
```

Tetapi Windows permission model berbasis ACL. Java expose melalui:

```java
AclFileAttributeView
```

Tidak semua filesystem/provider mendukung POSIX attribute.

Kode seperti ini bisa gagal di Windows:

```java
Set<PosixFilePermission> perms = Files.getPosixFilePermissions(path);
```

Gunakan capability check:

```java
FileStore store = Files.getFileStore(path);
boolean supportsPosix = store.supportsFileAttributeView("posix");
boolean supportsAcl = store.supportsFileAttributeView("acl");
```

Prinsip desain:

```text
Do not make POSIX permission the only enforcement layer for a portable Java app.
```

Untuk aplikasi enterprise:

- OS permission = defense-in-depth.
- Authorization = aplikasi/domain layer.
- Storage isolation = directory/container/user boundary.
- Audit = application-level and platform-level.

---

## 9. Execute Permission dan Directory Traversal

Di POSIX, execute bit pada directory berarti kemampuan untuk traverse/search directory.

Contoh:

```text
drwx------ app app /secure
```

User lain tidak bisa masuk ke `/secure`.

File permission saja tidak cukup jika parent directory tidak dapat ditraverse.

Bug umum:

```text
File permission terlihat readable,
tetapi aplikasi gagal baca karena parent directory tidak punya execute permission.
```

Pada Windows, modelnya ACL, bukan mode bit sederhana.

Prinsip:

```text
Akses file adalah hasil dari seluruh chain path, bukan hanya leaf file.
```

---

## 10. Delete Semantics: Unix Unlink vs Windows Handle Restriction

Ini salah satu perbedaan paling sering menyebabkan bug.

### 10.1 Unix-like behavior

Di Unix-like system, delete file pada dasarnya menghapus directory entry atau unlink.

Jika file masih dibuka proses lain:

```text
nama file hilang dari directory,
tetapi data tetap ada sampai handle terakhir ditutup.
```

Jadi ini bisa berhasil:

```java
Path p = Path.of("data.log");
InputStream in = Files.newInputStream(p);
Files.delete(p); // pada Unix-like sering bisa berhasil
```

File tidak lagi terlihat di directory, tetapi proses yang memegang handle masih bisa membaca.

### 10.2 Windows behavior

Di Windows, file yang masih dibuka sering tidak bisa dihapus/diubah tergantung sharing mode/handle.

Akibatnya test di Linux bisa pass, tetapi Windows gagal dengan:

```text
AccessDeniedException
```

### 10.3 Rule

Selalu close resource sebelum delete/move:

```java
try (InputStream in = Files.newInputStream(path)) {
    // read
}
Files.delete(path);
```

Jangan rely pada Unix unlink semantics untuk aplikasi portable.

---

## 11. Rename/Move Semantics: Bukan Selalu Sama

`Files.move(source, target, options...)` terlihat portable, tetapi semantics-nya bergantung pada:

- same filesystem atau cross filesystem
- directory atau file
- target exists atau tidak
- open handle
- symlink
- filesystem support terhadap atomic move
- OS locking semantics

### 11.1 Same filesystem rename

Pada local filesystem, move dalam filesystem yang sama sering berupa rename metadata.

```text
cheap
fast
potentially atomic
```

### 11.2 Cross-filesystem move

Jika source dan target ada di filesystem berbeda, move bisa berubah menjadi:

```text
copy bytes → delete source
```

Ini tidak atomic.

### 11.3 `ATOMIC_MOVE`

Gunakan:

```java
Files.move(temp, target,
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING);
```

Tetapi jika atomic move tidak didukung, Java bisa melempar:

```java
AtomicMoveNotSupportedException
```

Rule:

```text
ATOMIC_MOVE is a requirement request, not a universal guarantee.
```

### 11.4 Windows target open

Di Windows, target yang sedang dibuka proses lain bisa membuat replace/move gagal.

### 11.5 Portable pattern

Untuk config/checkpoint update:

```text
write temp in same directory
force data
atomic move
handle AtomicMoveNotSupportedException explicitly
```

Jangan silently fallback ke non-atomic move untuk data critical tanpa mengubah recovery model.

---

## 12. File Locking Semantics Berbeda Antar Platform

Dari Part 18:

```text
Java FileLock is held on behalf of the JVM, not one Java thread.
```

Cross-platform issue:

- advisory vs mandatory behavior system-dependent
- shared lock bisa tidak didukung dan berubah menjadi exclusive
- lock behavior pada network filesystem bisa tidak reliable
- Windows lebih ketat terhadap open/delete/rename conflict
- Unix advisory lock tidak mencegah proses lain yang tidak ikut protokol

Rule:

```text
File lock is only valid if every participant agrees to the same locking protocol.
```

Untuk distributed multi-node workflow, prefer:

- database row lock
- transactional outbox
- message queue ownership
- Redis lease dengan fencing token
- object storage conditional write

File lock lokal bukan distributed coordinator universal.

---

## 13. Symbolic Links, Junctions, Reparse Points

### 13.1 Unix symlink

Symlink adalah directory entry yang menunjuk ke path lain.

```text
link -> /real/location
```

Symlink bisa relative atau absolute.

### 13.2 Windows symlink/junction/reparse point

Windows punya konsep reparse point, junction, symlink, mount point. Beberapa tampak seperti directory, tetapi traversal-nya bisa keluar dari root yang diasumsikan.

### 13.3 Security impact

Kode seperti ini tidak cukup:

```java
Path candidate = base.resolve(userInput).normalize();
if (!candidate.startsWith(base)) throw new SecurityException();
```

Karena path bisa tampak berada di `base`, tetapi salah satu parent adalah symlink/junction keluar.

Untuk containment sensitive:

```java
Path realBase = base.toRealPath(LinkOption.NOFOLLOW_LINKS);
Path realCandidate = candidate.toRealPath();
if (!realCandidate.startsWith(realBase)) {
    throw new SecurityException("Escapes base directory");
}
```

Tetapi ini pun harus dipahami terhadap TOCTOU race jika attacker bisa mutate directory tree setelah check.

Rule:

```text
Cross-platform safe path handling must treat links as active attack surface.
```

---

## 14. Unicode Filename Normalization: Karakter Sama, Bytes Berbeda

Unicode memungkinkan satu karakter yang tampak sama direpresentasikan dengan code point berbeda.

Contoh konseptual:

```text
é = U+00E9
é = e + combining acute accent
```

Secara visual sama, secara byte/code point berbeda.

### 14.1 Linux

Banyak Linux filesystem tidak melakukan Unicode normalization khusus. Dua nama yang tampak sama bisa coexist jika byte berbeda.

### 14.2 macOS

Historically, HFS+ melakukan normalisasi varian NFD. APFS memiliki behavior berbeda; OpenJDK bug tracker mencatat macOS 10.13 mengganti default filesystem dari HFS+ ke APFS dan HFS+ menormalisasi nama file ke varian Apple dari Unicode NFD, sedangkan APFS tidak melakukan normalization yang sama.

### 14.3 Windows

Windows umumnya memakai Unicode API, tetapi case-insensitivity dan normalization/collation detail tidak boleh diasumsikan sama dengan Java `String.equals`.

### 14.4 Impact

Bug:

- file duplicate tampak sama di UI
- hash manifest berdasarkan filename gagal match
- upload user dari macOS berbeda dengan Linux
- ZIP dibuat di satu OS diekstrak berbeda di OS lain
- database key nama file tidak match filesystem entry

### 14.5 Rule

Untuk logical filename:

```java
String logicalName = Normalizer.normalize(inputName, Normalizer.Form.NFC);
```

Namun jangan jadikan normalized name sebagai storage identity. Lebih aman:

```text
storage id  = UUID/hash/server-generated
display name = original sanitized name
logical key = normalized application-level name jika dibutuhkan
```

---

## 15. Newline Differences: Text File Bukan Selalu Sama

Linux/macOS:

```text
LF \n
```

Windows historically:

```text
CRLF \r\n
```

Java text APIs bisa membaca line secara abstrak:

```java
Files.lines(path, StandardCharsets.UTF_8)
```

Tetapi saat menghasilkan file yang dikonsumsi external tool:

- CSV untuk Windows Excel
- shell script untuk Linux
- config file untuk legacy tool
- Git working tree

newline bisa menjadi masalah.

Rule:

```text
Internal processing: normalize line endings.
External output: choose explicit line ending based on contract.
```

Contoh:

```java
String unix = content.replace("\r\n", "\n").replace("\r", "\n");
```

Untuk file yang harus punya platform default line separator:

```java
String nl = System.lineSeparator();
```

Tetapi jangan gunakan `System.lineSeparator()` untuk protocol format yang mensyaratkan newline tertentu.

---

## 16. Charset Default: Java Version dan OS Bisa Mempengaruhi

Walaupun seri ini bukan seri charset, cross-platform file text tidak bisa menghindari charset.

Rule utama:

```text
Always specify Charset for persistent files.
```

Buruk:

```java
Files.readString(path); // default charset behavior bergantung API/version
```

Lebih eksplisit:

```java
Files.readString(path, StandardCharsets.UTF_8);
```

Java 18 memperkenalkan UTF-8 sebagai default charset via JEP 400, tetapi jika kita menarget Java 8–25, jangan mengandalkan default charset agar behavior sama.

Prinsip:

```text
Persistent text file format must declare charset.
```

---

## 17. Timestamp Semantics: Precision, Resolution, Clock, dan Update Behavior

File timestamp tampak sederhana:

```text
creation time
last modified time
last access time
```

Tetapi cross-platform berbeda dalam:

- attribute availability
- timestamp precision
- timestamp resolution
- update policy
- timezone display
- access time disabled/lazy update
- network filesystem clock behavior

Contoh bug:

```java
if (Files.getLastModifiedTime(file).toMillis() > lastSeenMillis) {
    process(file);
}
```

Jika filesystem timestamp resolution kasar, dua update cepat bisa punya timestamp sama.

Rule:

```text
Timestamp is useful for hint and ordering approximation, not always a reliable change identity.
```

Untuk robust change detection:

- combine timestamp + size + content hash
- use monotonic application sequence if possible
- use manifest/checkpoint
- do reconciliation scan

---

## 18. Directory Ordering: Tidak Dijamin Sama

`Files.list`, `DirectoryStream`, `walk`, dan traversal lain tidak menjamin ordering yang sama antar filesystem/provider.

Jangan tulis logic seperti:

```java
Path first = Files.list(dir).findFirst().orElseThrow();
```

kecuali memang tidak peduli urutan.

Jika butuh deterministic:

```java
try (Stream<Path> stream = Files.list(dir)) {
    List<Path> files = stream
            .sorted(Comparator.comparing(p -> p.getFileName().toString()))
            .toList();
}
```

Untuk Java 8:

```java
try (Stream<Path> stream = Files.list(dir)) {
    List<Path> files = stream
            .sorted(Comparator.comparing(p -> p.getFileName().toString()))
            .collect(Collectors.toList());
}
```

Tetapi sorting jutaan file punya memory cost. Untuk scale besar, gunakan batching/pagination strategy atau external index.

---

## 19. Directory Scale: Banyak File Dalam Satu Directory Berbeda Dampaknya

Filesystem modern bisa menangani banyak file, tetapi performance tetap bervariasi.

Masalah umum:

- listing directory lambat
- metadata lookup mahal
- deletion massal lambat
- backup/antivirus/indexer memperburuk performa
- Windows Explorer/tooling bisa melambat
- network share makin berat

Storage layout lebih baik:

```text
bad:
/storage/files/<one-million-files>

good:
/storage/files/ab/cd/<id>.bin
/storage/files/ef/12/<id>.bin
```

Contoh sharding by hash:

```java
public static Path shard(Path root, String hexHash) {
    return root.resolve(hexHash.substring(0, 2))
               .resolve(hexHash.substring(2, 4))
               .resolve(hexHash);
}
```

Portable performance membutuhkan layout yang tidak bergantung pada satu filesystem kuat.

---

## 20. Sparse File, Holes, dan Disk Usage

File size logical tidak selalu sama dengan disk blocks yang dipakai.

Contoh:

```java
try (FileChannel ch = FileChannel.open(path,
        StandardOpenOption.CREATE,
        StandardOpenOption.WRITE,
        StandardOpenOption.SPARSE)) {
    ch.position(1L << 30); // 1 GiB offset
    ch.write(ByteBuffer.wrap(new byte[] {1}));
}
```

File bisa tampak berukuran besar, tetapi disk usage aktual kecil jika filesystem mendukung sparse file.

Cross-platform caveat:

- `SPARSE` hanya hint.
- Tidak semua filesystem mendukung.
- Copy tool bisa mengubah sparse menjadi full allocated file.
- Backup/archive bisa memperbesar ukuran nyata.

Rule:

```text
Do not use Files.size() as disk usage metric.
```

Untuk disk usage nyata, Java standard API tidak selalu memberi informasi portable yang cukup.

---

## 21. Inode dan File Identity di Unix vs Windows File ID

Di Unix-like system, file identity sering dipahami sebagai:

```text
device id + inode
```

Hard link berarti beberapa directory entry menunjuk inode yang sama.

Windows punya file ID/handle semantics berbeda.

Java memberi abstraction:

```java
Object key = Files.readAttributes(path, BasicFileAttributes.class).fileKey();
```

Tetapi:

- `fileKey()` bisa `null`
- bentuknya provider-specific
- tidak portable untuk disimpan sebagai format jangka panjang

Rule:

```text
fileKey is useful for cycle detection / local identity hint, not portable business identity.
```

---

## 22. File Store dan Mount Boundary

Di Unix, path tree tunggal bisa berisi banyak filesystem mount:

```text
/
/var
/var/lib/app
/mnt/shared
```

Di Windows:

```text
C:\
D:\
\\server\share
```

Di macOS:

```text
/
/Volumes/ExternalDisk
```

Java:

```java
FileStore store = Files.getFileStore(path);
```

Caveat:

- path yang terlihat berdekatan bisa berada di file store berbeda
- atomic move mungkin gagal across store
- capacity/permission/attribute berbeda per store
- mounted network volume punya semantics berbeda

Rule:

```text
Atomic file workflow should keep temp and final target in same directory or at least same FileStore.
```

Bahkan same `FileStore` pun bukan absolute guarantee untuk semua operation, tetapi ini baseline praktis.

---

## 23. WatchService Cross-Platform Behavior

Dari Part 17:

```text
WatchService events are hints, not truth.
```

Cross-platform variance:

- Linux biasanya memakai inotify-like backend.
- Windows memakai Windows directory change notification mechanism.
- macOS implementation detail berbeda dan historically bisa kurang ideal untuk recursive workflows.
- Network filesystem event bisa hilang/tidak dikirim.
- Event coalescing berbeda.
- Rename bisa muncul sebagai delete+create.
- Modify bisa muncul berkali-kali.

Portable watcher design:

```text
watch events → debounce → scan directory → compare actual state → process idempotently
```

Jangan desain:

```text
on ENTRY_CREATE event langsung percaya file complete dan langsung parse
```

Karena writer mungkin masih menulis file.

Lebih aman:

```text
producer writes temp
producer atomic moves to ready name
consumer scans ready names
consumer claims by rename
```

---

## 24. File Completion Detection Berbeda Antar OS

Cara naif:

```java
long size1 = Files.size(file);
Thread.sleep(1000);
long size2 = Files.size(file);
if (size1 == size2) process(file);
```

Masalah:

- writer bisa idle sementara
- buffering bisa belum flushed
- network filesystem visibility delay
- timestamp resolution berbeda
- Windows lock bisa membantu mendeteksi open file, Unix tidak selalu

Portable contract lebih baik:

```text
Producer writes file.tmp
Producer fsync/close
Producer renames file.tmp -> file.ready
Consumer only reads *.ready
```

Kalau tidak bisa mengubah producer, gunakan quarantine delay + retry + checksum/manifest jika tersedia.

---

## 25. Open Options Cross-Platform Caveat

Beberapa `StandardOpenOption` punya caveat:

### 25.1 `APPEND`

`APPEND` menulis ke akhir file, tetapi atomicity append terhadap writer lain adalah system-dependent.

Rule:

```text
Do not assume multi-process append gives record-level atomicity for structured logs.
```

Gunakan single writer, file lock protocol, queue, atau append-only segment ownership.

### 25.2 `SYNC` / `DSYNC`

`SYNC` dan `DSYNC` meminta synchronous write, tetapi efektivitasnya tergantung OS/filesystem/storage.

Rule:

```text
force/sync reduces risk; it does not turn every storage stack into perfect durable media.
```

### 25.3 `DELETE_ON_CLOSE`

Delete-on-close behavior bisa best-effort dan implementation-specific. Jangan rely sebagai satu-satunya cleanup untuk critical data.

---

## 26. `java.io.File.delete()` Behavior Change di JDK 25 pada Windows

JDK 25 membawa perubahan penting untuk `java.io.File.delete()` pada Windows: untuk regular file dengan DOS read-only attribute, `File.delete()` sekarang gagal dan mengembalikan `false`; sebelumnya JDK dapat menghapus read-only attribute terlebih dahulu sebelum delete, tetapi itu bukan operasi atomic.

Implikasi untuk Java 8–25:

```text
Kode legacy java.io.File.delete() dapat berbeda behavior antara JDK lama dan JDK 25 di Windows.
```

Rekomendasi:

- Prefer `Files.delete(path)` untuk error yang jelas via exception.
- Jika memakai `File.delete()`, jangan abaikan boolean result.
- Test behavior di JDK target.
- Jangan menganggap read-only attribute akan otomatis dihapus.

Contoh lebih baik:

```java
try {
    Files.delete(path);
} catch (AccessDeniedException e) {
    // log explicit permission/attribute problem
    throw e;
}
```

---

## 27. Testing Cross-Platform: Jangan Tunggu Production

Minimal test matrix untuk file-heavy Java library/service:

```text
Linux + Java 8 baseline jika support Java 8
Linux + Java 17/21/25 target runtime
Windows + target Java
macOS jika developer/user workflow menyentuh file lokal
```

Untuk CI praktis:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    java: [8, 17, 21]
```

Jika target Java 25, tambahkan job Java 25 sesuai availability CI.

### 27.1 Test cases penting

Buat test eksplisit untuk:

- filename dengan spasi
- filename Unicode
- filename berbeda case
- reserved Windows names
- very long filename
- symlink/junction jika environment mendukung
- delete open file
- move replace target
- hidden file
- permission denied
- directory traversal
- archive extraction
- timestamp quick update
- directory ordering
- file watcher overflow/reconciliation

### 27.2 Test helper untuk asumsi OS

```java
public final class OsInfo {
    private static final String OS = System.getProperty("os.name").toLowerCase(Locale.ROOT);

    public static boolean isWindows() {
        return OS.contains("win");
    }

    public static boolean isMac() {
        return OS.contains("mac");
    }

    public static boolean isLinux() {
        return OS.contains("linux");
    }
}
```

Tetapi jangan isi business logic dengan terlalu banyak `if (isWindows())` kecuali memang boundary OS-specific. Lebih baik abstract capability:

```java
public record FileSystemCapabilities(
        boolean posixPermissions,
        boolean acl,
        boolean symbolicLinks,
        boolean atomicMoveLikely,
        boolean caseSensitiveLikely
) {}
```

---

## 28. Portable Filename Policy untuk Enterprise Java

Untuk sistem backend enterprise, pisahkan:

```text
Original filename  = nama dari user/client
Display filename   = versi sanitized untuk UI/download
Storage filename   = generated safe id
Logical filename   = normalized name untuk business rule jika dibutuhkan
```

Contoh layout:

```text
/storage/upload/2026/06/18/ab/cd/018f6d5a-...-payload.bin
/storage/upload/2026/06/18/ab/cd/018f6d5a-...-metadata.json
```

Metadata:

```json
{
  "id": "018f6d5a-...",
  "originalName": "résumé FINAL (1).pdf",
  "displayName": "resume-final-1.pdf",
  "contentTypeClaimed": "application/pdf",
  "contentTypeDetected": "application/pdf",
  "sha256": "...",
  "size": 123456,
  "createdAt": "2026-06-18T10:15:30Z"
}
```

Kenapa ini penting:

- original filename bisa invalid di OS tertentu
- original filename bisa mengandung traversal
- original filename bisa berubah normalization
- original filename bisa duplicate
- original filename bisa reserved Windows name
- original filename bukan identity

---

## 29. Cross-Platform File Workflow Pattern

Misal kita ingin membuat file intake portable.

### 29.1 Directory layout

```text
root/
  incoming/
  staging/
  ready/
  processing/
  done/
  error/
```

### 29.2 Producer

```text
write to staging/<id>.tmp
close
compute checksum
write metadata
atomic move staging/<id>.tmp -> ready/<id>.bin
atomic move metadata tmp -> ready/<id>.json
```

### 29.3 Consumer

```text
scan ready directory
claim by atomic move ready/<id>.bin -> processing/<id>.bin
process idempotently
move to done or error
```

### 29.4 Cross-platform safety

- Generated ASCII storage filename.
- Temp and final same directory/file store when possible.
- No reliance on directory ordering.
- No reliance on watcher as truth.
- No reliance on case-insensitive behavior.
- Close handles before move/delete.
- Explicit charset for metadata.
- Avoid original filename as path.
- Validate symlink escape.
- Reconciliation job after crash.

---

## 30. Practical Java Utility: Detect Basic Environment Characteristics

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.util.*;

public final class FileSystemProbe {
    public static Result probe(Path dir) throws IOException {
        Files.createDirectories(dir);

        FileStore store = Files.getFileStore(dir);
        boolean posix = store.supportsFileAttributeView("posix");
        boolean acl = store.supportsFileAttributeView("acl");
        boolean dos = store.supportsFileAttributeView("dos");

        boolean caseSensitive = probeCaseSensitivity(dir);
        boolean atomicMove = probeAtomicMove(dir);
        boolean symlink = probeSymlink(dir);

        return new Result(
                dir.toAbsolutePath().normalize().toString(),
                store.name(),
                store.type(),
                posix,
                acl,
                dos,
                caseSensitive,
                atomicMove,
                symlink
        );
    }

    private static boolean probeCaseSensitivity(Path dir) throws IOException {
        Path a = Files.createTempFile(dir, "CaseProbe", ".tmp");
        Path b = a.resolveSibling(a.getFileName().toString().toUpperCase(Locale.ROOT));
        try {
            return !Files.exists(b) || !Files.isSameFile(a, b);
        } finally {
            Files.deleteIfExists(a);
            // Do not delete b blindly; on case-insensitive FS it may be same as a.
        }
    }

    private static boolean probeAtomicMove(Path dir) throws IOException {
        Path src = Files.createTempFile(dir, "move-src", ".tmp");
        Path dst = src.resolveSibling(src.getFileName() + ".dst");
        try {
            Files.move(src, dst, StandardCopyOption.ATOMIC_MOVE);
            return Files.exists(dst);
        } catch (AtomicMoveNotSupportedException e) {
            return false;
        } finally {
            Files.deleteIfExists(src);
            Files.deleteIfExists(dst);
        }
    }

    private static boolean probeSymlink(Path dir) throws IOException {
        Path target = Files.createTempFile(dir, "target", ".tmp");
        Path link = target.resolveSibling(target.getFileName() + ".link");
        try {
            Files.createSymbolicLink(link, target.getFileName());
            return Files.isSymbolicLink(link);
        } catch (UnsupportedOperationException | FileSystemException | SecurityException e) {
            return false;
        } finally {
            Files.deleteIfExists(link);
            Files.deleteIfExists(target);
        }
    }

    public record Result(
            String directory,
            String fileStoreName,
            String fileStoreType,
            boolean posixAttributes,
            boolean aclAttributes,
            boolean dosAttributes,
            boolean caseSensitive,
            boolean atomicMoveWithinDirectory,
            boolean symbolicLinkCreation
    ) {}
}
```

Java 8 version tanpa `record`:

```java
public final class ProbeResult {
    public final String directory;
    public final String fileStoreName;
    public final String fileStoreType;
    public final boolean posixAttributes;
    public final boolean aclAttributes;
    public final boolean dosAttributes;
    public final boolean caseSensitive;
    public final boolean atomicMoveWithinDirectory;
    public final boolean symbolicLinkCreation;

    public ProbeResult(
            String directory,
            String fileStoreName,
            String fileStoreType,
            boolean posixAttributes,
            boolean aclAttributes,
            boolean dosAttributes,
            boolean caseSensitive,
            boolean atomicMoveWithinDirectory,
            boolean symbolicLinkCreation) {
        this.directory = directory;
        this.fileStoreName = fileStoreName;
        this.fileStoreType = fileStoreType;
        this.posixAttributes = posixAttributes;
        this.aclAttributes = aclAttributes;
        this.dosAttributes = dosAttributes;
        this.caseSensitive = caseSensitive;
        this.atomicMoveWithinDirectory = atomicMoveWithinDirectory;
        this.symbolicLinkCreation = symbolicLinkCreation;
    }
}
```

Catatan penting:

```text
Probe is not a proof forever.
It only observes current environment characteristics.
Filesystem may be remounted, policy may change, network share may behave differently under failure.
```

---

## 31. Failure Matrix Cross-Platform

| Scenario | Linux | Windows | macOS | Portable assumption |
|---|---:|---:|---:|---|
| `Report.txt` vs `report.txt` | biasanya beda | biasanya sama | biasanya sama, bisa beda | jangan punya nama hanya beda case |
| delete open file | sering bisa unlink | sering gagal | Unix-like, sering bisa | close sebelum delete |
| move/replace open target | sering bisa tergantung scenario | sering gagal | Unix-like, sering bisa | close handle, retry bounded |
| POSIX permission | umum | tidak native | umum Unix-like | capability check |
| ACL | berbeda | native | berbeda | provider-specific |
| hidden file | dot convention | DOS attribute | dot convention/Finder metadata | jangan untuk security |
| symlink | umum | perlu privilege/policy tertentu | umum | handle unsupported |
| reserved names | sedikit | banyak | sedikit | enforce portable names |
| path length | filesystem-dependent | legacy MAX_PATH issue | filesystem-dependent | limit generated path |
| watcher | inotify-like | Windows-specific | provider-specific | event as hint only |
| Unicode normalization | biasanya raw | Windows-specific | HFS+/APFS caveat | normalize logical name |
| atomic move | often if same FS | possible but handle-sensitive | often if same FS | catch exception |

---

## 32. Design Heuristics untuk Top 1% Engineer

### 32.1 Treat filesystem as a concurrent external system

Filesystem bukan private memory. Ia bisa berubah karena:

- proses lain
- thread lain
- OS cleanup
- antivirus
- backup agent
- user manual operation
- network disconnection
- container restart
- mounted volume behavior

Jangan desain dengan asumsi dunia diam antara `exists` dan `open`.

### 32.2 Treat path as untrusted data unless generated by your system

Path dari user, archive, config, request, atau database lama harus dianggap untrusted.

### 32.3 Treat portability as a requirement, not hope

Jika aplikasi harus berjalan di Linux production tetapi developer memakai Windows/macOS, test di Linux harus wajib.

Jika artifact dikonsumsi user Windows, validasi nama file Windows walaupun server Linux.

### 32.4 Prefer capability detection over OS guessing

Daripada:

```java
if (isWindows()) { ... }
```

lebih baik:

```java
if (fileStore.supportsFileAttributeView("posix")) { ... }
```

Namun OS-specific rules tetap dibutuhkan untuk hal seperti reserved Windows names ketika membuat export portable.

### 32.5 Separate logical identity from filesystem location

Jangan jadikan path sebagai primary key domain.

Gunakan:

```text
id → metadata → storage path
```

bukan:

```text
path string = identity
```

---

## 33. Anti-Patterns

### Anti-pattern 1 — Manual path concatenation

```java
String p = base + "/" + userFileName;
```

Masalah:

- separator
- traversal
- absolute override
- duplicate slash
- UNC/drive path weirdness

Gunakan `Path.resolve` dan validasi containment.

---

### Anti-pattern 2 — Menganggap local macOS sama dengan Linux production

Case-insensitive macOS bisa menyembunyikan bug resource path.

Solusi:

- test di Linux CI
- enforce filename case convention
- use containerized test

---

### Anti-pattern 3 — Menggunakan original filename sebagai storage filename

```text
/uploads/<original-user-filename>
```

Masalah:

- traversal
- duplicate
- Unicode ambiguity
- Windows reserved names
- invalid chars
- privacy leakage
- path length

Gunakan generated name.

---

### Anti-pattern 4 — Mengandalkan watcher event sebagai source of truth

Watcher bisa overflow/hilang/coalesce.

Solusi:

```text
watcher triggers reconciliation scan
```

---

### Anti-pattern 5 — Mengabaikan result `File.delete()`

```java
file.delete(); // ignored
```

Gunakan:

```java
Files.delete(path);
```

atau minimal cek boolean.

---

### Anti-pattern 6 — Menyimpan logical equality dengan `String.equals` filename mentah

Masalah:

- case-insensitive filesystem
- Unicode normalization
- locale issue

Solusi:

- normalize logical names
- use Locale.ROOT for case folding if needed
- still store generated identity

---

## 34. Checklist Cross-Platform Sebelum Production

### Path and naming

- [ ] Tidak ada path string concatenation manual untuk operasi filesystem.
- [ ] User filename tidak langsung menjadi storage path.
- [ ] Filename policy aman untuk Windows jika file bisa diekspor.
- [ ] Reserved Windows names dicegah.
- [ ] Trailing space/dot dicegah untuk portable output.
- [ ] Unicode logical name dinormalisasi.
- [ ] Case-only duplicate dicegah jika artifact cross-platform.

### Operation semantics

- [ ] Semua resource ditutup sebelum delete/move.
- [ ] `Files.delete` dipakai untuk error eksplisit.
- [ ] `ATOMIC_MOVE` failure ditangani.
- [ ] Temp file dibuat di same directory/file store untuk atomic update.
- [ ] Cross-filesystem move tidak diasumsikan atomic.
- [ ] `APPEND` tidak diasumsikan record-atomic multi-writer.

### Security

- [ ] Containment check tidak hanya pakai lexical normalize.
- [ ] Symlink/junction escape dipertimbangkan.
- [ ] Archive extraction aman dari Zip Slip.
- [ ] Hidden file tidak dianggap security boundary.
- [ ] Permission model tidak diasumsikan POSIX-only.

### Runtime

- [ ] Test berjalan di OS target.
- [ ] CI mencakup minimal Linux; tambah Windows/macOS jika artifact lokal user penting.
- [ ] Capability check untuk POSIX/ACL/DOS attributes.
- [ ] Path length dan component length dibatasi.
- [ ] Directory scale tidak bergantung pada jutaan file flat.

### Observability

- [ ] Log exception class spesifik (`AccessDeniedException`, `NoSuchFileException`, dll.).
- [ ] Log provider/store/type saat debugging file incident.
- [ ] Metrics untuk operation latency, failure reason, retry, disk capacity.
- [ ] Reconciliation job tersedia untuk watcher/crash recovery.

---

## 35. Mini Case Study: Bug yang Hanya Muncul di Production Linux

### Situation

Developer memakai macOS default case-insensitive. Aplikasi Spring Boot membaca template:

```java
Path template = templatesDir.resolve("EmailWelcome.html");
```

File repository sebenarnya:

```text
emailwelcome.html
```

Local test pass. Docker Linux production gagal:

```text
NoSuchFileException: /app/templates/EmailWelcome.html
```

### Root cause

Kode bergantung pada case-insensitive lookup.

### Fix minimal

Samakan nama file dan reference.

### Fix sistemik

- enforce lowercase naming convention untuk resource file
- test resource loading di Linux CI
- add startup validation yang memeriksa required file exact name
- avoid manually typed filenames; define constants/generate manifest

---

## 36. Mini Case Study: Windows Export Gagal Karena `CON.txt`

### Situation

Backend Linux menerima upload file dengan original name:

```text
CON.txt
```

Server menyimpan dan mengekspor ZIP. User Windows tidak bisa ekstrak dengan benar.

### Root cause

Nama valid di Linux tetapi reserved di Windows.

### Fix

- Storage name generated.
- Export display name sanitized untuk Windows portability.
- Metadata tetap menyimpan original filename untuk audit.

Example:

```text
originalName: CON.txt
exportName: _CON.txt
storageName: 018f...bin
```

---

## 37. Mini Case Study: Delete Pass di Linux, Fail di Windows

### Situation

Test cleanup:

```java
InputStream in = Files.newInputStream(path);
Files.delete(path);
```

Linux pass. Windows fail.

### Root cause

Open file handle behavior berbeda. Unix-like unlink semantics memungkinkan directory entry dihapus walau handle masih open. Windows sering menolak delete file yang sedang digunakan.

### Fix

```java
try (InputStream in = Files.newInputStream(path)) {
    // use stream
}
Files.delete(path);
```

Sistemik:

- enforce try-with-resources
- run tests on Windows if library supports Windows
- fail build on resource leak patterns if possible

---

## 38. Java 8–25 Compatibility Notes

### `Path.of` vs `Paths.get`

Java 8 belum punya `Path.of`. Gunakan:

```java
Path p = Paths.get("data", "file.txt");
```

Java 11+ / modern:

```java
Path p = Path.of("data", "file.txt");
```

Untuk materi seri ini, jika contoh memakai `Path.of`, Java 8 equivalent-nya adalah `Paths.get`.

### `Files.readString` / `writeString`

Tidak tersedia di Java 8. Gunakan:

```java
byte[] bytes = Files.readAllBytes(path);
String s = new String(bytes, StandardCharsets.UTF_8);
```

atau buffered reader/writer.

### `Stream.toList()`

Tidak tersedia di Java 8. Gunakan collector:

```java
.collect(Collectors.toList())
```

### `record`

Tidak tersedia di Java 8. Gunakan final class/POJO.

### `CRC32C`

Tersedia sejak Java 9. Untuk Java 8, gunakan `CRC32` atau library lain jika CRC32C diperlukan.

### Security Manager

Untuk Java modern, jangan desain file sandbox dengan mengandalkan Security Manager. Java 24 menonaktifkan Security Manager secara permanen melalui JEP 486. Gunakan OS/container/application-level isolation.

---

## 39. Summary Mental Model

Cross-platform filesystem engineering bukan berarti “menulis kode yang tidak pernah punya OS-specific branch”. Yang benar adalah:

```text
1. Use Java NIO API for common abstraction.
2. Know which semantics are not guaranteed.
3. Detect provider/filesystem capability where possible.
4. Avoid using filesystem-specific behavior as business invariant.
5. Design workflow with explicit handoff, generated names, atomic boundaries, and recovery.
6. Test on the OS/filesystem combinations that matter.
```

Jika harus diringkas:

```text
Path is lexical until resolved.
File identity is not string identity.
Filename portability is harder than it looks.
Delete/rename/open behavior differs by OS.
Permission model differs by OS and provider.
Watcher is not a transaction log.
Atomic operation is conditional, not universal.
Original filename is not storage identity.
Test on real target platforms.
```

---

## 40. Practical Exercises

### Exercise 1 — Case sensitivity probe

Buat test yang membuat file `CaseTest.txt`, lalu cek apakah `casetest.txt` dianggap sama.

Pertanyaan:

- Apa hasilnya di Linux?
- Apa hasilnya di Windows?
- Apa hasilnya di macOS Anda?

### Exercise 2 — Delete open file

Buat file, buka `InputStream`, lalu coba delete sebelum close.

Pertanyaan:

- OS mana yang mengizinkan?
- Exception apa yang muncul?
- Bagaimana membuat test portable?

### Exercise 3 — Portable filename sanitizer

Implementasikan sanitizer yang:

- menolak traversal separator
- mengganti invalid Windows characters
- mencegah reserved device names
- membatasi panjang nama
- melakukan Unicode NFC normalization

### Exercise 4 — Atomic move probe

Buat temp file di directory yang sama, lalu move dengan `ATOMIC_MOVE`.

Pertanyaan:

- Apakah berhasil di local disk?
- Apakah berhasil di mounted network directory?
- Apa fallback policy yang aman untuk data non-critical dan critical?

### Exercise 5 — Cross-platform CI

Tambahkan test file behavior pada:

```text
ubuntu-latest
windows-latest
macos-latest
```

Minimal test:

- path resolution
- invalid filename
- delete open file
- case sensitivity
- symlink support
- permission/attribute support

---

## 41. References

1. Oracle Java SE 25, `java.nio.file.Files`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html
2. Oracle Java SE 8, `java.nio.file.Files`: https://docs.oracle.com/javase/8/docs/api/java/nio/file/Files.html
3. Oracle Java SE 25, `java.io.File`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/File.html
4. Microsoft Learn, Naming Files, Paths, and Namespaces: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
5. Microsoft Learn, Maximum Path Length Limitation: https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
6. Apple Developer Archive, File System Basics: https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html
7. Apple Developer Archive, APFS FAQ: https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html
8. OpenJDK Bug JDK-8289689, macOS/APFS Unicode normalization note: https://bugs.openjdk.org/browse/JDK-8289689
9. Inside Java, Changes in Some File Operation Behaviors on Windows: https://inside.java/2025/06/16/quality-heads-up/
10. JEP 486, Permanently Disable the Security Manager: https://openjdk.org/jeps/486

---

## 42. Closing

Bagian ini adalah jembatan dari API-level mastery menuju environment-level mastery.

Engineer biasa bertanya:

```text
Bagaimana cara membaca/menulis/menghapus file di Java?
```

Engineer senior bertanya:

```text
Apa invariant operasi file ini jika dijalankan di Linux container,
Windows client,
macOS developer machine,
network filesystem,
case-insensitive volume,
dan Java version berbeda?
```

Top engineer bertanya lebih jauh:

```text
Invariant apa yang tidak boleh saya serahkan ke filesystem?
Apa yang harus saya jadikan kontrak aplikasi sendiri?
Bagaimana recovery jika filesystem memberi sinyal parsial, terlambat, atau berbeda antar platform?
```

Itulah pergeseran mental yang dibutuhkan untuk membangun sistem file workflow yang benar-benar production-grade.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 26](./learn-java-io-file-filesystem-storage-engineering-part-26-legacy-java-io-file-interop-migration-compatibility.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 28 — Containers, Cloud Runtime, Kubernetes Volumes, and Ephemeral Files](./learn-java-io-file-filesystem-storage-engineering-part-28-containers-cloud-runtime-kubernetes-volumes-ephemeral-files.md)

</div>