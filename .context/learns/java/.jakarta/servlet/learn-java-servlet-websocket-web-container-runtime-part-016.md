# learn-java-servlet-websocket-web-container-runtime-part-016

# Part 016 — Multipart Upload, File Download, and Large Payload Handling

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita sudah membahas:

- request object internals,
- response object internals,
- servlet mapping,
- dispatching,
- filter,
- listener,
- `ServletContext`,
- session,
- cookie/browser boundary,
- async servlet,
- non-blocking I/O.

Sekarang kita masuk ke salah satu area yang tampak sederhana tetapi sering menjadi sumber incident produksi: **file upload, file download, dan large payload handling**.

Banyak engineer memperlakukan upload/download sebagai operasi teknis biasa:

```java
Part file = request.getPart("file");
file.write(file.getSubmittedFileName());
```

atau:

```java
Files.copy(path, response.getOutputStream());
```

Kode seperti itu bisa bekerja di lokal, tetapi belum tentu aman, scalable, observable, dan resilient di produksi.

Di sistem nyata, upload/download adalah boundary besar antara:

```text
untrusted client
  -> browser/mobile/API client
  -> CDN/WAF/API gateway/reverse proxy
  -> servlet connector
  -> multipart parser
  -> temp disk / memory buffer
  -> application validation
  -> antivirus / malware scanning
  -> object storage / DB / filesystem
  -> audit / metadata / authorization
```

Untuk download:

```text
storage / generated file
  -> application authorization
  -> metadata resolution
  -> response headers
  -> streaming
  -> connector buffer
  -> reverse proxy buffer
  -> browser behavior
  -> partial download / resume / cache
```

Mental model pentingnya: **file transfer bukan cuma baca/tulis byte; file transfer adalah protocol boundary, resource allocation, security boundary, dan failure boundary.**

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kita ingin bisa:

1. Memahami bagaimana Servlet menangani `multipart/form-data`.
2. Membedakan request parameter biasa, multipart field, dan file part.
3. Mengerti `@MultipartConfig`, `Part`, `getPart()`, `getParts()`, temp storage, threshold, dan size limit.
4. Mendesain upload flow yang aman:
   - filename sanitization,
   - content type validation,
   - extension validation,
   - size validation,
   - path traversal prevention,
   - temp cleanup,
   - malware scanning boundary.
5. Mendesain download flow yang benar:
   - `Content-Type`,
   - `Content-Length`,
   - `Content-Disposition`,
   - `ETag`,
   - `Cache-Control`,
   - range request,
   - partial content,
   - client abort.
6. Memahami large payload handling:
   - buffering vs streaming,
   - memory pressure,
   - temp disk pressure,
   - proxy/container/application limits,
   - timeout alignment.
7. Membuat failure model produksi untuk upload/download.
8. Membuat checklist engineering yang bisa digunakan sebelum merilis fitur file transfer.

---

## 2. Mental Model: File Transfer Sebagai State Machine

Upload bukan satu operasi atomik. Upload lebih tepat dilihat sebagai state machine.

```text
CLIENT_SELECTS_FILE
  -> CLIENT_SENDS_MULTIPART_REQUEST
  -> PROXY_ACCEPTS_OR_REJECTS_BODY
  -> CONTAINER_ACCEPTS_CONNECTION
  -> CONTAINER_READS_REQUEST_BODY
  -> MULTIPART_PARSER_SPLITS_PARTS
  -> PARTS_BUFFERED_TO_MEMORY_OR_DISK
  -> APPLICATION_READS_PART_METADATA
  -> APPLICATION_VALIDATES_METADATA
  -> APPLICATION_STREAMS_OR_MOVES_CONTENT
  -> OPTIONAL_SCANNING
  -> STORAGE_COMMIT
  -> METADATA_COMMIT
  -> RESPONSE_SENT
  -> TEMP_CLEANUP
```

Download juga state machine:

```text
CLIENT_REQUESTS_FILE
  -> APPLICATION_AUTHORIZES_ACCESS
  -> APPLICATION_RESOLVES_FILE_METADATA
  -> APPLICATION_DETERMINES_RESPONSE_HEADERS
  -> OPTIONAL_RANGE_NEGOTIATION
  -> RESPONSE_HEADERS_COMMITTED
  -> BYTES_STREAMED
  -> CLIENT_COMPLETES_OR_ABORTS
  -> OBSERVABILITY_RECORDED
```

Kenapa state machine penting?

Karena kegagalan bisa terjadi di setiap titik:

- client disconnect saat upload,
- proxy reject karena body terlalu besar,
- container reject karena `maxPostSize`,
- temp disk penuh,
- multipart parse gagal,
- file invalid,
- malware scan timeout,
- storage gagal,
- metadata DB commit gagal,
- response sudah committed tetapi streaming gagal,
- user refresh saat download,
- reverse proxy idle timeout.

Engineer top-tier tidak hanya bertanya “bagaimana upload file?”, tetapi:

> State apa saja yang mungkin terjadi, siapa pemilik state itu, apa resource yang sedang ditahan, dan bagaimana recovery/cleanup dilakukan?

---

## 3. Multipart/Form-Data Fundamentals

### 3.1 Apa Itu `multipart/form-data`?

`multipart/form-data` adalah format body HTTP yang memungkinkan satu request membawa beberapa bagian atau **part**.

Contoh HTML form:

```html
<form method="post" action="/upload" enctype="multipart/form-data">
  <input type="text" name="title" />
  <input type="file" name="document" />
  <button type="submit">Upload</button>
</form>
```

Request body-nya secara konseptual seperti ini:

```http
POST /upload HTTP/1.1
Host: example.com
Content-Type: multipart/form-data; boundary=----abc123
Content-Length: ...

------abc123
Content-Disposition: form-data; name="title"

Quarterly Report
------abc123
Content-Disposition: form-data; name="document"; filename="report.pdf"
Content-Type: application/pdf

%PDF-1.7 ...binary bytes...
------abc123--
```

Satu HTTP request memiliki beberapa part:

| Part | Name | Filename | Body |
|---|---:|---:|---|
| Text field | `title` | none | `Quarterly Report` |
| File field | `document` | `report.pdf` | file bytes |

### 3.2 Boundary

`boundary` adalah marker untuk memisahkan part.

```http
Content-Type: multipart/form-data; boundary=----abc123
```

Container/multipart parser menggunakan boundary untuk memotong body menjadi part. Kalau boundary salah, hilang, atau body terpotong, parsing gagal.

### 3.3 Multipart Bukan JSON

Dalam JSON API, body biasanya satu dokumen:

```json
{
  "title": "Quarterly Report",
  "documentBase64": "..."
}
```

Dalam multipart, metadata dan file menjadi part terpisah:

```text
part title      -> text
part document   -> binary stream
```

Hindari base64 untuk file besar kecuali benar-benar diperlukan. Base64 memperbesar payload sekitar 33%, menambah CPU, memory, dan parsing overhead.

---

## 4. Servlet Multipart API

Servlet 3.0 memperkenalkan native multipart support, sehingga aplikasi tidak selalu perlu library eksternal hanya untuk basic upload.

Di Jakarta Servlet modern, elemen utamanya:

- `@MultipartConfig`
- `MultipartConfigElement`
- `HttpServletRequest.getPart(String name)`
- `HttpServletRequest.getParts()`
- `Part`

### 4.1 Minimal Upload Servlet

Versi Jakarta:

