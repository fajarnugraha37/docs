# Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern

> Seri: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `28-end-to-end-reference-implementation.md`  
> Target: Java 8 sampai Java 25  
> Fokus: implementasi utuh mail subsystem yang reliable, testable, observable, migratable, dan defensible.

---

## 0. Posisi Part Ini dalam Seri

Bagian ini adalah integrasi besar dari semua bagian sebelumnya.

Sebelumnya kita sudah membahas:

1. email sebagai distributed system;
2. SMTP, MIME, POP3, IMAP;
3. JavaMail `javax.mail` ke Jakarta Mail `jakarta.mail`;
4. `Session`, `Transport`, `Message`, `MimeMessage`, `Multipart`;
5. TLS, timeout, authentication;
6. MIME text, HTML, charset, multipart, attachment, Activation;
7. error model;
8. outbox, retry, idempotency;
9. observability;
10. compliance dan incident playbook.

Part ini menjawab pertanyaan praktis:

> Kalau semua itu harus dijadikan sistem nyata, bentuk implementasinya seperti apa?

Kita tidak akan membuat contoh “hello world send email”. Kita akan membuat desain dan potongan implementasi yang bisa menjadi dasar **enterprise mail subsystem**.

---

## 1. Target Arsitektur

Mail subsystem yang baik tidak hanya punya method:

```java
sendEmail(to, subject, body);
```

Subsystem yang baik harus mampu menjawab:

1. siapa yang meminta email dikirim;
2. untuk business event apa email dikirim;
3. template versi berapa yang dipakai;
4. data apa yang dirender;
5. recipient mana saja yang dituju;
6. apakah email sudah dirender;
7. apakah sudah masuk queue;
8. apakah SMTP/provider sudah menerima;
9. apakah ada partial failure;
10. apakah retry aman;
11. apakah duplicate bisa dicegah;
12. apakah attachment aman;
13. apakah log tidak membocorkan PII;
14. apakah failure bisa diklasifikasikan;
15. apakah sistem bisa di-drain/replay setelah incident.

Arsitektur target:

```text
+------------------------+
| Business Module         |
| Case / Appeal / User    |
+-----------+------------+
            |
            | create notification intent
            v
+------------------------+
| Notification Service    |
| - validate business     |
| - choose template       |
| - build MailRequest     |
+-----------+------------+
            |
            | transactionally insert
            v
+------------------------+
| Mail Outbox Table       |
| PENDING / PROCESSING    |
| SENT / FAILED / DEAD    |
+-----------+------------+
            |
            | poll / claim / lock
            v
+------------------------+
| Mail Worker             |
| - render template       |
| - compose MIME          |
| - send via gateway      |
| - classify failure      |
+-----------+------------+
            |
            v
+------------------------+
| Mail Gateway            |
| SMTP / SES / SendGrid   |
| JavaMail / Jakarta Mail |
+-----------+------------+
            |
            v
+------------------------+
| SMTP Relay / Provider   |
+------------------------+
```

Core invariant:

> Business transaction creates an intent. Worker executes side effect later.

Jangan kirim email langsung dari request transaction kecuali email benar-benar non-critical dan loss/duplicate/failure tidak masalah.

---

## 2. Dependency Matrix: Java 8 vs Java 21/25

### 2.1 Java 8 legacy stack

Untuk Java 8 legacy, biasanya masih memakai namespace:

```java
javax.mail.*
javax.activation.*
```

Contoh Maven dependency legacy:

```xml
<dependencies>
  <dependency>
    <groupId>com.sun.mail</groupId>
    <artifactId>javax.mail</artifactId>
    <version>1.6.2</version>
  </dependency>

  <dependency>
    <groupId>com.sun.activation</groupId>
    <artifactId>javax.activation</artifactId>
    <version>1.2.0</version>
  </dependency>
</dependencies>
```

Catatan:

- cocok untuk aplikasi Java EE 8 / Spring Boot 2.x / legacy Java 8;
- jangan campur dengan `jakarta.mail.*` di source yang sama;
- package migration harus dilakukan sebagai unit migrasi, bukan incremental import campur-aduk.

### 2.2 Java 11/17/21/25 modern stack

Untuk modern Java dan Jakarta EE modern, gunakan:

```java
jakarta.mail.*
jakarta.activation.*
```

Contoh Maven dependency modern:

```xml
<dependencies>
  <dependency>
    <groupId>org.eclipse.angus</groupId>
    <artifactId>jakarta.mail</artifactId>
    <version>2.0.3</version>
  </dependency>

  <dependency>
    <groupId>org.eclipse.angus</groupId>
    <artifactId>angus-activation</artifactId>
    <version>2.0.2</version>
  </dependency>
</dependencies>
```

Catatan:

- Angus Mail adalah implementation modern Jakarta Mail;
- Jakarta Mail API mendefinisikan abstraction, implementation menyediakan provider SMTP/IMAP/POP3;
- untuk Spring Boot 3.x, namespace yang dipakai adalah Jakarta, bukan Javax;
- untuk Java 21/25, dependency harus eksplisit; jangan mengandalkan module lama Java EE di JDK.

### 2.3 Rule penting

Jangan pernah mencampur ini:

```java
import javax.mail.Message;
import jakarta.mail.Session;
```

Itu bukan sekadar import beda. Itu tipe berbeda, jar berbeda, dan sering menyebabkan error membingungkan:

- `ClassCastException`;
- `NoClassDefFoundError`;
- `NoSuchMethodError`;
- provider tidak ditemukan;
- Activation handler tidak bekerja.

---

## 3. Domain Model

Kita mulai dari model domain, bukan dari API Jakarta Mail.

### 3.1 MailAddress

```java
public final class MailAddress {
    private final String email;
    private final String displayName;

    public MailAddress(String email, String displayName) {
        if (email == null || email.trim().isEmpty()) {
            throw new IllegalArgumentException("email is required");
        }
        this.email = email.trim();
        this.displayName = displayName == null ? null : displayName.trim();
    }

    public String email() {
        return email;
    }

    public String displayName() {
        return displayName;
    }

    @Override
    public String toString() {
        return displayName == null || displayName.isEmpty()
                ? email
                : displayName + " <" + email + ">";
    }
}
```

Kenapa tidak langsung pakai `InternetAddress` di domain?

Karena `InternetAddress` adalah infrastructure type. Domain model sebaiknya tidak tergantung pada Jakarta Mail.

### 3.2 Recipient

```java
public final class Recipient {
    public enum Type {
        TO, CC, BCC
    }

    private final Type type;
    private final MailAddress address;

    public Recipient(Type type, MailAddress address) {
        if (type == null) throw new IllegalArgumentException("type is required");
        if (address == null) throw new IllegalArgumentException("address is required");
        this.type = type;
        this.address = address;
    }

    public Type type() {
        return type;
    }

    public MailAddress address() {
        return address;
    }
}
```

Mengapa type recipient perlu eksplisit?

Karena BCC memiliki implikasi privacy. Jangan biarkan BCC hanya menjadi string optional tanpa model.

### 3.3 AttachmentRef

Attachment jangan selalu dimodelkan sebagai `byte[]`.

