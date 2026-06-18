# Part 7 — Attachment Handling and Jakarta Activation

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `07-attachment-handling-jakarta-activation.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, JavaBeans Activation Framework / Jakarta Activation, MIME attachments, inline content, memory/resource/security model.

---

## 0. Why This Part Matters

Banyak engineer belajar email attachment dari contoh seperti ini:

```java
MimeBodyPart attachment = new MimeBodyPart();
attachment.attachFile(new File("report.pdf"));
```

Contoh itu tidak salah, tetapi terlalu dangkal untuk production.

Di sistem enterprise, attachment adalah titik temu dari beberapa hal yang rawan gagal:

1. **MIME correctness** — apakah attachment benar-benar dikirim sebagai body part dengan header yang valid?
2. **Memory safety** — apakah file besar diload penuh ke heap?
3. **Filename correctness** — apakah nama file Unicode, spasi, koma, dan karakter non-ASCII tetap terbaca benar di Outlook/Gmail/mobile client?
4. **Content type correctness** — apakah `application/pdf`, `text/csv`, `image/png`, atau `application/octet-stream` dipilih dengan benar?
5. **Security** — apakah user bisa menyisipkan path traversal, header injection, malware, HTML active content, atau file spoofing?
6. **Operational reliability** — apakah attachment masih tersedia saat worker asynchronous mengirim email?
7. **Auditability** — apakah attachment yang dikirim bisa dibuktikan versinya?
8. **Compliance** — apakah PII/sensitive file pantas dikirim sebagai attachment, atau harus diganti secure link?

Top 1% engineer tidak melihat attachment sebagai “file tambahan di email”. Mereka melihatnya sebagai **data payload yang dikemas ke dalam MIME graph, di-stream melalui API abstraction, dikodekan untuk transport SMTP, lalu diterima oleh client dengan interpretasi yang tidak sepenuhnya kita kontrol**.

---

## 1. Mental Model: Attachment Is Not a File, It Is a MIME Body Part

Attachment dalam email bukan “file yang ditempel” secara literal. Email adalah teks terstruktur. Attachment adalah bagian dari struktur MIME.

Secara konseptual:

```text
MimeMessage
└── multipart/mixed
    ├── body-part: text/plain or multipart/alternative
    ├── body-part: application/pdf; disposition=attachment; filename="report.pdf"
    └── body-part: image/png; disposition=attachment; filename="evidence.png"
```

Attachment biasanya diwakili oleh `MimeBodyPart` dengan beberapa hal penting:

```text
Content-Type: application/pdf; name="report.pdf"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="report.pdf"

JVBERi0xLjQKJc...
```

Artinya attachment memiliki:

| Elemen | Makna |
|---|---|
| `Content-Type` | tipe data, misalnya `application/pdf` |
| `Content-Disposition` | bagaimana client menampilkan part: `attachment` atau `inline` |
| `filename` | nama file yang disarankan ke user |
| `Content-Transfer-Encoding` | cara binary data dikodekan agar aman lewat SMTP |
| body content | isi file yang sudah dikodekan |

Jadi ketika kita memakai:

```java
attachment.attachFile(file);
```

Jakarta Mail sebenarnya sedang membantu membangun MIME body part dengan data source, data handler, content type, filename, dan encoding.

---

## 2. The Three-Layer Model: Mail, MIME, Activation

Untuk attachment, ada tiga layer yang perlu dibedakan.

```text
Application Domain
  ↓
Jakarta Mail / JavaMail
  ↓
Jakarta Activation / Java Activation Framework
  ↓
Actual Data Source: file, byte array, stream, URL, database BLOB, object storage
```

### 2.1 Jakarta Mail Layer

Jakarta Mail bertanggung jawab membentuk email message:

- `MimeMessage`
- `MimeMultipart`
- `MimeBodyPart`
- `Transport`
- `Part`
- headers
- recipients
- MIME structure

Attachment di Jakarta Mail biasanya masuk lewat:

```java
MimeBodyPart bodyPart = new MimeBodyPart();
bodyPart.setDataHandler(...);
bodyPart.setFileName(...);
```

atau convenience method:

```java
bodyPart.attachFile(file);
```

### 2.2 Jakarta Activation Layer

Jakarta Activation bertanggung jawab menjembatani “data mentah” dengan “MIME-aware object”.

Komponen penting:

| API | Fungsi |
|---|---|
| `DataSource` | abstraction untuk membaca data + content type + name |
| `DataHandler` | wrapper yang menghubungkan data dengan MIME/content handling |
| `FileDataSource` | `DataSource` berbasis file |
| `URLDataSource` | `DataSource` berbasis URL |
| `FileTypeMap` | mekanisme penentuan MIME type |
| `MimetypesFileTypeMap` | mapping extension ke MIME type |
| `CommandMap` | registry operasi untuk tipe data tertentu |

Dalam konteks email, yang paling sering dipakai adalah:

```text
DataSource -> DataHandler -> MimeBodyPart
```

### 2.3 Actual Data Layer

Data attachment bisa berasal dari:

- local file;
- generated PDF in memory;
- generated CSV stream;
- uploaded file;
- database BLOB;
- object storage;
- remote URL;
- temporary file;
- encrypted package;
- compressed archive.

Top 1% decision ada di layer ini: **jangan asal pilih byte array kalau data bisa besar**.

---

## 3. Java 8–25 Version Landscape

Attachment handling tidak bisa dilepaskan dari namespace dan dependency.

### 3.1 Java 8 Legacy Stack

Typical stack:

```xml
<dependency>
  <groupId>com.sun.mail</groupId>
  <artifactId>javax.mail</artifactId>
  <version>1.6.2</version>
</dependency>
```

Package:

```java
import javax.mail.*;
import javax.mail.internet.*;
import javax.activation.*;
```

Beberapa Java 8 environment mungkin masih punya activation-related classes dari old Java EE/JAF context, tetapi jangan bergantung pada classpath implisit. Di aplikasi modern, declare dependency secara eksplisit.

### 3.2 Java 11+

Java 11 menghapus banyak Java EE module dari JDK distribution. Karena itu, aplikasi yang dulu “kebetulan jalan” bisa gagal dengan:

```text
NoClassDefFoundError: javax/activation/DataSource
NoClassDefFoundError: javax/mail/MessagingException
```

Solusi: declare dependency eksplisit.

### 3.3 Jakarta Mail Modern Stack

Typical modern stack:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>angus-mail</artifactId>
  <version><!-- chosen version --></version>
</dependency>

<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>angus-activation</artifactId>
  <version><!-- chosen version --></version>
</dependency>
```

Package:

```java
import jakarta.mail.*;
import jakarta.mail.internet.*;
import jakarta.activation.*;
```

### 3.4 Critical Rule

Jangan campur ini dalam satu module:

```java
import jakarta.mail.internet.MimeBodyPart;
import javax.activation.DataSource; // bad combination
```

atau:

```java
import javax.mail.internet.MimeBodyPart;
import jakarta.activation.DataSource; // bad combination
```

Pilih satu universe:

| Era | Mail namespace | Activation namespace |
|---|---|---|
| Legacy JavaMail | `javax.mail` | `javax.activation` |
| Modern Jakarta Mail | `jakarta.mail` | `jakarta.activation` |

---

## 4. Core API: DataSource

`DataSource` adalah abstraction untuk data yang punya:

1. input stream;
2. output stream, optional/unsupported;
3. content type;
4. name.

Konsep sederhananya:

```java
public interface DataSource {
    InputStream getInputStream() throws IOException;
    OutputStream getOutputStream() throws IOException;
    String getContentType();
    String getName();
}
```

### 4.1 Why DataSource Exists

Tanpa `DataSource`, `MimeBodyPart` perlu tahu terlalu banyak:

- apakah data berasal dari file?
- byte array?
- URL?
- database?
- object storage?
- stream?
- generated content?

Dengan `DataSource`, `MimeBodyPart` tidak perlu peduli. Ia hanya butuh:

```text
Give me an InputStream.
Tell me your MIME type.
Tell me your suggested name.
```

Ini adalah bentuk classic abstraction boundary.

### 4.2 DataSource Invariant

Untuk email attachment, `DataSource` yang baik harus memenuhi invariant berikut:

```text
Every call to getInputStream() must return a fresh readable stream positioned at the beginning.
```

Ini penting karena mail implementation bisa membaca data lebih dari sekali dalam situasi tertentu, misalnya:

- menghitung encoding;
- retry send;
- debug/writeTo;
- message serialization;
- re-send object reuse.

Bad implementation:

```java
public final class BadStreamDataSource implements DataSource {
    private final InputStream inputStream;

    public BadStreamDataSource(InputStream inputStream) {
        this.inputStream = inputStream;
    }

    @Override
    public InputStream getInputStream() {
        return inputStream; // bad: same consumed stream reused
    }
}
```

Better implementation:

```java
public final class ByteArrayAttachmentDataSource implements DataSource {
    private final byte[] bytes;
    private final String contentType;
    private final String name;

    public ByteArrayAttachmentDataSource(byte[] bytes, String contentType, String name) {
        this.bytes = bytes.clone();
        this.contentType = contentType;
        this.name = name;
    }

    @Override
    public InputStream getInputStream() {
        return new ByteArrayInputStream(bytes);
    }

    @Override
    public OutputStream getOutputStream() throws IOException {
        throw new IOException("Read-only data source");
    }

    @Override
    public String getContentType() {
        return contentType;
    }

    @Override
    public String getName() {
        return name;
    }
}
```

But this is only good for small data. For large files, prefer file/object-storage backed streams.

---

## 5. Core API: DataHandler

`DataHandler` wraps data and exposes it to APIs that need content-aware access.

Typical attachment flow:

```java
DataSource source = new FileDataSource(file);
DataHandler handler = new DataHandler(source);

MimeBodyPart part = new MimeBodyPart();
part.setDataHandler(handler);
part.setFileName(file.getName());
```

Mental model:

```text
DataSource: where/how to read bytes
DataHandler: content-aware bridge around DataSource
MimeBodyPart: MIME body part using DataHandler
```

### 5.1 Why Not Just Put InputStream in MimeBodyPart?

Because a body part needs more than bytes:

- MIME type;
- filename;
- content disposition;
- transfer encoding;
- potential content handlers;
- re-readable data access.

`DataHandler` gives Jakarta Mail a standard way to access arbitrary data.

---

## 6. Core API: FileDataSource

`FileDataSource` is the simplest production-friendly source if the file exists locally and is stable during send.

```java
Path path = Path.of("/var/app/outbox/report-123.pdf");
File file = path.toFile();

DataSource dataSource = new FileDataSource(file);

MimeBodyPart attachment = new MimeBodyPart();
attachment.setDataHandler(new DataHandler(dataSource));
attachment.setFileName(file.getName());
attachment.setDisposition(Part.ATTACHMENT);
```

### 6.1 Advantages

- Does not require loading full file into heap.
- Easy to re-open stream.
- Simple for generated files written to temp disk.

### 6.2 Risks

- File may be deleted before async send.
- File may change between enqueue and send.
- File path may expose sensitive server structure if mishandled.
- File may be too large for provider limit.
- File may not exist on another node/pod.

### 6.3 Kubernetes/Distributed System Problem

This is dangerous:

```text
Request handled by pod A
↓
PDF generated at /tmp/report.pdf in pod A
↓
Outbox row inserted
↓
Worker pod B picks job
↓
Worker pod B cannot find /tmp/report.pdf
```

Better options:

1. store attachment in object storage;
2. store attachment as BLOB with size limits;
3. store generated artifact in shared durable volume;
4. render attachment during send if deterministic and cheap;
5. convert attachment to secure download link.

Production invariant:

```text
If email send is asynchronous, attachment reference must be durable and resolvable by the sender worker.
```

---

## 7. Core API: ByteArrayDataSource and In-Memory Attachments

In Jakarta/JavaMail ecosystem, `ByteArrayDataSource` is commonly used for generated content.

Modern package examples vary depending on implementation/version. In legacy JavaMail it is often:

```java
import javax.mail.util.ByteArrayDataSource;
```

In Jakarta Mail-compatible APIs it is commonly:

```java
import jakarta.mail.util.ByteArrayDataSource;
```

Example:

```java
byte[] pdf = generatePdf();

DataSource dataSource = new ByteArrayDataSource(pdf, "application/pdf");

MimeBodyPart attachment = new MimeBodyPart();
attachment.setDataHandler(new DataHandler(dataSource));
attachment.setFileName("invoice.pdf");
attachment.setDisposition(Part.ATTACHMENT);
```

### 7.1 When ByteArrayDataSource Is Good

Good for:

- small generated PDF;
- short CSV;
- QR image;
- small text artifact;
- test assertions;
- deterministic generated documents below strict size threshold.

### 7.2 When ByteArrayDataSource Is Bad

Bad for:

- large reports;
- large Excel files;
- evidence bundles;
- zip archives;
- unknown user upload sizes;
- bulk sending with many recipients;
- high concurrency worker pools.

### 7.3 Memory Multiplication Problem

A 10 MB attachment is not simply 10 MB.

Potential memory/size multiplication:

```text
Original file:              10 MB
byte[] in application:      10 MB
Base64 encoded output:     ~13.3 MB
MIME headers/boundaries:    small
Temporary buffers:          variable
Multiple concurrent sends:  N × above
```

If 50 worker threads each send 10 MB attachment:

```text
50 × 10 MB raw = 500 MB raw attachment bytes
50 × 13.3 MB encoded = 665 MB encoded stream pressure
plus buffers, templates, message objects, thread stacks
```

So top 1% rule:

```text
Never design attachment handling without an explicit size and concurrency budget.
```

---

