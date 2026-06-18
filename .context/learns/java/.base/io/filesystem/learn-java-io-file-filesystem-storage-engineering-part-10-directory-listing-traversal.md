# learn-java-io-file-filesystem-storage-engineering

## Part 10 — Directory Listing and Traversal: `list`, `walk`, `find`, `DirectoryStream`

> Target pembaca: engineer yang sudah nyaman dengan Java, NIO.2, stream, exception handling, dan production system design, tetapi ingin memahami **directory listing/traversal** pada level yang benar-benar operasional: correctness, security, performance, lifecycle, concurrency, dan filesystem boundary.

---

## 0. Posisi Part Ini di Dalam Seri

Pada part sebelumnya kita sudah membahas:

1. file dan filesystem boundary,
2. path semantics,
3. existence/type/identity,
4. creation semantics,
5. open options dan file handle,
6. reading,
7. writing,
8. atomic update,
9. copy/move,
10. delete semantics.

Sekarang kita masuk ke operasi yang terlihat sederhana tetapi sering menjadi sumber bug besar:

```java
Files.list(dir)
Files.walk(root)
Files.find(root, depth, matcher)
Files.newDirectoryStream(dir)
Files.walkFileTree(root, visitor)
```

Secara permukaan, semua tampak seperti “ambil isi folder”. Pada production system, perbedaannya besar:

- ada API yang hanya membaca **satu level directory**,
- ada API yang melakukan **recursive traversal**,
- ada API yang memakai Java Stream dan harus ditutup,
- ada API yang lebih cocok untuk directory sangat besar,
- ada API yang cocok untuk error handling granular,
- ada API yang rawan symlink loop kalau salah option,
- ada API yang weakly consistent ketika tree berubah selama traversal,
- ada API yang kelihatannya nyaman tetapi bisa menahan banyak resource lebih lama dari yang disadari.

Part ini membangun mental model agar kita tidak sekadar tahu “cara list file”, tetapi bisa mendesain traversal yang benar untuk:

- file intake engine,
- recursive delete/copy/checksum,
- filesystem scanner,
- cleanup job,
- malware/file validation pipeline,
- import/export batch,
- directory synchronization,
- config reload,
- audit/reporting atas storage area,
- compliance evidence collection.

---

## 1. Mental Model Utama: Directory Bukan Array

Kesalahan pertama engineer junior sampai senior adalah membayangkan directory seperti ini:

```text
Directory = List<File>
```

Padahal directory lebih tepat dipahami sebagai:

```text
Directory = struktur metadata filesystem yang berisi entry nama → referensi object filesystem
```

Entry directory bisa menunjuk ke:

- regular file,
- directory lain,
- symbolic link,
- special file,
- device node,
- pipe/socket pada Unix-like filesystem,
- provider-specific object,
- entry yang berubah/dihapus saat traversal berlangsung.

Directory juga bukan snapshot immutable. Saat Java sedang membaca isi directory:

- proses lain bisa membuat file baru,
- proses lain bisa menghapus file,
- proses lain bisa rename file,
- file bisa berubah dari regular file menjadi symlink karena diganti,
- permission bisa berubah,
- mount point bisa hilang,
- network filesystem bisa timeout,
- directory bisa sangat besar sehingga membaca semua entry sekaligus tidak layak.

Mental model yang lebih benar:

```text
Traversal = percakapan bertahap dengan filesystem provider,
            bukan pembacaan snapshot sempurna dari struktur stabil.
```

Konsekuensinya:

- traversal result bisa tidak stabil,
- ordering tidak boleh diasumsikan,
- error harus dianggap normal,
- resource harus ditutup,
- recursive operation harus punya policy saat sebagian tree gagal,
- path containment harus dijaga kalau input berasal dari user,
- symlink harus diperlakukan sebagai boundary eksplisit.

---

## 2. API Landscape

Java modern menyediakan beberapa cara utama untuk listing dan traversal.

### 2.1 `Files.list(Path dir)`

Tujuan:

```text
List direct children dari satu directory.
```

Karakter:

- non-recursive,
- return `Stream<Path>`,
- lazily populated,
- harus ditutup,
- cocok untuk operasi stream sederhana pada satu directory,
- tidak cocok kalau butuh error handling granular per entry.

Contoh:

```java
try (Stream<Path> children = Files.list(dir)) {
    children.forEach(System.out::println);
}
```

---

### 2.2 `Files.walk(Path start, ...)`

Tujuan:

```text
Recursive traversal dari root directory.
```

Karakter:

- recursive,
- depth-first,
- return `Stream<Path>`,
- root path ikut muncul dalam stream,
- lazily populated,
- harus ditutup,
- default tidak follow symbolic links,
- bisa diberi max depth,
- bisa throw `UncheckedIOException` saat traversal stream sedang dikonsumsi.

Contoh:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(Files::isRegularFile)
         .forEach(System.out::println);
}
```

---

### 2.3 `Files.find(Path start, int maxDepth, BiPredicate<Path, BasicFileAttributes> matcher, ...)`

Tujuan:

```text
Recursive traversal + predicate yang menerima Path dan BasicFileAttributes.
```

Karakter:

- recursive,
- return `Stream<Path>`,
- lazily populated,
- harus ditutup,
- lebih efisien daripada `walk(...).filter(...)` kalau filter membutuhkan attributes,
- karena attributes sudah disediakan oleh traversal.

Contoh:

```java
try (Stream<Path> files = Files.find(
        root,
        10,
        (path, attrs) -> attrs.isRegularFile() && attrs.size() > 1024 * 1024
)) {
    files.forEach(System.out::println);
}
```

---

### 2.4 `Files.newDirectoryStream(Path dir)`

Tujuan:

```text
Iterasi direct children dari satu directory menggunakan DirectoryStream.
```

Karakter:

- non-recursive,
- return `DirectoryStream<Path>`,
- harus ditutup,
- scalable untuk directory besar,
- filtering bisa dilakukan oleh `DirectoryStream.Filter`,
- cocok saat ingin for-loop eksplisit dan kontrol lebih predictable.

Contoh:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
    for (Path child : stream) {
        System.out.println(child);
    }
}
```

---

### 2.5 `Files.walkFileTree(...)`

Tujuan:

```text
Recursive traversal dengan callback lifecycle penuh.
```

Karakter:

- recursive,
- bukan stream,
- menggunakan `FileVisitor`,
- punya hook untuk:
  - sebelum directory dikunjungi,
  - file dikunjungi,
  - file gagal dikunjungi,
  - setelah directory selesai,
- paling cocok untuk operasi robust: delete/copy/checksum/audit,
- error handling paling eksplisit,
- bisa skip subtree/sibling/terminate.

Contoh singkat:

```java
Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
        System.out.println(file);
        return FileVisitResult.CONTINUE;
    }
});
```

---

## 3. Decision Table: Pakai API yang Mana?

