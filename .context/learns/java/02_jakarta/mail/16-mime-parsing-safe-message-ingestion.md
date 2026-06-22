# Part 16 — MIME Parsing: Reading Complex Messages Safely

> Seri: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `16-mime-parsing-safe-message-ingestion.md`  
> Target: Java 8 sampai Java 25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Jakarta Activation, Eclipse Angus Mail  
> Fokus: membaca, men-traverse, mengekstrak, dan mengamankan MIME message yang berasal dari dunia luar.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas inbound mail dari sisi `Store`, `Folder`, `Message`, flag, IMAP/POP3, dan ingestion pipeline.

Part ini masuk lebih dalam ke layer yang paling sering menipu developer: **isi email**.

Ketika sebuah aplikasi mengambil email dari mailbox, yang diterima bukan hanya `String body` dan `List<Attachment>`. Yang diterima adalah sebuah tree MIME yang bisa:

- sederhana,
- nested,
- malformed,
- ambigu,
- sangat besar,
- punya attachment tanpa filename,
- punya inline image tanpa disposition,
- punya text body sebagai attachment,
- punya HTML body berbahaya,
- punya embedded email lain,
- punya charset yang salah,
- punya transfer encoding yang tidak sesuai,
- punya filename yang dicoba untuk path traversal,
- punya archive bomb,
- punya content-type palsu.

Jakarta Mail memberi API untuk membaca struktur tersebut, tetapi **tidak otomatis membuat keputusan domain yang aman untuk aplikasi kita**.

Itulah fokus part ini.

---

## 1. Mental Model: MIME Parsing Bukan “Ambil Body Email”

### 1.1 Model yang keliru

Banyak developer membayangkan email masuk seperti ini:

```text
Email
├── from
├── to
├── subject
├── body
└── attachments[]
```

Model ini terlalu sederhana.

Model ini cocok untuk UI sederhana, tetapi bukan untuk parser.

---

### 1.2 Model yang lebih benar

Email sebenarnya lebih dekat seperti ini:

```text
Message implements Part
├── headers
├── content-type
├── content-transfer-encoding
├── disposition
├── filename
└── content
    ├── String
    ├── InputStream
    ├── Multipart
    │   ├── BodyPart implements Part
    │   ├── BodyPart implements Part
    │   └── BodyPart implements Part
    └── Message / nested RFC822 message
```

Dalam Jakarta Mail, `Message` mengimplementasikan `Part`, dan `BodyPart` juga merepresentasikan `Part` yang berada di dalam `Multipart`. `MimeMessage` adalah concrete MIME-style email message, sedangkan `MimeBodyPart` adalah MIME body part yang berada di dalam `MimeMultipart`. Dokumentasi Jakarta Mail juga menjelaskan bahwa `Part` memiliki content type berbasis MIME typing system. Referensi: Jakarta Mail `Message`, `Part`, `MimeMessage`, `MimeBodyPart`, dan `MimeMultipart` API.  

---

## 2. Tujuan Parser Production-Grade

Parser email production tidak boleh hanya “mencari body dan attachment”.

Ia harus menghasilkan **normalized representation** yang stabil untuk domain aplikasi.

Contoh output yang diinginkan:

```java
public final class ParsedInboundEmail {
    private final EmailMetadata metadata;
    private final Optional<TextBody> plainText;
    private final Optional<HtmlBody> html;
    private final List<ExtractedAttachment> attachments;
    private final List<InlineResource> inlineResources;
    private final List<NestedEmail> nestedEmails;
    private final List<ParseWarning> warnings;
    private final ParseRiskSummary riskSummary;
}
```

Tujuannya:

1. memisahkan metadata dari body;
2. memisahkan plain text dari HTML;
3. membedakan attachment biasa dan inline resource;
4. mencatat warning tanpa selalu gagal total;
5. membatasi resource;
6. membuat hasil parsing deterministik;
7. menyediakan evidence untuk audit;
8. memberi sinyal risiko ke downstream pipeline.

---

## 3. Kenapa MIME Parsing Sulit

### 3.1 Email dari dunia nyata tidak selalu valid

Email dikirim oleh banyak client dan server:

- Outlook,
- Gmail,
- Apple Mail,
- mobile client,
- scanner,
- legacy system,
- CRM,
- printer/scanner MFP,
- automated job,
- mail relay,
- ticketing system.

Masing-masing bisa menghasilkan MIME yang sedikit berbeda.

Beberapa masalah umum:

```text
- Content-Type hilang
- charset salah
- filename tidak ada
- disposition null
- attachment inline dianggap body
- body text dianggap attachment
- nested multipart terlalu dalam
- Content-ID tidak sesuai referensi HTML
- transfer encoding corrupt
- boundary rusak
- message/rfc822 nested email
- HTML dan text/plain tidak konsisten
```

---

### 3.2 `getDisposition()` tidak cukup

Developer sering membuat logic seperti ini:

```java
if (Part.ATTACHMENT.equalsIgnoreCase(part.getDisposition())) {
    // attachment
}
```

Masalahnya: banyak body part attachment atau inline resource memiliki disposition `null`.

Jadi parser yang hanya bergantung pada `getDisposition()` akan miss attachment atau salah menganggap attachment sebagai body.

Lebih aman memakai kombinasi sinyal:

```text
- Content-Disposition
- filename
- Content-ID
- Content-Type
- posisi dalam MIME tree
- parent multipart subtype
- apakah body utama sudah ditemukan
- apakah content referenced oleh HTML cid:
```

---

### 3.3 `getContent()` bisa mahal

`part.getContent()` bisa mengembalikan:

```text
String
Multipart
InputStream
Message
implementation-specific object
```

Untuk text kecil, `getContent()` nyaman.

Untuk attachment besar, `getContent()` bisa berbahaya jika membuat data besar masuk ke memory.

Untuk attachment, gunakan `getInputStream()` atau `DataHandler` stream-oriented flow dengan limit.

---

## 4. Core Jakarta Mail Types untuk Parsing

### 4.1 `Part`

`Part` adalah abstraction penting.

Baik `Message` maupun `BodyPart` adalah `Part`.

Hal ini membuat recursive parser menjadi natural:

```java
void visit(Part part, ParseContext context) {
    // inspect headers/content-type/disposition
    // if multipart, visit child parts
    // if text, capture body
    // if attachment, stream out
}
```

Key methods:

```java
String getContentType()
String getDisposition()
String getFileName()
Object getContent()
InputStream getInputStream()
DataHandler getDataHandler()
boolean isMimeType(String mimeType)
Enumeration<?> getAllHeaders()
```

`Part` API memodelkan attributes seperti content type, disposition, filename, dan content. MIME typing system digunakan untuk menamai tipe data content.  

---

