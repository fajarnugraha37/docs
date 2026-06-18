# Part 013 — Directory Traversal, File Tree Walking, Search, Copy, Move, Delete

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-013.md`  
> Status: Part 013 dari 030 — **seri belum selesai**

---

## 0. Tujuan Pembelajaran

Pada part ini kita fokus pada operasi direktori dan file tree. Ini terlihat sederhana, tetapi di sistem production sering menjadi sumber bug besar: proses import membaca file setengah jadi, recursive delete menghapus folder yang salah, copy besar berhenti di tengah dan meninggalkan target inconsistent, traversal mengikuti symbolic link dan masuk loop, atau pencarian file memakai `Files.walk()` tanpa menutup stream sehingga file descriptor bocor.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan operasi direktori dangkal dan traversal rekursif.
2. Memilih API yang tepat antara `Files.list`, `DirectoryStream`, `Files.walk`, `Files.find`, dan `Files.walkFileTree`.
3. Mendesain traversal yang aman terhadap direktori besar, symlink, permission error, partial failure, dan resource leak.
4. Menulis recursive copy, move, dan delete dengan failure model yang jelas.
5. Memahami kenapa operasi file tree jarang benar-benar atomic.
6. Membuat pola production untuk file ingestion, cleanup job, export folder, archive folder, dan reconciliation.
7. Menghindari security issue seperti path traversal, symlink escape, dan Zip Slip style extraction.

---

## 1. Mental Model: Directory Bukan Sekadar “Folder”

Di level aplikasi, direktori sering dianggap sebagai container file. Di level filesystem, direktori adalah struktur metadata yang memetakan nama entry ke object filesystem lain: regular file, directory, symbolic link, device file, socket file, FIFO, atau tipe lain tergantung OS/filesystem.

Karena itu, traversal direktori bukan sekadar loop sederhana:

```text
start/
  a.txt
  b.txt
  child/
    c.txt
```

Di production, bentuknya bisa seperti ini:

```text
start/
  incoming-001.csv
  incoming-002.csv.tmp
  child/
    data.json
  symlink-to-parent -> ..
  symlink-to-etc -> /etc
  unreadable-dir/
  very-large-dir-with-2-million-files/
  file-being-written-by-another-process.dat
  file-renamed-while-you-walk.txt
```

Artinya, file tree adalah struktur yang bisa berubah ketika sedang dibaca. Ia bukan snapshot immutable kecuali kamu berada di filesystem atau storage yang memang memberi snapshot semantics.

### 1.1 Invariant penting

Saat mendesain traversal, pegang invariant berikut:

1. **Path bukan bukti bahwa file masih ada.**  
   File bisa dihapus atau dipindahkan setelah ditemukan.

2. **Directory listing bukan snapshot stabil.**  
   Entry bisa muncul/hilang ketika listing sedang berjalan.

3. **`exists()` bukan validasi final.**  
   Ada race antara check dan use.

4. **Recursive operation hampir selalu partial-failure-prone.**  
   Jika copy 10.000 file dan file ke-7.231 gagal, sistem harus tahu bagaimana recover.

5. **Symbolic link mengubah bentuk graph.**  
   File tree yang semula tree bisa menjadi graph dan bahkan cycle.

6. **Path string bisa menipu.**  
   `../`, symlink, case-insensitive filesystem, mount point, dan separator berbeda bisa membuat validasi path salah.

7. **Operasi delete/copy/move recursive bukan transaksi.**  
   Java tidak membuat seluruh file tree operation menjadi atomic.

---

## 2. API Landscape untuk Directory Operation

Java NIO.2 menyediakan beberapa API utama:

| API | Sifat | Cocok untuk | Risiko utama |
|---|---:|---|---|
| `Files.list(Path)` | shallow, stream | list entry 1 level | stream harus ditutup |
| `DirectoryStream<Path>` | shallow, iterable | direktori sangat besar, low overhead | manual loop, harus ditutup |
| `Files.walk(Path, ...)` | recursive, stream | pipeline pencarian sederhana | lazy stream, file descriptor leak jika tidak ditutup |
| `Files.find(...)` | recursive, stream + attributes | pencarian dengan predicate attribute | tetap lazy dan perlu ditutup |
| `Files.walkFileTree(...)` | recursive visitor | copy/delete/scan robust | lebih verbose, tapi paling terkontrol |
| `FileVisitor<Path>` | callback traversal | kontrol error/skip/subtree | perlu desain state |
| `SimpleFileVisitor<Path>` | base implementation | visitor praktis | default behavior rethrow error |

Rule praktis:

```text
Butuh list 1 level kecil/sedang?         -> Files.list
Butuh list 1 level sangat besar?         -> DirectoryStream
Butuh recursive filter sederhana?        -> Files.walk / Files.find
Butuh recursive delete/copy/move robust? -> Files.walkFileTree + SimpleFileVisitor
Butuh handle error per directory/file?    -> FileVisitor
Butuh security terhadap symlink?          -> canonical/real-path strategy + careful LinkOption
```

---

## 3. `Files.list`: Shallow Listing dengan Stream

`Files.list(path)` mengembalikan `Stream<Path>` yang berisi entry langsung di dalam direktori. Ia tidak recursive.

Contoh:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

public final class ListDirectoryExample {
    public static void main(String[] args) throws IOException {
        Path dir = Path.of("data/incoming");

        try (Stream<Path> entries = Files.list(dir)) {
            entries
                .filter(Files::isRegularFile)
                .forEach(System.out::println);
        }
    }
}
```

Hal penting: stream dari `Files.list` harus ditutup. Jangan menulis:

```java
Files.list(dir).forEach(System.out::println); // buruk: stream tidak ditutup eksplisit
```

Mungkin terlihat aman karena proses selesai cepat, tetapi di service long-running, ini bisa menjadi file descriptor leak.

### 3.1 Kapan `Files.list` cocok?

Cocok untuk:

- membaca isi direktori satu level;
- implementasi endpoint admin sederhana;
- validasi folder staging;
- scan folder kecil/sedang;
- pipeline singkat dengan filter/map.

Tidak cocok untuk:

- recursive traversal;
- direktori sangat besar;
- operasi yang harus menangani error detail per entry;
- recursive delete/copy;
- logic yang butuh pruning subtree.