```java
public final class AttachmentRef {
    private final String id;
    private final String filename;
    private final String contentType;
    private final long sizeBytes;
    private final boolean inline;
    private final String contentId;

    public AttachmentRef(
            String id,
            String filename,
            String contentType,
            long sizeBytes,
            boolean inline,
            String contentId
    ) {
        if (id == null || id.trim().isEmpty()) throw new IllegalArgumentException("id is required");
        if (filename == null || filename.trim().isEmpty()) throw new IllegalArgumentException("filename is required");
        if (sizeBytes < 0) throw new IllegalArgumentException("sizeBytes must be >= 0");

        this.id = id;
        this.filename = filename;
        this.contentType = contentType == null ? "application/octet-stream" : contentType;
        this.sizeBytes = sizeBytes;
        this.inline = inline;
        this.contentId = contentId;
    }

    public String id() { return id; }
    public String filename() { return filename; }
    public String contentType() { return contentType; }
    public long sizeBytes() { return sizeBytes; }
    public boolean inline() { return inline; }
    public String contentId() { return contentId; }
}
```

Kenapa pakai reference?

Karena attachment bisa berasal dari:

- file system;
- object storage;
- database LOB;
- generated report;
- temporary file;
- encrypted storage.

Domain sebaiknya hanya menyimpan reference dan metadata, bukan payload besar.

### 3.4 MailRequest

```java
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public final class MailRequest {
    private final String idempotencyKey;
    private final String businessType;
    private final String businessId;
    private final MailAddress from;
    private final MailAddress replyTo;
    private final List<Recipient> recipients;
    private final String subject;
    private final String plainText;
    private final String html;
    private final List<AttachmentRef> attachments;
    private final Map<String, String> headers;
    private final Instant requestedAt;

    public MailRequest(
            String idempotencyKey,
            String businessType,
            String businessId,
            MailAddress from,
            MailAddress replyTo,
            List<Recipient> recipients,
            String subject,
            String plainText,
            String html,
            List<AttachmentRef> attachments,
            Map<String, String> headers,
            Instant requestedAt
    ) {
        if (idempotencyKey == null || idempotencyKey.trim().isEmpty()) {
            throw new IllegalArgumentException("idempotencyKey is required");
        }
        if (from == null) throw new IllegalArgumentException("from is required");
        if (recipients == null || recipients.isEmpty()) throw new IllegalArgumentException("recipients is required");
        if (subject == null) throw new IllegalArgumentException("subject is required");
        if ((plainText == null || plainText.isEmpty()) && (html == null || html.isEmpty())) {
            throw new IllegalArgumentException("plainText or html is required");
        }

        this.idempotencyKey = idempotencyKey;
        this.businessType = businessType;
        this.businessId = businessId;
        this.from = from;
        this.replyTo = replyTo;
        this.recipients = Collections.unmodifiableList(recipients);
        this.subject = subject;
        this.plainText = plainText;
        this.html = html;
        this.attachments = attachments == null ? Collections.emptyList() : Collections.unmodifiableList(attachments);
        this.headers = headers == null ? Collections.emptyMap() : Collections.unmodifiableMap(headers);
        this.requestedAt = requestedAt == null ? Instant.now() : requestedAt;
    }

    public String idempotencyKey() { return idempotencyKey; }
    public String businessType() { return businessType; }
    public String businessId() { return businessId; }
    public MailAddress from() { return from; }
    public MailAddress replyTo() { return replyTo; }
    public List<Recipient> recipients() { return recipients; }
    public String subject() { return subject; }
    public String plainText() { return plainText; }
    public String html() { return html; }
    public List<AttachmentRef> attachments() { return attachments; }
    public Map<String, String> headers() { return headers; }
    public Instant requestedAt() { return requestedAt; }
}
```

Design note:

- `idempotencyKey` wajib;
- `businessType` dan `businessId` untuk traceability;
- `from` explicit;
- `replyTo` optional;
- `plainText` atau `html` minimal salah satu;
- attachment berupa reference;
- custom headers dibatasi, divalidasi nanti.

---

## 4. Outbox Model

### 4.1 State machine

```text
PENDING
  -> PROCESSING
  -> SENT
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> DEAD_LETTER
  -> CANCELLED

FAILED_RETRYABLE
  -> PENDING
  -> DEAD_LETTER
```

Makna state:

| State | Makna |
|---|---|
| `PENDING` | Belum diproses worker |
| `PROCESSING` | Sedang diklaim worker |
| `SENT` | SMTP/provider accepted |
| `FAILED_RETRYABLE` | Gagal sementara, bisa dijadwalkan ulang |
| `FAILED_PERMANENT` | Gagal permanen, tidak retry |
| `DEAD_LETTER` | Gagal setelah max attempt / butuh operasi manual |
| `CANCELLED` | Dibatalkan sebelum dikirim |

### 4.2 SQL table example

```sql
CREATE TABLE mail_outbox (
    id                  VARCHAR(64) PRIMARY KEY,
    idempotency_key     VARCHAR(200) NOT NULL,
    business_type       VARCHAR(100),
    business_id         VARCHAR(100),

    status              VARCHAR(40) NOT NULL,
    attempt_count       INTEGER NOT NULL DEFAULT 0,
    max_attempt         INTEGER NOT NULL DEFAULT 5,
    next_attempt_at     TIMESTAMP NOT NULL,

    from_email          VARCHAR(320) NOT NULL,
    from_name           VARCHAR(300),
    reply_to_email      VARCHAR(320),
    reply_to_name       VARCHAR(300),

    subject             VARCHAR(1000) NOT NULL,
    request_json        CLOB NOT NULL,

    last_error_code     VARCHAR(100),
    last_error_message  VARCHAR(2000),
    provider_message_id VARCHAR(300),

    locked_by           VARCHAR(100),
    locked_at           TIMESTAMP,

    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    sent_at             TIMESTAMP,

    CONSTRAINT uq_mail_outbox_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_mail_outbox_poll
    ON mail_outbox(status, next_attempt_at, created_at);

CREATE INDEX idx_mail_outbox_business
    ON mail_outbox(business_type, business_id);
```

Kenapa `request_json`?

Karena struktur email bisa berkembang. Untuk relational query, hanya field penting yang dinormalisasi:

- id;
- idempotency;
- status;
- business reference;
- subject;
- provider id;
- timestamps.

Isi detail seperti recipient, attachment ref, body, header bisa disimpan sebagai JSON atau tabel terpisah.

Untuk compliance tinggi, pertimbangkan:

- jangan simpan rendered body penuh kalau mengandung PII;
- simpan template id + template version + variable hash;
- simpan body hanya jika ada retention policy jelas;
- encrypt at rest untuk field sensitif.

### 4.3 Claiming job dengan SKIP LOCKED

Contoh PostgreSQL/Oracle-style idea:

```sql
SELECT id
FROM mail_outbox
WHERE status IN ('PENDING', 'FAILED_RETRYABLE')
  AND next_attempt_at <= CURRENT_TIMESTAMP
ORDER BY created_at
FETCH FIRST 50 ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Setelah itu update:

```sql
UPDATE mail_outbox
SET status = 'PROCESSING',
    locked_by = ?,
    locked_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?;
```

Invariant:

> Claiming harus atomic terhadap worker lain.

Kalau database tidak mendukung `SKIP LOCKED`, opsi lain:

- optimistic update with status condition;
- distributed lock;
- broker queue;
- lease-based locking.

---

## 5. Gateway Boundary

Jangan sebar Jakarta Mail API ke seluruh aplikasi.

Buat boundary:

```java
public interface MailGateway {
    MailSendResult send(MailRequest request) throws MailGatewayException;
}
```

### 5.1 Send result

```java
import java.util.Collections;
import java.util.List;

