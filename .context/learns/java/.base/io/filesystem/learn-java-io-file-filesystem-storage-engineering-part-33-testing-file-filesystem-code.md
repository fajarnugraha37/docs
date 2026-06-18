# learn-java-io-file-filesystem-storage-engineering — Part 33
# Testing File and Filesystem Code

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: 33 dari 35  
> Topik: Testing kode file dan filesystem secara production-grade  
> Target Java: 8 sampai 25  
> Fokus: correctness, portability, security, recovery, race condition, dan confidence terhadap workflow file nyata

---

## 1. Kenapa testing file/filesystem berbeda dari unit test biasa

Kode file terlihat sederhana:

```java
Files.write(path, data);
byte[] read = Files.readAllBytes(path);
```

Tetapi behavior production-nya bukan hanya ditentukan oleh kode Java. Behavior akhirnya ditentukan oleh gabungan:

```text
Java code
  -> java.nio.file API
  -> FileSystemProvider
  -> OS kernel
  -> filesystem implementation
  -> storage device / network storage / container volume
  -> concurrent process
  -> crash / restart / cleanup / deployment lifecycle
```

Karena itu testing file code tidak cukup dengan “method dipanggil, file muncul”. Test yang baik harus memvalidasi:

1. path handling benar,
2. operasi tidak keluar dari sandbox,
3. file handle ditutup,
4. error diperlakukan sebagai state yang diantisipasi,
5. cleanup tidak menghapus hal yang salah,
6. concurrent mutation tidak merusak invariants,
7. recovery setelah partial write masuk akal,
8. behavior tetap benar pada Linux, Windows, macOS, container, dan filesystem provider berbeda.

Mental model paling penting:

```text
File test bukan hanya test data.
File test adalah test kontrak antara program dan environment.
```

---

## 2. Target utama testing file code

Testing file code harus menjawab beberapa pertanyaan inti.

### 2.1 Apakah path yang dipakai benar?

Contoh risiko:

- relative path tergantung working directory,
- path traversal keluar root,
- symbolic link mengarah ke lokasi lain,
- filename berbeda behavior di OS berbeda,
- case sensitivity membuat test lolos di Linux tapi gagal di Windows/macOS.

### 2.2 Apakah operasi file benar secara atomic?

Contoh risiko:

- create didahului `exists`, lalu race,
- write langsung ke target, lalu crash meninggalkan file rusak,
- move lintas filesystem tidak atomic,
- rename digunakan untuk claim file tetapi tidak diuji saat ada banyak worker.

### 2.3 Apakah failure mode diuji?

Contoh failure nyata:

- `NoSuchFileException`,
- `FileAlreadyExistsException`,
- `AccessDeniedException`,
- `DirectoryNotEmptyException`,
- `FileSystemLoopException`,
- `AtomicMoveNotSupportedException`,
- disk full,
- path terlalu panjang,
- permission denied,
- file dihapus proses lain,
- file diganti symlink setelah validasi.

### 2.4 Apakah cleanup aman?

Cleanup yang buruk bisa lebih berbahaya dari bug utama.

Contoh anti-pattern:

```java
Files.walk(root)
     .sorted(Comparator.reverseOrder())
     .forEach(path -> path.toFile().delete());
```

Masalah:

- error delete diabaikan,
- symlink handling tidak eksplisit,
- root guard tidak ada,
- kalau `root` salah, bisa menghapus directory penting,
- `File.delete()` hanya boolean, error detail hilang.

### 2.5 Apakah test realistic tapi tetap deterministic?

Test file harus realistis, tetapi tidak boleh bergantung pada:

- urutan listing directory,
- timing event watcher,
- current working directory,
- file path absolut mesin developer,
- permission default user lokal,
- timezone atau locale,
- state `/tmp` global,
- leftover file dari test sebelumnya.

---

## 3. Test pyramid untuk filesystem code

File/filesystem testing sebaiknya tidak semuanya jadi integration test berat. Kita butuh layering.

```text
                         ┌────────────────────────────┐
                         │ Manual / chaos / OS matrix │
                         └─────────────▲──────────────┘
                                       │
                         ┌─────────────┴──────────────┐
                         │ Integration filesystem test │
                         └─────────────▲──────────────┘
                                       │
                         ┌─────────────┴──────────────┐
                         │ Provider behavior test      │
                         └─────────────▲──────────────┘
                                       │
                         ┌─────────────┴──────────────┐
                         │ Unit test with temp dirs    │
                         └─────────────▲──────────────┘
                                       │
                         ┌─────────────┴──────────────┐
                         │ Pure path/string logic test │
                         └────────────────────────────┘
```

### 3.1 Pure path/string logic test

Dipakai untuk:

- filename sanitizer,
- extension parser,
- path policy validator,
- metadata serializer,
- state transition pure function.

Idealnya logic ini tidak langsung menyentuh filesystem.

### 3.2 Unit test dengan temporary directory

Dipakai untuk:

- create/read/write/delete,
- temp file workflow,
- path containment,
- small workflow local filesystem.

### 3.3 Provider behavior test

Dipakai untuk:

- menguji kode terhadap provider berbeda,
- default filesystem vs in-memory filesystem,
- Windows-like vs Unix-like path behavior,
- custom provider constraints.

### 3.4 Integration filesystem test

Dipakai untuk:

- permission nyata,
- symlink nyata,
- atomic move nyata,
- file locking,
- watcher,
- large directory,
- crash/recovery.

### 3.5 OS matrix / chaos test

Dipakai untuk:

- Linux/Windows/macOS,
- container volume,
- mounted network filesystem,
- low disk,
- concurrent writer,
- kill process during write.

---

## 4. Golden principle: test against `Path`, not `String`

Kode modern harus menerima `Path`, bukan `String`, jika operasi yang dilakukan adalah operasi filesystem.

Buruk:

```java
public void importFile(String path) throws IOException {
    byte[] bytes = Files.readAllBytes(Paths.get(path));
}
```

Lebih baik:

```java
public void importFile(Path path) throws IOException {
    byte[] bytes = Files.readAllBytes(path);
}
```

Alasannya:

1. test bisa memakai temp directory,
2. test bisa memakai provider berbeda,
3. caller yang menentukan filesystem context,
4. kode tidak diam-diam mengasumsikan default filesystem,
5. mudah menguji relative/absolute/path provider behavior.

Untuk Java 8, gunakan:

```java
Path p = Paths.get("data", "input.txt");
```

Untuk Java 11+ sampai 25, gunakan:

```java
Path p = Path.of("data", "input.txt");
```

Tetapi library yang target Java 8 tetap harus memakai `Paths.get`.

---

## 5. Temporary directory per test

Temporary directory adalah fondasi utama testing file code.

Dengan JUnit 5:

```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class FileWriterTest {

    @TempDir
    Path tempDir;

    @Test
    void writesFileInsideTempDirectory() throws Exception {
        Path target = tempDir.resolve("result.txt");

        Files.writeString(target, "hello");

        assertEquals("hello", Files.readString(target));
    }
}
```

Untuk Java 8, `Files.writeString` dan `Files.readString` belum ada. Gunakan:

```java
Files.write(target, "hello".getBytes(StandardCharsets.UTF_8));
String text = new String(Files.readAllBytes(target), StandardCharsets.UTF_8);
```

### 5.1 Kenapa bukan `/tmp/my-test`?

Jangan pakai path global seperti:

```java
Path root = Paths.get("/tmp/my-test");
```

Masalah:

- tidak portable ke Windows,
- bisa tabrakan dengan test lain,
- leftover dari run sebelumnya,
- cleanup berisiko,
- parallel test bisa saling ganggu,
- permission di CI bisa berbeda.

### 5.2 Satu test satu root

Setiap test harus punya root sendiri.

```text
Test A -> /tmp/junit-123/a
Test B -> /tmp/junit-456/b
```

Bukan:

```text
Test A -> /tmp/app-test
Test B -> /tmp/app-test
```

