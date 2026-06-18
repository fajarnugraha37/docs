# Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Scope: Java 8–25  
> Focus: symbolic link, hard link, Windows junction/reparse point, link traversal, loop, link-safe filesystem programming, dan security implication.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan tidak lagi melihat link sebagai detail kecil filesystem, melainkan sebagai **lapisan indirection yang bisa mengubah meaning dari path operation**.

Kamu akan memahami:

1. Perbedaan konseptual antara:
   - symbolic link,
   - hard link,
   - Windows junction / reparse point,
   - normal file,
   - directory entry,
   - target file.
2. Mengapa `Path` bukan file dan bukan jaminan target final.
3. Mengapa operasi seperti read, write, copy, move, delete, attribute read, dan traversal bisa berbeda behavior ketika path adalah link.
4. Cara menggunakan:
   - `Files.isSymbolicLink(...)`
   - `Files.createSymbolicLink(...)`
   - `Files.createLink(...)`
   - `Files.readSymbolicLink(...)`
   - `LinkOption.NOFOLLOW_LINKS`
   - `FileVisitOption.FOLLOW_LINKS`
   - `FileSystemLoopException`
5. Cara mendesain kode Java yang aman dari:
   - symlink traversal attack,
   - symlink swap race,
   - recursive loop,
   - accidental delete/copy target,
   - privilege boundary bypass.
6. Kapan sebaiknya mengikuti link, tidak mengikuti link, atau memperlakukan link sebagai data yang harus ditolak.

---

## 1. Kenapa Link Adalah Topik Advance?

Banyak engineer berpikir file operation seperti ini sederhana:

```java
Path p = base.resolve(userInput).normalize();
Files.readString(p);
```

Masalahnya: path tersebut bisa menunjuk ke **symbolic link** yang mengarah ke luar `base`.

Contoh:

```text
/app/uploads/user-123/avatar.png -> /etc/passwd
```

Secara string, path masih terlihat berada di bawah `/app/uploads/user-123`.

Namun saat dibuka, filesystem bisa mengarahkan operasi ke target lain.

Itulah sebabnya link adalah topik advance: link memisahkan **nama yang kamu lihat** dari **objek filesystem yang akhirnya disentuh**.

Mental model yang salah:

```text
Path == file final
```

Mental model yang benar:

```text
Path == sequence of names interpreted by a FileSystemProvider.
Each name lookup may encounter indirection.
The final operation may affect the link object or the target object depending on API/options.
```

---

## 2. Vocabulary Dasar

### 2.1 Path

`Path` adalah representasi nama/lokasi dalam filesystem.

Ia belum tentu exist.

Ia belum tentu menunjuk file biasa.

Ia belum tentu menunjuk target yang sama dari waktu ke waktu.

```java
Path p = Path.of("/data/current/report.csv");
```

`p` hanya representasi nama.

---

### 2.2 Directory Entry

Directory berisi mapping dari nama ke objek filesystem.

Contoh konseptual:

```text
/data/current -> inode/object #9001
/data/latest  -> symlink object #9100 -> /mnt/archive/2026/report.csv
```

Directory entry bisa menunjuk:

- file biasa,
- directory,
- symbolic link,
- special file,
- device,
- reparse point,
- dan tipe lain tergantung OS/filesystem.

---

### 2.3 Symbolic Link

Symbolic link adalah file khusus yang berisi referensi path ke target.

Contoh:

```text
latest.csv -> 2026-06-18.csv
```

Target bisa:

- absolute path,
- relative path,
- existing file,
- non-existing file,
- file,
- directory,
- path di filesystem lain.

Symbolic link sering disebut:

- symlink,
- soft link.

Java menyediakan:

```java
Files.createSymbolicLink(link, target);
Files.readSymbolicLink(link);
Files.isSymbolicLink(path);
```

Penting: symbolic link bisa menjadi **dangling**.

```text
latest.csv -> missing.csv
```

Link ada, target tidak ada.

---

### 2.4 Hard Link

Hard link adalah directory entry tambahan yang menunjuk ke file object yang sama.

Contoh konseptual:

```text
/data/a.txt -> inode #100
/data/b.txt -> inode #100
```

`a.txt` dan `b.txt` bukan “satu asli satu shortcut”. Keduanya nama yang setara untuk objek file yang sama.

Java menyediakan:

```java
Files.createLink(link, existing);
```

Hard link berbeda dari symbolic link:

| Aspek | Symbolic Link | Hard Link |
|---|---|---|
| Berisi path target | Ya | Tidak |
| Bisa dangling | Ya | Tidak normalnya |
| Bisa lintas filesystem | Biasanya bisa secara path, tergantung target saat resolve | Umumnya tidak |
| Bisa menunjuk directory | Tergantung OS, biasanya restricted | Umumnya tidak untuk user biasa |
| Target bisa berpindah | Link tetap berisi path lama | Tetap menunjuk object yang sama |
| Delete salah satu nama | Link/nama itu hilang | Object tetap ada selama masih ada link lain |

---

### 2.5 Windows Junction / Reparse Point

Di Windows, ada konsep reparse point. Junction adalah salah satu bentuk directory indirection.

Dari sudut pandang aplikasi Java, junction bisa tampak seperti directory, link-like object, atau special filesystem object tergantung provider dan operasi.

Implikasinya:

- jangan mengasumsikan semua link-like object di Windows sama dengan POSIX symlink;
- jangan mengandalkan satu metode legacy seperti canonical path untuk semua kasus;
- lakukan testing di Windows jika produkmu harus portable.

---

