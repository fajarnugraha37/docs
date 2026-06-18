# learn-java-io-file-filesystem-storage-engineering — Part 23
# File Naming, Extension, MIME, Charset, and Content Detection

> Target pembaca: engineer Java yang sudah memahami `Path`, `Files`, traversal, link safety, permission, file capacity, watcher, locking, memory-mapped file, structured binary file, WAL, checksum/hash, dan ingin naik ke level production-grade file intake/export/download design.
>
> Target Java: Java 8 sampai Java 25.
>
> Fokus part ini: membangun mental model bahwa nama file, extension, MIME type, charset, magic number, dan struktur aktual file adalah layer informasi yang berbeda. Bagian ini bukan hanya “cara cek extension”, tetapi cara mendesain keputusan file type yang defensible, aman, portable, observable, dan cocok untuk sistem enterprise/regulatory.

---

## 1. Kenapa Topik Ini Penting

Banyak sistem rusak bukan karena tidak bisa membaca file, tetapi karena salah mempercayai identitas file.

Contoh asumsi lemah:

```text
avatar.png pasti PNG
report.pdf pasti PDF
upload.csv pasti CSV UTF-8
archive.zip pasti aman diekstrak
Content-Type: image/jpeg pasti gambar JPEG
Files.probeContentType(path) pasti benar
```

Di production, semua asumsi itu salah sebagai security boundary.

Sebuah file punya beberapa “identitas” sekaligus:

```text
1. Original filename dari user
2. Display filename setelah sanitization
3. Storage filename internal
4. Extension
5. Claimed MIME type dari client/header
6. MIME type hasil probing Java/OS/provider
7. Magic number / signature byte awal
8. Struktur internal yang dapat diparse
9. Charset jika textual
10. Business classification internal
11. Security status: staged, verified, rejected, quarantined
```

Top-tier engineer tidak bertanya:

```text
Apakah file ini bernama .pdf?
```

Tetapi bertanya:

```text
Untuk keputusan apa saya butuh tahu file ini PDF?
Siapa yang memberi klaim tersebut?
Apakah klaim itu dikontrol user?
Apa konsekuensi jika salah?
Validasi apa yang cukup untuk konsekuensi tersebut?
```

---

## 2. Core Mental Model: Claimed, Inferred, Verified, Trusted

Gunakan empat kategori berikut.

```text
CLAIMED
  Informasi yang diberikan pihak luar.
  Contoh: original filename, extension upload, multipart Content-Type.

INFERRED
  Informasi yang ditebak dari nama, extension, JDK, OS, provider, atau signature sederhana.
  Contoh: Files.probeContentType(path), extension mapping, magic number.

VERIFIED
  Informasi yang dibuktikan dengan validasi format sesuai kebutuhan.
  Contoh: image decoder berhasil membaca header dan dimensi masuk limit; PDF parser bisa membaca struktur; CSV valid UTF-8 dan schema valid.

TRUSTED
  Informasi yang boleh dipakai untuk keputusan sistem karena dibuat internal atau sudah melewati proses verifikasi.
  Contoh: storage filename generated, verified FileKind di DB, sha256 hash, status VERIFIED.
```

Rule utama:

```text
Filename is label.
Extension is hint.
Client MIME is claim.
probeContentType is inference.
Magic number is partial evidence.
Parser validation is stronger evidence.
Business classification is internal truth.
```

---

## 3. Layering Keputusan File Type

Jangan buat satu fungsi generik seperti:

```java
boolean isValidFile(Path file)
```

Itu terlalu miskin konteks. File validity bergantung pada consumer.

Contoh:

```text
Avatar upload:
  Butuh validasi image, dimension limit, pixel count limit, mungkin re-encode.

Evidence document:
  Butuh hash, immutable storage, audit trail, malware scan, preview artifact terpisah.

CSV import:
  Butuh strict charset, schema validation, max row, max field length, transactional import.

ZIP import:
  Butuh entry path validation, decompressed size limit, compression ratio limit, symlink entry policy.

Internal generated report:
  Bisa lebih dipercaya, tetapi tetap perlu metadata, content type benar, dan hash jika audit penting.
```

Desain yang benar adalah validator per flow:

```text
AvatarValidator
EvidenceDocumentValidator
CsvImportValidator
ArchiveImportValidator
GeneratedExportPolicy
```

---

## 4. Original Filename vs Storage Filename

Boundary paling penting:

```text
Original filename = metadata dari user/client.
Storage filename  = nama internal yang dibuat sistem.
```

Anti-pattern:

```java
Path target = uploadDir.resolve(originalFilename);
Files.copy(inputStream, target);
```