### 5.3 Jangan assert path absolut

Buruk:

```java
assertEquals("/tmp/app/file.txt", actual.toString());
```

Lebih baik:

```java
assertEquals("file.txt", actual.getFileName().toString());
assertTrue(actual.startsWith(tempDir));
```

Path absolut berbeda antar OS dan CI.

---

## 6. Desain kode agar testable

Kode file yang sulit dites biasanya punya masalah desain.

### 6.1 Jangan hard-code root directory

Buruk:

```java
class ReportExporter {
    void export(String report) throws IOException {
        Path out = Paths.get("/var/app/reports/report.txt");
        Files.write(out, report.getBytes(StandardCharsets.UTF_8));
    }
}
```

Lebih baik:

```java
class ReportExporter {
    private final Path reportRoot;

    ReportExporter(Path reportRoot) {
        this.reportRoot = reportRoot;
    }

    void export(String reportId, String report) throws IOException {
        Path out = reportRoot.resolve(reportId + ".txt");
        Files.write(out, report.getBytes(StandardCharsets.UTF_8));
    }
}
```

Test:

```java
@Test
void exportsReportToConfiguredRoot(@TempDir Path tempDir) throws Exception {
    ReportExporter exporter = new ReportExporter(tempDir);

    exporter.export("r1", "hello");

    assertEquals(
        "hello",
        new String(Files.readAllBytes(tempDir.resolve("r1.txt")), StandardCharsets.UTF_8)
    );
}
```

### 6.2 Pisahkan policy dan effect

Buruk:

```java
void saveUpload(String originalName, byte[] content) throws IOException {
    String safe = originalName.replace("..", "");
    Files.write(Paths.get("uploads", safe), content);
}
```

Lebih baik:

```java
final class UploadNamePolicy {
    String storageName(String originalName) {
        if (originalName == null || originalName.isBlank()) {
            throw new IllegalArgumentException("filename is required");
        }
        return UUID.randomUUID() + ".bin";
    }
}

final class UploadStore {
    private final Path root;
    private final UploadNamePolicy namePolicy;

    UploadStore(Path root, UploadNamePolicy namePolicy) {
        this.root = root;
        this.namePolicy = namePolicy;
    }

    Path save(String originalName, byte[] content) throws IOException {
        String storageName = namePolicy.storageName(originalName);
        Path target = root.resolve(storageName);
        Files.write(target, content, StandardOpenOption.CREATE_NEW);
        return target;
    }
}
```

Keuntungan:

- name policy bisa dites tanpa filesystem,
- filesystem operation bisa dites dengan temp dir,
- security rule lebih eksplisit,
- failure mode lebih jelas.

---

## 7. Testing path containment

Path containment adalah test wajib untuk semua fitur yang menerima path/filename dari user.

Misalnya kita punya policy:

```java
final class SafePathResolver {
    private final Path root;

    SafePathResolver(Path root) throws IOException {
        this.root = root.toRealPath();
    }

    Path resolveUserPath(String userInput) throws IOException {
        Path candidate = root.resolve(userInput).normalize();
        Path parent = candidate.getParent();

        if (parent == null || !parent.normalize().startsWith(root)) {
            throw new SecurityException("path escapes root");
        }

        return candidate;
    }
}
```

Test minimal:

```java
@Test
void rejectsParentTraversal(@TempDir Path tempDir) throws Exception {
    SafePathResolver resolver = new SafePathResolver(tempDir);

    assertThrows(SecurityException.class, () -> {
        resolver.resolveUserPath("../outside.txt");
    });
}

@Test
void acceptsNormalRelativePath(@TempDir Path tempDir) throws Exception {
    SafePathResolver resolver = new SafePathResolver(tempDir);

    Path p = resolver.resolveUserPath("a/b/file.txt");

    assertTrue(p.normalize().startsWith(tempDir.toRealPath()));
}
```

Tetapi test seperti ini belum cukup.

Tambahkan case:

```text
../x
..\x
./a/../b.txt
/a/b/c              on Unix-like systems
C:\Windows\x       on Windows
empty string
single dot
hidden file
unicode name
very long name
name with trailing space
name with reserved characters
```

### 7.1 Jangan menganggap separator hanya `/`

Test sanitizer harus memasukkan `/` dan `\`.

```java
@ParameterizedTest
@ValueSource(strings = {
    "../secret.txt",
    "..\\secret.txt",
    "a/../../secret.txt",
    "a\\..\\..\\secret.txt"
})
void rejectsTraversalVariants(String input, @TempDir Path tempDir) throws Exception {
    SafePathResolver resolver = new SafePathResolver(tempDir);
    assertThrows(SecurityException.class, () -> resolver.resolveUserPath(input));
}
```

Namun hati-hati: di Unix, backslash bukan separator path default. Ia karakter biasa dalam filename. Karena itu untuk security upload/archive yang menerima input lintas platform, kita sering perlu policy string-level yang melarang kedua separator, bukan hanya mengandalkan `Path.normalize`.

---

## 8. Testing symlink behavior

Symlink adalah sumber bug besar karena path yang terlihat berada di dalam root bisa menunjuk keluar root.

Contoh test:

```java
@Test
void symlinkCanPointOutsideRoot(@TempDir Path tempDir) throws Exception {
    Path root = tempDir.resolve("root");
    Path outside = tempDir.resolve("outside");
    Files.createDirectories(root);
    Files.createDirectories(outside);

    Path outsideFile = outside.resolve("secret.txt");
    Files.write(outsideFile, "secret".getBytes(StandardCharsets.UTF_8));

    Path link = root.resolve("link-to-outside");

    try {
        Files.createSymbolicLink(link, outside);
    } catch (UnsupportedOperationException | IOException | SecurityException e) {
        // Some OS/CI environments do not permit symlink creation.
        // In real JUnit, use Assumptions.assumeTrue(false, ...).
        return;
    }

    Path viaLink = link.resolve("secret.txt");

    assertTrue(Files.exists(viaLink));
    assertEquals("secret", new String(Files.readAllBytes(viaLink), StandardCharsets.UTF_8));
}
```

Di JUnit, lebih baik skip test jika symlink tidak didukung:

```java
import static org.junit.jupiter.api.Assumptions.assumeTrue;

@Test
void testSymlinkIfSupported(@TempDir Path tempDir) throws Exception {
    Path target = tempDir.resolve("target");
    Files.createDirectory(target);

    Path link = tempDir.resolve("link");
    boolean symlinkCreated;

    try {
        Files.createSymbolicLink(link, target);
        symlinkCreated = true;
    } catch (UnsupportedOperationException | IOException | SecurityException e) {
        symlinkCreated = false;
    }

    assumeTrue(symlinkCreated, "symlink not supported or not permitted here");

    assertTrue(Files.isSymbolicLink(link));
}
```

### 8.1 Test `NOFOLLOW_LINKS`

Untuk operasi security-sensitive, test harus memastikan link tidak diikuti secara tidak sengaja.

```java
@Test
void noFollowLinksDetectsLinkItself(@TempDir Path tempDir) throws Exception {
    Path target = tempDir.resolve("target.txt");
    Files.write(target, "data".getBytes(StandardCharsets.UTF_8));

    Path link = tempDir.resolve("link.txt");

    try {
        Files.createSymbolicLink(link, target.getFileName());
    } catch (UnsupportedOperationException | IOException | SecurityException e) {
        return;
    }

    assertTrue(Files.isSymbolicLink(link));
    assertTrue(Files.isRegularFile(link)); // follows by default
    assertFalse(Files.isRegularFile(link, LinkOption.NOFOLLOW_LINKS));
}
```

Pelajaran:

```text
Default banyak operasi mengikuti link.
Kalau policy security butuh link itu sendiri, gunakan NOFOLLOW_LINKS secara eksplisit.
```

---

## 9. Testing recursive traversal dan cleanup

Recursive operation harus diuji dengan tree yang punya struktur nyata.

```text
root/
  a.txt
  dir1/
    b.txt
    dir2/
      c.txt
  empty-dir/
