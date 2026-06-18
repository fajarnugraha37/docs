# learn-java-io-file-filesystem-storage-engineering — Part 13
# Path Traversal Security: User Input, Uploads, Archives, and Sandboxes

> Seri: `learn-java-io-file-filesystem-storage-engineering`  
> Part: `13`  
> Target Java: `8 sampai 25`  
> Fokus: path traversal, user-controlled path, upload storage, archive extraction, sandbox boundary, symlink race, case-sensitivity, Unicode normalization, dan desain API file yang defensible.

---

## 0. Kenapa Part Ini Penting

Path traversal adalah salah satu bug yang terlihat sederhana tetapi sangat sering menjadi akar kompromi sistem:

```text
../../../../etc/passwd
..\..\..\Windows\System32\drivers\etc\hosts
/absolute/path/to/secret
C:\Users\app\.ssh\id_rsa
%2e%2e%2f%2e%2e%2fsecret.txt
```

Dalam aplikasi Java, bug ini biasanya muncul ketika sistem menerima input seperti:

- nama file upload dari user;
- path attachment;
- nama export report;
- parameter `download?file=...`;
- nama template;
- nama folder tenant;
- path hasil ekstraksi ZIP;
- lokasi file temporary;
- path configuration override;
- path generated oleh integrasi eksternal.

Kesalahan umum adalah berpikir:

```java
Path safe = base.resolve(userInput).normalize();
if (safe.startsWith(base)) {
    return Files.readAllBytes(safe);
}
```

Kode itu terlihat masuk akal, tetapi belum tentu aman. Ada banyak jebakan:

- `base` mungkin relative;
- `safe.startsWith(base)` bisa menjadi lexical check saja;
- symbolic link dapat mengubah target setelah validasi;
- filesystem bisa case-insensitive;
- Unicode dapat membuat nama terlihat sama tetapi byte berbeda;
- archive entry bisa berisi `../`;
- absolute path dari user dapat mengabaikan base path;
- file bisa diganti antara validasi dan operasi;
- `normalize()` tidak menyentuh filesystem sehingga tidak menyelesaikan symlink;
- Windows punya drive letter, UNC path, alternate separator, reserved names, device names;
- object storage dan ZIP filesystem punya semantics berbeda.

Tujuan part ini bukan hanya memberi snippet, tetapi membangun mental model agar kamu bisa mendesain boundary file yang aman, bisa diaudit, dan tahan terhadap input jahat.

---

## 1. Mental Model: Path Security Bukan Masalah String

Path traversal bukan sekadar masalah substring `..`.

Masalah sebenarnya adalah:

```text
untrusted name
    ↓
path interpretation
    ↓
filesystem resolution
    ↓
object reached by operation
    ↓
security boundary violated or not
```

Yang harus dijaga adalah **object yang akhirnya disentuh oleh operasi file**, bukan hanya teks path yang terlihat.

### 1.1 Tiga Lapisan Path

Dalam Java NIO, kamu perlu membedakan tiga lapisan:

```text
1. User input string
   Contoh: "../../secret.txt"

2. Lexical Path
   Path object yang dibentuk dari string.
   Operasi seperti resolve(), normalize(), startsWith() bisa lexical.

3. Real filesystem target
   Objek nyata setelah root, symlink, mount point, junction, permission, dan provider diselesaikan.
```

Contoh:

```java
Path p = Path.of("/app/uploads/tenant-a/link-to-etc/passwd");
```

Secara lexical, path itu berada di bawah `/app/uploads/tenant-a`. Tetapi jika `link-to-etc` adalah symlink ke `/etc`, target real-nya adalah `/etc/passwd`.

Itulah kenapa security check yang hanya lexical tidak cukup untuk operasi yang sensitif.

---

## 2. Threat Model: Apa yang Bisa Dikendalikan Attacker?

Sebelum menulis kode, tanyakan:

```text
Apakah attacker bisa mengontrol:
- nama file?
- path relatif?
- ekstensi?
- isi file?
- isi archive?
- nama entry archive?
- symbolic link dalam directory?
- timing file creation/deletion?
- tenant id?
- mount point?
- case dari nama path?
- encoding/percent-encoding?
- Unicode form?
```

Semakin banyak yang bisa dikontrol attacker, semakin kecil kepercayaan yang boleh diberikan kepada path.

### 2.1 Contoh Boundary Berisiko

```text
GET /download?file=invoice-2026.pdf
POST /upload filename="../../webapps/ROOT/shell.jsp"
POST /import zip contains "../../../config/application.yml"
GET /avatar?name=../../admin/avatar.png
POST /template?path=/etc/passwd
```

Bahkan bila aplikasimu tidak expose filesystem langsung, bug traversal bisa muncul melalui fitur bisnis:

- import document;
- generated correspondence;
- exported report;
- evidence attachment;
- regulatory case document;
- template management;
- audit evidence archive;
- bulk data migration package.

---

## 3. Rule Besar: Jangan Jadikan User Input Sebagai Path

Untuk sistem production, prinsip paling aman:

```text
User input should identify a logical object, not a filesystem path.
```

Lebih baik:

```text
/download?id=8f4a2d7e-...       ✅
```

daripada:

```text
/download?path=tenant-a/case-123/evidence.pdf   ❌ jika langsung dipakai sebagai path
```

Sistem mapping internal:

```text
logical id → database row → storage key/path yang dibuat server
```

Contoh storage design:

```text
/uploads/
  tenant-001/
    2026/
      06/
        18/
          01HXZ4DK8C2T7Z5QW9QH7Y8N3A.bin
```

Metadata asli disimpan di DB:

```text
id: 01HXZ4DK8C2T7Z5QW9QH7Y8N3A
original_filename: "appeal evidence.pdf"
storage_filename: "01HXZ4DK8C2T7Z5QW9QH7Y8N3A.bin"
content_type_declared: "application/pdf"
content_type_detected: "application/pdf"
sha256: ...
owner_tenant: tenant-001
```

Dengan pola ini, user tidak pernah memilih path storage.

---

## 4. `normalize()` Itu Bukan Security Boundary

`Path.normalize()` menghapus elemen redundant seperti `.` dan `..` secara lexical.

Contoh:

```java
Path p = Path.of("/app/uploads/a/../b/file.txt");
System.out.println(p.normalize());
// /app/uploads/b/file.txt
```