## 3. Model Resolusi Path dengan Link

Misalkan:

```text
/base
  /safe
    file.txt
  /escape -> /etc
```

Path:

```text
/base/escape/passwd
```

Resolusi konseptual:

```text
1. lookup /base
2. lookup escape
3. escape adalah symlink ke /etc
4. lanjut lookup passwd di /etc
5. final target: /etc/passwd
```

Artinya, meskipun path string dimulai dengan `/base`, target final bisa berada di luar `/base`.

Inilah inti masalah path containment.

---

## 4. Java API untuk Link

### 4.1 `Files.isSymbolicLink(Path)`

```java
boolean link = Files.isSymbolicLink(path);
```

Digunakan untuk mengecek apakah path itu symbolic link.

Namun ini hanya snapshot saat check dilakukan.

Anti-pattern:

```java
if (!Files.isSymbolicLink(path)) {
    Files.delete(path);
}
```

Kenapa salah?

Karena antara check dan delete, attacker/proses lain bisa mengganti path menjadi symlink.

```text
check: path bukan symlink
race: path diganti symlink
use: operasi menyentuh sesuatu yang berbeda
```

Ini TOCTOU.

---

### 4.2 `Files.createSymbolicLink(Path link, Path target, FileAttribute<?>... attrs)`

```java
Path link = Path.of("/data/latest.csv");
Path target = Path.of("2026-06-18.csv");
Files.createSymbolicLink(link, target);
```

Catatan penting:

- Ini optional operation. Tidak semua filesystem/provider mendukung.
- Bisa gagal karena permission.
- Pada beberapa OS, membuat symlink butuh privilege khusus.
- Target tidak harus exist pada saat link dibuat.
- Jika `target` relative, interpretasinya relative terhadap lokasi link, bukan necessarily working directory yang kamu pikirkan saat membaca nanti.

Contoh relative target:

```text
/data/latest.csv -> 2026-06-18.csv
```

Target final:

```text
/data/2026-06-18.csv
```

Bukan:

```text
<process-working-directory>/2026-06-18.csv
```

---

### 4.3 `Files.readSymbolicLink(Path link)`

```java
Path target = Files.readSymbolicLink(Path.of("/data/latest.csv"));
System.out.println(target);
```

Ini membaca isi link, bukan membaca file target.

Jika link berisi relative path, hasilnya juga relative path.

```text
latest.csv -> 2026-06-18.csv
```

Maka:

```java
target.toString(); // "2026-06-18.csv"
```

Untuk menginterpretasikan target relative terhadap parent link:

```java
Path link = Path.of("/data/latest.csv");
Path rawTarget = Files.readSymbolicLink(link);
Path resolvedTarget = link.getParent().resolve(rawTarget).normalize();
```

Namun `normalize()` tetap lexical, belum resolve symlink lain.

---

### 4.4 `Files.createLink(Path link, Path existing)`

```java
Path existing = Path.of("/data/a.txt");
Path link = Path.of("/data/b.txt");
Files.createLink(link, existing);
```

Ini membuat hard link.

Konsekuensi:

```text
a.txt dan b.txt menunjuk file object yang sama.
```

Jika kamu menulis via `b.txt`, isi yang terlihat lewat `a.txt` ikut berubah karena sebenarnya object-nya sama.

Hard link sering berbahaya untuk sistem yang mengasumsikan satu file punya satu nama.

Contoh bug:

```text
quota dihitung per path
retention delete per path
integrity check per path
```

Padahal dua path bisa menunjuk object yang sama.

Gunakan `Files.isSameFile(a, b)` untuk mengecek identity, tetapi ingat operasi ini sendiri bisa membutuhkan akses filesystem dan bisa dipengaruhi race.

---

## 5. `NOFOLLOW_LINKS`: Option Kecil, Efek Besar

`LinkOption.NOFOLLOW_LINKS` berarti operasi tidak mengikuti symbolic link untuk operasi yang mendukung option tersebut.

Contoh:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);
```

Tanpa `NOFOLLOW_LINKS`:

```text
path symlink -> baca attributes target
```

Dengan `NOFOLLOW_LINKS`:

```text
path symlink -> baca attributes link object
```

Ini penting saat kamu ingin tahu:

- path itu link atau bukan,
- ukuran link object,
- last modified link,
- delete/copy link sebagai link,
- audit filesystem tanpa mengikuti link.

---

## 6. Default Java Behavior terhadap Symbolic Link

Secara umum, banyak operasi Java mengikuti symlink secara default, kecuali operasi tertentu seperti delete/move link itu sendiri atau operasi diberi `NOFOLLOW_LINKS`.

Mental model praktis:

| Operasi | Default Link Behavior |
|---|---|
| `Files.isRegularFile(path)` | Follow link ke target |
| `Files.isDirectory(path)` | Follow link ke target |
| `Files.size(path)` | Biasanya target |
| `Files.readAttributes(path, BasicFileAttributes.class)` | Follow link |
| `Files.readAttributes(..., NOFOLLOW_LINKS)` | Link object |
| `Files.copy(source, target)` | Source link biasanya diikuti kecuali `NOFOLLOW_LINKS` |
| `Files.delete(path)` | Menghapus link object, bukan target |
| `Files.move(path, target)` | Memindahkan link object sebagai directory entry |
| `Files.walkFileTree(start, visitor)` | Tidak follow link default |
| `walkFileTree(... FOLLOW_LINKS ...)` | Follow link dan harus handle cycle |

Catatan: detail bisa provider-specific. Selalu baca kontrak API yang dipakai.

---

## 7. Symbolic Link dan Attribute Reading

### 7.1 Membaca Attribute Target

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class
);
```