```java
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.MultipartConfig;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.Part;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@WebServlet("/upload")
@MultipartConfig(
    fileSizeThreshold = 1024 * 1024,       // 1 MB
    maxFileSize = 10L * 1024 * 1024,       // 10 MB
    maxRequestSize = 12L * 1024 * 1024     // 12 MB
)
public class UploadServlet extends HttpServlet {

    private final Path storageDir = Path.of("/var/app/uploads");

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        Part filePart = request.getPart("document");

        if (filePart == null || filePart.getSize() == 0) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Missing file");
            return;
        }

        String submittedName = filePart.getSubmittedFileName();
        String safeName = sanitizeFilename(submittedName);

        Path target = storageDir.resolve(safeName).normalize();
        if (!target.startsWith(storageDir)) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "Invalid filename");
            return;
        }

        Files.createDirectories(storageDir);

        try (var in = filePart.getInputStream()) {
            Files.copy(in, target);
        }

        response.setStatus(HttpServletResponse.SC_CREATED);
        response.setContentType("application/json");
        response.getWriter().write("{\"status\":\"uploaded\"}");
    }

    private String sanitizeFilename(String name) {
        if (name == null || name.isBlank()) {
            return "upload.bin";
        }

        String onlyName = Path.of(name).getFileName().toString();
        return onlyName.replaceAll("[^a-zA-Z0-9._-]", "_");
    }
}
```

Kode ini masih contoh minimal. Nanti kita akan perbaiki desainnya agar cocok untuk produksi.

### 4.2 Versi `javax.*`

Untuk legacy Java EE / Servlet 3.x/4.x:

```java
import javax.servlet.ServletException;
import javax.servlet.annotation.MultipartConfig;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.Part;
```

Konsepnya sama, package berbeda.

### 4.3 `@MultipartConfig`

`@MultipartConfig` memberi tahu container bahwa servlet ini menerima request `multipart/form-data`.

```java
@MultipartConfig(
    location = "/var/app/tmp-upload",
    fileSizeThreshold = 1024 * 1024,
    maxFileSize = 10L * 1024 * 1024,
    maxRequestSize = 12L * 1024 * 1024
)
```

| Attribute | Makna |
|---|---|
| `location` | Direktori sementara untuk menyimpan file part jika diperlukan |
| `fileSizeThreshold` | Ukuran threshold sebelum part ditulis ke disk, bukan hanya memory |
| `maxFileSize` | Maksimum ukuran satu file/part |
| `maxRequestSize` | Maksimum total ukuran request multipart |

Important nuance:

- `fileSizeThreshold` bukan limit maksimum file.
- `maxFileSize` limit per file.
- `maxRequestSize` limit total request.
- Container/proxy masih bisa punya limit lain sebelum aplikasi dipanggil.

### 4.4 `MultipartConfigElement`

Selain annotation, konfigurasi multipart bisa dibuat programmatically.

```java
ServletRegistration.Dynamic servlet = servletContext.addServlet("upload", UploadServlet.class);
servlet.addMapping("/upload");
servlet.setMultipartConfig(new MultipartConfigElement(
    "/var/app/tmp-upload",
    10L * 1024 * 1024,
    12L * 1024 * 1024,
    1024 * 1024
));
```

Ini berguna jika konfigurasi perlu berasal dari environment/container bootstrap, bukan hardcoded annotation.

### 4.5 `Part`

`Part` merepresentasikan satu bagian multipart.

Operasi penting:

```java
String name = part.getName();
String submittedFilename = part.getSubmittedFileName();
String contentType = part.getContentType();
long size = part.getSize();
InputStream body = part.getInputStream();
Collection<String> headerNames = part.getHeaderNames();
String disposition = part.getHeader("Content-Disposition");
part.write("some-file-name");
part.delete();
```

Hati-hati terhadap `part.write(...)`:

- path resolution bisa container-specific,
- nama relatif bisa ditulis relatif terhadap `location`,
- jangan pernah langsung memakai filename dari user,
- lebih eksplisit dan aman menggunakan `getInputStream()` lalu copy ke storage yang dikontrol aplikasi.

---

## 5. Lifecycle Multipart Parsing

Saat request multipart masuk, ada beberapa kemungkinan implementasi container:

```text
HTTP body diterima
  -> container membaca request body
  -> multipart parser aktif saat getPart/getParts/parameter access tertentu
  -> small part mungkin disimpan di memory
  -> large part disimpan di temp file
  -> Part object disediakan ke aplikasi
```

Poin penting:

1. Multipart parsing bisa terjadi saat `request.getPart()` atau `request.getParts()` dipanggil.
2. Beberapa framework memicu parsing lebih awal melalui multipart resolver.
3. Field text dalam multipart bisa ikut tersedia sebagai parameter, tergantung container/framework behavior.
4. Setelah multipart parser membaca request body, raw body stream tidak bisa dibaca ulang kecuali dibungkus/cached dari awal.

---

## 6. Parameter, Attribute, Header, dan Part

Jangan campur konsep berikut.

| Konsep | Sumber | Contoh | Untuk apa |
|---|---|---|---|
| Header | HTTP header | `Content-Type`, `Authorization` | metadata request global |
| Parameter | query/form field | `title=abc` | input text ringan |
| Attribute | server-side object | `request.setAttribute(...)` | komunikasi antar komponen server |
| Part | multipart section | uploaded file | file/text body multipart |

Contoh:

```java
String title = request.getParameter("title");
Part document = request.getPart("document");
```

Namun untuk upload penting, lebih aman eksplisit membaca part dan validasi satu per satu:

```java
Part titlePart = request.getPart("title");
Part documentPart = request.getPart("document");
```

---

## 7. Production-Grade Upload Flow

Upload produksi sebaiknya tidak langsung:

```text
browser -> servlet -> final storage
```

Lebih aman dibuat bertahap:

```text
receive multipart
  -> validate request-level constraints
  -> validate part presence
  -> validate metadata
  -> stream to controlled temp/quarantine
  -> compute checksum
  -> scan/inspect
  -> persist metadata transactionally
  -> move/promote to durable storage
  -> respond with file id, not arbitrary path
```

### 7.1 Jangan Percaya Filename Dari Client

`getSubmittedFileName()` adalah input dari client. Isinya bisa:

```text
report.pdf
../../../../etc/passwd
C:\Users\user\Desktop\secret.pdf
invoice.pdf.exe
空白.pdf
file name with spaces.pdf
file
.
..
```

Rule aman:

1. Jangan gunakan filename client sebagai path final.
2. Ambil basename saja.
3. Sanitasi untuk display name.
4. Gunakan generated storage key.
5. Simpan original display name sebagai metadata, bukan path.

Contoh desain:

```text
original_name:  "../../invoice.pdf"
display_name:   "invoice.pdf"
storage_key:    "2026/06/17/9f1e7c6d-..."
content_type:   "application/pdf"
size:           583920
sha256:         "..."
owner_user_id:  "u123"
status:         "QUARANTINED | AVAILABLE | REJECTED"
```

### 7.2 Safe Filename Utility

```java
import java.nio.file.Path;
import java.text.Normalizer;

public final class UploadNames {

    private UploadNames() {}

    public static String safeDisplayName(String submittedName) {
        if (submittedName == null || submittedName.isBlank()) {
            return "unnamed";
        }

        String base = Path.of(submittedName).getFileName().toString();
        String normalized = Normalizer.normalize(base, Normalizer.Form.NFKC);
        String cleaned = normalized.replaceAll("[\\r\\n\\t]", " ")
                                   .replaceAll("[^\\p{L}\\p{N}._ -]", "_")
                                   .trim();

        if (cleaned.equals(".") || cleaned.equals("..") || cleaned.isBlank()) {
            return "unnamed";
        }

        if (cleaned.length() > 180) {
            cleaned = cleaned.substring(0, 180);
        }

        return cleaned;
    }

    public static String extensionOf(String filename) {
        int i = filename.lastIndexOf('.');
        if (i < 0 || i == filename.length() - 1) {
            return "";
        }
        return filename.substring(i + 1).toLowerCase();
    }
}
```

### 7.3 Storage Key Bukan Filename

```java
import java.time.LocalDate;
import java.util.UUID;

public final class StorageKeys {

    public static String newObjectKey(String extension) {
        LocalDate now = LocalDate.now();
        String ext = extension == null || extension.isBlank() ? "bin" : extension;

        return "%04d/%02d/%02d/%s.%s".formatted(
            now.getYear(),
            now.getMonthValue(),
            now.getDayOfMonth(),
            UUID.randomUUID(),
            ext
        );
    }
}
```