| Kebutuhan | API utama | Alasan |
|---|---:|---|
| List isi satu folder sederhana | `Files.list` | Singkat, stream-based |
| List isi satu folder sangat besar | `DirectoryStream` | Iterasi eksplisit, scalable, resource lifetime jelas |
| Recursive search sederhana | `Files.walk` | Stream pipeline mudah |
| Recursive search dengan atribut | `Files.find` | Predicate mendapat `BasicFileAttributes` langsung |
| Recursive delete/copy/checksum robust | `walkFileTree` | Error handling lifecycle lengkap |
| Butuh skip subtree | `walkFileTree` | Ada `SKIP_SUBTREE` |
| Butuh continue walau file tertentu error | `walkFileTree` | Override `visitFileFailed` |
| Butuh sorting seluruh hasil | `Files.walk` + collect/sort | Tapi sadar risiko memory |
| Butuh process jutaan file tanpa collect | `DirectoryStream`/`walkFileTree` | Hindari materialisasi semua path |
| Butuh security hardening terhadap symlink | `walkFileTree` dengan policy eksplisit | Lebih mudah mengontrol follow/no-follow |

Rule of thumb:

```text
Convenience/simple query       → Files.list / Files.walk / Files.find
Production recursive mutation  → walkFileTree
Very large one-level directory → DirectoryStream
```

---

## 4. `Files.list`: Satu Level Directory

### 4.1 Basic Usage

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

public class ListChildrenExample {
    public static void main(String[] args) throws IOException {
        Path dir = Path.of("/data/inbox");

        try (Stream<Path> children = Files.list(dir)) {
            children.forEach(System.out::println);
        }
    }
}
```

Untuk Java 8:

```java
Path dir = Paths.get("/data/inbox");
```

Bukan:

```java
Files.list(dir).forEach(System.out::println); // resource leak risk
```

Karena stream dari `Files.list` menahan resource directory dan harus ditutup.

---

### 4.2 Direct Children Only

`Files.list(dir)` tidak recursive.

Jika directory berisi:

```text
/data/inbox/
  a.txt
  b.txt
  sub/
    c.txt
```

Maka `Files.list(Path.of("/data/inbox"))` menghasilkan kira-kira:

```text
/data/inbox/a.txt
/data/inbox/b.txt
/data/inbox/sub
```

Tidak menghasilkan:

```text
/data/inbox/sub/c.txt
```

---

### 4.3 Result Ordering Tidak Dijamin

Jangan menulis logic seperti:

```java
try (Stream<Path> children = Files.list(dir)) {
    Path first = children.findFirst().orElseThrow();
    process(first);
}
```

lalu mengasumsikan “first” adalah file paling lama, paling baru, atau alphabetically first.

Filesystem/provider tidak wajib memberikan ordering tertentu.

Kalau butuh urutan eksplisit:

```java
try (Stream<Path> children = Files.list(dir)) {
    children.sorted()
            .forEach(System.out::println);
}
```

Tapi ini punya konsekuensi:

```text
sorted() butuh melihat semua element sebelum menghasilkan output final.
```

Untuk directory kecil/menengah, aman. Untuk jutaan entry, ini bisa mahal secara memory dan latency.

---

### 4.4 Filtering Direct Children

Contoh filter regular file:

```java
try (Stream<Path> children = Files.list(dir)) {
    children.filter(Files::isRegularFile)
            .forEach(this::process);
}
```

Masalah tersembunyi:

```java
Files::isRegularFile
```

akan melakukan attribute check tambahan. Pada local filesystem kecil, ini tidak terasa. Pada directory besar atau network filesystem, metadata call bisa menjadi bottleneck.

Jika filter membutuhkan banyak attribute, pertimbangkan membaca attribute sekali:

```java
try (Stream<Path> children = Files.list(dir)) {
    children.forEach(path -> {
        try {
            BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);
            if (attrs.isRegularFile() && attrs.size() > 0) {
                process(path, attrs);
            }
        } catch (IOException e) {
            handleEntryFailure(path, e);
        }
    });
}
```

Atau untuk recursive traversal gunakan `Files.find`/`walkFileTree`.

---

## 5. Lifecycle: Stream dari Filesystem Harus Ditutup

Java Stream biasanya sering dipakai tanpa try-with-resources:

```java
list.stream().filter(...).toList();
```

Itu aman untuk collection in-memory.

Tetapi stream dari filesystem berbeda:

```java
Files.list(dir)
Files.walk(root)
Files.find(root, depth, matcher)
```

Stream ini bisa memegang:

- native directory handle,
- file descriptor,
- provider-specific resource,
- internal traversal state,
- open directory chain saat recursive walk.

Karena itu pola wajib:

```java
try (Stream<Path> stream = Files.list(dir)) {
    // consume stream here
}
```

Jangan return stream filesystem mentah dari method kecuali caller jelas bertanggung jawab menutupnya.

Buruk:

```java
public Stream<Path> listInbox() throws IOException {
    return Files.list(inboxDir);
}
```

Lebih aman:

```java
public List<Path> listInboxSnapshot() throws IOException {
    try (Stream<Path> stream = Files.list(inboxDir)) {
        return stream.toList(); // Java 16+
    }
}
```

Untuk Java 8:

```java
public List<Path> listInboxSnapshot() throws IOException {
    try (Stream<Path> stream = Files.list(inboxDir)) {
        return stream.collect(Collectors.toList());
    }
}
```

Atau callback-based:

```java
public void forEachInboxFile(Consumer<Path> consumer) throws IOException {
    try (Stream<Path> stream = Files.list(inboxDir)) {
        stream.forEach(consumer);
    }
}
```

Namun callback juga harus hati-hati jika `consumer` melempar exception.

---

## 6. `DirectoryStream`: API yang Sering Diremehkan

`DirectoryStream` terlihat lebih tua dan kurang modern dibanding Stream API. Tetapi untuk beberapa workload, ini pilihan lebih baik.

### 6.1 Basic Usage

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
    for (Path child : stream) {
        process(child);
    }
}
```

Keunggulan:

- lifecycle sangat jelas,
- cocok untuk directory besar,
- tidak mengundang operasi stream yang materialize semua element tanpa sadar,
- mudah melakukan fail-fast atau counting manual,
- cocok untuk processing satu-satu.

---

### 6.2 Glob Filter

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.csv")) {
    for (Path csv : stream) {
        process(csv);
    }
}
```

Glob ini berlaku untuk entry langsung dalam directory tersebut, bukan recursive.

---

### 6.3 Custom Filter

```java
DirectoryStream.Filter<Path> nonEmptyRegularFile = path -> {
    try {
        return Files.isRegularFile(path) && Files.size(path) > 0;
    } catch (IOException e) {
        return false;
    }
};