public final class MailSendResult {
    private final String providerMessageId;
    private final List<String> acceptedRecipients;
    private final List<String> rejectedRecipients;

    public MailSendResult(
            String providerMessageId,
            List<String> acceptedRecipients,
            List<String> rejectedRecipients
    ) {
        this.providerMessageId = providerMessageId;
        this.acceptedRecipients = acceptedRecipients == null
                ? Collections.emptyList()
                : Collections.unmodifiableList(acceptedRecipients);
        this.rejectedRecipients = rejectedRecipients == null
                ? Collections.emptyList()
                : Collections.unmodifiableList(rejectedRecipients);
    }

    public String providerMessageId() { return providerMessageId; }
    public List<String> acceptedRecipients() { return acceptedRecipients; }
    public List<String> rejectedRecipients() { return rejectedRecipients; }
}
```

### 5.2 Failure classification

```java
public enum MailFailureCategory {
    CONFIGURATION,
    AUTHENTICATION,
    NETWORK,
    TIMEOUT,
    TLS,
    RATE_LIMIT,
    RECIPIENT_INVALID,
    CONTENT_REJECTED,
    PROVIDER_REJECTED,
    PARTIAL_FAILURE,
    UNKNOWN
}
```

```java
public final class MailGatewayException extends Exception {
    private final MailFailureCategory category;
    private final boolean retryable;
    private final String providerCode;

    public MailGatewayException(
            MailFailureCategory category,
            boolean retryable,
            String providerCode,
            String message,
            Throwable cause
    ) {
        super(message, cause);
        this.category = category;
        this.retryable = retryable;
        this.providerCode = providerCode;
    }

    public MailFailureCategory category() { return category; }
    public boolean retryable() { return retryable; }
    public String providerCode() { return providerCode; }
}
```

Business layer tidak perlu tahu `SMTPSendFailedException`. Worker/infrastructure yang menerjemahkannya.

---

## 6. AttachmentContentProvider

Kita butuh abstraction untuk mengambil attachment payload.

```java
import java.io.IOException;
import java.io.InputStream;

public interface AttachmentContentProvider {
    InputStream openStream(AttachmentRef attachment) throws IOException;
}
```

Contoh file-system implementation:

```java
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

public final class FileSystemAttachmentContentProvider implements AttachmentContentProvider {
    private final Map<String, Path> attachmentPathById;

    public FileSystemAttachmentContentProvider(Map<String, Path> attachmentPathById) {
        this.attachmentPathById = attachmentPathById;
    }

    @Override
    public InputStream openStream(AttachmentRef attachment) throws IOException {
        Path path = attachmentPathById.get(attachment.id());
        if (path == null) {
            throw new IOException("Attachment not found: " + attachment.id());
        }
        return Files.newInputStream(path);
    }
}
```

Security note:

- jangan menerima path mentah dari user;
- gunakan attachment id;
- resolve path dari trusted metadata;
- validate file size;
- scan malware bila perlu;
- jangan log path internal jika mengandung sensitive structure.

---

## 7. Java 21/25 Jakarta Mail Implementation

### 7.1 SMTP config

```java
public final class SmtpConfig {
    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final boolean auth;
    private final boolean startTls;
    private final boolean startTlsRequired;
    private final boolean ssl;
    private final int connectionTimeoutMillis;
    private final int readTimeoutMillis;
    private final int writeTimeoutMillis;
    private final boolean debug;

    public SmtpConfig(
            String host,
            int port,
            String username,
            String password,
            boolean auth,
            boolean startTls,
            boolean startTlsRequired,
            boolean ssl,
            int connectionTimeoutMillis,
            int readTimeoutMillis,
            int writeTimeoutMillis,
            boolean debug
    ) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
        this.auth = auth;
        this.startTls = startTls;
        this.startTlsRequired = startTlsRequired;
        this.ssl = ssl;
        this.connectionTimeoutMillis = connectionTimeoutMillis;
        this.readTimeoutMillis = readTimeoutMillis;
        this.writeTimeoutMillis = writeTimeoutMillis;
        this.debug = debug;
    }

    public String host() { return host; }
    public int port() { return port; }
    public String username() { return username; }
    public String password() { return password; }
    public boolean auth() { return auth; }
    public boolean startTls() { return startTls; }
    public boolean startTlsRequired() { return startTlsRequired; }
    public boolean ssl() { return ssl; }
    public int connectionTimeoutMillis() { return connectionTimeoutMillis; }
    public int readTimeoutMillis() { return readTimeoutMillis; }
    public int writeTimeoutMillis() { return writeTimeoutMillis; }
    public boolean debug() { return debug; }
}
```

### 7.2 Jakarta Session factory

```java
import jakarta.mail.Authenticator;
import jakarta.mail.PasswordAuthentication;
import jakarta.mail.Session;

import java.util.Properties;

public final class JakartaMailSessionFactory {
    public Session create(SmtpConfig config) {
        Properties props = new Properties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.host", config.host());
        props.put("mail.smtp.port", String.valueOf(config.port()));
        props.put("mail.smtp.auth", String.valueOf(config.auth()));

        props.put("mail.smtp.starttls.enable", String.valueOf(config.startTls()));
        props.put("mail.smtp.starttls.required", String.valueOf(config.startTlsRequired()));
        props.put("mail.smtp.ssl.enable", String.valueOf(config.ssl()));

        props.put("mail.smtp.connectiontimeout", String.valueOf(config.connectionTimeoutMillis()));
        props.put("mail.smtp.timeout", String.valueOf(config.readTimeoutMillis()));
        props.put("mail.smtp.writetimeout", String.valueOf(config.writeTimeoutMillis()));

        Authenticator authenticator = null;
        if (config.auth()) {
            authenticator = new Authenticator() {
                @Override
                protected PasswordAuthentication getPasswordAuthentication() {
                    return new PasswordAuthentication(config.username(), config.password());
                }
            };
        }

        Session session = Session.getInstance(props, authenticator);
        session.setDebug(config.debug());
        return session;
    }
}
```

Critical config:

```text
mail.smtp.connectiontimeout
mail.smtp.timeout
mail.smtp.writetimeout
```

Tanpa timeout, worker bisa menggantung terlalu lama saat provider/network bermasalah.

### 7.3 Safe DataSource for streaming attachment

Jakarta Activation `DataSource` harus dapat menyediakan fresh `InputStream` setiap kali dipanggil.

```java
import jakarta.activation.DataSource;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public final class AttachmentRefDataSource implements DataSource {
    private final AttachmentRef attachment;
    private final AttachmentContentProvider contentProvider;

    public AttachmentRefDataSource(
            AttachmentRef attachment,
            AttachmentContentProvider contentProvider
    ) {
        this.attachment = attachment;
        this.contentProvider = contentProvider;
    }

    @Override
    public InputStream getInputStream() throws IOException {
        return contentProvider.openStream(attachment);
    }

    @Override
    public OutputStream getOutputStream() throws IOException {
        throw new IOException("Read-only attachment");
    }

    @Override
    public String getContentType() {
        return attachment.contentType();
    }

    @Override
    public String getName() {
        return attachment.filename();
    }
}
```

Jangan gunakan `ByteArrayDataSource` untuk file besar kecuali ukuran sangat kecil dan terkendali.

### 7.4 Jakarta MIME composer

```java
import jakarta.activation.DataHandler;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;

public final class JakartaMimeMessageComposer {
    private final AttachmentContentProvider attachmentContentProvider;