Tetapi `normalize()`:

- tidak mengecek file ada atau tidak;
- tidak resolve symbolic link;
- tidak mengecek permission;
- tidak tahu target real;
- tidak mencegah race;
- tidak cukup untuk containment jika base relative atau symlink involved.

Contoh bahaya:

```text
/app/uploads/tenant-a/link/../secret.txt
```

Secara lexical, `link/..` bisa hilang. Tetapi jika `link` adalah symlink, real resolution bisa berbeda bergantung cara operasi filesystem menyelesaikannya.

### 4.1 Fungsi `normalize()` Tetap Berguna

`normalize()` berguna untuk:

- membersihkan path lexical;
- mendeteksi input obvious seperti `../`;
- membuat canonical-looking representation;
- memudahkan validasi awal;
- mengurangi path confusion.

Tetapi jangan jadikan `normalize()` sebagai satu-satunya mekanisme keamanan.

---

## 5. `toRealPath()` dan Real Filesystem Resolution

`toRealPath()` menyelesaikan path menjadi real absolute path dan secara default mengikuti symbolic links. Dengan `LinkOption.NOFOLLOW_LINKS`, perilakunya tidak mengikuti final symlink, tetapi detail intermediate path tetap perlu dipahami.

Mental model:

```text
normalize()  = lexical cleanup
absolute()   = attach current working directory / root semantics
toRealPath() = ask filesystem what real target is
```

Contoh:

```java
Path base = Path.of("/app/uploads").toRealPath();
Path requested = base.resolve(userInput).normalize();
Path real = requested.toRealPath();

if (!real.startsWith(base)) {
    throw new SecurityException("Path escapes base directory");
}
```

Ini lebih kuat dibanding lexical-only check, tetapi masih ada limitation:

- target harus sudah ada;
- ada TOCTOU window antara check dan use;
- jika attacker bisa mengganti path setelah check, operasi berikutnya bisa kena race;
- tidak cukup untuk create-new file yang belum ada;
- filesystem case/Unicode semantics bisa membuat check tricky.

---

## 6. Basic Containment Check: Kapan Cukup dan Kapan Tidak

Containment check menjawab:

```text
Apakah path yang diminta masih berada di bawah base directory yang diizinkan?
```

### 6.1 Lexical Containment untuk Non-Sensitive Display

Untuk operasi non-sensitive, lexical check bisa cukup sebagai prefilter:

```java
static Path lexicalResolveInside(Path baseAbsoluteNormalized, String userInput) {
    Path candidate = baseAbsoluteNormalized.resolve(userInput).normalize();
    if (!candidate.startsWith(baseAbsoluteNormalized)) {
        throw new IllegalArgumentException("Path escapes base directory");
    }
    return candidate;
}
```

Syarat minimal:

- `baseAbsoluteNormalized` harus absolute;
- input tidak boleh absolute;
- input tidak boleh kosong jika itu tidak valid;
- hasil hanya precheck, bukan final security guarantee.

### 6.2 Real Containment untuk Read Existing File

Untuk membaca file yang sudah ada:

```java
static Path resolveExistingFileInside(Path base, String userInput) throws IOException {
    Path realBase = base.toRealPath();

    Path lexicalCandidate = realBase.resolve(userInput).normalize();
    if (!lexicalCandidate.startsWith(realBase)) {
        throw new SecurityException("Path escapes base directory lexically");
    }

    Path realCandidate = lexicalCandidate.toRealPath();
    if (!realCandidate.startsWith(realBase)) {
        throw new SecurityException("Path escapes base directory through links");
    }

    if (!Files.isRegularFile(realCandidate)) {
        throw new SecurityException("Not a regular file");
    }

    return realCandidate;
}
```

Ini baik untuk banyak kasus read-only, tetapi untuk threat model tinggi masih perlu mitigasi race.

---

## 7. Absolute Path Injection

Salah satu jebakan `resolve`:

```java
Path base = Path.of("/app/uploads");
Path p = base.resolve("/etc/passwd");
System.out.println(p);
// /etc/passwd
```

Jika argument `resolve` adalah absolute path, base bisa diabaikan.

Maka validasi input harus menolak absolute path:

```java
Path userPath = Path.of(userInput);
if (userPath.isAbsolute()) {
    throw new SecurityException("Absolute path is not allowed");
}
```

Tetapi hati-hati: Windows punya variasi seperti:

```text
C:\secret.txt
\server\share\secret.txt
\\server\share\secret.txt
\Windows\System32
```

Jika aplikasi berjalan cross-platform, jangan validasi separator secara manual. Gunakan `Path` dari filesystem runtime, dan untuk input user sebaiknya jangan menerima path bebas sama sekali.

---

## 8. `startsWith` Path Bukan `String.startsWith`

Jangan lakukan ini:

```java
String base = "/app/uploads";
String candidate = "/app/uploads_evil/file.txt";

if (candidate.startsWith(base)) {
    // BUG: true, padahal bukan child directory
}
```

Gunakan `Path.startsWith(Path)`:

```java
Path base = Path.of("/app/uploads").toAbsolutePath().normalize();
Path candidate = Path.of("/app/uploads_evil/file.txt").toAbsolutePath().normalize();

if (!candidate.startsWith(base)) {
    throw new SecurityException("outside base");
}
```

`Path.startsWith` membandingkan elemen path, bukan prefix string biasa.

Tetapi tetap ingat: ini lexical kecuali kamu pakai `toRealPath()`.

---

## 9. Filename Validation: Allowlist, Bukan Denylist

Denylist seperti ini rapuh:

```java
if (name.contains("..") || name.contains("/") || name.contains("\\")) reject();
```

Masalah:

- encoding bisa bypass;
- Unicode homoglyph;
- alternate separator;
- reserved device name;
- trailing dot/space Windows;
- null byte pada beberapa boundary native lama;
- application-specific parser berbeda dari filesystem parser.

Lebih aman: allowlist untuk nama tampilan atau logical name.

Contoh konservatif:

```java
private static final Pattern SAFE_DISPLAY_NAME =
    Pattern.compile("[A-Za-z0-9][A-Za-z0-9._ -]{0,127}");

static String validateDisplayFilename(String original) {
    Objects.requireNonNull(original, "original");

    String name = original.strip();
    if (!SAFE_DISPLAY_NAME.matcher(name).matches()) {
        throw new IllegalArgumentException("Invalid filename");
    }

    if (name.startsWith(".") || name.contains("..")) {
        throw new IllegalArgumentException("Unsafe filename");
    }

    return name;
}
```

Namun untuk storage internal, lebih baik jangan pakai original filename sama sekali.

---

## 10. Storage Filename: Generate Sendiri

Pola aman untuk upload:

```text
original filename from user → metadata only
storage filename            → generated by server
```

Contoh:

```java
static String newStorageName(String extension) {
    String id = UUID.randomUUID().toString();
    return extension == null || extension.isBlank()
        ? id
        : id + "." + extension.toLowerCase(Locale.ROOT);
}
```

Tetapi extension pun jangan dipercaya sebagai content type.

Lebih aman:

```text
storage file: UUID/random/content-hash
metadata: original filename, declared MIME, detected MIME, size, sha256
```

Contoh layout:

```text
/var/app/storage/uploads/
  tenant-a/
    2026/06/18/
      9f0e7a2c-5f7d-4f9a-bd27-1e3f2a8e4a91.blob
      9f0e7a2c-5f7d-4f9a-bd27-1e3f2a8e4a91.meta.json
```

---

## 11. Secure Upload Write Pattern

Upload write bukan hanya `Files.copy(input, path)`.

Production pattern:

```text
1. Authenticate user.
2. Authorize tenant/case context.
3. Reject user-supplied path; accept only original display filename.
4. Validate display filename for UI use.
5. Generate storage id server-side.
6. Write to staging temp file inside controlled directory.
7. Enforce size limit while streaming.
8. Compute hash while streaming.
9. Validate content type/magic number if needed.
10. Atomic move from staging to final path.
11. Persist metadata transactionally with business record.
12. On failure, cleanup staging file.
```

Example Java 8 compatible implementation sketch:

```java
public final class UploadStorage {
    private final Path root;
    private final long maxBytes;

    public UploadStorage(Path root, long maxBytes) throws IOException {
        this.root = root.toRealPath();
        this.maxBytes = maxBytes;
    }

    public StoredUpload store(String tenantId,
                              String originalFilename,
                              InputStream input) throws IOException {
        String safeTenant = validateTenantId(tenantId);
        String safeOriginal = validateDisplayFilename(originalFilename);

        Path tenantDir = root.resolve(safeTenant);
        Files.createDirectories(tenantDir);

        Path realTenantDir = tenantDir.toRealPath();
        if (!realTenantDir.startsWith(root)) {
            throw new SecurityException("Tenant directory escapes root");
        }

        String storageId = UUID.randomUUID().toString();
        Path staging = Files.createTempFile(realTenantDir, storageId + ".", ".uploading");
        Path finalPath = realTenantDir.resolve(storageId + ".blob");

        MessageDigest sha256 = newSha256();
        long written = 0;

        try (InputStream in = input;
             OutputStream out = Files.newOutputStream(staging,
                 StandardOpenOption.WRITE,
                 StandardOpenOption.TRUNCATE_EXISTING)) {

            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) {
                written += n;
                if (written > maxBytes) {
                    throw new IOException("Upload too large");
                }
                sha256.update(buffer, 0, n);
                out.write(buffer, 0, n);
            }
        } catch (Throwable t) {
            tryDelete(staging);
            throw t;
        }

        Files.move(staging, finalPath, StandardCopyOption.ATOMIC_MOVE);

        return new StoredUpload(
            storageId,
            safeOriginal,
            finalPath.getFileName().toString(),
            written,
            toHex(sha256.digest())
        );
    }

    private static String validateTenantId(String tenantId) {
        if (!tenantId.matches("[A-Za-z0-9_-]{1,64}")) {
            throw new IllegalArgumentException("Invalid tenant id");
        }
        return tenantId;
    }

    private static MessageDigest newSha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void tryDelete(Path p) {
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
            // log in real system
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
```

Catatan:

- `tenantId` divalidasi sebagai logical segment, bukan path bebas.
- `originalFilename` tidak dipakai sebagai path storage.
- staging dibuat di dalam tenant directory agar final move bisa atomic di filesystem yang sama.
- size limit dilakukan saat streaming, bukan setelah semua file disimpan.
- hash dihitung saat stream lewat.

---

## 12. Secure Download Pattern

Download yang buruk:

```java
@GetMapping("/download")
byte[] download(@RequestParam String path) throws IOException {
    return Files.readAllBytes(Path.of("/app/uploads").resolve(path));
}
```

Download yang lebih benar:

```text
request id
  ↓
load metadata from DB
  ↓
authorize user against metadata tenant/case
  ↓
construct server-owned path
  ↓
real containment check
  ↓
stream file
```

Example:

```java
public Path resolveStoredBlob(String tenantId, String storageName) throws IOException {
    String safeTenant = validateTenantId(tenantId);
    String safeStorage = validateStorageName(storageName);

    Path base = root.resolve(safeTenant).toRealPath();
    if (!base.startsWith(root)) {
        throw new SecurityException("Tenant base escapes root");
    }

    Path candidate = base.resolve(safeStorage).normalize();
    if (!candidate.startsWith(base)) {
        throw new SecurityException("Storage path escapes tenant base");
    }

    Path real = candidate.toRealPath();
    if (!real.startsWith(base)) {
        throw new SecurityException("Real path escapes tenant base");
    }

    if (!Files.isRegularFile(real)) {
        throw new FileNotFoundException("Not a regular file");
    }

    return real;
}
```

Better lagi: storage name juga server-generated sehingga validasinya sederhana:

```java
private static String validateStorageName(String name) {
    if (!name.matches("[0-9a-fA-F-]{36}\\.blob")) {
        throw new IllegalArgumentException("Invalid storage name");
    }
    return name;
}
```

---

## 13. Symlink Race: Check-Then-Use Bisa Dikalahkan

Masalah klasik:

```text
1. App validate candidate.toRealPath() masih di dalam base.
2. Attacker mengganti file/directory dengan symlink.
3. App membuka path yang sama.
4. Operasi mengenai target lain.
```

Ini TOCTOU: time-of-check-time-of-use.

### 13.1 Contoh Race

