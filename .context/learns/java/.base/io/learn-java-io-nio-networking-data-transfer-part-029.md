# Part 029 — Security, Robustness, dan Defensive I/O: Path Traversal, Zip Slip, Deserialization, Resource Exhaustion

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-029.md`  
> Level: Advanced / Production Engineering  
> Fokus: Membuat boundary I/O Java yang aman, bounded, observable, dan tahan terhadap input jahat, input rusak, serta kegagalan resource.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Membedakan bug I/O biasa dengan **security vulnerability** pada boundary file, archive, stream, network, dan deserialization.
2. Mendesain operasi file yang aman dari:
   - path traversal,
   - absolute path injection,
   - symbolic-link attack,
   - overwrite file penting,
   - TOCTOU race,
   - unsafe temporary file.
3. Mengekstrak archive ZIP secara defensif agar tidak terkena:
   - Zip Slip,
   - Zip Bomb,
   - decompression bomb,
   - overwrite file,
   - permission/metadata abuse.
4. Memahami kenapa Java native deserialization sangat berbahaya untuk boundary eksternal.
5. Memakai prinsip allowlist, payload bound, timeout, quota, checksum, dan canonical boundary.
6. Mendesain API upload/download/file ingestion agar tidak mudah dieksploitasi lewat resource exhaustion.
7. Membuat checklist keamanan I/O yang dapat dipakai di code review dan production design.

Part ini sengaja tidak hanya membahas “cara pakai class Java”. Tujuan utamanya adalah membangun **defensive mental model**: setiap byte, path, filename, object, archive entry, network frame, dan metadata dari luar proses harus dianggap tidak tepercaya sampai dibuktikan aman.

---

## 2. Referensi Utama

Materi ini berangkat dari dokumentasi resmi Java dan praktik defensif umum:

- Java `Path`, `Files`, `LinkOption`, `DirectoryStream`, `SecureDirectoryStream`.
- Java `ZipInputStream`, `ZipEntry`, `InflaterInputStream`.
- Java Object Serialization Specification.
- Java `ObjectInputFilter` dan serialization filtering.
- Java `InputStream`, `OutputStream`, `Socket`, `HttpClient` boundary semantics.
- Prinsip umum secure file handling, canonicalization, allowlist, bounded resource usage, dan fail-closed.

Catatan penting:

- `ZipInputStream` adalah stream untuk membaca entry ZIP dari byte stream.
- `ObjectInputFilter` dapat membatasi class, array length, depth object graph, jumlah reference, dan byte yang dibaca selama deserialization.
- `SecureDirectoryStream` ada untuk operasi direktori yang lebih aman terhadap race condition ketika provider filesystem mendukungnya.

---

## 3. Mental Model: I/O Boundary adalah Trust Boundary

Banyak engineer melihat I/O sebagai “mekanisme teknis”: baca file, tulis file, unzip, parse object, terima upload, kirim response.

Engineer production harus melihat I/O sebagai **trust boundary**.

```text
External world
  |
  | untrusted bytes / names / paths / metadata / object graphs / timing
  v
I/O Boundary
  |
  | validate, normalize, bound, authenticate, authorize, observe
  v
Internal system
```

Input eksternal dapat berupa:

- path dari user,
- filename upload,
- ZIP entry name,
- HTTP body,
- socket frame,
- serialized object,
- CSV field,
- JSON payload,
- generated report parameter,
- file dropped ke ingestion directory,
- environment-mounted file,
- symlink di directory yang tampaknya aman,
- archive yang ukurannya kecil tapi hasil decompression sangat besar.

Setiap boundary harus menjawab pertanyaan:

1. **Apakah input ini boleh ada?**
2. **Apakah ukuran input ini dibatasi?**
3. **Apakah bentuk input ini sesuai format yang diharapkan?**
4. **Apakah lokasi yang disentuh benar-benar berada di root yang diizinkan?**
5. **Apakah operasi ini aman jika terjadi race?**
6. **Apakah operasi ini aman jika proses mati di tengah jalan?**
7. **Apakah operasi ini aman jika attacker mengirim input sangat lambat, sangat besar, sangat dalam, atau sangat banyak?**
8. **Apakah failure-nya fail-closed atau fail-open?**

---

## 4. Prinsip Utama Defensive I/O

### 4.1 Treat All External Names as Data, Not Authority

Filename dari user bukan otoritas lokasi penyimpanan.

Contoh berbahaya:

```java
Path target = uploadDir.resolve(userProvidedFileName);
Files.copy(inputStream, target);
```

Masalah:

```text
userProvidedFileName = "../../../../etc/passwd"
userProvidedFileName = "/root/.ssh/authorized_keys"
userProvidedFileName = "C:\\Windows\\System32\\drivers\\etc\\hosts"
userProvidedFileName = "safe.txt/../evil.txt"
userProvidedFileName = "link-to-sensitive-file"
```

Nama file dari user boleh dipakai sebagai **display name**, bukan sebagai path otoritatif.

Lebih aman:

```java
String storedName = UUID.randomUUID() + ".bin";
Path target = uploadRoot.resolve(storedName);
```

Display name asli disimpan sebagai metadata terpisah setelah divalidasi.

---

### 4.2 Canonical Boundary, Not String Prefix Boundary

Jangan melakukan check keamanan memakai string mentah.

Berbahaya:

```java
if (!path.toString().startsWith("/app/uploads")) {
    throw new SecurityException();
}
```

Masalah:

```text
/app/uploads_evil/file.txt
/app/uploads/../secrets/key.txt
/app/uploads/link-to-outside
```

Gunakan `Path`, normalize, dan bila file harus sudah ada, gunakan `toRealPath`.

```java
Path root = Path.of("/app/uploads").toRealPath();
Path candidate = root.resolve(userInput).normalize();