Jika `path` symlink ke regular file, `attrs.isRegularFile()` bisa true.

---

### 7.2 Membaca Attribute Link Itu Sendiri

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

if (attrs.isSymbolicLink()) {
    System.out.println("This path is a symbolic link");
}
```

---

### 7.3 Kenapa `isSymbolicLink` Saja Tidak Cukup?

Karena `isSymbolicLink(path)` adalah check terpisah.

Lebih baik membaca attribute dan mengambil keputusan dari satu syscall/provider operation jika memungkinkan:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);

if (attrs.isSymbolicLink()) {
    // decide policy
}
```

Tetap tidak sepenuhnya menghilangkan race jika operasi berikutnya membuka path lagi.

Tetapi setidaknya mengurangi redundant lookup dan membuat reasoning lebih jelas.

---

## 8. Link dan Delete Semantics

Misalkan:

```text
/data/latest.csv -> /archive/2026-06-18.csv
```

Jika kamu menjalankan:

```java
Files.delete(Path.of("/data/latest.csv"));
```

Yang dihapus adalah link `/data/latest.csv`, bukan `/archive/2026-06-18.csv`.

Ini biasanya behavior yang diinginkan.

Namun recursive delete bisa berbahaya jika traversal mengikuti symlink.

---

## 9. Link dan Copy Semantics

Misalkan:

```text
source/link.txt -> /secret/data.txt
```

Copy default biasanya mengikuti source link.

```java
Files.copy(sourceLink, target);
```

Hasilnya bisa berupa copy dari isi target.

Jika ingin copy link sebagai link:

```java
Files.copy(sourceLink, target, LinkOption.NOFOLLOW_LINKS);
```

Tetapi support dan behavior bisa bergantung provider.

Dalam backup/audit/export tool, keputusan ini harus eksplisit:

```text
Policy A: follow symlink and copy target content
Policy B: copy symlink object as symlink
Policy C: reject symlink
Policy D: record symlink metadata only
```

Jangan biarkan default menentukan security semantics.

---

## 10. Link dan Move Semantics

`Files.move(link, target)` biasanya memindahkan directory entry/link object, bukan memindahkan target.

Contoh:

```text
before:
/data/latest -> /archive/current
```

```java
Files.move(Path.of("/data/latest"), Path.of("/tmp/latest"));
```

Hasil:

```text
/tmp/latest -> /archive/current
```

Target `/archive/current` tidak dipindahkan.

Ini penting untuk cleanup, deployment, dan release symlink pattern.

---

## 11. Link dan Directory Traversal

By default:

```java
Files.walkFileTree(root, visitor);
```

tidak mengikuti symbolic link.

Jika kamu ingin mengikuti link:

```java
Files.walkFileTree(
    root,
    EnumSet.of(FileVisitOption.FOLLOW_LINKS),
    Integer.MAX_VALUE,
    visitor
);
```

Masalahnya: link bisa membuat cycle.

Contoh:

```text
/root/a/b/back -> /root/a
```

Traversal yang mengikuti link bisa masuk loop:

```text
/root/a/b/back/b/back/b/back/...
```

Java menyediakan `FileSystemLoopException` untuk kondisi loop yang terdeteksi.

Dalam `FileVisitor`, biasanya muncul di `visitFileFailed`.

Contoh:

```java
Files.walkFileTree(
    root,
    EnumSet.of(FileVisitOption.FOLLOW_LINKS),
    Integer.MAX_VALUE,
    new SimpleFileVisitor<>() {
        @Override
        public FileVisitResult visitFileFailed(Path file, IOException exc) throws IOException {
            if (exc instanceof FileSystemLoopException) {
                System.err.println("Loop detected: " + file);
                return FileVisitResult.SKIP_SUBTREE;
            }
            throw exc;
        }
    }
);
```

Production rule:

```text
Do not enable FOLLOW_LINKS unless you have a clear reason and a loop/error policy.
```

---

## 12. Symbolic Link Loop: Apa yang Sebenarnya Terjadi?

Contoh:

```text
/tmp/root/a -> /tmp/root/b
/tmp/root/b -> /tmp/root/a
```

Resolusi:

```text
a -> b -> a -> b -> ...
```

OS/filesystem biasanya memiliki batas jumlah symlink traversal.

Java dapat menerima error dari OS/provider.

Dalam file tree traversal, Java dapat mendeteksi cycle dan melaporkan `FileSystemLoopException`.

Jangan mengandalkan infinite traversal berhenti sendiri secara elegan. Selalu punya:

- max depth,
- loop handling,
- link policy,
- timeout/cancellation untuk job besar,
- observability.

---

## 13. Link Policy: Tiga Mode Utama

Setiap aplikasi file serius harus punya link policy eksplisit.

### 13.1 Reject Links

Cocok untuk:

- upload user,
- archive extraction,
- multi-tenant storage,
- security-sensitive config,
- compliance evidence storage.

Policy:

```text
If path component or final path is symlink, reject.
```

Kelemahan:

- bisa membatasi use case legitimate.
- sulit memeriksa semua ancestor dengan aman tanpa race jika attacker bisa mutate directory.

---

### 13.2 Preserve Links

Cocok untuk:

- backup tools,
- filesystem mirror,
- build cache export,
- packaging tools.

Policy:

```text
Treat symlink as symlink metadata.
Do not follow target content.
```

Output menyimpan:

- link path,
- raw target string,
- relative/absolute target,
- timestamp/permission jika relevan.

---