```java
Path real = candidate.toRealPath();
if (!real.startsWith(base)) reject();

// Window race di sini
return Files.newInputStream(candidate);
```

Jika directory writable oleh attacker, attacker bisa mengganti `candidate` setelah validasi.

### 13.2 Mitigasi Desain

Mitigasi paling kuat biasanya bukan snippet, tetapi desain:

```text
- Jangan beri attacker write access ke directory yang dipakai aplikasi sebagai trusted root.
- Jangan process file dari directory shared yang bisa dimodifikasi user lain tanpa claim/rename protocol.
- Gunakan server-generated filenames.
- Buat directory dengan permission ketat.
- Untuk upload, jangan follow symlink; create file baru secara atomic.
- Untuk read, gunakan metadata DB dan storage path internal.
- Untuk delete, validasi root dan gunakan traversal no-follow.
```

Java portable API tidak memberikan semua primitive seperti Linux `openat()` dengan `O_NOFOLLOW` untuk setiap komponen path. Maka desain directory ownership dan permission sangat penting.

---

## 14. Secure Directory Layout

Directory layout yang buruk:

```text
/app/uploads/
  user-controlled-folder-name/
    user-controlled-filename
```

Directory layout yang lebih baik:

```text
/app/storage/
  tenants/
    tenant-001/
      blobs/
        ab/cd/abcdef....blob
      staging/
        random.tmp
      quarantine/
        random.blob
```

Invariants:

```text
- root dimiliki service account;
- tenant directory dibuat aplikasi;
- user tidak bisa create symlink langsung di filesystem;
- original filename tidak menjadi storage path;
- staging dan final berada dalam filesystem yang sama;
- quarantine masih dalam controlled root;
- cleanup hanya berjalan di bawah root yang sudah real-validated;
- path bisnis berasal dari metadata, bukan request parameter.
```

---

## 15. Archive Extraction dan Zip Slip

Archive extraction sangat berbahaya karena archive entry name adalah path yang dikendalikan attacker.

Contoh malicious ZIP:

```text
normal.txt
../../../../etc/cron.d/pwned
subdir/../../../app/config.yml
/absolute/path/evil.txt
C:\Windows\System32\evil.dll
```

Jika ekstraksi naïve:

```java
Path out = dest.resolve(entry.getName());
Files.copy(zip.getInputStream(entry), out);
```

Maka entry bisa menulis keluar `dest`.

### 15.1 Secure ZIP Extraction Skeleton

```java
public static void extractZipSecurely(Path zipFile, Path destination) throws IOException {
    Path destReal = destination.toRealPath();

    try (ZipInputStream zis = new ZipInputStream(Files.newInputStream(zipFile))) {
        ZipEntry entry;
        while ((entry = zis.getNextEntry()) != null) {
            String rawName = entry.getName();

            Path entryPath = Path.of(rawName);
            if (entryPath.isAbsolute()) {
                throw new SecurityException("Absolute archive entry is not allowed: " + rawName);
            }

            Path target = destReal.resolve(rawName).normalize();
            if (!target.startsWith(destReal)) {
                throw new SecurityException("Archive entry escapes destination: " + rawName);
            }

            if (entry.isDirectory()) {
                Files.createDirectories(target);
            } else {
                Path parent = target.getParent();
                if (parent == null || !parent.startsWith(destReal)) {
                    throw new SecurityException("Invalid parent for entry: " + rawName);
                }

                Files.createDirectories(parent);

                // For higher security, also verify parent real path after creation.
                Path parentReal = parent.toRealPath();
                if (!parentReal.startsWith(destReal)) {
                    throw new SecurityException("Entry parent escapes via link: " + rawName);
                }

                Files.copy(zis, target, StandardCopyOption.REPLACE_EXISTING);
            }

            zis.closeEntry();
        }
    }
}
```

Ini minimum, bukan final untuk hostile archives. Masih perlu:

- size limit total;
- size limit per file;
- entry count limit;
- directory depth limit;
- reject symlink entries jika format/library expose symlink metadata;
- reject suspicious names;
- extract ke fresh private staging directory;
- scan/validate hasil;
- atomic publish hasil ekstraksi jika semua aman.

### 15.2 Fresh Staging Directory Pattern

Lebih aman:

```text
1. Create fresh staging dir under controlled root.
2. Extract archive into staging dir.
3. Validate complete extracted tree.
4. Move accepted files into final location.
5. Delete staging on failure.
```

Jangan ekstrak langsung ke directory final yang sedang dipakai production.

---

## 16. ZIP FileSystem Bukan Otomatis Aman

Java punya ZIP filesystem provider yang memperlakukan ZIP/JAR sebagai filesystem. Ini berguna, tetapi jangan salah paham:

```java
try (FileSystem zipfs = FileSystems.newFileSystem(zipPath, Map.of())) {
    Path root = zipfs.getPath("/");
    // walk root
}
```

ZIP filesystem membantu path abstraction, tetapi security tetap perlu:

- validasi entry path;
- limit ukuran;
- limit jumlah entry;
- hindari overwrite keluar target saat copy ke filesystem normal;
- waspadai compression bomb;
- pahami provider capability.

Pada JDK modern, ZIP filesystem provider memiliki aturan tertentu seperti tidak mendukung membuka ZIP existing yang mengandung entry dengan `.` atau `..` sebagai name elements. Namun kamu tetap tidak boleh mengandalkan satu detail provider sebagai satu-satunya defense untuk semua format archive dan semua library.

---

## 17. Compression Bomb dan Resource Exhaustion

Path traversal bukan satu-satunya risiko archive.

Risiko lain:

```text
- zip bomb: compressed kecil, extracted sangat besar;
- terlalu banyak file kecil;
- nested archive;
- path terlalu dalam;
- nama file sangat panjang;
- metadata aneh;
- duplicate entry;
- overwrite existing file;
- file type tidak sesuai;
- symlink/hardlink entry.
```

Limit yang perlu ada:

```text
max archive bytes
max total extracted bytes
max entry count
max single entry bytes
max path depth
max filename length
max nested archive depth atau reject nested archive
max extraction time
```

Contoh stream limiting:

```java
static long copyWithLimit(InputStream in, OutputStream out, long maxBytes) throws IOException {
    byte[] buffer = new byte[64 * 1024];
    long total = 0;
    int n;
    while ((n = in.read(buffer)) != -1) {
        total += n;
        if (total > maxBytes) {
            throw new IOException("Entry too large");
        }
        out.write(buffer, 0, n);
    }
    return total;
}
```

---

## 18. Unicode Normalization dan Filename Confusion

Dua filename bisa terlihat sama tetapi byte sequence berbeda.

Contoh konseptual:

```text
é  = U+00E9
é  = e + combining acute accent
```

Beberapa filesystem melakukan normalization berbeda, terutama historically macOS punya behavior yang bisa mengejutkan dibanding Linux.

Risiko:

- duplicate-looking files;
- authorization bypass karena visual confusion;
- extension bypass;
- audit log misleading;
- manual review salah;
- phishing filename.

Mitigasi:

```java
String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);
```

Tetapi untuk storage internal, tetap gunakan generated name.

Untuk display, simpan original filename tetapi normalisasi untuk comparison/search jika perlu.

---

## 19. Case Sensitivity dan Case Folding

Filesystem berbeda:

```text
Linux ext4 default       : case-sensitive
Windows NTFS default     : case-insensitive, case-preserving
macOS APFS configuration : bisa case-sensitive atau insensitive
```

Akibat:

```text
Report.pdf
report.pdf
REPORT.PDF
```

Bisa tiga file berbeda di Linux, tetapi konflik di Windows.

Risiko:

- duplicate filename policy inconsistent;
- extension validation bypass;
- migration gagal;
- test di Linux pass, production Windows fail;
- local dev Windows pass, container Linux beda behavior.

Mitigasi:

- gunakan `Locale.ROOT` untuk case normalization logical comparison;
- jangan jadikan extension sebagai security boundary;
- gunakan generated storage name;
- enforce uniqueness di DB dengan normalized key jika perlu;
- test cross-platform untuk library yang expose filename.

Contoh:

```java
String normalizedKey = Normalizer.normalize(name, Normalizer.Form.NFC)
    .toLowerCase(Locale.ROOT);
```

---

## 20. Reserved Names dan Windows-Specific Pitfalls

Di Windows, nama tertentu bermasalah:

```text
CON
PRN
AUX
NUL
COM1..COM9
LPT1..LPT9
```

Juga trailing dot/space dapat menyebabkan confusion:

```text
"file.txt."
"file.txt "
```

Jika aplikasimu cross-platform atau file bisa diexport ke Windows, jangan allow filename bebas.

Allowlist conservative lebih baik.

---

## 21. Percent-Encoding dan Multi-Layer Decoding

Sering ada beberapa layer:

```text
HTTP client
  ↓
reverse proxy
  ↓
framework router
  ↓
controller parameter binding
  ↓
application decoding
```

Payload:

```text
..%2f..%2fsecret.txt
%2e%2e/%2e%2e/secret.txt
..%252fsecret.txt
```

Jika layer berbeda melakukan decoding berbeda, aplikasi bisa salah menilai input.

Rule:

```text
Validate after framework produces final decoded value.
Do not manually decode repeatedly unless you have a strict reason.
Reject suspicious encoded separators at ingress if possible.
```

Lebih baik lagi: jangan menerima path dari user.

---

## 22. Sandbox Boundary

Sandbox filesystem adalah directory root yang aplikasi anggap sebagai batas operasi.

Contoh:

```text
/app/sandbox/job-123/
```

Masalah umum:

- sandbox root relative;
- sandbox root bisa symlink;
- cleanup menghapus path salah;
- job id mengandung path separator;
- archive extraction keluar sandbox;
- symlink dibuat di sandbox lalu operasi follow ke luar;
- sandbox dipakai bersama beberapa tenant.

### 22.1 Sandbox Creation Pattern

```java
public final class Sandbox implements AutoCloseable {
    private final Path rootReal;

    public Sandbox(Path parent) throws IOException {
        Path parentReal = parent.toRealPath();
        Path dir = Files.createTempDirectory(parentReal, "job-");
        this.rootReal = dir.toRealPath();
        if (!rootReal.startsWith(parentReal)) {
            throw new SecurityException("Sandbox escaped parent");
        }
    }

    public Path resolveExisting(String relative) throws IOException {
        Path candidate = resolveLexical(relative);
        Path real = candidate.toRealPath();
        if (!real.startsWith(rootReal)) {
            throw new SecurityException("Path escapes sandbox");
        }
        return real;
    }

    public Path resolveForCreate(String relative) throws IOException {
        Path candidate = resolveLexical(relative);
        Path parent = candidate.getParent();
        if (parent == null) {
            throw new SecurityException("No parent");
        }
        Files.createDirectories(parent);
        Path parentReal = parent.toRealPath();
        if (!parentReal.startsWith(rootReal)) {
            throw new SecurityException("Parent escapes sandbox");
        }
        return candidate;
    }

    private Path resolveLexical(String relative) {
        Path input = Path.of(relative);
        if (input.isAbsolute()) {
            throw new SecurityException("Absolute path not allowed");
        }
        Path candidate = rootReal.resolve(input).normalize();
        if (!candidate.startsWith(rootReal)) {
            throw new SecurityException("Path escapes sandbox lexically");
        }
        return candidate;
    }

    @Override
    public void close() throws IOException {
        deleteRecursivelyNoFollow(rootReal);
    }
}
```

Dalam threat model tinggi, jangan biarkan untrusted process menulis ke sandbox yang kemudian dioperasikan privileged process tanpa protokol ketat.

---

## 23. Delete dan Cleanup Security

Cleanup sering menjadi bug traversal.

Contoh buruk:

```java
Files.walk(Path.of(userProvidedDir))
    .sorted(Comparator.reverseOrder())
    .forEach(Files::delete);
```

Jika `userProvidedDir` salah, aplikasi bisa menghapus area penting.

Cleanup aman harus punya:

```text
- trusted root;
- real path validation;
- no-follow traversal;
- root guard;
- max depth jika perlu;
- logging;
- fail-safe behavior;
```

Contoh:

```java
static void deleteRecursivelyNoFollow(Path root) throws IOException {
    Path realRoot = root.toRealPath(LinkOption.NOFOLLOW_LINKS);

    Files.walkFileTree(realRoot, new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
            Files.delete(file);
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
            if (exc != null) throw exc;
            Files.delete(dir);
            return FileVisitResult.CONTINUE;
        }
    });
}
```

