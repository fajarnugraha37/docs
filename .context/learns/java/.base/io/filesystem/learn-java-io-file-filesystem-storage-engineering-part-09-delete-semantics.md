# learn-java-io-file-filesystem-storage-engineering — Part 09
# Delete Semantics: Delete, Recursive Delete, Tombstone, and Safe Cleanup

> Target pembaca: engineer yang sudah nyaman dengan Java I/O/NIO dasar, dan ingin memahami deletion sebagai operasi production-grade: benar, aman, idempotent, race-aware, cross-platform aware, dan mudah dioperasikan.
>
> Target versi Java: Java 8 sampai Java 25.
>
> Fokus: `java.nio.file.Files.delete`, `deleteIfExists`, recursive delete dengan `walkFileTree`, symlink-safe cleanup, tombstone pattern, dan strategi desain agar operasi hapus tidak menjadi sumber incident.

---

## 0. Posisi Part Ini Dalam Series

Sampai Part 08, kita sudah membangun mental model bahwa file operation tidak boleh dilihat sebagai sekadar operasi method Java:

```text
Java code
  -> Path
  -> Files / FileChannel
  -> FileSystemProvider
  -> OS syscall / platform API
  -> filesystem metadata
  -> storage / network / container layer
```

Part ini membahas operasi yang terlihat paling sederhana tetapi sering paling berbahaya: **delete**.

Banyak engineer menganggap delete itu mudah:

```java
Files.delete(path);
```

atau:

```java
Files.deleteIfExists(path);
```

Tetapi di production, delete menyentuh banyak hal:

- file mungkin sudah tidak ada;
- path mungkin menunjuk ke symlink;
- file mungkin sedang dibuka proses lain;
- directory mungkin sedang dimutasi proses lain;
- filesystem mungkin network filesystem;
- container volume mungkin punya permission berbeda;
- operasi recursive delete bisa menghapus target yang salah;
- cleanup job bisa bertabrakan dengan writer;
- delete bisa berhasil di Unix tetapi gagal di Windows;
- delete bisa terlihat berhasil tetapi disk space belum kembali karena masih ada open handle;
- `deleteIfExists` tidak berarti operasi aman secara bisnis;
- retry delete tanpa guard bisa berubah menjadi data loss.

Mental model utama Part 09:

> Delete bukan hanya “menghapus file”. Delete adalah operasi perubahan namespace filesystem yang harus dirancang dengan invariant, guard, race handling, dan recovery policy.

---

## 1. Apa Sebenarnya Arti Delete?

Secara konseptual, filesystem punya minimal dua konsep:

1. **directory entry**: nama yang terlihat di directory, misalnya `report.pdf`.
2. **file object / inode / file record / storage object**: entitas internal yang menyimpan data dan metadata.

Saat delete dilakukan terhadap sebuah path, yang biasanya dihapus adalah **entry di namespace**, bukan selalu langsung “byte di disk”.

Pada Unix-like filesystem:

- `delete` biasanya berarti `unlink` directory entry.
- Jika file masih dibuka oleh proses lain, data bisa tetap hidup sampai handle terakhir ditutup.
- Nama file hilang dari directory, tetapi storage bisa belum dibebaskan.

Pada Windows:

- file yang sedang dibuka tanpa sharing delete biasanya tidak bisa dihapus.
- proses lain yang masih memegang handle bisa menyebabkan `AccessDeniedException` atau failure lain.

Jadi operasi delete harus dipahami sebagai:

```text
Remove this path's directory entry if allowed by filesystem rules.
```

Bukan:

```text
Immediately erase all bytes from physical storage.
```

Implikasi penting:

- delete bukan secure erase;
- delete bukan guarantee disk space langsung kembali;
- delete bukan guarantee tidak ada proses lain yang masih punya konten;
- delete bukan distributed transaction;
- delete bukan lock;
- delete bukan validasi ownership bisnis.

---

## 2. Java API Untuk Delete

API utama:

```java
Files.delete(Path path);
Files.deleteIfExists(Path path);
```

Keduanya ada sejak Java 7, jadi tersedia untuk target Java 8–25.

### 2.1 `Files.delete(Path)`

Contoh:

```java
Path p = Path.of("/data/inbox/a.txt"); // Java 11+
Files.delete(p);
```

Java 8 style:

```java
Path p = Paths.get("/data/inbox/a.txt");
Files.delete(p);
```

Behavior utama:

- menghapus file atau empty directory;
- jika file tidak ada, melempar `NoSuchFileException`;
- jika directory tidak kosong, biasanya melempar `DirectoryNotEmptyException`;
- jika permission tidak cukup, biasanya `AccessDeniedException`;
- jika terjadi I/O error lain, `IOException`;
- operasi didelegasikan ke provider default atau provider dari `Path` tersebut.

### 2.2 `Files.deleteIfExists(Path)`

Contoh:

```java
boolean deleted = Files.deleteIfExists(p);
```

Behavior utama:

- menghapus file jika ada;
- return `true` jika file berhasil dihapus;
- return `false` jika file tidak ada;
- tetap bisa melempar `IOException` untuk error lain;
- tetap bisa gagal untuk directory tidak kosong, permission, open handle, dan kondisi filesystem lain.

Yang sering salah:

```java
Files.deleteIfExists(path); // dianggap safe
```

`deleteIfExists` hanya membuat kasus “tidak ada” menjadi non-error. Ia tidak membuat operasi:

- aman dari race;
- aman dari symlink attack;
- aman dari salah root;
- aman secara bisnis;
- atomic terhadap keseluruhan workflow;
- recursive;
- guaranteed berhasil.

---

## 3. Delete File vs Delete Directory

`Files.delete` bisa menghapus:

- regular file;
- symbolic link entry;
- empty directory;
- special file tergantung provider/platform.

Tetapi **tidak menghapus directory yang masih punya isi**.

Contoh:

```java
Path dir = Path.of("/tmp/work");
Files.delete(dir); // hanya berhasil kalau /tmp/work kosong
```