### 3.2 Hidden cost dari stream

`Stream<Path>` membuat code terlihat functional, tetapi underlying-nya tetap resource filesystem. Karena lazy, operasi baru benar-benar berjalan saat terminal operation dipanggil.

Contoh bug:

```java
public static Stream<Path> regularFiles(Path dir) throws IOException {
    try (Stream<Path> entries = Files.list(dir)) {
        return entries.filter(Files::isRegularFile); // BUG
    }
}
```

Stream dikembalikan setelah ditutup. Saat caller mengonsumsi stream, resource sudah closed.

Perbaikan: konsumsi stream di dalam method atau return collection terbatas.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

public static List<Path> regularFiles(Path dir) throws IOException {
    try (Stream<Path> entries = Files.list(dir)) {
        return entries
            .filter(Files::isRegularFile)
            .toList();
    }
}
```

Tetapi untuk direktori sangat besar, `toList()` juga bisa bermasalah karena menahan semua path di memory. Jadi desain harus mengikuti ukuran data.

---

## 4. `DirectoryStream`: Shallow Listing untuk Direktori Besar

`DirectoryStream<Path>` adalah API iterable yang mewakili stream entry direktori. Ia cocok ketika kamu ingin looping sederhana tanpa overhead stream pipeline.

```java
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;

public final class DirectoryStreamExample {
    public static void main(String[] args) throws IOException {
        Path dir = Path.of("data/incoming");

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path entry : stream) {
                if (Files.isRegularFile(entry)) {
                    System.out.println(entry);
                }
            }
        }
    }
}
```

Dengan glob filter:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, "*.csv")) {
    for (Path entry : stream) {
        System.out.println(entry);
    }
}
```

Dengan custom filter:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir, entry ->
        Files.isRegularFile(entry) && entry.getFileName().toString().endsWith(".csv"))) {
    for (Path entry : stream) {
        process(entry);
    }
}
```

### 4.1 Kapan `DirectoryStream` lebih baik?

Gunakan `DirectoryStream` saat:

- direktori bisa sangat besar;
- kamu ingin konsumsi satu per satu;
- kamu ingin memory tetap bounded;
- kamu ingin lifecycle resource eksplisit;
- kamu tidak butuh stream pipeline.

### 4.2 Batasan penting

`DirectoryStream` hanya shallow. Ia tidak recursive.

Kalau kamu perlu recursive traversal, jangan membuat recursion manual sembarangan kecuali memang butuh custom behavior. Untuk operasi file tree, `Files.walkFileTree` biasanya lebih tepat.

---

## 5. `Files.walk`: Recursive Traversal Berbasis Stream

`Files.walk(start)` mengembalikan `Stream<Path>` yang berjalan recursive dari start path. Traversal dilakukan depth-first dan lazy.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

public final class WalkExample {
    public static void main(String[] args) throws IOException {
        Path root = Path.of("data");

        try (Stream<Path> paths = Files.walk(root)) {
            paths
                .filter(Files::isRegularFile)
                .forEach(System.out::println);
        }
    }
}
```

Dengan max depth:

```java
try (Stream<Path> paths = Files.walk(root, 2)) {
    paths.forEach(System.out::println);
}
```

### 5.1 Mental model `Files.walk`

`Files.walk` bukan membuat list semua path di depan. Ia lazy. Ini bagus untuk memory, tetapi resource direktori bisa tetap terbuka selama traversal.

```text
Files.walk(root)
  -> buka root directory saat dibutuhkan
  -> emit root
  -> emit child
  -> jika child directory, masuk depth-first
  -> buka/tutup directory sesuai traversal
```

Karena lazy, stream harus ditutup:

```java
try (Stream<Path> paths = Files.walk(root)) {
    // consume here
}
```

### 5.2 Jangan memakai `Files.walk` untuk recursive delete sederhana tanpa hati-hati

Contoh populer:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths
        .sorted(Comparator.reverseOrder())
        .forEach(path -> {
            try {
                Files.delete(path);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        });
}
```

Ini bisa bekerja untuk case sederhana, karena reverse order menghapus child sebelum parent. Namun untuk production, ada beberapa masalah:

1. Sorting semua path berarti semua path harus ditahan di memory.
2. Error handling menjadi kasar.
3. Tidak mudah membedakan gagal delete file vs gagal akses directory.
4. Symlink dan permission case perlu perhatian khusus.
5. Jika tree sangat besar, memory bisa membengkak.

Untuk recursive delete production, `walkFileTree` biasanya lebih tepat.

---

## 6. `Files.find`: Recursive Search dengan Attribute Predicate

`Files.find` mirip `walk`, tetapi predicate-nya menerima `Path` dan `BasicFileAttributes`. Ini lebih efisien dan lebih jelas jika filter membutuhkan metadata.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.stream.Stream;

public final class FindExample {
    public static void main(String[] args) throws IOException {
        Path root = Path.of("logs");
        Instant threshold = Instant.now().minus(7, ChronoUnit.DAYS);

        try (Stream<Path> paths = Files.find(root, Integer.MAX_VALUE, (path, attrs) ->
                attrs.isRegularFile()
                    && path.getFileName().toString().endsWith(".log")
                    && attrs.lastModifiedTime().toInstant().isBefore(threshold))) {

            paths.forEach(System.out::println);
        }
    }
}
```

### 6.1 Kenapa `Files.find` bisa lebih baik dari `Files.walk + Files.readAttributes`?

Dengan `Files.walk`, kamu sering menulis:

```java
paths.filter(path -> {
    try {
        return Files.isRegularFile(path)
            && Files.getLastModifiedTime(path).toInstant().isBefore(threshold);
    } catch (IOException e) {
        return false;
    }
});
```

Ini membuat error handling bercampur dengan predicate dan bisa melakukan attribute lookup terpisah. `Files.find` memberikan attributes langsung ke matcher.

Gunakan `Files.find` untuk:

- mencari file berdasarkan size;
- mencari file berdasarkan modified time;
- mencari regular file saja;
- mencari file lama untuk cleanup;
- mencari file dengan kombinasi path + metadata.

---

## 7. `FileVisitor`: Model Paling Kuat untuk File Tree

Untuk operasi recursive yang serius, gunakan `Files.walkFileTree` dengan `FileVisitor` atau `SimpleFileVisitor`.