    public JakartaMimeMessageComposer(AttachmentContentProvider attachmentContentProvider) {
        this.attachmentContentProvider = attachmentContentProvider;
    }

    public MimeMessage compose(Session session, MailRequest request)
            throws MessagingException {
        MimeMessage message = new MimeMessage(session);

        message.setFrom(toInternetAddress(request.from()));

        if (request.replyTo() != null) {
            message.setReplyTo(new InternetAddress[]{toInternetAddress(request.replyTo())});
        }

        for (Recipient recipient : request.recipients()) {
            message.addRecipient(toMessageRecipientType(recipient.type()), toInternetAddress(recipient.address()));
        }

        message.setSubject(request.subject(), StandardCharsets.UTF_8.name());
        message.setSentDate(new Date());

        for (Map.Entry<String, String> header : request.headers().entrySet()) {
            validateHeader(header.getKey(), header.getValue());
            message.setHeader(header.getKey(), header.getValue());
        }

        message.setHeader("X-Mail-Idempotency-Key", safeHeaderValue(request.idempotencyKey()));
        if (request.businessType() != null) {
            message.setHeader("X-Business-Type", safeHeaderValue(request.businessType()));
        }
        if (request.businessId() != null) {
            message.setHeader("X-Business-Id", safeHeaderValue(request.businessId()));
        }

        message.setContent(buildContent(request));
        message.saveChanges();
        return message;
    }

    private Object buildContent(MailRequest request) throws MessagingException {
        boolean hasPlain = request.plainText() != null && !request.plainText().isEmpty();
        boolean hasHtml = request.html() != null && !request.html().isEmpty();
        boolean hasAttachments = !request.attachments().isEmpty();

        MimeBodyPart bodyPart = new MimeBodyPart();

        if (hasPlain && hasHtml) {
            MimeMultipart alternative = new MimeMultipart("alternative");

            MimeBodyPart textPart = new MimeBodyPart();
            textPart.setText(request.plainText(), StandardCharsets.UTF_8.name());
            alternative.addBodyPart(textPart);

            MimeBodyPart htmlPart = new MimeBodyPart();
            htmlPart.setContent(request.html(), "text/html; charset=UTF-8");
            alternative.addBodyPart(htmlPart);

            bodyPart.setContent(alternative);
        } else if (hasHtml) {
            bodyPart.setContent(request.html(), "text/html; charset=UTF-8");
        } else {
            bodyPart.setText(request.plainText(), StandardCharsets.UTF_8.name());
        }

        if (!hasAttachments) {
            return bodyPart.getContent();
        }

        MimeMultipart mixed = new MimeMultipart("mixed");
        mixed.addBodyPart(bodyPart);

        for (AttachmentRef attachment : request.attachments()) {
            MimeBodyPart attachmentPart = new MimeBodyPart();
            AttachmentRefDataSource dataSource = new AttachmentRefDataSource(
                    attachment,
                    attachmentContentProvider
            );
            attachmentPart.setDataHandler(new DataHandler(dataSource));
            attachmentPart.setFileName(attachment.filename());

            if (attachment.inline()) {
                attachmentPart.setDisposition(MimeBodyPart.INLINE);
                if (attachment.contentId() != null && !attachment.contentId().isEmpty()) {
                    attachmentPart.setHeader("Content-ID", "<" + safeContentId(attachment.contentId()) + ">");
                }
            } else {
                attachmentPart.setDisposition(MimeBodyPart.ATTACHMENT);
            }

            mixed.addBodyPart(attachmentPart);
        }

        return mixed;
    }

    private InternetAddress toInternetAddress(MailAddress address) throws MessagingException {
        try {
            return new InternetAddress(address.email(), address.displayName(), StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException e) {
            throw new MessagingException("Invalid address encoding", e);
        }
    }

    private Message.RecipientType toMessageRecipientType(Recipient.Type type) {
        switch (type) {
            case TO: return Message.RecipientType.TO;
            case CC: return Message.RecipientType.CC;
            case BCC: return Message.RecipientType.BCC;
            default: throw new IllegalArgumentException("Unknown recipient type: " + type);
        }
    }

    private void validateHeader(String name, String value) throws MessagingException {
        if (name == null || name.trim().isEmpty()) {
            throw new MessagingException("Header name is required");
        }
        if (containsCrLf(name) || containsCrLf(value)) {
            throw new MessagingException("Header injection detected");
        }
    }

    private String safeHeaderValue(String value) throws MessagingException {
        if (containsCrLf(value)) {
            throw new MessagingException("Header injection detected");
        }
        return value;
    }

    private String safeContentId(String value) throws MessagingException {
        if (containsCrLf(value) || value.contains("<") || value.contains(">")) {
            throw new MessagingException("Invalid content id");
        }
        return value;
    }

    private boolean containsCrLf(String value) {
        return value != null && (value.contains("\r") || value.contains("\n"));
    }
}
```

Important correction:

The simple implementation above handles:

- plain only;
- HTML only;
- plain + HTML alternative;
- attachment mixed.

For production inline image plus HTML, a more correct structure is usually:

```text
multipart/mixed
  multipart/related
    multipart/alternative
      text/plain
      text/html
    image/png inline Content-ID
  application/pdf attachment
```

So for full production, split composer into:

- `AlternativeBodyComposer`;
- `RelatedBodyComposer`;
- `MixedBodyComposer`.

The compact code above is intentionally readable first.

### 7.5 Jakarta SMTP gateway

```java
import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.MimeMessage;
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;

import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.List;

public final class JakartaSmtpMailGateway implements MailGateway {
    private final Session session;
    private final JakartaMimeMessageComposer composer;

    public JakartaSmtpMailGateway(Session session, JakartaMimeMessageComposer composer) {
        this.session = session;
        this.composer = composer;
    }

    @Override
    public MailSendResult send(MailRequest request) throws MailGatewayException {
        try {
            MimeMessage message = composer.compose(session, request);
            Transport.send(message);

            return new MailSendResult(
                    message.getMessageID(),
                    allRecipientEmails(request),
                    List.of()
            );
        } catch (SendFailedException e) {
            throw classifySendFailed(e);
        } catch (MessagingException e) {
            throw classifyMessagingException(e);
        }
    }

    private MailGatewayException classifySendFailed(SendFailedException e) {
        List<String> validSent = addressesToStrings(e.getValidSentAddresses());
        List<String> validUnsent = addressesToStrings(e.getValidUnsentAddresses());
        List<String> invalid = addressesToStrings(e.getInvalidAddresses());

        boolean hasSent = !validSent.isEmpty();
        boolean hasUnsentOrInvalid = !validUnsent.isEmpty() || !invalid.isEmpty();

        Throwable nested = e.getNextException();
        if (nested instanceof SMTPAddressFailedException) {
            SMTPAddressFailedException smtp = (SMTPAddressFailedException) nested;
            int code = smtp.getReturnCode();
            boolean retryable = code >= 400 && code < 500;
            return new MailGatewayException(
                    MailFailureCategory.RECIPIENT_INVALID,
                    retryable,
                    String.valueOf(code),
                    "Recipient-level SMTP failure: " + sanitize(smtp.getMessage()),
                    e
            );
        }

        if (hasSent && hasUnsentOrInvalid) {
            return new MailGatewayException(
                    MailFailureCategory.PARTIAL_FAILURE,
                    true,
                    null,
                    "Partial mail send failure",
                    e
            );
        }

        return new MailGatewayException(
                MailFailureCategory.PROVIDER_REJECTED,
                false,
                null,
                "Mail send failed",
                e
        );
    }