Jika directory berisi file/subdirectory:

```text
DirectoryNotEmptyException
```

Ini behavior yang baik. Recursive delete terlalu berbahaya untuk dijadikan default.

---

## 4. Exception Taxonomy: Jangan Tangkap `IOException` Secara Buta

Delete operation yang robust harus membedakan error class.

### 4.1 `NoSuchFileException`

Artinya path tidak ditemukan saat delete dilakukan.

Contoh:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException e) {
    // File sudah tidak ada.
}
```

Pertanyaan desain:

- Apakah “sudah tidak ada” berarti sukses idempotent?
- Atau berarti bug karena file seharusnya ada?
- Apakah ada proses lain yang menghapus?
- Apakah path salah?

Untuk cleanup job, `NoSuchFileException` sering bisa dianggap idempotent success.

Untuk workflow bisnis, misalnya menghapus attachment milik case, `NoSuchFileException` bisa berarti data drift antara DB dan filesystem.

### 4.2 `DirectoryNotEmptyException`

Artinya target adalah directory yang masih punya entry.

Ini bisa berarti:

- caller salah menghapus directory non-empty;
- directory sedang dimutasi concurrent process;
- hidden file ada;
- symlink/junction behavior berbeda;
- recursive delete harus dipakai;
- cleanup policy belum jelas.

### 4.3 `AccessDeniedException`

Bisa berarti:

- permission tidak cukup;
- target read-only;
- directory parent tidak writable;
- file sedang dibuka proses lain, khususnya Windows;
- antivirus/scanner sedang memegang handle;
- container user tidak cocok dengan file owner;
- mounted volume read-only;
- Windows DOS read-only attribute;
- filesystem policy menolak.

Jangan otomatis menyimpulkan “permission Unix chmod salah”.

### 4.4 `FileSystemLoopException`

Biasanya relevan saat traversal mengikuti link dan menemukan cycle.

### 4.5 Generic `IOException`

Bisa mencakup:

- network filesystem failure;
- device failure;
- transient mount issue;
- stale file handle;
- path too long;
- provider-specific error;
- unexpected OS error.

Production code sebaiknya melog:

- operation;
- normalized/real root context;
- target relative path;
- exception class;
- message;
- whether retryable;
- correlation/job id;
- current workflow state.

---

## 5. `deleteIfExists` Bukan Pengganti Idempotency Design

Idempotency artinya operasi bisa diulang tanpa menghasilkan state salah.

Untuk cleanup:

```java
Files.deleteIfExists(tempFile);
```

sering masuk akal.

Tetapi untuk workflow seperti ini:

```text
1. User requests delete document A
2. Delete file from disk
3. Delete metadata from database
4. Publish event
```

`deleteIfExists` saja tidak cukup.

Kemungkinan failure:

```text
A. File deleted, DB delete failed
B. DB deleted, file delete failed
C. File already missing, DB still says exists
D. Event published, file delete failed
E. Retry sees file missing, assumes full success
```

Solusi tidak bisa hanya `deleteIfExists`. Perlu desain state:

```text
ACTIVE
DELETE_REQUESTED
FILE_DELETE_ATTEMPTED
METADATA_DELETED
DELETED
DELETE_FAILED
```

atau pola tombstone:

```text
ACTIVE -> TOMBSTONED -> PHYSICAL_CLEANED
```

Intinya:

> `deleteIfExists` membuat operasi file-level idempotent terhadap missing path, bukan membuat business workflow idempotent.

---

## 6. Race Condition: Delete Adalah Operasi Di Dunia Yang Bergerak

Filesystem bisa berubah antara dua baris kode.

Anti-pattern:

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Masalah:

```text
Thread A: Files.exists(path) -> true
Thread B: delete(path)
Thread A: Files.delete(path) -> NoSuchFileException
```

Better:

```java
try {
    Files.delete(path);
} catch (NoSuchFileException e) {
    // handle as idempotent or inconsistency depending on use case
}
```

Atau:

```java
boolean deleted = Files.deleteIfExists(path);
```

Tetapi tetap jangan lupakan error lain.

### 6.1 TOCTOU Pada Type Check

Anti-pattern:

```java
if (Files.isRegularFile(path)) {
    Files.delete(path);
}
```

Race:

```text
1. path adalah regular file
2. attacker/proses lain mengganti path menjadi symlink atau directory
3. code delete target baru
```

Untuk delete file biasa, jika path menjadi symlink, `Files.delete(path)` biasanya menghapus link entry, bukan target link. Tetapi untuk recursive delete, traversal dan link-following bisa menjadi jauh lebih berbahaya.

Prinsip:

> Cek sebelum delete hanya membantu diagnosis. Ia bukan authorization, bukan lock, dan bukan guarantee target tetap sama.

---

## 7. Symlink Semantics Saat Delete

Pertanyaan penting:

> Kalau `path` adalah symlink, apakah `Files.delete(path)` menghapus symlink atau targetnya?

Secara umum, delete terhadap symbolic link menghapus link itu sendiri, bukan targetnya.

Contoh:

```text
/data/work/link -> /important/data
```

```java
Files.delete(Path.of("/data/work/link"));
```

Yang dihapus adalah entry `/data/work/link`, bukan `/important/data`.

Namun bahaya muncul pada recursive traversal, terutama jika traversal mengikuti link atau jika root/child bisa diganti saat proses berjalan.

### 7.1 Jangan Follow Link Saat Recursive Delete Kecuali Benar-Benar Perlu

Default `walkFileTree(start, visitor)` tidak mengikuti symbolic links.

Jika memakai option:

```java
EnumSet.of(FileVisitOption.FOLLOW_LINKS)
```

maka traversal bisa masuk ke target link.

Untuk delete cleanup, default yang lebih aman adalah **tidak follow links**.

---

## 8. Recursive Delete Dengan `walkFileTree`

Untuk menghapus directory tree, pattern klasik:

```java
public static void deleteTree(Path root) throws IOException {
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
            if (exc != null) {
                throw exc;
            }
            Files.delete(dir);
            return FileVisitResult.CONTINUE;
        }
    });
}
```

Kenapa directory dihapus di `postVisitDirectory`, bukan `preVisitDirectory`?

Karena directory hanya bisa dihapus setelah isinya dihapus.

```text
preVisitDirectory: sebelum isi dikunjungi
visitFile: untuk file/entry
postVisitDirectory: setelah isi selesai dikunjungi
```

### 8.1 Jangan Pakai `Files.walk(...).sorted(reverseOrder())` Secara Buta

Banyak contoh internet:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.sorted(Comparator.reverseOrder())
         .forEach(p -> {
             try {
                 Files.delete(p);
             } catch (IOException e) {
                 throw new UncheckedIOException(e);
             }
         });
}
```