`FileVisitor` memiliki empat callback utama:

```text
preVisitDirectory(dir, attrs)
visitFile(file, attrs)
visitFileFailed(file, exc)
postVisitDirectory(dir, exc)
```

Mental model traversal:

```text
preVisitDirectory(root)
  visitFile(root/a.txt)
  preVisitDirectory(root/child)
    visitFile(root/child/b.txt)
  postVisitDirectory(root/child)
postVisitDirectory(root)
```

Return value callback adalah `FileVisitResult`:

| Result | Arti |
|---|---|
| `CONTINUE` | lanjut traversal |
| `TERMINATE` | hentikan seluruh traversal |
| `SKIP_SUBTREE` | jangan masuk ke subtree direktori ini |
| `SKIP_SIBLINGS` | skip entry lain di direktori yang sama |

### 7.1 Contoh scan file dengan visitor

```java
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;

public final class WalkFileTreeScanExample {
    public static void main(String[] args) throws IOException {
        Path root = Path.of("data");

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (attrs.isRegularFile()) {
                    System.out.println(file + " size=" + attrs.size());
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                System.err.println("Cannot access: " + file + " reason=" + exc.getMessage());
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
```

### 7.2 Kenapa visitor bagus untuk production?

Karena kamu bisa mengontrol:

- apa yang terjadi sebelum masuk direktori;
- apa yang terjadi setelah semua child selesai;
- bagaimana menangani file yang gagal dibaca;
- kapan skip subtree;
- kapan terminate;
- bagaimana menyimpan state traversal;
- bagaimana menghapus child sebelum parent;
- bagaimana membuat report partial failure.

---

## 8. Depth-First Traversal dan Implikasinya

NIO file tree traversal berjalan depth-first.

Contoh:

```text
root/
  a.txt
  b/
    c.txt
    d/
      e.txt
  f.txt
```

Urutan tipikal:

```text
pre root
visit root/a.txt
pre root/b
visit root/b/c.txt
pre root/b/d
visit root/b/d/e.txt
post root/b/d
post root/b
visit root/f.txt
post root
```

Implikasi:

1. Untuk delete recursive, hapus directory di `postVisitDirectory`.
2. Untuk copy recursive, buat target directory di `preVisitDirectory`.
3. Untuk menghitung aggregate size, tambahkan size di `visitFile`, finalize di `postVisitDirectory`.
4. Untuk skip folder tertentu, return `SKIP_SUBTREE` dari `preVisitDirectory`.

---

## 9. Symbolic Link: Tree Bisa Menjadi Graph

Secara default, traversal tidak mengikuti symbolic link ke directory. Jika kamu menambahkan `FileVisitOption.FOLLOW_LINKS`, traversal dapat mengikuti link.

Masalahnya: symlink bisa menyebabkan cycle.

```text
root/
  a/
    back -> ../a
```

Jika traversal mengikuti link tanpa deteksi cycle, ia bisa berputar.

Java memiliki mekanisme untuk mendeteksi cycle saat follow links, tetapi sebagai engineer kamu tetap harus mendesain policy:

```text
Policy 1: Jangan follow symlink sama sekali.
Policy 2: Follow symlink hanya jika target masih dalam root.
Policy 3: Follow symlink dengan maxDepth terbatas.
Policy 4: Treat symlink sebagai file entry, bukan target.
Policy 5: Fail-fast jika menemukan symlink.
```

Untuk sistem yang menerima path dari user atau memproses archive, default aman adalah:

```text
Do not follow symlink unless there is a strong reason.
```

### 9.1 Memeriksa symlink

```java
import java.nio.file.Files;
import java.nio.file.Path;

Path path = Path.of("data/link");

if (Files.isSymbolicLink(path)) {
    Path target = Files.readSymbolicLink(path);
    System.out.println("Link target: " + target);
}
```

### 9.2 Root escape

Jika root adalah:

```text
/app/uploads/user-123
```

Lalu ada symlink:

```text
/app/uploads/user-123/link -> /etc
```

Maka traversal yang follow link bisa keluar dari root. Ini dangerous untuk:

- file download;
- archive extraction;
- cleanup job;
- recursive delete;
- permission normalization;
- file scanner.

Pattern aman:

```java
Path root = Path.of("/app/uploads/user-123").toRealPath();
Path candidate = root.resolve(userProvidedRelativePath).normalize();
Path realCandidate = candidate.toRealPath();

if (!realCandidate.startsWith(root)) {
    throw new SecurityException("Path escapes root directory");
}
```

Catatan: `toRealPath()` butuh path exist. Untuk path yang belum exist, validasi harus dilakukan terhadap parent yang exist dan final name yang divalidasi ketat. Ini akan dibahas lebih dalam di part security.

---

## 10. Recursive Delete yang Benar dengan `walkFileTree`

Recursive delete harus menghapus file terlebih dahulu, lalu directory setelah child selesai. Karena itu directory dihapus di `postVisitDirectory`.

```java
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;

public final class RecursiveDelete {
    public static void deleteTree(Path root) throws IOException {
        if (!Files.exists(root)) {
            return;
        }

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
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
    }
}
```

### 10.1 Kenapa tidak delete directory di `preVisitDirectory`?

Karena directory belum kosong.

```text
preVisitDirectory(root)     -> root masih berisi child
visitFile(root/a.txt)       -> child baru dikunjungi setelah pre
postVisitDirectory(root)    -> semua child sudah selesai
```

### 10.2 Delete dengan report partial failure

Di beberapa sistem, fail-fast tepat. Di sistem lain, cleanup harus mencoba sebanyak mungkin dan melaporkan semua gagal.

```java
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;

public final class BestEffortDelete {
    public record DeleteFailure(Path path, IOException error) {}

    public static List<DeleteFailure> deleteBestEffort(Path root) throws IOException {
        List<DeleteFailure> failures = new ArrayList<>();

        if (!Files.exists(root)) {
            return failures;
        }

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                try {
                    Files.delete(file);
                } catch (IOException e) {
                    failures.add(new DeleteFailure(file, e));
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                failures.add(new DeleteFailure(file, exc));
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
                if (exc != null) {
                    failures.add(new DeleteFailure(dir, exc));
                }
                try {
                    Files.delete(dir);
                } catch (IOException e) {
                    failures.add(new DeleteFailure(dir, e));
                }
                return FileVisitResult.CONTINUE;
            }
        });

        return failures;
    }
}
```