try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, nonEmptyRegularFile)) {
    for (Path child : stream) {
        process(child);
    }
}
```

Caveat:

- filter bisa dipanggil selama iteration,
- filter bisa throw `IOException`,
- jangan menulis filter yang mahal tanpa sadar,
- jangan menganggap filter membuat snapshot.

---

### 6.4 `DirectoryIteratorException`

Karena `Iterator` tidak bisa melempar checked `IOException`, error saat iterasi directory dapat dibungkus menjadi `DirectoryIteratorException`.

Contoh defensive:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
    for (Path child : stream) {
        process(child);
    }
} catch (DirectoryIteratorException e) {
    IOException cause = e.getCause();
    handleDirectoryIterationFailure(dir, cause);
}
```

Ini detail penting. Banyak code hanya catch `IOException`, lalu heran kenapa runtime exception bocor.

---

## 7. `Files.walk`: Recursive Stream

### 7.1 Basic Recursive Listing

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.forEach(System.out::println);
}
```

Untuk tree:

```text
root/
  a.txt
  sub/
    b.txt
```

Output mengandung root juga:

```text
root
root/a.txt
root/sub
root/sub/b.txt
```

Kalau hanya file:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(Files::isRegularFile)
         .forEach(this::process);
}
```

---

### 7.2 Depth-First Traversal

`Files.walk` melakukan traversal depth-first. Directory dikunjungi sebelum entry di dalamnya.

Mental model:

```text
visit root
  visit root/a
  visit root/sub
    visit root/sub/b
```

Namun tetap jangan mengandalkan ordering antar sibling kecuali disortir eksplisit.

---

### 7.3 `maxDepth`

```java
try (Stream<Path> paths = Files.walk(root, 1)) {
    paths.forEach(System.out::println);
}
```

`maxDepth = 0` hanya root.

`maxDepth = 1` root + direct children.

`maxDepth = 2` root + children + grandchildren.

Contoh:

```text
root                  depth 0
root/a.txt            depth 1
root/sub              depth 1
root/sub/b.txt        depth 2
```

Gunakan `maxDepth` untuk:

- membatasi biaya traversal,
- menghindari tree terlalu dalam,
- membuat scanner predictable,
- menghindari recursive surprise dari user-controlled directory.

---

### 7.4 Lazy, Bukan Snapshot

`Files.walk` return stream yang lazily populated. Artinya path ditemukan saat stream dikonsumsi, bukan semua dikumpulkan di awal.

Konsekuensi:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.limit(10).forEach(this::process);
}
```

Tidak harus membaca seluruh tree.

Tetapi:

```java
try (Stream<Path> paths = Files.walk(root)) {
    List<Path> all = paths.collect(Collectors.toList());
}
```

akan materialize seluruh hasil ke memory.

Pada tree sangat besar, ini buruk.

---

### 7.5 Weak Consistency

Traversal stream filesystem tidak membekukan tree.

Jika tree berubah saat traversal:

- file baru bisa terlihat atau tidak,
- file yang dihapus bisa menyebabkan error,
- directory yang dihapus setelah ditemukan bisa gagal dibuka,
- rename bisa membuat hasil tampak aneh,
- traversal bukan transaksi.

Design implication:

```text
Jika butuh correctness terhadap perubahan concurrent, traversal saja tidak cukup.
Butuh protocol: staging, lock/claim, atomic rename, manifest, database state, atau reconciliation.
```

---

## 8. `Files.find`: Attribute-Aware Search

`Files.find` mirip `walk`, tetapi predicate menerima `Path` dan `BasicFileAttributes`.

```java
try (Stream<Path> largeFiles = Files.find(
        root,
        Integer.MAX_VALUE,
        (path, attrs) -> attrs.isRegularFile() && attrs.size() > 100 * 1024 * 1024
)) {
    largeFiles.forEach(this::processLargeFile);
}
```

Keunggulan dibanding:

```java
Files.walk(root)
     .filter(Files::isRegularFile)
     .filter(path -> Files.size(path) > ...)
```

adalah attribute sudah tersedia dari proses traversal.

### 8.1 Kapan `find` Cocok?

Gunakan `Files.find` ketika filter butuh:

- regular file vs directory,
- size,
- last modified time,
- creation time,
- symbolic link info,
- basic metadata.

Contoh file lebih tua dari 30 hari:

```java
Instant cutoff = Instant.now().minus(Duration.ofDays(30));

try (Stream<Path> oldFiles = Files.find(
        root,
        20,
        (path, attrs) -> attrs.isRegularFile()
                && attrs.lastModifiedTime().toInstant().isBefore(cutoff)
)) {
    oldFiles.forEach(this::archiveCandidate);
}
```

---

## 9. `walkFileTree`: Ketika Stream Terlalu Lemah

`Files.walk` nyaman, tetapi tidak ideal untuk operasi recursive yang butuh kontrol error detail.

`walkFileTree` memberi lifecycle:

```text
preVisitDirectory(dir)
visitFile(file)
visitFileFailed(file)
postVisitDirectory(dir)
```

Contoh:

```java
Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
    @Override
    public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
        System.out.println("ENTER " + dir);
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
        System.out.println("FILE  " + file + " size=" + attrs.size());
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult visitFileFailed(Path file, IOException exc) {
        System.err.println("FAIL  " + file + " reason=" + exc);
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
        System.out.println("LEAVE " + dir);
        return FileVisitResult.CONTINUE;
    }
});
```

### 9.1 `FileVisitResult`

`FileVisitResult` values:

| Result | Makna |
|---|---|
| `CONTINUE` | lanjut traversal |
| `TERMINATE` | hentikan traversal seluruhnya |
| `SKIP_SUBTREE` | jangan masuk ke subtree directory saat ini |
| `SKIP_SIBLINGS` | skip sibling berikutnya |

Contoh skip directory `archive`:

```java
@Override
public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
    if (dir.getFileName().toString().equals("archive")) {
        return FileVisitResult.SKIP_SUBTREE;
    }
    return FileVisitResult.CONTINUE;
}
```

---

## 10. Error Handling Model

### 10.1 Error Bukan Exceptional Dalam Arti Bisnis

Dalam filesystem traversal, error adalah kondisi normal:

- permission denied,
- file disappeared,
- symlink loop,
- path too long,
- invalid file name,
- stale network handle,
- directory unreadable,
- I/O timeout,
- disk unmounted,
- file busy,
- access revoked while traversing.

Production code harus punya policy:

```text
Fail fast?
Continue and report?
Quarantine root?
Retry?
Skip subtree?
Stop after threshold?
```

---

### 10.2 Stream API: Error Sering Muncul Saat Konsumsi

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.forEach(this::process);
}
```

`Files.walk(root)` bisa sukses, lalu error muncul saat `forEach` karena traversal lazy.

Karena stream pipeline tidak nyaman dengan checked exception, error bisa muncul sebagai `UncheckedIOException`.