### 4.2 `Message`

`Message` memodelkan email message dan mengimplementasikan `Part`.

Key methods:

```java
Address[] getFrom()
Address[] getRecipients(Message.RecipientType type)
String getSubject()
Date getSentDate()
Date getReceivedDate()
Flags getFlags()
String[] getHeader(String name)
```

`MimeMessage` adalah implementation MIME-style email message.

---

### 4.3 `Multipart`

`Multipart` adalah container untuk banyak `BodyPart`.

```java
Multipart multipart = (Multipart) part.getContent();
int count = multipart.getCount();
BodyPart child = multipart.getBodyPart(i);
```

MIME subtype penting:

```text
multipart/alternative
multipart/mixed
multipart/related
multipart/signed
multipart/report
```

---

### 4.4 `MimeMultipart`

`MimeMultipart` adalah implementasi `Multipart` berdasarkan MIME convention. Dalam dokumentasi Angus/Jakarta Mail, `MimeMultipart` adalah implementation dari abstract `Multipart` dan dapat mewakili subtype seperti `alternative`, `mixed`, `related`, `signed`, dan lainnya.  

---

### 4.5 `BodyPart` dan `MimeBodyPart`

`BodyPart` adalah `Part` yang berada di dalam `Multipart`.

`MimeBodyPart` adalah implementation berbasis MIME.

`MimeBodyPart` memakai `InternetHeaders` untuk parse dan menyimpan header body part.

---

### 4.6 `DataHandler` dan `DataSource`

Untuk binary/attachment, Jakarta Activation relevan.

`DataHandler` membungkus akses data dan biasanya memberi `InputStream`.

`DataSource` adalah abstraction sumber data.

Jakarta Activation menyediakan layanan untuk menentukan MIME type, mengenkapsulasi akses data, menemukan operasi yang tersedia, dan menyediakan implementasi convenience seperti `FileDataSource` dan `URLDataSource`.  

---

## 5. MIME Tree: Bukan List, Tapi Pohon

Contoh email sederhana:

```text
Content-Type: text/plain

Hello
```

Tree:

```text
Message[text/plain]
```

---

Contoh email plain + HTML:

```text
Message[multipart/alternative]
├── Part[text/plain]
└── Part[text/html]
```

---

Contoh HTML + inline image + attachment:

```text
Message[multipart/mixed]
├── Part[multipart/related]
│   ├── Part[multipart/alternative]
│   │   ├── Part[text/plain]
│   │   └── Part[text/html]
│   └── Part[image/png, inline, Content-ID:<logo>]
└── Part[application/pdf, attachment]
```

---

Contoh inbound real-world yang lebih buruk:

```text
Message[multipart/mixed]
├── Part[text/html, disposition=null]
├── Part[text/plain, filename="notes.txt", disposition=null]
├── Part[image/jpeg, Content-ID:<abc>, disposition=null]
├── Part[application/octet-stream, filename="invoice.pdf"]
└── Part[message/rfc822]
    └── Nested Message[multipart/alternative]
        ├── Part[text/plain]
        └── Part[text/html]
```

Parser harus memutuskan mana body utama, mana attachment, mana inline, mana nested message.

---

## 6. Prinsip Desain Parser yang Aman

### 6.1 Jangan percaya header tunggal

Tidak ada satu header yang cukup.

Gunakan beberapa sinyal.

```text
Content-Type       memberi tipe deklaratif
Content-Disposition memberi maksud presentasi
filename           memberi indikasi attachment
Content-ID         memberi indikasi inline resource
parent subtype     memberi konteks
position           memberi sinyal body utama
size               memberi risiko
actual bytes       memberi verifikasi tipe file
```

---

### 6.2 Parsing harus bounded

Selalu batasi:

```text
- max message size
- max part count
- max nesting depth
- max attachment count
- max single attachment size
- max total attachment size
- max text body size
- max HTML body size
- max filename length
- max header length captured
```

Tanpa limit, mailbox ingestion bisa menjadi denial-of-service vector.

---

### 6.3 Parsing harus menghasilkan warning

Tidak semua anomaly harus membuat email gagal.

Contoh warning:

```text
- MISSING_CONTENT_TYPE
- UNKNOWN_CHARSET
- DISPOSITION_NULL_WITH_FILENAME
- INLINE_PART_WITHOUT_CONTENT_ID
- HTML_REFERENCES_MISSING_CID
- ATTACHMENT_TYPE_MISMATCH
- MAX_TEXT_TRUNCATED
- NESTED_MESSAGE_SKIPPED_DEPTH_LIMIT
- UNSUPPORTED_MULTIPART_SIGNED
```

Parsing production-grade sering butuh mode:

```text
STRICT  : gagal pada anomaly tertentu
LENIENT : parse sejauh aman, catat warning
AUDIT   : simpan metadata penuh untuk investigasi
```

---

### 6.4 Attachment harus diproses streaming

Jangan lakukan ini untuk attachment besar:

```java
byte[] bytes = part.getInputStream().readAllBytes();
```

Lebih baik:

```java
try (InputStream in = part.getInputStream()) {
    copyWithLimit(in, output, maxBytes);
}
```

Untuk Java 8, buat utility sendiri karena `readAllBytes()` belum ada.

---

### 6.5 Parser bukan sanitizer final

MIME parser hanya mengekstrak.

Sanitization harus dilakukan di layer terpisah:

```text
MIME Parser
  -> Extracted Model
  -> Security Scanner
  -> HTML Sanitizer
  -> Attachment Validator
  -> Domain Classifier
  -> Persistence
```

Jangan campur semua keputusan dalam satu method besar.

---

## 7. Baseline Recursive Parser

### 7.1 Model hasil parsing

```java
public final class ParsedMail {
    private final MailEnvelopeMetadata metadata;
    private final String plainText;
    private final String html;
    private final List<ParsedAttachment> attachments;
    private final List<ParsedInlineResource> inlineResources;
    private final List<ParseWarning> warnings;

    public ParsedMail(
            MailEnvelopeMetadata metadata,
            String plainText,
            String html,
            List<ParsedAttachment> attachments,
            List<ParsedInlineResource> inlineResources,
            List<ParseWarning> warnings) {
        this.metadata = metadata;
        this.plainText = plainText;
        this.html = html;
        this.attachments = attachments;
        this.inlineResources = inlineResources;
        this.warnings = warnings;
    }
}
```

Untuk production, gunakan builder agar parser bisa incremental.

---

### 7.2 Parse context

