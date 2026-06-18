# learn-java-io-file-filesystem-storage-engineering — Part 08
# Copy and Move Semantics: Replace, Attributes, Links, Cross-Device Behavior

> Target pembaca: engineer Java yang sudah memahami dasar `Path`, `Files`, open option, reading, writing, dan atomic update pattern, lalu ingin naik level ke pemahaman production-grade tentang operasi copy/move file.
>
> Target versi Java: Java 8 sampai Java 25.
>
> Fokus: `Files.copy(...)`, `Files.move(...)`, `StandardCopyOption`, `LinkOption.NOFOLLOW_LINKS`, metadata preservation, symbolic link behavior, cross-filesystem move, partial failure, recovery, dan desain workflow copy/move yang aman.

---

## 1. Kenapa Copy dan Move Tidak Sesederhana Kelihatannya

Di level aplikasi, copy/move sering terlihat seperti operasi sederhana:

```java
Files.copy(source, target);
Files.move(source, target);
```

Tetapi di level filesystem, operasi ini dapat berarti beberapa hal yang sangat berbeda:

1. membuat directory entry baru;
2. mengganti directory entry lama;
3. menyalin byte dari satu file ke file lain;
4. menyalin metadata;
5. membuat symbolic link baru;
6. memindahkan nama file tanpa menyentuh content;
7. melakukan rename atomic dalam filesystem yang sama;
8. melakukan copy-then-delete ketika lintas filesystem;
9. gagal di tengah dan meninggalkan file target parsial;
10. gagal karena target ada, permission, lock, quota, disk penuh, link loop, atau filesystem provider tidak mendukung option tertentu.

Mental model yang harus dibangun:

> `copy` dan `move` bukan hanya operasi Java. Keduanya adalah permintaan Java kepada `FileSystemProvider`, lalu provider menerjemahkannya ke semantics OS/filesystem. Karena itu, detail behavior dapat berbeda antara local disk, NFS, SMB, EFS, ZIP filesystem, in-memory filesystem, container volume, dan cloud-mounted filesystem.

Dalam seri sebelumnya kita sudah membahas atomic update pattern: tulis temp file lalu `ATOMIC_MOVE`. Di part ini kita mundur satu lapis dan mempelajari arti copy/move itu sendiri.

---

## 2. API Utama

### 2.1 Copy path ke path

```java
Path result = Files.copy(source, target, options...);
```

Makna umum:

- membaca file/directory/link dari `source`;
- membuat entry baru di `target`;
- gagal jika target sudah ada, kecuali diberikan option tertentu;
- jika source adalah directory, secara default yang dibuat adalah directory target, bukan recursive copy isi directory;
- jika source adalah symbolic link, behavior tergantung option link handling.

### 2.2 Copy input stream ke path

```java
long bytes = Files.copy(inputStream, target, options...);
```

Makna umum:

- membaca semua byte dari `InputStream`;
- menulis ke file target;
- cocok untuk upload, network response, archive extraction, generated content;
- bukan copy metadata file source karena source bukan filesystem object.

### 2.3 Copy path ke output stream

```java
long bytes = Files.copy(source, outputStream);
```

Makna umum:

- membaca semua byte dari source path;
- menulis ke output stream;
- cocok untuk download response, archive builder, hashing pipeline, streaming export.

### 2.4 Move path ke path

```java
Path result = Files.move(source, target, options...);
```

Makna umum:

- memindahkan atau rename file/directory;
- dalam filesystem yang sama biasanya bisa berupa operasi metadata saja;
- lintas filesystem mungkin gagal atau jatuh ke behavior provider-specific;
- dengan `ATOMIC_MOVE`, harus atomic atau gagal.

---

## 3. `StandardCopyOption`: Tiga Option yang Wajib Dikuasai

Java menyediakan tiga option standard untuk copy/move:

```java
StandardCopyOption.REPLACE_EXISTING
StandardCopyOption.COPY_ATTRIBUTES
StandardCopyOption.ATOMIC_MOVE
```

Dan satu option dari `LinkOption` yang sangat penting:

```java
LinkOption.NOFOLLOW_LINKS
```

Secara konseptual:

| Option | Umum dipakai oleh | Arti besar |
|---|---:|---|
| `REPLACE_EXISTING` | copy, move | target boleh diganti jika sudah ada |
| `COPY_ATTRIBUTES` | copy | usahakan copy metadata juga |
| `ATOMIC_MOVE` | move | move harus atomic sebagai operasi filesystem |
| `NOFOLLOW_LINKS` | copy/link-sensitive operation | jangan ikuti symbolic link |

Catatan penting:

- `ATOMIC_MOVE` hanya relevan untuk `move`, bukan copy biasa.
- `COPY_ATTRIBUTES` bukan jaminan semua metadata akan identik di semua filesystem.
- `NOFOLLOW_LINKS` mengubah arti object yang dicopy: link-nya atau target-nya.
- `REPLACE_EXISTING` bukan berarti operasi replace selalu atomic.

---

## 4. Default Behavior: Jangan Asumsikan Target Akan Ditimpa

Default behavior `Files.copy(source, target)`:

```java
Files.copy(source, target);
```

Jika `target` sudah ada, operasi gagal dengan exception seperti:

```java
FileAlreadyExistsException
```

Ini bagus untuk safety. Default-nya konservatif: Java tidak diam-diam overwrite file.

Jika ingin mengganti target:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Tetapi pahami ini:

> `REPLACE_EXISTING` berarti operasi boleh mengganti target jika target sudah ada. Itu tidak otomatis berarti replacement bersifat atomic, durable, rollback-safe, atau transaction-safe.

Untuk file kecil dan workflow sederhana, ini mungkin cukup. Untuk config penting, manifest, index, checkpoint, atau file yang dibaca proses lain, gunakan pattern dari Part 07:

1. copy/write ke temp file;
2. validasi temp file;
3. force jika butuh durability;
4. atomic move ke target akhir.

---

## 5. Copy File: Byte Copy, Metadata Copy, dan Failure Mode

### 5.1 Copy file biasa

```java
Path source = Path.of("data/input.csv");
Path target = Path.of("backup/input.csv");

Files.copy(source, target);
```

Jika target belum ada, file baru dibuat.