Pola defensive:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.forEach(path -> {
        try {
            process(path);
        } catch (IOException e) {
            handlePathFailure(path, e);
        }
    });
} catch (UncheckedIOException e) {
    handleTraversalFailure(root, e.getCause());
}
```

Tetapi kalau butuh robust traversal dengan continue/skip detail, gunakan `walkFileTree`.

---

### 10.3 `walkFileTree`: Error Handling Lebih Natural

Contoh continue saat file gagal:

```java
@Override
public FileVisitResult visitFileFailed(Path file, IOException exc) {
    failures.add(new ScanFailure(file, exc));
    return FileVisitResult.CONTINUE;
}
```

Contoh fail-fast:

```java
@Override
public FileVisitResult visitFileFailed(Path file, IOException exc) throws IOException {
    throw exc;
}
```

Contoh skip directory yang tidak bisa dibaca:

```java
@Override
public FileVisitResult preVisitDirectoryFailed(Path dir, IOException exc) {
    failures.add(new ScanFailure(dir, exc));
    return FileVisitResult.SKIP_SUBTREE;
}
```

Catatan: `FileVisitor` interface standar punya `visitFileFailed`, sedangkan kegagalan membuka directory juga akan masuk ke mekanisme visitor sesuai kontrak traversal. Dengan `SimpleFileVisitor`, default-nya cenderung rethrow I/O error, jadi override jika ingin continue.

---

## 11. Symbolic Link Policy

Default `Files.walk` dan `walkFileTree` tidak otomatis follow symbolic links.

Ini default yang aman.

Jika memakai:

```java
Files.walk(root, FileVisitOption.FOLLOW_LINKS)
```

maka traversal dapat masuk ke target symlink.

Risiko:

- keluar dari root logical boundary,
- masuk ke directory sensitif,
- loop/cycle,
- duplicate traversal,
- traversal menjadi jauh lebih besar,
- symlink attack pada cleanup/delete job.

### 11.1 Secure Default

Untuk user-controlled path:

```text
Default: jangan follow symlink.
```

Kalau harus follow:

- definisikan boundary real path,
- cek containment,
- deteksi cycle,
- batasi maxDepth,
- audit setiap symlink,
- logging path link dan target.

---

### 11.2 Path Containment Saat Traversal

Misalnya root storage:

```text
/app/storage/users/u-123
```

User bisa membuat symlink:

```text
/app/storage/users/u-123/export -> /etc
```

Kalau traversal follow symlink tanpa validasi, scanner bisa membaca `/etc`.

Pola containment:

```java
Path rootReal = root.toRealPath(LinkOption.NOFOLLOW_LINKS);

boolean isInsideRoot(Path candidate) throws IOException {
    Path real = candidate.toRealPath(LinkOption.NOFOLLOW_LINKS);
    return real.startsWith(rootReal);
}
```

Namun ini pun harus dipahami sebagai check yang bisa race jika tree bisa dimutasi pihak lain. Untuk operasi security-critical, butuh desain storage permission dan ownership yang mencegah attacker mengganti path saat operasi.

---

## 12. Traversal dan Race Condition

Contoh code yang terlihat aman:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(Files::isRegularFile)
         .forEach(this::process);
}
```

Race:

```text
1. Files.walk menemukan /inbox/a.txt
2. filter Files.isRegularFile(a.txt) return true
3. proses lain mengganti a.txt menjadi symlink ke file lain
4. process(a.txt) membuka path tersebut
```

Ini TOCTOU.

Solusi tergantung konteks:

- jika hanya reporting non-security, accept eventual behavior,
- jika processing file upload, claim file dengan atomic move ke private staging,
- jika security-sensitive, buka file dengan no-follow semantics jika tersedia dan validasi via descriptor/attribute,
- gunakan directory permission agar attacker tidak bisa mutate selama traversal,
- gunakan manifest/state database.

Traversal tidak pernah menggantikan protocol ownership.

---

## 13. Pattern: Processing Direct Inbox Safely

Misal ada directory:

```text
/data/inbox
/data/processing
/data/done
/data/error
```

Tujuan: worker mengambil file dari inbox tanpa dua worker memproses file sama.

Buruk:

```java
try (Stream<Path> files = Files.list(inbox)) {
    files.filter(Files::isRegularFile)
         .forEach(this::process);
}
```

Masalah:

- dua worker bisa melihat file sama,
- file bisa masih ditulis producer,
- process bisa membaca file partial,
- tidak ada claim.