```java
public final class ParseContext {
    private int depth;
    private int partCount;
    private long totalAttachmentBytes;

    private final int maxDepth;
    private final int maxParts;
    private final long maxSingleAttachmentBytes;
    private final long maxTotalAttachmentBytes;

    public ParseContext(
            int maxDepth,
            int maxParts,
            long maxSingleAttachmentBytes,
            long maxTotalAttachmentBytes) {
        this.maxDepth = maxDepth;
        this.maxParts = maxParts;
        this.maxSingleAttachmentBytes = maxSingleAttachmentBytes;
        this.maxTotalAttachmentBytes = maxTotalAttachmentBytes;
    }

    public void enterPart() {
        partCount++;
        if (partCount > maxParts) {
            throw new MailParseLimitExceededException("Too many MIME parts: " + partCount);
        }
    }

    public void enterDepth() {
        depth++;
        if (depth > maxDepth) {
            throw new MailParseLimitExceededException("MIME nesting too deep: " + depth);
        }
    }

    public void leaveDepth() {
        depth--;
    }
}
```

---

### 7.3 Recursive traversal skeleton

Jakarta version:

```java
import jakarta.mail.BodyPart;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.ContentType;
import jakarta.mail.internet.MimeMessage;

import java.io.IOException;

public final class SafeMimeParser {

    public ParsedMail parse(MimeMessage message) throws MessagingException, IOException {
        ParseContext context = new ParseContext(
                20,
                500,
                25L * 1024 * 1024,
                100L * 1024 * 1024
        );

        ParsedMailBuilder out = new ParsedMailBuilder();
        out.metadata(extractMetadata(message));

        visitPart(message, context, out, ParentKind.ROOT);
        return out.build();
    }

    private void visitPart(
            Part part,
            ParseContext context,
            ParsedMailBuilder out,
            ParentKind parentKind
    ) throws MessagingException, IOException {
        context.enterPart();

        if (part.isMimeType("multipart/*")) {
            visitMultipart(part, context, out);
            return;
        }

        if (part.isMimeType("message/rfc822")) {
            visitNestedMessage(part, context, out);
            return;
        }

        PartClassification classification = classify(part, parentKind, out);

        switch (classification) {
            case BODY_PLAIN:
                out.capturePlainText(readTextPart(part, out));
                break;
            case BODY_HTML:
                out.captureHtml(readTextPart(part, out));
                break;
            case INLINE_RESOURCE:
                extractInlineResource(part, context, out);
                break;
            case ATTACHMENT:
                extractAttachment(part, context, out);
                break;
            case IGNORED:
                out.warning(ParseWarning.unsupportedPart(safeContentType(part)));
                break;
            default:
                out.warning(ParseWarning.unknownPart(safeContentType(part)));
        }
    }

    private void visitMultipart(
            Part part,
            ParseContext context,
            ParsedMailBuilder out
    ) throws MessagingException, IOException {
        context.enterDepth();
        try {
            Multipart multipart = (Multipart) part.getContent();
            ParentKind parentKind = parentKindOf(part);

            for (int i = 0; i < multipart.getCount(); i++) {
                BodyPart child = multipart.getBodyPart(i);
                visitPart(child, context, out, parentKind);
            }
        } finally {
            context.leaveDepth();
        }
    }
}
```

Legacy JavaMail version hanya mengubah import:

```java
import javax.mail.BodyPart;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.internet.MimeMessage;
```

---

## 8. Klasifikasi Part

### 8.1 Jangan mulai dari `content instanceof String`

Lebih baik mulai dari metadata:

```text
is multipart?      -> traverse
is message/rfc822? -> nested message
has filename?      -> likely attachment
is text/plain?     -> candidate plain body or text attachment
is text/html?      -> candidate HTML body or HTML attachment
has content-id?    -> candidate inline resource
is attachment?     -> attachment
is inline?         -> inline or body depending type/context
```

---

### 8.2 Classification enum

```java
public enum PartClassification {
    BODY_PLAIN,
    BODY_HTML,
    INLINE_RESOURCE,
    ATTACHMENT,
    NESTED_MESSAGE,
    IGNORED,
    UNKNOWN
}
```

---

### 8.3 Basic classifier

```java
private PartClassification classify(
        Part part,
        ParentKind parentKind,
        ParsedMailBuilder out
) throws MessagingException {
    String disposition = part.getDisposition();
    String fileName = part.getFileName();
    String contentId = getFirstHeader(part, "Content-ID");

    boolean hasFilename = fileName != null && !fileName.trim().isEmpty();
    boolean isAttachmentDisposition = Part.ATTACHMENT.equalsIgnoreCase(disposition);
    boolean isInlineDisposition = Part.INLINE.equalsIgnoreCase(disposition);
    boolean hasContentId = contentId != null && !contentId.trim().isEmpty();

    if (isAttachmentDisposition || hasFilename) {
        // text/plain with filename should usually be treated as attachment, not main body
        return PartClassification.ATTACHMENT;
    }

    if (hasContentId && isProbablyInlineResource(part)) {
        return PartClassification.INLINE_RESOURCE;
    }

    if (part.isMimeType("text/plain")) {
        return PartClassification.BODY_PLAIN;
    }

    if (part.isMimeType("text/html")) {
        return PartClassification.BODY_HTML;
    }

    if (isInlineDisposition || hasContentId) {
        return PartClassification.INLINE_RESOURCE;
    }

    return PartClassification.UNKNOWN;
}

private boolean isProbablyInlineResource(Part part) throws MessagingException {
    return part.isMimeType("image/*")
            || part.isMimeType("font/*")
            || part.isMimeType("text/css")
            || part.isMimeType("application/octet-stream");
}
```

Catatan penting: `application/octet-stream` adalah tipe generik. Jangan percaya sebagai tipe aktual.

---

### 8.4 Parent context matters

Dalam `multipart/alternative`, urutan body penting.

Biasanya:

```text
multipart/alternative
├── text/plain
└── text/html
```

Semakin akhir biasanya semakin rich.

Namun untuk parser domain, sering lebih aman menyimpan keduanya:

```text
plainText = text/plain candidate terbaik
html      = text/html candidate terbaik
```

Dalam `multipart/related`, part image dengan `Content-ID` biasanya inline resource untuk HTML.

Dalam `multipart/mixed`, part tambahan biasanya attachment.

---

## 9. ParentKind dan Multipart Subtype

```java
public enum ParentKind {
    ROOT,
    MULTIPART_MIXED,
    MULTIPART_ALTERNATIVE,
    MULTIPART_RELATED,
    MULTIPART_SIGNED,
    MULTIPART_REPORT,
    MULTIPART_OTHER
}
```