### 13.3 Follow Links

Cocok untuk:

- content resolver,
- deployment current-version pointer,
- read-only internal trusted tree,
- compatibility with Unix filesystem layout.

Policy:

```text
Follow symlink intentionally.
Validate final real target.
Handle loops.
Handle target missing.
```

Risiko:

- path escape,
- loop,
- unexpected large traversal,
- crossing filesystem boundary,
- security boundary bypass.

---

## 14. Secure Path Containment dengan Link

Misalkan aplikasi hanya boleh membaca file di bawah:

```text
/srv/app/uploads
```

Naive approach:

```java
Path base = Path.of("/srv/app/uploads");
Path requested = base.resolve(userInput).normalize();

if (!requested.startsWith(base)) {
    throw new SecurityException("Path escape");
}

return Files.readString(requested);
```

Masalah:

```text
/srv/app/uploads/profile/avatar.png -> /etc/passwd
```

`requested.startsWith(base)` true secara lexical.

Tetapi read menyentuh `/etc/passwd`.

---

## 15. Better Containment: Resolve Real Path

Untuk existing file:

```java
Path base = Path.of("/srv/app/uploads").toRealPath();
Path requested = base.resolve(userInput).normalize();
Path realRequested = requested.toRealPath();

if (!realRequested.startsWith(base)) {
    throw new SecurityException("Path escapes base directory");
}

return Files.readString(realRequested);
```

Ini lebih baik karena `toRealPath()` resolve symlink dan menghasilkan path real.

Namun masih ada caveat:

1. File harus exist.
2. Ada race antara validation dan use.
3. Jika attacker bisa mutate directory setelah check, target bisa berubah.
4. `startsWith` harus dilakukan pada `Path`, bukan string mentah.
5. Case sensitivity dan provider behavior bisa mempengaruhi portability.

---

## 16. TOCTOU: Symlink Swap Race

Contoh:

```java
Path real = requested.toRealPath();
if (!real.startsWith(baseReal)) {
    throw new SecurityException();
}
Files.readString(requested); // BUG: opens original requested path again
```

Race:

```text
1. requested -> safe.txt
2. validation passes
3. attacker replaces requested with symlink -> /etc/passwd
4. Files.readString(requested) follows symlink
```

Lebih baik:

```java
Path real = requested.toRealPath();
if (!real.startsWith(baseReal)) {
    throw new SecurityException();
}
Files.readString(real);
```

Ini mengurangi risiko karena open dilakukan pada resolved real path.

Tetapi jika `real` itu sendiri kemudian diganti melalui parent path race, masih ada isu di threat model tinggi.

Untuk security boundary yang benar-benar kuat, dibutuhkan approach berbasis directory handle / `SecureDirectoryStream` jika tersedia, atau isolasi OS-level.

---

## 17. `SecureDirectoryStream`: Konsep Penting

Java NIO memiliki `SecureDirectoryStream`, yang didesain untuk operasi relatif terhadap directory yang sudah dibuka, sehingga lebih aman terhadap race pada directory entries.

Namun:

- tidak semua provider mendukung,
- penggunaan lebih kompleks,
- jarang dipakai di aplikasi bisnis biasa,
- tetap butuh policy yang jelas.

Mental model:

```text
Path-based API:
  lookup name each time -> vulnerable to swap race

Directory-handle-based API:
  operate relative to already-open directory handle -> safer
```

Kita tidak akan mendalami implementasi penuh di part ini, tetapi ini penting untuk security-sensitive filesystem code.

---

## 18. Safe File Upload Policy terhadap Link

Untuk upload file biasa dari user, idealnya user tidak diberi kesempatan membuat symlink di storage aplikasi.

Pattern aman:

```text
1. Jangan pakai original filename sebagai path storage final.
2. Generate server-side random storage name.
3. Simpan di directory yang tidak writable langsung oleh user/proses lain.
4. Create file dengan CREATE_NEW.
5. Jangan follow symlink dari user-provided path.
6. Validate base real path.
7. Simpan original filename sebagai metadata, bukan sebagai path authority.
```

Contoh:

```java
Path storageDir = Path.of("/srv/app/uploads").toRealPath();
String storageName = UUID.randomUUID() + ".bin";
Path target = storageDir.resolve(storageName);

try (OutputStream out = Files.newOutputStream(
        target,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    input.transferTo(out);
}
```

Kenapa aman relatif lebih baik?

- Target name tidak dikontrol user.
- `CREATE_NEW` gagal jika path sudah ada, termasuk jika sudah ada symlink dengan nama itu.
- Directory storage harus dikontrol aplikasi.

---

## 19. Link-Safe Archive Extraction

Archive extraction adalah salah satu area paling berbahaya.

Masalah umum:

```text
entry name: ../../../../etc/passwd
```

Masalah link yang lebih advance:

```text
archive contains:
  dir/link -> /etc
  dir/link/passwd
```

Jika extractor membuat symlink lalu menulis `dir/link/passwd`, ia bisa menulis ke `/etc/passwd`.

Policy aman untuk archive dari sumber tidak terpercaya:

```text
1. Reject absolute entry path.
2. Reject entry with .. after normalization.
3. Resolve under extraction root.
4. Reject symlink entries, or store as inert metadata.
5. Ensure parent directories are not symlinks if writing files.
6. Use CREATE_NEW where possible.
7. After write, optionally verify real path still under root.
```

Simplified extraction guard:

```java
static Path safeResolve(Path root, String entryName) throws IOException {
    Path normalized = root.resolve(entryName).normalize();
    if (!normalized.startsWith(root)) {
        throw new SecurityException("Archive entry escapes root: " + entryName);
    }
    return normalized;
}
```