Lebih baik:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(inbox, "*.ready")) {
    for (Path readyFile : stream) {
        Path claimed = processing.resolve(readyFile.getFileName().toString());
        try {
            Files.move(readyFile, claimed, StandardCopyOption.ATOMIC_MOVE);
            processClaimedFile(claimed);
            Files.move(claimed, done.resolve(claimed.getFileName()), StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            handleUnsupportedAtomicMove(readyFile, e);
        } catch (FileAlreadyExistsException e) {
            // worker lain mungkin sudah claim nama tersebut, atau duplicate
            handleDuplicateClaim(readyFile, e);
        } catch (NoSuchFileException e) {
            // worker lain sudah mengambil file
            continue;
        } catch (IOException e) {
            handleProcessingFailure(readyFile, e);
        }
    }
}
```

Protocol producer lebih baik:

```text
producer writes: file.tmp
producer fsyncs/close
producer renames: file.tmp -> file.ready
consumer only scans *.ready
consumer atomically moves ready -> processing
```

Ini mengubah traversal dari “source of truth” menjadi “discovery mechanism”. Ownership tetap ditentukan oleh atomic move.

---

## 14. Pattern: Recursive Scanner dengan Error Aggregation

Untuk audit filesystem, kita sering ingin:

- scan sebanyak mungkin,
- catat error,
- jangan gagal total karena satu file permission denied,
- hasil punya summary.

Contoh:

```java
public final class FileTreeAudit {
    private long files;
    private long directories;
    private long bytes;
    private final List<String> failures = new ArrayList<>();

    public void scan(Path root) throws IOException {
        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                directories++;
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (attrs.isRegularFile()) {
                    files++;
                    bytes += attrs.size();
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                failures.add(file + " -> " + exc.getClass().getSimpleName() + ": " + exc.getMessage());
                return FileVisitResult.CONTINUE;
            }
        });
    }

    public long files() { return files; }
    public long directories() { return directories; }
    public long bytes() { return bytes; }
    public List<String> failures() { return List.copyOf(failures); } // Java 10+
}
```

Java 8 compatible return:

```java
return Collections.unmodifiableList(new ArrayList<>(failures));
```

---

## 15. Sorting Traversal Results

Filesystem traversal ordering tidak boleh diasumsikan. Jika bisnis butuh order:

- sort by filename,
- sort by last modified,
- sort by size,
- sort by priority manifest,
- sort by stable sequence number.

### 15.1 Sort by Path

```java
try (Stream<Path> paths = Files.list(dir)) {
    paths.sorted()
         .forEach(this::process);
}
```

### 15.2 Sort by Last Modified Time

```java
try (Stream<Path> paths = Files.list(dir)) {
    paths.sorted(Comparator.comparing(path -> {
        try {
            return Files.getLastModifiedTime(path);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    })).forEach(this::process);
}
```

Masalah:

- metadata call banyak,
- sorting materialize semua element,
- timestamp resolution filesystem bisa berbeda,
- last modified bisa berubah,
- clock tidak selalu reliable pada distributed filesystem.

Untuk production intake, lebih baik producer membuat manifest/sequence daripada consumer menebak order dari directory listing.

---

## 16. Directory dengan Jutaan File

Directory sangat besar menimbulkan masalah:

- listing lambat,
- metadata lookup mahal,
- sorting mahal,
- deletion mahal,
- filesystem index behavior berbeda,
- backup/restore lambat,
- operational command seperti `ls` bisa berat,
- watcher bisa overflow,
- cleanup job bisa tidak selesai dalam window.

### 16.1 Sharding Directory

Daripada:

```text
/storage/files/000000001.dat
/storage/files/000000002.dat
...
/storage/files/999999999.dat
```

Gunakan sharding:

```text
/storage/files/ab/cd/abcdef123456.dat
/storage/files/12/34/123456789abc.dat
```

Berdasarkan hash prefix:

```java
String hash = sha256Hex(content);
Path path = root.resolve(hash.substring(0, 2))
                .resolve(hash.substring(2, 4))
                .resolve(hash + ".bin");
```

Manfaat:

- directory entries per folder lebih kecil,
- traversal partial lebih mudah,
- cleanup lebih parallelizable,
- lock contention menurun,
- operational debugging lebih terkendali.

---

### 16.2 Batched Processing

Jangan collect semua:

```java
List<Path> all = Files.walk(root).collect(Collectors.toList()); // dangerous for huge tree
```

Lebih baik process incremental:

```java
try (Stream<Path> paths = Files.walk(root)) {
    Iterator<Path> it = paths.iterator();
    while (it.hasNext()) {
        process(it.next());
    }
}
```

Tetapi jika butuh robust error handling, tetap `walkFileTree` lebih baik.

---

## 17. Parallel Stream: Hati-Hati

Jangan otomatis melakukan:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.parallel()
         .filter(Files::isRegularFile)
         .forEach(this::process);
}
```

Masalah:

- traversal source sendiri belum tentu parallel-friendly,
- filesystem bisa menjadi bottleneck,
- metadata I/O bisa membanjiri disk/network FS,
- order hilang,
- exception handling makin sulit,
- open file count bisa melonjak,
- process downstream mungkin tidak thread-safe.

Kalau butuh parallelism, desain explicit bounded worker pool:

```text
single traversal thread → bounded queue → fixed worker pool
```

Dengan backpressure:

```java
BlockingQueue<Path> queue = new ArrayBlockingQueue<>(1000);
ExecutorService workers = Executors.newFixedThreadPool(8);
```

Tapi implementasi lengkapnya harus memperhatikan shutdown, poison pill, failure aggregation, dan cancellation. Ini akan lebih cocok dibahas lagi di capstone.

Rule:

```text
Parallel traversal should be bounded, observable, and cancellable.
```

---

## 18. Metadata Call Explosion

Code seperti ini terlihat innocent:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(Files::isRegularFile)
         .filter(path -> {
             try {
                 return Files.size(path) > 1024;
             } catch (IOException e) {
                 return false;
             }
         })
         .forEach(this::process);
}
```

Untuk setiap path, bisa ada beberapa metadata lookup:

- `isRegularFile`,
- `size`,
- mungkin `process` membaca attribute lagi.

Lebih baik:

```java
Files.find(root, Integer.MAX_VALUE, (path, attrs) ->
        attrs.isRegularFile() && attrs.size() > 1024
);
```

Atau `walkFileTree`:

```java
@Override
public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
    if (attrs.isRegularFile() && attrs.size() > 1024) {
        process(file, attrs);
    }
    return FileVisitResult.CONTINUE;
}
```

Top engineer tidak hanya bertanya “apakah code benar”, tetapi juga:

```text
Berapa syscall/metadata roundtrip per file?
Apa efeknya pada network filesystem?
Apa efeknya pada jutaan file?
```

---

## 19. Contoh: Find Large Old Files

### 19.1 Dengan `Files.find`

```java
public List<Path> findLargeOldFiles(Path root, long minBytes, Duration minAge) throws IOException {
    Instant cutoff = Instant.now().minus(minAge);

    try (Stream<Path> stream = Files.find(
            root,
            Integer.MAX_VALUE,
            (path, attrs) -> attrs.isRegularFile()
                    && attrs.size() >= minBytes
                    && attrs.lastModifiedTime().toInstant().isBefore(cutoff)
    )) {
        return stream.collect(Collectors.toList());
    }
}
```

Caveat:

- collect bisa berat kalau hasil banyak,
- `lastModifiedTime` bukan perfect business age,
- file bisa berubah setelah ditemukan,
- tidak ada granular skip policy seperti visitor.

### 19.2 Streaming Callback

```java
public void forEachLargeOldFile(
        Path root,
        long minBytes,
        Duration minAge,
        Consumer<Path> consumer
) throws IOException {
    Instant cutoff = Instant.now().minus(minAge);

    try (Stream<Path> stream = Files.find(
            root,
            Integer.MAX_VALUE,
            (path, attrs) -> attrs.isRegularFile()
                    && attrs.size() >= minBytes
                    && attrs.lastModifiedTime().toInstant().isBefore(cutoff)
    )) {
        stream.forEach(consumer);
    }
}
```

Better untuk memory, tetapi exception dari `consumer` harus didefinisikan.

---

## 20. Contoh: Directory Size Calculator

### 20.1 Naive

```java
public long sizeOfTree(Path root) throws IOException {
    try (Stream<Path> stream = Files.walk(root)) {
        return stream.filter(Files::isRegularFile)
                .mapToLong(path -> {
                    try {
                        return Files.size(path);
                    } catch (IOException e) {
                        throw new UncheckedIOException(e);
                    }
                })
                .sum();
    }
}
```

Masalah:

- error satu file menggagalkan semua,
- metadata lookup tambahan,
- symlink behavior implicit,
- tidak ada error report detail.

### 20.2 Visitor-Based

```java
public final class DirectorySizeCalculator {
    public static Result calculate(Path root) throws IOException {
        Accumulator acc = new Accumulator();

        Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (attrs.isRegularFile()) {
                    acc.files++;
                    acc.bytes += attrs.size();
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                acc.failures.add(file + " -> " + exc.toString());
                return FileVisitResult.CONTINUE;
            }
        });

        return new Result(acc.files, acc.bytes, acc.failures);
    }

    private static final class Accumulator {
        long files;
        long bytes;
        List<String> failures = new ArrayList<>();
    }

    public static final class Result {
        public final long files;
        public final long bytes;
        public final List<String> failures;

        public Result(long files, long bytes, List<String> failures) {
            this.files = files;
            this.bytes = bytes;
            this.failures = Collections.unmodifiableList(new ArrayList<>(failures));
        }
    }
}
```

Ini lebih production-friendly.

---

## 21. Recursive Delete Revisited

Recursive delete sudah disentuh di Part 09, tetapi traversal API-nya penting di sini.

Delete directory tree harus post-order:

```text
hapus file dulu
hapus subdirectory setelah kosong
hapus parent terakhir
```

Dengan `walkFileTree`:

```java
Files.walkFileTree(root, new SimpleFileVisitor<Path>() {
    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
        Files.delete(file);
        return FileVisitResult.CONTINUE;
    }

    @Override
    public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
        if (exc != null) {
            throw exc;
        }
        Files.delete(dir);
        return FileVisitResult.CONTINUE;
    }
});
```

Kenapa bukan:

```java
Files.walk(root)
     .forEach(Files::delete);