## 8. Custom DataSource for Object Storage

Many enterprise systems store attachments in S3, Azure Blob, GCS, MinIO, or internal document service.

You can model that as `DataSource`.

Example conceptual implementation:

```java
public final class ObjectStorageDataSource implements DataSource {
    private final ObjectStorageClient client;
    private final String bucket;
    private final String key;
    private final String contentType;
    private final String name;

    public ObjectStorageDataSource(
            ObjectStorageClient client,
            String bucket,
            String key,
            String contentType,
            String name
    ) {
        this.client = Objects.requireNonNull(client);
        this.bucket = Objects.requireNonNull(bucket);
        this.key = Objects.requireNonNull(key);
        this.contentType = Objects.requireNonNull(contentType);
        this.name = Objects.requireNonNull(name);
    }

    @Override
    public InputStream getInputStream() throws IOException {
        try {
            return client.openStream(bucket, key);
        } catch (ObjectStorageException e) {
            throw new IOException("Cannot open object storage stream: " + bucket + "/" + key, e);
        }
    }

    @Override
    public OutputStream getOutputStream() throws IOException {
        throw new IOException("Read-only object storage data source");
    }

    @Override
    public String getContentType() {
        return contentType;
    }

    @Override
    public String getName() {
        return name;
    }
}
```

Important production concerns:

1. `getInputStream()` must return fresh stream.
2. Object must be immutable or versioned.
3. Access token/credential must not expire mid-send if stream is lazily opened.
4. Object must not be deleted before send completion.
5. Size should be known before sending.
6. Content hash should be recorded for audit.

---

## 9. Attachment Size Strategy

Email is a poor transport for large files.

A robust application should have attachment policies:

```text
maxAttachmentSizePerFile
maxTotalAttachmentSizePerEmail
maxAttachmentCount
allowedMimeTypes
disallowedExtensions
sendAsLinkThreshold
```

Example policy:

```java
public record AttachmentPolicy(
        long maxSingleAttachmentBytes,
        long maxTotalAttachmentBytes,
        int maxAttachmentCount,
        long secureLinkThresholdBytes,
        Set<String> allowedContentTypes
) {}
```

Example decision:

```java
public enum AttachmentDeliveryMode {
    INLINE_ATTACHMENT,
    SECURE_DOWNLOAD_LINK,
    REJECT
}
```

Decision logic:

```java
public AttachmentDeliveryMode decide(AttachmentDescriptor attachment, AttachmentPolicy policy) {
    if (!policy.allowedContentTypes().contains(attachment.contentType())) {
        return AttachmentDeliveryMode.REJECT;
    }

    if (attachment.sizeBytes() > policy.maxSingleAttachmentBytes()) {
        return AttachmentDeliveryMode.REJECT;
    }

    if (attachment.sizeBytes() > policy.secureLinkThresholdBytes()) {
        return AttachmentDeliveryMode.SECURE_DOWNLOAD_LINK;
    }

    return AttachmentDeliveryMode.INLINE_ATTACHMENT;
}
```

### 9.1 Why Secure Link Is Often Better

Secure link advantages:

- avoids mailbox size limit;
- allows access control;
- allows expiry;
- allows download audit;
- allows revocation;
- avoids sending sensitive data permanently to mailbox;
- reduces SMTP payload size;
- supports very large artifacts.

Secure link risks:

- link token leakage;
- user friction;
- expired link support issue;
- auth integration;
- dependency on application availability.

Top-level rule:

```text
Attachment is convenient. Secure link is governable.
```

---

## 10. Content-Type Detection

`Content-Type` matters because mail clients use it to decide how to display/open the file.

Examples:

| File | Good content type |
|---|---|
| PDF | `application/pdf` |
| CSV | `text/csv; charset=UTF-8` |
| PNG | `image/png` |
| JPEG | `image/jpeg` |
| XLSX | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| ZIP | `application/zip` |
| unknown | `application/octet-stream` |

### 10.1 Extension-Based Detection

Simple but weak:

```java
String contentType = Files.probeContentType(path);
```

Problems:

- platform-dependent;
- extension-based in many environments;
- may return null;
- container image may lack MIME database;
- user can rename `malware.exe` to `report.pdf`.

### 10.2 Application-Controlled Detection

For generated artifacts, you usually already know the content type.

```java
AttachmentDescriptor pdf = new AttachmentDescriptor(
        "report.pdf",
        "application/pdf",
        sizeBytes,
        storageRef
);
```

This is better than guessing.

### 10.3 Magic-Number Detection

For uploaded files, inspect file signature.

Examples:

| Type | Common signature |
|---|---|
| PDF | `%PDF` |
| PNG | `89 50 4E 47` |
| JPEG | `FF D8 FF` |
| ZIP/XLSX/DOCX | `50 4B` |

But magic number is not sufficient for full safety. It is a validation signal, not a complete malware scanner.

### 10.4 Content-Type Invariant

```text
For generated files, content type should come from generator metadata.
For uploaded files, content type should be validated, not trusted from user/browser.
For unknown files, use application/octet-stream or reject.
```

---

## 11. FileTypeMap and MimetypesFileTypeMap

Activation includes `FileTypeMap` abstraction for mapping file names to MIME types.

Concept:

```java
FileTypeMap map = FileTypeMap.getDefaultFileTypeMap();
String type = map.getContentType("report.pdf");
```

You can customize mappings when defaults are insufficient.

Example:

```java
MimetypesFileTypeMap map = new MimetypesFileTypeMap();
map.addMimeTypes("application/pdf pdf");
map.addMimeTypes("text/csv csv");
map.addMimeTypes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet xlsx");

String type = map.getContentType("report.xlsx");
```

### 11.1 When to Use FileTypeMap

Good for:

- fallback mapping;
- generated filenames with known extension;
- internal tools;
- non-critical display hints.

Not enough for:

- security validation;
- uploaded file trust;
- regulatory evidence;
- malware prevention.

---

## 12. Content-Disposition: Attachment vs Inline

Two common dispositions:

```text
Content-Disposition: attachment
Content-Disposition: inline
```

### 12.1 Attachment

Use when the file should be downloaded/opened separately.

```java
part.setDisposition(Part.ATTACHMENT);
```

### 12.2 Inline

Use when the part is intended to render as part of message body, commonly images referenced by `cid:` in HTML.

```java
part.setDisposition(Part.INLINE);
part.setHeader("Content-ID", "<logo-image>");
```

HTML:

```html
<img src="cid:logo-image" alt="Company logo">
```

### 12.3 Important Difference

| Mode | Purpose | Typical use |
|---|---|---|
| `attachment` | user opens/downloads file | PDF, CSV, Excel |
| `inline` | body references it | logo, QR image, embedded chart |

### 12.4 Client Reality

Some clients still show inline images as attachments. Some clients block images. Some clients rewrite or proxy remote images. Therefore inline images should not carry critical-only information.

Bad:

```text
“Your approval code is only inside an inline image.”
```

Better:

```text
Approval code is text. Image is only decorative/supporting.
```

---

## 13. Inline Image Correct MIME Structure

Inline image usually requires `multipart/related`.

Correct conceptual structure:

```text
multipart/mixed
└── multipart/related
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html referencing cid:logo
    └── image/png; Content-ID:<logo>; inline
```

If there are attachments too:

```text
multipart/mixed
├── multipart/related
│   ├── multipart/alternative
│   │   ├── text/plain
│   │   └── text/html referencing cid:logo
│   └── image/png; Content-ID:<logo>; inline
└── application/pdf; attachment
```

Java-style composition:

```java
MimeBodyPart plainPart = new MimeBodyPart();
plainPart.setText("Please see the report attached.", StandardCharsets.UTF_8.name());

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent("""
        <html>
          <body>
            <img src="cid:company-logo" alt="Company logo">
            <p>Please see the report attached.</p>
          </body>
        </html>
        """, "text/html; charset=UTF-8");

MimeMultipart alternative = new MimeMultipart("alternative");
alternative.addBodyPart(plainPart);
alternative.addBodyPart(htmlPart);

MimeBodyPart alternativeWrapper = new MimeBodyPart();
alternativeWrapper.setContent(alternative);

MimeBodyPart logoPart = new MimeBodyPart();
logoPart.setDataHandler(new DataHandler(new FileDataSource("/app/assets/logo.png")));
logoPart.setHeader("Content-ID", "<company-logo>");
logoPart.setDisposition(Part.INLINE);
logoPart.setFileName("logo.png");

MimeMultipart related = new MimeMultipart("related");
related.addBodyPart(alternativeWrapper);
related.addBodyPart(logoPart);

MimeBodyPart relatedWrapper = new MimeBodyPart();
relatedWrapper.setContent(related);

MimeBodyPart reportPart = new MimeBodyPart();
reportPart.setDataHandler(new DataHandler(new FileDataSource("/app/reports/report.pdf")));
reportPart.setFileName("report.pdf");
reportPart.setDisposition(Part.ATTACHMENT);

MimeMultipart mixed = new MimeMultipart("mixed");
mixed.addBodyPart(relatedWrapper);
mixed.addBodyPart(reportPart);

message.setContent(mixed);
```

---

## 14. Filename Handling

Filename looks simple until internationalization and security appear.

Examples:

```text
report.pdf
sales report final.pdf
résumé.pdf
laporan-pengawasan-äöü.pdf
案件资料.pdf
invoice, final (signed).pdf
```

### 14.1 `setFileName`

Common usage:

```java
part.setFileName("report.pdf");
```

Jakarta Mail generally handles MIME encoding for non-ASCII filenames depending on properties and implementation behavior.

But production code should still sanitize filename input.

### 14.2 Do Not Trust User Filename

User-provided filename may contain:

```text
../../secret.txt
C:\Windows\system32\cmd.exe
report.pdf\r\nBcc: attacker@example.com
very-long-name-...-10000-chars.pdf
invoice<NUL>.pdf
```

Safe filename strategy:

```java
public final class SafeFilenames {
    private static final int MAX_FILENAME_LENGTH = 120;

    public static String sanitizeForEmailAttachment(String input, String fallback) {
        if (input == null || input.isBlank()) {
            return fallback;
        }

        String normalized = Normalizer.normalize(input, Normalizer.Form.NFC);

        // Remove path components from both Unix and Windows style paths.
        normalized = normalized.replace('\\', '/');
        int lastSlash = normalized.lastIndexOf('/');
        if (lastSlash >= 0) {
            normalized = normalized.substring(lastSlash + 1);
        }

        // Remove control characters including CR/LF to prevent header injection.
        normalized = normalized.replaceAll("[\\p{Cntrl}]", "");

        // Replace risky separators. Keep Unicode letters valid.
        normalized = normalized.replaceAll("[/:*?\"<>|]", "_");

        normalized = normalized.trim();

        if (normalized.isEmpty() || normalized.equals(".") || normalized.equals("..")) {
            normalized = fallback;
        }

        if (normalized.length() > MAX_FILENAME_LENGTH) {
            normalized = normalized.substring(0, MAX_FILENAME_LENGTH);
        }

        return normalized;
    }
}
```

### 14.3 Filename Is Display Metadata

Do not use email attachment filename as durable identity.

Bad:

```text
Find the sent evidence by filename.
```

Better:

```text
Store attachment_id, content_hash, storage_version, generated_at, template_version, and display_filename.
```

---

## 15. Header Injection Through Filename

Email headers are line-based. If user input gets into headers, CRLF is dangerous.

Attack idea:

```text
filename = "report.pdf\r\nBcc: attacker@example.com"
```

If a library or custom code writes headers unsafely, this can inject new headers.

Never manually concatenate headers with unsanitized values:

```java
// Bad
part.setHeader("Content-Disposition", "attachment; filename=\"" + userFilename + "\"");
```

Prefer high-level methods:

```java
part.setFileName(safeFilename);
part.setDisposition(Part.ATTACHMENT);
```

And still sanitize CR/LF.

---

## 16. Attach File Using Convenience Method

Jakarta Mail provides convenience methods such as `attachFile` on `MimeBodyPart`.

Example:

```java
MimeBodyPart attachment = new MimeBodyPart();
attachment.attachFile(new File("report.pdf"));
```

This is concise and fine for simple cases.

### 16.1 When It Is Enough

Good when:

- file is local;
- file is small enough;
- file exists during send;
- filename is safe;
- content type detection is acceptable;
- no custom metadata needed.

### 16.2 When To Avoid Convenience Method

Avoid or wrap when:

- content type must be explicit;
- data comes from object storage;
- attachment name differs from file name;
- security scanning required;
- audit hash required;
- attachment size must be checked;
- async worker may run on another node;
- generated data should not be persisted as local file.

Top 1% pattern:

```text
Convenience API is allowed at the edge, not as the domain model.
```

---

## 17. Building a Production AttachmentDescriptor

Do not pass `File` everywhere in your application.

A better domain descriptor:

```java
public record AttachmentDescriptor(
        String attachmentId,
        String displayFilename,
        String contentType,
        long sizeBytes,
        String contentSha256,
        AttachmentStorageRef storageRef,
        AttachmentDisposition disposition
) {}

public enum AttachmentDisposition {
    ATTACHMENT,
    INLINE
}

public sealed interface AttachmentStorageRef permits FileAttachmentRef, ObjectStorageAttachmentRef, ByteArrayAttachmentRef {
}

public record FileAttachmentRef(Path path) implements AttachmentStorageRef {}

public record ObjectStorageAttachmentRef(
        String bucket,
        String key,
        String version
) implements AttachmentStorageRef {}

public record ByteArrayAttachmentRef(byte[] bytes) implements AttachmentStorageRef {}
```

For Java 8, replace records/sealed interfaces with final classes and interfaces.