Ini bisa bekerja untuk kasus kecil, tetapi ada kelemahan:

- sorting seluruh path bisa membutuhkan memory besar;
- error handling kasar;
- traversal dan delete bercampur di stream pipeline;
- sulit melakukan skip subtree;
- sulit membedakan `visitFileFailed`;
- reverse lexical order bukan selalu semantic tree order yang ingin dikelola;
- symlink/cycle/error handling kurang eksplisit.

Untuk production recursive delete, `walkFileTree` lebih eksplisit dan lebih mudah dibuat robust.

---

## 9. Recursive Delete Harus Punya Root Guard

Ini wajib.

Bahaya:

```java
deleteTree(userProvidedPath);
```

Jika `userProvidedPath` salah menjadi:

```text
/
C:\
/home/app
/data
..
```

bisa catastrophic.

Minimal guard:

```java
public static void assertSafeDeleteRoot(Path baseDir, Path candidate) throws IOException {
    Path realBase = baseDir.toRealPath();
    Path realCandidate = candidate.toRealPath();

    if (!realCandidate.startsWith(realBase)) {
        throw new SecurityException("Delete target escapes base directory: " + candidate);
    }

    if (realCandidate.equals(realBase)) {
        throw new SecurityException("Refusing to delete base directory itself: " + realBase);
    }
}
```

Namun ini belum sempurna untuk semua symlink race. Untuk high-security use case, perlu desain lebih ketat:

- gunakan storage name internal, bukan path dari user;
- jangan expose path absolut;
- root directory owned by app;
- permission directory tidak writable oleh user lain;
- jangan follow symlink;
- validate setiap traversal entry;
- gunakan allowlist directory layout;
- gunakan random IDs untuk object storage path;
- hindari recursive delete terhadap path dari request langsung.

### 9.1 Safe Delete Root Policy

Buat policy eksplisit:

```text
Allowed delete roots:
  /data/app/tmp/jobs/<job-id>
  /data/app/quarantine/<batch-id>
  /data/app/staging/<upload-id>

Forbidden:
  /data/app
  /data
  /
  current working directory
  user home
  classpath/resource directory
```

Dalam kode:

```java
public final class DeletePolicy {
    private final Path stagingRoot;

    public DeletePolicy(Path stagingRoot) throws IOException {
        this.stagingRoot = stagingRoot.toRealPath();
    }

    public Path resolveJobDir(String jobId) throws IOException {
        if (!jobId.matches("[A-Za-z0-9_-]{1,80}")) {
            throw new IllegalArgumentException("Invalid job id");
        }

        Path candidate = stagingRoot.resolve(jobId).normalize();
        Path parent = candidate.getParent().toRealPath();

        if (!parent.equals(stagingRoot)) {
            throw new SecurityException("Escaped staging root");
        }

        return candidate;
    }
}
```

Perhatikan: validasi ID dilakukan sebelum resolve. Ini jauh lebih aman daripada menerima path arbitrary.

---

## 10. `visitFileFailed`: Jangan Diabaikan

Saat traversal, beberapa file mungkin gagal dikunjungi.

Contoh penyebab:

- permission denied;
- file hilang saat traversal;
- symlink broken;
- directory berubah;
- network filesystem error;
- path too long;
- file locked.

Default `SimpleFileVisitor` melempar error. Untuk cleanup production, kita perlu memutuskan policy:

1. fail-fast;
2. best-effort continue;
3. collect errors then throw aggregate;
4. quarantine failed paths;
5. retry transient failure.

Contoh aggregate error sederhana:

```java
public static void deleteTreeBestEffort(Path root) throws IOException {
    List<IOException> errors = new ArrayList<>();

    Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
            try {
                Files.deleteIfExists(file);
            } catch (IOException e) {
                errors.add(e);
            }
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult visitFileFailed(Path file, IOException exc) {
            errors.add(exc);
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
            if (exc != null) {
                errors.add(exc);
            }
            try {
                Files.deleteIfExists(dir);
            } catch (IOException e) {
                errors.add(e);
            }
            return FileVisitResult.CONTINUE;
        }
    });

    if (!errors.isEmpty()) {
        IOException top = new IOException("Failed to delete tree: " + root);
        for (IOException e : errors) {
            top.addSuppressed(e);
        }
        throw top;
    }
}
```

Trade-off:

- fail-fast lebih aman untuk operasi kritikal;
- best-effort cocok untuk cleanup temporary;
- aggregate cocok untuk operational diagnosis.

---

## 11. Concurrent Mutation Saat Recursive Delete

Directory tree bisa berubah saat sedang dihapus.

Scenario:

```text
Cleaner starts deleting /tmp/job-123
Another thread creates /tmp/job-123/new.log
Cleaner deletes old files
Cleaner tries delete /tmp/job-123
DirectoryNotEmptyException
```

Ini bukan bug Java. Ini race desain.

Solusi desain:

### 11.1 Ownership Invariant

Sebelum delete tree, pastikan tidak ada writer yang masih boleh menulis ke tree tersebut.

Contoh state:

```text
RUNNING -> STOPPING -> CLOSED -> CLEANUP_READY -> DELETED
```