if (!candidate.startsWith(root)) {
    throw new SecurityException("Path escapes upload root");
}
```

Namun ini belum menyelesaikan semua masalah. Jika symbolic link terlibat, `normalize()` hanya lexical normalization; ia tidak menyelesaikan symlink. Untuk path yang sudah ada, gunakan `toRealPath()` dan pertimbangkan `LinkOption.NOFOLLOW_LINKS` sesuai kebutuhan.

---

### 4.3 Bounded Everything

Semua operasi I/O harus punya batas:

- max file size,
- max request body size,
- max frame size,
- max ZIP entries,
- max uncompressed size,
- max compression ratio,
- max directory depth,
- max object graph depth,
- max array length,
- max string length,
- max processing time,
- max retry,
- max concurrent transfer,
- max open file descriptors,
- max temp directory usage.

Tanpa batas, attacker tidak perlu menembus logic bisnis. Ia cukup membuat sistem kehabisan resource.

---

### 4.4 Fail Closed

Jika check gagal, operasi harus berhenti.

Fail-open anti-pattern:

```java
try {
    validate(file);
} catch (Exception e) {
    log.warn("Validation failed, continue anyway", e);
}
process(file);
```

Fail-closed:

```java
validate(file);
process(file);
```

Atau:

```java
try {
    validate(file);
    process(file);
} catch (ValidationException e) {
    reject(file, e);
}
```

---

### 4.5 Separate Staging, Validation, and Publish

Jangan langsung menaruh input eksternal ke lokasi final.

Pola aman:

```text
incoming bytes
  -> private temp/staging location
  -> bounded write
  -> validation
  -> scan/checksum/metadata extraction
  -> atomic publish
  -> process by internal pipeline
```

Keuntungan:

- file belum valid tidak terlihat oleh consumer,
- partial upload tidak dianggap lengkap,
- bisa cleanup staging,
- bisa audit rejection,
- bisa checksum sebelum publish,
- bisa atomic rename ke final location.

---

## 5. Path Traversal

### 5.1 Apa Itu Path Traversal?

Path traversal terjadi saat input user mengontrol path sehingga dapat keluar dari directory yang diizinkan.

Contoh:

```http
GET /download?file=../../../../etc/passwd
```

Jika backend melakukan:

```java
Path file = downloadRoot.resolve(requestFile);
return Files.readAllBytes(file);
```

maka user dapat membaca file di luar root.

---

### 5.2 Bentuk Path Traversal yang Sering Terlewat

Input berbahaya tidak selalu terlihat sebagai `../`.

Contoh variasi:

```text
../secret.txt
..\secret.txt
....//secret.txt
/absolute/path/secret.txt
C:\absolute\path\secret.txt
file:///etc/passwd
%2e%2e%2fsecret.txt
..%2fsecret.txt
safe/../../secret.txt
safe/%2e%2e/%2e%2e/secret.txt
```

Pada aplikasi web, decoding bisa terjadi lebih dari sekali di layer berbeda:

```text
browser -> proxy -> framework -> app code
```

Karena itu path validation harus dilakukan pada bentuk final yang benar-benar akan dipakai oleh filesystem API.

---

### 5.3 Safe Path Resolution Pattern

Contoh utility:

```java
import java.io.IOException;
import java.nio.file.LinkOption;
import java.nio.file.Path;

public final class SafePaths {
    private final Path rootRealPath;

    public SafePaths(Path root) throws IOException {
        this.rootRealPath = root.toRealPath();
    }

    public Path resolveExistingFile(String userRelativePath) throws IOException {
        if (userRelativePath == null || userRelativePath.isBlank()) {
            throw new IllegalArgumentException("Path must not be blank");
        }

        Path relative = Path.of(userRelativePath);

        if (relative.isAbsolute()) {
            throw new SecurityException("Absolute path is not allowed");
        }

        Path candidate = rootRealPath.resolve(relative).normalize();
        Path realCandidate = candidate.toRealPath();

        if (!realCandidate.startsWith(rootRealPath)) {
            throw new SecurityException("Path escapes root");
        }

        return realCandidate;
    }

    public Path resolveNewFileNoSymlinkFollow(String safeFileName) {
        if (!safeFileName.matches("[A-Za-z0-9._-]{1,120}")) {
            throw new SecurityException("Invalid file name");
        }

        Path candidate = rootRealPath.resolve(safeFileName).normalize();

        if (!candidate.startsWith(rootRealPath)) {
            throw new SecurityException("Path escapes root");
        }

        return candidate;
    }
}
```

Perhatikan perbedaan:

- `resolveExistingFile` memakai `toRealPath()` karena target harus sudah ada.
- `resolveNewFileNoSymlinkFollow` tidak bisa memakai `toRealPath()` pada file yang belum ada; ia harus mengontrol filename dan create option dengan hati-hati.

---

### 5.4 Stronger Pattern: Jangan Terima Path, Terima ID

Untuk download file production, pola terbaik sering kali bukan menerima path.

Buruk:

```http
GET /download?path=2026/06/report.pdf
```

Lebih aman:

```http
GET /documents/{documentId}/content
```

Lalu backend:

```text
documentId
  -> lookup metadata di DB
  -> verify authorization
  -> get internal storage key
  -> resolve internal path/object key
  -> stream content
