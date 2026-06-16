# Part 17 — Multipart, File Upload, Download, and Large Payload Engineering

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Previous part: `16-server-sent-events-and-streaming-apis-with-jersey.md`  
Next part: `18-security-integration-authentication-authorization-principal-roles-context.md`

---

## 0. Tujuan Pembelajaran

Pada part ini kita membahas **large payload engineering** di Jersey: file upload, multipart request, download besar, streaming response, dan boundary keamanan di sekitar file.

Tujuannya bukan sekadar bisa menulis:

```java
@POST
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(@FormDataParam("file") InputStream file) { ... }
```

Targetnya jauh lebih dalam:

1. memahami perbedaan **form urlencoded**, **multipart/form-data**, **raw binary**, dan **streaming response**;
2. memahami bagaimana body besar bergerak melewati HTTP server, servlet container, Jersey provider, resource method, storage, scanner, dan database metadata;
3. bisa mencegah failure seperti OOM, temp disk full, file descriptor leak, request timeout, response buffering, partial write, dan connection reset;
4. bisa mendesain upload/download API yang aman terhadap path traversal, MIME spoofing, zip bomb, malicious filename, dan payload abuse;
5. bisa membuat pola production-grade untuk regulatory/enterprise system: audit, checksum, idempotency, quarantine, virus scanning, authorization, dan retention.

Part ini sengaja tidak mengulang konsep HTTP multipart dasar terlalu panjang, karena kamu sudah melewati HTTP/protocol, servlet, security, validation, dan JAX-RS advanced. Fokus kita adalah **Jersey-specific runtime behavior + production design**.

---

## 1. Mental Model: File API Bukan “DTO Besar”

Kesalahan umum engineer adalah memperlakukan file upload/download seperti JSON request biasa yang ukurannya kebetulan besar.

Itu salah secara mental model.

JSON request kecil biasanya bisa dipikirkan seperti ini:

```text
client
  -> HTTP body
  -> Jersey MessageBodyReader
  -> DTO object in memory
  -> service layer
  -> database
```

File upload besar harus dipikirkan seperti ini:

```text
client
  -> TCP stream
  -> reverse proxy / load balancer
  -> servlet container request body handling
  -> Jersey multipart provider / entity stream
  -> application streaming logic
  -> temporary storage / direct storage
  -> scanner / validator / hash calculator
  -> durable storage
  -> metadata database
  -> audit trail
```

File download besar juga bukan sekadar:

```java
return Response.ok(bytes).build();
```

Untuk file besar, itu adalah anti-pattern karena seluruh isi file masuk memory.

Mental model yang lebih benar:

```text
metadata lookup
  -> authorization check
  -> storage stream open
  -> response headers finalized
  -> stream bytes progressively
  -> close stream reliably
  -> record audit event
  -> handle client disconnect
```

Jadi file API adalah **stream lifecycle problem**, bukan hanya serialization problem.

---

## 2. Empat Bentuk Payload yang Harus Dibedakan

Sebelum masuk Jersey API, bedakan empat bentuk request body ini.

### 2.1 `application/x-www-form-urlencoded`

Biasanya dipakai untuk simple HTML form:

```http
Content-Type: application/x-www-form-urlencoded

name=report.pdf&type=monthly
```

Cocok untuk data kecil berbasis key-value.

Tidak cocok untuk file besar karena data binary harus di-encode dan form parsing cenderung tidak efisien untuk payload besar.

### 2.2 `multipart/form-data`

Dipakai ketika satu request membawa beberapa part:

```text
part 1: metadata field
part 2: file content
part 3: optional business flag
```

Contoh konseptual:

```http
Content-Type: multipart/form-data; boundary=abc

--abc
Content-Disposition: form-data; name="caseId"

CASE-001
--abc
Content-Disposition: form-data; name="file"; filename="evidence.pdf"
Content-Type: application/pdf

<binary bytes>
--abc--
```

Cocok untuk upload yang perlu membawa metadata + file dalam satu request.

### 2.3 Raw Binary Upload

Contoh:

```http
PUT /documents/{id}/content
Content-Type: application/pdf

<binary bytes>
```

Cocok jika metadata sudah dibuat sebelumnya, dan endpoint hanya menerima konten file.

Pattern ini sering lebih bersih untuk large object workflow:

```text
1. POST /documents/metadata
2. PUT  /documents/{id}/content
3. POST /documents/{id}/submit
```

### 2.4 Streaming Download

Response ditulis secara bertahap:

```text
storage InputStream -> HTTP response OutputStream
```

JAX-RS/Jakarta REST menyediakan `StreamingOutput` sebagai cara lightweight untuk menulis response stream tanpa membuat `MessageBodyWriter` custom.

---

## 3. Jersey Multipart: Apa yang Ditambahkan Jersey di Atas Jakarta REST