Delete hanya boleh pada state `CLEANUP_READY`.

### 11.2 Rename-to-Trash First

Alih-alih menghapus langsung path aktif:

```text
/data/jobs/job-123
```

rename dulu ke area trash:

```text
/data/.trash/job-123-<timestamp>-<random>
```

Lalu hapus dari trash asynchronously/synchronously.

Keuntungan:

- path aktif cepat hilang;
- writer yang mencoba path lama akan gagal jika desainnya benar;
- cleanup bisa retry tanpa mengganggu namespace aktif;
- recovery lebih mudah.

Contoh:

```java
public static Path moveToTrash(Path activeDir, Path trashRoot) throws IOException {
    Files.createDirectories(trashRoot);

    String trashName = activeDir.getFileName() + "-" + System.currentTimeMillis() + "-" + UUID.randomUUID();
    Path trashPath = trashRoot.resolve(trashName);

    return Files.move(activeDir, trashPath, StandardCopyOption.ATOMIC_MOVE);
}
```

Catatan:

- `ATOMIC_MOVE` hanya jika didukung dan same filesystem;
- fallback non-atomic harus dipikirkan;
- trash root harus di filesystem yang sama untuk rename murah dan atomic.

---

## 12. Tombstone Pattern

Tombstone adalah representasi state bahwa sesuatu secara logical sudah dihapus, meskipun physical bytes mungkin belum dibersihkan.

### 12.1 Kenapa Tombstone?

Karena physical delete sering tidak bisa dijadikan bagian dari transaksi bisnis yang atomic.

Misalnya:

```text
Database metadata + filesystem payload
```

Jika delete file dulu lalu DB gagal, metadata masih menunjuk file hilang.

Jika DB delete dulu lalu file delete gagal, file orphan tertinggal.

Tombstone pattern:

```text
ACTIVE
  -> DELETE_REQUESTED
  -> TOMBSTONED / LOGICALLY_DELETED
  -> PHYSICAL_DELETE_PENDING
  -> PHYSICALLY_DELETED
```

Query user hanya melihat record non-tombstoned.

Cleaner kemudian menghapus physical file berdasarkan tombstone.

### 12.2 Tombstone Metadata

Contoh metadata:

```json
{
  "objectId": "doc-123",
  "storagePath": "objects/ab/cd/doc-123.bin",
  "state": "TOMBSTONED",
  "deletedAt": "2026-06-18T02:00:00Z",
  "deleteReason": "USER_REQUEST",
  "physicalDeleteAttempt": 3,
  "lastDeleteError": "AccessDeniedException: ..."
}
```

### 12.3 Tombstone Benefits

- logical delete cepat;
- physical cleanup retryable;
- audit trail jelas;
- recovery dari partial failure lebih mudah;
- user-facing state tidak bergantung pada immediate filesystem delete;
- cocok untuk regulatory system yang butuh defensibility.

### 12.4 Tombstone Risk

- storage bisa membengkak jika cleaner gagal;
- retention policy harus jelas;
- data privacy/compliance harus hati-hati;
- tombstone bukan secure deletion;
- backup mungkin masih menyimpan file;
- logical delete dan legal hold bisa konflik.

---

## 13. Trash/Quarantine Pattern

Delete permanen kadang terlalu agresif. Alternatif:

```text
active/ -> trash/ -> deleted
```

atau:

```text
active/ -> quarantine/ -> manual review -> deleted/restored
```

### 13.1 Trash Pattern

Cocok untuk:

- cleanup job;
- temporary work directories;
- generated artifacts;
- retryable deletion.

Flow:

```text
1. Atomically move active object to trash
2. Mark metadata as trash/pending cleanup
3. Background cleaner deletes old trash entries
4. Metrics expose trash backlog
```

### 13.2 Quarantine Pattern

Cocok untuk:

- suspicious uploads;
- failed validation;
- corrupted files;
- malware scan failure;
- regulatory evidence review.

Flow:

```text
1. Move file to quarantine
2. Make it inaccessible from normal workflow
3. Keep metadata and reason
4. Manual/automated review
5. Delete or restore
```

Invariants:

- quarantined file must not be served to users;
- quarantine location must not be executable;
- quarantine must be access-controlled;
- deletion from quarantine should be audited.

---

## 14. Safe Cleanup Job Design

A cleanup job should not be just:

```java
Files.walk(tempDir).forEach(delete);
```

Production cleanup needs policy.

### 14.1 Cleanup Policy Questions

Untuk setiap file yang akan dihapus:

- Siapa owner-nya?
- Apakah file masih bisa dipakai writer?
- Apakah ada retention period?
- Apakah ada legal hold?
- Apakah file generated atau user-submitted?
- Apakah metadata DB masih menunjuk file ini?
- Apakah file sedang diproses?
- Apakah delete boleh best-effort?
- Apakah delete perlu audit?
- Apakah harus secure erase? Jika iya, filesystem delete tidak cukup.

### 14.2 Cleanup Candidate Selection

Anti-pattern:

```java
delete everything older than 1 day under /data
```

Better:

```text
Delete only files under /data/app/tmp/jobs
where:
  - name matches internal job id pattern
  - marker file _CLOSED exists
  - lastModifiedTime older than retention
  - metadata state is CLEANUP_READY
  - not currently leased
```

### 14.3 Marker-Based Cleanup

Contoh directory job:

```text
job-123/
  input.bin
  output.tmp
  _CLOSED
```

Cleaner hanya menghapus directory yang punya `_CLOSED`.

```java
boolean cleanupReady(Path jobDir) {
    return Files.isRegularFile(jobDir.resolve("_CLOSED"));
}
```

Namun marker juga bisa stale. Untuk sistem kritikal, marker harus dikombinasikan dengan metadata state.

---

## 15. Retry Delete: Perlu Klasifikasi Error

Tidak semua delete failure layak retry.

### 15.1 Retryable Candidate

Mungkin retryable:

- file temporarily locked;
- antivirus scanning;
- transient network filesystem issue;
- directory concurrently mutated;
- stale mount glitch.