```java
private ParentKind parentKindOf(Part part) throws MessagingException {
    if (part.isMimeType("multipart/mixed")) {
        return ParentKind.MULTIPART_MIXED;
    }
    if (part.isMimeType("multipart/alternative")) {
        return ParentKind.MULTIPART_ALTERNATIVE;
    }
    if (part.isMimeType("multipart/related")) {
        return ParentKind.MULTIPART_RELATED;
    }
    if (part.isMimeType("multipart/signed")) {
        return ParentKind.MULTIPART_SIGNED;
    }
    if (part.isMimeType("multipart/report")) {
        return ParentKind.MULTIPART_REPORT;
    }
    return ParentKind.MULTIPART_OTHER;
}
```

---

## 10. Membaca Text Part Dengan Aman

### 10.1 Text body harus dibatasi

Email body bisa sangat besar.

Untuk plain text dan HTML, buat limit.

```java
private String readTextPart(Part part, ParsedMailBuilder out)
        throws MessagingException, IOException {
    Object content = part.getContent();

    if (content instanceof String) {
        return truncate((String) content, 1_000_000, out);
    }

    // fallback: decode stream as best effort
    try (InputStream in = part.getInputStream()) {
        byte[] bytes = readUpTo(in, 1_000_000 + 1);
        if (bytes.length > 1_000_000) {
            out.warning(ParseWarning.textTruncated(safeContentType(part)));
        }
        return new String(bytes, detectCharsetOrUtf8(part));
    }
}
```

---

### 10.2 Charset problem

`Content-Type` bisa seperti:

```text
text/plain; charset=UTF-8
text/html; charset="iso-8859-1"
text/plain; charset=windows-1252
text/plain
text/plain; charset=UNKNOWN
```

Parser perlu fallback.

```java
private Charset detectCharsetOrUtf8(Part part) throws MessagingException {
    try {
        String contentType = part.getContentType();
        ContentType parsed = new ContentType(contentType);
        String charset = parsed.getParameter("charset");
        if (charset == null || charset.trim().isEmpty()) {
            return StandardCharsets.UTF_8;
        }
        return Charset.forName(charset.trim().replace("\"", ""));
    } catch (Exception ex) {
        return StandardCharsets.UTF_8;
    }
}
```

Caveat: jika `getContent()` sudah mengembalikan `String`, decoding sudah dilakukan oleh Jakarta Mail provider/data handler. Charset fallback terutama berguna ketika membaca stream sendiri.

---

### 10.3 Jangan render HTML dari inbound email tanpa sanitization

Inbound HTML harus dianggap tidak trusted.

Risiko:

```text
- external tracking image
- phishing link
- malicious form
- script-like payload walau banyak mail client block script
- CSS exfiltration pattern
- hidden content
- misleading link text
```

Untuk aplikasi case management, ticketing, atau regulatory platform, simpan HTML original sebagai evidence jika perlu, tetapi tampilkan versi sanitized.

---

## 11. Attachment Extraction Aman

### 11.1 Metadata attachment

```java
public final class ParsedAttachment {
    private final String originalFileName;
    private final String safeFileName;
    private final String declaredContentType;
    private final String detectedContentType;
    private final long sizeBytes;
    private final String sha256;
    private final AttachmentStorageRef storageRef;
    private final List<ParseWarning> warnings;
}
```

Untuk system serius, jangan hanya simpan file bytes.

Simpan juga:

```text
- original filename
- normalized filename
- declared content type
- detected content type
- content disposition
- content id
- size
- hash
- source message id
- extraction timestamp
- scanner status
```

---

### 11.2 Sanitasi filename

Header filename tidak boleh dipercaya.

Contoh berbahaya:

```text
../../../../etc/passwd
..\..\windows\system32\drivers\etc\hosts
invoice.pdf.exe
invoice.pdf%00.exe
con
nul
aux
very-long-name-....pdf
```

Utility:

```java
private String sanitizeFileName(String rawName) {
    if (rawName == null || rawName.trim().isEmpty()) {
        return "attachment.bin";
    }

    String name = rawName.trim();
    name = name.replace('\\', '/');
    int slash = name.lastIndexOf('/');
    if (slash >= 0) {
        name = name.substring(slash + 1);
    }

    name = name.replaceAll("[\u0000-\u001F\u007F]", "_");
    name = name.replaceAll("[^A-Za-z0-9._ -]", "_");
    name = name.replaceAll("\\s+", " ").trim();

    if (name.equals(".") || name.equals("..") || name.isEmpty()) {
        name = "attachment.bin";
    }

    if (name.length() > 180) {
        name = name.substring(0, 180);
    }

    return name;
}
```

Jangan pakai filename sebagai path langsung.

Gunakan generated storage key:

```text
attachments/{tenantId}/{messageId}/{uuid}
```

---

### 11.3 Streaming copy with limit and hash

```java
public final class StreamCopyResult {
    private final long bytesCopied;
    private final String sha256Hex;

    public StreamCopyResult(long bytesCopied, String sha256Hex) {
        this.bytesCopied = bytesCopied;
        this.sha256Hex = sha256Hex;
    }
}
```

```java
private StreamCopyResult copyWithLimitAndHash(
        InputStream in,
        OutputStream out,
        long maxBytes
) throws IOException {
    MessageDigest digest;
    try {
        digest = MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException("SHA-256 unavailable", e);
    }

    byte[] buffer = new byte[8192];
    long total = 0;

    while (true) {
        int read = in.read(buffer);
        if (read == -1) {
            break;
        }

        total += read;
        if (total > maxBytes) {
            throw new MailParseLimitExceededException("Attachment exceeds limit: " + maxBytes);
        }

        digest.update(buffer, 0, read);
        out.write(buffer, 0, read);
    }

    return new StreamCopyResult(total, toHex(digest.digest()));
}

private String toHex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) {
        sb.append(String.format("%02x", b));
    }
    return sb.toString();
}
```

---

### 11.4 Extract attachment

```java
private void extractAttachment(
        Part part,
        ParseContext context,
        ParsedMailBuilder out
) throws MessagingException, IOException {
    String rawName = part.getFileName();
    String safeName = sanitizeFileName(rawName);
    String declaredType = safeContentType(part);

    AttachmentStorageTarget target = out.storage().createTarget(safeName);

    try (InputStream in = part.getInputStream();
         OutputStream os = target.openOutputStream()) {
        StreamCopyResult result = copyWithLimitAndHash(
                in,
                os,
                context.maxSingleAttachmentBytes()
        );

        context.addAttachmentBytes(result.getBytesCopied());

        out.addAttachment(new ParsedAttachment(
                rawName,
                safeName,
                declaredType,
                null, // fill after magic-byte detection/scanner
                result.getBytesCopied(),
                result.getSha256Hex(),
                target.toStorageRef(),
                List.of()
        ));
    }
}
```

Untuk Java 8, `List.of()` diganti `Collections.emptyList()`.

---

## 12. Inline Resource Extraction

Inline resource adalah body part yang biasanya direferensikan dari HTML:

```html
<img src="cid:logo123">
```