```

Contoh helper test tree:

```java
static void createTree(Path root) throws IOException {
    Files.createDirectories(root.resolve("dir1/dir2"));
    Files.createDirectories(root.resolve("empty-dir"));
    Files.write(root.resolve("a.txt"), new byte[] {1});
    Files.write(root.resolve("dir1/b.txt"), new byte[] {2});
    Files.write(root.resolve("dir1/dir2/c.txt"), new byte[] {3});
}
```

Test recursive collect:

```java
@Test
void walksAllRegularFiles(@TempDir Path tempDir) throws Exception {
    createTree(tempDir);

    List<String> names;
    try (Stream<Path> stream = Files.walk(tempDir)) {
        names = stream
            .filter(Files::isRegularFile)
            .map(tempDir::relativize)
            .map(Path::toString)
            .sorted()
            .collect(Collectors.toList());
    }

    assertEquals(List.of(
        "a.txt",
        "dir1" + File.separator + "b.txt",
        "dir1" + File.separator + "dir2" + File.separator + "c.txt"
    ), names);
}
```

Untuk Java 8, `List.of` belum ada:

```java
assertEquals(Arrays.asList("a.txt", "dir1/b.txt"), names);
```

Tetapi jangan hard-code separator jika test harus cross-platform. Lebih baik assert memakai `Path` relatif:

```java
Set<Path> actual;
try (Stream<Path> stream = Files.walk(tempDir)) {
    actual = stream
        .filter(Files::isRegularFile)
        .map(tempDir::relativize)
        .collect(Collectors.toSet());
}

assertEquals(new HashSet<>(Arrays.asList(
    Paths.get("a.txt"),
    Paths.get("dir1", "b.txt"),
    Paths.get("dir1", "dir2", "c.txt")
)), actual);
```

### 9.1 Jangan bergantung pada ordering directory

Buruk:

```java
List<Path> files = Files.list(root).collect(Collectors.toList());
assertEquals("a.txt", files.get(0).getFileName().toString());
```

Directory listing tidak boleh diasumsikan sorted.

Benar:

```java
List<String> names;
try (Stream<Path> s = Files.list(root)) {
    names = s.map(p -> p.getFileName().toString())
             .sorted()
             .collect(Collectors.toList());
}
```

---

## 10. Testing resource lifecycle: stream harus ditutup

Banyak bug file muncul karena stream tidak ditutup.

Contoh buruk:

```java
Stream<String> lines = Files.lines(path);
return lines.count(); // stream tidak ditutup eksplisit jika exception terjadi di caller
```

Test leak sulit dilakukan portable. Tetapi kita bisa desain API supaya tidak mengembalikan stream yang masih memegang file handle tanpa kontrak jelas.

Lebih aman:

```java
long countLines(Path path) throws IOException {
    try (Stream<String> lines = Files.lines(path, StandardCharsets.UTF_8)) {
        return lines.count();
    }
}
```

Test behavior:

```java
@Test
void canDeleteAfterCountingLines(@TempDir Path tempDir) throws Exception {
    Path file = tempDir.resolve("data.txt");
    Files.write(file, Arrays.asList("a", "b", "c"), StandardCharsets.UTF_8);

    long count = countLines(file);

    assertEquals(3, count);
    Files.delete(file);
    assertFalse(Files.exists(file));
}
```

Kenapa test delete berguna?

- Di Windows, open handle sering mencegah delete.
- Di Unix, delete open file mungkin tetap berhasil, jadi test ini tidak selalu mendeteksi leak di semua OS.
- Namun tetap berguna sebagai cross-platform smoke test.

Untuk leak testing lebih kuat, gunakan:

- static analysis,
- Error Prone/SpotBugs,
- code review rule,
- integration test di Windows,
- stress test handle count.

---

## 11. Testing permission failure

Permission test penting, tetapi sulit cross-platform.

Contoh POSIX-only:

```java
@Test
void failsWhenDirectoryNotWritable(@TempDir Path tempDir) throws Exception {
    Set<PosixFilePermission> noWrite = PosixFilePermissions.fromString("r-xr-xr-x");

    try {
        Files.setPosixFilePermissions(tempDir, noWrite);
    } catch (UnsupportedOperationException e) {
        return; // not POSIX filesystem
    }

    Path target = tempDir.resolve("x.txt");

    try {
        assertThrows(IOException.class, () -> Files.write(target, new byte[] {1}));
    } finally {
        Files.setPosixFilePermissions(tempDir, PosixFilePermissions.fromString("rwxrwxrwx"));
    }
}
```

Masalah:

- test bisa gagal jika dijalankan sebagai root,
- Windows tidak support POSIX permission normal,
- container permission bisa berbeda,
- CI runner bisa punya ACL khusus.

Lebih baik:

```java
boolean supportsPosix(Path path) throws IOException {
    return Files.getFileStore(path).supportsFileAttributeView(PosixFileAttributeView.class);
}
```

Lalu gunakan assumption:

```java
assumeTrue(supportsPosix(tempDir));
```

### 11.1 Test permission via fake policy jika tujuannya business behavior

Jika yang ingin diuji adalah “ketika storage gagal, service mengembalikan status FAILED”, jangan harus memaksa OS permission.

Gunakan abstraction:

```java
interface BlobWriter {
    void write(Path path, byte[] content) throws IOException;
}
```

Fake failing writer:

```java
class FailingBlobWriter implements BlobWriter {
    public void write(Path path, byte[] content) throws IOException {
        throw new AccessDeniedException(path.toString());
    }
}
```

Test business behavior:

```java
@Test
void marksUploadFailedWhenStorageDenied() {
    UploadService service = new UploadService(new FailingBlobWriter());

    UploadResult result = service.upload("a.txt", new byte[] {1});

    assertEquals(UploadStatus.FAILED_STORAGE_DENIED, result.status());
}
```

Kesimpulan:

```text
OS permission test dipakai untuk memvalidasi integration assumption.
Business failure behavior sebaiknya diuji dengan injectable failure.
```

---

## 12. Testing atomic create dan race condition

Kode yang benar biasanya tidak melakukan:

```java
if (!Files.exists(path)) {
    Files.createFile(path);
}
```

Test race untuk menunjukkan behavior:

```java
@Test
void onlyOneThreadCanCreateNewFile(@TempDir Path tempDir) throws Exception {
    Path target = tempDir.resolve("once.txt");
    int workers = 16;

    ExecutorService pool = Executors.newFixedThreadPool(workers);
    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger success = new AtomicInteger();
    AtomicInteger alreadyExists = new AtomicInteger();

    List<Future<?>> futures = new ArrayList<>();

    for (int i = 0; i < workers; i++) {
        futures.add(pool.submit(() -> {
            start.await();
            try {
                Files.createFile(target);
                success.incrementAndGet();
            } catch (FileAlreadyExistsException e) {
                alreadyExists.incrementAndGet();
            }
            return null;
        }));
    }

    start.countDown();
    for (Future<?> f : futures) {
        f.get();
    }
    pool.shutdown();

    assertEquals(1, success.get());
    assertEquals(workers - 1, alreadyExists.get());
}
```

Tujuan test:

- bukan membuktikan OS selalu sempurna,
- tetapi membuktikan kode memakai atomic create operation,
- dan failure `FileAlreadyExistsException` diperlakukan sebagai expected outcome.

---

## 13. Testing claim-by-rename workflow

Untuk file intake multi-worker, pola umum:

```text
incoming/file1.dat
  -> processing/file1.dat.worker-123
  -> done/file1.dat
  atau error/file1.dat