Secara spec, Jakarta REST menyediakan framework resource method, media type, entity provider, dan streaming entity. Jersey menambahkan module multipart yang praktis untuk membaca/menulis MIME multipart.

Di Jersey 2.x, biasanya memakai dependency seperti:

```xml
<dependency>
  <groupId>org.glassfish.jersey.media</groupId>
  <artifactId>jersey-media-multipart</artifactId>
  <version>${jersey.version}</version>
</dependency>
```

Untuk Jersey 2.x, fitur multipart biasanya perlu didaftarkan:

```java
import org.glassfish.jersey.media.multipart.MultiPartFeature;
import org.glassfish.jersey.server.ResourceConfig;

public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
        register(MultiPartFeature.class);
    }
}
```

Untuk Jersey 3.1.x, dokumentasi Jersey menyebut multipart didukung oleh Jakarta REST 3.1 multipart API dan `MultiPartFeature` tidak lagi perlu didaftarkan secara manual pada versi tersebut; tetapi dalam production, tetap penting memverifikasi versi Jersey dan artifact yang dipakai, karena perbedaan minor versi dan packaging bisa memengaruhi auto-registration.

### 3.1 Namespace Penting

Jersey 2.x:

```java
import javax.ws.rs.*;
import org.glassfish.jersey.media.multipart.FormDataParam;
```

Jersey 3.x/4.x:

```java
import jakarta.ws.rs.*;
import org.glassfish.jersey.media.multipart.FormDataParam;
```

Perhatikan: package Jersey multipart tetap berada di `org.glassfish.jersey.media.multipart`, sedangkan JAX-RS/Jakarta REST annotation berubah dari `javax.ws.rs` ke `jakarta.ws.rs`.

---

## 4. Upload API Design: Pilihan Kontrak

Sebelum menulis code, tentukan model API.

### 4.1 Model A — Single Multipart Upload

```http
POST /cases/{caseId}/documents
Content-Type: multipart/form-data

part: category
part: description
part: file
```

Cocok ketika:

- file tidak terlalu besar;
- metadata dan file memang harus atomik secara business;
- client sederhana;
- upload jarang gagal di tengah;
- tidak perlu resumable upload.

Kelemahan:

- metadata dan file bercampur di satu transaction boundary;
- retry sulit jika file besar;
- failure di akhir upload membuang semua effort client;
- server harus menangani multipart parsing.

### 4.2 Model B — Metadata First, Content Later

```http
POST /documents
Content-Type: application/json

{
  "caseId": "CASE-001",
  "category": "EVIDENCE",
  "filename": "evidence.pdf"
}
```

Lalu:

```http
PUT /documents/{documentId}/content
Content-Type: application/pdf

<binary stream>
```

Cocok untuk:

- file besar;
- workflow kompleks;
- scan/quarantine;
- idempotency;
- retry;
- regulatory audit;
- object storage integration.

Kelemahan:

- butuh state machine dokumen;
- ada dokumen metadata tanpa content jika upload gagal;
- butuh cleanup job.

State machine sederhana:

```text
DRAFT_METADATA
  -> UPLOADING
  -> UPLOADED
  -> SCANNING
  -> ACCEPTED
  -> REJECTED
  -> EXPIRED
```

### 4.3 Model C — Pre-Signed Object Storage Upload

```text
client -> API: request upload slot
API -> client: upload URL + documentId
client -> object storage: upload file
client -> API: complete upload
API -> scanner/indexer/workflow
```

Cocok untuk cloud-native large file upload.

Kelebihan:

- traffic file besar tidak melewati application pod;
- mengurangi memory/thread pressure di Jersey app;
- storage service menangani upload besar lebih baik;
- lebih scalable.

Kekurangan:

- security dan callback lebih kompleks;
- perlu scan sebelum file dianggap trusted;
- perlu prevent client bypass workflow;
- perlu signed URL expiry dan policy ketat.

### 4.4 Model D — Resumable/Chunked Upload

```text
POST /uploads
PATCH /uploads/{id}/chunks/{index}
POST /uploads/{id}/complete
```

Cocok untuk file sangat besar atau network tidak stabil.

Kelemahan besar:

- jauh lebih kompleks;
- perlu chunk hash;
- perlu ordering;
- perlu dedup;
- perlu cleanup;
- perlu concurrency control;
- perlu final assembly.

Untuk kebanyakan enterprise internal app, Model B atau C biasanya lebih sehat daripada langsung membangun resumable upload sendiri.

---

## 5. Basic Multipart Upload dengan Jersey

Contoh minimal:

```java
package com.example.documents.api;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.glassfish.jersey.media.multipart.FormDataContentDisposition;
import org.glassfish.jersey.media.multipart.FormDataParam;

import java.io.InputStream;

@Path("/documents")
@Produces(MediaType.APPLICATION_JSON)
public class DocumentResource {

    private final DocumentUploadService uploadService;

    public DocumentResource(DocumentUploadService uploadService) {
        this.uploadService = uploadService;
    }

    @POST
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    public Response upload(
            @FormDataParam("caseId") String caseId,
            @FormDataParam("category") String category,
            @FormDataParam("file") InputStream fileStream,
            @FormDataParam("file") FormDataContentDisposition fileMeta
    ) {
        UploadResult result = uploadService.upload(
                new UploadCommand(
                        caseId,
                        category,
                        fileMeta.getFileName(),
                        fileMeta.getSize(),
                        fileStream
                )
        );

        return Response.status(Response.Status.CREATED)
                .entity(result)
                .build();
    }
}
```

Namun contoh ini belum production-grade.

Masalah yang belum ditangani:

- ukuran file belum dibatasi;
- filename belum dinormalisasi;
- content type belum divalidasi;
- file stream langsung diproses tanpa hashing;
- belum ada antivirus/quarantine;
- belum ada audit;
- belum ada idempotency;
- belum jelas apakah service boleh menyimpan stream setelah method return;
- belum jelas cleanup jika gagal di tengah.

---

## 6. Production Upload: Jangan Percaya Metadata Client

Client dapat mengirim:

```http
Content-Disposition: form-data; name="file"; filename="invoice.pdf"
Content-Type: application/pdf
```

Tetapi body sebenarnya bisa saja:

- executable;
- HTML berisi script;
- ZIP bomb;
- file polyglot;
- PDF malicious;
- file terenkripsi yang tidak bisa discan;
- file dengan extension palsu;
- file kosong;
- file terlalu besar;
- file dengan nama `../../etc/passwd`;
- file dengan Unicode confusable character.

Prinsipnya:

```text
filename dari client = display hint, bukan storage path
Content-Type dari client = claim, bukan bukti
file extension = weak signal, bukan validasi final
size dari header = hint, bukan enforcement final
```

Yang harus divalidasi server:

1. authenticated user;
2. authorization ke case/entity;
3. allowed document category;
4. allowed file extension;
5. allowed detected MIME type;
6. max file size;
7. min file size;
8. hash/checksum;
9. virus/malware status;
10. storage write success;
11. metadata persistence success;
12. audit event.

---


## 7. Filename Handling: Jangan Pernah Memakai Filename Client sebagai Path

Buruk:

```java
Path target = Paths.get("/data/uploads", fileMeta.getFileName());
Files.copy(fileStream, target);
```

Masalah:

```text
filename = ../../../../etc/passwd
filename = C:\Windows\system32\drivers\etc\hosts
filename = report.pdf.exe
filename = report\u0000.pdf
filename = very-long-name....
filename = visually-confusing-unicode.pdf
```

Prinsip aman:

```text
original_filename = metadata display/audit only
storage_key       = generated by server
filesystem path   = never derived directly from client filename
```

Contoh utility sederhana:

```java
import java.text.Normalizer;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

public final class SafeFilenames {
    private static final Pattern CONTROL = Pattern.compile("[\\p{Cntrl}]");
    private static final Pattern UNSAFE = Pattern.compile("[^a-zA-Z0-9._ -]");

    private SafeFilenames() {}

    public static String displayName(String input) {
        if (input == null || input.isBlank()) return "unnamed";
        String normalized = Normalizer.normalize(input, Normalizer.Form.NFKC);
        normalized = CONTROL.matcher(normalized).replaceAll("");
        normalized = normalized.replace('\\', '/');
        normalized = normalized.substring(normalized.lastIndexOf('/') + 1);
        normalized = UNSAFE.matcher(normalized).replaceAll("_").trim();
        if (normalized.isEmpty() || normalized.equals(".") || normalized.equals("..")) return "unnamed";
        return normalized.length() > 150 ? normalized.substring(0, 150) : normalized;
    }

    public static Optional<String> safeExtension(String input) {
        String name = displayName(input);
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return Optional.empty();
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return ext.matches("[a-z0-9]{1,12}") ? Optional.of(ext) : Optional.empty();
    }
}
```

Utility seperti ini bukan pengganti antivirus/scanner. Ini hanya memastikan filename tidak menjadi attack vector langsung.

---

## 8. Size Limit: Layered Enforcement

Ukuran file harus dibatasi di beberapa layer:

```text
browser/client validation
  -> API gateway / reverse proxy body limit
  -> servlet container request limit
  -> multipart parser / Jersey behavior
  -> application counting stream
  -> storage policy
```

Jangan hanya percaya `Content-Length`, karena request bisa memakai chunked transfer atau header bisa hilang/tidak akurat.

Application-level counting stream:

```java
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

public final class MaxBytesInputStream extends FilterInputStream {
    private final long maxBytes;
    private long readBytes;

    public MaxBytesInputStream(InputStream in, long maxBytes) {
        super(in);
        this.maxBytes = maxBytes;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int n = super.read(b, off, len);
        if (n > 0) increment(n);
        return n;
    }

    @Override
    public int read() throws IOException {
        int b = super.read();
        if (b != -1) increment(1);
        return b;
    }

    private void increment(long n) throws IOException {
        readBytes += n;
        if (readBytes > maxBytes) {
            throw new PayloadTooLargeIOException(maxBytes);
        }
    }
}
```

---

## 9. Stream Copy: Hashing, Counting, and Close Ownership

Upload yang baik biasanya melakukan beberapa hal dalam satu pass:

```text
read stream progressively
  -> enforce max bytes
  -> calculate SHA-256
  -> write to quarantine/object storage
  -> flush/close output
```

Java 11+:

```java
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class StreamCopy {
    private static final int BUFFER_SIZE = 64 * 1024;

    public static CopyResult copyWithSha256(InputStream source, OutputStream target, long maxBytes)
            throws IOException {
        MessageDigest digest = sha256();
        long total = 0L;

        try (DigestInputStream digesting = new DigestInputStream(source, digest)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int n;
            while ((n = digesting.read(buffer)) != -1) {
                total += n;
                if (total > maxBytes) throw new PayloadTooLargeIOException(maxBytes);
                target.write(buffer, 0, n);
            }
            target.flush();
        }

        return new CopyResult(total, HexFormat.of().formatHex(digest.digest()));
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public record CopyResult(long bytes, String sha256Hex) {}
}
```

Untuk Java 8, ganti `HexFormat` dan `record` dengan class biasa.

Ownership rule:

```text
InputStream dari request harus dibaca selama request masih aktif.
Jangan simpan InputStream request untuk background job.
Background job harus memakai object key/path yang sudah tersimpan, bukan request stream.
```

Anti-pattern:

```java
executor.submit(() -> storage.write(requestInputStream));
return Response.accepted().build();
```

Begitu request selesai, lifecycle stream tidak lagi aman.

---

## 10. Quarantine Pattern

File yang baru diupload sebaiknya tidak langsung available.

```text
upload request
  -> write to quarantine storage
  -> status = UPLOADED_PENDING_SCAN
  -> enqueue scan job
  -> scanner validates malware/type/policy
  -> if clean: status = ACCEPTED
  -> if unsafe: status = REJECTED
```

State machine:

```text
INITIATED
  -> UPLOADING
  -> UPLOADED_PENDING_SCAN
  -> SCANNING
  -> ACCEPTED
  -> REJECTED_MALWARE
  -> REJECTED_POLICY
  -> EXPIRED
```

Invariants:

```text
Only ACCEPTED document can be downloaded by normal users.
Quarantine object is never served directly.
Every state transition is auditable.
Hash is calculated from actual bytes before acceptance.
Rejected object follows retention/security policy.
```

Service sketch:

```java
public final class DocumentUploadService {
    private final DocumentRepository repository;
    private final ObjectStorage quarantineStorage;
    private final ScanQueue scanQueue;
    private final AuditService auditService;

    public UploadResult upload(UploadCommand command) {
        String documentId = DocumentIds.newId();
        String displayName = SafeFilenames.displayName(command.originalFilename());
        String objectKey = "quarantine/" + documentId;

        try (OutputStream out = quarantineStorage.openWrite(objectKey)) {
            StreamCopy.CopyResult copy = StreamCopy.copyWithSha256(
                    command.fileStream(), out, command.maxAllowedBytes());

            DocumentRecord record = DocumentRecord.pendingScan(
                    documentId,
                    command.caseId(),
                    command.category(),
                    displayName,
                    objectKey,
                    copy.bytes(),
                    copy.sha256Hex()
            );

            repository.insert(record);
            scanQueue.enqueue(documentId);
            auditService.recordDocumentUploaded(documentId, command.caseId(), copy.bytes(), copy.sha256Hex());
            return new UploadResult(documentId, "UPLOADED_PENDING_SCAN");
        } catch (PayloadTooLargeIOException e) {
            throw new PayloadTooLargeRuntimeException(e.maxBytes(), e);
        } catch (IOException e) {
            throw new DocumentUploadFailedException("Failed to store uploaded file", e);
        }
    }
}
```

---

## 11. Idempotency untuk Upload

Upload sangat retry-prone:

```text
client upload selesai, response timeout
user klik upload ulang
server mencatat dua dokumen
```

Gunakan header:

```http
Idempotency-Key: 7f65f6d4-0f5f-4a7e-bd6e-7a01f6f019a2
```

Server menyimpan:

```text
scope: user + caseId + operation + idempotencyKey
fingerprint: filename + size + optional client hash + category
result: documentId + status
expires_at
```

Jika key sama dan fingerprint sama, return result lama. Jika key sama tetapi fingerprint beda, return `409 Conflict` atau `422 Unprocessable Entity`.

---

## 12. MIME Validation: Claim vs Evidence

Sumber informasi type:

```text
Content-Type header dari part
filename extension
magic bytes / sniffing
parser-specific validation
antivirus/scanner verdict
business allowlist
```

Rule aman:

```text
client Content-Type = claim
extension = weak signal
sniffing/scanner = stronger evidence
business policy = final decision
```

Minimal policy:

```text
extension allowed
claimed MIME allowed
detected MIME compatible
file non-empty
file passes malware scan
```

Untuk format kompleks seperti PDF/DOCX/ZIP, jangan parse berat di request thread bila bisa dipindah ke scanner worker.

---

## 13. Archive/ZIP Bomb Handling

Jika ZIP/archive diizinkan, tambahkan guard:

```text
max compressed size
max decompressed size
max entry count
max nesting depth
max entry filename length
no absolute path
no parent traversal
no symlink extraction unless explicitly safe
scan before extraction
extract only into controlled temp directory
```

Archive adalah salah satu area paling berbahaya untuk upload API karena ukuran kecil bisa meledak menjadi data sangat besar saat diekstrak.

---

## 14. Temporary Storage Engineering

Failure mode temp storage:

```text
temp disk full
pod ephemeral storage exhausted
node disk pressure eviction
partial upload left behind
scanner backlog fills quarantine
cleanup job missing
```

Checklist:

```text
[ ] explicit temp/quarantine location
[ ] max upload size
[ ] max concurrent upload
[ ] cleanup stale temporary object
[ ] monitor disk/object count
[ ] alert on scanner backlog
[ ] Kubernetes ephemeral-storage request/limit if using local temp
```

Untuk file besar, stream ke object storage/quarantine storage lebih baik daripada menumpuk di local `/tmp` tanpa observability.

---

## 15. Download: Jangan Return `byte[]` untuk File Besar

Buruk:

```java
byte[] bytes = storage.readAllBytes(id);
return Response.ok(bytes).build();
```

Lebih baik:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;

import java.io.InputStream;

@Path("/documents")
public class DocumentDownloadResource {
    private final DocumentDownloadService service;

    @GET
    @Path("/{id}/content")
    public Response download(@PathParam("id") String id) {
        DownloadDescriptor descriptor = service.authorizeAndDescribe(id);

        StreamingOutput body = output -> {
            try (InputStream in = service.openContentStream(id)) {
                in.transferTo(output); // Java 9+
            }
        };

        return Response.ok(body, descriptor.mediaType())
                .header("Content-Disposition", contentDispositionAttachment(descriptor.displayFilename()))
                .header("Content-Length", descriptor.sizeBytes())
                .header("ETag", '"' + descriptor.sha256Hex() + '"')
                .header("Cache-Control", "no-store")
                .build();
    }
}
```

Untuk Java 8, gunakan copy loop manual:

```java
byte[] buffer = new byte[64 * 1024];
int n;
while ((n = in.read(buffer)) != -1) {
    output.write(buffer, 0, n);
}
```

`StreamingOutput` berguna ketika aplikasi ingin menulis response langsung ke output stream sebagai alternatif ringan dari `MessageBodyWriter` custom.

---

## 16. Content-Disposition Aman

```java
private static String contentDispositionAttachment(String displayFilename) {
    String safe = SafeFilenames.displayName(displayFilename)
            .replace("\"", "_")
            .replace("\r", "_")
            .replace("\n", "_");
    return "attachment; filename=\"" + safe + "\"";
}
```

Untuk nama file internasional, pertimbangkan juga `filename*` encoding. Tetapi tetap sanitize CR/LF agar tidak terjadi header injection.

---

## 17. Download Authorization dan Audit

Urutan benar:

```text
authenticate user
  -> load metadata
  -> check authorization
  -> check status == ACCEPTED
  -> record DOWNLOAD_STARTED
  -> open storage stream
  -> stream content
  -> record DOWNLOAD_COMPLETED or DOWNLOAD_ABORTED if observable