```

User tidak pernah mengontrol filesystem path.

---

## 6. Symlink Attack dan TOCTOU

### 6.1 Masalah Dasar

Symlink attack terjadi saat attacker membuat path di dalam directory yang diizinkan tetapi menunjuk ke luar.

```text
/app/uploads/user-a/avatar.png -> /etc/passwd
```

Jika aplikasi menulis ke `avatar.png`, ia sebenarnya menulis ke target symlink.

TOCTOU berarti **time-of-check to time-of-use**:

```java
if (Files.isRegularFile(path)) {
    Files.writeString(path, data);
}
```

Di antara check dan write, attacker dapat mengganti path menjadi symlink.

```text
check: avatar.png adalah regular file
attacker replace: avatar.png -> /etc/passwd
use: write avatar.png
```

---

### 6.2 Kenapa `normalize()` Tidak Cukup

`normalize()` hanya menghapus elemen lexical seperti `.` dan `..`.

```java
Path p = Path.of("/app/uploads/link/../x").normalize();
```

Ia tidak tahu apakah `link` adalah symlink ke luar directory.

Untuk menyelesaikan symlink, perlu `toRealPath()` pada path yang sudah ada.

---

### 6.3 Defensive Write untuk File Baru

Gunakan nama internal yang dibuat server, bukan input user.

```java
Path staging = stagingDir.resolve(UUID.randomUUID() + ".upload");

try (var out = Files.newOutputStream(
        staging,
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE)) {
    input.transferTo(out);
}
```

`CREATE_NEW` penting karena gagal jika file sudah ada. Ini mengurangi risiko overwrite.

Untuk environment security-sensitive, juga pertimbangkan:

- staging directory private milik process user,
- permission ketat,
- tidak world-writable,
- tidak mengikuti symlink untuk operasi tertentu,
- atomic move hanya ke directory yang dikontrol.

---

### 6.4 SecureDirectoryStream

`SecureDirectoryStream` dirancang untuk operasi relatif terhadap directory yang sudah terbuka sehingga mengurangi race condition pada file tree traversal ketika provider mendukungnya.

Namun tidak semua filesystem provider mendukung. Karena itu, code harus punya strategi:

1. Jika `DirectoryStream` adalah `SecureDirectoryStream`, gunakan operasi relatif.
2. Jika tidak, gunakan fallback yang lebih konservatif.
3. Untuk operasi sangat security-sensitive, fail jika secure stream tidak tersedia.

Contoh deteksi:

```java
try (DirectoryStream<Path> stream = Files.newDirectoryStream(root)) {
    if (stream instanceof SecureDirectoryStream<Path> secure) {
        // Use secure relative operations where possible.
    } else {
        // Fallback or fail closed for high-risk operation.
    }
}
```

---

## 7. Unsafe Temporary File

### 7.1 Anti-Pattern

```java
Path tmp = Path.of("/tmp/upload.txt");
Files.writeString(tmp, data);
```

Masalah:

- nama predictable,
- bisa ditimpa request lain,
- bisa symlink ke file sensitif,
- race condition,
- permission mungkin terlalu terbuka,
- cleanup tidak jelas.

---

### 7.2 Pattern Aman

```java
Path stagingDir = Files.createTempDirectory("myapp-upload-");
Path stagingFile = Files.createTempFile(stagingDir, "payload-", ".bin");
```

Untuk aplikasi server, lebih baik punya directory staging khusus:

```text
/var/lib/myapp/staging
/var/lib/myapp/final
/var/lib/myapp/rejected
```

Dengan permission ketat:

```text
owner: app user
mode: 0700 atau sesuai kebutuhan
```

---

## 8. File Overwrite dan Atomic Publish

### 8.1 Jangan Overwrite Langsung

Berbahaya:

```java
Files.copy(input, finalPath, StandardCopyOption.REPLACE_EXISTING);
```

Masalah:

- file existing bisa tertimpa,
- consumer bisa membaca file setengah jadi,
- crash meninggalkan partial file,
- retry bisa mengubah data yang sudah dianggap final.

---

### 8.2 Safe Publish Pattern

```java
Path staging = Files.createTempFile(stagingDir, "upload-", ".tmp");

try (InputStream in = requestBody;
     OutputStream out = Files.newOutputStream(staging, StandardOpenOption.WRITE)) {
    copyBounded(in, out, maxBytes);
}

validate(staging);