```

Claim dilakukan dengan move/rename. Test penting:

```java
@Test
void onlyOneWorkerCanClaimFile(@TempDir Path tempDir) throws Exception {
    Path incoming = tempDir.resolve("incoming");
    Path processing = tempDir.resolve("processing");
    Files.createDirectories(incoming);
    Files.createDirectories(processing);

    Path source = incoming.resolve("job.dat");
    Files.write(source, new byte[] {1, 2, 3});

    int workers = 8;
    ExecutorService pool = Executors.newFixedThreadPool(workers);
    CountDownLatch start = new CountDownLatch(1);
    AtomicInteger claimed = new AtomicInteger();

    List<Future<?>> futures = new ArrayList<>();
    for (int i = 0; i < workers; i++) {
        final int workerId = i;
        futures.add(pool.submit(() -> {
            start.await();
            Path target = processing.resolve("job.dat.w" + workerId);
            try {
                Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
                claimed.incrementAndGet();
            } catch (NoSuchFileException e) {
                // Another worker claimed first.
            } catch (AtomicMoveNotSupportedException e) {
                // In production, fallback/policy depends on filesystem.
                throw e;
            }
            return null;
        }));
    }

    start.countDown();
    for (Future<?> f : futures) {
        f.get();
    }
    pool.shutdown();

    assertEquals(1, claimed.get());
}
```

Test ini mengunci invariant:

```text
Satu input file hanya boleh diproses oleh satu worker.
```

Catatan:

- `ATOMIC_MOVE` bisa tidak didukung di semua provider/skenario.
- Di test unit local filesystem biasanya didukung untuk same directory/same filesystem.
- Untuk network filesystem, behavior harus diuji di environment yang sesuai.

---

## 14. Testing atomic update pattern

Atomic update pattern:

```text
write temp file in same directory
force file content
move temp -> target with ATOMIC_MOVE + REPLACE_EXISTING
```

Test happy path:

```java
static void atomicWrite(Path target, byte[] content) throws IOException {
    Path dir = target.getParent();
    Path temp = Files.createTempFile(dir, target.getFileName().toString(), ".tmp");

    try {
        try (FileChannel ch = FileChannel.open(temp, StandardOpenOption.WRITE)) {
            ch.write(ByteBuffer.wrap(content));
            ch.force(true);
        }

        Files.move(temp, target,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
    } catch (IOException | RuntimeException e) {
        try {
            Files.deleteIfExists(temp);
        } catch (IOException suppressed) {
            e.addSuppressed(suppressed);
        }
        throw e;
    }
}

@Test
void atomicWriteReplacesTarget(@TempDir Path tempDir) throws Exception {
    Path target = tempDir.resolve("config.json");
    Files.write(target, "old".getBytes(StandardCharsets.UTF_8));

    atomicWrite(target, "new".getBytes(StandardCharsets.UTF_8));

    assertEquals("new", new String(Files.readAllBytes(target), StandardCharsets.UTF_8));
}
```

### 14.1 Test cleanup saat gagal sebelum move

Supaya bisa inject failure, jangan hard-code semua static call dalam satu method besar. Buat seam.

```java
interface MoveOperation {
    void move(Path source, Path target) throws IOException;
}
```

Test:

```java
@Test
void cleansTempWhenMoveFails(@TempDir Path tempDir) throws Exception {
    Path target = tempDir.resolve("data.txt");

    MoveOperation failingMove = (source, dest) -> {
        throw new IOException("simulated move failure");
    };

    AtomicFileWriter writer = new AtomicFileWriter(failingMove);

    assertThrows(IOException.class, () -> {
        writer.write(target, "hello".getBytes(StandardCharsets.UTF_8));
    });

    try (Stream<Path> files = Files.list(tempDir)) {
        List<Path> leftovers = files
            .filter(p -> p.getFileName().toString().contains(".tmp"))
            .collect(Collectors.toList());
        assertTrue(leftovers.isEmpty(), "temp files should be cleaned");
    }
}
```

Tujuan:

- bukan hanya output benar,
- tetapi failure tidak meninggalkan state liar.

---

## 15. Testing crash recovery

Crash recovery tidak bisa sepenuhnya dibuktikan dengan unit test biasa. Tetapi kita bisa membuat desain testable.

Misalnya format workflow:

```text
root/
  staging/
  ready/
  processing/
  done/
  error/
```

Recovery rule:

```text
1. file di staging lebih tua dari threshold -> hapus atau retry upload
2. file di processing tanpa heartbeat -> kembalikan ke ready
3. file di done -> jangan proses ulang
4. file di error -> butuh manual action atau retry policy
```

Test recovery:

```java
@Test
void recoveryReturnsAbandonedProcessingFileToReady(@TempDir Path root) throws Exception {
    Path ready = root.resolve("ready");
    Path processing = root.resolve("processing");
    Files.createDirectories(ready);
    Files.createDirectories(processing);

    Path abandoned = processing.resolve("job-1.dat");
    Files.write(abandoned, new byte[] {1});

    FileTime oldTime = FileTime.from(Instant.now().minus(Duration.ofHours(2)));
    Files.setLastModifiedTime(abandoned, oldTime);

    FileWorkflowRecovery recovery = new FileWorkflowRecovery(root, Duration.ofMinutes(30));
    recovery.recover();

    assertTrue(Files.exists(ready.resolve("job-1.dat")));
    assertFalse(Files.exists(abandoned));
}
```

### 15.1 Jangan bergantung pada wall-clock langsung

Buruk:

```java
Instant now = Instant.now();
```

Lebih testable:

```java
class FileWorkflowRecovery {
    private final Clock clock;

    FileWorkflowRecovery(Path root, Duration timeout, Clock clock) {
        this.root = root;
        this.timeout = timeout;
        this.clock = clock;
    }
}
```

Test:

```java
Clock fixed = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);
```

File code sering gagal bukan karena `Files` API, tetapi karena time, ordering, dan retry policy tidak deterministic.

---

## 16. Testing partial write dan corrupt file

Jika file format punya header/body/checksum, test harus menguji corrupt state.

Contoh format:

```text
MAGIC(4) VERSION(1) LENGTH(4) PAYLOAD(N) CRC32(4)
```

Test partial file:

```java
@Test
void rejectsTruncatedFile(@TempDir Path tempDir) throws Exception {
    Path file = tempDir.resolve("record.bin");

    Files.write(file, new byte[] {
        'D', 'A', 'T', 'A',
        1,
        0, 0, 0, 10,
        1, 2 // payload truncated
    });

    RecordFileReader reader = new RecordFileReader();

    assertThrows(CorruptFileException.class, () -> reader.read(file));
}
```

Test checksum mismatch:

```java
@Test
void rejectsChecksumMismatch(@TempDir Path tempDir) throws Exception {
    Path file = tempDir.resolve("record.bin");

    byte[] valid = RecordFileWriter.encode("hello".getBytes(StandardCharsets.UTF_8));
    valid[valid.length - 1] ^= 0x01; // corrupt checksum byte

    Files.write(file, valid);

    assertThrows(CorruptFileException.class, () -> new RecordFileReader().read(file));
}
```

Testing corrupt file wajib untuk:

- WAL,
- append-only log,
- cache file,
- manifest,
- archive import,
- upload intake,
- report bundle,
- file-backed queue.

---

## 17. Testing large file behavior tanpa membuat file raksasa

Kadang kita perlu test kode yang memproses file besar. Jangan selalu membuat file 10 GB di CI.

Strategi:

### 17.1 Gunakan sparse file jika supported

```java
try (FileChannel ch = FileChannel.open(file,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE,
        StandardOpenOption.SPARSE)) {
    ch.position(1024L * 1024L * 1024L); // 1 GiB
    ch.write(ByteBuffer.wrap(new byte[] {1}));
}
```

Catatan:

- support sparse file bergantung filesystem,
- apparent size bisa besar, actual disk block kecil,
- jangan jadikan ini satu-satunya test portable.

### 17.2 Gunakan fake stream untuk pure streaming logic

Jika logic hanya butuh membaca banyak byte, gunakan `InputStream` abstraction:

```java
class RepeatingInputStream extends InputStream {
    private long remaining;

    RepeatingInputStream(long size) {
        this.remaining = size;
    }