Jika target sudah ada:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

### 5.2 Apa yang sebenarnya dicopy?

Default-nya yang utama dicopy adalah content file. Metadata detail seperti owner, permission, timestamp, ACL, creation time, extended attributes, sparse allocation, compression flag, encryption flag, dan platform-specific attribute tidak boleh diasumsikan ikut.

Jika ingin meminta metadata ikut dicopy:

```java
Files.copy(
    source,
    target,
    StandardCopyOption.REPLACE_EXISTING,
    StandardCopyOption.COPY_ATTRIBUTES
);
```

Tetapi kata kuncinya adalah: **meminta**.

`COPY_ATTRIBUTES` bukan kontrak bahwa semua attribute akan berhasil dipertahankan identik. Kenapa?

Karena attribute support tergantung:

- source filesystem;
- target filesystem;
- provider;
- OS;
- privilege process;
- attribute view yang tersedia;
- apakah target filesystem punya konsep metadata yang sama.

Contoh mismatch:

- Linux POSIX permission dicopy ke Windows target? Tidak selalu punya arti sama.
- Windows ACL dicopy ke ZIP filesystem? Tidak relevan.
- creation time di satu filesystem belum tentu ada/akurat di filesystem lain.
- owner/group tidak bisa diset jika process tidak punya privilege.
- extended attributes belum tentu didukung.

Mental model:

> Content copy dan metadata copy adalah dua domain berbeda. Content dapat sukses sementara metadata preservation tidak lengkap, tergantung provider.

### 5.3 Copy dapat gagal setelah sebagian byte tercopy

Ini penting.

Copy file besar tidak selalu all-or-nothing. Jika disk penuh, koneksi network filesystem putus, permission berubah, process dibunuh, atau target volume error, target file bisa tertinggal dalam kondisi parsial.

Contoh failure:

```java
try {
    Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
} catch (IOException e) {
    // target mungkin tidak ada, mungkin parsial, mungkin ada dengan ukuran sebagian,
    // mungkin sudah mengganti file lama tergantung provider dan timing.
}
```

Karena itu, untuk copy penting, jangan langsung copy ke final target.

Gunakan staging:

```java
Path target = Path.of("/data/final/report.csv");
Path temp = target.resolveSibling("." + target.getFileName() + ".copying-" + UUID.randomUUID() + ".tmp");

try {
    Files.copy(source, temp);

    // Optional: validate size/hash/content before publish
    long sourceSize = Files.size(source);
    long tempSize = Files.size(temp);
    if (sourceSize != tempSize) {
        throw new IOException("Copy size mismatch: source=" + sourceSize + ", temp=" + tempSize);
    }

    Files.move(
        temp,
        target,
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING
    );
} catch (IOException e) {
    try {
        Files.deleteIfExists(temp);
    } catch (IOException cleanupFailure) {
        e.addSuppressed(cleanupFailure);
    }
    throw e;
}
```

Dengan pattern ini:

- pembaca tidak melihat file target parsial;
- final target hanya berubah saat temp sudah selesai;
- target lama tetap ada sampai publish;
- failure sebelum publish hanya meninggalkan temp file yang bisa dibersihkan.

---

## 6. Copy Directory: Bukan Recursive Copy

Salah satu jebakan paling umum:

```java
Files.copy(Path.of("/src/dir"), Path.of("/dst/dir"));
```

Ini tidak menyalin seluruh isi directory secara recursive.

Untuk directory, operasi ini biasanya membuat directory target kosong. Isi directory tidak otomatis ikut.

Mengapa Java mendesain seperti ini?

Karena recursive copy bukan operasi sederhana. Recursive copy harus memutuskan banyak hal:

- apakah mengikuti symlink?
- bagaimana jika ada cycle?
- bagaimana jika satu file gagal?
- apakah lanjut atau rollback?
- apakah copy attribute tiap file?
- bagaimana jika target sebagian sudah ada?
- bagaimana jika source berubah saat traversal?
- bagaimana urutan copy directory dan file?
- bagaimana permission directory target sebelum isi dicopy?
- bagaimana recovery jika gagal di tengah?

Karena itu Java menyediakan primitive `Files.copy`, lalu recursive operation dibangun dengan `Files.walkFileTree` dan `FileVisitor`.

Contoh minimal recursive copy:

```java
public static void copyTree(Path sourceRoot, Path targetRoot) throws IOException {
    Files.walkFileTree(sourceRoot, new SimpleFileVisitor<>() {
        @Override
        public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
            Path relative = sourceRoot.relativize(dir);
            Path targetDir = targetRoot.resolve(relative);
            Files.createDirectories(targetDir);
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
            Path relative = sourceRoot.relativize(file);
            Path targetFile = targetRoot.resolve(relative);
            Files.copy(file, targetFile, StandardCopyOption.COPY_ATTRIBUTES);
            return FileVisitResult.CONTINUE;
        }
    });
}
```

Namun ini masih belum production-grade. Masalahnya:

- tidak menangani symlink eksplisit;
- tidak memakai staging;
- tidak atomic secara keseluruhan;
- tidak punya error aggregation;
- tidak punya retry;
- tidak punya resume;
- tidak melindungi dari source berubah saat copy;
- tidak validasi hash/size;
- tidak mengatur permission directory final;
- tidak aman untuk multi-writer target.

Production-grade recursive copy akan dibahas lebih dalam pada Part 11 dan Part 32.

---

## 7. Move: Rename, Relokasi, atau Copy-Delete?

`Files.move(source, target)` bisa berarti beberapa hal.

### 7.1 Move dalam directory yang sama

```java
Files.move(
    Path.of("/data/a.tmp"),
    Path.of("/data/a.txt")
);
```

Biasanya ini adalah rename metadata. Content tidak disalin byte demi byte. Directory entry berubah dari `a.tmp` menjadi `a.txt`.

Ini cepat bahkan untuk file besar.

### 7.2 Move antar directory dalam filesystem yang sama

```java
Files.move(
    Path.of("/data/inbox/a.txt"),
    Path.of("/data/processed/a.txt")
);
```

Jika masih dalam filesystem/mount yang sama, biasanya tetap metadata operation. Bisa sangat cepat.

### 7.3 Move lintas filesystem