    private MailGatewayException classifyMessagingException(MessagingException e) {
        Throwable cursor = e;
        while (cursor != null) {
            if (cursor instanceof SMTPSendFailedException) {
                SMTPSendFailedException smtp = (SMTPSendFailedException) cursor;
                int code = smtp.getReturnCode();
                return new MailGatewayException(
                        classifySmtpCode(code),
                        isRetryableSmtpCode(code),
                        String.valueOf(code),
                        "SMTP send failed: " + sanitize(smtp.getMessage()),
                        e
                );
            }
            if (cursor instanceof SocketTimeoutException) {
                return new MailGatewayException(
                        MailFailureCategory.TIMEOUT,
                        true,
                        null,
                        "SMTP timeout",
                        e
                );
            }
            cursor = cursor.getCause();
        }

        Exception next = e.getNextException();
        if (next != null && next != e) {
            if (next instanceof SocketTimeoutException) {
                return new MailGatewayException(
                        MailFailureCategory.TIMEOUT,
                        true,
                        null,
                        "SMTP timeout",
                        e
                );
            }
        }

        return new MailGatewayException(
                MailFailureCategory.UNKNOWN,
                true,
                null,
                "Unknown mail failure: " + sanitize(e.getMessage()),
                e
        );
    }

    private MailFailureCategory classifySmtpCode(int code) {
        if (code == 421 || code == 450 || code == 451 || code == 452) {
            return MailFailureCategory.RATE_LIMIT;
        }
        if (code == 535 || code == 530) {
            return MailFailureCategory.AUTHENTICATION;
        }
        if (code >= 500 && code < 600) {
            return MailFailureCategory.PROVIDER_REJECTED;
        }
        if (code >= 400 && code < 500) {
            return MailFailureCategory.NETWORK;
        }
        return MailFailureCategory.UNKNOWN;
    }

    private boolean isRetryableSmtpCode(int code) {
        return code >= 400 && code < 500;
    }

    private List<String> addressesToStrings(Address[] addresses) {
        List<String> result = new ArrayList<>();
        if (addresses == null) return result;
        for (Address address : addresses) {
            result.add(address.toString());
        }
        return result;
    }

    private List<String> allRecipientEmails(MailRequest request) {
        List<String> result = new ArrayList<>();
        for (Recipient recipient : request.recipients()) {
            result.add(recipient.address().email());
        }
        return result;
    }

    private String sanitize(String message) {
        if (message == null) return null;
        return message.replaceAll("[\r\n]+", " ");
    }
}
```

Caution:

- `org.eclipse.angus.mail.smtp.*` class names apply to Angus implementation;
- older JavaMail implementations may use `com.sun.mail.smtp.*`;
- keep provider-specific exception logic isolated in gateway.

---

## 8. Java 8 `javax.mail` Implementation

### 8.1 Main namespace difference

Legacy version uses:

```java
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.MimeMessage;
import javax.activation.DataSource;
import javax.activation.DataHandler;
```

Modern version uses:

```java
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.MimeMessage;
import jakarta.activation.DataSource;
import jakarta.activation.DataHandler;
```

### 8.2 Legacy Session factory

```java
import javax.mail.Authenticator;
import javax.mail.PasswordAuthentication;
import javax.mail.Session;
import java.util.Properties;

public final class JavaxMailSessionFactory {
    public Session create(SmtpConfig config) {
        Properties props = new Properties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.host", config.host());
        props.put("mail.smtp.port", String.valueOf(config.port()));
        props.put("mail.smtp.auth", String.valueOf(config.auth()));
        props.put("mail.smtp.starttls.enable", String.valueOf(config.startTls()));
        props.put("mail.smtp.starttls.required", String.valueOf(config.startTlsRequired()));
        props.put("mail.smtp.ssl.enable", String.valueOf(config.ssl()));
        props.put("mail.smtp.connectiontimeout", String.valueOf(config.connectionTimeoutMillis()));
        props.put("mail.smtp.timeout", String.valueOf(config.readTimeoutMillis()));
        props.put("mail.smtp.writetimeout", String.valueOf(config.writeTimeoutMillis()));

        Authenticator authenticator = null;
        if (config.auth()) {
            authenticator = new Authenticator() {
                @Override
                protected PasswordAuthentication getPasswordAuthentication() {
                    return new PasswordAuthentication(config.username(), config.password());
                }
            };
        }

        Session session = Session.getInstance(props, authenticator);
        session.setDebug(config.debug());
        return session;
    }
}
```

### 8.3 Migration strategy

Do not maintain two codebases manually if avoidable.

Better strategies:

1. keep domain model dependency-free;
2. isolate mail provider in adapter module;
3. have one `mail-gateway-javax` module;
4. have one `mail-gateway-jakarta` module;
5. keep shared test contract;
6. run both implementations against same fake SMTP tests.

Structure:

```text
mail-domain/
  MailRequest
  Recipient
  AttachmentRef
  MailGateway
  MailSendResult

mail-gateway-javax/
  JavaxSmtpMailGateway
  JavaxMimeMessageComposer

mail-gateway-jakarta/
  JakartaSmtpMailGateway
  JakartaMimeMessageComposer

mail-worker/
  OutboxWorker
  RetryPolicy
  FailureClassifier
```

This prevents namespace pollution.

---

## 9. Outbox Worker Implementation

### 9.1 Repository contract

```java
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface MailOutboxRepository {
    List<String> claimBatch(String workerId, int batchSize, Instant now);
    Optional<MailOutboxRecord> findById(String id);
    void markSent(String id, String providerMessageId, Instant sentAt);
    void markFailedRetryable(String id, String errorCode, String errorMessage, Instant nextAttemptAt);
    void markFailedPermanent(String id, String errorCode, String errorMessage);
    void markDeadLetter(String id, String errorCode, String errorMessage);
}
```

### 9.2 Outbox record

```java
import java.time.Instant;

public final class MailOutboxRecord {
    private final String id;
    private final MailRequest request;
    private final int attemptCount;
    private final int maxAttempt;
    private final Instant createdAt;

    public MailOutboxRecord(
            String id,
            MailRequest request,
            int attemptCount,
            int maxAttempt,
            Instant createdAt
    ) {
        this.id = id;
        this.request = request;
        this.attemptCount = attemptCount;
        this.maxAttempt = maxAttempt;
        this.createdAt = createdAt;
    }

    public String id() { return id; }
    public MailRequest request() { return request; }
    public int attemptCount() { return attemptCount; }
    public int maxAttempt() { return maxAttempt; }
    public Instant createdAt() { return createdAt; }
}
```

### 9.3 Retry policy

```java
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ThreadLocalRandom;

public final class RetryPolicy {
    private final Duration baseDelay;
    private final Duration maxDelay;

    public RetryPolicy(Duration baseDelay, Duration maxDelay) {
        this.baseDelay = baseDelay;
        this.maxDelay = maxDelay;
    }