### 15.2 Non-Retryable Candidate

Biasanya tidak berguna retry tanpa perubahan:

- permission denied karena ownership salah;
- path outside allowed root;
- directory not empty karena policy salah;
- read-only filesystem;
- invalid path;
- legal hold;
- business state not deletable.

### 15.3 Backoff

Jangan retry tight loop:

```java
for (;;) {
    try {
        Files.delete(path);
        break;
    } catch (IOException ignored) {
    }
}
```

Gunakan bounded retry:

```java
public static boolean deleteWithSmallRetry(Path path) throws IOException, InterruptedException {
    int[] sleepsMillis = {100, 300, 1000};

    for (int i = 0; i <= sleepsMillis.length; i++) {
        try {
            return Files.deleteIfExists(path);
        } catch (AccessDeniedException e) {
            if (i == sleepsMillis.length) throw e;
            Thread.sleep(sleepsMillis[i]);
        }
    }

    return false;
}
```

Catatan:

- Jangan retry security violation;
- Jangan retry path escape;
- Jangan retry selamanya;
- Log attempt count;
- Publish metric.

---

## 16. Windows vs Unix Delete Semantics

### 16.1 Unix-Like

Umumnya:

- delete regular file yang masih terbuka bisa berhasil;
- directory entry hilang;
- storage baru bebas setelah handle terakhir ditutup;
- proses yang sudah membuka file masih bisa membaca/menulis via file descriptor;
- path tidak bisa dipakai lagi untuk membuka file baru.

Dampak production:

- disk usage bisa tidak turun setelah delete;
- `lsof` bisa menunjukkan deleted-but-open file;
- log rotation bisa gagal reclaim kalau process masih menulis descriptor lama;
- cleanup “berhasil” tetapi capacity belum kembali.

### 16.2 Windows

Umumnya:

- delete file yang sedang dibuka bisa gagal jika sharing mode tidak mengizinkan delete;
- antivirus/indexer bisa menyebabkan transient access denied;
- read-only attribute bisa menghambat delete;
- mapped file bisa mencegah delete;
- behavior berbeda antara `java.io.File.delete` dan NIO exceptions dalam hal observability.

Dampak production:

- test di Linux container lolos, production Windows gagal;
- cleanup temp file flaky;
- resource leak cepat terlihat sebagai delete failure;
- perlu close stream/channel/mapped buffer dengan disiplin.

### 16.3 Java 25 Note Untuk `java.io.File.delete` di Windows

Ada perubahan behavior di JDK 25 terkait `File.delete` pada Windows untuk file read-only: sebelumnya JDK dapat menghapus read-only file dengan menghapus DOS read-only attribute dulu, sedangkan di JDK 25 `File.delete` gagal dan return `false` untuk regular file dengan DOS read-only attribute. Ini relevan terutama jika masih memakai legacy `java.io.File.delete`.

Untuk seri ini, default API yang kita pilih tetap `java.nio.file.Files.delete`, karena exception model-nya lebih eksplisit.

---

## 17. Secure Delete vs Filesystem Delete

Filesystem delete bukan secure erase.

Jika requirement-nya:

```text
Data harus tidak bisa dipulihkan secara forensic.
```

maka `Files.delete` tidak cukup.

Kenapa?

- SSD wear leveling;
- filesystem journaling;
- copy-on-write filesystem;
- snapshots;
- backups;
- cloud block storage replication;
- object storage versioning;
- OS page cache;
- temporary copies;
- application logs;
- antivirus cache;
- database metadata.

Untuk secure deletion, biasanya pendekatan yang lebih realistis:

- encrypt data at rest;
- delete/destroy encryption key;
- enforce retention policy;
- handle backup lifecycle;
- use storage provider lifecycle controls;
- audit deletion process;
- legal/compliance sign-off.

Mental model:

> Delete path menghapus entry. Secure erase adalah problem storage governance dan cryptographic lifecycle, bukan sekadar API call.

---

## 18. Delete dan Disk Space: Kenapa Space Tidak Langsung Turun?

Kemungkinan:

- file masih open by process;
- filesystem delayed allocation;
- snapshots menahan block;
- trash/recycle bin layer;
- container writable layer berbeda;
- overlay filesystem;
- quota accounting delay;
- hard link lain masih menunjuk file yang sama;
- database-like file preallocation;
- network filesystem cache.

Checklist diagnosis:

```text
1. Apakah path benar-benar hilang dari directory?
2. Apakah file punya hard link lain?
3. Apakah ada process masih membuka deleted file?
4. Apakah filesystem punya snapshot?
5. Apakah kita melihat disk usage host atau container?
6. Apakah file ada di mounted volume atau overlay layer?
7. Apakah quota berbeda dengan df output?
8. Apakah cleanup hanya memindahkan ke trash?
```

Untuk Java app, log delete success saja tidak cukup. Tambahkan metric disk/free space dari `FileStore` di Part 16 nanti.

---

## 19. Hard Link Implication

Hard link berarti beberapa directory entry bisa menunjuk file object yang sama.

Jika delete satu path:

```text
/data/a.bin
/data/b.bin
```

keduanya mungkin hard link ke konten yang sama.

Delete `/data/a.bin` tidak menghapus data jika `/data/b.bin` masih ada.

Java bisa membuat hard link:

```java
Files.createLink(link, existing);
```

Implikasi:

- delete path bukan delete content jika ada hard link lain;
- disk space tidak turun sampai link count nol dan handle tertutup;
- dedup/hardlink-based storage harus hati-hati;
- compliance delete by path bisa tidak cukup.

Basic Java API tidak selalu expose link count secara portable. POSIX/Unix-specific attribute bisa dibaca lewat provider-specific attributes, tetapi tidak portable.

---

## 20. `deleteOnExit`: Hampir Selalu Bukan Untuk Server

Legacy API:

```java
File file = ...;
file.deleteOnExit();
```

Masalah:

- delete dilakukan saat JVM exit normal;
- daftar file disimpan internal sampai JVM exit;
- long-running server bisa accumulate memory;
- tidak cocok untuk banyak temp files;
- tidak jalan jika JVM crash/hard kill;
- urutan deletion bisa penting dan sulit dikontrol;
- tidak cocok untuk service/container yang jarang exit normal.

Untuk server, lebih baik:

- explicit cleanup;
- try/finally;
- scheduled cleanup;
- temp directory per job;
- marker-based cleanup;
- tombstone/trash cleanup.

`deleteOnExit` masih bisa berguna untuk:

- command-line tool kecil;
- test sederhana;
- short-lived process;
- fallback safety net terbatas.

---

## 21. Designing Delete As State Machine

Untuk top-level engineering, jangan pikirkan delete sebagai method call. Pikirkan sebagai state machine.

### 21.1 Temporary Job Directory

```text
CREATED
  -> WRITING
  -> CLOSED
  -> CLEANUP_READY
  -> DELETING
  -> DELETED
  -> DELETE_FAILED
```

Invariant:

```text
Only CLOSED/CLEANUP_READY jobs can be deleted.
WRITING jobs must never be deleted.
DELETE_FAILED jobs must retain enough diagnostic metadata.
```

### 21.2 User Document

```text
ACTIVE
  -> DELETE_REQUESTED
  -> TOMBSTONED
  -> PHYSICAL_DELETE_PENDING
  -> PHYSICAL_DELETED
```

Invariant:

```text
TOMBSTONED document is not visible to normal reads.
Physical delete can retry without resurrecting document.
Audit record remains even after physical file is gone.
```

### 21.3 File Intake Engine

```text
STAGED
  -> ACCEPTED
  -> PROCESSING
  -> DONE
  -> RETENTION_WAIT
  -> CLEANUP_READY
  -> ARCHIVED_OR_DELETED
```

Invariant:

```text
Cleaner only touches CLEANUP_READY.
Cleaner never scans arbitrary active directories.
```

---

## 22. Production-Grade Delete Utility

Berikut utility yang sengaja konservatif.

Tujuan:

- delete tree hanya di bawah allowed root;
- tidak menerima arbitrary path escape;
- tidak follow links;
- aggregate error;
- menolak delete root itu sendiri;
- cocok sebagai fondasi cleanup job.

```java
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public final class SafeDelete {
    private final Path allowedRootReal;

    public SafeDelete(Path allowedRoot) throws IOException {
        Objects.requireNonNull(allowedRoot, "allowedRoot");
        this.allowedRootReal = allowedRoot.toRealPath();
    }

    public DeleteResult deleteSubtree(Path candidate) throws IOException {
        Objects.requireNonNull(candidate, "candidate");

        Path realCandidate = candidate.toRealPath();

        if (realCandidate.equals(allowedRootReal)) {
            throw new SecurityException("Refusing to delete allowed root itself: " + allowedRootReal);
        }

        if (!realCandidate.startsWith(allowedRootReal)) {
            throw new SecurityException("Delete target escapes allowed root: " + candidate);
        }

        List<IOException> errors = new ArrayList<>();
        int[] deletedFiles = {0};
        int[] deletedDirectories = {0};

        Files.walkFileTree(realCandidate, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                try {
                    Files.deleteIfExists(file);
                    deletedFiles[0]++;
                } catch (IOException e) {
                    errors.add(e);
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                errors.add(exc);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
                if (exc != null) {
                    errors.add(exc);
                }

                try {
                    Files.deleteIfExists(dir);
                    deletedDirectories[0]++;
                } catch (IOException e) {
                    errors.add(e);
                }

                return FileVisitResult.CONTINUE;
            }
        });

        if (!errors.isEmpty()) {
            IOException aggregate = new IOException("Failed to fully delete subtree: " + realCandidate);
            for (IOException error : errors) {
                aggregate.addSuppressed(error);
            }
            throw aggregate;
        }

        return new DeleteResult(realCandidate, deletedFiles[0], deletedDirectories[0]);
    }

    public static final class DeleteResult {
        private final Path root;
        private final int files;
        private final int directories;

        public DeleteResult(Path root, int files, int directories) {
            this.root = root;
            this.files = files;
            this.directories = directories;
        }

        public Path root() {
            return root;
        }

        public int files() {
            return files;
        }

        public int directories() {
            return directories;
        }

        @Override
        public String toString() {
            return "DeleteResult{" +
                    "root=" + root +
                    ", files=" + files +
                    ", directories=" + directories +
                    '}';
        }
    }
}
```

### 22.1 Keterbatasan Utility Ini

Utility ini belum sempurna terhadap semua adversarial symlink race karena:

- `toRealPath` dilakukan sebelum traversal;
- tree bisa berubah setelah validasi;
- jika allowed root writable oleh attacker, masih ada risiko swap entry;
- Java portable API tidak memberikan semua primitive openat/unlinkat style yang biasa dipakai untuk hardening level OS.

Untuk high-security environment:

- jangan izinkan attacker menulis di parent directory;
- gunakan internal object ID;
- jangan follow symlink;
- validasi setiap entry relatif terhadap root jika perlu;
- isolate storage per tenant;
- pakai permission OS/container yang ketat;
- pertimbangkan native/hardened deletion primitive jika threat model tinggi.

---

## 23. Delete File Tunggal Dengan Intent Eksplisit

Utility untuk file tunggal sebaiknya encode intent.

```java
public enum MissingPolicy {
    ERROR,
    IGNORE_AS_SUCCESS
}
```

```java
public static boolean deleteSingleFile(Path file, MissingPolicy missingPolicy) throws IOException {
    try {
        Files.delete(file);
        return true;
    } catch (NoSuchFileException e) {
        if (missingPolicy == MissingPolicy.IGNORE_AS_SUCCESS) {
            return false;
        }
        throw e;
    }
}
```

Mengapa bukan selalu `deleteIfExists`?

Karena policy missing harus terlihat jelas.