Path finalPath = finalDir.resolve(serverGeneratedName);
Files.move(staging, finalPath, StandardCopyOption.ATOMIC_MOVE);
```

Jika final file bisa sudah ada, tentukan policy eksplisit:

- reject duplicate,
- versioning,
- overwrite hanya jika authorized,
- compare-and-swap metadata,
- atomic replace dengan backup.

---

## 9. Zip Slip

### 9.1 Apa Itu Zip Slip?

Zip Slip terjadi saat nama entry di archive mengandung path traversal dan extractor menulis file ke luar target directory.

Archive entry:

```text
../../../../etc/cron.d/pwned
```

Extractor naif:

```java
Path out = destination.resolve(entry.getName());
Files.copy(zip, out);
```

Akibatnya file ditulis di luar destination.

---

### 9.2 Safe ZIP Extraction Pattern

```java
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class SafeZipExtractor {
    private final long maxTotalUncompressedBytes;
    private final long maxEntryBytes;
    private final int maxEntries;

    public SafeZipExtractor(long maxTotalUncompressedBytes, long maxEntryBytes, int maxEntries) {
        this.maxTotalUncompressedBytes = maxTotalUncompressedBytes;
        this.maxEntryBytes = maxEntryBytes;
        this.maxEntries = maxEntries;
    }

    public void extract(InputStream zipBytes, Path destination) throws IOException {
        Path destRoot = destination.toRealPath();
        long total = 0;
        int entries = 0;

        try (ZipInputStream zip = new ZipInputStream(zipBytes)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries++;
                if (entries > maxEntries) {
                    throw new IOException("Too many ZIP entries");
                }

                String name = entry.getName();
                validateZipEntryName(name);

                Path target = destRoot.resolve(name).normalize();
                if (!target.startsWith(destRoot)) {
                    throw new IOException("ZIP entry escapes destination: " + name);
                }

                if (entry.isDirectory()) {
                    Files.createDirectories(target);
                    zip.closeEntry();
                    continue;
                }

                Path parent = target.getParent();
                if (parent == null || !parent.startsWith(destRoot)) {
                    throw new IOException("Invalid ZIP entry parent: " + name);
                }
                Files.createDirectories(parent);

                long written = copyEntryBounded(zip, target, maxEntryBytes);
                total += written;

                if (total > maxTotalUncompressedBytes) {
                    throw new IOException("ZIP uncompressed size exceeds limit");
                }

                zip.closeEntry();
            }
        }
    }

    private static void validateZipEntryName(String name) throws IOException {
        if (name == null || name.isBlank()) {
            throw new IOException("Blank ZIP entry name");
        }
        if (name.startsWith("/") || name.startsWith("\\\\")) {
            throw new IOException("Absolute ZIP entry path is not allowed: " + name);
        }
        if (name.contains("\0")) {
            throw new IOException("NUL byte in ZIP entry name");
        }
        // Reject Windows drive-like paths such as C:\\x or C:/x.
        if (name.matches("^[A-Za-z]:.*")) {
            throw new IOException("Windows absolute ZIP path is not allowed: " + name);
        }
    }

    private static long copyEntryBounded(ZipInputStream zip, Path target, long maxEntryBytes) throws IOException {
        long written = 0;
        byte[] buffer = new byte[8192];

        try (OutputStream out = Files.newOutputStream(
                target,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE)) {

            int n;
            while ((n = zip.read(buffer)) != -1) {
                written += n;
                if (written > maxEntryBytes) {
                    throw new IOException("ZIP entry exceeds limit: " + target);
                }
                out.write(buffer, 0, n);
            }
        }

        return written;
    }
}
```

Key points:

- resolve terhadap destination root,
- normalize,
- check `startsWith(destRoot)`,
- reject absolute path,
- reject Windows drive path,
- reject NUL byte,
- gunakan `CREATE_NEW`,
- batas jumlah entry,
- batas size per entry,
- batas total uncompressed size.

---

## 10. Zip Bomb dan Decompression Bomb

### 10.1 Masalah

Archive kecil bisa menghasilkan output sangat besar.

```text
compressed size:     100 KB
uncompressed size:   10 GB
```

Jika aplikasi hanya membatasi ukuran upload compressed, attacker masih bisa membuat disk penuh atau CPU habis saat decompression.

---

### 10.2 Defense

Wajib batasi:

```text
max compressed upload size
max uncompressed total size
max uncompressed entry size
max entry count
max directory depth
max filename length
max compression ratio
max processing time
```

Contoh ratio guard:

```java
static void checkCompressionRatio(long compressedBytes, long uncompressedBytes, long maxRatio) throws IOException {
    if (compressedBytes <= 0) {
        return;
    }
    if (uncompressedBytes / compressedBytes > maxRatio) {
        throw new IOException("Suspicious compression ratio");
    }
}
```

Namun ratio guard tidak cukup sendiri karena `ZipInputStream` tidak selalu memberi compressed size yang bisa dipercaya sebelum entry selesai dibaca. Batas aktual saat read tetap wajib.

---

### 10.3 Jangan Percaya Metadata ZIP Sepenuhnya

`ZipEntry.getSize()` bisa:

- tidak tersedia,
- salah,
- malicious,
- baru diketahui setelah entry selesai.

Maka enforcement harus dilakukan saat membaca stream.

---

## 11. Deserialization Risk

### 11.1 Masalah Utama

Native Java deserialization dapat mengeksekusi logic class selama object graph dibangun ulang, misalnya lewat:

- `readObject`,
- `readResolve`,
- `validateObject`,
- class-specific behavior,
- gadget chain dari dependency di classpath.

Jika input serialized berasal dari user/network/file eksternal, attacker bisa mencoba memicu gadget chain.

Rule production:

```text
Never deserialize untrusted Java native serialized data.
```

Jika legacy memaksa, gunakan allowlist dan object input filter.

---

### 11.2 ObjectInputFilter

`ObjectInputFilter` dapat membatasi:

- class yang boleh dideserialize,
- array length,
- object graph depth,
- jumlah references,
- jumlah bytes.

Contoh filter sederhana:

```java
import java.io.ObjectInputFilter;
import java.io.ObjectInputStream;
import java.util.Set;

public final class SafeDeserializer {
    private static final Set<String> ALLOWED_CLASSES = Set.of(
            "com.example.transfer.TransferManifest",
            "com.example.transfer.TransferChunk",
            "java.lang.String",
            "java.util.ArrayList"
    );