    public Instant nextAttemptAt(int attemptCount, Instant now) {
        long baseMillis = baseDelay.toMillis();
        long maxMillis = maxDelay.toMillis();

        long exponential = baseMillis * (1L << Math.min(attemptCount, 10));
        long capped = Math.min(exponential, maxMillis);
        long jitter = ThreadLocalRandom.current().nextLong(0, Math.max(1, capped / 4));

        return now.plusMillis(capped + jitter);
    }
}
```

Example schedule:

```text
attempt 1: ~30s
attempt 2: ~60s
attempt 3: ~2m
attempt 4: ~4m
attempt 5: ~8m
then dead-letter
```

### 9.4 Worker loop

```java
import java.time.Clock;
import java.time.Instant;
import java.util.List;

public final class MailOutboxWorker {
    private final String workerId;
    private final MailOutboxRepository repository;
    private final MailGateway gateway;
    private final RetryPolicy retryPolicy;
    private final Clock clock;
    private final int batchSize;

    public MailOutboxWorker(
            String workerId,
            MailOutboxRepository repository,
            MailGateway gateway,
            RetryPolicy retryPolicy,
            Clock clock,
            int batchSize
    ) {
        this.workerId = workerId;
        this.repository = repository;
        this.gateway = gateway;
        this.retryPolicy = retryPolicy;
        this.clock = clock;
        this.batchSize = batchSize;
    }

    public void runOnce() {
        Instant now = clock.instant();
        List<String> ids = repository.claimBatch(workerId, batchSize, now);

        for (String id : ids) {
            processOne(id);
        }
    }

    private void processOne(String id) {
        MailOutboxRecord record = repository.findById(id).orElse(null);
        if (record == null) {
            return;
        }

        try {
            MailSendResult result = gateway.send(record.request());
            repository.markSent(id, result.providerMessageId(), clock.instant());
        } catch (MailGatewayException e) {
            handleFailure(record, e);
        } catch (RuntimeException e) {
            handleFailure(record, new MailGatewayException(
                    MailFailureCategory.UNKNOWN,
                    true,
                    null,
                    "Unexpected worker failure",
                    e
            ));
        }
    }

    private void handleFailure(MailOutboxRecord record, MailGatewayException e) {
        String errorCode = e.category().name();
        String errorMessage = sanitize(e.getMessage());

        if (!e.retryable()) {
            repository.markFailedPermanent(record.id(), errorCode, errorMessage);
            return;
        }

        int nextAttempt = record.attemptCount() + 1;
        if (nextAttempt >= record.maxAttempt()) {
            repository.markDeadLetter(record.id(), errorCode, errorMessage);
            return;
        }

        Instant nextAttemptAt = retryPolicy.nextAttemptAt(nextAttempt, clock.instant());
        repository.markFailedRetryable(record.id(), errorCode, errorMessage, nextAttemptAt);
    }

    private String sanitize(String message) {
        if (message == null) return null;
        String oneLine = message.replaceAll("[\r\n]+", " ");
        return oneLine.length() > 1000 ? oneLine.substring(0, 1000) : oneLine;
    }
}
```

Important worker invariants:

1. worker must not throw and stop entire process for one bad email;
2. retry must be bounded;
3. permanent failure must not retry forever;
4. unknown failure should usually be retryable initially;
5. every failure must update outbox state;
6. error message must be sanitized and length-bounded;
7. worker must be horizontally safe.

---

## 10. Notification Service

### 10.1 Business-facing API

```java
public interface NotificationService {
    String requestEmail(MailRequest request);
}
```

Implementation:

```java
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

public final class DefaultNotificationService implements NotificationService {
    private final MailOutboxInsertRepository repository;
    private final Clock clock;

    public DefaultNotificationService(MailOutboxInsertRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    public String requestEmail(MailRequest request) {
        String id = UUID.randomUUID().toString();
        Instant now = clock.instant();

        repository.insertIfAbsent(new NewMailOutboxCommand(
                id,
                request.idempotencyKey(),
                request.businessType(),
                request.businessId(),
                request,
                now,
                now
        ));

        return id;
    }
}
```

### 10.2 Insert-if-absent behavior

Idempotency key should make repeated request safe:

```text
same idempotencyKey -> same logical mail intent
```

Examples:

| Business event | Idempotency key |
|---|---|
| Case submitted | `CASE_SUBMITTED:{caseId}:v1` |
| Password reset | `PASSWORD_RESET:{tokenId}` |
| Invoice issued | `INVOICE_ISSUED:{invoiceId}:v3` |
| Appeal decision | `APPEAL_DECISION:{appealId}:{decisionVersion}` |

Do not use random UUID as idempotency key if you need duplicate prevention.

Use a deterministic business key.

---

## 11. Template Rendering Boundary

The reference implementation above assumes `MailRequest` already contains rendered `plainText` and `html`.

For larger systems, better split:

```text
Business Event
  -> NotificationIntent(templateId, templateVersion, variables)
  -> Renderer
  -> MailRequest(rendered subject/body)
  -> Outbox
```

Example:

```java
import java.util.Map;

public final class TemplateRenderRequest {
    private final String templateId;
    private final String templateVersion;
    private final Map<String, Object> variables;
    private final String locale;

    public TemplateRenderRequest(
            String templateId,
            String templateVersion,
            Map<String, Object> variables,
            String locale
    ) {
        this.templateId = templateId;
        this.templateVersion = templateVersion;
        this.variables = variables;
        this.locale = locale;
    }

    public String templateId() { return templateId; }
    public String templateVersion() { return templateVersion; }
    public Map<String, Object> variables() { return variables; }
    public String locale() { return locale; }
}
```

```java
public final class RenderedEmailTemplate {
    private final String subject;
    private final String plainText;
    private final String html;

    public RenderedEmailTemplate(String subject, String plainText, String html) {
        this.subject = subject;
        this.plainText = plainText;
        this.html = html;
    }

    public String subject() { return subject; }
    public String plainText() { return plainText; }
    public String html() { return html; }
}
```

```java
public interface EmailTemplateRenderer {
    RenderedEmailTemplate render(TemplateRenderRequest request);
}
```

Key architecture decision:

> Store enough information to prove what was intended, but not necessarily full sensitive rendered content forever.

Options:

| Storage model | Pros | Cons |
|---|---|---|
| Store rendered body | strongest reconstruction | PII retention risk |
| Store template + variables | re-render possible | template drift risk |
| Store template version + variable hash | privacy safer | cannot reconstruct exact content |
| Store sanitized audit summary | safer | weaker evidence |

---

## 12. Observability Integration

### 12.1 Metrics interface

```java
public interface MailMetrics {
    void incrementAttempt(String provider);
    void incrementSuccess(String provider);
    void incrementFailure(String provider, MailFailureCategory category, boolean retryable);
    void recordLatency(String provider, long millis);
    void recordQueueAge(long millis);
}
```

### 12.2 Gateway wrapper

```java
public final class ObservedMailGateway implements MailGateway {
    private final String provider;
    private final MailGateway delegate;
    private final MailMetrics metrics;

    public ObservedMailGateway(String provider, MailGateway delegate, MailMetrics metrics) {
        this.provider = provider;
        this.delegate = delegate;
        this.metrics = metrics;
    }