Tetapi untuk link attack, ini belum cukup jika parent path bisa symlink.

Tambahkan policy:

```text
For untrusted archives: reject symlink entries entirely.
```

---

## 20. Hard Link Security Implication

Hard link tidak terlihat seperti symlink.

`Files.isSymbolicLink(path)` false.

Namun hard link bisa menyebabkan dua path menunjuk file yang sama.

Contoh:

```text
/uploads/a.dat -> inode #100
/uploads/b.dat -> inode #100
```

Jika aplikasi menghapus `a.dat`, `b.dat` masih mempertahankan file object.

Jika aplikasi mengubah permission/isi via `a.dat`, perubahan terlihat via `b.dat`.

Risiko:

- quota bypass,
- retention bypass,
- tamper via alternate path,
- duplicate processing,
- mistaken ownership.

Mitigasi:

- Jangan izinkan user membuat hard link di storage managed app.
- Gunakan storage directory dengan permission controlled.
- Gunakan random server-side filename.
- Jika perlu identity check, gunakan `Files.isSameFile` atau platform-specific file key dari attributes.

Contoh membaca file key:

```java
BasicFileAttributes attrs = Files.readAttributes(
    path,
    BasicFileAttributes.class,
    LinkOption.NOFOLLOW_LINKS
);
Object fileKey = attrs.fileKey();
```

`fileKey()` bisa null, provider-specific, dan tidak portable sebagai business key.

---

## 21. Deployment Pattern: `current` Symlink

Unix deployment sering memakai symlink:

```text
/app/releases/2026-06-18-001
/app/releases/2026-06-18-002
/app/current -> /app/releases/2026-06-18-002
```

Switch release:

```text
/app/current_tmp -> /app/releases/2026-06-18-003
rename current_tmp to current
```

Manfaat:

- fast switch,
- rollback mudah,
- release directory immutable,
- aplikasi membaca path stable `/app/current`.

Risiko:

- proses yang sudah membuka file lama tetap membaca file lama,
- current symlink update tidak sama dengan restart service,
- relative symlink harus benar,
- watcher bisa melihat event berbeda tergantung OS,
- Windows portability buruk.

Dalam Java app:

```java
Path current = Path.of("/app/current");
Path realCurrent = current.toRealPath();
```

Jika app butuh consistent release root, resolve sekali saat startup dan gunakan `realCurrent`, bukan resolve `/app/current` berulang-ulang secara tidak sadar.

---

## 22. Config Reload dan Symlink

Config management tools sering update config dengan atomic symlink switch atau atomic rename.

Contoh Kubernetes ConfigMap volume juga bisa menggunakan mekanisme symlink internal pada beberapa implementasi.

Implikasi untuk Java:

- File watcher mungkin melihat perubahan pada symlink/directory, bukan file final.
- Membuka path yang sama setelah reload bisa membaca target berbeda.
- Menyimpan `Path` tidak menyimpan target object.
- Menyimpan open stream/channel bisa tetap membaca target lama.

Pattern:

```text
1. Treat config path as dynamic pointer.
2. On reload event, re-open file.
3. Validate config fully before replacing in-memory config.
4. Keep previous valid config on parse failure.
5. Log real path and file metadata for observability.
```

---

## 23. Link dan Observability

Saat logging file operation, jangan hanya log input path.

Untuk debugging link issue, log:

```text
- input path
- normalized path
- real path if resolved
- isSymbolicLink(final path with NOFOLLOW)
- raw symlink target if applicable
- fileKey if available
- filesystem/provider if relevant
```

Contoh:

```java
static void logPathDebug(Path path) throws IOException {
    System.out.println("input=" + path);
    System.out.println("absolute=" + path.toAbsolutePath());
    System.out.println("normalized=" + path.toAbsolutePath().normalize());

    if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)) {
        BasicFileAttributes attrs = Files.readAttributes(
            path,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );
        System.out.println("isSymlink=" + attrs.isSymbolicLink());
        System.out.println("fileKey=" + attrs.fileKey());

        if (attrs.isSymbolicLink()) {
            System.out.println("rawTarget=" + Files.readSymbolicLink(path));
        }
    }

    try {
        System.out.println("realPath=" + path.toRealPath());
    } catch (IOException e) {
        System.out.println("realPath=<unresolved: " + e.getClass().getSimpleName() + ">");
    }
}
```

Jangan log full path jika mengandung data sensitif tenant/user tanpa sanitasi.

---

## 24. Link dan Testing

### 24.1 JUnit Test dengan Symlink

```java
@Test
void detectsSymlink() throws IOException {
    Path dir = Files.createTempDirectory("link-test-");
    Path target = Files.writeString(dir.resolve("target.txt"), "hello");
    Path link = dir.resolve("link.txt");

    Files.createSymbolicLink(link, target.getFileName());

    assertTrue(Files.isSymbolicLink(link));
    assertEquals("hello", Files.readString(link));
    assertEquals(target.getFileName(), Files.readSymbolicLink(link));
}
```

Catatan:

- Di Windows, symlink creation bisa gagal karena privilege/configuration.
- Test harus bisa skip jika operation unsupported.

```java
try {
    Files.createSymbolicLink(link, target.getFileName());
} catch (UnsupportedOperationException | IOException e) {
    // In real test use Assumptions.assumeTrue(false, ...)
}
```

---

### 24.2 Test Path Escape via Symlink