Then infrastructure maps descriptor to `DataSource`.

```java
public interface DataSourceFactory {
    DataSource create(AttachmentDescriptor descriptor) throws IOException;
}
```

This separation gives you audit metadata, validation before MIME creation, testability, storage abstraction, migration flexibility, and policy enforcement.

---

## 18. Attachment Factory Example

```java
public final class MailAttachmentPartFactory {
    private final DataSourceFactory dataSourceFactory;

    public MailAttachmentPartFactory(DataSourceFactory dataSourceFactory) {
        this.dataSourceFactory = Objects.requireNonNull(dataSourceFactory);
    }

    public MimeBodyPart createAttachmentPart(AttachmentDescriptor descriptor) throws MessagingException, IOException {
        validateDescriptor(descriptor);

        DataSource dataSource = dataSourceFactory.create(descriptor);

        MimeBodyPart part = new MimeBodyPart();
        part.setDataHandler(new DataHandler(dataSource));
        part.setFileName(SafeFilenames.sanitizeForEmailAttachment(
                descriptor.displayFilename(),
                "attachment.bin"
        ));

        if (descriptor.disposition() == AttachmentDisposition.INLINE) {
            part.setDisposition(Part.INLINE);
            part.setHeader("Content-ID", "<" + descriptor.attachmentId() + ">");
        } else {
            part.setDisposition(Part.ATTACHMENT);
        }

        return part;
    }

    private void validateDescriptor(AttachmentDescriptor descriptor) {
        Objects.requireNonNull(descriptor);
        if (descriptor.sizeBytes() < 0) {
            throw new IllegalArgumentException("Attachment size must not be negative");
        }
        if (descriptor.contentType() == null || descriptor.contentType().isBlank()) {
            throw new IllegalArgumentException("Attachment content type is required");
        }
        if (descriptor.displayFilename() == null || descriptor.displayFilename().isBlank()) {
            throw new IllegalArgumentException("Display filename is required");
        }
    }
}
```

Important refinement: `Content-ID` should be generated internally, not derived from user input.

```java
String contentId = UUID.randomUUID() + "@mail.local";
```

---

## 19. Attachment Policy Validation

Before creating MIME, validate the attachment set.

```java
public final class AttachmentPolicyValidator {
    private final AttachmentPolicy policy;

    public AttachmentPolicyValidator(AttachmentPolicy policy) {
        this.policy = policy;
    }

    public void validate(List<AttachmentDescriptor> attachments) {
        if (attachments.size() > policy.maxAttachmentCount()) {
            throw new AttachmentPolicyException("Too many attachments");
        }

        long total = 0;
        for (AttachmentDescriptor attachment : attachments) {
            if (attachment.sizeBytes() > policy.maxSingleAttachmentBytes()) {
                throw new AttachmentPolicyException("Attachment too large: " + attachment.displayFilename());
            }

            if (!policy.allowedContentTypes().contains(attachment.contentType())) {
                throw new AttachmentPolicyException("Content type not allowed: " + attachment.contentType());
            }

            total = Math.addExact(total, attachment.sizeBytes());
        }

        if (total > policy.maxTotalAttachmentBytes()) {
            throw new AttachmentPolicyException("Total attachment size too large");
        }
    }
}
```

Policy failure is usually permanent. Storage timeout may be retryable; disallowed MIME type, too-large attachment, and infected file are not.

---

## 20. Content Hash for Audit and Integrity

For regulatory-grade systems, store hash.

```java
public static String sha256Hex(Path path) throws IOException, NoSuchAlgorithmException {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");

    try (InputStream in = Files.newInputStream(path)) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            digest.update(buffer, 0, read);
        }
    }

    byte[] hash = digest.digest();
    StringBuilder hex = new StringBuilder(hash.length * 2);
    for (byte b : hash) {
        hex.append(String.format("%02x", b));
    }
    return hex.toString();
}
```

Audit record example:

```text
notification_id: NOTIF-2026-000123
attachment_id: ATT-9012
filename: enforcement-notice.pdf
content_type: application/pdf
size_bytes: 345203
sha256: 26b0...
storage_ref: s3://bucket/key?versionId=abc
attached_to_message_id: <...>
generated_at: 2026-06-18T09:30:00+07:00
```

Without hash, later you may not be able to prove which exact PDF was sent, whether a document changed after send, or whether a recipient complaint refers to the same artifact.

---

## 21. Streaming vs Buffering

Important distinction:

```text
Streaming source: data read gradually from InputStream
Buffering source: data fully loaded into byte[]/String before send
```

Stream-friendly sources:

- `FileDataSource`;
- object storage `DataSource` returning fresh stream;
- database BLOB stream, if transaction/lifecycle is handled carefully.

Buffering sources:

- `ByteArrayDataSource`;
- generated string/CSV in memory;
- PDF generated to byte array.

Even if your source streams, the mail provider may still buffer some data depending on encoding/output path. Streaming reduces memory pressure; it does not remove size, timeout, provider, or transport constraints.

---

## 22. Database BLOB Attachments

You can stream from database, but be careful.

Bad approach:

```java
Blob blob = resultSet.getBlob("file_content");
InputStream in = blob.getBinaryStream();
// Store InputStream in object and use later in async mail worker.
```

Why bad:

- stream tied to connection/result set lifecycle;
- worker may use it after transaction closed;
- not re-readable;
- connection can be held during SMTP send;
- SMTP send can be slow.

Better options:

1. read BLOB into durable object storage before enqueue;
2. worker opens a new DB stream when sending;
3. materialize to temp file with lifecycle control;
4. avoid attachment and use secure link.

Production invariant:

```text
Never hold DB connection open while waiting on SMTP network I/O unless deliberately designed and bounded.
```

---

## 23. Temporary Files

Generated attachments often use temp files.

```java
Path temp = Files.createTempFile("report-", ".pdf");
try {
    generatePdfTo(temp);
    sendEmailWithAttachment(temp);
} finally {
    Files.deleteIfExists(temp);
}
```

This is fine for synchronous local send. It is not fine for asynchronous outbox unless temp file lifecycle outlives the job.

Temp file risks:

- file deleted before send;
- disk full;
- file readable by other process;
- sensitive data left on disk;
- orphaned temp files;
- pod restart loses data;
- cleanup races.

Safer pattern:

```text
Generate artifact
↓
Store artifact in durable storage with lifecycle policy
↓
Record versioned storage ref in outbox
↓
Worker sends from durable ref
↓
Retention cleanup after policy window
```

---

## 24. Attachment Security Model

Attachment is one of the highest-risk email features.

| Risk | Example |
|---|---|
| Malware | user uploads infected file then system emails it |
| File spoofing | `invoice.pdf.exe` |
| MIME mismatch | file says PDF but content is executable |
| Sensitive data leakage | wrong recipient receives attachment |
| Oversized payload | worker OOM or provider reject |
| Header injection | filename contains CR/LF |
| Path traversal | user filename reused as server path |
| Zip bomb | compressed file expands massively |
| Macro malware | Office documents with macros |
| HTML active content | attachment contains dangerous HTML |
| Data retention violation | mailbox stores data permanently |