Dengan pola ini, user tidak bisa mengontrol path final.

---

## 8. Content-Type: Berguna, Tapi Tidak Boleh Dipercaya Buta

Client bisa mengirim:

```http
Content-Type: image/png
```

padahal file-nya adalah executable atau script.

`Part.getContentType()` hanya metadata yang dikirim client. Browser biasanya menebak dari file, tetapi attacker bisa memalsukan.

Validation yang lebih kuat:

1. Cek allowlist extension.
2. Cek declared content type.
3. Cek magic number/signature.
4. Gunakan parser khusus format bila perlu.
5. Scan malware jika file akan dibuka/diunduh pihak lain.
6. Simpan file dengan `Content-Disposition: attachment` bila konten tidak trusted.

Contoh allowlist:

```java
Set<String> allowedExtensions = Set.of("pdf", "png", "jpg", "jpeg", "txt", "csv", "xlsx");
Set<String> allowedContentTypes = Set.of(
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
);
```

### 8.1 Magic Number Check Sederhana

```java
public final class MagicNumbers {

    public static boolean looksLikePdf(byte[] firstBytes) {
        return firstBytes.length >= 5
            && firstBytes[0] == '%'
            && firstBytes[1] == 'P'
            && firstBytes[2] == 'D'
            && firstBytes[3] == 'F'
            && firstBytes[4] == '-';
    }

    public static boolean looksLikePng(byte[] b) {
        return b.length >= 8
            && (b[0] & 0xff) == 0x89
            && b[1] == 'P'
            && b[2] == 'N'
            && b[3] == 'G'
            && (b[4] & 0xff) == 0x0D
            && (b[5] & 0xff) == 0x0A
            && (b[6] & 0xff) == 0x1A
            && (b[7] & 0xff) == 0x0A;
    }
}
```

Magic number bukan solusi sempurna, tetapi jauh lebih baik daripada percaya extension saja.

---

## 9. Size Limit Layering

Upload size limit tidak hanya di Servlet.

```text
Browser/client
  -> CDN/WAF
  -> API gateway
  -> reverse proxy / ingress
  -> load balancer
  -> servlet connector
  -> multipart config
  -> application validation
  -> storage limit
```

Jika limit tidak selaras, error bisa membingungkan.

Contoh:

| Layer | Limit | Error yang terlihat |
|---|---:|---|
| Nginx `client_max_body_size` | 10 MB | 413 dari Nginx |
| Tomcat connector `maxPostSize` | 20 MB | 400/413 dari container |
| `@MultipartConfig.maxFileSize` | 15 MB | exception saat parsing multipart |
| Application rule | 5 MB | JSON error dari app |

Kalau application rule 50 MB tetapi proxy limit 10 MB, aplikasi tidak pernah menerima request 20 MB.

### 9.1 Prinsip Limit Alignment

Desain yang masuk akal:

```text
business max file size       = 10 MB
multipart max file size      = 10 MB + small tolerance
multipart max request size   = file + metadata + overhead
container max post size      >= multipart max request size
proxy max body size          >= container max post size
WAF/CDN limit                >= proxy max body size
```

Tetapi jangan terlalu longgar. Semakin besar limit, semakin besar risiko:

- memory pressure,
- temp disk pressure,
- slow upload attack,
- network bandwidth consumption,
- long-running request,
- retry storm.

---

## 10. Temp Storage and Cleanup

`@MultipartConfig.location` menentukan lokasi temp untuk multipart parts.

```java
@MultipartConfig(location = "/var/app/tmp-upload")
```

Masalah produksi yang sering muncul:

1. Temp directory tidak ada.
2. Permission salah.
3. Disk penuh.
4. File temp tidak terhapus saat exception tertentu.
5. Temp directory berada di ephemeral filesystem container yang kecil.
6. Banyak upload paralel memenuhi disk.
7. Malware scan lambat membuat file tertahan lama.

### 10.1 Temp Directory Dalam Container/Kubernetes

Di Kubernetes, jangan asumsikan `/tmp` besar. Bisa terbatas oleh container filesystem.

Lebih baik eksplisit:

```text
/var/app/tmp-upload
```

dan mount sebagai volume dengan quota/monitoring jelas.

Checklist:

- directory exists,
- writable by app user,
- limited/quota,
- monitored disk usage,
- cleaned on startup for stale files,
- not shared with sensitive unrelated temp files,
- not served as static files.

### 10.2 Explicit Cleanup

Jika kita copy dari `Part` ke storage sendiri, panggil `delete()` setelah selesai bila perlu:

```java
try {
    // process part
} finally {
    try {
        part.delete();
    } catch (IOException ignored) {
        // log at debug/warn depending policy
    }
}
```

Namun behavior cleanup juga bisa dikelola container pada akhir request. Tetap penting memahami lifecycle agar tidak menahan stream/file lebih lama dari request.

---

## 11. Streaming Upload vs Buffering Upload

### 11.1 Buffering Model

Default multipart API sering membuat container mem-buffer part ke memory/disk.

Kelebihan:

- sederhana,
- API mudah (`Part`),
- cocok untuk file kecil-menengah,
- integrasi container standard.

Kekurangan:

- file besar memakai temp disk,
- parsing terjadi sebelum validasi aplikasi lengkap,
- temp disk bisa jadi bottleneck,
- sulit mengontrol backpressure end-to-end,
- tidak ideal untuk multi-GB upload.

### 11.2 Streaming Model

Untuk payload sangat besar, sering lebih baik:

```text
client -> pre-signed URL -> object storage
```

atau:

```text
client -> upload service streaming -> object storage
```

Aplikasi utama hanya menerima metadata dan mengatur lifecycle.

Pattern:

1. Client request upload session.
2. Server authorize dan buat upload token/pre-signed URL.
3. Client upload langsung ke storage.
4. Storage callback/event atau client confirm.
5. Server validate metadata, scan, finalize.

Ini mengurangi beban servlet container.

### 11.3 Kapan Native Multipart Servlet Cukup?

Cukup jika:

- ukuran file relatif kecil/menengah,
- request rate rendah-menengah,
- file harus diproses aplikasi langsung,
- deployment punya temp disk cukup,
- latency bukan concern utama,
- tidak perlu resumable upload.

Tidak ideal jika:

- file ratusan MB/GB,
- high concurrency upload,
- perlu resumable/chunked upload,
- storage akhir adalah object storage,
- app node tidak punya disk besar,
- upload harus tahan network interruption.

---

## 12. Upload Dengan Hashing dan Bounded Copy

Saat menerima file, sering perlu menghitung checksum.

Contoh utility copy dengan SHA-256 dan limit:

```java
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class UploadStreams {

    private static final int BUFFER_SIZE = 64 * 1024;

    public static CopyResult copyWithSha256Limit(
            InputStream input,
            OutputStream output,
            long maxBytes
    ) throws IOException {
        MessageDigest digest = sha256();
        long total = 0;

        try (DigestInputStream digestInput = new DigestInputStream(input, digest)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = digestInput.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new PayloadTooLargeException("Payload exceeded " + maxBytes + " bytes");
                }
                output.write(buffer, 0, read);
            }
        }

        return new CopyResult(total, HexFormat.of().formatHex(digest.digest()));
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public record CopyResult(long bytes, String sha256) {}

    public static class PayloadTooLargeException extends IOException {
        public PayloadTooLargeException(String message) {
            super(message);
        }
    }
}
```

Walaupun `@MultipartConfig.maxFileSize` sudah ada, bounded copy tetap berguna untuk defense-in-depth dan untuk storage flow yang tidak memakai multipart parser standar.

---

## 13. Transaction Boundary: File Bytes dan Metadata

Salah satu masalah tersulit adalah menjaga konsistensi antara:

```text
file bytes di storage
metadata di database
```

Contoh failure:

```text
1. file berhasil disimpan ke disk/S3
2. insert metadata DB gagal
3. response 500
4. file orphan tertinggal
```

Atau sebaliknya:

```text
1. metadata DB dibuat status AVAILABLE
2. file move ke storage final gagal
3. user melihat file tersedia tetapi download gagal
```

### 13.1 Gunakan Status Lifecycle

Jangan langsung set file sebagai available.

```text
RECEIVING
  -> QUARANTINED
  -> SCANNING
  -> AVAILABLE
  -> REJECTED
  -> DELETED
```

Tabel metadata contoh:

| Column | Meaning |
|---|---|
| `id` | server-generated file id |
| `owner_id` | pemilik file |
| `original_filename` | nama dari client, sanitized for display |
| `storage_key` | key final, tidak dari user |
| `content_type` | detected/declared content type |
| `size_bytes` | ukuran aktual |
| `sha256` | checksum |
| `status` | lifecycle status |
| `created_at` | waktu upload |
| `available_at` | waktu promote |
| `rejection_reason` | alasan reject |

### 13.2 Saga-Like Cleanup

Karena file storage dan DB biasanya bukan satu transaksi ACID, gunakan compensation:

```text
if storage write succeeds but DB insert fails:
  delete storage object or mark as orphan for cleanup job

if DB insert succeeds but storage write fails:
  update status REJECTED/FAILED

if scan fails:
  keep metadata, mark REJECTED, delete/quarantine bytes according policy
```

---

## 14. Malware Scanning and Quarantine Pattern

Jika file akan diakses pihak lain, upload bukan selesai saat byte diterima.

Pattern aman:

```text
UPLOAD_RECEIVED
  -> stored in quarantine
  -> metadata status = QUARANTINED
  -> scanner job picks file
  -> scan OK: promote to AVAILABLE
  -> scan FAIL: mark REJECTED, delete or retain per policy
```

Synchronous scan cocok untuk file kecil dan low traffic, tetapi bisa memperpanjang request.

Asynchronous scan lebih scalable:

```text
POST /files
  -> 202 Accepted
  -> file status QUARANTINED
  -> scanner async
  -> client polls /files/{id}/status or receives event
```

Trade-off:

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| Synchronous scan | client langsung tahu hasil | request lama, timeout risk |
| Async scan | scalable, resilient | lifecycle lebih kompleks |

---

## 15. File Download Fundamentals

Download bukan hanya menulis bytes ke response.

Minimal download servlet:

```java
@WebServlet("/download/*")
public class DownloadServlet extends HttpServlet {

    private final Path storageDir = Path.of("/var/app/uploads");

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws IOException {

        String fileId = request.getPathInfo().substring(1);
        Path file = storageDir.resolve(fileId).normalize();

        if (!file.startsWith(storageDir) || !Files.isRegularFile(file)) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        response.setContentType("application/octet-stream");
        response.setHeader("Content-Disposition", "attachment; filename=\"download.bin\"");
        response.setContentLengthLong(Files.size(file));

        try (var in = Files.newInputStream(file);
             var out = response.getOutputStream()) {
            in.transferTo(out);
        }
    }
}
```

Ini basic. Produksi butuh authorization, metadata, content type, safe filename, cache/range handling, observability, dan client abort handling.

---

## 16. Download Header Penting

### 16.1 `Content-Type`

Menentukan tipe media response.

```java
response.setContentType("application/pdf");
```

Jika file tidak trusted, gunakan:

```java
response.setContentType("application/octet-stream");
```

### 16.2 `Content-Disposition`

Mengontrol apakah browser menampilkan inline atau mengunduh sebagai attachment.

```http
Content-Disposition: attachment; filename="report.pdf"
```

Untuk nama file Unicode, gunakan `filename*` sesuai RFC style:

```http
Content-Disposition: attachment; filename="report.pdf"; filename*=UTF-8''report%20final.pdf
```

Utility sederhana:

```java
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class ContentDispositionUtil {

    public static String attachment(String filename) {
        String fallback = filename.replaceAll("[^a-zA-Z0-9._-]", "_");
        String encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8)
                .replace("+", "%20");
        return "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + encoded;
    }
}
```

### 16.3 `Content-Length`

Jika ukuran diketahui:

```java
response.setContentLengthLong(size);
```

Keuntungan:

- browser bisa tampilkan progress,
- proxy/client tahu kapan selesai,
- download manager lebih reliable.

Jika streaming generated content yang ukurannya belum diketahui, bisa tidak set `Content-Length`, tetapi behavior proxy/client berbeda.

### 16.4 `Cache-Control`

Untuk file private:

```java
response.setHeader("Cache-Control", "private, no-store");
```

Untuk file public immutable:

```java
response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
```

Jangan asal `no-cache` untuk semua file. Cache policy adalah bagian dari domain dan security decision.

### 16.5 `ETag` dan `Last-Modified`

Untuk file statis/durable:

```http
ETag: "sha256-abc123"
Last-Modified: Tue, 17 Jun 2026 12:00:00 GMT
```

Client bisa mengirim:

```http
If-None-Match: "sha256-abc123"
If-Modified-Since: ...
```

Server bisa merespons:

```http
304 Not Modified
```

Ini menghemat bandwidth.

---

## 17. Range Request and Partial Content

Range request memungkinkan client meminta sebagian file.

Contoh request:

```http
GET /files/123 HTTP/1.1
Range: bytes=1000-1999
```

Response:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 1000-1999/5000
Content-Length: 1000
Accept-Ranges: bytes
```

Kenapa penting?

- resume download,
- video/audio seeking,
- download manager,
- large file transfer,
- browser media playback.

### 17.1 Basic Single Range Implementation

Implementasi range penuh cukup kompleks, apalagi multiple ranges. Berikut single range simplified:

```java
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;

public final class RangeDownloads {

    private static final int BUFFER_SIZE = 64 * 1024;

    public static void sendFile(HttpServletRequest request,
                                HttpServletResponse response,
                                Path file,
                                String contentType,
                                String downloadName) throws IOException {
        long fileSize = Files.size(file);
        String rangeHeader = request.getHeader("Range");

        response.setHeader("Accept-Ranges", "bytes");
        response.setContentType(contentType != null ? contentType : "application/octet-stream");
        response.setHeader("Content-Disposition", ContentDispositionUtil.attachment(downloadName));

        if (rangeHeader == null || !rangeHeader.startsWith("bytes=")) {
            response.setStatus(HttpServletResponse.SC_OK);
            response.setContentLengthLong(fileSize);
            copyRange(file, response.getOutputStream(), 0, fileSize - 1);
            return;
        }

        Range range = parseSingleRange(rangeHeader, fileSize);
        if (range == null) {
            response.setStatus(HttpServletResponse.SC_REQUESTED_RANGE_NOT_SATISFIABLE);
            response.setHeader("Content-Range", "bytes */" + fileSize);
            return;
        }

        long length = range.endInclusive - range.startInclusive + 1;
        response.setStatus(HttpServletResponse.SC_PARTIAL_CONTENT);
        response.setHeader("Content-Range", "bytes " + range.startInclusive + "-" + range.endInclusive + "/" + fileSize);
        response.setContentLengthLong(length);
        copyRange(file, response.getOutputStream(), range.startInclusive, range.endInclusive);
    }