MIME part:

```text
Content-Type: image/png
Content-Disposition: inline
Content-ID: <logo123>
```

Namun real-world bisa punya:

```text
Content-Disposition: null
Content-ID: <logo123>
```

Jadi `Content-ID` adalah sinyal penting.

```java
private void extractInlineResource(
        Part part,
        ParseContext context,
        ParsedMailBuilder out
) throws MessagingException, IOException {
    String contentId = normalizeContentId(getFirstHeader(part, "Content-ID"));
    String declaredType = safeContentType(part);
    String fileName = sanitizeFileName(part.getFileName());

    InlineStorageTarget target = out.storage().createInlineTarget(contentId, fileName);

    try (InputStream in = part.getInputStream();
         OutputStream os = target.openOutputStream()) {
        StreamCopyResult result = copyWithLimitAndHash(
                in,
                os,
                context.maxSingleAttachmentBytes()
        );

        out.addInlineResource(new ParsedInlineResource(
                contentId,
                fileName,
                declaredType,
                result.getBytesCopied(),
                result.getSha256Hex(),
                target.toStorageRef()
        ));
    }
}

private String normalizeContentId(String raw) {
    if (raw == null) {
        return null;
    }
    String value = raw.trim();
    if (value.startsWith("<") && value.endsWith(">") && value.length() > 2) {
        value = value.substring(1, value.length() - 1);
    }
    return value.trim();
}
```

---

## 13. Nested Email: `message/rfc822`

Email bisa berisi email lain sebagai attachment atau forward.

Content type:

```text
message/rfc822
```

Dalam Jakarta Mail, `getContent()` bisa mengembalikan `Message`.

```java
private void visitNestedMessage(
        Part part,
        ParseContext context,
        ParsedMailBuilder out
) throws MessagingException, IOException {
    if (context.depth() >= context.maxDepth()) {
        out.warning(ParseWarning.nestedMessageSkippedDepthLimit());
        return;
    }

    Object content = part.getContent();

    if (content instanceof Message) {
        Message nested = (Message) content;
        out.addNestedMetadata(extractMetadata(nested));
        visitPart(nested, context, out, ParentKind.ROOT);
        return;
    }

    out.warning(ParseWarning.unsupportedNestedMessageContent(content == null ? "null" : content.getClass().getName()));
}
```

Important design decision:

```text
Apakah nested email diperlakukan sebagai attachment evidence?
Atau diparse penuh dan digabungkan ke body utama?
```

Untuk enterprise/case management, lebih aman:

```text
- simpan nested email sebagai evidence attachment
- ekstrak metadata ringkas
- jangan gabungkan body nested ke body utama tanpa label
```

Karena nested email bisa mengubah konteks komunikasi.

---

## 14. Handling `multipart/alternative`

`multipart/alternative` berisi representasi alternatif dari content yang sama.

Contoh:

```text
multipart/alternative
├── text/plain
└── text/html
```

Strategy:

```text
- simpan plain text jika ada
- simpan HTML jika ada
- jangan anggap keduanya dua pesan berbeda
- gunakan HTML untuk rich display setelah sanitize
- gunakan plain text untuk search/index fallback
```

Advanced strategy:

```java
public final class AlternativeCandidate {
    private final String mimeType;
    private final String content;
    private final int position;
    private final int score;
}
```

Scoring:

```text
text/plain score 10
text/html  score 20
multipart/related containing html score 25
unsupported type score 0
```

Namun simpan semua candidate yang relevan untuk audit bila perlu.

---

## 15. Handling `multipart/related`

`multipart/related` biasanya punya root body dan related resources.

Contoh:

```text
multipart/related
├── text/html
├── image/png Content-ID:<logo>
└── image/jpeg Content-ID:<banner>
```

Parsing strategy:

```text
- cari HTML root
- capture inline resources dengan Content-ID
- setelah parse, validasi cid references dari HTML
```

Post-parse check:

```text
HTML references: logo, banner, missingImage
Extracted inline resources: logo, banner
Warning: HTML_REFERENCES_MISSING_CID: missingImage
```

---

## 16. Handling `multipart/mixed`

`multipart/mixed` biasanya container top-level untuk body + attachments.

Contoh:

```text
multipart/mixed
├── multipart/alternative
│   ├── text/plain
│   └── text/html
├── application/pdf
└── image/png
```

Strategy:

```text
- traverse all parts
- body candidate biasanya pertama atau nested alternative
- part dengan filename/disposition attachment menjadi attachment
- jangan hentikan parsing setelah menemukan body
```

---

## 17. Handling `multipart/signed` dan `multipart/encrypted`

Beberapa email security-aware memakai:

```text
multipart/signed
multipart/encrypted
application/pkcs7-mime
application/pgp-encrypted
```

Jakarta Mail basic parsing bisa melihat part-nya, tetapi verification/decryption bukan otomatis domain utama Jakarta Mail.

Strategy awal:

```text
- detect signed/encrypted multipart
- jangan discard signature part
- simpan sebagai evidence
- beri warning/flag SECURITY_WRAPPED_MESSAGE
- jika requirement ada, integrasikan S/MIME atau PGP library terpisah
```

Untuk regulatory system, jangan pura-pura “signature valid” hanya karena MIME type `multipart/signed` ada.

Signature validation harus eksplisit.

---

## 18. Handling `multipart/report` dan Bounce Message

Bounce/DSN sering memakai:

```text
multipart/report; report-type=delivery-status
```

Isi bisa:

```text
multipart/report
├── text/plain
├── message/delivery-status
└── message/rfc822
```

Parser inbound umum harus bisa mengenali ini.

Namun bounce processing sebaiknya punya parser khusus, karena field seperti:

```text
Final-Recipient
Action
Status
Diagnostic-Code
Remote-MTA
```

punya makna delivery feedback.

Part ini cukup menandai:

```text
INBOUND_MESSAGE_IS_DELIVERY_STATUS_NOTIFICATION
```

Detail bounce akan dibahas pada part feedback loop.

---

## 19. Content-Type Tidak Bisa Dipercaya

### 19.1 Declared vs detected content type

Header bisa berkata:

```text
Content-Type: application/pdf
filename="invoice.pdf"
```

Tetapi bytes sebenarnya bisa:

```text
MZ... executable
PK... zip/docx/xlsx/jar
<html> phishing page
```

Jadi simpan dua jenis tipe:

```text
declaredContentType = dari header
filenameExtension   = dari filename
magicDetectedType   = dari bytes
scannerDetectedType = dari AV/content scanner
```

---

### 19.2 Minimal magic-byte check

Contoh sederhana:

```java
private String detectByMagic(byte[] prefix) {
    if (startsWith(prefix, new byte[]{0x25, 0x50, 0x44, 0x46})) {
        return "application/pdf";
    }
    if (startsWith(prefix, new byte[]{0x50, 0x4B, 0x03, 0x04})) {
        return "application/zip-or-ooxml";
    }
    if (startsWith(prefix, new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF})) {
        return "image/jpeg";
    }
    if (startsWith(prefix, new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47})) {
        return "image/png";
    }
    return "application/octet-stream";
}
```

Untuk production, gunakan library mature seperti Apache Tika atau scanner platform, tetapi tetap jangan anggap hasil deteksi sebagai satu-satunya kontrol keamanan.

---

## 20. Zip Bomb dan Archive Handling

Attachment archive harus dianggap high risk.

Jenis umum:

```text
.zip
.7z
.rar
.tar
.gz
.docx
.xlsx
.pptx
.jar
```

Catatan: Office modern `.docx/.xlsx/.pptx` adalah ZIP container.

Kontrol minimum:

```text
- max compressed size
- max uncompressed size
- max file count inside archive
- max nesting depth
- block absolute path entry
- block ../ path traversal
- block symlink if extracting
- scan extracted files
```

Jangan extract archive langsung ke filesystem target.

Gunakan quarantine/temp directory dengan generated path, lalu validasi.

---

## 21. Header Extraction Aman

Header email bisa panjang dan banyak.

Jangan simpan semua header mentah tanpa limit.

```java
private Map<String, List<String>> extractSelectedHeaders(Part part) throws MessagingException {
    Map<String, List<String>> headers = new LinkedHashMap<>();
    for (String name : List.of(
            "Message-ID",
            "In-Reply-To",
            "References",
            "From",
            "To",
            "Cc",
            "Date",
            "Subject",
            "Content-Type",
            "Content-Disposition",
            "Content-ID"
    )) {
        String[] values = part.getHeader(name);
        if (values != null) {
            headers.put(name, sanitizeHeaderValues(values));
        }
    }
    return headers;
}
```

Java 8 replacement:

```java
Arrays.asList("Message-ID", "In-Reply-To", ...)
```

---

## 22. Malformed MIME Strategy

### 22.1 Failure classes

```text
PARSER_FATAL
- cannot read message stream
- part count limit exceeded
- depth limit exceeded
- total size limit exceeded
- corrupt transfer encoding at critical part

PARSER_WARNING
- unknown charset fallback
- unsupported content type ignored
- filename sanitized
- missing content id
- content type mismatch
```

---

### 22.2 Exception hierarchy

```java
public class InboundMailParseException extends RuntimeException {
    public InboundMailParseException(String message, Throwable cause) {
        super(message, cause);
    }
}

public class MailParseLimitExceededException extends InboundMailParseException {
    public MailParseLimitExceededException(String message) {
        super(message, null);
    }
}

public class MailParseSecurityException extends InboundMailParseException {
    public MailParseSecurityException(String message) {
        super(message, null);
    }
}
```

Better:

```java
public enum ParseFailureCode {
    MIME_DEPTH_LIMIT_EXCEEDED,
    MIME_PART_LIMIT_EXCEEDED,
    ATTACHMENT_SIZE_LIMIT_EXCEEDED,
    TOTAL_ATTACHMENT_SIZE_LIMIT_EXCEEDED,
    UNSUPPORTED_ENCODING,
    MALFORMED_MULTIPART,
    IO_FAILURE,
    SECURITY_POLICY_REJECTED
}
```

---

## 23. Storing Parsed Content

### 23.1 Jangan selalu simpan raw email di database utama

Raw `.eml` bisa besar.

Better architecture:

```text
DB
├── inbound_message metadata
├── parsed body references
├── attachment metadata
├── parse warnings
└── storage object references

Object Storage / File Storage
├── raw .eml
├── sanitized html
├── plain text
├── attachments
└── inline resources
```

---

### 23.2 Simpan raw `.eml` untuk audit?

Untuk sistem case management/regulatory, menyimpan raw `.eml` bisa penting sebagai evidence.

Trade-off:

```text
Pros:
- forensic reconstruction
- audit defensibility
- reparse with improved parser
- dispute handling

Cons:
- storage cost
- PII exposure
- retention obligation
- access control burden
- malware retention risk
```

Jika raw `.eml` disimpan:

```text
- encrypt at rest
- restrict access
- mark scanner status
- apply retention
- never render raw HTML directly
- avoid broad search indexing of sensitive content
```

---

## 24. Ingestion Pipeline Aman

Recommended pipeline:

```text
1. Fetch message from mailbox
2. Capture mailbox identity + UID + folder + received timestamp
3. Store raw message safely if required
4. Parse MIME with limits
5. Store extracted artifacts in quarantine
6. Run security scanning
7. Sanitize HTML
8. Classify business intent
9. Link to case/ticket/entity
10. Persist normalized inbound record
11. Mark mailbox message processed only after durable persistence
12. Move/archive mailbox message
```

---

## 25. Idempotency Untuk Inbound MIME Parsing

Inbound ingestion bisa re-run.

Gunakan dedup key:

```text
mailbox_id + folder + UIDVALIDITY + UID
```

Atau fallback:

```text
Message-ID + receivedDate + from + subject hash
```

Namun `Message-ID` tidak selalu unik sempurna untuk semua business case.

Untuk IMAP, UID + UIDVALIDITY lebih kuat dalam konteks mailbox.

Parsing harus idempotent:

```text
- same message parsed twice tidak membuat duplicate case note
- same attachment tidak disimpan dua kali jika hash sama dan policy mengizinkan reuse
- mailbox flag/move operation aman diulang
```

---

## 26. Security Boundary: Email Adalah Input Tidak Terpercaya

Inbound email sama seperti file upload publik.

Threats:

```text
- malware attachment
- phishing HTML
- tracking pixels
- oversized message DoS
- nested MIME DoS
- archive bomb
- filename path traversal
- spoofed sender
- header injection into logs/UI
- HTML stored XSS if rendered in internal portal
- entity linking manipulation
```

Controls:

```text
- size limits
- part count/depth limits
- attachment quarantine
- AV/content scanning
- HTML sanitization
- safe link rendering
- sender authentication checks if available
- domain allow/deny policy
- audit trail
- least privilege mailbox account
```

---

## 27. HTML Sanitization Pattern

### 27.1 Store original vs display version

```text
originalHtmlRef    = exact extracted HTML, restricted access
sanitizedHtmlRef   = safe display HTML
plainText          = search/index fallback
```

---

### 27.2 Remove dangerous elements

Sanitizer policy should usually remove:

```text
script
iframe
object
embed
form
input
button
meta refresh
external CSS imports
inline event handlers
javascript: URLs
data: URLs unless explicitly allowed for safe image types
```