    @Override
    public int read() {
        if (remaining <= 0) return -1;
        remaining--;
        return 'x';
    }
}
```

Test:

```java
@Test
void rejectsInputLargerThanLimit() {
    InputStream huge = new RepeatingInputStream(10L * 1024 * 1024 * 1024);

    assertThrows(FileTooLargeException.class, () -> {
        validator.validate(huge, 100 * 1024 * 1024);
    });
}
```

Pelajaran:

```text
Test filesystem integration seperlunya.
Test streaming algorithm dengan abstraction supaya cepat dan deterministic.
```

---

## 18. Testing directory scale

Banyak bug muncul saat directory berisi ribuan atau jutaan file.

Unit test tidak perlu jutaan file, tetapi bisa menguji pola:

```java
@Test
void processesManyFilesWithoutAssumingOrder(@TempDir Path tempDir) throws Exception {
    Path inbox = tempDir.resolve("inbox");
    Files.createDirectory(inbox);

    for (int i = 0; i < 10_000; i++) {
        Files.write(inbox.resolve("file-" + i + ".dat"), new byte[] {1});
    }

    FileBatchScanner scanner = new FileBatchScanner();
    List<Path> batch = scanner.nextBatch(inbox, 100);

    assertEquals(100, batch.size());
    assertEquals(100, new HashSet<>(batch).size());
}
```

Hal yang diuji:

- scanner punya limit batch,
- tidak load semua file jika tidak perlu,
- tidak bergantung pada order,
- tidak menghabiskan memory.

### 18.1 Test backpressure

```java
@Test
void stopsScanningAfterBatchLimit(@TempDir Path tempDir) throws Exception {
    Path inbox = tempDir.resolve("inbox");
    Files.createDirectory(inbox);

    for (int i = 0; i < 1000; i++) {
        Files.write(inbox.resolve("f" + i), new byte[] {1});
    }

    FileBatchScanner scanner = new FileBatchScanner();

    List<Path> batch = scanner.nextBatch(inbox, 10);

    assertEquals(10, batch.size());
}
```

Batch limit adalah invariant produksi, bukan detail performa kecil.

---

## 19. Testing WatchService

`WatchService` test sering flaky karena event delivery platform-specific dan asynchronous.

Jangan test seperti ini:

```java
Files.write(file, data);
assertEquals(ENTRY_CREATE, watcher.take().pollEvents().get(0).kind());
```

Masalah:

- event bisa coalesced,
- event bisa `ENTRY_MODIFY`,
- timing berbeda,
- event bisa datang lebih dari satu,
- overflow mungkin terjadi,
- macOS/Windows/Linux beda detail.

### 19.1 Test watcher sebagai hint

Desain watcher service:

```text
watch event -> mark directory dirty -> reconciliation scan
```

Test unit cukup memastikan event memicu reconciliation, bukan exact event sequence.

```java
@Test
void fileCreationEventuallyDetected(@TempDir Path tempDir) throws Exception {
    WatchedDirectoryIndex index = new WatchedDirectoryIndex(tempDir);
    index.start();

    try {
        Files.write(tempDir.resolve("a.txt"), new byte[] {1});

        await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
            assertTrue(index.snapshot().contains("a.txt"));
        });
    } finally {
        index.stop();
    }
}
```

Jika tidak memakai Awaitility, buat polling sederhana:

```java
static void eventually(Duration timeout, ThrowingRunnable assertion) throws Exception {
    long deadline = System.nanoTime() + timeout.toNanos();
    AssertionError last = null;

    while (System.nanoTime() < deadline) {
        try {
            assertion.run();
            return;
        } catch (AssertionError e) {
            last = e;
            Thread.sleep(50);
        }
    }

    if (last != null) throw last;
}
```

### 19.2 Jangan buat watcher test sebagai satu-satunya bukti correctness

Watcher test harus didampingi test reconciliation:

```java
@Test
void reconciliationFindsExistingFilesEvenWithoutEvents(@TempDir Path tempDir) throws Exception {
    Files.write(tempDir.resolve("missed.txt"), new byte[] {1});

    DirectoryReconciler reconciler = new DirectoryReconciler(tempDir);
    Set<String> found = reconciler.scan();

    assertTrue(found.contains("missed.txt"));
}
```

Invariant:

```text
Jika event hilang, reconciliation tetap memperbaiki state.
```

---

## 20. Testing file lock

File locking test harus hati-hati karena behavior OS berbeda.

### 20.1 Same-JVM overlapping lock

Java mendeteksi overlapping lock dalam JVM yang sama.

```java
@Test
void overlappingLockInSameJvmFails(@TempDir Path tempDir) throws Exception {
    Path file = tempDir.resolve("lock.dat");
    Files.write(file, new byte[] {1});

    try (FileChannel ch1 = FileChannel.open(file, StandardOpenOption.WRITE);
         FileChannel ch2 = FileChannel.open(file, StandardOpenOption.WRITE);
         FileLock lock = ch1.lock()) {

        assertThrows(OverlappingFileLockException.class, () -> ch2.tryLock());
    }
}
```

### 20.2 Cross-process lock

Cross-process lock lebih realistis, tetapi lebih mahal. Bisa dibuat dengan helper Java process.

Pattern:

```text
test process:
  start child process that locks file
  wait until child says LOCKED
  attempt lock from parent
  assert lock unavailable / blocks / fails sesuai expected behavior
  stop child
```

Gunakan integration test profile, bukan unit test default.

---

## 21. Testing in-memory filesystem

In-memory filesystem seperti Jimfs berguna untuk:

- testing provider-independent code,
- testing Unix-like vs Windows-like path behavior,
- test cepat tanpa menyentuh disk,
- memaksa kode tidak bergantung pada `java.io.File`.

Contoh konseptual:

```java
FileSystem fs = Jimfs.newFileSystem(Configuration.unix());
Path root = fs.getPath("/work");
Files.createDirectory(root);

Path file = root.resolve("a.txt");
Files.write(file, "hello".getBytes(StandardCharsets.UTF_8));

assertTrue(Files.exists(file));
```

### 21.1 Gunakan Jimfs untuk menemukan asumsi default filesystem

Jika kode memanggil:

```java
path.toFile()
```

Path dari non-default provider dapat gagal.

Test:

```java
@Test
void codeShouldNotRequireJavaIoFile() throws Exception {
    FileSystem fs = Jimfs.newFileSystem(Configuration.unix());
    Path file = fs.getPath("/data.txt");
    Files.write(file, new byte[] {1});

    MyPathBasedService service = new MyPathBasedService();

    assertDoesNotThrow(() -> service.process(file));
}
```

Kalau service diam-diam memakai `toFile()`, test ini bisa membuka masalah desain.

### 21.2 Jangan mengganti semua test dengan in-memory filesystem

Jimfs bukan kernel filesystem nyata. Ia tidak sempurna untuk menguji:

- actual OS permission,
- native file locking,
- watcher behavior produksi,
- disk full,
- fsync durability,
- network filesystem latency,
- platform-specific delete/rename semantics.

Gunakan Jimfs sebagai complement, bukan pengganti integration test.

---

## 22. Testing Java 8 sampai 25 compatibility

Karena seri ini menargetkan Java 8 hingga 25, test harus memperhatikan API availability.

### 22.1 API yang tidak ada di Java 8

Contoh API yang tidak bisa dipakai jika source target Java 8:

```text
Path.of
Files.readString
Files.writeString
InputStream.readAllBytes
List.of
Set.of
var
```

Alternatif Java 8:

```java
Path p = Paths.get("a", "b.txt");

String text = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);

Files.write(p, text.getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW);