```java
Files.move(
    Path.of("/mnt/disk-a/a.txt"),
    Path.of("/mnt/disk-b/a.txt")
);
```

Ini mungkin tidak bisa dilakukan sebagai rename metadata karena source dan target berada di filesystem berbeda.

Kemungkinan behavior:

1. gagal;
2. provider melakukan copy lalu delete;
3. beberapa metadata hilang;
4. operation tidak atomic;
5. jika gagal di tengah, source dan target bisa berada dalam state campuran.

Karena itu, untuk workflow penting:

- jangan menganggap move lintas directory selalu atomic;
- jangan menganggap move lintas mount sama dengan rename;
- gunakan `ATOMIC_MOVE` jika atomicity adalah requirement;
- tangani `AtomicMoveNotSupportedException` dengan eksplisit.

---

## 8. `ATOMIC_MOVE`: Permintaan Keras, Bukan Sihir

```java
Files.move(
    source,
    target,
    StandardCopyOption.ATOMIC_MOVE,
    StandardCopyOption.REPLACE_EXISTING
);
```

Arti ideal:

> target berpindah dari state lama ke state baru sebagai satu operasi filesystem atomic. Reader tidak melihat state setengah jadi.

Tetapi `ATOMIC_MOVE` punya batas:

- mungkin hanya didukung dalam filesystem yang sama;
- mungkin gagal antar provider;
- mungkin tidak didukung di ZIP filesystem tertentu;
- behavior detail ketika target ada bisa provider-specific;
- atomic move tidak sama dengan durable move;
- atomic move tidak membuat isi file otomatis fsync;
- atomic move tidak membuat multi-file transaction.

Jika provider tidak dapat melakukan atomic move, Java dapat melempar:

```java
AtomicMoveNotSupportedException
```

Pattern yang benar:

```java
try {
    Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException e) {
    // Jangan diam-diam fallback jika atomicity adalah invariant.
    throw new IOException("Atomic publish is not supported for target filesystem: " + target, e);
}
```

Anti-pattern:

```java
try {
    Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
} catch (AtomicMoveNotSupportedException e) {
    Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING); // dangerous silent downgrade
}
```

Fallback non-atomic boleh dilakukan hanya jika business invariant mengizinkan.

Contoh:

- cache file: mungkin boleh;
- thumbnail generated: mungkin boleh;
- audit manifest: tidak boleh;
- payment settlement file: tidak boleh;
- legal evidence file: tidak boleh;
- database-like index file: tidak boleh.

---

## 9. `REPLACE_EXISTING`: Replace Apa?

### 9.1 Replace file biasa

```java
Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Jika target file biasa ada, target dapat diganti.

Tetapi detail penting:

- jika target sedang dibuka process lain, Windows bisa gagal;
- Unix mungkin mengizinkan rename mengganti entry meskipun file lama masih dibuka;
- jika target adalah directory, rules berbeda;
- jika target adalah symlink, behavior harus dipahami dengan hati-hati;
- replace belum tentu mempertahankan attribute target lama.

### 9.2 Replace bukan merge

`REPLACE_EXISTING` tidak berarti:

- merge isi directory;
- preserve permission target lama;
- preserve ACL target lama;
- preserve ownership target lama;
- preserve hard link relationship;
- preserve extended attributes;
- notify semua reader secara synchronous.

Ia hanya option bahwa target existing boleh diganti.

### 9.3 Replace directory

Replacing directory memiliki batas lebih ketat. Banyak filesystem hanya mengizinkan mengganti directory jika directory target kosong atau operasi sesuai rules provider. Jangan menggunakan `REPLACE_EXISTING` untuk menganggap recursive directory replacement.

Untuk directory tree deployment, biasanya pakai pattern:

```text
release-2026-06-18-001/
release-2026-06-18-002/
current -> release-2026-06-18-002
```

atau atomic pointer/symlink switch jika platform mendukung, bukan replace directory tree secara langsung.

---

## 10. Symbolic Link Behavior: Copy Link atau Target?

Ini area yang sering menyebabkan bug security.

Misal:

```text
/source/logo.png -> /real/assets/logo-v1.png
```

Jika kita copy `/source/logo.png`, yang dicopy apa?

Ada dua kemungkinan konseptual:

1. copy file target `/real/assets/logo-v1.png` sebagai file biasa;
2. copy symbolic link-nya sebagai link baru.

Default behavior umumnya mengikuti link. Artinya content target yang dicopy.

Jika ingin copy link itu sendiri:

```java
Files.copy(
    sourceLink,
    targetLink,
    LinkOption.NOFOLLOW_LINKS
);
```

Mental model:

| Intent | Option |
|---|---|
| Copy isi file yang ditunjuk symlink | default follow link |
| Copy link object-nya | `NOFOLLOW_LINKS` |
| Hindari symlink traversal attack | gunakan `NOFOLLOW_LINKS` + real path validation |

Contoh eksplisit:

```java
Path source = Path.of("/safe/input/file.txt");
Path target = Path.of("/safe/output/file.txt");

Files.copy(source, target, LinkOption.NOFOLLOW_LINKS);
```

Tetapi jangan berpikir `NOFOLLOW_LINKS` sendiri menyelesaikan semua security problem. Ia hanya mengubah link handling pada operasi tersebut. Race condition masih bisa terjadi jika attacker dapat mengganti path setelah validasi.

---

## 11. Move Symbolic Link: Link Entry atau Target?

Untuk move, biasanya yang dipindahkan adalah directory entry yang ditunjuk oleh `source` path. Jika source path adalah symbolic link, yang dipindahkan adalah link itu sendiri, bukan target file-nya.

Contoh:

```text
/inbox/current -> /data/real-file.txt
```

```java
Files.move(Path.of("/inbox/current"), Path.of("/archive/current"));
```

Secara konseptual, link `/inbox/current` dipindah menjadi `/archive/current`. Target `/data/real-file.txt` tidak ikut pindah.

Tetapi provider/platform detail tetap penting, terutama pada Windows reparse point/junction.

Prinsip aman:

- Jangan menebak. Jika link behavior penting, cek dengan `Files.isSymbolicLink(path)`.
- Gunakan `readSymbolicLink` untuk memahami target link.
- Untuk operasi security-sensitive, desain path containment dan symlink policy secara eksplisit.

---

## 12. Hard Link: Copy/Move Dapat Mengubah File Identity

Hard link adalah beberapa directory entry yang menunjuk ke file identity/content record yang sama.

Misal:

```text
/a/report.txt  ─┐
                ├── same underlying file