    public static void configure(ObjectInputStream in) {
        ObjectInputFilter filter = info -> {
            if (info.depth() > 20) {
                return ObjectInputFilter.Status.REJECTED;
            }
            if (info.references() > 10_000) {
                return ObjectInputFilter.Status.REJECTED;
            }
            if (info.arrayLength() >= 0 && info.arrayLength() > 1_000_000) {
                return ObjectInputFilter.Status.REJECTED;
            }
            if (info.streamBytes() > 10_000_000) {
                return ObjectInputFilter.Status.REJECTED;
            }

            Class<?> clazz = info.serialClass();
            if (clazz == null) {
                return ObjectInputFilter.Status.UNDECIDED;
            }

            if (clazz.isArray()) {
                Class<?> component = clazz.getComponentType();
                if (component.isPrimitive() || ALLOWED_CLASSES.contains(component.getName())) {
                    return ObjectInputFilter.Status.ALLOWED;
                }
                return ObjectInputFilter.Status.REJECTED;
            }

            if (clazz.isPrimitive() || ALLOWED_CLASSES.contains(clazz.getName())) {
                return ObjectInputFilter.Status.ALLOWED;
            }

            return ObjectInputFilter.Status.REJECTED;
        };

        in.setObjectInputFilter(filter);
    }
}
```

Catatan:

- Allowlist harus spesifik terhadap use case.
- Jangan gunakan denylist sebagai mekanisme utama.
- Batasi graph size dan depth.
- Batasi stream bytes.
- Lebih baik migrasi ke format data eksplisit seperti JSON schema, Protobuf, Avro, CBOR, atau custom binary format yang divalidasi.

---

### 11.3 Deserialization Anti-Patterns

Anti-pattern:

```java
ObjectInputStream in = new ObjectInputStream(socket.getInputStream());
Object obj = in.readObject();
```

Anti-pattern:

```java
ObjectInputStream in = new ObjectInputStream(uploadedFileInputStream);
return in.readObject();
```

Anti-pattern:

```java
// "It's internal only" but the file is writable by another system.
ObjectInputStream in = new ObjectInputStream(Files.newInputStream(path));
```

Internal boundary tetap bisa tidak tepercaya jika:

- file ditulis oleh service lain,
- queue/topic dapat diproduce banyak producer,
- storage bucket shared,
- directory mounted dari luar,
- dependency bisa membawa gadget class baru.

---

## 12. Payload Size dan Stream Limit

### 12.1 `InputStream` Tidak Punya Batas Bawaan

Jika kamu membaca:

```java
byte[] data = input.readAllBytes();
```

maka ukuran input menentukan memory allocation.

Untuk input eksternal, ini berbahaya.

---

### 12.2 Bounded Copy

```java
public static long copyBounded(InputStream in, OutputStream out, long maxBytes) throws IOException {
    byte[] buffer = new byte[8192];
    long total = 0;
    int n;

    while ((n = in.read(buffer)) != -1) {
        total += n;
        if (total > maxBytes) {
            throw new IOException("Input exceeds maximum size: " + maxBytes);
        }
        out.write(buffer, 0, n);
    }

    return total;
}
```

Ini pattern dasar yang harus ada di:

- upload handler,
- socket frame reader,
- archive extractor,
- HTTP client download,
- file ingestion pipeline.

---

### 12.3 Bounded Text Read

Untuk teks, jangan langsung `readString` dari input eksternal besar.

Pattern:

```java
public static String readUtf8TextBounded(InputStream in, int maxBytes) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
    copyBounded(in, out, maxBytes);
    return out.toString(java.nio.charset.StandardCharsets.UTF_8);
}
```

Namun untuk file besar, lebih baik stream line-by-line dengan batas per line dan batas total record.

---

## 13. Slowloris dan Slow Stream

### 13.1 Masalah

Attacker tidak harus mengirim payload besar. Ia bisa mengirim payload sangat lambat agar thread, connection, buffer, atau file descriptor tertahan.

```text
send 1 byte every 30 seconds
hold 10,000 connections
```

---

### 13.2 Defense

Gunakan:

- connection timeout,
- read timeout,
- write timeout,
- idle timeout,
- max request duration,
- min data rate,
- max concurrent connections,
- bounded executor,
- bounded queue,
- reverse proxy limit,
- load balancer timeout.

Pada raw socket:

```java
socket.setSoTimeout(30_000); // read timeout
```

Pada HTTP server, biasanya timeout dikonfigurasi di framework/server/proxy.

Pada Java HTTP Client:

```java
HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(30))
        .GET()
        .build();
```

---

## 14. File Descriptor Leak

### 14.1 Masalah

Setiap file, socket, directory stream, watch service, channel, dan process pipe bisa memakai OS resource.

Leak kecil bisa menjadi outage jika terjadi di path panas.

Anti-pattern:

```java
Stream<Path> paths = Files.list(dir);
paths.forEach(System.out::println);
```

`Files.list` menghasilkan stream yang harus ditutup.

Benar:

```java
try (Stream<Path> paths = Files.list(dir)) {
    paths.forEach(System.out::println);
}
```

---

### 14.2 Resource Ownership Rule

Setiap API yang menerima stream harus jelas:

```text
Apakah method ini menutup stream?
Atau caller tetap owner stream?
```

Contoh dokumentasi method:

```java
/**
 * Reads all records from the given stream.
 * This method does not close the stream; the caller remains responsible for closing it.
 */
public List<Record> readRecords(InputStream in) { ... }
```

Atau:

```java
/**
 * Opens and processes the file. This method owns and closes all resources it opens.
 */
public void process(Path file) { ... }
```

---

## 15. Disk Full dan Temporary Storage Exhaustion

### 15.1 Masalah

Aplikasi sering hanya membatasi memory, tetapi lupa disk.

Input eksternal bisa menghabiskan:

- upload directory,
- temp directory,
- log directory,
- decompression staging,
- report output,
- cache directory.

Disk full dapat menyebabkan:

- upload gagal,
- database gagal menulis WAL/temp,
- log tidak bisa ditulis,
- process crash,
- node unhealthy.

---

### 15.2 Defense

Gunakan:

- quota per tenant/user/job,
- max staging age,
- cleanup job,
- low-space guard via `FileStore.getUsableSpace()`,
- separate filesystem untuk temp upload,
- alerting disk usage,
- atomic cleanup on failure,
- bounded decompression.

Contoh guard:

```java
FileStore store = Files.getFileStore(stagingDir);
long usable = store.getUsableSpace();