```java
@Test
void symlinkCanEscapeLexicalBase() throws IOException {
    Path base = Files.createTempDirectory("base-");
    Path outside = Files.createTempDirectory("outside-");
    Path secret = Files.writeString(outside.resolve("secret.txt"), "secret");

    Path link = base.resolve("link");
    Files.createSymbolicLink(link, outside);

    Path requested = base.resolve("link/secret.txt").normalize();

    assertTrue(requested.startsWith(base));
    assertEquals(secret.toRealPath(), requested.toRealPath());
}
```

Test ini membuktikan bahwa lexical containment tidak cukup.

---

## 25. Robust Link Policy Utility

Contoh utility untuk membaca existing file hanya jika real target tetap di bawah base.

```java
public final class SafeFiles {
    private final Path baseReal;

    public SafeFiles(Path base) throws IOException {
        this.baseReal = base.toRealPath();
    }

    public String readExistingUtf8(String relativeInput) throws IOException {
        Path candidate = baseReal.resolve(relativeInput).normalize();
        Path real = candidate.toRealPath();

        if (!real.startsWith(baseReal)) {
            throw new SecurityException("Path escapes base directory");
        }

        if (!Files.isRegularFile(real)) {
            throw new IOException("Not a regular file: " + real);
        }

        return Files.readString(real, StandardCharsets.UTF_8);
    }
}
```

Limitasi:

- Only for existing files.
- Tidak menyelesaikan semua TOCTOU dalam hostile writable directory.
- Tidak cocok jika attacker bisa mutate base directory.
- Lebih aman jika base directory hanya writable oleh aplikasi trusted.

---

## 26. Safer Write Under Base

Untuk membuat file baru dari user input, jangan resolve arbitrary user path jika tidak perlu.

Lebih baik:

```java
public Path createManagedFile(Path storageDirReal, InputStream in) throws IOException {
    String name = UUID.randomUUID() + ".bin";
    Path target = storageDirReal.resolve(name);

    try (OutputStream out = Files.newOutputStream(
            target,
            StandardOpenOption.CREATE_NEW,
            StandardOpenOption.WRITE)) {
        in.transferTo(out);
    }

    return target;
}
```

Jika harus menerima relative path, validasi ketat:

```java
static Path resolveForCreate(Path baseReal, String relativeInput) {
    Path input = Path.of(relativeInput);

    if (input.isAbsolute()) {
        throw new SecurityException("Absolute path not allowed");
    }

    for (Path part : input) {
        String s = part.toString();
        if (s.equals(".") || s.equals("..") || s.isBlank()) {
            throw new SecurityException("Unsafe path segment: " + s);
        }
    }

    Path candidate = baseReal.resolve(input).normalize();
    if (!candidate.startsWith(baseReal)) {
        throw new SecurityException("Path escapes base");
    }
    return candidate;
}
```

Namun tetap pastikan parent directory tidak attacker-controlled.

---

## 27. Link Attack Scenario: Upload Storage Shared dengan User

Scenario buruk:

```text
/app/uploads is writable by web user and by another local process.
```

Aplikasi:

```java
Path target = uploads.resolve(userId).resolve("avatar.png");
if (!Files.exists(target)) {
    Files.write(target, bytes);
}
```

Attacker:

```text
create symlink /app/uploads/123/avatar.png -> /app/config/application.yml
```

Aplikasi menulis avatar, tetapi yang terkena adalah config.

Mitigasi:

```text
- storage directory tidak boleh writable oleh untrusted process
- generate filename sendiri
- gunakan CREATE_NEW
- validate parent directories
- jangan follow symlink untuk policy tertentu
- gunakan OS/container permission
```

---

## 28. Link Attack Scenario: Recursive Delete

Naive recursive delete dengan follow symlink:

```java
Files.walkFileTree(
    root,
    EnumSet.of(FileVisitOption.FOLLOW_LINKS),
    Integer.MAX_VALUE,
    deletingVisitor
);
```

Jika ada:

```text
root/user-data/link -> /important
```

Traversal bisa masuk `/important`.

Even if `Files.delete(link)` itself deletes the link, traversal yang mengikuti link dapat mengunjungi target children.

Policy aman untuk cleanup untrusted tree:

```text
Do not FOLLOW_LINKS.
Delete symlink object as file-like entry.
Never recursively delete symlink target.
```

---

## 29. Link Attack Scenario: Backup Tool Membocorkan Data

Backup tool:

```text
backup /home/app/uploads
```

Jika mengikuti symlink:

```text
/home/app/uploads/debug -> /var/log/private
```

Backup bisa memasukkan private logs.

Policy harus jelas:

```text
Backup mode:
- preserve symlink as symlink
- or reject symlink crossing root
- or follow only if target real path remains under root
```

---

## 30. Cross-Platform Caveats

### 30.1 Linux/Unix

- Symlink umum.
- Deleting symlink deletes link, not target.
- Hard link umum untuk file biasa.
- Directory hard link biasanya restricted.
- Permission model POSIX.

### 30.2 Windows

- Symlink behavior berbeda secara privilege dan type.
- Junction/reparse point perlu perhatian khusus.
- File deletion/open handle semantics berbeda dari Unix.
- Case-insensitive path umum.
- Some Java link operations can fail depending on developer mode, privileges, filesystem, or policy.

### 30.3 macOS

- Symlink umum.
- Case-insensitive filesystem sering dipakai default.
- Unicode normalization bisa berbeda.
- Path containment via string makin berbahaya.

Production rule:

```text
If your code has security-sensitive path handling, test on every OS/filesystem you claim to support.
```

---

## 31. Provider-Specific Reality