/b/report.txt  ─┘
```

Jika kita `move /a/report.txt /c/report.txt`, identity underlying file biasanya tetap sama; hanya nama/link directory berubah.

Jika kita `copy /a/report.txt /c/report.txt`, file baru dibuat dengan content sama tetapi identity berbeda.

Konsekuensi:

- `copy` memutus hard-link relationship;
- `move` dalam filesystem yang sama dapat mempertahankan identity;
- move lintas filesystem copy-delete akan menciptakan identity baru;
- backup/deduplication tool perlu sadar hard link jika ingin preserve storage semantics.

Di Java, `Files.isSameFile(a, b)` dapat dipakai untuk mengecek apakah dua path menunjuk file yang sama. Tetapi ini juga provider/OS-dependent dan dapat membutuhkan akses filesystem.

---

## 13. Attribute Preservation: Apa yang Sering Hilang?

Saat copy/move, metadata yang mungkin relevan:

- last modified time;
- last access time;
- creation time;
- size;
- owner;
- group;
- POSIX permissions;
- DOS attributes seperti hidden/read-only/system/archive;
- ACL;
- extended attributes;
- file flags;
- sparse allocation;
- compression/encryption flags;
- SELinux context;
- macOS resource forks/xattrs;
- Windows alternate data streams.

Java `COPY_ATTRIBUTES` hanya memberi standard request. Tidak semua hal di atas ada dalam standard view Java, dan tidak semua filesystem bisa mempertahankannya.

Top 1% mindset:

> Jangan bilang “copy file” jika requirement sebenarnya “clone file beserta security descriptor, timestamp, owner, xattr, dan identity semantics”. Itu requirement yang berbeda.

Jika metadata adalah requirement hukum/audit/compliance, buat explicit verification:

```java
BasicFileAttributes srcAttrs = Files.readAttributes(source, BasicFileAttributes.class);
BasicFileAttributes dstAttrs = Files.readAttributes(target, BasicFileAttributes.class);

if (srcAttrs.size() != dstAttrs.size()) {
    throw new IOException("Size mismatch after copy");
}

if (!srcAttrs.lastModifiedTime().equals(dstAttrs.lastModifiedTime())) {
    // Bisa jadi toleransi timestamp filesystem berbeda.
    // Jangan selalu fail tanpa memahami resolution filesystem.
}
```

Untuk permission:

```java
Set<PosixFilePermission> srcPerms = Files.getPosixFilePermissions(source);
Set<PosixFilePermission> dstPerms = Files.getPosixFilePermissions(target);

if (!srcPerms.equals(dstPerms)) {
    throw new IOException("Permission mismatch");
}
```

Namun ini hanya berlaku jika filesystem mendukung POSIX attribute view.

---

## 14. Timestamp Resolution dan Attribute Mismatch

Bahkan timestamp pun tidak selalu presisi sama.

Filesystem berbeda dapat punya timestamp resolution berbeda:

- nanosecond;
- microsecond;
- millisecond;
- two-second granularity pada filesystem lama;
- remote filesystem dengan caching;
- archive filesystem dengan format timestamp terbatas.

Jangan menulis test seperti ini secara naif:

```java
assertEquals(
    Files.getLastModifiedTime(source),
    Files.getLastModifiedTime(target)
);
```

Untuk test portable, gunakan toleransi:

```java
static boolean closeEnough(FileTime a, FileTime b, Duration tolerance) {
    long diff = Math.abs(a.toMillis() - b.toMillis());
    return diff <= tolerance.toMillis();
}
```

Atau validasi hanya metadata yang memang business-critical.

---

## 15. Cross-Device Move: Salah Satu Sumber Bug Terbesar

Cross-device move biasanya terjadi ketika:

- `/tmp` berada di filesystem berbeda dari target;
- container writable layer berbeda dari mounted volume;
- source di local disk, target di network mount;
- source di PVC A, target di PVC B;
- source di ZIP filesystem, target di default filesystem;
- source dan target beda provider.

Bug umum:

```java
Path temp = Files.createTempFile("upload-", ".tmp"); // default temp dir, mungkin /tmp
Path finalTarget = Path.of("/app/data/upload.bin"); // mounted volume

Files.move(temp, finalTarget, StandardCopyOption.ATOMIC_MOVE);
```

Ini bisa gagal karena temp berada di filesystem berbeda.

Pattern benar:

```java
Path targetDir = Path.of("/app/data");
Path temp = Files.createTempFile(targetDir, ".upload-", ".tmp");
Path finalTarget = targetDir.resolve("upload.bin");