### 10.3 Safety guard untuk recursive delete

Jangan pernah membuat helper delete tree tanpa guard.

Minimal guard:

```java
static void validateDeleteRoot(Path root) throws IOException {
    Path real = root.toRealPath();

    if (real.getNameCount() < 3) {
        throw new IllegalArgumentException("Refusing to delete suspiciously broad path: " + real);
    }

    if (!Files.isDirectory(real)) {
        throw new IllegalArgumentException("Root must be directory: " + real);
    }
}
```

Lebih baik lagi, batasi ke base directory yang sudah known:

```java
static Path validateUnderBase(Path base, Path candidate) throws IOException {
    Path realBase = base.toRealPath();
    Path realCandidate = candidate.toRealPath();

    if (!realCandidate.startsWith(realBase)) {
        throw new SecurityException("Path escapes allowed base: " + candidate);
    }

    return realCandidate;
}
```

---

## 11. Recursive Copy dengan `walkFileTree`

Recursive copy harus:

1. membuat target directory sebelum child disalin;
2. copy file ke path relatif yang sama di target;
3. preserve attribute jika dibutuhkan;
4. menentukan policy replace existing;
5. menangani partial failure;
6. tidak follow symlink kecuali policy mengizinkan.

```java
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;

public final class RecursiveCopy {
    public static void copyTree(Path sourceRoot, Path targetRoot) throws IOException {
        Path realSource = sourceRoot.toRealPath();

        Files.walkFileTree(realSource, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                Path relative = realSource.relativize(dir);
                Path targetDir = targetRoot.resolve(relative);
                Files.createDirectories(targetDir);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Path relative = realSource.relativize(file);
                Path targetFile = targetRoot.resolve(relative);

                Files.copy(
                    file,
                    targetFile,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.COPY_ATTRIBUTES
                );

                return FileVisitResult.CONTINUE;
            }
        });
    }
}
```

### 11.1 Copy tidak otomatis atomic untuk seluruh tree

Jika ada 10.000 file dan file ke-5.000 gagal, 4.999 file sudah tersalin. Ini bukan transaksi.

Karena itu, desain production biasanya memakai staging:

```text
copy source -> target.tmp-<jobId>
verify target.tmp-<jobId>
atomic rename target.tmp-<jobId> -> target-final
```

Namun atomic rename hanya atomic untuk rename satu directory entry dan biasanya harus berada pada filesystem yang sama. Ia tidak membuat isi copy sebelumnya menjadi atomic.

### 11.2 Copy dengan manifest

Untuk copy besar, buat manifest:

```text
manifest.json
  sourceRoot
  targetRoot
  fileCount
  totalBytes
  files[]:
    relativePath
    size
    lastModified
    checksum optional
```

Pipeline:

```text
1. scan source -> manifest
2. copy files -> staging
3. verify staging against manifest
4. publish staging -> final
5. cleanup old staging
```

Ini jauh lebih robust daripada copy langsung ke final directory.

---

## 12. Recursive Move: Rename vs Copy+Delete

`Files.move(source, target)` bisa sangat cepat jika hanya rename dalam filesystem yang sama. Tetapi jika beda filesystem, provider bisa gagal atau perlu copy+delete tergantung opsi/implementation.

Untuk file tree, move recursive bisa berarti:

```text
Case 1: source dan target di filesystem sama
  -> atomic directory rename mungkin cukup

Case 2: source dan target beda filesystem/mount
  -> harus copy tree lalu delete source
```

### 12.1 Fast path: atomic move

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public static void moveDirectoryAtomically(Path source, Path target) throws IOException {
    Files.move(
        source,
        target,
        StandardCopyOption.ATOMIC_MOVE
    );
}
```

Jika gagal karena beda filesystem atau provider tidak mendukung atomic move, kamu harus punya fallback policy.

### 12.2 Fallback copy+delete

```text
1. copy source -> target.tmp
2. verify target.tmp
3. move target.tmp -> target final
4. delete source
```

Risiko:

- source berubah selama copy;
- delete source gagal sebagian;
- target sudah ada;
- copy sukses tapi publish gagal;
- publish sukses tapi delete source gagal;
- job retry menciptakan duplikasi.

Karena itu recursive move production harus dipandang sebagai state machine, bukan satu function call.

---

## 13. Search Pattern: File Discovery yang Aman untuk Ingestion

Kasus umum: service memproses file dari folder incoming.

Naive:

```java
try (Stream<Path> files = Files.list(incoming)) {
    files.filter(path -> path.toString().endsWith(".csv"))
         .forEach(this::process);
}
```

Masalah:

1. File mungkin masih sedang ditulis.
2. File bisa berubah saat diproses.
3. File bisa diproses dua worker sekaligus.
4. File gagal diproses dan hilang statusnya.
5. File partial dianggap valid.
6. Tidak ada idempotency.

Pattern lebih aman:

```text
incoming/      -> producer meletakkan file sementara
ready/         -> file yang sudah atomic move ke ready
processing/    -> worker claim file dengan atomic move
processed/     -> sukses
failed/        -> gagal beserta reason
quarantine/    -> suspicious/corrupt
```

Flow:

```text
producer writes incoming/file.tmp
producer fsync/close
producer atomic move incoming/file.tmp -> ready/file.csv
worker atomic move ready/file.csv -> processing/file.csv.<workerId>
worker process
worker move processing/... -> processed/... or failed/...
```

Dengan ini discovery tidak perlu menebak apakah file selesai ditulis. Contract-nya: hanya file di `ready` yang boleh diproses.

### 13.1 Claim file dengan atomic move

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

public static boolean tryClaim(Path readyFile, Path processingFile) throws IOException {
    try {
        Files.move(readyFile, processingFile, StandardCopyOption.ATOMIC_MOVE);
        return true;
    } catch (java.nio.file.NoSuchFileException e) {
        return false; // already claimed/deleted by another worker
    } catch (java.nio.file.FileAlreadyExistsException e) {
        return false; // another worker used same target or stale processing file exists
    }
}
```

Catatan: atomic move harus didesain dalam filesystem yang sama.

---