if (usable < requiredFreeBytes) {
    throw new IOException("Not enough usable disk space");
}
```

Jangan gunakan ini sebagai satu-satunya jaminan. Disk space bisa berubah antara check dan write. Tetap handle `IOException` saat write.

---

## 16. Log Injection dan Sensitive Data Leakage

### 16.1 Log Injection

Input user bisa mengandung newline dan membuat log palsu.

```text
filename = "report.pdf\nINFO User admin logged in"
```

Jika ditulis langsung:

```java
log.info("Uploaded file: {}", filename);
```

Log viewer bisa menampilkan entry seolah-olah berasal dari aplikasi.

Defense:

- sanitize control character,
- structured logging,
- encode value,
- truncate long fields.

```java
static String safeLogValue(String value, int maxLen) {
    if (value == null) return "null";
    String cleaned = value
            .replace("\r", "\\r")
            .replace("\n", "\\n")
            .replace("\t", "\\t");
    return cleaned.length() <= maxLen ? cleaned : cleaned.substring(0, maxLen) + "...";
}
```

---

### 16.2 Sensitive Data Leakage

Jangan log:

- file content,
- token,
- password,
- private key,
- certificate private material,
- session cookie,
- full authorization header,
- PII tanpa masking,
- raw serialized payload,
- raw rejected upload content.

Log metadata aman:

```text
uploadId
userId/tenantId jika boleh
size
contentType declared
contentType detected
checksum
status
reason code
duration
source IP jika policy mengizinkan
```

---

## 17. Content-Type dan File Extension Tidak Bisa Dipercaya

User bisa upload file bernama:

```text
invoice.pdf
```

Padahal isinya:

```text
Java serialized stream
HTML with script
ZIP bomb
executable
```

`Content-Type` HTTP juga hanya klaim client.

Defense:

- allowlist extension,
- inspect magic number,
- parse dengan parser aman,
- reject polyglot file jika tidak didukung,
- simpan dengan nama internal,
- serve download dengan header aman,
- jangan execute uploaded file,
- jangan taruh upload di webroot executable.

Contoh magic number minimal:

```java
static boolean looksLikePdf(byte[] header) {
    return header.length >= 5
            && header[0] == '%'
            && header[1] == 'P'
            && header[2] == 'D'
            && header[3] == 'F'
            && header[4] == '-';
}
```

Magic number bukan validasi penuh, tapi membantu sebagai lapisan awal.

---

## 18. Serving Files Safely

### 18.1 Download Header

Saat mengirim file ke browser:

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="safe-name.pdf"
X-Content-Type-Options: nosniff
```

Untuk filename, hindari memasukkan nama mentah user tanpa escaping.

Gunakan nama display yang disanitasi dan fallback ASCII jika perlu.

---

### 18.2 Authorization Before I/O

Jangan buka file sebelum authorization.

Buruk:

```java
Path file = resolveFile(id);
InputStream in = Files.newInputStream(file);
checkAuthorization(user, id);
return stream(in);
```

Lebih baik:

```java
Metadata metadata = repository.find(id);
checkAuthorization(user, metadata);
Path file = resolveInternalPath(metadata.storageKey());
return stream(file);
```

Authorization harus berbasis metadata/domain, bukan path yang dikirim user.

---

## 19. Network Frame Defensive Rules

Untuk protocol raw TCP atau NIO:

1. Semua frame harus punya max size.
2. Header harus divalidasi sebelum allocate body buffer.
3. Jangan allocate berdasarkan length field tanpa batas.
4. Timeout harus ada untuk incomplete frame.
5. Connection yang melanggar protocol harus ditutup.
6. Backpressure harus eksplisit.
7. Error response jangan membocorkan detail internal.

Berbahaya:

```java
int len = in.readInt();
byte[] body = in.readNBytes(len);
```

Lebih aman:

```java
int len = in.readInt();
if (len < 0 || len > MAX_FRAME_SIZE) {
    throw new ProtocolException("Invalid frame size");
}
byte[] body = in.readNBytes(len);
if (body.length != len) {
    throw new EOFException("Incomplete frame");
}
```

---

## 20. CSV, JSON, XML, and Parser-Level Exhaustion

Walaupun seri ini fokus Java I/O, parser adalah lanjutan langsung dari I/O.

Risiko umum:

- JSON sangat dalam,
- array sangat panjang,
- string sangat besar,
- CSV line sangat panjang,
- XML entity expansion,
- XML external entity,
- nested compression,
- recursive include.

Defense:

- streaming parser,
- max nesting depth,
- max token/string length,
- max record count,
- max line length,
- disable external entity,
- schema validation jika relevan,
- reject unknown huge fields,
- fail fast.

---

## 21. Security-Oriented I/O State Machine

Untuk upload/ingestion, jangan pakai status boolean sederhana.

Gunakan state machine:

```text
RECEIVING
  -> RECEIVED
  -> VALIDATING
  -> REJECTED
  -> ACCEPTED
  -> PUBLISHED
  -> PROCESSING
  -> PROCESSED
  -> FAILED_RETRYABLE
  -> FAILED_FINAL
```

Invariant:

```text
Only PUBLISHED files are visible to consumers.
Only ACCEPTED files can be published.
Rejected files are never executed, parsed deeply, or served.
Processing uses immutable storage key.
Cleanup never deletes outside controlled root.
```

---

## 22. End-to-End Secure Upload Example

```java
public final class SecureUploadService {
    private final Path stagingDir;
    private final Path finalDir;
    private final long maxBytes;

    public SecureUploadService(Path stagingDir, Path finalDir, long maxBytes) throws IOException {
        this.stagingDir = stagingDir.toRealPath();
        this.finalDir = finalDir.toRealPath();
        this.maxBytes = maxBytes;
    }

    public StoredFile receive(InputStream body, String originalName) throws IOException {
        String uploadId = UUID.randomUUID().toString();
        Path staging = Files.createTempFile(stagingDir, "upload-" + uploadId + "-", ".tmp");

        boolean success = false;
        try {
            long size;
            try (OutputStream out = Files.newOutputStream(staging, StandardOpenOption.WRITE)) {
                size = copyBounded(body, out, maxBytes);
            }

            validateSize(size);
            String safeDisplayName = sanitizeDisplayName(originalName);
            String storageName = uploadId + ".bin";
            Path target = finalDir.resolve(storageName).normalize();

            if (!target.startsWith(finalDir)) {
                throw new SecurityException("Target escaped final dir");
            }

            Files.move(staging, target, StandardCopyOption.ATOMIC_MOVE);
            success = true;

            return new StoredFile(uploadId, safeDisplayName, target, size);
        } finally {
            if (!success) {
                try {
                    Files.deleteIfExists(staging);
                } catch (IOException cleanupFailure) {
                    // Log cleanup failure with uploadId, not raw sensitive content.
                }
            }
        }
    }

    private void validateSize(long size) {
        if (size <= 0) {
            throw new IllegalArgumentException("Empty upload is not allowed");
        }
    }

    private String sanitizeDisplayName(String name) {
        if (name == null || name.isBlank()) {
            return "file";
        }
        String cleaned = name.replace("\\", "_")
                .replace("/", "_")
                .replace("\r", "_")
                .replace("\n", "_")
                .replace("\0", "_");
        return cleaned.length() <= 120 ? cleaned : cleaned.substring(0, 120);
    }

    public record StoredFile(String id, String displayName, Path internalPath, long size) {}
}
```