Files.move(temp, finalTarget, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
```

Prinsip:

> Jika ingin atomic publish ke directory tertentu, temp file harus dibuat di directory yang sama atau minimal filesystem yang sama dengan target.

---

## 16. Move Directory: Tidak Sama dengan Copy Tree

Moving directory dalam filesystem yang sama sering bisa dilakukan sebagai rename directory entry.

```java
Files.move(Path.of("/data/staging/job-123"), Path.of("/data/ready/job-123"));
```

Jika same filesystem, ini bisa menjadi atomic handoff directory.

Pattern ini sangat berguna:

```text
staging/job-123/
  manifest.json
  payload.csv
  checksum.sha256

ready/job-123/
  manifest.json
  payload.csv
  checksum.sha256
```

Selama `staging` dan `ready` berada dalam filesystem yang sama, `move staging/job-123 -> ready/job-123` dapat menjadi publish point yang rapi.

Tetapi jika lintas filesystem, move directory dapat gagal atau menjadi recursive copy/delete yang tidak atomic.

Untuk ingestion system, gunakan layout:

```text
/data/file-engine/
  staging/
  ready/
  processing/
  done/
  error/
```

Pastikan semuanya berada di filesystem/mount yang sama jika rename atomic menjadi invariant.

---

## 17. Copy/Move dan Reader Concurrent

Pertanyaan penting:

> Apa yang dilihat reader ketika writer sedang copy atau move?

### 17.1 Direct copy ke final target

```java
Files.copy(source, finalTarget, StandardCopyOption.REPLACE_EXISTING);
```

Reader bisa melihat:

- file belum ada;
- file ada tapi masih parsial;
- file lama terganti sebagian tergantung provider;
- exception saat baca;
- content berubah saat dibaca.

### 17.2 Copy ke temp lalu atomic move

```java
Files.copy(source, temp);
Files.move(temp, finalTarget, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
```

Reader final target melihat:

- versi lama; atau
- versi baru;
- bukan file parsial, jika move benar-benar atomic.

Inilah kenapa atomic publish pattern sangat penting.

### 17.3 Reader yang sudah membuka file lama

Pada Unix-like system, jika reader sudah membuka file lama lalu writer mengganti path dengan rename, reader lama biasanya tetap membaca file lama melalui file descriptor. Reader baru membuka path dan melihat file baru.

Pada Windows, replace bisa gagal jika file sedang dibuka dengan sharing mode tertentu.

Java code portable harus mengantisipasi:

- `AccessDeniedException`;
- retry dengan backoff;
- versioned file naming;
- reader lifecycle yang pendek;
- tidak mengganti file yang long-lived opened oleh process lain.

---

## 18. Designing Safe Copy: Decision Tree

Gunakan pertanyaan berikut sebelum memilih implementasi.

### 18.1 Apakah target boleh terlihat parsial?

Jika ya, direct copy mungkin cukup.

Jika tidak:

- copy ke temp;
- validasi;
- atomic move.

### 18.2 Apakah target lama boleh hilang jika copy gagal?

Jika tidak:

- jangan direct `REPLACE_EXISTING`;
- publish hanya setelah temp lengkap.

### 18.3 Apakah metadata harus dipertahankan?

Jika ya:

- gunakan `COPY_ATTRIBUTES`;
- verifikasi attribute penting;
- siapkan fallback atau fail jika tidak bisa.

### 18.4 Apakah source bisa berubah saat dicopy?

Jika ya:

- gunakan locking/claiming/versioning;
- copy lalu validasi size/hash dua kali;
- reject jika modified time berubah;
- gunakan immutable source naming.

### 18.5 Apakah source/target bisa symlink?

Jika ya:

- definisikan policy: follow atau nofollow;
- validasi containment;
- hindari path traversal.

### 18.6 Apakah source/target lintas filesystem?

Jika atomicity dibutuhkan:

- jangan lintas filesystem;
- buat temp di target directory;
- tangani `AtomicMoveNotSupportedException`.

---

## 19. Production Pattern: Safe File Copy to Final Location

Berikut contoh utilitas yang lebih aman untuk copy file biasa ke target final.

```java
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.UUID;

import static java.nio.file.StandardCopyOption.*;
import static java.nio.file.StandardOpenOption.READ;

public final class SafeFileCopy {

    private SafeFileCopy() {
    }

    public static void copyFileAtomically(Path source, Path target) throws IOException {
        Path absoluteTarget = target.toAbsolutePath();
        Path targetDir = absoluteTarget.getParent();
        if (targetDir == null) {
            throw new IOException("Target must have a parent directory: " + target);
        }

        Files.createDirectories(targetDir);

        // Create temp in target directory to maximize chance of same-filesystem atomic move.
        Path temp = Files.createTempFile(
            targetDir,
            "." + absoluteTarget.getFileName() + ".",
            ".copying-" + UUID.randomUUID() + ".tmp"
        );

        boolean published = false;
        try {
            BasicFileAttributes before = Files.readAttributes(source, BasicFileAttributes.class);
            if (!before.isRegularFile()) {
                throw new IOException("Source is not a regular file: " + source);
            }

            Files.copy(source, temp, REPLACE_EXISTING, COPY_ATTRIBUTES);

            BasicFileAttributes afterSource = Files.readAttributes(source, BasicFileAttributes.class);
            BasicFileAttributes tempAttrs = Files.readAttributes(temp, BasicFileAttributes.class);

            if (before.size() != tempAttrs.size()) {
                throw new IOException("Copied file size mismatch: expected " + before.size() + " got " + tempAttrs.size());
            }

            // Detect simple source mutation during copy.
            if (before.size() != afterSource.size()
                    || !before.lastModifiedTime().equals(afterSource.lastModifiedTime())) {
                throw new IOException("Source changed during copy: " + source);
            }

            // Optional durability request for local storage.
            try (FileChannel channel = FileChannel.open(temp, READ)) {
                channel.force(true);
            }

            Files.move(temp, absoluteTarget, ATOMIC_MOVE, REPLACE_EXISTING);
            published = true;
        } finally {
            if (!published) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException cleanupFailure) {
                    // In a library, attach this as suppressed to the original exception if available.
                    // In an application, log with correlation id.
                }
            }
        }
    }
}
```

Catatan:

- Ini bukan solusi universal.
- Ini tidak menyelesaikan symlink attack sepenuhnya.
- Ini tidak menjamin semua metadata preserved.
- Ini tidak membuat directory fsync portable.
- Ini tidak membuat multi-file transaction.
- Ini tetap jauh lebih aman daripada direct copy ke final target.

---

## 20. Production Pattern: Rename-Claim untuk File Intake

Dalam file intake engine, sering ada directory:

```text
inbox/
processing/
done/
error/
```

Alih-alih worker membaca file langsung dari `inbox`, worker dapat mengklaim file dengan move atomic:

```java
Path inboxFile = Path.of("/data/inbox/customer-001.csv");
Path processingFile = Path.of("/data/processing/customer-001.csv.worker-17");