List<String> xs = Arrays.asList("a", "b");
```

### 22.2 Multi-release awareness

Jika library ingin support Java 8 tetapi aplikasi runtime bisa Java 21/25, opsi:

1. source code tetap Java 8 compatible,
2. test matrix menjalankan unit test di Java 8, 11, 17, 21, 25,
3. hindari API baru di main source,
4. gunakan build profile jika perlu fitur baru.

### 22.3 CI matrix minimal

```text
JDK 8  + Linux
JDK 11 + Linux
JDK 17 + Linux
JDK 21 + Linux
JDK 25 + Linux
JDK 21/25 + Windows
JDK 21/25 + macOS
```

Untuk library filesystem yang serius, Windows dan macOS bukan optional karena path behavior berbeda signifikan.

---

## 23. Testing filename portability

Test filename policy harus eksplisit.

Contoh policy:

```java
final class SafeFileName {
    static String validate(String name) {
        if (name == null || name.isEmpty()) throw new IllegalArgumentException();
        if (name.equals(".") || name.equals("..")) throw new IllegalArgumentException();
        if (name.contains("/") || name.contains("\\")) throw new IllegalArgumentException();
        if (name.indexOf('\0') >= 0) throw new IllegalArgumentException();
        return name;
    }
}
```

Parameterized test:

```java
@ParameterizedTest
@ValueSource(strings = {
    "a.txt",
    "report-2026.csv",
    "hello_world.dat"
})
void acceptsSafeNames(String name) {
    assertEquals(name, SafeFileName.validate(name));
}

@ParameterizedTest
@ValueSource(strings = {
    "",
    ".",
    "..",
    "../a.txt",
    "..\\a.txt",
    "a/b.txt",
    "a\\b.txt",
    "bad\u0000name"
})
void rejectsUnsafeNames(String name) {
    assertThrows(IllegalArgumentException.class, () -> SafeFileName.validate(name));
}
```

Tambahkan Windows reserved names jika aplikasi menerima upload dari user:

```text
CON
PRN
AUX
NUL
COM1
LPT1
```

Tambahkan case-insensitive collision test jika target storage bisa Windows/macOS:

```java
@Test
void detectsCaseInsensitiveCollision() {
    Set<String> normalized = new HashSet<>();

    assertTrue(normalized.add("report.txt".toLowerCase(Locale.ROOT)));
    assertFalse(normalized.add("REPORT.TXT".toLowerCase(Locale.ROOT)));
}
```

---

## 24. Testing archive extraction safely

Archive extraction harus diuji terhadap Zip Slip.

Contoh helper validation:

```java
static Path safeZipEntryTarget(Path outputRoot, String entryName) throws IOException {
    Path root = outputRoot.toRealPath();
    Path target = root.resolve(entryName).normalize();

    if (!target.startsWith(root)) {
        throw new SecurityException("zip entry escapes output root: " + entryName);
    }

    return target;
}
```

Test:

```java
@Test
void rejectsZipSlipEntry(@TempDir Path tempDir) throws Exception {
    assertThrows(SecurityException.class, () -> {
        safeZipEntryTarget(tempDir, "../../evil.txt");
    });
}

@Test
void acceptsNormalZipEntry(@TempDir Path tempDir) throws Exception {
    Path target = safeZipEntryTarget(tempDir, "docs/readme.txt");

    assertTrue(target.startsWith(tempDir.toRealPath()));
}
```

Tambahkan test untuk:

```text
/absolute/path
C:\absolute\windows\path
..\windows\traversal.txt
nested/../../../evil
empty entry name
directory entry
large uncompressed size
too many entries
duplicate entries
```

---

## 25. Testing observability

File workflow production harus bisa didiagnosis. Observability juga perlu test.

### 25.1 Test structured event emitted

Misal service menulis audit event:

```java
record FileEvent(
    String operation,
    String pathHash,
    long bytes,
    String outcome,
    String exceptionClass
) {}
```

Test:

```java
@Test
void emitsFailureEventWhenWriteFails() throws Exception {
    InMemoryFileEventSink sink = new InMemoryFileEventSink();
    BlobWriter writer = (path, bytes) -> {
        throw new NoSuchFileException(path.toString());
    };

    FileStorageService service = new FileStorageService(writer, sink);

    assertThrows(IOException.class, () -> service.store(Paths.get("missing/x"), new byte[] {1}));

    FileEvent event = sink.events().get(0);
    assertEquals("write", event.operation());
    assertEquals("failure", event.outcome());
    assertEquals("NoSuchFileException", event.exceptionClass());
}
```

Jangan log full sensitive path/user filename jika berpotensi PII. Test bisa memastikan path di-hash atau di-redact.

---

## 26. Testing cleanup safety

Recursive cleanup harus punya guard.

Contoh:

```java
final class SafeCleaner {
    void deleteTree(Path root, Path allowedBase) throws IOException {
        Path realRoot = root.toRealPath(LinkOption.NOFOLLOW_LINKS);
        Path realBase = allowedBase.toRealPath(LinkOption.NOFOLLOW_LINKS);

        if (!realRoot.startsWith(realBase)) {
            throw new SecurityException("refusing to delete outside allowed base");
        }

        if (realRoot.equals(realBase)) {
            throw new SecurityException("refusing to delete allowed base itself");
        }

        // delete recursively using FileVisitor
    }
}
```

Test:

```java
@Test
void refusesToDeleteBaseItself(@TempDir Path tempDir) throws Exception {
    SafeCleaner cleaner = new SafeCleaner();

    assertThrows(SecurityException.class, () -> {
        cleaner.deleteTree(tempDir, tempDir);
    });
}

@Test
void refusesToDeleteOutsideBase(@TempDir Path tempDir) throws Exception {
    Path base = tempDir.resolve("base");
    Path outside = tempDir.resolve("outside");
    Files.createDirectories(base);
    Files.createDirectories(outside);

    SafeCleaner cleaner = new SafeCleaner();

    assertThrows(SecurityException.class, () -> {
        cleaner.deleteTree(outside, base);
    });
}
```

Cleanup test sangat penting karena bug cleanup sering catastrophic.

---

## 27. Testing failure injection tanpa mocking static `Files` berlebihan

Mocking static `Files` sering membuat test rapuh dan tidak realistis. Lebih baik buat abstraction tipis pada boundary.

```java
interface FileOps {
    void write(Path path, byte[] bytes, OpenOption... options) throws IOException;
    void move(Path source, Path target, CopyOption... options) throws IOException;
    boolean exists(Path path, LinkOption... options);
}

class JdkFileOps implements FileOps {
    public void write(Path path, byte[] bytes, OpenOption... options) throws IOException {
        Files.write(path, bytes, options);
    }

    public void move(Path source, Path target, CopyOption... options) throws IOException {
        Files.move(source, target, options);
    }

    public boolean exists(Path path, LinkOption... options) {
        return Files.exists(path, options);
    }
}
```

Test failure:

```java
class FailingMoveFileOps extends JdkFileOps {
    @Override
    public void move(Path source, Path target, CopyOption... options) throws IOException {
        throw new AtomicMoveNotSupportedException(source.toString(), target.toString(), "test");
    }
}
```

Gunakan abstraction hanya di boundary penting. Jangan over-engineer semua call kecil jika tidak ada failure behavior yang perlu diuji.

---

## 28. Property-based testing untuk path policy

Path policy cocok untuk property-based testing.

Invariant contoh:

```text
Untuk semua input user:
  jika resolver menerima path,
  maka hasilnya harus tetap berada di bawah root.
```

Pseudo-test:

```java
@Property
void acceptedPathNeverEscapesRoot(@ForAll String input, @TempDir Path tempDir) throws Exception {
    SafePathResolver resolver = new SafePathResolver(tempDir);

    try {
        Path resolved = resolver.resolveUserPath(input);
        assertTrue(resolved.normalize().startsWith(tempDir.toRealPath()));
    } catch (IllegalArgumentException | SecurityException expected) {
        // rejected input is acceptable
    }
}
```

Framework contoh:

- jqwik,
- QuickTheories,
- junit-quickcheck.

Property-based test sangat berguna untuk:

- sanitizer,
- archive entry validation,
- extension parser,
- filename generator,
- manifest parser,
- record framing parser.

---

## 29. Testing parser dengan golden files

Golden file berguna untuk format yang harus stabil.

Struktur:

```text
src/test/resources/golden/
  valid-v1-record.bin
  valid-v2-record.bin
  corrupt-bad-checksum.bin
  corrupt-truncated-header.bin