    private static Range parseSingleRange(String header, long fileSize) {
        try {
            String spec = header.substring("bytes=".length()).trim();
            if (spec.contains(",")) {
                return null; // multiple ranges not supported in this simple implementation
            }

            String[] parts = spec.split("-", -1);
            if (parts.length != 2) {
                return null;
            }

            long start;
            long end;

            if (parts[0].isBlank()) {
                // suffix range: bytes=-500 means last 500 bytes
                long suffixLength = Long.parseLong(parts[1]);
                if (suffixLength <= 0) return null;
                start = Math.max(0, fileSize - suffixLength);
                end = fileSize - 1;
            } else {
                start = Long.parseLong(parts[0]);
                end = parts[1].isBlank() ? fileSize - 1 : Long.parseLong(parts[1]);
            }

            if (start < 0 || end < start || start >= fileSize) {
                return null;
            }

            end = Math.min(end, fileSize - 1);
            return new Range(start, end);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static void copyRange(Path file, OutputStream out, long start, long endInclusive) throws IOException {
        try (RandomAccessFile raf = new RandomAccessFile(file.toFile(), "r")) {
            raf.seek(start);
            byte[] buffer = new byte[BUFFER_SIZE];
            long remaining = endInclusive - start + 1;

            while (remaining > 0) {
                int toRead = (int) Math.min(buffer.length, remaining);
                int read = raf.read(buffer, 0, toRead);
                if (read == -1) break;
                out.write(buffer, 0, read);
                remaining -= read;
            }
        }
    }

    private record Range(long startInclusive, long endInclusive) {}
}
```

Catatan:

- Ini simplified single range.
- Multiple range response membutuhkan `multipart/byteranges`.
- Untuk static files, container/proxy/object storage sering lebih baik menangani range.
- Untuk file besar di object storage, redirect/presigned URL sering lebih efisien.

---

## 18. Path Traversal Pada Download

Bahaya:

```http
GET /download?file=../../../../etc/passwd
```

Kode rawan:

```java
Path file = Path.of("/var/app/files", request.getParameter("file"));
Files.copy(file, response.getOutputStream());
```

Aman minimal:

```java
Path root = Path.of("/var/app/files").toRealPath();
Path requested = root.resolve(userInput).normalize();

if (!requested.startsWith(root)) {
    response.sendError(HttpServletResponse.SC_FORBIDDEN);
    return;
}
```

Lebih baik:

```text
client requests /files/{fileId}
server looks up fileId in DB
server checks ownership/authorization
server uses storage_key from DB
```

Jangan expose filesystem path ke client.

---

## 19. Inline vs Attachment: Security Implication

Jika server mengirim:

```http
Content-Disposition: inline
Content-Type: text/html
```

Browser bisa render HTML. Jika file berasal dari user, ini bisa menjadi XSS vector.

Untuk untrusted uploaded content, default aman:

```http
Content-Disposition: attachment
X-Content-Type-Options: nosniff
Content-Type: application/octet-stream
```

Atau serve dari domain terpisah yang tidak memiliki cookie aplikasi utama.

Pattern untuk public user-generated content:

```text
app.example.com       -> aplikasi utama, cookies sensitif
files.example-cdn.com -> file user-generated, no auth cookies
```

---

## 20. Client Abort, Broken Pipe, dan Connection Reset

Download besar sering gagal karena client:

- menutup tab,
- pindah network,
- cancel download,
- timeout,
- browser menghentikan request.

Di server, ini bisa terlihat sebagai:

- `Broken pipe`,
- `Connection reset by peer`,
- `ClientAbortException` pada Tomcat,
- IOException saat write.

Jangan otomatis anggap semua ini incident server.

Handling:

```java
try {
    Files.copy(file, response.getOutputStream());
} catch (IOException e) {
    if (isClientAbort(e)) {
        // log as info/debug with request id, bytes sent if available
        return;
    }
    throw e;
}
```

Pseudo detector:

```java
private boolean isClientAbort(Throwable t) {
    while (t != null) {
        String name = t.getClass().getName();
        String msg = t.getMessage();
        if (name.contains("ClientAbortException")) return true;
        if (msg != null && (
            msg.contains("Broken pipe") ||
            msg.contains("Connection reset") ||
            msg.contains("An established connection was aborted")
        )) return true;
        t = t.getCause();
    }
    return false;
}
```

Tetap ukur frekuensinya. Banyak client abort bisa menandakan:

- download lambat,
- proxy timeout,
- mobile network unstable,
- file terlalu besar,
- user retry terus,
- server throughput rendah.

---

## 21. Large Payload Timeout Alignment

Upload/download besar melibatkan banyak timeout.

```text
client timeout
  -> CDN/WAF timeout
  -> reverse proxy read/send timeout
  -> load balancer idle timeout
  -> servlet connector timeout
  -> async timeout
  -> app-level timeout
  -> storage client timeout
```

Jika tidak selaras:

```text
app masih menulis response
  tetapi proxy sudah close connection
  -> app melihat broken pipe
```

atau:

```text
client upload lambat
  proxy read timeout habis
  -> 408/499/502/504-like behavior
```

### 21.1 Prinsip Timeout

Untuk upload:

- batasi body size,
- batasi minimum upload rate bila proxy mendukung,
- set read timeout realistis,
- hindari request terlalu lama di app node.

Untuk download:

- pastikan proxy idle/send timeout cukup untuk file besar,
- gunakan streaming dengan periodic writes,
- pertimbangkan object storage direct download,
- gunakan range/resume untuk file besar.

---

## 22. Reverse Proxy Buffering

Proxy bisa mem-buffer request body sebelum meneruskan ke app.

```text
client uploads 100 MB
  -> Nginx buffers full body to disk
  -> after complete, forwards to servlet app
```

Konsekuensi:

- app tidak melihat progress upload real-time,
- temp disk di proxy bisa penuh,
- timeout terjadi di proxy, bukan app,
- application-level streaming tidak end-to-end.

Proxy juga bisa mem-buffer response.

Untuk SSE/streaming/download tertentu, buffering bisa merusak behavior.

Jadi saat desain large file, pahami:

- apakah proxy buffers request body,
- apakah proxy buffers response,
- max temp file size di proxy,
- timeout dan body size limit di proxy,
- WebSocket/SSE behavior di proxy.

---

## 23. Download: Application Streaming vs X-Sendfile / X-Accel-Redirect

Untuk file lokal di server/proxy, ada pattern:

```text
app authorize request
  -> app returns internal redirect header
  -> web server/proxy serves file efficiently
```

Contoh Nginx `X-Accel-Redirect`:

```http
X-Accel-Redirect: /internal-files/abc.pdf
Content-Disposition: attachment; filename="abc.pdf"
```

Kelebihan:

- app tidak menahan thread untuk streaming file,
- proxy/web server lebih efisien untuk static file,
- range/caching bisa ditangani proxy.

Kekurangan:

- konfigurasi lebih kompleks,
- coupling dengan reverse proxy,
- perlu mapping internal path aman,
- tidak cocok untuk semua deployment.

Untuk object storage, pola sejenis adalah pre-signed URL.

```text
app authorize
  -> app generates short-lived signed URL
  -> client downloads from object storage/CDN
```

---

## 24. Upload API Design Patterns

### 24.1 Simple Synchronous Upload

```http
POST /files
Content-Type: multipart/form-data

-> 201 Created
{
  "fileId": "...",
  "status": "AVAILABLE"
}
```

Cocok untuk:

- file kecil,
- scan cepat atau tidak perlu scan,
- low-medium traffic.

### 24.2 Async Upload With Quarantine

```http
POST /files
-> 202 Accepted
{
  "fileId": "...",
  "status": "QUARANTINED"
}
```

Lalu:

```http
GET /files/{id}/status
-> 200 OK
{
  "status": "AVAILABLE"
}
```

Cocok untuk:

- malware scan,
- document parsing,
- OCR,
- virus scanning,
- large file metadata extraction.

### 24.3 Direct-To-Object-Storage Upload

```http
POST /upload-sessions
-> 201 Created
{
  "uploadUrl": "https://storage/...signed...",
  "fileId": "..."
}
```

Client upload langsung ke storage.

Cocok untuk:

- file besar,
- high throughput,
- cloud-native architecture,
- mengurangi beban servlet app.

### 24.4 Chunked/Resumable Upload

```text
create upload session
  -> upload chunk 1
  -> upload chunk 2
  -> upload chunk N
  -> complete upload
  -> assemble/validate
```

Cocok untuk:

- mobile network,
- file sangat besar,
- unreliable connection,
- resume support.

Native Servlet multipart sederhana biasanya bukan pilihan terbaik untuk resumable upload kompleks.

---

## 25. Download API Design Patterns

### 25.1 Direct App Streaming

```http
GET /files/{id}/content
```

App authorize dan stream bytes.

Kelebihan:

- kontrol penuh,
- audit mudah,
- cocok untuk file kecil/medium/private.

Kekurangan:

- app threads/connections tertahan,
- throughput app jadi bottleneck,
- range support harus diimplementasikan atau didelegasikan.

### 25.2 Redirect to Signed URL

```http
GET /files/{id}/download-url
-> 200 OK
{
  "url": "https://storage.example/..."
}
```

atau:

```http
GET /files/{id}/content
-> 302 Found
Location: signed-url
```

Kelebihan:

- app tidak stream file,
- storage/CDN handle range/cache/throughput,
- scalable.

Kekurangan:

- audit download completion lebih sulit,
- URL leakage risk,
- expiry management,
- client harus mengikuti redirect atau call kedua.

### 25.3 Proxy/Internal Redirect

App authorize, proxy serve.

Cocok untuk on-prem/local file deployment dengan Nginx/Apache.

---

## 26. Authorization Boundary

Upload/download selalu perlu authorization model.

Pertanyaan desain:

Upload:

- siapa boleh upload?
- ke entity apa file dilampirkan?
- tipe file apa yang boleh untuk status entity saat ini?
- apakah file langsung visible?
- apakah user boleh replace file?
- apakah ada quota per user/case/module?

Download:

- siapa boleh melihat metadata?
- siapa boleh mengunduh content?
- apakah deleted/rejected/quarantined file boleh diunduh admin?
- apakah link shareable?
- apakah access harus diaudit?
- apakah file perlu watermark?

Jangan samakan metadata access dengan content access.

```text
GET /files/{id}          -> metadata permission
GET /files/{id}/content  -> content permission
DELETE /files/{id}       -> delete permission
```

---

## 27. Observability Untuk Upload/Download

Metrics penting:

Upload:

- request count by endpoint/status,
- accepted/rejected file count,
- upload size distribution,
- multipart parse error count,
- max size rejection count,
- temp disk usage,
- scan duration,
- storage write duration,
- DB metadata commit failure,
- orphan cleanup count.

Download:

- download count by status,
- bytes served,
- duration,
- client abort count,
- range request count,
- 404/403 rate,
- storage read latency,
- proxy 502/503/504 around file endpoints.

Logs minimal:

```text
request_id
user_id / principal id
file_id
entity_id
operation=UPLOAD|DOWNLOAD
status
bytes_received/bytes_sent
content_type
file_size
duration_ms
client_ip / forwarded chain if policy allows
error_category
```

Jangan log:

- raw file content,
- full sensitive filename jika mengandung PII tanpa policy,
- signed URL penuh,
- auth token,
- multipart body.

---

## 28. Failure Model: Upload

| Failure | Gejala | Root Cause | Mitigasi |
|---|---|---|---|
| 413 dari proxy | app tidak menerima request | proxy body limit lebih kecil | align limit |
| `IllegalStateException` multipart | file/request melebihi limit | `maxFileSize`/`maxRequestSize` | return structured 413 |
| temp disk penuh | upload gagal acak | temp volume kecil/leak | quota, cleanup, metrics |
| filename traversal | file tertulis di path salah | pakai submitted filename | generated storage key |
| content type spoofing | file berbahaya lolos | percaya header client | magic number, scan, allowlist |
| DB fail setelah file write | orphan file | non-atomic storage+DB | lifecycle status, cleanup job |
| scan timeout | upload stuck | sync scanner lambat | async scan, timeout policy |
| parallel upload abuse | resource habis | no rate/concurrency limit | quota, admission control |
| client disconnect | partial body | network/user cancel | cleanup partial, log category |
| large base64 JSON | memory spike | salah format transfer | multipart/direct storage |

---

## 29. Failure Model: Download

| Failure | Gejala | Root Cause | Mitigasi |
|---|---|---|---|
| 404 file ada di DB tapi tidak di storage | metadata/storage inconsistent | failed promotion/deletion | lifecycle state, reconciliation |
| 403 unexpected | authorization mismatch | metadata vs content policy beda | separate permission model |
| broken pipe | IOException saat write | client cancel/proxy close | classify client abort |
| slow download | request lama | app streaming bottleneck | CDN/object storage/proxy offload |
| wrong filename | browser nama kacau | bad Content-Disposition | fallback + filename* |
| XSS via uploaded HTML | browser render file | inline + text/html | attachment, nosniff, separate domain |
| resume tidak bekerja | download restart full | no Range support | range/object storage |
| 504 | proxy timeout | app read/storage slow | timeout align, offload |
| memory spike | OutOfMemory | load file fully into byte[] | streaming copy |
| response corrupt | mixed writer/outputstream | wrong response API use | one output mode only |

---

## 30. Anti-Patterns

### 30.1 Membaca Seluruh File ke Memory

Buruk:

```java
byte[] bytes = filePart.getInputStream().readAllBytes();
```

Untuk file kecil mungkin aman, tetapi pola ini berbahaya jika limit berubah atau attacker mengirim banyak upload paralel.

Lebih baik streaming:

```java
try (InputStream in = filePart.getInputStream();
     OutputStream out = Files.newOutputStream(target)) {
    in.transferTo(out);
}
```

### 30.2 Menyimpan File di Web Root

Buruk:

```text
src/main/webapp/uploads/user-file.html
```

Risiko:

- file langsung executable/renderable,
- authorization bypass,
- XSS,
- sulit cleanup,
- redeploy bisa menghapus file.

### 30.3 Pakai Original Filename Sebagai Primary Key

Buruk:

```text
/uploads/{username}/{originalFilename}
```

Masalah:

- collision,
- traversal,
- encoding,
- rename,
- duplicate,
- privacy leak.

Gunakan server-generated ID/storage key.

### 30.4 Download Dengan Query Path Mentah

Buruk:

```http
GET /download?path=/var/app/files/a.pdf
```

Gunakan:

```http
GET /files/{fileId}/content
```

### 30.5 Tidak Punya Quota

Tanpa quota, upload feature bisa menjadi storage exhaustion vector.

Quota bisa per:

- user,
- organization,
- case/entity,
- day,
- file type,
- environment.

---

## 31. End-to-End Example: Safer Upload Servlet

Contoh berikut tetap vanilla Servlet, tetapi lebih dekat ke production mindset.

```java
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.MultipartConfig;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.Part;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.Set;

@WebServlet("/files")
@MultipartConfig(
    location = "/var/app/tmp-upload",
    fileSizeThreshold = 1024 * 1024,
    maxFileSize = 10L * 1024 * 1024,
    maxRequestSize = 12L * 1024 * 1024
)
public class FileUploadServlet extends HttpServlet {

    private static final long MAX_FILE_SIZE = 10L * 1024 * 1024;
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("pdf", "png", "jpg", "jpeg");
    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
        "application/pdf",
        "image/png",
        "image/jpeg"
    );

    private final Path quarantineDir = Path.of("/var/app/files/quarantine");
    private final Path finalDir = Path.of("/var/app/files/available");

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        String requestId = request.getHeader("X-Request-ID");
        Instant start = Instant.now();

        Part part;
        try {
            part = request.getPart("file");
        } catch (IllegalStateException ex) {
            sendJsonError(response, HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE,
                "FILE_TOO_LARGE", "Uploaded file exceeds allowed limit");
            return;
        }

        if (part == null || part.getSize() <= 0) {
            sendJsonError(response, HttpServletResponse.SC_BAD_REQUEST,
                "MISSING_FILE", "File part is required");
            return;
        }

        if (part.getSize() > MAX_FILE_SIZE) {
            sendJsonError(response, HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE,
                "FILE_TOO_LARGE", "Uploaded file exceeds allowed limit");
            return;
        }

        String displayName = UploadNames.safeDisplayName(part.getSubmittedFileName());
        String extension = UploadNames.extensionOf(displayName);
        String declaredType = part.getContentType();

        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            sendJsonError(response, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE,
                "UNSUPPORTED_EXTENSION", "File extension is not allowed");
            return;
        }