Masalah:

```text
- path traversal
- overwrite file lain
- collision antar user
- reserved Windows name
- Unicode spoofing
- control character/log injection
- double extension spoofing
- panjang nama berlebihan
- disclosure informasi sensitif lewat nama
```

Pattern lebih aman:

```java
String displayName = SafeFilenames.sanitizeDisplayFilename(originalFilename);
String storageName = UUID.randomUUID() + ".blob";
Path target = uploadRoot.resolve(storageName);
```

Simpan metadata:

```text
id
original_filename_raw, jika perlu audit dan disimpan hati-hati
display_filename sanitized
storage_filename generated
claimed_content_type
probed_content_type
verified_kind
size_bytes
sha256_hex
status
created_at
uploader
```

Invariant:

```text
Nama dari user tidak pernah menentukan final storage path.
```

---

## 5. Safe Display Filename Policy

Sanitization display filename bukan security boundary untuk path. Tujuannya hanya membuat nama aman ditampilkan, dilog, dan dipakai di download header setelah encoding yang benar.

Policy defensif:

```text
1. Ambil segment terakhir saja, bukan path.
2. Normalize Unicode ke NFC.
3. Trim whitespace.
4. Reject/replace control characters.
5. Reject/replace slash dan backslash.
6. Jangan izinkan U+0000 / null byte.
7. Limit panjang.
8. Hindari trailing dot/space.
9. Hindari reserved Windows device names.
10. Jika kosong, gunakan fallback seperti unnamed.
```

Contoh Java modern. Untuk Java 8, ganti `Set.of` dengan `new HashSet<>(Arrays.asList(...))`.

```java
import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;

public final class SafeFilenames {
    private static final int MAX_DISPLAY_NAME_LENGTH = 180;

    private static final Set<String> WINDOWS_RESERVED = Set.of(
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    );

    private SafeFilenames() {}

    public static String sanitizeDisplayFilename(String input) {
        if (input == null) {
            return "unnamed";
        }

        String name = input.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }

        name = Normalizer.normalize(name, Normalizer.Form.NFC).trim();

        StringBuilder out = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (c == 0 || Character.isISOControl(c) || c == '/' || c == '\\') {
                out.append('_');
            } else {
                out.append(c);
            }
        }

        name = out.toString().trim();
        while (name.endsWith(".") || name.endsWith(" ")) {
            name = name.substring(0, name.length() - 1).trim();
        }

        if (name.isEmpty()) {
            name = "unnamed";
        }

        String base = name;
        int dot = base.indexOf('.');
        if (dot >= 0) {
            base = base.substring(0, dot);
        }
        if (WINDOWS_RESERVED.contains(base.toUpperCase(Locale.ROOT))) {
            name = "_" + name;
        }

        if (name.length() > MAX_DISPLAY_NAME_LENGTH) {
            name = name.substring(0, MAX_DISPLAY_NAME_LENGTH);
        }

        return name;
    }
}
```

Penting:

```text
Sanitized display filename tetap tidak boleh dipakai sebagai storage filename.
```

---

## 6. Extension Parsing: Jangan Terlalu Polos

Edge case:

```text
file.txt
archive.tar.gz
.profile
README
invoice.
photo.JPG
invoice.pdf.exe
report.final.v2.pdf
```

Pertanyaan policy:

```text
Apakah .tar.gz dianggap satu extension?
Apakah .profile punya extension?
Apakah trailing dot valid?
Apakah extension case-sensitive?
Apakah multiple extension diizinkan?
```

Parser konservatif:

```java
import java.util.Locale;
import java.util.Optional;

public final class Extensions {
    private Extensions() {}

    public static Optional<String> lastExtensionLowercase(String filename) {
        if (filename == null) {
            return Optional.empty();
        }

        String name = filename.trim();
        if (name.isEmpty()) {
            return Optional.empty();
        }

        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }

        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) {
            return Optional.empty();
        }

        return Optional.of(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }
}
```

Extension allowlist hanya sinyal awal:

```java
private static final Set<String> ALLOWED = Set.of("pdf", "png", "jpg", "jpeg", "csv");

boolean allowedByExtension = Extensions.lastExtensionLowercase(displayName)
        .filter(ALLOWED::contains)
        .isPresent();
```

Extension bukan bukti isi.

---

## 7. Double Extension dan Dangerous Final Extension

Double extension sering dipakai untuk spoofing:

```text
avatar.jpg.php
invoice.pdf.exe
report.docx.scr
payload.png.html
```

Policy:

```text
- Tentukan extension allowed per business flow.
- Reject dangerous final extension.
- Jangan publish upload ke directory yang dieksekusi web server.
- Jangan gunakan extension untuk menentukan apakah file aman dieksekusi.
```