```

Jangan buka file stream sebelum authorization.

Untuk sistem regulatory, audit minimal:

```text
who
which case
which document
when
operation
result
correlation id
source IP/session if available
```

Bedakan `DOWNLOAD_STARTED` dan `DOWNLOAD_COMPLETED` jika compliance membutuhkan bukti bahwa transfer benar-benar selesai.

---

## 18. Client Disconnect dan Partial Write

Client bisa memutus koneksi saat download:

```text
browser closed
network lost
proxy timeout
mobile network switch
```

Write ke response stream bisa menghasilkan `IOException`. Ini tidak selalu berarti bug server.

Logging/metrics harus membedakan:

```text
storage read failure
client aborted download
server-side timeout
proxy timeout
```

Jika semua masuk HTTP 500, observability menjadi misleading.

---

## 19. Range Request

Range request berguna untuk resume download atau media streaming:

```http
Range: bytes=1000-1999
```

Response:

```http
206 Partial Content
Content-Range: bytes 1000-1999/5000
```

Dukung hanya jika storage bisa range read/seek. Jika tidak, lebih baik reject dengan jelas daripada implementasi setengah benar.

Minimal yang harus benar:

```text
validate range header
check authorization first
return 206 for valid range
return 416 for invalid range
set Content-Range
avoid reading entire file just to skip bytes
```

---

## 20. Response Header Policy

Sensitive document:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="evidence.pdf"
Content-Length: 123456
Cache-Control: no-store
ETag: "sha256-or-version"
```

Public immutable asset:

```http
Cache-Control: public, max-age=31536000, immutable
```

Case/regulatory document biasanya default ke:

```http
Cache-Control: no-store
```

---

## 21. Raw Binary Upload Pattern

Untuk large file, raw binary endpoint sering lebih bersih daripada multipart.

```java
@PUT
@Path("/{id}/content")
@Consumes({"application/pdf", "image/png", "image/jpeg", "application/octet-stream"})
public Response uploadContent(
        @PathParam("id") String documentId,
        @HeaderParam("Content-Type") String contentType,
        @HeaderParam("Content-Length") Long contentLength,
        InputStream body
) {
    UploadContentResult result = service.uploadContent(
            new UploadContentCommand(documentId, contentType, contentLength, body)
    );
    return Response.ok(result).build();
}
```

Kelebihan:

```text
body hanya file
metadata sudah dibuat sebelumnya
streaming lebih sederhana
retry/idempotency lebih mudah
tidak tergantung multipart parser untuk file content
```

Kekurangan:

```text
butuh two-step workflow
client lebih kompleks
perlu cleanup metadata tanpa content
```

---

## 22. Storage dan Database Tidak Atomic

DB transaction dan object/file storage write biasanya tidak atomic.

| Storage Write | DB Write | Risiko |
|---|---|---|
| failed | skipped | aman |
| success | success | sukses |
| success | failed | orphan object |
| partial | failed | partial object/temp garbage |
| timeout unknown | unknown | uncertain state |

Mitigasi:

```text
write to quarantine/temp key first
persist metadata after write success
if DB write fails, attempt delete object
run orphan sweeper job
use explicit document status
make operation idempotent
```

Sweeper mencari:

```text
quarantine object tanpa DB record
DB record stuck UPLOADING
scan pending beyond SLA
rejected object past retention
```

---

## 23. Metadata Model

Contoh table:

```sql
CREATE TABLE document_file (
    document_id          VARCHAR2(64) PRIMARY KEY,
    case_id              VARCHAR2(64) NOT NULL,
    category             VARCHAR2(64) NOT NULL,
    original_filename    VARCHAR2(255) NOT NULL,
    storage_key          VARCHAR2(512) NOT NULL,
    media_type           VARCHAR2(128),
    size_bytes           NUMBER(19) NOT NULL,
    sha256_hex           VARCHAR2(64) NOT NULL,
    status               VARCHAR2(64) NOT NULL,
    scan_status          VARCHAR2(64),
    uploaded_by          VARCHAR2(128) NOT NULL,
    uploaded_at          TIMESTAMP NOT NULL,
    accepted_at          TIMESTAMP,
    rejected_at          TIMESTAMP,
    version              NUMBER(19) NOT NULL
);
```

Invariants:

```text
storage_key generated server-side
size_bytes measured from actual stream
sha256_hex measured from actual stream
status controls download eligibility
original_filename never used as path
```

---

## 24. Concurrency and State Transition

Concurrent upload ke document yang sama harus dicegah dengan state guard.

```sql
UPDATE document_file
SET status = 'UPLOADED_PENDING_SCAN',
    storage_key = ?,
    size_bytes = ?,
    sha256_hex = ?,
    version = version + 1
WHERE document_id = ?
  AND status = 'INITIATED'
  AND version = ?
```

Affected rows `0` berarti conflict:

```text
409 Conflict
```

---

## 25. Backpressure

Large upload mengonsumsi:

```text
connection
request thread / virtual thread
network bandwidth
storage bandwidth
temp disk
scanner capacity
DB metadata write
```

Batasi concurrent upload:

```java
public final class UploadLimiter {
    private final Semaphore semaphore;

    public UploadLimiter(int maxConcurrentUploads) {
        this.semaphore = new Semaphore(maxConcurrentUploads);
    }

    public <T> T execute(CheckedSupplier<T> supplier) throws Exception {
        if (!semaphore.tryAcquire()) throw new TooManyUploadsException();
        try {
            return supplier.get();
        } finally {
            semaphore.release();
        }
    }
}
```