Tambahkan root guard di caller:

```java
if (realRoot.getNameCount() < 3) {
    throw new SecurityException("Refusing to delete shallow root");
}
```

Ini bukan magic number universal, tetapi contoh defensive guard.

---

## 24. Authorization Harus Sebelum Filesystem Access

Path traversal sering bercampur dengan broken authorization.

Contoh:

```text
/download?tenant=tenant-a&file=invoice.pdf
```

Walaupun path containment benar, user tenant-b tidak boleh membaca tenant-a.

Urutan yang benar:

```text
1. Authenticate.
2. Load business object metadata by id.
3. Authorize actor terhadap tenant/case/document.
4. Construct internal path from trusted metadata.
5. Validate real containment.
6. Stream file.
7. Audit access.
```

Jangan sebaliknya:

```text
1. Construct path from request.
2. Read file.
3. Baru cek authorization.
```

---

## 25. Content-Type dan Extension Tidak Sama Dengan Security

Upload `evidence.pdf` bisa berisi:

- HTML;
- JavaScript;
- SVG aktif;
- polyglot file;
- executable;
- ZIP;
- macro document;
- server-side template payload;
- image dengan exploit parser.

Rules:

```text
- extension adalah hint;
- MIME dari client adalah untrusted;
- probeContentType adalah best effort;
- magic number lebih kuat tetapi tetap bukan jaminan penuh;
- rendering file di browser perlu Content-Disposition dan safe headers;
- jangan simpan upload di executable webroot;
- jangan process file dengan parser privileged tanpa sandbox/limit.
```

Untuk download arbitrary upload, sering lebih aman:

```text
Content-Disposition: attachment
X-Content-Type-Options: nosniff
```

Di level Java file storage, intinya: jangan biarkan filename menentukan execution behavior.

---

## 26. Error Handling: Jangan Bocorkan Path Internal

Jangan return:

```json
{
  "error": "Cannot read /var/app/storage/tenant-a/private/admin.txt"
}
```

Lebih baik:

```json
{
  "error": "File not found or access denied"
}
```

Internal log boleh mencatat path dengan sanitasi dan correlation id:

```text
correlationId=abc123 actor=user-1 documentId=doc-9 reason=outside_base
```

Hindari log raw user input tanpa escaping karena bisa menyebabkan log injection atau terminal confusion.

---

## 27. Audit Trail untuk File Access

Untuk sistem enterprise/regulatory, file access harus dapat diaudit.

Minimal audit fields:

```text
actor_id
actor_type
tenant_id
business_object_id
document_id
operation: upload/download/delete/extract/quarantine
result: success/failure/rejected
reason_code
storage_id
original_filename_hash or escaped value
file_size
sha256
client_ip / request id / correlation id
timestamp
```

Jangan mengandalkan path fisik sebagai identitas bisnis. Path bisa berubah saat migration/compaction.

---

## 28. API Design: Jangan Expose Path di Contract

Buruk:

```json
{
  "path": "tenant-a/cases/123/evidence.pdf"
}
```

Lebih baik:

```json
{
  "documentId": "01HXZ...",
  "originalFilename": "evidence.pdf",
  "size": 123456,
  "sha256": "..."
}
```

API internal juga sebaiknya tidak menerima `Path` dari layer controller jika itu berasal dari request.

Better boundary:

```java
public interface DocumentStorage {
    StoredDocument store(TenantId tenant, OriginalFilename filename, InputStream content);
    InputStream open(TenantId tenant, DocumentId documentId);
    void delete(TenantId tenant, DocumentId documentId);
}
```

Bukan:

```java
InputStream open(String path);
```

---

## 29. Defensive Types untuk Path-Sensitive Domain

Buat type kecil agar tidak semua string bisa masuk:

```java
public record TenantId(String value) {
    public TenantId {
        if (!value.matches("[A-Za-z0-9_-]{1,64}")) {
            throw new IllegalArgumentException("Invalid tenant id");
        }
    }
}

public record DocumentId(String value) {
    public DocumentId {
        if (!value.matches("[A-Za-z0-9][A-Za-z0-9_-]{10,80}")) {
            throw new IllegalArgumentException("Invalid document id");
        }
    }
}
```

Untuk Java 8, gunakan final class biasa.

Benefit:

- validasi terpusat;
- tidak mudah tertukar antara tenant/document/path;
- controller tidak langsung memegang filesystem path;
- test lebih jelas.

---

## 30. Framework Integration Pitfalls

### 30.1 Spring MultipartFile

`MultipartFile.getOriginalFilename()` adalah untrusted.

Jangan:

```java
Path target = uploadDir.resolve(file.getOriginalFilename());
file.transferTo(target);
```

Lebih aman:

```java
String original = validateDisplayFilename(file.getOriginalFilename());
String storage = UUID.randomUUID() + ".blob";
Path target = uploadDir.resolve(storage);
try (InputStream in = file.getInputStream()) {
    Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
}
```

Tetapi tetap pakai staging dan atomic move untuk production-grade workflow.

### 30.2 Static Resource Serving

Hati-hati jika upload directory diserve langsung sebagai static resource.

Risiko:

- uploaded HTML dieksekusi browser;
- SVG script;
- content sniffing;
- path exposure;
- caching sensitive file;
- bypass authorization.

Untuk sensitive documents, serve via controller yang melakukan authorization, bukan static file server terbuka.

---

## 31. Common Anti-Patterns

### Anti-pattern 1 — Direct User Path

```java
Files.readString(Path.of(request.getParameter("file")));
```

Masalah: arbitrary file read.

### Anti-pattern 2 — String Prefix Check

```java
if (path.toString().startsWith(base.toString())) { ... }
```

Masalah: `/base_evil` lolos.

### Anti-pattern 3 — Normalize Only

```java
Path p = base.resolve(input).normalize();
Files.readAllBytes(p);
```

Masalah: symlink dan race.

### Anti-pattern 4 — Original Filename as Storage Name

```java
Path target = uploadDir.resolve(originalFilename);
```

Masalah: traversal, overwrite, collision, weird filename.

### Anti-pattern 5 — Extract ZIP Without Containment

```java
Files.copy(zis, dest.resolve(entry.getName()));
```