```

Karena depth-first menghasilkan parent sebelum children. Parent directory tidak bisa dihapus sebelum kosong.

Kalau memakai `Files.walk`, harus reverse order:

```java
try (Stream<Path> paths = Files.walk(root)) {
    List<Path> all = paths.sorted(Comparator.reverseOrder())
                          .collect(Collectors.toList());
    for (Path path : all) {
        Files.delete(path);
    }
}
```

Tapi ini materialize semua path. Untuk tree besar, `walkFileTree` lebih tepat.

---

## 22. Recursive Copy Revisited

Recursive copy juga lebih natural dengan `walkFileTree`.

```java
public void copyTree(Path source, Path target) throws IOException {
    Files.walkFileTree(source, new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
            Path relative = source.relativize(dir);
            Path targetDir = target.resolve(relative);
            Files.createDirectories(targetDir);
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
            Path relative = source.relativize(file);
            Path targetFile = target.resolve(relative);
            Files.copy(file, targetFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
            return FileVisitResult.CONTINUE;
        }
    });
}
```

Production caveats:

- symlink policy harus eksplisit,
- partial copy recovery harus ada,
- target existing policy harus jelas,
- copy attributes tidak selalu lengkap/portable,
- cross-filesystem behavior bisa beda,
- file berubah saat dicopy.

---

## 23. Handling Concurrent Mutation During Traversal

Misal scanner:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(Files::isRegularFile)
         .forEach(this::process);
}
```

Apa yang terjadi jika file dihapus setelah ditemukan?

Kemungkinan:

- `Files.isRegularFile` false,
- `process` dapat `NoSuchFileException`,
- traversal dapat throw saat buka directory,
- file tidak terlihat sama sekali.

Correct design tergantung business semantics.

### 23.1 Audit Scanner

Policy:

```text
Continue, record failure, scan best-effort.
```

### 23.2 File Intake Processor

Policy:

```text
Only process after successful atomic claim.
No claim, no processing.
```

### 23.3 Compliance Evidence Snapshot

Policy:

```text
Traversal saja tidak cukup.
Need immutable snapshot, filesystem snapshot, database manifest, or write quiescence window.
```

### 23.4 Cleanup Job

Policy:

```text
Delete-if-exists and tolerate missing files.
But never delete outside approved root.
```

---

## 24. Avoiding Accidental Root Traversal

Bug berbahaya:

```java
Path root = config.getCleanupRoot();
Files.walkFileTree(root, deleteVisitor);
```

Jika config salah menjadi:

```text
/
C:\
/home/app

```

cleanup bisa fatal.

Tambahkan guard:

```java
public static void validateCleanupRoot(Path root) throws IOException {
    Path real = root.toRealPath(LinkOption.NOFOLLOW_LINKS);

    if (!Files.isDirectory(real, LinkOption.NOFOLLOW_LINKS)) {
        throw new IllegalArgumentException("Cleanup root is not a directory: " + real);
    }

    if (real.getParent() == null) {
        throw new IllegalArgumentException("Refusing to operate on filesystem root: " + real);
    }

    int nameCount = real.getNameCount();
    if (nameCount < 3) {
        throw new IllegalArgumentException("Cleanup root is too broad: " + real);
    }
}
```

Lebih baik lagi: allowlist root prefix.

```java
Path allowedRoot = Path.of("/app/data").toRealPath();
Path real = root.toRealPath(LinkOption.NOFOLLOW_LINKS);

if (!real.startsWith(allowedRoot)) {
    throw new SecurityException("Root outside allowed storage area: " + real);
}
```

---

## 25. Glob, Matcher, and Filtering Strategy

Untuk satu directory:

```java
Files.newDirectoryStream(dir, "*.csv")
```

Untuk path matcher:

```java
PathMatcher matcher = FileSystems.getDefault().getPathMatcher("glob:**/*.csv");

try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(path -> matcher.matches(root.relativize(path)))
         .forEach(this::processCsv);
}
```

Caveats:

- glob semantics bisa tricky,
- separator berbeda per filesystem,
- case sensitivity filesystem berbeda,
- matcher terhadap absolute vs relative path bisa beda hasil,
- pattern user-controlled harus dibatasi untuk mencegah scan terlalu besar.

Untuk production, sering lebih jelas menggunakan predicate eksplisit:

```java
boolean isCsv(Path path) {
    String name = path.getFileName().toString();
    return name.toLowerCase(Locale.ROOT).endsWith(".csv");
}
```

Tapi ini pun punya caveat:

- extension bukan content type,
- locale harus `Locale.ROOT`,
- hidden file dan multiple extension harus dipikirkan.

---

## 26. Hidden Files

Java punya:

```java
Files.isHidden(path)
```

Tetapi hidden semantics berbeda:

- Unix-like: nama diawali dot biasanya hidden secara convention,
- Windows: hidden attribute,
- provider bisa punya definisi sendiri.

Jangan membuat business rule portable dengan asumsi:

```java
path.getFileName().toString().startsWith(".")
```

kecuali memang rule bisnisnya Unix-style dotfile.

---

## 27. Cancellation dan Time Budget

Traversal besar bisa terlalu lama.

Production scanner sebaiknya punya:

- max depth,
- max files,
- max duration,
- cancellation flag,
- progress checkpoint,
- failure threshold.

Dengan `walkFileTree`:

```java
public final class BudgetedVisitor extends SimpleFileVisitor<Path> {
    private final Instant deadline;
    private final long maxFiles;
    private long files;

    public BudgetedVisitor(Duration maxDuration, long maxFiles) {
        this.deadline = Instant.now().plus(maxDuration);
        this.maxFiles = maxFiles;
    }

    @Override
    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
        files++;
        if (files >= maxFiles || Instant.now().isAfter(deadline)) {
            return FileVisitResult.TERMINATE;
        }
        return FileVisitResult.CONTINUE;
    }
}
```

Ini lebih terkendali daripada stream pipeline yang panjang tanpa cancellation policy eksplisit.

---

## 28. Observability untuk Traversal

Minimal metric untuk traversal production:

```text
traversal.started.count
traversal.completed.count
traversal.failed.count
traversal.duration
traversal.files.visited
traversal.directories.visited
traversal.bytes.seen
traversal.errors.by_type
traversal.skipped.count
traversal.max_depth_reached
traversal.cancelled.count
```