---

### 27.3 Link rewriting

Internal display can rewrite links:

```text
Original: https://example.com/path
Display:  https://example.com/path
Href:     /safe-redirect?token=...
```

Benefits:

```text
- warning page
- click audit
- block known malicious domains
- prevent accidental direct navigation
```

But this has privacy/compliance implications.

---

## 28. Sender Spoofing and Trust

Parser extracts `From`, but `From` is not proof of identity.

Possible signals:

```text
- SMTP envelope sender
- header From
- DKIM result from receiving server
- SPF result from receiving server
- DMARC result from receiving server
- ARC headers
- trusted mailbox source
- allowlisted sender/domain
```

Jakarta Mail can read headers. It does not automatically decide trust.

Inbound business logic should not do:

```java
if (from.equals("ceo@example.com")) approveAutomatically();
```

For regulatory/case system:

```text
Header identity is claim, not authentication.
```

---

## 29. Practical Parser Architecture

```text
InboundMailIngestionService
├── MailboxClient
│   └── fetches Message/UID/folder metadata
├── RawMessageStore
│   └── stores .eml if required
├── MimeParser
│   └── produces ParsedInboundEmail
├── ArtifactStore
│   └── stores body/attachments/inline resources
├── AttachmentScanner
│   └── AV/content policy
├── HtmlSanitizer
│   └── safe rendering version
├── BusinessClassifier
│   └── maps to case/ticket/domain entity
├── InboundMailRepository
│   └── durable state
└── MailboxCheckpointService
    └── marks/moves only after success
```

---

## 30. Example: Clean Port Interface

```java
public interface InboundMimeParser {
    ParsedInboundEmail parse(InboundRawMessage rawMessage) throws InboundMailParseException;
}
```

```java
public final class InboundRawMessage {
    private final String mailboxId;
    private final String folderName;
    private final String uidValidity;
    private final String uid;
    private final InputStream rawStream;

    // constructor/getters omitted
}
```

But if using Jakarta Mail directly from IMAP:

```java
public interface JakartaMailMessageParser {
    ParsedInboundEmail parse(Message message, MailboxMessageIdentity identity);
}
```

Avoid leaking Jakarta Mail API across entire business layer.

---

## 31. Unit Testing MIME Parser

### 31.1 Test with raw `.eml` fixtures

Create test resources:

```text
src/test/resources/mail-fixtures/
├── simple-text.eml
├── alternative-text-html.eml
├── html-inline-image.eml
├── pdf-attachment.eml
├── attachment-no-disposition.eml
├── nested-message.eml
├── malformed-boundary.eml
├── unknown-charset.eml
├── huge-attachment.eml
├── multipart-report-bounce.eml
└── filename-path-traversal.eml
```

---

### 31.2 Load fixture as `MimeMessage`

Jakarta version:

```java
Session session = Session.getInstance(new Properties());
try (InputStream in = getClass().getResourceAsStream("/mail-fixtures/simple-text.eml")) {
    MimeMessage message = new MimeMessage(session, in);
    ParsedInboundEmail parsed = parser.parse(message);
    assertEquals("expected text", parsed.getPlainText().orElse(null));
}
```

Legacy JavaMail version uses `javax.mail.Session` and `javax.mail.internet.MimeMessage`.

---

### 31.3 Assert MIME structure decisions

Test cases:

```text
- text/plain without filename becomes plain body
- text/plain with filename becomes attachment
- image with Content-ID becomes inline resource
- image with filename and attachment disposition becomes attachment
- nested message captured separately
- huge attachment rejected
- path traversal filename sanitized
- unknown charset fallback warning created
```

---

## 32. Golden Test: HTML + Inline + Attachment

Expected:

```text
plainText present
html present
inlineResources size = 1
attachments size = 1
warnings empty or expected
```

MIME tree:

```text
multipart/mixed
├── multipart/related
│   ├── multipart/alternative
│   │   ├── text/plain
│   │   └── text/html with cid:logo
│   └── image/png Content-ID:<logo>
└── application/pdf attachment filename=invoice.pdf
```

This should be part of regression suite.

---

## 33. Common Anti-Patterns

### 33.1 Assuming email has one body

Wrong:

```java
String body = message.getContent().toString();
```

Because content may be `Multipart`.

---

### 33.2 Assuming every attachment has disposition attachment

Wrong:

```java
Part.ATTACHMENT.equals(part.getDisposition())
```

Use filename/content-id/content-type/context.

---

### 33.3 Loading all attachments into memory

Wrong:

```java
byte[] bytes = part.getInputStream().readAllBytes();
```

Use streaming with limit.

---

### 33.4 Rendering inbound HTML directly

Wrong:

```html
<div>${rawInboundHtml}</div>
```

Use sanitizer and safe rendering boundary.

---

### 33.5 Trusting `From`

Wrong:

```java
if (fromDomain.equals("trusted.gov")) autoApprove();
```

Header identity is not authentication.

---

### 33.6 Marking mailbox message processed before durable persistence

Wrong sequence:

```text
1. read message
2. mark seen / move archive
3. parse
4. save
```

If parse/save fails, message can disappear from processing flow.

Better:

```text
1. read message
2. parse/store durable result
3. commit inbound record
4. mark/move mailbox message
```

---

## 34. Production Configuration Checklist

Parser limits:

```text
maxMessageBytes            = 50 MB / according to business
maxMimeDepth               = 20
maxMimePartCount           = 500
maxSingleAttachmentBytes   = 25 MB
maxTotalAttachmentBytes    = 100 MB
maxPlainTextChars          = 1 MB
maxHtmlChars               = 2 MB
maxFilenameLength          = 180
maxHeadersStored           = selected only or bounded
```

Security:

```text
attachment quarantine      = yes
AV scanning                = yes
HTML sanitization          = yes
filename sanitization      = yes
content-type detection     = yes
raw EML restricted         = yes
PII-aware logs             = yes
```

Operational:

```text
parse warning metrics      = yes
parse failure metrics      = yes
message UID checkpoint     = yes
dead-letter mailbox/queue  = yes
reparse capability         = yes
fixture regression suite   = yes
```

---

## 35. Observability for MIME Parsing

Metrics:

```text
inbound_parse_attempt_total
inbound_parse_success_total
inbound_parse_failure_total
inbound_parse_warning_total{warning_code}
inbound_attachment_count
inbound_attachment_bytes_total
inbound_mime_part_count
inbound_mime_depth_max
inbound_html_sanitized_total
inbound_security_rejected_total
```

Logs should include:

```text
correlationId
mailboxId
folder
uid
messageId hash or redacted
parseStatus
warningCodes
attachmentCount
sizeBytes
```

Do not log:

```text
full subject if sensitive
full sender/recipient if PII policy forbids
raw body
raw attachment content
full headers containing auth/routing data unless restricted
```

---

## 36. Java 8 sampai Java 25 Notes

### 36.1 Java 8

Likely stack:

```text
javax.mail:mail / com.sun.mail:javax.mail
javax.activation
```

Constraints:

```text
- no InputStream.readAllBytes()
- no List.of()
- no records
- less convenient immutable collections
```

Design tetap sama.

---

### 36.2 Java 11+

Java EE modules removed from JDK, so dependencies must be explicit.

Avoid assuming mail/activation classes exist in JDK.

---

### 36.3 Java 17/21/25

Likely stack:

```text
jakarta.mail-api
org.eclipse.angus:angus-mail
jakarta.activation-api
org.eclipse.angus:angus-activation
```

Useful language/runtime features:

```text
- records for immutable parsed DTO
- sealed interfaces for parse result/failure
- virtual threads for blocking mailbox fetch/parser orchestration, if bounded carefully
- better switch expressions
- modern NIO utilities
```

But parsing large untrusted MIME remains a resource-bound problem. Virtual threads do not remove the need for size limits.

---

## 37. Reference Design: Parser Output State Machine

```text
RAW_FETCHED
  ↓
RAW_STORED
  ↓
PARSE_STARTED
  ↓
PARSED_WITHOUT_WARNING ──────────────┐
  ↓                                  │
PARSED_WITH_WARNING                  │
  ↓                                  │
SECURITY_SCAN_PENDING                │
  ↓                                  │
SECURITY_CLEAN                       │
  ↓                                  │
SANITIZED                            │
  ↓                                  │
READY_FOR_BUSINESS_CLASSIFICATION    │
                                     │
PARSE_FAILED_RETRYABLE               │
PARSE_FAILED_PERMANENT               │
SECURITY_REJECTED                    │
QUARANTINED                          │
```

State should separate:

```text
parse failure
security rejection
business classification failure
mailbox operation failure
```

Do not collapse everything into `FAILED`.

---

## 38. Top 1% Mental Model

A top-level engineer sees MIME parsing as this:

```text
Inbound email is adversarial, nested, lossy, and historically messy input.
Jakarta Mail gives structured access to MIME parts, but the application must impose policy.
The parser must be recursive, bounded, streaming, warning-aware, and auditable.
```

Important invariants:

```text
1. Never trust a single MIME header.
2. Never load unbounded content into memory.
3. Never render inbound HTML directly.
4. Never use filename as storage path.
5. Never treat header From as authenticated identity.
6. Never mark mailbox message processed before durable persistence.
7. Never discard parse warnings silently.
8. Never mix parsing, scanning, sanitization, and business classification into one opaque method.
```

---

## 39. Summary

Pada part ini kita membahas:

- MIME message sebagai tree, bukan flat object;
- `Part`, `Message`, `BodyPart`, `Multipart`, `MimeMessage`, `MimeBodyPart`;
- recursive MIME traversal;
- classification body vs attachment vs inline resource;
- safe text extraction;
- charset fallback;
- attachment streaming dengan limit dan hash;
- filename sanitization;
- inline resource handling;
- nested `message/rfc822`;
- `multipart/alternative`, `related`, `mixed`, `signed`, `report`;
- malformed MIME strategy;
- HTML sanitization boundary;
- inbound pipeline yang durable;
- idempotency;
- observability;
- Java 8 sampai Java 25 concerns;
- production-grade invariants.

Inti part ini: **MIME parsing adalah input-processing subsystem, bukan utility kecil.**

Jika email masuk bisa memengaruhi case, workflow, audit, atau keputusan bisnis, maka parser harus diperlakukan sebagai security-sensitive dan reliability-sensitive component.

---

## 40. Referensi

- Jakarta Mail 2.1 Specification — overview dan design goal Jakarta Mail sebagai framework mail/messaging application.
- Jakarta Mail API Documentation — `Message`, `Part`, `BodyPart`, `Multipart`, `MimeMessage`, `MimeBodyPart`, `MimeMultipart`.
- Eclipse Angus Mail Documentation — implementation modern Jakarta Mail dan API documentation untuk MIME/multipart.
- Jakarta Activation 2.1 Specification — `DataSource`, `DataHandler`, MIME type handling, data access abstraction.
- RFC 2045–2049 — MIME family.
- RFC 5322 — Internet Message Format.
- RFC 3501 — IMAP4rev1.

---

## Status Seri

Progress saat ini:

```text
[x] Part 0  — Orientation: Email as a Distributed System
[x] Part 1  — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[x] Part 2  — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[x] Part 3  — Core API: Session, Store, Folder, Transport, Message
[x] Part 4  — SMTP Sending: Properties, Transport, Timeout, TLS, Auth
[x] Part 5  — MIME Message Construction: Text, HTML, Charset, Headers
[x] Part 6  — Multipart Email: Alternative, Mixed, Related, Nested Structure
[x] Part 7  — Attachment Handling and Jakarta Activation
[x] Part 8  — HTML Email Engineering: Templates, CSS, Images, Client Compatibility
[x] Part 9  — Mail Addressing, Identity, and Header Semantics
[x] Part 10 — Error Model: MessagingException, SendFailedException, SMTPAddressFailedException
[x] Part 11 — Reliable Email Delivery Architecture: Queue, Outbox, Retry, Idempotency
[x] Part 12 — Bulk, Batch, and Rate-Limited Sending
[x] Part 13 — Security Deep Dive: TLS, Credential, OAuth2, Secret Management
[x] Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce
[x] Part 15 — Inbound Mail: IMAP/POP3, Store, Folder, Message Reading
[x] Part 16 — MIME Parsing: Reading Complex Messages Safely
[ ] Part 17 — Jakarta Mail in Jakarta EE Containers
[ ] Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications
[ ] Part 19 — Testing Mail Systems: Unit, Integration, Contract, E2E
[ ] Part 20 — Observability: Logs, Metrics, Tracing, Audit
[ ] Part 21 — Performance and Resource Management
[ ] Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider
[ ] Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop
[ ] Part 24 — Template Architecture and Domain Notification Design
[ ] Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems
[ ] Part 26 — Advanced MIME and Internationalization
[ ] Part 27 — Failure Modelling and Production Incident Playbook
[ ] Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern
[ ] Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect
```

Seri belum selesai. Bagian berikutnya adalah **Part 17 — Jakarta Mail in Jakarta EE Containers**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./15-inbound-mail-imap-pop3-store-folder.md">⬅️ Part 15 — Inbound Mail: IMAP/POP3, Store, Folder, Message Reading</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./17-jakarta-ee-container-managed-mail.md">Part 17 — Jakarta Mail in Jakarta EE Containers ➡️</a>
</div>