## 14. Copy/Move/Delete Options

Beberapa opsi penting:

| Option | Digunakan untuk | Catatan |
|---|---|---|
| `REPLACE_EXISTING` | copy/move | overwrite target jika ada |
| `COPY_ATTRIBUTES` | copy | preserve metadata jika didukung |
| `ATOMIC_MOVE` | move | gagal jika tidak bisa atomic |
| `NOFOLLOW_LINKS` | link option | jangan follow symlink untuk operasi tertentu |

### 14.1 Replace existing bukan selalu aman

`REPLACE_EXISTING` bisa berbahaya jika:

- target adalah file penting;
- path target berasal dari input user;
- target mungkin symlink;
- target sedang dibaca proses lain;
- operasi bukan idempotent.

Production pattern:

```text
Do not overwrite final path directly.
Write to staging path, verify, then atomic publish.
```

---

## 15. Error Handling Strategy

Traversal yang robust harus membedakan jenis error.

| Error | Arti | Respons umum |
|---|---|---|
| `NoSuchFileException` | file hilang saat operasi | ignore/reconcile tergantung konteks |
| `AccessDeniedException` | permission issue | report, skip, alert |
| `DirectoryNotEmptyException` | delete dir masih ada entry | retry/re-scan |
| `FileAlreadyExistsException` | target conflict | idempotency check atau fail |
| `FileSystemLoopException` | symlink cycle | skip/fail security |
| `AtomicMoveNotSupportedException` | atomic move tidak bisa | fallback atau fail |
| `NotDirectoryException` | path bukan dir | config/user error |
| `FileSystemException` | generic OS/filesystem issue | inspect reason |

### 15.1 Fail-fast vs best-effort

Gunakan fail-fast jika:

- operasi harus all-or-nothing secara logical;
- data corruption lebih buruk daripada incomplete result;
- target final belum boleh muncul jika ada error;
- user perlu immediate feedback.

Gunakan best-effort jika:

- cleanup job;
- background archival;
- scanning untuk report;
- delete cache;
- quarantine suspicious files;
- operasi bisa direconcile ulang.

### 15.2 Error aggregation

Untuk job besar, jangan hanya throw error pertama tanpa context. Simpan:

```text
jobId
operation
root
path
errorClass
message
phase
attempt
timestamp
```

Contoh record:

```java
public record FileOperationFailure(
    String jobId,
    String operation,
    Path root,
    Path path,
    String phase,
    String errorType,
    String message
) {}
```

---

## 16. Race Condition dan TOCTOU

TOCTOU adalah Time Of Check To Time Of Use.

Naive:

```java
if (Files.exists(path)) {
    Files.delete(path);
}
```

Di antara `exists` dan `delete`, file bisa hilang atau berubah.

Lebih baik:

```java
try {
    Files.delete(path);
} catch (java.nio.file.NoSuchFileException ignored) {
    // already gone; okay for idempotent delete
}
```

Atau:

```java
Files.deleteIfExists(path);
```

Namun `deleteIfExists` tetap bisa gagal karena permission, directory not empty, file busy, dan lain-lain.

### 16.1 Check bukan lock

```java
if (Files.isRegularFile(path)) {
    process(path);
}
```

File bisa diganti menjadi symlink setelah check. Untuk boundary security, gunakan pendekatan yang lebih kuat:

- operate relative to trusted base;
- resolve real path;
- jangan follow symlink jika tidak perlu;
- gunakan secure directory operation jika tersedia;
- claim file dengan move;
- validasi ulang setelah open bila perlu.

---

## 17. Directory Traversal Security

Directory traversal vulnerability terjadi ketika input user dapat membuat aplikasi mengakses path di luar root yang diizinkan.

Contoh buruk:

```java
Path file = uploadRoot.resolve(userInput);
return Files.readAllBytes(file);
```

Jika `userInput` adalah:

```text
../../../../etc/passwd
```

maka path bisa keluar dari root.

Pattern dasar:

```java
import java.nio.file.Path;

public static Path resolveUnderRoot(Path root, String userInput) {
    Path normalized = root.resolve(userInput).normalize();

    if (!normalized.startsWith(root.normalize())) {
        throw new SecurityException("Path traversal attempt: " + userInput);
    }

    return normalized;
}
```

Namun ini belum cukup terhadap symlink jika file sudah ada. Untuk file existing, gunakan real path check:

```java
public static Path resolveExistingUnderRoot(Path root, String userInput) throws IOException {
    Path realRoot = root.toRealPath();
    Path candidate = realRoot.resolve(userInput).normalize();
    Path realCandidate = candidate.toRealPath();

    if (!realCandidate.startsWith(realRoot)) {
        throw new SecurityException("Path escapes root: " + userInput);
    }

    return realCandidate;
}
```

### 17.1 Filename allowlist

Untuk upload/export, sering lebih aman membatasi filename daripada menerima path.

```java
private static final java.util.regex.Pattern SAFE_FILE_NAME =
    java.util.regex.Pattern.compile("[a-zA-Z0-9._-]{1,120}");

public static String validateFileName(String input) {
    if (!SAFE_FILE_NAME.matcher(input).matches()) {
        throw new IllegalArgumentException("Invalid file name");
    }
    return input;
}
```

Jangan terima separator:

```text
/
\
..
:
NULL byte
control characters
```

---

## 18. Zip Slip sebagai Bentuk Directory Traversal

Walaupun part compression baru dibahas nanti, Zip Slip relevan untuk traversal. Zip entry bisa punya nama seperti:

```text
../../outside.txt
```

Jika extraction code melakukan:

```java
Path target = dest.resolve(zipEntry.getName());
Files.copy(zipInputStream, target);
```

maka file bisa keluar dari destination.

Pattern aman:

```java
Path destinationRoot = dest.toRealPath();
Path target = destinationRoot.resolve(entryName).normalize();

if (!target.startsWith(destinationRoot)) {
    throw new SecurityException("Zip entry escapes destination: " + entryName);
}
```

Untuk symlink di archive, policy harus lebih ketat: reject atau handle explicitly.

---

## 19. Large Directory Performance

Direktori dengan jutaan entry memiliki karakteristik berbeda dari direktori kecil.

Masalah umum:

1. Listing lama.
2. Sorting semua path menyebabkan memory besar.
3. `toList()` membuat memory spike.
4. Banyak attribute lookup menyebabkan syscall banyak.
5. Logging per file memperlambat job.
6. Error di satu file menghentikan semua scan jika tidak dirancang.
7. Parallel traversal bisa membebani disk/network filesystem.

### 19.1 Hindari global sort jika tidak wajib

Buruk untuk tree besar:

```java
try (Stream<Path> paths = Files.walk(root)) {
    List<Path> all = paths.sorted().toList();
}
```

Lebih baik konsumsi streaming:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
    for (Path entry : stream) {
        process(entry);
    }
}
```

Atau gunakan visitor untuk recursive.

### 19.2 Batch processing

Jika perlu submit ke worker pool, jangan submit unbounded.

Buruk:

```java
try (Stream<Path> paths = Files.walk(root)) {
    paths.filter(Files::isRegularFile)
         .forEach(path -> executor.submit(() -> process(path)));
}
```

Jika ada 1 juta file, queue bisa meledak.

Gunakan bounded executor/queue atau proses batch.

Pseudo-design:

```text
traversal thread -> bounded queue -> N worker
if queue full, traversal blocks
```

Ini menciptakan backpressure.

---

## 20. Parallel Traversal: Jangan Otomatis Pakai `parallelStream()`

`Files.walk(root).parallel()` terlihat menggoda, tetapi sering buruk.

Masalah:

- underlying traversal tetap punya resource filesystem;
- disk bisa seek-heavy;
- network filesystem bisa overload;
- error handling makin rumit;
- order tidak stabil;
- common ForkJoinPool bisa terganggu;
- blocking I/O di common pool adalah anti-pattern.

Lebih baik desain eksplisit:

```text
single traversal producer
bounded work queue
fixed-size worker pool
explicit metrics
explicit cancellation
explicit error policy
```

Contoh ringkas:

```java
// Konsep saja; production perlu shutdown/error handling lebih lengkap.
BlockingQueue<Path> queue = new ArrayBlockingQueue<>(1000);
ExecutorService workers = Executors.newFixedThreadPool(8);
```

Parallelisme I/O harus ditentukan berdasarkan bottleneck:

```text
Local SSD        -> concurrency sedang bisa membantu
Network storage  -> concurrency terlalu tinggi bisa memperburuk latency
HDD              -> random access parallel bisa buruk
Object storage   -> parallel range/chunk bisa membantu
CPU-heavy parse   -> worker CPU-bound perlu sizing berbeda
```

---

## 21. Recursive Size Calculation

Menghitung ukuran folder terlihat sederhana tetapi perlu policy:

- follow symlink atau tidak?
- hitung directory metadata atau hanya regular file?
- apa yang dilakukan jika file tidak bisa dibaca?
- apakah sparse file dihitung logical size atau disk usage?

Contoh simple logical size:

```java
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.concurrent.atomic.LongAdder;

public final class DirectorySize {
    public static long logicalSize(Path root) throws IOException {
        LongAdder total = new LongAdder();

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (attrs.isRegularFile()) {
                    total.add(attrs.size());
                }
                return FileVisitResult.CONTINUE;
            }
        });

        return total.sum();
    }
}
```

Catatan: `attrs.size()` adalah logical size, bukan selalu disk blocks used. Sparse file bisa punya logical size besar tetapi disk usage kecil.

---

## 22. File Tree Filtering dan Pruning

Untuk skip folder tertentu:

```java
Files.walkFileTree(root, new SimpleFileVisitor<>() {
    @Override
    public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
        String name = dir.getFileName() == null ? "" : dir.getFileName().toString();

        if (name.equals(".git") || name.equals("node_modules") || name.equals("target")) {
            return FileVisitResult.SKIP_SUBTREE;
        }

        return FileVisitResult.CONTINUE;
    }
});
```

Ini lebih efisien daripada `Files.walk(root).filter(...)` karena subtree tidak perlu dikunjungi sama sekali.

### 22.1 Skip by depth

`walkFileTree` punya overload dengan `maxDepth`:

```java
Files.walkFileTree(
    root,
    java.util.EnumSet.noneOf(java.nio.file.FileVisitOption.class),
    3,
    visitor
);
```

Gunakan max depth untuk mencegah traversal terlalu dalam, terutama saat input root tidak sepenuhnya trusted.

---

## 23. Handling Directory Mutation Saat Traversal

Directory bisa berubah saat kamu traversal.

Skenario:

```text
1. Traversal menemukan file A.
2. Proses lain menghapus file A.
3. Traversal mencoba baca attribute/copy/delete A.
4. NoSuchFileException.
```

Ini bukan selalu error fatal. Untuk scanning/report, mungkin cukup skip. Untuk copy backup, mungkin harus fail karena source tidak stabil.

### 23.1 Stable source strategy

Jika butuh source stabil:

1. Stop writer.
2. Gunakan snapshot filesystem/storage.
3. Copy dari immutable staging.
4. Producer menulis ke temp lalu atomic publish.
5. Ambil manifest lebih dulu lalu verify.

Tanpa strategi ini, recursive copy dari folder aktif tidak bisa dijamin konsisten.

---

## 24. Atomicity Realities

Atomic operation di filesystem biasanya terbatas.

| Operasi | Bisa atomic? | Catatan |
|---|---:|---|
| Rename satu file dalam filesystem sama | biasanya ya | tergantung provider |
| Move directory dalam filesystem sama | biasanya ya | jika target valid dan tidak cross-device |
| Copy file besar | tidak | bisa partial |
| Copy tree | tidak | banyak operasi |
| Delete tree | tidak | banyak operasi |
| Replace file via temp+move | bisa logical atomic | jika move atomic |
| Replace tree via staging+move | bisa publish atomic | copy staging tidak atomic |

Production invariant:

```text
Expose final path only after content complete and verified.
```

---

## 25. Designing Recursive Operation as State Machine

Daripada memandang copy/delete/move sebagai function, desain sebagai state machine.

### 25.1 Copy job state machine

```text
NEW
  -> SCANNING_SOURCE
  -> MANIFEST_CREATED
  -> COPYING_TO_STAGING
  -> VERIFYING_STAGING
  -> PUBLISHING
  -> COMPLETED
  -> CLEANING_UP