Log yang berguna:

```text
root path
real root path
follow links or not
max depth
start time
end time
duration
visited files
visited directories
failure count
first N failures
termination reason
correlation id
```

Jangan log semua path jika:

- jumlah file besar,
- path mengandung data sensitif,
- nama file berisi PII,
- log cost tinggi.

Gunakan sampling atau summary.

---

## 29. Production-Grade Traversal Utility

Berikut contoh utility yang lebih realistis.

```java
public final class TreeScanner {

    public ScanResult scan(Path root, ScanOptions options) throws IOException {
        Path realRoot = root.toRealPath(LinkOption.NOFOLLOW_LINKS);

        if (!Files.isDirectory(realRoot, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("Root is not a directory: " + realRoot);
        }

        ScanAccumulator acc = new ScanAccumulator(realRoot, options.maxFailures);
        long startedNanos = System.nanoTime();

        Set<FileVisitOption> visitOptions = options.followLinks
                ? EnumSet.of(FileVisitOption.FOLLOW_LINKS)
                : EnumSet.noneOf(FileVisitOption.class);

        Files.walkFileTree(realRoot, visitOptions, options.maxDepth, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                acc.directories++;

                if (acc.shouldTerminate()) {
                    acc.terminationReason = "failure-threshold";
                    return FileVisitResult.TERMINATE;
                }

                if (options.skipHidden) {
                    try {
                        if (!dir.equals(realRoot) && Files.isHidden(dir)) {
                            acc.skippedDirectories++;
                            return FileVisitResult.SKIP_SUBTREE;
                        }
                    } catch (IOException e) {
                        acc.addFailure(dir, e);
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                }

                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                acc.files++;

                if (attrs.isRegularFile()) {
                    acc.regularFiles++;
                    acc.bytes += attrs.size();
                }

                return acc.shouldTerminate()
                        ? FileVisitResult.TERMINATE
                        : FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                acc.addFailure(file, exc);
                return acc.shouldTerminate()
                        ? FileVisitResult.TERMINATE
                        : FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
                if (exc != null) {
                    acc.addFailure(dir, exc);
                }
                return acc.shouldTerminate()
                        ? FileVisitResult.TERMINATE
                        : FileVisitResult.CONTINUE;
            }
        });

        long durationNanos = System.nanoTime() - startedNanos;
        return acc.toResult(durationNanos);
    }

    public static final class ScanOptions {
        public final int maxDepth;
        public final boolean followLinks;
        public final boolean skipHidden;
        public final int maxFailures;

        public ScanOptions(int maxDepth, boolean followLinks, boolean skipHidden, int maxFailures) {
            this.maxDepth = maxDepth;
            this.followLinks = followLinks;
            this.skipHidden = skipHidden;
            this.maxFailures = maxFailures;
        }
    }

    private static final class ScanAccumulator {
        final Path root;
        final int maxFailures;
        long directories;
        long skippedDirectories;
        long files;
        long regularFiles;
        long bytes;
        String terminationReason = "completed";
        final List<String> failures = new ArrayList<>();

        ScanAccumulator(Path root, int maxFailures) {
            this.root = root;
            this.maxFailures = maxFailures;
        }

        void addFailure(Path path, IOException e) {
            if (failures.size() < maxFailures) {
                failures.add(path + " -> " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }

        boolean shouldTerminate() {
            return maxFailures > 0 && failures.size() >= maxFailures;
        }

        ScanResult toResult(long durationNanos) {
            return new ScanResult(
                    root,
                    directories,
                    skippedDirectories,
                    files,
                    regularFiles,
                    bytes,
                    durationNanos,
                    terminationReason,
                    failures
            );
        }
    }

    public static final class ScanResult {
        public final Path root;
        public final long directories;
        public final long skippedDirectories;
        public final long files;
        public final long regularFiles;
        public final long bytes;
        public final long durationNanos;
        public final String terminationReason;
        public final List<String> failures;

        public ScanResult(
                Path root,
                long directories,
                long skippedDirectories,
                long files,
                long regularFiles,
                long bytes,
                long durationNanos,
                String terminationReason,
                List<String> failures
        ) {
            this.root = root;
            this.directories = directories;
            this.skippedDirectories = skippedDirectories;
            this.files = files;
            this.regularFiles = regularFiles;
            this.bytes = bytes;
            this.durationNanos = durationNanos;
            this.terminationReason = terminationReason;
            this.failures = Collections.unmodifiableList(new ArrayList<>(failures));
        }
    }
}
```

### 29.1 Kenapa Utility Ini Lebih Serius?

Karena ia punya:

- real root validation,
- explicit symlink policy,
- max depth,
- hidden skip policy,
- failure threshold,
- aggregation,
- duration metric,
- no materialization of all paths,
- Java 8 compatibility.

Masih belum sempurna:

- belum punya cancellation dari thread lain,
- belum punya logging abstraction,
- belum punya metric sink,
- belum punya path redaction,
- belum punya backpressure worker pool,
- belum punya filesystem snapshot semantics.

Tetapi mental modelnya benar.

---

## 30. Common Anti-Patterns

### 30.1 Tidak Menutup Stream

Buruk:

```java
Files.walk(root).forEach(this::process);
```