        if (declaredType == null || !ALLOWED_CONTENT_TYPES.contains(declaredType)) {
            sendJsonError(response, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE,
                "UNSUPPORTED_CONTENT_TYPE", "Content type is not allowed");
            return;
        }

        Files.createDirectories(quarantineDir);
        Files.createDirectories(finalDir);

        String fileId = java.util.UUID.randomUUID().toString();
        Path quarantineFile = quarantineDir.resolve(fileId + ".upload").normalize();
        Path finalFile = finalDir.resolve(fileId + "." + extension).normalize();

        if (!quarantineFile.startsWith(quarantineDir) || !finalFile.startsWith(finalDir)) {
            sendJsonError(response, HttpServletResponse.SC_BAD_REQUEST,
                "INVALID_FILE", "Invalid file target");
            return;
        }

        UploadStreams.CopyResult result;
        try (InputStream in = part.getInputStream();
             OutputStream out = Files.newOutputStream(quarantineFile)) {
            result = UploadStreams.copyWithSha256Limit(in, out, MAX_FILE_SIZE);
        } catch (UploadStreams.PayloadTooLargeException ex) {
            Files.deleteIfExists(quarantineFile);
            sendJsonError(response, HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE,
                "FILE_TOO_LARGE", "Uploaded file exceeds allowed limit");
            return;
        } finally {
            try {
                part.delete();
            } catch (IOException ignored) {
                // preferably log with request id
            }
        }