    @Override
    public MailSendResult send(MailRequest request) throws MailGatewayException {
        long start = System.nanoTime();
        metrics.incrementAttempt(provider);
        try {
            MailSendResult result = delegate.send(request);
            metrics.incrementSuccess(provider);
            return result;
        } catch (MailGatewayException e) {
            metrics.incrementFailure(provider, e.category(), e.retryable());
            throw e;
        } finally {
            long elapsedMillis = (System.nanoTime() - start) / 1_000_000L;
            metrics.recordLatency(provider, elapsedMillis);
        }
    }
}
```

Metrics to expose:

```text
mail_send_attempt_total{provider}
mail_send_success_total{provider}
mail_send_failure_total{provider,category,retryable}
mail_send_latency_ms{provider}
mail_outbox_queue_age_ms
mail_outbox_depth{status}
mail_outbox_dead_letter_total
mail_attachment_size_bytes
```

### 12.3 Structured logs

Good log:

```json
{
  "event": "mail_send_failed",
  "mailOutboxId": "...",
  "businessType": "CASE_SUBMITTED",
  "businessId": "CASE-2026-00123",
  "category": "TIMEOUT",
  "retryable": true,
  "attempt": 2,
  "nextAttemptAt": "2026-06-18T10:15:00Z"
}
```

Bad log:

```text
Failed to send email to fajar@example.com with body: Dear Fajar, your password reset token is ...
```

Never log:

- full body;
- raw attachment content;
- SMTP password;
- OAuth token;
- full recipient list if not needed;
- sensitive template variables.

---

## 13. Spring Boot Wiring Example

### 13.1 Configuration properties

```java
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.mail.smtp")
public class MailSmtpProperties {
    private String host;
    private int port = 587;
    private String username;
    private String password;
    private boolean auth = true;
    private boolean startTls = true;
    private boolean startTlsRequired = true;
    private boolean ssl = false;
    private int connectionTimeoutMillis = 5000;
    private int readTimeoutMillis = 10000;
    private int writeTimeoutMillis = 10000;
    private boolean debug = false;

    // getters and setters omitted for brevity
}
```

### 13.2 Bean wiring

```java
import jakarta.mail.Session;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MailConfiguration {
    @Bean
    public SmtpConfig smtpConfig(MailSmtpProperties properties) {
        return new SmtpConfig(
                properties.getHost(),
                properties.getPort(),
                properties.getUsername(),
                properties.getPassword(),
                properties.isAuth(),
                properties.isStartTls(),
                properties.isStartTlsRequired(),
                properties.isSsl(),
                properties.getConnectionTimeoutMillis(),
                properties.getReadTimeoutMillis(),
                properties.getWriteTimeoutMillis(),
                properties.isDebug()
        );
    }

    @Bean
    public Session jakartaMailSession(SmtpConfig config) {
        return new JakartaMailSessionFactory().create(config);
    }

    @Bean
    public JakartaMimeMessageComposer jakartaMimeMessageComposer(
            AttachmentContentProvider attachmentContentProvider
    ) {
        return new JakartaMimeMessageComposer(attachmentContentProvider);
    }

    @Bean
    public MailGateway mailGateway(
            Session session,
            JakartaMimeMessageComposer composer
    ) {
        return new JakartaSmtpMailGateway(session, composer);
    }
}
```

Spring Boot can also use `JavaMailSender`, but the gateway boundary remains valuable. You can have:

```text
MailGateway
  -> JakartaSmtpMailGateway using raw Jakarta Mail
```

or:

```text
MailGateway
  -> SpringJavaMailSenderGateway using JavaMailSender
```

Do not leak either into business modules.

---

## 14. Testing Strategy

### 14.1 Unit test composer

Test without SMTP:

```java
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;

import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class JakartaMimeMessageComposerTest {
    @Test
    void composePlainTextMessage() throws Exception {
        Session session = Session.getInstance(new Properties());
        AttachmentContentProvider attachmentProvider = attachment -> {
            throw new UnsupportedOperationException();
        };
        JakartaMimeMessageComposer composer = new JakartaMimeMessageComposer(attachmentProvider);

        MailRequest request = TestMailRequests.simplePlainText();
        MimeMessage message = composer.compose(session, request);

        assertEquals("Hello", message.getSubject());
        assertNotNull(message.getAllRecipients());
        assertEquals("text/plain", message.getContentType().split(";")[0].toLowerCase());
    }
}
```

Test cases:

1. plain only;
2. HTML only;
3. plain + HTML alternative;
4. attachment;
5. inline attachment;
6. Unicode subject;
7. Unicode display name;
8. header injection rejected;
9. BCC not visible in final headers if serialized as expected;
10. large attachment uses provider stream.

### 14.2 Fake SMTP integration test

Use Mailpit/GreenMail/Testcontainers-style setup:

```text
Application -> localhost fake SMTP -> captured messages
```

Assert:

- message received;
- subject correct;
- MIME structure correct;
- attachment exists;
- content type correct;
- body contains expected content;
- no sensitive debug data logged.

### 14.3 Failure test

Create fake gateway for worker tests:

```java
public final class FailingMailGateway implements MailGateway {
    private final MailGatewayException exception;

    public FailingMailGateway(MailGatewayException exception) {
        this.exception = exception;
    }