Java NIO didesain di atas `FileSystemProvider`.

Artinya:

```text
Same Java API, different provider, different capability.
```

Contoh provider:

- default OS filesystem,
- ZIP filesystem,
- in-memory filesystem test library,
- custom/cloud-like provider.

Beberapa provider bisa:

- tidak support symlink,
- tidak support hard link,
- tidak punya stable file key,
- tidak punya POSIX attribute,
- berbeda dalam copy link behavior.

Kode top-level harus siap dengan:

```java
UnsupportedOperationException
IOException
SecurityException
AtomicMoveNotSupportedException
FileSystemLoopException
```

---

## 32. Error Handling untuk Link Operation

Common failure:

| Operation | Possible Failure |
|---|---|
| `createSymbolicLink` | unsupported, permission denied, link exists, parent missing |
| `createLink` | unsupported, cross-device, existing missing, permission denied |
| `readSymbolicLink` | not a symlink, unsupported, no permission |
| `toRealPath` | target missing, access denied, loop |
| traversal follow link | loop, permission denied, too many levels |
| copy preserve link | unsupported provider behavior |

Example robust create symlink:

```java
static boolean tryCreateSymlink(Path link, Path target) throws IOException {
    try {
        Files.createSymbolicLink(link, target);
        return true;
    } catch (UnsupportedOperationException e) {
        return false;
    } catch (FileAlreadyExistsException e) {
        return false;
    }
}
```

Jangan swallow semua `IOException` tanpa logging. Permission denied dan parent missing punya implication berbeda.

---

## 33. Decision Table: Operasi Apa Harus Follow Link?

| Use Case | Link Policy Recommended |
|---|---|
| User upload storage | Reject / avoid links |
| Extract untrusted archive | Reject links |
| Cleanup temp directory | Do not follow links |
| Recursive delete tenant data | Do not follow links |
| Backup filesystem | Preserve or explicit follow with boundary check |
| Deployment current release | Follow intentional symlink |
| Config reload | Follow but validate real file |
| Static asset serving | Usually follow only if real path under root |
| Compliance evidence store | Reject links and hard link ambiguity |
| Build tool workspace | Configurable; often preserve/follow depending use case |

---

## 34. Checklist Link-Safe Programming

Sebelum menulis file code yang menerima path:

```text
[ ] Apakah path berasal dari user/input eksternal?
[ ] Apakah base directory writable oleh untrusted process?
[ ] Apakah symbolic link diperbolehkan?
[ ] Apakah hard link bisa menyebabkan identity ambiguity?
[ ] Apakah operasi harus follow link, preserve link, atau reject link?
[ ] Apakah containment check menggunakan real path untuk existing file?
[ ] Apakah ada race antara check dan use?
[ ] Apakah recursive traversal memakai FOLLOW_LINKS tanpa loop policy?
[ ] Apakah delete recursive bisa masuk keluar root?
[ ] Apakah archive extraction menolak symlink entry?
[ ] Apakah Windows junction/reparse point sudah diuji?
[ ] Apakah logs mencatat cukup info untuk debugging link behavior?
```

---

## 35. Anti-Patterns

### 35.1 String Prefix Containment

```java
if (path.toString().startsWith("/safe/base")) {
    // safe? no
}
```

Salah karena:

- lexical only,
- `/safe/base2` juga starts with `/safe/base`,
- tidak resolve symlink,
- case sensitivity berbeda,
- separator berbeda.

---

### 35.2 Normalize Dianggap Security Boundary

```java
Path safe = base.resolve(input).normalize();
```

`normalize()` hanya menghapus `.` dan `..` secara lexical.

Ia tidak resolve symlink.

---

### 35.3 Check `isSymbolicLink` Lalu Operasi Path Lagi

```java
if (!Files.isSymbolicLink(p)) {
    Files.writeString(p, data);
}
```

Race-prone.

---

### 35.4 Recursive Delete dengan `FOLLOW_LINKS`

```java
Files.walkFileTree(root, EnumSet.of(FOLLOW_LINKS), Integer.MAX_VALUE, deleteVisitor);
```

Berbahaya untuk tree tidak terpercaya.

---

### 35.5 Backup Default Follow Link Tanpa Policy

```java
Files.copy(link, backupTarget);
```

Bisa membocorkan target di luar root.

---

## 36. Compact Mental Model

Link mengubah filesystem dari tree sederhana menjadi graph.

Tanpa link:

```text
root
 ├── a
 └── b
```

Dengan symlink:

```text
root
 ├── a
 ├── b -> /other/place
 └── c -> ../root
```

Traversal bukan lagi sekadar tree traversal.

Ia bisa menjadi graph traversal dengan cycle, cross-boundary edge, dan indirection.

Top 1% mental model:

```text
A path is not authority.
A normalized path is not security.
A symlink is an edge to another name.
A hard link is another name for the same object.
A filesystem traversal may become graph traversal.
A safe file workflow must define link policy explicitly.
```

---

## 37. Practical Java Recipes

### 37.1 Reject Final Path If It Is Symlink

```java
static void rejectFinalSymlink(Path path) throws IOException {
    if (Files.isSymbolicLink(path)) {
        throw new SecurityException("Symbolic link not allowed: " + path);
    }
}
```

Use only when final path exists and threat model is low/moderate. It does not protect against all races.

---

### 37.2 Read Symlink Metadata

```java
static Optional<Path> readSymlinkTarget(Path path) throws IOException {
    BasicFileAttributes attrs = Files.readAttributes(
        path,
        BasicFileAttributes.class,
        LinkOption.NOFOLLOW_LINKS
    );

    if (!attrs.isSymbolicLink()) {
        return Optional.empty();
    }

    return Optional.of(Files.readSymbolicLink(path));
}
```