Security control points:

```text
Upload time
  - size limit
  - extension/content type validation
  - malware scan
  - store immutable object

Before send
  - recipient authorization check
  - attachment policy check
  - sensitivity check
  - content hash check
  - filename sanitization

During send
  - no PII in logs
  - timeout limits
  - provider limits

After send
  - audit record
  - bounce/update status
  - retention cleanup
```

Possible malware scanning lifecycle:

```text
UPLOADED -> SCANNING -> CLEAN -> ATTACHABLE
                  ↘ INFECTED -> BLOCKED
                  ↘ SCAN_FAILED -> QUARANTINED
```

---

## 25. Wrong Recipient Is the Worst Attachment Bug

A failed SMTP send is visible. A wrong attachment sent to the wrong person is a serious incident.

Design checks:

1. bind attachment to business entity;
2. verify recipient has access to that entity;
3. verify template is appropriate for recipient type;
4. verify generated document belongs to the same case/application/user;
5. store recipient snapshot and attachment snapshot;
6. avoid reusing mutable “latest document” pointer.

Bad outbox payload:

```json
{
  "recipient": "user@example.com",
  "attachmentPath": "/reports/latest.pdf"
}
```

Better outbox payload:

```json
{
  "notificationId": "NOTIF-123",
  "recipientUserId": "U-7788",
  "recipientEmail": "user@example.com",
  "caseId": "CASE-2026-001",
  "attachmentId": "ATT-456",
  "attachmentVersion": "v3",
  "contentSha256": "...",
  "generatedFromTemplateVersion": "notice-v12"
}
```

Invariant:

```text
Do not send attachment by resolving mutable latest-state at send time unless explicitly intended.
```

---

## 26. Attachment Lifecycle State Machine

A robust attachment lifecycle:

```text
DRAFT
  ↓
GENERATED
  ↓
VALIDATED
  ↓
SCANNED_CLEAN
  ↓
READY_TO_SEND
  ↓
ATTACHED_TO_NOTIFICATION
  ↓
SENT_OR_LINKED
  ↓
RETAINED
  ↓
EXPIRED_OR_ARCHIVED
```

Failure states:

```text
GENERATION_FAILED
VALIDATION_FAILED
SCAN_FAILED
SCAN_INFECTED
STORAGE_FAILED
SEND_FAILED_RETRYABLE
SEND_FAILED_PERMANENT
```

This is overkill for simple apps, but normal for regulatory, financial, government, or healthcare workflows.

---

## 27. Building Email with Attachments: Full Example

Modern Jakarta-style example:

```java
import jakarta.activation.DataHandler;
import jakarta.activation.DataSource;
import jakarta.activation.FileDataSource;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

public final class AttachmentMailExample {

    public static void main(String[] args) throws Exception {
        Properties props = new Properties();
        props.put("mail.smtp.host", "smtp.example.com");
        props.put("mail.smtp.port", "587");
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.starttls.required", "true");
        props.put("mail.smtp.connectiontimeout", "5000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");

        Session session = Session.getInstance(props);

        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress("noreply@example.com", "Example System"));
        message.setRecipient(Message.RecipientType.TO, new InternetAddress("recipient@example.com"));
        message.setSubject("Your report", StandardCharsets.UTF_8.name());

        MimeBodyPart textPart = new MimeBodyPart();
        textPart.setText("Please find the report attached.", StandardCharsets.UTF_8.name());

        File file = new File("/var/app/reports/report.pdf");
        DataSource source = new FileDataSource(file);

        MimeBodyPart attachmentPart = new MimeBodyPart();
        attachmentPart.setDataHandler(new DataHandler(source));
        attachmentPart.setFileName("report.pdf");
        attachmentPart.setDisposition(MimeBodyPart.ATTACHMENT);

        MimeMultipart mixed = new MimeMultipart("mixed");
        mixed.addBodyPart(textPart);
        mixed.addBodyPart(attachmentPart);

        message.setContent(mixed);
        message.saveChanges();

        try (Transport transport = session.getTransport("smtp")) {
            transport.connect("smtp.example.com", "smtp-user", "smtp-password");
            transport.sendMessage(message, message.getAllRecipients());
        }
    }
}
```

This example is intentionally simple. In production, add policy validation, safe filename, content hash, storage abstraction, retry classification, observability, redacted logging, secret management, and outbox-based asynchronous sending.

---

## 28. Legacy Java 8 JavaMail Equivalent

Legacy package version:

```java
import javax.activation.DataHandler;
import javax.activation.DataSource;
import javax.activation.FileDataSource;
import javax.mail.Message;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
```

Most code structure is identical; namespace changes are the main difference.

Do not mix `javax.mail` with `jakarta.activation`, and do not mix `jakarta.mail` with `javax.activation`.

---

## 29. Attachment With Generated CSV

CSV is common in enterprise systems.

```java
String csv = "id,name,status\n1,Alice,ACTIVE\n2,Bob,SUSPENDED\n";
byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);

DataSource csvSource = new ByteArrayDataSource(bytes, "text/csv; charset=UTF-8");

MimeBodyPart csvPart = new MimeBodyPart();
csvPart.setDataHandler(new DataHandler(csvSource));
csvPart.setFileName("users.csv");
csvPart.setDisposition(Part.ATTACHMENT);
```

### 29.1 CSV Injection Warning

Spreadsheet apps may interpret values beginning with `=`, `+`, `-`, or `@` as formulas.

Danger:

```csv
name,email
=HYPERLINK("http://evil", "click"),victim@example.com
```

If CSV is opened in Excel/LibreOffice, formula injection may occur.

Mitigation:

- escape formula-leading cells;
- prefix with apostrophe or tab depending on policy;
- document behavior;
- avoid exporting raw untrusted fields.

Example:

```java
public static String safeCsvCell(String value) {
    if (value == null) return "";
    String v = value;
    if (v.startsWith("=") || v.startsWith("+") || v.startsWith("-") || v.startsWith("@")) {
        v = "'" + v;
    }
    return v;
}
```

This is not Jakarta Mail-specific, but it is attachment-specific security.

---

## 30. Attachment With Generated PDF

PDF generation often happens before email send.

Bad design:

```java
byte[] pdf = generateHugePdf();
mailService.send(recipient, pdf);
```

Better design:

```text
generate PDF -> store immutable artifact -> enqueue mail with artifact reference -> send worker streams artifact
```

Example descriptor:

```java
AttachmentDescriptor descriptor = new AttachmentDescriptor(
        "ATT-1001",
        "enforcement-notice.pdf",
        "application/pdf",
        482_103L,
        "sha256-hex-value",
        new ObjectStorageAttachmentRef("documents", "notices/ATT-1001.pdf", "v1"),
        AttachmentDisposition.ATTACHMENT
);
```