Contoh:

```java
private static final Set<String> DANGEROUS_FINAL_EXTENSIONS = Set.of(
        "exe", "dll", "bat", "cmd", "ps1", "sh", "jar", "war",
        "jsp", "php", "asp", "aspx", "js", "html", "htm", "svg"
);

public static boolean hasDangerousFinalExtension(String filename) {
    return Extensions.lastExtensionLowercase(filename)
            .filter(DANGEROUS_FINAL_EXTENSIONS::contains)
            .isPresent();
}
```

Catatan: SVG bisa menjadi format gambar, tetapi juga dapat menjadi active content tergantung cara disajikan. Treat SVG as high-risk unless sanitized and served safely.

---

## 8. MIME Type: Claimed vs Probed vs Verified

MIME type bisa berasal dari:

```text
1. HTTP Content-Type header dari client
2. multipart part header
3. extension mapping
4. OS/JDK probing
5. magic number detector
6. parser-specific validation
7. metadata internal setelah verifikasi
```

Sumber paling lemah adalah client-provided `Content-Type`. OWASP menegaskan content type dari upload dapat dipalsukan dan tidak boleh dipercaya sebagai satu-satunya validasi.

MIME yang lebih aman adalah MIME yang berasal dari verified business classification, misalnya:

```text
verified_kind = PDF_DOCUMENT
served_content_type = application/pdf
```

Bukan:

```text
served_content_type = user_supplied_content_type
```

---

## 9. `Files.probeContentType(Path)`

Java menyediakan:

```java
String type = Files.probeContentType(path);
```

Mental model:

```text
probeContentType(path)
  meminta JDK/file type detector/provider/OS menebak content type
  dapat return MIME string
  dapat return null
  dapat berbeda antar OS/JDK/provider
  dapat berbasis extension, content, atau mechanism lain
  bukan security oracle
```

Gunakan sebagai signal:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

public final class MimeProbe {
    private MimeProbe() {}