Masalah: Zip Slip.

### Anti-pattern 6 — Cleanup User Path

```java
deleteRecursively(Path.of(userInput));
```

Masalah: arbitrary deletion.

---

## 32. Better Pattern Matrix

| Use Case | Bad Input | Better Input | Storage Path Source | Required Checks |
|---|---:|---:|---|---|
| Download document | `path` | `documentId` | DB metadata | authz + containment |
| Upload file | original filename as path | original filename as metadata | generated id | size + type + staging |
| Extract archive | entry name direct | entry name validated | staging dir | containment + limits |
| Delete file | path | documentId/jobId | metadata | authz + root guard |
| Template read | path param | template id/name allowlist | configured registry | allowlist + read-only root |
| Tenant directory | tenant name raw | validated tenant id | generated directory | allowlist + root containment |

---

## 33. Case Study: Evidence Upload in Regulatory Case System

Misalkan sistem case management punya evidence upload.

### 33.1 Bad Design

```text
POST /cases/123/evidence
filename = "../../templates/decision-letter.html"
```

Server:

```java
Path target = Path.of("/app/data/cases", caseId, filename);
Files.copy(input, target, REPLACE_EXISTING);
```

Dampak:

- overwrite template;
- arbitrary write;
- escalation ke stored XSS jika file diserve;
- audit record misleading;
- tenant isolation collapse.

### 33.2 Better Design

```text
POST /cases/123/evidence
multipart filename = display metadata only
```

Server:

```text
1. authorize actor can upload evidence to case 123
2. generate document id
3. stream to /storage/tenant-x/staging/{documentId}.tmp
4. size/hash/type validation
5. atomic move to /storage/tenant-x/blobs/ab/cd/{documentId}.blob
6. insert DB row document_id, case_id, original_filename, sha256, size
7. audit UPLOAD_EVIDENCE success
```

Download:

```text
GET /documents/{documentId}
```

Server:

```text
1. load document row
2. authorize actor can view related case
3. resolve storage path from document id
4. containment check
5. stream with safe headers
6. audit DOWNLOAD_EVIDENCE success
```

---

## 34. Java 8 sampai 25 Compatibility Notes

### Java 8

Gunakan:

```java
Paths.get("...")
```

Karena `Path.of` belum ada.

### Java 11+

Bisa gunakan:

```java
Path.of("...")
```

### Java 8–25 Common API

Stabil untuk seri ini:

```text
Path
Paths
Files
LinkOption.NOFOLLOW_LINKS
StandardCopyOption
StandardOpenOption
FileVisitor
SimpleFileVisitor
ZipInputStream
FileSystem
FileSystems
```

### Records

Contoh `record` hanya untuk Java 16+. Untuk Java 8, pakai final class.

---

## 35. Reference Implementation: SecurePathResolver

Berikut utility yang bisa menjadi fondasi, tetapi tetap harus dipakai dengan desain yang benar.

```java
public final class SecurePathResolver {
    private final Path rootReal;

    public SecurePathResolver(Path root) throws IOException {
        this.rootReal = root.toRealPath();
    }

    public Path rootReal() {
        return rootReal;
    }

    public Path resolveExistingRegularFile(String relative) throws IOException {
        Path candidate = resolveLexically(relative);
        Path real = candidate.toRealPath();

        if (!real.startsWith(rootReal)) {
            throw new SecurityException("Path escapes root");
        }

        if (!Files.isRegularFile(real)) {
            throw new SecurityException("Not a regular file");
        }

        return real;
    }

    public Path resolveDirectoryForCreate(String relative) throws IOException {
        Path candidate = resolveLexically(relative);
        Path parent = candidate.getParent();
        if (parent == null) {
            throw new SecurityException("Invalid path");
        }

        Files.createDirectories(parent);
        Path parentReal = parent.toRealPath();
        if (!parentReal.startsWith(rootReal)) {
            throw new SecurityException("Parent escapes root");
        }

        return candidate;
    }

    private Path resolveLexically(String relative) {
        Objects.requireNonNull(relative, "relative");

        Path input = Path.of(relative);
        if (input.isAbsolute()) {
            throw new SecurityException("Absolute path is not allowed");
        }

        Path candidate = rootReal.resolve(input).normalize();
        if (!candidate.startsWith(rootReal)) {
            throw new SecurityException("Path escapes root lexically");
        }

        return candidate;
    }
}
```

Java 8 version:

```java
Path input = Paths.get(relative);
```

bukan:

```java
Path input = Path.of(relative);
```

### 35.1 Limitasi Utility Ini

Utility ini tidak otomatis menyelesaikan:

- symlink race;
- directory yang writable oleh attacker;
- cross-platform case confusion;
- archive entry symlink metadata;
- authorization;
- quota;
- size limit;
- malware scanning;
- content-type validation;
- audit trail.

Security bukan satu class. Security adalah boundary design.

---

## 36. Testing Path Traversal Security

Test input minimal:

```text
../secret.txt
../../secret.txt
./../secret.txt
subdir/../../secret.txt
/etc/passwd
C:\Windows\System32\drivers\etc\hosts
..\..\secret.txt
%2e%2e%2fsecret.txt
file.txt
.file
file.txt.
file.txt 
CON
NUL
very/very/deep/path
```

### 36.1 Unit Test Example

```java
@Test
void rejectsTraversalOutsideRoot() throws Exception {
    Path root = tempDir.resolve("root");
    Files.createDirectories(root);

    SecurePathResolver resolver = new SecurePathResolver(root);

    assertThrows(SecurityException.class,
        () -> resolver.resolveExistingRegularFile("../secret.txt"));
}
```

### 36.2 Symlink Test

```java
@Test
void rejectsSymlinkEscape() throws Exception {
    Path root = tempDir.resolve("root");
    Path outside = tempDir.resolve("outside");
    Files.createDirectories(root);
    Files.createDirectories(outside);
    Files.write(outside.resolve("secret.txt"), List.of("secret"));

    Path link = root.resolve("link");
    Files.createSymbolicLink(link, outside);

    SecurePathResolver resolver = new SecurePathResolver(root);

    assertThrows(SecurityException.class,
        () -> resolver.resolveExistingRegularFile("link/secret.txt"));
}
```