`TooManyUploadsException` bisa dimapping ke `429` untuk per-user/tenant limit atau `503` untuk server capacity.

---

## 26. Async Scanning

Scan berat sebaiknya tidak dilakukan di request thread.

Response pattern:

```http
202 Accepted
Location: /documents/DOC-001
```

Body:

```json
{
  "documentId": "DOC-001",
  "status": "UPLOADED_PENDING_SCAN"
}
```

Jika resource metadata dianggap sudah dibuat, `201 Created` juga masuk akal. Yang penting status eksplisit dan user/client tahu file belum available.

---

## 27. Error Taxonomy

| Code | HTTP | Meaning |
|---|---:|---|
| `FILE_REQUIRED` | 400 | part file tidak ada |
| `INVALID_MULTIPART` | 400 | multipart malformed |
| `PAYLOAD_TOO_LARGE` | 413 | ukuran melebihi limit |
| `UNSUPPORTED_FILE_TYPE` | 415/422 | type tidak diizinkan |
| `DOCUMENT_NOT_FOUND` | 404 | metadata tidak ditemukan |
| `DOCUMENT_NOT_READY` | 409 | belum accepted/scanned |
| `DOCUMENT_REJECTED` | 409 | rejected oleh scanner/policy |
| `UPLOAD_CONFLICT` | 409 | state/version conflict |
| `TOO_MANY_UPLOADS` | 429/503 | concurrency/capacity limit |
| `STORAGE_UNAVAILABLE` | 503 | storage dependency gagal |

Jangan expose path internal, stack trace, scanner vendor detail, atau object storage credential detail.

---

## 28. Jersey Client Multipart

Jersey Client bisa mengirim multipart memakai `FormDataMultiPart`.

```java
try (FormDataMultiPart multipart = new FormDataMultiPart()) {
    multipart.field("category", "EVIDENCE");
    multipart.bodyPart(new FormDataBodyPart(
            FormDataContentDisposition.name("file")
                    .fileName(file.getName())
                    .build(),
            file,
            MediaType.APPLICATION_OCTET_STREAM_TYPE
    ));

    try (Response response = client.target(baseUrl)
            .path("/cases/{caseId}/documents")
            .resolveTemplate("caseId", caseId)
            .request(MediaType.APPLICATION_JSON_TYPE)
            .header("Idempotency-Key", idempotencyKey)
            .post(Entity.entity(multipart, multipart.getMediaType()))) {

        if (response.getStatus() >= 400) {
            throw new RemoteUploadException(response.getStatus(), response.readEntity(String.class));
        }
        return response.readEntity(UploadResult.class);
    }
}
```

Production notes:

```text
close Response
set timeout
use idempotency key
handle 413/429/503 explicitly
do not blindly retry non-idempotent upload
avoid loading file fully into memory
```

---

## 29. Observability

Metrics:

```text
upload_started_total
upload_completed_total
upload_failed_total
upload_bytes_total
upload_duration_seconds
upload_in_flight
upload_rejected_too_large_total
upload_rejected_type_total
scan_pending_count
scan_duration_seconds
scan_rejected_total
download_started_total
download_completed_total
download_aborted_total
download_bytes_total
download_duration_seconds
storage_write_duration_seconds
storage_read_duration_seconds
```

Log fields:

```text
correlation_id
user_id
case_id
document_id
operation
filename_sanitized
size_bytes
sha256_hex
status
error_code
```

Jangan log raw content file.

---

## 30. Security Checklist

Upload:

```text
[ ] authentication required
[ ] authorization checked before accepting upload
[ ] max file size enforced in multiple layers
[ ] max concurrent upload enforced
[ ] filename sanitized
[ ] original filename never used as path
[ ] content type allowlist
[ ] extension allowlist
[ ] MIME sniffing/scanner validation
[ ] quarantine before availability
[ ] hash calculated from actual bytes
[ ] archive limits if archive allowed
[ ] temp cleanup
[ ] idempotency key supported
[ ] audit event recorded
[ ] no stack trace/path leakage
```

Download:

```text
[ ] metadata loaded before stream
[ ] authorization checked before stream open
[ ] only ACCEPTED document downloadable
[ ] Content-Disposition sanitized
[ ] Cache-Control appropriate
[ ] no-store for sensitive document
[ ] client disconnect handled reasonably
[ ] audit policy defined
[ ] Range either supported correctly or rejected clearly
```

---

## 31. Java 8–25 Considerations

Java 8:

```text
no InputStream.transferTo
no HexFormat
no records
commonly Jersey 2.x / javax.ws.rs
```

Java 11:

```text
InputStream.transferTo available
better modern TLS/runtime baseline
```

Java 17:

```text
important baseline for Jakarta EE 11 / Jakarta REST 4.0 era
```

Java 21/25:

```text
virtual threads may help blocking transfer concurrency only if container/runtime supports them
virtual threads do not remove file size, storage, scanner, bandwidth, or temp disk constraints
```

The real modernization issue is version alignment:

```text
JDK
Jersey
Jakarta REST
Servlet container
JSON provider
Bean Validation
deployment platform
```

---

## 32. Failure Mode Catalogue

| Failure | Cause | Mitigation |
|---|---|---|
| OOM download | `byte[]`/readAllBytes | `StreamingOutput` |
| temp disk full | large multipart/temp files | limit, cleanup, monitor, stream to object storage |
| path traversal | filename used as path | generated storage key |
| MIME spoofing | trust client Content-Type | allowlist + sniffing + scan |
| duplicate upload | retry without idempotency | idempotency key |
| scanner backlog | upload rate > scan capacity | queue metrics + backpressure |
| unscanned download | status not checked | only `ACCEPTED` downloadable |
| header injection | unsafe filename in header | sanitize CR/LF/control chars |
| orphan object | storage success, DB fail | compensation + sweeper |

---

## 33. Case Management Document API Pattern

Endpoint shape:

```text
POST   /cases/{caseId}/documents
GET    /cases/{caseId}/documents
GET    /cases/{caseId}/documents/{documentId}
GET    /cases/{caseId}/documents/{documentId}/content
DELETE /cases/{caseId}/documents/{documentId}
POST   /cases/{caseId}/documents/{documentId}/rescan
```

Upload response:

```json
{
  "documentId": "DOC-2026-000001",
  "caseId": "CASE-001",
  "status": "UPLOADED_PENDING_SCAN",
  "originalFilename": "evidence.pdf",
  "sizeBytes": 184923,
  "sha256": "...",
  "links": {
    "self": "/cases/CASE-001/documents/DOC-2026-000001"
  }
}
```

Document metadata:

```json
{
  "documentId": "DOC-2026-000001",
  "caseId": "CASE-001",
  "category": "EVIDENCE",
  "status": "ACCEPTED",
  "originalFilename": "evidence.pdf",
  "mediaType": "application/pdf",
  "sizeBytes": 184923,
  "sha256": "...",
  "uploadedBy": "user-123",
  "uploadedAt": "2026-06-16T10:15:30Z",
  "acceptedAt": "2026-06-16T10:15:45Z",
  "links": {
    "content": "/cases/CASE-001/documents/DOC-2026-000001/content"
  }
}
```

---

## 34. Testing Strategy

Resource contract tests:

```text
missing file part
missing metadata field
unsupported type
invalid category
file too large
malformed multipart
successful upload
```

Service tests:

```text
hash calculated correctly
storage failure
DB failure compensation
idempotent repeat returns same result
same idempotency key with different file rejected
state transition conflict
```

Security tests:

```text
path traversal filename
CR/LF filename
executable disguised as PDF
archive traversal
unscanned file cannot be downloaded
unauthorized case cannot upload/download
```

Operational tests:

```text
temp disk near full
storage unavailable
scan queue unavailable
DB unavailable after storage write
client disconnect during download
orphan sweeper
```

---

## 35. Mini Exercise

Design Jersey document upload API dengan rules:

```text
max file size: 50 MB
allowed types: PDF, PNG, JPEG
file available only after scan clean
user may retry upload safely
all download must be audited
sensitive document must not be cached
```

Jawab:

1. endpoint apa saja?
2. status dokumen apa saja?
3. di layer mana size limit dipasang?
4. bagaimana idempotency bekerja?
5. kapan audit event dicatat?
6. response apa untuk file pending scan?
7. bagaimana cleanup orphan object?
8. bagaimana mencegah path traversal?

---

## 36. Ringkasan

File upload/download di Jersey adalah area kecil di permukaan tetapi besar di production.

Mental model utama:

```text
file API = stream lifecycle + security boundary + storage consistency + audit problem
```

Jersey menyediakan:

```text
multipart support
@FormDataParam
InputStream entity handling
StreamingOutput
provider/filter/interceptor pipeline
exception mapping
client multipart support
```

Tetapi production-grade design harus kamu bangun sendiri:

```text
limit ukuran di banyak layer
jangan percaya filename/content-type client
stream, jangan buffer seluruh file
quarantine dan scanner
hash dari actual bytes
generated storage key
audit upload/download
partial failure handling
concurrent upload limit
document state machine
failure-mode testing
```

---

## 37. Status Seri

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — selesai
Part 14 — selesai
Part 15 — selesai
Part 16 — selesai
Part 17 — selesai
Part 18 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri belum selesai.