    public static Optional<String> probe(Path path) throws IOException {
        return Optional.ofNullable(Files.probeContentType(path));
    }
}
```

Decision rule:

```text
Jika probe null, jangan panik; lanjutkan validator lain.
Jika probe mismatch, jangan langsung percaya salah satu; gunakan parser/magic/business validator.
Jika probe sesuai, tetap bukan bukti final.
```

---

## 10. Magic Number: Lebih Kuat dari Extension, Tapi Belum Final

Signature umum:

```text
PDF   : %PDF-
PNG   : 89 50 4E 47 0D 0A 1A 0A
JPEG  : FF D8 FF
GIF   : GIF87a / GIF89a
ZIP   : 50 4B 03 04 atau variasi PK
GZIP  : 1F 8B
```

Contoh checker:

```java
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class MagicNumbers {
    private MagicNumbers() {}

    public static boolean looksLikePdf(Path path) throws IOException {
        return startsWith(readPrefix(path, 5), "%PDF-".getBytes(StandardCharsets.US_ASCII));
    }

    public static boolean looksLikePng(Path path) throws IOException {
        byte[] png = new byte[] {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
        return startsWith(readPrefix(path, png.length), png);
    }

    public static boolean looksLikeJpeg(Path path) throws IOException {
        byte[] jpg = new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
        return startsWith(readPrefix(path, jpg.length), jpg);
    }

    private static byte[] readPrefix(Path path, int n) throws IOException {
        byte[] buf = new byte[n];
        int off = 0;
        try (InputStream in = Files.newInputStream(path)) {
            while (off < n) {
                int r = in.read(buf, off, n - off);
                if (r < 0) break;
                off += r;
            }
        }
        if (off == n) return buf;
        byte[] shorter = new byte[off];
        System.arraycopy(buf, 0, shorter, 0, off);
        return shorter;
    }

    private static boolean startsWith(byte[] actual, byte[] expected) {
        if (actual.length < expected.length) return false;
        for (int i = 0; i < expected.length; i++) {
            if (actual[i] != expected[i]) return false;
        }
        return true;
    }
}
```

Batas magic number:

```text
- PDF dengan prefix %PDF- bisa tetap corrupt.
- ZIP signature juga dipakai DOCX/XLSX/JAR/APK/ODT.
- Polyglot file bisa valid sebagai lebih dari satu format.
- Magic number tidak membuktikan file bebas payload aktif.
```

---

## 11. Container Formats: ZIP-Like Tidak Sama Dengan ZIP Aman

Banyak format adalah ZIP container:

```text
.docx
.xlsx
.pptx
.jar
.war
.ear
.apk
.odt
.ods
```

Signature `PK` hanya mengatakan “mungkin ZIP-like”. Untuk validasi lebih kuat:

```text
DOCX:
  [Content_Types].xml ada
  word/document.xml ada
  rels valid
  entry path aman
  total uncompressed size dibatasi

JAR:
  manifest policy jelas
  jangan load/execute dari upload untrusted

ZIP import:
  semua entry path aman
  tidak ada Zip Slip
  tidak ada symlink berbahaya
  compression ratio dibatasi
```

---

## 12. Charset: Text File Tidak Otomatis UTF-8

Masalah umum:

```text
CSV dikirim Windows-1252 tetapi dibaca UTF-8.
File diklaim UTF-8 tetapi byte invalid.
Header CSV mengandung BOM.
Default charset OS berbeda antar environment.
File besar dibaca seluruhnya tanpa limit.
```

Rule:

```text
Untuk text ingestion, charset harus eksplisit.
Untuk format yang mensyaratkan UTF-8, gunakan strict decoder.
Untuk best-effort viewer, replacement bisa diterima.
```

Strict UTF-8 reader dengan limit:

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class StrictUtf8Reader {
    private StrictUtf8Reader() {}

    public static String readUtf8Strict(Path path, long maxChars) throws IOException {
        var decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);

        StringBuilder sb = new StringBuilder();
        long count = 0;

        try (var in = Files.newInputStream(path);
             var r = new InputStreamReader(in, decoder);
             var br = new BufferedReader(r)) {
            char[] buf = new char[8192];
            int n;
            while ((n = br.read(buf)) != -1) {
                count += n;
                if (count > maxChars) {
                    throw new IOException("Text file exceeds max character limit: " + maxChars);
                }
                sb.append(buf, 0, n);
            }
        } catch (CharacterCodingException e) {
            throw new IOException("File is not valid strict UTF-8", e);
        }

        return sb.toString();
    }
}
```

Java 8 note: `var` tidak tersedia; tulis tipe eksplisit.

---

## 13. BOM: Byte Order Mark

BOM umum:

```text
UTF-8 BOM     EF BB BF
UTF-16 BE     FE FF
UTF-16 LE     FF FE
UTF-32 BE     00 00 FE FF
UTF-32 LE     FF FE 00 00
```

Bug umum:

```text
CSV header menjadi "BOM+id" bukan "id".
First token JSON/XML terganggu.
Schema matching gagal.
```

Detector sederhana:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

public final class BomDetector {
    private BomDetector() {}

    public static Optional<String> detectBom(Path path) throws IOException {
        byte[] b = new byte[4];
        int n;
        try (var in = Files.newInputStream(path)) {
            n = in.read(b);
        }

        if (n >= 3 && (b[0] & 0xFF) == 0xEF && (b[1] & 0xFF) == 0xBB && (b[2] & 0xFF) == 0xBF) {
            return Optional.of("UTF-8-BOM");
        }
        if (n >= 2 && (b[0] & 0xFF) == 0xFE && (b[1] & 0xFF) == 0xFF) {
            return Optional.of("UTF-16BE-BOM");
        }
        if (n >= 2 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xFE) {
            if (n >= 4 && b[2] == 0x00 && b[3] == 0x00) {
                return Optional.of("UTF-32LE-BOM");
            }
            return Optional.of("UTF-16LE-BOM");
        }
        if (n >= 4 && b[0] == 0x00 && b[1] == 0x00 && (b[2] & 0xFF) == 0xFE && (b[3] & 0xFF) == 0xFF) {
            return Optional.of("UTF-32BE-BOM");
        }
        return Optional.empty();
    }
}
```

---

## 14. Text vs Binary Heuristic

Kadang dibutuhkan klasifikasi kasar: text atau binary. Ini bukan security boundary.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class TextBinaryHeuristic {
    private TextBinaryHeuristic() {}

    public static boolean looksBinary(Path path, int sampleSize) throws IOException {
        byte[] sample = new byte[sampleSize];
        int n;
        try (var in = Files.newInputStream(path)) {
            n = in.read(sample);
        }
        if (n <= 0) return false;

        int suspicious = 0;
        for (int i = 0; i < n; i++) {
            int b = sample[i] & 0xFF;
            if (b == 0) return true;
            boolean allowedControl = b == '\n' || b == '\r' || b == '\t' || b == '\f';
            if (b < 32 && !allowedControl) suspicious++;
        }
        return suspicious > n / 20;
    }
}
```

Use case:

```text
- viewer memilih mode text/binary
- diagnostic tooling
- import pre-check ringan
```

Bukan untuk:

```text
- security accept/reject final
- parser selection final
```

---

## 15. Content Detection Pipeline yang Aman

Pipeline upload yang defensible:

```text
Receive upload stream
  ↓
Enforce max request size at HTTP/reverse proxy/framework layer
  ↓
Write to staging using generated internal name
  ↓
Compute size and hash while streaming
  ↓
Sanitize original filename for display only
  ↓
Extract extension as weak signal
  ↓
Probe MIME as weak signal
  ↓
Read magic number
  ↓
Run format-specific validator with resource limits
  ↓
Optional malware scan / CDR / sandboxing
  ↓
Persist classification result
  ↓
Atomic publish to verified storage or quarantine
```

Invariant:

```text
Unverified file never enters trusted/published area.
Downstream code never re-derives trust from extension.
```

---

## 16. Internal FileKind Model

Jangan pakai MIME string mentah di seluruh domain. Buat enum internal:

```java
public enum FileKind {
    PDF_DOCUMENT,
    PNG_IMAGE,
    JPEG_IMAGE,
    ZIP_ARCHIVE,
    CSV_UTF8,
    UNKNOWN,
    REJECTED
}
```

Classifier awal:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

public final class FileClassifier {
    private FileClassifier() {}

    public static FileKind classify(Path path, String originalFilename, String claimedContentType) throws IOException {
        Optional<String> ext = Extensions.lastExtensionLowercase(originalFilename);
        Optional<String> probed = Optional.ofNullable(Files.probeContentType(path));

        if (ext.filter("pdf"::equals).isPresent() && MagicNumbers.looksLikePdf(path)) {
            return FileKind.PDF_DOCUMENT;
        }
        if (ext.filter("png"::equals).isPresent() && MagicNumbers.looksLikePng(path)) {
            return FileKind.PNG_IMAGE;
        }
        if (ext.filter(e -> e.equals("jpg") || e.equals("jpeg")).isPresent() && MagicNumbers.looksLikeJpeg(path)) {
            return FileKind.JPEG_IMAGE;
        }
        if (ext.filter("csv"::equals).isPresent()) {
            return FileKind.CSV_UTF8;
        }

        return FileKind.UNKNOWN;
    }
}
```

Classifier ini belum final. Tambahkan validator:

```text
PDF_DOCUMENT → PDF parser validation, page/resource limit, encrypted policy
PNG/JPEG     → image reader header, dimension/pixel limit, maybe re-encode
CSV_UTF8     → strict UTF-8, schema/header validation, row/field limit
ZIP_ARCHIVE  → entry safety, decompressed size limit, compression ratio limit
```

---

## 17. Image Validation

Magic number tidak cukup untuk image.

Minimal image policy:

```text
- file size limit
- allowed extension
- magic number
- decoder can read format
- width/height limit
- pixel count limit
- optional metadata stripping
- optional re-encode to safe target format
```

Contoh validasi header dengan ImageIO:

```java
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Iterator;

public final class ImageValidator {
    private ImageValidator() {}

    public static ImageInfo validateImageHeader(Path path, int maxWidth, int maxHeight, long maxPixels) throws IOException {
        try (ImageInputStream iis = ImageIO.createImageInputStream(path.toFile())) {
            if (iis == null) throw new IOException("Cannot open image input stream");

            Iterator<ImageReader> readers = ImageIO.getImageReaders(iis);
            if (!readers.hasNext()) throw new IOException("Unsupported or invalid image format");

            ImageReader reader = readers.next();
            try {
                reader.setInput(iis, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                long pixels = Math.multiplyExact((long) width, (long) height);

                if (width <= 0 || height <= 0 || width > maxWidth || height > maxHeight || pixels > maxPixels) {
                    throw new IOException("Image dimensions exceed limits: " + width + "x" + height);
                }
                return new ImageInfo(reader.getFormatName(), width, height);
            } finally {
                reader.dispose();
            }
        }
    }

    public static final class ImageInfo {
        public final String format;
        public final int width;
        public final int height;

        public ImageInfo(String format, int width, int height) {
            this.format = format;
            this.width = width;
            this.height = height;
        }
    }
}
```

---

## 18. CSV Validation

CSV bukan sekadar `.csv`. CSV adalah text + delimiter rules + schema.

Minimal policy:

```text
- max file size
- strict charset
- BOM handling
- expected header
- max row count
- max column count
- max field length
- schema validation per column
- formula injection control jika diekspor ulang ke spreadsheet
```

CSV import yang baik biasanya punya state:

```text
STAGED
VALIDATING
VALIDATION_FAILED
READY_TO_IMPORT
IMPORTING
IMPORTED
PARTIALLY_IMPORTED
REJECTED
```

Jangan langsung mengubah data domain saat file belum tervalidasi.

---

## 19. PDF Validation

PDF signature `%PDF-` bukan cukup.

Policy sesuai risiko:

```text
- max file size
- signature check
- parser can open document
- page count limit
- encrypted PDF allowed atau tidak
- embedded files allowed atau tidak
- JavaScript/action allowed atau tidak
- preview dibuat sebagai derived artifact
- original bytes immutable + sha256 hash
```

Untuk sistem regulatory/case management:

```text
Original evidence file should be immutable.
Preview/search text is derived data.
Preview failure must not mutate original evidence.
Hash is part of evidentiary chain.
```

---

## 20. Secure Serving and MIME Sniffing

Upload security tidak selesai saat file diterima. Download/preview juga penting.

Untuk file untrusted:

```text
Content-Disposition: attachment
X-Content-Type-Options: nosniff
Content-Type: application/octet-stream atau verified safe MIME
Jangan serve dari origin utama aplikasi jika bisa dihindari
Jangan inline render raw upload berisiko tinggi
```

Untuk preview:

```text
- buat preview artifact hasil transformasi/sanitasi
- gunakan sandbox viewer bila perlu
- jangan berikan cookie/session sensitif ke domain static untrusted
```

---

## 21. Unicode, Case, dan Cross-Platform Filename

Unicode edge cases:

```text
résumé.pdf
résumé.pdf    // terlihat mirip, code point berbeda
аdmin.pdf       // huruf Cyrillic 'а', bukan Latin 'a'
filename with CRLF
```

Case issue:

```text
Linux: Report.pdf dan report.pdf biasanya berbeda
Windows: biasanya case-insensitive tetapi case-preserving
macOS: bergantung filesystem/configuration
```

Portable rules:

```text
- normalize display name ke NFC
- gunakan Locale.ROOT untuk lowercase/uppercase teknis
- jangan storage berdasarkan nama user
- jangan security policy bergantung pada case-sensitive behavior
```

Contoh:

```java
String ext = extension.toLowerCase(Locale.ROOT);
```

Bukan:

```java
String ext = extension.toLowerCase();
```

---

## 22. Reserved Names dan Invalid Characters

Windows reserved device names:

```text
CON, PRN, AUX, NUL,
COM1..COM9,
LPT1..LPT9
```

Karakter bermasalah Windows:

```text
< > : " / \ | ? *
```

Unix lebih permisif, tetapi slash `/` dan null byte tetap fundamental.

Rule:

```text
Untuk storage internal, generate name.
Untuk display, sanitize.
Untuk ZIP entry, validate path secara terpisah.
Untuk download header, encode secara benar.
```

---

## 23. Storage Extension: Pakai atau Tidak?

### Strategy A — Extensionless/blob

```text
8f2c3a9e-81fd-4c3f-9d7d-b0cb4c6e3e9f.blob
```

Kelebihan:

```text
- invariant sederhana
- tidak bergantung user extension
- mengurangi accidental execution
```

Kekurangan:

```text
- debugging manual kurang nyaman
- OS tools tidak otomatis tahu tipe
```

### Strategy B — Extension berdasarkan verified type

```text
8f2c3a9e-81fd-4c3f-9d7d-b0cb4c6e3e9f.pdf
```

Rule:

```text
Jika internal storage memakai extension, extension harus berasal dari verified classification, bukan original filename.
```

---

## 24. Download Filename dan Header Safety

Jangan concat raw filename ke header.

Risiko:

```text
- CRLF injection
- quote escaping bug
- non-ASCII incompatibility
- browser-specific behavior
```

Minimal fallback:

```java
public static String asciiFallbackFilename(String displayName) {
    String safe = SafeFilenames.sanitizeDisplayFilename(displayName);
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < safe.length(); i++) {
        char c = safe.charAt(i);
        if (c >= 0x20 && c <= 0x7E && c != '"' && c != '\\' && c != ';') {
            out.append(c);
        } else {
            out.append('_');
        }
    }
    return out.length() == 0 ? "download" : out.toString();
}
```

Untuk production HTTP, gunakan framework/library yang mendukung `filename*` encoding sesuai RFC. Jangan raw-concat user input.

---

## 25. Polyglot File dan Parser Differential

Polyglot file dapat dibuat agar tampak valid sebagai lebih dari satu format.

Parser differential terjadi saat:

```text
Browser menerima file sebagai tipe A.
Backend library membaca sebagai tipe B.
Antivirus membaca embedded format C.
OS shell memperlakukan extension sebagai tipe D.
```

Implikasi:

```text
Validasi harus mengikuti consumer paling berisiko.
Jika browser akan consume, pikirkan browser behavior.
Jika backend parser akan consume, validasi sesuai parser backend.
Jika file akan diekstrak, validasi archive semantics.
Jika file hanya disimpan sebagai evidence, fokus immutable storage + hash + safe serving.
```

---

## 26. Detection Result Harus Menyimpan Evidence

Hindari boolean miskin konteks:

```java
boolean valid = isPdf(file);
```

Lebih baik:

```java
public final class FileDetectionResult {
    public final FileKind kind;
    public final boolean accepted;
    public final String reason;
    public final String extension;
    public final String claimedMime;
    public final String probedMime;
    public final String magicSignature;

    public FileDetectionResult(
            FileKind kind,
            boolean accepted,
            String reason,
            String extension,
            String claimedMime,
            String probedMime,
            String magicSignature
    ) {
        this.kind = kind;
        this.accepted = accepted;
        this.reason = reason;
        this.extension = extension;
        this.claimedMime = claimedMime;
        this.probedMime = probedMime;
        this.magicSignature = magicSignature;
    }
}
```

Manfaat:

```text
- audit kuat
- troubleshooting mudah
- security review lebih jelas
- reject reason bisa dikontrol
- metric bisa detail
```

---

## 27. Observability

Metric yang berguna:

```text
file_upload_total{status,kind}
file_rejected_total{reason}
file_probe_null_total
file_magic_mismatch_total
file_charset_invalid_total
file_parser_failure_total{parser,reason}
file_quarantine_total{reason}
file_validation_duration_seconds{kind,validator}
file_size_bytes{kind}
```

Structured log contoh:

```json
{
  "event": "file_upload_classified",
  "uploadId": "upl_123",
  "originalNameSanitized": "report.pdf",
  "sizeBytes": 918273,
  "sha256": "...",
  "extension": "pdf",
  "claimedMime": "application/pdf",
  "probedMime": "application/pdf",
  "kind": "PDF_DOCUMENT",
  "status": "VERIFIED"
}
```

Jangan log raw filename tanpa escaping. Filename bisa mengandung newline/control character.

---

## 28. Failure Matrix

| Failure | Penyebab | Handling |
|---|---|---|
| Extension allowed, magic mismatch | Spoofed file | Reject/quarantine |
| MIME null | Detector tidak tahu | Lanjut magic/parser; jangan otomatis trust |
| MIME mismatch | Client spoof/probe beda | Pakai parser validator final |
| Charset invalid | Encoding tidak sesuai | Reject atau minta upload ulang |
| BOM unexpected | Source tool menambahkan BOM | Strip/handle sesuai format |
| Parser timeout/too large | Resource abuse/bomb | Reject/quarantine, enforce limits |
| Filename invalid | User input buruk | Sanitize display atau reject |
| Double extension dangerous | Spoofing | Reject/high-risk review |
| Archive entry unsafe | Zip Slip | Reject archive |
| Download filename unsafe | Header injection | Sanitize/encode header |

---

## 29. Architecture Pattern

```text
UploadController
  receives stream and claimed metadata
  ↓
StagingWriter
  generated storage name, max size, hash
  ↓
FilenamePolicy
  sanitize display filename, extract extension
  ↓
ContentProbe
  Files.probeContentType + magic number
  ↓
FormatValidator
  PDF/Image/CSV/ZIP specific validator
  ↓
SecurityScanner optional
  malware scan/CDR/domain-specific policy
  ↓
FileRegistry
  persist metadata and validation result
  ↓
StoragePublisher
  atomic move verified file to final location
  ↓
DownloadService
  safe headers, safe content disposition, no sniff
```

Core invariant:

```text
Only FileRegistry decides trusted business kind.
No downstream code re-derives trust from filename.
```

---

## 30. Java 8–25 Compatibility Notes

| Feature | Java 8 | Java 9+ / 11+ / 25 |
|---|---|---|
| `Files.probeContentType` | Ada | Ada |
| `Path.of` | Tidak ada | Ada sejak Java 11; Java 25 docs merekomendasikannya dibanding `Paths.get` |
| `Paths.get` | Ada | Masih ada |
| `Set.of` | Tidak ada | Ada sejak Java 9 |
| `record` | Tidak ada | Ada sejak Java 16 |
| `Files.readString` | Tidak ada | Ada sejak Java 11 |
| `CRC32C` | Tidak ada | Ada sejak Java 9 |

Java 8 style:

```java
Path p = Paths.get("/data/uploads/file.pdf");
Set<String> allowed = new HashSet<>(Arrays.asList("pdf", "png", "jpg"));
```

Java 11+ style:

```java
Path p = Path.of("/data/uploads/file.pdf");
Set<String> allowed = Set.of("pdf", "png", "jpg");
```

---

## 31. Anti-Patterns

### Anti-pattern 1 — Trust extension

```java
if (filename.endsWith(".pdf")) accept();
```

### Anti-pattern 2 — Trust client MIME

```java
if (part.getContentType().equals("image/png")) accept();
```

### Anti-pattern 3 — Store using original filename

```java
Files.copy(input, uploadDir.resolve(originalFilename));
```

### Anti-pattern 4 — Inline render untrusted upload

```text
Serve raw upload from same origin as main app with guessed content type.
```

### Anti-pattern 5 — One generic validator for all file flows

```java
FileValidator.isValid(file)
```

---

## 32. Design Checklist

```text
1. Apakah file berasal dari user, internal system, atau trusted integration?
2. Apakah original filename hanya metadata?
3. Apakah storage filename digenerate sistem?
4. Apakah extension hanya hint?
5. Apakah client MIME tidak dipercaya?
6. Apakah Files.probeContentType dipakai hanya sebagai signal?
7. Apakah ada magic number check untuk format binary?
8. Apakah ada parser validation untuk format penting?
9. Apakah text file dibaca dengan charset eksplisit?
10. Apakah invalid charset ditangani jelas?
11. Apakah BOM dipertimbangkan?
12. Apakah ada size/row/dimension/entry/decompression limit?
13. Apakah unverified file masuk staging/quarantine dulu?
14. Apakah hasil classification disimpan sebagai metadata internal?
15. Apakah download header aman?
16. Apakah untrusted file tidak di-inline sembarangan?
17. Apakah observability menangkap reason reject?
```

---

## 33. Summary

Yang harus melekat:

```text
Filename is label.
Extension is hint.
Client MIME is claim.
probeContentType is inference.
Magic number is partial evidence.
Parser validation is stronger evidence.
Business classification is internal truth.
```

Pisahkan selalu:

```text
what the user says the file is
what the OS/JDK guesses the file is
what bytes suggest the file is
what parser proves the file is
what the business accepts the file as
```

Jika semua layer itu dicampur, sistem upload/import/download akan tampak bekerja di happy path, tetapi rapuh terhadap spoofing, parser bugs, platform differences, browser sniffing, archive attacks, dan incident security.

---

## Referensi

- Java SE 25 `java.nio.file.Files`, termasuk `probeContentType(Path)` dan fakta bahwa operasi file umumnya didelegasikan ke filesystem provider: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html
- Java SE 8 `java.nio.file.Files`, kompatibilitas `probeContentType`: https://docs.oracle.com/javase/8/docs/api/java/nio/file/Files.html
- Java SE 8 `Path`, `getFileName` sebagai elemen terjauh dari root: https://docs.oracle.com/javase/8/docs/api/java/nio/file/Path.html
- Java SE 25 `CharsetDecoder`, malformed/unmappable input dan `CodingErrorAction`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/charset/CharsetDecoder.html
- Java SE 8 `MalformedInputException`: https://docs.oracle.com/javase/8/docs/api/java/nio/charset/MalformedInputException.html
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP Unrestricted File Upload: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload

---

## Status Series

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
Part 14 — File Attributes: Basic, POSIX, DOS, Owner, ACL
Part 15 — Permissions Model: POSIX, Windows ACL, Containers, and Runtime Identity
Part 16 — FileStore and Filesystem Capacity: Disk Space, Quotas, and Operational Guardrails
Part 17 — WatchService: Filesystem Events Are Hints, Not Truth
Part 18 — File Locking: Advisory, Mandatory, Local, Network, and Cross-Process Coordination
Part 19 — Memory-Mapped Files in File Workflows
Part 20 — Random Access and Structured Binary File Layout
Part 21 — Append-Only Files, WAL, Journaling, and Recovery Design
Part 22 — Checksums, Hashes, Integrity, and Deduplication
Part 23 — File Naming, Extension, MIME, Charset, and Content Detection
```

Berikutnya:

```text
Part 24 — Archives and Virtual Filesystems: ZIP FileSystem and JAR-Like Access
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — Checksums, Hashes, Integrity, and Deduplication](./learn-java-io-file-filesystem-storage-engineering-part-22-checksums-hashes-integrity-deduplication.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 24 — Archives and Virtual Filesystems: ZIP FileSystem and JAR-Like Access](./learn-java-io-file-filesystem-storage-engineering-part-24-archives-virtual-filesystems.md)