Catatan: symlink test bisa butuh privilege khusus di Windows tergantung environment.

---

## 37. Security Checklist

Sebelum deploy fitur file, jawab:

```text
Input
[ ] Apakah user input dipakai sebagai path? Jika ya, kenapa tidak bisa diganti logical id?
[ ] Apakah absolute path ditolak?
[ ] Apakah path separator, dot segment, dan weird filename ditangani?
[ ] Apakah Unicode/case policy jelas?

Storage
[ ] Apakah storage filename generated server-side?
[ ] Apakah original filename hanya metadata?
[ ] Apakah root path real dan trusted?
[ ] Apakah directory permission mencegah attacker membuat symlink?
[ ] Apakah upload tidak disimpan di executable webroot?

Containment
[ ] Apakah lexical containment dilakukan?
[ ] Apakah real containment dilakukan untuk existing file?
[ ] Apakah symlink escape diuji?
[ ] Apakah create path memvalidasi parent real path?

Archive
[ ] Apakah archive entry absolute path ditolak?
[ ] Apakah entry yang keluar destination ditolak?
[ ] Apakah total size, entry count, depth, dan file size dibatasi?
[ ] Apakah extraction dilakukan ke staging directory?
[ ] Apakah symlink/hardlink archive entry ditangani/reject?

Authorization
[ ] Apakah authz dilakukan berdasarkan business object, bukan path?
[ ] Apakah tenant isolation enforced sebelum filesystem access?
[ ] Apakah audit trail mencatat access?

Response
[ ] Apakah internal path tidak bocor ke response?
[ ] Apakah download memakai safe headers?
[ ] Apakah error message tidak membedakan file missing vs forbidden secara berbahaya?

Operation
[ ] Apakah cleanup punya root guard?
[ ] Apakah failure cleanup tidak menghapus path sembarang?
[ ] Apakah logs aman dari injection?
```

---

## 38. Top 1% Mental Model

Engineer biasa bertanya:

```text
Bagaimana cara menghapus ../ dari path?
```

Engineer matang bertanya:

```text
Kenapa user boleh memberi path?
```

Engineer biasa bertanya:

```text
Apakah sudah pakai normalize()?
```

Engineer matang bertanya:

```text
Apakah object final setelah symlink, mount, provider, dan race masih berada dalam boundary yang diotorisasi?
```

Engineer biasa bertanya:

```text
Apakah upload filename valid?
```

Engineer matang bertanya:

```text
Apakah original filename hanya metadata, storage name server-generated, content dibatasi, hash dihitung, staging atomic, authorization jelas, dan audit trail lengkap?
```

Engineer biasa bertanya:

```text
Bagaimana cara extract ZIP?
```

Engineer matang bertanya:

```text
Apa limit entry count, extracted size, path depth, symlink entry policy, staging strategy, rollback, dan publish semantics?
```

---

## 39. Ringkasan

Path traversal security adalah kombinasi dari:

```text
API discipline
+ path semantics
+ filesystem semantics
+ permission model
+ symlink awareness
+ archive safety
+ authorization design
+ operational guardrails
```

Ingat invariants utama:

```text
1. User input bukan path; user input adalah logical identifier atau display metadata.
2. Storage path dibuat server, bukan user.
3. normalize() berguna tetapi bukan boundary keamanan.
4. toRealPath() lebih kuat tetapi tidak menghapus semua race.
5. Directory yang bisa ditulis attacker tidak boleh dianggap trusted.
6. Archive entry adalah path hostile.
7. Extension dan MIME bukan security guarantee.
8. Authorization harus berbasis objek bisnis, bukan path string.
9. Cleanup harus lebih defensif daripada create/read.
10. File security adalah desain sistem, bukan helper method tunggal.
```

---

## 40. Latihan

### Latihan 1 — Secure Download

Desain endpoint:

```text
GET /cases/{caseId}/documents/{documentId}/download
```

Buat flow yang memastikan:

- user authorized terhadap case;
- document memang milik case;
- tenant sesuai;
- storage path berasal dari DB;
- file berada di bawah storage root;
- response tidak membocorkan absolute path.

### Latihan 2 — Secure Upload

Buat class `DocumentUploadService` yang:

- menerima original filename dan stream;
- menolak filename aneh untuk display;
- generate storage id;
- enforce max 50 MB;
- compute SHA-256;
- write staging;
- atomic move;
- return metadata.

### Latihan 3 — Secure ZIP Extractor

Buat extractor yang:

- extract ke staging directory;
- reject absolute entry;
- reject entry keluar destination;
- limit max 5.000 entries;
- limit total extracted 500 MB;
- limit max depth 20;
- reject suspicious filename;
- cleanup staging on failure.

### Latihan 4 — Symlink Escape Test

Buat test yang menunjukkan:

```text
root/link -> outside
root/link/secret.txt
```

harus ditolak oleh resolver.

---

## 41. Referensi

- Oracle Java SE 25 API — `java.nio.file.Files`, `Path`, `LinkOption`, `FileSystemProvider`.
- Oracle Java SE 8 API — NIO.2 compatibility baseline.
- Oracle Java Tutorials — File I/O, symbolic links, walking file tree, copy/move/delete.
- JDK ZIP filesystem provider documentation — ZIP/JAR as filesystem provider.
- OWASP Path Traversal guidance.
- OWASP File Upload Cheat Sheet.
- CWE-23 Relative Path Traversal.
- CWE-59 Link Following.

---

## 42. Status Seri

Selesai:

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
Part 09 — Delete Semantics: Delete, Recursive Delete, Tombstone, and Safe Cleanup
Part 10 — Directory Listing and Traversal: list, walk, find, DirectoryStream
Part 11 — FileVisitor and Tree Algorithms: Robust Recursive Operations
Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming
Part 13 — Path Traversal Security: User Input, Uploads, Archives, and Sandboxes
```

Berikutnya:

```text
Part 14 — File Attributes: Basic, POSIX, DOS, Owner, ACL
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 12 — Symbolic Links, Hard Links, Junctions, and Link-Safe Programming](./learn-java-io-file-filesystem-storage-engineering-part-12-symbolic-links-hard-links-junctions.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: learn-java-io-file-filesystem-storage-engineering — Part 14](./learn-java-io-file-filesystem-storage-engineering-part-14-file-attributes.md)

</div>