Untuk business object:

```java
boolean deleted = deleteSingleFile(path, MissingPolicy.ERROR);
```

Untuk temp cleanup:

```java
boolean deleted = deleteSingleFile(path, MissingPolicy.IGNORE_AS_SUCCESS);
```

Kode menjadi self-documenting.

---

## 24. Delete Dalam Upload/File-Intake Workflow

Misalnya file upload disimpan seperti ini:

```text
/data/app/uploads/staging/<upload-id>/payload.bin
/data/app/uploads/objects/<hash-prefix>/<object-id>.bin
/data/app/uploads/quarantine/<upload-id>/payload.bin
```

Delete rules:

```text
staging:
  boleh dihapus setelah upload finalized/cancelled/expired

objects:
  tidak boleh dihapus langsung kecuali metadata tombstoned dan retention selesai

quarantine:
  boleh dihapus setelah review/retention selesai
```

Anti-pattern:

```java
deleteTree(Path.of(request.getParameter("path")));
```

Better:

```java
Path stagingDir = stagingRoot.resolve(uploadId); // uploadId validated as ID, not path
cleanupService.deleteExpiredStaging(uploadId);
```

Core invariant:

> User request membawa ID bisnis, bukan filesystem path.

---

## 25. Delete Dalam Export/Report Workflow

Contoh:

```text
/reports/tmp/job-123/report.csv.tmp
/reports/out/job-123/report.csv
```

Delete policy:

- `.tmp` boleh dibersihkan jika job failed/expired;
- output final boleh dihapus setelah retention;
- active download jangan bergantung pada path yang bisa dihapus cleanup;
- kalau file masih di-stream ke client, deletion behavior berbeda antar OS.

Safer design:

```text
1. Generate ke staging
2. Atomic move ke out
3. Metadata status AVAILABLE
4. Retention scheduler tombstone
5. Cleanup physical setelah grace period
```

Jangan delete output final berdasarkan `lastModifiedTime` saja kalau ada metadata bisnis.

---

## 26. Delete Dalam Log/Rotation Workflow

Untuk log:

- Java app biasanya lebih baik log ke stdout di container;
- kalau file log dipakai, log rotation harus koordinasi dengan writer;
- Unix memungkinkan deleted file tetap ditulis oleh process;
- Windows bisa menolak rename/delete file terbuka.

Pattern:

- gunakan logging framework rotation policy;
- jangan custom delete file log aktif;
- cleanup hanya archived logs;
- gunakan age+size+count policy;
- monitor disk usage;
- pastikan writer reopen file setelah rotation jika diperlukan.

---

## 27. Observability Untuk Delete

Minimal log event:

```json
{
  "operation": "delete_tree",
  "targetRoot": "job-123",
  "allowedRoot": "/data/app/tmp/jobs",
  "filesDeleted": 42,
  "directoriesDeleted": 5,
  "durationMs": 183,
  "result": "success",
  "correlationId": "..."
}
```

Untuk failure:

```json
{
  "operation": "delete_file",
  "target": "objects/ab/cd/doc-123.bin",
  "exceptionClass": "java.nio.file.AccessDeniedException",
  "message": "...",
  "attempt": 3,
  "retryable": true,
  "state": "PHYSICAL_DELETE_PENDING",
  "correlationId": "..."
}
```

Metrics:

```text
delete_attempt_total{type="file|tree", result="success|failure"}
delete_duration_ms{type="file|tree"}
delete_bytes_estimated_total
delete_failed_total{exception="AccessDeniedException"}
cleanup_backlog_count{state="pending|failed"}
trash_age_seconds_max
quarantine_count
```

Alert candidates:

- cleanup backlog growing;
- delete failure rate high;
- disk usable space low;
- trash age exceeds SLA;
- quarantine grows unexpectedly;
- repeated `AccessDeniedException` after deployment.

---

## 28. Common Anti-Patterns

### 28.1 Blind Recursive Delete

```java
deleteTree(pathFromRequest);
```

Masalah:

- path traversal;
- wrong root;
- symlink issue;
- user can delete arbitrary tree.

### 28.2 Existence Check Before Delete

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Masalah:

- TOCTOU;
- tidak menyederhanakan error;
- menciptakan false confidence.

### 28.3 Swallow Exception

```java
try {
    Files.delete(path);
} catch (IOException ignored) {
}
```

Masalah:

- orphan file;
- disk full later;
- no audit;
- no operational signal.

### 28.4 `deleteOnExit` Pada Server

```java
tempFile.toFile().deleteOnExit();
```

Masalah:

- memory retention;
- tidak jalan sampai JVM exit;
- tidak reliable untuk cleanup server.

### 28.5 Cleanup Berdasarkan Umur Saja

```java
if (lastModified < cutoff) delete(path);
```

Masalah:

- file masih aktif tapi timestamp lama;
- timestamp tidak reliable across systems;
- bisnis state diabaikan.

### 28.6 Retry Forever

```java
while (!deleted) retry();
```

Masalah:

- CPU burn;
- log spam;
- menutupi permission/config bug;
- bisa mengganggu filesystem.

---

## 29. Mental Model: Delete Is Namespace Mutation

Ringkasnya:

```text
Delete path
  = remove a directory entry if allowed
  != erase bytes immediately
  != free disk immediately
  != business deletion transaction
  != safe recursive cleanup
  != authorization
  != lock
  != secure erase
```

Untuk engineer top-tier, pertanyaan sebelum delete:

```text
1. Apakah target ini benar-benar boleh dihapus?
2. Apakah path berasal dari input user atau ID internal?
3. Apakah target berada di allowed root?
4. Apakah target root itu sendiri?
5. Apakah workflow masih bisa menulis ke target?
6. Apakah ada metadata bisnis yang harus ditombstone dulu?
7. Apakah delete harus immediate atau boleh async cleanup?
8. Apakah recursive delete mengikuti symlink?
9. Apakah kegagalan delete retryable?
10. Apakah hasil delete diobservasi?
11. Apakah disk space harus langsung turun?
12. Apakah compliance butuh secure erase/key destruction?
```