try {
    Files.move(inboxFile, processingFile, StandardCopyOption.ATOMIC_MOVE);
    // Worker successfully claimed the file.
} catch (NoSuchFileException e) {
    // Another worker may have claimed it first.
} catch (FileAlreadyExistsException e) {
    // Naming collision; choose unique processing name.
} catch (AtomicMoveNotSupportedException e) {
    // Filesystem layout violates claim invariant.
    throw e;
}
```

Kenapa ini bagus?

- claim dan remove dari inbox terjadi sebagai satu operation;
- worker lain tidak melihat file itu lagi di inbox;
- tidak perlu lock file tambahan untuk simple case;
- jika worker mati setelah claim, recovery dapat scan `processing` untuk stale file.

Tetapi ini hanya aman jika:

- `inbox` dan `processing` ada di filesystem yang sama;
- semua writer menulis file secara atomic ke inbox;
- file tidak muncul di inbox sebelum selesai ditulis;
- worker tidak follow symlink berbahaya;
- ada recovery untuk stale processing files.

---

## 21. Production Pattern: Staging Upload

Untuk upload dari HTTP request, jangan langsung tulis ke final path.

Buruk:

```java
Files.copy(uploadStream, finalPath, StandardCopyOption.REPLACE_EXISTING);
```

Masalah:

- final file bisa parsial jika upload putus;
- reader bisa melihat file belum selesai;
- overwrite file lama sebelum validasi;
- path traversal jika filename user dipakai langsung;
- metadata tidak jelas;
- cleanup sulit.

Lebih baik:

```java
Path storageRoot = Path.of("/data/uploads").toRealPath();
Path stagingDir = storageRoot.resolve("staging");
Path finalDir = storageRoot.resolve("objects");

Files.createDirectories(stagingDir);
Files.createDirectories(finalDir);

Path temp = Files.createTempFile(stagingDir, ".upload-", ".tmp");

try {
    long bytes = Files.copy(uploadStream, temp, StandardCopyOption.REPLACE_EXISTING);

    if (bytes == 0) {
        throw new IOException("Empty upload is not allowed");
    }

    // Validate content, size, hash, MIME, business rules, virus scan, etc.

    Path finalPath = finalDir.resolve(generateSafeStorageName());
    Files.move(temp, finalPath, StandardCopyOption.ATOMIC_MOVE);
} catch (IOException e) {
    Files.deleteIfExists(temp);
    throw e;
}
```

Jika stagingDir dan finalDir beda filesystem, atomic move gagal. Untuk upload final publish atomic, staging sebaiknya di filesystem final yang sama.

---

## 22. Recovery Strategy Saat Copy/Move Gagal

Kita perlu bedakan failure sebelum publish dan sesudah publish.

### 22.1 Direct copy failure

State mungkin:

```text
target tidak ada
atau
target parsial
atau
target lama rusak/terganti
atau
target baru lengkap tapi exception terjadi setelahnya
```

Recovery sulit karena tidak ada marker jelas.

### 22.2 Temp-copy-then-move failure sebelum move

State:

```text
final target lama tetap ada
temp mungkin parsial atau lengkap
```

Recovery:

- hapus temp jika aman;
- atau scan temp stale berdasarkan naming convention;
- final target belum berubah.

### 22.3 Failure saat atomic move

Jika benar-benar atomic move, state final biasanya:

```text
antara final lama atau final baru
```

Bukan setengah file. Tetapi program tetap harus cek state setelah recovery jika crash.

### 22.4 Failure setelah atomic move

State:

```text
final target sudah baru
temp tidak ada
```

Jika aplikasi crash sebelum update database/status, bisa terjadi mismatch antara filesystem dan metadata store.

Solusi:

- gunakan idempotent recovery;
- manifest file;
- status derived from filesystem jika memungkinkan;
- commit marker;
- database transaction boundary yang jelas;
- outbox/inbox pattern.

---

## 23. Copy/Move dan Database Transaction: Tidak Satu Transaksi

File operation tidak otomatis ikut dalam database transaction.

Anti-pattern:

```java
@Transactional
public void saveDocument(InputStream upload, DocumentMeta meta) throws IOException {
    repository.save(meta);
    Files.copy(upload, meta.path(), StandardCopyOption.REPLACE_EXISTING);
}
```

Masalah:

- DB commit bisa sukses, file copy gagal;
- file copy sukses, DB rollback;
- retry bisa overwrite file;
- tidak ada atomicity lintas DB dan filesystem.

Lebih baik desain state machine:

```text
RECEIVED_METADATA
STAGED_FILE
VALIDATED
PUBLISHED
COMMITTED
FAILED
QUARANTINED
```

Atau gunakan pattern:

1. write file ke staging;
2. validate;
3. insert DB row status `STAGED`;
4. atomic move publish;
5. update DB status `PUBLISHED`;
6. recovery job reconcile filesystem dan DB.

Tidak sempurna seperti distributed transaction, tetapi lebih observable dan recoverable.

---

## 24. Exception Taxonomy yang Harus Dibaca, Bukan Ditelan

Common exception:

| Exception | Makna umum | Respons desain |
|---|---|---|
| `NoSuchFileException` | source hilang atau parent target tidak ada | retry? rescan? fail input? |
| `FileAlreadyExistsException` | target ada tanpa replace | collision handling |
| `DirectoryNotEmptyException` | operasi directory tidak valid | jangan treat seperti file biasa |
| `AccessDeniedException` | permission/lock/security | classify operational/security |
| `AtomicMoveNotSupportedException` | atomic invariant tidak didukung | fail fast jika atomicity wajib |
| `FileSystemLoopException` | traversal link loop | symlink policy |
| `NotDirectoryException` | expected directory ternyata bukan | validate layout |
| `IOException` umum | I/O error lain | log context lengkap |

Jangan menulis:

```java
catch (IOException e) {
    return false;
}
```

Untuk file operation, context sangat penting:

- source path;
- target path;
- operation;
- options;
- file size;
- filesystem/mount;
- correlation id;
- retry attempt;
- whether operation was before/after publish.

---

## 25. Observability untuk Copy/Move

Minimal log event untuk production:

```text
operation=copy
source=/data/inbox/a.csv
target=/data/staging/a.csv.tmp
options=COPY_ATTRIBUTES
bytes=10485760
duration_ms=321
result=success
correlation_id=...
```

Untuk failure:

```text
operation=move
source=/data/staging/a.csv.tmp
target=/data/ready/a.csv
options=ATOMIC_MOVE,REPLACE_EXISTING
exception=AtomicMoveNotSupportedException
filesystem_hint=same_mount_required
correlation_id=...
```

Metric penting:

- copy bytes total;
- copy duration;
- move duration;
- copy failure count by exception;
- atomic move unsupported count;
- temp cleanup failure count;
- stale temp file count;
- partial copy detection count;
- disk free before/after;
- queue depth per directory.

---

## 26. Performance Considerations

### 26.1 Copy besar mahal

Copy file besar berarti:

- membaca banyak byte dari source;
- menulis banyak byte ke target;
- mengisi page cache;
- memakai disk bandwidth;
- dapat mengganggu workload lain;
- dapat memperbesar latency I/O.

Move dalam filesystem yang sama biasanya jauh lebih murah karena metadata operation.

### 26.2 Jangan gunakan copy untuk “rename”

Buruk:

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
Files.delete(source);
```