        // Placeholder: scan file in quarantine before making available.
        boolean scanOk = fakeScan(quarantineFile);
        if (!scanOk) {
            Files.deleteIfExists(quarantineFile);
            sendJsonError(response, HttpServletResponse.SC_UNSUPPORTED_MEDIA_TYPE,
                "FILE_REJECTED", "Uploaded file failed validation");
            return;
        }

        Files.move(quarantineFile, finalFile, StandardCopyOption.ATOMIC_MOVE);

        // Placeholder: persist metadata in DB.
        // If DB persist fails here, final file may become orphan. Production design needs cleanup/reconciliation.

        response.setStatus(HttpServletResponse.SC_CREATED);
        response.setContentType("application/json");
        response.getWriter().write("""
            {
              "fileId": "%s",
              "filename": "%s",
              "size": %d,
              "sha256": "%s",
              "status": "AVAILABLE"
            }
            """.formatted(fileId, escapeJson(displayName), result.bytes(), result.sha256()));
    }

    private boolean fakeScan(Path file) {
        return true;
    }

    private void sendJsonError(HttpServletResponse response, int status, String code, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("""
            {"error":"%s","message":"%s"}
            """.formatted(escapeJson(code), escapeJson(message)));
    }

    private String escapeJson(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

Catatan penting:

- Ini belum menggantikan storage service proper.
- `ATOMIC_MOVE` tidak selalu tersedia lintas filesystem.
- Malware scanning masih placeholder.
- Metadata DB transaction belum lengkap.
- Error JSON masih minimal.
- Authorization belum ditampilkan agar fokus tetap Servlet file handling.

Namun struktur mentalnya sudah jauh lebih aman daripada langsung `part.write(part.getSubmittedFileName())`.

---

## 32. End-to-End Example: Safer Download Servlet

```java
import jakarta.servlet.ServletException;
import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@WebServlet("/files/*")
public class FileDownloadServlet extends HttpServlet {

    private final Path finalDir = Path.of("/var/app/files/available");

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        String pathInfo = request.getPathInfo();
        if (pathInfo == null || pathInfo.equals("/")) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        String fileId = pathInfo.substring(1);

        // Production: lookup by fileId from DB, not path directly.
        // This demo assumes sanitized id maps to file.
        if (!fileId.matches("[a-zA-Z0-9._-]+")) {
            response.sendError(HttpServletResponse.SC_BAD_REQUEST);
            return;
        }

        Path file = finalDir.resolve(fileId).normalize();
        if (!file.startsWith(finalDir) || !Files.isRegularFile(file)) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        // Production: authorization check here.
        String downloadName = file.getFileName().toString();
        String contentType = Files.probeContentType(file);
        if (contentType == null) {
            contentType = "application/octet-stream";
        }

        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "private, no-store");

        try {
            RangeDownloads.sendFile(request, response, file, contentType, downloadName);
        } catch (IOException e) {
            if (isClientAbort(e)) {
                // log as client abort, not server error
                return;
            }
            throw e;
        }
    }

    private boolean isClientAbort(Throwable t) {
        while (t != null) {
            String className = t.getClass().getName();
            String message = t.getMessage();
            if (className.contains("ClientAbortException")) return true;
            if (message != null && (
                message.contains("Broken pipe") ||
                message.contains("Connection reset") ||
                message.contains("aborted")
            )) {
                return true;
            }
            t = t.getCause();
        }
        return false;
    }
}
```

---

## 33. Interaction With Async Servlet and Non-Blocking I/O

Untuk upload/download biasa, synchronous streaming sering cukup:

```java
in.transferTo(out);
```

Kenapa? Karena bottleneck sering storage/network, dan thread-per-request model masih acceptable untuk ukuran/traffic moderat.

Async/non-blocking relevan jika:

- request menunggu proses eksternal lama,
- long polling/SSE,
- high connection count,
- container thread harus dilepas saat menunggu event,
- streaming ke slow client dengan model readiness callback.

Tetapi untuk file besar, solusi arsitektural sering lebih baik daripada membuat servlet non-blocking kompleks:

```text
object storage + signed URL + CDN
```

atau:

```text
proxy offload with X-Accel-Redirect / X-Sendfile
```

Jangan gunakan async/non-blocking hanya karena terdengar advanced. Gunakan ketika bottleneck dan lifecycle-nya memang sesuai.

---

## 34. Virtual Threads and File Transfer

Java 21+ virtual threads dapat membuat blocking code lebih murah dari sisi thread scalability.

Contoh blocking copy:

```java
Files.copy(input, output);
```

Dengan virtual thread, blocking thread tidak semahal platform thread. Tetapi virtual threads tidak menghapus bottleneck:

- bandwidth tetap terbatas,
- disk I/O tetap terbatas,
- DB connection tetap terbatas,
- storage client connection pool tetap terbatas,
- proxy timeout tetap ada,
- temp disk tetap bisa penuh,
- client tetap bisa lambat.

Virtual threads membantu concurrency model, bukan mengganti capacity planning.

Untuk upload/download besar, tetap butuh:

- admission control,
- size limit,
- rate limit,
- timeout,
- quota,
- storage offload,
- observability.

---

## 35. Capacity Planning Mental Model

Misal:

```text
average upload size = 10 MB
upload rate         = 20 uploads/minute
average duration    = 15 seconds
```

Concurrent upload kira-kira:

```text
arrival_rate_per_second = 20 / 60 = 0.333
concurrency = arrival_rate * duration = 0.333 * 15 = 5 active uploads
```

Bandwidth:

```text
20 uploads/min * 10 MB = 200 MB/min = ~3.33 MB/s
```

Tapi peak bisa 10x.

Resource yang harus dihitung:

- inbound bandwidth,
- outbound bandwidth,
- temp disk capacity,
- temp disk IOPS,
- storage write throughput,
- thread/concurrency,
- scanner throughput,
- DB metadata write rate,
- cleanup job lag.

Jika max file 100 MB dan 100 user upload bersamaan, temp disk worst case bisa:

```text
100 * 100 MB = 10 GB
```

Belum termasuk overhead dan retry.

---

## 36. Security Checklist

Upload:

- [ ] Authentication required.
- [ ] Authorization per target entity.
- [ ] Max file size configured at all layers.
- [ ] Max request size configured at all layers.
- [ ] Allowlist extension.
- [ ] Allowlist/detection content type.
- [ ] Magic number or parser validation for sensitive types.
- [ ] Malware scan if file is shared/downloaded.
- [ ] Filename sanitized for display only.
- [ ] Storage key generated server-side.
- [ ] Path traversal prevented.
- [ ] Upload not stored in web root.
- [ ] Temp directory controlled and monitored.
- [ ] Quota/rate limit/concurrency limit defined.
- [ ] Metadata/file lifecycle status exists.
- [ ] Orphan cleanup process exists.
- [ ] Audit trail without logging raw content.

Download:

- [ ] Authorization checked for content, not only metadata.
- [ ] File ID mapped through metadata, not raw path.
- [ ] `Content-Disposition` safe.
- [ ] `X-Content-Type-Options: nosniff` for untrusted files.
- [ ] `Content-Type` controlled.
- [ ] Cache policy correct.
- [ ] Client abort classified.
- [ ] Range support/offload considered for large files.
- [ ] Signed URL expiry short if used.
- [ ] Sensitive files not publicly cacheable.

---

## 37. Production Readiness Checklist

Architecture:

- [ ] Is Servlet app the right place to carry file bytes?
- [ ] Should upload/download be offloaded to object storage/CDN/proxy?
- [ ] Is resumable upload needed?
- [ ] Is asynchronous scanning needed?
- [ ] Is metadata consistency handled?

Runtime:

- [ ] Proxy body limit aligned.
- [ ] Container body limit aligned.
- [ ] Multipart limit aligned.
- [ ] Temp directory mounted and monitored.
- [ ] Timeouts aligned.
- [ ] Graceful shutdown handles active transfers.
- [ ] Large transfers do not starve request thread pool.

Observability:

- [ ] Upload/download metrics exist.
- [ ] Error categories are distinguishable.
- [ ] Client abort not logged as noisy error.
- [ ] Temp disk alert exists.
- [ ] Storage latency visible.
- [ ] Scanner latency visible.
- [ ] Orphan cleanup reported.

Operations:

- [ ] Cleanup job for stale temp/quarantine/orphan files.
- [ ] Backfill/reconciliation tool exists.
- [ ] Runbook for disk full.
- [ ] Runbook for high 413.
- [ ] Runbook for high broken pipe.
- [ ] Runbook for scanner outage.

---

## 38. Common Interview/Architecture Questions

### 38.1 “How do you safely implement file upload in Servlet?”

Jawaban kuat:

> I would not treat file upload as just `request.getPart()` and `part.write()`. I would define max size at proxy, connector, multipart config, and application layers; store bytes using a server-generated key; sanitize the client filename only as display metadata; validate extension, declared type, and file signature; write to quarantine/temp storage; compute checksum; scan if the file can be downloaded by others; persist metadata with lifecycle status; and have orphan cleanup for storage/DB inconsistency. I would also monitor temp disk, rejection rates, scan latency, storage latency, and client aborts.

### 38.2 “Why not store uploaded files in DB as BLOB?”

Jawaban nuanced:

> It depends. DB BLOB can simplify transaction consistency and backup for small files, but large/high-volume files can bloat database storage, backups, replication, and query performance. Object storage or filesystem with metadata in DB usually scales better for large files, but introduces consistency/orphan cleanup concerns. The right answer depends on file size, access pattern, retention, compliance, backup, and transactional requirements.

### 38.3 “How do you handle large file downloads?”

Jawaban kuat:

> First I decide whether the app should stream bytes at all. For large files, signed object storage URLs, CDN, or proxy offload are usually better. If the Servlet app streams, I set correct `Content-Type`, `Content-Disposition`, `Content-Length`, cache headers, and ideally support range requests or delegate range to storage/proxy. I stream with a bounded buffer, avoid loading into memory, classify client aborts separately, align proxy/app timeouts, and monitor bytes served, duration, aborts, and storage latency.

### 38.4 “Why can `Content-Type` not be trusted during upload?”

Because it is client-supplied metadata. It can be wrong or malicious. Use allowlist, extension check, magic number, parser validation, and scanner where required.

### 38.5 “What causes upload to fail before reaching Servlet?”

Possible causes:

- CDN/WAF body limit,
- reverse proxy body limit,
- ingress limit,
- load balancer timeout,
- connector max post size,
- TLS/protocol failure,
- client disconnect.

That is why checking only application logs is insufficient.

---

## 39. Deep Mental Model Summary

Upload/download is a high-risk runtime area because it crosses many boundaries:

```text
protocol boundary
resource boundary
security boundary
storage boundary
transaction boundary
browser boundary
proxy boundary
observability boundary
```

A weak engineer sees:

```text
file upload = getPart + write
file download = Files.copy
```

A strong engineer sees:

```text
file upload = untrusted byte stream + metadata validation + bounded resource usage + lifecycle state + cleanup + security + storage consistency

file download = authorization + metadata resolution + protocol headers + streaming/offload + cache/range semantics + client abort handling
```

A top-tier engineer asks:

1. Where can this fail?
2. Who owns cleanup?
3. Which layer rejects oversized payload?
4. Does the app need to carry bytes, or can storage/proxy do it?
5. Can user input control path, content type, or rendered behavior?
6. What happens during redeploy or node shutdown?
7. What metrics prove the feature is healthy?
8. How do we reconcile DB metadata and file storage?
9. How do we prevent one user from exhausting shared resources?
10. How do we recover safely from partial success?

---

## 40. Practical Exercise

Design a document upload feature for a regulatory case management system.

Requirements:

- Users can upload PDF, PNG, JPEG.
- Max file size 20 MB.
- File is attached to a case.
- File must not be visible until malware scan passes.
- Users can download only files for cases they can access.
- Audit log must record upload/download event.
- System runs behind reverse proxy and Kubernetes ingress.
- Files are stored in object storage.

Proposed design:

```text
POST /cases/{caseId}/documents
  -> authorize user can attach document to case
  -> validate multipart metadata
  -> stream file to quarantine object key
  -> compute sha256 and size
  -> insert document metadata status=QUARANTINED
  -> publish scan job
  -> return 202 Accepted with documentId

scanner worker
  -> read quarantine object
  -> scan
  -> if OK, promote/copy to available object key, status=AVAILABLE
  -> if FAIL, status=REJECTED, delete or retain quarantine per policy

GET /cases/{caseId}/documents/{documentId}
  -> authorize metadata access
  -> return metadata/status

GET /cases/{caseId}/documents/{documentId}/content
  -> authorize content access
  -> require status=AVAILABLE
  -> generate short-lived signed URL or stream through app
  -> audit download intent/completion depending architecture
```

Important invariants:

```text
document.status = AVAILABLE implies available object exists
user cannot download QUARANTINED/REJECTED documents unless admin policy allows
storage key is never derived from submitted filename
all oversized payloads are rejected before exhausting temp disk
scanner outage does not make unsafe files available
```

---

## 41. References

Primary specifications and APIs:

- Jakarta Servlet 6.1 Specification
- Jakarta Servlet API: `@MultipartConfig`
- Jakarta Servlet API: `MultipartConfigElement`
- Jakarta Servlet API: `Part`
- Jakarta Servlet API: `HttpServletRequest`
- Jakarta Servlet API: `HttpServletResponse`
- RFC 9110: HTTP Semantics
- RFC 6266 / modern HTTP references for `Content-Disposition`
- RFC 7233 / HTTP range request semantics, now consolidated into modern HTTP specifications
- MDN Web Docs: `Content-Disposition`, `Range`, `Content-Range`, `Cache-Control`, `Content-Type`

Container/runtime references to consult during implementation:

- Apache Tomcat connector configuration
- Jetty server connector and resource handling documentation
- Undertow/WildFly server handler and multipart configuration documentation
- Reverse proxy documentation for body size, buffering, timeout, and internal redirect features

---

## 42. What Comes Next

Next part:

```text
Part 017 — Error Handling and Failure Semantics in Servlet Apps
```

Part berikutnya akan membahas error handling secara sistematis:

- exception propagation,
- `sendError`,
- error page mapping,
- error dispatch,
- JSON/HTML error response,
- container vs application failure,
- proxy-visible 502/503/504,
- observability dan taxonomy error produksi.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime — Part 015](./learn-java-servlet-websocket-web-container-runtime-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-017](./learn-java-servlet-websocket-web-container-runtime-part-017.md)

</div>