Failure states:
  -> FAILED_SCAN
  -> FAILED_COPY_PARTIAL
  -> FAILED_VERIFY
  -> FAILED_PUBLISH
  -> FAILED_CLEANUP
```

State metadata:

```text
job_id
source_root
target_root
staging_root
file_count
total_bytes
copied_count
copied_bytes
failure_count
started_at
updated_at
status
```

Dengan state ini, retry dan observability jauh lebih mudah.

### 25.2 Delete job state machine

```text
NEW
  -> VALIDATING_ROOT
  -> SCANNING
  -> DELETING_FILES
  -> DELETING_DIRECTORIES
  -> VERIFYING_EMPTY
  -> COMPLETED

Failure states:
  -> FAILED_VALIDATION
  -> FAILED_DELETE_PARTIAL
  -> FAILED_VERIFY
```

Untuk delete, selalu log root real path dan guard result.

---

## 26. Production Pattern: Cleanup File Lama

Contoh: hapus file `.tmp` lebih dari 24 jam dari workspace.

```java
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class OldTempFileCleanup {
    public record CleanupResult(int deleted, List<Path> failed) {}

    public static CleanupResult cleanup(Path workspace, Duration olderThan) throws IOException {
        Path root = workspace.toRealPath();
        Instant cutoff = Instant.now().minus(olderThan);
        List<Path> failed = new ArrayList<>();
        int[] deleted = {0};

        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                String name = file.getFileName().toString();
                boolean old = attrs.lastModifiedTime().toInstant().isBefore(cutoff);

                if (name.endsWith(".tmp") && old) {
                    try {
                        Files.delete(file);
                        deleted[0]++;
                    } catch (IOException e) {
                        failed.add(file);
                    }
                }

                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                String name = dir.getFileName() == null ? "" : dir.getFileName().toString();

                if (name.equals("processed") || name.equals("archive")) {
                    return FileVisitResult.SKIP_SUBTREE;
                }

                return FileVisitResult.CONTINUE;
            }
        });

        return new CleanupResult(deleted[0], failed);
    }
}
```

Production improvement:

- emit metric `cleanup_deleted_total`;
- emit metric `cleanup_failed_total`;
- log sample failures, not millions of lines;
- add dry-run mode;
- add max delete per run;
- add root guard;
- add alert if failed high.

---

## 27. Production Pattern: Directory Snapshot Report

Untuk membuat report isi folder:

```text
relative_path,size,last_modified,type
```

Gunakan visitor dan tulis streaming ke output, jangan simpan semua path.

```java
import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;