```

Test:

```java
@Test
void readsV1GoldenFile() throws Exception {
    Path file = Paths.get(getClass()
        .getResource("/golden/valid-v1-record.bin")
        .toURI());

    Record record = reader.read(file);

    assertEquals(1, record.version());
    assertEquals("expected", record.payloadAsString());
}
```

Catatan:

- resource dalam JAR tidak selalu berupa normal filesystem path,
- untuk library portable, kadang lebih baik gunakan `InputStream` dari resource,
- jika butuh `Path`, copy resource ke temp file dulu.

```java
static Path copyResourceToTemp(String resource, Path tempDir) throws IOException {
    try (InputStream in = SomeTest.class.getResourceAsStream(resource)) {
        if (in == null) throw new FileNotFoundException(resource);
        Path out = tempDir.resolve(Paths.get(resource).getFileName().toString());
        Files.copy(in, out);
        return out;
    }
}
```

---

## 30. Testing file-backed state machine

Banyak workflow file sebenarnya state machine.

Contoh states:

```text
RECEIVED -> STAGED -> READY -> PROCESSING -> DONE
                              \-> ERROR
```

Test sebaiknya menegaskan transition, bukan hanya file exists.

```java
@Test
void successfulProcessingMovesReadyToDone(@TempDir Path root) throws Exception {
    FileIntakeEngine engine = FileIntakeEngine.create(root);

    engine.receive("a.dat", new byte[] {1});
    engine.publishReady("a.dat");
    engine.processNext();

    assertFalse(Files.exists(root.resolve("ready/a.dat")));
    assertFalse(Files.exists(root.resolve("processing/a.dat")));
    assertTrue(Files.exists(root.resolve("done/a.dat")));
}

@Test
void failedProcessingMovesFileToError(@TempDir Path root) throws Exception {
    FileIntakeEngine engine = FileIntakeEngine.create(root, file -> {
        throw new IOException("boom");
    });

    engine.receive("a.dat", new byte[] {1});
    engine.publishReady("a.dat");
    engine.processNext();

    assertTrue(Files.exists(root.resolve("error/a.dat")));
}
```

Tambahkan invariant:

```java
static void assertFileExistsInExactlyOneState(Path root, String fileName) throws IOException {
    List<String> states = Arrays.asList("staging", "ready", "processing", "done", "error");
    long count = 0;

    for (String state : states) {
        if (Files.exists(root.resolve(state).resolve(fileName))) {
            count++;
        }
    }

    assertEquals(1, count, "file must exist in exactly one state directory");
}
```

Ini gaya testing yang lebih senior: assert invariant domain, bukan detail incidental.

---

## 31. Testing concurrency dengan deterministic hooks

Race condition sulit diuji jika hanya mengandalkan `Thread.sleep`.

Buruk:

```java
Thread.sleep(100);
```

Lebih baik gunakan hook/latch.

```java
class HookedProcessor {
    private final CountDownLatch afterClaim;
    private final CountDownLatch allowContinue;

    HookedProcessor(CountDownLatch afterClaim, CountDownLatch allowContinue) {
        this.afterClaim = afterClaim;
        this.allowContinue = allowContinue;
    }

    void process(Path file) throws Exception {
        afterClaim.countDown();
        allowContinue.await();
        // continue processing
    }
}
```

Test:

```java
@Test
void recoveryDoesNotStealActiveProcessingFile(@TempDir Path root) throws Exception {
    CountDownLatch afterClaim = new CountDownLatch(1);
    CountDownLatch allowContinue = new CountDownLatch(1);

    HookedProcessor processor = new HookedProcessor(afterClaim, allowContinue);
    FileEngine engine = new FileEngine(root, processor);

    ExecutorService pool = Executors.newSingleThreadExecutor();
    Future<?> running = pool.submit(() -> {
        engine.processNext();
        return null;
    });

    assertTrue(afterClaim.await(5, TimeUnit.SECONDS));

    engine.recover();

    // assert recovery did not move active file back to ready

    allowContinue.countDown();
    running.get();
    pool.shutdown();
}
```

Concurrency test harus mengontrol interleaving, bukan berharap timing kebetulan.

---

## 32. Testing disk full dan quota

Disk full sulit dibuat di unit test biasa. Pilihan:

1. fake writer yang throw `IOException`,
2. integration test dengan small tmpfs/container quota,
3. CI job khusus dengan limited volume,
4. manual chaos test.

Unit-level behavior:

```java
class DiskFullWriter implements BlobWriter {
    public void write(Path path, byte[] content) throws IOException {
        throw new IOException("No space left on device");
    }
}
```

Test:

```java
@Test
void diskFullProducesRetryableStorageFailure() {
    StorageService service = new StorageService(new DiskFullWriter());

    StorageResult result = service.store("a.dat", new byte[] {1});

    assertEquals(StorageStatus.RETRYABLE_STORAGE_FAILURE, result.status());
}
```

Integration-level:

```text
Run test inside container with limited writable volume.
Fill volume near threshold.
Execute write workflow.
Assert graceful failure and no corrupt committed file.
```

Yang harus diuji:

- temp file dibersihkan,
- target lama tidak rusak,
- error diklasifikasi,
- metric emitted,
- retry/backpressure aktif.

---

## 33. Testing cleanup setelah failed test

Untuk test yang sengaja mengubah permission, lock, atau membuat background thread, cleanup harus super disiplin.

Checklist:

```text
- Close semua stream/channel/watcher.
- Stop background thread.
- Release file lock.
- Restore permission sebelum @TempDir cleanup.
- Jangan tinggalkan process anak.
- Jangan swallow cleanup error total.
```

Contoh:

```java
FileLock lock = null;
FileChannel channel = null;
try {
    channel = FileChannel.open(file, StandardOpenOption.WRITE);
    lock = channel.lock();
    // test
} finally {
    if (lock != null) lock.release();
    if (channel != null) channel.close();
}
```

Dengan try-with-resources:

```java
try (FileChannel channel = FileChannel.open(file, StandardOpenOption.WRITE);
     FileLock lock = channel.lock()) {
    // test
}
```

---

## 34. CI strategy untuk filesystem code

Minimal CI:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    java: [8, 11, 17, 21, 25]
```

Tetapi tidak semua kombinasi harus menjalankan semua test berat.

Rekomendasi:

```text
Fast unit tests:
  all PR, all supported JDK, Linux

Cross-platform tests:
  PR atau nightly, Windows/macOS/Linux

Provider tests:
  PR, Jimfs Unix + Windows configuration

Stress tests:
  nightly

Crash/recovery tests:
  nightly or pre-release

Network filesystem/container volume tests:
  environment-specific pipeline
```

### 34.1 Tag test

Gunakan tag:

```java
@Tag("filesystem")
@Tag("slow")
@Tag("posix")
@Tag("windows")
@Tag("watcher")
@Tag("stress")
@Tag("crash")
```

Tujuannya supaya test suite bisa dipilih sesuai konteks.

---

## 35. Checklist test case berdasarkan kategori

### 35.1 Path handling

```text
[ ] relative path
[ ] absolute path
[ ] empty path
[ ] dot path
[ ] dot-dot traversal
[ ] separator slash
[ ] separator backslash
[ ] unicode name
[ ] long name
[ ] hidden file
[ ] case collision
[ ] reserved Windows name
```

### 35.2 Creation

```text
[ ] create new success
[ ] create existing fails expectedly
[ ] create parent missing
[ ] createDirectories partial behavior
[ ] temp file created in intended directory
[ ] permission-at-create behavior if POSIX supported
```

### 35.3 Reading

```text
[ ] small text file
[ ] explicit charset
[ ] invalid charset bytes
[ ] large streaming input
[ ] file deleted during read
[ ] file modified during read
[ ] stream is closed
```