Lebih baik:

```java
Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Jika atomicity penting:

```java
Files.move(source, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
```

### 26.3 Directory dengan jutaan file

Copy/move workflow yang membuat semua file dalam satu directory besar dapat menyebabkan:

- slow listing;
- expensive metadata lookup;
- inode pressure;
- backup/indexer overhead;
- operational pain.

Gunakan sharding path:

```text
objects/ab/cd/abcdef123456...
```

atau partition by date/tenant/job:

```text
objects/2026/06/18/tenant-42/...
```

### 26.4 Copy attributes bisa menambah biaya

`COPY_ATTRIBUTES` dapat memicu metadata operations tambahan. Di network filesystem, metadata operation dapat lebih mahal daripada yang terlihat.

Gunakan hanya jika perlu.

---

## 27. Security Considerations

### 27.1 Jangan copy berdasarkan filename user langsung

Buruk:

```java
Path target = uploadDir.resolve(userProvidedFilename);
Files.copy(upload, target);
```

Risiko:

- path traversal;
- overwrite file penting;
- reserved names;
- Unicode spoofing;
- collision;
- symlink target escape;
- extension confusion.

Lebih baik:

```java
String storageName = UUID.randomUUID().toString();
Path target = uploadDir.resolve(storageName);
```

Simpan original filename sebagai metadata biasa, bukan sebagai path authority.

### 27.2 Jangan follow symlink jika root harus aman

Untuk file operation dalam sandbox, symlink dapat membawa operasi keluar root.

```text
/safe/root/user-file -> /etc/passwd
```

Jika code blindly copy/move/delete, bisa fatal.

Prinsip:

- validasi root dengan `toRealPath`;
- validasi final path containment;
- gunakan `NOFOLLOW_LINKS` jika policy melarang symlink;
- hindari operasi privileged pada path yang bisa dimodifikasi user;
- gunakan directory ownership/permission yang benar.

### 27.3 Copy archive extraction lebih berbahaya

Saat extract ZIP/TAR, setiap entry name harus dianggap hostile.

```text
../../app/config.yaml
/absolute/path
safe/../evil
symlink-to-outside
```

Part archive akan dibahas khusus di Part 24, tetapi prinsip copy/move di sini tetap berlaku: jangan publish file hasil ekstraksi langsung ke final root tanpa validasi dan staging.

---

## 28. Java 8 sampai Java 25 Compatibility Notes

### 28.1 `Path.of` vs `Paths.get`

Java 8 belum punya `Path.of`. Gunakan:

```java
Path path = Paths.get("data", "file.txt");
```

Java 11+ dapat menggunakan:

```java
Path path = Path.of("data", "file.txt");
```

Untuk materi ini, contoh modern memakai `Path.of`, tetapi jika target runtime Java 8, ganti dengan `Paths.get`.

### 28.2 `Files.copy` dan `Files.move`

API utama `Files.copy(Path, Path, CopyOption...)`, `Files.move(Path, Path, CopyOption...)`, dan `StandardCopyOption` sudah tersedia sejak Java 7, sehingga tersedia di Java 8.

### 28.3 `var` dan diamond anonymous class

Jika menulis Java 8 compatible code:

- jangan pakai `var`;
- hati-hati dengan diamond pada anonymous inner class;
- gunakan import eksplisit;
- gunakan `Paths.get`.

Contoh Java 8 style:

```java
Path source = Paths.get("data", "input.csv");
Path target = Paths.get("backup", "input.csv");
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

---

## 29. Anti-Pattern Catalogue

### Anti-pattern 1: Direct overwrite final file

```java
Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
```

Buruk jika target dibaca pihak lain atau file penting.

Lebih baik:

```text
copy to temp -> validate -> atomic move
```

### Anti-pattern 2: Temp file di `/tmp` lalu atomic move ke mounted volume

```java
Path temp = Files.createTempFile("x", ".tmp");
Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
```

Buruk karena `/tmp` bisa beda filesystem.

Lebih baik:

```java
Path temp = Files.createTempFile(target.getParent(), ".x", ".tmp");
```

### Anti-pattern 3: Silent downgrade dari atomic ke non-atomic

```java
catch (AtomicMoveNotSupportedException e) {
    Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
}
```

Buruk jika atomicity adalah invariant.

### Anti-pattern 4: Recursive copy dengan `Files.copy(directory, target)`

```java
Files.copy(srcDir, dstDir);
```

Ini tidak copy isi directory.

### Anti-pattern 5: Menganggap `COPY_ATTRIBUTES` sempurna

```java
Files.copy(source, target, COPY_ATTRIBUTES);
// assume all security metadata preserved
```

Buruk untuk compliance.

### Anti-pattern 6: Menelan IOException

```java
try {
    Files.move(source, target);
} catch (IOException ignored) {
}
```

Buruk karena file workflow harus observable.

### Anti-pattern 7: Memakai user filename sebagai target path final

```java
Path target = uploadDir.resolve(userFileName);
```

Buruk karena traversal/collision/spoofing.

---

## 30. Practical Checklist

Sebelum melakukan copy/move, jawab ini:

```text
[ ] Apakah source harus regular file?
[ ] Apakah symlink boleh?
[ ] Apakah target boleh overwrite?
[ ] Apakah overwrite harus atomic?
[ ] Apakah reader boleh melihat file parsial?
[ ] Apakah source bisa berubah selama operasi?
[ ] Apakah metadata harus dicopy?
[ ] Metadata mana yang benar-benar wajib?
[ ] Apakah source dan target berada di filesystem yang sama?
[ ] Apakah temp file dibuat di target directory?
[ ] Apakah disk penuh/permission/lock ditangani?
[ ] Apakah failure meninggalkan temp/partial file?
[ ] Apakah ada cleanup/recovery job?
[ ] Apakah operasi observable dengan log/metric?
[ ] Apakah path user sudah diamankan?
[ ] Apakah behavior sudah dites di Linux dan Windows jika perlu?
```

---

## 31. Mental Model Final

Copy dan move harus dipahami sebagai operasi dengan domain berbeda:

```text
COPY
  = create new target object
  + transfer bytes or link object
  + optionally preserve selected metadata
  + may leave partial target on failure

MOVE same filesystem
  = usually rename/link metadata operation
  + often fast
  + can be atomic if supported/requested

MOVE cross filesystem
  = may fail
  + may become copy-delete
  + not atomic unless explicitly supported

REPLACE_EXISTING
  = allow target replacement
  != transaction
  != durable
  != metadata preservation

COPY_ATTRIBUTES
  = request metadata copy
  != guarantee full clone

ATOMIC_MOVE
  = require atomic filesystem move
  != durability
  != cross-filesystem magic
  != multi-file transaction

NOFOLLOW_LINKS
  = operate on link object rather than target for supported operations
  != complete sandbox security by itself
```

Top 1% engineer tidak hanya bertanya:

> “Bagaimana cara copy file di Java?”

Tetapi bertanya:

> “Apa invariant workflow ini? Apakah pembaca boleh melihat partial file? Apakah source bisa berubah? Apakah metadata wajib preserved? Apakah symlink aman? Apakah target satu filesystem? Apa state recovery jika crash setelah 70% copy? Apa observability-nya?”

Itulah perbedaan antara code yang hanya jalan di laptop dan file workflow yang bisa dipercaya di production.

---

## 32. Ringkasan Part 08

Di part ini kita mempelajari:

1. `Files.copy` dan `Files.move` adalah request ke filesystem provider, bukan operasi universal yang identik di semua platform.
2. Default copy/move gagal jika target ada, kecuali diberi `REPLACE_EXISTING`.
3. `REPLACE_EXISTING` tidak berarti atomic, durable, atau transaction-safe.
4. `COPY_ATTRIBUTES` meminta metadata ikut dicopy, tetapi tidak menjamin semua metadata preserved.
5. Copy file besar dapat gagal di tengah dan meninggalkan target parsial.
6. Copy directory tidak recursive secara default.
7. Move dalam filesystem yang sama biasanya rename metadata dan bisa cepat.
8. Move lintas filesystem dapat gagal atau menjadi copy-delete non-atomic.
9. `ATOMIC_MOVE` harus dipakai jika atomicity adalah requirement, dan kegagalannya tidak boleh di-downgrade diam-diam.
10. Symbolic link behavior harus didesain eksplisit, terutama untuk security-sensitive workflows.
11. Temp-copy-validate-atomic-move adalah pattern aman untuk publish file final.
12. File operation tidak ikut database transaction, sehingga perlu state machine/recovery.
13. Observability file workflow adalah bagian dari correctness, bukan tambahan kosmetik.

---

## 33. Latihan Pemahaman

### Latihan 1

Anda menerima upload file 300 MB dari user. File harus tersedia di `/data/final/{id}` hanya jika upload lengkap dan valid. Desain flow menggunakan staging, validasi ukuran, dan atomic move.

Pertanyaan:

- Di directory mana temp file dibuat?
- Kapan final path terlihat oleh reader?
- Apa yang terjadi jika upload putus di tengah?
- Apa cleanup strategy-nya?

### Latihan 2

Sebuah batch job memindahkan file dari `inbox` ke `processing`. Ada 5 worker paralel.

Pertanyaan:

- Kenapa rename/move claim lebih baik daripada lock file biasa?
- Apa syarat filesystem agar pattern ini aman?
- Bagaimana recovery jika worker mati setelah claim?

### Latihan 3

Anda diminta “copy file beserta semua permission dan metadata”.

Pertanyaan:

- Metadata apa saja yang harus diklarifikasi?
- Apakah `COPY_ATTRIBUTES` cukup?
- Bagaimana cara memverifikasi metadata critical?
- Apa risiko jika source Linux dan target Windows?

### Latihan 4

`Files.move(temp, target, ATOMIC_MOVE)` gagal di production dengan `AtomicMoveNotSupportedException`.

Pertanyaan:

- Kemungkinan root cause apa?
- Apakah aman fallback ke non-atomic move?
- Bagaimana memperbaiki layout directory?

---

## 34. Preview Part Berikutnya

Part berikutnya:

> **Part 09 — Delete Semantics: Delete, Recursive Delete, Tombstone, and Safe Cleanup**

Kita akan membahas:

- `delete` vs `deleteIfExists`;
- directory not empty;
- recursive delete dengan `walkFileTree`;
- delete open file di Unix vs Windows;
- symlink-safe delete;
- tombstone pattern;
- cleanup stale temp;
- failure recovery untuk delete workflow;
- kenapa delete adalah operasi paling berbahaya jika root/path validation salah.

---

## 35. Status Seri

Seri belum selesai.

Part yang sudah selesai:

```text
Part 00 — Orientation: Mental Model File, Path, Filesystem, dan Storage Boundary
Part 01 — Path Semantics Deep Dive: Name, Root, Absolute, Relative, Normalize, Resolve
Part 02 — File Existence, Type, and Identity: exists Is Not a Lock
Part 03 — File Creation Semantics: Atomic Create, Temp File, Directory Creation
Part 04 — Open Options and File Handles: How Java Opens Files
Part 05 — Reading Files Correctly: Small File, Large File, Streaming, Lazy Lines
Part 06 — Writing Files Correctly: Replace, Append, Flush, Durability
Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move
Part 08 — Copy and Move Semantics: Replace, Attributes, Links, Cross-Device Behavior
```

Part berikutnya:

```text
Part 09 — Delete Semantics: Delete, Recursive Delete, Tombstone, and Safe Cleanup
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 07 — Atomic Update Pattern: Temp File + fsync + Atomic Move](./learn-java-io-file-filesystem-storage-engineering-part-07-atomic-update-pattern.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 09](./learn-java-io-file-filesystem-storage-engineering-part-09-delete-semantics.md)