Yang sengaja dilakukan:

- server-generated ID,
- staging file,
- bounded copy,
- display name disanitasi,
- storage name internal,
- atomic move,
- cleanup on failure,
- tidak memakai original filename sebagai path.

---

## 23. Threat Model per Boundary

| Boundary | Risiko | Defense |
|---|---|---|
| User path | Path traversal | ID-based access, normalize, real path, root check |
| Upload filename | Overwrite, traversal, log injection | Treat as display metadata, sanitize, internal name |
| ZIP entry | Zip Slip | Resolve-normalize-root check, reject absolute path |
| ZIP content | Zip bomb | Max entry, max total, max ratio, max count |
| Serialized object | RCE/gadget, memory abuse | Avoid; ObjectInputFilter; allowlist; size/depth limits |
| Socket frame | OOM, partial read, slowloris | Max frame size, timeout, state machine |
| HTTP body | OOM, disk full | Max body size, streaming, quota |
| File tree traversal | Symlink escape, cycle | NOFOLLOW_LINKS, real path check, depth limit |
| Temp file | Race, overwrite | `createTempFile`, private dir, `CREATE_NEW` |
| Log | Injection, data leakage | Structured logs, sanitize, mask, truncate |

---

## 24. Code Review Checklist

Gunakan checklist ini saat review code I/O.

### 24.1 Path and File

- [ ] Apakah user mengontrol path?
- [ ] Apakah path absolute ditolak?
- [ ] Apakah `..` traversal dicegah?
- [ ] Apakah check memakai `Path`, bukan string prefix?
- [ ] Apakah symlink dipertimbangkan?
- [ ] Apakah operasi create memakai `CREATE_NEW` jika tidak boleh overwrite?
- [ ] Apakah write memakai staging dan atomic publish?
- [ ] Apakah temp file aman dan tidak predictable?
- [ ] Apakah cleanup aman dan tidak bisa delete outside root?

### 24.2 Stream and Payload

- [ ] Apakah ukuran input dibatasi?
- [ ] Apakah `readAllBytes/readString/readAllLines` aman untuk ukuran input?
- [ ] Apakah timeout ada?
- [ ] Apakah resource ditutup?
- [ ] Apakah ownership stream jelas?
- [ ] Apakah partial read/write ditangani?
- [ ] Apakah retry tidak menyebabkan duplicate/corruption?

### 24.3 Archive

- [ ] Apakah entry count dibatasi?
- [ ] Apakah total uncompressed size dibatasi?
- [ ] Apakah per-entry size dibatasi?
- [ ] Apakah entry path dicegah keluar destination?
- [ ] Apakah absolute path ditolak?
- [ ] Apakah overwrite dicegah?
- [ ] Apakah nested archive diatur policy-nya?

### 24.4 Deserialization

- [ ] Apakah native Java deserialization benar-benar diperlukan?
- [ ] Apakah input berasal dari boundary tepercaya?
- [ ] Apakah ada `ObjectInputFilter`?
- [ ] Apakah class allowlist spesifik?
- [ ] Apakah graph depth/reference/array/bytes dibatasi?
- [ ] Apakah dependency gadget risk dipertimbangkan?

### 24.5 Observability

- [ ] Apakah rejection reason tercatat?
- [ ] Apakah metric ukuran, durasi, status, error rate ada?
- [ ] Apakah sensitive data tidak dilog?
- [ ] Apakah ada correlation ID?
- [ ] Apakah alerting untuk disk/temp usage ada?

---

## 25. Common Anti-Patterns

### Anti-Pattern 1 — User Filename as Storage Path

```java
Path target = uploadDir.resolve(fileNameFromUser);
```

Ganti dengan server-generated storage key.

---

### Anti-Pattern 2 — String Prefix Security Check

```java
if (path.toString().startsWith(rootString)) { ... }
```

Ganti dengan `Path` normalization dan real path strategy.

---

### Anti-Pattern 3 — Unbounded `readAllBytes`

```java
byte[] data = input.readAllBytes();
```

Ganti dengan bounded streaming.

---

### Anti-Pattern 4 — Naive ZIP Extraction

```java
Files.copy(zip, dest.resolve(entry.getName()));
```

Ganti dengan safe extraction.

---

### Anti-Pattern 5 — Native Deserialization from Network

```java
new ObjectInputStream(socket.getInputStream()).readObject();
```

Ganti dengan explicit protocol/data format.

---

### Anti-Pattern 6 — Log Raw Input

```java
log.info("Payload: {}", body);
```

Ganti dengan metadata, masking, truncation.

---

## 26. Production Pattern: Defensive File Ingestion Pipeline