Baik:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.forEach(this::process);
}
```

---

### 30.2 Menggunakan `File.listFiles()` Tanpa Null Handling

Legacy API:

```java
File[] files = dir.toFile().listFiles();
for (File file : files) {
    ...
}
```

`listFiles()` bisa return null kalau bukan directory atau I/O error. Ini salah satu alasan NIO.2 lebih baik untuk error reporting.

---

### 30.3 Recursive Delete dengan `Files.walk` Tanpa Reverse

Buruk:

```java
Files.walk(root).forEach(path -> Files.delete(path));
```

Parent bisa dihapus sebelum child.

---

### 30.4 Menganggap Listing Ordered

Buruk:

```java
Path next = Files.list(dir).findFirst().orElseThrow();
```

Jika butuh next by business order, simpan order di metadata/manifest/database.

---

### 30.5 Menganggap Traversal Snapshot

Buruk:

```java
List<Path> files = Files.walk(root).collect(toList());
// assume this list represents exact current tree
```

Tree bisa berubah sebelum, selama, dan setelah collect.

---

### 30.6 Follow Symlink Tanpa Boundary

Buruk:

```java
Files.walk(root, FileVisitOption.FOLLOW_LINKS)
```

Tanpa containment/cycle/security policy.

---

### 30.7 Parallel Stream Tanpa Limit

Buruk:

```java
Files.walk(root).parallel().forEach(this::process);
```

Tidak ada explicit backpressure, failure policy, atau resource limit.

---

## 31. Checklist Desain Traversal

Sebelum menulis traversal, jawab pertanyaan ini:

### 31.1 Scope

- Apakah hanya direct children atau recursive?
- Berapa max depth?
- Apakah root berasal dari config atau user input?
- Apakah root sudah divalidasi real path-nya?
- Apakah boleh keluar dari root via symlink?

### 31.2 Consistency

- Apakah tree bisa berubah saat traversal?
- Apakah butuh snapshot konsisten?
- Apakah traversal hanya discovery atau source of truth?
- Apakah perlu claim/lock/manifest?

### 31.3 Error Policy

- Fail fast atau continue?
- Error apa yang boleh diabaikan?
- Berapa max failure threshold?
- Bagaimana error dilaporkan?
- Apakah partial result valid?

### 31.4 Resource

- Apakah stream ditutup?
- Apakah jumlah file bisa jutaan?
- Apakah operation materialize semua path?
- Apakah sorting perlu?
- Apakah open file/directory handle bisa melonjak?

### 31.5 Security

- Apakah user bisa membuat symlink?
- Apakah user bisa rename saat traversal?
- Apakah path mengandung PII?
- Apakah hidden file harus diproses?
- Apakah traversal bisa menyentuh mount sensitif?

### 31.6 Performance

- Berapa metadata call per file?
- Apakah running di local disk, NFS, SMB, EFS, PVC, container overlay?
- Apakah ada timeout?
- Apakah butuh batching?
- Apakah parallelism bounded?

---

## 32. Java 8 hingga Java 25 Compatibility Notes

### 32.1 Available Since Java 7/8

API utama:

- `Path`,
- `Files`,
- `DirectoryStream`,
- `FileVisitor`,
- `SimpleFileVisitor`,
- `Files.walkFileTree`,
- `Files.newDirectoryStream`,
- `Files.list`,
- `Files.walk`,
- `Files.find`.

`Files.walk`, `Files.list`, dan `Files.find` tersedia untuk Java 8 stream-based usage.

### 32.2 `Path.of` vs `Paths.get`

Java 8:

```java
Path root = Paths.get("/data/root");
```

Java 11+ / modern style:

```java
Path root = Path.of("/data/root");
```

Untuk materi seri ini:

- code modern bisa memakai `Path.of`,
- jika target Java 8, ganti dengan `Paths.get`.

### 32.3 `Stream.toList()`

Java 16+:

```java
List<Path> paths = stream.toList();
```

Java 8:

```java
List<Path> paths = stream.collect(Collectors.toList());
```

### 32.4 `List.copyOf`

Java 10+:

```java
List.copyOf(failures)
```

Java 8:

```java
Collections.unmodifiableList(new ArrayList<>(failures))
```

---

## 33. Deep Mental Model: Traversal Is Not Ownership

Ini prinsip paling penting dari part ini.

Ketika kita menulis:

```java
Files.walk(root)
```

kita hanya menemukan path.

Kita belum memiliki file itu.

Path yang ditemukan bisa:

- hilang sebelum dibuka,
- berubah target,
- berubah permission,
- berubah content,
- diganti symlink,
- diklaim worker lain,
- masih ditulis producer,
- hanya terlihat sebagian karena filesystem delay.

Maka untuk workflow production:

```text
Traversal = discovery
Ownership = atomic claim / lock / manifest / state transition
Correctness = protocol, not listing
```

Contoh file intake:

```text
Wrong:
  scan inbox → process every file found

Better:
  scan inbox → atomic move candidate to processing → process claimed file
```

Contoh cleanup:

```text
Wrong:
  scan broad root → delete matching names

Better:
  validate root → no-follow symlink → tombstone/mark → delete safe target → report failures
```

Contoh audit:

```text
Wrong:
  scan tree → claim exact compliance snapshot

Better:
  scan tree → report best-effort unless backed by snapshot/quiescence/manifest
```

---

## 34. Practical Exercises

### Exercise 1 — Direct Listing Utility

Buat method:

```java
List<Path> listRegularFiles(Path dir)
```

Requirement:

- hanya direct children,
- hanya regular file,
- close resource,
- handle Java 8,
- tidak follow symlink secara eksplisit.

Pertanyaan lanjutan:

- Apakah result ordered?
- Apa yang terjadi jika file dihapus saat listing?
- Bagaimana jika directory tidak punya permission?

---

### Exercise 2 — Recursive Size with Failure Report

Buat:

```java
DirectorySizeResult calculateSize(Path root)
```

Requirement:

- recursive,
- jangan follow symlink,
- continue on file failure,
- return total bytes,
- return failure list,
- jangan collect semua path.

Hint: gunakan `walkFileTree`.

---

### Exercise 3 — Safe Cleanup Preview

Buat dry-run cleanup:

```java
CleanupPreview preview(Path root, Duration olderThan)
```

Requirement:

- validasi root bukan filesystem root,
- recursive max depth configurable,
- skip hidden directory,
- cari regular file yang last modified lebih tua dari cutoff,
- jangan delete apa pun,
- return candidate count dan total bytes.

---

### Exercise 4 — Inbox Claim Scanner

Buat worker:

```java
void scanAndClaim(Path inbox, Path processing)
```

Requirement:

- list direct children only,
- hanya file `.ready`,
- claim dengan `ATOMIC_MOVE`,
- tolerate `NoSuchFileException`,
- jangan process file yang gagal diklaim.

---

## 35. Summary

Directory traversal di Java bukan sekadar memilih antara `list` dan `walk`.

Mental model yang benar:

```text
Directory is mutable provider-managed metadata.
Traversal is lazy, weakly consistent discovery.
Stream-based filesystem APIs hold resources and must be closed.
Ordering is not guaranteed.
Recursive mutation needs visitor-style lifecycle control.
Symlink policy is a security boundary.
Traversal does not imply ownership.
```

API summary:

```text
Files.list             → direct children, Stream
DirectoryStream        → direct children, scalable explicit iterator
Files.walk             → recursive Stream
Files.find             → recursive Stream with attributes in predicate
Files.walkFileTree     → recursive visitor with lifecycle/error control
```

Production guidance:

```text
Use Files.list for small simple one-level listing.
Use DirectoryStream for large direct directories.
Use Files.find when recursive filtering needs attributes.
Use Files.walk for simple recursive read-only pipelines.
Use walkFileTree for serious recursive operations.
```

The top 1% skill here is not memorizing APIs. It is knowing when the filesystem is not giving you a stable truth, when a path is only a candidate, when resource lifetime matters, and when your workflow needs a protocol beyond traversal.

---

## 36. References

- Java SE 25 API — `java.nio.file.Files`
- Java SE 8 API — `java.nio.file.Files`
- Java SE 8 API — `java.nio.file.FileVisitor`
- Oracle Java Tutorials — Walking the File Tree
- dev.java — Listing the Content of a Directory

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-io-file-filesystem-storage-engineering — Part 09](./learn-java-io-file-filesystem-storage-engineering-part-09-delete-semantics.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 11 — FileVisitor and Tree Algorithms: Robust Recursive Operations](./learn-java-io-file-filesystem-storage-engineering-part-11-filevisitor-tree-algorithms.md)