---

## 31. Multiple Attachments

Structure:

```java
MimeMultipart mixed = new MimeMultipart("mixed");
mixed.addBodyPart(bodyPart);

for (AttachmentDescriptor descriptor : attachments) {
    mixed.addBodyPart(attachmentFactory.createAttachmentPart(descriptor));
}

message.setContent(mixed);
```

Validation before building:

```java
policyValidator.validate(attachments);
```

Important ordering:

```text
Main body first, attachments after.
```

Most clients tolerate different order, but body-first is clearer and conventional.

---

## 32. Encoding and Transfer Size

Binary attachments need encoding for SMTP transport.

Common transfer encodings:

| Encoding | Use |
|---|---|
| `base64` | binary attachments |
| `quoted-printable` | mostly text with non-ASCII/special chars |
| `7bit` | ASCII-safe text |
| `8bit` | 8-bit content where transport supports it |

Jakarta Mail usually selects transfer encoding automatically.

Do not manually base64 encode attachment before passing it as data unless you really know what you are doing. If you pass already-base64 text as attachment content, mail layer may encode it again.

Bad:

```java
byte[] encoded = Base64.getEncoder().encode(pdfBytes);
DataSource ds = new ByteArrayDataSource(encoded, "application/pdf");
```

Better:

```java
DataSource ds = new ByteArrayDataSource(pdfBytes, "application/pdf");
```

Let the mail library handle transport encoding.

---

## 33. Attachment Limits Are Provider-Specific

Even if Jakarta Mail can build a 40 MB MIME message, your provider may reject it.

The actual transmitted size is larger than raw file size due to base64.

Rule of thumb:

```text
MIME size ≈ raw attachment size × 1.33 + headers + body
```

If provider limit is 25 MB, do not allow 25 MB raw attachment. Your safe raw limit may be around 18 MB or lower depending on body and overhead.

Policy example:

```text
providerMessageLimitBytes = 25 MB
maxRawAttachmentTotalBytes = 18 MB
secureLinkThresholdBytes = 10 MB
```

---

## 34. Outbox Design for Attachments

Outbox table should not usually store raw huge bytes.

Example table split:

```text
email_outbox
- id
- notification_type
- recipient_email_encrypted_or_tokenized
- subject
- template_id
- template_version
- template_data_json
- status
- attempts
- next_attempt_at
- created_at

email_outbox_attachment
- id
- outbox_id
- attachment_id
- display_filename
- content_type
- size_bytes
- sha256
- storage_type
- storage_ref
- storage_version
- disposition
- content_id
```

Why split?

- multiple attachments;
- easier validation;
- easier audit;
- avoids giant outbox rows;
- attachment reuse/reference;
- status/debug clarity.

---

## 35. Idempotency and Attachments

Suppose worker crashes after SMTP accepts message but before DB marks `SENT`.

Retry may send duplicate email with same attachment.

Mitigation options:

1. accept at-least-once send and make content safe;
2. use idempotency at business notification layer;
3. include stable `Message-ID`;
4. store provider response if available;
5. avoid re-generating attachment differently on retry;
6. use deterministic attachment version.

Attachment-specific invariant:

```text
Retrying same outbox email must attach same artifact version, not newly generated latest state.
```

---

## 36. Retrying Attachment Failures

Failure classification:

| Failure | Retry? | Example |
|---|---:|---|
| storage timeout | yes | object storage temporarily unavailable |
| storage 404 for immutable ref | usually no | attachment missing permanently |
| malware scan pending | yes/defer | file not ready yet |
| malware infected | no | blocked |
| file too large | no/fallback | send secure link instead |
| content type disallowed | no | policy violation |
| SMTP timeout | yes | network issue |
| SMTP message too large | no/fallback | provider rejects payload |

Design retry classifier:

```java
public enum AttachmentFailureKind {
    STORAGE_TIMEOUT,
    STORAGE_NOT_FOUND,
    POLICY_REJECTED,
    SCAN_PENDING,
    SCAN_INFECTED,
    SIZE_EXCEEDED,
    CONTENT_TYPE_REJECTED
}
```

---

## 37. Observability for Attachments

Metrics:

```text
mail_attachment_count
mail_attachment_total_bytes
mail_attachment_policy_rejected_total
mail_attachment_storage_read_latency
mail_attachment_storage_failure_total
mail_attachment_scan_pending_total
mail_attachment_sent_bytes_total
mail_attachment_send_as_link_total
```

Logs should include:

```text
notification_id
outbox_id
attachment_id
content_type
size_bucket
storage_type
sha256_prefix maybe
```

Logs should not include:

```text
full recipient if sensitive
full file path if sensitive
raw file content
full signed URL
secret token
PII-rich filename when avoidable
```

Example safe log:

```text
INFO mail.attachment.added notification_id=N-123 attachment_id=A-456 content_type=application/pdf size_bytes=482103 disposition=attachment
```

---

## 38. Debugging Raw MIME Attachment

For testing, you can serialize message:

```java
message.writeTo(System.out);
```

But in production this may dump sensitive attachment content in base64.

Safe debug strategy:

- only in lower environments;
- redact body/attachment payload;
- log MIME structure, not content;
- store raw MIME only in secure test artifacts;
- never log signed URLs or credentials.

MIME structure debug example:

```text
MimeMessage
- multipart/mixed
  - multipart/alternative
    - text/plain; charset=UTF-8
    - text/html; charset=UTF-8
  - application/pdf; attachment; filename=notice.pdf; size=482103
  - image/png; attachment; filename=evidence.png; size=90122
```

---

## 39. Testing Attachment Creation

A good attachment test should assert MIME structure, not only “send method called”.

Example checks:

1. message content is `MimeMultipart`;
2. subtype is `mixed`;
3. body part exists;
4. attachment part exists;
5. attachment disposition is `attachment`;
6. filename equals expected sanitized filename;
7. content type starts with expected MIME type;
8. content bytes match expected hash.

Pseudo-test:

```java
MimeMessage message = mailComposer.compose(request);

MimeMultipart mixed = (MimeMultipart) message.getContent();
assertEquals(2, mixed.getCount());

BodyPart attachment = mixed.getBodyPart(1);
assertEquals(Part.ATTACHMENT, attachment.getDisposition());
assertEquals("report.pdf", attachment.getFileName());
assertTrue(attachment.getContentType().toLowerCase().startsWith("application/pdf"));

byte[] actual = attachment.getInputStream().readAllBytes();
assertEquals(expectedSha256, sha256Hex(actual));
```

For Java 8, replace `readAllBytes()` with manual stream reading.

---

## 40. Testing Filename Sanitization

Test cases:

```text
report.pdf                      -> report.pdf
../../secret.txt                -> secret.txt
C:\temp\report.pdf             -> report.pdf
report.pdf\r\nBcc: x@y.com       -> report.pdfBcc_ x@y.com or rejected
案件资料.pdf                     -> 案件资料.pdf
""                              -> attachment.bin
very long name                  -> truncated
```