public final class DirectoryReport {
    public static void writeReport(Path root, Path reportFile) throws IOException {
        Path realRoot = root.toRealPath();

        try (BufferedWriter writer = Files.newBufferedWriter(reportFile, StandardCharsets.UTF_8)) {
            writer.write("relative_path,size,last_modified,type");
            writer.newLine();

            Files.walkFileTree(realRoot, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Path relative = realRoot.relativize(file);
                    String type = attrs.isRegularFile() ? "file" : "other";

                    writer.write(escapeCsv(relative.toString()));
                    writer.write(',');
                    writer.write(Long.toString(attrs.size()));
                    writer.write(',');
                    writer.write(attrs.lastModifiedTime().toString());
                    writer.write(',');
                    writer.write(type);
                    writer.newLine();

                    return FileVisitResult.CONTINUE;
                }
            });
        }
    }

    private static String escapeCsv(String value) {
        if (value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
```

Catatan: report ini bukan snapshot transactional. Ia hanya observasi selama traversal.

---

## 28. Testing Strategy

Directory operation harus dites dengan kondisi yang tidak ideal.

### 28.1 Unit/integration case minimal

Test case:

1. Empty directory.
2. Directory dengan file satu level.
3. Nested directory.
4. File besar.
5. File dengan spasi dan unicode name.
6. File read-only.
7. Directory tanpa permission jika OS mendukung.
8. Symlink ke file.
9. Symlink ke directory.
10. Symlink cycle.
11. Target already exists.
12. Source berubah saat traversal.
13. Delete partial failure.
14. Copy partial failure.
15. Cross-filesystem move jika environment memungkinkan.

### 28.2 JUnit dengan temp dir

```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RecursiveDeleteTest {
    @TempDir
    Path tempDir;

    @Test
    void deletesNestedTree() throws Exception {
        Path root = tempDir.resolve("root");
        Files.createDirectories(root.resolve("a/b"));
        Files.writeString(root.resolve("a/b/file.txt"), "hello");

        RecursiveDelete.deleteTree(root);

        assertFalse(Files.exists(root));
    }
}
```

### 28.3 Fault injection

Untuk production-grade helper, buat abstraction agar operasi file bisa disimulasikan gagal.

Contoh phase yang perlu fault injection:

```text
create directory fails
copy file fails after N files
delete file fails for selected path
move publish fails
attribute read fails
visitFileFailed occurs
```

---

## 29. Observability untuk File Tree Job

Metric penting:

```text
file_tree_scan_started_total
file_tree_scan_completed_total
file_tree_scan_failed_total
file_tree_files_seen_total
file_tree_dirs_seen_total
file_tree_bytes_seen_total
file_tree_operation_duration_seconds
file_tree_operation_failures_total{error_type}
file_tree_skipped_total{reason}
file_tree_current_job_age_seconds
```

Log penting:

```text
job_id
operation
root_real_path
source_root
target_root
staging_root
file_count
byte_count
failure_count
first_failure
last_failure
elapsed_ms
```

Jangan log satu line per file untuk jutaan file kecuali debug mode. Gunakan sampling atau aggregate.

---

## 30. Anti-Pattern

### 30.1 Menggunakan `File` lama untuk operasi recursive baru

`java.io.File` masih ada, tetapi untuk operasi modern gunakan `Path` dan `Files`. `File` tidak memberi kontrol attribute, symlink, visitor, dan provider sebaik NIO.2.

### 30.2 Return lazy stream dari method tanpa ownership jelas

Buruk:

```java
Stream<Path> scan(Path root) throws IOException {
    return Files.walk(root);
}
```

Caller mungkin lupa menutup. Jika tetap ingin return stream, dokumentasikan ownership dan gunakan pattern jelas.

Lebih aman:

```java
void scan(Path root, Consumer<Path> consumer) throws IOException {
    try (Stream<Path> paths = Files.walk(root)) {
        paths.forEach(consumer);
    }
}
```

### 30.3 Recursive delete tanpa base guard

Buruk:

```java
deleteTree(Path.of(userInput));
```

Harus ada trusted base dan real path validation.

### 30.4 Follow symlink tanpa policy

Buruk:

```java
Files.walk(root, FileVisitOption.FOLLOW_LINKS)
```

Tanpa max depth, root validation, dan cycle policy, ini berbahaya.

### 30.5 Copy langsung ke final location

Buruk:

```text
copy source -> final
```

Jika gagal, final berisi data partial. Gunakan staging dan atomic publish.

### 30.6 Menelan semua IOException

Buruk:

```java
catch (IOException ignored) {}
```

Ini membuat corruption tidak terlihat. Minimal aggregate dan report.

---

## 31. Decision Matrix

| Kebutuhan | Pilihan API | Catatan |
|---|---|---|
| List isi folder 1 level | `Files.list` | tutup stream |
| List folder besar 1 level | `DirectoryStream` | memory bounded |
| Recursive scan sederhana | `Files.walk` | tutup stream |
| Recursive search by metadata | `Files.find` | predicate dapat attrs |
| Recursive delete | `walkFileTree` | delete dir di postVisitDirectory |
| Recursive copy | `walkFileTree` | create dir di preVisitDirectory |
| Skip subtree | `walkFileTree` | return `SKIP_SUBTREE` |
| Error handling per path | `FileVisitor` | paling explicit |
| Secure user path | `Path.normalize + realPath + startsWith` | hati-hati symlink |
| Huge tree processing | visitor + bounded queue | hindari `toList` |
| Publish hasil final | temp/staging + atomic move | same filesystem |

---

## 32. Checklist Production

Sebelum membuat operasi directory traversal/copy/delete, jawab:

```text
[ ] Apakah root path trusted?
[ ] Apakah root sudah divalidasi dengan real path?
[ ] Apakah symbolic link akan di-follow, di-skip, atau dianggap file?
[ ] Apakah ada max depth?
[ ] Apakah operasi harus fail-fast atau best-effort?
[ ] Apakah partial failure dicatat?
[ ] Apakah stream/directory resource ditutup?
[ ] Apakah operasi bisa berjalan pada direktori sangat besar?
[ ] Apakah ada bounded memory?
[ ] Apakah ada bounded concurrency?
[ ] Apakah copy menulis ke staging dulu?
[ ] Apakah final publish atomic?
[ ] Apakah delete punya safety guard?
[ ] Apakah ada dry-run mode untuk destructive operation?
[ ] Apakah ada metric dan log aggregate?
[ ] Apakah retry idempotent?
[ ] Apakah ada cleanup untuk staging lama?
[ ] Apakah test mencakup symlink, permission, dan partial failure?
```

---

## 33. Latihan

### Latihan 1 — Safe recursive delete

Buat utility:

```java
void deleteUnderBase(Path base, Path target, boolean dryRun)
```

Requirement:

- `target` harus berada di bawah `base` setelah `toRealPath`.
- Reject jika target sama dengan base.
- Tidak follow symlink.
- Dry-run hanya mencetak path yang akan dihapus.
- Return report jumlah file/dir yang akan/sudah dihapus.

### Latihan 2 — Recursive copy dengan staging

Buat:

```java
void copyTreeWithStaging(Path source, Path finalTarget)
```

Requirement:

- copy ke sibling staging directory;
- verify jumlah file dan total byte;
- atomic move staging ke final;
- jika gagal, staging tidak langsung dihapus agar bisa investigasi;
- ada cleanup function untuk staging lama.

### Latihan 3 — File ingestion folder

Desain folder:

```text
incoming/
ready/
processing/
processed/
failed/
quarantine/
```

Implementasikan:

- producer publish dengan temp + atomic move;
- worker claim dengan atomic move;
- process file;
- move ke processed/failed;
- recovery untuk file stuck di processing lebih dari N menit.

### Latihan 4 — Directory report

Buat report CSV:

```text
relative_path,type,size,last_modified
```

Requirement:

- skip `.git`, `node_modules`, `target`;
- handle inaccessible file dengan failure report;
- tidak menyimpan semua path di memory;
- output UTF-8.

---

## 34. Ringkasan

Directory traversal adalah operasi yang terlihat sederhana tetapi sebenarnya menyentuh banyak aspek engineering: filesystem semantics, resource lifecycle, lazy stream, symlink, permission, race condition, partial failure, atomicity, memory usage, dan security.

Mental model utama:

```text
Directory tree is not always a stable tree.
It can behave like a mutable graph with partial failure.
```

Gunakan API sesuai kebutuhan:

```text
Files.list       -> shallow stream
DirectoryStream  -> shallow iterable, good for huge dirs
Files.walk       -> recursive lazy stream
Files.find       -> recursive search with attributes
walkFileTree     -> robust recursive operation
```

Untuk operasi production:

```text
scan safely
copy to staging
verify
publish atomically
record failures
make retry idempotent
avoid following symlink by default
protect destructive operation with root guard
```

Part ini menjadi fondasi untuk part berikutnya, yaitu **Temporary File, Atomic File Write, File Replacement, dan Crash-Safe Persistence**. Di sana kita akan fokus pada bagaimana menulis file agar tidak menghasilkan data setengah jadi saat process crash, disk full, atau deployment berhenti di tengah operasi.

---

## 35. Referensi

- Oracle Java Documentation — `java.nio.file.Files`
- Oracle Java Documentation — `java.nio.file.Path`
- Oracle Java Documentation — `java.nio.file.DirectoryStream`
- Oracle Java Documentation — `java.nio.file.FileVisitor`
- Oracle Java Documentation — `java.nio.file.SimpleFileVisitor`
- Oracle Java Documentation — `java.nio.file.StandardCopyOption`
- Oracle Java Tutorials — Walking the File Tree

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 012 — File Attributes, Permissions, Ownership, Metadata, dan Cross-Platform Semantics](./learn-java-io-nio-networking-data-transfer-part-012.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 014 — Temporary File, Atomic File Write, File Replacement, dan Crash-Safe Persistence](./learn-java-io-nio-networking-data-transfer-part-014.md)