---

## 30. Java 8–25 Compatibility Notes

### 30.1 Path Creation

Java 8:

```java
Path path = Paths.get("/data/file.txt");
```

Java 11+:

```java
Path path = Path.of("/data/file.txt");
```

Untuk library yang harus support Java 8, gunakan `Paths.get`.

### 30.2 Delete API

Available sejak Java 7:

```java
Files.delete(Path)
Files.deleteIfExists(Path)
Files.walkFileTree(...)
SimpleFileVisitor
```

Aman untuk Java 8–25.

### 30.3 Legacy `File.delete`

`java.io.File.delete()` return boolean, bukan exception detail. Untuk production, lebih baik NIO:

```java
Files.delete(file.toPath());
```

NIO exception memberi diagnosis lebih baik.

### 30.4 Windows Behavior Changes

JDK 25 memperketat behavior legacy `File.delete` pada Windows untuk regular file read-only. Ini alasan tambahan untuk menghindari reliance pada behavior historis `File.delete`.

---

## 31. Practical Checklist

### 31.1 Single File Delete Checklist

```text
[ ] Missing file policy jelas: error atau ignore?
[ ] Exception class dilog dengan benar?
[ ] Path bukan input user mentah?
[ ] Parent/root policy jelas?
[ ] File mungkin sedang dibuka proses lain?
[ ] Delete failure punya retry/alert?
[ ] Business metadata konsisten?
```

### 31.2 Recursive Delete Checklist

```text
[ ] Allowed root divalidasi?
[ ] Menolak delete root itu sendiri?
[ ] Tidak follow symlink secara default?
[ ] Ada ownership/lifecycle state sebelum cleanup?
[ ] Ada aggregate error?
[ ] Ada observability?
[ ] Ada bounded retry untuk transient failure?
[ ] Tidak memakai path dari request langsung?
[ ] Sudah diuji di Windows/Linux jika cross-platform?
```

### 31.3 Cleanup Job Checklist

```text
[ ] Candidate dipilih berdasarkan state, bukan umur saja?
[ ] Ada retention/grace period?
[ ] Ada marker/metadata cleanup-ready?
[ ] Ada backlog metric?
[ ] Ada failure quarantine atau retry queue?
[ ] Ada disk-space alert?
[ ] Ada audit jika data user/regulatory?
```

---

## 32. Exercises

### Exercise 1 — Idempotent Temp Cleanup

Buat method:

```java
void cleanupTempFile(Path path)
```

Requirement:

- missing file dianggap sukses;
- `AccessDeniedException` dilog dan dilempar;
- exception lain dilempar;
- tidak melakukan `exists` sebelum delete.

### Exercise 2 — Safe Recursive Delete

Buat class:

```java
SafeRecursiveDeleter(Path allowedRoot)
```

Requirement:

- menolak delete allowed root;
- menolak target di luar root;
- tidak follow symlink;
- menggunakan `walkFileTree`;
- mengumpulkan suppressed exceptions.

### Exercise 3 — Tombstone Cleanup

Desain state table untuk object file:

```text
ACTIVE
TOMBSTONED
PHYSICAL_DELETE_PENDING
PHYSICAL_DELETE_FAILED
PHYSICAL_DELETED
```

Tentukan:

- transition yang valid;
- siapa yang boleh menjalankan transition;
- kapan file fisik boleh dihapus;
- bagaimana retry dilakukan;
- metric apa yang harus ada.

### Exercise 4 — Cross-Platform Delete Test

Buat test yang membandingkan behavior:

- delete file biasa;
- delete missing file;
- delete non-empty directory;
- delete symlink;
- delete file yang stream-nya masih terbuka.

Jalankan di Linux dan Windows jika memungkinkan.

---

## 33. Key Takeaways

1. `Files.delete` menghapus path entry, bukan menjamin secure erase atau immediate disk reclaim.
2. `deleteIfExists` hanya membuat missing path menjadi non-error; ia bukan solusi idempotency bisnis.
3. Recursive delete harus menggunakan root guard, lifecycle guard, dan symlink policy.
4. `walkFileTree` lebih cocok untuk recursive delete production dibanding stream one-liner.
5. Delete failure harus diklasifikasikan: missing, not empty, access denied, loop, transient I/O.
6. Windows dan Unix punya perbedaan besar pada file yang masih terbuka.
7. Tombstone/trash/quarantine sering lebih aman daripada immediate physical delete.
8. Cleanup job harus berbasis state dan policy, bukan scan umur mentah.
9. Secure deletion adalah masalah storage governance/encryption lifecycle, bukan sekadar `Files.delete`.
10. Delete harus diperlakukan sebagai stateful workflow, bukan hanya API call.

---

## 34. Koneksi Ke Part Berikutnya

Part 09 menyelesaikan operasi penghapusan. Berikutnya kita akan masuk ke:

```text
Part 10 — Directory Listing and Traversal: list, walk, find, DirectoryStream
```

Kenapa traversal dibahas setelah delete?

Karena banyak operasi delete, copy, audit, checksum, cleanup, indexing, import/export, dan security scan bergantung pada traversal. Kita perlu memahami:

- `Files.list`;
- `Files.walk`;
- `Files.find`;
- `DirectoryStream`;
- laziness;
- stream closing;
- traversal order;
- error handling;
- concurrent mutation;
- directory dengan jutaan file.

Part 10 akan memperdalam traversal sebagai primitive fundamental untuk filesystem engineering.

---

## 35. Referensi Utama

- Oracle Java SE 25 API — `java.nio.file.Files`
- Oracle Java SE 25 API — `java.nio.file.spi.FileSystemProvider`
- Oracle Java SE 8 API — `java.nio.file.FileVisitor`
- Oracle Java Tutorials — Walking the File Tree
- Oracle Java SE 25 API — `java.io.File`
- Inside Java — JDK 25 Windows `File.delete` behavior change note