### 35.4 Writing

```text
[ ] create new
[ ] replace existing
[ ] append
[ ] truncate
[ ] failure during write
[ ] temp cleanup
[ ] old file preserved on failure if atomic pattern
```

### 35.5 Traversal

```text
[ ] empty directory
[ ] nested directory
[ ] many files
[ ] permission denied subtree
[ ] symlink not followed
[ ] symlink followed with loop detection
[ ] order independent
[ ] stream closed
```

### 35.6 Security

```text
[ ] path traversal rejected
[ ] archive traversal rejected
[ ] symlink escape rejected
[ ] unsafe filename rejected
[ ] extension spoofing detected
[ ] MIME not trusted alone
[ ] cleanup cannot delete outside base
```

### 35.7 Workflow

```text
[ ] staging to ready
[ ] ready to processing
[ ] processing to done
[ ] processing to error
[ ] recovery abandoned processing
[ ] idempotent re-run
[ ] duplicate input
[ ] poison file quarantine
[ ] only one worker claims file
```

### 35.8 Operational

```text
[ ] disk full behavior
[ ] permission denied behavior
[ ] provider unsupported operation
[ ] atomic move unsupported
[ ] network/mounted filesystem profile if used
[ ] metrics/log emitted
[ ] error classification correct
```

---

## 36. Common anti-patterns dalam testing filesystem code

### 36.1 Menggunakan current working directory

Buruk:

```java
Path p = Paths.get("output.txt");
```

Lebih baik:

```java
Path p = tempDir.resolve("output.txt");
```

### 36.2 Tidak menutup stream dari `Files.walk/list/lines`

Buruk:

```java
List<Path> files = Files.walk(root).collect(Collectors.toList());
```

Benar:

```java
try (Stream<Path> stream = Files.walk(root)) {
    List<Path> files = stream.collect(Collectors.toList());
}
```

### 36.3 Assert berdasarkan order directory

Buruk:

```java
assertEquals(expected, Files.list(root).collect(toList()));
```

Benar:

```java
assertEquals(expectedSet, actualSet);
```

### 36.4 Mengabaikan OS-specific behavior

Buruk:

```java
assertTrue(Files.createSymbolicLink(link, target) != null);
```

Benar:

```java
assumeTrue(symlinkSupported);
```

### 36.5 Menganggap in-memory filesystem sama dengan disk

Jimfs bagus, tetapi bukan bukti fsync, OS permission, disk full, atau native lock.

### 36.6 Test hanya happy path

File code tanpa failure test hampir pasti rapuh di production.

### 36.7 Mock `Files` sampai test tidak realistis

Mock static `Files` hanya menguji mock setup, bukan filesystem behavior. Gunakan temp directory untuk behavior nyata dan abstraction seam untuk failure injection.

---

## 37. Reference architecture: testable file service

Contoh struktur service yang mudah diuji:

```text
FileIntakeService
  - Path root
  - FileNamePolicy
  - FileOps boundary
  - Clock
  - EventSink
  - Processor
```

Constructor:

```java
final class FileIntakeService {
    private final Path root;
    private final FileNamePolicy namePolicy;
    private final FileOps fileOps;
    private final Clock clock;
    private final EventSink events;
    private final FileProcessor processor;

    FileIntakeService(
        Path root,
        FileNamePolicy namePolicy,
        FileOps fileOps,
        Clock clock,
        EventSink events,
        FileProcessor processor
    ) {
        this.root = root;
        this.namePolicy = namePolicy;
        this.fileOps = fileOps;
        this.clock = clock;
        this.events = events;
        this.processor = processor;
    }
}
```

Testability benefit:

```text
Path root        -> @TempDir / Jimfs / mounted test volume
FileNamePolicy  -> pure unit test / property-based test
FileOps         -> real JDK ops or failing fake
Clock           -> fixed time for recovery
EventSink       -> in-memory assertion
Processor       -> success/failure/concurrency hook
```

Ini bentuk desain yang matang: production code tetap memakai filesystem nyata, tetapi test bisa mengontrol boundary penting.

---

## 38. Mini capstone: test plan untuk file intake engine

Misal engine:

```text
receive upload
-> write to staging
-> validate hash
-> atomic publish to ready
-> worker claim ready file
-> process
-> done/error
-> recovery on startup
```

Test plan:

### 38.1 Unit tests

```text
[ ] filename policy rejects traversal
[ ] filename policy rejects reserved names
[ ] manifest parser rejects corrupt manifest
[ ] state transition table valid
[ ] retry policy classifies exceptions
```

### 38.2 Filesystem integration tests

```text
[ ] receive writes staging file
[ ] publish uses atomic move
[ ] duplicate publish fails safely
[ ] worker claim only once under concurrency
[ ] successful processing moves to done
[ ] failed processing moves to error
[ ] recovery returns stale processing file
[ ] cleanup does not delete outside root
```

### 38.3 Security tests

```text
[ ] upload filename `../../x` rejected
[ ] symlink under upload root cannot escape
[ ] archive extraction rejects escaping entry
[ ] original filename stored as metadata only
```

### 38.4 Cross-platform tests

```text
[ ] case collision behavior defined
[ ] path separator variants handled
[ ] Windows reserved names rejected
[ ] symlink tests skipped or run depending capability
```

### 38.5 Operational tests

```text
[ ] disk full simulated
[ ] permission denied simulated
[ ] atomic move unsupported simulated
[ ] watcher overflow triggers reconciliation
[ ] metrics emitted on success/failure
```

### 38.6 Chaos/manual tests

```text
[ ] kill process after staging write
[ ] kill process after hash write
[ ] kill process during processing
[ ] restart with file in processing
[ ] run two app instances against same directory
[ ] run against mounted network filesystem if production uses it
```

---

## 39. Mental model akhir Part 33

Testing file/filesystem code harus berpindah dari mindset:

```text
Does this method write a file?
```

menjadi:

```text
Does this workflow preserve its invariants across OS behavior,
provider differences, concurrent mutation, partial failure,
security attacks, cleanup, and recovery?
```

File code production-grade bukan hanya tentang API call. Ia tentang menjaga invariants:

```text
- tidak keluar root,
- tidak overwrite tanpa izin,
- tidak memproses file dua kali,
- tidak meninggalkan corrupt committed file,
- tidak menghapus lokasi salah,
- tidak percaya filename user,
- tidak bergantung pada directory ordering,
- tidak bocor file handle,
- tetap recoverable setelah crash,
- failure dapat didiagnosis.
```

Top engineer tidak menulis test filesystem hanya sebagai happy-path demo. Mereka menulis test untuk membuktikan boundary, failure, dan invariants.

---

## 40. Ringkasan

Di Part 33 ini kita membahas:

1. mengapa testing filesystem berbeda dari unit test biasa,
2. test pyramid untuk file code,
3. penggunaan `@TempDir`,
4. desain kode berbasis `Path`, bukan hard-coded string,
5. path containment test,
6. symlink test,
7. traversal dan cleanup test,
8. stream lifecycle test,
9. permission test,
10. atomic create dan race test,
11. claim-by-rename test,
12. atomic update test,
13. crash recovery test,
14. partial/corrupt file test,
15. large file strategy,
16. directory scale test,
17. WatchService test,
18. file lock test,
19. in-memory filesystem test,
20. Java 8–25 compatibility,
21. archive extraction test,
22. observability test,
23. cleanup safety test,
24. failure injection,
25. property-based test,
26. golden file test,
27. CI strategy,
28. mini capstone test plan.

Part berikutnya:

```text
Part 34 — Capstone: Build a Production-Grade File Intake Engine
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Learn Java IO File Filesystem Storage Engineering — Part 32](./learn-java-io-file-filesystem-storage-engineering-part-32-file-workflow-architecture-patterns.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 34](./learn-java-io-file-filesystem-storage-engineering-part-34-capstone-production-grade-file-intake-engine.md)