Prefer reject for clearly malicious names in high-security systems.

```java
public enum FilenameSanitizationMode {
    SANITIZE,
    REJECT_ON_CONTROL_CHARS,
    REJECT_ON_PATH_COMPONENTS
}
```

---

## 41. Common Anti-Patterns

### 41.1 Passing File Path From User Directly

Bad:

```java
attachment.attachFile(new File(userInputPath));
```

Why bad:

- path traversal;
- arbitrary file read;
- sensitive server file leakage.

### 41.2 Loading Every Attachment Into Byte Array

Bad:

```java
byte[] bytes = Files.readAllBytes(path);
```

Fine for small controlled file. Dangerous as default pattern.

### 41.3 Sending Attachment Before Transaction Commits

Bad:

```text
DB transaction starts
Generate document
Send email with attachment
DB transaction rolls back
Recipient receives document for transaction that does not exist
```

Use outbox after commit.

### 41.4 Resolving Latest Document on Retry

Bad:

```text
Retry email -> query latest document -> attaches new version
```

Send should use original immutable version unless business explicitly wants latest.

### 41.5 Logging Raw MIME

Bad:

```java
message.writeTo(logOutputStream);
```

This can leak PII and full attachments.

---

## 42. Design Pattern: Attachment as Immutable Artifact

For serious systems, model attachment as immutable artifact.

```text
Artifact
- id
- owner/business entity
- version
- content type
- display filename
- size
- hash
- storage location
- sensitivity classification
- scan status
- retention policy
```

Email references artifact version.

```text
EmailOutboxAttachment
- email_outbox_id
- artifact_id
- artifact_version
- disposition
- content_id
```

Benefits:

- auditability;
- retry safety;
- access validation;
- immutability;
- deduplication;
- compliance control.

---

## 43. Design Pattern: Attachment as Secure Link

Instead of attaching file:

```text
Your document is ready.
Download: https://app.example.com/secure-download/token
```

Secure link model:

```text
DownloadToken
- token hash
- artifact id/version
- recipient identity
- expires_at
- max_downloads
- created_by_notification_id
- revoked_at
```

Security requirements:

1. token must be random and high entropy;
2. store token hash, not raw token;
3. expiry required;
4. authorization check if user is authenticated;
5. audit download event;
6. rate limit;
7. revoke on case access change if needed.

Use secure link when the file is large, sensitive, access should be revocable, download audit matters, email retention is a concern, or provider message-size limits are too restrictive.

---

## 44. Design Pattern: Attachment Preflight

Before inserting outbox:

```text
1. Generate/locate artifact.
2. Validate artifact metadata.
3. Verify recipient authorization.
4. Check attachment policy.
5. Check scan status.
6. Freeze artifact version.
7. Insert outbox + attachment refs.
```

Preflight result:

```java
public record AttachmentPreflightResult(
        List<AttachmentDescriptor> attachable,
        List<SecureLinkDescriptor> links,
        List<AttachmentPolicyViolation> violations
) {}
```

This allows graceful fallback:

```text
small clean PDF -> attach
large clean PDF -> secure link
infected file -> block
scan pending -> defer send
```

---

## 45. Top 1% Checklist

Before you say “our email supports attachments”, answer these:

### Correctness

- Is MIME structure correct for plain/html/inline/attachments?
- Are content types explicit and correct?
- Are filenames encoded and sanitized?
- Are inline images placed under `multipart/related`?

### Reliability

- Are attachments durable for async send?
- Are retries tied to same artifact version?
- Are storage failures classified correctly?
- Is message size below provider limits after base64 overhead?

### Performance

- Are large files streamed instead of loaded into heap?
- Is total worker memory budget calculated?
- Is attachment count bounded?
- Are SMTP write timeouts configured?

### Security

- Are uploaded files scanned?
- Are file types validated?
- Are filenames sanitized against CR/LF and path traversal?
- Are sensitive files sent as secure link instead?
- Are raw MIME and attachment content excluded from logs?

### Compliance

- Is attachment content hash stored?
- Is artifact version immutable?
- Is recipient authorization checked?
- Is download/sending audit recorded?
- Is retention policy defined?

---

## 46. Practical Architecture Summary

A mature attachment subsystem looks like this:

```text
Business event
  ↓
Notification planner
  ↓
Template renderer
  ↓
Attachment preflight
  ├── generated artifacts
  ├── uploaded artifacts
  ├── scan status
  ├── policy validation
  └── secure-link fallback
  ↓
Outbox insert with immutable attachment refs
  ↓
Worker picks outbox row
  ↓
DataSourceFactory opens fresh streams
  ↓
MimeComposer builds multipart/mixed or nested MIME
  ↓
SMTP gateway sends with timeout/retry classification
  ↓
Audit + metrics + status update
```

The key shift:

```text
From: “attach this file”
To:   “send this immutable, validated, authorized, size-bounded, MIME-correct artifact through a reliable delivery pipeline.”
```

---

## 47. References

- Jakarta Activation 2.1 Specification — https://jakarta.ee/specifications/activation/2.1/jakarta-activation-spec-2.1
- Jakarta Activation 2.1 Overview — https://jakarta.ee/specifications/activation/2.1/
- Jakarta Mail 2.1 Specification — https://jakarta.ee/specifications/mail/2.1/jakarta-mail-spec-2.1
- Jakarta Mail `MimeBodyPart` API — https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/internet/mimebodypart
- Jakarta Mail `MimeMultipart` API — https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/internet/mimemultipart
- Eclipse Angus Mail Documentation — https://eclipse-ee4j.github.io/angus-mail/
- Eclipse Angus Activation API — https://eclipse-ee4j.github.io/angus-activation/

---

## 48. Part 7 Completion Checklist

You have completed this part if you can explain:

- why attachment is a MIME body part, not simply a file;
- how `DataSource`, `DataHandler`, and `MimeBodyPart` relate;
- why namespace consistency matters between `javax.mail`/`javax.activation` and `jakarta.mail`/`jakarta.activation`;
- when `FileDataSource` is appropriate;
- when `ByteArrayDataSource` is dangerous;
- how to model object-storage-backed attachments;
- why async email requires durable attachment references;
- why filename sanitization matters;
- how inline images differ from attachments;
- why base64 overhead affects provider limits;
- how to design attachment policy, audit hash, and secure-link fallback;
- how to classify attachment-related failures.

---

## 49. What Comes Next

Next part:

```text
Part 8 — HTML Email Engineering: Templates, CSS, Images, and Client Compatibility
```

Part 8 will cover:

- HTML email is not normal web HTML;
- table layout and inline CSS reality;
- template engine integration;
- escaping and injection risk;
- dark mode and client compatibility;
- preview text;
- remote images vs CID inline images;
- accessibility;
- localization;
- template versioning and snapshot testing.