---

### 37.3 Follow Link Only If Target Remains Under Base

```java
static Path resolveExistingUnderBase(Path base, Path relative) throws IOException {
    Path baseReal = base.toRealPath();
    Path candidate = baseReal.resolve(relative).normalize();
    Path real = candidate.toRealPath();

    if (!real.startsWith(baseReal)) {
        throw new SecurityException("Resolved path escapes base");
    }

    return real;
}
```

---

### 37.4 Walk Tree Without Following Links

```java
Files.walkFileTree(root, new SimpleFileVisitor<>() {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
        if (attrs.isSymbolicLink()) {
            System.out.println("link: " + file + " -> " + Files.readSymbolicLink(file));
        } else {
            System.out.println("file: " + file);
        }
        return FileVisitResult.CONTINUE;
    }
});
```

Note: attributes passed depend on traversal options. For explicit link metadata, read with `NOFOLLOW_LINKS`.

---

### 37.5 Walk Tree and Preserve Symlinks in Manifest

```java
record Entry(String type, Path path, String target) {}

List<Entry> entries = new ArrayList<>();

Files.walkFileTree(root, new SimpleFileVisitor<>() {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
        BasicFileAttributes noFollow = Files.readAttributes(
            file,
            BasicFileAttributes.class,
            LinkOption.NOFOLLOW_LINKS
        );

        if (noFollow.isSymbolicLink()) {
            entries.add(new Entry("symlink", root.relativize(file), Files.readSymbolicLink(file).toString()));
        } else if (noFollow.isRegularFile()) {
            entries.add(new Entry("file", root.relativize(file), null));
        } else {
            entries.add(new Entry("other", root.relativize(file), null));
        }
        return FileVisitResult.CONTINUE;
    }
});
```

---

## 38. Design Exercise

Kamu diminta membuat service yang menyajikan static files dari directory:

```text
/var/app/public
```

Request:

```text
GET /assets/{path}
```

Pertanyaan desain:

1. Apakah symlink diizinkan?
2. Jika symlink menunjuk keluar `/var/app/public`, apakah harus ditolak?
3. Apakah hidden files boleh disajikan?
4. Apakah path case-sensitive?
5. Apakah directory listing boleh?
6. Apakah file boleh berubah saat sedang dibaca?
7. Apakah response harus pakai ETag/hash/last-modified?
8. Apakah `toRealPath()` cukup dalam threat model ini?
9. Siapa yang punya permission write ke `/var/app/public`?
10. Apakah deployment memakai symlink `current`?

Jawaban yang bagus bukan sekadar kode.

Jawaban yang bagus mendefinisikan **trust boundary**.

---

## 39. Summary

Di bagian ini kita membangun mental model bahwa filesystem dengan link bukan tree murni, tetapi graph dengan indirection.

Poin utama:

1. Symbolic link berisi path target.
2. Hard link adalah nama lain untuk file object yang sama.
3. Windows junction/reparse point punya caveat tersendiri.
4. Banyak operasi Java mengikuti symlink secara default.
5. `NOFOLLOW_LINKS` penting untuk membaca link sebagai link.
6. `normalize()` bukan security boundary.
7. `toRealPath()` membantu resolve target final untuk existing file, tetapi bukan obat semua race.
8. Recursive traversal dengan `FOLLOW_LINKS` harus punya loop policy.
9. Archive extraction dan upload storage harus sangat hati-hati terhadap link.
10. Aplikasi production harus mendefinisikan link policy eksplisit: reject, preserve, atau follow.

---

## 40. Referensi

- Java SE 25 `Files` API — `createSymbolicLink`, `createLink`, `readSymbolicLink`, `copy`, `move`, `walkFileTree`.
- Java SE 25 `LinkOption` API — `NOFOLLOW_LINKS`.
- Java SE 8 `Files` API — compatibility baseline untuk NIO.2.
- Java SE 8 `FileSystemLoopException` API.
- dev.java — Links, Symbolic and Otherwise.
- dev.java — Walking the File Tree.

---

## 41. Status Seri

Selesai:

- Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
- Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
- Part 02 — File Existence, Type, and Identity: exists Is Not a Lock
- Part 03 — File Creation Semantics: Atomic Create, Temp File, Directory Creation
- Part 04 — Open Options and File Handles: How Java Opens Files
- Part 05 — Reading Files Correctly: Small File, Large File, Streaming, Lazy Lines
- Part 06 — Writing Files Correctly: Replace, Append, Flush, Durability
- Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move
- Part 08 — Copy and Move Semantics: Replace, Attributes, Links, Cross-Device Behavior
- Part 09 — Delete Semantics: Delete, Recursive Delete, Tombstone, and Safe Cleanup
- Part 10 — Directory Listing and Traversal: list, walk, find, DirectoryStream
- Part 11 — FileVisitor and Tree Algorithms: Robust Recursive Operations
- Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming

Belum selesai. Berikutnya:

- Part 13 — Path Traversal Security: User Input, Uploads, Archives, and Sandboxes

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-io-file-filesystem-storage-engineering-part-11-filevisitor-tree-algorithms.md">⬅️ Part 11 — FileVisitor and Tree Algorithms: Robust Recursive Operations</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-io-file-filesystem-storage-engineering-part-13-path-traversal-security.md">Part 13 — Path Traversal Security: User Input, Uploads, Archives, and Sandboxes ➡️</a>
</div>