    @Override
    public MailSendResult send(MailRequest request) throws MailGatewayException {
        throw exception;
    }
}
```

Worker tests:

1. retryable failure becomes `FAILED_RETRYABLE`;
2. permanent failure becomes `FAILED_PERMANENT`;
3. max attempt exceeded becomes `DEAD_LETTER`;
4. success becomes `SENT`;
5. runtime exception becomes retryable unknown;
6. one failed record does not block next record.

---

## 15. Security Hardening Checklist

### 15.1 SMTP

- enable STARTTLS for port 587;
- set `starttls.required=true` where possible;
- do not disable certificate validation;
- use explicit timeout;
- do not enable debug in production by default;
- redact debug logs if temporarily enabled;
- rotate credentials;
- use least-privilege SMTP account.

### 15.2 Message

- validate header values;
- prevent CRLF injection;
- validate sender domain;
- restrict custom headers;
- escape template variables;
- avoid raw user HTML;
- include plain text fallback;
- avoid sensitive data in subject.

### 15.3 Attachment

- limit size;
- restrict content type;
- scan file;
- do not trust extension;
- use safe filename;
- avoid path traversal;
- prefer secure download link for sensitive files;
- cleanup temporary files.

### 15.4 Outbox

- encrypt sensitive payload if stored;
- restrict database access;
- redact logs;
- audit state transitions;
- protect replay operation;
- require approval for dead-letter replay in regulated flows.

---

## 16. Production Configuration Example

```yaml
app:
  mail:
    provider: smtp
    smtp:
      host: smtp.example.internal
      port: 587
      username: ${SMTP_USERNAME}
      password: ${SMTP_PASSWORD}
      auth: true
      start-tls: true
      start-tls-required: true
      ssl: false
      connection-timeout-millis: 5000
      read-timeout-millis: 10000
      write-timeout-millis: 10000
      debug: false
    outbox:
      batch-size: 50
      max-attempt: 5
      base-retry-delay-seconds: 30
      max-retry-delay-minutes: 30
      worker-enabled: true
      worker-count: 4
    limits:
      max-recipients-per-message: 50
      max-attachment-bytes: 10485760
      max-total-attachment-bytes: 20971520
```

Operational note:

- `worker-count` must respect SMTP/provider rate limit;
- batch size is not throughput guarantee;
- queue age is more meaningful than only queue depth;
- timeout too high hides incidents;
- timeout too low causes false failure.

---

## 17. End-to-End Flow Example

### 17.1 Business event

```text
Case submitted
```

### 17.2 Business service creates mail intent

```java
MailRequest request = new MailRequest(
        "CASE_SUBMITTED:" + caseId + ":v1",
        "CASE_SUBMITTED",
        caseId,
        new MailAddress("no-reply@example.gov", "Example Gov"),
        new MailAddress("support@example.gov", "Example Gov Support"),
        List.of(new Recipient(Recipient.Type.TO, new MailAddress(applicantEmail, applicantName))),
        "Your case has been submitted",
        "Dear " + applicantName + ",\n\nYour case has been submitted.",
        "<p>Dear " + escapeHtml(applicantName) + ",</p><p>Your case has been submitted.</p>",
        List.of(),
        Map.of("X-Notification-Type", "CASE_SUBMITTED"),
        Instant.now()
);

notificationService.requestEmail(request);
```

### 17.3 Outbox row inserted

```text
status=PENDING
attempt_count=0
next_attempt_at=now
idempotency_key=CASE_SUBMITTED:CASE-123:v1
```

### 17.4 Worker claims

```text
PENDING -> PROCESSING
```

### 17.5 Gateway sends

```text
PROCESSING -> SENT
provider_message_id=<...>
sent_at=now
```

Or failure:

```text
PROCESSING -> FAILED_RETRYABLE
next_attempt_at=now+backoff
```

Or permanent:

```text
PROCESSING -> FAILED_PERMANENT
error_code=RECIPIENT_INVALID
```

---

## 18. What Top Engineers Look For in This Implementation

A basic engineer asks:

> Can it send email?

A strong engineer asks:

> What happens when sending fails?

A top engineer asks:

> What are the invariants, failure modes, recovery paths, observability signals, privacy boundaries, and migration seams?

For this reference implementation, the important qualities are:

1. domain does not depend on Jakarta Mail;
2. SMTP implementation is isolated;
3. Javax/Jakarta migration is controlled;
4. outbox makes side effect durable;
5. idempotency prevents duplicate intent;
6. retry is bounded;
7. failure is classified;
8. attachment is streamed by reference;
9. logs are sanitized;
10. metrics are first-class;
11. tests can run without real SMTP;
12. implementation can later switch to provider API;
13. compliance concerns are visible in the design.

---

## 19. Known Limitations of This Reference Implementation

This implementation is a strong baseline, but not complete for every enterprise case.

Missing advanced features:

1. provider webhook handling;
2. bounce suppression list;
3. DKIM signing inside application;
4. multi-provider failover;
5. tenant-specific sender routing;
6. template approval workflow;
7. full `multipart/related` builder for inline images;
8. S/MIME or PGP encryption;
9. distributed rate limiter;
10. admin replay UI;
11. attachment malware scanning integration;
12. exact rendered-content retention policy.

These belong in higher-level modules depending on risk and requirements.

---

## 20. Final Reference Architecture

```text
                       +----------------------+
                       | Business Application |
                       +----------+-----------+
                                  |
                                  | create MailRequest / NotificationIntent
                                  v
                       +----------------------+
                       | Notification Service |
                       | idempotency boundary |
                       +----------+-----------+
                                  |
                                  | insert in same DB transaction
                                  v
                       +----------------------+
                       | Mail Outbox          |
                       | durable intent       |
                       +----------+-----------+
                                  |
                                  | claim batch
                                  v
                       +----------------------+
                       | Mail Worker          |
                       | retry / classify     |
                       +----------+-----------+
                                  |
                       +----------+-----------+
                       | Mail Gateway         |
                       | SMTP/API abstraction |
                       +----+------------+----+
                            |            |
                +-----------+            +------------+
                v                                     v
       +-------------------+                 +----------------+
       | Jakarta Mail SMTP |                 | Provider API   |
       | Angus / SMTP      |                 | SES/SendGrid   |
       +---------+---------+                 +--------+-------+
                 |                                    |
                 v                                    v
       +-------------------+                 +----------------+
       | SMTP Relay        |                 | Provider infra |
       +-------------------+                 +----------------+
```

---

## 21. Checklist Sebelum Masuk Production

### Functional

- [ ] plain text email works;
- [ ] HTML email works;
- [ ] plain + HTML alternative works;
- [ ] attachment works;
- [ ] inline image works if needed;
- [ ] Unicode subject works;
- [ ] Unicode display name works;
- [ ] BCC privacy verified;
- [ ] reply-to verified.

### Reliability

- [ ] outbox table has unique idempotency key;
- [ ] worker claim is concurrency safe;
- [ ] retry has max attempt;
- [ ] retry uses backoff+jitter;
- [ ] dead-letter path exists;
- [ ] replay process exists;
- [ ] duplicate email scenario tested.

### Security

- [ ] TLS required;
- [ ] timeout configured;
- [ ] credentials from secret store;
- [ ] no SMTP debug in production;
- [ ] logs redacted;
- [ ] header injection test exists;
- [ ] attachment size limit exists;
- [ ] attachment scanning decision documented.

### Observability

- [ ] send attempts metric;
- [ ] send success metric;
- [ ] send failure metric by category;
- [ ] queue depth metric;
- [ ] queue age metric;
- [ ] dead-letter alert;
- [ ] auth failure alert;
- [ ] timeout spike alert;
- [ ] correlation ID in logs.

### Compliance

- [ ] PII policy documented;
- [ ] rendered body retention decided;
- [ ] template version stored;
- [ ] business reference stored;
- [ ] access to mail logs restricted;
- [ ] manual replay audited;
- [ ] recipient data redaction implemented.

---

## 22. Summary

End-to-end mail implementation yang matang bukan hanya wrapper Jakarta Mail.

Struktur yang tepat adalah:

```text
Domain MailRequest
  -> Notification Service
  -> Transactional Outbox
  -> Worker
  -> MailGateway
  -> Jakarta Mail / Provider API
  -> SMTP Relay / Email Provider
```

Mental model utamanya:

1. email adalah side effect asynchronous;
2. side effect harus dibuat durable sebelum dieksekusi;
3. SMTP accepted bukan delivered;
4. retry harus bounded dan idempotent;
5. Jakarta Mail harus berada di infrastructure boundary;
6. Javax/Jakarta harus dipisahkan bersih;
7. observability dan audit bukan fitur tambahan, tetapi bagian inti desain;
8. compliance mempengaruhi apa yang disimpan, dilog, dan bisa di-replay.

Jika bagian sebelumnya memberi semua konsep individual, bagian ini menyatukannya menjadi bentuk implementasi yang bisa menjadi fondasi production-grade mail subsystem.

---

## 23. Referensi Utama

- Jakarta Mail 2.1 Specification — `https://jakarta.ee/specifications/mail/2.1/jakarta-mail-spec-2.1`
- Jakarta Mail API Documentation — `https://jakarta.ee/specifications/mail/2.1/apidocs/`
- Eclipse Angus Mail — `https://eclipse-ee4j.github.io/angus-mail/`
- Eclipse Angus SMTP Transport — `https://eclipse-ee4j.github.io/angus-mail/SMTP-Transport`
- Jakarta Activation 2.1 — `https://jakarta.ee/specifications/activation/2.1/`
- Jakarta Activation `DataHandler` — `https://jakarta.ee/specifications/activation/2.1/apidocs/jakarta.activation/jakarta/activation/datahandler`
- Spring Framework Email Integration — `https://docs.spring.io/spring-framework/reference/integration/email.html`
- Spring `MimeMessageHelper` — `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/mail/javamail/MimeMessageHelper.html`

---

## 24. Status Seri

Part 28 selesai.

Seri belum selesai.

Sisa:

```text
[ ] Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 27 — Failure Modelling and Production Incident Playbook](./27-production-incident-playbook.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect](./29-top-one-percent-design-review.md)