```text
1. Receive
   - authenticate source
   - authorize tenant/job
   - assign ingestionId

2. Write to staging
   - bounded copy
   - checksum while writing
   - private directory
   - no final visibility

3. Validate
   - size
   - extension allowlist
   - magic number
   - format parse with limits
   - archive safety if compressed
   - malware scan if required by domain

4. Publish
   - atomic move
   - immutable storage key
   - metadata commit

5. Process
   - stream, not load-all
   - checkpoint
   - poison record handling

6. Observe
   - metrics
   - audit
   - rejection reason
   - correlation id

7. Cleanup
   - staging TTL
   - failed files policy
   - quota enforcement
```

---

## 27. Production Incident Scenarios

### Scenario 1 — Upload Directory Disk Full

Symptom:

```text
IOException: No space left on device
```

Possible causes:

- unbounded uploads,
- failed staging files not cleaned,
- decompression bomb,
- log explosion,
- report generation too large.

Mitigation:

- enforce quota,
- staging TTL cleanup,
- separate filesystem,
- alert at 70/80/90%,
- reject new uploads when low space,
- backpressure upstream.

---

### Scenario 2 — CPU Spike During ZIP Extraction

Possible causes:

- high compression ratio,
- huge number of small entries,
- nested archive,
- antivirus scan bottleneck.

Mitigation:

- max entry count,
- max uncompressed size,
- max processing duration,
- worker pool limit,
- queue limit,
- reject suspicious ratio.

---

### Scenario 3 — Unexpected Sensitive File Served

Possible causes:

- path traversal,
- symlink escape,
- IDOR combined with path access,
- authorization after file open,
- object storage key guessed.

Mitigation:

- ID-based authorization,
- internal storage key,
- real path root check,
- signed URLs with narrow scope if object storage,
- audit access.

---

## 28. Testing Strategy

### 28.1 Path Traversal Test Cases

```text
../secret.txt
..\\secret.txt
/a/b/c
C:\\Windows\\x
safe/../../secret
%2e%2e%2fsecret
safe.txt\nFAKELOG
```

### 28.2 ZIP Test Cases

```text
normal.zip
entry: ../../evil.txt
entry: /absolute.txt
entry: C:\\evil.txt
entry count > limit
total uncompressed > limit
single entry > limit
nested dirs > depth limit
duplicate entry names
very long entry name
```

### 28.3 Stream Test Cases

```text
empty input
exact max size
max size + 1 byte
slow stream
stream throws IOException halfway
stream never EOF
```

### 28.4 Deserialization Test Cases

```text
allowed class
rejected class
array too large
graph too deep
too many references
stream too large
corrupted stream
```

---

## 29. Mental Model Summary

Defensive I/O bukan satu API. Ia adalah kumpulan invariant.

Invariant penting:

```text
External input never becomes filesystem authority.
Every byte stream has a size and time bound.
Every archive extraction has root, count, and size bounds.
Every deserialization boundary is deny-by-default.
Every final file is published atomically after validation.
Every resource has a clear owner and close lifecycle.
Every failure is observable without leaking secrets.
```

Jika invariant ini dijaga, aplikasi jauh lebih tahan terhadap exploit maupun kegagalan biasa.

---

## 30. Latihan

### Latihan 1 — Safe Download Resolver

Buat `DownloadResolver` yang menerima `documentId`, bukan path. Resolver harus:

- lookup metadata,
- check authorization,
- resolve internal storage path,
- verify path masih dalam storage root,
- stream file tanpa `readAllBytes`.

### Latihan 2 — Safe ZIP Extractor

Kembangkan extractor dengan policy:

- max 1,000 entries,
- max 100 MB total uncompressed,
- max 10 MB per entry,
- reject absolute path,
- reject traversal,
- reject duplicate target path,
- write ke staging sebelum publish.

### Latihan 3 — Legacy Deserialization Wrapper

Buat wrapper untuk legacy `ObjectInputStream` yang:

- memakai allowlist,
- max depth 20,
- max references 10,000,
- max bytes 10 MB,
- reject class selain DTO internal tertentu.

### Latihan 4 — Resource Exhaustion Fault Injection

Simulasikan:

- input lebih besar 1 byte dari limit,
- stream yang lambat,
- disk full menggunakan filesystem kecil/container volume,
- ZIP dengan ribuan entry kecil,
- file upload yang terputus di tengah.

---

## 31. Ringkasan

Part ini membahas security, robustness, dan defensive I/O sebagai lapisan wajib dari sistem Java production.

Kita membahas:

- I/O sebagai trust boundary.
- Path traversal dan safe path resolution.
- Symlink attack dan TOCTOU.
- Safe temporary file dan atomic publish.
- Zip Slip dan safe extraction.
- Zip bomb dan decompression limit.
- Deserialization risk dan `ObjectInputFilter`.
- Bounded stream dan payload limit.
- Slowloris dan timeout.
- File descriptor leak.
- Disk full dan quota.
- Log injection dan sensitive data leakage.
- Safe file serving.
- Network frame defensive rules.
- Parser-level exhaustion.
- Secure upload and ingestion state machine.

Core lesson:

```text
A robust Java I/O system is not defined by how fast it reads and writes,
but by how safely it handles hostile, malformed, partial, huge, slow,
and unexpected input without corrupting state or exhausting resources.
```

---

## 32. Status Seri

Part 029 selesai.

Seri belum selesai. Part berikutnya adalah part terakhir:

```text
learn-java-io-nio-networking-data-transfer-part-030.md
```

Topik berikutnya:

```text
Production Design Patterns: File Ingestion, Export Job, Secure Transfer, Audit, Observability, dan Operational Runbook
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 028 — Concurrency and I/O: Thread-per-Connection, Virtual Thread, Async I/O, Locking, dan Backpressure](./learn-java-io-nio-networking-data-transfer-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 030 — Production Design Patterns: File Ingestion, Export Job, Secure Transfer, Audit, Observability, dan Operational Runbook](./learn-java-io-nio-networking-data-transfer-part-030.md)

</div>